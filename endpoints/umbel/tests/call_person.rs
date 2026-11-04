//! `CallContext.person` (phase 4 step 4, amendment 9): a compiled plugin's command sees the
//! host's own answer to whether the caller has authority `person` (phase 3 section 3.3, D86), the
//! terminal check the memory services make before a confirmation. True for a person at a
//! terminal and for an embedder's person; false for `--yes`, `--approve`, `@-`, no terminal, an
//! agent's environment variable and an agent. Nothing a caller sends sets it: a batch's context
//! carries neither mark.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::{Scripted, agent, call, cli_with, cli_with_vars};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel_sdk::{Cx, Outcome, Plugin, success};

/// Two commands that report `person`: one plain, one `require-human`.
struct Probe;

impl Plugin for Probe {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "pp"
title = "Person probe"
version = "0.1.0"
description = "Reports the host's person check."
kind = "compiled"
domains = ["pp"]

[[commands]]
name = "pp-who"
description = "Report CallContext.person."
effects = ["inspect"]
input_schema = { type = "object" }

[[commands]]
name = "pp-consent"
description = "Report CallContext.person after a person's confirmation."
effects = ["inspect"]
input_schema = { type = "object" }
confirm = "require-human"
confirm_prompt = "Consent?"
expose = { mcp = false, agent = false, cli = true }
"#
    }

    fn handle(&self, _name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        success(json!({ "person": cx.call().person }))
    }
}

const CONFIG: &str = r#"config_version = 4
default_space = "main"

[principal]
local_id = "local"
agent_env = ["MY_AGENT"]

[spaces.main]

[plugins]
enabled = ["pp"]

[plugins.pp]
source = "compiled:pp"
"#;

fn configure(builder: HostBuilder) -> HostBuilder {
    builder.with_compiled(sdk(Probe))
}

fn person(run: &support::Run) -> Value {
    assert_eq!(run.code, 0, "{}", run.stdout);
    run.json()["data"]["person"].clone()
}

#[tokio::test]
async fn a_person_at_a_terminal_is_one_and_an_agents_variable_withholds_it() {
    let dir = support::workspace(CONFIG);
    let at_terminal = cli_with(
        dir.path(),
        &["call", "pp-who", "{}"],
        Scripted::new(true, true),
        configure,
    )
    .await;
    assert_eq!(person(&at_terminal), true);
    let confirmed = cli_with(
        dir.path(),
        &["call", "pp-consent", "{}"],
        Scripted::new(true, true),
        configure,
    )
    .await;
    assert_eq!(person(&confirmed), true);
    // The require-human prompt is answered, and the agent's variable still withholds the person.
    for variable in ["CLAUDECODE", "AI_AGENT", "MY_AGENT"] {
        let run = cli_with_vars(
            dir.path(),
            &["call", "pp-consent", "{}"],
            Scripted::new(true, true),
            &[(variable, "1")],
            configure,
        )
        .await;
        assert_eq!(person(&run), false, "{variable}");
    }
    for (words, interactive) in [
        (&["call", "pp-who", "{}", "--yes"][..], true),
        (&["call", "pp-who", "{}", "--approve"][..], true),
        (&["call", "pp-who", "{}"][..], false),
    ] {
        let run = cli_with(
            dir.path(),
            words,
            Scripted::new(interactive, true),
            configure,
        )
        .await;
        assert_eq!(person(&run), false, "{words:?}");
    }
    let stdin = cli_with(
        dir.path(),
        &["call", "pp-who", "@-"],
        Scripted::with_stdin(true, true, b"{}".to_vec()),
        configure,
    )
    .await;
    assert_eq!(person(&stdin), false);
}

#[tokio::test]
async fn an_embedders_person_is_one_and_an_agent_or_a_batch_is_not() {
    let dir = support::workspace(CONFIG);
    let host = support::plugins::seal(dir.path(), configure).unwrap();
    let human = afd::Actor::new(afd::ActorKind::Human).with_id("local");
    let embedder = call(&host, human, "pp-who", json!({})).await;
    assert_eq!(embedder.data.unwrap()["person"], true);
    let bot = call(&host, agent("bot"), "pp-who", json!({})).await;
    assert_eq!(bot.data.unwrap()["person"], false);
    // A batch's context carries no mark: forging one gives nothing.
    let run = cli_with(
        dir.path(),
        &[
            "batch",
            r#"{"commands":[{"command":"pp-who","input":{}}],"context":{"dev.umbel/human-present":"pp-who"}}"#,
        ],
        Scripted::new(true, true),
        configure,
    )
    .await;
    assert_eq!(
        run.json()["results"][0]["result"]["data"]["person"],
        false,
        "{}",
        run.stdout
    );
}
