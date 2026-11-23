//! Reply sets (step E3; the specification's 10.3 and plugin.spec.md sections 7
//! and 9). Not derived: survives `mail-rebuild`.
//!
//! A reply set groups replies to a cohort of messages so a person can answer
//! shared questions once, compose each reply in isolation from its own source
//! message and answers, review the shared text and every difference, and send
//! the batch under one approval. Each reply's recipient is derived by the
//! engine from the source message at creation and stored with the reply so
//! callers cannot set recipients and re-deriving a message cannot change them.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use super::senders::own_addresses;
use super::{AccountId, AccountRow, MessageId, Store, StoreError};
use crate::derive;
use crate::drafts::{MOST_SUBJECT, address, unsafe_in_subject};
use crate::store::Proposer;

/// Overall state of a reply set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplySetState {
    /// Editable and ready to compose/send.
    Open,
    /// Currently sending over SMTP.
    Sending,
    /// Some replies were sent and a later reply failed cleanly before handover;
    /// the remaining unsent replies may be re-previewed and sent.
    Partial,
    /// Every reply was accepted by the provider.
    Sent,
    /// A reply's send ended with an unknown outcome; never retried.
    Unknown,
}

impl ReplySetState {
    /// As stored in SQLite and returned in JSON.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Sending => "sending",
            Self::Partial => "partial",
            Self::Sent => "sent",
            Self::Unknown => "unknown",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "sending" => Self::Sending,
            "partial" => Self::Partial,
            "sent" => Self::Sent,
            "unknown" => Self::Unknown,
            _ => Self::Open,
        }
    }
}

/// Send state of an individual reply inside a reply set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplySendState {
    /// Not sent yet.
    None,
    /// Currently being handed over to SMTP.
    Sending,
    /// Accepted by SMTP.
    Sent,
    /// Failed cleanly before handover (may be retried on a new preview/approval).
    Failed,
    /// Connection dropped/timed out after handover; never retried.
    Unknown,
}

impl ReplySendState {
    /// As stored in SQLite.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }

    /// Human-readable state shown in `mail-replyset-show`.
    #[must_use]
    pub fn display_str(self) -> &'static str {
        match self {
            Self::None => "open",
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }

    fn parse(text: &str) -> Self {
        match text {
            "sending" => Self::Sending,
            "sent" => Self::Sent,
            "failed" => Self::Failed,
            "unknown" => Self::Unknown,
            _ => Self::None,
        }
    }
}

/// How a reply's current text was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplySource {
    /// Submitted against a handed-out unit.
    Submitted,
    /// Edited directly through `mail-replyset-update`.
    Edited,
}

impl ReplySource {
    /// As stored in SQLite and returned in JSON.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Submitted => "submitted",
            Self::Edited => "edited",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "submitted" => Some(Self::Submitted),
            "edited" => Some(Self::Edited),
            _ => None,
        }
    }
}

/// One `(question, revision)` pair recorded in a reply's input snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnswerRef {
    /// The question's id.
    pub question: i64,
    /// The question's revision when the reply was composed.
    pub revision: i64,
}

/// A reply set row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplySetRow {
    /// Its id.
    pub id: i64,
    /// The account every reply sends from.
    pub account: AccountId,
    /// Optional cohort story id.
    pub story: Option<i64>,
    /// Shared baseline text used to flag per-reply differences.
    pub shared_text: String,
    /// Revision, raised on every change to the set.
    pub revision: i64,
    /// Current state of the set.
    pub state: ReplySetState,
    /// Who created the set.
    pub creator: Proposer,
    /// Display name of the creator token saved at creation time.
    pub creator_name: Option<String>,
    /// When it was created (ms).
    pub created_at: i64,
    /// When it last changed (ms).
    pub updated_at: i64,
}

/// One reply row inside a reply set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyRow {
    /// Its id.
    pub id: i64,
    /// Its parent reply set's id.
    pub replyset: i64,
    /// Zero-based order within the set.
    pub ordinal: i64,
    /// The source message id (nullable only if removed by another account's deletion).
    pub message: Option<i64>,
    /// Stored recipient address derived from the source message's `From` at creation.
    pub recipient_address: String,
    /// Stored recipient display name derived from the source message at creation.
    pub recipient_name: String,
    /// Whether the source message carried a differing `Reply-To` header.
    pub reply_to_differs: bool,
    /// Outgoing subject derived from the source message.
    pub subject: String,
    /// Reply body text, once composed or edited.
    pub text: Option<String>,
    /// Whether `text` was submitted or edited.
    pub source: Option<ReplySource>,
    /// Generation counter for `rsu_<set>_<reply>_<generation>`.
    pub generation: i64,
    /// Latest submitter or editor.
    pub author: Option<Proposer>,
    /// Display name of the author token saved at write time.
    pub author_name: Option<String>,
    /// The unit id recorded when `text` was submitted.
    pub source_unit: Option<String>,
    /// Digest of the source message visible text handed out at submission.
    pub source_text_digest: Option<String>,
    /// Answer `(question, revision)` pairs recorded at submission.
    pub answers_snapshot: Vec<AnswerRef>,
    /// Latest unit id handed out for this reply's current generation.
    pub handed_unit: Option<String>,
    /// Exact source text digest handed out with `handed_unit`.
    pub handed_source_text_digest: Option<String>,
    /// Exact serialized answer `(question, revision)` snapshot handed out with `handed_unit`.
    pub handed_answers_snapshot: Option<String>,
    /// Digest of the current `text`.
    pub text_digest: Option<String>,
    /// When the reply last changed (ms).
    pub updated_at: i64,
    /// Individual send state.
    pub send_state: ReplySendState,
    /// Latest `outbound` row id for this reply, if any.
    pub outbound: Option<i64>,
    /// Total submission events recorded for this reply.
    pub submissions: u64,
    /// Total edit events recorded for this reply.
    pub edits: u64,
}

impl ReplyRow {
    /// The reply's current open unit id (`rsu_<set>_<reply>_<generation>`).
    #[must_use]
    pub fn current_unit_id(&self) -> String {
        format!("rsu_{}_{}_{}", self.replyset, self.id, self.generation)
    }

    /// Whether this reply's text differs from `shared_text`.
    ///
    /// When `shared_text` is empty, every reply with text is treated as
    /// differing so the person reviews every reply before approving.
    #[must_use]
    pub fn differs_from(&self, shared_text: &str) -> bool {
        match self.text.as_deref() {
            None => false,
            Some(text) => shared_text.is_empty() || text != shared_text,
        }
    }
}

/// One distinct cohort question in a reply set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionRow {
    /// Its id.
    pub id: i64,
    /// Parent reply set's id.
    pub replyset: i64,
    /// Zero-based order within the set.
    pub ordinal: i64,
    /// Question text.
    pub question: String,
    /// Person's answer text, if recorded.
    pub answer: Option<String>,
    /// Question revision, raised whenever `answer` changes.
    pub revision: i64,
    /// Who last recorded `answer`.
    pub answered_by: Option<Proposer>,
    /// Display name of the token that recorded `answer`, saved at write time.
    pub answered_by_name: Option<String>,
    /// When it last changed (ms).
    pub updated_at: i64,
    /// Reply ids linked to this question, in reply ordinal order.
    pub reply_ids: Vec<i64>,
    /// Source message ids linked to this question, in reply ordinal order.
    pub message_ids: Vec<i64>,
}

/// A complete reply set loaded from the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplySetDetail {
    /// The set row.
    pub set: ReplySetRow,
    /// Every question in ordinal order.
    pub questions: Vec<QuestionRow>,
    /// Every reply in ordinal order.
    pub replies: Vec<ReplyRow>,
}

/// A resolved source message ready to become a reply in a new reply set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSource {
    /// Source message id.
    pub message: i64,
    /// Derived bare ASCII recipient address (from `From`).
    pub recipient_address: String,
    /// Derived display name (from `From`).
    pub recipient_name: String,
    /// Whether the source message had a differing `Reply-To`.
    pub reply_to_differs: bool,
    /// Derived outgoing subject (`Re: ...`).
    pub subject: String,
}

/// Why resolving source messages for a new reply set failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceRefusal {
    /// The named account does not exist.
    AccountNotFound,
    /// Multiple accounts exist and `account` was omitted.
    AmbiguousAccount,
    /// A source message id does not exist.
    MessageNotFound(i64),
    /// A source message is not shown in the account outside junk/trash.
    MessageNotVisible(i64),
    /// A source message's sender is missing or not a valid bare ASCII address.
    InvalidSender(i64),
    /// A source message is from one of the person's own addresses.
    OwnSender(i64),
    /// The named story does not exist.
    StoryNotFound(i64),
}

/// A question to create with a new reply set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewQuestion {
    /// Question text.
    pub question: String,
    /// Optional initial answer text.
    pub answer: Option<String>,
    /// Source message ids that ask this question.
    pub messages: Vec<i64>,
}

/// Parameters for creating a new reply set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReplySet {
    /// Sending account.
    pub account: AccountId,
    /// Optional cohort story id.
    pub story: Option<i64>,
    /// Optional shared baseline text.
    pub shared_text: String,
    /// Resolved source messages in order.
    pub sources: Vec<ResolvedSource>,
    /// Optional cohort questions.
    pub questions: Vec<NewQuestion>,
}

/// Answer update for one question in `mail-replyset-update`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnswerUpdate {
    /// Question id.
    pub question: i64,
    /// New answer text.
    pub answer: String,
}

/// Direct text edit for one reply in `mail-replyset-update`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyEdit {
    /// Reply id.
    pub reply: i64,
    /// Replacement reply text.
    pub text: String,
    /// Digest of `text`.
    pub text_digest: String,
}

/// Changes requested by `mail-replyset-update`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReplySetChange {
    /// Optional replacement `shared_text`.
    pub shared_text: Option<String>,
    /// Question answer updates.
    pub answers: Vec<AnswerUpdate>,
    /// Optional direct reply text edit.
    pub edit: Option<ReplyEdit>,
}

/// Payload for submitting a composed reply against a handed-out unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplySubmission {
    /// Composed reply text.
    pub text: String,
    /// Digest of `text`.
    pub text_digest: String,
    /// Optional unit id echoed from `mail-replyset-next`; when present it must
    /// match the reply's currently handed-out unit.
    pub unit: Option<String>,
}

/// Why a reply set mutation was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplySetRefusal {
    /// No reply set has that id.
    NotFound,
    /// The set's revision no longer matches the caller's revision.
    Changed {
        /// Current revision.
        revision: i64,
    },
    /// The set is currently being sent.
    Sending,
    /// The set has already been sent.
    Sent,
    /// The set had an unknown send outcome and is locked.
    Unknown,
    /// The named question does not belong to this set.
    QuestionNotFound(i64),
    /// The named reply does not belong to this set.
    ReplyNotFound(i64),
    /// The named reply has already been sent or has an unknown send state.
    ReplyLocked(i64),
    /// The reply has no open handed-out unit matching its current generation
    /// and answers, or the caller named a stale unit (`UNIT_NOT_OPEN`).
    UnitNotOpen,
    /// The resulting preview exceeds the size limits (`PREVIEW_TOO_LARGE`).
    PreviewTooLarge,
}

/// Why a reply set send was refused before anything reached SMTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplySetSendRefusal {
    /// No reply set has that id.
    NotFound,
    /// Currently being sent.
    Sending,
    /// Already sent.
    Sent,
    /// Previous send ended with an unknown outcome.
    Unknown,
    /// Revision does not match the previewed revision (`PREVIEW_CHANGED`).
    Changed {
        /// Current revision.
        revision: i64,
    },
    /// One or more replies have no text yet (`REPLYSET_INCOMPLETE`).
    Incomplete {
        /// How many replies lack text.
        missing: usize,
    },
    /// No unsent replies remain.
    NothingToSend,
    /// Sending account no longer exists.
    AccountNotFound,
}

/// Derives a safe outgoing `Re: ...` subject from a source message's subject.
fn reply_subject_from(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if unsafe_in_subject(c) { ' ' } else { c })
        .collect();
    let collapsed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let base = if collapsed.is_empty() {
        "Re: (no subject)".to_string()
    } else if collapsed
        .as_bytes()
        .get(..3)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"re:"))
    {
        collapsed
    } else {
        format!("Re: {collapsed}")
    };
    base.chars().take(MOST_SUBJECT).collect()
}

fn token_name_on(
    connection: &Connection,
    proposer: &Proposer,
) -> Result<Option<String>, StoreError> {
    let Some(token_id) = proposer.id.as_deref() else {
        return Ok(None);
    };
    Ok(connection
        .query_row("SELECT name FROM token WHERE id = ?1", [token_id], |row| {
            row.get(0)
        })
        .optional()?)
}

fn load_replyset_on(
    connection: &Connection,
    id: i64,
) -> Result<Option<ReplySetDetail>, StoreError> {
    let set: Option<ReplySetRow> = connection
        .query_row(
            "SELECT id, account_id, story_id, shared_text, revision, state,
                    creator_kind, creator_id, creator_name, created_at, updated_at
             FROM replyset WHERE id = ?1",
            [id],
            |row| {
                let state: String = row.get(5)?;
                Ok(ReplySetRow {
                    id: row.get(0)?,
                    account: AccountId(row.get(1)?),
                    story: row.get(2)?,
                    shared_text: row.get(3)?,
                    revision: row.get(4)?,
                    state: ReplySetState::parse(&state),
                    creator: Proposer {
                        kind: row.get(6)?,
                        id: row.get(7)?,
                    },
                    creator_name: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()?;
    let Some(set) = set else {
        return Ok(None);
    };

    let mut reply_stmt = connection.prepare_cached(
        "SELECT r.id, r.replyset_id, r.ordinal, r.message_id, r.recipient_address,
                r.recipient_name, r.reply_to_differs, r.subject, r.text, r.source,
                r.generation, r.author_kind, r.author_id, r.author_name, r.source_unit,
                r.source_text_digest, r.answers_snapshot, r.handed_unit,
                r.handed_source_text_digest, r.handed_answers_snapshot,
                r.text_digest, r.updated_at, r.send_state, r.outbound_id,
                (SELECT count(*) FROM replyset_event e WHERE e.reply_id = r.id AND e.kind = 'submitted'),
                (SELECT count(*) FROM replyset_event e WHERE e.reply_id = r.id AND e.kind = 'edited')
         FROM replyset_reply r
         WHERE r.replyset_id = ?1
         ORDER BY r.ordinal ASC, r.id ASC",
    )?;
    let replies: Vec<ReplyRow> = reply_stmt
        .query_map([id], |row| {
            let reply_to_differs: i64 = row.get(6)?;
            let source: Option<String> = row.get(9)?;
            let author_kind: Option<String> = row.get(11)?;
            let author_id: Option<String> = row.get(12)?;
            let snapshot_raw: Option<String> = row.get(16)?;
            let send_state: String = row.get(22)?;
            let submissions: i64 = row.get(24)?;
            let edits: i64 = row.get(25)?;
            let answers_snapshot: Vec<AnswerRef> = snapshot_raw
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or_default();
            Ok(ReplyRow {
                id: row.get(0)?,
                replyset: row.get(1)?,
                ordinal: row.get(2)?,
                message: row.get(3)?,
                recipient_address: row.get(4)?,
                recipient_name: row.get(5)?,
                reply_to_differs: reply_to_differs != 0,
                subject: row.get(7)?,
                text: row.get(8)?,
                source: source.as_deref().and_then(ReplySource::parse),
                generation: row.get(10)?,
                author: author_kind.map(|kind| Proposer {
                    kind,
                    id: author_id,
                }),
                author_name: row.get(13)?,
                source_unit: row.get(14)?,
                source_text_digest: row.get(15)?,
                answers_snapshot,
                handed_unit: row.get(17)?,
                handed_source_text_digest: row.get(18)?,
                handed_answers_snapshot: row.get(19)?,
                text_digest: row.get(20)?,
                updated_at: row.get(21)?,
                send_state: ReplySendState::parse(&send_state),
                outbound: row.get(23)?,
                submissions: u64::try_from(submissions).unwrap_or(0),
                edits: u64::try_from(edits).unwrap_or(0),
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut q_stmt = connection.prepare_cached(
        "SELECT id, replyset_id, ordinal, question, answer, revision,
                answered_by_kind, answered_by_id, answered_by_name, updated_at
         FROM replyset_question
         WHERE replyset_id = ?1
         ORDER BY ordinal ASC, id ASC",
    )?;
    let mut questions: Vec<QuestionRow> = q_stmt
        .query_map([id], |row| {
            let answered_by_kind: Option<String> = row.get(6)?;
            let answered_by_id: Option<String> = row.get(7)?;
            Ok(QuestionRow {
                id: row.get(0)?,
                replyset: row.get(1)?,
                ordinal: row.get(2)?,
                question: row.get(3)?,
                answer: row.get(4)?,
                revision: row.get(5)?,
                answered_by: answered_by_kind.map(|kind| Proposer {
                    kind,
                    id: answered_by_id,
                }),
                answered_by_name: row.get(8)?,
                updated_at: row.get(9)?,
                reply_ids: Vec::new(),
                message_ids: Vec::new(),
            })
        })?
        .collect::<Result<_, _>>()?;

    if !questions.is_empty() {
        let mut link_stmt = connection.prepare_cached(
            "SELECT qr.question_id, r.id, r.message_id
             FROM replyset_question_reply qr
             JOIN replyset_reply r ON r.id = qr.reply_id
             WHERE r.replyset_id = ?1
             ORDER BY r.ordinal ASC, r.id ASC",
        )?;
        let mut by_question: HashMap<i64, (Vec<i64>, Vec<i64>)> = HashMap::new();
        let rows = link_stmt.query_map([id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })?;
        for row in rows {
            let (q_id, r_id, m_id) = row?;
            let entry = by_question.entry(q_id).or_default();
            entry.0.push(r_id);
            if let Some(m_id) = m_id {
                entry.1.push(m_id);
            }
        }
        for q in &mut questions {
            if let Some((r_ids, m_ids)) = by_question.remove(&q.id) {
                q.reply_ids = r_ids;
                q.message_ids = m_ids;
            }
        }
    }

    Ok(Some(ReplySetDetail {
        set,
        questions,
        replies,
    }))
}

fn answers_for_reply(
    transaction: &Transaction<'_>,
    reply_id: i64,
) -> Result<Vec<AnswerRef>, StoreError> {
    let mut stmt = transaction.prepare_cached(
        "SELECT q.id, q.revision
         FROM replyset_question q
         JOIN replyset_question_reply qr ON qr.question_id = q.id
         WHERE qr.reply_id = ?1
         ORDER BY q.ordinal ASC, q.id ASC",
    )?;
    let rows = stmt.query_map([reply_id], |row| {
        Ok(AnswerRef {
            question: row.get(0)?,
            revision: row.get(1)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

impl Store {
    /// Settles any reply set left in `sending` from a previous process that
    /// ended unexpectedly: any reply that was mid-SMTP becomes `unknown` (and
    /// its set `unknown`), while sets interrupted between replies or after the
    /// last acceptance recover cleanly to `sent`, `partial`, or `open`.
    pub(super) fn mark_interrupted_replysets(
        connection: &Connection,
        now: i64,
    ) -> Result<(), StoreError> {
        let set_ids: Vec<i64> = {
            let mut stmt = connection.prepare("SELECT id FROM replyset WHERE state = 'sending'")?;
            stmt.query_map([], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        for set_id in set_ids {
            settle_sending_replyset_on(connection, set_id, now)?;
        }
        // Defensive sweep for any orphaned sending reply outside a sending parent.
        connection.execute(
            "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?1
             WHERE send_state = 'sending'",
            [now],
        )?;
        Ok(())
    }

    /// Resolves source messages for a new reply set, verifying each exists, is
    /// shown outside junk/trash in one sending account, and carries a valid
    /// bare ASCII sender address that is not one of the person's own addresses.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn resolve_replyset_sources(
        &self,
        named_account: Option<AccountId>,
        story: Option<i64>,
        messages: &[i64],
    ) -> Result<Result<(AccountId, Vec<ResolvedSource>), SourceRefusal>, StoreError> {
        if let Some(story_id) = story {
            let exists = self
                .connection
                .query_row("SELECT 1 FROM story WHERE id = ?1", [story_id], |_| Ok(()))
                .optional()?
                .is_some();
            if !exists {
                return Ok(Err(SourceRefusal::StoryNotFound(story_id)));
            }
        }
        let accounts = self.accounts()?;
        if let Some(named) = named_account
            && !accounts.iter().any(|a| a.id == named)
        {
            return Ok(Err(SourceRefusal::AccountNotFound));
        }
        let own = own_addresses(&self.connection)?;

        // Check every message exists and collect the accounts currently showing
        // it outside junk/trash.
        let mut msg_exists = self
            .connection
            .prepare_cached("SELECT 1 FROM message WHERE id = ?1")?;
        let mut visible_accounts = self.connection.prepare_cached(
            "SELECT DISTINCT mailbox.account_id
             FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             WHERE observation.message_id = ?1
               AND observation.ended_at IS NULL
               AND mailbox.gone_at IS NULL
               AND mailbox.role NOT IN ('junk', 'trash')
             ORDER BY mailbox.account_id",
        )?;

        let mut common_accounts: Option<HashSet<AccountId>> = None;
        for &msg_id in messages {
            if msg_exists
                .query_row([msg_id], |_| Ok(()))
                .optional()?
                .is_none()
            {
                return Ok(Err(SourceRefusal::MessageNotFound(msg_id)));
            }
            let showing: Vec<AccountId> = visible_accounts
                .query_map([msg_id], |row| Ok(AccountId(row.get(0)?)))?
                .collect::<Result<_, _>>()?;
            if showing.is_empty() {
                return Ok(Err(SourceRefusal::MessageNotVisible(msg_id)));
            }
            if let Some(named) = named_account {
                if !showing.contains(&named) {
                    return Ok(Err(SourceRefusal::MessageNotVisible(msg_id)));
                }
            } else {
                let set: HashSet<AccountId> = showing.into_iter().collect();
                common_accounts = Some(match common_accounts {
                    None => set,
                    Some(prev) => prev.intersection(&set).copied().collect(),
                });
            }
        }

        let account = match named_account {
            Some(named) => named,
            None => {
                let common = common_accounts.unwrap_or_default();
                if common.len() == 1
                    && let Some(&only) = common.iter().next()
                {
                    only
                } else if common.is_empty() {
                    return Ok(Err(SourceRefusal::MessageNotVisible(messages[0])));
                } else {
                    return Ok(Err(SourceRefusal::AmbiguousAccount));
                }
            }
        };

        let mut env_stmt = self.connection.prepare_cached(
            "SELECT sender_address, sender_name, subject, reply_to_differs
             FROM envelope WHERE message_id = ?1",
        )?;
        let mut resolved = Vec::with_capacity(messages.len());
        for &msg_id in messages {
            let Some((sender_addr, sender_name, subject, reply_to_differs)) = env_stmt
                .query_row([msg_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .optional()?
            else {
                return Ok(Err(SourceRefusal::InvalidSender(msg_id)));
            };
            // Read the original `From` header from the held header blob so the
            // local part's case is preserved (RFC 5321); `envelope.sender_address`
            // is lowercased in full for sender grouping.
            let raw_from = match self.read_part(MessageId(msg_id), "header") {
                Ok(raw) if raw.len() <= derive::HEADER_LIMIT => mail_parser::MessageParser::new()
                    .parse_headers(&raw)
                    .and_then(|parsed| {
                        parsed
                            .from()
                            .and_then(|from| from.first())
                            .and_then(|mailbox| mailbox.address())
                            .map(str::to_string)
                    }),
                _ => None,
            };
            let candidate = raw_from.as_deref().unwrap_or(&sender_addr);
            let Some(clean_addr) = address(candidate) else {
                return Ok(Err(SourceRefusal::InvalidSender(msg_id)));
            };
            if own.contains(&clean_addr.to_ascii_lowercase()) {
                return Ok(Err(SourceRefusal::OwnSender(msg_id)));
            }
            resolved.push(ResolvedSource {
                message: msg_id,
                recipient_address: clean_addr,
                recipient_name: sender_name,
                reply_to_differs: reply_to_differs != 0,
                subject: reply_subject_from(&subject),
            });
        }

        Ok(Ok((account, resolved)))
    }

    /// Loads reply set `id` with all of its questions and replies.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn replyset(&self, id: i64) -> Result<Option<ReplySetDetail>, StoreError> {
        load_replyset_on(&self.connection, id)
    }

    /// Creates a new reply set inside a single transaction, running
    /// `check_preview` before committing so an oversized set leaves nothing
    /// written (`PREVIEW_TOO_LARGE`).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn create_replyset(
        &mut self,
        new: &NewReplySet,
        creator: &Proposer,
        now: i64,
        check_preview: impl FnOnce(&ReplySetDetail) -> bool,
    ) -> Result<Result<ReplySetDetail, ReplySetRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let creator_name = token_name_on(&transaction, creator)?;
        transaction.execute(
            "INSERT INTO replyset
                 (account_id, story_id, shared_text, revision, state,
                  creator_kind, creator_id, creator_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, 'open', ?4, ?5, ?6, ?7, ?7)",
            params![
                new.account.0,
                new.story,
                new.shared_text,
                creator.kind,
                creator.id,
                creator_name,
                now,
            ],
        )?;
        let set_id = transaction.last_insert_rowid();

        let mut reply_by_message: HashMap<i64, i64> = HashMap::with_capacity(new.sources.len());
        for (ordinal, src) in new.sources.iter().enumerate() {
            transaction.execute(
                "INSERT INTO replyset_reply
                     (replyset_id, ordinal, message_id, recipient_address, recipient_name,
                      reply_to_differs, subject, generation, updated_at, send_state)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, 'none')",
                params![
                    set_id,
                    i64::try_from(ordinal).unwrap_or(i64::MAX),
                    src.message,
                    src.recipient_address,
                    src.recipient_name,
                    i64::from(src.reply_to_differs),
                    src.subject,
                    now,
                ],
            )?;
            let reply_id = transaction.last_insert_rowid();
            reply_by_message.insert(src.message, reply_id);
        }

        for (ordinal, q) in new.questions.iter().enumerate() {
            let (ans_kind, ans_id, ans_name) = if q.answer.is_some() {
                (
                    Some(creator.kind.as_str()),
                    creator.id.as_deref(),
                    creator_name.as_deref(),
                )
            } else {
                (None, None, None)
            };
            transaction.execute(
                "INSERT INTO replyset_question
                     (replyset_id, ordinal, question, answer, revision,
                      answered_by_kind, answered_by_id, answered_by_name, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8)",
                params![
                    set_id,
                    i64::try_from(ordinal).unwrap_or(i64::MAX),
                    q.question,
                    q.answer,
                    ans_kind,
                    ans_id,
                    ans_name,
                    now,
                ],
            )?;
            let q_id = transaction.last_insert_rowid();
            for &msg_id in &q.messages {
                if let Some(&reply_id) = reply_by_message.get(&msg_id) {
                    transaction.execute(
                        "INSERT OR IGNORE INTO replyset_question_reply (question_id, reply_id)
                         VALUES (?1, ?2)",
                        params![q_id, reply_id],
                    )?;
                }
            }
        }

        let detail =
            load_replyset_on(&transaction, set_id)?.ok_or(StoreError::NotFound("replyset"))?;
        if !check_preview(&detail) {
            // Rolling back leaves nothing stored.
            return Ok(Err(ReplySetRefusal::PreviewTooLarge));
        }
        transaction.commit()?;
        Ok(Ok(detail))
    }

    /// Updates a reply set at `expected_revision` (shared text, answers, and/or
    /// editing a reply's text). Checks `check_preview` before committing.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn update_replyset(
        &mut self,
        id: i64,
        expected_revision: i64,
        change: &ReplySetChange,
        editor: &Proposer,
        now: i64,
        check_preview: impl FnOnce(&ReplySetDetail) -> bool,
    ) -> Result<Result<ReplySetDetail, ReplySetRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let Some(current) = load_replyset_on(&transaction, id)? else {
            return Ok(Err(ReplySetRefusal::NotFound));
        };
        match current.set.state {
            ReplySetState::Sending => return Ok(Err(ReplySetRefusal::Sending)),
            ReplySetState::Sent => return Ok(Err(ReplySetRefusal::Sent)),
            ReplySetState::Unknown => return Ok(Err(ReplySetRefusal::Unknown)),
            ReplySetState::Open | ReplySetState::Partial => {}
        }
        if current.set.revision != expected_revision {
            return Ok(Err(ReplySetRefusal::Changed {
                revision: current.set.revision,
            }));
        }
        let editor_name = token_name_on(&transaction, editor)?;

        if let Some(shared) = &change.shared_text {
            transaction.execute(
                "UPDATE replyset SET shared_text = ?2 WHERE id = ?1",
                params![id, shared],
            )?;
        }

        let mut bumped_replies: HashSet<i64> = HashSet::new();
        for upd in &change.answers {
            let Some(q) = current.questions.iter().find(|q| q.id == upd.question) else {
                return Ok(Err(ReplySetRefusal::QuestionNotFound(upd.question)));
            };
            transaction.execute(
                "UPDATE replyset_question
                 SET answer = ?2, revision = revision + 1,
                     answered_by_kind = ?3, answered_by_id = ?4, answered_by_name = ?5,
                     updated_at = ?6
                 WHERE id = ?1 AND replyset_id = ?7",
                params![
                    q.id,
                    upd.answer,
                    editor.kind,
                    editor.id,
                    editor_name,
                    now,
                    id
                ],
            )?;
            for &reply_id in &q.reply_ids {
                bumped_replies.insert(reply_id);
            }
        }
        for reply_id in bumped_replies {
            // Only bump generation for replies not already sent/unknown, and
            // invalidate any open handout so a composer never attests to stale answers.
            transaction.execute(
                "UPDATE replyset_reply
                 SET generation = generation + 1,
                     handed_unit = NULL, handed_source_text_digest = NULL,
                     handed_answers_snapshot = NULL, updated_at = ?2
                 WHERE id = ?1 AND send_state IN ('none', 'failed')",
                params![reply_id, now],
            )?;
        }

        if let Some(edit) = &change.edit {
            let Some(reply) = current.replies.iter().find(|r| r.id == edit.reply) else {
                return Ok(Err(ReplySetRefusal::ReplyNotFound(edit.reply)));
            };
            if !matches!(
                reply.send_state,
                ReplySendState::None | ReplySendState::Failed
            ) {
                return Ok(Err(ReplySetRefusal::ReplyLocked(edit.reply)));
            }
            transaction.execute(
                "UPDATE replyset_reply
                 SET text = ?2, source = 'edited', generation = generation + 1,
                     author_kind = ?3, author_id = ?4, author_name = ?5,
                     handed_unit = NULL, handed_source_text_digest = NULL,
                     handed_answers_snapshot = NULL, text_digest = ?6, updated_at = ?7
                 WHERE id = ?1 AND replyset_id = ?8",
                params![
                    edit.reply,
                    edit.text,
                    editor.kind,
                    editor.id,
                    editor_name,
                    edit.text_digest,
                    now,
                    id,
                ],
            )?;
            transaction.execute(
                "INSERT INTO replyset_event
                     (reply_id, kind, actor_kind, actor_id, actor_name, text_digest, at)
                 VALUES (?1, 'edited', ?2, ?3, ?4, ?5, ?6)",
                params![
                    edit.reply,
                    editor.kind,
                    editor.id,
                    editor_name,
                    edit.text_digest,
                    now
                ],
            )?;
        }

        let updated = transaction.execute(
            "UPDATE replyset SET revision = revision + 1, updated_at = ?3
             WHERE id = ?1 AND revision = ?2 AND state IN ('open', 'partial')",
            params![id, expected_revision, now],
        )?;
        if updated != 1 {
            return Ok(Err(ReplySetRefusal::Changed {
                revision: current.set.revision,
            }));
        }

        let detail = load_replyset_on(&transaction, id)?.ok_or(StoreError::NotFound("replyset"))?;
        if !check_preview(&detail) {
            return Ok(Err(ReplySetRefusal::PreviewTooLarge));
        }
        transaction.commit()?;
        Ok(Ok(detail))
    }

    /// Records the exact unit id, source text digest, and answer revisions
    /// handed out by `mail-replyset-next` for a reply's current generation,
    /// without mutating `replyset.revision` or `updated_at`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn record_replyset_handout(
        &mut self,
        set_id: i64,
        reply_id: i64,
        generation: i64,
        unit_id: &str,
        source_text_digest: &str,
        answers_snapshot: &str,
    ) -> Result<bool, StoreError> {
        let changed = self.connection.execute(
            "UPDATE replyset_reply
             SET handed_unit = ?4, handed_source_text_digest = ?5,
                 handed_answers_snapshot = ?6
             WHERE id = ?1 AND replyset_id = ?2 AND generation = ?3
               AND text IS NULL AND send_state IN ('none', 'failed')",
            params![
                reply_id,
                set_id,
                generation,
                unit_id,
                source_text_digest,
                answers_snapshot,
            ],
        )?;
        Ok(changed == 1)
    }

    /// Records a composed reply submitted through `mail-replyset-next`, verifying
    /// that an open handout exists for the reply's current generation and answers
    /// and keeping the exact handed-out unit id, source message text digest, and
    /// answer revisions in the reply row and in `replyset_event`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn submit_replyset_reply(
        &mut self,
        set_id: i64,
        reply_id: i64,
        submission: &ReplySubmission,
        submitter: &Proposer,
        now: i64,
        check_preview: impl FnOnce(&ReplySetDetail) -> bool,
    ) -> Result<Result<(ReplySetDetail, ReplyRow), ReplySetRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let Some(current) = load_replyset_on(&transaction, set_id)? else {
            return Ok(Err(ReplySetRefusal::NotFound));
        };
        match current.set.state {
            ReplySetState::Sending => return Ok(Err(ReplySetRefusal::Sending)),
            ReplySetState::Sent => return Ok(Err(ReplySetRefusal::Sent)),
            ReplySetState::Unknown => return Ok(Err(ReplySetRefusal::Unknown)),
            ReplySetState::Open | ReplySetState::Partial => {}
        }
        let Some(reply) = current.replies.iter().find(|r| r.id == reply_id) else {
            return Ok(Err(ReplySetRefusal::ReplyNotFound(reply_id)));
        };
        if !matches!(
            reply.send_state,
            ReplySendState::None | ReplySendState::Failed
        ) {
            return Ok(Err(ReplySetRefusal::ReplyLocked(reply_id)));
        }

        let unit_id = reply.current_unit_id();
        if let Some(named_unit) = submission.unit.as_deref()
            && named_unit != unit_id
        {
            return Ok(Err(ReplySetRefusal::UnitNotOpen));
        }
        let (Some(handed_unit), Some(handed_digest), Some(handed_answers)) = (
            reply.handed_unit.as_deref(),
            reply.handed_source_text_digest.as_deref(),
            reply.handed_answers_snapshot.as_deref(),
        ) else {
            return Ok(Err(ReplySetRefusal::UnitNotOpen));
        };
        if handed_unit != unit_id {
            return Ok(Err(ReplySetRefusal::UnitNotOpen));
        }
        let current_answers = answers_for_reply(&transaction, reply_id)?;
        let current_answers_json =
            serde_json::to_string(&current_answers).unwrap_or_else(|_| "[]".to_string());
        if current_answers_json != handed_answers {
            return Ok(Err(ReplySetRefusal::UnitNotOpen));
        }
        let submitter_name = token_name_on(&transaction, submitter)?;

        transaction.execute(
            "UPDATE replyset_reply
             SET text = ?2, source = 'submitted', generation = generation + 1,
                 author_kind = ?3, author_id = ?4, author_name = ?5,
                 source_unit = ?6, source_text_digest = ?7, answers_snapshot = ?8,
                 handed_unit = NULL, handed_source_text_digest = NULL,
                 handed_answers_snapshot = NULL, text_digest = ?9, updated_at = ?10
             WHERE id = ?1 AND replyset_id = ?11",
            params![
                reply_id,
                submission.text,
                submitter.kind,
                submitter.id,
                submitter_name,
                unit_id,
                handed_digest,
                handed_answers,
                submission.text_digest,
                now,
                set_id,
            ],
        )?;
        transaction.execute(
            "INSERT INTO replyset_event
                 (reply_id, kind, unit_id, source_message_id, source_text_digest,
                  answers_snapshot, actor_kind, actor_id, actor_name, text_digest, at)
             VALUES (?1, 'submitted', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                reply_id,
                unit_id,
                reply.message,
                handed_digest,
                handed_answers,
                submitter.kind,
                submitter.id,
                submitter_name,
                submission.text_digest,
                now,
            ],
        )?;
        transaction.execute(
            "UPDATE replyset SET revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![set_id, now],
        )?;

        let detail =
            load_replyset_on(&transaction, set_id)?.ok_or(StoreError::NotFound("replyset"))?;
        if !check_preview(&detail) {
            return Ok(Err(ReplySetRefusal::PreviewTooLarge));
        }
        let updated_reply = detail
            .replies
            .iter()
            .find(|r| r.id == reply_id)
            .cloned()
            .ok_or(StoreError::NotFound("replyset_reply"))?;
        transaction.commit()?;
        Ok(Ok((detail, updated_reply)))
    }

    /// Atomically verifies `set_id` is sendable at `expected_revision` and
    /// every reply has non-empty text, then transitions `replyset.state` to
    /// `'sending'`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn begin_replyset_send(
        &mut self,
        set_id: i64,
        expected_revision: i64,
    ) -> Result<Result<(ReplySetDetail, AccountRow), ReplySetSendRefusal>, StoreError> {
        let transaction = self.connection.transaction()?;
        let Some(mut detail) = load_replyset_on(&transaction, set_id)? else {
            return Ok(Err(ReplySetSendRefusal::NotFound));
        };
        match detail.set.state {
            ReplySetState::Sending => return Ok(Err(ReplySetSendRefusal::Sending)),
            ReplySetState::Sent => return Ok(Err(ReplySetSendRefusal::Sent)),
            ReplySetState::Unknown => return Ok(Err(ReplySetSendRefusal::Unknown)),
            ReplySetState::Open | ReplySetState::Partial => {}
        }
        if detail.set.revision != expected_revision {
            return Ok(Err(ReplySetSendRefusal::Changed {
                revision: detail.set.revision,
            }));
        }
        if detail
            .replies
            .iter()
            .any(|r| r.send_state == ReplySendState::Unknown)
        {
            return Ok(Err(ReplySetSendRefusal::Unknown));
        }
        let missing = detail
            .replies
            .iter()
            .filter(|r| r.text.as_deref().is_none_or(|t| t.trim().is_empty()))
            .count();
        if missing > 0 {
            return Ok(Err(ReplySetSendRefusal::Incomplete { missing }));
        }
        let pending = detail
            .replies
            .iter()
            .filter(|r| matches!(r.send_state, ReplySendState::None | ReplySendState::Failed))
            .count();
        if pending == 0 {
            return Ok(Err(ReplySetSendRefusal::NothingToSend));
        }
        let account: Option<AccountRow> = transaction
            .query_row(
                "SELECT id, provider, address FROM account WHERE id = ?1",
                [detail.set.account.0],
                |row| {
                    Ok(AccountRow {
                        id: AccountId(row.get(0)?),
                        provider: row.get(1)?,
                        address: row.get(2)?,
                    })
                },
            )
            .optional()?;
        let Some(account) = account else {
            return Ok(Err(ReplySetSendRefusal::AccountNotFound));
        };
        let changed = transaction.execute(
            "UPDATE replyset SET state = 'sending'
             WHERE id = ?1 AND revision = ?2 AND state IN ('open', 'partial')",
            params![set_id, expected_revision],
        )?;
        if changed != 1 {
            return Ok(Err(ReplySetSendRefusal::Changed {
                revision: detail.set.revision,
            }));
        }
        transaction.commit()?;
        detail.set.state = ReplySetState::Sending;
        Ok(Ok((detail, account)))
    }

    /// Marks one reply of a sending reply set as `'sending'` and inserts its
    /// `outbound` row (`kind = 'replyset'`).
    ///
    /// # Errors
    /// When the database refuses.
    #[allow(clippy::too_many_arguments)]
    pub fn begin_replyset_reply_send(
        &mut self,
        set_id: i64,
        reply_id: i64,
        account: AccountId,
        approved_revision: i64,
        message_id: &str,
        sender: &Proposer,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO outbound
                 (account_id, draft_id, draft_revision, kind, message_id, recipients, state,
                  sent_copy, sender_kind, sender_id, started_at)
             VALUES (?1, NULL, ?2, 'replyset', ?3, 1, 'sending', 0, ?4, ?5, ?6)",
            params![
                account.0,
                approved_revision,
                message_id,
                sender.kind,
                sender.id,
                now,
            ],
        )?;
        let outbound_id = transaction.last_insert_rowid();
        let changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'sending', outbound_id = ?2, updated_at = ?3
             WHERE id = ?1 AND replyset_id = ?4 AND send_state IN ('none', 'failed')",
            params![reply_id, outbound_id, now, set_id],
        )?;
        if changed != 1 {
            return Err(StoreError::NotFound("replyset_reply"));
        }
        transaction.commit()?;
        Ok(outbound_id)
    }

    /// Marks one reply and its `outbound` row as `'sent'`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_sent(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'sent', finished_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now],
        )?;
        let reply_changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'sent', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        if out_changed != 1 || reply_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        transaction.commit()?;
        Ok(())
    }

    /// Marks one reply and its `outbound` row as `'failed'` (definitely not sent).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_failed(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        error: &str,
        now: i64,
    ) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        let out_changed = transaction.execute(
            "UPDATE outbound SET state = 'failed', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        let reply_changed = transaction.execute(
            "UPDATE replyset_reply SET send_state = 'failed', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        if out_changed != 1 || reply_changed != 1 {
            return Err(StoreError::NotFound("outbound"));
        }
        transaction.commit()?;
        Ok(())
    }

    /// Marks one reply, its `outbound` row, and its parent reply set as
    /// `'unknown'` (never retried), raising the set's revision.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_reply_unknown(
        &mut self,
        outbound_id: i64,
        reply_id: i64,
        set_id: i64,
        error: &str,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE outbound SET state = 'unknown', finished_at = ?2, error = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![outbound_id, now, error],
        )?;
        transaction.execute(
            "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?2
             WHERE id = ?1 AND send_state = 'sending'",
            params![reply_id, now],
        )?;
        transaction.execute(
            "UPDATE replyset SET state = 'unknown', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, now],
        )?;
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM replyset WHERE id = ?1",
                [set_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("replyset"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Finalizes `replyset.state` out of `'sending'`, optionally raising
    /// `revision`, and returns the resulting revision.
    ///
    /// When `raise_revision` is `false` (used only when restoring `'open'`
    /// before any reply row was mutated), `updated_at` is also left unchanged
    /// so the rendered preview remains identical under the same revision.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn finish_replyset_send(
        &mut self,
        set_id: i64,
        final_state: ReplySetState,
        raise_revision: bool,
        now: i64,
    ) -> Result<i64, StoreError> {
        let transaction = self.connection.transaction()?;
        if raise_revision {
            transaction.execute(
                "UPDATE replyset SET state = ?2, revision = revision + 1, updated_at = ?3
                 WHERE id = ?1 AND state = 'sending'",
                params![set_id, final_state.as_str(), now],
            )?;
        } else {
            transaction.execute(
                "UPDATE replyset SET state = ?2
                 WHERE id = ?1 AND state = 'sending'",
                params![set_id, final_state.as_str()],
            )?;
        }
        let revision: i64 = transaction
            .query_row(
                "SELECT revision FROM replyset WHERE id = ?1",
                [set_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(StoreError::NotFound("replyset"))?;
        transaction.commit()?;
        Ok(revision)
    }

    /// Settles a reply set whose future was dropped mid-batch: marks any
    /// in-flight reply + outbound as `'unknown'`, or transitions the set cleanly
    /// to `'sent'`, `'partial'`, or `'open'` based on its replies' states.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn settle_interrupted_replyset(&mut self, set_id: i64, now: i64) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        settle_sending_replyset_on(&transaction, set_id, now)?;
        transaction.commit()?;
        Ok(())
    }
}

/// Shared settlement logic for both in-process drop recovery and store reopen:
/// marks any reply still in `'sending'` (and its `'sending'` outbound row) as
/// `'unknown'` and sets the parent `'unknown'`, or otherwise derives the parent
/// state from the persisted child reply states (`'unknown'`, `'sent'`,
/// `'partial'`, or `'open'`).
fn settle_sending_replyset_on(
    connection: &Connection,
    set_id: i64,
    now: i64,
) -> Result<(), StoreError> {
    let why =
        "the send was interrupted before its outcome was recorded; whether it went is not known";
    let in_flight: Vec<(i64, Option<i64>)> = {
        let mut stmt = connection.prepare(
            "SELECT id, outbound_id FROM replyset_reply
             WHERE replyset_id = ?1 AND send_state = 'sending'",
        )?;
        stmt.query_map([set_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?
    };
    if !in_flight.is_empty() {
        for (reply_id, outbound_id) in in_flight {
            if let Some(outbound_id) = outbound_id {
                connection.execute(
                    "UPDATE outbound SET state = 'unknown', finished_at = ?2, error = ?3
                     WHERE id = ?1 AND state = 'sending'",
                    params![outbound_id, now, why],
                )?;
            }
            connection.execute(
                "UPDATE replyset_reply SET send_state = 'unknown', updated_at = ?2
                 WHERE id = ?1",
                params![reply_id, now],
            )?;
        }
        connection.execute(
            "UPDATE replyset SET state = 'unknown', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, now],
        )?;
        return Ok(());
    }
    let (total, sent, failed, unknown): (i64, i64, i64, i64) = connection.query_row(
        "SELECT count(*),
                coalesce(sum(CASE WHEN send_state = 'sent' THEN 1 ELSE 0 END), 0),
                coalesce(sum(CASE WHEN send_state = 'failed' THEN 1 ELSE 0 END), 0),
                coalesce(sum(CASE WHEN send_state = 'unknown' THEN 1 ELSE 0 END), 0)
         FROM replyset_reply WHERE replyset_id = ?1",
        [set_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let (state, bump) = if unknown > 0 {
        ("unknown", true)
    } else if sent == total && total > 0 {
        ("sent", true)
    } else if sent > 0 {
        ("partial", true)
    } else if failed > 0 {
        ("open", true)
    } else {
        ("open", false)
    };
    if bump {
        connection.execute(
            "UPDATE replyset SET state = ?2, revision = revision + 1, updated_at = ?3
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, state, now],
        )?;
    } else {
        connection.execute(
            "UPDATE replyset SET state = ?2
             WHERE id = ?1 AND state = 'sending'",
            params![set_id, state],
        )?;
    }
    Ok(())
}
