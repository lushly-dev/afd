//! `pack.toml`, pack manifest version 1, and the rules a pack directory keeps
//! (specification section 8.2, D46).
//!
//! A pack is a directory with a `pack.toml` and up to three subdirectories: `data/`,
//! `reference/` and `rules/`. A space may hold an override of the same id under
//! `spaces/<space>/packs/<plugin id>/<pack id>/`, which replaces the default whole.

use std::fs;
use std::path::Path;

use toml::{Table, Value};

use super::error::PluginError;
use super::files::{DirFiles, PluginFiles};
use super::{PACK_VERSION, is_kebab_id, is_plugin_id, is_semver};

const KEYS: &[&str] = &[
    "pack_version",
    "id",
    "plugin",
    "version",
    "title",
    "description",
];
const SUBDIRECTORIES: &[&str] = &["data", "reference", "rules"];
/// At most this many files in one pack.
pub const MAX_PACK_FILES: usize = 1000;
/// At most this many bytes in one pack.
pub const MAX_PACK_BYTES: u64 = 64 * 1024 * 1024;

/// A validated `pack.toml`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PackManifest {
    /// The pack id; equals the plugin manifest's `[[packs]]` id.
    pub id: String,
    /// The plugin id.
    pub plugin: String,
    /// The pack's semantic version; an override's is the deployer's.
    pub version: String,
    /// The display title.
    pub title: String,
    /// What the pack holds.
    pub description: String,
}

/// What a valid pack holds.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct PackReport {
    /// The pack's `pack.toml`.
    pub manifest: PackManifest,
    /// How many files it holds, `pack.toml` included.
    pub files: usize,
    /// Their total size.
    pub bytes: u64,
}

impl PackManifest {
    /// Validate the text of a `pack.toml`; `label` names the file in messages.
    ///
    /// # Errors
    /// `PACK_INVALID` naming the key.
    pub fn parse(text: &str, label: &str) -> Result<Self, PluginError> {
        let bad = |key: &str, problem: &str| {
            PluginError::pack_invalid(label, format!("has `{key}` that {problem}"))
        };
        let table: Table = text.parse().map_err(|error: toml::de::Error| {
            PluginError::pack_invalid(
                label,
                format!("has pack.toml that is not valid TOML: {}", error.message()),
            )
        })?;
        for key in table.keys() {
            if !KEYS.contains(&key.as_str()) {
                return Err(bad(key, "is not a known key"));
            }
        }
        match table.get("pack_version") {
            Some(Value::Integer(value)) if *value == i64::from(PACK_VERSION) => {}
            _ => return Err(bad("pack_version", "must be the integer 1")),
        }
        let string = |key: &str| match table.get(key) {
            Some(Value::String(value)) => Ok(value.clone()),
            _ => Err(bad(key, "is required and must be a string")),
        };
        let id = string("id")?;
        if !is_kebab_id(&id, 63) {
            return Err(bad("id", "must match ^[a-z][a-z0-9-]{0,62}$"));
        }
        let plugin = string("plugin")?;
        if !is_plugin_id(&plugin) {
            return Err(bad("plugin", "must be a plugin id"));
        }
        let version = string("version")?;
        if !is_semver(&version) {
            return Err(bad("version", "must be a semantic version such as 1.0.0"));
        }
        let title = string("title")?;
        let description = string("description")?;
        if !(1..=80).contains(&title.chars().count()) {
            return Err(bad("title", "must be 1 to 80 characters"));
        }
        if !(1..=500).contains(&description.chars().count()) {
            return Err(bad("description", "must be 1 to 500 characters"));
        }
        Ok(Self {
            id,
            plugin,
            version,
            title,
            description,
        })
    }
}

/// Check the pack directory `dir`: its `pack.toml` is valid and names `id` and `plugin`, it
/// holds only `pack.toml` and the three subdirectories, no symlink leaves it, and it is within
/// the limits.
///
/// # Errors
/// `PACK_INVALID` naming the pack's path.
pub fn check_pack(dir: &Path, id: &str, plugin: &str) -> Result<PackReport, PluginError> {
    let label = dir.display().to_string();
    let files = DirFiles::new(dir)
        .map_err(|error| PluginError::pack_invalid(&label, format!("cannot be read: {error}")))?;
    let bytes = files.read("pack.toml").map_err(|problem| {
        PluginError::pack_invalid(&label, format!("has no readable pack.toml ({problem})"))
    })?;
    let text = String::from_utf8(bytes)
        .map_err(|_| PluginError::pack_invalid(&label, "has a pack.toml that is not UTF-8"))?;
    let manifest = PackManifest::parse(&text, &label)?;
    if manifest.id != id || manifest.plugin != plugin {
        return Err(PluginError::pack_invalid(
            &label,
            format!(
                "declares id `{}` of plugin `{}`, not `{id}` of `{plugin}`",
                manifest.id, manifest.plugin
            ),
        ));
    }
    let entries = fs::read_dir(dir)
        .map_err(|error| PluginError::pack_invalid(&label, format!("cannot be read: {error}")))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.path().is_dir();
        let allowed =
            (name == "pack.toml" && !is_dir) || (is_dir && SUBDIRECTORIES.contains(&name.as_str()));
        if !allowed {
            return Err(PluginError::pack_invalid(
                &label,
                format!(
                    "holds `{name}`; a pack holds pack.toml and the directories data, reference and rules"
                ),
            ));
        }
    }
    let (count, size) = files
        .tree(".")
        .map_err(|problem| PluginError::pack_invalid(&label, problem))?;
    if count > MAX_PACK_FILES || size > MAX_PACK_BYTES {
        return Err(PluginError::pack_invalid(
            &label,
            format!(
                "holds {count} files and {size} bytes; the limits are {MAX_PACK_FILES} files and {MAX_PACK_BYTES} bytes"
            ),
        ));
    }
    Ok(PackReport {
        manifest,
        files: count,
        bytes: size,
    })
}
