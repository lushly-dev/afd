//! Serves bundle generations from memory on 127.0.0.1. Each render has its own path prefix
//! (`/r/<token>/`), so the server records exactly which files that render loaded, with digests.

use crate::bundle::Generation;
use anyhow::Result;
use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Slot {
    generation: Arc<Generation>,
    loaded: BTreeSet<String>,
}

/// A directory served at the page's origin, as Storybook's `staticDirs`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct StaticDir {
    from: PathBuf,
    to: String,
}

#[derive(Clone, Default)]
pub struct Renders {
    slots: Arc<Mutex<HashMap<String, Slot>>>,
    static_dirs: Arc<Vec<StaticDir>>,
}

impl Renders {
    pub fn new(static_dirs: Vec<StaticDir>) -> Renders {
        Renders {
            slots: Arc::default(),
            static_dirs: Arc::new(static_dirs),
        }
    }

    pub fn begin(&self, token: &str, generation: Arc<Generation>) {
        self.slots.lock().unwrap().insert(
            token.to_string(),
            Slot {
                generation,
                loaded: BTreeSet::new(),
            },
        );
    }

    /// End a render and return `file:digest` for every file it requested, sorted.
    pub fn end(&self, token: &str) -> Vec<String> {
        self.slots
            .lock()
            .unwrap()
            .remove(token)
            .map(|slot| slot.loaded.into_iter().collect())
            .unwrap_or_default()
    }

    fn lookup(&self, path: &str) -> Option<crate::bundle::ServedFile> {
        let rest = path.strip_prefix("/r/")?;
        let (token, file) = rest.split_once('/')?;
        let file = file.split(['?', '#']).next().unwrap_or(file);
        let mut renders = self.slots.lock().unwrap();
        let slot = renders.get_mut(token)?;
        let served = slot.generation.files.get(file)?.clone();
        slot.loaded.insert(format!("{file}:{}", served.digest));
        Some(served)
    }

    /// A file under a static directory. The path a page asks for has no render token, so the
    /// file counts as loaded by every render in progress.
    fn static_file(&self, path: &str) -> Option<crate::bundle::ServedFile> {
        let path = path.split(['?', '#']).next().unwrap_or(path);
        for dir in self.static_dirs.iter() {
            let prefix = dir.to.trim_end_matches('/');
            let Some(rest) = path.strip_prefix(prefix) else {
                continue;
            };
            if !(rest.is_empty() || rest.starts_with('/')) {
                continue;
            }
            let rest = rest.trim_start_matches('/');
            let decoded = percent_decode_strict(rest)?;
            let segments = validated_relative_segments(&decoded)?;
            let Ok(canonical_root) = std::fs::canonicalize(&dir.from) else {
                continue;
            };
            let mut file = canonical_root.clone();
            for segment in segments {
                file.push(segment);
            }
            let Ok(mut resolved) = std::fs::canonicalize(&file) else {
                continue;
            };
            let mut served_name = file;
            if resolved.is_dir() {
                served_name.push("index.html");
                let Ok(index) = std::fs::canonicalize(resolved.join("index.html")) else {
                    continue;
                };
                resolved = index;
            }
            if !resolved.starts_with(&canonical_root) || !resolved.is_file() {
                return None;
            }
            let Ok(body) = std::fs::read(&resolved) else {
                continue;
            };
            let served = crate::bundle::served(body, &served_name.to_string_lossy());
            for slot in self.slots.lock().unwrap().values_mut() {
                slot.loaded
                    .insert(format!("static:{path}:{}", served.digest));
            }
            return Some(served);
        }
        None
    }
}

/// Validate a decoded relative URL path and return its safe path segments.
/// Returns `None` on traversal (`..`, `.`), empty interior segments, backslashes,
/// leading slashes, NUL/control characters, or Windows drive-prefixed segments.
fn validated_relative_segments(decoded: &str) -> Option<Vec<&str>> {
    if decoded.starts_with('/') || decoded.contains('\\') || decoded.chars().any(char::is_control) {
        return None;
    }
    let trimmed = decoded.strip_suffix('/').unwrap_or(decoded);
    if trimmed.is_empty() {
        return Some(Vec::new());
    }
    let mut segments = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        let bytes = part.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return None;
        }
        segments.push(part);
    }
    if !Path::new(trimmed)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return None;
    }
    Some(segments)
}

/// Strict `%XX` decoder for a URL path: requires two ASCII hex digits after `%`,
/// and rejects NUL bytes and invalid UTF-8.
fn percent_decode_strict(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let hex = path.get(at + 1..at + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            let byte = u8::from_str_radix(hex, 16).ok()?;
            if byte == 0 {
                return None;
            }
            out.push(byte);
            at += 3;
        } else {
            if bytes[at] == 0 {
                return None;
            }
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub async fn start(renders: Renders) -> Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let renders = renders.clone();
            tokio::spawn(async move {
                let _ = connection(stream, renders).await;
            });
        }
    });
    Ok(origin)
}

/// A minimal HTTP/1.1 GET server with keep-alive: enough for a browser loading static files.
async fn connection(mut stream: TcpStream, renders: Renders) -> Result<()> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let end = loop {
            if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break end;
            }
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Ok(());
            }
            buffer.extend_from_slice(&chunk[..read]);
        };
        let head = String::from_utf8_lossy(&buffer[..end]).to_string();
        buffer.drain(..end + 4);
        let mut parts = head.lines().next().unwrap_or("").split_whitespace();
        let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
        let close = head.to_ascii_lowercase().contains("connection: close");
        let served = renders.lookup(path).or_else(|| renders.static_file(path));
        match (method, served) {
            ("GET" | "HEAD", Some(file)) => {
                let header = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: {}\r\ncontent-length: {}\r\ncache-control: no-store\r\naccess-control-allow-origin: *\r\n\r\n",
                    file.content_type,
                    file.body.len()
                );
                stream.write_all(header.as_bytes()).await?;
                if method == "GET" {
                    stream.write_all(&file.body).await?;
                }
            }
            _ => {
                stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n")
                    .await?;
            }
        }
        if close {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "specimen-serve-test-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn percent_decode_strict_requires_two_ascii_hex_digits() {
        assert_eq!(
            percent_decode_strict("hello%20world").as_deref(),
            Some("hello world")
        );
        assert!(percent_decode_strict("%+A").is_none());
        assert!(percent_decode_strict("%-1").is_none());
        assert!(percent_decode_strict("%00").is_none());
        assert!(percent_decode_strict("%ZZ").is_none());
        assert!(percent_decode_strict("%2").is_none());
    }

    #[test]
    fn static_file_serves_confined_files_and_rejects_encoded_traversal() {
        let base = temp_dir("traversal");
        let secret = base.join("secret.txt");
        let public = base.join("public");
        let sub = public.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&secret, b"TOP-SECRET").unwrap();
        std::fs::write(public.join("hello world.txt"), b"hello").unwrap();
        std::fs::write(sub.join("index.html"), b"<h1>ok</h1>").unwrap();

        let renders = Renders::new(vec![StaticDir {
            from: public.clone(),
            to: "/site".to_string(),
        }]);

        // Legitimate files and directory index
        let served = renders.static_file("/site/hello%20world.txt").unwrap();
        assert_eq!(served.body.as_slice(), b"hello");
        let idx = renders.static_file("/site/sub/").unwrap();
        assert_eq!(idx.body.as_slice(), b"<h1>ok</h1>");

        // Raw, percent-encoded, double-encoded, malformed, and drive-prefix traversal attacks (#1876)
        for bad in [
            "/site/../secret.txt",
            "/site/%2e%2e/secret.txt",
            "/site/%2E%2E%2Fsecret.txt",
            "/site/%252e%252e/secret.txt",
            "/site/..%2fsecret.txt",
            "/site/..%5csecret.txt",
            "/site/%2e/hello%20world.txt",
            "/site/sub//index.html",
            "/site/%2fetc/passwd",
            "/site/hello%00.txt",
            "/site/bad%ZZ.txt",
            "/site/truncated%2",
            "/site/C:secret.txt",
            "/site/sub/C:secret.txt",
        ] {
            assert!(
                renders.static_file(bad).is_none(),
                "expected traversal path to be rejected: {bad}"
            );
        }

        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn static_file_rejects_symlinks_escaping_root_and_preserves_in_root_mime() {
        use std::os::unix::fs::symlink;

        let base = temp_dir("symlink");
        let secret = base.join("secret.txt");
        let public = base.join("public");
        let sub = public.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&secret, b"TOP-SECRET").unwrap();
        std::fs::write(public.join("blob"), b"export const x = 1;").unwrap();
        symlink(&secret, public.join("escape.txt")).unwrap();
        symlink(&secret, sub.join("index.html")).unwrap();
        symlink(public.join("blob"), public.join("mod.js")).unwrap();

        let renders = Renders::new(vec![StaticDir {
            from: public.clone(),
            to: "/site".to_string(),
        }]);

        assert!(renders.static_file("/site/escape.txt").is_none());
        assert!(renders.static_file("/site/sub/").is_none());
        let aliased = renders.static_file("/site/mod.js").unwrap();
        assert_eq!(aliased.body.as_slice(), b"export const x = 1;");
        assert!(
            aliased.content_type.contains("javascript"),
            "expected javascript MIME from served name, got {}",
            aliased.content_type
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
