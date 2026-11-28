//! Safe process-isolation helpers for spawning Umbel's child processes (D205).
//!
//! The `umbel` host crate forbids `unsafe` code (`#![forbid(unsafe_code)]`). Mirroring
//! `umbel-windows`, the small platform FFI needed to keep inherited descriptors out of a mounted
//! stdio child (and to check Unix execute permissions accurately) lives here behind safe functions.
//! So does turning off core dumps in a process about to abort on purpose (the store's crash points).

use std::path::Path;
use std::process::Command;

/// Ensure the child process spawned by `command` inherits no open file descriptors beyond standard
/// input, output and error (`0`, `1`, `2`) on Unix.
///
/// On Unix, installs a `pre_exec` hook using only async-signal-safe syscalls:
/// - On Linux: `close_range(3, c_uint::MAX, CLOSE_RANGE_CLOEXEC)`, falling back on older kernels
///   (or restricted seccomp filters) to scanning `/proc/self/fd` with `getdents64`, and finally to
///   an `fcntl(fd, F_SETFD, FD_CLOEXEC)` sweep if `/proc` is unavailable.
/// - On macOS: scans `/dev/fd` with `open` + `getdirentries` (covering every open descriptor even
///   above a lowered soft `RLIMIT_NOFILE`), falling back to an `fcntl` sweep if `/dev/fd` cannot be
///   opened.
/// - On other Unix systems: sweeps `fcntl(fd, F_SETFD, FD_CLOEXEC)`.
///
/// Marking descriptors close-on-exec rather than closing them before `execve` preserves Rust's
/// internal `Command::spawn` exec-error pipe so `execve` failures still report normally. Any
/// unexpected `fcntl` or syscall error (other than `EBADF` for a closed descriptor) is returned
/// from `pre_exec`, failing `spawn()` closed.
///
/// On Windows, this function is a no-op: Rust's `std::process::Command` opens its own handles
/// non-inheritable, but handles explicitly marked inheritable by an embedding host are not stripped
/// here (the descriptor-inheritance guarantee in D205 applies to Unix).
pub fn close_extra_fds(command: &mut Command) {
    #[cfg(unix)]
    unix::close_extra_fds(command);
    #[cfg(not(unix))]
    let _ = command;
}

/// Whether `path` is a regular file executable by the current user.
///
/// On Unix, uses `access(path, X_OK)` beside `is_file()` so root-owned or other-user executable
/// files that `execvp` would skip with `EACCES` are not mistaken for runnable executables.
/// On Windows, checks `path.is_file()`.
pub fn is_executable_by_current_user(path: &Path) -> bool {
    #[cfg(unix)]
    {
        path.is_file() && unix::is_executable(path)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// Turn off core dumps for the current process, for a process about to abort on purpose.
///
/// On Unix, lowers the soft `RLIMIT_CORE` to `0` and keeps the hard limit, so a later
/// `std::process::abort()` writes no `core` file into the working directory, whatever the
/// machine's `ulimit -c` (a container's may be unlimited, as Colima's are). The process's
/// children inherit the limit. On other systems, does nothing and answers `Ok`.
///
/// # Errors
///
/// The operating system's error, if `getrlimit` or `setrlimit` fails.
pub fn disable_core_dumps() -> std::io::Result<()> {
    #[cfg(unix)]
    {
        unix::disable_core_dumps()
    }
    #[cfg(not(unix))]
    {
        Ok(())
    }
}

#[cfg(unix)]
#[allow(unsafe_code)]
mod unix {
    use std::ffi::CString;
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    /// Upper bound for the last-resort `fcntl` sweep when neither `close_range` nor `/proc/self/fd`
    /// or `/dev/fd` is available and `RLIMIT_NOFILE` is unlimited or very large.
    const SWEEP_FALLBACK_CAP: libc::c_int = 65_536;

    pub(super) fn is_executable(path: &Path) -> bool {
        let Ok(c_path) = CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // SAFETY: `c_path` is a valid NUL-terminated string.
        unsafe { libc::access(c_path.as_ptr(), libc::X_OK) == 0 }
    }

    pub(super) fn disable_core_dumps() -> io::Result<()> {
        let mut rlim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: `rlim` is a valid mutable `libc::rlimit` pointer.
        if unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut rlim) } != 0 {
            return Err(io::Error::last_os_error());
        }
        rlim.rlim_cur = 0;
        // SAFETY: `rlim` is a valid `libc::rlimit`; a soft limit at or below the hard limit needs
        // no privilege to set.
        if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &rlim) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub(super) fn close_extra_fds(command: &mut Command) {
        let sweep_limit = fallback_fd_limit();

        // SAFETY: The closure runs in the forked child before `execve` and calls only
        // async-signal-safe system calls (`close_range`, `open`, `getdents64` / `getdirentries`,
        // `fcntl`, `close`), with stack buffers only and no heap allocation, locks, or Rust std I/O.
        // Setting `FD_CLOEXEC` preserves Rust's own close-on-exec exec-error pipe until `execve`.
        unsafe {
            command.pre_exec(move || mark_fds_cloexec(sweep_limit));
        }
    }

    fn fallback_fd_limit() -> libc::c_int {
        let mut rlim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: `rlim` is a valid mutable `libc::rlimit` pointer.
        let rc = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut rlim) };
        if rc != 0 {
            return SWEEP_FALLBACK_CAP;
        }
        // Prefer the hard limit when finite (a lowered soft limit can sit below already-open fds),
        // capped so a huge container limit does not stall the last-resort sweep.
        let chosen = if rlim.rlim_max != libc::RLIM_INFINITY {
            rlim.rlim_max.max(rlim.rlim_cur)
        } else {
            rlim.rlim_cur
        };
        if chosen == libc::RLIM_INFINITY {
            return SWEEP_FALLBACK_CAP;
        }
        let capped = chosen.min(SWEEP_FALLBACK_CAP as libc::rlim_t);
        libc::c_int::try_from(capped).unwrap_or(SWEEP_FALLBACK_CAP)
    }

    fn set_cloexec(fd: libc::c_int) -> io::Result<()> {
        // SAFETY: `fcntl(fd, F_SETFD, FD_CLOEXEC)` is async-signal-safe.
        let rc = unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
        if rc == 0 {
            return Ok(());
        }
        let err = io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EBADF) {
            Ok(())
        } else {
            Err(err)
        }
    }

    /// Parse an ASCII non-negative decimal descriptor number without allocation.
    fn parse_fd_name(bytes: &[u8]) -> Option<libc::c_int> {
        if bytes.is_empty() {
            return None;
        }
        let mut value: libc::c_int = 0;
        for &byte in bytes {
            if !byte.is_ascii_digit() {
                return None;
            }
            value = value
                .checked_mul(10)?
                .checked_add(libc::c_int::from(byte - b'0'))?;
        }
        Some(value)
    }

    fn mark_fds_cloexec(sweep_limit: libc::c_int) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        {
            // `CLOSE_RANGE_CLOEXEC` (Linux 5.11+): atomically marks every open descriptor >= 3
            // close-on-exec in O(open fds), independent of `RLIMIT_NOFILE`.
            const CLOSE_RANGE_CLOEXEC: libc::c_uint = 1 << 2;
            // SAFETY: `SYS_close_range` with `(3, c_uint::MAX, CLOSE_RANGE_CLOEXEC)` is an
            // async-signal-safe syscall taking only integer arguments.
            let rc = unsafe {
                libc::syscall(
                    libc::SYS_close_range,
                    3 as libc::c_uint,
                    libc::c_uint::MAX,
                    CLOSE_RANGE_CLOEXEC,
                )
            };
            if rc == 0 {
                return Ok(());
            }
            let err = io::Error::last_os_error();
            if !matches!(
                err.raw_os_error(),
                Some(libc::ENOSYS | libc::EINVAL | libc::EPERM)
            ) {
                return Err(err);
            }
            if mark_from_proc_self_fd()? {
                return Ok(());
            }
        }

        #[cfg(target_os = "macos")]
        {
            if mark_from_dev_fd()? {
                return Ok(());
            }
        }

        for fd in 3..sweep_limit {
            set_cloexec(fd)?;
        }
        Ok(())
    }

    /// Scan `/proc/self/fd` on Linux using `open` + `SYS_getdents64` into a stack buffer.
    /// Returns `Ok(true)` if `/proc/self/fd` was scanned, `Ok(false)` if it could not be opened.
    #[cfg(target_os = "linux")]
    pub(super) fn mark_from_proc_self_fd() -> io::Result<bool> {
        #[repr(C)]
        struct LinuxDirent64 {
            d_ino: u64,
            d_off: i64,
            d_reclen: u16,
            d_type: u8,
            d_name: [u8; 0],
        }

        const RECLEN_OFFSET: usize = core::mem::offset_of!(LinuxDirent64, d_reclen);
        const NAME_OFFSET: usize = core::mem::offset_of!(LinuxDirent64, d_name);
        const _: () = assert!(RECLEN_OFFSET == 16);
        const _: () = assert!(NAME_OFFSET == 19);

        // SAFETY: static NUL-terminated path; `open` is async-signal-safe.
        let dir_fd = unsafe {
            libc::open(
                c"/proc/self/fd".as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if dir_fd < 0 {
            return Ok(false);
        }

        let mut buf = [0u8; 4096];
        let result = (|| -> io::Result<()> {
            loop {
                // SAFETY: `dir_fd` is open and `buf` is valid writable memory of length `buf.len()`.
                let nread = unsafe {
                    libc::syscall(libc::SYS_getdents64, dir_fd, buf.as_mut_ptr(), buf.len())
                };
                if nread < 0 {
                    return Err(io::Error::last_os_error());
                }
                if nread == 0 {
                    break;
                }
                let total = usize::try_from(nread).unwrap_or(0).min(buf.len());
                let mut offset = 0usize;
                while offset + NAME_OFFSET <= total {
                    // SAFETY: `offset + NAME_OFFSET <= total <= buf.len()` and `RECLEN_OFFSET + 2 <= NAME_OFFSET`;
                    // `read_unaligned` handles any alignment of the `linux_dirent64` record.
                    let reclen = usize::from(unsafe {
                        core::ptr::read_unaligned(
                            buf.as_ptr().add(offset + RECLEN_OFFSET).cast::<u16>(),
                        )
                    });
                    if reclen < NAME_OFFSET || offset + reclen > total {
                        break;
                    }
                    let name_area = &buf[offset + NAME_OFFSET..offset + reclen];
                    let name_len = name_area
                        .iter()
                        .position(|&b| b == 0)
                        .unwrap_or(name_area.len());
                    if let Some(fd) = parse_fd_name(&name_area[..name_len])
                        && fd >= 3
                        && fd != dir_fd
                    {
                        set_cloexec(fd)?;
                    }
                    offset += reclen;
                }
            }
            Ok(())
        })();

        // SAFETY: `dir_fd` is valid and owned by this function.
        unsafe {
            libc::close(dir_fd);
        }
        result.map(|()| true)
    }

    /// Scan `/dev/fd` on macOS using `open` + `__getdirentries64` into a stack buffer, covering
    /// every open descriptor even above a lowered soft `RLIMIT_NOFILE`.
    #[cfg(target_os = "macos")]
    fn mark_from_dev_fd() -> io::Result<bool> {
        unsafe extern "C" {
            // 64-bit macOS kernel entry matching `libc::dirent` on both `aarch64` and `x86_64`.
            fn __getdirentries64(
                fd: libc::c_int,
                buf: *mut libc::c_void,
                bufsize: libc::size_t,
                position: *mut libc::off_t,
            ) -> libc::ssize_t;
        }

        // SAFETY: static NUL-terminated path; `open` is async-signal-safe.
        let dir_fd = unsafe {
            libc::open(
                c"/dev/fd".as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if dir_fd < 0 {
            return Ok(false);
        }

        let mut buf = [0u8; 4096];
        let mut position: libc::off_t = 0;
        let result = (|| -> io::Result<()> {
            loop {
                // SAFETY: `dir_fd` is open, `buf` is valid writable memory of `buf.len()` bytes,
                // and `position` is a valid mutable `off_t`.
                let nread = unsafe {
                    __getdirentries64(
                        dir_fd,
                        buf.as_mut_ptr().cast::<libc::c_void>(),
                        buf.len(),
                        &mut position,
                    )
                };
                if nread < 0 {
                    return Err(io::Error::last_os_error());
                }
                if nread == 0 {
                    break;
                }
                let total = usize::try_from(nread).unwrap_or(0).min(buf.len());
                let mut offset = 0usize;
                let name_offset = core::mem::offset_of!(libc::dirent, d_name);
                while offset + name_offset <= total {
                    // SAFETY: `offset + name_offset <= total`, and `d_reclen` / `d_namlen` sit
                    // before `d_name` in `libc::dirent`.
                    let reclen = unsafe {
                        usize::from(core::ptr::read_unaligned(
                            buf.as_ptr()
                                .add(offset + core::mem::offset_of!(libc::dirent, d_reclen))
                                .cast::<u16>(),
                        ))
                    };
                    let namlen = unsafe {
                        usize::from(core::ptr::read_unaligned(
                            buf.as_ptr()
                                .add(offset + core::mem::offset_of!(libc::dirent, d_namlen))
                                .cast::<u16>(),
                        ))
                    };
                    if reclen < name_offset || offset + reclen > total {
                        break;
                    }
                    let max_name = reclen - name_offset;
                    let name_len = namlen.min(max_name);
                    let name_bytes = &buf[offset + name_offset..offset + name_offset + name_len];
                    if let Some(fd) = parse_fd_name(name_bytes)
                        && fd >= 3
                        && fd != dir_fd
                    {
                        set_cloexec(fd)?;
                    }
                    offset += reclen;
                }
            }
            Ok(())
        })();

        // SAFETY: `dir_fd` is valid and owned by this function.
        unsafe {
            libc::close(dir_fd);
        }
        result.map(|()| true)
    }
}

#[cfg(all(test, unix))]
#[allow(unsafe_code, clippy::unwrap_used)]
mod tests {
    use super::close_extra_fds;
    use std::process::{Command, Stdio};

    #[test]
    fn inherited_non_cloexec_fd_does_not_reach_child() {
        // Open a pipe without `O_CLOEXEC` (`libc::pipe` leaves `FD_CLOEXEC` clear) so the parent
        // definitely holds inheritable descriptors above 2.
        let mut fds = [-1 as libc::c_int; 2];
        // SAFETY: `fds` is a valid 2-element array for `libc::pipe`.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let read_fd = fds[0];
        let write_fd = fds[1];
        assert!(read_fd > 2 && write_fd > 2);

        let fd_dir = if std::path::Path::new("/proc/self/fd").is_dir() {
            "/proc/self/fd"
        } else {
            "/dev/fd"
        };

        let mut cmd = Command::new("/bin/sh");
        cmd.args([
            "-c",
            &format!("test ! -e {fd_dir}/{read_fd} && test ! -e {fd_dir}/{write_fd}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        close_extra_fds(&mut cmd);

        let status = cmd.status().unwrap();

        // SAFETY: closing the test pipe descriptors we opened above.
        unsafe {
            libc::close(read_fd);
            libc::close(write_fd);
        }

        assert!(
            status.success(),
            "child saw inherited pipe fds {read_fd}/{write_fd}"
        );
    }

    #[test]
    fn high_numbered_non_cloexec_fd_does_not_reach_child() {
        // Duplicate a pipe onto a high descriptor number (e.g. 200) to verify the directory scan /
        // `close_range` path handles sparse high-numbered descriptors cleanly.
        let mut fds = [-1 as libc::c_int; 2];
        // SAFETY: `fds` is a valid 2-element array for `libc::pipe`.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let high_fd: libc::c_int = 200;
        // SAFETY: duplicating `fds[0]` onto `high_fd` (`dup2` clears `FD_CLOEXEC`).
        let dup_rc = unsafe { libc::dup2(fds[0], high_fd) };
        // SAFETY: close original pipe fds now that `high_fd` holds the open end.
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
        assert_eq!(dup_rc, high_fd);

        let fd_dir = if std::path::Path::new("/proc/self/fd").is_dir() {
            "/proc/self/fd"
        } else {
            "/dev/fd"
        };

        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", &format!("test ! -e {fd_dir}/{high_fd}")])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        close_extra_fds(&mut cmd);

        let status = cmd.status().unwrap();

        // SAFETY: closing the test descriptor `high_fd`.
        unsafe {
            libc::close(high_fd);
        }

        assert!(
            status.success(),
            "child saw inherited high-numbered fd {high_fd}"
        );
    }

    /// The soft core limit a child shell reads back with `ulimit -c`.
    fn child_core_limit() -> String {
        let output = Command::new("/bin/sh")
            .args(["-c", "ulimit -c"])
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    #[test]
    fn disable_core_dumps_sets_the_soft_limit_to_zero() {
        // Raise the soft limit to the hard one first, so the test sees a change where the host
        // allows cores at all (on macOS and GitHub's runners the soft limit is already 0). The
        // test process's own limits are harmless to change; a child inherits them.
        let mut rlim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: `rlim` is a valid mutable `libc::rlimit` pointer.
        assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut rlim) }, 0);
        if rlim.rlim_max != 0 {
            rlim.rlim_cur = rlim.rlim_max;
            // SAFETY: `rlim` is a valid `libc::rlimit` whose soft limit equals its hard limit.
            assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_CORE, &rlim) }, 0);
            assert_ne!(child_core_limit(), "0", "the soft limit was raised");
        }
        let hard = rlim.rlim_max;
        super::disable_core_dumps().unwrap();
        assert_eq!(child_core_limit(), "0");
        // SAFETY: `rlim` is a valid mutable `libc::rlimit` pointer.
        assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut rlim) }, 0);
        assert_eq!(rlim.rlim_max, hard, "the hard limit is kept");
    }

    #[test]
    fn spawn_still_reports_exec_errors() {
        let mut cmd = Command::new("/nonexistent/umbel-process-test-binary");
        close_extra_fds(&mut cmd);
        let err = cmd.spawn().unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_proc_self_fd_fallback_marks_low_and_high_fds_cloexec() {
        use std::os::unix::process::CommandExt;

        let mut fds = [-1 as libc::c_int; 2];
        // SAFETY: `fds` is a valid 2-element array for `libc::pipe`.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let low_fd = fds[0];
        let high_fd: libc::c_int = 201;
        // SAFETY: duplicating `fds[1]` onto `high_fd` (`dup2` clears `FD_CLOEXEC`).
        let dup_rc = unsafe { libc::dup2(fds[1], high_fd) };
        // SAFETY: close the original write end now that `high_fd` holds it.
        unsafe {
            libc::close(fds[1]);
        }
        assert_eq!(dup_rc, high_fd);

        let mut cmd = Command::new("/bin/sh");
        cmd.args([
            "-c",
            &format!("test ! -e /proc/self/fd/{low_fd} && test ! -e /proc/self/fd/{high_fd}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        // SAFETY: `mark_from_proc_self_fd` uses only async-signal-safe syscalls.
        unsafe {
            cmd.pre_exec(|| {
                let scanned = super::unix::mark_from_proc_self_fd()?;
                if !scanned {
                    return Err(std::io::Error::other("/proc/self/fd unavailable"));
                }
                Ok(())
            });
        }

        let status = cmd.status().unwrap();

        // SAFETY: closing the test descriptors opened above.
        unsafe {
            libc::close(low_fd);
            libc::close(high_fd);
        }

        assert!(
            status.success(),
            "Linux /proc/self/fd fallback left fd {low_fd} or {high_fd} open in child"
        );
    }
}
