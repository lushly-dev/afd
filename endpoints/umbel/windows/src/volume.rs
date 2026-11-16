//! The drive type of the volume that holds a path: `GetVolumePathNameW` for the volume's root
//! (a drive letter, a mounted folder or a UNC share), then `GetDriveTypeW`.
#![allow(unsafe_code)]

use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW};

/// What `GetDriveTypeW` answers for a volume (the `DRIVE_*` values of winbase.h).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Drive {
    /// `DRIVE_REMOTE`: a network drive or share.
    Remote,
    /// `DRIVE_FIXED`.
    Fixed,
    /// `DRIVE_REMOVABLE`.
    Removable,
    /// `DRIVE_RAMDISK`.
    RamDisk,
    /// `DRIVE_CDROM`.
    CdRom,
    /// `DRIVE_UNKNOWN`, `DRIVE_NO_ROOT_DIR` or a value this enum does not name.
    Other(u32),
}

/// The drive type of the volume that holds `path`, which must exist.
///
/// # Errors
/// Windows cannot tell the volume that holds the path.
pub fn drive_of(path: &Path) -> io::Result<Drive> {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // A volume's root can be longer than a relative path or one under a mounted folder, but never
    // longer than the longest path Windows names (32,767 units).
    let mut root = vec![0u16; (wide.len() + 2).max(32_768)];
    let capacity = u32::try_from(root.len()).map_err(io::Error::other)?;
    // SAFETY: `wide` is NUL-terminated; `root` holds `capacity` units for the answer.
    if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), capacity) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `root` now holds a NUL-terminated volume root.
    let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
    Ok(match kind {
        2 => Drive::Removable,
        3 => Drive::Fixed,
        4 => Drive::Remote,
        5 => Drive::CdRom,
        6 => Drive::RamDisk,
        other => Drive::Other(other),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_temporary_directory_is_on_a_local_drive() {
        let temp = tempfile::tempdir().unwrap();
        let drive = drive_of(temp.path()).unwrap();
        assert!(
            matches!(drive, Drive::Fixed | Drive::Removable | Drive::RamDisk),
            "{drive:?}"
        );
    }
}
