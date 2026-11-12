//! A compiled plugin that declares record kinds (records host specification, section 2), for
//! `records_put.rs` and `records_find.rs`: a garden's notes, with standing, and its beds,
//! without. One generic `op` per command keeps the manifest small. Every text is invented and
//! about gardening.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use umbel_sdk::umbel_store::lane::{
    FindOrder, FindPage, KeyFilter, LaneRecord, Pointer, RecordFind, Standing, TextQuery,
};
use umbel_sdk::umbel_store::{Envelope, Expect};
use umbel_sdk::{Cx, HostError, Outcome, Plugin, failure, success};
use umbel_store::conformance::samples;

use super::plugins::leak;

const INPUT: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, op = { type = \"string\" }, args = { type = \"object\" } }, required = [\"op\"], additionalProperties = false }";

/// The plugin's manifest: `note` with standing, a statement matched and two keys; `bed` without
/// standing, two text pointers and one key; and `log`, a kind it writes and does not declare.
pub fn manifest() -> String {
    format!(
        r#"manifest_version = 6
protocol = 1

[plugin]
id = "notes"
title = "Garden notes"
version = "0.1.0"
description = "Short notes about a garden."
kind = "compiled"
domains = ["notes"]

[[grants]]
name = "records"
reason = "Reads the notes."

[[grants]]
name = "records_write"
reason = "Writes the notes."

[[records]]
kind = "note"
standing = true
text = ["/statement"]
keys = ["/bed", "/tags"]
match = "/statement"

[[records]]
kind = "bed"
text = ["/name", "/about"]
keys = ["/sun"]

[[commands]]
name = "notes-write"
description = "Write a record."
effects = ["store-write"]
input_schema = {INPUT}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "notes-plain"
description = "Write a record, journaled as it is."
effects = ["store-write"]
input_schema = {INPUT}
journal = {{ mode = "plain" }}

[[commands]]
name = "notes-read"
description = "Read records."
effects = ["inspect"]
input_schema = {INPUT}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "notes-eval"
description = "Read as another principal, from the CLI."
effects = ["inspect"]
input_schema = {INPUT}
journal = {{ mode = "digest", keep = ["space", "op"] }}
expose = {{ mcp = false, agent = false, cli = true }}
"#
    )
}

pub struct Notes {
    manifest: &'static str,
}

impl Notes {
    pub fn new() -> Self {
        Self::with_manifest(manifest())
    }

    pub fn with_manifest(text: String) -> Self {
        Self {
            manifest: leak(text),
        }
    }
}

/// A failure that names the error's variant and carries the host's message.
fn refused(error: &HostError) -> Outcome {
    let code = match error {
        HostError::NotGranted(_) => "NOT_GRANTED",
        HostError::NotFound(_) => "NOT_FOUND",
        HostError::Invalid(_) => "INVALID",
        HostError::TooLarge(_) => "TOO_LARGE",
        HostError::Conflict { .. } => "CONFLICT",
        HostError::Busy(_) => "BUSY",
        _ => "OTHER",
    };
    failure(code, &error.to_string(), "See the message.")
}

fn text<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn strings(args: &Value, key: &str) -> Vec<String> {
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

/// The envelope a plugin might send: readable by `args.access` (default the whole space),
/// claiming `args.authority`, and forging what only the host fills.
fn envelope(space: &str, args: &Value) -> Envelope {
    let access = strings(args, "access");
    let access: Vec<&str> = if access.is_empty() {
        vec!["space"]
    } else {
        access.iter().map(String::as_str).collect()
    };
    let mut envelope = samples::envelope(&access, "forged", "2020-01-01T00:00:00.000Z");
    envelope.space = space.to_owned();
    envelope.principal = Some("human:forged".to_owned());
    envelope.plugin = Some("forged".to_owned());
    if let Some(version) = args.get("version").and_then(Value::as_u64) {
        envelope.version = u32::try_from(version).unwrap();
    }
    if let Some(authority) = args.get("authority").and_then(Value::as_str) {
        envelope.authority = Some(authority.to_owned());
    }
    envelope
}

fn standings(args: &Value) -> Vec<Standing> {
    strings(args, "standings")
        .iter()
        .map(|name| serde_json::from_value(json!(name)).unwrap())
        .collect()
}

/// A find from its JSON: `kind`, `keys` (`[{ key, any }]`), `text` (`{ query, fields }`),
/// `order`, `after`, `limit`, `total`, `standings` and `verifiedOnly`.
fn find_of(args: &Value) -> Result<RecordFind, HostError> {
    let pointer = |text: &str| {
        Pointer::parse(text).map_err(|error| HostError::Invalid(format!("the fixture: {error}")))
    };
    let mut keys = Vec::new();
    for filter in args
        .get("keys")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        keys.push(KeyFilter {
            key: pointer(text(filter, "key"))?,
            any: strings(filter, "any"),
        });
    }
    let text_query = match args.get("text") {
        Some(query) if query.is_object() => Some(TextQuery {
            query: text(query, "query").to_owned(),
            fields: strings(query, "fields")
                .iter()
                .map(|field| pointer(field))
                .collect::<Result<_, _>>()?,
        }),
        _ => None,
    };
    Ok(RecordFind {
        kind: text(args, "kind").to_owned(),
        keys,
        standings: standings(args),
        verified_only: args.get("verifiedOnly").and_then(Value::as_bool) == Some(true),
        text: text_query,
        order: match text(args, "order") {
            "recent" => FindOrder::Recent,
            "rank" => FindOrder::Rank,
            _ => FindOrder::Id,
        },
        after: args.get("after").and_then(Value::as_str).map(str::to_owned),
        limit: args
            .get("limit")
            .and_then(Value::as_u64)
            .map_or(50, |limit| u32::try_from(limit).unwrap()),
        total: args.get("total").and_then(Value::as_bool) != Some(false),
    })
}

fn page(found: &FindPage) -> Value {
    json!({
        "items": found.items.iter().map(LaneRecord::to_json).collect::<Vec<_>>(),
        "ids": found.items.iter().map(|item| item.record.id.clone()).collect::<Vec<_>>(),
        "next": found.next,
        "total": found.total,
        "admitted": found.admitted,
        "cut": found.cut,
    })
}

fn write(cx: &Cx, space: &str, op: &str, args: &Value) -> Result<Value, HostError> {
    match op {
        "put" => {
            let expect = match text(args, "expect") {
                "absent" => Expect::Absent,
                _ => Expect::Any,
            };
            cx.record_put(
                space,
                text(args, "kind"),
                text(args, "id"),
                args.get("body").cloned().unwrap_or(json!({})),
                envelope(space, args),
                expect,
            )
            .map(|meta| json!({ "rev": meta.rev, "contentHash": meta.content_hash }))
        }
        _ => Err(HostError::Invalid(format!("unknown op {op}"))),
    }
}

fn read(cx: &Cx, space: &str, op: &str, args: &Value) -> Result<Value, HostError> {
    match op {
        "read" => cx
            .record_read(
                space,
                text(args, "kind"),
                text(args, "id"),
                &standings(args),
                args.get("verifiedOnly").and_then(Value::as_bool) == Some(true),
            )
            .map(|found| json!(found.as_ref().map(LaneRecord::to_json))),
        "find" => cx
            .record_find(space, &find_of(args)?)
            .map(|found| page(&found)),
        "get" => cx
            .record_get(space, text(args, "kind"), text(args, "id"))
            .map(|found| json!(found)),
        "list" => cx
            .record_list(space, text(args, "kind"), None, 100)
            .map(|found| json!(found.items.iter().map(|r| r.id.clone()).collect::<Vec<_>>())),
        _ => Err(HostError::Invalid(format!("unknown op {op}"))),
    }
}

impl Plugin for Notes {
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
        let result = match name {
            "notes-write" | "notes-plain" => write(cx, &space, op, &args),
            "notes-read" => read(cx, &space, op, &args),
            "notes-eval" => cx
                .as_reader(text(&args, "principal"))
                .and_then(|reader| match op {
                    "read" => reader
                        .record_read(&space, text(&args, "kind"), text(&args, "id"), &[], false)
                        .map(|found| json!(found.as_ref().map(LaneRecord::to_json))),
                    "find" => reader
                        .record_find(&space, &find_of(&args)?)
                        .map(|found| page(&found)),
                    _ => Err(HostError::Invalid(format!("unknown op {op}"))),
                }),
            other => return failure("NOT_FOUND", other, "Call a notes command."),
        };
        match result {
            // What a command says about its event: text-derived fields a lane writer's event
            // must not keep.
            Ok(data) if name != "notes-read" && name != "notes-eval" => {
                success(json!({ "result": data })).with_metadata(
                    "dev.umbel/provenance",
                    json!({
                        "origin": "user-stated",
                        "access": ["space"],
                        "sensitivity": "internal",
                        "sources": [{ "uri": "note:canary-source", "title": "canary-title" }],
                        "constraints": ["canary-constraint"],
                        "contentHash": "sha256:canary",
                    }),
                )
            }
            Ok(data) => success(json!({ "result": data })),
            Err(error) => refused(&error),
        }
    }
}

/// A workspace configuration (version 6): spaces `garden` and `orchard`, the group `growers`
/// holding `human:bo`, and one `notes` instance allowed to write records in both spaces, with
/// `grant` appended to its `records_write` table and `rest` to the file.
pub fn config(grant: &str, rest: &str) -> String {
    format!(
        r#"config_version = 6
default_space = "garden"

[spaces.garden]

[spaces.orchard]

[access.groups.growers]
members = ["human:bo"]

[plugins]
enabled = ["notes"]

[plugins.notes]
source = "compiled:notes"

[plugins.notes.grants.records_write]
allow = ["garden", "orchard"]
{grant}
{rest}
"#
    )
}
