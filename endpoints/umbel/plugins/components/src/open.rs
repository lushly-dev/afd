//! `components-open` (specification, section 8.2): one record, section by section while it fits.

use serde_json::{Value, json};
use umbel_sdk::{Cx, Level, Outcome, success};

use crate::entry::{self, Entry, SECTIONS, Section};
use crate::fit::{fit_count, fits};
use crate::list::{content_library, identity};
use crate::pack::schema::Record;
use crate::pack::{self, Library};
use crate::{Settings, fail, input, select};

/// Which of a record's sections one build serves.
#[derive(Clone, Copy)]
enum Take {
    /// The first `n` sections, whole.
    Sections(usize),
    /// `n` items of the first section, which did not fit alone.
    Items(usize),
}

/// Which library answers for `tag`.
fn locate<'a>(
    libraries: &'a [Library],
    tag: &str,
    settings: &Settings,
) -> Result<(&'a Library, &'a Record), Outcome> {
    let holders: Vec<(&Library, &Record)> = libraries
        .iter()
        .filter_map(|library| {
            library
                .records
                .iter()
                .find(|record| record.tag == tag)
                .map(|record| (library, record))
        })
        .collect();
    match holders.as_slice() {
        [] => Err(fail::tag_not_found(
            tag,
            &select::nearest(
                tag,
                libraries
                    .iter()
                    .flat_map(|library| library.records.iter().map(|r| r.tag.as_str())),
            ),
        )),
        [one] => Ok(*one),
        several => {
            let Some(default) = settings.default_library.as_deref() else {
                return Err(ambiguous(tag, several));
            };
            if !libraries.iter().any(|library| library.id == default) {
                let names: Vec<String> = libraries.iter().map(|l| l.id.clone()).collect();
                return Err(fail::library_not_found(default, &names));
            }
            several
                .iter()
                .find(|(library, _)| library.id == default)
                .copied()
                .ok_or_else(|| ambiguous(tag, several))
        }
    }
}

fn ambiguous(tag: &str, holders: &[(&Library, &Record)]) -> Outcome {
    let names: Vec<String> = holders.iter().map(|(l, _)| l.id.clone()).collect();
    fail::tag_ambiguous(tag, &names)
}

fn requested(input: &Value) -> Vec<&'static str> {
    let Some(names) = input.get("sections").and_then(Value::as_array) else {
        return SECTIONS.to_vec();
    };
    SECTIONS
        .into_iter()
        .filter(|name| names.iter().any(|value| value.as_str() == Some(name)))
        .collect()
}

fn omission(sections: &[&str]) -> Value {
    json!({
        "reason": "budget",
        "sections": sections,
        "open": { "command": "components-open", "sections": sections },
    })
}

fn partial_omission(section: &str, served: usize) -> Value {
    json!({
        "reason": "budget",
        "sections": [section],
        "skip": served,
        "open": { "command": "components-open", "sections": [section], "skip": served },
    })
}

struct Answer<'a> {
    library: &'a Library,
    entry: &'a Entry,
    /// The non-empty requested sections, after `skip`, in order.
    sections: Vec<(&'static str, Section)>,
    skip: usize,
}

impl Answer<'_> {
    fn build(&self, take: Take) -> Outcome {
        let (served, mut omitted, count_note) = match take {
            Take::Sections(count) => {
                let rest: Vec<&str> = self.sections[count..].iter().map(|(n, _)| *n).collect();
                let omitted = if rest.is_empty() {
                    Vec::new()
                } else {
                    vec![omission(&rest)]
                };
                (self.sections[..count].to_vec(), omitted, count)
            }
            Take::Items(count) => {
                let (name, section) = &self.sections[0];
                let window = section.window(0, count);
                let mut omitted = vec![partial_omission(name, self.skip + count)];
                let rest: Vec<&str> = self.sections[1..].iter().map(|(n, _)| *n).collect();
                if !rest.is_empty() {
                    omitted.push(omission(&rest));
                }
                (vec![(*name, window)], omitted, 1)
            }
        };
        if self.entry.left_out > 0 {
            omitted.insert(
                0,
                json!({ "reason": "minimum-basis", "facts": self.entry.left_out }),
            );
        }
        let content = self.entry.serve(&served);
        let (title, title_flagged) = content_library(self.library);
        let outcome = success(json!({
            "libraries": [identity(self.library)],
            "content": {
                "trust": "content",
                "libraries": [title],
                "component": content.component,
                "rules": content.rules,
            },
            "omitted": omitted,
        }))
        .with_reasoning(&format!(
            "Opened one component with {count_note} of {} section(s).",
            self.sections.len()
        ));
        fail::warn_flagged(outcome, content.flagged + usize::from(title_flagged))
    }
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    if let Err(outcome) = input::check_open(input) {
        return outcome;
    }
    let settings = Settings::load(cx);
    let tag = input.get("tag").and_then(Value::as_str).unwrap_or_default();
    let names = requested(input);
    let skip = input
        .get("skip")
        .and_then(Value::as_u64)
        .map(|n| n as usize);
    let library = input.get("library").and_then(Value::as_str);
    let libraries = match pack::read(cx, library) {
        Ok(libraries) => libraries,
        Err(outcome) => return outcome,
    };
    let (found, record) = match locate(&libraries, tag, &settings) {
        Ok(found) => found,
        Err(outcome) => return outcome,
    };
    let entry = entry::build(found, record, &settings);
    let mut sections: Vec<(&'static str, Section)> = entry
        .sections
        .iter()
        .filter(|(name, _)| names.contains(name))
        .cloned()
        .collect();
    if let Some(skip) = skip {
        if names.len() != 1 {
            return fail::invalid("skip needs sections to name exactly one section");
        }
        match sections.first() {
            Some((_, section)) if section.list_len().is_none() => {
                return fail::invalid("skip needs a section that holds a list");
            }
            Some((name, section)) => {
                let name = *name;
                let rest = section.window(skip, usize::MAX);
                sections = if rest.list_len().is_some_and(|len| len > 0) {
                    vec![(name, rest)]
                } else {
                    Vec::new()
                };
            }
            None => {}
        }
    }
    let answer = Answer {
        library: found,
        entry: &entry,
        sections,
        skip: skip.unwrap_or(0),
    };

    let budget = cx.call().output_budget;
    if !fits(&answer.build(Take::Sections(0)), budget) {
        return fail::budget_exceeded();
    }
    let total = answer.sections.len();
    let mut count = 0;
    while count < total && fits(&answer.build(Take::Sections(count + 1)), budget) {
        count += 1;
    }
    let chosen = if count > 0 || total == 0 {
        Take::Sections(count)
    } else {
        // The first requested section does not fit alone: its items, in order, while they do.
        let Some(items) = answer.sections[0].1.list_len() else {
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
            "components-open: {} sections of {tag}",
            answer.sections.len()
        ),
    );
    answer.build(chosen)
}
