//! The scenarios' fixtures (`docs/features/active/loam-os/scenarios/fixtures/`), read as
//! written, merged over their `base`, and turned into a fresh host: the operator's configuration
//! in `umbel.toml`, the clock, the fake runtime, the fake source, the records and the storage
//! under the journal. [`PARTS`] says what the harness does with each part of a fixture, so a
//! part no step uses yet is named, with the step that will, and never silently ignored.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use loam_os_host::LoamOs;
use loam_os_host::records::{
    ActorRecord, ImageRecord, MachineRecord, MachineState, RECORD_VERSION, Records, RunRecord,
    RunState, StepRecord,
};
use loam_os_host::runtime::{MOUNTS, container_name, volume_name};
use serde_json::{Map, Value, json};

use super::fakes::{FakeRuntime, FakeSource, FlakyStorage, MemoryRecords};

/// The feature's scenarios folder.
pub(crate) fn scenarios_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/features/active/loam-os/scenarios")
}

/// The fixtures the `m1` scenarios use; `warm` and `warm-red` are M2's.
pub(crate) const M1_FIXTURES: [&str; 7] = [
    "host",
    "full",
    "restart",
    "journal-down",
    "leftovers",
    "runtime-down",
    "ejected",
];

/// The fixture file `name` (`full`, or `full.json`), as JSON.
pub(crate) fn read(name: &str) -> Value {
    let file = if name.ends_with(".json") {
        name.to_owned()
    } else {
        format!("{name}.json")
    };
    let path = scenarios_dir().join("fixtures").join(file);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// `over` merged over `base`: objects merge key by key, and anything else in `over` replaces
/// what `base` has (so a fixture's `machines` list replaces the base's).
pub(crate) fn merge(base: Value, over: Value) -> Value {
    match (base, over) {
        (Value::Object(mut base), Value::Object(over)) => {
            for (key, value) in over {
                let merged = match base.remove(&key) {
                    Some(old) => merge(old, value),
                    None => value,
                };
                base.insert(key, merged);
            }
            Value::Object(base)
        }
        (_, over) => over,
    }
}

/// A scenario's fixture: `file` (as the scenario names it, `fixtures/full.json`) merged over
/// `base` (`host.json`, beside it) when the scenario names one.
pub(crate) fn load(file: &str, base: Option<&str>) -> Value {
    let name = file.strip_prefix("fixtures/").unwrap_or(file);
    let fixture = read(name);
    match base {
        Some(base) => merge(read(base), fixture),
        None => fixture,
    }
}

/// What the harness does with a part of a fixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Use {
    /// It seeds the host from it, as the note says.
    Applied(&'static str),
    /// A later step's harness applies it, the step named.
    Later(&'static str),
    /// Prose for the reader, or a name the host does not show.
    Note,
}

/// Each part of a fixture, as a path of keys (`*` for any key, `[]` for any item of a list),
/// and what the harness does with it. The longest matching path decides.
pub(crate) const PARTS: [(&str, Use); 51] = [
    ("/app", Use::Note),
    ("/now", Use::Applied("the host's clock")),
    ("/host/name", Use::Note),
    ("/host/restartedAt", Use::Later("step 7")),
    (
        "/host/runtime/kind",
        Use::Applied("the fake runtime's kind"),
    ),
    (
        "/host/runtime/reachable",
        Use::Applied("the fake runtime answers or not"),
    ),
    (
        "/host/runtime/reason",
        Use::Applied("why the fake runtime does not answer"),
    ),
    (
        "/journal/mode",
        Use::Applied("the binary's journal policies, always set"),
    ),
    (
        "/journal/writable",
        Use::Applied("the journal's storage fails writes"),
    ),
    ("/journal/reason", Use::Applied("the storage's error")),
    (
        "/repositories",
        Use::Applied("the configuration's repositories"),
    ),
    (
        "/images",
        Use::Applied("the configuration's images, pinned by digest"),
    ),
    ("/sizes", Use::Applied("the configuration's sizes")),
    (
        "/policies",
        Use::Applied("the configuration's network policies"),
    ),
    ("/capacity/machines/max", Use::Applied("capacity.machines")),
    ("/capacity/diskGb", Use::Applied("capacity.disk_gb")),
    ("/capacity/usedGb", Use::Later("step 5")),
    ("/minFreeDiskGb", Use::Applied("capacity.min_free_disk_gb")),
    ("/retention", Use::Applied("the configuration's retention")),
    ("/ttlMinutes", Use::Later("step 3")),
    ("/outputs", Use::Later("step 4")),
    ("/checkpoints", Use::Later("M2")),
    ("/steps/maxTimeoutSeconds", Use::Later("step 4")),
    ("/secretPatterns", Use::Later("step 4")),
    ("/branches", Use::Applied("the fake source's branches")),
    // Each head's commit id is a commit the fake source holds; what its steps do is step 4's.
    ("/heads/*/note", Use::Note),
    ("/heads/*/steps", Use::Later("step 4")),
    ("/heads/*/files", Use::Later("step 4")),
    ("/machines[]/id", Use::Applied("a machine's record")),
    ("/machines[]/repository", Use::Applied("a machine's record")),
    ("/machines[]/for", Use::Applied("a machine's record")),
    ("/machines[]/size", Use::Applied("a machine's record")),
    ("/machines[]/state", Use::Applied("a machine's record")),
    (
        "/machines[]/destroyedBy",
        Use::Applied("a machine's record"),
    ),
    ("/machines[]/reason", Use::Applied("a machine's record")),
    ("/machines[]/note", Use::Note),
    (
        "/machines[]/runtime/present",
        Use::Applied("whether the fake runtime holds its container and volumes"),
    ),
    ("/machines[]/runtime/exits", Use::Later("step 7")),
    ("/machines[]/runs[]/id", Use::Applied("a run's record")),
    ("/machines[]/runs[]/head", Use::Applied("a run's record")),
    ("/machines[]/runs[]/base", Use::Applied("a run's record")),
    ("/machines[]/runs[]/state", Use::Applied("a run's record")),
    (
        "/machines[]/runs[]/stateBeforeRestart",
        Use::Applied("a run's record, still running"),
    ),
    ("/machines[]/runs[]/fault", Use::Applied("a run's record")),
    ("/machines[]/runs[]/failed", Use::Applied("a run's record")),
    ("/machines[]/runs[]/steps", Use::Applied("a run's record")),
    ("/machines[]/runs[]/note", Use::Note),
    (
        "/runtime/unlisted",
        Use::Applied("labelled objects the fake runtime holds and no record names"),
    ),
    ("/runtime/note", Use::Note),
    ("/records/note", Use::Note),
    ("/records/expired", Use::Later("step 8")),
];

/// Every leaf of `value` as a path of keys: a scalar, or a list of scalars.
pub(crate) fn leaves(value: &Value, path: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                leaves(child, &format!("{path}/{key}"), out);
            }
        }
        Value::Array(items) if items.iter().any(Value::is_object) => {
            for item in items {
                leaves(item, &format!("{path}[]"), out);
            }
        }
        _ => out.push(path.to_owned()),
    }
}

/// A path's keys; a list's `[]` is dropped, so `/heads/*/steps` covers `/heads/x/steps[]/code`.
fn segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|part| !part.is_empty())
        .map(|part| part.trim_end_matches("[]"))
        .collect()
}

/// The use of the part at `path`: the longest entry of [`PARTS`] that is a prefix of it.
pub(crate) fn part_of(path: &str) -> Option<(&'static str, Use)> {
    let path = segments(path);
    PARTS
        .iter()
        .copied()
        .filter(|(entry, _)| {
            let entry = segments(entry);
            entry.len() <= path.len()
                && entry
                    .iter()
                    .zip(&path)
                    .all(|(want, have)| *want == "*" || want == have)
        })
        .max_by_key(|(entry, _)| segments(entry).len())
}

/// A JSON value as a TOML value, inline: the configuration goes into `umbel.toml` as one
/// inline table. JSON's string escapes are TOML's basic-string escapes.
fn toml(value: &Value) -> String {
    match value {
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(_) => value.to_string(),
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(toml).collect::<Vec<_>>().join(", ")
        ),
        Value::Object(map) => format!(
            "{{ {} }}",
            map.iter()
                .map(|(key, value)| format!("{} = {}", Value::from(key.as_str()), toml(value)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Null => panic!("TOML has no null"),
    }
}

fn named(fixture: &Value, key: &str, entry: impl Fn(&Value) -> Value) -> Value {
    let mut out = Map::new();
    for item in fixture[key].as_array().into_iter().flatten() {
        let name = item["name"].as_str().unwrap().to_owned();
        out.insert(name, entry(item));
    }
    Value::Object(out)
}

/// The operator's configuration (`[plugins.loamos.config]`) the fixture describes.
pub(crate) fn config(fixture: &Value) -> Value {
    let mut capacity = json!({ "machines": fixture["capacity"]["machines"]["max"] });
    if let Some(disk) = fixture["capacity"].get("diskGb") {
        capacity["disk_gb"] = disk.clone();
    }
    if let Some(free) = fixture.get("minFreeDiskGb") {
        capacity["min_free_disk_gb"] = free.clone();
    }
    json!({
        "runtime": { "kind": fixture["host"]["runtime"]["kind"].as_str().unwrap_or("docker") },
        "images": named(fixture, "images", |image| json!({
            "reference": format!("{}@{}", image["name"].as_str().unwrap(), image["digest"].as_str().unwrap()),
            "toolchain": image["toolchain"],
        })),
        "sizes": named(fixture, "sizes", |size| json!({
            "cpus": size["cpus"],
            "memory_gb": size["memoryGb"],
            "disk_gb": size["diskGb"],
        })),
        "policies": named(fixture, "policies", |policy| json!({ "hosts": policy["hosts"] })),
        "repositories": named(fixture, "repositories", |repository| json!({
            "source": format!("fixture:{}", repository["name"].as_str().unwrap()),
            "base": repository["base"],
            "image": repository["image"],
            "size": repository.get("size").unwrap_or_else(|| panic!("a fixture repository names no size: {repository}")),
        })),
        "capacity": capacity,
        "retention": {
            "records_days": fixture["retention"]["recordsDays"],
            "logs_days": fixture["retention"]["logsDays"],
        },
    })
}

/// The workspace's `umbel.toml` for the fixture: one space and the plugin with its
/// configuration.
pub(crate) fn umbel_toml(fixture: &Value) -> String {
    format!(
        "config_version = 7\ndefault_space = \"main\"\n\n[spaces.main]\n\n[plugins]\nenabled = [\"loamos\"]\n\n[plugins.loamos]\nsource = \"compiled:loamos\"\nconfig = {}\n",
        toml(&config(fixture))
    )
}

fn text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}

fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{value}: {error}"))
}

fn run_record(machine: &str, run: &Value) -> RunRecord {
    let state = match (run.get("state"), run.get("stateBeforeRestart")) {
        (Some(state), _) | (None, Some(state)) => parse::<RunState>(state),
        (None, None) => panic!("a fixture run has no state: {run}"),
    };
    let steps = run["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|step| StepRecord {
            label: text(&step["label"]).unwrap(),
            args: parse(&step["args"]),
            env: None,
            timeout_seconds: step["timeoutSeconds"].as_u64(),
            network: text(&step["network"]).unwrap(),
            code: step["code"]
                .as_i64()
                .map(|code| i32::try_from(code).unwrap()),
            timed_out: None,
            duration_ms: None,
        })
        .collect();
    RunRecord {
        v: RECORD_VERSION,
        id: text(&run["id"]).unwrap(),
        machine: machine.to_owned(),
        head: text(&run["head"]).unwrap(),
        base: text(&run["base"]),
        tree: None,
        state,
        fault: text(&run["fault"]),
        failed: text(&run["failed"]),
        limit: None,
        reason: None,
        recovered: None,
        steps,
        started_at: None,
        ended_at: None,
    }
}

/// A fresh host seeded from a fixture, with handles on its fakes.
pub(crate) struct Seeded {
    /// The host, built as the binary builds it.
    pub(crate) host: umbel::Host,
    /// The fake runtime under it.
    pub(crate) runtime: Arc<FakeRuntime>,
    /// The fake git source.
    pub(crate) source: Arc<FakeSource>,
    /// The records.
    pub(crate) records: Arc<MemoryRecords>,
    /// The storage under the journal policies.
    pub(crate) storage: FlakyStorage,
    _dir: tempfile::TempDir,
}

/// The version the fake runtime answers with.
pub(crate) const RUNTIME_VERSION: &str = "29.9.3";

/// A fresh host from `fixture` (already merged over its base).
pub(crate) fn seed(fixture: &Value) -> Seeded {
    let runtime_part = &fixture["host"]["runtime"];
    let kind = runtime_part["kind"].as_str().unwrap_or("docker");
    let runtime = Arc::new(if runtime_part["reachable"] == json!(false) {
        FakeRuntime::unreachable(
            kind,
            runtime_part["reason"].as_str().unwrap_or("unreachable"),
        )
    } else {
        FakeRuntime::reachable(kind, RUNTIME_VERSION)
    });

    let storage = FlakyStorage::default();
    if fixture["journal"]["writable"] == json!(false) {
        storage.set_down(Some(
            fixture["journal"]["reason"]
                .as_str()
                .unwrap_or("the journal cannot be written"),
        ));
    }

    let source = Arc::new(FakeSource::default());
    for repository in fixture["repositories"].as_array().into_iter().flatten() {
        let name = repository["name"].as_str().unwrap();
        for (branch, commit) in fixture["branches"].as_object().into_iter().flatten() {
            source.branch(name, branch, commit.as_str().unwrap());
        }
        for commit in fixture["heads"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, _)| id)
        {
            source.commit(name, commit);
        }
    }

    let images: BTreeMap<&str, &str> = fixture["images"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|image| {
            (
                image["name"].as_str().unwrap(),
                image["digest"].as_str().unwrap(),
            )
        })
        .collect();
    let repositories: BTreeMap<&str, &Value> = fixture["repositories"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|repository| (repository["name"].as_str().unwrap(), repository))
        .collect();

    let records = Arc::new(MemoryRecords::default());
    for machine in fixture["machines"].as_array().into_iter().flatten() {
        let id = text(&machine["id"]).unwrap();
        let runs: Vec<RunRecord> = machine["runs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|run| run_record(&id, run))
            .collect();
        let state = match machine.get("state") {
            Some(state) => parse::<MachineState>(state),
            None if runs.iter().any(|run| run.state == RunState::Running) => MachineState::Busy,
            None => MachineState::Ready,
        };
        let repository = text(&machine["repository"]).unwrap();
        let image = repositories
            .get(repository.as_str())
            .and_then(|found| found["image"].as_str())
            .and_then(|name| {
                images.get(name).map(|digest| ImageRecord {
                    name: name.to_owned(),
                    digest: (*digest).to_owned(),
                })
            });
        let active = state.is_active();
        let present = machine["runtime"]["present"] != json!(false);
        let container = active.then(|| container_name(&id));
        let volumes: BTreeMap<String, String> = if active {
            MOUNTS
                .iter()
                .map(|mount| ((*mount).to_owned(), volume_name(&id, mount)))
                .collect()
        } else {
            BTreeMap::new()
        };
        if active && present {
            if let Some(name) = &container {
                runtime.hold_container(name, &id, 0);
            }
            for name in volumes.values() {
                runtime.hold_volume(name, &id, 0);
            }
        }
        records
            .put_machine(&MachineRecord {
                v: RECORD_VERSION,
                id: id.clone(),
                repository,
                branch: text(&machine["for"]).unwrap(),
                size: text(&machine["size"]),
                image: if active { image } else { None },
                state,
                created_at: None,
                expires_at: None,
                destroyed_at: None,
                destroyed_by: machine.get("destroyedBy").map(parse::<ActorRecord>),
                reason: text(&machine["reason"]),
                container,
                volumes,
            })
            .unwrap();
        for run in runs {
            records.put_run(&run).unwrap();
        }
    }

    for object in fixture["runtime"]["unlisted"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let name = object["name"].as_str().unwrap();
        let gb = object["sizeGb"].as_f64().unwrap_or(0.0);
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let bytes = (gb * 1e9) as u64;
        match object["kind"].as_str().unwrap() {
            "container" => runtime.hold_container(name, "unknown", bytes),
            "volume" => runtime.hold_volume(name, "unknown", bytes),
            other => panic!("an unlisted object of kind {other}"),
        }
    }

    let now = fixture["now"]
        .as_str()
        .map(|now| afd::ClockInstant::parse(now).unwrap_or_else(|error| panic!("now: {error}")));
    let (dir, root) = super::workspace(&umbel_toml(fixture));
    let plugin = LoamOs::default()
        .with_runtime(runtime.clone())
        .with_source(source.clone())
        .with_records(records.clone());
    let host = super::host(&root, plugin, Some(storage.clone()), now);
    Seeded {
        host,
        runtime,
        source,
        records,
        storage,
        _dir: dir,
    }
}
