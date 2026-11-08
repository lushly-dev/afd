//! Recall's ranking (phase 5 section 9.2, D125): BM25 per reader filter, in Rust.
//!
//! FTS5's `bm25()` reads whole-table statistics: every row's length and every row holding a
//! phrase, readable or not. Recall instead keeps FTS5 for matching and computes FTS5's own BM25
//! formula (`fts5Bm25Function`: k1 1.2, b 0.75, the IDF floored at 1e-6, a phrase's frequency
//! weighted per column, the row's length summed over its columns) with statistics over the
//! records the reader may read: their count, their total length, and how many of them hold each
//! phrase. A matched record's own frequencies come from its opened body, tokenised by
//! `umbel-store`'s memory tokenizer, FTS5's `porter unicode61 remove_diacritics 2` rules.

use umbel_store::memory::tokenizer::tokens;
use umbel_store::memory::{QueryTerm, TermField};

/// FTS5's `k1`.
const K1: f64 = 1.2;
/// FTS5's `b`.
const B: f64 = 0.75;
/// The column weights recall has always given `bm25()`: subject, tags, text.
const WEIGHTS: [f64; 3] = [3.0, 2.0, 1.0];

/// One phrase of the query: its tokens, whether the last is a prefix, and its columns.
pub(crate) struct Phrase {
    tokens: Vec<String>,
    prefix: bool,
    columns: [bool; 3],
}

impl Phrase {
    /// The phrase FTS5 makes of `term`: its text tokenised, limited to its field's column.
    pub(crate) fn of(term: &QueryTerm) -> Self {
        let columns = match term.field {
            None => [true; 3],
            Some(TermField::Subject) => [true, false, false],
            Some(TermField::Tags) => [false, true, false],
            Some(TermField::Body) => [false, false, true],
        };
        Self {
            tokens: tokens(&term.text),
            prefix: term.prefix,
            columns,
        }
    }

    /// Whether the term tokenised to nothing, so it can hold no instance.
    pub(crate) fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }

    /// How many times the phrase starts in `column`'s tokens.
    fn instances(&self, column: &[String]) -> u64 {
        let n = self.tokens.len();
        if n == 0 || column.len() < n {
            return 0;
        }
        let mut count = 0;
        for start in 0..=column.len() - n {
            let found = self.tokens.iter().enumerate().all(|(i, token)| {
                let at = &column[start + i];
                if self.prefix && i + 1 == n {
                    at.starts_with(token.as_str())
                } else {
                    at == token
                }
            });
            if found {
                count += 1;
            }
        }
        count
    }
}

/// A matched record's tokens per column: subject, tags (joined by spaces, as indexed), text.
pub(crate) struct Columns([Vec<String>; 3]);

impl Columns {
    /// Tokenise a body as FTS5 indexed it.
    pub(crate) fn of(subject: &str, tags: &[String], text: &str) -> Self {
        Self([tokens(subject), tokens(&tags.join(" ")), tokens(text)])
    }

    /// The row's length: its tokens in every column.
    fn length(&self) -> u64 {
        self.0.iter().map(|c| c.len() as u64).sum()
    }
}

/// The reader's statistics: the records it may read, their total length in tokens, and per
/// phrase how many of them hold it.
pub(crate) struct Corpus {
    pub(crate) records: u64,
    pub(crate) tokens: u64,
    pub(crate) holding: Vec<u64>,
}

/// FTS5's IDF of a phrase that `holding` of `records` records hold, floored at 1e-6.
#[allow(clippy::cast_precision_loss)]
fn idf(records: u64, holding: u64) -> f64 {
    let idf = ((records as f64 - holding as f64 + 0.5) / (holding as f64 + 0.5)).ln();
    if idf <= 0.0 { 1e-6 } else { idf }
}

/// A matched record's BM25 score, positive (FTS5's `bm25()` is its negation), over `corpus`.
#[allow(clippy::cast_precision_loss)]
pub(crate) fn score(phrases: &[Phrase], corpus: &Corpus, columns: &Columns) -> f64 {
    let average = if corpus.records == 0 {
        0.0
    } else {
        corpus.tokens as f64 / corpus.records as f64
    };
    let length = columns.length() as f64;
    let mut score = 0.0;
    for (phrase, holding) in phrases.iter().zip(&corpus.holding) {
        let mut frequency = 0.0;
        for (c, column) in columns.0.iter().enumerate() {
            if phrase.columns[c] {
                frequency += WEIGHTS[c] * phrase.instances(column) as f64;
            }
        }
        let norm = if average > 0.0 {
            1.0 - B + B * length / average
        } else {
            1.0
        };
        score += idf(corpus.records, *holding) * (frequency * (K1 + 1.0)) / (frequency + K1 * norm);
    }
    score
}

/// A score as the integer its fourth decimal place makes, as `round(bm25(...), 4)` ordered.
#[allow(clippy::cast_possible_truncation)]
pub(crate) fn rounded(score: f64) -> i64 {
    (score * 10_000.0).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use umbel_store::memory::Occur;

    fn term(text: &str, field: Option<TermField>, prefix: bool) -> QueryTerm {
        QueryTerm {
            occur: Occur::Should,
            field,
            text: text.to_owned(),
            phrase: text.contains(' '),
            prefix,
        }
    }

    #[test]
    fn phrases_count_stemmed_instances_in_their_columns() {
        let columns = Columns::of(
            "Rollbacks and rollback plans",
            &["deploy".into(), "rollback".into()],
            "a rollback plan, then the rollback",
        );
        assert_eq!(
            Phrase::of(&term("rollbacks", None, false)).instances(&columns.0[0]),
            2
        );
        assert_eq!(
            Phrase::of(&term("rollback plan", None, false)).instances(&columns.0[2]),
            1
        );
        assert_eq!(
            Phrase::of(&term("roll", None, true)).instances(&columns.0[1]),
            1
        );
        let subject_only = Phrase::of(&term("rollback", Some(TermField::Subject), false));
        assert_eq!(subject_only.columns, [true, false, false]);
    }

    #[test]
    fn the_formula_is_fts5s() {
        // One phrase, one record holding it once in its text, among 10 records of average
        // length 4: FTS5's idf(10, 1) * (1 * 2.2) / (1 + 1.2 * (0.25 + 0.75 * 4 / 4)).
        let phrases = vec![Phrase::of(&term("zebra", None, false))];
        let corpus = Corpus {
            records: 10,
            tokens: 40,
            holding: vec![1],
        };
        let columns = Columns::of("one two", &[], "three zebra");
        let expected = (9.5f64 / 1.5).ln() * 2.2 / (1.0 + 1.2);
        assert!((score(&phrases, &corpus, &columns) - expected).abs() < 1e-12);
        // A phrase every record holds scores at the floor.
        let common = Corpus {
            records: 2,
            tokens: 8,
            holding: vec![2],
        };
        assert!(score(&phrases, &common, &columns) < 1e-5);
        // Subject weighs 3, tags 2, text 1.
        let in_subject = Columns::of("zebra x", &[], "y z");
        let in_tags = Columns::of("x y", &["zebra".into()], "z");
        assert!(
            score(&phrases, &corpus, &in_subject) > score(&phrases, &corpus, &in_tags)
                && score(&phrases, &corpus, &in_tags) > score(&phrases, &corpus, &columns)
        );
    }
}
