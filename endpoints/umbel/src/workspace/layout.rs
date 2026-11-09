//! The directory layout of a workspace (specification section 2).

use std::path::{Path, PathBuf};

use super::space::SpaceId;

/// Where each file of a workspace lives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    root: PathBuf,
}

impl Layout {
    /// The layout under `root`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The workspace directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `umbel.toml`, deployer-owned.
    pub fn config_file(&self) -> PathBuf {
        self.root.join("umbel.toml")
    }

    /// `spaces/`, content, deployer-owned; reserved until phase 2.
    pub fn spaces_dir(&self) -> PathBuf {
        self.root.join("spaces")
    }

    /// `state/`, written by the host.
    pub fn state_dir(&self) -> PathBuf {
        self.root.join("state")
    }

    /// `state/lock`, the workspace lock.
    pub fn lock_file(&self) -> PathBuf {
        self.state_dir().join("lock")
    }

    /// `state/journal.jsonl`, the AFD journal.
    pub fn journal_file(&self) -> PathBuf {
        self.state_dir().join("journal.jsonl")
    }

    /// `state/projection.pending`, present only while an event may be missing.
    pub fn pending_marker(&self) -> PathBuf {
        self.state_dir().join("projection.pending")
    }

    /// `state/keys/`.
    pub fn keys_dir(&self) -> PathBuf {
        self.state_dir().join("keys")
    }

    /// `state/keys/approval.key`.
    pub fn approval_key(&self) -> PathBuf {
        self.keys_dir().join("approval.key")
    }

    /// `state/keys/confirmation.key`.
    pub fn confirmation_key(&self) -> PathBuf {
        self.keys_dir().join("confirmation.key")
    }

    /// `state/keys/http.token`.
    pub fn http_token(&self) -> PathBuf {
        self.keys_dir().join("http.token")
    }

    /// `state/keys/limits.key`: the key of the rate limits' counter names (phase 5 step 3), so
    /// that `limits.sqlite3` holds no identifier a dictionary could recover.
    pub fn limits_key(&self) -> PathBuf {
        self.keys_dir().join("limits.key")
    }

    /// `state/keys/cursor.key`: the key of sealed positions (phase 5 sections 9.3 and 10.2).
    pub fn cursor_key(&self) -> PathBuf {
        self.keys_dir().join("cursor.key")
    }

    /// `state/shared/`: the stores every process behind one URL shares (phase 5 section 10.2).
    pub fn shared_dir(&self) -> PathBuf {
        self.state_dir().join("shared")
    }

    /// `state/shared/limits.sqlite3`: the rate limits' counters (phase 5 sections 10.2 and 11).
    pub fn limits_store(&self) -> PathBuf {
        self.shared_dir().join("limits.sqlite3")
    }

    /// `state/shared/nonces.sqlite3`: single-use values every process spends once (phase 5
    /// section 10.2): approval nonces, relay evidence, gateway `jti`s, spent person decisions.
    pub fn nonces_store(&self) -> PathBuf {
        self.shared_dir().join("nonces.sqlite3")
    }

    /// `state/spaces/`.
    pub fn space_states_dir(&self) -> PathBuf {
        self.state_dir().join("spaces")
    }

    /// `state/spaces/<space>/`.
    pub fn space_state_dir(&self, space: &SpaceId) -> PathBuf {
        self.space_states_dir().join(space.as_str())
    }

    /// `state/spaces/<space>/events.jsonl`.
    pub fn events_file(&self, space: &SpaceId) -> PathBuf {
        self.space_state_dir(space).join("events.jsonl")
    }

    /// `state/spaces/<space>/cursors/`.
    pub fn cursors_dir(&self, space: &SpaceId) -> PathBuf {
        self.space_state_dir(space).join("cursors")
    }

    /// `state/spaces/<space>/cursors/<cursor-key>.json`.
    pub fn cursor_file(&self, space: &SpaceId, cursor_key: &str) -> PathBuf {
        self.cursors_dir(space).join(format!("{cursor_key}.json"))
    }
}
