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

/// The public origin a TLS-terminating proxy on this machine serves the page at (A46 to A50).
const PUBLIC: &str = "https://garden-host.example-tailnet.ts.net:8443";
const PUBLIC_HOST: &str = "garden-host.example-tailnet.ts.net:8443";

#[tokio::test]
async fn behind_a_proxy_the_page_admits_its_public_origin_and_hands_it_out() {
    let local = Local::start_public(PUBLIC).await;
    let first = local
        .call("gate-approve", json!({ "proposal": "p-1" }))
        .await;
    let id = decision_of(&first);
    let (_, error) = refused(&first);
    // The links the host hands out name the public origin.
    assert_eq!(error["details"]["url"], format!("{PUBLIC}/d/{id}"));
    assert_eq!(error["details"]["list"], format!("{PUBLIC}/d/"));
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains(&format!("{PUBLIC}/d/{id}")),
        "{error}"
    );
    let other = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-2" }))
            .await,
    );

    // A `Host` naming the public origin is served, in any case, as is the bind's; another host,
    // the public host on another port (443 included), or with no port, is not.
    let public = Client::plain(local.bind).with_host(PUBLIC_HOST);
    let shown = public
        .get(&format!("/d/{id}"), &[("sec-fetch-site", "none")])
        .await;
    assert_eq!(shown.status, 200, "{}", shown.text);
    assert!(
        shown
            .text
            .contains(&format!("It is also served at {PUBLIC}")),
        "{}",
        shown.text
    );
    assert!(shown.headers.get("set-cookie").is_none());
    let upper = Client::plain(local.bind).with_host("Garden-Host.example-tailnet.ts.net:8443");
    assert_eq!(
        upper.get("/d/", &[("sec-fetch-site", "none")]).await.status,
        200
    );
    assert_eq!(local.open("/d/").await.status, 200);
    for host in [
        "weeds.example-tailnet.ts.net:8443",
        "garden-host.example-tailnet.ts.net",
        "garden-host.example-tailnet.ts.net:443",
        "garden-host.example-tailnet.ts.net:8444",
        "garden-host.example-tailnet.ts.net.weeds.example:8443",
    ] {
        let client = Client::plain(local.bind).with_host(host);
        let answer = client
            .get(&format!("/d/{id}"), &[("sec-fetch-site", "none")])
            .await;
        assert_eq!(answer.status, 421, "{host}");
    }

    // A post from another origin, or from the public host over plain HTTP, records nothing.
    let csrf = hidden(&shown.text, "csrf");
    let approve = format!("csrf={csrf}&page=1&decision=approve");
    for origin in [
        "https://weeds.example-tailnet.ts.net:8443",
        "http://garden-host.example-tailnet.ts.net:8443",
        "https://garden-host.example-tailnet.ts.net",
        "https://garden-host.example-tailnet.ts.net:8443/",
    ] {
        let posted = public
            .send(public.request(
                "POST",
                &format!("/d/{id}"),
                &[("content-type", FORM), ("origin", origin)],
                approve.clone(),
            ))
            .await;
        assert_eq!(posted.status, 403, "{origin}");
    }
    assert_eq!(
        decision_of(
            &local
                .call("gate-approve", json!({ "proposal": "p-1" }))
                .await
        ),
        id,
        "nothing was recorded"
    );
    // The public origin with the bind's `Host`, as a proxy that writes the bind sends it.
    let posted = local.post_with(&id, &approve, &[("origin", PUBLIC)]).await;
    assert_eq!(posted.status, 200, "{}", posted.text);
    let ran = local
        .call("gate-approve", json!({ "proposal": "p-1" }))
        .await;
    assert_eq!(ran["success"], true, "{ran}");
    // The public origin with its own `Host`, as a proxy that passes it on sends it.
    let shown = public
        .get(&format!("/d/{other}"), &[("sec-fetch-site", "none")])
        .await;
    let csrf = hidden(&shown.text, "csrf");
    let posted = public
        .send(public.request(
            "POST",
            &format!("/d/{other}"),
            &[("content-type", FORM), ("origin", PUBLIC)],
            format!("csrf={csrf}&page=1&decision=decline"),
        ))
        .await;
    assert_eq!(posted.status, 200, "{}", posted.text);
    assert!(posted.text.contains("You declined this request"));
    assert!(posted.headers.get("set-cookie").is_none());
}

#[tokio::test]
async fn behind_a_proxy_on_the_default_port_either_host_spelling_is_served() {
    let local = Local::start_public("https://garden-host.example-tailnet.ts.net:443/").await;
    let id = decision_of(
        &local
            .call("gate-approve", json!({ "proposal": "p-1" }))
            .await,
    );
    let (_, error) = refused(
        &local
            .call("gate-approve", json!({ "proposal": "p-1" }))
            .await,
    );
    // Kept as a browser writes the origin: no `:443`, no trailing `/`.
    assert_eq!(
        error["details"]["url"],
        format!("https://garden-host.example-tailnet.ts.net/d/{id}")
    );
    for host in [
        "garden-host.example-tailnet.ts.net",
        "garden-host.example-tailnet.ts.net:443",
    ] {
        let client = Client::plain(local.bind).with_host(host);
        let answer = client
            .get(&format!("/d/{id}"), &[("sec-fetch-site", "none")])
            .await;
        assert_eq!(answer.status, 200, "{host}: {}", answer.text);
    }
    let shown = local.open(&format!("/d/{id}")).await;
    let csrf = hidden(&shown.text, "csrf");
    let posted = local
        .post_with(
            &id,
            &format!("csrf={csrf}&page=1&decision=approve"),
            &[("origin", "https://garden-host.example-tailnet.ts.net")],
        )
        .await;
    assert_eq!(posted.status, 200, "{}", posted.text);
}

#[tokio::test]
async fn a_public_origin_is_refused_unless_an_https_origin() {
    let bind: SocketAddr = "127.0.0.1:7421".parse().unwrap();
    for origin in [
        "http://garden-host.example-tailnet.ts.net:8443",
        "https://garden-host.example-tailnet.ts.net:8443/d/",
        "https://garden-host.example-tailnet.ts.net:8443/?bed=3",
        "https://garden-host.example-tailnet.ts.net:8443/#bed",
        "https://gardener@garden-host.example-tailnet.ts.net:8443",
        "https://gardener:seeds@garden-host.example-tailnet.ts.net",
        "https://Garden-Host.example-tailnet.ts.net",
        "https://garden-host.example-tailnet.ts.net:08443",
        "garden-host.example-tailnet.ts.net:8443",
    ] {
        let text = config(bind, "").replace(
            "enabled = true\n",
            &format!("enabled = true\npublic_origin = \"{origin}\"\n"),
        );
        let dir = support::workspace(&text);
        let error = HostBuilder::open(dir.path())
            .err()
            .unwrap_or_else(|| panic!("{origin} was accepted"));
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{origin}");
        assert!(
            error.message().contains("person.local.public_origin"),
            "{origin}: {}",
            error.message()
        );
    }
}

#[tokio::test]
async fn the_doctor_warns_of_a_public_origin() {
    let local = Local::start_public(PUBLIC).await;
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
        check.message.contains(&format!(
            "person.local.public_origin is {PUBLIC}: anyone who can reach that origin can confirm"
        )) && check
            .message
            .contains("an agent can start umbel person page-serve itself"),
        "{}",
        check.message
    );
    // Without it, the warning names no public origin.
    let plain = Local::start().await;
    let report = umbel::doctor::run(plain.dir.path());
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "person.local")
        .unwrap();
    assert!(
        !check.message.contains("public_origin"),
        "{}",
        check.message
    );
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
        // Mode gateway refuses the page as mode oauth does.
        (
            "config_version = 7\n\n[principal]\nlocal_id = \"corp/U019488227\"\n\n[http]\nbind = \"127.0.0.1:8443\"\npublic_url = \"https://umbel.example.com/mcp\"\nallowed_hosts = [\"umbel.example.com\"]\n\n[auth]\nmode = \"gateway\"\n\n[auth.namespaces.corp]\n\n[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"https://gateway.example.com\"\nkeys = \"secrets/gateway/jwks.json\"\nmax_scopes = [\"umbel:read\", \"umbel:write:main\"]\n\n[person.local]\nenabled = true\n".to_owned(),
            "person.local.enabled",
        ),
        // Every IPv6 address but `::1` is off loopback, an IPv4-mapped one included.
        (
            config(bind, "").replace("127.0.0.1:7421", "[::]:7421"),
            "person.local.bind",
        ),
        (
            config(bind, "").replace("127.0.0.1:7421", "[::ffff:127.0.0.1]:7421"),
            "person.local.bind",
        ),
        // `local` is the local page's namespace, reserved in every mode.
        (
            config(bind, "").replace("[plugins]", "[auth.namespaces.local]\n\n[plugins]"),
            "auth.namespaces.local",
        ),
    ] {
        let dir = support::workspace(&text);
        let error = HostBuilder::open(dir.path())
            .err()
            .expect("the configuration is refused");
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}");
        assert!(error.message().contains(key), "{}", error.message());
    }
    // `::1` is loopback, and its page is served there.
    let dir = support::workspace(&config(bind, "").replace("127.0.0.1:7421", "[::1]:7421"));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(plugin(&support::person::Seen::default()))
        .seal()
        .unwrap();
    assert!(host.local_person_server().unwrap().is_some());
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
            .contains("an agent can start umbel person page-serve itself")
            && check
                .message
                .contains("Loopback is shared by every account"),
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
    assert!(check.message.contains("not enabled"), "{}", check.message);
    // A space that lists `local` among its verified levels is named, page or no page.
    let dir = support::workspace(
        "config_version = 7\n\n[spaces.main]\nverified_levels = [\"terminal\", \"local\"]\n",
    );
    let report = umbel::doctor::run(dir.path());
    let check = report
        .checks
        .iter()
        .find(|check| check.id == "person.local")
        .unwrap();
    assert_eq!(serde_json::to_value(check.status).unwrap(), json!("warn"));
    assert!(
        check
            .message
            .contains("spaces.main.verified_levels lists local"),
        "{}",
        check.message
    );
}

/// Two identical calls sent at once after one approval: the decision runs exactly one of them,
/// and the other begins a decision of its own.
#[tokio::test]
async fn two_identical_calls_racing_after_one_approval_run_once() {
    let local = Local::start().await;
    let input = json!({ "proposal": "p-race" });
    let id = decision_of(&local.call("gate-approve", input.clone()).await);
    assert_eq!(decide(&local, &id, "approve").await.status, 200);
    let (first, second) = tokio::join!(
        local.call("gate-approve", input.clone()),
        local.call("gate-approve", input.clone())
    );
    let ran = [&first, &second]
        .iter()
        .filter(|outcome| outcome["success"] == true)
        .count();
    assert_eq!(ran, 1, "{first}\n{second}");
    assert_eq!(local.seen.runs("gate-approve"), 1);
    let refused = if first["success"] == true {
        &second
    } else {
        &first
    };
    assert_ne!(decision_of(refused), id);
}

/// The local registration is not host-verified, so AFD lets a pipeline name the command as a
/// step. The step meets the plugin gate as a call of its own: it needs its own decision, spent
/// once, and the pipeline's own acknowledgement grants nothing.
#[tokio::test]
async fn a_person_gated_step_of_a_pipeline_needs_its_own_decision() {
    const PIPE: &str = r#"
[[pipelines]]
name = "gate-pipe"
description = "Apply a proposal as a step."
effects = ["plugin-state"]
input_schema = { type = "object", properties = { proposal = { type = "string" } }, required = ["proposal"], additionalProperties = false }
expose = { mcp = true, agent = false, cli = true }
journal = { mode = "digest", keep = ["proposal"] }
steps = [ { command = "gate-approve", input = { proposal = "$input.proposal" } } ]
"#;
    let local = Local::start_plugin("", |seen| {
        support::person::plugin_with(seen, format!("{}{PIPE}", support::person::MANIFEST))
    })
    .await;
    let input = json!({ "proposal": "p-pipe" });
    let asked = local.call("gate-pipe", input.clone()).await;
    assert_eq!(asked["success"], false, "{asked}");
    assert!(
        asked.to_string().contains("CONFIRMATION_REQUIRED"),
        "{asked}"
    );
    assert_eq!(local.seen.runs("gate-approve"), 0);
    // The step's decision is the step's call's, for its command and input.
    let list = local.open("/d/").await;
    assert!(
        list.text.contains("<code>gate-approve</code>"),
        "{}",
        list.text
    );
    let start = list
        .text
        .find("<a href=\"/d/")
        .unwrap_or_else(|| panic!("{asked}\n{}", list.text))
        + "<a href=\"/d/".len();
    let id = list.text[start..start + 26].to_owned();
    assert_eq!(decide(&local, &id, "approve").await.status, 200);
    let ran = local.call("gate-pipe", input.clone()).await;
    assert_eq!(ran["success"], true, "{ran}");
    let runs = local.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["mark"]["level"], "local");
    // Spent: the pipeline sent again does not run the step.
    let again = local.call("gate-pipe", input).await;
    assert_eq!(again["success"], false, "{again}");
    assert_eq!(local.seen.runs("gate-approve"), 1);
}

/// A decision on the local page cannot confirm a memory, end to end: the refusal names `local`,
/// and no confirmation, which a journaled event would carry, is recorded (the follow-up of step
/// H1's review).
#[tokio::test]
async fn memory_confirm_under_a_local_decision_is_refused_by_name() {
    use support::memory::{MemoryProbe, config, manifest};
    let gated = manifest("")
        .replace("manifest_version = 3", "manifest_version = 5")
        .replace(
            "journal = { mode = \"digest\" }\nconfirm_prompt = \"You are vouching for this record's text as your own.\"\nconfirm = \"require-human\"\nexpose = { mcp = false, agent = false, cli = true }",
            "journal = { mode = \"digest\", keep = [\"space\"] }\nconfirm_prompt = \"You are vouching for this record's text as your own.\"\nconfirm = \"require-human\"\nperson = { cli = \"terminal\", mcp = \"verified\" }\nexpose = { mcp = true, agent = false, cli = true }\nconfirm_preview = \"mem-preview\"",
        )
        + "\n[[commands]]\nname = \"mem-preview\"\ndescription = \"Show what a confirmation does.\"\neffects = [\"inspect\"]\ninput_schema = { type = \"object\", properties = { space = { type = \"string\" } }, additionalProperties = false }\nexpose = { mcp = false, agent = false, cli = true }\njournal = { mode = \"digest\", keep = [\"space\"] }\nreturns = { type = \"object\", properties = { preview = { type = \"string\" } }, required = [\"preview\"], additionalProperties = false }\n";
    assert!(gated.contains("mcp = \"verified\""));
    let (listener, bind) = support::local::bound();
    let text = config("", "on_behalf_of = \"ada\"").replacen(
        "config_version = 4",
        "config_version = 7",
        1,
    ) + &format!("\n[person.local]\nenabled = true\nbind = \"{bind}\"\n");
    let dir = support::workspace(&text);
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .with_compiled(umbel::plugins::sdk(MemoryProbe::with_manifest(gated)))
        .seal()
        .unwrap();
    let page = support::local::serve(&host, listener);
    let remembered = support::call(
        &host,
        afd::Actor::new(afd::ActorKind::Human).with_id("ada"),
        "mem-remember",
        json!({ "space": "main", "args": {} }),
    )
    .await;
    let id = remembered.data.unwrap()["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let call = || async {
        let mut stdio = Stdio::connect(&host).await;
        command_result(
            &stdio
                .request(
                    "tools/call",
                    json!({ "name": "mem-confirm", "arguments": { "space": "main", "args": { "id": id }, "confirm": true } }),
                )
                .await,
        )
    };
    let decision = decision_of(&call().await);
    let shown = page
        .get(&format!("/d/{decision}"), &[("sec-fetch-site", "none")])
        .await;
    assert_eq!(shown.status, 200, "{}", shown.text);
    let csrf = hidden(&shown.text, "csrf");
    let posted = page
        .send(page.request(
            "POST",
            &format!("/d/{decision}"),
            &[
                ("content-type", FORM),
                ("origin", &format!("http://{bind}")),
            ],
            format!("csrf={csrf}&page=1&decision=approve"),
        ))
        .await;
    assert_eq!(posted.status, 200, "{}", posted.text);
    let outcome = call().await;
    assert_eq!(outcome["success"], false, "{outcome}");
    assert!(
        outcome.to_string().contains("level local"),
        "the refusal names local: {outcome}"
    );
    let shown = support::call(
        &host,
        afd::Actor::new(afd::ActorKind::Human).with_id("ada"),
        "mem-read",
        json!({ "space": "main", "args": { "op": "show", "id": id } }),
    )
    .await;
    assert_eq!(
        shown.data.unwrap()["result"]["confirmation"],
        false,
        "nothing was confirmed"
    );
}
