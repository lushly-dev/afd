//! Who drafted a submission (phase 4 specification, section 3.2; D91). The host attests a
//! pipeline step's plugin, instance, pipeline and run in `CallContext.pipeline`, from a table it
//! keeps itself and never from the call's input; this instance accepts the attestation only from
//! the instances its configuration lists in `drafters`, each with where its creates go in each
//! space (phase 4 step 3c, amendment 14):
//!
//! ```toml
//! [plugins.knowledge.config.drafters.curator.targets.main]
//! collection = "notes"            # a markdown collection of the space
//! prefix = "learned"              # optional; creates are exactly notes/learned/<derived id>
//! ```
//!
//! Listing an instance is not trusting it: every claim beyond the attested four is verified here
//! against the memory store, the fixed rendering and the configured target, or refused while it
//! cannot be (section 3.2; phase 4 step 3b, amendment 1). A drafter listed with no target in a
//! space (`[plugins.knowledge.config.drafters.<instance>]` alone) drafts no create there.

use serde_json::Value;
use umbel_sdk::{Cx, Outcome, PipelineAttestation, failure};

/// The instances `[plugins.knowledge.config.drafters]` lists; none when unset.
pub(crate) fn drafters(cx: &Cx) -> Vec<String> {
    let Ok(config) = cx.config() else {
        return Vec::new();
    };
    config
        .get("drafters")
        .and_then(Value::as_object)
        .map(|entries| entries.keys().cloned().collect())
        .unwrap_or_default()
}

/// Where a listed drafter's creates go in one space: exactly `<collection>/<prefix>/<id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    pub(crate) collection: String,
    pub(crate) prefix: Option<String>,
}

/// The target configured for `instance` in `space`, or `None` when it has none there. The
/// configuration schema already held its shape at load; a prefix that is not
/// [`umbel_okf::draft::is_safe_prefix`] reads as no target, so it never widens what passes.
pub(crate) fn target(cx: &Cx, instance: &str, space: &str) -> Option<Target> {
    let config = cx.config().ok()?;
    let entry = config
        .get("drafters")?
        .get(instance)?
        .get("targets")?
        .get(space)?;
    let collection = entry.get("collection")?.as_str()?.to_owned();
    let prefix = match entry.get("prefix") {
        None | Some(Value::Null) => None,
        Some(Value::String(prefix)) if umbel_okf::draft::is_safe_prefix(prefix) => {
            Some(prefix.clone())
        }
        Some(_) => return None,
    };
    Some(Target { collection, prefix })
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
            "the pipeline step is attested to the instance `{}`, which [plugins.knowledge.config.drafters] does not list",
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
        "Run the drafter's own pipeline (curator-run), and list its instance as [plugins.knowledge.config.drafters.<instance>] in umbel.toml, with its targets.",
    )
}
