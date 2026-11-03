//! Windows, parts and calls (section 10.3). A window is 20 consecutive text turns; window `n` is
//! closed once turn `20(n+1)` exists. Its text is split into parts of at most 64 KiB, a pure
//! function of the text, so a closed window's parts never change; one call holds one window's
//! parts, at most 800 KiB of them.

use serde_json::{Value, json};

use crate::transcript::Turn;

/// Text turns per window.
pub(crate) const WINDOW_TURNS: u64 = 20;
/// The most bytes of one part's text: the memory plugin's per-entry cap (section 8.3).
pub(crate) const MAX_PART_BYTES: usize = 64 * 1024;
/// The most bytes of one call's entries, as JSON.
pub(crate) const MAX_CALL_BYTES: usize = 800 * 1024;
/// The most entries of one call (section 8.3).
const MAX_CALL_ENTRIES: usize = 256;

/// One part of a window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Part {
    pub text: String,
    /// The first and last turn it holds text of.
    pub first: u64,
    pub last: u64,
    pub started_at: Option<String>,
}

/// A turn as it appears in a window: its role on its own line, then its text.
fn render(turn: &Turn) -> String {
    let mut text = String::with_capacity(turn.text.len() + 16);
    text.push_str(turn.role.label());
    text.push('\n');
    text.push_str(&turn.text);
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

/// A window's parts: turns kept whole while they fit, split at a turn boundary, and a turn over
/// the limit split at line boundaries.
pub(crate) fn parts(turns: &[Turn]) -> Vec<Part> {
    let mut parts: Vec<Part> = Vec::new();
    let mut current: Option<Part> = None;
    for turn in turns {
        let chunk = render(turn);
        let fits = current
            .as_ref()
            .is_some_and(|part| part.text.len() + chunk.len() <= MAX_PART_BYTES);
        if fits {
            if let Some(part) = current.as_mut() {
                part.text.push_str(&chunk);
                part.last = turn.index;
            }
            continue;
        }
        parts.extend(current.take());
        let mut pieces = split_long(&chunk, MAX_PART_BYTES);
        let last = pieces.pop().unwrap_or_default();
        for piece in pieces {
            parts.push(Part {
                text: piece,
                first: turn.index,
                last: turn.index,
                started_at: turn.timestamp.clone(),
            });
        }
        current = Some(Part {
            text: last,
            first: turn.index,
            last: turn.index,
            started_at: turn.timestamp.clone(),
        });
    }
    parts.extend(current);
    parts
}

fn begins(line: &str) -> bool {
    line.trim_start().starts_with("-----BEGIN")
}

fn ends(line: &str) -> bool {
    line.trim_start().starts_with("-----END")
}

/// Split `text` at line boundaries into pieces of at most `limit` bytes. A split point between a
/// `-----BEGIN` line and its `-----END` line moves to before the `BEGIN` line, unless that block
/// alone is over the limit (the memory plugin's unterminated pattern then masks the rest). A line
/// over the limit is split at character boundaries.
pub(crate) fn split_long(text: &str, limit: usize) -> Vec<String> {
    let mut lines: Vec<&str> = Vec::new();
    for line in text.split_inclusive('\n') {
        let mut rest = line;
        while rest.len() > limit {
            let mut at = limit;
            while !rest.is_char_boundary(at) {
                at -= 1;
            }
            lines.push(&rest[..at]);
            rest = &rest[at..];
        }
        if !rest.is_empty() {
            lines.push(rest);
        }
    }
    let size = |range: &[&str]| range.iter().map(|line| line.len()).sum::<usize>();
    let mut pieces = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let mut stop = start;
        let mut bytes = 0;
        while stop < lines.len() && bytes + lines[stop].len() <= limit {
            bytes += lines[stop].len();
            stop += 1;
        }
        if stop < lines.len() {
            // Inside a BEGIN ... END block? Move the split before its BEGIN line when it fits.
            let begin = (start..stop)
                .rev()
                .find(|&i| begins(lines[i]))
                .filter(|&b| !(b + 1..stop).any(|i| ends(lines[i])));
            if let Some(begin) = begin.filter(|&b| b > start) {
                let end = (stop..lines.len())
                    .find(|&i| ends(lines[i]))
                    .unwrap_or(lines.len() - 1);
                if size(&lines[begin..=end]) <= limit {
                    stop = begin;
                }
            }
        }
        pieces.push(lines[start..stop].concat());
        start = stop;
    }
    if pieces.is_empty() {
        pieces.push(String::new());
    }
    pieces
}

/// What a capture call is about.
pub(crate) struct Call<'a> {
    pub harness: &'a str,
    pub version: Option<&'a str>,
    pub event: &'a str,
    pub session: &'a str,
    pub project: Option<&'a str>,
    pub window: u64,
    /// `Some(t)` for an open tail of `t` turns.
    pub tail: Option<u64>,
}

impl Call<'_> {
    fn subject(&self) -> String {
        match self.tail {
            None => format!("Session {} window {}", self.session, self.window),
            Some(turns) => format!(
                "Session {} window {} (open, {turns} turns)",
                self.session, self.window
            ),
        }
    }

    /// `<harness>:<session>:w<n>`, the prefix a forget of these records erases.
    fn capture_key(&self) -> String {
        format!("{}:{}:w{}", self.harness, self.session, self.window)
    }

    /// `<harness>:<session>:w<n>:p<k>`, or with `:t<t>` before the part for an open tail.
    fn idempotency_key(&self, part: usize) -> String {
        match self.tail {
            None => format!("{}:p{part}", self.capture_key()),
            Some(turns) => format!("{}:t{turns}:p{part}", self.capture_key()),
        }
    }

    /// The capture contract's inputs for these parts, one per call, each keyed by its first part.
    pub(crate) fn inputs(&self, parts: &[Part]) -> Vec<Value> {
        let subject = self.subject();
        let mut calls: Vec<(usize, Vec<Value>, usize)> = Vec::new();
        for (k, part) in parts.iter().enumerate() {
            let mut episode = json!({
                "subject": subject,
                "text": part.text,
                "part": k,
                "turns": [part.first, part.last],
            });
            if let Some(at) = part.started_at.as_deref().filter(|at| rfc3339(at)) {
                episode["startedAt"] = json!(at);
            }
            let bytes = episode.to_string().len();
            match calls.last_mut() {
                Some((_, entries, size))
                    if *size + bytes <= MAX_CALL_BYTES && entries.len() < MAX_CALL_ENTRIES =>
                {
                    entries.push(episode);
                    *size += bytes;
                }
                _ => calls.push((k, vec![episode], bytes)),
            }
        }
        calls
            .into_iter()
            .map(|(first, episodes, _)| {
                let mut harness = json!({ "name": self.harness });
                if let Some(version) = self.version.filter(|v| version_like(v)) {
                    harness["version"] = json!(version);
                }
                json!({
                    "version": 1,
                    "harness": harness,
                    "event": self.event,
                    "session": self.session,
                    "project": self.project,
                    "idempotencyKey": self.idempotency_key(first),
                    "captureKey": self.capture_key(),
                    "window": self.window,
                    "episodes": episodes,
                })
            })
            .collect()
    }
}

/// A harness version the contract takes: 1 to 64 letters, digits, `.`, `-` and `+`.
fn version_like(text: &str) -> bool {
    (1..=64).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
}

/// `YYYY-MM-DDTHH:MM:SS`, optional fraction, then `Z` or `±HH:MM`: the shape the memory plugin
/// reads. A timestamp of another shape is left out, and the record's valid time is the clock.
fn rfc3339(text: &str) -> bool {
    let b = text.as_bytes();
    let digits = |range: std::ops::Range<usize>| range.into_iter().all(|i| b[i].is_ascii_digit());
    if b.len() < 20 || !digits(0..4) || b[4] != b'-' || !digits(5..7) || b[7] != b'-' {
        return false;
    }
    if !digits(8..10) || !matches!(b[10], b'T' | b't') || !digits(11..13) || b[13] != b':' {
        return false;
    }
    if !digits(14..16) || b[16] != b':' || !digits(17..19) {
        return false;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let from = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == from {
            return false;
        }
    }
    match &b[i..] {
        [b'Z' | b'z'] => true,
        [b'+' | b'-', h1, h2, b':', m1, m2] => [h1, h2, m1, m2].iter().all(|d| d.is_ascii_digit()),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{rfc3339, split_long};

    #[test]
    fn timestamps_of_the_contract_shape() {
        assert!(rfc3339("2026-11-03T10:00:00Z"));
        assert!(rfc3339("2026-11-03T10:00:00.123Z"));
        assert!(rfc3339("2026-11-03T10:00:00+01:00"));
        assert!(!rfc3339("2026-11-03 10:00:00"));
        assert!(!rfc3339("yesterday"));
        assert!(!rfc3339("2026-11-03T10:00:00."));
    }

    #[test]
    fn a_long_line_splits_at_character_boundaries() {
        let text = "é".repeat(10);
        let pieces = split_long(&text, 5);
        assert!(pieces.iter().all(|piece| piece.len() <= 5));
        assert_eq!(pieces.concat(), text);
    }

    #[test]
    fn a_key_block_moves_whole_to_the_next_piece() {
        let text = "aaaa\nbbbb\n-----BEGIN KEY-----\nxx\n-----END KEY-----\ncc\n";
        let pieces = split_long(text, 45);
        assert_eq!(pieces[0], "aaaa\nbbbb\n");
        assert!(pieces[1].starts_with("-----BEGIN") && pieces[1].contains("-----END"));
        assert_eq!(pieces.concat(), text);
        // A block over the limit alone is split where it falls.
        let big = format!(
            "a\n-----BEGIN KEY-----\n{}\n-----END KEY-----\n",
            "x".repeat(60)
        );
        let pieces = split_long(&big, 40);
        assert!(pieces.iter().all(|piece| piece.len() <= 40));
        assert_eq!(pieces.concat(), big);
    }
}
