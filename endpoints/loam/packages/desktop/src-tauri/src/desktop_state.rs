//! `<app data>/desktop-state.json` (phase 5 no-terminal amendment, 9.1; D168): what the desktop's own setup has
//! decided (the workspace, the inbound switch, the copilot's providers, each installed plugin and its engine's port
//! and token slot), from which the headless materializer writes `site/`, `mounts.json` and `models.json`. Owner-only,
//! written last as the durable commit point, and never holding a key, a bearer or a plugin's text: a provider's key
//! and an engine's bearer are references to the OS keychain, and a plugin's apps and policy are read from its
//! installed, hash-pinned bundle.
//!
//! Its presence decides the mode (9.1): a state file is `managed`; with none, a deployer's `site/index.html` is `cli`,
//! which `loam-desktop` serves untouched, and anything else is a fresh `managed` install.
use crate::models::{self, Provider};
use crate::mounts::{Unread, read_owner_only};
use crate::plugin_manifest::plugin_id;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

/// The file's name in the data directory.
pub const FILE: &str = "desktop-state.json";
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
}
