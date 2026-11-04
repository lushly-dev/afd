//! Proposal records read and written straight through a space's document store, as a library
//! embedder can (D14): the records phase 2 wrote (version 1) and the drafted ones the curator's
//! pipeline submits from phase 4 step 3b on (version 2), so the reading side is tested before
//! any command writes them. Also the record schemas, the journal and the event stream.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use umbel_store::{
    ContentHash, DocumentStore, Envelope, Expect, ReaderFilter, Record, canonical_json,
};
use umbel_store_embedded::{SqliteStore, StoreOptions};

use super::Fx;

/// The knowledge instance's namespace and the record kind.
pub const NS: &str = "knowledge";
pub const KIND: &str = "proposal";

/// A memory record's content hash, as a drafted proposal cites it: it must never reach the
/// journal, an event or a result's `dev.umbel/provenance`.
pub const SOURCE_HASH: &str =
    "sha256:5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed5eed";
/// The memory record it came from.
pub const SOURCE_ID: &str = "mem-3f9a1c0d7b2e4a6f8c1d5e90";
/// The pipeline run a drafter's attestation names.
pub const RUN: &str = "5e1f0a2b3c4d5e6f708192a3b4c5d6e7";

pub fn store(fx: &Fx, space: &str) -> SqliteStore {
    SqliteStore::open(&fx.state_dir(space), space, StoreOptions::default()).unwrap()
}

/// The stored record of proposal `id` in `main`, read without a filter.
pub fn read(fx: &Fx, id: &str) -> Record {
    store(fx, "main")
        .get_record(NS, KIND, id, &ReaderFilter::derivation())
        .unwrap()
        .unwrap_or_else(|| panic!("no record {id}"))
}

/// Store `body` as the knowledge instance's proposal record in `main`, with the envelope its
/// `provenance` describes (the plugin's own shape: the record hash as `contentHash`).
pub fn seed(fx: &Fx, body: &Value) -> Record {
    let mut envelope = Envelope::from_value(body["provenance"].clone()).unwrap();
    envelope.content_hash = Some(ContentHash::of(canonical_json(body).as_bytes()).to_string());
    let store = store(fx, "main");
    let id = body["id"].as_str().unwrap();
    store
        .put_record(NS, KIND, id, body.clone(), envelope, Expect::Absent)
        .unwrap();
    store
        .get_record(NS, KIND, id, &ReaderFilter::derivation())
        .unwrap()
        .unwrap()
}

/// `sha256:` of the canonical JSON of `change`, `rationale` and `evidence`, as the plugin hashes.
pub fn change_hash(change: &Value, rationale: &str, evidence: &Value) -> String {
    let whole = json!({ "change": change, "rationale": rationale, "evidence": evidence });
    ContentHash::of(canonical_json(&whole).as_bytes()).to_string()
}

/// `p-` and 20 hex of SHA-256 of `<space>\0<actor>\0<key>`, as the plugin derives an id.
pub fn proposal_id(space: &str, actor: &str, key: &str) -> String {
    let hash = ContentHash::of(format!("{space}\0{actor}\0{key}").as_bytes());
    format!("p-{}", &hash.as_str()["sha256:".len()..][..20])
}

/// A version 1 proposal of `handbook/runbook` against `base`, by `agent:<agent>` acting for no
/// one, under `key`, as phase 2 stored one.
pub fn version_1(agent: &str, key: &str, base: &str, content: &str) -> Value {
    let change =
        json!({ "op": "update", "doc": "handbook/runbook", "baseHash": base, "content": content });
    let rationale = "The procedure changed in October.";
    let evidence = json!([{ "kind": "text", "ref": "release notes" }]);
    let hash = change_hash(&change, rationale, &evidence);
    let actor = json!({ "kind": "agent", "id": agent });
    json!({
        "version": 1,
        "id": proposal_id("main", &format!("agent:{agent}"), key),
        "idempotencyKey": key,
        "changeHash": hash,
        "space": "main",
        "area": "handbook",
        "state": "pending",
        "change": change,
        "diff": "--- a/runbook.md\n+++ b/runbook.md\n@@ -1 +1 @@\n-old\n+new\n",
        "rationale": rationale,
        "evidence": evidence,
        "provenance": {
            "version": 1, "origin": "agent-inferred", "space": "main", "plugin": "knowledge",
            "agent": actor, "principal": format!("agent:{agent}"), "session": null,
            "traceId": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "observedAt": "2026-01-01T00:00:00.000Z",
            "validFrom": null, "validUntil": null, "confidence": null, "authority": null,
            "sources": [{ "resource": "/handbook/runbook" }], "generated": null,
            "contentHash": hash, "derivedFrom": null, "access": ["space"], "sensitivity": "internal",
        },
        "policy": { "area": "handbook", "version": format!("sha256:{}", "12".repeat(32)), "rule": "person" },
        "exception": null,
        "proposer": { "actor": actor, "principal": format!("agent:{agent}") },
        "confidence": null,
        "decision": null,
        "result": null,
        "flags": [],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    })
}

/// What a drafted proposal says, for [`drafted`].
pub struct Draft<'a> {
    /// The candidate id's 20 hex digits; the document is `handbook/learned/c-<hex>`.
    pub candidate: &'a str,
    /// Text in the subject, the body, the rationale, the excerpt and the constraint.
    pub canary: &'a str,
    /// `Some(principal)` for a promoted draft.
    pub promoted_by: Option<&'a str>,
    pub conflict_set: Option<&'a str>,
}

/// The content a draft of `canary` creates: the curator's fixed rendering, with `Holds only`.
pub fn draft_content(canary: &str) -> String {
    format!(
        "---\ntitle: \"Staging uses {canary}\"\ntype: \"fact\"\ngenerated:\n  by: \"umbel:curator/curator\"\n  at: \"2026-01-01T00:00:00.000Z\"\n---\nRollbacks in staging use {canary}.\n\n## Holds only\n\n- \"staging only {canary}\"\n"
    )
}

/// A pending version 2 proposal drafted by the curator for `human:local`'s run: one memory source
/// of `human:ada`, with `derivedFrom` naming it. It validates against `proposal.v2.json`.
pub fn drafted(draft: &Draft<'_>) -> Value {
    let candidate = format!("c-{}", draft.candidate);
    let doc = format!("handbook/learned/{candidate}");
    let content = draft_content(draft.canary);
    let lines: Vec<&str> = content.lines().collect();
    let mut diff = format!(
        "--- /dev/null\n+++ b/learned/{candidate}.md\n@@ -0,0 +1,{} @@\n",
        lines.len()
    );
    for line in &lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    let change = json!({ "op": "create", "doc": doc, "baseHash": null, "content": content });
    let rationale = format!(
        "A semantic record of authority person ({}), observed in 2 sessions by 1 principal.",
        draft.canary
    );
    let evidence = json!([{
        "kind": "memory",
        "ref": format!("{SOURCE_ID}@2"),
        "principal": "human:ada",
        "contentHash": SOURCE_HASH,
        "class": "semantic",
        "authority": "person",
        "origin": "user-stated",
        "constraints": [format!("staging only {}", draft.canary)],
        "access": ["space"],
        "sensitivity": "internal",
        "confirmation": null,
        "observations": { "sessions": 2, "principals": 1 },
        "excerpt": format!("Rollbacks in staging use {}.", draft.canary),
    }]);
    let hash = change_hash(&change, &rationale, &evidence);
    let mut drafter = json!({
        "plugin": "curator", "instance": "curator", "pipeline": "curator-run", "run": RUN,
        "mode": "scheduled", "candidate": candidate,
    });
    if let Some(by) = draft.promoted_by {
        drafter["mode"] = json!("promoted");
        drafter["promotedBy"] = json!(by);
    }
    let actor = json!({ "kind": "human", "id": "local" });
    json!({
        "version": 2,
        "id": proposal_id("main", "human:local", &format!("curator/{candidate}/0")),
        "idempotencyKey": format!("curator/{candidate}/0"),
        "changeHash": hash,
        "space": "main",
        "area": "handbook",
        "state": "pending",
        "change": change,
        "diff": diff,
        "rationale": rationale,
        "evidence": evidence,
        "provenance": {
            "version": 2, "origin": "agent-inferred", "space": "main", "plugin": "knowledge",
            "agent": null, "principal": "human:local", "session": null, "traceId": RUN,
            "observedAt": "2026-01-01T00:00:00.000Z", "validFrom": null, "validUntil": null,
            "confidence": null, "authority": null, "sources": [{ "resource": format!("/{doc}") }],
            "generated": null, "contentHash": hash,
            "derivedFrom": [{ "kind": "memory", "id": SOURCE_ID, "contentHash": SOURCE_HASH }],
            "access": ["space"], "sensitivity": "internal",
            "redactions": null, "constraints": null, "confirmation": null,
        },
        "policy": { "area": "handbook", "version": format!("sha256:{}", "11".repeat(32)), "rule": "person" },
        "exception": null,
        "proposer": { "actor": actor, "principal": "human:local" },
        "confidence": null,
        "decision": null,
        "result": null,
        "flags": [],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "drafter": drafter,
        "conflictSet": draft.conflict_set.map(|set| format!("k-{set}")),
        "withdrawal": null,
        "redacted": null,
    })
}

/// The rationale a redaction leaves (phase 4 step 3b, amendment 6).
pub const REDACTED_RATIONALE: &str =
    "Redacted: a memory record this draft cited was forgotten, so its text was removed.";

/// `body` as section 9.1's redaction leaves it: withdrawn by the drafter, its content, diff,
/// rationale and memory evidence gone but for the reference, `derivedFrom` null, the change hash
/// redacted.
pub fn redacted(mut body: Value) -> Value {
    let id = body["id"].as_str().unwrap().to_owned();
    let hash = ContentHash::of(canonical_json(&json!({ "redacted": id })).as_bytes()).to_string();
    body["state"] = json!("withdrawn");
    body["change"].as_object_mut().unwrap().remove("content");
    body["diff"] = json!("");
    body["rationale"] = json!(REDACTED_RATIONALE);
    body["evidence"] =
        json!([{ "kind": "memory", "ref": format!("{SOURCE_ID}@2"), "erased": true }]);
    body["changeHash"] = json!(hash);
    body["provenance"]["contentHash"] = json!(hash);
    body["provenance"]["derivedFrom"] = Value::Null;
    body["withdrawal"] =
        json!({ "by": "drafter", "reason": "source-erased", "at": "2026-01-02T00:00:00.000Z" });
    body["redacted"] = json!({ "at": "2026-01-02T00:00:00.000Z", "reason": "source-erased" });
    body
}

fn schemas_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas")
}

/// Resolves a `$ref` to a sibling schema from the files, never from the network.
struct Siblings(BTreeMap<String, Value>);

impl Retrieve for Siblings {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("no schema file has the id {}", uri.as_str()).into())
    }
}

/// The validator of `schemas/<stem>.json`, its `$ref`s resolved among the sibling files.
pub fn validator(stem: &str) -> Validator {
    let read = |path: &Path| -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    };
    let siblings = std::fs::read_dir(schemas_dir())
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .map(|entry| read(&entry.path()))
        .filter_map(|value| Some((value["$id"].as_str()?.to_owned(), value)))
        .collect();
    jsonschema::options()
        .with_retriever(Siblings(siblings))
        .build(&read(&schemas_dir().join(format!("{stem}.json"))))
        .unwrap()
}

/// Panic unless `body` is valid against `schemas/<stem>.json`, naming every error.
pub fn assert_valid(stem: &str, body: &Value) {
    let validator = validator(stem);
    let errors: Vec<String> = validator
        .iter_errors(body)
        .map(|error| format!("{} at {}", error, error.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{stem}: {errors:?}\n{body}");
}

/// The journal's raw text.
pub fn journal(fx: &Fx) -> String {
    std::fs::read_to_string(fx.path("state/journal.jsonl")).unwrap_or_default()
}

/// The journal's entries for `command`.
pub fn journal_entries(fx: &Fx, command: &str) -> Vec<Value> {
    journal(fx)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["command"] == command)
        .collect()
}

/// The raw text of `main`'s event stream.
pub fn events(fx: &Fx) -> String {
    std::fs::read_to_string(fx.path("state/spaces/main/events.jsonl")).unwrap_or_default()
}
