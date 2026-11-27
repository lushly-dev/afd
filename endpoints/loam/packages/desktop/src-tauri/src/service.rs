//! OS login auto-start registration and service control (phase 5 no-terminal amendment, section 6;
//! D148 / D167).
//!
//! - **macOS (§6.1):** `launchd` LaunchAgent plist `dev.lushly.loam.plugin.<svc-id>.plist`, atomic
//!   mode `0600`, explicit allow-listed env, 1 MiB rotated stderr log (max 2 files), `/bin/launchctl`.
//! - **Windows (§6.2):** owner-only `launch.json` / `launch.pending.json`, native Win32
//!   `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value `LoamPlugin.<svc-id>` (`\\?\`-free,
//!   260-char pre-checked, refreshed on startup), plus windowless `loam-desktop engine-run`.
//! - **Linux (§6.3):** `systemd --user` unit (`/usr/bin/env -i`, `StandardError=journal`) with
//!   XDG Autostart `.desktop` + `loam-desktop engine-run` fallback.
//! - **Test override:** when `LOAM_DESKTOP_DATA_DIR` AND `LOAM_TEST_SERVICE_DIR` are both set,
//!   serializers write real service descriptors into `LOAM_TEST_SERVICE_DIR` and supervise the
//!   engine via `engine-run` locally without touching the host's real login items.
use crate::connection::{ensure_dir_owner_only, write_owner_only};
use crate::desktop_state::{DesktopState, PORTS, hex64};
use crate::keychain;
use crate::mounts::{Unread, read_owner_only};
use crate::plugin_manifest::plugin_id;
use crate::plugins_error::{
    DESKTOP_STATE_INVALID, DESKTOP_STATE_PERMISSIONS, PLUGIN_SERVICE_FAILED, PluginError,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Test-only environment override redirecting OS service descriptors into a temporary directory
/// (honored ONLY when `LOAM_DESKTOP_DATA_DIR` is set; amendment 6.3).
pub const TEST_SERVICE_DIR_ENV: &str = "LOAM_TEST_SERVICE_DIR";
/// Maximum Windows `HKCU\...\Run` command value length in UTF-16 code units (amendment 6.2).
pub const WINDOWS_RUN_MAX_CHARS: usize = 260;
/// Maximum stderr log size before rotation (1 MiB, max 2 files; amendment 6.1 & 6.2).
pub const STDERR_LOG_MAX_BYTES: u64 = 1024 * 1024;
/// Maximum `launch.json` file size.
const LAUNCH_FILE_MAX: usize = 16 * 1024;

/// Owner-only launch descriptor `<app data>/plugins/<plugin-id>/launch[.pending].json` (6.2 / 6.3).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LaunchDescriptor {
    pub plugin_id: String,
    pub bundle_sha256: String,
    pub binary_path: PathBuf,
    pub port: u16,
}

impl LaunchDescriptor {
    /// Validates `self` and verifies `binary_path` sits strictly inside
    /// `<data>/plugins/<plugin_id>/<bundleSha256>/` without symlinks (and ends in `.exe` on Windows).
    pub fn validate_under(
        &self,
        data: &Path,
        expected_plugin_id: &str,
    ) -> Result<(), &'static str> {
        if self.plugin_id != expected_plugin_id
            || !plugin_id(&self.plugin_id)
            || !hex64(&self.bundle_sha256)
            || !PORTS.contains(&self.port)
            || !self.binary_path.is_absolute()
        {
            return Err(DESKTOP_STATE_INVALID);
        }
        #[cfg(windows)]
        {
            let is_exe = self
                .binary_path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.to_ascii_lowercase().ends_with(".exe"));
            if !is_exe {
                return Err(DESKTOP_STATE_INVALID);
            }
        }
        let expected_root = data
            .join("plugins")
            .join(&self.plugin_id)
            .join(&self.bundle_sha256);
        let canonical_root =
            std::fs::canonicalize(&expected_root).map_err(|_| DESKTOP_STATE_INVALID)?;
        let meta =
            std::fs::symlink_metadata(&self.binary_path).map_err(|_| DESKTOP_STATE_INVALID)?;
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(DESKTOP_STATE_INVALID);
        }
        let canonical_bin =
            std::fs::canonicalize(&self.binary_path).map_err(|_| DESKTOP_STATE_INVALID)?;
        if !canonical_bin.starts_with(&canonical_root) {
            return Err(DESKTOP_STATE_INVALID);
        }
        Ok(())
    }
}

/// Profile-scoped service identifier `<svc-id>`: `<plugin-id>` for the default profile, or
/// `<plugin-id>-<profile8>` when `custom_data_dir` is set (amendment 6).
pub fn service_id(id: &str, custom_data_dir: Option<&Path>) -> Result<String, PluginError> {
    if !plugin_id(id) {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    Ok(match custom_data_dir {
        Some(dir) => format!("{id}-{}", keychain::profile_suffix(dir)),
        None => id.to_owned(),
    })
}

/// Path of `<data>/plugins/<plugin-id>/launch.json` or `launch.pending.json`.
pub fn launch_descriptor_path(data: &Path, id: &str, pending: bool) -> PathBuf {
    data.join("plugins").join(id).join(if pending {
        "launch.pending.json"
    } else {
        "launch.json"
    })
}

/// Writes `launch.json` or `launch.pending.json` atomically as an owner-only file.
pub fn write_launch_descriptor(
    data: &Path,
    desc: &LaunchDescriptor,
    pending: bool,
) -> Result<(), PluginError> {
    let path = launch_descriptor_path(data, &desc.plugin_id, pending);
    if let Some(parent) = path.parent() {
        ensure_dir_owner_only(parent).map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    }
    let bytes = serde_json::to_vec_pretty(desc)
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    write_owner_only(&path, &bytes).map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))
}

/// Reads `launch.json` or `launch.pending.json` via `read_owner_only`, refusing non-owner-only
/// files with `DESKTOP_STATE_PERMISSIONS`.
pub fn read_launch_descriptor(
    data: &Path,
    id: &str,
    pending: bool,
) -> Result<LaunchDescriptor, &'static str> {
    let path = launch_descriptor_path(data, id, pending);
    let bytes = match read_owner_only(&path, LAUNCH_FILE_MAX) {
        Ok(b) => b,
        Err(Unread::Denied) => return Err(DESKTOP_STATE_PERMISSIONS),
        Err(Unread::Missing | Unread::TooLarge) => return Err(DESKTOP_STATE_INVALID),
    };
    let desc: LaunchDescriptor =
        serde_json::from_slice(&bytes).map_err(|_| DESKTOP_STATE_INVALID)?;
    desc.validate_under(data, id)?;
    Ok(desc)
}

/// Removes `launch.json` or `launch.pending.json` best-effort.
pub fn remove_launch_descriptor(data: &Path, id: &str, pending: bool) {
    let _ = std::fs::remove_file(launch_descriptor_path(data, id, pending));
}

/// Path of `<data>/logs/plugin-<plugin-id>.stderr.log`.
pub fn stderr_log_path(data: &Path, id: &str) -> PathBuf {
    data.join("logs").join(format!("plugin-{id}.stderr.log"))
}

/// Rotates `<data>/logs/plugin-<id>.stderr.log` if it meets or exceeds 1 MiB (keeping at most 2
/// files: `.stderr.log` and `.stderr.log.1`; amendment 6.1 & 6.2).
pub fn rotate_stderr_log(data: &Path, id: &str) {
    let path = stderr_log_path(data, id);
    if let Some(parent) = path.parent() {
        let _ = ensure_dir_owner_only(parent);
    }
    if let Ok(meta) = std::fs::symlink_metadata(&path)
        && meta.is_file()
        && meta.len() >= STDERR_LOG_MAX_BYTES
    {
        let backup = path.with_file_name(format!("plugin-{id}.stderr.log.1"));
        let _ = std::fs::remove_file(&backup);
        let _ = std::fs::rename(&path, &backup);
    }
}

/// Strips Windows `\\?\` or `\\?\UNC\` verbatim prefixes before quoting paths for `HKCU\...\Run`
/// / `ShellExecute` (amendment 6.2).
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

/// Formats the Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value for
/// `LoamPlugin.<svc-id>`, stripping `\\?\` and enforcing the 260-character limit (amendment 6.2).
pub fn format_windows_run_value(
    exe_path: &Path,
    id: &str,
    custom_data_dir: Option<&Path>,
) -> Result<String, PluginError> {
    if !plugin_id(id) {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    let clean_exe = strip_verbatim_prefix(exe_path);
    let exe_str = clean_exe
        .to_str()
        .ok_or_else(|| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    if exe_str.contains(['"', '\r', '\n', '\0']) {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    let value = match custom_data_dir {
        Some(dir) => {
            let clean_dir = strip_verbatim_prefix(dir);
            let dir_str = clean_dir
                .to_str()
                .ok_or_else(|| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
            if dir_str.contains(['"', '\r', '\n', '\0']) {
                return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
            }
            format!("\"{exe_str}\" engine-run {id} --data-dir \"{dir_str}\"")
        }
        None => format!("\"{exe_str}\" engine-run {id}"),
    };
    if value.encode_utf16().count() > WINDOWS_RUN_MAX_CHARS {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    Ok(value)
}

fn xml_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

/// Renders the macOS `launchd` LaunchAgent XML plist for `dev.lushly.loam.plugin.<svc-id>` (§6.1).
/// Invokes `/usr/bin/env -i` with the exact allow-listed environment so inherited `launchd`
/// session variables never leak into the engine process.
pub fn render_launchd_plist(
    svc_id: &str,
    binary_path: &Path,
    port: u16,
    stderr_log: &Path,
    env_home: Option<&str>,
    env_tmpdir: Option<&str>,
    env_lang: Option<&str>,
) -> String {
    let label = format!("dev.lushly.loam.plugin.{svc_id}");
    let bin = xml_escape(&binary_path.to_string_lossy());
    let err = xml_escape(&stderr_log.to_string_lossy());
    let mut env_args = String::new();
    let mut env_xml = String::new();
    for (k, v) in [
        ("HOME", env_home),
        ("TMPDIR", env_tmpdir),
        ("LANG", env_lang),
        ("PATH", Some("/usr/bin:/bin")),
    ] {
        if let Some(val) = v
            && !val.is_empty()
        {
            let escaped = xml_escape(val);
            env_args.push_str(&format!("        <string>{k}={escaped}</string>\n"));
            env_xml.push_str(&format!(
                "        <key>{k}</key>\n        <string>{escaped}</string>\n"
            ));
        }
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>-i</string>
{env_args}        <string>{bin}</string>
        <string>serve</string>
        <string>--port</string>
        <string>{port}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
{env_xml}    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>{err}</string>
</dict>
</plist>
"#
    )
}

fn systemd_escape_arg(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '%' => out.push_str("%%"),
            '$' => out.push_str("$$"),
            '\n' | '\r' | '\0' => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn sanitize_single_line(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() && *c != '\u{2028}' && *c != '\u{2029}')
        .collect()
}

/// Renders the Linux `systemd --user` unit file (`loam-plugin-<svc-id>.service`) using
/// `/usr/bin/env -i` and `StandardError=journal` (amendment 6.3).
pub fn render_systemd_unit(
    title: &str,
    binary_path: &Path,
    port: u16,
    env_vars: &[(&str, Option<&str>)],
) -> String {
    let safe_title = sanitize_single_line(title);
    let mut exec = String::from("/usr/bin/env -i");
    for &(key, val) in env_vars {
        if let Some(v) = val
            && !v.is_empty()
        {
            exec.push(' ');
            exec.push_str(&systemd_escape_arg(&format!("{key}={v}")));
        }
    }
    exec.push_str(" PATH=/usr/bin:/bin ");
    exec.push_str(&systemd_escape_arg(&binary_path.to_string_lossy()));
    exec.push_str(&format!(" serve --port {port}"));
    format!(
        "[Unit]\n\
         Description=Loam plugin engine ({safe_title})\n\
         After=network.target\n\
         \n\
         [Service]\n\
         Type=simple\n\
         ExecStart={exec}\n\
         Restart=on-failure\n\
         RestartSec=5\n\
         StandardOutput=null\n\
         StandardError=journal\n\
         \n\
         [Install]\n\
         WantedBy=default.target\n"
    )
}

fn desktop_escape_arg(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '$' => out.push_str("\\$"),
            '`' => out.push_str("\\`"),
            '%' => out.push_str("%%"),
            '\n' | '\r' | '\0' => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Renders the non-systemd Linux XDG Autostart `.desktop` file (`loam-plugin-<svc-id>.desktop`; §6.3).
pub fn render_xdg_desktop(
    title: &str,
    exe_path: &Path,
    id: &str,
    custom_data_dir: Option<&Path>,
) -> String {
    let safe_title = sanitize_single_line(title);
    let mut exec = format!(
        "{} engine-run {id}",
        desktop_escape_arg(&exe_path.to_string_lossy())
    );
    if let Some(dir) = custom_data_dir {
        exec.push_str(" --data-dir ");
        exec.push_str(&desktop_escape_arg(&dir.to_string_lossy()));
    }
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Loam Plugin Engine ({safe_title})\n\
         Exec={exec}\n\
         NoDisplay=true\n\
         X-GNOME-Autostart-enabled=true\n"
    )
}

/// Test-only service directory, active ONLY when `LOAM_DESKTOP_DATA_DIR` is also set (amendment 6.3).
pub fn test_service_dir(custom_data_dir: Option<&Path>) -> Option<PathBuf> {
    custom_data_dir?;
    std::env::var_os(TEST_SERVICE_DIR_ENV)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Parameters required to register, start, stop, or unregister a plugin's login service.
#[derive(Debug, Clone)]
pub struct ServiceSpec<'a> {
    pub data: &'a Path,
    pub custom_data_dir: Option<&'a Path>,
    pub plugin_id: &'a str,
    pub title: &'a str,
    pub bundle_sha256: &'a str,
    pub binary_path: &'a Path,
    pub port: u16,
    /// Optional override for the `loam-desktop` supervisor executable path (defaults to `current_exe()`).
    pub supervisor_exe: Option<&'a Path>,
}

impl<'a> ServiceSpec<'a> {
    fn descriptor(&self) -> LaunchDescriptor {
        LaunchDescriptor {
            plugin_id: self.plugin_id.to_owned(),
            bundle_sha256: self.bundle_sha256.to_owned(),
            binary_path: self.binary_path.to_path_buf(),
            port: self.port,
        }
    }

    fn exe_path(&self) -> Result<PathBuf, PluginError> {
        match self.supervisor_exe {
            Some(p) => Ok(p.to_path_buf()),
            None => {
                std::env::current_exe().map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))
            }
        }
    }
}

/// Starts a pending service during Phase 3 commit BEFORE `desktop-state.json` is written (§7.3 step 7).
pub fn start_pending(spec: &ServiceSpec<'_>) -> Result<(), PluginError> {
    let svc = service_id(spec.plugin_id, spec.custom_data_dir)?;
    rotate_stderr_log(spec.data, spec.plugin_id);
    if let Some(test_dir) = test_service_dir(spec.custom_data_dir) {
        write_launch_descriptor(spec.data, &spec.descriptor(), true)?;
        write_test_service_descriptors(&test_dir, &svc, spec)?;
        return spawn_engine_run(spec, true);
    }
    #[cfg(target_os = "macos")]
    {
        write_and_load_launchd(&svc, spec)
    }
    #[cfg(windows)]
    {
        let exe = spec.exe_path()?;
        let _ = format_windows_run_value(&exe, spec.plugin_id, spec.custom_data_dir)?;
        write_launch_descriptor(spec.data, &spec.descriptor(), true)?;
        spawn_engine_run(spec, true)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            write_and_enable_systemd(&svc, spec)
        } else {
            write_launch_descriptor(spec.data, &spec.descriptor(), true)?;
            spawn_engine_run(spec, true)
        }
    }
}

/// Promotes a verified pending service to its permanent login-service registration AFTER
/// `desktop-state.json` has durably committed (§7.3 step 9). Writes the permanent descriptor and
/// login-item registration BEFORE stopping the verified pending supervisor so any write failure
/// leaves the pending supervisor running for clean rollback. Returns `Ok(true)` when promotion
/// switched from a pending `engine-run` supervisor to the permanent one.
pub fn promote_pending(spec: &ServiceSpec<'_>) -> Result<bool, PluginError> {
    let svc = service_id(spec.plugin_id, spec.custom_data_dir)?;
    if let Some(test_dir) = test_service_dir(spec.custom_data_dir) {
        write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
        write_test_service_descriptors(&test_dir, &svc, spec)?;
        let _ = stop_engine_run(spec.data, spec.plugin_id, spec.custom_data_dir, true);
        remove_launch_descriptor(spec.data, spec.plugin_id, true);
        spawn_engine_run(spec, false)?;
        return Ok(true);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = svc;
        // launchd already loaded the permanent plist pointing at `<bundleSha256>`.
        Ok(false)
    }
    #[cfg(windows)]
    {
        let exe = spec.exe_path()?;
        let run_val = format_windows_run_value(&exe, spec.plugin_id, spec.custom_data_dir)?;
        write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
        windows_registry::set_run_value(&svc, &run_val)?;
        let _ = stop_engine_run(spec.data, spec.plugin_id, spec.custom_data_dir, true);
        remove_launch_descriptor(spec.data, spec.plugin_id, true);
        spawn_engine_run(spec, false)?;
        Ok(true)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            Ok(false)
        } else {
            let exe = spec.exe_path()?;
            write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
            write_xdg_autostart(&svc, spec.title, &exe, spec.plugin_id, spec.custom_data_dir)?;
            let _ = stop_engine_run(spec.data, spec.plugin_id, spec.custom_data_dir, true);
            remove_launch_descriptor(spec.data, spec.plugin_id, true);
            spawn_engine_run(spec, false)?;
            Ok(true)
        }
    }
}

/// Rolls back a pending service started in Phase 3 before `desktop-state.json` committed.
pub fn rollback_pending(
    data: &Path,
    custom_data_dir: Option<&Path>,
    id: &str,
) -> Result<(), PluginError> {
    let svc = service_id(id, custom_data_dir)?;
    if let Some(test_dir) = test_service_dir(custom_data_dir) {
        let _ = stop_engine_run(data, id, custom_data_dir, true);
        remove_launch_descriptor(data, id, true);
        remove_test_service_descriptors(&test_dir, &svc);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        bootout_and_remove_launchd(&svc);
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = stop_engine_run(data, id, custom_data_dir, true);
        remove_launch_descriptor(data, id, true);
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            disable_and_remove_systemd(&svc);
        } else {
            let _ = stop_engine_run(data, id, custom_data_dir, true);
            remove_launch_descriptor(data, id, true);
        }
        Ok(())
    }
}

/// Registers and starts a committed plugin service (used for rollback restart of a previous
/// version, startup reconciliation, and `service_action("start" | "restart")`).
pub fn register_and_start(spec: &ServiceSpec<'_>) -> Result<(), PluginError> {
    let svc = service_id(spec.plugin_id, spec.custom_data_dir)?;
    rotate_stderr_log(spec.data, spec.plugin_id);
    if let Some(test_dir) = test_service_dir(spec.custom_data_dir) {
        write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
        write_test_service_descriptors(&test_dir, &svc, spec)?;
        return spawn_engine_run(spec, false);
    }
    #[cfg(target_os = "macos")]
    {
        write_and_load_launchd(&svc, spec)
    }
    #[cfg(windows)]
    {
        let exe = spec.exe_path()?;
        let run_val = format_windows_run_value(&exe, spec.plugin_id, spec.custom_data_dir)?;
        write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
        windows_registry::set_run_value(&svc, &run_val)?;
        spawn_engine_run(spec, false)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            write_and_enable_systemd(&svc, spec)
        } else {
            let exe = spec.exe_path()?;
            write_launch_descriptor(spec.data, &spec.descriptor(), false)?;
            write_xdg_autostart(&svc, spec.title, &exe, spec.plugin_id, spec.custom_data_dir)?;
            spawn_engine_run(spec, false)
        }
    }
}

/// Stops a running plugin service WITHOUT removing its committed `launch.json` or login entry
/// (used during upgrade before installing the new version, and for `service_action("stop")`).
pub fn stop_service(
    data: &Path,
    custom_data_dir: Option<&Path>,
    id: &str,
) -> Result<(), PluginError> {
    let svc = service_id(id, custom_data_dir)?;
    if test_service_dir(custom_data_dir).is_some() {
        let _ = stop_engine_run(data, id, custom_data_dir, false);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        launchctl_bootout(&svc);
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = svc;
        let _ = stop_engine_run(data, id, custom_data_dir, false);
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            let unit = format!("loam-plugin-{svc}.service");
            let _ = Command::new("systemctl")
                .args(["--user", "stop", &unit])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        } else {
            let _ = stop_engine_run(data, id, custom_data_dir, false);
        }
        Ok(())
    }
}

/// Stops AND unregisters a plugin's OS login service and deletes `launch.json` (used on uninstall).
pub fn unregister_service(
    data: &Path,
    custom_data_dir: Option<&Path>,
    id: &str,
) -> Result<(), PluginError> {
    let svc = service_id(id, custom_data_dir)?;
    if let Some(test_dir) = test_service_dir(custom_data_dir) {
        let _ = stop_engine_run(data, id, custom_data_dir, false);
        let _ = stop_engine_run(data, id, custom_data_dir, true);
        remove_launch_descriptor(data, id, false);
        remove_launch_descriptor(data, id, true);
        remove_test_service_descriptors(&test_dir, &svc);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        bootout_and_remove_launchd(&svc);
        remove_launch_descriptor(data, id, false);
        remove_launch_descriptor(data, id, true);
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = stop_engine_run(data, id, custom_data_dir, false);
        let _ = stop_engine_run(data, id, custom_data_dir, true);
        windows_registry::delete_run_value(&svc)?;
        remove_launch_descriptor(data, id, false);
        remove_launch_descriptor(data, id, true);
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if systemd_user_active() {
            disable_and_remove_systemd(&svc);
        }
        let _ = stop_engine_run(data, id, custom_data_dir, false);
        let _ = stop_engine_run(data, id, custom_data_dir, true);
        remove_xdg_autostart(&svc);
        remove_launch_descriptor(data, id, false);
        remove_launch_descriptor(data, id, true);
        Ok(())
    }
}

/// On managed-mode startup, rotates plugin stderr logs (§6.1) and reconciles `launch.json` plus
/// OS login service registrations against committed `desktop-state.json` (§6.2, §7.3 step 9, §9.1).
pub fn reconcile_startup_services(
    data: &Path,
    state: &DesktopState,
    custom_data_dir: Option<&Path>,
) {
    let target = crate::plugin_manifest::Target::current();
    for plugin in &state.plugins {
        let Some(eng_state) = &plugin.engine else {
            continue;
        };
        rotate_stderr_log(data, &plugin.id);

        let Some(target) = target else {
            continue;
        };
        let bundle_dir = data
            .join("plugins")
            .join(&plugin.id)
            .join(&plugin.bundle_sha256);
        let Ok(manifest_bytes) = std::fs::read(bundle_dir.join("plugin-manifest.json")) else {
            continue;
        };
        let Some((manifest, _)) = crate::plugin_manifest::read(&manifest_bytes) else {
            continue;
        };
        let Some(artifact) = manifest
            .engine
            .as_ref()
            .and_then(|e| e.artifacts.get(&target))
        else {
            continue;
        };
        let mut binary_path = bundle_dir.clone();
        for seg in artifact.path.split('/') {
            binary_path.push(seg);
        }
        let expected_desc = LaunchDescriptor {
            plugin_id: plugin.id.clone(),
            bundle_sha256: plugin.bundle_sha256.clone(),
            binary_path: binary_path.clone(),
            port: eng_state.port,
        };
        let Ok(svc) = service_id(&plugin.id, custom_data_dir) else {
            continue;
        };
        let spec = ServiceSpec {
            data,
            custom_data_dir,
            plugin_id: &plugin.id,
            title: &manifest.plugin.title,
            bundle_sha256: &plugin.bundle_sha256,
            binary_path: &binary_path,
            port: eng_state.port,
            supervisor_exe: None,
        };

        if let Some(test_dir) = test_service_dir(custom_data_dir) {
            if read_launch_descriptor(data, &plugin.id, false)
                .ok()
                .as_ref()
                != Some(&expected_desc)
            {
                let _ = write_launch_descriptor(data, &expected_desc, false);
                let _ = write_test_service_descriptors(&test_dir, &svc, &spec);
            }
            continue;
        }

        #[cfg(target_os = "macos")]
        {
            if let Ok(plist_path) = launchd_plist_path(&svc) {
                let expected = render_launchd_plist(
                    &svc,
                    &binary_path,
                    eng_state.port,
                    &stderr_log_path(data, &plugin.id),
                    std::env::var("HOME").ok().as_deref(),
                    std::env::var("TMPDIR").ok().as_deref(),
                    std::env::var("LANG").ok().as_deref(),
                );
                let current = std::fs::read_to_string(&plist_path).ok();
                if current.as_deref() != Some(expected.as_str()) {
                    let _ = write_and_load_launchd(&svc, &spec);
                }
            }
        }
        #[cfg(windows)]
        {
            let desc_stale = read_launch_descriptor(data, &plugin.id, false)
                .ok()
                .as_ref()
                != Some(&expected_desc);
            if desc_stale {
                let _ = write_launch_descriptor(data, &expected_desc, false);
            }
            if let Ok(exe) = std::env::current_exe()
                && let Ok(expected) = format_windows_run_value(&exe, &plugin.id, custom_data_dir)
                && windows_registry::get_run_value(&svc).as_deref() != Some(expected.as_str())
            {
                let _ = windows_registry::set_run_value(&svc, &expected);
            }
            if desc_stale {
                let _ = stop_engine_run(data, &plugin.id, custom_data_dir, false);
                let _ = spawn_engine_run(&spec, false);
            }
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            if systemd_user_active() {
                if let Some(config) = xdg_config_home() {
                    let unit_path = config
                        .join("systemd")
                        .join("user")
                        .join(format!("loam-plugin-{svc}.service"));
                    let home = std::env::var("HOME").ok();
                    let xdg_data = std::env::var("XDG_DATA_HOME").ok();
                    let xdg_cfg = std::env::var("XDG_CONFIG_HOME").ok();
                    let xdg_rt = std::env::var("XDG_RUNTIME_DIR").ok();
                    let tmpdir = std::env::var("TMPDIR").ok();
                    let lang = std::env::var("LANG").ok();
                    let expected = render_systemd_unit(
                        &manifest.plugin.title,
                        &binary_path,
                        eng_state.port,
                        &[
                            ("HOME", home.as_deref()),
                            ("XDG_DATA_HOME", xdg_data.as_deref()),
                            ("XDG_CONFIG_HOME", xdg_cfg.as_deref()),
                            ("XDG_RUNTIME_DIR", xdg_rt.as_deref()),
                            ("TMPDIR", tmpdir.as_deref()),
                            ("LANG", lang.as_deref()),
                        ],
                    );
                    if std::fs::read_to_string(&unit_path).ok().as_deref()
                        != Some(expected.as_str())
                    {
                        let _ = write_and_enable_systemd(&svc, &spec);
                    }
                }
            } else {
                let desc_stale = read_launch_descriptor(data, &plugin.id, false)
                    .ok()
                    .as_ref()
                    != Some(&expected_desc);
                if desc_stale {
                    let _ = write_launch_descriptor(data, &expected_desc, false);
                    if let Ok(exe) = std::env::current_exe() {
                        let _ = write_xdg_autostart(
                            &svc,
                            &manifest.plugin.title,
                            &exe,
                            &plugin.id,
                            custom_data_dir,
                        );
                    }
                    let _ = stop_engine_run(data, &plugin.id, custom_data_dir, false);
                    let _ = spawn_engine_run(&spec, false);
                }
            }
        }
    }
}

fn write_test_service_descriptors(
    test_dir: &Path,
    svc: &str,
    spec: &ServiceSpec<'_>,
) -> Result<(), PluginError> {
    ensure_dir_owner_only(test_dir).map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let exe = spec.exe_path()?;
    let plist = render_launchd_plist(
        svc,
        spec.binary_path,
        spec.port,
        &stderr_log_path(spec.data, spec.plugin_id),
        std::env::var("HOME").ok().as_deref(),
        std::env::var("TMPDIR").ok().as_deref(),
        std::env::var("LANG").ok().as_deref(),
    );
    write_owner_only(
        &test_dir.join(format!("dev.lushly.loam.plugin.{svc}.plist")),
        plist.as_bytes(),
    )
    .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;

    let home = std::env::var("HOME").ok();
    let xdg_data = std::env::var("XDG_DATA_HOME").ok();
    let xdg_cfg = std::env::var("XDG_CONFIG_HOME").ok();
    let xdg_rt = std::env::var("XDG_RUNTIME_DIR").ok();
    let tmpdir = std::env::var("TMPDIR").ok();
    let lang = std::env::var("LANG").ok();
    let unit = render_systemd_unit(
        spec.title,
        spec.binary_path,
        spec.port,
        &[
            ("HOME", home.as_deref()),
            ("XDG_DATA_HOME", xdg_data.as_deref()),
            ("XDG_CONFIG_HOME", xdg_cfg.as_deref()),
            ("XDG_RUNTIME_DIR", xdg_rt.as_deref()),
            ("TMPDIR", tmpdir.as_deref()),
            ("LANG", lang.as_deref()),
        ],
    );
    write_owner_only(
        &test_dir.join(format!("loam-plugin-{svc}.service")),
        unit.as_bytes(),
    )
    .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;

    let desktop = render_xdg_desktop(spec.title, &exe, spec.plugin_id, spec.custom_data_dir);
    write_owner_only(
        &test_dir.join(format!("loam-plugin-{svc}.desktop")),
        desktop.as_bytes(),
    )
    .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;

    if let Ok(run_val) = format_windows_run_value(&exe, spec.plugin_id, spec.custom_data_dir) {
        write_owner_only(
            &test_dir.join(format!("LoamPlugin.{svc}.run")),
            run_val.as_bytes(),
        )
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    }
    Ok(())
}

fn remove_test_service_descriptors(test_dir: &Path, svc: &str) {
    for name in [
        format!("dev.lushly.loam.plugin.{svc}.plist"),
        format!("loam-plugin-{svc}.service"),
        format!("loam-plugin-{svc}.desktop"),
        format!("LoamPlugin.{svc}.run"),
    ] {
        let _ = std::fs::remove_file(test_dir.join(name));
    }
}

fn spawn_engine_run(spec: &ServiceSpec<'_>, pending: bool) -> Result<(), PluginError> {
    let exe = spec.exe_path()?;
    let mut cmd = Command::new(exe);
    cmd.arg("engine-run").arg(spec.plugin_id);
    if pending {
        cmd.arg("--pending");
    }
    if let Some(custom) = spec.custom_data_dir {
        cmd.arg("--data-dir").arg(custom);
        cmd.env(crate::DATA_DIRECTORY, custom);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn()
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    Ok(())
}

fn stop_engine_run(
    data: &Path,
    id: &str,
    custom_data_dir: Option<&Path>,
    pending: bool,
) -> Result<(), PluginError> {
    crate::engine_run::signal_stop(data, id, custom_data_dir, pending)
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))
}

#[cfg(target_os = "macos")]
fn launchd_plist_path(svc: &str) -> Result<PathBuf, PluginError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let dir = home.join("Library").join("LaunchAgents");
    std::fs::create_dir_all(&dir).map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    Ok(dir.join(format!("dev.lushly.loam.plugin.{svc}.plist")))
}

#[cfg(target_os = "macos")]
fn launchd_uid() -> u32 {
    // SAFETY: `getuid` has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

#[cfg(target_os = "macos")]
fn launchctl_bootout(svc: &str) {
    let target = format!("gui/{}/dev.lushly.loam.plugin.{svc}", launchd_uid());
    let _ = Command::new("/bin/launchctl")
        .args(["bootout", &target])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(target_os = "macos")]
fn bootout_and_remove_launchd(svc: &str) {
    launchctl_bootout(svc);
    if let Ok(path) = launchd_plist_path(svc) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(target_os = "macos")]
fn write_and_load_launchd(svc: &str, spec: &ServiceSpec<'_>) -> Result<(), PluginError> {
    let path = launchd_plist_path(svc)?;
    let plist = render_launchd_plist(
        svc,
        spec.binary_path,
        spec.port,
        &stderr_log_path(spec.data, spec.plugin_id),
        std::env::var("HOME").ok().as_deref(),
        std::env::var("TMPDIR").ok().as_deref(),
        std::env::var("LANG").ok().as_deref(),
    );
    write_owner_only(&path, plist.as_bytes())
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    launchctl_bootout(svc);
    let domain = format!("gui/{}", launchd_uid());
    let status = Command::new("/bin/launchctl")
        .args(["bootstrap", &domain])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    if status.success() {
        Ok(())
    } else {
        Err(PluginError::from_code(PLUGIN_SERVICE_FAILED))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn xdg_config_home() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}

/// Parses `systemctl --user is-system-running` stdout to distinguish a live user manager from
/// `"offline"` or D-Bus connection errors (which also exit with code `1`).
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
pub(crate) fn is_live_systemd_state(stdout: &str) -> bool {
    matches!(stdout.trim(), "running" | "degraded" | "starting")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn systemd_user_active() -> bool {
    Command::new("systemctl")
        .args(["--user", "is-system-running"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .is_some_and(|text| is_live_systemd_state(&text))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write_and_enable_systemd(svc: &str, spec: &ServiceSpec<'_>) -> Result<(), PluginError> {
    let config = xdg_config_home().ok_or_else(|| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let unit_dir = config.join("systemd").join("user");
    std::fs::create_dir_all(&unit_dir)
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let unit_name = format!("loam-plugin-{svc}.service");
    let unit_path = unit_dir.join(&unit_name);
    let home = std::env::var("HOME").ok();
    let xdg_data = std::env::var("XDG_DATA_HOME").ok();
    let xdg_cfg = std::env::var("XDG_CONFIG_HOME").ok();
    let xdg_rt = std::env::var("XDG_RUNTIME_DIR").ok();
    let tmpdir = std::env::var("TMPDIR").ok();
    let lang = std::env::var("LANG").ok();
    let unit = render_systemd_unit(
        spec.title,
        spec.binary_path,
        spec.port,
        &[
            ("HOME", home.as_deref()),
            ("XDG_DATA_HOME", xdg_data.as_deref()),
            ("XDG_CONFIG_HOME", xdg_cfg.as_deref()),
            ("XDG_RUNTIME_DIR", xdg_rt.as_deref()),
            ("TMPDIR", tmpdir.as_deref()),
            ("LANG", lang.as_deref()),
        ],
    );
    write_owner_only(&unit_path, unit.as_bytes())
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let reload = Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    if !reload.success() {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    let enable = Command::new("systemctl")
        .args(["--user", "enable", "--now", &unit_name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    if !enable.success() {
        return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
    }
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn disable_and_remove_systemd(svc: &str) {
    let unit_name = format!("loam-plugin-{svc}.service");
    let _ = Command::new("systemctl")
        .args(["--user", "disable", "--now", &unit_name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if let Some(config) = xdg_config_home() {
        let _ = std::fs::remove_file(config.join("systemd").join("user").join(&unit_name));
    }
    let _ = Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write_xdg_autostart(
    svc: &str,
    title: &str,
    exe: &Path,
    id: &str,
    custom_data_dir: Option<&Path>,
) -> Result<(), PluginError> {
    let config = xdg_config_home().ok_or_else(|| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let dir = config.join("autostart");
    std::fs::create_dir_all(&dir).map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))?;
    let content = render_xdg_desktop(title, exe, id, custom_data_dir);
    write_owner_only(
        &dir.join(format!("loam-plugin-{svc}.desktop")),
        content.as_bytes(),
    )
    .map_err(|_| PluginError::from_code(PLUGIN_SERVICE_FAILED))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn remove_xdg_autostart(svc: &str) {
    if let Some(config) = xdg_config_home() {
        let _ = std::fs::remove_file(
            config
                .join("autostart")
                .join(format!("loam-plugin-{svc}.desktop")),
        );
    }
}

#[cfg(windows)]
mod windows_registry {
    use super::*;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW,
    };

    const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    fn wide_nul(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn set_run_value(svc: &str, command: &str) -> Result<(), PluginError> {
        let subkey = wide_nul(RUN_SUBKEY);
        let value_name = wide_nul(&format!("LoamPlugin.{svc}"));
        let data = wide_nul(command);
        let data_bytes: Vec<u8> = data.iter().flat_map(|u| u.to_le_bytes()).collect();
        let mut hkey: HKEY = null_mut();
        // SAFETY: `subkey` is NUL-terminated UTF-16; `hkey` is closed below on success.
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                null_mut(),
                &mut hkey,
                null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
        }
        // SAFETY: `hkey` is open; `value_name` and `data_bytes` outlive the synchronous call.
        let set_status = unsafe {
            RegSetValueExW(
                hkey,
                value_name.as_ptr(),
                0,
                REG_SZ,
                data_bytes.as_ptr(),
                data_bytes.len() as u32,
            )
        };
        // SAFETY: `hkey` was opened by `RegCreateKeyExW` and is closed once.
        unsafe { RegCloseKey(hkey) };
        if set_status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(PluginError::from_code(PLUGIN_SERVICE_FAILED))
        }
    }

    pub fn get_run_value(svc: &str) -> Option<String> {
        let subkey = wide_nul(RUN_SUBKEY);
        let value_name = wide_nul(&format!("LoamPlugin.{svc}"));
        let mut hkey: HKEY = null_mut();
        // SAFETY: `subkey` is NUL-terminated UTF-16; `hkey` is closed below on success.
        if unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut hkey,
            )
        } != ERROR_SUCCESS
        {
            return None;
        }
        let mut kind = 0u32;
        let mut needed = 0u32;
        // SAFETY: queries required byte length into `needed`.
        let status = unsafe {
            RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                null_mut(),
                &mut kind,
                null_mut(),
                &mut needed,
            )
        };
        if status != ERROR_SUCCESS || kind != REG_SZ || needed == 0 || !needed.is_multiple_of(2) {
            unsafe { RegCloseKey(hkey) };
            return None;
        }
        let mut buf = vec![0u16; (needed as usize) / 2];
        // SAFETY: `buf` has `needed` bytes capacity.
        let read = unsafe {
            RegQueryValueExW(
                hkey,
                value_name.as_ptr(),
                null_mut(),
                &mut kind,
                buf.as_mut_ptr().cast::<u8>(),
                &mut needed,
            )
        };
        unsafe { RegCloseKey(hkey) };
        if read != ERROR_SUCCESS {
            return None;
        }
        while buf.last() == Some(&0) {
            buf.pop();
        }
        String::from_utf16(&buf).ok()
    }

    pub fn delete_run_value(svc: &str) -> Result<(), PluginError> {
        let subkey = wide_nul(RUN_SUBKEY);
        let value_name = wide_nul(&format!("LoamPlugin.{svc}"));
        let mut hkey: HKEY = null_mut();
        // SAFETY: `subkey` is NUL-terminated UTF-16; `hkey` is closed below on success.
        let open = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                KEY_SET_VALUE,
                &mut hkey,
            )
        };
        if open == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if open != ERROR_SUCCESS {
            return Err(PluginError::from_code(PLUGIN_SERVICE_FAILED));
        }
        // SAFETY: `hkey` is open and `value_name` is NUL-terminated UTF-16.
        let del = unsafe { RegDeleteValueW(hkey, value_name.as_ptr()) };
        unsafe { RegCloseKey(hkey) };
        if del == ERROR_SUCCESS || del == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(PluginError::from_code(PLUGIN_SERVICE_FAILED))
        }
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
