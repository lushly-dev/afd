//! The record lane's fixture (records host specification, section 15.1):
//! `fixtures/lane/records.json` holds the records, the texts to match and the digests and scores
//! the conformance suite expects, starting with the worked examples of sections 8.1 and 8.2.
//! This test recomputes every one of them from `umbel_store::lane` and the tokenizer, so the
//! fixture cannot drift from the formulas, and holds the worked examples to the specification's
//! own figures.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde_json::Value;
use umbel_store::lane::score::{Corpus, Posting, directed, round4, score, words};
use umbel_store::lane::{Extracted, Pointer, RecordDecl, extract, match_digest};
use umbel_store::memory::tokenizer::tokens;
use umbel_store::{AccessSet, check_identifier};

const FIXTURE: &str = include_str!("../fixtures/lane/records.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

fn hex(digest: [u8; 32]) -> String {
    let mut out = String::new();
    for byte in digest {
        write!(out, "{byte:02x}").unwrap();
    }
    out
}

fn strings(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap())
        .collect()
}

/// The fixture's declaration, as a manifest's `[[records]]` entry reads.
fn declaration(fixture: &Value) -> RecordDecl {
    let declared = &fixture["declaration"];
    let pointers = |key: &str| -> Vec<Pointer> {
        strings(&declared[key])
            .into_iter()
            .map(|pointer| Pointer::parse(pointer).unwrap())
            .collect()
    };
    let text = pointers("text");
    let matched = declared["match"]
        .as_str()
        .map(|pointer| text.iter().position(|p| p.as_str() == pointer).unwrap());
    let decl = RecordDecl {
        kind: declared["kind"].as_str().unwrap().to_owned(),
        standing: declared["standing"].as_bool().unwrap(),
        text,
        keys: pointers("keys"),
        matched,
    };
    decl.check().unwrap();
    decl
}

/// One text as the words score sees it: its distinct terms with their frequencies, and its
/// length in tokens.
struct Terms {
    counts: BTreeMap<String, u32>,
    length: u32,
}

impl Terms {
    fn of(text: &str) -> Self {
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        let mut length = 0;
        for token in tokens(text) {
            *counts.entry(token).or_default() += 1;
            length += 1;
        }
        Self { counts, length }
    }

    /// The match field of an extracted record: field 0's terms and length.
    fn of_match_field(extracted: &Extracted, field: usize) -> Self {
        Self {
            counts: extracted
                .terms
                .iter()
                .filter(|(position, _, _)| usize::from(*position) == field)
                .map(|(_, term, frequency)| (term.clone(), *frequency))
                .collect(),
            length: extracted.lengths[field],
        }
    }
}

/// The fixture's records, each extracted under the declaration: its id, its extraction and its
/// match field's terms.
fn records(fixture: &Value, decl: &RecordDecl) -> Vec<(String, Extracted, Terms)> {
    let field = decl.matched.unwrap();
    fixture["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            let id = record["id"].as_str().unwrap().to_owned();
            let extracted = extract(decl, &record["body"]).unwrap();
            let terms = Terms::of_match_field(&extracted, field);
            (id, extracted, terms)
        })
        .collect()
}

/// `score(Q, D)` over the corpus, with the terms in byte order.
fn score_of(corpus: &Corpus, df: &BTreeMap<&str, u64>, query: &Terms, record: &Terms) -> f64 {
    score(
        corpus,
        record.length,
        query.counts.keys().filter_map(|term| {
            record.counts.get(term).map(|tf| Posting {
                df: df[term.as_str()],
                tf: *tf,
            })
        }),
    )
}

#[test]
fn the_fixtures_records_are_well_formed_and_about_one_kind() {
    let fixture = fixture();
    let decl = declaration(&fixture);
    assert_eq!(decl.kind, "note");
    assert!(decl.standing);
    assert_eq!(decl.match_pointer().unwrap().as_str(), "/statement");
    let records = records(&fixture, &decl);
    assert!(records.len() >= 5);
    let mut ids: Vec<&str> = records.iter().map(|(id, _, _)| id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), records.len(), "a record id is repeated");
    for record in fixture["records"].as_array().unwrap() {
        let id = record["id"].as_str().unwrap();
        check_identifier("a record id", id).unwrap();
        AccessSet::new(strings(&record["access"])).unwrap();
    }
    for (id, extracted, terms) in &records {
        assert!(extracted.match_digest.is_some(), "{id} has no match value");
        assert!(extracted.wording_hash.is_some(), "{id}");
        assert!(terms.length > 0, "{id}");
    }
}

#[test]
fn every_identical_text_has_its_expected_digest() {
    let fixture = fixture();
    let groups = fixture["identical"].as_array().unwrap();
    assert!(!groups.is_empty());
    for group in groups {
        let expected = group["digest"].as_str().unwrap();
        let texts = strings(&group["texts"]);
        assert!(texts.len() >= 2, "{expected}");
        for text in texts {
            assert_eq!(hex(match_digest(text).unwrap()), expected, "{text:?}");
        }
    }
}

#[test]
fn every_expected_score_is_what_the_formulas_give() {
    let fixture = fixture();
    let decl = declaration(&fixture);
    let records = records(&fixture, &decl);
    let matches = fixture["matches"].as_array().unwrap();
    assert!(!matches.is_empty());
    for case in matches {
        let text = case["text"].as_str().unwrap();
        let query = Terms::of(text);
        // Section 8.2's corpus for a reader of every record: the records, plus the text itself.
        let corpus = Corpus {
            records: records.len() as u64 + 1,
            tokens: records
                .iter()
                .map(|(_, _, terms)| u64::from(terms.length))
                .sum::<u64>()
                + u64::from(query.length),
        };
        assert_eq!(corpus.records, case["records"].as_u64().unwrap(), "{text}");
        assert_eq!(corpus.tokens, case["tokens"].as_u64().unwrap(), "{text}");
        let mut df: BTreeMap<&str, u64> = BTreeMap::new();
        for terms in records.iter().map(|(_, _, terms)| terms).chain([&query]) {
            for term in terms.counts.keys() {
                *df.entry(term.as_str()).or_default() += 1;
            }
        }

        let digest = match_digest(text);
        let identical: Vec<&str> = records
            .iter()
            .filter(|(_, extracted, _)| digest.is_some() && extracted.match_digest == digest)
            .map(|(id, _, _)| id.as_str())
            .collect();
        assert_eq!(identical, strings(&case["identical"]), "{text}");

        let own = score_of(&corpus, &df, &query, &query);
        let mut scored: Vec<(&str, f64, f64, f64)> = records
            .iter()
            .map(|(id, _, record)| {
                let to_record = directed(score_of(&corpus, &df, &query, record), own);
                let to_query = directed(
                    score_of(&corpus, &df, record, &query),
                    score_of(&corpus, &df, record, record),
                );
                (
                    id.as_str(),
                    round4(to_record),
                    round4(to_query),
                    round4(words(to_record, to_query)),
                )
            })
            .collect();
        // By the rounded words score descending, then by id: the order of a match's `nearest`
        // when no meaning is served.
        scored.sort_by(|a, b| b.3.total_cmp(&a.3).then_with(|| a.0.cmp(b.0)));

        let expected = case["scores"].as_array().unwrap();
        assert_eq!(
            expected.len(),
            scored.len(),
            "{text}: every record is scored"
        );
        for ((id, to_record, to_query, both), expected) in scored.iter().zip(expected) {
            assert_eq!(*id, expected["id"].as_str().unwrap(), "{text}: order");
            for (name, found) in [
                ("queryToRecord", to_record),
                ("recordToQuery", to_query),
                ("words", both),
            ] {
                let expected = expected[name].as_f64().unwrap();
                assert_eq!(
                    format!("{found:.4}"),
                    format!("{expected:.4}"),
                    "{text}: {id} {name}"
                );
            }
        }
    }
}

/// The specification's own figures, as it prints them: `(id, directed(q, d), directed(d, q),
/// words)` in its table's order.
const WORKED_SCORES: [(&str, &str, &str, &str); 5] = [
    ("n1", "0.8304", "0.9578", "0.8304"),
    ("n2", "0.7367", "0.6428", "0.6428"),
    ("n5", "0.0837", "0.0422", "0.0422"),
    ("n4", "0.0587", "0.0341", "0.0341"),
    ("n3", "0.0000", "0.0000", "0.0000"),
];

#[test]
fn the_first_rows_are_the_specifications_worked_examples() {
    let fixture = fixture();
    // Section 8.1: three texts, one digest.
    let identical = &fixture["identical"][0];
    assert_eq!(
        identical["digest"],
        "c714bd413a290f5b1724d67dd0b26ea3e76a93b1904daaa487f16cea4e1aec8b"
    );
    assert_eq!(
        strings(&identical["texts"]),
        [
            "Prune roses in late winter, before the buds swell.",
            "  PRUNE roses in late\twinter,\u{a0}before the buds swell. ",
            "\u{ff30}rune roses in late winter, before the buds swell.",
        ]
    );
    // Section 8.2: five records, and a text for which N is 6 and L is 57.
    let statements: Vec<&str> = fixture["records"]
        .as_array()
        .unwrap()
        .iter()
        .take(5)
        .map(|record| record["body"]["statement"].as_str().unwrap())
        .collect();
    assert_eq!(
        statements,
        [
            "Prune roses in late winter, before the buds swell.",
            "Roses are pruned in late winter before their buds swell.",
            "Tomatoes need six hours of sun and steady watering.",
            "Mulch keeps the soil cool and holds water through summer.",
            "Water tomatoes at the base, never on the leaves.",
        ]
    );
    let first = &fixture["matches"][0];
    assert_eq!(
        first["text"],
        "Prune your roses in late winter before the buds swell."
    );
    assert_eq!(
        (first["records"].as_u64(), first["tokens"].as_u64()),
        (Some(6), Some(57))
    );
    let rows = first["scores"].as_array().unwrap();
    assert_eq!(rows.len(), WORKED_SCORES.len());
    for (row, (id, to_record, to_query, both)) in rows.iter().zip(WORKED_SCORES) {
        let shown = |key: &str| format!("{:.4}", row[key].as_f64().unwrap());
        assert_eq!(row["id"], id);
        assert_eq!(shown("queryToRecord"), to_record, "{id}");
        assert_eq!(shown("recordToQuery"), to_query, "{id}");
        assert_eq!(shown("words"), both, "{id}");
    }
    // And its second text: `n1` is identical and scores 1.0000, and `n2` scores 0.6714.
    let second = &fixture["matches"][1];
    assert_eq!(
        second["text"],
        "PRUNE ROSES  in late winter, before the buds swell."
    );
    assert_eq!(strings(&second["identical"]), ["n1"]);
    let words_of = |id: &str| {
        let row = second["scores"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == id)
            .unwrap();
        format!("{:.4}", row["words"].as_f64().unwrap())
    };
    assert_eq!(words_of("n1"), "1.0000");
    assert_eq!(words_of("n2"), "0.6714");
}
