//! The unified diff a proposal shows its approver, computed once at submission.

use similar::TextDiff;

/// A unified diff with three lines of context of the file before and after. A create diffs
/// against nothing.
pub(crate) fn unified(path: &str, old: &str, new: &str, create: bool) -> String {
    let from = if create {
        "/dev/null".to_owned()
    } else {
        format!("a/{path}")
    };
    TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(3)
        .header(&from, &format!("b/{path}"))
        .to_string()
}
