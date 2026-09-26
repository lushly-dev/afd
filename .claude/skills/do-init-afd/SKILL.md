---
name: do-init-afd
description: >
  Session bootstrap for AFD: preflights the worktree and toolchains, refreshes and
  records origin/main, installs or verifies dependencies, classifies dirty files,
  adopts the provided issue or brief, and summarizes project state before work
  starts. First stage of the session loop (do-init-afd → do-prepare-pr →
  do-end-session). Use when starting a session, resuming a worktree, checking
  project state, or beginning implementation. Triggers: init, session start,
  bootstrap, start session, begin work, resume session, project state.
---

# Do Init AFD

Bootstrap a session before doing work. The most expensive session failure is
building on a stale base: a worktree cut from an outdated local `main` can be many
commits behind and carry another task's commits. This skill catches that on turn
one, not after review.

## 1. Preflight

Establish machine state with commands, not memory:

```bash
git rev-parse --abbrev-ref HEAD    # never infer the branch from the directory name
git status --short
git log --oneline -3
```

Stop immediately on an in-progress merge or rebase, or when `origin` does not
resolve (`git remote get-url origin`).

If the tree is dirty, classify every file as **intended task work**, **unrelated
work**, or **unknown** before proceeding. Never edit, stage, or revert unrelated or
unknown files, and carry the classification forward to `do-prepare-pr`.

Worktrees share one `.git`, so the stash stack is shared with every other session.
Never use bare `git stash` / `git stash pop`; set work aside with a WIP commit.

### Runtime

Read `.nvmrc` and `package.json`'s `engines`/`packageManager`, then check
`node --version`, `node -p 'process.execPath'`, and `pnpm --version` in the shell
that will run the work. CI runs Node 22.x and 24.x; `.nvmrc` pins the local
default. Select the pinned Node with whatever version manager is already
installed; do not install global packages or assume one tool invocation's runtime
carries into the next.

Lefthook hooks and `pnpm check` call bare `pnpm`. If a fresh worktree has no `pnpm`
on PATH, create a session-owned shim directory outside the tracked tree containing
an executable `pnpm` that runs `exec corepack pnpm "$@"`, and prefix that directory
and the pinned Node's bin directory to `PATH` for each command. Never edit shell
profiles, `core.hooksPath`, or shared hook shims for this. A PATH or Node mismatch
is an environment defect to repair before treating a failure as a code result.

Check the other toolchains only when the task touches them:

| Touches | Needs |
|---|---|
| `python/`, the todo Python backend | `uv` (`cd python && uv --version`) |
| `packages/rust/`, the todo Rust backend | `cargo`; `packages/rust/rust-toolchain.toml` pins the toolchain |
| `alfred/` | `uv` |

### Detached checkouts

A worktree can start at a detached HEAD. After preflight, create a branch at the
current commit and continue without asking. Honor an explicit user branch name;
otherwise choose a unique name prefixed by the harness (`claude/<task-slug>` or
`codex/<task-slug>`), or `<harness>/session-<suffix>` when no task is known.

```bash
checkout_sha=$(git rev-parse HEAD)
git switch -c "$session_branch" "$checkout_sha"
```

If an automatically chosen name already exists, choose a new suffix. If the
user's explicit name already exists, ask them to resolve it. Never force-create
or repoint an existing branch. Creating the branch at the current commit preserves detached
commits and dirty files. Do not reset to `main` or stash to attach HEAD. Report the
created branch and starting SHA. An explicit request to stay detached wins.

## 2. Refresh the base

```bash
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
```

The explicit destination proves the shared remote-tracking ref updated; a bare
fetch that only updates `FETCH_HEAD` is not freshness evidence. If a linked-worktree
race causes a ref-lock failure, retry once. Never describe a failed fetch as fresh.

Integrate by immutable SHA. Never `git pull`, never stash:

```bash
base_sha=$(git rev-parse origin/main)
git merge --ff-only "$base_sha"
```

If the harness that created the worktree offers its own base-sync tool, use that
instead of merging by hand.

- **Fast-forward succeeds**: continue.
- **Fast-forward fails (diverged)**: do not force it. Run the landing check
  (below). The branch's commits may already be squash-merged into `main`, may be
  another task's unlanded work, or may be genuine WIP. Report what you find. For new
  work the usual answer is a fresh branch off `origin/main`.
- **Branch already carries task work**: use `git merge --no-edit "$base_sha"` at
  natural checkpoints instead of ff-only, and resolve conflicts in context.

After any integration, run `pnpm install --frozen-lockfile`. A moved base can change
the lockfile, and the type checker cannot detect a stale dependency graph. When the
task touches Python, sync the affected project the way its workflow does, so the
test and lint extras are installed: `uv sync --frozen --all-extras` in `python/`,
`uv sync --all-extras --dev --frozen` in `alfred/`, and `uv sync --locked` in
`packages/examples/todo/backends/python/`.

### Landing check

To answer "did this work already land on main?", compare **content**, never
commits:

```bash
git diff origin/main HEAD -- <files the branch changed>
```

An empty diff on those files means landed. A non-empty diff means not landed, or
`main` has moved past it; read the diff. Never answer the question with these:

- `git rev-list origin/main..HEAD` or `git cherry`: ambiguous after a squash merge.
- A missing remote branch: `delete_branch_on_merge` is on, so absence usually
  means merged, but a never-pushed or hand-deleted branch looks the same. Check
  the PR instead: `gh pr list --state all --head <branch>`, then read `.merged`
  (`gh api repos/lushly-dev/afd/pulls/<n> --jq .merged`), not `.state`.

## 3. Task intake

If the invocation or conversation already carries the task (issue number, brief,
plan doc), adopt it instead of asking what to build:

- **GitHub issue**: `gh issue view <number> --json title,body,labels,comments`.
- **Feature plan**: read the plan files in its `docs/features/` folder. Plan updates ship in the same PR as the work.
- **Clarifying questions are for gaps, not ritual.** Ask only when a genuine gap
  blocks correct scoping (ambiguous acceptance criteria, unknown owning package or
  language, conflicting constraints), batched into one round. Authorization,
  credentials, a public API break nobody approved, or an unresolved design decision
  stops the session with the blocker named rather than becoming an assumption.

**When the task arrives without an issue number, search for one before building.**

```bash
gh issue list --state open --search "<symbol or error code> in:title,body"
```

Search the symbol, not a summary of it (`CommandResult`, `UNKNOWN_TOOL`, the command
name). An existing issue is already triaged and often names adjacent cases the new
report misses. Adopt it, and if the new work is narrower, say which parts you are
closing and which stay open.

**Cross-language scope.** TypeScript is the behavioral reference; Python and Rust
are ports held to it by `spec/` and the todo conformance suite, and a C++ port is
planned (#270). When the task
changes agent-visible behavior in one language, note whether the other ports need
the same change or a tracked follow-up (see `docs/features/active/*-parity`).

## 4. Orient and report

1. `git log --oneline -10 origin/main`: what landed recently.
2. `ls docs/features/active/`: what is in progress.
3. Produce a concise summary, then continue into the work in the same turn when a
   task is adopted. The report is a progress note, not a stopping point.

```
AFD session ready:
  Checkout: <branch> @ <short-sha> (created from detached | existing)
  Base:     origin/main @ <short-sha> (fresh | fetch failed: <reason>)
  Tree:     clean | N files (<classification>)
  Deps:     installed | verified | unavailable (<reason>)
  Runtime:  <Node version + path; pnpm version; uv/cargo if needed>
  Task:     <acceptance target | "none adopted — tell me what to build">
  Scope:    <packages/languages touched; parity follow-ups if any>
  Finish:   do-prepare-pr ships it; do-end-session closes it.
```

## Workflow chain

`do-init-afd` → build (gates per `run-dev-checks`) → `do-prepare-pr` →
`do-end-session`.
