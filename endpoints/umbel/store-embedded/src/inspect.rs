//! What `store-show`, `store-check` and `store-backup` ask of the stores (specification section
//! 3.5): readable counts, integrity and access-table consistency, and a consistent copy.

use std::path::Path;

use umbel_store::{ReaderFilter, StoreError};

use crate::SqliteStore;
use crate::error::Fail;
use crate::sql::Sql;

/// Row counts in a reader's view: of what the reader can read, or of everything under a
/// derivation read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StoreCounts {
    /// Stored documents.
    pub documents: u64,
    /// Plugin records.
    pub records: u64,
    /// Changes in the log.
    pub changes: u64,
    /// Graph nodes (shared nodes counted once per id).
    pub nodes: u64,
    /// Graph edge rows (one per origin document).
    pub edges: u64,
}

impl SqliteStore {
    /// Counts of what `reader` can read; the totals for a derivation read.
    ///
    /// # Errors
    /// `Busy`, `Corrupt` or `Io`.
    pub fn counts(&self, reader: &ReaderFilter) -> Result<StoreCounts, StoreError> {
        self.pool().with(|conn| {
            let count = |mut sql: Sql| -> Result<u64, Fail> {
                let value: i64 = conn.query_row(
                    &sql.text,
                    rusqlite::params_from_iter(std::mem::take(&mut sql.params)),
                    |row| row.get(0),
                )?;
                Ok(u64::try_from(value).unwrap_or(0))
            };
            let mut documents = Sql::new("SELECT COUNT(*) FROM documents d WHERE 1 = 1");
            documents.and_doc_readable("d.doc", reader);
            let mut records = Sql::new("SELECT COUNT(*) FROM records r WHERE 1 = 1");
            records.and_readable(
                "record_access",
                &[("ns", "r.ns"), ("kind", "r.kind"), ("id", "r.id")],
                reader,
            );
            let mut changes = Sql::new("SELECT COUNT(*) FROM changes c WHERE 1 = 1");
            changes.and_readable("change_access", &[("rev", "c.rev")], reader);
            let mut nodes = Sql::new("SELECT COUNT(DISTINCT n.id) FROM nodes n WHERE 1 = 1");
            nodes.and_doc_readable("n.origin", reader);
            let mut edges = Sql::new("SELECT COUNT(*) FROM edges e WHERE 1 = 1");
            edges.and_doc_readable("e.origin", reader);
            Ok(StoreCounts {
                documents: count(documents)?,
                records: count(records)?,
                changes: count(changes)?,
                nodes: count(nodes)?,
                edges: count(edges)?,
            })
        })
    }

    /// `PRAGMA integrity_check`: what SQLite reports other than `ok`, one entry per line.
    ///
    /// # Errors
    /// `Busy` or `Io`; a damaged file may also be `Corrupt`.
    pub fn integrity_check(&self) -> Result<Vec<String>, StoreError> {
        self.pool().with(|conn| {
            let mut statement = conn.prepare("PRAGMA integrity_check")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            let mut findings = Vec::new();
            for row in rows {
                let line = row?;
                if line != "ok" {
                    findings.push(line);
                }
            }
            Ok(findings)
        })
    }

    /// Rows that must carry at least one access token but carry none: documents, records and
    /// changes. Each entry names the kind and the key.
    ///
    /// # Errors
    /// `Busy`, `Corrupt` or `Io`.
    pub fn access_problems(&self) -> Result<Vec<String>, StoreError> {
        self.pool().with(|conn| {
            let mut found = Vec::new();
            let mut collect = |sql: &str, what: &str| -> Result<(), Fail> {
                let mut statement = conn.prepare(sql)?;
                let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
                for row in rows.take(100) {
                    found.push(format!("{what} {}", row?));
                }
                Ok(())
            };
            collect(
                "SELECT d.doc FROM documents d WHERE NOT EXISTS (SELECT 1 FROM doc_access a WHERE a.doc = d.doc)",
                "document",
            )?;
            collect(
                "SELECT r.ns || '/' || r.kind || '/' || r.id FROM records r WHERE NOT EXISTS (SELECT 1 FROM record_access a WHERE a.ns = r.ns AND a.kind = r.kind AND a.id = r.id)",
                "record",
            )?;
            collect(
                "SELECT CAST(c.rev AS TEXT) FROM changes c WHERE NOT EXISTS (SELECT 1 FROM change_access a WHERE a.rev = c.rev)",
                "change",
            )?;
            Ok(found)
        })
    }

    /// A consistent copy of the database in `path`, which must not exist (`VACUUM INTO`).
    ///
    /// # Errors
    /// `Invalid` when `path` exists; `Busy`, `Corrupt` or `Io` otherwise.
    pub fn backup_to(&self, path: &Path) -> Result<(), StoreError> {
        if path.exists() {
            return Err(StoreError::invalid(format!(
                "{} already exists; a backup is written to a new file",
                path.display()
            )));
        }
        let target = path.to_string_lossy().into_owned();
        self.pool().with(|conn| {
            conn.execute("VACUUM INTO ?1", [&target])?;
            Ok(())
        })
    }
}
