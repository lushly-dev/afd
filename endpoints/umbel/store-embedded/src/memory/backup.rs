//! `backup` and `key_status` (phase 3 section 5.4).
//!
//! **The backup** writes `<dest>/memory.sqlite3` with no temporary copy, so plaintext never
//! reaches a new file even after a crash: the destination is created empty with mode `0600`,
//! attached to a connection to the live database, and filled in one transaction, which reads one
//! snapshot, with every table but `records_fts` and `record_derived`, rowids included, and
//! `user_version`, which nothing copies. It never holds the key file or the index, so a record
//! forgotten after it cannot be read from it with the current key file.

use std::collections::HashSet;
use std::path::Path;

use umbel_store::StoreError;
use umbel_store::memory::{BackupReceipt, KeyFileState, KeyStatus};

use super::keys;
use super::points;
use super::schema::{BACKUP_TABLES, MEMORY_SCHEMA_VERSION, qualified};
use super::{MEMORY_FILE, SqliteMemoryStore};
use crate::error::Fail;

impl SqliteMemoryStore {
    pub(super) fn do_backup(&self, dest: &Path) -> Result<BackupReceipt, StoreError> {
        let file = dest.join(MEMORY_FILE);
        self.pool.read(|conn| {
            let io = |e: std::io::Error| -> Fail {
                StoreError::Io(format!("{}: {e}", file.display())).into()
            };
            std::fs::create_dir_all(dest).map_err(io)?;
            // Step 1: the destination, empty and private. Its journal takes the same mode.
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&file) {
                Ok(created) => drop(created),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(StoreError::invalid(format!(
                        "{} already exists; a memory backup is written to a new file",
                        file.display()
                    ))
                    .into());
                }
                Err(e) => return Err(io(e)),
            }
            // Step 2: attach it.
            let path = file.to_string_lossy().into_owned();
            conn.execute("ATTACH DATABASE ?1 AS backup", [&path])?;
            // Step 3: one transaction, one snapshot.
            let copied = (|| -> Result<(), Fail> {
                let tx = conn.transaction()?;
                tx.execute_batch(&qualified("backup"))?;
                for (n, (table, rowid)) in BACKUP_TABLES.iter().enumerate() {
                    let columns: Vec<String> = {
                        let mut stmt =
                            tx.prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))?;
                        let found = stmt.query_map([], |r| r.get(0))?;
                        found.collect::<Result<_, _>>()?
                    };
                    let mut list = columns.join(", ");
                    if *rowid {
                        list = format!("rowid, {list}");
                    }
                    tx.execute(
                        &format!(
                            "INSERT INTO backup.{table} ({list}) SELECT {list} FROM main.{table}"
                        ),
                        [],
                    )?;
                    if n == BACKUP_TABLES.len() / 2 {
                        points::crash("backup-copy");
                    }
                }
                tx.execute_batch(&format!(
                    "PRAGMA backup.user_version = {MEMORY_SCHEMA_VERSION}"
                ))?;
                tx.commit()?;
                Ok(())
            })();
            let detached = conn.execute("DETACH DATABASE backup", []);
            copied?;
            detached?;
            let bytes = std::fs::metadata(&file).map_err(io)?.len();
            Ok(BackupReceipt {
                file: file.clone(),
                bytes,
            })
        })
    }

    pub(super) fn do_key_status(&self) -> Result<KeyStatus, StoreError> {
        let status = |file| KeyStatus {
            file,
            unsettled: 0,
            destroyed: 0,
            orphans: 0,
            absent: 0,
        };
        let result = self.pool.read(|conn| {
            let keys = match self.pool.keys(|kc| keys::all(kc)) {
                Ok(keys) => keys,
                Err(Fail::Store(StoreError::KeysMissing)) => {
                    return Ok(status(KeyFileState::Missing));
                }
                Err(Fail::Store(StoreError::KeysMismatch)) => {
                    return Ok(status(KeyFileState::Mismatch));
                }
                Err(other) => return Err(other),
            };
            let rows: HashSet<String> = {
                let mut stmt = conn.prepare("SELECT id FROM records")?;
                let found = stmt.query_map([], |r| r.get(0))?;
                found.collect::<Result<_, _>>()?
            };
            let absent = rows.iter().filter(|id| keys.entry(id).is_none()).count() as u64;
            let (destroyed, unsettled) = keys.marker_counts();
            let orphans = keys::orphans(&keys, &rows).len() as u64;
            Ok(KeyStatus {
                file: KeyFileState::Present,
                unsettled,
                destroyed,
                orphans,
                absent,
            })
        });
        // An open that could not check its key file says so here rather than failing.
        match result {
            Err(StoreError::KeysMissing) => Ok(status(KeyFileState::Missing)),
            Err(StoreError::KeysMismatch) => Ok(status(KeyFileState::Mismatch)),
            other => other,
        }
    }
}
