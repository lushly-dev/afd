//! A store with an account and three mailboxes, for the tests of screening
//! and of stories.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::*;

pub(super) const DAY: i64 = 24 * 60 * 60 * 1000;
pub(super) const BASE: i64 = 1_637_446_921_000;
pub(super) const NOW: i64 = BASE + 400 * DAY;
pub(super) const PERSON: &str = "person@example.com";

pub(super) struct Mail {
    pub(super) _directory: tempfile::TempDir,
    pub(super) store: Store,
    pub(super) account: AccountId,
    pub(super) inbox: MailboxId,
    pub(super) sent: MailboxId,
    pub(super) archive: MailboxId,
    pub(super) next: u32,
}

impl Mail {
    pub(super) fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let home = Home::at(directory.path().join("data"));
        let mut store = Store::open(&home).unwrap();
        let account = store.add_account("icloud", PERSON, 1).unwrap();
        let mut mailbox = |key: &'static str, role| {
            store
                .upsert_mailbox(
                    account,
                    &MailboxSeen {
                        provider_key: key,
                        name: key,
                        role,
                    },
                    NOW,
                )
                .unwrap()
        };
        let inbox = mailbox("INBOX", Role::Inbox);
        let sent = mailbox("Sent Messages", Role::Sent);
        let archive = mailbox("Archive", Role::Archive);
        Self {
            _directory: directory,
            store,
            account,
            inbox,
            sent,
            archive,
            next: 1,
        }
    }

    /// Records a message's headers in `mailbox`. `fields` are header lines
    /// after `From`, `Message-ID`, the date and the subject, `s<number>`.
    /// The same mail with its store closed and opened again, as a program
    /// that stops and starts does.
    pub(super) fn reopen(self) -> Self {
        let Self {
            _directory,
            store,
            account,
            inbox,
            sent,
            archive,
            next,
        } = self;
        drop(store);
        let store = Store::open(&Home::at(_directory.path().join("data"))).unwrap();
        Self {
            _directory,
            store,
            account,
            inbox,
            sent,
            archive,
            next,
        }
    }

    pub(super) fn add(&mut self, mailbox: MailboxId, from: &str, fields: &[&str]) -> MessageId {
        self.add_seen(mailbox, from, fields).0
    }

    pub(super) fn add_seen(
        &mut self,
        mailbox: MailboxId,
        from: &str,
        fields: &[&str],
    ) -> (MessageId, HeaderSeen) {
        let number = self.next;
        self.next += 1;
        let seen = header(number, from, fields);
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
        let message = self
            .store
            .find_message(&seen.header_block, seen.reported_size)
            .unwrap()
            .unwrap();
        (message, seen)
    }

    /// Records a message whole: its headers, then its body, which gives it
    /// its template key. Every message one sender sends this way has the
    /// same template: the subject's shape and the structure are the same.
    pub(super) fn add_whole(
        &mut self,
        mailbox: MailboxId,
        from: &str,
        fields: &[&str],
    ) -> MessageId {
        self.add_body(mailbox, from, fields, "Offers this week.\r\n")
    }

    /// Records a message whole with `body`, which gives it its body shape.
    pub(super) fn add_body(
        &mut self,
        mailbox: MailboxId,
        from: &str,
        fields: &[&str],
        body: &str,
    ) -> MessageId {
        let (message, seen) = self.add_seen(mailbox, from, fields);
        let bytes = [seen.header_block.as_slice(), body.as_bytes()].concat();
        self.store
            .record_parts(
                &[PartSeen {
                    message,
                    place: Place::Whole,
                    bytes: &bytes,
                }],
                NOW,
            )
            .unwrap();
        message
    }

    pub(super) fn class(&self, message: MessageId) -> Option<String> {
        self.store
            .connection
            .query_row(
                "SELECT class FROM screening WHERE message_id = ?1",
                [message.0],
                |row| row.get(0),
            )
            .optional()
            .unwrap()
    }

    pub(super) fn listed(&self, message: MessageId) -> Option<bool> {
        self.store
            .connection
            .query_row(
                "SELECT listed FROM screening WHERE message_id = ?1",
                [message.0],
                |row| row.get(0),
            )
            .optional()
            .unwrap()
    }

    pub(super) fn mailbox(&mut self, key: &'static str, role: Role) -> MailboxId {
        self.store
            .upsert_mailbox(
                self.account,
                &MailboxSeen {
                    provider_key: key,
                    name: key,
                    role,
                },
                NOW,
            )
            .unwrap()
    }

    pub(super) fn decide(&mut self, address: &str, decision: Option<Decision>) -> Decided {
        self.store.decide(address, decision, NOW).unwrap()
    }

    /// The derived rows screening keeps.
    pub(super) fn derived(&self) -> Vec<Vec<Vec<Value>>> {
        vec![
            table(&self.store, "SELECT * FROM screening ORDER BY message_id"),
            table(&self.store, "SELECT * FROM template ORDER BY key"),
            table(
                &self.store,
                "SELECT * FROM story_member ORDER BY message_id",
            ),
            table(
                &self.store,
                "SELECT * FROM story_shape ORDER BY story_id, shape",
            ),
            table(
                &self.store,
                "SELECT * FROM story_kind ORDER BY story_id, template_key",
            ),
            table(&self.store, "SELECT * FROM story ORDER BY id"),
            table(
                &self.store,
                "SELECT * FROM first_contact ORDER BY account_id, message_id",
            ),
            table(
                &self.store,
                "SELECT * FROM contact_day ORDER BY account_id, day",
            ),
            table(&self.store, "SELECT * FROM burst ORDER BY id"),
            table(
                &self.store,
                "SELECT * FROM burst_message ORDER BY burst_id, message_id",
            ),
        ]
    }

    /// What the person decided and agents suggested.
    pub(super) fn kept(&self) -> Vec<Vec<Vec<Value>>> {
        vec![
            table(
                &self.store,
                "SELECT * FROM sender_decision ORDER BY address",
            ),
            table(&self.store, "SELECT * FROM sender_suggestion ORDER BY id"),
        ]
    }

    /// The rows a batch at a time gave are those classing everything from
    /// nothing gives.
    pub(super) fn assert_as_from_nothing(&mut self) {
        let before = self.derived();
        self.store.classify_everything().unwrap();
        assert_eq!(self.derived(), before);
    }
}

pub(super) fn header(number: u32, from: &str, fields: &[&str]) -> HeaderSeen {
    let date = mail_parser::DateTime::from_timestamp((BASE + i64::from(number) * DAY) / 1000);
    let mut block = format!(
        "From: {from}\r\nMessage-ID: <m{number}@example.com>\r\nDate: {}\r\nSubject: s{number}\r\n",
        date.to_rfc822()
    );
    for field in fields {
        block.push_str(field);
        block.push_str("\r\n");
    }
    block.push_str("\r\n");
    HeaderSeen {
        provider_id: number.to_string(),
        provider_thread: None,
        reported_size: 1000 + u64::from(number),
        internal_date: Some(BASE + i64::from(number) * DAY),
        flags: Vec::new(),
        header_block: block.into_bytes(),
    }
}

pub(super) fn table(store: &Store, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = store.connection.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |row| {
            (0..columns)
                .map(|column| row.get::<_, Value>(column))
                .collect()
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
