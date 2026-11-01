//! The test kit (feature `testkit`, specification section 10.1): an in-process host with only the
//! plugin under test, for plugin crates' tests and the host's own.
//!
//! [`TestHost::compiled`] boots a temporary workspace with one space, `main`, and
//! `plugins.enabled = [<id>]`. Every call runs on a fixed clock (2026-01-01T00:00:00Z by default),
//! on every surface, so results compare.

pub mod mcp;

#[cfg(feature = "cli")]
use crate::cli::{Console, Environment};
use crate::plugins::{CompiledPlugin, PluginError};
#[cfg(feature = "cli")]
use crate::workspace::Overrides;
use crate::{Host, HostBuilder, HostError};
use afd::{
    Actor, ActorKind, CommandResult, JournalEntry, ReplayJournalOptions, ReplayReport, fixed_clock,
    parse_journal, replay_journal,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tempfile::TempDir;

pub use mcp::{Client as McpDriver, Era};

/// 2026-01-01T00:00:00Z, the default clock of every call.
pub const DEFAULT_CLOCK_MS: i64 = 1_767_225_600_000;

/// The id a test host's plugin instance has.
fn plugin_id(manifest: &str) -> Result<String, PluginError> {
    crate::plugins::embedded_id(manifest)
}

/// Where the plugin under test comes from.
#[derive(Clone)]
enum Source {
    Compiled(Arc<dyn CompiledPlugin>),
    Directory(PathBuf),
}

/// Boots a [`TestHost`].
pub struct TestHostBuilder {
    source: Source,
    config: toml::Table,
    keys: toml::Table,
    spaces: Vec<String>,
    clock: i64,
    overrides: Vec<PackOverride>,
}

/// A pack directory the workspace holds for one space (D46).
#[derive(Clone)]
struct PackOverride {
    space: String,
    pack: String,
    dir: PathBuf,
}

/// An in-process host and its temporary workspace.
pub struct TestHost {
    host: Host,
    dir: TempDir,
    plugin: Arc<dyn CompiledPlugin>,
    source: Source,
    instance: String,
    spaces: Vec<String>,
    config: toml::Table,
    keys: toml::Table,
    clock: i64,
    overrides: Vec<PackOverride>,
}

/// What the in-process CLI printed.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOutput {
    /// The exit code.
    pub code: i32,
    /// stdout: one JSON document.
    pub stdout: String,
}

#[cfg(feature = "cli")]
impl CliOutput {
    /// stdout parsed as the JSON document it is.
    ///
    /// # Panics
    /// When stdout is not one JSON document.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout).unwrap_or_else(|error| {
            panic!("stdout is not one JSON document ({error}): {}", self.stdout)
        })
    }
}

/// The result of [`TestHost::replay`].
#[derive(Debug, Clone)]
pub struct ReplayOutcome {
    /// AFD's report over the entries that were replayed.
    pub report: ReplayReport,
    /// The `seq` of each entry that was skipped because it is recorded only
    /// (`dev.umbel/replay = "recorded"`, a mounted result): the host never replays it.
    pub skipped: Vec<u64>,
}

/// A console with no person at it.
#[cfg(feature = "cli")]
struct NoPerson;

#[cfg(feature = "cli")]
impl Console for NoPerson {
    fn is_interactive(&self) -> bool {
        false
    }

    fn ask(&self, _text: &str) -> bool {
        false
    }
}

impl TestHost {
    /// A temporary workspace with one space `main`, `plugins.enabled = [<id>]` and nothing else.
    pub fn compiled(plugin: impl CompiledPlugin) -> TestHostBuilder {
        TestHostBuilder::new(Source::Compiled(Arc::new(plugin)))
    }

    /// The same with a plugin directory (a component, a mounted server or a pack), copied into
    /// the workspace as `plugins/<id>`.
    pub fn directory(path: impl AsRef<Path>) -> TestHostBuilder {
        TestHostBuilder::new(Source::Directory(path.as_ref().to_path_buf()))
    }

    /// The host.
    pub fn host(&self) -> &Host {
        &self.host
    }

    /// The workspace directory.
    pub fn workspace_dir(&self) -> &Path {
        self.dir.path()
    }

    /// The id of the plugin instance under test.
    pub fn instance(&self) -> &str {
        &self.instance
    }

    /// Call a command as the library principal.
    pub async fn call(&self, name: &str, input: Value) -> CommandResult<Value> {
        let actor = Actor::new(ActorKind::Test).with_id("testkit");
        self.host
            .registry()
            .execute(name, input, Some(self.host.context(actor)))
            .await
    }

    /// An MCP driver over the host's own server, on in-memory stdio in `era`.
    pub async fn mcp(&self, era: Era) -> McpDriver {
        McpDriver::connect(&self.host, mcp::Transport::Stdio, era).await
    }

    /// An MCP driver over the host's HTTP router, with the bearer token, in `era`.
    pub async fn http(&self, era: Era) -> McpDriver {
        McpDriver::connect(&self.host, mcp::Transport::Http, era).await
    }

    #[cfg(feature = "cli")]
    /// Run the CLI in process (`umbel::cli::run`) against the workspace, with the plugin and the
    /// fixed clock configured as in the host.
    pub async fn cli(&self, args: &[&str]) -> CliOutput {
        let environment = Environment {
            cwd: self.dir.path().to_path_buf(),
            workspace: None,
            overrides: Overrides::default(),
            console: Arc::new(NoPerson),
        };
        let plugin = matches!(self.source, Source::Compiled(_)).then(|| Arc::clone(&self.plugin));
        let clock = self.clock;
        let mut stdout = Vec::new();
        let code = crate::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder| {
                let builder = match plugin {
                    Some(plugin) => builder.with_compiled(plugin),
                    None => builder,
                };
                builder.with_clock(fixed_clock(clock))
            },
        )
        .await;
        CliOutput {
            code,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
        }
    }

    /// Replay the journal against a fresh host with the same plugin: `afd::replay_journal` for
    /// every entry, skipping the ones recorded only (`dev.umbel/replay = "recorded"`).
    ///
    /// # Errors
    /// The error of booting the fresh host.
    ///
    /// # Panics
    /// When the journal file cannot be parsed.
    pub async fn replay(&self) -> Result<ReplayOutcome, HostError> {
        let journal = self.dir.path().join("state/journal.jsonl");
        let text = std::fs::read_to_string(journal).unwrap_or_default();
        let entries = parse_journal(&text).unwrap_or_else(|error| panic!("{error}"));
        let (recorded, replayable): (Vec<JournalEntry>, Vec<JournalEntry>) =
            entries.into_iter().partition(|entry| {
                entry
                    .result
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.extra.get("dev.umbel/replay"))
                    .and_then(Value::as_str)
                    == Some("recorded")
            });
        let fresh = TestHostBuilder {
            source: self.source.clone(),
            config: self.config.clone(),
            keys: self.keys.clone(),
            spaces: self.spaces.clone(),
            clock: self.clock,
            overrides: self.overrides.clone(),
        }
        .boot()?;
        let report = replay_journal(
            &fresh.host.registry(),
            &replayable,
            ReplayJournalOptions::default(),
        )
        .await;
        Ok(ReplayOutcome {
            report,
            skipped: recorded.iter().map(|entry| entry.seq).collect(),
        })
    }
}

impl TestHostBuilder {
    fn new(source: Source) -> Self {
        Self {
            source,
            config: toml::Table::new(),
            keys: toml::Table::new(),
            spaces: vec!["main".to_owned()],
            clock: DEFAULT_CLOCK_MS,
            overrides: Vec::new(),
        }
    }

    /// The instance configuration, `[plugins.<id>.config]`.
    #[must_use]
    pub fn config(mut self, table: toml::Table) -> Self {
        self.config = table;
        self
    }

    /// More keys of the instance's table, beside `source` and `config`: `prefix`, `url`,
    /// `bearer_env`, `env`, `required`, `max_result_bytes` and the like.
    #[must_use]
    pub fn instance_keys(mut self, keys: toml::Table) -> Self {
        self.keys = keys;
        self
    }

    /// The workspace's declared spaces; the first is the default space, and the instance is
    /// enabled for all of them.
    #[must_use]
    pub fn spaces(mut self, ids: &[&str]) -> Self {
        self.spaces = ids.iter().map(|id| (*id).to_owned()).collect();
        self
    }

    /// Give `space` its own copy of the plugin's pack `pack`: the directory `dir` is copied to
    /// `spaces/<space>/packs/<plugin id>/<pack>/` and replaces the plugin's default pack whole in
    /// that space (D46). The space must be one of [`spaces`](Self::spaces).
    #[must_use]
    pub fn pack_override(mut self, space: &str, pack: &str, dir: impl AsRef<Path>) -> Self {
        self.overrides.push(PackOverride {
            space: space.to_owned(),
            pack: pack.to_owned(),
            dir: dir.as_ref().to_path_buf(),
        });
        self
    }

    /// The clock of every call, in epoch milliseconds: fixed by default (2026-01-01T00:00:00Z),
    /// so results compare.
    #[must_use]
    pub fn clock(mut self, epoch_ms: i64) -> Self {
        self.clock = epoch_ms;
        self
    }

    /// Write the workspace and seal the host.
    ///
    /// # Errors
    /// The error of sealing, such as a plugin that fails to load.
    ///
    /// # Panics
    /// When the temporary workspace cannot be written, or the plugin's manifest has no
    /// readable id.
    pub fn boot(self) -> Result<TestHost, HostError> {
        let dir =
            tempfile::tempdir().unwrap_or_else(|error| panic!("temporary workspace: {error}"));
        let (id, plugin, source) = match &self.source {
            Source::Compiled(plugin) => {
                let id = plugin_id(plugin.manifest()).unwrap_or_else(|error| panic!("{error}"));
                (id.clone(), Arc::clone(plugin), format!("compiled:{id}"))
            }
            Source::Directory(path) => {
                let manifest = std::fs::read_to_string(path.join("umbel-plugin.toml"))
                    .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
                let id = plugin_id(&manifest).unwrap_or_else(|error| panic!("{error}"));
                copy_dir(path, &dir.path().join("plugins").join(&id));
                (
                    id.clone(),
                    Arc::new(NoCode) as Arc<dyn CompiledPlugin>,
                    format!("plugins/{id}"),
                )
            }
        };
        let mut config = toml::Table::new();
        config.insert("config_version".into(), 2.into());
        if let Some(first) = self.spaces.first() {
            config.insert("default_space".into(), first.clone().into());
        }
        let mut spaces = toml::Table::new();
        for space in &self.spaces {
            spaces.insert(space.clone(), toml::Table::new().into());
        }
        config.insert("spaces".into(), spaces.into());
        let mut instance = toml::Table::new();
        instance.insert("source".into(), source.into());
        if !self.config.is_empty() {
            instance.insert("config".into(), self.config.clone().into());
        }
        instance.extend(self.keys.clone());
        let mut plugins = toml::Table::new();
        plugins.insert("enabled".into(), vec![id.clone()].into());
        plugins.insert(id.clone(), instance.into());
        config.insert("plugins".into(), plugins.into());
        for over in &self.overrides {
            let target = dir
                .path()
                .join("spaces")
                .join(&over.space)
                .join("packs")
                .join(&id)
                .join(&over.pack);
            copy_dir(&over.dir, &target);
        }
        let text = toml::to_string(&config).unwrap_or_else(|error| panic!("{error}"));
        std::fs::write(dir.path().join("umbel.toml"), text)
            .unwrap_or_else(|error| panic!("umbel.toml: {error}"));

        let mut builder = HostBuilder::open(dir.path())?.with_clock(fixed_clock(self.clock));
        if matches!(self.source, Source::Compiled(_)) {
            builder = builder.with_compiled(Arc::clone(&plugin));
        }
        let host = builder.seal()?;
        Ok(TestHost {
            host,
            dir,
            plugin,
            source: self.source,
            instance: id,
            spaces: self.spaces,
            config: self.config,
            keys: self.keys,
            clock: self.clock,
            overrides: self.overrides,
        })
    }
}

/// The plugin of a directory source: it has no compiled code.
struct NoCode;

impl CompiledPlugin for NoCode {
    fn manifest(&self) -> &str {
        ""
    }

    fn commands(
        &self,
        _services: crate::plugins::Services,
    ) -> Result<Vec<crate::plugins::PluginCommand>, PluginError> {
        Ok(Vec::new())
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap_or_else(|error| panic!("{}: {error}", to.display()));
    for entry in std::fs::read_dir(from)
        .unwrap_or_else(|error| panic!("{}: {error}", from.display()))
        .flatten()
    {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target)
                .unwrap_or_else(|error| panic!("{}: {error}", target.display()));
        }
    }
}
