//! Stand-in drafters for the drafted path (phase 4 step 3b): compiled plugins whose pipelines'
//! steps are `knowledge-propose-batch` and `knowledge-proposal-feed`, so the host attests those
//! steps to them (phase 4 section 10.1). `curator` is listed in the knowledge instance's
//! `drafters`; `scribe` is the same shape and is not. The curator plugin itself comes in step 4.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use afd::{CommandInterface, CommandResult};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel_sdk::{Cx, Outcome, Plugin, failure};

use super::{CONFIG, Fx, human, json_of};

/// The manifest of a stand-in drafter with the plugin and instance id `id`.
fn manifest(id: &str) -> String {
    format!(
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "{id}"
title = "Stand-in drafter {id}"
version = "0.1.0"
description = "Pipelines whose steps are the knowledge plugin's drafted path, so the host attests them."
kind = "compiled"
domains = ["{id}"]

[[commands]]
name = "{id}-noop"
description = "Does nothing; a plugin ships at least one command."
effects = ["inspect"]
input_schema = {{ type = "object" }}
expose = {{ mcp = false, agent = false, cli = true }}

[[pipelines]]
name = "{id}-submit"
description = "Submit drafts and withdrawals."
effects = ["store-write"]
input_schema = {{ type = "object" }}
result = "last"
steps = [
  {{ command = "knowledge-propose-batch", input = {{ space = "$input.space", proposals = "$input.proposals", withdraw = "$input.withdraw" }}, as = "submit" }},
]

[[pipelines]]
name = "{id}-feed"
description = "Read the decisions on the drafts."
effects = ["inspect"]
input_schema = {{ type = "object" }}
expose = {{ mcp = false, agent = false, cli = true }}
result = "last"
steps = [
  {{ command = "knowledge-proposal-feed", input = {{ space = "$input.space", after = "$input.after" }}, as = "feed" }},
]
"#
    )
}

struct StandIn {
    manifest: &'static str,
}

impl StandIn {
    fn new(id: &str) -> Self {
        Self {
            manifest: Box::leak(manifest(id).into_boxed_str()),
        }
    }
}

impl Plugin for StandIn {
    fn manifest(&self) -> &'static str {
        self.manifest
    }

    fn handle(&self, name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        failure(
            "COMMAND_NOT_FOUND",
            &format!("the stand-in has no handler for `{name}`"),
            "Run one of its pipelines.",
        )
    }
}

/// `builder` with both stand-in drafters linked.
pub fn link(builder: HostBuilder) -> HostBuilder {
    builder
        .with_compiled(Arc::new(sdk(StandIn::new("curator"))))
        .with_compiled(Arc::new(sdk(StandIn::new("scribe"))))
}

/// The handbook area of `main`; `approvers` empty admits any person.
pub const AREA: &str = r#"
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
"#;

/// [`CONFIG`] with both stand-ins enabled, the knowledge instance listing `drafters`, the
/// handbook area, and the command line's person `local_id`.
pub fn config(drafters: &[&str], local_id: &str) -> String {
    let listed: Vec<String> = drafters.iter().map(|d| format!("\"{d}\"")).collect();
    let base = CONFIG.replace(
        "enabled = [\"sources\", \"knowledge\"]",
        "enabled = [\"sources\", \"knowledge\", \"curator\", \"scribe\"]",
    );
    format!(
        "{base}\n[plugins.curator]\nsource = \"compiled:curator\"\n\n[plugins.scribe]\nsource = \"compiled:scribe\"\n\n[plugins.knowledge.config]\ndrafters = [{}]\n{AREA}\n[principal]\nlocal_id = \"{local_id}\"\n",
        listed.join(", ")
    )
}

/// A run of `<drafter>-submit` by the person `human:local` at the command line: the result and
/// the run's trace id, which the host attests as the drafter's `run`.
pub async fn submit_as(
    fx: &Fx,
    drafter: &str,
    proposals: Value,
    withdraw: Option<Value>,
) -> (Value, String) {
    let mut input = json!({ "proposals": proposals });
    if let Some(withdraw) = withdraw {
        input["withdraw"] = withdraw;
    }
    run(fx, &format!("{drafter}-submit"), input).await
}

/// A run of `curator-submit`.
pub async fn submit(fx: &Fx, proposals: Value, withdraw: Option<Value>) -> (Value, String) {
    submit_as(fx, "curator", proposals, withdraw).await
}

/// A run of `<drafter>-feed` after `after`.
pub async fn feed_as(fx: &Fx, drafter: &str, after: u64) -> Value {
    run(fx, &format!("{drafter}-feed"), json!({ "after": after }))
        .await
        .0
}

/// A pipeline call as `human:local` on the command line, and the call's trace id.
pub async fn run(fx: &Fx, pipeline: &str, input: Value) -> (Value, String) {
    let context = fx
        .host
        .context(human("local"))
        .with_interface(CommandInterface::Cli);
    let trace = context.trace_id.clone().unwrap();
    let result: CommandResult<Value> = fx
        .host
        .registry()
        .execute(pipeline, input, Some(context))
        .await;
    (json_of(result), trace)
}

/// A drafted `verify` of `doc` at `base`, citing the document, under `key`.
pub fn verify(key: &str, doc: &str, base: &str) -> Value {
    json!({
        "idempotency_key": key,
        "change": { "op": "verify", "doc": doc, "baseHash": base },
        "rationale": "Due for re-verification: its checks pass.",
        "evidence": [
            { "kind": "document", "ref": doc, "contentHash": base },
            { "kind": "text", "ref": "check:links-resolve", "excerpt": "pass" },
        ],
    })
}

/// A drafted `deprecate` of `doc` at `base`, under `key`.
pub fn deprecate(key: &str, doc: &str, base: &str) -> Value {
    json!({
        "idempotency_key": key,
        "change": { "op": "deprecate", "doc": doc, "baseHash": base },
        "rationale": "It names a successor and is not deprecated.",
        "evidence": [{ "kind": "document", "ref": doc, "contentHash": base }],
    })
}

/// A memory evidence entry as section 2.1 shapes it, for the record `mem-<24 hex of n>`.
pub fn memory_entry(n: usize) -> Value {
    json!({
        "kind": "memory",
        "ref": format!("mem-{n:024x}@1"),
        "principal": "human:ada",
        "contentHash": format!("sha256:{}", "5e".repeat(32)),
        "class": "semantic",
        "authority": "person",
        "origin": "user-stated",
        "constraints": null,
        "access": ["space"],
        "sensitivity": "internal",
        "confirmation": null,
        "observations": { "sessions": 2, "principals": 1 },
    })
}

/// The `index`th result of a batch's `results` (or `withdrawals`).
pub fn item<'a>(data: &'a Value, list: &str, index: usize) -> &'a Value {
    &data[list][index]
}

/// The error code of a refused batch item.
pub fn item_code(item: &Value) -> &str {
    assert_eq!(item["ok"], false, "{item}");
    item["error"]["code"].as_str().unwrap()
}
