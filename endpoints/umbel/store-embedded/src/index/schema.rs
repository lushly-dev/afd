//! Index schema 2 (specification section 8.1; phase 5 section 9.1): one tantivy document per
//! chunk. Schema 2 is schema 1 with a `u64` fast field per scored field (`len_title`,
//! `len_body`, ...) holding the chunk's exact token count in that field, so the statistics of a
//! search can be summed over the chunks its reader may read, never from the quantized field
//! norms.

use serde_json::{Map, Value, json};
use tantivy::schema::document::{ReferenceValue, ReferenceValueLeaf};
use tantivy::schema::{
    DateOptions, Field, FieldType, IndexRecordOption, JsonObjectOptions, NumericOptions, Schema,
    TextFieldIndexing, TextOptions,
};
use tantivy::store::Compressor;
use tantivy::tokenizer::{MAX_TOKEN_LEN, TokenizerManager};
use tantivy::{IndexSettings, TantivyDocument};
use umbel_store::{IndexChunk, StoreError};

/// The schema version, part of the directory name (`index/v2/`) and of every commit payload.
pub(crate) const SCHEMA_VERSION: u32 = 2;
/// The directory of this schema under a space's `index/`.
pub const SCHEMA_DIR: &str = "v2";
/// The directories of earlier schemas, removed when this one opens: an index is derived data, and
/// one left behind would keep the text of documents forgotten since.
pub(crate) const RETIRED_DIRS: &[&str] = &["v1"];

/// The tokenizer of the prose fields: lower-cased, split on non-alphanumerics, English stems.
pub(crate) const STEMMED: &str = "en_stem";
/// The tokenizer of the code and path fields: lower-cased, no stemming.
pub(crate) const PLAIN: &str = "default";
/// One term, as written.
pub(crate) const RAW: &str = "raw";
/// The document id's field, also a fast field, so a search orders tied chunks by it.
pub(crate) const DOC_FIELD: &str = "doc";

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
    /// Each scored field with the fast field holding its exact token count per chunk.
    pub(crate) lengths: Vec<Length>,
}

/// A scored field and its exact token count (phase 5 section 9.1).
#[derive(Clone, Copy)]
pub(crate) struct Length {
    /// The indexed field.
    pub(crate) field: Field,
    /// The `u64` fast field with the field's token count in each chunk.
    pub(crate) len: Field,
    /// The fast field's name, which the fast-field reader takes.
    pub(crate) name: &'static str,
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
    let mut fields = Fields {
        doc: b.add_text_field("doc", raw().set_stored().set_fast(RAW)),
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
        lengths: Vec::new(),
    };
    // Every field a query's text may name (section 8.1), and so every field a query can score;
    // `doc` and `access` only ever filter, under a constant score.
    let scored = [
        (fields.title, "len_title"),
        (fields.aliases, "len_aliases"),
        (fields.description, "len_description"),
        (fields.headings, "len_headings"),
        (fields.body, "len_body"),
        (fields.code, "len_code"),
        (fields.tags, "len_tags"),
        (fields.owners, "len_owners"),
        (fields.doc_type, "len_type"),
        (fields.collection, "len_collection"),
        (fields.status, "len_status"),
        (fields.verified, "len_verified"),
        (fields.sensitivity, "len_sensitivity"),
        (fields.lang, "len_lang"),
        (fields.path, "len_path"),
        (fields.path_raw, "len_path_raw"),
        (fields.meta, "len_meta"),
    ];
    for (field, name) in scored {
        let len = b.add_u64_field(name, NumericOptions::default().set_fast());
        fields.lengths.push(Length { field, len, name });
    }
    (b.build(), fields)
}

/// The tokens tantivy indexes for one value of a field: what its analyzer emits, less any token
/// over [`MAX_TOKEN_LEN`] bytes, which the indexer drops. A JSON value counts each leaf as the
/// indexer does: a string's tokens, one token for a number, boolean or date (none for a
/// non-finite number or `null`), the entries of arrays and objects, and no entry whose key holds
/// the path separator byte.
fn count_value<'a, V: tantivy::schema::Value<'a>>(
    value: V,
    tokenizers: &TokenizerManager,
    tokenizer: &str,
) -> Result<u64, StoreError> {
    Ok(match value.as_value() {
        ReferenceValue::Leaf(leaf) => match leaf {
            ReferenceValueLeaf::Null => 0,
            ReferenceValueLeaf::Str(text) => {
                let mut analyzer = tokenizers.get(tokenizer).ok_or_else(|| {
                    StoreError::Corrupt(format!("the tokenizer `{tokenizer}` is not registered"))
                })?;
                let mut stream = analyzer.token_stream(text);
                let mut count = 0;
                while stream.advance() {
                    if stream.token().text.len() <= MAX_TOKEN_LEN {
                        count += 1;
                    }
                }
                count
            }
            ReferenceValueLeaf::F64(number) => u64::from(number.is_finite()),
            _ => 1,
        },
        ReferenceValue::Array(values) => {
            let mut count = 0;
            for value in values {
                count += count_value(value, tokenizers, tokenizer)?;
            }
            count
        }
        ReferenceValue::Object(entries) => {
            let mut count = 0;
            for (key, value) in entries {
                if !key.as_bytes().contains(&0u8) {
                    count += count_value(value, tokenizers, tokenizer)?;
                }
            }
            count
        }
    })
}

/// The tokenizer a text or JSON field is indexed with.
fn tokenizer_of(schema: &Schema, field: Field) -> &str {
    let options = match schema.get_field_entry(field).field_type() {
        FieldType::Str(options) => options.get_indexing_options(),
        FieldType::JsonObject(options) => options.get_text_indexing_options(),
        _ => None,
    };
    options.map_or("default", TextFieldIndexing::tokenizer)
}

/// Add each scored field's exact token count to `document`, counting as the indexer counts.
fn add_lengths(
    schema: &Schema,
    fields: &Fields,
    tokenizers: &TokenizerManager,
    document: &mut TantivyDocument,
) -> Result<(), StoreError> {
    let mut counts = Vec::with_capacity(fields.lengths.len());
    for length in &fields.lengths {
        let tokenizer = tokenizer_of(schema, length.field);
        let mut count = 0;
        for value in document.get_all(length.field) {
            count += count_value(value, tokenizers, tokenizer)?;
        }
        counts.push((length.len, count));
    }
    for (len, count) in counts {
        document.add_u64(len, count);
    }
    Ok(())
}

/// The index's settings. LZ4 is named, never defaulted: the compressor is part of the schema.
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
    fields: &Fields,
    tokenizers: &TokenizerManager,
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
    let mut document = TantivyDocument::parse_json(schema, &Value::Object(json).to_string())
        .map_err(|e| {
            StoreError::invalid(format!(
                "chunk {} of `{}` does not index: {e}",
                chunk.ordinal, chunk.doc
            ))
        })?;
    add_lengths(schema, fields, tokenizers, &mut document)?;
    Ok(document)
}
