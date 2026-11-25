//! Collecting every identifier from pack records for D153 secret/instruction scanning.

use serde_json::Value;

use super::schema::{Catalog, Record, Rules};
use super::schema_pattern::{CopyRecord, PatternRecord};

/// A record's identifiers and where they are.
pub(super) fn record_identifiers(record: &Record) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![("/tag".to_owned(), record.tag.as_str())];
    if let Some(value) = &record.replaced_by {
        out.push(("/replacedBy".to_owned(), value));
    }
    if let Some(value) = &record.import {
        out.push(("/import".to_owned(), value));
    }
    for (index, attribute) in record.api.attributes.iter().enumerate() {
        out.push((format!("/api/attributes/{index}/name"), &attribute.name));
        if let Some(property) = &attribute.property {
            out.push((format!("/api/attributes/{index}/property"), property));
        }
        for (at, id) in attribute.rules.iter().flatten().enumerate() {
            out.push((format!("/api/attributes/{index}/rules/{at}"), id));
        }
    }
    for (index, slot) in record.api.slots.iter().enumerate() {
        out.push((format!("/api/slots/{index}/name"), &slot.name));
        for (at, element) in slot.accepts.iter().flatten().enumerate() {
            out.push((format!("/api/slots/{index}/accepts/{at}"), element));
        }
    }
    for (index, event) in record.api.events.iter().enumerate() {
        out.push((format!("/api/events/{index}/name"), &event.name));
    }
    for (index, command) in record.api.commands.iter().enumerate() {
        out.push((format!("/api/commands/{index}/name"), &command.name));
    }
    for (index, property) in record.api.css_properties.iter().enumerate() {
        out.push((format!("/api/cssProperties/{index}/name"), &property.name));
    }
    for (index, role) in record.a11y.role.iter().enumerate() {
        out.push((format!("/a11y/role/{index}/state"), &role.state));
        out.push((format!("/a11y/role/{index}/role"), &role.role));
    }
    for (index, statement) in record.a11y.statements.iter().enumerate() {
        out.push((format!("/a11y/statements/{index}/id"), &statement.id));
    }
    if let Some(axe) = &record.a11y.axe {
        for (index, rule) in axe.exceptions.iter().enumerate() {
            out.push((format!("/a11y/axe/exceptions/{index}"), rule));
        }
    }
    for (index, statement) in record.usage.iter().enumerate() {
        out.push((format!("/usage/{index}/id"), &statement.id));
    }
    for (index, id) in record.rules.iter().enumerate() {
        out.push((format!("/rules/{index}"), id));
    }
    for (index, example) in record.examples.iter().enumerate() {
        out.push((format!("/examples/{index}/from"), &example.from));
    }
    for (index, gap) in record.gaps.iter().enumerate() {
        if let Some(name) = gap.get("name").and_then(Value::as_str) {
            out.push((format!("/gaps/{index}/name"), name));
        }
    }
    for (index, pat) in record.patterns.iter().enumerate() {
        out.push((format!("/patterns/{index}/library"), &pat.library));
        out.push((format!("/patterns/{index}/pattern"), &pat.pattern));
        for (at, keep) in pat.keep.iter().enumerate() {
            out.push((format!("/patterns/{index}/keep/{at}/id"), &keep.id));
        }
    }
    out
}

pub(super) fn pattern_identifiers(record: &PatternRecord) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![("/pattern".to_owned(), record.pattern.as_str())];
    if let Some(value) = &record.replaced_by {
        out.push(("/replacedBy".to_owned(), value));
    }
    for (key, values) in &record.facets {
        out.push((format!("/facets/{key}"), key));
        for (index, value) in values.iter().enumerate() {
            out.push((format!("/facets/{key}/{index}"), value));
        }
    }
    for (index, st) in record.use_when.iter().enumerate() {
        out.push((format!("/useWhen/{index}/id"), &st.id));
    }
    for (index, st) in record.avoid_when.iter().enumerate() {
        out.push((format!("/avoidWhen/{index}/id"), &st.id));
    }
    for (index, st) in record.keep.iter().enumerate() {
        out.push((format!("/keep/{index}/id"), &st.id));
        if let Some(gate) = &st.gate {
            out.push((format!("/keep/{index}/gate"), gate));
        }
    }
    for (index, st) in record.customize.iter().enumerate() {
        out.push((format!("/customize/{index}/id"), &st.id));
    }
    for (name, setup) in &record.setups {
        out.push((format!("/setups/{name}"), name));
        if let Some(targets) = setup.get("targets").and_then(Value::as_object) {
            for (alias, target) in targets {
                out.push((format!("/setups/{name}/targets/{alias}"), alias));
                if let Some(role) = target.get("role") {
                    match role {
                        Value::String(r) => {
                            out.push((format!("/setups/{name}/targets/{alias}/role"), r));
                        }
                        Value::Array(roles) => {
                            for (idx, r) in roles.iter().enumerate() {
                                if let Some(rs) = r.as_str() {
                                    out.push((
                                        format!("/setups/{name}/targets/{alias}/role/{idx}"),
                                        rs,
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    for (name, gate) in &record.gates {
        out.push((format!("/gates/{name}"), name));
        if let Some(setup) = gate.get("setup").and_then(Value::as_str) {
            out.push((format!("/gates/{name}/setup"), setup));
        }
        if let Some(steps) = gate.get("scenario").and_then(Value::as_array) {
            for (index, step) in steps.iter().enumerate() {
                if let Some(id) = step.get("id").and_then(Value::as_str) {
                    out.push((format!("/gates/{name}/scenario/{index}/id"), id));
                }
                if let Some(action) = step.get("action").and_then(Value::as_object) {
                    for key in ["click", "focus", "hover", "fill", "target"] {
                        if let Some(val) = action.get(key).and_then(Value::as_str) {
                            out.push((format!("/gates/{name}/scenario/{index}/action/{key}"), val));
                        }
                    }
                }
                if let Some(expect) = step.get("expect").and_then(Value::as_object) {
                    for key in ["target", "since"] {
                        if let Some(val) = expect.get(key).and_then(Value::as_str) {
                            out.push((format!("/gates/{name}/scenario/{index}/expect/{key}"), val));
                        }
                    }
                    if let Some(role) = expect.get("a11y").and_then(|a| a.get("role")) {
                        match role {
                            Value::String(r) => {
                                out.push((
                                    format!("/gates/{name}/scenario/{index}/expect/a11y/role"),
                                    r,
                                ));
                            }
                            Value::Array(roles) => {
                                for (idx, r) in roles.iter().enumerate() {
                                    if let Some(rs) = r.as_str() {
                                        out.push((
                                            format!(
                                                "/gates/{name}/scenario/{index}/expect/a11y/role/{idx}"
                                            ),
                                            rs,
                                        ));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    for (index, item) in record.implementations.iter().enumerate() {
        if let Some(tag) = &item.tag {
            out.push((format!("/implementations/{index}/tag"), tag));
        }
        if let Some(name) = &item.name {
            out.push((format!("/implementations/{index}/name"), name));
        }
    }
    out
}

pub(super) fn copy_identifiers(record: &CopyRecord) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![
        ("/pattern".to_owned(), record.pattern.as_str()),
        ("/name".to_owned(), record.name.as_str()),
        ("/revision".to_owned(), record.revision.as_str()),
        ("/fingerprint".to_owned(), record.fingerprint.as_str()),
        ("/origin/id".to_owned(), record.origin.id.as_str()),
    ];
    if let Some(value) = &record.replaced_by {
        out.push(("/replacedBy".to_owned(), value));
    }
    if let Some(value) = &record.setup {
        out.push(("/setup".to_owned(), value));
    }
    for (index, dep) in record.dependencies.iter().enumerate() {
        out.push((format!("/dependencies/{index}"), dep));
    }
    for (index, token) in record.tokens.iter().enumerate() {
        out.push((format!("/tokens/{index}"), token));
    }
    for (index, keep) in record.keep.iter().enumerate() {
        out.push((format!("/keep/{index}/id"), &keep.id));
    }
    out
}

pub(super) fn rules_identifiers(rules: &Rules) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![("/library".to_owned(), rules.library.as_str())];
    for (index, rule) in rules.rules.iter().enumerate() {
        out.push((format!("/rules/{index}/id"), &rule.id));
        for (at, tag) in rule.applies_to.tags.iter().flatten().enumerate() {
            out.push((format!("/rules/{index}/appliesTo/tags/{at}"), tag));
        }
        for (at, attribute) in rule.applies_to.attributes.iter().flatten().enumerate() {
            out.push((
                format!("/rules/{index}/appliesTo/attributes/{at}"),
                attribute,
            ));
        }
    }
    out
}

pub(super) fn catalog_identifiers(catalog: &Catalog) -> Vec<(String, &str)> {
    let mut out: Vec<(String, &str)> = vec![
        ("/library".to_owned(), catalog.library.as_str()),
        ("/package/name".to_owned(), catalog.package.name.as_str()),
        (
            "/package/version".to_owned(),
            catalog.package.version.as_str(),
        ),
        ("/prefix".to_owned(), catalog.prefix.as_str()),
        ("/digest".to_owned(), catalog.digest.as_str()),
        ("/rules".to_owned(), catalog.rules.as_str()),
    ];
    if let Some(revision) = &catalog.revision {
        out.push(("/revision".to_owned(), revision));
    }
    for (index, entry) in catalog.components.iter().enumerate() {
        out.push((format!("/components/{index}/tag"), &entry.tag));
        out.push((format!("/components/{index}/digest"), &entry.digest));
    }
    for (index, entry) in catalog.patterns.iter().enumerate() {
        out.push((format!("/patterns/{index}/pattern"), &entry.pattern));
        if let Some(replaced) = &entry.replaced_by {
            out.push((format!("/patterns/{index}/replacedBy"), replaced));
        }
        out.push((format!("/patterns/{index}/digest"), &entry.digest));
        for (key, values) in &entry.facets {
            out.push((format!("/patterns/{index}/facets/{key}"), key));
            for (at, value) in values.iter().enumerate() {
                out.push((format!("/patterns/{index}/facets/{key}/{at}"), value));
            }
        }
    }
    for (index, entry) in catalog.copies.iter().enumerate() {
        out.push((format!("/copies/{index}/pattern"), &entry.pattern));
        out.push((format!("/copies/{index}/name"), &entry.name));
        if let Some(replaced) = &entry.replaced_by {
            out.push((format!("/copies/{index}/replacedBy"), replaced));
        }
        out.push((format!("/copies/{index}/revision"), &entry.revision));
        out.push((format!("/copies/{index}/fingerprint"), &entry.fingerprint));
        out.push((format!("/copies/{index}/digest"), &entry.digest));
    }
    out
}
