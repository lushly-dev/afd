//! Each identifier pattern and longest length equals Specimen's generated JSON Schema files, and
//! each compiles with the `regex` crate's Unicode features off and matches at its boundaries.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

#[path = "../src/pack/patterns.rs"]
mod patterns;

use std::path::Path;

use patterns::*;
use serde_json::Value;

fn schema(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../foundations/specimen/schema/pack")
        .join(format!("{name}.schema.json"));
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn every_pattern_equals_specimens_json_schema() {
    let (component, library) = (schema("component"), schema("library"));
    let cases: [(Pattern, &Value, &str); 21] = [
        (LIBRARY, &library, "/properties/library"),
        (TAG, &component, "/properties/tag"),
        (PREFIX, &library, "/properties/prefix"),
        (
            ELEMENT,
            &component,
            "/properties/api/properties/slots/items/properties/accepts/items",
        ),
        (ID, &component, "/properties/usage/items/properties/id"),
        (VERSION, &library, "/properties/package/properties/version"),
        (DIGEST, &library, "/properties/digest"),
        (REVISION, &library, "/properties/revision"),
        (PACKAGE, &library, "/properties/package/properties/name"),
        (SPECIFIER, &component, "/properties/import"),
        (
            STORY,
            &component,
            "/properties/examples/items/properties/from",
        ),
        (
            ATTRIBUTE,
            &component,
            "/properties/api/properties/attributes/items/properties/name",
        ),
        (
            PROPERTY,
            &component,
            "/properties/api/properties/attributes/items/properties/property",
        ),
        (
            SLOT,
            &component,
            "/properties/api/properties/slots/items/properties/name",
        ),
        (
            EVENT,
            &component,
            "/properties/api/properties/events/items/properties/name",
        ),
        (
            COMMAND,
            &component,
            "/properties/api/properties/commands/items/properties/name",
        ),
        (
            CSS_PROPERTY,
            &component,
            "/properties/api/properties/cssProperties/items/properties/name",
        ),
        (
            STATE,
            &component,
            "/properties/a11y/properties/role/items/properties/state",
        ),
        (
            ROLE,
            &component,
            "/properties/a11y/properties/role/items/properties/role",
        ),
        (
            AXE_RULE,
            &component,
            "/properties/a11y/properties/axe/properties/exceptions/items",
        ),
        (
            GAP_NAME,
            &component,
            "/properties/gaps/items/properties/name",
        ),
    ];
    assert_eq!(cases.len(), ALL.len());
    for (pattern, file, pointer) in cases {
        let node = file
            .pointer(pointer)
            .unwrap_or_else(|| panic!("no {pointer}"));
        assert_eq!(node["pattern"], pattern.source, "{pointer}");
        assert_eq!(node["maxLength"], pattern.max, "{pointer}");
    }
}

#[test]
fn every_text_limit_character_class_is_the_format_s() {
    let component = schema("component");
    let single = component.pointer("/properties/summary/pattern").unwrap();
    assert_eq!(
        single,
        r"^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$"
    );
    let multi = component.pointer("/properties/detail/pattern").unwrap();
    assert_eq!(
        multi,
        r"^[^\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$"
    );
}

#[test]
fn samples_at_each_boundary() {
    assert!(LIBRARY.accepts(&format!("a{}", "b".repeat(63))));
    assert!(!LIBRARY.accepts(&format!("a{}", "b".repeat(64))));
    assert!(TAG.accepts("example-select"));
    assert!(TAG.accepts("x-"));
    assert!(!TAG.accepts("select"));
    assert!(!TAG.accepts("Example-select"));
    assert!(!TAG.accepts("exämple-select"));
    assert!(!TAG.accepts("example-select\n"));
    assert!(TAG.matches(&format!("a-{}", "b".repeat(200))));
    assert!(!TAG.accepts(&format!("a-{}", "b".repeat(200))));
    assert!(ID.accepts("field.labelling"));
    assert!(!ID.accepts("field"));
    assert!(SLOT.accepts(""));
    assert!(GAP_NAME.accepts("--color"));
    assert!(PACKAGE.accepts("@scope/name"));
    assert!(SPECIFIER.accepts("example-components/select.js"));
    assert!(!PACKAGE.accepts("@scope/name/deep"));
    assert!(VERSION.accepts("1.0.0-rc.1+build"));
    assert!(!VERSION.accepts("01.0.0"));
    assert!(DIGEST.accepts(&format!("sha256:{}", "a".repeat(64))));
    assert!(PROPERTY.accepts("$value_1"));
    assert!(CSS_PROPERTY.accepts("--size"));
    assert!(COMMAND.accepts("--toggle"));
    assert!(ROLE.accepts("button"));
}
