//! Who may change a record (phase 5 specification, section 8.3, owner decision 10), as the plugin
//! itself checks it before it asks the host: the record's own principal, with the legacy
//! principals it stands for (`CallContext::equivalents`, section 4.6), or a person. The host's
//! memory services decide the rest, `editors` included, and refuse whatever this lets through;
//! this check only adds refusals, so an agent never reaches the host's rule with another
//! principal's record, whatever `agents_may_share` says.

use umbel_sdk::{Cx, HostError, Outcome, failure};

use crate::confirm::owns;
use crate::pipeline::effective_principal;

/// `MEMORY_NOT_OWNED`, as the host words it, never naming the record's owner.
pub(crate) fn not_owned() -> Outcome {
    failure(
        "MEMORY_NOT_OWNED",
        "the record is another principal's",
        crate::fail::NOT_OWNED_SUGGESTION,
    )
    .with_retryable(false)
}

/// Whether this call is a person's as the host attests it: the terminal check or the library's
/// person (`CallContext::person`), or a decision on the person page for this call.
fn a_person(cx: &Cx) -> bool {
    let call = cx.call();
    call.person || call.person_decision.is_some()
}

/// Refuse a change of `id` in `space` when it is another principal's record and the caller is
/// not a person. A record the caller cannot read passes, so the host answers it as absent.
pub(crate) fn may_change(cx: &Cx, space: &str, id: &str) -> Result<(), Outcome> {
    let current = match cx.memory_history(space, id) {
        Ok(versions) => versions
            .into_iter()
            .rev()
            .find(|v| v.recorded_until.is_none()),
        Err(HostError::NotProvisioned) => None,
        Err(error) => return Err(crate::fail::host(&error)),
    };
    let Some(current) = current else {
        return Ok(());
    };
    let me = effective_principal(cx.call());
    if owns(cx, me.as_deref(), &current.scope.principal) || a_person(cx) {
        return Ok(());
    }
    Err(not_owned())
}
