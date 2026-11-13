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

use crate::capture::statement_ok;
use crate::pack::Pack;
use crate::pending::pending;
use crate::records::{IDEA, Idea, PROPOSAL, REVIEW, WORDING, Wording, origin_of, put_absent, read};
use crate::{Call, fail, input};

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
                    without_restored(&record.record.body),
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
    let (mut kind, mut after) = match input::string(input, "after")? {
        Some(cursor) => parse_cursor(cursor)
            .ok_or_else(|| fail::invalid("after", "is not a cursor ideas-export gave"))?,
        None => (0, None),
    };
    let mut items = Vec::new();
    while (items.len() as u64) < limit && kind < KINDS.len() {
        let room = (limit - items.len() as u64).min(u64::from(MAX_FIND_LIMIT));
        let page = page_of(cx, call, KINDS[kind], after.clone(), room as u32).map_err(host)?;
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
    let mut data = json!({ "items": items });
    match &next {
        Some(next) => data["next"] = json!(next),
        None => data["manifest"] = manifest(cx, call).map_err(host)?,
    }
    cx.log(
        Level::Info,
        &format!(
            "ideas-export: {} item(s), last page {}",
            items.len(),
            next.is_none()
        ),
    );
    data["pending"] = pending(cx, call).map_err(host)?;
    Ok(success(data))
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
        IDEA => Idea::parse(&body).is_some_and(|idea| idea.id == id),
        WORDING => Wording::parse(&body).is_some_and(|wording| {
            crate::records::wording_id(&wording.idea, wording.n) == id
                && statement_ok(&wording.statement, pack)
        }),
        _ => body.get("id").and_then(Value::as_str) == Some(id.as_str()),
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
    for item in &items {
        let mut body = item.body.clone();
        if let (Some((at, level)), Some(map)) = (&item.affirmed, body.as_object_mut())
            && !map.contains_key("restored")
        {
            map.insert(
                "restored".to_owned(),
                json!({ "affirmedAt": at, "level": level }),
            );
        }
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
        if wrote {
            bump(&mut added, item.kind);
        } else {
            let existing = read(cx, call, item.kind, &item.id).map_err(host)?;
            if existing.is_some_and(|existing| {
                without_restored(&existing.record.body) == without_restored(&item.body)
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
            cx.record_decide(&call.space, WORDING, &item.id, Decision::Affirm)
                .map_err(host)?;
            affirmed += 1;
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
        "matches": matches,
        "pending": pending,
    })))
}
