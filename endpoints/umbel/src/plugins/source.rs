//! Where a plugin instance's code and manifest come from (specification section 9.1,
//! "Sources").
//!
//! `compiled:<id>` names a plugin the host binary was built with; any other value is a relative
//! path to a directory inside the workspace that holds `umbel-plugin.toml`. With no `source`,
//! the host uses `compiled:<instance id>` when the binary has it and `plugins/<instance id>`
//! when that directory exists.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::error::PluginError;
use super::files::lexical_problem;
use super::{MANIFEST_FILE, is_plugin_id};

/// The `source` of an instance, parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceSpec {
    /// `compiled:<id>`.
    Compiled(String),
    /// A directory, relative to the workspace root.
    Directory(String),
}

impl SourceSpec {
    /// Parse the text of `plugins.<id>.source`.
    ///
    /// # Errors
    /// A sentence saying why the text is neither `compiled:<id>` nor a relative path that stays
    /// inside the workspace.
    pub fn parse(text: &str) -> Result<Self, String> {
        if let Some(id) = text.strip_prefix("compiled:") {
            if is_plugin_id(id) {
                return Ok(Self::Compiled(id.to_owned()));
            }
            return Err(
                "names `compiled:<id>` with an id that does not match ^[a-z][a-z0-9]{0,31}$"
                    .to_owned(),
            );
        }
        match lexical_problem(text) {
            None => Ok(Self::Directory(text.to_owned())),
            Some(problem) => Err(format!(
                "must be `compiled:<id>` or a relative directory inside the workspace, and `{text}` {problem}"
            )),
        }
    }
}

/// The compiled plugins a host binary was built with, by plugin id, each with the text of its
/// embedded manifest. The binary's `configure` hook fills it (a later step); a library call on
/// a bare workspace has none.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompiledCatalog {
    manifests: BTreeMap<String, String>,
}

impl CompiledCatalog {
    /// An empty catalog: a binary built with no compiled plugin.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add the compiled plugin `id` with its embedded manifest.
    #[must_use]
    pub fn with(mut self, id: impl Into<String>, manifest: impl Into<String>) -> Self {
        self.manifests.insert(id.into(), manifest.into());
        self
    }

    /// Whether the binary has the plugin `id`.
    pub fn contains(&self, id: &str) -> bool {
        self.manifests.contains_key(id)
    }

    /// The embedded manifest of `id`.
    pub fn manifest(&self, id: &str) -> Option<&str> {
        self.manifests.get(id).map(String::as_str)
    }
}

/// Where an instance's manifest was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSource {
    /// A plugin in the binary's catalog, with its embedded manifest.
    Compiled {
        /// The compiled plugin id.
        id: String,
        /// The text of its manifest.
        manifest: String,
    },
    /// A plugin directory inside the workspace.
    Directory {
        /// The directory, resolved.
        dir: PathBuf,
    },
    /// A compiled source with no catalog to check it against: the file-only checks `skip` it.
    Unresolved {
        /// The compiled plugin id.
        id: String,
    },
}

/// Resolve the source of the instance `instance`.
///
/// `explicit` is `plugins.<instance>.source`; `catalog` is the binary's compiled plugins, or
/// `None` where there is no binary to ask (a doctor run on a bare workspace).
///
/// # Errors
/// `PLUGIN_NOT_FOUND` when nothing resolves; `PLUGIN_CONFLICT` when both defaults exist;
/// `PLUGIN_CONFIG_INVALID` when `source` is malformed or a symlink leaves the workspace.
pub fn resolve_source(
    root: &Path,
    instance: &str,
    explicit: Option<&str>,
    catalog: Option<&CompiledCatalog>,
) -> Result<ResolvedSource, PluginError> {
    let spec = match explicit {
        Some(text) => SourceSpec::parse(text)
            .map_err(|problem| PluginError::config_invalid(instance, "source", problem))?,
        None => {
            let default_dir = format!("plugins/{instance}");
            let has_dir = root.join(&default_dir).is_dir();
            match catalog {
                Some(catalog) if catalog.contains(instance) && has_dir => {
                    return Err(PluginError::conflict(format!(
                        "plugins.{instance}: both compiled:{instance} (in this binary) and {default_dir}/ exist; set plugins.{instance}.source to choose one"
                    )));
                }
                Some(catalog) if catalog.contains(instance) => {
                    SourceSpec::Compiled(instance.to_owned())
                }
                None if !has_dir => {
                    return Ok(ResolvedSource::Unresolved {
                        id: instance.to_owned(),
                    });
                }
                _ if has_dir => SourceSpec::Directory(default_dir),
                _ => {
                    return Err(PluginError::not_found(
                        instance,
                        format!(
                            "no source: this binary has no compiled plugin `{instance}` and {default_dir}/ does not exist"
                        ),
                    ));
                }
            }
        }
    };
    match spec {
        SourceSpec::Compiled(id) => match catalog {
            None => Ok(ResolvedSource::Unresolved { id }),
            Some(catalog) => catalog
                .manifest(&id)
                .map(|manifest| ResolvedSource::Compiled {
                    id: id.clone(),
                    manifest: manifest.to_owned(),
                })
                .ok_or_else(|| {
                    PluginError::not_found(
                        instance,
                        format!("compiled:{id} is not a plugin this binary was built with"),
                    )
                }),
        },
        SourceSpec::Directory(rel) => directory(root, instance, &rel),
    }
}

fn directory(root: &Path, instance: &str, rel: &str) -> Result<ResolvedSource, PluginError> {
    let not_found = |why: String| PluginError::not_found(instance, why);
    let workspace = fs::canonicalize(root).map_err(|error| {
        not_found(format!(
            "the workspace {} cannot be read: {error}",
            root.display()
        ))
    })?;
    let dir = fs::canonicalize(workspace.join(rel)).map_err(|_| {
        not_found(format!(
            "the directory `{rel}` does not exist in the workspace"
        ))
    })?;
    if !dir.starts_with(&workspace) {
        return Err(PluginError::config_invalid(
            instance,
            "source",
            format!("`{rel}` leaves the workspace through a symlink"),
        ));
    }
    if !dir.is_dir() {
        return Err(not_found(format!("`{rel}` is not a directory")));
    }
    if !dir.join(MANIFEST_FILE).is_file() {
        return Err(not_found(format!("`{rel}` holds no {MANIFEST_FILE}")));
    }
    Ok(ResolvedSource::Directory { dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specs_parse() {
        assert_eq!(
            SourceSpec::parse("compiled:hello"),
            Ok(SourceSpec::Compiled("hello".into()))
        );
        assert_eq!(
            SourceSpec::parse("plugins/tickets"),
            Ok(SourceSpec::Directory("plugins/tickets".into()))
        );
        for bad in ["compiled:", "compiled:Hello", "../x", "/abs", ""] {
            assert!(SourceSpec::parse(bad).is_err(), "{bad}");
        }
    }
}
