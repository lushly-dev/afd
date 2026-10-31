//! Shared drivers for the `server` feature tests: Streamable HTTP in process, and a
//! stdio-shaped connection (newline-delimited JSON-RPC over an in-memory pipe).
#![cfg(feature = "server")]
#![allow(dead_code)]

use afd::server::{HttpOptions, McpServer};
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tower::ServiceExt;

pub const META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

/// POST one JSON-RPC request to the server's Streamable HTTP service.
pub async fn http_post(server: &McpServer, body: Value, headers: &[(&str, &str)]) -> (u16, Value) {
    let service = server.streamable_http_service(HttpOptions::default());
    let mut request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let request = request
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap();
    let response = service.oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    });
    (status, json)
}

/// A 2026-07-28 request over HTTP; the `Mcp-*` headers are derived from the body.
pub async fn modern_post(
    server: &McpServer,
    method: &str,
    params: Value,
    extra_headers: &[(&str, &str)],
) -> Value {
    let name = params["name"].as_str().map(str::to_owned);
    let mut params = params;
    params["_meta"] = serde_json::from_str(META).unwrap();
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let mut headers = vec![
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = name.as_deref() {
        headers.push(("mcp-name", name));
    }
    headers.extend_from_slice(extra_headers);
    let (status, body) = http_post(server, body, &headers).await;
    assert_eq!(status, 200, "{body}");
    body
}

/// The `CommandResult` carried as JSON text in a `tools/call` response.
pub fn command_result(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("null"),
    )
    .unwrap()
}

/// A 2025-style stdio connection to `server` over an in-memory pipe.
pub struct Stdio {
    writer: DuplexStream,
    reader: BufReader<DuplexStream>,
    next_id: u64,
}

impl Stdio {
    pub async fn connect(server: McpServer) -> Self {
        use rmcp::ServiceExt;
        let (client_writer, server_reader) = tokio::io::duplex(1 << 20);
        let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
        tokio::spawn(async move {
            let running = server.serve((server_reader, server_writer)).await.unwrap();
            let _ = running.waiting().await;
        });
        let mut client = Self {
            writer: client_writer,
            reader: BufReader::new(client_reader),
            next_id: 0,
        };
        let initialize = client
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": "test", "version": "0" },
                }),
            )
            .await;
        assert!(initialize["result"].is_object(), "{initialize}");
        client
            .send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await;
        client
    }

    async fn send(&mut self, message: Value) {
        self.writer
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await;
        loop {
            let mut line = String::new();
            let read = self.reader.read_line(&mut line).await.unwrap();
            assert!(read > 0, "the server closed the connection");
            let message: Value = serde_json::from_str(&line).unwrap();
            if message["id"] == id {
                return message;
            }
        }
    }
}
