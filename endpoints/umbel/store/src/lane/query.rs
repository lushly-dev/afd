//! A find's rules and its cursors (records host specification, section 7; D164), as pure
//! functions: every backend refuses the same queries and writes the same cursors.
//!
//! A refusal names the rule and never a value of the query.

use serde_json::{Value, json};

use super::{
    FindOrder, MAX_FIND_LIMIT, MAX_FIND_QUERY_CHARS, MAX_KEY_FILTERS, MAX_KEY_VALUES, RecordDecl,
    RecordFind,
};
use crate::canonical::{base64_decode, base64_encode, canonical_json};
use crate::document::Rev;
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
        if self.keys.len() > MAX_KEY_FILTERS {
            return Err(StoreError::invalid(format!(
                "keys holds at most {MAX_KEY_FILTERS} filters"
            )));
        }
        let mut keys = Vec::with_capacity(self.keys.len());
        for filter in &self.keys {
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
        if !decl.standing && (!self.standings.is_empty() || self.verified_only) {
            return Err(StoreError::invalid(
                "standings must be empty and verified_only false for a kind without standing",
            ));
        }
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

/// A pointer's position in its list, which [`RecordDecl::check`] holds under 256 entries.
fn position_of(index: usize) -> u8 {
    u8::try_from(index).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lane::{KeyFilter, Pointer, Standing, TextQuery};

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
