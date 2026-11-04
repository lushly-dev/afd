//! The curator's leak probes (phase 4 specification, sections 5, 12 and 13): `human:bo` sees none
//! of `human:ada`'s candidates, drafts, counts, cursors, hashes, records or reports, through any
//! curator surface or the knowledge plugin's proposal surfaces. Library actors on the command-line
//! interface (exact until phase 5), and the command line in process with a scripted terminal for
//! `curator-promote`, on the five first-party plugins as the binary links them.
//!
//! The probe is differential, as phase 3's planted term was: two workspaces hold the same records
//! bo can read and the same runs of ada's over them, and one of them also everything of ada's bo
//! cannot read: private facts in `alpha` (one promoted, one forgotten after a run), a space `beta`
//! only she reads with a draft in it, her runs' candidate, consent, run and state records, and a
//! lock she holds. Bo's every answer is the same in both, once the random run ids are replaced and
//! the document store's revisions (the accepted limit of phase 2 section 6: revision gaps may show
//! how many hidden things exist) are left out. Then, directly: none of ada's hidden ids or hashes is
//! in anything bo was told; every curator record is readable by its principal alone; a shared fact
//! gives bo a candidate of his own with no hash, no draft count and no report of ada's, and his run
//! leaves her draft alone; and ada, in turn, sees nothing of bo's private fact.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandInterface;
use serde_json::{Value, json};
use support::*;
use umbel_okf::draft::{candidate_id, idempotency_key, proposal_id};
use umbel_plugin_curator::records::consent_id;
use umbel_plugin_curator::state::state_id;
use umbel_store::conformance::samples;
use umbel_store::memory::{Forget, format_instant};
use umbel_store::{
    Authority, DocumentStore, Expect, ForgetSelector, MemoryStore, MemoryWrite, Origin,
    ReaderFilter,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions};

fn day(n: i64) -> i64 {
    CLOCK + n * DAY
}

/// `alpha` for everyone, `beta` for ada alone; a `notes` collection, area and curator target in
/// each; the command line is `human:<local>`.
fn workspace(local: &str) -> String {
    format!(
        r#"config_version = 4
default_space = "alpha"

[principal]
local_id = "{local}"

[spaces.alpha]
[spaces.alpha.collections.notes]
root = "spaces/alpha/notes"

[spaces.beta]
readers = ["human:ada"]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

[plugins]
enabled = ["knowledge", "curator"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.graph_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.records_write]
allow = ["alpha", "beta"]
[plugins.knowledge.grants.documents_write]
allow = ["alpha/*", "beta/*"]
[plugins.knowledge.grants.content_write]
allow = ["alpha/*", "beta/*"]

[plugins.knowledge.config.areas.notes]
space = "alpha"
collection = "notes"

[plugins.knowledge.config.areas.beta-notes]
space = "beta"
collection = "notes"

[plugins.knowledge.config.drafters.curator.targets.alpha]
collection = "notes"
prefix = "learned"

[plugins.knowledge.config.drafters.curator.targets.beta]
collection = "notes"
prefix = "learned"

[plugins.curator]
source = "compiled:curator"
[plugins.curator.grants.records_write]
allow = ["alpha", "beta"]

[plugins.curator.config.spaces.alpha]
collection = "notes"
prefix = "learned"

[plugins.curator.config.spaces.beta]
collection = "notes"
prefix = "learned"
"#
    )
}

/// A semantic person fact `n` of `owner` in `space`, readable by `access`, with a constraint,
/// observed in two sessions (written twice, the second as `n + 100`).
fn fact(n: u64, space: &str, owner: &str, access: &[&str], text: &str) -> Vec<MemoryWrite> {
    let mut entry = samples::memory_entry(n, owner, access, &format!("Subject {n}"), text);
    entry.scope.space = space.to_owned();
    entry.scope.session = Some("s1".to_owned());
    entry.valid_from = CLOCK;
    entry.expires_at = CLOCK + 400 * DAY;
    entry.envelope.origin = Origin::UserStated;
    entry.envelope.observed_at = format_instant(CLOCK);
    entry.envelope.constraints = Some(vec!["staging only".to_owned()]);
    samples::set_authority(&mut entry, Authority::Person);
    samples::agree(&mut entry);
    let mut observed = entry.clone();
    observed.id = samples::memory_id(n + 100);
    observed.scope.session = Some("s2".to_owned());
    samples::agree(&mut observed);
    vec![entry, observed]
}

fn memory(dir: &std::path::Path, space: &str) -> SqliteMemoryStore {
    SqliteMemoryStore::open(
        &dir.join(format!("state/spaces/{space}")),
        space,
        StoreOptions::default(),
    )
    .unwrap()
    .with_machine_backup_exclusion(false)
}

fn documents(dir: &std::path::Path, space: &str) -> SqliteStore {
    SqliteStore::open(
        &dir.join(format!("state/spaces/{space}")),
        space,
        StoreOptions::default(),
    )
    .unwrap()
}

fn write(ws: &mut Ws, space: &'static str, entries: Vec<MemoryWrite>) {
    ws.closed(|dir| {
        let store = memory(dir, space);
        for entry in entries {
            store
                .write(samples::memory_batch(CLOCK, vec![entry]))
                .unwrap();
        }
    });
}

/// The ids of ada's hidden things, the same strings in both workspaces.
struct Hidden {
    /// Memory record ids: the promoted fact, the forgotten one, and beta's.
    records: Vec<String>,
    /// Their content hashes, read before the forget.
    hashes: Vec<String>,
    /// Ada's candidate ids of them.
    candidates: Vec<String>,
    /// The promoted fact's consent record id.
    consent: String,
    /// The proposal ada's beta run drafts.
    beta_proposal: String,
}

fn hidden_ids() -> Hidden {
    let records: Vec<String> = [11, 12, 13].into_iter().map(samples::memory_id).collect();
    let candidates: Vec<String> = [("alpha", 0), ("alpha", 1), ("beta", 2)]
        .into_iter()
        .map(|(space, i)| candidate_id(space, "human:ada", &records[i]))
        .collect();
    let beta_proposal = proposal_id(
        "beta",
        "human:ada",
        &idempotency_key("curator", &candidates[2], 0),
    );
    Hidden {
        consent: consent_id(&candidates[0]),
        records,
        hashes: Vec::new(),
        candidates,
        beta_proposal,
    }
}

/// What a person's call answers, for comparison: success, data, error and warnings.
async fn as_cli(ws: &Ws, who: &str, command: &str, input: Value) -> Value {
    seen(
        &ws.call_on(human(who), CommandInterface::Cli, command, input)
            .await,
    )
}

/// `curator-run` as `who` in `space`; the report, asserting success.
async fn run(ws: &Ws, who: &str, space: &str) -> Value {
    let result = as_cli(ws, who, "curator-run", json!({ "space": space })).await;
    data(&result).clone()
}

/// The command line in process as `human:<who>` at a terminal that answers yes.
async fn at_terminal(ws: &mut Ws, who: &str, command: &str, input: Value) -> Value {
    ws.reconfigure(&workspace(who));
    let (result, _) = ws.terminal(command, input, true, &[]).await;
    ws.reconfigure(&workspace("local"));
    seen(&result)
}

/// One workspace: the records bo can read, ada's runs over them, and, when `hidden`, everything of
/// ada's bo cannot read. Returns the workspace at day 10, ada's run ids, and the hashes of the
/// hidden records.
async fn seeded(hidden: bool, ids: &Hidden) -> (Ws, Vec<String>, Vec<String>) {
    let mut ws = Ws::with_config(
        &workspace("local"),
        &["spaces/alpha/notes", "spaces/beta/notes"],
    );
    // What bo can read: ada's shared fact, and his own private one.
    let mut entries = fact(1, "alpha", "human:ada", &["space"], "Use the canary flag.");
    entries.extend(fact(
        2,
        "alpha",
        "human:bo",
        &["principal:human:bo"],
        "Bo's own note.",
    ));
    let mut hashes = Vec::new();
    if hidden {
        entries.extend(fact(
            11,
            "alpha",
            "human:ada",
            &["principal:human:ada"],
            "Ada's first private note.",
        ));
        entries.extend(fact(
            12,
            "alpha",
            "human:ada",
            &["principal:human:ada"],
            "Ada's second private note.",
        ));
    }
    write(&mut ws, "alpha", entries);
    if hidden {
        write(
            &mut ws,
            "beta",
            fact(13, "beta", "human:ada", &["space"], "Ada's beta note."),
        );
        let reader = ReaderFilter::tokens(["space", "principal:human:ada"]).unwrap();
        for (space, id) in [
            ("alpha", &ids.records[0]),
            ("alpha", &ids.records[1]),
            ("beta", &ids.records[2]),
        ] {
            let record = ws.closed(|dir| {
                memory(dir, space)
                    .get(
                        id,
                        umbel_store::AsOf::at(CLOCK),
                        umbel_store::ReadFlags::at(CLOCK),
                        &reader,
                    )
                    .unwrap()
                    .unwrap()
            });
            hashes.push(record.content_hash.as_str().to_owned());
        }
    }

    // Day 8: ada's runs draft the shared fact (and, hidden, beta's).
    let mut runs = Vec::new();
    ws.at(day(8));
    let alpha = run(&ws, "ada", "alpha").await;
    assert_eq!(alpha["counts"]["drafted"], 1, "{alpha}");
    runs.push(alpha["run"].as_str().unwrap().to_owned());
    if hidden {
        let beta = run(&ws, "ada", "beta").await;
        assert_eq!(beta["counts"]["drafted"], 1, "{beta}");
        assert_eq!(beta["proposals"][0], ids.beta_proposal.as_str());
        runs.push(beta["run"].as_str().unwrap().to_owned());
    }

    // Day 9: ada forgets her second private fact, runs again, and promotes the first.
    ws.at(day(9));
    if hidden {
        let forgotten = ids.records[1].clone();
        ws.closed(|dir| {
            memory(dir, "alpha")
                .forget(Forget {
                    owner: "human:ada".to_owned(),
                    selector: ForgetSelector::Ids(vec![forgotten]),
                    at: day(9),
                    trace_id: None,
                })
                .unwrap();
        });
    }
    let again = run(&ws, "ada", "alpha").await;
    runs.push(again["run"].as_str().unwrap().to_owned());
    if hidden {
        assert_eq!(again["counts"]["needsPromotion"], 1, "{again}");
        let listed = as_cli(&ws, "ada", "curator-candidates", json!({})).await;
        let promoted = data(&listed)["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["candidate"] == ids.candidates[0].as_str())
            .unwrap()
            .clone();
        assert_eq!(promoted["status"], "needs-promotion", "{listed}");
        let consented = at_terminal(
            &mut ws,
            "ada",
            "curator-promote",
            json!({ "candidate": ids.candidates[0], "contentHash": promoted["contentHash"] }),
        )
        .await;
        assert_eq!(consented["success"], true, "{consented}");
        let erased = data(&listed)["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["candidate"] == ids.candidates[1].as_str() && c["status"] == "erased");
        assert!(erased, "the forgotten fact's candidate is erased: {listed}");
        // And she holds her lock, as a run of hers in progress would.
        let state = state_id("alpha", "human:ada");
        ws.closed(|dir| {
            let store = documents(dir, "alpha");
            let record = store
                .get_record("curator", "state", &state, &ReaderFilter::derivation())
                .unwrap()
                .unwrap();
            let mut body = record.body.clone();
            body["lock"] =
                json!({ "trace": "ada-run", "until": format_instant(day(10) + 300_000) });
            store
                .put_record(
                    "curator",
                    "state",
                    &state,
                    body,
                    record.envelope,
                    Expect::Any,
                )
                .unwrap();
        });
    }
    ws.at(day(10));
    (ws, runs, hashes)
}

/// Bo's every probe, in order: what each answered.
async fn probes(ws: &mut Ws, ids: &Hidden) -> Vec<(String, Value)> {
    let bo_of_hidden = candidate_id("alpha", "human:bo", &ids.records[0]);
    let mut out = Vec::new();
    let statuses = [
        "settling",
        "ready",
        "drafted",
        "needs-promotion",
        "skipped",
        "rejected",
        "applied",
        "erased",
    ];
    macro_rules! probe {
        ($label:expr, $command:expr, $input:expr) => {
            let answer = as_cli(ws, "bo", $command, $input).await;
            out.push(($label.to_string(), answer));
        };
    }
    probe!("candidates", "curator-candidates", json!({}));
    for status in statuses {
        probe!(
            format!("candidates {status}"),
            "curator-candidates",
            json!({ "status": [status] })
        );
    }
    for after in [&ids.candidates[0], &ids.candidates[1], &bo_of_hidden] {
        probe!(
            format!("candidates after {after}"),
            "curator-candidates",
            json!({ "after": after })
        );
    }
    probe!(
        "candidates beta",
        "curator-candidates",
        json!({ "space": "beta" })
    );
    probe!("status", "curator-status", json!({}));
    probe!("status beta", "curator-status", json!({ "space": "beta" }));
    probe!("proposals", "knowledge-proposal-list", json!({}));
    probe!(
        "proposals pending",
        "knowledge-proposal-list",
        json!({ "state": "pending" })
    );
    probe!(
        "proposals beta",
        "knowledge-proposal-list",
        json!({ "space": "beta" })
    );
    for space in ["alpha", "beta"] {
        probe!(
            format!("show {space}"),
            "knowledge-proposal-show",
            json!({ "space": space, "proposal": ids.beta_proposal })
        );
        probe!(
            format!("preview {space}"),
            "knowledge-proposal-preview",
            json!({ "space": space, "proposal": ids.beta_proposal })
        );
    }
    probe!("auto-approve", "knowledge-auto-approve", json!({}));
    probe!("plan", "curator-plan", json!({}));
    probe!("finish", "curator-finish", json!({}));
    probe!("run beta", "curator-run", json!({ "space": "beta" }));
    probe!("run", "curator-run", json!({}));
    probe!("candidates after run", "curator-candidates", json!({}));
    probe!("status after run", "curator-status", json!({}));
    probe!("run again", "curator-run", json!({}));
    for (label, candidate) in [
        ("promote ada's", &ids.candidates[0]),
        ("promote bo's of hers", &bo_of_hidden),
    ] {
        let answer = at_terminal(
            ws,
            "bo",
            "curator-promote",
            json!({ "candidate": candidate, "contentHash": "sha256:0123456789abcdef" }),
        )
        .await;
        out.push((label.to_owned(), answer));
    }
    out
}

/// `value` with each run id replaced and every `rev` left out.
fn normalized(value: &Value, runs: &[String]) -> Value {
    let mut text = value.to_string();
    for run in runs {
        text = text.replace(run.as_str(), "<run>");
    }
    let mut value: Value = serde_json::from_str(&text).unwrap();
    strip(&mut value);
    value
}

fn strip(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("rev");
            for item in map.values_mut() {
                strip(item);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(strip),
        _ => {}
    }
}

/// The run ids of bo's reports among `answers`.
fn bo_runs(answers: &[(String, Value)]) -> Vec<String> {
    answers
        .iter()
        .filter_map(|(_, answer)| answer["data"]["run"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn bo_sees_none_of_adas_curator_state() {
    let mut ids = hidden_ids();
    let (mut with, ada_runs, hashes) = seeded(true, &ids).await;
    ids.hashes = hashes;
    let (mut without, ada_runs_without, _) = seeded(false, &ids).await;

    let seen_with = probes(&mut with, &ids).await;
    let seen_without = probes(&mut without, &ids).await;
    let mut runs = ada_runs.clone();
    runs.extend(ada_runs_without);
    runs.extend(bo_runs(&seen_with));
    runs.extend(bo_runs(&seen_without));
    assert_eq!(seen_with.len(), seen_without.len());
    for ((label, a), (_, b)) in seen_with.iter().zip(&seen_without) {
        assert_eq!(
            normalized(a, &runs),
            normalized(b, &runs),
            "bo's `{label}` differs with ada's hidden state"
        );
    }

    // None of ada's hidden ids, hashes or run ids is in anything bo was told, beyond the ids bo
    // himself asked about.
    let mut told: String = seen_with
        .iter()
        .map(|(_, answer)| format!("{answer}\n"))
        .collect();
    for asked in [&ids.candidates[0], &ids.candidates[1], &ids.beta_proposal] {
        told = told.replace(asked.as_str(), "<asked>");
    }
    // The three hidden facts, each written in two sessions.
    let mut secrets: Vec<String> = ids.records.clone();
    secrets.extend([111, 112, 113].into_iter().map(samples::memory_id));
    secrets.extend(
        ids.hashes
            .iter()
            .map(|hash| hash.trim_start_matches("sha256:").to_owned()),
    );
    secrets.push(ids.candidates[2].clone());
    secrets.push(ids.consent.clone());
    secrets.push(state_id("alpha", "human:ada"));
    secrets.extend(ada_runs.iter().cloned());
    secrets.push("ada-run".into());
    assert_eq!(secrets.len(), 16, "{secrets:?}");
    never_mentions(
        &told,
        &secrets.iter().map(String::as_str).collect::<Vec<_>>(),
    );
    let answer = |label: &str| {
        &seen_with
            .iter()
            .find(|(l, _)| l == label)
            .unwrap_or_else(|| panic!("{label}"))
            .1
    };
    // Every answer about ada's hidden things is the one an absent thing gets.
    assert_eq!(code(answer("candidates beta")), "SPACE_NOT_READABLE");
    assert_eq!(code(answer("show beta")), "SPACE_NOT_READABLE");
    assert_eq!(code(answer("promote ada's")), "CURATOR_CANDIDATE_NOT_FOUND");
    assert_eq!(code(answer("plan")), "CURATOR_RUN_REQUIRED");

    // The shared fact: bo's own candidate, with no hash, no draft count and no report of ada's,
    // her lock not his; his run is refused the open draft and leaves hers alone.
    let shared = candidate_id("alpha", "human:bo", &samples::memory_id(1));
    let candidates = data(answer("candidates"));
    let mine = candidates["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["candidate"] == shared.as_str())
        .unwrap_or_else(|| panic!("{candidates}"));
    assert_eq!(mine["status"], "ready", "{mine}");
    assert_eq!(mine["own"], false);
    assert_eq!(mine["contentHash"], Value::Null);
    assert_eq!(mine["drafts"], 0);
    let status = data(answer("status"));
    assert_eq!(
        status["lastRun"],
        Value::Null,
        "ada's runs are not bo's: {status}"
    );
    assert_eq!(
        status["locked"],
        Value::Null,
        "ada's lock is not bo's: {status}"
    );
    let report = data(answer("run"));
    assert_eq!(report["principal"], "human:bo");
    assert!(
        report["refused"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["code"] == "PROPOSAL_ALREADY_OPEN" && r["candidate"] == shared.as_str()),
        "{report}"
    );
    let proposals = data(answer("proposals"))["proposals"].clone();
    let ada_draft = proposals
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["proposer"]["principal"] == "human:ada")
        .unwrap_or_else(|| panic!("{proposals}"));
    assert_eq!(ada_draft["state"], "pending", "{ada_draft}");
    assert_eq!(
        data(answer("status after run"))["lastRun"]["run"],
        report["run"]
    );
    assert_eq!(data(answer("candidates"))["principal"], "human:bo");

    // Every curator record carries its principal's token. A run, consent, review or state record
    // is readable by its principal alone. A candidate's set is section 2.3's, the intersection of
    // its sources' sets with the principal's token added, so the store's filter admits ada's
    // candidate of the shared fact for bo, as it admits the fact itself; no surface shows it to
    // him, since the curator reads only the caller's own records (step 4, amendment 5), which the
    // answers above hold. Every record of ada's private facts and of beta is hers alone.
    // Bo reads `alpha`, so his filter there holds `space`; `beta` refuses him, so it holds only
    // his own token.
    let shared_sources = [samples::memory_id(1), ids.records[2].clone()];
    let (mut ada_records, mut bo_records, mut shared) = (0, 0, 0);
    with.closed(|dir| {
        for space in ["alpha", "beta"] {
            let bo = if space == "alpha" {
                ReaderFilter::tokens(["space", "principal:human:bo"]).unwrap()
            } else {
                ReaderFilter::tokens(["principal:human:bo"]).unwrap()
            };
            let store = documents(dir, space);
            for kind in ["candidate", "consent", "review", "run", "state"] {
                for record in store
                    .list_records("curator", kind, None, 500, &ReaderFilter::derivation())
                    .unwrap()
                    .items
                {
                    let owner = record.body["principal"].as_str().unwrap().to_owned();
                    let own = format!("principal:{owner}");
                    let of_shared = kind == "candidate"
                        && record.body["sources"].as_array().is_some_and(|sources| {
                            sources
                                .iter()
                                .any(|s| shared_sources.iter().any(|id| s["id"] == id.as_str()))
                        });
                    let expected = if of_shared {
                        shared += 1;
                        vec![own, "space".to_owned()]
                    } else {
                        vec![own]
                    };
                    let mut access = record.envelope.access.clone();
                    access.sort();
                    assert_eq!(access, expected, "{kind} {}", record.id);
                    let readable = store
                        .get_record("curator", kind, &record.id, &bo)
                        .unwrap()
                        .is_some();
                    assert_eq!(
                        readable,
                        owner == "human:bo" || (of_shared && space == "alpha"),
                        "{kind} {}",
                        record.id
                    );
                    if owner == "human:ada" {
                        ada_records += 1;
                    } else {
                        bo_records += 1;
                    }
                }
            }
        }
    });
    assert!(
        ada_records >= 6 && bo_records >= 3,
        "{ada_records} {bo_records}"
    );
    assert_eq!(
        shared, 3,
        "ada's and bo's candidates of the shared fact, and ada's of beta's"
    );

    // And ada, in turn, is told nothing of bo's private fact.
    let ada_view = as_cli(&with, "ada", "curator-candidates", json!({})).await;
    let ada_status = as_cli(&with, "ada", "curator-status", json!({})).await;
    let bo_fact = samples::memory_id(2);
    never_mentions(
        &format!("{ada_view}{ada_status}"),
        &[
            bo_fact.as_str(),
            candidate_id("alpha", "human:ada", &bo_fact).as_str(),
            candidate_id("alpha", "human:bo", &bo_fact).as_str(),
        ],
    );
    eprintln!(
        "curator leak probes: {} answers equal with and without ada's hidden state; {ada_records} of ada's records and {bo_records} of bo's, each with its principal's token",
        seen_with.len()
    );
}
