//! Finding the workspace (specification section 2).

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::error::WorkspaceError;
use super::layout::Layout;

/// Which rule found the workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FoundBy {
    /// The `--workspace` flag.
    Flag,
    /// The `UMBEL_WORKSPACE` environment variable.
    Env,
    /// The nearest directory upward from the current one that holds `umbel.toml`.
    Search,
}

impl FoundBy {
    /// `flag`, `env` or `search`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flag => "flag",
            Self::Env => "env",
            Self::Search => "search",
        }
    }
}

/// A workspace directory and the rule that found it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// The absolute workspace directory.
    pub root: PathBuf,
    /// The rule that found it.
    pub found_by: FoundBy,
}

/// The name of the environment variable that names a workspace.
pub const WORKSPACE_ENV: &str = "UMBEL_WORKSPACE";

/// Find the workspace: the flag, else the environment value, else the nearest directory from
/// `cwd` upward that holds `umbel.toml`. A flag or environment directory must hold `umbel.toml`
/// itself; the first rule that applies decides, with no fallback. An empty value counts as unset.
///
/// # Errors
/// `WORKSPACE_NOT_FOUND`.
pub fn discover(
    flag: Option<&Path>,
    env_value: Option<&OsString>,
    cwd: &Path,
) -> Result<Located, WorkspaceError> {
    let given = |path: &Path| -> PathBuf {
        std::path::absolute(cwd.join(path)).unwrap_or_else(|_| cwd.join(path))
    };
    let explicit = |dir: PathBuf, found_by: FoundBy, rule: &str| {
        if Layout::new(&dir).config_file().is_file() {
            Ok(Located {
                root: dir,
                found_by,
            })
        } else {
            Err(WorkspaceError::not_found(format!(
                "{rule} names {}, which holds no umbel.toml",
                dir.display()
            )))
        }
    };
    if let Some(flag) = flag.filter(|path| !path.as_os_str().is_empty()) {
        return explicit(given(flag), FoundBy::Flag, "--workspace");
    }
    if let Some(value) = env_value.filter(|value| !value.is_empty()) {
        return explicit(given(Path::new(value)), FoundBy::Env, WORKSPACE_ENV);
    }
    cwd.ancestors()
        .find(|dir| Layout::new(*dir).config_file().is_file())
        .map(|dir| Located {
            root: dir.to_path_buf(),
            found_by: FoundBy::Search,
        })
        .ok_or_else(|| {
            WorkspaceError::not_found(format!(
                "no umbel.toml in {} or any directory above it",
                cwd.display()
            ))
        })
}

/// [`discover`] with the process's `UMBEL_WORKSPACE` and current directory.
///
/// # Errors
/// `WORKSPACE_NOT_FOUND`, also when the current directory cannot be read.
pub fn discover_from_process(flag: Option<&Path>) -> Result<Located, WorkspaceError> {
    let cwd = env::current_dir().map_err(|error| {
        WorkspaceError::not_found(format!("the current directory cannot be read: {error}"))
    })?;
    discover(flag, env::var_os(WORKSPACE_ENV).as_ref(), &cwd)
}
