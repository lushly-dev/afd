//! The curator's drafts pass the knowledge plugin's verification byte for byte (phase 4
//! specification, sections 3.2 and 4.5; step 4). Memory records are written through the store;
//! the curator's own code (`umbel_plugin_curator::{evaluate, draft}`) computes the candidates from
//! what the caller can read and renders each draft; a pipeline step the host attests to the
//! instance `curator` submits them to the real `knowledge-propose-batch`, which re-reads every
//! source and re-renders every draft before it stores it. A scheduled draft, a promotion of the
//! caller's own record and a conflict set's two alternatives are all stored; the same draft with
//! one copied field changed is refused, naming the field.
//!
//! The curator ships no pipeline until step 5's `curator-run`, so the pipeline here belongs to a
//! stand-in with the plugin id `curator`: the attestation, and so `generated.by`, are the ones the
//! real run will carry. This crate is the only one that links the curator beside the knowledge
//! plugin, as a dev-dependency (D3).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel_plugin_curator::draft::{Drafter, item};
use umbel_plugin_curator::evaluate::{Candidate, Inputs, Mode, Status, evaluate};
use umbel_plugin_curator::pack::Settle;
use umbel_plugin_curator::records::{Consent, Consented, consent_id};
use umbel_plugin_curator::target::Target;
use umbel_sdk::{Cx, Outcome, Plugin, failure};
use umbel_store::conformance::samples;
use umbel_store::memory::{DAY_MS, format_instant};
use umbel_store::{
    AsOf, Authority, MemoryRecord, MemoryStore, MemoryWrite, Origin, ReadFlags, ReaderFilter,
    Sensitivity,
};
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

/// When the records are written, 2026-01-01T00:00:00.000Z; the host's clock is eight days later.
const T0: i64 = 1_767_225_600_000;
const NOW: i64 = T0 + 8 * DAY_MS;

const CONFIG: &str = r#"config_version = 4
default_space = "alpha"

[principal]
local_id = "local"

[spaces.alpha]
[spaces.alpha.collections.notes]
root = "spaces/alpha/notes"

[plugins]
enabled = ["knowledge", "curator"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha"]
[plugins.knowledge.grants.records_write]
allow = ["alpha"]
[plugins.knowledge.grants.documents_write]
allow = ["alpha/*"]
[plugins.knowledge.grants.content_write]
allow = ["alpha/*"]

[plugins.knowledge.config.areas.notes]
space = "alpha"
collection = "notes"

[plugins.knowledge.config.drafters.curator.targets.alpha]
collection = "notes"
prefix = "learned"

[plugins.curator]
source = "compiled:curator"
"#;

/// A stand-in with the plugin id `curator` whose one pipeline submits drafts: the host attests
/// its step to the plugin `curator`, instance `curator`, as it will `curator-run`'s.
struct StandIn;

impl Plugin for StandIn {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "curator"
title = "Curator stand-in"
version = "0.1.0"
description = "A pipeline whose step is the knowledge plugin's knowledge-propose-batch."
kind = "compiled"
domains = ["curator"]

[[commands]]
name = "curator-noop"
description = "Does nothing; a plugin ships at least one command."
effects = ["inspect"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }

[[pipelines]]
name = "curator-submit"
description = "Submit the curator's drafts."
effects = ["store-write"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }
result = "last"
steps = [
  { command = "knowledge-propose-batch", input = { space = "$input.space", proposals = "$input.proposals" }, as = "submit" },
]
"#
    }

    fn handle(&self, name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        failure(
            "COMMAND_NOT_FOUND",
            &format!("the stand-in has no handler for `{name}`"),
            "Run its pipeline.",
        )
    }
}

struct Fx {
    dir: tempfile::TempDir,
    host: umbel::Host,
}

impl Fx {
    fn new(entries: Vec<MemoryWrite>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), CONFIG).unwrap();
        std::fs::create_dir_all(dir.path().join("spaces/alpha/notes")).unwrap();
        let store = Self::store_at(dir.path());
        for entry in entries {
            store.write(samples::memory_batch(T0, vec![entry])).unwrap();
        }
        drop(store);
        let host = HostBuilder::open(dir.path())
            .unwrap()
            .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
            .with_compiled(Arc::new(sdk(StandIn)))
            .with_clock(fixed_clock(NOW))
            .seal()
            .unwrap();
        Self { dir, host }
    }

    fn store_at(root: &std::path::Path) -> SqliteMemoryStore {
        SqliteMemoryStore::open(
            &root.join("state/spaces/alpha"),
            "alpha",
            StoreOptions::default(),
        )
        .unwrap()
        .with_machine_backup_exclusion(false)
    }

    /// The records `human:local` can read, as the curator's `memory` grant reads them.
    fn readable(&self, ids: &[String]) -> Vec<MemoryRecord> {
        let reader = ReaderFilter::tokens(["space", "principal:human:local"]).unwrap();
        let store = Self::store_at(self.dir.path());
        ids.iter()
            .filter_map(|id| {
                store
                    .get(id, AsOf::at(NOW), ReadFlags::at(NOW), &reader)
                    .unwrap()
            })
            .collect()
    }

    /// The curator's candidates of `records` for `human:local`, with `consents`.
    fn candidates(&self, records: Vec<MemoryRecord>, consents: &[Consent]) -> Vec<Candidate> {
        let settle = Settle::default();
        let target = Target {
            collection: "notes".into(),
            prefix: Some("learned".into()),
            access: vec!["space".into()],
            sensitivity: Sensitivity::Internal,
        };
        evaluate(
            Inputs {
                space: "alpha",
                principal: "human:local",
                now: NOW,
                settle: &settle,
                target: &target,
                records,
                stored: &[],
                consents,
            },
            |_| Ok::<_, ()>(false),
        )
        .unwrap()
        .candidates
    }

    /// A run of the attested pipeline by the person at the command line.
    async fn submit(&self, proposals: Vec<Value>) -> Value {
        let context = self
            .host
            .context(Actor::new(ActorKind::Human).with_id("local"))
            .with_interface(CommandInterface::Cli);
        let result: CommandResult<Value> = self
            .host
            .registry()
            .execute(
                "curator-submit",
                json!({ "space": "alpha", "proposals": proposals }),
                Some(context),
            )
            .await;
        serde_json::to_value(result).unwrap()
    }
}

const CURATOR: Drafter<'static> = Drafter {
    plugin: "curator",
    instance: "curator",
};

/// A semantic person fact `n` of `owner` readable by `access`, with a constraint, observed in two
/// sessions (written twice).
fn fact(n: u64, owner: &str, access: &[&str], subject: &str, text: &str) -> Vec<MemoryWrite> {
    let mut entry = samples::memory_entry(n, owner, access, subject, text);
    entry.scope.space = "alpha".to_owned();
    entry.scope.session = Some("s1".to_owned());
    entry.tags = vec!["deploy".to_owned()];
    entry.valid_from = T0;
    entry.expires_at = T0 + 400 * DAY_MS;
    entry.envelope.origin = Origin::UserStated;
    entry.envelope.observed_at = format_instant(T0);
    entry.envelope.constraints = Some(vec!["staging only".to_owned()]);
    entry.envelope.confidence = Some(0.8);
    samples::set_authority(&mut entry, Authority::Person);
    samples::agree(&mut entry);
    let mut observed = entry.clone();
    observed.id = samples::memory_id(n + 100);
    observed.scope.session = Some("s2".to_owned());
    samples::agree(&mut observed);
    vec![entry, observed]
}

fn results(result: &Value) -> Vec<Value> {
    assert_eq!(result["success"], true, "{result}");
    result["data"]["results"].as_array().unwrap().clone()
}

#[tokio::test]
async fn the_curators_drafts_pass_the_knowledge_plugins_verification() {
    let mut entries = fact(
        1,
        "human:ada",
        &["space"],
        "Staging rollbacks",
        "Use the canary flag.",
    );
    entries.extend(fact(
        2,
        "human:local",
        &["principal:human:local"],
        "Mine",
        "Private.",
    ));
    entries.extend(fact(
        3,
        "human:ada",
        &["space"],
        "Release",
        "Tag from main.",
    ));
    entries.extend(fact(
        4,
        "human:ada",
        &["space"],
        "release!",
        "Tag from a branch.",
    ));
    let fx = Fx::new(entries);
    let ids: Vec<String> = (1..=4).map(samples::memory_id).collect();
    let found = fx.candidates(fx.readable(&ids), &[]);
    assert_eq!(found.len(), 4);
    let by_source = |n: u64| {
        let id = umbel_okf::draft::candidate_id("alpha", "human:local", &samples::memory_id(n));
        found.iter().find(|c| c.id == id).unwrap().clone()
    };
    let (scheduled, private, first, second) =
        (by_source(1), by_source(2), by_source(3), by_source(4));
    assert_eq!(scheduled.mode, Some(Mode::Scheduled));
    assert_eq!(private.status, Status::NeedsPromotion);
    assert!(first.conflict_set.is_some() && first.conflict_set == second.conflict_set);

    // A scheduled draft and both alternatives of the conflict set: each verified and stored.
    let drafts: Vec<Value> = [&scheduled, &first, &second]
        .into_iter()
        .map(|c| item(c, CURATOR).unwrap())
        .collect();
    let stored = results(&fx.submit(drafts.clone()).await);
    for (index, result) in stored.iter().enumerate() {
        assert_eq!(result["ok"], true, "{index}: {result}");
        assert_eq!(result["created"], true, "{index}: {result}");
    }
    // The rerun renders byte-equal input and gets the stored proposals back.
    let again = results(&fx.submit(drafts.clone()).await);
    for (index, result) in again.iter().enumerate() {
        assert_eq!(result["ok"], true, "{index}: {result}");
        assert_eq!(result["created"], false, "{index}: {result}");
        assert_eq!(result["proposal"]["id"], stored[index]["proposal"]["id"]);
    }

    // The same draft with one copied field changed is refused, naming the field (section 13,
    // point 1), and nothing is stored.
    let mut tampered = drafts[0].clone();
    tampered["evidence"][0]["authority"] = json!("agent");
    let refused = &results(&fx.submit(vec![tampered]).await)[0];
    assert_eq!(refused["ok"], false, "{refused}");
    assert_eq!(refused["error"]["code"], "PROPOSAL_DRAFT_MISMATCH");
    assert_eq!(refused["error"]["details"]["check"], "copied-authority");

    // The caller's own private fact, promoted with the caller's consent: stored as a promotion.
    let record = fx.readable(&ids[1..2]).remove(0);
    let consent = Consent {
        id: consent_id(&private.id),
        by: "human:local".into(),
        at: NOW,
        sources: vec![Consented {
            id: record.id.clone(),
            record_version: record.record_version,
            content_hash: record.content_hash.as_str().to_owned(),
        }],
    };
    let promoted = fx.candidates(vec![record], std::slice::from_ref(&consent));
    assert_eq!(
        promoted[0].mode,
        Some(Mode::Promoted {
            by: "human:local".into()
        })
    );
    let result = &results(&fx.submit(vec![item(&promoted[0], CURATOR).unwrap()]).await)[0];
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["created"], true);
    // Without the promotion, the same draft claims no widening and is refused.
    let mut scheduled_claim = item(&promoted[0], CURATOR).unwrap();
    scheduled_claim["drafter"] = json!({ "mode": "scheduled", "candidate": private.id });
    scheduled_claim["idempotency_key"] = json!(format!("curator/{}/1", private.id));
    let refused = &results(&fx.submit(vec![scheduled_claim]).await)[0];
    assert_eq!(
        refused["error"]["code"], "PROPOSAL_DRAFT_MISMATCH",
        "{refused}"
    );
    assert_eq!(refused["error"]["details"]["check"], "mode");
}
