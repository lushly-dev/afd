//! `store-records-eval` integration tests (records host specification, sections 10, 12.2, 12.3
//! and 15.2): report counts, schema compliance, gate rule on each side of each threshold
//! (49 vs 50 probes; +2 vs +3 at 50; +3 vs +4 at 200), `self` excluded from statistics and
//! results, invalid probes refusals (never leaking probe text), and doctor's warning at more
//! than four times the records.
use crate::support;
use std::fs;
use std::path::Path;

use serde_json::{Value, json};
use support::plugins::seal;
use support::records::{Notes, config};
use support::{agent, call, events, journal_path};
use umbel::Host;
use umbel::plugins::sdk;
use umbel::workspace::Workspace;
use umbel_store::{EmbedError, Embedder, ModelId};

/// Stub embedder where `dup-<N>` and `probe-<N>` share the exact same unit vector, while
/// `words` shares no tokens with `probe-<N>` unless the probe text shares words with the record.
/// Uses 64 orthogonal/distinct directions so up to 200 probes can cleanly separate fused vs words!
struct SemanticStub {
    model: ModelId,
}

impl SemanticStub {
    fn tag_vector(text: &str) -> Vec<f32> {
        let mut vec = vec![0.0f32; 256];
        // Look for `#t<num>` (on stored records) or `#v<num>` (on probes) so records and probes
        // can share the exact same unit vector without sharing a lexical token.
        for prefix in ["#t", "#v"] {
            if let Some(pos) = text.find(prefix) {
                let digits: String = text[pos + 2..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if let Ok(idx) = digits.parse::<usize>() {
                    vec[idx % 256] = 1.0;
                    return vec;
                }
            }
        }
        vec[255] = 1.0;
        vec
    }
}

impl Embedder for SemanticStub {
    fn model(&self) -> &ModelId {
        &self.model
    }
    fn dimensions(&self) -> usize {
        256
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        Ok(texts.iter().map(|t| Self::tag_vector(t)).collect())
    }
}

fn eval_config() -> String {
    config(
        "default_access = \"space\"",
        r#"
[spaces.garden]
person = "human:ada"

[spaces.garden.meaning]
model = "sem"
weight = 0.5
k = 5

[models.sem]
provider = "http"
name = "sem-v1"
url = "http://127.0.0.1:19090/v1/embeddings"
dimensions = 256
version = "1"
"#,
    )
    // Remove the duplicate empty `[spaces.garden]` from `records::config`.
    .replacen("[spaces.garden]\n", "", 1)
}

fn build_host(dir: &Path) -> (Host, ModelId) {
    let ws = Workspace::open(dir).unwrap();
    let model_id = ws.config().models[0].model_id();
    drop(ws);
    let host = seal(dir, |b| {
        b.with_compiled(sdk(Notes::new())).with_embedder(
            "sem",
            SemanticStub {
                model: model_id.clone(),
            },
        )
    })
    .unwrap();
    (host, model_id)
}

async fn put_note(host: &Host, id: &str, statement: &str) {
    let res = call(
        host,
        agent("ada"),
        "notes-write",
        json!({ "op": "put", "args": { "kind": "note", "id": id, "body": { "statement": statement, "bed": "north" } } }),
    )
    .await;
    assert!(res.success, "{id}: {res:?}");
}

fn write_probes(dir: &Path, rel: &str, probes: Vec<Value>) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let doc = json!({
        "version": 1,
        "space": "garden",
        "plugin": "notes",
        "kind": "note",
        "probes": probes,
    });
    fs::write(&path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
}

/// Build `n` probes where `shared_word_count` match by BOTH words and meaning, and `meaning_only_count`
/// match ONLY by meaning (zero shared words!), so `fused.k - words.k == meaning_only_count`.
fn make_threshold_probes(total: usize, meaning_only_count: usize) -> Vec<Value> {
    let mut probes = Vec::with_capacity(total);
    for i in 0..total {
        let text = if i < meaning_only_count {
            // Zero shared tokens with `r{i}` (which uses `#t{i}`), same unit vector via `#v{i}`!
            format!("completely unrelated vocabulary alpha{i} #v{i}")
        } else {
            // Shares the exact unique word `item{i}` with `r{i}` AND same unit vector via `#v{i}`!
            format!("mulch rose item{i} #v{i}")
        };
        probes.push(json!({
            "id": format!("p-{i:03}"),
            "text": text,
            "duplicates": [format!("r{i}")],
            "self": null,
            "reader": null,
        }));
    }
    probes
}

#[tokio::test]
async fn eval_report_thresholds_schema_self_exclusion_and_stale_doctor_warning() {
    let dir = support::workspace(&eval_config());
    let (host, model_id) = build_host(dir.path());

    // Populate 200 records `r0..r199`, each with unique token `item{i}` and vector `#t{i}`.
    for i in 0..200 {
        put_note(
            &host,
            &format!("r{i}"),
            &format!("mulch rose item{i} #t{i}"),
        )
        .await;
    }

    // 1. n = 49 with +49 gain -> fails (n < 50).
    write_probes(dir.path(), "evals/p49.json", make_threshold_probes(49, 49));
    let r49 = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p49.json" }),
    )
    .await;
    assert!(r49.success, "{r49:?}");
    let d49 = r49.data.unwrap();
    assert_eq!(d49["n"], 49);
    assert_eq!(d49["hits"]["words"]["k"], 0);
    assert_eq!(d49["hits"]["fused"]["k"], 49);
    assert_eq!(d49["leaks"], 0);
    assert_eq!(d49["passed"], false);

    // 2. n = 50 with +2 gain -> fails; with +3 gain -> passes!
    write_probes(dir.path(), "evals/p50_2.json", make_threshold_probes(50, 2));
    let r50_2 = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p50_2.json" }),
    )
    .await;
    assert_eq!(r50_2.data.unwrap()["passed"], false);

    write_probes(dir.path(), "evals/p50_3.json", make_threshold_probes(50, 3));
    let r50_3 = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p50_3.json" }),
    )
    .await;
    let d50_3 = r50_3.data.unwrap();
    assert_eq!(d50_3["n"], 50);
    assert_eq!(d50_3["hits"]["words"]["k"], 47);
    assert_eq!(d50_3["hits"]["fused"]["k"], 50);
    assert_eq!(d50_3["passed"], true);

    // Written report validates against schemas/record-eval-report.v1.json!
    let report_path = dir.path().join("evals/records/garden/notes.note.json");
    let report_val: Value =
        serde_json::from_str(&fs::read_to_string(&report_path).unwrap()).unwrap();
    let schema: Value =
        serde_json::from_str(include_str!("../../schemas/record-eval-report.v1.json")).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(validator.is_valid(&report_val), "{report_val}");

    // Journal entry is digest keeping inputs, and no event is projected.
    let journal = fs::read_to_string(journal_path(dir.path())).unwrap();
    let entry: Value = journal
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .find(|e| e["command"] == "store-records-eval")
        .expect("eval journaled");
    assert_eq!(
        entry["input"]["keep"],
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p49.json" })
    );
    assert!(
        events(dir.path(), "garden")
            .iter()
            .all(|e| e["command"] != "store-records-eval")
    );

    // 3. n = 200: +3 fails, +4 passes!
    write_probes(
        dir.path(),
        "evals/p200_3.json",
        make_threshold_probes(200, 3),
    );
    let r200_3 = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p200_3.json" }),
    )
    .await;
    assert_eq!(r200_3.data.unwrap()["passed"], false);

    write_probes(
        dir.path(),
        "evals/p200_4.json",
        make_threshold_probes(200, 4),
    );
    let r200_4 = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/p200_4.json" }),
    )
    .await;
    let d200_4 = r200_4.data.unwrap();
    assert_eq!(d200_4["n"], 200);
    assert_eq!(d200_4["hits"]["words"]["k"], 196);
    assert_eq!(d200_4["hits"]["fused"]["k"], 200);
    assert_eq!(d200_4["passed"], true);
    drop(host);

    // Restarting host after passing eval serves meaning!
    let (restarted, _) = build_host(dir.path());
    let m = call(
        &restarted,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["mulch rose item0 #t0"] } }),
    )
    .await;
    assert!(m.success, "{m:?}");
    assert_eq!(
        m.data.unwrap()["result"]["meaning"],
        json!({ "served": model_id.as_str() })
    );
    drop(restarted);

    // 4. `self` exclusion: a probe whose text equals r0 with `self = "r0"` and `duplicates = ["r0"]`
    //    must NOT hit `r0` (since `self` is excluded from results and statistics!).
    let (host, _) = build_host(dir.path());
    write_probes(
        dir.path(),
        "evals/self_test.json",
        vec![json!({
            "id": "p-self",
            "text": "mulch rose item0 #t0",
            "duplicates": ["r0"],
            "self": "r0",
            "reader": "human:ada"
        })],
    );
    let r_self = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "note", "probes": "evals/self_test.json" }),
    )
    .await;
    let d_self = r_self.data.unwrap();
    assert_eq!(d_self["hits"]["words"]["20"], 0);
    assert_eq!(d_self["hits"]["fused"]["20"], 0);

    // 5. Doctor warns when a kind holds >4x the records its passing report names.
    //    Write a passing report claiming `records: 40` while the store holds 200 (> 4 * 40 = 160).
    let mut stale_report = report_val;
    stale_report["records"] = json!(40);
    fs::write(
        &report_path,
        serde_json::to_string_pretty(&stale_report).unwrap(),
    )
    .unwrap();
    let doc = call(&host, agent("ada"), "workspace-doctor", json!({})).await;
    let check = doc.data.unwrap()["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "records.meaning")
        .unwrap()
        .clone();
    assert_eq!(check["status"], "warn");
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .contains("more than four times"),
        "{check}"
    );
}

#[tokio::test]
async fn invalid_probes_files_are_refused_without_leaking_probe_text() {
    let dir = support::workspace(&eval_config());
    let (host, _) = build_host(dir.path());

    // Path under state/ or escaping workspace is refused.
    fs::create_dir_all(dir.path().join("state")).unwrap();
    fs::write(dir.path().join("state/probes.json"), "{}").unwrap();
    for bad_path in [
        "../outside.json",
        "/etc/passwd",
        "state/probes.json",
        "evals/missing.json",
    ] {
        let res = call(
            &host,
            agent("ada"),
            "store-records-eval",
            json!({ "plugin": "notes", "kind": "note", "probes": bad_path }),
        )
        .await;
        assert!(!res.success, "{bad_path}");
        assert_eq!(res.error.unwrap().code, "RECORD_PROBES_INVALID");
    }

    // Wrong space/plugin/kind, empty probes, invalid reader, text too long — none ever leaks canary text.
    let cases = [
        json!({ "version": 2, "space": "garden", "plugin": "notes", "kind": "note", "probes": [] }),
        json!({ "version": 1, "space": "orchard", "plugin": "notes", "kind": "note", "probes": [{ "id": "p1", "text": "CANARY_SECRET", "duplicates": [] }] }),
        json!({ "version": 1, "space": "garden", "plugin": "other", "kind": "note", "probes": [{ "id": "p1", "text": "CANARY_SECRET", "duplicates": [] }] }),
        json!({ "version": 1, "space": "garden", "plugin": "notes", "kind": "other", "probes": [{ "id": "p1", "text": "CANARY_SECRET", "duplicates": [] }] }),
        json!({ "version": 1, "space": "garden", "plugin": "notes", "kind": "note", "probes": [] }),
        json!({ "version": 1, "space": "garden", "plugin": "notes", "kind": "note", "probes": [{ "id": "p-bad", "text": "CANARY_SECRET", "duplicates": [], "reader": "not-a-principal" }] }),
        json!({ "version": 1, "space": "garden", "plugin": "notes", "kind": "note", "probes": [{ "id": "p-long", "text": format!("CANARY_SECRET {}", "x".repeat(17_000)), "duplicates": [] }] }),
        json!({ "version": 1, "space": "garden", "plugin": "notes", "kind": "note", "probes": [{ "id": "p-dup", "text": "CANARY_SECRET", "duplicates": ["a", "a"] }] }),
    ];
    for (i, payload) in cases.iter().enumerate() {
        let rel = format!("evals/bad-{i}.json");
        fs::create_dir_all(dir.path().join("evals")).unwrap();
        fs::write(
            dir.path().join(&rel),
            serde_json::to_string(payload).unwrap(),
        )
        .unwrap();
        let res = call(
            &host,
            agent("ada"),
            "store-records-eval",
            json!({ "plugin": "notes", "kind": "note", "probes": rel }),
        )
        .await;
        assert!(!res.success, "case {i}");
        let err = res.error.unwrap();
        assert_eq!(err.code, "RECORD_PROBES_INVALID", "case {i}: {err:?}");
        assert!(
            !err.message.contains("CANARY_SECRET"),
            "case {i} leaked probe text: {}",
            err.message
        );
    }

    // Undeclared kind / kind without match field -> RECORD_KIND_NOT_DECLARED.
    let no_match = call(
        &host,
        agent("ada"),
        "store-records-eval",
        json!({ "plugin": "notes", "kind": "bed", "probes": "evals/bad-0.json" }),
    )
    .await;
    assert_eq!(no_match.error.unwrap().code, "RECORD_KIND_NOT_DECLARED");
}
