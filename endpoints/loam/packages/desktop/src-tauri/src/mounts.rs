//! The desktop's mount transport (phase 6 specification, 10.3 and 10.4): a transport only, with no MCP logic
//! of its own but the MCP 2026-07-28 headers an `http` request needs, which `era` derives from the message
//! itself (phase 5 specification, 7.2). The webview names an instance; the address, the bearer and the command
//! line stay here, read from `mounts.json`, and never cross IPC, not even in an error, which is a bare code.
#[path = "mounts_proof.rs"]
mod proof;

#[cfg(test)]
use proof::verify_proof_header;
use proof::{
    LoopbackTarget, PROOF_TIMEOUT, VerifiedConn, close_verified_http, connect_and_verify,
    loopback_target, send_verified_http,
};
#[allow(unused_imports)]
pub(crate) use proof::{
    VerifiedProbeError, compute_proof, probe_unauthenticated_mcp_bounded, probe_verified_mcp,
    verify_proof,
};

use crate::desktop_state::hex64;
use crate::models::{KeychainRef, key_shaped, keychain_name};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
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
pub const KEYCHAIN_MISSING: &str = "MOUNT_KEYCHAIN_MISSING";

type Reply = Result<Value, &'static str>;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Reply>>>>;
/// Where a server's notification goes: `notify::script` and the main webview.
pub type Notify = Arc<dyn Fn(u64, Value) + Send + Sync>;
type KeychainReader = Arc<dyn Fn(&str, &str) -> Option<String> + Send + Sync>;

/// One entry of `mounts.json`, as `loam deployment write --host desktop --mounts-out` or the
/// managed desktop materializer writes it.
#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum Access {
    Http(HttpAccess),
    Stdio(StdioAccess),
}

/// Phase 1's `{ instance, url, bearer? }`, extended for managed plugin engines with
/// `bearer_keychain` and `proof_key` (phase 5 no-terminal amendment, 5.2 and 5.3).
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpAccess {
    instance: String,
    url: String,
    bearer: Option<String>,
    bearer_keychain: Option<KeychainRef>,
    proof_key: Option<String>,
}

/// The desktop's `{ instance, transport: 'stdio', command, cwd? }` (10.4).
#[derive(Clone, Deserialize)]
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
    /// The deployer's `[host] inbound` (10.8, D137), which `deployment write --host desktop` always writes. Absent,
    /// the endpoint is off: it is served only from a file that says so.
    #[serde(default)]
    inbound: bool,
}

/// What `mounts.json` says: the instances, and whether the inbound endpoint is on (10.8).
pub struct Deployed {
    pub mounts: Vec<Access>,
    pub inbound: bool,
}

/// `mounts.json`, or a code: none at `path` mounts nothing; one others can read is refused (10.3).
pub fn read(path: &Path) -> Result<Vec<Access>, &'static str> {
    read_deployed(path).map(|deployed| deployed.mounts)
}

/// `mounts.json` whole: none at `path` mounts nothing and serves nothing inbound, and one refused serves nothing
/// either, so the endpoint fails closed (10.8).
pub fn read_deployed(path: &Path) -> Result<Deployed, &'static str> {
    let bytes = match read_owner_only(path, REQUEST_MAX) {
        Ok(bytes) => bytes,
        Err(Unread::Missing) => {
            return Ok(Deployed {
                mounts: Vec::new(),
                inbound: false,
            });
        }
        Err(Unread::Denied) => return Err(PERMISSIONS),
        Err(Unread::TooLarge) => return Err(MOUNTS_INVALID),
    };
    let file: File = serde_json::from_slice(&bytes).map_err(|_| MOUNTS_INVALID)?;
    let mut seen = std::collections::HashSet::new();
    for entry in &file.mounts {
        if !seen.insert(entry.instance()) {
            return Err(MOUNTS_INVALID);
        }
        match entry {
            Access::Http(HttpAccess {
                url,
                bearer,
                bearer_keychain,
                proof_key,
                ..
            }) => {
                if !(url.starts_with("http://") || url.starts_with("https://")) {
                    return Err(MOUNTS_INVALID);
                }
                if bearer.is_some() && bearer_keychain.is_some() {
                    return Err(MOUNTS_INVALID);
                }
                if bearer_keychain.is_some() && proof_key.is_none() {
                    return Err(MOUNTS_INVALID);
                }
                if let Some(kc) = bearer_keychain
                    && (!keychain_name(&kc.keychain) || !keychain_name(&kc.account))
                {
                    return Err(MOUNTS_INVALID);
                }
                if let Some(proof) = proof_key
                    && (!hex64(proof) || loopback_target(url).is_none())
                {
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
    Ok(Deployed {
        mounts: file.mounts,
        inbound: file.inbound,
    })
}

/// Why [`read_owner_only`] read nothing.
#[derive(Debug, PartialEq, Eq)]
pub enum Unread {
    /// Nothing is at the path.
    Missing,
    /// Something is, but not a file only its owner can read, or it cannot be read.
    Denied,
    /// Over the bound.
    TooLarge,
}

/// A file only its owner can read, read from the handle its check was made on, so no other file can be put in its
/// place between the check and the read (phase 5's step 2, from its trust review). On POSIX the open refuses a
/// symbolic link and the check is the handle's own metadata; on Windows the handle refuses to share writing and
/// deleting while it is held, and the security descriptor is read directly from that open handle via
/// `GetSecurityInfo` (never spawning PowerShell on launch).
pub fn read_owner_only(path: &Path, max: usize) -> Result<Vec<u8>, Unread> {
    use std::io::Read;
    #[cfg(windows)]
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(Unread::Missing),
        _ => return Err(Unread::Denied),
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A link is refused at the open; a FIFO opens at once, and its metadata then refuses it, rather than block.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x1;
        options.share_mode(FILE_SHARE_READ);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(Unread::Missing),
        Err(_) => return Err(Unread::Denied),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let metadata = file.metadata().map_err(|_| Unread::Denied)?;
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        let user = unsafe { libc::geteuid() };
        if !metadata.is_file()
            || metadata.uid() != user
            || metadata.permissions().mode() & 0o777 != 0o600
        {
            return Err(Unread::Denied);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        let metadata = file.metadata().map_err(|_| Unread::Denied)?;
        // Re-check `symlink_metadata` while the handle holds no write/delete share, then check the handle's own ACL.
        let still_file = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file());
        if !metadata.is_file() || !still_file || !handle_owner_only(file.as_raw_handle()) {
            return Err(Unread::Denied);
        }
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Unread::Denied)?;
    if bytes.len() > max {
        return Err(Unread::TooLarge);
    }
    Ok(bytes)
}

/// `mounts.json` only its owner can read (10.3), or `DESKTOP_MOUNTS_PERMISSIONS`.
pub fn permissions(path: &Path) -> Result<(), &'static str> {
    if owner_only(path) {
        Ok(())
    } else {
        Err(PERMISSIONS)
    }
}

/// Whether an open file is one only its owner can read, by its own handle: on POSIX owned by this user with mode
/// exactly 0600, on Windows by its security descriptor. `inbound.json` is checked this way before its token is written
/// (phase 6 specification, 10.8).
pub fn file_owner_only(file: &std::fs::File) -> bool {
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        let user = unsafe { libc::geteuid() };
        metadata.uid() == user && metadata.permissions().mode() & 0o777 == 0o600
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        handle_owner_only(file.as_raw_handle())
    }
}

/// Whether `path` is a file only its owner can read: on POSIX owned by this user, mode exactly 0600. The rule
/// `mounts.json`, `models.json` and a model's key file share (phase 5 specification, 4.2).
#[cfg(unix)]
pub fn owner_only(path: &Path) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    // SAFETY: `geteuid` has no preconditions and cannot fail.
    let user = unsafe { libc::geteuid() };
    metadata.is_file() && metadata.uid() == user && metadata.permissions().mode() & 0o777 == 0o600
}

/// Windows: owned by this user, and every allowing entry of its DACL is this user's. Read directly from the
/// open file handle with `GetSecurityInfo`, failing closed on a NULL DACL, an unreadable descriptor, or any
/// non-standard ACE type that could grant access to another principal.
#[cfg(windows)]
pub fn owner_only(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    const FILE_SHARE_READ: u32 = 0x1;
    if !std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return false;
    }
    let Ok(file) = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
    else {
        return false;
    };
    file.metadata().is_ok_and(|metadata| metadata.is_file())
        && std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
        && handle_owner_only(file.as_raw_handle())
}

#[cfg(windows)]
pub(crate) fn handle_owner_only(handle: std::os::windows::io::RawHandle) -> bool {
    use std::ffi::c_void;
    use std::mem::{offset_of, size_of};
    use std::ptr::{addr_of, addr_of_mut, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, LocalFree};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, AclSizeInformation,
        DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetAclInformation, GetLengthSid,
        GetTokenInformation, IsValidAcl, IsValidSid, OWNER_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{FILE_TYPE_DISK, GetFileType};
    use windows_sys::Win32::System::SystemServices::{
        ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // Only a real disk file (never a pipe, console or character device).
    // SAFETY: `handle` is a live file handle owned by the caller.
    if unsafe { GetFileType(handle as HANDLE) } != FILE_TYPE_DISK {
        return false;
    }

    struct HandleGuard(HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: `self.0` was opened by `OpenProcessToken` and is closed once here.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    struct LocalAllocGuard(PSECURITY_DESCRIPTOR);
    impl Drop for LocalAllocGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: `self.0` was allocated by `GetSecurityInfo` and must be freed with `LocalFree`.
                unsafe {
                    LocalFree(self.0);
                }
            }
        }
    }

    let mut token: HANDLE = null_mut();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle valid for the calling process; `token` is written on success.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return false;
    }
    let _token_guard = HandleGuard(token);

    let mut needed: u32 = 0;
    // SAFETY: passing a null buffer with size 0 queries the required byte length in `needed`.
    unsafe {
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut needed);
    }
    if (needed as usize) < size_of::<TOKEN_USER>() {
        return false;
    }
    // `Vec<u64>` guarantees pointer alignment for `TOKEN_USER`.
    let words = (needed as usize).div_ceil(size_of::<u64>());
    let Some(buf_bytes) = words
        .checked_mul(size_of::<u64>())
        .and_then(|bytes| u32::try_from(bytes).ok())
    else {
        return false;
    };
    let mut token_buf = vec![0u64; words];
    // SAFETY: `token_buf` is valid, writable and properly aligned for `TOKEN_USER` with size `buf_bytes`.
    if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            token_buf.as_mut_ptr().cast::<c_void>(),
            buf_bytes,
            &mut needed,
        )
    } == 0
    {
        return false;
    }
    // SAFETY: `GetTokenInformation(TokenUser)` populated a `TOKEN_USER` at the start of `token_buf`, whose SID
    // points inside `token_buf` and lives as long as `token_buf`.
    let user_sid: PSID = unsafe { (*(token_buf.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    // SAFETY: `IsValidSid` checks whether the SID pointer has a valid header.
    if user_sid.is_null() || unsafe { IsValidSid(user_sid) } == 0 {
        return false;
    }

    let mut owner_sid: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut sd: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `handle` is an open file handle; `GetSecurityInfo` writes `owner_sid`, `dacl` (pointers into `sd`)
    // and `sd`, which `_sd_guard` frees with `LocalFree` on success.
    let status = unsafe {
        GetSecurityInfo(
            handle as HANDLE,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner_sid,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut sd,
        )
    };
    if status != ERROR_SUCCESS || sd.is_null() {
        return false;
    }
    let _sd_guard = LocalAllocGuard(sd);
    // A missing owner or a NULL DACL (which grants Everyone full access on Windows) fails closed.
    if owner_sid.is_null() || dacl.is_null() || unsafe { IsValidAcl(dacl.cast_const()) } == 0 {
        return false;
    }
    // SAFETY: `owner_sid` and `user_sid` are non-null pointers into live buffers (`sd` and `token_buf`).
    if unsafe { IsValidSid(owner_sid) == 0 || EqualSid(owner_sid, user_sid) == 0 } {
        return false;
    }

    let mut acl_info = ACL_SIZE_INFORMATION {
        AceCount: 0,
        AclBytesInUse: 0,
        AclBytesFree: 0,
    };
    // SAFETY: `dacl` is a valid ACL inside `sd`; `acl_info` has the exact size for `AclSizeInformation`.
    if unsafe {
        GetAclInformation(
            dacl.cast_const(),
            addr_of_mut!(acl_info).cast::<c_void>(),
            size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    } == 0
    {
        return false;
    }

    let sid_offset = offset_of!(ACCESS_ALLOWED_ACE, SidStart);
    for index in 0..acl_info.AceCount {
        let mut ace_ptr: *mut c_void = null_mut();
        // SAFETY: `index < acl_info.AceCount` for the live `dacl`.
        if unsafe { GetAce(dacl.cast_const(), index, &mut ace_ptr) } == 0 || ace_ptr.is_null() {
            return false;
        }
        // SAFETY: every ACE in a valid Windows ACL begins with an `ACE_HEADER`.
        let header = unsafe { &*(ace_ptr.cast::<ACE_HEADER>()) };
        match u32::from(header.AceType) {
            ACCESS_ALLOWED_ACE_TYPE => {
                // A valid Windows SID header is 8 bytes (Revision + SubAuthorityCount + 6-byte IdentifierAuthority).
                let ace_size = usize::from(header.AceSize);
                if ace_size < sid_offset + 8 {
                    return false;
                }
                // SAFETY: an `ACCESS_ALLOWED_ACE_TYPE` entry is an `ACCESS_ALLOWED_ACE` whose `SidStart` field
                // is the first DWORD of the trustee's SID.
                let ace = ace_ptr.cast::<ACCESS_ALLOWED_ACE>();
                let sid = unsafe { addr_of!((*ace).SidStart).cast_mut().cast::<c_void>() };
                if unsafe { IsValidSid(sid) } == 0 {
                    return false;
                }
                // SAFETY: `sid` passed `IsValidSid`, so `GetLengthSid` reads its validated length.
                let sid_len = unsafe { GetLengthSid(sid) } as usize;
                if ace_size < sid_offset + sid_len || unsafe { EqualSid(sid, user_sid) } == 0 {
                    return false;
                }
            }
            ACCESS_DENIED_ACE_TYPE => {
                // Deny ACEs restrict access and never grant it to another principal.
            }
            // Any other ACE type (object, callback, compound, or unknown) could grant access: fail closed.
            _ => return false,
        }
    }
    true
}

enum HttpTransport {
    /// Plain HTTP/HTTPS mount without `proof_key` (CLI `deployment write` path).
    Plain {
        client: reqwest::Client,
        url: String,
    },
    /// Loopback HTTP/1.1 mount whose bearer-bearing requests are bound to a `proof_key`-verified
    /// TCP connection; any new TCP connection must pass a fresh `/health` proof first (5.2).
    Verified {
        target: LoopbackTarget,
        proof_key: String,
        proof_timeout: Duration,
        conn: Mutex<Option<VerifiedConn>>,
    },
}

// Each lives in an Arc, one per open handle, so the size of the larger variant costs nothing worth boxing.
#[allow(clippy::large_enum_variant)]
enum Connection {
    Http {
        transport: HttpTransport,
        bearer: StdRwLock<Option<String>>,
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

enum Slot {
    Opening,
    Open(Arc<Connection>),
}

struct Open {
    instance: String,
    slot: Slot,
}

#[derive(Default)]
struct OpenState {
    handles: HashMap<u64, Open>,
    /// Monotonic per-instance credential generation incremented on every [`Mounts::refresh_bearer`];
    /// an in-flight `Slot::Opening` started before a rotation is rejected on commit so no revoked
    /// bearer can ever be published.
    bearer_generations: HashMap<String, u64>,
}

/// Releases an in-flight `Slot::Opening` reservation if `open` returns an error or is cancelled.
struct OpeningGuard<'a> {
    open: &'a StdMutex<OpenState>,
    handle: u64,
    armed: bool,
}

impl Drop for OpeningGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            let mut open = self.open.lock().expect("mounts open");
            if matches!(
                open.handles.get(&self.handle).map(|held| &held.slot),
                Some(Slot::Opening)
            ) {
                open.handles.remove(&self.handle);
            }
        }
    }
}

/// Every instance `mounts.json` lists, and the connections the webview holds open.
///
/// Kept as a process singleton whose configured entries live behind an `RwLock` so managed-mode
/// reloads and plugin mutations can update configuration in place without dropping open mount
/// handles or live `stdio` children (phase 5 no-terminal amendment, 9.2).
///
/// Lock order: whenever both locks are needed (`Mounts::open`), `entries` is ALWAYS acquired before
/// `open`, and both are dropped before any `.await`.
pub struct Mounts {
    entries: StdRwLock<Result<Vec<Access>, &'static str>>,
    next: AtomicU64,
    open: StdMutex<OpenState>,
    keychain_reader: KeychainReader,
    proof_timeout: Duration,
}

impl Mounts {
    pub fn new(entries: Result<Vec<Access>, &'static str>) -> Self {
        Self::with_keychain_reader(entries, Arc::new(crate::keychain::read))
    }

    pub fn with_keychain_reader(
        entries: Result<Vec<Access>, &'static str>,
        keychain_reader: KeychainReader,
    ) -> Self {
        Self {
            entries: StdRwLock::new(entries),
            next: AtomicU64::new(1),
            open: StdMutex::new(OpenState::default()),
            keychain_reader,
            proof_timeout: PROOF_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_test_config(
        entries: Result<Vec<Access>, &'static str>,
        keychain_reader: KeychainReader,
        proof_timeout: Duration,
    ) -> Self {
        Self {
            entries: StdRwLock::new(entries),
            next: AtomicU64::new(1),
            open: StdMutex::new(OpenState::default()),
            keychain_reader,
            proof_timeout,
        }
    }

    /// Replaces the mount entries in place without disturbing already-open handles (amendment 9.2).
    /// Subsequent [`Mounts::open`] calls observe the new configuration.
    pub fn update_entries(&self, entries: Result<Vec<Access>, &'static str>) {
        *self
            .entries
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = entries;
    }

    /// Updates the bearer token on every currently open `Http` handle for `instance` in place
    /// without dropping the handle, and invalidates any in-flight `Slot::Opening` for `instance`
    /// so no concurrent `open` can publish a revoked credential (amendment 7.4).
    pub fn refresh_bearer(&self, instance: &str, new_bearer: Option<String>) {
        let connections: Vec<Arc<Connection>> = {
            let mut open = self.open.lock().expect("mounts open");
            let generation = open
                .bearer_generations
                .entry(instance.to_owned())
                .or_insert(0);
            *generation = generation.wrapping_add(1);
            open.handles
                .values()
                .filter(|held| held.instance == instance)
                .filter_map(|held| match &held.slot {
                    Slot::Open(connection) => Some(connection.clone()),
                    Slot::Opening => None,
                })
                .collect()
        };
        for connection in connections {
            if let Connection::Http { bearer, .. } = connection.as_ref() {
                *bearer
                    .write()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = new_bearer.clone();
            }
        }
    }

    /// Closes every open handle (and cancels any in-flight `Slot::Opening`) for `instance`, leaving
    /// other instances' handles untouched (amendment 7.3 & 7.4).
    pub async fn close_instance(&self, instance: &str) {
        let matching: Vec<Arc<Connection>> = {
            let mut open = self.open.lock().expect("mounts open");
            let handles: Vec<u64> = open
                .handles
                .iter()
                .filter(|(_, held)| held.instance == instance)
                .map(|(handle, _)| *handle)
                .collect();
            handles
                .into_iter()
                .filter_map(|handle| match open.handles.remove(&handle)?.slot {
                    Slot::Open(connection) => Some(connection),
                    Slot::Opening => None,
                })
                .collect()
        };
        futures_util::future::join_all(matching.iter().map(|connection| close(connection))).await;
    }

    /// `mount_open`: a handle for `instance`, or a code.
    pub async fn open(&self, instance: &str, notify: Notify) -> Result<u64, &'static str> {
        // Acquire `entries` then `open` together so a concurrent `update_entries` + `close_instance`
        // cannot remove `instance` in the gap between lookup and slot reservation. Both locks are
        // released before any async proof check or blocking keychain read.
        let (entry, handle, reserved_gen) = {
            let guard = self
                .entries
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let entries = guard.as_ref().map_err(|code| *code)?;
            let entry = entries
                .iter()
                .find(|entry| entry.instance() == instance)
                .ok_or(INSTANCE_UNKNOWN)?
                .clone();
            let mut open = self.open.lock().expect("mounts open");
            if open
                .handles
                .values()
                .filter(|held| held.instance == instance)
                .count()
                >= HANDLES_PER_INSTANCE
            {
                return Err(LIMIT);
            }
            // Handles stay well inside JavaScript's safe integers.
            let handle = self.next.fetch_add(1, Ordering::Relaxed);
            let reserved_gen = open.bearer_generations.get(instance).copied().unwrap_or(0);
            open.handles.insert(
                handle,
                Open {
                    instance: instance.to_owned(),
                    slot: Slot::Opening,
                },
            );
            (entry, handle, reserved_gen)
        };
        let mut guard = OpeningGuard {
            open: &self.open,
            handle,
            armed: true,
        };
        let connection = match &entry {
            Access::Http(HttpAccess {
                url,
                bearer,
                bearer_keychain,
                proof_key,
                ..
            }) => {
                // Defensive checks in case `Mounts::new` was constructed without `read_deployed`.
                if (bearer.is_some() && bearer_keychain.is_some())
                    || (bearer_keychain.is_some() && proof_key.is_none())
                {
                    return Err(MOUNTS_INVALID);
                }
                // Pre-bearer server identity verification runs BEFORE resolving or transmitting
                // any bearer token, and binds subsequent authenticated requests to the verified
                // TCP connection (amendment 5.2).
                let transport = match proof_key {
                    Some(proof) => {
                        let target = loopback_target(url).ok_or(UNREACHABLE)?;
                        let verified =
                            connect_and_verify(&target, proof, self.proof_timeout).await?;
                        HttpTransport::Verified {
                            target,
                            proof_key: proof.clone(),
                            proof_timeout: self.proof_timeout,
                            conn: Mutex::new(Some(verified)),
                        }
                    }
                    None => HttpTransport::Plain {
                        client: reqwest::Client::builder()
                            .redirect(reqwest::redirect::Policy::none())
                            .no_proxy()
                            .timeout(ANSWER_TIMEOUT)
                            .build()
                            .map_err(|_| UNREACHABLE)?,
                        url: url.clone(),
                    },
                };
                let resolved_bearer = match bearer_keychain {
                    Some(KeychainRef { keychain, account }) => {
                        if !keychain_name(keychain) || !keychain_name(account) {
                            return Err(KEYCHAIN_MISSING);
                        }
                        let reader = self.keychain_reader.clone();
                        let service = keychain.clone();
                        let account = account.clone();
                        let found = tokio::task::spawn_blocking(move || reader(&service, &account))
                            .await
                            .map_err(|_| KEYCHAIN_MISSING)?
                            .ok_or(KEYCHAIN_MISSING)?;
                        if !key_shaped(&found) {
                            return Err(KEYCHAIN_MISSING);
                        }
                        Some(found)
                    }
                    None => bearer.clone(),
                };
                Connection::Http {
                    transport,
                    bearer: StdRwLock::new(resolved_bearer),
                    session: Mutex::new(None),
                }
            }
            Access::Stdio(StdioAccess { command, cwd, .. }) => {
                spawn(handle, command, cwd.as_deref(), notify)?
            }
        };
        let connection = Arc::new(connection);
        let committed = {
            let mut open = self.open.lock().expect("mounts open");
            let current_gen = open.bearer_generations.get(instance).copied().unwrap_or(0);
            if current_gen != reserved_gen {
                open.handles.remove(&handle);
                false
            } else if let Some(held) = open.handles.get_mut(&handle)
                && matches!(held.slot, Slot::Opening)
            {
                held.slot = Slot::Open(connection.clone());
                true
            } else {
                false
            }
        };
        guard.armed = false;
        if !committed {
            // `close_all`, `close_instance`, or `refresh_bearer` invalidated this opening slot.
            let _ = close(&connection).await;
            return Err(UNREACHABLE);
        }
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
            let open = self.open.lock().expect("mounts open");
            match open.handles.get(&handle).map(|held| &held.slot) {
                Some(Slot::Open(connection)) => connection.clone(),
                _ => return Err(UNREACHABLE),
            }
        };
        match connection.as_ref() {
            Connection::Stdio {
                child,
                stdin,
                pending,
                closed,
            } => send_stdio(child, stdin, pending, closed, &message, &encoded).await,
            Connection::Http {
                transport,
                bearer,
                session,
            } => {
                let current_bearer = bearer
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone();
                match transport {
                    HttpTransport::Plain { client, url } => {
                        send_http(
                            handle,
                            client,
                            url,
                            current_bearer.as_deref(),
                            session,
                            &message,
                            encoded,
                            notify,
                        )
                        .await
                    }
                    HttpTransport::Verified {
                        target,
                        proof_key,
                        proof_timeout,
                        conn,
                    } => {
                        send_verified_http(
                            handle,
                            target,
                            proof_key,
                            *proof_timeout,
                            conn,
                            current_bearer.as_deref(),
                            session,
                            &message,
                            encoded,
                            notify,
                        )
                        .await
                    }
                }
            }
        }
    }

    /// `mount_close`: for `http` the session's `DELETE`, for `stdio` `SIGTERM` then `SIGKILL`.
    pub async fn close(&self, handle: u64) -> Result<(), &'static str> {
        let Some(held) = self
            .open
            .lock()
            .expect("mounts open")
            .handles
            .remove(&handle)
        else {
            return Ok(());
        };
        match held.slot {
            Slot::Open(connection) => close(&connection).await,
            Slot::Opening => Ok(()),
        }
    }

    /// Every connection, when the app exits: no child outlives it.
    pub async fn close_all(&self) {
        let all: Vec<_> = self
            .open
            .lock()
            .expect("mounts open")
            .handles
            .drain()
            .filter_map(|(_, held)| match held.slot {
                Slot::Open(connection) => Some(connection),
                Slot::Opening => None,
            })
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
    // MCP 2026-07-28's headers, from the message itself (`era`), for a request the page opened on that era; it is
    // stateless, so it carries no session (phase 5 specification, 7.2; #2137).
    let modern = crate::era::headers(message)?;
    let mut request = client
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .body(encoded);
    if let Some(bearer) = bearer {
        request = request.bearer_auth(bearer);
    }
    let held = if modern.is_some() {
        None
    } else {
        session.lock().await.clone()
    };
    if let Some(id) = &held {
        request = request.header("Mcp-Session-Id", id);
    }
    for (name, value) in modern.into_iter().flatten() {
        request = request.header(name, value);
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
            transport,
            bearer,
            session,
        } => {
            if let Some(id) = session.lock().await.take() {
                let current_bearer = bearer
                    .read()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone();
                match transport {
                    HttpTransport::Plain { client, url } => {
                        let mut request = client.delete(url).header("Mcp-Session-Id", id);
                        if let Some(bearer) = current_bearer.as_deref() {
                            request = request.bearer_auth(bearer);
                        }
                        let _ = request.send().await;
                    }
                    HttpTransport::Verified {
                        target,
                        proof_timeout,
                        conn,
                        ..
                    } => {
                        close_verified_http(
                            target,
                            *proof_timeout,
                            conn,
                            current_bearer.as_deref(),
                            &id,
                        )
                        .await;
                    }
                }
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
                // The group's id, kept: once `wait` reaps the leader, `child.id()` is gone, and a member that
                // ignored `SIGTERM` must still get `SIGKILL`. POSIX reuses no id while its group exists.
                let group = child.id().and_then(|id| i32::try_from(id).ok());
                signal_group(group, libc::SIGTERM);
                let exited = tokio::time::timeout(TERMINATE_GRACE, child.wait())
                    .await
                    .is_ok();
                signal_group(group, libc::SIGKILL);
                if exited {
                    return Ok(());
                }
            }
            child.kill().await.map_err(|_| UNREACHABLE)?;
            Ok(())
        }
    }
}

/// A signal to the child's process group, which `spawn` made its own.
#[cfg(unix)]
fn signal_group(group: Option<i32>, signal: libc::c_int) {
    if let Some(id) = group {
        // SAFETY: a signal to the group this process created for its own child; an empty group is an error
        // `killpg` reports and nothing else.
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
#[path = "mounts_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mounts_proof_tests.rs"]
mod proof_tests;
