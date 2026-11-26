//! `components-pattern-open` (specification, amendments A31.4, A31.6, A31.9): one pattern record
//! with its guidance, setups, portable gates and owning-library-first aggregated implementations
//! across all libraries in the space.

use std::collections::HashSet;

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::fit::{fit_count, fits};
use crate::list::{content_library, identity};
use crate::pack::aggregate::{AggregatedImplementation, aggregate_implementations};
use crate::pack::schema_pattern::{
    PatternRecord, PatternStatement, effective_approval, is_visible_approval,
};
use crate::pack::{self, Library};
use crate::{Settings, fail, input, scan, select};

/// Default sections in canonical order (amendment A31.4; `source` is Slice 2).
const DEFAULT_SECTIONS: [&str; 5] = ["keep", "customize", "setups", "gates", "implementations"];

/// One prepared pattern section.
#[derive(Debug, Clone)]
enum Section {
    /// Array of statements (`keep`, `customize`).
    Statements(Vec<(Value, bool)>),
    /// Map of `setupName -> setupObject`.
    Setups(Vec<(String, Value, bool)>),
    /// Paginated map of `gateName -> gateObject`, in ascending gate-id key order.
    Gates(Vec<(String, Value, bool)>),
    /// Paginated array of aggregated implementations, each carrying its contributing library id
    /// and its count of flagged sub-items.
    Implementations(Vec<(String, Value, usize)>),
}

impl Section {
    /// Length if this section supports `skip` pagination (`gates` or `implementations`).
    fn paginated_len(&self) -> Option<usize> {
        match self {
            Self::Gates(entries) => Some(entries.len()),
            Self::Implementations(entries) => Some(entries.len()),
            Self::Statements(_) | Self::Setups(_) => None,
        }
    }

    /// Window for a paginated section.
    fn window(&self, skip: usize, count: usize) -> Self {
        match self {
            Self::Gates(entries) => {
                Self::Gates(entries.iter().skip(skip).take(count).cloned().collect())
            }
            Self::Implementations(entries) => {
                Self::Implementations(entries.iter().skip(skip).take(count).cloned().collect())
            }
            other => other.clone(),
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Self::Statements(items) => Value::Array(items.iter().map(|(v, _)| v.clone()).collect()),
            Self::Setups(entries) | Self::Gates(entries) => {
                let mut map = Map::new();
                for (key, value, _) in entries {
                    map.insert(key.clone(), value.clone());
                }
                Value::Object(map)
            }
            Self::Implementations(entries) => {
                Value::Array(entries.iter().map(|(_, v, _)| v.clone()).collect())
            }
        }
    }

    fn flagged(&self) -> usize {
        match self {
            Self::Statements(items) => items.iter().filter(|(_, f)| *f).count(),
            Self::Setups(entries) | Self::Gates(entries) => {
                entries.iter().filter(|(_, _, f)| *f).count()
            }
            Self::Implementations(entries) => entries.iter().map(|(_, _, f)| *f).sum(),
        }
    }
}

/// Which of a pattern's sections one build serves.
#[derive(Clone, Copy)]
enum Take {
    Sections(usize),
    Items(usize),
}

/// Locates the owning library and `PatternRecord` for `pattern`, filtering by `approvalStatus`.
fn locate<'a>(
    libraries: &'a [Library],
    pattern: &str,
    requested_library: Option<&str>,
    settings: &Settings,
    include_proposed: bool,
) -> Result<(&'a Library, &'a PatternRecord), Outcome> {
    let visible = |record: &&PatternRecord| {
        is_visible_approval(record.approval_status.as_deref(), include_proposed)
    };
    if let Some(lib_id) = requested_library {
        let Some(library) = libraries.iter().find(|l| l.id == lib_id) else {
            let names: Vec<String> = libraries.iter().map(|l| l.id.clone()).collect();
            return Err(fail::library_not_found(lib_id, &names));
        };
        return library
            .patterns
            .iter()
            .filter(visible)
            .find(|record| record.pattern == pattern)
            .map(|record| (library, record))
            .ok_or_else(|| {
                fail::pattern_not_found(
                    pattern,
                    &select::nearest(
                        pattern,
                        library
                            .patterns
                            .iter()
                            .filter(visible)
                            .map(|r| r.pattern.as_str()),
                    ),
                )
            });
    }

    let holders: Vec<(&Library, &PatternRecord)> = libraries
        .iter()
        .filter_map(|library| {
            library
                .patterns
                .iter()
                .filter(visible)
                .find(|record| record.pattern == pattern)
                .map(|record| (library, record))
        })
        .collect();
    match holders.as_slice() {
        [] => Err(fail::pattern_not_found(
            pattern,
            &select::nearest(
                pattern,
                libraries.iter().flat_map(|library| {
                    library
                        .patterns
                        .iter()
                        .filter(visible)
                        .map(|r| r.pattern.as_str())
                }),
            ),
        )),
        [one] => Ok(*one),
        several => {
            let Some(default) = settings.default_library.as_deref() else {
                return Err(ambiguous(pattern, several));
            };
            if !libraries.iter().any(|library| library.id == default) {
                let names: Vec<String> = libraries.iter().map(|l| l.id.clone()).collect();
                return Err(fail::library_not_found(default, &names));
            }
            several
                .iter()
                .find(|(library, _)| library.id == default)
                .copied()
                .ok_or_else(|| ambiguous(pattern, several))
        }
    }
}

fn ambiguous(pattern: &str, holders: &[(&Library, &PatternRecord)]) -> Outcome {
    let names: Vec<String> = holders.iter().map(|(l, _)| l.id.clone()).collect();
    fail::pattern_ambiguous(pattern, &names)
}

fn requested_sections(input: &Value) -> Vec<&'static str> {
    let Some(names) = input.get("sections").and_then(Value::as_array) else {
        return DEFAULT_SECTIONS.to_vec();
    };
    DEFAULT_SECTIONS
        .into_iter()
        .filter(|name| names.iter().any(|value| value.as_str() == Some(name)))
        .collect()
}

fn statement_value(st: &PatternStatement) -> (Value, bool) {
    let mut map = Map::new();
    map.insert("id".to_owned(), Value::String(st.id.clone()));
    map.insert("text".to_owned(), Value::String(st.text.clone()));
    if effective_approval(st.approval_status.as_deref()) == "proposed" {
        map.insert(
            "approvalStatus".to_owned(),
            Value::String("proposed".to_owned()),
        );
    }
    let flagged = scan::flag_item(&mut map);
    (Value::Object(map), flagged)
}

fn matches_implementation(item: &AggregatedImplementation, filter: &str) -> bool {
    match filter.split_once('/') {
        Some((lib, target)) => item.library == lib && item.item_name() == target,
        None => item.item_name() == filter,
    }
}

/// Builds one `implementations[]` entry, enforcing A31.6 `minimum_basis`, `approvalStatus`
/// visibility, and D153 flagging. Returns `(library_id, json_value, flagged_count, left_out_count)`.
fn build_implementation(
    item: &AggregatedImplementation,
    serves_authored: bool,
    hidden_keep_ids: &HashSet<&str>,
) -> (String, Value, usize, usize) {
    let mut flagged = 0usize;
    let mut left_out = 0usize;
    let mut map = Map::new();
    map.insert("library".to_owned(), Value::String(item.library.clone()));
    map.insert("kind".to_owned(), Value::String(item.kind.to_owned()));
    if let Some(tag) = &item.tag {
        map.insert("tag".to_owned(), Value::String(tag.clone()));
    }
    if let Some(name) = &item.name {
        map.insert("name".to_owned(), Value::String(name.clone()));
    }
    map.insert("linkage".to_owned(), Value::String(item.linkage.to_owned()));
    map.insert("status".to_owned(), Value::String(item.status.clone()));
    if effective_approval(item.approval_status.as_deref()) == "proposed" {
        map.insert(
            "approvalStatus".to_owned(),
            Value::String("proposed".to_owned()),
        );
    }
    if let Some(replaced_by) = &item.replaced_by {
        map.insert("replacedBy".to_owned(), Value::String(replaced_by.clone()));
    }
    if let Some(contexts) = &item.contexts {
        let mut ctx_val = json!(contexts);
        if ctx_val.as_object_mut().is_some_and(scan::flag_item) {
            flagged += 1;
        }
        map.insert("contexts".to_owned(), ctx_val);
    }
    let mut keep_items = Vec::new();
    for entry in &item.keep {
        if hidden_keep_ids.contains(entry.id.as_str()) {
            continue;
        }
        // A31.6: `verified` and `out-of-context` always stay visible at every `minimum_basis`;
        // `ungated` carries `authored` strength and is omitted when `minimum_basis > authored`.
        if entry.basis == "ungated" && !serves_authored {
            left_out += 1;
            continue;
        }
        let mut k = Map::new();
        k.insert("id".to_owned(), Value::String(entry.id.clone()));
        k.insert("basis".to_owned(), Value::String(entry.basis.clone()));
        if let Some(reason) = &entry.reason {
            k.insert("reason".to_owned(), Value::String(reason.clone()));
        }
        if scan::flag_item(&mut k) {
            flagged += 1;
        }
        keep_items.push(Value::Object(k));
    }
    map.insert("keep".to_owned(), Value::Array(keep_items));
    (item.library.clone(), Value::Object(map), flagged, left_out)
}

struct Answer<'a> {
    all_libraries: &'a [Library],
    owning_library: &'a Library,
    pattern_name: &'a str,
    implementation_filter: Option<&'a str>,
    include_proposed: bool,
    floor: Map<String, Value>,
    floor_flagged: usize,
    left_out: usize,
    sections: Vec<(&'static str, Section)>,
    skip: usize,
}

impl Answer<'_> {
    fn open_call(&self, sections: &[&str], skip: Option<usize>) -> Value {
        let mut call = Map::new();
        call.insert(
            "command".to_owned(),
            Value::String("components-pattern-open".to_owned()),
        );
        call.insert(
            "library".to_owned(),
            Value::String(self.owning_library.id.clone()),
        );
        call.insert(
            "pattern".to_owned(),
            Value::String(self.pattern_name.to_owned()),
        );
        call.insert("sections".to_owned(), json!(sections));
        if let Some(imp) = self.implementation_filter {
            call.insert("implementation".to_owned(), Value::String(imp.to_owned()));
        }
        if let Some(skip) = skip {
            call.insert("skip".to_owned(), Value::from(skip));
        }
        if self.include_proposed {
            call.insert("includeProposed".to_owned(), Value::Bool(true));
        }
        Value::Object(call)
    }

    fn omission(&self, sections: &[&str]) -> Value {
        json!({
            "reason": "budget",
            "sections": sections,
            "open": self.open_call(sections, None),
        })
    }

    fn partial_omission(&self, section: &str, served: usize) -> Value {
        json!({
            "reason": "budget",
            "sections": [section],
            "skip": served,
            "open": self.open_call(&[section], Some(served)),
        })
    }

    fn build(&self, take: Take) -> Outcome {
        let (served, mut omitted, count_note) = match take {
            Take::Sections(count) => {
                let rest: Vec<&str> = self.sections[count..].iter().map(|(n, _)| *n).collect();
                let omitted = if rest.is_empty() {
                    Vec::new()
                } else {
                    vec![self.omission(&rest)]
                };
                (self.sections[..count].to_vec(), omitted, count)
            }
            Take::Items(count) => {
                let (name, section) = &self.sections[0];
                let window = section.window(0, count);
                let mut omitted = vec![self.partial_omission(name, self.skip + count)];
                let rest: Vec<&str> = self.sections[1..].iter().map(|(n, _)| *n).collect();
                if !rest.is_empty() {
                    omitted.push(self.omission(&rest));
                }
                (vec![(*name, window)], omitted, 1)
            }
        };

        if self.left_out > 0 {
            omitted.insert(
                0,
                json!({ "reason": "minimum-basis", "facts": self.left_out }),
            );
        }

        let mut pattern_obj = self.floor.clone();
        let mut flagged = self.floor_flagged;
        let mut contributing: HashSet<&str> = HashSet::new();
        contributing.insert(self.owning_library.id.as_str());

        for (name, section) in &served {
            if let Section::Implementations(entries) = section {
                for (lib_id, _, _) in entries {
                    contributing.insert(lib_id.as_str());
                }
            }
            flagged += section.flagged();
            pattern_obj.insert((*name).to_owned(), section.to_json());
        }

        let mut identities = Vec::new();
        let mut content_libs = Vec::new();
        for lib in self.all_libraries {
            if contributing.contains(lib.id.as_str()) {
                identities.push(identity(lib));
                let (title, title_flagged) = content_library(lib);
                content_libs.push(title);
                flagged += usize::from(title_flagged);
            }
        }

        let outcome = success(json!({
            "libraries": identities,
            "content": {
                "trust": "content",
                "libraries": content_libs,
                "pattern": Value::Object(pattern_obj),
            },
            "omitted": omitted,
        }))
        .with_reasoning(&format!(
            "Opened pattern `{}` with {count_note} of {} section(s).",
            self.pattern_name,
            self.sections.len()
        ));
        fail::warn_flagged(outcome, flagged)
    }
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_pattern_open(input) {
        return outcome;
    }
    let settings = Settings::load(cx);
    let serves_authored = settings.serves("authored");
    let pattern_name = input
        .get("pattern")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let requested_library = input.get("library").and_then(Value::as_str);
    let implementation_filter = input.get("implementation").and_then(Value::as_str);
    let include_proposed = input
        .get("includeProposed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let names = requested_sections(input);
    let skip = input
        .get("skip")
        .and_then(Value::as_u64)
        .map(|n| n as usize);

    // Read all libraries in the space when `implementations` is requested (or `library` is
    // omitted) so cross-library implementations (amendment A31.1 & A31.4) are aggregated even
    // when `library` disambiguates the pattern's owner. When `library` is given and
    // `implementations` is not requested, read only that library so an unrelated broken library
    // does not block opening it.
    let read_scope = if names.contains(&"implementations") {
        None
    } else {
        requested_library
    };
    let libraries = match pack::read(cx, read_scope) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };
    let (owning_library, record) = match locate(
        &libraries,
        pattern_name,
        requested_library,
        &settings,
        include_proposed,
    ) {
        Ok(found) => found,
        Err(outcome) => return outcome,
    };

    // Build the pattern floor (with A31.6 `minimum_basis` applied to `useWhen` and `avoidWhen`).
    let mut left_out = 0usize;
    let mut floor_flagged = 0usize;
    let mut floor = Map::new();
    floor.insert(
        "library".to_owned(),
        Value::String(owning_library.id.clone()),
    );
    floor.insert("pattern".to_owned(), Value::String(record.pattern.clone()));
    if let Some(summary) = &record.summary {
        floor.insert("summary".to_owned(), Value::String(summary.clone()));
        let summary_flags = scan::text_flags(summary);
        if !summary_flags.is_empty() {
            floor.insert(
                "flags".to_owned(),
                Value::from(scan::ordered(&summary_flags)),
            );
            floor_flagged += 1;
        }
    }
    floor.insert("status".to_owned(), Value::String(record.status.clone()));
    floor.insert(
        "approvalStatus".to_owned(),
        Value::String(effective_approval(record.approval_status.as_deref()).to_owned()),
    );
    if let Some(derived) = &record.derived_from {
        floor.insert("derivedFrom".to_owned(), json!(derived));
    }
    if !record.waived_keep.is_empty() {
        let mut waived_items = Vec::with_capacity(record.waived_keep.len());
        for w in &record.waived_keep {
            let mut m = Map::new();
            m.insert("id".to_owned(), Value::String(w.id.clone()));
            m.insert("reason".to_owned(), Value::String(w.reason.clone()));
            if scan::flag_item(&mut m) {
                floor_flagged += 1;
            }
            waived_items.push(Value::Object(m));
        }
        floor.insert("waivedKeep".to_owned(), Value::Array(waived_items));
    }
    if let Some(replaced_by) = &record.replaced_by {
        floor.insert("replacedBy".to_owned(), Value::String(replaced_by.clone()));
    }
    floor.insert("scope".to_owned(), Value::String(record.scope.clone()));
    floor.insert("facets".to_owned(), json!(record.facets));

    let visible_use_when: Vec<&PatternStatement> = record
        .use_when
        .iter()
        .filter(|st| is_visible_approval(st.approval_status.as_deref(), include_proposed))
        .collect();
    let visible_avoid_when: Vec<&PatternStatement> = record
        .avoid_when
        .iter()
        .filter(|st| is_visible_approval(st.approval_status.as_deref(), include_proposed))
        .collect();
    if serves_authored {
        if !visible_use_when.is_empty() {
            let items: Vec<Value> = visible_use_when
                .iter()
                .map(|st| {
                    let (v, f) = statement_value(st);
                    floor_flagged += usize::from(f);
                    v
                })
                .collect();
            floor.insert("useWhen".to_owned(), Value::Array(items));
        }
        if !visible_avoid_when.is_empty() {
            let items: Vec<Value> = visible_avoid_when
                .iter()
                .map(|st| {
                    let (v, f) = statement_value(st);
                    floor_flagged += usize::from(f);
                    v
                })
                .collect();
            floor.insert("avoidWhen".to_owned(), Value::Array(items));
        }
    } else {
        left_out += visible_use_when.len() + visible_avoid_when.len();
    }

    // Build requested sections in canonical order.
    let mut sections: Vec<(&'static str, Section)> = Vec::new();
    for name in &names {
        match *name {
            "keep" => {
                let mut items = Vec::new();
                for st in &record.keep {
                    if !is_visible_approval(st.approval_status.as_deref(), include_proposed) {
                        continue;
                    }
                    // A31.6: gated `keep` statements stay at every `minimum_basis`; ungated ones
                    // carry `authored` strength.
                    if st.gate.is_none() && !serves_authored {
                        left_out += 1;
                        continue;
                    }
                    let mut map = Map::new();
                    map.insert("id".to_owned(), Value::String(st.id.clone()));
                    map.insert("text".to_owned(), Value::String(st.text.clone()));
                    if let Some(gate) = &st.gate {
                        map.insert("gate".to_owned(), Value::String(gate.clone()));
                    }
                    if effective_approval(st.approval_status.as_deref()) == "proposed" {
                        map.insert(
                            "approvalStatus".to_owned(),
                            Value::String("proposed".to_owned()),
                        );
                    }
                    let f = scan::flag_item(&mut map);
                    items.push((Value::Object(map), f));
                }
                if !items.is_empty() {
                    sections.push(("keep", Section::Statements(items)));
                }
            }
            "customize" => {
                let visible_customize: Vec<&PatternStatement> = record
                    .customize
                    .iter()
                    .filter(|st| {
                        is_visible_approval(st.approval_status.as_deref(), include_proposed)
                    })
                    .collect();
                if !serves_authored {
                    left_out += visible_customize.len();
                } else if !visible_customize.is_empty() {
                    let items: Vec<(Value, bool)> =
                        visible_customize.into_iter().map(statement_value).collect();
                    sections.push(("customize", Section::Statements(items)));
                }
            }
            "setups" => {
                if !record.setups.is_empty() {
                    let entries = record
                        .setups
                        .iter()
                        .map(|(k, v)| {
                            let mut val = v.clone();
                            let f = val.as_object_mut().is_some_and(scan::flag_item);
                            (k.clone(), val, f)
                        })
                        .collect();
                    sections.push(("setups", Section::Setups(entries)));
                }
            }
            "gates" => {
                if !record.gates.is_empty() {
                    let entries = record
                        .gates
                        .iter()
                        .map(|(k, v)| {
                            let mut val = v.clone();
                            let f = val.as_object_mut().is_some_and(scan::flag_item);
                            (k.clone(), val, f)
                        })
                        .collect();
                    sections.push(("gates", Section::Gates(entries)));
                }
            }
            "implementations" => {
                let hidden_keep_ids: HashSet<&str> = record
                    .keep
                    .iter()
                    .filter(|st| {
                        !is_visible_approval(st.approval_status.as_deref(), include_proposed)
                    })
                    .map(|st| st.id.as_str())
                    .collect();
                let aggregated = aggregate_implementations(&libraries);
                let raw = aggregated
                    .get(&(owning_library.id.clone(), record.pattern.clone()))
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let mut entries = Vec::new();
                for item in raw {
                    if !is_visible_approval(item.approval_status.as_deref(), include_proposed) {
                        continue;
                    }
                    if let Some(filter) = implementation_filter
                        && !matches_implementation(item, filter)
                    {
                        continue;
                    }
                    let (lib_id, val, f, dropped) =
                        build_implementation(item, serves_authored, &hidden_keep_ids);
                    left_out += dropped;
                    entries.push((lib_id, val, f));
                }
                if !entries.is_empty() || skip.unwrap_or(0) == 0 {
                    sections.push(("implementations", Section::Implementations(entries)));
                }
            }
            _ => {}
        }
    }

    if let Some(skip) = skip
        && skip > 0
        && let Some((name, section)) = sections.first()
    {
        let name = *name;
        let rest = section.window(skip, usize::MAX);
        sections = if rest.paginated_len().is_some_and(|len| len > 0) {
            vec![(name, rest)]
        } else {
            Vec::new()
        };
    }

    let answer = Answer {
        all_libraries: &libraries,
        owning_library,
        pattern_name,
        implementation_filter,
        include_proposed,
        floor,
        floor_flagged,
        left_out,
        sections,
        skip: skip.unwrap_or(0),
    };

    let budget = cx.call().output_budget;
    let total = answer.sections.len();
    let whole = answer.build(Take::Sections(total));
    if fits(&whole, budget) {
        cx.log(
            Level::Info,
            &format!(
                "components-pattern-open: {} sections of {}",
                total, pattern_name
            ),
        );
        return whole;
    }
    if !fits(&answer.build(Take::Sections(0)), budget) {
        return fail::budget_exceeded();
    }
    let mut count = 0;
    while count + 1 < total && fits(&answer.build(Take::Sections(count + 1)), budget) {
        count += 1;
    }
    let chosen = if count > 0 || total == 0 {
        Take::Sections(count)
    } else {
        // The first requested section did not fit alone: paginate it if it is `gates` or
        // `implementations`.
        let Some(items) = answer.sections[0].1.paginated_len() else {
            return fail::budget_exceeded();
        };
        let kept = fit_count(items, budget, |n| answer.build(Take::Items(n)));
        if kept == 0 {
            return fail::budget_exceeded();
        }
        Take::Items(kept)
    };
    cx.log(
        Level::Info,
        &format!(
            "components-pattern-open: {} sections of {}",
            answer.sections.len(),
            pattern_name
        ),
    );
    answer.build(chosen)
}
