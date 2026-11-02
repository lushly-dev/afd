//! A workspace with collections, readers and allow lists for the sources-filesystem plugin, and
//! the means to read what the sync stored.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

/// The default workspace: spaces `main` (collections `handbook`, `code`) and `beta`
/// (`notes`), the group `platform` with `human:ada` in it.
pub const CONFIG: &str = r#"
config_version = 3
default_space = "main"

[spaces.main]
[spaces.main.collections.handbook]
root = "spaces/main/handbook"
[spaces.main.collections.code]
root = "spaces/main/code"
kind = "code"

[spaces.beta]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

[access.groups.platform]
members = ["human:ada"]

[plugins]
enabled = ["sources"]

[plugins.sources]
source = "compiled:sources"

[plugins.sources.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.sources.grants.records_write]
allow = ["main", "beta"]
"#;

pub struct Fx {
    pub dir: TempDir,
    pub host: Host,
}

pub fn build(dir: &Path) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
        .with_clock(fixed_clock(1_767_225_600_000))
        .seal()
        .unwrap()
}

impl Fx {
    pub fn new() -> Self {
        Self::with(CONFIG)
    }

    /// A workspace whose `umbel.toml` is `config`, with every declared root created.
    pub fn with(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        for root in ["main/handbook", "main/code", "beta/notes"] {
            std::fs::create_dir_all(dir.path().join("spaces").join(root)).unwrap();
        }
        let host = build(dir.path());
        Self { dir, host }
    }

    /// The same workspace booted again with another `umbel.toml`.
    pub fn reopen(&mut self, config: &str) {
        std::fs::write(self.dir.path().join("umbel.toml"), config).unwrap();
        self.host = build(self.dir.path());
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    /// Write a file of `main`'s `handbook` collection.
    pub fn handbook(&self, path: &str, text: &str) {
        self.write(&format!("spaces/main/handbook/{path}"), text.as_bytes());
    }

    pub fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.path(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    pub fn remove(&self, relative: &str) {
        std::fs::remove_file(self.path(relative)).unwrap();
    }

    /// Give a file a modification time that differs from its last one, as an edit does.
    pub fn touch(&self, relative: &str, seconds: u64) {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(self.path(relative))
            .unwrap();
        file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
            .unwrap();
    }

    pub async fn call(
        &self,
        actor: Actor,
        interface: CommandInterface,
        command: &str,
        input: Value,
    ) -> CommandResult<Value> {
        let context = self.host.context(actor).with_interface(interface);
        self.host
            .registry()
            .execute(command, input, Some(context))
            .await
    }

    /// A person at the command line: `human:local`.
    pub async fn cli(&self, command: &str, input: Value) -> CommandResult<Value> {
        self.call(human("local"), CommandInterface::Cli, command, input)
            .await
    }

    /// The agent every loopback caller is.
    pub async fn agent(&self, command: &str, input: Value) -> CommandResult<Value> {
        self.call(agent("loopback"), CommandInterface::Mcp, command, input)
            .await
    }

    pub async fn sync(&self, input: Value) -> Value {
        let result = self.cli("sources-sync", input).await;
        assert!(result.success, "{result:?}");
        serde_json::to_value(result).unwrap()
    }

    /// Open the store of `space` read-only, for what the plugin wrote.
    pub fn store(&self, space: &str) -> Connection {
        Connection::open_with_flags(
            self.path(&format!("state/spaces/{space}/store/store.sqlite3")),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap()
    }

    /// The ids of the stored documents of `space`, sorted.
    pub fn ids(&self, space: &str) -> Vec<String> {
        if !self
            .path(&format!("state/spaces/{space}/store/store.sqlite3"))
            .exists()
        {
            return Vec::new();
        }
        let conn = self.store(space);
        let mut statement = conn
            .prepare("SELECT doc FROM documents ORDER BY doc")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    /// A stored document's record (without bytes).
    pub fn record(&self, space: &str, id: &str) -> Value {
        let text: String = self
            .store(space)
            .query_row("SELECT record FROM documents WHERE doc = ?1", [id], |row| {
                row.get(0)
            })
            .unwrap();
        serde_json::from_str(&text).unwrap()
    }

    pub fn access(&self, space: &str, id: &str) -> Vec<String> {
        let conn = self.store(space);
        let mut statement = conn
            .prepare("SELECT token FROM doc_access WHERE doc = ?1 ORDER BY token")
            .unwrap();
        statement
            .query_map([id], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    /// The store's head revision.
    pub fn head(&self, space: &str) -> i64 {
        if !self
            .path(&format!("state/spaces/{space}/store/store.sqlite3"))
            .exists()
        {
            return 0;
        }
        self.store(space)
            .query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    /// How many documents the store holds.
    pub fn documents(&self, space: &str) -> usize {
        self.ids(space).len()
    }

    /// The journal's entry count, to see that a call was journaled.
    pub fn journal_lines(&self) -> usize {
        std::fs::read_to_string(self.path("state/journal.jsonl"))
            .map(|text| text.lines().count())
            .unwrap_or(0)
    }
}

pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

pub fn agent(id: &str) -> Actor {
    Actor::new(ActorKind::Agent).with_id(id)
}

/// `data` of a successful result.
pub fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

/// The one collection's entry of a result.
pub fn collection<'a>(result: &'a Value, name: &str) -> &'a Value {
    data(result)["collections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["collection"] == name)
        .unwrap_or_else(|| panic!("no collection {name} in {result}"))
}

/// The warning with this code, if the result has one.
pub fn warning<'a>(result: &'a Value, code: &str) -> Option<&'a Value> {
    result["warnings"]
        .as_array()?
        .iter()
        .find(|warning| warning["code"] == code)
}

pub fn changed_ids(entry: &Value) -> Vec<String> {
    entry["changed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

pub fn failure_code(result: &CommandResult<Value>) -> String {
    assert!(!result.success, "{result:?}");
    result.error.as_ref().unwrap().code.clone()
}

pub fn json_of(result: CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

pub fn text(value: &Value) -> String {
    value.to_string()
}

pub fn no_object() -> Value {
    json!({})
}
