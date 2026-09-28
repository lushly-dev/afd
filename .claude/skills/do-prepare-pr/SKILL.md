---
name: do-prepare-pr
description: >
  Ready-to-ship orchestrator for AFD: syncs the base, runs an independent review,
  updates changesets, CHANGELOG and docs, commits, runs every quality gate the diff
  needs (TypeScript, Python, Rust, C++, conformance, alfred), then creates or updates the
  PR and drives it to merge when authorized. Inspect mode reports readiness without
  mutating anything; quick mode skips review and docs already done. Second stage of
  the session loop. Use when inspecting readiness or ready to ship. Triggers:
  prepare pr, prep pr, ready to ship, ship it, open pr, create pr, push and open pr,
  finalize pr, quick pr.
argument-hint: inspect | quick
---

# Do Prepare PR

Run this workflow in the harness the session started in, Claude Code or Codex. Do
not hand any step to the other harness or attribute one harness's work to the
other.

This is an orchestration contract, not a rigid script. Keep the ordering where it
protects correctness: base sync before review, fixes before commit, gates on the
final tree, PR after the gates.

## Modes

| Argument | What runs |
|---|---|
| `inspect` | Readiness report only. No fetch, edits, commit, push, or PR mutation. |
| _(none)_ | Base sync → review → docs → commit → gates → push → create/update PR → merge if authorized. |
| `quick` | Steps 5–9: gates → push → create/update PR → readiness → merge if authorized. Only when review and docs already cover the exact final diff. |

## Readiness facts (all modes)

Derive from commands, never memory:

```bash
git status --short                                  # dirty tree + ownership classification
git log --oneline origin/main..HEAD                 # commits to ship (see caveat)
git rev-list --count HEAD..origin/main              # how far behind the last fetch
git diff --name-only origin/main...HEAD             # what the gates must cover
pnpm changeset status --since origin/main           # changeset presence (read, don't gate)
```

After a squash merge, "0 commits ahead" is ambiguous. If anything is surprising,
use the content-based landing check from `do-init-afd`.

Blockers: unknown dirty files, an in-progress git operation, or work that already
landed (do not open a duplicate PR).

## Full mode

1. **Base sync.** `git fetch origin '+refs/heads/main:refs/remotes/origin/main'`,
   then `git merge --no-edit "$(git rev-parse origin/main)"`. If the harness that
   created the worktree offers its own base-sync tool, use that instead. Never stash; the stash is shared across
   worktrees. Preserve uncommitted work with a WIP commit if needed. Review runs
   after this so conflicts and stale assumptions are reviewed in final context.

2. **Review.** Run `do-review` (self-review) against the full branch diff
   (`git diff origin/main...HEAD` plus uncommitted work), then dispatch a fresh,
   independent reviewer that did not write the code: a subagent in Claude Code, or
   the equivalent in Codex. Give it the diff, the task's acceptance criteria and
   the `review-code` methodology. Reviewers report and never edit; the session
   fixes. An unavailable independent reviewer blocks Full mode: stop and report
   that review is incomplete rather than shipping on self-review alone. Converge
   with one broad pass and at most one focused verification pass. A third pass may
   only verify an unresolved blocker. Check AFD-specific risks explicitly:
   - **Contract:** every `failure()` carries a `suggestion`; commands use
     `domain-action` naming; no silent change to `CommandResult` shape.
   - **Parity:** agent-visible behavior changed in one language is either matched
     in the others or has a tracked follow-up. `spec/` and the todo conformance
     suite are the shared contract; the alfred MCP server's parity command reports
     export-surface gaps.
   - **Public API:** a removed or renamed export is a breaking change and needs a
     `major` changeset or a breaking entry in that implementation's changelog.
   Record passes, findings, fixes and dispositions for the PR body.

3. **Docs.**
   - **Changeset** (`pnpm changeset`) when a published `@lushly-dev/*` package
     changes user-facing behavior. All packages share one version, so pick the
     bump by impact: `major` breaking, `minor` new capability, `patch` fix. No
     changeset for Python-, Rust-, C++-, alfred-, example- or tooling-only changes.
   - **Changelogs**: the root `CHANGELOG.md` is an index; never add entries to
     it. Add user-facing Python, Rust and C++ changes to the unreleased section of
     `python/CHANGELOG.md`, `packages/rust/CHANGELOG.md` or
     `packages/cpp/CHANGELOG.md`; npm packages get theirs from the changeset.
     Correct an existing entry rather than stacking a contradictory one.
   - **Feature plans**: if a `docs/features/` plan tracks the work, update it in
     the same PR. When it ships, move the folder to `complete/` and update the
     tables in `docs/features/README.md`.
   - **Instructions and skills**: `AGENTS.md` is the only project instruction
     file; never add or restore a `CLAUDE.md`. When a change alters a
     pattern a skill teaches (for example `afd-rust`, `afd-typescript`), update
     that skill in the same PR.
   - **Package READMEs** for new or changed public surface.

4. **Commit.** Run `do-commit` (it delegates to `write-commits`). commitlint
   enforces Conventional Commits: the scope must come from `scope-enum` in
   `commitlint.config.js` (`core`, `server`, `python`, `rust`, `alfred`, …) or be
   omitted for cross-cutting work, and the subject is at most 72 characters. Stage
   only intended files. The pre-commit hook runs Biome, portability, file-size and
   typecheck.

5. **Gates on the final tree.** The pre-push hook covers TypeScript only. CI's
   workflows are path-filtered; run every gate whose paths the diff touches (the
   `on.paths` lists in `.github/workflows/*.yml` are authoritative):

   | Workflow | Runs when the diff touches | Local commands |
   |---|---|---|
   | `ci.yml` | anything | `pnpm check` |
   | `python.yml` | `python/**`, `spec/VERSION` | `cd python && uv lock --check && uv sync --frozen --all-extras`, then `uv run ruff check --select F821,F841,B904 src` and `uv run pytest -q` |
   | `rust.yml` | `packages/rust/**`, `spec/wire/**`, `spec/VERSION` | in `packages/rust`: `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings` and `cargo test`, each also with `--no-default-features`; `cargo check --target wasm32-unknown-unknown --no-default-features --features wasm` |
   | `cpp.yml` | `packages/cpp/**`, `spec/wire/**`, `spec/vectors/**`, `spec/pipeline-variables.md`, `spec/VERSION`, `packages/examples/todo/spec/**`, `packages/examples/todo/backends/cpp/**` | in `packages/cpp`: `cmake --preset dev && cmake --build --preset dev && ctest --preset dev`; CI also runs clang-format (pinned: `uvx --from clang-format==<version in cpp.yml>`), sanitizer, MSVC, Emscripten and fuzz jobs |
   | `conformance.yml` | `packages/examples/todo/**`, `packages/server/**`, `packages/core/**`, `packages/rust/**`, `packages/cpp/**`, `python/**`, `pnpm-lock.yaml` | see below |
   | `alfred.yml` | `alfred/**`, `python/**`, `spec/**`, `packages/**` | `cd alfred && uv sync --all-extras --dev --frozen`, then `uv run ruff check .` and `uv run pytest tests/` |

   Conformance runs as separate commands. Do not brace-expand the script names:
   pnpm runs only the first script and passes the rest as ignored arguments, so
   the Python, Rust and C++ backends would silently not run.

   ```bash
   pnpm build
   (cd packages/examples/todo/backends/python && uv sync --locked && uv run --locked pytest -q)
   pnpm --dir packages/examples/todo test:conformance:ts
   pnpm --dir packages/examples/todo test:conformance:py
   (cd packages/examples/todo/backends/rust && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked)
   pnpm --dir packages/examples/todo test:conformance:rs
   (cd packages/examples/todo/backends/cpp && cmake --preset release && cmake --build --preset release && ctest --preset release)
   pnpm --dir packages/examples/todo test:conformance:cpp
   git status --porcelain   # unchanged from before the run: the stores never write tracked files
   ```

   `alfred.yml` matters for TypeScript changes too: its parity test enforces an
   export-gap budget, so adding or removing a TypeScript export can turn it red. Changes
   to `.github/workflows/**` must pin actions to a full commit SHA with a
   `# vX.Y.Z` comment (`scripts/repository-contract.test.mjs` enforces this).

   A gate that could not run (missing toolchain, network) is reported as not run,
   never as passed.

6. **Push.** `git push -u origin <branch>`. The pre-push hook runs lint, test,
   typecheck, portability, file-size, orphan-files and the tooling tests. If it
   fails, fix and push again. Never `--no-verify` without explicit user approval
   and separate gate evidence for the exact commit.

7. **Create or update the PR.**
   - **New:** `gh pr create --base main --title "<type>(scope): description"`.
     Body sections: **Summary** (why, and what changed at the behavior level),
     **Changes**, **Scope notes** (what is deliberately not done, parity
     follow-ups, why there is or is not a changeset), and **Test plan** (exact
     commands and results, tests that failed before the fix). Match the body to the
     change; no filler and no restated diff. Use `--draft` when the ship decision
     belongs to someone else.
   - **Existing:** the push updates it; refresh the title and body with
     `gh pr edit` if scope changed. Never open a second PR for the same work.
   - **Closing an issue:** after creation, verify GitHub parsed the link with
     `gh pr view <n> --json closingIssuesReferences`. A keyword inside a code span
     looks right but does nothing.

8. **Own PR readiness.** After publication, and after every head or base change,
   read `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup,headRefOid,baseRefOid`.
   - `DIRTY`: resolve now. Merge the latest `origin/main` into the branch,
     preserve both sides, re-run the affected gates, push normally.
   - `UNKNOWN`: GitHub has not computed mergeability yet. Re-read; do not infer a
     conflict.
   - Workflows are path-filtered, so the set of checks varies by PR. Every check
     that ran on the current head must be green, and none may be pending.
   - A base advance does not reset the review. Only re-review seams that the
     integration actually changed.

9. **Merge only when authorized.** `main` has no branch protection or required
   checks, so nothing on GitHub stops a red merge, and auto-merge would not wait
   for CI. Do not enable auto-merge. When the user has authorized the merge, verify
   every check on the exact head is green, then bind the merge to that head:

   ```bash
   gh pr merge <n> --squash --match-head-commit <verified-head-sha>
   ```

   A head mismatch sends you back to step 8. After GitHub reports merged, verify
   the content landed with the landing check from `do-init-afd` before calling it
   done. The repo deletes head branches on merge. When the merge was not authorized, stop with the PR URL, head SHA, check
   state and the next action for its owner.

## Quick mode

Steps 5–9 only. Do not use it to bypass review: it requires review and docs
evidence for the exact unchanged diff and base. Otherwise run Full.

## Report

```markdown
## Prepare PR complete
- Base: origin/main @ <short-sha> (merged in | already current)
- Review: self-review + independent reviewer, <N> passes | independent review not run (<why>: not ready); <N> fixed; <dispositions | none>
- Docs: changeset <bump | none needed (why)>; CHANGELOG <updated | n/a>; plans/skills <updated | n/a>
- Commit: <type>(scope): subject (<short-sha>)
- Gates: <each gate run and its result; gates not run and why>
- PR: created #N | updated #N → <url>
- PR state: head <short-sha>; mergeability <state>; checks <green | pending | failing: names>; <merged | next action>
- Remaining risks: <none | list>
```

## Workflow chain

`do-init-afd` → build → `do-prepare-pr` → `do-end-session`.

Standalone phases: `do-review` (review only), `do-commit` (commit only), `do-pr`
(PR mechanics only), `do-release` (versioning and publish, after merge).
