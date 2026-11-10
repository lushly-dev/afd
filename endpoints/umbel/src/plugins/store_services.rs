//! The store grants of a call (phase 2 specification, section 3.3): documents, records, the
//! index, the graph, derivation reads and `as_reader`, each scoped to the call's spaces, each
//! read filtered by the caller's reader filter, each write checked against the instance's `allow`
//! entries and given the call's provenance.
//!
//! Compiled plugins are trusted code (owner decision 1 of 2026-11-01): these gates are API
//! discipline and a declaration to the deployer, not a sandbox.

use std::sync::Arc;

use serde_json::Value;
use umbel_sdk::{CollectionMeta, HostError as ServiceError, HostServices, Reader};
use umbel_store::{
    AccessSet, Actor, ActorKind, Change, ChunkHit, Direction, DocMeta, Document, DocumentWrite,
    Edge, EdgeKey, Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession,
    ListQuery, Node, Page, ReaderFilter, Record, RecordMeta, Rev, Subgraph,
};

use super::grants::CallServices;
use crate::access::{Caller, effective_principal_of, reader_filter};
use crate::store::{SpaceStores, codes, host_error};

type Result<T> = std::result::Result<T, ServiceError>;

/// A `NotGranted` whose message names `STORE_WRITE_NOT_ALLOWED`.
fn write_not_allowed(message: impl std::fmt::Display) -> ServiceError {
    ServiceError::NotGranted(format!("{}: {message}", codes::STORE_WRITE_NOT_ALLOWED))
}

/// Whether `entries` (an `allow` list) cover `space` and, for the collection-level grants,
/// `collection`.
pub(super) fn allows(entries: &[String], space: &str, collection: Option<&str>) -> bool {
    entries.iter().any(|entry| match collection {
        Some(collection) => entry
            .split_once('/')
            .is_some_and(|(s, c)| s == space && (c == "*" || c == collection)),
        None => entry == "*" || entry == space,
    })
}

/// The grants that write the stores; a checkpoint is maintenance after any of them.
const WRITE_GRANTS: [&str; 4] = [
    "documents_write",
    "records_write",
    "index_write",
    "graph_write",
];

/// Whether any entry of an `allow` list names `space`, whatever the collection.
fn allows_space(entries: &[String], space: &str) -> bool {
    entries.iter().any(|entry| {
        entry == "*" || entry == space || entry.split_once('/').is_some_and(|(s, _)| s == space)
    })
}

impl CallServices {
    /// A read or write on `space` needs `grant` and a space of this call.
    pub(super) fn scoped(&self, grant: &str, space: &str) -> Result<()> {
        self.require(grant)?;
        if self
            .spaces()
            .iter()
            .any(|allowed| allowed.as_str() == space)
        {
            Ok(())
        } else {
            Err(ServiceError::NotGranted(format!(
                "the space `{space}` is not one of this call's spaces ({}); a store grant is scoped to the spaces the call named",
                self.spaces()
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )))
        }
    }

    /// Writes need a call that is not `as_reader`'s read-only view.
    pub(super) fn writable(&self) -> Result<()> {
        if self.read_only {
            Err(write_not_allowed("a Reader holds no write grant"))
        } else {
            Ok(())
        }
    }

    /// The write grant `grant` on `space` (and `collection`), against the instance's `allow`
    /// entries: a write outside them is `STORE_WRITE_NOT_ALLOWED` (rule 1).
    pub(super) fn allowed(&self, grant: &str, space: &str, collection: Option<&str>) -> Result<()> {
        self.scoped(grant, space)?;
        self.writable()?;
        let entries = self.shared.allow.get(grant).map_or(&[][..], Vec::as_slice);
        if allows(entries, space, collection) {
            Ok(())
        } else {
            Err(write_not_allowed(format!(
                "the instance `{}` may not use `{grant}` on {}; list it under [plugins.{}.grants.{grant}] allow in umbel.toml",
                self.shared.instance,
                collection.map_or_else(|| format!("`{space}`"), |c| format!("`{space}/{c}`")),
                self.shared.instance
            )))
        }
    }

    pub(super) fn note_use(&self) {
        self.shared
            .ledger
            .note_use(self.context.trace_id.as_deref().unwrap_or_default());
    }

    fn note_write(&self, rev: Rev) {
        self.shared
            .ledger
            .note_write(self.context.trace_id.as_deref().unwrap_or_default(), rev);
    }

    /// The reader filter of the caller in `space`; `SPACE_NOT_READABLE` is `NotGranted`.
    pub(super) fn filter(&self, space: &str) -> Result<ReaderFilter> {
        let config = self.shared.workspace.config();
        let caller = Caller::of(config, &self.context);
        // Claim groups are the caller's own: reading as another principal gets none, and keeps
        // this call's narrowing (phase 5 section 5.4).
        let caller = match &self.as_principal {
            Some(principal) => caller.reading_as(config, Some(principal.clone())),
            None => caller,
        };
        reader_filter(config, space, &caller)
            .map_err(|error| ServiceError::NotGranted(format!("{}: {}", error.code, error.message)))
    }

    fn stores(&self, space: &str) -> Result<Arc<SpaceStores>> {
        self.shared.stores.space(space).map_err(host_error)
    }

    /// Read access to `space` under `grant`: the stores and the caller's filter.
    fn reading(&self, grant: &str, space: &str) -> Result<(Arc<SpaceStores>, ReaderFilter)> {
        self.scoped(grant, space)?;
        let filter = self.filter(space)?;
        self.note_use();
        Ok((self.stores(space)?, filter))
    }

    /// Write access to `space` under `grant` for `collection`.
    fn writing(
        &self,
        grant: &str,
        space: &str,
        collection: Option<&str>,
    ) -> Result<Arc<SpaceStores>> {
        self.allowed(grant, space, collection)?;
        self.note_use();
        self.stores(space)
    }

    /// The call's actor when its kind is `agent`, `service` or `script`: the envelope's and a
    /// memory record's `agent`.
    pub(super) fn agent_actor(&self) -> Option<Actor> {
        self.context.actor.as_ref().and_then(|actor| {
            let kind = match actor.kind {
                afd::ActorKind::Agent => ActorKind::Agent,
                afd::ActorKind::Service => ActorKind::Service,
                afd::ActorKind::Script => ActorKind::Script,
                _ => return None,
            };
            Some(Actor {
                kind,
                id: actor.id.clone(),
                label: actor.label.clone(),
                on_behalf_of: actor.on_behalf_of.clone(),
            })
        })
    }

    /// The envelope of a write, with the identity fields the host owns filled from the call,
    /// overwriting what the plugin sent (rule 4): the space, plugin, agent, principal, trace id,
    /// time and, in version 3, the delegation chain (phase 5 step 6); then checked: a known
    /// version, an origin that is not `unspecified`, a valid access set and a sensitivity.
    fn seal(&self, space: &str, mut envelope: Envelope) -> Result<Envelope> {
        envelope.space = space.to_owned();
        envelope.plugin = Some(self.shared.instance.clone());
        envelope.agent = self.agent_actor();
        envelope.principal = effective_principal_of(&self.context);
        envelope.trace_id = self.context.trace_id.clone();
        // Filled only by the host (phase 5 section 2.4): a version 3 envelope records the writing
        // principal's chain, whatever the plugin sent, and no earlier version holds one. A
        // document or a record is never confirmed (only `memory-confirm` is, by the memory
        // services), so a confirmation a plugin sends is dropped.
        envelope.delegation_chain =
            (envelope.version >= 3).then(|| crate::principal::Principal::chain_of(&self.context));
        envelope.confirmation = None;
        envelope.observed_at = chrono::DateTime::from_timestamp_millis(self.context.clock().now())
            .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_default();
        envelope.check(space).map_err(|error| {
            ServiceError::Invalid(format!("{}: {error}", codes::STORE_PROVENANCE_REQUIRED))
        })?;
        Ok(envelope)
    }

    /// A derivation read: for a command with the `store-write` effect whose instance holds
    /// `index_write` or `graph_write` for `space` (rule 3).
    fn deriving(&self, space: &str) -> Result<Arc<SpaceStores>> {
        self.task_guard()?;
        let command = self
            .command
            .as_deref()
            .and_then(|name| self.shared.commands.get(name));
        if !command.is_some_and(|policy| policy.store_write) {
            return Err(write_not_allowed(
                "a derivation read needs a command with the `store-write` effect",
            ));
        }
        self.writable()?;
        let held = ["index_write", "graph_write"].into_iter().any(|grant| {
            self.shared.granted.contains(grant)
                && allows(
                    self.shared.allow.get(grant).map_or(&[][..], Vec::as_slice),
                    space,
                    None,
                )
        });
        if !held {
            return Err(write_not_allowed(format!(
                "a derivation read of `{space}` needs `index_write` or `graph_write` allowed for it"
            )));
        }
        if !self
            .spaces()
            .iter()
            .any(|allowed| allowed.as_str() == space)
        {
            return Err(ServiceError::NotGranted(format!(
                "the space `{space}` is not one of this call's spaces"
            )));
        }
        self.note_use();
        self.stores(space)
    }

    /// Read access to the files of `space` under `grant`: the caller may read the space.
    pub(super) fn content_scope(&self, grant: &str, space: &str) -> Result<()> {
        self.scoped(grant, space)?;
        self.filter(space)?;
        self.note_use();
        Ok(())
    }

    /// Write access to the files of `collection` in `space`: the `content_write` allow list.
    pub(super) fn content_write_scope(&self, space: &str, collection: &str) -> Result<()> {
        self.allowed("content_write", space, Some(collection))?;
        self.note_use();
        Ok(())
    }

    pub(super) fn svc_doc_get(&self, space: &str, id: &str) -> Result<Option<Document>> {
        let (stores, filter) = self.reading("documents", space)?;
        stores
            .documents
            .get_document(id, &filter)
            .map_err(host_error)
    }

    /// The space's collections whose default access set the caller's reader filter admits, as
    /// metadata only (phase 4 step 4, amendment 1): under `documents`, since it says of a
    /// collection only who reads the documents in it, which reading them under the same filter
    /// already says. Nothing of a collection's root, globs or files.
    pub(super) fn svc_readable_collections(&self, space: &str) -> Result<Vec<CollectionMeta>> {
        self.scoped("documents", space)?;
        let filter = self.filter(space)?;
        self.note_use();
        let config = self.shared.workspace.config();
        let declared = config
            .spaces
            .iter()
            .find(|declared| declared.id.as_str() == space)
            .ok_or_else(|| {
                ServiceError::NotFound(format!("the space `{space}` is not declared"))
            })?;
        Ok(declared
            .collections
            .iter()
            .filter(|collection| {
                AccessSet::new(collection.access.iter().map(String::as_str))
                    .is_ok_and(|access| filter.admits(&access))
            })
            .map(|collection| CollectionMeta {
                id: collection.id.clone(),
                kind: collection.kind.as_str().to_owned(),
                access: collection.access.clone(),
                sensitivity: collection.sensitivity.clone(),
            })
            .collect())
    }

    pub(super) fn svc_reader_tokens(&self, space: &str) -> Result<Vec<String>> {
        self.scoped("documents", space)?;
        let filter = self.filter(space)?;
        Ok(filter
            .token_list()
            .map(<[String]>::to_vec)
            .unwrap_or_default())
    }

    pub(super) fn svc_doc_list(&self, space: &str, query: &ListQuery) -> Result<Page<DocMeta>> {
        let (stores, filter) = self.reading("documents", space)?;
        stores
            .documents
            .list_documents(query, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_doc_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<Change>> {
        let (stores, filter) = self.reading("documents", space)?;
        stores
            .documents
            .changes(after, limit, &filter, trace)
            .map_err(host_error)
    }

    /// How this call's caller sees positions (phase 5 section 9.3): the call's own caller, never
    /// a principal read as.
    fn presenter(&self) -> Result<crate::positions::Presenter> {
        let caller = Caller::of(self.shared.workspace.config(), &self.context);
        crate::positions::Presenter::of(&self.shared.workspace, &caller)
            .map_err(|error| ServiceError::Io(format!("{}: {}", error.code, error.message)))
    }

    pub(super) fn svc_doc_position(&self, space: &str, rev: Rev) -> Result<Value> {
        let (stores, filter) = self.reading("documents", space)?;
        let presenter = self.presenter()?;
        if !presenter.seals() {
            return Ok(Value::from(rev));
        }
        let last = stores
            .documents
            .last_readable_document(rev, &filter)
            .map_err(host_error)?;
        Ok(presenter.revision(space, last))
    }

    pub(super) fn svc_doc_position_of(&self, space: &str, value: &Value) -> Result<Rev> {
        self.scoped("documents", space)?;
        self.filter(space)?;
        let presenter = self.presenter()?;
        let rev = if presenter.seals() {
            value
                .as_str()
                .and_then(|text| presenter.open(crate::positions::Kind::Revision, space, text))
        } else {
            value.as_u64()
        };
        rev.ok_or_else(|| {
            ServiceError::Invalid(if presenter.seals() {
                "not a revision this space gave you; pass one as it was returned".to_owned()
            } else {
                "a revision is a non-negative integer".to_owned()
            })
        })
    }

    pub(super) fn svc_doc_put(
        &self,
        space: &str,
        mut doc: DocumentWrite,
        expect: Expect,
    ) -> Result<DocMeta> {
        let collection = doc.collection.clone();
        let stores = self.writing("documents_write", space, Some(&collection))?;
        if doc.space != space {
            return Err(ServiceError::Invalid(format!(
                "the document names the space `{}`, not `{space}`",
                doc.space
            )));
        }
        doc.envelope = self.seal(space, doc.envelope)?;
        let meta = stores
            .documents
            .put_document(doc, expect)
            .map_err(host_error)?;
        self.note_write(meta.rev);
        Ok(meta)
    }

    pub(super) fn svc_doc_delete(
        &self,
        space: &str,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev> {
        let collection = id.split_once('/').map_or(id, |(collection, _)| collection);
        let stores = self.writing("documents_write", space, Some(collection))?;
        let envelope = self.seal(space, envelope)?;
        let rev = stores
            .documents
            .delete_document(id, expect, envelope)
            .map_err(host_error)?;
        self.note_write(rev);
        Ok(rev)
    }

    pub(super) fn svc_record_get(
        &self,
        space: &str,
        kind: &str,
        id: &str,
    ) -> Result<Option<Record>> {
        let (stores, filter) = self.reading("records", space)?;
        stores
            .documents
            .get_record(&self.shared.instance, kind, id, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_record_list(
        &self,
        space: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<Record>> {
        let (stores, filter) = self.reading("records", space)?;
        stores
            .documents
            .list_records(&self.shared.instance, kind, after, limit, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_record_put(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta> {
        let stores = self.writing("records_write", space, None)?;
        let envelope = self.seal(space, envelope)?;
        let meta = stores
            .documents
            .put_record(&self.shared.instance, kind, id, body, envelope, expect)
            .map_err(host_error)?;
        self.note_write(meta.rev);
        Ok(meta)
    }

    /// The change log's hashes of a record's earlier versions, forgotten (phase 4 section 9.1):
    /// a write grant on the instance's own namespace, as `record_put` needs.
    pub(super) fn svc_record_forget_history(
        &self,
        space: &str,
        kind: &str,
        id: &str,
    ) -> Result<u64> {
        let stores = self.writing("records_write", space, None)?;
        stores
            .documents
            .forget_record_history(&self.shared.instance, kind, id)
            .map_err(host_error)
    }

    pub(super) fn svc_index_search(
        &self,
        space: &str,
        query: &IndexQuery,
    ) -> Result<Vec<ChunkHit>> {
        let (stores, filter) = self.reading("index", space)?;
        stores.index.search(query, &filter).map_err(host_error)
    }

    pub(super) fn svc_index_chunks(&self, space: &str, doc: &str) -> Result<Vec<IndexChunk>> {
        let (stores, filter) = self.reading("index", space)?;
        stores.index.chunks(doc, &filter).map_err(host_error)
    }

    pub(super) fn svc_index_applied(&self, space: &str) -> Result<Rev> {
        let (stores, _filter) = self.reading("index", space)?;
        stores.index.applied().map_err(host_error)
    }

    pub(super) fn svc_index_writer(&self, space: &str) -> Result<Box<dyn IndexWriterSession>> {
        let stores = self.writing("index_write", space, None)?;
        let session = stores.index.writer().map_err(host_error)?;
        Ok(Box::new(GuardedWriter {
            inner: session,
            services: self.guard_view(),
        }))
    }

    /// What a writer session needs to run a task's guard after the call that opened it returned.
    fn guard_view(&self) -> GuardView {
        GuardView {
            workspace: Arc::clone(&self.shared.workspace),
            context: self.context.clone(),
            spaces: self.spaces().to_vec(),
            revoked: self.revoked(),
        }
    }

    pub(super) fn svc_graph_neighbors(
        &self,
        space: &str,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
    ) -> Result<Vec<Edge>> {
        let (stores, filter) = self.reading("graph", space)?;
        stores
            .graph
            .neighbors(node, kinds, direction, limit, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_graph_nodes(&self, space: &str, ids: &[String]) -> Result<Vec<Node>> {
        let (stores, filter) = self.reading("graph", space)?;
        stores.graph.nodes(ids, &filter).map_err(host_error)
    }

    pub(super) fn svc_graph_edges(
        &self,
        space: &str,
        kind: &str,
        after: Option<&EdgeKey>,
        limit: u32,
    ) -> Result<Vec<Edge>> {
        let (stores, filter) = self.reading("graph", space)?;
        stores
            .graph
            .edges_of_kind(kind, limit, after, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_graph_subgraph(&self, space: &str) -> Result<Subgraph> {
        let (stores, filter) = self.reading("graph", space)?;
        // The embedded backend serves the whole-graph read from its per-process cache, keyed by
        // the graph's applied revision, the store's head and the reader filter (step 3, C5).
        #[cfg(feature = "store-embedded")]
        {
            stores
                .sqlite
                .readable_graph(&filter)
                .map(|graph| graph.to_subgraph())
                .map_err(host_error)
        }
        #[cfg(not(feature = "store-embedded"))]
        {
            stores.graph.subgraph(&filter).map_err(host_error)
        }
    }

    pub(super) fn svc_graph_applied(&self, space: &str) -> Result<Rev> {
        let (stores, _filter) = self.reading("graph", space)?;
        stores.graph.applied().map_err(host_error)
    }

    pub(super) fn svc_graph_apply(
        &self,
        space: &str,
        batch: GraphBatch,
        applied: Rev,
    ) -> Result<()> {
        let stores = self.writing("graph_write", space, None)?;
        stores.graph.apply(batch, applied).map_err(host_error)
    }

    pub(super) fn svc_derive_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
    ) -> Result<Vec<Change>> {
        let stores = self.deriving(space)?;
        stores
            .documents
            .changes(after, limit, &ReaderFilter::derivation(), None)
            .map_err(host_error)
    }

    pub(super) fn svc_derive_document(&self, space: &str, id: &str) -> Result<Option<Document>> {
        let stores = self.deriving(space)?;
        stores
            .documents
            .get_document(id, &ReaderFilter::derivation())
            .map_err(host_error)
    }

    /// The store's true head: a count of every change, readable or not, so only a derivation read
    /// sees it (rule 3; the hidden-count side channel of section 6).
    pub(super) fn svc_derive_head(&self, space: &str) -> Result<Rev> {
        let stores = self.deriving(space)?;
        stores.documents.head().map_err(host_error)
    }

    /// Best-effort maintenance after a run that wrote: the instance must hold a write grant
    /// allowed for the space (a `Reader`'s view holds none).
    pub(super) fn svc_checkpoint(&self, space: &str) -> Result<()> {
        self.maintaining(space)?;
        self.stores(space)?
            .documents
            .checkpoint()
            .map_err(host_error)
    }

    /// A reporting checkpoint (phase 4 section 9.1): `wal_checkpoint(TRUNCATE)` on the space's
    /// `store.sqlite3` with no lock wait, answering `Clean` or `Pending`, under the same rules as
    /// [`Self::svc_checkpoint`]. A redaction says with it whether the removed bytes are gone.
    pub(super) fn svc_truncate_wal(&self, space: &str) -> Result<umbel_sdk::WalCheckpoint> {
        self.maintaining(space)?;
        let stores = self.stores(space)?;
        #[cfg(feature = "store-embedded")]
        {
            use umbel_store_embedded::WalCheckpoint as Embedded;
            stores
                .sqlite
                .truncate_wal()
                .map(|state| match state {
                    Embedded::Clean => umbel_sdk::WalCheckpoint::Clean,
                    Embedded::Pending => umbel_sdk::WalCheckpoint::Pending,
                })
                .map_err(host_error)
        }
        #[cfg(not(feature = "store-embedded"))]
        {
            let _ = stores;
            Err(ServiceError::Io(
                "this build of umbel links no store backend (feature store-embedded)".to_owned(),
            ))
        }
    }

    /// Store maintenance needs a writable call holding a write grant allowed for `space`, in one
    /// of the call's spaces.
    fn maintaining(&self, space: &str) -> Result<()> {
        self.task_guard()?;
        self.writable()?;
        let held = WRITE_GRANTS.iter().any(|grant| {
            self.shared.granted.contains(*grant)
                && self
                    .shared
                    .allow
                    .get(*grant)
                    .is_some_and(|entries| allows_space(entries, space))
        });
        if !held {
            return Err(write_not_allowed(format!(
                "a checkpoint of `{space}` needs a store write grant allowed for it"
            )));
        }
        if !self
            .spaces()
            .iter()
            .any(|allowed| allowed.as_str() == space)
        {
            return Err(ServiceError::NotGranted(format!(
                "the space `{space}` is not one of this call's spaces"
            )));
        }
        self.note_use();
        Ok(())
    }

    pub(super) fn svc_as_reader(&self, principal: &str) -> Result<Reader> {
        self.task_guard()?;
        let policy = self
            .command
            .as_deref()
            .and_then(|name| self.shared.commands.get(name));
        let human = self
            .context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == afd::ActorKind::Human);
        if !policy.is_some_and(|policy| policy.cli_only) || !human {
            return Err(write_not_allowed(
                "as_reader works only in a command exposed to the CLI alone, for a human",
            ));
        }
        crate::workspace::parse_principal(principal).map_err(ServiceError::Invalid)?;
        self.note_use();
        let reader = self.read_only_view(principal);
        Ok(Reader::new(Box::new(reader) as Box<dyn HostServices>))
    }
}

/// A task's guard, held by an index writer session ([`CallServices::task_guard`]).
struct GuardView {
    workspace: Arc<crate::workspace::Workspace>,
    context: afd::CommandContext,
    spaces: Vec<crate::workspace::SpaceId>,
    revoked: Arc<std::sync::atomic::AtomicBool>,
}

impl GuardView {
    fn check(&self) -> umbel_store::Result<()> {
        match super::grants::task_guard(self.workspace.config(), &self.context, &self.spaces) {
            Ok(()) => Ok(()),
            Err(refusal) => {
                if refusal == super::grants::Refusal::Unreadable {
                    self.revoked
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                }
                Err(umbel_store::StoreError::Invalid(format!(
                    "the task running this call {}, so its index writer stages and commits nothing more",
                    match refusal {
                        super::grants::Refusal::Stopped => "was stopped",
                        super::grants::Refusal::Unreadable => "can no longer read its space",
                    }
                )))
            }
        }
    }
}

/// An index writer session that runs a task's guard before each step that changes the index, so a
/// stopped task commits nothing more, even with a session it opened before it was stopped.
struct GuardedWriter {
    inner: Box<dyn IndexWriterSession>,
    services: GuardView,
}

impl IndexWriterSession for GuardedWriter {
    fn applied(&self) -> umbel_store::Result<Rev> {
        self.inner.applied()
    }

    fn replace(
        &mut self,
        doc: &umbel_store::DocId,
        chunks: Vec<IndexChunk>,
    ) -> umbel_store::Result<()> {
        self.services.check()?;
        self.inner.replace(doc, chunks)
    }

    fn clear(&mut self) -> umbel_store::Result<()> {
        self.services.check()?;
        self.inner.clear()
    }

    fn commit(&mut self, applied: Rev) -> umbel_store::Result<()> {
        self.services.check()?;
        self.inner.commit(applied)
    }

    fn abort(&mut self) {
        self.inner.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::allows;

    fn list(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|e| (*e).to_owned()).collect()
    }

    #[test]
    fn allow_entries_match_spaces_and_collections() {
        let docs = list(&["main/handbook", "beta/*"]);
        assert!(allows(&docs, "main", Some("handbook")));
        assert!(!allows(&docs, "main", Some("secret")));
        assert!(allows(&docs, "beta", Some("anything")));
        assert!(!allows(&docs, "gamma", Some("handbook")));
        let spaces = list(&["main"]);
        assert!(allows(&spaces, "main", None));
        assert!(!allows(&spaces, "beta", None));
        assert!(allows(&list(&["*"]), "beta", None));
        assert!(!allows(&[], "main", None));
    }
}
