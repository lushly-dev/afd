//! A paged preview with items on the hosted person page (the Ideas host-review specification,
//! sections 2 and 3; step H2): an unpaged preview stays exactly `{ preview }` in the host's own
//! check, every render asks for its page, `next` and `previous` answer `303`s and keep the
//! person's choices, Approve needs every page, a changed review starts again, a page that would be
//! cut or repeats an item cannot be approved, a position past the page is refused, and the form
//! of a page of 100 items fits in 4096 bytes. The run is told which items were pulled out.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::hosted::Reply;
use support::person::{
    Asked, ORIGIN, Page, accepted, asked, call, decide, item_ids, login, result,
};
use umbel_testkit_idp::ScriptedLogin;

/// Begin a decision for `gate-approve` of `proposal` as ada's client.
async fn begin(page: &Page, proposal: &str) -> Asked {
    asked(
        &call(
            &page.client,
            &page.token("ada"),
            "gate-approve",
            json!({ "proposal": proposal }),
            json!({}),
            true,
        )
        .await,
    )
}

/// The browser of one login: its decision, cookie and form values.
struct Browser {
    id: String,
    cookie: String,
    login: String,
    csrf: String,
    first: Reply,
}

/// Log in as ada on `prompt`'s page.
async fn browse(page: &Page, prompt: &Asked) -> Browser {
    page.script(ScriptedLogin::user("ada"));
    let logged = login(page, &page.client, &prompt.path()).await;
    assert_eq!(logged.page.status, 200, "{}", logged.page.text);
    let (login, csrf) = logged.form.clone().unwrap();
    Browser {
        id: prompt.id(),
        cookie: logged.opened.cookie_header(),
        login,
        csrf,
        first: logged.page,
    }
}

impl Browser {
    /// Post `action` from `page` with the items at `checked` left checked.
    async fn post(&self, page: &Page, from: u32, action: &str, checked: &[usize]) -> Reply {
        let mut fields = format!(
            "login={}&csrf={}&page={from}&decision={action}",
            self.login, self.csrf
        );
        for position in checked {
            fields.push_str(&format!("&k={position}"));
        }
        decide(
            &page.client,
            &self.id,
            &fields,
            Some(&self.cookie),
            Some(ORIGIN),
        )
        .await
    }

    /// `GET` `path` with the login's cookie.
    async fn get(&self, page: &Page, path: &str) -> Reply {
        let reply = page
            .client
            .get(path, &[("cookie", self.cookie.as_str())])
            .await;
        assert_eq!(reply.status, 200, "{path}: {}", reply.text);
        reply
    }

    /// Follow a `303` to the page it names.
    async fn follow(&self, page: &Page, moved: &Reply, to: u32) -> Reply {
        assert_eq!(moved.status, 303, "{}", moved.text);
        let location = moved.headers["location"].to_str().unwrap().to_owned();
        assert_eq!(location, format!("/mcp/d/{}?page={to}", self.id));
        self.get(page, &location).await
    }
}

/// Whether the item at `position` is checked on a rendered page.
fn is_checked(html: &str, position: usize) -> bool {
    let checked = format!("name=\"k\" value=\"{position}\" checked>");
    let unchecked = format!("name=\"k\" value=\"{position}\">");
    assert!(
        html.contains(&checked) || html.contains(&unchecked),
        "no item {position}: {html}"
    );
    html.contains(&checked)
}

fn offers(html: &str, action: &str) -> bool {
    html.contains(&format!("name=\"decision\" value=\"{action}\""))
}

/// Retry the call `prompt` began, after the person decided.
async fn retry(page: &Page, prompt: &Asked, proposal: &str) -> Value {
    result(
        &call(
            &page.client,
            &page.token("ada"),
            "gate-approve",
            json!({ "proposal": proposal }),
            accepted(&prompt.state),
            true,
        )
        .await,
    )
}

#[tokio::test]
async fn the_hosts_check_asks_for_no_page_and_every_render_asks_for_one() {
    let page = Page::start().await;
    let prompt = begin(&page, "paged").await;
    // The host's check before begin: no page, so the preview answers exactly `{ preview }`.
    let checks = page.seen.of("gate-preview");
    assert_eq!(checks.len(), 1);
    assert!(!checks[0]["check"].is_null(), "{}", checks[0]);
    assert!(checks[0]["page"].is_null(), "{}", checks[0]);
    let browser = browse(&page, &prompt).await;
    assert!(browser.first.text.contains("Garden review · page 1 of 3"));
    let moved = browser.post(&page, 1, "next", &[0, 1]).await;
    browser.follow(&page, &moved, 2).await;
    // Each render asked the preview for its page, and named the preview it asked.
    let renders: Vec<Value> = page.seen.of("gate-preview")[1..].to_vec();
    assert_eq!(renders.len(), 2);
    for (render, number) in renders.iter().zip([1, 2]) {
        assert_eq!(
            render["page"],
            json!({ "preview": "gate-preview", "page": number })
        );
        assert!(render["check"].is_null(), "{render}");
    }
    // An unpaged preview is one page with no items, approved as before.
    let plain = begin(&page, "p-9").await;
    let browser = browse(&page, &plain).await;
    assert!(
        offers(&browser.first.text, "approve"),
        "{}",
        browser.first.text
    );
    assert!(!offers(&browser.first.text, "next"));
    assert!(!browser.first.text.contains("name=\"k\""));
    let approved = browser.post(&page, 1, "approve", &[]).await;
    assert_eq!(approved.status, 200, "{}", approved.text);
    let ran = retry(&page, &plain, "p-9").await;
    assert_eq!(ran["success"], json!(true), "{ran}");
    let mark = &page.seen.of("gate-approve")[0]["mark"];
    assert!(mark.get("excluded").is_none(), "{mark}");
}

#[tokio::test]
async fn pages_move_with_next_and_previous_and_keep_the_choices() {
    let page = Page::start().await;
    let prompt = begin(&page, "paged").await;
    let browser = browse(&page, &prompt).await;
    let first = &browser.first.text;
    assert!(is_checked(first, 0) && is_checked(first, 1));
    assert!(!offers(first, "approve") && !offers(first, "previous"));
    assert!(offers(first, "next") && offers(first, "decline"));
    // Page 1: the second item pulled out.
    let moved = browser.post(&page, 1, "next", &[0]).await;
    let second = browser.follow(&page, &moved, 2).await;
    assert!(second.text.contains("page 2 of 3"), "{}", second.text);
    assert!(offers(&second.text, "previous") && !offers(&second.text, "approve"));
    let back = browser.post(&page, 2, "previous", &[0, 1]).await;
    let again = browser.follow(&page, &back, 1).await;
    // The person's earlier choice is shown.
    assert!(is_checked(&again.text, 0) && !is_checked(&again.text, 1));
    let moved = browser.post(&page, 1, "next", &[0]).await;
    browser.follow(&page, &moved, 2).await;
    let moved = browser.post(&page, 2, "next", &[1]).await;
    let last = browser.follow(&page, &moved, 3).await;
    assert!(offers(&last.text, "approve"), "{}", last.text);
    assert!(!offers(&last.text, "next"));
    let approved = browser.post(&page, 3, "approve", &[0]).await;
    assert_eq!(approved.status, 200, "{}", approved.text);
    assert!(approved.text.contains("You approved"));
    let ran = retry(&page, &prompt, "paged").await;
    assert_eq!(ran["success"], json!(true), "{ran}");
    // The run is told what was pulled out, through the mark; the input is unchanged.
    let run = &page.seen.of("gate-approve")[0];
    assert_eq!(run["input"], json!({ "proposal": "paged" }));
    assert_eq!(
        run["mark"]["excluded"],
        json!([item_ids(1)[1], item_ids(2)[0], item_ids(3)[1]])
    );
}

#[tokio::test]
async fn approve_is_offered_and_taken_only_after_every_page() {
    let page = Page::start().await;
    let prompt = begin(&page, "paged").await;
    let browser = browse(&page, &prompt).await;
    // Posted from page 1, Approve records nothing.
    let early = browser.post(&page, 1, "approve", &[0, 1]).await;
    assert_eq!(early.status, 403, "{}", early.text);
    assert!(
        early.text.contains("This request changed"),
        "{}",
        early.text
    );
    // Page 3 reached by its address, page 2 never shown: still no Approve.
    let third = browser
        .get(&page, &format!("{}?page=3", prompt.path()))
        .await;
    assert!(!offers(&third.text, "approve"), "{}", third.text);
    let skipped = browser.post(&page, 3, "approve", &[0, 1]).await;
    assert_eq!(skipped.status, 403);
    // Page 2 shown: every page was, and Approve is there.
    let second = browser
        .get(&page, &format!("{}?page=2", prompt.path()))
        .await;
    assert!(offers(&second.text, "approve"), "{}", second.text);
    // A page number out of range, or another query, is not a page.
    for query in [
        "?page=0",
        "?page=201",
        "?page=x",
        "?page=1&page=2",
        "?other=1",
    ] {
        let wrong = page
            .client
            .get(
                &format!("{}{query}", prompt.path()),
                &[("cookie", browser.cookie.as_str())],
            )
            .await;
        assert_eq!(wrong.status, 404, "{query}");
    }
    let approved = browser.post(&page, 2, "approve", &[0, 1]).await;
    assert_eq!(approved.status, 200, "{}", approved.text);
}

#[tokio::test]
async fn a_review_that_changed_while_read_starts_again() {
    let page = Page::start().await;
    let prompt = begin(&page, "paged").await;
    let browser = browse(&page, &prompt).await;
    let moved = browser.post(&page, 1, "next", &[0]).await;
    // The review now has four pages: page 2 renders with another number of pages.
    page.seen.1.store(4, std::sync::atomic::Ordering::SeqCst);
    let restarted = browser.follow(&page, &moved, 2).await;
    assert!(
        restarted
            .text
            .contains("The review changed while you read it."),
        "{}",
        restarted.text
    );
    assert!(restarted.text.contains("page 1 of 4"), "{}", restarted.text);
    // The choices were cleared with the pages.
    assert!(is_checked(&restarted.text, 0) && is_checked(&restarted.text, 1));
    // An approval from a page of the old review is not recorded.
    let stale = browser.post(&page, 3, "approve", &[]).await;
    assert_eq!(stale.status, 403);
}

#[tokio::test]
async fn a_page_that_would_be_cut_or_repeats_an_item_cannot_be_approved() {
    let page = Page::start().await;
    // More than 6000 characters: never cut, so only Decline.
    let prompt = begin(&page, "long").await;
    let browser = browse(&page, &prompt).await;
    let shown = &browser.first.text;
    assert!(shown.contains("could not be shown"), "{shown}");
    assert!(!offers(shown, "approve") && offers(shown, "decline"));
    assert_eq!(browser.post(&page, 1, "approve", &[]).await.status, 403);
    let declined = browser.post(&page, 1, "decline", &[]).await;
    assert_eq!(declined.status, 200, "{}", declined.text);
    // Page 2 repeats an id of page 1: it cannot be shown, and the review cannot be approved.
    let prompt = begin(&page, "paged-dup").await;
    let browser = browse(&page, &prompt).await;
    let moved = browser.post(&page, 1, "next", &[0, 1]).await;
    let second = browser.follow(&page, &moved, 2).await;
    assert!(
        second.text.contains("could not be shown"),
        "{}",
        second.text
    );
    assert!(!offers(&second.text, "approve") && !offers(&second.text, "next"));
}

#[tokio::test]
async fn a_position_past_the_page_is_refused_and_nothing_kept() {
    let page = Page::start().await;
    let prompt = begin(&page, "paged").await;
    let browser = browse(&page, &prompt).await;
    for checked in [&[2usize][..], &[0, 0]] {
        let refused = browser.post(&page, 1, "next", checked).await;
        assert_eq!(refused.status, 403, "{checked:?}");
        assert!(refused.text.contains("This request changed"));
    }
    // Not a position at all, or an unknown action: the form is refused.
    for fields in [
        "&decision=next&k=a",
        "&decision=next&k=-1",
        "&decision=next&k=100",
        "&decision=skip",
        "&decision=next&page=0",
        "&decision=next&decision=next",
    ] {
        let body = format!("login={}&csrf={}{fields}", browser.login, browser.csrf);
        let refused = decide(
            &page.client,
            &browser.id,
            &body,
            Some(&browser.cookie),
            Some(ORIGIN),
        )
        .await;
        assert_eq!(refused.status, 403, "{fields}");
    }
    let shown = browser.get(&page, &prompt.path()).await;
    assert!(is_checked(&shown.text, 0) && is_checked(&shown.text, 1));
}

#[tokio::test]
async fn the_form_of_a_hundred_items_fits_in_4096_bytes() {
    let page = Page::start().await;
    let prompt = begin(&page, "hundred").await;
    let browser = browse(&page, &prompt).await;
    assert!(browser.first.text.contains("value=\"99\" checked>"));
    let mut fields = format!(
        "login={}&csrf={}&decision=approve",
        browser.login, browser.csrf
    );
    for position in 0..100 {
        fields.push_str(&format!("&k={position}"));
    }
    assert!(fields.len() <= 4096, "{}", fields.len());
    let approved = decide(
        &page.client,
        &browser.id,
        &fields,
        Some(&browser.cookie),
        Some(ORIGIN),
    )
    .await;
    assert_eq!(approved.status, 200, "{}", approved.text);
    let ran = retry(&page, &prompt, "hundred").await;
    assert_eq!(ran["success"], json!(true), "{ran}");
    // All left checked: nothing pulled out.
    assert!(
        page.seen.of("gate-approve")[0]["mark"]
            .get("excluded")
            .is_none()
    );
}
