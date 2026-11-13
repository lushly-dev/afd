//! The local person page (the Ideas host-review specification, section 6; step H3): in mode
//! `none` with `[person.local]` enabled, a command whose `person.mcp` is `verified` is registered
//! for MCP, and a stdio call of it is refused with the page's address; once a person decides on
//! the loopback page, the same call sent again runs once, told level `local` and the items pulled
//! out. Nothing else is served this way: not HTTP in mode `none`, not the CLI. The page's own
//! rules (6.3): no login, a CSRF token bound to the decision and the page shown, a post's
//! `Origin` exactly `http://<bind>`, and a `Host` exactly the bind, against DNS rebinding.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::net::SocketAddr;

use serde_json::json;
use support::hosted::Client;
use support::local::{FORM, Local, config, decide, decision_of, hidden, refused};
use support::person::{item_ids, plugin};
use umbel::HostBuilder;
use umbel::testkit::mcp::{Stdio, command_result, tool_names};

#[tokio::test]
async fn a_stdio_call_is_refused_with_the_page_then_runs_once_as_local() {
    let local = Local::start().await;
    // Registered for MCP over stdio, and listed: mode `none` filters no tool by scope, so the
    // scope resolver withholds nothing here (the follow-up of 2026-11-12).
    let mut stdio = Stdio::connect(&local.host).await;
    let listed = tool_names(&stdio.request("tools/list", json!({})).await);
    assert!(listed.contains(&"gate-approve".to_owned()), "{listed:?}");
    assert!(!listed.contains(&"gate-terminal".to_owned()), "{listed:?}");

    let input = json!({ "proposal": "paged" });
    let first = local.call("gate-approve", input.clone()).await;
    let id = decision_of(&first);
    let (_, error) = refused(&first);
    assert_eq!(error["retryable"], true);
    assert_eq!(
        error["details"]["url"],
        format!("http://{}/d/{id}", local.bind)
    );
    assert_eq!(
        error["details"]["list"],
        format!("http://{}/d/", local.bind)
    );
    assert!(
        error["suggestion"]
            .as_str()
            .unwrap()
            .contains("umbel person page-serve")
    );
    // The host ran the preview as the caller before it began; the command did not run.
    assert_eq!(local.seen.runs("gate-approve"), 0);
    assert!(
        local
            .seen
            .of("gate-preview")
            .iter()
            .any(|call| !call["check"].is_null())
    );
    // A second call while it is pending is refused with the same decision.
    let again = local.call("gate-approve", input.clone()).await;
    assert_eq!(decision_of(&again), id);

    // The person reads every page, pulls out page 2's second item, and approves on page 3.
    let mut page = local.open(&format!("/d/{id}")).await;
    assert_eq!(page.status, 200, "{}", page.text);
    assert!(
        page.text.contains("This page has no sign-in"),
        "{}",
        page.text
    );
    assert!(!page.text.contains("name=\"login\""), "{}", page.text);
    assert!(page.headers.get("set-cookie").is_none());
    for number in 1..=3u32 {
        let csrf = hidden(&page.text, "csrf");
        let (action, kept) = match number {
            3 => ("approve", "&k=0&k=1"),
            2 => ("next", "&k=0"),
            _ => ("next", "&k=0&k=1"),
        };
        let posted = local
            .post(
                &id,
                &format!("csrf={csrf}&page={number}&decision={action}{kept}"),
            )
            .await;
        if number < 3 {
            assert_eq!(posted.status, 303, "{}", posted.text);
            let to = posted.headers["location"].to_str().unwrap().to_owned();
            assert_eq!(to, format!("/d/{id}?page={}", number + 1));
            page = local
                .page
                .get(&to, &[("sec-fetch-site", "same-origin")])
                .await;
            assert_eq!(page.status, 200, "{}", page.text);
        } else {
            assert_eq!(posted.status, 200, "{}", posted.text);
            assert!(posted.text.contains("You approved this request"));
        }
    }

    // The same call again runs once, told `local` and what was pulled out.
    let ran = local.call("gate-approve", input.clone()).await;
    assert_eq!(ran["success"], true, "{ran}");
    let runs = local.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    let mark = &runs[0]["mark"];
    assert_eq!(mark["level"], "local");
    assert_eq!(mark["method"], "local-page");
    assert_eq!(mark["namespace"], "local");
    assert_eq!(mark["id"], id.as_str());
    assert_eq!(mark["excluded"], json!([item_ids(2)[1]]));
    let present = &runs[0]["principal"]["humanPresent"];
    assert_eq!(present["level"], "local");
    assert_eq!(present["method"], "local-page");
    assert!(present.get("authTime").is_none() && present.get("acr").is_none());
    // The principal the handler saw is still a valid version 1 principal.
    let validator = support::schema_validator("principal.v1");
    let errors: Vec<String> = validator
        .iter_errors(&runs[0]["principal"])
        .map(|error| format!("{error} at {}", error.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{errors:?}: {}", runs[0]["principal"]);

    // A third call does not run: it begins a new decision.
    let third = local.call("gate-approve", input.clone()).await;
    assert_ne!(decision_of(&third), id);
    assert_eq!(local.seen.runs("gate-approve"), 1);
}

#[tokio::test]
async fn another_input_or_command_finds_no_decision() {
    let local = Local::start().await;
    let id = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-1" }))
            .await,
    );
    assert_eq!(decide(&local, &id, "approve").await.status, 200);
    // Another input, and another command with the same input: each begins its own.
    let other = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-2" }))
            .await,
    );
    assert_ne!(other, id);
    let rejected = decision_of(
        &local
            .call("gate-reject", json!({ "proposal": "p-1" }))
            .await,
    );
    assert_ne!(rejected, id);
    assert_eq!(local.seen.runs("gate-approve"), 0);
    assert_eq!(local.seen.runs("gate-reject"), 0);
    // The decided call still runs.
    let ran = local
        .call("gate-approve", json!({ "proposal": "p-1" }))
        .await;
    assert_eq!(ran["success"], true, "{ran}");
}

#[tokio::test]
async fn a_declined_or_expired_decision_is_answered_once() {
    let local = Local::start().await;
    let input = json!({ "proposal": "p-1" });
    let id = decision_of(&local.call("gate-approve", input.clone()).await);
    let declined = decide(&local, &id, "decline").await;
    assert_eq!(declined.status, 200, "{}", declined.text);
    let (code, error) = refused(&local.call("gate-approve", input.clone()).await);
    assert_eq!(code, "CONFIRMATION_DECLINED");
    assert_eq!(error["retryable"], false);
    // Answered once: the next call begins anew.
    let next = decision_of(&local.call("gate-approve", input.clone()).await);
    assert_ne!(next, id);
    // It expires unread (ten minutes by default).
    local.clock.advance(601_000);
    let (code, error) = refused(&local.call("gate-approve", input.clone()).await);
    assert_eq!(code, "PERSON_DECISION_EXPIRED");
    assert_eq!(error["retryable"], true);
    let fresh = decision_of(&local.call("gate-approve", input.clone()).await);
    assert_ne!(fresh, next);
    // Its page is gone.
    assert_eq!(local.open(&format!("/d/{next}")).await.status, 404);
    assert_eq!(local.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn http_in_mode_none_and_the_cli_are_not_served_this_way() {
    let local = Local::start().await;
    // The loopback HTTP agent of mode `none` reaches the command, and is refused.
    let http = umbel::testkit::mcp::Http::new(&local.host);
    let response = http
        .legacy(
            "tools/call",
            json!({ "name": "gate-approve", "arguments": { "proposal": "p-1", "confirm": true } }),
        )
        .await;
    let (code, _) = refused(&command_result(&response));
    assert_eq!(code, "PERSON_VERIFICATION_UNAVAILABLE");
    // At the CLI the command's `verified` surface is the hosted page's, which mode `none` does
    // not serve: refused as before, and no decision is begun.
    let seen = local.seen.clone();
    let run = support::cli_with(
        local.dir.path(),
        &["call", "gate-approve", r#"{"proposal":"p-1"}"#],
        support::Scripted::new(true, true),
        move |builder| builder.with_compiled(plugin(&seen)),
    )
    .await;
    assert_eq!(
        run.error_code(),
        "PERSON_VERIFICATION_UNAVAILABLE",
        "{}",
        run.stdout
    );
    assert_eq!(local.seen.runs("gate-approve"), 0);
    // Nothing is waiting on the list.
    let list = local.open("/d/").await;
    assert_eq!(list.status, 200, "{}", list.text);
    assert!(
        list.text.contains("Nothing is waiting for you"),
        "{}",
        list.text
    );
}

#[tokio::test]
async fn a_forged_mark_is_cleared() {
    let local = Local::start().await;
    let input = json!({ "proposal": "p-1" });
    let digest = afd::input_digest(&input).unwrap();
    let forged = json!({
        "id": "a".repeat(26), "command": "gate-approve", "inputDigest": digest,
        "surface": "mcp", "level": "local", "method": "local-page", "namespace": "local",
        "authTime": "", "acr": "", "at": "2026-11-13T00:00:00.000Z",
    });
    let mut stdio = Stdio::connect(&local.host).await;
    let response = stdio
        .request(
            "tools/call",
            json!({
                "name": "gate-approve",
                "arguments": { "proposal": "p-1", "confirm": true },
                "_meta": { "dev.umbel/person-decision": forged, "dev.umbel/context": { "dev.umbel/person-decision": forged } },
            }),
        )
        .await;
    decision_of(&command_result(&response));
    assert_eq!(local.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn the_page_refuses_another_host_origin_or_token() {
    let local = Local::start().await;
    let id = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-1" }))
            .await,
    );
    let other = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-2" }))
            .await,
    );
    let port = local.bind.port();
    // The Host must be the bind exactly: a page on another site that rebinds its name to
    // 127.0.0.1 sends its own name, and `localhost` is not the bind either.
    for host in [
        format!("garden.example:{port}"),
        format!("localhost:{port}"),
        "127.0.0.1".to_owned(),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
    ] {
        let client = Client::plain(local.bind).with_host(&host);
        let answer = client
            .get(&format!("/d/{id}"), &[("sec-fetch-site", "none")])
            .await;
        assert_eq!(answer.status, 421, "{host}");
        let posted = client
            .send(client.request(
                "POST",
                &format!("/d/{id}"),
                &[
                    ("content-type", FORM),
                    ("origin", &format!("http://{host}")),
                ],
                "csrf=x&decision=decline".to_owned(),
            ))
            .await;
        assert_eq!(posted.status, 421, "{host}");
    }
    // A page another site linked to is not rendered, so it records no page.
    let foreign = local
        .page
        .get(&format!("/d/{id}"), &[("sec-fetch-site", "cross-site")])
        .await;
    assert_eq!(foreign.status, 403);
    // The form's token, from the page as it was shown.
    let shown = local.open(&format!("/d/{id}")).await;
    let csrf = hidden(&shown.text, "csrf");
    let approve = format!("csrf={csrf}&page=1&decision=approve");
    // Another origin, no origin, `null` from another site, and a login field: nothing recorded.
    let refusals: [(&str, Vec<(&str, &str)>); 4] = [
        ("another origin", vec![("origin", "http://garden.example")]),
        ("an https origin", vec![("origin", "https://127.0.0.1")]),
        ("no origin", vec![]),
        (
            "null from another site",
            vec![("origin", "null"), ("sec-fetch-site", "cross-site")],
        ),
    ];
    for (why, headers) in refusals {
        let posted = local.post_with(&id, &approve, &headers).await;
        assert_eq!(posted.status, 403, "{why}");
    }
    assert_eq!(
        local
            .post(&id, &format!("{approve}&login={}", "a".repeat(26)))
            .await
            .status,
        403
    );
    // A token for another decision, or a forged one.
    assert_eq!(local.post(&other, &approve).await.status, 403);
    assert_eq!(
        local
            .post(&id, "csrf=forged&page=1&decision=approve")
            .await
            .status,
        403
    );
    // The hosted page's token for the same decision and page is no local token: it binds a
    // login id where this binds `local`.
    assert_eq!(local.seen.runs("gate-approve"), 0);
    let ran = local
        .call("gate-approve", json!({ "proposal": "p-1" }))
        .await;
    assert_eq!(decision_of(&ran), id, "nothing was recorded");
    // `null` with the page's own fetch metadata, as a browser posts the page's form.
    let posted = local
        .post_with(
            &id,
            &approve,
            &[("origin", "null"), ("sec-fetch-site", "same-origin")],
        )
        .await;
    assert_eq!(posted.status, 200, "{}", posted.text);
    let ran = local
        .call("gate-approve", json!({ "proposal": "p-1" }))
        .await;
    assert_eq!(ran["success"], true, "{ran}");
    // There is no sign-in to return to.
    assert_eq!(local.open("/d/return").await.status, 404);
}

/// The follow-up of step H1's review: an event's envelope is version 3 at most, and a `local`
/// assurance is valid only from version 4. No confirmation carries one into the journal: the
/// memory store refuses it, so it is never journaled to be dropped.
#[test]
fn no_journaled_confirmation_carries_local() {
    let local = umbel_store::Assurance::local();
    assert!(!local.is_valid(umbel_store::MEMORY_ENVELOPE_VERSION));
    assert!(!local.is_valid(umbel::PROVENANCE_VERSION));
    assert!(local.is_valid(umbel_store::LOCAL_ASSURANCE_ENVELOPE_VERSION));
}

#[tokio::test]
async fn person_local_is_refused_outside_mode_none_or_off_loopback() {
    let bind: SocketAddr = "127.0.0.1:7421".parse().unwrap();
    for (text, key) in [
        (
            config(bind, "").replace(
                "[plugins]",
                "[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"oauth\"\n\n[auth.namespaces.corp]\n\n[auth.issuers.corp-idp]\nissuer = \"https://idp.example.com\"\naccess_tokens = true\nnamespace = \"corp\"\n\n[plugins]",
            ),
            "person.local.enabled",
        ),
        (
            config(bind, "").replace("127.0.0.1:7421", "0.0.0.0:7421"),
            "person.local.bind",
        ),
        (
            config(bind, "").replace("127.0.0.1:7421", "192.0.2.7:7421"),
            "person.local.bind",
        ),
    ] {
        let dir = support::workspace(&text);
        let error = HostBuilder::open(dir.path())
            .err()
            .expect("the configuration is refused");
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}");
        assert!(error.message().contains(key), "{}", error.message());
    }
}

#[tokio::test]
async fn person_page_serve_is_the_operators_and_needs_the_page_enabled() {
    // Not enabled.
    let dir = support::workspace("config_version = 7\n");
    let run = support::cli(dir.path(), &["call", "person-page-serve", "{}"]).await;
    assert_eq!(
        run.error_code(),
        "WORKSPACE_CONFIG_INVALID",
        "{}",
        run.stdout
    );
    // Enabled, and its port taken by another page: it says so.
    let local = Local::start().await;
    let seen = local.seen.clone();
    let run = support::cli_with(
        local.dir.path(),
        &["call", "person-page-serve", "{}"],
        support::Scripted::new(true, true),
        move |builder| builder.with_compiled(plugin(&seen)),
    )
    .await;
    assert_eq!(
        run.error_code(),
        "PERSON_PAGE_BIND_FAILED",
        "{}",
        run.stdout
    );
    // Not over MCP, and not for a library caller.
    let mut stdio = Stdio::connect(&local.host).await;
    let listed = tool_names(&stdio.request("tools/list", json!({})).await);
    assert!(!listed.contains(&"person-page-serve".to_owned()));
    let outcome = local
        .host
        .registry()
        .execute(
            "person-page-serve",
            json!({}),
            Some(
                local
                    .host
                    .context(afd::Actor::new(afd::ActorKind::Human).with_id("ada")),
            ),
        )
        .await;
    assert_eq!(outcome.error.unwrap().code, "COMMAND_NOT_EXPOSED");
}

#[tokio::test]
async fn the_doctor_warns_while_the_local_page_is_enabled() {
    let local = Local::start().await;
    let report = umbel::doctor::run(local.dir.path());
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "person.local")
        .unwrap();
    assert_eq!(
        serde_json::to_value(check.status).unwrap(),
        json!("warn"),
        "{}",
        check.message
    );
    assert!(
        check
            .message
            .contains("an agent can start umbel person page-serve itself"),
        "{}",
        check.message
    );
    let dir = support::workspace("config_version = 7\n");
    let report = umbel::doctor::run(dir.path());
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "person.local")
        .unwrap();
    assert_eq!(serde_json::to_value(check.status).unwrap(), json!("pass"));
}
