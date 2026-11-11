//! The data directory: where it is, what is in it, and the lock that says
//! which process owns the store (the specification's section 3.1).

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// The environment variable that names the data directory.
pub const HOME_VARIABLE: &str = "LOAM_MAIL_HOME";

/// The directory's name under the platform's application-data directory.
const DIRECTORY_NAME: &str = "loam-mail";

/// The data directory. Everything the engine keeps is under it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Home {
    root: PathBuf,
}

/// Why the data directory could not be found or taken.
#[derive(Debug)]
pub enum HomeError {
    /// No variable names the directory and the platform's default could not be worked out.
    Unknown,
    /// Another process holds the lock: it owns the store.
    InUse,
    /// The file system refused.
    Io(io::Error),
}

impl std::fmt::Display for HomeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown => write!(
                f,
                "the data directory is not known; set {HOME_VARIABLE} to a directory"
            ),
            Self::InUse => write!(f, "another process owns the store"),
            Self::Io(error) => write!(f, "the data directory could not be used: {error}"),
        }
    }
}

impl std::error::Error for HomeError {}

impl From<io::Error> for HomeError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl Home {
    /// The directory named by `LOAM_MAIL_HOME`, or the platform's
    /// application-data directory for `loam-mail`. `variable` reads the
    /// environment, so that tests need not change the process's own.
    ///
    /// # Errors
    /// [`HomeError::Unknown`] when neither is set.
    pub fn resolve(variable: impl Fn(&str) -> Option<String>) -> Result<Self, HomeError> {
        let set = |name: &str| variable(name).filter(|value| !value.is_empty());
        if let Some(named) = set(HOME_VARIABLE) {
            return Ok(Self::at(named));
        }
        let base = if cfg!(target_os = "macos") {
            set("HOME").map(|home| Path::new(&home).join("Library/Application Support"))
        } else if cfg!(windows) {
            // The local profile: half a million files should not roam.
            set("LOCALAPPDATA").map(PathBuf::from)
        } else {
            // A relative value is ignored, as the XDG specification says.
            set("XDG_DATA_HOME")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .or_else(|| set("HOME").map(|home| Path::new(&home).join(".local/share")))
        };
        base.map(|base| Self::at(base.join(DIRECTORY_NAME)))
            .ok_or(HomeError::Unknown)
    }

    /// The data directory at `root`, which need not exist yet.
    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The directory itself.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The store's database file.
    #[must_use]
    pub fn database(&self) -> PathBuf {
        self.root.join("mail.sqlite3")
    }

    /// The log's directory.
    #[must_use]
    pub fn blobs(&self) -> PathBuf {
        self.root.join("blobs")
    }

    /// The search index's directory.
    #[must_use]
    pub fn index(&self) -> PathBuf {
        self.root.join("index")
    }

    /// The lock file.
    #[must_use]
    pub fn lock_file(&self) -> PathBuf {
        self.root.join("lock")
    }

    /// Creates the directory if it is missing, readable by the person's user
    /// account alone, and takes the lock.
    ///
    /// # Errors
    /// [`HomeError::InUse`] when another process holds the lock.
    pub fn lock(&self) -> Result<HomeLock, HomeError> {
        create_private_dir(&self.root)?;
        // A directory that was already there may be open to others.
        make_private_dir(&self.root)?;
        let file = private_file()
            .create(true)
            .truncate(false)
            .open(self.lock_file())?;
        match file.try_lock() {
            Ok(()) => Ok(HomeLock { _file: file }),
            Err(fs::TryLockError::WouldBlock) => Err(HomeError::InUse),
            Err(fs::TryLockError::Error(error)) => Err(HomeError::Io(error)),
        }
    }
}

/// The lock on a data directory. The process that holds it owns the store;
/// dropping it, or the process ending, releases it.
#[derive(Debug)]
pub struct HomeLock {
    _file: File,
}

/// Creates `path` and any missing parents; the directories it creates are
/// readable by the owner alone (`0700`).
pub(crate) fn create_private_dir(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// Closes an existing directory to everyone but its owner.
fn make_private_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.metadata()?.permissions().mode() & 0o077 != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Options for a file readable and writable by the owner alone (`0600`).
pub(crate) fn private_file() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}
