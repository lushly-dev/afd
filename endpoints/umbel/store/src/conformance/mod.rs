//! The conformance suite (specification section 3.1, D10): `run_all` runs every case group
//! against a backend and reports; phase 6's second backend runs the same function.
//!
//! A backend's own test supplies a **factory**, which opens (creating when empty) the stores of
//! space [`SPACE`] under a directory, and, for the multi-process cases, a **`spawn_writer`**: a
//! `fn(&Path) -> Command` that re-runs the backend's own test binary (`std::env::current_exe()`
//! with `--exact writer_child --nocapture` and `UMBEL_STORE_WRITER=<dir>`), whose `writer_child`
//! test opens the same directory and calls [`run_child`]. No extra binary target is needed. The
//! suite starts its children together by writing a line to their standard input, so the
//! interleaving needs no sleeps.

mod access;
mod changes;
mod child;
mod concurrency;
mod documents;
mod durability;
mod envelope;
mod fixture;
mod graph;
mod records;
pub mod samples;

use std::fmt::{self, Debug};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use crate::{DocumentStore, GraphStore, SearchIndex, StoreError};

pub use child::{ENV_COUNT, ENV_ID, ENV_WRITER, WROTE_PREFIX, run_child};

/// The space every suite store serves.
pub const SPACE: &str = "main";

/// Opens (creating when empty) the stores of the given space under a directory. Called again on
/// the same directory to reopen.
pub type Factory<'a> = &'a dyn Fn(&Path, &str) -> Result<Stores, StoreError>;

/// Builds the command that runs one writer child against the directory.
pub type SpawnWriter = fn(&Path) -> Command;

/// One space's stores. `index` is `None` until the backend has built its search index; the index
/// groups are then skipped.
#[derive(Clone)]
pub struct Stores {
    /// Documents, records and changes.
    pub documents: Arc<dyn DocumentStore>,
    /// The structural graph.
    pub graph: Arc<dyn GraphStore>,
    /// The lexical lane, when built.
    pub index: Option<Arc<dyn SearchIndex>>,
}

/// What happened to one case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// It held.
    Passed,
    /// It did not, with why.
    Failed(String),
    /// It did not run, with why.
    Skipped(String),
}

/// One case's result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaseReport {
    /// The case's name.
    pub name: &'static str,
    /// What happened.
    pub outcome: Outcome,
}

/// One group's results.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupReport {
    /// The group's name.
    pub name: &'static str,
    /// Its cases.
    pub cases: Vec<CaseReport>,
}

impl GroupReport {
    /// Whether any case failed.
    #[must_use]
    pub fn failed(&self) -> bool {
        self.cases.iter().any(|c| matches!(c.outcome, Outcome::Failed(_)))
    }
}

/// The suite's report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// The groups, in run order.
    pub groups: Vec<GroupReport>,
}

impl Report {
    /// The group named `name`.
    #[must_use]
    pub fn group(&self, name: &str) -> Option<&GroupReport> {
        self.groups.iter().find(|g| g.name == name)
    }

    /// Every failure as `group::case: why`.
    #[must_use]
    pub fn failures(&self) -> Vec<String> {
        self.collect(|o| match o {
            Outcome::Failed(why) => Some(why.clone()),
            _ => None,
        })
    }

    /// Every skipped case as `group::case: why`.
    #[must_use]
    pub fn skipped(&self) -> Vec<String> {
        self.collect(|o| match o {
            Outcome::Skipped(why) => Some(why.clone()),
            _ => None,
        })
    }

    /// How many cases passed.
    #[must_use]
    pub fn passed(&self) -> usize {
        self.groups
            .iter()
            .flat_map(|g| &g.cases)
            .filter(|c| c.outcome == Outcome::Passed)
            .count()
    }

    fn collect(&self, pick: impl Fn(&Outcome) -> Option<String>) -> Vec<String> {
        self.groups
            .iter()
            .flat_map(|g| g.cases.iter().map(move |c| (g.name, c)))
            .filter_map(|(group, case)| {
                pick(&case.outcome).map(|why| format!("{group}::{}: {why}", case.name))
            })
            .collect()
    }

    /// Panic with every failure unless all cases passed or were skipped.
    ///
    /// # Panics
    /// When a case failed.
    pub fn assert_passed(&self) {
        let failures = self.failures();
        assert!(failures.is_empty(), "conformance failures:\n{}", failures.join("\n"));
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for group in &self.groups {
            for case in &group.cases {
                let (mark, note) = match &case.outcome {
                    Outcome::Passed => ("ok", String::new()),
                    Outcome::Failed(why) => ("FAILED", format!(": {why}")),
                    Outcome::Skipped(why) => ("skipped", format!(": {why}")),
                };
                writeln!(f, "{}::{} {mark}{note}", group.name, case.name)?;
            }
        }
        Ok(())
    }
}

/// What a case returns: `Ok(Verdict)` or why it failed.
pub(crate) type CaseResult = Result<Verdict, String>;

/// A case that ran to its end.
pub(crate) enum Verdict {
    Pass,
    Skip(String),
}

pub(crate) fn pass() -> CaseResult {
    Ok(Verdict::Pass)
}

pub(crate) fn skip(why: &str) -> CaseResult {
    Ok(Verdict::Skip(why.to_owned()))
}

type CaseFn = fn(&Env<'_>) -> CaseResult;

/// What a case needs: the factory and, maybe, a writer command.
pub(crate) struct Env<'a> {
    pub(crate) factory: Factory<'a>,
    pub(crate) spawn_writer: Option<SpawnWriter>,
}

/// A directory and the stores opened in it.
pub(crate) struct Fresh {
    pub(crate) dir: tempfile::TempDir,
    pub(crate) stores: Stores,
}

impl Env<'_> {
    /// A new empty directory with fresh stores.
    pub(crate) fn fresh(&self) -> Result<Fresh, String> {
        let dir = tempfile::tempdir().map_err(|e| format!("a temporary directory: {e}"))?;
        let stores = (self.factory)(dir.path(), SPACE).map_err(|e| format!("opening fresh stores: {e}"))?;
        Ok(Fresh { dir, stores })
    }
}

/// `Result<_, StoreError>` into `Result<_, String>` with what was being done.
pub(crate) trait Ctx<T> {
    fn ctx(self, what: &str) -> Result<T, String>;
}

impl<T> Ctx<T> for Result<T, StoreError> {
    fn ctx(self, what: &str) -> Result<T, String> {
        self.map_err(|e| format!("{what}: {e}"))
    }
}

pub(crate) fn ensure(condition: bool, what: &str) -> Result<(), String> {
    if condition { Ok(()) } else { Err(what.to_owned()) }
}

pub(crate) fn ensure_eq<T: Debug + PartialEq>(left: T, right: T, what: &str) -> Result<(), String> {
    if left == right {
        Ok(())
    } else {
        Err(format!("{what}: left {left:?}, right {right:?}"))
    }
}

/// Require a particular error kind.
pub(crate) fn expect_err<T: Debug>(
    result: Result<T, StoreError>,
    what: &str,
    is: impl Fn(&StoreError) -> bool,
) -> Result<(), String> {
    match result {
        Err(e) if is(&e) => Ok(()),
        Err(e) => Err(format!("{what}: got the wrong error: {e}")),
        Ok(v) => Err(format!("{what}: expected an error, got {v:?}")),
    }
}

pub(crate) fn invalid(error: &StoreError) -> bool {
    matches!(error, StoreError::Invalid(_))
}

pub(crate) fn conflict(error: &StoreError) -> bool {
    matches!(error, StoreError::Conflict { .. })
}

/// A reader holding these tokens.
pub(crate) fn reader(tokens: &[&str]) -> crate::ReaderFilter {
    crate::ReaderFilter::tokens(tokens.iter().copied()).unwrap_or_else(|_| crate::ReaderFilter::derivation())
}

/// A reader that may read what `space` guards.
pub(crate) fn everyone() -> crate::ReaderFilter {
    reader(&["space"])
}

type Group = (&'static str, &'static [(&'static str, CaseFn)]);

const GROUPS: &[Group] = &[
    ("documents", documents::CASES),
    ("records", records::CASES),
    ("changes", changes::CASES),
    ("envelope", envelope::CASES),
    ("access", access::CASES),
    ("graph", graph::CASES),
    ("concurrency", concurrency::CASES),
    ("durability", durability::CASES),
];

/// Run every case group against a backend. `spawn_writer` enables the multi-process cases; the
/// index cases wait for a backend whose stores carry an index.
#[must_use]
pub fn run_all(factory: Factory<'_>, spawn_writer: Option<SpawnWriter>) -> Report {
    let env = Env { factory, spawn_writer };
    let groups = GROUPS
        .iter()
        .map(|(name, cases)| GroupReport {
            name,
            cases: cases
                .iter()
                .map(|(case, run)| CaseReport { name: case, outcome: run_case(&env, *run) })
                .collect(),
        })
        .collect();
    Report { groups }
}

fn run_case(env: &Env<'_>, case: CaseFn) -> Outcome {
    match catch_unwind(AssertUnwindSafe(|| case(env))) {
        Ok(Ok(Verdict::Pass)) => Outcome::Passed,
        Ok(Ok(Verdict::Skip(why))) => Outcome::Skipped(why),
        Ok(Err(why)) => Outcome::Failed(why),
        Err(_) => Outcome::Failed("the case panicked".to_owned()),
    }
}
