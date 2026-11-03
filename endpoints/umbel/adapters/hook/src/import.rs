//! `umbel-hook import <harness> <dir> [--project p] [--class c]` (section 10.5): the `*.md` files
//! directly in a directory the person names, as `memory-import` calls.
//!
//! It skips `MEMORY.md`, which is an index, and `umbel-*.md`, which are its own exports, and never
//! searches a home directory or any directory below the one named. Each file is one entry, or one
//! per part when it is over 64 KiB; files go in sorted name order into calls of at most 800 KiB of
//! entries as JSON and 256 entries. Each call stands alone, so a retry after a partial failure
//! gives observations. The records' authority is `import`, whoever runs it: the host decides.

use std::io::Write;
use std::time::Duration;

use serde_json::{Value, json};

use crate::Environment;
use crate::child;
use crate::failure::Failure;
use crate::files::{Args, frontmatter};

/// The most bytes of one entry's text (section 8.9).
pub(crate) const MAX_ENTRY_BYTES: usize = 64 * 1024;
/// The most bytes of one call's entries, as JSON.
pub(crate) const MAX_CALL_BYTES: usize = 800 * 1024;
/// The most entries in one call.
pub(crate) const MAX_CALL_ENTRIES: usize = 256;
/// The most bytes of one file read; a larger file is skipped and counted.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// The most characters of a subject.
const SUBJECT_CHARS: usize = 256;
/// How long one `memory-import` call may run.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// What the directory held.
#[derive(Debug, Default)]
pub(crate) struct Read {
    pub(crate) entries: Vec<Value>,
    pub(crate) files: usize,
    pub(crate) skipped: usize,
}

/// Whether the import reads a file of this name.
pub(crate) fn wanted(name: &str) -> bool {
    name.ends_with(".md") && name != "MEMORY.md" && !name.starts_with("umbel-")
}

/// A frontmatter `type` as a class: `feedback` is procedural, `episode` episodic, and anything
/// else, or none, `default` (`--class`, else semantic).
pub(crate) fn class_of(kind: Option<&str>, default: Option<&str>) -> String {
    match kind {
        Some("feedback") => "procedural".into(),
        Some("episode") => "episodic".into(),
        _ => default.unwrap_or("semantic").into(),
    }
}

/// One line of at most `max` characters, control characters as spaces.
fn one_line(text: &str, max: usize) -> String {
    let line: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    line.trim().chars().take(max).collect()
}

/// `text` in parts of at most `max` bytes, split at line boundaries, and a line over `max` at
/// character boundaries.
pub(crate) fn parts(text: &str, max: usize) -> Vec<String> {
    if text.len() <= max {
        return vec![text.to_owned()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    for line in text.split_inclusive('\n') {
        if current.len() + line.len() > max && !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
        if line.len() <= max {
            current.push_str(line);
            continue;
        }
        for c in line.chars() {
            if current.len() + c.len_utf8() > max {
                out.push(std::mem::take(&mut current));
            }
            current.push(c);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// The entries of one file named `name` holding `text`.
pub(crate) fn entries_of(name: &str, text: &str, default_class: Option<&str>) -> Vec<Value> {
    let (front, body) = frontmatter(text);
    let stem = name.strip_suffix(".md").unwrap_or(name);
    let mut subject = one_line(front.name.as_deref().unwrap_or_default(), SUBJECT_CHARS);
    if subject.is_empty() {
        subject = one_line(stem, SUBJECT_CHARS);
    }
    if subject.is_empty() {
        subject = "untitled".into();
    }
    let class = class_of(front.kind.as_deref(), default_class);
    // The description is the harness's one-line summary; it leads the text, so nothing the file
    // said is lost (amendments from step 9).
    let body = body.trim_start_matches(['\r', '\n']).trim_end();
    let text = match front.description.as_deref().map(str::trim) {
        Some(description) if !description.is_empty() && !body.is_empty() => {
            format!("{description}\n\n{body}")
        }
        Some(description) if !description.is_empty() => description.to_owned(),
        _ => body.to_owned(),
    };
    let pieces = parts(&text, MAX_ENTRY_BYTES);
    let n = pieces.len();
    pieces
        .into_iter()
        .enumerate()
        .map(|(k, piece)| {
            let (subject, path) = if n == 1 {
                (subject.clone(), name.to_owned())
            } else {
                let suffix = format!(" (part {} of {n})", k + 1);
                let base: String = subject
                    .chars()
                    .take(SUBJECT_CHARS - suffix.chars().count())
                    .collect();
                (format!("{base}{suffix}"), format!("{name}#p{}", k + 1))
            };
            json!({ "class": class, "subject": subject, "text": piece, "path": path })
        })
        .collect()
}

/// Read the directory's files, in sorted name order.
pub(crate) fn read_dir(args: &Args) -> Result<Read, Failure> {
    let unreadable = || Failure::new("dir-unreadable", "the directory cannot be read");
    let mut names = Vec::new();
    let mut read = Read::default();
    for entry in std::fs::read_dir(&args.dir).map_err(|_| unreadable())? {
        let entry = entry.map_err(|_| unreadable())?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            read.skipped += 1;
            continue;
        };
        if !wanted(&name) {
            continue;
        }
        // A regular file directly in the directory: never a link, never a directory.
        match std::fs::symlink_metadata(entry.path()) {
            Ok(meta) if meta.is_file() && meta.len() <= MAX_FILE_BYTES => names.push(name),
            _ => read.skipped += 1,
        }
    }
    names.sort();
    for name in names {
        let Ok(text) = std::fs::read_to_string(args.dir.join(&name)) else {
            read.skipped += 1;
            continue;
        };
        read.files += 1;
        read.entries
            .extend(entries_of(&name, &text, args.class.as_deref()));
    }
    Ok(read)
}

/// The entries in calls of at most [`MAX_CALL_BYTES`] as JSON and [`MAX_CALL_ENTRIES`].
pub(crate) fn calls(entries: Vec<Value>) -> Vec<Vec<Value>> {
    let mut out = Vec::new();
    let mut current = Vec::new();
    let mut bytes = 0;
    for entry in entries {
        let size = serde_json::to_vec(&entry).map_or(MAX_CALL_BYTES, |b| b.len() + 1);
        if !current.is_empty()
            && (bytes + size > MAX_CALL_BYTES || current.len() == MAX_CALL_ENTRIES)
        {
            out.push(std::mem::take(&mut current));
            bytes = 0;
        }
        bytes += size;
        current.push(entry);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Run the import; the exit code.
pub(crate) fn run(
    args: &Args,
    environment: &Environment,
    stdout: &mut dyn Write,
) -> Result<(), Failure> {
    let read = read_dir(args)?;
    let mut totals = [0u64; 3];
    let entries = read.entries.len();
    let calls = calls(read.entries);
    for (done, batch) in calls.iter().enumerate() {
        let mut input = json!({ "harness": args.harness, "entries": batch });
        if let Some(project) = &args.project {
            input["project"] = json!(project);
        }
        let data = child::call(environment, "memory-import", &input, CALL_TIMEOUT).map_err(
            |failure| Failure {
                message: format!(
                    "{} ({done} of {} calls had finished; run it again, and what was imported becomes observations)",
                    failure.message,
                    calls.len()
                ),
                ..failure
            },
        )?;
        for (total, key) in totals.iter_mut().zip(["created", "observed", "flagged"]) {
            *total += data.get(key).and_then(Value::as_u64).unwrap_or(0);
        }
    }
    let summary = json!({
        "files": read.files,
        "entries": entries,
        "calls": calls.len(),
        "created": totals[0],
        "observed": totals[1],
        "flagged": totals[2],
        "skipped": read.skipped,
        "authority": "import",
        "note": "The source files stay where they are: a memory-forget in Umbel cannot reach them. Remove or move them if Umbel is to hold the only copy.",
    });
    let _ = writeln!(stdout, "{summary}");
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn parts_split_at_lines_and_long_lines_at_characters() {
        assert_eq!(parts("short", 10), ["short"]);
        assert_eq!(parts("aaaa\nbbbb\ncc", 10), ["aaaa\nbbbb\n", "cc"]);
        let long = parts(&"é".repeat(12), 10);
        assert!(long.iter().all(|p| p.len() <= 10), "{long:?}");
        assert_eq!(long.concat(), "é".repeat(12));
    }

    #[test]
    fn the_file_names_the_import_reads() {
        assert!(wanted("feedback_tests.md"));
        for name in ["MEMORY.md", "umbel-index.md", "umbel-mem-0.md", "notes.txt"] {
            assert!(!wanted(name), "{name}");
        }
    }
}
