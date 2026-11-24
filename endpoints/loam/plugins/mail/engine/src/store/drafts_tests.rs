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
            |_, _| true,
        )
        .unwrap()
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
        .begin_draft_send(draft.id, 1, &typed, false, "mid@example.com", &person, 20)
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

#[test]
fn migration_23_stores_fixed_recipient_bases_and_rolls_back_preview_too_large() {
    let directory = tempfile::tempdir().unwrap();
    let home = crate::home::Home::at(directory.path().join("data"));
    let mut store = Store::open_with(&home, &schema::MIGRATIONS[..22]).unwrap();
    assert_eq!(store.schema_version().unwrap(), 22);
    let account = store.add_account("icloud", "me@example.com", 1).unwrap();
    store
        .connection
        .execute(
            "INSERT INTO draft (account_id, answers_message_id, to_addresses, cc_addresses,
                 bcc_addresses, subject, body, authors, revision, creator_kind, creator_id,
                 created_at, updated_at)
             VALUES (?1, NULL, '[\"stranger@example.net\"]', '[]', '[]', 'Legacy', 'Body',
                 '{\"recipients\":{\"kind\":\"human\",\"id\":null},\"subject\":{\"kind\":\"human\",\"id\":null},\"body\":{\"kind\":\"human\",\"id\":null}}',
                 1, 'human', NULL, 10, 10)",
            [account.0],
        )
        .unwrap();
    drop(store);

    // Migration 23 backfills legacy v22 drafts on open so their preview and
    // terminal classification never drift across subsequent syncs.
    let mut store = Store::open(&home).unwrap();
    let legacy = store.draft(1).unwrap().unwrap();
    assert_eq!(
        legacy.recipient_bases.as_ref().map(|b| &b.to),
        Some(&vec![RecipientBasis::New])
    );
    let first_read = store.recipient_bases(&legacy).unwrap();
    store
        .connection
        .execute(
            "INSERT INTO sender (address, id, domain, name, messages, bulk, written, answered, recent)
             VALUES ('stranger@example.net', 99, 'example.net', 'Stranger', 0, 0, 1, 0, 15)",
            [],
        )
        .unwrap();
    let legacy_again = store.draft(1).unwrap().unwrap();
    let second_read = store.recipient_bases(&legacy_again).unwrap();
    assert_eq!(first_read, second_read);
    assert_eq!(second_read.to, vec![RecipientBasis::New]);

    // Creating a new draft stores its fixed recipient_bases; rejecting in check_preview
    // rolls back cleanly leaving no draft row behind.
    let person = Proposer {
        kind: "human".to_string(),
        id: None,
    };
    let new_draft = NewDraft {
        account,
        answers: None,
        recipients: Recipients {
            to: vec!["friend@example.org".to_string()],
            cc: vec![],
            bcc: vec![],
        },
        subject: "Fixed".to_string(),
        body: "Hello".to_string(),
    };
    let rejected = store
        .create_draft(&new_draft, &person, 20, |_, _| false)
        .unwrap();
    assert_eq!(rejected, Err(DraftRefusal::PreviewTooLarge));
    assert!(store.draft(2).unwrap().is_none());

    let created = store
        .create_draft(&new_draft, &person, 20, |_, _| true)
        .unwrap()
        .unwrap();
    assert_eq!(
        created.recipient_bases.as_ref().map(|b| &b.to),
        Some(&vec![RecipientBasis::New])
    );

    // Even if `friend@example.org` later appears as a written-to sender in the
    // store, the draft's fixed basis stays `new` on reads and body-only updates.
    store
        .connection
        .execute(
            "INSERT INTO sender (address, id, domain, name, messages, bulk, written, answered, recent)
             VALUES ('friend@example.org', 1, 'example.org', 'Friend', 0, 0, 1, 0, 25),
                    ('colleague@example.org', 2, 'example.org', 'Colleague', 0, 0, 1, 0, 26)",
            [],
        )
        .unwrap();
    let reread = store.draft(created.id).unwrap().unwrap();
    assert_eq!(
        store.recipient_bases(&reread).unwrap().to,
        vec![RecipientBasis::New]
    );

    // Updating body alone keeps the fixed basis; rejecting preview rolls back revision.
    let body_change = DraftChange {
        recipients: None,
        subject: None,
        body: Some("Edited body".to_string()),
    };
    let rejected_update = store
        .update_draft(created.id, 1, &body_change, &person, 30, |_, _| false)
        .unwrap();
    assert_eq!(rejected_update, Err(DraftRefusal::PreviewTooLarge));
    assert_eq!(store.draft(created.id).unwrap().unwrap().revision, 1);

    let updated_body = store
        .update_draft(created.id, 1, &body_change, &person, 30, |_, _| true)
        .unwrap()
        .unwrap();
    assert_eq!(updated_body.revision, 2);
    assert_eq!(
        store.recipient_bases(&updated_body).unwrap().to,
        vec![RecipientBasis::New]
    );

    // Resubmitting retained `friend@example.org` preserves its fixed `new` basis
    // while classifying newly added `colleague@example.org` as `written-to`.
    let rcpt_change = DraftChange {
        recipients: Some(Recipients {
            to: vec![
                "friend@example.org".to_string(),
                "colleague@example.org".to_string(),
            ],
            cc: vec![],
            bcc: vec![],
        }),
        subject: None,
        body: None,
    };
    let updated_rcpt = store
        .update_draft(created.id, 2, &rcpt_change, &person, 40, |_, _| true)
        .unwrap()
        .unwrap();
    assert_eq!(updated_rcpt.revision, 3);
    assert_eq!(
        store.recipient_bases(&updated_rcpt).unwrap().to,
        vec![RecipientBasis::New, RecipientBasis::WrittenTo]
    );
}

#[test]
fn account_remove_refreshes_draft_bases_from_surviving_evidence_and_matches_post_rebuild() {
    let mut mail = Mail::new();
    let kept_account = mail.account;
    let removed_account = mail
        .store
        .add_account("icloud", "removed@example.com", NOW)
        .unwrap();
    let removed_inbox = mail
        .store
        .upsert_mailbox(
            removed_account,
            &MailboxSeen {
                provider_key: "INBOX",
                name: "INBOX",
                role: Role::Inbox,
            },
            NOW,
        )
        .unwrap();

    // A message only in the removed account, from `thread@example.org`.
    let removed_msg = mail.add(
        removed_inbox,
        "thread@example.org",
        &["To: removed@example.com"],
    );
    // A sent message in the surviving account to `surviving@example.org`.
    mail.add(
        mail.sent,
        super::test_mail::PERSON,
        &["To: surviving@example.org"],
    );

    let person = Proposer {
        kind: "human".to_string(),
        id: None,
    };
    // Draft A on kept_account answers removed_msg, targeting thread, surviving written-to,
    // and the soon-to-be-removed account's address.
    let draft_a = mail
        .store
        .create_draft(
            &NewDraft {
                account: kept_account,
                answers: Some(removed_msg.0),
                recipients: Recipients {
                    to: vec![
                        "thread@example.org".to_string(),
                        "surviving@example.org".to_string(),
                        "removed@example.com".to_string(),
                    ],
                    cc: vec![],
                    bcc: vec![],
                },
                subject: "Re: Hi".to_string(),
                body: "Body A".to_string(),
            },
            &person,
            NOW,
            |_, _| true,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        mail.store.recipient_bases(&draft_a).unwrap().to,
        vec![
            RecipientBasis::New, // removed_msg is on removed_account, not kept_account
            RecipientBasis::WrittenTo,
            RecipientBasis::Own,
        ]
    );

    // Standalone Draft B on kept_account targeting removed@example.com (initially `own`).
    let draft_b = mail
        .store
        .create_draft(
            &NewDraft {
                account: kept_account,
                answers: None,
                recipients: Recipients {
                    to: vec!["removed@example.com".to_string()],
                    cc: vec![],
                    bcc: vec![],
                },
                subject: "Note".to_string(),
                body: "Body B".to_string(),
            },
            &person,
            NOW,
            |_, _| true,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        mail.store.recipient_bases(&draft_b).unwrap().to,
        vec![RecipientBasis::Own]
    );

    mail.store
        .remove_account(removed_account, NOW + 10)
        .unwrap();

    // Immediately after account removal (before rebuild completes):
    // - Draft A keeps `written-to` for surviving@example.org, drops `own` for removed@example.com.
    // - Draft B bumps revision and drops `own` for removed@example.com to `new`.
    let a_after = mail.store.draft(draft_a.id).unwrap().unwrap();
    assert_eq!(a_after.answers, None);
    assert_eq!(a_after.revision, 2);
    assert_eq!(
        mail.store.recipient_bases(&a_after).unwrap().to,
        vec![
            RecipientBasis::New,
            RecipientBasis::WrittenTo,
            RecipientBasis::New,
        ]
    );
    let b_after = mail.store.draft(draft_b.id).unwrap().unwrap();
    assert_eq!(b_after.revision, 2);
    assert_eq!(
        mail.store.recipient_bases(&b_after).unwrap().to,
        vec![RecipientBasis::New]
    );

    // Complete the rebuild and confirm stored bases match a fresh derivation on the rebuilt store.
    mail.store.rebuild(NOW + 20, |_| {}).unwrap();
    let a_rebuilt = mail.store.draft(draft_a.id).unwrap().unwrap();
    let b_rebuilt = mail.store.draft(draft_b.id).unwrap().unwrap();
    let a_fresh = mail
        .store
        .recipient_bases(&DraftRow {
            recipient_bases: None,
            ..a_rebuilt.clone()
        })
        .unwrap();
    let b_fresh = mail
        .store
        .recipient_bases(&DraftRow {
            recipient_bases: None,
            ..b_rebuilt.clone()
        })
        .unwrap();
    assert_eq!(mail.store.recipient_bases(&a_rebuilt).unwrap(), a_fresh);
    assert_eq!(mail.store.recipient_bases(&b_rebuilt).unwrap(), b_fresh);
    assert_eq!(
        a_fresh.to,
        vec![
            RecipientBasis::New,
            RecipientBasis::WrittenTo,
            RecipientBasis::New,
        ]
    );
    assert_eq!(b_fresh.to, vec![RecipientBasis::New]);
    // Terminal send to removed@example.com without typedRecipients is now refused!
    let refused = mail
        .store
        .begin_draft_send(
            draft_b.id,
            b_rebuilt.revision,
            &std::collections::HashSet::new(),
            false,
            "mid@example.com",
            &person,
            NOW + 30,
        )
        .unwrap();
    assert_eq!(refused, Err(SendRefusal::RecipientNotAllowed { count: 1 }));
}
