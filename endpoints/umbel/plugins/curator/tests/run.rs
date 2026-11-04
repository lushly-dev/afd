//! `curator-run` (phase 4 specification, sections 3.1, 7.2 and 7.3): the pipeline and its steps,
//! its answer and journal of ids and counts only, the lock and its owner, takeover of an expired
//! lock, recovery from a run that stopped after its batch, the caps, the rotating scan, the
//! report and `overdue`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_okf::draft;
use umbel_plugin_curator::state::{run_id, state_id};
use umbel_store::memory::format_instant;

const SUBJECT: &str = "Rollbacks zebracanary";
const TEXT: &str = "Use the canary flag, zebracanary.";
const CONSTRAINT: &str = "staging only zebracanary";
const TAG: &str = "tagzebracanary";

fn candidate(lowest: u64) -> String {
    draft::candidate_id("main", "human:local", &mem(lowest))
}

/// Ada's shared fact `n` with canaries in its subject, text, tag and constraint, in two sessions.
fn shared(fx: &mut Fx, n: u64) {
    let mut entry = constrained(
        fact(n, "human:ada", &["space"], SUBJECT, TEXT),
        &[CONSTRAINT],
    );
    entry.tags = vec![TAG.to_owned()];
    umbel_store::conformance::samples::agree(&mut entry);
    fx.remember_twice(entry, n + 100);
}

/// Ada's plain shared fact `n` with its own subject and text, in two sessions.
fn plain(fx: &mut Fx, n: u64) {
    fx.remember_twice(
        fact(
            n,
            "human:ada",
            &["space"],
            &format!("Subject {n}"),
            &format!("Text {n}."),
        ),
        n + 100,
    );
}

fn report_validator() -> jsonschema::Validator {
    let report: Value =
        serde_json::from_str(include_str!("../../../schemas/curator-report.v1.json")).unwrap();
    jsonschema::validator_for(&report).unwrap()
}

#[tokio::test]
async fn a_run_drafts_what_settled_and_answers_with_ids_and_counts_only() {
    let mut fx = Fx::new();
    shared(&mut fx, 1);
    fx.at(day(3));
    let early = fx.report().await;
    assert_eq!(early["counts"]["drafted"], 0, "{early}");
    assert_eq!(early["counts"]["candidates"], 1);
    assert!(fx.stubs().is_empty());

    fx.at(day(8));
    let (code, report) = fx.run_cli().await;
    assert_eq!(code, 0, "{report}");
    let report = &report["data"];
    assert!(report_validator().is_valid(report), "{report:#}");
    let id = candidate(1);
    let stubs = fx.stubs_of(&id);
    assert_eq!(stubs.len(), 1, "{stubs:#?}");
    let stub = &stubs[0];
    assert_eq!(stub["state"], "pending");
    assert_eq!(stub["doc"], format!("notes/learned/{id}"));
    assert_eq!(stub["key"], format!("curator/{id}/0"));
    assert_eq!(stub["drafter"]["plugin"], "curator");
    assert_eq!(stub["drafter"]["instance"], "curator");
    assert_eq!(stub["drafter"]["run"], report["run"]);
    assert_eq!(report["counts"]["drafted"], 1);
    assert_eq!(report["proposals"], json!([stub["id"]]));
    assert_eq!(report["checkpoint"], Value::Null);
    assert_eq!(report["principal"], "human:local");
    assert_eq!(report["at"], format_instant(day(8)));

    // No memory text anywhere the run writes or prints: stdout, the journal, the events, the
    // curator's records.
    let canaries = [SUBJECT, TEXT, CONSTRAINT, TAG, "zebracanary"];
    never_mentions(&report.to_string(), &canaries);
    never_mentions(&fx.journaled_text(), &canaries);
    for kind in ["candidate", "run", "state"] {
        for record in fx.curator_records(kind) {
            assert!(
                record_validator().is_valid(&record.body),
                "{:#}",
                record.body
            );
            never_mentions(&record.body.to_string(), &canaries);
            assert!(record.envelope.content_hash.is_none());
            assert!(record.envelope.derived_from.is_none());
        }
    }
    // The candidate is drafted with the proposal the batch stored.
    let body = fx.curator_body("candidate", &id).unwrap();
    assert_eq!(body["status"], "drafted");
    assert_eq!(body["proposal"], stub["id"]);
    assert_eq!(body["drafts"], 1);
    // The run record holds the report.
    let run = fx
        .curator_body("run", &run_id(report["run"].as_str().unwrap()))
        .unwrap();
    assert_eq!(run["report"], *report);

    // A second run drafts nothing new.
    let again = fx.report().await;
    assert_eq!(again["counts"]["drafted"], 0, "{again}");
    assert_eq!(fx.stubs().len(), 1);
}

#[tokio::test]
async fn a_run_holds_the_callers_lock_and_an_expired_lock_is_taken_over() {
    let mut fx = Fx::new();
    plain(&mut fx, 1);
    fx.at(day(8));
    let state = state_id("main", "human:local");
    let held = |until: i64| {
        json!({
            "version": 1, "kind": "state", "id": state, "space": "main",
            "principal": "human:local", "access": ["principal:human:local"],
            "feedAfter": 0, "memoryAfter": 0, "scanAfter": null, "reviewAfter": null,
            "lastRun": null, "lock": { "trace": "another-run", "until": format_instant(until) },
        })
    };
    let lock = held(day(8) + 5 * 60_000);
    assert!(record_validator().is_valid(&lock));
    fx.put_curator_record("state", &state, lock, &["principal:human:local"]);
    let busy = fx.run().await;
    assert_eq!(code(&busy), "CURATOR_BUSY");
    assert_eq!(busy["error"]["retryable"], true);
    assert!(busy["error"]["details"]["until"].is_string());
    assert!(fx.stubs().is_empty(), "nothing ran");
    // Another caller has their own lock: Bo's run drafts his candidate of the shared fact.
    let bo = fx.run_as(human("bo"), "main").await;
    assert_eq!(data(&bo)["counts"]["drafted"], 1, "{bo}");

    // Past its until, the lock is taken over, and released by the run that holds it. Bo's open
    // draft cites the same record, so the knowledge plugin refuses Local's (section 11.2).
    fx.at(day(8) + 11 * 60_000);
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 0, "{report}");
    assert_eq!(
        report["refused"],
        json!([{ "candidate": candidate(1), "code": "PROPOSAL_ALREADY_OPEN" }])
    );
    let after = fx.curator_body("state", &state).unwrap();
    assert_eq!(after["lock"], Value::Null);
    assert_eq!(after["lastRun"], run_id(report["run"].as_str().unwrap()));
}

#[tokio::test]
async fn a_finish_releases_only_its_own_lock() {
    let mut fx = Fx::new();
    plain(&mut fx, 1);
    fx.at(day(8));
    // While this run's batch runs, another run takes the lock over.
    let dir = fx.dir.path().to_path_buf();
    let state = state_id("main", "human:local");
    let taken = json!({
        "version": 1, "kind": "state", "id": state, "space": "main",
        "principal": "human:local", "access": ["principal:human:local"],
        "feedAfter": 0, "memoryAfter": 0, "scanAfter": null, "reviewAfter": null,
        "lastRun": null, "lock": { "trace": "the-other-run", "until": format_instant(day(9)) },
    });
    let hook_body = taken.clone();
    fx.between_steps("take-over", move || {
        put_record_at(&dir, "state", &state_id("main", "human:local"), hook_body);
    })
    .await;
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    // The report is recorded, and the state is the other run's, cursors and lock alike.
    let run = run_id(report["run"].as_str().unwrap());
    assert!(fx.curator_body("run", &run).is_some());
    assert_eq!(fx.curator_body("state", &state).unwrap(), taken);
}

#[tokio::test]
async fn a_run_that_stopped_after_its_batch_is_completed_by_the_next() {
    let mut fx = Fx::new();
    // The space admits agent notes, so the second fact's owner can confirm it (a new version).
    fx.pack(|pack| {
        pack.replace(
            "authorities = [\"person\"]",
            "authorities = [\"person\", \"agent\"]",
        )
    });
    plain(&mut fx, 1);
    fx.remember_twice(
        with_authority(
            fact(2, "human:ada", &["space"], "Subject 2", "Text 2."),
            umbel_store::Authority::Agent,
        ),
        102,
    );
    fx.at(day(8));
    let (one, two) = (candidate(1), candidate(2));
    // The batch stores both drafts; the feed fails, so finish never runs.
    fx.controls(json!({ "failFeed": true })).await;
    let stopped = fx.run().await;
    assert_eq!(code(&stopped), "STORE_BUSY");
    assert_eq!(
        stopped["error"]["details"]["command"],
        "knowledge-proposal-feed"
    );
    assert_eq!(fx.stubs().len(), 2);
    for id in [&one, &two] {
        let body = fx.curator_body("candidate", id).unwrap();
        assert_eq!(body["status"], "ready", "{body}");
        assert_eq!(body["proposal"], fx.stubs_of(id)[0]["id"]);
    }
    fx.controls(json!({ "failFeed": false })).await;
    // Its lock stands until it expires.
    assert_eq!(code(&fx.run().await), "CURATOR_BUSY");

    // Meanwhile one source changes: its stale proposal is withdrawn, not drafted again this run;
    // the other's draft renders the same, so the batch returns it.
    fx.confirm(&mem(2), "human:ada", day(8));
    fx.at(day(8) + 11 * 60_000);
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert_eq!(report["counts"]["withdrawn"], 1);
    assert_eq!(fx.stubs().len(), 2, "no new stub");
    assert_eq!(fx.stubs_of(&one)[0]["state"], "pending");
    assert_eq!(fx.stubs_of(&two)[0]["state"], "withdrawn");
    assert_eq!(
        fx.curator_body("candidate", &one).unwrap()["status"],
        "drafted"
    );
    let changed = fx.curator_body("candidate", &two).unwrap();
    assert_eq!(changed["proposal"], Value::Null);
    assert_eq!(changed["drafts"], 1);

    // Once it settles again, it is drafted under a new key: never PROPOSAL_KEY_REUSED.
    fx.at(day(16));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 1, "{report}");
    assert!(report["refused"].as_array().unwrap().is_empty(), "{report}");
    let drafts = fx.stubs_of(&two);
    assert_eq!(drafts.len(), 2);
    assert!(
        drafts
            .iter()
            .any(|s| s["key"] == format!("curator/{two}/1"))
    );
}

#[tokio::test]
async fn a_run_drafts_at_most_max_proposals_in_candidate_id_order() {
    let mut fx = Fx::new();
    for n in 1..=3 {
        plain(&mut fx, n);
    }
    fx.pack(|pack| pack.replace("max_proposals = 20", "max_proposals = 2"));
    fx.at(day(8));
    let report = fx.report().await;
    assert_eq!(report["counts"]["drafted"], 2, "{report}");
    assert_eq!(report["counts"]["remaining"], 1);
    let mut ids: Vec<String> = (1..=3).map(candidate).collect();
    ids.sort();
    let drafted: Vec<String> = fx
        .stubs()
        .iter()
        .map(|s| s["drafter"]["candidate"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        drafted.contains(&ids[0]) && drafted.contains(&ids[1]),
        "{drafted:?}"
    );
    let next = fx.report().await;
    assert_eq!(next["counts"]["drafted"], 1);
    assert_eq!(next["counts"]["remaining"], 0);
    assert_eq!(fx.stubs().len(), 3);
}

#[tokio::test]
async fn the_scan_rotates_so_every_record_is_reached_across_runs() {
    let mut fx = Fx::new();
    for n in 1..=5 {
        plain(&mut fx, n);
    }
    fx.pack(|pack| pack.replace("max_records = 5000", "max_records = 2"));
    fx.at(day(8));
    let state = state_id("main", "human:local");
    let mut drafted = 0;
    let mut cursors = Vec::new();
    let mut remaining = Vec::new();
    for _ in 0..3 {
        let report = fx.report().await;
        assert!(report["counts"]["read"].as_u64().unwrap() <= 2, "{report}");
        drafted += report["counts"]["drafted"].as_u64().unwrap();
        remaining.push(report["counts"]["remaining"].as_u64().unwrap());
        cursors.push(fx.curator_body("state", &state).unwrap()["scanAfter"].clone());
    }
    assert_eq!(
        drafted, 5,
        "every record reached in three runs of two: {cursors:?}"
    );
    assert_eq!(fx.stubs().len(), 5);
    assert!(cursors.iter().all(Value::is_object), "{cursors:?}");
    // The first run knew how far behind it was: the records its scan did not reach.
    assert_eq!(remaining[0], 3, "{remaining:?}");
}

#[tokio::test]
async fn curator_status_reports_the_last_run_and_overdue() {
    let mut fx = Fx::new();
    plain(&mut fx, 1);
    fx.at(day(8));
    let before = fx.status().await;
    assert_eq!(before["overdue"], true, "never run");
    assert_eq!(before["lastRun"], Value::Null);
    let report = fx.report().await;
    let after = fx.status().await;
    assert_eq!(after["overdue"], false);
    assert_eq!(after["lastRun"], report);
    assert_eq!(after["locked"], Value::Null);
    assert_eq!(
        after["overdueAfter"],
        format_instant(day(8) + 48 * 3_600_000)
    );
    fx.at(day(8) + 49 * 3_600_000);
    assert_eq!(fx.status().await["overdue"], true);
    // Another caller sees none of it.
    let bo = fx
        .call(
            human("bo"),
            afd::CommandInterface::Cli,
            "curator-status",
            json!({}),
        )
        .await;
    assert_eq!(data(&bo)["lastRun"], Value::Null);
}
