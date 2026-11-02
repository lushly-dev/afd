//! A compiled plugin whose commands exercise the store grants, and workspaces with collections,
//! readers and groups for it. One generic `op` per command keeps the manifest small.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use umbel_sdk::umbel_store::{
    Direction, DocGraph, DocumentWrite, Edge, Expect, GraphBatch, IndexFilters, IndexQuery,
    ListQuery, Node,
};
use umbel_sdk::{Cx, HostError, Outcome, Plugin, failure, success};
use umbel_store::conformance::samples;

use super::plugins::{grants_toml, leak};

/// Every store grant, read and write.
pub const ALL_GRANTS: &[&str] = &[
    "content",
    "content_write",
    "documents",
    "documents_write",
    "records",
    "records_write",
    "index",
    "index_write",
    "graph",
    "graph_write",
];

const INPUT: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, spaces = { type = \"array\", items = { type = \"string\" } }, op = { type = \"string\" }, args = { type = \"object\" } }, required = [\"op\"], additionalProperties = false }";

/// The probe's manifest with `grants` and the commands' extra keys.
pub fn manifest(grants: &str, extra: &str) -> String {
    // An effect needs its grant declared (manifest version 2); a probe without the grant falls
    // back to `plugin-state`, which every plugin may name.
    let declared = |name: &str| grants.contains(&format!("name = \"{name}\""));
    let store = if [
        "documents_write",
        "records_write",
        "index_write",
        "graph_write",
    ]
    .iter()
    .any(|name| declared(name))
    {
        "store-write"
    } else {
        "plugin-state"
    };
    let files = if declared("content_write") {
        "workspace-write"
    } else {
        "plugin-state"
    };
    format!(
        r#"manifest_version = 2
protocol = 1

[plugin]
id = "sp"
title = "Store probe"
version = "0.1.0"
description = "A plugin whose commands use the store grants."
kind = "compiled"
domains = ["sp"]

{grants}
[[commands]]
name = "sp-read"
description = "Read through the store grants."
effects = ["inspect"]
input_schema = {INPUT}

[[commands]]
name = "sp-write"
description = "Write through the store grants."
effects = ["{store}"]
input_schema = {INPUT}

[[commands]]
name = "sp-files"
description = "Write files through the content grants."
effects = ["{files}"]
input_schema = {INPUT}

[[commands]]
name = "sp-eval"
description = "Read as another principal, from the CLI."
effects = ["inspect"]
input_schema = {INPUT}
expose = {{ mcp = false, agent = false, cli = true }}

[[commands]]
name = "sp-forge"
description = "Try to set the host's result keys."
effects = ["{store}"]
input_schema = {INPUT}

[[commands]]
name = "sp-approve"
description = "Needs a person at a terminal."
effects = ["{store}"]
input_schema = {INPUT}
confirm_prompt = "Really approve it?"
confirm = "require-human"
expose = {{ mcp = false, agent = false, cli = true }}
{extra}"#
    )
}

pub struct StoreProbe {
    manifest: &'static str,
}

impl StoreProbe {
    /// Every store grant declared as required.
    pub fn new() -> Self {
        Self::with_grants(ALL_GRANTS, true)
    }

    pub fn with_grants(grants: &[&str], required: bool) -> Self {
        Self::with_manifest(manifest(&grants_toml(grants, required), ""))
    }

    pub fn with_manifest(text: String) -> Self {
        Self {
            manifest: leak(text),
        }
    }
}

/// A failure that names the error: `NOT_GRANTED`, `CONFLICT`, ... and the host's message.
fn refused(error: &HostError) -> Outcome {
    let code = match error {
        HostError::NotGranted(_) => "NOT_GRANTED",
        HostError::NotFound(_) => "NOT_FOUND",
        HostError::Invalid(_) => "INVALID",
        HostError::TooLarge(_) => "TOO_LARGE",
        HostError::Conflict { .. } => "CONFLICT",
        HostError::Busy(_) => "BUSY",
        HostError::Corrupt(_) => "CORRUPT",
        HostError::Io(_) => "IO",
        _ => "OTHER",
    };
    failure(code, &error.to_string(), "See the message.")
}

fn text<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn list(args: &Value, key: &str) -> Vec<String> {
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

/// A document for the space `space`, readable by `args.access` (default `["space"]`).
fn document(space: &str, args: &Value) -> DocumentWrite {
    let id = text(args, "id");
    let access = list(args, "access");
    let access: Vec<&str> = if access.is_empty() {
        vec!["space"]
    } else {
        access.iter().map(String::as_str).collect()
    };
    let mut doc = samples::document(id, &access, text(args, "text"), "t");
    doc.space = space.to_owned();
    doc.envelope.space = space.to_owned();
    if let Some(origin) = args.get("origin").and_then(Value::as_str) {
        doc.envelope.origin = serde_json::from_value(json!(origin)).unwrap();
    }
    if args.get("no_sensitivity").is_some() {
        doc.envelope.sensitivity = None;
    }
    // What a plugin might forge: the host overwrites it.
    doc.envelope.principal = Some("human:forged".to_owned());
    doc.envelope.plugin = Some("forged".to_owned());
    doc.envelope.trace_id = Some("forged".to_owned());
    doc
}

fn read(cx: &Cx, space: &str, op: &str, args: &Value) -> Outcome {
    let result: Result<Value, HostError> = match op {
        "doc-get" => cx
            .doc_get(space, text(args, "id"))
            .map(|doc| json!(doc.map(|d| d.write.id))),
        "reader-tokens" => cx.reader_tokens(space).map(|tokens| json!(tokens)),
        "doc-envelope" => cx
            .doc_get(space, text(args, "id"))
            .map(|doc| json!(doc.map(|d| serde_json::to_value(&d.write.envelope).unwrap()))),
        "doc-list" => cx
            .doc_list(space, &ListQuery::all(500))
            .map(|page| json!(page.items.iter().map(|d| d.id.clone()).collect::<Vec<_>>())),
        "doc-changes" => cx
            .doc_changes(space, 0, 1000, None)
            .map(|changes| json!(changes.iter().map(|c| c.target.clone()).collect::<Vec<_>>())),
        "record-get" => cx
            .record_get(space, text(args, "kind"), text(args, "id"))
            .map(|record| json!(record.map(|r| r.body))),
        "record-list" => cx
            .record_list(space, text(args, "kind"), None, 100)
            .map(|page| json!(page.items.iter().map(|r| r.id.clone()).collect::<Vec<_>>())),
        "index-search" => cx
            .index_search(
                space,
                &IndexQuery {
                    text: text(args, "text").to_owned(),
                    filters: IndexFilters::default(),
                    limit: 50,
                },
            )
            .map(|hits| json!(hits.iter().map(|h| h.doc.clone()).collect::<Vec<_>>())),
        "index-chunks" => cx
            .index_chunks(space, text(args, "id"))
            .map(|chunks| json!(chunks.len())),
        "index-applied" => cx.index_applied(space).map(|rev| json!(rev)),
        "graph-nodes" => cx
            .graph_nodes(space, &list(args, "ids"))
            .map(|nodes| json!(nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>())),
        "graph-neighbors" => cx
            .graph_neighbors(space, text(args, "node"), &[], Direction::Both, 100)
            .map(|edges| {
                json!(
                    edges
                        .iter()
                        .map(|e| format!("{}>{}", e.from, e.to))
                        .collect::<Vec<_>>()
                )
            }),
        "graph-subgraph" => cx.graph_subgraph(space).map(|graph| {
            json!({
                "nodes": graph.nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>(),
                "edges": graph.edges.len(),
            })
        }),
        "derive-changes" => cx
            .derive_changes(space, 0, 1000)
            .map(|changes| json!(changes.iter().map(|c| c.target.clone()).collect::<Vec<_>>())),
        "derive-document" => cx
            .derive_document(space, text(args, "id"))
            .map(|doc| json!(doc.map(|d| d.write.id))),
        "events" => cx.events(Some(space), None, 100).map(|events| {
            json!(
                events["events"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e["seq"].clone())
                    .collect::<Vec<_>>()
            )
        }),
        "content-list" => cx
            .content_list(space, text(args, "collection"), None, 100)
            .map(|page| {
                json!(
                    page.items
                        .iter()
                        .map(|e| e.path.clone())
                        .collect::<Vec<_>>()
                )
            }),
        "content-read" => cx
            .content_read(space, text(args, "collection"), text(args, "path"))
            .map(|bytes| json!(String::from_utf8_lossy(&bytes))),
        other => return failure("UNKNOWN_OP", other, "Use a known op."),
    };
    match result {
        Ok(data) => success(json!({ "result": data })),
        Err(error) => refused(&error),
    }
}

fn write(cx: &Cx, space: &str, op: &str, args: &Value) -> Outcome {
    let result: Result<Value, HostError> = match op {
        "doc-put" => cx
            .doc_put(space, document(space, args), Expect::Any)
            .map(|meta| json!({ "rev": meta.rev })),
        "doc-put-absent" => cx
            .doc_put(space, document(space, args), Expect::Absent)
            .map(|meta| json!({ "rev": meta.rev })),
        "doc-put-two" => (|| {
            let mut revs = Vec::new();
            for id in list(args, "ids") {
                let mut one = args.clone();
                one["id"] = json!(id);
                revs.push(cx.doc_put(space, document(space, &one), Expect::Any)?.rev);
            }
            Ok(json!({ "revs": revs }))
        })(),
        "doc-delete" => {
            let doc = document(space, args);
            cx.doc_delete(space, text(args, "id"), Expect::Any, doc.envelope)
                .map(|rev| json!({ "rev": rev }))
        }
        "record-put" => cx
            .record_put(
                space,
                text(args, "kind"),
                text(args, "id"),
                args.get("body").cloned().unwrap_or(json!({})),
                document(space, args).envelope,
                Expect::Any,
            )
            .map(|meta| json!({ "rev": meta.rev })),
        "index-replace" => (|| {
            let mut writer = cx.index_writer(space)?;
            let id = text(args, "id");
            let access = list(args, "access");
            let access: Vec<&str> = if access.is_empty() {
                vec!["space"]
            } else {
                access.iter().map(String::as_str).collect()
            };
            writer
                .replace(
                    &id.to_owned(),
                    vec![samples::chunk(id, 0, "Title", text(args, "text"), &access)],
                )
                .map_err(|e| HostError::Invalid(e.to_string()))?;
            let applied = args.get("applied").and_then(Value::as_u64).unwrap_or(1);
            writer
                .commit(applied)
                .map_err(|e| HostError::Invalid(e.to_string()))?;
            Ok(json!({ "applied": applied }))
        })(),
        "index-writer" => cx.index_writer(space).map(|mut writer| {
            writer.abort();
            json!("held")
        }),
        "graph-docs" => (|| {
            let mut batch = GraphBatch::default();
            for id in list(args, "ids") {
                let doc_node = format!("doc:{id}");
                batch.entries.push((
                    id.clone(),
                    Some(DocGraph {
                        nodes: vec![
                            Node {
                                id: doc_node.clone(),
                                kind: "document".into(),
                                label: id.clone(),
                            },
                            Node {
                                id: "tag:shared".into(),
                                kind: "tag".into(),
                                label: "shared".into(),
                            },
                        ],
                        edges: vec![Edge {
                            from: doc_node,
                            to: "tag:shared".into(),
                            kind: "tagged".into(),
                            weight: 1,
                        }],
                    }),
                ));
            }
            cx.graph_apply(
                space,
                batch,
                args.get("applied").and_then(Value::as_u64).unwrap_or(0),
            )?;
            Ok(json!("applied"))
        })(),
        "graph-apply" => cx
            .graph_apply(
                space,
                GraphBatch::default(),
                args.get("applied").and_then(Value::as_u64).unwrap_or(0),
            )
            .map(|()| json!("applied")),
        other => return read(cx, space, other, args),
    };
    match result {
        Ok(data) => success(json!({ "result": data })),
        Err(error) => refused(&error),
    }
}

fn files(cx: &Cx, space: &str, op: &str, args: &Value) -> Outcome {
    match op {
        "content-replace" => match cx.content_replace(
            space,
            text(args, "collection"),
            text(args, "path"),
            text(args, "text").as_bytes(),
            match args.get("expect").and_then(Value::as_str) {
                None => Expect::Any,
                Some("absent") => Expect::Absent,
                Some(hash) => {
                    Expect::Hash(umbel_sdk::umbel_store::ContentHash::parse(hash).unwrap())
                }
            },
        ) {
            Ok(hash) => success(json!({ "result": hash.to_string() })),
            Err(error) => refused(&error),
        },
        other => read(cx, space, other, args),
    }
}

impl Plugin for StoreProbe {
    fn manifest(&self) -> &'static str {
        self.manifest
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let op = input.get("op").and_then(Value::as_str).unwrap_or_default();
        let args = input.get("args").cloned().unwrap_or(json!({}));
        let space = input
            .get("space")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| cx.call().spaces.first().cloned())
            .unwrap_or_default();
        match name {
            "sp-read" => {
                if op == "spaces" {
                    return success(json!({ "result": cx.call().spaces }));
                }
                if op == "in-space" {
                    // The bound-space form, for a space of the call or not.
                    return match cx.in_space(text(&args, "space")) {
                        Ok(bound) => match bound.doc_list(&ListQuery::all(500)) {
                            Ok(page) => success(
                                json!({ "result": page.items.iter().map(|d| d.id.clone()).collect::<Vec<_>>() }),
                            ),
                            Err(error) => refused(&error),
                        },
                        Err(error) => refused(&error),
                    };
                }
                read(cx, &space, op, &args)
            }
            "sp-write" | "sp-approve" => {
                let outcome = write(cx, &space, op, &args);
                // What the command says about who may read its event.
                match args.get("event_access") {
                    Some(access) => outcome.with_metadata(
                        "dev.umbel/provenance",
                        json!({
                            "origin": "document-derived",
                            "access": access,
                            "sensitivity": "restricted",
                        }),
                    ),
                    None => outcome,
                }
            }
            "sp-files" => files(cx, &space, op, &args),
            "sp-eval" => match cx.as_reader(text(&args, "principal")) {
                Ok(reader) => {
                    let result = match op {
                        "doc-list" => reader.doc_list(&space, &ListQuery::all(500)).map(|p| {
                            json!(p.items.iter().map(|d| d.id.clone()).collect::<Vec<_>>())
                        }),
                        "index-search" => reader
                            .index_search(
                                &space,
                                &IndexQuery {
                                    text: text(&args, "text").to_owned(),
                                    filters: IndexFilters::default(),
                                    limit: 50,
                                },
                            )
                            .map(|hits| json!(hits.iter().map(|h| h.doc.clone()).collect::<Vec<_>>())),
                        _ => Err(HostError::Invalid(format!("unknown op {op}"))),
                    };
                    match result {
                        Ok(data) => success(json!({ "result": data })),
                        Err(error) => refused(&error),
                    }
                }
                Err(error) => refused(&error),
            },
            "sp-forge" => success(json!({}))
                .with_metadata("dev.umbel/changes", json!({"fromRev": 1, "toRev": 99, "count": 99}))
                .with_metadata("dev.umbel/trust", json!("trusted"))
                .with_metadata("dev.umbel/index", json!({"main": {"applied": 1, "head": 2, "schema": 1}, "other": {"applied": 1, "head": 2, "schema": 1}}))
                .with_metadata("dev.umbel/replay", json!("replayable"))
                .with_metadata("dev.umbel/event-version", json!(0))
                .with_metadata("dev.umbel/mutation", json!(false)),
            other => failure("NOT_FOUND", other, "Call a probe command."),
        }
    }
}

/// A workspace configuration (version 3): spaces `main` and `beta` with the collection `notes`
/// in each, the group `platform`, and one `sp` instance with `instance` appended to its table.
pub fn config(spaces_extra: &str, access: &str, instance: &str) -> String {
    format!(
        r#"config_version = 3
default_space = "main"

[spaces.main]
{spaces_extra}
[spaces.main.collections.notes]
root = "spaces/main/notes"

[spaces.beta]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

{access}

[plugins]
enabled = ["sp"]

[plugins.sp]
source = "compiled:sp"
{instance}
"#
    )
}

/// The allow lists of the probe: every write grant, in `main` and `beta`.
pub const ALLOW_ALL: &str = r#"
[plugins.sp.grants.content_write]
allow = ["main/*", "beta/*"]
[plugins.sp.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.sp.grants.records_write]
allow = ["main", "beta"]
[plugins.sp.grants.index_write]
allow = ["main", "beta"]
[plugins.sp.grants.graph_write]
allow = ["main", "beta"]
"#;

/// The allow lists of an instance enabled for `main` only.
pub const ALLOW_MAIN: &str = r#"
[plugins.sp.grants.content_write]
allow = ["main/*"]
[plugins.sp.grants.documents_write]
allow = ["main/*"]
[plugins.sp.grants.records_write]
allow = ["main"]
[plugins.sp.grants.index_write]
allow = ["main"]
[plugins.sp.grants.graph_write]
allow = ["main"]
"#;
