//! `pack.toml`, pack manifest version 1, and the rules a pack directory keeps
//! (specification section 8.2, D46).
//!
//! A pack is a directory with a `pack.toml` and up to three subdirectories: `data/`,
//! `reference/` and `rules/`. A space may hold an override of the same id under
//! `spaces/<space>/packs/<plugin id>/<pack id>/`, which replaces the default whole.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use toml::{Table, Value};

use super::error::PluginError;
use super::files::{DirFiles, PluginFiles};
use super::manifest::PackDecl;
use super::{PACK_VERSION, is_kebab_id, is_plugin_id, is_semver};
use crate::workspace::SpaceId;

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
    check_pack_files(&files, ".", &label, id, plugin)
}

/// The rules of [`check_pack`] over the pack at `root` (`.` for the whole of `files`) in any
/// [`PluginFiles`], so a compiled plugin's embedded pack is checked as a directory is.
pub(crate) fn check_pack_files(
    files: &dyn PluginFiles,
    root: &str,
    label: &str,
    id: &str,
    plugin: &str,
) -> Result<PackReport, PluginError> {
    let bytes = files.read(&join(root, "pack.toml")).map_err(|problem| {
        PluginError::pack_invalid(label, format!("has no readable pack.toml ({problem})"))
    })?;
    let text = String::from_utf8(bytes)
        .map_err(|_| PluginError::pack_invalid(label, "has a pack.toml that is not UTF-8"))?;
    let manifest = PackManifest::parse(&text, label)?;
    if manifest.id != id || manifest.plugin != plugin {
        return Err(PluginError::pack_invalid(
            label,
            format!(
                "declares id `{}` of plugin `{}`, not `{id}` of `{plugin}`",
                manifest.id, manifest.plugin
            ),
        ));
    }
    let names = files
        .list(root)
        .map_err(|problem| PluginError::pack_invalid(label, problem))?;
    for name in &names {
        let top = name.split('/').next().unwrap_or(name);
        let allowed = (name == "pack.toml") || (name.contains('/') && SUBDIRECTORIES.contains(&top));
        if !allowed {
            return Err(PluginError::pack_invalid(
                label,
                format!(
                    "holds `{top}`; a pack holds pack.toml and the directories data, reference and rules"
                ),
            ));
        }
    }
    let count = names.len();
    if count > MAX_PACK_FILES {
        return Err(too_big(label, count, 0));
    }
    let mut size = 0u64;
    for name in &names {
        size += files
            .len(&join(root, name))
            .map_err(|problem| PluginError::pack_invalid(label, problem))?;
    }
    if size > MAX_PACK_BYTES {
        return Err(too_big(label, count, size));
    }
    Ok(PackReport {
        manifest,
        files: count,
        bytes: size,
    })
}

fn too_big(label: &str, count: usize, size: u64) -> PluginError {
    PluginError::pack_invalid(
        label,
        format!(
            "holds {count} files and {size} bytes; the limits are {MAX_PACK_FILES} files and {MAX_PACK_BYTES} bytes"
        ),
    )
}

fn join(root: &str, name: &str) -> String {
    if root == "." {
        name.to_owned()
    } else {
        format!("{}/{name}", root.trim_end_matches('/'))
    }
}

/// Where one effective copy of a pack comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PackOrigin {
    /// The plugin's own pack.
    Default,
    /// The pack directory of the space (D46).
    Override,
}

impl PackOrigin {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Override => "override",
        }
    }
}

/// The files of one effective pack: the plugin's default, or a space's override that replaced it
/// whole. Validated at `seal`; bytes are read when a plugin asks for them.
pub(crate) struct PackCopy {
    pub(crate) origin: PackOrigin,
    pub(crate) version: String,
    pub(crate) files: usize,
    files_source: Arc<dyn PluginFiles + Send + Sync>,
    root: String,
}

impl PackCopy {
    pub(crate) fn list(&self) -> Result<Vec<String>, String> {
        self.files_source.list(&self.root)
    }

    pub(crate) fn len(&self, path: &str) -> Result<u64, String> {
        self.files_source.len(&join(&self.root, path))
    }

    pub(crate) fn read(&self, path: &str) -> Result<Vec<u8>, String> {
        self.files_source.read(&join(&self.root, path))
    }
}

/// How one pack is served, as `plugin-show` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackState {
    pub(crate) space: String,
    pub(crate) origin: PackOrigin,
    pub(crate) version: String,
    pub(crate) files: usize,
}

/// One instance's packs, with the per-space overrides read at `seal` (D46).
pub(crate) struct PackSet {
    entries: BTreeMap<String, Entry>,
    spaces: Vec<SpaceId>,
}

struct Entry {
    default: PackCopy,
    overrides: BTreeMap<SpaceId, PackCopy>,
}

impl PackSet {
    /// Validate the plugin's default packs and, for each of `spaces`, the override under
    /// `<spaces dir>/<space>/packs/<plugin>/<pack>/`. An override replaces the default whole in
    /// its space; files are never merged.
    ///
    /// # Errors
    /// `PACK_INVALID` for a default or an override that breaks a rule of section 8.2.
    pub(crate) fn load(
        spaces_dir: &Path,
        plugin: &str,
        decls: &[PackDecl],
        files: &Arc<dyn PluginFiles + Send + Sync>,
        spaces: &[SpaceId],
    ) -> Result<Self, PluginError> {
        let mut entries = BTreeMap::new();
        for decl in decls {
            let label = format!("pack `{}` of plugin `{plugin}` ({})", decl.id, decl.path);
            let report = check_pack_files(files.as_ref(), &decl.path, &label, &decl.id, plugin)?;
            let default = PackCopy {
                origin: PackOrigin::Default,
                version: report.manifest.version,
                files: report.files,
                files_source: Arc::clone(files),
                root: decl.path.clone(),
            };
            let mut overrides = BTreeMap::new();
            for space in spaces {
                let dir = spaces_dir
                    .join(space.as_str())
                    .join("packs")
                    .join(plugin)
                    .join(&decl.id);
                if !dir.is_dir() {
                    continue;
                }
                let report = check_pack(&dir, &decl.id, plugin)?;
                let source = DirFiles::new(&dir).map_err(|error| {
                    PluginError::pack_invalid(
                        &dir.display().to_string(),
                        format!("cannot be read: {error}"),
                    )
                })?;
                overrides.insert(
                    space.clone(),
                    PackCopy {
                        origin: PackOrigin::Override,
                        version: report.manifest.version,
                        files: report.files,
                        files_source: Arc::new(source),
                        root: ".".to_owned(),
                    },
                );
            }
            entries.insert(decl.id.clone(), Entry { default, overrides });
        }
        Ok(Self {
            entries,
            spaces: spaces.to_vec(),
        })
    }

    /// The ids of the packs, in name order.
    pub(crate) fn ids(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    /// The effective copy of `pack` in `space`: the space's override, else the default.
    pub(crate) fn effective(&self, pack: &str, space: &SpaceId) -> Option<&PackCopy> {
        let entry = self.entries.get(pack)?;
        Some(entry.overrides.get(space).unwrap_or(&entry.default))
    }

    /// Every pack's state in every one of the instance's spaces, for `plugin-show`.
    pub(crate) fn states(&self) -> Vec<(String, Vec<PackState>)> {
        self.entries
            .keys()
            .map(|id| {
                let states = self
                    .spaces
                    .iter()
                    .filter_map(|space| {
                        self.effective(id, space).map(|copy| PackState {
                            space: space.as_str().to_owned(),
                            origin: copy.origin,
                            version: copy.version.clone(),
                            files: copy.files,
                        })
                    })
                    .collect();
                (id.clone(), states)
            })
            .collect()
    }
}
