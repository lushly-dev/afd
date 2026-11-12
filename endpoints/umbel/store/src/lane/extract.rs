//! What a declared put takes from a record's body (records host specification, sections 4.2
//! step 4, 4.3 and 8.1): the values at the text pointers, the values at the key pointers, the
//! wording hash, the match digest, and the terms of each text value with their frequencies.
//!
//! A refusal names the pointer and never the value.

use std::collections::BTreeMap;

use serde_json::Value;

use super::{
    MAX_KEY_VALUE_BYTES, MAX_KEY_VALUES, MAX_LANE_TEXT_BYTES, MAX_TEXT_POINTERS, Pointer,
    RecordDecl, match_digest,
};
use crate::canonical::{ContentHash, canonical_json};
use crate::error::{Result, StoreError};
use crate::memory::tokenizer::tokens;

/// What [`extract`] found in a body under a declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extracted {
    /// The value at each text pointer, by its position in the declaration; `None` when it is
    /// absent or `null`, and past the declaration's last text pointer.
    pub texts: [Option<String>; MAX_TEXT_POINTERS],
    /// `(key position, value)`, sorted and distinct.
    pub keys: Vec<(u8, String)>,
    /// `sha256:` of the canonical JSON of the array of text values in declaration order, `null`
    /// for an absent one. `None` for a kind with no text pointer.
    pub wording_hash: Option<ContentHash>,
    /// The digest of the match field's normalised value (section 8.1); `None` with no match
    /// field, no value, or a value whose normalised form is empty.
    pub match_digest: Option<[u8; 32]>,
    /// `(field position, term, frequency)`, sorted by field and term: the tokens of each text
    /// value, as the memory tokenizer gives them.
    pub terms: Vec<(u8, String, u32)>,
    /// The number of tokens of each text value; 0 when absent.
    pub lengths: [u32; MAX_TEXT_POINTERS],
}

/// Read `body` under `decl`. A value at a text pointer must be a string of at most
/// [`MAX_LANE_TEXT_BYTES`] bytes, or absent or `null`. A value at a key pointer must be a string,
/// or an array of at most [`MAX_KEY_VALUES`] strings, each of 1 to [`MAX_KEY_VALUE_BYTES`] bytes
/// with no control character, or absent or `null`.
///
/// # Errors
/// [`StoreError::Invalid`] naming the pointer and the rule, never the value; and what
/// [`RecordDecl::check`] refuses.
pub fn extract(decl: &RecordDecl, body: &Value) -> Result<Extracted> {
    decl.check()?;
    let mut texts: [Option<String>; MAX_TEXT_POINTERS] = Default::default();
    let mut lengths = [0u32; MAX_TEXT_POINTERS];
    let mut terms = Vec::new();
    for (field, pointer) in decl.text.iter().enumerate() {
        let Some(text) = text_value(pointer, body)? else {
            continue;
        };
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        let mut length = 0u32;
        for token in tokens(text) {
            *counts.entry(token).or_default() += 1;
            length += 1;
        }
        let position = position(field);
        terms.extend(
            counts
                .into_iter()
                .map(|(term, frequency)| (position, term, frequency)),
        );
        lengths[field] = length;
        texts[field] = Some(text.to_owned());
    }
    let mut keys = Vec::new();
    for (key, pointer) in decl.keys.iter().enumerate() {
        for value in key_values(pointer, body)? {
            keys.push((position(key), value.to_owned()));
        }
    }
    keys.sort();
    keys.dedup();
    let wording_hash = (!decl.text.is_empty()).then(|| {
        let wording: Vec<Value> = texts[..decl.text.len()]
            .iter()
            .map(|text| text.clone().map_or(Value::Null, Value::String))
            .collect();
        ContentHash::of(canonical_json(&Value::Array(wording)).as_bytes())
    });
    let match_digest = decl
        .matched
        .and_then(|index| texts.get(index)?.as_deref())
        .and_then(match_digest);
    Ok(Extracted {
        texts,
        keys,
        wording_hash,
        match_digest,
        terms,
        lengths,
    })
}

/// A pointer's position in its list. [`RecordDecl::check`] holds both lists under 256 entries.
fn position(index: usize) -> u8 {
    u8::try_from(index).unwrap_or(u8::MAX)
}

fn refused(pointer: &Pointer, rule: impl std::fmt::Display) -> StoreError {
    StoreError::invalid(format!("the value at {pointer} must be {rule}"))
}

/// The string at a text pointer, or `None` when it is absent or `null`.
fn text_value<'a>(pointer: &Pointer, body: &'a Value) -> Result<Option<&'a str>> {
    match pointer.get(body) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.len() <= MAX_LANE_TEXT_BYTES => Ok(Some(text)),
        Some(_) => Err(refused(
            pointer,
            format_args!("a string of at most {MAX_LANE_TEXT_BYTES} bytes, or absent or null"),
        )),
    }
}

/// The strings at a key pointer: one, a list, or none when it is absent or `null`.
fn key_values<'a>(pointer: &Pointer, body: &'a Value) -> Result<Vec<&'a str>> {
    let rule = || {
        refused(
            pointer,
            format_args!(
                "a string, or an array of at most {MAX_KEY_VALUES} strings, each of 1 to {MAX_KEY_VALUE_BYTES} bytes with no control character, or absent or null"
            ),
        )
    };
    let key = |value: &'a Value| match value {
        Value::String(text)
            if (1..=MAX_KEY_VALUE_BYTES).contains(&text.len())
                && !text.chars().any(char::is_control) =>
        {
            Ok(text.as_str())
        }
        _ => Err(rule()),
    };
    match pointer.get(body) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) if items.len() <= MAX_KEY_VALUES => {
            items.iter().map(key).collect()
        }
        Some(Value::Array(_)) => Err(rule()),
        Some(value) => Ok(vec![key(value)?]),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn pointer(text: &str) -> Pointer {
        Pointer::parse(text).unwrap()
    }

    fn decl() -> RecordDecl {
        RecordDecl {
            kind: "note".to_owned(),
            standing: true,
            text: vec![pointer("/statement"), pointer("/detail/why")],
            keys: vec![pointer("/bed"), pointer("/tags")],
            matched: Some(0),
        }
    }

    /// The refusal's text, which must name `pointer` and hold none of `secrets`.
    fn refusal(body: &Value, pointer: &str, secrets: &[&str]) -> String {
        match extract(&decl(), body) {
            Err(StoreError::Invalid(why)) => {
                assert!(
                    why.contains(&format!("the value at {pointer} must be")),
                    "{why}"
                );
                for secret in secrets {
                    assert!(!why.contains(secret), "{why} holds {secret}");
                }
                why
            }
            other => panic!("{pointer}: {other:?}"),
        }
    }

    #[test]
    fn text_keys_terms_and_lengths_are_read_by_position() {
        let body = json!({
            "statement": "Mulch keeps the soil cool; mulch holds water.",
            "detail": { "why": "Bare soil dries." },
            "bed": "north",
            "tags": ["soil", "water", "soil"],
            "other": 7,
        });
        let found = extract(&decl(), &body).unwrap();
        assert_eq!(
            found.texts,
            [
                Some("Mulch keeps the soil cool; mulch holds water.".to_owned()),
                Some("Bare soil dries.".to_owned()),
                None,
                None,
            ]
        );
        assert_eq!(
            found.keys,
            [
                (0, "north".to_owned()),
                (1, "soil".to_owned()),
                (1, "water".to_owned()),
            ]
        );
        assert_eq!(found.lengths, [8, 3, 0, 0]);
        let field = |position: u8| -> Vec<(&str, u32)> {
            found
                .terms
                .iter()
                .filter(|(field, _, _)| *field == position)
                .map(|(_, term, frequency)| (term.as_str(), *frequency))
                .collect()
        };
        assert_eq!(
            field(0),
            [
                ("cool", 1),
                ("hold", 1),
                ("keep", 1),
                ("mulch", 2),
                ("soil", 1),
                ("the", 1),
                ("water", 1),
            ]
        );
        assert_eq!(field(1), [("bare", 1), ("dri", 1), ("soil", 1)]);
        // A field's frequencies sum to its length.
        for position in 0..2u8 {
            let sum: u32 = field(position).iter().map(|(_, frequency)| frequency).sum();
            assert_eq!(sum, found.lengths[usize::from(position)]);
        }
        assert_eq!(
            found.match_digest,
            match_digest("Mulch keeps the soil cool; mulch holds water.")
        );
    }

    #[test]
    fn the_wording_hash_is_of_the_text_values_in_declaration_order() {
        let both = extract(
            &decl(),
            &json!({ "statement": "a", "detail": { "why": "b" } }),
        )
        .unwrap();
        assert_eq!(both.wording_hash, Some(ContentHash::of(br#"["a","b"]"#)));
        // An absent value and a null one are the same wording, and are part of it.
        for body in [
            json!({ "statement": "a" }),
            json!({ "statement": "a", "detail": null }),
            json!({ "statement": "a", "detail": { "why": null } }),
            json!({ "statement": "a", "detail": "not an object" }),
        ] {
            let found = extract(&decl(), &body).unwrap();
            assert_eq!(found.wording_hash, Some(ContentHash::of(br#"["a",null]"#)));
            assert_eq!(found.texts[1], None);
        }
        // Keys and other fields are not wording.
        let with_keys = extract(
            &decl(),
            &json!({ "statement": "a", "bed": "south", "x": 1 }),
        )
        .unwrap();
        assert_eq!(
            with_keys.wording_hash,
            Some(ContentHash::of(br#"["a",null]"#))
        );
        // A kind with no text pointer has no wording.
        let keys_only = RecordDecl {
            standing: false,
            text: Vec::new(),
            matched: None,
            ..decl()
        };
        let found = extract(&keys_only, &json!({ "statement": "a", "bed": "south" })).unwrap();
        assert_eq!(found.wording_hash, None);
        assert_eq!(found.match_digest, None);
        assert!(found.terms.is_empty());
        assert_eq!(found.keys, [(0, "south".to_owned())]);
    }

    #[test]
    fn a_match_field_without_a_value_or_with_an_empty_form_has_no_digest() {
        for body in [
            json!({}),
            json!({ "statement": null }),
            json!({ "statement": "" }),
            json!({ "statement": " \t\u{a0} " }),
        ] {
            assert_eq!(
                extract(&decl(), &body).unwrap().match_digest,
                None,
                "{body}"
            );
        }
        let unmatched = RecordDecl {
            matched: None,
            ..decl()
        };
        let found = extract(&unmatched, &json!({ "statement": "Sow peas in March." })).unwrap();
        assert_eq!(found.match_digest, None);
        // The digest is of the match field alone.
        let second = RecordDecl {
            matched: Some(1),
            ..decl()
        };
        let found = extract(
            &second,
            &json!({ "statement": "Sow peas in March.", "detail": { "why": "Frost has passed." } }),
        )
        .unwrap();
        assert_eq!(found.match_digest, match_digest("Frost has passed."));
    }

    #[test]
    fn a_text_value_is_a_string_within_the_limit() {
        let most = "a".repeat(MAX_LANE_TEXT_BYTES);
        assert!(extract(&decl(), &json!({ "statement": most })).is_ok());
        let over = "a".repeat(MAX_LANE_TEXT_BYTES + 1);
        let why = refusal(&json!({ "statement": over }), "/statement", &["aaaa"]);
        assert!(why.contains("16384 bytes"), "{why}");
        for value in [
            json!(7),
            json!(true),
            json!(["compost"]),
            json!({ "a": "compost" }),
        ] {
            refusal(&json!({ "statement": value }), "/statement", &["compost"]);
        }
        refusal(
            &json!({ "statement": "a", "detail": { "why": ["compost"] } }),
            "/detail/why",
            &["compost"],
        );
    }

    #[test]
    fn a_key_value_is_a_string_or_a_list_of_strings_within_the_limits() {
        let body = |bed: Value, tags: Value| json!({ "statement": "a", "bed": bed, "tags": tags });
        let most = "k".repeat(MAX_KEY_VALUE_BYTES);
        let many: Vec<String> = (0..MAX_KEY_VALUES).map(|i| format!("t{i}")).collect();
        let found = extract(&decl(), &body(json!(most), json!(many))).unwrap();
        assert_eq!(found.keys.len(), 1 + MAX_KEY_VALUES);
        assert_eq!(
            extract(&decl(), &body(json!(null), json!([])))
                .unwrap()
                .keys,
            []
        );
        let over = "k".repeat(MAX_KEY_VALUE_BYTES + 1);
        for bad in [
            json!(""),
            json!(over),
            json!("north\nbed"),
            json!(3),
            json!({ "a": 1 }),
        ] {
            refusal(&body(bad.clone(), json!([])), "/bed", &["north"]);
            refusal(&body(json!("north"), json!([bad])), "/tags", &["north"]);
        }
        let too_many: Vec<String> = (0..=MAX_KEY_VALUES).map(|i| format!("t{i}")).collect();
        let why = refusal(&body(json!("north"), json!(too_many)), "/tags", &["t64"]);
        assert!(why.contains("at most 64 strings"), "{why}");
        refusal(
            &body(json!("north"), json!([["nested"]])),
            "/tags",
            &["nested"],
        );
    }

    #[test]
    fn a_declaration_that_breaks_its_rules_extracts_nothing() {
        let broken = RecordDecl {
            matched: Some(4),
            ..decl()
        };
        assert!(matches!(
            extract(&broken, &json!({ "statement": "a" })),
            Err(StoreError::Invalid(_))
        ));
    }
}
