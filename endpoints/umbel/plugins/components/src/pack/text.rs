//! The format's text rules and limits (`foundations/specimen/src/pack-schema.ts`).

/// Longest summary, in Unicode code points.
pub(crate) const SUMMARY: usize = 160;
/// Longest statement, type, description or event detail.
pub(crate) const STATEMENT: usize = 240;
/// Longest library title.
pub(crate) const TITLE: usize = 80;
/// Longest attribute value or default.
pub(crate) const VALUE: usize = 200;
/// Longest long form.
pub(crate) const DETAIL: usize = 8000;
/// Longest example.
pub(crate) const EXAMPLE: usize = 4000;

/// A one-line text refuses every C0 and C1 control and DEL, and bidirectional embeddings,
/// overrides and isolates; a multi-line text also allows tab and line feed.
pub(crate) fn allowed(text: &str, multi_line: bool) -> bool {
    text.chars().all(|c| {
        let code = c as u32;
        if multi_line && (c == '\t' || c == '\n') {
            return true;
        }
        !(code <= 0x1F
            || (0x7F..=0x9F).contains(&code)
            || (0x202A..=0x202E).contains(&code)
            || (0x2066..=0x2069).contains(&code))
    })
}
