//! BM25 statistics per reader filter (phase 5 section 9.1, D125).
//!
//! tantivy's own statistics count every chunk of the index, deleted ones included, so a score
//! would move when a document its reader cannot read is written. A search scores through
//! [`Statistics`] instead, tantivy's `Bm25StatisticsProvider` over the chunks the reader may read:
//! - `doc_freq(term)` counts the readable live chunks holding the term;
//! - `total_num_docs` counts the readable live chunks;
//! - `total_num_tokens(field)` sums the exact per-chunk token counts the indexer wrote in the
//!   field's `len_<field>` fast field, never the quantized field norms.
//!
//! [`Readable`], the reader's live chunks per segment with the docs and tokens they hold, is
//! cached per (segment set, filter): a commit or a delete names a new segment set.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tantivy::index::SegmentId;
use tantivy::query::{AllQuery, Bm25StatisticsProvider, EnableScoring, Query};
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::{BitSet, DocSet, Searcher, TERMINATED, TantivyError, Term};
use umbel_store::{ReaderFilter, StoreError};

use super::map_tantivy;
use super::query::reader_clause;
use super::schema::Fields;

/// How many (segment set, filter) entries the cache keeps.
const CACHED: usize = 32;

/// The segments a searcher reads, each with the delete pass it reflects.
type SegmentSet = Vec<(SegmentId, Option<u64>)>;

/// The chunks one reader may read in one searcher's segments.
pub(crate) struct Readable {
    /// Per segment, in the searcher's order: the readable chunks that are not deleted.
    segments: Vec<BitSet>,
    /// How many there are.
    docs: u64,
    /// Per scored field, their exact token count.
    tokens: BTreeMap<Field, u64>,
}

impl Readable {
    /// Whether chunk `doc` of segment `segment` is readable and live.
    pub(crate) fn admits(&self, segment: usize, doc: u32) -> bool {
        self.segments
            .get(segment)
            .is_some_and(|set| doc < set.max_value() && set.contains(doc))
    }

    /// The readable live chunks holding `term`.
    pub(crate) fn doc_freq(&self, searcher: &Searcher, term: &Term) -> tantivy::Result<u64> {
        let mut count = 0u64;
        for (ord, segment) in searcher.segment_readers().iter().enumerate() {
            let inverted = segment.inverted_index(term.field())?;
            let Some(mut postings) = inverted.read_postings(term, IndexRecordOption::Basic)? else {
                continue;
            };
            let mut doc = postings.doc();
            while doc != TERMINATED {
                if self.admits(ord, doc) {
                    count += 1;
                }
                doc = postings.advance();
            }
        }
        Ok(count)
    }

    /// Read every readable live chunk of `searcher`, with its exact token counts.
    fn compute(
        searcher: &Searcher,
        fields: &Fields,
        reader: &ReaderFilter,
    ) -> Result<Self, StoreError> {
        let query: Box<dyn Query> =
            reader_clause(fields, reader).unwrap_or_else(|| Box::new(AllQuery));
        let weight = query
            .weight(EnableScoring::disabled_from_searcher(searcher))
            .map_err(|e| map_tantivy(&e))?;
        let mut segments = Vec::with_capacity(searcher.segment_readers().len());
        let mut docs = 0u64;
        let mut tokens: BTreeMap<Field, u64> =
            fields.lengths.iter().map(|l| (l.field, 0)).collect();
        for segment in searcher.segment_readers() {
            let mut columns = Vec::with_capacity(fields.lengths.len());
            for length in &fields.lengths {
                let column = segment
                    .fast_fields()
                    .u64(length.name)
                    .map_err(|e| map_tantivy(&e))?;
                columns.push((length.field, column));
            }
            let mut set = BitSet::with_max_value(segment.max_doc());
            let mut scorer = weight.scorer(segment, 1.0).map_err(|e| map_tantivy(&e))?;
            let mut doc = scorer.doc();
            while doc != TERMINATED {
                if !segment.is_deleted(doc) {
                    set.insert(doc);
                    docs += 1;
                    for (field, column) in &columns {
                        let count = column.first(doc).unwrap_or(0);
                        if let Some(total) = tokens.get_mut(field) {
                            *total += count;
                        }
                    }
                }
                doc = scorer.advance();
            }
            segments.push(set);
        }
        Ok(Self {
            segments,
            docs,
            tokens,
        })
    }
}

/// What a reader filter is cached under: its sorted tokens, or `None` for the derivation read.
type FilterKey = Option<Vec<String>>;

/// The per-filter statistics cache of one index.
#[derive(Default)]
pub(crate) struct Cache {
    entries: Mutex<Vec<(SegmentSet, FilterKey, Arc<Readable>)>>,
}

impl Cache {
    /// `reader`'s readable chunks in `searcher`, computed once per segment set and filter.
    pub(crate) fn readable(
        &self,
        searcher: &Searcher,
        fields: &Fields,
        reader: &ReaderFilter,
    ) -> Result<Arc<Readable>, StoreError> {
        let segments: SegmentSet = searcher
            .segment_readers()
            .iter()
            .map(|s| (s.segment_id(), s.delete_opstamp()))
            .collect();
        let key: FilterKey = reader.token_list().map(<[String]>::to_vec);
        if let Ok(entries) = self.entries.lock()
            && let Some((_, _, found)) =
                entries.iter().find(|(s, k, _)| *s == segments && *k == key)
        {
            return Ok(Arc::clone(found));
        }
        let computed = Arc::new(Readable::compute(searcher, fields, reader)?);
        if let Ok(mut entries) = self.entries.lock() {
            // A newer segment set makes every entry of an older one useless.
            entries.retain(|(s, _, _)| *s == segments);
            if entries.len() >= CACHED {
                entries.remove(0);
            }
            entries.push((segments, key, Arc::clone(&computed)));
        }
        Ok(computed)
    }
}

/// tantivy's BM25 statistics over one reader's readable chunks.
pub(crate) struct Statistics<'a> {
    pub(crate) searcher: &'a Searcher,
    pub(crate) readable: &'a Readable,
}

impl Bm25StatisticsProvider for Statistics<'_> {
    fn total_num_tokens(&self, field: Field) -> tantivy::Result<u64> {
        self.readable.tokens.get(&field).copied().ok_or_else(|| {
            TantivyError::InvalidArgument(format!(
                "field {} has no exact token counts, so it cannot be scored",
                field.field_id()
            ))
        })
    }

    fn total_num_docs(&self) -> tantivy::Result<u64> {
        Ok(self.readable.docs)
    }

    fn doc_freq(&self, term: &Term) -> tantivy::Result<u64> {
        self.readable.doc_freq(self.searcher, term)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::StoreOptions;
    use crate::index::TantivyIndex;
    use serde_json::json;
    use umbel_store::conformance::samples;
    use umbel_store::{IndexChunk, SearchIndex};

    fn varied(doc: &str, access: &[&str], n: usize) -> IndexChunk {
        let mut chunk = samples::chunk(
            doc,
            0,
            "Rollout Plans, quarterly",
            &format!(
                "The rollout {n} of {doc}: canaries first, then the fleet. {} {}",
                "averyveryverylongtokenthatisovertheenstemlimitofforty".repeat(2),
                "word ".repeat(n)
            ),
            access,
        );
        chunk.aliases = vec!["roll out".into(), "deploy".into()];
        chunk.description = n.is_multiple_of(2).then(|| "how we ship".to_owned());
        chunk.heading_path = vec!["Ops".into(), "Rollouts and canaries".into()];
        chunk.code = n
            .is_multiple_of(3)
            .then(|| "deploy_fleet canary_check".to_owned());
        chunk.tags = (0..n % 4).map(|t| format!("tag-{t}")).collect();
        chunk.owners = vec!["ada".into()];
        chunk.lang = (n % 2 == 1).then(|| "rust".to_owned());
        if let serde_json::Value::Object(meta) = json!({
            "team": "ops",
            "level": n,
            "ratio": 0.5,
            "flag": true,
            "none": null,
            "list": ["a", "b", n],
            "nested": { "deep": "x", "deeper": { "n": 1 } },
        }) {
            chunk.meta = meta;
        }
        chunk
    }

    /// tantivy's own count of a field's tokens, summed over the segments.
    fn tantivy_tokens(searcher: &Searcher, field: Field) -> u64 {
        searcher
            .segment_readers()
            .iter()
            .map(|s| s.inverted_index(field).unwrap().total_num_tokens())
            .sum()
    }

    #[test]
    fn exact_counts_equal_tantivys_own_for_every_scored_field() {
        let dir = tempfile::tempdir().unwrap();
        let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).unwrap();
        let mut writer = index.writer().unwrap();
        for n in 0..24 {
            let doc = format!("a/doc-{n}");
            writer
                .replace(&doc, vec![varied(&doc, &["space"], n)])
                .unwrap();
        }
        writer.commit(1).unwrap();
        let searcher = index.searcher().unwrap();
        assert_eq!(searcher.segment_readers().len(), 1);
        let all = Readable::compute(&searcher, &index.fields, &ReaderFilter::derivation()).unwrap();
        assert_eq!(all.docs, 24);
        for length in &index.fields.lengths {
            assert_eq!(
                all.tokens[&length.field],
                tantivy_tokens(&searcher, length.field),
                "{}: the exact count is tantivy's own total on an index without deletes",
                length.name
            );
        }
        assert!(all.tokens[&index.fields.body] > 24 * 10);
        assert!(all.tokens[&index.fields.meta] > 0);
    }

    #[test]
    fn deleted_and_unreadable_chunks_count_nowhere() {
        let dir = tempfile::tempdir().unwrap();
        let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).unwrap();
        let mut writer = index.writer().unwrap();
        for n in 0..10 {
            let doc = format!("a/doc-{n}");
            let access: &[&str] = if n < 4 { &["space"] } else { &["group:sec"] };
            writer.replace(&doc, vec![varied(&doc, access, n)]).unwrap();
        }
        writer.commit(1).unwrap();
        let mut writer = index.writer().unwrap();
        // Delete two readable chunks and two hidden ones.
        for n in [0, 1, 6, 7] {
            writer.replace(&format!("a/doc-{n}"), Vec::new()).unwrap();
        }
        writer.commit(2).unwrap();
        let searcher = index.searcher().unwrap();
        let space = ReaderFilter::tokens(["space"]).unwrap();
        let readable = Readable::compute(&searcher, &index.fields, &space).unwrap();
        assert_eq!(readable.docs, 2, "doc-2 and doc-3");
        let rollout = Term::from_field_text(index.fields.body, "rollout");
        assert_eq!(readable.doc_freq(&searcher, &rollout).unwrap(), 2);
        let derived =
            Readable::compute(&searcher, &index.fields, &ReaderFilter::derivation()).unwrap();
        assert_eq!(
            derived.docs, 6,
            "deleted chunks are excluded under derivation too"
        );
        assert_eq!(derived.doc_freq(&searcher, &rollout).unwrap(), 6);
        // The counts are the fresh index's of the same live, readable chunks.
        let fresh_dir = tempfile::tempdir().unwrap();
        let fresh = TantivyIndex::open(fresh_dir.path(), "main", StoreOptions::default()).unwrap();
        let mut writer = fresh.writer().unwrap();
        for n in [2, 3] {
            let doc = format!("a/doc-{n}");
            writer
                .replace(&doc, vec![varied(&doc, &["space"], n)])
                .unwrap();
        }
        writer.commit(1).unwrap();
        let fresh_searcher = fresh.searcher().unwrap();
        for length in &index.fields.lengths {
            assert_eq!(
                readable.tokens[&length.field],
                tantivy_tokens(&fresh_searcher, length.field),
                "{}",
                length.name
            );
        }
    }

    #[test]
    fn the_cache_keys_on_the_segment_set_and_the_filter() {
        let dir = tempfile::tempdir().unwrap();
        let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).unwrap();
        let mut writer = index.writer().unwrap();
        writer
            .replace(&"a/one".to_owned(), vec![varied("a/one", &["space"], 1)])
            .unwrap();
        writer.commit(1).unwrap();
        let searcher = index.searcher().unwrap();
        let space = ReaderFilter::tokens(["space"]).unwrap();
        let first = index
            .statistics
            .readable(&searcher, &index.fields, &space)
            .unwrap();
        let again = index
            .statistics
            .readable(&searcher, &index.fields, &space)
            .unwrap();
        assert!(Arc::ptr_eq(&first, &again), "one computation per key");
        let other = index
            .statistics
            .readable(&searcher, &index.fields, &ReaderFilter::derivation())
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &other));
        let mut writer = index.writer().unwrap();
        writer
            .replace(&"a/two".to_owned(), vec![varied("a/two", &["space"], 2)])
            .unwrap();
        writer.commit(2).unwrap();
        let newer = index.searcher().unwrap();
        let after = index
            .statistics
            .readable(&newer, &index.fields, &space)
            .unwrap();
        assert_eq!(
            (first.docs, after.docs),
            (1, 2),
            "a new segment set, new counts"
        );
    }
}
