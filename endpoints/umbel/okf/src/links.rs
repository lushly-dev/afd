//! Link resolution (phase 2 specification, section 7.1): which document a link in a document
//! points at, decided from the text alone.
//!
//! A relative path, or a `/`-prefixed path (OKF's bundle-relative form, relative to the
//! collection root), to a `.md` file of the same collection resolves to a document id, the `.md`
//! optional; a `#fragment` names a heading slug. An absolute URL is external and never fetched. A
//! `/`-prefixed path whose first segment is another collection of the space resolves into that
//! collection; nothing resolves across spaces. Whether the document exists is for the caller,
//! which holds the store.

/// What a link target points at.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum Target {
    /// A URL with a scheme (or `//host`), kept as written.
    External(String),
    /// A heading of the document the link is in.
    Fragment(String),
    /// A document, and optionally one of its headings.
    Document {
        /// `<collection>/<path without .md>`.
        id: String,
        /// The heading slug after `#`, when there is one.
        fragment: Option<String>,
    },
    /// A file of the collection that is not a document: an image, a PDF, a source file. It is not
    /// a document link, so it is never broken.
    File(String),
    /// A path that names nothing in the container: it climbs out of the collection root, holds an
    /// empty or dot segment, or ends in `/`.
    Unresolved,
}

/// Decode `%XX` escapes; an escape that is not valid hex, or bytes that are not UTF-8 after
/// decoding, leave the text as written.
fn percent_decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%'
            && let (Some(high), Some(low)) = (
                bytes.get(at + 1).and_then(|b| (*b as char).to_digit(16)),
                bytes.get(at + 2).and_then(|b| (*b as char).to_digit(16)),
            )
        {
            out.push(u8::try_from(high * 16 + low).unwrap_or(b'%'));
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

/// Whether `target` starts with a URL scheme (`https:`, `mailto:`) or `//`.
fn is_external(target: &str) -> bool {
    if target.starts_with("//") {
        return true;
    }
    let Some(colon) = target.find(':') else {
        return false;
    };
    let scheme = &target[..colon];
    // A scheme is a letter and then letters, digits, `+`, `-` or `.`. A path with a colon after a
    // slash or a dot-less word is a file name, not a scheme, but a single letter is a Windows
    // drive and is treated as external too: it cannot be a document of ours.
    scheme
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        && !target[..colon].contains('/')
}

/// Resolve `target`, a link destination as written in the document `from` (an id,
/// `<collection>/<path>`), against the collections of the space.
///
/// ```
/// use umbel_okf::links::{resolve, Target};
///
/// let collections = ["handbook".to_owned(), "runbooks".to_owned()];
/// let here = "handbook/deploy/rollback";
/// assert_eq!(
///     resolve("canary.md#steps", here, &collections),
///     Target::Document { id: "handbook/deploy/canary".into(), fragment: Some("steps".into()) }
/// );
/// assert_eq!(
///     resolve("/runbooks/pager", here, &collections),
///     Target::Document { id: "runbooks/pager".into(), fragment: None }
/// );
/// ```
pub fn resolve(target: &str, from: &str, collections: &[String]) -> Target {
    let target = target.trim();
    if target.is_empty() {
        return Target::Unresolved;
    }
    if is_external(target) {
        return Target::External(target.to_owned());
    }
    let (path, fragment) = match target.split_once('#') {
        Some((path, fragment)) => (path, Some(percent_decode(fragment))),
        None => (target, None),
    };
    let fragment = fragment.filter(|fragment| !fragment.is_empty());
    // A query string is not part of a file's path.
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    let own_collection = from
        .split_once('/')
        .map_or(from, |(collection, _)| collection);
    if path.is_empty() {
        return match fragment {
            Some(fragment) => Target::Fragment(fragment),
            None => Target::Unresolved,
        };
    }
    let path = percent_decode(path);
    let (collection, mut segments): (String, Vec<String>) =
        if let Some(rooted) = path.strip_prefix('/') {
            let first = rooted.split('/').next().unwrap_or("");
            match collections.iter().find(|known| known.as_str() == first) {
                Some(other) if rooted.len() > first.len() => (
                    other.clone(),
                    rooted[first.len() + 1..]
                        .split('/')
                        .map(str::to_owned)
                        .collect(),
                ),
                _ => (
                    own_collection.to_owned(),
                    rooted.split('/').map(str::to_owned).collect(),
                ),
            }
        } else {
            // Relative to the directory of the document that holds the link.
            let from_path = from
                .strip_prefix(own_collection)
                .unwrap_or("")
                .trim_start_matches('/');
            let mut directory: Vec<String> = from_path.split('/').map(str::to_owned).collect();
            directory.pop();
            directory.extend(path.split('/').map(str::to_owned));
            (own_collection.to_owned(), directory)
        };
    // `..` and `.` are resolved here; leaving the collection root, or an empty or hidden
    // segment, resolves to nothing.
    let mut clean: Vec<String> = Vec::new();
    for segment in segments.drain(..) {
        match segment.as_str() {
            "." => {}
            ".." => {
                if clean.pop().is_none() {
                    return Target::Unresolved;
                }
            }
            "" => return Target::Unresolved,
            hidden if hidden.starts_with('.') => return Target::Unresolved,
            _ => clean.push(segment),
        }
    }
    let Some(name) = clean.last() else {
        return Target::Unresolved;
    };
    let joined = clean.join("/");
    let (id_path, is_document) = match joined.strip_suffix(".md") {
        Some(without) => (without.to_owned(), true),
        None => (joined.clone(), !name.contains('.')),
    };
    if !is_document {
        return Target::File(format!("{collection}/{joined}"));
    }
    Target::Document {
        id: format!("{collection}/{id_path}"),
        fragment,
    }
}
