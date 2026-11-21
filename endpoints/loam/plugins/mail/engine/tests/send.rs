//! Sending drafts over SMTP at the terminal (step D3, second part; the
//! specification's 9.5, M18 and M29), on the scripted SMTP and IMAP servers.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use afd::{ActorKind, CommandContext, CommandInterface};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::secrets::InMemory;
use serde_json::{Value, json};
use support::imap::{USER, World};
use support::smtp::SmtpFault;
use support::synced::{Fixture, assert_labelled, mail};

const STRANGER: &str = "Stranger <stranger@example.biz>";

/// Words that appear only in messages or drafts: none may leak outside a
/// labelled content part.
const CONTENT_WORDS: &[&str] = &[
    "stranger@",
    "friend@",
    "newperson@",
    "secretbcc@",
    "Reply text",
    "About s0",
    "Emoji subject",
];

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Junk", &["\\Junk"]);
    // An incoming thread from STRANGER, with Reply-To differing.
    world.add(
        "INBOX",
        mail(
            STRANGER,
            "s0",
            "To: person@example.com\r\nReply-To: spoof@evil.example\r\n",
        ),
        &[],
    );
    // A junk message forging In-Reply-To into the thread must not add thread participants.
    world.add(
        "Junk",
        mail(
            "Spammer <spammer@evil.example>",
            "j0",
            "To: person@example.com\r\nCc: junkpoison@evil.example\r\nIn-Reply-To: <s0@example.org>\r\n",
        ),
        &[],
    );
    // A message previously sent by the person to FRIEND, so FRIEND is `written-to`.
    world.add(
        "Sent Messages",
        mail(USER, "sent0", "To: friend@example.org\r\n"),
        &["\\Seen"],
    );
}

fn find_message(fixture: &Fixture, word: &str) -> i64 {
    let found = fixture.person("mail-search", json!({ "query": word }));
    found["data"]["hits"][0]["message"].as_i64().unwrap()
}

fn approved_send(fixture: &Fixture, input: Value) -> Value {
    let held = fixture.person("mail-draft-send", input.clone());
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    assert_labelled(&held, CONTENT_WORDS);
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token);
    fixture.execute("mail-draft-send", input, context)
}

#[test]
fn person_sends_reply_at_terminal_with_preview_smtp_and_sent_copy() {
    let fixture = Fixture::new(world);
    let answered = find_message(&fixture, "s0");
    let made = fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({
            "answers": answered,
            "to": ["stranger@example.biz"],
            "cc": ["friend@example.org"],
            "bcc": [USER],
            "subject": "Re: About s0 ❤️ 👨‍👩‍👧‍👦",
            "body": "Reply text line 1.\nReply text line 2.",
        }),
    );
    assert_eq!(made["success"], true, "{made}");
    assert_labelled(&made, CONTENT_WORDS);
    assert_eq!(made["data"]["state"], "open");
    assert_eq!(made["data"]["recipientBasis"]["to"], json!(["thread"]));
    assert_eq!(made["data"]["recipientBasis"]["cc"], json!(["written-to"]));
    assert_eq!(made["data"]["recipientBasis"]["bcc"], json!(["own"]));
    assert_eq!(made["data"]["replyToDiffers"], true);
    let draft = made["data"]["draft"].as_i64().unwrap();

    // Saying no at the terminal sends nothing.
    let arg = json!({ "draft": draft }).to_string();
    let (status, _out, err, _) = fixture.terminal(&["mail-draft-send", &arg], false);
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("stranger@example.biz [thread]"), "{err}");
    assert!(err.contains("friend@example.org [written-to]"), "{err}");
    assert!(err.contains("Reply-To header that differs"), "{err}");
    assert!(err.contains("Send draft"), "{err}");
    assert!(fixture.smtp.received().is_empty());

    // Saying yes sends over SMTP (filling in revision from preview), appends a
    // copy (with Bcc) to Sent Messages, and marks the draft sent.
    let (status, out, err, _) = fixture.terminal(&["mail-draft-send", &arg], true);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_labelled(&parsed, CONTENT_WORDS);
    assert_eq!(parsed["data"]["state"], "sent");
    assert_eq!(parsed["data"]["sentCopy"], true);
    assert_eq!(parsed["data"]["recipients"], 3);

    // Verify SMTP received exactly one message without Bcc header, with
    // threading headers and UTF-8 emoji subject.
    let received = fixture.smtp.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].from, USER);
    assert_eq!(
        received[0].to,
        vec![
            "stranger@example.biz".to_string(),
            "friend@example.org".to_string(),
            USER.to_string(),
        ]
    );
    let wire_text = String::from_utf8(received[0].data.clone()).unwrap();
    assert!(
        !wire_text.contains("Bcc:"),
        "Bcc must never go on SMTP wire: {wire_text}"
    );
    assert!(
        wire_text.contains("In-Reply-To: <s0@example.org>"),
        "{wire_text}"
    );
    let wire_parsed = mail_parser::MessageParser::new()
        .parse(&received[0].data)
        .unwrap();
    assert_eq!(wire_parsed.subject(), Some("Re: About s0 ❤️ 👨‍👩‍👧‍👦"));
    assert!(
        wire_parsed
            .body_text(0)
            .unwrap()
            .contains("Reply text line 1.")
    );

    // Verify Sent Messages received the appended copy WITH Bcc and `\Seen`.
    let sent_box = fixture.server.world().find("Sent Messages").clone();
    assert_eq!(sent_box.messages.len(), 2);
    let appended = sent_box.messages.values().last().unwrap();
    assert!(appended.flags.contains(&"\\Seen".to_string()));
    let copy_text = String::from_utf8(appended.bytes.clone()).unwrap();
    assert!(copy_text.contains("Bcc: person@example.com"), "{copy_text}");

    // The sent draft left the active draft list and cannot be sent or edited again.
    let listed = fixture.person("mail-draft-list", json!({}));
    assert_eq!(listed["data"]["drafts"], json!([]));
    let shown = fixture.person("mail-draft-show", json!({ "draft": draft }));
    assert_eq!(shown["data"]["state"], "sent");
    let again = approved_send(&fixture, json!({ "draft": draft, "revision": 2 }));
    assert_eq!(again["error"]["code"], "INVALID_INPUT", "{again}");
    assert_eq!(fixture.smtp.received().len(), 1);
}

#[test]
fn new_recipient_is_refused_unless_typed_verbatim_at_terminal() {
    let fixture = Fixture::new(world);
    let made = fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({
            "to": ["newperson@example.net"],
            "subject": "Emoji subject ✈️",
            "body": "Reply text.",
        }),
    );
    assert_eq!(made["success"], true, "{made}");
    assert_eq!(made["data"]["recipientBasis"]["to"], json!(["new"]));
    let draft = made["data"]["draft"].as_i64().unwrap();

    // Direct call without typedRecipients fails with RECIPIENT_NOT_ALLOWED.
    let refused = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(
        refused["error"]["code"], "RECIPIENT_NOT_ALLOWED",
        "{refused}"
    );
    assert_labelled(&refused, CONTENT_WORDS);
    assert!(fixture.smtp.received().is_empty());

    // Typing the wrong address at the terminal aborts and sends nothing.
    let arg = json!({ "draft": draft, "revision": 1 }).to_string();
    let (status, _out, err, _) =
        fixture.terminal_typing(&["mail-draft-send", &arg], true, &["wrong@example.net"]);
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Address did not match"), "{err}");
    assert!(fixture.smtp.received().is_empty());

    // Pre-populating typedRecipients in CLI JSON does NOT bypass typing at the terminal.
    let prefilled = json!({
        "draft": draft,
        "revision": 1,
        "typedRecipients": ["newperson@example.net"],
    })
    .to_string();
    let (status, _out, err, _) = fixture.terminal_typing(
        &["mail-draft-send", &prefilled],
        true,
        &["wrong@example.net"],
    );
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Address did not match"), "{err}");
    assert!(fixture.smtp.received().is_empty());

    // Typing the exact address at the terminal allows this send.
    let (status, out, err, _) =
        fixture.terminal_typing(&["mail-draft-send", &arg], true, &["newperson@example.net"]);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    assert_eq!(fixture.smtp.received().len(), 1);
    assert_eq!(fixture.smtp.received()[0].to, vec!["newperson@example.net"]);
}

#[test]
fn agent_and_script_cannot_send_and_stale_revision_is_preview_changed() {
    let fixture = Fixture::new(world);
    let made = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    );
    let draft = made["data"]["draft"].as_i64().unwrap();

    // Agent over MCP is refused (M18).
    let over_mcp = fixture.agent(
        "tok_a",
        "mail-draft-send",
        json!({ "draft": draft, "revision": 1 }),
    );
    assert_eq!(
        over_mcp["error"]["code"], "COMMAND_NOT_EXPOSED",
        "{over_mcp}"
    );

    // Script at CLI with no terminal gets PERSON_REQUIRED.
    let arg = json!({ "draft": draft, "revision": 1 }).to_string();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &["mail-draft-send".to_string(), arg],
        &fixture.registry,
        Caller::Script,
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    let script_out = String::from_utf8(out).unwrap();
    assert!(script_out.contains("PERSON_REQUIRED"), "{script_out}");

    // Update draft to revision 2, then try sending revision 1 -> PREVIEW_CHANGED.
    let updated = fixture.person(
        "mail-draft-update",
        json!({ "draft": draft, "revision": 1, "body": "Changed body." }),
    );
    assert_eq!(updated["data"]["revision"], 2);
    let stale = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(stale["error"]["code"], "PREVIEW_CHANGED", "{stale}");
    assert!(fixture.smtp.received().is_empty());
}

#[test]
fn smtp_failure_before_handover_keeps_draft_open_and_allows_retry() {
    let fixture = Fixture::new(world);
    let made = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    );
    let draft = made["data"]["draft"].as_i64().unwrap();

    // 1. Auth failure -> SIGN_IN_REQUIRED, draft stays open.
    fixture.smtp.world().fault = Some(SmtpFault::RefuseAuth);
    let failed = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(failed["error"]["code"], "SIGN_IN_REQUIRED", "{failed}");
    assert_eq!(
        fixture.person("mail-draft-show", json!({ "draft": draft }))["data"]["state"],
        "open"
    );

    // 2. Rate limit 452 -> PROVIDER_LIMIT, retryable, draft stays open.
    fixture.smtp.world().fault = Some(SmtpFault::RefuseMailFrom(452));
    let limited = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(limited["error"]["code"], "PROVIDER_LIMIT", "{limited}");
    assert_eq!(limited["error"]["retryable"], true);

    // 3. Connection drop before DATA -> PROVIDER_UNAVAILABLE, draft stays open.
    fixture.smtp.world().fault = Some(SmtpFault::DropBeforeData);
    let dropped = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(
        dropped["error"]["code"], "PROVIDER_UNAVAILABLE",
        "{dropped}"
    );

    // 4. Explicit 550 / 552 refusal after DATA -> non-retryable PROVIDER_REFUSED, draft stays open.
    for code in [550_u16, 552] {
        fixture.smtp.world().fault = Some(SmtpFault::RefuseAfterData(code));
        let refused = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
        assert_eq!(refused["error"]["code"], "PROVIDER_REFUSED", "{refused}");
        assert_eq!(refused["error"]["retryable"], false, "{refused}");
        assert!(fixture.smtp.received().is_empty());
    }

    // 5. AUTH LOGIN only succeeds when fault cleared to AuthLoginOnly.
    fixture.smtp.world().fault = Some(SmtpFault::AuthLoginOnly);
    let sent = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(sent["success"], true, "{sent}");
    assert_eq!(fixture.smtp.received().len(), 1);
    assert!(
        fixture.smtp.world().log.iter().any(|l| l == "AUTH LOGIN"),
        "{:?}",
        fixture.smtp.world().log
    );
}

#[test]
fn drop_after_handover_is_unknown_reported_in_status_and_never_retried() {
    let fixture = Fixture::new(world);
    let made = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    );
    let draft = made["data"]["draft"].as_i64().unwrap();

    fixture.smtp.world().fault = Some(SmtpFault::DropAfterHandover);
    let unknown = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(
        unknown["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{unknown}"
    );
    assert_eq!(unknown["error"]["retryable"], false);
    assert_labelled(&unknown, CONTENT_WORDS);

    // mail-status reports the unknown send without leaking content.
    let status = fixture.person("mail-status", json!({}));
    assert_labelled(&status, CONTENT_WORDS);
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["draft"],
        draft
    );

    // Draft is now `unknown` at revision 2 and cannot be retried or updated.
    let shown = fixture.person("mail-draft-show", json!({ "draft": draft }));
    assert_eq!(shown["data"]["state"], "unknown");
    assert_eq!(shown["data"]["revision"], 2);
    fixture.smtp.world().fault = None;
    let retry = approved_send(&fixture, json!({ "draft": draft, "revision": 2 }));
    assert_eq!(retry["error"]["code"], "SEND_OUTCOME_UNKNOWN", "{retry}");
    // Still only the one handover attempt reached SMTP.
    assert_eq!(fixture.smtp.received().len(), 1);
}

#[test]
fn sent_copy_failure_still_reports_sent_with_warning() {
    let fixture = Fixture::new(world);
    fixture.server.world().refuse_append = true;
    let made = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    );
    let draft = made["data"]["draft"].as_i64().unwrap();

    let result = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["data"]["state"], "sent");
    assert_eq!(result["data"]["sentCopy"], false);
    assert_eq!(result["warnings"][0]["code"], "SENT_COPY_FAILED");
    assert_eq!(fixture.smtp.received().len(), 1);
}

#[test]
fn subject_accepts_emoji_and_still_refuses_hidden_controls_with_clear_message() {
    let fixture = Fixture::new(world);
    for emoji in ["Thanks ❤️", "Family 👨‍👩‍👧‍👦", "Flight ✈️"] {
        let ok = fixture.person(
            "mail-draft-create",
            json!({ "subject": emoji, "body": "ok" }),
        );
        assert_eq!(ok["success"], true, "{emoji}: {ok}");
    }
    let hidden = fixture.person(
        "mail-draft-create",
        json!({ "subject": "pay\u{200b}ment", "body": "ok" }),
    );
    assert_eq!(hidden["error"]["code"], "INVALID_INPUT");
    assert!(
        hidden["error"]["message"]
            .as_str()
            .unwrap()
            .contains("hidden formatting character"),
        "{hidden}"
    );
}

#[test]
fn junk_forging_in_reply_to_and_differing_reply_to_do_not_allow_recipients() {
    let fixture = Fixture::new(world);
    let answered = find_message(&fixture, "s0");
    let made = fixture.person(
        "mail-draft-create",
        json!({
            "answers": answered,
            "to": ["spoof@evil.example", "junkpoison@evil.example"],
            "subject": "Re: About s0",
            "body": "Reply text.",
        }),
    );
    assert_eq!(made["success"], true, "{made}");
    assert_eq!(made["data"]["recipientBasis"]["to"], json!(["new", "new"]));
    let draft = made["data"]["draft"].as_i64().unwrap();
    let refused = approved_send(&fixture, json!({ "draft": draft, "revision": 1 }));
    assert_eq!(
        refused["error"]["code"], "RECIPIENT_NOT_ALLOWED",
        "{refused}"
    );
    assert!(fixture.smtp.received().is_empty());
}

#[test]
fn starttls_refuses_missing_capability_and_injected_plaintext_before_auth() {
    use loam_mail::provider::ProviderError;
    use loam_mail::provider::imap::Credentials;
    use loam_mail::provider::smtp::{MailSender, SendOutcome, SmtpEndpoint, SmtpSender, TlsMode};
    use loam_mail::store::{AccountId, AccountRow};

    let smtp = support::smtp::SmtpServer::start();
    let endpoint = SmtpEndpoint {
        host: smtp.address.ip().to_string(),
        port: smtp.address.port(),
        tls: TlsMode::StartTls,
    };
    let sender = SmtpSender::new(endpoint, |_| {
        Ok(Credentials {
            user: USER.to_string(),
            password: support::imap::PASSWORD.to_string(),
        })
    });
    let account = AccountRow {
        id: AccountId(1),
        provider: "icloud".to_string(),
        address: USER.to_string(),
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    // 1. Server does not advertise STARTTLS -> refused before any AUTH is sent.
    let no_starttls = runtime.block_on(sender.send(
        &account,
        USER,
        &["friend@example.org".to_string()],
        b"Subject: hi\r\n\r\nok",
    ));
    assert!(
        matches!(no_starttls, SendOutcome::Failed(ProviderError::Refused(_))),
        "{no_starttls:?}"
    );
    assert!(
        !smtp.world().log.iter().any(|l| l.starts_with("AUTH")),
        "AUTH must never be sent when STARTTLS is absent: {:?}",
        smtp.world().log
    );

    // 2. Server advertises STARTTLS but injects extra plaintext after 220 ->
    //    refused with Protocol error before TLS or AUTH.
    smtp.world().log.clear();
    smtp.world().fault = Some(SmtpFault::StartTlsInjectedBytes);
    let injected = runtime.block_on(sender.send(
        &account,
        USER,
        &["friend@example.org".to_string()],
        b"Subject: hi\r\n\r\nok",
    ));
    assert!(
        matches!(injected, SendOutcome::Failed(ProviderError::Protocol(_))),
        "{injected:?}"
    );
    assert!(
        !smtp.world().log.iter().any(|l| l.starts_with("AUTH")),
        "AUTH must never be sent after STARTTLS injection: {:?}",
        smtp.world().log
    );
}

#[test]
fn cancelled_send_timeout_marks_outbound_unknown_and_visible_in_status() {
    let fixture = Fixture::new(world);
    let made = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    );
    let draft = made["data"]["draft"].as_i64().unwrap();

    fixture.smtp.world().fault = Some(SmtpFault::StallAfterData);
    let input = json!({ "draft": draft, "revision": 1 });
    let held = fixture.person("mail-draft-send", input.clone());
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token)
        .with_timeout(200);
    let timed_out = fixture.execute("mail-draft-send", input, context);
    assert_eq!(timed_out["error"]["code"], "TIMEOUT", "{timed_out}");

    // The InFlightSend drop guard must immediately transition the draft and
    // outbound record from `sending` to `unknown` so mail-status shows it.
    let shown = fixture.person("mail-draft-show", json!({ "draft": draft }));
    assert_eq!(shown["data"]["state"], "unknown", "{shown}");
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["sending"], 0, "{status}");
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["draft"],
        draft
    );
    assert_eq!(status["data"]["outbound"]["unknownSends"][0]["revision"], 1);
}

#[test]
fn truncated_and_unexpected_post_handover_replies_and_non_utf8_greeting() {
    let fixture = Fixture::new(world);

    // 1. Malformed non-UTF8 greeting never panics; draft remains open.
    let d1 = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "Reply text." }),
    )["data"]["draft"]
        .as_i64()
        .unwrap();
    fixture.smtp.world().fault = Some(SmtpFault::NonUtf8Greeting);
    let bad_greet = approved_send(&fixture, json!({ "draft": d1, "revision": 1 }));
    assert_eq!(
        bad_greet["error"]["code"], "PROVIDER_UNAVAILABLE",
        "{bad_greet}"
    );
    assert_eq!(
        fixture.person("mail-draft-show", json!({ "draft": d1 }))["data"]["state"],
        "open"
    );

    // 2. Truncated reply line (`550` without `\n`) after handover -> SEND_OUTCOME_UNKNOWN.
    fixture.smtp.world().fault = Some(SmtpFault::TruncateAfterData);
    let truncated = approved_send(&fixture, json!({ "draft": d1, "revision": 1 }));
    assert_eq!(
        truncated["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{truncated}"
    );
    assert_eq!(
        fixture.person("mail-draft-show", json!({ "draft": d1 }))["data"]["state"],
        "unknown"
    );

    // 3. Unexpected 354 after handover -> SEND_OUTCOME_UNKNOWN (not reopened).
    let d2 = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi 2", "body": "Reply text." }),
    )["data"]["draft"]
        .as_i64()
        .unwrap();
    fixture.smtp.world().fault = Some(SmtpFault::UnexpectedCodeAfterData(354));
    let unexpected = approved_send(&fixture, json!({ "draft": d2, "revision": 1 }));
    assert_eq!(
        unexpected["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{unexpected}"
    );
    assert_eq!(
        fixture.person("mail-draft-show", json!({ "draft": d2 }))["data"]["state"],
        "unknown"
    );
}

#[test]
fn junk_answered_message_and_junk_thread_bridge_grant_no_thread_eligibility() {
    let fixture = Fixture::new(|w| {
        w.mailbox("INBOX", &[]);
        w.mailbox("Sent Messages", &["\\Sent"]);
        w.mailbox("Junk", &["\\Junk"]);
        // Thread A in INBOX.
        w.add(
            "INBOX",
            mail(STRANGER, "thread-a", "To: person@example.com\r\n"),
            &[],
        );
        // Unrelated Thread B in INBOX.
        w.add(
            "INBOX",
            mail(
                "Other <other@example.net>",
                "thread-b",
                "To: person@example.com\r\n",
            ),
            &[],
        );
        // A Junk message forging References to bridge Thread A and Thread B!
        w.add(
            "Junk",
            mail(
                "Bridge <bridge@evil.example>",
                "junk-bridge",
                "To: person@example.com\r\nCc: junkcc@evil.example\r\nReferences: <thread-a@example.org> <thread-b@example.org>\r\n",
            ),
            &[],
        );
    });

    // 1. Answering Thread A does NOT make Thread B's participant or the junk bridge eligible.
    let msg_a = find_message(&fixture, "thread-a");
    let reply_a = fixture.person(
        "mail-draft-create",
        json!({
            "answers": msg_a,
            "to": ["stranger@example.biz", "other@example.net", "bridge@evil.example"],
            "subject": "Re: thread-a",
            "body": "ok",
        }),
    );
    assert_eq!(
        reply_a["data"]["recipientBasis"]["to"],
        json!(["thread", "new", "new"]),
        "{reply_a}"
    );

    // 2. Answering the Junk message directly grants NO `thread` eligibility at all.
    let junk_thread = fixture
        .engine
        .with_store(|store| {
            let accounts = store.accounts()?;
            let mailboxes = store.mailboxes(accounts[0].id)?;
            let junk_box = mailboxes.iter().find(|m| m.name == "Junk").unwrap();
            let threads = store.list_threads(junk_box.id, None, 10)?;
            Ok(threads[0].thread.0)
        })
        .unwrap();
    let opened = fixture.person("mail-thread-open", json!({ "thread": junk_thread }));
    let junk_msg = opened["data"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["content"]["sender"]["address"] == "bridge@evil.example")
        .unwrap()["message"]
        .as_i64()
        .unwrap();
    let reply_junk = fixture.person(
        "mail-draft-create",
        json!({
            "answers": junk_msg,
            "to": ["bridge@evil.example", "junkcc@evil.example"],
            "subject": "Re: spam",
            "body": "ok",
        }),
    );
    assert_eq!(
        reply_junk["data"]["recipientBasis"]["to"],
        json!(["new", "new"]),
        "{reply_junk}"
    );
}

#[test]
fn mail_label_refuses_sent_mailbox_and_script_send_without_typed_is_refused() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "s0");
    let sent_id = fixture
        .engine
        .with_store(|store| {
            let accounts = store.accounts()?;
            let mailboxes = store.mailboxes(accounts[0].id)?;
            Ok(mailboxes
                .iter()
                .find(|m| m.name == "Sent Messages")
                .unwrap()
                .id
                .0)
        })
        .unwrap();
    let filed = fixture.agent(
        "tok_a",
        "mail-label",
        json!({ "messages": [msg], "mailbox": sent_id, "copy": true }),
    );
    assert_eq!(filed["error"]["code"], "INVALID_INPUT", "{filed}");

    // Even with an already-allowed recipient and NO typedRecipients, a Script actor
    // executing directly through the registry gets PERSON_REQUIRED.
    let draft = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Hi", "body": "ok" }),
    )["data"]["draft"]
        .as_i64()
        .unwrap();
    let input = json!({ "draft": draft, "revision": 1 });
    let script_ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Script);
    let held = fixture.execute("mail-draft-send", input.clone(), script_ctx);
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let script_approved = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Script)
        .with_approval(token);
    let refused = fixture.execute("mail-draft-send", input, script_approved);
    assert_eq!(refused["error"]["code"], "PERSON_REQUIRED", "{refused}");
    assert!(fixture.smtp.received().is_empty());
}

#[test]
fn verbatim_typing_local_part_case_account_remove_guard_and_journal_redaction() {
    let fixture = Fixture::new(world);
    let made = fixture.person(
        "mail-draft-create",
        json!({
            "to": ["Alice@example.net", "alice@example.net"],
            "subject": "Case test",
            "body": "Body secret text",
        }),
    );
    assert_eq!(made["success"], true, "{made}");
    let draft = made["data"]["draft"].as_i64().unwrap();
    let arg = json!({ "draft": draft, "revision": 1 }).to_string();

    // Extra spaces or wrong local-part case fails verbatim check.
    let (status, _, err, _) =
        fixture.terminal_typing(&["mail-draft-send", &arg], true, &[" Alice@example.net "]);
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Address did not match"), "{err}");

    let (status, _, err, _) = fixture.terminal_typing(
        &["mail-draft-send", &arg],
        true,
        &["alice@example.net", "alice@example.net"],
    );
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Address did not match"), "{err}");

    // Typing both addresses verbatim sends to BOTH distinct local parts.
    let (status, out, err, _) = fixture.terminal_typing(
        &["mail-draft-send", &arg],
        true,
        &["Alice@example.net", "alice@example.net"],
    );
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    assert_eq!(fixture.smtp.received().len(), 1);
    assert_eq!(
        fixture.smtp.received()[0].to,
        vec![
            "Alice@example.net".to_string(),
            "alice@example.net".to_string(),
        ]
    );

    // Stale revision at terminal returns structured PREVIEW_CHANGED JSON without prompting.
    let d2 = fixture.person(
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "subject": "Rev", "body": "v1" }),
    )["data"]["draft"]
        .as_i64()
        .unwrap();
    let _ = fixture.person(
        "mail-draft-update",
        json!({ "draft": d2, "revision": 1, "body": "v2" }),
    );
    let stale_arg = json!({ "draft": d2, "revision": 1 }).to_string();
    let (status, out, _err, asked) = fixture.terminal(&["mail-draft-send", &stale_arg], true);
    assert_eq!(status, EXIT_FAILED);
    assert!(
        asked.is_empty(),
        "must not prompt on stale revision: {asked:?}"
    );
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["error"]["code"], "PREVIEW_CHANGED", "{parsed}");

    // Account removal is refused with WORK_RUNNING while a send is in `sending`.
    let account_id = fixture
        .engine
        .with_store(|store| {
            let accounts = store.accounts()?;
            let _ = store.begin_draft_send(
                d2,
                2,
                &std::collections::HashSet::new(),
                "inflight@example.com",
                &loam_mail::store::Proposer {
                    kind: "human".to_string(),
                    id: None,
                },
                1_000,
            )?;
            Ok(accounts[0].id.0)
        })
        .unwrap();
    let rm_input = json!({ "account": account_id });
    let rm_held = fixture.person("mail-account-remove", rm_input.clone());
    let rm_token = rm_held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let rm_ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(rm_token.clone());
    let rm_res = fixture.execute("mail-account-remove", rm_input, rm_ctx);
    assert_eq!(rm_res["error"]["code"], "WORK_RUNNING", "{rm_res}");

    // Verify persisted journal.jsonl after hold + refusal + send:
    // never stores any approvalToken detail or token secret, never stores
    // provider reply text, and never copies draft body into send results.
    let journal =
        std::fs::read_to_string(fixture.directory.path().join("data").join("journal.jsonl"))
            .unwrap();
    assert!(!journal.contains(&rm_token), "{journal}");
    assert!(!journal.contains("scripted.smtp"), "{journal}");
    assert!(journal.contains("mail-draft-send"), "{journal}");
    for line in journal.lines() {
        let entry: Value = serde_json::from_str(line).unwrap();
        assert!(
            entry
                .pointer("/result/error/details/approvalToken")
                .is_none(),
            "approvalToken detail must be redacted from journal: {entry}"
        );
        if entry["command"] == "mail-draft-send" {
            let result_text = entry["result"].to_string();
            assert!(
                !result_text.contains("Body secret text"),
                "draft body must not be copied into mail-draft-send result: {entry}"
            );
        }
    }
}
