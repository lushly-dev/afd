//! The Open Knowledge Format v0.2 container as Umbel reads it (phase 2 specification, sections
//! 5.1 and 7.1; decisions D16 and D56).
//!
//! A knowledge document is a markdown file with optional YAML frontmatter. This crate holds what
//! both knowledge plugins need to read one, and nothing that stores or ranks:
//!
//! - [`frontmatter`]: the frontmatter, read with AFD's public reader under Umbel's 64 KiB cap,
//!   with the byte order mark and the empty block decided here, and the OKF and Umbel keys
//!   normalized under the field caps;
//! - [`structure`]: the heading tree, blocks, links and code spans of the body, with
//!   pulldown-cmark, in a bounded amount of work for any input;
//! - [`links`]: how a link target resolves to a document id;
//! - [`ingest`]: one call that turns a file's bytes into everything the plugin stores, including
//!   the write scan's flags.
//!
//! Content is untrusted: nothing here fetches a link, follows a path or runs what a document
//! says.
#![forbid(unsafe_code)]

pub mod frontmatter;
pub mod ingest;
pub mod links;
pub mod structure;

pub use ingest::{Analysis, Ingest, Kind, PathProblem, Reserved, analyze, document_id};
pub use structure::{Block, BlockKind, CodeSpan, Heading, LineRange, Link, Structure, structure};
