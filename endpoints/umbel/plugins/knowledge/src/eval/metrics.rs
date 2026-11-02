//! recall@k, nDCG@k and MRR@k (specification section 10.3), over a ranked list of
//! `<space>:<document id>` and the query's grades.
//!
//! - **recall@k**: the fraction of the grade-2 documents found in the top k;
//! - **nDCG@k**: gain `2^grade − 1`, discount `log2(rank + 1)`, normalised by the ideal order of
//!   the query's grades;
//! - **MRR@k**: the reciprocal rank of the first grade-2 document in the top k, else 0.
//!
//! Means are rounded to four decimals at the end, never in between.

use std::collections::BTreeMap;

/// One query's scores.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Graded {
    /// recall@k.
    pub recall: f64,
    /// nDCG@k.
    pub ndcg: f64,
    /// MRR@k.
    pub mrr: f64,
}

/// Four decimals.
#[must_use]
pub fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn gain(grade: u8) -> f64 {
    f64::from((1u32 << grade) - 1)
}

fn discount(rank: usize) -> f64 {
    ((rank + 1) as f64).log2()
}

/// Score a ranking against a query's grades.
#[must_use]
pub fn grade(ranking: &[String], qrels: &BTreeMap<String, u8>, k: usize) -> Graded {
    let top = &ranking[..ranking.len().min(k)];
    let answers = qrels.values().filter(|grade| **grade == 2).count();
    let found = top.iter().filter(|doc| qrels.get(*doc) == Some(&2)).count();
    let recall = if answers == 0 {
        0.0
    } else {
        found as f64 / answers as f64
    };
    let dcg: f64 = top
        .iter()
        .enumerate()
        .map(|(at, doc)| {
            qrels
                .get(doc)
                .map_or(0.0, |grade| gain(*grade) / discount(at + 1))
        })
        .sum();
    let mut ideal: Vec<u8> = qrels.values().copied().collect();
    ideal.sort_unstable_by(|a, b| b.cmp(a));
    let best: f64 = ideal
        .iter()
        .take(k)
        .enumerate()
        .map(|(at, grade)| gain(*grade) / discount(at + 1))
        .sum();
    let ndcg = if best > 0.0 { dcg / best } else { 0.0 };
    let mrr = top
        .iter()
        .position(|doc| qrels.get(doc) == Some(&2))
        .map_or(0.0, |at| 1.0 / (at + 1) as f64);
    Graded { recall, ndcg, mrr }
}

/// A running mean of [`Graded`].
#[derive(Debug, Clone, Copy, Default)]
pub struct Mean {
    queries: usize,
    recall: f64,
    ndcg: f64,
    mrr: f64,
}

impl Mean {
    /// Add one query.
    pub fn add(&mut self, graded: Graded) {
        self.queries += 1;
        self.recall += graded.recall;
        self.ndcg += graded.ndcg;
        self.mrr += graded.mrr;
    }

    /// The report's object, or `None` when no query was added.
    #[must_use]
    pub fn report(&self) -> serde_json::Value {
        let n = self.queries.max(1) as f64;
        serde_json::json!({
            "queries": self.queries,
            "recall": round4(self.recall / n),
            "ndcg": round4(self.ndcg / n),
            "mrr": round4(self.mrr / n),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn qrels(entries: &[(&str, u8)]) -> BTreeMap<String, u8> {
        entries.iter().map(|(k, g)| ((*k).to_owned(), *g)).collect()
    }

    fn ranking(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|e| (*e).to_owned()).collect()
    }

    /// Hand-computed, tie-free: three queries with known answers.
    #[test]
    fn three_queries_by_hand() {
        // 1. The answer first, then the grade-1 mention: a perfect list.
        let a = grade(
            &ranking(&["s:a", "s:m", "s:x"]),
            &qrels(&[("s:a", 2), ("s:m", 1)]),
            10,
        );
        assert_eq!(
            (round4(a.recall), round4(a.ndcg), round4(a.mrr)),
            (1.0, 1.0, 1.0)
        );

        // 2. The mention first, the answer third: DCG = 1/log2(2) + 3/log2(4) = 1 + 1.5 = 2.5;
        //    ideal = 3/log2(2) + 1/log2(3) = 3 + 0.6309 = 3.6309; nDCG = 0.6885.
        let b = grade(
            &ranking(&["s:m", "s:x", "s:a"]),
            &qrels(&[("s:a", 2), ("s:m", 1)]),
            10,
        );
        assert_eq!(round4(b.recall), 1.0);
        assert_eq!(round4(b.ndcg), 0.6885);
        assert_eq!(round4(b.mrr), 0.3333);

        // 3. The answer is below the cut: recall and MRR are 0, and so is nDCG.
        let c = grade(&ranking(&["s:x", "s:y", "s:a"]), &qrels(&[("s:a", 2)]), 2);
        assert_eq!((c.recall, c.ndcg, c.mrr), (0.0, 0.0, 0.0));

        let mut mean = Mean::default();
        for query in [a, b, c] {
            mean.add(query);
        }
        let report = mean.report();
        assert_eq!(report["queries"], 3);
        assert_eq!(report["recall"], 0.6667);
        assert_eq!(report["ndcg"], 0.5628);
        assert_eq!(report["mrr"], 0.4444);
    }

    #[test]
    fn two_answers_make_recall_a_fraction() {
        let g = grade(
            &ranking(&["s:a", "s:x", "s:b"]),
            &qrels(&[("s:a", 2), ("s:b", 2)]),
            2,
        );
        assert_eq!(g.recall, 0.5);
    }
}
