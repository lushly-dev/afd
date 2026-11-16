//! The desktop's mount transport (phase 6 specification, 10.3 and 10.4): a transport only, with no MCP logic
//! of its own. The webview names an instance; the address, the bearer and the command line stay here, read
//! from `mounts.json`, and never cross IPC, not even in an error, which is a bare code.
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, oneshot};

/// One JSON-RPC message from the webview, at most 1 MiB, as the web host's.
pub const REQUEST_MAX: usize = 1024 * 1024;
/// A reply, at most 4 MiB, as the web host's `RESPONSE_MAX_BYTES`.
pub const RESPONSE_MAX: usize = 4 * REQUEST_MAX;
/// Open handles per instance: enough for the kernel's reconnects, too few to spawn without bound.
pub const HANDLES_PER_INSTANCE: usize = 4;
/// How long a request waits for its answer.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(120);
/// `SIGTERM`, then this long, then `SIGKILL` (10.4).
#[cfg_attr(not(unix), allow(dead_code))]
const TERMINATE_GRACE: Duration = Duration::from_secs(5);

pub const UNREACHABLE: &str = "MOUNT_UNREACHABLE";
pub const UNAUTHORIZED: &str = "MOUNT_UNAUTHORIZED";
pub const RESULT_INVALID: &str = "MOUNT_RESULT_INVALID";
pub const INSTANCE_UNKNOWN: &str = "INSTANCE_UNKNOWN";
pub const TOO_LARGE: &str = "REQUEST_TOO_LARGE";
pub const LIMIT: &str = "MOUNT_LIMIT";
pub const PERMISSIONS: &str = "DESKTOP_MOUNTS_PERMISSIONS";
pub const MOUNTS_INVALID: &str = "DESKTOP_MOUNTS_INVALID";

type Reply = Result<Value, &'static str>;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Reply>>>>;
/// Where a server's notification goes: `notify::script` and the main webview.
pub type Notify = Arc<dyn Fn(u64, Value) + Send + Sync>;

/// One entry of `mounts.json`, as `loam deployment write --host desktop --mounts-out` writes it.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Access {
    Http(HttpAccess),
    Stdio(StdioAccess),
}

/// Phase 1's `{ instance, url, bearer? }`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpAccess {
    instance: String,
    url: String,
    bearer: Option<String>,
}

/// The desktop's `{ instance, transport: 'stdio', command, cwd? }` (10.4).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StdioAccess {
    instance: String,
    transport: String,
    command: Vec<String>,
    cwd: Option<String>,
}

impl Access {
    fn instance(&self) -> &str {
        match self {
            Self::Http(HttpAccess { instance, .. }) | Self::Stdio(StdioAccess { instance, .. }) => {
                instance
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    mounts: Vec<Access>,
}

/// `mounts.json`, or a code: none at `path` mounts nothing; one others can read is refused (10.3).
pub fn read(path: &Path) -> Result<Vec<Access>, &'static str> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    permissions(path)?;
    let bytes = std::fs::read(path).map_err(|_| PERMISSIONS)?;
    if bytes.len() > REQUEST_MAX {
        return Err(MOUNTS_INVALID);
    }
    let file: File = serde_json::from_slice(&bytes).map_err(|_| MOUNTS_INVALID)?;
    let mut seen = std::collections::HashSet::new();
    for entry in &file.mounts {
        if !seen.insert(entry.instance()) {
            return Err(MOUNTS_INVALID);
        }
        match entry {
            Access::Http(HttpAccess { url, .. }) => {
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    return Err(MOUNTS_INVALID);
                }
            }
            Access::Stdio(StdioAccess {
                transport, command, ..
            }) => {
                if transport != "stdio" || command.first().is_none_or(String::is_empty) {
                    return Err(MOUNTS_INVALID);
                }
            }
        }
    }
    Ok(file.mounts)
}

/// POSIX: owned by this user, mode exactly 0600.
#[cfg(unix)]
pub fn permissions(path: &Path) -> Result<(), &'static str> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata = std::fs::symlink_metadata(path).map_err(|_| PERMISSIONS)?;
    // SAFETY: `geteuid` has no preconditions and cannot fail.
    let user = unsafe { libc::geteuid() };
    if !metadata.is_file()
        || metadata.uid() != user
        || metadata.permissions().mode() & 0o777 != 0o600
    {
        return Err(PERMISSIONS);
    }
    Ok(())
}

/// Windows: owned by this user, and every allowing entry of its ACL is this user's. The path reaches
/// PowerShell as an environment value, never as code.
#[cfg(windows)]
pub fn permissions(path: &Path) -> Result<(), &'static str> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| PERMISSIONS)?;
    if !metadata.is_file() {
        return Err(PERMISSIONS);
    }
    let script = "$ErrorActionPreference='Stop'; \
        $a=Get-Acl -LiteralPath $env:LOAM_MOUNTS_FILE; \
        $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; \
        $o=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; \
        if ($o -ne $u) { exit 1 }; \
        foreach ($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { \
          if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $u) { exit 1 } }; \
        exit 0";
    let windows = std::env::var_os("SystemRoot").ok_or(PERMISSIONS)?;
    let powershell = Path::new(&windows)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let status = std::process::Command::new(powershell)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("LOAM_MOUNTS_FILE", path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|_| PERMISSIONS)?;
    if status.success() {
        Ok(())
    } else {
        Err(PERMISSIONS)
    }
}

// Each lives in an Arc, one per open handle, so the size of the larger variant costs nothing worth boxing.
#[allow(clippy::large_enum_variant)]
enum Connection {
    Http {
        client: reqwest::Client,
        url: String,
        bearer: Option<String>,
        session: Mutex<Option<String>>,
    },
    Stdio {
        child: Mutex<Child>,
        stdin: Mutex<ChildStdin>,
        pending: Pending,
        /// Set when the reader has stopped: every call after it fails at once.
        closed: Arc<AtomicBool>,
    },
}

struct Open {
    instance: String,
    connection: Arc<Connection>,
}

/// Every instance `mounts.json` lists, and the connections the webview holds open.
pub struct Mounts {
    entries: Result<Vec<Access>, &'static str>,
    next: AtomicU64,
    open: Mutex<HashMap<u64, Open>>,
}

impl Mounts {
    pub fn new(entries: Result<Vec<Access>, &'static str>) -> Self {
        Self {
            entries,
            next: AtomicU64::new(1),
            open: Mutex::new(HashMap::new()),
        }
    }

    /// `mount_open`: a handle for `instance`, or a code.
    pub async fn open(&self, instance: &str, notify: Notify) -> Result<u64, &'static str> {
        let entries = self.entries.as_ref().map_err(|code| *code)?;
        let entry = entries
            .iter()
            .find(|entry| entry.instance() == instance)
            .ok_or(INSTANCE_UNKNOWN)?;
        // Held from the count to the insert, so concurrent opens cannot pass the limit together.
        let mut open = self.open.lock().await;
        if open
            .values()
            .filter(|held| held.instance == instance)
            .count()
            >= HANDLES_PER_INSTANCE
        {
            return Err(LIMIT);
        }
        // Handles stay well inside JavaScript's safe integers.
        let handle = self.next.fetch_add(1, Ordering::Relaxed);
        let connection = match entry {
            Access::Http(HttpAccess { url, bearer, .. }) => Connection::Http {
                client: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .no_proxy()
                    .timeout(ANSWER_TIMEOUT)
                    .build()
                    .map_err(|_| UNREACHABLE)?,
                url: url.clone(),
                bearer: bearer.clone(),
                session: Mutex::new(None),
            },
            Access::Stdio(StdioAccess { command, cwd, .. }) => {
                spawn(handle, command, cwd.as_deref(), notify)?
            }
        };
        open.insert(
            handle,
            Open {
                instance: instance.to_owned(),
                connection: Arc::new(connection),
            },
        );
        Ok(handle)
    }

    /// `mount_send`: one message; a request's answer, or `null` for a notification.
    pub async fn send(
        &self,
        handle: u64,
        message: Value,
        notify: Notify,
    ) -> Result<Value, &'static str> {
        let encoded = serde_json::to_vec(&message).map_err(|_| RESULT_INVALID)?;
        if encoded.len() > REQUEST_MAX {
            return Err(TOO_LARGE);
        }
        let connection = {
            let open = self.open.lock().await;
            open.get(&handle)
                .map(|held| held.connection.clone())
                .ok_or(UNREACHABLE)?
        };
        match connection.as_ref() {
            Connection::Stdio {
                child,
                stdin,
                pending,
                closed,
            } => send_stdio(child, stdin, pending, closed, &message, &encoded).await,
            Connection::Http {
                client,
                url,
                bearer,
                session,
            } => {
                send_http(
                    handle,
                    client,
                    url,
                    bearer.as_deref(),
                    session,
                    &message,
                    encoded,
                    notify,
                )
                .await
            }
        }
    }

    /// `mount_close`: for `http` the session's `DELETE`, for `stdio` `SIGTERM` then `SIGKILL`.
    pub async fn close(&self, handle: u64) -> Result<(), &'static str> {
        let Some(held) = self.open.lock().await.remove(&handle) else {
            return Ok(());
        };
        close(&held.connection).await
    }

    /// Every connection, when the app exits: no child outlives it.
    pub async fn close_all(&self) {
        let all: Vec<_> = self
            .open
            .lock()
            .await
            .drain()
            .map(|(_, held)| held.connection)
            .collect();
        futures_util::future::join_all(all.iter().map(|connection| close(connection))).await;
    }
}

fn spawn(
    handle: u64,
    command: &[String],
    cwd: Option<&str>,
    notify: Notify,
) -> Result<Connection, &'static str> {
    let mut builder = Command::new(&command[0]);
    builder
        .args(&command[1..])
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The app's log.
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    // A clean environment but `PATH`, `HOME` and the platform's minimum (10.4).
    for key in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "PATHEXT",
        "APPDATA",
        "LOCALAPPDATA",
        "ComSpec",
    ] {
        if let Some(value) = std::env::var_os(key) {
            builder.env(key, value);
        }
    }
    if let Some(cwd) = cwd {
        builder.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        builder.creation_flags(CREATE_NO_WINDOW);
    }
    // A group of its own, so stopping it stops what it started too (a wrapper's server, `npx`'s child).
    #[cfg(unix)]
    builder.process_group(0);
    let mut child = builder.spawn().map_err(|_| UNREACHABLE)?;
    let stdin = child.stdin.take().ok_or(UNREACHABLE)?;
    let stdout = child.stdout.take().ok_or(UNREACHABLE)?;
    let pending: Pending = Arc::default();
    let answers = pending.clone();
    let closed = Arc::new(AtomicBool::new(false));
    let stopped = closed.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            // One JSON-RPC message per line, each bounded: a child that never writes a newline cannot grow it.
            let mut line = Vec::new();
            let mut limited = (&mut reader).take((RESPONSE_MAX + 1) as u64);
            match limited.read_until(b'\n', &mut line).await {
                Ok(read) if read > 0 && read <= RESPONSE_MAX => {}
                _ => break,
            }
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                break;
            };
            if let Some(id) = response_id(&message) {
                if let Some(sender) = answers.lock().await.remove(&id) {
                    let _ = sender.send(Ok(message));
                }
            } else if is_notification(&message) {
                notify(handle, message);
            }
            // A server-to-client request is dropped, as the relay drops it (8.1).
        }
        // The child is gone, or spoke out of frame: its calls fail at once, retryable. The flag is set before the
        // drain, so a call that registers after the drain sees it.
        stopped.store(true, Ordering::SeqCst);
        for (_, sender) in answers.lock().await.drain() {
            let _ = sender.send(Err(UNREACHABLE));
        }
    });
    Ok(Connection::Stdio {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending,
        closed,
    })
}

async fn send_stdio(
    child: &Mutex<Child>,
    stdin: &Mutex<ChildStdin>,
    pending: &Pending,
    closed: &AtomicBool,
    message: &Value,
    encoded: &[u8],
) -> Result<Value, &'static str> {
    if closed.load(Ordering::SeqCst) {
        return Err(UNREACHABLE);
    }
    if child
        .lock()
        .await
        .try_wait()
        .map_err(|_| UNREACHABLE)?
        .is_some()
    {
        return Err(UNREACHABLE);
    }
    let id = message
        .get("id")
        .filter(|_| message.get("method").is_some())
        .map(Value::to_string);
    let (sender, receiver) = oneshot::channel();
    if let Some(id) = &id {
        pending.lock().await.insert(id.clone(), sender);
        // The reader may have stopped, and drained, between the check above and the insert.
        if closed.load(Ordering::SeqCst) {
            pending.lock().await.remove(id);
            return Err(UNREACHABLE);
        }
    }
    let written = async {
        let mut writer = stdin.lock().await;
        writer.write_all(encoded).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await
    }
    .await;
    if written.is_err() {
        if let Some(id) = &id {
            pending.lock().await.remove(id);
        }
        return Err(UNREACHABLE);
    }
    let Some(id) = id else { return Ok(Value::Null) };
    let answer = tokio::time::timeout(ANSWER_TIMEOUT, receiver).await;
    pending.lock().await.remove(&id);
    answer.map_err(|_| UNREACHABLE)?.map_err(|_| UNREACHABLE)?
}

#[allow(clippy::too_many_arguments)]
async fn send_http(
    handle: u64,
    client: &reqwest::Client,
    url: &str,
    bearer: Option<&str>,
    session: &Mutex<Option<String>>,
    message: &Value,
    encoded: Vec<u8>,
    notify: Notify,
) -> Result<Value, &'static str> {
    let mut request = client
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .body(encoded);
    if let Some(bearer) = bearer {
        request = request.bearer_auth(bearer);
    }
    let held = session.lock().await.clone();
    if let Some(id) = &held {
        request = request.header("Mcp-Session-Id", id);
    }
    let response = request.send().await.map_err(|_| UNREACHABLE)?;
    let status = response.status();
    if status == 401 || status == 403 {
        return Err(UNAUTHORIZED);
    }
    if status == 404 && held.is_some() {
        // The server forgot the session: the kernel's recovery reopens on its next discovery.
        *session.lock().await = None;
        return Err(UNREACHABLE);
    }
    if !status.is_success() {
        return Err(UNREACHABLE);
    }
    if message["method"] == "initialize"
        && let Some(id) = response.headers().get("Mcp-Session-Id")
    {
        let id = id.to_str().map_err(|_| RESULT_INVALID)?;
        if id.is_empty() || id.len() > 256 || !id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        {
            return Err(RESULT_INVALID);
        }
        *session.lock().await = Some(id.to_owned());
    }
    let content_type = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let expects_answer = message.get("id").is_some() && message.get("method").is_some();
    let stream = content_type.starts_with("text/event-stream");
    if !stream && !content_type.is_empty() && !content_type.starts_with("application/json") {
        return Err(RESULT_INVALID);
    }
    let mut body = response.bytes_stream();
    let mut bytes = Vec::new();
    let mut read = 0usize;
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|_| UNREACHABLE)?;
        read += chunk.len();
        if read > RESPONSE_MAX {
            return Err(RESULT_INVALID);
        }
        bytes.extend_from_slice(&chunk);
        if stream {
            while let Some(event) = next_event(&mut bytes) {
                let Some(value) = event_data(&event)? else {
                    continue;
                };
                if response_id(&value).is_some() && value.get("id") == message.get("id") {
                    return Ok(value);
                }
                if is_notification(&value) {
                    notify(handle, value);
                }
            }
        }
    }
    if stream || bytes.iter().all(u8::is_ascii_whitespace) {
        return if expects_answer {
            Err(RESULT_INVALID)
        } else {
            Ok(Value::Null)
        };
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| RESULT_INVALID)?;
    if response_id(&value).is_some() && value.get("id") == message.get("id") {
        Ok(value)
    } else {
        Err(RESULT_INVALID)
    }
}

/// One event of an event stream, removed from the front of `bytes`, or `None` until one is complete.
fn next_event(bytes: &mut Vec<u8>) -> Option<Vec<u8>> {
    let normalised = |bytes: &[u8]| -> Option<(usize, usize)> {
        let lf = bytes
            .windows(2)
            .position(|pair| pair == b"\n\n")
            .map(|at| (at, 2));
        let crlf = bytes
            .windows(4)
            .position(|quad| quad == b"\r\n\r\n")
            .map(|at| (at, 4));
        match (lf, crlf) {
            (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
            (a, b) => a.or(b),
        }
    };
    let (at, separator) = normalised(bytes)?;
    let event: Vec<u8> = bytes.drain(..at + separator).collect();
    Some(event)
}

/// The JSON of an event's `data:` lines, joined; `None` for an event with no data.
fn event_data(event: &[u8]) -> Result<Option<Value>, &'static str> {
    let text = std::str::from_utf8(event).map_err(|_| RESULT_INVALID)?;
    let data: Vec<&str> = text
        .lines()
        .filter_map(|line| {
            line.strip_prefix("data:")
                .map(|rest| rest.strip_prefix(' ').unwrap_or(rest))
        })
        .collect();
    if data.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&data.join("\n"))
        .map(Some)
        .map_err(|_| RESULT_INVALID)
}

async fn close(connection: &Connection) -> Result<(), &'static str> {
    match connection {
        Connection::Http {
            client,
            url,
            bearer,
            session,
        } => {
            if let Some(id) = session.lock().await.take() {
                let mut request = client.delete(url).header("Mcp-Session-Id", id);
                if let Some(bearer) = bearer {
                    request = request.bearer_auth(bearer);
                }
                let _ = request.send().await;
            }
            Ok(())
        }
        Connection::Stdio { child, .. } => {
            let mut child = child.lock().await;
            if child.try_wait().map_err(|_| UNREACHABLE)?.is_some() {
                return Ok(());
            }
            // `SIGTERM` to its group, then `SIGKILL` after the grace. Windows has no such signal: there it is
            // `TerminateProcess` at once, with no grace to wait out.
            #[cfg(unix)]
            {
                signal_group(&child, libc::SIGTERM);
                if tokio::time::timeout(TERMINATE_GRACE, child.wait())
                    .await
                    .is_ok()
                {
                    return Ok(());
                }
                signal_group(&child, libc::SIGKILL);
            }
            child.kill().await.map_err(|_| UNREACHABLE)?;
            Ok(())
        }
    }
}

/// A signal to the child's process group, which `spawn` made its own.
#[cfg(unix)]
fn signal_group(child: &Child, signal: libc::c_int) {
    if let Some(id) = child.id().and_then(|id| i32::try_from(id).ok()) {
        // SAFETY: a signal to the group this process created for its own child, which it has not yet reaped.
        unsafe {
            libc::killpg(id, signal);
        }
    }
}

/// A response's id: an object with `result` or `error` and no `method`.
fn response_id(value: &Value) -> Option<String> {
    let response = value.is_object()
        && value.get("method").is_none()
        && (value.get("result").is_some() || value.get("error").is_some());
    if response {
        value.get("id").map(Value::to_string)
    } else {
        None
    }
}

/// A notification: a `method` and no `id`.
fn is_notification(value: &Value) -> bool {
    value.is_object() && value["method"].is_string() && value.get("id").is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn events_split_on_either_line_ending_and_join_their_data() {
        let mut bytes =
            b"event: message\ndata: {\"a\":\ndata: 1}\n\nid: 2\r\ndata: {}\r\n\r\npartial".to_vec();
        let first = next_event(&mut bytes).unwrap();
        assert_eq!(event_data(&first).unwrap(), Some(json!({ "a": 1 })));
        let second = next_event(&mut bytes).unwrap();
        assert_eq!(event_data(&second).unwrap(), Some(json!({})));
        assert!(next_event(&mut bytes).is_none());
        assert_eq!(bytes, b"partial");
        assert_eq!(event_data(b": comment\n\n").unwrap(), None);
    }

    #[test]
    fn requests_responses_and_notifications_are_told_apart() {
        assert_eq!(
            response_id(&json!({ "jsonrpc": "2.0", "id": 3, "result": {} })),
            Some("3".into())
        );
        assert_eq!(
            response_id(&json!({ "jsonrpc": "2.0", "id": "a", "error": {} })),
            Some("\"a\"".into())
        );
        assert_eq!(
            response_id(&json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" })),
            None
        );
        assert!(is_notification(
            &json!({ "jsonrpc": "2.0", "method": "notifications/message" })
        ));
        assert!(!is_notification(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "roots/list" })
        ));
    }

    #[test]
    fn mounts_json_is_read_strictly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mounts.json");
        assert!(read(&path).unwrap().is_empty());
        std::fs::write(&path, r#"{"mounts":[{"instance":"a","url":"http://127.0.0.1:1/mcp","bearer":"t"},{"instance":"b","transport":"stdio","command":["hello-mcp"]}]}"#).unwrap();
        restrict(&path);
        assert_eq!(read(&path).unwrap().len(), 2);
        for bad in [
            r#"{"mounts":[{"instance":"a","url":"file:///etc/passwd"}]}"#,
            r#"{"mounts":[{"instance":"a","transport":"stdio","command":[]}]}"#,
            r#"{"mounts":[{"instance":"a","url":"http://x/"},{"instance":"a","url":"http://y/"}]}"#,
            r#"{"mounts":[],"extra":1}"#,
        ] {
            std::fs::write(&path, bad).unwrap();
            assert_eq!(read(&path).err(), Some(MOUNTS_INVALID), "{bad}");
        }
    }

    #[cfg(unix)]
    fn restrict(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[cfg(windows)]
    fn restrict(path: &Path) {
        let system = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32");
        let user = std::process::Command::new(system.join("whoami.exe"))
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .unwrap();
        let sid = String::from_utf8(user.stdout)
            .unwrap()
            .trim()
            .rsplit(',')
            .next()
            .unwrap()
            .trim_matches('"')
            .to_owned();
        let status = std::process::Command::new(system.join("icacls.exe"))
            .arg(path)
            .args(["/inheritance:r", "/grant:r"])
            .arg(format!("*{sid}:F"))
            .stdout(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn p6_d2_a_mounts_json_others_can_read_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mounts.json");
        std::fs::write(&path, r#"{"mounts":[]}"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        // On Windows a new file in a temporary directory inherits entries for SYSTEM and Administrators.
        assert_eq!(read(&path).err(), Some(PERMISSIONS));
        restrict(&path);
        assert!(read(&path).is_ok());
    }

    #[tokio::test]
    async fn an_unknown_instance_and_a_refused_file_open_nothing() {
        let notify: Notify = Arc::new(|_, _| {});
        let mounts = Mounts::new(Ok(Vec::new()));
        assert_eq!(
            mounts.open("nope", notify.clone()).await.err(),
            Some(INSTANCE_UNKNOWN)
        );
        let refused = Mounts::new(Err(PERMISSIONS));
        assert_eq!(
            refused.open("any", notify.clone()).await.err(),
            Some(PERMISSIONS)
        );
        assert_eq!(
            mounts.send(9, json!({}), notify).await.err(),
            Some(UNREACHABLE)
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_opens_take_at_most_four_handles_per_instance() {
        let entry: Access =
            serde_json::from_value(json!({ "instance": "a", "url": "http://127.0.0.1:1/mcp" }))
                .unwrap();
        let mounts = Arc::new(Mounts::new(Ok(vec![entry])));
        let notify: Notify = Arc::new(|_, _| {});
        let opens = (0..8).map(|_| {
            let mounts = mounts.clone();
            let notify = notify.clone();
            tokio::spawn(async move { mounts.open("a", notify).await })
        });
        let results = futures_util::future::join_all(opens).await;
        let opened = results
            .iter()
            .filter(|result| matches!(result, Ok(Ok(_))))
            .count();
        let limited = results
            .iter()
            .filter(|result| matches!(result, Ok(Err(LIMIT))))
            .count();
        assert_eq!(
            (opened, limited),
            (HANDLES_PER_INSTANCE, 8 - HANDLES_PER_INSTANCE)
        );
    }

    #[tokio::test]
    async fn a_message_over_one_mebibyte_is_refused_before_it_is_sent() {
        let notify: Notify = Arc::new(|_, _| {});
        let mounts = Mounts::new(Ok(Vec::new()));
        let big = json!({ "jsonrpc": "2.0", "id": 1, "method": "x", "params": { "p": "x".repeat(REQUEST_MAX) } });
        assert_eq!(mounts.send(1, big, notify).await.err(), Some(TOO_LARGE));
    }
}
