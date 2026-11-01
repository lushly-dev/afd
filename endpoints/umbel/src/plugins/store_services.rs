//! The store grants of a call (phase 2 specification, section 3.3): documents, records, the
//! index, the graph, derivation reads and `as_reader`, each scoped to the call's spaces, each
//! read filtered by the caller's reader filter, each write checked against the instance's `allow`
//! entries and given the call's provenance.
//!
//! Compiled plugins are trusted code (owner decision 1 of 2026-11-01): these gates are API
//! discipline and a declaration to the deployer, not a sandbox.

use std::sync::Arc;

use serde_json::Value;
use umbel_sdk::{HostError as ServiceError, HostServices, Reader};
use umbel_store::{
    Actor, ActorKind, Change, ChunkHit, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, ReaderFilter, Record, RecordMeta, Rev, Subgraph,
};

use super::grants::CallServices;
use crate::access::{effective_principal_of, reader_filter};
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

impl CallServices {
    /// A read or write on `space` needs `grant` and a space of this call.
    fn scoped(&self, grant: &str, space: &str) -> Result<()> {
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
    fn writable(&self) -> Result<()> {
        if self.read_only {
            Err(write_not_allowed("a Reader holds no write grant"))
        } else {
            Ok(())
        }
    }

    /// The write grant `grant` on `space` (and `collection`), against the instance's `allow`
    /// entries: a write outside them is `STORE_WRITE_NOT_ALLOWED` (rule 1).
    fn allowed(&self, grant: &str, space: &str, collection: Option<&str>) -> Result<()> {
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

    fn note_use(&self) {
        self.shared
            .ledger
            .note_use(self.context.trace_id.as_deref().unwrap_or_default());
    }

    fn note_write(&self, rev: Rev) {
        self.shared
            .ledger
            .note_write(self.context.trace_id.as_deref().unwrap_or_default(), rev);
    }

    /// The effective principal reads are filtered for: the `as_reader` principal, else the
    /// caller's.
    fn reading_as(&self) -> Option<String> {
        self.as_principal
            .clone()
            .or_else(|| effective_principal_of(&self.context))
    }

    /// The reader filter of the caller in `space`; `SPACE_NOT_READABLE` is `NotGranted`.
    fn filter(&self, space: &str) -> Result<ReaderFilter> {
        reader_filter(
            self.shared.workspace.config(),
            space,
            self.reading_as().as_deref(),
        )
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

    /// The envelope of a write, with the identity fields the host owns filled from the call,
    /// overwriting what the plugin sent (rule 4), and checked: version 1, an origin that is not
    /// `unspecified`, a valid access set and a sensitivity.
    fn seal(&self, space: &str, mut envelope: Envelope) -> Result<Envelope> {
        envelope.space = space.to_owned();
        envelope.plugin = Some(self.shared.instance.clone());
        envelope.agent = self.context.actor.as_ref().and_then(|actor| {
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
        });
        envelope.principal = effective_principal_of(&self.context);
        envelope.trace_id = self.context.trace_id.clone();
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
        stores.index.writer().map_err(host_error)
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
        stores.graph.subgraph(&filter).map_err(host_error)
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

    pub(super) fn svc_as_reader(&self, principal: &str) -> Result<Reader> {
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
