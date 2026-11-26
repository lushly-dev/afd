//! Records host specification step B6 exit test (section 16, #2003):
//!
//! A compiled fixture plugin declared here with a standing kind `note` (a statement, two keys
//! `/bed` and `/tags`, and a match field `/statement`). One continuous run over MCP (Streamable
//! HTTP and stdio) and at the CLI exercising:
//!
//! 1. Put declared standing records;
//! 2. Find by key and by text (id and rank orders);
//! 3. Match two captures in a row (and a two-text batch), carrying the hit's standing label
//!    unchanged;
//! 4. Cite a document of an `own` collection and read `attested`;
//! 5. Change the cited document on disk, re-sync, and read `unverified` (attested lapsed);
//! 6. Affirm a note at a terminal (`confirm = "require-human"`);
//! 7. Read, find and match with `verified_only` under each `verified_admits` (`affirmed` and
//!    `affirmed+attested`);
//! 8. Reindex via `store-records-reindex` after a declaration change (wording preserved,
//!    affirmation kept) and after an undeclared edit (wording moved, affirmation cleared);
//! 9. The stub embedding model's eval gate both ways via `store-records-eval`: failing report
//!    leaves `meaning` off; passing report serves `meaning` and `fused` scores over MCP.
use crate::support;
use std::fs;
use std::path::Path;

use afd::{CommandContext, CommandError, CommandResult};
use serde_json::{Value, json};
use support::mcp::{Client, Era, Transport};
use support::plugins::{Raw, closure, seal};
use support::{Run, Scripted, cli_with};
use umbel::Host;
use umbel::plugins::{
    CallServices, DocumentServices, DocumentWriteServices, RecordServices, RecordWriteServices,
    ServiceError, Services,
};
use umbel::workspace::Workspace;
use umbel_sdk::umbel_store::lane::{
    Decision, Evidence, FindOrder, FindPage, KeyFilter, LaneRecord, MatchHit, MatchPage,
    MeaningState, Pointer, RecordFind, RecordMatch, Standing, StandingLabel, TextQuery,
};
use umbel_sdk::umbel_store::{ContentHash, Envelope, Expect};
use umbel_store::conformance::samples;
use umbel_store::{EmbedError, Embedder, ModelId};

// ── Fixture plugin declared in this file (host-records.spec.md §16) ────────────────────────────

const OPS_SCHEMA: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, op = { type = \"string\" }, args = { type = \"object\" } }, required = [\"op\"], additionalProperties = false }";

fn fixture_manifest(records_section: &str) -> String {
    format!(
        r#"manifest_version = 6
protocol = 1

[plugin]
id = "exitnotes"
title = "Exit notes"
version = "0.1.0"
description = "Fixture plugin for the records host step B6 exit test."
kind = "compiled"
domains = ["exitnotes"]

[[grants]]
name = "records"
reason = "Reads declared notes."

[[grants]]
name = "records_write"
reason = "Writes notes and records standing decisions."

[[grants]]
name = "documents"
reason = "Reads cited documents."

[[grants]]
name = "documents_write"
reason = "Stores synced documents."

{records_section}

[[commands]]
name = "exitnotes-write"
description = "Write a note, cite an own document, or sync a document."
effects = ["store-write"]
input_schema = {OPS_SCHEMA}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "exitnotes-read"
description = "Read, find, or match notes."
effects = ["inspect"]
input_schema = {OPS_SCHEMA}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "exitnotes-affirm"
description = "Affirm a note at a terminal."
effects = ["store-write"]
input_schema = {OPS_SCHEMA}
confirm_prompt = "Affirm this note as your own?"
confirm = "require-human"
expose = {{ mcp = false, agent = false, cli = true }}
journal = {{ mode = "digest", keep = ["space", "op"] }}
"#
    )
}

const DECL_BASE: &str = r#"[[records]]
kind = "note"
standing = true
text = ["/statement"]
keys = ["/bed", "/tags"]
match = "/statement""#;

const DECL_WITH_SEASON: &str = r#"[[records]]
kind = "note"
standing = true
text = ["/statement"]
keys = ["/bed", "/tags", "/season"]
match = "/statement""#;

fn exit_plugin(records_section: &str) -> Raw {
    Raw::new(fixture_manifest(records_section), |services| {
        Ok(["exitnotes-write", "exitnotes-read", "exitnotes-affirm"]
            .into_iter()
            .map(|name| {
                let services = services.clone();
                closure(name, move |input, context| {
                    dispatch(&services, name, &input, &context)
                })
            })
            .collect())
    })
}

fn str_field<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn str_vec(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn standings_of(args: &Value) -> Vec<Standing> {
    str_vec(args, "standings")
        .iter()
        .map(|s| serde_json::from_value(json!(s)).unwrap())
        .collect()
}

fn parse_ptr(text: &str) -> Result<Pointer, ServiceError> {
    Pointer::parse(text).map_err(|e| ServiceError::Invalid(e.to_string()))
}

fn key_filters_of(args: &Value) -> Result<Vec<KeyFilter>, ServiceError> {
    let mut out = Vec::new();
    for item in args
        .get("keys")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        out.push(KeyFilter {
            key: parse_ptr(str_field(item, "key"))?,
            any: str_vec(item, "any"),
        });
    }
    Ok(out)
}

fn envelope(space: &str) -> Envelope {
    let mut env = samples::envelope(&["space"], "exit", "2026-11-23T00:00:00.000Z");
    env.space = space.to_owned();
    env
}

fn encode_find(found: &FindPage) -> Value {
    json!({
        "items": found.items.iter().map(LaneRecord::to_json).collect::<Vec<_>>(),
        "ids": found.items.iter().map(|r| r.record.id.clone()).collect::<Vec<_>>(),
        "total": found.total,
        "admitted": found.admitted,
        "cut": found.cut,
    })
}

fn encode_match(found: &MatchPage) -> Value {
    let hit = |h: &MatchHit| {
        json!({
            "id": h.id,
            "rev": h.rev,
            "text": h.text,
            "dev.umbel/flags": h.flags.iter().map(|f| f.as_str()).collect::<Vec<_>>(),
            "dev.umbel/standing": h.label.as_ref().map(StandingLabel::to_json),
            "words": h.words,
            "meaning": h.meaning,
            "fused": h.fused,
        })
    };
    json!({
        "results": found.results.iter().map(|r| json!({
            "identical": r.identical.iter().map(hit).collect::<Vec<_>>(),
            "identicalIds": r.identical.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
            "nearest": r.nearest.iter().map(hit).collect::<Vec<_>>(),
            "nearestIds": r.nearest.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
            "cut": r.cut,
        })).collect::<Vec<_>>(),
        "admitted": found.admitted,
        "meaning": match &found.meaning {
            MeaningState::Served(model) => json!({ "served": model.as_str() }),
            MeaningState::Off => json!("off"),
            MeaningState::Incomplete => json!("incomplete"),
            MeaningState::Failed => json!("failed"),
        },
    })
}

fn run_op(cx: &CallServices, space: &str, op: &str, args: &Value) -> Result<Value, ServiceError> {
    let verified_only = args.get("verifiedOnly").and_then(Value::as_bool) == Some(true);
    match op {
        "put" => cx
            .record_put(
                space,
                "note",
                str_field(args, "id"),
                args.get("body").cloned().unwrap_or(json!({})),
                envelope(space),
                Expect::Any,
            )
            .map(|m| json!({ "rev": m.rev, "contentHash": m.content_hash })),
        "sync" => {
            let mut doc = samples::document(
                str_field(args, "doc"),
                &["space"],
                str_field(args, "text"),
                "sync",
            );
            doc.space = space.to_owned();
            doc.envelope.space = space.to_owned();
            cx.doc_put(space, doc, Expect::Any)
                .map(|m| json!({ "rev": m.rev, "contentHash": m.content_hash }))
        }
        "cite" => {
            let doc_id = str_field(args, "doc");
            let doc_hash = match args.get("hash").and_then(Value::as_str) {
                Some(h) => {
                    ContentHash::parse(h).map_err(|e| ServiceError::Invalid(e.to_string()))?
                }
                None => cx
                    .doc_get(space, doc_id)?
                    .map(|d| d.write.content_hash)
                    .ok_or_else(|| ServiceError::NotFound("document not stored".to_owned()))?,
            };
            let evidence = Evidence {
                doc: doc_id.to_owned(),
                doc_hash,
                units: vec![1],
                rule: "sentences/1".to_owned(),
                speaker: None,
                verbatim: true,
            };
            cx.record_put_cited(
                space,
                "note",
                str_field(args, "id"),
                args.get("body").cloned().unwrap_or(json!({})),
                envelope(space),
                Expect::Any,
                evidence,
            )
            .map(|m| json!({ "rev": m.rev }))
        }
        "affirm" => cx
            .record_decide(space, "note", str_field(args, "id"), Decision::Affirm)
            .map(|label| label.to_json()),
        "read" => cx
            .record_read(
                space,
                "note",
                str_field(args, "id"),
                &standings_of(args),
                verified_only,
            )
            .map(|r| json!(r.as_ref().map(LaneRecord::to_json))),
        "find" => {
            let text_query = args.get("text").and_then(Value::as_str).map(|q| TextQuery {
                query: q.to_owned(),
                fields: Vec::new(),
            });
            let order = match str_field(args, "order") {
                "recent" => FindOrder::Recent,
                "rank" => FindOrder::Rank,
                _ => FindOrder::Id,
            };
            let query = RecordFind {
                kind: "note".to_owned(),
                keys: key_filters_of(args)?,
                standings: standings_of(args),
                verified_only,
                text: text_query,
                order,
                after: None,
                limit: 200,
                total: true,
            };
            cx.record_find(space, &query).map(|p| encode_find(&p))
        }
        "match" => {
            let query = RecordMatch {
                kind: "note".to_owned(),
                texts: str_vec(args, "texts"),
                k: args
                    .get("k")
                    .and_then(Value::as_u64)
                    .map_or(5, |k| u32::try_from(k).unwrap()),
                keys: key_filters_of(args)?,
                standings: standings_of(args),
                verified_only,
                exclude: str_vec(args, "exclude"),
            };
            cx.record_match(space, &query).map(|p| encode_match(&p))
        }
        other => Err(ServiceError::Invalid(format!("unknown op {other}"))),
    }
}

fn dispatch(
    services: &Services,
    name: &'static str,
    input: &Value,
    context: &CommandContext,
) -> CommandResult<Value> {
    let cx = services.call_command(name, input, context);
    let space = cx.space().as_str().to_owned();
    let op = str_field(input, "op");
    let args = input.get("args").cloned().unwrap_or(json!({}));
    match run_op(&cx, &space, op, &args) {
        Ok(data) => afd::success(json!({ "result": data })),
        Err(err) => afd::failure(
            CommandError::new("HOST_SERVICE_ERROR", err.to_string())
                .with_suggestion("Inspect the host service error message."),
        ),
    }
}

// ── Deterministic stub embedder for gate-both-ways verification ────────────────────────────────

struct ExitStubEmbedder {
    model: ModelId,
}

impl ExitStubEmbedder {
    fn vector_for(text: &str) -> Vec<f32> {
        let mut vec = vec![0.0f32; 128];
        for prefix in ["#pair", "#query"] {
            if let Some(pos) = text.find(prefix) {
                let digits: String = text[pos + prefix.len()..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if let Ok(idx) = digits.parse::<usize>() {
                    vec[idx % 128] = 1.0;
                    return vec;
                }
            }
        }
        vec[127] = 1.0;
        vec
    }
}

impl Embedder for ExitStubEmbedder {
    fn model(&self) -> &ModelId {
        &self.model
    }
    fn dimensions(&self) -> usize {
        128
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        Ok(texts.iter().map(|t| Self::vector_for(t)).collect())
    }
}

// ── Workspace & driver helpers ─────────────────────────────────────────────────────────────────

fn write_config(dir: &Path, verified_admits: &str, with_meaning: bool) {
    let meaning = if with_meaning {
        r#"
[spaces.garden.meaning]
model = "stub"
weight = 0.5
k = 5

[models.stub]
provider = "http"
name = "exit-stub"
url = "http://127.0.0.1:19876/v1/embeddings"
dimensions = 128
version = "1"
"#
    } else {
        ""
    };
    let toml = format!(
        r#"config_version = 6
default_space = "garden"

[spaces.garden]
person = "human:local"
verified_admits = "{verified_admits}"

[spaces.garden.collections.journal]
root = "content/journal"
own = true
{meaning}
[plugins]
enabled = ["exitnotes"]

[plugins.exitnotes]
source = "compiled:exitnotes"

[plugins.exitnotes.grants.records_write]
allow = ["garden"]
default_access = "space"

[plugins.exitnotes.grants.documents_write]
allow = ["garden/*"]
"#
    );
    fs::write(dir.join("umbel.toml"), toml).unwrap();
    fs::create_dir_all(dir.join("content/journal")).unwrap();
}

fn open_host(dir: &Path, records_section: &str, model: Option<ModelId>) -> Host {
    seal(dir, |builder| {
        let builder = builder.with_compiled(exit_plugin(records_section));
        match model {
            Some(model_id) => builder.with_embedder("stub", ExitStubEmbedder { model: model_id }),
            None => builder,
        }
    })
    .unwrap()
}

async fn cli_call(
    dir: &Path,
    records_section: &'static str,
    model: Option<ModelId>,
    command: &str,
    input: Value,
    console: std::sync::Arc<Scripted>,
    extra: &[&str],
) -> Run {
    let payload = input.to_string();
    let mut argv = vec!["call", command, &payload];
    argv.extend_from_slice(extra);
    cli_with(dir, &argv, console, move |builder| {
        let builder = builder.with_compiled(exit_plugin(records_section));
        match model {
            Some(model_id) => builder.with_embedder("stub", ExitStubEmbedder { model: model_id }),
            None => builder,
        }
    })
    .await
}

fn cli_result(run: &Run) -> Value {
    assert_eq!(run.code, 0, "CLI failed: {}", run.stdout);
    run.json()["data"]["result"].clone()
}

async fn mcp_op(client: &mut Client, command: &str, op: &str, args: Value) -> Value {
    let res = client
        .afd_call(command, json!({ "op": op, "args": args }))
        .await;
    assert_eq!(res["success"], true, "MCP {command} {op} failed: {res}");
    res["data"]["result"].clone()
}

fn assert_no_knowledge_tier(label: &Value) {
    assert!(
        matches!(
            label["standing"].as_str(),
            Some("unverified" | "attested" | "affirmed")
        ),
        "unexpected standing label: {label}"
    );
    let text = label.to_string();
    for forbidden in ["\"machine\"", "\"human\"", "\"owner\"", "\"tier\""] {
        assert!(
            !text.contains(forbidden),
            "label must never carry knowledge tier {forbidden}: {label}"
        );
    }
}

#[tokio::test]
async fn records_exit_over_mcp_and_cli() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), "affirmed", false);

    // ── 1. Put over MCP (HTTP + stdio) and at the CLI ──────────────────────────────────────────
    let host = open_host(dir.path(), DECL_BASE, None);
    let mut mcp_http = Client::connect(&host, Transport::Http, Era::Modern).await;
    let mut mcp_stdio = Client::connect(&host, Transport::Stdio, Era::Modern).await;

    let roses = "Prune roses in late winter, before the buds swell.";
    let roses_near = "Roses are pruned in late winter before their buds swell.";
    let tomatoes = "Tomatoes need six hours of sun and steady watering.";

    mcp_op(
        &mut mcp_http,
        "exitnotes-write",
        "put",
        json!({
            "id": "n1",
            "body": { "statement": roses, "bed": "north", "tags": ["roses", "pruning"], "season": "winter" }
        }),
    )
    .await;
    mcp_op(
        &mut mcp_stdio,
        "exitnotes-write",
        "put",
        json!({
            "id": "n2",
            "body": { "statement": tomatoes, "bed": "south", "tags": ["tomatoes", "watering"], "season": "summer" }
        }),
    )
    .await;
    drop(host);

    // Put a third record from the CLI.
    let put_cli = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-write",
        json!({
            "op": "put",
            "args": {
                "id": "n3",
                "body": { "statement": "Mulch keeps the soil cool and holds water through summer.", "bed": "north", "tags": ["mulch", "watering"], "season": "summer" }
            }
        }),
        Scripted::no_terminal(),
        &[],
    )
    .await;
    assert!(cli_result(&put_cli)["rev"].as_u64().unwrap() >= 3);

    // ── 2. Find by key and by text over MCP and CLI ────────────────────────────────────────────
    let host = open_host(dir.path(), DECL_BASE, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;

    let by_key_mcp = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "keys": [{ "key": "/bed", "any": ["north"] }] }),
    )
    .await;
    assert_eq!(by_key_mcp["ids"], json!(["n1", "n3"]));
    assert_eq!(by_key_mcp["total"], 2);

    let by_two_keys_mcp = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({
            "keys": [
                { "key": "/bed", "any": ["north"] },
                { "key": "/tags", "any": ["watering"] }
            ]
        }),
    )
    .await;
    assert_eq!(by_two_keys_mcp["ids"], json!(["n3"]));

    let by_text_id_mcp = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "text": "watering", "order": "id" }),
    )
    .await;
    assert_eq!(by_text_id_mcp["ids"], json!(["n2", "n3"]));
    assert_eq!(by_text_id_mcp["total"], 2);

    let by_text_rank_mcp = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "text": "prune roses late winter", "order": "rank" }),
    )
    .await;
    assert_eq!(by_text_rank_mcp["ids"], json!(["n1"]));
    assert_no_knowledge_tier(&by_text_rank_mcp["items"][0]["dev.umbel/standing"]);
    assert_eq!(
        by_text_rank_mcp["items"][0]["dev.umbel/standing"]["standing"],
        "unverified"
    );

    // ── 3. Match two captures in a row (and a two-text batch) over MCP and CLI ─────────────────
    // Capture 1: match near wording against existing notes.
    let match_1 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({ "texts": [roses_near], "k": 5 }),
    )
    .await;
    assert_eq!(match_1["meaning"], json!("off"));
    assert_eq!(match_1["results"][0]["identicalIds"], json!([]));
    assert_eq!(match_1["results"][0]["nearestIds"], json!(["n1"]));
    let hit = &match_1["results"][0]["nearest"][0];
    assert!(hit["words"].as_f64().unwrap() > 0.5, "{hit}");
    assert_eq!(hit["meaning"], Value::Null);
    assert_eq!(hit["fused"], hit["words"]);
    assert_no_knowledge_tier(&hit["dev.umbel/standing"]);

    // Put capture 1 (`n4`), then match capture 2 in a row (two-text batch: identical + near).
    mcp_op(
        &mut mcp,
        "exitnotes-write",
        "put",
        json!({
            "id": "n4",
            "body": { "statement": roses_near, "bed": "north", "tags": ["roses"], "season": "winter" }
        }),
    )
    .await;
    let match_2 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({
            "texts": [
                "PRUNE ROSES  in late winter, before the buds swell.",
                "Prune your roses in late winter before the buds swell."
            ],
            "k": 5
        }),
    )
    .await;
    assert_eq!(match_2["results"][0]["identicalIds"], json!(["n1"]));
    let near_ids = match_2["results"][1]["nearestIds"].as_array().unwrap();
    assert!(
        near_ids.len() >= 2 && near_ids[0] == json!("n1") && near_ids[1] == json!("n4"),
        "expected n1 then n4 at the top of nearest hits: {near_ids:?}"
    );
    let read_n1_mcp = mcp_op(&mut mcp, "exitnotes-read", "read", json!({ "id": "n1" })).await;
    assert_eq!(
        match_2["results"][0]["identical"][0]["dev.umbel/standing"],
        read_n1_mcp["dev.umbel/standing"],
        "MCP match hit standing must equal record_read standing unchanged"
    );
    assert_no_knowledge_tier(&match_2["results"][0]["identical"][0]["dev.umbel/standing"]);
    drop(host);

    // Confirm find + match work identically at the CLI and carry standing unchanged.
    let find_cli = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-read",
        json!({ "op": "find", "args": { "text": "tomatoes sun", "order": "rank" } }),
        Scripted::no_terminal(),
        &[],
    )
    .await;
    assert_eq!(cli_result(&find_cli)["ids"], json!(["n2"]));

    let read_n1_cli = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-read",
        json!({ "op": "read", "args": { "id": "n1" } }),
        Scripted::no_terminal(),
        &[],
    )
    .await;
    let read_n3_cli = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-read",
        json!({ "op": "read", "args": { "id": "n3" } }),
        Scripted::no_terminal(),
        &[],
    )
    .await;
    let match_cli = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-read",
        json!({ "op": "match", "args": { "texts": [roses, "Watering soil with mulch"], "k": 5 } }),
        Scripted::no_terminal(),
        &[],
    )
    .await;
    let match_cli_res = cli_result(&match_cli);
    assert_eq!(match_cli_res["results"][0]["identicalIds"], json!(["n1"]));
    assert_eq!(
        match_cli_res["results"][0]["identical"][0]["dev.umbel/standing"],
        cli_result(&read_n1_cli)["dev.umbel/standing"],
        "CLI identical match hit standing must equal CLI record_read standing"
    );
    let n3_hit = match_cli_res["results"][1]["nearest"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["id"] == json!("n3"))
        .expect("n3 must appear in CLI nearest hits");
    assert_eq!(
        n3_hit["dev.umbel/standing"],
        cli_result(&read_n3_cli)["dev.umbel/standing"],
        "CLI nearest match hit standing must equal CLI record_read standing"
    );

    // ── 4. Cite a document of an own collection and read attested ──────────────────────────────
    let journal_text = "Compost feeds the bed slowly through spring.";
    fs::write(dir.path().join("content/journal/spring.md"), journal_text).unwrap();

    let host = open_host(dir.path(), DECL_BASE, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    mcp_op(
        &mut mcp,
        "exitnotes-write",
        "sync",
        json!({ "doc": "journal/spring", "text": journal_text }),
    )
    .await;
    mcp_op(
        &mut mcp,
        "exitnotes-write",
        "cite",
        json!({
            "id": "n_cited",
            "doc": "journal/spring",
            "body": { "statement": journal_text, "bed": "east", "tags": ["compost"], "season": "spring" }
        }),
    )
    .await;
    let attested = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "read",
        json!({ "id": "n_cited" }),
    )
    .await;
    assert_no_knowledge_tier(&attested["dev.umbel/standing"]);
    assert_eq!(attested["dev.umbel/standing"]["standing"], "attested");
    assert_eq!(
        attested["dev.umbel/standing"]["source"]["basis"],
        "collection"
    );
    assert_eq!(
        attested["dev.umbel/standing"]["source"]["doc"],
        "journal/spring"
    );

    // ── 5. Change the cited document on disk, re-sync, and read unverified ─────────────────────
    let updated_text = "Aged compost feeds the bed slowly through spring and autumn.";
    fs::write(dir.path().join("content/journal/spring.md"), updated_text).unwrap();
    mcp_op(
        &mut mcp,
        "exitnotes-write",
        "sync",
        json!({ "doc": "journal/spring", "text": updated_text }),
    )
    .await;
    let lapsed = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "read",
        json!({ "id": "n_cited" }),
    )
    .await;
    assert_no_knowledge_tier(&lapsed["dev.umbel/standing"]);
    assert_eq!(
        lapsed["dev.umbel/standing"]["standing"], "unverified",
        "editing the cited own document must lapse attested standing"
    );

    // Cite a fresh note against the updated document so we have a live attested record too.
    mcp_op(
        &mut mcp,
        "exitnotes-write",
        "cite",
        json!({
            "id": "n_attested",
            "doc": "journal/spring",
            "body": { "statement": updated_text, "bed": "east", "tags": ["compost"], "season": "spring" }
        }),
    )
    .await;
    assert_eq!(
        mcp_op(
            &mut mcp,
            "exitnotes-read",
            "read",
            json!({ "id": "n_attested" })
        )
        .await["dev.umbel/standing"]["standing"],
        "attested"
    );
    drop(host);

    // ── 6. Affirm n1 at a terminal ─────────────────────────────────────────────────────────────
    let console = Scripted::new(true, true);
    let affirm_run = cli_call(
        dir.path(),
        DECL_BASE,
        None,
        "exitnotes-affirm",
        json!({ "op": "affirm", "args": { "id": "n1" } }),
        console.clone(),
        &[],
    )
    .await;
    let affirm_label = cli_result(&affirm_run);
    assert_eq!(console.asked().len(), 1);
    assert_no_knowledge_tier(&affirm_label);
    assert_eq!(affirm_label["standing"], "affirmed");
    assert_eq!(affirm_label["affirmed"]["by"], "human:local");
    assert_eq!(affirm_label["affirmed"]["assurance"]["level"], "terminal");

    // ── 7. Read, find and match with verified_only under each verified_admits ──────────────────
    // 7a. verified_admits = "affirmed": only n1 is admitted; n_attested and n2 are hidden.
    let host = open_host(dir.path(), DECL_BASE, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let read_n1 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "read",
        json!({ "id": "n1", "verifiedOnly": true }),
    )
    .await;
    assert_eq!(read_n1["dev.umbel/standing"]["standing"], "affirmed");
    assert!(
        read_n1["dev.umbel/standing"]["affirmed"]["by"].is_null(),
        "MCP agent caller must not learn who affirmed: {read_n1}"
    );
    assert_eq!(
        mcp_op(
            &mut mcp,
            "exitnotes-read",
            "read",
            json!({ "id": "n_attested", "verifiedOnly": true })
        )
        .await,
        Value::Null
    );
    let find_v1 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(find_v1["ids"], json!(["n1"]));
    assert_eq!(find_v1["admitted"], json!(["affirmed"]));

    let match_v1 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({ "texts": [updated_text, roses], "verifiedOnly": true }),
    )
    .await;
    assert_eq!(match_v1["admitted"], json!(["affirmed"]));
    assert_eq!(match_v1["results"][0]["identicalIds"], json!([]));
    assert_eq!(match_v1["results"][1]["identicalIds"], json!(["n1"]));
    drop(host);

    // 7b. verified_admits = "affirmed+attested": both n1 and n_attested are admitted, n2 hidden.
    write_config(dir.path(), "affirmed+attested", false);
    let host = open_host(dir.path(), DECL_BASE, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let read_n1_v2 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "read",
        json!({ "id": "n1", "verifiedOnly": true }),
    )
    .await;
    assert_eq!(read_n1_v2["dev.umbel/standing"]["standing"], "affirmed");
    let read_attested_v2 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "read",
        json!({ "id": "n_attested", "verifiedOnly": true }),
    )
    .await;
    assert_eq!(
        read_attested_v2["dev.umbel/standing"]["standing"],
        "attested"
    );
    assert_eq!(
        mcp_op(
            &mut mcp,
            "exitnotes-read",
            "read",
            json!({ "id": "n2", "verifiedOnly": true })
        )
        .await,
        Value::Null,
        "unverified n2 must remain hidden under verified_only"
    );

    let find_v2 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "verifiedOnly": true }),
    )
    .await;
    assert_eq!(find_v2["ids"], json!(["n1", "n_attested"]));
    assert_eq!(find_v2["admitted"], json!(["attested", "affirmed"]));

    let match_v2 = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({ "texts": [updated_text, roses], "verifiedOnly": true }),
    )
    .await;
    assert_eq!(match_v2["admitted"], json!(["attested", "affirmed"]));
    assert_eq!(
        match_v2["results"][0]["identicalIds"],
        json!(["n_attested"])
    );
    assert_eq!(
        match_v2["results"][0]["identical"][0]["dev.umbel/standing"],
        read_attested_v2["dev.umbel/standing"],
        "attested match hit standing must equal record_read standing unchanged"
    );
    assert_eq!(match_v2["results"][1]["identicalIds"], json!(["n1"]));
    assert_eq!(
        match_v2["results"][1]["identical"][0]["dev.umbel/standing"],
        read_n1_v2["dev.umbel/standing"],
        "affirmed match hit standing must equal record_read standing unchanged"
    );
    drop(host);

    // ── 8. Reindex after a declaration change and after an undeclared edit ─────────────────────
    // 8a. Declaration change (add `/season` key; wording pointer unchanged -> affirmation kept).
    let host = open_host(dir.path(), DECL_WITH_SEASON, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let stale_err = mcp
        .afd_call(
            "exitnotes-read",
            json!({ "op": "find", "args": { "keys": [{ "key": "/season", "any": ["winter"] }] } }),
        )
        .await;
    assert_eq!(stale_err["success"], false, "expected stale refusal");
    assert!(
        stale_err["error"]["message"]
            .as_str()
            .unwrap()
            .contains("RECORD_LANE_STALE"),
        "{stale_err}"
    );
    drop(host);

    let reindex_decl = cli_call(
        dir.path(),
        DECL_WITH_SEASON,
        None,
        "store-records-reindex",
        json!({ "space": "garden", "plugin": "exitnotes", "kind": "note" }),
        Scripted::no_terminal(),
        &["--yes"],
    )
    .await;
    assert_eq!(reindex_decl.code, 0, "{}", reindex_decl.stdout);
    let reindex_data = reindex_decl.json()["data"].clone();
    assert_eq!(reindex_data["kinds"][0]["superseded"], false);
    assert_eq!(reindex_data["kinds"][0]["wordingsChanged"], 0);

    let host = open_host(dir.path(), DECL_WITH_SEASON, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let by_season = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "find",
        json!({ "keys": [{ "key": "/season", "any": ["winter"] }] }),
    )
    .await;
    assert_eq!(by_season["ids"], json!(["n1", "n4"]));
    assert_eq!(
        mcp_op(&mut mcp, "exitnotes-read", "read", json!({ "id": "n1" })).await["dev.umbel/standing"]
            ["standing"],
        "affirmed",
        "adding a key must keep affirmations when wording did not move"
    );
    drop(host);

    // 8b. Undeclared edit: reopen without `[[records]]`, edit n1's statement, then reopen declared.
    let host_undecl = open_host(dir.path(), "", None);
    let mut mcp_undecl = Client::connect(&host_undecl, Transport::Http, Era::Modern).await;
    mcp_op(
        &mut mcp_undecl,
        "exitnotes-write",
        "put",
        json!({
            "id": "n1",
            "body": { "statement": "Prune climbing roses in early spring after frost.", "bed": "north", "tags": ["roses"], "season": "spring" }
        }),
    )
    .await;
    drop(host_undecl);

    let host = open_host(dir.path(), DECL_WITH_SEASON, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let stale_after_edit = mcp
        .afd_call(
            "exitnotes-read",
            json!({ "op": "read", "args": { "id": "n1" } }),
        )
        .await;
    assert_eq!(stale_after_edit["success"], false);
    assert!(
        stale_after_edit["error"]["message"]
            .as_str()
            .unwrap()
            .contains("RECORD_LANE_STALE"),
        "{stale_after_edit}"
    );
    drop(host);

    let reindex_edit = cli_call(
        dir.path(),
        DECL_WITH_SEASON,
        None,
        "store-records-reindex",
        json!({ "space": "garden", "plugin": "exitnotes", "kind": "note" }),
        Scripted::no_terminal(),
        &["--yes"],
    )
    .await;
    assert_eq!(reindex_edit.code, 0, "{}", reindex_edit.stdout);
    assert_eq!(
        reindex_edit.json()["data"]["kinds"][0]["wordingsChanged"],
        1,
        "edited wording must be counted"
    );
    let host = open_host(dir.path(), DECL_WITH_SEASON, None);
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let n1_after = mcp_op(&mut mcp, "exitnotes-read", "read", json!({ "id": "n1" })).await;
    assert_eq!(
        n1_after["dev.umbel/standing"]["standing"], "unverified",
        "an undeclared edit that changed the wording must clear the prior affirmation"
    );
    drop(host);

    // ── 9. Stub model's eval gate both ways ────────────────────────────────────────────────────
    write_config(dir.path(), "affirmed+attested", true);
    let model_id = Workspace::open(dir.path()).unwrap().config().models[0].model_id();

    // Seed 55 pairs where stored records hold `#pair<i:03>` and probes hold `#query<i:03>` with
    // disjoint tokens so words misses them and the stub embedder hits them.
    let host = open_host(dir.path(), DECL_WITH_SEASON, Some(model_id.clone()));
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let mut passing_probes = Vec::new();
    let mut failing_probes = Vec::new();
    for i in 0..55usize {
        let id = format!("sem_{i:03}");
        let stored_text = format!("Botanical archive entry alpha{i:03} #pair{i:03}");
        mcp_op(
            &mut mcp,
            "exitnotes-write",
            "put",
            json!({
                "id": id,
                "body": { "statement": stored_text, "bed": "greenhouse", "tags": ["eval"], "season": "winter" }
            }),
        )
        .await;
        passing_probes.push(json!({
            "id": format!("p{i:03}"),
            "text": format!("Unrelated lexical cue omega{i:03} #query{i:03}"),
            "duplicates": [id],
            "self": null,
            "reader": null,
        }));
        if i < 50 {
            // Identical words: words already gets 50/50, so fused gain is 0 (< 3) -> fails gate!
            failing_probes.push(json!({
                "id": format!("f{i:03}"),
                "text": stored_text,
                "duplicates": [id],
                "self": null,
                "reader": null,
            }));
        }
    }
    drop(host);

    // Ensure all pre-existing records also have vectors via store-records-reindex (vectorsOnly).
    let vec_reindex = cli_call(
        dir.path(),
        DECL_WITH_SEASON,
        Some(model_id.clone()),
        "store-records-reindex",
        json!({ "space": "garden", "plugin": "exitnotes", "kind": "note", "vectorsOnly": true }),
        Scripted::no_terminal(),
        &["--yes"],
    )
    .await;
    assert_eq!(vec_reindex.code, 0, "{}", vec_reindex.stdout);
    assert!(
        vec_reindex.json()["data"]["kinds"][0]["vectorsWritten"]
            .as_u64()
            .unwrap()
            >= 5,
        "pre-existing records must receive vectors"
    );

    // 9a. Gate CLOSED: eval with zero gain -> passed = false, MCP match serves `meaning: "off"`.
    fs::create_dir_all(dir.path().join("probes")).unwrap();
    fs::write(
        dir.path().join("probes/fail.json"),
        serde_json::to_string_pretty(&json!({
            "version": 1,
            "space": "garden",
            "plugin": "exitnotes",
            "kind": "note",
            "probes": failing_probes,
        }))
        .unwrap(),
    )
    .unwrap();
    let eval_fail = cli_call(
        dir.path(),
        DECL_WITH_SEASON,
        Some(model_id.clone()),
        "store-records-eval",
        json!({
            "space": "garden",
            "plugin": "exitnotes",
            "kind": "note",
            "probes": "probes/fail.json"
        }),
        Scripted::no_terminal(),
        &["--yes"],
    )
    .await;
    assert_eq!(eval_fail.code, 0, "{}", eval_fail.stdout);
    let fail_report = eval_fail.json()["data"].clone();
    assert_eq!(fail_report["passed"], false, "{fail_report}");
    assert_eq!(fail_report["leaks"], 0);

    let host = open_host(dir.path(), DECL_WITH_SEASON, Some(model_id.clone()));
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let closed_match = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({ "texts": ["Unrelated lexical cue omega005 #query005"], "k": 5 }),
    )
    .await;
    assert_eq!(closed_match["meaning"], json!("off"));
    assert!(
        closed_match["results"][0]["nearestIds"]
            .as_array()
            .unwrap()
            .is_empty(),
        "with gate closed and no shared tokens, words alone finds no candidate"
    );
    drop(host);

    // 9b. Gate OPEN: eval with 55 probes where fused beats words by 55 -> passed = true,
    //     MCP match serves `meaning: { "served": model_id }` with `meaning` and `fused` scores.
    fs::write(
        dir.path().join("probes/pass.json"),
        serde_json::to_string_pretty(&json!({
            "version": 1,
            "space": "garden",
            "plugin": "exitnotes",
            "kind": "note",
            "probes": passing_probes,
        }))
        .unwrap(),
    )
    .unwrap();
    let eval_pass = cli_call(
        dir.path(),
        DECL_WITH_SEASON,
        Some(model_id.clone()),
        "store-records-eval",
        json!({
            "space": "garden",
            "plugin": "exitnotes",
            "kind": "note",
            "probes": "probes/pass.json"
        }),
        Scripted::no_terminal(),
        &["--yes"],
    )
    .await;
    assert_eq!(eval_pass.code, 0, "{}", eval_pass.stdout);
    let pass_report = eval_pass.json()["data"].clone();
    assert_eq!(pass_report["passed"], true, "{pass_report}");
    assert_eq!(pass_report["n"], 55);
    assert_eq!(pass_report["leaks"], 0);
    assert_eq!(pass_report["hits"]["words"]["k"], 0);
    assert_eq!(pass_report["hits"]["fused"]["k"], 55);

    let host = open_host(dir.path(), DECL_WITH_SEASON, Some(model_id.clone()));
    let mut mcp = Client::connect(&host, Transport::Http, Era::Modern).await;
    let open_match = mcp_op(
        &mut mcp,
        "exitnotes-read",
        "match",
        json!({ "texts": ["Unrelated lexical cue omega005 #query005"], "k": 5 }),
    )
    .await;
    assert_eq!(
        open_match["meaning"],
        json!({ "served": model_id.as_str() })
    );
    assert_eq!(open_match["results"][0]["nearestIds"][0], json!("sem_005"));
    let top = &open_match["results"][0]["nearest"][0];
    assert_eq!(top["words"], json!(0.0));
    assert_eq!(top["meaning"], json!(1.0));
    assert_eq!(top["fused"], json!(0.5));
    assert_no_knowledge_tier(&top["dev.umbel/standing"]);
}
