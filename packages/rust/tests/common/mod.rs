//! Shared drivers for the `server` feature tests: Streamable HTTP in process, and a
//! stdio-shaped connection (newline-delimited JSON-RPC over an in-memory pipe).
#![cfg(feature = "server")]
#![allow(dead_code)]

use afd::server::{HttpOptions, McpServer};
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tower::ServiceExt;

#[cfg(feature = "server-auth")]
pub mod auth;

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
    modern_post_with_meta(server, method, params, json!({}), extra_headers).await
}

/// [`modern_post`] with `meta` keys added to (or replacing those of) the request's `_meta`.
pub async fn modern_post_with_meta(
    server: &McpServer,
    method: &str,
    params: Value,
    meta: Value,
    extra_headers: &[(&str, &str)],
) -> Value {
    let name = params["name"].as_str().map(str::to_owned);
    let mut params = params;
    params["_meta"] = serde_json::from_str(META).unwrap();
    if let Value::Object(extra) = meta {
        for (key, value) in extra {
            params["_meta"][key] = value;
        }
    }
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
    /// A connection that has not opened: for 2026-07-28 requests, which carry their own `_meta`.
    pub fn connect_modern(server: McpServer) -> Self {
        use rmcp::ServiceExt;
        let (client_writer, server_reader) = tokio::io::duplex(1 << 20);
        let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
        tokio::spawn(async move {
            let Ok(running) = server.serve((server_reader, server_writer)).await else {
                return;
            };
            let _ = running.waiting().await;
        });
        Self {
            writer: client_writer,
            reader: BufReader::new(client_reader),
            next_id: 0,
        }
    }

    /// A 2025 connection: `initialize`, then `notifications/initialized`.
    pub async fn connect(server: McpServer) -> Self {
        Self::connect_with(server, json!({})).await
    }

    /// A 2025 connection whose `initialize` declares `capabilities`.
    pub async fn connect_with(server: McpServer, capabilities: Value) -> Self {
        let mut client = Self::connect_modern(server);
        let initialize = client
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": capabilities,
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

/// A 2025 stdio connection whose client declares form elicitation and answers each
/// `elicitation/create` with what `answer` returns for its params (it may wait first); returns the
/// call's response and the questions asked.
pub async fn legacy_call_with<F, Fut>(
    server: McpServer,
    params: Value,
    mut answer: F,
) -> (Value, Vec<Value>)
where
    F: FnMut(Value) -> Fut,
    Fut: std::future::Future<Output = Value>,
{
    use rmcp::ServiceExt;
    let (mut writer, server_reader) = tokio::io::duplex(1 << 20);
    let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
    tokio::spawn(async move {
        if let Ok(running) = server.serve((server_reader, server_writer)).await {
            let _ = running.waiting().await;
        }
    });
    let mut reader = BufReader::new(client_reader);
    let send = |message: Value| format!("{message}\n");
    let mut asked = Vec::new();
    let initialize = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-11-25",
        "capabilities": { "elicitation": { "form": {} } },
        "clientInfo": { "name": "legacy", "version": "0" },
    }});
    writer.write_all(send(initialize).as_bytes()).await.unwrap();
    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    writer
        .write_all(send(initialized).as_bytes())
        .await
        .unwrap();
    let call = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": params });
    writer.write_all(send(call).as_bytes()).await.unwrap();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).await.unwrap() > 0);
        let message: Value = serde_json::from_str(&line).unwrap();
        if message["method"] == "elicitation/create" {
            asked.push(message["params"].clone());
            let result = answer(message["params"].clone()).await;
            let reply = json!({ "jsonrpc": "2.0", "id": message["id"], "result": result });
            writer.write_all(send(reply).as_bytes()).await.unwrap();
        } else if message["id"] == 2 {
            return (message, asked);
        }
    }
}

/// [`legacy_call_with`] answering with each of `answers` in turn, then cancelling.
pub async fn legacy_call(
    server: McpServer,
    params: Value,
    answers: Vec<Value>,
) -> (Value, Vec<Value>) {
    let mut answers = answers.into_iter();
    legacy_call_with(server, params, move |_| {
        let next = answers.next().unwrap_or(json!({ "action": "cancel" }));
        async move { next }
    })
    .await
}
