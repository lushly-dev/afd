//! The doctor's store checks on a sealed host (phase 2 specification, section 3.5):
//! `stores.version`, `stores.access` and `stores.lag`, and phase 3's seven memory checks
//! (section 5.3). They open the stores of every space that
//! already has one; a space nothing has written to is not given an empty store by a health check.

use crate::doctor::Check;
use crate::store::{Hub, codes};
use crate::workspace::Workspace;
use std::path::PathBuf;
use std::sync::Arc;
use umbel_store::memory::{KeyFileState, Retention};
use umbel_store::{MemoryStore, StoreError};

/// The three checks, in order.
pub(crate) fn checks(workspace: &Workspace, stores: &Hub) -> [Check; 3] {
    let mut opened = Vec::new();
    let mut version = None;
    for space in workspace.spaces() {
        let dir = workspace.layout().space_state_dir(&space.id);
        if !dir.join("store").join("store.sqlite3").is_file() && !dir.join("index").is_dir() {
            continue;
        }
        match stores.space(space.id.as_str()) {
            Ok(space_stores) => opened.push((space.id.to_string(), space_stores)),
            Err(StoreError::VersionUnsupported { found, supported }) => {
                version = Some(Check::fail(
                    "stores.version",
                    format!(
                        "the store of `{}` is version {found}; this build serves up to version {supported}",
                        space.id
                    ),
                    "Upgrade umbel to a version that serves this store.",
                ));
            }
            Err(error) => {
                version = Some(Check::fail(
                    "stores.version",
                    format!("the stores of `{}` cannot be opened: {error}", space.id),
                    "Run store-check for the space.",
                ));
            }
        }
    }
    let version = version.unwrap_or_else(|| {
        Check::pass(
            "stores.version",
            if opened.is_empty() {
                "No space has a store yet".to_owned()
            } else {
                format!("{} space store(s) open at a served version", opened.len())
            },
        )
    });
    let mut broken = Vec::new();
    let mut behind = Vec::new();
    for (space, stores) in &opened {
        match stores.sqlite.access_problems() {
            Ok(problems) if problems.is_empty() => {}
            Ok(problems) => broken.push(format!("{space}: {}", problems.join(", "))),
            Err(error) => broken.push(format!("{space}: {error}")),
        }
        let head = stores.documents.head().unwrap_or(0);
        let index = stores.index.applied().unwrap_or(0);
        let graph = stores.graph.applied().unwrap_or(0);
        if index < head || graph < head {
            behind.push(format!(
                "{space}: index {index}, graph {graph}, head {head}"
            ));
        }
    }
    let access = if broken.is_empty() {
        Check::pass("stores.access", "every stored row has an access token")
    } else {
        Check::fail(
            "stores.access",
            format!("rows without an access token: {}", broken.join("; ")),
            "Run store-check for the space and restore from a store-backup.",
        )
    };
    let lag = if behind.is_empty() {
        Check::pass(
            "stores.lag",
            "every index and graph reflects its store's head",
        )
    } else {
        Check::warn(
            "stores.lag",
            format!("behind the head: {}", behind.join("; ")),
            "Run knowledge-index (or knowledge-refresh) for the space.",
        )
    };
    [version, access, lag]
}

/// The memory checks, in order: phase 3 section 5.3's `stores.memory`, `stores.memory_keys`,
/// `stores.memory_modes`, `stores.memory_backup`, `stores.principals`, `stores.sweep` and
/// `stores.capture`, and phase 5 section 8.4's `stores.memory_erase`. A space whose memory nothing
/// has written is left as it is: opening its memory store creates nothing.
pub(crate) fn memory_checks(workspace: &Workspace, stores: &Hub, now: i64) -> [Check; 8] {
    let mut provisioned = Vec::new();
    let mut opens = Vec::new();
    let mut keys = Vec::new();
    for space in workspace.spaces() {
        let Ok(memory) = stores.memory(space.id.as_str()) else {
            continue;
        };
        match memory.info() {
            Err(StoreError::NotProvisioned) => continue,
            Err(error @ StoreError::VersionUnsupported { .. }) => {
                opens.push(format!("{}: {error}", space.id));
            }
            Ok(_) | Err(StoreError::KeysMissing | StoreError::KeysMismatch) => {}
            Err(error) => opens.push(format!("{}: {error}", space.id)),
        }
        match memory.key_status().map(|status| status.file) {
            Ok(KeyFileState::Present) => match memory.keys_integrity_check() {
                Ok(findings) if findings.is_empty() => {}
                Ok(findings) => keys.push(format!("{}: {}", space.id, findings.join("; "))),
                Err(error) => keys.push(format!("{}: {error}", space.id)),
            },
            Ok(KeyFileState::Missing) | Err(StoreError::KeysMissing) => {
                keys.push(format!("{}: {}", space.id, codes::MEMORY_KEYS_MISSING));
            }
            Ok(KeyFileState::Mismatch) | Err(StoreError::KeysMismatch) => {
                keys.push(format!("{}: {}", space.id, codes::MEMORY_KEYS_MISMATCH));
            }
            Err(error) => keys.push(format!("{}: {error}", space.id)),
        }
        provisioned.push((space.id.to_string(), memory));
    }
    let opened = if opens.is_empty() {
        Check::pass(
            "stores.memory",
            if provisioned.is_empty() {
                "No space has a memory store yet".to_owned()
            } else {
                format!(
                    "{} memory store(s) open at a served version",
                    provisioned.len()
                )
            },
        )
    } else {
        Check::fail(
            "stores.memory",
            format!("memory stores that do not open: {}", opens.join("; ")),
            "Upgrade umbel to a version that serves the store, or run store-check for the space.",
        )
    };
    let key_check = if keys.is_empty() {
        Check::pass(
            "stores.memory_keys",
            "every provisioned memory store has its own key file, and it passes its integrity check",
        )
    } else {
        Check::fail(
            "stores.memory_keys",
            format!("memory key files: {}", keys.join("; ")),
            "MEMORY_KEYS_MISSING: restore memory.keys from your own backup. MEMORY_KEYS_MISMATCH: put back the memory.keys that belongs to the database. Never recreate it: memory cannot be derived.",
        )
    };
    let files: Vec<PathBuf> = provisioned
        .iter()
        .flat_map(|(_, memory)| memory.files())
        .filter(|path| path.exists())
        .collect();
    let exclude = workspace.config().store.exclude_memory_from_machine_backup;
    [
        opened,
        key_check,
        modes_check(&files),
        backup_check(&files, exclude),
        principals_check(workspace),
        sweep_check(&provisioned, now),
        capture_check(hook_state_file().as_deref()),
        memory_erase_check(workspace.config()),
    ]
}

/// `stores.memory_erase` (phase 5 section 8.4, owner decision 9): warns for each instance whose
/// `erasers` can name two people while `erase_approvals` is 1, so one eraser could erase alone
/// where two are available. Two people: two `principal:` entries or static group members that are
/// not one person through `[principal.equivalents]`, or a group that takes members from a token's
/// claim, which can name any number. A group's `*` names no eraser (the host admits only named
/// holders), and is reported too.
pub(crate) fn memory_erase_check(config: &crate::workspace::Config) -> Check {
    let person = |principal: &str| {
        config
            .principal
            .equivalents
            .get(principal)
            .cloned()
            .unwrap_or_else(|| principal.to_owned())
    };
    let mut alone = Vec::new();
    let mut starred = Vec::new();
    for instance in &config.plugins.instances {
        let Some(policy) = &instance.memory_write else {
            continue;
        };
        let mut people = std::collections::BTreeSet::new();
        let mut open = false;
        for token in &policy.erasers {
            if let Some(principal) = token.strip_prefix("principal:") {
                people.insert(person(principal));
            } else if let Some(id) = token.strip_prefix("group:")
                && let Some(group) = config.access.groups.iter().find(|group| group.id == id)
            {
                open |= group.claim.is_some();
                for member in &group.members {
                    if member == "*" {
                        starred.push(format!("{} (group:{id})", instance.id));
                    } else {
                        people.insert(person(member));
                    }
                }
            }
        }
        if policy.erase_approvals < 2 && (open || people.len() >= 2) {
            alone.push(instance.id.clone());
        }
    }
    if alone.is_empty() && starred.is_empty() {
        return Check::pass(
            "stores.memory_erase",
            "no memory_write grant lets one eraser erase alone where two are available",
        );
    }
    let mut message = Vec::new();
    if !alone.is_empty() {
        message.push(format!(
            "{} list erasers who can be two people with erase_approvals = 1: one eraser erases alone",
            alone.join(", ")
        ));
    }
    if !starred.is_empty() {
        message.push(format!(
            "erasers name a group whose members include \"*\", which names no eraser: {}",
            starred.join(", ")
        ));
    }
    Check::warn(
        "stores.memory_erase",
        message.join("; "),
        "Set erase_approvals = 2 under the memory_write grant, so a second eraser, another person, approves each erase; name erasers by principal or by named group members.",
    )
}

/// `stores.memory_modes`: no group or other bits on the memory files, on Unix.
fn modes_check(files: &[PathBuf]) -> Check {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let wide: Vec<String> = files
            .iter()
            .filter(|path| {
                std::fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o077 != 0)
            })
            .map(|path| path.display().to_string())
            .collect();
        if wide.is_empty() {
            Check::pass(
                "stores.memory_modes",
                "the memory files are readable by their owner alone",
            )
        } else {
            Check::fail(
                "stores.memory_modes",
                format!(
                    "memory files readable beyond their owner: {}",
                    wide.join(", ")
                ),
                "chmod 600 each file: they hold whole conversations and their keys.",
            )
        }
    }
    #[cfg(not(unix))]
    {
        let _ = files;
        Check::pass(
            "stores.memory_modes",
            "this system has no owner-only file mode: the memory files are as private as the user's profile",
        )
    }
}

/// `stores.memory_backup` (D87).
fn backup_check(files: &[PathBuf], exclude: bool) -> Check {
    const HOW: &str = "Memory is not in machine backups: back it up with store-backup, plus a separate copy of memory.keys taken after it.";
    if !cfg!(target_os = "macos") {
        return Check::pass(
            "stores.memory_backup",
            format!(
                "{HOW} This system sets no exclusion, so a backup tool copies the memory files, with every live record's text in clear in the index"
            ),
        );
    }
    let wrong: Vec<String> = files
        .iter()
        .filter(|path| {
            umbel_store_embedded::is_excluded_from_machine_backup(path)
                .is_ok_and(|excluded| excluded != exclude)
        })
        .map(|path| path.display().to_string())
        .collect();
    if wrong.is_empty() {
        let state = if exclude {
            "excluded from"
        } else {
            "included in"
        };
        Check::pass(
            "stores.memory_backup",
            format!(
                "{HOW} The memory files are {state} Time Machine, as store.exclude_memory_from_machine_backup says"
            ),
        )
    } else if exclude {
        Check::warn(
            "stores.memory_backup",
            format!(
                "memory files without the Time Machine exclusion: {}",
                wrong.join(", ")
            ),
            "The next memory write sets it; a file copied into place arrives unmarked.",
        )
    } else {
        Check::warn(
            "stores.memory_backup",
            format!(
                "memory files still excluded from Time Machine with the setting false: {}",
                wrong.join(", ")
            ),
            "The next memory write removes the exclusion.",
        )
    }
}

/// `stores.principals` (section 3.2): an instance holding `memory_write` with `on_behalf_of`
/// absent or not `local_id`, so a stdio agent's records are not its person's.
fn principals_check(workspace: &Workspace) -> Check {
    let config = workspace.config();
    let writers: Vec<&str> = config
        .plugins
        .instances
        .iter()
        .filter(|instance| {
            instance
                .allow
                .get("memory_write")
                .is_some_and(|allow| !allow.is_empty())
                && !instance.deny.iter().any(|denied| denied == "memory_write")
        })
        .map(|instance| instance.id.as_str())
        .collect();
    let principal = &config.principal;
    if writers.is_empty() || principal.on_behalf_of.as_deref() == Some(principal.local_id.as_str())
    {
        return Check::pass(
            "stores.principals",
            "a stdio agent's memory is its person's: on_behalf_of equals local_id, or no instance holds memory_write",
        );
    }
    Check::warn(
        "stores.principals",
        format!(
            "{} hold memory_write and principal.on_behalf_of is {}, not local_id `{}`: a hook's captures at the CLI would be invisible to the same person's stdio agent",
            writers.join(", "),
            principal
                .on_behalf_of
                .as_deref()
                .map_or_else(|| "absent".to_owned(), |p| format!("`{p}`")),
            principal.local_id
        ),
        "Set on_behalf_of = local_id under [principal] in umbel.toml, as umbel init writes it.",
    )
}

/// `stores.sweep` (section 8.8): records past their purge date by the default retention, and no
/// sweep's purge in 30 days.
fn sweep_check(
    provisioned: &[(String, Arc<umbel_store_embedded::SqliteMemoryStore>)],
    now: i64,
) -> Check {
    const DAYS_30: i64 = 30 * 86_400_000;
    let mut overdue = Vec::new();
    for (space, memory) in provisioned {
        if let Ok(state) = memory.maintenance(now, Retention::default())
            && state.past_purge > 0
            && state.last_purge.is_none_or(|at| now - at > DAYS_30)
        {
            overdue.push(format!("{space}: {}", state.past_purge));
        }
    }
    if overdue.is_empty() {
        Check::pass(
            "stores.sweep",
            "no space holds records past their purge date without a sweep in 30 days",
        )
    } else {
        Check::warn(
            "stores.sweep",
            format!(
                "records past their purge date (by the default retention) and no sweep in 30 days: {}",
                overdue.join("; ")
            ),
            "Run memory-sweep for the space, from cron, CI or a SessionEnd hook; every write also purges a few.",
        )
    }
}

/// `$XDG_STATE_HOME/umbel-hook/last-error.json`, else under `~/.local/state` (section 10.3).
fn hook_state_file() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state"))
        })?;
    Some(base.join("umbel-hook").join("last-error.json"))
}

/// `stores.capture`: a hook's last unresolved failure, while its state file exists. It holds
/// `{ at, profile, event, code, count }` and never text.
pub(crate) fn capture_check(file: Option<&std::path::Path>) -> Check {
    let Some(file) = file.filter(|file| file.is_file()) else {
        return Check::pass("stores.capture", "no hook failure is unresolved");
    };
    let state: serde_json::Value = std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let field = |key: &str| {
        state
            .get(key)
            .map(|value| {
                value
                    .as_str()
                    .map_or_else(|| value.to_string(), str::to_owned)
            })
            .unwrap_or_else(|| "?".to_owned())
    };
    Check::warn(
        "stores.capture",
        format!(
            "the {} hook's {} event failed with {} ({} time(s), last at {})",
            field("profile"),
            field("event"),
            field("code"),
            field("count"),
            field("at")
        ),
        "Run umbel-hook status, fix the cause, and the next successful capture clears it.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_capture_check_warns_while_the_state_file_exists() {
        let dir = std::env::temp_dir().join(format!("umbel-capture-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("last-error.json");
        let _ = std::fs::remove_file(&file);
        assert_eq!(
            capture_check(Some(&file)).status,
            crate::doctor::CheckStatus::Pass
        );
        assert_eq!(capture_check(None).status, crate::doctor::CheckStatus::Pass);
        let _ = std::fs::write(
            &file,
            r#"{"at":"2026-11-03T00:00:00Z","profile":"claude-code","event":"stop","code":"MEMORY_QUOTA_EXCEEDED","count":2}"#,
        );
        let warned = capture_check(Some(&file));
        assert_eq!(warned.status, crate::doctor::CheckStatus::Warn);
        assert!(
            warned.message.contains("MEMORY_QUOTA_EXCEEDED"),
            "{}",
            warned.message
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn config(policy: &str, groups: &str) -> crate::workspace::Config {
        let text = format!(
            "config_version = 5\ndefault_space = \"main\"\n[principal]\nlocal_id = \"ada\"\n[spaces.main]\n{groups}\n[plugins]\nenabled = [\"memory\"]\n[plugins.memory]\nsource = \"compiled:memory\"\n[plugins.memory.grants.memory_write]\nallow = [\"main\"]\n{policy}\n"
        );
        crate::workspace::ConfigFile::parse(&text)
            .and_then(|file| file.into_config(std::path::Path::new("/w")))
            .expect("a valid configuration")
    }

    #[test]
    fn the_erase_check_warns_where_one_eraser_could_erase_alone() {
        use crate::doctor::CheckStatus::{Pass, Warn};
        let status =
            |policy: &str, groups: &str| memory_erase_check(&config(policy, groups)).status;
        // No erasers, or one person, or two with the two-person rule: nothing to say.
        assert_eq!(status("", ""), Pass);
        assert_eq!(status("erasers = [\"principal:human:corp/ada\"]", ""), Pass);
        assert_eq!(
            status(
                "erasers = [\"principal:human:corp/ada\", \"principal:human:corp/bo\"]\nerase_approvals = 2",
                ""
            ),
            Pass
        );
        // Two people with one approval: warned, by principals or by a group's members.
        assert_eq!(
            status(
                "erasers = [\"principal:human:corp/ada\", \"principal:human:corp/bo\"]",
                ""
            ),
            Warn
        );
        assert_eq!(
            status(
                "erasers = [\"group:admins\"]",
                "[access.groups.admins]\nmembers = [\"human:corp/ada\", \"human:corp/bo\"]"
            ),
            Warn
        );
        // A group of everyone names no eraser, and is said so.
        let starred = memory_erase_check(&config(
            "erasers = [\"group:everyone\"]",
            "[access.groups.everyone]\nmembers = [\"*\"]",
        ));
        assert_eq!(starred.status, Warn);
        assert!(
            starred.message.contains("names no eraser"),
            "{}",
            starred.message
        );
    }
}
