//! The store methods of [`Cx`] (phase 2 specification, section 3.3): files, documents, records,
//! the index, the graph, derivation reads and `as_reader`, each granted separately and scoped to
//! the call's spaces.
//!
//! Every method takes the space explicitly and the host refuses a space outside
//! [`CallContext::spaces`](crate::CallContext::spaces). [`Cx::in_space`] binds one space after
//! the same check, so a multi-space handler writes `cx.in_space("beta")?.index_search(&query)`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use umbel_store::{
    Change, ChunkHit, ContentHash, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, Record, RecordMeta, Rev, Subgraph,
};

use crate::cx::{Cx, HostError, HostServices};

/// One file of a collection, as `content_list` reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentEntry {
    /// The path relative to the collection root, with `/` separators.
    pub path: String,
    /// The size in bytes.
    pub size: u64,
    /// The modification time, in milliseconds since the Unix epoch.
    pub mtime_ms: i64,
}

/// One collection of a space as the workspace declares it (`[spaces.<id>.collections.<cid>]`),
/// without its root: a plugin addresses files by collection and relative path, and no path
/// outside the collection ever reaches it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionInfo {
    /// The collection id.
    pub id: String,
    /// `markdown` or `code`.
    pub kind: String,
    /// Globset patterns of the files to read.
    pub include: Vec<String>,
    /// Globset patterns of the files to skip.
    pub exclude: Vec<String>,
    /// The default access set of its documents (tokens).
    pub access: Vec<String>,
    /// The default sensitivity of its documents.
    pub sensitivity: String,
    /// The type of a file without frontmatter or without `type`.
    pub default_type: String,
    /// Whether a file whose frontmatter fails the schema is skipped.
    pub strict: bool,
    /// The largest file read, in bytes.
    pub max_file_bytes: u64,
}

/// The read methods as another principal, from [`Cx::as_reader`]: the same filter the host
/// builds for that principal in the call's spaces, and nothing that writes.
pub struct Reader {
    services: Box<dyn HostServices>,
}

impl Reader {
    /// A reader over services that answer the read methods; the host builds it.
    pub fn new(services: Box<dyn HostServices>) -> Self {
        Self { services }
    }
}

impl std::fmt::Debug for Reader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Reader").finish_non_exhaustive()
    }
}

/// Where the read methods find their services.
trait Services {
    fn services(&self) -> Result<&dyn HostServices, HostError>;
    /// The call's spaces are checked here as well as by the host.
    fn guard(&self, space: &str) -> Result<(), HostError>;
}

impl Services for Cx {
    fn services(&self) -> Result<&dyn HostServices, HostError> {
        self.host()
    }

    fn guard(&self, space: &str) -> Result<(), HostError> {
        self.check_space(space)
    }
}

impl Services for Reader {
    fn services(&self) -> Result<&dyn HostServices, HostError> {
        Ok(self.services.as_ref())
    }

    fn guard(&self, _space: &str) -> Result<(), HostError> {
        // The host built the reader for the call's spaces and checks each read.
        Ok(())
    }
}

macro_rules! reads {
    ($owner:ty) => {
        impl $owner {
            /// Grant `documents`: one document, or `None` when absent or not readable.
            ///
            /// # Errors
            /// See [`HostServices::doc_get`].
            pub fn doc_get(&self, space: &str, id: &str) -> Result<Option<Document>, HostError> {
                self.guard(space)?;
                self.services()?.doc_get(space, id)
            }
            /// Grant `documents`: readable documents, ordered by id.
            ///
            /// # Errors
            /// See [`HostServices::doc_list`].
            pub fn doc_list(
                &self,
                space: &str,
                query: &ListQuery,
            ) -> Result<Page<DocMeta>, HostError> {
                self.guard(space)?;
                self.services()?.doc_list(space, query)
            }
            /// Grant `documents`: the readable changes after `after`.
            ///
            /// # Errors
            /// See [`HostServices::doc_changes`].
            pub fn doc_changes(
                &self,
                space: &str,
                after: Rev,
                limit: u32,
                trace: Option<&str>,
            ) -> Result<Vec<Change>, HostError> {
                self.guard(space)?;
                self.services()?.doc_changes(space, after, limit, trace)
            }
            /// Grant `records`: one record of the instance's own namespace.
            ///
            /// # Errors
            /// See [`HostServices::record_get`].
            pub fn record_get(
                &self,
                space: &str,
                kind: &str,
                id: &str,
            ) -> Result<Option<Record>, HostError> {
                self.guard(space)?;
                self.services()?.record_get(space, kind, id)
            }
            /// Grant `records`: readable records of one kind.
            ///
            /// # Errors
            /// See [`HostServices::record_list`].
            pub fn record_list(
                &self,
                space: &str,
                kind: &str,
                after: Option<&str>,
                limit: u32,
            ) -> Result<Page<Record>, HostError> {
                self.guard(space)?;
                self.services()?.record_list(space, kind, after, limit)
            }
            /// Grant `index`: search under the reader filter.
            ///
            /// # Errors
            /// See [`HostServices::index_search`].
            pub fn index_search(
                &self,
                space: &str,
                query: &IndexQuery,
            ) -> Result<Vec<ChunkHit>, HostError> {
                self.guard(space)?;
                self.services()?.index_search(space, query)
            }
            /// Grant `index`: the stored chunks of one readable document.
            ///
            /// # Errors
            /// See [`HostServices::index_chunks`].
            pub fn index_chunks(
                &self,
                space: &str,
                doc: &str,
            ) -> Result<Vec<IndexChunk>, HostError> {
                self.guard(space)?;
                self.services()?.index_chunks(space, doc)
            }
            /// Grant `index`: the revision the space's index reflects.
            ///
            /// # Errors
            /// See [`HostServices::index_applied`].
            pub fn index_applied(&self, space: &str) -> Result<Rev, HostError> {
                self.guard(space)?;
                self.services()?.index_applied(space)
            }
            /// Grant `graph`: the readable edges incident to a node.
            ///
            /// # Errors
            /// See [`HostServices::graph_neighbors`].
            pub fn graph_neighbors(
                &self,
                space: &str,
                node: &str,
                kinds: &[String],
                direction: Direction,
                limit: u32,
            ) -> Result<Vec<Edge>, HostError> {
                self.guard(space)?;
                self.services()?
                    .graph_neighbors(space, node, kinds, direction, limit)
            }
            /// Grant `graph`: the readable ones among `ids`.
            ///
            /// # Errors
            /// See [`HostServices::graph_nodes`].
            pub fn graph_nodes(&self, space: &str, ids: &[String]) -> Result<Vec<Node>, HostError> {
                self.guard(space)?;
                self.services()?.graph_nodes(space, ids)
            }
            /// Grant `graph`: readable edges of one kind, after `after`.
            ///
            /// # Errors
            /// See [`HostServices::graph_edges`].
            pub fn graph_edges(
                &self,
                space: &str,
                kind: &str,
                after: Option<&EdgeKey>,
                limit: u32,
            ) -> Result<Vec<Edge>, HostError> {
                self.guard(space)?;
                self.services()?.graph_edges(space, kind, after, limit)
            }
            /// Grant `graph`: the whole readable graph of the space.
            ///
            /// # Errors
            /// See [`HostServices::graph_subgraph`].
            pub fn graph_subgraph(&self, space: &str) -> Result<Subgraph, HostError> {
                self.guard(space)?;
                self.services()?.graph_subgraph(space)
            }
        }
    };
}

reads!(Cx);
reads!(Reader);

impl Cx {
    /// Check that `space` is one of the call's spaces; the host checks again.
    fn check_space(&self, space: &str) -> Result<(), HostError> {
        if self.call().spaces.iter().any(|allowed| allowed == space) {
            Ok(())
        } else {
            Err(HostError::NotGranted(format!(
                "the space `{space}` is not one of this call's spaces ({}); the grant `documents` and its siblings are scoped to the spaces the call named",
                self.call().spaces.join(", ")
            )))
        }
    }

    /// Bind one space of the call for the store methods.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] when `space` is not one of the call's spaces.
    pub fn in_space(&self, space: &str) -> Result<SpaceCx<'_>, HostError> {
        self.check_space(space)?;
        Ok(SpaceCx {
            cx: self,
            space: space.to_owned(),
        })
    }

    /// Grant `content`: the files of one collection of the space, sorted by path.
    ///
    /// # Errors
    /// See [`HostServices::content_list`].
    pub fn content_list(
        &self,
        space: &str,
        collection: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<ContentEntry>, HostError> {
        self.check_space(space)?;
        self.host()?.content_list(space, collection, after, limit)
    }

    /// Grant `content`: the collections of the space, in configuration order.
    ///
    /// # Errors
    /// See [`HostServices::content_collections`].
    pub fn content_collections(&self, space: &str) -> Result<Vec<CollectionInfo>, HostError> {
        self.check_space(space)?;
        self.host()?.content_collections(space)
    }

    /// Grant `content`: one file of a collection.
    ///
    /// # Errors
    /// See [`HostServices::content_read`].
    pub fn content_read(
        &self,
        space: &str,
        collection: &str,
        path: &str,
    ) -> Result<Vec<u8>, HostError> {
        self.check_space(space)?;
        self.host()?.content_read(space, collection, path)
    }

    /// Grant `content_write`: replace or create one file after checking `expect`.
    ///
    /// # Errors
    /// See [`HostServices::content_replace`].
    pub fn content_replace(
        &self,
        space: &str,
        collection: &str,
        path: &str,
        bytes: &[u8],
        expect: Expect,
    ) -> Result<ContentHash, HostError> {
        self.check_space(space)?;
        self.host()?
            .content_replace(space, collection, path, bytes, expect)
    }

    /// Grant `documents_write`: write a document.
    ///
    /// # Errors
    /// See [`HostServices::doc_put`].
    pub fn doc_put(
        &self,
        space: &str,
        doc: DocumentWrite,
        expect: Expect,
    ) -> Result<DocMeta, HostError> {
        self.check_space(space)?;
        self.host()?.doc_put(space, doc, expect)
    }

    /// Grant `documents_write`: delete a document.
    ///
    /// # Errors
    /// See [`HostServices::doc_delete`].
    pub fn doc_delete(
        &self,
        space: &str,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, HostError> {
        self.check_space(space)?;
        self.host()?.doc_delete(space, id, expect, envelope)
    }

    /// Grant `records_write`: write a record of the instance's own namespace.
    ///
    /// # Errors
    /// See [`HostServices::record_put`].
    pub fn record_put(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, HostError> {
        self.check_space(space)?;
        self.host()?
            .record_put(space, kind, id, body, envelope, expect)
    }

    /// Grant `index_write`: take the space's index writer.
    ///
    /// # Errors
    /// See [`HostServices::index_writer`].
    pub fn index_writer(&self, space: &str) -> Result<Box<dyn IndexWriterSession>, HostError> {
        self.check_space(space)?;
        self.host()?.index_writer(space)
    }

    /// Grant `graph_write`: apply a batch and record `applied`, in one transaction.
    ///
    /// # Errors
    /// See [`HostServices::graph_apply`].
    pub fn graph_apply(
        &self,
        space: &str,
        batch: GraphBatch,
        applied: Rev,
    ) -> Result<(), HostError> {
        self.check_space(space)?;
        self.host()?.graph_apply(space, batch, applied)
    }

    /// A derivation read of the change log, for a command that builds derived data.
    ///
    /// # Errors
    /// See [`HostServices::derive_changes`].
    pub fn derive_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
    ) -> Result<Vec<Change>, HostError> {
        self.check_space(space)?;
        self.host()?.derive_changes(space, after, limit)
    }

    /// A derivation read of one document.
    ///
    /// # Errors
    /// See [`HostServices::derive_document`].
    pub fn derive_document(&self, space: &str, id: &str) -> Result<Option<Document>, HostError> {
        self.check_space(space)?;
        self.host()?.derive_document(space, id)
    }

    /// The read methods as another principal, in the call's spaces.
    ///
    /// # Errors
    /// See [`HostServices::as_reader`].
    pub fn as_reader(&self, principal: &str) -> Result<Reader, HostError> {
        self.host()?.as_reader(principal)
    }
}

/// One space of a call, bound by [`Cx::in_space`].
pub struct SpaceCx<'a> {
    cx: &'a Cx,
    space: String,
}

impl SpaceCx<'_> {
    /// The bound space.
    #[must_use]
    pub fn space(&self) -> &str {
        &self.space
    }

    /// Grant `content`: the files of one collection.
    ///
    /// # Errors
    /// See [`Cx::content_list`].
    pub fn content_list(
        &self,
        collection: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<ContentEntry>, HostError> {
        self.cx.content_list(&self.space, collection, after, limit)
    }

    /// Grant `content`: the collections of the space.
    ///
    /// # Errors
    /// See [`Cx::content_collections`].
    pub fn content_collections(&self) -> Result<Vec<CollectionInfo>, HostError> {
        self.cx.content_collections(&self.space)
    }

    /// Grant `content`: one file.
    ///
    /// # Errors
    /// See [`Cx::content_read`].
    pub fn content_read(&self, collection: &str, path: &str) -> Result<Vec<u8>, HostError> {
        self.cx.content_read(&self.space, collection, path)
    }

    /// Grant `documents`: one document.
    ///
    /// # Errors
    /// See [`Cx::doc_get`].
    pub fn doc_get(&self, id: &str) -> Result<Option<Document>, HostError> {
        self.cx.doc_get(&self.space, id)
    }

    /// Grant `documents`: readable documents.
    ///
    /// # Errors
    /// See [`Cx::doc_list`].
    pub fn doc_list(&self, query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
        self.cx.doc_list(&self.space, query)
    }

    /// Grant `index`: search under the reader filter.
    ///
    /// # Errors
    /// See [`Cx::index_search`].
    pub fn index_search(&self, query: &IndexQuery) -> Result<Vec<ChunkHit>, HostError> {
        self.cx.index_search(&self.space, query)
    }

    /// Grant `index`: the chunks of one readable document.
    ///
    /// # Errors
    /// See [`Cx::index_chunks`].
    pub fn index_chunks(&self, doc: &str) -> Result<Vec<IndexChunk>, HostError> {
        self.cx.index_chunks(&self.space, doc)
    }

    /// Grant `index`: the revision the index reflects.
    ///
    /// # Errors
    /// See [`Cx::index_applied`].
    pub fn index_applied(&self) -> Result<Rev, HostError> {
        self.cx.index_applied(&self.space)
    }

    /// Grant `graph`: the readable edges incident to a node.
    ///
    /// # Errors
    /// See [`Cx::graph_neighbors`].
    pub fn graph_neighbors(
        &self,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        self.cx
            .graph_neighbors(&self.space, node, kinds, direction, limit)
    }

    /// Grant `graph`: the readable ones among `ids`.
    ///
    /// # Errors
    /// See [`Cx::graph_nodes`].
    pub fn graph_nodes(&self, ids: &[String]) -> Result<Vec<Node>, HostError> {
        self.cx.graph_nodes(&self.space, ids)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::cx::CallContext;
    use umbel_store::{Direction, ListQuery};

    fn cx(spaces: &[&str]) -> Cx {
        Cx::without_grants(CallContext {
            spaces: spaces.iter().map(|s| (*s).to_owned()).collect(),
            ..CallContext::default()
        })
    }

    #[test]
    fn a_handle_without_grants_answers_not_granted_for_every_store_method() {
        let cx = cx(&["main"]);
        let not_granted = |result: Result<(), HostError>| {
            assert!(
                matches!(result, Err(HostError::NotGranted(_))),
                "{result:?}"
            );
        };
        not_granted(cx.content_list("main", "c", None, 10).map(drop));
        not_granted(cx.content_read("main", "c", "a.md").map(drop));
        not_granted(cx.doc_get("main", "c/a").map(drop));
        not_granted(cx.doc_list("main", &ListQuery::all(10)).map(drop));
        not_granted(cx.doc_changes("main", 0, 10, None).map(drop));
        not_granted(cx.record_get("main", "k", "i").map(drop));
        not_granted(cx.record_list("main", "k", None, 10).map(drop));
        not_granted(cx.index_applied("main").map(drop));
        not_granted(cx.index_writer("main").map(drop));
        not_granted(cx.graph_nodes("main", &[]).map(drop));
        not_granted(
            cx.graph_neighbors("main", "n", &[], Direction::Both, 10)
                .map(drop),
        );
        not_granted(cx.graph_subgraph("main").map(drop));
        not_granted(cx.derive_changes("main", 0, 10).map(drop));
        not_granted(cx.derive_document("main", "c/a").map(drop));
        not_granted(cx.as_reader("human:ada").map(drop));
    }

    #[test]
    fn in_space_binds_only_a_space_of_the_call() {
        let cx = cx(&["main", "beta"]);
        assert_eq!(cx.in_space("beta").unwrap().space(), "beta");
        let refused = cx.in_space("other").map(drop);
        assert!(
            matches!(refused, Err(HostError::NotGranted(_))),
            "{refused:?}"
        );
        // The explicit forms refuse a space outside the call too, before any grant is consulted.
        let outside = cx.doc_get("other", "c/a").map(drop);
        match outside {
            Err(HostError::NotGranted(message)) => assert!(message.contains("other"), "{message}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn host_errors_display_their_kind() {
        let shown = [
            HostError::Conflict {
                current: Some("sha256:ab".into()),
            },
            HostError::Conflict { current: None },
            HostError::Busy("wait".into()),
            HostError::Corrupt("bad".into()),
            HostError::Io("disk".into()),
        ]
        .map(|e| e.to_string());
        assert!(shown[0].contains("sha256:ab"));
        assert!(shown[1].starts_with("conflict"));
        assert!(shown[2].starts_with("busy"));
        assert!(shown[3].starts_with("corrupt"));
        assert!(shown[4].starts_with("i/o"));
    }
}
