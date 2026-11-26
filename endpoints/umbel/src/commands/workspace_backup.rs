//! `workspace-backup` and `workspace-restore` (D214, [#1772](https://github.com/lushly-dev/afd/issues/1772)):
//! a copy of everything the host keeps in `state/` but its keys, with a manifest
//! (`schemas/workspace-backup.v1.json`) that says what each file is and how each key file is
//! handled, and the restore of it into a workspace that holds none of it.
//!
//! The journal, the projection marker and every space's events and cursors are copied under the
//! workspace lock, which every append to the journal and the events takes, so they are one cut; a
//! cursor is written by rename apart from that lock, and never points past the events it reads, so
//! a cursor copied there is one the events copied hold. Each SQLite file is
//! copied with `VACUUM INTO`, and each declared space's stores as `store-backup` copies them,
//! after the lock is released: documents and memory are never one transaction with the events
//! (phase 6 section 4.4), so each is consistent with itself, as in use. Derived files are left
//! out and rebuilt: an event stream's index by its readers and `event-rebuild`, memory's index on
//! its first open, a store's write-ahead log and shared memory by SQLite. Key files are never
//! copied (D82): the manifest names each one, and what is lost when it is.

use super::backup_files::{
    Planned, backup_source, damaged, digest, io_error, manifest_file, place, plain_relative,
    refusal, undo,
};
use super::store_backup::{SpaceCopy, copy_space, destination};
use super::store_restore::{memory_keys, occupied, plan_space, read_manifest, restore_warnings};
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
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umbel_store_embedded::{KEYS_FILE, PRE_MIGRATION_SUFFIX};

use crate::versions::WORKSPACE_BACKUP_VERSION;

/// What a key file holds, and what is lost when it is (the manifest's `keys`).
fn key_effect(name: &str) -> &'static str {
    match name {
        "approval.key" => {
            "Signs approval requests: approvals asked before its loss cannot be completed and are asked again"
        }
        "confirmation.key" => {
            "Signs confirmation requests: confirmations asked before its loss are asked again"
        }
        "http.token" => {
            "The HTTP surface's bearer token: a new one is made, and every client is given it again"
        }
        "limits.key" => "Names the rate limits' counters: the counters start again",
        "cursor.key" => {
            "Seals the positions handed to readers: a sealed position given before its loss no longer opens, and its reader starts again from event-list"
        }
        "person.key" => {
            "Signs the person page's sign-ins and forms: those in flight fail, and the person signs in again"
        }
        "relay.key" => {
            "Seals the MCP approval relay's request state: a relayed approval in flight is asked again"
        }
        KEYS_FILE => {
            "Holds this space's memory record keys (D82): without it the space's memory cannot be read; keep it apart from the backup and put it back before the restored memory is opened"
        }
        _ => "A key file: never copied by a backup",
    }
}

/// The kind of a file under `state/` other than a space's stores, or `None` for one a backup
/// leaves out: the lock, a key file, a derived or temporary file, a copy before a migration, and
/// a space's stores, which are copied as a store backup copies them.
fn kind_of(relative: &Path) -> Option<&'static str> {
    // A component that is not UTF-8 makes the whole path one no backup holds.
    let parts: Vec<&str> = relative
        .components()
        .map(|c| c.as_os_str().to_str())
        .collect::<Option<_>>()?;
    let name = *parts.last()?;
    if name == KEYS_FILE {
        return None;
    }
    // Hidden files are the host's own temporaries (a cursor's `.<key>….tmp`, a restore's staging)
    // or `umbel init`'s `state/.gitignore`, which every workspace has already.
    if parts.iter().any(|part| part.starts_with('.'))
        || name.ends_with("-wal")
        || name.ends_with("-shm")
        || name.ends_with("-journal")
        || name.ends_with(".partial")
        || name.contains(PRE_MIGRATION_SUFFIX)
    {
        return None;
    }
    match parts.as_slice() {
        ["lock"] | ["keys", ..] => None,
        ["journal.jsonl"] => Some("journal"),
        ["projection.pending"] => Some("pending"),
        ["spaces", _, "events.jsonl"] => Some("events"),
        ["spaces", _, "events.idx"] => None,
        ["spaces", _, "cursors", ..] => Some("cursors"),
        ["spaces", _, "store" | "index", ..] => None,
        ["shared", ..] => Some("shared"),
        ["usage", ..] => Some("usage"),
        _ => Some("state"),
    }
}

/// Every file under `dir`, by its path relative to `base`, sorted.
fn walk(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) -> Result<(), CommandError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(dir, error)),
    };
    for entry in entries {
        let entry = entry.map_err(|e| io_error(dir, e))?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| io_error(&path, e))?;
        if kind.is_dir() {
            walk(&path, base, out)?;
        } else if kind.is_file() {
            out.push(path.strip_prefix(base).unwrap_or(&path).to_path_buf());
        }
    }
    out.sort();
    Ok(())
}

fn slash(path: &Path) -> String {
    path.components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

/// Copy `from` to `to` (a new file), a SQLite database with `VACUUM INTO` and anything else
/// byte for byte, private.
fn copy_file(from: &Path, to: &Path) -> Result<(), CommandError> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    if from.extension().is_some_and(|ext| ext == "sqlite3") {
        return umbel_store_embedded::copy_database(from, to).map_err(|e| command_error(&e));
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut out = options.open(to).map_err(|e| io_error(to, e))?;
    let mut input = fs::File::open(from).map_err(|e| io_error(from, e))?;
    std::io::copy(&mut input, &mut out).map_err(|e| io_error(to, e))?;
    Ok(())
}

fn backup(
    workspace: &Workspace,
    stores: &Hub,
    path: &str,
    now: &str,
) -> Result<Value, CommandError> {
    let target = destination(workspace, path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    // Created here and only here, so a failure removes this backup's directory and never one
    // another backup to the same path made first.
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(&target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            refusal(
                codes::STORE_BACKUP_EXISTS,
                format!("path `{path}` already exists"),
                "Name a directory that does not exist; a backup is written to a new one.",
            )
        } else {
            io_error(&target, e)
        }
    })?;
    let outcome = write_backup(workspace, stores, &target, path, now);
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&target);
    }
    outcome
}

fn write_backup(
    workspace: &Workspace,
    stores: &Hub,
    target: &Path,
    path: &str,
    now: &str,
) -> Result<Value, CommandError> {
    let layout = workspace.layout();
    let state = layout.state_dir();
    // (name in the backup, kind, file written)
    let mut files: Vec<(String, &'static str, PathBuf)> = Vec::new();
    let mut copy = |relative: &Path, kind: &'static str| -> Result<(), CommandError> {
        let name = format!("state/{}", slash(relative));
        let to = target.join(&name);
        let from = state.join(relative);
        if !from.is_file() {
            // Removed since the walk listed it (a cursor replaced by rename, a store retired).
            return Ok(());
        }
        copy_file(&from, &to)?;
        files.push((name, kind, to));
        Ok(())
    };
    let mut everything = Vec::new();
    // The journal, the marker, events and cursors: one cut, under the lock their appends take.
    {
        let _lock = workspace.lock().map_err(|e| e.to_command_error())?;
        walk(&state, &state, &mut everything)?;
        for relative in &everything {
            if let Some(kind @ ("journal" | "pending" | "events" | "cursors")) = kind_of(relative) {
                copy(relative, kind)?;
            }
        }
    }
    for relative in &everything {
        if let Some(kind @ ("shared" | "usage" | "state")) = kind_of(relative) {
            copy(relative, kind)?;
        }
    }
    // Each declared space's stores, as store-backup copies them.
    let mut memory_spaces = Vec::new();
    let mut spaces = Vec::new();
    for space in &workspace.config().spaces {
        let dir = layout.space_state_dir(&space.id);
        // A space with any store on disk: a space that holds only memory has no store.sqlite3
        // until its stores are opened, which the copy does.
        if occupied(&dir).is_none() {
            continue;
        }
        let base = format!("spaces/{}", space.id);
        let SpaceCopy {
            files: copied,
            memory,
        } = copy_space(stores, space.id.as_str(), &target.join(&base))?;
        for (name, file) in copied {
            let kind = if name == "store.sqlite3" {
                "store"
            } else if name == umbel_store_embedded::MEMORY_FILE {
                "memory"
            } else {
                "index"
            };
            files.push((format!("{base}/{name}"), kind, file));
        }
        if memory {
            memory_spaces.push(space.id.to_string());
        }
        spaces.push(space.id.to_string());
    }
    // A space directory the configuration no longer declares: its events and cursors are copied,
    // its stores are not (no host opens them), and the backup says so.
    let mut undeclared = Vec::new();
    for entry in fs::read_dir(layout.space_states_dir())
        .into_iter()
        .flatten()
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().join("store").is_dir() && !workspace.has_space(&name) {
            undeclared.push(name);
        }
    }
    undeclared.sort();
    // The key files, by name, never their bytes.
    let mut keys = Vec::new();
    let mut key_files = Vec::new();
    walk(&layout.keys_dir(), &state, &mut key_files)?;
    for space in &workspace.config().spaces {
        let file = layout
            .space_state_dir(&space.id)
            .join("store")
            .join(KEYS_FILE);
        if file.is_file() {
            key_files.push(file.strip_prefix(&state).unwrap_or(&file).to_path_buf());
        }
    }
    for relative in key_files {
        let name = relative
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        keys.push(json!({
            "path": format!("state/{}", slash(&relative)),
            "handling": "excluded",
            "effect": key_effect(name),
        }));
    }
    let mut listed = Vec::new();
    let mut bytes = 0u64;
    for (name, kind, file) in &files {
        let (sha256, size) = digest(file)?;
        bytes += size;
        listed.push(json!({ "path": name, "kind": kind, "bytes": size, "sha256": sha256 }));
    }
    let config = digest(&layout.config_file())?.0;
    let manifest = json!({
        "version": WORKSPACE_BACKUP_VERSION,
        "scope": "workspace",
        "createdAt": now,
        "config": { "sha256": config },
        "spaces": spaces,
        "files": listed,
        "keys": keys,
        "derived": ["events.idx", "memory index", "write-ahead logs"],
    });
    let manifest_path = target.join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap_or_default(),
    )
    .map_err(|e| io_error(&manifest_path, e))?;
    Ok(json!({
        "path": path,
        "files": files.len(),
        "bytes": bytes,
        "spaces": manifest["spaces"],
        "memory": memory_spaces,
        "keysExcluded": manifest["keys"].as_array().map_or(0, Vec::len),
        "undeclared": undeclared,
        "manifest": "manifest.json",
    }))
}

/// Whether the manifest's files hold `space`'s stores (`spaces/<space>/…`), not only its events.
fn manifest_has_stores(files: &[Value], space: &str) -> bool {
    let prefix = format!("spaces/{space}/");
    files
        .iter()
        .filter_map(|entry| entry.get("path").and_then(Value::as_str))
        .any(|path| path.starts_with(&prefix))
}

/// Where the backup's journal is put before it is merged: hidden, so no backup copies it.
const JOURNAL_STAGED: &str = ".restore-journal.jsonl";

/// Put the restored journal beneath the one the workspace has kept since it was made: with the
/// workspace lock held by the caller, the backup's lines and then the workspace's are written to a
/// new file, synced, and renamed over `state/journal.jsonl`. The workspace's own lines are
/// renumbered after the backup's last `seq`, so the next entry follows the restored events'
/// `journal_seq` and is projected; those lines were never projected into the restored streams.
/// Answers the journal as it was, for [`unmerge_journal`].
fn merge_journal(workspace: &Workspace) -> Result<Option<Vec<u8>>, CommandError> {
    let layout = workspace.layout();
    let staged = layout.state_dir().join(JOURNAL_STAGED);
    let journal = layout.journal_file();
    let outcome = (|| {
        let restored = fs::read(&staged).map_err(|e| io_error(&staged, e))?;
        let previous = match fs::read(&journal) {
            Ok(since) => Some(since),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(io_error(&journal, error)),
        };
        // Only whole entries are kept. A line cut short by a crash mid-append is dropped from
        // either journal: once a newline follows it, every reader of the journal refuses the
        // file, and every append after it fails.
        let entry = |line: &[u8]| match serde_json::from_slice::<Value>(line) {
            Ok(Value::Object(entry)) if entry.get("seq").is_some_and(Value::is_u64) => Some(entry),
            _ => None,
        };
        let mut bytes = Vec::with_capacity(restored.len());
        let mut next = 0;
        for line in restored.split(|b| *b == b'\n') {
            if let Some(found) = entry(line) {
                next = next.max(found["seq"].as_u64().unwrap_or(0));
                bytes.extend_from_slice(line);
                bytes.push(b'\n');
            }
        }
        for line in previous
            .iter()
            .flat_map(|since| since.split(|b| *b == b'\n'))
        {
            if let Some(mut found) = entry(line) {
                next += 1;
                found.insert("seq".to_owned(), json!(next));
                bytes.extend_from_slice(
                    &serde_json::to_vec(&found).map_err(|e| io_error(&journal, e))?,
                );
                bytes.push(b'\n');
            }
        }
        write_journal(&journal, &bytes)?;
        Ok(previous)
    })();
    let _ = fs::remove_file(&staged);
    outcome
}

/// Put the journal back as [`merge_journal`] found it, when a later step of the restore fails.
fn unmerge_journal(workspace: &Workspace, previous: Option<Vec<u8>>) {
    let journal = workspace.layout().journal_file();
    let Ok(_lock) = workspace.lock() else { return };
    match previous {
        Some(bytes) => {
            let _ = write_journal(&journal, &bytes);
        }
        None => {
            let _ = fs::remove_file(&journal);
        }
    }
}

/// Write `bytes` as the journal: a new file beside it, synced, renamed over it.
fn write_journal(journal: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    use std::io::Write;
    let merged = journal.with_file_name(".restore-journal.merged");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let written = options
        .open(&merged)
        .and_then(|mut out| out.write_all(bytes).and_then(|()| out.sync_all()))
        .and_then(|()| fs::rename(&merged, journal));
    if written.is_err() {
        let _ = fs::remove_file(&merged);
    }
    written.map_err(|e| io_error(journal, e))
}

fn restore(
    workspace: &Workspace,
    stores: &Hub,
    path: &str,
    now_ms: i64,
) -> Result<Value, CommandError> {
    let backup = backup_source(workspace, path)?;
    let manifest = read_manifest(&backup)?;
    if manifest.get("scope").and_then(Value::as_str) != Some("workspace") {
        return Err(refusal(
            codes::STORE_BACKUP_UNSUPPORTED,
            "the backup is not a workspace backup".to_owned(),
            "Restore a store-backup directory with store-restore.",
        ));
    }
    let version = manifest.get("version").and_then(Value::as_u64);
    if version != Some(u64::from(WORKSPACE_BACKUP_VERSION)) {
        return Err(refusal(
            codes::STORE_BACKUP_UNSUPPORTED,
            format!(
                "the backup's manifest version is {}; this build restores {WORKSPACE_BACKUP_VERSION}",
                version.map_or_else(|| "missing".to_owned(), |v| v.to_string())
            ),
            "Restore it with a build that reads that version.",
        ));
    }
    let layout = workspace.layout();
    let root = workspace.root();
    let files = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| damaged("manifest.json", "lists no files"))?;
    let mut planned = Vec::new();
    let mut spaces = BTreeSet::new();
    let mut journal = false;
    let mut seen = BTreeSet::new();
    for entry in files {
        let (name, bytes, sha256) = manifest_file(entry)
            .ok_or_else(|| damaged("manifest.json", "has a malformed file entry"))?;
        if !plain_relative(name) {
            return Err(damaged(name, "is not a plain relative path"));
        }
        if !seen.insert(name) {
            return Err(damaged(name, "is listed twice"));
        }
        if let Some(rest) = name.strip_prefix("spaces/") {
            let Some((space, _file)) = rest.split_once('/') else {
                return Err(damaged(name, "names a space but no file of it"));
            };
            spaces.insert(space.to_owned());
            continue;
        }
        let relative = name
            .strip_prefix("state/")
            .ok_or_else(|| damaged(name, "is neither under state/ nor a space's stores"))?;
        // Classified as written and lowercased, so a name that a case-insensitive file system
        // would put among the key files (`state/Keys/…`) is refused as they are.
        let kind = kind_of(Path::new(relative));
        // A space's events and cursors go back only into a space the workspace declares.
        if let Some(space) = relative
            .strip_prefix("spaces/")
            .and_then(|rest| rest.split('/').next())
        {
            spaces.insert(space.to_owned());
        }
        if kind.is_none()
            || kind_of(Path::new(&relative.to_lowercase())) != kind
            || entry.get("kind").and_then(Value::as_str) != kind
        {
            return Err(damaged(name, "is a file a workspace backup never holds"));
        }
        // The journal is restored beneath what the workspace has journaled since it was made
        // (a failed restore included): staged here, merged under the lock below.
        let to = if kind == Some("journal") {
            journal = true;
            layout.state_dir().join(JOURNAL_STAGED)
        } else {
            root.join(name)
        };
        planned.push(Planned {
            name: name.to_owned(),
            from: backup.join(name),
            to,
            bytes,
            sha256: sha256.to_owned(),
        });
    }
    let mut ids = Vec::new();
    for space in &spaces {
        if !workspace.has_space(space) {
            return Err(refusal(
                codes::STORE_RESTORE_SPACE_MISMATCH,
                format!(
                    "the backup holds the space `{space}`, which this workspace does not declare"
                ),
                "Declare the space in umbel.toml as it was when the backup was taken, then retry.",
            ));
        }
        let id = SpaceId::parse(space).map_err(|e| damaged(space, &e.to_string()))?;
        let dir = layout.space_state_dir(&id);
        if let Some(present) = occupied(&dir) {
            return Err(refusal(
                codes::STORE_RESTORE_NOT_EMPTY,
                format!("{} already exists", present.display()),
                "A workspace restore writes only into a workspace that holds none of what it restores: restore into a new workspace, or move state/ aside (keep state/keys/ and each memory.keys).",
            ));
        }
        if !manifest_has_stores(files, space) {
            ids.push((id, 0));
            continue;
        }
        let plan = plan_space(&manifest, &backup, &dir, &format!("spaces/{space}/"))?;
        planned.extend(plan.files);
        ids.push((id, plan.index_retired));
    }
    let state = layout.state_dir();
    // The workspace lock, which every journal and event append takes, is held while files are put
    // in place and the journal merged, so no append lands between them.
    let lock = workspace.lock().map_err(|e| e.to_command_error())?;
    let bytes = place(&planned, &backup, &state, &state.join(".restore-staging"))?;
    // Merged before the checks, which read the journal, so they see the restored entries.
    let previous = if journal {
        match merge_journal(workspace) {
            Ok(previous) => Some(previous),
            Err(error) => {
                undo(&planned);
                return Err(error);
            }
        }
    } else {
        None
    };
    drop(lock);
    // Past this point a failure removes what was put in place and puts the journal back, so the
    // restore can be retried.
    let mut checked = Vec::new();
    let mut warnings = Vec::new();
    for (id, index_retired) in &ids {
        if !layout
            .space_state_dir(id)
            .join("store")
            .join("store.sqlite3")
            .is_file()
        {
            continue;
        }
        let checks = match stores
            .space(id.as_str())
            .map_err(|error| command_error(&error))
            .and_then(|_| super::store_check::run(workspace, stores, id.as_str(), now_ms))
        {
            Ok(checks) => checks,
            Err(error) => {
                undo(&planned);
                if let Some(previous) = previous {
                    unmerge_journal(workspace, previous);
                }
                return Err(error);
            }
        };
        let keys = layout.space_state_dir(id).join("store").join(KEYS_FILE);
        let memory = layout
            .space_state_dir(id)
            .join("store")
            .join(umbel_store_embedded::MEMORY_FILE)
            .is_file();
        let data = json!({
            "space": id.as_str(),
            "memoryKeys": memory_keys(memory, &keys),
            "indexRetired": index_retired,
            "healthy": checks.iter().all(|check| check.status != CheckStatus::Fail),
            "checks": checks,
        });
        warnings.extend(restore_warnings(&data, id.as_str()));
        checked.push(data);
    }
    let config = digest(&layout.config_file())?.0;
    if manifest["config"]["sha256"].as_str() != Some(config.as_str()) {
        warnings.push(Warning::new(
            codes::WORKSPACE_RESTORE_CONFIG_CHANGED,
            "umbel.toml is not the configuration the backup was taken under: check its spaces, access and plugins against the one that was",
        ));
    }
    let missing: Vec<String> = manifest["keys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|key| key["path"].as_str())
        .filter(|key| plain_relative(key) && key.starts_with("state/"))
        .filter(|key| !root.join(key).is_file())
        .map(str::to_owned)
        .collect();
    Ok(json!({
        "path": path,
        "files": planned.len(),
        "bytes": bytes,
        "spaces": checked,
        "keysMissing": missing,
        "warnings": warnings.iter().map(|w| json!({"code": w.code, "message": w.message})).collect::<Vec<_>>(),
    }))
}

fn now_text(context: &CommandContext) -> String {
    chrono::DateTime::from_timestamp_millis(context.clock().now())
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn path_of(input: &Value, what: &str) -> Result<String, CommandError> {
    input
        .get("path")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            refusal(
                afd::error_codes::VALIDATION_ERROR,
                "path is required".to_owned(),
                what,
            )
        })
}

struct Backup {
    workspace: Arc<Workspace>,
    stores: Hub,
}

#[async_trait]
impl CommandHandler for Backup {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, "workspace-backup") {
            return failure(refused);
        }
        let path = match path_of(&input, "Name a new directory inside the workspace.") {
            Ok(path) => path,
            Err(error) => return failure(error),
        };
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let now = now_text(&context);
        match blocking(move || backup(&workspace, &stores, &path, &now)).await {
            Ok(data) => {
                let excluded = data["keysExcluded"].as_u64().unwrap_or(0);
                let warning = Warning::new(
                    codes::MEMORY_KEYS_NOT_BACKED_UP,
                    format!(
                        "The backup holds no key file ({excluded} excluded, each named in its manifest): copy state/keys/ and each space's memory.keys yourself and keep them apart from it; without memory.keys a space's memory cannot be read."
                    ),
                );
                let mut warnings = vec![warning];
                let undeclared: Vec<&str> = data["undeclared"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                if !undeclared.is_empty() {
                    warnings.push(Warning::new(
                        codes::WORKSPACE_BACKUP_UNDECLARED,
                        format!(
                            "The stores of {} are not in the backup: umbel.toml no longer declares them. Their events and cursors are; declare a space again and back up once more to keep its stores.",
                            undeclared.join(", ")
                        ),
                    ));
                }
                let options = ResultOptions {
                    warnings: Some(warnings),
                    ..ResultOptions::default()
                };
                success_with(data, options)
            }
            Err(error) => failure(error),
        }
    }
}

struct Restore {
    workspace: Arc<Workspace>,
    stores: Hub,
}

#[async_trait]
impl CommandHandler for Restore {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        if let Some(refused) = super::operator_only(&self.workspace, &context, "workspace-restore")
        {
            return failure(refused);
        }
        let path = match path_of(&input, "Name the directory workspace-backup wrote.") {
            Ok(path) => path,
            Err(error) => return failure(error),
        };
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let now = context.clock().now();
        match blocking(move || restore(&workspace, &stores, &path, now)).await {
            Ok(mut data) => {
                let warnings: Vec<Warning> = data["warnings"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|w| {
                        Warning::new(
                            w["code"].as_str().unwrap_or_default(),
                            w["message"].as_str().unwrap_or_default(),
                        )
                    })
                    .collect();
                if let Some(map) = data.as_object_mut() {
                    map.remove("warnings");
                }
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

fn expose() -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(false)
        .with_mcp(false)
        .with_agent(false)
        .with_cli(true)
}

/// `workspace-backup`.
pub(crate) fn workspace_backup(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "workspace-backup",
        "Copy everything the host keeps in state/ but its key files into a new directory inside the workspace: the journal, events and cursors as one cut, the shared and usage stores, and every space's stores, with a manifest that names each file's kind and SHA-256 and each key file left out",
        vec![],
        Backup { workspace, stores },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "path, files, bytes, spaces, memory, keysExcluded, undeclared and manifest",
    ))
    .as_mutation()
    .with_expose(expose());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "A new directory inside the workspace, outside state/; it must not exist"
                },
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
    }
}

/// `workspace-restore`.
pub(crate) fn workspace_restore(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "workspace-restore",
        "Put a workspace-backup directory back into a workspace that holds none of its files, checking every file's SHA-256, then check each space's stores; key files are never in a backup and stay where they are kept",
        vec![],
        Restore { workspace, stores },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "path, files, bytes, spaces (each with its checks) and keysMissing",
    ))
    .as_mutation()
    .with_expose(expose());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "minLength": 1,
                    "description": "The directory workspace-backup wrote, inside the workspace and outside state/"
                },
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_file_under_state_has_its_kind_or_is_left_out() {
        for (path, kind) in [
            ("journal.jsonl", Some("journal")),
            ("projection.pending", Some("pending")),
            ("spaces/main/events.jsonl", Some("events")),
            ("spaces/main/cursors/abc.json", Some("cursors")),
            ("shared/person.sqlite3", Some("shared")),
            ("usage/usage.sqlite3", Some("usage")),
            ("spaces/main/records/eval.json", Some("state")),
            ("lock", None),
            ("keys/http.token", None),
            ("spaces/main/events.idx", None),
            ("spaces/main/store/store.sqlite3", None),
            ("spaces/main/store/memory.keys", None),
            ("spaces/main/index/v2/meta.json", None),
            ("shared/person.sqlite3-wal", None),
            ("shared/person.sqlite3.v1.pre-migration", None),
            (".restore-staging/0", None),
        ] {
            assert_eq!(kind_of(Path::new(path)), kind, "{path}");
        }
    }
}
