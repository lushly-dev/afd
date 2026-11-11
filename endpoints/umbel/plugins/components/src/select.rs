//! Nearest names for a tag no touched library has (specification, section 6.2). The rest of
//! selection arrives with `components-brief`.

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
