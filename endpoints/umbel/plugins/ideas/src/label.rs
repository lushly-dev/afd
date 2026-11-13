//! The host's label passed through (specification, section 4.6). Every wording a command returns
//! carries it unchanged, as `standing` (with `unverified` spelled `seed`) and as `label` (the
//! host's `dev.umbel/standing` object, `StandingLabel::to_json`, byte for byte). The plugin never
//! computes standing.

use serde_json::{Value, json};
use umbel_store::lane::{LaneRecord, Standing, StandingLabel};

use crate::records::Wording;

/// The plugin's spelling of a standing.
pub(crate) fn standing_name(standing: Standing) -> &'static str {
    match standing {
        Standing::Unverified => "seed",
        Standing::Attested => "attested",
        Standing::Affirmed => "affirmed",
    }
}

/// The host's standing of a plugin spelling, for a filter.
pub(crate) fn standing_of(name: &str) -> Option<Standing> {
    match name {
        "seed" => Some(Standing::Unverified),
        "affirmed" => Some(Standing::Affirmed),
        _ => None,
    }
}

/// `standing` and `label` of an optional label: a wording always has one.
pub(crate) fn pass(label: Option<&StandingLabel>) -> (Value, Value) {
    match label {
        Some(label) => (json!(standing_name(label.standing)), label.to_json()),
        None => (Value::Null, Value::Null),
    }
}

/// A wording as every read shows it: `{ id, version, statement, type, tags, said, standing,
/// label, flags }`, `id` the idea's.
pub(crate) fn wording_view(record: &LaneRecord) -> Option<Value> {
    let wording = Wording::parse(&record.record.body)?;
    let (standing, label) = pass(record.label.as_ref());
    Some(json!({
        "id": wording.idea,
        "version": wording.n,
        "statement": wording.statement,
        "type": wording.kind,
        "tags": wording.tags,
        "said": wording.said,
        "standing": standing,
        "label": label,
        "flags": crate::fail::flag_names(&record.flags),
    }))
}
