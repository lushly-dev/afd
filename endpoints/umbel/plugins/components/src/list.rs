//! `components-list` (specification, section 8.1).

use serde_json::{Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::fit::{fit_count, fits};
use crate::pack::schema::CatalogEntry;
use crate::pack::{self, Library};
use crate::{Settings, fail, input, scan};

/// One library's identity, outside the content part: every value was checked when read.
pub(crate) fn identity(library: &Library) -> Value {
    json!({
        "library": library.id,
        "package": library.catalog.package.name,
        "version": library.catalog.package.version,
        "digest": library.catalog.digest,
        "prefix": library.catalog.prefix,
    })
}

/// A library's entry in the content part, and whether its title is flagged.
pub(crate) fn content_library(library: &Library) -> (Value, bool) {
    let mut item = json!({ "library": library.id, "title": library.catalog.title });
    let flagged = item.as_object_mut().is_some_and(scan::flag_item);
    (item, flagged)
}

struct Row<'a> {
    library: &'a str,
    entry: &'a CatalogEntry,
    value: Value,
    flagged: bool,
}

/// The cursor a bare or `<library>/<tag>` `after` names.
fn cursor<'a>(after: &'a str, listed: &'a [&'a Library]) -> (&'a str, &'a str) {
    if let Some((library, tag)) = after.split_once('/') {
        return (library, tag);
    }
    let holder = listed.iter().find(|library| {
        library
            .catalog
            .components
            .iter()
            .any(|entry| entry.tag == after)
    });
    let library = holder.or(listed.first()).map_or("", |lib| lib.id.as_str());
    (library, after)
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_list(input) {
        return outcome;
    }
    let settings = Settings::load(cx);
    let requested = input.get("library").and_then(Value::as_str);
    let libraries = match pack::read(cx, requested) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };
    let listed: Vec<&Library> = match (requested, settings.default_library.as_deref()) {
        (None, Some(default)) if libraries.len() > 1 => {
            match libraries.iter().find(|library| library.id == default) {
                Some(library) => vec![library],
                None => {
                    let names: Vec<String> = libraries.iter().map(|l| l.id.clone()).collect();
                    return fail::library_not_found(default, &names);
                }
            }
        }
        _ => libraries.iter().collect(),
    };

    let prefix = input.get("prefix").and_then(Value::as_str);
    let contains = input
        .get("contains")
        .and_then(Value::as_str)
        .map(str::to_ascii_lowercase);
    let start = input
        .get("after")
        .and_then(Value::as_str)
        .map(|after| cursor(after, &listed));
    let mut rows: Vec<Row<'_>> = Vec::new();
    for library in &listed {
        for entry in &library.catalog.components {
            let held = prefix.is_none_or(|prefix| entry.tag.starts_with(prefix))
                && contains.as_deref().is_none_or(|needle| {
                    entry.tag.to_ascii_lowercase().contains(needle)
                        || entry
                            .summary
                            .as_deref()
                            .is_some_and(|s| s.to_ascii_lowercase().contains(needle))
                });
            let after_start = start.is_none_or(|(from_library, from_tag)| {
                (library.id.as_str(), entry.tag.as_str()) > (from_library, from_tag)
            });
            if !held || !after_start {
                continue;
            }
            let mut value = json!({
                "library": library.id, "tag": entry.tag, "status": entry.status,
            });
            if let Some(summary) = &entry.summary {
                value["summary"] = Value::String(summary.clone());
            }
            let flagged = value.as_object_mut().is_some_and(scan::flag_item);
            rows.push(Row {
                library: &library.id,
                entry,
                value,
                flagged,
            });
        }
    }

    let qualified = listed.len() > 1;
    let identities: Vec<Value> = listed
        .iter()
        .map(|library| {
            let mut value = identity(library);
            value["count"] = Value::from(library.catalog.components.len());
            value
        })
        .collect();
    let content: Vec<(Value, bool)> = listed.iter().map(|l| content_library(l)).collect();
    let build = |count: usize| -> Outcome {
        let page = &rows[..count];
        let next = (count < rows.len())
            .then(|| page.last())
            .flatten()
            .map(|row| {
                let after = if qualified {
                    format!("{}/{}", row.library, row.entry.tag)
                } else {
                    row.entry.tag.clone()
                };
                json!({ "after": after })
            });
        let flagged = page.iter().filter(|row| row.flagged).count()
            + content.iter().filter(|(_, flagged)| *flagged).count();
        let outcome = success(json!({
            "libraries": identities,
            "content": {
                "trust": "content",
                "libraries": content.iter().map(|(value, _)| value).collect::<Vec<_>>(),
                "components": page.iter().map(|row| &row.value).collect::<Vec<_>>(),
            },
            "next": next,
        }))
        .with_reasoning(&format!(
            "Listed {count} of {} matching tag(s) from {} library(ies).",
            rows.len(),
            listed.len()
        ));
        fail::warn_flagged(outcome, flagged)
    };

    let budget = cx.call().output_budget;
    let whole = build(rows.len());
    if fits(&whole, budget) {
        cx.log(
            Level::Info,
            &format!("components-list: {} tags", rows.len()),
        );
        return whole;
    }
    let count = fit_count(rows.len(), budget, build);
    if count == 0 {
        return fail::budget_exceeded();
    }
    cx.log(
        Level::Info,
        &format!("components-list: {count} of {} tags", rows.len()),
    );
    build(count)
}
