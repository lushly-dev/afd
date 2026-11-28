//! Where a repository's commits come from: its configured source, which the host fetches into a
//! bare mirror of its own before a run (the proposal's [A run]). The mirror is M1 step 4's; this
//! is the seam it fills, and the one the scenario harness fakes from a fixture's `branches` and
//! `heads`.
//!
//! [A run]: ../../docs/features/active/loam-os/loam-os.proposal.md#a-run

/// Why the source did not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceError {
    /// What happened, in a sentence.
    pub message: String,
}

impl SourceError {
    /// An error saying `message`.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SourceError {}

/// A repository's commits, as its configured source holds them.
pub trait Source: Send + Sync {
    /// The commit `branch` points at in `repository`'s source, or `None` when it has no such
    /// branch.
    ///
    /// # Errors
    /// A [`SourceError`] when the source cannot be read.
    fn branch_head(&self, repository: &str, branch: &str) -> Result<Option<String>, SourceError>;

    /// Whether `repository`'s source holds the commit `commit` (a full id).
    ///
    /// # Errors
    /// A [`SourceError`] when the source cannot be read.
    fn contains(&self, repository: &str, commit: &str) -> Result<bool, SourceError>;
}
