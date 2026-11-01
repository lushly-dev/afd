//! The writer session (specification sections 3.1, 3.2 and 8.7): tantivy's own exclusive writer
//! lock serialises indexers across threads and processes. The session never lowers the index's
//! applied revision, and a commit records the revision atomically with the staged changes.

use std::collections::HashSet;

use tantivy::schema::Schema;
use tantivy::{Index, IndexWriter, TantivyDocument, Term};
use umbel_store::{DocId, IndexChunk, IndexWriterSession, Rev, StoreError};

use super::schema::{self, Fields, MAX_CHUNKS_PER_DOCUMENT};
use super::{map_tantivy, read_applied};

/// One exclusive writer on the space's index.
pub(crate) struct Session {
    writer: Option<IndexWriter<TantivyDocument>>,
    schema: Schema,
    fields: Fields,
    /// The revision the index reflects, read under the lock and moved by this session's commit.
    applied: Rev,
}

impl Session {
    /// Wrap a writer that already holds the lock; reads `applied` now, under it.
    pub(crate) fn new(
        index: &Index,
        writer: IndexWriter<TantivyDocument>,
        fields: Fields,
    ) -> Result<Self, StoreError> {
        Ok(Self {
            writer: Some(writer),
            schema: index.schema(),
            fields,
            applied: read_applied(index)?,
        })
    }

    fn open(&mut self) -> Result<&mut IndexWriter<TantivyDocument>, StoreError> {
        self.writer
            .as_mut()
            .ok_or_else(|| StoreError::invalid("this writer session is finished"))
    }
}

impl IndexWriterSession for Session {
    fn applied(&self) -> Result<Rev, StoreError> {
        Ok(self.applied)
    }

    fn replace(&mut self, doc: &DocId, chunks: Vec<IndexChunk>) -> Result<(), StoreError> {
        if chunks.len() > MAX_CHUNKS_PER_DOCUMENT {
            return Err(StoreError::TooLarge(format!(
                "a document has at most {MAX_CHUNKS_PER_DOCUMENT} chunks"
            )));
        }
        let mut ordinals = HashSet::new();
        let mut documents = Vec::with_capacity(chunks.len());
        for chunk in &chunks {
            if !ordinals.insert(chunk.ordinal) {
                return Err(StoreError::invalid(format!(
                    "`{doc}` has two chunks with ordinal {}",
                    chunk.ordinal
                )));
            }
            documents.push(schema::document(&self.schema, doc, chunk)?);
        }
        let doc_field = self.fields.doc;
        let writer = self.open()?;
        // The delete covers the chunks of earlier commits and earlier staged work; the adds after
        // it survive.
        writer.delete_term(Term::from_field_text(doc_field, doc));
        for document in documents {
            writer.add_document(document).map_err(|e| map_tantivy(&e))?;
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), StoreError> {
        self.open()?
            .delete_all_documents()
            .map_err(|e| map_tantivy(&e))?;
        Ok(())
    }

    fn commit(&mut self, applied: Rev) -> Result<(), StoreError> {
        if applied < self.applied {
            return Err(StoreError::Conflict {
                current: Some(self.applied.to_string()),
            });
        }
        let payload = serde_json::json!({ "applied": applied, "schema": schema::SCHEMA_VERSION })
            .to_string();
        let writer = self.open()?;
        let mut prepared = writer.prepare_commit().map_err(|e| map_tantivy(&e))?;
        prepared.set_payload(&payload);
        prepared.commit().map_err(|e| map_tantivy(&e))?;
        self.applied = applied;
        // Let the merges this commit made eligible finish while the lock is still held, so no
        // merge runs after the lock is released (`store-backup` relies on that). A merge that
        // fails leaves the committed segments in place; the commit stands.
        if let Some(writer) = self.writer.take() {
            let _ = writer.wait_merging_threads();
        }
        Ok(())
    }

    fn abort(&mut self) {
        // Dropping the writer discards what was staged and releases the lock.
        self.writer = None;
    }
}
