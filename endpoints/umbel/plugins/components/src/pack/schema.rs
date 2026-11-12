//! The record, rules and catalog shapes, and the allowed bases.
//!
//! [`Shape`] is a port of the Zod schemas in `foundations/specimen/src/pack-schema.ts`, which decide
//! each problem's code and pointer. It keeps Zod's two rules that matter for that: length checks
//! run even after a failure, and a refinement or a pattern does not run after a failure that
//! aborts (an issue that is not marked to continue). Only a file that holds is read into the
//! typed shapes below it.

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use super::patterns::{self, Pattern};
use super::problem::{IDENTIFIER_INVALID, SCHEMA_INVALID, TEXT_INVALID, TEXT_TOO_LONG};
use super::text;

/// Largest integer JavaScript and Rust both hold and write alike.
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// One issue: a problem code, a JSON Pointer (empty for the file's root), and whether later
/// checks of the same value stop.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Issue {
    code: &'static str,
    at: String,
    aborts: bool,
}

/// The issues of one file.
pub(crate) struct Shape {
    issues: Vec<Issue>,
    /// The character that stands for an unpaired surrogate in this file, if it has one.
    marker: Option<char>,
}

type Field<'v> = Option<&'v Value>;

fn child(at: &str, key: &str) -> String {
    format!("{at}/{key}")
}

impl Shape {
    pub(crate) fn new(marker: Option<char>) -> Self {
        Self {
            issues: Vec::new(),
            marker,
        }
    }

    /// `(code, pointer)` of each issue; a pointer is absent at the file's root.
    pub(crate) fn finish(self) -> Vec<(&'static str, Option<String>)> {
        self.issues
            .into_iter()
            .map(|issue| {
                let at = (!issue.at.is_empty()).then_some(issue.at);
                (issue.code, at)
            })
            .collect()
    }

    fn issue(&mut self, code: &'static str, at: &str, aborts: bool) {
        self.issues.push(Issue {
            code,
            at: at.to_owned(),
            aborts,
        });
    }

    fn mark(&self) -> usize {
        self.issues.len()
    }

    fn aborted(&self, mark: usize) -> bool {
        self.issues
            .get(mark..)
            .is_some_and(|new| new.iter().any(|issue| issue.aborts))
    }

    /// `.max()`, which runs on anything with a length, whatever failed before it.
    fn max_length(&mut self, at: &str, value: Field<'_>, max: usize) {
        let code = match value {
            Some(Value::String(_)) => IDENTIFIER_INVALID,
            _ => SCHEMA_INVALID,
        };
        if length_of(value).is_some_and(|length| length > max as f64) {
            self.issue(code, at, false);
        }
    }

    /// `.min()`, likewise.
    fn min_length(&mut self, at: &str, value: Field<'_>, min: usize) {
        if length_of(value).is_some_and(|length| length < min as f64) {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    /// A strict object: its unknown keys are one issue at the object.
    fn object<'v>(
        &mut self,
        at: &str,
        value: Field<'v>,
        keys: &[&str],
    ) -> Option<&'v Map<String, Value>> {
        let Some(Value::Object(map)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return None;
        };
        if map.keys().any(|key| !keys.contains(&key.as_str())) {
            self.issue(SCHEMA_INVALID, at, true);
        }
        Some(map)
    }

    fn identifier(&mut self, at: &str, value: Field<'_>, pattern: Pattern) {
        let Some(Value::String(text)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            self.max_length(at, value, pattern.max);
            return;
        };
        self.max_length(at, value, pattern.max);
        if !pattern.matches(text) {
            self.issue(IDENTIFIER_INVALID, at, false);
        }
    }

    fn opt_identifier(&mut self, at: &str, value: Field<'_>, pattern: Pattern) {
        if value.is_some() {
            self.identifier(at, value, pattern);
        }
    }

    /// Issues of a string that is known to be text of the given limit.
    fn text_rules(&mut self, at: &str, text: &str, max: usize, multi_line: bool) {
        if text.chars().count() > max {
            self.issue(TEXT_TOO_LONG, at, false);
        }
        if !text::allowed(text, multi_line) || self.marker.is_some_and(|c| text.contains(c)) {
            self.issue(TEXT_INVALID, at, false);
        }
    }

    fn text(&mut self, at: &str, value: Field<'_>, max: usize, multi_line: bool, min: usize) {
        match value {
            Some(Value::String(text)) => {
                self.min_length(at, value, min);
                self.text_rules(at, text, max, multi_line);
            }
            _ => {
                self.issue(SCHEMA_INVALID, at, true);
                self.min_length(at, value, min);
            }
        }
    }

    fn opt_text(&mut self, at: &str, value: Field<'_>, max: usize, multi_line: bool) {
        if value.is_some() {
            self.text(at, value, max, multi_line, 1);
        }
    }

    /// A `string | safe integer | boolean | null` union. Zod reports a string branch's own issues
    /// when only that branch did not abort; a number that fails is one `SCHEMA_INVALID`.
    fn scalar(&mut self, at: &str, value: Field<'_>) {
        match value {
            Some(Value::String(text)) => self.text_rules(at, text, text::VALUE, false),
            Some(Value::Bool(_) | Value::Null) => {}
            Some(Value::Number(number)) => match safe_integer(number) {
                Whole::Safe => {}
                Whole::Unsafe => self.issue(SCHEMA_INVALID, at, false),
                Whole::No => self.issue(SCHEMA_INVALID, at, true),
            },
            _ => self.issue(SCHEMA_INVALID, at, true),
        }
    }

    fn opt_scalar(&mut self, at: &str, value: Field<'_>) {
        if value.is_some() {
            self.scalar(at, value);
        }
    }

    fn one_of(&mut self, at: &str, value: Field<'_>, allowed: &[&str]) {
        if !matches!(value, Some(Value::String(text)) if allowed.contains(&text.as_str())) {
            self.issue(SCHEMA_INVALID, at, true);
        }
    }

    fn boolean(&mut self, at: &str, value: Field<'_>) {
        if !matches!(value, Some(Value::Bool(_))) {
            self.issue(SCHEMA_INVALID, at, true);
        }
    }

    fn array<'v>(
        &mut self,
        at: &str,
        value: Field<'v>,
        min: usize,
        max: usize,
        mut item: impl FnMut(&mut Self, &str, Field<'v>),
    ) {
        match value {
            Some(Value::Array(items)) => {
                for (index, element) in items.iter().enumerate() {
                    item(self, &child(at, &index.to_string()), Some(element));
                }
            }
            _ => self.issue(SCHEMA_INVALID, at, true),
        }
        self.max_length(at, value, max);
        if min > 0 {
            self.min_length(at, value, min);
        }
    }

    fn opt_array<'v>(
        &mut self,
        at: &str,
        value: Field<'v>,
        min: usize,
        max: usize,
        item: impl FnMut(&mut Self, &str, Field<'v>),
    ) {
        if value.is_some() {
            self.array(at, value, min, max, item);
        }
    }

    fn identifiers(&mut self, at: &str, value: Field<'_>, max: usize, pattern: Pattern) {
        self.array(at, value, 0, max, |shape, at, element| {
            shape.identifier(at, element, pattern);
        });
    }

    fn opt_identifiers(&mut self, at: &str, value: Field<'_>, max: usize, pattern: Pattern) {
        if value.is_some() {
            self.identifiers(at, value, max, pattern);
        }
    }

    fn statement(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["id", "text", "basis"]) else {
            return;
        };
        self.identifier(&child(at, "id"), map.get("id"), patterns::ID);
        self.text(
            &child(at, "text"),
            map.get("text"),
            text::STATEMENT,
            false,
            1,
        );
        self.one_of(&child(at, "basis"), map.get("basis"), STATEMENT_BASES);
    }

    fn attribute(&mut self, at: &str, value: Field<'_>) {
        let keys = [
            "name",
            "property",
            "type",
            "description",
            "values",
            "default",
            "rules",
            "basis",
        ];
        let Some(map) = self.object(at, value, &keys) else {
            return;
        };
        self.identifier(&child(at, "name"), map.get("name"), patterns::ATTRIBUTE);
        self.opt_identifier(
            &child(at, "property"),
            map.get("property"),
            patterns::PROPERTY,
        );
        self.opt_text(&child(at, "type"), map.get("type"), text::STATEMENT, false);
        self.opt_text(
            &child(at, "description"),
            map.get("description"),
            text::STATEMENT,
            false,
        );
        self.opt_array(
            &child(at, "values"),
            map.get("values"),
            0,
            64,
            |shape, at, element| {
                let Some(entry) = shape.object(at, element, &["value", "basis"]) else {
                    return;
                };
                shape.scalar(&child(at, "value"), entry.get("value"));
                shape.one_of(&child(at, "basis"), entry.get("basis"), API_BASES);
            },
        );
        self.opt_scalar(&child(at, "default"), map.get("default"));
        self.opt_identifiers(&child(at, "rules"), map.get("rules"), 16, patterns::ID);
        self.one_of(&child(at, "basis"), map.get("basis"), API_BASES);
    }

    fn slot(&mut self, at: &str, value: Field<'_>) {
        let keys = ["name", "description", "accepts", "basis"];
        let Some(map) = self.object(at, value, &keys) else {
            return;
        };
        self.identifier(&child(at, "name"), map.get("name"), patterns::SLOT);
        self.opt_text(
            &child(at, "description"),
            map.get("description"),
            text::STATEMENT,
            false,
        );
        self.opt_identifiers(
            &child(at, "accepts"),
            map.get("accepts"),
            32,
            patterns::ELEMENT,
        );
        self.one_of(&child(at, "basis"), map.get("basis"), API_BASES);
    }

    fn event(&mut self, at: &str, value: Field<'_>) {
        let keys = ["name", "description", "detail", "basis"];
        let Some(map) = self.object(at, value, &keys) else {
            return;
        };
        self.identifier(&child(at, "name"), map.get("name"), patterns::EVENT);
        self.opt_text(
            &child(at, "description"),
            map.get("description"),
            text::STATEMENT,
            false,
        );
        self.opt_text(
            &child(at, "detail"),
            map.get("detail"),
            text::STATEMENT,
            false,
        );
        self.one_of(&child(at, "basis"), map.get("basis"), API_BASES);
    }

    fn command(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["name", "description", "basis"]) else {
            return;
        };
        self.identifier(&child(at, "name"), map.get("name"), patterns::COMMAND);
        self.opt_text(
            &child(at, "description"),
            map.get("description"),
            text::STATEMENT,
            false,
        );
        self.one_of(&child(at, "basis"), map.get("basis"), API_BASES);
    }

    fn css_property(&mut self, at: &str, value: Field<'_>) {
        let keys = ["name", "description", "default", "basis"];
        let Some(map) = self.object(at, value, &keys) else {
            return;
        };
        self.identifier(&child(at, "name"), map.get("name"), patterns::CSS_PROPERTY);
        self.opt_text(
            &child(at, "description"),
            map.get("description"),
            text::STATEMENT,
            false,
        );
        self.opt_text(
            &child(at, "default"),
            map.get("default"),
            text::VALUE,
            false,
        );
        self.one_of(&child(at, "basis"), map.get("basis"), API_BASES);
    }

    fn gap(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let map = self.object(at, value, &["kind", "section", "name"]);
        if let Some(map) = map {
            self.one_of(&child(at, "kind"), map.get("kind"), GAP_KINDS);
            if map.get("section").is_some() {
                self.one_of(&child(at, "section"), map.get("section"), GAP_SECTIONS);
            }
            self.opt_identifier(&child(at, "name"), map.get("name"), patterns::GAP_NAME);
        }
        if self.aborted(mark) {
            return;
        }
        let Some(map) = map else { return };
        let unobserved = map.get("kind").and_then(Value::as_str) == Some("unobserved");
        let (section, name) = (map.get("section").is_some(), map.get("name").is_some());
        let holds = if unobserved {
            section && name
        } else {
            !section && !name
        };
        if !holds {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    /// One component's record: `data/<library>/components/<tag>.json`.
    pub(crate) fn component(&mut self, value: &Value) {
        let mark = self.mark();
        let keys = [
            "format",
            "tag",
            "summary",
            "status",
            "replacedBy",
            "import",
            "api",
            "a11y",
            "usage",
            "rules",
            "examples",
            "detail",
            "gaps",
            "themes",
        ];
        let Some(map) = self.object("", Some(value), &keys) else {
            return;
        };
        self.identifier("/tag", map.get("tag"), patterns::TAG);
        self.opt_text("/summary", map.get("summary"), text::SUMMARY, false);
        self.one_of("/status", map.get("status"), STATUSES);
        self.opt_identifier("/replacedBy", map.get("replacedBy"), patterns::TAG);
        self.opt_identifier("/import", map.get("import"), patterns::SPECIFIER);
        self.api(map.get("api"));
        self.a11y(map.get("a11y"));
        self.array("/usage", map.get("usage"), 0, 64, Self::statement);
        self.identifiers("/rules", map.get("rules"), 64, patterns::ID);
        self.array(
            "/examples",
            map.get("examples"),
            0,
            16,
            |shape, at, element| {
                let Some(example) = shape.object(at, element, &["from", "html", "basis"]) else {
                    return;
                };
                shape.identifier(&child(at, "from"), example.get("from"), patterns::STORY);
                shape.text(
                    &child(at, "html"),
                    example.get("html"),
                    text::EXAMPLE,
                    true,
                    1,
                );
                shape.one_of(&child(at, "basis"), example.get("basis"), OBSERVED);
            },
        );
        self.opt_text("/detail", map.get("detail"), text::DETAIL, true);
        self.array("/gaps", map.get("gaps"), 0, 64, Self::gap);
        if map.get("themes").is_some()
            && let Some(themes) = self.object(
                "/themes",
                map.get("themes"),
                &["supported", "basis", "reason"],
            )
        {
            self.array(
                "/themes/supported",
                themes.get("supported"),
                1,
                3,
                |shape, at, element| shape.one_of(at, element, THEMES),
            );
            self.one_of("/themes/basis", themes.get("basis"), THEMES_BASES);
            self.opt_text(
                "/themes/reason",
                themes.get("reason"),
                text::STATEMENT,
                false,
            );
        }
        if !self.aborted(mark)
            && map.get("replacedBy").is_some()
            && map.get("status").and_then(Value::as_str) != Some("deprecated")
        {
            self.issue(SCHEMA_INVALID, "", false);
        }
    }

    fn api(&mut self, value: Field<'_>) {
        let keys = [
            "attributes",
            "slots",
            "events",
            "commands",
            "cssProperties",
            "form",
        ];
        let Some(map) = self.object("/api", value, &keys) else {
            return;
        };
        self.array(
            "/api/attributes",
            map.get("attributes"),
            0,
            256,
            Self::attribute,
        );
        self.array("/api/slots", map.get("slots"), 0, 64, Self::slot);
        self.array("/api/events", map.get("events"), 0, 64, Self::event);
        self.array("/api/commands", map.get("commands"), 0, 64, Self::command);
        self.array(
            "/api/cssProperties",
            map.get("cssProperties"),
            0,
            256,
            Self::css_property,
        );
        if map.get("form").is_some()
            && let Some(form) = self.object("/api/form", map.get("form"), &["associated", "basis"])
        {
            self.boolean("/api/form/associated", form.get("associated"));
            self.one_of("/api/form/basis", form.get("basis"), API_BASES);
        }
    }

    fn a11y(&mut self, value: Field<'_>) {
        let Some(map) = self.object("/a11y", value, &["role", "statements", "axe"]) else {
            return;
        };
        self.array(
            "/a11y/role",
            map.get("role"),
            0,
            16,
            |shape, at, element| {
                let keys = ["state", "role", "name", "basis"];
                let Some(role) = shape.object(at, element, &keys) else {
                    return;
                };
                shape.identifier(&child(at, "state"), role.get("state"), patterns::STATE);
                shape.identifier(&child(at, "role"), role.get("role"), patterns::ROLE);
                shape.opt_text(&child(at, "name"), role.get("name"), text::SUMMARY, false);
                shape.one_of(&child(at, "basis"), role.get("basis"), ROLE_BASES);
            },
        );
        self.array(
            "/a11y/statements",
            map.get("statements"),
            0,
            64,
            Self::statement,
        );
        if map.get("axe").is_some()
            && let Some(axe) = self.object(
                "/a11y/axe",
                map.get("axe"),
                &["violations", "exceptions", "basis"],
            )
        {
            self.violations("/a11y/axe/violations", axe.get("violations"));
            self.identifiers(
                "/a11y/axe/exceptions",
                axe.get("exceptions"),
                32,
                patterns::AXE_RULE,
            );
            self.one_of("/a11y/axe/basis", axe.get("basis"), OBSERVED);
        }
    }

    /// `z.number().int().min(0)`.
    fn violations(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::Number(number)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        match safe_integer(number) {
            Whole::No => self.issue(SCHEMA_INVALID, at, true),
            // `.int()` fires on an unsafe integer and `.min(0)` still runs after it.
            Whole::Unsafe => {
                self.issue(SCHEMA_INVALID, at, false);
                if number.as_f64().is_some_and(|n| n < 0.0) {
                    self.issue(SCHEMA_INVALID, at, false);
                }
            }
            Whole::Safe if number.as_f64().is_some_and(|n| n < 0.0) => {
                self.issue(SCHEMA_INVALID, at, false);
            }
            Whole::Safe => {}
        }
    }

    /// A library's shared rules: `rules/<library>.json`.
    pub(crate) fn rules(&mut self, value: &Value) {
        let Some(map) = self.object("", Some(value), &["format", "library", "rules"]) else {
            return;
        };
        self.identifier("/library", map.get("library"), patterns::LIBRARY);
        self.array("/rules", map.get("rules"), 0, 512, |shape, at, element| {
            let keys = ["id", "text", "appliesTo", "basis"];
            let Some(rule) = shape.object(at, element, &keys) else {
                return;
            };
            shape.identifier(&child(at, "id"), rule.get("id"), patterns::ID);
            shape.text(
                &child(at, "text"),
                rule.get("text"),
                text::STATEMENT,
                false,
                1,
            );
            shape.applies_to(&child(at, "appliesTo"), rule.get("appliesTo"));
            shape.one_of(&child(at, "basis"), rule.get("basis"), STATEMENT_BASES);
        });
    }

    fn applies_to(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let map = self.object(at, value, &["tags", "attributes"]);
        if let Some(map) = map {
            self.opt_array(
                &child(at, "tags"),
                map.get("tags"),
                1,
                256,
                |shape, at, element| {
                    shape.identifier(at, element, patterns::TAG);
                },
            );
            self.opt_array(
                &child(at, "attributes"),
                map.get("attributes"),
                1,
                64,
                |shape, at, element| {
                    shape.identifier(at, element, patterns::ATTRIBUTE);
                },
            );
        }
        if self.aborted(mark) {
            return;
        }
        if map.is_some_and(|map| map.get("tags").is_none() && map.get("attributes").is_none()) {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    /// The exported form's catalog: `data/<library>/library.json`.
    pub(crate) fn library(&mut self, value: &Value) {
        let keys = [
            "format",
            "library",
            "title",
            "package",
            "prefix",
            "revision",
            "digest",
            "rules",
            "components",
        ];
        let Some(map) = self.object("", Some(value), &keys) else {
            return;
        };
        self.identifier("/library", map.get("library"), patterns::LIBRARY);
        self.text("/title", map.get("title"), text::TITLE, false, 1);
        if let Some(package) = self.object("/package", map.get("package"), &["name", "version"]) {
            self.identifier("/package/name", package.get("name"), patterns::PACKAGE);
            self.identifier(
                "/package/version",
                package.get("version"),
                patterns::VERSION,
            );
        }
        self.identifier("/prefix", map.get("prefix"), patterns::PREFIX);
        self.opt_identifier("/revision", map.get("revision"), patterns::REVISION);
        self.identifier("/digest", map.get("digest"), patterns::DIGEST);
        self.identifier("/rules", map.get("rules"), patterns::DIGEST);
        self.array(
            "/components",
            map.get("components"),
            0,
            990,
            |shape, at, element| {
                let keys = ["tag", "summary", "status", "digest"];
                let Some(entry) = shape.object(at, element, &keys) else {
                    return;
                };
                shape.identifier(&child(at, "tag"), entry.get("tag"), patterns::TAG);
                shape.opt_text(
                    &child(at, "summary"),
                    entry.get("summary"),
                    text::SUMMARY,
                    false,
                );
                shape.one_of(&child(at, "status"), entry.get("status"), STATUSES);
                shape.identifier(&child(at, "digest"), entry.get("digest"), patterns::DIGEST);
            },
        );
    }
}

const API_BASES: &[&str] = &["verified", "observed", "declared"];
const STATEMENT_BASES: &[&str] = &["verified", "authored"];
const ROLE_BASES: &[&str] = &["observed", "authored"];
const OBSERVED: &[&str] = &["observed"];
const THEMES: &[&str] = &["dark", "high-contrast", "light"];
const THEMES_BASES: &[&str] = &["declared", "observed"];
const STATUSES: &[&str] = &["stable", "preview", "deprecated"];
const GAP_SECTIONS: &[&str] = &["attributes", "slots", "events", "commands", "cssProperties"];
const GAP_KINDS: &[&str] = &[
    "summary",
    "usage",
    "a11y-statement",
    "role",
    "example",
    "unobserved",
];

/// The length Zod's length checks see: a string's code points, an array's items, or an object's
/// own numeric `length`.
fn length_of(value: Field<'_>) -> Option<f64> {
    match value {
        Some(Value::String(text)) => Some(text.chars().count() as f64),
        Some(Value::Array(items)) => Some(items.len() as f64),
        Some(Value::Object(map)) => map.get("length").and_then(Value::as_f64),
        _ => None,
    }
}

enum Whole {
    Safe,
    Unsafe,
    No,
}

fn safe_integer(number: &serde_json::Number) -> Whole {
    if let Some(value) = number.as_i64() {
        return if (value as f64).abs() <= MAX_SAFE {
            Whole::Safe
        } else {
            Whole::Unsafe
        };
    }
    if number.as_u64().is_some() {
        return Whole::Unsafe;
    }
    match number.as_f64() {
        Some(value) if value.fract() != 0.0 => Whole::No,
        Some(value) if value.abs() <= MAX_SAFE => Whole::Safe,
        Some(_) => Whole::Unsafe,
        None => Whole::No,
    }
}

/// A `Value` field that keeps a JSON `null` as `Some(Null)`.
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

/// A checked record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    pub(crate) tag: String,
    pub(crate) summary: Option<String>,
    pub(crate) status: String,
    pub(crate) replaced_by: Option<String>,
    pub(crate) import: Option<String>,
    pub(crate) api: Api,
    pub(crate) a11y: A11y,
    pub(crate) usage: Vec<Statement>,
    pub(crate) rules: Vec<String>,
    pub(crate) examples: Vec<Example>,
    pub(crate) detail: Option<String>,
    pub(crate) gaps: Vec<Value>,
    /// The themes it renders as intended; a brief does not show them yet.
    pub(crate) themes: Option<Themes>,
}

/// `themes`: the themes a component supports, and how that is known.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Themes {
    pub(crate) supported: Vec<String>,
    #[allow(dead_code)]
    pub(crate) basis: String,
    #[allow(dead_code)]
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Api {
    pub(crate) attributes: Vec<Attribute>,
    pub(crate) slots: Vec<Slot>,
    pub(crate) events: Vec<Event>,
    pub(crate) commands: Vec<Command>,
    pub(crate) css_properties: Vec<CssProperty>,
    pub(crate) form: Option<Form>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Attribute {
    pub(crate) name: String,
    pub(crate) property: Option<String>,
    #[serde(rename = "type")]
    pub(crate) kind: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) values: Option<Vec<AttributeValue>>,
    #[serde(default, deserialize_with = "present")]
    pub(crate) default: Option<Value>,
    pub(crate) rules: Option<Vec<String>>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AttributeValue {
    pub(crate) value: Value,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Slot {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) accepts: Option<Vec<String>>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Event {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Command {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CssProperty {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) default: Option<String>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Form {
    pub(crate) associated: bool,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct A11y {
    pub(crate) role: Vec<Role>,
    pub(crate) statements: Vec<Statement>,
    pub(crate) axe: Option<Axe>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Role {
    pub(crate) state: String,
    pub(crate) role: String,
    pub(crate) name: Option<String>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Axe {
    pub(crate) violations: Value,
    pub(crate) exceptions: Vec<String>,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Statement {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Example {
    pub(crate) from: String,
    pub(crate) html: String,
    pub(crate) basis: String,
}

/// A checked rules file.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Rules {
    pub(crate) library: String,
    pub(crate) rules: Vec<Rule>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rule {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) applies_to: AppliesTo,
    pub(crate) basis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AppliesTo {
    pub(crate) tags: Option<Vec<String>>,
    pub(crate) attributes: Option<Vec<String>>,
}

/// A checked catalog.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Catalog {
    pub(crate) library: String,
    pub(crate) title: String,
    pub(crate) package: Package,
    pub(crate) prefix: String,
    pub(crate) revision: Option<String>,
    pub(crate) digest: String,
    pub(crate) rules: String,
    pub(crate) components: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Package {
    pub(crate) name: String,
    pub(crate) version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CatalogEntry {
    pub(crate) tag: String,
    pub(crate) summary: Option<String>,
    pub(crate) status: String,
    pub(crate) digest: String,
}
