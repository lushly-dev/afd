//! Umbel's own MCP drivers (specification section 10). AFD's `tests/common` cannot be included:
//! it is `#![cfg(feature = "server")]` and builds its HTTP service from a bare `McpServer`, which
//! would skip Umbel's router, path, options and bearer layer.
//!
//! - [`Http`]: `tower::ServiceExt::oneshot` on `Host::http_router()`, with the bearer token
//!   added unless a test removes it.
//! - [`Client`]: one connection on one lane (HTTP or in-memory stdio, in either MCP era).
//!   The in-memory stdio driver serves `Host::mcp_server()` over two `tokio::io::duplex` pipes,
//!   speaking newline-delimited JSON-RPC; the real `serve_stdio` is covered by `process.rs`.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use axum::Router;
use axum::body::Body;
use http::{HeaderMap, Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tower::ServiceExt;
use umbel::Host;

/// `_meta` of a 2026-07-28 request.
pub fn modern_meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

/// What the router answered.
pub struct Reply {
    pub status: u16,
    pub headers: HeaderMap,
    pub text: String,
}

impl Reply {
    /// The JSON-RPC (or other JSON) body; a server-sent-event frame is unwrapped.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or_else(|_| {
            self.text
                .lines()
                .find_map(|line| line.strip_prefix("data: "))
                .and_then(|data| serde_json::from_str(data).ok())
                .unwrap_or(Value::Null)
        })
    }
}

/// `Host::http_router()` driven in process.
#[derive(Clone)]
pub struct Http {
    router: Router,
    token: Option<String>,
    host: String,
}

impl Http {
    /// The router of `host` with its own bearer token and `Host: localhost`.
    pub fn new(host: &Host) -> Self {
        let router = host.http_router().unwrap();
        let token = std::fs::read_to_string(host.workspace().layout().http_token()).unwrap();
        Self {
            router,
            token: Some(token),
            host: "localhost".to_owned(),
        }
    }

    /// Send this token instead of the right one; `None` sends none.
    pub fn with_token(mut self, token: Option<&str>) -> Self {
        self.token = token.map(str::to_owned);
        self
    }

    pub fn with_host(mut self, host: &str) -> Self {
        self.host = host.to_owned();
        self
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    /// Send `request` as it is.
    pub async fn send(&self, request: Request<Body>) -> Reply {
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            headers,
            text: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }

    /// POST `body` to `path` with the driver's token and host, then `headers`.
    pub async fn post_to(&self, path: &str, body: &Value, headers: &[(&str, &str)]) -> Reply {
        let mut request = Request::post(path)
            .header("host", &self.host)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream");
        if let Some(token) = &self.token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        self.send(request.body(Body::from(body.to_string())).unwrap())
            .await
    }

    /// POST `body` to `/mcp`.
    pub async fn post(&self, body: &Value, headers: &[(&str, &str)]) -> Reply {
        self.post_to("/mcp", body, headers).await
    }

    /// GET `path` with the driver's token and host.
    pub async fn get(&self, path: &str) -> Reply {
        let mut request = Request::get(path).header("host", &self.host);
        if let Some(token) = &self.token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        self.send(request.body(Body::empty()).unwrap()).await
    }

    /// A 2026-07-28 request; the `Mcp-*` headers come from the body. The status must be 200.
    pub async fn modern(&self, method: &str, params: Value) -> Value {
        let reply = self.modern_reply(method, params, &[]).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()
    }

    pub async fn modern_reply(
        &self,
        method: &str,
        mut params: Value,
        extra_headers: &[(&str, &str)],
    ) -> Reply {
        let name = params["name"].as_str().map(str::to_owned);
        // A test that sets its own `_meta` (client capabilities, say) keeps it.
        if params.get("_meta").is_none() {
            params["_meta"] = modern_meta();
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
        self.post(&body, &headers).await
    }

    /// A 2025-11-25 request on the stateless endpoint.
    pub async fn legacy(&self, method: &str, params: Value) -> Value {
        let name = params["name"].as_str().map(str::to_owned);
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut headers = vec![("mcp-protocol-version", "2025-11-25")];
        if let Some(name) = name.as_deref() {
            headers.push(("mcp-name", name));
        }
        let reply = self.post(&body, &headers).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.json()
    }
}

/// A 2025-style stdio connection over an in-memory pipe.
pub struct Stdio {
    writer: DuplexStream,
    reader: BufReader<DuplexStream>,
    next_id: u64,
}

impl Stdio {
    /// A connection that has not opened: for 2026-07-28 requests, which carry their own `_meta`.
    pub fn connect_modern(host: &Host) -> Self {
        use rmcp::ServiceExt;
        let server = host.mcp_server();
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
    pub async fn connect(host: &Host) -> Self {
        let mut client = Self::connect_modern(host);
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
            .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await;
        client
    }

    async fn send(&mut self, message: &Value) {
        self.writer
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
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

/// The two transports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    Http,
    Stdio,
}

/// The two MCP eras.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Era {
    /// 2026-07-28: stateless, every request carries its `_meta`.
    Modern,
    /// 2025-11-25: `initialize` first.
    Legacy,
}

/// A connection on one lane.
pub struct Client {
    pub transport: Transport,
    pub era: Era,
    http: Option<Http>,
    stdio: Option<Stdio>,
}

/// Every lane: HTTP and stdio, in both eras.
pub const LANES: [(Transport, Era); 4] = [
    (Transport::Http, Era::Modern),
    (Transport::Stdio, Era::Modern),
    (Transport::Http, Era::Legacy),
    (Transport::Stdio, Era::Legacy),
];

impl Client {
    pub async fn connect(host: &Host, transport: Transport, era: Era) -> Self {
        let mut client = Self {
            transport,
            era,
            http: None,
            stdio: None,
        };
        match (transport, era) {
            (Transport::Http, _) => {
                let http = Http::new(host);
                if era == Era::Legacy {
                    let initialize = http
                        .post(
                            &json!({
                                "jsonrpc": "2.0",
                                "id": 0,
                                "method": "initialize",
                                "params": {
                                    "protocolVersion": "2025-11-25",
                                    "capabilities": {},
                                    "clientInfo": { "name": "legacy", "version": "0" },
                                },
                            }),
                            &[],
                        )
                        .await;
                    assert_eq!(initialize.status, 200, "{}", initialize.text);
                    assert_eq!(initialize.json()["result"]["protocolVersion"], "2025-11-25");
                }
                client.http = Some(http);
            }
            (Transport::Stdio, Era::Modern) => client.stdio = Some(Stdio::connect_modern(host)),
            (Transport::Stdio, Era::Legacy) => client.stdio = Some(Stdio::connect(host).await),
        }
        client
    }

    /// Every lane connected to `host`.
    pub async fn lanes(host: &Host) -> Vec<Self> {
        let mut clients = Vec::new();
        for (transport, era) in LANES {
            clients.push(Self::connect(host, transport, era).await);
        }
        clients
    }

    pub fn label(&self) -> String {
        format!("{:?} {:?}", self.transport, self.era)
    }

    /// The JSON-RPC response to `method`.
    pub async fn request(&mut self, method: &str, params: Value) -> Value {
        match (&self.http, &mut self.stdio, self.era) {
            (Some(http), _, Era::Modern) => http.modern(method, params).await,
            (Some(http), _, Era::Legacy) => http.legacy(method, params).await,
            (None, Some(stdio), Era::Modern) => {
                let mut params = params;
                params["_meta"] = modern_meta();
                stdio.request(method, params).await
            }
            (None, Some(stdio), Era::Legacy) => stdio.request(method, params).await,
            (None, None, _) => unreachable!("a client has a transport"),
        }
    }

    /// The tool names of `tools/list`, in order.
    pub async fn tool_names(&mut self) -> Vec<String> {
        let response = self.request("tools/list", json!({})).await;
        tool_names(&response)
    }

    /// The raw `tools/call` response.
    pub async fn call_raw(&mut self, tool: &str, arguments: Value) -> Value {
        self.request(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        )
        .await
    }

    /// The `CommandResult` of a `tools/call`, which must equal the response's
    /// `structuredContent`.
    pub async fn call(&mut self, tool: &str, arguments: Value) -> Value {
        let response = self.call_raw(tool, arguments).await;
        let result = command_result(&response);
        assert_eq!(
            response["result"]["structuredContent"], result,
            "structuredContent equals the text: {response}"
        );
        result
    }

    /// `afd-call`: the command through the meta-tool.
    pub async fn afd_call(&mut self, command: &str, input: Value) -> Value {
        self.call("afd-call", json!({ "command": command, "input": input }))
            .await
    }
}

pub fn tool_names(response: &Value) -> Vec<String> {
    response["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("no tools: {response}"))
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

/// The `CommandResult` carried as JSON text in a `tools/call` response.
pub fn command_result(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("no text content: {response}")),
    )
    .unwrap()
}
