//! The Ideas plugin's first use, walked on the README's local instance (the plugin
//! specification's step C5): the workspace is the README's `umbel.toml` as written, its page's
//! bind moved to a free port, with the plugins this binary compiles in. Over stdio, the agent
//! reads the instructions and the first-class tools, remembers a fact, captures, asks, stages a
//! review of 60 proposals and begins `ideas-review-apply` with `"*"`; the person reads every
//! page of the local page, unchecks three and approves; the agent sends the same call again,
//! and reads `ideas-review-report`. Every text is an invented fixture about gardening.
//!
//! The owner's own first use, on his own content and his own instance, is the other half of the
//! step's exit and happens outside this repository. This test shows the README's steps work as
//! written. A second test times staging 500 and applying 250 on the page, the figures the
//! specification's follow-ups ask for at the first use: run it in a release build with
//! `--nocapture` to read them.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::net::SocketAddr;
use std::time::Instant;

use afd::fixed_clock;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use umbel::testkit::mcp::{Stdio, command_result};
use umbel::{Host, HostBuilder};

const README: &str = include_str!("../../plugins/ideas/README.md");
/// The README's bind for the local page.
const README_BIND: &str = "bind = \"127.0.0.1:7421\"";
/// 2026-01-01T00:00:00Z.
const NOW: i64 = 1_767_225_600_000;

/// The README's instance, its first TOML block after "## A local instance", as written.
fn readme_instance() -> String {
    let (_, rest) = README.split_once("## A local instance").unwrap();
    let (_, rest) = rest.split_once("```toml\n").unwrap();
    rest.split_once("```").unwrap().0.to_owned()
}

/// The README's local instance, open, its page served on a free loopback port.
struct Instance {
    _dir: TempDir,
    host: Host,
    bind: SocketAddr,
    stdio: Stdio,
    initialize: Value,
}

impl Instance {
    async fn start() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let bind = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let config = readme_instance();
        assert!(config.contains(README_BIND), "{config}");
        let config = config.replace(README_BIND, &format!("bind = \"{bind}\""));
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        // The plugins `umbel-first-party` compiles in, as its `main` registers them.
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(umbel::plugins::sdk(
                umbel_plugin_sources_filesystem::plugin(),
            ))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_knowledge::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_memory::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_context::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_components::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_curator::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_ideas::plugin()))
            .with_clock(fixed_clock(NOW))
            .with_auth_clock(fixed_clock(NOW))
            .seal()
            .unwrap();
        // `person-page-serve`, in process.
        let server = host
            .local_person_server()
            .unwrap()
            .expect("the README's instance serves the local page");
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        tokio::spawn(server.serve(listener, std::future::pending()));
        // `serve --stdio`, as the agent's harness starts it.
        let mut stdio = Stdio::connect_modern(&host);
        let initialize = stdio
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": "garden-harness", "version": "0" },
                }),
            )
            .await;
        Self {
            _dir: dir,
            host,
            bind,
            stdio,
            initialize,
        }
    }

    /// A tool call over stdio, as the agent; the `CommandResult`.
    async fn call(&mut self, command: &str, arguments: Value) -> Value {
        let response = self
            .stdio
            .request(
                "tools/call",
                json!({ "name": command, "arguments": arguments }),
            )
            .await;
        command_result(&response)
    }

    /// `ideas-review-apply` over stdio through `afd-call`, as the README's agent reaches it (the
    /// instance does not list it first-class), with AFD's own acknowledgement beside the input.
    async fn apply(&mut self, input: &Value) -> Value {
        self.call(
            "afd-call",
            json!({ "command": "ideas-review-apply", "input": input, "confirm": true }),
        )
        .await
    }

    async fn capture(&mut self, statements: &[String]) -> Vec<String> {
        let mut ids = Vec::new();
        for (n, chunk) in statements.chunks(64).enumerate() {
            let ideas: Vec<Value> = chunk
                .iter()
                .map(|s| json!({ "statement": s, "type": "principle", "said": "person" }))
                .collect();
            let captured = self
                .call(
                    "ideas-capture",
                    json!({ "ideas": ideas, "idempotencyKey": format!("talk-{n}") }),
                )
                .await;
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

    /// The person's browser opens decision `id` from the link the agent gave, reads every page,
    /// leaves unchecked each item whose text holds one of `pull`, and approves on the last page.
    /// The pages shown, each as its items' texts.
    async fn read_and_approve(&self, id: &str, pull: &[&str]) -> Vec<Vec<String>> {
        let origin = format!("http://{}", self.bind);
        let mut pages = Vec::new();
        let mut path = format!("/d/{id}");
        let mut site = "none";
        loop {
            let page = self
                .http("GET", &path, &[("sec-fetch-site", site)], "")
                .await;
            assert_eq!(page.status, 200, "{path}: {}", page.text);
            let items = items(&page.text);
            let number = pages.len() + 1;
            let last = page.text.contains("value=\"approve\"");
            let mut form = format!(
                "csrf={}&page={number}&decision={}",
                hidden(&page.text, "csrf"),
                if last { "approve" } else { "next" }
            );
            for (position, text) in items.iter().enumerate() {
                if !pull.iter().any(|needle| text.contains(needle)) {
                    form.push_str(&format!("&k={position}"));
                }
            }
            pages.push(items);
            let posted = self
                .http(
                    "POST",
                    &format!("/d/{id}"),
                    &[
                        ("content-type", "application/x-www-form-urlencoded"),
                        ("origin", &origin),
                    ],
                    &form,
                )
                .await;
            if last {
                assert_eq!(posted.status, 200, "{}", posted.text);
                assert!(posted.text.contains("You approved this request"));
                return pages;
            }
            assert_eq!(posted.status, 303, "{}", posted.text);
            path = posted.location.clone().unwrap();
            site = "same-origin";
        }
    }
}

struct Reply {
    status: u16,
    location: Option<String>,
    text: String,
}

impl Reply {
    fn parse(raw: &[u8]) -> Self {
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
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
        let mut location = None;
        let mut chunked = false;
        for (name, value) in lines.filter_map(|line| line.split_once(':')) {
            let (name, value) = (name.trim().to_lowercase(), value.trim());
            if name == "location" {
                location = Some(value.to_owned());
            }
            if name == "transfer-encoding" && value.contains("chunked") {
                chunked = true;
            }
        }
        let mut body = raw[split + 4..].to_vec();
        if chunked {
            body = dechunk(&body);
        }
        Self {
            status,
            location,
            text: String::from_utf8(body).unwrap(),
        }
    }
}

fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let line = body.windows(2).position(|w| w == b"\r\n").unwrap();
        let size = String::from_utf8_lossy(&body[..line]);
        let size = usize::from_str_radix(size.split(';').next().unwrap().trim(), 16).unwrap();
        if size == 0 {
            return out;
        }
        out.extend_from_slice(&body[line + 2..line + 2 + size]);
        body = &body[line + 2 + size + 2..];
    }
}

fn hidden(page: &str, name: &str) -> String {
    let marker = format!("name=\"{name}\" value=\"");
    let start = page.find(&marker).unwrap() + marker.len();
    page[start..start + page[start..].find('"').unwrap()].to_owned()
}

/// A page's items, in order, their text unescaped.
fn items(html: &str) -> Vec<String> {
    html.split("name=\"k\" value=\"")
        .skip(1)
        .map(|item| {
            let start = item.find("<span>").unwrap() + "<span>".len();
            let end = item.find("</span>").unwrap();
            item[start..end]
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&#x27;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
        })
        .collect()
}

#[track_caller]
fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

/// The decision a refusal names, its link checked against the page's bind.
#[track_caller]
fn decision_of(result: &Value, bind: SocketAddr) -> String {
    assert_eq!(result["error"]["code"], "CONFIRMATION_REQUIRED", "{result}");
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

/// `count` statements about the beds, from `from`.
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

fn affirm(idea: &str, group: &str) -> Value {
    json!({ "decide": "affirm", "idea": idea, "version": 1, "group": group,
            "reason": "The person said it in their own words.", "confidence": "high" })
}

#[tokio::test]
async fn the_readme_local_instance_walks_from_capture_to_the_report() {
    let mut garden = Instance::start().await;

    // The harness reads the README's paragraph and the four first-class tools.
    let instructions = garden.initialize["result"]["instructions"]
        .as_str()
        .unwrap();
    let configured: toml::Table = readme_instance().parse().unwrap();
    assert_eq!(
        instructions,
        configured["mcp"]["instructions"].as_str().unwrap()
    );
    assert_eq!(
        garden.host.first_class_tools(),
        [
            "ideas-capture",
            "ideas-ask",
            "ideas-guide",
            "memory-remember"
        ]
    );
    let listed = garden.stdio.request("tools/list", json!({})).await;
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    for tool in [
        "ideas-capture",
        "ideas-ask",
        "ideas-guide",
        "memory-remember",
    ] {
        assert!(names.contains(&tool), "{names:?}");
    }

    // A fact about the person goes to memory; their views go to ideas.
    let remembered = garden
        .call(
            "memory-remember",
            json!({ "class": "semantic", "subject": "The garden's soil",
                    "text": "The person gardens on heavy clay." }),
        )
        .await;
    data(&remembered);
    let mut statements = beds(0, 66);
    statements.push("Paths of bark chip stay dry underfoot through the winter.".to_owned());
    statements.push("Leaf mould is the best mulch for a clay bed.".to_owned());
    let ids = garden.capture(&statements).await;
    assert_eq!(ids.len(), 68);

    // Asked before answering in the person's voice: their seeds, named as seeds.
    let asked = garden
        .call(
            "ideas-ask",
            json!({ "question": "Which mulch suits a clay bed?" }),
        )
        .await;
    let asked = data(&asked).clone();
    assert!(asked["found"].as_u64().unwrap() >= 1, "{asked}");
    assert!(
        asked["ideas"]
            .to_string()
            .contains("Leaf mould is the best mulch"),
        "{asked}"
    );
    assert_eq!(asked["pending"]["unreviewed"], 68);

    // A review of 60, staged in one call in three groups: affirms, a decline, a fold and a
    // reword, each with a reason and a confidence.
    let mut proposals: Vec<Value> = (0..40).map(|i| affirm(&ids[i], "beds-east")).collect();
    proposals.extend((40..56).map(|i| affirm(&ids[i], "beds-west")));
    proposals.push(json!({ "decide": "decline", "idea": ids[56], "version": 1,
        "group": "beds-west", "reason": "Says little.", "confidence": "low" }));
    proposals.push(
        json!({ "decide": "duplicate", "idea": ids[57], "keep": ids[67],
        "group": "mulch", "reason": "The same mulch twice.", "confidence": "medium" }),
    );
    proposals.push(
        json!({ "decide": "reword", "idea": ids[66], "version": 1, "group": "paths",
        "statement": "Bark chip paths stay dry underfoot. They last about three winters.",
        "reason": "Clearer.", "confidence": "medium" }),
    );
    proposals.push(affirm(&ids[67], "mulch"));
    assert_eq!(proposals.len(), 60);
    let staged = garden
        .call(
            "ideas-review-stage",
            json!({ "idempotencyKey": "autumn-review", "proposals": proposals }),
        )
        .await;
    let staged = data(&staged).clone();
    assert_eq!(staged["staged"], 60);

    // The README's step 3 (amendment F-2). Without `confirm: true`, AFD refuses first, by
    // either route, with no page address: nothing reaches the host's confirmation.
    let input = json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] });
    let routes = [
        (
            "afd-call",
            json!({ "command": "ideas-review-apply", "input": input }),
            "repeat the afd-call with confirm: true",
        ),
        (
            "ideas-review-apply",
            input.clone(),
            "repeat the call with confirm: true",
        ),
    ];
    for (tool, arguments, suggestion) in routes {
        let unconfirmed = garden.call(tool, arguments).await;
        assert_eq!(
            unconfirmed["error"]["code"], "CONFIRMATION_REQUIRED",
            "{unconfirmed}"
        );
        assert!(
            unconfirmed["error"]["details"]["url"].is_null(),
            "{unconfirmed}"
        );
        assert!(
            unconfirmed["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains(suggestion),
            "{unconfirmed}"
        );
    }

    // With `confirm: true`, the whole review, one link: refused with the page's address,
    // nothing applied.
    let begun = garden.apply(&input).await;
    let decision = decision_of(&begun, garden.bind);

    // The person reads every page and unchecks three, in two groups.
    let pull = ["Bed 3 wants", "Bed 44 wants", "Bed 45 wants"];
    let pages = garden.read_and_approve(&decision, &pull).await;
    assert_eq!(pages.len(), 3);
    let shown: Vec<&String> = pages.iter().flatten().collect();
    assert_eq!(shown.len(), 60);
    for group in ["beds-east", "beds-west", "mulch", "paths"] {
        assert!(
            shown
                .iter()
                .any(|item| item.starts_with(&format!("## {group}"))),
            "the group {group} is a heading"
        );
    }

    // The same call again: three pulled, the rest applied at level `local`.
    let applied = garden.apply(&input).await;
    let out = data(&applied).clone();
    assert_eq!(out["level"], "local");
    assert_eq!(
        out["applied"],
        json!({ "duplicate": 1, "reword": 1, "affirm": 54, "decline": 1, "undo": 0 })
    );
    assert_eq!(out["pulled"].as_array().unwrap().len(), 3);
    assert_eq!(out["pending"]["staged"], 0);

    // The report is read.
    let report = garden.call("ideas-review-report", json!({})).await;
    let report = data(&report).clone();
    assert_eq!(report["decisions"], 60);
    assert_eq!(report["pulled"], 3);
    assert_eq!(report["byKind"]["affirm"]["pulled"], 3);
    assert_eq!(report["duplicates"]["count"], 1);
    assert_eq!(report["rewords"]["count"], 1);
}

#[tokio::test]
async fn staging_500_and_applying_250_on_the_page_are_timed() {
    // The specification's follow-ups: staging 500 took 3.4 s and applying 250 about 5 s in a
    // debug build, to be measured again in a release build at the first use. Printed, not held:
    // `cargo test --release -p umbel-first-party --test ideas_first_use -- --nocapture`.
    let mut garden = Instance::start().await;
    let ids = garden.capture(&beds(0, 500)).await;
    assert_eq!(ids.len(), 500);
    let proposals: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| affirm(id, if i < 250 { "east" } else { "west" }))
        .collect();
    let started = Instant::now();
    let staged = garden
        .call("ideas-review-stage", json!({ "proposals": proposals }))
        .await;
    let staging = started.elapsed();
    let staged = data(&staged).clone();
    assert_eq!(staged["staged"], 500);
    let east = staged["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|part| part["part"] == "east")
        .unwrap()
        .clone();
    let input = json!({ "review": staged["review"], "part": "east", "digest": east["digest"] });
    let decision = decision_of(&garden.apply(&input).await, garden.bind);
    // 13 pages: inside the page's 30 requests a minute for a decision (C4-7).
    let pages = garden.read_and_approve(&decision, &[]).await;
    assert_eq!(pages.len(), 13);
    let started = Instant::now();
    let applied = garden.apply(&input).await;
    let applying = started.elapsed();
    assert_eq!(data(&applied)["applied"]["affirm"], 250, "{applied}");
    eprintln!("staged 500 in {staging:?}; applied 250 in one decision in {applying:?}");
}

/// Every `umbel-first-party` command in the README's `sh` blocks, split into words as a shell
/// would: `~/` is `home`, and `"$input"` (the export loop's) is `{}`. A command ends at the end
/// of its line or at the `)` that closes a `$(...)`.
fn readme_commands(home: &std::path::Path) -> Vec<Vec<String>> {
    let mut commands = Vec::new();
    for block in README.split("```sh\n").skip(1) {
        let block = block.split_once("```").unwrap().0;
        for line in block.lines() {
            let mut rest = line;
            while let Some(at) = rest.find("umbel-first-party ") {
                rest = &rest[at + "umbel-first-party ".len()..];
                let (words, end) = shell_words(rest, home);
                commands.push(words);
                rest = &rest[end..];
            }
        }
    }
    commands
}

/// The words of `text` up to an unquoted `)` or its end, and where they stopped.
fn shell_words(text: &str, home: &std::path::Path) -> (Vec<String>, usize) {
    let home = format!("{}/", home.display());
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        match c {
            ')' => return (finish(words, word), at),
            ' ' | '\t' => {
                if let Some(done) = word.take() {
                    words.push(done);
                }
            }
            '\'' => {
                let current = word.get_or_insert_with(String::new);
                for (_, q) in chars.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    current.push(q);
                }
            }
            '"' => {
                let mut quoted = String::new();
                for (_, q) in chars.by_ref() {
                    if q == '"' {
                        break;
                    }
                    quoted.push(q);
                }
                let quoted = match quoted.as_str() {
                    "$input" => "{}".to_owned(),
                    other => {
                        assert!(
                            !other.contains('$'),
                            "a variable the test does not know: {other}"
                        );
                        quoted
                    }
                };
                word.get_or_insert_with(String::new).push_str(&quoted);
            }
            '~' if word.is_none() && chars.peek().is_some_and(|(_, next)| *next == '/') => {
                chars.next();
                word = Some(home.clone());
            }
            '$' | '`' | '|' | ';' | '&' | '>' | '<' => {
                panic!("a shell construct the test does not read, in: {text}")
            }
            other => word.get_or_insert_with(String::new).push(other),
        }
    }
    (finish(words, word), text.len())
}

fn finish(mut words: Vec<String>, word: Option<String>) -> Vec<String> {
    words.extend(word);
    words
}

/// The owner's first use (amendment F-1): the README put `--workspace` after `call`'s input,
/// which the command line refuses as input, and called a bare `umbel ideas-export`. Every
/// `umbel-first-party` command in the README's `sh` blocks is run through the real binary on a
/// home with no `ideas` workspace: a command whose words parse reaches the workspace and is
/// refused `WORKSPACE_NOT_FOUND`, before anything serves or opens; one that does not is refused
/// `INVALID_INPUT`. The export, the one command that returns, is then run on the README's
/// instance, and its one page is the last: no `next`, and the manifest.
#[test]
fn every_readme_command_parses_as_written() {
    let bin = env!("CARGO_BIN_EXE_umbel-first-party");
    let run = |words: &[String]| {
        let output = std::process::Command::new(bin)
            .args(words)
            .env_remove("UMBEL_WORKSPACE")
            .env_remove("UMBEL_LOG")
            .env_remove("UMBEL_HTTP_BIND")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        (output.status.success(), text)
    };

    let empty = tempfile::tempdir().unwrap();
    let commands = readme_commands(empty.path());
    assert!(commands.len() >= 3, "{commands:?}");
    let mut verbs = Vec::new();
    for words in &commands {
        let (_, text) = run(words);
        assert!(
            text.contains("WORKSPACE_NOT_FOUND") && !text.contains("INVALID_INPUT"),
            "the README's `umbel-first-party {}` does not parse: {text}",
            words.join(" ")
        );
        verbs.push(
            words
                .iter()
                .find(|w| !w.starts_with('-') && !w.contains('/'))
                .cloned(),
        );
    }
    for verb in ["serve", "call"] {
        assert!(
            verbs.iter().any(|v| v.as_deref() == Some(verb)),
            "{verbs:?}"
        );
    }

    // The export on the README's instance.
    let home = tempfile::tempdir().unwrap();
    let workspace = home.path().join("ideas");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(workspace.join("umbel.toml"), readme_instance()).unwrap();
    let export = readme_commands(home.path())
        .into_iter()
        .find(|words| words.iter().any(|w| w == "ideas-export"))
        .expect("the README exports with umbel-first-party");
    let (ok, text) = run(&export);
    assert!(ok, "{text}");
    // stdout's result first, then whatever the host wrote to stderr.
    let page: Value = serde_json::Deserializer::from_str(&text)
        .into_iter()
        .next()
        .unwrap()
        .unwrap();
    assert_eq!(page["success"], true, "{page}");
    // The loop's `.data.next // empty`: absent on the last page, which holds the manifest.
    assert!(page["data"].get("next").is_none(), "{page}");
    assert!(page["data"]["manifest"].is_object(), "{page}");
}
