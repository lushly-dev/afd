//! The component loader (specification section 6.2): a WebAssembly component built against the
//! WIT world `umbel:plugin/plugin@1.0.0`, run on wasmtime 48 inside a sandbox.
//!
//! A component can reach nothing the host did not link: no network, no file, no environment,
//! only the `umbel:plugin` interfaces its grants allow and WASI 0.2 clocks and random bytes that
//! are the command context's own, so the journal records them and replays them. Each call gets a
//! new store with its own fuel, memory, table and wall-time limits; no state survives a call.

mod analyze;
mod call;
mod engine;
mod state;
mod wasi;

use std::sync::Arc;

use afd::{CommandContext, CommandHandler, CommandResult};
use async_trait::async_trait;
use serde_json::Value;
use wasmtime::component::{Component, ComponentExportIndex, InstancePre};

use super::compiled::PluginCommand;
use super::grants::Services;
use super::manifest::Manifest;
use super::{PluginError, PluginFiles};
use crate::workspace::{Limits, caps};
use state::CallState;

/// A call's input and result may each be this large (specification section 6.2).
pub(super) const MAX_IO_BYTES: usize = 4 * 1024 * 1024;

const DEFAULT_FUEL: u64 = 1_000_000_000;
const DEFAULT_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_MEMORY_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_TABLE_ELEMENTS: u64 = 20_000;

/// A component's per-call limits: the deployer's, else the defaults, never past the host caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Resolved {
    pub(super) fuel: u64,
    pub(super) timeout_ms: u64,
    pub(super) memory_bytes: u64,
    pub(super) table_elements: u64,
}

impl Resolved {
    pub(super) fn new(limits: &Limits) -> Self {
        Self {
            fuel: limits.fuel.unwrap_or(DEFAULT_FUEL).min(caps::FUEL),
            timeout_ms: limits
                .timeout_ms
                .unwrap_or(DEFAULT_TIMEOUT_MS)
                .min(caps::TIMEOUT_MS),
            memory_bytes: limits
                .memory_bytes
                .unwrap_or(DEFAULT_MEMORY_BYTES)
                .min(caps::MEMORY_BYTES),
            table_elements: limits
                .table_elements
                .unwrap_or(DEFAULT_TABLE_ELEMENTS)
                .min(caps::TABLE_ELEMENTS),
        }
    }
}

/// `plugin-check`'s component check: read and compile the manifest's component and check its
/// imports against the grants the manifest declares, as `seal` does, without linking it.
///
/// # Errors
/// The errors of [`ComponentRuntime::load`] that precede linking.
pub(crate) fn check(
    instance: &str,
    manifest: &Manifest,
    files: &dyn PluginFiles,
) -> Result<(), PluginError> {
    let Some(declared) = &manifest.component else {
        return Err(PluginError::load_failed(
            instance,
            "the manifest declares no [component] table",
        ));
    };
    let bytes = files
        .read(&declared.path)
        .map_err(|problem| PluginError::load_failed(instance, problem))?;
    let shared = engine::shared().map_err(|problem| PluginError::load_failed(instance, problem))?;
    let component = shared.compile(&bytes).map_err(|problem| {
        PluginError::load_failed(
            instance,
            format!("`{}` is not a loadable component: {problem}", declared.path),
        )
    })?;
    analyze::check(instance, &shared.engine, &component, |grant| {
        manifest
            .grants
            .iter()
            .any(|declared| declared.name == grant)
    })
    .map(|_| ())
}

/// A component compiled, checked and linked at `seal`, ready to be instantiated per call.
pub(crate) struct ComponentRuntime {
    shared: &'static engine::Shared,
    pre: InstancePre<CallState>,
    execute: ComponentExportIndex,
    /// Whether to draw the insecure-random seed from the context's random source at each call.
    seeds: bool,
    limits: Resolved,
    instance: String,
    services: Services,
}

impl ComponentRuntime {
    /// Read, compile, check and link the manifest's component (section 6.2, at `seal`).
    ///
    /// # Errors
    /// `PLUGIN_LOAD_FAILED` for a file that is not a component or does not link,
    /// `PLUGIN_IMPORT_DENIED` for an import no grant allows, and `PLUGIN_PROTOCOL_UNSUPPORTED`
    /// for a world other than `umbel:plugin@1.x`.
    pub(crate) fn load(
        instance: &str,
        manifest: &Manifest,
        files: &dyn PluginFiles,
        services: &Services,
        limits: &Limits,
    ) -> Result<Arc<Self>, PluginError> {
        let Some(declared) = &manifest.component else {
            return Err(PluginError::load_failed(
                instance,
                "the manifest declares no [component] table",
            ));
        };
        let bytes = files
            .read(&declared.path)
            .map_err(|problem| PluginError::load_failed(instance, problem))?;
        let shared =
            engine::shared().map_err(|problem| PluginError::load_failed(instance, problem))?;
        let component = shared.compile(&bytes).map_err(|problem| {
            PluginError::load_failed(
                instance,
                format!("`{}` is not a loadable component: {problem}", declared.path),
            )
        })?;
        let analysis = analyze::check(instance, &shared.engine, &component, |grant| {
            services.is_granted(grant)
        })?;
        let pre = shared
            .linker
            .instantiate_pre(&component)
            .map_err(|error| PluginError::load_failed(instance, format!("{error:#}")))?;
        let execute = export_index(instance, &component, &analysis.command_export)?;
        Ok(Arc::new(Self {
            shared,
            pre,
            execute,
            seeds: analysis.seeds,
            limits: Resolved::new(limits),
            instance: instance.to_owned(),
            services: services.clone(),
        }))
    }

    /// The handler for the manifest command `name`. `has_space` says whether its input schema
    /// has a `space` property, which decides whether the call context carries a space.
    pub(crate) fn command(self: &Arc<Self>, name: &str, has_space: bool) -> PluginCommand {
        PluginCommand::handler(
            name,
            ComponentHandler {
                runtime: Arc::clone(self),
                name: name.to_owned(),
                has_space,
            },
        )
    }
}

fn export_index(
    instance: &str,
    component: &Component,
    export: &str,
) -> Result<ComponentExportIndex, PluginError> {
    let command = component.get_export_index(None, export);
    let execute = command
        .as_ref()
        .and_then(|command| component.get_export_index(Some(command), "execute"));
    execute.ok_or_else(|| {
        PluginError::load_failed(
            instance,
            format!("the component's `{export}` export has no `execute` function"),
        )
    })
}

struct ComponentHandler {
    runtime: Arc<ComponentRuntime>,
    name: String,
    has_space: bool,
}

#[async_trait]
impl CommandHandler for ComponentHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        match call::run(&self.runtime, &self.name, self.has_space, input, context).await {
            Ok(result) => result,
            Err(error) => error.into_result(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_default_and_never_pass_the_host_caps() {
        let defaults = Resolved::new(&Limits::default());
        assert_eq!(defaults.fuel, 1_000_000_000);
        assert_eq!(defaults.timeout_ms, 5_000);
        assert_eq!(defaults.memory_bytes, 64 * 1024 * 1024);
        assert_eq!(defaults.table_elements, 20_000);

        let asked = Limits {
            fuel: Some(u64::MAX),
            timeout_ms: Some(u64::MAX),
            memory_bytes: Some(u64::MAX),
            table_elements: Some(u64::MAX),
        };
        let capped = Resolved::new(&asked);
        assert_eq!(capped.fuel, caps::FUEL);
        assert_eq!(capped.timeout_ms, caps::TIMEOUT_MS);
        assert_eq!(capped.memory_bytes, caps::MEMORY_BYTES);
        assert_eq!(capped.table_elements, caps::TABLE_ELEMENTS);
    }
}
