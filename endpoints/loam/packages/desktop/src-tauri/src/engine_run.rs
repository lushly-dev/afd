//! `loam-desktop engine-run <plugin-id> [--pending] [--data-dir <dir>]` supervisor (phase 5
//! no-terminal amendment, 6.2 & 6.3; D167).
//!
//! Dispatched from `main.rs` BEFORE Tauri or `tauri-plugin-single-instance` starts and WITHOUT
//! `attach_console()`, so Windows logon launches produce zero console window flash.
//!
//! - **Windows:** named per-user Win32 mutex (`Local\LoamPluginRun[Pending]-<svc-id>`), Job Object
//!   (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), `CREATE_NO_WINDOW`, and named Win32 stop event
//!   (`Local\LoamPluginStop[Pending]-<svc-id>`).
//! - **Unix (non-systemd Linux XDG fallback and `LOAM_TEST_SERVICE_DIR`):** exclusive `flock` on
//!   owner-only `<data>/plugins/<id>/engine-run[.pending].lock` + owner-only Unix domain control
//!   socket for clean cross-reboot shutdown with zero PID-reuse hazard.
//! - **Both:** caps stderr log growth at 1 MiB (max 2 rotated files) and supervises crash restarts
//!   with exponential backoff from 5 s to 60 s.
use crate::connection::{self, ensure_dir_owner_only};
use crate::plugin_manifest::plugin_id;
use crate::plugins_engine::apply_clean_env;
use crate::service::{STDERR_LOG_MAX_BYTES, read_launch_descriptor, service_id, stderr_log_path};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const INITIAL_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const HEALTHY_RESET_AFTER: Duration = Duration::from_secs(60);
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(6);

/// Entry point for `loam-desktop engine-run <plugin-id> [--pending] [--data-dir <dir>]`.
pub fn run(args: &[String]) -> i32 {
    let mut plugin: Option<String> = None;
    let mut pending = false;
    let mut data_dir_arg: Option<PathBuf> = None;
    let mut idx = 0;
    while idx < args.len() {
        match args[idx].as_str() {
            "--pending" => pending = true,
            "--data-dir" => {
                idx += 1;
                let Some(val) = args.get(idx) else {
                    return 2;
                };
                data_dir_arg = Some(PathBuf::from(val));
            }
            arg if !arg.starts_with('-') && plugin.is_none() => {
                plugin = Some(arg.to_owned());
            }
            _ => return 2,
        }
        idx += 1;
    }
    let Some(id) = plugin.filter(|s| plugin_id(s)) else {
        return 2;
    };
    let custom = data_dir_arg
        .clone()
        .or_else(crate::keychain::custom_data_dir);
    let Some(data) = data_dir_arg.or_else(connection::data_directory) else {
        return 1;
    };
    supervise(&data, &id, custom.as_deref(), pending)
}

/// Supervises `<binary> serve --port <port>` read from owner-only `launch[.pending].json` until
/// signaled to stop. Returns `0` on clean stop or duplicate-instance exit, non-zero on config error.
pub fn supervise(data: &Path, id: &str, custom_data_dir: Option<&Path>, pending: bool) -> i32 {
    let Ok(svc) = service_id(id, custom_data_dir) else {
        return 1;
    };
    let Ok(descriptor) = read_launch_descriptor(data, id, pending) else {
        return 1;
    };
    let Ok(guard) = platform::acquire_instance(data, id, &svc, pending) else {
        // Another supervisor instance is already running for this `(svc, pending)` slot.
        return 0;
    };
    let stop_flag = guard.stop_flag();
    let log_path = stderr_log_path(data, id);
    if let Some(parent) = log_path.parent() {
        let _ = ensure_dir_owner_only(parent);
    }

    let mut backoff = INITIAL_BACKOFF;
    while !stop_flag.load(Ordering::SeqCst) {
        let started = Instant::now();
        let mut cmd = Command::new(&descriptor.binary_path);
        cmd.args(["serve", "--port", &descriptor.port.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
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
        let Ok(mut child) = cmd.spawn() else {
            if !sleep_until_stop(&stop_flag, backoff) {
                break;
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
            continue;
        };
        #[cfg(windows)]
        let job = match platform::attach_job_object(&child) {
            Some(j) => j,
            None => {
                terminate_child(&mut child);
                if !sleep_until_stop(&stop_flag, backoff) {
                    break;
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
        };

        let log_thread = child.stderr.take().map(|pipe| {
            let target = log_path.clone();
            std::thread::spawn(move || pump_rotated_stderr(pipe, &target))
        });

        let stopped_by_signal = wait_child_or_stop(&mut child, &stop_flag);
        // Drop the Windows Job Object BEFORE joining the stderr reader so any grandchild holding
        // the stderr write pipe is terminated immediately and cannot deadlock shutdown.
        #[cfg(windows)]
        drop(job);
        if let Some(handle) = log_thread {
            let _ = handle.join();
        }
        if stopped_by_signal {
            break;
        }
        if started.elapsed() >= HEALTHY_RESET_AFTER {
            backoff = INITIAL_BACKOFF;
        }
        if !sleep_until_stop(&stop_flag, backoff) {
            break;
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
    drop(guard);
    0
}

/// Signals a running `engine-run` supervisor for `(id, pending)` to stop cleanly and waits until
/// it exits (up to `STOP_WAIT_TIMEOUT`). Idempotent if no supervisor is running.
pub fn signal_stop(
    data: &Path,
    id: &str,
    custom_data_dir: Option<&Path>,
    pending: bool,
) -> Result<(), &'static str> {
    let svc = service_id(id, custom_data_dir).map_err(|_| "invalid plugin id")?;
    platform::signal_stop(data, id, &svc, pending)
}

fn wait_child_or_stop(child: &mut Child, stop: &AtomicBool) -> bool {
    loop {
        if stop.load(Ordering::SeqCst) {
            terminate_child(child);
            return true;
        }
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return false,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn sleep_until_stop(stop: &AtomicBool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        let step = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(100));
        std::thread::sleep(step);
    }
    !stop.load(Ordering::SeqCst)
}

fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Ok(pgid) = i32::try_from(child.id()) {
            // SAFETY: sends SIGTERM to our own child's process group created via `process_group(0)`.
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            // SAFETY: escalates to SIGKILL on our own child's process group after grace timeout.
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Copies `pipe` into `log_path`, rotating to `<log_path>.1` whenever size hits 1 MiB (max 2
/// files, owner-only `0600` on Unix).
pub(crate) fn pump_rotated_stderr(mut pipe: impl Read, log_path: &Path) {
    let backup = {
        let mut os = log_path.as_os_str().to_os_string();
        os.push(".1");
        PathBuf::from(os)
    };
    let mut buf = [0u8; 4096];
    while let Ok(n) = pipe.read(&mut buf) {
        if n == 0 {
            break;
        }
        let current_len = std::fs::symlink_metadata(log_path)
            .ok()
            .filter(|m| m.is_file())
            .map_or(0, |m| m.len());
        if current_len.saturating_add(n as u64) > STDERR_LOG_MAX_BYTES {
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(log_path, &backup);
        }
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        if let Ok(mut file) = opts.open(log_path) {
            let _ = file.write_all(&buf[..n]);
        }
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use crate::connection::open_lock_owner_only;
    use sha2::{Digest, Sha256};
    use std::os::unix::net::{UnixListener, UnixStream};

    pub struct InstanceGuard {
        lock_file: std::fs::File,
        sock_path: PathBuf,
        ctl_path: PathBuf,
        stop: Arc<AtomicBool>,
    }

    impl InstanceGuard {
        pub fn stop_flag(&self) -> Arc<AtomicBool> {
            self.stop.clone()
        }
    }

    impl Drop for InstanceGuard {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            let _ = std::fs::remove_file(&self.sock_path);
            let _ = std::fs::remove_file(&self.ctl_path);
            let _ = self.lock_file.unlock();
        }
    }

    fn lock_path(data: &Path, id: &str, pending: bool) -> PathBuf {
        data.join("plugins").join(id).join(if pending {
            "engine-run.pending.lock"
        } else {
            "engine-run.lock"
        })
    }

    fn ctl_path(data: &Path, id: &str, pending: bool) -> PathBuf {
        data.join("plugins").join(id).join(if pending {
            "engine-run.pending.ctl"
        } else {
            "engine-run.ctl"
        })
    }

    fn choose_sock_path(data: &Path, id: &str, svc: &str, pending: bool) -> Result<PathBuf, ()> {
        let direct = data.join("plugins").join(id).join(if pending {
            "engine-run.pending.sock"
        } else {
            "engine-run.sock"
        });
        // macOS `sun_path` limit is 104 bytes (including NUL); fall back to a short owner-only
        // socket directory keyed by SHA-256 of the lock path when the data dir (or TMPDIR) is long.
        if direct.as_os_str().len() < 96 {
            return Ok(direct);
        }
        let digest = Sha256::digest(direct.as_os_str().as_encoded_bytes());
        let short: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        let uid = unsafe { libc::geteuid() };
        let tag = if pending { "p" } else { "n" };
        let file = format!("{tag}-{short}.sock");
        let _ = svc;
        let mut candidates = Vec::new();
        if let Some(rt) = std::env::var_os("XDG_RUNTIME_DIR").filter(|v| !v.is_empty()) {
            candidates.push(PathBuf::from(rt).join(format!("le-{uid}")).join(&file));
        }
        candidates.push(std::env::temp_dir().join(format!("le-{uid}")).join(&file));
        candidates.push(PathBuf::from("/tmp").join(format!("le-{uid}")).join(&file));

        for candidate in candidates {
            if candidate.as_os_str().len() >= 96 {
                continue;
            }
            if let Some(parent) = candidate.parent()
                && ensure_dir_owner_only(parent).is_ok()
            {
                return Ok(candidate);
            }
        }
        Err(())
    }

    pub fn acquire_instance(
        data: &Path,
        id: &str,
        svc: &str,
        pending: bool,
    ) -> Result<InstanceGuard, ()> {
        let plugin_dir = data.join("plugins").join(id);
        ensure_dir_owner_only(&plugin_dir).map_err(|_| ())?;
        let lpath = lock_path(data, id, pending);
        let file = open_lock_owner_only(&lpath).map_err(|_| ())?;
        if file.try_lock().is_err() {
            return Err(());
        }
        let sock_path = choose_sock_path(data, id, svc, pending)?;
        let _ = std::fs::remove_file(&sock_path);
        let listener = UnixListener::bind(&sock_path).map_err(|_| ())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600));
        }
        let _ = listener.set_nonblocking(true);
        let cpath = ctl_path(data, id, pending);
        let _ = connection::write_owner_only(&cpath, sock_path.to_string_lossy().as_bytes());

        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        std::thread::spawn(move || {
            while !stop_clone.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buf = [0u8; 16];
                        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
                        if let Ok(n) = stream.read(&mut buf)
                            && buf[..n].starts_with(b"stop")
                        {
                            stop_clone.store(true, Ordering::SeqCst);
                            let _ = stream.write_all(b"ok");
                            break;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(40));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(InstanceGuard {
            lock_file: file,
            sock_path,
            ctl_path: cpath,
            stop,
        })
    }

    pub fn signal_stop(
        data: &Path,
        id: &str,
        _svc: &str,
        pending: bool,
    ) -> Result<(), &'static str> {
        let cpath = ctl_path(data, id, pending);
        if let Ok(bytes) = crate::mounts::read_owner_only(&cpath, 4096)
            && let Ok(text) = std::str::from_utf8(&bytes)
        {
            let sock = PathBuf::from(text.trim());
            if let Ok(mut stream) = UnixStream::connect(&sock) {
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let _ = stream.write_all(b"stop");
                let _ = stream.flush();
            }
        }
        let lpath = lock_path(data, id, pending);
        if !lpath.exists() {
            return Ok(());
        }
        let deadline = Instant::now() + STOP_WAIT_TIMEOUT;
        while Instant::now() < deadline {
            if let Ok(file) = open_lock_owner_only(&lpath)
                && file.try_lock().is_ok()
            {
                let _ = file.unlock();
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("supervisor did not stop within timeout")
    }
}

#[cfg(windows)]
pub(crate) use platform::JobGuard;

#[cfg(windows)]
pub(crate) fn attach_child_job(child: &Child) -> Option<JobGuard> {
    platform::attach_job_object(child)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows_sys::Win32::System::Threading::{
        CreateEventW, CreateMutexW, EVENT_MODIFY_STATE, OpenEventW, ResetEvent, SetEvent,
        WaitForSingleObject,
    };

    fn wide_nul(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn mutex_name(svc: &str, pending: bool) -> String {
        if pending {
            format!("Local\\LoamPluginRunPending-{svc}")
        } else {
            format!("Local\\LoamPluginRun-{svc}")
        }
    }

    fn event_name(svc: &str, pending: bool) -> String {
        if pending {
            format!("Local\\LoamPluginStopPending-{svc}")
        } else {
            format!("Local\\LoamPluginStop-{svc}")
        }
    }

    pub struct JobGuard(HANDLE);

    impl Drop for JobGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: `self.0` is a valid Job Object handle; closing it terminates the job tree.
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    pub fn attach_job_object(child: &Child) -> Option<JobGuard> {
        // SAFETY: `CreateJobObjectW` creates an anonymous job object owned by `JobGuard`.
        let job = unsafe { CreateJobObjectW(null_mut(), null_mut()) };
        if job.is_null() {
            return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` matches `JobObjectExtendedLimitInformation` size.
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            unsafe { CloseHandle(job) };
            return None;
        }
        let proc_handle = child.as_raw_handle() as HANDLE;
        // SAFETY: `job` and `proc_handle` are valid handles.
        let assigned = unsafe { AssignProcessToJobObject(job, proc_handle) };
        if assigned == 0 {
            unsafe { CloseHandle(job) };
            return None;
        }
        Some(JobGuard(job))
    }

    struct SendHandle(HANDLE);
    // SAFETY: Win32 event handles are thread-safe kernel objects.
    unsafe impl Send for SendHandle {}

    pub struct InstanceGuard {
        mutex: HANDLE,
        event: HANDLE,
        stop: Arc<AtomicBool>,
    }

    impl InstanceGuard {
        pub fn stop_flag(&self) -> Arc<AtomicBool> {
            self.stop.clone()
        }
    }

    impl Drop for InstanceGuard {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if !self.event.is_null() {
                unsafe {
                    SetEvent(self.event);
                    CloseHandle(self.event);
                }
            }
            if !self.mutex.is_null() {
                unsafe { CloseHandle(self.mutex) };
            }
        }
    }

    pub fn acquire_instance(
        _data: &Path,
        _id: &str,
        svc: &str,
        pending: bool,
    ) -> Result<InstanceGuard, ()> {
        let mname = wide_nul(&mutex_name(svc, pending));
        // SAFETY: `mname` is NUL-terminated UTF-16.
        let mutex = unsafe { CreateMutexW(null_mut(), 1, mname.as_ptr()) };
        if mutex.is_null() {
            return Err(());
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { CloseHandle(mutex) };
            return Err(());
        }
        let ename = wide_nul(&event_name(svc, pending));
        // SAFETY: `ename` is NUL-terminated UTF-16; manual-reset event starts non-signaled.
        let event = unsafe { CreateEventW(null_mut(), 1, 0, ename.as_ptr()) };
        if event.is_null() {
            unsafe { CloseHandle(mutex) };
            return Err(());
        }
        unsafe { ResetEvent(event) };

        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        // Open a second handle for the waiter thread so `InstanceGuard::drop` can safely close its own.
        let wait_event = unsafe { CreateEventW(null_mut(), 1, 0, ename.as_ptr()) };
        if !wait_event.is_null() {
            let send_ev = SendHandle(wait_event);
            std::thread::spawn(move || {
                let ev = send_ev;
                loop {
                    if stop_clone.load(Ordering::SeqCst) {
                        break;
                    }
                    let res = unsafe { WaitForSingleObject(ev.0, 100) };
                    if res == WAIT_OBJECT_0 {
                        stop_clone.store(true, Ordering::SeqCst);
                        break;
                    }
                }
                unsafe { CloseHandle(ev.0) };
            });
        }
        Ok(InstanceGuard { mutex, event, stop })
    }

    pub fn signal_stop(
        _data: &Path,
        _id: &str,
        svc: &str,
        pending: bool,
    ) -> Result<(), &'static str> {
        let ename = wide_nul(&event_name(svc, pending));
        // SAFETY: `ename` is NUL-terminated UTF-16.
        let ev = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, ename.as_ptr()) };
        if !ev.is_null() {
            unsafe {
                SetEvent(ev);
                CloseHandle(ev);
            }
        }
        // Wait briefly for the mutex to become free.
        let mname = wide_nul(&mutex_name(svc, pending));
        let deadline = Instant::now() + STOP_WAIT_TIMEOUT;
        while Instant::now() < deadline {
            let m = unsafe { CreateMutexW(null_mut(), 0, mname.as_ptr()) };
            if !m.is_null() {
                let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
                unsafe { CloseHandle(m) };
                if !existed {
                    return Ok(());
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("supervisor did not stop within timeout")
    }
}
