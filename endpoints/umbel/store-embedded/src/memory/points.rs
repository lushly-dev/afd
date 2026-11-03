//! Named crash and failure points (phase 3 section 7.4), compiled in only with the `testkit`
//! feature. `UMBEL_TEST_CRASH_AT=<point>` aborts the process there, as a crash would, leaving the
//! operating system's cache intact; `UMBEL_TEST_FAIL_AT=<point>` makes that step answer an I/O
//! error. Without the feature both are no-ops.
//!
//! The points: `provision-keys` (the key file renamed, the store id not committed), `write-keys`
//! (keys committed, memory not), `forget-1` to `forget-5` (after each step of section 5.4's
//! order), `purge-2` to `purge-4`, `backup-copy` (partway through the copy) and `rebuild`
//! (partway through the rebuild on open).

use crate::error::Fail;

/// The variable naming the point at which to abort.
#[cfg(feature = "testkit")]
pub(crate) const CRASH_AT: &str = "UMBEL_TEST_CRASH_AT";
/// The variable naming the step that answers an I/O error.
#[cfg(feature = "testkit")]
pub(crate) const FAIL_AT: &str = "UMBEL_TEST_FAIL_AT";

/// Abort here when `UMBEL_TEST_CRASH_AT` names `point`.
#[inline]
pub(crate) fn crash(point: &str) {
    #[cfg(feature = "testkit")]
    if std::env::var(CRASH_AT).as_deref() == Ok(point) {
        std::process::abort();
    }
    let _ = point;
}

/// An I/O error here when `UMBEL_TEST_FAIL_AT` names `point`.
#[inline]
pub(crate) fn fail(point: &str) -> Result<(), Fail> {
    #[cfg(feature = "testkit")]
    if std::env::var(FAIL_AT).as_deref() == Ok(point) {
        return Err(umbel_store::StoreError::Io(format!("{FAIL_AT}={point}")).into());
    }
    let _ = point;
    Ok(())
}
