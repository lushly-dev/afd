//! Proposals and the verification lifecycle (specification section 9, decisions D62, D63 and
//! D17): the knowledge base changes only by proposal. A proposal is a decision trace kept as a
//! record; a person at a terminal approves or rejects it; applying one writes the file through
//! the `content_write` grant and puts the document with the proposal as its lineage.

mod apply;
mod area;
mod common;
mod diff;
mod document;
mod model;
mod propose;
mod review;
mod verify;

use serde_json::Value;
use umbel_sdk::{Cx, Outcome};

/// Run one of the proposal commands, or `None` when `name` is not one.
pub(crate) fn dispatch(name: &str, input: &Value, cx: &mut Cx) -> Option<Outcome> {
    Some(match name {
        "knowledge-propose" => propose::run(input, cx),
        "knowledge-proposal-list" => review::list(input, cx),
        "knowledge-proposal-show" => review::show(input, cx),
        "knowledge-withdraw" => review::withdraw(input, cx),
        "knowledge-approve" => apply::approve(input, cx),
        "knowledge-reject" => apply::reject(input, cx),
        "knowledge-verify" => verify::run(input, cx),
        _ => return None,
    })
}
