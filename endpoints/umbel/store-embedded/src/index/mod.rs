//! `SearchIndex` on tantivy (specification sections 3.1, 3.2 and 8.1): one tantivy document per
//! chunk under `index/v1/`, an `MmapDirectory`, LZ4 named in the index settings, English stems
//! and the access set as a mandatory clause of every query.

mod query;
mod schema;
mod writer;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::Value;
use tantivy::collector::TopDocs;
use tantivy::directory::error::LockError;
use tantivy::directory::{INDEX_WRITER_LOCK, MmapDirectory};
use tantivy::query::Query;
use tantivy::schema::Value as _;
use tantivy::snippet::SnippetGenerator;
use tantivy::store::Compressor;
use tantivy::{
    Directory, Index, IndexBuilder, IndexReader, ReloadPolicy, Searcher, TantivyDocument,
    TantivyError, Term,
};
use umbel_store::{
    ChunkHit, IndexChunk, IndexQuery, IndexWriterSession, MAX_QUERY_LIMIT, ReaderFilter, Rev,
    SearchIndex, StoreError,
};

use crate::StoreOptions;
use schema::{Fields, SCHEMA_VERSION};

/// The directory under a space's state directory (`index/v1/`; the `v1` is the schema version).
const INDEX_DIR: &str = "index";
const SCHEMA_DIR: &str = "v1";
/// The writer's memory budget (one indexing thread).
const WRITER_BUDGET: usize = 64 * 1024 * 1024;
/// How often a waiter retries the writer lock.
const LOCK_POLL: Duration = Duration::from_millis(50);
/// A snippet's length, in characters (the concise form of section 8.2).
const SNIPPET_CHARS: usize = 240;
/// The most candidates `search` reads to settle ties at the cut-off.
const TIE_WINDOW: usize = 4096;
/// Scores are rounded to this many decimal places (section 8.2).
const SCORE_SCALE: f64 = 10_000.0;

/// What `store-show` and `store-backup` need to know about an index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexInfo {
    /// The store revision the index reflects.
    pub applied: Rev,
    /// The index schema version.
    pub schema_version: u32,
    /// Searchable segments.
    pub segments: usize,
    /// Chunks in the index.
    pub chunks: u64,
    /// The size of the index directory's files, in bytes.
    pub bytes: u64,
}

/// What the checksum validation found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexCheck {
    /// The files of live segments whose checksum does not match, by name. Empty when sound.
    pub damaged: Vec<String>,
}

/// One space's lexical index.
pub struct TantivyIndex {
    dir: PathBuf,
    index: Index,
    fields: Fields,
    reader: IndexReader,
    lock_timeout: Duration,
}

pub(crate) fn map_tantivy(error: &TantivyError) -> StoreError {
    match error {
        TantivyError::LockFailure(LockError::LockBusy, _) => StoreError::Busy,
        TantivyError::DataCorruption(_)
        | TantivyError::IncompatibleIndex(_)
        | TantivyError::SchemaError(_)
        | TantivyError::DeserializeError(_)
        | TantivyError::OpenReadError(_) => StoreError::Corrupt(error.to_string()),
        _ => StoreError::Io(error.to_string()),
    }
}

/// The revision a commit recorded, `0` for an index nothing was committed to.
pub(crate) fn read_applied(index: &Index) -> Result<Rev, StoreError> {
    let metas = index.load_metas().map_err(|e| map_tantivy(&e))?;
    let Some(payload) = metas.payload else {
        return Ok(0);
    };
    let value: Value = serde_json::from_str(&payload)
        .map_err(|e| StoreError::Corrupt(format!("the index's commit payload: {e}")))?;
    let field = |name: &str| value.get(name).and_then(Value::as_u64);
    let schema = field("schema")
        .and_then(|s| u32::try_from(s).ok())
        .ok_or_else(|| StoreError::Corrupt("the index's commit payload names no schema".into()))?;
    if schema > SCHEMA_VERSION {
        return Err(StoreError::VersionUnsupported {
            found: schema,
            supported: SCHEMA_VERSION,
        });
    }
    field("applied")
        .ok_or_else(|| StoreError::Corrupt("the index's commit payload names no revision".into()))
}

impl TantivyIndex {
    /// Open (creating when new) the index of `space` under `space_dir` (`state/spaces/<space>`).
    /// Several processes may do this at once: creation happens under tantivy's writer lock.
    ///
    /// # Errors
    /// `Busy` when the lock wait ran past the timeout, `VersionUnsupported` when the index is a
    /// newer schema, `Corrupt` when it is not the index this build writes, `Io` otherwise.
    pub fn open(space_dir: &Path, space: &str, options: StoreOptions) -> Result<Self, StoreError> {
        if !umbel_store::is_slug(space) {
            return Err(StoreError::invalid(
                "a space id must match ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        let dir = space_dir.join(INDEX_DIR).join(SCHEMA_DIR);
        std::fs::create_dir_all(&dir)
            .map_err(|e| StoreError::Io(format!("{}: {e}", dir.display())))?;
        let directory = MmapDirectory::open(&dir)
            .map_err(|e| StoreError::Io(format!("{}: {e}", dir.display())))?;
        let lock_timeout = Duration::from_millis(options.lock_timeout_ms);
        let (tantivy_schema, fields) = schema::build();
        let build = || {
            IndexBuilder::new()
                .schema(tantivy_schema.clone())
                .settings(schema::settings())
                .open_or_create(directory.clone())
                .map_err(|e| map_tantivy(&e))
        };
        // An index that exists is opened without the writer lock, so a reader never waits for an
        // indexer. Creating one is serialised with every indexer by that lock, and a process
        // that loses the race opens what the winner made.
        let index = if Index::exists(&directory).map_err(|e| StoreError::Io(e.to_string()))? {
            build()?
        } else {
            let deadline = Instant::now() + lock_timeout;
            loop {
                match directory.acquire_lock(&INDEX_WRITER_LOCK) {
                    Ok(_held) => break build()?,
                    Err(LockError::LockBusy) if Instant::now() < deadline => {
                        std::thread::sleep(LOCK_POLL);
                    }
                    Err(LockError::LockBusy) => return Err(StoreError::Busy),
                    Err(LockError::IoError(e)) => return Err(StoreError::Io(e.to_string())),
                }
            }
        };
        if index.settings().docstore_compression != Compressor::Lz4 {
            return Err(StoreError::Corrupt(
                "the index was not written with LZ4 compression".into(),
            ));
        }
        // A newer commit payload is refused here, not at the first search.
        read_applied(&index)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| map_tantivy(&e))?;
        Ok(Self {
            dir,
            index,
            fields,
            reader,
            lock_timeout,
        })
    }

    /// The index directory (`index/v1/`).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// A searcher over the latest commit, whoever made it.
    fn searcher(&self) -> Result<Searcher, StoreError> {
        self.reader.reload().map_err(|e| map_tantivy(&e))?;
        Ok(self.reader.searcher())
    }

    /// The index's revision, schema, segments, chunk count and size, for `store-show`.
    ///
    /// # Errors
    /// `Io` or `Corrupt` if the index cannot be read.
    pub fn info(&self) -> Result<IndexInfo, StoreError> {
        let searcher = self.searcher()?;
        let bytes = std::fs::read_dir(&self.dir)
            .map_err(|e| StoreError::Io(e.to_string()))?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .filter(std::fs::Metadata::is_file)
            .map(|m| m.len())
            .sum();
        Ok(IndexInfo {
            applied: read_applied(&self.index)?,
            schema_version: SCHEMA_VERSION,
            segments: searcher.segment_readers().len(),
            chunks: searcher.num_docs(),
            bytes,
        })
    }

    /// The number of chunks `reader` can read (all of them for a derivation read).
    ///
    /// # Errors
    /// `Io` or `Corrupt` if the index cannot be read.
    pub fn count_readable(&self, reader: &ReaderFilter) -> Result<u64, StoreError> {
        let searcher = self.searcher()?;
        let query: Box<dyn tantivy::query::Query> = match query::reader_clause(&self.fields, reader)
        {
            Some(clause) => clause,
            None => Box::new(tantivy::query::AllQuery),
        };
        let count = query.count(&searcher).map_err(|e| map_tantivy(&e))?;
        Ok(u64::try_from(count).unwrap_or(0))
    }

    /// Validate the checksum of every file of every live segment (`store-check`).
    ///
    /// # Errors
    /// `Io` or `Corrupt` if the index's metadata cannot be read.
    pub fn check(&self) -> Result<IndexCheck, StoreError> {
        let damaged = self
            .index
            .validate_checksum()
            .map_err(|e| map_tantivy(&e))?;
        let mut damaged: Vec<String> = damaged
            .into_iter()
            .map(|p| p.display().to_string())
            .collect();
        damaged.sort();
        Ok(IndexCheck { damaged })
    }

    /// The files a copy of the index must hold: `meta.json` and the live segments' files. A copy
    /// is consistent only while the caller holds the writer.
    ///
    /// # Errors
    /// `Io` or `Corrupt` if the index's metadata cannot be read.
    pub fn live_files(&self) -> Result<Vec<PathBuf>, StoreError> {
        let metas = self.index.load_metas().map_err(|e| map_tantivy(&e))?;
        let mut files: Vec<PathBuf> = vec![PathBuf::from("meta.json")];
        files.extend(metas.list_segment_files());
        files.sort();
        files.dedup();
        Ok(files)
    }

    fn chunk_of(&self, document: &TantivyDocument) -> Result<IndexChunk, StoreError> {
        let text = |field| {
            document
                .get_first(field)
                .and_then(|v| v.as_str())
                .map(str::to_owned)
        };
        let blob = text(self.fields.chunk)
            .ok_or_else(|| StoreError::Corrupt("a stored chunk has no record".into()))?;
        let body = text(self.fields.body).unwrap_or_default();
        let mut value: Value = serde_json::from_str(&blob)
            .map_err(|e| StoreError::Corrupt(format!("a stored chunk: {e}")))?;
        if let Value::Object(map) = &mut value {
            map.insert("body".to_owned(), Value::String(body));
        }
        serde_json::from_value(value)
            .map_err(|e| StoreError::Corrupt(format!("a stored chunk: {e}")))
    }

    /// A stored chunk's document id and ordinal.
    fn address(&self, document: &TantivyDocument) -> Result<(String, u64), StoreError> {
        let doc = document
            .get_first(self.fields.doc)
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| StoreError::Corrupt("a stored chunk has no document id".into()))?;
        let ordinal = document
            .get_first(self.fields.ordinal)
            .and_then(|v| v.as_u64())
            .ok_or_else(|| StoreError::Corrupt("a stored chunk has no ordinal".into()))?;
        Ok((doc, ordinal))
    }
}

/// A score as the integer its fourth decimal place makes: what ordering compares.
#[allow(clippy::cast_possible_truncation)]
fn rounded(score: f32) -> i64 {
    (f64::from(score) * SCORE_SCALE).round() as i64
}

/// The highlighted fragment with `**` around each match, or `None` when nothing matched.
fn highlight(snippet: &tantivy::snippet::Snippet) -> Option<String> {
    let fragment = snippet.fragment();
    if fragment.is_empty() || snippet.highlighted().is_empty() {
        return None;
    }
    let mut out = String::with_capacity(fragment.len() + 8);
    let mut at = 0;
    for range in snippet.highlighted() {
        out.push_str(&fragment[at..range.start]);
        out.push_str("**");
        out.push_str(&fragment[range.clone()]);
        out.push_str("**");
        at = range.end;
    }
    out.push_str(&fragment[at..]);
    Some(out)
}

impl SearchIndex for TantivyIndex {
    fn writer(&self) -> Result<Box<dyn IndexWriterSession>, StoreError> {
        let deadline = Instant::now() + self.lock_timeout;
        loop {
            match self
                .index
                .writer_with_num_threads::<TantivyDocument>(1, WRITER_BUDGET)
            {
                Ok(writer) => {
                    let session = writer::Session::new(&self.index, writer, self.fields.clone())?;
                    return Ok(Box::new(session));
                }
                Err(TantivyError::LockFailure(LockError::LockBusy, _))
                    if Instant::now() < deadline =>
                {
                    std::thread::sleep(LOCK_POLL);
                }
                Err(e) => return Err(map_tantivy(&e)),
            }
        }
    }

    fn applied(&self) -> Result<Rev, StoreError> {
        read_applied(&self.index)
    }

    fn search(&self, q: &IndexQuery, reader: &ReaderFilter) -> Result<Vec<ChunkHit>, StoreError> {
        if q.limit == 0 || q.limit > MAX_QUERY_LIMIT {
            return Err(StoreError::invalid(format!(
                "a query limit is 1 to {MAX_QUERY_LIMIT}"
            )));
        }
        let query: Box<dyn Query> =
            query::build(&self.index, &self.fields, &q.text, &q.filters, reader)?;
        let searcher = self.searcher()?;
        let limit = q.limit as usize;
        // Read one past the limit; while the extra candidate ties the last one (to four decimals)
        // widen the window, so which tied chunks make the cut never depends on segment order.
        let mut window = limit + 1;
        let scored = loop {
            let found = searcher
                .search(&*query, &TopDocs::with_limit(window).order_by_score())
                .map_err(|e| map_tantivy(&e))?;
            let settled = found.len() < window
                || window >= TIE_WINDOW
                || found
                    .last()
                    .zip(found.get(limit - 1))
                    .is_none_or(|(next, last)| rounded(next.0) < rounded(last.0));
            if settled {
                break found;
            }
            window = (window * 4).min(TIE_WINDOW);
        };
        let cutoff = scored.get(limit - 1).map(|(score, _)| rounded(*score));
        let mut candidates: Vec<(i64, String, u64, TantivyDocument)> =
            Vec::with_capacity(scored.len());
        for (score, address) in scored {
            let score = rounded(score);
            if cutoff.is_some_and(|c| score < c) {
                continue;
            }
            let document: TantivyDocument = searcher.doc(address).map_err(|e| map_tantivy(&e))?;
            let (doc, ordinal) = self.address(&document)?;
            candidates.push((score, doc, ordinal, document));
        }
        candidates.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.cmp(&b.1))
                .then(a.2.cmp(&b.2))
        });
        candidates.truncate(limit);
        let generator = SnippetGenerator::create(&searcher, &*query, self.fields.body)
            .ok()
            .map(|mut g| {
                g.set_max_num_chars(SNIPPET_CHARS);
                g
            });
        candidates
            .into_iter()
            .map(|(score, _, _, document)| {
                let chunk = self.chunk_of(&document)?;
                let snippet = generator
                    .as_ref()
                    .and_then(|g| highlight(&g.snippet(&chunk.body)));
                #[allow(clippy::cast_possible_truncation)]
                let score = (score as f64 / SCORE_SCALE) as f32;
                Ok(ChunkHit {
                    doc: chunk.doc.clone(),
                    ordinal: chunk.ordinal,
                    score,
                    snippet,
                    chunk,
                })
            })
            .collect()
    }

    fn chunks(&self, doc: &str, reader: &ReaderFilter) -> Result<Vec<IndexChunk>, StoreError> {
        let clause = query::constant(Box::new(tantivy::query::TermQuery::new(
            Term::from_field_text(self.fields.doc, doc),
            tantivy::schema::IndexRecordOption::Basic,
        )));
        let mut clauses = vec![(tantivy::query::Occur::Must, clause)];
        if let Some(access) = query::reader_clause(&self.fields, reader) {
            clauses.push((tantivy::query::Occur::Must, query::constant(access)));
        }
        let all = tantivy::query::BooleanQuery::new(clauses);
        let searcher = self.searcher()?;
        let found = searcher
            .search(
                &all,
                &TopDocs::with_limit(schema::MAX_CHUNKS_PER_DOCUMENT + 1).order_by_score(),
            )
            .map_err(|e| map_tantivy(&e))?;
        let mut chunks = Vec::with_capacity(found.len());
        for (_, address) in found {
            let document: TantivyDocument = searcher.doc(address).map_err(|e| map_tantivy(&e))?;
            chunks.push(self.chunk_of(&document)?);
        }
        chunks.sort_by_key(|c| c.ordinal);
        Ok(chunks)
    }
}
