//! One space's event stream, `state/spaces/<space>/events.jsonl`: JSON Lines, appended under the
//! workspace lock, read without it.
//!
//! A line counts only when its newline is there. A reader skips a last line without one (an
//! append in flight, or a crash mid-append); the next locked append cuts it off.
//!
//! Beside it, `events.idx` is a sparse index of the stream (D209, the `index` module): a record
//! for every `STRIDE`th event, naming the byte offset of its line. Writers keep it under the
//! lock: opening for append checks its last record against the stream, cuts a torn record, drops
//! records past the stream and fills a gap by reading forward from the last good record (a
//! missing index is built there, once); an append writes a record after its event's line, so no
//! record points at a line that is not there yet; and a failed index write never fails the
//! append. Readers never write it: each record they use is checked against the stream they opened
//! (the line at that offset is that event), and a missing, short or disagreeing index means the
//! linear scan.

use super::error::EventsError;
use super::event::Event;
use super::index::{
    HEADER_LEN, IndexWriter, RECORD_LEN, STRIDE, header, index_path, line_is, read_record,
    record_bytes,
};
use crate::versions::EVENT_VERSION;
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// How many bytes each step of the backward scan reads.
const CHUNK: u64 = 8192;

/// The last complete event of a stream: its `seq` and its `journalSeq`. Both 0 for an empty one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Tail {
    pub seq: u64,
    pub journal_seq: u64,
}

struct Scan {
    /// The length of the file up to and including its last newline.
    complete_len: u64,
    /// The last non-blank complete line.
    last_line: Option<Vec<u8>>,
}

fn rfind_newline(file: &mut File, before: u64) -> std::io::Result<Option<u64>> {
    let mut position = before;
    while position > 0 {
        let from = position.saturating_sub(CHUNK);
        let mut chunk = vec![0u8; usize::try_from(position - from).unwrap_or(CHUNK as usize)];
        file.seek(SeekFrom::Start(from))?;
        file.read_exact(&mut chunk)?;
        if let Some(index) = chunk.iter().rposition(|byte| *byte == b'\n') {
            return Ok(Some(from + index as u64));
        }
        position = from;
    }
    Ok(None)
}

fn scan(file: &mut File) -> std::io::Result<Scan> {
    let length = file.metadata()?.len();
    let Some(last_newline) = rfind_newline(file, length)? else {
        return Ok(Scan {
            complete_len: 0,
            last_line: None,
        });
    };
    let complete_len = last_newline + 1;
    let mut end = last_newline;
    loop {
        let start = rfind_newline(file, end)?.map_or(0, |newline| newline + 1);
        let mut line = vec![0u8; usize::try_from(end - start).unwrap_or(0)];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut line)?;
        if !line.iter().all(u8::is_ascii_whitespace) {
            return Ok(Scan {
                complete_len,
                last_line: Some(line),
            });
        }
        if start == 0 {
            return Ok(Scan {
                complete_len,
                last_line: None,
            });
        }
        end = start - 1;
    }
}

fn tail_of(path: &Path, scan: &Scan) -> Result<Tail, EventsError> {
    let Some(line) = &scan.last_line else {
        return Ok(Tail::default());
    };
    let value: Value = serde_json::from_slice(line).map_err(|error| {
        EventsError::damaged(path, format!("its last line is not JSON: {error}"))
    })?;
    let number = |name: &str| value.get(name).and_then(Value::as_u64);
    match (number("seq"), number("journalSeq")) {
        (Some(seq), Some(journal_seq)) => Ok(Tail { seq, journal_seq }),
        _ => Err(EventsError::damaged(
            path,
            "its last line is not an event (no seq and journalSeq)",
        )),
    }
}

/// The last complete event of the stream at `path`, without changing the file. A missing stream
/// is empty.
pub(crate) fn tail(path: &Path) -> Result<Tail, EventsError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Tail::default()),
        Err(error) => return Err(EventsError::io(path, error)),
    };
    let scan = scan(&mut file).map_err(|error| EventsError::io(path, error))?;
    tail_of(path, &scan)
}

// ── Appending ───────────────────────────────────────────────────────────────────────────────────

/// An open stream, ready to append: its torn tail cut off, its last event read, its index brought
/// up to date. Take the workspace lock first.
pub(crate) struct StreamWriter {
    path: PathBuf,
    file: File,
    tail: Tail,
    /// The file's length: where the next line starts.
    len: u64,
    /// `None` when the index could not be opened or written; the next open repairs it.
    index: Option<IndexWriter>,
}

impl StreamWriter {
    /// Open (creating when missing) the stream at `path`, cutting off a torn last line.
    pub(crate) fn open(path: &Path) -> Result<Self, EventsError> {
        let io = |error: std::io::Error| EventsError::io(path, error);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(io)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(io)?;
        let scan = scan(&mut file).map_err(io)?;
        let tail = tail_of(path, &scan)?;
        if file.metadata().map_err(io)?.len() > scan.complete_len {
            file.set_len(scan.complete_len).map_err(io)?;
        }
        let index = IndexWriter::open(path, &mut file, scan.complete_len, tail.seq)
            .inspect_err(|error| {
                tracing::warn!(
                    "{}: the event index cannot be kept ({error}); reads scan the stream until the next append repairs it",
                    index_path(path).display()
                );
            })
            .ok();
        file.seek(SeekFrom::End(0)).map_err(io)?;
        Ok(Self {
            path: path.to_path_buf(),
            file,
            tail,
            len: scan.complete_len,
            index,
        })
    }

    /// The last event in the stream.
    pub(crate) fn tail(&self) -> Tail {
        self.tail
    }

    /// Append `event`, which must be `tail().seq + 1`.
    pub(crate) fn append(&mut self, event: &Event) -> Result<(), EventsError> {
        let mut line = event.to_line();
        line.push('\n');
        self.file
            .write_all(line.as_bytes())
            .map_err(|error| EventsError::io(&self.path, error))?;
        let offset = self.len;
        self.len += line.len() as u64;
        self.tail = Tail {
            seq: event.seq,
            journal_seq: event.journal_seq,
        };
        if event.seq.is_multiple_of(STRIDE)
            && let Some(index) = &mut self.index
            && index.records + 1 == event.seq / STRIDE
        {
            match index.file.write_all(&record_bytes(event.seq, offset)) {
                Ok(()) => index.records += 1,
                Err(error) => {
                    tracing::warn!(
                        "{}: the event index cannot be kept ({error}); reads scan the stream until the next append repairs it",
                        index_path(&self.path).display()
                    );
                    self.index = None;
                }
            }
        }
        Ok(())
    }
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

/// A stream open for reading, with its index when it has a usable one.
struct Stream<'a> {
    path: &'a Path,
    reader: BufReader<File>,
    index: Option<(File, u64)>,
    /// The number of the last line read: its event's `seq` in a well-formed stream.
    number: u64,
    line: Vec<u8>,
}

/// Why an indexed read stopped: an index record it relied on did not name its line (read the
/// stream from the start instead), or the stream itself failed.
enum Miss {
    Index,
    Events(EventsError),
}

impl From<EventsError> for Miss {
    fn from(error: EventsError) -> Self {
        Self::Events(error)
    }
}

impl<'a> Stream<'a> {
    /// The stream at `path`, or `None` when it does not exist. The index is opened after it, so
    /// each record is checked against this file.
    fn open(path: &'a Path) -> Result<Option<Self>, EventsError> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(EventsError::io(path, error)),
        };
        let index = File::open(index_path(path)).ok().and_then(|mut index| {
            let length = index.metadata().ok()?.len();
            let mut found = [0u8; 16];
            index.read_exact(&mut found).ok()?;
            (found == header()).then(|| (index, length.saturating_sub(HEADER_LEN) / RECORD_LEN))
        });
        Ok(Some(Self {
            path,
            reader: BufReader::new(file),
            index,
            number: 0,
            line: Vec::new(),
        }))
    }

    fn io(&self, error: std::io::Error) -> EventsError {
        EventsError::io(self.path, error)
    }

    /// Whether reading back from event `upto` should use the index: it has one, `upto` is past the
    /// first block, and its records reach the block before `upto`'s. An index that stops well short
    /// (a stream not well formed near the start, or index writes that keep failing) would make each
    /// backward search a pass of its own, so the linear scan, one pass, is used instead.
    fn covers(&self, upto: u64) -> bool {
        upto >= STRIDE
            && self
                .index
                .as_ref()
                .is_some_and(|(_, records)| (records + 1) * STRIDE > upto)
    }

    /// Read from the start.
    fn rewind(&mut self) -> Result<(), EventsError> {
        self.reader
            .seek(SeekFrom::Start(0))
            .map_err(|error| self.io(error))?;
        self.number = 0;
        Ok(())
    }

    /// Read from the start of the index block that holds event `seq` (the last record at or
    /// before it, or the start), returning how many events come before that point.
    fn seek_block(&mut self, seq: u64) -> Result<u64, Miss> {
        let records = self.index.as_ref().map_or(0, |(_, records)| *records);
        let number = (seq / STRIDE).min(records);
        if number == 0 {
            self.rewind()?;
            return Ok(0);
        }
        let first = number * STRIDE;
        let offset = self
            .index
            .as_mut()
            .and_then(|(index, _)| read_record(index, number - 1).ok().flatten())
            .ok_or(Miss::Index)?;
        if !line_is(self.reader.get_mut(), offset, first).unwrap_or(false) {
            tracing::debug!(
                "{}: record {number} does not name its line; reading the stream from the start",
                index_path(self.path).display()
            );
            return Err(Miss::Index);
        }
        self.reader
            .seek(SeekFrom::Start(offset))
            .map_err(|error| self.io(error))?;
        self.number = first - 1;
        Ok(self.number)
    }

    /// The next complete, non-blank line and its number, or `None` at the end or a torn last
    /// line.
    fn next_line(&mut self) -> Result<Option<(u64, &[u8])>, EventsError> {
        loop {
            self.line.clear();
            let read = self
                .reader
                .read_until(b'\n', &mut self.line)
                .map_err(|error| EventsError::io(self.path, error))?;
            if read == 0 || self.line.last() != Some(&b'\n') {
                return Ok(None);
            }
            if self.line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            self.number += 1;
            return Ok(Some((self.number, &self.line)));
        }
    }
}

/// Up to `limit` events after event `after`, none past `head`, in order. Complete lines only.
/// Starts at the index record at or before event `after + 1`, so a read near the end costs at
/// most `STRIDE` skipped lines and the events it returns.
pub(crate) fn read_after(
    path: &Path,
    after: u64,
    limit: usize,
    head: u64,
) -> Result<Vec<Event>, EventsError> {
    let Some(mut stream) = Stream::open(path)? else {
        return Ok(Vec::new());
    };
    match stream.seek_block(after.saturating_add(1)) {
        Ok(_) => {}
        Err(Miss::Index) => stream.rewind()?,
        Err(Miss::Events(error)) => return Err(error),
    }
    let mut events = Vec::new();
    while let Some((number, line)) = stream.next_line()? {
        if number <= after {
            continue;
        }
        let event = parse_line(path, number, line)?;
        if event.seq > head || events.len() >= limit {
            break;
        }
        events.push(event);
    }
    Ok(events)
}

/// What one reader can see of a stream (phase 5 section 9.3): positions are those of events it
/// can read, so none moves with an event it cannot.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct ReadableScan {
    /// Up to `limit` events it can read after `start`, in order.
    pub(crate) events: Vec<Event>,
    /// The `seq` of the last of them, or, when there are none, of the last event it can read at
    /// or before `start` (0 when there is none).
    pub(crate) cursor: u64,
    /// The `seq` of the last event it can read at or before `head` (0 when there is none).
    pub(crate) head: u64,
    /// The `seq` of the last event it can read at or before `mark` (0 when there is none).
    pub(crate) marked: u64,
}

impl ReadableScan {
    /// Whether it can read an event after the cursor.
    pub(crate) fn more(&self) -> bool {
        self.head > self.cursor
    }
}

/// How much of a stream one reader can read, up to an event.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ReadableCount {
    /// How many events it can read at or before `head`.
    pub(crate) count: u64,
    /// The `seq` of the last of them (0 when there is none).
    pub(crate) head: u64,
}

/// Read the stream at `path` up to event `head` as one reader, whom `admits` names, after
/// `start`, also finding its last event at or before `mark`. The answer depends only on the events
/// it admits. With the index, the events after `start` are read forward from the record before
/// them, and each "last readable event at or before" is found by reading back one index block at a
/// time until one it admits: the cost is the events read and the distance back to the reader's
/// nearest readable event, not the stream's length. Without a usable index, every event up to
/// `head` is read.
pub(crate) fn scan_readable(
    path: &Path,
    start: u64,
    mark: u64,
    limit: usize,
    head: u64,
    admits: impl Fn(&Event) -> bool,
) -> Result<ReadableScan, EventsError> {
    let Some(mut stream) = Stream::open(path)? else {
        return Ok(ReadableScan::default());
    };
    if stream.covers(head) {
        match scan_indexed(&mut stream, start, mark, limit, head, &admits) {
            Ok(scan) => return Ok(scan),
            Err(Miss::Events(error)) => return Err(error),
            Err(Miss::Index) => stream.rewind()?,
        }
    }
    Ok(scan_linear(&mut stream, start, mark, limit, head, &admits)?.0)
}

/// The `seq` of the last event of the stream at `path` at or before `upto` that the reader `admits`
/// names can read (0 when there is none): `event-ack`'s previous position. With the index it is
/// read back one block at a time from `upto`; without a usable one, every event up to `upto`.
pub(crate) fn last_readable_at(
    path: &Path,
    upto: u64,
    admits: impl Fn(&Event) -> bool,
) -> Result<u64, EventsError> {
    let Some(mut stream) = Stream::open(path)? else {
        return Ok(0);
    };
    if stream.covers(upto) {
        match last_readable(&mut stream, upto, 0, &admits) {
            Ok(found) => return Ok(found.unwrap_or(0)),
            Err(Miss::Events(error)) => return Err(error),
            Err(Miss::Index) => stream.rewind()?,
        }
    }
    Ok(scan_linear(&mut stream, 0, upto, 0, upto, &admits)?
        .0
        .marked)
}

/// How many events of the stream at `path` the reader `admits` names can read, up to event
/// `head`, and the last of them. Every event up to `head` is read: a count for each reader needs a
/// cache for each reader, which D209 leaves out.
pub(crate) fn count_readable(
    path: &Path,
    head: u64,
    admits: impl Fn(&Event) -> bool,
) -> Result<ReadableCount, EventsError> {
    let Some(mut stream) = Stream::open(path)? else {
        return Ok(ReadableCount::default());
    };
    let (scan, count) = scan_linear(&mut stream, 0, 0, 0, head, &admits)?;
    Ok(ReadableCount {
        count,
        head: scan.head,
    })
}

/// Every event up to `head`, from the start: the scan and the count of events read.
fn scan_linear(
    stream: &mut Stream<'_>,
    start: u64,
    mark: u64,
    limit: usize,
    head: u64,
    admits: &impl Fn(&Event) -> bool,
) -> Result<(ReadableScan, u64), EventsError> {
    let path = stream.path;
    let mut scan = ReadableScan::default();
    let mut count = 0u64;
    let mut base = 0u64;
    while let Some((number, line)) = stream.next_line()? {
        let event = parse_line(path, number, line)?;
        if event.seq > head {
            break;
        }
        if !admits(&event) {
            continue;
        }
        count += 1;
        scan.head = event.seq;
        if event.seq <= mark {
            scan.marked = event.seq;
        }
        if event.seq <= start {
            base = event.seq;
        } else if scan.events.len() < limit {
            scan.events.push(event);
        }
    }
    scan.cursor = scan.events.last().map_or(base, |event| event.seq);
    Ok((scan, count))
}

/// The `seq` of the last event in `(floor, upto]` that `admits` names, read back one index block
/// at a time.
fn last_readable(
    stream: &mut Stream<'_>,
    upto: u64,
    floor: u64,
    admits: &impl Fn(&Event) -> bool,
) -> Result<Option<u64>, Miss> {
    let path = stream.path;
    let mut upto = upto;
    while upto > floor {
        let before = stream.seek_block(upto)?;
        let mut found = None;
        while let Some((number, line)) = stream.next_line()? {
            if number > upto {
                break;
            }
            if number <= floor {
                continue;
            }
            let event = parse_line(path, number, line)?;
            if admits(&event) {
                found = Some(event.seq);
            }
        }
        if found.is_some() {
            return Ok(found);
        }
        upto = before;
    }
    Ok(None)
}

/// [`scan_readable`] with the index: the same answer as [`scan_linear`] in a well-formed stream.
fn scan_indexed(
    stream: &mut Stream<'_>,
    start: u64,
    mark: u64,
    limit: usize,
    head: u64,
    admits: &impl Fn(&Event) -> bool,
) -> Result<ReadableScan, Miss> {
    let path = stream.path;
    let mut scan = ReadableScan::default();
    // Forward from the block before `start + 1`: every event in `(start, end]` is read; `full`
    // when the page filled before `head`, so readable events may follow `end`. A page of 0
    // (nothing to return) reads nothing forward.
    let (mut end, mut full) = (start, limit == 0);
    if limit > 0 {
        stream.seek_block(start.saturating_add(1))?;
        while let Some((number, line)) = stream.next_line()? {
            if number <= start {
                continue;
            }
            let event = parse_line(path, number, line)?;
            let seq = event.seq;
            if seq > head {
                break;
            }
            if admits(&event) {
                if scan.events.len() >= limit {
                    full = true;
                    break;
                }
                scan.events.push(event);
            }
            end = seq;
        }
    }
    let last_read = scan.events.last().map(|event| event.seq);
    // The last readable event at or before `start`, read back only when it is needed.
    let floor = start.min(head);
    let mut base: Option<Option<u64>> = None;
    let base_of = |stream: &mut Stream<'_>, base: &mut Option<Option<u64>>| {
        if let Some(found) = *base {
            return Ok::<_, Miss>(found);
        }
        let found = last_readable(stream, floor, 0, admits)?;
        *base = Some(found);
        Ok(found)
    };
    let after_end = |stream: &mut Stream<'_>, upto: u64| -> Result<Option<u64>, Miss> {
        if full && upto > end {
            last_readable(stream, upto, end, admits)
        } else {
            Ok(None)
        }
    };
    scan.head = match after_end(stream, head)?.or(last_read) {
        Some(seq) => seq,
        None => base_of(stream, &mut base)?.unwrap_or(0),
    };
    scan.cursor = match last_read {
        Some(seq) => seq,
        None => base_of(stream, &mut base)?.unwrap_or(0),
    };
    let m = mark.min(head);
    scan.marked = if m == 0 {
        0
    } else if m > start {
        let found = match after_end(stream, m)? {
            Some(seq) => Some(seq),
            None => scan
                .events
                .iter()
                .rev()
                .map(|event| event.seq)
                .find(|seq| *seq <= m),
        };
        match found {
            Some(seq) => seq,
            None => base_of(stream, &mut base)?.unwrap_or(0),
        }
    } else if m == floor {
        base_of(stream, &mut base)?.unwrap_or(0)
    } else {
        // Below `start`: what is known of the base settles it, else read back from `m`.
        match base {
            Some(Some(seq)) if seq <= m => seq,
            Some(None) => 0,
            _ => last_readable(stream, m, 0, admits)?.unwrap_or(0),
        }
    };
    Ok(scan)
}

fn parse_line(path: &Path, line_number: u64, line: &[u8]) -> Result<Event, EventsError> {
    let value: Value = serde_json::from_slice(line).map_err(|error| {
        EventsError::damaged(path, format!("line {line_number} is not JSON: {error}"))
    })?;
    match value.get("version").and_then(Value::as_u64) {
        Some(version) if version <= u64::from(EVENT_VERSION) => {}
        other => {
            return Err(EventsError::Damaged(format!(
                "{} line {line_number} is event version {}; this umbel reads event versions 0 to {EVENT_VERSION}. Upgrade umbel to read it.",
                path.display(),
                other.map_or_else(|| "unknown".to_owned(), |version| version.to_string())
            )));
        }
    }
    serde_json::from_value(value).map_err(|error| {
        EventsError::damaged(path, format!("line {line_number} is not an event: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::super::index::{IndexBuilder, index_agrees, remove_index};
    use super::*;
    use crate::provenance::{Envelope, Origin};

    fn event(seq: u64, journal_seq: u64) -> Event {
        Event {
            version: 0,
            id: format!("main:{seq}"),
            space: "main".into(),
            seq,
            cursor: format!("v0:main:{seq}"),
            journal_seq,
            command: "x-y".into(),
            timestamp: "2026-11-02T10:15:00.000Z".into(),
            trace_id: None,
            actor: None,
            record: None,
            changes: None,
            provenance: Envelope {
                version: 0,
                origin: Origin::Unspecified,
                space: "main".into(),
                plugin: None,
                agent: None,
                principal: None,
                session: None,
                trace_id: None,
                observed_at: "2026-11-02T10:15:00.000Z".into(),
                valid_from: None,
                valid_until: None,
                confidence: None,
                authority: None,
                sources: None,
                generated: None,
                content_hash: None,
                derived_from: None,
                access: Vec::new(),
                sensitivity: None,
                redactions: None,
                constraints: None,
                confirmation: None,
                delegation_chain: None,
                erasure: None,
            },
        }
    }

    #[test]
    fn a_missing_or_empty_stream_has_no_tail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        assert_eq!(tail(&path).unwrap(), Tail::default());
        std::fs::write(&path, "").unwrap();
        assert_eq!(tail(&path).unwrap(), Tail::default());
        std::fs::write(&path, "\n\n").unwrap();
        assert_eq!(tail(&path).unwrap(), Tail::default());
    }

    #[test]
    fn the_tail_is_read_from_the_end_and_a_torn_line_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let mut writer = StreamWriter::open(&path).unwrap();
        writer.append(&event(1, 4)).unwrap();
        writer.append(&event(2, 9)).unwrap();
        assert_eq!(
            writer.tail(),
            Tail {
                seq: 2,
                journal_seq: 9
            }
        );
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"version\":0,\"id\":\"main:3\",\"se");
        std::fs::write(&path, &text).unwrap();
        assert_eq!(
            tail(&path).unwrap(),
            Tail {
                seq: 2,
                journal_seq: 9
            }
        );
        assert_eq!(read_after(&path, 0, 10, 10).unwrap().len(), 2);
    }

    #[test]
    fn opening_for_append_cuts_a_torn_line_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let mut writer = StreamWriter::open(&path).unwrap();
        writer.append(&event(1, 1)).unwrap();
        drop(writer);
        let mut text = std::fs::read_to_string(&path).unwrap();
        let good = text.clone();
        text.push_str("{\"torn\"");
        std::fs::write(&path, &text).unwrap();
        let mut writer = StreamWriter::open(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), good);
        writer.append(&event(2, 2)).unwrap();
        assert_eq!(tail(&path).unwrap().seq, 2);
    }

    #[test]
    fn a_long_last_line_is_found_across_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let mut writer = StreamWriter::open(&path).unwrap();
        let mut big = event(1, 1);
        big.command = "x".repeat(3 * CHUNK as usize);
        writer.append(&big).unwrap();
        assert_eq!(
            tail(&path).unwrap(),
            Tail {
                seq: 1,
                journal_seq: 1
            }
        );
    }

    #[test]
    fn reading_pages_and_stops_at_the_head() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let mut writer = StreamWriter::open(&path).unwrap();
        for seq in 1..=5 {
            writer.append(&event(seq, seq * 2)).unwrap();
        }
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 0, 2, 5).unwrap()), [1, 2]);
        assert_eq!(seqs(read_after(&path, 2, 10, 5).unwrap()), [3, 4, 5]);
        assert_eq!(seqs(read_after(&path, 2, 10, 4).unwrap()), [3, 4]);
        assert!(read_after(&path, 5, 10, 5).unwrap().is_empty());
    }

    #[test]
    fn an_event_of_another_version_is_refused_naming_the_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, "{\"version\":7,\"seq\":1,\"journalSeq\":1}\n").unwrap();
        let error = read_after(&path, 0, 10, 1).unwrap_err();
        assert!(error.to_string().contains("event version 7"), "{error}");
        assert!(error.to_string().contains("Upgrade umbel"), "{error}");
    }

    fn index_records(path: &Path) -> Vec<(u64, u64)> {
        let bytes = std::fs::read(index_path(path)).unwrap();
        assert_eq!(bytes[..16], header());
        bytes[16..]
            .as_chunks::<16>()
            .0
            .iter()
            .map(|record| {
                (
                    u64::from_le_bytes(record[..8].try_into().unwrap()),
                    u64::from_le_bytes(record[8..].try_into().unwrap()),
                )
            })
            .collect()
    }

    /// Every `STRIDE`th event of the stream at `path` and the offset of its line.
    fn expected_records(path: &Path) -> Vec<(u64, u64)> {
        let bytes = std::fs::read(path).unwrap();
        let (mut offset, mut number, mut records) = (0u64, 0u64, Vec::new());
        for line in bytes.split_inclusive(|byte| *byte == b'\n') {
            if line.last() == Some(&b'\n') && !line.iter().all(u8::is_ascii_whitespace) {
                number += 1;
                if number.is_multiple_of(STRIDE) {
                    records.push((number, offset));
                }
            }
            offset += line.len() as u64;
        }
        records
    }

    fn stream_of(path: &Path, count: u64) {
        let mut writer = StreamWriter::open(path).unwrap();
        for seq in writer.tail().seq + 1..=count {
            writer.append(&event(seq, seq * 2)).unwrap();
        }
    }

    fn linear(
        path: &Path,
        start: u64,
        mark: u64,
        limit: usize,
        head: u64,
        admits: impl Fn(&Event) -> bool,
    ) -> ReadableScan {
        let mut stream = Stream::open(path).unwrap().unwrap();
        stream.index = None;
        scan_linear(&mut stream, start, mark, limit, head, &admits)
            .unwrap()
            .0
    }

    fn overwrite_record(path: &Path, number: u64, seq: u64, offset: u64) {
        let index = index_path(path);
        let mut bytes = std::fs::read(&index).unwrap();
        let at = usize::try_from(HEADER_LEN + number * RECORD_LEN).unwrap();
        bytes[at..at + 16].copy_from_slice(&record_bytes(seq, offset));
        std::fs::write(&index, bytes).unwrap();
    }

    #[test]
    fn an_append_writes_a_record_every_stride_and_a_reopen_continues() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 10);
        assert_eq!(index_records(&path).len(), 2);
        assert_eq!(index_records(&path), expected_records(&path));
        stream_of(&path, 13);
        assert_eq!(index_records(&path).len(), 3);
        assert_eq!(index_records(&path), expected_records(&path));
    }

    #[test]
    fn a_missing_index_is_read_around_then_built_by_the_next_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 13);
        std::fs::remove_file(index_path(&path)).unwrap();
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 9, 2, 13).unwrap()), [10, 11]);
        assert_eq!(
            scan_readable(&path, 9, 9, 2, 13, |_| true).unwrap(),
            linear(&path, 9, 9, 2, 13, |_| true)
        );
        drop(StreamWriter::open(&path).unwrap());
        assert_eq!(index_records(&path), expected_records(&path));
    }

    #[test]
    fn a_torn_record_is_cut_off_and_the_gap_filled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 13);
        let index = index_path(&path);
        let file = OpenOptions::new().write(true).open(&index).unwrap();
        file.set_len(HEADER_LEN + RECORD_LEN + 7).unwrap();
        drop(file);
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 11, 10, 13).unwrap()), [12, 13]);
        drop(StreamWriter::open(&path).unwrap());
        assert_eq!(index_records(&path), expected_records(&path));
        assert_eq!(index_records(&path).len(), 3);
    }

    #[test]
    fn a_wrong_record_is_read_around_and_a_wrong_last_one_rebuilds_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 13);
        let good = index_records(&path);
        overwrite_record(&path, 1, 8, good[1].1 + 1);
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 8, 2, 13).unwrap()), [9, 10]);
        assert_eq!(
            scan_readable(&path, 8, 3, 2, 13, |e| e.seq.is_multiple_of(3)).unwrap(),
            linear(&path, 8, 3, 2, 13, |e| e.seq.is_multiple_of(3))
        );
        assert!(!index_agrees(&path, &expected_records(&path)));
        // A wrong middle record survives an open (only the last is checked); a wrong last one
        // does not.
        overwrite_record(&path, 2, 12, good[0].1);
        drop(StreamWriter::open(&path).unwrap());
        assert_eq!(index_records(&path), good);
        assert!(index_agrees(&path, &expected_records(&path)));
    }

    #[test]
    fn records_past_a_cut_stream_are_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 13);
        let text = std::fs::read_to_string(&path).unwrap();
        let kept: String = text.split_inclusive('\n').take(6).collect();
        std::fs::write(&path, kept).unwrap();
        assert!(read_after(&path, 9, 10, 13).unwrap().is_empty());
        let mut writer = StreamWriter::open(&path).unwrap();
        assert_eq!(writer.tail().seq, 6);
        assert_eq!(index_records(&path), expected_records(&path));
        assert_eq!(index_records(&path).len(), 1);
        writer.append(&event(7, 14)).unwrap();
        writer.append(&event(8, 16)).unwrap();
        assert_eq!(index_records(&path), expected_records(&path));
    }

    #[test]
    fn blank_lines_and_a_torn_tail_are_indexed_around() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let mut text = String::from("\n");
        for seq in 1..=9 {
            text.push_str(&event(seq, seq).to_line());
            text.push('\n');
            if seq.is_multiple_of(3) {
                text.push_str("  \n");
            }
        }
        text.push_str("{\"version\":0,\"seq\":10,");
        std::fs::write(&path, &text).unwrap();
        // A reader with no index, then the index a writer builds over the blank lines.
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 7, 10, 9).unwrap()), [8, 9]);
        let writer = StreamWriter::open(&path).unwrap();
        assert_eq!(writer.tail().seq, 9);
        assert_eq!(index_records(&path), expected_records(&path));
        assert_eq!(index_records(&path).len(), 2);
        drop(writer);
        let mut torn = std::fs::read_to_string(&path).unwrap();
        torn.push_str("{\"version\":0,");
        std::fs::write(&path, torn).unwrap();
        assert_eq!(seqs(read_after(&path, 7, 10, 9).unwrap()), [8, 9]);
        assert_eq!(seqs(read_after(&path, 3, 2, 9).unwrap()), [4, 5]);
        assert_eq!(
            scan_readable(&path, 5, 9, 1, 9, |e| e.seq != 9).unwrap(),
            linear(&path, 5, 9, 1, 9, |e| e.seq != 9)
        );
    }

    #[test]
    fn indexed_reads_agree_with_the_linear_scan() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let tail = 41;
        stream_of(&path, tail);
        assert_eq!(index_records(&path).len(), 10);
        type Reader = (&'static str, fn(&Event) -> bool);
        let readers: [Reader; 5] = [
            ("all", |_| true),
            ("none", |_| false),
            ("every seventh", |e| e.seq.is_multiple_of(7)),
            ("the last few", |e| e.seq > 37),
            ("the first few", |e| e.seq < 4),
        ];
        let seqs = |events: &[Event]| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        for (name, admits) in readers {
            for head in [tail, 38, 9, 4] {
                for start in (0..=head).step_by(3).chain([head, head + 2]) {
                    for mark in [0, start, start + 2, head, 7] {
                        for limit in [0, 1, 3, 100] {
                            let mut stream = Stream::open(&path).unwrap().unwrap();
                            assert!(stream.covers(head) || head < STRIDE);
                            let Ok(indexed) =
                                scan_indexed(&mut stream, start, mark, limit, head, &admits)
                            else {
                                panic!("{name}: the index was not used");
                            };
                            let expected = linear(&path, start, mark, limit, head, admits);
                            assert_eq!(
                                scan_readable(&path, start, mark, limit, head, admits).unwrap(),
                                expected
                            );
                            assert_eq!(
                                indexed, expected,
                                "{name}: start {start}, mark {mark}, limit {limit}, head {head}"
                            );
                        }
                    }
                    for upto in [start, start.min(head)] {
                        assert_eq!(
                            last_readable_at(&path, upto, admits).unwrap(),
                            linear(&path, 0, upto, 0, upto, admits).marked,
                            "{name}: upto {upto}"
                        );
                    }
                    let plain: Vec<u64> = (start + 1..=head).take(3).collect();
                    assert_eq!(seqs(&read_after(&path, start, 3, head).unwrap()), plain);
                }
            }
            let count = count_readable(&path, tail, admits).unwrap();
            let expected = (1..=tail).filter(|seq| admits(&event(*seq, 0))).count() as u64;
            assert_eq!(count.count, expected, "{name}");
        }
    }

    #[test]
    fn an_index_written_whole_equals_the_one_appends_keep() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 13);
        let mut builder = IndexBuilder::new();
        let mut offset = 0u64;
        for seq in 1..=13 {
            builder.line(seq, offset);
            offset += event(seq, seq * 2).to_line().len() as u64 + 1;
        }
        let copy = dir.path().join("copy").join("events.jsonl");
        std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
        builder.write(&copy).unwrap();
        assert_eq!(
            std::fs::read(index_path(&copy)).unwrap(),
            std::fs::read(index_path(&path)).unwrap()
        );
        let leftovers = std::fs::read_dir(copy.parent().unwrap()).unwrap().count();
        assert_eq!(leftovers, 1, "no temporary file stays behind");
        remove_index(&copy).unwrap();
        remove_index(&copy).unwrap();
        assert!(!index_path(&copy).exists());
    }

    #[test]
    fn an_index_of_another_format_is_replaced_and_not_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 9);
        std::fs::write(index_path(&path), b"UMBELIDX\x07\x00\x00\x00junk junk junk").unwrap();
        assert!(index_agrees(&path, &expected_records(&path)));
        let seqs = |events: Vec<Event>| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        assert_eq!(seqs(read_after(&path, 8, 10, 9).unwrap()), [9]);
        drop(StreamWriter::open(&path).unwrap());
        assert_eq!(index_records(&path), expected_records(&path));
    }

    #[test]
    fn an_indexed_read_reads_nothing_before_its_block() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 21);
        // Line 2 is no longer an event, its length unchanged, so every record still names its
        // line: a read that reached it would fail.
        let text = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
        lines[1] = "x".repeat(lines[1].len());
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        let seqs = |events: &[Event]| events.iter().map(|e| e.seq).collect::<Vec<_>>();
        let scan = scan_readable(&path, 17, 17, 2, 21, |e| e.seq.is_multiple_of(2)).unwrap();
        assert_eq!(seqs(&scan.events), [18, 20]);
        assert_eq!((scan.cursor, scan.head, scan.marked), (20, 20, 16));
        assert_eq!(seqs(&read_after(&path, 19, 10, 21).unwrap()), [20, 21]);
        // A page of 0 from the start (what `event-ack` once asked) reads back, not forward.
        let scan = scan_readable(&path, 0, 19, 0, 21, |e| e.seq.is_multiple_of(2)).unwrap();
        assert_eq!((scan.cursor, scan.head, scan.marked), (0, 20, 18));
        assert_eq!(
            last_readable_at(&path, 19, |e| e.seq.is_multiple_of(2)).unwrap(),
            18
        );
        // Without the index the whole stream is read, and the damage is found.
        remove_index(&path).unwrap();
        let error = scan_readable(&path, 17, 17, 2, 21, |e| e.seq.is_multiple_of(2)).unwrap_err();
        assert!(error.to_string().contains("line 2"), "{error}");
    }

    #[test]
    fn an_index_far_behind_its_stream_is_not_used_and_reads_agree() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        stream_of(&path, 41);
        // Two records left of ten: well short of the head.
        let file = OpenOptions::new()
            .write(true)
            .open(index_path(&path))
            .unwrap();
        file.set_len(HEADER_LEN + 2 * RECORD_LEN).unwrap();
        drop(file);
        let stream = Stream::open(&path).unwrap().unwrap();
        assert!(!stream.covers(41));
        assert!(stream.covers(11));
        let admits = |e: &Event| e.seq.is_multiple_of(5);
        for (start, mark, limit) in [(0, 0, 3), (12, 30, 2), (39, 39, 0), (41, 3, 10)] {
            assert_eq!(
                scan_readable(&path, start, mark, limit, 41, admits).unwrap(),
                linear(&path, start, mark, limit, 41, admits)
            );
        }
        assert_eq!(last_readable_at(&path, 33, admits).unwrap(), 30);
        assert_eq!(last_readable_at(&path, 11, admits).unwrap(), 10);
        assert_eq!(last_readable_at(&path, 4, admits).unwrap(), 0);
    }
}
