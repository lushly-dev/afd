//! A workspace with the context plugin and its grants, and stores written through the
//! `umbel-store` API with fixed ids and a fixed clock (section 9.6), into the files the host then
//! opens. No other plugin is linked: the bundle reads what the stores hold (D78).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};
use umbel_store::conformance::samples;
use umbel_store::memory::{Confirm, DAY_MS, format_instant, memory_content_hash};
use umbel_store::{
    AccessSet, Authority, ByAt, DocumentStore, DocumentWrite, Expect, Flag, IndexChunk,
    MemoryClass, MemoryFlag, MemoryStore, MemoryWrite, Origin, ReaderFilter, SearchIndex, Status,
    Tier,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions, TantivyIndex};

/// The suite's base instant, 2026-11-02T10:00:00.000Z: records are valid from it.
pub const AT: i64 = samples::MEMORY_AT;
/// The host's clock, an hour later.
pub const NOW: i64 = AT + 3_600_000;

/// Spaces `main` and `beta`, the context plugin with its grants, and `extra` appended (an
/// instance `config` table, a `deny` list).
pub fn config(extra: &str) -> String {
    format!(
        r#"config_version = 4
default_space = "main"

[principal]
local_id = "ada"

[spaces.main]
[spaces.beta]

[plugins]
enabled = ["context"]

[plugins.context]
source = "compiled:context"
{extra}
"#
    )
}

pub struct Fx {
    pub dir: TempDir,
    pub host: Host,
}

pub fn build(dir: &Path) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_context::plugin())))
        .with_clock(fixed_clock(NOW))
        .seal()
        .unwrap()
}

/// A person through the library.
pub fn human(id: &str) -> Actor {
    Actor::new(ActorKind::Human).with_id(id)
}

/// An agent acting for `person`.
pub fn agent_for(id: &str, person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(person)
}

pub fn json_of(result: CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

/// `data` of a successful result.
pub fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

/// The warning with this code, if the result has one.
pub fn warning<'a>(result: &'a Value, code: &str) -> Option<&'a Value> {
    result["warnings"]
        .as_array()?
        .iter()
        .find(|warning| warning["code"] == code)
}

/// The ids of a section's items, in order; empty when the section is not in the bundle.
pub fn ids(result: &Value, section: &str) -> Vec<String> {
    data(result)["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == section)
        .map(|s| {
            s["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// The section names of a bundle, in order.
pub fn section_names(result: &Value) -> Vec<String> {
    data(result)["sections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap().to_owned())
        .collect()
}

/// The omissions with this section and reason.
pub fn omitted<'a>(result: &'a Value, section: &str, reason: &str) -> Vec<&'a Value> {
    data(result)["omissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["section"] == section && o["reason"] == reason)
        .collect()
}

/// The count of the one omission with this section and reason, 0 when there is none.
pub fn count(result: &Value, section: &str, reason: &str) -> u64 {
    omitted(result, section, reason)
        .first()
        .map_or(0, |o| o["count"].as_u64().unwrap())
}

/// The `n`th memory id: `mem-` and `n` as 24 hex digits.
pub fn mem(n: u64) -> String {
    samples::memory_id(n)
}

/// A memory entry `n` of `owner` in `space`: `class`, `authority`, private to its owner, valid
/// from [`AT`], with `text` searchable. Edit fields, then pass it to [`Fx::remember`].
pub fn entry(
    n: u64,
    space: &str,
    owner: &str,
    class: MemoryClass,
    authority: Authority,
    subject: &str,
    text: &str,
) -> MemoryWrite {
    let private = format!("principal:{owner}");
    let mut entry = samples::memory_entry(n, owner, &[private.as_str()], subject, text);
    entry.class = class;
    entry.scope.space = space.to_owned();
    entry.envelope.space = space.to_owned();
    entry.envelope.origin = if authority == Authority::Person {
        Origin::UserStated
    } else {
        Origin::AgentInferred
    };
    samples::set_authority(&mut entry, authority);
    if class == MemoryClass::Episodic {
        entry.expires_at = AT + 30 * DAY_MS;
    }
    samples::agree(&mut entry);
    entry
}

/// Set an entry's project.
pub fn in_project(mut entry: MemoryWrite, project: &str) -> MemoryWrite {
    entry.scope.project = Some(project.to_owned());
    entry
}

/// Share an entry with the whole space.
pub fn shared(mut entry: MemoryWrite) -> MemoryWrite {
    entry.access = AccessSet::new(["space"]).unwrap();
    samples::agree(&mut entry);
    entry
}

/// Mark an entry flagged by the scan.
pub fn flagged(mut entry: MemoryWrite) -> MemoryWrite {
    entry.flags = vec![MemoryFlag::InstructionLike];
    entry
}

/// A document `<collection>/<path>` in `space` readable by the whole space, `stable` and
/// verified by a human unless edited, with its chunks from `body`'s paragraphs.
pub fn doc(space: &str, id: &str, title: &str, body: &str) -> (DocumentWrite, Vec<IndexChunk>) {
    let mut write = samples::document(id, &["space"], body, "seed");
    write.space = space.to_owned();
    write.envelope.space = space.to_owned();
    write.title = title.to_owned();
    write.verification.tier = Tier::Human;
    write.envelope.generated = Some(ByAt {
        by: "human:ada".to_owned(),
        at: "2026-11-01T09:00:00Z".to_owned(),
    });
    let chunks = chunks_of(&write, body);
    (write, chunks)
}

/// The chunks of `body`: one per blank-line paragraph, with its lines, the document's fields.
pub fn chunks_of(write: &DocumentWrite, body: &str) -> Vec<IndexChunk> {
    let mut out = Vec::new();
    let mut line = 1u32;
    for (ordinal, paragraph) in body.split("\n\n").enumerate() {
        let lines = u32::try_from(paragraph.lines().count().max(1)).unwrap();
        let mut chunk = samples::chunk(
            &write.id,
            ordinal as u32,
            &write.title,
            paragraph,
            &["space"],
        );
        chunk.line_start = line;
        chunk.line_end = line + lines - 1;
        chunk.verified = serde_json::to_value(write.verification.tier)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        chunk.status = serde_json::to_value(write.status)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        chunk.access = write.access.clone();
        chunk.stale_after = write.stale_after.clone();
        out.push(chunk);
        line += lines + 1;
    }
    out
}

/// Edit a document, keeping its chunks in step with it.
pub fn with(
    (mut write, _): (DocumentWrite, Vec<IndexChunk>),
    edit: impl FnOnce(&mut DocumentWrite),
) -> (DocumentWrite, Vec<IndexChunk>) {
    edit(&mut write);
    let body = String::from_utf8(write.bytes.clone()).unwrap();
    let chunks = chunks_of(&write, &body);
    (write, chunks)
}

pub fn status(status: Status) -> impl FnOnce(&mut DocumentWrite) {
    move |write| write.status = status
}

pub fn scan_flag(flag: Flag) -> impl FnOnce(&mut DocumentWrite) {
    move |write| write.flags = vec![flag]
}

impl Fx {
    pub fn new() -> Self {
        Self::with(&config(""))
    }

    pub fn with(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        let host = build(dir.path());
        Self { dir, host }
    }

    /// Reopen the host, so it opens the stores the test wrote anew.
    pub fn reopen(&mut self) {
        self.host = build(self.dir.path());
    }

    /// Replace the configuration and reopen.
    pub fn reconfigure(&mut self, config: &str) {
        std::fs::write(self.dir.path().join("umbel.toml"), config).unwrap();
        self.reopen();
    }

    pub fn space_dir(&self, space: &str) -> PathBuf {
        self.dir.path().join("state/spaces").join(space)
    }

    /// Put `docs` into `space`'s document store and index them, applied at the store's head, then
    /// reopen the host.
    pub fn index(&mut self, space: &str, docs: Vec<(DocumentWrite, Vec<IndexChunk>)>) {
        {
            let dir = self.space_dir(space);
            let store = SqliteStore::open(&dir, space, StoreOptions::default()).unwrap();
            let index = TantivyIndex::open(&dir, space, StoreOptions::default()).unwrap();
            let mut writer = index.writer().unwrap();
            for (write, chunks) in docs {
                let id = write.id.clone();
                store.put_document(write, Expect::Any).unwrap();
                writer.replace(&id, chunks).unwrap();
            }
            writer.commit(store.head().unwrap()).unwrap();
        }
        self.reopen();
    }

    /// Put `docs` into the document store only, so the index is behind, then reopen.
    pub fn put_only(&mut self, space: &str, docs: Vec<DocumentWrite>) {
        {
            let store =
                SqliteStore::open(&self.space_dir(space), space, StoreOptions::default()).unwrap();
            for write in docs {
                store.put_document(write, Expect::Any).unwrap();
            }
        }
        self.reopen();
    }

    fn memory_store(&self, space: &str) -> SqliteMemoryStore {
        SqliteMemoryStore::open(&self.space_dir(space), space, StoreOptions::default())
            .unwrap()
            .with_machine_backup_exclusion(false)
    }

    /// Write `entries` to `space`'s memory store at `at`, one batch each (a batch has one owner
    /// and one authority), in order, then reopen.
    pub fn remember_at(&mut self, space: &str, at: i64, entries: Vec<MemoryWrite>) {
        let store = self.memory_store(space);
        for entry in entries {
            store.write(samples::memory_batch(at, vec![entry])).unwrap();
        }
        drop(store);
        self.reopen();
    }

    pub fn remember(&mut self, space: &str, entries: Vec<MemoryWrite>) {
        self.remember_at(space, AT, entries);
    }

    /// A person confirming their own record `id`, an hour after [`AT`] less a minute.
    pub fn confirm(&mut self, space: &str, id: &str, subject: &str, text: &str, by: &str) {
        let reader = ReaderFilter::tokens(["space".to_owned(), format!("principal:{by}")]).unwrap();
        let hash = memory_content_hash(subject, text);
        self.memory_store(space)
            .confirm(
                Confirm {
                    id: id.to_owned(),
                    at: NOW - 60_000,
                    by: by.to_owned(),
                    equivalents: Vec::new(),
                    content_hash: hash.as_str().to_owned(),
                    trace_id: None,
                    assurance: Some(umbel_store::Assurance::terminal()),
                },
                &reader,
            )
            .unwrap();
        self.reopen();
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    /// `context-bundle` as `actor` over MCP.
    pub async fn bundle(&self, actor: Actor, input: Value) -> Value {
        let context = self
            .host
            .context(actor)
            .with_interface(CommandInterface::Mcp);
        json_of(
            self.host
                .registry()
                .execute("context-bundle", input, Some(context))
                .await,
        )
    }

    /// `context-bundle` as `actor` over MCP with an output budget of `ask` bytes.
    pub async fn bundle_with_budget(&self, actor: Actor, input: Value, ask: u64) -> Value {
        let context = self
            .host
            .context(actor)
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(ask);
        json_of(
            self.host
                .registry()
                .execute("context-bundle", input, Some(context))
                .await,
        )
    }

    /// As ada, the workspace's person.
    pub async fn ada(&self, input: Value) -> Value {
        self.bundle(human("ada"), input).await
    }
}

/// The instant of [`AT`] in the bundle's spelling.
pub fn at_text() -> String {
    format_instant(AT)
}

/// The bytes AFD measured, and its limit.
pub fn measured(result: &Value) -> (u64, u64) {
    let budget = &result["metadata"]["dev.afd/outputBudget"];
    assert!(budget.is_object(), "no output budget in {result}");
    (
        budget["usedBytes"].as_u64().unwrap(),
        budget["limitBytes"].as_u64().unwrap(),
    )
}

struct Siblings;

impl jsonschema::Retrieve for Siblings {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Err(format!("the bundle schema refers to nothing else: {}", uri.as_str()).into())
    }
}

/// A validator of `context-bundle.v1.json`.
pub fn bundle_validator() -> jsonschema::Validator {
    let schema: Value =
        serde_json::from_str(include_str!("../../../../schemas/context-bundle.v1.json")).unwrap();
    jsonschema::options()
        .with_retriever(Siblings)
        .build(&schema)
        .unwrap()
}

/// Assert `data` validates against the bundle schema.
pub fn valid(result: &Value) {
    let validator = bundle_validator();
    let errors: Vec<String> = validator
        .iter_errors(data(result))
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?} in {}", data(result));
}

/// An empty JSON object, for readability.
pub fn none() -> Value {
    json!({})
}
