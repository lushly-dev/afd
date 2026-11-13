//! The person page (phase 5 specification, sections 7.1 to 7.5; step 5), end to end with the test
//! identity provider: the MCP relay, the OpenID Connect relying party, every refusal of section
//! 7.2, the decision's binding and single use across two hosts, the CLI's URL flow, the page's
//! headers, escaping and CSRF defences, and what the page never shows.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::hosted::Client;
use support::oauth::Setup;
use support::person::{
    ORIGIN, PREVIEW_CANARY, Page, REST, accepted, asked, authorize, call, decide, decide_as, login,
    open, result,
};
use umbel_testkit_idp::ScriptedLogin;

fn approve_input() -> Value {
    json!({ "proposal": "p-1" })
}

/// Begin a decision for `gate-approve` as `subject`'s client and answer the prompt.
async fn begin(page: &Page, token: &str, input: Value) -> support::person::Asked {
    asked(&call(&page.client, token, "gate-approve", input, json!({}), true).await)
}

/// What a decided-on retry answers.
async fn retry(_page: &Page, client: &Client, token: &str, input: Value, state: &str) -> Value {
    call(client, token, "gate-approve", input, accepted(state), true).await
}

// ── The successful flow ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_verified_decision_runs_the_call_once_with_human_present() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    // The URL holds no identity: the public URL, `/d/` and the decision id.
    assert!(
        prompt.url.starts_with("https://127.0.0.1/mcp/d/"),
        "{}",
        prompt.url
    );
    assert_eq!(prompt.id().len(), 26);
    // The message carries only ids (7.4): the command, the id its preview reads (step 6) and the
    // space.
    assert_eq!(
        prompt.message,
        "Open the link to review gate-approve (proposal p-1) in main"
    );
    assert_eq!(page.seen.runs("gate-approve"), 0);

    // Retried while pending: asked again, the same URL, a fresh state.
    let again = asked(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(again.url, prompt.url);
    assert_eq!(again.elicitation_id, prompt.elicitation_id);
    assert_ne!(again.state, prompt.state);

    let decided = decide_as(&page, &page.client, &prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    assert!(decided.text.contains("You approved"), "{}", decided.text);

    let ran = result(&retry(&page, &page.client, &ada, approve_input(), &again.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    let runs = page.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    let principal = &runs[0]["principal"];
    assert_eq!(
        principal["humanPresent"]["level"], "verified",
        "{principal}"
    );
    assert_eq!(principal["humanPresent"]["method"], "person-page");
    assert_eq!(principal["humanPresent"]["acr"], "phr");
    assert!(principal["humanPresent"]["authTime"].is_string());
    // The principal still validates as version 1.
    let validator = support::schema_validator("principal.v1");
    assert!(validator.is_valid(principal), "{principal}");
    let mark = &runs[0]["mark"];
    assert_eq!(mark["id"], json!(prompt.id()));
    assert_eq!(mark["surface"], "mcp");
    assert_eq!(mark["namespace"], "corp");

    // Replaying the retry runs nothing: the decision is spent; the relay begins again.
    let replay = retry(&page, &page.client, &ada, approve_input(), &again.state).await;
    let fresh = asked(&replay);
    assert_ne!(fresh.url, prompt.url);
    assert_eq!(page.seen.runs("gate-approve"), 1);

    // The decision is journaled as a host `person-decide` entry, keeping id, level and decision.
    let journal = std::fs::read_to_string(page.dir.path().join("state/journal.jsonl")).unwrap();
    let entry: Value = journal
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|entry| entry["command"] == "person-decide")
        .expect("a person-decide entry");
    assert_eq!(
        entry["input"],
        json!({ "id": prompt.id(), "level": "verified", "decision": "approved" })
    );
}

#[tokio::test]
async fn a_declined_decision_runs_nothing() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    let declined = decide_as(&page, &page.client, &prompt.path(), "ada", "decline").await;
    assert_eq!(declined.status, 200, "{}", declined.text);
    let answer = result(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(answer["error"]["code"], "CONFIRMATION_DECLINED", "{answer}");
    assert_eq!(answer["error"]["retryable"], json!(false));
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

// ── The relay ──────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_relay_needs_url_elicitation_and_takes_no_acknowledgement_or_form() {
    let page = Page::start().await;
    let ada = page.token("ada");
    // A client without URL-mode elicitation: APPROVAL_REQUIRED, url-elicitation-required.
    let refused = result(
        &call(
            &page.client,
            &ada,
            "gate-approve",
            approve_input(),
            json!({}),
            false,
        )
        .await,
    );
    assert_eq!(refused["error"]["code"], "APPROVAL_REQUIRED", "{refused}");
    assert_eq!(
        refused["error"]["details"]["reason"],
        "url-elicitation-required"
    );
    // `confirm: true` is input like any other: refused by the schema, never an acknowledgement.
    let acknowledged = call(
        &page.client,
        &ada,
        "gate-approve",
        json!({ "proposal": "p-1", "confirm": true }),
        json!({}),
        true,
    )
    .await;
    assert_eq!(
        result(&acknowledged)["error"]["code"],
        "VALIDATION_ERROR",
        "{acknowledged}"
    );
    // A form answer is no answer: asked again.
    let prompt = begin(&page, &ada, approve_input()).await;
    let form = call(
        &page.client,
        &ada,
        "gate-approve",
        approve_input(),
        json!({
            "inputResponses": { "relay": { "action": "accept", "content": { "confirm": true } } },
            "requestState": "forged",
        }),
        true,
    )
    .await;
    asked(&form);
    let _ = prompt;
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn a_decision_is_bound_to_its_command_input_and_principal() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    let decided = decide_as(&page, &page.client, &prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    // Another input: the state does not open; asked again, nothing runs.
    let other_input = retry(
        &page,
        &page.client,
        &ada,
        json!({ "proposal": "p-2" }),
        &prompt.state,
    )
    .await;
    asked(&other_input);
    // Another command: the state names gate-approve.
    let other_command = call(
        &page.client,
        &ada,
        "gate-reject",
        approve_input(),
        accepted(&prompt.state),
        true,
    )
    .await;
    asked(&other_command);
    // Another person: bo presenting ada's state.
    let bo = page.token("bo");
    asked(&retry(&page, &page.client, &bo, approve_input(), &prompt.state).await);
    // Another client of ada's.
    let other_client = page.token_of("ada", "other-client");
    asked(
        &retry(
            &page,
            &page.client,
            &other_client,
            approve_input(),
            &prompt.state,
        )
        .await,
    );
    // ada's token without the page: a fresh begin is never approved.
    let without = begin(&page, &ada, json!({ "proposal": "p-3" })).await;
    asked(
        &retry(
            &page,
            &page.client,
            &ada,
            json!({ "proposal": "p-3" }),
            &without.state,
        )
        .await,
    );
    assert_eq!(page.seen.runs("gate-approve"), 0);
    // The right caller, command and input run it once.
    let ran = result(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    assert_eq!(page.seen.runs("gate-approve"), 1);
}

#[tokio::test]
async fn a_decision_runs_once_across_two_hosts() {
    let page = Page::start().await;
    let (_second, _served, other) = page.second().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    // Decided on the second host's page, run through the first host, replayed on the second.
    let decided = decide_as(&page, &other, &prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    let ran = result(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    let replayed = retry(&page, &other, &ada, approve_input(), &prompt.state).await;
    asked(&replayed);
    assert_eq!(page.seen.runs("gate-approve"), 1);
}

#[tokio::test]
async fn an_expired_decision_is_asked_again_and_cannot_be_decided() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    page.clock.advance(601_000);
    page.host.check_person_logins().await;
    // The page no longer opens it.
    let gone = page.client.get(&prompt.path(), &[]).await;
    assert_eq!(gone.status, 404, "{}", gone.text);
    // The relay asks again with a new decision.
    let again = asked(
        &retry(
            &page,
            &page.client,
            &page.token("ada"),
            approve_input(),
            &prompt.state,
        )
        .await,
    );
    assert_ne!(again.url, prompt.url);
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn an_approved_decision_past_its_expiry_does_not_run() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    let decided = decide_as(&page, &page.client, &prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    page.clock.advance(601_000);
    page.host.check_person_logins().await;
    let late = retry(
        &page,
        &page.client,
        &page.token("ada"),
        approve_input(),
        &prompt.state,
    )
    .await;
    asked(&late);
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

// ── The login's refusals ───────────────────────────────────────────────────────────────────────

/// Log in with `script` on a fresh decision and answer the page the return showed and whether
/// the decision is still pending.
async fn refused_login(page: &Page, script: ScriptedLogin) -> support::hosted::Reply {
    let ada = page.token("ada");
    let prompt = begin(page, &ada, approve_input()).await;
    page.script(script);
    let logged = login(page, &page.client, &prompt.path()).await;
    assert!(logged.form.is_none(), "{}", logged.page.text);
    // Nothing was recorded: the retry is asked again, and nothing ran.
    asked(&retry(page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(page.seen.runs("gate-approve"), 0);
    logged.page
}

#[tokio::test]
async fn another_person_is_refused() {
    let page = Page::start().await;
    let shown = refused_login(&page, ScriptedLogin::user("bo")).await;
    assert_eq!(shown.status, 403);
    assert!(
        shown.text.contains("This request is for another person"),
        "{}",
        shown.text
    );
    // Nothing of the request is shown to them.
    assert!(
        !shown.text.contains("gate-approve") && !shown.text.contains("p-1"),
        "{}",
        shown.text
    );
}

#[tokio::test]
async fn a_login_without_user_verification_is_insufficient() {
    let page = Page::start().await;
    for script in [
        ScriptedLogin::user("ada").acr(None),
        ScriptedLogin::user("ada").acr(Some("phrh")),
        ScriptedLogin::user("ada").amr(Vec::<String>::new()),
        ScriptedLogin::user("ada").amr(["pwd"]),
        ScriptedLogin::user("ada").amr(["pwd", "otp"]),
    ] {
        let shown = refused_login(&page, script).await;
        assert_eq!(shown.status, 403);
        assert!(
            shown.text.contains("PERSON_VERIFICATION_INSUFFICIENT"),
            "{}",
            shown.text
        );
    }
}

/// Log in with `script`, approve, and assert that the call then ran once.
async fn approved_login(page: &Page, script: ScriptedLogin) {
    let ada = page.token("ada");
    let prompt = begin(page, &ada, approve_input()).await;
    let before = page.seen.runs("gate-approve");
    page.script(script);
    let logged = login(page, &page.client, &prompt.path()).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let (login_id, csrf) = logged.form.clone().unwrap();
    let decided = decide(
        &page.client,
        &prompt.id(),
        &format!("login={login_id}&csrf={csrf}&decision=approve"),
        Some(&logged.opened.cookie_header()),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    assert!(decided.text.contains("You approved"), "{}", decided.text);
    let ran = result(&retry(page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
    assert_eq!(page.seen.runs("gate-approve"), before + 1);
}

#[tokio::test]
async fn a_passkey_login_is_user_verification_where_configured() {
    // D181: mfa under a phishing-resistant class, as a passkey login with user verification
    // reports it, with the key's kind or without it.
    let page =
        Page::start_verified_by("acr_values = [\"phr\", \"phrh\"], uv_amr = [\"pin\", \"mfa\"]")
            .await;
    for script in [
        ScriptedLogin::user("ada").amr(["mfa", "hwk"]),
        ScriptedLogin::user("ada").amr(["mfa", "swk"]),
        ScriptedLogin::user("ada").acr(Some("phrh")).amr(["mfa"]),
        ScriptedLogin::user("ada"),
    ] {
        approved_login(&page, script).await;
    }
    // Possession alone, or an unlisted class, is still not enough (on a fresh page, since a
    // refusal is checked as nothing having run). The configuration cannot list a phishable class
    // beside mfa, so the return's own rule (mfa only under phr or phrh) is unit-tested in
    // src/person/oidc.rs.
    let page =
        Page::start_verified_by("acr_values = [\"phr\", \"phrh\"], uv_amr = [\"pin\", \"mfa\"]")
            .await;
    for script in [
        ScriptedLogin::user("ada").amr(["hwk"]),
        ScriptedLogin::user("ada").amr(["swk", "pwd"]),
        ScriptedLogin::user("ada")
            .acr(Some("mfa"))
            .amr(["mfa", "hwk"]),
    ] {
        let shown = refused_login(&page, script).await;
        assert_eq!(shown.status, 403);
        assert!(
            shown.text.contains("PERSON_VERIFICATION_INSUFFICIENT"),
            "{}",
            shown.text
        );
    }
}

#[tokio::test]
async fn mfa_is_not_user_verification_where_not_configured() {
    let page = Page::start().await;
    for script in [
        ScriptedLogin::user("ada").amr(["mfa", "hwk"]),
        ScriptedLogin::user("ada").amr(["mfa", "swk"]),
    ] {
        let shown = refused_login(&page, script).await;
        assert_eq!(shown.status, 403);
        assert!(
            shown.text.contains("PERSON_VERIFICATION_INSUFFICIENT"),
            "{}",
            shown.text
        );
    }
}

#[tokio::test]
async fn a_stale_or_reused_login_is_refused() {
    let page = Page::start().await;
    // Older than max_age_s (300).
    let stale = refused_login(
        &page,
        ScriptedLogin::user("ada").auth_time(page.now_s() - 400),
    )
    .await;
    assert_eq!(stale.status, 400);
    // A session from before this login began, though within max_age: prompt=login was ignored.
    let reused = refused_login(
        &page,
        ScriptedLogin::user("ada").auth_time(page.now_s() - 200),
    )
    .await;
    assert_eq!(reused.status, 400);
}

#[tokio::test]
async fn a_wrong_or_missing_nonce_is_refused() {
    let page = Page::start().await;
    let wrong = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(|token| token.nonce("not-the-logins")),
    )
    .await;
    assert_eq!(wrong.status, 400);
    let missing = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(|token| token.without_claim("nonce")),
    )
    .await;
    assert_eq!(missing.status, 400);
}

#[tokio::test]
async fn an_id_token_for_another_client_or_issuer_is_refused() {
    let page = Page::start().await;
    let audience = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(|token| token.audience("someone-else")),
    )
    .await;
    assert_eq!(audience.status, 400);
    let two = refused_login(
        &page,
        ScriptedLogin::user("ada")
            .adjust_token(|token| token.audiences(["umbel-person-page", "someone-else"])),
    )
    .await;
    assert_eq!(two.status, 400);
    let issuer = refused_login(
        &page,
        ScriptedLogin::user("ada")
            .adjust_token(|token| token.claim("iss", json!("https://evil.example"))),
    )
    .await;
    assert_eq!(issuer.status, 400);
    let expired = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(|token| token.issued_at(0).lifetime(60)),
    )
    .await;
    assert_eq!(expired.status, 400);
    let typ = refused_login(
        &page,
        ScriptedLogin::user("ada")
            .adjust_token(|token| token.header_member("typ", json!("at+jwt"))),
    )
    .await;
    assert_eq!(typ.status, 400);
    let azp = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(|token| token.claim("azp", json!("someone-else"))),
    )
    .await;
    assert_eq!(azp.status, 400);
    let future = page.now_s() + 3_600;
    let iat = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(move |token| token.claim("iat", json!(future))),
    )
    .await;
    assert_eq!(iat.status, 400);
    let nbf = refused_login(
        &page,
        ScriptedLogin::user("ada").adjust_token(move |token| token.claim("nbf", json!(future))),
    )
    .await;
    assert_eq!(nbf.status, 400);
    let unsigned = refused_login(
        &page,
        ScriptedLogin::user("ada")
            .adjust_token(|token| token.break_rule(umbel_testkit_idp::Break::Signature)),
    )
    .await;
    assert_eq!(unsigned.status, 400);
}

#[tokio::test]
async fn a_replayed_or_forged_state_or_a_missing_cookie_is_refused() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    page.script(ScriptedLogin::user("ada"));
    let opened = open(&page.client, &prompt.path()).await;
    let back = authorize(&page.kit, &opened.location).await;
    let cookie = opened.cookie_header();
    // No cookie, or another browser's: refused, and the login is not spent by it.
    let without = page.client.get(&back, &[]).await;
    assert_eq!(without.status, 400, "{}", without.text);
    let wrong = format!("{}=not-the-browsers", opened.cookie.0);
    let other = page.client.get(&back, &[("cookie", wrong.as_str())]).await;
    assert_eq!(other.status, 400, "{}", other.text);
    let fine = page.client.get(&back, &[("cookie", cookie.as_str())]).await;
    assert_eq!(fine.status, 200, "{}", fine.text);
    // Replayed once used: nothing.
    let replayed = page.client.get(&back, &[("cookie", cookie.as_str())]).await;
    assert_eq!(replayed.status, 400, "{}", replayed.text);

    // A state whose MAC is altered.
    page.script(ScriptedLogin::user("ada"));
    let opened = open(&page.client, &prompt.path()).await;
    let back = authorize(&page.kit, &opened.location).await;
    let state = opened.state();
    let forged = back.replace(&state, &format!("{}x", &state[..state.len() - 1]));
    let refused = page
        .client
        .get(&forged, &[("cookie", opened.cookie_header().as_str())])
        .await;
    assert_eq!(refused.status, 400);

    // The real return completes; replaying it afterwards finds nothing.
    let fine = page
        .client
        .get(&back, &[("cookie", opened.cookie_header().as_str())])
        .await;
    assert_eq!(fine.status, 200, "{}", fine.text);
    let again = page
        .client
        .get(&back, &[("cookie", opened.cookie_header().as_str())])
        .await;
    assert_eq!(again.status, 400);
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn a_code_from_another_login_fails_its_pkce() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    // Two logins; the first one's code is presented with the second one's state and cookie.
    page.script(ScriptedLogin::user("ada"));
    let first = open(&page.client, &prompt.path()).await;
    let first_back = authorize(&page.kit, &first.location).await;
    page.script(ScriptedLogin::user("ada"));
    let second = open(&page.client, &prompt.path()).await;
    let second_back = authorize(&page.kit, &second.location).await;
    let code = support::person::query_value(&first_back, "code").unwrap();
    let injected = second_back.replace(
        &support::person::query_value(&second_back, "code").unwrap(),
        &code,
    );
    let refused = page
        .client
        .get(&injected, &[("cookie", second.cookie_header().as_str())])
        .await;
    assert_eq!(refused.status, 400, "{}", refused.text);
    assert!(support::person::form(&refused.text).is_none());
}

#[tokio::test]
async fn the_authorization_request_is_exactly_section_7_2s() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    page.script(ScriptedLogin::user("ada"));
    let opened = open(&page.client, &prompt.path()).await;
    let _ = authorize(&page.kit, &opened.location).await;
    let request = page
        .kit
        .identity_provider()
        .authorization_requests()
        .pop()
        .unwrap();
    let get = |name: &str| {
        request
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    assert_eq!(get("response_type").as_deref(), Some("code"));
    assert_eq!(get("client_id").as_deref(), Some("umbel-person-page"));
    assert_eq!(
        get("redirect_uri").as_deref(),
        Some(support::person::REDIRECT)
    );
    assert_eq!(get("scope").as_deref(), Some("openid"));
    assert_eq!(get("code_challenge_method").as_deref(), Some("S256"));
    assert_eq!(get("code_challenge").unwrap().len(), 43);
    assert_eq!(get("prompt").as_deref(), Some("login"));
    assert_eq!(get("max_age").as_deref(), Some("300"));
    assert_eq!(get("acr_values").as_deref(), Some("phr"));
    assert_eq!(get("response_mode").as_deref(), Some("query"));
    assert!(get("nonce").unwrap().len() >= 43);
    let claims: Value = serde_json::from_str(&get("claims").unwrap()).unwrap();
    assert_eq!(
        claims["id_token"]["acr"],
        json!({ "essential": true, "values": ["phr"] })
    );
    // The state is the login id and its MAC; neither names the decision or anyone.
    let state = get("state").unwrap();
    assert!(!state.contains(&prompt.id()), "{state}");
    // The cookie is a `__Host-` cookie with every flag.
    let set_cookie = opened.reply.headers["set-cookie"].to_str().unwrap();
    assert!(
        set_cookie.starts_with("__Host-umbel-person-"),
        "{set_cookie}"
    );
    for flag in ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"] {
        assert!(set_cookie.contains(flag), "{set_cookie}");
    }
    assert!(!set_cookie.contains("Domain"), "{set_cookie}");
}

#[tokio::test]
async fn a_response_from_another_issuer_is_refused() {
    let page = Page::start().await;
    page.kit
        .identity_provider()
        .set_response_iss(umbel_testkit_idp::ResponseIss::Value(
            "https://evil.example".into(),
        ));
    let shown = refused_login(&page, ScriptedLogin::user("ada")).await;
    assert_eq!(shown.status, 400);
    // The provider advertises RFC 9207, so a response without `iss` is refused too.
    page.kit
        .identity_provider()
        .set_response_iss(umbel_testkit_idp::ResponseIss::Omitted);
    let shown = refused_login(&page, ScriptedLogin::user("ada")).await;
    assert_eq!(shown.status, 400);
}

// ── The page itself ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn every_page_is_unframed_uncached_and_escaped() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, json!({ "proposal": "xss" })).await;
    page.script(ScriptedLogin::user("ada"));
    let logged = login(&page, &page.client, &prompt.path()).await;
    let shown = &logged.page;
    assert_eq!(shown.status, 200, "{}", shown.text);
    for (name, value) in [
        (
            "content-security-policy",
            "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
    ] {
        assert_eq!(shown.headers[name].to_str().unwrap(), value, "{name}");
    }
    // The redirect to the provider too: no referrer leaks the decision's URL to it.
    assert_eq!(logged.opened.reply.headers["cache-control"], "no-store");
    assert_eq!(
        logged.opened.reply.headers["referrer-policy"],
        "no-referrer"
    );
    // The preview is escaped, and the page runs no script.
    assert!(!shown.text.contains("<script>"), "{}", shown.text);
    assert!(!shown.text.contains("<img"), "{}", shown.text);
    assert!(
        shown.text.contains("&lt;script&gt;alert(1)&lt;/script&gt;"),
        "{}",
        shown.text
    );
    assert!(
        shown
            .text
            .contains("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;"),
        "{}",
        shown.text
    );
    assert!(!shown.text.to_ascii_lowercase().contains("<script"));
    // Who asked: the actor and the client.
    assert!(shown.text.contains("corp/test-client"), "{}", shown.text);
    assert!(shown.text.contains("test-client"), "{}", shown.text);
    // Another host name is refused.
    let wrong = page
        .client
        .clone()
        .with_host("evil.example")
        .get(&prompt.path(), &[])
        .await;
    assert_eq!(wrong.status, 421);
}

#[tokio::test]
async fn a_decision_needs_its_origin_csrf_token_cookie_and_login() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    page.script(ScriptedLogin::user("ada"));
    let logged = login(&page, &page.client, &prompt.path()).await;
    let (login_id, csrf) = logged.form.clone().unwrap();
    let cookie = logged.opened.cookie_header();
    let id = prompt.id();
    let fields = |csrf: &str| format!("login={login_id}&csrf={csrf}&decision=approve");
    // Each one missing or wrong: nothing recorded.
    for (fields, cookie, origin) in [
        (fields(&csrf), Some(cookie.as_str()), None),
        (
            fields(&csrf),
            Some(cookie.as_str()),
            Some("https://evil.example"),
        ),
        (fields(&csrf), Some(cookie.as_str()), Some("null")),
        (fields("forged"), Some(cookie.as_str()), Some(ORIGIN)),
        (
            format!("login={login_id}&decision=approve"),
            Some(cookie.as_str()),
            Some(ORIGIN),
        ),
        (fields(&csrf), None, Some(ORIGIN)),
        (fields(&csrf), Some("__Host-umbel-person-x=y"), Some(ORIGIN)),
        (
            format!("{}&decision=decline", fields(&csrf)),
            Some(cookie.as_str()),
            Some(ORIGIN),
        ),
        (
            format!("{}&extra=1", fields(&csrf)),
            Some(cookie.as_str()),
            Some(ORIGIN),
        ),
    ] {
        let refused = decide(&page.client, &id, &fields, cookie, origin).await;
        assert_eq!(refused.status, 403, "{fields} {origin:?}: {}", refused.text);
    }
    asked(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    // A same-origin post under the page's no-referrer policy: `Origin: null` with the browser's
    // `Sec-Fetch-Site: same-origin`.
    let fine = page
        .client
        .send(page.client.request(
            "POST",
            &format!("/mcp/d/{id}"),
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("cookie", cookie.as_str()),
                ("origin", "null"),
                ("sec-fetch-site", "same-origin"),
            ],
            fields(&csrf),
        ))
        .await;
    assert_eq!(fine.status, 200, "{}", fine.text);
    // Spent: deciding again with the same login is refused.
    let again = decide(
        &page.client,
        &id,
        &fields(&csrf),
        Some(&cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(again.status, 403);
    let ran = result(&retry(&page, &page.client, &ada, approve_input(), &prompt.state).await);
    assert_eq!(ran["success"], json!(true), "{ran}");
}

#[tokio::test]
async fn the_page_never_shows_or_keeps_what_it_must_not() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(
        &page,
        &ada,
        json!({ "proposal": "canary", "reason": "reason-canary-7a" }),
    )
    .await;
    // Before a login, the link shows nothing: a redirect, with no body of the request.
    let opened = open(&page.client, &prompt.path()).await;
    assert!(!opened.reply.text.contains("gate-approve"));
    // The message names no content.
    // The message names the id the preview reads (step 6), never the preview's text nor an input
    // the preview does not read.
    assert_eq!(
        prompt.message,
        "Open the link to review gate-approve (proposal canary) in main"
    );
    assert!(!prompt.message.contains(PREVIEW_CANARY) && !prompt.message.contains("reason"));
    // An unknown id is the same answer as an expired one.
    let unknown = page
        .client
        .get("/mcp/d/aaaaaaaaaaaaaaaaaaaaaaaaaa", &[])
        .await;
    assert_eq!(unknown.status, 404);
    // The person sees the preview, rendered at page time as themself.
    page.script(ScriptedLogin::user("ada"));
    let logged = login(&page, &page.client, &prompt.path()).await;
    assert!(
        logged.page.text.contains(PREVIEW_CANARY),
        "{}",
        logged.page.text
    );
    let preview_call = page.seen.of("gate-preview").pop().unwrap();
    // Only the preview's declared properties reached it, never `reason`.
    assert_eq!(preview_call["input"], json!({ "proposal": "canary" }));
    assert_eq!(
        preview_call["principal"]["actor"],
        json!({ "kind": "human", "id": "corp/ada" })
    );
    // A failing preview leaves only Decline.
    let failing = begin(&page, &ada, json!({ "proposal": "fail" })).await;
    page.script(ScriptedLogin::user("ada"));
    let logged = login(&page, &page.client, &failing.path()).await;
    assert_eq!(logged.page.status, 200);
    assert!(
        !logged.page.text.contains("value=\"approve\""),
        "{}",
        logged.page.text
    );
    let (login_id, csrf) = logged.form.unwrap();
    let approve = decide(
        &page.client,
        &failing.id(),
        &format!("login={login_id}&csrf={csrf}&decision=approve"),
        Some(&logged.opened.cookie_header()),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(approve.status, 403);
    // Nothing of the preview, nor the input's text, is in any file of the workspace.
    for entry in walk(page.dir.path()) {
        let bytes = std::fs::read(&entry).unwrap();
        for canary in [PREVIEW_CANARY, "reason-canary-7a"] {
            assert!(
                !bytes
                    .windows(canary.len())
                    .any(|window| window == canary.as_bytes()),
                "{canary} in {}",
                entry.display()
            );
        }
    }
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(walk(&path));
        } else {
            found.push(path);
        }
    }
    found
}

// ── Serving and limits ─────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn verified_commands_are_served_only_where_a_login_passes() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let discover = |client: &Client| {
        let client = client.clone();
        let ada = ada.clone();
        async move {
            call(
                &client,
                &ada,
                "afd-discover",
                json!({ "search": "gate" }),
                json!({}),
                true,
            )
            .await
            .to_string()
        }
    };
    let listed = discover(&page.client).await;
    assert!(listed.contains("gate-approve"), "{listed}");
    // The provider's metadata now fails auth.person: the class is not supported.
    page.kit
        .identity_provider()
        .set_metadata_patch(Some(json!({ "acr_values_supported": ["other"] })));
    let (second, _served, other) = {
        // A host started now checks the login at start and never serves the command.
        page.second().await
    };
    let listed = discover(&other).await;
    assert!(!listed.contains("gate-approve"), "{listed}");
    assert!(!listed.contains("gate-reject"), "{listed}");
    // Calling it is a name that does not exist, and nothing runs.
    let unknown = result(
        &call(
            &other,
            &ada,
            "gate-approve",
            approve_input(),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(unknown["error"]["code"], "COMMAND_NOT_FOUND", "{unknown}");
    drop(second);
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn a_verified_command_is_off_mcp_in_mode_none() {
    let seen = support::person::Seen::default();
    let dir = support::workspace(&format!(
        "config_version = 5\ndefault_space = \"main\"\n[spaces.main]\n{REST}"
    ));
    let host = support::plugins::seal(dir.path(), |builder| {
        builder.with_compiled(support::person::plugin(&seen))
    })
    .unwrap();
    let definition = host.registry().get("gate-approve").unwrap();
    assert!(!definition.expose.mcp);
    assert!(definition.confirmation_mode.is_some());
}

#[tokio::test]
async fn person_pages_per_hour_limits_begins() {
    let page = Page::start_with(Setup {
        rest: REST,
        auth: "",
        http: "",
        ..Setup::default()
    })
    .await;
    let _ = page;
    // The default limit (30) is exercised in a lowered configuration below.
    let limited = Page::start_with(Setup {
        rest: "[limits]\nperson_pages_per_hour = 2\n[spaces.other]\n\n[plugins]\nenabled = [\"gate\"]\n",
        ..Setup::default()
    })
    .await;
    let ada = limited.token("ada");
    for proposal in ["p-1", "p-2"] {
        begin(&limited, &ada, json!({ "proposal": proposal })).await;
    }
    let third = result(
        &call(
            &limited.client,
            &ada,
            "gate-approve",
            approve_input(),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(third["error"]["code"], "RATE_LIMITED", "{third}");
    assert_eq!(third["error"]["retryable"], json!(true));
}

// ── The CLI ────────────────────────────────────────────────────────────────────────────────────

/// A console that records what it showed.
#[derive(Default)]
struct Shown(std::sync::Mutex<Vec<String>>);

impl umbel::cli::Console for Shown {
    fn is_interactive(&self) -> bool {
        false
    }
    fn ask(&self, _: &str) -> bool {
        false
    }
    fn show(&self, text: &str) {
        self.0.lock().unwrap().push(text.to_owned());
    }
}

/// Run the CLI and the browser together; a CLI that ends before the browser is done failed.
async fn alongside(
    cli: impl std::future::Future<Output = support::Run>,
    browser: impl std::future::Future<Output = ()>,
) -> support::Run {
    tokio::pin!(cli);
    tokio::select! {
        run = &mut cli => panic!("the CLI ended before the person decided: {}", run.stdout),
        () = browser => cli.await,
    }
}

/// The link the CLI showed, within ten seconds.
async fn wait_for_url(console: &Shown) -> String {
    for _ in 0..200 {
        if let Some(url) = console.url() {
            return url;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("the CLI showed no link: {:?}", console.0.lock().unwrap());
}

impl Shown {
    fn url(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find_map(|text| text.lines().find(|line| line.starts_with("https://")))
            .map(str::to_owned)
    }
}

#[tokio::test]
async fn the_cli_prints_the_link_and_runs_once_the_person_approves() {
    let page = Page::start().await;
    let console = std::sync::Arc::new(Shown::default());
    let cli = {
        let dir = page.dir.path().to_path_buf();
        let console: std::sync::Arc<dyn umbel::cli::Console> = console.clone();
        let kit_ca = page.kit.ca().certificate_pem().to_owned();
        let seen = page.seen.clone();
        async move {
            support::cli_with(
                &dir,
                &["call", "gate-approve", "proposal=p-cli"],
                console,
                move |builder| {
                    builder
                        .with_compiled(support::person::plugin(&seen))
                        .register(support::oauth::whoami())
                        .register(support::oauth::touch())
                        .with_auth_root_certificate(kit_ca.into_bytes())
                        .with_auth_secret("UMBEL_TEST_PERSON_SECRET", support::person::SECRET)
                },
            )
            .await
        }
    };
    let browser = async {
        let url = wait_for_url(&console).await;
        let path = url.strip_prefix("https://127.0.0.1").unwrap().to_owned();
        // bo cannot decide the operator's request.
        page.script(ScriptedLogin::user("bo"));
        let wrong = login(&page, &page.client, &path).await;
        assert_eq!(wrong.page.status, 403);
        let decided = decide_as(&page, &page.client, &path, "ada", "approve").await;
        assert_eq!(decided.status, 200, "{}", decided.text);
    };
    let finished = alongside(cli, browser).await;
    let answer = finished.json();
    assert_eq!(answer["success"], json!(true), "{answer}");
    let runs = page.seen.of("gate-approve");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["principal"]["humanPresent"]["level"], "verified");
    assert_eq!(runs[0]["mark"]["surface"], "cli");
    assert_eq!(runs[0]["principal"]["transport"], "cli");
    // The host's check before begin ran as the operator at the command line (step 6): the CLI's
    // interface and principal, under the call's own trace, naming the CLI surface.
    let checks: Vec<Value> = page
        .seen
        .of("gate-preview")
        .into_iter()
        .filter(|call| !call["check"].is_null())
        .collect();
    assert_eq!(checks.len(), 1, "{checks:?}");
    assert_eq!(checks[0]["interface"], "Some(Cli)");
    assert_eq!(checks[0]["check"]["surface"], "cli");
    assert_eq!(checks[0]["principal"]["transport"], "cli");
    assert_eq!(checks[0]["principal"]["authentication"], "process");
}

#[tokio::test]
async fn the_cli_reports_a_decline_and_an_expiry() {
    let page = Page::start().await;
    let cli = |console: std::sync::Arc<Shown>| {
        let dir = page.dir.path().to_path_buf();
        let kit_ca = page.kit.ca().certificate_pem().to_owned();
        let seen = page.seen.clone();
        let clock = page.clock.clone();
        let console: std::sync::Arc<dyn umbel::cli::Console> = console;
        async move {
            support::cli_with(
                &dir,
                &["call", "gate-approve", "proposal=p-cli"],
                console,
                move |builder| {
                    builder
                        .with_compiled(support::person::plugin(&seen))
                        .register(support::oauth::whoami())
                        .register(support::oauth::touch())
                        .with_auth_root_certificate(kit_ca.into_bytes())
                        .with_auth_secret("UMBEL_TEST_PERSON_SECRET", support::person::SECRET)
                        .with_auth_clock(clock)
                },
            )
            .await
        }
    };
    let console = std::sync::Arc::new(Shown::default());
    let browser = async {
        let url = wait_for_url(&console).await;
        let path = url.strip_prefix("https://127.0.0.1").unwrap().to_owned();
        let declined = decide_as(&page, &page.client, &path, "ada", "decline").await;
        assert_eq!(declined.status, 200);
    };
    let run = alongside(cli(std::sync::Arc::clone(&console)), browser).await;
    let answer = run.json();
    assert_eq!(answer["error"]["code"], "CONFIRMATION_DECLINED", "{answer}");

    let console = std::sync::Arc::new(Shown::default());
    let expire = async {
        wait_for_url(&console).await;
        page.clock.advance(601_000);
    };
    let run = alongside(cli(std::sync::Arc::clone(&console)), expire).await;
    let answer = run.json();
    assert_eq!(
        answer["error"]["code"], "PERSON_DECISION_EXPIRED",
        "{answer}"
    );
    assert_eq!(answer["error"]["retryable"], json!(true));
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn the_cli_needs_a_hosted_workspace_and_a_namespaced_operator() {
    // Mode `none`: no person page is served, so nothing is asked.
    let seen = support::person::Seen::default();
    let dir = support::workspace(&format!(
        "config_version = 5\ndefault_space = \"main\"\n[spaces.main]\n{REST}"
    ));
    let console: std::sync::Arc<dyn umbel::cli::Console> = std::sync::Arc::new(Shown::default());
    let run = support::cli_with(
        dir.path(),
        &["call", "gate-approve", "proposal=p"],
        console,
        |builder| builder.with_compiled(support::person::plugin(&seen)),
    )
    .await;
    assert_eq!(
        run.json()["error"]["code"],
        "PERSON_VERIFICATION_UNAVAILABLE",
        "{}",
        run.stdout
    );
    assert_eq!(seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn no_person_is_asked_about_a_space_the_caller_cannot_read() {
    let page = Page::start_with(Setup {
        rest: "[spaces.other]\nreaders = [\"human:corp/bo\"]\n\n[plugins]\nenabled = [\"gate\"]\n",
        ..Setup::default()
    })
    .await;
    let ada = page.token("ada");
    let refused = result(
        &call(
            &page.client,
            &ada,
            "gate-approve",
            json!({ "proposal": "p-1", "space": "other" }),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(refused["error"]["code"], "SPACE_NOT_READABLE", "{refused}");
    // The same answer as a space nobody declared, and no decision was begun.
    let undeclared = result(
        &call(
            &page.client,
            &ada,
            "gate-approve",
            json!({ "proposal": "p-1", "space": "ghost" }),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(undeclared["error"], refused["error"]);
    assert!(!page.dir.path().join("state/shared/person.sqlite3").exists());
}

#[tokio::test]
async fn the_commands_own_preview_refuses_a_call_before_anyone_is_asked() {
    let page = Page::start().await;
    let ada = page.token("ada");
    // The plugin's preview, run as the caller before begin (step 6), refuses: its answer is the
    // call's, and no decision is begun.
    let refused = result(
        &call(
            &page.client,
            &ada,
            "gate-approve",
            json!({ "proposal": "refuse", "reason": "why" }),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(refused["error"]["code"], "GATE_REFUSED", "{refused}");
    assert_eq!(refused["error"]["retryable"], false, "{refused}");
    assert!(!page.dir.path().join("state/shared/person.sqlite3").exists());
    assert_eq!(page.seen.runs("gate-approve"), 0);
    // It ran once, as the caller, with only the preview's declared properties, as the host's
    // own in-process call (no interface), naming the command it checks; never with a decision.
    let checks = page.seen.of("gate-preview");
    assert_eq!(checks.len(), 1, "{checks:?}");
    let check = &checks[0];
    assert_eq!(check["input"], json!({ "proposal": "refuse" }));
    assert_eq!(check["interface"], "None");
    assert_eq!(
        check["check"],
        json!({ "command": "gate-approve", "preview": "gate-preview", "surface": "mcp" })
    );
    assert_eq!(check["mark"], Value::Null);
    assert_eq!(check["principal"]["actor"]["onBehalfOf"], "corp/ada");
    assert_eq!(check["principal"]["authentication"], "verified");
    // A preview that passes the check is asked as usual, and the page's own rendering, as the
    // person, carries no check.
    let prompt = begin(&page, &ada, approve_input()).await;
    page.script(ScriptedLogin::user("ada"));
    let logged = login(&page, &page.client, &prompt.path()).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let rendered = page.seen.of("gate-preview").pop().unwrap();
    assert_eq!(rendered["check"], Value::Null, "{rendered}");
    assert_eq!(rendered["principal"]["actor"]["kind"], "human");
}

#[tokio::test]
async fn a_login_older_than_max_age_is_refused_even_when_it_began_with_this_login() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    let started = page.now_s();
    let opened = open(&page.client, &prompt.path()).await;
    // The person took 400 seconds to come back; they authenticated 50 seconds after the login
    // began, which is after it began but older than max_age_s (300) when the token arrives.
    page.clock.advance(400_000);
    let now = page.now_s();
    page.script(
        ScriptedLogin::user("ada")
            .auth_time(started + 50)
            .adjust_token(move |token| {
                token
                    .claim("iat", json!(now - 5))
                    .claim("exp", json!(now + 300))
            }),
    );
    let back = authorize(&page.kit, &opened.location).await;
    let refused = page
        .client
        .get(&back, &[("cookie", opened.cookie_header().as_str())])
        .await;
    assert_eq!(refused.status, 400, "{}", refused.text);
    assert!(support::person::form(&refused.text).is_none());
    assert_eq!(page.seen.runs("gate-approve"), 0);
}

// ── What the review of step 5 added ────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_page_has_a_limit_of_its_own() {
    let page = Page::start().await;
    let ada = page.token("ada");
    let prompt = begin(&page, &ada, approve_input()).await;
    // A client that names no decision spends only its peer's budget.
    for _ in 0..30 {
        assert_eq!(page.client.get("/mcp/d/style.cs", &[]).await.status, 404);
    }
    let limited = page.client.get("/mcp/d/style.cs", &[]).await;
    assert_eq!(limited.status, 429, "{}", limited.text);
    assert!(limited.headers.contains_key("retry-after"));
    // A person's flow, from the same address, is counted per decision and per login: unaffected.
    let decided = decide_as(&page, &page.client, &prompt.path(), "ada", "approve").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    // One decision's own budget is bounded too.
    let other = begin(&page, &ada, json!({ "proposal": "p-9" })).await;
    let mut statuses = Vec::new();
    for _ in 0..31 {
        statuses.push(page.client.get(&other.path(), &[]).await.status);
    }
    assert_eq!(statuses.last(), Some(&429), "{statuses:?}");
    // The MCP endpoint keeps its own budget.
    let ran = result(
        &call(
            &page.client,
            &ada,
            "fixture-whoami",
            json!({}),
            json!({}),
            true,
        )
        .await,
    );
    assert_eq!(ran["success"], json!(true), "{ran}");
}

#[tokio::test]
async fn without_filtered_listings_no_verified_command_is_served() {
    let seen = support::person::Seen::default();
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let dir = support::workspace(&support::oauth::config(
        &kit,
        &Setup {
            auth: "filter_tools_by_scope = false",
            rest: REST,
            ..Setup::default()
        },
    ));
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::person::host(dir.path(), &kit, &clock, &seen);
    let definition = host.registry().get("gate-approve").unwrap();
    assert!(!definition.expose.mcp);
}

#[tokio::test]
async fn mode_gateway_serves_no_person_page() {
    let kit = umbel_testkit_idp::TestIdp::start().await.unwrap();
    let seen = support::person::Seen::default();
    let text = support::gateway::config(&kit, &support::gateway::Setup {
        rest: "[plugins]\nenabled = [\"gate\"]\n",
        ..support::gateway::Setup::default()
    })
    .replace(
        "[auth.namespaces.corp]\n",
        &format!(
            "[auth.namespaces.corp]\nperson = {{ issuer = \"idp\", client_id = \"umbel-person-page\", client_secret_env = \"UMBEL_TEST_PERSON_SECRET\", acr_values = [\"phr\"], uv_amr = [\"pin\"] }}\n\n[auth.issuers.idp]\nissuer = \"{}\"\nnamespace = \"corp\"\naccess_tokens = false\n",
            kit.identity_provider().issuer()
        ),
    );
    let dir = support::workspace(&text);
    support::gateway::write_keys(dir.path(), &kit);
    let clock = afd::fixed_clock(support::oauth::now_ms());
    let host = support::person::host(dir.path(), &kit, &clock, &seen);
    // Not registered for MCP: the gateway would stand between the person and the page.
    assert!(!host.registry().get("gate-approve").unwrap().expose.mcp);
    // The page's routes are not served.
    let served = support::hosted::Served::start(&host).await;
    let client = Client::plain(served.address);
    let reply = client.get("/mcp/d/aaaaaaaaaaaaaaaaaaaaaaaaaa", &[]).await;
    assert_eq!(reply.status, 404, "{}", reply.text);
    assert!(!reply.text.contains("<html"), "{}", reply.text);
    // The CLI's URL flow refuses: no page to send the person to.
    let console: std::sync::Arc<dyn umbel::cli::Console> = std::sync::Arc::new(Shown::default());
    let run = support::cli_with(
        dir.path(),
        &["call", "gate-approve", "proposal=p"],
        console,
        {
            let seen = seen.clone();
            let ca = kit.ca().certificate_pem().to_owned();
            move |builder| {
                builder
                    .with_compiled(support::person::plugin(&seen))
                    .register(support::oauth::whoami())
                    .register(support::oauth::touch())
                    .with_auth_root_certificate(ca.into_bytes())
                    .with_auth_secret("UMBEL_TEST_PERSON_SECRET", support::person::SECRET)
            }
        },
    )
    .await;
    assert_eq!(
        run.json()["error"]["code"],
        "PERSON_VERIFICATION_UNAVAILABLE",
        "{}",
        run.stdout
    );
    assert_eq!(seen.runs("gate-approve"), 0);
}

#[tokio::test]
async fn a_preview_the_page_renders_must_keep_no_text_in_the_journal() {
    let seen = support::person::Seen::default();
    let manifest = support::person::MANIFEST.replace(
        "expose = { mcp = false, agent = false, cli = true }\njournal = { mode = \"digest\", keep = [\"proposal\"] }\nreturns",
        "expose = { mcp = false, agent = false, cli = true }\njournal = { mode = \"plain\" }\nreturns",
    );
    assert_ne!(manifest, support::person::MANIFEST);
    let dir = support::workspace(&format!(
        "config_version = 5\ndefault_space = \"main\"\n[spaces.main]\n{REST}"
    ));
    let plugin = support::person::plugin_with(&seen, manifest);
    let error = support::plugins::seal(dir.path(), |builder| builder.with_compiled(plugin))
        .err()
        .expect("refused");
    assert!(
        error
            .to_string()
            .contains("must be journaled with mode = \"digest\""),
        "{error}"
    );
}

#[tokio::test]
async fn the_hook_sets_the_person_decision_field_itself() {
    // The hook writes the field (as `null`) on every call, so a declared context field can never
    // bring one: trusted code wins (`spec/context-fields.md`).
    let page = Page::start().await;
    let keys = page.extra_keys(&page.token("ada")).await;
    assert!(
        keys.contains(&"dev.umbel/person-decision".to_owned()),
        "{keys:?}"
    );
    // So is the host's own check before begin (step 6).
    assert!(
        keys.contains(&"dev.umbel/person-check".to_owned()),
        "{keys:?}"
    );
}
