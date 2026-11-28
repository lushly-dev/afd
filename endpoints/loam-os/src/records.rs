//! The host's records of machines and runs: what it made, what ran and how each ended. They
//! live in the workspace's state, apart from the journal, and outlive the host's process, so a
//! restart rebuilds from them and the runtime (the proposal's [The record]).
//!
//! The layout is one JSON file per record, `state/loamos/records/machines/<id>.json` and
//! `state/loamos/records/runs/<id>.json`, each written whole to a temporary file beside it,
//! synced, and renamed over the old one, so a crash leaves the old record or the new one and
//! never a torn one. The unit's README says why this layout and not a store.
//!
//! [The record]: ../../docs/features/active/loam-os/loam-os.proposal.md#the-record

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The version every record carries as `v`.
pub const RECORD_VERSION: u32 = 1;

/// Why the records could not be read or written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordsError {
    /// What happened, in a sentence.
    pub message: String,
}

impl RecordsError {
    /// An error saying `message`.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RecordsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RecordsError {}

/// A machine's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MachineState {
    /// Made, with no run active.
    Ready,
    /// A run is active.
    Busy,
    /// The runtime no longer has it, or it cannot be used.
    Broken,
    /// Gone, with its volumes; the record stays.
    Destroyed,
}

impl MachineState {
    /// Whether the machine counts against capacity: every state but `destroyed`.
    pub fn is_active(self) -> bool {
        self != Self::Destroyed
    }
}

/// A run's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunState {
    /// Its steps are running.
    Running,
    /// Every step exited 0.
    Passed,
    /// A step exited non-zero.
    Failed,
    /// A step ran past its timeout.
    TimedOut,
    /// The machine went over a limit.
    OverLimit,
    /// Stopped by a caller.
    Cancelled,
    /// Its end was not observed.
    Lost,
}

impl RunState {
    /// Whether the run has ended.
    pub fn is_final(self) -> bool {
        self != Self::Running
    }
}

/// Who did something, as the event log names an actor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActorRecord {
    /// `agent`, `human`, `service`, `script` or `test`.
    pub kind: String,
    /// The actor's id, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// The image a machine was made on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageRecord {
    /// The image's name in the configuration.
    pub name: String,
    /// Its digest, `sha256:<hex>`.
    pub digest: String,
}

/// A machine's record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MachineRecord {
    /// [`RECORD_VERSION`].
    pub v: u32,
    /// `m-…`.
    pub id: String,
    /// The repository's name in the configuration.
    pub repository: String,
    /// The branch it is for.
    #[serde(rename = "for")]
    pub branch: String,
    /// The size's name in the configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    /// The image it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageRecord>,
    /// Its state.
    pub state: MachineState,
    /// When it was made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// When the reaper may destroy it if idle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// When it was destroyed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destroyed_at: Option<String>,
    /// Who destroyed it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destroyed_by: Option<ActorRecord>,
    /// Why it was destroyed, or why it is broken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Its container's name on the runtime, while it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    /// Its volumes' names on the runtime by mount (`work`, `build`, `downloads`), while it has
    /// them.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub volumes: BTreeMap<String, String>,
}

impl MachineRecord {
    /// The names on the runtime this record accounts for: its container and its volumes.
    pub fn runtime_names(&self) -> impl Iterator<Item = &str> {
        self.container
            .as_deref()
            .into_iter()
            .chain(self.volumes.values().map(String::as_str))
    }
}

/// One step of a run, as it was given and as it ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepRecord {
    /// Its label.
    pub label: String,
    /// The program and its arguments.
    pub args: Vec<String>,
    /// Its added environment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
    /// Its timeout, as given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    /// Its network policy.
    pub network: String,
    /// Its exit code, once it ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    /// Whether it was killed at its timeout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
    /// How long it ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

/// A run's record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRecord {
    /// [`RECORD_VERSION`].
    pub v: u32,
    /// `r-…`.
    pub id: String,
    /// The machine's id.
    pub machine: String,
    /// The commit checked out.
    pub head: String,
    /// The base commit `main` was set to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// The tree of `head`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<String>,
    /// Its state.
    pub state: RunState,
    /// Where the fault lay: `branch`, `host` or `network`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault: Option<String>,
    /// The label of the step that failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
    /// The limit it went over.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<String>,
    /// Why it ended as it did, when the state alone does not say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Whether it was settled after a restart from what the runtime kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovered: Option<bool>,
    /// Its steps.
    #[serde(default)]
    pub steps: Vec<StepRecord>,
    /// When it started.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// When it ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

/// Where the host keeps its records.
pub trait Records: Send + Sync {
    /// Every machine's record, by id.
    ///
    /// # Errors
    /// A [`RecordsError`] when they cannot be read.
    fn machines(&self) -> Result<Vec<MachineRecord>, RecordsError>;

    /// The machine `id`'s record, if there is one.
    ///
    /// # Errors
    /// A [`RecordsError`] when it cannot be read.
    fn machine(&self, id: &str) -> Result<Option<MachineRecord>, RecordsError>;

    /// Write a machine's record, replacing the one with its id.
    ///
    /// # Errors
    /// A [`RecordsError`] when it may not be durable. The old record, if any, stands, except when
    /// only the sync after the rename failed: the new one may then stand.
    fn put_machine(&self, record: &MachineRecord) -> Result<(), RecordsError>;

    /// Every run's record, by id.
    ///
    /// # Errors
    /// A [`RecordsError`] when they cannot be read.
    fn runs(&self) -> Result<Vec<RunRecord>, RecordsError>;

    /// The run `id`'s record, if there is one.
    ///
    /// # Errors
    /// A [`RecordsError`] when it cannot be read.
    fn run(&self, id: &str) -> Result<Option<RunRecord>, RecordsError>;

    /// Write a run's record, replacing the one with its id.
    ///
    /// # Errors
    /// A [`RecordsError`] when it may not be durable. The old record, if any, stands, except when
    /// only the sync after the rename failed: the new one may then stand.
    fn put_run(&self, record: &RunRecord) -> Result<(), RecordsError>;
}

/// The host's records on disk (see the module's documentation for the layout).
#[derive(Debug)]
pub struct FileRecords {
    root: PathBuf,
    /// One writer at a time in this process, and no read while it renames, so two writes never
    /// race and a read never holds a file a rename replaces. Callers reach the one running host
    /// (step 10), so there is one process.
    lock: RwLock<()>,
}

/// Each temporary file's own number in this process.
static TEMPORARY: AtomicU64 = AtomicU64::new(0);

const MACHINES: &str = "machines";
const RUNS: &str = "runs";

impl FileRecords {
    /// The records under `root`, which is made at the first write.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lock: RwLock::new(()),
        }
    }

    /// The records in a workspace's state directory: `<state>/loamos/records`.
    pub fn in_state(state_dir: &Path) -> Self {
        Self::new(state_dir.join("loamos").join("records"))
    }

    /// Where the records are.
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn file(&self, kind: &str, id: &str) -> Result<PathBuf, RecordsError> {
        check_id(id)?;
        Ok(self.root.join(kind).join(format!("{id}.json")))
    }

    fn write<T: Serialize>(&self, kind: &str, id: &str, record: &T) -> Result<(), RecordsError> {
        let path = self.file(kind, id)?;
        let mut bytes = serde_json::to_vec_pretty(record).map_err(|error| {
            RecordsError::new(format!(
                "the {kind} record `{id}` cannot be written: {error}"
            ))
        })?;
        bytes.push(b'\n');
        let _guard = self
            .lock
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        write_atomically(&path, &bytes).map_err(|error| {
            RecordsError::new(format!(
                "the {kind} record `{id}` was not written to {}: {error}",
                path.display()
            ))
        })
    }

    fn read<T: DeserializeOwned>(&self, kind: &str, id: &str) -> Result<Option<T>, RecordsError> {
        let path = self.file(kind, id)?;
        let _guard = self
            .lock
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match fs::read(&path) {
            Ok(bytes) => parse(&path, &bytes).map(Some),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(RecordsError::new(format!(
                "{} cannot be read: {error}",
                path.display()
            ))),
        }
    }

    fn read_all<T: DeserializeOwned>(&self, kind: &str) -> Result<Vec<T>, RecordsError> {
        let dir = self.root.join(kind);
        let _guard = self
            .lock
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(RecordsError::new(format!(
                    "{} cannot be read: {error}",
                    dir.display()
                )));
            }
        };
        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| {
                RecordsError::new(format!("{} cannot be read: {error}", dir.display()))
            })?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            // A temporary file a crash left before its rename is not a record.
            if name.starts_with('.') || !name.ends_with(".json") {
                continue;
            }
            paths.push(entry.path());
        }
        paths.sort();
        paths
            .iter()
            .map(|path| {
                let bytes = fs::read(path).map_err(|error| {
                    RecordsError::new(format!("{} cannot be read: {error}", path.display()))
                })?;
                parse(path, &bytes)
            })
            .collect()
    }
}

impl Records for FileRecords {
    fn machines(&self) -> Result<Vec<MachineRecord>, RecordsError> {
        self.read_all(MACHINES)
    }

    fn machine(&self, id: &str) -> Result<Option<MachineRecord>, RecordsError> {
        self.read(MACHINES, id)
    }

    fn put_machine(&self, record: &MachineRecord) -> Result<(), RecordsError> {
        self.write(MACHINES, &record.id, record)
    }

    fn runs(&self) -> Result<Vec<RunRecord>, RecordsError> {
        self.read_all(RUNS)
    }

    fn run(&self, id: &str) -> Result<Option<RunRecord>, RecordsError> {
        self.read(RUNS, id)
    }

    fn put_run(&self, record: &RunRecord) -> Result<(), RecordsError> {
        self.write(RUNS, &record.id, record)
    }
}

/// An id is a file name: lowercase letters, digits and `-`, at most 64, starting with a letter
/// or digit and holding a `-` (`m-01`, `r-21`). The `-` also keeps out every name Windows
/// reserves for a device (`CON`, `NUL`, `COM1`), which none of them has.
fn check_id(id: &str) -> Result<(), RecordsError> {
    let fine = id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && id
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && id.contains('-');
    if fine {
        Ok(())
    } else {
        Err(RecordsError::new(format!(
            "`{id}` is not a record id (lowercase letters, digits and `-`, with a `-`, at most 64)"
        )))
    }
}

fn parse<T: DeserializeOwned>(path: &Path, bytes: &[u8]) -> Result<T, RecordsError> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| {
        RecordsError::new(format!("{} is not a record: {error}", path.display()))
    })?;
    let version = value.get("v").and_then(serde_json::Value::as_u64);
    if version != Some(u64::from(RECORD_VERSION)) {
        return Err(RecordsError::new(format!(
            "{} is a record of version {}, and this host reads version {RECORD_VERSION}",
            path.display(),
            version.map_or_else(|| "none".to_owned(), |v| v.to_string())
        )));
    }
    serde_json::from_value(value)
        .map_err(|error| RecordsError::new(format!("{} is not a record: {error}", path.display())))
}

/// Write `bytes` to `path` so that a crash at any point leaves the old file or the new one:
/// a temporary file beside it, synced, renamed over it, and on Unix the directory synced too, so
/// the rename itself is durable. On Unix each directory this makes is synced into its parent.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("a record's path has no directory"))?;
    if !dir.is_dir() {
        // The topmost directory that does not exist yet, so its new entry can be synced too.
        let mut made = dir;
        while let Some(parent) = made.parent() {
            if parent.as_os_str().is_empty() || parent.is_dir() {
                break;
            }
            made = parent;
        }
        fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            let mut synced = Some(dir);
            while let Some(here) = synced {
                if let Some(parent) = here.parent().filter(|p| !p.as_os_str().is_empty()) {
                    fs::File::open(parent)?.sync_all()?;
                }
                synced = if here == made { None } else { here.parent() };
            }
        }
        #[cfg(not(unix))]
        let _ = made;
    }
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("a record's path has no file name"))?
        .to_string_lossy();
    let temporary = dir.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        TEMPORARY.fetch_add(1, Ordering::SeqCst)
    ));
    let written = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Replaces the old record in one step, on Windows too (std's `rename` replaces an
        // existing file there).
        fs::rename(&temporary, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written?;
    #[cfg(unix)]
    fs::File::open(dir)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine(id: &str, state: MachineState) -> MachineRecord {
        MachineRecord {
            v: RECORD_VERSION,
            id: id.to_owned(),
            repository: "example-repo".to_owned(),
            branch: "fix/tokens".to_owned(),
            size: Some("standard".to_owned()),
            image: Some(ImageRecord {
                name: "example-image".to_owned(),
                digest: format!("sha256:{}", "a".repeat(64)),
            }),
            state,
            created_at: Some("2030-02-03T10:00:00Z".to_owned()),
            expires_at: None,
            destroyed_at: None,
            destroyed_by: None,
            reason: None,
            container: Some(crate::runtime::container_name(id)),
            volumes: crate::runtime::MOUNTS
                .iter()
                .map(|mount| ((*mount).to_owned(), crate::runtime::volume_name(id, mount)))
                .collect(),
        }
    }

    fn run(id: &str, state: RunState) -> RunRecord {
        RunRecord {
            v: RECORD_VERSION,
            id: id.to_owned(),
            machine: "m-01".to_owned(),
            head: "3f9a2c4e5b6d7081928374a5b6c7d8e9f0a1b2c3".to_owned(),
            base: Some("0f".repeat(20)),
            tree: None,
            state,
            fault: None,
            failed: None,
            limit: None,
            reason: None,
            recovered: None,
            steps: vec![StepRecord {
                label: "validate".to_owned(),
                args: vec!["pnpm".to_owned(), "verify".to_owned()],
                env: None,
                timeout_seconds: Some(5400),
                network: "none".to_owned(),
                code: None,
                timed_out: None,
                duration_ms: None,
            }],
            started_at: Some("2030-02-03T10:00:00Z".to_owned()),
            ended_at: None,
        }
    }

    #[test]
    fn records_survive_a_new_host_process() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::in_state(dir.path());
        assert!(records.machines().unwrap().is_empty());
        assert_eq!(records.run("r-1").unwrap(), None);
        records
            .put_machine(&machine("m-01", MachineState::Ready))
            .unwrap();
        records
            .put_machine(&machine("m-02", MachineState::Busy))
            .unwrap();
        records.put_run(&run("r-1", RunState::Running)).unwrap();
        // Replacing a record keeps one file for it.
        let mut passed = run("r-1", RunState::Passed);
        passed.ended_at = Some("2030-02-03T10:10:00Z".to_owned());
        records.put_run(&passed).unwrap();
        drop(records);

        let again = FileRecords::in_state(dir.path());
        assert_eq!(
            again.root(),
            dir.path().join("loamos").join("records").as_path()
        );
        let machines = again.machines().unwrap();
        assert_eq!(
            machines.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["m-01", "m-02"]
        );
        assert_eq!(machines[1], machine("m-02", MachineState::Busy));
        assert_eq!(again.runs().unwrap(), vec![passed.clone()]);
        assert_eq!(again.run("r-1").unwrap(), Some(passed));
        assert_eq!(
            fs::read_dir(again.root().join("runs")).unwrap().count(),
            1,
            "no temporary file is left"
        );
    }

    #[test]
    fn a_record_is_camel_case_json_with_its_version() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::new(dir.path());
        records
            .put_machine(&machine("m-01", MachineState::Ready))
            .unwrap();
        let text = fs::read_to_string(dir.path().join("machines").join("m-01.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["v"], 1);
        assert_eq!(value["for"], "fix/tokens");
        assert_eq!(value["createdAt"], "2030-02-03T10:00:00Z");
        assert_eq!(value["volumes"]["work"], "loam-os-m-01-work");
        assert!(value.get("destroyedBy").is_none());
        assert!(text.ends_with('\n'));
    }

    #[test]
    fn a_crash_before_the_rename_leaves_the_old_record() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::new(dir.path());
        let old = machine("m-01", MachineState::Busy);
        records.put_machine(&old).unwrap();
        // What a crash between the temporary file's write and its rename leaves: a torn
        // temporary file beside the record.
        fs::write(
            dir.path().join("machines").join(".m-01.json.1.0.tmp"),
            b"{\"v\":1,\"id\":\"m-01\",\"sta",
        )
        .unwrap();
        assert_eq!(records.machines().unwrap(), vec![old.clone()]);
        assert_eq!(records.machine("m-01").unwrap(), Some(old));
    }

    #[test]
    fn a_record_that_is_not_one_is_an_error_that_names_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::new(dir.path());
        fs::create_dir_all(dir.path().join("runs")).unwrap();
        fs::write(dir.path().join("runs").join("r-1.json"), b"{\"v\":1").unwrap();
        let error = records.runs().unwrap_err();
        assert!(error.message.contains("r-1.json"), "{error}");
        fs::write(
            dir.path().join("runs").join("r-1.json"),
            b"{\"v\":2,\"id\":\"r-1\"}",
        )
        .unwrap();
        let error = records.run("r-1").unwrap_err();
        assert!(error.message.contains("version 2"), "{error}");
    }

    #[test]
    fn an_id_is_never_a_path() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::new(dir.path());
        for bad in [
            "",
            "../m-01",
            "m/01",
            ".m-01",
            "m_01",
            "M-01",
            "con",
            "nul",
            "m01",
            &format!("m-{}", "1".repeat(63)),
        ] {
            assert!(records.machine(bad).is_err(), "{bad}");
            assert!(
                records
                    .put_machine(&machine(bad, MachineState::Ready))
                    .is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_write_that_fails_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let records = FileRecords::new(dir.path());
        let old = machine("m-01", MachineState::Ready);
        records.put_machine(&old).unwrap();
        // A directory where the record's file goes cannot be renamed over.
        let blocked = FileRecords::new(dir.path().join("blocked"));
        fs::create_dir_all(
            dir.path()
                .join("blocked")
                .join("machines")
                .join("m-01.json"),
        )
        .unwrap();
        assert!(blocked.put_machine(&old).is_err());
        let left: Vec<_> = fs::read_dir(dir.path().join("blocked").join("machines"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["m-01.json"]);
    }

    #[test]
    fn states_read_as_the_commands_name_them() {
        assert_eq!(
            serde_json::to_value(RunState::TimedOut).unwrap(),
            "timed-out"
        );
        assert_eq!(
            serde_json::to_value(RunState::OverLimit).unwrap(),
            "over-limit"
        );
        assert_eq!(
            serde_json::to_value(MachineState::Destroyed).unwrap(),
            "destroyed"
        );
        assert!(!MachineState::Destroyed.is_active());
        assert!(MachineState::Broken.is_active());
        assert!(RunState::Lost.is_final());
        assert!(!RunState::Running.is_final());
    }
}
