//! The two counts every read returns (specification, section 7): proposals staged in open
//! reviews, and held wordings that are seeds, from two finds with `limit = 1` and `total = true`.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError};
use umbel_store::lane::{FindOrder, KeyFilter, Pointer, RecordFind, Standing};

use crate::Call;
use crate::records::{PROPOSAL, WORDING};

/// A key filter on `pointer` with these values.
pub(crate) fn key(pointer: &str, any: &[&str]) -> KeyFilter {
    KeyFilter {
        // Every pointer named here is one the manifest declares, so it parses.
        key: Pointer::parse(pointer).unwrap_or_else(|_| unreachable_pointer()),
        any: any.iter().map(|value| (*value).to_owned()).collect(),
    }
}

#[allow(clippy::panic)]
fn unreachable_pointer() -> Pointer {
    panic!("a declared key pointer did not parse")
}

/// How many records of `kind` pass `keys` and `standings`.
pub(crate) fn count(
    cx: &Cx,
    call: &Call,
    kind: &str,
    keys: Vec<KeyFilter>,
    standings: Vec<Standing>,
) -> Result<u64, HostError> {
    let page = cx.record_find(
        &call.space,
        &RecordFind {
            kind: kind.to_owned(),
            keys,
            standings,
            verified_only: false,
            text: None,
            order: FindOrder::Id,
            after: None,
            limit: 1,
            total: true,
        },
    )?;
    Ok(page.total.unwrap_or(page.items.len() as u64))
}

/// `{ "staged", "unreviewed" }`.
pub(crate) fn pending(cx: &Cx, call: &Call) -> Result<Value, HostError> {
    let staged = count(
        cx,
        call,
        PROPOSAL,
        vec![key("/state", &["staged"])],
        Vec::new(),
    )?;
    let unreviewed = count(
        cx,
        call,
        WORDING,
        vec![key("/role", &["held"])],
        vec![Standing::Unverified],
    )?;
    Ok(json!({ "staged": staged, "unreviewed": unreviewed }))
}
