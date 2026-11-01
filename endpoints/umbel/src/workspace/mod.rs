//! The workspace: discovery, `umbel.toml`, the directory layout, race-safe keys and the
//! workspace lock (phase 0 specification, section 2).

mod config;
mod discovery;
mod error;
mod keys;
mod layout;
mod plugins_config;
mod space;

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use afd::{FileJournalSink, JournalFileLock, JournalLockError};

pub use config::{
    CONFIG_VERSION, Config, ConfigFile, Confirmations, HttpConfig, JournalConfig, KeyScan,
    LogConfig, LogFormat, McpConfig, Overrides, PrincipalConfig, SpaceConfig,
};
pub use discovery::{FoundBy, Located, WORKSPACE_ENV, discover, discover_from_process};
pub use error::{WorkspaceError, codes};
pub use keys::{KEY_BYTES, TOKEN_CHARS};
pub use layout::Layout;
pub use plugins_config::{Limits, PluginInstance, PluginsConfig, caps};
pub use space::SpaceId;

pub(crate) use keys::{read_key, read_token};

/// An opened workspace: a validated configuration over a directory whose `state/` and keys exist.
#[derive(Debug, Clone)]
pub struct Workspace {
    layout: Layout,
    config: Config,
    found_by: FoundBy,
}

impl Workspace {
    /// Open the workspace at `root` with no overrides, as if `--workspace` named it.
    ///
    /// # Errors
    /// See [`Workspace::open_located`].
    pub fn open(root: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let root =
            std::path::absolute(root.as_ref()).unwrap_or_else(|_| root.as_ref().to_path_buf());
        Self::open_located(
            &Located {
                root,
                found_by: FoundBy::Flag,
            },
            &Overrides::default(),
        )
    }

    /// Read and validate `umbel.toml`, apply `overrides`, and create any missing `state/`
    /// directory and approval or confirmation key.
    ///
    /// # Errors
    /// `WORKSPACE_NOT_FOUND` without `umbel.toml`; `WORKSPACE_CONFIG_INVALID` or
    /// `WORKSPACE_CONFIG_UNSUPPORTED` for the file; `WORKSPACE_STATE_UNWRITABLE` when `state/`
    /// cannot be created; `WORKSPACE_KEY_INVALID` for a key under 32 bytes.
    pub fn open_located(located: &Located, overrides: &Overrides) -> Result<Self, WorkspaceError> {
        let layout = Layout::new(&located.root);
        let text =
            fs::read_to_string(layout.config_file()).map_err(|error| match error.kind() {
                ErrorKind::NotFound => WorkspaceError::not_found(format!(
                    "{} holds no umbel.toml",
                    located.root.display()
                )),
                _ => WorkspaceError::unwritable(&layout.config_file(), error),
            })?;
        let config = ConfigFile::parse(&text)?
            .into_config(&located.root)?
            .with_overrides(overrides)?;
        let workspace = Self {
            layout,
            config,
            found_by: located.found_by,
        };
        workspace.ensure_state()?;
        Ok(workspace)
    }

    /// Create a workspace in `dir` (made when missing): `umbel.toml` holding only
    /// `config_version = 2` and, when given, `name`; `spaces/main/`; `state/` with the keys and a
    /// `.gitignore` of `*`.
    ///
    /// # Errors
    /// `ALREADY_EXISTS` when `dir` holds `umbel.toml`; `WORKSPACE_CONFIG_INVALID` for a bad
    /// `name`; `WORKSPACE_STATE_UNWRITABLE` when something cannot be written.
    pub fn init(dir: impl AsRef<Path>, name: Option<&str>) -> Result<Self, WorkspaceError> {
        let dir = std::path::absolute(dir.as_ref()).unwrap_or_else(|_| dir.as_ref().to_path_buf());
        let layout = Layout::new(&dir);
        let mut table = toml::Table::new();
        table.insert(
            "config_version".into(),
            toml::Value::Integer(i64::from(CONFIG_VERSION)),
        );
        if let Some(name) = name {
            table.insert("name".into(), toml::Value::String(name.to_owned()));
        }
        let text = toml::to_string(&table)
            .map_err(|error| WorkspaceError::config_invalid("name", error))?;
        ConfigFile::parse(&text)?.into_config(&dir)?;

        fs::create_dir_all(&dir).map_err(|error| WorkspaceError::unwritable(&dir, error))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(layout.config_file())
            .map_err(|error| match error.kind() {
                ErrorKind::AlreadyExists => WorkspaceError::already_exists(&dir),
                _ => WorkspaceError::unwritable(&layout.config_file(), error),
            })?;
        file.write_all(text.as_bytes())
            .map_err(|error| WorkspaceError::unwritable(&layout.config_file(), error))?;
        drop(file);
        let main = layout.spaces_dir().join(SpaceId::MAIN);
        fs::create_dir_all(&main).map_err(|error| WorkspaceError::unwritable(&main, error))?;

        let workspace = Self::open_located(
            &Located {
                root: dir,
                found_by: FoundBy::Flag,
            },
            &Overrides::default(),
        )?;
        let ignore = workspace.layout.state_dir().join(".gitignore");
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&ignore)
        {
            Ok(mut file) => file
                .write_all(b"*\n")
                .map_err(|error| WorkspaceError::unwritable(&ignore, error))?,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(WorkspaceError::unwritable(&ignore, error)),
        }
        Ok(workspace)
    }

    /// The workspace directory (absolute).
    pub fn root(&self) -> &Path {
        self.layout.root()
    }

    /// Where each file lives.
    pub fn layout(&self) -> &Layout {
        &self.layout
    }

    /// `state/`.
    pub fn state_dir(&self) -> PathBuf {
        self.layout.state_dir()
    }

    /// The validated configuration.
    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Which rule found the workspace.
    pub fn found_by(&self) -> FoundBy {
        self.found_by
    }

    /// The spaces, in configuration order.
    pub fn spaces(&self) -> &[SpaceConfig] {
        &self.config.spaces
    }

    /// The space used when a call names none.
    pub fn default_space(&self) -> &SpaceId {
        &self.config.default_space
    }

    /// Whether `id` is a declared space.
    pub fn has_space(&self, id: &str) -> bool {
        self.config
            .spaces
            .iter()
            .any(|space| space.id.as_str() == id)
    }

    /// The approval key (at least 32 bytes), created at open.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a key under 32 bytes.
    pub fn approval_key(&self) -> Result<Vec<u8>, WorkspaceError> {
        keys::read_key(&self.layout.approval_key())
    }

    /// The confirmation key (at least 32 bytes), created at open and shared by every process.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a key under 32 bytes.
    pub fn confirmation_key(&self) -> Result<Vec<u8>, WorkspaceError> {
        keys::read_key(&self.layout.confirmation_key())
    }

    /// The HTTP bearer token, created race-safe on first use.
    ///
    /// # Errors
    /// `WORKSPACE_KEY_INVALID` for a malformed token.
    pub fn http_token(&self) -> Result<String, WorkspaceError> {
        keys::ensure_token(&self.layout.http_token())
    }

    /// The journal sink in shared mode on `state/journal.jsonl`, locked through `state/lock` and
    /// waiting `journal.lock_timeout_ms`.
    pub fn journal_sink(&self) -> FileJournalSink {
        shared_sink(&self.layout, self.config.journal.lock_timeout_ms)
    }

    /// Take the workspace lock, waiting up to `journal.lock_timeout_ms`. Hold it across one
    /// append to the journal and its event, and across every repair.
    ///
    /// # Errors
    /// `WORKSPACE_LOCK_TIMEOUT`; `WORKSPACE_STATE_UNWRITABLE` when the lock file cannot be opened.
    pub fn lock(&self) -> Result<JournalFileLock, WorkspaceError> {
        take_lock(&self.layout, self.config.journal.lock_timeout_ms)
    }

    fn ensure_state(&self) -> Result<(), WorkspaceError> {
        let mut dirs = vec![self.layout.keys_dir()];
        dirs.extend(
            self.config
                .spaces
                .iter()
                .map(|space| self.layout.cursors_dir(&space.id)),
        );
        for dir in dirs {
            fs::create_dir_all(&dir).map_err(|error| WorkspaceError::unwritable(&dir, error))?;
        }
        keys::ensure_key(&self.layout.approval_key())?;
        keys::ensure_key(&self.layout.confirmation_key())?;
        Ok(())
    }
}

pub(crate) fn shared_sink(layout: &Layout, lock_timeout_ms: u64) -> FileJournalSink {
    FileJournalSink::shared(layout.journal_file(), layout.lock_file())
        .with_lock_timeout(Duration::from_millis(lock_timeout_ms))
}

pub(crate) fn take_lock(
    layout: &Layout,
    lock_timeout_ms: u64,
) -> Result<JournalFileLock, WorkspaceError> {
    shared_sink(layout, lock_timeout_ms)
        .lock()
        .map_err(|error| match error {
            JournalLockError::Timeout { waited_ms } => WorkspaceError::lock_timeout(waited_ms),
            other => WorkspaceError::unwritable(&layout.lock_file(), other),
        })
}
