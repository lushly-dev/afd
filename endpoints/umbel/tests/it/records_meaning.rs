//! Meaning lane integration tests (records host specification, sections 9, 10, 12.1, 12.3 and
//! 15.2): model id determinism, HTTP URL rules, SHA-256 pinning and workspace confinement,
//! post-put vector writes and non-failing embed errors, bad-query/stale-kind refusal before
//! calling any embedder, `store-records-reindex` vector rebuilds (`vectorsOnly`, warnings and
//! failures), serving rule in every state (including tampered `passed: true` and every binding
//! mismatch), and doctor's `records.meaning` check.
use crate::support;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use support::plugins::seal;
use support::records::{Notes, config};
use support::{agent, call};
use umbel::Host;
use umbel::plugins::sdk;
use umbel::workspace::{ConfigFile, Workspace};
use umbel_store::lane::{NORMALISATION_VERSION, Pointer, RecordDecl};
use umbel_store::{EmbedError, Embedder, ModelId};

fn sha256_prefixed(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::from("sha256:");
    for byte in &digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

struct StubEmbedder {
    model: ModelId,
    fail: Arc<AtomicBool>,
    calls: Arc<AtomicUsize>,
}

impl StubEmbedder {
    fn new(model: ModelId) -> (Self, Arc<AtomicBool>, Arc<AtomicUsize>) {
        let fail = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));
        (
            Self {
                model,
                fail: Arc::clone(&fail),
                calls: Arc::clone(&calls),
            },
            fail,
            calls,
        )
    }
}

impl Embedder for StubEmbedder {
    fn model(&self) -> &ModelId {
        &self.model
    }
    fn dimensions(&self) -> usize {
        16
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail.load(Ordering::SeqCst) {
            return Err(EmbedError::Unavailable("simulated outage".to_owned()));
        }
        Ok(texts
            .iter()
            .map(|text| {
                let mut vec = vec![0.0f32; 16];
                if text.to_lowercase().contains("rose") || text.to_lowercase().contains("prune") {
                    vec[0] = 0.8;
                    vec[1] = 0.6;
                } else {
                    vec[2] = 0.8;
                    vec[3] = 0.6;
                }
                vec
            })
            .collect())
    }
}

fn notes_note_decl() -> RecordDecl {
    RecordDecl {
        kind: "note".to_owned(),
        standing: true,
        text: vec![Pointer::parse("/statement").unwrap()],
        keys: vec![
            Pointer::parse("/bed").unwrap(),
            Pointer::parse("/tags").unwrap(),
        ],
        matched: Some(0),
    }
}

#[allow(clippy::too_many_arguments)]
fn write_report(
    dir: &Path,
    model: &ModelId,
    decl_hash: &str,
    normalisation: u32,
    weight: f64,
    k: u64,
    words_k: u64,
    fused_k: u64,
    records: u64,
    passed: bool,
) {
    let path = dir.join("evals/records/garden/notes.note.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let report = json!({
        "version": 1,
        "space": "garden",
        "plugin": "notes",
        "kind": "note",
        "declHash": decl_hash,
        "normalisation": normalisation,
        "model": model.as_str(),
        "weight": weight,
        "k": k,
        "probes": 60,
        "n": 50,
        "hits": {
            "words": { "1": 20, "3": 30, "5": words_k, "10": 40, "20": 42, "k": words_k },
            "fused": { "1": 25, "3": 35, "5": fused_k, "10": 45, "20": 47, "k": fused_k }
        },
        "leaks": 0,
        "records": records,
        "probesDigest": format!("sha256:{}", "a".repeat(64)),
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "at": "2026-11-22T12:00:00.000Z",
        "passed": passed,
    });
    fs::write(&path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
}

async fn doctor_meaning(host: &Host) -> Value {
    let res = call(host, agent("ada"), "workspace-doctor", json!({})).await;
    let checks = if res.success {
        res.data.unwrap()["checks"].clone()
    } else {
        res.error.unwrap().details.unwrap()["checks"].clone()
    };
    checks
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "records.meaning")
        .unwrap()
        .clone()
}

#[test]
fn model_id_is_deterministic_ignores_bearer_and_timeout_and_resolves_defaults() {
    let parse = |toml: &str| {
        ConfigFile::parse(toml)
            .unwrap()
            .into_config(Path::new("/w"))
            .unwrap()
            .models
            .remove(0)
            .model_id()
    };
    let h = format!("sha256:{}", "a".repeat(64));
    let h2 = format!("sha256:{}", "b".repeat(64));

    // HTTP: bearer_env and timeout_ms do not change model_id; version and url do.
    let http_a = parse(
        r#"config_version = 6
[models.e]
provider = "http"
name = "embed-1"
url = "http://127.0.0.1:8080/v1/embeddings"
dimensions = 384
version = "1"
"#,
    );
    let http_b = parse(
        r#"config_version = 6
[models.e]
provider = "http"
name = "embed-1"
url = "http://127.0.0.1:8080/v1/embeddings"
dimensions = 384
version = "1"
bearer_env = "EMBED_TOKEN"
timeout_ms = 12000
"#,
    );
    let http_v2 = parse(
        r#"config_version = 6
[models.e]
provider = "http"
name = "embed-1"
url = "http://127.0.0.1:8080/v1/embeddings"
dimensions = 384
version = "2"
"#,
    );
    assert_eq!(http_a, http_b);
    assert_ne!(http_a, http_v2);
    assert!(http_a.as_str().starts_with("e@"));

    // ONNX: omitting defaults equals writing them explicitly; changing pooling or a file digest changes id.
    let onnx_default = parse(&format!(
        r#"config_version = 6
[models.m]
provider = "onnx"
name = "minilm"
dir = "models/minilm"
[models.m.files]
"model.onnx" = "{h}"
"tokenizer.json" = "{h}"
"config.json" = "{h}"
"special_tokens_map.json" = "{h}"
"tokenizer_config.json" = "{h}"
"#
    ));
    let onnx_explicit = parse(&format!(
        r#"config_version = 6
[models.m]
provider = "onnx"
name = "minilm"
dir = "models/minilm"
pooling = "mean"
max_length = 512
[models.m.files]
"model.onnx" = "{h}"
"tokenizer.json" = "{h}"
"config.json" = "{h}"
"special_tokens_map.json" = "{h}"
"tokenizer_config.json" = "{h}"
"#
    ));
    let onnx_cls = parse(&format!(
        r#"config_version = 6
[models.m]
provider = "onnx"
name = "minilm"
dir = "models/minilm"
pooling = "cls"
[models.m.files]
"model.onnx" = "{h}"
"tokenizer.json" = "{h}"
"config.json" = "{h}"
"special_tokens_map.json" = "{h}"
"tokenizer_config.json" = "{h}"
"#
    ));
    let onnx_changed_file = parse(&format!(
        r#"config_version = 6
[models.m]
provider = "onnx"
name = "minilm"
dir = "models/minilm"
[models.m.files]
"model.onnx" = "{h2}"
"tokenizer.json" = "{h}"
"config.json" = "{h}"
"special_tokens_map.json" = "{h}"
"tokenizer_config.json" = "{h}"
"#
    ));
    assert_eq!(onnx_default, onnx_explicit);
    assert_ne!(onnx_default, onnx_cls);
    assert_ne!(onnx_default, onnx_changed_file);
}

#[test]
fn http_url_refuses_names_and_accepts_literal_loopback() {
    let parse = |url: &str| {
        let text = format!(
            r#"config_version = 6
[models.e]
provider = "http"
name = "embed-1"
url = "{url}"
dimensions = 384
version = "1"
"#
        );
        ConfigFile::parse(&text).and_then(|f| f.into_config(Path::new("/w")))
    };
    assert!(parse("http://localhost:8080/v1/embeddings").is_err());
    assert!(parse("http://example.com/v1/embeddings").is_err());
    assert!(parse("http://127.0.0.1:8080/v1/embeddings").is_ok());
    assert!(parse("http://[::1]:8080/v1/embeddings").is_ok());
    assert!(parse("https://api.example.com/v1/embeddings").is_ok());
}

#[tokio::test]
async fn pinned_file_mismatch_missing_file_and_uncompiled_provider_leave_model_unloaded_and_fail_doctor()
 {
    let model_bytes = b"not-real-safetensors";
    let tok_bytes = b"{}";
    let cfg_bytes = b"{}";
    let cfg_text = |model_hash: &str| {
        config(
            "default_access = \"space\"",
            &format!(
                r#"
[spaces.garden.meaning]
model = "potion"

[models.potion]
provider = "static"
name = "potion-test"
dir = "models/potion"
[models.potion.files]
"model.safetensors" = "{model_hash}"
"tokenizer.json" = "{}"
"config.json" = "{}"
"#,
                sha256_prefixed(tok_bytes),
                sha256_prefixed(cfg_bytes),
            ),
        )
    };

    // 1. Missing model files -> seal still succeeds, doctor records.meaning fails.
    let dir = support::workspace(&cfg_text(&sha256_prefixed(model_bytes)));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Notes::new()))).unwrap();
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "fail", "{check}");
    assert!(check["message"].as_str().unwrap().contains("potion"));

    // 2. Digest mismatch -> doctor records.meaning fails naming the file.
    let mdir = dir.path().join("models/potion");
    fs::create_dir_all(&mdir).unwrap();
    fs::write(mdir.join("model.safetensors"), b"tampered-bytes").unwrap();
    fs::write(mdir.join("tokenizer.json"), tok_bytes).unwrap();
    fs::write(mdir.join("config.json"), cfg_bytes).unwrap();
    drop(host);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Notes::new()))).unwrap();
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "fail", "{check}");
    assert!(
        check["message"]
            .as_str()
            .unwrap()
            .contains("SHA-256 digest"),
        "{check}"
    );

    // 3. Matching digests on a build without embed-static -> fails naming feature/load.
    fs::write(mdir.join("model.safetensors"), model_bytes).unwrap();
    drop(host);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Notes::new()))).unwrap();
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "fail", "{check}");

    // 4. Reindex with vectorsOnly=true fails with RECORD_MODEL_UNAVAILABLE; full rebuild warns with it.
    drop(host);
    let vo = support::cli_with(
        dir.path(),
        &[
            "call",
            "store-records-reindex",
            "{\"vectorsOnly\":true}",
            "--yes",
        ],
        support::Scripted::no_terminal(),
        |b| b.with_compiled(sdk(Notes::new())),
    )
    .await;
    assert_eq!(vo.error_code(), "RECORD_MODEL_UNAVAILABLE");

    let full = support::cli_with(
        dir.path(),
        &["call", "store-records-reindex", "{}", "--yes"],
        support::Scripted::no_terminal(),
        |b| b.with_compiled(sdk(Notes::new())),
    )
    .await;
    assert_eq!(full.code, 0, "{}", full.stdout);
    let warnings = full.json()["warnings"].as_array().unwrap().clone();
    assert!(
        warnings
            .iter()
            .any(|w| w["code"] == "RECORD_MODEL_UNAVAILABLE"),
        "{warnings:?}"
    );
}

#[tokio::test]
async fn serving_rule_in_every_state_and_non_failing_put_and_bad_query_never_calls_embedder() {
    let model_cfg = r#"
[spaces.garden.meaning]
model = "remote"
weight = 0.5
k = 5

[models.remote]
provider = "http"
name = "embed-1"
url = "https://embed.example.test/v1/embeddings"
dimensions = 16
version = "1"
"#;
    let dir = support::workspace(&config("default_access = \"space\"", model_cfg));
    let ws = Workspace::open(dir.path()).unwrap();
    let model_id = ws.config().models[0].model_id();
    drop(ws);
    let decl = notes_note_decl();
    let decl_hash = decl.hash().as_str().to_owned();

    // Start with NO eval report: vectors are written on put, meaning stays off, doctor warns.
    let (stub, fail_flag, calls) = StubEmbedder::new(model_id.clone());
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Notes::new()))
            .with_embedder("remote", stub)
    })
    .unwrap();

    // Put n1 succeeds and writes vector.
    let put_ok = call(
        &host,
        agent("ada"),
        "notes-write",
        json!({ "op": "put", "args": { "kind": "note", "id": "n1", "body": { "statement": "Prune roses in late winter.", "bed": "north" } } }),
    )
    .await;
    assert!(put_ok.success, "{put_ok:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // Put n2 while embedder fails: put STILL succeeds (no failure on put!), n2 has no vector.
    fail_flag.store(true, Ordering::SeqCst);
    let put_failed_embed = call(
        &host,
        agent("ada"),
        "notes-write",
        json!({ "op": "put", "args": { "kind": "note", "id": "n2", "body": { "statement": "Water tomatoes at the base.", "bed": "south" } } }),
    )
    .await;
    assert!(put_failed_embed.success, "{put_failed_embed:?}");
    fail_flag.store(false, Ordering::SeqCst);

    // Match without report -> meaning is off (and embedder is not called).
    let before_calls = calls.load(Ordering::SeqCst);
    let m = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
    )
    .await;
    assert!(m.success, "{m:?}");
    assert_eq!(m.data.unwrap()["result"]["meaning"], json!("off"));
    assert_eq!(calls.load(Ordering::SeqCst), before_calls);

    // Doctor warns about http host AND missing vector AND missing eval report.
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "warn", "{check}");
    let msg = check["message"].as_str().unwrap();
    assert!(msg.contains("embed.example.test"), "{msg}");
    assert!(msg.contains("missing vectors"), "{msg}");
    assert!(msg.contains("no eval report"), "{msg}");
    drop(host);

    // Tampered report (`passed: true` with failing counts +2 at n=50) -> still off!
    write_report(
        dir.path(),
        &model_id,
        &decl_hash,
        NORMALISATION_VERSION,
        0.5,
        5,
        35,
        37,
        2,
        true,
    );
    let (stub, _, _) = StubEmbedder::new(model_id.clone());
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Notes::new()))
            .with_embedder("remote", stub)
    })
    .unwrap();
    let m = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
    )
    .await;
    assert_eq!(m.data.unwrap()["result"]["meaning"], json!("off"));
    let check = doctor_meaning(&host).await;
    assert!(
        check["message"].as_str().unwrap().contains("did not pass"),
        "{check}"
    );
    drop(host);

    // Each binding mismatch keeps meaning off and names the binding in doctor.
    let other_model = ModelId::parse("remote@0000000000000000").unwrap();
    let other_decl = format!("sha256:{}", "0".repeat(64));
    for (case, m_id, d_hash, norm, w, k, expected_word) in [
        (
            "declHash",
            &model_id,
            other_decl.as_str(),
            NORMALISATION_VERSION,
            0.5,
            5,
            "declaration",
        ),
        (
            "normalisation",
            &model_id,
            decl_hash.as_str(),
            NORMALISATION_VERSION + 1,
            0.5,
            5,
            "normalisation",
        ),
        (
            "model",
            &other_model,
            decl_hash.as_str(),
            NORMALISATION_VERSION,
            0.5,
            5,
            "model",
        ),
        (
            "weight",
            &model_id,
            decl_hash.as_str(),
            NORMALISATION_VERSION,
            0.6,
            5,
            "weight",
        ),
        (
            "k",
            &model_id,
            decl_hash.as_str(),
            NORMALISATION_VERSION,
            0.5,
            10,
            "k",
        ),
    ] {
        write_report(dir.path(), m_id, d_hash, norm, w, k, 35, 40, 2, true);
        let (stub, _, _) = StubEmbedder::new(model_id.clone());
        let host = seal(dir.path(), |b| {
            b.with_compiled(sdk(Notes::new()))
                .with_embedder("remote", stub)
        })
        .unwrap();
        let m = call(
            &host,
            agent("ada"),
            "notes-read",
            json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
        )
        .await;
        assert_eq!(m.data.unwrap()["result"]["meaning"], json!("off"), "{case}");
        let check = doctor_meaning(&host).await;
        assert!(
            check["message"].as_str().unwrap().contains(expected_word),
            "{case}: {check}"
        );
        drop(host);
    }

    // Valid passing report!
    write_report(
        dir.path(),
        &model_id,
        &decl_hash,
        NORMALISATION_VERSION,
        0.5,
        5,
        35,
        40,
        2,
        true,
    );
    let (stub, fail_flag, calls) = StubEmbedder::new(model_id.clone());
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Notes::new()))
            .with_embedder("remote", stub)
    })
    .unwrap();

    // Bad query (empty texts) calls NO provider!
    let before = calls.load(Ordering::SeqCst);
    let bad_q = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": [] } }),
    )
    .await;
    assert!(!bad_q.success);
    assert_eq!(calls.load(Ordering::SeqCst), before);

    // n2 still lacks a vector -> match answers `incomplete`.
    let inc = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
    )
    .await;
    assert!(inc.success, "{inc:?}");
    assert_eq!(inc.data.unwrap()["result"]["meaning"], json!("incomplete"));

    // Run store-records-reindex with vectorsOnly=true -> fills n2's missing vector!
    let re = call(
        &host,
        agent("ada"),
        "store-records-reindex",
        json!({ "kind": "note", "vectorsOnly": true }),
    )
    .await;
    assert!(re.success, "{re:?}");
    let re_data = re.data.unwrap();
    assert_eq!(re_data["kinds"][0]["vectorsWritten"], 1);
    assert_eq!(re_data["kinds"][0]["meaning"], "served");

    // Now match answers `served` with meaning and fused scores!
    let served = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
    )
    .await;
    assert!(served.success, "{served:?}");
    let res = served.data.unwrap()["result"].clone();
    assert_eq!(res["meaning"], json!({ "served": model_id.as_str() }));
    assert!(res["results"][0]["nearest"][0]["meaning"].is_number());
    assert!(res["results"][0]["nearest"][0]["fused"].is_number());

    // When embedder fails during match -> answers `failed` and falls back to words-only!
    fail_flag.store(true, Ordering::SeqCst);
    let failed = call(
        &host,
        agent("ada"),
        "notes-read",
        json!({ "op": "match", "args": { "kind": "note", "texts": ["Prune roses."] } }),
    )
    .await;
    assert!(failed.success, "{failed:?}");
    let res = failed.data.unwrap()["result"].clone();
    assert_eq!(res["meaning"], json!("failed"));
    assert_eq!(res["results"][0]["nearest"][0]["meaning"], Value::Null);
}

#[tokio::test]
async fn doctor_keeps_http_destination_warning_when_another_model_fails_to_load() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = r#"config_version = 6

[spaces.garden]
person = "human:ada"

[spaces.garden.meaning]
model = "remote"
weight = 0.5
k = 5

[models.remote]
provider = "http"
name = "demo"
url = "https://embed.example.com/v1/embeddings"
dimensions = 16
version = "v1"

[models.broken]
provider = "static"
name = "missing-model"
dir = "models/does-not-exist"

[models.broken.files]
"model.safetensors" = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
"tokenizer.json" = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
"config.json" = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

[plugins]
enabled = ["notes"]

[plugins.notes]
spaces = ["garden"]

[plugins.notes.grants.records_write]
allow = ["garden"]
"#;
    let model_id = {
        fs::write(dir.path().join("umbel.toml"), cfg).unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        ws.config().models[0].model_id()
    };
    let (stub, _, _) = StubEmbedder::new(model_id);
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Notes::new()))
            .with_embedder("remote", stub)
    })
    .unwrap();
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "fail", "{check}");
    let msg = check["message"].as_str().unwrap();
    assert!(msg.contains("broken"), "must report broken model: {msg}");
    assert!(
        msg.contains("embed.example.com"),
        "http destination warning must not be hidden by another model's failure: {msg}"
    );
}

#[tokio::test]
async fn eval_report_inside_command_writable_collection_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = r#"config_version = 6

[spaces.garden]
person = "human:ada"

[spaces.garden.collections.all]
root = "evals"

[spaces.garden.meaning]
model = "remote"
weight = 0.5
k = 5

[models.remote]
provider = "http"
name = "demo"
url = "http://127.0.0.1:9999/v1/embeddings"
dimensions = 16
version = "v1"

[plugins]
enabled = ["notes"]

[plugins.notes]
spaces = ["garden"]

[plugins.notes.grants.records_write]
allow = ["garden"]

[plugins.notes.grants.content_write]
allow = ["garden/all"]
"#;
    fs::write(dir.path().join("umbel.toml"), cfg).unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let model_id = ws.config().models[0].model_id();
    let decl_hash = notes_note_decl().hash().as_str().to_owned();
    write_report(
        dir.path(),
        &model_id,
        &decl_hash,
        NORMALISATION_VERSION,
        0.5,
        5,
        35,
        40,
        2,
        true,
    );
    let (stub, _, _) = StubEmbedder::new(model_id);
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Notes::new()))
            .with_embedder("remote", stub)
    })
    .unwrap();
    let check = doctor_meaning(&host).await;
    assert_eq!(check["status"], "warn", "{check}");
    let msg = check["message"].as_str().unwrap();
    assert!(
        msg.contains("command-writable"),
        "eval report inside command-writable root must be rejected: {msg}"
    );
}
