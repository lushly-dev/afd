//! The browser process and everything it starts, as one unit the host can stop.
//!
//! - **Unix.** The browser leads its own process group (`cdp::launch` calls `setpgid` before
//!   exec), so stopping it kills the group. It is never reaped before that, so its id, which
//!   names the group, cannot have been reused.
//! - **Windows.** The browser is created suspended, placed in a Job Object that kills every
//!   process in it when its last handle closes, and only then resumed, so each process it starts
//!   is in the job too. Stopping it terminates the job, and a host that dies, however it dies,
//!   closes the job's handle and so stops the browser.

#[cfg(unix)]
pub use unix::Child;
#[cfg(windows)]
pub use windows::{Child, spawn_with_pipes};

/// Remove a directory the browser used, ignoring failure.
#[cfg(unix)]
pub fn remove_tree(path: &std::path::Path) {
    let _ = std::fs::remove_dir_all(path);
}

/// Remove a directory the browser used, ignoring failure. A file a process just closed can stay
/// open on Windows for a moment (a scanner holding it, a handle closing late), and a directory
/// with an open file cannot be removed, so removal is retried for up to two seconds.
#[cfg(windows)]
pub fn remove_tree(path: &std::path::Path) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    while std::fs::remove_dir_all(path).is_err()
        && path.exists()
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}

#[cfg(unix)]
mod unix {
    /// The browser process, which is also its process group's leader.
    pub struct Child(std::process::Child);

    impl From<std::process::Child> for Child {
        fn from(child: std::process::Child) -> Self {
            Child(child)
        }
    }

    impl Child {
        pub fn id(&self) -> u32 {
            self.0.id()
        }

        /// Whether the process has exited, without reaping it: until it is reaped its id, and
        /// so its process group's, cannot be reused by another process.
        pub fn exited(&self) -> bool {
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let status = unsafe {
                libc::waitid(
                    libc::P_PID,
                    self.0.id() as libc::id_t,
                    &mut info,
                    libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
                )
            };
            status == 0 && unsafe { info.si_pid() } != 0
        }

        /// Kill the browser's process group: the browser, and any descendant that outlived it.
        pub fn kill_tree(&self) {
            unsafe { libc::killpg(self.0.id() as i32, libc::SIGKILL) };
        }

        /// Reap the browser.
        pub fn wait(&mut self) {
            let _ = self.0.wait();
        }
    }
}

#[cfg(windows)]
mod windows {
    use anyhow::{Context, Result};
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{
        GENERIC_READ, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
        SetHandleInformation, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
        QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
        DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROCESS_INFORMATION, ResumeThread, STARTF_USESTDHANDLES,
        STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
    };

    /// The browser process and the job holding it and everything it starts.
    pub struct Child {
        process: OwnedHandle,
        job: OwnedHandle,
        pid: u32,
    }

    impl Child {
        pub fn id(&self) -> u32 {
            self.pid
        }

        /// Whether the browser process has exited. The open handle keeps its id from being
        /// reused until the handle closes.
        pub fn exited(&self) -> bool {
            unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) == WAIT_OBJECT_0 }
        }

        /// Terminate every process in the job: the browser, and any descendant that outlived it.
        pub fn kill_tree(&self) {
            unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) };
        }

        /// Wait for the browser to exit, then, for at most two seconds, for the rest of its job,
        /// so that no browser process still holds the profile directory when it is removed.
        pub fn wait(&mut self) {
            unsafe { WaitForSingleObject(self.process.as_raw_handle(), INFINITE) };
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.active_processes() > 0 && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn active_processes(&self) -> u32 {
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
            let ok = unsafe {
                QueryInformationJobObject(
                    self.job.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&raw mut info).cast::<c_void>(),
                    size_of_val(&info) as u32,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 { 0 } else { info.ActiveProcesses }
        }
    }

    fn last_error() -> anyhow::Error {
        std::io::Error::last_os_error().into()
    }

    /// Take ownership of a handle a call returned, or the call's error.
    fn owned(handle: HANDLE, ok: bool) -> Result<OwnedHandle> {
        if !ok || handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(last_error());
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    fn security(inherit: bool) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: i32::from(inherit),
        }
    }

    /// A pipe whose ends nothing inherits; the child's end is made inheritable deliberately,
    /// and only the handle list given to `CreateProcessW` decides what the child receives.
    fn pipe() -> Result<(OwnedHandle, OwnedHandle)> {
        let (mut read, mut write): (HANDLE, HANDLE) = (std::ptr::null_mut(), std::ptr::null_mut());
        let ok = unsafe { CreatePipe(&mut read, &mut write, &security(false), 0) } != 0;
        let read = owned(read, ok)?;
        let write = owned(write, ok)?;
        Ok((read, write))
    }

    fn inheritable(handle: &OwnedHandle) -> Result<()> {
        let ok = unsafe {
            SetHandleInformation(
                handle.as_raw_handle(),
                HANDLE_FLAG_INHERIT,
                HANDLE_FLAG_INHERIT,
            )
        };
        if ok == 0 {
            return Err(last_error());
        }
        Ok(())
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// One argument as the Microsoft C runtime splits a command line back into `argv`.
    fn quote(argument: &str, line: &mut String) {
        if !argument.is_empty() && !argument.contains([' ', '\t', '\n', '\x0b', '"']) {
            line.push_str(argument);
            return;
        }
        line.push('"');
        let mut backslashes = 0;
        for character in argument.chars() {
            if character == '\\' {
                backslashes += 1;
                continue;
            }
            let escapes = if character == '"' {
                backslashes * 2 + 1
            } else {
                backslashes
            };
            line.extend(std::iter::repeat_n('\\', escapes));
            backslashes = 0;
            line.push(character);
        }
        line.extend(std::iter::repeat_n('\\', backslashes * 2));
        line.push('"');
    }

    pub(crate) fn command_line(executable: &str, args: &[String]) -> String {
        let mut line = format!("\"{executable}\"");
        for argument in args {
            line.push(' ');
            quote(argument, &mut line);
        }
        line
    }

    /// The Microsoft C runtime's inherited descriptor table (`STARTUPINFO.lpReserved2`): a
    /// count, a flag byte per descriptor, then a handle per descriptor. Chromium's runtime reads
    /// it at startup, so the handles become its descriptors 0 to 4, as Node's `stdio` array
    /// gives them to Playwright's Chromium.
    fn descriptor_table(handles: &[(HANDLE, u8)]) -> Vec<u8> {
        let mut table = Vec::new();
        table.extend_from_slice(&(handles.len() as i32).to_ne_bytes());
        table.extend(handles.iter().map(|(_, flags)| *flags));
        for (handle, _) in handles {
            table.extend_from_slice(&(*handle as usize).to_ne_bytes());
        }
        table
    }

    /// The C runtime's descriptor flags: open, a pipe, a character device.
    const FOPEN: u8 = 0x01;
    const FPIPE: u8 = 0x08;
    const FDEV: u8 = 0x40;

    /// Start `executable` with `args`, the null device for its standard streams and a CDP pipe
    /// on descriptors 3 (commands to it) and 4 (its replies), in a job of its own. Returns the
    /// process and the host's ends: the one to write commands to and the one to read replies from.
    pub fn spawn_with_pipes(
        executable: &str,
        args: &[String],
    ) -> Result<(Child, std::fs::File, std::fs::File)> {
        let (child_read, host_write) = pipe()?;
        let (host_read, child_write) = pipe()?;
        inheritable(&child_read)?;
        inheritable(&child_write)?;
        let null_name = wide("NUL");
        let null = unsafe {
            CreateFileW(
                null_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &security(true),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        let null = owned(null, true).context("opening the null device")?;
        let (null_raw, read_raw, write_raw) = (
            null.as_raw_handle(),
            child_read.as_raw_handle(),
            child_write.as_raw_handle(),
        );
        let mut table = descriptor_table(&[
            (null_raw, FOPEN | FDEV),
            (null_raw, FOPEN | FDEV),
            (null_raw, FOPEN | FDEV),
            (read_raw, FOPEN | FPIPE),
            (write_raw, FOPEN | FPIPE),
        ]);
        // Only these handles reach the child, whatever else is inheritable in the host.
        let inherited: [HANDLE; 3] = [null_raw, read_raw, write_raw];
        let mut size = 0usize;
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size) };
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let attributes: LPPROC_THREAD_ATTRIBUTE_LIST = storage.as_mut_ptr().cast();
        if unsafe { InitializeProcThreadAttributeList(attributes, 1, 0, &mut size) } == 0 {
            return Err(last_error());
        }
        struct Attributes(LPPROC_THREAD_ATTRIBUTE_LIST);
        impl Drop for Attributes {
            fn drop(&mut self) {
                unsafe { DeleteProcThreadAttributeList(self.0) };
            }
        }
        let attributes = Attributes(attributes);
        let updated = unsafe {
            UpdateProcThreadAttribute(
                attributes.0,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                inherited.as_ptr().cast::<c_void>(),
                size_of_val(&inherited),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if updated == 0 {
            return Err(last_error());
        }
        let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = null_raw;
        startup.StartupInfo.hStdOutput = null_raw;
        startup.StartupInfo.hStdError = null_raw;
        startup.StartupInfo.cbReserved2 = table.len() as u16;
        startup.StartupInfo.lpReserved2 = table.as_mut_ptr();
        startup.lpAttributeList = attributes.0;

        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        let job = owned(job, true).context("creating the browser's job")?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let limited = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast::<c_void>(),
                size_of_val(&limits) as u32,
            )
        };
        if limited == 0 {
            return Err(last_error()).context("limiting the browser's job");
        }

        let mut line = wide(&command_line(executable, args));
        let mut information: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let created = unsafe {
            CreateProcessW(
                std::ptr::null(),
                line.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                CREATE_SUSPENDED
                    | CREATE_NO_WINDOW
                    | CREATE_UNICODE_ENVIRONMENT
                    | EXTENDED_STARTUPINFO_PRESENT,
                std::ptr::null(),
                std::ptr::null(),
                &startup.StartupInfo,
                &mut information,
            )
        };
        if created == 0 {
            return Err(last_error()).with_context(|| format!("launching {executable}"));
        }
        let process = unsafe { OwnedHandle::from_raw_handle(information.hProcess) };
        let thread = unsafe { OwnedHandle::from_raw_handle(information.hThread) };
        // In the job before it runs, so everything it starts is in the job too.
        if unsafe { AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) } == 0 {
            let error = last_error();
            unsafe { TerminateProcess(process.as_raw_handle(), 1) };
            return Err(error).context("placing the browser in its job");
        }
        if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
            let error = last_error();
            unsafe { TerminateJobObject(job.as_raw_handle(), 1) };
            return Err(error).context("starting the browser");
        }
        // The child's ends close here, so a reply read ends when the browser does.
        drop((thread, child_read, child_write, null, attributes, storage));
        Ok((
            Child {
                process,
                job,
                pid: information.dwProcessId,
            },
            std::fs::File::from(host_write),
            std::fs::File::from(host_read),
        ))
    }

    #[cfg(test)]
    mod tests {
        use super::command_line;

        #[test]
        fn arguments_survive_the_c_runtime_split() {
            let args = [
                "--plain".to_string(),
                "--user-data-dir=C:\\Users\\a b\\profile".to_string(),
                String::new(),
                "say \"hi\"".to_string(),
                "trailing\\".to_string(),
                "trailing space\\".to_string(),
            ];
            assert_eq!(
                command_line("C:\\chrome.exe", &args),
                "\"C:\\chrome.exe\" --plain \"--user-data-dir=C:\\Users\\a b\\profile\" \"\" \"say \\\"hi\\\"\" trailing\\ \"trailing space\\\\\""
            );
        }
    }
}
