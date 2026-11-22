//! A scripted HTTP/1.1 server on loopback for testing `mail-unsubscribe`
//! one-click POSTs (RFC 8058; the specification's 9.5 and 14).
//!
//! Records every request received (method, path, headers, body) and supports
//! fault injection (2xx, 3xx redirect, 429, 4xx, 5xx, drop after receiving
//! request, stall without replying) so tests can verify exact wire format,
//! redirect refusal, error mapping, and `SEND_OUTCOME_UNKNOWN`.

#![allow(dead_code, clippy::expect_used, clippy::unwrap_used)]

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// One HTTP request received by the scripted server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedHttpRequest {
    pub method: String,
    pub target: String,
    pub host: Option<String>,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// How the scripted HTTP server responds to the next request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpBehavior {
    /// Reply with `status` and optional response body text.
    Status { status: u16, body: String },
    /// Reply with a 3xx redirect pointing to `location`.
    Redirect { status: u16, location: String },
    /// Read the request, record it, then close the TCP connection without a reply.
    DropAfterRequest,
    /// Read the request, record it, then stall until the client closes.
    StallAfterRequest,
}

/// Shared state of the scripted HTTP server.
#[derive(Debug)]
pub struct HttpWorld {
    pub received: Vec<ReceivedHttpRequest>,
    pub behavior: HttpBehavior,
    pub connections: usize,
}

impl Default for HttpWorld {
    fn default() -> Self {
        Self {
            received: Vec::new(),
            behavior: HttpBehavior::Status {
                status: 200,
                body: "ok".to_string(),
            },
            connections: 0,
        }
    }
}

/// Running scripted HTTP server on loopback.
pub struct HttpServer {
    pub address: SocketAddr,
    pub world: Arc<Mutex<HttpWorld>>,
}

impl HttpServer {
    /// Starts the scripted HTTP server on `127.0.0.1:0`.
    pub fn start() -> Self {
        let world = Arc::new(Mutex::new(HttpWorld::default()));
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        std_listener.set_nonblocking(true).expect("non-blocking");
        let address = std_listener.local_addr().expect("an address");
        let shared = Arc::clone(&world);
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a runtime");
            runtime.block_on(async move {
                let listener = TcpListener::from_std(std_listener).expect("a listener");
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        return;
                    };
                    shared.lock().unwrap().connections += 1;
                    tokio::spawn(serve(stream, Arc::clone(&shared)));
                }
            });
        });
        Self { address, world }
    }

    pub fn world(&self) -> std::sync::MutexGuard<'_, HttpWorld> {
        self.world.lock().unwrap()
    }

    pub fn received(&self) -> Vec<ReceivedHttpRequest> {
        self.world().received.clone()
    }
}

async fn serve(stream: TcpStream, world: Arc<Mutex<HttpWorld>>) {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    let mut request_line = String::new();
    if !matches!(reader.read_line(&mut request_line).await, Ok(n) if n > 0) {
        return;
    }
    let parts: Vec<&str> = request_line
        .trim_end_matches(['\r', '\n'])
        .split(' ')
        .collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0].to_string();
    let target = parts[1].to_string();

    let mut host = None;
    let mut content_type = None;
    let mut content_length: usize = 0;

    loop {
        let mut line = String::new();
        if !matches!(reader.read_line(&mut line).await, Ok(n) if n > 0) {
            return;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("host") {
                host = Some(value);
            } else if name.eq_ignore_ascii_case("content-type") {
                content_type = Some(value);
            } else if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length.min(1024 * 1024)];
    if !body.is_empty() && reader.read_exact(&mut body).await.is_err() {
        return;
    }

    let behavior = {
        let mut guard = world.lock().unwrap();
        guard.received.push(ReceivedHttpRequest {
            method,
            target,
            host,
            content_type,
            body,
        });
        guard.behavior.clone()
    };

    match behavior {
        HttpBehavior::Status { status, body } => {
            let response = format!(
                "HTTP/1.1 {status} Scripted\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = write.write_all(response.as_bytes()).await;
            let _ = write.shutdown().await;
        }
        HttpBehavior::Redirect { status, location } => {
            let response = format!(
                "HTTP/1.1 {status} Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = write.write_all(response.as_bytes()).await;
            let _ = write.shutdown().await;
        }
        HttpBehavior::DropAfterRequest => {
            let _ = write.shutdown().await;
        }
        HttpBehavior::StallAfterRequest => {
            let mut drain = [0u8; 16];
            let _ = reader.read(&mut drain).await;
        }
    }
}
