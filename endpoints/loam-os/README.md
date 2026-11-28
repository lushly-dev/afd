# Loam OS host

The host process of [Loam OS](../../docs/features/active/loam-os/loam-os.proposal.md). It makes a
Linux machine (a container) for one piece of work, runs that work inside it with no credential,
keeps the record outside it, and destroys it afterwards. Progress lives in the feature's
[STATUS.md](../../docs/features/active/loam-os/STATUS.md).

It is a binary of its own on Umbel's host library (`endpoints/umbel`). One compiled plugin,
`loamos`, owns the `host`, `machine`, `run` and `checkpoint` domains. The MCP server announces
itself as `loam-os` (Umbel D206), and the host is exempt from Umbel's principle 11 (Umbel D207).

## What it has

- `host-status`: the host, its container runtime (Docker or Podman, through their command
  line), its journal, its machines, and everything the operator configured: repositories, images
  by digest, sizes, network policies, capacity and retention. It refuses nothing: an unreachable
  runtime is `reachable: false`, and records it cannot read leave `capacity.machines.active` and
  the `unlisted` counts `null` with a `RECORDS_UNREADABLE` warning. The journal is Umbel's required
  mode (D208, D221, D224): `journal.mode` is `required`, and `writable`, `pending` and `dropped`
  are read live from Umbel's `JournalHealth` handle. `capacity.usedGb` stays `null` until M1
  step 5 measures disk inside the runtime's virtual machine.
- Configuration checks in `workspace-doctor` (`plugins.config_checks`). These catch an image not
  pinned by digest, a repository naming an image or size that does not exist, disk too small for
  the most machines of the largest size, and a runtime that does not answer (a warning).
- Each command's journal policy (`JOURNAL_POLICIES` in `src/lib.rs`): what starts something is
  `required`, what stops something `buffered`, and reads `droppable`. Only `host-status` exists
  yet, so it is the one policy; a test fails when a command in the manifest has none. `install`
  builds the host the same way for the binary and the tests, and the host's own calls (the
  supervisor's and the reaper's, from M1 step 4) go through `call_as_service`, so each has a
  dispatch id (D221).
- The records of machines and runs (`src/records.rs`, below).
- The `Runtime` trait (`src/runtime.rs`): make and remove labelled containers and volumes, run a
  step and report its exit, kill a run's processes from outside, and read usage and disk.
  `CliRuntime` drives the Docker or Podman command line with each value as an argument of its
  own, never through a shell, and is tested against stand-in scripts. That holds for a program;
  a `runtime.command` that is a Windows batch file runs under `cmd.exe`, which Rust escapes the
  arguments for. A machine's container gets no network, no capabilities, no new privileges, no
  core files, an init process that reaps orphans and 2 GB of shared memory for Chromium, and is
  never pulled: its image must be on the runtime already. The `Source` trait
  (`src/source.rs`) is where a repository's commits come from; the bare mirror that fills it is
  step 4's.

There is no fake in `src/`: the fakes live in the test tree (`tests/it/support/fakes.rs`), so the
shipped binary has one runtime and one configuration schema. `machine-*`, `run-*` and
`checkpoint-*` arrive in the later steps of M1 and in M2
([the M1 plan](../../docs/features/active/loam-os/m1.plan.md)).

## Records

The host keeps a record of every machine and run it made, in the workspace's state and apart from
the journal: `state/loamos/records/machines/<id>.json` and `state/loamos/records/runs/<id>.json`.
They outlive the process, so a restart rebuilds from them and the runtime (step 7). Each record is
one JSON object with `v: 1`, in the camelCase the commands return, and an unknown field or another
version is an error that names the file.

A write goes to a temporary file beside the record (`.<id>.json.<pid>.<n>.tmp`), is synced, and is
renamed over the record; on Unix the directory is synced too. A crash therefore leaves the old
record or the new one, never a torn one, and a temporary file it leaves is never read as a record.

Why this layout, and not one file of lines or a database:

- **A crash cannot tear a record.** A rename replaces a file in one step on Linux, macOS and
  Windows. An appended log would need the torn-line handling Umbel's write-ahead file has, and a
  compaction it does not have yet.
- **A write touches one record.** A run's record changes at each step's end, and a machine's at
  each run; rewriting a whole file of every record on each change would grow with the host's
  history.
- **Keeping time is a file's age.** `host-prune` (step 8) removes an expired record by removing its
  file, with no compaction.
- **No second store.** The records are few (a lane makes a handful of machines a day) and read
  whole. An embedded database would add a dependency and a schema to migrate for no query the host
  needs, and Umbel's own stores belong to spaces and plugins with grants, not to the host's state.
- **An operator can read them** with any JSON tool when the host is down.

One host process writes them: callers reach the running server (step 10), and within it a write
excludes reads.

They share the state directory's disk with the journal. The proposal asks for space reserved apart
from the journal's ([The record](../../docs/features/active/loam-os/loam-os.proposal.md#the-record)),
and a separate directory does not reserve it: a full disk fails both. Stopping must still work
then, so step 7, which builds the journal-down path, decides how `machine-destroy` and the
supervisor carry out a stop whose record cannot be written.

## The scenario harness

`tests/it/scenarios.rs` runs the feature's `m1` scenarios
(`docs/features/active/loam-os/scenarios/`) in process, as Umbel's ideas plugin runs its own. Each
file gets a fresh host built by `install`, seeded from its fixture merged over the fixture's
`base` (`tests/it/support/fixture.rs`): the configuration in `umbel.toml`, a stopped clock at the
fixture's `now`, and fakes for the runtime, the git source and the records. Umbel's journal is
real; only the storage under its policies is faked, so it can fail writes as a full disk does.
Every call is the test actor's.

`SCENARIOS` holds how far each file runs before it reaches a command or behaviour not built yet,
and the step after that must not pass, so a step that builds one has to move its row. A step whose
command is built, whose earlier steps are not, and which reads nothing they returned also runs
alone against a fresh host. `fixture::PARTS` names what the harness does with each part of a
fixture, or the step that will use it, and a test fails on a part it does not name. CI runs the
harness when the scenarios or fixtures change.

## Run it

```sh
cd endpoints/loam-os
cargo build --release
mkdir -p ~/loam-os && cp examples/umbel.toml ~/loam-os/   # then edit the image digest and paths
./target/release/loam-os --workspace ~/loam-os call workspace-doctor
./target/release/loam-os --workspace ~/loam-os call host-status
./target/release/loam-os --workspace ~/loam-os serve --http --bind 127.0.0.1:7420   # MCP on loopback
```

`host-status` drives the runtime through `docker` or `podman` with fixed arguments (`version`,
`ps`, `volume ls`), never with a caller's input. The rest of `CliRuntime` has run only against
stand-in scripts, and no command calls it yet. Only Docker has been run so far: 29.9.3 on Hero, and
29.5.2 in Colima on the lane host, `random`, where the launchd service from the image runbook ran
too (both 2026-11-26). The Podman path is the same command line and has not been tried on a Podman
host.

The command line is Umbel's (`loam-os --help`). [`examples/umbel.toml`](examples/umbel.toml) is
a complete workspace, and `schemas/config.schema.json` says what each key of
`[plugins.loamos.config]` means. Building the session image and pinning it is in
[the image runbook](../../docs/operations/loam-os-image.md).

## Check it

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --no-fail-fast --locked
```

This unit is its own Cargo workspace with a committed `Cargo.lock`. It builds Umbel's crates by
path, on the toolchain Umbel pins. CI runs it in `umbel.yml`'s `loam-os` job whenever it, Umbel
or the afd crate changes.
