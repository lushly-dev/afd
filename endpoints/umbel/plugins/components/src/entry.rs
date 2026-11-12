//! A record to an entry: its floor and its sections (specification, sections 5.3 and 5.5), each
//! item with its own basis written out and its flags (5.6).

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::Settings;
use crate::pack::Library;
use crate::pack::schema::{Attribute, Record, Rule, Statement};
use crate::scan;

/// A section's name and its data, in the order of section 5.3.
pub(crate) const SECTIONS: [&str; 15] = [
    "attributes",
    "slots",
    "events",
    "commands",
    "cssProperties",
    "themes",
    "form",
    "roles",
    "axe",
    "a11y",
    "usage",
    "rules",
    "examples",
    "gaps",
    "detail",
];

/// One section's data.
#[derive(Debug, Clone)]
pub(crate) enum Section {
    /// Items written as `{ "items": [...] }`.
    Items(Vec<Value>),
    /// One item written as `{ "items": [item] }`.
    One(Value),
    /// Rule ids, written as an array.
    Ids(Vec<String>),
    /// As the record has them, written as an array.
    Plain(Vec<Value>),
    /// The long form.
    Detail(String),
}

impl Section {
    /// How many items, for a section that holds a list.
    pub(crate) fn list_len(&self) -> Option<usize> {
        match self {
            Self::Items(items) | Self::Plain(items) => Some(items.len()),
            Self::Ids(ids) => Some(ids.len()),
            Self::One(_) | Self::Detail(_) => None,
        }
    }

    /// The first `count` items after `skip`, for a section that holds a list.
    pub(crate) fn window(&self, skip: usize, count: usize) -> Self {
        fn part<T: Clone>(items: &[T], skip: usize, count: usize) -> Vec<T> {
            items.iter().skip(skip).take(count).cloned().collect()
        }
        match self {
            Self::Items(items) => Self::Items(part(items, skip, count)),
            Self::Plain(items) => Self::Plain(part(items, skip, count)),
            Self::Ids(ids) => Self::Ids(part(ids, skip, count)),
            other => other.clone(),
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Self::Items(items) => json!({ "items": items }),
            Self::One(item) => json!({ "items": [item] }),
            Self::Ids(ids) => json!(ids),
            Self::Plain(items) => Value::Array(items.clone()),
            Self::Detail(text) => Value::String(text.clone()),
        }
    }

    /// How many of this section's items carry flags.
    fn flagged(&self) -> usize {
        let flagged = |item: &Value| usize::from(item.get("flags").is_some());
        match self {
            Self::Items(items) | Self::Plain(items) => items.iter().map(flagged).sum(),
            Self::One(item) => flagged(item),
            _ => 0,
        }
    }

    /// The ids of the rules this section names.
    fn rule_ids(&self, name: &str) -> Vec<String> {
        match (name, self) {
            ("rules", Self::Ids(ids)) => ids.clone(),
            ("attributes", Self::Items(items)) => items
                .iter()
                .filter_map(|item| item.get("rules")?.as_array())
                .flatten()
                .filter_map(|id| id.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// A record prepared for answering.
#[derive(Debug, Clone)]
pub(crate) struct Entry {
    floor: Map<String, Value>,
    /// The section's name and data, for each non-empty section, in order.
    pub(crate) sections: Vec<(&'static str, Section)>,
    /// How many facts `minimum_basis` left out.
    pub(crate) left_out: usize,
    /// The rules this entry may name, by id.
    rules: BTreeMap<String, Value>,
    /// The long form's flags, which flag the entry when it is served.
    detail_flags: Vec<&'static str>,
}

/// One item of a list section.
fn item(mut map: Map<String, Value>) -> Value {
    scan::flag_item(&mut map);
    Value::Object(map)
}

fn put(map: &mut Map<String, Value>, key: &str, value: Option<&String>) {
    if let Some(value) = value {
        map.insert(key.to_owned(), Value::String(value.clone()));
    }
}

fn map_of(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

struct Build<'a> {
    settings: &'a Settings,
    left_out: usize,
    /// Ids of the rules `minimum_basis` left out.
    weak_rules: Vec<&'a str>,
}

impl Build<'_> {
    /// Whether a fact of this basis stays; counts it when it does not.
    fn keep(&mut self, basis: &str) -> bool {
        let keep = self.settings.serves(basis);
        if !keep {
            self.left_out += 1;
        }
        keep
    }

    fn attribute(&mut self, attribute: &Attribute) -> Option<Value> {
        let value_count = attribute.values.as_ref().map_or(0, Vec::len);
        if !self.keep(&attribute.basis) {
            self.left_out += value_count;
            return None;
        }
        let mut map = map_of(json!({ "name": attribute.name, "basis": attribute.basis }));
        put(&mut map, "property", attribute.property.as_ref());
        put(&mut map, "type", attribute.kind.as_ref());
        put(&mut map, "description", attribute.description.as_ref());
        if let Some(values) = &attribute.values {
            let kept: Vec<Value> = values
                .iter()
                .filter(|value| self.keep(&value.basis))
                .map(|value| json!({ "value": value.value, "basis": value.basis }))
                .collect();
            if !kept.is_empty() {
                map.insert("values".to_owned(), Value::Array(kept));
            }
        }
        if let Some(default) = &attribute.default {
            map.insert("default".to_owned(), default.clone());
        }
        let rules = self.live_rules(attribute.rules.as_deref().unwrap_or_default());
        if !rules.is_empty() {
            map.insert("rules".to_owned(), json!(rules));
        }
        Some(item(map))
    }

    fn live_rules<'r>(&self, ids: &'r [String]) -> Vec<&'r String> {
        ids.iter()
            .filter(|id| !self.weak_rules.contains(&id.as_str()))
            .collect()
    }

    fn statements(&mut self, statements: &[Statement]) -> Vec<Value> {
        statements
            .iter()
            .filter(|statement| self.keep(&statement.basis))
            .map(|statement| {
                item(map_of(json!({
                    "id": statement.id, "text": statement.text, "basis": statement.basis,
                })))
            })
            .collect()
    }
}

fn rule_value(library: &str, rule: &Rule) -> Value {
    item(map_of(json!({
        "library": library, "id": rule.id, "text": rule.text, "basis": rule.basis,
    })))
}

fn push_items(sections: &mut Vec<(&'static str, Section)>, name: &'static str, items: Vec<Value>) {
    if !items.is_empty() {
        sections.push((name, Section::Items(items)));
    }
}

/// `record` of `library`, with `minimum_basis` applied before anything else.
pub(crate) fn build(library: &Library, record: &Record, settings: &Settings) -> Entry {
    // A rule weaker than the setting goes everywhere its id would be shown.
    let weak_rules: Vec<&str> = library
        .rules
        .rules
        .iter()
        .filter(|rule| !settings.serves(&rule.basis))
        .map(|rule| rule.id.as_str())
        .collect();
    let mut build = Build {
        settings,
        left_out: 0,
        weak_rules,
    };
    let rules: BTreeMap<String, Value> = library
        .rules
        .rules
        .iter()
        .filter(|rule| settings.serves(&rule.basis))
        .map(|rule| (rule.id.clone(), rule_value(&library.id, rule)))
        .collect();
    build.left_out += library
        .rules
        .rules
        .iter()
        .filter(|rule| !settings.serves(&rule.basis) && names_rule(record, &rule.id))
        .count();

    let mut sections = Vec::new();
    let attributes: Vec<Value> = record
        .api
        .attributes
        .iter()
        .filter_map(|attribute| build.attribute(attribute))
        .collect();
    push_items(&mut sections, "attributes", attributes);
    let slots: Vec<Value> = record
        .api
        .slots
        .iter()
        .filter(|slot| build.keep(&slot.basis))
        .map(|slot| {
            let mut map = map_of(json!({ "name": slot.name, "basis": slot.basis }));
            put(&mut map, "description", slot.description.as_ref());
            if let Some(accepts) = &slot.accepts {
                map.insert("accepts".to_owned(), json!(accepts));
            }
            item(map)
        })
        .collect();
    push_items(&mut sections, "slots", slots);
    let events: Vec<Value> = record
        .api
        .events
        .iter()
        .filter(|event| build.keep(&event.basis))
        .map(|event| {
            let mut map = map_of(json!({ "name": event.name, "basis": event.basis }));
            put(&mut map, "description", event.description.as_ref());
            put(&mut map, "detail", event.detail.as_ref());
            item(map)
        })
        .collect();
    push_items(&mut sections, "events", events);
    let commands: Vec<Value> = record
        .api
        .commands
        .iter()
        .filter(|command| build.keep(&command.basis))
        .map(|command| {
            let mut map = map_of(json!({ "name": command.name, "basis": command.basis }));
            put(&mut map, "description", command.description.as_ref());
            item(map)
        })
        .collect();
    push_items(&mut sections, "commands", commands);
    let css: Vec<Value> = record
        .api
        .css_properties
        .iter()
        .filter(|property| build.keep(&property.basis))
        .map(|property| {
            let mut map = map_of(json!({ "name": property.name, "basis": property.basis }));
            put(&mut map, "description", property.description.as_ref());
            put(&mut map, "default", property.default.as_ref());
            item(map)
        })
        .collect();
    push_items(&mut sections, "cssProperties", css);
    if let Some(themes) = record.themes.as_ref().filter(|t| build.keep(&t.basis)) {
        let mut map = map_of(json!({ "supported": themes.supported, "basis": themes.basis }));
        put(&mut map, "reason", themes.reason.as_ref());
        sections.push(("themes", Section::One(item(map))));
    }
    if let Some(form) = record.api.form.as_ref().filter(|f| build.keep(&f.basis)) {
        sections.push((
            "form",
            Section::One(json!({ "associated": form.associated, "basis": form.basis })),
        ));
    }
    let roles: Vec<Value> = record
        .a11y
        .role
        .iter()
        .filter(|role| build.keep(&role.basis))
        .map(|role| {
            let mut map = map_of(json!({
                "state": role.state, "role": role.role, "basis": role.basis,
            }));
            put(&mut map, "name", role.name.as_ref());
            item(map)
        })
        .collect();
    push_items(&mut sections, "roles", roles);
    if let Some(axe) = record.a11y.axe.as_ref().filter(|a| build.keep(&a.basis)) {
        sections.push((
            "axe",
            Section::One(json!({
                "violations": axe.violations, "exceptions": axe.exceptions, "basis": axe.basis,
            })),
        ));
    }
    let a11y = build.statements(&record.a11y.statements);
    push_items(&mut sections, "a11y", a11y);
    let usage = build.statements(&record.usage);
    push_items(&mut sections, "usage", usage);
    let mut rule_ids: Vec<String> = record
        .rules
        .iter()
        .chain(
            record
                .api
                .attributes
                .iter()
                .flat_map(|a| a.rules.iter().flatten()),
        )
        .filter(|id| !build.weak_rules.contains(&id.as_str()))
        .cloned()
        .collect();
    rule_ids.sort();
    rule_ids.dedup();
    if !rule_ids.is_empty() {
        sections.push(("rules", Section::Ids(rule_ids)));
    }
    let examples: Vec<Value> = record
        .examples
        .iter()
        .filter(|example| build.keep(&example.basis))
        .map(|example| {
            item(map_of(json!({
                "from": example.from, "html": example.html, "basis": example.basis,
            })))
        })
        .collect();
    push_items(&mut sections, "examples", examples);
    if !record.gaps.is_empty() {
        let gaps = record
            .gaps
            .iter()
            .cloned()
            .map(|gap| item(map_of(gap)))
            .collect();
        sections.push(("gaps", Section::Plain(gaps)));
    }
    let mut detail_flags = Vec::new();
    if let Some(detail) = &record.detail {
        detail_flags = scan::text_flags(detail);
        sections.push(("detail", Section::Detail(detail.clone())));
    }

    let mut floor = map_of(json!({
        "tag": record.tag, "library": library.id, "status": record.status,
    }));
    put(&mut floor, "summary", record.summary.as_ref());
    put(&mut floor, "replacedBy", record.replaced_by.as_ref());
    put(&mut floor, "import", record.import.as_ref());
    Entry {
        floor,
        sections,
        left_out: build.left_out,
        rules,
        detail_flags,
    }
}

fn names_rule(record: &Record, id: &str) -> bool {
    record.rules.iter().any(|rule| rule == id)
        || record
            .api
            .attributes
            .iter()
            .any(|attribute| attribute.rules.iter().flatten().any(|rule| rule == id))
}

/// One built answer's content: the entry with `sections`, the rules it names, and how many items
/// are flagged.
pub(crate) struct Served {
    pub(crate) component: Value,
    pub(crate) rules: Vec<Value>,
    pub(crate) flagged: usize,
}

impl Entry {
    /// The entry with exactly `sections`.
    pub(crate) fn serve(&self, sections: &[(&'static str, Section)]) -> Served {
        let mut component = self.floor.clone();
        let mut flags = scan::text_flags(
            component
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        for flag in scan::text_flags(
            component
                .get("import")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ) {
            if !flags.contains(&flag) {
                flags.push(flag);
            }
        }
        let mut flagged = 0;
        let mut named: Vec<String> = Vec::new();
        for (name, section) in sections {
            component.insert((*name).to_owned(), section.to_json());
            flagged += section.flagged();
            named.extend(section.rule_ids(name));
            if *name == "detail" {
                for flag in &self.detail_flags {
                    if !flags.contains(flag) {
                        flags.push(flag);
                    }
                }
            }
        }
        if !flags.is_empty() {
            component.insert("flags".to_owned(), Value::from(scan::ordered(&flags)));
            flagged += 1;
        }
        named.sort();
        named.dedup();
        let rules: Vec<Value> = named
            .iter()
            .filter_map(|id| self.rules.get(id))
            .cloned()
            .collect();
        flagged += rules
            .iter()
            .filter(|rule| rule.get("flags").is_some())
            .count();
        Served {
            component: Value::Object(component),
            rules,
            flagged,
        }
    }
}
