//! The hook's state directory (section 10.3): `<session>.json`, the reader's position in a
//! session's transcript, and `last-error.json`, the last unresolved failure. Both are written by
//! rename, in a directory of mode `0700`, and neither holds text.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::failure::Failure;

/// A session's state. An optimisation: losing it costs only replays.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct State {
    /// The byte offset the next scan starts at: the end of the complete lines read, or the start
    /// of an assistant message still open there.
    pub scanned: u64,
    /// The text turns before `scanned`.
    pub turns: u64,
    /// The first window not yet sent.
    pub next_window: u64,
    /// The byte offset of that window's first turn.
    pub next_window_offset: u64,
    /// Each assistant `message.id` seen, with the offset of the line that started its message:
    /// a later line with the id is a repeat (section 10.3).
    pub message_ids: BTreeMap<String, u64>,
}

const LAST_ERROR: &str = "last-error.json";

/// The state directory, created with mode `0700` when missing.
pub(crate) fn ensure_dir(dir: Option<&Path>) -> Result<PathBuf, Failure> {
    let dir = dir.ok_or_else(|| {
        Failure::new(
            "no-state-dir",
            "neither XDG_STATE_HOME nor HOME is set, so the hook has no state directory",
        )
    })?;
    if !dir.is_dir() {
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(dir).map_err(|_| {
            Failure::new("state-unwritable", "the state directory cannot be created")
        })?;
    }
    Ok(dir.to_path_buf())
}

/// Write `bytes` to `dir/name` by rename, with mode `0600`.
fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = options
        .open(&temporary)
        .and_then(|mut file| file.write_all(bytes).and_then(|()| file.sync_all()));
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    std::fs::rename(&temporary, dir.join(name)).inspect_err(|_| {
        let _ = std::fs::remove_file(&temporary);
    })
}

/// A session's state, or the default when it is missing or does not parse.
pub(crate) fn load(dir: &Path, session: &str) -> State {
    std::fs::read(dir.join(format!("{session}.json")))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Save a session's state.
pub(crate) fn save(dir: &Path, session: &str, state: &State) -> Result<(), Failure> {
    let bytes = serde_json::to_vec(state).unwrap_or_default();
    write_file(dir, &format!("{session}.json"), &bytes)
        .map_err(|_| Failure::new("state-unwritable", "the session's state cannot be written"))
}

/// Record a failure in `last-error.json`: `{ at, profile, event, code, count }`, never text.
/// Best effort: a failure to record it is not reported again.
pub(crate) fn record_error(dir: Option<&Path>, profile: &str, event: &str, code: &str) {
    let Ok(dir) = ensure_dir(dir) else { return };
    let count = std::fs::read(dir.join(LAST_ERROR))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value.get("count").and_then(Value::as_u64))
        .unwrap_or(0)
        + 1;
    // An unknown event word is not repeated: it came from the command line.
    let event = if event.len() <= 32
        && event
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        event
    } else {
        "unknown"
    };
    let record = json!({
        "at": now_rfc3339(),
        "profile": profile,
        "event": event,
        "code": code,
        "count": count,
    });
    let _ = write_file(&dir, LAST_ERROR, record.to_string().as_bytes());
}

/// Remove `last-error.json` after a success.
pub(crate) fn clear_error(dir: Option<&Path>) {
    if let Some(dir) = dir {
        let _ = std::fs::remove_file(dir.join(LAST_ERROR));
    }
}

/// `umbel-hook status`: the last unresolved failure, or `null`.
pub(crate) fn status(dir: Option<&Path>) -> Value {
    let last_error = dir
        .and_then(|dir| std::fs::read(dir.join(LAST_ERROR)).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    json!({
        "stateDir": dir.map(|dir| dir.display().to_string()),
        "lastError": last_error,
    })
}

/// Now, as `YYYY-MM-DDTHH:MM:SSZ`.
fn now_rfc3339() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let rest = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// The proleptic Gregorian date of a day count since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn days_become_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_760), (2026, 11, 3));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
