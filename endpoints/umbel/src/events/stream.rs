//! One space's event stream, `state/spaces/<space>/events.jsonl`: JSON Lines, appended under the
//! workspace lock, read without it.
//!
//! A line counts only when its newline is there. A reader skips a last line without one (an
//! append in flight, or a crash mid-append); the next locked append cuts it off.

use super::error::EventsError;
use super::event::Event;
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

/// An open stream, ready to append: its torn tail cut off, its last event read. Take the
/// workspace lock first.
pub(crate) struct StreamWriter {
    path: PathBuf,
    file: File,
    tail: Tail,
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
        file.seek(SeekFrom::End(0)).map_err(io)?;
        Ok(Self {
            path: path.to_path_buf(),
            file,
            tail,
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
        self.tail = Tail {
            seq: event.seq,
            journal_seq: event.journal_seq,
        };
        Ok(())
    }
}

/// Up to `limit` events after event `after`, none past `head`, in order. Complete lines only.
pub(crate) fn read_after(
    path: &Path,
    after: u64,
    limit: usize,
    head: u64,
) -> Result<Vec<Event>, EventsError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(EventsError::io(path, error)),
    };
    let mut reader = BufReader::new(file);
    let mut events = Vec::new();
    let mut line = Vec::new();
    let mut index = 0u64;
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|error| EventsError::io(path, error))?;
        if read == 0 || line.last() != Some(&b'\n') {
            break;
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        index += 1;
        if index <= after {
            continue;
        }
        let event = parse_line(path, index, &line)?;
        if event.seq > head || events.len() >= limit {
            break;
        }
        events.push(event);
    }
    Ok(events)
}

fn parse_line(path: &Path, line_number: u64, line: &[u8]) -> Result<Event, EventsError> {
    let value: Value = serde_json::from_slice(line).map_err(|error| {
        EventsError::damaged(path, format!("line {line_number} is not JSON: {error}"))
    })?;
    match value.get("version").and_then(Value::as_u64) {
        Some(0 | 1) => {}
        other => {
            return Err(EventsError::Damaged(format!(
                "{} line {line_number} is event version {}; this umbel reads event versions 0 and {EVENT_VERSION}. Upgrade umbel to read it.",
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
}
