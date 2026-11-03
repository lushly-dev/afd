//! Why a hook event did nothing. Its code goes to `last-error.json` and its message to stderr;
//! neither ever holds transcript text, a path or a child's message (section 10.3).

/// A failed hook event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    /// A child's error code (`STORE_BUSY`, `MEMORY_INVALID`, ...) or the hook's own, in kebab case:
    /// `invalid-arguments`, `invalid-stdin`, `no-binary`, `child-failed`, `child-timeout`,
    /// `transcript-unreadable`, `no-state-dir`, `state-unwritable`; and, for `import` and
    /// `export`, `dir-unreadable` and `dir-unwritable`.
    pub code: String,
    /// One line for stderr.
    pub message: String,
}

impl Failure {
    pub(crate) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
        }
    }
}

/// What a hook event that succeeded leaves on stderr, if anything: counts only.
pub(crate) type Outcome = Result<Option<String>, Failure>;
