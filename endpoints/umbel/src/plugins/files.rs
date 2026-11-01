//! The files of one plugin, confined to its root.
//!
//! A manifest names schemas, a component, packs and skills by relative path. [`PluginFiles`] is
//! how the loader reads them: [`DirFiles`] over a directory, and (in a later step) over the
//! assets a compiled plugin embeds. Every path stays inside the root: no `..`, no absolute path,
//! and symlinks are resolved and checked.

use std::fs;
use std::path::{Component, Path, PathBuf};

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
}

#[cfg(test)]
mod tests {
    use super::*;

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
