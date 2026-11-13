//! `ideas-review-unstage` (specification, section 8.2): take proposals out of a review before
//! the person confirms it, or all of them. Each named staged proposal becomes `unstaged`, keeping
//! its label; the idea stays as it was and can be proposed again. A review with nothing staged
//! left is closed, as an applied one is.
//!
//! Unstaging is idempotent by itself: a proposal already out stays out, so a call sent again
//! with its `idempotencyKey` writes nothing and answers the same counts.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Level, Outcome, success};
use umbel_store::Origin;

use super::parts::{Ideas, listed, split};
use super::{close_if_empty, in_review, named_or_newest, read_proposal, write_proposal};
use crate::pending::pending;
use crate::records::{PROPOSAL_PREFIX, now};
use crate::{Call, fail, ids, input};

/// The most proposals one call names.
const MAX_NAMED: usize = 2000;

/// `ideas-review-unstage`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let host = |error: HostError| fail::host(&error);
    ids::check_key(input::string(input, "idempotencyKey")?)?;
    let review = named_or_newest(cx, call, input)?.review;
    let all = input::boolean(input, "all")?.unwrap_or(false);
    let named = input::strings(input, "proposals")?;
    let named = match (all, named) {
        (true, None) => None,
        (false, Some(named)) if !named.is_empty() && named.len() <= MAX_NAMED => Some(named),
        _ => {
            return Err(fail::invalid(
                "proposals",
                "must name 1 to 2000 proposals, or be left out with all: true",
            ));
        }
    };
    let observed_at = now(cx)?;
    let staged = in_review(cx, call, &review.id, &["staged"]).map_err(host)?;
    let targets = match &named {
        None => staged,
        Some(named) => {
            let mut seen = BTreeSet::new();
            let mut targets = Vec::new();
            for (index, id) in named.iter().enumerate() {
                if !seen.insert(id.as_str()) {
                    continue;
                }
                if let Some(stored) = staged.iter().find(|s| &s.proposal.id == id) {
                    targets.push(stored.clone());
                    continue;
                }
                // Out already, or not this review's: only the first is accepted.
                let ours = ids::is_id(id, PROPOSAL_PREFIX)
                    && read_proposal(cx, call, id)
                        .map_err(host)?
                        .is_some_and(|stored| stored.proposal.review == review.id);
                if !ours {
                    return Err(fail::invalid_item(
                        "proposals",
                        index,
                        "id",
                        "must name a proposal of this review",
                    ));
                }
            }
            targets
        }
    };
    let mut unstaged = 0u64;
    for stored in &targets {
        let mut proposal = stored.proposal.clone();
        proposal.state = "unstaged".to_owned();
        proposal.decided_at = Some(observed_at.clone());
        match write_proposal(
            cx,
            call,
            stored,
            &proposal,
            Origin::AgentInferred,
            &observed_at,
        ) {
            Ok(_) => unstaged += 1,
            // Changed since it was read: applied or unstaged by another call.
            Err(HostError::Conflict { .. }) => {}
            Err(error) => return Err(host(error)),
        }
    }
    close_if_empty(cx, call, &review.id, &observed_at).map_err(host)?;
    let staged = in_review(cx, call, &review.id, &["staged"]).map_err(host)?;
    let staged_count = staged.len();
    let (parts, whole) =
        listed(cx, call, &split(staged), false, &mut Ideas::read(cx)?).map_err(host)?;
    cx.log(
        Level::Info,
        &format!(
            "ideas-review-unstage: review {}, {unstaged} unstaged, {staged_count} staged",
            review.id
        ),
    );
    let pending = pending(cx, call).map_err(host)?;
    Ok(success(json!({
        "review": review.id,
        "unstaged": unstaged,
        "staged": staged_count,
        "parts": parts,
        "digest": whole,
        "pending": pending,
    })))
}
