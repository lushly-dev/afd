//! The scores of a match (records host specification, sections 8.2 and 8.3; D165): BM25 over the
//! lane's terms, scaled so that a text scores 1 against itself and taken in both directions, the
//! dot product of two unit vectors, and their weighted sum.
//!
//! Everything is `f64` and pure, so every backend computes the same numbers from the same
//! statistics. A backend gathers the statistics (section 8.2: the corpus, each term's count, each
//! candidate's frequencies and length) and calls these.

/// BM25's `k1`, the memory lane's.
pub const K1: f64 = 1.2;
/// BM25's `b`, the memory lane's.
pub const B: f64 = 0.75;

/// The statistics of one text's corpus (section 8.2): the records of the kind that the reader may
/// read and the call admits, without the excluded ones, plus the text itself as one more record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Corpus {
    /// `N`: how many records the corpus holds.
    pub records: u64,
    /// `L`: their tokens in the match field, in all.
    pub tokens: u64,
}

impl Corpus {
    /// `avg = L / N`; 0 for an empty corpus.
    #[must_use]
    pub fn average(&self) -> f64 {
        if self.records == 0 {
            0.0
        } else {
            self.tokens as f64 / self.records as f64
        }
    }
}

/// One distinct term of `Q` that `D` holds, as [`score`] needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Posting {
    /// `df(t)`: how many records of the corpus hold the term.
    pub df: u64,
    /// `tf(D, t)`: how often `D` holds it.
    pub tf: u32,
}

/// `idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))`: tantivy's form, which phase 0 measured,
/// and not FTS5's floored one.
#[must_use]
pub fn idf(records: u64, df: u64) -> f64 {
    let (records, df) = (records as f64, df as f64);
    (1.0 + (records - df + 0.5) / (df + 0.5)).ln()
}

/// `score(Q, D)`: the sum, over each distinct term of `Q` that `D` holds, of
/// `idf(t) * tf(D, t) * (k1 + 1) / (tf(D, t) + k1 * (1 - b + b * |D| / avg))`. `length` is `|D|`,
/// the tokens of `D`. Give the postings in the terms' byte order, so that every caller adds in
/// the same order.
#[must_use]
pub fn score(corpus: &Corpus, length: u32, postings: impl IntoIterator<Item = Posting>) -> f64 {
    let average = corpus.average();
    let relative = if average > 0.0 {
        f64::from(length) / average
    } else {
        0.0
    };
    let norm = K1 * (1.0 - B + B * relative);
    // Folded from 0.0, and not summed: an empty sum of floats is negative zero.
    postings
        .into_iter()
        .filter(|posting| posting.tf > 0)
        .fold(0.0, |sum, posting| {
            let tf = f64::from(posting.tf);
            sum + idf(corpus.records, posting.df) * tf * (K1 + 1.0) / (tf + norm)
        })
}

/// `directed(Q, D) = score(Q, D) / score(Q, Q)`, or 0 when `score(Q, Q)` is 0: `score` is
/// `score(Q, D)` and `own` is `score(Q, Q)`.
#[must_use]
pub fn directed(score: f64, own: f64) -> f64 {
    if own > 0.0 { score / own } else { 0.0 }
}

/// `words(q, d) = min(directed(q, d), directed(d, q))`: the lower of the two directions, so a
/// short text inside a long one scores low.
#[must_use]
pub fn words(query_to_record: f64, record_to_query: f64) -> f64 {
    query_to_record.min(record_to_query)
}

/// `meaning(q, d)`: the dot product of two unit vectors, which is their cosine. 0 when the
/// vectors differ in length, since they are then not of one model.
#[must_use]
pub fn cosine(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.iter()
        .zip(b)
        .fold(0.0, |sum, (x, y)| sum + f64::from(*x) * f64::from(*y))
}

/// `fused(q, d) = w * meaning(q, d) + (1 - w) * words(q, d)`, from the unrounded scores.
#[must_use]
pub fn fused(weight: f64, meaning: f64, words: f64) -> f64 {
    weight * meaning + (1.0 - weight) * words
}

/// A score at four decimal places: what a match returns and what its orders compare, so a
/// difference in the last bits of a float never changes an order. Never negative zero.
#[must_use]
pub fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0 + 0.0
}
