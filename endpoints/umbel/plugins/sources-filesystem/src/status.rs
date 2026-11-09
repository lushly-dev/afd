//! `sources-status` (specification section 5.5): the sync's walk without reading a file.

use std::collections::HashSet;

use serde_json::{Value, json};
use umbel_okf::document_id;
use umbel_sdk::{Cx, HostError, Outcome, failure, success};

use crate::access::{Directories, INVALID_KEY};
use crate::collection::{self, Collection, MAX_FILES};
use crate::fail;
use crate::report::{Changes, LISTED_PATHS, Skips, is_person_at_cli, readable};
use crate::state::{State, last_sync};
use crate::sync::{candidates, collections, schema};

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return failure(
            "SPACE_NOT_FOUND",
            "the call resolved no space",
            "Pass `space`, or set default_space in umbel.toml.",
        );
    };
    let wanted = input.get("collection").and_then(Value::as_str);
    let chosen = match collections(cx, &space, wanted) {
        Ok(chosen) => chosen,
        Err(outcome) => return outcome,
    };
    let schema = match schema(cx) {
        Ok(schema) => schema,
        Err(outcome) => return outcome,
    };
    let mut entries = Vec::new();
    for collection in &chosen {
        match inspect(cx, &space, collection, &schema.bytes) {
            Ok(entry) => entries.push(entry),
            Err(error) => return fail::host(&error),
        }
    }
    success(json!({ "space": space, "collections": entries }))
        .with_metadata("dev.umbel/trust", json!("content"))
}

fn inspect(
    cx: &Cx,
    space: &str,
    collection: &Collection,
    schema: &[u8],
) -> Result<Value, HostError> {
    let id = collection.info.id.as_str();
    let person = is_person_at_cli(cx);
    let Some(entries) = collection::list(cx, space, id)? else {
        return Ok(json!({ "collection": id, "limited": true }));
    };
    let mut skips = Skips::default();
    let (candidates, selected) = candidates(&entries, collection, &mut skips);
    if selected > MAX_FILES {
        return Ok(json!({ "collection": id, "limited": true }));
    }
    let state = State::load(cx, space, id)?;
    let mut bytes = 0;
    let directories = Directories::load(cx, space, id, &entries, &mut bytes);
    let digest = collection.digest(schema);
    let live: HashSet<&str> = candidates.iter().map(|c| c.path.as_str()).collect();

    // A caller whose positions are sealed (phase 5 section 9.3) is told only of files whose stored
    // document it can read: a file not synced yet has no document to judge it by, a skipped one
    // none at all.
    let sealed = if cx.call().sealed_positions {
        Some(cx.reader_tokens(space)?)
    } else {
        None
    };
    let counts = |seen: Option<&crate::state::Entry>| -> bool {
        sealed.as_ref().is_none_or(|mine| {
            seen.and_then(|seen| seen.stored.as_ref())
                .is_some_and(|(access, _)| access.iter().any(|token| mine.contains(token)))
        })
    };
    let mut files = 0usize;
    let (mut new, mut modified, mut unchanged, mut skipped) = (0usize, 0usize, 0usize, 0usize);
    let mut changed = Changes::default();
    let mut new_paths: Vec<&str> = Vec::new();
    for candidate in &candidates {
        let key = directories
            .inherit(&candidate.path, collection)
            .map_or(INVALID_KEY.to_owned(), |inherit| inherit.key);
        files += usize::from(counts(state.get(&candidate.path)));
        match state.get(&candidate.path) {
            None if sealed.is_some() => {}
            None => {
                new += 1;
                if person && new_paths.len() < LISTED_PATHS {
                    new_paths.push(&candidate.path);
                }
            }
            Some(seen)
                if seen.size == candidate.size
                    && seen.mtime_ms == candidate.mtime_ms
                    && seen.cfg == digest
                    && seen.inherit == key =>
            {
                if seen.skip.is_some() {
                    skipped += usize::from(sealed.is_none());
                } else {
                    unchanged += usize::from(counts(Some(seen)));
                }
            }
            Some(seen) => {
                modified += usize::from(counts(Some(seen)));
                if seen.stored.is_some() && readable(cx, space, id, &candidate.id)? {
                    changed.add(&candidate.id, "modified");
                }
            }
        }
    }
    let mut deleted = 0usize;
    for (path, seen) in state
        .entries()
        .filter(|(path, _)| !live.contains(path.as_str()))
    {
        deleted += usize::from(counts(Some(seen)));
        if seen.stored.is_some()
            && let Ok(doc) = document_id(id, path, collection.kind)
            && readable(cx, space, id, &doc)?
        {
            changed.add(&doc, "deleted");
        }
    }
    let (listed, more) = changed.json();
    let mut entry = json!({
        "collection": id,
        "files": if sealed.is_some() { files } else { candidates.len() },
        "new": new,
        "modified": modified,
        "deleted": deleted,
        "unchanged": unchanged,
        "skipped": if sealed.is_some() { 0 } else { skipped + skips.total() },
        "changedSinceLastSync": new + modified + deleted,
        "lastSync": match last_sync(cx, space, id)? {
            Some((rev, at, _)) => Some(json!({ "rev": cx.doc_position(space, rev)?, "at": at })),
            None => None,
        },
        "changed": listed,
        "changedMore": more,
    });
    if person && let Some(map) = entry.as_object_mut() {
        map.insert("newPaths".to_owned(), json!(new_paths));
    }
    Ok(entry)
}
