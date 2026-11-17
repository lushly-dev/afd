//! The `loam` and `loam-sandbox` custom protocols (phase 6 specification, 10.2). Both read one site: the
//! deployer's `<app data>/site` when it holds an `index.html`, else the empty shell bundled in the binary.
//! A path resolves with `canonicalize` inside the site's directory, so no path, encoded or through a
//! symbolic link, reaches `mounts.json` or anything else beside the site. The headers are the hosted
//! server's (`host/src/headers.ts`): a shell page's `<meta>` policy plus `frame-ancestors 'none'`, the
//! sandbox's pages framed only by the shell, and every other file inert.
use percent_encoding::percent_decode_str;
use std::borrow::Cow;
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

const FRAME_ANCESTORS_NONE: &str = "frame-ancestors 'none'";
const INERT_POLICY: &str = "sandbox; default-src 'none'; frame-ancestors 'none'";

/// The bundled shell's files, by relative path.
pub type Lookup = Box<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

/// Where the site's files come from.
pub enum Site {
    /// The deployer's `<app data>/site`, canonical.
    Directory(PathBuf),
    /// The empty shell compiled into the binary, read through this lookup by relative path.
    Bundled(Lookup),
}

impl Site {
    /// The deployer's site when it has an `index.html`, else `bundled`.
    pub fn choose(directory: &Path, bundled: Lookup) -> Self {
        match directory.canonicalize() {
            Ok(root) if root.join("index.html").is_file() => Site::Directory(root),
            _ => Site::Bundled(bundled),
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

/// The `<meta>` policy of a shell page, refused as the hosted server refuses it (`metaPolicy`): not exactly
/// one tag, no content, an entity or a line break, or a directive only a header may carry.
pub fn meta_policy(html: &str) -> Option<&str> {
    let lower = html.to_ascii_lowercase();
    let mut tags = Vec::new();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<meta") {
        let start = from + start;
        let end = start + lower[start..].find('>')?;
        let tag = &lower[start..end];
        if tag.contains("http-equiv=\"content-security-policy\"")
            || tag.contains("http-equiv='content-security-policy'")
        {
            tags.push((start, end));
        }
        from = end;
    }
    let [(start, end)] = tags.as_slice() else {
        return None;
    };
    let tag = &html[*start..*end];
    let content = tag.split("content=\"").nth(1)?.split('"').next()?;
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
    (!header_only).then_some(content)
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
    let Some((name, bytes)) = found else {
        return not_found();
    };
    let shell_page = !sandbox && (name == "index.html" || name == "404.html");
    let policy = if sandbox {
        // No request of the proxy's own, and so no IPC, whatever its page's <meta> says: a header and a <meta>
        // policy both apply, and a view's srcdoc document inherits it (10.2).
        format!("connect-src 'none'; frame-ancestors {}", shell_origin())
    } else if shell_page {
        let Ok(html) = std::str::from_utf8(&bytes) else {
            return not_found();
        };
        let Some(meta) = meta_policy(html) else {
            return not_found();
        };
        format!("{meta}; {FRAME_ANCESTORS_NONE}")
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

    const PAGE: &str = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self' ipc: http://ipc.localhost\"><title>Loam</title>";

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
            "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; frame-ancestors 'none'"
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
}
