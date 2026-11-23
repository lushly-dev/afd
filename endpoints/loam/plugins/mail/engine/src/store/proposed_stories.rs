//! Proposed situation and cohort stories (engine.spec.md section 10.2, step E2).
//! Not derived: survives a rebuild.
//!
//! Each proposed story allocates its id from `stream` (key `'proposed <id>'`) so
//! ids live in one namespace with stream and burst stories and never collide.
//! Only memberships answered `yes` are stored, each with its verified verbatim
//! passage.

use rusqlite::{OptionalExtension, params};

use super::read::{LISTED, listed};
use super::stories::{StoryMessage, StoryRow};
use super::{MessageId, Proposer, Store, StoreError, count, note_change};

/// Metadata present only on a caller-proposed story (`situation` or `cohort`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedMeta {
    /// Who proposed the story.
    pub proposer: Proposer,
    /// When it was proposed, in milliseconds.
    pub proposed_at: i64,
}

/// Maximum active proposed stories a single proposer may hold at once.
pub const MAX_PROPOSED_STORIES_PER_PROPOSER: u32 = 200;

/// Kind of a proposed story (step E2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProposedStoryKind {
    /// A set of messages describing an ongoing situation across threads/senders.
    Situation,
    /// A cohort of messages sharing a common topic or request (e.g. for a reply set).
    Cohort,
}

impl ProposedStoryKind {
    /// Every valid proposed story kind.
    pub const ALL: [Self; 2] = [Self::Situation, Self::Cohort];

    /// The kind as the store and results write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Situation => "situation",
            Self::Cohort => "cohort",
        }
    }

    /// Parses a proposed story kind name.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "situation" => Some(Self::Situation),
            "cohort" => Some(Self::Cohort),
            _ => None,
        }
    }
}

/// Lifecycle state of a proposed story.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposedStoryState {
    /// Active and shown in story listings.
    Proposed,
    /// Dismissed by the person or its proposer.
    Dismissed,
}

impl ProposedStoryState {
    /// The state as the store and results write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Dismissed => "dismissed",
        }
    }

    /// Parses a stored state.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "proposed" => Some(Self::Proposed),
            "dismissed" => Some(Self::Dismissed),
            _ => None,
        }
    }
}

/// A stored proposed story row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedStoryRow {
    /// Its story id (from `stream`).
    pub id: i64,
    /// `situation` or `cohort`.
    pub kind: ProposedStoryKind,
    /// Caller-supplied title (labelled as content in results).
    pub title: String,
    /// Who proposed the story.
    pub proposer: Proposer,
    /// Current lifecycle state.
    pub state: ProposedStoryState,
    /// How many `yes` member messages it holds.
    pub messages: u64,
    /// Earliest member date, in milliseconds.
    pub first_date: i64,
    /// Latest member date, in milliseconds.
    pub last_date: i64,
    /// When it was proposed, in milliseconds.
    pub proposed_at: i64,
    /// When it was dismissed, in milliseconds.
    pub ended_at: Option<i64>,
}

impl ProposedStoryRow {
    /// Converts this active proposed story into the unified [`StoryRow`] shape.
    #[must_use]
    pub fn into_story_row(self) -> StoryRow {
        StoryRow {
            id: self.id,
            kind: self.kind.as_str().to_string(),
            list_id: String::new(),
            sender_address: String::new(),
            title: self.title,
            messages: self.messages,
            exceptions: 0,
            kinds: 0,
            first_date: self.first_date,
            last_date: self.last_date,
            proposed: Some(ProposedMeta {
                proposer: self.proposer,
                proposed_at: self.proposed_at,
            }),
        }
    }
}

/// One validated `yes` membership to store for a proposed story.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedStoryMemberInput {
    /// The message id.
    pub message: MessageId,
    /// The verified verbatim passage from visible text or subject.
    pub passage: String,
    /// The message's envelope date, in milliseconds.
    pub date: i64,
}

/// Outcome of proposing a story.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposedStoryResult {
    /// Stored as an active proposed story.
    Stored(Box<ProposedStoryRow>),
    /// The proposer already holds the maximum number of active proposed stories.
    TooMany(u32),
}

/// Outcome of dismissing a proposed story.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DismissStoryOutcome {
    /// Active proposed story transitioned to `dismissed`.
    Dismissed(Box<ProposedStoryRow>),
    /// Proposed story was already dismissed.
    AlreadyDismissed,
    /// The id names a derived stream or burst story, which cannot be dismissed.
    NotProposedStory,
    /// No story has that id.
    NotFound,
}

const PROPOSED_COLUMNS: &str = "id, kind, title, proposer_kind, proposer_id, state,
    messages, first_date, last_date, proposed_at, ended_at";

fn bad_column(index: usize, message: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

fn proposed_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProposedStoryRow> {
    let kind_text: String = row.get(1)?;
    let kind = ProposedStoryKind::parse(&kind_text)
        .ok_or_else(|| bad_column(1, "unknown proposed_story kind"))?;
    let state_text: String = row.get(5)?;
    let state = ProposedStoryState::parse(&state_text)
        .ok_or_else(|| bad_column(5, "unknown proposed_story state"))?;
    Ok(ProposedStoryRow {
        id: row.get(0)?,
        kind,
        title: row.get(2)?,
        proposer: Proposer {
            kind: row.get(3)?,
            id: row.get(4)?,
        },
        state,
        messages: count(row.get(6)?),
        first_date: row.get(7)?,
        last_date: row.get(8)?,
        proposed_at: row.get(9)?,
        ended_at: row.get(10)?,
    })
}

impl Store {
    /// Stores a new proposed story with its `yes` memberships, allocating its id
    /// from `stream` so it never collides with stream or burst story ids.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] if any referenced message does not exist, or
    /// when SQLite refuses.
    pub fn propose_story(
        &mut self,
        kind: ProposedStoryKind,
        title: &str,
        proposer: &Proposer,
        members: &[ProposedStoryMemberInput],
        most_active: u32,
        now: i64,
    ) -> Result<ProposedStoryResult, StoreError> {
        let transaction = self.connection.transaction()?;
        let proposer_id = proposer.id.as_deref().filter(|id| !id.is_empty());

        let active: i64 = transaction.query_row(
            "SELECT count(*) FROM proposed_story
             WHERE proposer_kind = ?1 AND proposer_id IS ?2 AND state = 'proposed'",
            params![proposer.kind, proposer_id],
            |row| row.get(0),
        )?;
        if active >= i64::from(most_active) {
            return Ok(ProposedStoryResult::TooMany(most_active));
        }

        let mut first_date = i64::MAX;
        let mut last_date = i64::MIN;
        for member in members {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM message WHERE id = ?1",
                    [member.message.0],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(StoreError::NotFound("message"));
            }
            first_date = first_date.min(member.date);
            last_date = last_date.max(member.date);
        }
        if members.is_empty() {
            first_date = now;
            last_date = now;
        }

        transaction.execute("INSERT INTO stream (key) VALUES ('proposed-pending')", [])?;
        let id = transaction.last_insert_rowid();
        transaction.execute(
            "UPDATE stream SET key = 'proposed ' || ?1 WHERE id = ?1",
            [id],
        )?;

        transaction.execute(
            "INSERT INTO proposed_story
                 (id, kind, title, proposer_kind, proposer_id, state,
                  messages, first_date, last_date, proposed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'proposed', ?6, ?7, ?8, ?9)",
            params![
                id,
                kind.as_str(),
                title,
                proposer.kind,
                proposer_id,
                i64::try_from(members.len()).unwrap_or(i64::MAX),
                first_date,
                last_date,
                now,
            ],
        )?;

        {
            let mut insert_member = transaction.prepare(
                "INSERT INTO proposed_story_member (story_id, message_id, passage, date)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for member in members {
                insert_member.execute(params![
                    id,
                    member.message.0,
                    member.passage,
                    member.date
                ])?;
            }
        }

        note_change(&transaction, now, "story", id)?;

        let row = transaction.query_row(
            &format!("SELECT {PROPOSED_COLUMNS} FROM proposed_story WHERE id = ?1"),
            [id],
            proposed_row,
        )?;
        transaction.commit()?;
        Ok(ProposedStoryResult::Stored(Box::new(row)))
    }

    /// Reads one proposed story by id, in any state.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn proposed_story(&self, id: i64) -> Result<Option<ProposedStoryRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {PROPOSED_COLUMNS} FROM proposed_story WHERE id = ?1"),
                [id],
                proposed_row,
            )
            .optional()?)
    }

    /// Reads one active (`state = 'proposed'`) proposed story by id.
    ///
    /// # Errors
    /// When the database refuses.
    pub(super) fn active_proposed_story(
        &self,
        id: i64,
    ) -> Result<Option<ProposedStoryRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!(
                    "SELECT {PROPOSED_COLUMNS} FROM proposed_story
                     WHERE id = ?1 AND state = 'proposed'"
                ),
                [id],
                proposed_row,
            )
            .optional()?)
    }

    /// Lists active proposed stories, newest first (`last_date DESC, id DESC`).
    ///
    /// # Errors
    /// When the database refuses.
    pub(super) fn active_proposed_stories(
        &self,
        before: Option<(i64, i64)>,
        limit: u32,
    ) -> Result<Vec<ProposedStoryRow>, StoreError> {
        let (date, id) = before.unwrap_or((i64::MAX, i64::MAX));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {PROPOSED_COLUMNS} FROM proposed_story
             WHERE state = 'proposed' AND (last_date, id) < (?1, ?2)
             ORDER BY last_date DESC, id DESC LIMIT ?3"
        ))?;
        let rows = statement.query_map(params![date, id, limit], proposed_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Counts active proposed stories.
    ///
    /// # Errors
    /// When the database refuses.
    pub(super) fn active_proposed_story_count(&self) -> Result<u64, StoreError> {
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM proposed_story WHERE state = 'proposed'",
            [],
            |row| row.get(0),
        )?;
        Ok(count(total))
    }

    /// Lists a proposed story's member messages, newest first, with their
    /// verified passages.
    ///
    /// # Errors
    /// When the database refuses.
    pub(super) fn proposed_story_messages(
        &self,
        story: i64,
        before: Option<(i64, MessageId)>,
        limit: u32,
    ) -> Result<Vec<StoryMessage>, StoreError> {
        let (date, message) =
            before.map_or((i64::MAX, i64::MAX), |(date, message)| (date, message.0));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {LISTED}, proposed_story_member.passage
             FROM proposed_story_member
             JOIN envelope ON envelope.message_id = proposed_story_member.message_id
             JOIN message ON message.id = proposed_story_member.message_id
             WHERE proposed_story_member.story_id = ?1
               AND (proposed_story_member.date, proposed_story_member.message_id) < (?2, ?3)
             ORDER BY proposed_story_member.date DESC, proposed_story_member.message_id DESC
             LIMIT ?4"
        ))?;
        let rows = statement.query_map(params![story, date, message, limit], |row| {
            Ok(StoryMessage {
                listed: listed(row)?,
                exception: false,
                kind: None,
                passage: Some(row.get(25)?),
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Dismisses an active proposed story, noting its departure in `change`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn dismiss_proposed_story(
        &mut self,
        id: i64,
        now: i64,
    ) -> Result<DismissStoryOutcome, StoreError> {
        let transaction = self.connection.transaction()?;
        let row = transaction
            .query_row(
                &format!("SELECT {PROPOSED_COLUMNS} FROM proposed_story WHERE id = ?1"),
                [id],
                proposed_row,
            )
            .optional()?;
        let Some(row) = row else {
            let derived = transaction
                .query_row(
                    "SELECT 1 FROM story WHERE id = ?1 AND (messages >= 5 OR kind = 'burst')",
                    [id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            return Ok(if derived {
                DismissStoryOutcome::NotProposedStory
            } else {
                DismissStoryOutcome::NotFound
            });
        };
        if row.state != ProposedStoryState::Proposed {
            return Ok(DismissStoryOutcome::AlreadyDismissed);
        }
        transaction.execute(
            "UPDATE proposed_story SET state = 'dismissed', ended_at = ?2
             WHERE id = ?1 AND state = 'proposed'",
            params![id, now],
        )?;
        note_change(&transaction, now, "story", id)?;
        let updated = transaction.query_row(
            &format!("SELECT {PROPOSED_COLUMNS} FROM proposed_story WHERE id = ?1"),
            [id],
            proposed_row,
        )?;
        transaction.commit()?;
        Ok(DismissStoryOutcome::Dismissed(Box::new(updated)))
    }
}
