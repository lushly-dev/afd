//! Unsubscribing at the terminal and its preview (step D3, third part; the
//! specification's 9.5, 11, 13, M18 and M29), on scripted HTTPS and SMTP
//! doubles.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use afd::{ActorKind, ApprovalPolicy, CommandContext, CommandInterface, canonical_json};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::provider::http::HttpsPoster;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::provider::smtp::{SmtpEndpoint, SmtpSender};
use loam_mail::secrets::InMemory;
use loam_mail::store::{AccountRow, OutboundState};
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};
use support::http::{HttpBehavior, HttpServer};
use support::imap::{PASSWORD, Server, USER, World};
use support::smtp::{SmtpFault, SmtpServer};
use support::synced::{Fixture, assert_labelled, mail};

const CONTENT_WORDS: &[&str] = &[
    "lists.example.com",
    "unsub-secret-token",
    "leave@lists.example.com",
    "news.lists.example.com",
    "SecretServerReplyBody",
    "Newsletter Sender",
    "About oneclick",
    "About mailtoonly",
];

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);

    // 1. One-click HTTPS POST + mailto (prefers one-click HTTPS POST).
    world.add(
        "INBOX",
        mail(
            "Newsletter Sender <news@lists.example.com>",
            "oneclick",
            concat!(
                "List-Id: <news.lists.example.com>\r\n",
                "List-Unsubscribe: <mailto:leave@lists.example.com>, <https://lists.example.com/u/41?k=unsub-secret-token>\r\n",
                "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            ),
        ),
        &[],
    );

    // 2. HTTPS link WITHOUT List-Unsubscribe-Post, plus mailto -> falls back to mailto.
    world.add(
        "INBOX",
        mail(
            "Digest <digest@lists.example.com>",
            "mailtoonly",
            concat!(
                "List-Id: <digest.lists.example.com>\r\n",
                "List-Unsubscribe: <https://lists.example.com/browser-only>, <mailto:leave@lists.example.com?subject=Leave%20Digest&body=Remove+me>\r\n",
            ),
        ),
        &[],
    );

    // 3. Browser-only HTTPS link (no List-Unsubscribe-Post, no mailto) -> refused.
    world.add(
        "INBOX",
        mail(
            "Shop <shop@lists.example.com>",
            "browseronly",
            "List-Unsubscribe: <https://lists.example.com/browser-only>\r\n",
        ),
        &[],
    );

    // 4. Plain HTTP link even with List-Unsubscribe-Post -> refused.
    world.add(
        "INBOX",
        mail(
            "Insecure <plain@lists.example.com>",
            "httponly",
            concat!(
                "List-Unsubscribe: <http://lists.example.com/u/plain>\r\n",
                "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            ),
        ),
        &[],
    );

    // 5. No List-Unsubscribe header at all -> refused.
    world.add(
        "INBOX",
        mail("Plain Person <friend@example.org>", "noheader", ""),
        &[],
    );

    // 6. Poisoned mailto with bcc query parameter -> refused.
    world.add(
        "INBOX",
        mail(
            "Poison <poison@lists.example.com>",
            "poisoned",
            "List-Unsubscribe: <mailto:leave@lists.example.com?bcc=victim@example.org>\r\n",
        ),
        &[],
    );

    // 7. Loopback SSRF target -> refused.
    world.add(
        "INBOX",
        mail(
            "Ssrf <ssrf@lists.example.com>",
            "ssrf",
            concat!(
                "List-Unsubscribe: <https://127.0.0.1:8443/internal>\r\n",
                "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            ),
        ),
        &[],
    );

    // 8. Overlong target (> 2048 chars) -> refused.
    let long_path = "x".repeat(2050);
    world.add(
        "INBOX",
        mail(
            "Long <long@lists.example.com>",
            "overlong",
            &format!(
                "List-Unsubscribe: <https://lists.example.com/{long_path}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n"
            ),
        ),
        &[],
    );

    // 9. Malformed mailto with authority -> refused.
    world.add(
        "INBOX",
        mail(
            "Auth <auth@lists.example.com>",
            "authoritymailto",
            "List-Unsubscribe: <mailto://evil.example.com/leave@lists.example.com>\r\n",
        ),
        &[],
    );

    // 10. Unencoded RFC 3986 illegal character in HTTPS query -> refused before connecting.
    world.add(
        "INBOX",
        mail(
            "Brace <brace@lists.example.com>",
            "badquery",
            concat!(
                "List-Unsubscribe: <https://lists.example.com/u?x={bad}>\r\n",
                "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n",
            ),
        ),
        &[],
    );
}

fn find_message(fixture: &Fixture, word: &str) -> i64 {
    let found = fixture.person("mail-search", json!({ "query": word }));
    found["data"]["hits"][0]["message"].as_i64().unwrap()
}

fn approved_unsubscribe(fixture: &Fixture, input: Value) -> Value {
    let held = fixture.person("mail-unsubscribe", input.clone());
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
    fixture.execute("mail-unsubscribe", input, context)
}

#[test]
fn one_click_https_preview_approval_and_post_at_terminal() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "oneclick");

    // 1. Preview contacts nothing and returns labelled content + 43-char digest.
    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    assert_eq!(shown["success"], true, "{shown}");
    assert_labelled(&shown, CONTENT_WORDS);
    assert!(fixture.http.received().is_empty());
    assert!(fixture.smtp.received().is_empty());

    let unsub = &shown["data"]["unsubscribe"];
    assert_eq!(unsub["message"], msg);
    assert_eq!(unsub["account"]["id"], fixture.account.id.0);
    assert_eq!(unsub["method"], "one-click");
    assert_eq!(unsub["content"]["trust"], "content");
    assert_eq!(
        unsub["content"]["target"],
        "https://lists.example.com/u/41?k=unsub-secret-token"
    );
    assert_eq!(unsub["content"]["listId"], "news.lists.example.com");
    let digest = unsub["digest"].as_str().unwrap().to_string();
    assert_eq!(digest.len(), 43);

    // Determinism: two reads of an unchanged target match in canonical JSON.
    let shown2 = fixture.person(
        "mail-unsubscribe-show",
        json!({ "message": msg, "digest": digest }),
    );
    assert_eq!(
        canonical_json(&shown["data"]).unwrap(),
        canonical_json(&shown2["data"]).unwrap()
    );

    // 2. Saying "no" at the terminal prints exact labelled target and contacts nothing.
    let arg = json!({ "message": msg }).to_string();
    let (status, _out, err, _) = fixture.terminal(&["mail-unsubscribe", &arg], false);
    assert_eq!(status, EXIT_FAILED);
    assert!(
        err.contains("https://lists.example.com/u/41?k=unsub-secret-token"),
        "{err}"
    );
    assert!(err.contains("one-click HTTPS POST"), "{err}");
    assert!(err.contains("news.lists.example.com"), "{err}");
    assert!(fixture.http.received().is_empty());
    assert!(fixture.smtp.received().is_empty());

    // 3. Saying "yes" at the terminal fills in digest, sends exact RFC 8058 POST.
    let (status, out, err, _) = fixture.terminal(&["mail-unsubscribe", &arg], true);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_labelled(&parsed, CONTENT_WORDS);
    assert_eq!(parsed["data"]["method"], "one-click");
    assert_eq!(parsed["data"]["state"], "sent");
    assert_eq!(parsed["data"]["status"], 200);
    let outbound_id = parsed["data"]["outbound"].as_i64().unwrap();

    // Verify exact HTTP wire request.
    let requests = fixture.http.received();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].target, "/u/41?k=unsub-secret-token");
    assert_eq!(requests[0].host.as_deref(), Some("lists.example.com"));
    assert_eq!(
        requests[0].content_type.as_deref(),
        Some("application/x-www-form-urlencoded")
    );
    assert_eq!(requests[0].body, b"List-Unsubscribe=One-Click");
    assert!(fixture.smtp.received().is_empty());

    // Verify outbound record stored cleanly.
    let row = fixture
        .engine
        .with_store(|s| s.outbound(outbound_id))
        .unwrap()
        .unwrap();
    assert_eq!(row.kind, "unsubscribe");
    assert_eq!(row.state, OutboundState::Sent);
}

#[test]
fn mailto_fallback_previews_and_sends_over_smtp_with_sent_copy() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "mailtoonly");

    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    assert_eq!(shown["success"], true, "{shown}");
    assert_labelled(&shown, CONTENT_WORDS);
    let unsub = &shown["data"]["unsubscribe"];
    assert_eq!(unsub["method"], "mail");
    assert_eq!(unsub["content"]["mailto"]["to"], "leave@lists.example.com");
    assert_eq!(unsub["content"]["mailto"]["subject"], "Leave Digest");
    assert_eq!(unsub["content"]["mailto"]["body"], "Remove+me");

    let arg = json!({ "message": msg }).to_string();
    let (status, out, err, _) = fixture.terminal(&["mail-unsubscribe", &arg], true);
    assert_eq!(status, EXIT_OK, "out={out}\nerr={err}");
    assert!(err.contains("leave@lists.example.com"), "{err}");
    assert!(err.contains("Leave Digest"), "{err}");
    assert!(err.contains("Remove+me"), "{err}");

    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["success"], true, "{parsed}");
    assert_labelled(&parsed, CONTENT_WORDS);
    assert_eq!(parsed["data"]["method"], "mail");
    assert_eq!(parsed["data"]["state"], "sent");
    assert_eq!(parsed["data"]["sentCopy"], true);

    // Zero HTTP requests; one SMTP message to leave@lists.example.com.
    assert!(fixture.http.received().is_empty());
    let sent = fixture.smtp.received();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].from, USER);
    assert_eq!(sent[0].to, vec!["leave@lists.example.com".to_string()]);
    let wire = mail_parser::MessageParser::new()
        .parse(&sent[0].data)
        .unwrap();
    assert_eq!(wire.subject(), Some("Leave Digest"));
    assert!(wire.body_text(0).unwrap().contains("Remove+me"));

    // Sent Messages mailbox got the copy with `\Seen`.
    let sent_box = fixture.server.world().find("Sent Messages").clone();
    assert_eq!(sent_box.messages.len(), 1);
    let appended = sent_box.messages.values().next().unwrap();
    assert!(appended.flags.contains(&"\\Seen".to_string()));
}

#[test]
fn refuses_messages_with_no_usable_unsubscribe_header() {
    let fixture = Fixture::new(world);

    for word in [
        "browseronly",
        "httponly",
        "noheader",
        "poisoned",
        "ssrf",
        "overlong",
        "authoritymailto",
        "badquery",
    ] {
        let msg = find_message(&fixture, word);
        let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
        assert_eq!(
            shown["error"]["code"], "UNSUBSCRIBE_NOT_AVAILABLE",
            "word={word} shown={shown}"
        );
        assert_labelled(&shown, CONTENT_WORDS);

        // Terminal refuses BEFORE asking for confirmation.
        let arg = json!({ "message": msg }).to_string();
        let (status, out, _err, asked) = fixture.terminal(&["mail-unsubscribe", &arg], true);
        assert_eq!(status, EXIT_FAILED, "word={word}");
        assert!(
            asked.is_empty(),
            "word={word} must not prompt when unusable"
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["error"]["code"], "UNSUBSCRIBE_NOT_AVAILABLE");

        // Direct registry call also refuses BEFORE issuing an approval hold.
        let direct = fixture.person(
            "mail-unsubscribe",
            json!({
                "message": msg,
                "digest": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            }),
        );
        assert_eq!(
            direct["error"]["code"], "UNSUBSCRIBE_NOT_AVAILABLE",
            "word={word} direct={direct}"
        );
    }

    assert!(fixture.http.received().is_empty());
    assert!(fixture.smtp.received().is_empty());
}

#[test]
fn enforces_m18_m29_person_only_and_digest_binding() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "oneclick");
    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    let digest = shown["data"]["unsubscribe"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // Registry metadata check (M18 & M29).
    let def = fixture
        .registry
        .list()
        .into_iter()
        .find(|c| c.name == "mail-unsubscribe")
        .expect("mail-unsubscribe registered");
    assert!(def.mutation);
    assert_eq!(def.destructive, Some(true));
    assert!(matches!(def.approval, Some(ApprovalPolicy::Required)));
    assert!(def.expose.cli);
    assert!(!def.expose.mcp && !def.expose.agent && !def.expose.palette);

    // Agent over MCP cannot call mail-unsubscribe (M18), but CAN read preview.
    let agent_show = fixture.agent("tok_a", "mail-unsubscribe-show", json!({ "message": msg }));
    assert_eq!(agent_show["success"], true, "{agent_show}");
    let agent_call = fixture.agent(
        "tok_a",
        "mail-unsubscribe",
        json!({ "message": msg, "digest": digest }),
    );
    assert_eq!(
        agent_call["error"]["code"], "COMMAND_NOT_EXPOSED",
        "{agent_call}"
    );

    // Script at CLI gets PERSON_REQUIRED.
    let arg = json!({ "message": msg, "digest": digest }).to_string();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &["mail-unsubscribe".to_string(), arg],
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

    // Missing digest fails schema validation before hold.
    let missing = fixture.person("mail-unsubscribe", json!({ "message": msg }));
    assert_eq!(missing["error"]["code"], "VALIDATION_ERROR", "{missing}");

    // Wrong digest fails PREVIEW_CHANGED on show, direct call (before hold), and terminal.
    let bad = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let bad_show = fixture.person(
        "mail-unsubscribe-show",
        json!({ "message": msg, "digest": bad }),
    );
    assert_eq!(bad_show["error"]["code"], "PREVIEW_CHANGED", "{bad_show}");

    let bad_direct = fixture.person("mail-unsubscribe", json!({ "message": msg, "digest": bad }));
    assert_eq!(
        bad_direct["error"]["code"], "PREVIEW_CHANGED",
        "{bad_direct}"
    );

    let bad_arg = json!({ "message": msg, "digest": bad }).to_string();
    let (status, out, _err, asked) = fixture.terminal(&["mail-unsubscribe", &bad_arg], true);
    assert_eq!(status, EXIT_FAILED);
    assert!(asked.is_empty());
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["error"]["code"], "PREVIEW_CHANGED");

    assert!(fixture.http.received().is_empty());
    assert!(fixture.smtp.received().is_empty());
}

#[test]
fn handles_https_double_faults_redirects_and_unknown_outcomes() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "oneclick");
    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    let digest = shown["data"]["unsubscribe"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // 1. 302 redirect is refused and never followed (only 1 request recorded).
    fixture.http.world().behavior = HttpBehavior::Redirect {
        status: 302,
        location: "https://other.example.com/evil".to_string(),
    };
    let redirected = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(
        redirected["error"]["code"], "PROVIDER_REFUSED",
        "{redirected}"
    );
    assert_eq!(redirected["error"]["retryable"], false);
    assert_labelled(&redirected, CONTENT_WORDS);
    assert_eq!(fixture.http.received().len(), 1);

    // 2. 429 rate limit -> retryable PROVIDER_LIMIT, response body never echoed.
    fixture.http.world().behavior = HttpBehavior::Status {
        status: 429,
        body: "SecretServerReplyBody retry later".to_string(),
    };
    let limited = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(limited["error"]["code"], "PROVIDER_LIMIT", "{limited}");
    assert_eq!(limited["error"]["retryable"], true);
    assert_labelled(&limited, CONTENT_WORDS);

    // 3. 403 -> non-retryable PROVIDER_REFUSED.
    fixture.http.world().behavior = HttpBehavior::Status {
        status: 403,
        body: "SecretServerReplyBody forbidden".to_string(),
    };
    let refused = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(refused["error"]["code"], "PROVIDER_REFUSED", "{refused}");
    assert_eq!(refused["error"]["retryable"], false);
    assert_labelled(&refused, CONTENT_WORDS);

    // 4. 503 -> retryable PROVIDER_UNAVAILABLE.
    fixture.http.world().behavior = HttpBehavior::Status {
        status: 503,
        body: "SecretServerReplyBody down".to_string(),
    };
    let server_err = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(
        server_err["error"]["code"], "PROVIDER_UNAVAILABLE",
        "{server_err}"
    );
    assert_eq!(server_err["error"]["retryable"], true);
    assert_labelled(&server_err, CONTENT_WORDS);

    // 5. Connection dropped after request written -> SEND_OUTCOME_UNKNOWN, shown in mail-status.
    fixture.http.world().behavior = HttpBehavior::DropAfterRequest;
    let dropped = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(
        dropped["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{dropped}"
    );
    assert_eq!(dropped["error"]["retryable"], false);
    assert_labelled(&dropped, CONTENT_WORDS);

    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["kind"],
        "unsubscribe"
    );
}

#[test]
fn handles_https_timeout_after_request_as_unknown() {
    let directory = tempfile::tempdir().unwrap();
    let server = Server::start(true, true);
    let smtp = SmtpServer::start();
    let http = HttpServer::start();
    http.world().behavior = HttpBehavior::StallAfterRequest;
    world(&mut server.world());

    let connector = ImapConnector::new(
        Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        },
        ICLOUD_NAMES,
        |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            })
        },
    );
    let sender = SmtpSender::new(
        SmtpEndpoint::plain("127.0.0.1", smtp.address.port()),
        |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            })
        },
    );
    let poster =
        HttpsPoster::for_test_endpoint(http.address).with_timeout(Duration::from_millis(150));
    let engine = Arc::new(
        Engine::new(Some(Home::at(directory.path().join("data"))))
            .with_connector(Arc::new(connector))
            .with_sender(Arc::new(sender))
            .with_unsubscribe_poster(Arc::new(poster))
            .with_sync_options(Options {
                backoff: Duration::ZERO,
                ..Options::default()
            }),
    );
    let account: AccountRow = engine
        .with_store(|store| {
            store.add_account("icloud", USER, 0)?;
            Ok(store.accounts()?.remove(0))
        })
        .unwrap();
    let registry = loam_mail::registry(&engine).unwrap();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(sync_account(
        &engine,
        engine.connector().unwrap().as_ref(),
        &account,
        engine.sync_options(),
        &afd::SystemClock,
        &|_| {},
    ))
    .unwrap();

    let ctx = || {
        CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
    };
    let found = serde_json::to_value(rt.block_on(registry.execute(
        "mail-search",
        json!({ "query": "oneclick" }),
        Some(ctx()),
    )))
    .unwrap();
    let msg = found["data"]["hits"][0]["message"].as_i64().unwrap();
    let shown = serde_json::to_value(rt.block_on(registry.execute(
        "mail-unsubscribe-show",
        json!({ "message": msg }),
        Some(ctx()),
    )))
    .unwrap();
    let digest = shown["data"]["unsubscribe"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    let input = json!({ "message": msg, "digest": digest });
    let held = serde_json::to_value(rt.block_on(registry.execute(
        "mail-unsubscribe",
        input.clone(),
        Some(ctx()),
    )))
    .unwrap();
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let res = serde_json::to_value(rt.block_on(registry.execute(
        "mail-unsubscribe",
        input,
        Some(ctx().with_approval(token)),
    )))
    .unwrap();
    assert_eq!(res["error"]["code"], "SEND_OUTCOME_UNKNOWN", "{res}");
    assert_eq!(http.received().len(), 1);
}

#[test]
fn handles_mailto_smtp_refusal_and_drop_after_handover() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "mailtoonly");
    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    let digest = shown["data"]["unsubscribe"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    // 1. Explicit 550 refusal -> PROVIDER_REFUSED, not retryable, unsubscribe-specific suggestion.
    fixture.smtp.world().fault = Some(SmtpFault::RefuseAfterData(550));
    let refused = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(refused["error"]["code"], "PROVIDER_REFUSED", "{refused}");
    assert_eq!(refused["error"]["retryable"], false);
    assert!(
        !refused["error"]["suggestion"]
            .as_str()
            .unwrap_or_default()
            .contains("draft"),
        "unsubscribe error must not mention draft: {refused}"
    );

    // 2. Drop after handover -> SEND_OUTCOME_UNKNOWN, reported in mail-status.
    fixture.smtp.world().fault = Some(SmtpFault::DropAfterHandover);
    let dropped = approved_unsubscribe(&fixture, json!({ "message": msg, "digest": digest }));
    assert_eq!(
        dropped["error"]["code"], "SEND_OUTCOME_UNKNOWN",
        "{dropped}"
    );
    assert_eq!(dropped["error"]["retryable"], false);

    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["kind"],
        "unsubscribe"
    );
}

#[test]
fn dropping_in_flight_unsubscribe_marks_outbound_unknown_and_aborts_connection() {
    let fixture = Fixture::new(world);
    let msg = find_message(&fixture, "oneclick");
    let shown = fixture.person("mail-unsubscribe-show", json!({ "message": msg }));
    let digest = shown["data"]["unsubscribe"]["digest"]
        .as_str()
        .unwrap()
        .to_string();

    fixture.http.world().behavior = HttpBehavior::StallAfterRequest;
    let input = json!({ "message": msg, "digest": digest });
    let held = fixture.person("mail-unsubscribe", input.clone());
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
    let token = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();

    // Cancel the in-flight future well before HttpsPoster's 30s timeout so
    // `InFlightUnsubscribe::drop` and `AbortOnDrop` both execute.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let ctx = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(ActorKind::Human)
        .with_approval(token);
    let timed_out = rt.block_on(async {
        tokio::time::timeout(
            Duration::from_millis(150),
            fixture
                .registry
                .execute("mail-unsubscribe", input, Some(ctx)),
        )
        .await
    });
    assert!(timed_out.is_err(), "expected outer cancellation timeout");

    // InFlightUnsubscribe::drop must have marked the outbound row `unknown`
    // (never stranded in `sending`).
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["outbound"]["sending"], 0, "{status}");
    assert_eq!(status["data"]["outbound"]["unknown"], 1, "{status}");
    assert_eq!(
        status["data"]["outbound"]["unknownSends"][0]["kind"],
        "unsubscribe"
    );
}
