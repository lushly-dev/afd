//! Reading names from a page's source (specification, section 7), and nearest names for a tag no
//! touched library has (section 6.2).

use std::collections::HashSet;

/// Largest edit distance a nearest name may have.
const MAX_DISTANCE: usize = 3;
/// At most this many nearest names.
const MAX_NEAREST: usize = 3;

/// A banded Levenshtein distance over bytes, or `None` past [`MAX_DISTANCE`].
pub(crate) fn distance(a: &[u8], b: &[u8]) -> Option<usize> {
    if a.len().abs_diff(b.len()) > MAX_DISTANCE {
        return None;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, &left) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        let low = (i + 1).saturating_sub(MAX_DISTANCE);
        let high = (i + 1 + MAX_DISTANCE).min(b.len());
        for j in 1..=b.len() {
            let current = row[j];
            row[j] = if j < low || j > high {
                MAX_DISTANCE + 1
            } else {
                let substitute = previous + usize::from(left != b[j - 1]);
                substitute.min(current + 1).min(row[j - 1] + 1)
            };
            previous = current;
        }
    }
    row.last().copied().filter(|d| *d <= MAX_DISTANCE)
}

/// Up to three tags within the distance, nearest first, then by name.
pub(crate) fn nearest<'a>(tag: &str, tags: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut found: Vec<(usize, &str)> = tags
        .into_iter()
        .filter_map(|candidate| {
            distance(tag.as_bytes(), candidate.as_bytes()).map(|d| (d, candidate))
        })
        .collect();
    found.sort_unstable();
    found.dedup();
    found
        .into_iter()
        .take(MAX_NEAREST)
        .map(|(_, candidate)| candidate.to_owned())
        .collect()
}

/// The format's longest tag.
const MAX_TAG: usize = 100;

/// Whether a run of the tag alphabet matches the tag pattern, `^[a-z][a-z0-9._]*-[a-z0-9._-]*$`:
/// with the alphabet already held, that is a leading letter and a hyphen somewhere. Written out so
/// no regular expression runs over the source.
fn is_tag(run: &[u8]) -> bool {
    run.len() <= MAX_TAG && run.first().is_some_and(u8::is_ascii_lowercase) && run.contains(&b'-')
}

fn in_alphabet(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
}

/// One name the source asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    pub(crate) tag: String,
    /// In no catalog: a name in element position that starts with a touched library's prefix.
    pub(crate) unknown: bool,
}

/// The names `source` asks for, in the order first found, each once: every whole run that is a
/// known tag (after its trailing `.`, `_` and `-` are removed, when it is not one as written), and
/// every run in element position that starts with one of `prefixes` and is in no catalog. One pass
/// over the bytes.
pub(crate) fn read_source(
    source: &str,
    known: impl Fn(&str) -> bool,
    prefixes: &[&str],
) -> Vec<Found> {
    let bytes = source.as_bytes();
    let mut found: Vec<Found> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |tag: &str, unknown: bool| {
        if seen.insert(tag.to_owned()) {
            found.push(Found {
                tag: tag.to_owned(),
                unknown,
            });
        }
    };
    let mut index = 0;
    while index < bytes.len() {
        if !in_alphabet(bytes[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && in_alphabet(bytes[index]) {
            index += 1;
        }
        let run = &bytes[start..index];
        if !is_tag(run) {
            continue;
        }
        // The run is ASCII, so it is a `str` as it stands.
        let Ok(name) = std::str::from_utf8(run) else {
            continue;
        };
        if known(name) {
            push(name, false);
            continue;
        }
        let trimmed = name.trim_end_matches(['.', '_', '-']);
        if trimmed.len() < name.len() && is_tag(trimmed.as_bytes()) && known(trimmed) {
            push(trimmed, false);
            continue;
        }
        let element = (start >= 1 && bytes[start - 1] == b'<')
            || (start >= 2 && &bytes[start - 2..start] == b"</");
        // An unknown name is echoed outside the content part, so it is trimmed as a known one is,
        // and dropped when the scan reads it as an instruction (a page may be a third party's).
        let name = if trimmed.len() < name.len() && is_tag(trimmed.as_bytes()) {
            trimmed
        } else {
            name
        };
        if element
            && prefixes.iter().any(|prefix| name.starts_with(prefix))
            && !crate::scan::identifier_hit(name)
        {
            push(name, true);
        }
    }
    found
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::pack::patterns;

    #[test]
    fn the_hand_written_tag_check_agrees_with_the_pattern() {
        for sample in [
            "a-",
            "a-b",
            "ab",
            "-a",
            "1-a",
            "a.b-c",
            "a_b-",
            "a--",
            "a-b.c_d-e",
            "a",
            "",
            "z9-0",
            ".a-b",
        ] {
            assert_eq!(
                is_tag(sample.as_bytes()),
                patterns::TAG.accepts(sample),
                "{sample}"
            );
        }
        let long = format!("a-{}", "b".repeat(98));
        assert_eq!(is_tag(long.as_bytes()), patterns::TAG.accepts(&long));
        let longer = format!("{long}c");
        assert_eq!(is_tag(longer.as_bytes()), patterns::TAG.accepts(&longer));
    }
}
