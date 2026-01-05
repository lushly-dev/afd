use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use afd::{CommandRegistry, CommandContext};
use std::sync::Arc;
use crate::commands;

#[derive(Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub name: String,
    pub version: String,
}

pub async fn start_server(registry: CommandRegistry) {
    let registry = Arc::new(registry);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/message", post(move |body| message_handler(body, Arc::clone(&registry))))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], 3100));
    println!("Starting Todo Rust Backend Server at http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        name: "todo-app-rust".to_string(),
        version: "1.0.0".to_string(),
    })
}

async fn message_handler(
    Json(payload): Json<JsonRpcRequest>,
    registry: Arc<CommandRegistry>,
) -> Json<JsonRpcResponse> {
    if payload.method != "tools/call" {
        return Json(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: payload.id,
            result: None,
            error: Some(serde_json::json!({
                "code": -32601,
                "message": "Method not found"
            })),
        });
    }

    let params = payload.params;
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let arguments = params.get("arguments").cloned().unwrap_or(serde_json::Value::Null);

    let result = registry.execute(name, arguments, None).await;

    // Wrap the result in MCP content format
    let mcp_result = serde_json::json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string(&result).unwrap()
            }
        ]
    });

    Json(JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: payload.id,
        result: Some(mcp_result),
        error: None,
    })
}
