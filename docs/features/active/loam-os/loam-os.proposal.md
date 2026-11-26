# Loam OS: an operating system built for agents first

An operating system in which everything above the kernel and the base packages is reached through
one command system, AFD, built for agents first and used by people through the same commands. It
starts small: a host that makes a Linux machine for one piece of work, runs that work inside it
with no credential, keeps the record outside it, and destroys it afterwards. The first work it
runs is the software factory's validation of a branch. Originally drafted under the working name
"Agent OS", named **Loam OS** by the owner on 2026-11-25.

## Status

- **State:** active. Approved by the owner on 2026-11-25 and promoted from `proposed/agent-os/`
  under Epic [#2595](https://github.com/lushly-dev/afd/issues/2595). A first draft was written
  2026-11-21 against `main` at `a91acface`, revised after five readers walked its jobs in three
  passes and two independent reviewers read it ([#1912](https://github.com/lushly-dev/afd/pull/1912)),
  and revised again on 2026-11-22 after a fresh end-to-end review against `main` at `39ca857fd`
  ([#2121](https://github.com/lushly-dev/afd/pull/2121)). Nothing is built yet; M0 is planned in
  [#2596](https://github.com/lushly-dev/afd/issues/2596).
- **Origin:** a conversation with the owner on 2026-11-21 about an operating system built on AFD
  from its core, starting as a headless runner for agents in a container image, with
  [Omarchy](https://omarchy.org/) as the example of an opinionated system built on an existing
  distribution.
- **Relation to the [Software Factory](../../active/software-factory/software-factory.proposal.md)
  and the [Factory Gateway](../../active/factory-gateway/factory-gateway.proposal.md):** the first
  milestone moves a branch's install, its tests, and the push's hook out of reach of the lane's
  credentials, which is most of the validation half of the gateway's G4 ("code under validation
  cannot reach a credential") by another means. [The problem](#the-problem) names what stays on the
  lane host.
- **Verified:** the facts in [What exists today](#what-exists-today) were read on `main` at
  `a91acface` and re-checked on `39ca857fd`. No code was built or run except the scenario checks.
- **Not verified:** which container runtime the lane host can run and what it costs there;
  whether this repository's suites pass in a Linux machine on that host's processor; whether a
  proxy can be the only way out for pnpm, cargo, uv and Playwright; whether `pnpm verify` can run
  with no network once its dependencies are fetched; how long a validation takes from nothing;
  how a machine's disk limit is enforced, and which disk the host measures when the runtime keeps
  its volumes in a virtual machine; how a checkpoint can be made and started from; how fast the
  journal grows under the lane's reads; whether the host can fetch a cell's commit that is not
  queued; what copying a checkout's history costs each run. M0 settles these.
- **Jobs:** eighteen for M0 to M2, written as scenarios and checked ([Checks](#checks)). Three
  readers who did not write them walked the first fourteen, and the revision added three. A
  fourth made a second pass over the seventeen. The eighteenth came from the owner's answer and
  was walked by a fifth ([Walking the paths](#walking-the-paths)). On 2026-11-25 the owner kept
  all eighteen jobs in their proposed build order ([Decisions](#decisions)).
- **Progress:** [STATUS.md](STATUS.md).

## Decisions

The owner's answers of 2026-11-21.

| Question | Decision | What it changes |
|---|---|---|
| How it is built | Commands first and no interface: the command layer is refined while only agents use it. One edition may stay headless, for light sessions that start fast. A later one adds an interface for people and could replace a person's main operating system *(superseded 2026-11-25 below: no standalone headless-only edition; web-based Loam shell desktop is the product target)* | [Milestones](#milestones) M0 to M3 have no interface at all as the foundation. M4 is the first surface for a person. A web-based Loam shell desktop is the far end and is not specified here |
| First form | A machine per session | The unit is a Linux machine made for one piece of work and destroyed after it, a container first |
| Where authority lives | Outside the machine first | The container is the sandbox. A host process outside it holds the limits, the network policy, the record and, later, the credentials. Nothing inside a machine is trusted to enforce anything |
| Host base | A separate binary on Umbel's host library, with the machine's capabilities as compiled plugins | The registry, the MCP and command-line surfaces, sign-in, the journal and the event log come from Umbel. "The machine's capabilities" is read here as the commands that govern a machine, in one plugin; the capabilities an agent finds inside a machine are M3's ([The idea](#the-idea)). It also tests whether Umbel can be a machine's command host, and it needs changes to Umbel and to AFD's journal ([What Umbel and AFD need](#what-umbel-and-afd-need)) |
| First workload | A branch's validation run, before an agent cell | M1 needs no sign-in, no approval and no resuming. Cells work inside a machine from M3, once a branch can leave a machine without a shared disk. From M1 a cell may repeat a failed run in a machine (the last row) |
| Where AFD runs | The five stages of [The idea](#the-idea): around a machine first, then inside a machine and between apps from M3 | Nothing inside a machine uses AFD in M0 to M2, and no AFD client goes into the image before M3 |
| Umbel's rules | Both bend for this binary: a journal mode that writes an entry before the effect, with Umbel's default left as it is, and a recorded exception to principle 11 | The host stays on Umbel's library ([What Umbel and AFD need](#what-umbel-and-afd-need)). The fallback on the `afd` crate is left for the case that M0 cannot build either |
| A failure that only happens on Linux | From M1 a cell may run its own branch in a machine through the same commands, with one machine beyond `lane.slots` kept for that | Job 18 and its rules in [How the lane uses it](#how-the-lane-uses-it). No command is added: a run's record gains its steps and size, so a run can be repeated. In M1 nothing tells a cell from the lane, so the limit of one rests on the cell's instructions and the reaper, and what is at risk is load |

The owner's answers of 2026-11-25, settling [For the owner](#for-the-owner) and promoting the feature to `active/`:

| Question | Decision | What it changes |
|---|---|---|
| The far end | Yes: full desktop/OS UI built on AFD with a web-based Loam shell; no standalone headless-only product edition | M0–M3 remain commands-first as the foundation, but the product target is Loam OS with a Loam shell rather than a separate headless edition |
| Jobs | Keep all 18 jobs in their proposed build order | No jobs cut, added, or re-ordered; M1/M2 exit criteria stand as drafted |
| Name | **Loam OS** *(public claim wording remains open)* | Replaces working name "Agent OS"; folder moved to `docs/features/active/loam-os/` |
| Where it lives | A new Rust unit under `endpoints/` in `afd` for M0–M4, registered in `architecture.json`; revisit splitting out into its own repo at M5 | Enables atomic changes with Umbel, `botcore-factory`, and Loam while unpublished; same licensing |
| Validation on Linux only | Run the lane's `coverage` in a Linux machine too, and rely on CI's macOS and Windows jobs for those systems | Both `validate` and `coverage` run in machines once `validate_in = "machine"` is active |
| Images | Hand-built and pinned by digest by the operator in M0–M1 | No image-building command or CI image pipeline until the steps are proven |
| Base distribution | Minimal headless Ubuntu LTS for M0–M4; M5 reopens the choice | Matches CI and Playwright support without fighting desktop bloat inside session containers |
| Container runtime | No preference before M0 benchmarks | M0 measures candidate runtimes on the lane hosts and records the choice |
| Gateway G4 | Amend G4 at M1 exit | Records the validation half met by Loam OS (install, tests, and hook-free push) and what remains: regeneration during a merge (closed by M3 or G4), and G4's half about agents' own users, kept until M3 |
| Hook-free lane push | Approved for M1 | Lane verifies the host's observed passing run and `main`'s `acceptRecord` on the external output file, then pushes with the branch's pre-push hook off |

## The idea

The owner's claim is the first operating system built for agents first: above the kernel and the
base packages, the system is plumbed with the same agent-first command system, here AFD. In his
words the aim is that an agent can "run its principles into each app and back through the OS to
other apps". An agent that knows AFD's rules then knows every part of the system: how to find a
capability, what a result and a refusal look like, what needs a person, and where the record is.

AFD reaches the system in stages, and the stages are the milestones:

1. **Around a machine (M1).** The host's commands are the only way to make a machine, run
   something in it, see it and destroy it.
2. **From inside a machine (M3).** An agent working in a machine reaches the system through the
   same registry: its machine's state and limits, a checkpoint, a request for more, the hand-over
   of its branch. It has an ordinary shell for its own work inside the sandbox, and no other route
   to the system.
3. **Between apps (M3 on).** Every capability on the system is a plugin or an app on that
   registry, and one app calls another through it under a grant, as AFD's
   [apps exposure](../../active/apps-exposure/apps-exposure.proposal.md) defines. Umbel's
   knowledge and memory, and GitHub through the gateway, are the first apps.
4. **For a person (M4).** A person sees, stops and approves through the same commands.
5. **Under the host (M5).** The host is the system layer of an image that boots by itself, and
   the host has no shell.

In M0 to M2 nothing inside a machine uses AFD: a validation run has no agent in it, and the
machine is this repository's toolchain in a container. The owner confirmed this reading on
2026-11-21 ([Decisions](#decisions)).

The claim has a test. AFD's honesty check is "If it can't be done via CLI, the architecture is
wrong" ([the `afd` skill](../../../../.claude/skills/afd/SKILL.md)). At the size of an operating
system it reads: if running the system needs a shell on the host, a command is missing. From M1
the proposal counts each time an operator reaches past the host's commands to the container
runtime's own tools, and M5 removes the shell from the host altogether.

Others use the words. As read on 2026-11-21:

- Alibaba Cloud Linux 4 Agentic Edition says it "is the first Agent-first operating system
  designed specifically for AI Agents"
  ([documentation](https://www.alibabacloud.com/help/en/alinux/agentic-os),
  [source](https://github.com/alibaba/anolisa)). It adds an agent shell, skills as instruction
  documents, security, tracing, workspace checkpoints and memory to a standard distribution, and
  its command-line tool gives packages, services, snapshots and audits one JSON shape.
- SUSE Linux Enterprise Server 16 integrates MCP, with key parts in technical preview
  ([SUSE](https://www.suse.com/c/suse-linux-enterprise-server-16-agentic-ai/)). Red Hat describes
  a hardened, image-based foundation for agents
  ([Red Hat](https://www.redhat.com/en/blog/building-hardened-image-based-foundation-ai-agents)).
  Microsoft presented Windows as an operating system for agents at Build 2026
  ([report](https://visualstudiomagazine.com/articles/2026/06/02/at-build-2026-microsoft-sets-up-windows-as-an-os-for-ai-agents.aspx)).
- [Rivet agentOS](https://rivet.dev/agentos/) is a library that runs inside an application, and
  [AgntOS](https://github.com/HasNate618/AgntOS) is a NixOS-based project with no release.
- Loam's [landscape](../../../../endpoints/loam/docs/landscape.md) records how Windows, Android,
  Apple's systems and Chrome expose applications to agents.

Each of these adds agent tooling to a system whose administration is still files, a shell and
many separate tools. None was found in which one command contract is the only way to run the
system. That structure is what this proposal claims, named **Loam OS** by the owner on 2026-11-25
([Decisions](#decisions); public claim wording remains open).

## The problem

The first milestone is chosen for what the factory's validation costs today.

- **Code under validation can read the lane's credentials.** A lane job's steps run with "the
  inherited environment" (`botcore_factory/job.py`), as the lane's own user. The gateway's
  proposal says so: "Until G4, a branch's tests run where the lane's token and the owner's sign-in
  are readable, as they do today." The branch was written by an agent from an issue anyone may
  have written.
- **A validation's result depends on what the lane host has installed.** `lane-start` refuses with
  `NODE_MISSING`, `NODE_UNPINNED` and `TOOLCHAIN_MISMATCH`, and a branch is ejected with
  `node-missing` when "its own `.nvmrc` names a Node the lane host lacks". Each lane host is set up
  by hand ([SETUP.md](../../../../SETUP.md)), and the lane hosts run macOS and Windows while CI's
  jobs run on Linux.
- **Validation fills the disk.** On the lane host "one slot's Cargo `target` folders reached 51 GB
  and took free disk to 135 MiB in run-8" (the factory's
  [status](../../active/software-factory/STATUS.md)). A slot is a git worktree beside the
  repository, removed by a detached process, and one development drive held about 611 GiB of
  worktrees, almost all Rust build output
  ([Disk Hygiene](../../active/disk-hygiene/disk-hygiene.proposal.md)).
- **Nothing bounds what a validation reaches.** A test can open any connection the host can.

M1 moves the lane's `install` and `validate` steps into a machine, which is where a branch's own
tests run. Three other places run code a branch controls on the lane host, and M1 treats each
differently:

- **The push's hook.** The lane pushes from its slot, where the branch's own `lefthook.yml` and
  `scripts/pre-push.mjs` run with the lane's credentials, and run every check on the lane host
  when they refuse the verify record. In M1 the lane checks the record itself with `main`'s copy
  of the check, against the slot and the host's result, pushes with the branch's hook off, and
  never runs the checks in the slot. That sets a standing rule aside for the lane and was approved
  by the owner on 2026-11-25 ([Decisions](#decisions)).
- **Regeneration during a merge.** When `main` conflicts in a generated file, the adapter's
  `regenerate` commands run in the slot. They stay on the lane host in M1 and are what remains
  of G4's validation half, for M3 or G4 itself.
- **The pre-queue stages.** They run in the cell's own worktree when the cell queues its branch,
  as the cell's own tests do. A cell works on the lane host until M3.

The lane's review evidence check and its own scripts run from its checkout of `main` on the lane
host's Node, so the lane host keeps a toolchain and `lane-start` keeps its check.

## Goal

1. A validation runs in a machine that holds none of the host's credentials and no path into the
   host, and no command input passes one through.
2. The result names the head, its base, the image by digest and each step's exit code as the host
   observed them. What the machine says about itself is labelled as content.
3. Each step reaches only the hosts a policy the operator named allows, and what it tried beyond
   them is listed.
4. A run that goes over its machine's time, memory or disk is stopped by the host, and the result
   says which limit.
5. A result says whether the branch failed or the host could not do its work.
6. A destroyed machine leaves nothing, the record of what ran in it remains for a set time, and
   the host can find and remove what it cannot account for.
7. Nothing starts that the record does not hold, and the host's own actions are in the record
   beside its callers'.
8. Later: a machine starts in seconds from a checkpoint of `main`, an agent session lives in one
   and reaches the system and its apps only through commands, a person approves from a surface the
   agent cannot write to, and the host becomes the system layer of an image that boots by itself.

It is not a new kernel, distribution or package manager, and M0 to M4 run on machines the owner
already has.

## What exists today

| Fact | Where it was read |
|---|---|
| A lane job is a list of steps, each an argument list with a label; the install step has a timeout; a step's `env` (the slot's `CARGO_TARGET_DIR`) "is set over the inherited environment" and its `path` puts the checkout's Node first; a failed step ends the job with its code, 124 when it timed out | `endpoints/botcore/plugins/botcore-factory/src/botcore_factory/job.py`, `lane_coverage.py` |
| The lane's `step` "never waits": the lane process calls it every 5 seconds. A restarted lane kills its orphaned jobs and validates those branches again. A validated branch gives up its slot when the branch at the front needs it, and its checkout is kept aside with its record. An install step that timed out, or whose output matches the lane's infrastructure patterns, is the lane's own trouble: the branch is queued again and the lane pauses until `lane-resume` | `botcore_factory/lane.py`, `lane_process.py`, `lane_base.py` (`POLL_SECONDS`, `resume`, `release_slot`, `trouble`) |
| A slot is a git worktree at `<repository>.factory-slots/<slot>`. The lane merges `main` into the branch there, folds the branch into one commit on `main` (`validatedHead`, via `git commit-tree` with no hooks; `#1809`), and validates that folded commit (ejecting `FOLD_REFUSED` before validation starts). That commit exists only in the lane's repository unless the branch was already a single clean commit on `main`. AFD's `install` is `pnpm install --frozen-lockfile`, its `validate` is `pnpm verify --keep-going` and its `coverage` is `pnpm check:all` | `botcore.toml`, `botcore_factory/real_world.py` (`prepare_slot`, `merge_main`, `fold`), `lane.py`; the factory proposal, [The repository adapter](../../active/software-factory/software-factory.proposal.md#the-repository-adapter) |
| `pnpm verify` writes a record for the exact commit into the worktree's own git directory, bound to the commit, its tree and its merge base with `main`. Pre-push accepts it while those are unchanged, the checkout is clean and the record is under a day old | `scripts/verify-record.mjs` |
| One branch that touched every unit took 35 to 40 minutes for each validation | The factory's [status](../../active/software-factory/STATUS.md), the entry for #1369 |
| G4 has agents run "as an operating-system user, or on a machine, where no gateway token of another class and no `gh` sign-in is readable", and the lane run a validation "as a user with no token at all" | The gateway proposal, [G4](../../active/factory-gateway/factory-gateway.proposal.md#g4-no-credential-outside-the-door) |
| Cells run on the lane host "until `lane-handoff` exists"; `lane-handoff` is the factory's Phase 3, not started. The gateway's `branch-push` takes a git bundle, so a branch can leave a machine without a push credential | `.claude/skills/run-fleet/SKILL.md`; the factory proposal, [Phases](../../active/software-factory/software-factory.proposal.md#phases); the gateway proposal, [Pushing without a credential](../../active/factory-gateway/factory-gateway.proposal.md#pushing-without-a-credential) |
| The repository has no container file. Of the 84 `runs-on` lines in its workflows, 76 name `ubuntu-latest` | `git ls-files`; `.github/workflows/*.yml` |
| Umbel is a host library and a binary: a second binary compiles plugins in with `HostBuilder::with_compiled`, as `umbel-first-party` does. One registry serves MCP, the command line and in-process callers, and MCP lists a few first-class tools beside lazy discovery (D27) | `endpoints/umbel/first-party/src/main.rs`; `endpoints/umbel/docs/architecture.md`, section 2; `endpoints/umbel/src/surfaces/mcp.rs` |
| A compiled plugin's `commands()` is "called once at seal" and its handlers run once per call; it has no hook for work that outlives a call. The binary that embeds the host can hold it, and can call its registry as any actor (`Host::registry`, `Host::context`) | `endpoints/umbel/src/plugins/compiled.rs`; `endpoints/umbel/src/host/mod.rs` |
| Umbel's command line opens the workspace in a process of its own for each call. "Every stdio caller is the one principal `agent:<principal.local_id>`", "every HTTP caller is `agent:loopback`, and the CLI is always `human:<principal.local_id>`", and "until phase 5 verifies callers, nothing vouches for who is on the other end". In mode `none` the HTTP endpoint sits behind a bearer token kept in the workspace's state | `endpoints/umbel/src/cli/mod.rs`, `src/host/mod.rs`; `endpoints/umbel/README.md` |
| Umbel's principle 11 is "Stateless and horizontal. No in-memory sessions" | `endpoints/umbel/docs/architecture.md`, section 2 |
| Only Umbel's WebAssembly components are sandboxed, with no network, files or environment. Compiled plugins are "trusted, not sandboxed" (D42). A plugin names its command domains, and `workspace`, `space`, `event`, `plugin`, `skill`, `afd` and `store` are the host's | `endpoints/umbel/README.md`; `endpoints/umbel/src/plugins/loader.rs`, `mod.rs` |
| Umbel's journal is fail-open: "a journal sink failure still does not change a command's result", and "a fail-closed mode would need a write-ahead journal in AFD" (D66). A command may declare a `digest` journal mode, which keeps the entry's metadata and the named top-level input keys whose values are a string, a number, a boolean or a short list of strings, and neither its text nor its result | `endpoints/umbel/docs/decisions.md`; `endpoints/umbel/src/plugins/manifest.rs` (`JournalMode`) |
| Umbel's event log is a projection of the journal: a successful command that changed something becomes an event with its command, time, actor and the record its result names, read by cursor with `event-list`. An event goes to the space the command's input names, or to the default space. Only the host's own gate for memory writers can mark a result as no change | `endpoints/umbel/src/middleware.rs`; `endpoints/umbel/schemas/event-view.v1.json`; `endpoints/umbel/src/commands/event_list.rs` |
| Umbel's `http` and `secrets` grants are named and refused until a plugin needs them | `endpoints/umbel/src/plugins/mod.rs`, `RESERVED_GRANTS` |
| The journal's actor kinds are `human`, `agent`, `service`, `script` and `test` | [`spec/journal.md`](../../../../spec/journal.md) |
| A command that declares a confirmation or an approval cannot be an MCP task: "a task never asks a person" | [`spec/command-metadata.md`](../../../../spec/command-metadata.md) |
| In Loam "only a human gesture confirms", and human commands are "never served over MCP" (D121, D87) | `endpoints/loam/docs/decisions.md` |
| The agent engine research concludes that "durable work state must outlive an individual worker or context window" and that "a stop request is not rollback" | [Agent Engine research](../../proposed/agent-engine/research.md) |

## Design

```
 callers                outside the machine                          inside
 lane ───────► host: commands over MCP on loopback        ┌─ machine (a container) ───────┐
 (cells; later       journal and event log                │ image, pinned by digest       │
  the foreman,       records of machines and runs         │ work: the head, checked out   │
  a person)          a bare mirror of each repository ───►│ build: this branch's output   │
                     supervisor: starts, times, kills ───►│ downloads: package caches     │
                     reaper: destroys idle machines       │ no credential, no host path   │
                     proxy: the only way out ◄────────────│ network: one named policy     │
                                                          └───────────────────────────────┘
```

### Terms

- A **machine** is a Linux environment made for one piece of work: an image, volumes, limits and
  a network policy. In M0 to M4 it is a container.
- The **host** is the process that makes and governs machines and keeps the record. In M0 to M4
  it runs beside a container runtime on a computer the owner already has. In M5 it is the system
  layer of an image that boots by itself, and this is the part that becomes the operating system.
- A **run** is a list of steps executed in a machine on one commit, each step an argument list.

### The host

A new binary with a `main` of its own. It builds Umbel's host with one compiled plugin, whose
domains are `host`, `machine`, `run` and `checkpoint`, and serves it over HTTP on loopback. The
plugin's commands are the surface. The work that outlives a call cannot live in a plugin, so
`main` owns it: a supervisor that starts each step, enforces its timeout and the machine's limits
and records what it observed; a reaper that destroys idle machines whose time is up and prunes old
records; and the network proxy. The supervisor and the reaper act by calling commands through the
host's registry as a `service` actor (`run-settle`, `machine-destroy`, `host-prune`), so the
host's own actions are in the journal and the event log beside its callers' (job 11).

Callers reach the running host, never a second copy of it: the binary's command line forwards
each call to its server. In M1 callers are local. They present the token Umbel keeps in the
host's state directory, and beyond that nothing verifies them, as in Umbel's mode `none`. Every
caller is then `agent:loopback`, the lane, a cell and the operator's command line alike, so in M1
the record tells the host's own actions from its callers' and does not tell one caller from another.
M3 turns on Umbel's sign-in.

All machines live in the host's one Umbel space in M1 and M2, so capacity can be counted across
repositories and one event log holds everything. A repository is configuration, and separate
scopes for each repository are M3's question.

The operator's configuration names everything a caller may ask for: repositories and where their
commits come from, images by digest, sizes, network policies, the number of machines, the disk
they may use and how long records are kept. A caller chooses among those names and can add none.
Umbel validates the plugin's configuration against its JSON Schema, and `workspace-doctor` runs
the plugin's semantic checks (repository-to-image references, runtime reachability, capacity
bounds) through the plugin doctor hook listed in
[What Umbel and AFD need](#what-umbel-and-afd-need), or in `host-status` if Umbel declines the
hook.

The MCP surface lists eight tools for the ordinary path (`host-status`, `machine-create`,
`machine-get`, `machine-destroy`, `run-start`, `run-get`, `run-wait`, `run-stop`) and leaves the
rest to discovery. The server's instructions carry what the descriptions cannot: the order of
calls, that every step names its network policy, which run states are final, and that `for` is a
branch.

### A machine

`machine-create` makes one for a repository and a branch, on the repository's pinned image, in a
named size. Asking again for the same branch returns the machine it has (`created: false`), so a
retry never makes two; a `broken` machine is not returned but destroyed and replaced. A machine
has three mounts, all volumes the host made: `work` (the checkout, made fresh for every run on a
cold machine; on a checkpointed machine in M2, the first run updates the checkpoint's private
`work` layer to `head` so its installed dependencies and workspace build outputs stay in place,
and any later run replaces it), `build` (build output, kept while the machine lives, so a
second run of the same branch is incremental) and `downloads` (package caches). It runs as an
ordinary user, without added privileges and without the runtime's socket.

No input names a host path, a device, a privilege, the host's network or an environment variable
to pass through. Those controls are the absence of an input, and `machine-get` shows
`credentials: []` (job 02).

A machine is destroyed by `machine-destroy`, or by the reaper when it is idle past `expiresAt`;
a machine with an active run is left until the run ends. Its volumes go with it; its record and
its runs' records stay (job 08).

`machine-inspect` reads what the runtime reports from outside: the busiest processes, what each
mount holds, the step in progress (job 15). No command runs anything in a machine beside its run,
because that would let a caller change what a validation is judged on.

### A run

`run-start` takes the machine, a full commit id, optionally the base commit, and the steps.
When `base` is omitted, the host resolves it to the mirror's current head of the repository's
configured base branch and records that commit on the run. Before the first step the host fetches
the commit from the repository's configured source into its own bare mirror. In M1 that source is
the lane's own repository on the same computer, so the commit the lane folded in its slot is
there. On a cold machine, and on any run after the first in a machine, the host then makes a
fresh clone in the machine's `work` volume with a git directory and an object store of its own,
holding only what `head` and `base` reach. On the first run of a machine created from an M2
checkpoint—where no branch code has run yet—the host uses the warm path only when the
checkpoint's base commit is an ancestor of (or equal to) `base`, so the checkpoint's git object
store holds no commit outside `head` and `base`; it then fetches only `head` and `base` into the
private copy-on-write `work` layer and checks out `head` in place without removing ignored
dependencies and workspace build outputs (`node_modules`, Python `.venv`s, TypeScript `dist/`
and CMake build directories). When the checkpoint's history is newer than or incompatible with
`base`, the host falls back to a fresh cold clone in `work`. On every run—cold or warm—the host
sets both the base branch (`main`) and its remote-tracking ref (`origin/main`) to `base`, so
tools that compare with `main`, `scripts/affected/scope.mjs` and the verify record among them,
see what the lane sees. The mirror is never mounted in a machine, so a run cannot read another
branch's commits. The `head`, `base` and `tree` in the result are what the host checked out.
Once a run's first step has started the host runs no `git` command in that checkout, because the
code there can write hooks and settings into its git directory; any later run in the same
machine replaces the `work` volume's contents instead of cleaning them.

Every step names its network policy; there is no default to forget. A step's timeout is its own
or the host's maximum.

A run ends in one state: `passed`, `failed`, `timed-out`, `over-limit`, `cancelled` or `lost`.
A run that failed, timed out, went over a limit or was lost says where the `fault` lay, as far
as the host can see: the `host` for a lost run or when host storage runs out during a run while
the machine stays within its own `size.diskGb` quota (`over-limit` with `limit: "disk"`,
`fault: "host"`, `reason: "host-disk-full"`); the `network` when a step failed while a host its
policy allows could not be reached; otherwise the `branch` (including when the machine breaches
its own `size.diskGb` quota: `over-limit` with `limit: "disk"`, `fault: "branch"`). A step can
fail to reach an allowed host on purpose, so `network` is a hint the lane takes once and no
verdict. A `passed` or `cancelled` run has no `fault`. `run-stop` kills the run's processes from
outside: the code is not asked to stop (job 07). `run-wait` returns at the end or at its timeout,
for a caller that can block.

Results are bounded. The last lines of the failing step's log come with the result, `run-log`
pages through the rest, and for a caller on the same computer `log.location` is the file (job
05). Lists inside a result are capped and carry a count of the whole.

Files leave a machine only as outputs named before the run, each a path inside the workspace.
The host copies an output only when it is a regular file and no part of its path is a link. An
output comes back as a file on the host's computer with its size and hash, or is listed as
omitted when it is or passes through a link, is a directory or is larger than the host allows
(job 06). M3 adds a route for callers elsewhere.

### What a machine says is content

The host records what it observed from outside: the commit it checked out, the image's digest,
each step's exit code and duration, the limit it enforced, the connections its proxy saw. A
log line, a process name or an output file was written by code under validation, and is labelled
`trust: "content"`, as Umbel and the gateway label text that anyone can write. Log lines and
output files never enter the journal or the event log.

A run cannot be more honest than its own steps: code that changes what `pnpm verify` does can
make it exit 0. The factory's rule against gate edits in a repair is the answer to that, and this
proposal does not change it.

### Network

A machine has no network unless a step's policy gives it one. The operator's configuration says
which hosts each policy allows; `registries` is the package registries. A caller cannot pass a
list of hosts (job 03). The machine's only route out is the host's proxy, which allows or refuses
each connection by name and counts both, so a result lists what a step tried to reach.

`pnpm verify` builds Rust and runs Python through uv, and both fetch what is missing. The aim is
an install step that fetches everything under `registries` and a validate step under `none`. M0
finds whether this repository can run that way; if it cannot, validate runs under `registries`,
which still refuses every other host.

### Images

An image carries the toolchains `main` pins, and may carry more than one version of a tool. The
operator builds it from a container file in the repository and pins it by digest, and it is used
only after `pnpm verify --all` on `main` has passed in it, so a bad image is found before it
fails every branch. Plain `pnpm verify` would not do: on `main` nothing differs from `main`, so
it selects no suite. A branch cannot bring its own toolchain: when `main` is to move to a new
version, an image that carries the old and the new is pinned first, `main` passes in it, and the
branch follows. The lane checks a branch's pins against the versions `host-status` lists and
ejects as it does for `node-missing` today.

### Limits, capacity and time

A size carries the machine's processors, memory and disk. The host stops a run that exceeds them
and the result names the limit and the step (job 04). The host refuses a machine beyond its
configured count, or when its free disk is below its minimum, with `HOST_FULL` and a message that
says which (jobs 09 and 16).

### The record

Machine and run records live with the host, outside the runtime, on space reserved apart from the
journal's. When the host starts, and whenever the runtime comes back after it could not be
reached, the host compares its records with what the runtime has. A step that is still running is
taken up again. A run whose steps' exit codes the runtime kept is settled from them and marked
`recovered`. Any other run is `lost`: never `passed`, and `run-wait` on it returns at once (job
10). While the runtime cannot be reached a run in flight stays `running`.

The journal is required for anything that starts: `machine-create`, `run-start` and
`checkpoint-create` are refused with `JOURNAL_UNAVAILABLE` when an entry cannot be written
first. Stopping is never refused: `run-stop`, `machine-destroy`, `host-prune` and the
supervisor's own `run-settle` are carried out and their entries held in memory, while entries
for reads and refusals are dropped; `host-status` counts both (job 14). If the host restarts
before the journal returns, the comparison above marks what it cannot account for. A full disk
therefore cannot keep a runaway run alive, and cannot let one start unseen.

`run-start` is journaled in digest mode, keeping the machine and the commits, and a refused
`run-start` writes its steps nowhere, so a refused secret is never written down. An accepted
run's record keeps each step as it was given (label, arguments, environment, timeout and policy)
with its result, and `run-get` returns them, so a run can be read for what it ran and repeated
(jobs 11 and 18). What was accepted went into the machine, where the code under validation
could print it, so the record holds nothing the log could not. Reads are journaled as digests
too.

The host labels every container and volume it makes. `host-status` counts as unlisted only what
carries that label and is in no record, and `host-prune` removes only that, so nothing else on a
shared runtime is touched. `host-prune` also removes what is past its keeping time: a run's
record with its log and outputs, a destroyed machine's record, checkpoints beyond the newest few,
and commits in the mirror that no record names. It says what it removed (job 16), and the reaper
calls it on a schedule. `run-get` for a run that has gone answers `NOT_FOUND` and says its
keeping time has passed. The journal and the event log follow AFD's own journal lifecycle
([#1770](https://github.com/lushly-dev/afd/issues/1770)).

### Warm starts (M2)

This repository's validation is heavy: a machine that starts from nothing downloads every
dependency and compiles every Rust crate before it tests anything, and M0 measures how long that
takes. A checkpoint is a machine's state after a passing run of the steps the operator's
configuration names for it, on the head of the base branch, in a machine that has run nothing
else. The lane asks for one when `main` moves. Because machines are keyed one per `(repository, for)`, the lane destroys any existing
`for: main` machine (waiting for an active `coverage` run to settle first) before creating the
fresh `for: main` machine that builds a checkpoint. A machine made from one starts with
dependencies installed and built in its private layers over the checkpoint: its first
`run-start` updates `work` to `head` and resets `main` and `origin/main` to `base` in place
(when the checkpoint's base commit is an ancestor of `base`; otherwise it falls back to a fresh
clone), keeping ignored workspace dependencies and build outputs intact, while every mount stays
a private layer that goes when the machine does (job 12). The host keeps the newest few for each
repository.

A checkpoint is made only from the base branch, only from a passing run, and only when that run
is the machine's one run and its steps are the configured ones (job 13). A caller can ask for a
checkpoint and cannot choose what goes into it, so nothing a branch or a caller wrote can reach
the next branch. Which steps make this repository's machine warm is M2's to choose with M0's
measurements: the lane's `coverage` is `pnpm check:all`, which builds no Rust. Until M2 the
`downloads` cache is shared and writable, which is the exposure the lane host's shared pnpm
store and Cargo registry have today. M2 removes it.

### What Umbel and AFD need

Read in the code on 2026-11-21 by the reader in the calling agent's seat, and re-verified on
2026-11-22 against `main` at `39ca857fd`.

| Need | Today | Change | When |
|---|---|---|---|
| An entry written before the effect, for commands that start something, plus three per-command failure policies (fail-closed starts, buffered stops, dropped reads/refusals) | AFD's journal (`spec/journal.md`) writes one entry after the command with required `result` and `durationMs`, fail-open. D66 names a write-ahead journal in AFD as the cost; the journal's lifecycle is [#1770](https://github.com/lushly-dev/afd/issues/1770) | AFD's journal and a required mode in Umbel leaving its default as it is. M0 settles whether the pre-effect record changes the cross-language `spec/journal.md` schema (two-phase intent/settled entries) or stays a Rust/Umbel sink-level durable write-ahead log; either design must persist an identifiable intent entry on disk before the effect starts (a writability probe alone leaves a crash window). Allowed by the owner, 2026-11-21 | M1 |
| Journal health and buffer counts (`writable`, `pending`, `dropped`) for `host-status` | `HostBuilder::seal` installs `ProjectingSink` privately with no health or buffer handle exposed to plugins | In M0, `host-status` reports Umbel's default journal mode (`best-effort`, `pending: 0`, `dropped: 0`); M1 exposes the live `writable`, `pending` and `dropped` handle from Umbel's host to the plugin | M1 |
| Plugin semantic configuration checks in `workspace-doctor` | `CompiledPlugin` exposes only `check_pack` (space pack overrides, D172), and `workspace-doctor` runs a closed check list; JSON Schema (`[config] schema`) checks shape only | Add a plugin doctor hook in Umbel (`CompiledPlugin` / `HostBuilder`), or keep semantic host-config checks in `host-status` if Umbel declines the hook | M0 |
| Custom MCP server name and version for the embedding binary | `surfaces/mcp.rs` hardcodes `"umbel"` and Umbel's package version in `McpServer::new` | Allow `HostBuilder` to set the MCP server name and version | M0 |
| Work that lives as long as the host | A compiled plugin has no hook for it. The embedding binary can hold the started host, though `cli::run` does not hand it back | None in Umbel: the binary builds the host itself | M1 |
| The host's own calls, as a `service` actor | `Host::registry` and `Host::context` give the embedding binary this | None | M1 |
| A command line that reaches the running host | Umbel's command line opens the workspace in its own process | None in Umbel: the binary's command line forwards to its server | M1 |
| A plugin marks a result as no change, so a repeated `machine-create` or `run-stop` makes no event | Only the host's gate for memory writers sets it | Umbel | M1 |
| One process that holds live state | Principle 11, "Stateless and horizontal. No in-memory sessions" | A recorded exception for this binary: its records are on disk and a restart rebuilds from them and the runtime. Allowed by the owner, 2026-11-21 | M0 |
| A plugin that talks to the container runtime | Allowed for compiled plugins, which are trusted code. It reaches the network without the reserved `http` grant | The owner's call | M1 |
| Verified callers | Nothing vouches for a stdio or loopback caller until Umbel's sign-in modes are used | Umbel's phase 5 modes | M3 |
| The `secrets` and `http` grants, for a credential held at the proxy | Named and refused | Umbel | M3 |
| Bytes in and out for callers on other computers: a bundle in, an output out | No route. The gateway added an upload route for the same reason | The binary's server | M3 |

The owner allowed the journal mode and principle 11 exception on 2026-11-21, so Umbel bends in
those places for this binary. If M0 finds that either cannot be built, the fallback is a small
host on the `afd` crate that reuses Umbel's patterns.

### How the lane uses it

The factory's adapter gains `validate_in`, whose value `machine` sends a job's steps to the host
instead of running them in the slot, and a network policy for each step. The lane calls the
host's MCP endpoint on loopback.

- **Steps.** The lane translates its own: `timeout` becomes `timeoutSeconds`, each step gets its
  policy from the adapter, and `path` and the slot's `CARGO_TARGET_DIR` are dropped, because the
  image carries the tools and the host places the build output.
- **The commit.** The lane keeps its slot for merging `main` in, folding the branch into one
  commit on `base` (`validatedHead`, `#1809`), and pushing. It passes `validatedHead` as `head`
  and the `main` it folded onto as `base`.
- **The push.** In M1 the lane no longer lets the branch's own pre-push hook run on the lane host.
  Instead, the lane performs a two-part check before pushing with the hook off: (1) verify that the
  host's own observed `run` has `state: "passed"` and `head`, `tree` and `base` matching the slot's
  checkout identity, and (2) parse the verify record file at `output.location` and call `main`'s
  `acceptRecord({ record, identity, updates })` (`scripts/verify-record.mjs`) with the slot's
  identity and the actual intended ref update. A disagreement or refusal means validating again or
  ejecting, and never running the checks in the slot, which is what the hook does today. `main`'s
  CLI script reads the checkout it stands in, so invoking `acceptRecord` on a slot's identity and
  external record path is a small M1 adapter seam.
- **Waiting.** The lane's loop never blocks, so it reads `run-get` on each pass, on a slower beat
  than its 5 seconds. A lane that restarts finds its branch's machine and run with `machine-get`
  and takes the run up again; it does not stop it.
- **Seats.** A machine lasts as long as the lane holds a slot for its branch. The lane destroys
  it wherever it frees a slot today: when the branch is ejected, dropped or merged, or gives up
  its slot to the branch at the front. A re-run while the slot is held uses the same machine, so
  its build output is warm; a branch that comes back later starts cold until M2. `lane-start`
  refuses when the host's machines are fewer than `lane.slots` plus the one kept for a cell's
  own runs. A host that serves several lanes needs the sum of their slots plus one, which is
  the operator's to set.
- **The verify record.** Until the gateway's G1 is the lane's path, the lane names
  `.git/afd-verify-record.json` as an output. With hook-free push, the lane first checks the
  host's observed passing run (`state`, `head`, `tree`, `base`) against the slot, and then parses
  the output file at `output.location` and calls `main`'s `acceptRecord` with the slot's identity
  and actual ref update—it does not install the file into the slot's git directory. M1 requires a
  factory integration test for reading that external output and rejecting a push whenever the host
  result or `acceptRecord` disagrees. With G1, `verification-record` is written from the host's
  result and the file is no longer needed.
- **A cell's own runs.** From M1 a cell repairing an ejected branch may repeat the lane's failed
  run in a machine itself, through the same commands on the host's command line, when the
  failure does not happen on the lane host's own system (job 18). The lane's `ejected` event
  names the run. `run-get` gives the cell the commit the lane validated, its base, the size and
  each step as it was given, so the cell repeats the run as it was or narrows it to the step
  that failed. That commit is in the host's mirror, which fetched it for the lane's run. A
  repair the cell has not queued is a commit only its own worktree has. The host can fetch it
  when that worktree belongs to the lane's repository and shares its objects, which M0 checks
  on the lane host. Where it cannot, the cell reproduces on the lane's commit and its repair is
  validated by queueing, as today.

  The host's machine count is the lane's slots plus one, so one cell at a time can do this
  without taking a seat the lane needs. In M1 nothing tells a cell from the lane, so the host
  cannot hold cells to that one, or keep a cell from stopping a run that is not its own. The
  cell's instructions do: one machine, for its own branch while that branch holds no seat, of
  the lane's size, destroyed before the branch is queued again, and never a machine or a run
  it did not make. The reaper ends a machine a cell forgets, and a cell whose machine expired
  between two runs makes it again, as `MACHINE_NOT_READY` tells it to (job 09). When the host
  is full the cell repairs from the log, as today. If cells hold more than one, the lane gets
  `HOST_FULL` and holds its branch until a machine is freed. The lane keeps the id of the
  machine it made for a seat and validates only in that one. Before each further run there it
  reads `machine-get`, and makes a new machine when the machine's runs include one the lane
  did not start, so nothing a repair or another caller built is judged. A failure that does
  not happen in the machine either is a flake by the factory's rule, and the two runs are its
  evidence. The factory already gives cells a command host of their own (`factory-cell`), and
  M1's specification decides whether a cell's calls go through it. That would put these limits
  in the tooling a cell uses and would not enforce them: a cell runs as the lane's user and can
  read the host's token until M3.

What the lane does with each answer:

| Answer | Whose | The lane |
|---|---|---|
| `passed` | | Goes on to push and merge |
| `failed`, `timed-out` or `over-limit` on memory, with `fault: branch`, outside the install step | The branch's | Ejects with the failing step, the log and the run's id |
| `failed` in the install step, with `fault: branch`, that did not time out and matches none of the lane's infrastructure patterns | The branch's, as today | Ejects as `entry-invalid`, with the log and the run's id |
| An install step that timed out or whose log matches the lane's infrastructure patterns | The lane's side, as today | Queues the branch again without counting an ejection and pauses with a `lane-error` |
| `fault: network` | The lane's side, once | Once for each attempt it queues the branch again without counting an ejection and pauses with a `lane-error`. The next one on that attempt is the branch's and ejects, as the lane treats a full disk today, because a step can fail to reach an allowed host on purpose |
| `over-limit` on disk, with `fault: branch` | The branch's, within its size | Ejects with the failing step, the log and the run's id: the branch breached its own machine's `size.diskGb` quota |
| `over-limit` on disk, with `fault: host` (`reason: "host-disk-full"`) | The host's | Requeues the branch without counting an ejection and pauses with a `lane-error` for operator disk cleanup, matching `lane.py`'s current mid-job disk-full recovery |
| `lost`, `MACHINE_NOT_READY`, a `cancelled` it did not ask for | The host's | Validates again in a new machine; no ejection is counted |
| `HOST_FULL`, `RUNTIME_UNAVAILABLE`, `JOURNAL_UNAVAILABLE` | The host's | Holds the branch and asks again on a later pass. A hold that outlasts a set time raises a `lane-error`, so a host that stays down or full is seen |
| `CHECKPOINT_STALE`, `NOT_FOUND` for a checkpoint (M2) | The image changed | Makes the machine without a checkpoint. For a new one the lane waits for any active `coverage` run on `for: main` to settle, destroys any existing `for: main` machine, makes a fresh machine for `main`, runs the repository's `checkpointSteps` in it and calls `checkpoint-create` |
| `ALREADY_EXISTS` | Configuration changed under a live machine, or a cell left one of another size or image | Finds the branch's existing machine via `machine-list` (or `details.machineId`), destroys it with `force` and makes it again |
| `created: false` from `machine-create` for a branch the lane has just seated | A cell left its own machine for the branch | Destroys it with `force` and makes a new one |
| `HEAD_NOT_FOUND` | The lane's own repository lacks the commit | Queues the branch again, and pauses with a `lane-error` if it repeats |
| `IMAGE_UNKNOWN`, `SIZE_UNKNOWN`, `POLICY_UNKNOWN`, `REPOSITORY_NOT_ALLOWED` | Configuration | Pauses with a `lane-error` for a person |

### Platforms

Machines are Linux. On macOS and Windows a container runtime runs them in a Linux virtual
machine, which also puts a second boundary around them. The lane's validation then runs on
Linux, as CI's does, and no longer on the lane host's own system; on 2026-11-25 the owner decided
to run the lane's `coverage` in a Linux machine too and rely on CI's macOS and Windows jobs for
those systems ([Decisions](#decisions)). On Apple silicon the machines are arm64 while CI's runners
are x86-64, and whether every suite passes there is M0's to find out.

## Commands (draft)

Names follow `domain-action` and inputs are camelCase, as in Umbel. Every refusal carries a
`suggestion`. Every input object is closed, the items of `steps[]` and `outputs[]` included: an
unknown field is a `VALIDATION_ERROR`. Any command that starts something can be refused with
`JOURNAL_UNAVAILABLE`, and any that reaches the runtime with `RUNTIME_UNAVAILABLE`; both are
`retryable`. The exact specification follows approval, and it takes a code from
[`spec/error-codes.md`](../../../../spec/error-codes.md) wherever one fits. Three draft codes
have a candidate there: `RUNTIME_UNAVAILABLE` and `JOURNAL_UNAVAILABLE` for
`SERVICE_UNAVAILABLE`, and `RUN_ACTIVE` for `CONFLICT`. The draft keeps them apart because the
scenarios and the lane's rules tell them apart by code. `HOST_FULL` is `retryable`, which the
catalog's `QUOTA_EXCEEDED` is not.

| Command | Input | Result `data` | Refusals | From |
|---|---|---|---|---|
| `host-status` | — | `host { name, version, restartedAt? }`, `runtime { kind, version, reachable, error }`, `journal { mode, writable, pending, dropped }`, `repositories[] { name, base, image, size, checkpointSteps[]? }`, `images[] { name, reference, digest, toolchain }`, `sizes[] { name, cpus, memoryGb, diskGb }`, `policies[] { name, hosts[] }`, `capacity { machines { max, active }, diskGb, minFreeDiskGb, usedGb }`, `unlisted { containers, volumes, error }`, `retention { recordsDays, logsDays }`. As built in M0 ([#2617](https://github.com/lushly-dev/afd/issues/2617)): `writable` and `usedGb` are `null` until M1 can observe them, and `digest` is `null` for an image not pinned by digest, which the doctor fails | None for its own reasons; it answers `HOST_CONFIG_UNREADABLE` only when the deployer denies the plugin's `config` grant | M0 |
| `host-prune` | `dryRun?` | `orphans[] { kind, name, sizeGb }`, `expired { runs, logs, checkpoints }`, `removed { orphans, runs, logs, checkpoints }`, `freedGb`, `changed` | — | M1 |
| `machine-create` | `repository`, `for` (the branch), `image?`, `size?`, `ttlMinutes?`, `checkpoint?` (an id or `current`; M2) | `machine { id, state, repository, for, image { name, digest }, size, limits, network { default }, mounts[] { name, kind, access }, credentials[], from? { checkpoint, head }, expiresAt }`, `created` | `REPOSITORY_NOT_ALLOWED`, `IMAGE_UNKNOWN`, `SIZE_UNKNOWN`, `ALREADY_EXISTS` (the branch has a machine of another image or size; names it in `details.machineId` or via `machine-list`), `HOST_FULL` (machines or disk; `retryable`), `CHECKPOINT_STALE`, `NOT_FOUND` (the checkpoint) | M1 |
| `machine-get` | `id` | `machine`, with `state` (`ready`, `busy`, `broken`, `destroyed`), `processCount`, `usage { diskGb, peakMemoryGb }`, the last ten `runs[] { id, state }` with `runsTotal` and, once destroyed, `destroyedBy` and `reason` | `NOT_FOUND` | M1 |
| `machine-list` | `repository?`, `for?`, `state?` (`active` is every state but `destroyed`), `limit?`, `cursor?` | `machines[]`, `nextCursor?` | — | M1 |
| `machine-inspect` | `id` | `trust`, `run? { id, step, elapsedSeconds }`, the twenty busiest `processes[] { pid, command, cpuPercent, memoryMb, elapsedSeconds }` with `processesTotal`, `mounts[] { name, usedGb }` | `NOT_FOUND`, `MACHINE_NOT_READY` | M1 |
| `machine-destroy` | `id`, `reason?`, `force?` | `destroyed`, `changed`, `freedGb`, `removed { volumes[] }` | `NOT_FOUND`, `RUN_ACTIVE` (without `force`) | M1 |
| `run-start` | `machine`, `head` (a full commit id), `base?` (a full commit id; defaults to the mirror's head of `repository.base`), `steps[] { label, args[], network, timeoutSeconds?, env? }`, `outputs[]? { name, path }` | `run { id, machine, for, head, base, state, startedAt }` | `NOT_FOUND`, `MACHINE_NOT_READY`, `RUN_ACTIVE`, `HEAD_NOT_FOUND`, `POLICY_UNKNOWN`, `SECRET_IN_INPUT`, `OUTPUT_OUTSIDE_WORKSPACE` | M1 |
| `run-get` | `id` | `run { id, machine, for, head, base, tree, state, ended, fault?, failed?, limit?, reason?, recovered?, image, size, from?, steps[] { label, args[], env?, timeoutSeconds?, code?, timedOut?, durationMs?, network, connections { allowed, refused[] { host, port, count }, refusedTotal } }, log { trust, bytes, tail[], location }, outputs[] { name, bytes, sha256?, trust, location?, omitted? }, startedAt, endedAt? }` | `NOT_FOUND` | M1 |
| `run-wait` | `id`, `timeoutMs?` | `run` as `run-get` returns it, and `waitExpired` | `NOT_FOUND` | M1 |
| `run-stop` | `id`, `reason?` | `run`, `changed` | `NOT_FOUND` | M1 |
| `run-log` | `id`, `step?`, `limit?`, `cursor?` | `trust`, `lines[]`, `nextCursor?` | `NOT_FOUND` | M1 |
| `run-settle` | `id` and what the supervisor observed | `run` | On no surface: only the host's supervisor calls it | M1 |
| `checkpoint-create` | `machine` | `checkpoint { id, repository, head, digest, image, sizeGb, current, stale }`, `created` | `NOT_FOUND`, `RUN_ACTIVE`, `NOT_ON_BASE`, `RUN_NOT_PASSED`, `RUN_NOT_CONFIGURED` (the run is not the machine's one run of the repository's `checkpointSteps`) | M2 |
| `checkpoint-list` | `repository` | `checkpoints[]`, newest first | `REPOSITORY_NOT_ALLOWED` | M2 |

`event-list` is Umbel's and is used as it is (job 11).

**Why `run-settle` has no scenario step of its own.** No caller can run it. Job 11 shows it in
the event log with the supervisor as its actor.

**Not drafted.** No command takes a host path, a device, a privilege, a list of hosts, or an
image by tag or address. None runs anything in a machine beside its run, copies a file into a
machine (M3 adds a bundle), builds an image, changes a policy or a size, or opens a shell on the
host. Configuration is the operator's file, as Umbel's is.

## Milestones

Each milestone is usable on its own. M0 to M2 are this proposal's scope: each lists what it
builds, the jobs it must pass and its exit. M3 to M5 show where it leads. Their jobs are
sentences, not scenarios, and each gets a specification of its own, with its jobs as scenarios
and an exit, before it starts.

### M0: stand it up

- **Builds:** a container file for this repository's session image, built from `main` and pinned
  by digest (carrying Node, pnpm, Rust with the `wasm32-wasip2` target, Python/uv, CMake/C++,
  OpenSSL, Playwright Chromium and the Linux native libraries `loam-desktop` needs for
  WebKitGTK/GTK; operator work, with a runbook that also covers installing the host as a service
  and moving to a new image); the host binary with `host-status` and the configuration checks; a
  fake runtime for tests.
- **Settles:** the items under "Not verified" in [Status](#status), whether Umbel's required
  journal mode (including its `spec/journal.md` vs sink-level durable write-ahead scope, with
  an identifiable intent entry persisted before the effect) and principle 11 exception can be
  built as the owner allowed them, and whether Umbel adds the plugin doctor hook and
  server-identity option. It writes the Umbel outcomes into Umbel's decisions. Only if the
  journal mode or principle 11 exception cannot be built does the host move to the fallback.
- **Exit:** `host-status` answers on the lane host (reporting Umbel's default journal mode until
  M1 wires required mode and live counts) and names the image by digest, and `pnpm verify --all`
  on `main` passes in a container started from that image, with its duration recorded.

### M1 (MVP): validation in a machine

- **Builds:** every M1 command; the supervisor, reaper, proxy and mirror; the journal changes
  (durable pre-effect intent entry and live health/buffer counts); the factory adapter's
  `validate_in`, the lane's rules for each answer, its two-part verify-record check and
  hook-free push with factory integration tests covering external output validation and mismatch
  rejection, and a cell's instructions for a run of its own.
- **Jobs:** `m1` (01 to 11 and 14 to 18).
- **Process:** the factory's `factory` docs topic and `run-fleet`, `SETUP.md`, and a runbook in
  `docs/operations/`. The cell brief in `run-fleet`'s runbook keeps a cell from whole suites and
  reproduction loops today, because the lane's validation shares the host; it gains what a cell
  may run in a machine instead. The gateway's G4 is amended to say which part of its validation
  half is met here ([Decisions](#decisions)).
- **Exit:** every `m1` scenario passes against the fake runtime, and 01, 03, 04, 08 and 16
  against a real one. Unit/integration tests verify crash recovery at the pre-effect journal
  boundary (no machine or run starts without a persisted intent entry) and the lane's external
  verify-record check (including rejection when the host's observed `state`, `head`, `tree` or
  `base` disagrees with the output or slot). In one fleet run every validation ran in a machine.
  A test branch whose tests try to read the lane's token, the `gh` sign-in and a file outside the
  workspace, and to reach a host outside every policy, gets none of them, and its own pre-push hook
  does not run on the lane host. A cell given a planted branch,
  whose test fails in the image and passes on the lane host's own system, repeats the failed run
  in a machine of its own and destroys the machine. After the run the host's disk use is back at
  its level before it, and `host-status` shows nothing unlisted. The report gives validation time
  against the slot's, the journal's growth, and the number of times an operator used the
  runtime's own tools during the run.

### M2: warm starts

- **Builds:** `checkpoint-create`, `checkpoint-list` and `machine-create` from a checkpoint; a
  checkpoint made, when `main` moves, from a new machine's one run of the repository's
  `checkpointSteps`; the shared `downloads` cache retired.
- **Jobs:** `warm` (12, 13).
- **Exit:** the `warm` scenarios pass; a file one branch's run wrote is absent from the next
  machine; the median validation time from a checkpoint is reported against M1's and the slot's.

### M3: sessions

An agent cell works inside a machine. The machine lasts until its branch merges or is dropped,
stops when idle and resumes with its files; the branch leaves as a bundle through the gateway's
`branch-push`; the model sign-in is held at the host's proxy and attached on the way out, so
nothing inside can copy it; callers sign in and get scopes for each repository. The image gains
an AFD client, and the agent's only route to the system is the host's registry. M3 needs the
gateway's G1. It replaces what the factory's `lane-handoff` would carry, and the machine of its
own that job 18 gives a repairing cell. Draft jobs, as sentences:

- When a cell starts on an issue, I want it to work in a machine that holds no GitHub credential
  and no model sign-in, so that a misled agent can change only its own branch.
- When an agent works in a machine, I want it to find what the system offers it (its machine's
  state and limits, a checkpoint, a request for more, the hand-over of its branch) as commands on
  one registry, so that it needs a shell only for its own work.
- When an agent needs another app (knowledge, memory, GitHub through the gateway), I want that
  app to be commands on the same registry under a grant, so that one set of rules covers every
  app and every call between apps is recorded.
- When a cell's branch is ejected, I want the cell resumed in the same machine with its files as
  they were, so that a repair starts from the work.
- When a cell finishes, I want its branch to leave the machine as a bundle through the gateway,
  so that the lane never reads a machine's disk.
- When a parked cell waits for the owner, I want its machine stopped and its state kept, so that
  waiting costs disk and no memory.

Its specification is written when M1 exits.

### M4: a person's surface

AFD's [approver client](../../active/approver-client/approver-client.proposal.md) and Loam's
inbox are the pieces, under Loam's rule that only a human gesture confirms. The contract has a
gap to close first: a command that needs approval cannot be a long-running task. Draft jobs:

- When an agent asks for more than its grant (a wider network policy, a longer life), I want to
  see the exact request in a surface the agent cannot write to and approve or refuse it, so that
  widening is always a person's act.
- When I want to know what my agents are doing, I want to watch their machines and stop any of
  them from my own device, so that I never need a terminal on the host.

### M5: its own image

The host becomes the system layer of an image that boots by itself, with no shell and no remote
login on the host, and machines as its only workloads. Talos Linux and bootable containers are
the references to read for its specification; neither was read for this proposal. Draft jobs:

- When I administer the system, I want every action to be a command, and each use of a raw shell
  on the host journaled and counted, so that every missing command is known.
- When a headless session is wanted, I want a machine that starts in seconds from an image that
  holds only the kernel, the base packages, the host and its apps, so that a session is light.

### Beyond M5: a desktop

- When I sit at this system as my main computer, I want its interface to call the same commands
  my agents use, so that anything I can do an agent can do, and the record holds both.

The owner chose a web-based Loam shell for this desktop on 2026-11-25 ([Decisions](#decisions)).
Nothing about it is specified here.

## Security

| Threat | Answer |
|---|---|
| Code under validation reads a credential | A machine holds none of the host's. No input passes a host path, a host variable or a host credential through, and its mounts are the host's own volumes. A value a caller supplies itself does go into the machine: the secret rules refuse what they recognise (`SECRET_IN_INPUT`), which is detection and no guarantee. M1's exit tests it with a branch that looks |
| A branch changes the push's hook, or a generator the lane runs | From M1 the lane pushes with the branch's hook off after checking the host's observed run and `main`'s `acceptRecord`. Regeneration during a merge (`regenerate`) remains branch-controlled code on the lane host until M3 or G4 closes it |
| One branch's run reads another branch's code | Each checkout has an object store of its own with only what its commit and base reach; on an M2 warm machine, the host uses the checkpoint's `work` layer only when the checkpoint's base commit is an ancestor of `base` and falls back to a fresh clone otherwise. The mirror is never mounted |
| Code under validation sends data out | No network without a named policy, policies named by the operator, and the proxy as the only route. Refused connections are listed in the result |
| One branch changes what the next builds on | A fresh checkout for every run on cold machines, private copy-on-write layers over a `main`-only checkpoint in M2, and a build volume for each machine. The shared `downloads` cache remains until M2, as the lane host's shared caches do today; M2's checkpoints are made only from `main` and every machine writes to its own layer |
| Code escapes the container | The machine runs as an ordinary user without added privileges or the runtime's socket. Container isolation is the boundary in M0 to M4, and a kernel fault is outside what it promises. On macOS and Windows the runtime's virtual machine is a second boundary; M5 can give each machine its own |
| A caller asks for more than it should have | No command takes a host path, a privilege or a list of hosts; images, sizes and policies are the operator's names |
| A local process pretends to be the lane | A caller needs the token in the host's state directory, which any process of the same user can read, so in M1 nothing else prevents it. What it can reach is machines that hold no credential. M3 verifies callers |
| The host removes something that is not its own | The host labels what it makes, and counts and prunes only what carries its label |
| An output is a link to a file on the host | The host copies only a regular file whose path holds no link, and lists anything else as omitted |
| Code under validation plants a git hook or setting for the host to run | On a checkpointed machine's first run only `main`'s checkpointed state is in `work` before branch code starts; once a run's first step starts, the host runs no git command in that checkout and replaces the volume's contents for any later run |
| Code under validation makes its failure look like the network's | The lane takes `fault: network` as its own side once for each attempt and as the branch's after that |
| A caller plants build output in a machine the lane will run in again | The lane makes a new machine when the machine's runs include one it did not start. What the same branch's own earlier runs left in `build` is trusted as a slot's is today |
| A caller chooses what later machines start from | A checkpoint is made only from the machine's one run of the steps the operator named, on the base's head (M2) |
| A cell's own runs keep a seat from the lane, or stop the lane's run | The host's count is the lane's slots plus one. In M1 the host cannot tell a cell from the lane, so a cell that breaks its instructions can delay a branch or stop its run. The lane validates again after a `cancelled` it did not ask for, and no machine holds a credential. M3 gives callers scopes |
| A misled caller makes machines without end | The host's machine count and disk minimum, each machine's time limit, and the reaper |
| A machine reports a false result | The host records the exit codes, the commit and the image it observed. Logs, process names and outputs are labelled as content |
| A caller changes a validation while it runs | No command runs anything in a machine beside its run; `machine-inspect` only reads |
| A secret is passed in and reaches the machine or the journal | Every `run-start` input (arguments and environment) is checked against secret rules first (`SECRET_IN_INPUT`), and `run-start` journals no argument or environment value. An accepted run's steps are kept in its record, which is not the journal, and went into the machine in any case |
| The image is changed under a branch | Images are pinned by digest in the operator's configuration, a branch cannot choose one that is not there, and an image is used only after `main` passed in it |
| Something happens that the record does not hold | Nothing starts without its journal entry; the host's own actions are commands; after a restart an unobserved run is `lost` |

## Alternatives considered

- **Separate operating-system users, as G4 is written.** It keeps a credential from code under
  validation, and is operator work on each lane host and each of its systems. It does not bound
  the network or the disk, or pin the toolchain.
- **A container started by the lane itself.** The same mechanism without the surface: no record
  beside the factory's, no named policies, nothing a cell or a person could use later.
- **A new host on the `afd` crate.** It keeps Umbel to knowledge. The owner chose Umbel's library
  to test it as a machine's host, and this is the fallback.
- **Hosted sandboxes.** The owner's machines and plans are local. Not evaluated.
- **Adopting one of the systems in [The idea](#the-idea).** Each is a distribution with agent
  tooling added, and none offers a command contract to build on. Not evaluated in depth.
- **Omarchy's method.** It configures a rolling distribution in place. A session machine is
  replaced, never changed, so the method does not carry over; its stance of choosing for the
  user does.

## Jobs

Each job is a scenario in [`scenarios/`](./scenarios/) on invented fixture data
(`scenarios/fixtures/`). They run against a fake runtime that plays each commit's scripted
result. The tag is the milestone that must pass it.

| Order | File | Job | Tag |
|---|---|---|---|
| 1 | 01 | Validate a head in a machine made for it | m1 |
| 2 | 02 | Give a machine no credential and no path into the host | m1 |
| 3 | 06 | Push a head on a validation that ran in a machine | m1 |
| 4 | 17 | Tell the host's trouble from a branch's failure | m1 |
| 5 | 08 | Destroy a machine and everything it wrote | m1 |
| 6 | 05 | Read a failure without reading the whole log | m1 |
| 7 | 04 | Stop a run that goes over its machine's limits | m1 |
| 8 | 03 | Reach only what each step is allowed to reach | m1 |
| 9 | 09 | Refuse what the host is not set up for | m1 |
| 10 | 10 | Restart the host without losing a machine or inventing a pass | m1 |
| 11 | 07 | Stop a run when its branch leaves the queue | m1 |
| 12 | 16 | Clear what the host cannot account for, and what is too old to keep | m1 |
| 13 | 14 | Keep stopping, and start nothing, when the record cannot be written | m1 |
| 14 | 15 | See inside a machine that misbehaves, without touching it | m1 |
| 15 | 11 | See what ran, on what, and who asked | m1 |
| 16 | 18 | Reproduce a branch's failure in a machine of the cell's own | m1 |
| 17 | 12 | Start from a workspace prepared on main | warm |
| 18 | 13 | Keep one branch's writes out of the next branch's machine | warm |

### What writing them changed

- `run-start` takes the commit and the host checks it out fresh, so the `head` and `tree` in a
  result are the host's observation and no earlier run's files are in the checkout.
- Sizes and network policies became the operator's names. The first draft took numbers and a
  list of hosts from the caller, which job 09 and job 03 could not refuse sensibly.
- The end of a run became a command the supervisor calls (`run-settle`), because job 11 could not
  otherwise show a complete record: the event log holds commands.
- `lost` and `recovered` were added for job 10. Without them a restart left a run `running` for
  ever or forced a guess.
- An output larger than the host allows is listed as omitted and is no refusal, since the run has
  already ended when its size is known (job 06).
- The journal rule split in two for job 14: starting needs the record first, stopping never waits
  for it.
- `machine-create` returns the machine a branch already has, so a retried call cannot make two
  (job 09).
- Checkpoints took over from a shared cache as the way to start warm, because job 13 could not be
  written against a cache every branch may write.
- Job 18 added no command. It put a run's steps and size in its record, so a failed run can be
  repeated from `run-get`, and gave `machine-list` a filter by branch. Writing it also showed
  that the lane would be handed a machine a cell had left for the same branch, so the lane
  validates only in a machine it made.

### Walking the paths

Three readers who had not written the jobs walked them on 2026-11-21, each in one seat: the
people (the lane, the foreman, the owner as operator, against the lane's code), the job list
(drafting its own list from the owner's words before reading), and the calling agent (against
Umbel's code and documents). What changed:

- **The host's long-lived work moved out of the plugin.** A compiled plugin cannot own a loop or
  call the registry. The binary's `main` owns the supervisor, the reaper and the proxy and calls
  commands as a `service` actor, and callers reach the running host over HTTP.
  [What Umbel and AFD need](#what-umbel-and-afd-need) replaced its "not checked" rows with what
  the code says.
- **One space.** Events go to the space a command's input names or to the default, and
  capacity is counted across repositories, so "each repository is a space" was dropped until M3.
- **The commit and its base.** The lane validates a commit that may exist only in its own
  repository, and the verify record is bound to the merge base. `run-start` gained `base`, the
  source in M1 is the lane's repository, and the checkout has a git directory of its own.
- **The lane's own shape.** Its loop never blocks, its steps carry host paths, a restart kills
  its jobs and a validated branch gives up its slot. [How the lane uses it](#how-the-lane-uses-it)
  now states the translation, the reading of `run-get`, taking a run up again after a restart, a
  machine for as long as a seat, and what the lane does with each answer.
- **Every step names its network policy,** since a forgotten one failed without a refusal, and
  the proposal no longer assumes `pnpm verify` runs with no network.
- **Images.** A branch cannot install its own toolchain in a step that only runs `pnpm install`.
  An image is used only after `main` passed in it, and a new version reaches the image before the
  branch.
- **Three jobs were added:** 15 (looking inside a machine without the runtime's tools), 16
  (leftovers after a crash, old records and a disk that runs short) and 17 (the host's trouble
  against a branch's failure, which job 04 claimed and did not show). Job 04 gained the disk
  limit, and `HOST_FULL` now also covers a host short of disk.
- **Jobs were reworded to their outcomes:** 06 is the lane's push and no longer the outputs
  mechanism, 14 is the operator's during an incident, 07 runs the branch's new head, 12 ends on
  the warm run and 11 ends on what ran.
- **The record.** `run-start` and reads are journaled as digests, so a refused secret is not
  written down; log text never enters the journal; held entries and `run-settle` have a rule;
  writing an entry before the effect is named as AFD's change, not only Umbel's.
- **Bounded results.** Capped lists with totals, `log.location` and an output's `location` for
  a caller on the same computer, `ended` and `fault` on a run, and `waitExpired` in place of a
  name that read like the run's own `timed-out`.
- **The idea.** The first draft showed AFD only around a machine.
  [The idea](#the-idea) now says where AFD runs at each stage, M3 to M5 have draft jobs, and the
  far end of the owner's request is kept as a job and put to him.

A fourth reader made a second pass over the revision on 2026-11-21, in all three seats, against
the same code. It added no job and no command. What changed:

- **Pruning touches only the host's own.** The host labels what it makes; `host-status` and
  `host-prune` look at nothing else on a shared runtime.
- **A good branch is not ejected for the host's side.** `fault` gained `network`, and the lane
  keeps its own rule for an install step. A host that is full or whose runtime or journal is down
  is held, not paused on, and a long hold raises a `lane-error`.
- **The comparison with the runtime** also happens when the runtime comes back, a step still
  running is taken up again, and a `broken` machine is replaced by `machine-create`.
- **The journal's limits are stated:** digest mode keeps only top-level values, so step details
  live in the run's record; while the journal is down, stops are held and reads are dropped and
  counted; records sit on space of their own.
- **A toolchain change has a path:** an image may carry two versions of a tool.
- **Keeping time** covers outputs, destroyed machines and the mirror, and `run-get` says when a
  record has gone.
- **Smaller corrections:** the base is set on `origin/main` as well, outputs are regular files
  only, the lane's slot rule is described as the code has it, the token that gates loopback is
  named, and a caller's identity in M1 is stated for what it is.

A fifth reader walked job 18 on 2026-11-21, in all three seats, against the factory's code and
the cell brief. The job's first form had the cell run its own head with steps it wrote itself.
What changed:

- **The cell repeats the lane's run.** An ejection gave a cell no run, commit, base or steps,
  and the lane validates a folded commit (`validatedHead`) the cell never had. The `ejected` event
  now names the run, and a run's record keeps its steps and size, which `run-get` returns.
- **Where a cell's commits are.** The first form said they were already in the lane's
  repository. The lane fetches a queued head from origin, so that holds for the commit the lane
  ran, and is M0's to check for a repair that is not queued.
- **A fresh checkout is installed again.** The repair run had no install step.
- **The cell's limits are written down:** its own branch and only while it holds no seat, the
  lane's size, never a machine or a run it did not make, what it does when the host is full or
  its machine has expired, and that the lane keeps the id of the machine it made.
- **Text that put every use by a cell in M3 was corrected:** the first workload's row, the
  diagram and the list of M1's callers. M1's process names the cell brief's rule against whole
  suites.
- **M1's exit plants a branch** for this job and no longer waits for such a failure to happen.

Two independent reviewers then read the whole proposal on 2026-11-21 (Opus 5.5 and GPT-6.2
Astra, both at high effort). They added no job and no command. What changed:

- **What M1 leaves on the lane host is named,** and the push no longer runs the branch's hook.
  The first draft said M1 met the validation half of G4.
- **A checkpoint's contents are the operator's.** Any caller's passing run on `main` could have
  made one. It now takes the machine's one run of the configured steps (`RUN_NOT_CONFIGURED`,
  job 13).
- **The mirror is not mounted.** A checkout borrowed its objects, which let a run read every
  branch's commits and made a fourth mount beside job 02's three.
- **Results the lane must not take at face value:** `fault: network`, which a branch can cause,
  counts for the lane once; a kept machine is checked for runs the lane did not start; an
  output's whole path is checked for links; the host runs no git in a checkout after its run
  starts.
- **An image is qualified by `pnpm verify --all`,** since plain `pnpm verify` on `main` selects
  nothing.
- **The lane's table gained its rows for an install step,** and says where the lane pauses.
- **The promise about credentials is the one the design keeps:** none of the host's, with the
  secret rules as detection.
- **Smaller corrections:** the adapter's exact commands, a commit that need not be a merge, a
  `cancelled` run's `fault`, two machines for one branch in a fixture, the decision that names
  compiled plugins as trusted, and that M3 to M5 are direction and not scope.

A fresh end-to-end review on 2026-11-22 against `main` at `39ca857fd` (Gemini 4 Neon, high effort)
followed by a two-model independent review of the revision (GPT-6.2 Astra, high effort, and a
fresh read-only Gemini 4 Neon pass) added no job and no command, and caught and resolved:

- **M2 warm starts keep checkpointed `work` artifacts safely.** Replacing `work` with a fresh
  clone before every run would wipe `node_modules`, `.venv`, `dist/` and CMake builds from a
  checkpoint. The first run on a checkpointed machine now checks out `head` in place in its
  private layer only when the checkpoint's base commit is an ancestor of `base` (falling back to
  a fresh clone otherwise), resets both `main` and `origin/main` to `base` on every run, and
  adds a base-advance warm case to job 12.
- **Verify record and hook-free push reconciled.** Under hook-free push the lane checks the
  host's observed passing run (`state`, `head`, `tree`, `base`) and validates the external output
  at `output.location` via `main`'s `acceptRecord` (requiring an M1 factory integration test,
  including mismatch rejection). Status, Security, G4 and M1 exit criteria are conditional on
  Question 10, stating explicitly what stays on the lane host if the hook remains on.
- **Umbel and AFD rows completed.** Added plugin doctor checks for `workspace-doctor` (with the
  `host-status` fallback), journal health/buffer exposure (`HostBuilder::seal`, with M0 reporting
  Umbel's default mode), custom MCP server name/version, and a durable pre-effect intent
  requirement (with M1 crash-recovery testing) regardless of `spec/journal.md` vs sink-level
  format.
- **`botcore-factory` alignment.** Updated `What exists today` and `How the lane uses it` for
  `lane.py`'s pre-validation `fold` (`validatedHead`, `#1809`), kept immediate ejection for
  per-machine disk quota `over-limit` (`fault: branch`), and added an explicit mid-run host disk
  exhaustion outcome (`fault: host`, `reason: "host-disk-full"`) matching `lane.py`'s pause and
  requeue recovery.
- **Smaller clarifications:** destroying any existing `for: main` machine (waiting for an active
  `coverage` run to settle first) before building a checkpoint, defaulting omitted
  `run-start.base` to the mirror's `repository.base` head (making `run-get.base` always set),
  `ALREADY_EXISTS` id lookup and `force` destroy, M0 native image dependencies (`wasm32-wasip2`,
  OpenSSL, `loam-desktop` WebKitGTK/GTK, CMake/C++), and scoping `SECRET_IN_INPUT` to
  `run-start`.

Declined, with the reason:

- **A way to tell the operator from the lane in M1's record.** Both are `agent:loopback` until
  callers sign in. A label a caller sets itself would be its own word.
- **A command that runs something in a machine beside its run.** It would let a caller change
  what a validation is judged on. `machine-inspect` reads from outside, and a shell for
  debugging is M4's question, for a person.
- **Failing tests parsed out by the host.** The host cannot know every test runner. The lane
  reads the whole log from `log.location`, as it reads a log path today.
- **A wait on several runs, and a time to retry after `HOST_FULL`.** The lane's loop reads on
  each pass and cannot block, and the host cannot know when a seat will free. M0 measures what
  the reads cost the journal.
- **An AFD surface inside the machine in M1.** A validation has no agent in it. It is M3's.
- **Folding job 14 into job 11.** They serve different moments: an incident and a review after
  one.
- **A second job for a failure that does not happen in the machine either.** The host's part is
  a run that passes (job 01). What follows is the factory's rule for a flake.
- **A spare machine for each repository.** The count is the operator's to size across the lanes
  one host serves, and `lane-start` can check only its own.
- **Renaming the draft's codes to the catalog's now.** The lane's rules and the scenarios tell
  the host's refusals apart by code. [Commands](#commands-draft) names the candidates, and the
  specification decides.
- **A token of their own for cells in M1.** Umbel's mode `none` has one token, and a cell runs
  as the lane's user, so it would be a label. The factory's `factory-cell` host could carry the
  limits in a cell's tooling without enforcing them, and is left to M1's specification.

### What scenarios cannot show

- No scenario runs code in a machine. That code inside finds no credential (02), has no other
  route out (03) and leaves no file for the next machine (13) are exit tests against a real
  runtime.
- The clock cannot move between steps, so a time limit (04), a machine's expiry (08) and old
  records (16) are played by the fixture, and a restart (10) starts from a fixture already
  past it.
- Every step runs as the same test actor, so job 11 shows the supervisor and one caller, and
  job 18 cannot show that its caller is a cell. Which caller may run which command is M3's, with
  unit tests.
- Several scenarios run a single `validate` step for brevity. A real run of this repository
  installs first on a cold machine (where every run's checkout is fresh; job 18 runs both steps).
- `expect` cannot read `retryable`, so job 17 shows the refusal codes and the draft says which
  are worth retrying.
- Checking the host's observed run (`state`, `head`, `tree`, `base`) and validating the external
  verify record output with `main`'s `acceptRecord` (06) are M1 lane steps that require new factory
  integration tests (including rejection when the host result disagrees).
- Writing held journal entries once the journal returns (14), the reaper's schedule (16) and
  that log text stays out of the journal (11) happen between commands and need unit tests.
- Whether a machine is fast enough, what a cold and a warm validation cost, what the lane's
  reads cost the journal and whether disk comes back are measures in the exits of M1 and M2.

### Checks

Run 2026-11-22, after the end-to-end review revision
([jobs first](../../../../.claude/skills/afd/references/jobs-first.md)): `afd scenario validate`
and the dry-run check pass all 18 files (131 steps) with fixtures resolved. The coverage report
uses 15 of the 16 commands the scenarios may call (the 15 drafted here and Umbel's `event-list`):
all but `run-settle`, explained above. It uses all 19 error codes, and no scenario calls an
undrafted command. The output:

```
✓ All 18 scenario(s) are valid!
files 18, steps 131, files with problems 0
commands { tested: 15, known: 16, untested: [ 'run-settle' ], coverage: 93.75 }
errors { tested: 19, known: 19, untested: [], coverage: 100 }
not drafted: []
```

## Not in this proposal

- A kernel, a distribution, a package manager or a desktop.
- Machines that are not Linux, graphics processors, and scheduling machines across several hosts.
- Credentials inside a machine, at any milestone. M3 holds them at the proxy.
- A hosted service, or anything set up for other people.
- Building images through a command. An image is the operator's until a job needs otherwise.

## Exit criteria

- M0: `host-status` on the lane host names the image by digest, `pnpm verify --all` on `main`
  passes in that image, and the open items are settled in writing.
- M1: every `m1` scenario passes; crash recovery at the pre-effect journal boundary and the
  lane's external verify-record check (including mismatch rejection) pass their tests; one fleet
  run with every validation in a machine; the test branch finds no credential, no file outside
  its workspace and no route out, and its hook does not run on the lane host; a cell repeats a
  planted branch's failed run in a machine of its own; disk use returns to its level and nothing
  unlisted remains; validation time, the journal's growth and the count of operator uses of the
  runtime's own tools are reported.
- M2: the `warm` scenarios pass; one branch's file is absent from the next machine; warm
  validation time is reported.
- M3 to M5 have no exit yet. Each gets one in its own specification: M3's is written when M1
  exits, M4's when M3 exits and M5's when M4 exits.

## For the owner

All thirteen questions were addressed and recorded in [Decisions](#decisions): three on 2026-11-21
(where AFD runs, Umbel's rules, and repairing a failure that only happens on Linux) and the ten
below on 2026-11-25, promoting the feature to `active/loam-os` under Epic
[#2595](https://github.com/lushly-dev/afd/issues/2595) (only public claim wording under question 3
remains open for when Loam OS is announced publicly).

1. **The far end (answered 2026-11-25).** Keep a full desktop/OS UI beyond M5, built on AFD with a
   web-based Loam shell; no standalone headless-only product edition.
2. **Jobs (answered 2026-11-25).** Keep all eighteen jobs in their proposed build order.
3. **Name (answered 2026-11-25).** **Loam OS** (public claim wording remains open).
4. **Where it lives (answered 2026-11-25).** A new Rust unit under `endpoints/` in `afd`, depending
   on Umbel's crates and registered in `architecture.json`, for M0–M4; revisit splitting out at M5.
5. **Validation on Linux only (answered 2026-11-25).** Run the lane's `coverage` in a machine too,
   and rely on CI's Windows and macOS jobs for those systems.
6. **Images (answered 2026-11-25).** Operator builds and pins each image by digest by hand in M0–M1.
7. **Base distribution (answered 2026-11-25).** Minimal headless Ubuntu LTS for M0–M4; M5 reopens
   the choice.
8. **The container runtime (answered 2026-11-25).** No owner preference; M0 measures candidates on
   the lane hosts.
9. **G4 (answered 2026-11-25).** Amend Factory Gateway G4 at M1 exit to record the validation half
   met here (install, tests, and hook-free push) and what remains: regeneration during a merge
   (closed by M3 or G4), and G4's half about agents' own users, kept until M3.
10. **The lane's push without the branch's hook (answered 2026-11-25).** Approved for M1: the lane
    verifies the host's observed passing run and `main`'s `acceptRecord` on the output file, then
    pushes with the branch's pre-push hook off.
