//! Structure-aware chunking (phase 2 specification, section 7.2, decision D59).
//!
//! A chunk is a contiguous part of a document that the index ranks. Words are maximal runs of
//! non-whitespace. For each section (the text under one heading down to the next heading of any
//! level; a preamble before the first heading is its own section):
//!
//! 1. blocks are taken in order;
//! 2. a chunk accumulates blocks until adding the next would pass [`MAX_WORDS`], and closes at
//!    [`MIN_WORDS`] or more at the next block boundary;
//! 3. a block over [`MAX_WORDS`] alone is split at line boundaries into pieces of at most
//!    [`MAX_WORDS`] (and [`MAX_CHUNK_BYTES`]);
//! 4. a chunk under [`TAIL_WORDS`] at the end of a section merges into the previous chunk of the
//!    same section when the result stays within the caps; otherwise it stands;
//! 5. there is no overlap, and chunks never cross a section boundary.
//!
//! Chunking is a pure function of the text and its structure.

use std::ops::Range;

use umbel_okf::{Block, Structure};
use umbel_store::ContentHash;

/// A chunk closes before it would pass this many words.
pub const MAX_WORDS: usize = 400;
/// A chunk closes at the next block boundary once it holds this many words.
pub const MIN_WORDS: usize = 240;
/// A chunk at the end of a section with fewer words than this merges into the one before it.
pub const TAIL_WORDS: usize = 40;
/// The most chunks one document is indexed with.
pub const MAX_CHUNKS: usize = 2000;
/// A chunk's text never passes this many bytes, whatever its words: the index refuses a body over
/// 1 MiB, and one long line must not make a document unindexable.
pub const MAX_CHUNK_BYTES: usize = 64 * 1024;
/// A plain-text (code) chunk holds this many lines.
pub const PLAIN_LINES: usize = 60;

/// One chunk of a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// The position in the document, from 0.
    pub ordinal: u32,
    /// The first line, 1-based, of the file including its frontmatter.
    pub line_start: u32,
    /// The last line, inclusive.
    pub line_end: u32,
    /// The bytes the chunk covers in the file's text (a byte order mark stripped).
    pub bytes: Range<usize>,
    /// The heading texts from the top down to the chunk's section.
    pub heading_path: Vec<String>,
    /// The chunk's text.
    pub text: String,
    /// `sha256:<hex>` of [`Chunk::text`].
    pub hash: String,
}

/// The chunks of one document.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Chunked {
    /// In document order, at most [`MAX_CHUNKS`].
    pub chunks: Vec<Chunk>,
    /// Whether the document had more than [`MAX_CHUNKS`] (the rest are not indexed).
    pub limited: bool,
}

/// The number of words in `text`.
#[must_use]
pub fn words(text: &str) -> usize {
    text.split_whitespace().count()
}

/// A run of source the chunker places whole.
#[derive(Debug, Clone)]
struct Piece {
    bytes: Range<usize>,
    lines: (usize, usize),
    words: usize,
    section: Option<usize>,
}

/// A chunk being built.
#[derive(Debug, Clone)]
struct Open {
    bytes: Range<usize>,
    lines: (usize, usize),
    words: usize,
    section: Option<usize>,
}

impl Open {
    fn from(piece: &Piece) -> Self {
        Self {
            bytes: piece.bytes.clone(),
            lines: piece.lines,
            words: piece.words,
            section: piece.section,
        }
    }

    fn extend(&mut self, piece: &Piece) {
        self.bytes.end = piece.bytes.end;
        self.lines.1 = piece.lines.1;
        self.words += piece.words;
    }

    fn fits(&self, piece: &Piece) -> bool {
        self.words + piece.words <= MAX_WORDS
            && piece.bytes.end - self.bytes.start <= MAX_CHUNK_BYTES
    }
}

/// Chunk a markdown document: `text` is the file's text (byte order mark stripped) and
/// `structure` is `umbel_okf::structure(text, body_offset)`.
///
/// A document with no content (no blocks, or only blocks without words) gets one empty chunk, so
/// its title, aliases and description still make it findable.
#[must_use]
pub fn markdown(text: &str, structure: &Structure) -> Chunked {
    let mut finished: Vec<Open> = Vec::new();
    let mut current: Option<Open> = None;
    let mut section: Option<Option<usize>> = None;

    for block in &structure.blocks {
        if section != Some(block.section) {
            close_section(&mut current, &mut finished);
            section = Some(block.section);
        }
        for piece in pieces(text, block) {
            let Some(open) = current.as_mut() else {
                current = Some(Open::from(&piece));
                close_if_full(&mut current, &mut finished);
                continue;
            };
            if open.fits(&piece) {
                open.extend(&piece);
            } else {
                finished.extend(current.take());
                current = Some(Open::from(&piece));
            }
            close_if_full(&mut current, &mut finished);
        }
    }
    close_section(&mut current, &mut finished);

    let mut chunked = Chunked::default();
    let mut kept: Vec<&Open> = finished.iter().filter(|open| open.words > 0).collect();
    if kept.is_empty() {
        // Nothing to rank by words: keep the first piece, or an empty chunk.
        kept = finished.iter().take(1).collect();
    }
    if kept.is_empty() {
        chunked.chunks.push(Chunk {
            ordinal: 0,
            line_start: 1,
            line_end: 1,
            bytes: 0..0,
            heading_path: Vec::new(),
            text: String::new(),
            hash: ContentHash::of(b"").to_string(),
        });
        return chunked;
    }
    chunked.limited = kept.len() > MAX_CHUNKS;
    for (ordinal, open) in kept.into_iter().take(MAX_CHUNKS).enumerate() {
        let body = text.get(open.bytes.clone()).unwrap_or("").to_owned();
        chunked.chunks.push(Chunk {
            ordinal: u32::try_from(ordinal).unwrap_or(u32::MAX),
            line_start: clamp(open.lines.0),
            line_end: clamp(open.lines.1),
            bytes: open.bytes.clone(),
            heading_path: structure.heading_path(open.section),
            hash: ContentHash::of(body.as_bytes()).to_string(),
            text: body,
        });
    }
    chunked
}

/// Chunk a code file as plain text, [`PLAIN_LINES`] lines at a time (the code feature's symbol
/// chunking, step 7b, replaces this for the languages it knows). A chunk never passes
/// [`MAX_CHUNK_BYTES`]: a line over that is cut into units that share its line number.
#[must_use]
pub fn plain(text: &str) -> Chunked {
    let mut spans: Vec<(Range<usize>, (usize, usize))> = Vec::new();
    // The chunk being built: first byte, end byte, first line, last line, distinct lines.
    let mut open: Option<(usize, usize, usize, usize, usize)> = None;
    let mut at = 0usize;
    for (index, raw) in text.split_inclusive('\n').enumerate() {
        let line = index + 1;
        let mut rest = raw;
        while !rest.is_empty() {
            let take = cut_at_boundary(rest, MAX_CHUNK_BYTES);
            let unit_end = at + take;
            if let Some((start, ..)) = open
                && unit_end - start > MAX_CHUNK_BYTES
                && let Some((start, end, first, last, _)) = open.take()
            {
                spans.push((start..end, (first, last)));
            }
            open = Some(match open {
                None => (at, unit_end, line, line, 1),
                Some((start, _, first, last, lines)) => (
                    start,
                    unit_end,
                    first,
                    line,
                    lines + usize::from(line != last),
                ),
            });
            at = unit_end;
            rest = &rest[take..];
        }
        if let Some((start, end, first, last, lines)) = open
            && lines >= PLAIN_LINES
        {
            spans.push((start..end, (first, last)));
            open = None;
        }
    }
    if let Some((start, end, first, last, _)) = open {
        spans.push((start..end, (first, last)));
    }
    if spans.is_empty() {
        spans.push((0..0, (1, 1)));
    }
    let mut chunked = Chunked {
        limited: spans.len() > MAX_CHUNKS,
        ..Chunked::default()
    };
    for (ordinal, (bytes, lines)) in spans.into_iter().take(MAX_CHUNKS).enumerate() {
        let body = text.get(bytes.clone()).unwrap_or("").to_owned();
        chunked.chunks.push(Chunk {
            ordinal: u32::try_from(ordinal).unwrap_or(u32::MAX),
            line_start: clamp(lines.0),
            line_end: clamp(lines.1),
            bytes,
            heading_path: Vec::new(),
            hash: ContentHash::of(body.as_bytes()).to_string(),
            text: body,
        });
    }
    chunked
}

fn clamp(line: usize) -> u32 {
    u32::try_from(line.max(1)).unwrap_or(u32::MAX)
}

/// Close the chunk being built when it holds [`MIN_WORDS`] or more (rule 2).
fn close_if_full(current: &mut Option<Open>, finished: &mut Vec<Open>) {
    if current.as_ref().is_some_and(|open| open.words >= MIN_WORDS) {
        finished.extend(current.take());
    }
}

/// End a section: its last chunk merges into the one before it when it is a short tail (rule 4).
fn close_section(current: &mut Option<Open>, finished: &mut Vec<Open>) {
    let Some(tail) = current.take() else {
        return;
    };
    if tail.words < TAIL_WORDS
        && let Some(previous) = finished.last_mut()
        && previous.section == tail.section
        && previous.words + tail.words <= MAX_WORDS
        && tail.bytes.end - previous.bytes.start <= MAX_CHUNK_BYTES
    {
        previous.bytes.end = tail.bytes.end;
        previous.lines.1 = tail.lines.1;
        previous.words += tail.words;
        return;
    }
    finished.push(tail);
}

/// The pieces a block is placed as: itself, or (rule 3) lines of it when it is over the caps.
fn pieces(text: &str, block: &Block) -> Vec<Piece> {
    let bytes = block.bytes.clone();
    let source = text.get(bytes.clone()).unwrap_or("");
    let total = words(source);
    if total <= MAX_WORDS && source.len() <= MAX_CHUNK_BYTES {
        return vec![Piece {
            bytes,
            lines: (block.lines.start, block.lines.end),
            words: total,
            section: block.section,
        }];
    }
    let mut out: Vec<Piece> = Vec::new();
    let mut open: Option<Piece> = None;
    let mut at = bytes.start;
    for (line, raw) in (block.lines.start..).zip(source.split_inclusive('\n')) {
        let count = words(raw);
        let span = at..at + raw.len();
        if count > MAX_WORDS || raw.len() > MAX_CHUNK_BYTES {
            // One line over the caps: flush, then cut it at word boundaries.
            out.extend(open.take());
            out.extend(split_line(text, span.clone(), line, block.section));
        } else {
            match open.as_mut() {
                Some(piece)
                    if piece.words + count <= MAX_WORDS
                        && span.end - piece.bytes.start <= MAX_CHUNK_BYTES =>
                {
                    piece.bytes.end = span.end;
                    piece.lines.1 = line;
                    piece.words += count;
                }
                _ => {
                    out.extend(open.take());
                    open = Some(Piece {
                        bytes: span,
                        lines: (line, line),
                        words: count,
                        section: block.section,
                    });
                }
            }
        }
        at += raw.len();
    }
    out.extend(open);
    out
}

/// Cut one over-long line at word boundaries into pieces within the caps; a single word over the
/// byte cap is cut at character boundaries.
fn split_line(text: &str, span: Range<usize>, line: usize, section: Option<usize>) -> Vec<Piece> {
    let source = text.get(span.clone()).unwrap_or("");
    // The words of the line, as byte ranges within it.
    let mut spans: Vec<Range<usize>> = Vec::new();
    let mut begin: Option<usize> = None;
    for (index, ch) in source.char_indices() {
        match (ch.is_whitespace(), begin) {
            (true, Some(start)) => {
                spans.push(start..index);
                begin = None;
            }
            (false, None) => begin = Some(index),
            _ => {}
        }
    }
    if let Some(start) = begin {
        spans.push(start..source.len());
    }
    let piece = |from: usize, to: usize, count: usize| Piece {
        bytes: span.start + from..span.start + to,
        lines: (line, line),
        words: count,
        section,
    };
    let mut out = Vec::new();
    // The group being built: its first byte, its end and its word count.
    let mut group: Option<(usize, usize, usize)> = None;
    for word in spans {
        if word.len() > MAX_CHUNK_BYTES {
            if let Some((from, to, count)) = group.take() {
                out.push(piece(from, to, count));
            }
            let mut at = word.start;
            while at < word.end {
                let take = cut_at_boundary(&source[at..word.end], MAX_CHUNK_BYTES);
                out.push(piece(at, at + take, 1));
                at += take;
            }
            continue;
        }
        group = match group {
            Some((from, _, count)) if count < MAX_WORDS && word.end - from <= MAX_CHUNK_BYTES => {
                Some((from, word.end, count + 1))
            }
            Some((from, to, count)) => {
                out.push(piece(from, to, count));
                Some((word.start, word.end, 1))
            }
            None => Some((word.start, word.end, 1)),
        };
    }
    if let Some((from, to, count)) = group {
        out.push(piece(from, to, count));
    }
    out
}

/// The largest length not past `limit` that ends on a character boundary.
fn cut_at_boundary(text: &str, limit: usize) -> usize {
    let mut end = limit.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    if end == 0 {
        // The first character is wider than the limit: take it whole rather than loop.
        text.chars().next().map_or(0, char::len_utf8)
    } else {
        end
    }
}
