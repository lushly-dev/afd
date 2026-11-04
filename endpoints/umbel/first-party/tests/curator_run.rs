//! `curator-run` against the real knowledge plugin (phase 4 specification, sections 3.1, 6, 7 and
//! 9.1; step 5). The curator's own pipeline plans under the caller's reader filter, the knowledge
//! plugin verifies every draft against the memory store before it stores it, a person decides at
//! a terminal, and the next run reads the decision back; a forgotten source's draft is redacted;
//! documents due are proposed for verification and a named successor for deprecation, which an
//! area that opts into `deprecate-declared` applies when a person's applied proposal declared it
//! (step 6). The curator never approves: a pipeline whose step is `knowledge-approve` is refused
//! even when a person answers yes.
//!
//! This crate links the curator beside the knowledge plugin (D3), in the binary since step 7.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel_sdk::{Cx, Outcome, Plugin, failure};
use umbel_store::conformance::samples;
use umbel_store::memory::{DAY_MS, Forget, format_instant};
use umbel_store::{
    Authority, ContentHash, DocumentStore, Expect, ForgetSelector, MemoryStore, MemoryWrite, Origin,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions};

/// When the records are written, 2026-01-01T00:00:00.000Z.
const T0: i64 = 1_767_225_600_000;

const SUBJECT: &str = "Staging rollbacks zebracanary";
const TEXT: &str = "Use the canary flag, zebracanary.";
const CONSTRAINT: &str = "staging only zebracanary";

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
[plugins.curator.grants.records_write]
allow = ["alpha"]

[plugins.curator.config.spaces.alpha]
collection = "notes"
prefix = "learned"
"#;

/// A plugin whose pipeline would approve: the curator never has one, and the host refuses it.
struct Approver;

impl Plugin for Approver {
    fn manifest(&self) -> &'static str {
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "approver"
title = "Approver"
version = "0.1.0"
description = "A pipeline whose step is knowledge-approve."
kind = "compiled"
domains = ["approver"]

[[commands]]
name = "approver-noop"
description = "Nothing."
effects = ["inspect"]
input_schema = { type = "object" }
expose = { mcp = false, agent = false, cli = true }

[[pipelines]]
name = "approver-run"
description = "Approve a proposal from inside a pipeline."
effects = ["store-write", "workspace-write"]
input_schema = { type = "object", properties = { proposal = { type = "string" } }, additionalProperties = false }
expose = { mcp = false, agent = false, cli = true }
journal = { mode = "digest" }
steps = [{ command = "knowledge-approve", input = { space = "alpha", proposal = "$input.proposal" } }]
"#
    }

    fn handle(&self, name: &str, _input: Value, _cx: &mut Cx) -> Outcome {
        failure("COMMAND_NOT_FOUND", name, "Run its pipeline.")
    }
}

/// A scripted terminal where a person answers `answer`.
struct Terminal {
    answer: bool,
    asked: Mutex<Vec<String>>,
}

impl Console for Terminal {
    fn is_interactive(&self) -> bool {
        true
    }

    fn ask(&self, text: &str) -> bool {
        self.asked.lock().unwrap().push(text.to_owned());
        self.answer
    }

    fn show(&self, _text: &str) {}
}

fn configure(builder: HostBuilder, clock: i64) -> HostBuilder {
    builder
        .with_compiled(Arc::new(sdk(umbel_plugin_knowledge::plugin())))
        .with_compiled(Arc::new(sdk(umbel_plugin_curator::plugin())))
        .with_compiled(Arc::new(sdk(Approver)))
        .with_clock(fixed_clock(clock))
}

struct Fx {
    dir: tempfile::TempDir,
    host: umbel::Host,
    clock: i64,
}

impl Fx {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let config = CONFIG.replace(
            "enabled = [\"knowledge\", \"curator\"]",
            "enabled = [\"knowledge\", \"curator\", \"approver\"]\n\n[plugins.approver]\nsource = \"compiled:approver\"",
        );
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        std::fs::create_dir_all(dir.path().join("spaces/alpha/notes")).unwrap();
        let host = configure(HostBuilder::open(dir.path()).unwrap(), T0)
            .seal()
            .unwrap();
        Self {
            dir,
            host,
            clock: T0,
        }
    }

    fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.host = configure(HostBuilder::open(self.dir.path()).unwrap(), clock)
            .seal()
            .unwrap();
    }

    fn space(&self) -> std::path::PathBuf {
        self.dir.path().join("state/spaces/alpha")
    }

    fn memory(&self) -> SqliteMemoryStore {
        SqliteMemoryStore::open(&self.space(), "alpha", StoreOptions::default())
            .unwrap()
            .with_machine_backup_exclusion(false)
    }

    fn remember(&mut self, entries: Vec<MemoryWrite>) {
        let store = self.memory();
        for entry in entries {
            store.write(samples::memory_batch(T0, vec![entry])).unwrap();
        }
        drop(store);
        self.at(self.clock);
    }

    fn forget(&mut self, id: &str, owner: &str) {
        self.memory()
            .forget(Forget {
                owner: owner.to_owned(),
                selector: ForgetSelector::Ids(vec![id.to_owned()]),
                at: self.clock,
                trace_id: None,
            })
            .unwrap();
        self.at(self.clock);
    }

    fn document(
        &mut self,
        id: &str,
        text: &str,
        edit: impl FnOnce(&mut umbel_store::DocumentWrite),
    ) {
        let store = SqliteStore::open(&self.space(), "alpha", StoreOptions::default()).unwrap();
        let mut write = samples::document(id, &["space"], text, "seed");
        write.space = "alpha".to_owned();
        write.envelope.space = "alpha".to_owned();
        edit(&mut write);
        store.put_document(write, Expect::Any).unwrap();
        drop(store);
        self.at(self.clock);
    }

    async fn cli(&self, command: &str, input: Value) -> Value {
        let context = self
            .host
            .context(Actor::new(ActorKind::Human).with_id("local"))
            .with_interface(CommandInterface::Cli);
        let result: CommandResult<Value> = self
            .host
            .registry()
            .execute(command, input, Some(context))
            .await;
        serde_json::to_value(result).unwrap()
    }

    /// `curator-run`'s report.
    async fn run(&self) -> Value {
        let result = self.cli("curator-run", json!({ "space": "alpha" })).await;
        assert_eq!(result["success"], true, "{result}");
        result["data"].clone()
    }

    /// The command line in process, at a terminal where the person answers `answer`.
    async fn terminal(&self, args: &[&str], answer: bool) -> (i32, Value, Vec<String>) {
        let console = Arc::new(Terminal {
            answer,
            asked: Mutex::new(Vec::new()),
        });
        let mut environment = Environment::from_process();
        environment.cwd = self.dir.path().to_path_buf();
        environment.workspace = None;
        environment.console = console.clone();
        environment.vars.clear();
        let mut stdout = Vec::new();
        let clock = self.clock;
        let code = umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder: HostBuilder| configure(builder, clock),
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        let value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not JSON ({error}): {text}"));
        let asked = console.asked.lock().unwrap().clone();
        (code, value, asked)
    }

    async fn proposal(&self, id: &str) -> Value {
        let shown = self
            .cli(
                "knowledge-proposal-show",
                json!({ "space": "alpha", "proposal": id }),
            )
            .await;
        assert_eq!(shown["success"], true, "{shown}");
        shown["data"]["proposal"].clone()
    }

    fn store_bytes(&self) -> String {
        let store = SqliteStore::open(&self.space(), "alpha", StoreOptions::default()).unwrap();
        let dir = store.database_path().parent().unwrap().to_path_buf();
        let mut text = String::new();
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("store.sqlite3") {
                text.push_str(&String::from_utf8_lossy(
                    &std::fs::read(entry.path()).unwrap(),
                ));
            }
        }
        text
    }

    fn journal(&self) -> String {
        let mut text = String::new();
        for relative in [
            "state/journal.jsonl",
            "state/log.jsonl",
            "state/spaces/alpha/events.jsonl",
        ] {
            text.push_str(
                &std::fs::read_to_string(self.dir.path().join(relative)).unwrap_or_default(),
            );
        }
        text
    }
}

fn day(n: i64) -> i64 {
    T0 + n * DAY_MS
}

/// Ada's semantic fact `n`, readable by the space, with a constraint and canaries, observed in
/// two sessions.
fn shared(n: u64) -> Vec<MemoryWrite> {
    let mut entry = samples::memory_entry(n, "human:ada", &["space"], SUBJECT, TEXT);
    entry.scope.space = "alpha".to_owned();
    entry.scope.session = Some("s1".to_owned());
    entry.valid_from = T0;
    entry.expires_at = T0 + 400 * DAY_MS;
    entry.envelope.origin = Origin::UserStated;
    entry.envelope.observed_at = format_instant(T0);
    entry.envelope.constraints = Some(vec![CONSTRAINT.to_owned()]);
    samples::set_authority(&mut entry, Authority::Person);
    samples::agree(&mut entry);
    let mut observed = entry.clone();
    observed.id = samples::memory_id(n + 100);
    observed.scope.session = Some("s2".to_owned());
    samples::agree(&mut observed);
    vec![entry, observed]
}

fn never_mentions(haystack: &str, needles: &[&str]) {
    for needle in needles {
        assert!(!haystack.contains(needle), "found {needle:?}");
    }
}

#[tokio::test]
async fn a_run_drafts_through_the_knowledge_plugin_and_reads_a_rejection_back() {
    let mut fx = Fx::new();
    fx.remember(shared(1));
    fx.at(day(8));
    let report = fx.run().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert!(report["refused"].as_array().unwrap().is_empty(), "{report}");
    let id = report["proposals"][0].as_str().unwrap().to_owned();
    let proposal = fx.proposal(&id).await;
    assert_eq!(proposal["state"], "pending");
    assert_eq!(proposal["drafter"]["plugin"], "curator");
    assert_eq!(proposal["drafter"]["pipeline"], "curator-run");
    assert_eq!(proposal["drafter"]["run"], report["run"]);
    assert_eq!(proposal["drafter"]["mode"], "scheduled");
    let candidate = umbel_okf::draft::candidate_id("alpha", "human:local", &samples::memory_id(1));
    assert_eq!(proposal["drafter"]["candidate"], candidate.as_str());
    assert_eq!(
        proposal["change"]["doc"],
        format!("notes/learned/{candidate}")
    );
    // The run's own answer and the journal hold no memory text.
    let (code, out, _) = fx
        .terminal(&["call", "curator-run", r#"{"space": "alpha"}"#], false)
        .await;
    assert_eq!(code, 0, "{out}");
    assert_eq!(out["data"]["counts"]["drafted"], 0, "{out}");
    let canaries = [SUBJECT, TEXT, CONSTRAINT, "zebracanary"];
    never_mentions(&out.to_string(), &canaries);
    never_mentions(&report.to_string(), &canaries);
    never_mentions(&fx.journal(), &canaries);

    // A person rejects it at a terminal; the next run reads the rejection back and stays quiet.
    let (code, rejected, _) = fx
        .terminal(
            &[
                "call",
                "knowledge-reject",
                &json!({ "space": "alpha", "proposal": id, "reason": "Not in production" })
                    .to_string(),
            ],
            true,
        )
        .await;
    assert_eq!(code, 0, "{rejected}");
    let report = fx.run().await;
    assert_eq!(report["counts"]["rejected"], 1, "{report}");
    assert_eq!(report["counts"]["drafted"], 0);
    fx.at(day(60));
    assert_eq!(fx.run().await["counts"]["drafted"], 0);
}

#[tokio::test]
async fn an_approved_draft_lands_and_is_never_drafted_again() {
    let mut fx = Fx::new();
    fx.remember(shared(1));
    fx.at(day(8));
    let report = fx.run().await;
    let id = report["proposals"][0].as_str().unwrap().to_owned();
    let (code, approved, asked) = fx
        .terminal(
            &[
                "call",
                "knowledge-approve",
                &json!({ "space": "alpha", "proposal": id }).to_string(),
            ],
            true,
        )
        .await;
    assert_eq!(code, 0, "{approved}");
    assert!(!asked.is_empty(), "a person was asked");
    let report = fx.run().await;
    assert_eq!(report["counts"]["applied"], 1, "{report}");
    let status = fx.cli("curator-status", json!({ "space": "alpha" })).await;
    assert_eq!(status["data"]["lastRun"], report, "{status}");
    for at in [day(9), day(300)] {
        fx.at(at);
        let report = fx.run().await;
        assert_eq!(report["counts"]["drafted"], 0, "{report}");
    }
}

#[tokio::test]
async fn a_forgotten_source_is_redacted_by_the_next_run() {
    let mut fx = Fx::new();
    fx.remember(shared(1));
    fx.at(day(8));
    let report = fx.run().await;
    let id = report["proposals"][0].as_str().unwrap().to_owned();
    let hash = fx
        .memory()
        .get(
            &samples::memory_id(1),
            umbel_store::AsOf::at(day(8)),
            umbel_store::ReadFlags::at(day(8)),
            &umbel_store::ReaderFilter::tokens(["space"]).unwrap(),
        )
        .unwrap()
        .unwrap()
        .content_hash
        .as_str()
        .to_owned();
    fx.forget(&samples::memory_id(1), "human:ada");
    let report = fx.run().await;
    assert_eq!(report["counts"]["withdrawn"], 1, "{report}");
    assert_eq!(report["checkpoint"], "clean");
    let proposal = fx.proposal(&id).await;
    assert_eq!(proposal["state"], "withdrawn");
    assert!(proposal["redacted"].is_object(), "{proposal}");
    // The proposal's id and path stand; its text and the source's hash are gone from the bytes.
    never_mentions(
        &fx.store_bytes(),
        &[SUBJECT, TEXT, CONSTRAINT, "zebracanary", hash.as_str()],
    );
    never_mentions(
        &fx.journal(),
        &[SUBJECT, TEXT, "zebracanary", hash.as_str()],
    );
}

#[tokio::test]
async fn due_documents_and_named_successors_are_proposed_and_accepted() {
    let mut fx = Fx::new();
    let stale = format_instant(day(10));
    fx.document(
        "notes/due",
        &format!("---\ntitle: Due\nstale_after: \"{stale}\"\n---\nBody.\n"),
        |write| write.stale_after = Some(stale.clone()),
    );
    fx.document("notes/new", "---\ntitle: New\n---\nBody.\n", |_| {});
    fx.document(
        "notes/old",
        "---\ntitle: Old\nsuperseded_by: new\n---\nBody.\n",
        |write| write.superseded_by = Some("new".into()),
    );
    fx.at(day(1));
    let report = fx.run().await;
    assert!(report["refused"].as_array().unwrap().is_empty(), "{report}");
    assert_eq!(report["counts"]["reverify"], 1, "{report}");
    assert_eq!(report["counts"]["deprecate"], 1, "{report}");
    let ops: Vec<(String, String)> = {
        let mut ops = Vec::new();
        for id in report["proposals"].as_array().unwrap() {
            let proposal = fx.proposal(id.as_str().unwrap()).await;
            ops.push((
                proposal["change"]["op"].as_str().unwrap().to_owned(),
                proposal["change"]["doc"].as_str().unwrap().to_owned(),
            ));
        }
        ops
    };
    assert!(
        ops.contains(&("verify".into(), "notes/due".into())),
        "{ops:?}"
    );
    assert!(
        ops.contains(&("deprecate".into(), "notes/old".into())),
        "{ops:?}"
    );
    // Drafted again only once decided.
    assert_eq!(fx.run().await["counts"]["reverify"], 0);
}

#[tokio::test]
async fn a_successor_a_person_declared_is_deprecated_by_the_areas_rule() {
    const OLD: &str = "---\ntitle: Old\n---\nBody.\n";
    const DECLARED: &str = "---\ntitle: Old\nsuperseded_by: new\n---\nBody.\n";
    let mut fx = Fx::new();
    // The area opts into the rule (section 8.3; off by default).
    let path = fx.dir.path().join("umbel.toml");
    let config = std::fs::read_to_string(&path).unwrap().replace(
        "[plugins.knowledge.config.areas.notes]\nspace = \"alpha\"\ncollection = \"notes\"\n",
        "[plugins.knowledge.config.areas.notes]\nspace = \"alpha\"\ncollection = \"notes\"\nauto = [\"deprecate-declared\"]\n",
    );
    assert!(config.contains("auto = "));
    std::fs::write(&path, config).unwrap();
    for (id, text) in [
        ("notes/old", OLD),
        ("notes/new", "---\ntitle: New\n---\nBody.\n"),
    ] {
        std::fs::write(fx.dir.path().join(format!("spaces/alpha/{id}.md")), text).unwrap();
        fx.document(id, text, |_| {});
    }
    // A person approves, at the terminal, an agent's update declaring the successor.
    let context = fx
        .host
        .context(
            Actor::new(ActorKind::Agent)
                .with_id("bo")
                .with_on_behalf_of("bo"),
        )
        .with_interface(CommandInterface::Mcp);
    let proposed: CommandResult<Value> = fx
        .host
        .registry()
        .execute(
            "knowledge-propose",
            json!({
                "space": "alpha",
                "idempotency_key": "declare",
                "change": {
                    "op": "update", "doc": "notes/old",
                    "baseHash": ContentHash::of(OLD.as_bytes()).to_string(), "content": DECLARED,
                },
                "rationale": "The page says what replaced it.",
                "evidence": [{ "kind": "text", "ref": "team notes" }],
            }),
            Some(context),
        )
        .await;
    let proposed = serde_json::to_value(proposed).unwrap();
    let declared = proposed["data"]["proposal"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("{proposed}"))
        .to_owned();
    let (code, approved, _) = fx
        .terminal(
            &[
                "call",
                "knowledge-approve",
                &json!({ "space": "alpha", "proposal": declared }).to_string(),
            ],
            true,
        )
        .await;
    assert_eq!(code, 0, "{approved}");

    // The curator's run drafts the deprecate, and the area's rule applies it as its decision.
    fx.at(day(1));
    let report = fx.run().await;
    assert_eq!(report["counts"]["deprecate"], 1, "{report}");
    let id = report["proposals"][0].as_str().unwrap().to_owned();
    let result = fx
        .cli("knowledge-auto-approve", json!({ "space": "alpha" }))
        .await;
    assert_eq!(
        result["data"]["applied"][0]["proposal"],
        id.as_str(),
        "{result}"
    );
    let proposal = fx.proposal(&id).await;
    assert_eq!(proposal["state"], "applied", "{proposal}");
    let text = std::fs::read_to_string(fx.dir.path().join("spaces/alpha/notes/old.md")).unwrap();
    assert!(text.contains("status: \"deprecated\""), "{text}");
    let record = SqliteStore::open(&fx.space(), "alpha", StoreOptions::default())
        .unwrap()
        .get_record(
            "knowledge",
            "proposal",
            &id,
            &umbel_store::ReaderFilter::derivation(),
        )
        .unwrap()
        .unwrap();
    assert_eq!(record.body["decision"]["channel"], "policy");
    assert_eq!(record.body["decision"]["by"]["id"], "policy:notes");
    assert_eq!(record.body["policy"]["rule"], "auto:deprecate-declared");
    // The next run reads the decision back and drafts nothing for the deprecated document.
    let report = fx.run().await;
    assert_eq!(report["counts"]["deprecate"], 0, "{report}");
}

#[tokio::test]
async fn no_pipeline_approves_even_when_a_person_answers_yes() {
    let mut fx = Fx::new();
    fx.remember(shared(1));
    fx.at(day(8));
    let report = fx.run().await;
    let id = report["proposals"][0].as_str().unwrap().to_owned();
    let (code, out, _) = fx
        .terminal(
            &[
                "call",
                "approver-run",
                &json!({ "proposal": id }).to_string(),
            ],
            true,
        )
        .await;
    assert_ne!(code, 0, "{out}");
    assert_eq!(out["success"], false, "{out}");
    // The command line's mark names the pipeline, not `knowledge-approve`, so approve's
    // `require-human` gate refuses inside it (section 3.3).
    assert_eq!(out["error"]["code"], "CONFIRMATION_REQUIRED", "{out}");
    assert_eq!(fx.proposal(&id).await["state"], "pending");
}
