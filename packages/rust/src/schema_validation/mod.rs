//! Compiled JSON Schema validation for command inputs and declared context fields.
//!
//! Schemas are compiled once at registration into an arena-backed [`CompiledSchema`] held in an
//! `Arc`, with regular expressions pre-compiled per node and local `$ref` targets resolved against
//! their enclosing schema resource. Legacy [`CommandParameter`] lists are converted to whole JSON
//! Schemas at registration so every command goes through one validator and produces one set of
//! Zod-style `VALIDATION_ERROR` diagnostics (`spec/validation.md`).

use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use crate::commands::{CommandParameter, JsonSchema, JsonSchemaType};
use crate::{error_codes, CommandError};

#[cfg(test)]
mod tests;

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
    "format",
];

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
    "pattern",
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

/// Index of a node inside [`CompiledSchema::nodes`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct NodeId(usize);

/// Bitmask of allowed JSON Schema primitive types.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct TypeMask(u8);

impl TypeMask {
    const NULL: u8 = 1 << 0;
    const BOOLEAN: u8 = 1 << 1;
    const NUMBER: u8 = 1 << 2;
    const INTEGER: u8 = 1 << 3;
    const STRING: u8 = 1 << 4;
    const ARRAY: u8 = 1 << 5;
    const OBJECT: u8 = 1 << 6;

    const fn is_empty(self) -> bool {
        self.0 == 0
    }

    fn insert(&mut self, name: &str) -> bool {
        let bit = match name {
            "null" => Self::NULL,
            "boolean" => Self::BOOLEAN,
            "number" => Self::NUMBER,
            "integer" => Self::INTEGER,
            "string" => Self::STRING,
            "array" => Self::ARRAY,
            "object" => Self::OBJECT,
            _ => return false,
        };
        self.0 |= bit;
        true
    }

    fn matches(self, value: &Value) -> bool {
        if self.is_empty() {
            return true;
        }
        match value {
            Value::Null => self.0 & Self::NULL != 0,
            Value::Bool(_) => self.0 & Self::BOOLEAN != 0,
            Value::Number(number) => {
                (self.0 & Self::NUMBER != 0)
                    || (self.0 & Self::INTEGER != 0
                        && number.as_f64().is_some_and(|n| n.fract() == 0.0))
            }
            Value::String(_) => self.0 & Self::STRING != 0,
            Value::Array(_) => self.0 & Self::ARRAY != 0,
            Value::Object(_) => self.0 & Self::OBJECT != 0,
        }
    }
}

#[derive(Debug)]
enum AdditionalProperties {
    /// Not specified: strip unknown keys when `properties` is present, keep them otherwise.
    Default,
    /// `additionalProperties: true`
    Allow,
    /// `additionalProperties: false`
    Deny,
    /// `additionalProperties: <schema>`
    Schema(NodeId),
}

#[derive(Debug)]
struct CompiledProperty {
    name: String,
    node: NodeId,
    required: bool,
    has_default: bool,
}

#[derive(Debug)]
struct CompiledBound {
    value: f64,
    display: String,
}

#[derive(Debug)]
struct SchemaNode {
    default: Option<Value>,
    type_mask: TypeMask,
    type_names: Vec<&'static str>,
    const_value: Option<Value>,
    enum_values: Option<Vec<Value>>,
    properties: Option<Vec<CompiledProperty>>,
    extra_required: Vec<String>,
    additional_properties: AdditionalProperties,
    items: Option<NodeId>,
    min_items: Option<CompiledBound>,
    max_items: Option<CompiledBound>,
    min_length: Option<CompiledBound>,
    max_length: Option<CompiledBound>,
    pattern: Option<(String, Regex)>,
    minimum: Option<CompiledBound>,
    maximum: Option<CompiledBound>,
    exclusive_minimum: Option<CompiledBound>,
    exclusive_maximum: Option<CompiledBound>,
}

#[derive(Debug)]
enum CompiledNode {
    /// Boolean `true` or an unconstrained `{}` schema.
    Any,
    /// Boolean `false` (rejects every value).
    Never,
    /// Local `$ref` with optional local `default` override.
    Ref {
        target: NodeId,
        default: Option<Value>,
    },
    /// Compiled object schema node.
    Schema(Box<SchemaNode>),
}

/// A compiled JSON Schema validator, built once at registration and shared across calls in an `Arc`.
#[derive(Debug)]
pub(crate) struct CompiledSchema {
    nodes: Vec<CompiledNode>,
    root: NodeId,
    /// Top-level declared property names, precomputed for `expectedFields` on error.
    root_expected_fields: Vec<String>,
    /// Top-level required property names that have no default, precomputed for `missingFields`.
    root_required_without_default: Vec<String>,
}

/// Whether `schema` starts a schema resource: a string `$id` that is not a bare fragment
/// (`spec/validation.md`), so its local references resolve against it.
pub(crate) fn starts_resource(schema: &Value) -> bool {
    schema["$id"]
        .as_str()
        .is_some_and(|id| !id.starts_with('#'))
}

fn target<'a>(root: &'a Value, reference: &str) -> Option<&'a Value> {
    if reference == "#" {
        return Some(root);
    }
    // The shared subset permits only a named definition, never a pointer
    // through annotation/default data that registration did not inspect.
    let name = reference
        .strip_prefix("#/definitions/")
        .or_else(|| reference.strip_prefix("#/$defs/"))?;
    if name.is_empty() || name.contains('/') {
        return None;
    }
    root.pointer(&reference[1..])
        .filter(|schema| schema.is_object() || schema.is_boolean())
}

/// Rewrite ECMAScript shorthand character classes (`\d`, `\D`, `\w`, `\W`, `\s`, `\S`) to their
/// ASCII/ECMAScript definitions so Rust `regex` (which defaults to Unicode classes) matches
/// ECMAScript semantics while preserving UTF-8 `.` and literal matching.
fn ecmascript_to_rust_pattern(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len());
    let mut chars = pattern.chars().peekable();
    let mut in_class = false;
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(&next) = chars.peek() {
                let replacement = match (in_class, next) {
                    (false, 'd') => Some("[0-9]"),
                    (false, 'D') => Some("[^0-9]"),
                    (false, 'w') => Some("[A-Za-z0-9_]"),
                    (false, 'W') => Some("[^A-Za-z0-9_]"),
                    (false, 's') => Some("[ \\t\\r\\n\\f\\v\\u{00a0}\\u{feff}]"),
                    (false, 'S') => Some("[^ \\t\\r\\n\\f\\v\\u{00a0}\\u{feff}]"),
                    (true, 'd') => Some("0-9"),
                    (true, 'D') => Some("[^0-9]"),
                    (true, 'w') => Some("A-Za-z0-9_"),
                    (true, 'W') => Some("[^A-Za-z0-9_]"),
                    (true, 's') => Some(" \\t\\r\\n\\f\\v\\u{00a0}\\u{feff}"),
                    (true, 'S') => Some("[^ \\t\\r\\n\\f\\v\\u{00a0}\\u{feff}]"),
                    _ => None,
                };
                if let Some(repl) = replacement {
                    chars.next();
                    out.push_str(repl);
                    continue;
                }
                out.push('\\');
                out.push(chars.next().unwrap());
            } else {
                out.push('\\');
            }
            continue;
        }
        if ch == '[' && !in_class {
            in_class = true;
            out.push(ch);
            // A leading `]` or `^]` in a character class is a literal, not the closing bracket.
            if chars.peek() == Some(&'^') {
                out.push(chars.next().unwrap());
            }
            if chars.peek() == Some(&']') {
                out.push(chars.next().unwrap());
            }
            continue;
        }
        if ch == ']' && in_class {
            in_class = false;
        }
        out.push(ch);
    }
    out
}

struct Compiler {
    nodes: Vec<CompiledNode>,
    /// Maps `(root_ptr, schema_ptr)` to its allocated `NodeId` so cycles (including recursive
    /// schemas with `$id`) terminate and distinct nodes (including escaped names like `A/B` vs
    /// `A~1B` or nested `$defs` without `$id`) never collide.
    node_cache: HashMap<(usize, usize), NodeId>,
}

impl Compiler {
    fn new() -> Self {
        Self {
            nodes: Vec::new(),
            node_cache: HashMap::new(),
        }
    }

    fn alloc(&mut self, node: CompiledNode) -> NodeId {
        let id = NodeId(self.nodes.len());
        self.nodes.push(node);
        id
    }

    fn compile_node(&mut self, schema: &Value, root: &Value, path: &str) -> Result<NodeId, String> {
        let root = if schema.is_object() && starts_resource(schema) {
            schema
        } else {
            root
        };

        let key = (
            root as *const Value as usize,
            schema as *const Value as usize,
        );
        if let Some(&cached) = self.node_cache.get(&key) {
            return Ok(cached);
        }

        if let Some(boolean) = schema.as_bool() {
            let compiled = if boolean {
                CompiledNode::Any
            } else {
                CompiledNode::Never
            };
            let slot = self.alloc(compiled);
            self.node_cache.insert(key, slot);
            return Ok(slot);
        }

        let object = schema
            .as_object()
            .ok_or_else(|| format!("Schema at {path} must be an object or a boolean"))?;

        // Reserve the slot before recursing so cycles referencing this node resolve to `slot`.
        let slot = self.alloc(CompiledNode::Any);
        self.node_cache.insert(key, slot);

        // Validate every keyword and inspect `$defs`/`definitions` so invalid unused definitions
        // still fail at registration, matching the spec.
        for (k, value) in object {
            let location = format!("{path}/{k}");
            if !KEYWORDS.contains(&k.as_str()) && !ANNOTATIONS.contains(&k.as_str()) {
                return Err(format!("Unsupported keyword '{k}' at {location}"));
            }
            match k.as_str() {
                "definitions" | "$defs" => {
                    let defs = value
                        .as_object()
                        .ok_or_else(|| format!("Expected object at {location}"))?;
                    for (name, child) in defs {
                        self.compile_node(child, root, &format!("{location}/{name}"))?;
                    }
                }
                "properties" => {
                    if !value.is_object() {
                        return Err(format!("Expected object at {location}"));
                    }
                }
                "required"
                    if !value
                        .as_array()
                        .is_some_and(|items| items.iter().all(Value::is_string)) =>
                {
                    return Err(format!("Invalid required at {location}"));
                }
                "enum" if !value.as_array().is_some_and(|items| !items.is_empty()) => {
                    return Err(format!("Invalid enum at {location}"));
                }
                "minLength" | "maxLength" | "minItems" | "maxItems"
                    if !value
                        .as_f64()
                        .is_some_and(|number| number >= 0.0 && number.fract() == 0.0) =>
                {
                    return Err(format!("Invalid size bound at {location}"));
                }
                "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum"
                    if !value.is_number() =>
                {
                    return Err(format!("Invalid numeric bound at {location}"));
                }
                "pattern" if !value.is_string() => {
                    return Err(format!("Invalid pattern at {location}"));
                }
                _ => {}
            }
        }

        // Compile and validate all sibling keywords (type, pattern, properties, items,
        // additionalProperties) even when `$ref` is present so invalid siblings never slip past
        // registration.
        let mut type_mask = TypeMask::default();
        let mut type_names = Vec::new();
        if let Some(type_val) = object.get("type") {
            let location = format!("{path}/type");
            let raw_types: Vec<&Value> = type_val
                .as_array()
                .map(|arr| arr.iter().collect())
                .unwrap_or_else(|| vec![type_val]);
            if raw_types.is_empty() {
                return Err(format!("Invalid type at {location}"));
            }
            for kind in raw_types {
                let Some(name) = kind.as_str() else {
                    return Err(format!("Invalid type at {location}"));
                };
                let static_name: &'static str = match name {
                    "string" => "string",
                    "number" => "number",
                    "integer" => "integer",
                    "boolean" => "boolean",
                    "object" => "object",
                    "array" => "array",
                    "null" => "null",
                    _ => return Err(format!("Invalid type at {location}")),
                };
                type_mask.insert(static_name);
                type_names.push(static_name);
            }
        }

        let pattern = if let Some(pat_val) = object.get("pattern") {
            let pat_str = pat_val
                .as_str()
                .ok_or_else(|| format!("Invalid pattern at {path}/pattern"))?;
            let translated = ecmascript_to_rust_pattern(pat_str);
            let regex = Regex::new(&translated)
                .map_err(|_| format!("Unsupported pattern at {path}/pattern"))?;
            Some((pat_str.to_string(), regex))
        } else {
            None
        };

        let required_list: Vec<&str> = object
            .get("required")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();

        let mut properties = None;
        let mut property_names: HashSet<&str> = HashSet::new();
        if let Some(props_obj) = object.get("properties").and_then(Value::as_object) {
            let mut compiled_props = Vec::with_capacity(props_obj.len());
            for (name, child) in props_obj {
                let child_id =
                    self.compile_node(child, root, &format!("{path}/properties/{name}"))?;
                let is_required = required_list.iter().any(|req| *req == name);
                property_names.insert(name.as_str());
                compiled_props.push(CompiledProperty {
                    name: name.clone(),
                    node: child_id,
                    required: is_required,
                    has_default: false, // backfilled after compilation
                });
            }
            properties = Some(compiled_props);
        }

        let extra_required: Vec<String> = required_list
            .iter()
            .filter(|req| !property_names.contains(**req))
            .map(|req| (*req).to_string())
            .collect();

        let additional_properties = match object.get("additionalProperties") {
            None => AdditionalProperties::Default,
            Some(Value::Bool(true)) => AdditionalProperties::Allow,
            Some(Value::Bool(false)) => AdditionalProperties::Deny,
            Some(other) => {
                let ap_id =
                    self.compile_node(other, root, &format!("{path}/additionalProperties"))?;
                AdditionalProperties::Schema(ap_id)
            }
        };

        let items = if let Some(items_val) = object.get("items") {
            Some(self.compile_node(items_val, root, &format!("{path}/items"))?)
        } else {
            None
        };

        // If this node is a `$ref`, execution delegates to the resolved target while keeping any
        // local `default` override.
        if let Some(ref_val) = object.get("$ref") {
            let location = format!("{path}/$ref");
            let reference = ref_val
                .as_str()
                .ok_or_else(|| format!("Invalid $ref at {location}"))?;
            let target_schema = target(root, reference)
                .ok_or_else(|| format!("Unresolved local $ref at {location}: {reference}"))?;
            let target_id = self.compile_node(target_schema, root, reference)?;
            let default = object.get("default").cloned();
            self.nodes[slot.0] = CompiledNode::Ref {
                target: target_id,
                default,
            };
            return Ok(slot);
        }

        let parse_bound = |key: &str| -> Option<CompiledBound> {
            object.get(key).and_then(|v| {
                v.as_f64().map(|value| CompiledBound {
                    value,
                    display: v.to_string(),
                })
            })
        };

        let node = SchemaNode {
            default: object.get("default").cloned(),
            type_mask,
            type_names,
            const_value: object.get("const").cloned(),
            enum_values: object.get("enum").and_then(Value::as_array).cloned(),
            properties,
            extra_required,
            additional_properties,
            items,
            min_items: parse_bound("minItems"),
            max_items: parse_bound("maxItems"),
            min_length: parse_bound("minLength"),
            max_length: parse_bound("maxLength"),
            pattern,
            minimum: parse_bound("minimum"),
            maximum: parse_bound("maximum"),
            exclusive_minimum: parse_bound("exclusiveMinimum"),
            exclusive_maximum: parse_bound("exclusiveMaximum"),
        };

        self.nodes[slot.0] = CompiledNode::Schema(Box::new(node));
        Ok(slot)
    }
}

impl CompiledSchema {
    /// Compile a whole JSON Schema into a reusable validator.
    pub(crate) fn compile(schema: &Value) -> Result<Self, String> {
        let mut compiler = Compiler::new();
        let root = compiler.compile_node(schema, schema, "#")?;
        let mut compiled = Self {
            nodes: compiler.nodes,
            root,
            root_expected_fields: Vec::new(),
            root_required_without_default: Vec::new(),
        };
        compiled.backfill_defaults();
        compiled.compute_root_metadata();
        Ok(compiled)
    }

    /// Resolve whether each compiled property has a default (including through `$ref`).
    fn backfill_defaults(&mut self) {
        let has_default_flags: Vec<bool> = (0..self.nodes.len())
            .map(|idx| self.default_value(NodeId(idx), 0).is_some())
            .collect();
        for node in &mut self.nodes {
            if let CompiledNode::Schema(schema) = node {
                if let Some(props) = &mut schema.properties {
                    for prop in props {
                        prop.has_default = has_default_flags[prop.node.0];
                    }
                }
            }
        }
    }

    fn resolve_ref(&self, mut node: NodeId) -> Option<NodeId> {
        for _ in 0..=128 {
            match &self.nodes[node.0] {
                CompiledNode::Ref { target, .. } => node = *target,
                _ => return Some(node),
            }
        }
        None
    }

    fn compute_root_metadata(&mut self) {
        let Some(effective_root) = self.resolve_ref(self.root) else {
            return;
        };
        if let CompiledNode::Schema(root_schema) = &self.nodes[effective_root.0] {
            if let Some(props) = &root_schema.properties {
                self.root_expected_fields = props.iter().map(|p| p.name.clone()).collect();
                for prop in props {
                    if prop.required && !prop.has_default {
                        self.root_required_without_default.push(prop.name.clone());
                    }
                }
            }
            for extra in &root_schema.extra_required {
                self.root_required_without_default.push(extra.clone());
            }
        }
    }

    fn default_value(&self, node: NodeId, depth: usize) -> Option<&Value> {
        if depth > 128 {
            return None;
        }
        match &self.nodes[node.0] {
            CompiledNode::Any | CompiledNode::Never => None,
            CompiledNode::Ref { target, default } => default
                .as_ref()
                .or_else(|| self.default_value(*target, depth + 1)),
            CompiledNode::Schema(schema) => schema.default.as_ref(),
        }
    }

    /// Validate one value (e.g. a declared context field) against this compiled schema.
    ///
    /// Returns the parsed value (defaults applied, undeclared keys dropped), or each problem as
    /// `{"path", "message"}` with an empty path for the value itself.
    pub(crate) fn validate_value(&self, value: &Value) -> Result<Value, Vec<Value>> {
        let mut errors = Vec::new();
        let parsed = self.validate_node(Some(value.clone()), self.root, "", &mut errors, 0);
        if errors.is_empty() {
            return Ok(parsed.unwrap_or_else(|| value.clone()));
        }
        Err(errors
            .into_iter()
            .map(|error| {
                let path = match error["path"].as_str() {
                    Some("(root)") | None => "",
                    Some(path) => path,
                };
                json!({"path": path, "message": error["message"]})
            })
            .collect())
    }

    /// Validate command input against this compiled schema with the default issue cap.
    #[cfg(feature = "server")]
    pub(crate) fn execute(&self, input: Value) -> Result<Value, Box<CommandError>> {
        self.execute_with_limit(input, crate::commands::DEFAULT_MAX_VALIDATION_ISSUES)
    }

    /// Validate command input against this compiled schema, capping reported issues at `max_issues`.
    pub(crate) fn execute_with_limit(
        &self,
        input: Value,
        max_issues: usize,
    ) -> Result<Value, Box<CommandError>> {
        let limit = max_issues.max(1);
        let input = if input.is_null() {
            Value::Object(Map::new())
        } else {
            input
        };

        let mut errors = Vec::new();
        let mut root_keys: Option<Vec<String>> = None;
        let parsed = self.validate_root(input, &mut errors, &mut root_keys);
        if errors.is_empty() {
            return Ok(parsed.unwrap_or(Value::Null));
        }

        let total_errors = errors.len();
        let truncated = total_errors > limit;
        if truncated {
            errors.truncate(limit);
        }

        let expected = &self.root_expected_fields;
        let (unexpected, missing) = if let Some(keys) = root_keys {
            let expected_set: HashSet<&str> = expected.iter().map(String::as_str).collect();
            let key_set: HashSet<&str> = keys.iter().map(String::as_str).collect();
            let unexpected: Vec<String> = keys
                .iter()
                .filter(|key| !expected_set.contains(key.as_str()))
                .cloned()
                .collect();
            let missing: Vec<String> = self
                .root_required_without_default
                .iter()
                .filter(|key| !key_set.contains(key.as_str()))
                .cloned()
                .collect();
            (unexpected, missing)
        } else {
            (Vec::new(), Vec::new())
        };

        let mut details = HashMap::new();
        details.insert("errors".into(), json!(errors));
        let mut parts = vec![errors
            .iter()
            .map(|error| {
                let description = if error["path"] == "(root)" {
                    error["message"].as_str().unwrap().to_string()
                } else {
                    format!(
                        "{}: {}",
                        error["path"].as_str().unwrap(),
                        error["message"].as_str().unwrap()
                    )
                };
                if errors.len() > 1 {
                    format!("- {description}")
                } else {
                    description
                }
            })
            .collect::<Vec<_>>()
            .join("\n")];
        for (key, label, fields) in [
            ("unexpectedFields", "Unknown field(s)", &unexpected),
            ("missingFields", "Missing required field(s)", &missing),
            ("expectedFields", "Expected fields", expected),
        ] {
            if !fields.is_empty() {
                details.insert(key.into(), json!(fields));
                parts.push(format!("{label}: {}", fields.join(", ")));
            }
        }
        if truncated {
            details.insert("truncated".into(), json!(true));
            details.insert("limit".into(), json!(limit));
            details.insert("totalErrors".into(), json!(total_errors));
            parts.push(format!(
                "Showing first {limit} validation issues; fix these and retry"
            ));
        }
        Err(Box::new(
            CommandError::new(error_codes::VALIDATION_ERROR, "Input validation failed")
                .with_details(details)
                .with_suggestion(parts.join(". ")),
        ))
    }

    /// Root-level validation that consumes `input` without cloning on the happy path and captures
    /// top-level object keys only when validation fails.
    fn validate_root(
        &self,
        input: Value,
        errors: &mut Vec<Value>,
        root_keys: &mut Option<Vec<String>>,
    ) -> Option<Value> {
        let is_object = input.is_object();
        if is_object {
            if let CompiledNode::Schema(schema) = &self.nodes[self.root.0] {
                if schema.const_value.is_none()
                    && schema.enum_values.is_none()
                    && schema.type_mask.matches(&input)
                {
                    let Value::Object(mut object) = input else {
                        unreachable!()
                    };
                    let mut output = Map::new();
                    let mut present_declared: Vec<&str> = Vec::new();
                    if let Some(properties) = &schema.properties {
                        for prop in properties {
                            let present = object.remove(&prop.name);
                            if present.is_some() {
                                present_declared.push(&prop.name);
                            }
                            if present.is_some() || prop.has_default || prop.required {
                                if let Some(parsed) =
                                    self.validate_node(present, prop.node, &prop.name, errors, 1)
                                {
                                    output.insert(prop.name.clone(), parsed);
                                }
                            }
                        }
                    }
                    for key in &schema.extra_required {
                        if !object.contains_key(key) {
                            issue(
                                errors,
                                key,
                                "invalid_type",
                                "Invalid input: expected nonoptional, received undefined".into(),
                                Some("nonoptional"),
                            );
                        }
                    }
                    let mut additional_keys: Vec<String> = Vec::new();
                    let mut unknown = Vec::new();
                    for (key, value) in object {
                        match &schema.additional_properties {
                            AdditionalProperties::Deny => {
                                unknown.push(key);
                            }
                            AdditionalProperties::Schema(ap_node) => {
                                if let Some(parsed) =
                                    self.validate_node(Some(value), *ap_node, &key, errors, 1)
                                {
                                    if !errors.is_empty() {
                                        additional_keys.push(key.clone());
                                    }
                                    output.insert(key, parsed);
                                } else {
                                    additional_keys.push(key);
                                }
                            }
                            AdditionalProperties::Allow => {
                                if !errors.is_empty() {
                                    additional_keys.push(key.clone());
                                }
                                output.insert(key, value);
                            }
                            AdditionalProperties::Default if schema.properties.is_none() => {
                                if !errors.is_empty() {
                                    additional_keys.push(key.clone());
                                }
                                output.insert(key, value);
                            }
                            AdditionalProperties::Default => {
                                additional_keys.push(key);
                            }
                        }
                    }
                    if !unknown.is_empty() {
                        issue(
                            errors,
                            "",
                            "unrecognized_keys",
                            format!(
                                "Unrecognized key{}: {}",
                                if unknown.len() == 1 { "" } else { "s" },
                                unknown
                                    .iter()
                                    .map(|key| format!("\"{key}\""))
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ),
                            None,
                        );
                    }
                    if !errors.is_empty() {
                        let mut keys: Vec<String> =
                            present_declared.into_iter().map(str::to_string).collect();
                        keys.extend(unknown);
                        keys.extend(additional_keys);
                        // For `AdditionalProperties::Schema`/`Allow` keys that succeeded before an
                        // error occurred later in the loop, collect them in O(n) via a HashSet.
                        let mut seen: HashSet<String> = keys.iter().cloned().collect();
                        for key in output.keys() {
                            if seen.insert(key.clone()) {
                                keys.push(key.clone());
                            }
                        }
                        *root_keys = Some(keys);
                    }
                    return Some(Value::Object(output));
                }
            }
            let keys: Vec<String> = input
                .as_object()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            let parsed = self.validate_node(Some(input), self.root, "", errors, 0);
            if !errors.is_empty() {
                *root_keys = Some(keys);
            }
            return parsed;
        }
        self.validate_node(Some(input), self.root, "", errors, 0)
    }

    fn validate_node(
        &self,
        value: Option<Value>,
        node_id: NodeId,
        path: &str,
        errors: &mut Vec<Value>,
        depth: usize,
    ) -> Option<Value> {
        if depth > 128 {
            issue(
                errors,
                path,
                "invalid_type",
                "Input exceeds validation depth limit".into(),
                Some("object"),
            );
            return None;
        }
        let schema = match &self.nodes[node_id.0] {
            CompiledNode::Any => {
                return match value {
                    Some(v) => Some(v),
                    None => {
                        issue(
                            errors,
                            path,
                            "invalid_type",
                            "Invalid input: expected nonoptional, received undefined".into(),
                            Some("nonoptional"),
                        );
                        None
                    }
                };
            }
            CompiledNode::Never => {
                issue(
                    errors,
                    path,
                    "invalid_type",
                    format!(
                        "Invalid input: expected never, received {}",
                        value.as_ref().map(kind).unwrap_or("undefined")
                    ),
                    Some("never"),
                );
                return None;
            }
            CompiledNode::Ref { target, default } => {
                if value.is_none() {
                    if let Some(def) = default.as_ref().or_else(|| self.default_value(*target, 0)) {
                        return Some(def.clone());
                    }
                }
                return self.validate_node(value, *target, path, errors, depth + 1);
            }
            CompiledNode::Schema(schema) => schema,
        };

        if value.is_none() {
            if let Some(default) = &schema.default {
                return Some(default.clone());
            }
        }

        if let Some(constant) = &schema.const_value {
            if !value.as_ref().is_some_and(|v| equal(v, constant)) {
                issue(
                    errors,
                    path,
                    "invalid_value",
                    format!("Invalid input: expected {constant}"),
                    None,
                );
                return None;
            }
        }
        if let Some(allowed) = &schema.enum_values {
            if !value
                .as_ref()
                .is_some_and(|v| allowed.iter().any(|item| equal(v, item)))
            {
                let listed = allowed
                    .iter()
                    .map(Value::to_string)
                    .collect::<Vec<_>>()
                    .join("|");
                let message = if allowed.len() == 1 {
                    format!("Invalid input: expected {listed}")
                } else {
                    format!("Invalid option: expected one of {listed}")
                };
                issue(errors, path, "invalid_value", message, None);
                return None;
            }
        }

        let matches = value.as_ref().is_some_and(|v| schema.type_mask.matches(v));
        if !matches {
            let non_null: Vec<&str> = schema
                .type_names
                .iter()
                .copied()
                .filter(|name| *name != "null")
                .collect();
            if non_null.len() > 1 {
                issue(errors, path, "invalid_union", "Invalid input".into(), None);
            } else {
                let expected = non_null
                    .first()
                    .copied()
                    .or_else(|| schema.type_names.first().copied())
                    .unwrap_or("nonoptional");
                let expected = if expected == "integer" {
                    if value.as_ref().is_some_and(Value::is_number) {
                        "int"
                    } else {
                        "number"
                    }
                } else {
                    expected
                };
                issue(
                    errors,
                    path,
                    "invalid_type",
                    format!(
                        "Invalid input: expected {expected}, received {}",
                        value.as_ref().map(kind).unwrap_or("undefined")
                    ),
                    Some(expected),
                );
            }
            return None;
        }

        let value = value.expect("checked presence");
        match value {
            Value::Object(mut object) => {
                let mut output = Map::new();
                if let Some(properties) = &schema.properties {
                    for prop in properties {
                        let present = object.remove(&prop.name);
                        if present.is_some() || prop.has_default || prop.required {
                            let child = child_path(path, &prop.name);
                            if let Some(parsed) =
                                self.validate_node(present, prop.node, &child, errors, depth + 1)
                            {
                                output.insert(prop.name.clone(), parsed);
                            }
                        }
                    }
                }
                for key in &schema.extra_required {
                    if !object.contains_key(key) {
                        issue(
                            errors,
                            &child_path(path, key),
                            "invalid_type",
                            "Invalid input: expected nonoptional, received undefined".into(),
                            Some("nonoptional"),
                        );
                    }
                }
                let mut unknown = Vec::new();
                for (key, val) in object {
                    match &schema.additional_properties {
                        AdditionalProperties::Deny => unknown.push(key),
                        AdditionalProperties::Schema(ap_node) => {
                            let child = child_path(path, &key);
                            if let Some(parsed) =
                                self.validate_node(Some(val), *ap_node, &child, errors, depth + 1)
                            {
                                output.insert(key, parsed);
                            }
                        }
                        AdditionalProperties::Allow => {
                            output.insert(key, val);
                        }
                        AdditionalProperties::Default if schema.properties.is_none() => {
                            output.insert(key, val);
                        }
                        AdditionalProperties::Default => {}
                    }
                }
                if !unknown.is_empty() {
                    issue(
                        errors,
                        path,
                        "unrecognized_keys",
                        format!(
                            "Unrecognized key{}: {}",
                            if unknown.len() == 1 { "" } else { "s" },
                            unknown
                                .iter()
                                .map(|key| format!("\"{key}\""))
                                .collect::<Vec<_>>()
                                .join(", ")
                        ),
                        None,
                    );
                }
                Some(Value::Object(output))
            }
            Value::Array(items) => {
                let len = items.len() as f64;
                let output = if let Some(item_node) = schema.items {
                    items
                        .into_iter()
                        .enumerate()
                        .map(|(index, item)| {
                            let child = child_path_index(path, index);
                            self.validate_node(Some(item), item_node, &child, errors, depth + 1)
                                .unwrap_or(Value::Null)
                        })
                        .collect()
                } else {
                    items
                };
                check_size_bounds(
                    len,
                    schema.min_items.as_ref(),
                    schema.max_items.as_ref(),
                    path,
                    errors,
                    "array",
                    "items",
                );
                Some(Value::Array(output))
            }
            Value::String(text) => {
                if schema.min_length.is_some() || schema.max_length.is_some() {
                    check_size_bounds(
                        text.chars().count() as f64,
                        schema.min_length.as_ref(),
                        schema.max_length.as_ref(),
                        path,
                        errors,
                        "string",
                        "characters",
                    );
                }
                if let Some((pattern, regex)) = &schema.pattern {
                    if !regex.is_match(&text) {
                        issue(
                            errors,
                            path,
                            "invalid_format",
                            format!("Invalid string: must match pattern /{pattern}/"),
                            None,
                        );
                    }
                }
                Some(Value::String(text))
            }
            Value::Number(number) => {
                let num = number.as_f64().expect("finite JSON number");
                for (bound, small, exclusive) in [
                    (schema.minimum.as_ref(), true, false),
                    (schema.maximum.as_ref(), false, false),
                    (schema.exclusive_minimum.as_ref(), true, true),
                    (schema.exclusive_maximum.as_ref(), false, true),
                ] {
                    if let Some(bound) = bound {
                        let fails = if small {
                            num < bound.value || (exclusive && num == bound.value)
                        } else {
                            num > bound.value || (exclusive && num == bound.value)
                        };
                        if fails {
                            issue(
                                errors,
                                path,
                                if small { "too_small" } else { "too_big" },
                                format!(
                                    "Too {}: expected number to be {}{}{}",
                                    if small { "small" } else { "big" },
                                    if small { ">" } else { "<" },
                                    if exclusive { "" } else { "=" },
                                    bound.display
                                ),
                                None,
                            );
                        }
                    }
                }
                Some(Value::Number(number))
            }
            other => Some(other),
        }
    }
}

/// Convert legacy [`CommandParameter`] definitions to a whole JSON Schema object.
///
/// Matches [`command_to_mcp_tool`](crate::command_to_mcp_tool): `param.default` overrides
/// `param.schema.default`, required parameters without a default are listed in `required`, and
/// `JsonSchema::min_length`/`max_length` map to `minItems`/`maxItems` for arrays (and to both
/// string and array bounds when `schema_type` is unset). Non-finite numeric bounds are rejected.
pub(crate) fn parameters_to_schema(parameters: &[CommandParameter]) -> Result<Value, String> {
    let mut properties = Map::new();
    let mut required = Vec::new();

    for param in parameters {
        let mut schema = param.schema.clone().unwrap_or_else(|| JsonSchema {
            schema_type: Some(param.param_type.clone()),
            description: Some(param.description.clone()),
            default: param.default.clone(),
            enum_values: param.enum_values.clone(),
            ..Default::default()
        });
        if param.default.is_some() {
            schema.default = param.default.clone();
        }
        let has_default = schema.default.is_some();
        let path = format!("#/properties/{}", param.name);
        properties.insert(param.name.clone(), json_schema_to_value(&schema, &path)?);
        if param.required && !has_default {
            required.push(Value::String(param.name.clone()));
        }
    }

    let mut root = Map::new();
    root.insert("type".to_string(), Value::String("object".to_string()));
    root.insert("properties".to_string(), Value::Object(properties));
    root.insert("required".to_string(), Value::Array(required));
    Ok(Value::Object(root))
}

fn json_schema_to_value(schema: &JsonSchema, path: &str) -> Result<Value, String> {
    let mut map = Map::new();
    if let Some(schema_type) = &schema.schema_type {
        let type_str = match schema_type {
            JsonSchemaType::String => "string",
            JsonSchemaType::Number => "number",
            JsonSchemaType::Integer => "integer",
            JsonSchemaType::Boolean => "boolean",
            JsonSchemaType::Array => "array",
            JsonSchemaType::Object => "object",
            JsonSchemaType::Null => "null",
        };
        map.insert("type".to_string(), Value::String(type_str.to_string()));
    }
    if let Some(description) = &schema.description {
        map.insert(
            "description".to_string(),
            Value::String(description.clone()),
        );
    }
    if let Some(required) = &schema.required {
        map.insert(
            "required".to_string(),
            Value::Array(required.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(default) = &schema.default {
        map.insert("default".to_string(), default.clone());
    }
    if let Some(enum_values) = &schema.enum_values {
        map.insert("enum".to_string(), Value::Array(enum_values.clone()));
    }
    if let Some(items) = &schema.items {
        map.insert(
            "items".to_string(),
            json_schema_to_value(items, &format!("{path}/items"))?,
        );
    }
    if let Some(properties) = &schema.properties {
        let mut props = Map::new();
        for (name, child) in properties {
            props.insert(
                name.clone(),
                json_schema_to_value(child, &format!("{path}/properties/{name}"))?,
            );
        }
        map.insert("properties".to_string(), Value::Object(props));
    }
    if let Some(additional) = &schema.additional_properties {
        map.insert(
            "additionalProperties".to_string(),
            json_schema_to_value(additional, &format!("{path}/additionalProperties"))?,
        );
    }
    if let Some(minimum) = schema.minimum {
        let num = serde_json::Number::from_f64(minimum)
            .ok_or_else(|| format!("Invalid numeric bound at {path}/minimum"))?;
        map.insert("minimum".to_string(), Value::Number(num));
    }
    if let Some(maximum) = schema.maximum {
        let num = serde_json::Number::from_f64(maximum)
            .ok_or_else(|| format!("Invalid numeric bound at {path}/maximum"))?;
        map.insert("maximum".to_string(), Value::Number(num));
    }
    if let Some(min_length) = schema.min_length {
        match schema.schema_type {
            Some(JsonSchemaType::Array) => {
                map.insert("minItems".to_string(), Value::Number(min_length.into()));
            }
            None => {
                map.insert("minLength".to_string(), Value::Number(min_length.into()));
                map.insert("minItems".to_string(), Value::Number(min_length.into()));
            }
            _ => {
                map.insert("minLength".to_string(), Value::Number(min_length.into()));
            }
        }
    }
    if let Some(max_length) = schema.max_length {
        match schema.schema_type {
            Some(JsonSchemaType::Array) => {
                map.insert("maxItems".to_string(), Value::Number(max_length.into()));
            }
            None => {
                map.insert("maxLength".to_string(), Value::Number(max_length.into()));
                map.insert("maxItems".to_string(), Value::Number(max_length.into()));
            }
            _ => {
                map.insert("maxLength".to_string(), Value::Number(max_length.into()));
            }
        }
    }
    if let Some(pattern) = &schema.pattern {
        map.insert("pattern".to_string(), Value::String(pattern.clone()));
    }
    if let Some(format) = &schema.format {
        map.insert("format".to_string(), Value::String(format.clone()));
    }
    Ok(Value::Object(map))
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Exact JSON numeric equality: preserves full 64-bit integer precision while treating
/// mathematically equal representations such as `1` and `1.0` as equal.
fn numbers_equal(a: &serde_json::Number, b: &serde_json::Number) -> bool {
    if let (Some(ai), Some(bi)) = (a.as_i64(), b.as_i64()) {
        return ai == bi;
    }
    if let (Some(au), Some(bu)) = (a.as_u64(), b.as_u64()) {
        return au == bu;
    }
    if let (Some(ai), Some(bu)) = (a.as_i64(), b.as_u64()) {
        return i128::from(ai) == i128::from(bu);
    }
    if let (Some(au), Some(bi)) = (a.as_u64(), b.as_i64()) {
        return i128::from(au) == i128::from(bi);
    }
    // At least one side is a float. Compare exact integer value when the float is integral.
    let float_eq_i128 = |f: f64, int: i128| -> bool {
        if !f.is_finite() || f.fract() != 0.0 {
            return false;
        }
        // Only floats in (-2^127, 2^127) can equal an i128; cast to i128 is exact for integers
        // whose float representation has no fractional bits (all finite floats with |f| >= 2^53
        // are exact integers that fit in i128 below 2^127).
        if !(-170141183460469231731687303715884105728.0..170141183460469231731687303715884105728.0)
            .contains(&f)
        {
            return false;
        }
        (f as i128) == int
    };
    if let (Some(af), Some(bi)) = (a.as_f64(), b.as_i64()) {
        return float_eq_i128(af, i128::from(bi));
    }
    if let (Some(af), Some(bu)) = (a.as_f64(), b.as_u64()) {
        return float_eq_i128(af, i128::from(bu));
    }
    if let (Some(ai), Some(bf)) = (a.as_i64(), b.as_f64()) {
        return float_eq_i128(bf, i128::from(ai));
    }
    if let (Some(au), Some(bf)) = (a.as_u64(), b.as_f64()) {
        return float_eq_i128(bf, i128::from(au));
    }
    a.as_f64() == b.as_f64()
}

fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => numbers_equal(a, b),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| equal(a, b)))
        }
        _ => left == right,
    }
}

fn issue(errors: &mut Vec<Value>, path: &str, code: &str, message: String, expected: Option<&str>) {
    let mut error = json!({
        "path": if path.is_empty() { "(root)" } else { path },
        "code": code,
        "message": message,
    });
    if let Some(expected) = expected {
        error["expected"] = json!(expected);
    }
    errors.push(error);
}

fn child_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

fn child_path_index(path: &str, index: usize) -> String {
    if path.is_empty() {
        index.to_string()
    } else {
        format!("{path}.{index}")
    }
}

fn check_size_bounds(
    length: f64,
    minimum: Option<&CompiledBound>,
    maximum: Option<&CompiledBound>,
    path: &str,
    errors: &mut Vec<Value>,
    kind: &str,
    unit: &str,
) {
    for (bound, small) in [(minimum, true), (maximum, false)] {
        if let Some(bound) = bound {
            let fails = if small {
                length < bound.value
            } else {
                length > bound.value
            };
            if fails {
                issue(
                    errors,
                    path,
                    if small { "too_small" } else { "too_big" },
                    format!(
                        "Too {}: expected {kind} to have {}={} {unit}",
                        if small { "small" } else { "big" },
                        if small { ">" } else { "<" },
                        bound.display
                    ),
                    None,
                );
            }
        }
    }
}
