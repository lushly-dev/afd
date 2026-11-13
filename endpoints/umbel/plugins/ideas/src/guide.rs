//! `ideas-guide` (specification, section 7.6): how the store works, in one call.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::lane::{FindOrder, RecordFind, Standing};

use crate::pack::Pack;
use crate::pending::{count, key, pending};
use crate::records::{PROPOSAL, REVIEW, WORDING};
use crate::{Call, fail};

/// Section 11.2's paragraph without AFD's sentences, then how to review in five lines.
pub(crate) const START: &str = "This instance keeps the person's ideas. When they share a view, a claim or a question they want kept, save it with ideas-capture, not memory; facts about the person and how to work with them go to memory-remember. When they ask what they think, or want something written in their voice, call ideas-ask and use only the ideas that bear on the question. Ideas the person has not affirmed are marked seed; say so when you rely on one. To review, stage proposals with ideas-review-stage and give the person the page address ideas-review-apply returns.\n\
To review:\n\
1. Match held seeds against each other with ideas-match and ids, and read the candidates and bands.\n\
2. Stage proposals with ideas-review-stage, in groups, each with a one-line reason and honest confidence: affirm what the person said, decline what says nothing, reword what is two ideas or unclear, fold a duplicate into the better wording.\n\
3. Tell the person what waits, and call ideas-review-apply with part \"*\" and the digest ideas-review-show gives. At a terminal a part's preview must fit 6000 characters, some 25 decisions: confirm a group of that size there.\n\
4. Give the person the page address the refusal holds; once they confirm, send the same call again.\n\
5. When the person says a decision was wrong, stage an undo of it.";

/// The most open reviews shown.
const REVIEWS: u32 = 50;
/// The most staged proposals of one review read to count its parts.
const PART_SCAN: u32 = 200;

/// The open reviews: id, name, staged and parts.
fn reviews(cx: &Cx, call: &Call) -> Result<Vec<Value>, HostError> {
    let open = cx.record_find(
        &call.space,
        &RecordFind {
            kind: REVIEW.to_owned(),
            keys: vec![key("/state", &["open"])],
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Recent,
            after: None,
            limit: REVIEWS,
            total: false,
        },
    )?;
    let mut out = Vec::new();
    for review in &open.items {
        let id = review.record.id.clone();
        let mut groups = BTreeSet::new();
        let mut after = None;
        let mut staged = 0u64;
        loop {
            let page = cx.record_find(
                &call.space,
                &RecordFind {
                    kind: PROPOSAL.to_owned(),
                    keys: vec![key("/review", &[id.as_str()]), key("/state", &["staged"])],
                    standings: Vec::new(),
                    verified_only: false,
                    text: None,
                    order: FindOrder::Id,
                    after: after.clone(),
                    limit: PART_SCAN,
                    total: false,
                },
            )?;
            for proposal in &page.items {
                staged += 1;
                if let Some(group) = proposal.record.body.get("group").and_then(Value::as_str) {
                    groups.insert(group.to_owned());
                }
            }
            match page.next {
                Some(next) if !page.items.is_empty() => after = Some(next),
                _ => break,
            }
        }
        out.push(json!({
            "id": id,
            "name": review.record.body.get("name").cloned().unwrap_or(Value::Null),
            "staged": staged,
            "parts": groups.len(),
        }));
    }
    Ok(out)
}

/// `ideas-guide`.
pub(crate) fn run(cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let host = |error: HostError| fail::host(&error);
    let held = || vec![key("/role", &["held"])];
    let totals = json!({
        "ideas": count(cx, call, WORDING, held(), Vec::new()).map_err(host)?,
        "seeds": count(cx, call, WORDING, held(), vec![Standing::Unverified]).map_err(host)?,
        "affirmed": count(cx, call, WORDING, held(), vec![Standing::Affirmed]).map_err(host)?,
        "declined": count(cx, call, WORDING, vec![key("/role", &["declined"])], Vec::new()).map_err(host)?,
    });
    let types: Vec<Value> = pack
        .types
        .iter()
        .map(|t| json!({ "name": t.name, "means": t.means }))
        .collect();
    let reviews = reviews(cx, call).map_err(host)?;
    let pending = pending(cx, call).map_err(host)?;
    Ok(success(json!({
        "start": START,
        "types": types,
        "standings": ["seed", "affirmed"],
        "attested": "not served in version 1: an idea stands only by the person's affirmation",
        "said": ["person", "agent", "unknown"],
        "bands": pack.bands_json(),
        "limits": pack.limits_json(),
        "totals": totals,
        "reviews": reviews,
        "confirmAt": {
            "page": Value::Null,
            "terminal": "umbel ideas-review-apply --review <id> --part <group> --digest <digest>",
        },
        "pending": pending,
    })))
}
