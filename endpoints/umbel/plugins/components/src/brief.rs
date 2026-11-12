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

/// The sections `detail: "api"` serves; `rules` as ids only.
const API: [&str; 7] = [
    "attributes",
    "slots",
    "events",
    "commands",
    "cssProperties",
    "form",
    "rules",
];

/// One step of the shedding order (section 6.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    /// Whole sections, from every entry at once.
    Sections(&'static [&'static str]),
    /// Each event's `detail`.
    EventDetail,
    /// Attributes whose basis is `declared` and that have no `values`.
    DeclaredAttributes,
    /// `content.rules`; the ids stay in each entry.
    RuleText,
}

const ORDER: [Step; 13] = [
    Step::Sections(&["detail"]),
    Step::Sections(&["examples"]),
    Step::Sections(&["cssProperties"]),
    Step::EventDetail,
    Step::DeclaredAttributes,
    Step::Sections(&["usage"]),
    Step::Sections(&["events", "commands"]),
    Step::Sections(&["form", "roles", "axe"]),
    Step::Sections(&["slots"]),
    Step::RuleText,
    Step::Sections(&["a11y"]),
    Step::Sections(&["attributes"]),
    Step::Sections(&["themes", "gaps", "rules"]),
];

impl Step {
    /// The section `components-open` returns a piece from.
    fn opens(self) -> &'static [&'static str] {
        match self {
            Self::Sections(names) => names,
            Self::EventDetail => &["events"],
            Self::DeclaredAttributes => &["attributes"],
            Self::RuleText => &["rules"],
        }
    }
}

/// What one step of the order took away, from the requested tags answered so far.
#[derive(Debug, Clone, Default)]
struct Effect {
    sections: Vec<&'static str>,
    piece: Option<&'static str>,
}

impl Effect {
    fn is_empty(&self) -> bool {
        self.sections.is_empty() && self.piece.is_none()
    }
}

/// One requested tag's answer.
enum Asked {
    Entry { library: usize, entry: Box<Entry> },
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

/// An entry's requested sections with the first `steps` of the order applied; a section left
/// empty is left out.
fn shed(entry: &Entry, names: &[&str], steps: usize) -> Vec<(&'static str, Section)> {
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
                ("attributes", Section::Items(items))
                    if applied.contains(&Step::DeclaredAttributes) =>
                {
                    Section::Items(
                        items
                            .iter()
                            .filter(|item| !is_declared_only(item))
                            .cloned()
                            .collect(),
                    )
                }
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
    /// Indices of the libraries that answer an entry, in library order.
    served: Vec<usize>,
    components: Vec<Value>,
    /// `None` when no rule text is sent: `detail: "api"`, or shed.
    rules: Option<Vec<Value>>,
    unknown: Vec<Value>,
    flagged: usize,
    left_out: usize,
}

struct Brief<'a> {
    libraries: &'a [Library],
    asked: Vec<Asked>,
    /// The requested sections, in the order of section 5.3.
    names: Vec<&'static str>,
    /// Whether the rules' text is sent at all (not with `detail: "api"`).
    rule_text: bool,
    known: HashSet<String>,
    versions: Map<String, Value>,
    text: bool,
}

impl Brief<'_> {
    fn entries(&self, count: usize) -> impl Iterator<Item = (usize, &Entry)> {
        self.asked[..count].iter().filter_map(|asked| match asked {
            Asked::Entry { library, entry } => Some((*library, entry.as_ref())),
            Asked::Unknown(_) => None,
        })
    }

    /// A bare id names a rule only when one library answers; with several, ids are qualified
    /// everywhere in the answer (section 5.4), so only `<library>/<id>` matches.
    fn is_known(&self, library: &str, id: &str, qualify: bool) -> bool {
        (!qualify && self.known.contains(id)) || self.known.contains(&format!("{library}/{id}"))
    }

    fn assemble(&self, steps: usize, count: usize) -> Assembled {
        let mut served: Vec<usize> = self.entries(count).map(|(library, _)| library).collect();
        served.sort_unstable();
        served.dedup();
        let qualify = served.len() > 1;
        let send_rules = self.rule_text && !ORDER[..steps].contains(&Step::RuleText);
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
                Asked::Entry { library, entry } => (*library, entry),
            };
            let library = &self.libraries[index];
            let content = entry.serve(&shed(entry, &self.names, steps));
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
        Assembled {
            served,
            components,
            rules,
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
                    .map(|(_, entry)| shed(entry, &self.names, k))
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
                    },
                    Step::EventDetail => Effect {
                        sections: Vec::new(),
                        piece: items_of("events")
                            .iter()
                            .any(|item| item.get("detail").is_some())
                            .then_some("eventDetail"),
                    },
                    Step::DeclaredAttributes => Effect {
                        sections: Vec::new(),
                        piece: items_of("attributes")
                            .iter()
                            .any(is_declared_only)
                            .then_some("declaredAttributes"),
                    },
                    Step::RuleText => Effect {
                        sections: Vec::new(),
                        piece: self
                            .assemble(k, count)
                            .rules
                            .is_some_and(|rules| !rules.is_empty())
                            .then_some("ruleText"),
                    },
                }
            })
            .collect()
    }

    fn omitted(effects: &[Effect], steps: usize, left_out: usize) -> Vec<Value> {
        let mut omitted = Vec::new();
        if left_out > 0 {
            omitted.push(json!({ "reason": "minimum-basis", "facts": left_out }));
        }
        let mut sections: Vec<&str> = Vec::new();
        let mut pieces: Vec<&str> = Vec::new();
        let mut open: Vec<&str> = Vec::new();
        for (step, effect) in ORDER.iter().zip(effects).take(steps) {
            if effect.is_empty() {
                continue;
            }
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
        if !open.is_empty() {
            omitted.push(json!({
                "reason": "budget",
                "sections": sections,
                "pieces": pieces,
                "open": { "command": "components-open", "sections": open },
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
        let flagged = assembled.flagged + titles.iter().filter(|(_, flagged)| *flagged).count();
        let mut content = json!({
            "trust": "content",
            "libraries": titles.iter().map(|(title, _)| title).collect::<Vec<_>>(),
            "components": assembled.components,
        });
        if let Some(rules) = assembled.rules {
            content["rules"] = Value::Array(rules);
        }
        let omitted = Self::omitted(effects, steps, assembled.left_out);
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
        let mut outcome = success(data).with_reasoning(&format!(
            "Briefed {} component(s) from {answered} library(ies), with {} tag(s) unknown and {shed_count} section(s) or piece(s) left out to fit.",
            assembled.components.len(),
            assembled.unknown.len(),
        ));
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

/// The sections a call asks for, in the order of section 5.3, and whether rule text is sent.
fn chosen_sections(input: &Value) -> (Vec<&'static str>, bool) {
    if let Some(names) = input.get("sections").and_then(Value::as_array) {
        let chosen = SECTIONS
            .into_iter()
            .filter(|name| names.iter().any(|value| value.as_str() == Some(name)))
            .collect();
        return (chosen, true);
    }
    match input.get("detail").and_then(Value::as_str) {
        Some("api") => (API.to_vec(), false),
        Some("full") => (SECTIONS.to_vec(), true),
        _ => (
            SECTIONS
                .into_iter()
                .filter(|name| *name != "detail")
                .collect(),
            true,
        ),
    }
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
        return outcome;
    }
    let settings = Settings::load(cx);
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
                record.map(|record| Asked::Entry {
                    library: index,
                    entry: Box::new(entry::build(library, record, &settings)),
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

    let (names, rule_text) = chosen_sections(input);
    let brief = Brief {
        libraries: &libraries,
        asked,
        names,
        rule_text,
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
            return fail::brief_budget_exceeded(fitting);
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
