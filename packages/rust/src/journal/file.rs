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
/// The sink uses blocking `std::fs` calls: each append is one small write. It needs the
/// `journal-file` feature (on by default) and a platform with a file system.
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
        }
    }

    /// The file this sink writes.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn describe(&self, error: impl std::fmt::Display) -> String {
        format!("Journal file {}: {error}", self.path.display())
    }

    fn read_file(&self) -> Result<FileContents, String> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(FileContents {
                    entries: Vec::new(),
                    unterminated: false,
                    torn_at: None,
                })
            }
            Err(error) => return Err(self.describe(error)),
        };
        let cut = text.rfind('\n').map_or(0, |index| index + 1);
        let (complete, tail) = text.split_at(cut);
        let mut entries = parse_journal(complete).map_err(|error| self.describe(error))?;
        let mut torn_at = None;
        if !tail.trim().is_empty() {
            match parse_journal(tail) {
                Ok(last) => entries.extend(last),
                Err(_) => torn_at = Some(cut as u64),
            }
        }
        entries.sort_by_key(|entry| entry.seq);
        Ok(FileContents {
            entries,
            unterminated: !tail.is_empty(),
            torn_at,
        })
    }
}

#[async_trait]
impl JournalSink for FileJournalSink {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
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
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .and_then(|mut file| file.write_all(line.as_bytes()))
            .map_err(|error| self.describe(error))?;
        *last_seq = Some(entry.seq);
        Ok(entry)
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        // Wait for a pending append, so a read sees every entry appended before it.
        let _appending = self.last_seq.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(range.select(&self.read_file()?.entries))
    }
}
