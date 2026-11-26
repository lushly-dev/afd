//! The container runtime, behind a trait: the Docker or Podman command line on a host, and a fake
//! for tests.
//!
//! The host labels everything it makes with [`LABEL`], so it counts and later removes only that,
//! and never touches anything else on a shared runtime.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The most of a runtime's output the host reads from one call: its answers are a version and
/// one id per line.
const MAX_OUTPUT_BYTES: u64 = 1 << 20;

/// The label on every container and volume the host makes.
pub const LABEL: &str = "dev.lushly.loam-os";

/// Why the runtime did not answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    /// What happened, in a sentence.
    pub message: String,
}

impl RuntimeError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// What the host has made on the runtime: containers and volumes carrying [`LABEL`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Labelled {
    /// Labelled containers, running or not.
    pub containers: u64,
    /// Labelled volumes.
    pub volumes: u64,
}

/// A container runtime the host drives.
pub trait Runtime: Send + Sync {
    /// The runtime's kind, as `host-status` names it.
    fn kind(&self) -> &str;

    /// The runtime's server version.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it does not answer.
    fn version(&self) -> Result<String, RuntimeError>;

    /// What carries the host's label.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it does not answer.
    fn labelled(&self) -> Result<Labelled, RuntimeError>;
}

/// The Docker or Podman command line.
#[derive(Debug, Clone)]
pub struct CliRuntime {
    kind: String,
    program: String,
    timeout: Duration,
}

impl CliRuntime {
    /// Drive `program` as a runtime of `kind`, each call bounded by `timeout`.
    pub fn new(kind: impl Into<String>, program: impl Into<String>, timeout: Duration) -> Self {
        Self {
            kind: kind.into(),
            program: program.into(),
            timeout,
        }
    }

    /// Run the program with `args`, and its standard output when it exits 0 within the timeout.
    fn run(&self, args: &[&str]) -> Result<String, RuntimeError> {
        let mut child = Command::new(&self.program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                RuntimeError::new(format!("cannot start `{}`: {error}", self.program))
            })?;
        // Read both pipes on threads, so a full pipe never stalls the child past its timeout.
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        // Bounded, and read as bytes so a localized, non-UTF-8 message is kept, not lost.
        let out = std::thread::spawn(move || read_bounded(stdout.as_mut()));
        let err = std::thread::spawn(move || read_bounded(stderr.as_mut()));
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                // Only the program itself is killed: `docker` and `podman` start no child that
                // outlives them, but a wrapper script set as `runtime.command` could, and its
                // children would keep running, holding the reader threads, until they exit.
                Ok(None) if started.elapsed() >= self.timeout => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RuntimeError::new(format!(
                        "`{} {}` did not answer within {} ms",
                        self.program,
                        args.join(" "),
                        self.timeout.as_millis()
                    )));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RuntimeError::new(format!(
                        "cannot wait for `{}`: {error}",
                        self.program
                    )));
                }
            }
        };
        let stdout = out.join().unwrap_or_default();
        let stderr = err.join().unwrap_or_default();
        if status.success() {
            Ok(stdout)
        } else {
            let first = stderr
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("");
            Err(RuntimeError::new(format!(
                "`{} {}` exited with {status}: {}",
                self.program,
                args.join(" "),
                first.trim()
            )))
        }
    }

    fn count(&self, args: &[&str]) -> Result<u64, RuntimeError> {
        let out = self.run(args)?;
        Ok(out.lines().filter(|line| !line.trim().is_empty()).count() as u64)
    }
}

impl Runtime for CliRuntime {
    fn kind(&self) -> &str {
        &self.kind
    }

    fn version(&self) -> Result<String, RuntimeError> {
        // Docker's server version, so a stopped daemon is unreachable rather than masked by the
        // client's. Podman without a service has no server: its client is the runtime.
        let template = if self.kind == "podman" {
            "{{if .Server}}{{.Server.Version}}{{else}}{{.Client.Version}}{{end}}"
        } else {
            "{{.Server.Version}}"
        };
        let out = self.run(&["version", "--format", template])?;
        let version = out.trim();
        if version.is_empty() {
            return Err(RuntimeError::new(format!(
                "`{} version` named no server version",
                self.program
            )));
        }
        Ok(version.to_owned())
    }

    fn labelled(&self) -> Result<Labelled, RuntimeError> {
        let filter = format!("label={LABEL}");
        Ok(Labelled {
            containers: self.count(&["ps", "--all", "--quiet", "--filter", &filter])?,
            volumes: self.count(&["volume", "ls", "--quiet", "--filter", &filter])?,
        })
    }
}

/// Read at most [`MAX_OUTPUT_BYTES`] of `pipe`, lossily as UTF-8.
fn read_bounded(pipe: Option<&mut impl Read>) -> String {
    let mut bytes = Vec::new();
    if let Some(pipe) = pipe {
        let _ = pipe.take(MAX_OUTPUT_BYTES).read_to_end(&mut bytes);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// A runtime for tests: answers what it is told, or that it cannot be reached.
#[derive(Debug, Default)]
pub struct FakeRuntime {
    state: Mutex<FakeState>,
}

#[derive(Debug, Clone, Default)]
struct FakeState {
    version: Option<String>,
    labelled: Labelled,
    labelled_error: Option<String>,
}

impl FakeRuntime {
    /// A reachable fake runtime with server version `version` and nothing labelled.
    pub fn reachable(version: impl Into<String>) -> Self {
        Self {
            state: Mutex::new(FakeState {
                version: Some(version.into()),
                labelled: Labelled::default(),
                labelled_error: None,
            }),
        }
    }

    /// A fake runtime that cannot be reached.
    pub fn unreachable() -> Self {
        Self::default()
    }

    /// Set what carries the label.
    pub fn set_labelled(&self, labelled: Labelled) {
        if let Ok(mut state) = self.state.lock() {
            state.labelled = labelled;
        }
    }

    /// Make the label queries fail with `message` while the version still answers, or answer
    /// again with `None`.
    pub fn set_labelled_error(&self, message: Option<&str>) {
        if let Ok(mut state) = self.state.lock() {
            state.labelled_error = message.map(str::to_owned);
        }
    }

    /// Make it reachable with `version`, or unreachable with `None`.
    pub fn set_version(&self, version: Option<&str>) {
        if let Ok(mut state) = self.state.lock() {
            state.version = version.map(str::to_owned);
        }
    }

    fn snapshot(&self) -> FakeState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }
}

impl Runtime for FakeRuntime {
    fn kind(&self) -> &str {
        "fake"
    }

    fn version(&self) -> Result<String, RuntimeError> {
        self.snapshot()
            .version
            .ok_or_else(|| RuntimeError::new("the fake runtime is unreachable"))
    }

    fn labelled(&self) -> Result<Labelled, RuntimeError> {
        let state = self.snapshot();
        match (state.version, state.labelled_error) {
            (None, _) => Err(RuntimeError::new("the fake runtime is unreachable")),
            (Some(_), Some(message)) => Err(RuntimeError::new(message)),
            (Some(_), None) => Ok(state.labelled),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Held by every test that starts a program. On Linux a script written by one thread and
    /// run while another thread forks can fail with `ETXTBSY` (rust-lang/rust#114554), because
    /// the fork briefly inherits the open write handle; one test at a time avoids it.
    static SPAWN: Mutex<()> = Mutex::new(());

    fn spawning() -> std::sync::MutexGuard<'static, ()> {
        SPAWN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// A stand-in runtime program: a script that answers `version` and the label queries as a
    /// real runtime's command line would, written for the platform's shell.
    struct Script {
        _dir: tempfile::TempDir,
        path: std::path::PathBuf,
    }

    /// `body` runs for every call: a POSIX shell script on Unix, a batch file on Windows.
    fn script(unix: &str, windows: &str) -> Script {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("runtime");
            std::fs::write(
                &path,
                format!(
                    "#!/bin/sh
{unix}
"
                ),
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            let _ = windows;
            path
        };
        #[cfg(windows)]
        let path = {
            let path = dir.path().join("runtime.cmd");
            std::fs::write(
                &path,
                format!(
                    "@echo off
{windows}
"
                ),
            )
            .unwrap();
            let _ = unix;
            path
        };
        Script { _dir: dir, path }
    }

    fn runtime(script: &Script, timeout_ms: u64) -> CliRuntime {
        CliRuntime::new(
            "docker",
            script.path.to_string_lossy(),
            Duration::from_millis(timeout_ms),
        )
    }

    #[test]
    fn the_server_version_and_the_labelled_counts_come_from_the_program() {
        let _spawning = spawning();
        let script = script(
            r#"case "$1" in
  version) echo "29.9.3" ;;
  ps) printf 'a1
b2

' ;;
  volume) printf 'v1
v2
v3
' ;;
esac"#,
            "if \"%1\"==\"version\" echo 29.9.3
if \"%1\"==\"ps\" (echo a1& echo b2)
if \"%1\"==\"volume\" (echo v1& echo v2& echo v3)",
        );
        let runtime = runtime(&script, 5000);
        assert_eq!(runtime.version().unwrap(), "29.9.3");
        assert_eq!(
            runtime.labelled().unwrap(),
            Labelled {
                containers: 2,
                volumes: 3
            }
        );
    }

    #[test]
    fn a_blank_version_is_refused() {
        let _spawning = spawning();
        let script = script("echo", "echo.");
        let error = runtime(&script, 5000).version().unwrap_err();
        assert!(error.message.contains("named no server version"), "{error}");
    }

    #[test]
    fn a_failing_program_gives_its_exit_and_first_error_line() {
        let _spawning = spawning();
        let script = script(
            "echo 'Cannot connect to the Docker daemon' >&2; exit 3",
            "echo Cannot connect to the Docker daemon 1>&2
exit /b 3",
        );
        let error = runtime(&script, 5000).version().unwrap_err();
        assert!(error.message.contains("exited with"), "{error}");
        assert!(
            error
                .message
                .contains("Cannot connect to the Docker daemon"),
            "{error}"
        );
    }

    #[test]
    fn a_program_that_hangs_is_killed_at_the_timeout() {
        let _spawning = spawning();
        let script = script("sleep 30", "ping -n 30 127.0.0.1 >nul");
        let started = Instant::now();
        let error = runtime(&script, 300).version().unwrap_err();
        assert!(
            error.message.contains("did not answer within 300 ms"),
            "{error}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_missing_program_is_an_unreachable_runtime() {
        let _spawning = spawning();
        let runtime = CliRuntime::new(
            "docker",
            "loam-os-no-such-runtime-program",
            Duration::from_secs(5),
        );
        let error = runtime.version().unwrap_err();
        assert!(error.message.starts_with("cannot start"), "{error}");
        assert!(runtime.labelled().is_err());
    }

    #[test]
    fn the_fake_answers_what_it_is_told() {
        let fake = FakeRuntime::reachable("1.0");
        assert_eq!(fake.version().unwrap(), "1.0");
        fake.set_version(None);
        assert!(fake.version().is_err());
        assert!(fake.labelled().is_err());
    }
}
