//! The decision before dispatch for a host's own HTTP layer (`spec/authorization.md`, M6, "A
//! host's own layer"; Umbel phase 5's follow-up of 2026-11-08): `McpServer::pre_dispatch_check`.
//!
//! A host layer that verifies the same token itself, admits the same credentials and runs the
//! check must answer every request exactly as the bearer layer does: the same status, headers and
//! body bytes, the same questions put to the resolver, and the same requests passed on. Each
//! request is sent through both, in every tool strategy, under the static rule and under a
//! resolver that names a scope for every command it is asked about and hides some from callers
//! without `secret:see`, with and without required scopes. A hidden command and a name that does
//! not exist are answered alike, and the resolver is never asked about either.
#![cfg(feature = "server-auth")]

mod common;

use std::convert::Infallible;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use afd::server::auth::{
    Authorization, Credentials, PreDispatch, PreDispatchCheck, ScopeChallenge, ScopeDecision,
    ScopeResolver, TokenVerifier,
};
use afd::server::{ConfirmationMode, HttpOptions, McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use bytes::Bytes;
use common::auth::*;
use common::command_result;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

const STRATEGIES: [ToolStrategy; 4] = [
    ToolStrategy::Individual,
    ToolStrategy::Grouped,
    ToolStrategy::Lazy,
    ToolStrategy::Hybrid,
];

/// The commands the resolver hides from a caller without `secret:see`.
const HIDDEN: [&str; 2] = ["vault-open", "vault-seal"];

struct Ran;

#[async_trait]
impl CommandHandler for Ran {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({ "subject": context.credentials.map(|c| c.subject.clone()) }))
    }
}

/// `todo-list` (`todo:read`), `todo-create` (`todo:write`), `todo-purge` (`todo:admin`),
/// `todo-defer`, `vault-open` (`vault:open`), `vault-seal` (`vault:seal`), `memo-peek` (in the
/// category `vault-open`, so in the grouped strategy a visible group bears a hidden command's
/// name), and `secret-rotate`, which is not exposed to MCP.
fn registry() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    let exposed = |name: &str, scopes: &[&str]| {
        let mut command = CommandDefinition::new(name, format!("{name} command"), vec![], Ran)
            .with_scopes(scopes.iter().copied());
        command.expose.mcp = true;
        command
    };
    for command in [
        exposed("todo-list", &["todo:read"]),
        exposed("todo-create", &["todo:write"]).as_mutation(),
        exposed("todo-purge", &["todo:admin"]).as_mutation(),
        exposed("todo-defer", &[]),
        exposed("memo-peek", &[]).with_category("vault-open"),
        exposed("vault-open", &["vault:open"]),
        exposed("vault-seal", &["vault:seal"]),
        CommandDefinition::new("secret-rotate", "Private", vec![], Ran)
            .with_scopes(["secret:rotate"]),
    ] {
        registry.register(command).unwrap();
    }
    afd::register_bootstrap_commands(&registry).unwrap();
    registry
}

/// Names `need:<command>` for every command it is asked about unless the caller holds it,
/// defers `todo-defer`, allows the meta-tools, and hides [`HIDDEN`] from a caller without
/// `secret:see`. Every question is recorded.
struct Naming(Arc<Mutex<Vec<String>>>);

impl ScopeResolver for Naming {
    fn resolve(&self, command: &str, _input: &Value, credentials: &Credentials) -> ScopeDecision {
        self.0.lock().unwrap().push(command.to_owned());
        let need = format!("need:{command}");
        if command == "todo-defer" {
            ScopeDecision::Defer
        } else if command.starts_with("afd-") || credentials.has_scope(&need) {
            ScopeDecision::Allowed
        } else {
            ScopeDecision::Missing(vec![need])
        }
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        !HIDDEN.contains(&command) || credentials.has_scope("secret:see")
    }
}

/// The rule a server under test decides with.
#[derive(Clone, Copy, Debug)]
enum Rule {
    Static,
    Static403Required,
    Resolver,
    ResolverRequired,
}

/// A server under test, with what its resolver was asked.
struct Served {
    server: McpServer,
    authorization: Authorization,
    asked: Arc<Mutex<Vec<String>>>,
}

fn served(strategy: ToolStrategy, rule: Rule) -> Served {
    let asked = Arc::new(Mutex::new(Vec::new()));
    let mut authorization = authorization().with_max_body_bytes(4096);
    if matches!(rule, Rule::Static403Required | Rule::ResolverRequired) {
        authorization = authorization.with_required_scopes(["todo:read"]).unwrap();
    }
    if matches!(rule, Rule::Resolver | Rule::ResolverRequired) {
        authorization = authorization
            .with_resolver(Naming(Arc::clone(&asked)))
            .with_filter_tools_by_scope(true);
    }
    let mut server = McpServer::new(registry(), "todo", "1.0.0").with_tool_strategy(strategy);
    if strategy == ToolStrategy::Hybrid {
        server = server.with_first_class_tools(["todo-create", "todo-list", "vault-open"]);
    }
    Served {
        server: server.with_authorization(authorization.clone()),
        authorization,
        asked,
    }
}

type Body = BoxBody<Bytes, Infallible>;
type Request = http::Request<Full<Bytes>>;

type Echo = tower::util::BoxCloneService<Request, http::Response<Full<Bytes>>, Infallible>;

/// The service behind both layers: counts what reaches it and echoes the admitted subject, and
/// whether a token reached it.
fn echo(reached: Arc<AtomicUsize>) -> Echo {
    Echo::new(tower::service_fn(move |request: Request| {
        reached.fetch_add(1, Ordering::SeqCst);
        let subject = request
            .extensions()
            .get::<Credentials>()
            .map(|credentials| credentials.subject.clone());
        let token = request.headers().get("authorization").is_some();
        async move {
            Ok::<_, Infallible>(http::Response::new(Full::new(Bytes::from(
                json!({ "passed": subject, "token": token }).to_string(),
            ))))
        }
    }))
}

fn boxed(response: http::Response<Full<Bytes>>) -> http::Response<Body> {
    response.map(|body| body.map_err(|never| match never {}).boxed())
}

/// A host's own layer: it verifies the bearer token with the same verifier (so it admits the
/// same credentials as the bearer layer), reads the body, and runs `check`.
async fn through_host(
    check: &PreDispatchCheck,
    authorization: &Authorization,
    reached: Arc<AtomicUsize>,
    request: Request,
) -> http::Response<Body> {
    let (mut parts, body) = request.into_parts();
    let token = parts
        .headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap()
        .to_owned();
    let credentials = verifier().verify(&token, &parts).await.unwrap();
    parts.headers.remove("authorization");
    authorization.admit(&mut parts.extensions, credentials);
    let bytes = body.collect().await.unwrap().to_bytes();
    match check.decide(&parts, &bytes) {
        PreDispatch::Respond(response) => boxed(response),
        PreDispatch::Proceed => boxed(
            echo(reached)
                .oneshot(http::Request::from_parts(parts, Full::new(bytes)))
                .await
                .unwrap(),
        ),
    }
}

/// What a caller sees of a response, all of it.
#[derive(Debug, PartialEq)]
struct Seen {
    status: u16,
    headers: http::HeaderMap,
    body: Bytes,
    reached: usize,
    asked: Vec<String>,
}

async fn seen(response: http::Response<Body>, reached: &AtomicUsize, asked: Vec<String>) -> Seen {
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    Seen {
        status,
        headers,
        body,
        reached: reached.load(Ordering::SeqCst),
        asked,
    }
}

impl Served {
    /// The answer through the bearer layer, then through a host layer running the check.
    async fn both(&self, request: impl Fn() -> Request) -> (Seen, Seen) {
        let bearer = {
            self.asked.lock().unwrap().clear();
            let reached = Arc::new(AtomicUsize::new(0));
            let layer = self.server.bearer_layer().unwrap();
            let service = tower::Layer::layer(&layer, echo(Arc::clone(&reached)));
            let response = service.oneshot(request()).await.unwrap();
            let asked = self.asked.lock().unwrap().clone();
            seen(response, &reached, asked).await
        };
        let host = {
            self.asked.lock().unwrap().clear();
            let reached = Arc::new(AtomicUsize::new(0));
            let check = self.server.pre_dispatch_check().unwrap();
            let response =
                through_host(&check, &self.authorization, Arc::clone(&reached), request()).await;
            let asked = self.asked.lock().unwrap().clone();
            seen(response, &reached, asked).await
        };
        (bearer, host)
    }
}

fn call(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

fn raw(method: &str, body: Vec<u8>, token: &str) -> Request {
    http::Request::builder()
        .method(method)
        .uri("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Full::new(Bytes::from(body)))
        .unwrap()
}

/// Every `tools/call` the matrix sends, naming `name` on every route that can.
fn calls_naming(name: &str) -> Vec<Value> {
    let action = name.split_once('-').map_or(name, |(_, action)| action);
    let group = name.split_once('-').map_or(name, |(group, _)| group);
    vec![
        call(name, json!({})),
        call(name, json!({ "action": action, "params": {} })),
        call(group, json!({ "action": action, "params": {} })),
        call("afd-call", json!({ "command": name, "input": {} })),
        call(
            "afd-batch",
            json!({ "commands": [{ "command": name }, { "command": "todo-create", "input": {} }] }),
        ),
        call(
            "afd-pipe",
            json!({ "steps": [{ "command": "todo-list" }, { "command": name }] }),
        ),
        call("afd-detail", json!({ "command": name })),
    ]
}

/// Every request body the matrix sends.
fn bodies() -> Vec<Vec<u8>> {
    let mut params: Vec<Value> = Vec::new();
    for name in [
        "todo-list",
        "todo-create",
        "todo-purge",
        "todo-defer",
        "memo-peek",
        "vault-open",
        "vault-seal",
        "secret-rotate",
        "ghost-gone",
    ] {
        params.extend(calls_naming(name));
    }
    params.extend([
        // Several missing scopes in one batch and one pipeline.
        call(
            "afd-batch",
            json!({ "commands": [
                { "command": "todo-purge" },
                { "command": "todo-list" },
                { "command": "todo-create" },
                { "command": "todo-purge" },
            ] }),
        ),
        call(
            "afd-pipe",
            json!({ "steps": [{ "command": "todo-create" }, { "command": "todo-purge" }] }),
        ),
        // Malformed meta-tool calls, decided under the tool's own name.
        call("afd-batch", json!({ "commands": [] })),
        call("afd-batch", json!({ "commands": [{ "input": {} }] })),
        call("afd-call", json!({})),
        call("todo", json!({})),
        call("todo", json!({ "action": "nothing" })),
        call("vault", json!({})),
        call("afd-discover", json!({})),
        json!({ "name": "todo-list" }),
        json!({ "arguments": {} }),
    ]);
    let mut bodies: Vec<Vec<u8>> = params
        .into_iter()
        .map(|params| {
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params })
                .to_string()
                .into_bytes()
        })
        .collect();
    for method in [
        "tools/list",
        "initialize",
        "resources/list",
        "server/discover",
    ] {
        bodies.push(
            json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": {} })
                .to_string()
                .into_bytes(),
        );
    }
    bodies.extend([
        // A JSON-RPC batch, refused before anything is decided.
        json!([{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("todo-purge", json!({})) }])
            .to_string()
            .into_bytes(),
        b"{ not json".to_vec(),
        Vec::new(),
        // Over the authorization's 4096-byte cap.
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("todo-list", json!({ "pad": "x".repeat(5000) })) })
            .to_string()
            .into_bytes(),
    ]);
    bodies
}

fn tokens() -> Vec<String> {
    [
        "todo:read",
        "todo:read todo:write",
        "todo:write",
        "other:x",
        "todo:read todo:write todo:admin vault:open",
        "todo:read secret:see",
        "todo:read need:todo-list need:todo-create need:vault-open",
        "secret:see need:vault-open need:vault-seal vault:open",
    ]
    .into_iter()
    .map(|scopes| token_with_scope(Some(scopes)))
    .collect()
}

#[tokio::test]
async fn a_host_layer_running_the_check_answers_exactly_as_the_bearer_layer() {
    let bodies = bodies();
    let tokens = tokens();
    let mut decided = [0usize; 4];
    for strategy in STRATEGIES {
        for rule in [
            Rule::Static,
            Rule::Static403Required,
            Rule::Resolver,
            Rule::ResolverRequired,
        ] {
            let served = served(strategy, rule);
            for token in &tokens {
                for method in ["POST", "GET", "DELETE"] {
                    for body in &bodies {
                        if method != "POST" && !body.is_empty() && body.len() < 4096 {
                            continue;
                        }
                        let (bearer, host) = served.both(|| raw(method, body.clone(), token)).await;
                        assert_eq!(
                            bearer,
                            host,
                            "{strategy:?} {rule:?} {method} {}",
                            String::from_utf8_lossy(&body[..body.len().min(300)])
                        );
                        match bearer.status {
                            403 => decided[0] += 1,
                            400 => decided[1] += 1,
                            413 => decided[2] += 1,
                            _ => decided[3] += 1,
                        }
                    }
                }
            }
        }
    }
    // Every kind of answer was compared, many times.
    assert!(decided.iter().all(|count| *count > 20), "{decided:?}");
}

#[tokio::test]
async fn a_hidden_command_and_a_missing_name_are_decided_alike_and_never_asked_about() {
    // A caller without `secret:see` (hidden) and one with it, under a resolver that would name
    // `need:vault-open` if it were asked.
    let reader = token_with_scope(Some("todo:read"));
    let stranger = token_with_scope(Some("other:x"));
    for strategy in STRATEGIES {
        for rule in [Rule::Resolver, Rule::ResolverRequired] {
            let served = served(strategy, rule);
            for token in [&reader, &stranger] {
                for hidden in HIDDEN {
                    for (named, absent) in calls_naming(hidden)
                        .into_iter()
                        .zip(calls_naming("ghost-gone"))
                    {
                        let body = |params: &Value| {
                            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params })
                                .to_string()
                                .into_bytes()
                        };
                        let (bearer, host) = served.both(|| raw("POST", body(&named), token)).await;
                        assert_eq!(bearer, host, "{strategy:?} {rule:?} {named}");
                        let (gone, _) = served.both(|| raw("POST", body(&absent), token)).await;
                        // The same answer, and no question about either name.
                        assert_eq!(
                            (host.status, &host.headers, &host.body, host.reached),
                            (gone.status, &gone.headers, &gone.body, gone.reached),
                            "{strategy:?} {rule:?} {named}"
                        );
                        assert!(
                            !host.asked.iter().any(|asked| asked == hidden),
                            "{strategy:?} {rule:?} {named}: {:?}",
                            host.asked
                        );
                        assert!(!gone.asked.iter().any(|asked| asked == "ghost-gone"));
                        assert!(!String::from_utf8_lossy(&host.body).contains("need:vault"));
                    }
                }
            }
        }
    }
    // A caller who may see them is asked about and refused naming the scope.
    let served = served(ToolStrategy::Individual, Rule::Resolver);
    let seer = token_with_scope(Some("todo:read secret:see"));
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("vault-open", json!({})) })
        .to_string()
        .into_bytes();
    let (bearer, host) = served.both(|| raw("POST", body.clone(), &seer)).await;
    assert_eq!(bearer, host);
    assert_eq!(host.status, 403);
    assert_eq!(host.asked, ["vault-open"]);
    assert_eq!(
        host.headers["www-authenticate"],
        format!(
            "Bearer error=\"insufficient_scope\", scope=\"need:vault-open\", resource_metadata=\"{METADATA_URL}\""
        )
    );
}

#[tokio::test]
async fn a_grouped_call_that_resolves_to_no_command_never_asks_the_resolver() {
    // The router runs nothing for these and answers an unknown or ambiguous action, or a group's
    // missing action; the resolver would name `need:<tool>` if it were asked about the tool,
    // whose name may be a hidden command's (`vault-open`, also the name of `memo-peek`'s group)
    // or a group's.
    let reader = token_with_scope(Some("todo:read"));
    let seer = token_with_scope(Some("todo:read secret:see"));
    for rule in [Rule::Resolver, Rule::ResolverRequired] {
        let served = served(ToolStrategy::Grouped, rule);
        for (token, params) in [
            (&reader, call("vault-open", json!({ "action": "open" }))),
            (&reader, call("vault-open", json!({ "action": "nope" }))),
            (&reader, call("vault-open", json!({}))),
            (&seer, call("vault-open", json!({ "action": "nope" }))),
            (&reader, call("vault", json!({ "action": "open" }))),
            (&seer, call("vault", json!({ "action": "nope" }))),
            (&seer, call("vault", json!({}))),
            (&reader, call("todo", json!({ "action": "nope" }))),
            (&reader, call("todo", json!({}))),
            (&reader, call("todo-list", json!({ "action": "x" }))),
            (&reader, call("ghost-gone", json!({ "action": "gone" }))),
        ] {
            let body =
                json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params })
                    .to_string()
                    .into_bytes();
            let (bearer, host) = served.both(|| raw("POST", body.clone(), token)).await;
            assert_eq!(bearer, host, "{params}");
            assert_eq!(host.asked, Vec::<String>::new(), "{rule:?} {params}");
            assert_eq!(host.status, 200, "{rule:?} {params}");
        }
        // Without the required scope, the 403 names it alone.
        if matches!(rule, Rule::ResolverRequired) {
            let other = token_with_scope(Some("other:x secret:see"));
            let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("vault-open", json!({ "action": "nope" })) })
                .to_string()
                .into_bytes();
            let (_, host) = served.both(|| raw("POST", body.clone(), &other)).await;
            assert_eq!(host.status, 403);
            assert_eq!(host.asked, Vec::<String>::new());
            assert!(host.headers["www-authenticate"]
                .to_str()
                .unwrap()
                .contains("scope=\"todo:read\""));
        }
    }
}

/// A host check over `served`'s server, with the gateway's challenge and suggestion.
fn gateway(strategy: ToolStrategy, rule: Rule) -> (Served, PreDispatchCheck) {
    let mut served = served(strategy, rule);
    let source = "a new assertion from the gateway";
    let authorization = Authorization::new(metadata().with_scope_source(source), verifier())
        .unwrap()
        .with_max_body_bytes(4096)
        .with_required_scopes(["todo:read"])
        .unwrap();
    served.server = served.server.with_authorization(authorization.clone());
    served.authorization = authorization;
    let challenge = ScopeChallenge::new("Umbel-Gateway")
        .unwrap()
        .with_param("realm", "umbel")
        .unwrap();
    let check = served
        .server
        .pre_dispatch_check()
        .unwrap()
        .with_challenge(challenge);
    (served, check)
}

#[tokio::test]
async fn a_host_challenge_changes_only_the_403s_challenge() {
    let (served, check) = gateway(ToolStrategy::Individual, Rule::Static);
    let token = token_with_scope(Some("todo:read"));
    let send = |body: Vec<u8>| {
        let reached = Arc::new(AtomicUsize::new(0));
        let request = raw("POST", body, &token);
        let check = check.clone();
        let authorization = served.authorization.clone();
        async move {
            let response =
                through_host(&check, &authorization, Arc::clone(&reached), request).await;
            seen(response, &reached, Vec::new()).await
        }
    };
    let batch = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("afd-batch", json!({ "commands": [
        { "command": "todo-purge" }, { "command": "todo-create" }, { "command": "todo-list" },
    ] })) });
    let host = send(batch.to_string().into_bytes()).await;
    let (bearer, _) = served
        .both(|| raw("POST", batch.to_string().into_bytes(), &token))
        .await;
    assert_eq!(host.status, 403);
    assert_eq!(host.reached, 0);
    assert_eq!(
        host.headers["www-authenticate"],
        "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"todo:admin todo:write\""
    );
    assert_eq!(
        bearer.headers["www-authenticate"],
        format!("Bearer error=\"insufficient_scope\", scope=\"todo:admin todo:write\", resource_metadata=\"{METADATA_URL}\"")
    );
    // The body is the bearer layer's, with the host's suggestion.
    assert_eq!(host.body, bearer.body);
    assert_eq!(
        serde_json::from_slice::<Value>(&host.body).unwrap(),
        json!({
            "error": "INSUFFICIENT_SCOPE",
            "suggestion": "Obtain a new assertion from the gateway that also grants todo:admin todo:write, then retry.",
        })
    );
    assert_eq!(host.headers.len(), 2, "{:?}", host.headers);
    assert_eq!(host.headers["content-type"], "application/json");
    // A missing required scope: the same challenge.
    let other = token_with_scope(Some("other:x"));
    let reached = Arc::new(AtomicUsize::new(0));
    let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} });
    let response = through_host(
        &check,
        &served.authorization,
        Arc::clone(&reached),
        raw("POST", list.to_string().into_bytes(), &other),
    )
    .await;
    let other = seen(response, &reached, Vec::new()).await;
    assert_eq!(other.status, 403);
    assert_eq!(
        other.headers["www-authenticate"],
        "Umbel-Gateway realm=\"umbel\", error=\"insufficient_scope\", scope=\"todo:read\""
    );
    // Every other answer is the bearer layer's, with no challenge.
    for body in [
        json!([{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }])
            .to_string()
            .into_bytes(),
        vec![b' '; 5000],
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("todo-list", json!({})) })
            .to_string()
            .into_bytes(),
    ] {
        let host = send(body.clone()).await;
        let (bearer, _) = served.both(|| raw("POST", body.clone(), &token)).await;
        assert_eq!(host, bearer);
        assert!(host.headers.get("www-authenticate").is_none());
    }
}

#[tokio::test]
async fn the_check_decides_only_credentials_admitted_for_its_own_authorization() {
    let served = served(ToolStrategy::Individual, Rule::Static);
    let check = served.server.pre_dispatch_check().unwrap();
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("todo-purge", json!({})) })
        .to_string();
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60)
        .with_scopes(["todo:read"]);
    let decide = |admit: &dyn Fn(&mut http::Extensions)| -> PreDispatch {
        let mut parts = http::Request::post("/mcp").body(()).unwrap().into_parts().0;
        admit(&mut parts.extensions);
        check.decide(&parts, body.as_bytes())
    };
    // Admitted for this server's authorization: decided.
    assert!(matches!(
        decide(&|extensions| served.authorization.admit(extensions, credentials.clone())),
        PreDispatch::Respond(response) if response.status() == 403
    ));
    // Not admitted, or admitted for another authorization: not decided here, and the server
    // refuses the request itself (M1).
    let other = authorization();
    let unmarked = |extensions: &mut http::Extensions| {
        extensions.insert(credentials.clone());
    };
    let foreign = |extensions: &mut http::Extensions| other.admit(extensions, credentials.clone());
    let none = |_: &mut http::Extensions| {};
    assert!(matches!(decide(&unmarked), PreDispatch::Proceed));
    assert!(matches!(decide(&foreign), PreDispatch::Proceed));
    assert!(matches!(decide(&none), PreDispatch::Proceed));
    let service = served
        .server
        .streamable_http_service(HttpOptions::default());
    let mut request = post("tools/call", call("todo-purge", json!({})), None);
    other.admit(request.extensions_mut(), credentials.clone());
    let answer = send_to(service, request).await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "UNAUTHORIZED",
        "{}",
        answer.text
    );
    // Only POST is decided, as the bearer layer decides it.
    let mut parts = http::Request::get("/mcp").body(()).unwrap().into_parts().0;
    served
        .authorization
        .admit(&mut parts.extensions, credentials.clone());
    assert!(matches!(
        check.decide(&parts, body.as_bytes()),
        PreDispatch::Proceed
    ));
    // The authorization's cap holds for every method, as the bearer layer's read does.
    assert!(matches!(
        check.decide(&parts, &[b' '; 4097]),
        PreDispatch::Respond(response) if response.status() == 413
    ));
    assert!(matches!(
        check.decide(&parts, &[b' '; 4096]),
        PreDispatch::Proceed
    ));
}

#[tokio::test]
async fn a_host_layer_with_the_check_refuses_before_dispatch_and_passes_the_rest_to_the_server() {
    let served = served(ToolStrategy::Grouped, Rule::Static403Required);
    let check = served.server.pre_dispatch_check().unwrap();
    let service = served
        .server
        .streamable_http_service(HttpOptions::default());
    let token = token_with_scope(Some("todo:read"));
    let send = |params: Value| {
        let check = check.clone();
        let service = service.clone();
        let authorization = served.authorization.clone();
        let request = post("tools/call", params, Some(&token));
        async move {
            let (mut parts, body) = request.into_parts();
            let token = parts.headers.remove("authorization").unwrap();
            let token = token.to_str().unwrap().strip_prefix("Bearer ").unwrap();
            let credentials = verifier().verify(token, &parts).await.unwrap();
            authorization.admit(&mut parts.extensions, credentials);
            let bytes = body.collect().await.unwrap().to_bytes();
            match check.decide(&parts, &bytes) {
                PreDispatch::Respond(response) => {
                    let mut once = Some(response);
                    send_to(
                        tower::service_fn(move |_: Request| {
                            let response = once.take().unwrap();
                            async move { Ok::<_, Infallible>(response) }
                        }),
                        post("tools/list", json!({}), None),
                    )
                    .await
                }
                PreDispatch::Proceed => {
                    send_to(service, http::Request::from_parts(parts, Full::new(bytes))).await
                }
            }
        }
    };
    let refused = send(call("todo", json!({ "action": "create", "params": {} }))).await;
    assert_eq!(refused.status, 403, "{}", refused.text);
    assert_eq!(
        refused.challenge(),
        format!("Bearer error=\"insufficient_scope\", scope=\"todo:write\", resource_metadata=\"{METADATA_URL}\"")
    );
    let listed = send(call("todo", json!({ "action": "list", "params": {} }))).await;
    assert_eq!(listed.status, 200, "{}", listed.text);
    let result = command_result(&listed.body);
    assert_eq!(result["data"]["subject"], "user-1", "{result}");
}

/// Counts its runs.
struct Counted(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Counted {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!(true))
    }
}

/// Lists a command only to a caller holding `need:<command>`, knows every command, and names
/// `need:<command>` for a call that lacks it: every command is one the caller may step up to.
struct Stepping;

impl ScopeResolver for Stepping {
    fn resolve(&self, command: &str, _input: &Value, credentials: &Credentials) -> ScopeDecision {
        let need = format!("need:{command}");
        if command.starts_with("afd-") || credentials.has_scope(&need) {
            ScopeDecision::Allowed
        } else {
            ScopeDecision::Missing(vec![need])
        }
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        credentials.has_scope(&format!("need:{command}"))
    }

    fn known(&self, _command: &str, _credentials: &Credentials) -> bool {
        true
    }
}

#[tokio::test]
async fn a_group_named_after_a_command_with_no_listed_member_is_decided_as_that_command() {
    // In the grouped strategy the group `ops-reset` holds `ops-reset` (a confirmation prompt)
    // and `ops-wipe`, so `ops-reset` is both a group and a command. When the caller is shown no
    // member, the router runs the command `ops-reset` for a call without an `action`: it must be
    // decided as that command, before dispatch and after routing, never as an unresolved group.
    for (rule, scope) in [("static", "ops:reset"), ("resolver", "need:ops-reset")] {
        let runs = Arc::new(AtomicUsize::new(0));
        let registry = Arc::new(CommandRegistry::new());
        for (name, scopes) in [("ops-reset", "ops:reset"), ("ops-wipe", "ops:wipe")] {
            let mut command = CommandDefinition::new(
                name,
                format!("{name} command"),
                vec![],
                Counted(Arc::clone(&runs)),
            )
            .with_scopes([scopes])
            .with_category("ops-reset")
            .as_mutation();
            if name == "ops-reset" {
                command = command.with_confirm_prompt("Reset everything?");
            }
            command.expose.mcp = true;
            registry.register(command).unwrap();
        }
        afd::register_bootstrap_commands(&registry).unwrap();
        let mut authorization = authorization().with_filter_tools_by_scope(true);
        if rule == "resolver" {
            authorization = authorization.with_resolver(Stepping);
        }
        let server = McpServer::new(registry, "ops", "1.0.0")
            .with_tool_strategy(ToolStrategy::Grouped)
            .with_confirmations(ConfirmationMode::Enforce)
            .with_authorization(authorization.clone());
        let token = token_with_scope(Some("todo:read"));
        let request = || post("tools/call", call("ops-reset", json!({})), Some(&token));

        // The bearer layer: a 403 before dispatch naming the command's scope.
        let bearer = send(&server, request()).await;
        assert_eq!(bearer.status, 403, "{rule}: {}", bearer.text);
        assert_eq!(
            bearer.challenge(),
            format!("Bearer error=\"insufficient_scope\", scope=\"{scope}\", resource_metadata=\"{METADATA_URL}\""),
            "{rule}"
        );

        // A host layer running the check: the same answer.
        let check = server.pre_dispatch_check().unwrap();
        let (mut parts, body) = request().into_parts();
        let presented = parts.headers.remove("authorization").unwrap();
        let presented = presented.to_str().unwrap().strip_prefix("Bearer ").unwrap();
        let credentials = verifier().verify(presented, &parts).await.unwrap();
        authorization.admit(&mut parts.extensions, credentials.clone());
        let bytes = body.collect().await.unwrap().to_bytes();
        let PreDispatch::Respond(response) = check.decide(&parts, &bytes) else {
            panic!("{rule}: the host layer let the call through");
        };
        let host = seen(boxed(response), &AtomicUsize::new(0), Vec::new()).await;
        assert_eq!(host.status, bearer.status, "{rule}");
        assert_eq!(host.headers, bearer.headers, "{rule}");
        assert_eq!(host.body, Bytes::from(bearer.text.clone()), "{rule}");

        // After routing alone (a host layer without the check): INSUFFICIENT_SCOPE, before the
        // confirmation gate, so no person is asked.
        let service = server.streamable_http_service(HttpOptions::default());
        let mut admitted = request();
        admitted.headers_mut().remove("authorization");
        authorization.admit(admitted.extensions_mut(), credentials.clone());
        let answer = send_to(service, admitted).await;
        let result = command_result(&answer.body);
        assert_eq!(
            result["error"]["code"], "INSUFFICIENT_SCOPE",
            "{rule}: {}",
            answer.text
        );
        assert_eq!(
            result["error"]["details"]["scopes"],
            json!([scope]),
            "{rule}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0, "{rule}");

        // Shown a member, the same call is the group's missing action: nothing runs.
        let holder = token_with_scope(Some("todo:read ops:reset need:ops-reset need:ops-wipe"));
        let grouped = send(
            &server,
            post("tools/call", call("ops-reset", json!({})), Some(&holder)),
        )
        .await;
        assert_eq!(grouped.status, 200, "{rule}: {}", grouped.text);
        assert_eq!(
            command_result(&grouped.body)["error"]["code"],
            "INVALID_GROUPED_CALL",
            "{rule}: {}",
            grouped.text
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0, "{rule}");
    }
}

#[test]
fn the_check_names_the_cap_a_host_reads_bodies_under() {
    let served = served(ToolStrategy::Individual, Rule::Static);
    assert_eq!(
        served.server.pre_dispatch_check().unwrap().max_body_bytes(),
        4096
    );
    let default = McpServer::new(registry(), "todo", "1.0.0").with_authorization(authorization());
    assert_eq!(
        default.pre_dispatch_check().unwrap().max_body_bytes(),
        afd::server::auth::DEFAULT_MAX_BODY_BYTES
    );
}
