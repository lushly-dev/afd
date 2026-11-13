//! A person decision's lifetime (the Ideas host-review specification, section 4). From step H1,
//! the parsing: `person.decision_ttl_s` defaults to phase 5's ten minutes, is honoured between 60
//! seconds and 24 hours, and is refused outside them. From step H2, the behaviour on the hosted
//! page: a decision lives `decision_ttl_s`, each render moves its expiry, never past a day after
//! it began, and the login lives until its decision expires.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;

mod support;

use serde_json::json;
use support::person::{Asked, ORIGIN, Page, asked, call, decide, login};
use umbel_testkit_idp::ScriptedLogin;

use umbel::workspace::{
    DEFAULT_DECISION_TTL_S, PERSON_DECISION_TTL_MAX_S, PERSON_DECISION_TTL_MIN_S, Workspace,
    WorkspaceError,
};

fn open(text: &str) -> Result<Workspace, WorkspaceError> {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("umbel.toml"), text).unwrap();
    Workspace::open(&root)
}

fn ttl(text: &str) -> u64 {
    open(text)
        .unwrap_or_else(|error| panic!("{text}: {error}"))
        .config()
        .person
        .decision_ttl_s
}

#[test]
fn the_default_is_600_seconds() {
    assert_eq!(DEFAULT_DECISION_TTL_S, 600);
    assert_eq!(DEFAULT_DECISION_TTL_S, umbel::auth::PERSON_DECISION_TTL_S);
    for text in [
        "config_version = 5\n",
        "config_version = 6\n",
        "config_version = 7\n",
        "config_version = 7\n[person]\n",
    ] {
        assert_eq!(ttl(text), 600, "{text}");
    }
}

#[test]
fn decision_ttl_s_is_honoured_from_a_minute_to_a_day() {
    assert_eq!(
        (PERSON_DECISION_TTL_MIN_S, PERSON_DECISION_TTL_MAX_S),
        (60, 86_400)
    );
    for seconds in [60, 600, 3600, 86_400] {
        assert_eq!(
            ttl(&format!(
                "config_version = 7\n[person]\ndecision_ttl_s = {seconds}\n"
            )),
            seconds
        );
    }
}

#[test]
fn decision_ttl_s_out_of_range_is_refused() {
    for value in ["59", "0", "-600", "86401", "\"1h\"", "600.0"] {
        let text = format!("config_version = 7\n[person]\ndecision_ttl_s = {value}\n");
        let error = open(&text).expect_err(&text);
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{text}: {error}");
        assert_eq!(
            error.key(),
            Some("person.decision_ttl_s"),
            "{text}: {error}"
        );
    }
    // Before version 7 the key does not exist.
    let error = open("config_version = 6\n[person]\ndecision_ttl_s = 3600\n").unwrap_err();
    assert_eq!(error.key(), Some("person"));
    assert!(
        error.message().contains("needs config_version = 7"),
        "{error}"
    );
}

// ── The lifetime on the hosted page (step H2) ─────────────────────────────────────────────────

/// A served workspace whose `person.decision_ttl_s` is `seconds`.
async fn served(seconds: u64) -> Page {
    Page::start_edited(|text| {
        format!(
            "{}\n[person]\ndecision_ttl_s = {seconds}\n",
            text.replace("config_version = 5", "config_version = 7")
        )
    })
    .await
}

async fn begin(page: &Page) -> Asked {
    asked(
        &call(
            &page.client,
            &page.token("ada"),
            "gate-approve",
            json!({ "proposal": "p-1" }),
            json!({}),
            true,
        )
        .await,
    )
}

/// Log in as ada on `prompt`'s page: the login's cookie and its form.
async fn logged_in(page: &Page, prompt: &Asked) -> (String, String, String) {
    page.script(ScriptedLogin::user("ada"));
    let logged = login(page, &page.client, &prompt.path()).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let (login, csrf) = logged.form.unwrap();
    (logged.opened.cookie_header(), login, csrf)
}

async fn rendered(page: &Page, prompt: &Asked, cookie: &str) -> u16 {
    page.client
        .get(
            &format!("{}?page=1", prompt.path()),
            &[("cookie", cookie), ("sec-fetch-site", "same-origin")],
        )
        .await
        .status
}

#[tokio::test]
async fn a_decision_lives_decision_ttl_s() {
    let page = served(3600).await;
    let prompt = begin(&page).await;
    // Past phase 5's ten minutes, it still opens.
    page.clock.advance(1_800_000);
    page.host.check_person_logins().await;
    assert_eq!(page.client.get(&prompt.path(), &[]).await.status, 302);
    page.clock.advance(1_801_000);
    page.host.check_person_logins().await;
    assert_eq!(page.client.get(&prompt.path(), &[]).await.status, 404);
}

#[tokio::test]
async fn each_render_moves_the_expiry_from_the_last_page_shown() {
    let page = Page::start().await;
    let prompt = begin(&page).await;
    let (cookie, login, csrf) = logged_in(&page, &prompt).await;
    // Rendered again within its ten minutes, the decision lives ten minutes from then.
    page.clock.advance(500_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 200);
    page.clock.advance(500_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 200);
    // Alive past ten minutes, the decision still needs a sign-in fresher than its lifetime.
    let approved = decide(
        &page.client,
        &prompt.id(),
        &format!("login={login}&csrf={csrf}&decision=approve"),
        Some(&cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(approved.status, 403, "{}", approved.text);
    assert!(approved.text.contains("Sign in again"), "{}", approved.text);
    // A fresh sign-in decides it.
    let fresh =
        support::person::decide_as(&page, &page.client, &prompt.path(), "ada", "approve").await;
    assert_eq!(fresh.status, 200, "{}", fresh.text);
}

#[tokio::test]
async fn the_expiry_never_moves_past_a_day_after_the_beginning() {
    let page = served(86_400).await;
    let prompt = begin(&page).await;
    let (cookie, _, _) = logged_in(&page, &prompt).await;
    page.clock.advance(80_000_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 200);
    // A render moved it to at most a day after it began, not a day after the render.
    page.clock.advance(6_500_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 404);
}

#[tokio::test]
async fn the_hosted_login_lives_until_its_decision_expires() {
    let page = served(3600).await;
    let prompt = begin(&page).await;
    let (cookie, login, csrf) = logged_in(&page, &prompt).await;
    // Past the ten minutes a login once had: the page still renders for it, and it decides.
    page.clock.advance(1_200_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 200);
    let approved = decide(
        &page.client,
        &prompt.id(),
        &format!("login={login}&csrf={csrf}&decision=approve"),
        Some(&cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(approved.status, 200, "{}", approved.text);
}

#[tokio::test]
async fn an_approval_later_than_decision_ttl_s_after_the_sign_in_is_refused() {
    let page = served(3600).await;
    let prompt = begin(&page).await;
    let (cookie, login, _) = logged_in(&page, &prompt).await;
    // Kept alive by a render, the decision outlives the sign-in's freshness.
    page.clock.advance(3_000_000);
    page.host.check_person_logins().await;
    assert_eq!(rendered(&page, &prompt, &cookie).await, 200);
    page.clock.advance(700_000);
    page.host.check_person_logins().await;
    let shown = page
        .client
        .get(
            &format!("{}?page=1", prompt.path()),
            &[
                ("cookie", cookie.as_str()),
                ("sec-fetch-site", "same-origin"),
            ],
        )
        .await;
    assert_eq!(shown.status, 200, "{}", shown.text);
    let (_, csrf) = support::person::form(&shown.text).unwrap();
    let late = decide(
        &page.client,
        &prompt.id(),
        &format!("login={login}&csrf={csrf}&decision=approve"),
        Some(&cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(late.status, 403, "{}", late.text);
    assert!(late.text.contains("Sign in again"), "{}", late.text);
}
