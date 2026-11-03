//! Memory kept out of Time Machine (phase 3 section 5.4, D87). On macOS: the attribute on
//! `memory.sqlite3` at provisioning and on the temporary key file before its rename, so still there
//! after it; set by a writer's open on the WAL and shared-memory files and on a database copied
//! into place unmarked; removed by a writer's open with the setting `false`; `tmutil isexcluded`
//! agrees where `tmutil` exists. It runs in the `knowledge` job's daily macOS leg and on the
//! owner's Mac before each push. On other systems: no attribute and no error.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
use support::open_memory;
use umbel_store::MemoryStore;
use umbel_store::conformance::samples;
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions, is_excluded_from_machine_backup};

fn store(dir: &Path, exclude: bool) -> SqliteMemoryStore {
    SqliteMemoryStore::open(dir, "main", StoreOptions::default())
        .expect("opening")
        .with_machine_backup_exclusion(exclude)
}

fn write(m: &dyn MemoryStore, n: u64) {
    m.write(samples::memory_batch(
        samples::MEMORY_AT,
        vec![samples::memory_entry(
            n,
            "human:ada",
            &["principal:human:ada"],
            "a note",
            &format!("note {n}"),
        )],
    ))
    .expect("a write");
}

fn excluded(path: &Path) -> bool {
    is_excluded_from_machine_backup(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[cfg(not(target_os = "macos"))]
#[test]
fn elsewhere_nothing_is_set_and_nothing_fails() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = store(dir.path(), true);
    write(&m, 1);
    for path in m.files() {
        assert!(!excluded(&path), "{}", path.display());
    }
    let m = store(dir.path(), false);
    write(&m, 2);
}

#[cfg(target_os = "macos")]
mod macos {
    use std::process::{Command, Stdio};

    use super::*;

    const NAME: &str = "com.apple.metadata:com_apple_backup_excludeItem";

    fn unmark(path: &Path) {
        let status = Command::new("xattr")
            .args(["-d", NAME])
            .arg(path)
            .stderr(Stdio::null())
            .status()
            .expect("xattr");
        assert!(
            status.success(),
            "removing the mark from {}",
            path.display()
        );
        assert!(!excluded(path));
    }

    /// What `tmutil isexcluded` says, when `tmutil` exists.
    fn tmutil_says(path: &Path) -> Option<bool> {
        let output = Command::new("tmutil")
            .arg("isexcluded")
            .arg(path)
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).contains("[Excluded]"))
    }

    /// `tmutil isexcluded` agrees, when `tmutil` exists and the directory is not excluded as a
    /// whole: macOS excludes the temporary folders, so an unmarked control file there would read
    /// as excluded too, and the answer would say nothing about the mark.
    fn tmutil_agrees(path: &Path, expected: bool) {
        let control = path.with_file_name("tmutil-control");
        std::fs::write(&control, b"").expect("a control file");
        let control_excluded = tmutil_says(&control);
        let _ = std::fs::remove_file(&control);
        if control_excluded != Some(false) {
            return;
        }
        let said = tmutil_says(path);
        assert_eq!(said, Some(expected), "{}", path.display());
    }

    /// A directory outside the system's temporary folders, which Time Machine excludes whole, so
    /// that `tmutil` can tell a marked file from an unmarked one.
    fn included_dir() -> tempfile::TempDir {
        tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).expect("a directory in the target")
    }

    #[test]
    fn provisioning_marks_both_files_and_a_writers_open_marks_the_rest() {
        let dir = included_dir();
        let m = store(dir.path(), true);
        write(&m, 1);
        for path in m.files() {
            assert!(path.exists(), "{}", path.display());
            assert!(excluded(&path), "{}", path.display());
            tmutil_agrees(&path, true);
        }
        // A writer's open puts it back where it is missing.
        let [db, wal, shm, keys] = <[PathBuf; 4]>::try_from(m.files()).expect("four files");
        for path in [&wal, &shm, &keys] {
            unmark(path);
        }
        let again = store(dir.path(), true);
        write(&again, 2);
        for path in [&db, &wal, &shm, &keys] {
            assert!(excluded(path), "{}", path.display());
        }
    }

    #[test]
    fn the_key_file_is_marked_before_its_rename() {
        // A crash right after the rename, before any writer's open: the mark the temporary file
        // carried is what the key file has.
        let dir = tempfile::tempdir().expect("a temporary directory");
        let exe = std::env::current_exe().expect("the test binary");
        let status = Command::new(exe)
            .args(["--exact", "macos::machine_backup_child", "--nocapture"])
            .env("UMBEL_MB_CHILD", dir.path())
            .env("UMBEL_TEST_CRASH_AT", "provision-keys")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("the child");
        assert!(!status.success(), "the child aborts after the rename");
        let store_dir = dir.path().join("store");
        assert!(excluded(&store_dir.join("memory.keys")), "the key file");
        assert!(
            excluded(&store_dir.join("memory.sqlite3")),
            "the database, from step 1"
        );
    }

    #[test]
    fn machine_backup_child() {
        let Ok(dir) = std::env::var("UMBEL_MB_CHILD") else {
            return;
        };
        write(&store(Path::new(&dir), true), 1);
    }

    #[test]
    fn a_database_copied_into_place_unmarked_is_marked_by_a_writer() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let copy = tempfile::tempdir().expect("a backup directory");
        let m = store(dir.path(), true);
        write(&m, 1);
        m.backup(copy.path()).expect("backup");
        assert!(
            !excluded(&copy.path().join("memory.sqlite3")),
            "a backup is not excluded"
        );
        drop(m);
        support::restore_memory(dir.path(), "main", copy.path()).expect("restore");
        let db = dir.path().join("store").join("memory.sqlite3");
        assert!(!excluded(&db), "restored by hand, unmarked");
        // A read does not mark it.
        let reader = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
        let _ = reader.head().expect("head");
        assert!(!excluded(&db));
        let m = store(dir.path(), true);
        write(&m, 2);
        assert!(excluded(&db), "marked by the writer's open");
        tmutil_agrees(&db, true);
    }

    #[test]
    fn the_setting_off_removes_the_mark_at_the_next_write() {
        let dir = included_dir();
        let m = store(dir.path(), true);
        write(&m, 1);
        let files = m.files();
        drop(m);
        let off = store(dir.path(), false);
        write(&off, 2);
        for path in &files {
            assert!(!excluded(path), "{}", path.display());
            tmutil_agrees(path, false);
        }
        // And a store provisioned with it off never marks.
        let fresh = tempfile::tempdir().expect("a temporary directory");
        let m = store(fresh.path(), false);
        write(&m, 1);
        for path in m.files() {
            assert!(!excluded(&path), "{}", path.display());
        }
    }
}
