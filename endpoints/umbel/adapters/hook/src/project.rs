//! The default `project` (section 10.2): the repository's name, read from the files with no `git`
//! process. Walking up from `cwd` to `.git`: a directory means its parent's name; a file (a git
//! worktree) means following `gitdir:` to the common directory through its `commondir` file, then
//! that directory's parent's name, so every worktree of one repository shares one label. No
//! repository means `None`. Only the label leaves the hook: no `cwd` or path is ever sent.

use std::path::{Component, Path, PathBuf};

/// The most bytes read of a `.git` or `commondir` file.
const MAX_POINTER_BYTES: u64 = 4096;

/// The project label for `cwd`, sanitised to `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
pub(crate) fn of(cwd: &Path) -> Option<String> {
    for dir in cwd.ancestors() {
        let git = dir.join(".git");
        let Ok(meta) = std::fs::metadata(&git) else {
            continue;
        };
        let root = if meta.is_dir() {
            Some(dir.to_path_buf())
        } else if meta.is_file() {
            Some(worktree_root(dir, &git).unwrap_or_else(|| dir.to_path_buf()))
        } else {
            None
        };
        return root.and_then(|root| {
            root.file_name()
                .and_then(|name| sanitise(&name.to_string_lossy()))
        });
    }
    None
}

fn read_pointer(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut text = String::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_POINTER_BYTES)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

/// The common directory's parent: the main checkout of a worktree. `None` when the `.git` file
/// names no `gitdir:` or its directory has no `commondir` (a submodule, say).
fn worktree_root(dir: &Path, git_file: &Path) -> Option<PathBuf> {
    let text = read_pointer(git_file)?;
    let gitdir = text
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:"))
        .map(str::trim)
        .filter(|path| !path.is_empty())?;
    let gitdir = dir.join(gitdir);
    let common = read_pointer(&gitdir.join("commondir"))?;
    let common = gitdir.join(common.trim());
    let common = std::fs::canonicalize(&common).unwrap_or_else(|_| normalise(&common));
    common.parent().map(Path::to_path_buf)
}

/// `a/b/../c` as `a/c`, for a path that cannot be canonicalised.
fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// A name as a label: other characters become `-`, a leading character that is not a letter or a
/// digit is dropped, and at most 128 characters are kept.
pub(crate) fn sanitise(name: &str) -> Option<String> {
    let mapped: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let label: String = mapped
        .trim_start_matches(|c: char| !c.is_ascii_alphanumeric())
        .chars()
        .take(128)
        .collect();
    (!label.is_empty()).then_some(label)
}

/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`: a session or project label (section 3.1).
pub(crate) fn is_label(text: &str) -> bool {
    let bytes = text.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::{is_label, sanitise};

    #[test]
    fn names_become_labels() {
        assert_eq!(sanitise("afd").as_deref(), Some("afd"));
        assert_eq!(sanitise("my repo!").as_deref(), Some("my-repo-"));
        assert_eq!(sanitise(".hidden").as_deref(), Some("hidden"));
        assert_eq!(sanitise("..."), None);
        assert_eq!(sanitise(&"x".repeat(300)).map(|l| l.len()), Some(128));
        assert!(is_label("0b0d3f6e-1c2a-4f00-9a51-6b2d7c1e9f00"));
        assert!(!is_label("../etc"));
        assert!(!is_label(""));
    }
}
