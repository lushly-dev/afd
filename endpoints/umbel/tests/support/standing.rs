//! A compiled plugin whose commands decide standing (records host specification, section 6), for
//! `records_standing.rs`, `records_person_page.rs` and `records_own_source.rs`: a garden's notes,
//! a standing kind, and the documents they cite.
//!
//! It is a raw `CompiledPlugin`, so a handler can ask the host for its services every way a
//! plugin can: as the command it is, with no command (`Services::call`), as another command, or
//! as itself with another input. Only the first may carry the person gate's proof. Every text is
//! invented and about gardening.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use afd::{CommandContext, CommandError, CommandResult};
use serde_json::{Value, json};
use umbel::plugins::{CallServices, HostServices, ServiceError, Services};
use umbel_sdk::umbel_store::lane::{
    Decision, Evidence, FindOrder, FindPage, LaneRecord, RecordFind, Standing,
};
use umbel_sdk::umbel_store::{ContentHash, Envelope, Expect};
use umbel_store::conformance::samples;

use super::plugins::{Raw, closure};

const OPS: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, op = { type = \"string\" }, args = { type = \"object\" } }, required = [\"op\"], additionalProperties = false }";
const DECIDED: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, op = { type = \"string\" }, id = { type = \"string\" }, via = { type = \"string\" } }, required = [\"op\", \"id\"], additionalProperties = false }";

/// The plugin's manifest: `note`, a standing kind with a statement and a key; `bed`, a kind
/// without standing; `notes-write` and `notes-read`, which no person decides; `notes-review`,
/// which a person confirms at a terminal; `notes-verify`, which a person decides on the person
/// page over MCP; and a pipeline whose one step is `notes-review`.
pub fn manifest() -> String {
    format!(
        r#"manifest_version = 6
protocol = 1

[plugin]
id = "notes"
title = "Garden notes"
version = "0.1.0"
description = "Short notes about a garden, and who stands behind them."
kind = "compiled"
domains = ["notes"]

[[grants]]
name = "records"
reason = "Reads the notes."

[[grants]]
name = "records_write"
reason = "Writes the notes and what a person decides about them."

[[grants]]
name = "documents"
reason = "Reads the documents a note cites."

[[grants]]
name = "documents_write"
reason = "Stores the documents it syncs."

[[grants]]
name = "content_write"
required = false
reason = "Writes a page a proposal was approved into."

[[records]]
kind = "note"
standing = true
text = ["/statement"]
keys = ["/bed"]
match = "/statement"

[[records]]
kind = "bed"
text = ["/name"]

[[commands]]
name = "notes-write"
description = "Write a record or a document."
effects = ["store-write"]
input_schema = {OPS}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "notes-read"
description = "Read records and documents."
effects = ["inspect"]
input_schema = {OPS}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "notes-review"
description = "Decide standing, confirmed by a person at a terminal."
effects = ["store-write"]
input_schema = {OPS}
confirm_prompt = "Decide this as your own?"
confirm = "require-human"
expose = {{ mcp = false, agent = false, cli = true }}
journal = {{ mode = "digest", keep = ["space", "op"] }}

[[commands]]
name = "notes-verify"
description = "Decide standing, decided by a person on the person page."
effects = ["store-write"]
input_schema = {DECIDED}
confirm_prompt = "Decide this as your own?"
confirm = "require-human"
person = {{ cli = "terminal", mcp = "verified" }}
expose = {{ mcp = true, agent = false, cli = true }}
confirm_preview = "notes-preview"
journal = {{ mode = "digest", keep = ["space", "op", "id", "via"] }}

[[commands]]
name = "notes-preview"
description = "Show what is about to be decided."
effects = ["inspect"]
input_schema = {DECIDED}
expose = {{ mcp = false, agent = false, cli = true }}
journal = {{ mode = "digest", keep = ["space", "op", "id", "via"] }}
returns = {{ type = "object", properties = {{ preview = {{ type = "string" }} }}, required = ["preview"], additionalProperties = false }}

[[pipelines]]
name = "notes-pipe"
description = "Decide standing as a step of a pipeline."
effects = ["store-write"]
input_schema = {OPS}
expose = {{ mcp = false, agent = false, cli = true }}
journal = {{ mode = "digest", keep = ["space", "op"] }}
steps = [ {{ command = "notes-review", input = {{ op = "$input.op", args = "$input.args" }} }} ]
"#
    )
}

/// The plugin `notes`.
pub fn plugin() -> Raw {
    plugin_with(manifest())
}

/// The plugin `notes` with `manifest` in place of [`manifest`]'s.
pub fn plugin_with(manifest: String) -> Raw {
    Raw::new(manifest, |services| {
        Ok([
            "notes-write",
            "notes-read",
            "notes-review",
            "notes-verify",
            "notes-preview",
        ]
        .into_iter()
        .map(|name| {
            let services = services.clone();
            closure(name, move |input, context| {
                handle(&services, name, &input, &context)
            })
        })
        .collect())
    })
}

fn refused(error: &ServiceError) -> CommandResult<Value> {
    let code = match error {
        ServiceError::NotGranted(_) => "NOT_GRANTED",
        ServiceError::NotFound(_) => "NOT_FOUND",
        ServiceError::Invalid(_) => "INVALID",
        ServiceError::TooLarge(_) => "TOO_LARGE",
        ServiceError::Conflict { .. } => "CONFLICT",
        ServiceError::Busy(_) => "BUSY",
        _ => "OTHER",
    };
    afd::failure(CommandError::new(code, error.to_string()).with_suggestion("See the message."))
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

fn standings(args: &Value) -> Vec<Standing> {
    strings(args, "standings")
        .iter()
        .map(|name| serde_json::from_value(json!(name)).unwrap())
        .collect()
}

fn verified_only(args: &Value) -> bool {
    args.get("verifiedOnly").and_then(Value::as_bool) == Some(true)
}

/// The envelope a plugin might send: the whole space may read it, it claims `args.authority`,
/// and it forges what only the host fills.
fn envelope(space: &str, args: &Value) -> Envelope {
    let mut envelope = samples::envelope(&["space"], "forged", "2020-01-01T00:00:00.000Z");
    envelope.space = space.to_owned();
    envelope.principal = Some("human:forged".to_owned());
    if let Some(authority) = args.get("authority").and_then(Value::as_str) {
        envelope.authority = Some(authority.to_owned());
    }
    envelope
}

fn kind(args: &Value) -> &str {
    match text(args, "kind") {
        "" => "note",
        kind => kind,
    }
}

fn page(found: &FindPage) -> Value {
    json!({
        "items": found.items.iter().map(LaneRecord::to_json).collect::<Vec<_>>(),
        "ids": found.items.iter().map(|item| item.record.id.clone()).collect::<Vec<_>>(),
        "total": found.total,
        "admitted": found.admitted,
    })
}

/// The stored content hash of `doc`, as the caller reads it: what a person is shown.
fn shown_hash(cx: &CallServices, space: &str, args: &Value) -> Result<ContentHash, ServiceError> {
    match args.get("hash").and_then(Value::as_str) {
        Some(hash) => {
            ContentHash::parse(hash).map_err(|error| ServiceError::Invalid(error.to_string()))
        }
        None => cx
            .doc_get(space, text(args, "doc"))?
            .map(|document| document.write.content_hash)
            .ok_or_else(|| ServiceError::NotFound("the document is not stored".to_owned())),
    }
}

fn run(cx: &CallServices, space: &str, op: &str, args: &Value) -> Result<Value, ServiceError> {
    let id = text(args, "id");
    match op {
        "put" => cx
            .record_put(
                space,
                kind(args),
                id,
                args.get("body").cloned().unwrap_or(json!({})),
                envelope(space, args),
                Expect::Any,
            )
            .map(|meta| json!({ "rev": meta.rev })),
        "cite" => {
            let evidence = Evidence {
                doc: text(args, "doc").to_owned(),
                doc_hash: shown_hash(cx, space, args)?,
                units: args.get("units").and_then(Value::as_array).map_or_else(
                    || vec![1],
                    |units| {
                        units
                            .iter()
                            .filter_map(Value::as_u64)
                            .map(|unit| u32::try_from(unit).unwrap())
                            .collect()
                    },
                ),
                rule: match text(args, "rule") {
                    "" => "sentences/1".to_owned(),
                    rule => rule.to_owned(),
                },
                speaker: args
                    .get("speaker")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                verbatim: args.get("verbatim").and_then(Value::as_bool) != Some(false),
            };
            cx.record_put_cited(
                space,
                kind(args),
                id,
                args.get("body").cloned().unwrap_or(json!({})),
                envelope(space, args),
                Expect::Any,
                evidence,
            )
            .map(|meta| json!({ "rev": meta.rev }))
        }
        "affirm" | "withdraw" => {
            let decision = if op == "affirm" {
                Decision::Affirm
            } else {
                Decision::Withdraw
            };
            cx.record_decide(space, kind(args), id, decision)
                .map(|label| label.to_json())
        }
        "mark" => {
            let hash = shown_hash(cx, space, args)?;
            cx.doc_own_mark(
                space,
                text(args, "doc"),
                &hash,
                args.get("speaker").and_then(Value::as_str),
            )
            .map(|rev| json!({ "rev": rev }))
        }
        "unmark" => cx
            .doc_own_unmark(space, text(args, "doc"))
            .map(|rev| json!({ "rev": rev })),
        "own" => cx.doc_own(space, text(args, "doc")).map(|own| {
            json!(own.map(|own| json!({
                "basis": own.basis.as_str(),
                "speaker": own.speaker,
                "contentHash": own.content_hash,
                "storedAt": own.stored_at,
                "generatedAt": own.generated_at,
            })))
        }),
        // Store a document as a sync would: `<collection>/<name>` with `text` as its bytes,
        // for the file `<root>/<name>.md`.
        "sync" => {
            let mut write =
                samples::document(text(args, "doc"), &["space"], text(args, "text"), "sync");
            write.space = space.to_owned();
            write.envelope.space = space.to_owned();
            if let Some(access) = args.get("access").and_then(Value::as_str) {
                write = samples::document(text(args, "doc"), &[access], text(args, "text"), "sync");
                write.space = space.to_owned();
                write.envelope.space = space.to_owned();
            }
            // What a plugin might claim of its document's size.
            if let Some(size) = args.get("size").and_then(Value::as_u64) {
                write.size = size;
            }
            cx.doc_put(space, write, Expect::Any)
                .map(|meta| json!({ "rev": meta.rev, "contentHash": meta.content_hash }))
        }
        "forget" => cx
            .doc_delete(space, text(args, "doc"), Expect::Any, envelope(space, args))
            .map(|rev| json!({ "rev": rev })),
        // Write a file as an applied proposal would.
        "replace" => cx
            .content_replace(
                space,
                text(args, "collection"),
                text(args, "path"),
                text(args, "text").as_bytes(),
                Expect::Any,
            )
            .map(|hash| json!({ "contentHash": hash })),
        "read" => cx
            .record_read(space, kind(args), id, &standings(args), verified_only(args))
            .map(|found| json!(found.as_ref().map(LaneRecord::to_json))),
        "find" => cx
            .record_find(
                space,
                &RecordFind {
                    kind: kind(args).to_owned(),
                    keys: Vec::new(),
                    standings: standings(args),
                    verified_only: verified_only(args),
                    text: None,
                    order: FindOrder::Id,
                    after: None,
                    limit: 200,
                    total: true,
                },
            )
            .map(|found| page(&found)),
        "get" => cx
            .record_get(space, kind(args), id)
            .map(|found| json!(found)),
        "list" => cx
            .record_list(space, kind(args), None, 100)
            .map(|found| json!(found.items.iter().map(|r| r.id.clone()).collect::<Vec<_>>())),
        _ => Err(ServiceError::Invalid(format!("unknown op {op}"))),
    }
}

fn handle(
    services: &Services,
    name: &'static str,
    input: &Value,
    context: &CommandContext,
) -> CommandResult<Value> {
    let op = text(input, "op");
    // `notes-verify` and its preview take flat inputs, which a person's decision can keep.
    let flat = matches!(name, "notes-verify" | "notes-preview");
    let args = if flat {
        input.clone()
    } else {
        input.get("args").cloned().unwrap_or(json!({}))
    };
    if name == "notes-preview" {
        return afd::success(json!({
            "preview": format!("{op} {}", text(&args, "id")),
        }));
    }
    // How the handler asks the host for its services: as the command it is; with no command;
    // as another command, one a person decides; or as itself with another input.
    let cx = match text(&args, "via") {
        "nested" => services.call(input, context),
        "other" => {
            let other = if name == "notes-verify" {
                "notes-review"
            } else {
                "notes-verify"
            };
            services.call_command(other, input, context)
        }
        "other-input" => {
            let mut another = input.clone();
            another["id"] = json!("another");
            services.call_command(name, &another, context)
        }
        _ => services.call_command(name, input, context),
    };
    let space = cx.space().as_str().to_owned();
    // A flat `mark` names its document by `id`.
    let args = if flat && matches!(op, "mark" | "unmark") {
        json!({ "doc": text(&args, "id") })
    } else {
        args
    };
    match run(&cx, &space, op, &args) {
        Ok(data) => afd::success(json!({ "result": data })),
        Err(error) => refused(&error),
    }
}

/// A workspace configuration (version 6): the space `garden`, with `garden` appended to its
/// table, whose collection `journal` is the person's own and whose `talks` and `wiki` are not;
/// the space `orchard`, with `orchard` appended to its table; and one `notes` instance that
/// writes records and documents in both, with `rest` appended to the file.
pub fn config(garden: &str, orchard: &str, rest: &str) -> String {
    format!(
        r#"config_version = 6
default_space = "garden"

[spaces.garden]
{garden}

[spaces.garden.collections.journal]
root = "content/journal"
own = true

[spaces.garden.collections.talks]
root = "content/talks"

[spaces.garden.collections.wiki]
root = "content/wiki"

[spaces.orchard]
{orchard}

[spaces.orchard.collections.rows]
root = "content/rows"

[plugins]
enabled = ["notes"]

[plugins.notes]
source = "compiled:notes"

[plugins.notes.grants.records_write]
allow = ["garden", "orchard"]
default_access = "space"

[plugins.notes.grants.documents_write]
allow = ["garden/*", "orchard/*"]
{rest}
"#
    )
}

/// Write the file `<collection root>/<name>.md` of the workspace at `dir`.
pub fn file(dir: &std::path::Path, collection: &str, name: &str, text: &str) {
    let root = dir.join("content").join(collection);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(format!("{name}.md")), text).unwrap();
}

/// A workspace with `config_text` and the four collection roots.
pub fn workspace(config_text: &str) -> tempfile::TempDir {
    let dir = super::workspace(config_text);
    for collection in ["journal", "talks", "wiki", "rows"] {
        std::fs::create_dir_all(dir.path().join("content").join(collection)).unwrap();
    }
    dir
}
