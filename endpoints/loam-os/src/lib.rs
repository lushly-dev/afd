//! The Loam OS host's plugin: the commands that govern machines, compiled into the `loam-os`
//! binary on Umbel's host library (the [Loam OS proposal](../../docs/features/active/loam-os/loam-os.proposal.md)).
//!
//! M0 ships one command, `host-status`, and the configuration checks `workspace-doctor` runs.
//! The plugin owns the `host`, `machine`, `run` and `checkpoint` domains; their other commands
//! arrive in M1 and M2.
#![forbid(unsafe_code)]

pub mod config;
pub mod runtime;
mod status;

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};

use config::Config;
use runtime::{CliRuntime, Runtime};

/// The manifest of the compiled plugin.
pub const MANIFEST: &str = include_str!("../manifests/compiled.toml");

/// The name the host announces over MCP and in `host-status`.
pub const HOST_NAME: &str = "loam-os";

/// The host's version.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The plugin. With no runtime given it drives the configured runtime's command line on each
/// call; a test gives it a [`runtime::FakeRuntime`].
#[derive(Clone, Default)]
pub struct LoamOs {
    runtime: Option<Arc<dyn Runtime>>,
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
            .finish()
    }
}

/// The plugin, driving the configured runtime.
pub fn plugin() -> LoamOs {
    LoamOs::default()
}

impl LoamOs {
    /// The plugin, driving `runtime` instead of the configured one.
    pub fn with_runtime(runtime: Arc<dyn Runtime>) -> Self {
        Self {
            runtime: Some(runtime),
        }
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
                Ok(config) => success(status::host_status(&config, self.runtime(&config).as_ref())),
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
