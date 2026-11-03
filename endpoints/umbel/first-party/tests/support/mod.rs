//! The phase 3 exit tests' workspace (specification section 12): the four first-party plugins
//! together, as only this crate links them (D80), called as library actors (exact until phase 5),
//! through the command line in process with a scripted terminal, or through the real binary
//! (`binary`). `probes` holds the leak probes, which `leak_probes.rs` runs on a workspace of its
//! own and `exit_memory.rs` on the exit's stores.
#![allow(
    dead_code,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::missing_panics_doc
)]

pub mod binary;
pub mod probes;
pub mod stores;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

/// The frozen clock: 2026-11-03T12:00:00.000Z, after the fixture transcript's turns.
pub const CLOCK: i64 = 1_793_707_200_000;
pub const MINUTE: i64 = 60_000;
pub const HOUR: i64 = 3_600_000;
pub const DAY: i64 = 86_400_000;

/// What a workspace holds beyond the base: spaces `alpha` and `beta` (readable by `human:ada`
/// alone), the groups `platform` (ada and bo) and the memory and context plugins.
#[derive(Default, Clone)]
pub struct Options {
    /// Extra keys of the `memory_write` grant's table (`default_access = "space"`).
    pub policy: String,
    /// The context plugin's `[plugins.context.config]` keys.
    pub context: String,
    /// The members of the group `platform`; default ada and bo.
    pub platform: Option<String>,
    /// The `sources` and `knowledge` plugins, with a `handbook` collection in `alpha`.
    pub knowledge: bool,
}

pub fn config(options: &Options) -> String {
    let platform = options
        .platform
        .clone()
        .unwrap_or_else(|| r#"["human:ada", "human:bo"]"#.to_owned());
    let (collection, enabled, knowledge) = if options.knowledge {
        (
            "[spaces.alpha.collections.handbook]\nroot = \"spaces/alpha/handbook\"\n",
            r#"["sources", "knowledge", "memory", "context"]"#,
            r#"
[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["alpha/*"]
[plugins.sources.grants.records_write]
allow = ["alpha"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha"]
[plugins.knowledge.grants.records_write]
allow = ["alpha"]
"#,
        )
    } else {
        ("", r#"["memory", "context"]"#, "")
    };
    let context = if options.context.is_empty() {
        String::new()
    } else {
        format!("[plugins.context.config]\n{}\n", options.context)
    };
    format!(
        r#"config_version = 4
default_space = "alpha"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.alpha]
{collection}
[spaces.beta]
readers = ["human:ada"]

[access.groups.platform]
members = {platform}

[plugins]
enabled = {enabled}
{knowledge}
[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["alpha", "beta"]
{policy}

[plugins.context]
source = "compiled:context"
{context}"#,
        policy = options.policy,
    )
}

/// The four first-party plugins, as the binary compiles them in.
pub fn with_plugins(builder: HostBuilder) -> HostBuilder {
    builder
        .with_compiled(sdk(umbel_plugin_sources_filesystem::plugin()))
        .with_compiled(sdk(umbel_plugin_knowledge::plugin()))
        .with_compiled(sdk(umbel_plugin_memory::plugin()))
        .with_compiled(sdk(umbel_plugin_context::plugin()))
}

/// A workspace directory and its host, on a fixed clock.
pub struct Ws {
    pub dir: PathBuf,
    host: Option<Host>,
    pub clock: i64,
    _temp: Option<tempfile::TempDir>,
}

impl Ws {
    /// A fresh workspace with `options`.
    pub fn new(options: &Options) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("ws");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("umbel.toml"), config(options)).unwrap();
        let mut ws = Self::open(&dir, CLOCK);
        ws._temp = Some(temp);
        ws
    }

    /// A host on an existing workspace directory.
    pub fn open(dir: &Path, clock: i64) -> Self {
        Self {
            dir: dir.to_path_buf(),
            host: Some(build(dir, clock)),
            clock,
            _temp: None,
        }
    }

    /// Reopen with the clock at `clock`, so the host reads the configuration and stores anew.
    pub fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.host = None;
        self.host = Some(build(&self.dir, clock));
    }

    /// The host.
    pub fn host(&self) -> &Host {
        self.host.as_ref().expect("the host is open")
    }

    /// Close the host, so no connection holds the stores' files, run `f`, and reopen.
    pub fn closed<T>(&mut self, f: impl FnOnce(&Path) -> T) -> T {
        self.host = None;
        let out = f(&self.dir);
        self.reopen();
        out
    }

    pub fn reopen(&mut self) {
        self.at(self.clock);
    }

    /// Rewrite `umbel.toml` and reopen.
    pub fn reconfigure(&mut self, text: &str) {
        std::fs::write(self.dir.join("umbel.toml"), text).unwrap();
        self.reopen();
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.join(relative)
    }

    /// A space's store directory, where `memory.sqlite3` and `memory.keys` live.
    pub fn store_dir(&self, space: &str) -> PathBuf {
        self.path(&format!("state/spaces/{space}/store"))
    }

    pub async fn call_on(
        &self,
        actor: Actor,
        interface: CommandInterface,
        command: &str,
        input: Value,
    ) -> Value {
        let context = self.host().context(actor).with_interface(interface);
        json_of(
            self.host()
                .registry()
                .execute(command, input, Some(context))
                .await,
        )
    }

    /// `actor` over MCP, as the library sees it.
    pub async fn call(&self, actor: Actor, command: &str, input: Value) -> Value {
        self.call_on(actor, CommandInterface::Mcp, command, input)
            .await
    }

    /// `actor` through the command-line interface, for the commands exposed there alone.
    pub async fn cli(&self, actor: Actor, command: &str, input: Value) -> Value {
        self.call_on(actor, CommandInterface::Cli, command, input)
            .await
    }

    /// Remember as `actor`, asserting success; the record's id.
    pub async fn remember(&self, actor: Actor, input: Value) -> String {
        let result = self.call(actor, "memory-remember", input).await;
        data(&result)["id"].as_str().unwrap().to_owned()
    }

    /// The command line in process, as `principal.local_id`, with `console` for a terminal and
    /// `vars` as its environment variables.
    pub async fn command_line(
        &self,
        console: Arc<dyn Console>,
        args: &[&str],
        vars: &[(&str, &str)],
    ) -> Value {
        let mut environment = Environment::from_process();
        environment.cwd.clone_from(&self.dir);
        environment.workspace = None;
        environment.console = console;
        environment.vars.clear();
        for (name, value) in vars {
            environment
                .vars
                .insert((*name).to_owned(), (*value).to_owned());
        }
        environment.clock = Some(self.clock);
        let clock = self.clock;
        let mut stdout = Vec::new();
        umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder: HostBuilder| with_plugins(builder).with_clock(fixed_clock(clock)),
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"))
    }

    /// `command` at the command line with no one at the terminal: a script, authority `tool`.
    pub async fn script(&self, command: &str, input: Value) -> Value {
        self.command_line(
            Terminal::new(false, false),
            &["call", command, &input.to_string()],
            &[],
        )
        .await
    }

    /// `command` at a terminal where the person answers `answer`; the result and what was asked.
    pub async fn terminal(
        &self,
        command: &str,
        input: Value,
        answer: bool,
        vars: &[(&str, &str)],
    ) -> (Value, Vec<String>) {
        let console = Terminal::new(true, answer);
        let result = self
            .command_line(
                console.clone(),
                &["call", command, &input.to_string()],
                vars,
            )
            .await;
        (result, console.asked())
    }

    /// Every byte of the journal, the log and both spaces' event streams, as text.
    pub fn journaled_text(&self) -> String {
        let mut text = String::new();
        for relative in [
            "state/journal.jsonl",
            "state/log.jsonl",
            "state/spaces/alpha/events.jsonl",
            "state/spaces/beta/events.jsonl",
        ] {
            text.push_str(&std::fs::read_to_string(self.path(relative)).unwrap_or_default());
        }
        text
    }

    /// The events of `space`'s stream, as written.
    pub fn events(&self, space: &str) -> Vec<Value> {
        events_of(&self.dir, space)
    }
}

pub fn build(dir: &Path, clock: i64) -> Host {
    with_plugins(HostBuilder::open(dir).unwrap())
        .with_clock(fixed_clock(clock))
        .seal()
        .unwrap()
}

/// The events of `space`'s stream in the workspace at `dir`.
pub fn events_of(dir: &Path, space: &str) -> Vec<Value> {
    std::fs::read_to_string(dir.join(format!("state/spaces/{space}/events.jsonl")))
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// A scripted terminal: whether a person can answer, what they answer, and what was asked.
pub struct Terminal {
    interactive: bool,
    answer: bool,
    asked: Mutex<Vec<String>>,
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

/// A person through the library: authority `person` (section 3.3).
pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

/// An agent acting for `person`: authority `agent`, the person's records.
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

/// A semantic fact: subject and text, with `extra` merged in.
pub fn fact(subject: &str, text: &str, extra: Value) -> Value {
    let mut input = json!({ "class": "semantic", "subject": subject, "text": text });
    if let (Some(map), Some(more)) = (input.as_object_mut(), extra.as_object()) {
        for (key, value) in more {
            map.insert(key.clone(), value.clone());
        }
    }
    input
}

/// The ids of a recall's hits or a list's items.
pub fn ids(result: &Value) -> Vec<String> {
    let d = data(result);
    d.get("hits")
        .or_else(|| d.get("items"))
        .or_else(|| d.get("records"))
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

/// The ids of a bundle section's items, without the `<space>:` prefix; empty when the section
/// is not in the bundle.
pub fn section(result: &Value, name: &str) -> Vec<String> {
    data(result)["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .map(|s| {
            s["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| {
                    let id = item["id"].as_str().unwrap();
                    id.split_once(':').map_or(id, |(_, id)| id).to_owned()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Every item id of a bundle, in every section.
pub fn bundled(result: &Value) -> Vec<String> {
    ["knowledge", "semantic", "procedural", "episodic"]
        .iter()
        .flat_map(|name| section(result, name))
        .collect()
}

/// The count of the one omission with this section and reason, 0 when there is none.
pub fn omitted_count(result: &Value, section: &str, reason: &str) -> u64 {
    data(result)["omissions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["section"] == section && o["reason"] == reason)
        .map_or(0, |o| o["count"].as_u64().unwrap_or(0))
}

/// The omissions with this reason, any section.
pub fn omitted<'a>(result: &'a Value, reason: &str) -> Vec<&'a Value> {
    data(result)["omissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["reason"] == reason)
        .collect()
}

/// What a caller sees of a result: success, data, error and warnings, without the trace,
/// timings and other metadata that differ between any two calls.
pub fn seen(result: &Value) -> Value {
    json!({
        "success": result["success"],
        "data": result["data"],
        "error": result["error"],
        "warnings": result["warnings"],
    })
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

/// Every regular file under `dir`, recursively.
pub fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries {
        let path = entry.unwrap().path();
        let meta = std::fs::symlink_metadata(&path).unwrap();
        if meta.is_dir() {
            out.extend(files(&path));
        } else if meta.is_file() {
            out.push(path);
        }
    }
    out.sort();
    out
}

/// The files under `dir` whose raw bytes hold any of `needles`, with the needle.
pub fn holding(dir: &Path, needles: &[Vec<u8>]) -> Vec<(PathBuf, String)> {
    let mut found = Vec::new();
    for path in files(dir) {
        let bytes = std::fs::read(&path).unwrap_or_default();
        for needle in needles {
            if !needle.is_empty() && bytes.windows(needle.len()).any(|w| w == needle.as_slice()) {
                found.push((path.clone(), String::from_utf8_lossy(needle).into_owned()));
            }
        }
    }
    found
}

/// Needles as bytes.
pub fn needles(words: &[&str]) -> Vec<Vec<u8>> {
    words.iter().map(|w| w.as_bytes().to_vec()).collect()
}

struct Siblings;

impl jsonschema::Retrieve for Siblings {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err(format!("the bundle schema refers to nothing else: {}", uri.as_str()).into())
    }
}

/// Assert a bundle's `data` validates against `context-bundle.v1.json`.
pub fn valid_bundle(bundle: &Value) {
    let schema: Value =
        serde_json::from_str(include_str!("../../../schemas/context-bundle.v1.json")).unwrap();
    let validator = jsonschema::options()
        .with_retriever(Siblings)
        .build(&schema)
        .unwrap();
    let errors: Vec<String> = validator
        .iter_errors(bundle)
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?} in {bundle}");
}

/// Letters porter does not stem away: no vowels, no `y`, no `s`.
const LETTERS: &[u8] = b"bcdfghjklmnpqrtvwxz";

/// A fresh random canary starting with `first`: lowercase, twelve letters, unstemmable, so
/// canaries of different fields share no prefix (section 7.4).
pub fn canary(first: char) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u32(u32::from(first));
    let mut bits = hasher.finish();
    let mut out = String::from(first);
    while out.len() < 12 {
        if bits == 0 {
            let mut more = RandomState::new().build_hasher();
            more.write_usize(out.len());
            bits = more.finish();
        }
        out.push(char::from(LETTERS[(bits % LETTERS.len() as u64) as usize]));
        bits /= LETTERS.len() as u64;
    }
    out
}

/// Section 5.4's restore by hand, with no connection open: remove `memory.sqlite3-wal` and
/// `-shm` (SQLite would replay a stale WAL into the copy), then copy the backup's
/// `memory.sqlite3` into place, mode `0600`, beside the current key file.
pub fn restore_memory(store_dir: &Path, backup: &Path) {
    let db = store_dir.join("memory.sqlite3");
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", db.display()));
    }
    let bytes = std::fs::read(backup.join("memory.sqlite3")).unwrap();
    std::fs::remove_file(&db).unwrap();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&db).unwrap();
    std::io::Write::write_all(&mut file, &bytes).unwrap();
    file.sync_all().unwrap();
}

/// The key file's entry of each id: `(destroyed, settled)`, `None` when there is no entry.
pub fn markers(store_dir: &Path, ids: &[String]) -> Vec<Option<(bool, bool)>> {
    let raw = rusqlite::Connection::open(store_dir.join("memory.keys")).unwrap();
    ids.iter()
        .map(|id| {
            raw.query_row(
                "SELECT key IS NULL, settled FROM record_keys WHERE id = ?1",
                [id],
                |r| Ok((r.get::<_, bool>(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .ok()
        })
        .collect()
}

/// The live keys of `ids`, as stored in the key file.
pub fn keys_of(store_dir: &Path, ids: &[String]) -> Vec<Vec<u8>> {
    let raw = rusqlite::Connection::open(store_dir.join("memory.keys")).unwrap();
    ids.iter()
        .map(|id| {
            raw.query_row("SELECT key FROM record_keys WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
        })
        .collect()
}
