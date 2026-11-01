//! A mounted server's connection (specification section 6.3): connect and list at `seal`, call,
//! respawn.
//!
//! Everything rmcp does runs on one small runtime of its own, shared by the mounts of every
//! host in the process while any of them lives. `seal` is synchronous and may itself run inside a
//! caller's runtime, so it hands the work to this runtime and waits on a channel; a call is
//! spawned onto it and awaited from the caller's runtime.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use afd::{CommandError, CommandResult};
use rmcp::ClientLifecycleMode;
use rmcp::ClientServiceExt;
use rmcp::RoleClient;
use rmcp::ServiceError;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ClientCapabilities, Implementation,
    InitializeRequestParams, ProtocolVersion,
};
use rmcp::service::{ClientInitializeError, RunningService};
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::runtime::{Handle, Runtime};

use super::result::map_tool_result;
use super::transport::{BoundedHttp, ChildTransport, Limit};
use crate::plugins::PluginError;

/// At most this many respawns in [`RESPAWN_WINDOW`].
const MAX_RESPAWNS: usize = 3;
/// See [`MAX_RESPAWNS`].
const RESPAWN_WINDOW: Duration = Duration::from_secs(60);

/// A credential the deployer's environment holds. Never printed.
#[derive(Clone)]
pub(crate) struct Secret(String);

impl Secret {
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// How the child of a stdio mount is started.
#[derive(Debug, Clone)]
pub(crate) struct StdioSpec {
    pub program: OsString,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// The whole environment of the child: `PATH` and the configured variables, nothing else.
    pub env: Vec<(String, String)>,
}

/// Where an HTTP mount is, and what it sends.
#[derive(Debug, Clone)]
pub(crate) struct HttpSpec {
    pub url: String,
    pub bearer: Option<Secret>,
    /// Extra trusted roots, PEM (`HostBuilder::with_mount_root_certificate`).
    pub roots: Vec<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub(crate) enum Endpoint {
    Stdio(StdioSpec),
    Http(HttpSpec),
}

/// A mount, as the instance configuration and the manifest settle it.
#[derive(Debug, Clone)]
pub(crate) struct MountSpec {
    pub instance: String,
    pub endpoint: Endpoint,
    pub connect_timeout: Duration,
    pub call_timeout: Duration,
    pub max_result_bytes: usize,
}

/// The runtime rmcp runs on. Dropping the last handle stops it without waiting, so a host can be
/// dropped from inside an async context; the connections' tasks are dropped with it, which kills
/// the stdio children (`kill_on_drop`).
pub(crate) struct MountRuntime {
    runtime: Option<Runtime>,
}

impl MountRuntime {
    /// The shared runtime, started if no mount of this process holds one.
    pub(crate) fn shared() -> io::Result<Arc<Self>> {
        static SHARED: Mutex<Weak<MountRuntime>> = Mutex::new(Weak::new());
        let mut shared = SHARED
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(runtime) = shared.upgrade() {
            return Ok(runtime);
        }
        let runtime = Arc::new(Self {
            runtime: Some(
                tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .thread_name("umbel-mount")
                    .enable_all()
                    .build()?,
            ),
        });
        *shared = Arc::downgrade(&runtime);
        Ok(runtime)
    }

    pub(crate) fn handle(&self) -> Handle {
        match &self.runtime {
            Some(runtime) => runtime.handle().clone(),
            // Only `drop` empties it.
            None => Handle::current(),
        }
    }
}

impl Drop for MountRuntime {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

/// One live connection.
struct Conn {
    service: RunningService<RoleClient, InitializeRequestParams>,
    limit: Arc<Limit>,
}

struct State {
    conn: Option<Arc<Conn>>,
    respawns: VecDeque<Instant>,
}

/// One mounted instance: its connection, shared by concurrent calls.
pub(crate) struct Mount {
    spec: MountSpec,
    runtime: Arc<MountRuntime>,
    state: tokio::sync::Mutex<State>,
}

/// How the handshake went wrong.
enum Failure {
    /// The server answered `server/discover` as a legacy server does.
    Legacy,
    Other(String),
}

impl Mount {
    /// Connect, list every page of the server's tools, and keep the connection. Blocks the
    /// calling thread (`seal` is synchronous); the work runs on the mount runtime.
    ///
    /// # Errors
    /// `PLUGIN_LOAD_FAILED` when the connection fails or does not complete a handshake within
    /// `connect_timeout`.
    pub(crate) fn connect(spec: MountSpec) -> Result<(Arc<Self>, Vec<Value>), PluginError> {
        let runtime = MountRuntime::shared().map_err(|error| {
            PluginError::load_failed(
                &spec.instance,
                format!("cannot start the mount runtime: {error}"),
            )
        })?;
        let (sender, receiver) = std::sync::mpsc::channel();
        let work = spec.clone();
        runtime.handle().spawn(async move {
            let _ = sender.send(open(&work).await);
        });
        let opened = receiver.recv().map_err(|_| {
            PluginError::load_failed(&spec.instance, "the mount runtime stopped while connecting")
        })?;
        match opened {
            Ok((conn, tools)) => Ok((
                Arc::new(Self {
                    spec,
                    runtime,
                    state: tokio::sync::Mutex::new(State {
                        conn: Some(Arc::new(conn)),
                        respawns: VecDeque::new(),
                    }),
                }),
                tools,
            )),
            Err(message) => Err(PluginError::load_failed(&spec.instance, message)),
        }
    }

    /// Call the server's tool `tool` with `arguments` and nothing else: no caller credential,
    /// token, principal or request metadata crosses (D43).
    pub(crate) async fn call(
        self: &Arc<Self>,
        tool: &str,
        arguments: Map<String, Value>,
    ) -> CommandResult<Value> {
        let this = Arc::clone(self);
        let tool = tool.to_owned();
        let task = self
            .runtime
            .handle()
            .spawn(async move { this.call_on_runtime(&tool, arguments).await });
        match task.await {
            Ok(result) => result,
            Err(error) => afd::failure(
                PluginError::unavailable(
                    &self.spec.instance,
                    format!("the mount runtime failed the call: {error}"),
                )
                .to_command_error(),
            ),
        }
    }

    async fn call_on_runtime(
        &self,
        tool: &str,
        arguments: Map<String, Value>,
    ) -> CommandResult<Value> {
        let instance = &self.spec.instance;
        let conn = match self.connection().await {
            Ok(conn) => conn,
            Err(error) => return afd::failure(error.to_command_error()),
        };
        let params = CallToolRequestParams::new(tool.to_owned()).with_arguments(arguments);
        let peer = conn.service.peer().clone();
        let call = tokio::time::timeout(self.spec.call_timeout, peer.call_tool_once(params));
        let answered = tokio::select! {
            answered = call => Some(answered),
            () = conn.limit.exceeded() => None,
        };
        let oversized = answered.is_none() || conn.limit.tripped();
        if oversized {
            self.discard(&conn).await;
            return afd::failure(
                PluginError::limit_exceeded(
                    instance,
                    "result",
                    format!(
                        "the server's answer to `{tool}` is over max_result_bytes ({} bytes); it was dropped unread",
                        self.spec.max_result_bytes
                    ),
                )
                .to_command_error(),
            );
        }
        match answered {
            Some(Ok(Ok(CallToolResponse::Complete(result)))) => match serde_json::to_value(&result) {
                Ok(json) => map_tool_result(&json),
                Err(error) => unavailable(instance, format!("the answer cannot be read: {error}")),
            },
            Some(Ok(Ok(_))) => afd::failure(
                CommandError::new(
                    crate::plugins::codes::PLUGIN_TOOL_ERROR,
                    format!("`{tool}` asked for more input or started a task, which this host does not support"),
                )
                .with_suggestion("See the message from the mounted server.")
                .with_retryable(false),
            ),
            Some(Ok(Err(ServiceError::McpError(error)))) => afd::failure(
                CommandError::new(
                    crate::plugins::codes::PLUGIN_TOOL_ERROR,
                    format!("the server refused `{tool}`: {}", error.message),
                )
                .with_suggestion("See the message from the mounted server.")
                .with_retryable(false),
            ),
            Some(Ok(Err(error))) => {
                self.discard(&conn).await;
                unavailable(instance, format!("the connection to the server failed: {error}"))
            }
            Some(Err(_)) => unavailable(
                instance,
                format!(
                    "the server did not answer `{tool}` within timeout_ms ({} ms)",
                    self.spec.call_timeout.as_millis()
                ),
            ),
            None => unavailable(instance, "the connection failed"),
        }
    }

    /// The live connection, or a new one: a stdio child that is gone is respawned, at most three
    /// times in any 60 seconds.
    async fn connection(&self) -> Result<Arc<Conn>, PluginError> {
        let mut state = self.state.lock().await;
        if let Some(conn) = &state.conn
            && !conn.service.is_closed()
        {
            return Ok(Arc::clone(conn));
        }
        state.conn = None;
        let now = Instant::now();
        while state
            .respawns
            .front()
            .is_some_and(|started| now.duration_since(*started) > RESPAWN_WINDOW)
        {
            state.respawns.pop_front();
        }
        if state.respawns.len() >= MAX_RESPAWNS {
            return Err(PluginError::unavailable(
                &self.spec.instance,
                format!(
                    "the server has been restarted {MAX_RESPAWNS} times in the last {} seconds and is not restarted again until the window passes",
                    RESPAWN_WINDOW.as_secs()
                ),
            ));
        }
        state.respawns.push_back(now);
        match open(&self.spec).await {
            Ok((conn, _tools)) => {
                let conn = Arc::new(conn);
                state.conn = Some(Arc::clone(&conn));
                Ok(conn)
            }
            Err(message) => Err(PluginError::unavailable(&self.spec.instance, message)),
        }
    }

    /// Drop `conn` if it is still the current connection: its stream is poisoned or gone.
    async fn discard(&self, conn: &Arc<Conn>) {
        let mut state = self.state.lock().await;
        if state
            .conn
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, conn))
        {
            state.conn = None;
        }
    }
}

fn unavailable(instance: &str, problem: impl std::fmt::Display) -> CommandResult<Value> {
    afd::failure(PluginError::unavailable(instance, problem).to_command_error())
}

/// Connect and list the tools, within `connect_timeout`.
async fn open(spec: &MountSpec) -> Result<(Conn, Vec<Value>), String> {
    let timeout = spec.connect_timeout;
    tokio::time::timeout(timeout, async {
        let (service, limit) =
            match handshake(spec, Handshake::Discover).await {
                Ok(connected) => connected,
                Err(Failure::Legacy) => handshake(spec, Handshake::Initialize).await.map_err(
                    |failure| match failure {
                        Failure::Legacy => "the server rejected the handshake".to_owned(),
                        Failure::Other(message) => message,
                    },
                )?,
                Err(Failure::Other(message)) => return Err(message),
            };
        let tools = service
            .peer()
            .list_all_tools()
            .await
            .map_err(|error| format!("cannot list the server's tools: {error}"))?;
        let tools = tools
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("cannot read the server's tools: {error}"))?;
        Ok((Conn { service, limit }, tools))
    })
    .await
    .unwrap_or_else(|_| {
        Err(format!(
            "no completed handshake within connect_timeout_ms ({} ms)",
            timeout.as_millis()
        ))
    })
}

#[derive(Clone, Copy)]
enum Handshake {
    /// `server/discover` at 2026-07-28.
    Discover,
    /// The legacy `initialize` handshake at 2025-11-25.
    Initialize,
}

/// The client's identity. It declares **no** capabilities: no sampling, elicitation or roots.
fn client_info(handshake: Handshake) -> InitializeRequestParams {
    let info = InitializeRequestParams::new(
        ClientCapabilities::default(),
        Implementation::new("umbel", env!("CARGO_PKG_VERSION")),
    );
    match handshake {
        Handshake::Discover => info,
        Handshake::Initialize => info.with_protocol_version(ProtocolVersion::V_2025_11_25),
    }
}

/// Not `Auto`: its probe can wait ten seconds, as long as the connect timeout.
async fn handshake(
    spec: &MountSpec,
    handshake: Handshake,
) -> Result<
    (
        RunningService<RoleClient, InitializeRequestParams>,
        Arc<Limit>,
    ),
    Failure,
> {
    let limit = Limit::new(spec.max_result_bytes);
    let lifecycle = match handshake {
        Handshake::Discover => ClientLifecycleMode::Discover {
            preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        },
        Handshake::Initialize => ClientLifecycleMode::Initialize,
    };
    let info = client_info(handshake);
    let served = match &spec.endpoint {
        Endpoint::Stdio(stdio) => {
            let transport = spawn(spec, stdio, &limit).map_err(Failure::Other)?;
            info.serve_with_lifecycle(transport, lifecycle).await
        }
        Endpoint::Http(http) => {
            let transport = http_transport(spec, http, &limit).map_err(Failure::Other)?;
            info.serve_with_lifecycle(transport, lifecycle).await
        }
    };
    match served {
        Ok(service) => Ok((service, limit)),
        Err(ClientInitializeError::JsonRpcError(_)) if matches!(handshake, Handshake::Discover) => {
            Err(Failure::Legacy)
        }
        Err(error) => Err(Failure::Other(format!("the handshake failed: {error}"))),
    }
}

/// Start the child: environment cleared to `PATH` plus the configured variables, `kill_on_drop`,
/// stdin and stdout for JSON-RPC, stderr forwarded line by line to the host log.
fn spawn(
    spec: &MountSpec,
    stdio: &StdioSpec,
    limit: &Arc<Limit>,
) -> Result<ChildTransport, String> {
    let mut command = Command::new(&stdio.program);
    command
        .args(&stdio.args)
        .current_dir(&stdio.cwd)
        .env_clear()
        .envs(stdio.env.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "cannot start `{}`: {error}",
            stdio.program.to_string_lossy()
        )
    })?;
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err("the child has no stdio pipes".to_owned());
    };
    let instance = spec.instance.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::debug!(instance = %instance, "{line}");
        }
    });
    Ok(ChildTransport::new(child, stdout, stdin, Arc::clone(limit)))
}

fn http_transport(
    spec: &MountSpec,
    http: &HttpSpec,
    limit: &Arc<Limit>,
) -> Result<StreamableHttpClientTransport<BoundedHttp>, String> {
    let mut builder = reqwest::Client::builder()
        .pool_max_idle_per_host(0)
        // A redirect would carry the bearer to wherever it points.
        .redirect(reqwest::redirect::Policy::none());
    for pem in &http.roots {
        let certificate = reqwest::Certificate::from_pem(pem)
            .map_err(|error| format!("a trusted root certificate cannot be read: {error}"))?;
        builder = builder.add_root_certificate(certificate);
    }
    let client = builder
        .build()
        .map_err(|error| format!("cannot build the HTTP client: {error}"))?;
    let mut config = StreamableHttpClientTransportConfig::with_uri(http.url.as_str());
    config.auth_header = http.bearer.as_ref().map(|secret| secret.0.clone());
    config.max_sse_event_size = spec.max_result_bytes;
    Ok(StreamableHttpClientTransport::with_client(
        BoundedHttp::new(client, Arc::clone(limit)),
        config,
    ))
}
