//! The process-shared mode of `FileJournalSink` (the `journal-file-shared` feature).
//!
//! `std::fs::File::lock` and `try_lock` need Rust 1.89, newer than the crate's minimum, which
//! this feature raises on its own (see `Cargo.toml`).
#![allow(clippy::incompatible_msrv)]

use std::fmt;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::{parse_journal, serialize_journal_entry, FileJournalSink, JournalEntry, JournalRecord};

/// How long [`FileJournalSink::lock`] waits when no timeout is set.
const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(10);
/// How often a waiting [`FileJournalSink::lock`] retries.
const RETRY_INTERVAL: Duration = Duration::from_millis(10);
/// How many bytes each step of the backward scan reads.
const CHUNK: u64 = 8192;

/// The lock file and the wait of a sink made with [`FileJournalSink::shared`].
#[derive(Debug)]
pub(super) struct SharedMode {
    lock_path: PathBuf,
    timeout: Duration,
}

/// An exclusive lock on a shared journal's lock file; released on drop.
///
/// Take it with [`FileJournalSink::lock`] to hold it across other writes that must stay in
/// order with the journal's, and pass it to [`FileJournalSink::append_locked`].
#[must_use = "the lock is released as soon as it is dropped"]
#[derive(Debug)]
pub struct JournalFileLock {
    file: File,
    path: PathBuf,
}

impl JournalFileLock {
    /// The lock file this lock is held on.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for JournalFileLock {
    fn drop(&mut self) {
        // Closing the file releases the lock too; unlocking first frees it without waiting for
        // the descriptor to close.
        let _ = self.file.unlock();
    }
}

/// Why [`FileJournalSink::lock`] failed.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum JournalLockError {
    /// Not acquired within the timeout.
    Timeout {
        /// How long the call waited, in milliseconds.
        waited_ms: u64,
    },
    /// The lock file could not be opened or locked.
    Io(String),
}

impl fmt::Display for JournalLockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout { waited_ms } => {
                write!(f, "the journal lock was not acquired within {waited_ms} ms")
            }
            Self::Io(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for JournalLockError {}

/// What the end of a journal file holds.
struct Tail {
    /// The last complete entry's `seq`, or 0 for an empty journal.
    last: u64,
    /// The length to cut the file to, when its last line is a write that did not finish.
    truncate_to: Option<u64>,
    /// Whether the last line is a complete entry that lacks its newline.
    needs_newline: bool,
}

impl FileJournalSink {
    /// A sink that several sinks and processes may append to at once. Every append holds an
    /// exclusive OS lock on `lock_path` and reads the last `seq` from the file's tail; nothing is
    /// cached between appends. Reads take no lock and skip a torn last line, as today.
    ///
    /// The lock assumes a local file system. The file and the lock file are created on first
    /// use, with their directories. `append` blocks the calling thread while it waits for the
    /// lock and writes, so a server should run it with `tokio::task::spawn_blocking`.
    pub fn shared(path: impl Into<PathBuf>, lock_path: impl Into<PathBuf>) -> Self {
        let mut sink = Self::new(path);
        sink.shared = Some(SharedMode {
            lock_path: lock_path.into(),
            timeout: DEFAULT_LOCK_TIMEOUT,
        });
        sink
    }

    /// How long `lock` and `append` wait for the lock. Default: 10 seconds. A sink made with
    /// `new` has no lock, and ignores it.
    pub fn with_lock_timeout(mut self, timeout: Duration) -> Self {
        if let Some(shared) = &mut self.shared {
            shared.timeout = timeout;
        }
        self
    }

    /// Take the lock, waiting up to the timeout (retrying `try_lock` every 10 ms). The lock file
    /// and its directory are created when missing.
    pub fn lock(&self) -> Result<JournalFileLock, JournalLockError> {
        let shared = self.shared.as_ref().ok_or_else(|| {
            JournalLockError::Io(self.describe(
                "this sink was made with `new` and has no lock file; use `FileJournalSink::shared`",
            ))
        })?;
        let io = |error: std::io::Error| {
            JournalLockError::Io(format!(
                "Journal lock file {}: {error}",
                shared.lock_path.display()
            ))
        };
        if let Some(parent) = shared
            .lock_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&shared.lock_path)
            .map_err(io)?;
        let started = Instant::now();
        loop {
            match file.try_lock() {
                Ok(()) => {
                    return Ok(JournalFileLock {
                        file,
                        path: shared.lock_path.clone(),
                    })
                }
                Err(TryLockError::Error(error)) => return Err(io(error)),
                Err(TryLockError::WouldBlock) => {
                    let waited = started.elapsed();
                    if waited >= shared.timeout {
                        return Err(JournalLockError::Timeout {
                            waited_ms: u64::try_from(waited.as_millis()).unwrap_or(u64::MAX),
                        });
                    }
                    std::thread::sleep(RETRY_INTERVAL.min(shared.timeout - waited));
                }
            }
        }
    }

    /// Append while holding `lock`, which must come from this sink's `lock`.
    ///
    /// The `seq` follows the last complete line read from the end of the file. A torn last line
    /// is cut off and a complete one that lacks its newline gets it, as the first append of a
    /// sink made with `new` does.
    pub fn append_locked(
        &self,
        lock: &JournalFileLock,
        record: JournalRecord,
    ) -> Result<JournalEntry, String> {
        let shared = self.shared.as_ref().ok_or_else(|| {
            self.describe(
                "this sink was made with `new` and has no lock file; use `FileJournalSink::shared`",
            )
        })?;
        if lock.path != shared.lock_path {
            return Err(self.describe(format!(
                "the lock is on {}, not on this sink's lock file {}",
                lock.path.display(),
                shared.lock_path.display()
            )));
        }
        if let Some(parent) = self
            .path()
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|error| self.describe(error))?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.path())
            .map_err(|error| self.describe(error))?;
        let tail = self.read_tail(&mut file)?;
        if let Some(length) = tail.truncate_to {
            file.set_len(length).map_err(|error| self.describe(error))?;
        }
        let entry = record.into_entry(tail.last + 1);
        let prefix = if tail.needs_newline { "\n" } else { "" };
        let line = format!("{prefix}{}\n", serialize_journal_entry(&entry));
        file.seek(SeekFrom::End(0))
            .and_then(|_| file.write_all(line.as_bytes()))
            .map_err(|error| self.describe(error))?;
        Ok(entry)
    }

    /// Find the last `seq` by reading backward from the end of the file.
    fn read_tail(&self, file: &mut File) -> Result<Tail, String> {
        let io = |error: std::io::Error| self.describe(error);
        let length = file.metadata().map_err(io)?.len();
        let mut tail = Tail {
            last: 0,
            truncate_to: None,
            needs_newline: false,
        };
        let mut end = length;
        if end > 0 && byte_at(file, end - 1).map_err(io)? != b'\n' {
            // The file stops inside a line: a complete entry that lacks its newline, or a write
            // that did not finish (also when it was cut inside a multi-byte character).
            let (start, bytes) = line_before(file, end).map_err(io)?;
            match std::str::from_utf8(&bytes) {
                Ok(text) if text.trim().is_empty() => tail.needs_newline = true,
                Ok(text) => match parse_journal(text) {
                    Ok(entries) => {
                        tail.needs_newline = true;
                        tail.last = entries.last().map_or(0, |entry| entry.seq);
                        return Ok(tail);
                    }
                    Err(_) => tail.truncate_to = Some(start),
                },
                Err(_) => tail.truncate_to = Some(start),
            }
            end = start;
        }
        // `end` is now just past a newline, or 0: the last complete line is the one before it.
        while end > 0 {
            let (start, bytes) = line_before(file, end - 1).map_err(io)?;
            let text = std::str::from_utf8(&bytes).map_err(|error| self.describe(error))?;
            if !text.trim().is_empty() {
                let entries = parse_journal(text).map_err(|error| self.describe(error))?;
                tail.last = entries.last().map_or(0, |entry| entry.seq);
                break;
            }
            end = start;
        }
        Ok(tail)
    }
}

fn byte_at(file: &mut File, offset: u64) -> std::io::Result<u8> {
    let mut byte = [0u8; 1];
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(&mut byte)?;
    Ok(byte[0])
}

/// The line that ends at byte `end` (exclusive, and not counting a newline): where it starts, and
/// its bytes. Reads backward in chunks until a newline, or the start of the file.
fn line_before(file: &mut File, end: u64) -> std::io::Result<(u64, Vec<u8>)> {
    let mut line: Vec<u8> = Vec::new();
    let mut position = end;
    while position > 0 {
        let from = position.saturating_sub(CHUNK);
        let mut chunk = vec![0u8; usize::try_from(position - from).unwrap_or(CHUNK as usize)];
        file.seek(SeekFrom::Start(from))?;
        file.read_exact(&mut chunk)?;
        if let Some(index) = chunk.iter().rposition(|byte| *byte == b'\n') {
            chunk.drain(..=index);
            line.splice(0..0, chunk);
            return Ok((from + index as u64 + 1, line));
        }
        line.splice(0..0, chunk);
        position = from;
    }
    Ok((0, line))
}
