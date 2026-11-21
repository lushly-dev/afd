//! Drafts and snoozes across the removal of another account (step D3's
//! review): a draft that answered mail which went answers nothing at a new
//! revision, and a snooze still ends when a reply takes an id the removal
//! freed.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use super::test_mail::{Mail, NOW};
use super::*;

fn thread_of(mail: &Mail, message: MessageId) -> i64 {
    mail.store
        .connection
        .query_row(
            "SELECT thread_id FROM envelope WHERE message_id = ?1",
            [message.0],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn removing_another_account_keeps_drafts_and_snoozes_true() {
    let mut mail = Mail::new();
    let other = mail
        .store
        .add_account("icloud", "other@example.org", 1)
        .unwrap();
    let elsewhere = mail
        .store
        .upsert_mailbox(
            other,
            &MailboxSeen {
                provider_key: "INBOX",
                name: "INBOX",
                role: Role::Inbox,
            },
            NOW,
        )
        .unwrap();
    let first = mail.add(mail.inbox, "a@example.org", &[]);
    // The other account's message holds the highest id.
    let theirs = mail.add(elsewhere, "b@example.org", &[]);
    let person = Proposer {
        kind: "human".to_string(),
        id: None,
    };
    let draft = mail
        .store
        .create_draft(
            &NewDraft {
                account: mail.account,
                answers: Some(theirs.0),
                recipients: Recipients::default(),
                subject: String::new(),
                body: "Lunch?".to_string(),
            },
            &person,
            NOW,
        )
        .unwrap();
    let thread = thread_of(&mail, first);
    mail.store
        .snooze_thread(thread, Some(NOW + 86_400_000), &person, NOW)
        .unwrap();

    mail.store.remove_account(other, NOW).unwrap();
    mail.store.rebuild(NOW, |_| {}).unwrap();

    // The draft keeps its text, answers nothing, and is at a new revision.
    let kept = mail.store.draft(draft.id).unwrap().unwrap();
    assert_eq!(kept.answers, None);
    assert_eq!(kept.revision, draft.revision + 1);
    assert_eq!(kept.body, "Lunch?");
    assert_eq!(
        mail.store.snoozed_until(thread, NOW).unwrap(),
        Some(NOW + 86_400_000)
    );

    // A reply in the snoozed thread takes the id the removal freed, which
    // is no higher than the snooze's mark was: the snooze still ends.
    let reply = mail.add(
        mail.inbox,
        "a@example.org",
        &[
            "In-Reply-To: <m1@example.com>",
            "References: <m1@example.com>",
        ],
    );
    assert!(reply.0 <= theirs.0, "the freed id is taken again");
    assert_eq!(thread_of(&mail, reply), thread);
    assert_eq!(mail.store.snoozed_until(thread, NOW).unwrap(), None);
    assert_eq!(mail.store.wake_snoozes().unwrap(), 1);
}

#[test]
fn migration_16_keeps_drafts_and_reopen_marks_interrupted_send_unknown() {
    let directory = tempfile::tempdir().unwrap();
    let home = crate::home::Home::at(directory.path().join("data"));
    let mut store = Store::open_with(&home, &schema::MIGRATIONS[..15]).unwrap();
    assert_eq!(store.schema_version().unwrap(), 15);
    let account = store.add_account("icloud", "me@example.com", 1).unwrap();
    store
        .connection
        .execute(
            "INSERT INTO draft (account_id, answers_message_id, to_addresses, cc_addresses,
                 bcc_addresses, subject, body, authors, revision, creator_kind, creator_id,
                 created_at, updated_at)
             VALUES (?1, NULL, '[\"friend@example.org\"]', '[]', '[]', 'Hi', 'Body',
                 '{\"recipients\":{\"kind\":\"human\",\"id\":null},\"subject\":{\"kind\":\"human\",\"id\":null},\"body\":{\"kind\":\"human\",\"id\":null}}',
                 1, 'human', NULL, 10, 10)",
            [account.0],
        )
        .unwrap();
    drop(store);

    // Opening on migration 16 upgrades cleanly and keeps the existing draft open.
    let mut store = Store::open(&home).unwrap();
    assert_eq!(
        store.schema_version().unwrap(),
        u32::try_from(schema::MIGRATIONS.len()).unwrap()
    );
    let draft = store.draft(1).unwrap().unwrap();
    assert_eq!(draft.state(), "open");
    assert_eq!(draft.subject, "Hi");

    // Simulate a process dying mid-send: outbound left in `sending`.
    let person = Proposer {
        kind: "human".to_string(),
        id: None,
    };
    let typed = std::collections::HashSet::from(["friend@example.org".to_string()]);
    let (_, _, outbound_id) = store
        .begin_draft_send(draft.id, 1, &typed, "mid@example.com", &person, 20)
        .unwrap()
        .unwrap();
    assert_eq!(store.draft(draft.id).unwrap().unwrap().state(), "sending");
    assert_eq!(
        store.outbound(outbound_id).unwrap().unwrap().state,
        OutboundState::Sending
    );
    drop(store);

    // Next process opens the store: both draft and outbound become `unknown`.
    let store = Store::open(&home).unwrap();
    let after = store.draft(draft.id).unwrap().unwrap();
    assert_eq!(after.state(), "unknown");
    assert_eq!(after.revision, 2);
    let out = store.outbound(outbound_id).unwrap().unwrap();
    assert_eq!(out.state, OutboundState::Unknown);
    assert_eq!(out.draft_revision, Some(1));
    assert!(out.error.is_some());
    let (count, list) = store.unknown_outbound(10).unwrap();
    assert_eq!(count, 1);
    assert_eq!(list[0].id, outbound_id);
}
