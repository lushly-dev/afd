//! The vocabulary pack (specification, section 5): three TOML files, each read on every call that
//! needs it and checked. A file that is missing or breaks a rule refuses the call with
//! `VALIDATION_ERROR`, `details.reason = "pack"`, naming the file and the key, as a deployer's
//! fault.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use toml::Table;
use umbel_sdk::{Cx, HostError, Outcome};

use crate::fail;

/// The pack's id.
pub(crate) const PACK: &str = "vocabulary";

const TYPES: &str = "data/types.toml";
const MATCHING: &str = "data/matching.toml";
const LIMITS: &str = "data/limits.toml";

/// The most candidates the plugin keeps for one capture (`offered`, 4.1).
pub(crate) const MAX_CANDIDATES_CEILING: u64 = 10;
/// The most types a pack may declare.
const MAX_TYPES: usize = 64;

/// One type of idea.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IdeaType {
    pub(crate) name: String,
    pub(crate) means: String,
}

/// One band table: the lowest score of each band above `distant`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Bands {
    pub(crate) likely_same: f64,
    pub(crate) related: f64,
}

/// `data/matching.toml`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Matching {
    pub(crate) candidates: u64,
    pub(crate) max_candidates: u64,
    pub(crate) provisional: bool,
    pub(crate) words: Bands,
    /// `[bands.fused.<model id>]`, one table per model.
    pub(crate) fused: BTreeMap<String, Bands>,
}

/// What a page needs beside an item's two statements: page 1's heading with its capped
/// "Staged by" line, a reason of 200, the labels and a group's heading line.
const PAGE_ROOM: u64 = 1300;

/// `data/limits.toml`, each value within its ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Limits {
    pub(crate) statement_chars: u64,
    pub(crate) capture_max: u64,
    pub(crate) stage_max: u64,
    pub(crate) review_max: u64,
    pub(crate) part_max: u64,
    pub(crate) ask_default: u64,
    pub(crate) ask_max: u64,
    pub(crate) page_items: u64,
    pub(crate) page_chars: u64,
    pub(crate) report_min: u64,
}

/// Each limit's key and its hard ceiling in code: section 5's figures, but `statement_chars`
/// 2000 and `ask_max` 200.
const LIMIT_CEILINGS: [(&str, u64); 10] = [
    ("statement_chars", 2000),
    ("capture_max", 64),
    ("stage_max", 500),
    ("review_max", 2000),
    ("part_max", 500),
    ("ask_default", 25),
    ("ask_max", 200),
    ("page_items", 20),
    ("page_chars", 5800),
    ("report_min", 50),
];

/// The whole pack.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Pack {
    pub(crate) types: Vec<IdeaType>,
    pub(crate) matching: Matching,
    pub(crate) limits: Limits,
}

impl Pack {
    /// Read and check all three files.
    pub(crate) fn read(cx: &Cx) -> Result<Self, Outcome> {
        Ok(Self {
            types: types(&file(cx, TYPES)?)?,
            matching: matching(&file(cx, MATCHING)?)?,
            limits: limits(&file(cx, LIMITS)?)?,
        })
    }

    /// The names of the pack's types.
    pub(crate) fn type_names(&self) -> Vec<String> {
        self.types.iter().map(|t| t.name.clone()).collect()
    }

    /// Whether `name` is one of the pack's types.
    pub(crate) fn has_type(&self, name: &str) -> bool {
        self.types.iter().any(|t| t.name == name)
    }

    /// The bands and limits as `ideas-guide` shows them.
    pub(crate) fn bands_json(&self) -> Value {
        let fused: serde_json::Map<String, Value> = self
            .matching
            .fused
            .iter()
            .map(|(model, bands)| {
                (
                    model.clone(),
                    json!({ "likelySame": bands.likely_same, "related": bands.related }),
                )
            })
            .collect();
        json!({
            "provisional": self.matching.provisional,
            "candidates": self.matching.candidates,
            "maxCandidates": self.matching.max_candidates,
            "words": { "likelySame": self.matching.words.likely_same, "related": self.matching.words.related },
            "fused": fused,
            "names": ["identical", "likely-same", "related", "distant"],
        })
    }

    /// The limits as `ideas-guide` shows them.
    pub(crate) fn limits_json(&self) -> Value {
        let l = &self.limits;
        json!({
            "statementChars": l.statement_chars,
            "captureMax": l.capture_max,
            "stageMax": l.stage_max,
            "reviewMax": l.review_max,
            "partMax": l.part_max,
            "askDefault": l.ask_default,
            "askMax": l.ask_max,
            "pageItems": l.page_items,
            "pageChars": l.page_chars,
            "reportMin": l.report_min,
            "tags": 8,
            "tagChars": 40,
        })
    }
}

/// One file of the pack, parsed.
fn file(cx: &Cx, path: &str) -> Result<Table, Outcome> {
    let bytes = cx.pack_read(PACK, path).map_err(|error| match error {
        HostError::NotFound(_) => fail::pack(path, "(file)", "is missing"),
        HostError::NotGranted(_) => fail::pack(
            path,
            "(file)",
            "cannot be read: the packs grant is not held",
        ),
        _ => fail::pack(path, "(file)", "cannot be read"),
    })?;
    let text = String::from_utf8(bytes).map_err(|_| fail::pack(path, "(file)", "is not UTF-8"))?;
    text.parse::<Table>()
        .map_err(|_| fail::pack(path, "(file)", "is not valid TOML"))
}

fn types(table: &Table) -> Result<Vec<IdeaType>, Outcome> {
    let Some(types) = table.get("types").and_then(toml::Value::as_table) else {
        return Err(fail::pack(TYPES, "types", "is missing or not a table"));
    };
    if types.is_empty() || types.len() > MAX_TYPES {
        return Err(fail::pack(
            TYPES,
            "types",
            &format!("must declare 1 to {MAX_TYPES} types"),
        ));
    }
    let mut out = Vec::new();
    for (name, entry) in types {
        let key = format!("types.{name}");
        if !is_type_name(name) {
            return Err(fail::pack(
                TYPES,
                &key,
                "must be named by ^[a-z][a-z0-9-]{0,31}$",
            ));
        }
        let means = entry
            .as_table()
            .and_then(|entry| entry.get("means"))
            .and_then(toml::Value::as_str)
            .filter(|means| !means.is_empty() && means.chars().count() <= 200)
            .ok_or_else(|| {
                fail::pack(
                    TYPES,
                    &format!("{key}.means"),
                    "must be 1 to 200 characters",
                )
            })?;
        out.push(IdeaType {
            name: name.clone(),
            means: means.to_owned(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// `^[a-z][a-z0-9-]{0,31}$`.
fn is_type_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && name.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn integer(table: &Table, file: &str, key: &str, min: u64, max: u64) -> Result<u64, Outcome> {
    let value = table
        .get(key)
        .ok_or_else(|| fail::pack(file, key, "is missing"))?;
    value
        .as_integer()
        .and_then(|n| u64::try_from(n).ok())
        .filter(|n| (min..=max).contains(n))
        .ok_or_else(|| {
            fail::pack(
                file,
                key,
                &format!("must be an integer from {min} to {max}"),
            )
        })
}

fn score(table: &Table, file: &str, key: &str) -> Result<f64, Outcome> {
    let value = table
        .get(key)
        .ok_or_else(|| fail::pack(file, key, "is missing"))?;
    let score = match value {
        toml::Value::Float(f) => *f,
        toml::Value::Integer(n) if *n == 0 || *n == 1 => *n as f64,
        _ => return Err(fail::pack(file, key, "must be a number from 0 to 1")),
    };
    if (0.0..=1.0).contains(&score) {
        Ok(score)
    } else {
        Err(fail::pack(file, key, "must be a number from 0 to 1"))
    }
}

fn bands(table: Option<&toml::Value>, key: &str) -> Result<Bands, Outcome> {
    let Some(table) = table.and_then(toml::Value::as_table) else {
        return Err(fail::pack(MATCHING, key, "is missing or not a table"));
    };
    let likely_same = score(table, MATCHING, "likely_same").map_err(|_| {
        fail::pack(
            MATCHING,
            &format!("{key}.likely_same"),
            "must be a number from 0 to 1",
        )
    })?;
    let related = score(table, MATCHING, "related").map_err(|_| {
        fail::pack(
            MATCHING,
            &format!("{key}.related"),
            "must be a number from 0 to 1",
        )
    })?;
    if related > likely_same {
        return Err(fail::pack(
            MATCHING,
            &format!("{key}.related"),
            "must not be above likely_same",
        ));
    }
    Ok(Bands {
        likely_same,
        related,
    })
}

fn matching(table: &Table) -> Result<Matching, Outcome> {
    let max_candidates = integer(table, MATCHING, "max_candidates", 1, MAX_CANDIDATES_CEILING)?;
    let candidates = integer(table, MATCHING, "candidates", 1, max_candidates)?;
    let provisional = match table.get("provisional") {
        None => true,
        Some(toml::Value::Boolean(flag)) => *flag,
        Some(_) => return Err(fail::pack(MATCHING, "provisional", "must be true or false")),
    };
    let all = table
        .get("bands")
        .and_then(toml::Value::as_table)
        .ok_or_else(|| fail::pack(MATCHING, "bands", "is missing or not a table"))?;
    let words = bands(all.get("words"), "bands.words")?;
    let mut fused = BTreeMap::new();
    if let Some(models) = all.get("fused") {
        let models = models
            .as_table()
            .ok_or_else(|| fail::pack(MATCHING, "bands.fused", "must be a table of models"))?;
        for (model, entry) in models {
            fused.insert(
                model.clone(),
                bands(Some(entry), &format!("bands.fused.{model}"))?,
            );
        }
    }
    Ok(Matching {
        candidates,
        max_candidates,
        provisional,
        words,
        fused,
    })
}

fn limits(table: &Table) -> Result<Limits, Outcome> {
    let mut values = [0u64; 10];
    for (slot, (key, ceiling)) in values.iter_mut().zip(LIMIT_CEILINGS) {
        *slot = integer(table, LIMITS, key, 1, ceiling)?;
    }
    let [
        statement_chars,
        capture_max,
        stage_max,
        review_max,
        part_max,
        ask_default,
        ask_max,
        page_items,
        page_chars,
        report_min,
    ] = values;
    // A part at `part_max` fits the host's pages (amendment C4-11): by items, and with room on
    // a page for the longest item (two statements, a reason, its labels) beside page 1's
    // heading, whose "Staged by" line is capped.
    if part_max.div_ceil(page_items) > u64::from(crate::review::preview::MAX_PAGES) {
        return Err(fail::pack(
            LIMITS,
            "page_items",
            "must let part_max fit in 200 pages",
        ));
    }
    if page_chars < 2 * statement_chars + PAGE_ROOM {
        return Err(fail::pack(
            LIMITS,
            "page_chars",
            "must hold the longest item, twice statement_chars and 1300 more",
        ));
    }
    if ask_default > ask_max {
        return Err(fail::pack(
            LIMITS,
            "ask_default",
            "must not be above ask_max",
        ));
    }
    Ok(Limits {
        statement_chars,
        capture_max,
        stage_max,
        review_max,
        part_max,
        ask_default,
        ask_max,
        page_items,
        page_chars,
        report_min,
    })
}
