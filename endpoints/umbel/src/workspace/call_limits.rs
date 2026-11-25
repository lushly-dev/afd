//! The bound and the deadline of compiled-plugin calls and the cap on the threads at work on the
//! SQLite stores (decision D204): `limits.compiled_calls`, `limits.compiled_timeout_ms` and
//! `store.max_connections`, keys configuration version 7 adds to tables older versions have
//! (additively, by D188's rule). Before version 7 the defaults apply and the keys are refused.

use super::config::{ConfigFile, KeyScan, Reader};
use super::error::WorkspaceError;

/// The default `limits.compiled_calls`: AFD's default batch parallelism, so one batch's parallel
/// steps all run at once.
pub const DEFAULT_COMPILED_CALLS: u64 = 16;
/// The most `limits.compiled_calls` may be.
pub const MAX_COMPILED_CALLS: u64 = 1_024;
/// The default `limits.compiled_timeout_ms`: under AFD's MCP default deadline of 30 000 ms, so a
/// caller over MCP gets the host's `OUTCOME_UNKNOWN`, never AFD's retryable `TIMEOUT`.
pub const DEFAULT_COMPILED_TIMEOUT_MS: u64 = 25_000;
/// The most `limits.compiled_timeout_ms` may be: a second under AFD's MCP default deadline
/// (`afd::DEFAULT_COMMAND_TIMEOUT_MS`), the time the registry takes before the handler starts,
/// so AFD's own timer, which answers a retryable `TIMEOUT` while the plugin may still run,
/// never fires first.
pub const MAX_COMPILED_TIMEOUT_MS: u64 = afd::DEFAULT_COMMAND_TIMEOUT_MS - 1_000;
/// The default `store.max_connections`: twice the default `limits.compiled_calls`, so each
/// compiled call can work on a store beside the built-ins without waiting.
pub const DEFAULT_STORE_MAX_CONNECTIONS: u64 = 32;
/// The most `store.max_connections` may be.
pub const MAX_STORE_MAX_CONNECTIONS: u64 = 1_024;

/// The dotted keys this module reads.
const KEYS: &[&str] = &[
    "limits.compiled_calls",
    "limits.compiled_timeout_ms",
    "store.max_connections",
];

/// The three limits, each set or its default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct CallLimits {
    /// The most compiled-plugin calls one host runs at once.
    pub compiled_calls: u64,
    /// How long a compiled-plugin call that is not a task, nor the host's own command line, may
    /// wait for its turn and run before the host answers for it.
    pub compiled_timeout_ms: u64,
    /// The most threads of one host at work on its SQLite stores at once; past it a store call
    /// waits up to `store.lock_timeout_ms`, then answers `STORE_BUSY`.
    pub max_connections: u64,
}

impl Default for CallLimits {
    fn default() -> Self {
        Self {
            compiled_calls: DEFAULT_COMPILED_CALLS,
            compiled_timeout_ms: DEFAULT_COMPILED_TIMEOUT_MS,
            max_connections: DEFAULT_STORE_MAX_CONNECTIONS,
        }
    }
}

impl ConfigFile {
    /// The limits the file sets, each between 1 and its cap.
    ///
    /// # Errors
    /// `WORKSPACE_CONFIG_INVALID` naming a key out of range or not an integer.
    pub fn call_limits(&self) -> Result<CallLimits, WorkspaceError> {
        let defaults = CallLimits::default();
        if self.version() < 7 {
            return Ok(defaults);
        }
        let limits = Reader::new(self.section("limits")?, "limits");
        let store = Reader::new(self.section("store")?, "store");
        let read = |reader: &Reader<'_>, key: &str, max: u64, default: u64| {
            let max = i64::try_from(max).unwrap_or(i64::MAX);
            Ok::<_, WorkspaceError>(reader.integer(key, 1, max)?.unwrap_or(default))
        };
        Ok(CallLimits {
            compiled_calls: read(
                &limits,
                "compiled_calls",
                MAX_COMPILED_CALLS,
                defaults.compiled_calls,
            )?,
            compiled_timeout_ms: read(
                &limits,
                "compiled_timeout_ms",
                MAX_COMPILED_TIMEOUT_MS,
                defaults.compiled_timeout_ms,
            )?,
            max_connections: read(
                &store,
                "max_connections",
                MAX_STORE_MAX_CONNECTIONS,
                defaults.max_connections,
            )?,
        })
    }
}

/// `scan` without this module's keys when the file is of version 7 or later, which knows them.
pub(super) fn known(version: u32, mut scan: KeyScan) -> KeyScan {
    if version >= 7 {
        scan.unknown.retain(|key| !KEYS.contains(&key.as_str()));
    }
    scan
}

/// Whether `key` is one of this module's, for the message an older version gives it.
pub(super) fn is_key(key: &str) -> bool {
    KEYS.contains(&key)
}
