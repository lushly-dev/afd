//! `components-pattern-list` (specification, amendment A31.3): list patterns across the space's
//! libraries with their facets and owning-library-first aggregated implementations.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::fit::{fit_count, fits};
use crate::list::{content_library, identity};
use crate::pack::aggregate::{AggregatedImplementation, aggregate_implementations};
use crate::pack::schema_pattern::CatalogPatternEntry;
use crate::pack::{self, Library};
use crate::{fail, input, scan};

struct Row<'a> {
    library: &'a str,
    entry: &'a CatalogPatternEntry,
    value: Value,
    flagged: bool,
}

/// The cursor a bare or `<library>/<pattern>` `after` names.
fn cursor<'a>(after: &'a str, listed: &'a [Library]) -> (&'a str, &'a str) {
    if let Some((library, pattern)) = after.split_once('/') {
        return (library, pattern);
    }
    let holder = listed.iter().find(|library| {
        library
            .catalog
            .patterns
            .iter()
            .any(|entry| entry.pattern == after)
    });
    let library = holder.or(listed.first()).map_or("", |lib| lib.id.as_str());
    (library, after)
}

/// Compact implementation summary in `components-pattern-list` (amendment A31.3).
fn list_implementation(item: &AggregatedImplementation) -> Value {
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
    if let Some(replaced_by) = &item.replaced_by {
        map.insert("replacedBy".to_owned(), Value::String(replaced_by.clone()));
    }
    Value::Object(map)
}

/// Union of every facet key and sorted unique value across `libraries`.
fn available_facets(libraries: &[Library]) -> BTreeMap<String, Vec<String>> {
    let mut union: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for library in libraries {
        for entry in &library.catalog.patterns {
            for (key, values) in &entry.facets {
                let set = union.entry(key.clone()).or_default();
                for value in values {
                    set.insert(value.clone());
                }
            }
        }
    }
    union
        .into_iter()
        .map(|(key, values)| (key, values.into_iter().collect()))
        .collect()
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_pattern_list(input) {
        return outcome;
    }
    // Amendment A31.3: when `library` is omitted, search ALL libraries in the space,
    // intentionally ignoring `default_library` so cross-library need discovery works.
    let requested = input.get("library").and_then(Value::as_str);
    let libraries = match pack::read(cx, requested) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };

    let scope = input.get("scope").and_then(Value::as_str);
    let facets_filter: Vec<(&str, Vec<&str>)> = input
        .get("facets")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(k, v)| {
                    let vals = v
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect();
                    (k.as_str(), vals)
                })
                .collect()
        })
        .unwrap_or_default();
    let contains = input
        .get("contains")
        .and_then(Value::as_str)
        .map(str::to_ascii_lowercase);
    let has_filter = scope.is_some() || !facets_filter.is_empty() || contains.is_some();

    let start = input
        .get("after")
        .and_then(Value::as_str)
        .map(|after| cursor(after, &libraries));

    let aggregated = aggregate_implementations(&libraries);

    let mut rows: Vec<Row<'_>> = Vec::new();
    for library in &libraries {
        for entry in &library.catalog.patterns {
            let scope_ok = scope.is_none_or(|want| entry.scope == want);
            let facets_ok = facets_filter.iter().all(|(key, wanted)| {
                entry
                    .facets
                    .get(*key)
                    .is_some_and(|have| have.iter().any(|val| wanted.contains(&val.as_str())))
            });
            let contains_ok = contains.as_deref().is_none_or(|needle| {
                entry.pattern.to_ascii_lowercase().contains(needle)
                    || entry
                        .summary
                        .as_deref()
                        .is_some_and(|s| s.to_ascii_lowercase().contains(needle))
            });
            let after_start = start.is_none_or(|(from_lib, from_pat)| {
                (library.id.as_str(), entry.pattern.as_str()) > (from_lib, from_pat)
            });
            if !scope_ok || !facets_ok || !contains_ok || !after_start {
                continue;
            }

            let impls: Vec<Value> = aggregated
                .get(&(library.id.clone(), entry.pattern.clone()))
                .map(|items| items.iter().map(list_implementation).collect())
                .unwrap_or_default();

            let mut map = Map::new();
            map.insert("library".to_owned(), Value::String(library.id.clone()));
            map.insert("pattern".to_owned(), Value::String(entry.pattern.clone()));
            if let Some(summary) = &entry.summary {
                map.insert("summary".to_owned(), Value::String(summary.clone()));
            }
            map.insert("status".to_owned(), Value::String(entry.status.clone()));
            if let Some(replaced_by) = &entry.replaced_by {
                map.insert("replacedBy".to_owned(), Value::String(replaced_by.clone()));
            }
            map.insert("scope".to_owned(), Value::String(entry.scope.clone()));
            map.insert("facets".to_owned(), json!(entry.facets));
            map.insert("implementations".to_owned(), Value::Array(impls));

            let flagged = scan::flag_item(&mut map);
            rows.push(Row {
                library: &library.id,
                entry,
                value: Value::Object(map),
                flagged,
            });
        }
    }

    let include_available_facets = !has_filter || rows.is_empty();
    let facets_value = include_available_facets.then(|| json!(available_facets(&libraries)));

    let qualified = libraries.len() > 1;
    let identities: Vec<Value> = libraries
        .iter()
        .map(|library| {
            let mut value = identity(library);
            value["patternCount"] = Value::from(library.catalog.patterns.len());
            value
        })
        .collect();
    let content_libs: Vec<(Value, bool)> = libraries.iter().map(content_library).collect();

    let build = |count: usize| -> Outcome {
        let page = &rows[..count];
        let next = (count < rows.len())
            .then(|| page.last())
            .flatten()
            .map(|row| {
                let after = if qualified {
                    format!("{}/{}", row.library, row.entry.pattern)
                } else {
                    row.entry.pattern.clone()
                };
                json!({ "after": after })
            });
        let flagged = page.iter().filter(|row| row.flagged).count()
            + content_libs.iter().filter(|(_, f)| *f).count();
        let mut content = Map::new();
        content.insert("trust".to_owned(), Value::String("content".to_owned()));
        content.insert(
            "libraries".to_owned(),
            Value::Array(content_libs.iter().map(|(v, _)| v.clone()).collect()),
        );
        content.insert(
            "patterns".to_owned(),
            Value::Array(page.iter().map(|row| row.value.clone()).collect()),
        );
        if let Some(avail) = &facets_value {
            content.insert("availableFacets".to_owned(), avail.clone());
        }
        let outcome = success(json!({
            "libraries": identities,
            "content": Value::Object(content),
            "next": next,
        }))
        .with_reasoning(&format!(
            "Listed {count} of {} matching pattern(s) from {} library(ies).",
            rows.len(),
            libraries.len()
        ));
        fail::warn_flagged(outcome, flagged)
    };

    let budget = cx.call().output_budget;
    let whole = build(rows.len());
    if fits(&whole, budget) {
        cx.log(
            Level::Info,
            &format!("components-pattern-list: {} patterns", rows.len()),
        );
        return whole;
    }
    let count = fit_count(rows.len(), budget, build);
    if count == 0 {
        return fail::budget_exceeded();
    }
    cx.log(
        Level::Info,
        &format!(
            "components-pattern-list: {count} of {} patterns",
            rows.len()
        ),
    );
    build(count)
}
