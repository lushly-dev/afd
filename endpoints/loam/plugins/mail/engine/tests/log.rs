//! The log: bytes in, the same bytes out, and damage noticed.

#![allow(clippy::expect_used)]

use std::fs;
use std::path::PathBuf;

use loam_mail::log::{BlobId, Log, LogError};

const NO_LIMIT: u64 = u64::MAX;

fn log() -> (tempfile::TempDir, Log) {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let log = Log::open(directory.path().join("blobs")).expect("the log opens");
    (directory, log)
}

fn files(directory: &tempfile::TempDir) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for shard in fs::read_dir(directory.path().join("blobs")).expect("the log's directory") {
        for file in fs::read_dir(shard.expect("an entry").path()).expect("a shard") {
            found.push(file.expect("an entry").path());
        }
    }
    found
}

#[test]
fn bytes_come_back_as_they_went_in() {
    let (directory, log) = log();
    let message = b"Subject: hello\r\n\r\nA body, twice. A body, twice.\r\n".repeat(50);
    let id = log.put(&message).expect("stored");
    assert_eq!(id, BlobId::of(&message));
    assert!(log.holds(id));
    assert_eq!(log.get(id, NO_LIMIT).expect("read"), message);
    // Empty bytes and bytes that are not text are held too.
    for bytes in [&b""[..], &[0, 255, 0, 255, 13, 10]] {
        let id = log.put(bytes).expect("stored");
        assert_eq!(log.get(id, NO_LIMIT).expect("read"), bytes);
    }
    // The file is named by the hash, under its first two digits, and is compressed.
    let path = directory
        .path()
        .join("blobs")
        .join(&id_hex(&message)[..2])
        .join(id_hex(&message));
    let on_disk = fs::metadata(path).expect("the file").len();
    assert!(on_disk < message.len() as u64 / 2, "{on_disk}");
}

fn id_hex(bytes: &[u8]) -> String {
    BlobId::of(bytes).to_hex()
}

#[test]
fn the_id_is_the_sha_256_of_the_bytes() {
    assert_eq!(
        BlobId::of(b"abc").to_hex(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let id = BlobId::of(b"abc");
    assert_eq!(BlobId::from_bytes(id.as_bytes()), Some(id));
    assert_eq!(BlobId::from_bytes(&[0; 31]), None);
}

#[test]
fn the_same_bytes_are_written_once() {
    let (directory, log) = log();
    let id = log.put(b"once").expect("stored");
    let path = files(&directory).pop().expect("one file");
    let written = fs::metadata(&path)
        .expect("the file")
        .modified()
        .expect("a time");
    assert_eq!(log.put(b"once").expect("stored again"), id);
    assert_eq!(files(&directory).len(), 1);
    assert_eq!(
        fs::metadata(&path)
            .expect("the file")
            .modified()
            .expect("a time"),
        written
    );
}

#[test]
fn what_is_not_held_is_reported_as_such() {
    let (_directory, log) = log();
    let id = BlobId::of(b"never stored");
    assert!(!log.holds(id));
    assert!(matches!(log.get(id, NO_LIMIT), Err(LogError::NotHeld(found)) if found == id));
}

#[test]
fn a_damaged_file_is_noticed() {
    let (directory, log) = log();
    let id = log.put(&b"some mail ".repeat(100)).expect("stored");
    let path = files(&directory).pop().expect("one file");
    // Not a compressed file at all.
    fs::write(&path, b"not zstd").expect("overwritten");
    assert!(matches!(log.get(id, NO_LIMIT), Err(LogError::Corrupt(_))));
    // A valid compressed file holding other bytes than its name promises.
    let other = log.put(b"other bytes").expect("stored");
    let other_path = files(&directory)
        .into_iter()
        .find(|file| *file != path)
        .expect("the other file");
    fs::copy(other_path, &path).expect("copied");
    assert!(matches!(log.get(id, NO_LIMIT), Err(LogError::Corrupt(_))));
    assert_eq!(log.get(other, NO_LIMIT).expect("read"), b"other bytes");
    // An empty file, as a power failure can leave.
    fs::write(&path, b"").expect("emptied");
    assert!(matches!(log.get(id, NO_LIMIT), Err(LogError::Corrupt(_))));
    // Storing the bytes again repairs it, and the damaged file is kept aside.
    assert_eq!(log.put(&b"some mail ".repeat(100)).expect("stored"), id);
    assert_eq!(
        log.get(id, NO_LIMIT).expect("read"),
        b"some mail ".repeat(100)
    );
    let aside = directory.path().join("blobs/damaged");
    assert_eq!(
        fs::read_dir(&aside).expect("the damaged directory").count(),
        1
    );
    // Setting a file aside by hand: it is gone from the log, and still on disk.
    assert!(log.set_aside(id).expect("set aside"));
    assert!(!log.set_aside(id).expect("nothing to set aside"));
    assert!(matches!(log.get(id, NO_LIMIT), Err(LogError::NotHeld(_))));
    assert_eq!(
        fs::read_dir(&aside).expect("the damaged directory").count(),
        2
    );
}

#[test]
fn a_batch_is_made_durable_and_a_missing_file_is_an_error() {
    let (_directory, log) = log();
    let ids = [
        log.put(b"one").expect("stored"),
        log.put(b"two").expect("stored"),
    ];
    log.make_durable(&ids).expect("flushed");
    log.make_durable(&[]).expect("nothing to flush");
    assert!(matches!(
        log.make_durable(&[BlobId::of(b"never stored")]),
        Err(LogError::Io(_))
    ));
    for id in ids {
        assert!(log.holds(id));
    }
}

#[test]
fn a_read_stops_at_its_limit() {
    let (_directory, log) = log();
    // Highly compressible: a small file that expands to a megabyte.
    let bytes = vec![b'a'; 1024 * 1024];
    let id = log.put(&bytes).expect("stored");
    assert!(matches!(log.get(id, 1024), Err(LogError::TooLong(_))));
    assert!(matches!(
        log.get(id, bytes.len() as u64 - 1),
        Err(LogError::TooLong(_))
    ));
    assert_eq!(
        log.get(id, bytes.len() as u64).expect("read").len(),
        bytes.len()
    );
}

#[test]
fn a_leftover_temporary_file_is_ignored() {
    let (directory, log) = log();
    let id = log.put(b"kept").expect("stored");
    let shard = files(&directory)
        .pop()
        .expect("one file")
        .parent()
        .expect("a shard")
        .to_path_buf();
    fs::write(shard.join(format!(".{}.1.0.tmp", id.to_hex())), b"half").expect("written");
    assert_eq!(log.get(id, NO_LIMIT).expect("read"), b"kept");
    assert_eq!(log.put(b"kept").expect("stored again"), id);
}
