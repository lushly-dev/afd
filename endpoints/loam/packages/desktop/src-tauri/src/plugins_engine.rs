//! Fixed non-shell engine invocations, port allocation, clean allow-listed child environment, and
//! pre-bearer `/health` + MCP `initialize` probes (phase 5 no-terminal amendment, 5.1, 5.2, 7.3).
use crate::desktop_state::{DesktopState, PORTS, hex64, token_id};
use crate::models::key_shaped;
use crate::mounts::{VerifiedProbeError, probe_unauthenticated_mcp_bounded, probe_verified_mcp};
use crate::plugin_manifest::AuthMode;
use crate::plugins_error::{
    PLUGIN_ENGINE_TEST_BUILD, PLUGIN_HEALTH_TIMEOUT, PLUGIN_PAIR_FAILED, PLUGIN_PORT_CONFLICT,
    PluginError,
};
use serde::Deserialize;
use std::collections::HashSet;
use std::io::Read;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Bounded stdout/stderr capture for `--version`, `pair`, and `unpair` (amendment 5.1).
const ENGINE_IO_CAP: usize = 4096;
/// Timeout for `<binary> --version` and `<binary> unpair` (amendment 5.1).
const SHORT_TIMEOUT: Duration = Duration::from_secs(5);
/// Timeout for `<binary> pair` (amendment 5.1).
const PAIR_TIMEOUT: Duration = Duration::from_secs(15);
/// Default poll deadline for post-start `/health` proof + MCP `initialize` probe (amendment 7.3).
pub const HEALTH_POLL_TIMEOUT: Duration = Duration::from_secs(10);
/// Poll interval between health probe attempts (amendment 7.3).
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Single-attempt HTTP probe timeout (amendment 5.2).
const SINGLE_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Applies section 5's clean allow-listed environment to `cmd`, dropping all ambient secrets,
/// API keys, `BETTER_AUTH_*`, and tokens.
pub fn apply_clean_env(cmd: &mut Command) {
    cmd.env_clear();
    #[cfg(windows)]
    {
        for key in [
            "SystemRoot",
            "WINDIR",
            "LOCALAPPDATA",
            "APPDATA",
            "USERPROFILE",
            "TEMP",
            "TMP",
        ] {
            if let Some(val) = std::env::var_os(key) {
                cmd.env(key, val);
            }
        }
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_owned());
        cmd.env("PATH", format!("{sys_root}\\System32;{sys_root}"));
    }
    #[cfg(not(windows))]
    {
        for key in [
            "HOME",
            "XDG_DATA_HOME",
            "XDG_CONFIG_HOME",
            "XDG_RUNTIME_DIR",
            "TMPDIR",
            "LANG",
        ] {
            if let Some(val) = std::env::var_os(key) {
                cmd.env(key, val);
            }
        }
        cmd.env("PATH", "/usr/bin:/bin");
    }
}

/// Output of a bounded synchronous engine invocation.
struct BoundedOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_bounded_command(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<BoundedOutput, &'static str> {
    let mut cmd = Command::new(binary);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_clean_env(&mut cmd);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|_| "spawn failed")?;
    #[cfg(windows)]
    let job = crate::engine_run::attach_child_job(&child);
    let kill_tree = |child: &mut std::process::Child| {
        #[cfg(unix)]
        {
            if let Ok(pgid) = i32::try_from(child.id()) {
                // SAFETY: terminates the child's dedicated process group created via `process_group(0)`.
                unsafe {
                    libc::killpg(pgid, libc::SIGKILL);
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    };
    #[cfg(windows)]
    if job.is_none() {
        kill_tree(&mut child);
        return Err("failed to contain child process");
    }
    let stdout_pipe = child.stdout.take().ok_or("missing stdout")?;
    let stderr_pipe = child.stderr.take().ok_or("missing stderr")?;

    let (out_tx, out_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe
            .take(ENGINE_IO_CAP as u64 + 1)
            .read_to_end(&mut buf);
        let _ = out_tx.send(buf);
    });
    let (err_tx, err_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe
            .take(ENGINE_IO_CAP as u64 + 1)
            .read_to_end(&mut buf);
        let _ = err_tx.send(buf);
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_tree(&mut child);
                    #[cfg(windows)]
                    drop(job);
                    return Err("timeout");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => {
                kill_tree(&mut child);
                #[cfg(windows)]
                drop(job);
                return Err("wait failed");
            }
        }
    };
    #[cfg(windows)]
    drop(job);
    let wait_out = deadline.saturating_duration_since(Instant::now());
    let stdout = match out_rx.recv_timeout(wait_out) {
        Ok(b) => b,
        Err(_) => {
            kill_tree(&mut child);
            return Err("timeout");
        }
    };
    let wait_err = deadline.saturating_duration_since(Instant::now());
    let stderr = match err_rx.recv_timeout(wait_err) {
        Ok(b) => b,
        Err(_) => {
            kill_tree(&mut child);
            return Err("timeout");
        }
    };
    if stdout.len() > ENGINE_IO_CAP || stderr.len() > ENGINE_IO_CAP {
        return Err("output exceeded 4 KiB cap");
    }
    Ok(BoundedOutput {
        success: status.success(),
        stdout,
        stderr,
    })
}

/// Whether debug builds allow `test-doubles` engines under `LOAM_TEST_ALLOW_TEST_DOUBLES=1`.
/// Completely compiled out of release builds (amendment 5.1).
fn allow_test_doubles() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("LOAM_TEST_ALLOW_TEST_DOUBLES").as_deref() == Ok("1")
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

/// Post-consent build check: `[binary, "--version"]` (5 s timeout, 4 KiB cap, exit 0; refuses
/// `test-doubles` in stdout or stderr with `PLUGIN_ENGINE_TEST_BUILD`).
pub fn check_version(binary: &Path) -> Result<(), PluginError> {
    let out = run_bounded_command(binary, &["--version"], SHORT_TIMEOUT)
        .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if !out.success {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if (stdout.contains("test-doubles") || stderr.contains("test-doubles")) && !allow_test_doubles()
    {
        return Err(PluginError::from_code(PLUGIN_ENGINE_TEST_BUILD));
    }
    Ok(())
}

/// JSON object emitted by `<binary> pair ...` (amendment 5.1).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairOutput {
    pub token: String,
    pub token_id: String,
    pub role: String,
    pub proof_key: String,
}

/// Generates an 8-character random lowercase hex `<short-id>` for unique `pair --name` labels.
pub fn random_short_id() -> Result<String, PluginError> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes).map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    let mut out = String::with_capacity(8);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    Ok(out)
}

/// Pipe-based token pairing (amendment 5.1, invocation 3a):
/// `[binary, "pair", "--role", "<approver|agent>", "--name", "Loam Desktop (<short-id>)", "--accept-consent"]`.
pub fn pair_engine(binary: &Path, auth_mode: AuthMode) -> Result<PairOutput, PluginError> {
    let expected_role = match auth_mode {
        AuthMode::Approver => "approver",
        AuthMode::Agent => "agent",
        AuthMode::None => return Err(PluginError::from_code(PLUGIN_PAIR_FAILED)),
    };
    let short_id = random_short_id()?;
    let label = format!("Loam Desktop ({short_id})");
    let out = run_bounded_command(
        binary,
        &[
            "pair",
            "--role",
            expected_role,
            "--name",
            &label,
            "--accept-consent",
        ],
        PAIR_TIMEOUT,
    )
    .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if !out.success {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    let text =
        std::str::from_utf8(&out.stdout).map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    // Strictly one JSON object with no trailing non-whitespace bytes (`serde_json::from_str` rejects trailing bytes).
    let parsed: PairOutput =
        serde_json::from_str(text).map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if parsed.role != expected_role
        || !token_id(&parsed.token_id)
        || !hex64(&parsed.proof_key)
        || !key_shaped(&parsed.token)
    {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    Ok(parsed)
}

/// Pipe-based token revocation (amendment 5.1, invocation 3b):
/// `[binary, "unpair", "--token-id", "<tokenId>"]` (5 s timeout, idempotent exit 0).
pub fn unpair_engine(binary: &Path, tok_id: &str) -> Result<(), PluginError> {
    if !token_id(tok_id) {
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    let out = run_bounded_command(binary, &["unpair", "--token-id", tok_id], SHORT_TIMEOUT)
        .map_err(|_| PluginError::from_code(PLUGIN_PAIR_FAILED))?;
    if out.success {
        Ok(())
    } else {
        Err(PluginError::from_code(PLUGIN_PAIR_FAILED))
    }
}

/// Allocates a non-ephemeral loopback port in `17400..=17999`, preferring `preferred` on upgrade if
/// valid, otherwise choosing the first port disjoint from `state.plugins` that binds cleanly on
/// `127.0.0.1` (amendment 7.3, step 5).
pub fn allocate_port(state: &DesktopState, preferred: Option<u16>) -> Result<u16, PluginError> {
    let used: HashSet<u16> = state
        .plugins
        .iter()
        .filter_map(|p| p.engine.as_ref().map(|e| e.port))
        .collect();
    if let Some(port) = preferred
        && PORTS.contains(&port)
        && TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok()
    {
        return Ok(port);
    }
    for port in PORTS {
        if used.contains(&port) {
            continue;
        }
        if TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err(PluginError::from_code(PLUGIN_PORT_CONFLICT))
}

/// Result of polling a newly started (or already running) engine on `127.0.0.1:<port>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeOutcome {
    Ok,
    Unauthorized,
    PortConflict,
    Timeout,
}

/// Polls an engine at `http://127.0.0.1:<port>/mcp` for up to `timeout`:
/// - When `proof_key` and `bearer` are `Some`, verifies unauthenticated `/health?nonce=...`
///   `X-Loam-Proof` FIRST and sends `POST /mcp` (`MCP-Protocol-Version: 2026-07-28`,
///   `Authorization: Bearer <token>`) on that exact verified keep-alive TCP socket. Any `/health`
///   proof mismatch immediately returns `ProbeOutcome::PortConflict` with zero bearer sent.
/// - When `auth.mode == "none"` (`proof_key` is `None`), validates `POST /mcp` returns HTTP 200
///   with a JSON-RPC `"result"` object and no `"error"`.
pub async fn poll_engine_health(
    port: u16,
    proof_key: Option<&str>,
    bearer: Option<&str>,
    timeout: Duration,
) -> ProbeOutcome {
    let url = format!("http://127.0.0.1:{port}/mcp");
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return ProbeOutcome::Timeout;
        }
        let step_timeout = remaining.min(SINGLE_PROBE_TIMEOUT);
        let attempt = match (proof_key, bearer) {
            (Some(pk), Some(tok)) => probe_verified_mcp(&url, pk, tok, step_timeout).await,
            (None, None) => probe_unauthenticated_mcp_bounded(&url, step_timeout).await,
            _ => return ProbeOutcome::PortConflict,
        };
        match attempt {
            Ok(()) => return ProbeOutcome::Ok,
            Err(VerifiedProbeError::ProofFailed) => return ProbeOutcome::PortConflict,
            Err(VerifiedProbeError::Unauthorized) => return ProbeOutcome::Unauthorized,
            Err(VerifiedProbeError::NotReady | VerifiedProbeError::BadResponse) => {
                if tokio::time::Instant::now() >= deadline {
                    return ProbeOutcome::Timeout;
                }
                tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
            }
        }
    }
}

/// Synchronous single-shot or polling wrapper for callers outside an existing Tokio runtime.
pub fn poll_engine_health_blocking(
    port: u16,
    proof_key: Option<&str>,
    bearer: Option<&str>,
    timeout: Duration,
) -> ProbeOutcome {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            let pk = proof_key.map(str::to_owned);
            let tok = bearer.map(str::to_owned);
            std::thread::spawn(move || {
                handle.block_on(poll_engine_health(
                    port,
                    pk.as_deref(),
                    tok.as_deref(),
                    timeout,
                ))
            })
            .join()
            .unwrap_or(ProbeOutcome::Timeout)
        }
        Err(_) => {
            let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return ProbeOutcome::Timeout;
            };
            rt.block_on(poll_engine_health(port, proof_key, bearer, timeout))
        }
    }
}

/// Converts [`ProbeOutcome`] to a section 11 [`PluginError`].
pub fn probe_error(outcome: ProbeOutcome) -> PluginError {
    match outcome {
        ProbeOutcome::PortConflict => PluginError::from_code(PLUGIN_PORT_CONFLICT),
        ProbeOutcome::Unauthorized => PluginError::from_code(PLUGIN_PAIR_FAILED),
        ProbeOutcome::Timeout | ProbeOutcome::Ok => PluginError::from_code(PLUGIN_HEALTH_TIMEOUT),
    }
}
