//! A workspace with the curator plugin and its grants, memory records and documents written
//! through the `umbel-store` API with fixed ids into the files the host then opens, a clock the
//! tests move by days, and the command line in process with a scripted terminal. No other plugin
//! is linked: the curator reads what the stores hold (D3).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};
use umbel_store::conformance::samples;
use umbel_store::memory::{
    Confirm, DAY_MS, Forget, Invalidate, InvalidationReason, format_instant,
};
use umbel_store::{
    AccessSet, AsOf, Authority, DocumentStore, Expect, ForgetSelector, MemoryClass, MemoryRecord,
    MemoryStore, MemoryWrite, Origin, ReadFlags, ReaderFilter, Sensitivity,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions};

/// When the records are written: 2026-01-01T00:00:00.000Z.
pub const T0: i64 = 1_767_225_600_000;
pub const DAY: i64 = DAY_MS;

/// The instant `days` after [`T0`].
pub fn day(days: i64) -> i64 {
    T0 + days * DAY
}

/// Spaces `main` (collections `notes`, readable by the space; `team`, by the group `platform`;
/// `open`, public; `code`, code) and `beta` (`notes`, with no curator target); the group
/// `platform` holding ada and local; the curator with its records allowed in both, its target in
/// `main` `notes/learned`, and `extra` appended to its configuration table. The command line is
/// the person `human:local`.
pub fn config(extra: &str) -> String {
    config_with(
        "[plugins.curator.config.spaces.main]\ncollection = \"notes\"\nprefix = \"learned\"\n",
        extra,
    )
}

/// [`config`] with `target` in place of the default target table.
pub fn config_with(target: &str, extra: &str) -> String {
    format!(
        r#"config_version = 4
default_space = "main"

[principal]
local_id = "local"

[spaces.main]
[spaces.main.collections.notes]
root = "spaces/main/notes"
[spaces.main.collections.team]
root = "spaces/main/team"
access = ["group:platform"]
[spaces.main.collections.open]
root = "spaces/main/open"
sensitivity = "public"
[spaces.main.collections.code]
root = "spaces/main/code"
kind = "code"

[spaces.beta]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

[access.groups.platform]
members = ["human:ada", "human:local"]

[plugins]
enabled = ["curator"]

[plugins.curator]
source = "compiled:curator"
[plugins.curator.grants.records_write]
allow = ["main", "beta"]

{target}
{extra}
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
        .with_compiled(Arc::new(sdk(umbel_plugin_curator::plugin())))
        .with_clock(fixed_clock(clock))
        .seal()
        .unwrap()
}

/// A person through the library.
pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
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

/// That `haystack` holds none of `needles`.
pub fn never_mentions(haystack: &str, needles: &[&str]) {
    for needle in needles {
        assert!(
            !haystack.contains(needle),
            "found {needle:?} where no memory text may be"
        );
    }
}

/// The `n`th memory id: `mem-` and `n` as 24 hex digits.
pub fn mem(n: u64) -> String {
    samples::memory_id(n)
}

/// A semantic fact `n` of `owner` in `main`, readable by `access`: authority `person`, origin
/// `user-stated`, tag `deploy`, confidence 0.8, observed in session `s1`, valid from [`T0`] and
/// expiring 400 days later. Edit fields, then pass it to [`Fx::remember`].
pub fn fact(n: u64, owner: &str, access: &[&str], subject: &str, text: &str) -> MemoryWrite {
    let mut entry = samples::memory_entry(n, owner, access, subject, text);
    entry.scope.space = "main".to_owned();
    entry.scope.session = Some("s1".to_owned());
    entry.tags = vec!["deploy".to_owned()];
    entry.valid_from = T0;
    entry.expires_at = T0 + 400 * DAY;
    entry.envelope.origin = Origin::UserStated;
    entry.envelope.observed_at = format_instant(T0);
    entry.envelope.confidence = Some(0.8);
    samples::set_authority(&mut entry, Authority::Person);
    samples::agree(&mut entry);
    entry
}

/// `entry` with `authority`.
pub fn with_authority(mut entry: MemoryWrite, authority: Authority) -> MemoryWrite {
    samples::set_authority(&mut entry, authority);
    if authority != Authority::Person {
        entry.envelope.origin = Origin::AgentInferred;
    }
    entry
}

/// `entry` as a procedure.
pub fn procedure(mut entry: MemoryWrite) -> MemoryWrite {
    entry.class = MemoryClass::Procedural;
    entry
}

/// `entry` with `constraints`.
pub fn constrained(mut entry: MemoryWrite, constraints: &[&str]) -> MemoryWrite {
    entry.envelope.constraints = Some(constraints.iter().map(|c| (*c).to_owned()).collect());
    entry
}

/// `entry` with `sensitivity`.
pub fn sensitive(mut entry: MemoryWrite, sensitivity: Sensitivity) -> MemoryWrite {
    entry.sensitivity = sensitivity;
    samples::agree(&mut entry);
    entry
}

/// `entry` in `session`, written as a new id `n`: written after the first, it is an observation
/// of the same record in another session.
pub fn again(entry: &MemoryWrite, n: u64, session: &str) -> MemoryWrite {
    let mut entry = entry.clone();
    entry.id = mem(n);
    entry.scope.session = Some(session.to_owned());
    samples::agree(&mut entry);
    entry
}

/// A reader that reads every record these tests write.
pub fn everyone() -> ReaderFilter {
    ReaderFilter::tokens([
        "space",
        "group:platform",
        "principal:human:ada",
        "principal:human:local",
        "principal:human:bo",
    ])
    .unwrap()
}

impl Fx {
    pub fn new() -> Self {
        Self::with(&config(""))
    }

    pub fn with(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        for root in [
            "main/notes",
            "main/team",
            "main/open",
            "main/code",
            "beta/notes",
        ] {
            std::fs::create_dir_all(dir.path().join("spaces").join(root)).unwrap();
        }
        let host = build(dir.path(), day(0));
        Self {
            dir,
            host,
            clock: day(0),
        }
    }

    /// Reopen the workspace with the clock at `clock`.
    pub fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.host = build(self.dir.path(), clock);
    }

    /// Replace the configuration and reopen.
    pub fn reconfigure(&mut self, config: &str) {
        std::fs::write(self.dir.path().join("umbel.toml"), config).unwrap();
        self.host = build(self.dir.path(), self.clock);
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    pub fn space_dir(&self, space: &str) -> PathBuf {
        self.dir.path().join("state/spaces").join(space)
    }

    fn memory_store(&self, space: &str) -> SqliteMemoryStore {
        SqliteMemoryStore::open(&self.space_dir(space), space, StoreOptions::default())
            .unwrap()
            .with_machine_backup_exclusion(false)
    }

    /// Write `entries` to `main`'s memory store at `at`, one batch each, then reopen.
    pub fn remember_at(&mut self, at: i64, entries: Vec<MemoryWrite>) {
        let store = self.memory_store("main");
        for entry in entries {
            store.write(samples::memory_batch(at, vec![entry])).unwrap();
        }
        drop(store);
        self.at(self.clock);
    }

    /// Write `entries` at [`T0`].
    pub fn remember(&mut self, entries: Vec<MemoryWrite>) {
        self.remember_at(T0, entries);
    }

    /// `entry` written at [`T0`] in session `s1` and observed an hour later in `s2`.
    pub fn remember_twice(&mut self, entry: MemoryWrite, second: u64) {
        let observed = again(&entry, second, "s2");
        self.remember_at(T0, vec![entry]);
        self.remember_at(T0 + 3_600_000, vec![observed]);
    }

    /// Record `id` as the store holds it now, flagged and expired included.
    pub fn record(&self, id: &str) -> MemoryRecord {
        let flags = ReadFlags {
            include_flagged: true,
            include_expired: true,
            now: self.clock,
        };
        self.memory_store("main")
            .get(id, AsOf::at(self.clock), flags, &everyone())
            .unwrap()
            .unwrap_or_else(|| panic!("no record {id}"))
    }

    /// Invalidate `id` as its owner at `at`.
    pub fn invalidate(&mut self, id: &str, owner: &str, at: i64) {
        self.memory_store("main")
            .invalidate(
                Invalidate {
                    id: id.to_owned(),
                    at,
                    valid_until: at,
                    by: owner.to_owned(),
                    reason: InvalidationReason::Outdated,
                    note: None,
                    expect_version: None,
                    trace_id: None,
                },
                &everyone(),
            )
            .unwrap();
        self.at(self.clock);
    }

    /// Confirm `id` as its owner at `at`, which writes a new version.
    pub fn confirm(&mut self, id: &str, owner: &str, at: i64) {
        let hash = self.record(id).content_hash.as_str().to_owned();
        self.memory_store("main")
            .confirm(
                Confirm {
                    id: id.to_owned(),
                    at,
                    by: owner.to_owned(),
                    content_hash: hash,
                    trace_id: None,
                },
                &everyone(),
            )
            .unwrap();
        self.at(self.clock);
    }

    /// Forget `id` as its owner.
    pub fn forget(&mut self, id: &str, owner: &str) {
        self.memory_store("main")
            .forget(Forget {
                owner: owner.to_owned(),
                selector: ForgetSelector::Ids(vec![id.to_owned()]),
                at: self.clock,
                trace_id: None,
            })
            .unwrap();
        self.at(self.clock);
    }

    /// Put a document `id` into `main`'s document store, readable by the space, then reopen.
    pub fn document(&mut self, id: &str) {
        {
            let store = SqliteStore::open(&self.space_dir("main"), "main", StoreOptions::default())
                .unwrap();
            let mut write = samples::document(id, &["space"], "# A document\n", "seed");
            write.space = "main".to_owned();
            write.envelope.space = "main".to_owned();
            store.put_document(write, Expect::Any).unwrap();
        }
        self.at(self.clock);
    }

    /// A raw record of the curator's namespace in `main`, as the store holds it.
    pub fn curator_record(&self, kind: &str, id: &str) -> Option<umbel_store::Record> {
        let store =
            SqliteStore::open(&self.space_dir("main"), "main", StoreOptions::default()).unwrap();
        store.get_record("curator", kind, id, &everyone()).unwrap()
    }

    /// Put a curator record straight into its namespace, as a run of step 5 or a library embedder
    /// (D14) writes one, then reopen.
    pub fn put_curator_record(&mut self, kind: &str, id: &str, body: Value, access: &[&str]) {
        {
            let store = SqliteStore::open(&self.space_dir("main"), "main", StoreOptions::default())
                .unwrap();
            let mut envelope = samples::envelope(access, "curator", &format_instant(self.clock));
            envelope.version = 2;
            envelope.space = "main".to_owned();
            envelope.plugin = Some("curator".to_owned());
            store
                .put_record("curator", kind, id, body, envelope, Expect::Any)
                .unwrap();
        }
        self.at(self.clock);
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

    /// `curator-candidates` as `actor` on the command-line interface, through the library.
    pub async fn candidates_as(&self, actor: Actor, input: Value) -> Value {
        self.call(actor, CommandInterface::Cli, "curator-candidates", input)
            .await
    }

    /// `curator-candidates` as the person `human:local`.
    pub async fn candidates(&self) -> Value {
        self.candidates_as(human("local"), json!({})).await
    }

    /// The candidates `curator-candidates` lists for `actor`.
    pub async fn rows_as(&self, actor: Actor) -> Vec<Value> {
        let result = self.candidates_as(actor, json!({ "limit": 500 })).await;
        data(&result)["candidates"].as_array().unwrap().clone()
    }

    /// The candidates `curator-candidates` lists for `human:local`.
    pub async fn rows(&self) -> Vec<Value> {
        self.rows_as(human("local")).await
    }

    /// The one candidate listed for `human:local`.
    pub async fn only(&self) -> Value {
        let rows = self.rows().await;
        assert_eq!(rows.len(), 1, "{rows:#?}");
        rows[0].clone()
    }

    /// Run the command line in process as `principal.local_id`, with `console` for a terminal and
    /// the environment variables `vars`.
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
                    .with_compiled(Arc::new(sdk(umbel_plugin_curator::plugin())))
                    .with_clock(fixed_clock(clock))
            },
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        let value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"));
        (code, value)
    }

    pub async fn command_line(&self, console: Arc<dyn Console>, args: &[&str]) -> (i32, Value) {
        self.command_line_with(console, args, &[]).await
    }

    /// `command` at a terminal where the person answers `answer`; the result and what was asked.
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

    /// Every byte of the journal, the log and the event streams, as text.
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

/// The access set `tokens`.
pub fn access(tokens: &[&str]) -> AccessSet {
    AccessSet::new(tokens.iter().copied()).unwrap()
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

/// A validator of `curator-record.v1.json`, with the report schema it refers to.
pub fn record_validator() -> jsonschema::Validator {
    let parse = |text: &str| -> Value { serde_json::from_str(text).unwrap() };
    let record = parse(include_str!("../../../../schemas/curator-record.v1.json"));
    let report = parse(include_str!("../../../../schemas/curator-report.v1.json"));
    let siblings = [&record, &report]
        .into_iter()
        .map(|schema| (schema["$id"].as_str().unwrap().to_owned(), schema.clone()))
        .collect();
    jsonschema::options()
        .with_retriever(Siblings(siblings))
        .build(&record)
        .unwrap()
}
