//! A command declaring `secret` (`spec/journal.md`) is never written to the journal, even
//! though the host gives its recorder a redactor: the host's redactor reduces digest commands
//! only, so it drops every secret entry, its tape included.
use crate::support;
use serde_json::{Value, json};
use support::plugins::{Raw, seal};
use support::{agent, call, journal_entries, journal_path};
use umbel::plugins::PluginCommand;

const INPUT: &str = "{ type = \"object\", properties = {}, additionalProperties = false }";

struct Answer(&'static str);

#[async_trait::async_trait]
impl afd::CommandHandler for Answer {
    async fn execute(
        &self,
        _input: Value,
        context: afd::CommandContext,
    ) -> afd::CommandResult<Value> {
        let drawn = context.random().next();
        afd::success(json!({ "key": self.0, "drawn": drawn }))
    }
}

fn manifest() -> String {
    format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "vault"
title = "Vault"
version = "0.1.0"
description = "A plugin with a secret command and a plain one."
kind = "compiled"
domains = ["vault"]

[[commands]]
name = "vault-unlock"
description = "Issue a key."
effects = ["inspect"]
input_schema = {INPUT}

[[commands]]
name = "vault-peek"
description = "Peek."
effects = ["inspect"]
input_schema = {INPUT}
"#
    )
}

#[tokio::test]
async fn a_secret_command_never_reaches_the_journal() {
    let dir = support::workspace(
        "config_version = 7\ndefault_space = \"main\"\n\n[spaces.main]\n\n[plugins]\nenabled = [\"vault\"]\n\n[journal]\nrecord_failures = true\n",
    );
    let vault = Raw::new(manifest(), |_| {
        let schema = json!({ "type": "object", "properties": {}, "additionalProperties": false });
        let unlock = afd::CommandDefinition::new(
            "vault-unlock",
            "Issue a key.",
            vec![],
            Answer("SECRET-UMBEL-KEY"),
        )
        .as_secret();
        let peek = afd::CommandDefinition::new("vault-peek", "Peek.", vec![], Answer("plain"));
        Ok(vec![
            PluginCommand::definition(unlock, schema.clone()),
            PluginCommand::definition(peek, schema),
        ])
    });
    let host = seal(dir.path(), |b| b.with_compiled(vault)).unwrap();

    let unlocked = call(&host, agent("a"), "vault-unlock", json!({})).await;
    assert!(unlocked.success, "{unlocked:?}");
    assert_eq!(unlocked.data.as_ref().unwrap()["key"], "SECRET-UMBEL-KEY");
    let peeked = call(&host, agent("a"), "vault-peek", json!({})).await;
    assert!(peeked.success, "{peeked:?}");

    let commands: Vec<String> = journal_entries(dir.path())
        .into_iter()
        .map(|entry| entry.command)
        .collect();
    assert_eq!(commands, ["vault-peek"]);
    let raw = std::fs::read_to_string(journal_path(dir.path())).unwrap();
    assert!(!raw.contains("SECRET-UMBEL-KEY"), "{raw}");
}
