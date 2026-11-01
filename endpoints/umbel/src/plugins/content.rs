//! The `content` and `content_write` grants (phase 2 specification, section 3.3): the files of a
//! space's collection roots, confined to each root.
//!
//! Reads list and open files under a root, never following a symbolic link inside it, at most
//! `max_file_bytes` per file and 64 MiB per call. A write replaces or creates one file by writing
//! a temporary file in the same directory, syncing it and renaming it over the target, after
//! checking an expected content hash. The check and the rename are not atomic against a writer
//! outside Umbel; Umbel's own writers are serialised by the document store's compare-and-set.
//! A hard link in the root is replaced by the rename, not written through.

use std::fs::{self, File};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use umbel_sdk::{ContentEntry, HostError as ServiceError};
use umbel_store::{ContentHash, Expect, Page};

use super::grants::CallServices;
use crate::workspace::{CollectionConfig, CollectionKind, resolve_root};

type Result<T> = std::result::Result<T, ServiceError>;

/// The most file bytes one call reads.
const MAX_CONTENT_READ_BYTES: u64 = 64 * 1024 * 1024;
/// The most entries one `content_list` page holds.
const MAX_LIST: u32 = 1000;

fn io(error: &std::io::Error, what: &Path) -> ServiceError {
    ServiceError::Io(format!("{}: {error}", what.display()))
}

/// Why `path` cannot name a file inside a root, if it cannot.
fn path_problem(path: &str) -> Option<&'static str> {
    if path.is_empty() {
        Some("is empty")
    } else if path.starts_with('/') || path.contains('\\') {
        Some("must be relative with `/` separators")
    } else if path.chars().any(char::is_control) {
        Some("holds a control character")
    } else if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        Some("must not hold an empty, `.` or `..` segment")
    } else {
        None
    }
}

impl CallServices {
    /// The collection `collection` of `space`, and its canonical root.
    fn collection(&self, space: &str, collection: &str) -> Result<(&CollectionConfig, PathBuf)> {
        let config = self.shared.workspace.config();
        let declared = config
            .spaces
            .iter()
            .find(|declared| declared.id.as_str() == space)
            .and_then(|declared| declared.collections.iter().find(|c| c.id == collection))
            .ok_or_else(|| {
                ServiceError::NotFound(format!(
                    "the space `{space}` declares no collection `{collection}`"
                ))
            })?;
        let root = resolve_root(self.shared.workspace.root(), &declared.root).map_err(|_| {
            ServiceError::NotFound(format!(
                "the root `{}` of collection `{collection}` is missing, not a directory or outside the workspace",
                declared.root
            ))
        })?;
        Ok((declared, root))
    }

    pub(super) fn svc_content_list(
        &self,
        space: &str,
        collection: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<ContentEntry>> {
        self.content_scope("content", space)?;
        if !(1..=MAX_LIST).contains(&limit) {
            return Err(ServiceError::Invalid(format!(
                "limit must be from 1 to {MAX_LIST}"
            )));
        }
        let (_config, root) = self.collection(space, collection)?;
        let mut found = Vec::new();
        walk(
            &root,
            "",
            after,
            usize::try_from(limit).unwrap_or(1000) + 1,
            &mut found,
        )?;
        let next = (found.len() > usize::try_from(limit).unwrap_or(1000))
            .then(|| {
                found
                    .get(found.len() - 2)
                    .map(|e: &ContentEntry| e.path.clone())
            })
            .flatten();
        found.truncate(usize::try_from(limit).unwrap_or(1000));
        Ok(Page { items: found, next })
    }

    pub(super) fn svc_content_read(
        &self,
        space: &str,
        collection: &str,
        path: &str,
    ) -> Result<Vec<u8>> {
        self.content_scope("content", space)?;
        let (config, root) = self.collection(space, collection)?;
        if let Some(problem) = path_problem(path) {
            return Err(ServiceError::Invalid(format!(
                "the path `{path}` {problem}"
            )));
        }
        let file = confined(&root, path, true)?;
        let meta = fs::symlink_metadata(&file).map_err(|error| match error.kind() {
            ErrorKind::NotFound => {
                ServiceError::NotFound(format!("`{collection}` holds no file `{path}`"))
            }
            _ => io(&error, &file),
        })?;
        if !meta.is_file() {
            return Err(ServiceError::NotFound(format!(
                "`{path}` is not a regular file of `{collection}`"
            )));
        }
        if meta.len() > config.max_file_bytes {
            return Err(ServiceError::TooLarge(format!(
                "`{path}` is {} bytes; the collection's max_file_bytes is {}",
                meta.len(),
                config.max_file_bytes
            )));
        }
        let total = self.content_bytes.fetch_add(meta.len(), Ordering::Relaxed) + meta.len();
        if total > MAX_CONTENT_READ_BYTES {
            return Err(ServiceError::TooLarge(format!(
                "a call may read at most {MAX_CONTENT_READ_BYTES} bytes of files"
            )));
        }
        let mut bytes = Vec::with_capacity(usize::try_from(meta.len()).unwrap_or(0));
        File::open(&file)
            .and_then(|mut f| f.read_to_end(&mut bytes))
            .map_err(|error| io(&error, &file))?;
        Ok(bytes)
    }

    pub(super) fn svc_content_replace(
        &self,
        space: &str,
        collection: &str,
        path: &str,
        bytes: &[u8],
        expect: Expect,
    ) -> Result<ContentHash> {
        self.content_write_scope(space, collection)?;
        let (config, root) = self.collection(space, collection)?;
        if let Some(problem) = path_problem(path) {
            return Err(ServiceError::Invalid(format!(
                "the path `{path}` {problem}"
            )));
        }
        let name = path.rsplit('/').next().unwrap_or(path);
        if matches!(name, "index.md" | "log.md") {
            return Err(ServiceError::Invalid(format!(
                "`{name}` is reserved by the container format and is never written"
            )));
        }
        if config.kind == CollectionKind::Markdown && !name.ends_with(".md") {
            return Err(ServiceError::Invalid(
                "a markdown collection holds only .md files".to_owned(),
            ));
        }
        if bytes.len() as u64 > config.max_file_bytes {
            return Err(ServiceError::TooLarge(format!(
                "{} bytes exceed the collection's max_file_bytes of {}",
                bytes.len(),
                config.max_file_bytes
            )));
        }
        let target = confined(&root, path, false)?;
        let current = match fs::symlink_metadata(&target) {
            Ok(meta) if meta.is_file() => Some(
                fs::read(&target)
                    .map(|existing| ContentHash::of(&existing))
                    .map_err(|error| io(&error, &target))?,
            ),
            Ok(_) => {
                return Err(ServiceError::Invalid(format!(
                    "`{path}` exists and is not a regular file; it is never replaced"
                )));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(io(&error, &target)),
        };
        let conflict = |current: &Option<ContentHash>| ServiceError::Conflict {
            current: current.as_ref().map(ToString::to_string),
        };
        match &expect {
            Expect::Any => {}
            Expect::Absent if current.is_some() => return Err(conflict(&current)),
            Expect::Absent => {}
            Expect::Hash(hash) if current.as_ref() != Some(hash) => return Err(conflict(&current)),
            Expect::Hash(_) => {}
        }
        let parent = target.parent().unwrap_or(&root);
        fs::create_dir_all(parent).map_err(|error| io(&error, parent))?;
        // A directory just created must still be inside the root (no symlink raced in).
        confined(&root, path, false)?;
        let temporary = parent.join(format!(".umbel-write-{}", crate::host::new_trace_id()));
        let written = (|| {
            let mut file = File::create(&temporary)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &target)
        })();
        if let Err(error) = written {
            let _ = fs::remove_file(&temporary);
            return Err(io(&error, &target));
        }
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(ContentHash::of(bytes))
    }
}

/// The file `path` under `root`, with every existing component checked not to be a symbolic
/// link (`must_exist` says whether a missing one is an error here; the caller decides).
fn confined(root: &Path, path: &str, _must_exist: bool) -> Result<PathBuf> {
    let mut at = root.to_path_buf();
    for part in path.split('/') {
        at.push(part);
        match fs::symlink_metadata(&at) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(ServiceError::Invalid(format!(
                    "`{path}` passes through a symbolic link; links inside a root are not followed"
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io(&error, &at)),
        }
    }
    Ok(at)
}

/// Walk `dir` (relative path `prefix`) in global path order, collecting regular files after
/// `after`, at most `want`. Symbolic links are skipped; so are paths that are not valid UTF-8.
fn walk(
    dir: &Path,
    prefix: &str,
    after: Option<&str>,
    want: usize,
    found: &mut Vec<ContentEntry>,
) -> Result<()> {
    let mut entries: Vec<(String, bool, PathBuf, fs::Metadata)> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| io(&error, dir))? {
        let entry = entry.map_err(|error| io(&error, dir))?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() || meta.is_file() {
            entries.push((name, meta.is_dir(), entry.path(), meta));
        }
    }
    // A directory sorts as `name/`, so the walk visits paths in plain string order.
    entries.sort_by(|a, b| {
        let key = |(name, dir, ..): &(String, bool, PathBuf, fs::Metadata)| {
            if *dir {
                format!("{name}/")
            } else {
                name.clone()
            }
        };
        key(a).cmp(&key(b))
    });
    for (name, is_dir, path, meta) in entries {
        if found.len() >= want {
            return Ok(());
        }
        let relative = format!("{prefix}{name}");
        if is_dir {
            let inside = format!("{relative}/");
            if after.is_some_and(|a| a > inside.as_str() && !a.starts_with(&inside)) {
                continue;
            }
            walk(&path, &inside, after, want, found)?;
        } else {
            if after.is_some_and(|a| relative.as_str() <= a) {
                continue;
            }
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0));
            found.push(ContentEntry {
                path: relative,
                size: meta.len(),
                mtime_ms,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_must_stay_relative_and_clean() {
        for bad in ["", "/a", "a\\b", "a//b", "a/./b", "../a", "a/..", "a\nb"] {
            assert!(path_problem(bad).is_some(), "{bad:?}");
        }
        for good in ["a.md", "dir/a.md", ".hidden/x"] {
            assert!(path_problem(good).is_none(), "{good}");
        }
    }

    #[test]
    fn the_walk_is_in_string_order_and_pages() {
        let dir = tempfile::tempdir().unwrap();
        for file in ["a.md", "a/b.md", "a/c.md", "b.md", "z/y/x.md"] {
            let path = dir.path().join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"x").unwrap();
        }
        let list = |after: Option<&str>, want: usize| {
            let mut found = Vec::new();
            walk(dir.path(), "", after, want, &mut found).unwrap();
            found.into_iter().map(|e| e.path).collect::<Vec<_>>()
        };
        assert_eq!(
            list(None, 10),
            ["a.md", "a/b.md", "a/c.md", "b.md", "z/y/x.md"]
        );
        assert_eq!(list(Some("a/b.md"), 2), ["a/c.md", "b.md"]);
        assert_eq!(list(Some("b.md"), 10), ["z/y/x.md"]);
        assert_eq!(list(Some("z/y/x.md"), 10), Vec::<String>::new());
    }
}
