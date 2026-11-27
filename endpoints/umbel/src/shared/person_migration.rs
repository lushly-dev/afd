//! `person.sqlite3`'s migrations, apart from the store's reads and writes (phase 5 step 5; the
//! Ideas host-review specification, section 3).

use rusqlite::Connection;
use std::path::Path;

/// Migrate a version 1 or 2 store to `to` (version 3) under the write lock, reading the version
/// again inside it: of two processes that open an older file at once, the second finds it
/// migrated. The store is copied beside itself first, under that lock, named for the version it
/// had (D214). Version 1 gains the pages; version 2 gains the relay binding (D219), `NULL` for
/// every older row, so no decision begun before it can be found by the pending list.
pub(super) fn migrate(connection: &Connection, path: &Path, to: i64) -> rusqlite::Result<()> {
    connection.execute_batch("BEGIN IMMEDIATE")?;
    let migrated = (|| {
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version != 1 && version != 2 {
            return Ok(());
        }
        super::copy_before_migration(path, version)?;
        if version == 1 {
            connection.execute_batch(
                "ALTER TABLE decisions ADD COLUMN pages_total INTEGER;
                 ALTER TABLE decisions ADD COLUMN pages TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE decisions ADD COLUMN excluded TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE logins ADD COLUMN namespace TEXT;",
            )?;
        }
        connection.execute_batch(&format!(
            "ALTER TABLE decisions ADD COLUMN binding TEXT;
             PRAGMA user_version = {to};"
        ))
    })();
    match migrated {
        Ok(()) => connection.execute_batch("COMMIT"),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}
