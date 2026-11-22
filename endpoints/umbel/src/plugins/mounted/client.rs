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
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::runtime::{Handle, Runtime};

use super::result::map_tool_result;
use super::transport::{BoundedHttp, ChildTransport, Limit};
use crate::plugins::PluginError;

/// At most this many respawns in [`RESPAWN_WINDOW`].
const MAX_RESPAWNS: usize = 3;
/// See [`MAX_RESPAWNS`].
const RESPAWN_WINDOW: Duration = Duration::from_secs(60);
/// Maximum trailing bytes of a child's stderr kept for startup failure diagnostics.
const STDERR_TAIL_BYTES: usize = 2048;
/// Maximum bytes buffered for one stderr line forwarded to `tracing::debug!`.
const STDERR_LOG_LINE_BYTES: usize = 4096;
/// How long to wait for a stdio child that closed stdout to report its exit status.
const EXIT_WAIT: Duration = Duration::from_millis(500);
/// How long to wait for the stderr reader task to hit EOF after the child exits.
const STDERR_DRAIN_WAIT: Duration = Duration::from_millis(200);

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
    /// The whole environment of the child: `PATH` (plus `SystemRoot` on Windows) and the
    /// configured variables, nothing else.
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
        let (service, limit, watch) =
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
        let tools = match service.peer().list_all_tools().await {
            Ok(tools) => tools,
            Err(error) => {
                drop(service);
                let wait_for_exit = !matches!(error, ServiceError::McpError(_));
                let detail = match watch {
                    Some(watch) => watch.diagnose(wait_for_exit).await,
                    None => None,
                };
                return Err(append_diagnostics(
                    format!("cannot list the server's tools: {error}"),
                    detail,
                ));
            }
        };
        drop(watch);
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
        Option<ChildWatch>,
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
    let (served, watch) = match &spec.endpoint {
        Endpoint::Stdio(stdio) => {
            let (transport, watch) = spawn(spec, stdio, &limit).map_err(Failure::Other)?;
            (
                info.serve_with_lifecycle(transport, lifecycle).await,
                Some(watch),
            )
        }
        Endpoint::Http(http) => {
            let transport = http_transport(spec, http, &limit).map_err(Failure::Other)?;
            (info.serve_with_lifecycle(transport, lifecycle).await, None)
        }
    };
    match served {
        Ok(service) => Ok((service, limit, watch)),
        Err(ClientInitializeError::JsonRpcError(_)) if matches!(handshake, Handshake::Discover) => {
            // Legacy server: drop `watch` without waiting so the first child dies immediately.
            drop(watch);
            Err(Failure::Legacy)
        }
        Err(error) => {
            let wait_for_exit = !matches!(error, ClientInitializeError::JsonRpcError(_));
            let detail = match watch {
                Some(watch) => watch.diagnose(wait_for_exit).await,
                None => None,
            };
            Err(Failure::Other(append_diagnostics(
                format!("the handshake failed: {error}"),
                detail,
            )))
        }
    }
}

/// Bounded trailing bytes of a stdio child's stderr, kept only during startup so a dead child's
/// failure message names why it died.
#[derive(Default)]
struct StderrTail {
    bytes: VecDeque<u8>,
    truncated: bool,
}

impl StderrTail {
    fn push(&mut self, chunk: &[u8]) {
        if chunk.len() >= STDERR_TAIL_BYTES {
            self.truncated |= !self.bytes.is_empty() || chunk.len() > STDERR_TAIL_BYTES;
            self.bytes.clear();
            let start = chunk.len() - STDERR_TAIL_BYTES;
            self.bytes.extend(&chunk[start..]);
            return;
        }
        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(STDERR_TAIL_BYTES);
        if overflow > 0 {
            self.bytes.drain(..overflow);
            self.truncated = true;
        }
        self.bytes.extend(chunk);
    }

    fn format(&self) -> Option<String> {
        if self.bytes.is_empty() {
            return None;
        }
        let raw: Vec<u8> = self.bytes.iter().copied().collect();
        let mut slice: &[u8] = &raw;
        if self.truncated {
            // Skip any UTF-8 continuation bytes left over after dropping the front of the buffer.
            while let Some(&first) = slice.first()
                && (first & 0b1100_0000) == 0b1000_0000
            {
                slice = &slice[1..];
            }
            // Start on a clean line boundary when printable text follows the first newline.
            if let Some(newline) = slice.iter().position(|&b| b == b'\n') {
                let after = &slice[newline + 1..];
                if String::from_utf8_lossy(after)
                    .chars()
                    .any(|c| !c.is_control() && !c.is_whitespace())
                {
                    slice = after;
                }
            }
        }
        let text = String::from_utf8_lossy(slice);
        let cleaned: String = text
            .chars()
            .filter(|&c| c == '\n' || c == '\t' || !c.is_control())
            .collect();
        let trimmed = cleaned.trim();
        if trimmed.is_empty() {
            return None;
        }
        if self.truncated {
            Some(format!("...{trimmed}"))
        } else {
            Some(trimmed.to_owned())
        }
    }
}

/// Startup handle held beside `ChildTransport` until `open` finishes. Dropping it on success
/// leaves `ChildTransport` as the sole owner of the child and lets the stderr task stop buffering
/// `StderrTail`.
struct ChildWatch {
    child: Arc<Mutex<Option<Child>>>,
    stderr_tail: Arc<Mutex<StderrTail>>,
    stderr_done: tokio::sync::watch::Receiver<bool>,
}

impl ChildWatch {
    async fn diagnose(mut self, wait_for_exit: bool) -> Option<String> {
        let child = self
            .child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let status = match child {
            Some(mut child) => match child.try_wait() {
                Ok(Some(status)) => Some(status),
                Ok(None) if wait_for_exit => {
                    match tokio::time::timeout(EXIT_WAIT, child.wait()).await {
                        Ok(Ok(status)) => Some(status),
                        _ => None,
                    }
                }
                _ => None,
            },
            None => None,
        };
        // `child` is dropped here: if it had not exited, `kill_on_drop(true)` kills it now.
        if wait_for_exit || status.is_some() {
            let _ =
                tokio::time::timeout(STDERR_DRAIN_WAIT, self.stderr_done.wait_for(|done| *done))
                    .await;
        }
        let stderr = self
            .stderr_tail
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .format();
        format_child_diagnostics(status, stderr.as_deref())
    }
}

fn format_exit_status(status: std::process::ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("exited with code {code}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("killed by signal {signal}");
        }
    }
    format!("exited ({status})")
}

fn format_child_diagnostics(
    status: Option<std::process::ExitStatus>,
    stderr: Option<&str>,
) -> Option<String> {
    match (status, stderr) {
        (Some(status), Some(stderr)) => Some(format!(
            "child {}; stderr: {stderr}",
            format_exit_status(status)
        )),
        (Some(status), None) => Some(format!("child {}", format_exit_status(status))),
        (None, Some(stderr)) => Some(format!("stderr: {stderr}")),
        (None, None) => None,
    }
}

fn append_diagnostics(message: String, detail: Option<String>) -> String {
    match detail {
        Some(detail) => format!("{message} ({detail})"),
        None => message,
    }
}

/// Start the child: environment cleared to `PATH` (plus `SystemRoot` on Windows) and the
/// configured variables, `kill_on_drop`, stdin and stdout for JSON-RPC, stderr forwarded line by
/// line to the host log and tailed for startup diagnostics.
fn spawn(
    spec: &MountSpec,
    stdio: &StdioSpec,
    limit: &Arc<Limit>,
) -> Result<(ChildTransport, ChildWatch), String> {
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
    let tail = Arc::new(Mutex::new(StderrTail::default()));
    let tail_weak = Arc::downgrade(&tail);
    let (stderr_done_tx, stderr_done_rx) = tokio::sync::watch::channel(false);
    let instance = spec.instance.clone();
    tokio::spawn(async move {
        let mut reader = stderr;
        let mut buf = [0u8; 1024];
        let mut line = Vec::new();
        let mut line_truncated = false;
        while let Ok(read) = reader.read(&mut buf).await {
            if read == 0 {
                break;
            }
            let chunk = &buf[..read];
            if let Some(tail) = tail_weak.upgrade() {
                tail.lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(chunk);
            }
            for &byte in chunk {
                if byte == b'\n' {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim_end_matches('\r');
                    if !text.is_empty() || line_truncated {
                        if line_truncated {
                            tracing::debug!(instance = %instance, "{text}...");
                        } else {
                            tracing::debug!(instance = %instance, "{text}");
                        }
                    }
                    line.clear();
                    line_truncated = false;
                } else if line.len() < STDERR_LOG_LINE_BYTES {
                    line.push(byte);
                } else {
                    line_truncated = true;
                }
            }
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end_matches('\r');
        if !text.is_empty() || line_truncated {
            if line_truncated {
                tracing::debug!(instance = %instance, "{text}...");
            } else {
                tracing::debug!(instance = %instance, "{text}");
            }
        }
        let _ = stderr_done_tx.send(true);
    });
    let shared_child = Arc::new(Mutex::new(Some(child)));
    let transport =
        ChildTransport::new(Arc::clone(&shared_child), stdout, stdin, Arc::clone(limit));
    let watch = ChildWatch {
        child: shared_child,
        stderr_tail: tail,
        stderr_done: stderr_done_rx,
    };
    Ok((transport, watch))
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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::{STDERR_TAIL_BYTES, StderrTail, append_diagnostics, format_child_diagnostics};

    #[test]
    fn stderr_tail_keeps_short_output_and_strips_control_chars() {
        let mut tail = StderrTail::default();
        tail.push(b"line 1\r\n\x1b[31mline 2\twith\x00tab\r\n");
        assert_eq!(
            tail.format().as_deref(),
            Some("line 1\n[31mline 2\twithtab")
        );
    }

    #[test]
    fn stderr_tail_ignores_empty_or_whitespace_only_output() {
        let mut tail = StderrTail::default();
        assert_eq!(tail.format(), None);
        tail.push(b"   \r\n\t \n");
        assert_eq!(tail.format(), None);
    }

    #[test]
    fn stderr_tail_truncates_to_clean_line_tail_and_handles_utf8_boundaries() {
        let mut tail = StderrTail::default();
        // Multi-byte UTF-8 prefix followed by enough bytes to force truncation mid-codepoint.
        tail.push("EARLY_MARKER\n".as_bytes());
        tail.push("é".repeat(STDERR_TAIL_BYTES).as_bytes());
        tail.push(b"\nFINAL_LINE\n\n");
        let rendered = tail.format().expect("non-empty tail");
        assert!(rendered.starts_with("..."), "{rendered}");
        assert!(rendered.contains("FINAL_LINE"), "{rendered}");
        assert!(!rendered.contains("EARLY_MARKER"), "{rendered}");
        assert!(
            rendered.len() <= STDERR_TAIL_BYTES + 3,
            "{}",
            rendered.len()
        );
    }

    #[test]
    fn stderr_tail_exact_budget_is_not_marked_truncated() {
        let mut tail = StderrTail::default();
        let exact = "a".repeat(STDERR_TAIL_BYTES);
        tail.push(exact.as_bytes());
        assert_eq!(tail.format().as_deref(), Some(exact.as_str()));
    }

    #[test]
    fn stderr_tail_keeps_printable_line_when_only_controls_follow_newline() {
        let mut tail = StderrTail::default();
        tail.push("ignored ".as_bytes());
        tail.push("x".repeat(STDERR_TAIL_BYTES - 4).as_bytes());
        tail.push(b"\n\x00\x1b\r");
        let rendered = tail.format().expect("printable text before control tail");
        assert!(rendered.starts_with("..."), "{rendered}");
        assert!(rendered.contains("xxx"), "{rendered}");
    }

    #[test]
    fn append_diagnostics_keeps_plain_message_when_none() {
        assert_eq!(
            append_diagnostics("the handshake failed: eof".to_owned(), None),
            "the handshake failed: eof"
        );
        assert_eq!(
            append_diagnostics(
                "the handshake failed: eof".to_owned(),
                format_child_diagnostics(None, Some("boom"))
            ),
            "the handshake failed: eof (stderr: boom)"
        );
    }
}
