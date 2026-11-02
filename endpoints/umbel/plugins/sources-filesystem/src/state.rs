//! The sync state (specification section 5.2): for each file of a collection, what was seen the
//! last time it was read, so an unchanged file is recognised from its size and modification time
//! alone.
//!
//! One record holds at most 2 MiB, and a collection may hold 100 000 files, so the state is
//! sharded: 256 records of kind `sync-shard`, the shard chosen by the first byte of the path's
//! hash, each only written when one of its files changed. A record of kind `sync-state`, one per
//! collection, says when the collection was last synced and to which revision. Both carry the
//! access set `["space"]`: they hold paths, which a reader of the space who runs a sync sees
//! anyway.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError};
use umbel_store::{ContentHash, Envelope, Expect, Origin, Sensitivity};

/// The records' kinds.
const SHARD_KIND: &str = "sync-shard";
const STATE_KIND: &str = "sync-state";
/// How many shards a collection's state is split into.
const SHARDS: usize = 256;

/// What was seen of one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    /// Size in bytes, from the listing.
    pub(crate) size: u64,
    /// Modification time in milliseconds, from the listing.
    pub(crate) mtime_ms: i64,
    /// `sha256:<hex>` of the bytes, when they were read.
    pub(crate) hash: Option<String>,
    /// The warning code the file was skipped with, when it was.
    pub(crate) skip: Option<String>,
    /// The access set and sensitivity of the stored document; `None` for a skipped file.
    pub(crate) stored: Option<(Vec<String>, Sensitivity)>,
    /// The inherited rule's key when the file was read (`access::INVALID_KEY` for a rule that
    /// did not read).
    pub(crate) inherit: String,
    /// The collection digest the file was read under.
    pub(crate) cfg: String,
}

/// The state of one collection.
#[derive(Debug, Default)]
pub(crate) struct State {
    files: BTreeMap<String, Entry>,
    dirty: BTreeSet<usize>,
}

fn shard_of(path: &str) -> usize {
    let hash = ContentHash::of(path.as_bytes()).to_string();
    hash.strip_prefix("sha256:")
        .and_then(|hex| hex.get(..2))
        .and_then(|byte| usize::from_str_radix(byte, 16).ok())
        .unwrap_or(0)
        % SHARDS
}

fn shard_id(collection: &str, shard: usize) -> String {
    format!("{collection}/{shard:02x}")
}

fn bookkeeping(sensitivity: Sensitivity, now: &str) -> Envelope {
    Envelope {
        version: 1,
        origin: Origin::DocumentDerived,
        space: String::new(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: now.to_owned(),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access: vec!["space".to_owned()],
        sensitivity: Some(sensitivity),
    }
}

fn sensitivity_name(sensitivity: Sensitivity) -> &'static str {
    match sensitivity {
        Sensitivity::Public => "public",
        Sensitivity::Internal => "internal",
        Sensitivity::Confidential => "confidential",
        Sensitivity::Restricted => "restricted",
    }
}

fn parse_sensitivity(name: &str) -> Option<Sensitivity> {
    serde_json::from_value(Value::String(name.to_owned())).ok()
}

/// A shard's body: `{ version, sets, files: { path: [size, mtime, hash, skip, set, inherit, cfg] } }`.
fn encode(files: &BTreeMap<String, Entry>, shard: usize) -> Value {
    let mut sets: Vec<(Vec<String>, Sensitivity)> = Vec::new();
    let mut body = serde_json::Map::new();
    for (path, entry) in files.iter().filter(|(path, _)| shard_of(path) == shard) {
        let set = entry.stored.as_ref().map(|stored| {
            sets.iter()
                .position(|known| known == stored)
                .unwrap_or_else(|| {
                    sets.push(stored.clone());
                    sets.len() - 1
                })
        });
        body.insert(
            path.clone(),
            json!([
                entry.size,
                entry.mtime_ms,
                entry.hash,
                entry.skip,
                set,
                entry.inherit,
                entry.cfg
            ]),
        );
    }
    json!({
        "version": 1,
        "sets": sets
            .iter()
            .map(|(access, sensitivity)| json!([access, sensitivity_name(*sensitivity)]))
            .collect::<Vec<_>>(),
        "files": body,
    })
}

fn decode(body: &Value, into: &mut BTreeMap<String, Entry>) -> Option<()> {
    let sets: Vec<(Vec<String>, Sensitivity)> = body
        .get("sets")?
        .as_array()?
        .iter()
        .map(|set| {
            let pair = set.as_array()?;
            let access = pair
                .first()?
                .as_array()?
                .iter()
                .map(|token| token.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()?;
            Some((access, parse_sensitivity(pair.get(1)?.as_str()?)?))
        })
        .collect::<Option<Vec<_>>>()?;
    for (path, row) in body.get("files")?.as_object()? {
        let row = row.as_array()?;
        let text = |at: usize| row.get(at).and_then(Value::as_str).map(str::to_owned);
        into.insert(
            path.clone(),
            Entry {
                size: row.first()?.as_u64()?,
                mtime_ms: row.get(1)?.as_i64()?,
                hash: text(2),
                skip: text(3),
                stored: match row.get(4)? {
                    Value::Null => None,
                    index => Some(sets.get(usize::try_from(index.as_u64()?).ok()?)?.clone()),
                },
                inherit: text(5)?,
                cfg: text(6)?,
            },
        );
    }
    Some(())
}

impl State {
    /// Read every shard of `collection`. A shard that does not read is treated as empty, which
    /// makes the next sync read its files again.
    pub(crate) fn load(cx: &Cx, space: &str, collection: &str) -> Result<Self, HostError> {
        let mut files = BTreeMap::new();
        for shard in 0..SHARDS {
            if let Some(record) = cx.record_get(space, SHARD_KIND, &shard_id(collection, shard))? {
                let _ = decode(&record.body, &mut files);
            }
        }
        Ok(Self {
            files,
            dirty: BTreeSet::new(),
        })
    }

    pub(crate) fn get(&self, path: &str) -> Option<&Entry> {
        self.files.get(path)
    }

    pub(crate) fn entries(&self) -> impl Iterator<Item = (&String, &Entry)> {
        self.files.iter()
    }

    pub(crate) fn set(&mut self, path: &str, entry: Entry) {
        if self.files.get(path) != Some(&entry) {
            self.dirty.insert(shard_of(path));
            self.files.insert(path.to_owned(), entry);
        }
    }

    pub(crate) fn remove(&mut self, path: &str) {
        if self.files.remove(path).is_some() {
            self.dirty.insert(shard_of(path));
        }
    }

    /// Write the shards that changed and the collection's summary; returns the revisions the
    /// records took.
    pub(crate) fn save(
        &mut self,
        cx: &Cx,
        space: &str,
        collection: &str,
        summary: &Value,
    ) -> Result<Vec<u64>, HostError> {
        let mut revs = Vec::new();
        // A run that changed nothing writes nothing: a revision for every no-op sync would bury
        // the change log, and the summary would only repeat itself.
        if self.dirty.is_empty() {
            return Ok(revs);
        }
        let now = "1970-01-01T00:00:00.000Z";
        for shard in std::mem::take(&mut self.dirty) {
            let meta = cx.record_put(
                space,
                SHARD_KIND,
                &shard_id(collection, shard),
                encode(&self.files, shard),
                bookkeeping(Sensitivity::Internal, now),
                Expect::Any,
            )?;
            revs.push(meta.rev);
        }
        let meta = cx.record_put(
            space,
            STATE_KIND,
            collection,
            summary.clone(),
            bookkeeping(Sensitivity::Internal, now),
            Expect::Any,
        )?;
        revs.push(meta.rev);
        Ok(revs)
    }
}

/// The summary record of a collection, when it has been synced.
pub(crate) fn last_sync(
    cx: &Cx,
    space: &str,
    collection: &str,
) -> Result<Option<(u64, String, Value)>, HostError> {
    Ok(cx
        .record_get(space, STATE_KIND, collection)?
        .map(|record| (record.rev, record.envelope.observed_at, record.body)))
}
