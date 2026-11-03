//! A workspace with the memory plugin and its grants, and the means to call it as a person
//! through the library (authority `person`), as an agent over MCP (`agent`), and at the command
//! line with no one at the terminal (`tool`).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

/// The host's clock: 2026-01-01T00:00:00Z.
pub const NOW: i64 = 1_767_225_600_000;
pub const DAY: i64 = 86_400_000;

/// Spaces `main` and `beta`, the group `platform` holding `human:ada`, and the memory plugin
/// with `memory_write` allowed in both, under `policy` (extra keys of the grant's table).
pub fn config(policy: &str) -> String {
    format!(
        r#"config_version = 4
default_space = "main"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.main]
[spaces.beta]

[access.groups.platform]
members = ["human:ada"]

[plugins]
enabled = ["memory"]

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["main", "beta"]
{policy}
"#
    )
}

pub struct Fx {
    pub dir: TempDir,
    pub host: Host,
    pub clock: i64,
}

pub fn build(dir: &Path, clock: i64) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_memory::plugin())))
        .with_clock(fixed_clock(clock))
        .seal()
        .unwrap()
}

impl Fx {
    pub fn new() -> Self {
        Self::with(&config(""))
    }

    pub fn with(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        let host = build(dir.path(), NOW);
        Self {
            dir,
            host,
            clock: NOW,
        }
    }

    /// Reopen the workspace with the clock at `clock`.
    pub fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.host = build(self.dir.path(), clock);
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    /// Override one of the plugin's packs in `space` with `file` holding `text`, and reopen.
    pub fn pack_override(&mut self, space: &str, pack: &str, file: &str, text: &str) {
        let manifest = match pack {
            "policy" => include_str!("../../packs/policy/pack.toml"),
            _ => include_str!("../../packs/hygiene/pack.toml"),
        };
        let dir = self.path(&format!("spaces/{space}/packs/memory/{pack}"));
        std::fs::create_dir_all(dir.join(file).parent().unwrap()).unwrap();
        std::fs::write(dir.join("pack.toml"), manifest).unwrap();
        std::fs::write(dir.join(file), text).unwrap();
        self.host = build(self.dir.path(), self.clock);
    }

    pub async fn call(
        &self,
        actor: Actor,
        interface: CommandInterface,
        command: &str,
        input: Value,
    ) -> Value {
        let context = self.host.context(actor).with_interface(interface);
        json_of(
            self.host
                .registry()
                .execute(command, input, Some(context))
                .await,
        )
    }

    /// A person through the library: the embedder's person, authority `person`.
    pub async fn person(&self, command: &str, input: Value) -> Value {
        self.call(human("ada"), CommandInterface::Mcp, command, input)
            .await
    }

    /// `actor` over MCP.
    pub async fn as_actor(&self, actor: Actor, command: &str, input: Value) -> Value {
        self.call(actor, CommandInterface::Mcp, command, input)
            .await
    }

    /// An agent acting for `ada` over MCP: authority `agent`, ada's records.
    pub async fn agent(&self, command: &str, input: Value) -> Value {
        self.as_actor(agent_for("bot", "ada"), command, input).await
    }

    /// The library's person through the command-line interface, for the commands exposed there
    /// alone (`memory-sweep`, `memory-reindex`): still the embedder's person, with no terminal mark.
    pub async fn cli_person(&self, command: &str, input: Value) -> Value {
        self.call(human("ada"), CommandInterface::Cli, command, input)
            .await
    }

    /// `command` as `actor` over MCP with an output budget of `ask` bytes.
    pub async fn with_budget(&self, actor: Actor, command: &str, input: Value, ask: u64) -> Value {
        let context = self
            .host
            .context(actor)
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(ask);
        json_of(
            self.host
                .registry()
                .execute(command, input, Some(context))
                .await,
        )
    }

    /// Run the command line in process, as `principal.local_id`, with `console` for a terminal.
    pub async fn command_line(&self, console: Arc<dyn Console>, args: &[&str]) -> (i32, Value) {
        self.command_line_with(console, args, &[]).await
    }

    /// The command line with these environment variables set (an agent's, say).
    pub async fn command_line_with(
        &self,
        console: Arc<dyn Console>,
        args: &[&str],
        vars: &[(&str, &str)],
    ) -> (i32, Value) {
        let mut environment = Environment::from_process();
        environment.cwd = self.dir.path().to_path_buf();
        environment.workspace = None;
        environment.console = console;
        environment.vars.clear();
        for (name, value) in vars {
            environment
                .vars
                .insert((*name).to_owned(), (*value).to_owned());
        }
        let clock = self.clock;
        let mut stdout = Vec::new();
        let code = umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder: HostBuilder| {
                builder
                    .with_compiled(Arc::new(sdk(umbel_plugin_memory::plugin())))
                    .with_clock(fixed_clock(clock))
            },
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        let value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"));
        (code, value)
    }

    /// `command` at the command line with no person at the terminal: authority `tool`.
    pub async fn script(&self, command: &str, input: Value) -> Value {
        let (_, value) = self
            .command_line(
                Terminal::new(false, false),
                &["call", command, &input.to_string()],
            )
            .await;
        value
    }

    /// `command` at a terminal where the person answers `answer`; what was asked.
    pub async fn terminal(
        &self,
        command: &str,
        input: Value,
        answer: bool,
    ) -> (Value, Vec<String>) {
        let console = Terminal::new(true, answer);
        let (_, value) = self
            .command_line(console.clone(), &["call", command, &input.to_string()])
            .await;
        (value, console.asked())
    }

    /// Remember as the library's person, asserting success; the record's id.
    pub async fn remember(&self, input: Value) -> String {
        let result = self.person("memory-remember", input).await;
        data(&result)["id"].as_str().unwrap().to_owned()
    }

    /// `memory-show` of `id` as the library's person: the result.
    pub async fn show(&self, id: &str) -> Value {
        self.person("memory-show", json!({ "id": id })).await
    }

    /// The stored record of `id`, as `memory-show` returns it.
    pub async fn record(&self, id: &str) -> Value {
        data(&self.show(id).await)["record"].clone()
    }

    /// The memory store's file `name` in `space` (`memory.sqlite3`, `memory.keys`).
    pub fn store_file(&self, space: &str, name: &str) -> PathBuf {
        self.path(&format!("state/spaces/{space}/store/{name}"))
    }

    /// Reopen the workspace, so no connection holds the store's files.
    pub fn reopen(&mut self) {
        self.host = build(self.dir.path(), self.clock);
    }

    /// A file-level copy of `main`'s memory file `name`, taken with no connection open (so its
    /// write-ahead log is folded in), as an outside backup would take it.
    pub fn copy_out(&mut self, name: &str) -> Vec<u8> {
        self.reopen();
        let wal = self.store_file("main", &format!("{name}-wal"));
        assert!(
            std::fs::metadata(&wal).map_or(true, |m| m.len() == 0),
            "{name} still has a write-ahead log"
        );
        std::fs::read(self.store_file("main", name)).unwrap()
    }

    /// Put a file-level copy back over `main`'s memory file `name`, with no connection open.
    pub fn put_back(&mut self, name: &str, bytes: &[u8]) {
        self.reopen();
        for suffix in ["-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(self.store_file("main", &format!("{name}{suffix}")));
        }
        std::fs::write(self.store_file("main", name), bytes).unwrap();
        self.reopen();
    }

    /// `command` at a terminal where the person answers yes, with `extra` arguments (`--yes`).
    pub async fn at_terminal(&self, command: &str, input: Value, extra: &[&str]) -> Value {
        let input = input.to_string();
        let mut args = vec!["call", command, input.as_str()];
        args.extend_from_slice(extra);
        self.command_line(Terminal::new(true, true), &args).await.1
    }

    pub fn events(&self, space: &str) -> Vec<Value> {
        let path = self.path(&format!("state/spaces/{space}/events.jsonl"));
        std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// Every byte of the event streams, the journal and the log, as text.
    pub fn journaled_text(&self) -> String {
        let mut text = String::new();
        for relative in ["state/journal.jsonl", "state/log.jsonl"] {
            text.push_str(&std::fs::read_to_string(self.path(relative)).unwrap_or_default());
        }
        for space in ["main", "beta"] {
            text.push_str(
                &std::fs::read_to_string(self.path(&format!("state/spaces/{space}/events.jsonl")))
                    .unwrap_or_default(),
            );
        }
        text
    }
}

/// A scripted terminal: whether a person can answer, what they answer, and what was asked.
pub struct Terminal {
    pub interactive: bool,
    pub answer: bool,
    pub asked: Mutex<Vec<String>>,
}

impl Terminal {
    pub fn new(interactive: bool, answer: bool) -> Arc<Self> {
        Arc::new(Self {
            interactive,
            answer,
            asked: Mutex::new(Vec::new()),
        })
    }

    pub fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

impl Console for Terminal {
    fn is_interactive(&self) -> bool {
        self.interactive
    }

    fn ask(&self, text: &str) -> bool {
        self.asked.lock().unwrap().push(text.to_owned());
        self.answer
    }
}

pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

pub fn agent_for(id: &str, person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(person)
}

pub fn json_of(result: CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

/// `data` of a successful result.
pub fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

/// The error code of a failed result.
pub fn code(result: &Value) -> &str {
    assert_eq!(result["success"], false, "{result}");
    result["error"]["code"].as_str().unwrap()
}

/// The warning with this code, if the result has one.
pub fn warning<'a>(result: &'a Value, code: &str) -> Option<&'a Value> {
    result["warnings"]
        .as_array()?
        .iter()
        .find(|warning| warning["code"] == code)
}

/// A fact to remember: class, subject and text, with `extra` merged in.
pub fn fact(subject: &str, text: &str, extra: Value) -> Value {
    let mut input = json!({ "class": "semantic", "subject": subject, "text": text });
    if let (Some(map), Some(more)) = (input.as_object_mut(), extra.as_object()) {
        for (key, value) in more {
            map.insert(key.clone(), value.clone());
        }
    }
    input
}

/// Panic if any needle appears in `haystack`.
pub fn never_mentions(haystack: &str, needles: &[&str]) {
    for needle in needles {
        assert!(
            !haystack.contains(needle),
            "`{needle}` appears in {haystack}"
        );
    }
}

/// The record's millisecond instant from its wire form.
pub fn millis(text: &Value) -> i64 {
    chrono_free_parse(text.as_str().unwrap())
}

/// Parse `YYYY-MM-DDTHH:MM:SS.fffZ` without a date library.
fn chrono_free_parse(text: &str) -> i64 {
    umbel_store::memory::parse_instant(text).unwrap()
}

struct Siblings(std::collections::BTreeMap<String, Value>);

impl jsonschema::Retrieve for Siblings {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("no schema file has the id {}", uri.as_str()).into())
    }
}

/// A validator of `memory-record.v1.json`, with the envelope it refers to.
pub fn record_validator() -> jsonschema::Validator {
    let parse = |text: &str| -> Value { serde_json::from_str(text).unwrap() };
    let record = parse(include_str!("../../../../schemas/memory-record.v1.json"));
    let envelope = parse(include_str!(
        "../../../../schemas/provenance-envelope.v2.json"
    ));
    let siblings = [&record, &envelope]
        .into_iter()
        .map(|schema| (schema["$id"].as_str().unwrap().to_owned(), schema.clone()))
        .collect();
    jsonschema::options()
        .with_retriever(Siblings(siblings))
        .build(&record)
        .unwrap()
}
