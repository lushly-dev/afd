//! `ideas-export` and `ideas-import` (specification, section 10, D179).
//!
//! The export reads every record of the four kinds in a fixed order (ideas by id, then wordings,
//! reviews and proposals) and answers them in pages; the last page holds a manifest whose digest
//! is over the canonical JSON of every item's `[kind, id, body, affirmed != null]`, with the body's
//! `restored` member left out. The import puts each item with `Expect::Absent`, never overwrites,
//! and affirms again, inside its own gated call, every wording the archive marks affirmed.

use serde_json::{Map, Value, json};
use umbel_sdk::{Cx, HostError, Level, Outcome, success};
use umbel_store::lane::{Decision, FindOrder, LaneRecord, MAX_FIND_LIMIT, RecordFind};
use umbel_store::{ContentHash, Origin, canonical_json};

use crate::capture::{MAX_TAGS, is_tag, statement_ok};
use crate::pack::Pack;
use crate::pending::pending;
use crate::records::{
    IDEA, IDEA_PREFIX, Idea, MAX_WORDINGS, PROPOSAL, PROPOSAL_PREFIX, REVIEW, REVIEW_PREFIX,
    SEEN_MAX, WORDING, Wording, origin_of, put_absent, read,
};
use crate::{Call, budget, fail, ids, input};

/// The kinds, in the archive's order.
const KINDS: [&str; 4] = [IDEA, WORDING, REVIEW, PROPOSAL];
/// The archive's format.
const FORMAT: &str = "ideas-archive/1";
/// Items a page: default and most.
const DEFAULT_LIMIT: u64 = 500;
const MAX_LIMIT: u64 = 1000;
/// The most ids `differs` lists.
const DIFFERS_MAX: usize = 100;

/// `{ "at", "level" }` of an affirmed wording's label, else `null`.
fn affirmed(record: &LaneRecord) -> Value {
    record
        .label
        .as_ref()
        .and_then(|label| label.affirmed.as_ref())
        .map_or(
            Value::Null,
            |affirmed| json!({ "at": affirmed.at, "level": affirmed.level }),
        )
}

/// An item of the archive.
fn item(kind: &str, record: &LaneRecord) -> Value {
    json!({
        "kind": kind,
        "id": record.record.id,
        "body": record.record.body,
        "affirmed": affirmed(record),
    })
}

/// `body` without its `restored` member.
fn without_restored(body: &Value) -> Value {
    let mut body = body.clone();
    if let Some(map) = body.as_object_mut() {
        map.remove("restored");
    }
    body
}

/// A body as an import writes it (amendment C3-10): a proposal loses its `effect`, and a staged
/// one becomes `unstaged`, so nothing an archive says about a past decision can be undone or
/// applied again, and nothing it stages skips the scan, the caps or another review's claim.
/// The manifest's digest is taken over the same form, so an archive still restores to its own.
fn as_imported(kind: &str, body: &Value) -> Value {
    let mut body = body.clone();
    if kind == PROPOSAL
        && let Some(map) = body.as_object_mut()
    {
        map.insert("effect".to_owned(), Value::Null);
        if map.get("state").and_then(Value::as_str) == Some("staged") {
            map.insert("state".to_owned(), json!("unstaged"));
        }
    }
    body
}

/// One page of a kind, by id.
fn page_of(
    cx: &Cx,
    call: &Call,
    kind: &str,
    after: Option<String>,
    limit: u32,
) -> Result<umbel_store::lane::FindPage, HostError> {
    cx.record_find(
        &call.space,
        &RecordFind {
            kind: kind.to_owned(),
            keys: Vec::new(),
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Id,
            after,
            limit,
            total: false,
        },
    )
}

/// The counts and digest of everything the caller may read, in the archive's order.
fn manifest(cx: &Cx, call: &Call) -> Result<Value, HostError> {
    let mut entries = Vec::new();
    let mut counts = Map::new();
    let mut affirmed_count = 0u64;
    for kind in KINDS {
        let mut after = None;
        let mut count = 0u64;
        loop {
            let page = page_of(cx, call, kind, after.clone(), MAX_FIND_LIMIT)?;
            for record in &page.items {
                let is_affirmed = !affirmed(record).is_null();
                if is_affirmed {
                    affirmed_count += 1;
                }
                count += 1;
                entries.push(json!([
                    kind,
                    record.record.id,
                    without_restored(&as_imported(kind, &record.record.body)),
                    is_affirmed
                ]));
            }
            match page.next {
                Some(next) if !page.items.is_empty() => after = Some(next),
                _ => break,
            }
        }
        counts.insert(kind.to_owned(), json!(count));
    }
    counts.insert("affirmed".to_owned(), json!(affirmed_count));
    let digest = ContentHash::of(canonical_json(&Value::from(entries)).as_bytes());
    Ok(json!({
        "format": FORMAT,
        "counts": counts,
        "digest": digest.as_str(),
    }))
}

/// The export's cursor: the kind's index and the host's cursor within it.
fn parse_cursor(after: &str) -> Option<(usize, Option<String>)> {
    let (kind, rest) = after.split_once(':')?;
    let kind: usize = kind.parse().ok()?;
    if kind >= KINDS.len() {
        return None;
    }
    Some((kind, (!rest.is_empty()).then(|| rest.to_owned())))
}

/// `ideas-export`.
pub(crate) fn export(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let host = |error: HostError| fail::host(&error);
    let limit = input::integer(input, "limit", 1, MAX_LIMIT)?.unwrap_or(DEFAULT_LIMIT);
    let start = match input::string(input, "after")? {
        Some(cursor) => parse_cursor(cursor)
            .ok_or_else(|| fail::invalid("after", "is not a cursor ideas-export gave"))?,
        None => (0, None),
    };
    let (mut items, mut next) = fill(cx, call, start.clone(), limit).map_err(host)?;
    let pending = pending(cx, call).map_err(host)?;
    let manifest = match &next {
        Some(_) => None,
        None => Some(manifest(cx, call).map_err(host)?),
    };
    let build = |items: &[Value], next: Option<&str>, manifest: Option<&Value>| {
        let mut data = json!({ "items": items });
        match (next, manifest) {
            (Some(next), _) => data["next"] = json!(next),
            (None, Some(manifest)) => data["manifest"] = manifest.clone(),
            (None, None) => {}
        }
        data["pending"] = pending.clone();
        success(data)
    };
    let total = items.len();
    let (kept, fitted) = budget::fit_count(total, cx.call().output_budget, |kept| {
        if kept == total {
            build(&items, next.as_deref(), manifest.as_ref())
        } else {
            // A shortened page has a next page instead of the manifest.
            budget::limited(build(&items[..kept], Some(""), None), total - kept, "items")
        }
    });
    let mut outcome = fitted;
    if kept < total && kept > 0 {
        // The page again with the limit that fits, for the cursor after its last item.
        (items, next) = fill(cx, call, start, kept as u64).map_err(host)?;
        outcome = budget::limited(
            build(&items, next.as_deref(), None),
            total - items.len(),
            "items",
        );
    }
    cx.log(
        Level::Info,
        &format!(
            "ideas-export: {} item(s), last page {}",
            items.len(),
            next.is_none()
        ),
    );
    Ok(outcome)
}

/// Up to `limit` items from `start`, and the cursor after them; `None` when nothing is left.
fn fill(
    cx: &Cx,
    call: &Call,
    start: (usize, Option<String>),
    limit: u64,
) -> Result<(Vec<Value>, Option<String>), HostError> {
    let (mut kind, mut after) = start;
    let mut items = Vec::new();
    while (items.len() as u64) < limit && kind < KINDS.len() {
        let room = (limit - items.len() as u64).min(u64::from(MAX_FIND_LIMIT));
        let page = page_of(cx, call, KINDS[kind], after.clone(), room as u32)?;
        items.extend(page.items.iter().map(|record| item(KINDS[kind], record)));
        match page.next {
            Some(next) if !page.items.is_empty() => after = Some(next),
            _ => {
                kind += 1;
                after = None;
            }
        }
    }
    let next = (kind < KINDS.len()).then(|| format!("{kind}:{}", after.as_deref().unwrap_or("")));
    Ok((items, next))
}

/// A checked archive item.
struct Item {
    kind: &'static str,
    id: String,
    body: Value,
    affirmed: Option<(String, String)>,
}

fn check_item(index: usize, value: &Value, pack: &Pack) -> Result<Item, Outcome> {
    let bad = |field: &str, rule: &str| fail::invalid_item("items", index, field, rule);
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .and_then(|kind| KINDS.iter().find(|k| **k == kind).copied())
        .ok_or_else(|| bad("kind", "must be idea, wording, review or proposal"))?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
        .ok_or_else(|| bad("id", "must be a record id"))?
        .to_owned();
    let body = value
        .get("body")
        .filter(|body| body.is_object())
        .cloned()
        .ok_or_else(|| bad("body", "must be an object"))?;
    let shaped = match kind {
        IDEA => idea_shaped(&id, &body),
        WORDING => wording_shaped(&id, &body, pack),
        REVIEW => {
            ids::is_id(&id, REVIEW_PREFIX)
                && body.get("id").and_then(Value::as_str) == Some(id.as_str())
                && matches!(
                    body.get("state").and_then(Value::as_str),
                    Some("open" | "closed")
                )
                && body
                    .get("by")
                    .and_then(Value::as_str)
                    .is_some_and(|by| !by.is_empty())
        }
        _ => {
            ids::is_id(&id, PROPOSAL_PREFIX)
                && body.get("id").and_then(Value::as_str) == Some(id.as_str())
                && body
                    .get("review")
                    .and_then(Value::as_str)
                    .is_some_and(|review| ids::is_id(review, REVIEW_PREFIX))
                && matches!(
                    body.get("state").and_then(Value::as_str),
                    Some("staged" | "unstaged" | "applied" | "pulled" | "skipped" | "undone")
                )
                && matches!(
                    body.get("decide").and_then(Value::as_str),
                    Some("affirm" | "decline" | "reword" | "duplicate" | "undo")
                )
        }
    };
    if !shaped {
        return Err(bad("body", "is not a body of its kind with this id"));
    }
    let affirmed = match value.get("affirmed") {
        None | Some(Value::Null) => None,
        Some(found) => {
            let at = found.get("at").and_then(Value::as_str);
            let level = found.get("level").and_then(Value::as_str);
            match (at, level, kind) {
                (Some(at), Some(level), WORDING) => Some((at.to_owned(), level.to_owned())),
                _ => {
                    return Err(bad(
                        "affirmed",
                        "must be null, or { at, level } on a wording",
                    ));
                }
            }
        }
    };
    Ok(Item {
        kind,
        id,
        body,
        affirmed,
    })
}

/// An idea's body under 4.2: its id, state, counts within their caps, and the ids it names.
fn idea_shaped(id: &str, body: &Value) -> bool {
    let Some(idea) = Idea::parse(body) else {
        return false;
    };
    ids::is_id(id, IDEA_PREFIX)
        && idea.id == id
        && matches!(idea.state.as_str(), "live" | "declined" | "folded")
        && idea.held >= 1
        && idea.wordings >= idea.held
        && idea.wordings <= MAX_WORDINGS
        && idea.sightings >= 1
        && idea.seen.len() <= SEEN_MAX
        && idea
            .into
            .as_deref()
            .is_none_or(|into| ids::is_id(into, IDEA_PREFIX))
        && idea
            .staged
            .as_deref()
            .is_none_or(|staged| ids::is_id(staged, PROPOSAL_PREFIX))
}

/// A wording's body under 4.1: `<idea id>.<n>`, the statement rule, a type of the pack, the tag
/// rule, and the role and `said` enums.
fn wording_shaped(id: &str, body: &Value, pack: &Pack) -> bool {
    let Some(wording) = Wording::parse(body) else {
        return false;
    };
    let mut sorted = wording.tags.clone();
    sorted.sort();
    sorted.dedup();
    ids::is_id(&wording.idea, IDEA_PREFIX)
        && wording.n >= 1
        && wording.n <= MAX_WORDINGS
        && crate::records::wording_id(&wording.idea, wording.n) == id
        && statement_ok(&wording.statement, pack)
        && pack.has_type(&wording.kind)
        && sorted == wording.tags
        && wording.tags.len() <= MAX_TAGS
        && wording.tags.iter().all(|tag| is_tag(tag))
        && matches!(
            wording.role.as_str(),
            "held" | "superseded" | "declined" | "folded" | "withdrawn"
        )
        && matches!(wording.said.as_str(), "person" | "agent" | "unknown")
        && body.get("said").and_then(Value::as_str).is_some()
        && wording
            .proposal
            .as_deref()
            .is_none_or(|proposal| ids::is_id(proposal, PROPOSAL_PREFIX))
}

fn counts() -> Map<String, Value> {
    KINDS.iter().map(|k| ((*k).to_owned(), json!(0))).collect()
}

fn bump(map: &mut Map<String, Value>, kind: &str) {
    let n = map.get(kind).and_then(Value::as_u64).unwrap_or(0);
    map.insert(kind.to_owned(), json!(n + 1));
}

/// `ideas-import`.
pub(crate) fn import(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let host = |error: HostError| fail::host(&error);
    let Some(list) = input.get("items").and_then(Value::as_array) else {
        return Err(fail::invalid("items", "must be an array of archive items"));
    };
    if list.is_empty() || list.len() as u64 > MAX_LIMIT {
        return Err(fail::invalid("items", "must hold 1 to 1000 items"));
    }
    let items = list
        .iter()
        .enumerate()
        .map(|(index, value)| check_item(index, value, &pack))
        .collect::<Result<Vec<_>, _>>()?;
    let given = match input.get("manifest") {
        None | Some(Value::Null) => None,
        Some(manifest) => Some(
            manifest
                .get("digest")
                .and_then(Value::as_str)
                .filter(|_| manifest.get("format").and_then(Value::as_str) == Some(FORMAT))
                .ok_or_else(|| {
                    fail::invalid(
                        "manifest",
                        "must be an ideas-archive/1 manifest with a digest",
                    )
                })?
                .to_owned(),
        ),
    };
    let verify = input::boolean(input, "verify")?.unwrap_or(true);
    let observed_at = crate::records::now(cx)?;

    let (mut added, mut same) = (counts(), counts());
    let mut differs: Vec<String> = Vec::new();
    let mut differs_count = 0u64;
    let mut affirmed = 0u64;
    let mut unaffirmed: Vec<String> = Vec::new();
    let mut unaffirmed_count = 0u64;
    for item in &items {
        let mut body = as_imported(item.kind, &item.body);
        let wanted = without_restored(&body);
        if let (Some((at, level)), Some(map)) = (&item.affirmed, body.as_object_mut())
            && !map.contains_key("restored")
        {
            map.insert(
                "restored".to_owned(),
                json!({ "affirmedAt": at, "level": level }),
            );
        }
        // What only an import writes: the archive's affirmation, kept in the body it puts.
        let restored = body.get("restored").cloned();
        let origin = if item.kind == WORDING {
            origin_of(
                body.get("said")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
            )
        } else {
            Origin::UserStated
        };
        let wrote =
            put_absent(cx, call, item.kind, &item.id, body, origin, &observed_at).map_err(host)?;
        // An existing wording is affirmed only when an import wrote it with this affirmation:
        // a run of this import that a refusal stopped. A seed the import did not write, or one
        // that differs, is never affirmed by an archive's say-so (section 13).
        let mut ours = wrote;
        if wrote {
            bump(&mut added, item.kind);
        } else {
            let existing = read(cx, call, item.kind, &item.id).map_err(host)?;
            ours = item.affirmed.is_some()
                && existing.as_ref().is_some_and(|existing| {
                    existing.record.body.get("restored").cloned() == restored
                        && without_restored(&existing.record.body) == wanted
                });
            if existing.is_some_and(|existing| {
                without_restored(&as_imported(item.kind, &existing.record.body)) == wanted
            }) {
                bump(&mut same, item.kind);
            } else {
                differs_count += 1;
                if differs.len() < DIFFERS_MAX {
                    differs.push(item.id.clone());
                }
            }
        }
        if item.affirmed.is_some() {
            if ours {
                cx.record_decide(&call.space, WORDING, &item.id, Decision::Affirm)
                    .map_err(host)?;
                affirmed += 1;
            } else {
                unaffirmed_count += 1;
                if unaffirmed.len() < DIFFERS_MAX {
                    unaffirmed.push(item.id.clone());
                }
            }
        }
    }
    let matches = match (&given, verify) {
        (Some(digest), true) => {
            let ours = manifest(cx, call).map_err(host)?;
            json!(ours["digest"].as_str() == Some(digest.as_str()))
        }
        _ => Value::Null,
    };
    cx.log(
        Level::Info,
        &format!(
            "ideas-import: {} item(s), {differs_count} differ, {affirmed} affirmed",
            items.len()
        ),
    );
    let pending = pending(cx, call).map_err(host)?;
    Ok(success(json!({
        "added": added,
        "same": same,
        "differs": { "ids": differs, "count": differs_count },
        "affirmed": affirmed,
        "unaffirmed": { "ids": unaffirmed, "count": unaffirmed_count },
        "matches": matches,
        "pending": pending,
    })))
}
