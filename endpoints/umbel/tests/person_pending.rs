//! The list of pending decisions on the hosted person page (the Ideas host-review specification,
//! section 5; step H2): `GET <path>/d/` logs the person in for the list alone and shows only their
//! own pending, unexpired decisions, each linking to its page, with no preview run. A login to the
//! list decides nothing.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::person::{Asked, ORIGIN, Page, asked, authorize, call, decide, decide_as, open};
use umbel_testkit_idp::ScriptedLogin;

async fn begin(page: &Page, subject: &str, proposal: &str) -> Asked {
    asked(
        &call(
            &page.client,
            &page.token(subject),
            "gate-approve",
            json!({ "proposal": proposal }),
            json!({}),
            true,
        )
        .await,
    )
}

#[tokio::test]
async fn the_list_shows_only_the_viewers_pending_unexpired_decisions() {
    let page = Page::start().await;
    let old = begin(&page, "ada", "p-old").await;
    page.clock.advance(300_000);
    page.host.check_person_logins().await;
    let live = begin(&page, "ada", "p-live").await;
    let declined = begin(&page, "ada", "p-declined").await;
    let other = begin(&page, "bo", "p-other").await;
    let decided = decide_as(&page, &page.client, &declined.path(), "ada", "decline").await;
    assert_eq!(decided.status, 200, "{}", decided.text);
    // `old` expires; `live` does not.
    page.clock.advance(301_000);
    page.host.check_person_logins().await;
    let previews = page.seen.runs("gate-preview");

    // The list's address starts a login of its own, at the page's one namespace.
    let opened = open(&page.client, "/mcp/d/").await;
    page.script(ScriptedLogin::user("ada"));
    let back = authorize(&page.kit, &opened.location).await;
    let cookie = opened.cookie_header();
    let list = page.client.get(&back, &[("cookie", cookie.as_str())]).await;
    assert_eq!(list.status, 200, "{}", list.text);
    assert!(
        list.text.contains("Signed in as <b>corp/ada</b>"),
        "{}",
        list.text
    );
    assert!(
        list.text
            .contains(&format!("href=\"/mcp/d/{}\"", live.id())),
        "{}",
        list.text
    );
    assert!(list.text.contains("<code>gate-approve</code>"));
    assert!(list.text.contains("main"));
    for gone in [&old, &declined, &other] {
        assert!(!list.text.contains(&gone.id()), "{}", list.text);
    }
    // No preview is run for the list.
    assert_eq!(page.seen.runs("gate-preview"), previews);
    // The list login decides nothing: it is no login of any decision.
    let login = opened.location.clone();
    let login_id = support::person::query_value(&login, "state")
        .unwrap()
        .split('.')
        .next()
        .unwrap()
        .to_owned();
    let refused = decide(
        &page.client,
        &live.id(),
        &format!("login={login_id}&csrf=x&decision=approve"),
        Some(&cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(refused.status, 403);

    // Bo's list is bo's.
    let opened = open(&page.client, "/mcp/d/").await;
    page.script(ScriptedLogin::user("bo"));
    let back = authorize(&page.kit, &opened.location).await;
    let cookie = opened.cookie_header();
    let list = page.client.get(&back, &[("cookie", cookie.as_str())]).await;
    assert_eq!(list.status, 200, "{}", list.text);
    assert!(list.text.contains(&other.id()), "{}", list.text);
    assert!(!list.text.contains(&live.id()), "{}", list.text);
}

#[tokio::test]
async fn the_list_names_a_namespace_the_page_serves() {
    let page = Page::start().await;
    let named = open(&page.client, "/mcp/d/?namespace=corp").await;
    assert!(named.location.contains("state="), "{}", named.location);
    for path in ["/mcp/d/?namespace=else", "/mcp/d/?other=1"] {
        let refused = page.client.get(path, &[]).await;
        assert_eq!(refused.status, 404, "{path}");
    }
    let posted = page
        .client
        .send(page.client.request("POST", "/mcp/d/", &[], String::new()))
        .await;
    assert_eq!(posted.status, 405);
    // Nothing waiting: the list says so.
    let opened = open(&page.client, "/mcp/d/").await;
    page.script(ScriptedLogin::user("ada"));
    let back = authorize(&page.kit, &opened.location).await;
    let list = page
        .client
        .get(&back, &[("cookie", opened.cookie_header().as_str())])
        .await;
    assert_eq!(list.status, 200, "{}", list.text);
    assert!(
        list.text.contains("Nothing is waiting for you."),
        "{}",
        list.text
    );
}
