use super::*;

/// The same `#/$defs/X` names one definition at the root and another inside a subschema
/// with its own `$id`, which starts a schema resource (spec/validation.md, "Annotations";
/// #1700).
fn two_resources() -> Value {
    json!({
        "type": "object",
        "properties": {
            "outer": {"$ref": "#/$defs/X"},
            "inner": {
                "$id": "urn:afd:inner",
                "type": "object",
                "properties": {"x": {"$ref": "#/$defs/X"}},
                "$defs": {"X": {"type": "string"}}
            }
        },
        "$defs": {"X": {"type": "number"}}
    })
}

fn paths(errors: Vec<Value>) -> Vec<Value> {
    errors
        .into_iter()
        .map(|error| error["path"].clone())
        .collect()
}

#[test]
fn a_ref_resolves_against_the_nearest_schema_resource() {
    let compiled = CompiledSchema::compile(&two_resources()).unwrap();
    let valid = json!({"outer": 1, "inner": {"x": "a"}});
    assert_eq!(compiled.validate_value(&valid).unwrap(), valid);
    let inner = compiled.validate_value(&json!({"outer": 1, "inner": {"x": 1}}));
    assert_eq!(paths(inner.unwrap_err()), vec![json!("inner.x")]);
    let outer = compiled.validate_value(&json!({"outer": "a"}));
    assert_eq!(paths(outer.unwrap_err()), vec![json!("outer")]);
}

#[test]
fn a_fragment_id_starts_no_resource() {
    let schema = json!({
        "type": "object",
        "properties": {"inner": {"$id": "#inner", "$ref": "#/$defs/X"}},
        "$defs": {"X": {"type": "string"}}
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    let wrong = compiled.validate_value(&json!({"inner": 1}));
    assert_eq!(paths(wrong.unwrap_err()), vec![json!("inner")]);
}

#[test]
fn a_ref_inside_a_resource_does_not_reach_the_root_definitions() {
    let schema = json!({
        "type": "object",
        "properties": {"inner": {"$id": "urn:afd:inner", "$ref": "#/$defs/X"}},
        "$defs": {"X": {"type": "string"}}
    });
    assert!(CompiledSchema::compile(&schema)
        .unwrap_err()
        .contains("Unresolved local $ref"));
}

#[test]
fn ref_cache_distinguishes_escaped_names_and_nested_defs_without_id() {
    // `A/B` is addressed via JSON Pointer `#/$defs/A~1B`, distinct from a literal key `A~1B`.
    let escaped = json!({
        "type": "object",
        "properties": {
            "x": {"$ref": "#/$defs/A~1B"}
        },
        "$defs": {
            "A/B": {"type": "string"},
            "A~1B": {"type": "number"}
        }
    });
    let compiled = CompiledSchema::compile(&escaped).unwrap();
    assert!(compiled.validate_value(&json!({"x": "ok"})).is_ok());
    assert!(compiled.validate_value(&json!({"x": 42})).is_err());

    // A nested `$defs` without its own `$id` must still be inspected even when it reuses a name.
    let nested_bad = json!({
        "type": "object",
        "properties": {
            "inner": {
                "type": "object",
                "$defs": {
                    "X": {"uniqueItems": true}
                }
            }
        },
        "$defs": {
            "X": {"type": "string"}
        }
    });
    assert!(CompiledSchema::compile(&nested_bad)
        .unwrap_err()
        .contains("uniqueItems"));
}

#[test]
fn ref_siblings_are_validated_at_compile_time() {
    let bad_type = json!({
        "type": "object",
        "properties": {
            "x": {"$ref": "#/$defs/X", "type": "bogus"}
        },
        "$defs": {"X": {"type": "string"}}
    });
    assert!(CompiledSchema::compile(&bad_type)
        .unwrap_err()
        .contains("Invalid type"));

    let bad_pattern = json!({
        "type": "object",
        "properties": {
            "x": {"$ref": "#/$defs/X", "pattern": "(?=lookahead)"}
        },
        "$defs": {"X": {"type": "string"}}
    });
    assert!(CompiledSchema::compile(&bad_pattern)
        .unwrap_err()
        .contains("pattern"));
}

#[test]
fn root_ref_populates_expected_and_missing_fields() {
    let schema = json!({
        "$ref": "#/$defs/Input",
        "$defs": {
            "Input": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "count": {"type": "integer", "default": 1}
                },
                "required": ["title"]
            }
        }
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    let err = compiled
        .execute_with_limit(json!({"typo": true}), 100)
        .unwrap_err();
    let details = err.details.unwrap();
    assert_eq!(details["expectedFields"], json!(["count", "title"]));
    assert_eq!(details["missingFields"], json!(["title"]));
    assert_eq!(details["unexpectedFields"], json!(["typo"]));
}

#[test]
fn boolean_schemas_are_schemas() {
    let schema = json!({
        "type": "object",
        "properties": {
            "t": true,
            "f": false,
            "r": {"$ref": "#/$defs/A"},
            "a": {"type": "array", "items": false}
        },
        "required": ["t"],
        "$defs": {"A": true}
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    assert_eq!(
        compiled
            .validate_value(&json!({"t": 1, "r": {"x": 1}, "a": []}))
            .unwrap(),
        json!({"t": 1, "r": {"x": 1}, "a": []})
    );
    let missing = compiled.validate_value(&json!({})).unwrap_err();
    assert_eq!(missing[0]["path"], "t");
    assert_eq!(
        missing[0]["message"],
        "Invalid input: expected nonoptional, received undefined"
    );
    let never = compiled
        .validate_value(&json!({"t": 1, "f": 1, "a": [2]}))
        .unwrap_err();
    assert_eq!(paths(never.clone()), vec![json!("a.0"), json!("f")]);
    for issue in never {
        assert_eq!(
            issue["message"],
            "Invalid input: expected never, received number"
        );
    }
}

#[test]
fn pattern_uses_ecmascript_shorthand_semantics_and_format_is_annotation() {
    let schema = json!({
        "type": "object",
        "properties": {
            "digits": {"type": "string", "pattern": "^\\d+$"},
            "single": {"type": "string", "pattern": "^.$"},
            "email": {"type": "string", "format": "email"}
        },
        "required": ["digits"]
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    assert!(compiled
        .validate_value(&json!({"digits": "123", "single": "é", "email": "anything"}))
        .is_ok());
    // Arabic-Indic digits must NOT match ECMAScript `\d`.
    let non_ascii_digits = compiled
        .validate_value(&json!({"digits": "\u{0661}\u{0662}\u{0663}"}))
        .unwrap_err();
    assert_eq!(non_ascii_digits[0]["path"], "digits");
    assert_eq!(
        non_ascii_digits[0]["message"],
        "Invalid string: must match pattern /^\\d+$/"
    );
}

#[test]
fn invalid_pattern_fails_compile() {
    let schema = json!({
        "type": "object",
        "properties": {"slug": {"type": "string", "pattern": "(?=x)x"}}
    });
    let err = CompiledSchema::compile(&schema).unwrap_err();
    assert!(err.contains("pattern"));
    assert!(err.contains("#/properties/slug/pattern"));
}

#[test]
fn enum_and_const_preserve_large_integer_precision() {
    let schema = json!({
        "type": "object",
        "properties": {
            "big": {"enum": [9007199254740992_u64]},
            "one": {"const": 1}
        }
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    assert!(compiled
        .validate_value(&json!({"big": 9007199254740992_u64, "one": 1.0}))
        .is_ok());
    assert!(compiled
        .validate_value(&json!({"big": 9007199254740993_u64}))
        .is_err());
}

#[test]
fn recursive_ref_compiles_and_validates() {
    let schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "child": {"$ref": "#"}
        },
        "required": ["name"]
    });
    let compiled = CompiledSchema::compile(&schema).unwrap();
    let valid = json!({"name": "root", "child": {"name": "leaf"}});
    assert_eq!(compiled.validate_value(&valid).unwrap(), valid);
    let invalid = compiled
        .validate_value(&json!({"name": "root", "child": {"name": 42}}))
        .unwrap_err();
    assert_eq!(paths(invalid), vec![json!("child.name")]);

    // Recursive schema with `$id` must also terminate and reuse the cached root node.
    let with_id = json!({
        "$id": "urn:afd:node",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "child": {"$ref": "#"}
        },
        "required": ["name"]
    });
    let compiled_id = CompiledSchema::compile(&with_id).unwrap();
    assert_eq!(compiled_id.validate_value(&valid).unwrap(), valid);
    let invalid_id = compiled_id
        .validate_value(&json!({"name": "root", "child": {"name": 42}}))
        .unwrap_err();
    assert_eq!(paths(invalid_id), vec![json!("child.name")]);
}

#[test]
fn parameters_to_schema_preserves_legacy_constraints_and_defaults() {
    let params = vec![
        CommandParameter::required_string("title", "Title"),
        CommandParameter {
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Array),
                items: Some(Box::new(JsonSchema {
                    schema_type: Some(JsonSchemaType::String),
                    min_length: Some(2),
                    ..Default::default()
                })),
                min_length: Some(1),
                max_length: Some(3),
                ..Default::default()
            }),
            param_type: JsonSchemaType::Array,
            ..CommandParameter::optional_string("tags", "Tags")
        },
        CommandParameter {
            schema: Some(JsonSchema {
                min_length: Some(2),
                ..Default::default()
            }),
            ..CommandParameter::optional_string("untyped", "Untyped")
        },
        CommandParameter {
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Number),
                minimum: Some(1.0),
                maximum: Some(10.0),
                ..Default::default()
            }),
            param_type: JsonSchemaType::Number,
            ..CommandParameter::optional_string("priority", "Priority").with_default(json!(5))
        },
        CommandParameter {
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::String),
                pattern: Some("^[a-z]+$".into()),
                format: Some("hostname".into()),
                ..Default::default()
            }),
            ..CommandParameter::optional_string("slug", "Slug")
        },
    ];

    let schema = parameters_to_schema(&params).unwrap();
    let compiled = CompiledSchema::compile(&schema).unwrap();

    // Valid input: default filled, undeclared key stripped, array & untyped bounds checked.
    let valid = compiled
        .execute_with_limit(
            json!({"title": "Ship", "tags": ["ok"], "untyped": [1, 2], "slug": "abc", "extra": 1}),
            100,
        )
        .unwrap();
    assert_eq!(
        valid,
        json!({"title": "Ship", "tags": ["ok"], "untyped": [1, 2], "priority": 5, "slug": "abc"})
    );

    // Invalid: array minItems, untyped array minItems, number maximum, pattern mismatch.
    let err = compiled
        .execute_with_limit(
            json!({"title": "Ship", "tags": [], "untyped": [1], "priority": 11, "slug": "BAD"}),
            100,
        )
        .unwrap_err();
    let errors = err.details.unwrap()["errors"].as_array().unwrap().clone();
    let codes: Vec<&str> = errors.iter().map(|e| e["code"].as_str().unwrap()).collect();
    assert!(codes.contains(&"too_small"));
    assert!(codes.contains(&"too_big"));
    assert!(codes.contains(&"invalid_format"));

    // Non-object input rejected; null treated as empty object.
    let non_obj = compiled.execute_with_limit(json!([1, 2]), 100).unwrap_err();
    assert_eq!(non_obj.code, error_codes::VALIDATION_ERROR);
    let null_err = compiled.execute_with_limit(Value::Null, 100).unwrap_err();
    assert_eq!(null_err.details.unwrap()["missingFields"], json!(["title"]));

    // Non-finite numeric bounds fail conversion.
    let nan_param = CommandParameter {
        schema: Some(JsonSchema {
            schema_type: Some(JsonSchemaType::Number),
            minimum: Some(f64::NAN),
            ..Default::default()
        }),
        ..CommandParameter::optional_string("bad", "Bad")
    };
    assert!(parameters_to_schema(&[nan_param]).is_err());
}
