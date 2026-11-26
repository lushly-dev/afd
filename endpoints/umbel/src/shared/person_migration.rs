//! `person.sqlite3`'s migrations, apart from the store's reads and writes (phase 5 step 5; the
//! Ideas host-review specification, section 3).

use rusqlite::Connection;
use std::path::Path;

/// Migrate a version 1 store to `to` (version 2) under the write lock, reading the version again
/// inside it: of two processes that open a version 1 file at once, the second finds it migrated.
/// The store is copied beside itself first, under that lock (D214).
pub(super) fn migrate_from_1(
    connection: &Connection,
    path: &Path,
    to: i64,
) -> rusqlite::Result<()> {
    connection.execute_batch("BEGIN IMMEDIATE")?;
    let migrated = (|| {
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version == 1 {
            super::copy_before_migration(path, 1)?;
            connection.execute_batch(&format!(
                "ALTER TABLE decisions ADD COLUMN pages_total INTEGER;
                 ALTER TABLE decisions ADD COLUMN pages TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE decisions ADD COLUMN excluded TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE logins ADD COLUMN namespace TEXT;
                 PRAGMA user_version = {to};"
            ))?;
        }
        Ok(())
    })();
    match migrated {
        Ok(()) => connection.execute_batch("COMMIT"),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}
