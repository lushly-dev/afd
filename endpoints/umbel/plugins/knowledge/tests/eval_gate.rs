//! `knowledge-eval` (specification section 10.3) and the CI gate (10.4) on the seeded fixture with
//! a rebuilt index: the report is validated against its schema and held to the gate and to
//! `eval/baseline.json`. The report is written to the file named by `UMBEL_EVAL_REPORT` (CI
//! uploads it as an artifact).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::CommandInterface;
use serde_json::{Value, json};
use support::eval::seeded;
use support::*;
use umbel_plugin_knowledge::eval::fixture::{self, DEFAULT_SEED, MEMBER};
use umbel_plugin_knowledge::eval::gate;
use umbel_plugin_knowledge::eval::queries::{self, Kind};

fn report_validator() -> jsonschema::Validator {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/eval-report.v1.json");
    let value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    jsonschema::options().build(&value).unwrap()
}

/// A report without the fields that differ between runs.
fn stable(report: &Value) -> Value {
    let mut copy = report.clone();
    copy.as_object_mut().unwrap().remove("latency");
    copy
}

fn docs_returned(report: &Value, id: &str) -> Vec<String> {
    let result = report["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap();
    result["runs"]["on"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            format!(
                "{}:{}",
                hit["space"].as_str().unwrap(),
                hit["doc"].as_str().unwrap()
            )
        })
        .collect()
}

#[tokio::test]
async fn the_seeded_fixture_meets_the_gate_and_the_baseline() {
    let fixture = seeded();
    let started = std::time::Instant::now();
    fixture.refresh_all().await;
    eprintln!(
        "refresh (sync and rebuild, both spaces): {:?}",
        started.elapsed()
    );

    // The planted documents are the only ones the write scan flagged (specification 10.1).
    let (mut instruction_like, mut hidden_text) = (0, 0);
    for space in ["alpha", "beta"] {
        let mut after: Option<String> = None;
        loop {
            let mut input = json!({ "space": space, "limit": 200 });
            if let Some(after) = &after {
                input["after"] = json!(after);
            }
            let page = fixture.cli("knowledge-list", input).await;
            assert_eq!(page["success"], true, "{page}");
            for doc in page["data"]["documents"].as_array().unwrap() {
                for flag in doc["flags"].as_array().unwrap() {
                    instruction_like += usize::from(flag == "instruction-like");
                    hidden_text += usize::from(flag == "hidden-text");
                }
            }
            match page["data"]["nextAfter"].as_str() {
                Some(next) => after = Some(next.to_owned()),
                None => break,
            }
        }
    }
    assert_eq!((instruction_like, hidden_text), (8, 4));

    let started = std::time::Instant::now();
    let result = fixture.eval().await;
    eprintln!("knowledge-eval: {:?}", started.elapsed());
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["metadata"]["dev.umbel/replay"], "recorded");
    let report = &result["data"];
    if let Ok(path) = std::env::var("UMBEL_EVAL_REPORT") {
        std::fs::write(&path, serde_json::to_string_pretty(report).unwrap()).unwrap();
    }
    eprintln!("overall: {}", report["metrics"]["overall"]);
    eprintln!("byKind: {}", report["metrics"]["byKind"]);
    eprintln!(
        "unanswerable: {} leaks: {} latency: {}",
        report["unanswerable"], report["leaks"], report["latency"]
    );

    let validator = report_validator();
    let errors: Vec<String> = validator
        .iter_errors(report)
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(report["queries"]["total"], 220);
    assert_eq!(report["queries"]["answerable"], 185);
    assert_eq!(report["queries"]["unanswerable"], 15);
    assert_eq!(report["queries"]["permission"], 20);
    assert_eq!(report["queries"]["skipped"], 0);
    assert_eq!(report["spaces"], json!(["alpha", "beta"]));
    assert_eq!(report["results"].as_array().unwrap().len(), 220);

    let baseline: Value = serde_json::from_str(include_str!("../eval/baseline.json")).unwrap();
    assert_eq!(baseline["fixture"]["digest"], fixture.manifest.digest);
    if let Err(failures) = gate::check(report, Some(&baseline)) {
        panic!("the gate failed:\n{}", failures.join("\n"));
    }

    // The permission probes, as the outsider they name and then as a member of `restricted`.
    let seeded_set = fixture::build(DEFAULT_SEED);
    let probes: Vec<_> = seeded_set
        .queries
        .iter()
        .filter(|q| q.kind == Kind::Permission)
        .cloned()
        .collect();
    assert_eq!(probes.len(), 20);
    for probe in &probes {
        let answer = probe.qrels.keys().next().unwrap();
        let returned = docs_returned(report, &probe.id);
        assert!(
            !returned.contains(answer),
            "{}: the outsider was given {answer}",
            probe.id
        );
    }
    let members: Vec<_> = probes
        .iter()
        .cloned()
        .map(|mut q| {
            q.principal = MEMBER.to_owned();
            q
        })
        .collect();
    fixture.write(
        "spaces/alpha/eval/member.jsonl",
        queries::to_jsonl(&members).as_bytes(),
    );
    let member = fixture
        .cli(
            "knowledge-eval",
            json!({ "spaces": ["alpha"], "queries": "eval/member.jsonl" }),
        )
        .await;
    let member = &member["data"];
    assert_eq!(
        member["leaks"], 0,
        "a member reading restricted answers is not a leak"
    );
    for probe in &members {
        let answer = probe.qrels.keys().next().unwrap();
        assert_eq!(
            docs_returned(member, &probe.id).first(),
            Some(answer),
            "{}: the member's first hit is the answer",
            probe.id
        );
    }
    assert_eq!(member["queries"]["permission"], 20);
}

#[tokio::test]
async fn two_independent_runs_produce_the_same_report() {
    let first = seeded();
    first.refresh_all().await;
    let second = seeded();
    second.refresh_all().await;
    let a = first.eval().await;
    let b = second.eval().await;
    assert_eq!(a["success"], true, "{a}");
    assert_eq!(stable(&a["data"]), stable(&b["data"]));
    // The same host, asked twice, answers the same.
    let again = first.eval().await;
    assert_eq!(stable(&a["data"]), stable(&again["data"]));
}

/// A one-space workspace with the `eval` collection and a few documents.
fn small() -> Fx {
    let config = CONFIG.replace(
        "[spaces.beta]\n",
        "[spaces.main.collections.eval]\nroot = \"spaces/main/eval\"\n\n[spaces.beta]\n",
    );
    Fx::with(&config)
}

fn exact(id: &str, query: &str, spaces: &[&str], principal: &str, qrels: Value) -> String {
    json!({"version": 1, "id": id, "kind": "exact", "query": query, "spaces": spaces,
        "principal": principal, "filters": {}, "qrels": qrels, "unanswerable": false})
    .to_string()
}

#[tokio::test]
async fn a_query_outside_the_calls_spaces_is_skipped_and_never_run() {
    let fx = small();
    fx.handbook("a.md", "# A\n\nzorplat\n");
    fx.note("n.md", "# N\n\nzorplat\n");
    fx.write(
        "spaces/main/eval/queries.jsonl",
        [
            exact(
                "q-0001",
                "zorplat",
                &["main"],
                "human:eval-reader",
                json!({"main:handbook/a": 2}),
            ),
            exact(
                "q-0002",
                "zorplat",
                &["main", "beta"],
                "human:eval-reader",
                json!({"beta:notes/n": 2}),
            ),
        ]
        .join("\n")
        .as_bytes(),
    );
    fx.refresh("main").await;
    fx.refresh("beta").await;

    let result = fx.cli("knowledge-eval", json!({})).await;
    let report = data(&result);
    assert_eq!(report["queries"]["skipped"], 1);
    assert_eq!(report["queries"]["total"], 2);
    assert_eq!(report["queries"]["answerable"], 1);
    assert_eq!(report["results"][1]["skipped"], true);
    assert_eq!(report["results"][1]["runs"], json!({}));

    let both = fx
        .cli("knowledge-eval", json!({ "spaces": ["main", "beta"] }))
        .await;
    assert_eq!(data(&both)["queries"]["skipped"], 0);
    assert_eq!(data(&both)["queries"]["answerable"], 2);
}

#[tokio::test]
async fn expansion_runs_as_asked() {
    let fx = small();
    fx.handbook("a.md", "# A\n\nzorplat see [b](/handbook/b.md)\n");
    fx.handbook("b.md", "# B\n\nnothing here\n");
    fx.write(
        "spaces/main/eval/queries.jsonl",
        exact(
            "q-0001",
            "zorplat",
            &["main"],
            "human:eval-reader",
            json!({"main:handbook/a": 2, "main:handbook/b": 1}),
        )
        .as_bytes(),
    );
    fx.refresh("main").await;
    for (expand, present, absent) in [("on", "on", "off"), ("off", "off", "on")] {
        let result = fx.cli("knowledge-eval", json!({ "expand": expand })).await;
        let report = data(&result);
        assert!(report["metrics"]["overall"].get(present).is_some());
        assert!(report["metrics"]["overall"].get(absent).is_none());
        assert!(report["results"][0]["runs"].get(absent).is_none());
    }
    let both = fx.cli("knowledge-eval", json!({})).await;
    let runs = &data(&both)["results"][0]["runs"];
    assert_eq!(
        runs["on"].as_array().unwrap().len(),
        2,
        "the linked document joins with expansion"
    );
    assert_eq!(runs["off"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn each_query_runs_as_the_principal_it_names() {
    let config = config_with_private_beta().replace(
        "[spaces.beta]\n",
        "[spaces.beta.collections.eval]\nroot = \"spaces/beta/eval\"\n\n[spaces.beta]\n",
    );
    let fx = Fx::with(&config);
    fx.note(
        "secret.md",
        "---\naccess: [group:platform]\n---\n# Secret\n\nzorplat plan\n",
    );
    fx.note("open.md", "# Open\n\nzorplat plain\n");
    fx.refresh_as(member(), "beta").await;
    let set = [
        exact(
            "q-0001",
            "zorplat",
            &["beta"],
            "human:eval-reader",
            json!({"beta:notes/open": 2}),
        ),
        exact(
            "q-0002",
            "zorplat",
            &["beta"],
            "human:ada",
            json!({"beta:notes/open": 2}),
        ),
    ]
    .join("\n");
    fx.write("spaces/beta/eval/queries.jsonl", set.as_bytes());
    // Ada is a member of `platform`, which reads `beta`; the outsider is not even a reader.
    let context = fx
        .host
        .context(member())
        .with_interface(CommandInterface::Cli);
    let result = json_of(
        fx.host
            .registry()
            .execute(
                "knowledge-eval",
                json!({ "spaces": ["beta"] }),
                Some(context),
            )
            .await,
    );
    let report = data(&result);
    assert_eq!(report["leaks"], 0);
    assert!(
        docs_returned_in(report, "q-0001").is_empty(),
        "the outsider reads nothing"
    );
    assert_eq!(
        docs_returned_in(report, "q-0002"),
        ["beta:notes/open", "beta:notes/secret"]
    );
}

fn docs_returned_in(report: &Value, id: &str) -> Vec<String> {
    let result = report["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap();
    let mut docs: Vec<String> = result["runs"]["on"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| {
            format!(
                "{}:{}",
                hit["space"].as_str().unwrap(),
                hit["doc"].as_str().unwrap()
            )
        })
        .collect();
    docs.sort();
    docs
}

#[tokio::test]
async fn the_command_is_for_a_person_at_the_command_line() {
    let fx = small();
    fx.handbook("a.md", "# A\n\nzorplat\n");
    fx.write(
        "spaces/main/eval/queries.jsonl",
        exact(
            "q-0001",
            "zorplat",
            &["main"],
            "human:eval-reader",
            json!({"main:handbook/a": 2}),
        )
        .as_bytes(),
    );
    fx.refresh("main").await;
    // Not exposed on MCP or to an in-process agent.
    let over_mcp = fx
        .as_actor(human("local"), "knowledge-eval", json!({}))
        .await;
    assert_eq!(code(&over_mcp), "COMMAND_NOT_EXPOSED", "{over_mcp}");
    // On the command-line interface, an actor that is not a person cannot evaluate as another.
    let result = json_of(
        fx.call(
            agent("bot"),
            CommandInterface::Cli,
            "knowledge-eval",
            json!({}),
        )
        .await,
    );
    assert_eq!(result["success"], false, "{result}");
    assert!(
        result.to_string().contains("STORE_WRITE_NOT_ALLOWED"),
        "{result}"
    );
}

#[tokio::test]
async fn a_missing_or_invalid_query_set_is_a_failure_with_a_suggestion() {
    let fx = small();
    let none = fx.cli("knowledge-eval", json!({})).await;
    assert_eq!(code(&none), "EVAL_QUERIES_NOT_FOUND", "{none}");
    assert!(
        none["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("eval")
    );

    let bad_path = fx
        .cli("knowledge-eval", json!({ "queries": "queries" }))
        .await;
    assert_eq!(code(&bad_path), "EVAL_QUERIES_INVALID", "{bad_path}");

    fx.write("spaces/main/eval/queries.jsonl", b"{\"version\": 1}\n");
    let broken = fx.cli("knowledge-eval", json!({})).await;
    assert_eq!(code(&broken), "EVAL_QUERIES_INVALID", "{broken}");
    assert!(
        broken["error"]["message"]
            .as_str()
            .unwrap()
            .contains("line 1")
    );

    let twice = [
        exact(
            "q-0001",
            "zorplat",
            &["main"],
            "human:eval-reader",
            json!({"main:handbook/a": 2}),
        ),
        exact(
            "q-0001",
            "zorplat",
            &["main"],
            "human:eval-reader",
            json!({"main:handbook/a": 2}),
        ),
    ]
    .join("\n");
    fx.write("spaces/main/eval/queries.jsonl", twice.as_bytes());
    let repeated = fx.cli("knowledge-eval", json!({})).await;
    assert_eq!(code(&repeated), "EVAL_QUERIES_INVALID", "{repeated}");

    // A query that cannot run names itself.
    let unparsable = exact(
        "q-0001",
        "title:(",
        &["main"],
        "human:eval-reader",
        json!({"main:handbook/a": 2}),
    );
    fx.write("spaces/main/eval/queries.jsonl", unparsable.as_bytes());
    fx.handbook("a.md", "# A\n\nzorplat\n");
    fx.refresh("main").await;
    let failed = fx.cli("knowledge-eval", json!({})).await;
    assert_eq!(code(&failed), "EVAL_QUERY_FAILED", "{failed}");
    assert!(
        failed["error"]["message"]
            .as_str()
            .unwrap()
            .contains("q-0001")
    );
}
