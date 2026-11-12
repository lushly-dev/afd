//! A find's rules and its cursors (records host specification, section 7; D164) and a match's
//! rules (section 8; D165), as pure functions: every backend refuses the same queries, writes the
//! same cursors and reads a match's texts into the same terms.
//!
//! A refusal names the rule and never a value of the query.

use serde_json::{Value, json};

use std::collections::BTreeMap;

use super::{
    FindOrder, KeyFilter, MAX_FIND_LIMIT, MAX_FIND_QUERY_CHARS, MAX_KEY_FILTERS, MAX_KEY_VALUES,
    MAX_LANE_TEXT_BYTES, MAX_MATCH_EXCLUDE, MAX_MATCH_K, MAX_MATCH_TEXTS, RecordDecl, RecordFind,
    RecordMatch, Standing, match_digest,
};
use crate::canonical::{base64_decode, base64_encode, canonical_json};
use crate::document::{Rev, check_identifier};
use crate::error::{Result, StoreError};
use crate::memory::tokenizer::tokens;

/// Where a page ended: the last item's place in the query's order.
#[derive(Debug, Clone, PartialEq)]
pub enum Cursor {
    /// Order `id`: the last item's id.
    Id(String),
    /// Order `recent`: the last item's first revision and id.
    Recent(Rev, String),
    /// Order `rank`: the last item's score at four places, its first revision and its id.
    Rank(f64, Rev, String),
}

impl Cursor {
    /// The order this cursor continues.
    #[must_use]
    pub fn order(&self) -> FindOrder {
        match self {
            Self::Id(_) => FindOrder::Id,
            Self::Recent(..) => FindOrder::Recent,
            Self::Rank(..) => FindOrder::Rank,
        }
    }

    /// The cursor as a page's `next`: the base64 of the canonical JSON `{ "k": [...], "o": order }`.
    #[must_use]
    pub fn encode(&self) -> String {
        let key = match self {
            Self::Id(id) => json!([id]),
            Self::Recent(created, id) => json!([created, id]),
            Self::Rank(score, created, id) => json!([score, created, id]),
        };
        let cursor = json!({ "o": self.order().as_str(), "k": key });
        base64_encode(canonical_json(&cursor).as_bytes())
    }

    /// Read a page's `next` for a query of `order`.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] for text that is not a cursor, or a cursor of another order.
    pub fn decode(order: FindOrder, text: &str) -> Result<Self> {
        let refused = || StoreError::invalid("after is not a cursor this query's order gave");
        let bytes = base64_decode(text).map_err(|_| refused())?;
        let cursor: Value = serde_json::from_slice(&bytes).map_err(|_| refused())?;
        if cursor.get("o").and_then(Value::as_str) != Some(order.as_str()) {
            return Err(refused());
        }
        let key = cursor
            .get("k")
            .and_then(Value::as_array)
            .ok_or_else(refused)?;
        let id = |value: &Value| value.as_str().map(str::to_owned);
        // A revision is at most 2^63 - 1, as every store holds it: a cursor that names a larger
        // one was not given by a find, and is refused here, where the refusal has its code.
        let revision = |value: &Value| value.as_u64().filter(|rev| i64::try_from(*rev).is_ok());
        let found = match (order, key.as_slice()) {
            (FindOrder::Id, [last]) => id(last).map(Self::Id),
            (FindOrder::Recent, [created, last]) => revision(created)
                .zip(id(last))
                .map(|(created, last)| Self::Recent(created, last)),
            (FindOrder::Rank, [score, created, last]) => score
                .as_f64()
                .zip(revision(created))
                .zip(id(last))
                .map(|((score, created), last)| Self::Rank(score, created, last)),
            _ => None,
        };
        found.ok_or_else(refused)
    }
}

/// A find's text query, read under its declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPlan {
    /// The searched text pointers' positions in the declaration, ascending.
    pub fields: Vec<u8>,
    /// The query's distinct terms, in byte order.
    pub terms: Vec<String>,
}

/// A find that passed section 7's rules, in the form a backend runs.
#[derive(Debug, Clone, PartialEq)]
pub struct FindPlan {
    /// Each key filter as its key pointer's position in the declaration and its values.
    pub keys: Vec<(u8, Vec<String>)>,
    /// The text query, when the find has one.
    pub text: Option<TextPlan>,
    /// Where the page before ended.
    pub after: Option<Cursor>,
}

impl RecordFind {
    /// Section 7's rules for this find under `decl`: the kind is the declaration's; at most
    /// [`MAX_KEY_FILTERS`] filters, each over a key pointer of the declaration with 1 to
    /// [`MAX_KEY_VALUES`] values; no standing filter on a kind without standing; a text query of
    /// 1 to [`MAX_FIND_QUERY_CHARS`] characters with at least one token, over text pointers of
    /// the declaration; order `rank` only with a text query; a limit of 1 to [`MAX_FIND_LIMIT`];
    /// and a cursor of this query's order.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the rule broken, never a value.
    pub fn plan(&self, decl: &RecordDecl) -> Result<FindPlan> {
        if self.kind != decl.kind {
            return Err(StoreError::invalid(
                "kind is not the kind of the declaration the find runs under",
            ));
        }
        let keys = key_filters(decl, &self.keys)?;
        standing_filter(decl, &self.standings, self.verified_only)?;
        let text = match &self.text {
            None => None,
            Some(text) => {
                if !(1..=MAX_FIND_QUERY_CHARS).contains(&text.query.chars().count()) {
                    return Err(StoreError::invalid(format!(
                        "the text query is 1 to {MAX_FIND_QUERY_CHARS} characters"
                    )));
                }
                let mut fields = Vec::with_capacity(text.fields.len());
                for field in &text.fields {
                    let Some(position) = decl.text.iter().position(|pointer| pointer == field)
                    else {
                        return Err(StoreError::invalid(format!(
                            "the pointer {field} of the text query is not a text pointer of the declaration"
                        )));
                    };
                    fields.push(position_of(position));
                }
                if fields.is_empty() {
                    fields = (0..decl.text.len()).map(position_of).collect();
                }
                fields.sort_unstable();
                fields.dedup();
                if fields.is_empty() {
                    return Err(StoreError::invalid(
                        "the text query needs a kind that declares a text pointer",
                    ));
                }
                let mut terms = tokens(&text.query);
                terms.sort();
                terms.dedup();
                if terms.is_empty() {
                    return Err(StoreError::invalid("the text query holds no token"));
                }
                Some(TextPlan { fields, terms })
            }
        };
        if self.order == FindOrder::Rank && text.is_none() {
            return Err(StoreError::invalid("order rank needs a text query"));
        }
        if !(1..=MAX_FIND_LIMIT).contains(&self.limit) {
            return Err(StoreError::invalid(format!(
                "limit must be 1 to {MAX_FIND_LIMIT}"
            )));
        }
        let after = self
            .after
            .as_deref()
            .map(|after| Cursor::decode(self.order, after))
            .transpose()?;
        Ok(FindPlan { keys, text, after })
    }
}

/// The key filters of a find or a match under `decl`: at most [`MAX_KEY_FILTERS`], each over a
/// key pointer of the declaration with 1 to [`MAX_KEY_VALUES`] values, as each key pointer's
/// position in the declaration and its values.
fn key_filters(decl: &RecordDecl, filters: &[KeyFilter]) -> Result<Vec<(u8, Vec<String>)>> {
    if filters.len() > MAX_KEY_FILTERS {
        return Err(StoreError::invalid(format!(
            "keys holds at most {MAX_KEY_FILTERS} filters"
        )));
    }
    let mut keys = Vec::with_capacity(filters.len());
    for filter in filters {
        let Some(position) = decl.keys.iter().position(|key| *key == filter.key) else {
            return Err(StoreError::invalid(format!(
                "the pointer {} of a key filter is not a key pointer of the declaration",
                filter.key
            )));
        };
        if !(1..=MAX_KEY_VALUES).contains(&filter.any.len()) {
            return Err(StoreError::invalid(format!(
                "the key filter on {} holds 1 to {MAX_KEY_VALUES} values in any",
                filter.key
            )));
        }
        keys.push((position_of(position), filter.any.clone()));
    }
    Ok(keys)
}

/// A kind without standing has no standing to ask for.
fn standing_filter(decl: &RecordDecl, standings: &[Standing], verified_only: bool) -> Result<()> {
    if !decl.standing && (!standings.is_empty() || verified_only) {
        return Err(StoreError::invalid(
            "standings must be empty and verified_only false for a kind without standing",
        ));
    }
    Ok(())
}

/// One text of a match as the lane reads it (sections 8.1 and 8.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchText {
    /// The digest of the text's normalised form; `None` when that form is empty, and the text is
    /// then identical to nothing.
    pub digest: Option<[u8; 32]>,
    /// The text's distinct terms with their frequencies, in the terms' byte order. Empty for a
    /// text with no token, which is near nothing.
    pub terms: Vec<(String, u32)>,
    /// The text's tokens, in all.
    pub length: u32,
}

impl MatchText {
    /// Read `text` with the lane's normalisation and its tokenizer.
    #[must_use]
    pub fn of(text: &str) -> Self {
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        let mut length = 0u32;
        for token in tokens(text) {
            *counts.entry(token).or_default() += 1;
            length += 1;
        }
        Self {
            digest: match_digest(text),
            terms: counts.into_iter().collect(),
            length,
        }
    }
}

/// A match that passed section 8's rules, in the form a backend runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchPlan {
    /// The match field's position among the declaration's text pointers.
    pub field: u8,
    /// Each key filter as its key pointer's position in the declaration and its values.
    pub keys: Vec<(u8, Vec<String>)>,
    /// Each text, in the query's order.
    pub texts: Vec<MatchText>,
    /// The excluded ids, each once, in byte order.
    pub exclude: Vec<String>,
}

impl RecordMatch {
    /// Section 8's rules for this match under `decl`: the kind is the declaration's and has a
    /// match field; 1 to [`MAX_MATCH_TEXTS`] texts, each of 1 byte to [`MAX_LANE_TEXT_BYTES`];
    /// `k` of 1 to [`MAX_MATCH_K`]; key filters as a find's; no standing filter on a kind without
    /// standing; and at most [`MAX_MATCH_EXCLUDE`] excluded ids, each a record id's shape.
    ///
    /// A text with no token, and one whose normalised form is empty, break no rule: the first is
    /// near nothing and the second also identical to nothing.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the rule broken, never a value.
    pub fn plan(&self, decl: &RecordDecl) -> Result<MatchPlan> {
        if self.kind != decl.kind {
            return Err(StoreError::invalid(
                "kind is not the kind of the declaration the match runs under",
            ));
        }
        let Some(field) = decl.matched.filter(|index| *index < decl.text.len()) else {
            return Err(StoreError::invalid(
                "a match needs a kind that declares a match field",
            ));
        };
        if !(1..=MAX_MATCH_TEXTS).contains(&self.texts.len()) {
            return Err(StoreError::invalid(format!(
                "texts holds 1 to {MAX_MATCH_TEXTS} texts"
            )));
        }
        if self
            .texts
            .iter()
            .any(|text| !(1..=MAX_LANE_TEXT_BYTES).contains(&text.len()))
        {
            return Err(StoreError::invalid(format!(
                "each text is 1 to {MAX_LANE_TEXT_BYTES} bytes"
            )));
        }
        if !(1..=MAX_MATCH_K).contains(&self.k) {
            return Err(StoreError::invalid(format!("k must be 1 to {MAX_MATCH_K}")));
        }
        let keys = key_filters(decl, &self.keys)?;
        standing_filter(decl, &self.standings, self.verified_only)?;
        if self.exclude.len() > MAX_MATCH_EXCLUDE {
            return Err(StoreError::invalid(format!(
                "exclude holds at most {MAX_MATCH_EXCLUDE} ids"
            )));
        }
        if self
            .exclude
            .iter()
            .any(|id| check_identifier("a record id", id).is_err())
        {
            return Err(StoreError::invalid(
                "each excluded id is a record id of 1 to 512 bytes without a control character",
            ));
        }
        let mut exclude = self.exclude.clone();
        exclude.sort_unstable();
        exclude.dedup();
        Ok(MatchPlan {
            field: position_of(field),
            keys,
            texts: self.texts.iter().map(|text| MatchText::of(text)).collect(),
            exclude,
        })
    }
}

/// A pointer's position in its list, which [`RecordDecl::check`] holds under 256 entries.
fn position_of(index: usize) -> u8 {
    u8::try_from(index).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lane::{Pointer, TextQuery};

    fn pointer(text: &str) -> Pointer {
        Pointer::parse(text).unwrap()
    }

    fn decl(standing: bool) -> RecordDecl {
        RecordDecl {
            kind: "note".to_owned(),
            standing,
            text: vec![pointer("/statement"), pointer("/why")],
            keys: vec![pointer("/bed"), pointer("/tags")],
            matched: Some(0),
        }
    }

    fn find() -> RecordFind {
        RecordFind {
            kind: "note".to_owned(),
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Id,
            after: None,
            limit: 10,
            total: false,
        }
    }

    fn refused(query: &RecordFind, declared: &RecordDecl, rule: &str) {
        match query.plan(declared) {
            Err(StoreError::Invalid(why)) => assert!(why.contains(rule), "{why}"),
            other => panic!("{rule}: {other:?}"),
        }
    }

    #[test]
    fn a_plan_names_positions_fields_and_distinct_terms() {
        let query = RecordFind {
            keys: vec![KeyFilter {
                key: pointer("/tags"),
                any: vec!["soil".to_owned(), "roses".to_owned()],
            }],
            text: Some(TextQuery {
                query: "Mulch the roses; mulch holds water".to_owned(),
                fields: Vec::new(),
            }),
            order: FindOrder::Rank,
            ..find()
        };
        let plan = query.plan(&decl(false)).unwrap();
        assert_eq!(
            plan.keys,
            [(1, vec!["soil".to_owned(), "roses".to_owned()])]
        );
        let text = plan.text.unwrap();
        assert_eq!(text.fields, [0, 1], "no field named means every one");
        assert_eq!(text.terms, ["hold", "mulch", "rose", "the", "water"]);
        assert_eq!(plan.after, None);
    }

    #[test]
    fn each_rule_of_section_7_refuses_naming_itself() {
        let plain = decl(false);
        let key = |any: usize| KeyFilter {
            key: pointer("/bed"),
            any: (0..any).map(|n| format!("v{n}")).collect(),
        };
        refused(
            &RecordFind {
                kind: "other".to_owned(),
                ..find()
            },
            &plain,
            "kind is not",
        );
        refused(
            &RecordFind {
                keys: (0..9).map(|_| key(1)).collect(),
                ..find()
            },
            &plain,
            "at most 8 filters",
        );
        refused(
            &RecordFind {
                keys: vec![KeyFilter {
                    key: pointer("/statement"),
                    any: vec!["x".to_owned()],
                }],
                ..find()
            },
            &plain,
            "/statement of a key filter is not a key pointer",
        );
        for any in [0, 65] {
            refused(
                &RecordFind {
                    keys: vec![key(any)],
                    ..find()
                },
                &plain,
                "1 to 64 values",
            );
        }
        refused(
            &RecordFind {
                standings: vec![Standing::Affirmed],
                ..find()
            },
            &plain,
            "a kind without standing",
        );
        refused(
            &RecordFind {
                verified_only: true,
                ..find()
            },
            &plain,
            "a kind without standing",
        );
        let text = |query: &str, fields: &[&str]| {
            Some(TextQuery {
                query: query.to_owned(),
                fields: fields.iter().map(|field| pointer(field)).collect(),
            })
        };
        for (query, rule) in [
            ("", "1 to 1024 characters"),
            (&"x".repeat(1025)[..], "1 to 1024 characters"),
            ("... !!", "holds no token"),
        ] {
            refused(
                &RecordFind {
                    text: text(query, &[]),
                    ..find()
                },
                &plain,
                rule,
            );
        }
        refused(
            &RecordFind {
                text: text("roses", &["/bed"]),
                ..find()
            },
            &plain,
            "/bed of the text query is not a text pointer",
        );
        refused(
            &RecordFind {
                order: FindOrder::Rank,
                ..find()
            },
            &plain,
            "order rank needs a text query",
        );
        for limit in [0, 201] {
            refused(
                &RecordFind { limit, ..find() },
                &plain,
                "limit must be 1 to 200",
            );
        }
        // A standing kind takes the standing filter; what it admits is the host's to say.
        let standing = RecordFind {
            standings: vec![Standing::Affirmed],
            verified_only: true,
            ..find()
        };
        assert!(standing.plan(&decl(true)).is_ok());
        // A kind with keys alone has nothing a text query could search.
        let keys_only = RecordDecl {
            text: Vec::new(),
            matched: None,
            ..decl(false)
        };
        refused(
            &RecordFind {
                text: text("roses", &[]),
                ..find()
            },
            &keys_only,
            "declares a text pointer",
        );
    }

    fn matching() -> RecordMatch {
        RecordMatch {
            kind: "note".to_owned(),
            texts: vec!["Mulch the roses; mulch holds water.".to_owned()],
            k: 5,
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            exclude: Vec::new(),
        }
    }

    fn match_refused(query: &RecordMatch, declared: &RecordDecl, rule: &str) {
        match query.plan(declared) {
            Err(StoreError::Invalid(why)) => assert!(why.contains(rule), "{why}"),
            other => panic!("{rule}: {other:?}"),
        }
    }

    #[test]
    fn a_match_plan_reads_each_text_into_its_digest_and_its_terms() {
        let query = RecordMatch {
            texts: vec![
                "Mulch the roses; mulch holds water.".to_owned(),
                "  MULCH the roses;\tmulch holds water. ".to_owned(),
                "...".to_owned(),
                " \u{a0} ".to_owned(),
            ],
            keys: vec![KeyFilter {
                key: pointer("/tags"),
                any: vec!["soil".to_owned()],
            }],
            exclude: vec!["n2".to_owned(), "n1".to_owned(), "n2".to_owned()],
            ..matching()
        };
        // The match field is the declaration's second text pointer here.
        let declared = RecordDecl {
            matched: Some(1),
            ..decl(true)
        };
        let plan = query.plan(&declared).unwrap();
        assert_eq!(plan.field, 1);
        assert_eq!(plan.keys, [(1, vec!["soil".to_owned()])]);
        assert_eq!(plan.exclude, ["n1", "n2"], "each id once, in byte order");
        let first = &plan.texts[0];
        let terms: Vec<(&str, u32)> = first
            .terms
            .iter()
            .map(|(term, tf)| (term.as_str(), *tf))
            .collect();
        assert_eq!(
            terms,
            [
                ("hold", 1),
                ("mulch", 2),
                ("rose", 1),
                ("the", 1),
                ("water", 1)
            ],
            "distinct terms in byte order, each with its frequency"
        );
        assert_eq!(first.length, 6);
        assert_eq!(first.digest, crate::lane::match_digest(&query.texts[0]));
        assert_eq!(
            plan.texts[1], *first,
            "case and whitespace change neither the digest nor the terms"
        );
        // A text with no token keeps its digest, and one that is blank has neither.
        assert!(plan.texts[2].digest.is_some());
        assert!(plan.texts[2].terms.is_empty() && plan.texts[2].length == 0);
        assert_eq!(
            plan.texts[3],
            MatchText {
                digest: None,
                terms: Vec::new(),
                length: 0
            }
        );
    }

    #[test]
    fn each_rule_of_section_8_refuses_naming_itself() {
        let standing = decl(true);
        match_refused(
            &RecordMatch {
                kind: "other".to_owned(),
                ..matching()
            },
            &standing,
            "kind is not",
        );
        match_refused(
            &matching(),
            &RecordDecl {
                matched: None,
                ..decl(true)
            },
            "declares a match field",
        );
        for count in [0, MAX_MATCH_TEXTS + 1] {
            match_refused(
                &RecordMatch {
                    texts: (0..count).map(|n| format!("Mulch {n}.")).collect(),
                    ..matching()
                },
                &standing,
                "texts holds 1 to 64 texts",
            );
        }
        for text in [String::new(), "é".repeat(MAX_LANE_TEXT_BYTES / 2 + 1)] {
            match_refused(
                &RecordMatch {
                    texts: vec!["Mulch.".to_owned(), text],
                    ..matching()
                },
                &standing,
                "each text is 1 to 16384 bytes",
            );
        }
        for k in [0, MAX_MATCH_K + 1] {
            match_refused(
                &RecordMatch { k, ..matching() },
                &standing,
                "k must be 1 to 20",
            );
        }
        let key = |any: usize| KeyFilter {
            key: pointer("/bed"),
            any: (0..any).map(|n| format!("v{n}")).collect(),
        };
        match_refused(
            &RecordMatch {
                keys: (0..9).map(|_| key(1)).collect(),
                ..matching()
            },
            &standing,
            "at most 8 filters",
        );
        match_refused(
            &RecordMatch {
                keys: vec![key(0)],
                ..matching()
            },
            &standing,
            "1 to 64 values",
        );
        match_refused(
            &RecordMatch {
                exclude: (0..=MAX_MATCH_EXCLUDE).map(|n| format!("n{n}")).collect(),
                ..matching()
            },
            &standing,
            "exclude holds at most 64 ids",
        );
        for id in [String::new(), "n\u{7}1".to_owned(), "n".repeat(513)] {
            match_refused(
                &RecordMatch {
                    exclude: vec![id],
                    ..matching()
                },
                &standing,
                "each excluded id is a record id",
            );
        }
        for query in [
            RecordMatch {
                standings: vec![Standing::Affirmed],
                ..matching()
            },
            RecordMatch {
                verified_only: true,
                ..matching()
            },
        ] {
            match_refused(&query, &decl(false), "a kind without standing");
            assert!(query.plan(&standing).is_ok());
        }
        // The limits themselves pass: 64 texts of 16 KiB, k of 20, 64 excluded ids, 8 filters.
        let widest = RecordMatch {
            texts: vec!["x".repeat(MAX_LANE_TEXT_BYTES); MAX_MATCH_TEXTS],
            k: MAX_MATCH_K,
            keys: (0..8).map(|_| key(64)).collect(),
            exclude: (0..MAX_MATCH_EXCLUDE).map(|n| format!("n{n}")).collect(),
            ..matching()
        };
        assert_eq!(widest.plan(&standing).unwrap().texts.len(), 64);
        // A refusal never holds a text or an id.
        let long = RecordMatch {
            texts: vec!["canary".repeat(4000)],
            exclude: vec!["canary\u{7}".to_owned()],
            ..matching()
        };
        let Err(StoreError::Invalid(why)) = long.plan(&standing) else {
            panic!("a text past 16 KiB passed");
        };
        assert!(!why.contains("canary"), "{why}");
    }

    #[test]
    fn a_refusal_never_holds_the_query() {
        let query = RecordFind {
            text: Some(TextQuery {
                query: "canary".repeat(200),
                fields: Vec::new(),
            }),
            ..find()
        };
        let Err(StoreError::Invalid(why)) = query.plan(&decl(false)) else {
            panic!("a query past 1024 characters passed");
        };
        assert!(!why.contains("canary"), "{why}");
    }

    #[test]
    fn a_cursor_reads_back_for_its_own_order_only() {
        let cursors = [
            Cursor::Id("n-0007".to_owned()),
            Cursor::Recent(41, "Ünï/a".to_owned()),
            Cursor::Rank(1.2345, 7, "n1".to_owned()),
            Cursor::Rank(0.0, 1, "n2".to_owned()),
        ];
        for cursor in &cursors {
            let text = cursor.encode();
            assert_eq!(&Cursor::decode(cursor.order(), &text).unwrap(), cursor);
            for other in [FindOrder::Id, FindOrder::Recent, FindOrder::Rank] {
                if other != cursor.order() {
                    assert!(Cursor::decode(other, &text).is_err(), "{other:?}");
                }
            }
        }
        // The cursor is the base64 of the canonical JSON `{ "k": [...], "o": order }`.
        assert_eq!(
            base64_decode(&Cursor::Recent(41, "n1".to_owned()).encode()).unwrap(),
            br#"{"k":[41,"n1"],"o":"recent"}"#
        );
        for bad in ["", "n1", "!!!!", "e30=", "eyJvIjoiaWQifQ=="] {
            assert!(Cursor::decode(FindOrder::Id, bad).is_err(), "{bad}");
        }
        // A forged cursor whose revision no store holds is refused here, by the same rule.
        let forged = |key: Value, order: &str| {
            base64_encode(canonical_json(&json!({ "o": order, "k": key })).as_bytes())
        };
        let top = i64::MAX as u64;
        for (order, key) in [
            (FindOrder::Recent, json!([u64::MAX, "n1"])),
            (FindOrder::Recent, json!([top + 1, "n1"])),
            (FindOrder::Recent, json!([-1, "n1"])),
            (FindOrder::Recent, json!([1.5, "n1"])),
            (FindOrder::Rank, json!([0.5, u64::MAX, "n1"])),
            (FindOrder::Rank, json!(["0.5", 1, "n1"])),
        ] {
            let text = forged(key.clone(), order.as_str());
            assert!(Cursor::decode(order, &text).is_err(), "{key}");
        }
        assert_eq!(
            Cursor::decode(FindOrder::Recent, &forged(json!([top, "n1"]), "recent")).unwrap(),
            Cursor::Recent(top, "n1".to_owned())
        );
        let query = RecordFind {
            after: Some(Cursor::Recent(3, "n1".to_owned()).encode()),
            ..find()
        };
        refused(&query, &decl(false), "not a cursor this query's order gave");
    }
}
