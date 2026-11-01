//! Serves bundle generations from memory on 127.0.0.1. Each render has its own path prefix
//! (`/r/<token>/`), so the server records exactly which files that render loaded, with digests.

use crate::bundle::Generation;
use anyhow::Result;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Slot {
    generation: Arc<Generation>,
    loaded: BTreeSet<String>,
}

#[derive(Clone, Default)]
pub struct Renders(Arc<Mutex<HashMap<String, Slot>>>);

impl Renders {
    pub fn begin(&self, token: &str, generation: Arc<Generation>) {
        self.0.lock().unwrap().insert(
            token.to_string(),
            Slot {
                generation,
                loaded: BTreeSet::new(),
            },
        );
    }

    /// End a render and return `file:digest` for every file it requested, sorted.
    pub fn end(&self, token: &str) -> Vec<String> {
        self.0
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
        let mut renders = self.0.lock().unwrap();
        let slot = renders.get_mut(token)?;
        let served = slot.generation.files.get(file)?.clone();
        slot.loaded.insert(format!("{file}:{}", served.digest));
        Some(served)
    }
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
        match (method, renders.lookup(path)) {
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
