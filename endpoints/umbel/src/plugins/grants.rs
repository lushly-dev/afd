//! The host services and their gates (specification section 7).
//!
//! [`Services`] is what a compiled plugin is handed at `seal`: the grants its instance holds,
//! and nothing else. Per call, [`Services::call`] makes a [`CallServices`], which reads time and
//! randomness from the command context, packs for the call's space, and events under the
//! caller's principal. A grant that was not declared, or was denied, answers
//! [`ServiceError::NotGranted`].
//!
//! The gates are API discipline and a declaration to the deployer, **not a sandbox**: a compiled
//! plugin is Rust code with the host's privileges (owner decision 1 of 2026-11-01).

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use afd::CommandContext;
use serde_json::Value;
use umbel_sdk::{HostError as ServiceError, HostServices, Level};

use super::files::{PluginFiles, lexical_problem};
use super::manifest::PackDecl;
use crate::events::Projector;
use crate::workspace::{SpaceId, Workspace};

/// The most pack bytes one call may read (specification section 6.2).
pub const MAX_PACK_READ_BYTES: u64 = 16 * 1024 * 1024;
/// The most log bytes one call may write; further lines are dropped.
pub const MAX_LOG_BYTES: usize = 64 * 1024;
/// The most events one `events` read returns.
const MAX_EVENTS: u32 = 1000;

/// Grants whose use writes, reaches the network or reads secrets. Enabling an instance is not
/// consent to them: the instance must list what it allows, under
/// `[plugins.<id>.grants.<grant>] allow = [...]` (D42, specification section 7.2). Phase 1's
/// catalog has none; `http` and `secrets`, which will be the first, are refused as unavailable
/// before this rule applies.
pub(crate) const ALLOW_REQUIRED: &[&str] = &[];

/// Whether `grant` needs a per-instance `allow` list that enabling does not supply.
pub(crate) fn needs_allow(grant: &str, required: &[&str]) -> bool {
    required.contains(&grant)
}

pub(crate) struct Shared {
    pub(crate) instance: String,
    pub(crate) granted: BTreeSet<String>,
    pub(crate) config: Value,
    /// The spaces the instance is enabled for.
    pub(crate) spaces: Vec<SpaceId>,
    pub(crate) packs: Vec<PackDecl>,
    pub(crate) files: Arc<dyn PluginFiles + Send + Sync>,
    pub(crate) workspace: Arc<Workspace>,
    pub(crate) projector: Arc<Projector>,
}

/// The host services granted to one plugin instance. Cheap to clone.
#[derive(Clone)]
pub struct Services {
    shared: Arc<Shared>,
}

impl Services {
    pub(crate) fn new(shared: Shared) -> Self {
        Self {
            shared: Arc::new(shared),
        }
    }

    /// The instance id: what logs and errors call this plugin.
    pub fn instance(&self) -> &str {
        &self.shared.instance
    }

    /// Whether the grant `name` is held: declared by the manifest and not denied.
    pub fn is_granted(&self, name: &str) -> bool {
        self.shared.granted.contains(name)
    }

    /// The grants held, in name order.
    pub fn granted(&self) -> impl Iterator<Item = &str> {
        self.shared.granted.iter().map(String::as_str)
    }

    /// Grant `config`: the instance's configuration, validated, defaults applied.
    ///
    /// # Errors
    /// [`ServiceError::NotGranted`].
    pub fn config(&self) -> Result<Value, ServiceError> {
        self.require("config")?;
        Ok(self.shared.config.clone())
    }

    /// The services of one call, to use in a handler. `input` and `context` are the ones the
    /// handler was called with: the call's space is the input's `space`, else the default
    /// space, which is what the host resolved before the handler ran.
    pub fn call(&self, input: &Value, context: &CommandContext) -> CallServices {
        let space = self
            .shared
            .workspace
            .resolve_space(input, context)
            .unwrap_or_else(|_| self.shared.workspace.default_space().clone());
        CallServices {
            shared: Arc::clone(&self.shared),
            context: context.clone(),
            space,
            pack_bytes: AtomicU64::new(0),
            log_bytes: AtomicU64::new(0),
        }
    }

    fn require(&self, grant: &str) -> Result<(), ServiceError> {
        require(&self.shared, grant)
    }
}

fn require(shared: &Shared, grant: &str) -> Result<(), ServiceError> {
    if shared.granted.contains(grant) {
        Ok(())
    } else {
        Err(ServiceError::NotGranted(format!(
            "the grant `{grant}` was not declared by plugin instance `{}`, or was denied",
            shared.instance
        )))
    }
}

/// The host services of one call. Implements [`HostServices`], which is what `umbel_sdk::Cx`
/// wraps; a raw [`CompiledPlugin`](super::CompiledPlugin) calls the same methods directly.
///
/// The methods block on file reads: call them from a blocking context (`spawn_blocking`), as the
/// SDK wrapper does, not from an async task's hot path.
pub struct CallServices {
    shared: Arc<Shared>,
    context: CommandContext,
    space: SpaceId,
    pack_bytes: AtomicU64,
    log_bytes: AtomicU64,
}

impl CallServices {
    /// The call's resolved space.
    pub fn space(&self) -> &SpaceId {
        &self.space
    }

    fn require(&self, grant: &str) -> Result<(), ServiceError> {
        require(&self.shared, grant)
    }

    fn pack(&self, id: &str) -> Result<&PackDecl, ServiceError> {
        self.shared
            .packs
            .iter()
            .find(|pack| pack.id == id)
            .ok_or_else(|| {
                ServiceError::NotFound(format!(
                    "the plugin declares no pack `{id}`; its packs are: {}",
                    self.shared
                        .packs
                        .iter()
                        .map(|pack| pack.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
            })
    }
}

impl HostServices for CallServices {
    fn config(&self) -> Result<Value, ServiceError> {
        self.require("config")?;
        Ok(self.shared.config.clone())
    }

    fn log(&self, level: Level, message: &str) {
        if self.require("log").is_err() {
            return;
        }
        let used = self
            .log_bytes
            .fetch_add(message.len() as u64, Ordering::Relaxed);
        if used + message.len() as u64 > MAX_LOG_BYTES as u64 {
            if used <= MAX_LOG_BYTES as u64 {
                tracing::warn!(
                    plugin = %self.shared.instance,
                    "the plugin's log output for this call passed {MAX_LOG_BYTES} bytes; further lines are dropped"
                );
            }
            return;
        }
        let plugin = &self.shared.instance;
        match level {
            Level::Error => tracing::error!(plugin = %plugin, "{message}"),
            Level::Warn => tracing::warn!(plugin = %plugin, "{message}"),
            Level::Info => tracing::info!(plugin = %plugin, "{message}"),
            Level::Debug => tracing::debug!(plugin = %plugin, "{message}"),
            Level::Trace => tracing::trace!(plugin = %plugin, "{message}"),
        }
    }

    fn pack_list(&self, pack: &str) -> Result<Vec<String>, ServiceError> {
        self.require("packs")?;
        let decl = self.pack(pack)?;
        self.shared
            .files
            .list(&decl.path)
            .map_err(ServiceError::NotFound)
    }

    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, ServiceError> {
        self.require("packs")?;
        let decl = self.pack(pack)?;
        if let Some(problem) = lexical_problem(path) {
            return Err(ServiceError::Invalid(format!(
                "the path `{path}` {problem}: it must stay inside the pack"
            )));
        }
        let full = format!("{}/{path}", decl.path.trim_end_matches('/'));
        let size = self.shared.files.len(&full).map_err(|_| {
            ServiceError::NotFound(format!("the pack `{pack}` has no file `{path}`"))
        })?;
        let total = self.pack_bytes.fetch_add(size, Ordering::Relaxed) + size;
        if total > MAX_PACK_READ_BYTES {
            return Err(ServiceError::TooLarge(format!(
                "a call may read at most {MAX_PACK_READ_BYTES} bytes of pack files"
            )));
        }
        self.shared
            .files
            .read(&full)
            .map_err(ServiceError::NotFound)
    }

    fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, ServiceError> {
        self.require("events")?;
        let target = match space {
            None => self.space.clone(),
            Some(name) => {
                let id = SpaceId::parse(name)
                    .ok()
                    .filter(|id| self.shared.workspace.has_space(id.as_str()))
                    .ok_or_else(|| {
                        ServiceError::Invalid(format!(
                            "the space `{name}` is not declared in this workspace"
                        ))
                    })?;
                if !self.shared.spaces.contains(&id) {
                    return Err(ServiceError::NotGranted(format!(
                        "plugin instance `{}` is not enabled for the space `{name}`",
                        self.shared.instance
                    )));
                }
                id
            }
        };
        if !(1..=MAX_EVENTS).contains(&limit) {
            return Err(ServiceError::Invalid(format!(
                "limit must be from 1 to {MAX_EVENTS}"
            )));
        }
        crate::commands::read_events(
            &self.shared.workspace,
            &self.shared.projector,
            target,
            after.map(str::to_owned),
            usize::try_from(limit).unwrap_or(usize::MAX),
            crate::commands::caller(&self.context),
        )
        .map_err(|error| ServiceError::Invalid(format!("{}: {}", error.code, error.message)))
    }

    fn now_ms(&self) -> Result<i64, ServiceError> {
        self.require("clock")?;
        Ok(self.context.clock().now())
    }

    fn random(&self) -> Result<f64, ServiceError> {
        self.require("random")?;
        Ok(self.context.random().next())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_grants_need_an_allow_list() {
        assert!(!needs_allow("config", ALLOW_REQUIRED));
        assert!(needs_allow("http", &["http", "secrets"]));
        assert!(!needs_allow("clock", &["http", "secrets"]));
    }
}
