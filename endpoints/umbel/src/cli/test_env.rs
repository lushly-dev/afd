//! The test kit's stand-ins for a frozen clock and a person at a terminal (phase 3 specification,
//! section 12): `UMBEL_TEST_CLOCK` (epoch milliseconds) and `UMBEL_TEST_HUMAN_PRESENT=1`.
//!
//! **Compiled only with the `testkit` feature** (`src/cli/mod.rs` declares this module under
//! `#[cfg(feature = "testkit")]`), which `cargo test` enables through the dev-dependency. A normal
//! build of `umbel` has neither variable: nothing reads them, so no environment can pretend to
//! be a person at a terminal. `tests/cli_stdin_input.rs` checks that the names appear nowhere
//! else in the host's sources.

use std::io::Write;

use super::prompt::Console;

/// The frozen clock's variable.
const CLOCK: &str = "UMBEL_TEST_CLOCK";
/// The person-at-a-terminal variable.
const HUMAN_PRESENT: &str = "UMBEL_TEST_HUMAN_PRESENT";

/// `UMBEL_TEST_CLOCK`, when set to an integer.
pub(super) fn clock() -> Option<i64> {
    std::env::var(CLOCK).ok()?.trim().parse().ok()
}

/// Whether `UMBEL_TEST_HUMAN_PRESENT` is `1`.
pub(super) fn human_present() -> bool {
    std::env::var_os(HUMAN_PRESENT).is_some_and(|value| value == "1")
}

/// A person at a terminal who answers every prompt yes. stdin is still the process's, so `@-`
/// reads what the test piped, and `@-` still withholds human-present (section 10.6).
pub(super) struct PersonAtTerminal;

impl Console for PersonAtTerminal {
    fn is_interactive(&self) -> bool {
        true
    }

    fn ask(&self, text: &str) -> bool {
        let mut stderr = std::io::stderr();
        let _ = writeln!(stderr, "{text}y");
        true
    }
}
