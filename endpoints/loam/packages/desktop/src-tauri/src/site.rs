//! The `loam` and `loam-sandbox` custom protocols (phase 6 specification, 10.2). Both read one site: the
//! deployer's `<app data>/site` when it holds an `index.html`, else the empty shell bundled in the binary.
//! A path resolves with `canonicalize` inside the site's directory, so no path, encoded or through a
//! symbolic link, reaches `mounts.json` or anything else beside the site. The headers enforce Loam's fixed
//! desktop CSP ceiling (refusing any widened `<meta>` policy on disk and emitting the Rust-constructed
//! canonical desktop header plus `frame-ancestors 'none'`), keep the sandbox's pages framed only by the
//! shell, and serve every other file inert.
use percent_encoding::percent_decode_str;
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response};

/// The shell's origin, as Tauri serves a custom protocol on each platform.
pub fn shell_origin() -> &'static str {
    if cfg!(windows) {
        "http://loam.localhost"
    } else {
        "loam://localhost"
    }
}

/// The sandbox's origin: a second scheme, so a second origin (D62).
pub fn sandbox_origin() -> &'static str {
    if cfg!(windows) {
        "http://loam-sandbox.localhost"
    } else {
        "loam-sandbox://localhost"
    }
}

/// The copilot runtime's frame and its chunks, on the sandbox origin (phase 5 specification, 3.2).
const COPILOT_PATH: &str = "sandbox/copilot/";

/// The copilot frame's header policy (3.2): scripts only from the copilot's path on the sandbox origin, never
/// `'self'`, which matches nothing in an opaque-origin document on WebKitGTK; workers only from `blob:`; no
/// connection; framed only by the shell. A worker the frame starts inherits it.
pub fn copilot_policy() -> String {
    format!(
        "default-src 'none'; script-src {}/{COPILOT_PATH}; worker-src blob:; connect-src 'none'; frame-ancestors {}",
        sandbox_origin(),
        shell_origin()
    )
}

const FRAME_ANCESTORS_NONE: &str = "frame-ancestors 'none'";
const INERT_POLICY: &str = "sandbox; default-src 'none'; frame-ancestors 'none'";

/// The bundled shell's files, by relative path.
pub type Lookup = Box<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

/// Whether `relative` is a signed shell file served strictly from `EmbeddedAssets` in `managed` mode
/// (D168 amended; phase 5 no-terminal amendment, 3.1 & 9.2).
fn is_signed_shell_path(relative: &str) -> bool {
    relative == "index.html"
        || relative == "404.html"
        || relative.starts_with("assets/")
        || relative.starts_with("sandbox/")
}

/// Whether `frame_src` is admitted by Loam's fixed desktop CSP ceiling: `'none'` or `sandbox_origin()`.
fn frame_src_allowed(frame_src: &str) -> bool {
    frame_src == "'none'" || frame_src == sandbox_origin()
}

/// A trusted directory handle for `Site::Managed` disk reads (`deployment.json` and `apps/*`).
/// On Unix, holds an open `O_DIRECTORY | O_CLOEXEC` file descriptor so every lookup traverses
/// segment-by-segment with `openat(..., O_NOFOLLOW)` and reads directly from the validated file
/// handle with zero pathname re-resolution. On Windows, holds the canonical directory path and
/// validates each opened handle via `FILE_FLAG_OPEN_REPARSE_POINT` + `FILE_SHARE_READ` +
/// `GetFinalPathNameByHandleW`.
pub struct ManagedRoot {
    #[cfg(unix)]
    dir_fd: std::os::fd::OwnedFd,
    #[cfg(not(unix))]
    directory: PathBuf,
}

impl ManagedRoot {
    fn open(directory: &Path) -> Option<Self> {
        let root = directory.canonicalize().ok()?;
        if !root.is_dir() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::fd::{FromRawFd, OwnedFd};
            use std::os::unix::ffi::OsStrExt;
            let c_path = CString::new(root.as_os_str().as_bytes()).ok()?;
            // SAFETY: `c_path` is a NUL-terminated path; `O_RDONLY | O_DIRECTORY | O_CLOEXEC`
            // opens a read-only directory fd owned by `OwnedFd` below.
            let fd = unsafe {
                libc::open(
                    c_path.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return None;
            }
            // SAFETY: `fd >= 0` is a freshly opened file descriptor owned exclusively here.
            let dir_fd = unsafe { OwnedFd::from_raw_fd(fd) };
            Some(Self { dir_fd })
        }
        #[cfg(not(unix))]
        {
            Some(Self { directory: root })
        }
    }

    #[cfg(unix)]
    fn read_segments(&self, segments: &[&str]) -> Option<Vec<u8>> {
        use std::ffi::CString;
        use std::io::Read as _;
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        if segments.is_empty() {
            return None;
        }
        let mut current: Option<OwnedFd> = None;
        for segment in &segments[..segments.len() - 1] {
            if segment.is_empty() || *segment == "." || *segment == ".." {
                return None;
            }
            let c_seg = CString::new(*segment).ok()?;
            let parent_fd = current
                .as_ref()
                .map_or_else(|| self.dir_fd.as_raw_fd(), AsRawFd::as_raw_fd);
            // SAFETY: `parent_fd` is a live directory fd and `c_seg` is a NUL-terminated component;
            // `O_NOFOLLOW | O_DIRECTORY` refuses symlinks and non-directories without leaving the
            // open directory tree.
            let next_fd = unsafe {
                libc::openat(
                    parent_fd,
                    c_seg.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if next_fd < 0 {
                return None;
            }
            // SAFETY: `next_fd >= 0` is a freshly opened directory fd owned by `current`.
            current = Some(unsafe { OwnedFd::from_raw_fd(next_fd) });
        }
        let leaf = segments[segments.len() - 1];
        if leaf.is_empty() || leaf == "." || leaf == ".." {
            return None;
        }
        let c_leaf = CString::new(leaf).ok()?;
        let parent_fd = current
            .as_ref()
            .map_or_else(|| self.dir_fd.as_raw_fd(), AsRawFd::as_raw_fd);
        // SAFETY: `parent_fd` is a live directory fd and `c_leaf` is a NUL-terminated filename;
        // `O_NOFOLLOW` refuses symlinks and `O_NONBLOCK` avoids blocking on FIFOs before `fstat`.
        let file_fd = unsafe {
            libc::openat(
                parent_fd,
                c_leaf.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if file_fd < 0 {
            return None;
        }
        // SAFETY: `file_fd >= 0` is a freshly opened file descriptor now owned by `File`.
        let mut file = unsafe { std::fs::File::from_raw_fd(file_fd) };
        if !file.metadata().ok()?.is_file() {
            return None;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }

    #[cfg(windows)]
    fn read_segments(&self, segments: &[&str]) -> Option<Vec<u8>> {
        use std::io::Read as _;
        use std::os::windows::ffi::OsStringExt;
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_NAME_NORMALIZED, FILE_SHARE_READ,
            GetFinalPathNameByHandleW, VOLUME_NAME_DOS,
        };
        if segments.is_empty() {
            return None;
        }
        let mut path = self.directory.clone();
        for segment in &segments[..segments.len() - 1] {
            if segment.is_empty() || *segment == "." || *segment == ".." {
                return None;
            }
            path.push(segment);
            if !std::fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_dir()) {
                return None;
            }
        }
        let leaf = segments[segments.len() - 1];
        if leaf.is_empty() || leaf == "." || leaf == ".." {
            return None;
        }
        path.push(leaf);
        // Open without following reparse points and refuse write/delete sharing while validated & read.
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&path)
            .ok()?;
        if !file.metadata().ok()?.is_file() {
            return None;
        }
        // Verify the open handle's final canonical path is strictly inside the expected boundary.
        let handle = file.as_raw_handle() as HANDLE;
        let flags = VOLUME_NAME_DOS | FILE_NAME_NORMALIZED;
        // SAFETY: passing a null buffer of length 0 queries the required UTF-16 length.
        let needed = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, flags) };
        if needed == 0 {
            return None;
        }
        let mut buf = vec![0u16; needed as usize];
        // SAFETY: `buf` has capacity for `needed` UTF-16 code units.
        let len = unsafe { GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), needed, flags) };
        if len == 0 || len >= needed {
            return None;
        }
        let final_path = PathBuf::from(std::ffi::OsString::from_wide(&buf[..len as usize]));
        let expected = if segments == ["deployment.json"] {
            final_path == self.directory.join("deployment.json")
        } else {
            let apps = self.directory.join("apps");
            final_path.starts_with(&apps) && final_path != apps
        };
        if !expected {
            return None;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }

    #[cfg(not(any(unix, windows)))]
    fn read_segments(&self, segments: &[&str]) -> Option<Vec<u8>> {
        let mut path = self.directory.clone();
        for segment in segments {
            path.push(segment);
        }
        let found = path.canonicalize().ok()?;
        if !found.starts_with(&self.directory) || !found.is_file() {
            return None;
        }
        std::fs::read(&found).ok()
    }
}

/// Where the site's files come from.
pub enum Site {
    /// The deployer's `<app data>/site`, canonical (`cli` mode).
    Directory(PathBuf),
    /// The empty shell compiled into the binary, read through this lookup by relative path
    /// (fresh `managed` install before its first commit, or fail-closed fallback).
    Bundled(Lookup),
    /// `managed` mode with committed `desktop-state.json` (D168 amended):
    /// - Signed shell files (`index.html`, `404.html`, `assets/*`, `sandbox/*`) are served strictly
    ///   from `bundled` (`EmbeddedAssets`), ignoring any planted files in `directory`.
    /// - Only `deployment.json` and plugin `apps/*` are read from `directory` (`<app data>/site/`),
    ///   opened handle-relative without following symlinks or reparse points.
    /// - `frame_src` (`'none'` or `sandbox_origin()`) rewrites embedded shell HTML `<meta>` `frame-src`
    ///   in memory and drives the canonical desktop CSP HTTP header.
    Managed {
        root: ManagedRoot,
        bundled: Lookup,
        frame_src: String,
    },
}

impl Site {
    /// The deployer's site when it has an `index.html`, else `bundled` (`cli` mode / default helper).
    pub fn choose(directory: &Path, bundled: Lookup) -> Self {
        match directory.canonicalize() {
            Ok(root) if root.join("index.html").is_file() => Site::Directory(root),
            _ => Site::Bundled(bundled),
        }
    }

    /// Constructs a `managed` site serving signed shell assets from `bundled` with in-memory
    /// `frame-src` rewriting, and `deployment.json` + `apps/*` from canonical `directory`.
    /// Returns `None` if `frame_src` violates the desktop CSP ceiling or `directory` cannot be
    /// canonicalized as a directory.
    pub fn managed(
        directory: &Path,
        bundled: Lookup,
        frame_src: impl Into<String>,
    ) -> Option<Self> {
        Self::try_managed(directory, bundled, frame_src).ok()
    }

    /// Like [`Self::managed`], returning `bundled` back on failure so callers can fall back to
    /// [`Site::Bundled`] without losing access to embedded assets.
    pub(crate) fn try_managed(
        directory: &Path,
        bundled: Lookup,
        frame_src: impl Into<String>,
    ) -> Result<Self, Lookup> {
        let frame_src = frame_src.into();
        if !frame_src_allowed(&frame_src) {
            return Err(bundled);
        }
        let Some(root) = ManagedRoot::open(directory) else {
            return Err(bundled);
        };
        Ok(Site::Managed {
            root,
            bundled,
            frame_src,
        })
    }

    fn managed_frame_src(&self) -> Option<&str> {
        match self {
            Site::Managed { frame_src, .. } => Some(frame_src.as_str()),
            Site::Directory(_) | Site::Bundled(_) => None,
        }
    }

    fn read(&self, relative: &str, sandbox: bool) -> Option<(String, Vec<u8>)> {
        match self {
            Site::Directory(root) => {
                let file = resolve(root, relative, sandbox)?;
                let bytes = std::fs::read(&file).ok()?;
                let name = file
                    .strip_prefix(root)
                    .ok()?
                    .to_string_lossy()
                    .replace('\\', "/");
                Some((name, bytes))
            }
            Site::Bundled(lookup) => {
                if sandbox && !relative.starts_with("sandbox/") {
                    return None;
                }
                lookup(relative).map(|bytes| (relative.to_owned(), bytes))
            }
            Site::Managed { root, bundled, .. } => {
                if sandbox {
                    if !relative.starts_with("sandbox/") {
                        return None;
                    }
                    return bundled(relative).map(|bytes| (relative.to_owned(), bytes));
                }
                if relative == "deployment.json" {
                    let bytes = root.read_segments(&["deployment.json"])?;
                    return Some(("deployment.json".to_owned(), bytes));
                }
                if relative.starts_with("apps/") {
                    let segments: Vec<&str> = relative.split('/').collect();
                    let bytes = root.read_segments(&segments)?;
                    return Some((relative.to_owned(), bytes));
                }
                if is_signed_shell_path(relative) {
                    return bundled(relative).map(|bytes| (relative.to_owned(), bytes));
                }
                None
            }
        }
    }
}

/// The request's path, decoded once, as a relative path of normal components only: `None` for anything
/// else (`..`, `.`, a backslash, a NUL, a drive or a root inside it).
fn relative_path(path: &str) -> Option<String> {
    let decoded = percent_decode_str(path).decode_utf8().ok()?;
    if decoded.contains(['\\', '\0', ':']) {
        return None;
    }
    let trimmed = decoded.trim_start_matches('/');
    let relative = Path::new(trimmed);
    if trimmed.is_empty() {
        return Some(String::new());
    }
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    Some(trimmed.to_owned())
}

/// `relative` under `root`, both canonical: lexical containment alone does not catch a symbolic link.
fn resolve(root: &Path, relative: &str, sandbox: bool) -> Option<PathBuf> {
    let boundary = if sandbox {
        root.join("sandbox").canonicalize().ok()?
    } else {
        root.to_path_buf()
    };
    let found = root.join(relative).canonicalize().ok()?;
    (found.starts_with(root) && found.starts_with(&boundary) && found.is_file()).then_some(found)
}

/// Reads one HTML start-tag attribute starting at `pos` inside `tag`, advancing `pos`.
/// Returns `Ok(None)` at the end of attributes, `Ok(Some((name_lower, value)))` for a parsed attribute,
/// or `Err(())` for malformed syntax (such as an unclosed quoted value).
fn next_attr<'a>(tag: &'a str, pos: &mut usize) -> Result<Option<(String, Option<&'a str>)>, ()> {
    let bytes = tag.as_bytes();
    while *pos < bytes.len() && (bytes[*pos].is_ascii_whitespace() || bytes[*pos] == b'/') {
        *pos += 1;
    }
    if *pos >= bytes.len() {
        return Ok(None);
    }
    let name_start = *pos;
    while *pos < bytes.len()
        && !bytes[*pos].is_ascii_whitespace()
        && !matches!(bytes[*pos], b'=' | b'/' | b'>')
    {
        *pos += 1;
    }
    if *pos == name_start {
        return Err(());
    }
    let name = tag[name_start..*pos].to_ascii_lowercase();
    while *pos < bytes.len() && bytes[*pos].is_ascii_whitespace() {
        *pos += 1;
    }
    if *pos >= bytes.len() || bytes[*pos] != b'=' {
        return Ok(Some((name, None)));
    }
    *pos += 1; // '='
    while *pos < bytes.len() && bytes[*pos].is_ascii_whitespace() {
        *pos += 1;
    }
    if *pos >= bytes.len() {
        return Err(());
    }
    let value = match bytes[*pos] {
        q @ (b'"' | b'\'') => {
            *pos += 1;
            let val_start = *pos;
            while *pos < bytes.len() && bytes[*pos] != q {
                *pos += 1;
            }
            if *pos >= bytes.len() {
                return Err(());
            }
            let val = &tag[val_start..*pos];
            *pos += 1; // closing quote
            val
        }
        _ => {
            let val_start = *pos;
            while *pos < bytes.len()
                && !bytes[*pos].is_ascii_whitespace()
                && !matches!(bytes[*pos], b'>' | b'"' | b'\'')
            {
                *pos += 1;
            }
            &tag[val_start..*pos]
        }
    };
    Ok(Some((name, Some(value))))
}

/// Finds the closing `>` of an HTML start tag starting at `open_end` (right after the tag name),
/// respecting quoted attribute values so a `>` inside quotes does not end the tag early.
fn find_tag_end(html: &str, open_end: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut i = open_end;
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None if b == b'"' || b == b'\'' => quote = Some(b),
            None if b == b'>' => return Some(i),
            None => {}
        }
        i += 1;
    }
    None
}

/// Returns `Some(name_lower)` and the byte index immediately after an HTML tag name starting at `start`
/// (ASCII letter followed by any non-whitespace, non-`/`, non-`>` bytes, covering hyphenated custom elements).
fn read_tag_name(html: &str, start: usize) -> Option<(String, usize)> {
    let bytes = html.as_bytes();
    if !bytes.get(start).is_some_and(u8::is_ascii_alphabetic) {
        return None;
    }
    let mut end = start + 1;
    while end < bytes.len()
        && !bytes[end].is_ascii_whitespace()
        && !matches!(bytes[end], b'/' | b'>')
    {
        end += 1;
    }
    Some((html[start..end].to_ascii_lowercase(), end))
}

/// The `<meta>` policy of a shell page, refused as the hosted server refuses it (`metaPolicy`): not exactly
/// one active `<meta http-equiv="Content-Security-Policy">` element in `<head>` (following HTML's "in head"
/// insertion mode: only whitespace, comments, doctype, and head-valid elements keep `<head>` open; any other
/// start tag — including hyphenated custom elements or body elements without `<body>` — or non-whitespace text
/// closes `<head>`, raw/RCDATA elements (`<title>`, `<style>`, `<script>`) are skipped whole, and
/// `<template>`, `<noscript>`, and `<noframes>` fail closed), no `content` attribute, duplicate
/// `http-equiv`/`content` attributes, an entity or a line break, or a directive only a header may carry.
pub fn meta_policy(html: &str) -> Option<&str> {
    meta_policy_span(html).map(|span| &html[span])
}

/// Byte range of the single active `<meta http-equiv="Content-Security-Policy">` `content` attribute
/// value inside `html`'s `<head>`, validated identically to [`meta_policy`].
fn meta_policy_span(html: &str) -> Option<std::ops::Range<usize>> {
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut policies: Vec<Option<std::ops::Range<usize>>> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if bytes[i] != b'<' {
            // Non-whitespace character data implicitly closes `<head>` in HTML5.
            break;
        }
        if lower[i..].starts_with("<!--") {
            let Some(end) = lower[i + 4..].find("-->") else {
                // Unclosed comment consumes the rest of the document.
                break;
            };
            i = i + 4 + end + 3;
            continue;
        }
        // Only `<!doctype ...>` declarations are valid before/in `<head>`; reject/stop on anything else.
        if lower[i..].starts_with("<!doctype")
            && bytes
                .get(i + 9)
                .is_some_and(|b| b.is_ascii_whitespace() || *b == b'>')
        {
            let Some(rel) = html[i + 9..].find('>') else {
                break;
            };
            i = i + 9 + rel + 1;
            continue;
        }
        // Closing tags: `</head>` ends `<head>`; any other closing tag before `</head>` stops head scanning.
        if bytes.get(i + 1) == Some(&b'/') {
            break;
        }
        // Start tag: allow strictly the elements valid in HTML's "in head" insertion mode; any other element
        // (such as `<body>`, `<div>`, `<p>`, or a hyphenated custom element) implicitly closes `<head>`.
        let Some((name, after_name)) = read_tag_name(html, i + 1) else {
            break;
        };
        let tag_end = find_tag_end(html, after_name)?;
        match name.as_str() {
            "html" | "head" | "base" | "basefont" | "bgsound" | "link" => {
                i = tag_end + 1;
            }
            "title" | "style" | "script" => {
                // Non-nestable RCDATA / raw-text head elements: skip to their matching closing tag.
                let close = format!("</{name}");
                let mut search = tag_end + 1;
                let mut closed = false;
                while let Some(rel) = lower[search..].find(&close) {
                    let after_close = search + rel + close.len();
                    if bytes
                        .get(after_close)
                        .is_some_and(|b| b.is_ascii_whitespace() || *b == b'>' || *b == b'/')
                    {
                        let close_end = find_tag_end(html, after_close)?;
                        i = close_end + 1;
                        closed = true;
                        break;
                    }
                    search = after_close;
                }
                if !closed {
                    break;
                }
            }
            "template" | "noscript" | "noframes" => {
                // Nestable or scripting-dependent head elements are ambiguous for static CSP inspection:
                // fail closed instead of guessing template/noscript depth.
                return None;
            }
            "meta" => {
                let attrs_slice = &html[after_name..tag_end];
                let mut pos = 0;
                let mut http_equiv: Option<Option<&str>> = None;
                let mut content: Option<Option<std::ops::Range<usize>>> = None;
                while let Some((attr_name, value)) = next_attr(attrs_slice, &mut pos).ok()? {
                    if attr_name == "http-equiv" && http_equiv.replace(value).is_some() {
                        return None;
                    }
                    if attr_name == "content" {
                        let span = value.map(|val| {
                            let start = val.as_ptr() as usize - html.as_ptr() as usize;
                            start..start + val.len()
                        });
                        if content.replace(span).is_some() {
                            return None;
                        }
                    }
                }
                if http_equiv
                    .flatten()
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("content-security-policy"))
                {
                    policies.push(content.flatten());
                }
                i = tag_end + 1;
            }
            _ => {
                // Any non-head start tag implicitly closes `<head>`, so later `<meta>` tags are inactive.
                break;
            }
        }
    }
    let [Some(span)] = policies.as_slice() else {
        return None;
    };
    let content = &html[span.clone()];
    if content.contains(['&', '\r', '\n']) {
        return None;
    }
    let header_only = content.split(';').any(|directive| {
        let name = directive
            .trim()
            .split_ascii_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        matches!(
            name.as_str(),
            "frame-ancestors" | "form-action" | "sandbox" | "report-uri"
        )
    });
    (!header_only).then(|| span.clone())
}

/// Rewrites the `<meta http-equiv="Content-Security-Policy">` `frame-src` directive of a signed
/// desktop shell HTML page in memory (amendment 9.2; D168 amended), enforcing Loam's fixed desktop
/// CSP ceiling (`frame_src` must be `'none'` or [`sandbox_origin`], and the source `<meta>` must
/// already pass [`desktop_shell_policy`]). The `build.rs` no-shell placeholder (`default-src 'none'`)
/// is preserved untouched rather than widened.
pub fn rewrite_frame_src(html: &str, frame_src: &str) -> Option<String> {
    if !frame_src_allowed(frame_src) {
        return None;
    }
    let span = meta_policy_span(html)?;
    let bytes = html.as_bytes();
    // Require a double-quoted `content="..."` attribute so inserting `'none'` can never break quotes.
    if span.start == 0
        || bytes.get(span.start - 1) != Some(&b'"')
        || bytes.get(span.end) != Some(&b'"')
    {
        return None;
    }
    let meta = &html[span.clone()];
    let checked = desktop_shell_policy(meta)?;
    if checked == format!("default-src 'none'; {FRAME_ANCESTORS_NONE}") {
        return Some(html.to_owned());
    }
    let rewritten_meta = format!(
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {frame_src}; object-src 'none'; base-uri 'none'"
    );
    let mut out =
        String::with_capacity(html.len() - (span.end - span.start) + rewritten_meta.len());
    out.push_str(&html[..span.start]);
    out.push_str(&rewritten_meta);
    out.push_str(&html[span.end..]);
    Some(out)
}

/// Validates a shell page's `<meta>` policy against Loam's fixed desktop CSP ceiling and returns the
/// Rust-constructed canonical HTTP `Content-Security-Policy` header (including `frame-ancestors 'none'`).
///
/// Only two shapes are accepted:
/// 1. The `build.rs` no-shell placeholder (`default-src 'none'`).
/// 2. The exact desktop shell policy (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
///    `img-src 'self' data:`, `connect-src 'self' ipc: http://ipc.localhost`, `frame-src 'none'` or
///    `sandbox_origin()`, `object-src 'none'`, `base-uri 'none'`).
///
/// Any widened, missing, duplicate, or unknown directive is refused (`None`), so tampering with an
/// `index.html` on disk can never widen the HTTP CSP header emitted by `loam://localhost`.
pub fn desktop_shell_policy(meta: &str) -> Option<String> {
    let mut directives: HashMap<String, Vec<&str>> = HashMap::new();
    for raw in meta.split(';') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_ascii_whitespace();
        let name = parts.next()?.to_ascii_lowercase();
        let values: Vec<&str> = parts.collect();
        if values.is_empty() || directives.insert(name, values).is_some() {
            return None;
        }
    }
    if directives.len() == 1
        && directives.get("default-src").map(Vec::as_slice) == Some(&["'none'"][..])
    {
        return Some(format!("default-src 'none'; {FRAME_ANCESTORS_NONE}"));
    }
    if directives.len() != 8 {
        return None;
    }
    let exact =
        |name: &str, expected: &[&str]| directives.get(name).map(Vec::as_slice) == Some(expected);
    if !exact("default-src", &["'self'"])
        || !exact("script-src", &["'self'"])
        || !exact("style-src", &["'self'"])
        || !exact("img-src", &["'self'", "data:"])
        || !exact("connect-src", &["'self'", "ipc:", "http://ipc.localhost"])
        || !exact("object-src", &["'none'"])
        || !exact("base-uri", &["'none'"])
    {
        return None;
    }
    let sandbox = sandbox_origin();
    let frame_src = match directives.get("frame-src").map(Vec::as_slice) {
        Some(["'none'"]) => "'none'",
        Some([origin]) if *origin == sandbox => sandbox,
        _ => return None,
    };
    Some(format!(
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {frame_src}; object-src 'none'; base-uri 'none'; {FRAME_ANCESTORS_NONE}"
    ))
}

fn mime(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(404)
        .header("Content-Security-Policy", INERT_POLICY)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(Cow::Borrowed(&[][..]))
        .expect("a 404")
}

/// One request of either protocol. `sandbox` serves the site's `sandbox/` and nothing else.
pub fn serve(
    site: &Site,
    sandbox: bool,
    request: &Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let method = request.method().as_str();
    if method != "GET" && method != "HEAD" {
        return not_found();
    }
    let Some(relative) = relative_path(request.uri().path()) else {
        return not_found();
    };
    let wants_html = request
        .headers()
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/html"));
    let index = || site.read("index.html", false);
    let found = if relative.is_empty() {
        if sandbox { None } else { index() }
    } else {
        site.read(&relative, sandbox).or_else(|| {
            // D74's fallback: `index.html` for a path with no file, asked for as a page.
            let extensionless = Path::new(&relative).extension().is_none();
            (!sandbox && wants_html && extensionless)
                .then(index)
                .flatten()
        })
    };
    let Some((name, mut bytes)) = found else {
        return not_found();
    };
    let shell_page = !sandbox && (name == "index.html" || name == "404.html");
    let policy = if sandbox && name.starts_with(COPILOT_PATH) {
        copilot_policy()
    } else if sandbox {
        // No request of the proxy's own, and so no IPC, whatever its page's <meta> says: a header and a <meta>
        // policy both apply, and a view's srcdoc document inherits it (10.2).
        format!("connect-src 'none'; frame-ancestors {}", shell_origin())
    } else if shell_page {
        if let Some(frame_src) = site.managed_frame_src() {
            let Ok(html) = std::str::from_utf8(&bytes) else {
                return not_found();
            };
            let Some(rewritten) = rewrite_frame_src(html, frame_src) else {
                return not_found();
            };
            let Some(meta) = meta_policy(&rewritten) else {
                return not_found();
            };
            let Some(checked) = desktop_shell_policy(meta) else {
                return not_found();
            };
            bytes = rewritten.into_bytes();
            checked
        } else {
            let Ok(html) = std::str::from_utf8(&bytes) else {
                return not_found();
            };
            let Some(meta) = meta_policy(html) else {
                return not_found();
            };
            let Some(checked) = desktop_shell_policy(meta) else {
                return not_found();
            };
            checked
        }
    } else {
        INERT_POLICY.to_owned()
    };
    Response::builder()
        .header("Content-Type", mime(&name))
        .header("Content-Security-Policy", policy)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header(
            "Cache-Control",
            if name.starts_with("assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
        )
        .body(Cow::Owned(if method == "HEAD" {
            Vec::new()
        } else {
            bytes
        }))
        .expect("a response")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'\"><title>Loam</title>";

    fn site() -> (tempfile::TempDir, PathBuf) {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("site");
        std::fs::create_dir_all(root.join("sandbox")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("index.html"), PAGE).unwrap();
        std::fs::write(root.join("assets/index-1.js"), "1").unwrap();
        std::fs::write(root.join("sandbox/proxy.html"), "<p>proxy</p>").unwrap();
        std::fs::write(
            data.path().join("mounts.json"),
            "{\"mounts\":[{\"bearer\":\"secret\"}]}",
        )
        .unwrap();
        let root = root.canonicalize().unwrap();
        (data, root)
    }

    fn get(site: &Site, sandbox: bool, path: &str, accept: &str) -> Response<Cow<'static, [u8]>> {
        let request = Request::builder()
            .uri(format!("loam://localhost{path}"))
            .header("accept", accept)
            .body(Vec::new())
            .unwrap();
        serve(site, sandbox, &request)
    }

    #[test]
    fn p6_d4_no_path_reaches_mounts_json() {
        let (_data, root) = site();
        let site = Site::Directory(root);
        for path in [
            "/../mounts.json",
            "/%2e%2e/mounts.json",
            "/%2E%2E/mounts.json",
            "/%2e%2e%2fmounts.json",
            "/..%2fmounts.json",
            "/%2e%2e%5cmounts.json",
            "/..%5cmounts.json",
            "/assets/%2e%2e/%2e%2e/mounts.json",
            "/%252e%252e/mounts.json",
            "/C:%5cmounts.json",
        ] {
            let response = get(&site, false, path, "text/html");
            let body = response.body();
            assert!(
                !String::from_utf8_lossy(body).contains("secret"),
                "{path} reached mounts.json"
            );
            assert!(
                response.status() == 404 || body.as_ref() == PAGE.as_bytes(),
                "{path}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn p6_d4_a_symbolic_link_does_not_leave_the_site() {
        let (data, root) = site();
        std::os::unix::fs::symlink(data.path().join("mounts.json"), root.join("innocent.json"))
            .unwrap();
        std::os::unix::fs::symlink(data.path(), root.join("up")).unwrap();
        let site = Site::Directory(root);
        assert_eq!(get(&site, false, "/innocent.json", "*/*").status(), 404);
        assert_eq!(get(&site, false, "/up/mounts.json", "*/*").status(), 404);
    }

    #[cfg(windows)]
    #[test]
    fn p6_d4_a_symbolic_link_does_not_leave_the_site() {
        let (data, root) = site();
        // Creating a link needs Developer Mode or the privilege; without either the case cannot be built here.
        if std::os::windows::fs::symlink_file(
            data.path().join("mounts.json"),
            root.join("innocent.json"),
        )
        .is_err()
        {
            eprintln!("skipped: this account cannot create a symbolic link");
            return;
        }
        let site = Site::Directory(root);
        assert_eq!(get(&site, false, "/innocent.json", "*/*").status(), 404);
    }

    #[test]
    fn the_shell_page_carries_its_meta_policy_and_frame_ancestors_none() {
        let (_data, root) = site();
        let site = Site::Directory(root);
        let response = get(&site, false, "/", "text/html");
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["content-security-policy"],
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        );
        // D74: a deep link is the shell; a missing file asked for as a script is not.
        assert_eq!(
            get(&site, false, "/personal/hello", "text/html")
                .body()
                .as_ref(),
            PAGE.as_bytes()
        );
        assert_eq!(get(&site, false, "/assets/missing.js", "*/*").status(), 404);
        assert_eq!(
            get(&site, false, "/assets/index-1.js", "*/*").headers()["content-security-policy"],
            INERT_POLICY
        );
    }

    #[test]
    fn the_sandbox_serves_only_its_directory_framed_by_the_shell() {
        let (_data, root) = site();
        let site = Site::Directory(root);
        let proxy = get(&site, true, "/sandbox/proxy.html", "text/html");
        assert_eq!(proxy.status(), 200);
        assert_eq!(
            proxy.headers()["content-security-policy"],
            format!("connect-src 'none'; frame-ancestors {}", shell_origin())
        );
        for path in [
            "/",
            "/index.html",
            "/assets/index-1.js",
            "/sandbox/../index.html",
            "/sandbox/%2e%2e/index.html",
        ] {
            assert_eq!(get(&site, true, path, "text/html").status(), 404, "{path}");
        }
    }

    #[test]
    fn p5_a2_the_copilot_frame_carries_its_path_scoped_policy() {
        let (_data, root) = site();
        std::fs::create_dir_all(root.join("sandbox/copilot")).unwrap();
        std::fs::write(
            root.join("sandbox/copilot/index.html"),
            "<script src=\"bootstrap.js\"></script>",
        )
        .unwrap();
        std::fs::write(root.join("sandbox/copilot/bootstrap.js"), "0").unwrap();
        std::fs::write(root.join("sandbox/copilot-other.html"), "<p>other</p>").unwrap();
        let site = Site::Directory(root);
        let expected = format!(
            "default-src 'none'; script-src {}/sandbox/copilot/; worker-src blob:; connect-src 'none'; frame-ancestors {}",
            sandbox_origin(),
            shell_origin()
        );
        assert_eq!(copilot_policy(), expected);
        assert!(!expected.contains("'self'"));
        for (path, kind) in [
            ("/sandbox/copilot/index.html", "text/html; charset=utf-8"),
            (
                "/sandbox/copilot/bootstrap.js",
                "text/javascript; charset=utf-8",
            ),
        ] {
            let response = get(&site, true, path, "*/*");
            assert_eq!(response.status(), 200, "{path}");
            assert_eq!(
                response.headers()["content-security-policy"],
                expected,
                "{path}"
            );
            assert_eq!(response.headers()["content-type"], kind, "{path}");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        }
        // Only the copilot's own directory: a neighbour sharing its prefix keeps the proxy's policy, and the
        // shell's protocol serves no copilot policy.
        assert_eq!(
            get(&site, true, "/sandbox/copilot-other.html", "*/*").headers()["content-security-policy"],
            format!("connect-src 'none'; frame-ancestors {}", shell_origin())
        );
        assert_eq!(
            get(&site, false, "/sandbox/copilot/bootstrap.js", "*/*").headers()["content-security-policy"],
            INERT_POLICY
        );
    }

    #[test]
    fn a_page_whose_policy_a_header_would_contradict_is_refused() {
        assert!(meta_policy(PAGE).is_some());
        for page in [
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; frame-ancestors *\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src &apos;self&apos;\">",
            "<p>no policy</p>",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"a\"><meta http-equiv=\"Content-Security-Policy\" content=\"b\">",
        ] {
            assert!(meta_policy(page).is_none(), "{page}");
        }
    }

    #[test]
    fn desktop_csp_ceiling_accepts_canonical_shapes_and_refuses_widening() {
        let with_sandbox = format!(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {}; object-src 'none'; base-uri 'none'",
            sandbox_origin()
        );
        assert_eq!(
            desktop_shell_policy(&with_sandbox),
            Some(format!("{with_sandbox}; frame-ancestors 'none'"))
        );
        // The `build.rs` no-shell placeholder stays accepted and emits `frame-ancestors 'none'`.
        assert_eq!(
            desktop_shell_policy("default-src 'none'"),
            Some("default-src 'none'; frame-ancestors 'none'".to_owned())
        );

        let wrong_platform_sandbox = if cfg!(windows) {
            "loam-sandbox://localhost"
        } else {
            "http://loam-sandbox.localhost"
        };
        let widened_cases = [
            // Widened script-src
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'".to_owned(),
            "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'".to_owned(),
            // Widened connect-src
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://evil.example; frame-src 'none'; object-src 'none'; base-uri 'none'".to_owned(),
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src *; frame-src 'none'; object-src 'none'; base-uri 'none'".to_owned(),
            // Widened frame-src or wrong platform sandbox origin
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src https://evil.example; object-src 'none'; base-uri 'none'".to_owned(),
            format!(
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {wrong_platform_sandbox}; object-src 'none'; base-uri 'none'"
            ),
            // Missing required directive (`object-src` or `base-uri` or `script-src`)
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; base-uri 'none'".to_owned(),
            "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost".to_owned(),
            // Unknown extra directive, duplicate directive, or comma-separated multi-policy injection
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; worker-src *".to_owned(),
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; frame-src *; object-src 'none'; base-uri 'none'".to_owned(),
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none', script-src 'unsafe-inline'".to_owned(),
        ];
        for meta in &widened_cases {
            assert_eq!(desktop_shell_policy(meta), None, "{meta}");
        }

        // End-to-end through `serve`: tampered, commented-out, or attribute-spoofed pages are refused with 404.
        let valid_csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'";
        let tampered_pages = [
            // Widened real `<meta>`
            "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'\"><title>Loam</title>".to_owned(),
            // Commented-out `<meta>` only (no active CSP element)
            format!(
                "<!doctype html><!-- <meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"> --><title>Loam</title>"
            ),
            // Commented-out valid `<meta>` paired with widened active `<meta>`
            format!(
                "<!doctype html><!-- <meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"> --><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"><title>Loam</title>"
            ),
            // `data-content` spoofing before a widened `content` attribute
            format!(
                "<!doctype html><meta http-equiv=\"Content-Security-Policy\" data-content=\"{valid_csp}\" content=\"default-src *\"><title>Loam</title>"
            ),
            // `data-content` with no real `content` attribute
            format!(
                "<!doctype html><meta http-equiv=\"Content-Security-Policy\" data-content=\"{valid_csp}\"><title>Loam</title>"
            ),
            // `<meta>` smuggled inside `<script>` text only
            format!(
                "<!doctype html><script>const x = '<meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\">';</script><title>Loam</title>"
            ),
            // `<meta>` smuggled inside `<title>` RCDATA
            format!(
                "<!doctype html><title><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"></title>"
            ),
            // `<meta>` smuggled inside another element's quoted attribute (including hyphenated custom elements)
            format!(
                "<!doctype html><html data-x='<meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\">'><head></head><body></body></html>"
            ),
            format!(
                "<!doctype html><x-custom data-x='<meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\">'></x-custom>"
            ),
            // `<meta>` placed after `</head>` / inside `<body>`, or after an element/text that implicitly closes `<head>`
            format!(
                "<!doctype html><html><head><title>Loam</title></head><body><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"></body></html>"
            ),
            format!(
                "<!doctype html><p>body</p><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\">"
            ),
            format!(
                "<!doctype html>text<meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\">"
            ),
            // `<meta>` inside single or nested `<template>` in `<head>` (inert in browsers, refused fail-closed)
            format!(
                "<!doctype html><html><head><template><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"></template></head></html>"
            ),
            format!(
                "<!doctype html><html><head><template><template></template><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}\"></template></head></html>"
            ),
            // Comma-separated multi-policy injection through `serve`
            format!(
                "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"{valid_csp}, script-src 'unsafe-inline'\"><title>Loam</title>"
            ),
        ];
        for html in &tampered_pages {
            let (_data, root) = site();
            std::fs::write(root.join("index.html"), html).unwrap();
            let tampered = Site::Directory(root);
            let response = get(&tampered, false, "/", "text/html");
            assert_eq!(response.status(), 404, "{html}");
            assert_eq!(
                response.headers()["content-security-policy"],
                INERT_POLICY,
                "{html}"
            );
        }
    }

    #[test]
    fn only_get_and_head_are_served() {
        let (_data, root) = site();
        let site = Site::Directory(root);
        let request = Request::builder()
            .method("POST")
            .uri("loam://localhost/")
            .body(Vec::new())
            .unwrap();
        assert_eq!(serve(&site, false, &request).status(), 404);
    }

    fn bundled_lookup() -> Lookup {
        Box::new(|path| match path {
            "index.html" => Some(PAGE.as_bytes().to_vec()),
            "404.html" => Some(
                PAGE.replace("<title>Loam</title>", "<title>Loam 404</title>")
                    .into_bytes(),
            ),
            "assets/app.js" => Some(b"console.log('signed-shell');".to_vec()),
            "sandbox/proxy.html" => Some(b"<p>signed-proxy</p>".to_vec()),
            "sandbox/copilot/index.html" => Some(b"<script src=\"boot.js\"></script>".to_vec()),
            // The bundled empty dist holds an empty deployment.json; managed mode must NEVER serve it.
            "deployment.json" => Some(b"{\"apps\":[],\"from\":\"bundled\"}".to_vec()),
            _ => None,
        })
    }

    #[test]
    fn p5_s9_6_managed_mode_ignores_planted_shell_files_and_serves_deployment_and_apps_from_disk() {
        let data = tempfile::tempdir().unwrap();
        let site_dir = data.path().join("site");
        std::fs::create_dir_all(site_dir.join("assets")).unwrap();
        std::fs::create_dir_all(site_dir.join("sandbox/copilot")).unwrap();
        std::fs::create_dir_all(site_dir.join("apps/mail/dist")).unwrap();
        // Plant tampered shell files on disk in `<app data>/site/`.
        std::fs::write(site_dir.join("index.html"), b"<!doctype html>PLANTED-INDEX").unwrap();
        std::fs::write(site_dir.join("404.html"), b"<!doctype html>PLANTED-404").unwrap();
        std::fs::write(site_dir.join("assets/app.js"), b"alert('planted')").unwrap();
        std::fs::write(site_dir.join("assets/planted-only.js"), b"alert('extra')").unwrap();
        std::fs::write(site_dir.join("sandbox/proxy.html"), b"<p>planted-proxy</p>").unwrap();
        std::fs::write(
            site_dir.join("sandbox/copilot/index.html"),
            b"<script>planted()</script>",
        )
        .unwrap();
        std::fs::write(site_dir.join(".loam-shell-build"), b"sha256-test\n").unwrap();
        std::fs::write(site_dir.join(".loam-generation"), b"sha256-gen\n").unwrap();
        // Real managed artifacts on disk.
        std::fs::write(
            site_dir.join("deployment.json"),
            b"{\"apps\":[{\"instance\":\"mail\"}],\"from\":\"disk\"}",
        )
        .unwrap();
        std::fs::write(
            site_dir.join("apps/mail/dist/native.js"),
            b"export const app = 'mail';",
        )
        .unwrap();
        std::fs::write(data.path().join("mounts.json"), b"{\"secret\":true}").unwrap();

        let managed = Site::managed(&site_dir, bundled_lookup(), "'none'").unwrap();

        // Signed shell files come strictly from EmbeddedAssets, never from disk.
        let index = get(&managed, false, "/", "text/html");
        assert_eq!(index.status(), 200);
        assert_eq!(index.body().as_ref(), PAGE.as_bytes());
        assert!(!String::from_utf8_lossy(index.body()).contains("PLANTED"));

        let deep = get(&managed, false, "/personal/mail", "text/html");
        assert_eq!(deep.status(), 200);
        assert_eq!(deep.body().as_ref(), PAGE.as_bytes());

        let page_404 = get(&managed, false, "/404.html", "text/html");
        assert_eq!(page_404.status(), 200);
        assert!(String::from_utf8_lossy(page_404.body()).contains("Loam 404"));
        assert!(!String::from_utf8_lossy(page_404.body()).contains("PLANTED"));

        let asset = get(&managed, false, "/assets/app.js", "*/*");
        assert_eq!(asset.status(), 200);
        assert_eq!(asset.body().as_ref(), b"console.log('signed-shell');");
        assert_eq!(asset.headers()["content-security-policy"], INERT_POLICY);
        assert_eq!(
            get(&managed, false, "/assets/planted-only.js", "*/*").status(),
            404
        );

        let proxy = get(&managed, true, "/sandbox/proxy.html", "text/html");
        assert_eq!(proxy.status(), 200);
        assert_eq!(proxy.body().as_ref(), b"<p>signed-proxy</p>");

        let copilot = get(&managed, true, "/sandbox/copilot/index.html", "text/html");
        assert_eq!(copilot.status(), 200);
        assert_eq!(
            copilot.body().as_ref(),
            b"<script src=\"boot.js\"></script>"
        );
        assert_eq!(
            copilot.headers()["content-security-policy"],
            copilot_policy()
        );

        // `deployment.json` and `apps/*` come strictly from disk (never bundled's empty deployment.json).
        let deployment = get(&managed, false, "/deployment.json", "application/json");
        assert_eq!(deployment.status(), 200);
        assert_eq!(
            deployment.body().as_ref(),
            b"{\"apps\":[{\"instance\":\"mail\"}],\"from\":\"disk\"}"
        );
        assert_eq!(
            deployment.headers()["content-security-policy"],
            INERT_POLICY
        );

        let app_js = get(&managed, false, "/apps/mail/dist/native.js", "*/*");
        assert_eq!(app_js.status(), 200);
        assert_eq!(app_js.body().as_ref(), b"export const app = 'mail';");
        assert_eq!(app_js.headers()["content-security-policy"], INERT_POLICY);

        // Metadata markers and traversal paths are refused.
        assert_eq!(
            get(&managed, false, "/.loam-shell-build", "*/*").status(),
            404
        );
        assert_eq!(
            get(&managed, false, "/.loam-generation", "*/*").status(),
            404
        );
        assert_eq!(
            get(&managed, false, "/apps/mail/../../mounts.json", "*/*").status(),
            404
        );

        // Symlinks inside `apps/` cannot escape to `mounts.json` or `deployment.json`.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                data.path().join("mounts.json"),
                site_dir.join("apps/mail/escape.json"),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                site_dir.join("deployment.json"),
                site_dir.join("apps/mail/deploy-link.json"),
            )
            .unwrap();
            assert_eq!(
                get(&managed, false, "/apps/mail/escape.json", "*/*").status(),
                404
            );
            assert_eq!(
                get(&managed, false, "/apps/mail/deploy-link.json", "*/*").status(),
                404
            );
        }
    }

    #[test]
    fn p5_s9_6_managed_mode_rewrites_frame_src_in_memory_and_enforces_csp_ceiling() {
        let data = tempfile::tempdir().unwrap();
        let site_dir = data.path().join("site");
        std::fs::create_dir_all(&site_dir).unwrap();

        // Invalid frame-src values are refused at construction and rewrite time.
        for bad in [
            "https://evil.example",
            "*",
            "'self'",
            "loam://localhost",
            if cfg!(windows) {
                "loam-sandbox://localhost"
            } else {
                "http://loam-sandbox.localhost"
            },
        ] {
            assert!(
                Site::managed(&site_dir, bundled_lookup(), bad).is_none(),
                "{bad}"
            );
            assert!(rewrite_frame_src(PAGE, bad).is_none(), "{bad}");
        }

        // Rewriting to `sandbox_origin()` updates BOTH the `<meta>` tag in memory and the HTTP header.
        let managed = Site::managed(&site_dir, bundled_lookup(), sandbox_origin()).unwrap();
        let expected_meta = format!(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {}; object-src 'none'; base-uri 'none'",
            sandbox_origin()
        );
        let expected_header = format!("{expected_meta}; frame-ancestors 'none'");

        for path in ["/", "/index.html", "/404.html", "/personal/deep-route"] {
            let response = get(&managed, false, path, "text/html");
            assert_eq!(response.status(), 200, "{path}");
            assert_eq!(
                response.headers()["content-security-policy"],
                expected_header,
                "{path}"
            );
            let html = std::str::from_utf8(response.body()).unwrap();
            assert_eq!(meta_policy(html), Some(expected_meta.as_str()), "{path}");
        }

        // HEAD returns the same rewritten CSP header with an empty body.
        let head_req = Request::builder()
            .method("HEAD")
            .uri("loam://localhost/")
            .header("accept", "text/html")
            .body(Vec::new())
            .unwrap();
        let head_resp = serve(&managed, false, &head_req);
        assert_eq!(head_resp.status(), 200);
        assert_eq!(
            head_resp.headers()["content-security-policy"],
            expected_header
        );
        assert!(head_resp.body().is_empty());

        // Switching back to `'none'` narrows `frame-src` even if the source HTML held `sandbox_origin()`.
        let with_sandbox_html = PAGE.replace(
            "frame-src 'none'",
            &format!("frame-src {}", sandbox_origin()),
        );
        let narrowed = rewrite_frame_src(&with_sandbox_html, "'none'").unwrap();
        assert!(narrowed.contains("frame-src 'none';"));

        // The `build.rs` no-shell placeholder (`default-src 'none'`) is preserved untouched rather than widened.
        let placeholder = "<!doctype html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head>";
        assert_eq!(
            rewrite_frame_src(placeholder, sandbox_origin()).as_deref(),
            Some(placeholder)
        );
    }
}
