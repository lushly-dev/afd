//! Parts and the digest (specification, section 8.3).
//!
//! A part is a group: the review's staged proposals with one `group` value, in the order
//! `duplicate`, `reword`, `affirm`, `decline`, `undo`, then by idea id (or target id). Parts are
//! ordered by group name; `"*"` is the whole review, its parts in order.
//!
//! The digest of a part is `sha256:` of the canonical JSON of `[proposal id, content hash]` for
//! each proposal in order, then `[idea id, state, held n]` for every idea a proposal names, by
//! id. A proposal staged, replaced or unstaged, or an idea folded, declined or reworded, changes
//! it; a sighting, or a proposal staged in another review, does not.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::{ContentHash, canonical_json};

use super::{Stored, by_decide, rank};
use crate::records::read_idea;
use crate::{Call, fail};

/// The whole review as one part.
pub(crate) const WHOLE: &str = "*";

/// One part: its group and its proposals in order.
#[derive(Debug, Clone)]
pub(crate) struct Part {
    pub(crate) name: String,
    pub(crate) items: Vec<Stored>,
}

/// The ideas a digest reads, each read once a call: `(state, held)`, `None` when unreadable.
#[derive(Debug, Default)]
pub(crate) struct Ideas(BTreeMap<String, Option<(String, u64)>>);

impl Ideas {
    fn get(&mut self, cx: &Cx, call: &Call, id: &str) -> Result<Value, HostError> {
        if !self.0.contains_key(id) {
            let found =
                read_idea(cx, call, id)?.map(|stored| (stored.idea.state, stored.idea.held));
            self.0.insert(id.to_owned(), found);
        }
        Ok(match &self.0[id] {
            Some((state, held)) => json!([id, state, held]),
            None => json!([id, null, null]),
        })
    }
}

/// A review's staged proposals as parts, in order.
pub(crate) fn split(staged: Vec<Stored>) -> Vec<Part> {
    let mut groups: BTreeMap<String, Vec<Stored>> = BTreeMap::new();
    for stored in staged {
        groups
            .entry(stored.proposal.group.clone())
            .or_default()
            .push(stored);
    }
    groups
        .into_iter()
        .map(|(name, mut items)| {
            items.sort_by(|a, b| {
                (
                    rank(&a.proposal.decide),
                    a.proposal.subject(),
                    &a.proposal.id,
                )
                    .cmp(&(
                        rank(&b.proposal.decide),
                        b.proposal.subject(),
                        &b.proposal.id,
                    ))
            });
            Part { name, items }
        })
        .collect()
}

/// The proposals of a part by name, `"*"` for all of them; empty for a group with none staged.
pub(crate) fn select<'a>(parts: &'a [Part], name: &str) -> Vec<&'a Stored> {
    parts
        .iter()
        .filter(|part| name == WHOLE || part.name == name)
        .flat_map(|part| part.items.iter())
        .collect()
}

/// The digest of `items` in order.
pub(crate) fn digest(
    cx: &Cx,
    call: &Call,
    items: &[&Stored],
    ideas: &mut Ideas,
) -> Result<String, HostError> {
    let mut entries: Vec<Value> = items
        .iter()
        .map(|stored| json!([stored.proposal.id, stored.hash.as_str()]))
        .collect();
    let named: BTreeSet<&str> = items
        .iter()
        .flat_map(|stored| {
            [
                stored.proposal.idea.as_deref(),
                stored.proposal.keep.as_deref(),
            ]
        })
        .flatten()
        .collect();
    for id in named {
        entries.push(ideas.get(cx, call, id)?);
    }
    Ok(
        ContentHash::of(canonical_json(&Value::from(entries)).as_bytes())
            .as_str()
            .to_owned(),
    )
}

/// Each part as staging and showing list it: `{ part, count, digest }`, with `counts` when
/// `counts` is set; and the digest of the whole.
pub(crate) fn listed(
    cx: &Cx,
    call: &Call,
    parts: &[Part],
    counts: bool,
    ideas: &mut Ideas,
) -> Result<(Vec<Value>, String), HostError> {
    let mut listed = Vec::with_capacity(parts.len());
    for part in parts {
        let items: Vec<&Stored> = part.items.iter().collect();
        let mut entry = json!({
            "part": part.name,
            "count": items.len(),
            "digest": digest(cx, call, &items, ideas)?,
        });
        if counts {
            entry["counts"] = by_decide(items.iter().map(|s| s.proposal.decide.as_str()));
        }
        listed.push(entry);
    }
    let whole = digest(cx, call, &select(parts, WHOLE), ideas)?;
    Ok((listed, whole))
}

/// Check a part's name: a group (`[a-z0-9-]`, 1 to 64) or `"*"`.
pub(crate) fn check_part(field: &str, part: &str) -> Result<(), Outcome> {
    if part == WHOLE || is_group(part) {
        Ok(())
    } else {
        Err(fail::invalid(
            field,
            "must be a group (1 to 64 of a-z, 0-9 and -) or \"*\" for the whole review",
        ))
    }
}

/// Whether `group` is 1 to 64 characters of `[a-z0-9-]`.
pub(crate) fn is_group(group: &str) -> bool {
    (1..=64).contains(&group.len())
        && group
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A part read for a decision: the review's staged proposals, the part's own in order, and the
/// digest recomputed. `CONFLICT` when it is not `digest`; `QUOTA_EXCEEDED` for `"*"` past
/// `part_max`.
pub(crate) fn confirmed(
    cx: &Cx,
    call: &Call,
    review: &str,
    part: &str,
    digest_given: &str,
    part_max: u64,
) -> Result<Vec<Stored>, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let readable = crate::ids::is_id(review, crate::records::REVIEW_PREFIX)
        && super::read_review(cx, call, review)
            .map_err(host)?
            .is_some();
    if !readable {
        return Err(fail::review_not_found(Some(review)));
    }
    let staged = super::in_review(cx, call, review, &["staged"]).map_err(host)?;
    let parts = split(staged);
    let items: Vec<Stored> = select(&parts, part).into_iter().cloned().collect();
    if part == WHOLE && items.len() as u64 > part_max {
        return Err(fail::whole_too_large(items.len(), part_max));
    }
    let refs: Vec<&Stored> = items.iter().collect();
    let found = digest(cx, call, &refs, &mut Ideas::default()).map_err(host)?;
    if found != digest_given {
        return Err(fail::part_changed());
    }
    Ok(items)
}
