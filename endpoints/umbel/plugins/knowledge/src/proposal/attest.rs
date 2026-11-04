//! Who drafted a submission (phase 4 specification, section 3.2; D91). The host attests a
//! pipeline step's plugin, instance, pipeline and run in `CallContext.pipeline`, from a table it
//! keeps itself and never from the call's input; this instance accepts the attestation only from
//! the instances its configuration lists in `drafters`:
//!
//! ```toml
//! [plugins.knowledge.config]
//! drafters = ["curator"]          # default []: an attested submission is refused
//! ```
//!
//! Listing an instance is not trusting it: every claim beyond the attested four is verified here
//! against the memory store and the fixed rendering, or refused while it cannot be (section 3.2;
//! phase 4 step 3b, amendment 1).

use serde_json::Value;
use umbel_sdk::{Cx, Outcome, PipelineAttestation, failure};

/// The instances `[plugins.knowledge.config] drafters` lists; none when unset.
pub(crate) fn drafters(cx: &Cx) -> Vec<String> {
    let Ok(config) = cx.config() else {
        return Vec::new();
    };
    config
        .get("drafters")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The call's attestation when it is accepted: `Ok(None)` for a call that is no pipeline step,
/// `Ok(Some(_))` for a step of a listed instance's pipeline.
///
/// # Errors
/// `PROPOSAL_DRAFTER_NOT_ALLOWED` for a step of an instance `drafters` does not list.
pub(crate) fn accepted(cx: &Cx) -> Result<Option<PipelineAttestation>, Outcome> {
    let Some(attestation) = cx.call().pipeline.clone() else {
        return Ok(None);
    };
    if drafters(cx).contains(&attestation.instance) {
        Ok(Some(attestation))
    } else {
        Err(not_allowed(&format!(
            "the pipeline step is attested to the instance `{}`, which [plugins.knowledge.config] drafters does not list",
            attestation.instance
        )))
    }
}

/// The call's accepted attestation, required.
///
/// # Errors
/// `PROPOSAL_DRAFTER_NOT_ALLOWED` without an attestation, or for an unlisted instance's step.
pub(crate) fn required(cx: &Cx) -> Result<PipelineAttestation, Outcome> {
    accepted(cx)?.ok_or_else(|| {
        not_allowed("the call is not a step of a pipeline the host attests to a listed drafter")
    })
}

fn not_allowed(why: &str) -> Outcome {
    failure(
        "PROPOSAL_DRAFTER_NOT_ALLOWED",
        &format!("drafted proposals are not accepted here: {why}"),
        "Run the drafter's own pipeline (curator-run), and list its instance in [plugins.knowledge.config] drafters in umbel.toml.",
    )
}
