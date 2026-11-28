---
name: maintain-gates
description: >
  Rules for adding, changing or exempting a quality gate: watch it fail, assert
  properties, make exemptions expire, register skipped tests, report weakened ones.
  Use when editing a check, hook or CI, skipping a test or reviewing a test or gate
  diff.
metadata:
  source: botcore
  version: 1.1.0
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical gate-discipline skill. -->

# Gate discipline

A convention holds exactly where something exits non-zero. Agents optimize for "make
the checks pass", so an unenforced convention does not exist, and a gate that can be
passed by checking less will be. These rules cover every gate surface: git hooks, CI
workflows, check scripts, linter and dead-code configuration, coverage floors and the
test suites themselves.

## Watch it fail

A check never seen failing is not yet known to be a check. Before finishing any work
whose deliverable is a gate (a new or edited check, a rewired hook, a moved script):

1. **Plant** the exact violation the gate exists to catch, in a real file it scans.
2. **Prove red:** run the gate and confirm its output names the violation. A non-zero
   exit alone proves nothing, since a crashed harness exits non-zero too.
3. **Remove** the plant. If it sat in uncommitted work, restore from a copy:
   `git restore` resolves against HEAD and can delete the feature under test.
4. **Prove green** with a clean re-run.

Self-review can't substitute: re-reading a check exercises the mental model that
produced its blind spot. Only running it against an input the author didn't imagine
separates "looks right" from "works". Say in the pull request what you planted and
what the gate printed.

## Assert properties, not shapes

The recurring defect asserts a *shape* (a test file exists, a command is wrapped, a
directory is listed) instead of the *property* it should guarantee (the test asserts
something, the tree is covered). Ask two questions of every check:

- **Shape or property?** "A test file exists for X" is shape. "Deleting X's null check
  makes a test fail" is property.
- **Redder or greener?** If the check's input silently degraded (a scan finding no
  files, a parser matching nothing), would it get redder or greener? Derived sets
  shrink invisibly, so assert the population is not empty and reconcile it against a
  second, independent declaration in both directions.

Platform defaults are exemptions you never wrote: a directory read without recursion,
a glob without dotfiles, a regular expression without its global flag, a one-level
flatten. Verify any check that claims "every X" by planting an X one level deeper.

## Exemptions must invalidate themselves

Every escape hatch (lint suppressions, dead-code ignores, test skips, baselines,
allowlists) gets pattern-matched and copied by later agents. Before adding one:

- It names a target that really is enforced elsewhere, and **fails once the exempted
  surface no longer needs it**, so a stale exemption breaks loudly.
- Its written reason says why compliance isn't possible and ties to evidence that
  expires (a file hash, a linked issue), not to a moment.
- Ask whether it is exempt because of something true about it or because of where it
  sits. Position-based exemptions are where coverage silently dies.
- When you fix a defect copied from an existing instance, fix the exemplar too:
  agents imitate the nearest code far more reliably than they read guidance.

## Prove a tolerance reaches what it exempts

A tolerance declared in two places is enforced in neither: the narrower one wins
silently. A suite-wide timeout raised from 120 to 300 seconds changes nothing while
three test files still pass their own 60-second timeouts, and every gate stays green
while the suites keep timing out at the old number. For any timeout, size cap,
threshold or retry count, ask whether something closer to the code can override it
and whether anything looks. When you check, parse rather than grep, and probe a
suspected shadow with a test only the wider tolerance can pass.

## Honest labels beat aspirational ones

When a configuration or comment claims enforcement nothing performs, correct the
claim before expanding the check: the defect is the false belief it plants in every
agent that reads it. Label an advisory check as advisory where it is defined and name
the command that runs it. Never leave a threshold of 0, a permanently red job or a
"CI runs this" comment CI doesn't honor: a gate that can't fail and one that always
fails carry equally little information.

## Runnable from a clean clone

A check that needs a second runtime, a global tool or a manual sign-in never gets wired
into a gate, and unwired checks go unmaintained. A gate runs straight after the
package manager's install, with nothing built: a check that imports a workspace
package's built output reads a stale or absent build, which fails toward greener.
Read source, or parse it.

## Every gate ships with its test

A gate's false negative is invisible: it prints success while enforcing nothing. A new
check gets a test that feeds it a violating fixture and asserts the failure, plus the
passing case and one no-op control: a harness that crashes before asserting makes
every probe "fail" for the wrong reason.

## The scripts

All six need only Node and git and print each finding with its file (and line where
applicable). Wire the three checks into the gate CI runs; they read what `git ls-files`
lists, so ignored directories stay out. The three report scripts (`report-test-changes.mjs`,
`report-test-counts.mjs` and `report-coverage-measures.mjs`) are for review and Health
`schema_version = "1.0"` trend measures (`--measures-out <file>`, optional `--target <id>`),
not gates.

**`scripts/check-test-quarantine.mjs`: no silent test suppression.** `.only` always
fails. An unconditional `.skip`, `.todo` or Playwright `.fixme` on `describe`, `it`,
`test`, `suite` or `bench` in a JavaScript or TypeScript test file needs an entry in the
register, `scripts/policy/test-quarantine.json` by default (`--register <path>` for
another). A missing register fails, so start one as `{"quarantined": []}`:

```json
{
  "quarantined": [
    {
      "file": "packages/core/src/parser.test.ts",
      "owner": "maintainer",
      "reason": "Waits on the upstream tokenizer fix; fails on every run until it ships",
      "issue": "#123"
    }
  ]
}
```

Reconciliation runs both ways: an entry whose file has no unconditional skip left fails
as recovered, so the spent entry is deleted. A skip that depends on the environment is
written as a condition instead and needs no entry, because it runs again whenever the
condition stops holding: `it.skipIf(...)`, `it.runIf(...)` and Playwright's
`test.skip(condition, reason)`; a condition that always holds (`true`, `!0`) counts as
none, and a condition covers only itself, so `it.runIf(key).only(...)` still fails. An entry covers its whole file, so a second skip added to a quarantined file needs
no new entry: review it as you would the first. Not seen, by design: aliases, element
access (`it['skip']`), option objects (`{ skip: true }`), a test's own context
(`t.skip()`), a variable title with its body passed by name (`test.skip(title, run)`)
and other languages' skips. The scan masks comments, strings and regular expressions
rather than parsing, so a backtick in JSX text can hide what follows it in that file.
Paths after the options limit the scan to those directories.

**`scripts/check-test-configs.mjs`: no runner may pass having run no tests.** It refuses
`passWithNoTests` in any Vitest or Vite configuration, in a root `vitest*` or `vite*` module
and in any module a configuration imports by a relative path (a shared factory every package
config calls), and the `--passWithNoTests` flag in any `package.json`, GitHub workflow or
Lefthook configuration. Only a bare `false` passes. Paths after the options add files to read
for both, such as a repository's own scripts that start runners; a path with no file in it
fails. Not seen: a module reached through a package name or a path alias rather than a
relative path, and an added path's own imports unless a configuration imports it. A package
with no tests yet adds its first test with its config instead.

**`scripts/check-test-discovery.mjs`: every test file is run by something.** The discovery
half of the zero-tests guard: it lists every tracked test file across JavaScript and
TypeScript (`TEST_FILE`), Python (`test_*.py`, `*_test.py`), C++ (`tests/` or `*_test.*`)
and Rust (`tests/**/*.rs` and `src/**/*.rs` with `#[test]`), resolves what every active
runner collects (Vitest/Vite, Playwright, Jest, `node --test` and active JS launcher
scripts, pytest, CMake/CTest and Cargo), and fails on any file no active runner claims.
When `.github/workflows/*.yml` or `lefthook.yml` exist, only runners reachable from a
workflow, hook or workspace test script count as active, so a package whose suite nothing
starts fails too. Reconciliation runs both ways: an active runner that matches zero test
files fails, an empty test-file or active-runner set fails, and every exemption in
`scripts/policy/test-discovery.json` (`--register <path>` for another) invalidates itself
when its files disappear or become claimed by a runner. Start a clean register as
`{"unrun": []}` (optional `"runners": [{"script", "include"}]` declares custom non-JS
driver scripts, which must exist, be invoked by a workflow or hook and match at least one
test file). Not seen, by design: dynamic runtime `include` expressions, Vitest `--project`
CLI subsets, pytest `-k`/`-m` marker filters and Rust `src/` dead-module detection (the
compiler checks `src/`). Paths after the options limit the scan to those directories.

**`scripts/report-test-changes.mjs`: what a branch did to its tests.** It compares each
changed test file at the merge base with the branch (`--base`, default `origin/main`;
`--head <ref>` for a commit, else the working tree with uncommitted edits) and lists:

- a test or scenario file deleted, and fewer tests or assertions in a file;
- a skip added, including a whole file's (`pytestmark`, `test.describe.skip`, `xdescribe`),
  a conditional skip made unconditional, and a new file born with an unconditional skip;
- an assertion line changed (an expected value, a matcher), and exact matchers traded for
  loose ones (`toEqual` for `toBeDefined`);
- a snapshot that lost lines, and a runner config (Vitest, Vite, Playwright, Jest, pytest,
  a tests `CMakeLists.txt`) or the quarantine/discovery policy register changed or added.

It quotes the lines involved. A rename is compared with its old self; in the working
tree, stage a move (`git mv`), or the untracked new file is unseen and the old one reads
as deleted. It counts JavaScript and TypeScript, Python, Rust, C++ (doctest, Catch2,
GoogleTest) and `*.scenario.yaml` steps lexically, file by file. A test moved between
files shows as one fewer in the old file; the totals, which include new test files, net
it out. Not seen: a test called through an alias (`const linux = it.skipIf(...)`), a
narrowed scenario `expect:` block, and anything a count and a changed line cannot show,
so read the test diffs as well. It exits 0 whatever it finds, because many deletions are
right; `--json` gives the same report to a program and `--measures-out <file>` writes a Health
1.0 measures file. Put the Markdown in the pull request
with a reason for each item: a reviewer treats an unexplained one as a blocker.

**`scripts/report-test-counts.mjs`: repository-wide test inventory.** Counts tracked test files,
tests, assertions, skips, unconditional skips, scenario files and steps across JS/TS, Python,
Rust, C++ and `*.scenario.yaml`, plus quarantined files and test-discovery exemptions. Pass
`--measures-out <file>` to emit Health 1.0 measures.

**`scripts/report-coverage-measures.mjs`: coverage measures from runner artifacts.** Reads
Istanbul `coverage-summary.json`, Istanbul/Vitest `coverage-final.json`, Python `coverage.py`
JSON and LCOV (`lcov.info`) via `--input [<unit>=]<path>` or `--scan`, failing on an empty
input set unless `--allow-empty` is passed, and writes weighted totals plus per-unit coverage
percentages with `--measures-out <file>`.

If a software factory or another agent loop may repair a failing branch, list the
scripts and the register among the paths a repair may not edit, or the repair can pass
by registering a skip.
