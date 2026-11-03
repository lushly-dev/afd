//! The memory query parser (phase 3 section 5.2): every form, the limits, error positions, and
//! the FTS5 text it compiles to, `+a b` included.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use umbel_store::memory::{MAX_MEMORY_QUERY_TERMS, Occur, QueryTerm, TermField};
use umbel_store::{MemoryQuery, StoreError};

fn parse(text: &str) -> MemoryQuery {
    MemoryQuery::parse(text).unwrap_or_else(|e| panic!("`{text}`: {e}"))
}

fn fts(text: &str) -> String {
    parse(text).fts5()
}

/// The error text, which must be `Invalid` and name a position.
fn error(text: &str) -> String {
    match MemoryQuery::parse(text) {
        Err(StoreError::Invalid(why)) => {
            assert!(why.contains("at position"), "`{text}`: {why}");
            why
        }
        other => panic!("`{text}` should be invalid, got {other:?}"),
    }
}

fn term(
    occur: Occur,
    field: Option<TermField>,
    text: &str,
    phrase: bool,
    prefix: bool,
) -> QueryTerm {
    QueryTerm {
        occur,
        field,
        text: text.to_owned(),
        phrase,
        prefix,
    }
}

#[test]
fn every_form_parses() {
    let q = parse("word \"a phrase\" roll* +must -not subject:s tags:t body:\"b c\" +subject:xy*");
    assert_eq!(
        q.terms(),
        [
            term(Occur::Should, None, "word", false, false),
            term(Occur::Should, None, "a phrase", true, false),
            term(Occur::Should, None, "roll", false, true),
            term(Occur::Must, None, "must", false, false),
            term(Occur::MustNot, None, "not", false, false),
            term(Occur::Should, Some(TermField::Subject), "s", false, false),
            term(Occur::Should, Some(TermField::Tags), "t", false, false),
            term(Occur::Should, Some(TermField::Body), "b c", true, false),
            term(Occur::Must, Some(TermField::Subject), "xy", false, true),
        ]
    );
}

#[test]
fn operators_and_unknown_fields_are_plain_words() {
    let q = parse("a AND b OR NOT c col:x NEAR(");
    assert!(
        q.terms()
            .iter()
            .all(|t| t.occur == Occur::Should && t.field.is_none())
    );
    let words: Vec<_> = q.terms().iter().map(|t| t.text.as_str()).collect();
    assert_eq!(words, ["a", "AND", "b", "OR", "NOT", "c", "col:x", "NEAR("]);
}

#[test]
fn plus_a_b_compiles_as_section_5_2_says() {
    assert_eq!(fts("+a b"), r#""a" AND ("a" OR "b")"#);
    assert_eq!(
        fts("+r1 +r2 p1 p2"),
        r#""r1" AND "r2" AND ("r1" OR "p1" OR "p2")"#
    );
    assert_eq!(fts("+r1 +r2"), r#""r1" AND "r2""#);
    assert_eq!(fts("p1 p2"), r#""p1" OR "p2""#);
    assert_eq!(fts("p1 p2 -x -y"), r#"("p1" OR "p2") NOT "x" NOT "y""#);
    assert_eq!(fts("+a b -x"), r#"("a" AND ("a" OR "b")) NOT "x""#);
}

#[test]
fn every_term_is_double_quoted_with_quotes_doubled() {
    assert_eq!(fts("x\"y"), r#""x""y""#);
    assert_eq!(fts("NEAR(a"), r#""NEAR(a""#);
    assert_eq!(fts("col:x"), r#""col:x""#);
    assert_eq!(fts("roll*"), r#""roll"*"#);
    assert_eq!(fts("\"a phrase\""), r#""a phrase""#);
    assert_eq!(
        fts("subject:a tags:b body:c"),
        r#"subject:"a" OR tags:"b" OR text:"c""#
    );
    assert_eq!(fts("+body:xy*"), r#"text:"xy"*"#);
}

#[test]
fn errors_name_their_position() {
    assert!(error("\"open").contains("position 0"));
    assert!(error("a \"open").contains("position 2"));
    assert!(error("a *").contains("position 2"));
    assert!(
        error("a r*").contains("position 2"),
        "one character before a star"
    );
    assert!(
        error("a b*c").contains("position 2"),
        "a star inside a word"
    );
    assert!(error("a + b").contains("position 2"), "a sign alone");
    assert!(
        error("a subject: b").contains("position 2"),
        "a field alone"
    );
    assert!(error("a \"\"").contains("position 2"), "an empty phrase");
    assert!(
        error("a \"x\"y").contains("position 5"),
        "a phrase runs into a word"
    );
    assert!(
        error("a \"x\"*").contains("position 5"),
        "a phrase takes no star"
    );
    assert!(error("a ((").contains("position 2"), "no letter or digit");
    assert!(error("-a -b").contains("position 0"), "only excluded terms");
    assert!(error("").contains("position 0"));
    assert!(error("   ").contains("position 0"));
}

#[test]
fn limits() {
    let at_cap = vec!["t"; MAX_MEMORY_QUERY_TERMS].join(" ");
    assert_eq!(parse(&at_cap).terms().len(), MAX_MEMORY_QUERY_TERMS);
    let over = format!("{at_cap} t");
    assert!(error(&over).contains(&format!("position {}", at_cap.len() + 1)));
    let long = "x".repeat(1024);
    assert_eq!(parse(&long).terms().len(), 1);
    assert!(error(&"x".repeat(1025)).contains("position 1024"));
    // Characters, not bytes.
    assert_eq!(parse(&"é".repeat(1024)).terms().len(), 1);
}

#[test]
fn any_of_builds_an_or_of_plain_terms() {
    let q = MemoryQuery::any_of(["deploy", "canary"]).unwrap();
    assert_eq!(q.fts5(), r#""deploy" OR "canary""#);
    assert!(MemoryQuery::any_of(Vec::<String>::new()).is_err());
    assert!(MemoryQuery::any_of(["two words"]).is_err());
    assert!(MemoryQuery::any_of(["(("]).is_err());
    assert!(MemoryQuery::any_of(vec!["t"; MAX_MEMORY_QUERY_TERMS + 1]).is_err());
    assert_eq!(
        MemoryQuery::any_of(vec!["t"; MAX_MEMORY_QUERY_TERMS])
            .unwrap()
            .terms()
            .len(),
        MAX_MEMORY_QUERY_TERMS
    );
}
