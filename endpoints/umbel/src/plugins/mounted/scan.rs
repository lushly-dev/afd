//! The load-time description scan (specification section 6.3): the rule of AFD's
//! `description-injection` surface check, ported from
//! `packages/testing/src/surface/injection.ts`. The patterns are pinned by test vectors shared
//! with that package (`packages/testing/src/surface/injection-vectors.json`).

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

/// One built-in injection pattern.
struct Pattern {
    id: &'static str,
    regex: Regex,
}

/// `(id, source)`, in the TypeScript package's order. ASCII-only (`(?-u)`), as JavaScript's `\b`
/// is; matching is case-insensitive.
const SOURCES: &[(&str, &str)] = &[
    (
        "imperative-override",
        r"(?i-u)\b(ignore|forget|disregard)\s+(previous|all|other|above)\b",
    ),
    (
        "role-assignment",
        r"(?i-u)(?:^|[.!?]\s*)you\s+(are\s+a|must\s+always|should\s+always|will\s+always)\b",
    ),
    (
        "system-prompt-fragment",
        r"(?i-u)\b(system\s*prompt|system\s*message|<<\s*SYS)\b",
    ),
    (
        "hidden-instruction",
        r"(?i-u)(?:^|[.!?]\s*)(always|never)\s+(call|use|invoke|run|execute)\s+this\b",
    ),
];

fn patterns() -> &'static [Pattern] {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        SOURCES
            .iter()
            .filter_map(|(id, source)| Regex::new(source).ok().map(|regex| Pattern { id, regex }))
            .collect()
    })
}

/// A description that matched a pattern of the rule.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct InjectionHit {
    /// The pattern's id, such as `imperative-override`.
    pub pattern: &'static str,
    /// The text that matched.
    pub matched: String,
}

/// The ids of the patterns `text` matches, in the rule's order.
pub fn scan_description(text: &str) -> Vec<InjectionHit> {
    patterns()
        .iter()
        .filter_map(|pattern| {
            pattern.regex.find(text).map(|found| InjectionHit {
                pattern: pattern.id,
                matched: found.as_str().to_owned(),
            })
        })
        .collect()
}

/// Every `description` string anywhere in a JSON schema (a property's, a nested one's), scanned.
/// Returns `(json pointer of the description, hit)`.
pub fn scan_schema_descriptions(schema: &Value) -> Vec<(String, InjectionHit)> {
    let mut found = Vec::new();
    walk(schema, "", &mut found);
    found
}

fn walk(value: &Value, pointer: &str, found: &mut Vec<(String, InjectionHit)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let here = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));
                match (key.as_str(), child) {
                    ("description", Value::String(text)) => {
                        for hit in scan_description(text) {
                            found.push((here.clone(), hit));
                        }
                    }
                    // Values, not schema: a default or an example may say anything.
                    ("default" | "examples" | "enum" | "const", _) => {}
                    _ => walk(child, &here, found),
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                walk(child, &format!("{pointer}/{index}"), found);
            }
        }
        _ => {}
    }
}
