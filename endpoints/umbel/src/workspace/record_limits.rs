//! The records write quota (decision D212, records host specification section 4.2):
//! `limits.kind_records` and `limits.kind_postings`, keys configuration version 8 adds to the
//! `[limits]` table older versions have (additively, by D188's rule). Each limits what one
//! principal's records may hold in one declared record kind of one space.
//!
//! **The defaults apply in a hosted mode** (`auth.mode` `oauth` or `gateway`), as `[limits]`'s
//! rate limits do: there several principals write to one space, which is what the quota is for.
//! In mode `none` every caller is on the deployer's own machine, usually as one principal, and a
//! quota would cap that person's own records for good (no service deletes a declared record), so
//! a key limits only when it is set; a mode-`none` workspace with several principals sets them.
//! Before version 8 the keys are refused and the defaults are the mode's.

use toml::Value;
use umbel_store::lane::{MATCH_POSTINGS, RecordQuota};

use super::config::{ConfigFile, KeyScan, Reader};
use super::error::WorkspaceError;
use super::hosted::is_v5_key;
use super::person::is_v7_key;
use super::records::is_v6_key;

/// The default `limits.kind_records` in a hosted mode: memory's default `stored_records` (D74),
/// and half the 100 000 records past which the doctor's `records.size` warns.
pub const DEFAULT_KIND_RECORDS: u64 = 50_000;
/// The default `limits.kind_postings` in a hosted mode: a quarter of the match bound
/// (`MATCH_POSTINGS`), so one principal's puts fill at most a quarter of a kind's matching size.
pub const DEFAULT_KIND_POSTINGS: u64 = MATCH_POSTINGS / 4;
/// The most either key may be.
pub const MAX_KIND_LIMIT: u64 = 1_000_000_000;

/// The keys this module reads, under `[limits]`.
const KEYS: &[&str] = &["kind_records", "kind_postings"];

/// The quota of a hosted mode with neither key set: [`DEFAULT_KIND_RECORDS`] and
/// [`DEFAULT_KIND_POSTINGS`].
#[must_use]
pub fn default_record_quota() -> RecordQuota {
    RecordQuota {
        records: DEFAULT_KIND_RECORDS,
        postings: DEFAULT_KIND_POSTINGS,
    }
}

impl ConfigFile {
    /// The records write quota the file sets, each limit between 1 and [`MAX_KIND_LIMIT`]; a key
    /// not set is its default in a `hosted` mode and no limit otherwise.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming a key out of range or not an integer.
    pub fn record_quota(&self, hosted: bool) -> Result<RecordQuota, WorkspaceError> {
        let defaults = if hosted {
            default_record_quota()
        } else {
            RecordQuota::unlimited()
        };
        if self.version() < 8 {
            return Ok(defaults);
        }
        let limits = Reader::new(self.section("limits")?, "limits");
        let max = i64::try_from(MAX_KIND_LIMIT).unwrap_or(i64::MAX);
        Ok(RecordQuota {
            records: limits
                .integer("kind_records", 1, max)?
                .unwrap_or(defaults.records),
            postings: limits
                .integer("kind_postings", 1, max)?
                .unwrap_or(defaults.postings),
        })
    }
}

/// `scan` without this module's keys when the file is of version 8 or later and they are keys
/// of its `[limits]` table: a key of the same spelling anywhere else (a quoted
/// `"limits.kind_records"` at the top) stays unknown.
pub(super) fn known(table: &toml::Table, version: u32, mut scan: KeyScan) -> KeyScan {
    if version >= 8
        && let Some(Value::Table(limits)) = table.get("limits")
    {
        scan.unknown.retain(|key| {
            !key.strip_prefix("limits.")
                .is_some_and(|name| KEYS.contains(&name) && limits.contains_key(name))
        });
    }
    scan
}

/// Whether `key` is one of this module's, for the message an older version gives it.
pub(super) fn is_v8_key(key: &str) -> bool {
    key.strip_prefix("limits.")
        .is_some_and(|name| KEYS.contains(&name))
}

/// Why `key`, which the scan of a file of configuration version `version` found unknown, is
/// refused: the version that adds it, or that it is not a known key. Here because the reasons
/// end with version 8's.
pub(super) fn unknown_key(version: u32, key: &str) -> &'static str {
    if version >= 3 && key.ends_with(".content_roots") {
        "was replaced by collections in configuration version 3; declare [spaces.<id>.collections.<cid>] with a root"
    } else if version < 5 && is_v5_key(key) {
        "needs config_version = 5"
    } else if version < 6 && is_v6_key(key) {
        "needs config_version = 6"
    } else if version < 7 && is_v7_key(key) {
        "needs config_version = 7"
    } else if version < 8 && is_v8_key(key) {
        "needs config_version = 8"
    } else {
        "is not a known key"
    }
}
