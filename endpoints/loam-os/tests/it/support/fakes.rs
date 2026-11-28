//! The fakes the host's tests drive, kept out of `src/` so the shipped binary has none: the
//! runtime (M0's `FakeRuntime`, extended), the git source, the records, and the storage under
//! Umbel's journal policies, which fails writes on demand. The journal itself stays Umbel's.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loam_os_host::records::{MachineRecord, Records, RecordsError, RunRecord};
use loam_os_host::runtime::{
    ContainerSpec, Disk, Labelled, Runtime, RuntimeError, StepExit, StepSpec, Usage,
};
use loam_os_host::source::{Source, SourceError};
use umbel::JournalStorage;

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// How a step plays in the fake runtime.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StepScript {
    /// Its exit code (0 when `None` and it does not hang).
    pub(crate) code: Option<i32>,
    /// How long it says it ran: the clock cannot move inside a scenario.
    pub(crate) duration_ms: u64,
    /// What it writes to its log.
    pub(crate) log: Vec<String>,
    /// Whether it never ends, so it is killed at its timeout.
    pub(crate) hangs: bool,
    /// The memory it uses while it runs.
    pub(crate) memory_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
struct FakeContainer {
    machine: String,
    memory_bytes: u64,
}

#[derive(Debug, Default)]
struct RuntimeState {
    version: Option<String>,
    unreachable: Option<String>,
    labelled_error: Option<String>,
    containers: BTreeMap<String, FakeContainer>,
    volumes: BTreeMap<String, String>,
    sizes: BTreeMap<String, u64>,
    scripts: BTreeMap<String, VecDeque<StepScript>>,
    stopped: Vec<String>,
}

/// A container runtime that answers what it is told, or that it cannot be reached.
#[derive(Debug)]
pub(crate) struct FakeRuntime {
    kind: String,
    state: Mutex<RuntimeState>,
}

impl FakeRuntime {
    /// A reachable runtime of `kind` with server version `version`, holding nothing.
    pub(crate) fn reachable(kind: &str, version: &str) -> Self {
        Self {
            kind: kind.to_owned(),
            state: Mutex::new(RuntimeState {
                version: Some(version.to_owned()),
                ..RuntimeState::default()
            }),
        }
    }

    /// A runtime of `kind` that cannot be reached, for `reason`.
    pub(crate) fn unreachable(kind: &str, reason: &str) -> Self {
        Self {
            kind: kind.to_owned(),
            state: Mutex::new(RuntimeState {
                unreachable: Some(reason.to_owned()),
                ..RuntimeState::default()
            }),
        }
    }

    /// Make it reachable with `version`, or unreachable with `None`.
    pub(crate) fn set_version(&self, version: Option<&str>) {
        let mut state = locked(&self.state);
        state.version = version.map(str::to_owned);
        if version.is_some() {
            state.unreachable = None;
        } else if state.unreachable.is_none() {
            state.unreachable = Some("the fake runtime is unreachable".to_owned());
        }
    }

    /// Make the label queries fail with `message` while the version still answers, or answer
    /// again with `None`.
    pub(crate) fn set_labelled_error(&self, message: Option<&str>) {
        locked(&self.state).labelled_error = message.map(str::to_owned);
    }

    /// Hold a labelled container for `machine` that the host may or may not have recorded,
    /// using `bytes` of disk.
    pub(crate) fn hold_container(&self, name: &str, machine: &str, bytes: u64) {
        let mut state = locked(&self.state);
        state.containers.insert(
            name.to_owned(),
            FakeContainer {
                machine: machine.to_owned(),
                memory_bytes: 0,
            },
        );
        state.sizes.insert(name.to_owned(), bytes);
    }

    /// Hold a labelled volume for `machine`, using `bytes` of disk.
    pub(crate) fn hold_volume(&self, name: &str, machine: &str, bytes: u64) {
        let mut state = locked(&self.state);
        state.volumes.insert(name.to_owned(), machine.to_owned());
        state.sizes.insert(name.to_owned(), bytes);
    }

    /// Play `steps`, in order, for the next steps run in `container`.
    pub(crate) fn script(&self, container: &str, steps: impl IntoIterator<Item = StepScript>) {
        locked(&self.state)
            .scripts
            .entry(container.to_owned())
            .or_default()
            .extend(steps);
    }

    /// The machine a labelled object was made for.
    pub(crate) fn machine_of(&self, name: &str) -> Option<String> {
        let state = locked(&self.state);
        state
            .containers
            .get(name)
            .map(|container| container.machine.clone())
            .or_else(|| state.volumes.get(name).cloned())
    }

    /// The containers whose steps were stopped from outside, in order.
    pub(crate) fn stopped(&self) -> Vec<String> {
        locked(&self.state).stopped.clone()
    }

    fn reach(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, RuntimeError> {
        let state = locked(&self.state);
        match (&state.version, &state.unreachable) {
            (Some(_), _) => Ok(state),
            (None, reason) => {
                Err(RuntimeError::new(reason.clone().unwrap_or_else(|| {
                    "the fake runtime is unreachable".to_owned()
                })))
            }
        }
    }
}

impl Runtime for FakeRuntime {
    fn kind(&self) -> &str {
        &self.kind
    }

    fn version(&self) -> Result<String, RuntimeError> {
        let state = self.reach()?;
        Ok(state.version.clone().unwrap_or_default())
    }

    fn labelled(&self) -> Result<Labelled, RuntimeError> {
        let state = self.reach()?;
        if let Some(message) = &state.labelled_error {
            return Err(RuntimeError::new(message.clone()));
        }
        Ok(Labelled {
            containers: state.containers.keys().cloned().collect(),
            volumes: state.volumes.keys().cloned().collect(),
        })
    }

    fn create_volume(&self, name: &str, machine: &str) -> Result<(), RuntimeError> {
        // As Docker's `volume create`: a local volume that exists already is kept, and the call
        // succeeds.
        let mut state = self.reach()?;
        if !state.volumes.contains_key(name) {
            state.volumes.insert(name.to_owned(), machine.to_owned());
            state.sizes.insert(name.to_owned(), 0);
        }
        Ok(())
    }

    fn create_container(&self, spec: &ContainerSpec) -> Result<(), RuntimeError> {
        let mut state = self.reach()?;
        if state.containers.contains_key(&spec.name) {
            return Err(RuntimeError::new(format!(
                "container `{}` already exists",
                spec.name
            )));
        }
        if let Some(missing) = spec
            .mounts
            .iter()
            .find(|mount| !state.volumes.contains_key(&mount.volume))
        {
            return Err(RuntimeError::new(format!(
                "no such volume: {}",
                missing.volume
            )));
        }
        state.containers.insert(
            spec.name.clone(),
            FakeContainer {
                machine: spec.machine.clone(),
                memory_bytes: 0,
            },
        );
        state.sizes.insert(spec.name.clone(), 0);
        Ok(())
    }

    fn remove_container(&self, name: &str) -> Result<bool, RuntimeError> {
        let mut state = self.reach()?;
        state.sizes.remove(name);
        Ok(state.containers.remove(name).is_some())
    }

    fn remove_volume(&self, name: &str) -> Result<bool, RuntimeError> {
        let mut state = self.reach()?;
        state.sizes.remove(name);
        Ok(state.volumes.remove(name).is_some())
    }

    fn run_step(
        &self,
        container: &str,
        step: &StepSpec,
        log: &Path,
    ) -> Result<StepExit, RuntimeError> {
        let mut state = self.reach()?;
        if !state.containers.contains_key(container) {
            return Err(RuntimeError::new(format!("no such container: {container}")));
        }
        let script = state
            .scripts
            .get_mut(container)
            .and_then(VecDeque::pop_front)
            .unwrap_or_default();
        if let Some(memory) = script.memory_bytes
            && let Some(found) = state.containers.get_mut(container)
        {
            found.memory_bytes = memory;
        }
        if script.hangs {
            state.stopped.push(container.to_owned());
        }
        drop(state);
        let mut text = script.log.join("\n");
        if !text.is_empty() {
            text.push('\n');
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .map_err(|error| RuntimeError::new(error.to_string()))?;
        std::io::Write::write_all(&mut file, text.as_bytes())
            .map_err(|error| RuntimeError::new(error.to_string()))?;
        Ok(if script.hangs {
            StepExit {
                code: None,
                timed_out: true,
                duration: step.timeout,
                stop_error: None,
            }
        } else {
            StepExit {
                code: Some(script.code.unwrap_or(0)),
                timed_out: false,
                duration: Duration::from_millis(script.duration_ms),
                stop_error: None,
            }
        })
    }

    fn stop_steps(&self, container: &str) -> Result<(), RuntimeError> {
        let mut state = self.reach()?;
        if !state.containers.contains_key(container) {
            return Err(RuntimeError::new(format!("no such container: {container}")));
        }
        state.stopped.push(container.to_owned());
        Ok(())
    }

    fn usage(&self, container: &str) -> Result<Usage, RuntimeError> {
        let state = self.reach()?;
        let found = state
            .containers
            .get(container)
            .ok_or_else(|| RuntimeError::new(format!("no such container: {container}")))?;
        Ok(Usage {
            memory_bytes: found.memory_bytes,
            cpu_percent: 0.0,
        })
    }

    fn disk(&self) -> Result<Disk, RuntimeError> {
        let state = self.reach()?;
        let size = |name: &String| state.sizes.get(name).copied().unwrap_or(0);
        Ok(Disk {
            volumes: state
                .volumes
                .keys()
                .map(|name| (name.clone(), size(name)))
                .collect(),
            containers: state
                .containers
                .keys()
                .map(|name| (name.clone(), size(name)))
                .collect(),
        })
    }
}

/// A repository's commits: its branches and the commits it holds.
#[derive(Debug, Default)]
struct Repository {
    branches: BTreeMap<String, String>,
    commits: BTreeSet<String>,
}

/// The repositories' configured sources, as a fixture's `branches` and `heads` say.
#[derive(Debug, Default)]
pub(crate) struct FakeSource {
    repositories: Mutex<BTreeMap<String, Repository>>,
}

impl FakeSource {
    /// `repository`'s `branch` points at `commit`, which it holds.
    pub(crate) fn branch(&self, repository: &str, branch: &str, commit: &str) {
        let mut repositories = locked(&self.repositories);
        let entry = repositories.entry(repository.to_owned()).or_default();
        entry.branches.insert(branch.to_owned(), commit.to_owned());
        entry.commits.insert(commit.to_owned());
    }

    /// `repository` holds `commit`.
    pub(crate) fn commit(&self, repository: &str, commit: &str) {
        locked(&self.repositories)
            .entry(repository.to_owned())
            .or_default()
            .commits
            .insert(commit.to_owned());
    }
}

impl Source for FakeSource {
    fn branch_head(&self, repository: &str, branch: &str) -> Result<Option<String>, SourceError> {
        let repositories = locked(&self.repositories);
        let found = repositories
            .get(repository)
            .ok_or_else(|| SourceError::new(format!("no source for `{repository}`")))?;
        Ok(found.branches.get(branch).cloned())
    }

    fn contains(&self, repository: &str, commit: &str) -> Result<bool, SourceError> {
        let repositories = locked(&self.repositories);
        let found = repositories
            .get(repository)
            .ok_or_else(|| SourceError::new(format!("no source for `{repository}`")))?;
        Ok(found.commits.contains(commit))
    }
}

#[derive(Debug, Default)]
struct RecordsState {
    machines: BTreeMap<String, MachineRecord>,
    runs: BTreeMap<String, RunRecord>,
    unreadable: Option<String>,
}

/// The host's records in memory, seeded by a test and made unreadable on demand.
#[derive(Debug, Default)]
pub(crate) struct MemoryRecords {
    state: Mutex<RecordsState>,
}

impl MemoryRecords {
    /// Make every read and write fail with `message`, or answer again with `None`.
    pub(crate) fn set_unreadable(&self, message: Option<&str>) {
        locked(&self.state).unreadable = message.map(str::to_owned);
    }

    fn open(&self) -> Result<std::sync::MutexGuard<'_, RecordsState>, RecordsError> {
        let state = locked(&self.state);
        match &state.unreadable {
            Some(message) => Err(RecordsError::new(message.clone())),
            None => Ok(state),
        }
    }
}

impl Records for MemoryRecords {
    fn machines(&self) -> Result<Vec<MachineRecord>, RecordsError> {
        Ok(self.open()?.machines.values().cloned().collect())
    }

    fn machine(&self, id: &str) -> Result<Option<MachineRecord>, RecordsError> {
        Ok(self.open()?.machines.get(id).cloned())
    }

    fn put_machine(&self, record: &MachineRecord) -> Result<(), RecordsError> {
        self.open()?
            .machines
            .insert(record.id.clone(), record.clone());
        Ok(())
    }

    fn runs(&self) -> Result<Vec<RunRecord>, RecordsError> {
        Ok(self.open()?.runs.values().cloned().collect())
    }

    fn run(&self, id: &str) -> Result<Option<RunRecord>, RecordsError> {
        Ok(self.open()?.runs.get(id).cloned())
    }

    fn put_run(&self, record: &RunRecord) -> Result<(), RecordsError> {
        self.open()?.runs.insert(record.id.clone(), record.clone());
        Ok(())
    }
}

#[derive(Debug, Default)]
struct StorageState {
    ahead: Vec<u8>,
    down: Option<String>,
}

/// The storage under Umbel's journal policies: the write-ahead file in memory, and a journal
/// that can be made unwritable, as a full disk or a locked file makes it. Cloning it gives a
/// handle on the same storage.
#[derive(Debug, Clone, Default)]
pub(crate) struct FlakyStorage {
    state: Arc<Mutex<StorageState>>,
}

impl FlakyStorage {
    /// Fail every write with `reason`, or take writes again with `None`.
    pub(crate) fn set_down(&self, reason: Option<&str>) {
        locked(&self.state).down = reason.map(str::to_owned);
    }

    fn check(&self) -> io::Result<()> {
        match &locked(&self.state).down {
            Some(reason) => Err(io::Error::other(reason.clone())),
            None => Ok(()),
        }
    }
}

impl JournalStorage for FlakyStorage {
    fn append_ahead(&self, line: &[u8]) -> io::Result<()> {
        self.check()?;
        locked(&self.state).ahead.extend_from_slice(line);
        Ok(())
    }

    fn read_ahead(&self) -> io::Result<Vec<u8>> {
        Ok(locked(&self.state).ahead.clone())
    }

    fn check_ahead(&self) -> io::Result<()> {
        self.check()
    }

    fn check_journal(&self) -> io::Result<()> {
        self.check()
    }
}
