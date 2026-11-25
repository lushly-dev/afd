//! `components-brief` (specification, sections 6 and 7): the components a page uses, in one call,
//! one entry each, the shared rules they name stated once, the tags no library knows, and what was
//! left out to fit the budget.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::entry::{self, Entry, SECTIONS, Section};
use crate::fit::{fit_count, fits};
use crate::list::{content_library, identity};
use crate::pack::{self, Library};
use crate::{Settings, basis_rank, fail, input, render, scan, select};

/// At most this many tags in all, from `tags` and `source` (section 6.2).
const MAX_TAGS: usize = 128;

/// The sections `detail: "api"` serves; `rules` as ids and `patterns` as links only (amendment A31.5).
const API: [&str; 8] = [
    "attributes",
    "slots",
    "events",
    "commands",
    "cssProperties",
    "form",
    "rules",
    "patterns",
];

/// One step of the shedding order (section 6.4; Phase 0.4 P0-6 / amendment A31.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    /// Whole sections, from every entry at once.
    Sections(&'static [&'static str]),
    /// Each event's `detail`.
    EventDetail,
    /// Attributes whose basis is `declared` and that have no `values`.
    DeclaredAttributes,
    /// Step 5b: `content.patterns[].customize` (after `declaredAttributes`, before `usage`).
    PatternCustomize,
    /// `content.rules`; the ids stay in each entry.
    RuleText,
    /// Step 10b: `content.patterns` (after `ruleText`, before `a11y`); component `patterns` links stay.
    PatternKeep,
}

const ORDER: [Step; 15] = [
    Step::Sections(&["detail"]),
    Step::Sections(&["examples"]),
    Step::Sections(&["cssProperties"]),
    Step::EventDetail,
    Step::DeclaredAttributes,
    Step::PatternCustomize,
    Step::Sections(&["usage"]),
    Step::Sections(&["events", "commands"]),
    Step::Sections(&["form", "roles", "axe"]),
    Step::Sections(&["slots"]),
    Step::RuleText,
    Step::PatternKeep,
    Step::Sections(&["a11y"]),
    Step::Sections(&["attributes"]),
    Step::Sections(&["themes", "gaps", "rules", "patterns"]),
];

impl Step {
    /// The section `components-open` returns a piece from.
    fn opens(self) -> &'static [&'static str] {
        match self {
            Self::Sections(names) => names,
            Self::EventDetail => &["events"],
            Self::DeclaredAttributes => &["attributes"],
            Self::RuleText => &["rules"],
            Self::PatternCustomize | Self::PatternKeep => &[],
        }
    }
}

/// What one step of the order took away, from the requested tags answered so far.
#[derive(Debug, Clone, Default)]
struct Effect {
    sections: Vec<&'static str>,
    piece: Option<&'static str>,
    /// `(library, pattern)` pairs affected by `Step::PatternCustomize` or `Step::PatternKeep`.
    patterns: Vec<(String, String)>,
}

impl Effect {
    fn is_empty(&self) -> bool {
        self.sections.is_empty() && self.piece.is_none() && self.patterns.is_empty()
    }
}

/// One requested tag's answer.
enum Asked {
    Entry {
        library: usize,
        entry: Box<Entry>,
        excluded: Vec<String>,
    },
    Unknown(Value),
}

fn event_without_detail(item: &Value) -> Value {
    let Some(map) = item.as_object() else {
        return item.clone();
    };
    if !map.contains_key("detail") {
        return item.clone();
    }
    let mut map = map.clone();
    map.remove("detail");
    // The flags were the whole item's; the detail may have been what the scan hit.
    map.remove("flags");
    scan::flag_item(&mut map);
    Value::Object(map)
}

fn is_declared_only(item: &Value) -> bool {
    item.get("basis").and_then(Value::as_str) == Some("declared") && item.get("values").is_none()
}

/// An attribute without its rule ids, flagged again on what is left.
fn attribute_without_rules(item: &Value) -> Value {
    let Some(map) = item.as_object() else {
        return item.clone();
    };
    if !map.contains_key("rules") {
        return item.clone();
    }
    let mut map = map.clone();
    map.remove("rules");
    map.remove("flags");
    scan::flag_item(&mut map);
    Value::Object(map)
}

/// An entry's requested sections with the first `steps` of the order applied; a section left
/// empty is left out. Without `attribute_rules`, the rules the record's attributes name are left
/// out of the attributes and of the `rules` section (section 5.4).
fn shed(
    entry: &Entry,
    names: &[&str],
    steps: usize,
    attribute_rules: bool,
) -> Vec<(&'static str, Section)> {
    let applied = &ORDER[..steps];
    let gone = |name: &str| {
        applied
            .iter()
            .any(|step| matches!(step, Step::Sections(list) if list.contains(&name)))
    };
    entry
        .sections
        .iter()
        .filter(|(name, _)| names.contains(name) && !gone(name))
        .filter_map(|(name, section)| {
            let section = match (*name, section) {
                ("events", Section::Items(items)) if applied.contains(&Step::EventDetail) => {
                    Section::Items(items.iter().map(event_without_detail).collect())
                }
                ("attributes", Section::Items(items)) => Section::Items(
                    items
                        .iter()
                        .filter(|item| {
                            !applied.contains(&Step::DeclaredAttributes) || !is_declared_only(item)
                        })
                        .map(|item| {
                            if attribute_rules {
                                item.clone()
                            } else {
                                attribute_without_rules(item)
                            }
                        })
                        .collect(),
                ),
                ("rules", Section::Ids(ids)) if !attribute_rules => Section::Ids(
                    ids.iter()
                        .filter(|id| !entry.attribute_rules.contains(*id))
                        .cloned()
                        .collect(),
                ),
                _ => section.clone(),
            };
            (section.list_len() != Some(0)).then_some((*name, section))
        })
        .collect()
}

/// The basis most of `items` share; a tie goes to the stronger.
fn majority(items: &[Value]) -> Option<String> {
    let mut counts: BTreeMap<(u8, &str), usize> = BTreeMap::new();
    for basis in items
        .iter()
        .filter_map(|item| item.get("basis").and_then(Value::as_str))
    {
        *counts.entry((basis_rank(basis), basis)).or_default() += 1;
    }
    let most = counts.values().copied().max()?;
    // In rank order, so the first with the most is the strongest of them.
    counts
        .into_iter()
        .find(|(_, count)| *count == most)
        .map(|((_, basis), _)| basis.to_owned())
}

fn remove_basis_if(item: &mut Value, basis: &str) {
    if let Some(map) = item.as_object_mut()
        && map.get("basis").and_then(Value::as_str) == Some(basis)
    {
        map.remove("basis");
    }
}

fn qualified(library: &str, id: &Value) -> Value {
    id.as_str()
        .map_or_else(|| id.clone(), |id| Value::from(format!("{library}/{id}")))
}

fn qualify_ids(ids: &mut Value, library: &str) {
    if let Some(ids) = ids.as_array_mut() {
        for id in ids {
            *id = qualified(library, id);
        }
    }
}

/// An entry in the brief's form (section 5.2): each section states its basis once and only an
/// item that differs carries its own; an attribute's values carry one only when it differs from
/// the attribute's. With `library`, rule ids are written `<library>/<id>` (section 5.4).
fn brief_form(mut component: Value, library: Option<&str>) -> Value {
    let Some(map) = component.as_object_mut() else {
        return component;
    };
    for name in SECTIONS {
        let Some(section) = map.get_mut(name) else {
            continue;
        };
        let Some(items) = section.get_mut("items").and_then(Value::as_array_mut) else {
            continue;
        };
        for item in items.iter_mut() {
            if name == "attributes"
                && let Some(map) = item.as_object_mut()
                && map.get("property").is_some()
                && map.get("property") == map.get("name")
            {
                map.remove("property");
            }
            let own = item.get("basis").and_then(Value::as_str).map(str::to_owned);
            if let (Some(own), Some(values)) =
                (own, item.get_mut("values").and_then(Value::as_array_mut))
            {
                values
                    .iter_mut()
                    .for_each(|value| remove_basis_if(value, &own));
            }
            if let Some(library) = library
                && let Some(ids) = item.get_mut("rules")
            {
                qualify_ids(ids, library);
            }
        }
        if let Some(basis) = majority(items) {
            items
                .iter_mut()
                .for_each(|item| remove_basis_if(item, &basis));
            *section = json!({ "basis": basis, "items": items });
        }
    }
    if let Some(library) = library
        && let Some(ids) = map.get_mut("rules")
    {
        qualify_ids(ids, library);
    }
    component
}

/// The parts of one answer before it is written.
struct Assembled {
    /// Indices of the libraries that answer an entry or own a served pattern, in library order.
    served: Vec<usize>,
    components: Vec<Value>,
    /// `None` when no rule text is sent: `detail: "api"`, or shed.
    rules: Option<Vec<Value>>,
    /// Deduplicated `content.patterns` (amendment A31.5), omitted when empty, `detail: "api"`, or shed.
    patterns: Option<Vec<Value>>,
    unknown: Vec<Value>,
    flagged: usize,
    left_out: usize,
}

struct Brief<'a> {
    libraries: &'a [Library],
    asked: Vec<Asked>,
    /// The requested sections, in the order of section 5.3.
    names: Vec<&'static str>,
    /// Whether the rules' text and shared `content.patterns` are sent at all (not with `detail: "api"`).
    rule_text: bool,
    /// Whether the rules the attributes name are served (`detail: "full"` and `sections`).
    attribute_rules: bool,
    /// Whether `detail: "brief"` chose the sections, so `omitted` names what it leaves out.
    by_default: bool,
    /// Whether `detail: "api"` chose the sections, so `omitted` names omitted pattern content.
    by_api: bool,
    /// Whether `minimum_basis` allows `authored` statements (amendment A31.6).
    serves_authored: bool,
    known: HashSet<String>,
    versions: Map<String, Value>,
    text: bool,
    /// The consumer profile the call uses, by name.
    consumer: Option<String>,
    /// The profile's statements, sent once in every answer and never shed (amendment A28).
    guidance: Guidance,
}

/// The deployment's guidance as an answer carries it: `content.guidance`, when any statement is
/// served, with how many were flagged and how many `minimum_basis` left out.
#[derive(Default)]
struct Guidance {
    block: Option<Value>,
    flagged: usize,
    left_out: usize,
}

impl Guidance {
    /// A deployment's statements are `authored`; a stronger `minimum_basis` leaves them out.
    fn new(selected: Option<&crate::consumer::Selected>, settings: &Settings) -> Self {
        let Some(selected) = selected.filter(|selected| !selected.statements.is_empty()) else {
            return Self::default();
        };
        if !settings.serves("authored") {
            return Self {
                block: None,
                flagged: 0,
                left_out: selected.statements.len(),
            };
        }
        let mut flagged = 0;
        let items: Vec<Value> = selected
            .statements
            .iter()
            .map(|statement| {
                let mut item = Map::new();
                item.insert("id".to_owned(), Value::from(statement.id.as_str()));
                item.insert("text".to_owned(), Value::from(statement.text.as_str()));
                flagged += usize::from(scan::flag_item(&mut item));
                Value::Object(item)
            })
            .collect();
        Self {
            block: Some(json!({
                "consumer": selected.name,
                "basis": "authored",
                "items": items,
            })),
            flagged,
            left_out: 0,
        }
    }

    fn statements(&self) -> usize {
        self.block
            .as_ref()
            .and_then(|block| block["items"].as_array())
            .map_or(0, Vec::len)
    }
}

impl Brief<'_> {
    fn entries(&self, count: usize) -> impl Iterator<Item = (usize, &Entry)> {
        self.asked[..count].iter().filter_map(|asked| match asked {
            Asked::Entry { library, entry, .. } => Some((*library, entry.as_ref())),
            Asked::Unknown(_) => None,
        })
    }

    /// A bare id names a rule only when one library answers; with several, ids are qualified
    /// everywhere in the answer (section 5.4), so only `<library>/<id>` matches.
    fn is_known(&self, library: &str, id: &str, qualify: bool) -> bool {
        (!qualify && self.known.contains(id)) || self.known.contains(&format!("{library}/{id}"))
    }

    /// Resolves `(library_id, pattern_name)` to `(library_index, &PatternRecord)` when loaded.
    fn find_pattern(
        &self,
        library: &str,
        pattern: &str,
    ) -> Option<(usize, &crate::pack::schema_pattern::PatternRecord)> {
        let index = self.libraries.iter().position(|lib| lib.id == library)?;
        let record = self.libraries[index]
            .patterns
            .iter()
            .find(|p| p.pattern == pattern)?;
        Some((index, record))
    }

    /// Unique loaded `(library_index, &PatternRecord)` referenced by the first `count` entries
    /// (in first-referenced order), when `patterns` is in the requested sections.
    fn referenced_patterns(
        &self,
        count: usize,
    ) -> Vec<(usize, &crate::pack::schema_pattern::PatternRecord)> {
        if !self.names.contains(&"patterns") {
            return Vec::new();
        }
        let mut seen: HashSet<(String, String)> = HashSet::new();
        let mut out = Vec::new();
        for (_, entry) in self.entries(count) {
            for (name, section) in &entry.sections {
                if *name != "patterns" {
                    continue;
                }
                if let Section::Patterns(links) = section {
                    for cp in links {
                        if seen.insert((cp.library.clone(), cp.pattern.clone()))
                            && let Some(found) = self.find_pattern(&cp.library, &cp.pattern)
                        {
                            out.push(found);
                        }
                    }
                }
            }
        }
        out
    }

    fn assemble(&self, steps: usize, count: usize) -> Assembled {
        let send_rules = self.rule_text && !ORDER[..steps].contains(&Step::RuleText);
        let send_patterns = self.rule_text
            && self.names.contains(&"patterns")
            && !ORDER[..steps].contains(&Step::PatternKeep);
        let shed_customize = ORDER[..steps].contains(&Step::PatternCustomize);
        let referenced = self.referenced_patterns(count);

        let mut served: Vec<usize> = self.entries(count).map(|(library, _)| library).collect();
        if send_patterns {
            for (owner_index, _) in &referenced {
                served.push(*owner_index);
            }
        }
        served.sort_unstable();
        served.dedup();
        let qualify = served.len() > 1;
        let mut components = Vec::new();
        let mut unknown = Vec::new();
        let mut rules: BTreeMap<(usize, String), Value> = BTreeMap::new();
        let mut flagged = 0;
        let mut left_out = 0;
        for asked in &self.asked[..count] {
            let (index, entry) = match asked {
                Asked::Unknown(value) => {
                    unknown.push(value.clone());
                    continue;
                }
                Asked::Entry { library, entry, .. } => (*library, entry),
            };
            let library = &self.libraries[index];
            let content = entry.serve_with(
                &shed(entry, &self.names, steps, self.attribute_rules),
                qualify,
            );
            let rule_flags = content
                .rules
                .iter()
                .filter(|rule| rule.get("flags").is_some())
                .count();
            flagged += content.flagged - rule_flags;
            left_out += entry.left_out;
            components.push(brief_form(
                content.component,
                qualify.then_some(library.id.as_str()),
            ));
            if !send_rules {
                continue;
            }
            for mut rule in content.rules {
                let id = rule["id"].as_str().unwrap_or_default().to_owned();
                if self.is_known(&library.id, &id, qualify) {
                    continue;
                }
                if qualify {
                    rule["id"] = qualified(&library.id, &rule["id"]);
                }
                rules.entry((index, id)).or_insert(rule);
            }
        }
        let rules = send_rules.then(|| rules.into_values().collect::<Vec<_>>());
        flagged += rules
            .iter()
            .flatten()
            .filter(|r| r.get("flags").is_some())
            .count();

        // Count `minimum_basis` omissions for referenced patterns once per pattern whenever pattern
        // content is active for this request (amendment A31.6).
        if self.rule_text && !self.serves_authored {
            for (_, record) in &referenced {
                left_out += record.keep.iter().filter(|st| st.gate.is_none()).count();
                left_out += record.customize.len();
            }
        }

        let patterns = if send_patterns && !referenced.is_empty() {
            let mut items = Vec::with_capacity(referenced.len());
            for (owner_index, record) in &referenced {
                let owner_id = self.libraries[*owner_index].id.as_str();
                let mut keep = Vec::new();
                for st in &record.keep {
                    if st.gate.is_none() && !self.serves_authored {
                        continue;
                    }
                    let mut obj = Map::new();
                    obj.insert("id".to_owned(), Value::String(st.id.clone()));
                    if !self.is_known(owner_id, &st.id, qualify) {
                        obj.insert("text".to_owned(), Value::String(st.text.clone()));
                        if scan::flag_item(&mut obj) {
                            flagged += 1;
                        }
                    }
                    keep.push(Value::Object(obj));
                }
                let mut customize = Vec::new();
                if self.serves_authored && !shed_customize {
                    for st in &record.customize {
                        let mut obj = Map::new();
                        obj.insert("id".to_owned(), Value::String(st.id.clone()));
                        if !self.is_known(owner_id, &st.id, qualify) {
                            obj.insert("text".to_owned(), Value::String(st.text.clone()));
                            if scan::flag_item(&mut obj) {
                                flagged += 1;
                            }
                        }
                        customize.push(Value::Object(obj));
                    }
                }
                let mut entry = Map::new();
                entry.insert("library".to_owned(), Value::String(owner_id.to_owned()));
                entry.insert("pattern".to_owned(), Value::String(record.pattern.clone()));
                entry.insert("status".to_owned(), Value::String(record.status.clone()));
                if let Some(replaced_by) = &record.replaced_by {
                    entry.insert("replacedBy".to_owned(), Value::String(replaced_by.clone()));
                }
                entry.insert("keep".to_owned(), Value::Array(keep));
                if !customize.is_empty() {
                    entry.insert("customize".to_owned(), Value::Array(customize));
                }
                items.push(Value::Object(entry));
            }
            Some(items)
        } else {
            None
        };

        Assembled {
            served,
            components,
            rules,
            patterns,
            unknown,
            flagged,
            left_out,
        }
    }

    /// What each step of the order takes away from the first `count` requested tags.
    fn effects(&self, count: usize) -> Vec<Effect> {
        ORDER
            .iter()
            .enumerate()
            .map(|(k, step)| {
                let states: Vec<Vec<(&'static str, Section)>> = self
                    .entries(count)
                    .map(|(_, entry)| shed(entry, &self.names, k, self.attribute_rules))
                    .collect();
                let items_of = |name: &str| -> Vec<Value> {
                    states
                        .iter()
                        .flatten()
                        .filter(|(section, _)| *section == name)
                        .filter_map(|(_, section)| match section {
                            Section::Items(items) => Some(items.clone()),
                            _ => None,
                        })
                        .flatten()
                        .collect()
                };
                match step {
                    Step::Sections(list) => Effect {
                        sections: list
                            .iter()
                            .copied()
                            .filter(|name| {
                                states.iter().flatten().any(|(section, _)| section == name)
                            })
                            .collect(),
                        piece: None,
                        patterns: Vec::new(),
                    },
                    Step::EventDetail => Effect {
                        sections: Vec::new(),
                        piece: items_of("events")
                            .iter()
                            .any(|item| item.get("detail").is_some())
                            .then_some("eventDetail"),
                        patterns: Vec::new(),
                    },
                    Step::DeclaredAttributes => Effect {
                        sections: Vec::new(),
                        piece: items_of("attributes")
                            .iter()
                            .any(is_declared_only)
                            .then_some("declaredAttributes"),
                        patterns: Vec::new(),
                    },
                    Step::PatternCustomize => Effect {
                        sections: Vec::new(),
                        piece: None,
                        patterns: if self.rule_text && self.serves_authored {
                            self.referenced_patterns(count)
                                .into_iter()
                                .filter(|(_, record)| !record.customize.is_empty())
                                .map(|(owner, record)| {
                                    (self.libraries[owner].id.clone(), record.pattern.clone())
                                })
                                .collect()
                        } else {
                            Vec::new()
                        },
                    },
                    Step::RuleText => Effect {
                        sections: Vec::new(),
                        piece: self
                            .assemble(k, count)
                            .rules
                            .is_some_and(|rules| !rules.is_empty())
                            .then_some("ruleText"),
                        patterns: Vec::new(),
                    },
                    Step::PatternKeep => Effect {
                        sections: Vec::new(),
                        piece: None,
                        patterns: if self.rule_text {
                            self.referenced_patterns(count)
                                .into_iter()
                                .map(|(owner, record)| {
                                    (self.libraries[owner].id.clone(), record.pattern.clone())
                                })
                                .collect()
                        } else {
                            Vec::new()
                        },
                    },
                }
            })
            .collect()
    }

    /// What `detail` (`"brief"` or `"api"`) leaves out of the first `count` requested tags
    /// (section 6.3 and amendment A31.5).
    fn left_out_by_detail(&self, count: usize) -> Vec<Value> {
        let mut out = Vec::new();
        if self.by_default {
            let mut sections = Vec::new();
            let mut pieces = Vec::new();
            let mut open = Vec::new();
            if self.entries(count).any(|(_, entry)| {
                entry
                    .sections
                    .iter()
                    .any(|(name, _)| *name == "cssProperties")
            }) {
                sections.push("cssProperties");
                open.push("cssProperties");
            }
            if self
                .entries(count)
                .any(|(_, entry)| !entry.attribute_rules.is_empty())
            {
                pieces.push("attributeRules");
                open.push("rules");
            }
            if !open.is_empty() {
                out.push(json!({
                    "reason": "detail",
                    "sections": sections,
                    "pieces": pieces,
                    "open": { "command": "components-open", "sections": open },
                }));
            }
        }
        if self.by_api {
            for (owner_index, record) in self.referenced_patterns(count) {
                let owner_id = &self.libraries[owner_index].id;
                out.push(json!({
                    "reason": "detail",
                    "pattern": format!("{owner_id}/{}", record.pattern),
                    "pieces": ["patterns"],
                    "open": {
                        "command": "components-pattern-open",
                        "library": owner_id,
                        "pattern": record.pattern,
                        "sections": ["keep", "customize"],
                    },
                }));
            }
        }
        out
    }

    fn omitted(
        effects: &[Effect],
        steps: usize,
        left_out: usize,
        by_detail: Vec<Value>,
    ) -> Vec<Value> {
        let mut omitted = Vec::new();
        if left_out > 0 {
            omitted.push(json!({ "reason": "minimum-basis", "facts": left_out }));
        }
        omitted.extend(by_detail);
        let mut sections: Vec<&str> = Vec::new();
        let mut pieces: Vec<&str> = Vec::new();
        let mut open: Vec<&str> = Vec::new();
        // Per-pattern callable budget omissions (amendment A31.5), in shedding order (matching
        // component `open.sections` per A9).
        let mut pattern_omissions: Vec<(String, String, Vec<&'static str>, Vec<&'static str>)> =
            Vec::new();
        for (step, effect) in ORDER.iter().zip(effects).take(steps) {
            if effect.is_empty() {
                continue;
            }
            match step {
                Step::PatternCustomize | Step::PatternKeep => {
                    let (piece, open_section) = if *step == Step::PatternCustomize {
                        ("patternCustomize", "customize")
                    } else {
                        ("patternKeep", "keep")
                    };
                    for (lib, pat) in &effect.patterns {
                        if let Some((_, _, pcs, secs)) = pattern_omissions
                            .iter_mut()
                            .find(|(l, p, _, _)| l == lib && p == pat)
                        {
                            if !pcs.contains(&piece) {
                                pcs.push(piece);
                            }
                            if !secs.contains(&open_section) {
                                secs.push(open_section);
                            }
                        } else {
                            pattern_omissions.push((
                                lib.clone(),
                                pat.clone(),
                                vec![piece],
                                vec![open_section],
                            ));
                        }
                    }
                }
                _ => {
                    sections.extend(&effect.sections);
                    pieces.extend(effect.piece);
                    let opens: &[&str] = if effect.piece.is_some() {
                        step.opens()
                    } else {
                        &effect.sections
                    };
                    for name in opens {
                        if !open.contains(name) {
                            open.push(name);
                        }
                    }
                }
            }
        }
        if !open.is_empty() {
            omitted.push(json!({
                "reason": "budget",
                "sections": sections,
                "pieces": pieces,
                "open": { "command": "components-open", "sections": open },
            }));
        }
        for (lib, pat, pcs, secs) in pattern_omissions {
            omitted.push(json!({
                "reason": "budget",
                "pattern": format!("{lib}/{pat}"),
                "sections": [],
                "pieces": pcs,
                "open": {
                    "command": "components-pattern-open",
                    "library": lib,
                    "pattern": pat,
                    "sections": secs,
                },
            }));
        }
        omitted
    }

    fn build(&self, steps: usize, count: usize, effects: &[Effect]) -> Outcome {
        let assembled = self.assemble(steps, count);
        let libraries: Vec<&Library> = assembled
            .served
            .iter()
            .map(|index| &self.libraries[*index])
            .collect();
        let titles: Vec<(Value, bool)> = libraries.iter().map(|l| content_library(l)).collect();
        let flagged = assembled.flagged
            + titles.iter().filter(|(_, flagged)| *flagged).count()
            + self.guidance.flagged;
        let mut content = json!({
            "trust": "content",
            "libraries": titles.iter().map(|(title, _)| title).collect::<Vec<_>>(),
            "components": assembled.components,
        });
        if let Some(rules) = assembled.rules {
            content["rules"] = Value::Array(rules);
        }
        if let Some(patterns) = assembled.patterns {
            content["patterns"] = Value::Array(patterns);
        }
        if let Some(guidance) = &self.guidance.block {
            content["guidance"] = guidance.clone();
        }
        let mut omitted = Self::omitted(
            effects,
            steps,
            assembled.left_out + self.guidance.left_out,
            self.left_out_by_detail(count),
        );
        let excluded: std::collections::BTreeSet<&str> = self.asked[..count]
            .iter()
            .filter_map(|asked| match asked {
                Asked::Entry { excluded, .. } => Some(excluded),
                Asked::Unknown(_) => None,
            })
            .flatten()
            .map(String::as_str)
            .collect();
        if !excluded.is_empty() {
            omitted.push(
                json!({ "reason": "consumer", "consumer": self.consumer, "rules": excluded }),
            );
        }
        let shed_count = omitted
            .iter()
            .filter(|o| o["reason"] == "budget")
            .map(|o| {
                o["sections"].as_array().map_or(0, Vec::len)
                    + o["pieces"].as_array().map_or(0, Vec::len)
            })
            .sum::<usize>();
        let mut data = json!({
            "libraries": libraries.iter().map(|l| identity(l)).collect::<Vec<_>>(),
            "content": content,
            "unknown": assembled.unknown,
            "omitted": omitted,
        });
        if self.text {
            let text = render::text(&data);
            if let Some(map) = data.as_object_mut() {
                map.remove("content");
                map.insert("text".to_owned(), Value::String(text));
            }
        }
        let answered = data["libraries"].as_array().map_or(0, Vec::len);
        let mut reasoning = format!(
            "Briefed {} component(s) from {answered} library(ies), with {} tag(s) unknown and {shed_count} section(s) or piece(s) left out to fit.",
            assembled.components.len(),
            assembled.unknown.len(),
        );
        let statements = self.guidance.statements();
        if statements > 0 {
            reasoning.push_str(&format!(
                " Carried {statements} statement(s) of the deployment's own guidance."
            ));
        }
        let mut outcome = success(data).with_reasoning(&reasoning);
        for library in &libraries {
            let package = &library.catalog.package;
            if let Some(installed) = self.versions.get(&package.name).and_then(Value::as_str)
                && installed != package.version
            {
                outcome = fail::warn_version(
                    outcome,
                    &library.id,
                    &package.name,
                    installed,
                    &package.version,
                );
            }
        }
        fail::warn_flagged(outcome, flagged)
    }
}

/// What `detail: "brief"`, the default, leaves out (section 6.1): the long form, and the CSS
/// properties no page in step C5 named.
const NOT_BRIEF: [&str; 2] = ["cssProperties", "detail"];

/// What a call asks for: the sections, in the order of section 5.3, whether rule text is sent,
/// and whether the rules the attributes name are served.
struct Chosen {
    names: Vec<&'static str>,
    rule_text: bool,
    attribute_rules: bool,
}

fn chosen_sections(input: &Value) -> Chosen {
    if let Some(names) = input.get("sections").and_then(Value::as_array) {
        let names = SECTIONS
            .into_iter()
            .filter(|name| names.iter().any(|value| value.as_str() == Some(name)))
            .collect();
        return Chosen {
            names,
            rule_text: true,
            attribute_rules: true,
        };
    }
    match input.get("detail").and_then(Value::as_str) {
        Some("api") => Chosen {
            names: API.to_vec(),
            rule_text: false,
            attribute_rules: false,
        },
        Some("full") => Chosen {
            names: SECTIONS.to_vec(),
            rule_text: true,
            attribute_rules: true,
        },
        _ => Chosen {
            names: SECTIONS
                .into_iter()
                .filter(|name| !NOT_BRIEF.contains(name))
                .collect(),
            rule_text: true,
            attribute_rules: false,
        },
    }
}

/// The most bare names whose matches a refusal looks for.
const MAX_BARE_NAMES: usize = 8;

/// A name that would be a tag but for its missing hyphen, such as `breadcrumb`.
fn is_bare_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() < 100
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'.' || *b == b'_')
}

/// When `tags` were refused only for names without a hyphen, the refusal that names the served tags
/// they most likely meant (amendment A26); `None` for any other refusal, or with no pack to read.
fn bare_names(input: &Value, cx: &mut Cx) -> Option<Outcome> {
    let tags: Vec<&str> = input
        .get("tags")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    let bare: Vec<&str> = tags
        .iter()
        .copied()
        .filter(|tag| !crate::pack::patterns::TAG.accepts(tag))
        .collect();
    if bare.is_empty() || !bare.iter().all(|name| is_bare_name(name)) {
        return None;
    }
    if input
        .get("library")
        .and_then(Value::as_str)
        .is_some_and(|id| !crate::pack::patterns::LIBRARY.accepts(id))
    {
        return None;
    }
    let libraries = pack::read(cx, input.get("library").and_then(Value::as_str)).ok()?;
    let mut matches: Vec<String> = Vec::new();
    for name in bare.iter().take(MAX_BARE_NAMES) {
        let mut found: Vec<String> = libraries
            .iter()
            .flat_map(|library| library.catalog.components.iter())
            .map(|component| component.tag.as_str())
            .filter(|tag| tag.ends_with(&format!("-{name}")))
            .map(str::to_owned)
            .collect();
        if found.is_empty() {
            for library in &libraries {
                found.extend(select::nearest(
                    &format!("{}{name}", library.catalog.prefix),
                    library.catalog.components.iter().map(|c| c.tag.as_str()),
                ));
            }
        }
        for tag in found {
            if !matches.contains(&tag) {
                matches.push(tag);
            }
        }
    }
    let prefixes: Vec<String> = libraries
        .iter()
        .map(|library| library.catalog.prefix.clone())
        .collect();
    Some(fail::bare_names(&matches, &prefixes))
}

/// The requested tags: `tags`, then each name `source` asks for not already listed (section 6.2).
fn requested(
    input: &Value,
    libraries: &[Library],
    holders: &HashMap<&str, Vec<usize>>,
) -> Vec<String> {
    let mut requested: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for tag in input
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if seen.insert(tag.to_owned()) {
            requested.push(tag.to_owned());
        }
    }
    if let Some(source) = input.get("source").and_then(Value::as_str) {
        let prefixes: Vec<&str> = libraries
            .iter()
            .map(|library| library.catalog.prefix.as_str())
            .collect();
        for found in select::read_source(source, |tag| holders.contains_key(tag), &prefixes) {
            if seen.insert(found.tag.clone()) {
                requested.push(found.tag);
            }
        }
    }
    requested
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_brief(input) {
        return bare_names(input, cx).unwrap_or(outcome);
    }
    let settings = Settings::load(cx);
    let selected = match crate::consumer::load(input, settings.default_consumer.as_deref(), cx) {
        Ok(selected) => selected,
        Err(outcome) => return outcome,
    };
    let excluded = selected
        .as_ref()
        .map(|selected| selected.excluded.clone())
        .unwrap_or_default();
    let library = input.get("library").and_then(Value::as_str);
    let libraries = match pack::read(cx, library) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };
    let mut holders: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, library) in libraries.iter().enumerate() {
        for component in &library.catalog.components {
            holders
                .entry(component.tag.as_str())
                .or_default()
                .push(index);
        }
    }
    let requested = requested(input, &libraries, &holders);
    if requested.len() > MAX_TAGS {
        return fail::too_many_tags(requested.len());
    }

    let names: Vec<String> = libraries.iter().map(|l| l.id.clone()).collect();
    let mut asked = Vec::new();
    for tag in &requested {
        let holding = holders.get(tag.as_str()).map_or(&[][..], Vec::as_slice);
        let chosen = match holding {
            [] => None,
            [one] => Some(*one),
            several => match settings.default_library.as_deref() {
                Some(default) if !names.iter().any(|name| name == default) => {
                    return fail::library_not_found(default, &names);
                }
                Some(default) => several
                    .iter()
                    .copied()
                    .find(|index| libraries[*index].id == default),
                None => None,
            },
        };
        let answer = match chosen {
            Some(index) => {
                let library = &libraries[index];
                let record = library.records.iter().find(|record| &record.tag == tag);
                record.map(|record| {
                    let mut entry = entry::build(library, record, &settings);
                    let excluded = entry.exclude_rules(&library.id, &excluded);
                    Asked::Entry {
                        library: index,
                        entry: Box::new(entry),
                        excluded,
                    }
                })
            }
            None => None,
        };
        asked.push(answer.unwrap_or_else(|| {
            if holding.len() > 1 {
                let holders: Vec<&str> =
                    holding.iter().map(|i| libraries[*i].id.as_str()).collect();
                Asked::Unknown(json!({ "tag": tag, "reason": "ambiguous", "libraries": holders }))
            } else {
                let nearest = select::nearest(
                    tag,
                    libraries.iter().flat_map(|library| {
                        library.catalog.components.iter().map(|c| c.tag.as_str())
                    }),
                );
                Asked::Unknown(json!({ "tag": tag, "reason": "not-found", "nearest": nearest }))
            }
        }));
    }

    let Chosen {
        names,
        rule_text,
        attribute_rules,
    } = chosen_sections(input);
    let brief = Brief {
        consumer: selected.as_ref().map(|selected| selected.name.clone()),
        guidance: Guidance::new(selected.as_ref(), &settings),
        libraries: &libraries,
        asked,
        names,
        rule_text,
        attribute_rules,
        by_default: input.get("sections").is_none()
            && !matches!(
                input.get("detail").and_then(Value::as_str),
                Some("api" | "full")
            ),
        by_api: input.get("sections").is_none()
            && input.get("detail").and_then(Value::as_str) == Some("api"),
        serves_authored: settings.serves("authored"),
        known: input
            .get("known")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        versions: input
            .get("versions")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        text: input.get("render").and_then(Value::as_str) == Some("text"),
    };

    let budget = cx.call().output_budget;
    let target = match (budget, input.get("maxBytes").and_then(Value::as_u64)) {
        (Some(budget), Some(max)) => Some(budget.min(max)),
        (budget, max) => budget.or(max),
    };
    let total = brief.asked.len();
    let effects = brief.effects(total);
    let mut steps = 0;
    let mut outcome = brief.build(steps, total, &effects);
    while !fits(&outcome, target) {
        if steps == ORDER.len() {
            let fitting = fit_count(total, target, |count| {
                brief.build(ORDER.len(), count, &brief.effects(count))
            });
            return fail::brief_budget_exceeded(fitting, brief.guidance.statements());
        }
        steps += 1;
        // A step that takes nothing away leaves the answer as it was, except the rule-text step,
        // which also drops an empty `content.rules`.
        if effects[steps - 1].is_empty() && ORDER[steps - 1] != Step::RuleText {
            continue;
        }
        outcome = brief.build(steps, total, &effects);
    }
    let entries = brief.entries(total).count();
    cx.log(
        Level::Info,
        &format!(
            "components-brief: {entries} answered, {} unknown, {steps} shedding step(s) applied",
            total - entries
        ),
    );
    outcome
}
