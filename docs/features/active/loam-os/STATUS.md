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
  [M0 measurements](#m0-measurements).
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
| M0: stand it up | Planned in [#2596](https://github.com/lushly-dev/afd/issues/2596) | Proposal, [M0](loam-os.proposal.md#m0-stand-it-up) |
| M0: the session image and its runbook ([#2618](https://github.com/lushly-dev/afd/issues/2618)) | Merged in [#2664](https://github.com/lushly-dev/afd/pull/2664). Built and checked on Hero (amd64) 2026-11-26: `pnpm verify --all` on `main` at `4a5118f69` passes in it, 167 of 167 steps. Not yet built or checked on the lane host (`random`, arm64) | [`endpoints/loam-os/image/`](../../../../endpoints/loam-os/image/), [runbook](../../../operations/loam-os-image.md), [M0 measurements](#m0-measurements) |
| M1: validation in a machine | Not started | Proposal, [M1](loam-os.proposal.md#m1-mvp-validation-in-a-machine) |
| M2: warm starts | Not started | Proposal, [M2](loam-os.proposal.md#m2-warm-starts) |
| M3 to M5 | Direction only, with no scenarios and no exit. M3 is specified when M1 exits, M4 when M3 exits and M5 when M4 exits | Proposal, [Milestones](loam-os.proposal.md#milestones) |

## M0 measurements

### 2026-11-26: the session image on Hero (amd64)

Measured on Hero (Windows 11, Docker Desktop with BuildKit 0.34.2, a linux/amd64 engine given
32 processors and 31 GiB). **These are not the lane host's numbers:** `random` is Apple silicon,
so its machines are arm64, and nothing has been built or run there yet. Other sessions used
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
fetched. Which hosts that install step reaches is not yet measured.

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

Nothing runs the scenarios: no host exists. No CI job reads scenario files under `docs/`.

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

The proposal's [Status](loam-os.proposal.md#status) lists what nobody has measured, and M0
settles it. The rows of [What Umbel and AFD need](loam-os.proposal.md#what-umbel-and-afd-need)
were read from Umbel's code on 2026-11-21 and re-verified on 2026-11-22 against `main` at
`39ca857fd`, and have not been built against yet.

## Follow-ups not yet issues

| Date | Raised by | Follow-up |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Readers of the repository for this proposal reported eleven stale statements in READMEs, the parity document, a changelog and a proposal. Corrected the same day, at the owner's request: each was checked against the code and status files, with seven more places that stated the same facts. The ones under `docs/` merged with this proposal in [#1912](https://github.com/lushly-dev/afd/pull/1912); the ones inside units merged in [#1918](https://github.com/lushly-dev/afd/pull/1918) (`6e290b781`). Left as it is: a completed feature's archive (`complete/declared-context-fields/STATUS.md`). The owner kept host-verified confirmation for C++ at N/A in the parity document, 2026-11-21 |
| 2026-11-26 | The session image session | Build the image on `random` (arm64), run `pnpm verify --all` on `main` in it, pin its digest and record its numbers beside Hero's: whether every suite passes on arm64 is still open ([Platforms](loam-os.proposal.md#platforms)) |
| 2026-11-26 | The session image session | M1's validate step under `none` needs `UV_OFFLINE=1` in its environment ([M0 measurements](#m0-measurements)); the host, not the image, sets it, since the install step needs uv online |
| 2026-11-26 | The session image session | The Specimen host keeps Chromium's sandbox when the kernel allows user namespaces but the container runtime's seccomp profile refuses them, and then fails instead of retrying without it, as it does under AppArmor's restriction. The image sets `SPECIMEN_CHROMIUM_SANDBOX=0`; whether the host should detect this case is Specimen's call |
| 2026-11-26 | The session image session | Better Auth's hosted-fixture contract tests start their runner with only `PATH`, `HOME` and `TMPDIR`, so a `PLAYWRIGHT_BROWSERS_PATH` does not reach it and the browsers must be in the default cache. The image keeps them there |

## Session log

| Date | Session | What |
| --- | --- | --- |
| 2026-11-21 | The drafting session | Drafted the proposal and its jobs from the owner's decisions, had them walked in two passes and revised. Wrote the owner's three further answers in, added job 18 and had it walked. Two independent reviews and their revision. Corrected the stale statements found on the way |
| 2026-11-22 | Fresh review session | Conducted a fresh end-to-end review against `main` at `39ca857fd` (4 blockers, 5 improvements), addressed GPT-6.2 Astra's review (5 blockers, 2 improvements), and applied 4 polish improvements from the approving read-only review |
| 2026-11-25 | Promotion session | Recorded the owner's 10 remaining decisions (named Loam OS, web-based Loam shell as the far end, lives under `endpoints/` for M0–M4), moved `proposed/agent-os/` to `active/loam-os/`, updated `docs/features/README.md`, and opened Epic [#2595](https://github.com/lushly-dev/afd/issues/2595) and M0 sub-issue [#2596](https://github.com/lushly-dev/afd/issues/2596) |
| 2026-11-26 | Session image session ([#2618](https://github.com/lushly-dev/afd/issues/2618)) | Wrote the session image's container file and the operator runbook, built it for amd64 and arm64 on Hero, ran `pnpm verify --all` on `main` in it five times (twice with no network), fixed the image until it passed, moved it from Ubuntu 24.04 to 26.04 after review, and filed [#2636](https://github.com/lushly-dev/afd/issues/2636), [#2637](https://github.com/lushly-dev/afd/issues/2637) and [#2659](https://github.com/lushly-dev/afd/issues/2659) |
