//! Driving the built `umbel` binary: a child that is killed when the handle drops, so a failing
//! test leaks neither a server nor a port.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

/// How long a test waits for a line or an exit before it fails.
pub const WAIT: Duration = Duration::from_secs(30);

/// A running `umbel` with its stdout and stderr read line by line on threads.
pub struct Process {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<String>,
    stderr: Receiver<String>,
}

/// `umbel` with the host's environment scrubbed of everything that could redirect it.
pub fn command(cwd: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_umbel"));
    command
        .args(args)
        .current_dir(cwd)
        .env_remove("UMBEL_WORKSPACE")
        .env_remove("UMBEL_LOG")
        .env_remove("UMBEL_HTTP_BIND");
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command
}

fn lines<R: std::io::Read + Send + 'static>(reader: R) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    receiver
}

impl Process {
    pub fn spawn(cwd: &Path, args: &[&str]) -> Self {
        let mut child = command(cwd, args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout = lines(child.stdout.take().unwrap());
        let stderr = lines(child.stderr.take().unwrap());
        Self {
            child,
            stdin,
            stdout,
            stderr,
        }
    }

    pub fn id(&self) -> u32 {
        self.child.id()
    }

    /// Write one line to stdin.
    pub fn send_line(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().expect("stdin is open");
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
    }

    /// Close stdin, which ends a stdio server.
    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    pub fn stdout_line(&self) -> String {
        self.stdout
            .recv_timeout(WAIT)
            .unwrap_or_else(|error| panic!("no stdout line: {error}"))
    }

    pub fn stderr_line(&self) -> String {
        self.stderr
            .recv_timeout(WAIT)
            .unwrap_or_else(|error| panic!("no stderr line: {error}"))
    }

    /// Every line of stdout so far, once the process has ended.
    pub fn rest_of_stdout(&self) -> Vec<String> {
        self.stdout.try_iter().collect()
    }

    pub fn rest_of_stderr(&self) -> Vec<String> {
        self.stderr.try_iter().collect()
    }

    /// Wait for the process to exit and return its code (`None` when a signal ended it).
    pub fn wait(&mut self) -> Option<i32> {
        let deadline = Instant::now() + WAIT;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                // Let the reader threads drain the pipes.
                let _ = self.stdout.recv_timeout(Duration::from_millis(0));
                return status.code();
            }
            assert!(Instant::now() < deadline, "the process did not exit");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Send SIGINT (Unix).
    #[cfg(unix)]
    pub fn interrupt(&self) {
        let status = Command::new("kill")
            .args(["-INT", &self.child.id().to_string()])
            .status()
            .unwrap();
        assert!(status.success());
    }

    /// Everything the process printed, once it has exited: its code, stdout and stderr lines.
    pub fn finish(mut self) -> (Option<i32>, Vec<String>, Vec<String>) {
        self.close_stdin();
        let code = self.wait();
        // The reader threads end at EOF; give them the last lines.
        let mut out = Vec::new();
        let mut err = Vec::new();
        while let Ok(line) = self.stdout.recv_timeout(Duration::from_millis(200)) {
            out.push(line);
        }
        while let Ok(line) = self.stderr.recv_timeout(Duration::from_millis(200)) {
            err.push(line);
        }
        (code, out, err)
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The `JSON` of a line, which must parse.
pub fn json(line: &str) -> Value {
    serde_json::from_str(line).unwrap_or_else(|error| panic!("not JSON ({error}): {line}"))
}

/// Minimal HTTP/1.1 over a TCP socket, with `Connection: close`: enough to drive the served
/// endpoint without an HTTP client dependency.
pub fn http(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> (u16, String) {
    use std::io::Read;
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(WAIT)).unwrap();
    let mut request =
        format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    for (name, value) in headers {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(body) = body {
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("\r\n");
    if let Some(body) = body {
        request.push_str(body);
    }
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    let status = response
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let body = response
        .split_once("\r\n\r\n")
        .map_or(String::new(), |(_, body)| body.to_owned());
    (status, body)
}

/// The port in `umbel listening on http://127.0.0.1:<port>/mcp (token in ...)`.
pub fn listening_port(line: &str) -> u16 {
    let rest = line
        .strip_prefix("umbel listening on http://")
        .unwrap_or_else(|| panic!("not the listening line: {line}"));
    let address = rest.split_once('/').unwrap().0;
    address.rsplit_once(':').unwrap().1.parse().unwrap()
}
