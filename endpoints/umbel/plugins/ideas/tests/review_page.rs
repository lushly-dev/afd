//! Review on the page (specification, sections 8.4, 8.5 and 9; step C4): the paged preview with
//! items, and `excluded` honoured. With the review host specification's step H3, a local
//! workspace serves its person page on a loopback bind: the agent begins `ideas-review-apply`
//! over stdio, the person reads every page in a browser on the machine and unchecks what they
//! disagree with, and the agent sends the same call again. What was unchecked is `pulled`, the
//! rest applied at level `local`. The page's preview reader, the stdio caller acting for the
//! space's person, reads the same records the agent staged (the follow-up of 2026-11-12).
//!
//! The paging itself, for a part of 500 and for long items, runs on the stub of the host with
//! `CallContext.preview_page` set, since the page's request limit (30 a minute for a decision,
//! `PAGE_REQUESTS_PER_MINUTE`) is the system clock's: a test turns at most 15 pages of one
//! decision. Every text is an invented fixture about gardening.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::Arc;

use afd::fixed_clock;
use serde_json::{Value, json};
use support::stub::Stub;
use support::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel::testkit::mcp::{Stdio, command_result};

/// The pack's `page_items` and `page_chars`.
const PAGE_ITEMS: usize = 20;
const PAGE_CHARS: usize = 5800;

// ---------------------------------------------------------------------------------------------
// The local page, over real sockets.

/// [`support::config`] at configuration version 7, its local page enabled at `bind`.
fn local_config(bind: SocketAddr) -> String {
    config().replace("config_version = 6", "config_version = 7")
        + &format!("\n[person.local]\nenabled = true\nbind = \"{bind}\"\n")
}

/// A local workspace with the ideas plugin, its person page served on a loopback bind.
struct Local {
    fx: Fx,
    bind: SocketAddr,
}

impl Local {
    async fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let bind = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), local_config(bind)).unwrap();
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(Arc::new(sdk(umbel_plugin_ideas::plugin())))
            .with_clock(fixed_clock(NOW))
            .with_auth_clock(fixed_clock(NOW))
            .seal()
            .unwrap();
        let server = host
            .local_person_server()
            .unwrap()
            .expect("the local page is served");
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(server.serve(listener, std::future::pending()));
        Self {
            fx: Fx {
                dir,
                host,
                clock: NOW,
            },
            bind,
        }
    }

    /// `command` over stdio, as the agent of this machine acting for the space's person, with
    /// AFD's own acknowledgement (the review host specification's A27).
    async fn stdio(&self, command: &str, input: Value) -> Value {
        let mut arguments = input;
        arguments["confirm"] = json!(true);
        let mut stdio = Stdio::connect(&self.fx.host).await;
        let response = stdio
            .request(
                "tools/call",
                json!({ "name": command, "arguments": arguments }),
            )
            .await;
        command_result(&response)
    }

    async fn http(&self, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Reply {
        let mut stream = tokio::net::TcpStream::connect(self.bind).await.unwrap();
        let mut request = format!(
            "{method} {path} HTTP/1.1\r\nhost: {}\r\nconnection: close\r\ncontent-length: {}\r\n",
            self.bind,
            body.len()
        );
        for (name, value) in headers {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        request.push_str("\r\n");
        request.push_str(body);
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.unwrap();
        Reply::parse(&raw)
    }

    /// Open a page as the browser on this machine follows a link or a redirect.
    async fn open(&self, path: &str, site: &str) -> Reply {
        let reply = self
            .http("GET", path, &[("sec-fetch-site", site)], "")
            .await;
        assert_eq!(reply.status, 200, "{path}: {}", reply.text);
        reply
    }

    /// Post a decision's form from the page's own origin.
    async fn post(&self, id: &str, form: &str) -> Reply {
        let origin = format!("http://{}", self.bind);
        self.http(
            "POST",
            &format!("/d/{id}"),
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("origin", &origin),
            ],
            form,
        )
        .await
    }

    /// Read decision `id` from page 1 to the last, leave unchecked every item whose text holds
    /// one of `pull`, and approve on the last page. Answers each page as shown.
    async fn read_and_approve(&self, id: &str, pull: &[&str]) -> Vec<Shown> {
        let mut shown = Vec::new();
        let mut page = self.open(&format!("/d/{id}"), "none").await;
        loop {
            let this = Shown::of(&page.text);
            let number = shown.len() + 1;
            let last = this.pages == number;
            let mut form = format!(
                "csrf={}&page={number}&decision={}",
                hidden(&page.text, "csrf"),
                if last { "approve" } else { "next" }
            );
            for (position, text) in this.items.iter().enumerate() {
                if !pull.iter().any(|needle| text.contains(needle)) {
                    form.push_str(&format!("&k={position}"));
                }
            }
            shown.push(this);
            let posted = self.post(id, &form).await;
            if last {
                assert_eq!(posted.status, 200, "{}", posted.text);
                assert!(
                    posted.text.contains("You approved this request"),
                    "{}",
                    posted.text
                );
                return shown;
            }
            assert_eq!(posted.status, 303, "{}", posted.text);
            let to = posted.header("location");
            assert_eq!(to, format!("/d/{id}?page={}", number + 1));
            page = self.open(&to, "same-origin").await;
        }
    }
}

/// An HTTP reply.
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    text: String,
}

impl Reply {
    fn parse(raw: &[u8]) -> Self {
        let split = raw
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("a head");
        let head = String::from_utf8_lossy(&raw[..split]).into_owned();
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers: Vec<(String, String)> = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_owned()))
            .collect();
        let mut body = raw[split + 4..].to_vec();
        let chunked = headers
            .iter()
            .any(|(name, value)| name == "transfer-encoding" && value.contains("chunked"));
        if chunked {
            body = dechunk(&body);
        }
        Self {
            status,
            headers,
            text: String::from_utf8(body).unwrap(),
        }
    }

    fn header(&self, name: &str) -> String {
        self.headers
            .iter()
            .find(|(found, _)| found == name)
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| panic!("no {name}: {:?}", self.headers))
    }
}

fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let line = body.windows(2).position(|w| w == b"\r\n").unwrap();
        let size = usize::from_str_radix(
            String::from_utf8_lossy(&body[..line])
                .split(';')
                .next()
                .unwrap()
                .trim(),
            16,
        )
        .unwrap();
        if size == 0 {
            return out;
        }
        out.extend_from_slice(&body[line + 2..line + 2 + size]);
        body = &body[line + 2 + size + 2..];
    }
}

/// The value of the hidden input `name` on a rendered page.
fn hidden(page: &str, name: &str) -> String {
    let marker = format!("name=\"{name}\" value=\"");
    let start = page
        .find(&marker)
        .unwrap_or_else(|| panic!("no {name}: {page}"))
        + marker.len();
    page[start..start + page[start..].find('"').unwrap()].to_owned()
}

/// One page as the person saw it: its count of pages and its items' texts, unescaped.
#[derive(Debug)]
struct Shown {
    pages: usize,
    items: Vec<String>,
    html: String,
}

impl Shown {
    fn of(html: &str) -> Self {
        let pages = html
            .split_once("<p>Page ")
            .and_then(|(_, rest)| rest.split_once(". Approve"))
            .map_or(1, |(numbers, _)| {
                numbers.rsplit(' ').next().unwrap().parse().unwrap()
            });
        let items = html
            .split("name=\"k\" value=\"")
            .skip(1)
            .map(|item| {
                let start = item.find("<span>").unwrap() + "<span>".len();
                let end = item.find("</span>").unwrap();
                unescape(&item[start..end])
            })
            .collect();
        Self {
            pages,
            items,
            html: html.to_owned(),
        }
    }
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// `count` statements about beds, from `from`, each its own idea.
fn beds(from: usize, count: usize) -> Vec<String> {
    (from..from + count)
        .map(|i| {
            format!(
                "Bed {i} wants {} barrows of leaf mould before the frost.",
                i % 7 + 2
            )
        })
        .collect()
}

/// Capture `statements` 64 at a time as the agent; their ids.
async fn capture_all(fx: &Fx, statements: &[String]) -> Vec<String> {
    let mut ids = Vec::new();
    for chunk in statements.chunks(64) {
        let refs: Vec<&str> = chunk.iter().map(String::as_str).collect();
        ids.extend(fx.capture(&refs).await);
    }
    ids
}

fn affirm(idea: &str, group: &str) -> Value {
    json!({ "decide": "affirm", "idea": idea, "version": 1, "group": group,
            "reason": "The person said it twice." })
}

/// The decision a `CONFIRMATION_REQUIRED` names, and its page's address.
#[track_caller]
fn decision_of(result: &Value, bind: SocketAddr) -> String {
    assert_eq!(code(result), "CONFIRMATION_REQUIRED", "{result}");
    let id = result["error"]["details"]["decision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        result["error"]["details"]["url"],
        format!("http://{bind}/d/{id}")
    );
    id
}

#[tokio::test]
async fn a_part_of_hundreds_is_read_in_pages_and_the_two_pulled_out_are_pulled() {
    let local = Local::start().await;
    let fx = &local.fx;
    let statements = beds(0, 300);
    let ids = capture_all(fx, &statements).await;
    assert_eq!(ids.len(), 300);
    // 260 in `frost`: affirms, a decline every twentieth, one reword and one fold; 40 in
    // `paths`, staged beside it and left alone.
    let mut proposals: Vec<Value> = (0..260)
        .map(|i| match i {
            5 => json!({ "decide": "reword", "idea": ids[i], "version": 1, "group": "frost",
                         "statement": "Bed 5 wants three barrows of leaf mould. Spread them before the frost.",
                         "reason": "Two ideas in one." }),
            259 => json!({ "decide": "duplicate", "idea": ids[i], "keep": ids[299],
                           "group": "frost", "reason": "The same bed twice." }),
            _ if i % 20 == 3 => json!({ "decide": "decline", "idea": ids[i], "version": 1,
                                        "group": "frost", "reason": "Says little." }),
            _ => affirm(&ids[i], "frost"),
        })
        .collect();
    proposals.extend((260..300).map(|i| affirm(&ids[i], "paths")));
    let staged = fx
        .agent(
            "ideas-review-stage",
            json!({ "idempotencyKey": "autumn-sitting", "proposals": proposals }),
        )
        .await;
    let staged = data(&staged).clone();
    assert_eq!(staged["staged"], 300);
    let frost = staged["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["part"] == "frost")
        .unwrap()
        .clone();
    assert_eq!(frost["count"], 260);
    let input = json!({ "review": staged["review"], "part": "frost", "digest": frost["digest"] });

    // Begun over stdio: refused with the page's address, nothing applied.
    let begun = local.stdio("ideas-review-apply", input.clone()).await;
    let id = decision_of(&begun, local.bind);
    assert_eq!(
        data(&fx.agent("ideas-guide", json!({})).await)["pending"]["staged"],
        300
    );

    // The person reads all 13 pages and unchecks two, on different pages.
    let pull = ["Bed 30 wants", "Bed 170 wants"];
    let shown = local.read_and_approve(&id, &pull).await;
    assert_eq!(shown.len(), 13);
    let mut seen = Vec::new();
    for (index, page) in shown.iter().enumerate() {
        assert_eq!(page.pages, 13);
        assert!(page.items.len() <= PAGE_ITEMS, "{page:?}");
        let chars: usize = page
            .items
            .iter()
            .map(|text| text.chars().filter(|c| *c != '\n').count())
            .sum();
        assert!(chars <= PAGE_CHARS, "page {}: {chars}", index + 1);
        assert!(
            page.html.contains(&format!("page {} of 13", index + 1)),
            "{}",
            page.html
        );
        seen.extend(page.items.iter().cloned());
    }
    // Every decision of the part was shown once, read from the records the agent staged: the
    // page's preview reader reads what the agent and the person read.
    assert_eq!(seen.len(), 260);
    for i in 0..260 {
        let needle = format!("\"Bed {i} wants");
        assert_eq!(
            seen.iter().filter(|text| text.contains(&needle)).count(),
            1,
            "Bed {i}"
        );
    }
    assert!(
        !seen
            .iter()
            .any(|text| text.contains("idea you cannot read"))
    );
    // Page 1 says who staged them and what unchecking does; the decisions come in 8.3's order.
    assert!(shown[0].html.contains("Staged by"), "{}", shown[0].html);
    assert!(shown[0].html.contains("recorded that you disagreed"));
    assert!(!shown[1].html.contains("Staged by"));
    assert!(seen[0].starts_with("DUPLICATE"), "{}", seen[0]);
    assert!(seen[1].starts_with("REWORD"), "{}", seen[1]);
    assert!(seen[2].starts_with("AFFIRM"), "{}", seen[2]);
    assert!(seen[259].starts_with("DECLINE"), "{}", seen[259]);

    // The same call again runs: the two are pulled, the rest applied at level `local`.
    let applied = local.stdio("ideas-review-apply", input.clone()).await;
    let out = data(&applied);
    assert_eq!(out["level"], "local");
    assert_eq!(
        out["applied"],
        json!({ "duplicate": 1, "reword": 1, "affirm": 243, "decline": 13, "undo": 0 })
    );
    assert_eq!(out["skipped"], json!([]));
    let pulled: BTreeSet<&str> = out["pulled"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["idea"].as_str().unwrap())
        .collect();
    assert_eq!(
        pulled,
        BTreeSet::from([ids[30].as_str(), ids[170].as_str()])
    );
    assert_eq!(out["pending"]["staged"], 40);

    // A pulled idea is a seed still, its proposal recorded as the person's disagreement.
    let kept_out = data(&fx.agent("ideas-open", json!({ "id": ids[30] })).await).clone();
    assert_eq!(kept_out["standing"], "seed");
    assert_eq!(kept_out["decisions"][0]["state"], "pulled");
    assert_eq!(kept_out["decisions"][0]["decided"]["level"], "local");
    // An applied one is affirmed at level `local`.
    let affirmed = data(&fx.agent("ideas-open", json!({ "id": ids[31] })).await).clone();
    assert_eq!(affirmed["standing"], "affirmed");
    assert_eq!(affirmed["label"]["affirmed"]["assurance"]["level"], "local");
    assert_eq!(affirmed["decisions"][0]["decided"]["level"], "local");
    // The reword affirmed exactly the words shown on the page.
    let reworded = data(&fx.agent("ideas-open", json!({ "id": ids[5] })).await).clone();
    assert_eq!(reworded["version"], 2);
    assert_eq!(
        reworded["statement"],
        "Bed 5 wants three barrows of leaf mould. Spread them before the frost."
    );
    assert!(seen.iter().any(|text| text.contains(
        "→  \"Bed 5 wants three barrows of leaf mould. Spread them before the frost.\""
    )));

    // A third call begins a new decision for a part that changed: refused before it begins.
    let again = local.stdio("ideas-review-apply", input).await;
    assert_eq!(code(&again), "CONFLICT", "{again}");

    // The report reads the labels: 260 decisions, ready, two pulled affirms.
    let report = data(&fx.agent("ideas-review-report", json!({})).await).clone();
    assert_eq!(report["decisions"], 260);
    assert_eq!(report["pulled"], 2);
    assert_eq!(report["ready"], true);
    assert_eq!(report["byKind"]["affirm"]["pulled"], 2);
    assert_eq!(report["byKind"]["affirm"]["applied"], 243);
    assert_eq!(report["byKind"]["affirm"]["unstaged"], 0);
}

#[tokio::test]
async fn a_review_of_150_in_three_groups_is_confirmed_one_decision_a_group() {
    // The plan's measure 13 (specification, 14.2).
    let local = Local::start().await;
    let fx = &local.fx;
    let ids = capture_all(fx, &beds(0, 150)).await;
    let groups = ["beds-east", "beds-north", "beds-west"];
    let proposals: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| affirm(id, groups[i / 50]))
        .collect();
    let staged = data(
        &fx.agent("ideas-review-stage", json!({ "proposals": proposals }))
            .await,
    )
    .clone();
    let review = staged["review"].as_str().unwrap().to_owned();
    for (index, group) in groups.iter().enumerate() {
        // Each group read now, its digest from show: the parts before it changed nothing of it.
        let shown = data(
            &fx.agent(
                "ideas-review-show",
                json!({ "review": review, "part": group, "limit": 1 }),
            )
            .await,
        )
        .clone();
        let digest = shown["parts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|part| part["part"] == *group)
            .unwrap()["digest"]
            .clone();
        let input = json!({ "review": review, "part": group, "digest": digest });
        let id = decision_of(
            &local.stdio("ideas-review-apply", input.clone()).await,
            local.bind,
        );
        // One pulled out of each group.
        let needle = format!("Bed {} wants", index * 50 + 7);
        let pages = local.read_and_approve(&id, &[needle.as_str()]).await;
        assert_eq!(pages.len(), 3);
        let applied = local.stdio("ideas-review-apply", input).await;
        let out = data(&applied);
        assert_eq!(out["applied"]["affirm"], 49, "{applied}");
        assert_eq!(out["pulled"][0]["idea"], ids[index * 50 + 7].as_str());
        assert_eq!(out["level"], "local");
    }
    let guide = data(&fx.agent("ideas-guide", json!({})).await).clone();
    assert_eq!(guide["pending"], json!({ "staged": 0, "unreviewed": 3 }));
}

#[tokio::test]
async fn a_review_changed_while_it_is_read_cannot_be_approved() {
    let local = Local::start().await;
    let fx = &local.fx;
    let ids = capture_all(fx, &beds(0, 30)).await;
    let proposals: Vec<Value> = ids.iter().map(|id| affirm(id, "beds")).collect();
    let staged = data(
        &fx.agent("ideas-review-stage", json!({ "proposals": proposals }))
            .await,
    )
    .clone();
    let input = json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] });
    let id = decision_of(
        &local.stdio("ideas-review-apply", input.clone()).await,
        local.bind,
    );
    let first = local.open(&format!("/d/{id}"), "none").await;
    assert_eq!(Shown::of(&first.text).pages, 2);
    // The agent unstages one while the person reads: the part's digest moves.
    let unstaged = fx
        .agent(
            "ideas-review-unstage",
            json!({ "review": staged["review"], "proposals": [staged["proposals"][4]] }),
        )
        .await;
    assert_eq!(data(&unstaged)["staged"], 29);
    let form = format!("csrf={}&page=1&decision=next", hidden(&first.text, "csrf"));
    let moved = local.post(&id, &form).await;
    assert_eq!(moved.status, 303, "{}", moved.text);
    let second = local.open(&moved.header("location"), "same-origin").await;
    assert!(
        second.text.contains("could not be shown"),
        "{}",
        second.text
    );
    assert!(!second.text.contains("value=\"approve\""));
    // Nothing was applied, and the call sent again still waits on the person.
    let again = local.stdio("ideas-review-apply", input).await;
    assert_eq!(decision_of(&again, local.bind), id);
    assert_eq!(
        data(&fx.agent("ideas-guide", json!({})).await)["pending"]["staged"],
        29
    );
}

// ---------------------------------------------------------------------------------------------
// The paging, on the stub of the host.

/// Capture `statements` on the stub as the agent, 64 at a time; their ids.
fn stub_capture(stub: &Stub, statements: &[String]) -> Vec<String> {
    let mut ids = Vec::new();
    for chunk in statements.chunks(64) {
        let ideas: Vec<Value> = chunk
            .iter()
            .map(|s| json!({ "statement": s, "type": "principle", "said": "person" }))
            .collect();
        let captured = stub.call("ideas-capture", json!({ "ideas": ideas }));
        ids.extend(
            data(&captured)["ideas"]
                .as_array()
                .unwrap()
                .iter()
                .map(|idea| idea["id"].as_str().unwrap().to_owned()),
        );
    }
    ids
}

/// Every page of `input`'s preview, from 1 until the last.
fn every_page(stub: &Stub, input: &Value) -> Vec<Value> {
    let first = data(&stub.paged("ideas-review-preview", input.clone(), 1)).clone();
    let pages = first["pages"].as_u64().unwrap() as u32;
    let mut all = vec![first];
    for page in 2..=pages {
        let answer = data(&stub.paged("ideas-review-preview", input.clone(), page)).clone();
        assert_eq!(answer["page"], page);
        assert_eq!(answer["pages"], pages);
        all.push(answer);
    }
    all
}

/// The characters a page shows, as the host counts them: line ends not counted.
fn chars_of(page: &Value) -> usize {
    let count = |text: &str| text.chars().filter(|c| *c != '\n').count();
    count(page["preview"].as_str().unwrap())
        + page["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| count(item["text"].as_str().unwrap()))
            .sum::<usize>()
}

#[test]
fn a_part_of_500_is_25_pages_of_whole_items_each_shown_once() {
    let stub = Stub::default();
    let ids = stub_capture(&stub, &beds(0, 500));
    let proposals: Vec<Value> = ids.iter().map(|id| affirm(id, "autumn")).collect();
    let staged = data(&stub.call("ideas-review-stage", json!({ "proposals": proposals }))).clone();
    assert_eq!(staged["staged"], 500);
    let input = json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] });
    let pages = every_page(&stub, &input);
    assert_eq!(pages.len(), 25);
    let mut seen = Vec::new();
    for page in &pages {
        let members: BTreeSet<&str> = page
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            members,
            BTreeSet::from(["preview", "page", "pages", "items"])
        );
        let items = page["items"].as_array().unwrap();
        assert_eq!(items.len(), PAGE_ITEMS);
        assert!(chars_of(page) <= PAGE_CHARS);
        for item in items {
            assert_eq!(item.as_object().unwrap().len(), 2, "{item}");
            seen.push(item["id"].as_str().unwrap().to_owned());
        }
    }
    // Each proposal once, in the order show lists them (8.3).
    let unique: BTreeSet<&String> = seen.iter().collect();
    assert_eq!(unique.len(), 500);
    let listed = data(&stub.call(
        "ideas-review-show",
        json!({ "review": staged["review"], "limit": 200 }),
    ))
    .clone();
    let first: Vec<&str> = listed["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        seen[..200].iter().map(String::as_str).collect::<Vec<_>>(),
        first
    );
    // Page 1 heads the part: its count, who staged it, what unchecking does, and undo.
    let heading = pages[0]["preview"].as_str().unwrap();
    assert!(heading.starts_with(&format!(
        "Review {} · part * (the whole review) · 500 decisions (500 affirm) · page 1 of 25",
        staged["review"].as_str().unwrap()
    )));
    // The stub's envelopes name the person and no agent.
    assert!(heading.contains("Staged by human:ada."), "{heading}");
    assert!(heading.contains("recorded that you disagreed"));
    assert!(heading.contains("can be undone"));
    assert_eq!(
        pages[24]["preview"],
        format!(
            "Review {} · part * (the whole review) · 500 decisions (500 affirm) · page 25 of 25",
            staged["review"].as_str().unwrap()
        )
    );
    // Past the last page is refused, which the page shows as "could not be shown".
    let past = stub.paged("ideas-review-preview", input.clone(), 26);
    assert_eq!(code(&past), "VALIDATION_ERROR");
    assert_eq!(past["error"]["details"]["pages"], 25);
    // Without a page, at a terminal and in the host's check, exactly `{ preview }`.
    let unpaged = stub.call("ideas-review-preview", input);
    let members: Vec<&String> = data(&unpaged).as_object().unwrap().keys().collect();
    assert_eq!(members, ["preview"]);
}

#[test]
fn long_items_fill_a_page_by_characters_and_the_whole_review_heads_each_group() {
    let stub = Stub::default();
    // Statements near the 600-character limit, with long reasons: a page holds few.
    let long: Vec<String> = (0..24)
        .map(|i| {
            format!(
                "Bed {i} wants leaf mould. {}",
                "Spread it thick over the crowns before the first hard frost, then leave it for the worms to pull down over winter. ".repeat(4)
            )
            .chars()
            .take(590)
            .collect()
        })
        .collect();
    let ids = stub_capture(&stub, &long);
    let reason = "The person said this in the walk round the beds and again at the shed, in the same words both times, so it is theirs.";
    let proposals: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let group = ["east", "north", "west"][i % 3];
            if i % 4 == 0 {
                json!({ "decide": "reword", "idea": id, "version": 1, "group": group,
                        "statement": format!("Bed {i} wants a thick mulch of leaf mould before the frost, left for the worms over winter, and nothing else on it until spring."),
                        "reason": reason })
            } else {
                json!({ "decide": "affirm", "idea": id, "version": 1, "group": group, "reason": reason })
            }
        })
        .collect();
    let staged = data(&stub.call("ideas-review-stage", json!({ "proposals": proposals }))).clone();
    let input = json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] });
    let pages = every_page(&stub, &input);
    assert!(pages.len() > 2, "{}", pages.len());
    let mut total = 0;
    let mut last_group = String::new();
    for page in &pages {
        let items = page["items"].as_array().unwrap();
        assert!(!items.is_empty());
        assert!(items.len() < PAGE_ITEMS);
        assert!(chars_of(page) <= PAGE_CHARS, "{}", chars_of(page));
        for (position, item) in items.iter().enumerate() {
            let text = item["text"].as_str().unwrap();
            let group = text
                .strip_prefix("## ")
                .and_then(|rest| rest.split_once('\n'))
                .map(|(group, _)| group.to_owned());
            // Headed where a page starts and where a group starts, nowhere else.
            if position == 0 {
                assert!(group.is_some(), "{text}");
            }
            match group {
                Some(group) => {
                    assert!(position == 0 || group != last_group, "{text}");
                    last_group = group;
                }
                None => assert!(!text.contains("## ")),
            }
            total += 1;
        }
    }
    assert_eq!(total, 24);
    // One group: no headings at all.
    let east = staged["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["part"] == "east")
        .unwrap()
        .clone();
    let input = json!({ "review": staged["review"], "part": "east", "digest": east["digest"] });
    for page in every_page(&stub, &input) {
        for item in page["items"].as_array().unwrap() {
            assert!(!item["text"].as_str().unwrap().contains("## "));
        }
    }
}

#[test]
fn a_paged_preview_of_a_changed_part_is_refused() {
    let stub = Stub::default();
    let ids = stub_capture(&stub, &beds(0, 3));
    let proposals: Vec<Value> = ids.iter().map(|id| affirm(id, "beds")).collect();
    let staged = data(&stub.call("ideas-review-stage", json!({ "proposals": proposals }))).clone();
    let input = json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] });
    assert_eq!(
        data(&stub.paged("ideas-review-preview", input.clone(), 1))["pages"],
        1
    );
    stub.call(
        "ideas-review-unstage",
        json!({ "review": staged["review"], "proposals": [staged["proposals"][0]] }),
    );
    let refused = stub.paged("ideas-review-preview", input, 1);
    assert_eq!(code(&refused), "CONFLICT");
}
