//! The copy before a migration (D214, [#1772](https://github.com/lushly-dev/afd/issues/1772)):
//! before a database at an older schema version is migrated at open, the file is copied whole
//! beside it, so a migration that goes wrong, or a host that must be rolled back, has the store as
//! it was.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use umbel_store::StoreError;

/// The suffix of a copy taken before a migration: `<file>.v<version>.pre-migration`.
pub const PRE_MIGRATION_SUFFIX: &str = ".pre-migration";

/// Where the first copy of `path` at schema version `from` goes: `<file>.v<from>.pre-migration`,
/// beside it. A later copy from the same version goes to `<file>.v<from>.<n>.pre-migration`.
#[must_use]
pub fn pre_migration_path(path: &Path, from: u32) -> PathBuf {
    numbered(path, from, 1)
}

fn numbered(path: &Path, from: u32, n: u32) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    if n == 1 {
        name.push(format!(".v{from}{PRE_MIGRATION_SUFFIX}"));
    } else {
        name.push(format!(".v{from}.{n}{PRE_MIGRATION_SUFFIX}"));
    }
    path.with_file_name(name)
}

/// Copy the database at `path` to `dest`, which must not exist, with `VACUUM INTO` on a
/// read-only connection of its own: one consistent snapshot of what is committed, mode 0600. The
/// copy is written to `<dest>.partial`, synced, then linked to `dest`, so `dest` exists only
/// whole: a copy cut short by a crash is left as `.partial`, which the next copy replaces.
///
/// # Errors
/// `Io` when the copy cannot be written, or `dest` exists.
pub fn copy_database(path: &Path, dest: &Path) -> Result<(), StoreError> {
    let io = |e: &dyn std::fmt::Display| {
        StoreError::Io(format!(
            "copying {} to {}: {e}",
            path.display(),
            dest.display()
        ))
    };
    let mut partial = dest.as_os_str().to_os_string();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    match std::fs::remove_file(&partial) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(io(&e)),
    }
    // `VACUUM INTO` writes into a file that does not exist or is empty: create it private first,
    // so the copy never has a wider mode than the store.
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(&partial).map(drop).map_err(|e| io(&e))?;
    let copied = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .and_then(|conn| {
        // A live store's checkpoint can hold a lock for a moment: wait for it, not fail.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute("VACUUM INTO ?1", [partial.to_string_lossy().as_ref()])
            .map(drop)
    })
    .map_err(|e| io(&e))
    .and_then(|()| {
        std::fs::File::open(&partial)
            .and_then(|file| file.sync_all())
            .map_err(|e| io(&e))
    })
    // A link, not a rename: it refuses to replace a `dest` that exists.
    .and_then(|()| std::fs::hard_link(&partial, dest).map_err(|e| io(&e)));
    let _ = std::fs::remove_file(&partial);
    copied
}

/// Copy the database at `path`, at schema version `from`, beside it with [`copy_database`], to
/// [`pre_migration_path`] or, when a copy from that version is already there (an earlier
/// upgrade, or an attempt that rolled back), to the next free `<file>.v<from>.<n>.pre-migration`:
/// no copy is ever reused or replaced, so each one is the store its own migration started from.
/// Call it while another connection holds the write lock the migration runs under
/// (`BEGIN IMMEDIATE`, not yet written): this read then sees exactly the store the migration
/// starts from. Answers the copy's path.
///
/// # Errors
/// `Io` when the copy cannot be written. The caller must not migrate then.
pub fn copy_before_migration(path: &Path, from: u32) -> Result<PathBuf, StoreError> {
    let fail = |error: &dyn std::fmt::Display| {
        StoreError::Io(format!(
            "the copy before migrating {} from version {from}: {error}",
            path.display()
        ))
    };
    let copy = (1..=1000)
        .map(|n| numbered(path, from, n))
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| fail(&"a thousand copies from this version are already there"))?;
    copy_database(path, &copy).map_err(|error| fail(&error))?;
    Ok(copy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_copy_is_named_after_the_file_and_version() {
        assert_eq!(
            pre_migration_path(Path::new("/w/state/store.sqlite3"), 4),
            PathBuf::from("/w/state/store.sqlite3.v4.pre-migration")
        );
    }

    #[test]
    fn it_copies_the_committed_store_and_keeps_an_earlier_copy() {
        let dir = tempfile::tempdir().expect("dir");
        let path = dir.path().join("a.sqlite3");
        let conn = Connection::open(&path).expect("open");
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1);
             PRAGMA user_version = 3;",
        )
        .expect("schema");
        // The migration's write lock is held, and nothing is written under it yet.
        conn.execute_batch("BEGIN IMMEDIATE").expect("lock");
        let copy = copy_before_migration(&path, 3).expect("copy");
        conn.execute_batch("INSERT INTO t VALUES (2); PRAGMA user_version = 4; COMMIT")
            .expect("migrate");
        let read = Connection::open(&copy).expect("open copy");
        let rows: i64 = read
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .expect("count");
        let version: u32 = read
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("version");
        assert_eq!((rows, version), (1, 3));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&copy).expect("meta").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        drop(read);
        // A second copy from version 3 goes beside the first and leaves it as it was.
        let before = std::fs::read(&copy).expect("bytes");
        let second = copy_before_migration(&path, 3).expect("again");
        assert_eq!(
            second,
            dir.path().join("a.sqlite3.v3.2.pre-migration"),
            "a numbered name"
        );
        assert_eq!(std::fs::read(&copy).expect("bytes"), before);
    }

    #[test]
    fn a_partial_copy_left_by_a_crash_is_replaced_and_never_taken_for_a_copy() {
        let dir = tempfile::tempdir().expect("dir");
        let path = dir.path().join("a.sqlite3");
        Connection::open(&path)
            .expect("open")
            .execute_batch("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (7);")
            .expect("schema");
        let copy = pre_migration_path(&path, 1);
        let partial = dir.path().join("a.sqlite3.v1.pre-migration.partial");
        std::fs::write(&partial, b"cut short").expect("partial");
        assert_eq!(copy_before_migration(&path, 1).expect("copy"), copy);
        assert!(!partial.exists());
        let rows: i64 = Connection::open(&copy)
            .expect("open copy")
            .query_row("SELECT v FROM t", [], |r| r.get(0))
            .expect("row");
        assert_eq!(rows, 7);
    }

    #[test]
    fn a_failed_copy_leaves_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        let path = dir.path().join("absent.sqlite3");
        assert!(copy_before_migration(&path, 1).is_err());
        assert!(!pre_migration_path(&path, 1).exists());
    }
}
