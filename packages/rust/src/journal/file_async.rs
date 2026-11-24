//! A file journal sink for async servers (the `native` and `journal-file` features).

use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{FileJournalSink, JournalEntry, JournalRange, JournalRecord, JournalSink};

/// A [`FileJournalSink`] that runs its blocking file calls on Tokio's blocking pool
/// (`tokio::task::spawn_blocking`), so an append (one write, and with
/// [`FileJournalSink::with_sync_data`] the wait for the device), a read of the whole file, and a
/// shared sink's wait for its lock never hold an async worker thread.
///
/// Appends keep the order the calls reached `append` (a fair async lock is taken before each
/// one and held until its file call returns), so entries appear in the order calls finished, as
/// with the sink it wraps. Reads wait for the appends before them. An append whose caller stops
/// waiting (a batch deadline, a dropped future) after its file call started is still written,
/// in its turn. It has the durability of the [`FileJournalSink`] it wraps.
///
/// Needs a Tokio runtime (multi-thread or current-thread): without one, `append` panics, which
/// the journal recorder reports as a failed recording.
///
/// ```rust,no_run
/// use afd::{AsyncFileJournalSink, CommandRegistry, FileJournalSink, JournalRecorder};
/// use std::sync::Arc;
///
/// let registry = CommandRegistry::new();
/// let sink = AsyncFileJournalSink::from_sink(
///     FileJournalSink::new("journal.jsonl").with_sync_data(true),
/// );
/// registry.set_journal(JournalRecorder::new(Arc::new(sink)));
/// ```
#[derive(Debug)]
pub struct AsyncFileJournalSink {
    inner: Arc<FileJournalSink>,
    /// Taken before each call, in the order the calls arrive (Tokio's mutex is fair), and held by
    /// the blocking call until it returns, even when the caller stops waiting.
    order: Arc<tokio::sync::Mutex<()>>,
}

impl AsyncFileJournalSink {
    /// An async sink for the file at `path`, as [`FileJournalSink::new`] makes it.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self::from_sink(FileJournalSink::new(path))
    }

    /// An async sink running `sink`'s calls: a shared sink, or one with `with_sync_data`.
    pub fn from_sink(sink: FileJournalSink) -> Self {
        Self {
            inner: Arc::new(sink),
            order: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// The file this sink writes.
    pub fn path(&self) -> &Path {
        self.inner.path()
    }

    /// Run `call` on the blocking pool, after the calls that arrived before it.
    async fn run<T: Send + 'static>(
        &self,
        call: impl FnOnce(&FileJournalSink) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let turn = Arc::clone(&self.order).lock_owned().await;
        let inner = Arc::clone(&self.inner);
        // The turn moves into the blocking call: if this future is dropped while the call runs,
        // the call still finishes before the next one starts.
        tokio::task::spawn_blocking(move || {
            let _turn = turn;
            call(&inner)
        })
        .await
        .unwrap_or_else(|error| {
            Err(self
                .inner
                .describe(format!("the journal call did not finish: {error}")))
        })
    }
}

#[async_trait]
impl JournalSink for AsyncFileJournalSink {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        self.run(move |sink| sink.append_blocking(record)).await
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.run(move |sink| sink.read_blocking(range)).await
    }
}
