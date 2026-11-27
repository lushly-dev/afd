//! `<app data>/desktop-state.json` (phase 5 no-terminal amendment, 9.1; D168): what the desktop's own setup has
//! decided (the workspace, the inbound switch, the copilot's providers, each installed plugin and its engine's port
//! and token slot), from which the headless materializer writes `site/`, `mounts.json` and `models.json`. Owner-only,
//! written last as the durable commit point, and never holding a key, a bearer or a plugin's text: a provider's key
//! and an engine's bearer are references to the OS keychain, and a plugin's apps and policy are read from its
//! installed, hash-pinned bundle.
//!
//! Its presence decides the mode (9.1): a state file is `managed`; with none, a deployer's `site/index.html` is `cli`,
//! which `loam-desktop` serves untouched, and anything else is a fresh `managed` install.
use crate::connection::{Unwritten, check_lock_dir, ensure_dir, open_lock_owner_only};
use crate::models::{self, Provider};
use crate::mounts::{Unread, file_owner_only, read_owner_only};
use crate::plugin_manifest::plugin_id;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

/// The file's name in the data directory.
pub const FILE: &str = "desktop-state.json";
/// The exclusive advisory lock serializing startup reconciliation and all state mutations (amendment 7 & 9.1).
pub const LOCK_FILE: &str = "desktop-state.lock";
/// The state file is not one only its owner can read, or could not be written as one: nothing is served from it.
pub const PERMISSIONS: &str = "DESKTOP_STATE_PERMISSIONS";
/// The state file, or an installed bundle it names, is not one the materializer reads.
pub const INVALID: &str = "DESKTOP_STATE_INVALID";
/// The bound on the file, which the materializer also holds a state to before committing it.
pub const FILE_MAX: usize = 1024 * 1024;
/// An engine's loopback port: the dedicated range, outside the systems' ephemeral bands (7.3).
pub const PORTS: RangeInclusive<u16> = 17400..=17999;
/// At most this many providers (phase 5 specification, 4.1).
pub const PROVIDERS_MAX: usize = 16;
/// Instance and workspace ids a site's paths already use (`deployment.v4.json`'s workspace pattern).
const RESERVED_WORKSPACES: &[&str] = &[
    "apps",
    "assets",
    "mounts",
    "sandbox",
    "p",
    "~",
    "deployment.json",
    "index.html",
    "404.html",
    "api",
    "mcp",
    ".well-known",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopState {
    pub desktop_state_version: u32,
    pub workspace: Workspace,
    /// The inbound endpoint's switch (phase 6 specification, 10.8; D137), written into `mounts.json`.
    pub inbound: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copilot: Option<Copilot>,
    #[serde(default)]
    pub plugins: Vec<InstalledPlugin>,
    /// Tokens an uninstall or a rotation could not revoke yet (7.4), retried until `unpair` succeeds.
    #[serde(default)]
    pub pending_revocations: Vec<PendingRevocation>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Copilot {
    /// The provider a turn uses unless it names another; the first when absent, as `deployment write` does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    /// `models.json`'s own records: each provider's kind, model, endpoint and key reference, never a key.
    pub providers: Vec<Provider>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    /// The installed bundle's directory, `<app data>/plugins/<id>/<bundleSha256>/` (7.1's digest).
    pub bundle_sha256: String,
    /// Present exactly when the plugin's manifest has an `[engine]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<EngineState>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EngineState {
    pub port: u16,
    /// The paired token's id: its bearer is in the keychain slot `<instance>.<tokenId>` (5.3). Absent for
    /// `auth.mode = "none"`, with `proofKey`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    /// The engine's persistent, non-bearer instance identity key (5.2), 64 lowercase hex characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proof_key: Option<String>,
    /// D166 opt-in Linux keyring-less fallback: when true, the bearer lives in owner-only
    /// `mounts.json` (mode `0600`) instead of `bearer_keychain`, still behind `proof_key`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub file_fallback: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PendingRevocation {
    pub plugin_id: String,
    pub token_id: String,
    pub binary_path: PathBuf,
    pub failed_at: String,
}

/// Which files `loam-desktop` serves (9.1).
#[derive(Debug, PartialEq, Eq)]
pub enum Mode {
    /// The desktop's own setup decides: the committed state, or none yet on a fresh install.
    Managed(Option<DesktopState>),
    /// A developer's `loam deployment write --host desktop` decides, and its files are served untouched.
    Cli,
}

/// `^[A-Za-z0-9_-]{1,31}$`: a paired token's id (5.1).
pub fn token_id(value: &str) -> bool {
    (1..=31).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// 64 lowercase hexadecimal characters: a SHA-256 digest or a `proofKey`.
pub fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn workspace_valid(workspace: &Workspace) -> bool {
    let mut bytes = workspace.id.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z' | b'0'..=b'9'))
        && workspace.id.len() <= 63
        && bytes.all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'-'))
        && !RESERVED_WORKSPACES.contains(&workspace.id.as_str())
        && (1..=80).contains(&workspace.name.chars().count())
}

impl DesktopState {
    /// A fresh install's state, before its first write (9.1): the personal workspace, inbound on (D137).
    pub fn fresh() -> Self {
        Self {
            desktop_state_version: 1,
            workspace: Workspace {
                id: "personal".into(),
                name: "Personal".into(),
            },
            inbound: true,
            copilot: None,
            plugins: Vec::new(),
            pending_revocations: Vec::new(),
        }
    }

    /// Whether every field holds what the materializer and the hosts that read its files accept. What depends on a
    /// plugin's manifest (an engine record exactly when it has an engine, a token exactly when it authenticates) is
    /// checked against that manifest when the state is materialized.
    pub fn valid(&self) -> bool {
        let providers_valid = self.copilot.as_ref().is_none_or(|copilot| {
            let mut ids = HashSet::new();
            (1..=PROVIDERS_MAX).contains(&copilot.providers.len())
                && copilot.providers.iter().all(|provider| {
                    ids.insert(provider.id.as_str()) && models::provider_valid(provider)
                })
                && copilot
                    .default
                    .as_ref()
                    .is_none_or(|default| ids.contains(default.as_str()))
        });
        let mut plugins = HashSet::new();
        let mut ports = HashSet::new();
        let plugins_valid = self.plugins.iter().all(|plugin| {
            plugins.insert(plugin.id.as_str())
                && plugin_id(&plugin.id)
                && hex64(&plugin.bundle_sha256)
                && plugin.engine.as_ref().is_none_or(|engine| {
                    PORTS.contains(&engine.port)
                        && ports.insert(engine.port)
                        && engine.token_id.is_some() == engine.proof_key.is_some()
                        && (!engine.file_fallback || engine.token_id.is_some())
                        && engine.token_id.as_deref().is_none_or(token_id)
                        && engine.proof_key.as_deref().is_none_or(hex64)
                })
        });
        let revocations_valid = self.pending_revocations.iter().all(|pending| {
            plugin_id(&pending.plugin_id)
                && token_id(&pending.token_id)
                && pending.binary_path.is_absolute()
                && !pending.failed_at.is_empty()
                && pending.failed_at.len() <= 64
        });
        self.desktop_state_version == 1
            && workspace_valid(&self.workspace)
            && providers_valid
            && plugins_valid
            && revocations_valid
    }
}

/// `<data>/desktop-state.json`: `None` when there is none, [`PERMISSIONS`] when others could read it or it is not a
/// regular file, and [`INVALID`] when it is not a state this host reads. Read from the handle its check was made on.
pub fn read(data: &Path) -> Result<Option<DesktopState>, &'static str> {
    let bytes = match read_owner_only(&data.join(FILE), FILE_MAX) {
        Ok(bytes) => bytes,
        Err(Unread::Missing) => return Ok(None),
        Err(Unread::Denied) => return Err(PERMISSIONS),
        Err(Unread::TooLarge) => return Err(INVALID),
    };
    let state: DesktopState = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
    state.valid().then_some(Some(state)).ok_or(INVALID)
}

/// The mode the data directory is in (9.1). A state file that cannot be read fails closed: its code, and nothing
/// is served from it.
pub fn mode(data: &Path) -> Result<Mode, &'static str> {
    match read(data)? {
        Some(state) => Ok(Mode::Managed(Some(state))),
        None if data.join("site").join("index.html").is_file() => Ok(Mode::Cli),
        None => Ok(Mode::Managed(None)),
    }
}

/// The state's bytes as the materializer commits them.
pub fn bytes(state: &DesktopState) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(state).expect("a state serialises");
    bytes.push(b'\n');
    bytes
}

/// Why [`StateLock::try_acquire`] did not acquire `<app data>/desktop-state.lock`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockError {
    /// The lock file is not owner-only (or is a symlink/directory): fails closed as [`PERMISSIONS`].
    Permissions,
    /// Another handle or process currently holds the exclusive OS lock.
    WouldBlock,
    /// Creating, opening, or locking the file failed for an I/O reason.
    Io,
}

impl LockError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Permissions => PERMISSIONS,
            Self::WouldBlock | Self::Io => crate::materialize::FAILED,
        }
    }
}

/// Process-scoped exclusive owner-only OS advisory lock on `<app data>/desktop-state.lock`
/// (`flock` on Unix, `LockFileEx` on Windows via `std::fs::File::lock`). Never unlinks the lock file on
/// drop so concurrent waiters always contend on the same inode/file.
#[derive(Debug)]
pub struct StateLock {
    file: std::fs::File,
}

/// Verifies that the locked handle still matches the directory entry at `lock_path` on Unix
/// (catching inode replacement while waiting for `flock`).
#[cfg(unix)]
fn same_lock_inode(file: &std::fs::File, lock_path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(handle_meta) = file.metadata() else {
        return false;
    };
    let Ok(path_meta) = std::fs::symlink_metadata(lock_path) else {
        return false;
    };
    handle_meta.dev() == path_meta.dev() && handle_meta.ino() == path_meta.ino()
}

#[cfg(not(unix))]
fn same_lock_inode(_file: &std::fs::File, _lock_path: &Path) -> bool {
    true
}

impl StateLock {
    /// Ensures `data` exists and is safe against directory-entry replacement, opens
    /// `<data>/desktop-state.lock` owner-only, and blocks until the exclusive OS lock is acquired.
    pub fn acquire(data: &Path) -> Result<Self, &'static str> {
        ensure_dir(data).map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                PERMISSIONS
            } else {
                crate::materialize::FAILED
            }
        })?;
        check_lock_dir(data).map_err(|why| match why {
            Unwritten::NotOwnerOnly => PERMISSIONS,
            Unwritten::Io => crate::materialize::FAILED,
        })?;
        let lock_path = data.join(LOCK_FILE);
        for _ in 0..3 {
            let file = open_lock_owner_only(&lock_path).map_err(|why| match why {
                Unwritten::NotOwnerOnly => PERMISSIONS,
                Unwritten::Io => crate::materialize::FAILED,
            })?;
            file.lock().map_err(|_| crate::materialize::FAILED)?;
            if !file_owner_only(&file) {
                let _ = file.unlock();
                return Err(PERMISSIONS);
            }
            if !same_lock_inode(&file, &lock_path) {
                let _ = file.unlock();
                continue;
            }
            return Ok(Self { file });
        }
        Err(PERMISSIONS)
    }

    /// Non-blocking variant of [`Self::acquire`]: returns [`LockError::WouldBlock`] immediately if
    /// another handle or process holds the lock.
    pub fn try_acquire(data: &Path) -> Result<Self, LockError> {
        ensure_dir(data).map_err(|error| {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                LockError::Permissions
            } else {
                LockError::Io
            }
        })?;
        check_lock_dir(data).map_err(|why| match why {
            Unwritten::NotOwnerOnly => LockError::Permissions,
            Unwritten::Io => LockError::Io,
        })?;
        let lock_path = data.join(LOCK_FILE);
        for _ in 0..3 {
            let file = open_lock_owner_only(&lock_path).map_err(|why| match why {
                Unwritten::NotOwnerOnly => LockError::Permissions,
                Unwritten::Io => LockError::Io,
            })?;
            match file.try_lock() {
                Ok(()) => {
                    if !file_owner_only(&file) {
                        let _ = file.unlock();
                        return Err(LockError::Permissions);
                    }
                    if !same_lock_inode(&file, &lock_path) {
                        let _ = file.unlock();
                        continue;
                    }
                    return Ok(Self { file });
                }
                Err(std::fs::TryLockError::WouldBlock) => return Err(LockError::WouldBlock),
                Err(std::fs::TryLockError::Error(_)) => return Err(LockError::Io),
            }
        }
        Err(LockError::Permissions)
    }
}

impl Drop for StateLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

fn remove_entry_no_follow(path: &Path) -> Result<(), &'static str> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(crate::materialize::FAILED),
    };
    if metadata.is_dir() {
        match std::fs::remove_dir_all(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(crate::materialize::FAILED),
        }
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            #[cfg(windows)]
            Err(_) if metadata.file_type().is_symlink() => match std::fs::remove_dir(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(crate::materialize::FAILED),
            },
            Err(_) => Err(crate::materialize::FAILED),
        }
    }
}

/// Sweeps orphaned staging directories (`.staging/*`, `plugins/.staging/*`, `.site-staging`,
/// `.site-backup`) and `launch.pending.json` files left by an interrupted commit or install before
/// opening `main` (amendment 9.1). Never follows symlinks, tolerates absent paths, propagates any
/// removal/enumeration failure as `DESKTOP_MATERIALIZE_FAILED`, and must run under [`StateLock`].
pub fn sweep_orphans(data: &Path) -> Result<(), &'static str> {
    for path in [
        data.join(".staging"),
        data.join(".site-staging"),
        data.join(".site-backup"),
        data.join("launch.pending.json"),
    ] {
        remove_entry_no_follow(&path)?;
    }
    let plugins = data.join("plugins");
    match std::fs::symlink_metadata(&plugins) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(crate::materialize::FAILED),
    }
    remove_entry_no_follow(&plugins.join(".staging"))?;
    let entries = std::fs::read_dir(&plugins).map_err(|_| crate::materialize::FAILED)?;
    for entry in entries {
        let entry = entry.map_err(|_| crate::materialize::FAILED)?;
        let kind = entry.file_type().map_err(|_| crate::materialize::FAILED)?;
        if kind.is_dir() {
            remove_entry_no_follow(&entry.path().join("launch.pending.json"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{KeyRef, KeychainRef, Kind};

    fn mail() -> InstalledPlugin {
        InstalledPlugin {
            id: "mail".into(),
            bundle_sha256: "a".repeat(64),
            engine: Some(EngineState {
                port: 17400,
                token_id: Some("tok_1".into()),
                proof_key: Some("b".repeat(64)),
                file_fallback: false,
            }),
        }
    }

    fn claude() -> Provider {
        Provider {
            id: "claude".into(),
            kind: Kind::Anthropic,
            model: "claude-sonnet-4-5".into(),
            endpoint: None,
            key: Some(KeyRef::Keychain(KeychainRef {
                keychain: "loam-copilot".into(),
                account: "claude".into(),
            })),
        }
    }

    #[test]
    fn a_valid_state_round_trips_and_names_no_secret() {
        let mut state = DesktopState::fresh();
        state.plugins.push(mail());
        state.copilot = Some(Copilot {
            default: Some("claude".into()),
            providers: vec![claude()],
        });
        assert!(state.valid());
        let bytes = bytes(&state);
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(text.contains("\"bundleSha256\"") && text.contains("\"tokenId\": \"tok_1\""));
        assert!(!text.contains("bearer") && !text.contains("\"token\""));
        let back: DesktopState = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back, state);
    }

    #[test]
    fn refuses_what_the_materializer_cannot_build_on() {
        type Change = Box<dyn Fn(&mut DesktopState)>;
        let refused: Vec<Change> = vec![
            Box::new(|state| state.desktop_state_version = 2),
            Box::new(|state| state.workspace.id = "apps".into()),
            Box::new(|state| state.workspace.id = "Personal".into()),
            Box::new(|state| state.workspace.name = String::new()),
            Box::new(|state| state.plugins.push(mail())),
            Box::new(|state| state.plugins[0].id = "Mail".into()),
            Box::new(|state| state.plugins[0].bundle_sha256 = "A".repeat(64)),
            Box::new(|state| state.plugins[0].engine.as_mut().unwrap().port = 8080),
            Box::new(|state| state.plugins[0].engine.as_mut().unwrap().token_id = None),
            Box::new(|state| {
                state.plugins[0].engine.as_mut().unwrap().token_id = Some("a.b".into())
            }),
            Box::new(|state| {
                state.plugins[0].engine.as_mut().unwrap().proof_key = Some("b".repeat(63))
            }),
            Box::new(|state| {
                state.copilot = Some(Copilot {
                    default: Some("other".into()),
                    providers: vec![claude()],
                })
            }),
            Box::new(|state| {
                state.copilot = Some(Copilot {
                    default: None,
                    providers: vec![claude(), claude()],
                })
            }),
            Box::new(|state| {
                state.copilot = Some(Copilot {
                    default: None,
                    providers: Vec::new(),
                })
            }),
            Box::new(|state| {
                state.pending_revocations.push(PendingRevocation {
                    plugin_id: "mail".into(),
                    token_id: "tok_0".into(),
                    binary_path: "relative/loam-mail".into(),
                    failed_at: "2026-11-26T00:00:00Z".into(),
                })
            }),
        ];
        for (case, change) in refused.iter().enumerate() {
            let mut state = DesktopState::fresh();
            state.plugins.push(mail());
            assert!(state.valid());
            change(&mut state);
            assert!(!state.valid(), "case {case}");
        }
        // A key the shape does not name, a bearer above all, is refused at the read.
        let text = String::from_utf8(bytes(&DesktopState::fresh()))
            .unwrap()
            .replace("\"inbound\": true", "\"inbound\": true, \"bearer\": \"x\"");
        assert!(serde_json::from_str::<DesktopState>(&text).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_mode_follows_the_state_file_and_fails_closed() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        assert_eq!(mode(data.path()), Ok(Mode::Managed(None)));

        // A deployer's site makes it `cli`; a site with no `index.html`, as a managed one is, does not.
        std::fs::create_dir_all(data.path().join("site")).unwrap();
        std::fs::write(data.path().join("site/deployment.json"), "{}").unwrap();
        assert_eq!(mode(data.path()), Ok(Mode::Managed(None)));
        std::fs::write(data.path().join("site/index.html"), "<!doctype html>").unwrap();
        assert_eq!(mode(data.path()), Ok(Mode::Cli));

        // A state file wins over the site, and one others can read is refused.
        let path = data.path().join(FILE);
        std::fs::write(&path, bytes(&DesktopState::fresh())).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(mode(data.path()), Err(PERMISSIONS));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            mode(data.path()),
            Ok(Mode::Managed(Some(DesktopState::fresh())))
        );
        std::fs::write(&path, b"{\"desktopStateVersion\": 1}").unwrap();
        assert_eq!(mode(data.path()), Err(INVALID));
    }

    #[test]
    fn p5_s9_6_state_lock_enforces_exclusive_ownership_and_contention() {
        let data = tempfile::tempdir().unwrap();
        let held = StateLock::acquire(data.path()).expect("initial lock acquisition");
        // Verify on the open handle while held (Windows refuses `owner_only(path)`'s
        // `FILE_SHARE_READ`-only reopen while a writer handle is open).
        assert!(crate::mounts::file_owner_only(&held.file));

        // While held, non-blocking try_acquire reports WouldBlock.
        assert_eq!(
            StateLock::try_acquire(data.path()).unwrap_err(),
            LockError::WouldBlock
        );

        // A second thread calling blocking `acquire` waits until `held` is dropped.
        let dir = data.path().to_path_buf();
        let acquired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let acquired_flag = acquired.clone();
        let waiter = std::thread::spawn(move || {
            let _lock = StateLock::acquire(&dir).expect("contending lock succeeds after release");
            acquired_flag.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            !acquired.load(std::sync::atomic::Ordering::SeqCst),
            "waiter must remain blocked while lock is held"
        );
        drop(held);
        waiter.join().unwrap();
        assert!(acquired.load(std::sync::atomic::Ordering::SeqCst));

        // After all holders drop, the lock file remains in place and passes pathname `owner_only`.
        assert!(crate::mounts::owner_only(&data.path().join(LOCK_FILE)));
        let _reacquired = StateLock::try_acquire(data.path()).expect("reacquire after drop");
    }

    #[cfg(unix)]
    #[test]
    fn p5_s9_6_state_lock_refuses_non_owner_only_permissions_symlinks_and_writable_dir() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        let lock_path = data.path().join(LOCK_FILE);
        std::fs::write(&lock_path, b"").unwrap();
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(StateLock::acquire(data.path()).unwrap_err(), PERMISSIONS);
        assert_eq!(
            StateLock::try_acquire(data.path()).unwrap_err(),
            LockError::Permissions
        );

        // A read-only (0o400) existing lock file fails open with EACCES and maps to PERMISSIONS.
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(StateLock::acquire(data.path()).unwrap_err(), PERMISSIONS);
        assert_eq!(
            StateLock::try_acquire(data.path()).unwrap_err(),
            LockError::Permissions
        );
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o600)).unwrap();

        // A symlink at `desktop-state.lock` is refused rather than followed.
        std::fs::remove_file(&lock_path).unwrap();
        let target = data.path().join("real-target");
        std::fs::write(&target, b"").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&target, &lock_path).unwrap();
        assert_eq!(StateLock::acquire(data.path()).unwrap_err(), PERMISSIONS);
        assert_eq!(
            StateLock::try_acquire(data.path()).unwrap_err(),
            LockError::Permissions
        );

        // A directory in place of `desktop-state.lock` is also refused with PERMISSIONS.
        std::fs::remove_file(&lock_path).unwrap();
        std::fs::create_dir(&lock_path).unwrap();
        assert_eq!(StateLock::acquire(data.path()).unwrap_err(), PERMISSIONS);
        std::fs::remove_dir(&lock_path).unwrap();

        // A group- or world-writable profile directory cannot guarantee exclusive inode locking
        // and must fail closed with PERMISSIONS.
        for bad_mode in [0o775, 0o777] {
            std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(bad_mode))
                .unwrap();
            assert_eq!(
                StateLock::acquire(data.path()).unwrap_err(),
                PERMISSIONS,
                "mode {bad_mode:o}"
            );
            assert_eq!(
                StateLock::try_acquire(data.path()).unwrap_err(),
                LockError::Permissions,
                "mode {bad_mode:o}"
            );
        }
        std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn p5_s9_6_state_lock_refuses_directory_in_place_on_windows() {
        let data = tempfile::tempdir().unwrap();
        let lock_path = data.path().join(LOCK_FILE);
        std::fs::create_dir(&lock_path).unwrap();
        assert_eq!(StateLock::acquire(data.path()).unwrap_err(), PERMISSIONS);
        assert_eq!(
            StateLock::try_acquire(data.path()).unwrap_err(),
            LockError::Permissions
        );
    }

    #[test]
    fn p5_s9_6_sweep_orphans_clears_staging_and_pending_launches_without_touching_committed_files()
    {
        let data = tempfile::tempdir().unwrap();
        let plugins_staging = data.path().join("plugins/.staging/prop-1");
        let root_staging = data.path().join(".staging/prop-2");
        let site_staging = data.path().join(".site-staging");
        let site_backup = data.path().join(".site-backup");
        let mail_dir = data.path().join("plugins/mail");
        let mail_bundle = mail_dir.join("a".repeat(64));

        for dir in [
            &plugins_staging,
            &root_staging,
            &site_staging,
            &site_backup,
            &mail_bundle,
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(plugins_staging.join("partial.bin"), b"partial").unwrap();
        std::fs::write(root_staging.join("partial.bin"), b"partial").unwrap();
        std::fs::write(site_staging.join("deployment.json"), b"{}").unwrap();
        std::fs::write(site_backup.join("deployment.json"), b"{}").unwrap();
        std::fs::write(mail_dir.join("launch.pending.json"), b"{}").unwrap();
        std::fs::write(data.path().join("launch.pending.json"), b"{}").unwrap();
        // Committed files that MUST survive.
        std::fs::write(mail_dir.join("launch.json"), b"{\"port\":17400}").unwrap();
        std::fs::write(mail_bundle.join("plugin-manifest.json"), b"{}").unwrap();

        // Outside target pointed to by a symlink inside `.staging`: sweep must unlink the link,
        // never deleting the outside target.
        #[cfg(unix)]
        let outside = {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
            std::os::unix::fs::symlink(outside.path(), data.path().join("plugins/.staging/link"))
                .unwrap();
            outside
        };

        sweep_orphans(data.path()).expect("sweep succeeds");

        assert!(!data.path().join("plugins/.staging").exists());
        assert!(!data.path().join(".staging").exists());
        assert!(!site_staging.exists());
        assert!(!site_backup.exists());
        assert!(!mail_dir.join("launch.pending.json").exists());
        assert!(!data.path().join("launch.pending.json").exists());
        assert!(mail_dir.join("launch.json").is_file());
        assert!(mail_bundle.join("plugin-manifest.json").is_file());
        #[cfg(unix)]
        assert!(outside.path().join("keep.txt").is_file());
    }
}
