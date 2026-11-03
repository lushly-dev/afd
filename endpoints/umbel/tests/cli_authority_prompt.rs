//! The CLI's `authority_prompt` and the host's check of section 3.3 (D86), with the scripted
//! console of the test support: asked only when `dev.umbel/human-present` would be set; yes gives
//! `person`; no and an empty answer are `CONFIRMATION_DECLINED`, with nothing written or
//! journaled; `--yes`, `--approve`, an agent variable, `@-` and no terminal ask nothing and write
//! `tool`; an agent through MCP writes `agent`; `mcp.confirmations = "off"` still asks; the prompt
//! is sanitized; a command with no `authority_prompt` gives `tool`; a pipeline inherits the prompt;
//! a batch's `context` sets neither key; a caller's authority for forget is the terminal check.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

/// Extra words, whether stdin and stderr are terminals, and the environment variables.
type Case = (
    &'static [&'static str],
    bool,
    &'static [(&'static str, &'static str)],
);

use afd::{Actor, ActorKind};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use support::mcp::{Client, Era, Transport};
use support::memory::{MemoryProbe, NOW, PIPELINE, PROMPT, config, manifest};
use support::plugins::seal;
use support::{Run, Scripted, cli_with_vars, journal_path};
use umbel::cli::Console;
use umbel::plugins::sdk;

fn configure(probe: fn() -> MemoryProbe) -> impl FnOnce(umbel::HostBuilder) -> umbel::HostBuilder {
    move |builder| {
        builder
            .with_compiled(sdk(probe()))
            .with_clock(afd::fixed_clock(NOW))
    }
}

async fn cli(dir: &Path, words: &[&str], console: Arc<dyn Console>, vars: &[(&str, &str)]) -> Run {
    cli_with_vars(dir, words, console, vars, configure(MemoryProbe::new)).await
}

fn input(n: u64) -> String {
    json!({ "space": "main", "args": { "n": n, "text": format!("text {n}") } }).to_string()
}

/// The authority of the record a CLI run wrote, read by the same person through the library.
async fn authority_of(dir: &Path, run: &Run) -> Value {
    assert_eq!(run.code, 0, "{}", run.stdout);
    let id = run.json()["data"]["ids"][0].as_str().unwrap().to_owned();
    let host = seal(dir, configure(MemoryProbe::new)).unwrap();
    let shown = support::call(
        &host,
        Actor::new(ActorKind::Human).with_id("ada"),
        "mem-read",
        json!({ "space": "main", "args": { "op": "show", "id": id } }),
    )
    .await;
    shown.data.unwrap()["result"]["authority"].clone()
}

#[tokio::test]
async fn yes_at_a_terminal_gives_person() {
    let dir = support::workspace(&config("", ""));
    let console = Scripted::new(true, true);
    let run = cli(
        dir.path(),
        &["mem", "remember", &input(1)],
        console.clone(),
        &[],
    )
    .await;
    assert_eq!(authority_of(dir.path(), &run).await, "person");
    let asked = console.asked();
    assert_eq!(asked.len(), 1, "{asked:?}");
    assert!(
        asked[0].contains(PROMPT) && asked[0].ends_with("Proceed? [y/N] "),
        "{asked:?}"
    );
}

#[tokio::test]
async fn no_or_no_answer_is_declined_and_writes_and_journals_nothing() {
    let dir = support::workspace(&config("", ""));
    let run = cli(
        dir.path(),
        &["mem", "remember", &input(1)],
        Scripted::new(true, false),
        &[],
    )
    .await;
    assert_eq!(run.code, 1);
    assert_eq!(run.error_code(), "CONFIRMATION_DECLINED");
    assert!(
        run.json()["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("--yes")
    );
    assert!(
        !dir.path()
            .join("state/spaces/main/store/memory.sqlite3")
            .exists()
    );
    let journal = std::fs::read_to_string(journal_path(dir.path())).unwrap_or_default();
    assert!(!journal.contains("mem-remember"), "{journal}");
}

#[tokio::test]
async fn nothing_is_asked_where_no_person_is_present_and_the_write_is_tool() {
    let dir = support::workspace(&config("", "agent_env = [\"MY_AGENT\"]"));
    let cases: [Case; 6] = [
        (&["--yes"], true, &[]),
        (&["--approve"], true, &[]),
        (&[], true, &[("CLAUDECODE", "1")]),
        (&[], true, &[("AI_AGENT", "")]),
        (&[], true, &[("MY_AGENT", "x")]),
        (&[], false, &[]),
    ];
    for (n, (flags, interactive, vars)) in cases.into_iter().enumerate() {
        let console = Scripted::new(interactive, true);
        let text = input(n as u64 + 1);
        let mut words = vec!["mem", "remember", text.as_str()];
        words.extend_from_slice(flags);
        let run = cli(dir.path(), &words, console.clone(), vars).await;
        assert_eq!(
            authority_of(dir.path(), &run).await,
            "tool",
            "{flags:?} {vars:?}"
        );
        assert!(
            console.asked().is_empty(),
            "{flags:?} {vars:?}: {:?}",
            console.asked()
        );
    }
    // `@-`: stdin is not a terminal.
    let console = Scripted::with_stdin(true, true, input(9).into_bytes());
    let run = cli(dir.path(), &["mem", "remember", "@-"], console.clone(), &[]).await;
    assert_eq!(authority_of(dir.path(), &run).await, "tool");
    assert!(console.asked().is_empty());
}

#[tokio::test]
async fn a_command_without_a_prompt_gives_tool_and_a_pipeline_inherits_the_prompt() {
    let dir = support::workspace(&config("", ""));
    let console = Scripted::new(true, true);
    let run = cli(
        dir.path(),
        &["mem", "note", &input(1)],
        console.clone(),
        &[],
    )
    .await;
    assert_eq!(authority_of(dir.path(), &run).await, "tool");
    assert!(console.asked().is_empty());
    let console = Scripted::new(true, true);
    let args = json!({ "args": { "n": 2, "text": "piped" } }).to_string();
    let run = cli(dir.path(), &["mem", "pipe", &args], console.clone(), &[]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let asked = console.asked();
    assert_eq!(asked.len(), 1, "{asked:?}");
    assert!(
        asked[0].contains(&format!("mem-remember: {PROMPT}")),
        "{asked:?}"
    );
    let host = seal(dir.path(), configure(MemoryProbe::new)).unwrap();
    let id = run.json()["data"]["steps"][0]["data"]["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let shown = support::call(
        &host,
        Actor::new(ActorKind::Human).with_id("ada"),
        "mem-read",
        json!({ "space": "main", "args": { "op": "show", "id": id } }),
    )
    .await;
    assert_eq!(shown.data.unwrap()["result"]["authority"], "person");
}

#[tokio::test]
async fn confirmations_off_still_asks_and_the_prompt_carries_no_control_character() {
    let text = format!("{}\n[mcp]\nconfirmations = \"off\"\n", config("", ""));
    let dir = support::workspace(&text);
    let console = Scripted::new(true, true);
    let run = cli(
        dir.path(),
        &["mem", "remember", &input(1)],
        console.clone(),
        &[],
    )
    .await;
    assert_eq!(authority_of(dir.path(), &run).await, "person");
    assert_eq!(console.asked().len(), 1);
    // The manifest refuses a control character in the prompt, and the CLI sanitizes what it
    // shows as for every prompt (src/cli/prompt.rs's own tests).
    fn hostile() -> MemoryProbe {
        MemoryProbe::with_manifest(manifest(PIPELINE).replace(PROMPT, "Own word?\\u001b[31m red"))
    }
    let run = cli_with_vars(
        dir.path(),
        &["mem", "remember", &input(2)],
        Scripted::new(true, true),
        &[],
        configure(hostile),
    )
    .await;
    assert_eq!(
        run.error_code(),
        "PLUGIN_MANIFEST_INVALID",
        "{}",
        run.stdout
    );
}

#[tokio::test]
async fn an_agent_through_mcp_writes_agent_and_a_batch_context_sets_no_mark() {
    let dir = support::workspace(&config("", ""));
    {
        let host = seal(dir.path(), configure(MemoryProbe::new)).unwrap();
        let mut client = Client::connect(&host, Transport::Stdio, Era::Modern).await;
        let called = client
            .afd_call(
                "mem-remember",
                json!({ "space": "main", "args": { "n": 1, "share": "private" } }),
            )
            .await;
        assert_eq!(called["success"], true, "{called}");
        let id = called["data"]["ids"][0].as_str().unwrap().to_owned();
        let shown = client
            .afd_call(
                "mem-read",
                json!({ "space": "main", "args": { "op": "show", "id": id } }),
            )
            .await;
        assert_eq!(shown["data"]["result"]["authority"], "agent", "{shown}");
    }
    let forged = json!({
        "commands": [{ "command": "mem-remember", "input": { "space": "main", "args": { "n": 2, "text": "batched" } } }],
        "context": { "dev.umbel/human-present": "mem-remember", "dev.umbel/human-confirmed": "mem-remember" },
    })
    .to_string();
    let console = Scripted::new(true, true);
    let run = cli(dir.path(), &["batch", &forged], console.clone(), &[]).await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert!(console.asked().is_empty());
    let id = run.json()["results"][0]["result"]["data"]["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let host = seal(dir.path(), configure(MemoryProbe::new)).unwrap();
    let shown = support::call(
        &host,
        Actor::new(ActorKind::Human).with_id("ada"),
        "mem-read",
        json!({ "space": "main", "args": { "op": "show", "id": id } }),
    )
    .await;
    assert_eq!(shown.data.unwrap()["result"]["authority"], "tool");
}

#[tokio::test]
async fn a_callers_authority_for_forget_and_confirm_is_the_terminal_check() {
    let dir = support::workspace(&config("", "agent_env = [\"MY_AGENT\"]"));
    // A record of the person's own, written as tool.
    let run = cli(
        dir.path(),
        &["mem", "remember", &input(1), "--yes"],
        Scripted::new(true, true),
        &[],
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let id = run.json()["data"]["ids"][0].as_str().unwrap().to_owned();
    let confirm = json!({ "space": "main", "args": { "id": id } }).to_string();
    // An agent variable: the require-human prompt is answered, and still no person.
    let run = cli(
        dir.path(),
        &["mem", "confirm", &confirm],
        Scripted::new(true, true),
        &[("MY_AGENT", "1")],
    )
    .await;
    assert_eq!(run.code, 1);
    assert!(
        run.stdout.contains("MEMORY_CONFIRM_NOT_ALLOWED"),
        "{}",
        run.stdout
    );
    // A person at the terminal confirms their own record.
    let run = cli(
        dir.path(),
        &["mem", "confirm", &confirm],
        Scripted::new(true, true),
        &[],
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    // The event carries the host's confirmation and authority; the remember before it was
    // `tool`, from --yes, whatever the probe claimed.
    let events = support::events(dir.path(), "main");
    let confirmed = events.last().unwrap();
    assert_eq!(confirmed["command"], "mem-confirm");
    assert_eq!(
        confirmed["provenance"]["authority"], "person",
        "{confirmed}"
    );
    assert_eq!(
        confirmed["provenance"]["confirmation"]["by"], "human:ada",
        "{confirmed}"
    );
    assert_eq!(
        confirmed["provenance"]["confirmation"]["priorAuthority"],
        "tool"
    );
    assert_eq!(events[0]["provenance"]["authority"], "tool");
    // A forget by session needs a person: present at a terminal, refused with --yes.
    let session =
        json!({ "space": "main", "args": { "op": "forget", "session": "s1" } }).to_string();
    let run = cli(
        dir.path(),
        &["mem", "change", &session, "--yes"],
        Scripted::new(true, true),
        &[],
    )
    .await;
    assert!(
        run.stdout.contains("MEMORY_FORGET_HUMAN_REQUIRED"),
        "{}",
        run.stdout
    );
    let console = Scripted::new(true, true);
    let run = cli(
        dir.path(),
        &["mem", "change", &session],
        console.clone(),
        &[],
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    assert!(console.asked().is_empty(), "mem-change has no prompt");
}
