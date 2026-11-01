//! The files of one plugin, confined to its root.
//!
//! A manifest names schemas, a component, packs and skills by relative path. [`PluginFiles`] is
//! how the loader reads them: [`DirFiles`] over a directory, and [`AssetFiles`] over the assets a
//! compiled plugin embeds. Every path stays inside the root: no `..`, no absolute path,
//! and symlinks are resolved and checked.

use std::fs;
use std::path::{Component, Path, PathBuf};

use umbel_sdk::Asset;

/// Read access to the files of one plugin by relative path.
pub trait PluginFiles {
    /// The bytes of the file at `rel`.
    ///
    /// # Errors
    /// A sentence saying why the path cannot be read: it escapes the root, is missing, or is not
    /// a file.
    fn read(&self, rel: &str) -> Result<Vec<u8>, String>;
    /// The size in bytes of the file at `rel`.
    ///
    /// # Errors
    /// The same sentences as [`read`](Self::read).
    fn len(&self, rel: &str) -> Result<u64, String>;
    /// Whether `rel` is a file inside the root.
    fn is_file(&self, rel: &str) -> bool;
    /// Whether `rel` is a directory inside the root.
    fn is_dir(&self, rel: &str) -> bool;
    /// Every file under the directory `rel`, as paths relative to `rel` with `/` separators, in
    /// byte order.
    ///
    /// # Errors
    /// A sentence saying why `rel` is not a directory inside the root.
    fn list(&self, rel: &str) -> Result<Vec<String>, String>;
}

/// Why `rel` is not a path that stays inside a plugin root, judged by its text alone.
pub(crate) fn lexical_problem(rel: &str) -> Option<&'static str> {
    if rel.is_empty() {
        return Some("is empty");
    }
    if rel.contains('\\') || rel.contains('\0') {
        return Some("must use / separators and no NUL");
    }
    let path = Path::new(rel);
    if path.is_absolute() || rel.starts_with('/') {
        return Some("must be relative to the plugin root, not absolute");
    }
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => return Some("must not contain `..`"),
            Component::RootDir | Component::Prefix(_) => {
                return Some("must be relative to the plugin root, not absolute");
            }
        }
    }
    None
}

/// The files under one directory.
#[derive(Debug, Clone)]
pub struct DirFiles {
    root: PathBuf,
}

impl DirFiles {
    /// The files under `root`, which must exist.
    ///
    /// # Errors
    /// The I/O error of resolving `root`.
    pub fn new(root: impl AsRef<Path>) -> std::io::Result<Self> {
        Ok(Self {
            root: fs::canonicalize(root)?,
        })
    }

    /// The resolved root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        if let Some(problem) = lexical_problem(rel) {
            return Err(format!("`{rel}` {problem}"));
        }
        let resolved = fs::canonicalize(self.root.join(rel))
            .map_err(|error| format!("`{rel}` cannot be read: {error}"))?;
        if resolved.starts_with(&self.root) {
            Ok(resolved)
        } else {
            Err(format!("`{rel}` leaves the plugin root through a symlink"))
        }
    }

    /// The number of files and their total bytes under the directory `rel`.
    ///
    /// # Errors
    /// A sentence when `rel` is not a directory in the root or a symlink inside it leaves it.
    pub fn tree(&self, rel: &str) -> Result<(usize, u64), String> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() {
            return Err(format!("`{rel}` is not a directory"));
        }
        let mut totals = (0usize, 0u64);
        self.walk(&dir, &mut totals)?;
        Ok(totals)
    }

    fn walk(&self, dir: &Path, totals: &mut (usize, u64)) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let resolved =
                fs::canonicalize(&path).map_err(|error| format!("{}: {error}", path.display()))?;
            if !resolved.starts_with(&self.root) {
                return Err(format!(
                    "{} leaves the plugin root through a symlink",
                    path.display()
                ));
            }
            if entry.file_name().to_str().is_none() {
                return Err(format!("{} is not a UTF-8 file name", path.display()));
            }
            if resolved.is_dir() {
                self.walk(&resolved, totals)?;
            } else {
                totals.0 += 1;
                totals.1 += fs::metadata(&resolved).map_or(0, |meta| meta.len());
            }
        }
        Ok(())
    }
}

impl PluginFiles for DirFiles {
    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        let path = self.resolve(rel)?;
        if !path.is_file() {
            return Err(format!("`{rel}` is not a file"));
        }
        fs::read(&path).map_err(|error| format!("`{rel}` cannot be read: {error}"))
    }

    fn len(&self, rel: &str) -> Result<u64, String> {
        let path = self.resolve(rel)?;
        if !path.is_file() {
            return Err(format!("`{rel}` is not a file"));
        }
        fs::metadata(&path)
            .map(|meta| meta.len())
            .map_err(|error| format!("`{rel}` cannot be read: {error}"))
    }

    fn is_file(&self, rel: &str) -> bool {
        self.resolve(rel).is_ok_and(|path| path.is_file())
    }

    fn is_dir(&self, rel: &str) -> bool {
        self.resolve(rel).is_ok_and(|path| path.is_dir())
    }

    fn list(&self, rel: &str) -> Result<Vec<String>, String> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() {
            return Err(format!("`{rel}` is not a directory"));
        }
        let mut names = Vec::new();
        self.collect(&dir, &dir, &mut names)?;
        names.sort();
        Ok(names)
    }
}

impl DirFiles {
    fn collect(&self, base: &Path, dir: &Path, names: &mut Vec<String>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        for entry in entries.flatten() {
            let resolved = fs::canonicalize(entry.path())
                .map_err(|error| format!("{}: {error}", entry.path().display()))?;
            if !resolved.starts_with(&self.root) {
                return Err(format!(
                    "{} leaves the plugin root through a symlink",
                    entry.path().display()
                ));
            }
            if resolved.is_dir() {
                self.collect(base, &resolved, names)?;
            } else if let Ok(relative) = resolved.strip_prefix(base) {
                let text = relative
                    .components()
                    .map(|part| part.as_os_str().to_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()
                    .ok_or_else(|| format!("{} is not a UTF-8 file name", resolved.display()))?;
                names.push(text.join("/"));
            }
        }
        Ok(())
    }
}

/// The files a compiled plugin embeds (`Plugin::assets`, `CompiledPlugin::assets`), by relative
/// path.
#[derive(Debug, Clone, Copy)]
pub struct AssetFiles {
    assets: &'static [Asset],
}

impl AssetFiles {
    /// The files of `assets`.
    pub fn new(assets: &'static [Asset]) -> Self {
        Self { assets }
    }

    /// The asset at `rel`, after the lexical rules and with a leading `./` ignored.
    fn find(&self, rel: &str) -> Result<&'static Asset, String> {
        if let Some(problem) = lexical_problem(rel) {
            return Err(format!("`{rel}` {problem}"));
        }
        let wanted = normalize(rel);
        self.assets
            .iter()
            .find(|asset| asset.path == wanted)
            .ok_or_else(|| format!("`{rel}` is not among the plugin's embedded files"))
    }
}

/// `rel` without `.` segments and a trailing `/`.
fn normalize(rel: &str) -> String {
    rel.split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}

impl PluginFiles for AssetFiles {
    fn read(&self, rel: &str) -> Result<Vec<u8>, String> {
        self.find(rel).map(|asset| asset.bytes.to_vec())
    }

    fn len(&self, rel: &str) -> Result<u64, String> {
        self.find(rel).map(|asset| asset.bytes.len() as u64)
    }

    fn is_file(&self, rel: &str) -> bool {
        self.find(rel).is_ok()
    }

    fn is_dir(&self, rel: &str) -> bool {
        if lexical_problem(rel).is_some() {
            return false;
        }
        let prefix = format!("{}/", normalize(rel));
        self.assets
            .iter()
            .any(|asset| asset.path.starts_with(&prefix))
    }

    fn list(&self, rel: &str) -> Result<Vec<String>, String> {
        if let Some(problem) = lexical_problem(rel) {
            return Err(format!("`{rel}` {problem}"));
        }
        let prefix = format!("{}/", normalize(rel));
        let mut names: Vec<String> = self
            .assets
            .iter()
            .filter_map(|asset| asset.path.strip_prefix(&prefix).map(str::to_owned))
            .collect();
        if names.is_empty() {
            return Err(format!(
                "`{rel}` is not a directory among the embedded files"
            ));
        }
        names.sort();
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static ASSETS: &[Asset] = &[
        Asset {
            path: "packs/greetings/pack.toml",
            bytes: b"x",
        },
        Asset {
            path: "packs/greetings/data/salutation.txt",
            bytes: b"Hello",
        },
        Asset {
            path: "schemas/a.json",
            bytes: b"{}",
        },
    ];

    #[test]
    fn embedded_files_follow_the_directory_rules() {
        let files = AssetFiles::new(ASSETS);
        assert_eq!(files.read("./schemas/a.json").unwrap(), b"{}");
        assert_eq!(files.len("packs/greetings/data/salutation.txt").unwrap(), 5);
        assert!(files.is_file("schemas/a.json"));
        assert!(!files.is_file("schemas"));
        assert!(files.is_dir("packs/greetings"));
        assert!(files.is_dir("packs/greetings/"));
        assert!(!files.is_dir("packs/other"));
        assert!(files.read("../x").is_err());
        assert_eq!(
            files.list("packs/greetings").unwrap(),
            ["data/salutation.txt", "pack.toml"]
        );
        assert!(files.list("nope").is_err());
    }

    #[test]
    fn lexical_rules() {
        for ok in ["a", "a/b.json", "./a", "schemas/x.input.json"] {
            assert_eq!(lexical_problem(ok), None, "{ok}");
        }
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a\\b", "C:/x"] {
            // `C:/x` is a plain relative name on Unix; it is refused on Windows.
            if bad == "C:/x" && !cfg!(windows) {
                continue;
            }
            assert!(lexical_problem(bad).is_some(), "{bad}");
        }
    }
}
