//! The JSON Schema validator the spec-conformance tests share: the draft 2020-12 keywords that
//! `spec/schema/*.json` use, with `$ref` resolved across those files. A schema that uses any other
//! keyword fails loudly instead of passing unchecked.
#![allow(dead_code)]

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/schema")
}

pub struct SchemaRegistry {
    by_id: HashMap<String, Value>,
    by_file: HashMap<String, String>,
}

impl SchemaRegistry {
    pub fn load() -> Self {
        let mut by_id = HashMap::new();
        let mut by_file = HashMap::new();
        for file in [
            "error.json",
            "result.json",
            "output-envelope.json",
            "batch.json",
            "pipeline.json",
            "stream.json",
        ] {
            let path = schema_dir().join(file);
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            let schema: Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("invalid JSON in {file}: {e}"));
            let id = schema["$id"]
                .as_str()
                .unwrap_or_else(|| panic!("{file} missing $id"))
                .to_string();
            by_file.insert(file.to_string(), id.clone());
            by_id.insert(id, schema);
        }
        Self { by_id, by_file }
    }

    fn resolve_ref<'a>(&'a self, current_id: &str, reference: &str) -> (&'a str, &'a Value) {
        let (target_id, fragment) = match reference.split_once('#') {
            Some(("", frag)) => (current_id.to_string(), frag),
            Some((rel, frag)) => (resolve_relative_id(current_id, rel), frag),
            None => (resolve_relative_id(current_id, reference), ""),
        };
        let (stored_id, root) = self
            .by_id
            .get_key_value(&target_id)
            .unwrap_or_else(|| panic!("unresolved schema $ref: {reference} -> {target_id}"));
        if fragment.is_empty() {
            return (stored_id.as_str(), root);
        }
        let target = root
            .pointer(fragment)
            .unwrap_or_else(|| panic!("unresolved pointer {fragment} in {stored_id}"));
        (stored_id.as_str(), target)
    }

    pub fn validate_file(&self, file: &str, value: &Value) -> Result<(), String> {
        let id = self.by_file.get(file).expect("known schema file");
        let root = &self.by_id[id];
        self.validate_node(id, root, value, "$")
    }

    /// Validate `value` against `schema`, a schema written as if inside `file`, so its `$ref`s
    /// resolve against that file (`{"$ref": "#/$defs/recovery"}`).
    pub fn validate_in(&self, file: &str, schema: &Value, value: &Value) -> Result<(), String> {
        let id = self.by_file.get(file).expect("known schema file");
        self.validate_node(id, schema, value, "$")
    }

    fn validate_node(
        &self,
        current_id: &str,
        schema: &Value,
        value: &Value,
        path: &str,
    ) -> Result<(), String> {
        if let Some(b) = schema.as_bool() {
            return if b {
                Ok(())
            } else {
                Err(format!("{path}: schema is false"))
            };
        }
        let obj = schema
            .as_object()
            .ok_or_else(|| format!("{path}: schema must be object or bool"))?;
        if let Some(keyword) = obj.keys().find(|k| !KEYWORDS.contains(&k.as_str())) {
            panic!("{path}: this validator does not support the schema keyword '{keyword}'");
        }

        if let Some(reference) = obj.get("$ref").and_then(Value::as_str) {
            let (next_id, target) = self.resolve_ref(current_id, reference);
            self.validate_node(next_id, target, value, path)?;
        }
        if let Some(expected) = obj.get("const") {
            if !json_equal(value, expected) {
                return Err(format!("{path}: expected const {expected}, got {value}"));
            }
        }
        if let Some(allowed) = obj.get("enum").and_then(Value::as_array) {
            if !allowed.iter().any(|item| json_equal(item, value)) {
                return Err(format!("{path}: {value} not in enum {allowed:?}"));
            }
        }
        if let Some(kind) = obj.get("type") {
            let types: Vec<&str> = match kind {
                Value::String(s) => vec![s.as_str()],
                Value::Array(arr) => arr.iter().filter_map(Value::as_str).collect(),
                _ => vec![],
            };
            if !types.iter().any(|t| matches_type(value, t)) {
                return Err(format!("{path}: expected type {types:?}, got {value}"));
            }
        }
        if let Some(s) = value.as_str() {
            if let Some(min) = obj.get("minLength").and_then(Value::as_u64) {
                if (s.chars().count() as u64) < min {
                    return Err(format!("{path}: string shorter than {min}"));
                }
            }
        }
        if let Some(n) = value.as_f64() {
            if let Some(min) = obj.get("minimum").and_then(Value::as_f64) {
                if n < min {
                    return Err(format!("{path}: {n} < minimum {min}"));
                }
            }
            if let Some(max) = obj.get("maximum").and_then(Value::as_f64) {
                if n > max {
                    return Err(format!("{path}: {n} > maximum {max}"));
                }
            }
        }
        if let Some(arr) = value.as_array() {
            if let Some(min) = obj.get("minItems").and_then(Value::as_u64) {
                if (arr.len() as u64) < min {
                    return Err(format!("{path}: fewer than {min} items"));
                }
            }
            if obj.get("uniqueItems") == Some(&Value::Bool(true)) {
                for (i, item) in arr.iter().enumerate() {
                    if arr[..i].iter().any(|earlier| json_equal(earlier, item)) {
                        return Err(format!("{path}[{i}]: repeats an earlier item"));
                    }
                }
            }
            if let Some(item_schema) = obj.get("items") {
                for (i, item) in arr.iter().enumerate() {
                    self.validate_node(current_id, item_schema, item, &format!("{path}[{i}]"))?;
                }
            }
        }
        if let Some(map) = value.as_object() {
            if let Some(min) = obj.get("minProperties").and_then(Value::as_u64) {
                if (map.len() as u64) < min {
                    return Err(format!("{path}: fewer than {min} properties"));
                }
            }
            if let Some(req) = obj.get("required").and_then(Value::as_array) {
                for key in req.iter().filter_map(Value::as_str) {
                    if !map.contains_key(key) {
                        return Err(format!("{path}: missing required property '{key}'"));
                    }
                }
            }
            let props = obj.get("properties").and_then(Value::as_object);
            for (k, v) in map {
                if let Some(prop_schema) = props.and_then(|p| p.get(k)) {
                    self.validate_node(current_id, prop_schema, v, &format!("{path}.{k}"))?;
                } else if let Some(addl) = obj.get("additionalProperties") {
                    if addl == &Value::Bool(false) {
                        return Err(format!("{path}: unexpected property '{k}'"));
                    } else if addl.is_object() {
                        self.validate_node(current_id, addl, v, &format!("{path}.{k}"))?;
                    }
                }
            }
        }
        if let Some(branches) = obj.get("allOf").and_then(Value::as_array) {
            for branch in branches {
                self.validate_node(current_id, branch, value, path)?;
            }
        }
        if let Some(branches) = obj.get("anyOf").and_then(Value::as_array) {
            if !branches
                .iter()
                .any(|b| self.validate_node(current_id, b, value, path).is_ok())
            {
                return Err(format!("{path}: matched no anyOf branch"));
            }
        }
        if let Some(branches) = obj.get("oneOf").and_then(Value::as_array) {
            let matches = branches
                .iter()
                .filter(|b| self.validate_node(current_id, b, value, path).is_ok())
                .count();
            if matches != 1 {
                return Err(format!("{path}: expected 1 oneOf match, got {matches}"));
            }
        }
        if let Some(cond) = obj.get("if") {
            let matched = self.validate_node(current_id, cond, value, path).is_ok();
            if matched {
                if let Some(then_branch) = obj.get("then") {
                    self.validate_node(current_id, then_branch, value, path)?;
                }
            } else if let Some(else_branch) = obj.get("else") {
                self.validate_node(current_id, else_branch, value, path)?;
            }
        }
        if let Some(neg) = obj.get("not") {
            if self.validate_node(current_id, neg, value, path).is_ok() {
                return Err(format!("{path}: matched forbidden 'not' schema"));
            }
        }
        Ok(())
    }
}

/// The keywords this validator implements, or that carry no assertion (annotations and `$defs`,
/// which is only reached through `$ref`).
const KEYWORDS: &[&str] = &[
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "title",
    "description",
    "type",
    "const",
    "enum",
    "minLength",
    "minimum",
    "maximum",
    "items",
    "minItems",
    "uniqueItems",
    "required",
    "minProperties",
    "properties",
    "additionalProperties",
    "allOf",
    "anyOf",
    "oneOf",
    "if",
    "then",
    "else",
    "not",
];

/// Equality as JSON Schema defines it for `const`, `enum` and `uniqueItems`: numbers compare by
/// value, so `1` equals `1.0`.
fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => x == y,
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| json_equal(a, b))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, a)| y.get(k).is_some_and(|b| json_equal(a, b)))
        }
        _ => a == b,
    }
}

fn resolve_relative_id(base_id: &str, rel: &str) -> String {
    if rel.contains("://") {
        return rel.to_string();
    }
    let prefix = base_id.rsplit_once('/').map(|(p, _)| p).unwrap_or(base_id);
    format!("{prefix}/{rel}")
}

fn matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "string" => value.is_string(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "number" => value.is_number(),
        "integer" => {
            value.as_i64().is_some()
                || value.as_u64().is_some()
                || value.as_f64().is_some_and(|n| n.fract() == 0.0)
        }
        _ => false,
    }
}
