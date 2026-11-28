//! The container runtime, behind a trait: the Docker or Podman command line on a host. The fake
//! the tests drive lives in the unit's test tree, so the shipped binary has none.
//!
//! The host labels everything it makes with [`LABEL`], whose value is the machine's id, so it
//! counts and later removes only that, and never touches anything else on a shared runtime.
//!
//! Every value a caller gave (a step's arguments and environment) reaches the runtime's program
//! as an argument of its own, never through a shell. Everything else the host passes is the
//! operator's configuration or the host's own names.

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// The most of a runtime's output the host reads from one call: its answers are a version, one
/// name per line, or one JSON document of disk use.
const MAX_OUTPUT_BYTES: u64 = 4 << 20;

/// The least time `disk` gets: `system df` reads every image, container and volume, and took
/// 23.5 s cold and 6.3 s warm on Hero's Docker 29.9.3 (2026-11-27), past the 5 s default.
const DISK_TIMEOUT: Duration = Duration::from_secs(120);

/// The shared memory a machine gets: Chromium needs more than the runtime's 64 MB default (the
/// image runbook, docs/operations/loam-os-image.md).
const SHM_SIZE: &str = "2g";

/// What the runtime's standard error says when the object it was asked about does not exist:
/// Docker's "No such container", "No such object" and "no such volume", and Podman's "no
/// container with name or ID". Never a bare "no such", which a missing program or socket
/// ("No such file or directory") also says.
const MISSING: [&str; 4] = [
    "no such container",
    "no such object",
    "no such volume",
    "no container with name or id",
];

/// The label on every container and volume the host makes; its value is the machine's id.
pub const LABEL: &str = "dev.lushly.loam-os";

/// A machine's mounts, in the order the host makes them: the checkout, build output kept while
/// the machine lives, and package caches (the proposal's [A machine]).
///
/// [A machine]: ../../docs/features/active/loam-os/loam-os.proposal.md#a-machine
pub const MOUNTS: [&str; 3] = ["work", "build", "downloads"];

/// The name of a machine's container.
pub fn container_name(machine: &str) -> String {
    format!("loam-os-{machine}")
}

/// The name of one of a machine's volumes.
pub fn volume_name(machine: &str, mount: &str) -> String {
    format!("loam-os-{machine}-{mount}")
}

/// Why the runtime did not do what it was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeError {
    /// What happened, in a sentence.
    pub message: String,
    /// Whether the runtime answered that the object it was asked about does not exist.
    missing: bool,
}

impl RuntimeError {
    /// An error saying `message`.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            missing: false,
        }
    }

    /// Whether the runtime ran and answered that the object it was asked about does not exist,
    /// as opposed to not answering at all.
    pub fn is_missing(&self) -> bool {
        self.missing
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RuntimeError {}

/// What carries the host's label, by name, each list sorted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Labelled {
    /// Labelled containers, running or not.
    pub containers: Vec<String>,
    /// Labelled volumes.
    pub volumes: Vec<String>,
}

/// One volume mounted in a container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mount {
    /// The volume's name.
    pub volume: String,
    /// Where it is mounted, an absolute path inside the container.
    pub target: String,
}

/// A machine's container, as the host asks for it. There is no field for a host path, a device,
/// a privilege, the host's network or an environment variable to pass through: those controls
/// are the absence of a field (the proposal's job 02).
#[derive(Debug, Clone, PartialEq)]
pub struct ContainerSpec {
    /// The container's name ([`container_name`]).
    pub name: String,
    /// The machine's id, the value of its [`LABEL`].
    pub machine: String,
    /// The image, by digest (`<name>@sha256:<hex>`).
    pub image: String,
    /// Processors.
    pub cpus: f64,
    /// Memory, which is also the memory and swap together, so the machine cannot swap past it.
    pub memory_gb: f64,
    /// The volumes, each the host made for this machine.
    pub mounts: Vec<Mount>,
    /// The user steps run as, when not the image's own.
    pub user: Option<String>,
}

/// One step to run in a machine: an argument list, never a shell line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepSpec {
    /// The program and its arguments.
    pub args: Vec<String>,
    /// Environment added for this step only.
    pub env: BTreeMap<String, String>,
    /// The working directory inside the container, when not the image's own.
    pub workdir: Option<String>,
    /// How long the step may run before its processes are killed.
    pub timeout: Duration,
}

/// How a step ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepExit {
    /// The exit code, `None` when the step was killed at its timeout or by a signal.
    pub code: Option<i32>,
    /// Whether the step ran past its timeout.
    pub timed_out: bool,
    /// How long it ran.
    pub duration: Duration,
    /// Why its processes could not be stopped at its timeout, when they could not: the step may
    /// still be running.
    pub stop_error: Option<String>,
}

/// What a machine uses now, as the runtime reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Usage {
    /// Memory in use, in bytes.
    pub memory_bytes: u64,
    /// Processor use, in percent of one processor.
    pub cpu_percent: f64,
}

/// The disk what carries the host's label uses, by name, in bytes: each volume, and each
/// container's writable layer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Disk {
    /// Labelled volumes.
    pub volumes: BTreeMap<String, u64>,
    /// Labelled containers' writable layers.
    pub containers: BTreeMap<String, u64>,
}

impl Disk {
    /// Everything counted, in bytes.
    pub fn total(&self) -> u64 {
        self.volumes.values().chain(self.containers.values()).sum()
    }
}

/// A container runtime the host drives.
///
/// Every method blocks until the runtime answers, bounded by the runtime's own timeout, except
/// [`Self::run_step`], which is bounded by the step's.
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

    /// Make the volume `name`, labelled for `machine`.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it was not made.
    fn create_volume(&self, name: &str, machine: &str) -> Result<(), RuntimeError>;

    /// Make the container `spec` names, labelled for its machine, and start it idle: it runs
    /// nothing until a step is run in it.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it was not made or did not start.
    fn create_container(&self, spec: &ContainerSpec) -> Result<(), RuntimeError>;

    /// Remove the container `name` with everything running in it. `false` when the runtime
    /// answered that there was none.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it is still there.
    fn remove_container(&self, name: &str) -> Result<bool, RuntimeError>;

    /// Remove the volume `name`. `false` when the runtime answered that there was none.
    ///
    /// # Errors
    /// A [`RuntimeError`] when it is still there.
    fn remove_volume(&self, name: &str) -> Result<bool, RuntimeError>;

    /// Run `step` in the container `container`, appending what it writes (standard output and
    /// standard error together) to the file `log`, and stop its processes at its timeout.
    ///
    /// # Errors
    /// A [`RuntimeError`] when the step could not be started or waited for, or its log could not
    /// be opened. A step that runs and fails is an `Ok` with its code.
    fn run_step(
        &self,
        container: &str,
        step: &StepSpec,
        log: &Path,
    ) -> Result<StepExit, RuntimeError>;

    /// Kill every process a step started in the container, from outside: the code is not asked
    /// to stop. The container and its volumes stay.
    ///
    /// # Errors
    /// A [`RuntimeError`] when the runtime did not do it.
    fn stop_steps(&self, container: &str) -> Result<(), RuntimeError>;

    /// What the container uses now.
    ///
    /// # Errors
    /// A [`RuntimeError`] when the runtime does not answer.
    fn usage(&self, container: &str) -> Result<Usage, RuntimeError>;

    /// The disk what carries the host's label uses.
    ///
    /// # Errors
    /// A [`RuntimeError`] when the runtime does not answer.
    fn disk(&self) -> Result<Disk, RuntimeError>;
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

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.program);
        command.args(args).stdin(Stdio::null());
        command
    }

    fn describe(&self, args: &[&str]) -> String {
        format!("`{} {}`", self.program, args.join(" "))
    }

    /// Run the program with `args`, and its standard output when it exits 0 within the timeout.
    fn run(&self, args: &[&str]) -> Result<String, RuntimeError> {
        self.run_for(args, self.timeout)
    }

    /// [`Self::run`], bounded by `timeout` instead of the runtime's own.
    fn run_for(&self, args: &[&str], timeout: Duration) -> Result<String, RuntimeError> {
        let mut child = self
            .command(args)
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
        let status = match wait(&mut child, timeout) {
            Ok(Some(status)) => status,
            Ok(None) => {
                return Err(RuntimeError::new(format!(
                    "{} did not answer within {} ms",
                    self.describe(args),
                    timeout.as_millis()
                )));
            }
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "cannot wait for `{}`: {error}",
                    self.program
                )));
            }
        };
        let stdout = out.join().unwrap_or_default();
        let stderr = err.join().unwrap_or_default();
        if status.success() {
            Ok(stdout)
        } else {
            // The line that names the error, past any warning before it ("Flag --time has been
            // deprecated", "WARNING: ..."), with or without the program's own prefix
            // ("docker: Error response from daemon"), or else the first that says anything.
            let lines: Vec<&str> = stderr
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect();
            let first = lines
                .iter()
                .find(|line| {
                    let line = line.to_ascii_lowercase();
                    line.starts_with("error")
                        || line
                            .split_once(": ")
                            .is_some_and(|(_, rest)| rest.starts_with("error"))
                })
                .or_else(|| lines.first())
                .copied()
                .unwrap_or("");
            let lower = stderr.to_ascii_lowercase();
            Err(RuntimeError {
                message: format!("{} exited with {status}: {first}", self.describe(args)),
                missing: MISSING.iter().any(|phrase| lower.contains(phrase)),
            })
        }
    }

    fn names(&self, args: &[&str]) -> Result<Vec<String>, RuntimeError> {
        let out = self.run(args)?;
        let mut names: Vec<String> = out
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        names.sort();
        Ok(names)
    }

    /// `rm`-like: `Ok(true)` when removed, `Ok(false)` when the runtime answered that there was
    /// none.
    fn remove(&self, args: &[&str]) -> Result<bool, RuntimeError> {
        match self.run(args) {
            Ok(_) => Ok(true),
            Err(error) if error.is_missing() => Ok(false),
            Err(error) => Err(error),
        }
    }
}

/// Wait for `child` until `timeout`; `None` when it was still running and has been killed.
///
/// Only the program itself is killed: `docker` and `podman` start no child that outlives them,
/// but a wrapper script set as `runtime.command` could, and its children would keep running
/// until they exit.
fn wait(child: &mut Child, timeout: Duration) -> std::io::Result<Option<ExitStatus>> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
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
            containers: self.names(&[
                "ps",
                "--all",
                "--filter",
                &filter,
                "--format",
                "{{.Names}}",
            ])?,
            volumes: self.names(&["volume", "ls", "--filter", &filter, "--format", "{{.Name}}"])?,
        })
    }

    fn create_volume(&self, name: &str, machine: &str) -> Result<(), RuntimeError> {
        let label = format!("{LABEL}={machine}");
        self.run(&["volume", "create", "--label", &label, name])
            .map(drop)
    }

    fn create_container(&self, spec: &ContainerSpec) -> Result<(), RuntimeError> {
        let label = format!("{LABEL}={}", spec.machine);
        let cpus = format!("{}", spec.cpus);
        // In whole mebibytes, so a fractional size is honoured and the runtime parses it.
        let memory = format!("{}m", mebibytes(spec.memory_gb));
        let mounts: Vec<String> = spec
            .mounts
            .iter()
            .map(|mount| {
                format!(
                    "type=volume,source={},target={}",
                    mount.volume, mount.target
                )
            })
            .collect();
        let mut args: Vec<&str> = vec![
            "run",
            "--detach",
            "--name",
            &spec.name,
            "--label",
            &label,
            // No network until a step's policy gives it one through the host's proxy (step 6).
            "--network",
            "none",
            "--cpus",
            &cpus,
            "--memory",
            &memory,
            "--memory-swap",
            &memory,
            // No core file, so a branch's crashing test cannot block its own verify record.
            "--ulimit",
            "core=0",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            // A first process that reaps orphans, so a run's leftover children do not pile up as
            // zombies under `sleep`.
            "--init",
            "--shm-size",
            SHM_SIZE,
            // The image is pinned and present, or the operator has not prepared it: never a pull
            // inside the runtime's call timeout, which would leave a half-made container.
            "--pull",
            "never",
        ];
        if let Some(user) = &spec.user {
            args.extend(["--user", user]);
        }
        for mount in &mounts {
            args.extend(["--mount", mount]);
        }
        // Idle until a step runs: its first process only waits.
        args.extend(["--entrypoint", "sleep", &spec.image, "infinity"]);
        self.run(&args).map(drop)
    }

    fn remove_container(&self, name: &str) -> Result<bool, RuntimeError> {
        // `rm --force` exits 0 for a name that does not exist (Docker 29.9.3, 2026-11-27), so ask
        // first: a missing one is answered "No such object".
        match self.run(&["container", "inspect", "--format", "{{.Id}}", name]) {
            Ok(_) => self.remove(&["rm", "--force", name]),
            Err(error) if error.is_missing() => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn remove_volume(&self, name: &str) -> Result<bool, RuntimeError> {
        self.remove(&["volume", "rm", name])
    }

    fn run_step(
        &self,
        container: &str,
        step: &StepSpec,
        log: &Path,
    ) -> Result<StepExit, RuntimeError> {
        let Some((program, rest)) = step.args.split_first() else {
            return Err(RuntimeError::new("a step names no program"));
        };
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .map_err(|error| {
                RuntimeError::new(format!(
                    "cannot open the step's log {}: {error}",
                    log.display()
                ))
            })?;
        let copy = file.try_clone().map_err(|error| {
            RuntimeError::new(format!(
                "cannot open the step's log {}: {error}",
                log.display()
            ))
        })?;
        let env: Vec<String> = step
            .env
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect();
        let mut args: Vec<&str> = vec!["exec"];
        for pair in &env {
            args.extend(["--env", pair]);
        }
        if let Some(workdir) = &step.workdir {
            args.extend(["--workdir", workdir]);
        }
        args.push(container);
        args.push(program);
        args.extend(rest.iter().map(String::as_str));
        // The log is a file the runtime's program writes straight into: no pipe to drain, so a
        // step that writes gigabytes costs the host disk, not memory.
        let started = Instant::now();
        let mut child = self
            .command(&args)
            .stdout(Stdio::from(copy))
            .stderr(Stdio::from(file))
            .spawn()
            .map_err(|error| {
                RuntimeError::new(format!("cannot start `{}`: {error}", self.program))
            })?;
        match wait(&mut child, step.timeout) {
            Ok(Some(status)) => Ok(StepExit {
                code: status.code(),
                timed_out: false,
                duration: started.elapsed(),
                stop_error: None,
            }),
            Ok(None) => {
                // Killing `exec` leaves the step's processes running in the container. A stop that
                // fails is reported beside the timeout, never instead of it.
                let stop_error = self.stop_steps(container).err().map(|error| error.message);
                Ok(StepExit {
                    code: None,
                    timed_out: true,
                    duration: started.elapsed(),
                    stop_error,
                })
            }
            Err(error) => Err(RuntimeError::new(format!(
                "cannot wait for `{}`: {error}",
                self.program
            ))),
        }
    }

    fn stop_steps(&self, container: &str) -> Result<(), RuntimeError> {
        // Restarting with no grace kills the container's first process, and with it every
        // process in its namespace; the container comes back idle with its volumes.
        // `-t`: Docker 29 deprecates `--time` for `--timeout`, Podman keeps `--time`, and both
        // take `-t`.
        self.run(&["restart", "-t", "0", container]).map(drop)
    }

    fn usage(&self, container: &str) -> Result<Usage, RuntimeError> {
        let out = self.run(&[
            "stats",
            "--no-stream",
            "--format",
            "{{.MemUsage}}|{{.CPUPerc}}",
            container,
        ])?;
        parse_usage(&out).ok_or_else(|| {
            RuntimeError::new(format!(
                "`{} stats` gave a usage the host cannot read: {}",
                self.program,
                out.trim()
            ))
        })
    }

    /// Docker's `system df`, with a timeout of its own ([`DISK_TIMEOUT`]). Podman's form of it is
    /// untried, and may refuse `--verbose` with `--format`. M1 step 5 measures disk inside the
    /// runtime's virtual machine instead, where the host's limit is enforced.
    fn disk(&self) -> Result<Disk, RuntimeError> {
        let out = self.run_for(
            &["system", "df", "--verbose", "--format", "json"],
            self.timeout.max(DISK_TIMEOUT),
        )?;
        parse_disk(&out).map_err(|message| {
            RuntimeError::new(format!(
                "`{} system df` gave disk use the host cannot read: {message}",
                self.program
            ))
        })
    }
}

fn mebibytes(gb: f64) -> u64 {
    // The configuration bounds sizes far below u64's range, and a negative one is refused there.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let mib = (gb * 1024.0).round().max(1.0) as u64;
    mib
}

/// A size as the runtime prints it (`8.44GB`, `1.5GiB`, `0B`), in bytes. Docker's disk sizes are
/// decimal and its memory sizes binary; both are read.
pub fn parse_size(text: &str) -> Option<u64> {
    let text = text.trim();
    let split = text
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let number: f64 = number.parse().ok()?;
    let scale: f64 = match unit.trim() {
        "" | "B" => 1.0,
        "kB" | "KB" | "k" => 1e3,
        "MB" | "M" => 1e6,
        "GB" | "G" => 1e9,
        "TB" | "T" => 1e12,
        "KiB" => 1024.0,
        "MiB" => 1024.0 * 1024.0,
        "GiB" => 1024.0 * 1024.0 * 1024.0,
        "TiB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let bytes = (number * scale).round() as u64;
    Some(bytes)
}

/// `stats`' `<used> / <limit>|<cpu>%`.
fn parse_usage(out: &str) -> Option<Usage> {
    let line = out.lines().find(|line| !line.trim().is_empty())?;
    let (memory, cpu) = line.split_once('|')?;
    let used = memory.split('/').next()?;
    Some(Usage {
        memory_bytes: parse_size(used)?,
        cpu_percent: cpu.trim().trim_end_matches('%').trim().parse().ok()?,
    })
}

/// Whether a `Labels` field (`k=v,k=v`) carries [`LABEL`].
fn carries_label(labels: &str) -> bool {
    labels
        .split(',')
        .any(|pair| pair.split('=').next() == Some(LABEL))
}

/// `system df --verbose --format json`: the labelled volumes and containers' sizes.
fn parse_disk(out: &str) -> Result<Disk, String> {
    let document: serde_json::Value = serde_json::from_str(out.trim())
        .map_err(|error| format!("not one JSON document ({error})"))?;
    let mut disk = Disk::default();
    let entries = |key: &str| {
        document[key]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .to_vec()
    };
    for (key, name_key) in [("Volumes", "Name"), ("Containers", "Names")] {
        for entry in entries(key) {
            if !entry["Labels"].as_str().is_some_and(carries_label) {
                continue;
            }
            let name = entry[name_key]
                .as_str()
                .ok_or_else(|| format!("a labelled entry of {key} has no {name_key}"))?;
            let size = entry["Size"]
                .as_str()
                .and_then(parse_size)
                .ok_or_else(|| format!("{key} `{name}` has no size the host can read"))?;
            let into = if key == "Volumes" {
                &mut disk.volumes
            } else {
                &mut disk.containers
            };
            into.insert(name.to_owned(), size);
        }
    }
    Ok(disk)
}

/// Read at most [`MAX_OUTPUT_BYTES`] of `pipe`, lossily as UTF-8.
fn read_bounded(pipe: Option<&mut impl Read>) -> String {
    let mut bytes = Vec::new();
    if let Some(pipe) = pipe {
        let _ = pipe.take(MAX_OUTPUT_BYTES).read_to_end(&mut bytes);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Held by every test that starts a program. On Linux a script written by one thread and
    /// run while another thread forks can fail with `ETXTBSY` (rust-lang/rust#114554), because
    /// the fork briefly inherits the open write handle; one test at a time avoids it.
    static SPAWN: Mutex<()> = Mutex::new(());

    fn spawning() -> std::sync::MutexGuard<'static, ()> {
        SPAWN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// A stand-in runtime program: a script that answers as a real runtime's command line would,
    /// written for the platform's shell. Each call appends its arguments to `args.txt` beside it.
    struct Script {
        dir: tempfile::TempDir,
        path: std::path::PathBuf,
    }

    impl Script {
        /// The arguments of every call so far, one call per line. Quotes are dropped: Windows
        /// quotes an argument holding `=` or `,` on its way to a batch file.
        fn calls(&self) -> Vec<String> {
            std::fs::read_to_string(self.dir.path().join("args.txt"))
                .unwrap_or_default()
                .lines()
                .map(|line| line.replace('"', "").trim().to_owned())
                .collect()
        }
    }

    /// `unix` runs for every call as a POSIX shell script on Unix, `windows` as a batch file.
    fn script(unix: &str, windows: &str) -> Script {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        let path = {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("runtime");
            std::fs::write(
                &path,
                format!("#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/args.txt\"\n{unix}\n"),
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
                    "@echo off\r\necho %*>> \"%~dp0args.txt\"\r\n{}\r\n",
                    windows.replace('\n', "\r\n")
                ),
            )
            .unwrap();
            let _ = unix;
            path
        };
        Script { dir, path }
    }

    fn runtime(script: &Script, timeout_ms: u64) -> CliRuntime {
        CliRuntime::new(
            "docker",
            script.path.to_string_lossy(),
            Duration::from_millis(timeout_ms),
        )
    }

    fn step(args: &[&str], timeout_ms: u64) -> StepSpec {
        StepSpec {
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
            env: BTreeMap::from([("CI".to_owned(), "1".to_owned())]),
            workdir: Some("/work".to_owned()),
            timeout: Duration::from_millis(timeout_ms),
        }
    }

    #[test]
    fn the_server_version_and_the_labelled_names_come_from_the_program() {
        let _spawning = spawning();
        let script = script(
            r#"case "$1" in
  version) echo "29.9.3" ;;
  ps) printf 'loam-os-m-2\nloam-os-m-1\n\n' ;;
  volume) printf 'v1\nv2\nv3\n' ;;
esac"#,
            "if \"%1\"==\"version\" echo 29.9.3\nif \"%1\"==\"ps\" (echo loam-os-m-2& echo loam-os-m-1)\nif \"%1\"==\"volume\" (echo v1& echo v2& echo v3)",
        );
        let runtime = runtime(&script, 5000);
        assert_eq!(runtime.version().unwrap(), "29.9.3");
        assert_eq!(
            runtime.labelled().unwrap(),
            Labelled {
                containers: vec!["loam-os-m-1".to_owned(), "loam-os-m-2".to_owned()],
                volumes: vec!["v1".to_owned(), "v2".to_owned(), "v3".to_owned()],
            }
        );
        let calls = script.calls();
        assert!(
            calls.contains(&format!(
                "ps --all --filter label={LABEL} --format {{{{.Names}}}}"
            )),
            "{calls:?}"
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
            "echo Cannot connect to the Docker daemon 1>&2\nexit /b 3",
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
        let script = script("exec sleep 30", "ping -n 30 127.0.0.1 >nul");
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
    fn a_machine_is_made_labelled_idle_with_no_network_and_no_core_files() {
        let _spawning = spawning();
        let script = script("exit 0", "exit /b 0");
        let runtime = runtime(&script, 5000);
        runtime.create_volume("loam-os-m-1-work", "m-1").unwrap();
        runtime
            .create_container(&ContainerSpec {
                name: container_name("m-1"),
                machine: "m-1".to_owned(),
                image: "session@sha256:abc".to_owned(),
                cpus: 6.0,
                memory_gb: 16.0,
                mounts: vec![Mount {
                    volume: volume_name("m-1", "work"),
                    target: "/work".to_owned(),
                }],
                user: Some("1000:1000".to_owned()),
            })
            .unwrap();
        assert_eq!(
            script.calls(),
            vec![
                format!("volume create --label {LABEL}=m-1 loam-os-m-1-work"),
                format!(
                    "run --detach --name loam-os-m-1 --label {LABEL}=m-1 --network none --cpus 6 \
                     --memory 16384m --memory-swap 16384m --ulimit core=0 --cap-drop ALL \
                     --security-opt no-new-privileges --init --shm-size 2g --pull never \
                     --user 1000:1000 \
                     --mount type=volume,source=loam-os-m-1-work,target=/work \
                     --entrypoint sleep session@sha256:abc infinity"
                ),
            ]
        );
    }

    #[test]
    fn removing_what_is_not_there_is_false_and_any_other_failure_an_error() {
        let _spawning = spawning();
        // As Docker 29.9.3 answers (2026-11-27): `rm --force` of a missing name exits 0, so the
        // host asks with `container inspect` first, which answers "No such object".
        let script = script(
            r#"case "$1 $2" in
  "container inspect") case "$5" in gone) echo 'Error: No such object: gone' >&2; exit 1 ;; esac ;;
  "rm --force") case "$3" in stuck) echo 'Error response from daemon: device or resource busy' >&2; exit 1 ;; esac ;;
  "volume rm") case "$3" in
      gone) echo 'Error response from daemon: get gone: no such volume' >&2; exit 1 ;;
      odd) echo 'Cannot connect: dial unix /var/run/docker.sock: connect: No such file or directory' >&2; exit 1 ;;
    esac ;;
esac"#,
            "echo %*| findstr /r /c:\"inspect.*gone\" >nul\nif not errorlevel 1 (echo Error: No such object: gone 1>&2& exit /b 1)\necho %*| findstr /c:\"rm --force stuck\" >nul\nif not errorlevel 1 (echo Error response from daemon: device or resource busy 1>&2& exit /b 1)\necho %*| findstr /c:\"volume rm gone\" >nul\nif not errorlevel 1 (echo Error response from daemon: get gone: no such volume 1>&2& exit /b 1)\necho %*| findstr /c:\"volume rm odd\" >nul\nif not errorlevel 1 (echo Cannot connect: dial unix /var/run/docker.sock: connect: No such file or directory 1>&2& exit /b 1)",
        );
        let runtime = runtime(&script, 5000);
        assert!(runtime.remove_container("here").unwrap());
        assert!(!runtime.remove_container("gone").unwrap());
        assert!(runtime.remove_container("stuck").is_err());
        assert!(!runtime.remove_volume("gone").unwrap());
        // A runtime that cannot be reached is an error, never "there was none".
        let error = runtime.remove_volume("odd").unwrap_err();
        assert!(!error.is_missing(), "{error}");
        assert!(runtime.remove_volume("here").unwrap());
        assert_eq!(
            script.calls(),
            vec![
                "container inspect --format {{.Id}} here",
                "rm --force here",
                "container inspect --format {{.Id}} gone",
                "container inspect --format {{.Id}} stuck",
                "rm --force stuck",
                "volume rm gone",
                "volume rm odd",
                "volume rm here",
            ]
        );
        let unreachable = CliRuntime::new(
            "docker",
            "loam-os-no-such-runtime-program",
            Duration::from_secs(5),
        );
        assert!(unreachable.remove_container("gone").is_err());
        assert!(unreachable.remove_volume("gone").is_err());
    }

    #[test]
    fn a_stop_that_fails_names_the_error_past_a_warning_and_keeps_the_timeout() {
        let _spawning = spawning();
        let script = script(
            r#"case "$1" in
  exec) exec sleep 30 ;;
  restart) echo 'Flag --time has been deprecated, use --timeout instead' >&2; echo 'Error response from daemon: No such container: loam-os-m-1' >&2; exit 1 ;;
esac"#,
            "if \"%1\"==\"exec\" ping -n 30 127.0.0.1 >nul\nif \"%1\"==\"restart\" (echo Flag --time has been deprecated, use --timeout instead 1>&2& echo Error response from daemon: No such container: loam-os-m-1 1>&2& exit /b 1)",
        );
        let runtime = runtime(&script, 5000);
        let log = script.dir.path().join("validate.log");
        let exit = runtime
            .run_step("loam-os-m-1", &step(&["pnpm", "verify"], 300), &log)
            .unwrap();
        assert!(exit.timed_out);
        let stop = exit.stop_error.unwrap();
        assert!(
            stop.ends_with("Error response from daemon: No such container: loam-os-m-1"),
            "{stop}"
        );
    }

    #[test]
    fn a_step_runs_as_arguments_and_its_output_goes_to_the_log() {
        let _spawning = spawning();
        let script = script(
            r#"if [ "$1" = exec ]; then echo 'line one'; echo 'line two' >&2; exit 3; fi"#,
            "if \"%1\"==\"exec\" (echo line one& echo line two 1>&2& exit /b 3)",
        );
        let runtime = runtime(&script, 5000);
        let log = script.dir.path().join("validate.log");
        let exit = runtime
            .run_step(
                "loam-os-m-1",
                &step(&["pnpm", "verify", "--keep-going"], 10_000),
                &log,
            )
            .unwrap();
        assert_eq!(exit.code, Some(3));
        assert!(!exit.timed_out);
        let text = std::fs::read_to_string(&log).unwrap();
        assert!(
            text.contains("line one") && text.contains("line two"),
            "{text}"
        );
        assert_eq!(
            script.calls(),
            vec!["exec --env CI=1 --workdir /work loam-os-m-1 pnpm verify --keep-going"]
        );
    }

    #[test]
    fn a_step_past_its_timeout_is_killed_from_outside() {
        let _spawning = spawning();
        let script = script(
            r#"if [ "$1" = exec ]; then exec sleep 30; fi"#,
            "if \"%1\"==\"exec\" ping -n 30 127.0.0.1 >nul",
        );
        let runtime = runtime(&script, 5000);
        let log = script.dir.path().join("validate.log");
        let started = Instant::now();
        let exit = runtime
            .run_step("loam-os-m-1", &step(&["pnpm", "verify"], 300), &log)
            .unwrap();
        assert!(exit.timed_out);
        assert_eq!(exit.code, None);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(
            script.calls().last().map(String::as_str),
            Some("restart -t 0 loam-os-m-1")
        );
    }

    #[test]
    fn a_step_with_no_program_is_refused_before_the_runtime() {
        let runtime = CliRuntime::new("docker", "unused", Duration::from_secs(1));
        let dir = tempfile::tempdir().unwrap();
        let error = runtime
            .run_step("c", &step(&[], 1000), &dir.path().join("log"))
            .unwrap_err();
        assert!(error.message.contains("names no program"), "{error}");
    }

    #[test]
    fn usage_and_disk_are_read_from_the_program() {
        let _spawning = spawning();
        let script = script(
            r#"case "$1" in
  stats) echo '1.5GiB / 16GiB|12.50%' ;;
  system) echo '{"Volumes":[{"Name":"loam-os-m-1-work","Labels":"dev.lushly.loam-os=m-1","Size":"2.5GB"}],"Containers":[]}' ;;
esac"#,
            "if \"%1\"==\"stats\" echo 1.5GiB / 16GiB^|12.50%%\nif \"%1\"==\"system\" echo {\"Volumes\":[{\"Name\":\"loam-os-m-1-work\",\"Labels\":\"dev.lushly.loam-os=m-1\",\"Size\":\"2.5GB\"}],\"Containers\":[]}",
        );
        let runtime = runtime(&script, 5000);
        let usage = runtime.usage("loam-os-m-1").unwrap();
        assert_eq!(usage.memory_bytes, 1_610_612_736);
        assert!((usage.cpu_percent - 12.5).abs() < f64::EPSILON);
        let disk = runtime.disk().unwrap();
        assert_eq!(disk.volumes["loam-os-m-1-work"], 2_500_000_000);
        assert_eq!(disk.total(), 2_500_000_000);
    }

    #[test]
    fn disk_outlives_the_runtimes_call_timeout() {
        let _spawning = spawning();
        let script = script(
            r#"if [ "$1" = system ]; then sleep 1; echo '{"Volumes":[],"Containers":[]}'; fi"#,
            "if \"%1\"==\"system\" (ping -n 2 127.0.0.1 >nul& echo {\"Volumes\":[],\"Containers\":[]})",
        );
        // A call timeout far shorter than the second `system df` takes here.
        let runtime = runtime(&script, 300);
        assert_eq!(runtime.disk().unwrap(), Disk::default());
    }

    #[test]
    fn a_daemon_error_is_named_past_the_programs_warnings() {
        let _spawning = spawning();
        let script = script(
            "echo 'WARNING: Your kernel does not support swap limit capabilities.' >&2; echo 'docker: Error response from daemon: Conflict.' >&2; exit 125",
            "echo WARNING: Your kernel does not support swap limit capabilities. 1>&2\necho docker: Error response from daemon: Conflict. 1>&2\nexit /b 125",
        );
        let error = runtime(&script, 5000).version().unwrap_err();
        assert!(
            error
                .message
                .ends_with("docker: Error response from daemon: Conflict."),
            "{error}"
        );
    }

    #[test]
    fn sizes_read_in_both_unit_families() {
        assert_eq!(parse_size("0B"), Some(0));
        assert_eq!(parse_size("2.784kB"), Some(2784));
        assert_eq!(parse_size("8.44GB"), Some(8_440_000_000));
        assert_eq!(parse_size("512MiB"), Some(536_870_912));
        assert_eq!(parse_size(" 1.5GiB "), Some(1_610_612_736));
        assert_eq!(parse_size("N/A"), None);
        assert_eq!(parse_size("3 parsecs"), None);
    }

    #[test]
    fn disk_counts_only_what_carries_the_label() {
        let disk = parse_disk(
            r#"{"Volumes":[
                {"Name":"theirs","Labels":"","Size":"9GB"},
                {"Name":"near","Labels":"dev.lushly.loam-os.other=x","Size":"9GB"},
                {"Name":"loam-os-m-1-build","Labels":"a=b,dev.lushly.loam-os=m-1","Size":"48GB"}],
              "Containers":[
                {"Names":"loam-os-m-1","Labels":"dev.lushly.loam-os=m-1","Size":"1.2GB"},
                {"Names":"other","Labels":"com.example=1","Size":"8GB"}]}"#,
        )
        .unwrap();
        assert_eq!(
            disk.volumes,
            BTreeMap::from([("loam-os-m-1-build".to_owned(), 48_000_000_000)])
        );
        assert_eq!(
            disk.containers,
            BTreeMap::from([("loam-os-m-1".to_owned(), 1_200_000_000)])
        );
        assert!(parse_disk("not json").is_err());
        assert!(
            parse_disk(r#"{"Volumes":[{"Name":"v","Labels":"dev.lushly.loam-os=m","Size":"?"}]}"#)
                .is_err()
        );
    }

    #[test]
    fn names_are_the_hosts_own() {
        assert_eq!(container_name("m-01"), "loam-os-m-01");
        assert_eq!(volume_name("m-01", "work"), "loam-os-m-01-work");
    }
}
