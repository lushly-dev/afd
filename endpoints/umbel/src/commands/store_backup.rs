//! `store-backup`: a consistent copy of a space's stores, with a manifest of digests.
//!
//! The copy holds the index writer, so no indexer commits or merges during it; the database is
//! copied with `VACUUM INTO`. Restore is phase 6's.

use super::store_common::{space_property, view};
use super::{Builtin, blocking, returns_object};
use crate::store::{Hub, codes, command_error};
use crate::workspace::Workspace;
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use umbel_store::StoreError;

struct Handler {
    workspace: Arc<Workspace>,
    stores: Hub,
}

fn refusal(code: &str, message: String, suggestion: &str) -> CommandError {
    CommandError::new(code, message)
        .with_suggestion(suggestion)
        .with_retryable(false)
}

/// The destination: relative to the workspace (or absolute inside it), without `..`, not
/// existing, and whose parent exists inside the workspace once resolved.
fn destination(workspace: &Workspace, path: &str) -> Result<PathBuf, CommandError> {
    let invalid = |why: &str| {
        refusal(
            afd::error_codes::VALIDATION_ERROR,
            format!("path `{path}` {why}"),
            "Name a new directory inside the workspace, such as backups/2026-11-01.",
        )
    };
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err(invalid("is empty or holds a control character"));
    }
    let given = Path::new(path);
    if given
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(invalid("must not hold a `..` segment"));
    }
    let root = workspace.root().canonicalize().map_err(|e| {
        invalid(&format!(
            "cannot be resolved: the workspace is unreadable ({e})"
        ))
    })?;
    let target = if given.is_absolute() {
        given.to_path_buf()
    } else {
        root.join(given)
    };
    // The parent need not exist yet (`backups/2026-11-01`): the deepest ancestor that does must
    // be inside the workspace and outside `state/`, and nothing below it can be a link yet.
    let parent = target
        .parent()
        .ok_or_else(|| invalid("has no parent directory"))?;
    let mut existing = parent;
    let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
    while !existing.exists() {
        missing.push(
            existing
                .file_name()
                .ok_or_else(|| invalid("cannot be resolved"))?,
        );
        existing = existing
            .parent()
            .ok_or_else(|| invalid("cannot be resolved"))?;
    }
    let mut parent = existing
        .canonicalize()
        .map_err(|_| invalid("cannot be resolved"))?;
    for part in missing.into_iter().rev() {
        parent.push(part);
    }
    if !parent.starts_with(&root) || parent.starts_with(root.join("state")) {
        return Err(invalid("must be inside the workspace and outside state/"));
    }
    let target = parent.join(target.file_name().ok_or_else(|| invalid("has no name"))?);
    if target.exists() {
        return Err(refusal(
            codes::STORE_BACKUP_EXISTS,
            format!("path `{path}` already exists"),
            "Name a directory that does not exist; a backup is written to a new one.",
        ));
    }
    Ok(target)
}

fn digest(path: &Path) -> Result<(String, u64), CommandError> {
    let bytes = fs::read(path)
        .map_err(|e| command_error(&StoreError::Io(format!("{}: {e}", path.display()))))?;
    let mut text = String::from("sha256:");
    for byte in Sha256::digest(&bytes) {
        text.push_str(&format!("{byte:02x}"));
    }
    Ok((text, bytes.len() as u64))
}

fn run(
    workspace: &Workspace,
    stores: &Hub,
    space: &str,
    path: &str,
    now: &str,
) -> Result<Value, CommandError> {
    let target = destination(workspace, path)?;
    let opened = stores.space(space).map_err(|e| command_error(&e))?;
    // Hold the index writer for the whole copy: no indexer commits or merges meanwhile.
    let mut writer = opened.index.writer().map_err(|e| command_error(&e))?;
    let outcome = (|| -> Result<Value, CommandError> {
        let io = |what: &Path, e: std::io::Error| {
            command_error(&StoreError::Io(format!("{}: {e}", what.display())))
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
        }
        fs::create_dir(&target).map_err(|e| io(&target, e))?;
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        let database = target.join("store.sqlite3");
        opened
            .sqlite
            .backup_to(&database)
            .map_err(|e| command_error(&e))?;
        files.push(("store.sqlite3".to_owned(), database));
        let index_dir = target.join("index").join("v1");
        fs::create_dir_all(&index_dir).map_err(|e| io(&index_dir, e))?;
        for name in opened.tantivy.live_files().map_err(|e| command_error(&e))? {
            let from = opened.tantivy.path().join(&name);
            let to = index_dir.join(&name);
            // tantivy names the delete file of a segment whose last delete pass removed nothing
            // in `meta.json` without writing it; every other listed file must exist.
            if !from.exists() && name.extension().is_some_and(|ext| ext == "del") {
                continue;
            }
            fs::copy(&from, &to).map_err(|e| io(&from, e))?;
            files.push((format!("index/v1/{}", name.display()), to));
        }
        let mut listed = Vec::new();
        let mut bytes = 0u64;
        for (name, file) in &files {
            let (sha256, size) = digest(file)?;
            bytes += size;
            listed.push(json!({ "path": name, "bytes": size, "sha256": sha256 }));
        }
        let manifest = json!({
            "version": 1,
            "space": space,
            "createdAt": now,
            "files": listed,
        });
        let manifest_path = target.join("manifest.json");
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap_or_default(),
        )
        .map_err(|e| io(&manifest_path, e))?;
        Ok(json!({
            "space": space,
            "path": path,
            "files": files.len(),
            "bytes": bytes,
            "manifest": "manifest.json",
        }))
    })();
    writer.abort();
    drop(writer);
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&target);
    }
    outcome
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let (space, _filter) = match view(&self.workspace, &input, &context) {
            Ok(view) => view,
            Err(error) => return failure(error),
        };
        let Some(path) = input.get("path").and_then(Value::as_str).map(str::to_owned) else {
            return failure(refusal(
                afd::error_codes::VALIDATION_ERROR,
                "path is required".to_owned(),
                "Name a new directory inside the workspace.",
            ));
        };
        let workspace = Arc::clone(&self.workspace);
        let stores = Arc::clone(&self.stores);
        let space = space.to_string();
        let now = chrono::DateTime::from_timestamp_millis(context.clock().now())
            .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_default();
        match blocking(move || run(&workspace, &stores, &space, &path, &now)).await {
            Ok(data) => success(data),
            Err(error) => failure(error),
        }
    }
}

/// `store-backup`.
pub(crate) fn store_backup(workspace: Arc<Workspace>, stores: Hub) -> Builtin {
    let definition = CommandDefinition::new(
        "store-backup",
        "Copy a space's stores into a new directory inside the workspace, with a manifest of SHA-256 digests",
        vec![],
        Handler { workspace, stores },
    )
    .with_category("store")
    .with_returns(returns_object("space, path, files, bytes and manifest"))
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
                    "description": "A new directory inside the workspace, outside state/; it must not exist"
                },
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
    }
}
