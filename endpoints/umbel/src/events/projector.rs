//! The projection of the journal into event streams (specification section 6).
//!
//! The projecting sink appends in one critical section, under the workspace lock:
//!
//! 1. take the lock;
//! 2. if `state/projection.pending` exists, catch up first;
//! 3. for an event candidate, create the marker;
//! 4. append the journal entry (its `seq` read from the file's tail);
//! 5. append the event to its space's stream (its `seq` read from that stream's tail), then
//!    remove the marker;
//! 6. release the lock.
//!
//! A failure at step 5 logs, leaves the marker and still returns the journal entry: the command's
//! result never changes. The marker is created before the journal append and removed after the
//! event append, so a crash or an error between them leaves it behind, and the next append by any
//! process, the next `seal`, `event-list` or `space-list` runs the catch-up first.

use super::error::EventsError;
use super::event::{Event, candidate_space};
use super::stream::{self, StreamWriter};
use crate::workspace::{Layout, SpaceId, Workspace};
use afd::{
    FileJournalSink, JournalEntry, JournalFileLock, JournalRange, JournalRecord, JournalSink,
};
use async_trait::async_trait;
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::sync::Arc;

/// What a catch-up or a repair did for one space.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct RepairedSpace {
    /// The space.
    pub space: SpaceId,
    /// Events in the stream afterwards.
    pub events: u64,
    /// Events the run appended.
    pub projected: u64,
}

/// What [`Host::repair_events`](crate::Host::repair_events) did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct RepairReport {
    /// One entry per space, in configuration order.
    pub spaces: Vec<RepairedSpace>,
}

impl RepairReport {
    /// How many events the repair appended, in every space.
    pub fn projected(&self) -> u64 {
        self.spaces.iter().map(|space| space.projected).sum()
    }
}

/// What `event-rebuild` wrote for one space.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Rebuilt {
    pub space: SpaceId,
    pub events: u64,
}

/// The journal, its lock and the event streams of one workspace.
pub(crate) struct Projector {
    workspace: Arc<Workspace>,
    journal: FileJournalSink,
}

impl Projector {
    pub(crate) fn new(workspace: Arc<Workspace>) -> Self {
        let journal = workspace.journal_sink();
        Self { workspace, journal }
    }

    fn layout(&self) -> &Layout {
        self.workspace.layout()
    }

    pub(crate) fn lock(&self) -> Result<JournalFileLock, EventsError> {
        Ok(self.workspace.lock()?)
    }

    pub(crate) fn marker_present(&self) -> bool {
        self.layout().pending_marker().exists()
    }

    fn create_marker(&self) -> Result<(), EventsError> {
        let path = self.layout().pending_marker();
        fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map(drop)
            .map_err(|error| EventsError::io(&path, error))
    }

    fn remove_marker(&self) -> Result<(), EventsError> {
        let path = self.layout().pending_marker();
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(EventsError::io(&path, error)),
        }
    }

    /// The journal entries after `after`, complete lines only. A torn last line is a write that
    /// did not finish; the next locked append cuts it off.
    fn journal_entries_after(&self, after: u64) -> Result<Vec<JournalEntry>, EventsError> {
        let path = self.layout().journal_file();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(EventsError::io(&path, error)),
        };
        let complete = bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(&bytes[..0], |end| &bytes[..=end]);
        let text =
            std::str::from_utf8(complete).map_err(|error| EventsError::damaged(&path, error))?;
        let mut entries =
            afd::parse_journal(text).map_err(|message| EventsError::damaged(&path, message))?;
        entries.retain(|entry| entry.seq > after);
        Ok(entries)
    }

    /// Catch every stream up with the journal. Hold the lock.
    ///
    /// For each space, read the last event's `journalSeq`; take the smallest; project every
    /// candidate entry after it that its stream does not hold yet; remove the marker. The result
    /// equals an uninterrupted run.
    pub(crate) fn catch_up(&self, _lock: &JournalFileLock) -> Result<RepairReport, EventsError> {
        let mut writers: BTreeMap<SpaceId, StreamWriter> = BTreeMap::new();
        let mut report = Vec::new();
        for space in self.workspace.spaces() {
            let writer = StreamWriter::open(&self.layout().events_file(&space.id))?;
            writers.insert(space.id.clone(), writer);
        }
        let from = writers
            .values()
            .map(|writer| writer.tail().journal_seq)
            .min()
            .unwrap_or(0);
        let mut projected: BTreeMap<SpaceId, u64> = BTreeMap::new();
        for entry in self.journal_entries_after(from)? {
            let Some(space) = candidate_space(&entry.result) else {
                continue;
            };
            let Some(writer) = writers.get_mut(&space) else {
                continue;
            };
            if entry.seq <= writer.tail().journal_seq {
                continue;
            }
            let event = Event::from_entry(&entry, &space, writer.tail().seq + 1);
            writer.append(&event)?;
            *projected.entry(space).or_default() += 1;
        }
        for space in self.workspace.spaces() {
            report.push(RepairedSpace {
                space: space.id.clone(),
                events: writers[&space.id].tail().seq,
                projected: projected.get(&space.id).copied().unwrap_or(0),
            });
        }
        self.remove_marker()?;
        Ok(RepairReport { spaces: report })
    }

    /// Take the lock and catch up, whether or not the marker is there:
    /// [`Host::repair_events`](crate::Host::repair_events).
    pub(crate) fn repair(&self) -> Result<RepairReport, EventsError> {
        let lock = self.lock()?;
        self.catch_up(&lock)
    }

    /// Catch up when the marker is there; what `seal`, `event-list` and `space-list` do. The
    /// marker is read again once the lock is held, because the process that left it in flight may
    /// have finished.
    pub(crate) fn catch_up_if_pending(&self) -> Result<(), EventsError> {
        if !self.marker_present() {
            return Ok(());
        }
        let lock = self.lock()?;
        if self.marker_present() {
            self.catch_up(&lock)?;
        }
        Ok(())
    }

    /// The last event of `space`'s stream, without a lock.
    pub(crate) fn tail(&self, space: &SpaceId) -> Result<stream::Tail, EventsError> {
        stream::tail(&self.layout().events_file(space))
    }

    /// Rewrite the streams of `spaces` from the journal, each into a temporary file renamed over
    /// the old one. Hold the lock. The marker goes once every stream is current.
    pub(crate) fn rebuild(
        &self,
        lock: &JournalFileLock,
        spaces: &[SpaceId],
    ) -> Result<Vec<Rebuilt>, EventsError> {
        let entries = self.journal_entries_after(0)?;
        let mut rebuilt = Vec::new();
        for space in spaces {
            let path = self.layout().events_file(space);
            let dir = path
                .parent()
                .map(std::path::Path::to_path_buf)
                .unwrap_or_default();
            fs::create_dir_all(&dir).map_err(|error| EventsError::io(&dir, error))?;
            let temporary = dir.join(format!(
                ".events.{}.{}.tmp",
                std::process::id(),
                crate::host::new_trace_id()
            ));
            let written = self.write_stream(&temporary, &path, space, &entries);
            if written.is_err() {
                let _ = fs::remove_file(&temporary);
            }
            rebuilt.push(Rebuilt {
                space: space.clone(),
                events: written?,
            });
        }
        if spaces.len() == self.workspace.spaces().len() {
            self.remove_marker()?;
        } else if self.marker_present() {
            self.catch_up(lock)?;
        }
        Ok(rebuilt)
    }

    fn write_stream(
        &self,
        temporary: &std::path::Path,
        path: &std::path::Path,
        space: &SpaceId,
        entries: &[JournalEntry],
    ) -> Result<u64, EventsError> {
        use std::io::Write;
        let mut text = String::new();
        let mut seq = 0u64;
        for entry in entries {
            if candidate_space(&entry.result).as_ref() == Some(space) {
                seq += 1;
                text.push_str(&Event::from_entry(entry, space, seq).to_line());
                text.push('\n');
            }
        }
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temporary)
            .and_then(|mut file| {
                file.write_all(text.as_bytes())
                    .and_then(|()| file.sync_all())
            })
            .and_then(|()| fs::rename(temporary, path))
            .map_err(|error| EventsError::io(path, error))?;
        Ok(seq)
    }

    /// One critical section: the journal entry and its event.
    fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let command = record.command.clone();
        let trace = record.trace_id.clone().unwrap_or_default();
        let context = |message: String| format!("{message} (command {command}, trace {trace})");
        let lock = self.lock().map_err(|error| context(error.to_string()))?;
        let mut blocked = false;
        if self.marker_present()
            && let Err(error) = self.catch_up(&lock)
        {
            // The marker stays, so a later catch-up projects what this one could not, in order.
            tracing::error!(command = %command, trace_id = %trace, "{error}");
            blocked = true;
        }
        let space = candidate_space(&record.result)
            .filter(|space| self.workspace.has_space(space.as_str()));
        if space.is_some() && !self.marker_present() {
            self.create_marker()
                .map_err(|error| context(error.to_string()))?;
        }
        let entry = self.journal.append_locked(&lock, record).map_err(context)?;
        if let Some(space) = space
            && !blocked
        {
            let projected = self
                .project(&entry, &space)
                .and_then(|()| self.remove_marker());
            if let Err(error) = projected {
                tracing::error!(command = %command, trace_id = %trace, "{error}; projection.pending stays, and the next append repairs the stream");
            }
        }
        Ok(entry)
    }

    fn project(&self, entry: &JournalEntry, space: &SpaceId) -> Result<(), EventsError> {
        let mut writer = StreamWriter::open(&self.layout().events_file(space))?;
        if entry.seq <= writer.tail().journal_seq {
            return Ok(());
        }
        let event = Event::from_entry(entry, space, writer.tail().seq + 1);
        writer.append(&event)
    }
}

/// A [`JournalSink`] over the shared journal that projects each mutation into its event stream.
pub(crate) struct ProjectingSink {
    projector: Arc<Projector>,
}

impl ProjectingSink {
    pub(crate) fn new(projector: Arc<Projector>) -> Self {
        Self { projector }
    }
}

#[async_trait]
impl JournalSink for ProjectingSink {
    /// Runs under `spawn_blocking`: the lock wait and the file writes block.
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let projector = Arc::clone(&self.projector);
        tokio::task::spawn_blocking(move || projector.append(record))
            .await
            .map_err(|error| format!("The journal append did not finish: {error}"))?
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.projector.journal.read(range).await
    }
}
