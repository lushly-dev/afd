//! The Ideas host-review specification's record shapes (sections 3 and 6.4): the person decision,
//! version 2, and the provenance envelope, version 4. Every example validates in
//! `every_example_validates_against_its_schema`; these tests hold what each schema refuses, that
//! the store reads the version 4 example as it writes it, and that the older versions keep their
//! own schemas. Configuration version 7 is held to the host in `config_v7.rs`.

use serde_json::{Value, json};

use super::{assert_refuses, edited, example, examples, validator};

/// `base` with the member at the JSON pointer `pointer` set to `value`, inserted when missing.
fn with(base: &Value, pointer: &str, value: Value) -> Value {
    edited(base, |v| {
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = if parent.is_empty() {
            v
        } else {
            v.pointer_mut(parent).unwrap()
        };
        target
            .as_object_mut()
            .unwrap()
            .insert(key.to_owned(), value);
    })
}

fn without(base: &Value, pointer: &str) -> Value {
    edited(base, |v| {
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let target = if parent.is_empty() {
            v
        } else {
            v.pointer_mut(parent).unwrap()
        };
        target.as_object_mut().unwrap().remove(key).unwrap();
    })
}

fn hash(digit: char) -> Value {
    json!(format!("sha256:{}", digit.to_string().repeat(64)))
}

// ── Person decision, version 2 (section 3) ─────────────────────────────────────────────────────

#[test]
fn a_version_2_decision_records_its_pages_and_what_was_pulled_out() {
    let validator = validator("person-decision.v2");
    let pending = example("person-decision.v2", "");
    let approved = example("person-decision.v2", "approved");
    let local = example("person-decision.v2", "local");
    for field in pending.as_object().unwrap().keys() {
        assert!(
            !validator.is_valid(&without(&pending, &format!("/{field}"))),
            "a missing {field}"
        );
    }
    // A pending decision may already hold the pages shown and the person's choices.
    assert!(validator.is_valid(&with(&pending, "/pages", local["pages"].clone())));
    assert!(validator.is_valid(&with(&pending, "/excluded", json!(["prp-frost"]))));
    let page = |n: u64, items: Value| json!({ "page": n, "hash": hash('7'), "items": items });
    let ids = |n: usize| -> Value { (0..n).map(|i| json!(format!("prp-{i}"))).collect() };
    assert!(validator.is_valid(&with(&local, "/pages", json!([page(1, ids(100))]))));
    assert!(validator.is_valid(&with(
        &local,
        "/pages",
        Value::Array((1..=200).map(|n| page(n, json!([]))).collect())
    )));
    assert!(validator.is_valid(&with(&local, "/excluded", ids(2000))));
    assert_refuses(
        &validator,
        "person-decision.v2",
        &[
            with(&pending, "/version", json!(1)),
            // Pages: at most 200, each numbered 1 to 200, hashed, with at most 100 items.
            with(
                &local,
                "/pages",
                Value::Array((1..=201).map(|n| page(n.min(200), json!([]))).collect()),
            ),
            with(&local, "/pages", json!([page(0, json!([]))])),
            with(&local, "/pages", json!([page(201, json!([]))])),
            with(&local, "/pages", json!([page(1, ids(101))])),
            with(&local, "/pages", json!([page(1, json!(["a", "a"]))])),
            with(
                &local,
                "/pages",
                json!([{ "page": 1, "hash": "md5:x", "items": [] }]),
            ),
            with(&local, "/pages", json!([{ "page": 1, "items": [] }])),
            with(
                &local,
                "/pages",
                json!([{ "page": 1, "hash": hash('7'), "items": [], "text": "x" }]),
            ),
            // An item id is 1 to 64 characters of letters, digits, '.', '_' and '-'.
            with(&local, "/excluded", json!(["has space"])),
            with(&local, "/excluded", json!([""])),
            with(&local, "/excluded", json!(["x".repeat(65)])),
            with(&local, "/excluded", json!(["prp-a", "prp-a"])),
            with(&local, "/excluded", ids(2001)),
            // A local decision has no login, and is for the local person.
            with(&local, "/acr", json!("phr")),
            with(&local, "/authTime", json!("2026-11-12T09:00:00Z")),
            with(&local, "/for/namespace", json!("corp")),
            with(&local, "/for/issuer", json!("corp-as")),
            with(&local, "/previewHash", Value::Null),
            // A verified decision still records its login.
            with(&approved, "/acr", Value::Null),
            with(&approved, "/authTime", Value::Null),
            with(&approved, "/level", json!("terminal")),
            with(&pending, "/level", json!("local")),
        ],
    );
    // Each version keeps its schema.
    let v1 = validator_v1();
    for (name, decision) in examples("person-decision.v2") {
        assert!(!v1.is_valid(&decision), "{name}");
    }
    for (name, decision) in examples("person-decision.v1") {
        assert!(!validator.is_valid(&decision), "{name}");
    }
}

fn validator_v1() -> jsonschema::Validator {
    super::validator("person-decision.v1")
}

// ── Provenance envelope, version 4 (section 6.4) ───────────────────────────────────────────────

#[test]
fn version_4_holds_a_local_assurance_and_nothing_else() {
    let validator = validator("provenance-envelope.v4");
    let base = example("provenance-envelope.v4", "");
    assert_eq!(
        base["confirmation"]["assurance"],
        json!({ "level": "local", "method": "local-page" })
    );
    assert_refuses(
        &validator,
        "provenance-envelope.v4",
        &[
            with(&base, "/version", json!(3)),
            with(&base, "/confirmation", Value::Null),
            without(&base, "/confirmation/assurance"),
            with(
                &base,
                "/confirmation/assurance",
                json!({ "level": "terminal", "method": "cli-terminal" }),
            ),
            with(
                &base,
                "/confirmation/assurance/method",
                json!("person-page"),
            ),
            with(&base, "/confirmation/assurance/acr", json!("phr")),
            with(&base, "/tenant", json!("x")),
        ],
    );
    // Each version keeps its schema: version 3 knows no local assurance, and version 4 none of
    // version 3's.
    let v3 = super::validator("provenance-envelope.v3");
    assert!(!v3.is_valid(&base));
    assert!(!v3.is_valid(&with(&base, "/version", json!(3))));
    for (name, envelope) in examples("provenance-envelope.v3") {
        assert!(!validator.is_valid(&envelope), "{name}");
        assert!(
            !validator.is_valid(&with(&envelope, "/version", json!(4))),
            "{name}"
        );
    }
}

#[test]
fn the_store_reads_the_version_4_example_and_checks_it_as_the_schema_does() {
    let base = example("provenance-envelope.v4", "");
    let mut store = base.clone();
    store.as_object_mut().unwrap().remove("tenant");
    let envelope = umbel_store::Envelope::from_value(store.clone()).unwrap();
    assert_eq!(envelope.version, 4);
    assert!(envelope.check("main").is_ok());
    assert_eq!(serde_json::to_value(&envelope).unwrap(), store);
    // As version 3 it is refused, as the version 3 schema refuses it.
    let mut v3 = envelope.clone();
    v3.version = 3;
    assert!(v3.check("main").is_err());
}
