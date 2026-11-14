//! The search index (the specification's section 4.1): a tantivy index over
//! each message's subject and text.
//!
//! The index is derived. A document is replaced whenever its message is
//! derived again, and the whole index can be thrown away and rebuilt from the
//! log. It holds what belongs to the message alone: its id, its date, its
//! sender, its subject and its text. What changes around a message (its
//! thread, its mailboxes) is read from the tables.
//!
//! Each commit carries the highest `index_pending.seq` it holds, so the store
//! can tell after a stop which documents never reached the disk.

use std::fmt;
use std::path::{Path, PathBuf};

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{FAST, Field, INDEXED, STORED, STRING, Schema, TEXT, Value};
use tantivy::{IndexReader, IndexWriter, TantivyDocument, Term, doc};

/// The memory the index writer may use before it writes a segment.
const WRITER_MEMORY: usize = 128 * 1024 * 1024;

/// Why the index refused.
#[derive(Debug)]
pub enum IndexError {
    /// The directory could not be made or removed.
    Io(std::io::Error),
    /// tantivy refused.
    Tantivy(tantivy::TantivyError),
}

impl fmt::Display for IndexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "the search index's directory refused: {error}"),
            Self::Tantivy(error) => write!(f, "the search index refused: {error}"),
        }
    }
}

impl std::error::Error for IndexError {}

impl From<std::io::Error> for IndexError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<tantivy::TantivyError> for IndexError {
    fn from(error: tantivy::TantivyError) -> Self {
        Self::Tantivy(error)
    }
}

/// One message as the index holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    /// The `index_pending.seq` that asked for it.
    pub seq: u64,
    /// The message's row.
    pub message: i64,
    /// The date it is listed under, in milliseconds.
    pub date: i64,
    /// The sender's address.
    pub sender: String,
    /// The subject.
    pub subject: String,
    /// The text; empty until the body is held.
    pub text: String,
}

#[derive(Debug, Clone, Copy)]
struct Fields {
    message: Field,
    date: Field,
    sender: Field,
    subject: Field,
    text: Field,
}

/// The open index.
pub struct Index {
    directory: PathBuf,
    index: tantivy::Index,
    reader: IndexReader,
    writer: Option<IndexWriter>,
    fields: Fields,
    /// Documents added since the last commit, and the highest seq among them.
    uncommitted: usize,
    highest: u64,
}

impl fmt::Debug for Index {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Index")
            .field("directory", &self.directory)
            .field("uncommitted", &self.uncommitted)
            .finish_non_exhaustive()
    }
}

/// Makes `directory`, or keeps it, as one only its owner can enter. The
/// index creates its files with the process's default mode, which may let
/// others read them; the directory stops them from reaching the files, as
/// the data directory does for the store's.
fn owners_directory(directory: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(directory)?;
        if directory.metadata()?.permissions().mode() & 0o077 != 0 {
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    #[cfg(not(unix))]
    std::fs::create_dir_all(directory)?;
    Ok(())
}

impl Index {
    /// Opens the index in `directory`, creating it when it is not there.
    ///
    /// # Errors
    /// When the directory cannot be made, or holds something that is not
    /// this index.
    pub fn open(directory: &Path) -> Result<Self, IndexError> {
        owners_directory(directory)?;
        let mut schema = Schema::builder();
        let fields = Fields {
            message: schema.add_i64_field("message", INDEXED | STORED | FAST),
            date: schema.add_i64_field("date", FAST),
            sender: schema.add_text_field("sender", STRING),
            subject: schema.add_text_field("subject", TEXT),
            text: schema.add_text_field("text", TEXT),
        };
        let mmap = tantivy::directory::MmapDirectory::open(directory)
            .map_err(|error| IndexError::Tantivy(error.into()))?;
        let index = tantivy::Index::open_or_create(mmap, schema.build())?;
        // The store reloads the reader itself after each commit, so no
        // thread watches the directory.
        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            directory: directory.to_path_buf(),
            index,
            reader,
            writer: None,
            fields,
            uncommitted: 0,
            highest: 0,
        })
    }

    /// Closes the index: waits for its writer's threads to end, so that
    /// nothing writes to its directory afterwards.
    ///
    /// # Errors
    /// When a merge under way fails.
    pub fn close(mut self) -> Result<(), IndexError> {
        if let Some(writer) = self.writer.take() {
            writer.wait_merging_threads()?;
        }
        Ok(())
    }

    /// Removes the index in `directory`, whatever state it is in. No index
    /// may be open there.
    ///
    /// # Errors
    /// When the directory cannot be removed.
    pub fn remove(directory: &Path) -> Result<(), IndexError> {
        // An index closed a moment ago may still be letting go of a file,
        // which shows as a directory that is not empty: try a few times.
        let mut tries = 0;
        loop {
            match std::fs::remove_dir_all(directory) {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error)
                    if error.kind() == std::io::ErrorKind::DirectoryNotEmpty && tries < 20 =>
                {
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(error.into()),
            }
        }
    }

    /// The highest seq the index holds on the disk; 0 for a new index.
    ///
    /// # Errors
    /// When the index's own record cannot be read.
    pub fn committed(&self) -> Result<u64, IndexError> {
        Ok(self
            .index
            .load_metas()?
            .payload
            .and_then(|payload| payload.parse().ok())
            .unwrap_or(0))
    }

    /// How many documents wait for a commit.
    #[must_use]
    pub fn uncommitted(&self) -> usize {
        self.uncommitted
    }

    /// Puts `document` in the index in place of any the message had. It is
    /// searchable, and on the disk, after the next [`Index::commit`].
    ///
    /// # Errors
    /// When the index cannot be written.
    pub fn replace(&mut self, document: &Document) -> Result<(), IndexError> {
        let fields = self.fields;
        let writer = self.writer()?;
        writer.delete_term(Term::from_field_i64(fields.message, document.message));
        writer.add_document(doc!(
            fields.message => document.message,
            fields.date => document.date,
            fields.sender => document.sender.as_str(),
            fields.subject => document.subject.as_str(),
            fields.text => document.text.as_str(),
        ))?;
        self.uncommitted += 1;
        self.highest = self.highest.max(document.seq);
        Ok(())
    }

    /// Writes what was added to the disk and makes it searchable. Returns
    /// the highest seq now held, or `None` when there was nothing to write.
    ///
    /// # Errors
    /// When the index cannot be written.
    pub fn commit(&mut self) -> Result<Option<u64>, IndexError> {
        if self.uncommitted == 0 {
            return Ok(None);
        }
        let highest = self.highest.max(self.committed()?);
        let writer = self.writer()?;
        let mut prepared = writer.prepare_commit()?;
        prepared.set_payload(&highest.to_string());
        prepared.commit()?;
        self.uncommitted = 0;
        self.highest = highest;
        self.reader.reload()?;
        Ok(Some(highest))
    }

    /// Waits for the index to finish merging its files, so that its size on
    /// the disk is the size it settles at.
    ///
    /// # Errors
    /// When a merge fails.
    pub fn settle(&mut self) -> Result<(), IndexError> {
        if let Some(writer) = self.writer.take() {
            writer.wait_merging_threads()?;
            self.reader.reload()?;
        }
        Ok(())
    }

    /// The messages that best match `query`, best first. A query the parser
    /// cannot read in full is searched for what it could read.
    ///
    /// # Errors
    /// When the index cannot be read.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<i64>, IndexError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let parser =
            QueryParser::for_index(&self.index, vec![self.fields.subject, self.fields.text]);
        let (query, _unread) = parser.parse_query_lenient(query);
        let searcher = self.reader.searcher();
        let hits = searcher.search(&query, &TopDocs::with_limit(limit).order_by_score())?;
        let mut messages = Vec::with_capacity(hits.len());
        for (_score, address) in hits {
            let document: TantivyDocument = searcher.doc(address)?;
            if let Some(message) = document
                .get_first(self.fields.message)
                .and_then(|value| value.as_i64())
            {
                messages.push(message);
            }
        }
        Ok(messages)
    }

    /// How many documents the index holds on the disk.
    #[must_use]
    pub fn documents(&self) -> u64 {
        self.reader.searcher().num_docs()
    }

    fn writer(&mut self) -> Result<&mut IndexWriter, IndexError> {
        if self.writer.is_none() {
            self.writer = Some(self.index.writer(WRITER_MEMORY)?);
        }
        // Just set when it was empty.
        self.writer.as_mut().ok_or_else(|| {
            IndexError::Tantivy(tantivy::TantivyError::InternalError(
                "the index writer is missing".to_string(),
            ))
        })
    }
}

#[cfg(all(test, unix))]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::os::unix::fs::PermissionsExt;

    use super::Index;

    #[test]
    fn its_directory_is_the_owners_alone_new_or_found_open() {
        let parent = tempfile::tempdir().unwrap();
        let mode = |path: &std::path::Path| path.metadata().unwrap().permissions().mode() & 0o777;
        let made = parent.path().join("made");
        drop(Index::open(&made).unwrap());
        assert_eq!(mode(&made), 0o700);
        let found = parent.path().join("found");
        std::fs::create_dir(&found).unwrap();
        std::fs::set_permissions(&found, std::fs::Permissions::from_mode(0o755)).unwrap();
        drop(Index::open(&found).unwrap());
        assert_eq!(mode(&found), 0o700);
    }
}
