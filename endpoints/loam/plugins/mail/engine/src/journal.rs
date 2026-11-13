//! The command journal (the specification's 13.1): the `afd` crate's record
//! of each accepted command that changes something, in `journal.jsonl` in
//! the data directory.
//!
//! - Read commands are left out, so opening and searching mail copies nothing
//!   into it.
//! - Failures are recorded, a person's command held for approval among them;
//!   an approval's summary holds no text from mail.
//! - No secret is kept: `mail-token-create`'s result and tape are removed,
//!   and so is every approval token a held call returned, which would let
//!   whoever reads the file run the command it was issued for.
//! - The file is the person's alone (`0600`), as everything in the data
//!   directory is.
//! - Only the process that owns the store writes it: the crate's file sink
//!   allows one writer, and a call another process refused because it did
//!   not have the store is not an accepted command.

use std::collections::HashSet;
use std::sync::Arc;

use afd::{
    CommandRegistry, FileJournalSink, JournalEntry, JournalRange, JournalRecord, JournalRecorder,
    JournalSink,
};
use async_trait::async_trait;

use crate::engine::Engine;
use crate::home::{Home, create_private_dir, private_file};
use crate::tokens;

/// The journal's file in `home`.
#[must_use]
pub fn path(home: &Home) -> std::path::PathBuf {
    home.root().join("journal.jsonl")
}

/// The crate's JSON Lines file, made private before anything is written to
/// it.
struct PrivateFile {
    home: Home,
    file: FileJournalSink,
}

impl PrivateFile {
    fn prepare(&self) -> std::io::Result<()> {
        create_private_dir(self.home.root())?;
        let file = private_file()
            .create(true)
            .truncate(false)
            .open(self.file.path())?;
        // A file made before by something else may be open to others.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if file.metadata()?.permissions().mode() & 0o077 != 0 {
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
        }
        #[cfg(not(unix))]
        let _ = file;
        Ok(())
    }
}

#[async_trait]
impl JournalSink for PrivateFile {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        self.prepare()
            .map_err(|error| format!("the journal could not be made private: {error}"))?;
        self.file.append(record).await
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        self.file.read(range).await
    }
}

/// Drops what the journal must not keep from `record`.
#[must_use]
pub fn redact(mut record: JournalRecord) -> Option<JournalRecord> {
    if let Some(details) = record
        .result
        .error
        .as_mut()
        .and_then(|error| error.details.as_mut())
    {
        details.remove("approvalToken");
    }
    if record.command == tokens::CREATE {
        // The token is drawn from the operating system, not the tape; the
        // tape goes too, as the crate advises for any secret.
        record.result.data = None;
        record.tape = None;
    }
    Some(record)
}

/// The recorder for `registry`'s commands, writing to the journal in `home`
/// while `engine` owns the store. Problems writing it are reported as the
/// engine's progress is.
#[must_use]
pub fn recorder(home: &Home, registry: &CommandRegistry, engine: Arc<Engine>) -> JournalRecorder {
    let changes: HashSet<String> = registry
        .list()
        .into_iter()
        .filter(|command| command.mutation)
        .map(|command| command.name.clone())
        .collect();
    let sink = PrivateFile {
        home: home.clone(),
        file: FileJournalSink::new(path(home)),
    };
    JournalRecorder::new(Arc::new(sink))
        .with_record_failures(true)
        .with_filter(move |command| changes.contains(command))
        // Asked after the call, so a command that opened the store first is
        // recorded.
        .with_redact({
            let engine = Arc::clone(&engine);
            move |record| engine.owns_store().then(|| redact(record)).flatten()
        })
        // The crate's message names the file and the system's error: the
        // engine's words, never text from mail.
        .with_on_error(move |_| engine.report("the journal could not be written"))
}
