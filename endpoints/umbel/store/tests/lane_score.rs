//! The scores of a match (records host specification, sections 8.2 and 8.3): each formula against
//! cases computed by hand, a text scoring 1 against itself, and rounding at four places.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeMap;

use umbel_store::lane::score::{
    B, Corpus, K1, Posting, cosine, directed, fused, idf, round4, score, words,
};
use umbel_store::memory::tokenizer::tokens;

#[track_caller]
fn close(found: f64, expected: f64) {
    assert!(
        (found - expected).abs() < 1e-12,
        "{found} is not {expected}"
    );
}

/// A text's distinct terms with their frequencies, and its length in tokens.
fn terms(text: &str) -> (BTreeMap<String, u32>, u32) {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut length = 0;
    for token in tokens(text) {
        *counts.entry(token).or_default() += 1;
        length += 1;
    }
    (counts, length)
}

#[test]
fn the_constants_are_the_memory_lanes() {
    close(K1, 1.2);
    close(B, 0.75);
}

#[test]
fn idf_is_tantivys_form() {
    // ln(1 + (N - df + 0.5) / (df + 0.5)).
    close(idf(6, 1), (14.0f64 / 3.0).ln());
    close(idf(6, 3), 2.0f64.ln());
    close(idf(6, 6), (1.0f64 + 0.5 / 6.5).ln());
    close(idf(1, 1), (4.0f64 / 3.0).ln());
    // Never floored: a term every record holds still weighs something, and a rarer term more.
    assert!(idf(6, 6) > 0.0);
    assert!(idf(6, 1) > idf(6, 2) && idf(6, 2) > idf(6, 6));
}

#[test]
fn score_is_bm25_over_the_shared_terms() {
    // Ten records of 6 tokens on average.
    let corpus = Corpus {
        records: 10,
        tokens: 60,
    };
    close(corpus.average(), 6.0);
    // A record of average length holding a term once: the term's idf exactly, since
    // tf * (k1 + 1) / (tf + k1) is 1.
    close(score(&corpus, 6, [Posting { df: 2, tf: 1 }]), idf(10, 2));
    // Held twice: 2 * 2.2 / (2 + 1.2) = 1.375 of it.
    close(
        score(&corpus, 6, [Posting { df: 2, tf: 2 }]),
        1.375 * idf(10, 2),
    );
    // A record twice the average length: 2.2 / (1 + 1.2 * (0.25 + 0.75 * 2)) = 2.2 / 3.1.
    close(
        score(&corpus, 12, [Posting { df: 2, tf: 1 }]),
        2.2 / 3.1 * idf(10, 2),
    );
    // Half the average length: 2.2 / (1 + 1.2 * (0.25 + 0.375)) = 2.2 / 1.75.
    close(
        score(&corpus, 3, [Posting { df: 2, tf: 1 }]),
        2.2 / 1.75 * idf(10, 2),
    );
    // Terms add.
    close(
        score(
            &corpus,
            6,
            [Posting { df: 2, tf: 1 }, Posting { df: 9, tf: 2 }],
        ),
        idf(10, 2) + 1.375 * idf(10, 9),
    );
}

#[test]
fn a_score_with_no_shared_term_is_zero_and_not_negative_zero() {
    let corpus = Corpus {
        records: 6,
        tokens: 57,
    };
    let none = score(&corpus, 9, []);
    assert_eq!(none.to_bits(), 0.0f64.to_bits());
    // A term the record does not hold adds nothing.
    assert_eq!(
        score(&corpus, 9, [Posting { df: 3, tf: 0 }]).to_bits(),
        0.0f64.to_bits()
    );
    assert_eq!(directed(none, 4.2).to_bits(), 0.0f64.to_bits());
    assert_eq!(round4(-0.000_01).to_bits(), 0.0f64.to_bits());
    assert_eq!(cosine(&[], &[]).to_bits(), 0.0f64.to_bits());
    // An empty corpus has no average and scores nothing.
    let empty = Corpus {
        records: 0,
        tokens: 0,
    };
    close(empty.average(), 0.0);
    assert_eq!(score(&empty, 0, []).to_bits(), 0.0f64.to_bits());
}

#[test]
fn directed_scales_by_the_texts_own_score_and_words_keeps_the_lower() {
    close(directed(1.5, 3.0), 0.5);
    close(directed(3.0, 3.0), 1.0);
    // A text with no term scores 0 against itself, and so against everything.
    close(directed(0.0, 0.0), 0.0);
    close(directed(1.0, 0.0), 0.0);
    close(words(0.8304, 0.9578), 0.8304);
    close(words(0.7367, 0.6428), 0.6428);
    close(words(0.0, 1.0), 0.0);
}

#[test]
fn a_text_scores_one_against_itself() {
    let stored = [
        "Sow broad beans in autumn for an early crop.",
        "Thin carrot seedlings when they are two inches tall.",
        "Water in the morning, water at the roots, water deeply.",
    ];
    for text in stored {
        let (query, length) = terms(text);
        // The same text as a stored record would hold it: tokenised apart, from another
        // spelling of its case and spacing, so nothing below is one value divided by itself.
        let (record, record_length) = terms(&format!("  {}  ", text.to_uppercase()));
        assert_eq!(record, query);
        // The corpus of section 8.2: the stored records and the text itself as one more.
        let records: Vec<_> = stored.iter().map(|other| terms(other)).collect();
        let corpus = Corpus {
            records: records.len() as u64 + 1,
            tokens: records.iter().map(|(_, n)| u64::from(*n)).sum::<u64>() + u64::from(length),
        };
        let df = |term: &str| {
            1 + records
                .iter()
                .filter(|(counts, _)| counts.contains_key(term))
                .count() as u64
        };
        // `score(Q, D)` over the terms of `Q` that `D` holds, with `D`'s frequencies and length.
        let side = |from: &BTreeMap<String, u32>, to: &BTreeMap<String, u32>, to_length: u32| {
            score(
                &corpus,
                to_length,
                from.keys().filter_map(|term| {
                    to.get(term).map(|tf| Posting {
                        df: df(term),
                        tf: *tf,
                    })
                }),
            )
        };
        let to_record = directed(
            side(&query, &record, record_length),
            side(&query, &query, length),
        );
        let to_query = directed(
            side(&record, &query, length),
            side(&record, &record, record_length),
        );
        assert!(side(&query, &query, length) > 0.0);
        assert_eq!(to_record.to_bits(), 1.0f64.to_bits(), "{text}");
        assert_eq!(to_query.to_bits(), 1.0f64.to_bits(), "{text}");
        assert_eq!(
            round4(words(to_record, to_query)).to_bits(),
            1.0f64.to_bits()
        );
        // And a different record of the corpus scores below 1 in both directions.
        for (other, other_length) in records.iter().filter(|(counts, _)| *counts != query) {
            let lower = words(
                directed(
                    side(&query, other, *other_length),
                    side(&query, &query, length),
                ),
                directed(
                    side(other, &query, length),
                    side(other, other, *other_length),
                ),
            );
            assert!(lower < 1.0, "{text}: {lower}");
        }
    }
}

#[test]
fn a_short_text_inside_a_long_one_scores_low() {
    let short = "Mulch the beds.";
    let long = "Mulch the beds after the first frost, water the hedge, turn the compost, net the brassicas and clean the tools.";
    let (short_terms, short_length) = terms(short);
    let (long_terms, long_length) = terms(long);
    let corpus = Corpus {
        records: 2,
        tokens: u64::from(short_length + long_length),
    };
    let df = |term: &str| {
        u64::from(short_terms.contains_key(term)) + u64::from(long_terms.contains_key(term))
    };
    let side = |query: &BTreeMap<String, u32>, record: &BTreeMap<String, u32>, length: u32| {
        score(
            &corpus,
            length,
            query.keys().filter_map(|term| {
                record.get(term).map(|tf| Posting {
                    df: df(term),
                    tf: *tf,
                })
            }),
        )
    };
    let short_to_long = directed(
        side(&short_terms, &long_terms, long_length),
        side(&short_terms, &short_terms, short_length),
    );
    let long_to_short = directed(
        side(&long_terms, &short_terms, short_length),
        side(&long_terms, &long_terms, long_length),
    );
    // Every term of the short text is in the long one, and little of the long one is in the
    // short: the lower direction is the score.
    assert!(short_to_long > 0.5, "{short_to_long}");
    assert!(long_to_short < 0.3, "{long_to_short}");
    close(words(short_to_long, long_to_short), long_to_short);
}

#[test]
fn meaning_is_the_dot_product_of_two_unit_vectors() {
    let east = [1.0f32, 0.0, 0.0, 0.0];
    let north = [0.0f32, 1.0, 0.0, 0.0];
    let between = [0.6f32, 0.8, 0.0, 0.0];
    close(cosine(&east, &east), 1.0);
    close(cosine(&east, &north), 0.0);
    assert!((cosine(&east, &between) - 0.6).abs() < 1e-6);
    assert!((cosine(&north, &between) - 0.8).abs() < 1e-6);
    close(cosine(&east, &[-1.0, 0.0, 0.0, 0.0]), -1.0);
    // Vectors of two lengths are not of one model.
    close(cosine(&east, &[1.0, 0.0, 0.0]), 0.0);
}

#[test]
fn fused_is_the_weighted_sum_of_the_unrounded_scores() {
    close(fused(0.5, 0.9, 0.5), 0.7);
    close(fused(0.0, 0.9, 0.5), 0.5);
    close(fused(1.0, 0.9, 0.5), 0.9);
    close(fused(0.25, 0.8, 0.4), 0.5);
    // From the unrounded scores: 0.5 * 0.00006 + 0.5 * 0.00002 is 0.00004, which rounds down;
    // from the rounded ones it would be 0.00005.
    close(round4(fused(0.5, 0.000_06, 0.000_02)), 0.0);
    close(fused(0.5, round4(0.000_06), round4(0.000_02)), 0.000_05);
}

#[test]
fn scores_are_rounded_to_four_places() {
    for (value, rounded) in [
        (0.830_359_929_179_465, 0.8304),
        (0.957_845_433_255_269_5, 0.9578),
        (0.123_449, 0.1234),
        (0.123_451, 0.1235),
        (0.000_04, 0.0),
        (0.000_06, 0.0001),
        (0.999_96, 1.0),
        (1.0, 1.0),
        (0.0, 0.0),
        (-0.123_46, -0.1235),
    ] {
        close(round4(value), rounded);
    }
    // Two scores that differ only past four places order as equal.
    assert_eq!(
        round4(0.642_839_558_990_861_3).to_bits(),
        round4(0.642_840_000_000_000_1).to_bits()
    );
}
