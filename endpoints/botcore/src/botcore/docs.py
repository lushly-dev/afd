"""Core command documentation for botcore.

Each key is a topic name: a host's info_docs command and the legacy server's
{name}-docs MCP tool show it.
Plugin-specific docs are registered via ``PluginRegistry.add_docs()``.
"""

from __future__ import annotations

CORE_DOCS: dict[str, str] = {
    "dev": """\
# Dev Commands

## dev_lint(package=None, fix=False)
Run linter (ruff for Python, biome for TypeScript).

## dev_test(package=None, coverage=False)
Run tests (pytest for Python, vitest for TypeScript).

## dev_build(package=None)
Build package.

## dev_check_size(paths=None)
Check file sizes against thresholds (warn: 500, error: 1000 lines).

## dev_check_coverage(paths=None)
Check test coverage against threshold.

## dev_check_deps()
Check dependency freshness.

## dev_dead_code()
Find unused code.

## dev_circular_imports()
Detect circular import chains.

## dev_unused_deps()
Find declared but unused dependencies.

## dev_dep_graph(format=None)
Visualize module dependency graph.

## dev_check_paths()
Detect hardcoded/non-portable paths.

## dev_skill_lint()
Run skill_lint over the configured skills directory.

## dev_snapshot(base=None, compare_to=None, exclude_ref_prefixes=None, path=None)
Read-only. Capture a checkout integrity snapshot (HEAD, refs excluding `refs/t3/`, stash,
porcelain status, working-tree diff, untracked file hashes, and `diff_stat` against `base`).
Pass `compare_to` (prior snapshot dict, JSON string, or 64-char digest) to verify nothing
changed during a delegated review and measure diff-size deltas across rounds.
""",
    "pr": """\
# PR Inspection Commands (read-only by default)

Settings live under `[pr]` in `botcore.toml` (`gating_bots`, `advisory_bots`, `status_bots`,
`state_dir`, `stale_state_seconds`, `default_interval`).

## pr_status(pr=None, repo=None)
Read-only. Inspect a PR's state, checks (collapsed to worst bucket), gating/advisory bots,
unresolved review threads, merge-queue status, base-branch file overlap, and readiness.
Uses GraphQL via `gh` and automatically falls back to REST when GraphQL rate limits expire.

## pr_drift(pr=None, repo=None, fetch=False, after_rebase_from=None, scan_overlapping_prs=10)
Read-only by default (`fetch=False`). Gather base commits since divergence, PR files deleted
or renamed on base, recent open/merged PRs touching overlapping files, original commit authors
and attribution trailers, and optional `git range-diff` summary (`after_rebase_from`).

## pr_wait(pr=None, repo=None, until="ready", interval=None, timeout_seconds=1800,
##   max_polls=None, persist_state=False)
Read-only by default (`persist_state=False`). Wait for PR events (`ready`, `green`, or
`any-change`), filtering noisy deploy/status bots and reporting base-branch file overlap.
Set `persist_state=True` to hold a cross-platform single-instance lock and save event
watermarks so restarts never miss events.
""",
    "cdp": """\
# CDP Browser Automation Commands

Requires `lushly-botcore[cdp]` (`playwright`, `httpx`, `perfetto`) and
`playwright install chromium`.
Exposed in `botcore.commands`, `botcore cdp <subcommand>`, and `CDP_POLICIES` for `build_host`.

## Session
`cdp_launch`, `cdp_attach`, `cdp_close`

## Navigation and input
`cdp_navigate`, `cdp_wait`, `cdp_click`, `cdp_hover`, `cdp_scroll`, `cdp_drag`,
`cdp_type`, `cdp_press`

## Inspection, forms and tabs
`cdp_inspect`, `cdp_query`, `cdp_snapshot`, `cdp_fill`, `cdp_fill_form`, `cdp_upload`,
`cdp_handle_dialog`, `cdp_list_pages`, `cdp_select_page`, `cdp_new_page`, `cdp_close_page`,
`cdp_resize`

## Diagnostics and traces
`cdp_screenshot`, `cdp_console`, `cdp_get_console_message`, `cdp_eval`, `cdp_list_network`,
`cdp_get_network`, `cdp_emulate`, `cdp_trace_capture`, `cdp_trace_summary`, `cdp_trace_query`
""",
    "skill": """\
# Skill Commands: registry, lint and usage

Ownership lives in the frontmatter's `metadata:` map (`metadata.source`,
`metadata.version`, `metadata.portable`). A skill without a source is locally owned;
a top-level `source:`, `version:` or `portable:` (older copies) is still read.

## skill_list(show_source=False, plugin_dirs=None)
List available and installed skills with version and source info.

## skill_seed(update=False, dry_run=False, plugin_dirs=None)
Copy skills from botcore/plugin sources into project's .claude/skills/.
Sets `metadata.source` for ownership tracking, moving any top-level ownership fields
under `metadata:`.
Skills installed under a retired name (e.g. `manage-documentation`, renamed to
`docs-manager` in 0.4.0) are migrated when botcore owns them; otherwise they are
left in place, listed in `renamed_locally_owned`, and the new name is not seeded.
Skills botcore retired (`RETIRED_SKILLS`) are removed when botcore owns them, no
`include` list is set and `skip` doesn't name them; other copies are kept and listed
in `retired_locally_owned`. Both lists are in the result as `retired` and
`retired_locally_owned`.
- `update`: Also update stale skills (default: only new)
- `dry_run`: Preview changes without writing

## skill_status(plugin_dirs=None)
Detect version drift between installed and available skills.
Reports: ok, stale, missing, unmanaged, conflict, renamed, retired.

## skill_lint(path=None, strict=False)
Lint skills in the configured skills directory. `botcore skill-lint [path]`
(`skill_lint_spec`) runs the same rules over any directory.
- Errors: SK001 no SKILL.md or frontmatter, SK002 no `name`, SK003 no `description`,
  SK004 name not kebab-case, over 64 characters or unlike its directory, SK005
  description over 1,024 characters, SK008 missing `references/` file, SK015
  duplicate name, SK020 invalid `agents/openai.yaml` (malformed YAML, missing `interface`,
  non-string keys, or empty text fields).
- Warnings: SK009 body over 500 lines, SK010 placeholder text (TODO, FIXME, TBD,
  Lorem ipsum), SK012 `skill.md` instead of `SKILL.md`, SK014 orphan reference file,
  SK016 description over 300 characters, SK017 `triggers` field or "Triggers:" list,
  SK018 field outside the open standard and Claude Code (top-level `source`, `version`
  or `portable` belongs under `metadata:`), SK019 listing over `[skills]
  listing_budget` (default 8000: description plus `when_to_use`, skipping
  `disable-model-invocation: true`), SK020 unknown keys or overlong/missing summary
  fields in `agents/openai.yaml`.
- Result: per-skill violations plus `listing: {characters, budget}`.
- `path`: Lint a specific skill path (default: all in skills dir)
- `strict`: Report every warning as an error

## skill_adopt(name, source="local")
Claim an unmanaged skill by setting `metadata.source`. A skill already owned by
`source` with top-level ownership fields has them moved under `metadata:`.

## skill_unadopt(name)
Remove `metadata.source` (or a top-level `source:`) from a skill.

## skill_index(write=True)
Generate `_index.md` table of all installed skills.
- `write`: Write file (default: True). False for preview.

## skill_usage_collect(since_days=None, t3_store=None, machine=None, rebuild=False)
Add the skill loads recorded since the last collection to this machine's skill usage record.
Nothing is added to a skill and no agent reports anything: the loads are read, read-only,
from T3 Code's store (one snapshot, its Claude and Codex threads alike) and, for sessions T3
Code did not run, from Claude Code's transcripts (`~/.claude/projects`, or
`BOTCORE_SKILL_USAGE_CLAUDE_DIR`; empty turns it off). A tool call T3 Code ran is left to its
store, so a load both show is one load; only a transcript that changed is read again. A load
leaves the record only when its call is read again and is no longer one; what Claude Code
has cleared keeps what was collected of it. A session outside any repository is filed as
`unknown`. `sources` says what each source did (for the transcripts: how many were
`read`, `unchanged` or `not_read` because a file could not be opened, and `removed`); a
machine with neither source succeeds with nothing read.
- A load is: the Skill tool; a file tool that reads `…/skills/<name>/SKILL.md`; a shell command
  that shows the agent that file (`cat`, `sed`, `head`, `tail`, `nl`, `less`, `more`, `bat`,
  `awk`, `type`, `Get-Content`, `git show <revision>:<path>`); or a message the person wrote
  that opens by naming a skill (`$name` in T3 Code, a `/name` command in Claude Code). Only
  completed calls count. A search, diff, listing or edit that names the file is not a load,
  nor a read sent to a file, a count or a search.
- It also records each session, whether or not it loaded a skill, with the session it came
  from (the one that delegated it, or the one it was forked from) and the pull requests T3
  Code linked to it or its subagents: when, and whether it opened each or attached itself to
  one that existed; and each change a session made to a skill's files (`loads_added` and
  `edits_added` count the two kinds of event). No title and no branch name is kept.
- The record (`events.jsonl` and `sessions.json` in botcore's state folder) holds the skill,
  time, harness, model, project (`owner/name` from the checkout's origin), session and agent.
  It never holds a prompt, a command, arguments, a title or file contents.
- Of T3 Code's store it continues from the last collection and reads everything again once
  a week; of the transcripts it opens those that changed. The hourly job `disk-setup`
  installs runs it, so it is run by hand only for a first collection.
- Several machines: each names itself and one shared folder in its machine settings
  (`disk.toml`: `skill_usage_machine = "<name>"`, its hostname when left out, and
  `skill_usage_shared = "<folder every machine can see>"`; `BOTCORE_SKILL_USAGE_MACHINE` and
  `BOTCORE_SKILL_USAGE_SHARED` override them). `skill_usage_dirs` (full paths without `..`)
  adds external skill folders alongside personal skill folders (`~/.claude/skills`,
  `~/.agents/skills`, `~/.codex/skills`); `BOTCORE_SKILL_USAGE_USER_DIRS` overrides both the
  personal folders and `skill_usage_dirs`, and `""` turns all of them off. Collection also
  records locally where any loaded `SKILL.md` outside a project's configured skill folders
  lives so its size and listing characters are measured and shared (never its path); use
  `--rebuild` to backfill file locations from already-collected historical logs. Collection
  then also writes this machine's
  record to `<shared>/<machine>/`, and the reports read every machine's. `shared` in the
  result says whether the folder `exists` and was `written`; a folder that is not there, or
  a machine's folder that holds another record of the same name (`error`), does not undo the
  collection, and botcore never creates or syncs the shared folder. What is shared is what
  was read, with this module's fields only: session ids, project names and pull request
  numbers, and for each project its renamed skills and the skills it holds (their names,
  sizes and listing characters, and the commit they were read from with its time); never a
  folder of the machine or a line it could not read. Keep it private. A name is lower case
  and fit for a folder on any system; the shared folder is a full path. The hourly job must
  be able to read it: on macOS, a
  folder in a cloud drive that fetches files on demand needs the owner's consent for the
  job's program, once, at the screen (`disk-status` says so while the job waits, and that
  the record itself was collected); a folder the drive keeps local copies of needs none.
- `since_days`: re-read that many days of T3 Code's store instead
- `t3_store`, `machine`: read a store copied from another machine, named by `machine`
- `rebuild`: read everything and replace what an older botcore recognised, or the name a
  machine had before it was renamed
- Errors: `SOURCE_SCHEMA_CHANGED` (this botcore cannot read this T3 Code release's store;
  nothing collected before is lost), `SOURCE_UNREADABLE`, `SOURCE_NOT_FOUND`,
  `RECORD_UNAVAILABLE`, `COLLECT_RUNNING`, `MACHINE_SETTINGS_INVALID`, `INVALID_INPUT` (also a
  machine's name that cannot name a folder). A machine with no T3 Code store succeeds with
  `status: absent`.

## skill_usage_report(days=30, project=None, harness=None, ending_days_ago=0, skill=None,
##   agent=None, limit=50)
Read-only. Skill use over `days` days from this machine's record and, where its settings name
a shared folder, every other machine's, each session once; run `skill_usage_collect` first
(`NOT_COLLECTED` otherwise). `record.collected` says when each machine last collected.
- Per skill: `sessions` that used it, `of_sessions` the project had and the `share`; `loads`;
  `typed_sessions` (the person asked for it); `harnesses`, `models`, `machines` (sessions by
  each); `agents` and `paths` (loads by `main`, `delegate` or `subagent`, and by `skill_tool`,
  `file_read`, `shell_read` or `typed`); `last_used`; `also_loaded_as` (earlier names);
  `size_bytes`, `max_context_bytes` (size times loads: a ceiling, since a skill read in parts
  counts whole) and `listing_chars` (what it adds to every session's skill listing).
- A session is a thread a person started or a task delegated to its own agent; a subagent's
  load counts under the session it works for. A skill read three times in one session is one
  use. A typed request is a load unless a tool then loads the skill within ten minutes.
- Not counted as use: a session that changed the skill's files (`authoring_sessions`), and an
  audit, which is one session loading two thirds or more of the skills the project holds (and
  at least 12 of them) within 30 minutes (`totals.audit_sessions`). Only skills the project
  holds count toward that; a project that holds fewer than 12, or that no machine has a
  folder of, never has an audit, and an audit that takes longer than about 45 minutes is not
  seen as one.
- `quiet`: skills a project holds (`.claude/skills`, `.agents/skills`, `.codex/skills`, plus
  any `[skills].extra_dirs` or custom `source_dir` declared in `botcore.toml` /
  `pyproject.toml`, with `[skills.aliases]` folded into their target names) that nothing used
  in the window; when no `project` filter is given, unused skills in personal/configured
  external skill folders also appear under `project: "external"`. Loaded skills kept outside
  a project's configured skill folders (plugins, unconfigured folders) get `size_bytes`,
  `max_context_bytes` and `listing_chars` from the recorded file location.
- What a project holds, with sizes and names, is what the tip of its default branch has, as
  a collection read it from git on a machine that has the project, and never the files as a
  folder lies: the report reads no checkout, and says the same on every machine once each
  runs this botcore and their records have synced. Of several machines' accounts the one
  read from the newest commit is used, by the commit's time. A skill on a branch not yet
  merged, or kept out of git, is counted with no size and is not in `quiet`. A folder that
  is no repository is read as it lies, files not in git and all. So is a repository git
  could not read and that has no commit on record: one git refuses for good (another
  account owns it), or a first collection that timed out, until git answers. A commit on
  record is kept through a failed read.
- `project`: `owner/name` or the name alone. `harness`: `claude` or `codex`. `agent`: `main`,
  `delegate` or `subagent`. `skill`: one skill. `ending_days_ago`: move the window back, to
  compare two periods. `limit`: skills listed, most used first; `more` counts the rest.
- A project, harness or skill the record has never seen is `INVALID_INPUT` with the known
  values, not an empty report. `warnings` says when a machine's record is over a day old,
  when lines of one could not be read, when a folder in the shared one is not a whole copy
  of a machine's record and was not read (a sync part way through, or not a machine's), when
  the shared folder was not there, when an older botcore recognised events, and when no
  machine's record says what a project holds (one an earlier botcore wrote). Also
  `RECORD_UNAVAILABLE`, `MACHINE_SETTINGS_INVALID`.

## skill_usage_triggers(days=30, repo=None)
Read-only. For each skill a repository requires, the changes merged to its default branch in
the last `days` days that touched the skill's paths, and whether the session that opened each
one's pull request had loaded the skill by then. A repository declares them in its botcore
configuration: `[[skills.required]]` with `skill = "<name>"` and `paths = ["<glob>", ...]`
(repository-relative, as git writes them, matched by case; `*` stays in one folder, `**` spans
folders); several tables for one skill are one rule. Nothing is collected for it: a rule
declared today judges the record as it stands.
- It uses three things: which merged changes touched those paths (git); which session opened
  each change's pull request and when (the harness says which, and the record keeps it); and
  when that session loaded the skill, itself or through a subagent (the record). A session
  that attached itself to a pull request to repair, review or merge it is not judged, and
  neither a session's turns nor its branch tie it to a change.
- A fleet's merge lane opens its cells' pull requests itself. The commit it folds a cell's
  branch into names each thread that worked on the cell, `Factory-session: sha256:<24 hex>`
  (the first 24 hex digits of the thread id's SHA-256), and reaches the default branch as
  written where the merge queue rebases; a queue that writes its own squash message drops it,
  and the change stays unknown. A change with such trailers and no session linked as its
  opener is judged by the sessions they name, as of the commit's author time (when the lane
  squash-merges itself, the landed commit's, a later moment). Trailers that name no session
  on record make it `no_session`, and while any one of them is unheld it is never a miss
  (`incomplete_record`), though a load by another stands. Such a miss also has
  `commit` (12 hex digits), and its `change` is null when the subject names no pull request.
- Per rule: `changes`; `loaded` (the session that opened the pull request had loaded the
  skill by then), of which `loaded_by_subagent` only through a subagent, which may be a
  reviewer; `missed` (that session never loaded the skill before the change merged), with
  `misses` naming each change's pull request and that session; `rate` (loaded out of loaded
  and missed); and `unknown`, with `unknown_why`: `no_pull_request` (the change names none,
  or names one another change on the branch names too), `no_session` (none on a collected
  machine is linked to it), `opened_elsewhere` (no session linked to it is known to have
  opened it: a script, a person or a machine not collected did, or its link does not say),
  `no_link_time` (the record does not place the opening before the merge), `after_opening`
  (the skill was loaded only after the pull request was opened: at review, or for a later
  push), `possibly_loaded` (the opener never loaded it, but a task it delegated or a session
  it was forked from did, or the record holds an event of a kind this botcore does not know)
  and `incomplete_record` (nothing on record says the opener loaded it, but the record does
  not reach the merge on every machine: one last collected before it, a copy in the shared
  folder is not whole, or the shared folder was not there; collect, or wait for the sync). A
  load up to five minutes after the merge is no ground for a miss: two clocks. A miss says
  the opener never loaded the skill: an opener that only published another session's work is
  judged all the same.
- `merged`: the branch that was read and its newest change; fetch the checkout when that is
  old. `warnings` says when links in the record do not say who opened them (collect again)
  and when an older botcore recognised its events (rebuild).
- `repo`: the repository's checkout; the one holding the working directory when left out.
- It reads every machine's record, as the usage report does, so a change opened on another
  machine is judged here. A machine's copy that is not whole is not read, and is named in
  `warnings`; while one is, no change is `missed`. Every machine with a record is waited for,
  however long silent, and `warnings` names those a change waits for; a machine the owner
  knows is switched off is named in `skill_usage_away` in this machine's settings
  (`BOTCORE_SKILL_USAGE_AWAY`, comma-separated, overrides it) and is then not waited for.
  This machine always is.
- Errors: `NO_REQUIRED_SKILLS`, `NOT_COLLECTED`, `NO_WORKSPACE`, `CONFIG_INVALID`,
  `GIT_FAILED` (also when the checkout does not say which branch is the default),
  `RECORD_DAMAGED` (a line of a machine's record cannot be read: rebuild on that machine, or
  wait for its copy to finish syncing), `RECORD_UNAVAILABLE`, `MACHINE_SETTINGS_INVALID`,
  `INVALID_INPUT`.

## skill_usage_effect(days=30, repo=None)
Read-only. Whether a loaded skill prevents the mistakes it names. A repository names each
checkable mistake in its botcore configuration, `[[skills.traps]]`: `id`, `skill`, `paths`
(globs as `[[skills.required]]` writes them), and `added_pattern` (a Python regular
expression over the lines a change adds to files matching `paths`), `commit_pattern` (one over
its commit message, matched with no flags: write `(?m)` for `^` to start each line) or both;
a change makes the mistake when either matches. `unless_paths` exempts a change that also
touches one of its globs: it did the thing the right way, such as a skipped test registered
in a quarantine file. Nothing in the repository is run; the patterns come from the checkout's
own configuration and run on its history, so keep them linear (a line over 10,000 characters
is not checked, and `warnings` counts them).
- Each merged change to a trap's paths is judged as `skill_usage_triggers` judges it:
  `loaded`, `missed` or unknown with the same reasons, fleet cells included. Per trap:
  `changes`, `exempt`, `loaded` and `missed` (`changes`, `hits`, `rate`), `unknown`
  (`changes`, `hits`) with `unknown_why`, `delta` (the missed arm's rate less the loaded
  arm's, once each arm has twenty judged changes; null before, with a warning) and `examples`
  (up to 20 changes that made the mistake, newest first: `change`, `commit`, `arm`,
  `sessions`). No matched line is reported. `warnings` also says when a trap's skill is one
  the project neither holds nor any session loaded, when neither arm made the mistake, when
  more changes cannot be judged than can, and when the checkout is shallow (its oldest
  commit reads as adding everything).
- A change's added lines are read against its first parent, with renames found whatever
  git's settings say: a file moved into a trap's paths adds only what the move changed. On a
  history of merge commits, the message read is the merge's, not those of the commits it
  merged.
- It sees only what reached the default branch: a mistake that review or a check caught
  before the merge is never counted, so the rates are of mistakes that escaped.
- Errors: `NO_TRAPS`, `NOT_COLLECTED`, `NO_WORKSPACE`, `CONFIG_INVALID` (also a pattern that
  is not a regular expression, a trap that checks nothing, or an `id` given twice),
  `GIT_FAILED`, `RECORD_DAMAGED`, `RECORD_UNAVAILABLE`, `MACHINE_SETTINGS_INVALID`,
  `INVALID_INPUT`.
""",
    "gate-outcome": """\
# Gate Outcome Commands

What each workflow's runs, and each check, observed and what they cost, read from GitHub into
a record every machine shares, and the fix commits on the default branch with the escapes they
close. Both commands work on the repository of the checkout they are called from (`owner/name`
from its `origin`); two repositories' records are never mixed. Design:
`docs/features/active/test-effectiveness/` in lushly-dev/afd.

## gate_outcome_collect(since_days=7, sources=["ci"], requests=1000, rebuild=False)
Reads, through `gh api`, the Actions runs created in the last `since_days` whole UTC days
(today included), then the earlier attempts of each run that has more than one, then the jobs
and steps of each attempt: those that did not pass first, then the others, newest first. An
attempt that ended `action_required` or `skipped` ran no step, and its jobs are not asked for.
Where a hook group step failed (a step whose command comes down, through the root
`package.json` scripts, to `lefthook run <group>`), that job's log is read once, with its jobs,
for Lefthook's closing summary; last of all, the logs of jobs whose group step passed, newest
first, as the limit permits. Each log read is one counted request.
- The run lists are read with no event filter, so every event is kept. GitHub gives at most
  1,000 runs for one query, so a span whose count is over that is split in two until each part
  fits.
- It goes on from what every machine's record holds (this machine's, and each copy in the
  shared folder): a span listed within the last hour, or listed two days or more after it ended
  with every run in it finished, is not listed again, and an attempt or its steps on record are
  not asked for again. So collecting the same window again adds nothing, here or on another
  machine. A run rerun more than two days after its day ended is seen by a rebuild only.
- It stops at `requests` (counting every `gh api` call, the allowance checks too) or when the
  account's core allowance (`gh api rate_limit`, checked before the first request and every
  100) is at half or less, whichever comes first. The source is then `partly`, and the next
  collection goes on from there.
- `since_days`: 1 to 365. `sources`: `ci` and `main` (default `ci`); the plan's `reviews` and
  `runs` are refused (`VALIDATION_ERROR`) until a botcore collects them. With both, `main` is
  read first. `requests`: 1 to 5000. `rebuild`: ask
  GitHub again for everything in the window; what GitHub no longer has (a deleted run) keeps
  what was read before and is marked `unreadable`. A rebuild cut short goes on at the next
  collection, over the window it was asked for.
- The `main` source. The default branch is fetched (`git fetch origin <branch>`) and its tip
  read through git, never the working tree; a fetch that fails reads the ref as it was last
  fetched and says so (`partly`). Every commit but merges that landed in the window (by its
  committer time; a commit a merge brought in goes by its own) is counted for its UTC day; of
  those, every fix commit (subject `fix:` or `fix(<scope>):`, either with `!`) and every revert
  (subject beginning `Revert "`) is read once into a `commit` line. Its area: the unit whose
  manifest's folder holds each file, the deepest one, where the units are the repository's list
  read at the tip: every unit `architecture.json` lists and every manifest (`package.json`,
  `pyproject.toml`, `Cargo.toml`, a `CMakeLists.txt` that declares a project `VERSION`) under
  its `discoveryRoots`, outside `exclude`, `quarantine` and build folders (`node_modules`,
  `dist`, `build`, `target` and the like); without that file, the nearest folder below the top
  that holds a manifest. Changelogs (`CHANGELOG`, `CHANGELOG.md`/`.txt`/`.rst`), changeset
  fragments (`.changeset/*.md`), provenance records (any file under a `provenance/` folder),
  status and other prose files (`.md`, `.mdx`, `.txt` except `CMakeLists.txt`, `.rst`) and
  lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `*.lock`) are records, not source or test
  code. A commit's units and the lines whose last edit is read come from its non-record files,
  with those holding most files first; a commit whose files are all records is counted by where
  those records sit and marked `records_only`. A commit whose files no unit holds is
  `repository`. A test path: a `tests`, `test` or
  `__tests__` folder on it; `.test.`, `.spec.` or `.scenario.` in its name; a Python or C-style
  test file (`test_<name>` or `<name>_test` with `.py`, `.c`, `.cc`, `.cpp` or `.cxx`, or
  `<name>_test.h`/`.hpp`); or a Rust file whose changed lines, on either side of the change, sit
  inside a test module: a `mod <name> { ... }` marked `#[cfg(test)]` (or `cfg(all(test, ...))`,
  `cfg(any(test, ...))`), its end found by matching braces with comments, strings and character
  literals skipped (`mod tests;` in another file is not seen). The issues its message closes:
  GitHub's closing words (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`,
  `resolves`, `resolved`, an optional colon) before `#N`, `<owner>/<name>#N` or the issue's
  address, this repository's only. Its `Found-by:` lines (`Found-by: <channel> <class>
  [#issue]`, channel one of `review`, `check`, `daily`, `use`, `sweep`, `unknown`, class one of
  `logic`, `contract`, `parity`, `claim`, `security`, `concurrency`, `interface`, `other`):
  read, not required; a commit without one is `absent`, and one off the lists is counted as
  unread. The age of its last edit: the lines it removes are blamed at its parent and the newest
  committer time kept (`no-lines` when it only adds, `too-many-files` when it replaces lines in
  more than 20 non-record files, `no-parent`, `unreadable`). Then GitHub, through its GraphQL
  API, up to 40 numbers to a request, each request counted against `requests` and held to the
  account's GraphQL allowance as `ci` is to its core one: the issues the pull request its subject
  ends with (`(#N)`) closes, or, for a subject with no number, the pull request GitHub says the
  commit merged; and the state and labels of every issue it closes. Without GitHub the commits
  are read and the source is `partly`, its `why` beginning `gh`; a later collection with GitHub
  reads only GitHub for them. An answer without the repository, or without a commit's pull
  request or commit, leaves those commits unread, never read as closing nothing. An issue's
  state and labels are read once, with its commit; a label added later is seen by a rebuild. A
  commit git cannot read leaves its day unlisted.
- Result: `machine`, `repository`, `state_dir`, `window` (`since_days`, `first_day`,
  `last_day`), `sources` (for `main`: `status` `read`, `partly` or `absent`, `found` (fix
  commits and reverts in the window), `added` (lines written) and `why`; for `ci`:
  `source: ci`, `status` `read` or `partly`, `found` (runs in
  the window), `added` (lines written), `still_going` (runs not finished when listed), and when
  `partly`, `why` (begins `requests`, `allowance` or `github`) and `reached`: `step` (`lists`,
  `attempts`, `jobs` or `logs`), `window_listed` (share of the window listed), `runs`,
  `attempts_left`, `steps_left`, `failed_summaries_left`, `passed_summaries_left`; a share reads
  1.0 only when whole), `requests_used`, `allowance` (`remaining`, `limit`, as last seen),
  `allowance_graphql` (the GraphQL allowance as last seen), `folded` when the fold did or held
  back anything (below: `folded` (the days folded, as `{first, last}` runs of days),
  `lines_before`, `lines_after`, `bytes_before`, `bytes_after`, `error` when the folded record
  could not be written, and `not_folded`, each `why` with its `days` and a `suggestion`) and,
  with a shared folder, `shared` (`path`, `written`, `error`) and `warnings` (the checks known
  could not be read, so no summary was). `read` means the window is all listed, every finished
  attempt that ran has its steps, or is on record as one GitHub no longer gives, every failed
  group step's summary was asked for, and the collection did not stop at a limit; a run still
  going does not keep it from `read`. A collection that stops at a limit while reading passed
  group steps' logs is `partly`, though the report's `coverage.sources.ci`, which rests on runs
  and steps only, is `read`. With `main` also asked for, a `ci` that GitHub could not be asked
  for at all is `absent` with why (`added: 0`) instead of a refusal.
- The record (`record.jsonl` in `<state>/<owner>/<name>/`, where `<state>` is botcore's state
  folder's `gate-outcome`, or `BOTCORE_GATE_OUTCOME_STATE`) is appended to, and only the fold
  rewrites it; each line has an `id`, `kind`, the rules' version `v` and when it was written
  `at`, and a newer line for an id wins. `run` lines (`run:<run id>:<attempt>`): `workflow` (its
  file), `name`, `event`, `status`, `conclusion`, `head` (the revision tested), `base` (its
  base, from the pull request or the queue group), `pr`, `created`, `started`, `updated`.
  `shape` lines (`shape:<digest>`): a workflow's job and step names, once for each version of
  them. `steps` lines (`steps:<run id>:<attempt>`): the `shape`, the `seconds` of each job and
  step, their `conclusions` for an attempt that did not pass or where any job or step did not
  succeed (one skipped included), and `groups` (each job with a group step: its place and
  GitHub's job id). `group` lines (`group:<run id>:<attempt>`): for each group step whose log
  was read, `[job, step, how the read ended (read, no-summary, mismatch, log-gone, unreadable),
  commands not kept, [[command, passed or failed, seconds], ...]]`; a command is kept only when
  its group has it at the default branch's tip. `commit` lines (`commit:<revision>`, made by the
  main source's rules, `v` 2): `sha`, `landed`, `type` (`fix` or `revert`), `pr`, `files` (how
  many), `units`, `records_only`, `test_paths` (at most 100) and `tests` (how many), `closes`
  (by its message), `found_by` (`[channel, class, issue or null]`), `found_by_unread`,
  `last_edit` and `last_edit_status`, and, once GitHub is read, `pr_closes` and `issues`
  (`[number, open or closed, [label, ...]]`; both null until then). Nothing else: no line of a
  log, no output, title, branch name, actor, file contents, commit subject, message or diff
  text. Lines carry the rules' version; a steps line made by older rules is read again.
  `state.json` beside it holds the spans listed, the commits that landed each day (`main.days`)
  and how the last collection ended.
- The fold. At the end of each collection, under its lock, every whole UTC day more than 180
  days before today that is wholly collected (every moment of it listed, every earlier attempt
  on record, every attempt that ran with its steps or on record as one GitHub no longer gives)
  has its runs, with their attempts' steps and summaries, put in `folded-workflow` lines (one
  for each workflow and event: `name`, `counts` of each end, `later` (passes after a failed,
  cancelled or unknown attempt), `wall` seconds, the queue's `heads` and `failed_heads`, runs
  still `going`, `left_out` (an event the report gives no rows), `ran`, `with_steps`,
  `unreadable_steps`, and `checks`: `ran`, `read`, `jobs_seen`, `jobs_skipped`, `summaries`) and
  `folded-check` lines (one for each check and event: `check`, `job`, `step`, `command`,
  `counts`, `unknown`, `seconds`, `timed`, `later`, and `examples`, the attempts it failed in as
  `[run, attempt, latest, created]`). Ids name the day (`folded-workflow:<day>:<digest>`). The
  new file is written beside the old one and put in its place in one move, so a fold cut short
  leaves the old record whole; lines it cannot read, lines of other kinds, every shape and every
  line of a day it does not fold stay byte for byte. Checks keep the names the checks known gave
  them when the day was folded. A folded day is never asked of GitHub again, by a rebuild
  either, so what GitHub no longer has stays as folded. Nothing is folded while every machine's
  record was not read (the shared folder away, a copy part way through a sync, a line of another
  machine's that could not be read), while the checks known cannot be read, or for a day a line
  of which could not be made; `not_folded` says which days and why. A machine's runs of a day
  another machine folded are left out of every read and, at its next collection, replaced in its
  record by that machine's folded lines.
- Several machines: a machine that names a shared folder (`skill_usage_shared`, as skill usage
  does; `BOTCORE_SKILL_USAGE_SHARED` overrides it) also writes its record to
  `<shared>/<machine>/gate-outcome/<owner>/<name>/`, and both commands read every machine's.
  A copy whose state does not name its record's digest is not read (a sync part way through).
- The hourly job (`disk_run`, see `botcore docs disk`) collects for each checkout the machine
  settings name in `gate_outcome_checkouts`, and for none by default: GitHub's allowance is the
  account's, so the owner chooses which machine reads it. For each, it fetches origin's default
  branch into `refs/botcore/gate-outcome/default` (no branch, remote-tracking branch, tag,
  index, working tree or `FETCH_HEAD` changes) and collects the last seven days with every
  source this botcore collects, at the default `requests`. The checks known are read from that
  ref when it holds the checkout's own landing branch and is newer. A fetch that fails is
  reported, and what the checkout has is read: its landing branch, or an earlier fetch of the
  job's ref where that is newer.
- Errors: `VALIDATION_ERROR` (a value outside its list or range; the suggestion gives it),
  `NO_WORKSPACE` (not in a checkout whose origin names a GitHub repository),
  `SERVICE_UNAVAILABLE` (`gh` missing or not signed in, or GitHub not answering, before anything
  was read, with only `ci` asked for; retryable), `SOURCE_UNREADABLE` (GitHub will not give the
  runs, or, with only `main` asked for, the checkout has no default branch), `CONFLICT`
  (another collection is running on this machine), `RECORD_UNAVAILABLE`,
  `MACHINE_SETTINGS_INVALID`. GitHub failing after some was read gives `partly` instead.

## gate_outcome_report(days=7, ending_days_ago=0, by="workflow", where=None, workflow=None,
##   check=None, area=None, finding_class=None, decision=None, pull_request=None, due=None,
##   sort="minutes", limit=25)
Read-only. For the window of `days` whole UTC days whose last is `ending_days_ago` days before
today (today 25 Nov, `days: 7, ending_days_ago: 2` is 17 to 23 Nov), one row for each workflow,
or each check, and event, a run counted once as its latest attempt, by its creation time.
- `by`: `workflow`, `check` or `area`; the plan's `class` and `decision` are refused
  (`VALIDATION_ERROR`) until a botcore reports them. `where`: one of `pull_request`,
  `merge_group`, `schedule`, `push`, `workflow_dispatch` (`local` is refused until it is
  collected); left out, all five. `workflow`: a workflow by its name or its file. `check`: a
  check by its id. `sort`: `minutes` (wall time by workflow, step time by check; the default),
  `failed` or `runs`, largest first. `limit`: 1 to 75, for each list; `more` says how many each
  left out.
- Filters go with groupings: `where` and `workflow` with `workflow`; `where`, `workflow` and
  `check` with `check`; `area` with `area`; `finding_class`, `area`, `check`,
  `decision` and `pull_request` with `class`; `check`, `area` and `due` with `decision`. One that
  does not go with `by` is `INVALID_INPUT`, with those that do.
- A row: `workflow` (its name), `file`, `where`, `runs` (finished runs), `passed`, `failed`
  (GitHub's `failure`, `timed_out` and `startup_failure`), `cancelled`, `action_required`,
  `skipped` and, when any, `other` (any other conclusion), each counted apart;
  `passed_on_later_attempt` (passed on attempt 2 or later after an earlier one failed or was
  cancelled, or one not read yet), split in `passed_after` (`failed`, `cancelled`,
  `unknown`); `wall_hours` (creation to last update, at most six hours a
  run, so queue time is in and it is not billed minutes); for `merge_group`, `groups` (head
  revisions) and `groups_failed` (those with a failed run); `rates`: `given` with
  `failed_per_100_completed` (failed per 100 runs that passed or failed) on 20 such runs or
  more, else `too-few`.
- `totals`: the same over every row in scope, shown or not, and, where the queue is in scope,
  its `groups` and `groups_failed`; `null` when nothing of the window was collected. By check,
  `totals` are the runs' (every run, whether its steps are on record or not).
- Verdict workflows: a workflow that judges the others fails whenever another did, so a
  repository names its verdicts in botcore.toml (`[gate_outcome] verdict_workflows = ["ci-ok.yml"]`,
  by file or name, read from the top of the checkout). A named one keeps its row, marked
  `verdict: true`; `totals` and the queue's `groups_failed` leave it out and name it in
  `totals.verdicts_left_out`. With none named, it is counted like any other. A setting this
  botcore cannot read, or a name the record does not hold, is in `warnings`.
- By check. A check is `<workflow file> / <job as GitHub names it> / <step>`, and ` / <command>`
  inside a step that runs a hook group (the step itself is then not a check: its commands are).
  The checks known are read through git from the default branch's tip (origin's HEAD, else
  origin/main or main, or the hourly job's own fetch of it when that is newer), never from
  the working tree: every workflow's jobs and steps, a job
  that calls a workflow named `<caller> / <called job>`, a matrix leg as GitHub names it (where
  an expression decides the matrix, the legs the record has seen, else the name as written),
  and a group's commands from `lefthook.yml`. A row: `check`, `workflow` (the file), `job`,
  `step`, `command` (in a group), `where`, `runs` (passed, failed and cancelled), `passed`,
  `failed`, `cancelled`, `not-run` (GitHub skipped it or it never started: not a run; a check
  seen only as not run has a row with `runs: 0`), `other` (when any: another step conclusion),
  `result_unknown` (a command whose failed group step's summary could not be read: never
  guessed), `passed_on_later_attempt` and `passed_after`, `minutes` (step time; a command's
  only from a summary that was read), `timed` (runs whose time is known), `quiet` (it passed
  and never failed), `local: absent` (local runs are not collected yet), `known` (at the tip)
  and `rates` as above. A check's rows come only from runs whose steps are on record
  (`coverage.steps_share`). `not_observed`: each known check with no row, with `why` (ci
  absent, no run of its workflow, its job skipped or not run, its steps not read yet, a name
  the file cannot evaluate), never a
  row of zeros. With `check`, `examples` are the attempts it failed in, newest first, an
  earlier attempt of a run included (`latest` says whether it was the run's last). A check
  that is not known or on record is `INVALID_INPUT` with the closest ids and how many are known.
- By area (from the `main` source; a commit is in the window by when it landed). One row for
  each unit (or `repository`) with fix commits, most first, then by name; a commit that touches
  more than one unit counts in each of them: `area` (a unit's folder or `repository`),
  `fix_commits`, `also_other_units` (those that also touch another unit), `records_only` (those
  that change records only), `reverts` (counted apart; they close no escape),
  `escapes` (closed issues with a bug label, one named `bug` or `security` or ending `:bug` or
  `:security`, that its fix commits close, each counted once), `unconfirmed` (fix commits that
  close no issue, whatever its state now: a bug, a planned change or the answer to a check that
  worked),
  `with_test_path`, `last_edit` (`read`, `of` and `median_days`: the median time from the
  newest replaced non-record line landing to the fix landing, over the commits it could be read
  for; not the age of the bug), `rates` (`too-few` under 20 fix commits, else
  `given` with `with_test_path_per_100` and `unconfirmed_per_100`). A `sort` other than the
  default does not go with it (`INVALID_INPUT`). Where GitHub was not read
  for a commit, its row's `escapes` and `unconfirmed` are null and `github_unread` says how
  many: no count is given for what was not read. `totals`: `merged` (every commit but merges
  that landed in the window; null unless every day of it was listed), the same counts with each
  commit and escape counted once (`multi_unit` and `records_only` included), `escapes_found_by`
  (by channel, and `absent` where the commit has no line naming the
  issue or none naming no issue), `escapes_by_class`, `found_by_absent` and
  `found_by_unreadable` (fix commits), `github_unread`. With `area`, `examples` are its commits,
  newest first: `commit`, `landed`, `type`, `pull_request`, `closes` (every issue it closes, null
  without GitHub), `escapes` (`issue`, `found_by`, `class`), `found_by` (the channel its lines
  name, `several`, `unreadable` or `absent`), `found_by_lines`, `test_paths` (how many),
  `last_edit` and `last_edit_days`, `records_only`, and `units` when a commit touches more than
  one unit. An area that is not known is `INVALID_INPUT` with the closest names and
  how many are known. `coverage` gives `sources.main` (`read` when every day of the window was
  listed and every commit has GitHub's answer, `absent` when nothing was, else `partly`),
  `collected.main`, `days_listed`, `github_read`, `last_edit_read`, `found_by_share`, `units`
  (`source`: `architecture.json`, `manifests` or `none`, and `count`) and `not_seen` (fixes
  inside a commit of another type). Warnings: main absent, days not listed, commits without
  GitHub's answer.
- `window` (`days`, `ending_days_ago`, `first_day`, `last_day`, `since`, `until`); `coverage`:
  `sources.ci` (`read` when every moment of the window was listed and every run that ran has
  its steps, `absent` when nothing of it was, else `partly`), `collected.ci` (`newest`
  collection and its `age_hours`), `events`, `other_events_left_out` (runs of other events, by
  event), `window_listed` (the share of the window any machine listed; the time since a
  collection within the hour that listed up to the moment it began counts as listed),
  `listed_until` (where the newest listing ends), `steps_share` (the share
  of runs that ran whose steps are on record), `steps_unreadable` (runs whose jobs GitHub no
  longer gives), `folded` (the window's folded days, as `{first, last}` runs of days, whose
  figures come from the fold's lines and are the figures their runs gave) and `not_seen`;
  by check also `commands_share` (the share of group steps that
  ran whose summary was read), `summaries_unreadable` (by why) and `known` (`ref`, `commit`,
  `checks`, `problems`, and `error` when they could not be read); `sources` gives `ci`, `main`
  (as by area) and the plan's `reviews` and `runs`, `absent` until collected; `machines` (each
  machine's `collected_at`, `ci` and `main` status, `why` and `main_why`); `warnings` (ci
  absent, with the days not all listed; runs still going, in no count; days not all listed; a
  machine whose collection is over a day old; a shared copy not read; lines that could not be
  read; runs of other events left out; the verdict setting; checks that could not be known);
  `more`.
- Errors: `VALIDATION_ERROR` (a value outside its list or range, with the list),
  `INVALID_INPUT` (a workflow the record does not know, or a check or an area, with the closest
  names and how many are known; a filter that does not go with `by`), `NOT_COLLECTED` (no machine's
  record holds this repository), `NO_WORKSPACE`,
  `RECORD_UNAVAILABLE`, `MACHINE_SETTINGS_INVALID`.
""",
    "docs": """\
# Docs Commands

## docs_lint(path=None)
Check markdown under `path` (default `docs/`) for broken internal links and anchors;
missing frontmatter on specs and proposals is a warning. External URLs are skipped.

## docs_check_changelog()
Flag staged source changes that have no CHANGELOG.md update or pending changeset.

## docs_check_agents()
Flag what AGENTS.md owns when it is not staged: a new top-level directory it does not
name, and a path or name it cites that the change removes or renames. New commands,
packages, skills and workflows are reported as advice, not required.

## docs_preflight()
Run changelog and AGENTS.md checks together via a DirectClient pipeline.
""",
    "spec": """\
# Spec Commands

## spec_create(name, template="proposal")
Create a new spec file from template.

## spec_delete(path)
Delete a spec file.

## spec_status()
List specs with metadata.

## spec_validate(path=None)
Validate spec structure.
""",
    "info": """\
# Info Commands

## info_workspace()
Show workspace metadata (root, packages, config).

## info_env()
Show environment info (Python version, platform, installed tools).

## info_scripts()
List available scripts from pyproject.toml / package.json.
""",
    "changeset": """\
# Changeset Commands

## changeset_create(change_type, description)
Create a changeset file for the next release.

## changeset_delete(path)
Delete a pending changeset file.

## changeset_status()
Show pending changeset files.

## changeset_consume(version=None)
Consume pending changesets into CHANGELOG.md.
""",
    "undo": """\
# Undo Commands

## undo_status()
View undo/history status.

## undo_clear()
Clear undo history.
""",
    "disk": """\
# Disk Commands

Keep development machines from filling up with worktree build output and caches. Use these
commands instead of freeing space by hand: never `rm -rf` a worktree or run
`git worktree prune` yourself.

## disk_report(repo=None, unclassified=False, budget_seconds=180)
Read-only. Every worktree of every registered repository (machine settings `repos`, or the
repository holding the working directory) with its tier, idle days, whether a process uses it,
and the build output its `[disk].regenerable` patterns name. Also watched volumes, tool caches
and aged cache folders. `unclassified=True` lists ignored paths no pattern covers (collapsing
each uncovered ignored folder to one entry, and marking truncated or incomplete scans with
`unclassified_truncated`, `unclassified_omitted` and `unclassified_incomplete`); the CLI's
plain-text form prints a grouped summary across worktrees and lists incomplete scans.

Tiers: 0 tool caches and aged folders; 1 build output in an idle worktree; 2 a finished
worktree; 3 report only (missing worktrees, orphan folders). Worktrees under T3 Code's worktree
folders are marked `managed_by: "t3-code"` (T3 Code's storage cleanup removes them), and
Botcore Factory's lane slots (`<repository>.factory-slots/`) `managed_by: "factory"`; tier 2
never removes either. Each repository's `idle_worktrees` counts linked worktrees idle
`strip_after_days` or longer (kept ones and Factory's slots aside; `complete` is false when time
ran out first); past the machine's `idle_worktree_limit` (20; 0 turns it off) it gets a
`warning`, also listed in `warnings`. A repository whose `[disk]` cannot be read is not counted.

## disk_reclaim(tier=1, apply=False, repo=None, pressure=False, include_restorable=False)
A dry run unless `apply=True`. Tier 0 prunes tool caches with their own commands (`uv cache
prune`; `pnpm store prune` only where pnpm uses hard links, since with clones it would empty the
store) and clears aged cache folders from the machine settings (an entry's age is its newest
time up to three folders down). Tier 1 also strips the build
output disk_report marks ready in idle worktrees, removing file candidates (such as build info)
before folder candidates in the same worktree and skipping a folder if build info in its folder
or an ancestor could not be removed. Before each deletion it checks again that the
worktree is idle and unused and the path is still ignored and untracked. When a watched volume
is below its threshold (or `pressure=True`) it also strips `when = "pressure"` patterns and
lowers the idle threshold to 1 day, then 6 hours. Never follows links or junctions. One run per
machine; every run writes a receipt (the response's `receipt`) and updates status.json in the
state folder (`BOTCORE_DISK_STATE` overrides it). Tier 2 also removes worktrees T3 Code does not
manage that hold nothing unique and whose work has landed (`git worktree remove`, branch kept,
commits pinned under refs/botcore/removed/ first, after the same just-before rechecks);
include_restorable also removes those that hold nothing unique but have not landed. Tier 2 is
off while T3 Code's settings cannot be read. The hourly job uses tier 2 only after
`disk_setup(remove_landed=True)`. A folder holding `.git` is never deleted through: inside an
aged folder it is `kept`, an outcome of its own that is not a failure, and the receipt's
`kept` lists each such action; inside a strip it leaves the strip `partial`.

## disk_setup(uninstall=False, repos=None, install_schedule=True)
Registers the repository holding the working directory (and `repos`) in the machine settings,
records each volume holding their worktrees or T3 Code's worktree folders with its identifier
and a low-space threshold, and installs the hourly job: a LaunchAgent on macOS, a Task
Scheduler task on Windows, a systemd user timer (or crontab) on Linux. Needs botcore installed
as a tool (`uv tool install lushly-botcore==<version>`), not run through uvx. Safe to run
again: existing usable `[tools]` entries are kept instead of overwritten by the shell's PATH,
and any entry added, replaced or removed is reported in `changed_tools`. `uninstall=True`
removes the job and keeps settings and receipts. Its `cargo` says where
Cargo puts build output for the registered worktrees, reading Cargo's config files as Cargo
does (each `.cargo/config` or `config.toml` from the worktree up, then `$CARGO_HOME`'s, with
their includes) and this process's `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and
`CARGO_BUILD_BUILD_DIR`. Inside each worktree is the default. Output moved out of them needs an
`[[aged]]` folder that clears it: one per workspace (`{workspace-path-hash}`) under a folder
that holds only Cargo output gets the exact entry to add; one folder shared by every workspace
needs a `max_gb` cap.

## disk_status()
The job's state, the last applied run and its age, free space on watched volumes, and
`problems` (stale for over 48 hours, failures, low or unverified volumes, skill usage or gate
outcomes whose collection has failed for over a day). `healthy` is true when there are none.
Session preflights read this. `warnings` do not affect `healthy`: each registered repository's
idle-worktree warning from the last reclaim that counted it fully (older than 48 hours, it
says when) and Cargo output no `[[aged]]` folder clears, both of which Botcore Factory's
`lane_status` shows to the foreman as `diskWarnings`; and a skill usage collection that has
failed for less than a day; and the git checkouts the last applied run kept inside aged
folders (`last_apply.kept`, the first ten, and `kept_count`). `skill_usage` is the job's last
collection: `ok`, `ok_at`, and
when it failed `error` and `failing_since`. `disk_work` is the same for the disk work, with
`waiting_on` (`what`, `path`) when it never came back: that is a problem at once, since only
the owner's answer or the drive will change it; a disk step that came back failed is a
warning. So is an installed job with no check on record, or none for three hours.
`gate_outcome` is the job's last gate outcome collection, as `skill_usage` is, with
`checkouts` (each checkout's `fetch`, `repository`, `sources`, `requests_used`, `folded`, or
the `error` it was refused with); null when the machine names no checkout. A refusal for any
checkout makes it not `ok`: a warning, and a problem after a day.

Everything the status reads has 20 seconds in all: the settings and what the job wrote
first, then the scheduler, the volumes and Cargo's settings as they are now. When the
machine does not answer, `problems` says what the status was reading, `schedule` is null and
`volumes` empty, and the rest is what the job last wrote, the idle-worktree warnings
included. The read is left where it waits, and a status asked again waits for that one.
When the job's own files do not answer the error is `DISK_STATE_UNANSWERED`.

## disk_keep(path, until=None, reason="") / disk_unkeep(path)
Protect a linked worktree from every disk action with a `git worktree lock` whose reason starts
`botcore-keep until=<date>` (14 days by default). Past its date a keep still protects and the
report lists it. disk_unkeep releases only a botcore keep, never another tool's lock.

## disk_restore(path)
Recreate a worktree a tier 2 reclaim removed, at the same path and commit: on its branch if the
branch still points there, on a recreated branch if it was deleted, else detached.

## disk_run(force=False, own_process=False)
What the job runs: checks free space and exits, unless a watched volume is low or the last
applied run is a day old; then disk_reclaim(apply=True). Notifies once a day while space stays
low. After the disk work it collects skill usage (`skill_usage_collect`), then gate outcomes
for the checkouts `gate_outcome_checkouts` names (none by default; `botcore docs
gate-outcome`). In the scheduler's run the disk work and each collection are waited for while
they report progress, and left only once they have said nothing for five minutes; the gate
outcome step is also left after 40 minutes in all, and the next hour's collection goes on from
where it got. A failure, a refusal, a wrong machine name or a collection that stops answering
never fails or holds the job or the other steps: each has its own line in the answer and in
check.json. `skill_usage_collect = false` in the machine settings turns skill usage off.

The scheduler's run (`botcore disk-run`, which passes `own_process=True`) always ends. The
disk work and the collection are steps that say what they are doing. Each is waited
for while it works, however long, and is never cut short; once it has said nothing for five
minutes beyond a command's own timeout it is waiting, and the run leaves it. A step that is
left starts nothing more: it stops at its next word, or when the system lets go of the read
it waits in, and the next hour's run starts again. `disk-status` then names what the disk
work was doing (`disk_work.waiting_on`) as a problem. A disk step that came back failed is a
warning; failures in a reclaim's receipt are the problem the receipt already raises. Errors:
`DISK_RUN_STALLED` (the disk work only waits), `DISK_RUN_FAILED` (it raised),
`DISK_STATE_UNANSWERED` (the job's own settings or state file did not answer in 30 seconds,
or could not be written).

Called with `own_process=False`, from a program that lives on, it waits for its steps however
long they take and records what they wait for meanwhile. If that call is cancelled or fails,
its steps are told to stop and given ten seconds. A command already under way (a `git`
call, a cache prune) runs to its end, and a step the system holds in a read stays there
until it is let go; either then stops before it removes anything more, and before a
reclaim's receipt or a collection's record is written.

On macOS a read that waits is most often the system asking the owner: a scheduled program is
asked at the screen before it reads an external or network volume, files a cloud drive's app
manages, or Desktop, Documents and Downloads, and the read is held for the answer. Allow the
program the message names when asked. It is the Python botcore runs on, which other tools may
share, so Full Disk Access for it reaches further than the one question. On macOS each run
reads the folders the disk work will need before anything else, so that the question comes
up in the run `disk-setup` starts.

Settings: the repository's `[disk]` in botcore.toml, read from a landing branch (origin's HEAD,
origin/main, then main; never a worktree's branch or the main checkout's HEAD), and the
machine's disk.toml (`BOTCORE_DISK_SETTINGS` overrides its path).
""",
}
