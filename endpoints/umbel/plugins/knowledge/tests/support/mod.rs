//! A workspace with collections, readers, groups and allow lists for the sources and knowledge
//! plugins, and the means to call them as different principals.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

/// Spaces `main` (collections `handbook`, `code`) and `beta` (`notes`); the group `platform` with
/// `human:ada` in it; both plugins enabled with their write grants allowed for both spaces.
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
enabled = ["sources", "knowledge"]

[plugins.sources]
source = "compiled:sources"

[plugins.sources.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.sources.grants.records_write]
allow = ["main", "beta"]

[plugins.knowledge]
source = "compiled:knowledge"

[plugins.knowledge.grants.index_write]
allow = ["main", "beta"]
[plugins.knowledge.grants.records_write]
allow = ["main", "beta"]
[plugins.knowledge.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.knowledge.grants.content_write]
allow = ["main/*", "beta/*"]
"#;

pub struct Fx {
    pub dir: TempDir,
    pub host: Host,
}

pub fn build(dir: &Path) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
        .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
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

    pub fn reopen(&mut self, config: &str) {
        std::fs::write(self.dir.path().join("umbel.toml"), config).unwrap();
        self.host = build(self.dir.path());
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    pub fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.path(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    /// Write a file of `main`'s `handbook` collection.
    pub fn handbook(&self, path: &str, text: &str) {
        self.write(&format!("spaces/main/handbook/{path}"), text.as_bytes());
    }

    /// Write a file of `beta`'s `notes` collection.
    pub fn note(&self, path: &str, text: &str) {
        self.write(&format!("spaces/beta/notes/{path}"), text.as_bytes());
    }

    pub fn remove(&self, relative: &str) {
        std::fs::remove_file(self.path(relative)).unwrap();
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

    /// Call as `actor` over MCP and return the result as JSON.
    pub async fn as_actor(&self, actor: Actor, command: &str, input: Value) -> Value {
        json_of(
            self.call(actor, CommandInterface::Mcp, command, input)
                .await,
        )
    }

    /// Call as `actor` over MCP, asking for an output budget of at most `ask` bytes.
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

    /// Run the command line in process from the workspace, as the person `principal.local_id`
    /// names, with `console` for a terminal; the JSON on stdout, and the exit code.
    pub async fn command_line(&self, console: Arc<dyn Console>, args: &[&str]) -> (i32, Value) {
        let mut environment = Environment::from_process();
        environment.cwd = self.dir.path().to_path_buf();
        environment.workspace = None;
        environment.console = console;
        let mut stdout = Vec::new();
        let code = umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            |builder: HostBuilder| {
                builder
                    .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
                    .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
                    .with_clock(fixed_clock(1_767_225_600_000))
            },
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        let value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"));
        (code, value)
    }

    /// Call `command` on the command line at a terminal where the person answers yes.
    pub async fn at_terminal(&self, command: &str, input: Value) -> Value {
        let console = Terminal::new(true, true);
        let (_, value) = self
            .command_line(console, &["call", command, &input.to_string()])
            .await;
        value
    }

    /// A person at the command line: `human:local`.
    pub async fn cli(&self, command: &str, input: Value) -> Value {
        json_of(
            self.call(human("local"), CommandInterface::Cli, command, input)
                .await,
        )
    }

    /// Read the files into the stores of `space` and index them, as a person at the command line.
    pub async fn refresh(&self, space: &str) {
        let sync = self.cli("sources-sync", json!({ "space": space })).await;
        assert_eq!(sync["success"], true, "{sync}");
        let index = self.cli("knowledge-index", json!({ "space": space })).await;
        assert_eq!(index["success"], true, "{index}");
    }

    /// Read the files into the stores of `space` and index them, as `actor`.
    pub async fn refresh_as(&self, actor: Actor, space: &str) {
        for command in ["sources-sync", "knowledge-index"] {
            let result = self
                .as_actor(actor.clone(), command, json!({ "space": space }))
                .await;
            assert_eq!(result["success"], true, "{command}: {result}");
        }
    }

    /// Search as `actor`.
    pub async fn search(&self, actor: Actor, input: Value) -> Value {
        self.as_actor(actor, "knowledge-search", input).await
    }

    /// The document stores' head revision of a space, from the SQLite file.
    pub fn state_dir(&self, space: &str) -> PathBuf {
        self.path(&format!("state/spaces/{space}"))
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

pub fn agent(id: &str) -> Actor {
    Actor::new(ActorKind::Agent).with_id(id)
}

/// `CONFIG` with `beta` readable only by the group `platform`.
pub fn config_with_private_beta() -> String {
    CONFIG.replace(
        "[spaces.beta]\n",
        "[spaces.beta]\nreaders = [\"group:platform\"]\n",
    )
}

/// A member of the group `platform`.
pub fn member() -> Actor {
    human("ada")
}

/// Somebody outside every group.
pub fn outsider() -> Actor {
    human("eval-reader")
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

/// The document ids of a search's hits, in order.
pub fn hit_ids(result: &Value) -> Vec<String> {
    data(result)["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| hit["doc"].as_str().unwrap().to_owned())
        .collect()
}

/// The warning with this code, if the result has one.
pub fn warning<'a>(result: &'a Value, code: &str) -> Option<&'a Value> {
    result["warnings"]
        .as_array()?
        .iter()
        .find(|warning| warning["code"] == code)
}

/// Panic if any needle appears anywhere in the rendered value.
pub fn never_mentions(value: &Value, needles: &[&str]) {
    let rendered = value.to_string();
    for needle in needles {
        assert!(
            !rendered.contains(needle),
            "`{needle}` appears in {rendered}"
        );
    }
}

/// Seed `space`'s graph the way step 7a's indexer will: for each `(origin, targets)`, the origin's
/// document node and a `links_to` edge to each target document, with the origin as the edge's
/// origin (so it is readable through the origin document's access set).
pub fn seed_links(fx: &Fx, space: &str, links: &[(&str, &[&str])]) {
    use umbel_store::{DocGraph, DocumentStore, Edge, GraphBatch, GraphStore, Node};
    use umbel_store_embedded::{SqliteStore, StoreOptions};

    let store = SqliteStore::open(&fx.state_dir(space), space, StoreOptions::default()).unwrap();
    let head = store.head().unwrap();
    let node = |doc: &str| Node {
        id: format!("doc:{doc}"),
        kind: "document".to_owned(),
        label: doc.to_owned(),
    };
    let batch = GraphBatch {
        entries: links
            .iter()
            .map(|(origin, targets)| {
                let mut nodes = vec![node(origin)];
                nodes.extend(targets.iter().map(|target| node(target)));
                let edges = targets
                    .iter()
                    .map(|target| Edge {
                        from: format!("doc:{origin}"),
                        to: format!("doc:{target}"),
                        kind: "links_to".to_owned(),
                        weight: 1,
                    })
                    .collect();
                ((*origin).to_owned(), Some(DocGraph { nodes, edges }))
            })
            .collect(),
    };
    let applied = store.applied().unwrap().max(head);
    store.apply(batch, applied).unwrap();
}
