//! Markdown structure (phase 2 specification, section 7.1): the heading tree, the blocks a chunker
//! takes whole, links, inline code spans and line numbers, from pulldown-cmark's offset iterator.
//!
//! Lines are 1-based and count the whole file, frontmatter included, so a locator's line range
//! points at the file a person opens. Byte offsets are into the file's text.
//!
//! The text is untrusted and may be adversarial: the work is bounded by caps on what is
//! collected ([`MAX_HEADINGS`], [`MAX_BLOCKS`], [`MAX_LINKS`], [`MAX_CODE_SPANS`]), past which
//! [`Structure::limited`] is set and the rest of the body is not read. pulldown-cmark itself is
//! linear in the input for every construct.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

/// The most headings collected.
pub const MAX_HEADINGS: usize = 20_000;
/// The most blocks collected.
pub const MAX_BLOCKS: usize = 100_000;
/// The most links collected.
pub const MAX_LINKS: usize = 50_000;
/// The most inline code spans collected.
pub const MAX_CODE_SPANS: usize = 50_000;
/// A heading's text is cut at this many characters.
pub const MAX_HEADING_CHARS: usize = 512;

/// An inclusive range of 1-based lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineRange {
    /// The first line.
    pub start: usize,
    /// The last line.
    pub end: usize,
}

/// A heading and the section it opens.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Heading {
    /// 1 to 6.
    pub level: u8,
    /// The heading's text, markup removed, cut at [`MAX_HEADING_CHARS`].
    pub text: String,
    /// The anchor: lowercase ASCII alphanumerics and `-`, with `-2`, `-3` appended to repeats.
    pub slug: String,
    /// The line the heading is on (its first line).
    pub line: usize,
    /// The section: from the heading's line to the line before the next heading of the same or a
    /// higher level, or the file's last line.
    pub lines: LineRange,
    /// The enclosing heading's index in [`Structure::headings`].
    pub parent: Option<usize>,
}

/// What kind of block a chunker is looking at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BlockKind {
    /// A paragraph.
    Paragraph,
    /// A fenced or indented code block.
    Code,
    /// A table.
    Table,
    /// One item of a top-level list, with everything nested in it.
    ListItem,
    /// A block quote.
    BlockQuote,
    /// A raw HTML block.
    Html,
    /// A thematic break.
    Rule,
    /// A footnote definition.
    Footnote,
    /// Anything else at the top level.
    Other,
}

/// One top-level block of the body (a heading is not a block: it divides sections).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Block {
    /// The kind.
    pub kind: BlockKind,
    /// The lines it covers.
    pub lines: LineRange,
    /// The bytes it covers in the file's text.
    pub bytes: Range<usize>,
    /// The source text of the block, markup included.
    pub text: String,
    /// The heading whose section holds it; `None` for the preamble before the first heading.
    pub section: Option<usize>,
}

/// A link in the body, as written.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Link {
    /// The destination, with a reference link already resolved to its definition's.
    pub target: String,
    /// The line it is on.
    pub line: usize,
}

/// An inline code span.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct CodeSpan {
    /// The code.
    pub text: String,
    /// The line it is on.
    pub line: usize,
}

/// What the body of a document holds.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[non_exhaustive]
pub struct Structure {
    /// Headings in document order; a section's parent precedes it.
    pub headings: Vec<Heading>,
    /// Top-level blocks in document order.
    pub blocks: Vec<Block>,
    /// Links (images excluded) in document order.
    pub links: Vec<Link>,
    /// Inline code spans in document order.
    pub code_spans: Vec<CodeSpan>,
    /// The file's line count: the lines of its text, the last one counted even without a line
    /// ending; 0 for an empty file.
    pub total_lines: usize,
    /// Whether a cap stopped collection; later headings, blocks and links are missing.
    pub limited: bool,
}

impl Structure {
    /// The heading with this slug.
    pub fn heading_by_slug(&self, slug: &str) -> Option<&Heading> {
        self.headings.iter().find(|heading| heading.slug == slug)
    }

    /// The texts of the headings from the top down to heading `index`.
    pub fn heading_path(&self, mut index: Option<usize>) -> Vec<String> {
        let mut path = Vec::new();
        while let Some(at) = index {
            let Some(heading) = self.headings.get(at) else {
                break;
            };
            path.push(heading.text.clone());
            index = heading.parent;
        }
        path.reverse();
        path
    }
}

/// The line count of a text: its lines, the last one counted without a line ending; 0 when empty.
pub fn count_lines(text: &str) -> usize {
    Lines::new(text).total
}

/// A slug for heading text: ASCII alphanumerics lowercased, every run of anything else one `-`,
/// no leading or trailing `-`; `section` when nothing is left.
pub fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut pending = false;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            if pending && !slug.is_empty() {
                slug.push('-');
            }
            pending = false;
            slug.push(c.to_ascii_lowercase());
        } else {
            pending = true;
        }
    }
    if slug.is_empty() {
        "section".to_owned()
    } else {
        slug
    }
}

/// Line starts of a text: the byte offset where each line begins.
struct Lines {
    starts: Vec<u32>,
    total: usize,
}

impl Lines {
    fn new(text: &str) -> Self {
        let mut starts = vec![0u32];
        for (at, byte) in text.bytes().enumerate() {
            if byte == b'\n' && at + 1 < text.len() {
                starts.push(u32::try_from(at + 1).unwrap_or(u32::MAX));
            }
        }
        let total = if text.is_empty() { 0 } else { starts.len() };
        Self { starts, total }
    }

    /// The 1-based line holding byte `offset`.
    fn of(&self, offset: usize) -> usize {
        let offset = u32::try_from(offset).unwrap_or(u32::MAX);
        self.starts.partition_point(|&start| start <= offset).max(1)
    }
}

/// An open top-level construct.
enum Open {
    Heading {
        level: u8,
        start: usize,
        text: String,
    },
    Block {
        kind: BlockKind,
        start: usize,
    },
    List {
        item_start: Option<usize>,
    },
}

fn options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
}

/// Read the structure of `text` from `body_offset` on (the byte after the frontmatter). Offsets
/// and lines in the result are into the whole text.
///
/// `text` must be at most 4 GiB; a file is at most 16 MiB (`max_file_bytes`).
pub fn structure(text: &str, body_offset: usize) -> Structure {
    let lines = Lines::new(text);
    let mut out = Structure {
        total_lines: lines.total,
        ..Structure::default()
    };
    let body = text.get(body_offset..).unwrap_or("");
    let mut open: Option<Open> = None;
    let mut depth = 0usize;
    let mut slugs = Slugs::default();
    // Open headings, by index, for the section ends and the parents.
    let mut stack: Vec<usize> = Vec::new();

    for (event, range) in Parser::new_ext(body, options()).into_offset_iter() {
        let range = body_offset + range.start..body_offset + range.end;
        match event {
            Event::Start(tag) => {
                if depth == 0 {
                    open = match &tag {
                        Tag::Heading { level, .. } => Some(Open::Heading {
                            level: *level as u8,
                            start: range.start,
                            text: String::new(),
                        }),
                        Tag::List(_) => Some(Open::List { item_start: None }),
                        other => Some(Open::Block {
                            kind: block_kind(other),
                            start: range.start,
                        }),
                    };
                } else if depth == 1
                    && matches!(tag, Tag::Item)
                    && let Some(Open::List { item_start }) = &mut open
                {
                    *item_start = Some(range.start);
                }
                if let Tag::Link { dest_url, .. } = &tag {
                    if out.links.len() >= MAX_LINKS {
                        out.limited = true;
                        break;
                    }
                    out.links.push(Link {
                        target: dest_url.to_string(),
                        line: lines.of(range.start),
                    });
                }
                depth += 1;
            }
            Event::End(end) => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    match open.take() {
                        Some(Open::Heading { level, start, text }) => {
                            if out.headings.len() >= MAX_HEADINGS {
                                out.limited = true;
                                break;
                            }
                            let text = clean(&text);
                            let slug = unique_slug(&text, &mut slugs);
                            let line = lines.of(start);
                            // The sections this heading closes end the line before it.
                            while let Some(&top) = stack.last()
                                && out.headings[top].level >= level
                            {
                                let closed = &mut out.headings[top];
                                closed.lines.end = line.saturating_sub(1).max(closed.lines.start);
                                stack.pop();
                            }
                            let index = out.headings.len();
                            out.headings.push(Heading {
                                level,
                                text,
                                slug,
                                line,
                                lines: LineRange {
                                    start: line,
                                    end: lines.total.max(line),
                                },
                                parent: stack.last().copied(),
                            });
                            stack.push(index);
                        }
                        Some(Open::Block { kind, start }) => {
                            if !push_block(&mut out, text, &lines, kind, start..range.end, &stack) {
                                break;
                            }
                        }
                        Some(Open::List { .. }) | None => {}
                    }
                } else if depth == 1
                    && end == TagEnd::Item
                    && let Some(Open::List { item_start }) = &mut open
                    && let Some(start) = item_start.take()
                    && !push_block(
                        &mut out,
                        text,
                        &lines,
                        BlockKind::ListItem,
                        start..range.end,
                        &stack,
                    )
                {
                    break;
                }
            }
            Event::Text(content) => {
                if let Some(Open::Heading { text, .. }) = &mut open
                    && text.len() < MAX_HEADING_CHARS * 4
                {
                    text.push_str(&content);
                }
            }
            Event::Code(content) => {
                if let Some(Open::Heading { text, .. }) = &mut open
                    && text.len() < MAX_HEADING_CHARS * 4
                {
                    text.push_str(&content);
                }
                if out.code_spans.len() >= MAX_CODE_SPANS {
                    out.limited = true;
                    break;
                }
                out.code_spans.push(CodeSpan {
                    text: content.to_string(),
                    line: lines.of(range.start),
                });
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(Open::Heading { text, .. }) = &mut open {
                    text.push(' ');
                }
            }
            Event::Rule if depth == 0 => {
                if !push_block(&mut out, text, &lines, BlockKind::Rule, range, &stack) {
                    break;
                }
            }
            Event::Html(_) | Event::InlineHtml(_) if depth == 0 => {
                let pushed = push_block(&mut out, text, &lines, BlockKind::Html, range, &stack);
                if !pushed {
                    break;
                }
            }
            _ => {}
        }
    }
    out
}

fn block_kind(tag: &Tag<'_>) -> BlockKind {
    match tag {
        Tag::Paragraph => BlockKind::Paragraph,
        Tag::CodeBlock(CodeBlockKind::Fenced(_) | CodeBlockKind::Indented) => BlockKind::Code,
        Tag::Table(_) => BlockKind::Table,
        Tag::BlockQuote(_) => BlockKind::BlockQuote,
        Tag::HtmlBlock => BlockKind::Html,
        Tag::FootnoteDefinition(_) => BlockKind::Footnote,
        _ => BlockKind::Other,
    }
}

fn push_block(
    out: &mut Structure,
    text: &str,
    lines: &Lines,
    kind: BlockKind,
    bytes: Range<usize>,
    stack: &[usize],
) -> bool {
    if out.blocks.len() >= MAX_BLOCKS {
        out.limited = true;
        return false;
    }
    let end = bytes.end.min(text.len());
    let start = bytes.start.min(end);
    // A block's range ends after its last line break; the line it ends on is the one before.
    let last = text[start..end].trim_end_matches(['\n', '\r']).len() + start;
    out.blocks.push(Block {
        kind,
        lines: LineRange {
            start: lines.of(start),
            end: lines.of(last.saturating_sub(1).max(start)),
        },
        bytes: start..end,
        text: text[start..end].to_owned(),
        section: stack.last().copied(),
    });
    true
}

fn clean(text: &str) -> String {
    let collapsed: Vec<&str> = text.split_whitespace().collect();
    let joined = collapsed.join(" ");
    match joined.char_indices().nth(MAX_HEADING_CHARS) {
        Some((end, _)) => joined[..end].to_owned(),
        None => joined,
    }
}

/// The slug for `text`, unique among the document's: a repeat gets `-2`, `-3`, ... (each repeat
/// of one base takes the next number, so a document of repeats stays linear).
fn unique_slug(text: &str, used: &mut Slugs) -> String {
    let base = slugify(text);
    let seen = used.next.entry(base.clone()).or_insert(1);
    let mut slug = if *seen == 1 {
        base.clone()
    } else {
        format!("{base}-{seen}")
    };
    *seen += 1;
    // `intro-2` written out by hand may equal a generated slug: step past any taken one.
    while !used.taken.insert(slug.clone()) {
        let seen = used.next.entry(base.clone()).or_insert(1);
        slug = format!("{base}-{seen}");
        *seen += 1;
    }
    slug
}

/// The slugs handed out so far.
#[derive(Default)]
struct Slugs {
    taken: HashSet<String>,
    next: HashMap<String, usize>,
}
