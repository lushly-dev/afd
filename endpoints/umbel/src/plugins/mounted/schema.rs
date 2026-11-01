//! A mounted tool's schemas (specification section 6.3): advertised as the server gave them,
//! validated with a copy that keeps only the keywords the `afd` crate's checker accepts.

use serde_json::{Map, Value};

/// Keywords `afd`'s checker accepts that constrain a value. Anything else is refused by
/// `register_with_schema`, so the validation copy drops it; the server validates the full schema
/// itself.
const KEYWORDS: &[&str] = &[
    "type",
    "properties",
    "required",
    "enum",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "additionalProperties",
    "$ref",
    "definitions",
    "$defs",
    "const",
];
/// Keywords the checker accepts that constrain nothing.
const ANNOTATIONS: &[&str] = &[
    "title",
    "description",
    "examples",
    "deprecated",
    "readOnly",
    "writeOnly",
    "$comment",
    "$schema",
    "$id",
    "default",
];

/// A copy of `schema` without any keyword the checker refuses. Returns the copy and whether
/// anything was removed.
pub(crate) fn strip_unsupported(schema: &Value) -> (Value, bool) {
    let mut removed = false;
    let stripped = strip(schema, &mut removed);
    (stripped, removed)
}

fn strip(schema: &Value, removed: &mut bool) -> Value {
    let Value::Object(object) = schema else {
        return schema.clone();
    };
    let mut kept = Map::new();
    for (key, value) in object {
        if !KEYWORDS.contains(&key.as_str()) && !ANNOTATIONS.contains(&key.as_str()) {
            *removed = true;
            continue;
        }
        let value = match key.as_str() {
            "properties" | "definitions" | "$defs" => match value {
                Value::Object(children) => Value::Object(
                    children
                        .iter()
                        .map(|(name, child)| (name.clone(), strip(child, removed)))
                        .collect(),
                ),
                other => other.clone(),
            },
            "items" => strip(value, removed),
            "additionalProperties" if value.is_object() => strip(value, removed),
            _ => value.clone(),
        };
        kept.insert(key.clone(), value);
    }
    Value::Object(kept)
}

/// Whether the schema has a `space` property.
pub(crate) fn has_space(schema: &Value) -> bool {
    schema
        .get("properties")
        .is_some_and(|properties| properties.get("space").is_some())
}
