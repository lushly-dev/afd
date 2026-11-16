//! The person's decisions on senders and agents' suggestions of them (the
//! specification's 7.3). Neither is derived: both survive a rebuild.
//!
//! A decision is the person's alone: in, out, or that the address is theirs.
//! An agent can only suggest in or out; a suggestion changes no class until
//! the person accepts it. A decision the person makes on an address closes
//! every suggestion still open for it, as superseded: the question is
//! answered.

use std::collections::BTreeSet;

use rusqlite::{OptionalExtension, Transaction, params};

use super::classes::{self, Reclassify};
use super::senders::{self, sender_id};
use super::{Kept, Store, StoreError, count, note_change};

/// A decision on an address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Screened in: its mail is `known`.
    In,
    /// Screened out: its mail is `blocked`.
    Out,
    /// The address is the person's own: its mail is not inbound.
    Mine,
}

impl Decision {
    /// The decision as the store and results write it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::In => "in",
            Self::Out => "out",
            Self::Mine => "mine",
        }
    }

    /// The decision written `text`, if it is one.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        [Self::In, Self::Out, Self::Mine]
            .into_iter()
            .find(|decision| decision.as_str() == text)
    }
}

/// A decision as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionRow {
    /// The address, in lower case. From a message, or typed by the person.
    pub address: String,
    /// Its sender id.
    pub sender: i64,
    /// The decision.
    pub decision: Decision,
    /// When the person made it, in milliseconds.
    pub decided_at: i64,
    /// The suggestion the person accepted, when it came from one.
    pub suggestion: Option<i64>,
}

/// Who proposed a suggestion: the kind of caller (`agent`, `human`,
/// `script`, as the `afd` crate names an actor), and the agent's token id
/// when it came with one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proposer {
    /// The kind of caller.
    pub kind: String,
    /// The token's id, for an agent that presented one.
    pub id: Option<String>,
}

/// Where a suggestion stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionState {
    /// Waiting for the person.
    Open,
    /// The person accepted it.
    Accepted,
    /// The person or its proposer dropped it.
    Dismissed,
    /// The person decided on the sender themselves, or its proposer
    /// suggested again.
    Superseded,
}

impl SuggestionState {
    /// The state as the store and results write it.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
            Self::Superseded => "superseded",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "open" => Self::Open,
            "accepted" => Self::Accepted,
            "dismissed" => Self::Dismissed,
            _ => Self::Superseded,
        }
    }
}

/// A suggestion as the store keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuggestionRow {
    /// Its id.
    pub id: i64,
    /// The address it is about, in lower case. From a message.
    pub address: String,
    /// Its sender id.
    pub sender: i64,
    /// What it suggests: in or out.
    pub decision: Decision,
    /// Who proposed it.
    pub proposer: Proposer,
    /// When, in milliseconds.
    pub created_at: i64,
    /// Where it stands.
    pub state: SuggestionState,
    /// When it was closed.
    pub closed_at: Option<i64>,
}

/// What a decision changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decided {
    /// The decision before, to put back to undo it.
    pub previous: Option<Decision>,
    /// How many held messages changed class, or gained or lost one.
    pub changed: u64,
}

/// A block, with the suggestion it came from when it came from one.
pub type Blocked = (DecisionRow, Option<SuggestionRow>);

/// Why a suggestion was not stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suggested {
    /// Stored, with this id.
    Stored(i64),
    /// The proposer has this many waiting already.
    TooMany(u32),
}

const SUGGESTION_COLUMNS: &str =
    "id, address, decision, proposer_kind, proposer_id, created_at, state, closed_at";

fn suggestion_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SuggestionRow> {
    let address: String = row.get(1)?;
    let decision: String = row.get(2)?;
    let state: String = row.get(6)?;
    Ok(SuggestionRow {
        id: row.get(0)?,
        sender: sender_id(&address),
        address,
        decision: Decision::parse(&decision).unwrap_or(Decision::In),
        proposer: Proposer {
            kind: row.get(3)?,
            id: row.get(4)?,
        },
        created_at: row.get(5)?,
        state: SuggestionState::parse(&state),
        closed_at: row.get(7)?,
    })
}

fn decision_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DecisionRow> {
    let decision: String = row.get(2)?;
    Ok(DecisionRow {
        address: row.get(0)?,
        sender: row.get(1)?,
        decision: Decision::parse(&decision).unwrap_or(Decision::In),
        decided_at: row.get(3)?,
        suggestion: row.get(4)?,
    })
}

const DECISION_COLUMNS: &str = "address, id, decision, decided_at, suggestion";

/// How many of a sender's messages are not in a class (`?2`, or any class
/// for null).
pub(super) const WOULD_CHANGE: &str =
    "SELECT count(*) FROM screening WHERE sender_address = ?1 AND class IS NOT ?2";

/// The latest blocks since `?1`, at most `?2`.
pub(super) fn blocked_sql() -> String {
    format!(
        "SELECT {DECISION_COLUMNS} FROM sender_decision
         WHERE decision = 'out' AND decided_at >= ?1
         ORDER BY decided_at DESC, address LIMIT ?2"
    )
}

/// Records `decision` on `address`, or removes the one there (`None`), and
/// classes the address's mail again. `accepted` is the suggestion the
/// person accepted, which is closed as accepted; every other open one for
/// the address is closed as superseded.
fn decide_in(
    transaction: &Transaction<'_>,
    address: &str,
    decision: Option<Decision>,
    accepted: Option<i64>,
    now: i64,
) -> Result<Decided, StoreError> {
    let previous: Option<String> = transaction
        .one(
            "SELECT decision FROM sender_decision WHERE address = ?1",
            [address],
            |row| row.get(0),
        )
        .optional()?;
    let previous = previous.as_deref().and_then(Decision::parse);
    match decision {
        Some(decision) => {
            transaction.run(
                "INSERT INTO sender_decision (address, id, decision, decided_at, suggestion)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (address) DO UPDATE SET decision = excluded.decision,
                     decided_at = excluded.decided_at, suggestion = excluded.suggestion",
                params![
                    address,
                    sender_id(address),
                    decision.as_str(),
                    now,
                    accepted
                ],
            )?;
        }
        None => {
            transaction.run("DELETE FROM sender_decision WHERE address = ?1", [address])?;
        }
    }
    if let Some(accepted) = accepted {
        transaction.run(
            "UPDATE sender_suggestion SET state = 'accepted', closed_at = ?2
             WHERE id = ?1 AND state = 'open'",
            params![accepted, now],
        )?;
        note_change(transaction, now, "suggestion", accepted)?;
    }
    let superseded: Vec<i64> = {
        let mut statement = transaction.prepare_cached(
            "UPDATE sender_suggestion SET state = 'superseded', closed_at = ?2
             WHERE address = ?1 AND state = 'open' RETURNING id",
        )?;
        statement
            .query_map(params![address, now], |row| row.get(0))?
            .collect::<Result<_, _>>()?
    };
    for id in superseded {
        note_change(transaction, now, "suggestion", id)?;
    }
    // A decision that the address is the person's, or no longer is,
    // removes its sender row or makes it again.
    let mut turned =
        senders::settle_senders(transaction, &BTreeSet::from([address.to_string()]), now)?;
    turned.insert(address.to_string());
    let changed = classes::settle(
        transaction,
        &Reclassify {
            senders: Some(&turned),
            ..Default::default()
        },
        now,
    )?;
    note_change(transaction, now, "sender", sender_id(address))?;
    Ok(Decided { previous, changed })
}

impl Store {
    /// The person's decision on `address`, if there is one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn decision(&self, address: &str) -> Result<Option<DecisionRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {DECISION_COLUMNS} FROM sender_decision WHERE address = ?1"),
                [address],
                decision_row,
            )
            .optional()?)
    }

    /// The person's decision on the address with sender id `sender`, for an
    /// address with no sender row: one the person said is theirs.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn decision_by_sender(&self, sender: i64) -> Result<Option<DecisionRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!(
                    "SELECT {DECISION_COLUMNS} FROM sender_decision WHERE id = ?1
                     ORDER BY address LIMIT 1"
                ),
                [sender],
                decision_row,
            )
            .optional()?)
    }

    /// Whether `address` is one of the person's own: by their accounts,
    /// their sent mail, or a decision of theirs.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn is_own(&self, address: &str) -> Result<bool, StoreError> {
        Ok(senders::own_addresses(&self.connection)?.contains(address))
    }

    /// Whether `address` is the person's by their accounts or their sent
    /// mail, not by a decision of theirs.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn is_own_by_mail(&self, address: &str) -> Result<bool, StoreError> {
        Ok(senders::own_by_mail(&self.connection)?.contains(address))
    }

    /// Records the person's decision on `address` (in lower case), or
    /// removes it with `None`, and classes its mail again.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn decide(
        &mut self,
        address: &str,
        decision: Option<Decision>,
        now: i64,
    ) -> Result<Decided, StoreError> {
        let transaction = self.connection.transaction()?;
        let decided = decide_in(&transaction, address, decision, None, now)?;
        transaction.commit()?;
        Ok(decided)
    }

    /// Accepts suggestion `id`: its decision becomes the person's. `None`
    /// when it is not open.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn accept(
        &mut self,
        id: i64,
        now: i64,
    ) -> Result<Option<(SuggestionRow, Decided)>, StoreError> {
        let transaction = self.connection.transaction()?;
        let row = transaction
            .query_row(
                &format!("SELECT {SUGGESTION_COLUMNS} FROM sender_suggestion WHERE id = ?1"),
                [id],
                suggestion_row,
            )
            .optional()?;
        let Some(row) = row.filter(|row| row.state == SuggestionState::Open) else {
            return Ok(None);
        };
        let decided = decide_in(
            &transaction,
            &row.address,
            Some(row.decision),
            Some(id),
            now,
        )?;
        transaction.commit()?;
        Ok(Some((row, decided)))
    }

    /// Stores a suggestion of `decision` on `address` from `proposer`,
    /// unless it has `most` waiting already. Its own earlier suggestion
    /// for the same address is superseded, so it does not count twice.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn suggest(
        &mut self,
        address: &str,
        decision: Decision,
        proposer: &Proposer,
        most: u32,
        now: i64,
    ) -> Result<Suggested, StoreError> {
        let transaction = self.connection.transaction()?;
        let waiting: i64 = transaction.one(
            "SELECT count(*) FROM sender_suggestion
             WHERE proposer_kind = ?1 AND proposer_id IS ?2 AND state = 'open'
               AND address <> ?3",
            params![proposer.kind, proposer.id, address],
            |row| row.get(0),
        )?;
        if waiting >= i64::from(most) {
            return Ok(Suggested::TooMany(most));
        }
        let superseded: Vec<i64> = {
            let mut statement = transaction.prepare_cached(
                "UPDATE sender_suggestion SET state = 'superseded', closed_at = ?4
                 WHERE proposer_kind = ?1 AND proposer_id IS ?2 AND address = ?3
                   AND state = 'open' RETURNING id",
            )?;
            statement
                .query_map(params![proposer.kind, proposer.id, address, now], |row| {
                    row.get(0)
                })?
                .collect::<Result<_, _>>()?
        };
        for id in superseded {
            note_change(&transaction, now, "suggestion", id)?;
        }
        transaction.run(
            "INSERT INTO sender_suggestion
                 (address, decision, proposer_kind, proposer_id, created_at, state)
             VALUES (?1, ?2, ?3, ?4, ?5, 'open')",
            params![address, decision.as_str(), proposer.kind, proposer.id, now],
        )?;
        let id = transaction.last_insert_rowid();
        note_change(&transaction, now, "suggestion", id)?;
        transaction.commit()?;
        Ok(Suggested::Stored(id))
    }

    /// Suggestion `id`, if there is one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn suggestion(&self, id: i64) -> Result<Option<SuggestionRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {SUGGESTION_COLUMNS} FROM sender_suggestion WHERE id = ?1"),
                [id],
                suggestion_row,
            )
            .optional()?)
    }

    /// The suggestions still open for `address`, oldest first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn open_suggestions(&self, address: &str) -> Result<Vec<SuggestionRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {SUGGESTION_COLUMNS} FROM sender_suggestion
             WHERE address = ?1 AND state = 'open' ORDER BY id"
        ))?;
        let rows = statement
            .query_map([address], suggestion_row)?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }

    /// How many suggestions wait for the person.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn open_suggestion_count(&self) -> Result<u64, StoreError> {
        let open: i64 = self.connection.query_row(
            "SELECT count(*) FROM sender_suggestion WHERE state = 'open'",
            [],
            |row| row.get(0),
        )?;
        Ok(count(open))
    }

    /// Closes suggestion `id` as dismissed. Returns whether it was open.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn dismiss(&mut self, id: i64, now: i64) -> Result<bool, StoreError> {
        let transaction = self.connection.transaction()?;
        let closed = transaction.run(
            "UPDATE sender_suggestion SET state = 'dismissed', closed_at = ?2
             WHERE id = ?1 AND state = 'open'",
            params![id, now],
        )? > 0;
        if closed {
            note_change(&transaction, now, "suggestion", id)?;
        }
        transaction.commit()?;
        Ok(closed)
    }

    /// How many of `address`'s held messages would change class, or lose
    /// theirs, if the person screened it `decision`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn would_change(&self, address: &str, decision: Decision) -> Result<u64, StoreError> {
        // An address that is the person's has no class at all.
        let class = match decision {
            Decision::Out => Some("blocked"),
            Decision::In => Some("known"),
            Decision::Mine => None,
        };
        let changed: i64 =
            self.connection
                .query_row(WOULD_CHANGE, params![address, class], |row| row.get(0))?;
        Ok(count(changed))
    }

    /// The addresses the person screened out since `since`, the latest
    /// first, at most `limit`, each with the suggestion it came from, if
    /// any; and how many there are in all.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn blocked_since(&self, since: i64, limit: u32) -> Result<(Vec<Blocked>, u64), StoreError> {
        let rows: Vec<DecisionRow> = {
            let mut statement = self.connection.prepare_cached(&blocked_sql())?;
            statement
                .query_map(params![since, limit], decision_row)?
                .collect::<Result<_, _>>()?
        };
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM sender_decision WHERE decision = 'out' AND decided_at >= ?1",
            [since],
            |row| row.get(0),
        )?;
        let mut blocked = Vec::with_capacity(rows.len());
        for row in rows {
            let suggestion = match row.suggestion {
                Some(id) => self.suggestion(id)?,
                None => None,
            };
            blocked.push((row, suggestion));
        }
        Ok((blocked, count(total)))
    }
}
