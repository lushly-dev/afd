//! Fixed draft recipient-basis classification, JSON serialization, migration-23
//! backfill, and account-removal refresh (the specification's 9.5 and
//! plugin.spec.md sections 7 and 8.2).

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use super::{DRAFT_COLUMNS, DraftRow, Recipients, draft_row};
use crate::log::{BlobId, Log};
use crate::provider::smtp::clean_message_id;
use crate::store::senders::own_addresses;
use crate::store::{AccountId, StoreError};

/// Why a recipient on a draft is allowed or requires confirmation (the
/// specification's 9.5 and step F's 8.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecipientBasis {
    /// One of the person's own addresses.
    Own,
    /// A participant of the thread being answered.
    Thread,
    /// An address the person has written to before.
    WrittenTo,
    /// None of the above: must be typed at the terminal for this send.
    New,
}

impl RecipientBasis {
    /// As returned in JSON results.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Own => "own",
            Self::Thread => "thread",
            Self::WrittenTo => "written-to",
            Self::New => "new",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "own" => Some(Self::Own),
            "thread" => Some(Self::Thread),
            "written-to" => Some(Self::WrittenTo),
            "new" => Some(Self::New),
            _ => None,
        }
    }
}

/// The basis of each recipient on a draft, parallel to `to`, `cc` and `bcc`,
/// plus whether the answered message's `Reply-To` differs from its sender.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecipientBases {
    /// Basis for each `to` recipient.
    pub to: Vec<RecipientBasis>,
    /// Basis for each `cc` recipient.
    pub cc: Vec<RecipientBasis>,
    /// Basis for each `bcc` recipient.
    pub bcc: Vec<RecipientBasis>,
    /// Whether the message the draft answers has a `Reply-To` that differs
    /// from its sender (flagged in the preview; never silently trusted).
    pub reply_to_differs: bool,
}

pub(super) fn recipient_bases_json(bases: &RecipientBases) -> String {
    let encode = |list: &[RecipientBasis]| -> Vec<&'static str> {
        list.iter().map(|b| b.as_str()).collect()
    };
    json!({
        "to": encode(&bases.to),
        "cc": encode(&bases.cc),
        "bcc": encode(&bases.bcc),
        "replyToDiffers": bases.reply_to_differs,
    })
    .to_string()
}

pub(super) fn recipient_bases_from_json(
    raw: &str,
    recipients: &Recipients,
) -> Option<RecipientBases> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let decode = |key: &str, expected: usize| -> Option<Vec<RecipientBasis>> {
        let arr = value.get(key)?.as_array()?;
        if arr.len() != expected {
            return None;
        }
        arr.iter()
            .map(|item| item.as_str().and_then(RecipientBasis::parse))
            .collect()
    };
    Some(RecipientBases {
        to: decode("to", recipients.to.len())?,
        cc: decode("cc", recipients.cc.len())?,
        bcc: decode("bcc", recipients.bcc.len())?,
        reply_to_differs: value.get("replyToDiffers")?.as_bool()?,
    })
}

/// Backfills `recipient_bases` for any pre-migration-23 drafts that still hold
/// `NULL`, in one transaction, so every migrated draft has a stable preview and
/// send classification immediately on open (plugin.spec.md, sections 7 and 8.2).
/// Skips backfill while a rebuild is marked in progress so empty derived tables
/// do not permanently lose `thread` / `written-to` classifications.
pub(crate) fn backfill_recipient_bases(
    connection: &mut Connection,
    log: &Log,
) -> Result<(), StoreError> {
    let rebuilding: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM engine_state WHERE key = 'rebuild')",
        [],
        |row| row.get(0),
    )?;
    if rebuilding {
        return Ok(());
    }
    let pending: Vec<i64> = {
        let mut stmt = connection.prepare("SELECT id FROM draft WHERE recipient_bases IS NULL")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    if pending.is_empty() {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    for draft_id in pending {
        let row: Option<DraftRow> = transaction
            .query_row(
                &format!("SELECT {DRAFT_COLUMNS} FROM draft WHERE id = ?1"),
                [draft_id],
                draft_row,
            )
            .optional()?;
        if let Some(row) = row {
            let bases = compute_recipient_bases(&transaction, log, &row)?;
            transaction.execute(
                "UPDATE draft SET recipient_bases = ?2 WHERE id = ?1",
                params![draft_id, recipient_bases_json(&bases)],
            )?;
        }
    }
    transaction.commit()?;
    Ok(())
}

/// Refreshes fixed `recipient_bases` on surviving drafts after another account
/// is removed (called inside the removal transaction after `DELETE FROM account`).
///
/// - For each draft in `cleared_drafts` (whose `answers_message_id` was cleared
///   to `NULL` and whose revision already rose), reclassifies every recipient
///   from surviving accounts and surviving sent mail (`surviving_own`,
///   `surviving_written`) with `reply_to_differs = false`.
/// - For any other surviving draft that stored `own` or `written-to` for an
///   address whose evidence belonged solely to the removed account, downgrades
///   those entries and bumps `revision = revision + 1`.
pub(crate) fn refresh_draft_bases_after_account_remove(
    connection: &Connection,
    cleared_drafts: &[i64],
    surviving_own: &HashSet<String>,
    surviving_written: &HashSet<String>,
) -> Result<(), StoreError> {
    let cleared: HashSet<i64> = cleared_drafts.iter().copied().collect();
    let classify_without_thread = |list: &[String]| -> Vec<RecipientBasis> {
        list.iter()
            .map(|addr| {
                let lower = addr.to_lowercase();
                if surviving_own.contains(&lower) {
                    RecipientBasis::Own
                } else if surviving_written.contains(&lower) {
                    RecipientBasis::WrittenTo
                } else {
                    RecipientBasis::New
                }
            })
            .collect()
    };
    let drafts: Vec<DraftRow> = {
        let mut stmt = connection.prepare(&format!("SELECT {DRAFT_COLUMNS} FROM draft"))?;
        let rows = stmt.query_map([], draft_row)?;
        rows.collect::<Result<_, _>>()?
    };
    for row in drafts {
        if cleared.contains(&row.id) {
            let bases = RecipientBases {
                to: classify_without_thread(&row.recipients.to),
                cc: classify_without_thread(&row.recipients.cc),
                bcc: classify_without_thread(&row.recipients.bcc),
                reply_to_differs: false,
            };
            connection.execute(
                "UPDATE draft SET recipient_bases = ?2 WHERE id = ?1",
                params![row.id, recipient_bases_json(&bases)],
            )?;
            continue;
        }
        let Some(mut bases) = row.recipient_bases else {
            let bases = RecipientBases {
                to: classify_without_thread(&row.recipients.to),
                cc: classify_without_thread(&row.recipients.cc),
                bcc: classify_without_thread(&row.recipients.bcc),
                reply_to_differs: false,
            };
            connection.execute(
                "UPDATE draft SET recipient_bases = ?2 WHERE id = ?1",
                params![row.id, recipient_bases_json(&bases)],
            )?;
            continue;
        };
        let mut changed = false;
        let mut downgrade_removed_evidence = |addrs: &[String], list: &mut [RecipientBasis]| {
            for (addr, basis) in addrs.iter().zip(list.iter_mut()) {
                let lower = addr.to_lowercase();
                if *basis == RecipientBasis::Own && !surviving_own.contains(&lower) {
                    *basis = if surviving_written.contains(&lower) {
                        RecipientBasis::WrittenTo
                    } else {
                        RecipientBasis::New
                    };
                    changed = true;
                } else if *basis == RecipientBasis::WrittenTo && !surviving_written.contains(&lower)
                {
                    *basis = RecipientBasis::New;
                    changed = true;
                }
            }
        };
        downgrade_removed_evidence(&row.recipients.to, &mut bases.to);
        downgrade_removed_evidence(&row.recipients.cc, &mut bases.cc);
        downgrade_removed_evidence(&row.recipients.bcc, &mut bases.bcc);
        if changed {
            connection.execute(
                "UPDATE draft SET recipient_bases = ?2, revision = revision + 1 WHERE id = ?1",
                params![row.id, recipient_bases_json(&bases)],
            )?;
        }
    }
    Ok(())
}

/// Computes the recipient basis for every recipient of `draft` on `connection`.
pub(super) fn compute_recipient_bases(
    connection: &Connection,
    log: &Log,
    draft: &DraftRow,
) -> Result<RecipientBases, StoreError> {
    let own = own_addresses(connection)?;
    let (thread_participants, reply_to_differs) = match draft.answers {
        Some(message_id) => thread_participants_for(connection, log, draft.account, message_id)?,
        None => (HashSet::new(), false),
    };
    let mut written_stmt =
        connection.prepare_cached("SELECT written > 0 FROM sender WHERE address = ?1")?;
    let mut classify = |list: &[String]| -> Result<Vec<RecipientBasis>, StoreError> {
        let mut bases = Vec::with_capacity(list.len());
        for addr in list {
            let lower = addr.to_lowercase();
            let basis = if own.contains(&lower) {
                RecipientBasis::Own
            } else if thread_participants.contains(&lower) {
                RecipientBasis::Thread
            } else {
                let written: bool = written_stmt
                    .query_row([&lower], |row| row.get(0))
                    .optional()?
                    .unwrap_or(false);
                if written {
                    RecipientBasis::WrittenTo
                } else {
                    RecipientBasis::New
                }
            };
            bases.push(basis);
        }
        Ok(bases)
    };
    Ok(RecipientBases {
        to: classify(&draft.recipients.to)?,
        cc: classify(&draft.recipients.cc)?,
        bcc: classify(&draft.recipients.bcc)?,
        reply_to_differs,
    })
}

/// Maximum number of visible messages in a thread walked for `thread`
/// recipient authorization; larger threads fall back to the answered message
/// alone so work stays bounded and fail-closed.
const MAX_THREAD_WALK: usize = 500;
/// Maximum header block size read when checking thread links (1 MiB, §6.4).
const HEADER_READ_LIMIT: u64 = 1024 * 1024;

/// Every participant address in the thread of `message_id` (`From`,
/// `Resent-From`, and `To`/`Cc`/`Bcc` of messages reachable from `message_id`
/// solely through messages currently shown in `account` outside junk and
/// trash — never `Reply-To`, which is flagged separately when it differs).
///
/// If `message_id` itself is shown only in junk or trash, no address receives
/// `thread` eligibility. Walking links only across non-junk/trash messages
/// also prevents a spam message carrying forged `References` from bridging
/// two unrelated threads into one eligible set.
fn thread_participants_for(
    connection: &Connection,
    log: &Log,
    account: AccountId,
    message_id: i64,
) -> Result<(HashSet<String>, bool), StoreError> {
    let answered: Option<(i64, i64)> = connection
        .query_row(
            "SELECT thread_id, reply_to_differs FROM envelope WHERE message_id = ?1",
            [message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((thread_id, reply_to_differs)) = answered else {
        return Ok((HashSet::new(), false));
    };
    let answered_visible: bool = connection.query_row(
        "SELECT EXISTS (
                 SELECT 1 FROM observation
                 JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.message_id = ?1
                   AND observation.ended_at IS NULL
                   AND mailbox.account_id = ?2
                   AND mailbox.role NOT IN ('junk', 'trash')
             )",
        params![message_id, account.0],
        |row| row.get(0),
    )?;
    if !answered_visible {
        return Ok((HashSet::new(), reply_to_differs != 0));
    }
    let mut visible_stmt = connection.prepare_cached(
        "SELECT envelope.message_id FROM envelope
         WHERE envelope.thread_id = ?1
           AND EXISTS (
               SELECT 1 FROM observation
               JOIN mailbox ON mailbox.id = observation.mailbox_id
               WHERE observation.message_id = envelope.message_id
                 AND observation.ended_at IS NULL
                 AND mailbox.account_id = ?2
                 AND mailbox.role NOT IN ('junk', 'trash')
           )
         LIMIT ?3",
    )?;
    let candidates: Vec<i64> = visible_stmt
        .query_map(
            params![thread_id, account.0, (MAX_THREAD_WALK + 1) as i64],
            |row| row.get(0),
        )?
        .collect::<Result<_, _>>()?;

    let connected: Vec<i64> = if candidates.len() <= 1 || candidates.len() > MAX_THREAD_WALK {
        vec![message_id]
    } else {
        connected_visible_messages(connection, log, &candidates, message_id)?
    };

    let mut env_stmt = connection
        .prepare_cached("SELECT sender_address, resent_from FROM envelope WHERE message_id = ?1")?;
    let mut rcpt_stmt =
        connection.prepare_cached("SELECT address FROM recipient WHERE message_id = ?1")?;
    let mut participants = HashSet::new();
    for id in connected {
        if let Some((sender, resent)) = env_stmt
            .query_row([id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .optional()?
        {
            if !sender.is_empty() {
                participants.insert(sender.to_lowercase());
            }
            if !resent.is_empty() {
                participants.insert(resent.to_lowercase());
            }
        }
        let rows = rcpt_stmt.query_map([id], |row| row.get::<_, String>(0))?;
        for address in rows {
            participants.insert(address?.to_lowercase());
        }
    }
    Ok((participants, reply_to_differs != 0))
}

/// Computes the connected component of `candidates` reachable from `start`
/// through `Message-ID`, `In-Reply-To` and `References` headers of the
/// `candidates` themselves (excluding any junk/trash bridge messages).
fn connected_visible_messages(
    connection: &Connection,
    log: &Log,
    candidates: &[i64],
    start: i64,
) -> Result<Vec<i64>, StoreError> {
    let mut blob_stmt = connection
        .prepare_cached("SELECT blob FROM held WHERE message_id = ?1 AND part = 'header'")?;
    let mut keys_of: HashMap<i64, Vec<String>> = HashMap::with_capacity(candidates.len());
    let mut by_key: HashMap<String, Vec<i64>> = HashMap::new();
    for &id in candidates {
        let Some(blob) = blob_stmt
            .query_row([id], |row| row.get::<_, Vec<u8>>(0))
            .optional()?
        else {
            continue;
        };
        let Some(blob_id) = BlobId::from_bytes(&blob) else {
            continue;
        };
        let Ok(raw) = log.get(blob_id, HEADER_READ_LIMIT) else {
            continue;
        };
        let Some(parsed) = mail_parser::MessageParser::new().parse_headers(&raw) else {
            continue;
        };
        let mut keys = Vec::new();
        if let Some(mid) = parsed.message_id().and_then(clean_message_id) {
            keys.push(mid);
        }
        if let Some(list) = parsed.in_reply_to() {
            for item in list.iter().take(200) {
                if let Some(mid) = clean_message_id(item) {
                    keys.push(mid);
                }
            }
        }
        if let Some(list) = parsed.references() {
            let skip = list.len().saturating_sub(200);
            for item in list.iter().skip(skip) {
                if let Some(mid) = clean_message_id(item) {
                    keys.push(mid);
                }
            }
        }
        for key in &keys {
            by_key.entry(key.clone()).or_default().push(id);
        }
        keys_of.insert(id, keys);
    }

    let mut visited: HashSet<i64> = HashSet::new();
    let mut queue: VecDeque<i64> = VecDeque::new();
    visited.insert(start);
    queue.push_back(start);
    while let Some(current) = queue.pop_front() {
        if let Some(keys) = keys_of.get(&current) {
            for key in keys {
                if let Some(neighbors) = by_key.get(key) {
                    for &neighbor in neighbors {
                        if visited.insert(neighbor) {
                            queue.push_back(neighbor);
                        }
                    }
                }
            }
        }
    }
    Ok(visited.into_iter().collect())
}
