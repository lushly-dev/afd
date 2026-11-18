//! Operations (the specification's 9.1 to 9.3): each change to mail at a
//! provider, the frozen set it acts on, and what it did to each message, so
//! that a stop is resumed from the step reached and a change is undone from
//! what it recorded.
//!
//! An item is a message in a mailbox, as the provider named it there when
//! the operation was made. It goes through steps: `waiting`; for a copy or a
//! move, `copying` once the request is sent, `copied` once the provider said
//! where the copy went, and for a move without `MOVE`, `flagged` once the
//! original carries the delete flag; and at last `done`, `unchanged` (it was
//! already as the change would leave it), `missing` (it had moved or gone,
//! and is left alone) or `ignored` (the provider answered and did not act on
//! it). When an item is done, what the store shows changes with it, as the
//! next pass of sync would find it, so that a list is right at once.

use rusqlite::{OptionalExtension, Transaction, params};

use super::derived::{Touched, rebuild_cursor, settle, touch_place};
use super::{
    Kept, Proposer, Role, SelectionItem, Store, StoreError, count, flags_json, note_change,
};

/// How long a proposal waits for the person, in milliseconds (9.4).
pub const PROPOSAL_LIFETIME: i64 = 7 * 24 * 60 * 60 * 1000;

/// How many proposals one caller may have waiting (9.4).
pub const MOST_PROPOSALS: u32 = 5;

/// What an operation does to each message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Moves it to another mailbox.
    Move,
    /// Copies it to another mailbox.
    Copy,
    /// Removes a copy that an undo takes back, while the message it was
    /// copied from is still there.
    Remove,
    /// Sets or clears its flags.
    Flags,
}

impl Action {
    /// As the store writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Move => "move",
            Self::Copy => "copy",
            Self::Remove => "remove",
            Self::Flags => "flags",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "move" => Self::Move,
            "copy" => Self::Copy,
            "remove" => Self::Remove,
            _ => Self::Flags,
        }
    }
}

/// Which of the policy's limits an operation counts against (9.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Archiving, labelling and marking.
    Change,
    /// Moving to the trash.
    Trash,
}

impl Kind {
    /// As the store writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Change => "change",
            Self::Trash => "trash",
        }
    }
}

/// Where an operation stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationState {
    /// It waits for the person's approval, and changes nothing until then.
    Proposed,
    /// It runs, or was running when its process stopped.
    Running,
    /// It stopped before its end: asked to, or on a failure. It can be
    /// resumed.
    Stopped,
    /// Every item reached its end.
    Done,
    /// A proposal the person or its proposer dismissed before it ran.
    Dismissed,
    /// A proposal that waited seven days and never ran.
    Expired,
}

impl OperationState {
    /// As the store writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Running => "running",
            Self::Stopped => "stopped",
            Self::Done => "done",
            Self::Dismissed => "dismissed",
            Self::Expired => "expired",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "proposed" => Self::Proposed,
            "running" => Self::Running,
            "done" => Self::Done,
            "dismissed" => Self::Dismissed,
            "expired" => Self::Expired,
            _ => Self::Stopped,
        }
    }
}

/// The step an item reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Nothing done yet.
    Waiting,
    /// A copy or a move was asked for and its answer not yet read.
    Copying,
    /// The provider said where the copy went.
    Copied,
    /// The original carries the delete flag, after its copy was confirmed.
    Flagged,
    /// The change was made.
    Done,
    /// It was already as the change would leave it.
    Unchanged,
    /// It had moved or gone when its batch ran, and was left alone.
    Missing,
    /// The provider answered and did not act on it.
    Ignored,
}

impl Step {
    /// As the store writes it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Copying => "copying",
            Self::Copied => "copied",
            Self::Flagged => "flagged",
            Self::Done => "done",
            Self::Unchanged => "unchanged",
            Self::Missing => "missing",
            Self::Ignored => "ignored",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "waiting" => Self::Waiting,
            "copying" => Self::Copying,
            "copied" => Self::Copied,
            "flagged" => Self::Flagged,
            "done" => Self::Done,
            "unchanged" => Self::Unchanged,
            "ignored" => Self::Ignored,
            _ => Self::Missing,
        }
    }

    /// Whether the item has reached its end.
    #[must_use]
    pub fn finished(self) -> bool {
        matches!(
            self,
            Self::Done | Self::Unchanged | Self::Missing | Self::Ignored
        )
    }
}

/// An operation as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationRow {
    /// Its id.
    pub id: i64,
    /// The command that made it.
    pub command: String,
    /// What it does to each message.
    pub action: Action,
    /// The limit it counts against.
    pub kind: Kind,
    /// What the caller asked, as JSON: ids and booleans.
    pub asked: String,
    /// The operation it undoes.
    pub undo_of: Option<i64>,
    /// The operation that undoes it, if one was made.
    pub undone_by: Option<i64>,
    /// The selection it was made from.
    pub selection: Option<i64>,
    /// That selection's query, as its caller wrote it.
    pub query: Option<String>,
    /// Who made it.
    pub creator: Proposer,
    /// Where it stands.
    pub state: OperationState,
    /// Whether it was asked to stop after the batch in hand.
    pub stop_asked: bool,
    /// When it was made, in milliseconds.
    pub created_at: i64,
    /// When it last stopped or ended.
    pub ended_at: Option<i64>,
    /// The count it was made with.
    pub messages: u64,
    /// Why it stopped, in the engine's words.
    pub error: Option<String>,
    /// When it first ran; `None` for a proposal not yet approved.
    pub started_at: Option<i64>,
    /// Whether it counts against its creator's day of trash: a proposal
    /// does not, approved or not.
    pub charged: bool,
    /// The proposal open now, or the last one.
    pub proposal: Option<Proposal>,
}

/// A proposal of an operation (9.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proposal {
    /// Who proposed it.
    pub proposer: Proposer,
    /// When.
    pub proposed_at: i64,
    /// When it goes, if the person has not approved it.
    pub expires_at: i64,
    /// When the person approved it, if they have.
    pub approved_at: Option<i64>,
}

/// How many of an operation's items reached each end.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StepCounts {
    /// Not yet at an end.
    pub waiting: u64,
    /// Of those, part-way through a step: a copy asked for, a copy made
    /// whose original is not yet removed, or an original flagged to be.
    pub midway: u64,
    /// Changed.
    pub done: u64,
    /// Already as the change would leave them.
    pub unchanged: u64,
    /// Moved or gone before their batch ran.
    pub missing: u64,
    /// Not acted on by the provider.
    pub ignored: u64,
}

impl StepCounts {
    /// Every item.
    #[must_use]
    pub fn items(&self) -> u64 {
        self.waiting + self.done + self.unchanged + self.missing + self.ignored
    }
}

/// An item to make.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    /// The mailbox it is in.
    pub mailbox: i64,
    /// The mailbox's generation.
    pub validity: String,
    /// Its id there.
    pub provider_id: String,
    /// The message; `None` for one the provider never returned.
    pub message: Option<i64>,
    /// Where a copy or a move puts it, or the message a removed copy was
    /// made from.
    pub to_mailbox: Option<i64>,
    /// For a removed copy, the generation and id of what it was made from.
    pub to_validity: Option<String>,
    /// See `to_validity`.
    pub to_provider_id: Option<String>,
    /// What a change of flags sets, as JSON.
    pub flags_wanted: Option<String>,
    /// [`Step::Waiting`], or [`Step::Unchanged`] when it is known already.
    pub step: Step,
}

/// An operation to make.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewOperation {
    /// The command that makes it.
    pub command: String,
    /// What it does.
    pub action: Action,
    /// The limit it counts against.
    pub kind: Kind,
    /// What the caller asked, as JSON.
    pub asked: String,
    /// The operation it undoes.
    pub undo_of: Option<i64>,
    /// The selection it is made from.
    pub selection: Option<i64>,
    /// That selection's query.
    pub query: Option<String>,
    /// Who makes it.
    pub creator: Proposer,
    /// The count it is made with.
    pub messages: u64,
    /// What it acts on.
    pub items: Vec<NewItem>,
    /// Whether it is made as a proposal of its creator's, which waits for
    /// the person's approval.
    pub proposed: bool,
}

/// An item as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationItem {
    /// The mailbox it was in.
    pub mailbox: i64,
    /// That mailbox's generation.
    pub validity: String,
    /// Its id there.
    pub provider_id: String,
    /// The message, when the provider returned it.
    pub message: Option<i64>,
    /// Where it goes, or the message a removed copy was made from.
    pub to_mailbox: Option<i64>,
    /// The generation of `to_mailbox` its new id belongs to.
    pub to_validity: Option<String>,
    /// Its id there.
    pub to_provider_id: Option<String>,
    /// The destination's next id before the copy was asked for.
    pub to_mark: Option<String>,
    /// Its flags when its step ran.
    pub flags_before: Option<Vec<String>>,
    /// What a change of flags sets, as JSON.
    pub flags_wanted: Option<String>,
    /// The step it reached.
    pub step: Step,
}

/// A step an item reached, with what the provider showed on the way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemStep {
    /// Its id in the batch's mailbox.
    pub provider_id: String,
    /// The step.
    pub step: Step,
    /// Its flags before the change, when they were read.
    pub flags_before: Option<Vec<String>>,
    /// The destination's generation, when it is known.
    pub to_validity: Option<String>,
    /// Its id in the destination, when it is known.
    pub to_provider_id: Option<String>,
    /// The destination's next id before the copy.
    pub to_mark: Option<String>,
}

impl ItemStep {
    /// `step` and nothing else learned.
    #[must_use]
    pub fn only(provider_id: &str, step: Step) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            step,
            flags_before: None,
            to_validity: None,
            to_provider_id: None,
            to_mark: None,
        }
    }
}

/// An undo that ran, or runs: a proposed one has undone nothing.
const OPERATION_COLUMNS: &str = "id, command, action, kind, asked, undo_of,
    (SELECT max(undo.id) FROM operation AS undo
     WHERE undo.undo_of = operation.id AND undo.started_at IS NOT NULL),
    selection_id, query, creator_kind, creator_id, state, stop_asked, created_at, ended_at,
    messages, error, started_at, charged, proposer_kind, proposer_id, proposed_at, expires_at,
    approved_at";

fn operation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OperationRow> {
    Ok(OperationRow {
        id: row.get(0)?,
        command: row.get(1)?,
        action: Action::parse(&row.get::<_, String>(2)?),
        kind: if row.get::<_, String>(3)? == "trash" {
            Kind::Trash
        } else {
            Kind::Change
        },
        asked: row.get(4)?,
        undo_of: row.get(5)?,
        undone_by: row.get(6)?,
        selection: row.get(7)?,
        query: row.get(8)?,
        creator: Proposer {
            kind: row.get(9)?,
            id: row.get(10)?,
        },
        state: OperationState::parse(&row.get::<_, String>(11)?),
        stop_asked: row.get(12)?,
        created_at: row.get(13)?,
        ended_at: row.get(14)?,
        messages: count(row.get(15)?),
        error: row.get(16)?,
        started_at: row.get(17)?,
        charged: row.get(18)?,
        proposal: match (
            row.get::<_, Option<String>>(19)?,
            row.get(21)?,
            row.get(22)?,
        ) {
            (Some(kind), Some(proposed_at), Some(expires_at)) => Some(Proposal {
                proposer: Proposer {
                    kind,
                    id: row.get(20)?,
                },
                proposed_at,
                expires_at,
                approved_at: row.get(23)?,
            }),
            _ => None,
        },
    })
}

const ITEM_COLUMNS: &str = "mailbox_id, validity, provider_id, message_id, to_mailbox_id,
    to_validity, to_provider_id, to_mark, flags_before, flags_wanted, step";

fn item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OperationItem> {
    let flags_before: Option<String> = row.get(8)?;
    Ok(OperationItem {
        mailbox: row.get(0)?,
        validity: row.get(1)?,
        provider_id: row.get(2)?,
        message: row.get(3)?,
        to_mailbox: row.get(4)?,
        to_validity: row.get(5)?,
        to_provider_id: row.get(6)?,
        to_mark: row.get(7)?,
        flags_before: flags_before.and_then(|flags| serde_json::from_str(&flags).ok()),
        flags_wanted: row.get(9)?,
        step: Step::parse(&row.get::<_, String>(10)?),
    })
}

/// The steps an item has not finished at, as SQL.
const OPEN_STEPS: &str = "('waiting', 'copying', 'copied', 'flagged')";

/// The flags `before` with each flag of `wanted`, a JSON object of flags and
/// whether each is set, set or cleared.
#[must_use]
pub fn flags_after(before: &[String], wanted: &str) -> Vec<String> {
    let wanted: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(wanted).unwrap_or_default();
    let mut after: Vec<String> = before
        .iter()
        .filter(|flag| !wanted.contains_key(flag.as_str()))
        .cloned()
        .collect();
    for (flag, on) in &wanted {
        if on.as_bool() == Some(true) {
            after.push(flag.clone());
        }
    }
    after.sort_unstable();
    after.dedup();
    after
}

impl Store {
    /// Makes an operation in the state `running`, with its items.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn create_operation(
        &mut self,
        operation: &NewOperation,
        now: i64,
    ) -> Result<OperationRow, StoreError> {
        let transaction = self.connection.transaction()?;
        let proposed = operation.proposed;
        let (state, started_at) = if proposed {
            (OperationState::Proposed, None)
        } else {
            (OperationState::Running, Some(now))
        };
        transaction.execute(
            "INSERT INTO operation (command, action, kind, asked, undo_of, selection_id, query,
                                    creator_kind, creator_id, state, created_at, messages,
                                    started_at, charged, proposer_kind, proposer_id, proposed_at,
                                    expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                     ?18)",
            params![
                operation.command,
                operation.action.as_str(),
                operation.kind.as_str(),
                operation.asked,
                operation.undo_of,
                operation.selection,
                operation.query,
                operation.creator.kind,
                operation.creator.id,
                state.as_str(),
                now,
                i64::try_from(operation.messages).unwrap_or(i64::MAX),
                started_at,
                !proposed,
                proposed.then_some(&operation.creator.kind),
                if proposed {
                    operation.creator.id.as_deref()
                } else {
                    None
                },
                proposed.then_some(now),
                proposed.then_some(now + PROPOSAL_LIFETIME),
            ],
        )?;
        let id = transaction.last_insert_rowid();
        {
            let mut keep = transaction.prepare(
                "INSERT INTO operation_item
                     (operation_id, mailbox_id, validity, provider_id, message_id, to_mailbox_id,
                      to_validity, to_provider_id, flags_wanted, step)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT DO NOTHING",
            )?;
            for item in &operation.items {
                keep.execute(params![
                    id,
                    item.mailbox,
                    item.validity,
                    item.provider_id,
                    item.message,
                    item.to_mailbox,
                    item.to_validity,
                    item.to_provider_id,
                    item.flags_wanted,
                    item.step.as_str(),
                ])?;
            }
        }
        let row = transaction.query_row(
            &format!("SELECT {OPERATION_COLUMNS} FROM operation WHERE id = ?1"),
            [id],
            operation_row,
        )?;
        transaction.commit()?;
        Ok(row)
    }

    /// Operation `id`, if there is one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation(&self, id: i64) -> Result<Option<OperationRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {OPERATION_COLUMNS} FROM operation WHERE id = ?1"),
                [id],
                operation_row,
            )
            .optional()?)
    }

    /// The operations made before the one with id `before`, newest first,
    /// at most `limit`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operations(
        &self,
        before: Option<i64>,
        limit: u32,
    ) -> Result<Vec<OperationRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {OPERATION_COLUMNS} FROM operation WHERE id < ?1 ORDER BY id DESC LIMIT ?2"
        ))?;
        let rows =
            statement.query_map(params![before.unwrap_or(i64::MAX), limit], operation_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// The proposals waiting, the most recently proposed first, after the
    /// one proposed at `before` (its time and id), at most `limit`. A resume
    /// proposed keeps its operation's older id, so they are ordered by when
    /// they were proposed.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn proposals(
        &self,
        before: Option<(i64, i64)>,
        limit: u32,
    ) -> Result<Vec<OperationRow>, StoreError> {
        let (at, id) = before.unwrap_or((i64::MAX, i64::MAX));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {OPERATION_COLUMNS} FROM operation
             WHERE state = 'proposed' AND (proposed_at, id) < (?1, ?2)
             ORDER BY proposed_at DESC, id DESC LIMIT ?3"
        ))?;
        let rows = statement.query_map(params![at, id, limit], operation_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// How many of operation `id`'s items reached each end.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_counts(&self, id: i64) -> Result<StepCounts, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT step, count(*) FROM operation_item WHERE operation_id = ?1 GROUP BY step",
        )?;
        let mut counts = StepCounts::default();
        let rows = statement.query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, count(row.get(1)?)))
        })?;
        for row in rows {
            let (step, n) = row?;
            match Step::parse(&step) {
                Step::Done => counts.done += n,
                Step::Unchanged => counts.unchanged += n,
                Step::Missing => counts.missing += n,
                Step::Ignored => counts.ignored += n,
                Step::Waiting => counts.waiting += n,
                Step::Copying | Step::Copied | Step::Flagged => {
                    counts.waiting += n;
                    counts.midway += n;
                }
            }
        }
        Ok(counts)
    }

    /// Operation `id`'s items after the place `after`, in order, at most
    /// `limit`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_items(
        &self,
        id: i64,
        after: Option<(i64, &str, &str)>,
        limit: u32,
    ) -> Result<Vec<OperationItem>, StoreError> {
        let (mailbox, validity, provider_id) = after.unwrap_or((i64::MIN, "", ""));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {ITEM_COLUMNS} FROM operation_item
             WHERE operation_id = ?1 AND (mailbox_id, validity, provider_id) > (?2, ?3, ?4)
             ORDER BY mailbox_id, validity, provider_id LIMIT ?5"
        ))?;
        let rows =
            statement.query_map(params![id, mailbox, validity, provider_id, limit], item_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Operation `id`'s items that were changed, which an undo puts back.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_done_items(&self, id: i64) -> Result<Vec<OperationItem>, StoreError> {
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {ITEM_COLUMNS} FROM operation_item
             WHERE operation_id = ?1 AND step = 'done'
             ORDER BY mailbox_id, validity, provider_id"
        ))?;
        let rows = statement.query_map([id], item_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// How many messages `creator` set out to move to the trash since
    /// `since`, in operations it made: not in its proposals, approved or not
    /// (9.4).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn trashed_since(&self, creator: &Proposer, since: i64) -> Result<u64, StoreError> {
        Ok(count(self.connection.query_row(
            "SELECT coalesce(sum(messages), 0) FROM operation
             WHERE kind = 'trash' AND creator_kind = ?1 AND creator_id IS ?2
               AND created_at > ?3 AND charged = 1",
            params![creator.kind, creator.id, since],
            |row| row.get(0),
        )?))
    }

    /// The next batch of operation `id`: up to `limit` items not yet at an
    /// end, all in one mailbox and its generation, going to one place.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_batch(&self, id: i64, limit: u32) -> Result<Vec<OperationItem>, StoreError> {
        let first: Option<(i64, String, Option<i64>)> = self
            .connection
            .query_row(
                &format!(
                    "SELECT mailbox_id, validity, to_mailbox_id FROM operation_item
                     WHERE operation_id = ?1 AND step IN {OPEN_STEPS}
                     ORDER BY mailbox_id, to_mailbox_id LIMIT 1"
                ),
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((mailbox, validity, to)) = first else {
            return Ok(Vec::new());
        };
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {ITEM_COLUMNS} FROM operation_item
             WHERE operation_id = ?1 AND step IN {OPEN_STEPS}
               AND mailbox_id = ?2 AND validity = ?3 AND to_mailbox_id IS ?4
             ORDER BY mailbox_id, to_mailbox_id, provider_id LIMIT ?5"
        ))?;
        let rows = statement.query_map(params![id, mailbox, validity, to, limit], item_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Records the steps the items of operation `id` in `mailbox` and its
    /// generation `validity` reached. An item that is done changes what the
    /// store shows, as the next pass would find it.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when there is no such operation.
    pub fn record_steps(
        &mut self,
        id: i64,
        mailbox: i64,
        validity: &str,
        steps: &[ItemStep],
        now: i64,
    ) -> Result<(), StoreError> {
        if steps.is_empty() {
            return Ok(());
        }
        let transaction = self.connection.transaction()?;
        let action: String = transaction
            .query_row("SELECT action FROM operation WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .optional()?
            .ok_or(StoreError::NotFound("operation"))?;
        let action = Action::parse(&action);
        let mut touched = Touched::new(rebuild_cursor(&transaction)?);
        for step in steps {
            let flags_before = step.flags_before.as_deref().map(flags_json);
            transaction.run(
                "UPDATE operation_item SET step = ?5,
                     flags_before = coalesce(?6, flags_before),
                     to_validity = coalesce(?7, to_validity),
                     to_provider_id = coalesce(?8, to_provider_id),
                     to_mark = coalesce(?9, to_mark)
                 WHERE operation_id = ?1 AND mailbox_id = ?2 AND validity = ?3
                   AND provider_id = ?4",
                params![
                    id,
                    mailbox,
                    validity,
                    step.provider_id,
                    step.step.as_str(),
                    flags_before,
                    step.to_validity,
                    step.to_provider_id,
                    step.to_mark,
                ],
            )?;
            if step.step == Step::Done {
                let item = transaction.one(
                    &format!(
                        "SELECT {ITEM_COLUMNS} FROM operation_item
                         WHERE operation_id = ?1 AND mailbox_id = ?2 AND validity = ?3
                           AND provider_id = ?4"
                    ),
                    params![id, mailbox, validity, step.provider_id],
                    item_row,
                )?;
                show_done(&transaction, action, &item, now, &mut touched)?;
            }
        }
        settle(&transaction, &touched, now)?;
        transaction.commit()?;
        Ok(())
    }

    /// Sets operation `id`'s state, and why it stopped.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn set_operation_state(
        &mut self,
        id: i64,
        state: OperationState,
        error: Option<&str>,
        now: i64,
    ) -> Result<(), StoreError> {
        let ended = (state != OperationState::Running).then_some(now);
        self.connection.execute(
            "UPDATE operation SET state = ?2, error = ?3, ended_at = coalesce(?4, ended_at),
                                  stop_asked = CASE WHEN ?2 = 'running' THEN 0 ELSE stop_asked END
             WHERE id = ?1",
            params![id, state.as_str(), error, ended],
        )?;
        Ok(())
    }

    /// Asks operation `id` to stop after the batch in hand. Returns whether
    /// it was running.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn ask_operation_stop(&mut self, id: i64) -> Result<bool, StoreError> {
        Ok(self.connection.execute(
            "UPDATE operation SET stop_asked = 1 WHERE id = ?1 AND state = 'running'",
            [id],
        )? > 0)
    }

    /// Marks every operation the store says is running as stopped: the
    /// process that ran it is gone, since this one owns the store now.
    ///
    /// # Errors
    /// When the database refuses.
    pub(super) fn stop_interrupted_operations(
        connection: &rusqlite::Connection,
        now: i64,
    ) -> Result<(), StoreError> {
        connection.execute(
            "UPDATE operation SET state = 'stopped', ended_at = ?1,
                 error = coalesce(error, 'the program stopped while it ran')
             WHERE state = 'running'",
            [now],
        )?;
        Ok(())
    }

    /// Where the messages `messages` show now, outside junk and trash, as a
    /// selection that names no mailbox would hold them: each copy in each
    /// mailbox, in order.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn shown_items(&self, messages: &[i64]) -> Result<Vec<SelectionItem>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT observation.mailbox_id, observation.validity, observation.provider_id
             FROM observation JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE observation.message_id = ?1 AND observation.ended_at IS NULL
               AND mailbox.gone_at IS NULL AND observation.validity = mailbox.validity
               AND mailbox.role NOT IN ('junk', 'trash')",
        )?;
        let mut items = Vec::new();
        for message in messages {
            let rows = statement.query_map([message], |row| {
                Ok(SelectionItem {
                    mailbox: row.get(0)?,
                    validity: row.get(1)?,
                    provider_id: row.get(2)?,
                    message: Some(*message),
                })
            })?;
            for row in rows {
                items.push(row?);
            }
        }
        items.sort();
        items.dedup();
        Ok(items)
    }

    /// How many operations are running, stopped before their end, and
    /// proposed and waiting for the person.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn operation_states(&self) -> Result<OperationStates, StoreError> {
        Ok(self.connection.query_row(
            "SELECT count(*) FILTER (WHERE state = 'running'),
                    count(*) FILTER (WHERE state = 'stopped'),
                    count(*) FILTER (WHERE state = 'proposed')
             FROM operation",
            [],
            |row| {
                Ok(OperationStates {
                    running: count(row.get(0)?),
                    stopped: count(row.get(1)?),
                    proposed: count(row.get(2)?),
                })
            },
        )?)
    }

    /// How many proposals `proposer` has waiting.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn proposals_waiting(&self, proposer: &Proposer) -> Result<u64, StoreError> {
        Ok(count(self.connection.query_row(
            "SELECT count(*) FROM operation
             WHERE state = 'proposed' AND proposer_kind = ?1 AND proposer_id IS ?2",
            params![proposer.kind, proposer.id],
            |row| row.get(0),
        )?))
    }

    /// Proposes that stopped operation `id` be carried on, by `proposer`.
    /// Returns whether it was stopped.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn propose_resume(
        &mut self,
        id: i64,
        proposer: &Proposer,
        now: i64,
    ) -> Result<bool, StoreError> {
        Ok(self.connection.execute(
            "UPDATE operation SET state = 'proposed', proposer_kind = ?2, proposer_id = ?3,
                                  proposed_at = ?4, expires_at = ?5, approved_at = NULL
             WHERE id = ?1 AND state = 'stopped'",
            params![id, proposer.kind, proposer.id, now, now + PROPOSAL_LIFETIME],
        )? > 0)
    }

    /// Approves proposal `id`: it runs from now, as the person's. Returns
    /// whether it was open.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn approve_proposal(&mut self, id: i64, now: i64) -> Result<bool, StoreError> {
        Ok(self.connection.execute(
            "UPDATE operation SET state = 'running', started_at = coalesce(started_at, ?2),
                                  approved_at = ?2, stop_asked = 0, error = NULL
             WHERE id = ?1 AND state = 'proposed' AND expires_at > ?2",
            params![id, now],
        )? > 0)
    }

    /// Dismisses proposal `id`. A change that never ran is `dismissed` and
    /// its items dropped; a stopped operation proposed to be carried on is
    /// stopped again. Returns its state after, or `None` when it was not
    /// open.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn dismiss_proposal(
        &mut self,
        id: i64,
        now: i64,
    ) -> Result<Option<OperationState>, StoreError> {
        let transaction = self.connection.transaction()?;
        let state: Option<String> = transaction
            .query_row(
                "UPDATE operation
                 SET state = CASE WHEN started_at IS NULL THEN 'dismissed' ELSE 'stopped' END,
                     -- A stopped operation keeps when its run stopped.
                     ended_at = CASE WHEN started_at IS NULL THEN ?2 ELSE ended_at END
                 WHERE id = ?1 AND state = 'proposed'
                 RETURNING state",
                params![id, now],
                |row| row.get(0),
            )
            .optional()?;
        transaction.execute(
            "DELETE FROM operation_item WHERE operation_id = ?1
               AND (SELECT state FROM operation WHERE id = ?1) = 'dismissed'",
            [id],
        )?;
        transaction.commit()?;
        Ok(state.as_deref().map(OperationState::parse))
    }

    /// Ends the proposals that waited past their seven days: a change that
    /// never ran is `expired` and its items dropped; a stopped operation
    /// proposed to be carried on is stopped again. Returns how many ended.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn expire_proposals(&mut self, now: i64) -> Result<u64, StoreError> {
        let transaction = self.connection.transaction()?;
        let ended = expire_proposals(&transaction, now)?;
        transaction.commit()?;
        Ok(ended)
    }

    /// [`Store::expire_proposals`] on `connection`, for the store's opening.
    pub(super) fn expire_proposals_on(
        connection: &rusqlite::Connection,
        now: i64,
    ) -> Result<(), StoreError> {
        expire_proposals(connection, now).map(|_| ())
    }

    /// The undo of operation `id` that waits for the person, if one does.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn undo_proposed(&self, id: i64) -> Result<Option<i64>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT max(id) FROM operation WHERE undo_of = ?1 AND state = 'proposed'",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .flatten())
    }

    /// What the person reads before approving proposal `id`: where the
    /// messages it would act on are, and their classes, counting the items
    /// it has not finished.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn proposal_preview(&self, id: i64) -> Result<ProposalPreview, StoreError> {
        let mut preview = ProposalPreview::default();
        {
            let mut statement = self.connection.prepare_cached(&format!(
                "SELECT mailbox.id, mailbox.account_id, account.provider, mailbox.role,
                        mailbox.name, count(*)
                 FROM operation_item
                 JOIN mailbox ON mailbox.id = operation_item.mailbox_id
                 JOIN account ON account.id = mailbox.account_id
                 WHERE operation_item.operation_id = ?1 AND operation_item.step IN {OPEN_STEPS}
                 GROUP BY mailbox.id ORDER BY 6 DESC, 1"
            ))?;
            let rows = statement.query_map([id], |row| {
                Ok(PlacesIn {
                    mailbox: row.get(0)?,
                    account: row.get(1)?,
                    provider: row.get(2)?,
                    role: Role::parse(&row.get::<_, String>(3)?).unwrap_or(Role::None),
                    name: row.get(4)?,
                    places: count(row.get(5)?),
                })
            })?;
            for row in rows {
                preview.mailboxes.push(row?);
            }
        }
        {
            let mut statement = self.connection.prepare_cached(&format!(
                "SELECT mailbox.id, mailbox.account_id, account.provider, mailbox.role,
                        mailbox.name, count(*)
                 FROM operation_item
                 JOIN mailbox ON mailbox.id = operation_item.to_mailbox_id
                 JOIN account ON account.id = mailbox.account_id
                 JOIN operation ON operation.id = operation_item.operation_id
                 WHERE operation_item.operation_id = ?1 AND operation_item.step IN {OPEN_STEPS}
                   AND operation.action IN ('move', 'copy')
                 GROUP BY mailbox.id ORDER BY 6 DESC, 1"
            ))?;
            let rows = statement.query_map([id], |row| {
                Ok(PlacesIn {
                    mailbox: row.get(0)?,
                    account: row.get(1)?,
                    provider: row.get(2)?,
                    role: Role::parse(&row.get::<_, String>(3)?).unwrap_or(Role::None),
                    name: row.get(4)?,
                    places: count(row.get(5)?),
                })
            })?;
            for row in rows {
                preview.destinations.push(row?);
            }
        }
        // Each message once, however many places it has. One that is not
        // inbound, from one of the person's own addresses, has no class.
        let messages = format!(
            "(SELECT DISTINCT message_id FROM operation_item
              WHERE operation_id = ?1 AND step IN {OPEN_STEPS} AND message_id IS NOT NULL)
             AS named"
        );
        {
            let mut statement = self.connection.prepare_cached(&format!(
                "SELECT coalesce(screening.class, 'own'), count(*) FROM {messages}
                 LEFT JOIN screening ON screening.message_id = named.message_id
                 GROUP BY 1 ORDER BY 1"
            ))?;
            let rows = statement.query_map([id], |row| {
                Ok((row.get::<_, String>(0)?, count(row.get(1)?)))
            })?;
            for row in rows {
                preview.classes.push(row?);
            }
        }
        (preview.known_messages, preview.known_senders) = self.connection.query_row(
            &format!(
                "SELECT count(*), count(DISTINCT screening.sender_address) FROM {messages}
                 JOIN screening ON screening.message_id = named.message_id
                 WHERE screening.class = 'known'"
            ),
            [id],
            |row| Ok((count(row.get(0)?), count(row.get(1)?))),
        )?;
        preview.unreturned = count(self.connection.query_row(
            &format!(
                "SELECT count(*) FROM operation_item
                 WHERE operation_id = ?1 AND step IN {OPEN_STEPS} AND message_id IS NULL"
            ),
            [id],
            |row| row.get(0),
        )?);
        Ok(preview)
    }
}

/// [`Store::expire_proposals`], inside a transaction or at the opening.
fn expire_proposals(connection: &rusqlite::Connection, now: i64) -> Result<u64, StoreError> {
    let ended = connection.execute(
        "UPDATE operation
         SET state = CASE WHEN started_at IS NULL THEN 'expired' ELSE 'stopped' END,
             ended_at = CASE WHEN started_at IS NULL THEN expires_at ELSE ended_at END
         WHERE state = 'proposed' AND expires_at <= ?1",
        [now],
    )?;
    if ended > 0 {
        connection.execute(
            "DELETE FROM operation_item WHERE operation_id IN
                 (SELECT id FROM operation WHERE state = 'expired')",
            [],
        )?;
    }
    Ok(ended as u64)
}

/// How many operations are in each state that waits for something.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OperationStates {
    /// Running now.
    pub running: u64,
    /// Stopped before their end, and resumable.
    pub stopped: u64,
    /// Proposed, and waiting for the person.
    pub proposed: u64,
}

/// A mailbox and how many of a proposal's places are in it, or go to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlacesIn {
    /// The mailbox.
    pub mailbox: i64,
    /// Its account.
    pub account: i64,
    /// The account's provider.
    pub provider: String,
    /// Its role.
    pub role: Role,
    /// Its name, as the provider writes it: content (12.1).
    pub name: String,
    /// How many places.
    pub places: u64,
}

/// What the person reads before approving a proposal (9.4).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProposalPreview {
    /// The mailboxes its places are in, the most first.
    pub mailboxes: Vec<PlacesIn>,
    /// The mailboxes a move or a copy puts them in.
    pub destinations: Vec<PlacesIn>,
    /// How many of its messages are in each screening class, by name;
    /// `own` for the person's own mail, which has none.
    pub classes: Vec<(String, u64)>,
    /// How many of its messages come from senders the person knows.
    pub known_messages: u64,
    /// How many such senders.
    pub known_senders: u64,
    /// How many of its places are messages the provider never returned.
    pub unreturned: u64,
}

/// Changes what the store shows for an item that is done, as the next pass
/// of sync would find it.
fn show_done(
    transaction: &Transaction<'_>,
    action: Action,
    item: &OperationItem,
    now: i64,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    match action {
        Action::Move => {
            let internal_date = end_shown(transaction, item, now, touched)?;
            transaction.run(
                "DELETE FROM unreturned
                 WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3",
                params![item.mailbox, item.validity, item.provider_id],
            )?;
            show_copy(transaction, item, internal_date, now, touched)?;
        }
        Action::Copy => {
            let internal_date: Option<i64> = transaction
                .one(
                    "SELECT internal_date FROM observation
                     WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3
                     ORDER BY id DESC LIMIT 1",
                    params![item.mailbox, item.validity, item.provider_id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            show_copy(transaction, item, internal_date, now, touched)?;
        }
        Action::Remove => {
            end_shown(transaction, item, now, touched)?;
        }
        Action::Flags => {
            let (Some(before), Some(wanted)) = (&item.flags_before, &item.flags_wanted) else {
                return Ok(());
            };
            let flags = flags_json(&flags_after(before, wanted));
            let current: Option<(i64, i64, String)> = transaction
                .one(
                    "SELECT id, message_id, flags FROM observation
                     WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3
                       AND ended_at IS NULL",
                    params![item.mailbox, item.validity, item.provider_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let Some((observation, message, had)) = current else {
                return Ok(());
            };
            if had == flags {
                return Ok(());
            }
            transaction.run(
                "UPDATE observation SET ended_at = ?2, ended_by = 'superseded' WHERE id = ?1",
                params![observation, now],
            )?;
            transaction.run(
                "INSERT INTO observation
                     (message_id, mailbox_id, validity, provider_id, provider_thread, flags,
                      internal_date, seen_at)
                 SELECT message_id, mailbox_id, validity, provider_id, provider_thread, ?2,
                        internal_date, ?3
                 FROM observation WHERE id = ?1",
                params![observation, flags, now],
            )?;
            note_change(
                transaction,
                now,
                "observation",
                transaction.last_insert_rowid(),
            )?;
            touch_place(transaction, item.mailbox, message, touched)?;
        }
    }
    Ok(())
}

/// Ends what the item's mailbox showed at its place, as removed, and returns
/// the date the provider gave the message there.
fn end_shown(
    transaction: &Transaction<'_>,
    item: &OperationItem,
    now: i64,
    touched: &mut Touched,
) -> Result<Option<i64>, StoreError> {
    let ended: Option<(i64, i64, Option<i64>)> = transaction
        .one(
            "UPDATE observation SET ended_at = ?4, ended_by = 'removed'
             WHERE mailbox_id = ?1 AND validity = ?2 AND provider_id = ?3 AND ended_at IS NULL
             RETURNING id, message_id, internal_date",
            params![item.mailbox, item.validity, item.provider_id, now],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((observation, message, internal_date)) = ended else {
        return Ok(None);
    };
    note_change(transaction, now, "observation-ended", observation)?;
    touch_place(transaction, item.mailbox, message, touched)?;
    Ok(internal_date)
}

/// Shows the item's message in the mailbox it was copied or moved to, at
/// the id the provider gave it there, unless the store knows that mailbox
/// by another generation now, or shows something there already: the next
/// pass then finds it.
fn show_copy(
    transaction: &Transaction<'_>,
    item: &OperationItem,
    internal_date: Option<i64>,
    now: i64,
    touched: &mut Touched,
) -> Result<(), StoreError> {
    let (Some(message), Some(to), Some(validity), Some(provider_id)) = (
        item.message,
        item.to_mailbox,
        item.to_validity.as_deref(),
        item.to_provider_id.as_deref(),
    ) else {
        return Ok(());
    };
    let known: Option<String> = transaction
        .one("SELECT validity FROM mailbox WHERE id = ?1", [to], |row| {
            row.get(0)
        })
        .optional()?;
    if known.as_deref() != Some(validity) {
        return Ok(());
    }
    let flags = flags_json(item.flags_before.as_deref().unwrap_or_default());
    let added = transaction.run(
        "INSERT INTO observation
             (message_id, mailbox_id, validity, provider_id, provider_thread, flags,
              internal_date, seen_at)
         SELECT ?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7
         WHERE NOT EXISTS (SELECT 1 FROM observation
                           WHERE mailbox_id = ?2 AND validity = ?3 AND provider_id = ?4
                             AND ended_at IS NULL)",
        params![
            message,
            to,
            validity,
            provider_id,
            flags,
            internal_date,
            now
        ],
    )?;
    if added > 0 {
        note_change(
            transaction,
            now,
            "observation",
            transaction.last_insert_rowid(),
        )?;
        super::senders::observed(transaction, to, message, touched)?;
        touch_place(transaction, to, message, touched)?;
    }
    Ok(())
}
