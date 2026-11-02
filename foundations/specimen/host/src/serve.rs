//! Serves bundle generations from memory on 127.0.0.1. Each render has its own path prefix
//! (`/r/<token>/`), so the server records exactly which files that render loaded, with digests.

use crate::bundle::Generation;
use anyhow::Result;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
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
            if rest
                .split('/')
                .any(|part| part == ".." || part.contains('\\'))
            {
                return None;
            }
            let mut file = dir.from.join(percent_decode(rest));
            if file.is_dir() {
                file.push("index.html");
            }
            let Ok(body) = std::fs::read(&file) else {
                continue;
            };
            let served = crate::bundle::served(body, &file.to_string_lossy());
            for slot in self.slots.lock().unwrap().values_mut() {
                slot.loaded
                    .insert(format!("static:{path}:{}", served.digest));
            }
            return Some(served);
        }
        None
    }
}

/// `%XX` escapes in a URL path, with anything else unchanged.
fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let escaped = (bytes[at] == b'%')
            .then(|| path.get(at + 1..at + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                out.push(byte);
                at += 3;
            }
            None => {
                out.push(bytes[at]);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
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
