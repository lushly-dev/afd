//! The query builder's reading of `tantivy-query-grammar` 0.27's AST (specification section 8.1):
//! the cases the grammar's own behaviour makes delicate. The syntax forms against a fixed corpus
//! are the conformance suite's `index` group; this file holds what only this backend can see.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::BTreeSet;

use support::open_index;
use umbel_store::conformance::samples;
use umbel_store::{IndexChunk, IndexFilters, IndexQuery, ReaderFilter, SearchIndex, StoreError};
use umbel_store_embedded::StoreOptions;

struct Fixture {
    _dir: tempfile::TempDir,
    index: std::sync::Arc<umbel_store_embedded::TantivyIndex>,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = open_index(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut chunks: Vec<IndexChunk> = vec![
        samples::chunk("n/roll", 0, "Roll", "roll call at nine", &["space"]),
        samples::chunk("n/rollback", 0, "Plan", "the rollback plan", &["space"]),
        samples::chunk("n/star", 0, "Star", "a star * and a ? mark", &["space"]),
        samples::chunk(
            "n/legacy",
            0,
            "Legacy deploys",
            "old deploys path/to/file.md",
            &["space"],
        ),
    ];
    chunks[3].meta = serde_json::json!({"ready": true, "count": 3, "team": "infra"})
        .as_object()
        .cloned()
        .unwrap();
    chunks[3].updated = Some("2026-03-01T00:00:00Z".into());
    let mut writer = index.writer().expect("a writer");
    for chunk in chunks {
        let doc = chunk.doc.clone();
        writer.replace(&doc, vec![chunk]).expect("replace");
    }
    writer.commit(1).expect("commit");
    Fixture { _dir: dir, index }
}

fn docs(f: &Fixture, text: &str) -> Result<BTreeSet<String>, StoreError> {
    let reader = ReaderFilter::tokens(["space"]).expect("a reader");
    let query = IndexQuery {
        text: text.to_owned(),
        filters: IndexFilters::default(),
        limit: 50,
    };
    Ok(f.index
        .search(&query, &reader)?
        .into_iter()
        .map(|h| h.doc)
        .collect())
}

fn set(docs: &[&str]) -> BTreeSet<String> {
    docs.iter().map(|d| (*d).to_owned()).collect()
}

#[test]
fn only_a_single_trailing_star_is_a_prefix() {
    let f = fixture();
    // The grammar marks `prefix` only on a quoted phrase; the builder reads the unquoted word.
    assert_eq!(docs(&f, "roll*").unwrap(), set(&["n/roll", "n/rollback"]));
    assert_eq!(
        docs(&f, "\"roll\"*").unwrap(),
        set(&["n/roll", "n/rollback"])
    );
    assert_eq!(docs(&f, "'roll'*").unwrap(), set(&["n/roll", "n/rollback"]));
    assert_eq!(docs(&f, "title:roll*").unwrap(), set(&["n/roll"]));
    // Everything else with a star is refused, not silently reduced to the word around it.
    for text in [
        "*roll",
        "ro*ll",
        "**",
        "roll**",
        "*roll*",
        "title:*roll",
        "ro*ll*",
    ] {
        assert!(
            matches!(docs(&f, text), Err(StoreError::Invalid(_))),
            "`{text}` should be refused"
        );
    }
    // An escaped or quoted star is text, and text punctuation is dropped by the tokenizer.
    assert_eq!(docs(&f, "star\\*").unwrap(), set(&["n/star"]));
    assert_eq!(docs(&f, "\"star *\"").unwrap(), set(&["n/star"]));
}

#[test]
fn a_question_mark_is_punctuation() {
    let f = fixture();
    assert_eq!(docs(&f, "mark?").unwrap(), set(&["n/star"]));
}

#[test]
fn leaves_the_grammar_reads_beyond_words_are_refused_with_a_reason() {
    let f = fixture();
    for (text, mention) in [
        ("*", "`*`"),
        ("title:*", "`*`"),
        ("/roll.*/", "regular"),
        ("title:/roll.*/", "regular"),
        ("tags: IN [a b]", "IN"),
    ] {
        let Err(StoreError::Invalid(why)) = docs(&f, text) else {
            panic!("`{text}` should be refused");
        };
        assert!(why.contains(mention), "`{text}`: {why}");
    }
}

#[test]
fn json_meta_values_match_as_strings_numbers_and_booleans() {
    let f = fixture();
    assert_eq!(docs(&f, "meta.team:infra").unwrap(), set(&["n/legacy"]));
    assert_eq!(docs(&f, "meta.count:3").unwrap(), set(&["n/legacy"]));
    assert_eq!(docs(&f, "meta.ready:true").unwrap(), set(&["n/legacy"]));
    assert_eq!(docs(&f, "meta.ready:false").unwrap(), set(&[]));
    assert_eq!(
        docs(&f, "meta.team:Infra").unwrap(),
        set(&[]),
        "raw values are exact"
    );
    assert!(matches!(docs(&f, "meta.:x"), Err(StoreError::Invalid(_))));
    assert!(matches!(
        docs(&f, "meta.team:in*"),
        Err(StoreError::Invalid(_))
    ));
}

#[test]
fn dates_take_any_rfc_3339_offset_and_reject_anything_else() {
    let f = fixture();
    assert_eq!(
        docs(
            &f,
            "updated:[2026-03-01T01:00:00+01:00 TO 2026-03-01T01:00:00+01:00]"
        )
        .unwrap(),
        set(&["n/legacy"])
    );
    assert_eq!(
        docs(&f, "updated:\"2026-03-01T00:00:00Z\"").unwrap(),
        set(&["n/legacy"])
    );
    for text in [
        "updated:[2026-03-01 TO *]",
        "updated:[2026-13-01T00:00:00Z TO *]",
        "updated:[* TO *]",
        "updated:roll*",
    ] {
        assert!(
            matches!(docs(&f, text), Err(StoreError::Invalid(_))),
            "`{text}` should be refused"
        );
    }
}

#[test]
fn paths_match_by_word_and_whole() {
    let f = fixture();
    assert_eq!(docs(&f, "path:legacy").unwrap(), set(&["n/legacy"]));
    assert_eq!(docs(&f, "path:\"legacy.md\"").unwrap(), set(&["n/legacy"]));
    assert_eq!(
        docs(&f, "path:roll*").unwrap(),
        set(&["n/roll", "n/rollback"])
    );
}

#[test]
fn boost_and_clause_nesting_count_toward_depth() {
    let f = fixture();
    // 15 boosts around a two-term clause: 16 levels, allowed; 16 boosts: 17, refused.
    let nested = |boosts: usize| {
        let mut text = "(roll OR rollback)".to_owned();
        for _ in 0..boosts {
            text = format!("({text})^2");
        }
        text
    };
    assert!(docs(&f, &nested(15)).is_ok());
    assert!(matches!(docs(&f, &nested(16)), Err(StoreError::Invalid(_))));
}

#[test]
fn an_all_negative_query_means_everything_but_that() {
    let f = fixture();
    assert_eq!(
        docs(&f, "-roll -star").unwrap(),
        set(&["n/legacy", "n/rollback"])
            .difference(&docs(&f, "roll OR star").unwrap())
            .cloned()
            .collect()
    );
    assert_eq!(docs(&f, "-roll").unwrap().len(), 3);
}

#[test]
fn the_error_names_the_position_and_the_fields() {
    let f = fixture();
    let Err(StoreError::Invalid(why)) = docs(&f, "title:") else {
        panic!("refused");
    };
    assert!(why.contains("position 6"), "{why}");
    assert!(why.contains("title") && why.contains("meta.<key>"), "{why}");
    let Err(StoreError::Invalid(why)) = docs(&f, "access:space") else {
        panic!("refused");
    };
    assert!(why.contains("access"), "{why}");
    assert!(
        !why.contains("valid fields"),
        "the access refusal is its own message: {why}"
    );
}
