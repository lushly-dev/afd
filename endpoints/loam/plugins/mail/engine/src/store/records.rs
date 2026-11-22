//! Proposed records attached to messages (the specification's 10.1, step E1).
//! Not derived: survives a rebuild.
//!
//! Each record carries a closed type, validated structured fields, verbatim
//! passages grounded in the message's visible text or subject, a 32-byte
//! SHA-256 content hash, and its proposer. A new record from the same proposer
//! for the same message and type atomically supersedes its prior active row;
//! records are never edited.

use rusqlite::types::Value as SqlValue;
use rusqlite::{OptionalExtension, params, params_from_iter};
use serde_json::Value;

use super::{MessageId, Proposer, Store, StoreError, ThreadId, count, note_change};

/// The closed vocabulary of record types (step E1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RecordType {
    /// A request made in the message.
    Request,
    /// A commitment made by the person, sender, or another party.
    Commitment,
    /// A deadline named in the message.
    Deadline,
    /// An order or shipment notice.
    Order,
    /// A reservation or appointment.
    Booking,
    /// A bill or invoice.
    Bill,
    /// A verification or one-time code.
    Code,
    /// A proposed category for organizing mail.
    Category,
    /// A proposed priority or ranking for a message.
    Priority,
}

impl RecordType {
    /// Every valid record type, in schema order.
    pub const ALL: [Self; 9] = [
        Self::Request,
        Self::Commitment,
        Self::Deadline,
        Self::Order,
        Self::Booking,
        Self::Bill,
        Self::Code,
        Self::Category,
        Self::Priority,
    ];

    /// The type as the store and results write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Request => "request",
            Self::Commitment => "commitment",
            Self::Deadline => "deadline",
            Self::Order => "order",
            Self::Booking => "booking",
            Self::Bill => "bill",
            Self::Code => "code",
            Self::Category => "category",
            Self::Priority => "priority",
        }
    }

    /// Parses a record type name.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == text)
    }
}

/// Lifecycle state of a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordState {
    /// Currently active for its `(message, type, proposer)` slot.
    Active,
    /// Replaced by a newer record from the same proposer for the same message and type.
    Superseded,
    /// Withdrawn by the person or its proposer.
    Withdrawn,
}

impl RecordState {
    /// The state as the store and results write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Superseded => "superseded",
            Self::Withdrawn => "withdrawn",
        }
    }

    /// Parses a stored record state.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "active" => Some(Self::Active),
            "superseded" => Some(Self::Superseded),
            "withdrawn" => Some(Self::Withdrawn),
            _ => None,
        }
    }
}

/// A stored record row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordRow {
    /// The record's id.
    pub id: i64,
    /// The message it attaches to.
    pub message: MessageId,
    /// Its closed record type.
    pub record_type: RecordType,
    /// Validated type-specific fields (JSON object).
    pub fields: Value,
    /// Verbatim passages verified against the message's visible text or subject.
    pub passages: Vec<String>,
    /// SHA-256 content hash over canonical `{ message, type, fields, passages }`.
    pub content_hash: [u8; 32],
    /// Who proposed the record.
    pub proposer: Proposer,
    /// Current lifecycle state.
    pub state: RecordState,
    /// The newer record that superseded this one, when `state == Superseded`.
    pub superseded_by: Option<i64>,
    /// When the record was proposed, in milliseconds since the epoch.
    pub proposed_at: i64,
    /// When the record was superseded or withdrawn, in milliseconds since the epoch.
    pub ended_at: Option<i64>,
}

/// Validated input for inserting a new record.
#[derive(Debug, Clone, Copy)]
pub struct NewRecord<'a> {
    /// The message the record attaches to.
    pub message: MessageId,
    /// The closed record type.
    pub record_type: RecordType,
    /// Canonical JSON object string for `fields`.
    pub fields_json: &'a str,
    /// JSON array string for `passages`.
    pub passages_json: &'a str,
    /// 32-byte SHA-256 content hash.
    pub content_hash: &'a [u8; 32],
    /// Who proposed the record.
    pub proposer: &'a Proposer,
}

/// Result of proposing a record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordProposed {
    /// Stored as a new active row; `superseded` names the prior active row it replaced, if any.
    Stored {
        /// The newly stored record.
        row: Box<RecordRow>,
        /// Prior active record id superseded by this proposal, if any.
        superseded: Option<i64>,
    },
    /// The proposer already holds the maximum number of active records.
    TooMany(u32),
}

/// Result of attempting to withdraw a record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WithdrawOutcome {
    /// Active record transitioned to `withdrawn`.
    Withdrawn(Box<RecordRow>),
    /// Record already ended (`superseded` or `withdrawn`).
    AlreadyEnded(RecordState),
    /// No record has that id.
    NotFound,
}

/// Filter on a record's proposer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProposerFilter {
    /// Match `proposer_kind` (`"human"`, `"agent"`, `"script"`, etc.).
    Kind(String),
    /// Match `proposer_id` (an agent's token id).
    Token(String),
}

/// Filters and pagination for listing records.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecordQuery {
    /// Restrict to one message.
    pub message: Option<MessageId>,
    /// Restrict to messages in one thread.
    pub thread: Option<ThreadId>,
    /// Restrict to one record type.
    pub record_type: Option<RecordType>,
    /// Restrict to one proposer kind or token id.
    pub proposer: Option<ProposerFilter>,
    /// When false, list only `active` records.
    pub include_ended: bool,
    /// Keyset cursor `(proposed_at, id)` of the last row on the previous page.
    pub before: Option<(i64, i64)>,
    /// Maximum rows to return.
    pub limit: u32,
}

const RECORD_COLUMNS: &str = "record.id, record.message_id, record.record_type, record.fields,
    record.passages, record.content_hash, record.proposer_kind, record.proposer_id,
    record.state, record.superseded_by, record.proposed_at, record.ended_at";

fn bad_column(index: usize, kind: rusqlite::types::Type, message: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        kind,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

fn record_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecordRow> {
    let type_text: String = row.get(2)?;
    let record_type = RecordType::parse(&type_text)
        .ok_or_else(|| bad_column(2, rusqlite::types::Type::Text, "unknown record_type"))?;
    let fields_text: String = row.get(3)?;
    let fields: Value = serde_json::from_str(&fields_text)
        .map_err(|_| bad_column(3, rusqlite::types::Type::Text, "invalid fields JSON"))?;
    let passages_text: String = row.get(4)?;
    let passages: Vec<String> = serde_json::from_str(&passages_text)
        .map_err(|_| bad_column(4, rusqlite::types::Type::Text, "invalid passages JSON"))?;
    let hash_bytes: Vec<u8> = row.get(5)?;
    let content_hash: [u8; 32] = hash_bytes.try_into().map_err(|_| {
        bad_column(
            5,
            rusqlite::types::Type::Blob,
            "content_hash must be 32 bytes",
        )
    })?;
    let state_text: String = row.get(8)?;
    let state = RecordState::parse(&state_text)
        .ok_or_else(|| bad_column(8, rusqlite::types::Type::Text, "unknown record state"))?;
    Ok(RecordRow {
        id: row.get(0)?,
        message: MessageId(row.get(1)?),
        record_type,
        fields,
        passages,
        content_hash,
        proposer: Proposer {
            kind: row.get(6)?,
            id: row.get(7)?,
        },
        state,
        superseded_by: row.get(9)?,
        proposed_at: row.get(10)?,
        ended_at: row.get(11)?,
    })
}

impl Store {
    /// Stores a new active record, atomically superseding any prior active
    /// record from the same proposer for the same message and type.
    ///
    /// Enforces `most_active` active records per proposer; superseding an
    /// existing active slot does not increase the proposer's active count and
    /// is allowed even at the cap.
    ///
    /// # Errors
    /// [`StoreError::NotFound`] when the message does not exist, or when SQLite
    /// refuses.
    pub fn propose_record(
        &mut self,
        record: &NewRecord<'_>,
        most_active: u32,
        now: i64,
    ) -> Result<RecordProposed, StoreError> {
        let transaction = self.connection.transaction()?;
        let exists = transaction
            .query_row(
                "SELECT 1 FROM message WHERE id = ?1",
                [record.message.0],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(StoreError::NotFound("message"));
        }

        let proposer_id = record.proposer.id.as_deref().filter(|id| !id.is_empty());

        let existing: Option<i64> = transaction
            .query_row(
                "SELECT id FROM record
                 WHERE message_id = ?1 AND record_type = ?2
                   AND proposer_kind = ?3 AND coalesce(proposer_id, '') = coalesce(?4, '')
                   AND state = 'active'",
                params![
                    record.message.0,
                    record.record_type.as_str(),
                    record.proposer.kind,
                    proposer_id,
                ],
                |row| row.get(0),
            )
            .optional()?;

        if existing.is_none() {
            let active: i64 = transaction.query_row(
                "SELECT count(*) FROM record
                 WHERE proposer_kind = ?1 AND proposer_id IS ?2 AND state = 'active'",
                params![record.proposer.kind, proposer_id],
                |row| row.get(0),
            )?;
            if active >= i64::from(most_active) {
                return Ok(RecordProposed::TooMany(most_active));
            }
        }

        if let Some(old_id) = existing {
            // Temporarily vacate the `state = 'active'` unique index slot while
            // satisfying both CHECK constraints before linking `superseded_by`.
            transaction.execute(
                "UPDATE record SET state = 'withdrawn', ended_at = ?2 WHERE id = ?1",
                params![old_id, now],
            )?;
        }

        transaction.execute(
            "INSERT INTO record
                 (message_id, record_type, fields, passages, content_hash,
                  proposer_kind, proposer_id, state, proposed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8)",
            params![
                record.message.0,
                record.record_type.as_str(),
                record.fields_json,
                record.passages_json,
                record.content_hash.as_slice(),
                record.proposer.kind,
                proposer_id,
                now,
            ],
        )?;
        let new_id = transaction.last_insert_rowid();

        if let Some(old_id) = existing {
            transaction.execute(
                "UPDATE record SET state = 'superseded', superseded_by = ?2 WHERE id = ?1",
                params![old_id, new_id],
            )?;
            note_change(&transaction, now, "record", old_id)?;
        }
        note_change(&transaction, now, "record", new_id)?;

        let row = transaction.query_row(
            &format!("SELECT {RECORD_COLUMNS} FROM record WHERE record.id = ?1"),
            [new_id],
            record_row,
        )?;
        transaction.commit()?;
        Ok(RecordProposed::Stored {
            row: Box::new(row),
            superseded: existing,
        })
    }

    /// Reads one record by id, if it exists.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn record(&self, id: i64) -> Result<Option<RecordRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {RECORD_COLUMNS} FROM record WHERE record.id = ?1"),
                [id],
                record_row,
            )
            .optional()?)
    }

    /// Withdraws an active record, setting `state = 'withdrawn'` and `ended_at = now`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn withdraw_record(&mut self, id: i64, now: i64) -> Result<WithdrawOutcome, StoreError> {
        let transaction = self.connection.transaction()?;
        let Some(row) = transaction
            .query_row(
                &format!("SELECT {RECORD_COLUMNS} FROM record WHERE record.id = ?1"),
                [id],
                record_row,
            )
            .optional()?
        else {
            return Ok(WithdrawOutcome::NotFound);
        };
        if row.state != RecordState::Active {
            return Ok(WithdrawOutcome::AlreadyEnded(row.state));
        }
        transaction.execute(
            "UPDATE record SET state = 'withdrawn', ended_at = ?2
             WHERE id = ?1 AND state = 'active'",
            params![id, now],
        )?;
        note_change(&transaction, now, "record", id)?;
        let updated = transaction.query_row(
            &format!("SELECT {RECORD_COLUMNS} FROM record WHERE record.id = ?1"),
            [id],
            record_row,
        )?;
        transaction.commit()?;
        Ok(WithdrawOutcome::Withdrawn(Box::new(updated)))
    }

    /// Lists records matching `query`, newest first (`proposed_at DESC, id DESC`).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn list_records(&self, query: &RecordQuery) -> Result<Vec<RecordRow>, StoreError> {
        let mut sql = format!("SELECT {RECORD_COLUMNS} FROM record");
        let mut conditions: Vec<String> = Vec::new();
        let mut values: Vec<SqlValue> = Vec::new();

        if let Some(thread) = query.thread {
            sql.push_str(" JOIN envelope ON envelope.message_id = record.message_id");
            values.push(SqlValue::Integer(thread.0));
            conditions.push(format!("envelope.thread_id = ?{}", values.len()));
        }
        if let Some(message) = query.message {
            values.push(SqlValue::Integer(message.0));
            conditions.push(format!("record.message_id = ?{}", values.len()));
        }
        if let Some(record_type) = query.record_type {
            values.push(SqlValue::Text(record_type.as_str().to_string()));
            conditions.push(format!("record.record_type = ?{}", values.len()));
        }
        if let Some(proposer) = &query.proposer {
            match proposer {
                ProposerFilter::Kind(kind) => {
                    values.push(SqlValue::Text(kind.clone()));
                    conditions.push(format!("record.proposer_kind = ?{}", values.len()));
                }
                ProposerFilter::Token(token) => {
                    values.push(SqlValue::Text(token.clone()));
                    conditions.push(format!("record.proposer_id = ?{}", values.len()));
                }
            }
        }
        if !query.include_ended {
            conditions.push("record.state = 'active'".to_string());
        }
        if let Some((proposed_at, id)) = query.before {
            values.push(SqlValue::Integer(proposed_at));
            let at_idx = values.len();
            values.push(SqlValue::Integer(id));
            let id_idx = values.len();
            conditions.push(format!(
                "(record.proposed_at, record.id) < (?{at_idx}, ?{id_idx})"
            ));
        }

        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }
        values.push(SqlValue::Integer(i64::from(query.limit)));
        sql.push_str(&format!(
            " ORDER BY record.proposed_at DESC, record.id DESC LIMIT ?{}",
            values.len()
        ));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(values), record_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// How many active records are attached to `message`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn active_record_count(&self, message: MessageId) -> Result<u64, StoreError> {
        let total: i64 = self.connection.query_row(
            "SELECT count(*) FROM record WHERE message_id = ?1 AND state = 'active'",
            [message.0],
            |row| row.get(0),
        )?;
        Ok(count(total))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use serde_json::json;

    use super::*;
    use crate::home::Home;
    use crate::store::{HeaderSeen, MailboxSeen, Role, schema};

    fn setup() -> (tempfile::TempDir, Store, MessageId, MessageId) {
        let dir = tempfile::tempdir().unwrap();
        let home = Home::at(dir.path().join("data"));
        let mut store = Store::open(&home).unwrap();
        let account = store
            .add_account("icloud", "person@example.com", 1)
            .unwrap();
        let inbox = store
            .upsert_mailbox(
                account,
                &MailboxSeen {
                    provider_key: "INBOX",
                    name: "Inbox",
                    role: Role::Inbox,
                },
                1,
            )
            .unwrap();
        let h1 = HeaderSeen {
            provider_id: "1".to_string(),
            provider_thread: None,
            reported_size: 200,
            internal_date: Some(1_000),
            flags: vec![],
            header_block:
                b"From: a@example.com\r\nMessage-ID: <m1@example.com>\r\nSubject: First\r\n\r\n"
                    .to_vec(),
        };
        let h2 = HeaderSeen {
            provider_id: "2".to_string(),
            provider_thread: None,
            reported_size: 210,
            internal_date: Some(2_000),
            flags: vec![],
            header_block:
                b"From: b@example.com\r\nMessage-ID: <m2@example.com>\r\nSubject: Second\r\n\r\n"
                    .to_vec(),
        };
        store
            .record_headers(inbox, "", &[h1.clone(), h2.clone()], 2)
            .unwrap();
        let m1 = store
            .find_message(&h1.header_block, h1.reported_size)
            .unwrap()
            .unwrap();
        let m2 = store
            .find_message(&h2.header_block, h2.reported_size)
            .unwrap()
            .unwrap();
        (dir, store, m1, m2)
    }

    fn agent(id: &str) -> Proposer {
        Proposer {
            kind: "agent".to_string(),
            id: Some(id.to_string()),
        }
    }

    fn person() -> Proposer {
        Proposer {
            kind: "human".to_string(),
            id: None,
        }
    }

    fn sample_new<'a>(
        message: MessageId,
        record_type: RecordType,
        proposer: &'a Proposer,
        hash: &'a [u8; 32],
    ) -> NewRecord<'a> {
        NewRecord {
            message,
            record_type,
            fields_json: r#"{"summary":"Reply soon"}"#,
            passages_json: r#"["First"]"#,
            content_hash: hash,
            proposer,
        }
    }

    #[test]
    fn migration_17_upgrades_v16_and_enforces_constraints() {
        let dir = tempfile::tempdir().unwrap();
        let home = Home::at(dir.path().join("data"));
        {
            let store = Store::open_with(&home, &schema::MIGRATIONS[..16]).unwrap();
            assert_eq!(store.schema_version().unwrap(), 16);
            store
                .connection
                .execute(
                    "INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                     VALUES (1, zeroblob(32), 100, 10)",
                    [],
                )
                .unwrap();
        }
        let store = Store::open(&home).unwrap();
        assert_eq!(
            store.schema_version().unwrap(),
            u32::try_from(schema::MIGRATIONS.len()).unwrap()
        );

        // Unknown record_type refused by CHECK.
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO record
                         (message_id, record_type, fields, passages, content_hash,
                          proposer_kind, state, proposed_at)
                     VALUES (1, 'unknown', '{}', '[]', zeroblob(32), 'agent', 'active', 1)",
                    [],
                )
                .is_err()
        );
        // Active with ended_at refused by CHECK.
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO record
                         (message_id, record_type, fields, passages, content_hash,
                          proposer_kind, state, proposed_at, ended_at)
                     VALUES (1, 'request', '{}', '[]', zeroblob(32), 'agent', 'active', 1, 2)",
                    [],
                )
                .is_err()
        );
        // Superseded without superseded_by refused by CHECK.
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO record
                         (message_id, record_type, fields, passages, content_hash,
                          proposer_kind, state, proposed_at, ended_at)
                     VALUES (1, 'request', '{}', '[]', zeroblob(32), 'agent', 'superseded', 1, 2)",
                    [],
                )
                .is_err()
        );
        // Duplicate active slot refused by unique index (including NULL proposer_id).
        store
            .connection
            .execute(
                "INSERT INTO record
                     (message_id, record_type, fields, passages, content_hash,
                      proposer_kind, proposer_id, state, proposed_at)
                 VALUES (1, 'request', '{}', '[]', zeroblob(32), 'human', NULL, 'active', 1)",
                [],
            )
            .unwrap();
        assert!(
            store
                .connection
                .execute(
                    "INSERT INTO record
                         (message_id, record_type, fields, passages, content_hash,
                          proposer_kind, proposer_id, state, proposed_at)
                     VALUES (1, 'request', '{}', '[]', zeroblob(32), 'human', NULL, 'active', 2)",
                    [],
                )
                .is_err()
        );
    }

    #[test]
    fn supersession_coexistence_cap_and_withdrawal() {
        let (_dir, mut store, m1, m2) = setup();
        let a = agent("tok_a");
        let b = agent("tok_b");
        let h1 = [1u8; 32];
        let h2 = [2u8; 32];

        let first = match store
            .propose_record(&sample_new(m1, RecordType::Request, &a, &h1), 2, 100)
            .unwrap()
        {
            RecordProposed::Stored { row, superseded } => {
                assert_eq!(superseded, None);
                row
            }
            RecordProposed::TooMany(_) => panic!("unexpected cap"),
        };
        assert_eq!(first.state, RecordState::Active);
        assert_eq!(first.fields, json!({"summary": "Reply soon"}));
        assert_eq!(store.active_record_count(m1).unwrap(), 1);

        // Same proposer, same message, same type supersedes atomically.
        let second = match store
            .propose_record(&sample_new(m1, RecordType::Request, &a, &h2), 2, 200)
            .unwrap()
        {
            RecordProposed::Stored { row, superseded } => {
                assert_eq!(superseded, Some(first.id));
                row
            }
            RecordProposed::TooMany(_) => panic!("unexpected cap"),
        };
        let old = store.record(first.id).unwrap().unwrap();
        assert_eq!(old.state, RecordState::Superseded);
        assert_eq!(old.superseded_by, Some(second.id));
        assert_eq!(old.ended_at, Some(200));
        assert_eq!(store.active_record_count(m1).unwrap(), 1);

        // Different proposer coexists on same message and type.
        let other = match store
            .propose_record(&sample_new(m1, RecordType::Request, &b, &h1), 2, 250)
            .unwrap()
        {
            RecordProposed::Stored { row, superseded } => {
                assert_eq!(superseded, None);
                row
            }
            RecordProposed::TooMany(_) => panic!("unexpected cap"),
        };
        assert_eq!(store.active_record_count(m1).unwrap(), 2);

        // Second active slot for `a` hits cap = 2.
        let second_slot = match store
            .propose_record(&sample_new(m2, RecordType::Request, &a, &h1), 2, 300)
            .unwrap()
        {
            RecordProposed::Stored { row, superseded } => {
                assert_eq!(superseded, None);
                row
            }
            RecordProposed::TooMany(_) => panic!("unexpected cap"),
        };

        // Third distinct slot for `a` refused at cap = 2.
        assert_eq!(
            store
                .propose_record(&sample_new(m2, RecordType::Category, &a, &h1), 2, 350)
                .unwrap(),
            RecordProposed::TooMany(2)
        );
        // Superseding an existing active slot for `a` is still allowed at cap = 2.
        assert!(matches!(
            store
                .propose_record(&sample_new(m2, RecordType::Request, &a, &h2), 2, 360)
                .unwrap(),
            RecordProposed::Stored {
                superseded: Some(id),
                ..
            } if id == second_slot.id
        ));

        // Withdrawing frees a slot for `a`, and double withdraw reports AlreadyEnded.
        let withdrawn = store.withdraw_record(second.id, 400).unwrap();
        assert!(matches!(
            withdrawn,
            WithdrawOutcome::Withdrawn(ref row)
                if row.state == RecordState::Withdrawn && row.ended_at == Some(400)
        ));
        assert_eq!(
            store.withdraw_record(second.id, 410).unwrap(),
            WithdrawOutcome::AlreadyEnded(RecordState::Withdrawn)
        );
        assert_eq!(
            store.withdraw_record(first.id, 410).unwrap(),
            WithdrawOutcome::AlreadyEnded(RecordState::Superseded)
        );
        assert_eq!(
            store.withdraw_record(999_999, 410).unwrap(),
            WithdrawOutcome::NotFound
        );

        // Now `a` can take a new slot again.
        assert!(matches!(
            store
                .propose_record(&sample_new(m2, RecordType::Category, &a, &h1), 2, 420)
                .unwrap(),
            RecordProposed::Stored {
                superseded: None,
                ..
            }
        ));
        assert!(store.record(other.id).unwrap().unwrap().state == RecordState::Active);
    }

    #[test]
    fn records_survive_rebuild_and_support_query_filters() {
        let (_dir, mut store, m1, m2) = setup();
        let a = agent("tok_a");
        let p = person();
        let hash = [7u8; 32];

        let r1 = match store
            .propose_record(&sample_new(m1, RecordType::Request, &a, &hash), 10, 100)
            .unwrap()
        {
            RecordProposed::Stored { row, .. } => row,
            RecordProposed::TooMany(_) => panic!("unexpected"),
        };
        let r2 = match store
            .propose_record(&sample_new(m2, RecordType::Deadline, &p, &hash), 10, 200)
            .unwrap()
        {
            RecordProposed::Stored { row, .. } => row,
            RecordProposed::TooMany(_) => panic!("unexpected"),
        };

        // Rebuild derived tables and verify records are untouched.
        store.rebuild_begin().unwrap();
        while !store.rebuild_step(300).unwrap().finished {}

        let all = store
            .list_records(&RecordQuery {
                limit: 50,
                ..RecordQuery::default()
            })
            .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, r2.id);
        assert_eq!(all[1].id, r1.id);

        let by_token = store
            .list_records(&RecordQuery {
                proposer: Some(ProposerFilter::Token("tok_a".to_string())),
                limit: 50,
                ..RecordQuery::default()
            })
            .unwrap();
        assert_eq!(by_token.len(), 1);
        assert_eq!(by_token[0].id, r1.id);

        let by_kind = store
            .list_records(&RecordQuery {
                proposer: Some(ProposerFilter::Kind("human".to_string())),
                limit: 50,
                ..RecordQuery::default()
            })
            .unwrap();
        assert_eq!(by_kind.len(), 1);
        assert_eq!(by_kind[0].id, r2.id);

        // Verify query plan uses an index for active message listing.
        let plan: String = store
            .connection
            .query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM record WHERE message_id = 1 AND state = 'active'
                 ORDER BY proposed_at DESC, id DESC",
                [],
                |row| row.get(3),
            )
            .unwrap();
        assert!(plan.contains("record_message"), "{plan}");
    }
}
