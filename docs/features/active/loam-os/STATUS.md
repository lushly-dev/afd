# Loam OS: status

Epic: [#2595](https://github.com/lushly-dev/afd/issues/2595).

Read this before the [proposal](loam-os.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../../active/patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- Each step has its own line in [Steps](#steps), made before the step starts. No sentence here
  says which steps are done or next.

## Status block

- **State:** active. Drafted 2026-11-21 as `proposed/agent-os` against `main` at `a91acface`,
  revised after five-reader path walks and two independent reviews ([#1912](https://github.com/lushly-dev/afd/pull/1912)),
  revised again on 2026-11-22 after a fresh end-to-end review against `main` at `39ca857fd`
  ([#2121](https://github.com/lushly-dev/afd/pull/2121)), and approved and promoted to `active/loam-os`
  by the owner on 2026-11-25.
- **Epic:** [#2595](https://github.com/lushly-dev/afd/issues/2595).
- **Decided by the owner:**
  - **2026-11-21:** commands first with no interface in M0–M3; a machine per session as the first
    form; authority outside the machine; a separate binary on Umbel's host library; a branch's
    validation run as the first workload; AFD inside a machine from M3 and not before; Umbel's
    journal rule and principle 11 bend for this binary; from M1 a cell may repeat a failed run in
    a machine of its own.
  - **2026-11-25:** named **Loam OS**; full desktop/OS UI beyond M5 built on AFD with a web-based
    Loam shell (no standalone headless-only product edition); all 18 jobs kept in proposed build
    order; lives in `afd` under `endpoints/` for M0–M4 (revisit splitting out at M5); minimal
    headless Ubuntu LTS base for M0–M4; hand-built digest-pinned images in M0–M1; no container
    runtime preference before M0 benchmarks; Linux-only validation including `coverage` (rely on CI
    for macOS/Windows); hook-free lane push in M1 via `main`'s verify-record check; Factory Gateway
    G4 amended at M1 exit. The proposal's [Decisions](loam-os.proposal.md#decisions) has the full
    table.
- **Built:** see [Steps](#steps); what has been measured is in
  [M0 measurements](#m0-measurements) (Hero) and [M0 measurements on random](#m0-measurements-on-random)
  (the lane host).
- **Last verified:** 2026-11-22, the scenario checks below, on `main` at `d91d228a5` on Node 26.13.1.

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Draft the proposal | Merged in [#1912](https://github.com/lushly-dev/afd/pull/1912) | [`loam-os.proposal.md`](loam-os.proposal.md) |
| Write the jobs as scenarios | Merged in [#1912](https://github.com/lushly-dev/afd/pull/1912) | [`scenarios/`](scenarios/), 18 files, 131 steps |
| Check the scenarios | Run 2026-11-22, after the end-to-end review revision | [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with readers who did not write them | Walked 2026-11-21 by three readers, one in each seat, a second pass by a fourth after the revision, and a walk of job 18 by a fifth | Proposal, [Walking the paths](loam-os.proposal.md#walking-the-paths) |
| Independent review of the proposal | Reviewed 2026-11-21 by two reviewers and revised; a focused pass then checked the fixes; end-to-end review merged in [#2121](https://github.com/lushly-dev/afd/pull/2121) | [How it was reviewed](#how-it-was-reviewed) |
| The owner cuts, adds and ranks the jobs, and answers the proposal's [For the owner](loam-os.proposal.md#for-the-owner) | Approved 2026-11-25; promoted to `active/loam-os` in [#2598](https://github.com/lushly-dev/afd/pull/2598) | Proposal, [Decisions](loam-os.proposal.md#decisions); Epic [#2595](https://github.com/lushly-dev/afd/issues/2595) |
| M0: stand it up | **Exited 2026-11-27** ([#2596](https://github.com/lushly-dev/afd/issues/2596)): all three exit criteria hold. `host-status` answers over MCP on the lane host and names the image by digest; `pnpm verify --all` on `main` at `f2d827efa` passed 171 of 171 steps in a fresh container from `loam-os-session@sha256:1403e876…`, in 7790 s (2 h 10 min; run 7); and the open M0 items and Umbel's outcomes are settled in writing below (Colima's start at a login, a follow-up outside M0's "settles", stays open). Before that, planned in [#2596](https://github.com/lushly-dev/afd/issues/2596) and not exited: on 2026-11-26 `host-status` answered on the lane host with the image by digest and the "Not verified" items were settled in writing, and `pnpm verify --all` on `main` did not yet pass there in full ([#2799](https://github.com/lushly-dev/afd/issues/2799)); see the exit row below. Still not exited on 2026-11-27: #2799 is fixed, and three more full runs each failed one step on an intermittent test, [#2855](https://github.com/lushly-dev/afd/issues/2855) once and [#2872](https://github.com/lushly-dev/afd/issues/2872) twice, both fixed since | Proposal, [M0](loam-os.proposal.md#m0-stand-it-up); [M0 measurements on random](#m0-measurements-on-random) |
| M0: Umbel's seams for the host, a server identity option and plugin configuration checks, and decisions D206 to D208 ([#2616](https://github.com/lushly-dev/afd/issues/2616)) | Merged in [#2629](https://github.com/lushly-dev/afd/pull/2629) | Umbel [decisions](../../../../endpoints/umbel/docs/decisions.md) D206 to D208 |
| M0: the host unit with `host-status`, configuration checks and a fake runtime ([#2617](https://github.com/lushly-dev/afd/issues/2617)) | Merged in [#2669](https://github.com/lushly-dev/afd/pull/2669) | [`endpoints/loam-os/`](../../../../endpoints/loam-os/README.md); `host-status` answered against Docker 29.9.3 (linux/amd64) on Hero, 2026-11-26; the service files in the [image runbook](../../../operations/loam-os-image.md#install-the-host-as-a-service) are not yet run on any machine (superseded 2026-11-26: the launchd agent ran on `random`, [M0 measurements on random](#m0-measurements-on-random)) |
| M0: the session image and its runbook ([#2618](https://github.com/lushly-dev/afd/issues/2618)) | Merged in [#2664](https://github.com/lushly-dev/afd/pull/2664). Built and checked on Hero (amd64) 2026-11-26: `pnpm verify --all` on `main` at `4a5118f69` passes in it, 167 of 167 steps. Not yet built or checked on the lane host (`random`, arm64) (superseded 2026-11-26: built, pinned and checked there, [M0 measurements on random](#m0-measurements-on-random)) | [`endpoints/loam-os/image/`](../../../../endpoints/loam-os/image/), [runbook](../../../operations/loam-os-image.md), [M0 measurements](#m0-measurements) |
| M0: exit on the lane host ([#2596](https://github.com/lushly-dev/afd/issues/2596)): Colima on `random`, the image built and pinned there, `host-status` and the service, `pnpm verify --all` in it, and what M0 settles | Run 2026-11-26 in [#2810](https://github.com/lushly-dev/afd/pull/2810), against the proposal's M0 exit and the "settles" it lists. `host-status` answers on `random` and names the image by digest: holds. The open M0 items and Umbel's outcomes settled in writing: holds. `pnpm verify --all` on `main` passes in a container from the image: does not hold yet. Run 3, on `660ecec09`, passed 170 of 171 steps in 10600 s; the check failed on one test that fails every check on this host, from the disk's sync latency ([#2799](https://github.com/lushly-dev/afd/issues/2799)). The criterion holds when a full run passes. Re-run 2026-11-27 in [#2878](https://github.com/lushly-dev/afd/pull/2878) (random's runs 4 to 6, 2 h 23 min to 2 h 26 min each): `host-status` still answers over MCP on `127.0.0.1:7420` and names the image by digest, and the check passed every time with #2799 fixed. Each run failed one step, and each failure was re-run alone. Run 4 failed the mail engine's CLI test, which passed every re-run, 30 times alone and 60 in its test binary ([#2855](https://github.com/lushly-dev/afd/issues/2855)). Runs 5 and 6 failed `loam-web`'s `P4-E9` keybindings test, which failed 4 of 20 alone with the container otherwise idle ([#2872](https://github.com/lushly-dev/afd/issues/2872)). Still does not hold: M0 waits for a full pass, and #2872 is the failure that recurs (superseded 2026-11-27 by run 7). Run 7, 2026-11-27, in [#2903](https://github.com/lushly-dev/afd/pull/2903): **holds; M0 has exited** ([run 7](#2026-11-27-run-7-the-exit-run-on-random)) | [M0 measurements on random](#m0-measurements-on-random), [What is not verified](#what-is-not-verified), [runbook](../../../operations/loam-os-image.md#container-runtime-on-random) |
| M1: validation in a machine | Planned in [the M1 plan](m1.plan.md) ([#2932](https://github.com/lushly-dev/afd/pull/2932)): 13 steps, [#2913](https://github.com/lushly-dev/afd/issues/2913) to [#2925](https://github.com/lushly-dev/afd/issues/2925) | Proposal, [M1](loam-os.proposal.md#m1-mvp-validation-in-a-machine); [m1.plan.md](m1.plan.md) |
| M1 step 1: Umbel's required journal ([#2913](https://github.com/lushly-dev/afd/issues/2913)) | In review in [#2947](https://github.com/lushly-dev/afd/pull/2947): built and tested in Umbel's own tests (the scenarios' harness is step 2) | Umbel [D224](../../../../endpoints/umbel/docs/decisions.md), [`journal_policy.rs`](../../../../endpoints/umbel/src/journal_policy.rs) |
| M2: warm starts | Not started | Proposal, [M2](loam-os.proposal.md#m2-warm-starts) |
| M3 to M5 | Direction only, with no scenarios and no exit. M3 is specified when M1 exits, M4 when M3 exits and M5 when M4 exits | Proposal, [Milestones](loam-os.proposal.md#milestones) |

## M0 measurements

### 2026-11-26: the session image on Hero (amd64)

Measured on Hero (Windows 11, Docker Desktop with BuildKit 0.34.2, a linux/amd64 engine given
32 processors and 31 GiB). **These are not the lane host's numbers:** `random` is Apple silicon,
so its machines are arm64, and nothing has been built or run there yet (superseded 2026-11-26:
[M0 measurements on random](#m0-measurements-on-random)). Other sessions used
Hero, and at times its container engine, throughout, so durations are upper bounds.

**The image**, built from [`endpoints/loam-os/image/Containerfile`](../../../../endpoints/loam-os/image/Containerfile)
as it merges here (Ubuntu 26.04):

| | amd64 | arm64 |
| --- | --- | --- |
| Index digest (containerd store, `docker images --digests`) | `sha256:8ceeab5dd94e46b644a7ff81fb3aeaf257d03b43fa6c5556a1a72df58787213e` | `sha256:c82179c16cec89fdd3bc96f481a61e3e571c23b72fce7ff2c332be0aac421902` |
| Size, unpacked / compressed layers | 5.24 GB / 1.38 GB | 5.02 GB / 1.33 GB |
| Build time | 286 s, from nothing but the uv stage | 607 s under QEMU emulation; toolchain smoke-checked (`node`, `pnpm`, `rustc` with `wasm32-wasip2`, Python, Git, CMake, both browsers, WebKitGTK), no suite run |

Runs 4 and 5 used the build before a comment in the file was corrected, `sha256:a9c6df1b…`: the
same layers and creation time, with only the index's provenance attestation different.
These digests are Hero's local builds and pin nothing: the image to pin is the one built on the
lane host (runbook, [Pin it by digest](../../../operations/loam-os-image.md#pin-it-by-digest)).

**`pnpm verify --all` in it**, run as `agent` in a container (`--init --shm-size=2g`, the
default seccomp profile, no added privileges) from a clean clone made inside it, with
`--keep-going`. Runs 1 to 3 used earlier versions of the file on Ubuntu 24.04; independent
review then found that CI's `ubuntu-latest` has been 26.04 since 2026-10-30, and the file moved
to it for runs 4 and 5:

| Run | Image | `main` | Result | Time |
| --- | --- | --- | --- | --- |
| 1 | 24.04, the first version | `7e75987e9` | 160 of 167 steps pass | Clone 30 s, install 21 s, verify 6832 s |
| 2 | 24.04, with run 1's fixes | `7e75987e9` | 167 of 167 pass | Clone 28 s, install 10 s, verify 6686 s; another session's two verify containers ran during its first 30 minutes |
| 3 | Run 2's container, network removed | `7e75987e9` | 163 of 167 pass | Every `node_modules` removed, `pnpm install --frozen-lockfile --offline` 1 s, verify 5631 s |
| 4 | 26.04, as merged | `4a5118f69` | **167 of 167 pass** | Clone 30 s, install 9 s, verify 6612 s (1 h 50 min) |
| 5 | Run 4's container, network removed | `4a5118f69` | 163 of 167 pass, the same four as run 3 | Every `node_modules` removed, offline install 1 s, verify 5482 s |

Run 4's time by workflow, in seconds: `loam.yml` 2208 (`test:browser` 1002 and `test:walk` 855
of it), `loam-plugins.yml` 1349 (the mail engine's two debug test runs, 637 and 629),
`specimen.yml` 984, `umbel.yml` 519, `cpp.yml` 234, `rust.yml` 224, `conformance.yml` 217,
`botcore-factory.yml` 182, the check 155, `botcore.yml` 139, `fast-af.yml` 89, `loam-desktop.yml`
83, `python.yml` 79, `hosted-fixtures.yml` 67, `violet.yml` 47, and under 20 each for
`health-dashboard.yml`, `alfred.yml`, `auth-browser.yml` and `health.yml`.

After runs 4 and 5 the container held 53 GB beyond the image (run 1's, on 24.04, held 67 GB):
dependencies, every workspace's `target` and the caches. A machine's `build` and `downloads`
volumes need room for that.

**Run 1's failures, and what changed.** Seven steps failed: six because of the image and one
flaky test.

- Specimen's Chromium did not start (`test:specimen`, `test:stories`, loam-web's
  `test:browser`, loam-app-violet's `test:specimen`): the runtime's default seccomp profile
  refuses the user namespace Chromium's sandbox needs, and the Specimen host cannot see that in
  the kernel's settings. The image sets `SPECIMEN_CHROMIUM_SANDBOX=0`, the switch
  `foundations/specimen/README.md` names for a container.
- The browsers were in a shared, root-owned `PLAYWRIGHT_BROWSERS_PATH`. Better Auth's
  hosted-fixture runner starts with only `PATH`, `HOME` and `TMPDIR`, so it did not find them
  (`hosted-fixtures.yml`), and Specimen's packed-consumer check inside `test:specimen`
  (`tests/consumers/specimen/verify-artifacts.mjs`) could not install into it. They are now in
  the user's default `~/.cache/ms-playwright`, as on CI.
- Ubuntu 24.04's Git 2.43 prints a UTC `%aI` as `+00:00`, and a botcore-factory test expects
  the `Z` of later Git. Run 2 took Git from the git-core PPA; on 26.04 the archive's Git 2.53
  prints `Z`. The test is [#2636](https://github.com/lushly-dev/afd/issues/2636).
- Umbel's `two_writer_processes_and_a_reader_here` ran past its store lock's timeout under the
  run's load. Alone it passed three times out of three, and it passed in runs 2 and 4:
  [#2637](https://github.com/lushly-dev/afd/issues/2637).

No suite failed only because it ran on Linux.

**With no network (runs 3 and 5).** The proposal's aim is an install step under `registries`
and a validate step under `none` ([Network](loam-os.proposal.md#network)). After an online
install and a full run, `pnpm install --offline` relinks every `node_modules` from the store, and
Cargo, uv's environments, CMake's fetched dependencies and the browsers all run from what the
first run left. The same four steps failed both times:

- Three build a wheel with build isolation, and uv asks PyPI for the build backend
  (`setuptools`, `hatchling`): health-dashboard's `verify-health-isolation.mjs` and the
  `package_smoke.py` of Botcore and Health. With `UV_OFFLINE=1` all three pass with no
  network, on both images, so a validate step under `none` needs the host to set it.
- botcore-factory's `test_push_uses_the_worktree_record_accepted_by_the_real_pre_push_decision`
  read the verify record the previous run had written in the clone: `scripts/pre-push.mjs`
  resolves the record's path against its own checkout, which shows on a second run in one
  primary clone, network or not ([#2659](https://github.com/lushly-dev/afd/issues/2659)).

So, given `UV_OFFLINE=1`, this repository validates with no network once its install step has
fetched (corrected 2026-11-26: runs 3 and 5 reused a container after a full online run, so what is
shown is no network after an online run has fetched and built; after the install step alone is
M1's to measure, [What is not verified](#what-is-not-verified)). Which hosts that install step
reaches is not yet measured (superseded 2026-11-26: measured through a proxy on `random`,
[M0 measurements on random](#m0-measurements-on-random)).

## M0 measurements on random

### 2026-11-26: the lane host (arm64)

Measured on `random`, the lane host: a Mac mini with an Apple M4 (10 cores, 24 GB), macOS 27.2.
The runtime is Colima 0.10.3 (Lima 2.3.0, Apple's Virtualization framework with Rosetta,
virtiofs), installed that day at the owner's word; its engine is Docker 29.5.2 for linux/arm64
with the containerd image store. Its virtual machine has 6 processors, 16 GB and a 200 GB disk,
kept on the external Dev volume ([runbook](../../../operations/loam-os-image.md#container-runtime-on-random)).
The factory's and Lushly's lanes ran throughout: sampled every five minutes during run 1, the
host's load average was between 14 and 189, and macOS reported 35 to 62 % of memory free. All
durations are upper bounds.

**The image**, built natively for linux/arm64 from the container file on `main` at `0c3f113c7`,
with `docker buildx build --platform linux/arm64 --load`:

| | random (arm64, native) |
| --- | --- |
| Index digest | `sha256:1403e876e7d7e29def2c85ebd13744736a5d239dbeaeb1c8956a5f513ccb6e67` |
| Size, unpacked / compressed layers | 5.02 GB / 1.33 GB |
| Build time | 405 s from an empty cache, unpacking into the image store 108 s of it (Hero's arm64 build under emulation: 607 s) |

This is the digest the lane host pins (`~/loam-os/umbel.toml`).

**The host.** `cargo install --path . --locked --root ~/.local` from `endpoints/loam-os` took
456 s on four jobs, beside the image build. From the repository's root,
`cargo install --path endpoints/loam-os` picked the default toolchain (1.94) instead of the unit's
1.100.0 and refused, so the runbook now says to install from the unit's folder. In the workspace
`~/loam-os` (`command = "/opt/homebrew/bin/docker"`, one repository, the `afd` checkout as its
`source`, a size of 6 processors, 14 GB and 80 GB, capacity for one machine and 180 GB with 20 GB
kept free):

- `workspace-doctor`: every check passes, `plugins.config_checks` included.
- `host-status`: `runtime` `{ kind: docker, version: 29.5.2, reachable: true, error: null }`, the
  image by the digest above with its toolchain (Node 26.13.1, pnpm 12.22.0, Rust 1.100.0),
  `unlisted` `{ containers: 0, volumes: 0, error: null }`, the journal `best-effort` (Umbel D208),
  0.4 s a call.
- **The service.** The runbook's launchd agent on `127.0.0.1:7420` ran as written: launchd kept it
  up, `host-status` over MCP answered with the runtime reachable, a call without the bearer token
  got HTTP 401, and `loam-os call host-status` still answered beside it. The workspace stays on
  the internal disk: a job launchd starts cannot read the external Dev volume until macOS has its
  consent for that binary ([runbook](../../../operations/loam-os-image.md#container-runtime-on-random)). The
  Docker client still reaches Colima's socket there.

**`pnpm verify --all` in it**, as on Hero: as `agent` in a container (`--init --shm-size=2g`, the
default seccomp profile, no added privileges), from a clean clone made inside it, with
`--keep-going`:

| Run | `main` | Result | Time |
| --- | --- | --- | --- |
| 1 | `0c3f113c7` | 167 of 170 steps pass | Clone 14 s, install 6 s, verify 12716 s (3 h 32 min) |
| 2 | Run 1's container, network removed, `UV_OFFLINE=1` | 167 of 170 pass | Every `node_modules` removed, `pnpm install --frozen-lockfile --offline` 4 s, verify 7113 s (1 h 59 min) |
| 3 | `660ecec09`, a fresh container | 170 of 171 pass | Clone 16 s, install 6 s, verify 10600 s (2 h 57 min) |

Run 3's one failure was the check, on the todo backend's thousand-writes test alone
([#2799](https://github.com/lushly-dev/afd/issues/2799)): every other step passed, among them
`test:stories` ([#2767](https://github.com/lushly-dev/afd/issues/2767)) and Umbel's store tests
([#2800](https://github.com/lushly-dev/afd/issues/2800)). By then `main` had
[#2701](https://github.com/lushly-dev/afd/pull/2701) (the child processes' lock wait) and
[#2731](https://github.com/lushly-dev/afd/pull/2731) (the pack check's remounting), though neither
addresses #2800 or the page deadline of #2767, so passing here shows less load, not a fix. In the same container, `pnpm check:all` on its own failed on that test again (15,483 ms) at a
host load average of 8 to 12, so the check's own parallel tests are load enough; with
`TMPDIR=/dev/shm`, where the test's database syncs cost nothing, the check did not fail on it.
Run 3 took 10600 s against run 1's 12716 s, with the host less loaded in the evening: `loam.yml`
3206 s, `loam-plugins.yml` 2103, `specimen.yml` 1162, `umbel.yml` 1147, `rust.yml` 836.

Run 1's time by workflow, in seconds: `loam.yml` 3633 (`test:browser` 1746 and `test:walk` 1182
of it), `umbel.yml` 2094 (its workspace tests 1257), `loam-plugins.yml` 2087 (the mail engine's
two debug test runs, 969 and 893), `rust.yml` 1365, `specimen.yml` 1029, `conformance.yml` 386,
the check 369, `cpp.yml` 364, `loam-desktop.yml` 311, `fast-af.yml` 285, `botcore-factory.yml`
280, `botcore.yml` 176, `python.yml` 115, `hosted-fixtures.yml` 84, `violet.yml` 68, and under
40 each for `health-dashboard.yml`, `auth-browser.yml`, `alfred.yml` and `health.yml`. Against
Hero's run 4 (6612 s on 32 processors), this machine took about twice as long on 6: the Rust
and browser suites, which use every processor, grew the most.

The container peaked at 12.2 GB of memory (Umbel's workspace tests) and held 54.8 GB beyond the
image after the run. The virtual machine's data disk then took 63 GB on the Dev volume.

**Run 1's three failures, each re-run on its own in the same container:**

- The check: `src/store/sqlite.test.ts > SqliteStore > keeps order past a thousand writes in one
  millisecond` in the TypeScript todo backend timed out at Vitest's 5 s while the check ran every
  package's tests at once. Alone it passed three times out of three, and the package's whole suite
  passed. It makes 1,500 writes, each synced to disk (local-db's SQLite adapter sets
  `synchronous = FULL`), on a virtual disk that is a file on an external USB SSD, and it failed in
  every full run here: [#2799](https://github.com/lushly-dev/afd/issues/2799). **Load on the
  disk**: run 3 below shows the check alone fails it, and that it passes with its temporary files
  on tmpfs.
- `umbel.yml`'s `cargo test -p umbel-store -p umbel-store-embedded`: four tests failed on
  `busy: a lock wait ran past the lock timeout`. Their writers in child processes are
  [#2637](https://github.com/lushly-dev/afd/issues/2637), and
  [#2701](https://github.com/lushly-dev/afd/pull/2701), merged after `0c3f113c7`, gives those
  children 60 s. One of them, `memory_conformance::the_memory_groups_pass`, failed on both a child
  process case (`two_processes_write_densely`) and `two_threads_write_densely_and_read_their_writes`,
  which contends between two threads in one process on the default 5 s that #2701 does not change:
  [#2800](https://github.com/lushly-dev/afd/issues/2800). Alone the command failed once and passed
  once. **Load**; the child-process part fixed on `main` since.
- `specimen.yml`'s `pnpm test:stories`: all 410 stories passed, then opening a page ran past
  Specimen's 10 s deadline. It failed the same way re-run alone, in a sequence of re-runs that began at a
  host load average of 33 (one-minute), passed when the host's was between 6 and 13 (536 s), and passed again with six
  busy loops inside the container (983 s; the host's 11 at its start). So it follows the load
  outside the virtual machine, not inside it; that is an inference from four runs, not a
  measurement of the cause.
  [#2767](https://github.com/lushly-dev/afd/issues/2767). **Load.**

No step failed because it ran on arm64 or on Linux.

**With no network (run 2).** After run 1 and its re-runs, the container's network was removed
(a request to the npm registry failed), every `node_modules` removed and relinked offline, and
`pnpm verify --all --keep-going` run with `UV_OFFLINE=1`. Nothing failed for want of the network:
the three steps that build a wheel with build isolation (health-dashboard's
`verify-health-isolation.mjs`, the `package_smoke.py` of Botcore and Health) passed, as on Hero
with `UV_OFFLINE=1`, and so did `pnpm test:stories`, whose `violet-message-media` story asks MDN
for audio ([#2752](https://github.com/lushly-dev/afd/issues/2752)). botcore-factory's tests passed
too: run 1 failed, so it wrote no verify record for them to read
([#2659](https://github.com/lushly-dev/afd/issues/2659), fixed since by
[#2692](https://github.com/lushly-dev/afd/pull/2692)). Three steps failed, each on a timing limit.
The failing tests of the first two passed alone in the same container with no network; the steps
themselves were not re-run whole after run 2:

- The check: the todo backend's thousand-writes test again ([#2799](https://github.com/lushly-dev/afd/issues/2799)), and the Loam kernel's
  `mounted-approvals.test.ts` > `P5-A6` > `asks once with the preview; …` at Vitest's 5 s. Alone,
  three times each, they passed: the todo test in 2.8 to 3.3 s, over half its limit, and the
  kernel test file in about 4 s. The kernel package's whole suite passed too (34 s); the todo
  package's had passed alone after run 1. **Load.**
- `fast-af.yml`'s `violet-elements test:browser`: `violet-data-grid.spec.ts` > `bounds 10k by 61
  presentation work and reuses sort keys across direction changes` measured 546.8 ms against its
  500 ms budget. Alone it passed three times, and the whole suite once. **Load.**
- Umbel's store tests: only `two_threads_write_densely_and_read_their_writes`
  ([#2800](https://github.com/lushly-dev/afd/issues/2800)) failed, behind
  `conformance::the_suite_passes`. It was not re-run after run 2; its only re-run alone is run 1's
  (failed once, passed once). **Load.**

Run 2 took 7113 s against run 1's 12716 s because every Rust build and the C++ build were already
done: `loam.yml` 2644 s, `loam-plugins.yml` 1501, `specimen.yml` 920, `umbel.yml` 706.

So on this host too, given `UV_OFFLINE=1`, this repository validates with no network once an
online run has fetched and built.

**Through a proxy.** In a second container on an internal network whose only way out was a
logging proxy (tinyproxy, `HTTPS_PROXY` and `HTTP_PROXY` set), the install step alone, on `main`
at `0c3f113c7`, took 159 s, and every part passed: the clone (38 s), `pnpm install
--frozen-lockfile` (30 s), `uv sync` in the six uv projects, `cargo fetch --locked` in the seven
Cargo workspaces, and CMake's configure of `packages/cpp`. A direct connection from it was
refused. pnpm, git, uv, Cargo and CMake all honoured the proxy. It opened connections to eight
hosts: `registry.npmjs.org` (876), `files.pythonhosted.org` (198), `static.crates.io` (10),
`index.crates.io` (7), `pypi.org` (2), and three that the example's `registries` policy does not
list: `github.com` (the clone, and CMake's `FetchContent`), `release-assets.githubusercontent.com`
and `raw.githubusercontent.com` (CMake's `FetchContent` of the C++ dependencies). Nothing reached
`cdn.playwright.dev`: the browsers are in the image. In M1 the clone comes from the host's mirror,
but CMake still asks `github.com` first (`packages/cpp/cmake/AfdDependencies.cmake` downloads from
`github.com/…/releases/download/…`, which redirects), so `registries` needs all three GitHub hosts
beyond what it lists, or the C++ dependencies in the image.

**Disk limits and which disk.** With the containerd snapshotter on ext4, Docker accepts
`--storage-opt size=1G` and ignores it: a container started with it wrote 1.5 GB into its root.
The engine's data disk is one ext4 file system for every container, so a machine's disk limit
cannot come from the runtime here. Inside the virtual machine, `df` on `/var/lib/docker` is what
the machines use. On the host, the data disk is a sparse file that grows as the machine writes
and does not shrink when it deletes: after run 1's container was removed, the virtual machine's
file system went from 59 GB used to 8 GB, while the file on the Dev volume stayed at 73 GB until
`fstrim -v /var/lib/docker` in the virtual machine (6 s, 65 GB trimmed) brought it to 9.5 GB. The
file system is mounted without `discard`; Ubuntu's weekly `fstrim.timer` is the only trim. So the
host must measure inside the virtual machine, or trim after it destroys a machine, before it
compares disk use with its level before a run (M1's exit).

**Checkpoints.** The engine has no experimental mode and no CRIU, so `docker checkpoint` is not
available: a checkpoint here is a file system, not a process. `docker commit` of run 1's
container after both runs (about 55 GB of changes beyond the image: dependencies, every `target`
and the caches) had written about 8 GB into the image store after 21 minutes, when it was
cancelled; the virtual machine's disk went back to where it was. It did not finish in 21 minutes;
at that rate, an estimate, a whole-container commit would take more than two hours. So a committed
container is not a usable checkpoint here. Keeping the warm state in volumes that can be
snapshotted or copied (the dependency stores and build directories) is untried; M2 measures it.

**The journal.** Twenty `host-status` calls added 1,420 bytes each to `state/journal.jsonl`: the
whole result is written, not a digest. A lane that reads `host-status` every 10 s would add about
12 MB a day.

**A cell's commit that is not queued.** A commit made with `git commit-tree` in a worktree, with no
ref anywhere, sits in the object store the worktrees share with the lane's checkout. Into an empty
bare mirror, `git fetch <the lane's checkout> <sha>` over protocol version 2 (Git 2.54's default)
fetched it with its history in 3 s; into a mirror already holding `main`, in 0.07 s. (The source
was the lane host's primary checkout, which the worktrees' objects live in.) Protocol
version 0 refuses it (`Server does not allow request for unadvertised object`), so the host must not
force version 0.

**Copying a checkout's history.** `main`'s history is 1,911 commits in a 47 MB pack. On the host,
from that mirror, a clone took about 5 s (49 MB of `.git`, 162 MB with the working tree), a
shallow clone 8 s (28 MB) and `--shared` 10 s; the host's load made those noisy, and checking the
tree out costs the most. A clone of every branch from GitHub inside the container took 14 s (351
MB of `.git`). Either is negligible beside a validation of more than three hours.

**The cost of the runtime.** The virtual machine took 43 s to start the first time. Apple's
Virtualization framework showed its full 16 GB resident while it ran, leaving the lanes about 8 GB.
Nothing it keeps is on the internal disk except Colima's 322 MB download cache. Its LaunchAgent
(`dev.lushly.colima`) runs `colima start` under launchd. Its first run waited about nine minutes,
most likely for macOS's consent to read the external volume, given at the screen, and then found
the virtual machine already up; with the virtual machine stopped, a kick of the agent started it
within 25 s. Logging in again has not been tried ([runbook](../../../operations/loam-os-image.md#container-runtime-on-random)) (checked
2026-11-27: still not tried, since `random` has not restarted or been logged in to since; see below).

### 2026-11-27: the re-run on random

The same host, the same Colima virtual machine (6 processors, 16 GB, 200 GB) and the same pinned
image, `sha256:1403e876…`, still present by digest. The container file and every pin it reads
(`rust-toolchain.toml`, `.nvmrc`, `packageManager`) were unchanged on `main` since `0c3f113c7`, so
the image was not rebuilt. The runs follow the runbook's
[Check it before use](../../../operations/loam-os-image.md#check-it-before-use) with the same flags
and no other limits. Each one cloned `main` into a fresh container, as `agent`.

**Did Colima start after login? Not tested: there has been no login.** `random` last started on
2026-11-22 at 14:24 (`last reboot`, `kern.boottime`). Its console login from 14:25 that day is
still open, and later entries in `last` are terminal sessions only. The LaunchAgent was installed
on 2026-11-26 at 12:18, after both. At 00:42 on 2026-11-27:

- `colima status`: running (Virtualization framework, aarch64, docker, virtiofs).
- `launchctl print gui/501/dev.lushly.colima`: `state = not running` (it runs `colima start` and
  exits), `runs = 26`, `last exit code = 0`.
- The agent's log: 25 runs between 12:28 and 22:12 on 2026-11-26 printed
  `already running, ignoring`. One at 22:29:51 started the machine (ready at 22:30:08), which
  matches the M0 exit session's kick of the agent with the machine stopped.

So `RunAtLoad` at a real login is still unproven. The repeated runs are most likely
`StartOnMount`, which runs the agent at every volume mount, and they cost nothing while the machine
is up. Nobody logged out or restarted the machine to test it.

**Load and disk at the start** (00:42): load average 5.45, 5.59, 7.65; `top` showed 22 GB of 24 GB physical memory
used, cache included. No containers. The internal disk had 45 GB free and the Dev volume 473 GB. Inside the virtual
machine, `/var/lib/docker` had 4.7 GB used of 196 GB, and the data disk's file took 5.9 GB on the
Dev volume. The factory's and Lushly's lanes ran throughout. Sampled every five minutes, the host's
one-minute load average was 4.8 to 49.6 in run 4, 4.5 to 109 in run 5 and 3.2 to 114 in run 6, and
`memory_pressure` reported 35 to 75 % of memory free.

**`pnpm verify --all` in it**, numbered after the earlier runs:

| Run | `main` | Result | Time |
| --- | --- | --- | --- |
| 4 | `4f19cc8b6`, with [#2815](https://github.com/lushly-dev/afd/pull/2815), a fresh container | 170 of 171 steps pass | Clone 11 s, install 5 s, verify 8708 s (2 h 25 min) |
| 5 | `cd67e3bd3`, a fresh container | 170 of 171 pass | Clone 19 s, install 12 s, verify 8749 s (2 h 26 min) |
| 6 | `871c97dcf`, a fresh container | 170 of 171 pass | Clone 17 s, install 6 s, verify 8598 s (2 h 23 min) |

The check passed in all three runs: 263 s, 423 s and 268 s. The todo backend's thousand-writes
test, which failed every check before #2815 ([#2799](https://github.com/lushly-dev/afd/issues/2799)),
did not fail again. Run 4 failed one step; runs 5 and 6 both failed a different one. Each failing
test was re-run on its own in a fresh container from the same image, at the commit of the run that
first failed it:

- **Run 4**, `loam-plugins.yml`'s `cargo test --no-fail-fast --locked` in the mail engine:
  `tests/cli.rs` > `a_command_runs_and_prints_its_result_as_json`. The second `mail-rebuild` call on
  the same data directory exited 1, and the assert prints no message. The same test passed in the
  `--features test-doubles` step right after. Alone, everything passed: the crate's whole suite
  (711 s), the test alone 30 of 30, the `cli` binary 30 of 30, and the same binary with
  `--test-threads=1` 30 of 30. The host's load average was 14 when the re-run started and 69 when
  it ended. The suspected cause, not proven, is a race between the store's `flock` and a child process forked by a parallel test:
  [#2855](https://github.com/lushly-dev/afd/issues/2855). **Rare, and not shown to depend on load.**
- **Runs 5 and 6**, `loam.yml`'s `loam-web test:browser`, the same one test of 604 each time:
  `keybindings.test.ts` > `P4-E9` >
  `puts an override in force with its source and what it shadows, and keeps its action`. At line
  212, after Escape and `shell-focus-next`, a poll for a focused element with a `data-part` ran out
  of time. Alone, the file failed 4 of 20 runs on this test, with the container's own load average
  at 1.2 to 2.2, while the host's other lanes ran (its one-minute load average 54 when the re-run
  started and 9 when it ended): [#2872](https://github.com/lushly-dev/afd/issues/2872). So it fails
  far more often than a rare race does, even with the container otherwise idle. Whether the host's
  load drives it is not measured, and its cause is suspected, not shown. `loam.yml` has been green
  on CI's runners.

Whether either failure depends on arm64 or Linux is unknown: #2855's suspected mechanism is not
specific to Linux, and #2872 was not tried on x86-64.

Time by workflow, in seconds, runs 4, 5 and 6, for the nine largest in runs 5 and 6:

| Workflow | Run 4 | Run 5 | Run 6 |
| --- | --- | --- | --- |
| `loam.yml` (`test:browser`, `test:walk`) | 2823 (1191, 994) | 2875 (1327, 978) | 2997 (1460, 1016) |
| `loam-plugins.yml` | 1875 | 1670 | 1644 |
| `umbel.yml` | 1126 | 932 | 896 |
| `specimen.yml` | 845 | 1060 | 1078 |
| `rust.yml` | 560 | 435 | 514 |
| The check | 263 | 423 | 268 |
| `conformance.yml` | 245 | 232 | 196 |
| `fast-af.yml` | 121 | 278 | 194 |
| `cpp.yml` | 197 | 189 | 174 |

Each run was about 2,000 s faster than run 3's 10600 s, and about 4,000 s faster than run 1's
12716 s. The container's memory peaked at 8.1 GiB (8.7 GB) in the five-minute samples, which miss short
peaks; run 1's 12.2 GB was measured otherwise.

### 2026-11-27: run 7, the exit run on random

The same host, the same Colima virtual machine and the same pinned image, run the same way as
runs 4 to 6. `colima list` showed 6 processors, 16 GiB and a 200 GiB disk (`vz`, `virtiofs`,
aarch64), with the engine still Docker 29.5.2 for linux/arm64.
`loam-os-session@sha256:1403e876e7d7e29def2c85ebd13744736a5d239dbeaeb1c8956a5f513ccb6e67` was
still present by that digest. The container file, `rust-toolchain.toml`, `.nvmrc` and
`packageManager` were unchanged on `main` since `0c3f113c7`, so the image was not rebuilt.

**Did Colima start after login? Still not tested: there has been no login.** At 11:32 on
2026-11-27, `last reboot` still gave 2026-11-22 14:24 as `random`'s last start, and
`kern.boottime` agreed. The console login from 14:25 that day was still open, and every later
entry in `last` was a terminal session (the last one, `last -1`, on 2026-11-24 at 18:27). The
LaunchAgent dates from 2026-11-26, so `RunAtLoad` at a login is still unproven. The agent had
run 45 times, the last exiting 0. Its log's last 15 runs, from 03:49 to 11:17 that day, printed
only `already running, ignoring`, most likely from `StartOnMount`. Nobody logged out or restarted
the machine.

**The host at the start** (11:32): `uptime` 4 days 21 h, with a load average of 19.33, 17.72
and 13.19. `top` showed 22 GB of 24 GB physical memory used (10 GB of it compressed) and 1.3 GB
unused. There were no containers. The internal disk had 43 GiB free and the Dev volume 465 GiB
(`df -h`). Inside the virtual machine, `/var/lib/docker` used 4.7 GB of 196 GB, and the data disk's file
took 5.9 GB on the Dev volume. The five-minute load sampler died with its shell after its first
sample and was restarted at 13:36, so only three samples exist: a one-minute load of 28.7 at the
start, then 20.8 and 6.4 in the run's last ten minutes. Memory was 37 to 43 % free, and the
container used 5.4 GiB in the last two samples.

**`pnpm verify --all` in it:**

| Run | `main` | Result | Time |
| --- | --- | --- | --- |
| 7 | `f2d827efa`, with [#2887](https://github.com/lushly-dev/afd/pull/2887) (`8ff2e77`, #2855's fix) and [#2889](https://github.com/lushly-dev/afd/pull/2889) (`cb964e0`, #2872's), a fresh container | **171 of 171 steps pass**, exit 0 | Clone 30 s, install 11 s, verify 7790 s (2 h 10 min) |

Nothing failed, so nothing needed a re-run. `loam-web test:browser` passed all 606 of its tests,
`P4-E9`'s override test among them (843 ms). The mail engine's two test runs passed (751 s and
743 s), with #2855's `a_command_runs_and_prints_its_result_as_json` passing in both. This was the
fastest cold run on this host: 808 to 959 s under runs 4 to 6, and 2,810 s under run 3. Why is
not measured: the host's load at the start (19 to 29) was higher than run 4's, and with the
sampler gone there is no record of it during the run.

Time by workflow, in seconds, the nine largest:

| Workflow | Run 7 |
| --- | --- |
| `loam.yml` (`test:browser`, `test:walk`, `test:mounted`) | 2520 (1069, 942, 142) |
| `loam-plugins.yml` | 1586 |
| `umbel.yml` | 1022 |
| `specimen.yml` (`test:specimen`, `test:stories`) | 842 (413, 366) |
| `rust.yml` | 404 |
| The check | 280 |
| `conformance.yml` | 219 |
| `cpp.yml` | 179 |
| `fast-af.yml` | 154 |

**No verify record.** The run ended with `[verify] no record for pre-push: the checkout changed
while verify ran`. `git status --porcelain` in the container showed one untracked file,
`endpoints/umbel/store-embedded/core`, a 5.9 MB core dump of the store's integration-test binary.
It was written while `umbel.yml`'s `cargo test -p umbel-store -p umbel-store-embedded` ran, a
step that passed. The crash-point tests abort a child on purpose (`UMBEL_TEST_CRASH_AT`), and in
the image's container `ulimit -c` is `unlimited` and `core_pattern` is `core`. So a passing run
here cannot write the record that M1's hook-free push reads:
[#2898](https://github.com/lushly-dev/afd/issues/2898). This does not affect the exit criterion,
which is that the run passes.

**`P4-E9` alone, after the fix.** In a fresh container from the image, on `main` at `f2d827efa`
(clone, install and `pnpm -F "@lushly-dev/loam-web..." build` in 31 s),
`vitest run --config vitest.browser.config.ts test/browser/keybindings.test.ts` in
`endpoints/loam/packages/web` was run 30 times in a row. **It passed 30 of 30**, with all 23 of
the file's tests each time, in 17 to 22 s a run. The container was otherwise idle (its one-minute
load 0.9 to 2.5), and the host's load average was 4.63, 7.12 and 8.60 at the end. Before #2889,
in a container just as idle, it failed 4 of 20 while the host's one-minute load went from 54 to
9, so the host was less loaded this time. Run 7's `test:browser` passing it is evidence from a
full run too, though the host's load during that step is unknown: it fell between the samples.

**`host-status` over the service.** The LaunchAgent host (`dev.lushly.loam-os`, running, pid
29512) on `127.0.0.1:7420` answered MCP's `tools/call host-status` in 875 ms, including the
session's start, and refused a call without the bearer token with HTTP 401. It returned the
runtime `{ kind: docker, version: 29.5.2, reachable: true, error: null }`, the image `session` by
`sha256:1403e876e7d7e29def2c85ebd13744736a5d239dbeaeb1c8956a5f513ccb6e67` with its toolchain
(Node 26.13.1, pnpm 12.22.0, Rust 1.100.0), the journal `best-effort`, and `unlisted`
`{ containers: 0, volumes: 0 }`. That call came while run 7's container ran: `unlisted` counts
only machines the host labels, not every container on the engine.

**Afterwards.** The containers were removed, along with a build cache that was already empty, and
the image was kept. `fstrim -v /var/lib/docker` in the virtual machine trimmed 57.1 GiB, which
left 4.7 GB used there and the data disk's file at 6.4 GB on the Dev volume.

## How the jobs were checked

On 2026-11-21, after `pnpm -F "@lushly-dev/afd-cli..." build`, again after the walks' revision,
after job 18 was added and revised, after the independent reviews' revision, and again on
2026-11-22 after the end-to-end review revision (adding the warm base-advance case to job 12):

- `node packages/cli/dist/bin.js scenario validate docs/features/proposed/agent-os/scenarios`
  (historical path before the 2026-11-25 move to `docs/features/active/loam-os/scenarios`; all 27
  scenario and fixture files moved with no content change, including `"app": "agent-os"` in
  `fixtures/host.json`): all 18 files parse.
- The dry-run check of [jobs first](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
  (`validateScenario` with `checkFixtures: true`): no errors in 18 files and 131 steps.
- The coverage report (`scenarioCoverage`), given the 15 drafted commands, Umbel's `event-list`
  and the 19 error codes: 15 of 16 commands used (`run-settle` is called only by the host's own
  supervisor), all 19 error codes used, and no scenario calls an undrafted command.

Nothing runs the scenarios: no host exists (superseded: M0 built the host with `host-status` in
[#2669](https://github.com/lushly-dev/afd/pull/2669); the scenarios' commands arrive from M1, and
still nothing runs them). No CI job reads scenario files under `docs/`.

## How the paths were walked

On 2026-11-21 three readers (Opus 5.5 at medium effort, read-only) each got the proposal, the
scenario files and one seat's task from
[jobs first](../../../../.claude/skills/afd/references/jobs-first.md#walking-the-paths), without
the drafting session's conclusions. The people's seat read the lane's code, the job list's seat
drafted its own jobs from the owner's words before opening the proposal, and the calling agent's
seat read Umbel's code and documents. The drafting session spot-checked the claims it acted on in
the code. That walk was of the first draft's fourteen jobs, and its revision added three jobs (15
to 17) and two commands.

A fourth reader (the same model and effort, read-only) then made a second pass over the revision
in all three seats, checking the revised statements against Umbel's and the lane's code and
walking the new and reworded jobs. Its findings were applied without adding a job or a command,
and the scenario checks were run again afterwards.

The owner's answer of 2026-11-21 on repairing a failure that only happens on Linux added job 18.
A fifth reader (the same model and effort, read-only) walked it in all three seats against the
factory's code and the cell brief. It found that a cell had no way to learn the commit, base
or steps of the lane's failed run; the job and the proposal were revised without adding a
command, and the checks were run again.

## How it was reviewed

On 2026-11-21 two fresh reviewers read the whole change read-only, with the acceptance criteria
and without the drafting session's reasoning: Opus 5.5 and GPT-6.2 Astra, both at high effort.
Each traced the proposal's statements about existing code and ran the scenario checks. Their
blockers were checked against the code and fixed, and the proposal's
[Walking the paths](loam-os.proposal.md#walking-the-paths) lists what changed and what was
declined. The revision added one refusal (`RUN_NOT_CONFIGURED`) and no job or command. A
focused pass by Opus 5.5 at high effort then checked the fixes. Its verdict was to revise:
sixteen of seventeen findings were settled, two passages still gave the old checkpoint rule, and
it raised five smaller notes. All were corrected, and the same reviewer confirmed that.

On 2026-11-22 a fresh end-to-end review (Gemini 4 Neon, high effort) against `main` at
`39ca857fd` found four blockers and five improvements, which were applied and then independently
reviewed by GPT-6.2 Astra (`high`), whose five blockers and two improvements (warm base/ref
update and ancestor guard, two-part verify-record check and M1 integration test, conditional
hook-on fallback across G4/Security/M1 exit, durable pre-effect journal intent requirement,
mid-run host disk exhaustion fault, waiting for active `coverage`, and contract/status alignment)
were applied. A fresh read-only Gemini 4 Neon reviewer then verified the updated diff against the
repository and approved it with four minor polish improvements, all applied.

## What is not verified

The proposal's [Status](loam-os.proposal.md#status) listed what nobody had measured, for M0 to
settle. On 2026-11-26 the M0 exit session settled each as far as M0 can, from Hero's measurements
and the lane host's ([M0 measurements on random](#m0-measurements-on-random)):

| Item | What M0 found | Left for |
| --- | --- | --- |
| Which runtime the lane host runs, and its cost | Colima 0.10.3 with Docker 29.5.2 (linux/arm64) in a virtual machine of 6 processors, 16 GB and 200 GB on the Dev volume. It holds its 16 GB resident. Run 1 took about twice as long as Hero's 32 processors (12716 s against 6612 s); run 7 took 7790 s, about 1.2 times as long | Settled. Podman is untried |
| Whether the suites pass on its processor | Yes: run 7, on 2026-11-27, passed all 171 steps once #2855 and #2872 were fixed, and `P4-E9` then passed 30 of 30 alone ([2026-11-27: run 7](#2026-11-27-run-7-the-exit-run-on-random)). Before that, no full run had passed (2026-11-27: none in six. Since #2799's fix, each run failed one intermittent test: [#2855](https://github.com/lushly-dev/afd/issues/2855), and [#2872](https://github.com/lushly-dev/afd/issues/2872), which failed 4 of 20 alone with the container otherwise idle; whether either depends on arm64 or Linux is unknown). In runs 1 to 3, no failure was owed to arm64 or Linux: each was a timing limit, and each failing test passed in a run of its own. One, the todo backend's thousand-writes test, failed every check here until [#2815](https://github.com/lushly-dev/afd/pull/2815), even the check run alone, because of the virtual disk's sync latency ([#2799](https://github.com/lushly-dev/afd/issues/2799), [#2767](https://github.com/lushly-dev/afd/issues/2767), [#2637](https://github.com/lushly-dev/afd/issues/2637)) | M0's exit: a full pass, with [#2855](https://github.com/lushly-dev/afd/issues/2855) and [#2872](https://github.com/lushly-dev/afd/issues/2872) fixed or passing (2026-11-27; superseded the same day: settled for M0 by run 7). M1: the lane's size and load, so that timing limits hold |
| A proxy as the only way out | The install step passes through one, and pnpm, git, uv, Cargo and CMake all honour it. It reaches eight hosts, three of them GitHub's: `github.com` for the clone and CMake, and two content hosts for CMake's C++ dependencies | M1: the host's proxy and its `registries` list; a full validation through it |
| Verify with no network after a fetch | Yes on both hosts, given `UV_OFFLINE=1`, after an online run has fetched and built. Not yet after the install step alone | M1: install step under `registries`, validate under `none` |
| How long a cold validation takes | 2 h 10 min to 3 h 32 min on the lane host as its other lanes' load varied (runs 3 and 1: 2 h 57 min and 3 h 32 min; runs 4 to 6 on 2026-11-27: 2 h 23 min to 2 h 26 min; run 7 the same day: 2 h 10 min, the only full pass), 1 h 50 min on Hero; a second run in the same container, with the builds done, 1 h 59 min | M2: warm starts |
| How a disk limit is enforced, and which disk is measured | The runtime enforces none: `--storage-opt size` is accepted and ignored. Measure inside the virtual machine; the host's sparse file shrinks only after `fstrim` | M1: the host's own limit (for example a fixed-size volume per machine) and its measurement |
| How a checkpoint is made and started from | No process checkpoint (no CRIU). Committing a whole post-validation container had written 8 GB after 21 minutes and was cancelled: too slow to use | M2: warm state in volumes, untried |
| How fast the journal grows | 1,420 bytes a `host-status` call, because the whole result is journaled; about 12 MB a day at one read every 10 s | M1: reads journaled as digests |
| Fetching a cell's commit that is not queued | Yes, over Git's protocol version 2, from the object store the worktrees share: 0.07 s into a mirror that holds `main` | Settled |
| What copying a checkout's history costs | `main`'s history is a 47 MB pack; a clone from a local mirror takes about 5 s, one of every branch from GitHub 14 s | Settled |

The rows of [What Umbel and AFD need](loam-os.proposal.md#what-umbel-and-afd-need)
were read from Umbel's code on 2026-11-21 and re-verified on 2026-11-22 against `main` at
`39ca857fd`, and have not been built against yet (superseded in part: M0 built the doctor hook
and the server identity option, Umbel D206, and the host uses both; D207 records the principle 11
exception; D208 chose a sink-level write-ahead log for the journal, which M1 builds).

## Follow-ups not yet issues

| Date | Raised by | Follow-up |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Readers of the repository for this proposal reported eleven stale statements in READMEs, the parity document, a changelog and a proposal. Corrected the same day, at the owner's request: each was checked against the code and status files, with seven more places that stated the same facts. The ones under `docs/` merged with this proposal in [#1912](https://github.com/lushly-dev/afd/pull/1912); the ones inside units merged in [#1918](https://github.com/lushly-dev/afd/pull/1918) (`6e290b781`). Left as it is: a completed feature's archive (`complete/declared-context-fields/STATUS.md`). The owner kept host-verified confirmation for C++ at N/A in the parity document, 2026-11-21 |
| 2026-11-26 | The session image session | Build the image on `random` (arm64), run `pnpm verify --all` on `main` in it, pin its digest and record its numbers beside Hero's: whether every suite passes on arm64 is still open ([Platforms](loam-os.proposal.md#platforms)). Done the same day by the M0 exit session ([M0 measurements on random](#m0-measurements-on-random)) |
| 2026-11-26 | The session image session | M1's validate step under `none` needs `UV_OFFLINE=1` in its environment ([M0 measurements](#m0-measurements)); the host, not the image, sets it, since the install step needs uv online |
| 2026-11-26 | The session image session | The Specimen host keeps Chromium's sandbox when the kernel allows user namespaces but the container runtime's seccomp profile refuses them, and then fails instead of retrying without it, as it does under AppArmor's restriction. The image sets `SPECIMEN_CHROMIUM_SANDBOX=0`; whether the host should detect this case is Specimen's call |
| 2026-11-26 | The session image session | Better Auth's hosted-fixture contract tests start their runner with only `PATH`, `HOME` and `TMPDIR`, so a `PLAYWRIGHT_BROWSERS_PATH` does not reach it and the browsers must be in the default cache. The image keeps them there |
| 2026-11-26 | The M0 exit session | At the next login or restart of `random`, check that Colima's LaunchAgent started the virtual machine (`colima list`, `~/Library/Logs/dev.lushly.colima.log`); after `brew upgrade colima`, macOS may ask for consent to the external volume again ([runbook](../../../operations/loam-os-image.md#container-runtime-on-random)). Until then a session started from Terminal or an agent app starts it. Checked 2026-11-27: there has been no login or restart since the agent was installed, so it is still open ([M0 measurements on random](#m0-measurements-on-random)). Checked again at M0's exit, 2026-11-27 11:32: still none, still open |
| 2026-11-26 | The M0 exit session | The install step reaches `github.com`, `release-assets.githubusercontent.com` and `raw.githubusercontent.com` for CMake's C++ dependencies. M1's `registries` policy lists them, or the image carries those dependencies |
| 2026-11-26 | The M0 exit session | Timing limits fail under the lane host's load: the todo backend's thousand-writes test (2.8 to 3.3 s alone, against 5 s; [#2799](https://github.com/lushly-dev/afd/issues/2799)), the Loam kernel's `P5-A6` test, `violet-data-grid`'s 500 ms budget and Specimen's page deadline ([#2767](https://github.com/lushly-dev/afd/issues/2767)). Each passed alone. M1 decides how much of the host a lane machine gets, and whether a step that fails on a limit is repeated once |
| 2026-11-26 | The M0 exit session | M1's host measures disk inside the runtime's virtual machine, or trims after destroying a machine: Colima's data disk does not give space back to the host until `fstrim` |
| 2026-11-26 | The M0 exit session | The warm-start scenarios' fixtures (`warm.json`, `warm-red.json`) give the checkpoint's `build` step (`pnpm verify --all`) a 7200 s timeout, and a cold run took 12716 s on the lane host. M2 sets it from these measurements |
| 2026-11-27 | The crash-core session ([#2898](https://github.com/lushly-dev/afd/issues/2898)) | M1's host starts each machine with a core limit of 0 (`--ulimit core=0`, the runtime's `Ulimits`), as the [runbook's check](../../../operations/loam-os-image.md#check-it-before-use) now does. Colima's containers allow unlimited cores with `core_pattern` at `core`, so any crash in a validation leaves a `core` file in the clone and verify writes no record. The image cannot set it: an entrypoint's `ulimit` does not reach `docker exec` |

## Session log

| Date | Session | What |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Drafted the proposal and its jobs from the owner's decisions, had them walked in two passes and revised. Wrote the owner's three further answers in, added job 18 and had it walked. Two independent reviews and their revision. Corrected the stale statements found on the way |
| 2026-11-22 | Fresh review session | Conducted a fresh end-to-end review against `main` at `39ca857fd` (4 blockers, 5 improvements), addressed GPT-6.2 Astra's review (5 blockers, 2 improvements), and applied 4 polish improvements from the approving read-only review |
| 2026-11-25 | Promotion session | Recorded the owner's 10 remaining decisions (named Loam OS, web-based Loam shell as the far end, lives under `endpoints/` for M0–M4), moved `proposed/agent-os/` to `active/loam-os/`, updated `docs/features/README.md`, and opened Epic [#2595](https://github.com/lushly-dev/afd/issues/2595) and M0 sub-issue [#2596](https://github.com/lushly-dev/afd/issues/2596) |
| 2026-11-26 | Session image session ([#2618](https://github.com/lushly-dev/afd/issues/2618)) | Wrote the session image's container file and the operator runbook, built it for amd64 and arm64 on Hero, ran `pnpm verify --all` on `main` in it five times (twice with no network), fixed the image until it passed, moved it from Ubuntu 24.04 to 26.04 after review, and filed [#2636](https://github.com/lushly-dev/afd/issues/2636), [#2637](https://github.com/lushly-dev/afd/issues/2637) and [#2659](https://github.com/lushly-dev/afd/issues/2659) |
| 2026-11-26 | M0 session | Opened M0's sub-issues ([#2616](https://github.com/lushly-dev/afd/issues/2616), [#2617](https://github.com/lushly-dev/afd/issues/2617), [#2618](https://github.com/lushly-dev/afd/issues/2618)); landed Umbel's seams and D206 to D208 ([#2629](https://github.com/lushly-dev/afd/pull/2629)); built the host unit and ran `host-status` against Docker on Hero; fixed a Windows cross-drive failure in the Loam exit check ([#2626](https://github.com/lushly-dev/afd/pull/2626)); filed [#2623](https://github.com/lushly-dev/afd/issues/2623) |
| 2026-11-26 | M0 exit session on `random` ([#2596](https://github.com/lushly-dev/afd/issues/2596)) | Installed Colima on the lane host at the owner's word, built the session image there natively for arm64 and pinned it, installed the host with `host-status` and its launchd service, ran `pnpm verify --all` in the image three times (once with no network), re-ran each failing test alone (Umbel's store tests after run 1 only), measured the proxy, disk, checkpoint, journal, Git fetch and clone questions, settled the proposal's "Not verified" list, and filed [#2767](https://github.com/lushly-dev/afd/issues/2767) and [#2799](https://github.com/lushly-dev/afd/issues/2799) |
| 2026-11-27 | M0 exit re-run on `random` ([#2596](https://github.com/lushly-dev/afd/issues/2596)) | Checked Colima's agent (no login or restart since it was installed, so the login start is still unproven), confirmed `host-status` over MCP with the pinned digest, and ran `pnpm verify --all` in the image three more times. Each run failed one step, and each failing test was re-run alone. Filed [#2855](https://github.com/lushly-dev/afd/issues/2855) and [#2872](https://github.com/lushly-dev/afd/issues/2872). M0 not exited |
| 2026-11-27 | M0 exit session 3 on `random` ([#2596](https://github.com/lushly-dev/afd/issues/2596)) | Recorded the host's state (still no login or restart since Colima's agent was installed, so its login start is still unproven), confirmed Colima's limits and the pinned image by digest, and ran `pnpm verify --all` on `main` at `f2d827efa` in a fresh container: 171 of 171 steps in 2 h 10 min (run 7). Ran `P4-E9` alone 30 times (30 passed), confirmed `host-status` over the LaunchAgent host with the digest, and filed [#2898](https://github.com/lushly-dev/afd/issues/2898) for the core file that kept verify from writing its record. **M0 exited** |
| 2026-11-27 | Crash-core session ([#2898](https://github.com/lushly-dev/afd/issues/2898), [#2962](https://github.com/lushly-dev/afd/pull/2962)) | Fixed the core file that kept a passing `pnpm verify` in the image from writing its record: Umbel's crash-point children turn off their own core dumps before they abort and run in a temporary working directory. The image is unchanged; the runbook's check adds `--ulimit core=0` and now requires the record. Checked on Hero in a container from the image with cores allowed and `core_pattern` at `core`: `main` left `store-embedded/core`, the fix left the clone clean and its store tests passed (one known lock flake, [#2728](https://github.com/lushly-dev/afd/issues/2728), passed alone). A full `pnpm verify --all` writing its record in the image is not yet run, so #2898 stays open for it |
