//! Selection (section 9.3): the request, the task's terms, the sections and their candidates.

use serde::Deserialize;
use serde_json::Value;
use umbel_sdk::{CallContext, Cx, Outcome};
use umbel_store::{MAX_QUERY_CHARS, MemoryClass, Millis};

use crate::fail;
use crate::settings::{Bundle, Settings};
use crate::{knowledge, memory};

/// The most terms a task gives, and the longest term, in characters.
const MAX_TERMS: usize = 32;
const MAX_TERM_CHARS: usize = 64;
/// The longest task, in characters.
const MAX_TASK_CHARS: usize = 4000;
/// `maxChars`' default and ceiling, in UTF-16 code units.
const DEFAULT_MAX_CHARS: usize = 9000;
const MAX_MAX_CHARS: usize = 32_000;

/// A bundle section, in bundle order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Section {
    Knowledge,
    Semantic,
    Procedural,
    Episodic,
}

impl Section {
    pub(crate) const ALL: [Self; 4] = [
        Self::Knowledge,
        Self::Semantic,
        Self::Procedural,
        Self::Episodic,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Knowledge => "knowledge",
            Self::Semantic => "semantic",
            Self::Procedural => "procedural",
            Self::Episodic => "episodic",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|section| section.name() == name)
    }

    /// The memory class a memory section reads.
    pub(crate) fn class(self) -> Option<MemoryClass> {
        match self {
            Self::Knowledge => None,
            Self::Semantic => Some(MemoryClass::Semantic),
            Self::Procedural => Some(MemoryClass::Procedural),
            Self::Episodic => Some(MemoryClass::Episodic),
        }
    }
}

/// Why a whole section holds nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Gap {
    NoTask,
    VerifiedOnly,
    IndexEmpty,
    LaneUnavailable,
}

impl Gap {
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Self::NoTask => "no-task",
            Self::VerifiedOnly => "verified-only",
            Self::IndexEmpty => "index-empty",
            Self::LaneUnavailable => "lane-unavailable",
        }
    }
}

/// One candidate, ranked within its section.
#[derive(Debug, Clone)]
pub(crate) struct Item {
    /// `<space>:<id>`.
    pub(crate) id: String,
    /// The bundle item, with its `text`.
    pub(crate) json: Value,
    /// Its AFD `Source`.
    pub(crate) source: Value,
    /// The rendered header line, from validated values only.
    pub(crate) header: String,
    /// The title, then the text: the quoted content of the rendered block.
    pub(crate) title: String,
    pub(crate) text: String,
    /// Past its tier's `per_authority_cap`: never placed, omitted with `budget`.
    pub(crate) capped: bool,
}

impl Item {
    /// An item past its tier's cap: only its id is kept.
    pub(crate) fn capped(id: String) -> Self {
        Self {
            id,
            json: Value::Null,
            source: Value::Null,
            header: String::new(),
            title: String::new(),
            text: String::new(),
            capped: true,
        }
    }

    pub(crate) fn is_memory(&self) -> bool {
        self.json.get("kind").and_then(Value::as_str) == Some("memory")
    }
}

/// One asked-for section: a gap, or its ranked candidates and the counts it leaves out.
#[derive(Debug, Clone)]
pub(crate) struct Lane {
    pub(crate) section: Section,
    pub(crate) gap: Option<Gap>,
    pub(crate) items: Vec<Item>,
    /// Readable, current, not admitted by the push rule.
    pub(crate) authority: u64,
    /// Readable, current, flagged.
    pub(crate) flagged: u64,
    /// Readable, but their text does not open.
    pub(crate) unreadable: u64,
}

impl Lane {
    pub(crate) fn new(section: Section) -> Self {
        Self {
            section,
            gap: None,
            items: Vec::new(),
            authority: 0,
            flagged: 0,
            unreadable: 0,
        }
    }

    pub(crate) fn gap(section: Section, gap: Gap) -> Self {
        Self {
            gap: Some(gap),
            ..Self::new(section)
        }
    }
}

/// A warning: code, message and details.
pub(crate) type Warning = (&'static str, String, Option<Value>);

/// The request, checked.
#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub(crate) space: String,
    pub(crate) task: Option<String>,
    pub(crate) terms: Vec<String>,
    pub(crate) project: Option<String>,
    pub(crate) sections: Vec<Section>,
    pub(crate) max_bytes: Option<u64>,
    pub(crate) render: bool,
    pub(crate) max_chars: usize,
    /// The instant memory is read at; `asOf` when given, else now.
    pub(crate) as_of: Millis,
    pub(crate) as_of_given: bool,
    pub(crate) now: Millis,
    /// The caller's effective principal, as the host derives it.
    pub(crate) caller: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    task: Option<String>,
    project: Option<String>,
    session: Option<String>,
    sections: Option<Vec<String>>,
    max_bytes: Option<u64>,
    render: Option<String>,
    max_chars: Option<usize>,
    as_of: Option<String>,
}

/// The caller's effective principal, as the host derives it: the person acted for, else the
/// actor's own `<kind>:<id>`. `None` for an actor with no id.
pub(crate) fn effective_principal(call: &CallContext) -> Option<String> {
    if let Some(person) = call.on_behalf_of.as_deref().filter(|p| !p.is_empty()) {
        return Some(format!("human:{person}"));
    }
    let id = call.actor_id.as_deref().filter(|id| !id.is_empty())?;
    matches!(
        call.actor_kind.as_str(),
        "human" | "agent" | "service" | "script"
    )
    .then(|| format!("{}:{id}", call.actor_kind))
}

/// The task's terms (section 9.3): lower case, split on anything that is not a letter or a digit,
/// the stop words removed, first occurrences kept, at most 32 terms of at most 64 characters (a
/// longer word is dropped), and only as many as the index query's 1024 characters hold once
/// quoted and joined with `OR`.
pub(crate) fn terms(task: &str, stop_words: &[String]) -> Vec<String> {
    let lower = task.to_lowercase();
    let mut out: Vec<String> = Vec::new();
    let mut query_chars = 0usize;
    for word in lower.split(|c: char| !c.is_alphanumeric()) {
        let chars = word.chars().count();
        if word.is_empty() || chars > MAX_TERM_CHARS {
            continue;
        }
        if stop_words.iter().any(|stop| stop == word) || out.iter().any(|t| t == word) {
            continue;
        }
        // `"word"` and, after the first, ` OR ` before it.
        let cost = chars + 2 + if out.is_empty() { 0 } else { 4 };
        if query_chars + cost > MAX_QUERY_CHARS {
            break;
        }
        query_chars += cost;
        out.push(word.to_owned());
        if out.len() == MAX_TERMS {
            break;
        }
    }
    out
}

fn label(what: &str, value: Option<String>) -> Result<Option<String>, Outcome> {
    if let Some(text) = &value
        && umbel_store::memory::check_label(what, text).is_err()
    {
        return Err(fail::invalid(&format!(
            "{what} must match ^[A-Za-z0-9][A-Za-z0-9._-]{{0,127}}$"
        )));
    }
    Ok(value)
}

impl Request {
    pub(crate) fn parse(input: &Value, cx: &Cx, bundle: &Bundle) -> Result<Self, Outcome> {
        let own: Input = serde_json::from_value(input.clone())
            .map_err(|_| fail::invalid("the input does not match context-bundle's schema"))?;
        let space = cx.call().space.clone().ok_or_else(fail::no_space)?;
        let now = cx.now_ms().map_err(|error| fail::host(&error))?;
        let task = own.task.filter(|task| !task.trim().is_empty());
        if task
            .as_ref()
            .is_some_and(|task| task.chars().count() > MAX_TASK_CHARS)
        {
            return Err(fail::invalid("task is at most 4000 characters"));
        }
        let project = label("project", own.project)?;
        // A label on the request, not a filter (section 9.3); checked like every label.
        label("session", own.session)?;
        let sections = match own.sections {
            None => vec![Section::Knowledge, Section::Semantic, Section::Procedural],
            Some(names) => {
                let mut sections = Vec::new();
                for name in names {
                    let section = Section::parse(&name).ok_or_else(|| {
                        fail::invalid("sections lists knowledge, semantic, procedural and episodic")
                    })?;
                    if !sections.contains(&section) {
                        sections.push(section);
                    }
                }
                sections.sort();
                sections
            }
        };
        let render = match own.render.as_deref() {
            None | Some("none") => false,
            Some("text") => true,
            Some(_) => return Err(fail::invalid("render is none or text")),
        };
        let max_chars = own.max_chars.unwrap_or(DEFAULT_MAX_CHARS);
        if !(1000..=MAX_MAX_CHARS).contains(&max_chars) {
            return Err(fail::invalid("maxChars is from 1000 to 32000"));
        }
        if own.max_bytes.is_some_and(|bytes| bytes < 1024) {
            return Err(fail::invalid("maxBytes is at least 1024"));
        }
        let (as_of, as_of_given) = match own.as_of.as_deref() {
            None => (now, false),
            Some(text) => (
                chrono::DateTime::parse_from_rfc3339(text)
                    .map(|at| at.timestamp_millis())
                    .map_err(|_| fail::invalid("asOf is an RFC 3339 instant"))?,
                true,
            ),
        };
        let terms = task
            .as_deref()
            .map(|task| terms(task, &bundle.stop_words))
            .unwrap_or_default();
        Ok(Self {
            space,
            task,
            terms,
            project,
            sections,
            max_bytes: own.max_bytes,
            render,
            max_chars,
            as_of,
            as_of_given,
            now,
            caller: effective_principal(cx.call()),
        })
    }

    pub(crate) fn wants(&self, section: Section) -> bool {
        self.sections.contains(&section)
    }
}

/// What selection found.
#[derive(Debug, Clone)]
pub(crate) struct Selection {
    /// The asked-for sections, in bundle order.
    pub(crate) lanes: Vec<Lane>,
    pub(crate) warnings: Vec<Warning>,
    /// `MEMORY_KEYS_MISSING` or `MEMORY_KEYS_MISMATCH` when the memory lane failed on its keys.
    pub(crate) keys_failed: Option<&'static str>,
    /// The stores' revisions; `None` for a caller whose positions are sealed (phase 5 section
    /// 9.3), since each counts every principal's writes.
    pub(crate) index_applied: Option<u64>,
    pub(crate) memory_head: Option<u64>,
}

/// Run every asked-for lane.
pub(crate) fn select(
    cx: &Cx,
    request: &Request,
    settings: &Settings,
    bundle: &Bundle,
) -> Result<Selection, Outcome> {
    let mut selection = Selection {
        lanes: Vec::new(),
        warnings: Vec::new(),
        keys_failed: None,
        index_applied: None,
        memory_head: None,
    };
    if request.wants(Section::Knowledge) {
        let found = knowledge::lane(cx, request, settings, bundle)?;
        selection.index_applied = found.applied.filter(|_| !cx.call().sealed_positions);
        selection.warnings.extend(found.warnings);
        selection.lanes.push(found.lane);
    }
    let found = memory::lanes(cx, request, settings, bundle)?;
    selection.lanes.extend(found.lanes);
    selection.keys_failed = found.keys_failed;
    selection.memory_head = found.head.filter(|_| !cx.call().sealed_positions);
    if let Some(code) = found.keys_failed {
        let message = if code == "MEMORY_KEYS_MISSING" {
            "the memory key file is missing, so no memory record opens and every memory section is left out; restore memory.keys and run umbel doctor"
        } else {
            "the memory key file is not this database's, so no memory record opens and every memory section is left out; put back its memory.keys and run umbel doctor"
        };
        selection.warnings.push((code, message.to_owned(), None));
    }
    Ok(selection)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn stop() -> Vec<String> {
        ["the", "a", "of"].map(str::to_owned).to_vec()
    }

    #[test]
    fn terms_are_lower_case_words_without_stop_words_or_repeats() {
        assert_eq!(
            terms("Roll back THE staging-deploy; roll back again!", &stop()),
            ["roll", "back", "staging", "deploy", "again"]
        );
        assert_eq!(terms("Café über 42", &stop()), ["café", "über", "42"]);
        assert!(terms(" ,;  the a ", &stop()).is_empty());
        // No query syntax survives: quotes, stars, fields and operators are separators or words.
        assert_eq!(
            terms("\"x\" title:y* -z +w AND", &stop()),
            ["x", "title", "y", "z", "w", "and"]
        );
    }

    #[test]
    fn terms_are_capped_by_count_length_and_query_size() {
        let many: Vec<String> = (0..50).map(|n| format!("w{n}")).collect();
        assert_eq!(terms(&many.join(" "), &[]).len(), 32);
        let long = "x".repeat(65);
        assert_eq!(terms(&format!("{long} ok"), &[]), ["ok"]);
        // 32 words of 60 letters cannot all fit 1024 characters once quoted and joined.
        let wide: Vec<String> = (0..32)
            .map(|n| format!("{}{}", "q".repeat(58), n + 10))
            .collect();
        let kept = terms(&wide.join(" "), &[]);
        let query: Vec<String> = kept.iter().map(|t| format!("\"{t}\"")).collect();
        assert!(query.join(" OR ").chars().count() <= MAX_QUERY_CHARS);
        assert!(kept.len() < 32 && !kept.is_empty());
    }
}
