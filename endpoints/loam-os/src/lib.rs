//! The Loam OS host's plugin: the commands that govern machines, compiled into the `loam-os`
//! binary on Umbel's host library (the [Loam OS proposal](../../docs/features/active/loam-os/loam-os.proposal.md)).
//!
//! It ships `host-status` and the configuration checks `workspace-doctor` runs, and keeps the
//! host's records of machines and runs ([`records`]). The plugin owns the `host`, `machine`, `run`
//! and `checkpoint` domains; their other commands arrive in the later steps of M1 and in M2.
#![forbid(unsafe_code)]

pub mod config;
pub mod records;
pub mod runtime;
pub mod source;
mod status;

use std::sync::Arc;
use std::time::Duration;

use afd::{Actor, ActorKind, CommandResult};
use serde_json::{Value, json};
use umbel::{HostBuilder, JournalHealth, JournalPolicies, JournalPolicy};
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};

use config::Config;
use records::{FileRecords, Records};
use runtime::{CliRuntime, Runtime};
use source::Source;

/// The manifest of the compiled plugin.
pub const MANIFEST: &str = include_str!("../manifests/compiled.toml");

/// The plugin's id, and the instance id `umbel.toml` enables it under.
pub const PLUGIN_ID: &str = "loamos";

/// The name the host announces over MCP and in `host-status`.
pub const HOST_NAME: &str = "loam-os";

/// The host's version.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Each command's journal policy (Umbel D208, D221, D224): what starts something is
/// `required`, what stops something `buffered`, and reads `droppable`. Every command the plugin
/// serves has one, set as the command is added.
pub const JOURNAL_POLICIES: [(&str, JournalPolicy); 1] =
    [("host-status", JournalPolicy::Droppable)];

/// What a `JOURNAL_UNAVAILABLE` refusal tells the caller to do.
pub const JOURNAL_SUGGESTION: &str = "The host's journal cannot be written, so nothing new is started. Call host-status to see the journal's state, and free its disk or its lock; reads and stops still run.";

/// The plugin. With no runtime given it drives the configured runtime's command line on each
/// call; a test gives it fakes of its own.
#[derive(Clone, Default)]
pub struct LoamOs {
    runtime: Option<Arc<dyn Runtime>>,
    source: Option<Arc<dyn Source>>,
    records: Option<Arc<dyn Records>>,
    journal: Option<JournalHealth>,
}

impl std::fmt::Debug for LoamOs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoamOs")
            .field(
                "runtime",
                &self
                    .runtime
                    .as_ref()
                    .map(|runtime| runtime.kind().to_owned()),
            )
            .field("source", &self.source.is_some())
            .field("records", &self.records.is_some())
            .field("journal", &self.journal)
            .finish()
    }
}

/// The plugin, driving the configured runtime.
pub fn plugin() -> LoamOs {
    LoamOs::default()
}

impl LoamOs {
    /// The plugin, driving `runtime` instead of the configured one.
    #[must_use]
    pub fn with_runtime(mut self, runtime: Arc<dyn Runtime>) -> Self {
        self.runtime = Some(runtime);
        self
    }

    /// The plugin, reading commits from `source` instead of the repositories' configured ones.
    #[must_use]
    pub fn with_source(mut self, source: Arc<dyn Source>) -> Self {
        self.source = Some(source);
        self
    }

    /// The plugin, keeping its records in `records` instead of the workspace's state.
    #[must_use]
    pub fn with_records(mut self, records: Arc<dyn Records>) -> Self {
        self.records = Some(records);
        self
    }

    /// The plugin, reporting the journal through `health` (Umbel's required mode).
    #[must_use]
    pub fn with_journal(mut self, health: JournalHealth) -> Self {
        self.journal = Some(health);
        self
    }

    fn runtime(&self, config: &Config) -> Arc<dyn Runtime> {
        match &self.runtime {
            Some(runtime) => Arc::clone(runtime),
            None => Arc::new(CliRuntime::new(
                config.runtime.kind.as_str(),
                config.runtime.program(),
                Duration::from_millis(config.runtime.timeout_ms),
            )),
        }
    }
}

/// The host's journal policies, one per command ([`JOURNAL_POLICIES`]), writing to the
/// workspace's own write-ahead file. A test adds storage of its own with
/// [`JournalPolicies::with_storage`].
pub fn journal_policies() -> JournalPolicies {
    JOURNAL_POLICIES
        .iter()
        .fold(JournalPolicies::new(), |policies, (command, policy)| {
            policies.with(*command, *policy)
        })
        .with_unavailable_suggestion(JOURNAL_SUGGESTION)
}

/// Whether the workspace enables the plugin: an instance named for it with no source of its own
/// (the default rule), or one whose source is the compiled plugin.
fn enabled(builder: &HostBuilder) -> bool {
    let compiled = format!("compiled:{PLUGIN_ID}");
    builder
        .workspace()
        .config()
        .plugins
        .instances
        .iter()
        .any(|instance| {
            (instance.id == PLUGIN_ID && instance.source.is_none())
                || instance.source.as_deref() == Some(compiled.as_str())
        })
}

/// Build the host around `plugin`: the compiled plugin, its records in the workspace's state
/// unless it has its own, the journal policies with their health handed to the plugin, and the
/// server's identity. The binary and the tests both build it here, so they build the same host.
///
/// A workspace that does not enable the plugin gets no journal policies, since Umbel refuses a
/// policy for a command it does not register (D224).
pub fn install(builder: HostBuilder, plugin: LoamOs, policies: JournalPolicies) -> HostBuilder {
    let mut plugin = plugin;
    if plugin.records.is_none() {
        plugin.records = Some(Arc::new(FileRecords::in_state(
            &builder.workspace().state_dir(),
        )));
    }
    let builder = if enabled(&builder) {
        plugin.journal = Some(policies.health());
        builder.with_journal_policies(policies)
    } else {
        builder
    };
    builder
        .with_compiled(umbel::plugins::sdk(plugin))
        .with_server_identity(HOST_NAME, HOST_VERSION)
}

/// Call `command` as the host's own `service` actor `service` (the supervisor, the reaper),
/// through the registry like any caller's call, so it has a dispatch id of its own (Umbel D221)
/// and is in the journal and the event log beside its callers' (the proposal's job 11).
pub async fn call_as_service(
    host: &umbel::Host,
    service: &str,
    command: &str,
    input: Value,
) -> CommandResult<Value> {
    let actor = Actor::new(ActorKind::Service).with_id(service);
    host.registry()
        .execute(command, input, Some(host.context(actor)))
        .await
}

/// The configuration, or the refusal a command answers when it cannot be read.
fn read_config(cx: &Cx) -> Result<Config, Outcome> {
    let value = cx.config().map_err(|error| {
        failure(
            "HOST_CONFIG_UNREADABLE",
            &format!("the host's configuration cannot be read: {error}"),
            "Enable the loamos plugin with its config grant, and do not deny it.",
        )
    })?;
    Config::from_value(value).map_err(|message| {
        failure(
            "HOST_CONFIG_INVALID",
            &format!("the host's configuration does not have the expected shape: {message}"),
            "Fix [plugins.loamos.config] in umbel.toml against schemas/config.schema.json, then run workspace-doctor.",
        )
    })
}

impl Plugin for LoamOs {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "host-status" => match read_config(cx) {
                Ok(config) => status::host_status(
                    &config,
                    self.runtime(&config).as_ref(),
                    self.records.as_deref(),
                    self.journal.as_ref(),
                ),
                Err(refusal) => refusal,
            },
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the Loam OS host has no command `{other}`"),
                "Call host-status, or afd-discover for the host's commands.",
            ),
        }
    }

    fn check_config(&self, cx: &mut Cx) -> Option<Outcome> {
        let config = match read_config(cx) {
            Ok(config) => config,
            Err(refusal) => return Some(refusal),
        };
        let problems = config.problems();
        if let Some(first) = problems.first() {
            let count = problems.len();
            let message = if count == 1 {
                first.message.clone()
            } else {
                format!("{} (and {} more problem(s))", first.message, count - 1)
            };
            return Some(
                failure(
                    "HOST_CONFIG_INVALID",
                    &message,
                    "Fix each problem at its pointer in [plugins.loamos.config], then run workspace-doctor again.",
                )
                .with_error_details(json!({
                    "problems": problems.iter().map(config::Problem::to_value).collect::<Vec<_>>(),
                    "count": count,
                })),
            );
        }
        // The runtime last: a configuration that is right but whose runtime is down is a warning
        // (retryable), not a failure.
        let runtime = self.runtime(&config);
        if let Err(error) = runtime.version() {
            return Some(
                failure(
                    "RUNTIME_UNAVAILABLE",
                    &format!("the {} runtime cannot be reached: {error}", runtime.kind()),
                    "Start the container runtime (Docker Desktop, the Docker service or Podman), or fix runtime.command, then run workspace-doctor again.",
                )
                .with_retryable(true),
            );
        }
        Some(success(json!({
            "repositories": config.repositories.len(),
            "images": config.images.len(),
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builder(plugins: &str) -> (tempfile::TempDir, HostBuilder) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("umbel.toml"),
            format!("config_version = 7\ndefault_space = \"main\"\n\n[spaces.main]\n\n{plugins}"),
        )
        .unwrap();
        let builder = HostBuilder::open(dir.path()).unwrap();
        (dir, builder)
    }

    #[test]
    fn the_plugin_is_enabled_by_its_name_or_its_compiled_source_only() {
        let (_dir, by_name) = builder("[plugins]\nenabled = [\"loamos\"]\n");
        assert!(enabled(&by_name));
        let (_dir, by_source) = builder(
            "[plugins]\nenabled = [\"host\"]\n\n[plugins.host]\nsource = \"compiled:loamos\"\n",
        );
        assert!(enabled(&by_source));
        // A directory plugin that took the name is not this one.
        let (_dir, other) = builder(
            "[plugins]\nenabled = [\"loamos\"]\n\n[plugins.loamos]\nsource = \"plugins/loamos\"\n",
        );
        assert!(!enabled(&other));
        let (_dir, none) = builder("[plugins]\nenabled = []\n");
        assert!(!enabled(&none));
    }
}
