//! What manifest version 6 adds (records host specification, section 2; D159): the top-level
//! `[[records]]`, the record kinds of a plugin's own namespace that the host indexes.
//!
//! This module parses, validates and stores them as [`RecordDecl`]s, with the rules a declaration
//! brings: a compiled plugin only, the `records` and `records_write` grants declared, and a
//! `journal` mode on every command and pipeline, so that a record's text reaches the journal only
//! where the plugin said so (D72). What acts on a declaration is that specification's later
//! steps: until then a declared kind is written and read as an undeclared one.

use umbel_store::lane::{
    MAX_KEY_POINTERS, MAX_RECORD_KINDS, MAX_TEXT_POINTERS, Pointer, RecordDecl,
};

use super::{GrantDecl, Manifest, PluginInfo, PluginKind, Tbl};
use crate::plugins::error::PluginError;

/// The top-level key manifest version 6 adds; versions 1 to 5 name and refuse it.
pub(super) const TOP_KEYS_V6: &[(&str, &str)] = &[(
    "records",
    "a declared record kind needs manifest_version = 6",
)];
const RECORD_KEYS: &[&str] = &["kind", "standing", "text", "keys", "match"];
/// The grants a plugin that declares a kind declares: the kind is reached through them.
const RECORD_GRANTS: &[&str] = &["records", "records_write"];
const POINTER_RULE: &str = "must be a pointer: / followed by 1 to 4 member names joined by /, each matching ^[A-Za-z_][A-Za-z0-9_]{0,63}$, at most 128 bytes in all";

/// `[[records]]`: at most [`MAX_RECORD_KINDS`] entries, each a kind of the plugin's namespace
/// with its text pointers, key pointers and match field (section 2's table).
pub(super) fn records(
    root: &Tbl<'_>,
    plugin: &PluginInfo,
    grants: &[GrantDecl],
) -> Result<Vec<RecordDecl>, PluginError> {
    let tables = root.tables("records")?;
    if tables.is_empty() {
        return Ok(Vec::new());
    }
    if plugin.kind != PluginKind::Compiled {
        return Err(root.bad(
            "records",
            "is for compiled plugins only in protocol 1: a declared kind's standing rests on the plugin's code running in the host's process (D162)",
        ));
    }
    if !RECORD_GRANTS
        .iter()
        .all(|name| grants.iter().any(|grant| grant.name == *name))
    {
        return Err(root.bad(
            "records",
            "needs the grants records and records_write declared in [[grants]]",
        ));
    }
    if tables.len() > MAX_RECORD_KINDS {
        return Err(root.bad(
            "records",
            format!(
                "declares {} kinds; a manifest declares at most {MAX_RECORD_KINDS}",
                tables.len()
            ),
        ));
    }
    let mut declared: Vec<RecordDecl> = Vec::new();
    for table in &tables {
        let record = record(table)?;
        if declared.iter().any(|other| other.kind == record.kind) {
            return Err(table.bad("kind", format!("`{}` is declared twice", record.kind)));
        }
        declared.push(record);
    }
    Ok(declared)
}

/// One `[[records]]` entry.
fn record(table: &Tbl<'_>) -> Result<RecordDecl, PluginError> {
    table.check_keys(RECORD_KEYS, &[])?;
    let kind = table.required_string("kind")?;
    if !umbel_store::is_slug(&kind) {
        return Err(table.bad("kind", "must match ^[a-z][a-z0-9-]{0,62}$"));
    }
    let standing = table.boolean("standing")?.unwrap_or(false);
    let text = pointers(table, "text", MAX_TEXT_POINTERS)?;
    let keys = pointers(table, "keys", MAX_KEY_POINTERS)?;
    if let Some(both) = keys.iter().find(|key| text.contains(key)) {
        return Err(table.bad(
            "keys",
            format!("names `{both}`, which is a text pointer: a pointer is a text or a key"),
        ));
    }
    let matched = match table.string("match")? {
        None => None,
        Some(pointer) => {
            let pointer = Pointer::parse(&pointer)
                .map_err(|_| table.bad("match", format!("`{pointer}` {POINTER_RULE}")))?;
            let index = text.iter().position(|text| *text == pointer).ok_or_else(|| {
                table.bad(
                    "match",
                    format!("names `{pointer}`, which must be one of text: the match field is a text pointer"),
                )
            })?;
            Some(index)
        }
    };
    if standing && text.is_empty() {
        return Err(table.bad(
            "standing",
            "needs at least one text pointer: a standing record's wording is the values at its text pointers",
        ));
    }
    let entry = |problem: String| PluginError::manifest_invalid(table.file, &table.path, problem);
    if text.is_empty() && keys.is_empty() {
        return Err(entry(
            "declares nothing: give text, keys or standing".to_owned(),
        ));
    }
    let declared = RecordDecl {
        kind,
        standing,
        text,
        keys,
        matched,
    };
    // Every rule above is one of `RecordDecl::check`'s; it is the store's own gate, run again so
    // that a manifest the host reads is one every backend accepts.
    declared
        .check()
        .map_err(|problem| entry(format!("is not a declaration the store accepts: {problem}")))?;
    Ok(declared)
}

/// The pointers at `key`: at most `most`, distinct.
fn pointers(table: &Tbl<'_>, key: &str, most: usize) -> Result<Vec<Pointer>, PluginError> {
    let entries = table.string_array(key)?.unwrap_or_default();
    if entries.len() > most {
        return Err(table.bad(
            key,
            format!("names {} pointers; at most {most}", entries.len()),
        ));
    }
    let mut pointers: Vec<Pointer> = Vec::with_capacity(entries.len());
    for entry in &entries {
        let pointer = Pointer::parse(entry)
            .map_err(|_| table.bad(key, format!("entry `{entry}` {POINTER_RULE}")))?;
        if pointers.contains(&pointer) {
            return Err(table.bad(key, format!("names `{entry}` twice")));
        }
        pointers.push(pointer);
    }
    Ok(pointers)
}

impl Manifest {
    /// Section 2's last rule: a plugin that declares a record kind gives every command and
    /// pipeline a `journal` mode, as a plugin holding a memory grant does (D72), because a
    /// record's text must not reach the journal unless the plugin chose `plain` for that call.
    pub(super) fn check_record_rules(&self) -> Result<(), PluginError> {
        if self.records.is_empty() {
            return Ok(());
        }
        let missing = |key: String| {
            PluginError::manifest_invalid(
                &self.file,
                &key,
                "is required: a plugin that declares a record kind declares journal = { mode = \"digest\" } or { mode = \"plain\" } on every command and pipeline".to_owned(),
            )
        };
        if let Some(index) = self.commands.iter().position(|c| c.journal.is_none()) {
            return Err(missing(format!("commands[{index}].journal")));
        }
        if let Some(index) = self.pipelines.iter().position(|p| p.journal.is_none()) {
            return Err(missing(format!("pipelines[{index}].journal")));
        }
        Ok(())
    }
}
