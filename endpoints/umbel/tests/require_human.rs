//! `confirm = "require-human"` (phase 2 specification, section 3.4, owner decision 2 of
//! 2026-11-01): only a person at a terminal approves. The CLI shows the prompt only when stdin
//! and stderr are terminals and refuses `--yes` and `--approve`; every other way to call the
//! command is refused with `CONFIRMATION_REQUIRED` before the handler runs.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::mcp::Client;
use support::plugins::seal;
use support::store::{ALLOW_ALL, StoreProbe, config};
use support::{Scripted, agent, call, cli_with, events};
use umbel::HostBuilder;
use umbel::plugins::sdk;

const PUT: &str = r#"args={"id":"notes/a","text":"approved"}"#;

fn configure(builder: HostBuilder) -> HostBuilder {
    builder.with_compiled(sdk(StoreProbe::new()))
}

fn workspace(extra_config: &str) -> tempfile::TempDir {
    support::workspace(&format!("{}{extra_config}", config("", "", ALLOW_ALL)))
}

fn put() -> serde_json::Value {
    json!({"op": "doc-put", "args": {"id": "notes/a", "text": "approved"}})
}

#[tokio::test]
async fn yes_and_approve_are_refused_even_at_a_terminal() {
    let dir = workspace("");
    for flag in ["--yes", "--approve"] {
        let console = Scripted::new(true, true);
        let run = cli_with(
            dir.path(),
            &["call", "sp-approve", "op=doc-put", PUT, flag],
            console.clone(),
            configure,
        )
        .await;
        assert_eq!(run.code, 1, "{flag}: {}", run.stdout);
        assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED", "{flag}");
        let suggestion = run.json()["error"]["suggestion"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(suggestion.contains("terminal"), "{suggestion}");
        assert!(console.asked().is_empty(), "{flag} must not even ask");
    }
    assert!(events(dir.path(), "main").is_empty());
}

#[tokio::test]
async fn without_a_terminal_it_is_refused() {
    let dir = workspace("");
    let run = cli_with(
        dir.path(),
        &["call", "sp-approve", "op=doc-put", PUT],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.code, 1);
    assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED");
    assert!(events(dir.path(), "main").is_empty());
}

#[tokio::test]
async fn a_terminal_answer_decides() {
    let dir = workspace("");
    let no = Scripted::new(true, false);
    let declined = cli_with(
        dir.path(),
        &["call", "sp-approve", "op=doc-put", PUT],
        no.clone(),
        configure,
    )
    .await;
    assert_eq!(declined.error_code(), "CONFIRMATION_DECLINED");
    assert_eq!(no.asked().len(), 1);
    assert!(
        no.asked()[0].contains("Really approve it?"),
        "{:?}",
        no.asked()
    );
    assert!(events(dir.path(), "main").is_empty());

    let yes = Scripted::new(true, true);
    let approved = cli_with(
        dir.path(),
        &["call", "sp-approve", "op=doc-put", PUT],
        yes.clone(),
        configure,
    )
    .await;
    assert_eq!(approved.code, 0, "{}", approved.stdout);
    assert_eq!(yes.asked().len(), 1);
    assert_eq!(events(dir.path(), "main").len(), 1);
}

#[tokio::test]
async fn the_workspaces_confirmation_policy_does_not_loosen_it() {
    // `mcp.confirmations = "off"` asks nothing of an ordinary confirm_prompt command; this one
    // still needs a person.
    let dir = workspace("\n[mcp]\nconfirmations = \"off\"\n");
    let run = cli_with(
        dir.path(),
        &["call", "sp-approve", "op=doc-put", PUT],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(run.error_code(), "CONFIRMATION_REQUIRED");
    let yes = cli_with(
        dir.path(),
        &["call", "sp-approve", "op=doc-put", PUT, "--yes"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(yes.error_code(), "CONFIRMATION_REQUIRED");
    assert!(events(dir.path(), "main").is_empty());
}

#[tokio::test]
async fn a_batch_cannot_carry_the_confirmation() {
    let dir = workspace("");
    let run = cli_with(
        dir.path(),
        &[
            "batch",
            r#"{"commands":[{"command":"sp-approve","input":{"op":"doc-put","args":{"id":"notes/a","text":"x"}}}]}"#,
        ],
        Scripted::new(true, true),
        configure,
    )
    .await;
    let results = &run.json()["results"];
    assert_eq!(
        results[0]["result"]["error"]["code"], "CONFIRMATION_REQUIRED",
        "{}",
        run.stdout
    );
    assert!(events(dir.path(), "main").is_empty());
}

#[tokio::test]
async fn in_process_calls_and_agents_are_refused_before_the_handler() {
    let dir = workspace("");
    let host = seal(dir.path(), configure).unwrap();
    for actor in [
        agent("a"),
        afd::Actor::new(afd::ActorKind::Human).with_id("local"),
    ] {
        let outcome = call(&host, actor, "sp-approve", put()).await;
        assert_eq!(outcome.error.unwrap().code, "CONFIRMATION_REQUIRED");
    }
    // A caller that sets the interface to the CLI but did not go through the prompt has no mark.
    let mut context = host.context(afd::Actor::new(afd::ActorKind::Human).with_id("local"));
    context.interface = Some(afd::CommandInterface::Cli);
    let marked_not = host
        .registry()
        .execute("sp-approve", put(), Some(context))
        .await;
    assert_eq!(marked_not.error.unwrap().code, "CONFIRMATION_REQUIRED");
    assert!(events(dir.path(), "main").is_empty());
}

#[tokio::test]
async fn over_mcp_the_command_does_not_run() {
    let dir = workspace("\n[mcp]\nfirst_class_tools = [\"workspace-show\", \"sp-read\"]\n");
    let host = seal(dir.path(), configure).unwrap();
    for mut client in Client::lanes(&host).await {
        let label = client.label();
        let refused = client.afd_call("sp-approve", put()).await;
        assert_ne!(refused["success"], true, "{label}: {refused}");
    }
    assert!(events(dir.path(), "main").is_empty());
}
