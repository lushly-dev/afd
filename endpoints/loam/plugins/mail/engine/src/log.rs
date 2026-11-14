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

/// The directory, inside the log's, that holds files found damaged.
const DAMAGED: &str = "damaged";

/// zstd's level 3: about a third of the size for mail, at hundreds of megabytes a second.
const COMPRESSION_LEVEL: i32 = 3;

/// How many threads write a batch's files.
const WRITERS: usize = 8;

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
        let created = !root.is_dir();
        create_private_dir(&root)?;
        if created {
            // The log's own name must survive a power failure too.
            durable::flush_directory(root.parent())?;
        }
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

    /// Holds `bytes` and returns their id. The file appears under its name
    /// only once it is written in full, so a stop of the program midway
    /// leaves no half-written message.
    ///
    /// Bytes already held are not written again, but the file there is read
    /// and checked first: a damaged one is set aside and written afresh, so
    /// fetching a message again repairs it.
    ///
    /// The file is not yet safe from a power failure. Call
    /// [`Log::make_durable`] for a batch before recording that it is held.
    ///
    /// # Errors
    /// When the file cannot be written.
    pub fn put(&self, bytes: &[u8]) -> Result<BlobId, LogError> {
        let id = BlobId::of(bytes);
        let path = self.path(id);
        match self.get(id, u64::try_from(bytes.len()).unwrap_or(u64::MAX)) {
            Ok(_) => return Ok(id),
            Err(LogError::NotHeld(_)) => {}
            Err(LogError::Corrupt(_) | LogError::TooLong(_)) => {
                self.set_aside(id)?;
            }
            Err(error) => return Err(error),
        }
        let Some(directory) = path.parent() else {
            return Err(LogError::Io(io::Error::other(
                "the log's file has no directory",
            )));
        };
        create_private_dir(directory)?;
        let temporary = directory.join(format!(".{}.{}.tmp", id.to_hex(), self.unique()));
        let written =
            write_compressed(&temporary, bytes).and_then(|()| fs::rename(&temporary, &path));
        if let Err(error) = written {
            // Best effort: a leftover temporary file is ignored by every reader.
            let _ = fs::remove_file(&temporary);
            return Err(LogError::Io(error));
        }
        Ok(id)
    }

    /// [`Log::put`] for each of `batch`, in order. Writing a small file costs
    /// the file system a few hundred microseconds whatever its size, so a
    /// batch is written on a few threads at once.
    ///
    /// # Errors
    /// When a file cannot be written. Files written before the failure stay:
    /// a file no row names is harmless.
    pub fn put_all(&self, batch: &[&[u8]]) -> Result<Vec<BlobId>, LogError> {
        let share = batch.len().div_ceil(WRITERS).max(1);
        if batch.len() <= share {
            return batch.iter().map(|bytes| self.put(bytes)).collect();
        }
        std::thread::scope(|scope| {
            let writers: Vec<_> = batch
                .chunks(share)
                .map(|chunk| {
                    scope.spawn(move || {
                        chunk
                            .iter()
                            .map(|bytes| self.put(bytes))
                            .collect::<Result<Vec<BlobId>, LogError>>()
                    })
                })
                .collect();
            // Every thread is joined before any failure is returned.
            let joined: Vec<_> = writers.into_iter().map(|writer| writer.join()).collect();
            let mut ids = Vec::with_capacity(batch.len());
            for written in joined {
                let written = written
                    .map_err(|_| LogError::Io(io::Error::other("a writing thread failed")))?;
                ids.extend(written?);
            }
            Ok(ids)
        })
    }

    /// A name part no other call in any process shares.
    fn unique(&self) -> String {
        format!(
            "{}.{}",
            std::process::id(),
            self.next_temporary.fetch_add(1, Ordering::Relaxed)
        )
    }

    /// Waits until the files under `ids` are on the disk, and on macOS and
    /// Linux their names too, so that a power failure cannot take them. One
    /// flush covers the batch.
    ///
    /// # Errors
    /// When a file is not held or the flush fails.
    pub fn make_durable(&self, ids: &[BlobId]) -> Result<(), LogError> {
        if ids.is_empty() {
            return Ok(());
        }
        let paths: Vec<PathBuf> = ids.iter().map(|id| self.path(*id)).collect();
        Ok(durable::flush(&self.root, &paths)?)
    }

    /// Moves the file under `id` out of the log into `damaged/`, so that its
    /// bytes can be fetched again and nothing is deleted on a suspicion.
    /// Returns whether there was a file.
    ///
    /// # Errors
    /// When the file is there and cannot be moved.
    pub fn set_aside(&self, id: BlobId) -> Result<bool, LogError> {
        let damaged = self.root.join(DAMAGED);
        create_private_dir(&damaged)?;
        let target = damaged.join(format!("{}.{}", id.to_hex(), self.unique()));
        match fs::rename(self.path(id), target) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(LogError::Io(error)),
        }
    }

    /// Removes the file under `id`, once nothing refers to it. Returns
    /// whether there was a file.
    ///
    /// # Errors
    /// When the file is there and cannot be removed.
    pub fn remove(&self, id: BlobId) -> Result<bool, LogError> {
        match fs::remove_file(self.path(id)) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(LogError::Io(error)),
        }
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
            // The operating system's own refusal is not damage: the file may be whole.
            Err(error) if error.raw_os_error().is_some() => return Err(LogError::Io(error)),
            // What is left is zstd saying it cannot read the frame.
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

/// Writes `bytes`, compressed, to a new private file at `path`.
fn write_compressed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let file = private_file().create_new(true).open(path)?;
    let mut encoder = zstd::stream::write::Encoder::new(file, COMPRESSION_LEVEL)?;
    encoder.write_all(bytes)?;
    encoder.finish()?.flush()
}

/// Making files durable, as each platform allows.
mod durable {
    /// Flushes a directory, so that the names in it survive a power failure.
    /// Windows has no such call; a directory's entries are its journal's there.
    pub(super) fn flush_directory(directory: Option<&Path>) -> io::Result<()> {
        #[cfg(unix)]
        if let Some(directory) = directory.filter(|path| !path.as_os_str().is_empty()) {
            File::open(directory)?.sync_all()?;
        }
        #[cfg(not(unix))]
        let _ = directory;
        Ok(())
    }

    use std::fs::File;
    use std::io;
    use std::path::{Path, PathBuf};

    /// Flushes `paths`, files of the log under `root`, and their directory entries.
    #[cfg(target_vendor = "apple")]
    pub(super) fn flush(root: &Path, paths: &[PathBuf]) -> io::Result<()> {
        // `fsync` hands each file to the drive; one `F_FULLFSYNC` then has the
        // drive write its cache out, which covers everything handed over.
        let mut last = None;
        for path in paths {
            let file = File::open(path)?;
            rustix::fs::fsync(&file)?;
            last = Some(file);
        }
        // Each file's directory holds its name, and the root holds the name
        // of a directory made for this batch.
        let mut directories: std::collections::BTreeSet<&Path> =
            paths.iter().filter_map(|path| path.parent()).collect();
        directories.insert(root);
        for directory in directories {
            rustix::fs::fsync(File::open(directory)?)?;
        }
        match last {
            Some(file) => Ok(rustix::fs::fcntl_fullfsync(file)?),
            None => Ok(()),
        }
    }

    /// Flushes `paths`, files of the log under `root`, and their directory entries.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) fn flush(root: &Path, paths: &[PathBuf]) -> io::Result<()> {
        // One call writes out everything pending on the log's file system,
        // file contents and directory entries alike. A missing file is still
        // an error, as on the other platforms.
        for path in paths {
            path.metadata()?;
        }
        Ok(rustix::fs::syncfs(File::open(root)?)?)
    }

    /// Flushes `paths`, files of the log under `root`, and their directory entries.
    #[cfg(not(any(target_vendor = "apple", target_os = "linux", target_os = "android")))]
    pub(super) fn flush(_root: &Path, paths: &[PathBuf]) -> io::Result<()> {
        for path in paths {
            File::open(path)?.sync_all()?;
        }
        Ok(())
    }
}
