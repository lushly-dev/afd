//! `store-restore`: a `store-backup` directory put back as a space's stores (D214; phase 6
//! specification section 6.2, its embedded part).
//!
//! It reads the backup's manifest, refuses a file the manifest does not account for or a backup
//! of another space, and puts every file in place through [`super::backup_files::place`], which
//! checks each against its size and digest and never overwrites. The index of memory is not in a
//! backup and is rebuilt when memory first opens (phase 3 section 5.4); the memory key file never
//! is (D82), and stays where the deployer keeps it. The restored stores are then checked as
//! `store-check` checks them.

use super::backup_files::{
    Planned, backup_source, damaged, manifest_file, place, plain_relative, refusal, undo,
};
use super::store_common::{space_property, view};
use super::{Builtin, blocking, returns_object};
use crate::doctor::CheckStatus;
use crate::store::{Hub, codes, command_error};
use crate::workspace::{SpaceId, Workspace};
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    ResultOptions, Warning, failure, success_with,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umbel_store_embedded::{INDEX_SCHEMA_DIR, KEYS_FILE, MEMORY_FILE};

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
}

/// The backups this build restores: `store-backup`'s manifest version 1.
const MANIFEST_VERSIONS: &[u32] = &[crate::versions::STORE_BACKUP_VERSION];

/// Read `dir/manifest.json`, refusing what this build cannot restore.
pub(super) fn read_manifest(dir: &Path) -> Result<Value, CommandError> {
    let path = dir.join("manifest.json");
    let bytes = fs::read(&path).map_err(|_| {
        refusal(
            codes::STORE_BACKUP_DAMAGED,
            format!("{} cannot be read", path.display()),
            "Name the directory store-backup or workspace-backup wrote; it holds manifest.json.",
        )
    })?;
    serde_json::from_slice(&bytes).map_err(|_| damaged("manifest.json", "is not JSON"))
}

/// The files of a `store-backup` manifest, each planned to its place under `space_dir`
/// (`state/spaces/<space>`): `store.sqlite3` and `memory.sqlite3` under `store/`, and the index's
/// files under `index/<schema>/`. `store.sqlite3` goes last, so a process that opens the space
/// meanwhile finds no store until every other file is in place. The files of a retired index
/// schema (`index/v1/`, before #830) are left out and counted: the index is derived, and
/// `knowledge-index rebuild=true` writes the current one.
pub(super) struct SpacePlan {
    pub(super) files: Vec<Planned>,
    pub(super) memory: bool,
    pub(super) index_retired: usize,
}

pub(super) fn plan_space(
    manifest: &Value,
    backup: &Path,
    space_dir: &Path,
    prefix: &str,
) -> Result<SpacePlan, CommandError> {
    let files = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| damaged("manifest.json", "lists no files"))?;
    let mut planned = Vec::new();
    let mut store = None;
    let mut memory = false;
    let mut index_retired = 0;
    let mut seen = std::collections::BTreeSet::new();
    let index_prefix = format!("index/{INDEX_SCHEMA_DIR}/");
    for entry in files {
        let (name, bytes, sha256) = manifest_file(entry)
            .ok_or_else(|| damaged("manifest.json", "has a malformed file entry"))?;
        let Some(local) = name.strip_prefix(prefix) else {
            continue;
        };
        if !seen.insert(local) {
            return Err(damaged(name, "is listed twice"));
        }
        if !plain_relative(local) {
            return Err(damaged(name, "is not a plain relative path"));
        }
        let to = if local == "store.sqlite3" || local == MEMORY_FILE {
            memory |= local == MEMORY_FILE;
            space_dir.join("store").join(local)
        } else if local
            .strip_prefix(&index_prefix)
            .is_some_and(|file| !file.is_empty() && !file.contains('/'))
        {
            space_dir.join(local)
        } else if local
            .strip_prefix("index/")
            .and_then(|rest| rest.split_once('/'))
            .is_some_and(|(dir, file)| dir != INDEX_SCHEMA_DIR && !file.contains('/'))
        {
            index_retired += 1;
            continue;
        } else {
            return Err(refusal(
                codes::STORE_BACKUP_DAMAGED,
                format!(
                    "the backup names `{name}`, which a store backup of this build does not hold"
                ),
                "Restore it with the build that wrote it, or from another backup.",
            ));
        };
        let file = Planned {
            name: name.to_owned(),
            from: backup.join(name),
            to,
            bytes,
            sha256: sha256.to_owned(),
        };
        if local == "store.sqlite3" {
            store = Some(file);
        } else {
            planned.push(file);
        }
    }
    let store = store.ok_or_else(|| damaged("manifest.json", "lists no store.sqlite3"))?;
    planned.push(store);
    Ok(SpacePlan {
        files: planned,
        memory,
        index_retired,
    })
}

/// What would make a space not empty: its database and write-ahead log, memory's database, and
/// any file of the current index.
pub(super) fn occupied(space_dir: &Path) -> Option<PathBuf> {
    let store = space_dir.join("store");
    let index = space_dir.join("index").join(INDEX_SCHEMA_DIR);
    [
        "store.sqlite3",
        "store.sqlite3-wal",
        "store.sqlite3-journal",
        MEMORY_FILE,
        "memory.sqlite3-wal",
        "memory.sqlite3-journal",
    ]
    .iter()
    .map(|name| store.join(name))
    .find(|path| path.exists())
    .or_else(|| {
        fs::read_dir(&index)
            .ok()?
            .flatten()
            .next()
            .map(|entry| entry.path())
    })
}

fn run(
    workspace: &Workspace,
    stores: &Hub,
    space: &SpaceId,
    path: &str,
    now_ms: i64,
) -> Result<Value, CommandError> {
    let backup = backup_source(workspace, path)?;
    let manifest = read_manifest(&backup)?;
    if manifest.get("scope").and_then(Value::as_str) == Some("workspace") {
        return Err(refusal(
            codes::STORE_BACKUP_UNSUPPORTED,
            "the backup is a workspace backup".to_owned(),
            "Restore it with workspace-restore, into a workspace that holds none of its files.",
        ));
    }
    let version = manifest.get("version").and_then(Value::as_u64);
    if !version.is_some_and(|v| MANIFEST_VERSIONS.iter().any(|&known| u64::from(known) == v)) {
        return Err(refusal(
            codes::STORE_BACKUP_UNSUPPORTED,
            format!(
                "the backup's manifest version is {}; this build restores {MANIFEST_VERSIONS:?}",
                version.map_or_else(|| "missing".to_owned(), |v| v.to_string())
            ),
            "Restore it with a build that reads that version.",
        ));
    }
    let of = manifest
        .get("space")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if of != space.as_str() {
        return Err(refusal(
            codes::STORE_RESTORE_SPACE_MISMATCH,
            format!("the backup is of space `{of}`, not `{space}`"),
            "Restore it into the space it was taken from (space=<that space>); a store records its space.",
        ));
    }
    let space_dir = workspace.layout().space_state_dir(space);
    if let Some(present) = occupied(&space_dir) {
        return Err(refusal(
            codes::STORE_RESTORE_NOT_EMPTY,
            format!("{} already exists", present.display()),
            "A restore writes only into an empty space: move state/spaces/<space>/store/store.sqlite3, memory.sqlite3 and the index aside first, and keep memory.keys where it is.",
        ));
    }
    let SpacePlan {
        files: planned,
        memory,
        index_retired,
    } = plan_space(&manifest, &backup, &space_dir, "")?;
    let bytes = place(
        &planned,
        &backup,
        &workspace.layout().state_dir(),
        &space_dir.join(".restore-staging"),
    )?;
    // Open the restored stores: an open that fails leaves the space empty again.
    if let Err(error) = stores.space(space.as_str()) {
        undo(&planned);
        return Err(command_error(&error));
    }
    let checks = super::store_check::run(workspace, stores, space.as_str(), now_ms)?;
    let keys = space_dir.join("store").join(KEYS_FILE);
    Ok(json!({
        "space": space.as_str(),
        "path": path,
        "files": planned.len(),
        "bytes": bytes,
        "memory": memory,
        "memoryKeys": memory_keys(memory, &keys),
        "indexRetired": index_retired,
        "healthy": checks.iter().all(|check| check.status != CheckStatus::Fail),
        "checks": checks,
    }))
}

/// Where the space's memory key file stands after a restore: `none` (no memory, no key file),
/// `present`, `missing` (memory without it) or `unused` (a key file, but no memory restored).
pub(super) fn memory_keys(memory: bool, keys: &Path) -> &'static str {
    match (memory, keys.is_file()) {
        (false, false) => "none",
        (true, true) => "present",
        (true, false) => "missing",
        (false, true) => "unused",
    }
}

/// The warnings a restore's result carries: memory without its key file or a key file without
/// memory, a retired index left out, and each check that did not pass.
pub(super) fn restore_warnings(data: &Value, space: &str) -> Vec<Warning> {
    let mut warnings = Vec::new();
    if data["memoryKeys"] == "unused" {
        warnings.push(Warning::new(
            codes::MEMORY_KEYS_MISMATCH,
            format!("state/spaces/{space}/store/memory.keys is there but the backup holds no memory: the first memory write refuses a key file with no database, so move it aside unless memory is restored next"),
        ));
    }
    if data["indexRetired"].as_u64().unwrap_or(0) > 0 {
        warnings.push(Warning::new(
            codes::STORE_RESTORE_INDEX_RETIRED,
            "the backup's index is of a retired schema and was left out: run knowledge-index rebuild=true to write the current one",
        ));
    }
    if data["memoryKeys"] == "missing" {
        warnings.push(Warning::new(
            codes::MEMORY_KEYS_MISSING,
            format!("memory was restored without its key file, which no backup holds: put the key file kept apart from this backup at state/spaces/{space}/store/memory.keys, then run store-check; until then no memory reads"),
        ));
    }
    for check in data["checks"].as_array().into_iter().flatten() {
        if check["status"] == "warn" || check["status"] == "fail" {
            warnings.push(Warning::new(
                codes::STORE_RESTORE_CHECK,
                format!(
                    "{}: {}",
                    check["id"].as_str().unwrap_or_default(),
                    check["message"].as_str().unwrap_or_default()
                ),
            ));
        }
    }
    warnings
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, "store-restore") {
            return failure(refused);
        }
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let Some(path) = input.get("path").and_then(Value::as_str).map(str::to_owned) else {
            return failure(refusal(
                afd::error_codes::VALIDATION_ERROR,
                "path is required".to_owned(),
                "Name the directory store-backup wrote.",
            ));
        };
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let now = context.clock().now();
        let name = space.to_string();
        match blocking(move || run(&workspace, &stores, &space, &path, now)).await {
            Ok(data) => {
                let warnings = restore_warnings(&data, &name);
                let options = ResultOptions {
                    warnings: (!warnings.is_empty()).then_some(warnings),
                    ..ResultOptions::default()
                };
                success_with(data, options)
            }
            Err(error) => failure(error),
        }
    }
}

/// `store-restore`.
pub(crate) fn store_restore(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "store-restore",
        "Put a store-backup directory back as an empty space's stores, checking every file's SHA-256, then check the stores; the memory key file is never in a backup and stays where it is kept",
        vec![],
        Handler { workspace, stores },
    )
    .with_category("store")
    .with_returns(returns_object(
        "space, path, files, bytes, memory, memoryKeys, healthy and checks",
    ))
    .as_mutation()
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": space_property(),
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "The directory store-backup wrote, inside the workspace and outside state/"
                },
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
    }
}
