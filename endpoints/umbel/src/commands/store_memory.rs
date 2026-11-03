//! The memory store in `store-show`, `store-check` and `store-backup` (phase 3 specification,
//! sections 5.3 and 5.4). Counts, ids, sizes and states only: no text.

use std::collections::HashSet;
use std::path::Path;

use serde_json::{Value, json};
use umbel_store::memory::{ClassCounts, KeyFileState, MemoryClass};
use umbel_store::{MemoryStore, ReaderFilter, StoreError};
use umbel_store_embedded::SqliteMemoryStore;

use crate::doctor::Check;
use crate::store::{KEYS_MISMATCH_SUGGESTION, KEYS_MISSING_SUGGESTION, codes, command_error};

/// `memory-status`'s default window for `expiringSoon` (pack `policy`, 14 days).
const EXPIRING_SOON_MS: i64 = 14 * 86_400_000;
/// A change newer than this may not have its journal entry yet.
const RECENT_MS: i64 = 60_000;
/// The most trace ids a finding names.
const NAMED: usize = 10;

fn size(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |meta| meta.len())
}

pub(super) fn key_file_text(state: KeyFileState) -> &'static str {
    match state {
        KeyFileState::Present => "present",
        KeyFileState::Missing => "missing",
        KeyFileState::Mismatch => "mismatch",
    }
}

fn class_counts(counts: &ClassCounts) -> Value {
    json!({
        "live": counts.live,
        "flagged": counts.flagged,
        "notYetValid": counts.not_yet_valid,
        "invalidated": counts.invalidated,
        "expired": counts.expired,
        "expiringSoon": counts.expiring_soon,
    })
}

/// `store-show`'s `memory`: `provisioned`, then the counts by class and state over what the
/// caller can read, the key file's state and the files' sizes; `head` only for a person at the
/// CLI, since it counts what the reader filter hides.
pub(super) fn show(
    memory: &SqliteMemoryStore,
    filter: &ReaderFilter,
    totals: bool,
    now: i64,
) -> Result<Value, afd::CommandError> {
    let fail = |error: StoreError| command_error(&error);
    let counts = match memory.counts(now, EXPIRING_SOON_MS, filter) {
        Ok(counts) => counts,
        Err(StoreError::NotProvisioned) => return Ok(json!({ "provisioned": false })),
        Err(error) => return Err(fail(error)),
    };
    let by_class: serde_json::Map<String, Value> = MemoryClass::ALL
        .iter()
        .map(|class| {
            let counts = counts.by_class.get(class).copied().unwrap_or_default();
            (class.as_str().to_owned(), class_counts(&counts))
        })
        .collect();
    let key_file = memory.key_status().map_err(fail)?.file;
    let database = memory.database_path();
    let mut data = json!({
        "provisioned": true,
        "counts": { "byClass": by_class, "unreadable": counts.unreadable },
        "keyFile": key_file_text(key_file),
        "files": {
            "databaseBytes": size(&database),
            "walBytes": size(Path::new(&format!("{}-wal", database.display()))),
            "keysBytes": size(&memory.keys_path()),
        },
    });
    if totals {
        data["head"] = json!(memory.head().map_err(fail)?);
    }
    Ok(data)
}

/// `store-check`'s memory checks. Runs the store's checkpoint first, which truncates the WAL
/// and settles markers whose rows are gone, then reads; it changes nothing else.
pub(super) fn checks(
    memory: &SqliteMemoryStore,
    journal: &HashSet<String>,
    now: i64,
) -> Vec<Check> {
    let mut checks = Vec::new();
    let checkpoint = memory.checkpoint();
    let check = match memory.check() {
        Ok(check) => check,
        Err(StoreError::NotProvisioned) => {
            checks.push(Check::pass(
                "store.memory",
                "the memory store is not provisioned: nothing has been written to it",
            ));
            return checks;
        }
        Err(StoreError::KeysMissing) => {
            checks.push(Check::fail(
                "store.memory_keys",
                format!(
                    "{}: memory.keys does not exist beside memory.sqlite3",
                    codes::MEMORY_KEYS_MISSING
                ),
                KEYS_MISSING_SUGGESTION,
            ));
            return checks;
        }
        Err(StoreError::KeysMismatch) => {
            checks.push(Check::fail(
                "store.memory_keys",
                format!(
                    "{}: memory.keys does not belong to memory.sqlite3",
                    codes::MEMORY_KEYS_MISMATCH
                ),
                KEYS_MISMATCH_SUGGESTION,
            ));
            return checks;
        }
        Err(error) => {
            checks.push(Check::fail(
                "store.memory",
                format!("the memory store cannot be checked: {error}"),
                "Restore memory.sqlite3 from a store-backup, beside its memory.keys.",
            ));
            return checks;
        }
    };
    checks.push(if check.integrity.is_empty() {
        Check::pass(
            "store.memory",
            "SQLite's integrity check of memory.sqlite3 passed",
        )
    } else {
        Check::fail(
            "store.memory",
            format!(
                "SQLite reports on memory.sqlite3: {}",
                check.integrity.join("; ")
            ),
            "Restore memory.sqlite3 from a store-backup, beside its memory.keys.",
        )
    });
    checks.push(if check.keys_integrity.is_empty() {
        Check::pass(
            "store.memory_keys",
            format!(
                "memory.keys belongs to this database and passes its integrity check; {} orphan key(s), {} unsettled marker(s)",
                check.orphans, check.unsettled
            ),
        )
    } else {
        Check::fail(
            "store.memory_keys",
            format!("SQLite reports on memory.keys: {}", check.keys_integrity.join("; ")),
            "Restore memory.keys from your own backup.",
        )
    });
    let counts_agree = check.indexed == check.derived && check.indexed == check.fts_rows;
    checks.push(match (&check.fts, counts_agree) {
        (None, true) => Check::pass(
            "store.memory_index",
            format!(
                "the lexical lane holds the {} indexed record(s)",
                check.indexed
            ),
        ),
        (Some(error), _) => Check::fail(
            "store.memory_index",
            format!("FTS5's integrity check fails: {error}"),
            "Run memory-reindex: the lexical lane is rebuilt from the sealed records.",
        ),
        (None, false) => Check::fail(
            "store.memory_index",
            format!(
                "indexed records ({}), derived rows ({}) and index rows ({}) differ",
                check.indexed, check.derived, check.fts_rows
            ),
            "Run memory-reindex: the lexical lane is rebuilt from the sealed records.",
        ),
    });
    checks.push(if check.access.is_empty() {
        Check::pass(
            "store.memory_access",
            "every memory record and change has an access token",
        )
    } else {
        Check::fail(
            "store.memory_access",
            format!("rows without an access token: {}", check.access.join(", ")),
            "Restore memory.sqlite3 from a store-backup.",
        )
    });
    let unreadable: Vec<&String> = check.absent.iter().chain(&check.seal_invalid).collect();
    checks.push(if !unreadable.is_empty() || !check.not_indexed.is_empty() {
        Check::fail(
            "store.memory_rows",
            format!(
                "records that do not open: {} with no key entry ({}), {} whose seal fails ({}), {} not indexed",
                check.absent.len(),
                codes::MEMORY_KEY_ABSENT,
                check.seal_invalid.len(),
                codes::MEMORY_SEAL_INVALID,
                check.not_indexed.len()
            ),
            "Restore memory.keys from your own backup, or forget the records that do not open.",
        )
    } else if !check.marked.is_empty() {
        Check::warn(
            "store.memory_rows",
            format!(
                "{} record(s) whose key was destroyed still have rows: a file-level copy was put back",
                check.marked.len()
            ),
            "Run memory-reindex, which removes them and their plaintext index rows.",
        )
    } else if check.unsettled > 0 {
        Check::warn(
            "store.memory_rows",
            format!("{} erasure(s) have not finished their checkpoint", check.unsettled),
            "Close the processes holding the space and run store-check again; the next memory write retries too.",
        )
    } else {
        Check::pass("store.memory_rows", "every memory record opens under its key")
    });
    checks.push(journal_check(memory, journal, now));
    if let Err(error) = checkpoint {
        checks.push(Check::warn(
            "store.memory_checkpoint",
            format!("the memory checkpoint failed: {error}"),
            "Retry store-check later.",
        ));
    }
    checks
}

/// D66's cross-check for memory changes: those older than a minute whose trace id the journal
/// does not hold.
fn journal_check(memory: &SqliteMemoryStore, journal: &HashSet<String>, now: i64) -> Check {
    let mut missing: Vec<String> = Vec::new();
    let mut after = 0;
    loop {
        let page = match memory.change_traces(after, 1000) {
            Ok(page) => page,
            Err(error) => {
                return Check::warn(
                    "store.memory_journal",
                    error.to_string(),
                    "Run workspace-doctor.",
                );
            }
        };
        let Some(last) = page.last() else { break };
        after = last.0;
        for (_, trace, at) in &page {
            if let Some(trace) = trace
                && now - at > RECENT_MS
                && !journal.contains(trace)
                && !missing.contains(trace)
            {
                missing.push(trace.clone());
            }
        }
        if page.len() < 1000 {
            break;
        }
    }
    if missing.is_empty() {
        Check::pass(
            "store.memory_journal",
            "every memory change older than a minute has a journal entry",
        )
    } else {
        Check::warn(
            "store.memory_journal",
            format!(
                "{} memory change(s) older than a minute have no journal entry (trace ids: {})",
                missing.len(),
                missing
                    .iter()
                    .take(NAMED)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "A crash between a memory write and its journal entry leaves this; nothing is lost but the audit line.",
        )
    }
}
