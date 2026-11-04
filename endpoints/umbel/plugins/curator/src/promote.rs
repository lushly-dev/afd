//! `curator-promote` (phase 4 specification, section 5.2; owner decision 5, D94): a person, at a
//! terminal, consents to have one of their own candidates drafted for the target collection's
//! readers, which are wider than their records'.
//!
//! It mirrors `memory-confirm` (D88) on the host's mechanisms: `confirm = "require-human"` with a
//! fixed prompt, so the host refuses it everywhere but a terminal and refuses `--yes`,
//! `--approve` and `@-`; CLI only, so MCP and in-process agents never see it; digest-journaled.
//! and, as the host's memory service does before a confirmation, the host's own answer to whether
//! the caller is a person (`CallContext.person`, step 4's amendment 9), so an agent's environment
//! variable withholds it (`not-a-person`). Then the plugin's own rules:
//! - **own records only**: the caller's effective principal is the owner of every source, else
//!   `CURATOR_PROMOTE_NOT_ALLOWED` (`not-own`);
//! - **proof of looking**: the `contentHash` the person passes must match, since the prompt cannot
//!   show text (`content-hash`);
//! - **only what needs it**: the candidate is `needs-promotion`; sensitivity is never overridden
//!   (`status`).
//!
//! What it records is a `consent` record, readable by the caller alone, listing each source at its
//! version and hash. The next run drafts the candidate with `mode = "promoted"` and `promotedBy`,
//! which the knowledge plugin checks against the sources' owners (section 3.2), and only while the
//! sources stand at exactly those versions.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::{Expect, Origin};

use crate::candidates::{Found, find};
use crate::evaluate::{Mode, Status};
use crate::fail;
use crate::records::{self, Consent, Consented};
use crate::settings::Call;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    candidate: String,
    content_hash: String,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match promote(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// The hex of a hash as `memory-show` or `curator-candidates` printed it: `sha256:` and 16 to 64
/// lowercase hex digits, or the hex alone.
fn hash_hex(text: &str) -> Option<&str> {
    let hex = text.strip_prefix("sha256:").unwrap_or(text);
    ((16..=64).contains(&hex.len()) && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .then_some(hex)
}

fn promote(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match curator-promote's schema"))?;
    if !umbel_okf::draft::is_candidate_id(&input.candidate) {
        return Err(fail::invalid("candidate is c- and 20 hex digits"));
    }
    let Some(hex) = hash_hex(&input.content_hash) else {
        return Err(fail::invalid(
            "contentHash is the value curator-candidates or memory-show printed, at least its first 16 hex digits",
        ));
    };
    let call = Call::open(cx)?;
    // The host's own terminal check, as before memory-confirm (D88): `require-human` has the
    // prompt answered at a terminal, and this also withholds the person from a caller the host
    // takes for an agent (an agent's environment variable, `--yes`, `@-`).
    if !cx.call().person {
        return Err(fail::promote_not_allowed(
            "not-a-person",
            "only a person at a terminal widens their own records",
        ));
    }
    let Found { evaluation, .. } = find(cx, &call)?;
    let Some(candidate) = evaluation
        .candidates
        .iter()
        .find(|c| c.id == input.candidate)
    else {
        if evaluation.recorded.iter().any(|s| s.id == input.candidate) {
            return Err(fail::promote_not_allowed(
                "status",
                "a run already drafted or decided it",
            ));
        }
        return Err(fail::candidate_not_found());
    };
    // Own records only (D88's rule for memory-confirm): every source, before anything about the
    // content is compared, so nothing is learned of another person's records.
    if !candidate.own || candidate.source_count != candidate.sources.len() {
        return Err(fail::promote_not_allowed(
            "not-own",
            "a source is another principal's record; only the owner of every source may widen it",
        ));
    }
    let actual = candidate
        .content_hash
        .strip_prefix("sha256:")
        .unwrap_or(&candidate.content_hash);
    if !actual.starts_with(hex) {
        return Err(fail::promote_not_allowed(
            "content-hash",
            "the contentHash does not match the candidate's records; they may have changed since you read them",
        ));
    }
    let consent_id = records::consent_id(&candidate.id);
    let stored = records::consent(cx, &call.space, &call.principal, &candidate.id)?;
    let created = match (candidate.status, &candidate.mode) {
        (Status::NeedsPromotion, _) => true,
        // Already consented to exactly these sources: nothing to write.
        (Status::Ready, Some(Mode::Promoted { .. })) => false,
        (status, _) => {
            return Err(fail::promote_not_allowed(
                "status",
                "only a candidate listed as needs-promotion is promoted",
            )
            .with_error_details(json!({ "reason": "status", "status": status.as_str() })));
        }
    };
    if created {
        let consent = Consent {
            id: consent_id.clone(),
            by: call.principal.clone(),
            at: call.now,
            sources: candidate
                .sources
                .iter()
                .map(|s| Consented {
                    id: s.id.clone(),
                    record_version: s.record_version,
                    content_hash: s.content_hash.as_str().to_owned(),
                })
                .collect(),
        };
        let body = records::consent_body(&consent, &call.space, &call.principal);
        let envelope = records::envelope(
            &call.space,
            call.now,
            Origin::UserStated,
            vec![format!("principal:{}", call.principal)],
            candidate.sensitivity,
        );
        // A consent to earlier versions is replaced: the person looked at these.
        let expect = stored.as_ref().map_or(Expect::Absent, |(_, record)| {
            Expect::Hash(record.content_hash.clone())
        });
        match cx.record_put(
            &call.space,
            records::CONSENT,
            &consent_id,
            body,
            envelope,
            expect,
        ) {
            Ok(_) => {}
            Err(HostError::Conflict { .. }) => {
                return Err(umbel_sdk::failure(
                    "CURATOR_CONFLICT",
                    "the consent record changed while it was written",
                    "Run curator-promote again.",
                )
                .with_retryable(true));
            }
            Err(error) => return Err(fail::host(&error)),
        }
    }
    Ok(success(json!({
        "candidate": candidate.id,
        "consent": consent_id,
        "created": created,
        "sources": candidate.sources.len(),
        "doc": candidate.doc,
        "readers": call.target.access,
        "mode": "promoted",
    }))
    .with_reasoning(
        "The consent lists each source at its version; the next curator run drafts the candidate as a promotion, and a person still approves it.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_at_least_sixteen_lowercase_hex_digits() {
        assert_eq!(
            hash_hex("sha256:0123456789abcdef"),
            Some("0123456789abcdef")
        );
        assert_eq!(hash_hex("0123456789abcdef01"), Some("0123456789abcdef01"));
        assert_eq!(hash_hex("sha256:0123456789abcde"), None);
        assert_eq!(hash_hex("sha256:0123456789ABCDEF"), None);
        assert_eq!(hash_hex(&"a".repeat(65)), None);
    }
}
