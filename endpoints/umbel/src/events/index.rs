//! The sparse index beside an event stream, `state/spaces/<space>/events.idx` (D209): derived,
//! rebuildable, never the source of truth, and safe to delete.
//!
//! A 16-byte header (`UMBELIDX`, then the format version and the stride, each a little-endian
//! `u32`), then one 16-byte record for every [`STRIDE`]th event: its `seq` and the byte offset of
//! its line in the stream, each a little-endian `u64`. Record `i` holds event `(i + 1) × STRIDE`,
//! so finding one is a seek, not a search. The stream module keeps it (under the workspace lock)
//! and reads it (without the lock, checking each record it uses against the stream it opened).

use serde::Deserialize;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// How many events one index record stands for.
#[cfg(not(test))]
pub(crate) const STRIDE: u64 = 256;
/// Small in unit tests, so that a few events span many records.
#[cfg(test)]
pub(crate) const STRIDE: u64 = 4;

const INDEX_MAGIC: &[u8; 8] = b"UMBELIDX";
/// The index format, version 0.
const INDEX_VERSION: u32 = 0;
pub(super) const HEADER_LEN: u64 = 16;
pub(super) const RECORD_LEN: u64 = 16;

/// `events.idx`, beside the stream at `path`.
pub(crate) fn index_path(path: &Path) -> PathBuf {
    path.with_extension("idx")
}

pub(super) fn header() -> [u8; 16] {
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(INDEX_MAGIC);
    bytes[8..12].copy_from_slice(&INDEX_VERSION.to_le_bytes());
    bytes[12..].copy_from_slice(&u32::try_from(STRIDE).unwrap_or(u32::MAX).to_le_bytes());
    bytes
}

pub(super) fn record_bytes(seq: u64, offset: u64) -> [u8; 16] {
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&seq.to_le_bytes());
    bytes[8..].copy_from_slice(&offset.to_le_bytes());
    bytes
}

/// Record `number` (from 0) of an index: its offset, when it is complete and holds event
/// `(number + 1) × STRIDE`.
pub(super) fn read_record(index: &mut File, number: u64) -> std::io::Result<Option<u64>> {
    let mut bytes = [0u8; 16];
    index.seek(SeekFrom::Start(HEADER_LEN + number * RECORD_LEN))?;
    match index.read_exact(&mut bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let half = |range: std::ops::Range<usize>| {
        u64::from_le_bytes(bytes[range].try_into().unwrap_or_default())
    };
    Ok((half(0..8) == (number + 1) * STRIDE).then(|| half(8..16)))
}

#[derive(Deserialize)]
struct SeqOnly {
    seq: u64,
}

/// Whether a complete line of `stream` starts at `offset` and is event `seq`. Moves the file's
/// position.
pub(super) fn line_is(stream: &mut File, offset: u64, seq: u64) -> std::io::Result<bool> {
    if offset > 0 {
        let mut before = [0u8; 1];
        stream.seek(SeekFrom::Start(offset - 1))?;
        if stream.read(&mut before)? != 1 || before[0] != b'\n' {
            return Ok(false);
        }
    } else {
        stream.seek(SeekFrom::Start(0))?;
    }
    let mut line = Vec::new();
    BufReader::new(&*stream).read_until(b'\n', &mut line)?;
    if line.last() != Some(&b'\n') {
        return Ok(false);
    }
    Ok(serde_json::from_slice::<SeqOnly>(&line).is_ok_and(|found| found.seq == seq))
}

/// The records of every `STRIDE`th event from `offset` (where a line starts after `before`
/// events) to `len`, the first being event `(records + 1) × STRIDE`. Stops at the first such
/// line that is not the event its position says (a stream that is not well formed is not indexed
/// past that point).
fn index_lines(
    stream: &mut File,
    (offset, before): (u64, u64),
    len: u64,
    records: u64,
) -> std::io::Result<Vec<u8>> {
    stream.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::new((&*stream).take(len.saturating_sub(offset)));
    let (mut number, mut position) = (before, offset);
    let mut expected = (records + 1) * STRIDE;
    let mut line = Vec::new();
    let mut out = Vec::new();
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 || line.last() != Some(&b'\n') {
            break;
        }
        let at = position;
        position += read as u64;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        number += 1;
        if number == expected {
            if !serde_json::from_slice::<SeqOnly>(&line).is_ok_and(|found| found.seq == number) {
                break;
            }
            out.extend_from_slice(&record_bytes(number, at));
            expected += STRIDE;
        }
    }
    Ok(out)
}

/// The index, open for append under the lock: `records` complete records, each checked.
pub(super) struct IndexWriter {
    pub(super) file: File,
    pub(super) records: u64,
}

impl IndexWriter {
    /// Open (creating when missing) the index of the stream at `path`, which `stream` holds open,
    /// `len` bytes long and ending at event `tail`, and bring it up to date.
    pub(super) fn open(
        path: &Path,
        stream: &mut File,
        len: u64,
        tail: u64,
    ) -> std::io::Result<Self> {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(index_path(path))?;
        let length = file.metadata()?.len();
        let mut found = [0u8; 16];
        let ours = length >= HEADER_LEN && {
            file.seek(SeekFrom::Start(0))?;
            file.read_exact(&mut found)?;
            found == header()
        };
        let mut records = if ours {
            ((length - HEADER_LEN) / RECORD_LEN).min(tail / STRIDE)
        } else {
            0
        };
        // The last record must name its line; otherwise the stream was replaced or cut, and the
        // index is built again from the start.
        let mut from = (0u64, 0u64);
        if records > 0 {
            let seq = records * STRIDE;
            match read_record(&mut file, records - 1)? {
                Some(offset) if offset < len && line_is(stream, offset, seq)? => {
                    from = (offset, seq - 1);
                }
                _ => records = 0,
            }
        }
        if !ours {
            file.set_len(0)?;
            file.seek(SeekFrom::Start(0))?;
            file.write_all(&header())?;
        }
        let kept = HEADER_LEN + records * RECORD_LEN;
        if !ours || length != kept {
            file.set_len(kept)?;
        }
        if tail / STRIDE > records {
            let fresh = index_lines(stream, from, len, records)?;
            file.seek(SeekFrom::Start(HEADER_LEN + records * RECORD_LEN))?;
            file.write_all(&fresh)?;
            records += fresh.len() as u64 / RECORD_LEN;
        }
        file.seek(SeekFrom::End(0))?;
        Ok(Self { file, records })
    }
}

/// The index of a stream written whole (`event-rebuild`): fed each line's `seq` and offset in
/// order, then written beside the stream.
pub(crate) struct IndexBuilder {
    bytes: Vec<u8>,
}

impl IndexBuilder {
    pub(crate) fn new() -> Self {
        Self {
            bytes: header().to_vec(),
        }
    }

    /// Event `seq`'s line starts at `offset`.
    pub(crate) fn line(&mut self, seq: u64, offset: u64) {
        if seq.is_multiple_of(STRIDE) {
            self.bytes.extend_from_slice(&record_bytes(seq, offset));
        }
    }

    /// Write the index beside the stream at `path`: a temporary file renamed over the old one.
    /// Hold the lock.
    pub(crate) fn write(&self, path: &Path) -> std::io::Result<()> {
        let target = index_path(path);
        let temporary = target.with_file_name(format!(
            ".events.idx.{}.{}.tmp",
            std::process::id(),
            crate::host::new_trace_id()
        ));
        let written = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .and_then(|mut file| file.write_all(&self.bytes))
            .and_then(|()| std::fs::rename(&temporary, &target));
        if written.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        written
    }
}

/// Remove the index beside the stream at `path`, if there is one. Hold the lock.
pub(crate) fn remove_index(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(index_path(path)) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Whether the index beside the stream at `path` agrees with `expected`, the `seq` and offset of
/// every `STRIDE`th event as the stream holds them: each record it has names that line. A missing
/// index, one of another format and records past the stream are not disagreements (the next
/// append rebuilds or drops them); a wrong record within the stream is.
pub(crate) fn index_agrees(path: &Path, expected: &[(u64, u64)]) -> bool {
    let Ok(mut file) = File::open(index_path(path)) else {
        return true;
    };
    let mut found = [0u8; 16];
    if file.read_exact(&mut found).is_err() || found != header() {
        return true;
    }
    for (&(seq, offset), number) in expected.iter().zip(1u64..) {
        let mut bytes = [0u8; 16];
        if file.read_exact(&mut bytes).is_err() {
            return true;
        }
        if bytes != record_bytes(seq, offset) || seq != number * STRIDE {
            return false;
        }
    }
    true
}
