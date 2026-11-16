//! A file's or directory's owner and discretionary ACL, and the SID of the user the process runs
//! as, each SID in its string form.
//!
//! The ACL is read from an open handle ([`security_of`]), so that the object judged is the one
//! that was opened; [`security_of_path`] opens the path (through symbolic links, as a read does)
//! for `READ_CONTROL` only. A NULL DACL, which grants everyone everything, is reported as one
//! entry allowing `Everyone` (`S-1-1-0`) `GENERIC_ALL`. An entry of a type this module does not
//! parse is an error, so that a caller judging the ACL fails closed rather than skip it.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::fs::File;
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, GetSecurityInfo, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, GetAce, GetLengthSid, GetTokenInformation,
    INHERIT_ONLY_ACE, IsValidSid, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, READ_CONTROL,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// `NT AUTHORITY\SYSTEM`.
pub const SYSTEM_SID: &str = "S-1-5-18";
/// `BUILTIN\Administrators`.
pub const ADMINISTRATORS_SID: &str = "S-1-5-32-544";
/// `Everyone`, whom a NULL DACL grants everything.
pub const EVERYONE_SID: &str = "S-1-1-0";
/// `GENERIC_ALL`, what a NULL DACL grants.
pub const GENERIC_ALL: u32 = 0x1000_0000;

// The ACE types of winnt.h this module parses. The allowed and denied types and their callback
// variants share a layout (header, mask, SID); the object types put flags and up to two GUIDs
// before the SID.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0x0;
const ACCESS_DENIED_ACE_TYPE: u8 = 0x1;
const ACCESS_ALLOWED_OBJECT_ACE_TYPE: u8 = 0x5;
const ACCESS_DENIED_OBJECT_ACE_TYPE: u8 = 0x6;
const ACCESS_ALLOWED_CALLBACK_ACE_TYPE: u8 = 0x9;
const ACCESS_DENIED_CALLBACK_ACE_TYPE: u8 = 0xA;
const ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE: u8 = 0xB;
const ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE: u8 = 0xC;
// An object ACE's flags: which of its two GUIDs are present.
const ACE_OBJECT_TYPE_PRESENT: u32 = 0x1;
const ACE_INHERITED_OBJECT_TYPE_PRESENT: u32 = 0x2;

/// One access control entry of a DACL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ace {
    /// The trustee's SID, as `S-1-…`.
    pub sid: String,
    /// An allow entry (`false`: a deny entry).
    pub allow: bool,
    /// The access mask's 32 bits, generic rights included as written.
    pub mask: u32,
    /// `INHERIT_ONLY_ACE`: the entry is only for the children a directory's entries pass to.
    pub inherit_only: bool,
}

/// An object's owner and discretionary ACL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Security {
    /// The owner's SID, as `S-1-…`.
    pub owner: String,
    /// The DACL's entries in order, inherited ones included.
    pub aces: Vec<Ace>,
}

/// Memory Windows allocated with `LocalAlloc`, freed when dropped.
struct Local(*mut c_void);

impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the pointer was returned by a function documented to allocate it with
            // `LocalAlloc` for the caller to free with `LocalFree`, and is freed once.
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}

/// The owner and DACL of the file or directory at `path`, opened through symbolic links for
/// `READ_CONTROL` only, sharing every access so that an open file does not stop the read.
///
/// # Errors
/// The path cannot be opened (its kind is `NotFound` when it does not exist), or its security
/// cannot be read.
pub fn security_of_path(path: &Path) -> io::Result<Security> {
    let file = std::fs::OpenOptions::new()
        .access_mode(READ_CONTROL)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    security_of(&file)
}

/// The owner and DACL of the open file or directory `file`, which must have been opened with
/// `READ_CONTROL` (a read opens it so).
///
/// # Errors
/// Windows refuses the read, or the DACL holds an entry this module does not parse.
pub fn security_of(file: &File) -> io::Result<Security> {
    let mut owner: PSID = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: the handle is open for as long as `file` is borrowed; every out pointer is a valid
    // local; the group and SACL are not asked for, so their pointers may be null.
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle() as HANDLE,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        #[allow(clippy::cast_possible_wrap)]
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    // `owner` and `dacl` point into the descriptor, which lives until this function returns.
    let _descriptor = Local(descriptor);
    if owner.is_null() {
        return Err(io::Error::other("the security descriptor names no owner"));
    }
    // SAFETY: `owner` points to a SID inside the live descriptor.
    let owner = unsafe { sid_string(owner) }?;
    let aces = if dacl.is_null() {
        vec![Ace {
            sid: EVERYONE_SID.to_owned(),
            allow: true,
            mask: GENERIC_ALL,
            inherit_only: false,
        }]
    } else {
        // SAFETY: `dacl` points to an ACL inside the live descriptor.
        unsafe { entries(dacl) }?
    };
    Ok(Security { owner, aces })
}

/// The entries of the ACL at `acl`.
///
/// # Safety
/// `acl` points to a valid ACL that outlives the call.
unsafe fn entries(acl: *const ACL) -> io::Result<Vec<Ace>> {
    // SAFETY: the caller's guarantee; the header is plain data.
    let count = unsafe { (*acl).AceCount };
    let mut aces = Vec::with_capacity(usize::from(count));
    for index in 0..u32::from(count) {
        let mut ace: *mut c_void = null_mut();
        // SAFETY: `index` is below the ACL's own count; `ace` receives a pointer into the ACL.
        if unsafe { GetAce(acl, index, &mut ace) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let base = ace.cast::<u8>().cast_const();
        // SAFETY: every ACE starts with an `ACE_HEADER`; read unaligned, as ACEs are packed.
        let header = unsafe { base.cast::<ACE_HEADER>().read_unaligned() };
        let size = usize::from(header.AceSize);
        let allow = match header.AceType {
            ACCESS_ALLOWED_ACE_TYPE
            | ACCESS_ALLOWED_CALLBACK_ACE_TYPE
            | ACCESS_ALLOWED_OBJECT_ACE_TYPE
            | ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE => true,
            ACCESS_DENIED_ACE_TYPE
            | ACCESS_DENIED_CALLBACK_ACE_TYPE
            | ACCESS_DENIED_OBJECT_ACE_TYPE
            | ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE => false,
            other => {
                return Err(io::Error::other(format!(
                    "the DACL holds an entry of type {other:#x}, which is not read"
                )));
            }
        };
        let object = matches!(
            header.AceType,
            ACCESS_ALLOWED_OBJECT_ACE_TYPE
                | ACCESS_DENIED_OBJECT_ACE_TYPE
                | ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE
                | ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE
        );
        // Header (4 bytes), then the mask (4); an object entry's flags (4) and GUIDs (16 each).
        let read_u32 = |offset: usize| -> io::Result<u32> {
            if offset + 4 > size {
                return Err(io::Error::other("an ACL entry is shorter than its type"));
            }
            // SAFETY: `offset + 4` is within the entry's own size.
            Ok(unsafe { base.add(offset).cast::<u32>().read_unaligned() })
        };
        let mask = read_u32(4)?;
        let mut sid_offset = 8;
        if object {
            let flags = read_u32(8)?;
            sid_offset = 12;
            if flags & ACE_OBJECT_TYPE_PRESENT != 0 {
                sid_offset += 16;
            }
            if flags & ACE_INHERITED_OBJECT_TYPE_PRESENT != 0 {
                sid_offset += 16;
            }
        }
        // The smallest SID is 8 bytes; the SID's own length must fit the entry too.
        if sid_offset + 8 > size {
            return Err(io::Error::other("an ACL entry is shorter than its SID"));
        }
        // SAFETY: `sid_offset` is within the entry.
        let sid = unsafe { base.add(sid_offset) }.cast_mut().cast::<c_void>();
        // SAFETY: `sid` points to at least 8 bytes of the entry; `IsValidSid` reads its header
        // and sub-authority count, and `GetLengthSid` is only asked of a valid SID.
        let fits = unsafe { IsValidSid(sid) } != 0
            && sid_offset + unsafe { GetLengthSid(sid) } as usize <= size;
        if !fits {
            return Err(io::Error::other("an ACL entry holds no valid SID"));
        }
        aces.push(Ace {
            // SAFETY: a valid SID within the entry.
            sid: unsafe { sid_string(sid) }?,
            allow,
            mask,
            inherit_only: u32::from(header.AceFlags) & INHERIT_ONLY_ACE != 0,
        });
    }
    Ok(aces)
}

/// The string form of the SID at `sid`.
///
/// # Safety
/// `sid` points to a valid SID.
unsafe fn sid_string(sid: PSID) -> io::Result<String> {
    let mut text: *mut u16 = null_mut();
    // SAFETY: the caller's guarantee; `text` receives a `LocalAlloc`ed, NUL-terminated string.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _text = Local(text.cast());
    let mut length = 0;
    // SAFETY: the string is NUL-terminated.
    while unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: `length` UTF-16 units precede the NUL.
    let units = unsafe { std::slice::from_raw_parts(text, length) };
    Ok(String::from_utf16_lossy(units))
}

/// The SID of the user the process runs as (its token's user, not its groups).
///
/// # Errors
/// The process's token cannot be opened or read.
pub fn current_user() -> io::Result<String> {
    let mut token: HANDLE = null_mut();
    // SAFETY: `GetCurrentProcess` is a pseudo-handle; `token` receives a handle to close.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a handle this process owns, closed once, when `token` drops.
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    let mut needed = 0u32;
    // SAFETY: a size query: no buffer, and `needed` receives the size. It fails by design.
    unsafe {
        GetTokenInformation(
            token.as_raw_handle() as HANDLE,
            TokenUser,
            null_mut(),
            0,
            &mut needed,
        );
    }
    if needed == 0 {
        return Err(io::Error::last_os_error());
    }
    // `u64`s, so that the `TOKEN_USER` at its start is aligned.
    let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
    // SAFETY: the buffer holds at least `needed` bytes.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle() as HANDLE,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: Windows wrote a `TOKEN_USER` at the buffer's aligned start; its SID points into
    // the buffer, which lives until the string is made.
    let user = unsafe { buffer.as_ptr().cast::<TOKEN_USER>().read() };
    // SAFETY: as above.
    unsafe { sid_string(user.User.Sid) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_is_owned_by_this_user_and_its_acl_is_read() {
        let me = current_user().unwrap();
        assert!(me.starts_with("S-1-5-"), "{me}");
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        let security = security_of_path(&path).unwrap();
        // An elevated process's files may be owned by Administrators instead.
        assert!(
            security.owner == me || security.owner == ADMINISTRATORS_SID,
            "{security:?}"
        );
        assert!(!security.aces.is_empty(), "{security:?}");
        let opened = File::open(&path).unwrap();
        assert_eq!(security_of(&opened).unwrap(), security);
        let directory = security_of_path(temp.path()).unwrap();
        assert!(!directory.aces.is_empty(), "{directory:?}");
        let missing = security_of_path(&temp.path().join("missing")).unwrap_err();
        assert_eq!(missing.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn an_explicit_grant_is_read_with_its_sid_and_mask() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file");
        std::fs::write(&path, "x").unwrap();
        // BUILTIN\Users, read and execute; a deny entry for Guests.
        let status = std::process::Command::new("icacls")
            .arg(&path)
            .args(["/grant", "*S-1-5-32-545:(RX)", "/deny", "*S-1-5-32-546:(W)"])
            .output()
            .unwrap()
            .status;
        assert!(status.success());
        let security = security_of_path(&path).unwrap();
        let users = security
            .aces
            .iter()
            .find(|ace| ace.sid == "S-1-5-32-545")
            .unwrap();
        assert!(users.allow && !users.inherit_only);
        // FILE_GENERIC_READ | FILE_GENERIC_EXECUTE.
        assert_eq!(users.mask, 0x1200a9);
        let guests = security
            .aces
            .iter()
            .find(|ace| ace.sid == "S-1-5-32-546")
            .unwrap();
        assert!(!guests.allow);
    }
}
