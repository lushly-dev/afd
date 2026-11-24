//! A journal sink that appends JSON Lines to a file (the `journal-file` feature).

use async_trait::async_trait;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use super::{
    parse_journal, serialize_journal_entry, JournalEntry, JournalRange, JournalRecord, JournalSink,
};

/// A [`JournalSink`] that appends one JSON line per entry to a file.
///
/// The file and its directory are created on the first append. An existing file is continued:
/// the next `seq` follows its last entry. Appends from one sink are written in order; do not
/// point two sinks (or two processes) at the same file.
///
/// A last line without a newline is a write that did not finish (a crash mid-append). Reads
/// skip it when it is not a complete entry, and the first append removes it before writing; a
/// complete entry that only lacks its newline is kept and the newline is added. The first
/// append reads the whole existing file once, to find the last `seq`.
///
/// The sink uses blocking `std::fs` calls on the calling thread, holding a lock: each append is
/// one small write, but a read loads the whole file. On an async server use
/// `AsyncFileJournalSink` (the `native` feature), which runs them on Tokio's blocking pool. It
/// needs the `journal-file` feature (on by default) and a platform with a file system.
///
/// **Durability.** Each append is one write of a whole line, handed to the operating system before
/// `append` returns: a process that crashes afterwards keeps the entry, and a crash during the
/// write leaves a torn last line that the next append removes. By default the sink does not wait
/// for the device, so a power loss or an OS crash can lose the latest entries.
/// [`Self::with_sync_data`] waits for the data to reach the device after each append
/// (`File::sync_data`, and on Unix the folder of a file the append created), at the cost of that
/// wait on every call. A failed append leaves at most a torn line, which the next append cuts.
///
/// A sink made with `new` caches the last `seq` and allows one writer per file. For several sinks
/// or processes on one file, use `FileJournalSink::shared` (the `journal-file-shared` feature).
///
/// ```rust,no_run
/// use afd::{CommandRegistry, FileJournalSink, JournalRecorder};
/// use std::sync::Arc;
///
/// let registry = CommandRegistry::new();
/// registry.set_journal(JournalRecorder::new(Arc::new(FileJournalSink::new("journal.jsonl"))));
/// ```
#[derive(Debug)]
pub struct FileJournalSink {
    path: PathBuf,
    /// The last `seq` written, once the existing file has been read. Held during each append,
    /// so lines and `seq` values stay in order.
    last_seq: Mutex<Option<u64>>,
    /// Set by `shared`: the lock file and how long an append waits for it.
    #[cfg(feature = "journal-file-shared")]
    pub(super) shared: Option<super::file_shared::SharedMode>,
    /// Wait for each append to reach the device ([`Self::with_sync_data`]).
    pub(super) sync_data: bool,
}

/// What [`FileJournalSink`] found in its file.
struct FileContents {
    /// The entries, in `seq` order.
    entries: Vec<JournalEntry>,
    /// Whether the file does not end in a newline.
    unterminated: bool,
    /// A byte offset, when that last line is also not a complete entry.
    torn_at: Option<u64>,
}

impl FileJournalSink {
    /// A sink for the file at `path`. Nothing is read or created until the first call.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            last_seq: Mutex::new(None),
            #[cfg(feature = "journal-file-shared")]
            shared: None,
            sync_data: false,
        }
    }

    /// Wait for each append's data to reach the device (`File::sync_data`) before `append`
    /// returns, and on Unix the folder entry of a file the append created, so a power loss or an
    /// OS crash keeps every entry `append` returned (on other platforms, a file created just
    /// before the loss may itself be lost). Folders the first append creates are not synced into
    /// their own parents, so create the folder beforehand when a new one must survive a power
    /// loss too. Default: off.
    pub fn with_sync_data(mut self, sync_data: bool) -> Self {
        self.sync_data = sync_data;
        self
    }

    /// The file this sink writes.
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn describe(&self, error: impl std::fmt::Display) -> String {
        format!("Journal file {}: {error}", self.path.display())
    }

    fn read_file(&self) -> Result<FileContents, String> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(FileContents {
                    entries: Vec::new(),
                    unterminated: false,
                    torn_at: None,
                })
            }
            Err(error) => return Err(self.describe(error)),
        };
        let cut = bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |index| index + 1);
        let (complete, tail) = bytes.split_at(cut);
        let complete = std::str::from_utf8(complete).map_err(|error| self.describe(error))?;
        let mut entries = parse_journal(complete).map_err(|error| self.describe(error))?;
        let mut torn_at = None;
        // A write cut inside a multi-byte character leaves a tail that is not UTF-8: torn too.
        match std::str::from_utf8(tail) {
            Ok(tail) if tail.trim().is_empty() => {}
            Ok(tail) => match parse_journal(tail) {
                Ok(last) => entries.extend(last),
                Err(_) => torn_at = Some(cut as u64),
            },
            Err(_) => torn_at = Some(cut as u64),
        }
        entries.sort_by_key(|entry| entry.seq);
        Ok(FileContents {
            entries,
            unterminated: !tail.is_empty(),
            torn_at,
        })
    }
}

impl FileJournalSink {
    /// [`JournalSink::append`], on the calling thread.
    pub(super) fn append_blocking(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        #[cfg(feature = "journal-file-shared")]
        if self.shared.is_some() {
            let lock = self.lock().map_err(|error| self.describe(error))?;
            return self.append_locked(&lock, record);
        }
        let mut last_seq = self.last_seq.lock().unwrap_or_else(PoisonError::into_inner);
        let mut prefix = "";
        let last = match *last_seq {
            Some(last) => last,
            None => {
                let existing = self.read_file()?;
                if let Some(torn_at) = existing.torn_at {
                    let file = OpenOptions::new()
                        .write(true)
                        .open(&self.path)
                        .map_err(|error| self.describe(error))?;
                    file.set_len(torn_at)
                        .map_err(|error| self.describe(error))?;
                } else if existing.unterminated {
                    prefix = "\n";
                }
                if let Some(parent) = self
                    .path
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                {
                    fs::create_dir_all(parent).map_err(|error| self.describe(error))?;
                }
                existing.entries.last().map_or(0, |entry| entry.seq)
            }
        };
        let entry = record.into_entry(last + 1);
        let line = format!("{prefix}{}\n", serialize_journal_entry(&entry));
        let created = self.sync_data && !self.path.exists();
        let written = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .and_then(|mut file| {
                file.write_all(line.as_bytes())?;
                if self.sync_data {
                    file.sync_data()?;
                }
                Ok(())
            })
            .and_then(|()| {
                if created {
                    sync_parent(&self.path)
                } else {
                    Ok(())
                }
            });
        if let Err(error) = written {
            // Part of the line may be on disk: read the file again on the next append, so its
            // `seq` follows what is there (a torn line is cut first).
            *last_seq = None;
            return Err(self.describe(error));
        }
        *last_seq = Some(entry.seq);
        Ok(entry)
    }

    /// [`JournalSink::read`], on the calling thread.
    pub(super) fn read_blocking(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        // A shared sink reads without a lock: a torn last line is skipped.
        #[cfg(feature = "journal-file-shared")]
        if self.shared.is_some() {
            return Ok(range.select(&self.read_file()?.entries));
        }
        // Wait for a pending append, so a read sees every entry appended before it.
        let _appending = self.last_seq.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(range.select(&self.read_file()?.entries))
    }
}

#[async_trait]
impl JournalSink for FileJournalSink {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        self.append_blocking(record)
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.read_blocking(range)
    }
}

/// Sync the folder that holds `path`, so a file just created there survives a power loss
/// (`File::sync_data` covers the file's data, not its folder entry). Unix only: elsewhere a folder
/// cannot be opened to sync, and this does nothing.
pub(super) fn sync_parent(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::File::open(parent)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}
