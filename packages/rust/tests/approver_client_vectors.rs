//! The language-neutral vectors in `spec/vectors/approver-client.json`: the approval display rules
//! and approval evidence from an approver client (`spec/command-metadata.md`; Loam phase 5, step
//! 0c).
//!
//! The display cases run with any features. The carrier cases run over MCP 2026-07-28 Streamable
//! HTTP behind the bearer layer (the `server-auth` feature), so each caller's credentials are the
//! verified ones of its own token, and each case gets a server of its own.

use std::path::PathBuf;

use serde_json::Value;

fn load_vectors() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/approver-client.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

#[test]
fn records_the_documented_gap_of_the_languages_that_skip_it() {
    let vectors = load_vectors();
    let mut gaps: Vec<&String> = vectors["gaps"].as_object().unwrap().keys().collect();
    gaps.sort();
    assert_eq!(gaps, ["cpp", "python"]);
}

#[test]
fn display_verdicts_match() {
    let vectors = load_vectors();
    let limits = &vectors["display"]["limits"];
    let ours = afd::APPROVAL_DISPLAY_LIMITS;
    assert_eq!(limits["maxSerializedLength"], ours.max_serialized_length);
    assert_eq!(limits["maxStringLength"], ours.max_string_length);
    assert_eq!(limits["maxKeyLength"], ours.max_key_length);
    assert_eq!(limits["maxDepth"], ours.max_depth);
    assert_eq!(limits["maxValues"], ours.max_values);
    let cases = vectors["display"]["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let verdict = match afd::approval_display(&case["input"]) {
            Ok(_) => "shown",
            Err(refusal) => refusal.as_str(),
        };
        assert_eq!(verdict, case["expected"], "{}", case["description"]);
    }
}

#[cfg(all(feature = "server-auth", feature = "approval"))]
mod common;

#[cfg(all(feature = "server-auth", feature = "approval"))]
mod carrier {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use afd::server::{McpServer, ToolStrategy, AFD_APPROVAL_META_KEY};
    use afd::{
        approval_id, create_approval_middleware, fixed_clock, success, ApprovalMiddlewareOptions,
        ApprovalPolicy, ApprovalRelay, ApprovalSummary, ApprovalVia, CommandContext,
        CommandDefinition, CommandHandler, CommandParameter, CommandRegistry, CommandResult,
    };
    use async_trait::async_trait;
    use base64::Engine;
    use bytes::Bytes;
    use http_body_util::Full;
    use serde_json::{json, Value};

    use super::common::auth::{claims, ec256, header, send, sign};
    use super::common::command_result;
    use super::load_vectors;

    struct Counted(Arc<AtomicUsize>);

    #[async_trait]
    impl CommandHandler for Counted {
        async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
            self.0.fetch_add(1, Ordering::SeqCst);
            success(input)
        }
    }

    /// What `on_approval_accepted` was told: each summary and dispatch id, in order.
    type Accepted = Arc<Mutex<Vec<(ApprovalSummary, Option<String>)>>>;

    /// One server with the vectors' commands, approvers and approval middleware.
    fn server(carrier: &Value) -> (McpServer, Arc<AtomicUsize>) {
        server_noting(carrier, None)
    }

    /// [`server`], with an `on_approval_accepted` hook that notes each admission in `accepted`.
    fn server_noting(carrier: &Value, accepted: Option<Accepted>) -> (McpServer, Arc<AtomicUsize>) {
        let runs = Arc::new(AtomicUsize::new(0));
        let registry = CommandRegistry::new();
        let mut delete = CommandDefinition::new(
            "todo-delete",
            "Delete a todo",
            vec![CommandParameter::required_number("id", "Todo ID")],
            Counted(Arc::clone(&runs)),
        )
        .as_mutation()
        .with_approval(ApprovalPolicy::Required);
        delete.expose.mcp = true;
        registry.register(delete).unwrap();
        let mut list = CommandDefinition::new(
            "todo-list",
            "List todos",
            vec![],
            Counted(Arc::clone(&runs)),
        );
        list.expose.mcp = true;
        registry.register(list).unwrap();
        let mut options =
            ApprovalMiddlewareOptions::new(carrier["secret"].as_str().unwrap(), registry.list())
                .with_ttl_ms(carrier["ttlMs"].as_u64().unwrap())
                .with_clock(fixed_clock(carrier["now"].as_i64().unwrap()))
                .with_relay(ApprovalRelay::McpElicitation)
                .with_include_token(false);
        if let Some(accepted) = accepted {
            options = options.with_on_approval_accepted(move |summary, dispatch_id| {
                accepted.lock().unwrap().push((summary, dispatch_id));
                Box::pin(async { Ok(()) })
            });
        }
        registry.add_middleware(create_approval_middleware(options).unwrap());
        let approvers: Vec<String> = carrier["callers"]
            .as_object()
            .unwrap()
            .values()
            .filter(|caller| caller["approver"] == true)
            .map(|caller| {
                caller["credentials"]["clientId"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        let server = McpServer::new(Arc::new(registry), "approver-client-vectors", "1.0.0")
            .with_tool_strategy(ToolStrategy::Individual)
            .with_authorization(super::common::auth::authorization())
            .with_approver(move |context| {
                context
                    .credentials
                    .as_deref()
                    .is_some_and(|credentials| approvers.contains(&credentials.client_id))
            });
        (server, runs)
    }

    /// The bearer token of a caller: valid claims with its subject and client.
    fn bearer(caller: &Value) -> String {
        let mut claims = claims();
        claims["iss"] = caller["credentials"]["issuer"].clone();
        claims["sub"] = caller["credentials"]["subject"].clone();
        claims["client_id"] = caller["credentials"]["clientId"].clone();
        sign(&header("ES256", "ec256"), &claims, ec256())
    }

    fn request(step: &Value, bearer: &str, approval: Option<&str>) -> http::Request<Full<Bytes>> {
        let tool = step["tool"].as_str().unwrap();
        let capabilities = if step["elicit"] == true {
            json!({ "elicitation": {} })
        } else {
            json!({})
        };
        let mut meta = json!({
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": capabilities,
        });
        if let Some(approval) = approval {
            meta[AFD_APPROVAL_META_KEY] = json!(approval);
        }
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": tool, "arguments": step["arguments"], "_meta": meta },
        });
        http::Request::post("/mcp")
            .header("host", "localhost")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2026-07-28")
            .header("mcp-method", "tools/call")
            .header("mcp-name", tool)
            .header("authorization", format!("Bearer {bearer}"))
            .body(Full::new(Bytes::from(body.to_string())))
            .unwrap()
    }

    fn payload_of(token: &str) -> Value {
        let encoded = token.split('.').nth(1).unwrap();
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn carrier_cases_hold() {
        let vectors = load_vectors();
        let carrier = &vectors["carrier"];
        let cases = carrier["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let description = case["description"].as_str().unwrap();
            let (server, runs) = server(carrier);
            let mut tokens: Vec<Option<String>> = Vec::new();
            for (index, step) in case["steps"].as_array().unwrap().iter().enumerate() {
                let at = format!("{description}, step {index}");
                let approval = match &step["approval"] {
                    Value::String(token) => Some(token.clone()),
                    Value::Object(reference) => {
                        let from = reference["token"].as_u64().unwrap() as usize;
                        Some(
                            tokens[from]
                                .clone()
                                .unwrap_or_else(|| panic!("{at}: no token")),
                        )
                    }
                    _ => None,
                };
                let caller = &carrier["callers"][step["caller"].as_str().unwrap()];
                let answer =
                    send(&server, request(step, &bearer(caller), approval.as_deref())).await;
                assert_eq!(answer.status, 200, "{at}: {}", answer.text);
                let result = command_result(&answer.body);
                let token = result["error"]["details"]["approvalToken"]
                    .as_str()
                    .map(str::to_owned);
                let expected = &step["expected"];
                if expected["success"] == true {
                    assert_eq!(result["success"], true, "{at}: {result}");
                } else {
                    assert_eq!(result["error"]["code"], expected["code"], "{at}: {result}");
                    if let Some(wanted) = expected["token"].as_bool() {
                        assert_eq!(token.is_some(), wanted, "{at}: {result}");
                    }
                    assert_eq!(
                        result["error"]["details"]["reason"], expected["reason"],
                        "{at}: {result}"
                    );
                }
                if let Some(wanted) = expected.get("payload") {
                    let mut payload = payload_of(token.as_deref().unwrap());
                    let nonce = payload.as_object_mut().unwrap().remove("n").unwrap();
                    assert_eq!(&payload, wanted, "{at}");
                    let nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD
                        .decode(nonce.as_str().unwrap())
                        .unwrap();
                    assert_eq!(nonce.len(), 16, "{at}");
                }
                assert_eq!(
                    runs.load(Ordering::SeqCst) as u64,
                    step["runs"].as_u64().unwrap(),
                    "{at}"
                );
                tokens.push(token);
            }
        }
    }

    /// The dispatch id format (`spec/dispatch.md`, "The dispatch id"): 21 base64url characters,
    /// then one of `AQgw`.
    fn well_formed(id: &str) -> bool {
        let base64url = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
        id.len() == 22 && id.chars().take(21).all(base64url) && id.ends_with(['A', 'Q', 'g', 'w'])
    }

    /// An approver's carried token (`_meta["dev.afd/approval"]`) is reported to
    /// `on_approval_accepted` as `via: token`, with the approval id of the token's nonce, the
    /// call's dispatch id and no nonce (TypeScript: "reports an approver's carried token to
    /// onApprovalAccepted as via token").
    #[tokio::test]
    async fn reports_an_approvers_carried_token_to_the_accepted_hook_as_via_token() {
        let vectors = load_vectors();
        let carrier = &vectors["carrier"];
        let accepted: Accepted = Arc::default();
        let (server, runs) = server_noting(carrier, Some(Arc::clone(&accepted)));
        let shell = bearer(&carrier["callers"]["shell"]);
        let step = json!({ "tool": "todo-delete", "arguments": { "id": 7 } });
        let answer = send(&server, request(&step, &shell, None)).await;
        assert_eq!(answer.status, 200, "{}", answer.text);
        let held = command_result(&answer.body);
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        let token = held["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap_or_else(|| panic!("an approver gets its token: {held}"))
            .to_owned();
        assert!(accepted.lock().unwrap().is_empty(), "a hold admits nothing");
        let answer = send(&server, request(&step, &shell, Some(&token))).await;
        assert_eq!(answer.status, 200, "{}", answer.text);
        let ran = command_result(&answer.body);
        assert_eq!(ran["success"], true, "{ran}");
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        let nonce = payload_of(&token)["n"].as_str().unwrap().to_owned();
        let accepted = accepted.lock().unwrap();
        assert_eq!(accepted.len(), 1, "one admission, one call");
        let (summary, dispatch_id) = &accepted[0];
        assert_eq!(summary.via, ApprovalVia::Token);
        assert_eq!(summary.command, "todo-delete");
        assert_eq!(summary.approval_id, approval_id(&nonce));
        assert!(
            dispatch_id.as_deref().is_some_and(well_formed),
            "{dispatch_id:?}"
        );
        let text = serde_json::to_string(summary).unwrap();
        assert!(
            !text.contains(&nonce),
            "the summary holds the nonce: {text}"
        );
        assert!(
            !text.contains(&token),
            "the summary holds the token: {text}"
        );
    }
}
