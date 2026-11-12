//! What the read commands read from the store (the specification's section
//! 11): a thread's messages, one message's row and evidence, its links and
//! parts, and where a message is shown, which is where it can be fetched
//! from.

use rusqlite::{OptionalExtension, params};

use super::{AccountId, MailboxId, MessageId, Role, Store, StoreError, ThreadId, count};

/// A message as a list of a thread shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageListed {
    /// The message.
    pub message: MessageId,
    /// Its thread.
    pub thread: ThreadId,
    /// The date it is listed under, in milliseconds.
    pub date: i64,
    /// The sender's address, as the header wrote it.
    pub sender_address: String,
    /// The sender's name, as the header wrote it.
    pub sender_name: String,
    /// The subject, as the header wrote it.
    pub subject: String,
    /// The start of its visible text; empty until the body is held.
    pub snippet: String,
    /// How many attachments it has, once the body is held.
    pub attachments: u64,
    /// The size the provider reports.
    pub size: u64,
    /// Whether the whole message is held.
    pub held_whole: bool,
    /// Why it could not be read, in the engine's words.
    pub unparsed: Option<String>,
    /// The evidence the store keeps for it.
    pub evidence: Evidence,
}

/// What the store keeps of a message's evidence (the specification's 6.1).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Evidence {
    /// Whether it came through a list.
    pub list: bool,
    /// 0 no unsubscribe header, 1 `List-Unsubscribe`, 2 one-click.
    pub unsubscribe: u8,
    /// Whether `Precedence` says bulk, list or junk, or `Auto-Submitted`
    /// says it was sent by a program.
    pub bulk: bool,
    /// Whether `Reply-To` names another address than the sender.
    pub reply_to_differs: bool,
    /// The server that wrote the authentication results read, if any.
    pub auth_server: String,
    /// Its SPF, DKIM and DMARC results.
    pub auth: [String; 3],
    /// Characters a person would not see.
    pub hidden_chars: u64,
    /// Links, and how many name another site than they go to.
    pub links: u64,
    /// Of them, how many are marked.
    pub mismatched_links: u64,
    /// Files whose bytes are another kind than they say.
    pub files_differing: u64,
}

/// Where a message is shown: a mailbox of an account, and the provider's id
/// for it there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shown {
    /// The account.
    pub account: AccountId,
    /// The account's provider.
    pub provider: String,
    /// The mailbox.
    pub mailbox: MailboxId,
    /// The provider's name for the mailbox.
    pub mailbox_key: String,
    /// What the mailbox is for.
    pub role: Role,
    /// The generation the provider's id belongs to.
    pub validity: String,
    /// The provider's id for the message in the mailbox.
    pub provider_id: String,
    /// Its flags there, as a JSON array.
    pub flags: String,
}

/// One link of a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRow {
    /// Where it goes, as written.
    pub target: String,
    /// The host it goes to.
    pub target_host: String,
    /// The host its text names.
    pub text_host: String,
    /// Whether the two differ.
    pub mismatched: bool,
}

/// One part of a message held whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartRow {
    /// Its place, as IMAP numbers it.
    pub place: String,
    /// Its declared type.
    pub content_type: String,
    /// Its file name.
    pub name: String,
    /// Its size once decoded.
    pub size: u64,
    /// Whether it is offered as an attachment.
    pub attachment: bool,
    /// Its type as its bytes show it.
    pub detected: String,
    /// Whether that differs from what it says it is.
    pub type_differs: bool,
}

/// The columns a [`MessageListed`] is read from, after `envelope` joined
/// with `message`.
const LISTED: &str = "envelope.message_id, envelope.thread_id, envelope.date,
    envelope.sender_address, envelope.sender_name, envelope.subject, envelope.snippet,
    envelope.attachments, message.reported_size,
    EXISTS (SELECT 1 FROM held WHERE held.message_id = envelope.message_id
            AND held.part = 'whole'),
    envelope.unparsed, envelope.list_id, envelope.unsubscribe, envelope.precedence,
    envelope.auto_submitted, envelope.reply_to_differs, envelope.auth_server,
    envelope.auth_spf, envelope.auth_dkim, envelope.auth_dmarc, envelope.hidden_chars,
    envelope.links, envelope.mismatched_links,
    (SELECT count(*) FROM part WHERE part.message_id = envelope.message_id
     AND part.type_differs = 1)";

fn listed(row: &rusqlite::Row<'_>) -> rusqlite::Result<MessageListed> {
    let precedence: String = row.get(13)?;
    let auto_submitted: String = row.get(14)?;
    Ok(MessageListed {
        message: MessageId(row.get(0)?),
        thread: ThreadId(row.get(1)?),
        date: row.get(2)?,
        sender_address: row.get(3)?,
        sender_name: row.get(4)?,
        subject: row.get(5)?,
        snippet: row.get(6)?,
        attachments: count(row.get(7)?),
        size: count(row.get(8)?),
        held_whole: row.get(9)?,
        unparsed: row.get(10)?,
        evidence: Evidence {
            list: !row.get::<_, String>(11)?.is_empty(),
            unsubscribe: row.get(12)?,
            bulk: matches!(precedence.as_str(), "bulk" | "list" | "junk")
                || !auto_submitted.is_empty(),
            reply_to_differs: row.get(15)?,
            auth_server: row.get(16)?,
            auth: [row.get(17)?, row.get(18)?, row.get(19)?],
            hidden_chars: count(row.get(20)?),
            links: count(row.get(21)?),
            mismatched_links: count(row.get(22)?),
            files_differing: count(row.get(23)?),
        },
    })
}

impl Store {
    /// A thread's messages, oldest first: at most `limit`, starting after
    /// `after` (the date and id of the last message of the page before).
    ///
    /// # Errors
    /// When the database refuses.
    pub fn thread_messages(
        &self,
        thread: ThreadId,
        after: Option<(i64, MessageId)>,
        limit: u32,
    ) -> Result<Vec<MessageListed>, StoreError> {
        let (date, message) =
            after.map_or((i64::MIN, i64::MIN), |(date, message)| (date, message.0));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {LISTED} FROM envelope JOIN message ON message.id = envelope.message_id
             WHERE envelope.thread_id = ?1 AND (envelope.date, envelope.message_id) > (?2, ?3)
             ORDER BY envelope.date, envelope.message_id LIMIT ?4"
        ))?;
        let rows = statement.query_map(params![thread.0, date, message, limit], listed)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// One message as a list shows it, or `None` when there is no such
    /// message.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn message_listed(&self, message: MessageId) -> Result<Option<MessageListed>, StoreError> {
        Ok(self
            .connection
            .prepare_cached(&format!(
                "SELECT {LISTED} FROM envelope JOIN message ON message.id = envelope.message_id
                 WHERE envelope.message_id = ?1"
            ))?
            .query_row([message.0], listed)
            .optional()?)
    }

    /// Whether a thread exists.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn thread_exists(&self, thread: ThreadId) -> Result<bool, StoreError> {
        Ok(self
            .connection
            .query_row("SELECT 1 FROM thread WHERE id = ?1", [thread.0], |_| Ok(()))
            .optional()?
            .is_some())
    }

    /// Where a message is shown now, newest observation first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn where_shown(&self, message: MessageId) -> Result<Vec<Shown>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT account.id, account.provider, mailbox.id, mailbox.provider_key, mailbox.role,
                    observation.validity, observation.provider_id, observation.flags
             FROM observation
             JOIN mailbox ON mailbox.id = observation.mailbox_id
             JOIN account ON account.id = mailbox.account_id
             WHERE observation.message_id = ?1 AND observation.ended_at IS NULL
               AND mailbox.gone_at IS NULL
             ORDER BY observation.id DESC",
        )?;
        let rows = statement.query_map([message.0], |row| {
            let role: String = row.get(4)?;
            Ok(Shown {
                account: AccountId(row.get(0)?),
                provider: row.get(1)?,
                mailbox: MailboxId(row.get(2)?),
                mailbox_key: row.get(3)?,
                role: Role::parse(&role).unwrap_or(Role::None),
                validity: row.get(5)?,
                provider_id: row.get(6)?,
                flags: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// A message's links, in order.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn message_links(&self, message: MessageId) -> Result<Vec<LinkRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT target, target_host, text_host, mismatched FROM link
             WHERE message_id = ?1 ORDER BY ordinal",
        )?;
        let rows = statement.query_map([message.0], |row| {
            Ok(LinkRow {
                target: row.get(0)?,
                target_host: row.get(1)?,
                text_host: row.get(2)?,
                mismatched: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// A message's parts, in order of their places.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn message_parts(&self, message: MessageId) -> Result<Vec<PartRow>, StoreError> {
        let mut statement = self.connection.prepare_cached(
            "SELECT place, content_type, name, size, attachment, detected, type_differs
             FROM part WHERE message_id = ?1",
        )?;
        let rows = statement.query_map([message.0], |row| {
            Ok(PartRow {
                place: row.get(0)?,
                content_type: row.get(1)?,
                name: row.get(2)?,
                size: count(row.get(3)?),
                attachment: row.get(4)?,
                detected: row.get(5)?,
                type_differs: row.get(6)?,
            })
        })?;
        let mut parts: Vec<PartRow> = rows.collect::<Result<_, _>>()?;
        // `1.10` after `1.9`: places compared number by number.
        parts.sort_by_key(|part| {
            part.place
                .split('.')
                .map(|number| number.parse::<u32>().unwrap_or(u32::MAX))
                .collect::<Vec<_>>()
        });
        Ok(parts)
    }

    /// Whether a mailbox exists and the provider still lists it.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn mailbox_exists(&self, mailbox: MailboxId) -> Result<bool, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT 1 FROM mailbox WHERE id = ?1 AND gone_at IS NULL",
                [mailbox.0],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }
}
