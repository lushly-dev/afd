---
name: do-prepare-pr
description: >
  Ships an AFD branch: base sync, independent review, docs, commit, `pnpm verify`,
  PR and readiness, merging only when separately authorized. `inspect` changes
  nothing; `quick` reruns gates and the PR. Use when the user says ship it, open a
  PR or prepare the PR.
argument-hint: inspect | quick
---

# Do Prepare PR

Keep the order where it protects correctness: base sync before review, so the review sees the integrated tree; fixes before the commit; gates on the final tree; the PR after the gates.

## Modes

- `inspect`: readiness facts only. No fetch, edit, commit, push or PR change.
- No argument: steps 1 to 9.
- `quick`: steps 5 to 9, only when review and docs evidence covers the exact final diff and base. Otherwise run full mode.

## Readiness facts (every mode)

```bash
git status --short                          # classify every dirty file
git log --oneline origin/main..HEAD
git rev-list --count HEAD..origin/main      # behind the last fetch
git diff --name-only origin/main...HEAD
pnpm verify --list                          # suites this diff triggers; runs nothing
pnpm changeset status --since origin/main   # read it, don't gate on it
```

Stop on unknown dirty files, an in-progress merge or rebase, or work that already landed. After a squash merge "0 ahead" is ambiguous; use `do-init-afd`'s content-based landing check, and never open a duplicate PR.

## Full mode

1. **Base sync.** `git fetch origin '+refs/heads/main:refs/remotes/origin/main'`, then `git merge --no-edit "$(git rev-parse origin/main)"` (or the harness's base-sync tool). Set work aside with a WIP commit, never `git stash`: the stash stack is shared across worktrees. If the base moved, `pnpm install --frozen-lockfile`.

2. **Review.** Self-review with `review-code`, then brief a fresh reviewer in this harness as `review-code` describes, with the acceptance criteria; take its model and effort from [model routing](../../../docs/operations/model-routing.md) and the change's risk. It checks AFD's risks explicitly:
   - **Jobs:** a proposal or specification that adds or changes commands has each job as a scenario file, every drafted command is used by one or the proposal says why it stays, the paths of a new proposal, or of a revision that adds jobs or commands, were walked by readers who did not write it and the proposal says what that changed, and the test plan shows the output of the checks in the afd skill's [jobs-first.md](../afd/references/jobs-first.md) (the session runs them; no gate does); a built feature runs its scenarios in its tests.
   - **Contract:** every `failure()` has a `suggestion`; `domain-action` names; no silent `CommandResult` shape change.
   - **Parity:** agent-visible behaviour changed in one language is matched in the others or has a tracked follow-up; `spec/` and the todo conformance suite are the shared contract; an added or removed export can break alfred's parity budget.
   - **Public API:** a removed or renamed export needs a `major` changeset or a breaking entry in that implementation's changelog.

   Reviewers report and never edit; the session fixes. Converge in one broad pass plus at most one focused pass verifying the fixes; a third pass may only verify an unresolved blocker. Every independent pass so far has found real defects, so full mode never ships on self-review alone: with no independent reviewer available, stop and report the review incomplete. Record findings, fixes, dispositions and the reviewer's actual model and effort for the PR body.

3. **Docs.**
   - **Changeset** for a user-facing change to a `@lushly-dev/*` npm package; write the fragment in `.changeset/` by hand (`pnpm changeset` prompts). Bump by impact on that package: `major` breaking, `minor` capability, `patch` fix. Only the nine `afd-npm` packages share a version (`fixed` in `.changeset/config.json`), so a bump to one moves all nine; other families are independent, and a quarantined unit's fragment waits for admission. None for Python, Rust, C++, alfred, example, docs or tooling changes.
   - **Changelogs:** the root `CHANGELOG.md` is an index; never add entries there. Python, Rust and C++ changes go under unreleased in `python/CHANGELOG.md`, `packages/rust/CHANGELOG.md` or `packages/cpp/CHANGELOG.md`. An imported unit (Botcore, Violet, FAST-AF, Specimen, Health) keeps its own `CHANGELOG.md` (`endpoints/botcore/CHANGELOG.md` is the Botcore release track's) and provenance records; editing its files means updating both, and its provenance tests fail until you do. Correct an existing entry rather than stacking a contradictory one.
   - **Feature plans:** update the tracking plan under `docs/features/`; when the work ships, move its folder to `complete/` and update `docs/features/README.md`.
   - Never add a `CLAUDE.md`. Update any skill or package README the change makes wrong, in the same PR.

4. **Commit** with a message that says why: type and scope from `commitlint.config.js` (no scope for cross-cutting work), subject at most 72 characters. Stage only intended files.

5. **Gates on the final tree.** Run `pnpm verify` on the `.nvmrc` Node (see `do-init-afd`'s Runtime; for example `fnm exec --using "$(cat .nvmrc)" -- pnpm verify`). It runs `pnpm check`, then each triggered workflow's local suite, and prints what only CI covers. It stops at the first failure; `--keep-going` runs the rest so one pass shows every failure. When a gate fails for a reason its output does not explain, or the change touches CI or `scripts/affected`, read [gates.md](references/gates.md): what each gate covers, the per-unit notes (provenance, regenerated fixtures) and the rules for changing CI.
   - **Missing tool.** It preflights `uv`, `cargo`, `cmake` and `openssl` and aborts before running anything if a step it planned needs a missing one. Then run `pnpm check` and each `--list` step yourself, in its directory, one command per step: brace-expanding `test:conformance:{ts,py}` runs only the first script and passes the rest as ignored arguments. Chromium isn't preflighted; a missing browser fails mid-run. Report what could not run as not run, never as passed.
   - **Wide plans.** A docs-only edit can trigger heavy suites: a `packages/rust` README change runs Loam and Umbel (Chromium, a Rust build, about 14 GB of Umbel target directory). Read `--list` before choosing what to touch, and check `df -h` before an Umbel run.
   - **Fresh worktree.** Install first (`do-init-afd` explains the `npx` trap), and run tools by hand as `pnpm exec <tool>`.

6. **Push.** `git push -u origin <branch>`; on a hook failure, fix and push again. Never `--no-verify` without the user's explicit approval and separate gate evidence for that exact commit.

7. **Create or update the PR.**
   - **New:** `gh pr create --base main --title "<type>(scope): description"`, body **Summary** (why, and the behaviour change), **Changes**, **Scope notes** (deliberately not done, parity follow-ups, why a changeset or not), **Review** (passes, dispositions) and **Test plan** (exact commands and results, and what was not run). No filler or restated diff. `--draft` when someone else owns the ship decision.
   - **Existing:** the push updates it; `gh pr edit` the title and body if scope changed. Never open a second PR for the same work.
   - **Closing an issue:** confirm `gh pr view <n> --json closingIssuesReferences` lists it; a keyword inside a code span looks right and does nothing.

8. **Own readiness.** After publication and every head or base change, read `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup,headRefOid,baseRefOid`.
   - `DIRTY`: merge the latest `origin/main`, keep both sides, rerun the affected gates, push.
   - `UNKNOWN`: not computed yet. Read again; don't infer a conflict.
   - Path filters vary the check set by PR. Every check that ran on the current head must be green, none pending.
   - A base advance doesn't reset the review; re-review only the seams the integration changed.

9. **Merge only when authorized.** `main` has no branch protection or required checks, so nothing stops a red merge and auto-merge would not wait for CI: never enable it. With the user's authorization and every check on the exact head green, bind the merge to that head:

   ```bash
   gh pr merge <n> --squash --match-head-commit <full headRefOid verified in step 8>
   ```

   A pull request that changes `pnpm-lock.yaml` merges one at a time, rebased onto the new `main` first ([gates.md](references/gates.md)). A short SHA is rejected; re-reading the head at merge time would bind whatever is there now. A mismatch sends you back to step 8. After the merge, fetch and run `do-init-afd`'s content-based landing check on the branch's files; a bare `git diff HEAD origin/main` also shows other PRs' changes. Head branches are deleted on merge. Without authorization, stop and report the PR URL, head SHA, check state and the owner's next action.

## Report

A few lines: base (`origin/main` SHA, merged or current); review (passes, findings fixed, dispositions, or why it did not run); docs (changeset and changelog, or why none); gates run and their results, and gates not run with the reason; PR number, head SHA, mergeability and checks; merged or the next action.
