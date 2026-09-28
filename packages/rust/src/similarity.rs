//! String similarity utilities for fuzzy matching.
//!
//! Lengths and edit distances count UTF-16 code units, as the TypeScript
//! implementation (`packages/core/src/similarity.ts`) does, so both suggest
//! the same names: a character outside the Basic Multilingual Plane, such as
//! an emoji, counts as two.

/// Longest requested name (in UTF-16 code units) that [`find_similar_tools`]
/// will fuzzy-match. Longer names get no suggestions: Levenshtein costs
/// O(requested × candidate) per tool, and the requested name is untrusted.
pub const MAX_SIMILARITY_INPUT_LENGTH: usize = 128;

/// Minimum similarity for a name to be suggested.
const MIN_SUGGESTION_SIMILARITY: f64 = 0.4;

/// Levenshtein distance computed with two rolling rows, so memory is
/// O(min(a, b)) instead of a full O(a × b) matrix.
fn levenshtein_distance(a: &[u16], b: &[u16]) -> usize {
    // Keep the shorter string on the inner loop so the rows stay small.
    let (outer, inner) = if a.len() >= b.len() { (a, b) } else { (b, a) };
    let mut previous: Vec<usize> = (0..=inner.len()).collect();
    let mut current = vec![0usize; inner.len() + 1];

    for (i, outer_unit) in outer.iter().enumerate() {
        current[0] = i + 1;
        for (j, inner_unit) in inner.iter().enumerate() {
            let cost = usize::from(outer_unit != inner_unit);
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[inner.len()]
}

/// Similarity of two already-lowercased strings, as UTF-16 code units.
fn lowercase_similarity(a: &[u16], b: &[u16]) -> f64 {
    if a == b {
        return 1.0;
    }
    let max_len = a.len().max(b.len());
    1.0 - (levenshtein_distance(a, b) as f64 / max_len as f64)
}

/// `text` lowercased, as UTF-16 code units.
fn lowercase_units(text: &str) -> Vec<u16> {
    text.to_lowercase().encode_utf16().collect()
}

/// Calculate similarity between two strings using Levenshtein distance.
/// Returns a value between 0 and 1.
pub fn calculate_similarity(a: &str, b: &str) -> f64 {
    lowercase_similarity(&lowercase_units(a), &lowercase_units(b))
}

/// Find similar tool names for suggestions.
///
/// Returns no suggestions when `requested_tool` is longer than
/// [`MAX_SIMILARITY_INPUT_LENGTH`] UTF-16 code units.
pub fn find_similar_tools(
    requested_tool: &str,
    available_tools: &[String],
    max_suggestions: Option<usize>,
) -> Vec<String> {
    let max_suggestions = max_suggestions.unwrap_or(3);
    // Count at most one code unit past the cap, so a huge name costs O(cap).
    if requested_tool
        .encode_utf16()
        .take(MAX_SIMILARITY_INPUT_LENGTH + 1)
        .count()
        > MAX_SIMILARITY_INPUT_LENGTH
    {
        return Vec::new();
    }

    let requested = lowercase_units(requested_tool);
    let mut scored: Vec<(String, f64)> = Vec::new();
    for tool in available_tools {
        let candidate = lowercase_units(tool);
        // Length pre-filter. similarity = 1 - distance / max_len, and
        // distance >= |requested.len() - candidate.len()| because each insertion or
        // deletion changes the length by one and a substitution does not change it.
        // So no candidate can score above 1 - length_diff / max_len. When that bound
        // is under the threshold, skip the O(requested × candidate) distance. The
        // bound uses the same floating-point expression as the score, so it never
        // drops a candidate the full computation would keep.
        let max_len = requested.len().max(candidate.len());
        let length_diff = requested.len().abs_diff(candidate.len());
        if max_len > 0 && 1.0 - (length_diff as f64 / max_len as f64) < MIN_SUGGESTION_SIMILARITY {
            continue;
        }

        let similarity = lowercase_similarity(&requested, &candidate);
        if similarity >= MIN_SUGGESTION_SIMILARITY {
            scored.push((tool.clone(), similarity));
        }
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored
        .into_iter()
        .take(max_suggestions)
        .map(|(tool, _)| tool)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The original full-matrix implementation, kept as an oracle.
    fn reference_similarity(a: &str, b: &str) -> f64 {
        let a_lower = a.to_lowercase();
        let b_lower = b.to_lowercase();
        if a_lower == b_lower {
            return 1.0;
        }
        let a_units: Vec<u16> = a_lower.encode_utf16().collect();
        let b_units: Vec<u16> = b_lower.encode_utf16().collect();
        let mut matrix = vec![vec![0usize; b_units.len() + 1]; a_units.len() + 1];
        for (i, row) in matrix.iter_mut().enumerate() {
            row[0] = i;
        }
        for (j, cell) in matrix[0].iter_mut().enumerate() {
            *cell = j;
        }
        for i in 1..=a_units.len() {
            for j in 1..=b_units.len() {
                let cost = usize::from(a_units[i - 1] != b_units[j - 1]);
                matrix[i][j] = (matrix[i - 1][j] + 1)
                    .min(matrix[i][j - 1] + 1)
                    .min(matrix[i - 1][j - 1] + cost);
            }
        }
        let max_len = a_units.len().max(b_units.len());
        if max_len == 0 {
            1.0
        } else {
            1.0 - (matrix[a_units.len()][b_units.len()] as f64 / max_len as f64)
        }
    }

    fn reference_find_similar_tools(requested: &str, tools: &[String], max: usize) -> Vec<String> {
        let mut scored: Vec<(String, f64)> = tools
            .iter()
            .map(|tool| (tool.clone(), reference_similarity(requested, tool)))
            .filter(|(_, similarity)| *similarity >= 0.4)
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(max).map(|(tool, _)| tool).collect()
    }

    #[test]
    fn test_calculate_similarity() {
        assert_eq!(calculate_similarity("hello", "hello"), 1.0);
        assert_eq!(calculate_similarity("Hello", "hello"), 1.0);
        assert!(calculate_similarity("abc", "xyz") < 0.4);
        assert_eq!(calculate_similarity("", ""), 1.0);
        assert_eq!(calculate_similarity("hello", ""), 0.0);
    }

    #[test]
    fn test_find_similar_tools() {
        let tools = vec![
            "todo-create".to_string(),
            "todo-list".to_string(),
            "user-get".to_string(),
        ];

        let suggestions = find_similar_tools("todo-crate", &tools, None);
        assert_eq!(suggestions[0], "todo-create");

        let none = find_similar_tools("zzzzzzz", &tools, None);
        assert!(none.is_empty());
    }

    #[test]
    fn test_find_similar_tools_caps_requested_length() {
        let at_cap = "a".repeat(MAX_SIMILARITY_INPUT_LENGTH);
        assert_eq!(
            find_similar_tools(&at_cap, std::slice::from_ref(&at_cap), None),
            vec![at_cap.clone()]
        );

        let over_cap = "a".repeat(MAX_SIMILARITY_INPUT_LENGTH + 1);
        assert!(find_similar_tools(&over_cap, std::slice::from_ref(&over_cap), None).is_empty());

        // The cap counts UTF-16 code units, not bytes: 128 two-byte characters
        // still match.
        let multibyte = "é".repeat(MAX_SIMILARITY_INPUT_LENGTH);
        assert_eq!(
            find_similar_tools(&multibyte, std::slice::from_ref(&multibyte), None),
            vec![multibyte.clone()]
        );

        let start = std::time::Instant::now();
        let huge = "x".repeat(1024 * 1024);
        let tools: Vec<String> = (0..200).map(|i| format!("domain{i}-action")).collect();
        assert!(find_similar_tools(&huge, &tools, None).is_empty());
        assert!(start.elapsed() < std::time::Duration::from_millis(500));
    }

    /// Values from TypeScript's `similarity.ts`, which counts UTF-16 code
    /// units: a character outside the Basic Multilingual Plane counts twice.
    #[test]
    fn test_lengths_count_utf16_code_units() {
        assert_eq!(
            calculate_similarity("a\u{1F600}", "a\u{1F601}"),
            0.6666666666666667
        );
        assert_eq!(
            calculate_similarity("\u{1F600}\u{1F600}", "\u{1F601}\u{1F601}"),
            0.5
        );
        assert_eq!(
            find_similar_tools(
                "\u{1F600}\u{1F600}",
                &["\u{1F601}\u{1F601}".to_string()],
                None
            ),
            vec!["\u{1F601}\u{1F601}"]
        );

        // 64 emoji are 128 code units, at the cap; 65 are over it.
        let at_cap = "\u{1F600}".repeat(64);
        assert_eq!(
            find_similar_tools(&at_cap, std::slice::from_ref(&at_cap), None),
            vec![at_cap.clone()]
        );
        let over_cap = "\u{1F600}".repeat(65);
        assert!(find_similar_tools(&over_cap, std::slice::from_ref(&over_cap), None).is_empty());
    }

    #[test]
    fn test_length_prefilter_matches_full_computation() {
        let tools: Vec<String> = [
            "todo-create",
            "todo-list",
            "todo-get",
            "todo-update",
            "user-get",
            "user-create",
            "order-cancel",
            "a",
            "ab",
            "abcde",
            "abcdef",
            "Straße-lesen",
            "İstanbul-get",
        ]
        .iter()
        .map(|tool| tool.to_string())
        .collect();
        let queries = [
            "todo-crate",
            "todo",
            "TODO-LIST",
            "user",
            "zzzzzzz",
            "",
            "ab",
            "abcdefgh",
            "istanbul-get",
            "strasse-lesen",
        ];
        for query in queries
            .iter()
            .copied()
            .chain(tools.iter().map(String::as_str))
        {
            for max in [1, 3, 10] {
                assert_eq!(
                    find_similar_tools(query, &tools, Some(max)),
                    reference_find_similar_tools(query, &tools, max),
                    "query {query:?}"
                );
            }
            for tool in &tools {
                assert_eq!(
                    calculate_similarity(query, tool),
                    reference_similarity(query, tool)
                );
            }
        }
        // 'ab' vs 'abcde' sits exactly on the threshold and is kept.
        assert_eq!(
            find_similar_tools("ab", &["abcde".to_string()], None),
            vec!["abcde"]
        );
    }
}
