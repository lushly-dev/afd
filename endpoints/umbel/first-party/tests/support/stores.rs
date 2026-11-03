//! Stores written through the `umbel-store` API with fixed ids and a fixed clock (section 9.6),
//! for the digest across write orders: documents, their chunks and memory records, put into a
//! workspace's files before its host opens them. The index is written from scratch in each
//! workspace, so it is a rebuilt index, as 9.6 asks.

use std::path::Path;

use umbel_store::conformance::samples;
use umbel_store::memory::DAY_MS;
use umbel_store::{
    Authority, ByAt, DocumentStore, DocumentWrite, Expect, IndexChunk, MemoryClass, MemoryStore,
    MemoryWrite, Origin, SearchIndex, Tier,
};
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions, TantivyIndex};

use super::{Options, Ws};

/// The store suite's instant, 2026-11-02T10:00:00.000Z; the hosts' clock is an hour later.
pub const AT: i64 = samples::MEMORY_AT;

fn document(n: usize) -> (DocumentWrite, Vec<IndexChunk>) {
    let id = format!("handbook/d{n}");
    let body = format!(
        "detq rollback through the canary flag {}\n\nsecond detq part {n}",
        "word ".repeat(n)
    );
    let mut write = samples::document(&id, &["space"], &body, "seed");
    write.space = "alpha".to_owned();
    write.envelope.space = "alpha".to_owned();
    write.title = format!("Doc {n}");
    write.verification.tier = Tier::Human;
    write.envelope.generated = Some(ByAt {
        by: "human:ada".to_owned(),
        at: "2026-11-01T09:00:00Z".to_owned(),
    });
    let mut chunks = Vec::new();
    let mut line = 1u32;
    for (ordinal, paragraph) in body.split("\n\n").enumerate() {
        let mut chunk = samples::chunk(
            &write.id,
            u32::try_from(ordinal).unwrap(),
            &write.title,
            paragraph,
            &["space"],
        );
        chunk.line_start = line;
        chunk.line_end = line;
        chunk.verified = "human".to_owned();
        chunk.status = serde_json::to_value(write.status)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned();
        chunk.access = write.access.clone();
        chunks.push(chunk);
        line += 2;
    }
    (write, chunks)
}

fn memory(n: u64) -> MemoryWrite {
    let authority = if n.is_multiple_of(2) {
        Authority::Person
    } else {
        Authority::Agent
    };
    let mut entry = samples::memory_entry(
        n,
        "human:ada",
        &["principal:human:ada"],
        &format!("Note {n}"),
        &format!("detq note {n} {}", "more ".repeat(n as usize)),
    );
    entry.class = if n.is_multiple_of(3) {
        MemoryClass::Procedural
    } else {
        MemoryClass::Semantic
    };
    entry.scope.space = "alpha".to_owned();
    entry.envelope.space = "alpha".to_owned();
    entry.envelope.origin = if authority == Authority::Person {
        Origin::UserStated
    } else {
        Origin::AgentInferred
    };
    samples::set_authority(&mut entry, authority);
    entry.expires_at = AT + 180 * DAY_MS;
    samples::agree(&mut entry);
    entry
}

/// A workspace whose `alpha` holds eight documents and six memory records, written in these
/// orders, with ada's agents' notes admitted to her push.
pub fn ordered(documents: &[usize], memories: &[u64]) -> Ws {
    let mut ws = Ws::new(&Options {
        context: r#"push_authorities = ["person", "agent"]"#.to_owned(),
        ..Options::default()
    });
    write(&ws.dir, documents, memories);
    ws.at(AT + 3_600_000);
    ws
}

fn write(dir: &Path, documents: &[usize], memories: &[u64]) {
    let space_dir = dir.join("state/spaces/alpha");
    {
        let store = SqliteStore::open(&space_dir, "alpha", StoreOptions::default()).unwrap();
        let index = TantivyIndex::open(&space_dir, "alpha", StoreOptions::default()).unwrap();
        let mut writer = index.writer().unwrap();
        for &n in documents {
            let (write, chunks) = document(n);
            let id = write.id.clone();
            store.put_document(write, Expect::Any).unwrap();
            writer.replace(&id, chunks).unwrap();
        }
        writer.commit(store.head().unwrap()).unwrap();
    }
    let store = SqliteMemoryStore::open(&space_dir, "alpha", StoreOptions::default())
        .unwrap()
        .with_machine_backup_exclusion(false);
    for &n in memories {
        store
            .write(samples::memory_batch(AT, vec![memory(n)]))
            .unwrap();
    }
}
