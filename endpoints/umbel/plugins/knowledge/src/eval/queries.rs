//! The eval query set, version 1 (`schemas/eval-queries.v1.json`; specification section 10.2):
//! one JSON object per line.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a query tests. The first six are answerable; their ranking is scored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// A key term.
    Exact,
    /// An alias in the answer's `aliases`.
    Alias,
    /// A quoted phrase.
    Phrase,
    /// A filter plus a term.
    Field,
    /// Only the bridge term; the answer is reached through `links_to`.
    MultiHop,
    /// Several spaces; the answer is in a later one.
    CrossSpace,
    /// Words the corpus never holds: nothing may be returned.
    Unanswerable,
    /// A probe for restricted answers, as a principal who may not read them.
    Permission,
}

impl Kind {
    /// The answerable kinds, in report order.
    pub const ANSWERABLE: [Kind; 6] = [
        Kind::Exact,
        Kind::Alias,
        Kind::Phrase,
        Kind::Field,
        Kind::MultiHop,
        Kind::CrossSpace,
    ];

    /// The spelling in the files and reports.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Kind::Exact => "exact",
            Kind::Alias => "alias",
            Kind::Phrase => "phrase",
            Kind::Field => "field",
            Kind::MultiHop => "multi-hop",
            Kind::CrossSpace => "cross-space",
            Kind::Unanswerable => "unanswerable",
            Kind::Permission => "permission",
        }
    }

    /// Whether recall, nDCG and MRR count the kind.
    #[must_use]
    pub fn is_answerable(self) -> bool {
        Self::ANSWERABLE.contains(&self)
    }
}

/// One line of a query set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvalQuery {
    /// Always 1.
    pub version: u32,
    /// `q-0042`.
    pub id: String,
    /// What it tests.
    pub kind: Kind,
    /// The query text, in `knowledge-search`'s syntax.
    pub query: String,
    /// The spaces searched (two or more is an explicit multi-space query).
    pub spaces: Vec<String>,
    /// Who asks: `<kind>:<id>`.
    pub principal: String,
    /// `knowledge-search`'s filters.
    pub filters: Value,
    /// `<space>:<document id>` to grade: 2 the answer, 1 bridges and passing mentions.
    pub qrels: BTreeMap<String, u8>,
    /// Whether nothing may be returned.
    pub unanswerable: bool,
}

/// Why a query set was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryError {
    /// The 1-based line, or 0 for a set-wide problem.
    pub line: usize,
    /// What is wrong.
    pub reason: String,
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.line == 0 {
            write!(f, "{}", self.reason)
        } else {
            write!(f, "line {}: {}", self.line, self.reason)
        }
    }
}

fn space_ok(space: &str) -> bool {
    let mut chars = space.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && space.len() <= 63
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn principal_ok(principal: &str) -> bool {
    let Some((kind, id)) = principal.split_once(':') else {
        return false;
    };
    ["human", "agent", "service", "script"].contains(&kind)
        && (1..=128).contains(&id.chars().count())
        && !id.chars().any(char::is_control)
}

impl EvalQuery {
    /// The rules of `eval-queries.v1.json` and the ones a schema cannot state.
    ///
    /// # Errors
    /// The first rule the query breaks.
    pub fn check(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!("version {} is not 1", self.version));
        }
        let digits = self.id.strip_prefix("q-").unwrap_or("");
        if digits.len() < 4 || !digits.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("the id `{}` is not q-NNNN", self.id));
        }
        if self.query.trim().is_empty() || self.query.chars().count() > 1024 {
            return Err("the query is empty or over 1024 characters".into());
        }
        if self.spaces.is_empty() || self.spaces.len() > 8 {
            return Err("spaces lists 1 to 8 spaces".into());
        }
        let unique: BTreeSet<&String> = self.spaces.iter().collect();
        if unique.len() != self.spaces.len() || !self.spaces.iter().all(|s| space_ok(s)) {
            return Err("spaces holds a repeated or invalid space id".into());
        }
        if !principal_ok(&self.principal) {
            return Err(format!("`{}` is not a principal", self.principal));
        }
        if !self.filters.is_object() {
            return Err("filters is not an object".into());
        }
        for (key, grade) in &self.qrels {
            let Some((space, doc)) = key.split_once(':') else {
                return Err(format!("the qrels key `{key}` is not <space>:<document>"));
            };
            if !space_ok(space) || doc.is_empty() {
                return Err(format!("the qrels key `{key}` is not <space>:<document>"));
            }
            if !(1..=2).contains(grade) {
                return Err(format!("the grade of `{key}` is not 1 or 2"));
            }
        }
        if self.unanswerable != (self.kind == Kind::Unanswerable) {
            return Err("unanswerable is true exactly for the unanswerable kind".into());
        }
        if self.kind == Kind::Unanswerable && !self.qrels.is_empty() {
            return Err("an unanswerable query has no qrels".into());
        }
        if self.kind.is_answerable() && !self.qrels.values().any(|grade| *grade == 2) {
            return Err("an answerable query needs a grade-2 document".into());
        }
        Ok(())
    }
}

/// Read a query set (JSON Lines; blank lines are skipped).
///
/// # Errors
/// The first line that is not a query, or a repeated id.
pub fn parse(text: &str) -> Result<Vec<EvalQuery>, QueryError> {
    let mut queries: Vec<EvalQuery> = Vec::new();
    let mut ids = BTreeSet::new();
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let number = index + 1;
        let query: EvalQuery = serde_json::from_str(line).map_err(|error| QueryError {
            line: number,
            reason: error.to_string(),
        })?;
        query.check().map_err(|reason| QueryError {
            line: number,
            reason,
        })?;
        if !ids.insert(query.id.clone()) {
            return Err(QueryError {
                line: number,
                reason: format!("the id `{}` is used twice", query.id),
            });
        }
        queries.push(query);
    }
    Ok(queries)
}

/// A query set as JSON Lines.
#[must_use]
pub fn to_jsonl(queries: &[EvalQuery]) -> String {
    let mut text = String::new();
    for query in queries {
        text.push_str(&serde_json::to_string(query).unwrap_or_default());
        text.push('\n');
    }
    text
}
