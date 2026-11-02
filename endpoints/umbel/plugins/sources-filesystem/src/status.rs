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

    let (mut new, mut modified, mut unchanged, mut skipped) = (0usize, 0usize, 0usize, 0usize);
    let mut changed = Changes::default();
    let mut new_paths: Vec<&str> = Vec::new();
    for candidate in &candidates {
        let key = directories
            .inherit(&candidate.path, collection)
            .map_or(INVALID_KEY.to_owned(), |inherit| inherit.key);
        match state.get(&candidate.path) {
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
                    skipped += 1;
                } else {
                    unchanged += 1;
                }
            }
            Some(seen) => {
                modified += 1;
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
        deleted += 1;
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
        "files": candidates.len(),
        "new": new,
        "modified": modified,
        "deleted": deleted,
        "unchanged": unchanged,
        "skipped": skipped + skips.total(),
        "changedSinceLastSync": new + modified + deleted,
        "lastSync": last_sync(cx, space, id)?
            .map(|(rev, at, _)| json!({ "rev": rev, "at": at })),
        "changed": listed,
        "changedMore": more,
    });
    if person && let Some(map) = entry.as_object_mut() {
        map.insert("newPaths".to_owned(), json!(new_paths));
    }
    Ok(entry)
}
