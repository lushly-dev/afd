//! Senders and their history with the person (the specification's 7.1).
//!
//! A sender is an address that is not the person's. Its row is derived like a
//! thread's: never adjusted, computed again from the messages once for each
//! batch that touched it, so a rebuild gives the same rows, and its id is
//! made from its address, so a rebuild gives the same id.
//!
//! **The person's messages** are those a sent mailbox has shown, now or
//! before: the provider put them there because the person sent them. A
//! message's own `From` never makes it the person's. Otherwise a stranger
//! could write a message "from" the person to themselves and be taken for
//! someone the person wrote to.
//!
//! **The person's own addresses** are the accounts' addresses and the sender
//! of every message of the person's, which covers aliases and send-as
//! addresses. They have no sender row.

use std::collections::{BTreeSet, HashSet};

use rusqlite::{OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

use super::{Kept, MailboxId, Store, StoreError, count, note_change};
use crate::derive::HeaderFields;

/// Whether an envelope's message carries a list or bulk header (the
/// specification's 7.2, rule 3): `List-Id`, `List-Unsubscribe`, a
/// `Precedence` of bulk, list or junk, or an `Auto-Submitted` other than
/// `no`. Written as the partial index `envelope_sender_bulk` is, so a count
/// by sender reads that index alone.
pub(super) const BULK: &str = "(list_id <> '' OR unsubscribe > 0 \
     OR precedence IN ('bulk', 'list', 'junk') OR auto_submitted <> '')";

/// The person's messages, as a join that starts from the sent mailboxes:
/// `CROSS JOIN` keeps SQLite to that order, so that the work is the
/// person's few thousand messages, not a sender's hundreds of thousands.
/// Binds `mine.message_id`.
const PERSONS: &str = "mailbox AS sent CROSS JOIN observation AS mine
     ON mine.mailbox_id = sent.id AND sent.role = 'sent'";

/// The queries a sender's row and the commands read, each by name, so that
/// a test reads the plan of each as the code runs it: a sender's own index
/// range, or the person's messages, never a scan of the mail.
mod query {
    use super::{BULK, PERSONS};

    /// A message's senders, recipients and the sender of what it answers.
    pub(super) const CORRESPONDENTS: &str = "SELECT sender_address FROM envelope
         WHERE message_id = ?1
         UNION SELECT resent_from FROM envelope WHERE message_id = ?1
         UNION SELECT address FROM recipient WHERE message_id = ?1
         UNION SELECT answered.sender_address FROM envelope AS reply
               JOIN envelope AS answered ON answered.message_key = reply.answers_key
               WHERE reply.message_id = ?1";

    /// A sender's messages, and when the first and last arrived.
    pub(super) const COUNTS: &str = "SELECT count(*), min(received), max(received)
         FROM envelope WHERE sender_address = ?1";

    /// The name on a sender's newest message.
    pub(super) const NAME: &str = "SELECT sender_name FROM envelope
         WHERE sender_address = ?1 ORDER BY received DESC, message_id DESC LIMIT 1";

    /// Where a sender's messages are now.
    pub(super) const PLACES: &str =
        "SELECT observation.mailbox_id, count(DISTINCT envelope.message_id) AS shown
         FROM envelope JOIN observation ON observation.message_id = envelope.message_id
         WHERE envelope.sender_address = ?1 AND observation.ended_at IS NULL
         GROUP BY observation.mailbox_id ORDER BY shown DESC, observation.mailbox_id";

    /// The lists a sender's messages came through.
    pub(super) const LISTS: &str = "SELECT list_id, count(*) AS messages FROM envelope
         WHERE sender_address = ?1 AND list_id <> ''
         GROUP BY list_id ORDER BY messages DESC, list_id LIMIT ?2";

    /// How many of a sender's messages carry a list or bulk header.
    pub(super) fn bulk() -> String {
        format!("SELECT count(*) FROM envelope WHERE sender_address = ?1 AND {BULK}")
    }

    /// The person's messages to a sender, and when the last arrived.
    pub(super) fn written() -> String {
        format!(
            "SELECT count(DISTINCT mine.message_id), max(envelope.received) FROM {PERSONS}
                 CROSS JOIN recipient
                     ON recipient.message_id = mine.message_id AND recipient.address = ?1
                 CROSS JOIN envelope ON envelope.message_id = mine.message_id"
        )
    }

    /// A sender's messages the person answered, each Message-ID once.
    pub(super) fn answered() -> String {
        format!(
            "SELECT count(DISTINCT answered.message_key) FROM {PERSONS}
                 CROSS JOIN envelope AS reply ON reply.message_id = mine.message_id
                 CROSS JOIN envelope AS answered
                     ON answered.message_key = reply.answers_key
                        AND answered.sender_address = ?1"
        )
    }

    /// The person's own addresses, as written.
    pub(super) fn own() -> String {
        format!(
            "SELECT address FROM account
             UNION
             SELECT CASE WHEN envelope.resent_from <> '' THEN envelope.resent_from
                         ELSE envelope.sender_address END
                 FROM {PERSONS} CROSS JOIN envelope ON envelope.message_id = mine.message_id"
        )
    }

    /// Every address that has or may need a sender row.
    pub(super) fn every() -> String {
        format!(
            "SELECT DISTINCT sender_address FROM envelope
             UNION SELECT address FROM sender
             UNION SELECT recipient.address FROM {PERSONS}
                 CROSS JOIN recipient ON recipient.message_id = mine.message_id"
        )
    }

    /// Each query by name, for the test of their plans.
    #[cfg(test)]
    pub(in crate::store) fn all() -> Vec<(&'static str, String)> {
        vec![
            ("correspondents", CORRESPONDENTS.to_string()),
            ("counts", COUNTS.to_string()),
            ("name", NAME.to_string()),
            ("places", PLACES.to_string()),
            ("lists", LISTS.to_string()),
            ("bulk", bulk()),
            ("written", written()),
            ("answered", answered()),
            ("own", own()),
            ("every", every()),
        ]
    }
}

#[cfg(test)]
pub(super) use query::all as every_query;

/// A sender as a list shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SenderRow {
    /// Its id, the same in every rebuild.
    pub id: i64,
    /// Its address, in lower case. From a message.
    pub address: String,
    /// The registrable domain of its address. From a message.
    pub domain: String,
    /// The name on its newest message. From a message.
    pub name: String,
    /// How many of its messages the store holds.
    pub messages: u64,
    /// How many of those carry a list or bulk header.
    pub bulk: u64,
    /// When the provider received its first message and its last, in
    /// milliseconds; `None` when it has none.
    pub first_received: Option<i64>,
    /// See `first_received`.
    pub last_received: Option<i64>,
    /// How many of the person's messages were sent to it.
    pub written: u64,
    /// When the provider received the last of them.
    pub last_written: Option<i64>,
    /// How many of its messages the person answered, each Message-ID once.
    pub answered: u64,
    /// The later of its last message and the person's last to it: what a
    /// list is ordered by.
    pub recent: i64,
}

/// A sender's id: the first 52 bits of its address's SHA-256, so the same
/// in every rebuild, and a whole number any JSON reader keeps exactly.
#[must_use]
pub fn sender_id(address: &str) -> i64 {
    let digest = Sha256::digest(address.as_bytes());
    let mut first = [0_u8; 8];
    first.copy_from_slice(&digest[..8]);
    i64::try_from(u64::from_be_bytes(first) >> 12).unwrap_or(0)
}

/// The registrable domain of an address, by the public suffix list:
/// `alerts@mail.example.co.uk` gives `example.co.uk`. An address with no
/// host gives `""`.
#[must_use]
pub fn domain_of(address: &str) -> String {
    let Some((_, host)) = address.rsplit_once('@') else {
        return String::new();
    };
    let host = host.trim_end_matches('.');
    psl::domain_str(host).unwrap_or(host).to_string()
}

/// Records whom a message was sent to, and notes the senders it touches: its
/// own, and when it is the person's (`persons`), its recipients' and the
/// sender of the message it answers. Called once its envelope row is
/// written; whom a row derived before named is the caller's to note, before
/// it replaces the row.
pub(super) fn derive_recipients(
    transaction: &Transaction<'_>,
    message: i64,
    header: &HeaderFields,
    persons: bool,
    touched: &mut super::derived::Touched,
) -> Result<(), StoreError> {
    transaction.run("DELETE FROM recipient WHERE message_id = ?1", [message])?;
    {
        let mut insert = transaction.prepare_cached(
            "INSERT INTO recipient (message_id, address) VALUES (?1, ?2)
             ON CONFLICT DO NOTHING",
        )?;
        for address in &header.recipients {
            insert.execute(params![message, address])?;
        }
    }
    touched.senders.insert(header.sender_address.clone());
    if persons {
        touch_correspondents(transaction, message, touched)?;
    }
    Ok(())
}

/// Notes that `mailbox` now shows `message`: when the mailbox is a sent
/// mailbox, the message is the person's, and the senders it names are
/// computed again.
pub(super) fn observed(
    transaction: &Transaction<'_>,
    mailbox: i64,
    message: i64,
    touched: &mut super::derived::Touched,
) -> Result<(), StoreError> {
    let sent: bool = transaction.one(
        "SELECT role = 'sent' FROM mailbox WHERE id = ?1",
        [mailbox],
        |row| row.get(0),
    )?;
    if sent {
        touch_correspondents(transaction, message, touched)?;
    }
    Ok(())
}

/// Whether a sent mailbox has ever shown `message`.
pub(super) fn is_persons(transaction: &Transaction<'_>, message: i64) -> Result<bool, StoreError> {
    Ok(transaction.one(
        "SELECT EXISTS (SELECT 1 FROM observation JOIN mailbox ON mailbox.id = observation.mailbox_id
                        WHERE observation.message_id = ?1 AND mailbox.role = 'sent')",
        [message],
        |row| row.get(0),
    )?)
}

/// The senders a message of the person's bears on: its own sender and
/// whoever redirected it, which are the person's addresses, its recipients,
/// and the sender of the message it answers.
pub(super) fn touch_correspondents(
    transaction: &Transaction<'_>,
    message: i64,
    touched: &mut super::derived::Touched,
) -> Result<(), StoreError> {
    let mut statement = transaction.prepare_cached(query::CORRESPONDENTS)?;
    let addresses = statement.query_map([message], |row| row.get::<_, String>(0))?;
    for address in addresses {
        touched.senders.insert(address?);
    }
    Ok(())
}

/// The person's own addresses: every account's, and the sender of every
/// message of the person's, or whoever redirected it: a redirect keeps the
/// first sender's `From`, a stranger's. In lower case as the derivation
/// writes a sender (Rust's, which SQLite's `lower` is not beyond ASCII).
pub(super) fn own_addresses(
    connection: &rusqlite::Connection,
) -> Result<HashSet<String>, StoreError> {
    let mut statement = connection.prepare_cached(&query::own())?;
    let addresses = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .map(|address| address.map(|address| address.to_lowercase()))
        .collect::<Result<_, _>>()?;
    Ok(addresses)
}

/// Computes again the row of each of `addresses`, and notes a change for
/// each sender.
pub(super) fn settle_senders(
    transaction: &Transaction<'_>,
    addresses: &BTreeSet<String>,
    now: i64,
) -> Result<(), StoreError> {
    if addresses.is_empty() {
        return Ok(());
    }
    let own = own_addresses(transaction)?;
    for address in addresses {
        if compute_sender(transaction, address, &own)? {
            note_change(transaction, now, "sender", sender_id(address))?;
        }
    }
    Ok(())
}

/// Computes again every sender's row: after the messages that are the
/// person's changed wholesale, when a mailbox became a sent mailbox or
/// stopped being one.
pub(super) fn settle_every_sender(
    transaction: &Transaction<'_>,
    now: i64,
) -> Result<(), StoreError> {
    let addresses: BTreeSet<String> = {
        let mut statement = transaction.prepare(&query::every())?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?
    };
    settle_senders(transaction, &addresses, now)
}

/// Computes `address`'s row again from the messages: written when it has
/// messages or the person wrote to it, and removed otherwise, or when the
/// address is the person's. Returns whether a row was written or removed.
fn compute_sender(
    transaction: &Transaction<'_>,
    address: &str,
    own: &HashSet<String>,
) -> Result<bool, StoreError> {
    if address.is_empty() || own.contains(address) {
        let removed = transaction.run("DELETE FROM sender WHERE address = ?1", [address])?;
        return Ok(removed > 0);
    }
    let (messages, first_received, last_received): (i64, Option<i64>, Option<i64>) = transaction
        .one(query::COUNTS, [address], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    let bulk: i64 = transaction.one(&query::bulk(), [address], |row| row.get(0))?;
    let name: String = transaction
        .one(query::NAME, [address], |row| row.get(0))
        .optional()?
        .unwrap_or_default();
    let (written, last_written): (i64, Option<i64>) =
        transaction.one(&query::written(), [address], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    let answered: i64 = transaction.one(&query::answered(), [address], |row| row.get(0))?;
    if messages == 0 && written == 0 {
        let removed = transaction.run("DELETE FROM sender WHERE address = ?1", [address])?;
        return Ok(removed > 0);
    }
    let recent = last_received.max(last_written).unwrap_or(0);
    // Two addresses whose ids collide (one chance in billions among a
    // person's senders) keep the first: the second is not listed.
    transaction.run(
        "INSERT INTO sender
             (address, id, domain, name, messages, bulk, first_received, last_received,
              written, last_written, answered, recent)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT (address) DO UPDATE SET
             domain = excluded.domain, name = excluded.name, messages = excluded.messages,
             bulk = excluded.bulk, first_received = excluded.first_received,
             last_received = excluded.last_received, written = excluded.written,
             last_written = excluded.last_written, answered = excluded.answered,
             recent = excluded.recent
         ON CONFLICT DO NOTHING",
        params![
            address,
            sender_id(address),
            domain_of(address),
            name,
            messages,
            bulk,
            first_received,
            last_received,
            written,
            last_written,
            answered,
            recent
        ],
    )?;
    Ok(true)
}

/// A sender's messages in one mailbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SenderPlace {
    /// The mailbox.
    pub mailbox: MailboxId,
    /// How many of the sender's messages it shows now.
    pub messages: u64,
}

/// What `mail-sender-list` asks for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SenderQuery<'a> {
    /// Only senders of this registrable domain.
    pub domain: Option<&'a str>,
    /// Only senders the person has written to.
    pub written_to: bool,
    /// The `recent` and id of the last sender of the page before.
    pub before: Option<(i64, i64)>,
    /// At most this many.
    pub limit: u32,
}

fn sender_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SenderRow> {
    Ok(SenderRow {
        id: row.get(0)?,
        address: row.get(1)?,
        domain: row.get(2)?,
        name: row.get(3)?,
        messages: count(row.get(4)?),
        bulk: count(row.get(5)?),
        first_received: row.get(6)?,
        last_received: row.get(7)?,
        written: count(row.get(8)?),
        last_written: row.get(9)?,
        answered: count(row.get(10)?),
        recent: row.get(11)?,
    })
}

const SENDER_COLUMNS: &str = "id, address, domain, name, messages, bulk, first_received, \
     last_received, written, last_written, answered, recent";

impl Store {
    /// Computes one address's sender row again, in a transaction of its own,
    /// as a batch that touched it would.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn recompute_sender(&mut self, address: &str, now: i64) -> Result<(), StoreError> {
        let transaction = self.connection.transaction()?;
        settle_senders(&transaction, &BTreeSet::from([address.to_string()]), now)?;
        transaction.commit()?;
        Ok(())
    }

    /// How many messages are the person's: those a sent mailbox has shown.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn persons_messages(&self) -> Result<u64, StoreError> {
        let messages: i64 = self.connection.query_row(
            &format!("SELECT count(DISTINCT mine.message_id) FROM {PERSONS}"),
            [],
            |row| row.get(0),
        )?;
        Ok(count(messages))
    }

    /// Senders, the most recent first, paged from the last of the page
    /// before.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn senders(&self, query: &SenderQuery<'_>) -> Result<Vec<SenderRow>, StoreError> {
        let (recent, id) = query.before.unwrap_or((i64::MAX, i64::MAX));
        let mut statement = self.connection.prepare_cached(&format!(
            "SELECT {SENDER_COLUMNS} FROM sender
             WHERE (?1 IS NULL OR domain = ?1) AND (?2 = 0 OR written > 0)
               AND (recent, id) < (?3, ?4)
             ORDER BY recent DESC, id DESC LIMIT ?5"
        ))?;
        let rows = statement
            .query_map(
                params![query.domain, query.written_to, recent, id, query.limit],
                sender_row,
            )?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }

    /// The sender with this id, if there is one.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sender(&self, id: i64) -> Result<Option<SenderRow>, StoreError> {
        Ok(self
            .connection
            .query_row(
                &format!("SELECT {SENDER_COLUMNS} FROM sender WHERE id = ?1"),
                [id],
                sender_row,
            )
            .optional()?)
    }

    /// Where a sender's messages are now: each mailbox that shows any, with
    /// how many, the most first.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sender_places(&self, address: &str) -> Result<Vec<SenderPlace>, StoreError> {
        let mut statement = self.connection.prepare_cached(query::PLACES)?;
        let places = statement
            .query_map([address], |row| {
                Ok(SenderPlace {
                    mailbox: MailboxId(row.get(0)?),
                    messages: count(row.get(1)?),
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(places)
    }

    /// The lists a sender's messages came through, with how many of its
    /// messages each, the most first, at most `limit`.
    ///
    /// # Errors
    /// When the database refuses.
    pub fn sender_lists(
        &self,
        address: &str,
        limit: u32,
    ) -> Result<Vec<(String, u64)>, StoreError> {
        let mut statement = self.connection.prepare_cached(query::LISTS)?;
        let lists = statement
            .query_map(params![address, limit], |row| {
                Ok((row.get(0)?, count(row.get(1)?)))
            })?
            .collect::<Result<_, _>>()?;
        Ok(lists)
    }
}
