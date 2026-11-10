//! A stand-in for the knowledge plugin's half of `curator-run` (D3: the curator crate links no
//! plugin, so its tests bring their own): a compiled plugin with the id `knowledge` whose
//! `knowledge-propose-batch` and `knowledge-proposal-feed` answer in the real commands' shapes
//! (phase 4 step 3b's amendments 2, 9 and 12), so the host registers the curator's pipeline and
//! attests its steps as it will with the real plugin. The real verification is proven against the
//! real plugin in `first-party/tests/curator_run.rs`.
//!
//! It keeps a stub per proposal in its own records, holding ids, the key, the document, the cited
//! memory ids and the state, never the draft's text, so a test can scan the store's bytes for the
//! curator's residue alone. Its proposal ids are `umbel_okf::draft::proposal_id`, as the real
//! plugin's. `knowledge-decide` stands in for a person's approve or reject at a terminal, and
//! `knowledge-stand-in` sets the test's controls: the next redaction's checkpoint `pending`, a
//! failing feed (a run that stops after its batch), and a hook run inside the batch step.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, Plugin, failure, success};
use umbel_store::memory::format_instant;
use umbel_store::{
    ContentHash, ENVELOPE_VERSION, Envelope, Expect, Origin, Sensitivity, canonical_json,
};

const MANIFEST: &str = r#"manifest_version = 4
protocol = 1

[plugin]
id = "knowledge"
title = "Knowledge stand-in"
version = "0.1.0"
description = "The knowledge plugin's batch and feed, in their shapes, for the curator's tests."
kind = "compiled"
domains = ["knowledge"]

[[grants]]
name = "clock"
reason = "Stamps decisions."

[[grants]]
name = "records"
reason = "Reads its proposal stubs."

[[grants]]
name = "records_write"
reason = "Writes its proposal stubs."

[[commands]]
name = "knowledge-propose-batch"
description = "Store drafts and withdrawals as stubs."
effects = ["store-write"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposals = { type = "array" }, withdraw = { type = "array" }, erased = { type = "array" } }, required = ["proposals"], additionalProperties = false }
journal = { mode = "digest", keep = ["space"] }

[[commands]]
name = "knowledge-proposal-feed"
description = "Decisions on the drafter's stubs after a revision."
effects = ["inspect"]
input_schema = { type = "object", properties = { space = { type = "string" }, after = { type = "integer" } }, required = ["after"], additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest", keep = ["space", "after"] }

[[commands]]
name = "knowledge-decide"
description = "A person's decision on a stub."
effects = ["store-write"]
input_schema = { type = "object", properties = { space = { type = "string" }, proposal = { type = "string" }, state = { enum = ["rejected", "applied"] }, reason = { type = "string" } }, required = ["proposal", "state"], additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest", keep = ["space", "proposal"] }

[[commands]]
name = "knowledge-stand-in"
description = "Set the stand-in's test controls."
effects = ["store-write"]
input_schema = { type = "object", properties = { space = { type = "string" }, held = { type = "boolean" }, failFeed = { type = "boolean" }, hook = { type = "string" } }, additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "plain" }
"#;

/// Hooks a test registers by name and the batch runs once, inside the pipeline's submit step.
pub static HOOKS: Mutex<BTreeMap<String, Box<dyn FnOnce() + Send>>> = Mutex::new(BTreeMap::new());

/// The stand-in.
#[derive(Debug, Clone, Copy, Default)]
pub struct StandIn;

const KIND: &str = "proposal";
const META: &str = "meta";

fn envelope(space: &str, now: i64) -> Envelope {
    Envelope {
        version: ENVELOPE_VERSION,
        origin: Origin::AgentInferred,
        space: space.to_owned(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: format_instant(now),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access: vec!["space".into()],
        sensitivity: Some(Sensitivity::Internal),
        redactions: None,
        constraints: None,
        confirmation: None,
        delegation_chain: None,
    }
}

/// The caller's effective principal, as the real plugin derives it.
fn principal(cx: &Cx) -> String {
    let call = cx.call();
    match call.on_behalf_of.as_deref().filter(|p| !p.is_empty()) {
        Some(person) => format!("human:{person}"),
        None => format!(
            "{}:{}",
            call.actor_kind,
            call.actor_id.as_deref().unwrap_or("anonymous")
        ),
    }
}

fn space(cx: &Cx) -> String {
    cx.call().space.clone().unwrap()
}

fn put(cx: &Cx, kind: &str, id: &str, body: Value) {
    let space = space(cx);
    let now = cx.now_ms().unwrap();
    cx.record_put(&space, kind, id, body, envelope(&space, now), Expect::Any)
        .unwrap();
}

fn get(cx: &Cx, kind: &str, id: &str) -> Option<Value> {
    cx.record_get(&space(cx), kind, id)
        .ok()
        .flatten()
        .map(|record| record.body)
}

/// The next revision of the stand-in's own log.
fn bump(cx: &Cx) -> u64 {
    let mut meta = get(cx, META, "rev").unwrap_or_else(|| json!({ "rev": 0, "held": false }));
    let rev = meta["rev"].as_u64().unwrap() + 1;
    meta["rev"] = json!(rev);
    put(cx, META, "rev", meta);
    rev
}

fn stubs(cx: &Cx) -> Vec<Value> {
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let Ok(page) = cx.record_list(&space(cx), KIND, after.as_deref(), 500) else {
            return out;
        };
        out.extend(page.items.into_iter().map(|record| record.body));
        match page.next {
            Some(next) => after = Some(next),
            None => return out,
        }
    }
}

fn summary(stub: &Value) -> Value {
    json!({
        "id": stub["id"], "state": stub["state"], "doc": stub["doc"], "op": stub["op"],
        "changeHash": stub["changeHash"],
    })
}

fn refused(index: usize, code: &str) -> Value {
    json!({ "index": index, "ok": false, "error": { "code": code, "message": code } })
}

fn sources_of(item: &Value) -> Vec<String> {
    item["evidence"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["kind"] == "memory")
        .filter_map(|entry| entry["ref"].as_str())
        .map(|r| r.split('@').next().unwrap().to_owned())
        .collect()
}

/// Redact `stub` in place, withdrawing it first when pending; whether it changed.
fn redact(stub: &mut Value, now: &str) -> bool {
    if stub["redacted"] == true || stub["state"] == "applied" {
        return false;
    }
    if stub["state"] == "pending" {
        stub["state"] = json!("withdrawn");
        stub["withdrawal"] = json!({ "by": "drafter", "reason": "source-erased", "at": now });
    }
    stub["redacted"] = json!(true);
    stub["changeHash"] = json!(format!("sha256:{}", "0".repeat(64)));
    stub["reason"] = Value::Null;
    true
}

fn batch(input: &Value, cx: &Cx) -> Outcome {
    if let Some(mut meta) = get(cx, META, "rev")
        && let Some(name) = meta["hook"].as_str().map(str::to_owned)
    {
        meta["hook"] = Value::Null;
        put(cx, META, "rev", meta);
        let hook = HOOKS.lock().unwrap().remove(&name);
        if let Some(hook) = hook {
            hook();
        }
    }
    let Some(attestation) = cx.call().pipeline.clone() else {
        return failure(
            "PROPOSAL_DRAFTER_NOT_ALLOWED",
            "not a drafter's step",
            "Run curator-run.",
        );
    };
    let call = cx.call().clone();
    let space = space(cx);
    let now = format_instant(cx.now_ms().unwrap());
    let actor = format!(
        "{}:{}",
        call.actor_kind,
        call.actor_id.as_deref().unwrap_or("anonymous")
    );
    let mut redacted_any = false;

    // Withdrawals first.
    let mut withdrawals = Vec::new();
    for (index, item) in input["withdraw"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let id = item["proposal"].as_str().unwrap_or_default().to_owned();
        let Some(mut stub) = get(cx, KIND, &id) else {
            let mut answer = refused(index, "PROPOSAL_NOT_FOUND");
            answer["proposal"] = json!(id);
            withdrawals.push(answer);
            continue;
        };
        let redacting = item["redact"] == true;
        let pending = stub["state"] == "pending";
        if redacting {
            redacted_any |= redact(&mut stub, &now);
        } else if pending {
            stub["state"] = json!("withdrawn");
            stub["withdrawal"] = json!({ "by": "drafter", "reason": item["reason"], "at": now });
        } else {
            let mut answer = refused(index, "PROPOSAL_STATE_INVALID");
            answer["proposal"] = json!(id);
            withdrawals.push(answer);
            continue;
        }
        stub["rev"] = json!(bump(cx));
        put(cx, KIND, &id, stub.clone());
        withdrawals.push(json!({
            "index": index, "ok": true, "withdrawn": pending, "redacted": redacting,
            "proposal": summary(&stub),
        }));
    }

    // The erased notice.
    let erased: BTreeSet<String> = input["erased"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let notice = if erased.is_empty() {
        Value::Null
    } else {
        let (mut redacted, mut withdrawn) = (Vec::new(), Vec::new());
        for mut stub in stubs(cx) {
            let cites = stub["sources"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|s| s.as_str().is_some_and(|s| erased.contains(s)));
            if !cites || stub["drafter"]["instance"] != attestation.instance.as_str() {
                continue;
            }
            let pending = stub["state"] == "pending";
            if redact(&mut stub, &now) {
                redacted_any = true;
                let id = stub["id"].as_str().unwrap().to_owned();
                redacted.push(json!(id));
                if pending {
                    withdrawn.push(json!(id));
                }
                stub["rev"] = json!(bump(cx));
                put(cx, KIND, &id, stub);
            }
        }
        json!({ "sources": erased.len(), "redacted": redacted, "withdrawn": withdrawn, "refused": [] })
    };

    // The proposals.
    let mut results = Vec::new();
    for (index, item) in input["proposals"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let key = item["idempotency_key"].as_str().unwrap_or_default();
        let id = umbel_okf::draft::proposal_id(&space, &actor, key);
        let hash = ContentHash::of(canonical_json(item).as_bytes()).to_string();
        if let Some(existing) = get(cx, KIND, &id) {
            if existing["itemHash"] == hash.as_str() {
                results.push(
                    json!({ "index": index, "ok": true, "created": false, "proposal": summary(&existing) }),
                );
            } else {
                results.push(refused(index, "PROPOSAL_KEY_REUSED"));
            }
            continue;
        }
        let doc = item["change"]["doc"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let set = item["conflictSet"].as_str().map(str::to_owned);
        let sources = sources_of(item);
        let blocked = stubs(cx).iter().any(|other| {
            matches!(other["state"].as_str(), Some("pending" | "approved"))
                && ((other["doc"] == doc.as_str()
                    && (set.is_none() || other["conflictSet"].as_str() != set.as_deref()))
                    || other["sources"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|s| s.as_str().is_some_and(|s| sources.iter().any(|m| m == s))))
        });
        if blocked {
            results.push(refused(index, "PROPOSAL_ALREADY_OPEN"));
            continue;
        }
        let stub = json!({
            "id": id, "key": key, "doc": doc, "op": item["change"]["op"], "state": "pending",
            "drafter": {
                "plugin": attestation.plugin, "instance": attestation.instance,
                "run": attestation.run, "candidate": item["drafter"]["candidate"],
                "mode": item["drafter"]["mode"], "promotedBy": item["drafter"]["promotedBy"],
            },
            "conflictSet": set, "sources": sources, "itemHash": hash,
            "changeHash": format!("sha256:{}", "1".repeat(64)), "redacted": false,
            "proposer": principal(cx), "rev": bump(cx), "reason": null,
        });
        let mut stub = stub;
        if sources.is_empty() {
            // A draft citing no memory holds no memory text: keep it whole for the tests.
            stub["item"] = item.clone();
        }
        put(cx, KIND, &id, stub.clone());
        results.push(
            json!({ "index": index, "ok": true, "created": true, "proposal": summary(&stub) }),
        );
    }

    let held = get(cx, META, "rev").is_some_and(|meta| meta["held"] == true);
    let checkpoint = redacted_any.then_some(if held { "pending" } else { "clean" });
    let mut outcome = success(json!({
        "space": space,
        "drafter": { "plugin": attestation.plugin, "instance": attestation.instance, "pipeline": attestation.pipeline, "run": attestation.run },
        "results": results,
        "withdrawals": withdrawals,
        "erased": notice,
        "counts": {},
        "checkpoint": checkpoint,
    }));
    if checkpoint == Some("pending") {
        outcome = outcome.with_warning("PROPOSAL_REDACTION_PENDING", "a reader holds the WAL");
    }
    outcome
}

fn feed(input: &Value, cx: &Cx) -> Outcome {
    if get(cx, META, "rev").is_some_and(|meta| meta["failFeed"] == true) {
        return failure("STORE_BUSY", "the feed failed", "Run again.").with_retryable(true);
    }
    let Some(attestation) = cx.call().pipeline.clone() else {
        return failure(
            "PROPOSAL_DRAFTER_NOT_ALLOWED",
            "not a drafter's step",
            "Run curator-run.",
        );
    };
    let after = input["after"].as_u64().unwrap_or(0);
    let mut decisions: Vec<Value> = stubs(cx)
        .into_iter()
        .filter(|stub| {
            stub["drafter"]["instance"] == attestation.instance.as_str()
                && stub["proposer"] == principal(cx).as_str()
                && stub["rev"].as_u64().unwrap_or(0) > after
                && matches!(stub["state"].as_str(), Some("rejected" | "applied"))
        })
        .map(|stub| {
            let mut decision = json!({
                "proposal": stub["id"], "state": stub["state"], "doc": stub["doc"],
                "candidate": stub["drafter"]["candidate"], "conflictSet": stub["conflictSet"],
                "rev": stub["rev"], "redacted": stub["redacted"],
            });
            if stub["state"] == "rejected" && stub["redacted"] != true {
                decision["reason"] = stub["reason"].clone();
            }
            decision
        })
        .collect();
    decisions.sort_by_key(|d| d["rev"].as_u64());
    let next = get(cx, META, "rev").map_or(after, |meta| meta["rev"].as_u64().unwrap());
    success(json!({
        "space": space(cx), "decisions": decisions, "count": decisions.len(),
        "next": next.max(after), "more": false, "trust": "content",
    }))
}

fn decide(input: &Value, cx: &Cx) -> Outcome {
    let id = input["proposal"].as_str().unwrap();
    let Some(mut stub) = get(cx, KIND, id) else {
        return failure("PROPOSAL_NOT_FOUND", "no such stub", "Check the id.");
    };
    if stub["state"] != "pending" {
        return failure("PROPOSAL_STATE_INVALID", "not pending", "Check the id.");
    }
    stub["state"] = input["state"].clone();
    stub["reason"] = input.get("reason").cloned().unwrap_or(Value::Null);
    stub["rev"] = json!(bump(cx));
    put(cx, KIND, id, stub.clone());
    success(summary(&stub))
}

fn controls(input: &Value, cx: &Cx) -> Outcome {
    let mut meta = get(cx, META, "rev").unwrap_or_else(|| json!({ "rev": 0, "held": false }));
    for key in ["held", "failFeed", "hook"] {
        if let Some(value) = input.get(key) {
            meta[key] = value.clone();
        }
    }
    put(cx, META, "rev", meta.clone());
    success(meta)
}

impl Plugin for StandIn {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let cx: &Cx = cx;
        match name {
            "knowledge-propose-batch" => batch(&input, cx),
            "knowledge-proposal-feed" => feed(&input, cx),
            "knowledge-decide" => decide(&input, cx),
            "knowledge-stand-in" => controls(&input, cx),
            other => failure("COMMAND_NOT_FOUND", other, "No such command."),
        }
    }
}
