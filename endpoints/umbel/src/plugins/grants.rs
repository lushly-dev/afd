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
use umbel_sdk::{HostError as ServiceError, HostServices, Level, PipelineAttestation};

use std::collections::BTreeMap;

use super::attestation::PipelineAttestations;
use super::files::lexical_problem;
use super::ledger::Ledger;
use super::packs::{PackCopy, PackSet};
use crate::events::Projector;
use crate::store::Hub;
use crate::workspace::{SpaceId, Workspace};
use umbel_sdk::{CollectionInfo, CollectionMeta, ContentEntry, Reader};
#[cfg(feature = "store-embedded")]
use umbel_store::memory;
use umbel_store::{
    Change, ChunkHit, ContentHash, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, Record, RecordMeta, Rev, Subgraph,
};

/// The most pack bytes one call may read (specification section 6.2).
pub const MAX_PACK_READ_BYTES: u64 = 16 * 1024 * 1024;
/// The most log bytes one call may write; further lines are dropped.
pub const MAX_LOG_BYTES: usize = 64 * 1024;
/// The most events one `events` read returns.
const MAX_EVENTS: u32 = 1000;

/// Grants whose use writes, reaches the network or reads secrets. Enabling an instance is not
/// consent to them: the instance must list what it allows, under
/// `[plugins.<id>.grants.<grant>] allow = [...]` (D42, phase 2 specification section 3.3, rule
/// 1). `http` and `secrets` will join them; they are refused as unavailable before this rule
/// applies.
pub(crate) const ALLOW_REQUIRED: &[&str] = super::ALLOW_REQUIRED_GRANTS;

/// Whether `grant` needs a per-instance `allow` list that enabling does not supply.
pub(crate) fn needs_allow(grant: &str, required: &[&str]) -> bool {
    required.contains(&grant)
}

/// What the manifest says about one command that the store services need to know.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CommandPolicy {
    /// The command has the `store-write` effect: it may use derivation reads.
    pub(crate) store_write: bool,
    /// The command is exposed to the CLI alone: it may use `as_reader`.
    pub(crate) cli_only: bool,
}

pub(crate) struct Shared {
    pub(crate) instance: String,
    pub(crate) granted: BTreeSet<String>,
    pub(crate) config: Value,
    /// The spaces the instance is enabled for.
    pub(crate) spaces: Vec<SpaceId>,
    /// The plugin's packs with each space's override (D46).
    pub(crate) packs: PackSet,
    pub(crate) workspace: Arc<Workspace>,
    pub(crate) projector: Arc<Projector>,
    /// The stores of the workspace's spaces.
    pub(crate) stores: Hub,
    /// `[plugins.<id>.grants.<grant>] allow`: what each write grant may reach.
    pub(crate) allow: BTreeMap<String, Vec<String>>,
    /// The instance's commands by name.
    pub(crate) commands: BTreeMap<String, CommandPolicy>,
    /// What calls did to the stores, for the plugin gate.
    pub(crate) ledger: Arc<Ledger>,
    /// The pipeline steps in flight, by their trace id (phase 4 section 10.1).
    pub(crate) attestations: Arc<PipelineAttestations>,
    /// `[plugins.<id>.grants.memory_write]`'s sharing policy (phase 3 section 3.2).
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) memory_policy: Option<crate::workspace::MemoryWritePolicy>,
    /// The commands' terminal prompts and pipeline steps, set once every instance is loaded
    /// (phase 3 section 3.3).
    #[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
    pub(crate) prompts: Arc<std::sync::OnceLock<crate::authority::Prompts>>,
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
    /// space, which is what the host resolved before the handler ran; its spaces are the
    /// input's `spaces` when it has them.
    ///
    /// The command is not known here, so derivation reads and `as_reader` are refused; a
    /// handler that needs them calls [`Services::call_command`].
    pub fn call(&self, input: &Value, context: &CommandContext) -> CallServices {
        self.build(None, input, context)
    }

    /// As [`Services::call`] for the manifest command `command`, whose effects and exposure
    /// decide whether derivation reads and `as_reader` are available.
    pub fn call_command(
        &self,
        command: &str,
        input: &Value,
        context: &CommandContext,
    ) -> CallServices {
        self.build(Some(command), input, context)
    }

    fn build(
        &self,
        command: Option<&str>,
        input: &Value,
        context: &CommandContext,
    ) -> CallServices {
        let workspace = &self.shared.workspace;
        let space = workspace
            .resolve_space(input, context)
            .unwrap_or_else(|_| workspace.default_space().clone());
        let spaces = workspace
            .resolve_spaces(input, context)
            .unwrap_or_else(|_| vec![space.clone()]);
        CallServices {
            shared: Arc::clone(&self.shared),
            context: context.clone(),
            space,
            spaces,
            command: command.map(str::to_owned),
            as_principal: None,
            read_only: false,
            pack_bytes: AtomicU64::new(0),
            log_bytes: AtomicU64::new(0),
            content_bytes: AtomicU64::new(0),
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
    pub(super) shared: Arc<Shared>,
    pub(super) context: CommandContext,
    space: SpaceId,
    spaces: Vec<SpaceId>,
    pub(super) command: Option<String>,
    /// Set by `as_reader`: reads use this principal's filter, and nothing writes.
    pub(super) as_principal: Option<String>,
    pub(super) read_only: bool,
    pack_bytes: AtomicU64,
    log_bytes: AtomicU64,
    pub(super) content_bytes: AtomicU64,
}

impl CallServices {
    /// The call's resolved space.
    pub fn space(&self) -> &SpaceId {
        &self.space
    }

    /// The same call seen as `principal`: reads use that principal's filter and nothing writes.
    pub(super) fn read_only_view(&self, principal: &str) -> CallServices {
        CallServices {
            shared: Arc::clone(&self.shared),
            context: self.context.clone(),
            space: self.space.clone(),
            spaces: self.spaces.clone(),
            command: self.command.clone(),
            as_principal: Some(principal.to_owned()),
            read_only: true,
            pack_bytes: AtomicU64::new(0),
            log_bytes: AtomicU64::new(0),
            content_bytes: AtomicU64::new(0),
        }
    }

    /// The call's checked spaces: the input's `spaces`, else the one space.
    pub fn spaces(&self) -> &[SpaceId] {
        &self.spaces
    }

    /// The host's attestation that this call is a step of a plugin pipeline (phase 4
    /// specification, section 10.1, D91): `Some` only while a step of a registered pipeline runs
    /// this instance's command under the trace id the host drew for it, and only for that
    /// command. It is read from the host's own table, never from the input or `extra`. A call
    /// made with [`Services::call`], which names no command, has none.
    pub fn pipeline(&self) -> Option<PipelineAttestation> {
        let command = self.command.as_deref()?;
        if !self.shared.commands.contains_key(command) {
            return None;
        }
        let trace = self.context.trace_id.as_deref()?;
        self.shared.attestations.lookup(trace, command)
    }

    /// Whether the caller has authority `person` for this call's command (phase 3 specification,
    /// sections 3.3 and 8.7; D86): the terminal check alone. The memory services make it before a
    /// confirmation, a forget by selector and a sharing write, and `CallContext.person` carries it
    /// to every compiled plugin's command (phase 4 step 4, amendment 9). A call made with
    /// [`Services::call`], which names no command, is a person's only through the library.
    pub fn person(&self) -> bool {
        let empty = crate::authority::Prompts::default();
        let prompts = self.shared.prompts.get().unwrap_or(&empty);
        crate::authority::caller_is_person(&self.context, self.command.as_deref(), prompts)
    }

    /// The legacy principals the caller's effective principal stands for (phase 5 section 4.6),
    /// which `CallContext.equivalents` carries to every compiled plugin's command.
    pub fn equivalents(&self) -> Vec<String> {
        let principal = crate::access::effective_principal_of(&self.context);
        let mut identities =
            crate::access::identities(self.shared.workspace.config(), principal.as_deref());
        if !identities.is_empty() {
            identities.remove(0);
        }
        identities
    }

    /// Whether the grant `name` is held (declared and not denied).
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn holds(&self, name: &str) -> bool {
        self.shared.granted.contains(name)
    }

    /// The command context the call runs in, for the virtualized clocks and random source.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn command_context(&self) -> CommandContext {
        self.context.clone()
    }

    /// Whether `len` more bytes of log output fit in the call's budget. The first overrun says
    /// so once; later lines are dropped silently.
    fn log_budget(&self, len: usize) -> bool {
        let used = self.log_bytes.fetch_add(len as u64, Ordering::Relaxed);
        if used + len as u64 > MAX_LOG_BYTES as u64 {
            if used <= MAX_LOG_BYTES as u64 {
                tracing::warn!(
                    plugin = %self.shared.instance,
                    "the plugin's log output for this call passed {MAX_LOG_BYTES} bytes; further lines are dropped"
                );
            }
            return false;
        }
        true
    }

    /// A line a component wrote to stdout or stderr. Always linked, never granted, and under the
    /// same per-call cap as the `log` grant (specification section 4).
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn wasi_line(&self, stderr: bool, line: &str) {
        if !self.log_budget(line.len()) {
            return;
        }
        let plugin = &self.shared.instance;
        if stderr {
            tracing::warn!(plugin = %plugin, source = "wasi", "{line}");
        } else {
            tracing::info!(plugin = %plugin, source = "wasi", "{line}");
        }
    }

    pub(super) fn require(&self, grant: &str) -> Result<(), ServiceError> {
        require(&self.shared, grant)
    }

    /// The call's space's effective copy of the pack `id`: the space's override, else the
    /// plugin's default.
    fn pack(&self, id: &str) -> Result<&PackCopy, ServiceError> {
        self.shared.packs.effective(id, &self.space).ok_or_else(|| {
            ServiceError::NotFound(format!(
                "the plugin declares no pack `{id}`; its packs are: {}",
                self.shared.packs.ids().collect::<Vec<_>>().join(", ")
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
        if !self.log_budget(message.len()) {
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
        self.pack(pack)?.list().map_err(ServiceError::NotFound)
    }

    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, ServiceError> {
        self.require("packs")?;
        let copy = self.pack(pack)?;
        if let Some(problem) = lexical_problem(path) {
            return Err(ServiceError::Invalid(format!(
                "the path `{path}` {problem}: it must stay inside the pack"
            )));
        }
        let size = copy.len(path).map_err(|_| {
            ServiceError::NotFound(format!("the pack `{pack}` has no file `{path}`"))
        })?;
        let total = self.pack_bytes.fetch_add(size, Ordering::Relaxed) + size;
        if total > MAX_PACK_READ_BYTES {
            return Err(ServiceError::TooLarge(format!(
                "a call may read at most {MAX_PACK_READ_BYTES} bytes of pack files"
            )));
        }
        copy.read(path).map_err(ServiceError::NotFound)
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
            crate::access::claim_groups_of(&self.context),
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

    fn content_list(
        &self,
        space: &str,
        collection: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<ContentEntry>, ServiceError> {
        self.svc_content_list(space, collection, after, limit)
    }

    fn content_collections(&self, space: &str) -> Result<Vec<CollectionInfo>, ServiceError> {
        self.svc_content_collections(space)
    }

    fn content_read(
        &self,
        space: &str,
        collection: &str,
        path: &str,
    ) -> Result<Vec<u8>, ServiceError> {
        self.svc_content_read(space, collection, path)
    }

    fn content_replace(
        &self,
        space: &str,
        collection: &str,
        path: &str,
        bytes: &[u8],
        expect: Expect,
    ) -> Result<ContentHash, ServiceError> {
        self.svc_content_replace(space, collection, path, bytes, expect)
    }

    fn doc_get(&self, space: &str, id: &str) -> Result<Option<Document>, ServiceError> {
        self.svc_doc_get(space, id)
    }

    fn doc_list(&self, space: &str, query: &ListQuery) -> Result<Page<DocMeta>, ServiceError> {
        self.svc_doc_list(space, query)
    }

    fn doc_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<Change>, ServiceError> {
        self.svc_doc_changes(space, after, limit, trace)
    }

    fn reader_tokens(&self, space: &str) -> Result<Vec<String>, ServiceError> {
        self.svc_reader_tokens(space)
    }

    fn readable_collections(&self, space: &str) -> Result<Vec<CollectionMeta>, ServiceError> {
        self.svc_readable_collections(space)
    }

    fn doc_put(
        &self,
        space: &str,
        doc: DocumentWrite,
        expect: Expect,
    ) -> Result<DocMeta, ServiceError> {
        self.svc_doc_put(space, doc, expect)
    }

    fn doc_delete(
        &self,
        space: &str,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, ServiceError> {
        self.svc_doc_delete(space, id, expect, envelope)
    }

    fn record_get(
        &self,
        space: &str,
        kind: &str,
        id: &str,
    ) -> Result<Option<Record>, ServiceError> {
        self.svc_record_get(space, kind, id)
    }

    fn record_list(
        &self,
        space: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<Record>, ServiceError> {
        self.svc_record_list(space, kind, after, limit)
    }

    fn record_put(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, ServiceError> {
        self.svc_record_put(space, kind, id, body, envelope, expect)
    }

    fn index_search(&self, space: &str, query: &IndexQuery) -> Result<Vec<ChunkHit>, ServiceError> {
        self.svc_index_search(space, query)
    }

    fn index_chunks(&self, space: &str, doc: &str) -> Result<Vec<IndexChunk>, ServiceError> {
        self.svc_index_chunks(space, doc)
    }

    fn index_applied(&self, space: &str) -> Result<Rev, ServiceError> {
        self.svc_index_applied(space)
    }

    fn index_writer(&self, space: &str) -> Result<Box<dyn IndexWriterSession>, ServiceError> {
        self.svc_index_writer(space)
    }

    fn graph_neighbors(
        &self,
        space: &str,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
    ) -> Result<Vec<Edge>, ServiceError> {
        self.svc_graph_neighbors(space, node, kinds, direction, limit)
    }

    fn graph_nodes(&self, space: &str, ids: &[String]) -> Result<Vec<Node>, ServiceError> {
        self.svc_graph_nodes(space, ids)
    }

    fn graph_edges(
        &self,
        space: &str,
        kind: &str,
        after: Option<&EdgeKey>,
        limit: u32,
    ) -> Result<Vec<Edge>, ServiceError> {
        self.svc_graph_edges(space, kind, after, limit)
    }

    fn graph_subgraph(&self, space: &str) -> Result<Subgraph, ServiceError> {
        self.svc_graph_subgraph(space)
    }

    fn graph_applied(&self, space: &str) -> Result<Rev, ServiceError> {
        self.svc_graph_applied(space)
    }

    fn graph_apply(
        &self,
        space: &str,
        batch: GraphBatch,
        applied: Rev,
    ) -> Result<(), ServiceError> {
        self.svc_graph_apply(space, batch, applied)
    }

    fn derive_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
    ) -> Result<Vec<Change>, ServiceError> {
        self.svc_derive_changes(space, after, limit)
    }

    fn derive_document(&self, space: &str, id: &str) -> Result<Option<Document>, ServiceError> {
        self.svc_derive_document(space, id)
    }

    fn derive_head(&self, space: &str) -> Result<Rev, ServiceError> {
        self.svc_derive_head(space)
    }

    fn checkpoint(&self, space: &str) -> Result<(), ServiceError> {
        self.svc_checkpoint(space)
    }

    fn truncate_wal(&self, space: &str) -> Result<umbel_sdk::WalCheckpoint, ServiceError> {
        self.svc_truncate_wal(space)
    }

    fn record_forget_history(
        &self,
        space: &str,
        kind: &str,
        id: &str,
    ) -> Result<u64, ServiceError> {
        self.svc_record_forget_history(space, kind, id)
    }

    fn as_reader(&self, principal: &str) -> Result<Reader, ServiceError> {
        self.svc_as_reader(principal)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_get(
        &self,
        space: &str,
        id: &str,
        as_of: umbel_store::AsOf,
        flags: umbel_store::ReadFlags,
    ) -> Result<Option<umbel_store::MemoryRecord>, ServiceError> {
        self.svc_memory_get(space, id, as_of, flags)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_history(
        &self,
        space: &str,
        id: &str,
    ) -> Result<Vec<umbel_store::MemoryRecord>, ServiceError> {
        self.svc_memory_history(space, id)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_list(
        &self,
        space: &str,
        query: &memory::MemoryList,
    ) -> Result<memory::MemoryPage, ServiceError> {
        self.svc_memory_list(space, query)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_recall(
        &self,
        space: &str,
        query: &memory::RecallQuery,
    ) -> Result<memory::RecallPage, ServiceError> {
        self.svc_memory_recall(space, query)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_left_out(
        &self,
        space: &str,
        query: &umbel_sdk::LeftOutQuery,
    ) -> Result<memory::LeftOut, ServiceError> {
        self.svc_memory_left_out(space, query)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<memory::MemoryChange>, ServiceError> {
        self.svc_memory_changes(space, after, limit, trace)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_counts(
        &self,
        space: &str,
        now: memory::Millis,
        expiring_within_ms: memory::Millis,
    ) -> Result<memory::MemoryCounts, ServiceError> {
        self.svc_memory_counts(space, now, expiring_within_ms)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_usage(
        &self,
        space: &str,
        since: memory::Millis,
    ) -> Result<memory::MemoryUsage, ServiceError> {
        self.svc_memory_usage(space, since)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_head(&self, space: &str) -> Result<Rev, ServiceError> {
        self.svc_memory_head(space)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_key_file(&self, space: &str) -> Result<memory::KeyFileState, ServiceError> {
        self.svc_memory_key_file(space)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_write(
        &self,
        space: &str,
        request: umbel_sdk::MemoryWriteRequest,
    ) -> Result<memory::MemoryReceipt, ServiceError> {
        self.svc_memory_write(space, request)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_invalidate(
        &self,
        space: &str,
        request: memory::Invalidate,
    ) -> Result<memory::MemoryVersionMeta, ServiceError> {
        self.svc_memory_invalidate(space, request)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_confirm(
        &self,
        space: &str,
        request: memory::Confirm,
    ) -> Result<memory::MemoryVersionMeta, ServiceError> {
        self.svc_memory_confirm(space, request)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_forget(
        &self,
        space: &str,
        selector: umbel_store::ForgetSelector,
    ) -> Result<memory::ForgetReceipt, ServiceError> {
        self.svc_memory_forget(space, selector)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_sweep(
        &self,
        space: &str,
        limit: u32,
        retention: memory::Retention,
    ) -> Result<memory::SweepReceipt, ServiceError> {
        self.svc_memory_sweep(space, limit, retention)
    }

    #[cfg(feature = "store-embedded")]
    fn memory_reindex(
        &self,
        space: &str,
        remove_orphans: bool,
    ) -> Result<memory::ReindexReceipt, ServiceError> {
        self.svc_memory_reindex(space, remove_orphans)
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
