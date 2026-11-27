//! `inbound.json` (phase 6 specification, 10.8): where the running desktop's inbound endpoint listens, its token for
//! this run and the host's process id, in a file only the profile's owner can read. The Rust host writes it at start
//! and deletes it at exit; the stdio bridge and `--print-connection` read it. The token is section 13's second
//! exception (D108, D140): written here and printed by `--print-connection`, nowhere else.
use crate::mounts::{Unread, file_owner_only, owner_only, read_owner_only};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The file's name in the data directory.
pub const FILE: &str = "inbound.json";
/// The file could not be made, or read, as one only its owner can read: nothing is served, or the bridge refuses it.
pub const PERMISSIONS: &str = "DESKTOP_INBOUND_PERMISSIONS";
/// No running desktop to reach: the bridge's answer, with [`UNAVAILABLE_SUGGESTION`].
pub const UNAVAILABLE: &str = "DESKTOP_INBOUND_UNAVAILABLE";
pub const UNAVAILABLE_SUGGESTION: &str = "Open Loam, then retry";
/// The app's identifier (`tauri.conf.json`), whose folder under the platform's data directory is Tauri's
/// `app_data_dir`.
pub const IDENTIFIER: &str = "dev.lushly.loam";
/// The bound on the file's size when it is read.
const FILE_MAX: usize = 4096;

/// What the file holds.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(deny_unknown_fields)]
pub struct Connection {
    /// `http://127.0.0.1:<port>/mcp`: `127.0.0.1`, since Windows resolves `localhost` to `::1` first.
    pub url: String,
    pub port: u16,
    /// 32 random bytes, base64url, made at this start.
    pub token: String,
    /// The host's process id.
    pub pid: u32,
}

impl Connection {
    pub fn new(port: u16, token: String) -> Self {
        Self {
            url: format!("http://127.0.0.1:{port}/mcp"),
            port,
            token,
            pid: std::process::id(),
        }
    }
}

/// The data directory the app uses: `LOAM_DESKTOP_DATA_DIR`, else Tauri's `app_data_dir`, the platform's data
/// directory and [`IDENTIFIER`], which the bridge finds without starting Tauri.
pub fn data_directory() -> Option<PathBuf> {
    if let Some(data) = std::env::var_os(crate::DATA_DIRECTORY) {
        return Some(PathBuf::from(data));
    }
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        home().map(|home| home.join("Library").join("Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| home().map(|home| home.join(".local").join("share")))
    };
    base.map(|base| base.join(IDENTIFIER))
}

/// Writes `connection` to `<data>/inbound.json`, owner-only from the start ([`write_owner_only`]). A volume that cannot
/// keep the rule (FAT, some network shares) is [`PERMISSIONS`], and no file is left.
pub fn write(data: &Path, connection: &Connection) -> Result<(), &'static str> {
    let text = serde_json::to_vec(connection).expect("a connection serialises");
    write_owner_only(&data.join(FILE), &text).map_err(|_| PERMISSIONS)
}

/// Why [`write_owner_only`] wrote nothing.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Unwritten {
    /// The volume did not keep the owner-only rule on what was made.
    NotOwnerOnly,
    /// Creating, writing, syncing or renaming the file failed (no space, a locked or missing folder).
    Io,
}

/// Writes `bytes` to `path`, owner-only from the start: a temporary file beside it created with mode 0600 (POSIX) or
/// a protected DACL for this user alone (Windows), written, synced and checked, then renamed into place over what was
/// there, and the folder synced. `inbound.json` and the materializer's `mounts.json`, `models.json` and
/// `desktop-state.json` (phase 5 no-terminal amendment, 9.2) are written this way. On failure no file is left.
pub(crate) fn write_owner_only(path: &Path, bytes: &[u8]) -> Result<(), Unwritten> {
    let name = path.file_name().ok_or(Unwritten::Io)?.to_string_lossy();
    let temporary = path.with_file_name(format!("{name}.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&temporary);
    let fail = |why: Unwritten| {
        let _ = std::fs::remove_file(&temporary);
        Err(why)
    };
    // The rule is checked on the new file's own handle before anything is written, since a volume may accept the
    // mode or the DACL and keep neither; a secret never reaches a file others could read.
    // A folder that cannot be written is not the rule failing: only the checks below are.
    let Ok(mut file) = create_owner_only(&temporary) else {
        return fail(Unwritten::Io);
    };
    if !file_owner_only(&file) {
        drop(file);
        return fail(Unwritten::NotOwnerOnly);
    }
    if file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .is_err()
    {
        drop(file);
        return fail(Unwritten::Io);
    }
    drop(file);
    // And checked again on what was made, by its path, before and after the rename.
    if !owner_only(&temporary) {
        return fail(Unwritten::NotOwnerOnly);
    }
    if std::fs::rename(&temporary, path).is_err() {
        return fail(Unwritten::Io);
    }
    if !owner_only(path) {
        let _ = std::fs::remove_file(path);
        return Err(Unwritten::NotOwnerOnly);
    }
    // The rename made durable where the volume allows it, so a commit point survives a power loss once this returns.
    // Best effort: the file is in place either way, and some volumes (FUSE, network shares) refuse a folder's `fsync`.
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let _ = sync_directory(parent.unwrap_or(Path::new(".")));
    Ok(())
}

/// A directory's entries flushed to the disk (POSIX `fsync` on the directory), so a rename into it is durable. On
/// Windows this does nothing: `std::fs::rename` does not ask for `MOVEFILE_WRITE_THROUGH`, so a rename there may still
/// sit in the cache at a power loss, an honest limit startup's reconciliation (step 9b3) covers.
pub(crate) fn sync_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Deletes `<data>/inbound.json` if it is this process's own, so an exit never removes another run's file.
pub fn remove(data: &Path) {
    let path = data.join(FILE);
    if read(data).is_ok_and(|connection| connection.pid == std::process::id()) {
        let _ = std::fs::remove_file(path);
    }
}

/// `<data>/inbound.json`, refused unless only its owner can read it ([`PERMISSIONS`]), or [`UNAVAILABLE`] when it is
/// missing or not one.
pub fn read(data: &Path) -> Result<Connection, &'static str> {
    match read_owner_only(&data.join(FILE), FILE_MAX) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE),
        Err(Unread::Missing | Unread::TooLarge) => Err(UNAVAILABLE),
        Err(Unread::Denied) => Err(PERMISSIONS),
    }
}

/// Whether a process with this id runs as this user: the check the bridge makes before it sends the token.
#[cfg(unix)]
pub fn running(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 checks for the process and permission to signal it, and sends nothing. Another user's
    // process answers `EPERM`, which is refused too.
    pid > 0 && unsafe { libc::kill(pid, 0) } == 0
}

/// Whether a process with this id is still running.
#[cfg(windows)]
pub fn running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: `OpenProcess` returns null or a handle this function closes; `GetExitCodeProcess` writes `code`.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut code = 0u32;
        let alive = GetExitCodeProcess(process, &mut code) != 0 && code == STILL_ACTIVE as u32;
        CloseHandle(process);
        alive
    }
}

#[cfg(unix)]
fn create_owner_only(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

/// A new file whose security descriptor is set as it is created, before anything is written: this user as owner and
/// a protected DACL with one entry, full control for this user, so nothing is inherited. Never a spawned `icacls`.
#[cfg(windows)]
fn create_owner_only(path: &Path) -> std::io::Result<std::fs::File> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, AddAccessAllowedAce, GetLengthSid,
        GetTokenInformation, InitializeAcl, InitializeSecurityDescriptor, IsValidSid, PSID,
        SE_DACL_PROTECTED, SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR, SetSecurityDescriptorControl,
        SetSecurityDescriptorDacl, SetSecurityDescriptorOwner, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CREATE_NEW, CreateFileW, FILE_ALL_ACCESS, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_WRITE,
    };
    use windows_sys::Win32::System::SystemServices::SECURITY_DESCRIPTOR_REVISION;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let denied = || std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    let mut token: HANDLE = null_mut();
    // SAFETY: the pseudo-handle is valid for this process; `token` is written on success and closed below.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(denied());
    }
    let mut needed = 0u32;
    // SAFETY: a null buffer of size 0 asks for the length.
    unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut needed) };
    // `Vec<u64>` keeps `TOKEN_USER` aligned.
    let mut user = vec![0u64; (needed as usize).div_ceil(size_of::<u64>()).max(1)];
    let size = (user.len() * size_of::<u64>()) as u32;
    // SAFETY: `user` is writable for `size` bytes and aligned for `TOKEN_USER`.
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            user.as_mut_ptr().cast::<c_void>(),
            size,
            &mut needed,
        )
    };
    // SAFETY: `token` was opened above and is closed once.
    unsafe { CloseHandle(token) };
    if read == 0 || (needed as usize) < size_of::<TOKEN_USER>() {
        return Err(denied());
    }
    // SAFETY: `GetTokenInformation` wrote a `TOKEN_USER` at the buffer's start; its SID points into `user`.
    let sid: PSID = unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    // SAFETY: `IsValidSid` reads the SID's header.
    if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
        return Err(denied());
    }
    // SAFETY: `sid` is valid.
    let sid_length = unsafe { GetLengthSid(sid) } as usize;
    let acl_size =
        size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>() + sid_length;
    // `Vec<u64>` keeps the ACL DWORD-aligned, as `InitializeAcl` requires.
    let mut acl = vec![0u64; acl_size.div_ceil(size_of::<u64>())];
    let acl_ptr = acl.as_mut_ptr().cast::<ACL>();
    // SAFETY: `descriptor` is a plain struct `InitializeSecurityDescriptor` fills; `acl` is writable for `acl_size`
    // bytes; `sid` outlives every call, as do `acl` and `descriptor`, which the descriptor only points to.
    let mut descriptor: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
    let descriptor_ptr = (&mut descriptor as *mut SECURITY_DESCRIPTOR).cast::<c_void>();
    let built = unsafe {
        InitializeAcl(acl_ptr, acl_size as u32, ACL_REVISION) != 0
            && AddAccessAllowedAce(acl_ptr, ACL_REVISION, FILE_ALL_ACCESS, sid) != 0
            && InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION) != 0
            && SetSecurityDescriptorOwner(descriptor_ptr, sid, 0) != 0
            && SetSecurityDescriptorDacl(descriptor_ptr, 1, acl_ptr, 0) != 0
            && SetSecurityDescriptorControl(descriptor_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED)
                != 0
    };
    if !built {
        return Err(denied());
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor_ptr,
        bInheritHandle: 0,
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated path; `attributes` and what it points to live through the call. No sharing,
    // and `CREATE_NEW` refuses an existing file or link.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_GENERIC_WRITE,
            0,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `handle` is a new file handle this `File` now owns.
    Ok(unsafe { std::fs::File::from_raw_handle(handle) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_is_owner_only_from_the_start_and_only_this_run_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let connection = Connection::new(4321, "token".into());
        assert_eq!(connection.url, "http://127.0.0.1:4321/mcp");
        write(dir.path(), &connection).unwrap();
        assert!(owner_only(&dir.path().join(FILE)));
        assert_eq!(read(dir.path()).unwrap(), connection);
        // No temporary file is left beside it.
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(FILE)]);
        // A second write replaces it (a crash left the last run's).
        let next = Connection::new(4322, "other".into());
        write(dir.path(), &next).unwrap();
        assert_eq!(read(dir.path()).unwrap(), next);
        // Another run's file is not this exit's to remove.
        let foreign = Connection {
            pid: std::process::id().wrapping_add(1),
            ..next.clone()
        };
        write(dir.path(), &foreign).unwrap();
        remove(dir.path());
        assert!(dir.path().join(FILE).exists());
        write(dir.path(), &next).unwrap();
        remove(dir.path());
        assert!(!dir.path().join(FILE).exists());
        assert_eq!(read(dir.path()).err(), Some(UNAVAILABLE));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_others_can_read_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), &Connection::new(1, "t".into())).unwrap();
        let path = dir.path().join(FILE);
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(read(dir.path()).err(), Some(PERMISSIONS));
        // A link in its place is refused, not followed.
        std::fs::remove_file(&path).unwrap();
        let target = dir.path().join("elsewhere");
        std::fs::write(&target, "{}").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert_eq!(read(dir.path()).err(), Some(PERMISSIONS));
    }

    #[test]
    fn this_process_is_running_and_a_finished_one_is_not() {
        assert!(running(std::process::id()));
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!running(pid));
    }

    #[test]
    fn the_data_directory_is_the_apps() {
        // The suite's variable wins; it is the one test that sets it, and restores it.
        let held = std::env::var_os(crate::DATA_DIRECTORY);
        // SAFETY: no other test in this binary reads or writes this variable.
        unsafe { std::env::set_var(crate::DATA_DIRECTORY, "/somewhere") };
        assert_eq!(data_directory(), Some(PathBuf::from("/somewhere")));
        match held {
            // SAFETY: as above.
            Some(value) => unsafe { std::env::set_var(crate::DATA_DIRECTORY, value) },
            None => unsafe { std::env::remove_var(crate::DATA_DIRECTORY) },
        }
        if std::env::var_os(crate::DATA_DIRECTORY).is_none() {
            assert!(data_directory().unwrap().ends_with(IDENTIFIER));
        }
    }
}
