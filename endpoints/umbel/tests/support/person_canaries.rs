//! The person page's persisted-content check, shared by the OAuth and gateway tests.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

/// Assert that no file in a complete workspace scan contains a canary.
pub(super) fn assert_absent(dir: &Path, canaries: &[&str]) {
    const MAX_SCANS: usize = 5;

    for attempt in 1..=MAX_SCANS {
        match scan(dir, canaries) {
            Ok(()) => return,
            // The running host can remove a temporary file while we walk. Start over so
            // the next scan also checks any file that took its place.
            Err((_, error)) if error.kind() == ErrorKind::NotFound && attempt < MAX_SCANS => {}
            Err((path, error)) => panic!(
                "scanning {} for person-page canaries: {error}",
                path.display()
            ),
        }
    }
}

fn scan(dir: &Path, canaries: &[&str]) -> Result<(), (PathBuf, io::Error)> {
    for entry in fs::read_dir(dir).map_err(|error| (dir.to_path_buf(), error))? {
        let path = entry.map_err(|error| (dir.to_path_buf(), error))?.path();
        let metadata = fs::metadata(&path).map_err(|error| (path.clone(), error))?;
        if metadata.is_dir() {
            scan(&path, canaries)?;
        } else {
            let bytes = fs::read(&path).map_err(|error| (path.clone(), error))?;
            for canary in canaries {
                assert!(
                    !bytes
                        .windows(canary.len())
                        .any(|window| window == canary.as_bytes()),
                    "{canary} in {}",
                    path.display()
                );
            }
        }
    }
    Ok(())
}
