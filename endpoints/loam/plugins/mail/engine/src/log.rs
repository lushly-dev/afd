//! The log: bytes exactly as a provider returned them, one file each, named by
//! the SHA-256 of those bytes (the specification's M19 and section 4.1).
//!
//! A file is written once and never changed. Everything else the engine keeps
//! about a message's content can be rebuilt from here.

use std::fmt;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

use crate::home::{create_private_dir, private_file};

/// The name of a file in the log: the SHA-256 of the bytes it holds.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BlobId([u8; 32]);

impl BlobId {
    /// The id of `bytes`.
    #[must_use]
    pub fn of(bytes: &[u8]) -> Self {
        Self(Sha256::digest(bytes).into())
    }

    /// The id from its 32 bytes, as a database column holds it.
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        bytes.try_into().ok().map(Self)
    }

    /// The 32 bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// The id as 64 lowercase hexadecimal digits.
    #[must_use]
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

impl fmt::Debug for BlobId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BlobId({})", self.to_hex())
    }
}

/// Why the log could not hold or return bytes.
#[derive(Debug)]
pub enum LogError {
    /// Nothing is held under the id.
    NotHeld(BlobId),
    /// The file under the id does not hold the bytes its name promises.
    Corrupt(BlobId),
    /// The bytes are longer than the reader allowed.
    TooLong(BlobId),
    /// The file system refused.
    Io(io::Error),
}

impl fmt::Display for LogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotHeld(id) => write!(f, "the log does not hold {}", id.to_hex()),
            Self::Corrupt(id) => write!(f, "the log's file {} is damaged", id.to_hex()),
            Self::TooLong(id) => write!(f, "the log's file {} is longer than allowed", id.to_hex()),
            Self::Io(error) => write!(f, "the log could not be read or written: {error}"),
        }
    }
}

impl std::error::Error for LogError {}

impl From<io::Error> for LogError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// zstd's level 3: about a third of the size for mail, at hundreds of megabytes a second.
const COMPRESSION_LEVEL: i32 = 3;

/// The log's directory.
#[derive(Debug)]
pub struct Log {
    root: PathBuf,
    /// Makes each temporary file's name unique within this process.
    next_temporary: AtomicU64,
}

impl Log {
    /// The log under `root`, created if it is missing.
    ///
    /// # Errors
    /// When the directory cannot be created.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, LogError> {
        let root = root.into();
        create_private_dir(&root)?;
        Ok(Self {
            root,
            next_temporary: AtomicU64::new(0),
        })
    }

    /// Where the bytes under `id` are, whether or not they are held.
    fn path(&self, id: BlobId) -> PathBuf {
        let hex = id.to_hex();
        self.root.join(&hex[..2]).join(hex)
    }

    /// Whether the log holds `id`.
    #[must_use]
    pub fn holds(&self, id: BlobId) -> bool {
        self.path(id).is_file()
    }

    /// Holds `bytes` and returns their id. Bytes already held are not written
    /// again. The file appears under its name only once it is written in full,
    /// so a stop of the program midway leaves no half-written message.
    ///
    /// The file is not forced to the disk: doing that for each message held
    /// the log to about 260 messages a second on macOS, under the
    /// specification's limit of 500. A power failure can therefore leave a
    /// file that is short or empty. [`Log::get`] checks every read against
    /// the id, reports such a file as [`LogError::Corrupt`], and
    /// [`Log::discard`] removes it so that the bytes can be fetched again.
    ///
    /// # Errors
    /// When the file cannot be written.
    pub fn put(&self, bytes: &[u8]) -> Result<BlobId, LogError> {
        let id = BlobId::of(bytes);
        let path = self.path(id);
        if path.is_file() {
            return Ok(id);
        }
        let Some(directory) = path.parent() else {
            return Err(LogError::Io(io::Error::other(
                "the log's file has no directory",
            )));
        };
        create_private_dir(directory)?;
        let temporary = directory.join(format!(
            ".{}.{}.{}.tmp",
            id.to_hex(),
            std::process::id(),
            self.next_temporary.fetch_add(1, Ordering::Relaxed)
        ));
        let written =
            write_compressed(&temporary, bytes).and_then(|()| fs::rename(&temporary, &path));
        if let Err(error) = written {
            // Best effort: a leftover temporary file is ignored by every reader.
            let _ = fs::remove_file(&temporary);
            return Err(LogError::Io(error));
        }
        Ok(id)
    }

    /// The bytes held under `id`, checked against it. At most `limit` bytes
    /// are produced, so a damaged or hostile file cannot fill memory.
    ///
    /// # Errors
    /// [`LogError::NotHeld`], [`LogError::Corrupt`] when the bytes do not
    /// match the id, and [`LogError::TooLong`].
    pub fn get(&self, id: BlobId, limit: u64) -> Result<Vec<u8>, LogError> {
        let file = match fs::File::open(self.path(id)) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(LogError::NotHeld(id));
            }
            Err(error) => return Err(LogError::Io(error)),
        };
        let decoder = zstd::stream::read::Decoder::new(file)?;
        let mut bytes = Vec::new();
        // One byte past the limit tells "exactly the limit" from "more".
        match decoder
            .take(limit.saturating_add(1))
            .read_to_end(&mut bytes)
        {
            Ok(_) => {}
            // zstd reports a frame it cannot read as invalid data.
            Err(_) => return Err(LogError::Corrupt(id)),
        }
        if u64::try_from(bytes.len()).is_ok_and(|length| length > limit) {
            return Err(LogError::TooLong(id));
        }
        if BlobId::of(&bytes) != id {
            return Err(LogError::Corrupt(id));
        }
        Ok(bytes)
    }
}

impl Log {
    /// Removes the file under `id`, so that a damaged one can be replaced by
    /// fetching its bytes again. Returns whether there was a file.
    ///
    /// # Errors
    /// When the file is there and cannot be removed.
    pub fn discard(&self, id: BlobId) -> Result<bool, LogError> {
        match fs::remove_file(self.path(id)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(LogError::Io(error)),
        }
    }
}

/// Writes `bytes`, compressed, to a new private file at `path`.
fn write_compressed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let file = private_file().create_new(true).open(path)?;
    let mut encoder = zstd::stream::write::Encoder::new(file, COMPRESSION_LEVEL)?;
    encoder.write_all(bytes)?;
    encoder.finish()?.flush()
}
