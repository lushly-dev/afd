//! Index schema 1 (specification section 8.1): one tantivy document per chunk.

use serde_json::{Map, Value, json};
use tantivy::schema::{
    DateOptions, Field, IndexRecordOption, JsonObjectOptions, Schema, TextFieldIndexing,
    TextOptions,
};
use tantivy::store::Compressor;
use tantivy::{IndexSettings, TantivyDocument};
use umbel_store::{IndexChunk, StoreError};

/// The schema version, part of the directory name (`index/v1/`) and of every commit payload.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// The tokenizer of the prose fields: lower-cased, split on non-alphanumerics, English stems.
pub(crate) const STEMMED: &str = "en_stem";
/// The tokenizer of the code and path fields: lower-cased, no stemming.
pub(crate) const PLAIN: &str = "default";
/// One term, as written.
pub(crate) const RAW: &str = "raw";

/// The fields of schema 1.
#[derive(Clone)]
pub(crate) struct Fields {
    pub(crate) doc: Field,
    pub(crate) ordinal: Field,
    pub(crate) chunk: Field,
    pub(crate) title: Field,
    pub(crate) aliases: Field,
    pub(crate) description: Field,
    pub(crate) headings: Field,
    pub(crate) body: Field,
    pub(crate) code: Field,
    pub(crate) tags: Field,
    pub(crate) owners: Field,
    pub(crate) doc_type: Field,
    pub(crate) collection: Field,
    pub(crate) status: Field,
    pub(crate) verified: Field,
    pub(crate) sensitivity: Field,
    pub(crate) lang: Field,
    pub(crate) path: Field,
    pub(crate) path_raw: Field,
    pub(crate) updated: Field,
    pub(crate) stale_after: Field,
    pub(crate) meta: Field,
    pub(crate) access: Field,
}

fn text(tokenizer: &str) -> TextOptions {
    TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(tokenizer)
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    )
}

fn raw() -> TextOptions {
    TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(RAW)
            .set_index_option(IndexRecordOption::Basic),
    )
}

/// Build the schema and its field handles.
pub(crate) fn build() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let fields = Fields {
        doc: b.add_text_field("doc", raw().set_stored()),
        ordinal: b.add_u64_field(
            "ordinal",
            tantivy::schema::NumericOptions::default()
                .set_stored()
                .set_fast(),
        ),
        chunk: b.add_text_field("chunk", TextOptions::default().set_stored()),
        title: b.add_text_field("title", text(STEMMED)),
        aliases: b.add_text_field("aliases", text(STEMMED)),
        description: b.add_text_field("description", text(STEMMED)),
        headings: b.add_text_field("headings", text(STEMMED)),
        body: b.add_text_field("body", text(STEMMED).set_stored()),
        code: b.add_text_field("code", text(PLAIN)),
        tags: b.add_text_field("tags", raw()),
        owners: b.add_text_field("owners", raw()),
        doc_type: b.add_text_field("type", raw()),
        collection: b.add_text_field("collection", raw()),
        status: b.add_text_field("status", raw()),
        verified: b.add_text_field("verified", raw()),
        sensitivity: b.add_text_field("sensitivity", raw()),
        lang: b.add_text_field("lang", raw()),
        path: b.add_text_field("path", text(PLAIN)),
        path_raw: b.add_text_field("path_raw", raw()),
        updated: b.add_date_field("updated", DateOptions::default().set_indexed().set_fast()),
        stale_after: b.add_date_field(
            "stale_after",
            DateOptions::default().set_indexed().set_fast(),
        ),
        meta: b.add_json_field(
            "meta",
            JsonObjectOptions::default()
                .set_expand_dots_enabled()
                .set_indexing_options(
                    TextFieldIndexing::default()
                        .set_tokenizer(RAW)
                        .set_index_option(IndexRecordOption::Basic),
                ),
        ),
        access: b.add_text_field("access", raw()),
    };
    (b.build(), fields)
}

/// The index's settings. LZ4 is named, never defaulted: the compressor is part of schema 1.
pub(crate) fn settings() -> IndexSettings {
    IndexSettings {
        docstore_compression: Compressor::Lz4,
        ..IndexSettings::default()
    }
}

/// Most chunks one `replace` may add (section 7.2's cap per document).
pub(crate) const MAX_CHUNKS_PER_DOCUMENT: usize = 2000;
/// The longest chunk body, in bytes.
pub(crate) const MAX_CHUNK_BYTES: usize = 1024 * 1024;

fn join(parts: &[String]) -> String {
    parts.join(" ")
}

/// A chunk as the tantivy document it indexes. Checks the chunk first, so a bad chunk stages
/// nothing.
pub(crate) fn document(
    schema: &Schema,
    expected_doc: &str,
    chunk: &IndexChunk,
) -> Result<TantivyDocument, StoreError> {
    if chunk.doc != expected_doc {
        return Err(StoreError::invalid(format!(
            "a chunk of `{}` was given for `{expected_doc}`",
            chunk.doc
        )));
    }
    if chunk.body.len() > MAX_CHUNK_BYTES {
        return Err(StoreError::TooLarge(format!(
            "a chunk body is at most {MAX_CHUNK_BYTES} bytes"
        )));
    }
    // The stored blob holds everything but the body, which has its own stored field.
    let mut stored = serde_json::to_value(chunk).map_err(|e| StoreError::Io(e.to_string()))?;
    if let Value::Object(map) = &mut stored {
        map.remove("body");
    }
    let mut json = Map::new();
    let mut put = |name: &str, value: Value| {
        json.insert(name.to_owned(), value);
    };
    put("doc", json!(chunk.doc));
    put("ordinal", json!(chunk.ordinal));
    put("chunk", Value::String(stored.to_string()));
    put("title", json!(chunk.title));
    put("aliases", json!(join(&chunk.aliases)));
    if let Some(description) = &chunk.description {
        put("description", json!(description));
    }
    put("headings", json!(join(&chunk.heading_path)));
    put("body", json!(chunk.body));
    if let Some(code) = &chunk.code {
        put("code", json!(code));
    }
    put("tags", json!(chunk.tags));
    put("owners", json!(chunk.owners));
    put("type", json!(chunk.doc_type));
    put("collection", json!(chunk.collection));
    put("status", json!(chunk.status));
    put("verified", json!(chunk.verified));
    put("sensitivity", json!(chunk.sensitivity));
    if let Some(lang) = &chunk.lang {
        put("lang", json!(lang));
    }
    put("path", json!(chunk.path));
    put("path_raw", json!(chunk.path));
    if let Some(updated) = &chunk.updated {
        put("updated", json!(updated));
    }
    if let Some(stale_after) = &chunk.stale_after {
        put("stale_after", json!(stale_after));
    }
    if !chunk.meta.is_empty() {
        put("meta", Value::Object(chunk.meta.clone()));
    }
    put("access", json!(chunk.access.tokens()));
    TantivyDocument::parse_json(schema, &Value::Object(json).to_string()).map_err(|e| {
        StoreError::invalid(format!(
            "chunk {} of `{}` does not index: {e}",
            chunk.ordinal, chunk.doc
        ))
    })
}
