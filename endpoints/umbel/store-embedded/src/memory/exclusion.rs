//! Keeping memory out of Time Machine (phase 3 section 5.4, D87).
//!
//! On macOS the mark is the extended attribute `com.apple.metadata:com_apple_backup_excludeItem`
//! holding a binary property list of the string `com.apple.backupd`, byte for byte what
//! `tmutil addexclusion` writes. It is sticky: it follows the file through a rename and a copy.
//! The store sets it through `libc`, spawning no process. On other systems nothing is set and
//! nothing fails.
//!
//! This is the crate's only `unsafe` code: three foreign calls, each given NUL-terminated strings
//! that outlive the call and a buffer with its true length.

use std::path::Path;

/// Mark `path` excluded from machine backups when `exclude`, or remove the mark when not, in
/// each case only where it is needed. A missing file is not an error.
///
/// # Errors
/// The operating system's error when the attribute cannot be read or changed.
pub(crate) fn apply(path: &Path, exclude: bool) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    match (is_excluded(path)?, exclude) {
        (false, true) => imp::set(path),
        (true, false) => imp::remove(path),
        _ => Ok(()),
    }
}

/// Whether `path` carries the exclusion. Always `false` off macOS.
///
/// # Errors
/// The operating system's error when the attribute cannot be read.
pub fn is_excluded(path: &Path) -> std::io::Result<bool> {
    imp::get(path).map(|value| value.is_some())
}

/// The attribute's value: `bplist00`, one ASCII string object of 17 bytes, its offset table and
/// the 32-byte trailer, as `tmutil addexclusion` writes it.
#[cfg(any(target_os = "macos", test))]
const VALUE: [u8; 61] = *b"bplist00\x5f\x10\x11com.apple.backupd\x08\
\x00\x00\x00\x00\x00\x00\x01\x01\
\x00\x00\x00\x00\x00\x00\x00\x01\
\x00\x00\x00\x00\x00\x00\x00\x00\
\x00\x00\x00\x00\x00\x00\x00\x1c";

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod imp {
    use std::ffi::{CStr, CString};
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    use super::VALUE;

    const NAME: &CStr = c"com.apple.metadata:com_apple_backup_excludeItem";

    fn c_path(path: &Path) -> io::Result<CString> {
        CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a path holds a NUL byte"))
    }

    fn missing(error: &io::Error) -> bool {
        error.raw_os_error() == Some(libc::ENOATTR)
    }

    pub(super) fn get(path: &Path) -> io::Result<Option<Vec<u8>>> {
        let p = c_path(path)?;
        // SAFETY: `p` and `NAME` are NUL-terminated and live across the call; a null buffer of
        // size 0 asks only for the value's size.
        let size =
            unsafe { libc::getxattr(p.as_ptr(), NAME.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
        if size < 0 {
            let error = io::Error::last_os_error();
            return if missing(&error) {
                Ok(None)
            } else {
                Err(error)
            };
        }
        let mut buf = vec![0_u8; usize::try_from(size).unwrap_or(0)];
        // SAFETY: as above, with `buf` writable for exactly `buf.len()` bytes.
        let read = unsafe {
            libc::getxattr(
                p.as_ptr(),
                NAME.as_ptr(),
                buf.as_mut_ptr().cast(),
                buf.len(),
                0,
                0,
            )
        };
        if read < 0 {
            let error = io::Error::last_os_error();
            return if missing(&error) {
                Ok(None)
            } else {
                Err(error)
            };
        }
        buf.truncate(usize::try_from(read).unwrap_or(0));
        Ok(Some(buf))
    }

    pub(super) fn set(path: &Path) -> io::Result<()> {
        let p = c_path(path)?;
        // SAFETY: `p` and `NAME` are NUL-terminated; `VALUE` is readable for its whole length.
        let done = unsafe {
            libc::setxattr(
                p.as_ptr(),
                NAME.as_ptr(),
                VALUE.as_ptr().cast(),
                VALUE.len(),
                0,
                0,
            )
        };
        if done == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub(super) fn remove(path: &Path) -> io::Result<()> {
        let p = c_path(path)?;
        // SAFETY: `p` and `NAME` are NUL-terminated and live across the call.
        let done = unsafe { libc::removexattr(p.as_ptr(), NAME.as_ptr(), 0) };
        if done == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if missing(&error) { Ok(()) } else { Err(error) }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use std::io;
    use std::path::Path;

    pub(super) fn get(_: &Path) -> io::Result<Option<Vec<u8>>> {
        Ok(None)
    }

    pub(super) fn set(_: &Path) -> io::Result<()> {
        Ok(())
    }

    pub(super) fn remove(_: &Path) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_value_is_what_tmutil_writes() {
        // `xattr -px com.apple.metadata:com_apple_backup_excludeItem` after `tmutil addexclusion`,
        // on the development Mac, 2026-11-03.
        let tmutil = "62 70 6C 69 73 74 30 30 5F 10 11 63 6F 6D 2E 61 \
            70 70 6C 65 2E 62 61 63 6B 75 70 64 08 00 00 00 \
            00 00 00 01 01 00 00 00 00 00 00 00 01 00 00 00 \
            00 00 00 00 00 00 00 00 00 00 00 00 1C";
        let bytes: Vec<u8> = tmutil
            .split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap_or(0))
            .collect();
        assert_eq!(bytes, super::VALUE);
    }
}
