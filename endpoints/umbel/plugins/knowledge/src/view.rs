//! What a search reads, as the call's own caller or, for `knowledge-eval`, as another principal.
//!
//! [`Cx`] and [`Reader`] (the read methods of `Cx::as_reader`) have the same read methods under
//! two types. `knowledge-search` and `knowledge-eval` run **one** ranking code path over this
//! trait, so an evaluation is of the code that serves searches, not of a copy of it.

use umbel_sdk::{Cx, HostError, Reader};
use umbel_store::{
    Change, ChunkHit, Direction, DocMeta, Edge, IndexChunk, IndexQuery, ListQuery, Page, Rev,
};

/// The read methods a search uses, under one reader filter.
pub(crate) trait View {
    fn doc_list(&self, space: &str, query: &ListQuery) -> Result<Page<DocMeta>, HostError>;
    fn doc_changes(&self, space: &str, after: Rev, limit: u32) -> Result<Vec<Change>, HostError>;
    fn index_search(&self, space: &str, query: &IndexQuery) -> Result<Vec<ChunkHit>, HostError>;
    fn index_chunks(&self, space: &str, doc: &str) -> Result<Vec<IndexChunk>, HostError>;
    fn index_applied(&self, space: &str) -> Result<Rev, HostError>;
    fn graph_applied(&self, space: &str) -> Result<Rev, HostError>;
    fn graph_neighbors(
        &self,
        space: &str,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
    ) -> Result<Vec<Edge>, HostError>;
}

macro_rules! view {
    ($owner:ty) => {
        impl View for $owner {
            fn doc_list(&self, space: &str, query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
                <$owner>::doc_list(self, space, query)
            }
            fn doc_changes(
                &self,
                space: &str,
                after: Rev,
                limit: u32,
            ) -> Result<Vec<Change>, HostError> {
                <$owner>::doc_changes(self, space, after, limit, None)
            }
            fn index_search(
                &self,
                space: &str,
                query: &IndexQuery,
            ) -> Result<Vec<ChunkHit>, HostError> {
                <$owner>::index_search(self, space, query)
            }
            fn index_chunks(&self, space: &str, doc: &str) -> Result<Vec<IndexChunk>, HostError> {
                <$owner>::index_chunks(self, space, doc)
            }
            fn index_applied(&self, space: &str) -> Result<Rev, HostError> {
                <$owner>::index_applied(self, space)
            }
            fn graph_applied(&self, space: &str) -> Result<Rev, HostError> {
                <$owner>::graph_applied(self, space)
            }
            fn graph_neighbors(
                &self,
                space: &str,
                node: &str,
                kinds: &[String],
                direction: Direction,
                limit: u32,
            ) -> Result<Vec<Edge>, HostError> {
                <$owner>::graph_neighbors(self, space, node, kinds, direction, limit)
            }
        }
    };
}

view!(Cx);
view!(Reader);
