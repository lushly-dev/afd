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
