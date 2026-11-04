//! The exit criterion of phase 4 (specification section 13): a curator proposal approved from the
//! command line lands in the knowledge base with full provenance. Everything runs through the real
//! `umbel-first-party` binary as a child process, on the `testkit` build's frozen clock and person
//! at a terminal, with `sources`, `knowledge`, `memory` and `curator` enabled in one space `alpha`
//! (a `notes` collection, an area over it, the curator listed in `drafters` with the target
//! `notes/learned`). The command line is `human:local`; `human:ada`'s memory is written through the
//! binary too, by switching `principal.local_id` to `ada` for her calls (step 7's amendment 1).
//!
//! 1. a scheduled draft, and a tampered replay refused;
//! 2. approved from the command line, after the preview;
//! 3. lands with full provenance;
//! 4. promotion and self-approval;
//! 5. feedback;
//! 6. forgotten evidence;
//! 7. not in the request path.
//!
//! Each point's numbers go into a report, written to `UMBEL_CURATOR_EXIT_REPORT` when it is set
//! (the `memory` job uploads it beside phase 3's), else beside the workspace.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Map, Value, json};
use support::binary::Bin;
use support::*;
use umbel::HostBuilder;
use umbel::plugins::sdk;
use umbel_plugin_curator::draft::{Drafter, item};
use umbel_plugin_curator::evaluate::{Inputs, evaluate};
use umbel_plugin_curator::pack::Settle;
use umbel_plugin_curator::target::Target;
use umbel_sdk::{Cx, Outcome, Plugin, failure};
use umbel_store::{AsOf, DocumentStore, MemoryStore, ReadFlags, ReaderFilter, Sensitivity};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions};

fn day(n: i64) -> i64 {
    CLOCK + n * DAY
}

/// The workspace: the command line is `human:<local>`; `self_approval` is the area's
/// `allow_self_approval`; `standin` leaves out the curator's grants and configuration, for the
/// replay's stand-in (point 1), which declares neither.
fn workspace(local: &str, self_approval: bool, standin: bool) -> String {
    let area = if self_approval {
        "allow_self_approval = true\n"
    } else {
        ""
    };
    let curator = if standin {
        ""
    } else {
        r#"[plugins.curator.grants.records_write]
allow = ["alpha"]

[plugins.curator.config.spaces.alpha]
collection = "notes"
prefix = "learned"
"#
    };
    format!(
        r#"config_version = 4
default_space = "alpha"

[principal]
local_id = "{local}"

[spaces.alpha]
[spaces.alpha.collections.notes]
root = "spaces/alpha/notes"

[plugins]
enabled = ["sources", "knowledge", "memory", "curator"]

[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["alpha/*"]
[plugins.sources.grants.records_write]
allow = ["alpha"]

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
{area}
[plugins.knowledge.config.drafters.curator.targets.alpha]
collection = "notes"
prefix = "learned"

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["alpha"]

[plugins.curator]
source = "compiled:curator"
{curator}"#
    )
}

/// A fact with a fresh canary in its subject, text, tag and constraint.
struct Fact {
    subject: String,
    text: String,
    tag: String,
    constraint: String,
}

impl Fact {
    fn new(first: char) -> Self {
        Self {
            subject: format!("{} staging rollbacks", canary(first)),
            text: format!("Roll back staging with the {} flag.", canary(first)),
            tag: canary(first),
            constraint: format!("staging only {}", canary(first)),
        }
    }

    /// The canaries alone.
    fn canaries(&self) -> Vec<String> {
        [&self.subject, &self.text, &self.tag, &self.constraint]
            .iter()
            .flat_map(|field| field.split([' ', '.']))
            .filter(|word| word.len() == 12)
            .map(str::to_owned)
            .collect()
    }
}

/// The binary on a workspace, and who its command line is.
struct Exit {
    bin: Bin,
    local: String,
    self_approval: bool,
}

impl Exit {
    fn configure(&mut self, local: &str, self_approval: bool) {
        self.local = local.to_owned();
        self.self_approval = self_approval;
        self.bin.configure(&workspace(local, self_approval, false));
    }

    /// `who` remembers `fact` at a terminal in two sessions, shared as `share` (private when
    /// `None`); the record's id. The command line is `human:local` again afterwards.
    fn remember(&mut self, who: &str, fact: &Fact, share: Option<&str>) -> String {
        let back = self.local.clone();
        let self_approval = self.self_approval;
        self.configure(who, self_approval);
        let mut ids = Vec::new();
        for session in ["s1", "s2"] {
            let mut input = json!({
                "class": "semantic", "subject": fact.subject, "text": fact.text,
                "tags": [fact.tag], "constraints": [fact.constraint], "session": session,
            });
            if let Some(share) = share {
                input["share"] = json!(share);
            }
            let result = self.bin.person("memory-remember", &input);
            ids.push(data(&result)["id"].as_str().unwrap().to_owned());
        }
        assert_eq!(
            ids[0], ids[1],
            "the second session observes the same record"
        );
        self.configure(&back, self_approval);
        ids.remove(0)
    }

    /// `memory-show` of `id` as `who`: the record.
    fn record(&mut self, who: &str, id: &str) -> Value {
        let back = self.local.clone();
        let self_approval = self.self_approval;
        self.configure(who, self_approval);
        let shown = self.bin.call("memory-show", &json!({ "id": id }));
        self.configure(&back, self_approval);
        data(&shown)["record"].clone()
    }

    /// `curator-run` through the binary: the report and the raw stdout.
    fn run(&self) -> (Value, String) {
        let stdout = self.bin.raw(
            &[
                "--format",
                "json",
                "call",
                "curator-run",
                r#"{"space":"alpha"}"#,
            ],
            false,
        );
        let text = String::from_utf8(stdout).unwrap();
        let result: Value = serde_json::from_str(&text).unwrap();
        (data(&result).clone(), text)
    }

    /// `curator-candidates`, the candidate `id`.
    fn candidate(&self, id: &str) -> Value {
        let listed = self.bin.call("curator-candidates", &json!({}));
        data(&listed)["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["candidate"] == id)
            .cloned()
            .unwrap_or_else(|| panic!("{id} not in {listed}"))
    }

    fn proposal(&self, id: &str) -> Value {
        let shown = self
            .bin
            .call("knowledge-proposal-show", &json!({ "proposal": id }));
        data(&shown)["proposal"].clone()
    }

    fn space(&self) -> std::path::PathBuf {
        self.bin.ws.join("state/spaces/alpha")
    }

    /// The raw bytes of `store.sqlite3`, its write-ahead log and shared memory, as text.
    fn store_bytes(&self) -> String {
        let mut text = String::new();
        for path in files(&self.bin.store_dir("alpha")) {
            if path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("store.sqlite3"))
            {
                text.push_str(&String::from_utf8_lossy(&std::fs::read(path).unwrap()));
            }
        }
        text
    }

    /// How many run records the curator keeps.
    fn runs(&self) -> usize {
        let store = SqliteStore::open(&self.space(), "alpha", StoreOptions::default()).unwrap();
        store
            .list_records("curator", "run", None, 500, &ReaderFilter::derivation())
            .unwrap()
            .items
            .len()
    }

    /// Every curator record, every kind, as JSON text.
    fn curator_records(&self) -> String {
        let store = SqliteStore::open(&self.space(), "alpha", StoreOptions::default()).unwrap();
        let mut text = String::new();
        for kind in ["candidate", "consent", "review", "run", "state"] {
            for record in store
                .list_records("curator", kind, None, 500, &ReaderFilter::derivation())
                .unwrap()
                .items
            {
                text.push_str(&serde_json::to_string(&record.body).unwrap());
                text.push_str(&serde_json::to_string(&record.envelope).unwrap());
            }
        }
        text
    }
}

/// The command line's candidate of `record`: candidates are the caller's, `human:local`'s.
fn candidate_of(record: &str) -> String {
    umbel_okf::draft::candidate_id("alpha", "human:local", record)
}

fn canaries_absent(haystack: &str, canaries: &[String], what: &str) {
    for canary in canaries {
        assert!(!haystack.contains(canary.as_str()), "{canary} in {what}");
    }
}

/// A stand-in with the plugin id `curator` whose pipeline submits a batch it is given: the host
/// attests its step to the instance `curator`, as it does `curator-run`'s. The binary links only
/// the real curator, whose drafts are faithful, so a tampered replay needs this (point 1).
struct StandIn;

impl Plugin for StandIn {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "curator"
title = "Curator stand-in"
version = "0.1.0"
description = "Replays a batch through the knowledge plugin's knowledge-propose-batch."
kind = "compiled"
domains = ["curator"]

[[commands]]
name = "curator-noop"
description = "Does nothing; a plugin ships at least one command."
effects = ["inspect"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }

[[pipelines]]
name = "curator-run"
description = "Replay a batch under the real pipeline's name, which a retry repeats."
effects = ["store-write"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }
result = "last"
journal = { mode = "digest" }
steps = [
  { command = "knowledge-propose-batch", input = { space = "alpha", proposals = "$input.proposals" }, as = "submit" },
]
"#
    }

    fn handle(&self, name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        failure("COMMAND_NOT_FOUND", name, "Run its pipeline.")
    }
}

/// The curator's own drafting of `record` for `human:local` at `now`, with the code the binary
/// runs: the batch item `curator-run` submitted.
fn rendered(exit: &Exit, record: &str, now: i64) -> Value {
    let store = SqliteMemoryStore::open(&exit.space(), "alpha", StoreOptions::default())
        .unwrap()
        .with_machine_backup_exclusion(false);
    let reader = ReaderFilter::tokens(["space", "principal:human:local"]).unwrap();
    let found = store
        .get(record, AsOf::at(now), ReadFlags::at(now), &reader)
        .unwrap()
        .unwrap();
    let settle = Settle::default();
    let target = Target {
        collection: "notes".into(),
        prefix: Some("learned".into()),
        access: vec!["space".into()],
        sensitivity: Sensitivity::Internal,
    };
    let candidates = evaluate(
        Inputs {
            space: "alpha",
            principal: "human:local",
            now,
            settle: &settle,
            target: &target,
            records: vec![found],
            stored: &[],
            consents: &[],
        },
        |_| Ok::<_, ()>(false),
    )
    .unwrap()
    .candidates;
    item(
        &candidates[0],
        Drafter {
            plugin: "curator",
            instance: "curator",
        },
    )
    .unwrap()
}

/// Replay `proposals` through the stand-in, in process on the binary's workspace and clock: the
/// batch's results.
async fn replay(exit: &Exit, proposals: Vec<Value>) -> Vec<Value> {
    exit.bin.configure(&workspace("local", false, true));
    let host = HostBuilder::open(&exit.bin.ws)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_sources_filesystem::plugin())))
        .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
        .with_compiled(Arc::new(sdk(umbel_plugin_memory::plugin())))
        .with_compiled(Arc::new(sdk(StandIn)))
        .with_clock(fixed_clock(exit.bin.clock))
        .seal()
        .unwrap();
    let context = host
        .context(Actor::new(ActorKind::Human).with_id("local"))
        .with_interface(CommandInterface::Cli);
    let result: CommandResult<Value> = host
        .registry()
        .execute(
            "curator-run",
            json!({ "proposals": proposals }),
            Some(context),
        )
        .await;
    drop(host);
    exit.bin
        .configure(&workspace(&exit.local, exit.self_approval, false));
    let result = serde_json::to_value(result).unwrap();
    data(&result)["results"].as_array().unwrap().clone()
}

/// 1. A scheduled draft.
async fn scheduled_draft(exit: &mut Exit, report: &mut Map<String, Value>) -> (String, Value) {
    let fact = Fact::new('z');
    let canaries = fact.canaries();
    assert_eq!(canaries.len(), 4);
    let record = exit.remember("ada", &fact, Some("space"));
    let candidate = candidate_of(&record);

    exit.bin.at(day(3));
    let settling = exit.candidate(&candidate);
    assert_eq!(settling["status"], "settling", "{settling}");
    assert_eq!(settling["sessions"], 2, "{settling}");

    exit.bin.at(day(8));
    let ready = exit.candidate(&candidate);
    assert_eq!(ready["status"], "ready", "{ready}");
    assert_eq!(ready["own"], false, "ada's record, not the caller's");
    assert_eq!(ready["contentHash"], Value::Null, "{ready}");
    let (run, stdout) = exit.run();
    assert_eq!(run["counts"]["drafted"], 1, "{run}");
    let id = run["proposals"][0].as_str().unwrap().to_owned();
    let proposal = exit.proposal(&id);
    assert_eq!(proposal["version"], 2);
    assert_eq!(proposal["state"], "pending");
    let doc = proposal["change"]["doc"].as_str().unwrap().to_owned();
    assert_eq!(doc, format!("notes/learned/{candidate}"), "an opaque path");
    let drafter = &proposal["drafter"];
    assert_eq!(drafter["plugin"], "curator");
    assert_eq!(drafter["instance"], "curator");
    assert_eq!(drafter["pipeline"], "curator-run");
    assert_eq!(drafter["run"], run["run"], "the attested run");
    assert_eq!(drafter["mode"], "scheduled");
    assert_eq!(drafter["candidate"], candidate.as_str());

    // One memory evidence entry, its copied fields the record's.
    let shown = exit.record("ada", &record);
    let evidence = proposal["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), 1, "{proposal}");
    let entry = &evidence[0];
    assert_eq!(entry["kind"], "memory");
    assert_eq!(
        entry["ref"],
        format!("{record}@{}", shown["recordVersion"]),
        "{shown}"
    );
    assert_eq!(entry["principal"], "human:ada");
    assert_eq!(entry["principal"], shown["scope"]["principal"], "{shown}");
    assert_eq!(entry["authority"], "person");
    assert_eq!(entry["authority"], shown["provenance"]["authority"]);
    assert_eq!(entry["origin"], shown["provenance"]["origin"]);
    assert_eq!(entry["constraints"], json!([fact.constraint]));
    assert_eq!(entry["constraints"], shown["provenance"]["constraints"]);
    assert_eq!(entry["access"], json!(["space"]));
    assert_eq!(entry["access"], shown["access"]);
    assert_eq!(entry["contentHash"], shown["contentHash"]);
    assert_eq!(
        proposal["provenance"]["derivedFrom"],
        json!([{ "kind": "memory", "id": record, "contentHash": shown["contentHash"] }])
    );

    // The curator's own rendering is what the binary stored: replayed, it is the stored draft;
    // with the copied authority changed, it is refused and nothing is stored.
    let item = rendered(exit, &record, day(8));
    assert_eq!(
        item["idempotency_key"], proposal["idempotencyKey"],
        "{item}"
    );
    let again = replay(exit, vec![item.clone()]).await;
    assert_eq!(again[0]["ok"], true, "{again:?}");
    assert_eq!(again[0]["created"], false, "{again:?}");
    assert_eq!(again[0]["proposal"]["id"], id.as_str());
    let mut tampered = item.clone();
    tampered["evidence"][0]["authority"] = json!("agent");
    let refused = replay(exit, vec![tampered]).await;
    assert_eq!(refused[0]["ok"], false, "{refused:?}");
    assert_eq!(refused[0]["error"]["code"], "PROPOSAL_DRAFT_MISMATCH");
    assert_eq!(refused[0]["error"]["details"]["check"], "copied-authority");
    let listed = exit.bin.call("knowledge-proposal-list", &json!({}));
    assert_eq!(
        data(&listed)["proposals"].as_array().unwrap().len(),
        1,
        "{listed}"
    );

    // The run's stdout, the journal and the events hold no canary.
    canaries_absent(&stdout, &canaries, "curator-run's stdout");
    canaries_absent(&exit.bin.journaled_text(), &canaries, "the journal");
    report.insert(
        "1-scheduled-draft".into(),
        json!({
            "settlingAtDay3": settling["status"], "readyAtDay8": ready["status"],
            "sessions": ready["sessions"], "drafted": run["counts"]["drafted"],
            "proposal": id, "doc": doc, "drafterRun": drafter["run"] == run["run"],
            "memoryEvidence": evidence.len(), "derivedFrom": record,
            "replayCreated": again[0]["created"], "tamperedAuthority": refused[0]["error"]["details"]["check"],
            "canariesChecked": canaries.len(), "stdoutBytes": stdout.len(),
        }),
    );
    (
        id,
        json!({ "fact": fact.text, "item": item, "settledAt": ready["settledAt"], "doc": doc, "candidate": candidate }),
    )
}

/// 2. Approved from the command line.
fn approved(exit: &Exit, report: &mut Map<String, Value>, id: &str) {
    let (code, result, terminal) = exit
        .bin
        .at_terminal("knowledge-approve", &json!({ "proposal": id }));
    assert_eq!(code, 0, "{result}\n{terminal}");
    assert_eq!(result["success"], true, "{result}");
    // The preview came first: the drafter, the verified label and the diff, each line `> `.
    let preview: Vec<&str> = terminal
        .lines()
        .filter(|line| line.starts_with("> "))
        .collect();
    let shown = preview.join("\n");
    assert!(shown.contains(id), "{terminal}");
    assert!(shown.contains("curator"), "{terminal}");
    assert!(shown.contains("verified against memory"), "{terminal}");
    assert!(shown.contains("> | +"), "the diff: {terminal}");
    let at = |needle: &str| {
        terminal
            .find(needle)
            .unwrap_or_else(|| panic!("{needle}: {terminal}"))
    };
    assert!(at("verified against memory") < at("Apply this proposal to the knowledge base?"));
    let proposal = exit.proposal(id);
    assert_eq!(proposal["state"], "applied", "{proposal}");
    assert_eq!(proposal["exception"], Value::Null, "{proposal}");
    assert_eq!(proposal["decision"]["channel"], "terminal");
    assert_eq!(proposal["decision"]["by"]["kind"], "human");
    assert_eq!(proposal["decision"]["by"]["id"], "local");
    report.insert(
        "2-approved".into(),
        json!({
            "previewLines": preview.len(), "exception": proposal["exception"],
            "channel": proposal["decision"]["channel"], "approver": "human:local",
            "sourcePrincipal": "human:ada",
        }),
    );
}

/// 3. Lands with full provenance.
fn lands(exit: &Exit, report: &mut Map<String, Value>, id: &str, drafted: &Value) {
    let doc = drafted["doc"].as_str().unwrap();
    let path = exit.bin.ws.join(format!("spaces/alpha/{doc}.md"));
    let file = std::fs::read_to_string(&path).unwrap();
    assert_eq!(
        file, drafted["item"]["change"]["content"],
        "the file is the fixed rendering"
    );
    assert!(file.contains("Holds only"), "{file}");
    let provenance = |when: &str| {
        let described = exit.bin.call("knowledge-describe", &json!({ "doc": doc }));
        let envelope = data(&described)["envelope"].clone();
        assert_eq!(envelope["origin"], "agent-inferred", "{when}: {described}");
        assert_eq!(
            envelope["generated"]["by"], "umbel:curator/curator",
            "{when}"
        );
        assert_eq!(envelope["generated"]["at"], drafted["settledAt"], "{when}");
        let lineage = envelope["derivedFrom"].as_array().unwrap();
        assert_eq!(lineage.len(), 1, "{when}: {envelope}");
        assert_eq!(lineage[0]["kind"], "proposal", "{when}");
        assert_eq!(lineage[0]["id"], id, "{when}");
        envelope
    };
    let envelope = provenance("applied");
    let refreshed = exit.bin.call("knowledge-refresh", &json!({}));
    assert_eq!(refreshed["success"], true, "{refreshed}");
    provenance("after knowledge-refresh");
    let word = drafted["fact"]
        .as_str()
        .unwrap()
        .split(' ')
        .find(|w| w.len() == 12)
        .unwrap()
        .to_owned();
    let found = exit.bin.call("knowledge-search", &json!({ "query": word }));
    let hits: Vec<String> = data(&found)["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["doc"].as_str().unwrap_or_default().to_owned())
        .collect();
    assert!(hits.iter().any(|h| h == doc), "{found}");

    // The next run reads the apply back; the candidate is applied, and never drafted again.
    let (run, _) = exit.run();
    assert_eq!(run["counts"]["applied"], 1, "{run}");
    assert_eq!(run["counts"]["drafted"], 0, "{run}");
    let candidate = exit.candidate(drafted["candidate"].as_str().unwrap());
    assert_eq!(candidate["status"], "applied", "{candidate}");
    assert_eq!(candidate["promotedTo"], doc, "{candidate}");
    let commands: Vec<String> = events_of(&exit.bin.ws, "alpha")
        .iter()
        .filter_map(|e| e["command"].as_str().map(str::to_owned))
        .collect();
    for command in ["knowledge-propose-batch", "knowledge-approve"] {
        assert!(
            commands.iter().any(|c| c == command),
            "{command} in {commands:?}"
        );
    }
    let (again, _) = exit.run();
    assert_eq!(again["counts"]["drafted"], 0, "{again}");
    report.insert(
        "3-lands".into(),
        json!({
            "doc": doc, "holdsOnly": true, "origin": envelope["origin"],
            "generatedBy": envelope["generated"]["by"], "generatedAt": envelope["generated"]["at"],
            "derivedFrom": envelope["derivedFrom"], "searchHits": hits.len(),
            "candidate": candidate["status"], "promotedTo": candidate["promotedTo"],
            "events": commands.len(), "secondRunDrafted": again["counts"]["drafted"],
        }),
    );
}

/// The facts of points 4, 5 and 6, written on day 9: the caller's private fact, and two of ada's
/// shared facts.
struct Later {
    private: (Fact, String),
    rejected: (Fact, String),
    forgotten: (Fact, String),
}

fn later(exit: &mut Exit) -> Later {
    exit.bin.at(day(9));
    let private = Fact::new('p');
    let private_id = exit.remember("local", &private, None);
    let rejected = Fact::new('r');
    let rejected_id = exit.remember("ada", &rejected, Some("space"));
    let forgotten = Fact::new('f');
    let forgotten_id = exit.remember("ada", &forgotten, Some("space"));
    exit.bin.at(day(17));
    Later {
        private: (private, private_id),
        rejected: (rejected, rejected_id),
        forgotten: (forgotten, forgotten_id),
    }
}

/// The proposal of `run` whose drafter names `candidate`.
fn drafted_for(exit: &Exit, run: &Value, candidate: &str) -> String {
    run["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_owned())
        .find(|id| exit.proposal(id)["drafter"]["candidate"] == candidate)
        .unwrap_or_else(|| panic!("no draft of {candidate} in {run}"))
}

/// 4. Promotion and self-approval.
fn promotion(exit: &mut Exit, report: &mut Map<String, Value>, later: &Later) -> (String, String) {
    let candidate = candidate_of(&later.private.1);
    let waiting = exit.candidate(&candidate);
    assert_eq!(waiting["status"], "needs-promotion", "{waiting}");
    assert_eq!(waiting["own"], true);
    let hash = waiting["contentHash"].as_str().unwrap().to_owned();

    // The run drafts ada's two shared facts, and not the private one.
    let (run, _) = exit.run();
    assert_eq!(run["counts"]["drafted"], 2, "{run}");
    assert_eq!(run["counts"]["needsPromotion"], 1, "{run}");

    let (code, promoted, _) = exit.bin.at_terminal(
        "curator-promote",
        &json!({ "candidate": candidate, "contentHash": hash }),
    );
    assert_eq!(code, 0, "{promoted}");
    let (run, _) = exit.run();
    assert_eq!(run["counts"]["drafted"], 1, "{run}");
    let id = drafted_for(exit, &run, &candidate);
    let proposal = exit.proposal(&id);
    assert_eq!(proposal["drafter"]["mode"], "promoted", "{proposal}");
    assert_eq!(proposal["drafter"]["promotedBy"], "human:local");

    let (code, refused, _) = exit
        .bin
        .at_terminal("knowledge-approve", &json!({ "proposal": id }));
    assert_ne!(code, 0, "{refused}");
    assert_eq!(code_of(&refused), "PROPOSAL_SELF_APPROVAL", "{refused}");
    assert_eq!(exit.proposal(&id)["state"], "pending");
    let local = exit.local.clone();
    exit.configure(&local, true);
    let (code, applied, _) = exit
        .bin
        .at_terminal("knowledge-approve", &json!({ "proposal": id }));
    assert_eq!(code, 0, "{applied}");
    let decided = exit.proposal(&id);
    assert_eq!(decided["state"], "applied", "{decided}");
    assert_eq!(decided["exception"], "self-approval", "{decided}");
    exit.configure(&local, false);
    report.insert(
        "4-promotion".into(),
        json!({
            "before": waiting["status"], "promotedBy": proposal["drafter"]["promotedBy"],
            "mode": proposal["drafter"]["mode"], "withoutException": code_of(&refused),
            "exception": decided["exception"],
        }),
    );
    let rejected = drafted_for_run_candidates(exit, &later.rejected.1);
    let forgotten = drafted_for_run_candidates(exit, &later.forgotten.1);
    (rejected, forgotten)
}

/// The open draft of ada's `record`, from the knowledge plugin's list.
fn drafted_for_run_candidates(exit: &Exit, record: &str) -> String {
    let candidate = candidate_of(record);
    let listed = exit
        .bin
        .call("knowledge-proposal-list", &json!({ "state": "pending" }));
    data(&listed)["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .find(|id| exit.proposal(id)["drafter"]["candidate"] == candidate.as_str())
        .unwrap_or_else(|| panic!("no open draft of {record}: {listed}"))
}

fn code_of(result: &Value) -> String {
    result["error"]["code"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

/// 5. Feedback.
fn feedback(exit: &mut Exit, report: &mut Map<String, Value>, later: &Later, id: &str) {
    let candidate = candidate_of(&later.rejected.1);
    let (code, rejected, _) = exit.bin.at_terminal(
        "knowledge-reject",
        &json!({ "proposal": id, "reason": "Not in production." }),
    );
    assert_eq!(code, 0, "{rejected}");
    let (run, _) = exit.run();
    assert_eq!(run["counts"]["rejected"], 1, "{run}");
    let quiet = exit.candidate(&candidate);
    assert_eq!(quiet["status"], "rejected", "{quiet}");
    let until = quiet["quietUntil"].as_str().unwrap().to_owned();
    assert_eq!(
        until,
        umbel_store::memory::format_instant(day(17) + 90 * DAY)
    );
    exit.bin.at(day(77));
    let (run, _) = exit.run();
    assert_eq!(run["counts"]["drafted"], 0, "{run}");
    assert_eq!(exit.candidate(&candidate)["status"], "rejected");
    report.insert(
        "5-feedback".into(),
        json!({ "status": quiet["status"], "quietUntil": until, "draftedAtDay77": run["counts"]["drafted"] }),
    );
}

/// 6. Forgotten evidence.
fn forgotten(exit: &mut Exit, report: &mut Map<String, Value>, later: &Later, id: &str) {
    exit.bin.at(day(78));
    let fact = &later.forgotten.0;
    let record = later.forgotten.1.clone();
    let canaries = fact.canaries();
    let before = exit.proposal(id);
    assert_eq!(before["state"], "pending");
    let hash = before["evidence"][0]["contentHash"]
        .as_str()
        .unwrap()
        .to_owned();
    let hex = hash.trim_start_matches("sha256:").to_owned();
    assert!(
        exit.store_bytes().contains(&fact.text),
        "the probe sees the draft first"
    );

    // ada forgets it, at a terminal of the binary.
    let local = exit.local.clone();
    exit.configure("ada", false);
    let forgot = exit
        .bin
        .person("memory-forget", &json!({ "ids": [record] }));
    assert_eq!(data(&forgot)["erased"], 1, "{forgot}");
    exit.configure(&local, false);

    let (run, stdout) = exit.run();
    assert_eq!(run["counts"]["withdrawn"], 1, "{run}");
    assert_eq!(run["checkpoint"], "clean", "{run}");
    let after = exit.proposal(id);
    assert_eq!(after["state"], "withdrawn", "{after}");
    assert!(after["redacted"].is_object(), "{after}");
    assert_eq!(after["id"], before["id"]);
    assert_eq!(after["change"]["doc"], before["change"]["doc"]);
    let doc = after["change"]["doc"].as_str().unwrap();
    let opaque = doc.strip_prefix("notes/learned/c-").unwrap();
    assert!(
        opaque.len() == 20 && opaque.bytes().all(|b| b.is_ascii_hexdigit()),
        "{doc}"
    );

    let mut needles = canaries.clone();
    needles.push(hex.clone());
    canaries_absent(&exit.store_bytes(), &needles, "store.sqlite3 and its log");
    canaries_absent(
        &exit.bin.journaled_text(),
        &needles,
        "the journal and the events",
    );
    canaries_absent(&exit.curator_records(), &needles, "the curator records");
    canaries_absent(&stdout, &needles, "curator-run's stdout");
    let left = holding(
        &exit.bin.ws,
        &support::needles(&needles.iter().map(String::as_str).collect::<Vec<_>>()),
    );
    assert!(
        left.is_empty(),
        "in the workspace after the forget: {left:?}"
    );
    report.insert(
        "6-forgotten".into(),
        json!({
            "withdrawn": run["counts"]["withdrawn"], "checkpoint": run["checkpoint"],
            "redacted": after["redacted"]["reason"], "state": after["state"],
            "needlesChecked": needles.len(), "workspaceFilesHolding": left.len(),
        }),
    );
}

/// 7. Not in the request path.
fn not_in_the_request_path(exit: &Exit, report: &mut Map<String, Value>) {
    const CLI_ONLY: [&str; 11] = [
        "curator-candidates",
        "curator-promote",
        "curator-status",
        "curator-plan",
        "curator-finish",
        "curator-run",
        "knowledge-approve",
        "knowledge-reject",
        "knowledge-verify",
        "knowledge-auto-approve",
        "knowledge-proposal-preview",
    ];
    let before = exit.bin.call("knowledge-proposal-list", &json!({}));
    let proposal_states: Vec<String> = data(&before)["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["state"].as_str().unwrap().to_owned())
        .collect();
    let runs = exit.runs();
    let mut mcp = exit.bin.mcp();
    let tools = mcp.tool_names();
    let discovered = mcp.call("afd-discover", &json!({ "limit": 200 }));
    let listed: Vec<String> = discovered["data"]["commands"]
        .as_array()
        .unwrap_or_else(|| panic!("{discovered}"))
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        listed.iter().any(|n| n == "knowledge-search"),
        "the listing is real: {listed:?}"
    );
    for name in CLI_ONLY {
        assert!(!tools.iter().any(|t| t == name), "{name} in tools/list");
        assert!(!listed.iter().any(|t| t == name), "{name} discovered");
        let called = mcp.call(
            "afd-call",
            &json!({ "command": name, "input": { "space": "alpha" } }),
        );
        assert_eq!(called["success"], false, "{name}: {called}");
        assert_eq!(
            called["error"]["code"], "COMMAND_NOT_FOUND",
            "{name}: {called}"
        );
        let direct = mcp.call_raw(name, &json!({ "space": "alpha" }));
        assert!(
            direct.get("error").is_some() || direct["result"]["isError"] == true,
            "{name}: {direct}"
        );
        let batch = mcp.call(
            "afd-batch",
            &json!({ "commands": [{ "command": name, "input": { "space": "alpha" } }] }),
        );
        assert_eq!(
            batch["results"][0]["result"]["success"], false,
            "{name}: {batch}"
        );
        let pipe = mcp.call(
            "afd-pipe",
            &json!({ "steps": [{ "command": name, "input": { "space": "alpha" } }] }),
        );
        assert_ne!(pipe["steps"][0]["status"], "success", "{name}: {pipe}");
    }
    // Nothing the agent tried decided, drafted or ran anything.
    let after = exit.bin.call("knowledge-proposal-list", &json!({}));
    let states: Vec<String> = data(&after)["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["state"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(states, proposal_states, "{after}");
    assert_eq!(exit.runs(), runs, "no run took place");
    drop(mcp);
    report.insert(
        "7-not-in-the-request-path".into(),
        json!({ "commands": CLI_ONLY.len(), "lanes": ["tools/list", "afd-discover", "afd-call", "tools/call", "afd-batch", "afd-pipe"],
                "tools": tools.len(), "discovered": listed.len(), "runsBefore": runs, "runsAfter": exit.runs() }),
    );
}

#[tokio::test]
async fn the_phase_4_exit_criterion() {
    let temp = tempfile::tempdir().unwrap();
    let bin = Bin::new(temp.path(), &workspace("local", false, false), CLOCK);
    std::fs::create_dir_all(bin.ws.join("spaces/alpha/notes")).unwrap();
    let mut exit = Exit {
        bin,
        local: "local".into(),
        self_approval: false,
    };
    let doctor = exit.bin.call("workspace-doctor", &json!({}));
    assert_eq!(doctor["success"], true, "{doctor}");
    let mut report = Map::new();

    let (id, drafted) = scheduled_draft(&mut exit, &mut report).await;
    approved(&exit, &mut report, &id);
    lands(&exit, &mut report, &id, &drafted);
    let later = later(&mut exit);
    let (rejected, forgotten_id) = promotion(&mut exit, &mut report, &later);
    feedback(&mut exit, &mut report, &later, &rejected);
    forgotten(&mut exit, &mut report, &later, &forgotten_id);
    not_in_the_request_path(&exit, &mut report);

    let path = std::env::var_os("UMBEL_CURATOR_EXIT_REPORT").map_or_else(
        || temp.path().join("curator-exit-report.json"),
        std::path::PathBuf::from,
    );
    let report = Value::Object(report);
    std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    eprintln!("report: {}\n{report:#}", path.display());
}
