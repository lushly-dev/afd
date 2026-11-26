//! Pack Format 2 pattern, saved-copy, and catalog extension shapes.
//!
//! Kept in a sibling module to [`super::schema`] so each file stays focused and mirrors
//! `foundations/specimen/src/pack-atoms.ts` and `pack-schema.ts`.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::patterns;
use super::problem::{IDENTIFIER_INVALID, SCHEMA_INVALID};
use super::schema::{Field, STATUSES, Shape, THEMES, child};
use super::text;

const KEEP_BASES: &[&str] = &["verified", "ungated", "out-of-context"];
const PATTERN_SCOPES: &[&str] = &["control", "composition"];
pub(crate) const APPROVAL_STATUSES: &[&str] = &["proposed", "approved", "deprecated"];
const STANDARD_DOM_EVENTS: &[&str] = &["input", "change", "submit", "reset"];
const REDUCED_MOTIONS: &[&str] = &["reduce", "no-preference"];
const MOTIONS: &[&str] = &["natural", "settled"];
const CHECKED_WORDS: &[&str] = &["mixed"];
const INVALID_WORDS: &[&str] = &["grammar", "spelling"];

/// Effective approval status when omitted in Pack Format 2 (defaults to `"approved"`).
pub(crate) fn effective_approval(status: Option<&str>) -> &str {
    status.unwrap_or("approved")
}

/// Whether content with `status` is served for a call with `include_proposed`.
/// Only `"approved"` (or omitted) is served by default; `"proposed"` is exposed only when
/// `include_proposed` is true, and `"deprecated"` approvalStatus stays hidden.
pub(crate) fn is_visible_approval(status: Option<&str>, include_proposed: bool) -> bool {
    match effective_approval(status) {
        "approved" => true,
        "proposed" => include_proposed,
        _ => false,
    }
}

impl Shape {
    pub(super) fn keep_basis(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let map = self.object(at, value, &["id", "basis", "reason"]);
        if let Some(map) = map {
            self.identifier(&child(at, "id"), map.get("id"), patterns::ID);
            self.one_of(&child(at, "basis"), map.get("basis"), KEEP_BASES);
            self.opt_text(
                &child(at, "reason"),
                map.get("reason"),
                text::STATEMENT,
                false,
            );
        }
        if self.aborted(mark) {
            return;
        }
        let Some(map) = map else { return };
        let ooc = map.get("basis").and_then(Value::as_str) == Some("out-of-context");
        let has_reason = map.get("reason").is_some();
        if ooc != has_reason {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    fn int_range(&mut self, at: &str, value: Field<'_>, min: i64, max: i64) {
        let Some(Value::Number(number)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        if !self.is_safe_int(number) {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        }
        let n = number.as_f64().unwrap_or(f64::NAN);
        if n < min as f64 {
            self.issue(SCHEMA_INVALID, at, false);
        }
        if n > max as f64 {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    fn viewport_bounds(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let keys = ["minWidth", "maxWidth", "minHeight", "maxHeight"];
        let map = self.object(at, value, &keys);
        if let Some(map) = map {
            for key in keys {
                if map.get(key).is_some() {
                    self.int_range(&child(at, key), map.get(key), 1, 8192);
                }
            }
        }
        if self.aborted(mark) {
            return;
        }
        let Some(map) = map else { return };
        if keys.iter().all(|key| map.get(*key).is_none()) {
            self.issue(SCHEMA_INVALID, at, false);
        }
        if let (Some(min_w), Some(max_w)) = (
            map.get("minWidth").and_then(Value::as_f64),
            map.get("maxWidth").and_then(Value::as_f64),
        ) && max_w < min_w
        {
            self.issue(SCHEMA_INVALID, &child(at, "maxWidth"), false);
        }
        if let (Some(min_h), Some(max_h)) = (
            map.get("minHeight").and_then(Value::as_f64),
            map.get("maxHeight").and_then(Value::as_f64),
        ) && max_h < min_h
        {
            self.issue(SCHEMA_INVALID, &child(at, "maxHeight"), false);
        }
    }

    pub(super) fn implementation_contexts(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let map = self.object(at, value, &["viewport", "themes", "reason"]);
        if let Some(map) = map {
            if map.get("viewport").is_some() {
                self.viewport_bounds(&child(at, "viewport"), map.get("viewport"));
            }
            if map.get("themes").is_some() {
                self.array(
                    &child(at, "themes"),
                    map.get("themes"),
                    1,
                    3,
                    |shape, at, element| shape.one_of(at, element, THEMES),
                );
            }
            self.text(
                &child(at, "reason"),
                map.get("reason"),
                text::STATEMENT,
                false,
                1,
            );
        }
        if self.aborted(mark) {
            return;
        }
        let Some(map) = map else { return };
        if map.get("viewport").is_none() && map.get("themes").is_none() {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    pub(super) fn component_patterns(&mut self, value: Field<'_>) {
        self.opt_array("/patterns", value, 0, 16, |shape, at, element| {
            let Some(map) = shape.object(at, element, &["library", "pattern", "contexts", "keep"])
            else {
                return;
            };
            shape.identifier(&child(at, "library"), map.get("library"), patterns::LIBRARY);
            shape.identifier(&child(at, "pattern"), map.get("pattern"), patterns::PATTERN);
            if map.get("contexts").is_some() {
                shape.implementation_contexts(&child(at, "contexts"), map.get("contexts"));
            }
            shape.array(&child(at, "keep"), map.get("keep"), 0, 64, Self::keep_basis);
        });
    }

    fn pattern_or_qualified(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::String(text)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        let ok = if text.contains('/') {
            patterns::accepts_qualified_pattern(text)
        } else {
            patterns::PATTERN.accepts(text)
        };
        if !ok {
            self.issue(IDENTIFIER_INVALID, at, false);
        }
    }

    pub(super) fn facets(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::Object(map)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        let mark = self.mark();
        for (key, vals) in map {
            let key_at = child(at, key);
            if key.len() > patterns::FACET_KEY.max || !patterns::FACET_KEY.matches(key) {
                self.identifier(
                    &key_at,
                    Some(&Value::String(key.clone())),
                    patterns::FACET_KEY,
                );
            }
            self.array(&key_at, Some(vals), 1, 16, |shape, item_at, element| {
                shape.identifier(item_at, element, patterns::FACET_VALUE);
            });
        }
        if !self.aborted(mark) && map.len() > 8 {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    fn pattern_statement(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["id", "text", "approvalStatus"]) else {
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
        if map.get("approvalStatus").is_some() {
            self.one_of(
                &child(at, "approvalStatus"),
                map.get("approvalStatus"),
                APPROVAL_STATUSES,
            );
        }
    }

    fn pattern_keep_statement(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["id", "text", "gate", "approvalStatus"]) else {
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
        self.opt_identifier(&child(at, "gate"), map.get("gate"), patterns::GATE);
        if map.get("approvalStatus").is_some() {
            self.one_of(
                &child(at, "approvalStatus"),
                map.get("approvalStatus"),
                APPROVAL_STATUSES,
            );
        }
    }

    fn digest_map(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::Object(map)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        let mark = self.mark();
        for (id, digest) in map {
            let item_at = child(at, id);
            if id.len() > patterns::ID.max || !patterns::ID.matches(id) {
                self.identifier(&item_at, Some(&Value::String(id.clone())), patterns::ID);
            }
            self.identifier(&item_at, Some(digest), patterns::DIGEST);
        }
        if !self.aborted(mark) && map.len() > 256 {
            self.issue(SCHEMA_INVALID, at, false);
        }
    }

    fn revision_or_digest(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::String(text)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        if !(patterns::DIGEST.accepts(text) || patterns::REVISION.accepts(text)) {
            self.issue(IDENTIFIER_INVALID, at, false);
        }
    }

    fn pattern_derived_from(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(
            at,
            value,
            &[
                "library",
                "pattern",
                "version",
                "revision",
                "statements",
                "declined",
            ],
        ) else {
            return;
        };
        self.identifier(&child(at, "library"), map.get("library"), patterns::LIBRARY);
        self.identifier(&child(at, "pattern"), map.get("pattern"), patterns::PATTERN);
        self.identifier(&child(at, "version"), map.get("version"), patterns::VERSION);
        self.revision_or_digest(&child(at, "revision"), map.get("revision"));
        self.digest_map(&child(at, "statements"), map.get("statements"));
        if map.get("declined").is_some() {
            self.digest_map(&child(at, "declined"), map.get("declined"));
        }
    }

    fn waived_keep_entry(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["id", "reason"]) else {
            return;
        };
        self.identifier(&child(at, "id"), map.get("id"), patterns::ID);
        self.text(
            &child(at, "reason"),
            map.get("reason"),
            text::STATEMENT,
            false,
            1,
        );
    }

    pub(super) fn catalog_pattern_bindings(&mut self, value: Field<'_>) {
        let Some(value) = value else {
            return;
        };
        let Some(Value::Object(map)) = Some(value) else {
            self.issue(SCHEMA_INVALID, "/patternBindings", true);
            return;
        };
        let mark = self.mark();
        for (source, target) in map {
            let item_at = child("/patternBindings", source);
            if !patterns::accepts_qualified_pattern(source) {
                self.issue(IDENTIFIER_INVALID, &item_at, false);
            }
            match target {
                Value::String(text) => {
                    if !patterns::accepts_qualified_pattern(text) {
                        self.issue(IDENTIFIER_INVALID, &item_at, false);
                    }
                }
                _ => self.issue(SCHEMA_INVALID, &item_at, true),
            }
        }
        if !self.aborted(mark) && map.len() > 256 {
            self.issue(SCHEMA_INVALID, "/patternBindings", false);
        }
    }

    fn role_set(&mut self, at: &str, value: Field<'_>) {
        match value {
            Some(Value::String(_)) => self.identifier(at, value, patterns::ROLE),
            Some(Value::Array(items)) => {
                let mark = self.mark();
                self.array(at, value, 1, 8, |shape, item_at, element| {
                    shape.identifier(item_at, element, patterns::ROLE);
                });
                if !self.aborted(mark) {
                    let mut seen = HashSet::new();
                    if items
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|role| !seen.insert(role))
                    {
                        self.issue(SCHEMA_INVALID, at, false);
                    }
                }
            }
            _ => self.issue(SCHEMA_INVALID, at, true),
        }
    }

    fn pattern_target(&mut self, at: &str, value: Field<'_>) {
        let mark = self.mark();
        let map = self.object(
            at,
            value,
            &["role", "name", "nameStartsWith", "nameContains"],
        );
        if let Some(map) = map {
            self.role_set(&child(at, "role"), map.get("role"));
            self.opt_text(&child(at, "name"), map.get("name"), text::SUMMARY, false);
            self.opt_text(
                &child(at, "nameStartsWith"),
                map.get("nameStartsWith"),
                text::SUMMARY,
                false,
            );
            self.opt_text(
                &child(at, "nameContains"),
                map.get("nameContains"),
                text::SUMMARY,
                false,
            );
        }
        if self.aborted(mark) {
            return;
        }
        if let Some(map) = map {
            let count = usize::from(map.get("name").is_some())
                + usize::from(map.get("nameStartsWith").is_some())
                + usize::from(map.get("nameContains").is_some());
            if count > 1 {
                self.issue(SCHEMA_INVALID, at, false);
            }
        }
    }

    fn pattern_setup(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["text", "targets"]) else {
            return;
        };
        self.text(
            &child(at, "text"),
            map.get("text"),
            text::STATEMENT,
            false,
            1,
        );
        let targets_at = child(at, "targets");
        let Some(Value::Object(targets)) = map.get("targets") else {
            self.issue(SCHEMA_INVALID, &targets_at, true);
            return;
        };
        let mark = self.mark();
        for (alias, target) in targets {
            let item_at = child(&targets_at, alias);
            if alias.len() > patterns::ALIAS.max || !patterns::ALIAS.matches(alias) {
                self.identifier(
                    &item_at,
                    Some(&Value::String(alias.clone())),
                    patterns::ALIAS,
                );
            }
            self.pattern_target(&item_at, Some(target));
        }
        if !self.aborted(mark) && (targets.is_empty() || targets.len() > 16) {
            self.issue(SCHEMA_INVALID, &targets_at, false);
        }
    }

    fn portable_action(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::Object(map)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        if map.contains_key("click") {
            if let Some(m) = self.object(at, value, &["click"]) {
                self.identifier(&child(at, "click"), m.get("click"), patterns::ALIAS);
            }
        } else if map.contains_key("focus") {
            if let Some(m) = self.object(at, value, &["focus"]) {
                self.identifier(&child(at, "focus"), m.get("focus"), patterns::ALIAS);
            }
        } else if map.contains_key("hover") {
            if let Some(m) = self.object(at, value, &["hover"]) {
                self.identifier(&child(at, "hover"), m.get("hover"), patterns::ALIAS);
            }
        } else if map.contains_key("fill") {
            if let Some(m) = self.object(at, value, &["fill", "value"]) {
                self.identifier(&child(at, "fill"), m.get("fill"), patterns::ALIAS);
                self.text(
                    &child(at, "value"),
                    m.get("value"),
                    text::STATEMENT,
                    true,
                    0,
                );
            }
        } else if map.contains_key("press") {
            if let Some(m) = self.object(at, value, &["press", "target"]) {
                self.text(&child(at, "press"), m.get("press"), 64, false, 1);
                self.opt_identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
            }
        } else {
            self.issue(SCHEMA_INVALID, at, true);
        }
    }

    fn portable_expectation(&mut self, at: &str, value: Field<'_>) {
        let Some(Value::Object(map)) = value else {
            self.issue(SCHEMA_INVALID, at, true);
            return;
        };
        if map.contains_key("event") {
            if let Some(m) = self.object(
                at,
                value,
                &["event", "target", "since", "timeoutMs", "absent"],
            ) {
                self.one_of(&child(at, "event"), m.get("event"), STANDARD_DOM_EVENTS);
                self.opt_identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                self.identifier(&child(at, "since"), m.get("since"), patterns::STEP_ID);
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
                if m.get("absent").is_some() {
                    self.boolean(&child(at, "absent"), m.get("absent"));
                }
            }
        } else if map.contains_key("form") {
            if let Some(m) = self.object(at, value, &["target", "form", "timeoutMs"]) {
                self.identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                let form_at = child(at, "form");
                if let Some(f) = self.object(&form_at, m.get("form"), &["name", "value"]) {
                    self.text(
                        &child(&form_at, "name"),
                        f.get("name"),
                        text::SUMMARY,
                        false,
                        1,
                    );
                    if !matches!(f.get("value"), Some(Value::Null)) {
                        self.text(
                            &child(&form_at, "value"),
                            f.get("value"),
                            text::VALUE,
                            true,
                            0,
                        );
                    }
                }
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
            }
        } else if map.contains_key("validity") {
            if let Some(m) = self.object(at, value, &["target", "validity", "timeoutMs"]) {
                self.identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                let validity_at = child(at, "validity");
                if let Some(v) = self.object(&validity_at, m.get("validity"), &["valid"]) {
                    self.boolean(&child(&validity_at, "valid"), v.get("valid"));
                }
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
            }
        } else if map.contains_key("a11y") {
            if let Some(m) = self.object(at, value, &["target", "a11y", "timeoutMs"]) {
                self.identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                self.a11y_expectation(&child(at, "a11y"), m.get("a11y"));
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
            }
        } else if map.contains_key("focus") {
            if let Some(m) = self.object(at, value, &["target", "focus", "timeoutMs"]) {
                self.identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                self.boolean(&child(at, "focus"), m.get("focus"));
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
            }
        } else if map.contains_key("layout") {
            if let Some(m) = self.object(at, value, &["target", "layout", "timeoutMs"]) {
                self.identifier(&child(at, "target"), m.get("target"), patterns::ALIAS);
                let layout_at = child(at, "layout");
                let mark = self.mark();
                let l = self.object(
                    &layout_at,
                    m.get("layout"),
                    &["minHeight", "minWidth", "noOverflow", "noOuterMargin"],
                );
                if let Some(l) = l {
                    if l.get("minHeight").is_some() {
                        self.int_range(
                            &child(&layout_at, "minHeight"),
                            l.get("minHeight"),
                            1,
                            8192,
                        );
                    }
                    if l.get("minWidth").is_some() {
                        self.int_range(&child(&layout_at, "minWidth"), l.get("minWidth"), 1, 8192);
                    }
                    if l.get("noOverflow").is_some() {
                        self.boolean(&child(&layout_at, "noOverflow"), l.get("noOverflow"));
                    }
                    if l.get("noOuterMargin").is_some() {
                        self.boolean(&child(&layout_at, "noOuterMargin"), l.get("noOuterMargin"));
                    }
                }
                if !self.aborted(mark) && l.is_some_and(serde_json::Map::is_empty) {
                    self.issue(SCHEMA_INVALID, &layout_at, false);
                }
                if m.get("timeoutMs").is_some() {
                    self.int_range(&child(at, "timeoutMs"), m.get("timeoutMs"), 1, 60_000);
                }
            }
        } else {
            self.issue(SCHEMA_INVALID, at, true);
        }
    }

    fn a11y_expectation(&mut self, at: &str, value: Field<'_>) {
        let keys = [
            "role",
            "name",
            "nameNonEmpty",
            "nameContains",
            "expanded",
            "selected",
            "checked",
            "pressed",
            "disabled",
            "invalid",
            "readonly",
            "required",
            "level",
        ];
        let mark = self.mark();
        let map = self.object(at, value, &keys);
        if let Some(m) = map {
            if m.get("role").is_some() {
                self.role_set(&child(at, "role"), m.get("role"));
            }
            if m.get("name").is_some() {
                self.text(&child(at, "name"), m.get("name"), text::SUMMARY, false, 0);
            }
            if m.get("nameNonEmpty").is_some() {
                self.boolean(&child(at, "nameNonEmpty"), m.get("nameNonEmpty"));
            }
            self.opt_text(
                &child(at, "nameContains"),
                m.get("nameContains"),
                text::SUMMARY,
                false,
            );
            for key in ["expanded", "selected", "disabled", "readonly", "required"] {
                if m.get(key).is_some() {
                    self.boolean(&child(at, key), m.get(key));
                }
            }
            for key in ["checked", "pressed"] {
                if let Some(v) = m.get(key)
                    && !matches!(v, Value::Bool(_))
                {
                    self.one_of(&child(at, key), Some(v), CHECKED_WORDS);
                }
            }
            if let Some(v) = m.get("invalid")
                && !matches!(v, Value::Bool(_))
            {
                self.one_of(&child(at, "invalid"), Some(v), INVALID_WORDS);
            }
            if m.get("level").is_some() {
                self.int_range(&child(at, "level"), m.get("level"), 1, 6);
            }
        }
        if self.aborted(mark) {
            return;
        }
        if let Some(m) = map {
            if m.is_empty() {
                self.issue(SCHEMA_INVALID, at, false);
            }
            if m.get("name").is_some()
                && (m.get("nameNonEmpty").is_some() || m.get("nameContains").is_some())
            {
                self.issue(SCHEMA_INVALID, at, false);
            }
        }
    }

    fn pattern_gate(&mut self, at: &str, value: Field<'_>) {
        let Some(map) = self.object(at, value, &["setup", "context", "scenario"]) else {
            return;
        };
        self.identifier(&child(at, "setup"), map.get("setup"), patterns::SETUP);
        if map.get("context").is_some() {
            let ctx_at = child(at, "context");
            if let Some(ctx) = self.object(
                &ctx_at,
                map.get("context"),
                &[
                    "viewport",
                    "container",
                    "theme",
                    "locale",
                    "reducedMotion",
                    "motion",
                ],
            ) {
                if ctx.get("viewport").is_some() {
                    let vp_at = child(&ctx_at, "viewport");
                    if let Some(vp) = self.object(&vp_at, ctx.get("viewport"), &["width", "height"])
                    {
                        self.int_range(&child(&vp_at, "width"), vp.get("width"), 1, 8192);
                        self.int_range(&child(&vp_at, "height"), vp.get("height"), 1, 8192);
                    }
                }
                if ctx.get("container").is_some() {
                    let container_at = child(&ctx_at, "container");
                    if let Some(c) =
                        self.object(&container_at, ctx.get("container"), &["width", "height"])
                    {
                        self.int_range(&child(&container_at, "width"), c.get("width"), 1, 8192);
                        if c.get("height").is_some() {
                            self.int_range(
                                &child(&container_at, "height"),
                                c.get("height"),
                                1,
                                8192,
                            );
                        }
                    }
                }
                if ctx.get("theme").is_some() {
                    self.one_of(&child(&ctx_at, "theme"), ctx.get("theme"), THEMES);
                }
                self.opt_text(
                    &child(&ctx_at, "locale"),
                    ctx.get("locale"),
                    text::SUMMARY,
                    false,
                );
                if ctx.get("reducedMotion").is_some() {
                    self.one_of(
                        &child(&ctx_at, "reducedMotion"),
                        ctx.get("reducedMotion"),
                        REDUCED_MOTIONS,
                    );
                }
                if ctx.get("motion").is_some() {
                    self.one_of(&child(&ctx_at, "motion"), ctx.get("motion"), MOTIONS);
                }
            }
        }
        self.array(
            &child(at, "scenario"),
            map.get("scenario"),
            1,
            32,
            |shape, step_at, step| {
                let Some(Value::Object(sm)) = step else {
                    shape.issue(SCHEMA_INVALID, step_at, true);
                    return;
                };
                if sm.contains_key("action") && !sm.contains_key("expect") {
                    if let Some(m) = shape.object(step_at, step, &["id", "action"]) {
                        shape.identifier(&child(step_at, "id"), m.get("id"), patterns::STEP_ID);
                        shape.portable_action(&child(step_at, "action"), m.get("action"));
                    }
                } else if sm.contains_key("expect") && !sm.contains_key("action") {
                    if let Some(m) = shape.object(step_at, step, &["id", "expect"]) {
                        shape.identifier(&child(step_at, "id"), m.get("id"), patterns::STEP_ID);
                        shape.portable_expectation(&child(step_at, "expect"), m.get("expect"));
                    }
                } else {
                    shape.issue(SCHEMA_INVALID, step_at, true);
                }
            },
        );
    }

    /// One pattern record (format 2): `data/<library>/patterns/<pattern>.json`.
    pub(crate) fn pattern(&mut self, value: &Value) {
        let mark = self.mark();
        let keys = [
            "format",
            "pattern",
            "summary",
            "status",
            "approvalStatus",
            "derivedFrom",
            "waivedKeep",
            "replacedBy",
            "scope",
            "facets",
            "useWhen",
            "avoidWhen",
            "keep",
            "customize",
            "setups",
            "gates",
            "implementations",
        ];
        let Some(map) = self.object("", Some(value), &keys) else {
            return;
        };
        self.identifier("/pattern", map.get("pattern"), patterns::PATTERN);
        self.opt_text("/summary", map.get("summary"), text::SUMMARY, false);
        self.one_of("/status", map.get("status"), STATUSES);
        if map.get("approvalStatus").is_some() {
            self.one_of(
                "/approvalStatus",
                map.get("approvalStatus"),
                APPROVAL_STATUSES,
            );
        }
        if map.get("derivedFrom").is_some() {
            self.pattern_derived_from("/derivedFrom", map.get("derivedFrom"));
        }
        self.opt_array(
            "/waivedKeep",
            map.get("waivedKeep"),
            0,
            64,
            Self::waived_keep_entry,
        );
        if map.get("replacedBy").is_some() {
            self.pattern_or_qualified("/replacedBy", map.get("replacedBy"));
        }
        self.one_of("/scope", map.get("scope"), PATTERN_SCOPES);
        self.facets("/facets", map.get("facets"));
        self.array(
            "/useWhen",
            map.get("useWhen"),
            0,
            32,
            Self::pattern_statement,
        );
        self.array(
            "/avoidWhen",
            map.get("avoidWhen"),
            0,
            32,
            Self::pattern_statement,
        );
        self.array(
            "/keep",
            map.get("keep"),
            0,
            64,
            Self::pattern_keep_statement,
        );
        self.array(
            "/customize",
            map.get("customize"),
            0,
            32,
            Self::pattern_statement,
        );
        match map.get("setups") {
            Some(Value::Object(setups)) => {
                let smark = self.mark();
                for (name, setup) in setups {
                    let at = child("/setups", name);
                    if name.len() > patterns::SETUP.max || !patterns::SETUP.matches(name) {
                        self.identifier(&at, Some(&Value::String(name.clone())), patterns::SETUP);
                    }
                    self.pattern_setup(&at, Some(setup));
                }
                if !self.aborted(smark) && setups.len() > 16 {
                    self.issue(SCHEMA_INVALID, "/setups", false);
                }
            }
            _ => self.issue(SCHEMA_INVALID, "/setups", true),
        }
        match map.get("gates") {
            Some(Value::Object(gates)) => {
                let gmark = self.mark();
                for (name, gate) in gates {
                    let at = child("/gates", name);
                    if name.len() > patterns::GATE.max || !patterns::GATE.matches(name) {
                        self.identifier(&at, Some(&Value::String(name.clone())), patterns::GATE);
                    }
                    self.pattern_gate(&at, Some(gate));
                }
                if !self.aborted(gmark) && gates.len() > 64 {
                    self.issue(SCHEMA_INVALID, "/gates", false);
                }
            }
            _ => self.issue(SCHEMA_INVALID, "/gates", true),
        }
        self.array(
            "/implementations",
            map.get("implementations"),
            0,
            256,
            |shape, at, element| {
                let Some(Value::Object(im)) = element else {
                    shape.issue(SCHEMA_INVALID, at, true);
                    return;
                };
                match im.get("kind").and_then(Value::as_str) {
                    Some("component") => {
                        if let Some(m) = shape.object(at, element, &["kind", "tag", "linkage"]) {
                            shape.identifier(&child(at, "tag"), m.get("tag"), patterns::TAG);
                            shape.one_of(&child(at, "linkage"), m.get("linkage"), &["instance"]);
                        }
                    }
                    Some("copy") => {
                        if let Some(m) = shape.object(at, element, &["kind", "name", "linkage"]) {
                            shape.identifier(
                                &child(at, "name"),
                                m.get("name"),
                                patterns::COPY_NAME,
                            );
                            shape.one_of(&child(at, "linkage"), m.get("linkage"), &["copy"]);
                        }
                    }
                    _ => shape.issue(SCHEMA_INVALID, at, true),
                }
            },
        );
        if !self.aborted(mark)
            && map.get("replacedBy").is_some()
            && map.get("status").and_then(Value::as_str) != Some("deprecated")
        {
            self.issue(SCHEMA_INVALID, "", false);
        }
    }

    /// One saved copy record (format 2): `data/<library>/patterns/<pattern>/<name>.json`.
    pub(crate) fn copy(&mut self, value: &Value) {
        let mark = self.mark();
        let keys = [
            "format",
            "pattern",
            "name",
            "status",
            "approvalStatus",
            "replacedBy",
            "html",
            "css",
            "dependencies",
            "tokens",
            "themeStylesheet",
            "setup",
            "contexts",
            "revision",
            "fingerprint",
            "changeNote",
            "origin",
            "keep",
        ];
        let Some(map) = self.object("", Some(value), &keys) else {
            return;
        };
        self.identifier("/pattern", map.get("pattern"), patterns::PATTERN);
        self.identifier("/name", map.get("name"), patterns::COPY_NAME);
        self.one_of("/status", map.get("status"), STATUSES);
        if map.get("approvalStatus").is_some() {
            self.one_of(
                "/approvalStatus",
                map.get("approvalStatus"),
                APPROVAL_STATUSES,
            );
        }
        self.opt_identifier("/replacedBy", map.get("replacedBy"), patterns::COPY_NAME);
        self.text("/html", map.get("html"), text::COPY_HTML, true, 1);
        self.text("/css", map.get("css"), text::COPY_CSS, true, 0);
        self.identifiers("/dependencies", map.get("dependencies"), 64, patterns::TAG);
        self.identifiers("/tokens", map.get("tokens"), 256, patterns::CSS_PROPERTY);
        self.opt_text(
            "/themeStylesheet",
            map.get("themeStylesheet"),
            text::VALUE,
            false,
        );
        self.opt_identifier("/setup", map.get("setup"), patterns::SETUP);
        if map.get("contexts").is_some() {
            self.implementation_contexts("/contexts", map.get("contexts"));
        }
        self.identifier("/revision", map.get("revision"), patterns::DIGEST);
        self.identifier("/fingerprint", map.get("fingerprint"), patterns::DIGEST);
        self.opt_text("/changeNote", map.get("changeNote"), text::STATEMENT, false);
        if let Some(origin) = self.object("/origin", map.get("origin"), &["id", "checkpoint"]) {
            self.identifier("/origin/id", origin.get("id"), patterns::STORY);
            self.opt_text(
                "/origin/checkpoint",
                origin.get("checkpoint"),
                text::SUMMARY,
                false,
            );
        }
        self.array("/keep", map.get("keep"), 0, 64, Self::keep_basis);
        if !self.aborted(mark)
            && map.get("replacedBy").is_some()
            && map.get("status").and_then(Value::as_str) != Some("deprecated")
        {
            self.issue(SCHEMA_INVALID, "", false);
        }
    }

    pub(super) fn catalog_patterns(&mut self, value: Field<'_>) {
        self.array("/patterns", value, 0, 256, |shape, at, element| {
            let mark = shape.mark();
            let keys = [
                "pattern",
                "summary",
                "status",
                "approvalStatus",
                "replacedBy",
                "scope",
                "facets",
                "digest",
            ];
            let map = shape.object(at, element, &keys);
            if let Some(entry) = map {
                shape.identifier(
                    &child(at, "pattern"),
                    entry.get("pattern"),
                    patterns::PATTERN,
                );
                shape.opt_text(
                    &child(at, "summary"),
                    entry.get("summary"),
                    text::SUMMARY,
                    false,
                );
                shape.one_of(&child(at, "status"), entry.get("status"), STATUSES);
                if entry.get("approvalStatus").is_some() {
                    shape.one_of(
                        &child(at, "approvalStatus"),
                        entry.get("approvalStatus"),
                        APPROVAL_STATUSES,
                    );
                }
                if entry.get("replacedBy").is_some() {
                    shape.pattern_or_qualified(&child(at, "replacedBy"), entry.get("replacedBy"));
                }
                shape.one_of(&child(at, "scope"), entry.get("scope"), PATTERN_SCOPES);
                shape.facets(&child(at, "facets"), entry.get("facets"));
                shape.identifier(&child(at, "digest"), entry.get("digest"), patterns::DIGEST);
            }
            if !shape.aborted(mark)
                && let Some(entry) = map
                && entry.get("replacedBy").is_some()
                && entry.get("status").and_then(Value::as_str) != Some("deprecated")
            {
                shape.issue(SCHEMA_INVALID, at, false);
            }
        });
    }

    pub(super) fn catalog_copies(&mut self, value: Field<'_>) {
        self.array("/copies", value, 0, 512, |shape, at, element| {
            let mark = shape.mark();
            let keys = [
                "pattern",
                "name",
                "status",
                "approvalStatus",
                "replacedBy",
                "revision",
                "fingerprint",
                "digest",
            ];
            let map = shape.object(at, element, &keys);
            if let Some(entry) = map {
                shape.identifier(
                    &child(at, "pattern"),
                    entry.get("pattern"),
                    patterns::PATTERN,
                );
                shape.identifier(&child(at, "name"), entry.get("name"), patterns::COPY_NAME);
                shape.one_of(&child(at, "status"), entry.get("status"), STATUSES);
                if entry.get("approvalStatus").is_some() {
                    shape.one_of(
                        &child(at, "approvalStatus"),
                        entry.get("approvalStatus"),
                        APPROVAL_STATUSES,
                    );
                }
                shape.opt_identifier(
                    &child(at, "replacedBy"),
                    entry.get("replacedBy"),
                    patterns::COPY_NAME,
                );
                shape.identifier(
                    &child(at, "revision"),
                    entry.get("revision"),
                    patterns::DIGEST,
                );
                shape.identifier(
                    &child(at, "fingerprint"),
                    entry.get("fingerprint"),
                    patterns::DIGEST,
                );
                shape.identifier(&child(at, "digest"), entry.get("digest"), patterns::DIGEST);
            }
            if !shape.aborted(mark)
                && let Some(entry) = map
                && entry.get("replacedBy").is_some()
                && entry.get("status").and_then(Value::as_str) != Some("deprecated")
            {
                shape.issue(SCHEMA_INVALID, at, false);
            }
        });
    }
}

/// Per-`keep` statement basis in Pack Format 2.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct KeepBasis {
    pub(crate) id: String,
    pub(crate) basis: String,
    pub(crate) reason: Option<String>,
}

/// Optional viewport bounds for a context-scoped implementation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewportBounds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_height: Option<u32>,
}

/// Optional applicability contexts for an implementation.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct ImplementationContexts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) viewport: Option<ViewportBounds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) themes: Option<Vec<String>>,
    pub(crate) reason: String,
}

/// Component-to-pattern implementation link in a format 2 component record.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct ComponentPattern {
    pub(crate) library: String,
    pub(crate) pattern: String,
    pub(crate) contexts: Option<ImplementationContexts>,
    pub(crate) keep: Vec<KeepBasis>,
}

/// Provenance of a copied pattern (`derivedFrom`, Patterns spec §8).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct PatternDerivedFrom {
    pub(crate) library: String,
    pub(crate) pattern: String,
    pub(crate) version: String,
    pub(crate) revision: String,
    pub(crate) statements: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) declined: Option<BTreeMap<String, String>>,
}

/// Recorded waiver reason for a dropped upstream `keep` statement.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct WaivedKeep {
    pub(crate) id: String,
    pub(crate) reason: String,
}

/// A portable pattern guidance statement (`useWhen`, `avoidWhen`, `customize`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct PatternStatement {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) approval_status: Option<String>,
}

/// A portable pattern `keep` statement, optionally backed by a named gate.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct PatternKeepStatement {
    pub(crate) id: String,
    pub(crate) text: String,
    pub(crate) gate: Option<String>,
    pub(crate) approval_status: Option<String>,
}

/// A same-library implementation entry in a pattern record.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub(crate) struct PatternImplementation {
    pub(crate) kind: String,
    pub(crate) tag: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) linkage: String,
}

impl PatternImplementation {
    pub(crate) fn sort_name(&self) -> &str {
        self.tag
            .as_deref()
            .or(self.name.as_deref())
            .unwrap_or_default()
    }
}

/// A checked format 2 pattern record: `data/<library>/patterns/<pattern>.json`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct PatternRecord {
    pub(crate) pattern: String,
    pub(crate) summary: Option<String>,
    pub(crate) status: String,
    pub(crate) approval_status: Option<String>,
    pub(crate) derived_from: Option<PatternDerivedFrom>,
    #[serde(default)]
    pub(crate) waived_keep: Vec<WaivedKeep>,
    pub(crate) replaced_by: Option<String>,
    pub(crate) scope: String,
    pub(crate) facets: BTreeMap<String, Vec<String>>,
    pub(crate) use_when: Vec<PatternStatement>,
    pub(crate) avoid_when: Vec<PatternStatement>,
    pub(crate) keep: Vec<PatternKeepStatement>,
    pub(crate) customize: Vec<PatternStatement>,
    pub(crate) setups: BTreeMap<String, Value>,
    pub(crate) gates: BTreeMap<String, Value>,
    pub(crate) implementations: Vec<PatternImplementation>,
}

/// Origin of a saved copy record.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub(crate) struct CopyOrigin {
    pub(crate) id: String,
    pub(crate) checkpoint: Option<String>,
}

/// A checked format 2 saved copy record: `data/<library>/patterns/<pattern>/<name>.json`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct CopyRecord {
    pub(crate) pattern: String,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) approval_status: Option<String>,
    pub(crate) replaced_by: Option<String>,
    pub(crate) html: String,
    pub(crate) css: String,
    pub(crate) dependencies: Vec<String>,
    pub(crate) tokens: Vec<String>,
    pub(crate) theme_stylesheet: Option<String>,
    pub(crate) setup: Option<String>,
    pub(crate) contexts: Option<ImplementationContexts>,
    pub(crate) revision: String,
    pub(crate) fingerprint: String,
    pub(crate) change_note: Option<String>,
    pub(crate) origin: CopyOrigin,
    pub(crate) keep: Vec<KeepBasis>,
}

/// Format 2 catalog entry for one pattern record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct CatalogPatternEntry {
    pub(crate) pattern: String,
    pub(crate) summary: Option<String>,
    pub(crate) status: String,
    pub(crate) approval_status: Option<String>,
    pub(crate) replaced_by: Option<String>,
    pub(crate) scope: String,
    pub(crate) facets: BTreeMap<String, Vec<String>>,
    pub(crate) digest: String,
}

/// Format 2 catalog entry for one saved copy record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct CatalogCopyEntry {
    pub(crate) pattern: String,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) approval_status: Option<String>,
    pub(crate) replaced_by: Option<String>,
    pub(crate) revision: String,
    pub(crate) fingerprint: String,
    pub(crate) digest: String,
}
