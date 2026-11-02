//! What a handler may use: the call and the host services its plugin was granted.

use serde_json::Value;
use std::fmt;

use umbel_store::{
    Change, ChunkHit, ContentHash, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, Record, RecordMeta, Rev, Subgraph,
};

use crate::store::{CollectionInfo, ContentEntry, Reader};

/// What the command is called with (WIT `call-context`). The principal is a summary: plugins
/// never see credentials or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CallContext {
    /// The registered command name.
    pub command: String,
    /// The call's trace id.
    pub trace_id: String,
    /// The resolved space for a command with a `space` input; `None` otherwise.
    pub space: Option<String>,
    /// The spaces the call may use: the checked `spaces` of a command with a `spaces` input,
    /// else the call's one space (the default space for a command with no space input). The
    /// store methods refuse a space outside it.
    pub spaces: Vec<String>,
    /// The effective output budget in bytes, for a command that declares one (compiled plugins
    /// only in phase 2); `None` otherwise.
    pub output_budget: Option<u64>,
    /// The actor's kind: `human`, `agent`, `service` or `script`.
    pub actor_kind: String,
    /// The actor's id, when it has one.
    pub actor_id: Option<String>,
    /// The person the actor acts for, when known.
    pub on_behalf_of: Option<String>,
    /// `mcp`, `cli`, `agent` or `palette`.
    pub interface: String,
}

/// Why a host service refused (WIT `host-error`; world 1.1.0 adds the last four).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostError {
    /// The grant was not declared, or the deployer denied it.
    NotGranted(String),
    /// What was asked for does not exist.
    NotFound(String),
    /// The arguments were not acceptable.
    Invalid(String),
    /// The answer would exceed a cap.
    TooLarge(String),
    /// A compare-and-set or revision check failed and nothing was written. `current` is the
    /// current content hash, or the current revision for an applied revision.
    Conflict {
        /// What the store holds now.
        current: Option<String>,
    },
    /// A lock wait ran past `store.lock_timeout_ms`; retry.
    Busy(String),
    /// The stored data is not what the store wrote; run `store-check`.
    Corrupt(String),
    /// The operating system or the database failed.
    Io(String),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotGranted(message) => write!(f, "not granted: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::Invalid(message) => write!(f, "invalid: {message}"),
            Self::TooLarge(message) => write!(f, "too large: {message}"),
            Self::Conflict { current: Some(c) } => write!(f, "conflict: the store holds {c}"),
            Self::Conflict { current: None } => write!(f, "conflict: nothing is stored there"),
            Self::Busy(message) => write!(f, "busy: {message}"),
            Self::Corrupt(message) => write!(f, "corrupt: {message}"),
            Self::Io(message) => write!(f, "i/o: {message}"),
        }
    }
}

impl std::error::Error for HostError {}

/// A log level (WIT `log.level`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Something failed.
    Error,
    /// Something needs attention.
    Warn,
    /// Normal operation.
    Info,
    /// Detail for diagnosing.
    Debug,
    /// Finer detail still.
    Trace,
}

/// The host services of one call, by grant. The host implements it for a compiled plugin; a
/// component and a mounted server get their own implementations in later steps. Every method
/// answers [`HostError::NotGranted`] for a grant that was not declared or was denied.
pub trait HostServices: Send + Sync {
    /// Grant `config`: the instance's configuration, validated, defaults applied.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn config(&self) -> Result<Value, HostError>;
    /// Grant `log`: a line in the host's log, tagged with the instance id. A no-op without the
    /// grant.
    fn log(&self, level: Level, message: &str);
    /// Grant `packs`: the files of one of the plugin's packs, as paths inside the pack.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`].
    fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError>;
    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`] for a path
    /// outside the pack, [`HostError::TooLarge`] past the per-call cap.
    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError>;
    /// Grant `events`: `event-list`'s read under the caller's principal, without acknowledging.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], including for a space the instance is not enabled for;
    /// [`HostError::Invalid`].
    fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError>;
    /// Grant `clock`: the command context's clock, in epoch milliseconds.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn now_ms(&self) -> Result<i64, HostError>;
    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn random(&self) -> Result<f64, HostError>;

    /// Grant `content`: the files of one collection of the space, sorted by path, after `after`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`].
    fn content_list(
        &self,
        _space: &str,
        _collection: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Page<ContentEntry>, HostError> {
        not_granted("content")
    }
    /// Grant `content`: the collections of the space as the workspace declares them, in
    /// configuration order, without their roots.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn content_collections(&self, _space: &str) -> Result<Vec<CollectionInfo>, HostError> {
        not_granted("content")
    }
    /// Grant `content`: one file of a collection, confined to its root.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::TooLarge`].
    fn content_read(
        &self,
        _space: &str,
        _collection: &str,
        _path: &str,
    ) -> Result<Vec<u8>, HostError> {
        not_granted("content")
    }
    /// Grant `content_write`: replace or create one file after checking `expect`, atomically.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (including `STORE_WRITE_NOT_ALLOWED`), [`HostError::Conflict`].
    fn content_replace(
        &self,
        _space: &str,
        _collection: &str,
        _path: &str,
        _bytes: &[u8],
        _expect: Expect,
    ) -> Result<ContentHash, HostError> {
        not_granted("content_write")
    }
    /// Grant `documents`: one document, under the caller's reader filter.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn doc_get(&self, _space: &str, _id: &str) -> Result<Option<Document>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: readable documents, ordered by id.
    ///
    /// # Errors
    /// As [`HostServices::doc_get`], and [`HostError::Invalid`] for a bad limit.
    fn doc_list(&self, _space: &str, _query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: the readable changes after `after`.
    ///
    /// # Errors
    /// As [`HostServices::doc_list`].
    fn doc_changes(
        &self,
        _space: &str,
        _after: Rev,
        _limit: u32,
        _trace: Option<&str>,
    ) -> Result<Vec<Change>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents_write`: write a document. The host fills the envelope's identity fields
    /// from the call and refuses an envelope without an origin, access set or sensitivity.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Conflict`], [`HostError::Invalid`] (a message
    /// starting `STORE_PROVENANCE_REQUIRED` for an envelope refusal), [`HostError::TooLarge`],
    /// [`HostError::Busy`].
    fn doc_put(
        &self,
        _space: &str,
        _doc: DocumentWrite,
        _expect: Expect,
    ) -> Result<DocMeta, HostError> {
        not_granted("documents_write")
    }
    /// Grant `documents_write`: delete a document (a tombstone change).
    ///
    /// # Errors
    /// As [`HostServices::doc_put`], and [`HostError::NotFound`].
    fn doc_delete(
        &self,
        _space: &str,
        _id: &str,
        _expect: Expect,
        _envelope: Envelope,
    ) -> Result<Rev, HostError> {
        not_granted("documents_write")
    }
    /// Grant `records`: one record of the instance's own namespace.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn record_get(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
    ) -> Result<Option<Record>, HostError> {
        not_granted("records")
    }
    /// Grant `records`: readable records of one kind, ordered by id, after `after`.
    ///
    /// # Errors
    /// As [`HostServices::record_get`], and [`HostError::Invalid`] for a bad limit.
    fn record_list(
        &self,
        _space: &str,
        _kind: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Page<Record>, HostError> {
        not_granted("records")
    }
    /// Grant `records_write`: write a record of the instance's own namespace.
    ///
    /// # Errors
    /// As [`HostServices::doc_put`].
    fn record_put(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
        _body: Value,
        _envelope: Envelope,
        _expect: Expect,
    ) -> Result<RecordMeta, HostError> {
        not_granted("records_write")
    }
    /// Grant `index`: search the space's index under the caller's reader filter.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Invalid`] (a query error), [`HostError::Corrupt`],
    /// [`HostError::Io`].
    fn index_search(&self, _space: &str, _query: &IndexQuery) -> Result<Vec<ChunkHit>, HostError> {
        not_granted("index")
    }
    /// Grant `index`: the stored chunks of one readable document.
    ///
    /// # Errors
    /// As [`HostServices::index_search`].
    fn index_chunks(&self, _space: &str, _doc: &str) -> Result<Vec<IndexChunk>, HostError> {
        not_granted("index")
    }
    /// Grant `index`: the store revision the space's index reflects.
    ///
    /// # Errors
    /// As [`HostServices::index_search`].
    fn index_applied(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("index")
    }
    /// Grant `index_write`: take the space's index writer, waiting at most the lock timeout.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`] (retryable).
    fn index_writer(&self, _space: &str) -> Result<Box<dyn IndexWriterSession>, HostError> {
        not_granted("index_write")
    }
    /// Grant `graph`: the readable edges incident to a node, aggregated over readable origins.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Invalid`], [`HostError::Busy`], [`HostError::Io`].
    fn graph_neighbors(
        &self,
        _space: &str,
        _node: &str,
        _kinds: &[String],
        _direction: Direction,
        _limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: the readable ones among `ids`.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_nodes(&self, _space: &str, _ids: &[String]) -> Result<Vec<Node>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: readable edges of one kind, after `after`.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_edges(
        &self,
        _space: &str,
        _kind: &str,
        _after: Option<&EdgeKey>,
        _limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: the whole readable graph of the space.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_subgraph(&self, _space: &str) -> Result<Subgraph, HostError> {
        not_granted("graph")
    }
    /// Grant `graph_write`: replace the contributions of a batch's documents and record
    /// `applied`, in one transaction.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Conflict`], [`HostError::Invalid`],
    /// [`HostError::TooLarge`], [`HostError::Busy`].
    fn graph_apply(
        &self,
        _space: &str,
        _batch: GraphBatch,
        _applied: Rev,
    ) -> Result<(), HostError> {
        not_granted("graph_write")
    }
    /// A derivation read of the change log, ignoring the caller's reader filter. Needs
    /// `index_write` or `graph_write` for the space and a command with the `store-write` effect.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED`).
    fn derive_changes(
        &self,
        _space: &str,
        _after: Rev,
        _limit: u32,
    ) -> Result<Vec<Change>, HostError> {
        not_granted("index_write")
    }
    /// A derivation read of one document. The same rules as [`HostServices::derive_changes`].
    ///
    /// # Errors
    /// As [`HostServices::derive_changes`].
    fn derive_document(&self, _space: &str, _id: &str) -> Result<Option<Document>, HostError> {
        not_granted("index_write")
    }
    /// The read methods as another principal (`knowledge-eval`). Only in a command exposed to
    /// the CLI alone, when the call's actor is a human.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED`).
    fn as_reader(&self, _principal: &str) -> Result<Reader, HostError> {
        not_granted("documents")
    }
}

/// Services for a call whose plugin was granted nothing: every method answers `NotGranted`.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoServices;

pub(crate) fn not_granted<T>(grant: &str) -> Result<T, HostError> {
    Err(HostError::NotGranted(format!(
        "the grant `{grant}` was not declared or was denied"
    )))
}

impl HostServices for NoServices {
    fn config(&self) -> Result<Value, HostError> {
        not_granted("config")
    }
    fn log(&self, _level: Level, _message: &str) {}
    fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
        not_granted("packs")
    }
    fn pack_read(&self, _pack: &str, _path: &str) -> Result<Vec<u8>, HostError> {
        not_granted("packs")
    }
    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        not_granted("events")
    }
    fn now_ms(&self) -> Result<i64, HostError> {
        not_granted("clock")
    }
    fn random(&self) -> Result<f64, HostError> {
        not_granted("random")
    }
}

/// What a handler may use. Each method fails with [`HostError::NotGranted`] when the grant was
/// not declared or was denied.
pub struct Cx {
    call: CallContext,
    services: Services,
}

/// Where a handle's services come from. A component calls its imports directly (never through a
/// trait object), so an interface the plugin never uses is not imported by the component and the
/// manifest need not declare its grant.
enum Services {
    Dyn(Box<dyn HostServices>),
    #[cfg(feature = "component")]
    Component,
}

impl fmt::Debug for Cx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cx").field("call", &self.call).finish()
    }
}

impl Cx {
    /// A handle over `services` for the call `call`. Hosts build it; tests may too.
    pub fn new(call: CallContext, services: impl HostServices + 'static) -> Self {
        Self {
            call,
            services: Services::Dyn(Box::new(services)),
        }
    }

    /// A handle over the component's imports (the `component` feature).
    #[cfg(feature = "component")]
    pub(crate) fn component(call: CallContext) -> Self {
        Self {
            call,
            services: Services::Component,
        }
    }

    /// A handle with no grants: every service answers `NotGranted`.
    pub fn without_grants(call: CallContext) -> Self {
        Self::new(call, NoServices)
    }

    /// The command, trace id, space, actor summary and interface.
    pub fn call(&self) -> &CallContext {
        &self.call
    }

    /// The host services behind this handle, for the store methods. A component holds no store
    /// grant in protocol 1, so for one every store method answers `NotGranted`.
    pub(crate) fn host(&self) -> Result<&dyn HostServices, HostError> {
        match &self.services {
            Services::Dyn(services) => Ok(services.as_ref()),
            #[cfg(feature = "component")]
            Services::Component => not_granted("documents"),
        }
    }

    /// Grant `config`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn config(&self) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.config(),
            #[cfg(feature = "component")]
            Services::Component => crate::component::config(),
        }
    }

    /// Grant `log`; a no-op without the grant.
    pub fn log(&self, level: Level, message: &str) {
        match &self.services {
            Services::Dyn(services) => services.log(level, message),
            #[cfg(feature = "component")]
            Services::Component => crate::component::log(level, message),
        }
    }

    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_read`].
    pub fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_read(pack, path),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_read(pack, path),
        }
    }

    /// Grant `packs`: the files of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_list`].
    pub fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_list(pack),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_list(pack),
        }
    }

    /// Grant `events`.
    ///
    /// # Errors
    /// See [`HostServices::events`].
    pub fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.events(space, after, limit),
            #[cfg(feature = "component")]
            Services::Component => crate::component::events(space, after, limit),
        }
    }

    /// Grant `clock`: epoch milliseconds from the command context's clock.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn now_ms(&self) -> Result<i64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.now_ms(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::now_ms()),
        }
    }

    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn random(&self) -> Result<f64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.random(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::random()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handle_without_grants_answers_not_granted_everywhere() {
        let cx = Cx::without_grants(CallContext::default());
        assert!(matches!(cx.config(), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.pack_read("p", "data/x"),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.pack_list("p"), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.events(None, None, 10),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.now_ms(), Err(HostError::NotGranted(_))));
        assert!(matches!(cx.random(), Err(HostError::NotGranted(_))));
        cx.log(Level::Info, "a no-op");
    }
}
