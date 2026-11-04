---
name: do-init-afd
description: >
  Starts an AFD session: preflights the worktree, refreshes origin/main, installs
  dependencies, classifies dirty files and adopts the issue or brief. Use when
  starting or resuming work ("start session", "init", "resume this worktree"); ship
  with do-prepare-pr, close with do-end-session.
---

# Do Init AFD

The costliest session failure is a stale base: a worktree cut from an old local
`main` can lag far behind and carry another task's commits. Catch it on turn one,
then go straight on into the adopted task.

## 1. Preflight

```bash
git rev-parse --abbrev-ref HEAD   # the branch, not the directory name; HEAD when detached
git status                        # long form: --short hides a merge once its conflicts are staged
git remote get-url origin
```

**Stop** on an in-progress merge, rebase or cherry-pick, or when `origin` does not
resolve. Name the state and do nothing else.

**Dirty tree.** Classify every file as task work, unrelated or unknown. Never edit,
stage or revert unrelated or unknown files; carry the classification to
`do-prepare-pr`.

**No bare `git stash`.** Worktrees share one `.git`, so every session shares the
stash stack and a `pop` can take another session's changes. Use a WIP commit.

**Detached HEAD.** Branch at the current commit without asking:
`git switch -c "$branch" "$(git rev-parse HEAD)"`, named as the user says (if that
name exists, ask) or a unique `<prefix>/<task-slug>` (recent branches use `lush/`).
Never force-create or repoint a branch, reset to `main` or stash to attach HEAD;
each can lose detached commits or dirty files. Stay detached if asked to.

**Runtime.** Use the `.nvmrc` Node, the only one pull-request CI runs. The shell's
default may be older and a selection does not survive between tool calls, so select
it per command (`fnm exec --using "$(cat .nvmrc)" -- <cmd>`). If `pnpm` is missing
(hooks call it bare; Node 26 bundles no corepack), fix `PATH` for the session only,
never shell profiles, `core.hooksPath` or hook shims. Repair a PATH or Node mismatch
before reading any failure as a code result.

## 2. Refresh the base

```bash
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
base_sha=$(git rev-parse origin/main)
git merge --ff-only "$base_sha"
```

The explicit refspec proves the shared tracking ref moved (`FETCH_HEAD` alone proves
nothing). Retry once on a ref-lock failure; never call a failed fetch fresh. Merge
the SHA, never `git pull`, so the base you report is the one you merged. If the
harness has its own base-sync tool, merge with that instead.

- **Diverged:** don't force it. Run the landing check: the commits may be
  squash-merged already, another task's unlanded work, or real WIP. Report which;
  new work usually gets a fresh branch off `origin/main`.
- **Branch carries task work:** `git merge --no-edit "$base_sha"` at natural
  checkpoints instead.

Then run `pnpm install --frozen-lockfile`, and in a fresh worktree even if nothing
moved. A moved base can change the lockfile, which the type checker cannot see. The hooks neither install nor
build, and without `node_modules` the pre-commit hook's `npx biome` reaches the npm
registry (one session ran an unrelated package named `biome`), so run tools as
`pnpm exec <tool>`. `pnpm verify --list` prints each uv project's `uv sync` line.

### Landing check

To answer "did this already land?", compare content, never commits:

```bash
git diff --name-only "$(git merge-base origin/main HEAD)" HEAD   # the branch's files
git diff origin/main HEAD -- <those files>
```

Empty means landed; otherwise it has not landed or `main` moved past it, so read the
diff. These don't answer it:

- `git rev-list origin/main..HEAD` or `git cherry`: ambiguous after a squash merge.
- A missing remote branch: head branches are deleted on merge, but a never-pushed or
  hand-deleted branch looks the same. Find the PR
  (`gh pr list --state all --head <branch>`) and read
  `gh api repos/lushly-dev/afd/pulls/<n> --jq .merged`; REST `.state` is `closed`
  for merged and abandoned alike.

## 3. Task intake

Adopt the task the invocation or conversation carries instead of asking what to build.

- **Issue:** `gh issue view <n> --json title,body,labels,comments`.
- **Feature plan:** read its `docs/features/` folder; plan updates ship in the same
  PR as the work.
- **No issue number:** search first, by symbol rather than summary (`CommandResult`,
  `UNKNOWN_TOOL`, the command name):
  `gh issue list --state open --search "<symbol> in:title,body"`. An existing issue
  is triaged and often names adjacent cases. Adopt it, saying which parts you close
  and which stay open.
- **Ask only about gaps** that block scoping (ambiguous acceptance, unknown owning
  package or language, conflicting constraints), in one round. Missing authorization
  or credentials, an unapproved public API break or an open design decision stops
  the session with the blocker named.
- **Cross-language:** for an agent-visible change in one language, note whether
  the other ports need it now or as a tracked follow-up (`docs/language-parity.md`).
- **Gate plan:** before choosing what to touch, run
  `pnpm verify --list --files <paths>`. A docs-only edit can widen it: a README
  under `packages/rust/` pulls in five workflows, Umbel among them. `pnpm verify`
  aborts before running anything if `uv`, `cargo`, `cmake` or `openssl` is missing
  (it does not check Chromium). Before an Umbel or Loam mounted run, check free
  disk: one Umbel build took its target directory to 14 GB
  (`endpoints/umbel/docs/STATUS.md`).

## 4. Report

A few lines: branch @ SHA (created or existing); `origin/main` @ SHA, fresh or the
fetch failure; each dirty file's class; install and Node version; the task's
acceptance target, or none; scope (packages, languages, gate plan, missing
toolchains, parity follow-ups).
