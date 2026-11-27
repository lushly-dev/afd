# Changelog

All notable changes to botcore will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes that are not released yet are the files in [`.changeset/`](../../.changeset/README.md)
that name `lushly-botcore`, one per pull request. `pnpm version-track botcore` writes them here
as a dated section when a release is prepared, so nothing is added under `Unreleased` by hand.

## [Unreleased]

## [0.11.0] - 2026-11-27

A minor release adding MCP Skills extension serving on managed hosts (`io.modelcontextprotocol/skills`), `skill-usage-effect` and fleet-cell judging in `skill-usage-triggers`, `CommandPolicy(secret=True)` for host journals (with `afd 0.14.0` or later, journals behind a `CommandHost` stop recording secret calls unless `redact` is supplied; see `Changed` below), factory gateway issue types/parents (`issue-create`, `issue-set`, `issue-get`) and `pr-merge` cancel dequeue reporting, plus three fixes: kept git checkouts inside `[[aged]]` folders in `disk-reclaim` no longer fail a run, Windows local-path git origins name their repository, and `botcore-factory`'s `lane-start` keeps its lane running on Windows. Includes two breaking changes for upgraders: `create_host_mcp_server` now validates bundled and registered plugin skill folders at startup, and custom `botcore-factory` gateway `GitHub` adapters must accept `type` on `create_issue` and implement the four issue-type/sub-issue methods.

### Breaking changes

- **Managed host MCP servers validate skill folders at startup (`create_host_mcp_server`):** in 0.10.1, `build_host` ignored folders registered with `PluginRegistry.add_skills_dir` and `create_host_mcp_server` served no skills by default. In 0.11.0, `create_host_mcp_server(host)` defaults `skills` to `host_skill_catalog(host)`, which reads bundled and plugin skill folders with AFD's Skills extension rules (`SKILL.md` in uppercase, YAML frontmatter with `name`, UTF-8 text, no spaces in file paths) and raises `ValueError` at server construction if any folder violates them. **Migration:** rename any lowercase `skill.md` to `SKILL.md` and fix offending skill folders, or pass `skills=None` to `create_host_mcp_server` to keep the 0.10.1 behavior (#2504).

- **`botcore-factory` gateway `GitHub` adapter interface:** `issue-create` now passes a fifth argument, `type`, to `create_issue(repo, title, body, labels, type=None)` even when no `type` is requested (so a 0.10.1 custom adapter passed to `build_gateway_host` raises `TypeError`), and the `GitHub` protocol adds `issue_types(repo)`, `set_issue_type(repo, number, type)`, `add_sub_issue(repo, parent, child)` and `remove_sub_issue(repo, parent, child)` (with `issue()` returning optional `type`, `parent` and `subIssues` count). **Migration:** accept `type: str | None = None` in `create_issue` and implement the four new methods on custom `GitHub` adapters (#2729).

### Added

- **`skill-usage-triggers`** judges a fleet cell's change. A fleet's merge lane opens the pull request itself, so no session was linked as its opener and the change read `unknown`. Botcore Factory's lane now names each thread that worked on the cell in the commit it folds the branch into (`Factory-session: sha256:<24 hex>`). A change with those trailers and no opener link is judged by the sessions they name, as of the commit's author time. A miss of such a change also has `commit`, and its `change` is null when the subject names no pull request (#1887).

- **Managed host MCP servers serve skills over MCP's Skills extension (`io.modelcontextprotocol/skills`, #2504).** `create_host_mcp_server(host)` now defaults `skills` to `botcore.host_skills.host_skill_catalog(host)`, which serves what the new `CommandHost.skills` (a `HostSkills`) names. `build_host` sets it: Botcore's 12 bundled skills and every skill folder the host's plugins register with `PluginRegistry.add_skills_dir`, which it used to drop, filtered by the workspace's `[skills]` `include` and `skip` as `botcore skill-seed` filters them. A plugin skill replaces a bundled one of the same name. A skill the workspace already holds under `[skills] source_dir` is not served, so a client that reads both does not list it twice. A client that reads MCP skills, such as an interactive Claude Code session, lists them with `skills/list` and reads each file as a `skill://` resource whose bytes match the manifest's digest. Skills are found and named with AFD's own reader, so a folder the extension cannot read (`skill.md` in lower case, no `name`, YAML it refuses, a file path with a space, text that is not UTF-8) stops construction with an error naming the folder, where `skill-seed` copies it or skips it. A `CommandHost` not made by `build_host` serves none until its `skills` is set; a host assembled from another host's commands must copy `skills` too, as Alfred's and `factory-cell` now do. Pass `skills=None` to serve none, or a `SkillCatalog` of your own. Keep `botcore skill-seed` for clients that do not read MCP skills: `claude -p`, the Agent SDK, cloud sessions, GitHub Actions and Codex.

- **`skill-usage-effect`** reports whether a loaded skill prevents the mistakes it names. A repository declares each checkable mistake in `[[skills.traps]]`: a skill, the paths a change must touch, and a regular expression over the lines a change adds or over its commit message, with `unless_paths` to exempt a change done the right way. Each merged change to those paths is judged as `skill-usage-triggers` judges it (`loaded`, `missed` or unknown, fleet cells included), and per trap the report gives each arm's `changes`, `hits` and `rate`, a `delta` once each arm has twenty judged changes, and the changes that made the mistake, with warnings when the comparison would mislead. It reads git and the usage record in a few batched calls, finds renames whatever git's settings say, runs nothing in the repository, never reports a matched line, and sees only what reached the default branch. A botcore without it refuses the `traps` key, so declare traps once every machine reading the repository has this release (#1829).

- **`CommandPolicy(secret=True)` declares a command that takes or returns a secret.** With afd 0.14.0 or later, `CommandHost.execute` binds the declaration to its middleware chain with `afd.core.open_dispatch`, so AFD's journal behind the host records other calls without `redact`, never records a secret one without it, and tells a two-argument `redact` which calls are secret. A secret call runs off every recording tape around it (`afd.server.run_off_tape`), even when the host's own chain has no journal and an outer one records the call that runs it. Before afd 0.14.0 the declaration has no effect: a journal behind the host records the call unless `redact` removes the secret, and registering a secret command raises a `RuntimeWarning`. `create_host_mcp_server` declares it on the AFD command it registers (on afd 0.14.0 or later; an older `define_command` takes no `secret`) and, when AFD's journal is in the server's middleware, runs `host.execute` inside the new `botcore.host.isolated_call()`, since that journal already keeps a secret call off its parents' tapes and a redacted recording keeps its reads on its own entry; without one the host isolates the call itself. The catalog includes `secret`. The isolation assumes one call at a time on a context: calls running concurrently on one context object can still see each other's sources (#2703). A host policy may add the declaration to a plugin's but not remove it. A non-boolean `secret` raises `TypeError`.

- **The factory gateway sets an issue's type and parent.** `issue-create` takes `type` (an issue type the organization defines, by name) and `parent` (an issue in the same repository, which the new issue is filed under as a sub-issue) and answers both; a retry its `dedupe_key` matches sets whichever the issue still lacks, and an attach GitHub refuses or does not answer names the issue already filed (that `GITHUB_UNAVAILABLE` is retryable only with a `dedupe_key`, since repeating a filing without one files a second issue). The new `issue-set`, on the foreman's and owner's routes, changes or clears either on an existing issue (`null` clears the type or detaches the parent, a new parent replaces the old, a field left out is kept) and answers `type`, `parent`, `previous` and `changed`. Both check first, so `TYPE_UNKNOWN`, `PARENT_NOT_FOUND`, `NOT_FOUND`, `VALIDATION_ERROR` and `PARENT_IN_OTHER_REPO` write nothing. `issue-get` always includes `subIssues: { total }` and includes `type` and `parent` when set (omitting them when unset). The App adapter writes types over REST and sub-issues through GitHub's sub-issue endpoints (#2729).

### Changed

- **Behaviour change: with afd 0.14.0 or later, a journal behind a `CommandHost` stops recording calls to commands that declare `secret`, unless it has `redact`.** Calls to other commands are recorded as before. Declare `secret=True` on the policy of every command that takes or returns a secret; the factory gateway's journal keeps its `redact`.

- **The factory gateway's `pr-merge` with `cancel` says whether it took the pull request out of the merge queue.** Turning auto-merge off leaves a pull request the queue already holds in the queue, so a cancel dequeues it too, as before; its answer now carries `dequeued`, its reasoning names each step it took, and the journal keeps `dequeued` and the input's `cancel`, so the audit shows which a cancel did (#2809).

- **A `STILL_QUEUED` refusal from the factory gateway's `pr-merge` with `cancel` keeps GitHub's refusal in its details** whenever GitHub refused to turn auto-merge off, and blames that refusal only while auto-merge is still what is set.

### Fixed

- **`disk-reclaim`** no longer counts a git checkout it keeps inside an `[[aged]]` folder as a failure. Such a folder is scored `kept`, the receipt and `status.json` list it under `kept`, and `disk-status` stays healthy and names it in `warnings`. Before, a temp folder a test suite writes git fixtures to made every run fail and `disk-status` unhealthy. A checkout inside a worktree's build output still leaves that strip `partial`, and the Windows path walk no longer reports each parent of a kept folder as a failed removal (#2625).

- **A checkout whose origin is a Windows path now names its repository.** `owner/name` was read only from `/`-separated origins, so on Windows a local-path origin named no repository: `gate-outcome-collect` and the hourly job refused it with `NO_WORKSPACE`, and skill usage filed it under the folder's name. Backslashes now separate as `/` does, and the `.git/config` fallback for a folder git refuses unescapes the doubled backslashes git writes there (#2710).

- **botcore-factory's `lane-start` keeps its lane running on Windows.** A venv's `python.exe` there is a launcher that runs the interpreter as its child, so the host lock and the lane's pid named the launcher and the lane refused its own lock. The lane process now takes the lock and the recorded pid over from the parent that lane-start started, so `lane-stop` stops, and `lane-status` sees, the real interpreter; a lock any other live process holds is still refused (#2671).

## [0.10.1] - 2026-11-26

A patch release with two fixes: managed host MCP servers keep working with the next `afd` release, and `disk-run` no longer loses an update to `check.json` on Windows.

### Fixed

- **`create_host_mcp_server` keeps working with the next `afd` release**, which no longer registers tools in the MCP SDK's tool manager (lushly-dev/afd#1756): the compatibility aliases' input schemas, which the SDK checks `Mcp-Param` headers against, are given to `afd`'s own table when it has one, and to the SDK's tool manager on `afd` 0.13. Enabling telemetry no longer imports the deprecated `afd.server.middleware.TelemetrySink`.

- **`disk-run`** no longer loses an update to `check.json` on Windows when a reader, such as `disk-status`, has the file open as it is replaced: the write is tried again for up to two seconds, and `disk-status` no longer reads the record as missing while it is replaced (#2538).

## [0.10.0] - 2026-11-26

Phase 1 of test effectiveness (`gate-outcome-collect` and `gate-outcome-report` by workflow, check, and area, with hourly collection, 180-day record folding, multi-unit area attribution, and record-vs-source separation), `botcore docs [TOPIC]` on the command line, managed host MCP servers running on `afd.server.create_server` with AFD's five standard meta-tools and dual-era MCP (raising the optional `[mcp]` extra to `afd[server]>=0.13.0` and `mcp>=2.3,<3`), `upload_routes` scoping for HTTP hosts, external skill directories and aliases in `skill-usage-report`/`skill-usage-triggers`, `botcore-factory` structured recoveries and claim/journal hardening, and `disk-reclaim` pressure-large escalation with `.cargo-lock` protection. Includes breaking changes in `botcore-connectors` (GitHub tokens come from environment variables only, with no `gh auth token` subprocess fallback) and `botcore-factory` (`gate-allow` and `ejection-excuse` require the live foreman session, and `gate-allow` now requires `head`).

### Breaking changes

- **`botcore-connectors` credentials come from the environment only:** the GitHub connector reads its token from `GH_TOKEN` (or the variable `github_token_env` names) and no longer falls back to running `gh auth token`. A setup that relied on the fallback sets the variable where the host starts, for example `export GH_TOKEN="$(gh auth token)"`. `GITHUB_AUTH_MISSING`'s suggestion says so. An embedder that passes its own connector policy with the former `("service", "subprocess")` effects now has host construction refused, since the commands declare only `service`: remove `subprocess` from that policy.
- **`botcore-factory` foreman-only records (`gate-allow` and `ejection-excuse`):** both commands now require the session that holds the lane's live lease; any other call (including 0.9.0-style calls without the foreman's session) is refused with `FOREMAN_REQUIRED`, which names neither the holder nor a way to take the lane, and neither command takes the lane. **Migration:** pass the running foreman's session from `factory call lane-status`; taking the lane with `lane-wait` while none is live supersedes the last foreman's session.
- **`botcore-factory` `gate-allow` requires `head`:** `gate-allow` now requires `head` (the commit diagnosed, which `GATE_EDIT_IN_REPAIR` now names) and covers only that commit; a later commit needs a new `gate-allow`. **Migration:** pass `head` alongside `branch`, `reason`, and the foreman's `session`.

### Added

- **Factory gateway `journal.keepDays` setting** (default `365`, `0` disables pruning), pruning older UTC day journal files at startup and on UTC day rollover (#2413).

- **`botcore docs [TOPIC]`** prints a docs topic on the command line: the same text the local server's docs tool returns, from the same function (`botcore.server.render_docs_topic`), so the two cannot drift. With no topic it lists every topic with its first line; an unknown topic is refused with the topics that exist and exit code 1 (`UNKNOWN_TOPIC` with `--json`). The disk-hygiene skill's pointer, `botcore docs skill`, now works (#2479).

- **`gate-outcome-collect` reads the `main` source.** With `sources: [main]`, every fix commit (subject `fix:` or `fix(<scope>):`, either with `!`) and every revert (`Revert "`) that landed on the default branch in the window is read once, through git at the fetched tip (using `refs/botcore/gate-outcome/default` when it holds the checkout's own landing branch and is ahead of it, never the working tree): when it landed, its pull request (the number its subject ends with, or the one GitHub says it merged), the units that hold its files, the test paths it touches, the issues its message closes with GitHub's closing words, its `Found-by:` lines where it has them, and the newest date of the lines it replaces, blamed at its parent. Records (changelogs, changeset fragments, provenance records, prose/status files and lockfiles) are excluded from unit attribution and `last_edit` blaming, with record-only commits marked `records_only` (#2551). No subject, message or diff text is kept. GitHub's GraphQL API then gives, up to 40 numbers to a request and each request counted against `requests`, the issues each pull request closes and every issue's state and labels. Without GitHub the commits are still read and the source is `partly`, with why; asked for with `main`, a `ci` that GitHub cannot be asked for is `absent` instead of a refusal.
- **`gate-outcome-report` reports by area.** With `by: area`, one row for each unit with fix commits (the unit whose manifest's folder holds the files, from `architecture.json` and the manifests under its discovery roots; `repository` where no unit does), most first: fix commits, reverts, escapes (closed issues with a label named `bug` or `security`, or ending `:bug` or `:security`, each counted once), unconfirmed fix commits (that close no issue), commits with a test path (a Rust change inside a `#[cfg(test)]` module counts), and the median age of the last edit with how many commits it was read for. Fix commits touching multiple units count in every unit they touch (each row carries `also_other_units` and `records_only`, while totals count each commit once with `multi_unit` and `records_only`) (#2551). Where GitHub was not read, no escape or unconfirmed count is given. The totals add the commits merged and the escapes by how they were found and by class. The `area` filter lists an area's commits, newest first, with the issues each closes; an area that is not known is refused with the closest names. Every report's `coverage.sources.main` now says how much of the source is held.

- **`gate-outcome-report` reports by check.** With `by: check`, one row for each check and event: a step of a job as GitHub names it (a matrix leg is its own check, a job that calls a workflow is `<caller> / <called job>`), and inside a step that runs a hook group (a command that comes down through the root `package.json` to `lefthook run <group>`), each command of the group. A row counts runs that passed, failed and were cancelled, and steps that did not run (`not-run`) apart, with passes on a later attempt, minutes, a rate only on 20 runs or more, `quiet` for a check that passed and never failed, and `local: absent` until local runs are collected. Passed attempts keep their jobs' and steps' conclusions where one did not succeed so skipped steps are told from passed ones. The checks known are read through git from the default branch's tip (preferring `refs/botcore/gate-outcome/default` when newer, never the working tree); one the record has not seen is listed under `not_observed` with why, never as a row of zeros, and one that is not known is refused with the closest ids and how many are known. The `check` filter takes an id as written and gives the runs it failed in; every filter the plan names is taken, and one that does not go with `by` is refused with those that do.
- **A failed hook group step has its failing command named.** When a collection reads the jobs of an attempt whose group step failed, it reads that job's log once (one counted request) for Lefthook's closing summary, and keeps each command's name, result and seconds, and nothing else of the log; a name is kept only when the group has it at the default branch's tip. The logs of group steps that passed are read last, as the limit permits, and `coverage.commands_share` gives the share read. A summary that cannot be read is said so, and its commands' results are `result_unknown`, never guessed.
- **Verdict workflows are left out of the totals.** A repository names the workflows that judge the others in `botcore.toml` (`[gate_outcome] verdict_workflows`, by file or name). A named one keeps its row, marked `verdict`, and the report's totals and the queue's failed groups leave it out and say so. With none named the report is as it was.

- **`gate-outcome-collect` reads a repository's workflow runs from GitHub into a record every machine shares.** Called from a checkout, it lists the Actions runs of the last `since_days` whole UTC days for every event, splitting any span GitHub caps at 1,000 runs, then reads the earlier attempts of runs that have them, then each attempt's jobs and steps (those that did not pass first). It stops at `requests` (1,000 unless given) or when the account's hourly allowance is down to half, says how far it got (`partly`, `reached`), and the next collection goes on from there; collecting the same window again, here or on another machine, adds nothing. The record holds paths, digests, names, durations and counts only, and is shared through the folder skill usage uses. `ci` and `main` are built; `reviews` and `runs` are refused until collected.
- **`gate-outcome-report` gives each workflow's runs by event.** One row for each workflow and event over a window of whole UTC days (`days`, `ending_days_ago`, `limit` 1–75, default 25 so `by: check` stays within the local server's 100,000-character budget): runs that passed, failed, were cancelled, ended `action_required` or were skipped, counted apart; runs that passed on a later attempt; wall hours; for the merge queue its groups and how many had a failure; and a failure rate only on 20 runs or more (`too-few` otherwise). `coverage` says how much of the window was listed and what share of runs have their steps, and `warnings` names runs still going. `by: workflow`, `by: check`, and `by: area` are built. Both commands have a `gate-outcome` docs topic.

- **The hourly job collects gate outcomes for the checkouts a machine names.** `gate_outcome_checkouts` in the machine settings (`disk.toml`) lists checkouts by path; with none named, nothing is collected, since GitHub's hourly allowance belongs to the account. For each, a step after skill usage's fetches origin's default branch into `refs/botcore/gate-outcome/default` (no branch, remote-tracking branch, tag, index, working tree or `FETCH_HEAD` changes), then runs `gate-outcome-collect` for seven days with every source this botcore collects, at its default limit and its stop at half the allowance. The step has its own time limits and its own `gate_outcome` line in the job's answer, `check.json` and `disk-status`; a refusal, a failed fetch or a step that stops answering is reported and never stops the disk work or skill usage. The setting is written to the file only when it names something, because an older botcore refuses a settings file with a key it does not know.
- **The record folds days older than 180 days.** At the end of each collection, under its lock, a whole UTC day more than 180 days old that was wholly collected has its runs, attempts' steps and group summaries put in one `folded-workflow` line for each workflow and event and one `folded-check` line for each check and event, holding what the reports count. The new file is written beside the old and put in place in one move, so a fold cut short leaves the old record whole; lines it cannot read, lines of other kinds and every shape are kept as they were, and the shared copy is folded the same way. A report over a window that reaches a folded day gives the figures its runs gave and names the folded days in `coverage.folded`; a folded day is never asked of GitHub again, so a rebuild keeps it. Nothing is folded while another machine's record could not all be read, and a day not wholly collected is held back; the collection's answer says what it folded and what it held back, and why (`folded`). An older botcore that reads a shared copy holding folded lines counts them as lines it could not read.

- **`create_host_http_app(..., upload_routes=...)` names the routes that take uploads.** A `POST /<route>/uploads` on any other route is refused with `NOT_FOUND` before it takes an upload slot or reaches the upload handler. Left out, every route takes uploads, as before. The factory gateway passes only the routes that can push, so a route such as its `heartbeat` route, whose token a lane's queued code can read, cannot store bundles.

- **`botcore-factory` refusals carry a structured recovery** (`spec/recovery.md`): every refusal names the step its suggestion describes, as `call` (for example `ALREADY_CLAIMED` and `NOT_DISPATCHABLE` call `issue-check`, `CELLS_FULL` calls `lane-status`), `fix-input` (with the fields to change, or `drain: true` for a busy lane host), `external` or `stop`. `STATE_LOCKED` is now `retryable` with a `retry` recovery, and `READ_FAILED` and `STATE_UNAVAILABLE` are `external`. The executed jobs assert each refusal's recovery and follow the ones a program can take, `fix-input` included; `tests/test_recoveries.py` requires every refusal to carry one, every `call` to name a served command that each of its suggestion's wordings names, and shows a planted wrong recovery failing the job.

- **`[skills].extra_dirs` and `[skills.aliases]`** in `botcore.toml` / `pyproject.toml`, plus personal/configured external skill folders (`skill_usage_dirs` in `disk.toml`, `BOTCORE_SKILL_USAGE_USER_DIRS`) and local tracking of loaded `SKILL.md` file locations, so `skill-usage-report` returns sizes, listing cost and `quiet` entries for skills kept outside `.claude/skills`, `.agents/skills` and `.codex/skills`, and `skill-usage-triggers` resolves configured `[skills.aliases]` when judging required loads (#1830).

### Changed

- **Factory gateway journals write commands only (with their failures):** pure reads (`gateway-status`, `issue-get`, `comment-list`, `claim-list`, `pr-status`, `review-get`, `gateway-audit`), `gateway-wait`, and `lane-heartbeat` stay out of the journal (#2413).

- **Managed host MCP server (`create_host_mcp_server`) now runs on `afd.server.create_server` (#2499):**
  - Exposes AFD's five standard meta-tools (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`) in every `tools/list` alongside dual-era MCP (`2026-07-28` `server/discover` and `2025` `initialize`), unlocking AFD Skills (`io.modelcontextprotocol/skills`), resources, OAuth bearer `auth`, `context_hook`, `context_fields`, `middleware` and tool strategies via forwarded AFD options (`**afd_options`).
  - Applies host policy, execution profiles (`inspection`, `remote-caller`, `trusted-local`) and target path bounds as AFD middleware (`create_host_policy_middleware`) while still routing every admitted call through `host.execute`. Defaults `default_timeout_ms=None` so long-running host commands are not cut off unless a timeout is configured.
  - Maps `command_tools=False` (default) to AFD's `"lazy"` tool strategy and `command_tools=True` to `"individual"` (with `tool_strategy="grouped"` and `"hybrid"` also selectable). Under `"lazy"`, exposed commands are also callable directly by served name as in AFD's spec.
  - Keeps `{name}-start`, `{name}-call` and `{name}-docs` working as deprecated compatibility aliases and preserves `{name}-run` when `raw_python=True` on `trusted-local` hosts. Replies carry AFD wire metadata (`metadata.traceId`, `metadata.executionTimeMs`, `metadata.actorKind`), `structuredContent` and `isError: true` on failures; calling an unregistered spelling returns a structured `COMMAND_NOT_FOUND` result instead of an SDK protocol error; commands colliding with `{name}-start|call|docs|run` or AFD meta-tool names are refused at construction.
  - Raises the optional `mcp` extra to `afd[server]>=0.13.0` and `mcp>=2.3,<3` (base installs remain `afd>=0.9.0`). Legacy `create_mcp_server` and `botcore.host_http` are unchanged.

- **`botcore-connectors` commands declare only the `service` effect**, since they no longer start a subprocess, so a `remote-caller` host runs them as well as a `trusted-local` one. An agent that only needs the connectors can set `tool_profile = "remote-caller"` in the LLM plugin's settings instead of `trusted-local`; the botcore-llm README shows the setup.

- **`botcore-factory` repairs that edit gate paths:** before it validates a repair, and before merging `main` in, the lane checks its gate edits again with its own code and `gate_paths` and holds what it finds as `gate-change` for the owner. A cell keeps its latest failing-check ejection, so a later ejection for another cause no longer ends the check. `lane-enqueue`'s `GATE_EDIT_IN_REPAIR` sends the cell to its foreman, and an `area:ci` label no longer exempts a repair.
- **`botcore-factory` cell status:** a cell's `lane-status` shows whether a foreman's lease is live (`foreman.held`) and until when, not its session. The factory host's `lane-status` adds `foremanHeld`.

- **A journal behind a `CommandHost` records only when it is given `redact` once `afd` adds `secret` command declarations.** On `afd 0.13.0` behavior is unchanged today; because `CommandHost` runs its own middleware chain outside AFD's engine, AFD's journal cannot inspect a command's `secret` declaration, so once an `afd` release ships `secret`, a journal behind a `CommandHost` will record nothing without `redact`.

### Deprecated

- **Managed host MCP compatibility aliases (`{name}-start`, `{name}-call`, `{name}-docs`):** kept working on `create_host_mcp_server` in 0.10.0 and scheduled for retirement in a subsequent release. Call AFD's standard meta-tools (`afd-discover`, `afd-detail`, `afd-call`) or direct served command names instead (#2499).

### Fixed

- **`record_provenance.py` refuses CRLF line endings in tracked LF text files**, preventing Windows checkouts from recording SHA-256 digests that fail Linux CI verification (#2390).
- **`skill-usage-collect` resolves `owner/name` from `.git/config` (including worktree `gitdir`/`commondir` pointers) when `git remote get-url origin` fails** (such as on Windows dubious ownership), so clones of the same repository merge under one project instead of splitting (#2370).
- **Scoped factory gateway journal reads:** `read_journal` and `gateway-audit` skip day files older than `since`, `outside_writes` skips reading the journal when no bot PR is open, and `gateway-wait` skips `outside_writes` when `kinds` excludes `outside-write` (#2413).

- **`disk-reclaim` escalates oversized idle in-tree outputs under low-space pressure and guards `.cargo-lock`** (lushly-dev/afd#2241). When a watched volume remains below its `low_space_gb` threshold after the 6-hour pressure step and aged-folder escalation, tier 1 now runs a largest-first `pressure-large` pass over `when = "idle"` directory candidates of at least 5 GiB in strippable worktrees idle for at least 1 hour (such as in-tree `endpoints/umbel/target` directories), pairing any ancestor build-info file strips first (#1939) and stopping per volume as soon as free space recovers. `_recheck_strip` now also skips any directory whose `.cargo-lock` is held by a running Rust build.

- **`lane-report` on a lane that has not run** now sends the caller to `lane-status` instead of `lane-start`. `lane-start` refuses on a machine that does not host the lane, and starting a lane is not how to read a report. The factory's new small-worlds test found it: it follows every refusal's recovery over short command sequences from the scenario fixtures.

- **`botcore-factory` competing claims:** `cell-register` now names the earliest still-standing live claimant when two branches claim the same issue, matching the issue-claim CLI, and shows a renewed holder's current lease.
- **`botcore-factory` stale claims:** `issue-check` no longer lists an issue as stale, and `cell-register` no longer calls its claim expired, when a live claim is followed by a later one that lapsed.
- **`botcore-factory` releases:** `lane-drop` and a `cell-register` whose writes failed leave `status:in-progress` on an issue another branch's live claim still holds. A lapsed claim whose branch has an open pull request counts, as the issue-claim CLI reads it. Taking the label off hid that claim, and the issue could be dispatched a second time. `lane-drop` now posts its release comment before changing the label, so a failed comment leaves the issue held.

- **`botcore-factory` suggestions name served commands:** `lane-enqueue`'s `NOT_LANE_HOST` refusal told the cell to use `lane-handoff`, which is planned and not built. It now tells the cell to stop and tell the foreman, naming the lane host and `lane-enqueue`. A test reads every refusal's suggestion in the plugin, including those built from variables and helpers, and fails on any hyphenated name that is neither a command the factory serves nor a listed skill, event or setting.

- **The factory gateway's journal keeps only what the audit reads.** It records failures too, so an `issue-create` refused with `SECRET_IN_BODY` would have stored the body. Its new redactor, `audit_record`, keeps the actor, timestamp and trace ID, the input's `repo`, `number`, `numbers`, `head` and `ref` when each has the right type, and of the result only `success`, an error's `code` and a pull request's `number`.

## [0.9.0] - 2026-11-24

Per-command MCP host tools (`create_host_mcp_server(..., command_tools=True)`), full `cdp_*` browser automation command exposure, read-only PR and checkout inspection commands (`pr_status`, `pr_wait`, `pr_drift`, `dev_snapshot`), PEP 561 `py.typed` typing support, Health 1.0 trend measures and test-discovery gates in bundled skills, `botcore-agents` team/task commands, and cross-platform reliability across disk hygiene (Cargo bucketed eviction, macOS APFS `APFSVolumeGroupID`, stall-safe hourly runs), cross-machine skill usage collection, and `botcore-factory`. Includes breaking changes for `cdp_perf` trace commands and result shapes, and in the in-repo `botcore-memory` and `botcore-llm` packages for host-verified caller principals and the `lushly-botcore>=0.8.0` floor.

### Breaking changes

- **`cdp_perf` cross-call tracing removed and `perf_*` results flattened** (#778). `perf_trace_start` and `perf_trace_stop` no longer attempt tracing across separate CDP connections and now always return `CDP_TRACE_UNSUPPORTED`; `perf_*` commands also no longer double-wrap `CommandResult` data. To migrate, use `cdp_trace_capture`, `cdp_trace_summary`, or `cdp_trace_query` instead of `perf_trace_start`/`perf_trace_stop`, and read `result.data` directly instead of `result.data.data`.

- **`botcore-memory` keys agent memory on the caller a host verified.** This covers calls through a Botcore host: a host's CLI, its MCP `call` tool, its HTTP surface and an LLM session's bridged tools. Such a call reads and writes agent memory as the host's actor, `<kind>_<id>` for an id of lowercase letters, digits, `_` and `-`, else `<kind>-<digest>` (as for `Alex` or `lane@random`; `botcore_memory.access.principal_id` gives it), so two callers of one host keep separate memories, including ids that differ only by case. A host call whose actor has no id is refused with `MEMORY_PRINCIPAL_UNKNOWN` and a suggestion instead of sharing the `default` memory. The `botcore` CLI, the legacy stdio MCP server's `run` tool and scripts still run as the single local user, `default`, and existing `default` entries stay readable there. Both `botcore-memory` and `botcore-llm` now require `lushly-botcore>=0.8.0`, whose hosts name each caller; on an older Botcore a managed host call is refused rather than treated as local. Scope ids and keys with a trailing newline are refused. To migrate, give each host caller an actor id, upgrade to `lushly-botcore>=0.8.0`, and to move existing local `default` agent memory to a verified principal, stop hosts serving the store and run `await botcore_memory.migrate.move_default_memory(to)`.

### Added

- **Full `cdp_*` command exposure:** expose all 33 `cdp_*` commands through `botcore.commands.__all__`, `botcore cdp <subcommand>`, `CORE_DOCS["cdp"]`, and `CDP_POLICIES` in `botcore.host` (#778).

- **`create_host_mcp_server(host, command_tools=True)` serves each command as its own MCP tool**, named as the host serves it, beside the `start`, `call` and `docs` meta-tools. Each tool publishes the host catalog's input schema and `readOnlyHint`/`destructiveHint` annotations from the command's declared effects, so a client's permission rules can tell a write from a read. The SDK does not model a command tool's arguments (SDK 2 only compares `Mcp-Param` headers with the catalog schema, which declares none): they reach `host.execute` whole, so the host stays the only validator, a `**kwargs` handler is served, and bad input is refused in AFD's error shape. A command named like a meta-tool (`-start`, `-call`, `-docs`, or `-run` even without raw Python) is refused when the server is built. The annotations are hints for a client's rules: `-call` still reaches every command.

- **Read-only PR and checkout inspection commands** (`pr_status`, `pr_wait`, `pr_drift`, `dev_snapshot`) in `botcore.commands` and the `botcore` CLI, with `[pr]` configuration in `botcore.toml`, automatic GitHub GraphQL-to-REST rate-limit fallback, cross-platform opt-in locking and event watermarks for `pr_wait`, and `SK020` validation for optional `agents/openai.yaml` skill manifests in `skill_lint`.

- **PEP 561 `py.typed` marker** (lushly-dev/afd#1757). Shipped `src/botcore/py.typed` in the `lushly-botcore` wheel and sdist and added `mypy` checking across `botcore` and `botcore-factory`.

- **botcore-agents registers `team_status`, `task_list`, and `task_cancel`** (lushly-dev/afd#2234). `team_status` returns live health snapshots across all agents and task counts, `task_list` lists tracked tasks with optional `status`/`agent` filters and live progress for running tasks, and `task_cancel` cancels pending, assigned, or running tasks (aborting live chat streams and freeing the agent slot).

- **`botcore-factory` `provenance-rerecorded` record and report count**: the lane writes a dedicated `provenance-rerecorded` measurement record (raising record schema from 3 to 4; 0.9.0 ships schema 5) whenever `regenerate` resolves a provenance-only merge conflict, and `lane-report` reports `provenanceRerecorded` and its comparison delta (#1472).

- **`botcore-factory` `slot_clean_paths` adapter key**: `[plugins.factory]` accepts literal relative paths inside a slot checkout whose ignored build output (such as a tool that overrides `CARGO_TARGET_DIR`) is moved aside into the slots parent directory and removed in the background when a slot is recycled, swept after its branch leaves the queue, or finishes coverage (#1659).

- **Health 1.0 trend measures producers in `bloat-sweeper` and `gate-discipline` skills:**
  - `bloat-sweeper/scripts/sweep.mjs` adds `--measures-out <file>` (optional `--target <id>`) and `toMeasuresDocument()` to emit `schema_version = "1.0"` Health measures for oversized files, largest source file, duplicated lines, clone groups, spreading clones, cohesive exemptions and repository `[sweep] measures`.
  - `bloat-sweeper/scripts/cognitive-complexity.mjs` records per-function Sonar-style cognitive complexity across JS/TS, Python, Rust and C++ as an advisory trend only (always exits 0; `--measures-out <file>`).
  - `gate-discipline/scripts/report-test-changes.mjs` adds `--measures-out <file>` and `toMeasuresDocument()`.
  - `gate-discipline/scripts/report-test-counts.mjs` counts tracked test files, tests, assertions, skips, unconditional skips, scenario files/steps, quarantined files and discovery exemptions and writes Health 1.0 measures.
  - `gate-discipline/scripts/report-coverage-measures.mjs` reads Istanbul (`coverage-summary.json`, `coverage-final.json`), Python `coverage.py` JSON and LCOV (`lcov.info`) artifacts and emits weighted totals plus per-unit Health 1.0 measures (#1387).

- **`gate-discipline` test-discovery guard (`scripts/check-test-discovery.mjs`)** checks that every tracked JavaScript/TypeScript, Python, C++ and Rust test file is claimed by an active test runner (Vitest, Vite, Playwright, Jest, `node --test` and active JS launchers, pytest, CMake/CTest, Cargo, or workflow-verified custom drivers), reconciles in both directions so dead runners and stale or recovered `unrun` exemptions in `scripts/policy/test-discovery.json` fail loudly, and runs with Node and git alone (#1519).

- **`botcore_memory.migrate.move_default_memory(to)`** (`async`, local memory store only) copies the local `default` agent memory to a principal: it backs up both stores and reports the backups, writes the target store once, keeps every entry's fields, treats identical target entries as already moved (so a rerun completes an interrupted move), refuses target keys holding other entries, verifies the copy and never deletes. It refuses host calls; stop hosts serving the store before running it.

### Changed

- **The `disk-hygiene` skill** says that an ignored path no `[disk]` pattern names keeps tier 2 from removing its worktree, and that a build-info file goes with its output (`**/*.tsbuildinfo` with `**/dist`), since `tsc` emits nothing when its build info survives a stripped `dist`, and that `tsBuildInfoFile` belongs outside `node_modules` (#1693).

- **`botcore-llm` tool calls carry the session's agent name.** For a local, trusted caller such as the `botcore-agents` orchestrator, `llm_session_create(agent_name=...)` is the tool caller's id wherever the tool host's actor gives none (`bridge_commands` and `model_actor` take `agent_name`); a host whose agent actor has an id keeps it. Inside any host call (with or without an actor), `agent_name` only labels the session. `botcore-llm` now requires `lushly-botcore>=0.8.0`. The name identifies the agent, not the person: two people whose tool hosts run the same agent name share that agent's memory.

- **Bundled `mcp-builder` skill (`2.2.0`):** point at `spec/output-budgets.md` for per-command structured AFD output budgets (#1993).

- **Know a folder's volume by its identifier** (lushly-dev/afd#2245). `skill-usage-collect` now records a volume's stable identifier (`volume_id`) with each project folder where the operating system provides one, falling back to the device number (`st_dev`) only where there is none. A volume remounted under a different device number is still recognised so a removed checkout's skills drop on the next collection, while another disk mounted at the same mount point (even with the same device number) is not mistaken for the original volume.

### Fixed

- **`botcore-factory` `lane-drop`:** read the pull request's merge progress on GitHub for entries in `merging` state and refuse `MERGE_QUEUED` when GitHub already holds the pull request (in the merge queue, auto-merge enabled, already merged, or settling as merged) or `READ_FAILED` when GitHub cannot be read, preventing lost landing records (#1628).

- **`disk-reclaim` and `disk-report` build info ordering:** strip file candidates (such as `*.tsbuildinfo`) before folder candidates (such as `dist`) within a worktree, skip a folder strip when build info in its directory or an ancestor inside the worktree could not be removed, and count file candidates toward worktree last activity in `disk-report` and tier-2 `removal.py` to match `disk-reclaim`'s recheck (#1939).

- **`disk-report --unclassified`:** collapse each uncovered ignored folder (such as self-ignoring `.pytest_cache/`) to one entry, mark truncated or budget-limited lists with `unclassified_truncated`, `unclassified_omitted` and `unclassified_incomplete`, and print a grouped plain-text summary across worktrees with incomplete scans instead of raw JSON (#1955).

- **Scheduled skill usage collection (`disk-run`):** wait for `skill-usage-collect` while it reports progress (via a SQLite progress handler while reading T3 Code's store and per-transcript/per-line progress words for Claude Code) instead of cutting it off at a flat five-minute wall-clock limit, leaving it only after five minutes of silence; also avoid full-table counts in `t3.check_schema` and pre-filter `_native_ids` rows by `nativeItemRef` (#2160).

- **Botcore disk classification (`disk-report --unclassified` and tier 2):** look inside collapsed ignored folders whose own path matches no `[disk]` pattern and accept them when every child is covered by a regenerable pattern (passing its nested safety checks) or an unchanged declared copy (#1933).

- **Botcore provenance artifact verification (`scripts/verify_provenance.py`):** refuse unexpected members under the provenance records directory (including case collisions, `./` segments, subdirectories and symlinks) and duplicate members in both wheels and sdists (#1671).

- **`botcore-factory` state store durability:** trim closed events and finished runs under a bounded policy while preserving open events, active runs and monotonic IDs; fsync temp files and parent directories before and after rename; verify lock inode and content before breaking stale locks; and maintain incremental branch/run record summaries in `records-summary.json` (#1796).

- **`botcore-teams` command dispatch:** return a failure `CommandResult` with a suggestion when a command is not registered or dispatch fails instead of falling back to fabricated stub successes (#1797).

- **Windows disk removal says what it does as the POSIX walk does** (lushly-dev/afd#2173). The path walk Windows uses now says `clearing` for each folder it opens and `looking at` for each entry before reading it, so a watcher follows either walk, and a step left during that read stops before anything is removed.

- **The skill usage record keeps `\n` line endings on Windows** (lushly-dev/afd#2173). A rewritten record file no longer gets `\r\n` from text mode, so its bytes match the lines `append_events` writes and the shared copy.

- **A skill usage record path that is a file is `RECORD_UNAVAILABLE` on Windows too** (lushly-dev/afd#2173). Windows reads a file under a file as missing, so the report said `NOT_COLLECTED`; the record folder is now checked first.

- **Teams status messages reach `task_status` with its `task_id`** (lushly-dev/afd#2174). The botcore-teams plugin read "status of task-001" as `{"query": "of task-001"}`, which botcore-agents' `task_status` does not take; it now passes `task_id`, and a status message without an id gets `MISSING_TASK_ID` with a suggestion instead of a failed call.

- **`skill-usage-collect`** upgrades stored `remote: false` projects to `owner/name` once git can read their origin, refiling historical events and sessions and clearing duplicate `quiet` entries (#2052).

- **`CommandHost.execute`**, `disk_*` and `skill_usage_*` commands offload synchronous blocking bodies with `asyncio.to_thread` (preserving `Step` thread bindings), `run_command` isolates subprocesses in their own process group and terminates the group on timeout or cancellation, and `run_external_tool` runs the path resolved by `shutil.which` (#1794).

- **`cdp_*` commands** persist `cdp_select_page`, `cdp_resize`, and `cdp_emulate` (including real `user_agent` and `cpu_throttle` CDP emulation), back `cdp_list_network`/`cdp_get_network` with Performance Resource Timing entries, return structured `CommandResult` errors instead of raising on unreachable browsers or invalid regexes, and fix `cdp_perf` double-wrapping and unsupported cross-call tracing (`CDP_TRACE_UNSUPPORTED`; see Breaking changes) (#778).

- **`disk-*` handles rapid multi-worktree Cargo build bloat and low-space `[[aged]]` pressure** (lushly-dev/afd#2373). `cargo.py` / `disk-setup` now suggests `max_age_days = 2` together with a volume-scaled `max_gb` cap (20% of volume size, clamped to 40–150 GB) for per-workspace Cargo build directories, and `_cargo_only` recognizes non-hash Cargo build directories (`.cargo-lock`, `.rustc_info.json`, `CACHEDIR.TAG`, `<profile>/.fingerprint`) while still refusing unrelated content. `caches.py` descends automatically into Cargo's `<2-hex>/<hash>` `{workspace-path-hash}` buckets (and supports explicit `/*/*` patterns) so aging, sizing, and eviction operate per workspace directory without breaking non-bucketed `[[aged]]` folders, and `reclaim.py` prunes empty 2-hex buckets afterward. Under low-space pressure, `disk-reclaim` now escalates `[[aged]]` folders oldest-first across the 1-day, 6-hour, and 1-hour-floor recovery steps (stopping per volume as soon as free space recovers), and `_recheck_aged` scopes Rust build protection to busy processes, held `.cargo-lock` files, and recently modified entries instead of globally blocking unrelated stale folders whenever `cargo`/`rustc` runs.

- **`disk-*` volume verification uses `APFSVolumeGroupID` for macOS APFS boot snapshots** (lushly-dev/afd#2267). On macOS, `/` is mounted from a sealed APFS snapshot whose `VolumeUUID` changes on every OS update, causing `disk-status` to report `/` unverified and `disk-reclaim` to block every repository with checkouts on `/`. `_darwin_volume_id` now prefers persistent `APFSVolumeGroupID` on APFS snapshots, `volume_state` accepts the current snapshot UUID from the same `diskutil` read until `disk-setup` reruns, and `disk-setup` migrates an internal `/` volume to `APFSVolumeGroupID` (reporting the change in `updated_volumes`) without modifying external drives.

- **`disk-setup` keeps usable `[tools]` entries on rerun** (lushly-dev/afd#1934). Rerunning `disk-setup` from another shell's `PATH` no longer overwrites existing `[tools]` entries whose executable file still exists and lasts; only missing or broken entries are filled in or cleared, and `disk-setup` now reports every added, replaced or removed entry in `changed_tools`.

- **`skill-usage-collect`** handles PowerShell quoting in the shell reader: ignores here-strings inside POSIX `<<` here-documents, stops treating `\"` as an escaped quote inside PowerShell scripts, and honours PowerShell backtick escapes inside double quotes (#1847).

- **Teams cancel, task-list, and team-status intents reach registered `botcore-agents` commands** (lushly-dev/afd#2234). `botcore-teams` now parses cancel messages into `task_id` (returning `MISSING_TASK_ID` with a suggestion when no id is present, without falling through to `task_assign`), renders task IDs/descriptions and agent names/statuses in Adaptive Cards for list responses, and tests every Teams intent through a real registry holding `AGENT_COMMANDS`.

- **On Windows, `disk-run` keeps waiting when a step reports fresh progress within the same clock tick** (lushly-dev/afd#2258). `Step.leave` now compares a monotonic word sequence count instead of `time.monotonic()`, which advances in coarse ticks on Windows and could otherwise mistake a working step for stalled.

- **`botcore-factory` locks on Windows**: taking `state.lock`, `lane.lock` or a stale-lock break guard no longer fails with `PermissionError` when the previous lock file is still being deleted. Windows refuses that create with access denied, and the lock now counts as held for that moment, so the taker waits or retries as it would for any held lock (#1793).

- **The hourly job always ends, and says what it waited for** (lushly-dev/afd#1902). macOS asks the owner at the screen before a scheduled program reads an external volume, and holds the read until someone answers. The first reclaim the schedule ran by itself waited there for ever, and a scheduler starts no run while one is alive: no check, no reclaim and no collection of skill usage until the process was ended. On macOS `disk-run` now reads each folder it will need before anything else, so that the question comes up in the run `disk-setup` starts, and everywhere it runs the disk work as a step it can stop waiting for. A step says what it is doing as it goes. Disk work that is working is never cut short; once it has said nothing for five minutes it is waiting, and the scheduler's run leaves it and ends. A step that is left starts nothing more: it is told right before each thing it would remove, before a reclaim writes its receipt, and before a collection writes or shares its record, at once or when the system lets go of the read it waits in. `disk-status` names the folder it waited for and the program to allow (`disk_work`), as a problem; everything it reads has 20 seconds in all, what the job wrote first, and it warns when an installed job has no check on record or none for three hours. `check.json` is never written without its lock or over a file that could not be read, so two runs that overlap keep each other's updates. New errors: `DISK_RUN_STALLED`, `DISK_RUN_FAILED`, `DISK_STATE_UNANSWERED`. `disk_run` called from a program that lives on waits for its steps as before, and tells them to stop if the call is cancelled.

- **A shared folder that does not answer no longer reads as a collection that failed** (lushly-dev/afd#1903). The same question is asked before a scheduled program reads a folder in a cloud drive that fetches files on demand. The collection writes this machine's record before it shares it, and the job now says so: `this machine's record was collected, but the shared folder did not answer`, with the folder and what to allow. The disk work no longer holds the collection either: it waits only while the disk work is working.

- **A skill usage report says the same on every machine** (lushly-dev/afd#1904). A report took a project's skills, their sizes and their names now from the folder on the machine that read it, so a checkout left on an old branch gave other totals from the same record: on two machines, 4,291 loads of 174 skills against 4,311 of 171. `skill-usage-collect` now reads what each project holds at the tip of its default branch, out of git's objects (never the checked-out files, so a topic branch, work under way and files not yet added play no part), with the renames in that commit's history, keeps both in the record with the commit and its time, and shares them. The default branch is the one the remote names, else `main`, else `master`; of the remote's copy and the checkout's own, the one ahead. `skill-usage-report` reads the record and no checkout: for each project it takes the account read from the newest commit among every machine's, so machines agree once each runs this version and their records have synced. `skill-usage-triggers` names skills the same way, with the default branch of the checkout it runs in where that is newer. A rename made on a branch is known once it is merged. A folder that is no repository is read as it lies; a repository git could not read that hour, or a folder that is not there, keeps what it said last. A skill that is only on a topic branch, or kept out of git, is counted with no size and is not in `quiet`, and a folder whose name no load is recorded under is not listed. The report warns when no machine's record says what a project holds (a record an earlier botcore wrote), until a collection runs.

- **A repository git refuses lists the skills its folder holds** (lushly-dev/afd#2051). Git stops at `detected dubious ownership` for every command in a folder another account owns. Since the collection began reading what a project holds from git, such a folder said nothing, for good, and its project held no skills: no size, nothing in `quiet`. A repository git could not read, with no commit on record, is now read as it lies, as it was before, whatever stopped git: for a first collection that only timed out, that lists unmerged work until git answers the next hour. An account with no commit is older than any commit, so it never replaces one, and a folder with a commit on record keeps it through a failed read and a rebuild. Only a `SKILL.md` that is a file is read from a folder: a pipe by that name no longer holds a collection.

- **A removed checkout's skills leave the reports** (lushly-dev/afd#2123). The collection keeps each project folder's last account of what the project holds, so that a folder on a volume that is away still speaks. A folder removed for good kept its account too, and every machine's report went on listing its skills, in `quiet` and with sizes. When a folder is read, the machine now records what it is kept on: its volume's mount point and number, as its links resolve, or a cloud drive's own folder. A folder known not to be there, on storage that is there, was removed, and its account is dropped at the next collection; the project then holds what its other folders do, or nothing, and its loads are still counted. Where that storage is away too, or nothing was recorded of it (an account an earlier botcore wrote), the folder may only be away, and it keeps speaking for thirty days from when it was first found missing. A folder the user may not look at is never taken as gone, and no longer stops a collection on Python before 3.14.

## [0.8.0] - 2026-11-22

Disk hygiene commands (`disk-report`, `disk-reclaim`, `disk-setup`, `disk-status`, `disk-run`, `disk-keep`/`unkeep`/`restore` and the `disk-hygiene` skill), cross-machine skill usage collection and trigger auditing (`skill-usage-collect`, `skill-usage-report`, `skill-usage-triggers`), managed host composition with plugin command policies, typed inputs, HTTP host serving and `remote-caller` profiles (`docs/host-composition.md`), the `gate-discipline` skill, Factory merge-queue and lane hardening, and security hardening across `botcore-llm`, `botcore serve` (stdio-only) and `docs_lint`. Includes breaking changes for `botcore-llm` bridging, shell allowlists and MCP server allowlisting.

### Breaking changes

- **`botcore_llm.bridge` takes a host.** `botcore_command_to_copilot_tool(command)` is now `botcore_command_to_copilot_tool(name, host)`, and `bridge_commands(names, namespace)` is now `bridge_commands(names, host)`; both raise `KeyError` for a name the host does not serve. To migrate, register the commands on a `CommandHost` with a `CommandPolicy` each (or build one with `botcore.build_host`) and pass the command names and that host instead of functions or a namespace dict.
- **A Pydantic-model parameter is nested in the tool's arguments.** A command taking one Pydantic model (`async def add(params: AddParams)`) is now called with `{"params": {"a": 1, "b": 2}}`, matching the host catalog's input schema, instead of the model's fields at the top level (`{"a": 1, "b": 2}`). To migrate, update prompts or tests that build tool arguments by hand to nest the fields under the parameter's name; models that read the tool schema need no change.
- **Command lists and pipelines in `shell_allowlist` are refused.** A command line such as `git status && git diff` was approved when every part matched; now each command must be requested on its own. To migrate, have the agent run each command separately.
- **A `shell_allowlist` program is matched literally.** A pattern whose first word holds `*`, `?` or `[` (such as `* status` or `*`) is refused when the configuration loads, and an empty pattern too. To migrate, write the program literally and pin it to a subcommand, for example `git status *` and `git diff *` instead of `git *`, which admits every git option.
- **MCP tools need named servers.** `allow_mcp` (still `true` by default) now admits only servers listed in the new `permissions.mcp_servers`, which defaults to none: a session offers no MCP tools and refuses every MCP request until servers are named. To migrate, add `mcp_servers = ["<server>"]` to each agent's (or the LLM plugin's) permissions for the servers it should use.
- **Sessions hide the runtime's tools that are not on the session allowlist.** Each session now sets the runtime's `available_tools` to the bridged tools, the runtime's session-local built-ins, the read-only `lsp`, the shell built-ins when `allow_shell` is set (none that types into a running process) and the file built-ins, `apply_patch` among them, when `allow_filesystem` is. Any other tool the runtime would offer, such as `web_fetch` or a tool from an MCP server in the user's Copilot configuration, is hidden from the model. To migrate, bridge the command the agent needs as a tool, enable `allow_shell` or `allow_filesystem` for those built-ins, or name the MCP server in `permissions.mcp_servers`.
- **Shell requests are refused on an unknown platform.** With a `shell_allowlist`, a shell request is refused unless the runtime's shell is POSIX (`os.name == "posix"`) or Windows PowerShell (`os.name == "nt"`), since Botcore cannot check another shell's quoting, and it is refused when the runtime sends no parse of the command. To migrate, run the agent on macOS, Linux or Windows, or leave `shell_allowlist` unset (with `allow_shell`, every command is then approved, as before).

### Added

- **`disk-reclaim`** (CLI and `disk_reclaim` over MCP) carries out what `disk-report` plans, as a dry run unless `--apply`: tier 0 prunes tool caches with their own commands (`uv cache prune`, and `pnpm store prune` only where pnpm uses hard links, since with clones it would empty the store) and clears aged cache folders from the machine settings; tier 1 strips build output from idle worktrees. Right before each deletion it checks again that the worktree is idle and unused and the path is still ignored and untracked; it never follows a link or junction, and under low space it also strips `when = "pressure"` patterns and lowers the idle threshold in steps. One run per machine, with a receipt and a status file for each (#1689).

- **`disk-report`** (CLI and `disk_report` over MCP) lists every worktree of the repositories a machine registers, with how long each has been idle, whether a process is using it, and the build output its `[disk].regenerable` patterns name and could free; plus watched volumes, tool caches and aged cache folders. It is read-only. A repository's patterns come from a new `[disk]` section in `botcore.toml`, read from its main checkout's commit rather than a worktree's branch, and a machine's settings from its own `disk.toml` (#1688).

- **`disk-setup`, `disk-status` and `disk-run`** schedule disk hygiene on macOS (a LaunchAgent), Windows (a Task Scheduler task for the user, without elevation, hidden, also on battery) and Linux (a systemd user timer, or crontab). `disk-setup` registers the repository and records the volumes that hold its worktrees and T3 Code's worktree folders, with their identifiers and low-space thresholds; `disk-run` checks free space hourly and reclaims daily or as soon as a volume runs low, notifying once a day while space stays low; `disk-status` reports a stale or failing job, which session preflights can read (#1690).
- **The `disk-hygiene` skill** tells agents to free space with these commands rather than by hand, and what never to delete (#1691).

- **Tier 2 of `disk-reclaim`** removes finished worktrees: ones T3 Code does not manage, idle for a week, holding nothing unique (no changes, no operation in progress, the commit on a branch or remote, no ignored file that is not rebuildable or an unchanged declared copy) and whose work has landed on the landing ref (an ancestor, or every changed file matching it). It uses `git worktree remove` without `--force`, keeps the branch, rechecks everything just before, and records each removal; `--include-restorable` also removes those that have not landed. The hourly job does this only after `disk-setup --remove-landed` (#1694).
- **`disk-keep`, `disk-unkeep` and `disk-restore`**: protect a worktree until a date with a `git worktree lock` every disk command honors, release only such keeps, and recreate a removed worktree at the same path and commit (#1694).

- **`skill-usage-collect`** also reads Claude Code's own transcripts, so a session that never ran under T3 Code (one started in the Claude desktop app or from the command line) is counted. A tool call T3 Code ran is left to T3 Code's store, told by the program that started the session or by the call's id, which the store holds too, so a load both sources show is one load. Only a transcript that changed is read again; a load leaves the record only when its call is read again and is no longer one, so what Claude Code has cleared keeps what was collected; and a transcript that cannot be read whole is left as it was. A session is filed under the repository it ran in, or as `unknown` outside one. `BOTCORE_SKILL_USAGE_CLAUDE_DIR` names the transcripts folder, and an empty value turns the source off. `sources` in the result says what each source did (#1820).

- **Skill usage on every machine.** The hourly job that `disk-setup` installs now runs `skill-usage-collect` after the disk work, for at most five minutes; a failure there never fails or holds the job, and `disk-status` warns of it at once and reports it as a problem once it has failed for a day. A machine names itself and a folder every machine can see in its machine settings (`skill_usage_machine`, which `disk-setup` writes down from the hostname, and `skill_usage_shared`; `skill_usage_collect = false` turns the hourly collection off). Collection then also writes what it read of the machine's record to its own folder there, and `skill-usage-report` and `skill-usage-triggers` read every machine's record, each session once, naming a machine whose record is old. A copy that a sync has only partly delivered is not read, and is named. Botcore neither creates nor syncs the shared folder, and a machine never writes over another record's folder (#1818).

- **`skill-usage-triggers`** reports, for each skill a repository requires, the changes merged to its default branch that touched the skill's paths and whether the session that opened each one's pull request had loaded the skill by then, naming the pull request and session of each miss. It judges only from what is recorded outright (git's merged changes, which session opened a pull request and when, and that session's loads); a change it cannot judge is counted as unknown with the reason, never as a miss. A change whose pull request a script opened, as a fleet's merge lane does, is unknown (#1887). A repository declares its required skills as `[[skills.required]]` in its botcore configuration, with `skill` and `paths` (#1817).
- **`skill-usage-collect`** also records, for each session, the session it came from (the one that delegated it, or the one it was forked from), and for each pull request linked to it or its subagents, when and whether the session opened it. Collect again after upgrading, so that the record says so.

- **`skill-usage-collect`** adds the skill loads the harnesses recorded to this machine's record, so that skill use can be measured without a hook in a skill or a report from an agent. It reads T3 Code's local store, read-only and from one snapshot, which covers its Claude and Codex threads: the Skill tool, a file tool or shell command that shows the agent a `SKILL.md` (`git show <revision>:<path>` included), and a message the person wrote that opens by naming a skill. It also records every session with the pull requests linked to it, and each change a session made to a skill's files. The record holds the skill, time, harness, model, project, session and agent, and never a prompt, a command, a title or file contents. A changed store layout is reported as `SOURCE_SCHEMA_CHANGED` with nothing lost, and `--rebuild` replaces what an older botcore recognised (#1815).
- **`skill-usage-report`** shows, per skill, the sessions that used it out of the sessions the project had, loads, harness, model, machine, agent, how it was loaded, the sessions where the person asked for it, the most context it can have cost and what it adds to every session's skill listing; and lists the skills a checkout holds that nothing used. A renamed skill keeps one identity, from the renames in the project's git history. A session that edited a skill, or that read most of a project's skills, is not counted as using it. `--ending-days-ago` compares two periods, and a project, harness or skill the record has never seen is refused instead of answered with an empty report (#1816).

- **Plugins declare their command policies.** `PluginRegistry.add_policy(name, policy)` and `add_policies({...})` declare the `CommandPolicy` of each command a plugin registers, so a host no longer passes every one to `build_host(policies=...)`. `build_host` refuses a policy for a command the declaring plugin did not register. An explicit host policy for the same command may only narrow the plugin's: effects among the plugin's, every confined path kept, no always-present effect left out; anything else refuses construction. The plugin's per-argument effects still decide each call, and a call whose effects fall outside the host's set is `EFFECT_DENIED`.
- **The catalog carries what a model needs.** `CommandHost.catalog()`, and so the managed CLI `catalog` and MCP `start`, gives each command a one-line `description` (the docstring's first line) and an `input_schema` derived with Pydantic from the handler's signature and type hints: required inputs, defaults, `Literal` enums, optional, list and dict types, and per-input descriptions from Google-style `Args:` or Sphinx `:param` docstrings, each capped at 200 characters. `DirectClient.list_commands()` reports the same one-line descriptions instead of whole docstrings.
- **`build_host(..., kebab_names=True)`** serves every command under AFD's kebab-case name (`info-workspace`) instead of its Python function's; existing hosts keep their names.
- **A `remote-caller` execution profile** for callers a surface authenticated over the network: it admits `inspect`, `service` and `history-write`, never a subprocess, a source or release write, or raw Python. `botcore.context.PROFILE_EFFECTS` lists each profile's effects.
- **Hosts served over HTTP.** `botcore.host_http.create_host_http_app` serves several managed hosts from one process, one route each, behind per-caller bearer tokens: `call`, `catalog`, `docs/<topic>` and an optional `uploads` route, every answer a CommandResult. `serve_hosts` binds only to loopback or a tailnet address unless told otherwise. `botcore.host_tokens.TokenStore` keeps only token digests in an owner-only file, and `botcore host-token issue|list|revoke` manages it on the serving machine. `botcore.host_client.HostClient` and `create_remote_cli` call a served host with the standard library and report an unreachable one as its own error code, never an exception (`docs/host-composition.md`, "Serving hosts over HTTP").
- **The Factory plugin's command lines.** `factory` and `factory-cell` (installed with `botcore-factory`) call the plugin's two hosts over the real world for the checkout they run in: `catalog`, and `call <command> '<json>'`, which prints the CommandResult and exits 1 on a refusal.
- **A context per call.** `CommandHost.execute(name, args, context)` hands middleware the surface's AFD `CommandContext`, or builds one with a trace ID, AFD's system clock and random source, and the host's `actor` (`CommandHost(..., actor=...)`), so AFD's journal middleware runs behind the host and records the caller. Handlers read it with `botcore.context.current_call()`.
- **`gate-discipline` skill.** Rules for adding, changing or exempting a quality gate, shared with Lushly, whose `lushly-gate-discipline` it generalizes: watch a gate fail on a planted violation before trusting it, assert properties rather than shapes, make exemptions expire, prove a tolerance reaches what it exempts. It ships three scripts that need only Node and git. `scripts/check-test-quarantine.mjs` fails on `.only` and on an unconditional `.skip`, `.todo` or Playwright `.fixme` with no entry (owner, reason, issue) in `scripts/policy/test-quarantine.json`, and on an entry whose test recovered; conditional skips (`skipIf`, `runIf`, Playwright's `test.skip(condition, reason)`) need none. `scripts/check-test-configs.mjs` refuses Vitest's `passWithNoTests` in a configuration and its flag in a `package.json`, workflow or Lefthook configuration. `scripts/report-test-changes.mjs` is a report, not a gate: it compares each changed test file with the branch's merge base and lists a test or scenario file deleted, fewer tests or assertions, a skip added (a whole file's, one made unconditional and a new file born with an unconditional one included), an assertion line changed, exact matchers traded for loose ones, and a snapshot that lost lines, a runner config (Vitest, Vite, Playwright, Jest, pytest, a tests `CMakeLists.txt`) or the quarantine register changed, in JavaScript and TypeScript, Python, Rust, C++ and `*.scenario.yaml` (lushly-dev/afd#1387). The README's skill table now lists all eleven skills; it had left out `bloat-sweeper`.

- **`disk-report` warns when a repository has too many idle worktrees** (lushly-dev/afd#1695). Each repository gets `idle_worktrees` (linked worktrees idle `strip_after_days` or longer; kept ones and Factory's slots aside) and, past the machine's new `idle_worktree_limit` (20; 0 turns it off), a `warning`, also in the report's `warnings`. Each reclaim stores every repository it counted fully, after taking off what it removed, so a run that ran out of time or covered one repository leaves the others' as they were. `disk-status` lists them under `warnings`, never as a problem, and Factory's `lane-status` shows them to the foreman as `diskWarnings` before it starts cells.
- **`disk-setup` and `disk-status` check where Cargo puts build output.** Cargo's config files are read as Cargo reads them for each registered worktree (every `.cargo/config` or `config.toml` from the worktree up, then `$CARGO_HOME`'s, with includes; values taken literally), plus `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR`. Output moved out of the worktrees needs an `[[aged]]` folder that clears it: the warning gives the exact entry only for a per-workspace folder that holds nothing but Cargo output, and asks for a `max_gb` cap on one folder shared by every workspace. `disk-setup` also watches that folder's volume.

- Factory's `host.buildDir` dial names where the lane's slots build Rust: each slot's jobs get their own `CARGO_TARGET_DIR`, removed when the slot takes another branch or its branch leaves the queue (#1641).
- Factory's `gate-allow` and `lane-drop` take an optional `session`, guarded as `ejection-excuse` is (#1633).

- **The Factory lane and gateway work where the base branch takes merges only through GitHub's merge queue** (lushly-dev/afd#1598). A required queue answers a merge request by queueing the pull request: `gh pr merge` exits 0 with the pull request still open, and the REST merge is refused. Both now read what GitHub did, and neither is configured: the queue is found on the pull request, so the same code is right before and after a queue is turned on.
  - **The lane** reads the pull request before and after asking (`merge_progress`). Where its base has a queue it adds it with GraphQL `enqueuePullRequest`, bound to the validated head, instead of `gh pr merge`, which sets auto-merge there when a check has not finished. Merged, it lands as before. Queued, its entry waits at the front in the new state `merge-queued` (`lane-status` shows `mergeQueue {since, queuedAt, state, position, groupHead}`), nothing behind it is pushed or merged, the base is not followed (GitHub locks a queued pull request's branch, and the queue runs the required check on exactly what lands), and the wait is bounded by `lane.checkTimeoutMinutes`, after which the lane pauses with a `lane-error` and leaves it queued. It lands when GitHub says `MERGED` (the `merged` record carries `mergeQueue` and `queueMinutes`). A pull request read out of the queue and still open a minute later is ejected (GitHub logs a merge as a removal a second before the pull request reads as merged, so one whose removal says `merged` is never ejected: still open five minutes on, the lane pauses): `ci-failed`, which counts toward `cells.maxEjections`, when GitHub gives `failed_checks` or the required check failed on the commit the queue built, with any `Co-authored-by:` line of the queue's squash quoted in the detail (read from the removal's own commit); `merge-failed`, which does not count, otherwise. A stopped or restarted lane resumes the wait, a read that fails after the request leaves the entry `merge-queued` so the same head is never asked for twice, a pull request found queued at a head the lane did not validate pauses it, one that merged at another head lands with `headMoved` and a `merged-without-check` event, an open one whose last removal says `merged` is waited for and never asked for again, and `lane-drop` and `lane-enqueue` refuse a queued branch as `MERGE_QUEUED`.
  - **The gateway's `pr-merge`** never merges directly there. It adds a pull request whose required check passed to the queue itself (`enqueuePullRequest` with the expected head, which sets no auto-merge), sets auto-merge bound to the head on one whose check still runs, which GitHub turns into a queue entry when it passes, and answers `state: queued` with `mergeQueue {required, queued, state?, position?}`. `pr-status` carries the same `mergeQueue` while the pull request is open, with `removed {at, reason}` once a queue let it go, and `cancel` takes it out of the queue and answers what GitHub then shows (`STILL_QUEUED` when it is still set to merge, with GitHub's refusal when it gave one). `PR_CLOSED` and `NOT_QUEUED` answer a request whose pull request closed or shows nothing for it. Not yet tried on GitHub: a pull request the gateway's App opened may get the owner as a co-author in the queue's squash, so until that is tested the gateway should not serve a repository that has both a merge queue and a check that refuses co-authors.

- **The Factory lane refuses work when the disk is short** (lushly-dev/afd#1565). A new dial, `host.minFreeDiskGb` (default 20), is the free disk kept where the lane's slots build, beside the checkout in `<repository>.factory-slots`. Below it, `cell-register` refuses `DISK_LOW`, `lane-status` gives `canStartCell: false` with the reason, and the lane pauses with a `lane-error` before it starts a validation, ejecting nothing; a free disk that cannot be read refuses `DISK_UNREADABLE` the same ways, and `0` turns the check off. Each names the dial and the slots directory, whose build output (Rust target directories among it) is what fills the disk. A full system disk had ejected a good branch mid-build.
- **A superseded foreman session is refused `FOREMAN_STALE`** (lushly-dev/afd#1595). A session that another one took the lane from, after its lease ran out or through `foreman-handoff`, can no longer `cell-register`, `ejection-excuse`, `dial-set` or wait as the foreman, even with no lease held. A scheduled foreman that woke after a usage-limit reset had taken an expired lease and acted on an outdated brief after a newer foreman had done the work.

### Changed

- **Provenance digest at build time**: the repository's `provenance/provenance.json` no longer
  commits the sha256 of `adaptations.json`, whose one line made any two branches that recorded
  different files conflict. A new build hook (`hatch_build.py`) stamps it into the wheel's and
  sdist's `provenance.json`, computed from the `adaptations.json` they ship, so the published
  records are unchanged; `scripts/verify_provenance.py --artifacts dist` checks a build
  (lushly-dev/afd#1610).

- **`skill-usage-triggers`** calls a change a miss only once every machine's record reaches the change's merge; until then it is unknown (`incomplete_record`), and the report names the machines it waits for. A machine the owner knows is switched off is named in `skill_usage_away` and is then not waited for. It also reads a skill's renames from the checkout it is given, and allows five minutes between a machine's clock and the forge's.
- **`skill-usage-collect`** refuses a machine name that cannot name a folder and a shared folder that is not a full path (`INVALID_INPUT`), and machine settings it cannot read (`MACHINE_SETTINGS_INVALID`). It reads a thread that was moved to the machine from its start, names a project of a store copied from another system by its folder, never by the whole path, and takes a half-written event that an interrupted collection left at the end of the record off it, instead of keeping it as a line that cannot be read.

- **`skill-usage-report`** counts only the kinds of event it knows as loads, so a record a newer botcore wrote to is not misread.

- **The code-reviewer skill checks what a change did to its tests** (2.1.0). A test deleted, skipped or loosened with no stated reason that the diff bears out is a BLOCKER, and a bug fix with no test seen failing before it is an IMPROVEMENT. It reads the gate-discipline skill's test-change report where that skill is seeded.
- **The docs-manager skill says how to edit AI-assisted prose.** Its prose guidance (2.2.0) now covers the order to work in (substance before wording), the formulas to audit for, which outlast word lists, rewriting a flagged sentence instead of swapping a synonym or writing to a detector's score, and checking that a rewriting pass kept quotations, numbers and caveats.
- **Wrong arguments are refused with the way forward.** On the CLI, MCP and DirectClient surfaces alike, an argument the handler does not take, or a missing required one, is refused before binding with `VALIDATION_ERROR` (was `INVALID_TARGET_OR_INPUT`). Its details list `expectedFields`, `unexpectedFields` and `missingFields`, and its `suggestedFields` and suggestion name the input a wrong key most likely meant: the same name in another case convention (`timeoutMs` for `timeout_ms`), else the closest name.
- **Either spelling of a command name calls it, and a wrong one is answered with the closest.** A host still serves the names it registers; a call may use the other spelling (`issue_claim` for `issue-claim`). Registering both spellings of one name is refused as a duplicate (was an ambiguous raw-Python alias at MCP server construction). `COMMAND_NOT_FOUND` names the closest served command in its message, suggestion and `details.suggestedCommand`.
- **Inputs are type-checked.** After the names, each input is validated against its type hint with Pydantic's lax mode: a model-typed input arrives as the model, and a value that fails is `VALIDATION_ERROR` with `details.invalidFields` (each field's path and problem). Values that used to pass through unchanged are now coerced or refused: `dev_lint` with `fix: "false"` now means no fix (the string was truthy, so it computed `source-write`), a number sent to a `str` input such as `path` or `package` is refused before confinement, and `true` sent to an `int` input arrives as `1`.
- **The Factory lane validates again only when a moved base can touch what it validated.** When the base moved under a validated branch, the lane advances the branch to the new base without a new validation if the base's changes touch none of the adapter's `shared_paths` or `gate_paths`, the validated head merges onto the new base without a conflict (`git merge-tree`), and the units the base's changes affect share none with the branch's, as the adapter's new `units` command names them; otherwise it validates again, the `rerun` record saying why in `detail` (#1350). An advance is a `base-advanced` record (records `SCHEMA` 2), counted by `lane-report` as `baseAdvances`. After a merge that advanced so, the lane reads the check runs and workflow runs (`workflow: <name>`) the adapter's `main_checks` selects on the merge commit, each name's worst state across workflows. One failing raises `main-broken` with `reason` `unchecked-merge` naming those PRs, and pauses the lane; checks that do not finish within `lane.checkTimeoutMinutes` are one `lane-error`, and the lane stops watching that merge. The PR body names the base the branch was validated on and the base it advanced to. Without `units` a moved base is always validated again, as before.
- **A Factory repair that updates its base is no longer refused for main's gate changes.** `GATE_EDIT_IN_REPAIR` compared the repair with the ejected head, so a rebase or merge of the base counted every gate file main had changed in between as the repair's (lushly-dev/afd#1374). It now counts a gate path only when the branch's own change to it differs from its own change at the ejected head (`git patch-id --verbatim`, so re-indenting counts), or the repair takes back a gate change it had made. Both sides are measured from a base the lane fetches itself with an explicit refspec, never a ref or refspec in the cell's worktree such as `origin/HEAD`; the diffs are read as plain patches whatever the shared git config says (no colour, external diff or text conversion, and three lines of context, so a moved line is still a change), and a patch `patch-id` cannot read refuses rather than compares equal; and renames are read as both paths, so a gate file renamed out of the gate globs still counts. Main editing next to the branch's own gate lines changes their context and still refuses (fails closed). When the edits cannot be read, the new refusal `GATE_CHECK_FAILED` holds the repair. The world's git gains `repair_edits(worktree, base, since, keep)`; `changed_files` now reads renames as both paths and paths unquoted, and `fetch_base` fetches `+refs/heads/<base>:refs/remotes/origin/<base>` explicitly. Origin itself (`remote.origin.url`) is still read from the shared config: the lane trusts the checkout's remote.
- **An ejection names the failure, not a passing test.** The lane's `ejected` detail took the first line that mentioned a failure, which could be a passing test named for one (lushly-dev/afd#1373). `first_lines` now puts first the first test a runner marked failed (`✖`, `FAIL`, `not ok`, an `AssertionError`), then `pnpm verify`'s summary rows for failed suites, the runner's other failed tests, then exception lines (`Error:`, pytest's `E`); lines a runner marked passed are never taken, also behind a `pnpm -r` prefix (a path, then the script), unless they also carry a failure mark, and ANSI colours are stripped.
- **The units command runs at the base it compares.** When the base moves, the lane ran the adapter's `units` command in the lane host's own checkout, which may be dirty or at another commit (lushly-dev/afd#1354). It now runs in a clean `units` slot beside the checkout (`<checkout>.factory-slots/units`), checked out at the new base; a slot that cannot be prepared validates the branch again.
- **The Factory lane stops starving a branch that affects every unit.** A branch that maps to every unit (a lockfile change) overlapped every move of the base, so the lane validated it again each time the base moved, for ever when the base moved about as often as a validation took (lushly-dev/afd#1369). After the new dial `lane.maxBaseReruns` (default 2) main-moved reruns of one attempt, a move after which the validated head still merges cleanly and whose changes touch none of the adapter's `gate_paths` is no longer validated again locally: the branch advances (`base-advanced` with `reason` `rerun-limit`), is pushed at its validated head, and the PR's `required_check`, which runs on the pull request's merge ref, stands in. The merge is still bound to that head and watched on the base through `main_checks` like any advance; a conflict or a gate path still validates again. The check runs onto a base no older than the one at the push: a later move past the limit merges on that check, and the `base-advanced` and `merged` records name it as `checkBase`. `lane-report` counts `rerunLimitAdvances`, and the `merged` record carries `checkStoodIn`.
- **The Factory lane validates on the Node `.nvmrc` names.** Validation and coverage jobs put that Node's bin directory, found where fnm or POSIX nvm installed it (the newest matching version), first on `PATH`, so `pnpm verify` no longer runs on the lane host's default `node` (lushly-dev/afd#1341). `lane-start` refuses `NODE_MISSING` when it is not installed, with the `fnm install` to run, and `NODE_UNPINNED` when `.nvmrc` holds an alias such as `lts/*`; a slot whose `.nvmrc` names a Node the host lacks pauses the lane instead of validating on another one.
- **Four modules over 500 lines are split, with no behaviour change** (lushly-dev/afd#514). `botcore.commands.cdp.diagnostics` keeps screenshot, console, network, eval and emulation; trace capture moves to `cdp/tracing.py` and trace queries and summaries to `cdp/trace_analysis.py`. `botcore.commands.dev.quality` moves dependency discovery and PyPI checks to `dev/dependencies.py` and `dev_check_lockfile` to `dev/lockfile.py`; `botcore.commands.dev.analysis` moves Python import scanning to `dev/import_graph.py`. In `botcore-agents`, connector resolution moves to `capabilities.py`, target resolution to a `targets.py` mixin and snapshot, restore and autosave to a mixin in `state.py`. Every name the four modules exported still imports from them, the moved code logs under the logger names it used before, and the `max-lines` overrides on `diagnostics.py` and `orchestrator.py` are gone. Code that monkeypatches a moved helper must now patch the module that defines it.
- **Only a Factory branch's own failures count toward its ejection limit.** A `conflict` (main moved under it) and the push, PR and merge plumbing (`push-failed`, `pr-failed`, `merge-failed`) still eject, but no longer count toward `cells.maxEjections`: the `ejected` record carries `counted` and `excuse`, the event `excused`, and `ejection-limit` is raised only by the branch's own failures. The new foreman command `ejection-excuse {branch, reason, session?}` marks a cell's latest ejection as not the branch's fault (a known flake), records `ejection-excused`, and answers an open `ejection-limit` once the count is under it; it refuses `ALREADY_EXCUSED` for one already excused. `lane-status` shows each cell's `excused`, `countedEjections` and `lastEjection`, and `lane-report` counts `ejections` and `excusedEjections`. Records `SCHEMA` is 3 (two new kinds).
- **Past `lane.maxBaseReruns`, main's workflow and CI gate changes no longer force a new validation.** The PR's required check runs on the merge ref with main's own workflows and gates, so it stands in for them too. The adapter's new `revalidate_paths` names what it cannot stand in for (AFD: lockfiles, dependency manifests and toolchain pins such as `.nvmrc`); main changing one still validates again. Without it, every `gate_paths` change validates again as before. The watch on main's checks after the merge is unchanged.
- **Factory cells start only on a Claude plan** (lushly-dev/afd#1498). Cells implement on Opus 5.5 by AFD's model routing of 2026-11-17, but `cell-register`, `lane-status` and `plan-list`'s `next` chose among every plan, so a roomier ChatGPT plan won. They now choose among Claude's plans while the new `cells.claudeOnly` dial is on (the default), and with none `cell-register` refuses `NO_CLAUDE_PLAN`, `lane-status` says why it cannot start a cell, and `plan-list`'s `next` is null. An empty plan list is `PLANS_UNREADABLE` from every reader. Claude's `seven_day_fable` window is no longer read as a plan: only Fable draws on it, inside the main weekly window an Opus cell spends.
- **The Factory lane assigns the plan whose room most needs spending before its reset.** `cell-register` and `lane-status` chose the plan with the most room (share of the window elapsed minus share used); they now choose the highest pace: the room below `plans.ceiling` over the days until the plan resets, so every plan is spent by its own reset. `plan-list` shows each plan's `left` (room below the ceiling), `pace` and `daysToReset`, and `next`; `lane-status`'s `plan` carries its `pace`. `plans.ceiling` and `PLAN_ABOVE_CEILING` are unchanged.
- **A validated Factory branch keeps its validation when it gives its slot to the front of the queue** (lushly-dev/afd#1452). It was validated again from scratch (`rerun`, `slot-needed`). Its checkout now moves aside (`git worktree move` to `<checkout>.factory-slots/kept-<branch>-<hash>`, keeping the git directory where `pnpm verify`'s record lives, so its push is still accepted), it stays `validated` on its base, and the usual base checks at the front decide whether it runs again. A `slot-released` record names the move; the kept checkout is removed once nothing needs it: moved aside, then `git worktree remove --force` in a detached process, which unregisters that checkout alone. When the checkout cannot move, the validation is given up as before. The world's git gains `park_slot` and `remove_checkout`, and `lane-status`'s `slots.busy` leaves out a branch that gave its slot up.
- **The Factory lane's report counts merges by plan.** A merge now records the cell's plan with its route, so `lane-report`'s `byPlan` is filled (it was always empty).
- **The Factory lane validates beside the checkout, not inside `.git`.** Its slots are `<checkout>.factory-slots/<n>` (were `.git/factory/slots/<n>`): TypeScript refuses some declarations in a project whose path has a `.git` segment (TS2883), so AFD's typecheck failed in the slot and ejected branches that pass everywhere else.
- **The Factory plugin's `REVIEW_MISSING` says why.** `lane-enqueue` adds the first line the adapter's `review_evidence` command printed, such as which commit the recorded review covers, and a verifier that cannot run or exceeds 120 seconds is `REVIEW_MISSING` with its reason (was `READ_FAILED`, or no limit). AFD's adapter now names `scripts/review-record.mjs verify --head {head}`, which `prepare-pr`'s lane mode feeds, so AFD branches can be enqueued.
- The MCP `call` tool calls as an agent (`Actor(kind="agent")`) unless the host names its actor.
- Effects a call computes beyond its policy's declared set are `EFFECT_DENIED` (was `INVALID_TARGET_OR_INPUT`).
- A host no longer warns about a `[plugins.<name>]` section for a plugin it did not select: that section configures another host's plugin, which may be installed in another environment. `load_config(..., selection=True)` says the plugins passed are a host's selection; legacy discovery of every installed plugin still warns about a section no installed plugin reads.
- **`docs_check_agents` asks only for what AGENTS.md owns** (lushly-dev/afd#1128). A routing AGENTS.md no longer lists packages, skills or workflows, so the check stopped asking for an entry for each new one. `needs_update` is now set, when AGENTS.md is not staged, for a new top-level directory it does not name, and for a path, skill name, command or workflow file name, or directory (`dir/`) it cites that the change removes or renames (`owned_changes`). Paths are read relative to the workspace, which may sit below the git root. Staged command modules and new packages, skills and workflows are still reported in `structural_changes`, as advice.
- **The Botcore workflow lints and tests more.** Ruff now checks `packages/` whole (tests included), `botcore-connectors` and `plugins/botcore-teams`, and the sibling packages' tests (`packages/*/tests`), which nothing ran, run in `scripts/package_tests.py`, one pytest process per package. A `packages` dependency group adds the GitHub Copilot SDK that botcore-llm needs (lushly-dev/afd#1359, #1356).

- **The lane authors its merges of the base as the branch's own author**, the author of its newest commit that is not a merge, with `--author`, so neither `GIT_AUTHOR_*` nor the host's git configuration decides it. It still commits them as `botcore-factory`. A merge queue writes the squash message itself and takes no body, and GitHub's own message credits every commit author but the pull request's as a co-author: authored as `botcore-factory`, each of those merges would have put a `Co-authored-by:` line into the queue's squash, which a base that refuses co-authors (AFD's `ci-ok`) removes from the queue within a minute. Merging directly, the lane still passes its own body (`squash_body`).

### Fixed

- **`disk-setup`** writes a setting that holds a character outside the basic plane as TOML reads it; before, the next run refused the file.

- **The Factory's squash merges no longer credit a co-author** (lushly-dev/afd#1515). Every squash the plugin makes (the lane's `gh pr merge`, and the gateway's merge and pinned auto-merge) now passes the branch's own commit messages as the commit body. Merge commits and `Co-authored-by:` lines are left out, and each commit keeps its own `Assisted-by:` trailer. Without a body, GitHub wrote its default message. That message credited `botcore-factory`, under which a cell commits its base merges, and any commit author whose address wasn't the merging account's, as a co-author on `main`. A branch of merge commits alone keeps their messages, so the body is never blank. The plugin's processes now get stdin as UTF-8 bytes, so a body (or a blob it hashes) keeps its LF on Windows, where a text-mode pipe made it CRLF.
- **A branch that deletes `.nvmrc` is ejected from the Factory lane, never validated on the host's default Node** (lushly-dev/afd#1505). Without `.nvmrc` in its slot, validation fell back to whatever `node` came first on the lane host's `PATH`, which can differ from the Node `ci.yml` tests pull requests on. When `.nvmrc` is among the files the branch changes against the base and the slot holds none, the lane ejects it as `node-missing` with a `NODE_MISSING` detail saying the repository pins its Node in `.nvmrc` and the branch must keep it; a branch that leaves `.nvmrc` blank is ejected the same way and told to pin a version number.
- **`lane-start` checks the Node validation runs on, and a branch's own `.nvmrc` bump no longer pauses the Factory lane** (lushly-dev/afd#1352). `lane-start`'s `TOOLCHAIN_MISMATCH` check read `engines.node` and `pnpm` from the host's default `PATH`, which could disagree with the `.nvmrc` Node the lane validates on; it now reads both with that Node's bin directory first on `PATH`, as a validation job runs them, so `pnpm` is the one installed beside that Node when there is one. `lane-host-probe` lists a missing `.nvmrc` Node among what the host lacks. nvm-windows installs (`NVM_HOME`, the directory `NVM_SYMLINK` points into, `%APPDATA%\nvm`) are searched alongside fnm and nvm. A branch whose own `.nvmrc` names a Node the lane host lacks, or an alias, is ejected with the new cause `node-missing` and a `NODE_MISSING` detail (keep the base's `.nvmrc`, or have that Node installed on the lane host), so the other branches keep merging; the base's own `.nvmrc` missing its Node still pauses the lane.
- **The bloat-sweeper skill's gaps found adopting it in Lushly** (1.1.0, lushly-dev/afd#1124). A new `[sweep] include_names` (`SweepConfig.include_names`) lists file-name patterns measured although the default skips them, such as `"*.stories.*"` for a repository whose size limit counts stories; the default skipped names, skipped directories and `exclude` still apply. `bloat` prints each repository measure as `label: value` in its report header, not only in the `--record` comment. Skills Botcore seeded under `[skills] source_dir` (`metadata.source: botcore`, or a top-level `source: botcore` in older copies) are no longer measured, so a consumer's sweep no longer ranks the skill's own `scripts/sweep.mjs`. `bloat --area` with an area that holds no measured source is refused with the likeliest areas meant (was an empty report), and `area` prints the whole rotation after this week's area, which stays alone on the first line. `trend` reads only comments the authenticated `gh` user wrote, keeps only records whose values are all numbers (an ISO date and a commit hash aside), and labels measures only from the current `measures` command, so another commenter on the trend issue can no longer inject text into its output or forge a NOT KEEPING UP verdict. A repository measure can no longer take over a key `bloat` records itself, such as `date`.
- **The Factory lane merges provenance records instead of ejecting the branch.** Two branches that edit an imported unit both change its provenance records, so a merge conflicted in the records alone and cost the branch a repair round trip; round 2 lost three validations to it (lushly-dev/afd#1410). The adapter's new `regenerate` entries (`name`, `paths`, `run`) name generated files: when a merge of the base conflicts only in them, the lane runs `run` in the slot while the merge is open, then commits it and validates the result; the `validation-started` record names what was regenerated. A `run` that refuses still ejects as `conflict`, with its reason; one that cannot run pauses the lane. The world's git gains `merge_main(..., keep_open)`, `finish_merge` and `abort_merge`. AFD's adapter runs the new `scripts/provenance-merge.mjs`, which merges each unit's records three ways (rows by path; a file both sides recorded takes the merged file's hash and both reasons), recomputes each manifest's sha256 and copies Botcore's mirror; a value both sides changed differently is still a conflict, and so is a file both sides recorded whose hash is not of its raw bytes (a manifest recorded by its shape, Violet's released files). Health's records, whose rows live in `provenance.json`, are not merged. The lane commits that merge without running the repository's hooks, as a clean `git merge` runs none.
- **One foreman per lane.** Two foreman sessions could run on one lane and race for seats, events and dials (lushly-dev/afd#1432). `cell-register`, `lane-wait` as `foreman` and `dial-set` take an optional `session`: the first takes the lane's lease (`lane.foreman`, shown by `lane-status`) for the new dial `foreman.leaseMinutes` (30), each renews it, and a waiting foreman keeps it when its wait has a timeout. While it is live, another session's foreman calls, and a foreman call naming no session, are refused `FOREMAN_BUSY` with the holder and expiry, telling the session to stop and tell the owner. The new `foreman-handoff`, the owner's call, frees it by the holder's session, or by any once it ran out. The owner's `dial-set` without a session works as before.
- **A cell can take a package of related issues.** `cell-register` refused any second issue as unrelated whatever `cells.issuesMax` said, since `issue-check` never computes related issues (lushly-dev/afd#1431). It now takes up to `cells.issuesMax` dispatchable issues when the foreman passes `related_because`, saying what they share; the cell and its `cell-registered` record keep it as `relatedBecause`. Without a reason, or over the dial, it still refuses `TOO_MANY_ISSUES`, naming the fix. `lane-status` shows the reason, and a claim write that fails partway puts back the claims it wrote, so a package that failed on its second issue leaves no live claim on the first.
- **Resolving an agent's tools no longer drops the agents already created.** The first agent with connectors builds botcore's command namespace, which configures every discovered plugin again; `botcore-agents`' `set_config` then reset the orchestrator, so agents created before it were gone (lushly-dev/afd#780). The same configuration again now keeps the orchestrator; a different one still starts a new one.
- **The Factory lane checks each review itself, with the base's verifier.** `lane-enqueue` ran the adapter's `review_evidence` from the cell's worktree, so a branch that edited the verifier, its adapter or the plugin could enqueue without a passing review, and nothing checked again (lushly-dev/afd#1308). Before each validation the lane now runs its own `review_evidence` from a clean `review` slot checked out at the base (`<checkout>.factory-slots/review`), with the new `{worktree}` placeholder naming the cell's worktree recorded at enqueue. A refusal, a head that moved or a worktree that is gone ejects the branch with the new cause `review-unverified`, before it takes a validation slot; it is not a failing-check cause, so the repair may edit gate paths. The verifier refuses with exit code 3 (`scripts/review-record.mjs`'s `REFUSED`, was 1); any other failure, such as a crash, a timeout or a script broken on the base, pauses the lane instead of ejecting every branch, and so does an adapter whose `review_evidence` does not name `{worktree}`. The check runs before a validated branch gives up its slot to a branch ahead of it, so a refused repair costs it nothing. `REVIEW_MISSING` at enqueue is now fast feedback; the lane's check binds. AFD's adapter passes `--worktree {worktree}` to `scripts/review-record.mjs verify`, which reads the record of the worktree it names. A change to the verifier or `review_evidence` binds once it is on the base and the lane restarts. A branch ejected before its validation started no longer holds its slot for the rest of that step.
- **A relative `path` no longer crashes the dev and docs checks** (lushly-dev/afd#1355). `dev_check_size` and `dev_check_paths` raised an uncaught `ValueError` for a relative path, and `staged_only` matched nothing, also in a workspace below the git root. A relative `path` now resolves against the workspace (a managed host's context target, which never changes the cwd), or against the cwd when there is no workspace, in `dev_check_size`, `dev_check_paths`, `dev_dead_code`, `dev_circular_imports`, `dev_dep_graph`, `docs_lint` and the language resolution of the other `dev_*` commands; files outside the workspace are reported by their full path.
- **botcore-agents' test of wildcard connectors without `botcore-connectors`** expects `ConnectorIntegrationUnavailable`, which `start_agent` maps to `INTEGRATION_UNAVAILABLE`; it still expected an empty list (lushly-dev/afd#1359).

- **Botcore's quality gate passes on a clean `main`** (lushly-dev/afd#513). `scripts/check-portability.mjs` no longer flags the portability command's own pattern description and docstring or its test fixtures, which now carry `# portability-ok:` markers. The Botcore workflow's lint step also covers `packages/botcore-llm/src/` and `packages/botcore-memory/src/`. `ruff format` is compared against base only (`AGENTS.md`), and `SETUP.md` describes the gates AFD runs instead of the retired Botcore hooks.
- **Windows HTTP token stores are private and coordinated across processes.** New
  files and directories receive ACLs for the operator, SYSTEM and Administrators
  at creation; unsafe owners, ACLs and reparse points refuse access. Readers and
  writers share a native lock, preserving tokens issued by concurrent operator
  commands and avoiding read/replace races. Unix modes and `flock` remain intact.
- **The Factory gateway reads its GitHub App key on Windows** (lushly-dev/afd#1346). Windows
  reports every writable file as mode `0o666`, so the key was refused whatever its ACL. On
  Windows the key is now judged by the token store's rule: owned by and granted only to the
  service user, SYSTEM and Administrators, and not a reparse point. POSIX keeps `chmod 600`.
- The Factory plugin's lane loop pushes the exact validated commit from its validation
  checkout, retaining the worktree's pre-push verification record until the push. Completed
  slots stay reserved; an earlier repair or revalidation can release a later reservation
  without changing queue order. Install failures read the job's timeout boolean, GitHub
  policy refusals requeue only when the base actually moved, and git errors retain bounded
  diagnostics from both streams. On macOS, killed zombie processes no longer count as live
  lane holders. Cancellation also kills step descendants in separate POSIX sessions; PRs use
  the configured base, and terminal queue refs are retired with a lease so recovery cannot
  resurrect them. This is the lane-loop implementation slice; Phase 1 still needs a measured
  factory run.
- `skill_lint_spec` lists skills in the order `skill_lint` does on every system. On Windows it sorted their directories case-insensitively, so a skill named `Wrong` came after `clean` there and before it elsewhere.

- **`git gc` no longer makes every worktree look active** (lushly-dev/afd#1814). gc runs `git reflog expire --all`, which rewrites every worktree's `logs/HEAD` without adding an entry, and the disk commands read that file's time as the worktree's last activity: after a gc, the idle-worktree count fell to 0 and tier 1 and tier 2 waited again. A reflog's time is now the earlier of the file's time and its last entry's timestamp, and a reflog gc emptied because every entry expired counts for nothing. A last line that is not a whole entry gives the file's time, so text in a commit message is never read as a timestamp.

- **Tier 2 never removes Botcore Factory's lane slots.** Worktrees directly in the repository's own `<repository>.factory-slots/` are `managed_by: "factory"`: an idle slot could otherwise have counted as finished, and a parked slot holds its validation record.
- **An `[[aged]]` entry's age is read three folders deep**, not only from its first level: builds write deep inside (Cargo's build-dir is `<2 hex>/<hash>/<profile>/deps/...`), so a folder still in use could look a week old and be cleared, forcing a full rebuild.
- **A settings file written by `disk-setup` stays readable by an older botcore.** `remove_landed` and `idle_worktree_limit` are left out while at their defaults, since a botcore from before them refuses unknown keys.

- Factory's lane treats a validation or coverage run that fails on a full disk as its own trouble: it pauses and counts no ejection (#1641).
- Factory foreman commands check the session again inside the change they make, refusing `FOREMAN_LOST` once its lease is gone, so a wait left open by a superseded session no longer takes its successor's events (#1633).

- **A Factory lane ejection lists every failing test, not only the first** (lushly-dev/afd#1607). A change that broke tests in several binaries or suites cost one ejection per failure found. The lane now reads the failing tests from everything the validation job wrote to its log, not the 200-line tail it keeps for `detail`, so a failure early in a long run is not lost. It reads cargo (each `... FAILED` test with its crate and binary, doc-tests included), vitest (with the `pnpm -r` package and any browser project), pytest's `FAILED` and `ERROR` summary, node:test's list of failing tests, TAP, CTest and Playwright's list reporter. The `ejected` event's `lines` end with a count and up to 50 of them; the `ejected` record keeps up to 5,000 as `failures`, with the total as `failureCount`. A suite that failed without naming a test, such as a lint, is still named only by its summary row. The runner must run to the end for this to help: AFD's lane now validates with `pnpm verify --keep-going`, its local `cargo test` steps run with `--no-fail-fast` and its multi-package test steps with `pnpm --no-bail`.

- **An old lane behind a new merge queue recorded a landing that had not happened.** It took `gh pr merge`'s exit 0 for the merge: it wrote the `merged` record and event, removed the cell and deleted the queue ref while the pull request was still open in GitHub's queue, and never learned of one the queue then removed.

- Factory's `lane-wait` wakes the foreman only for open events it has yet to deliver to that consumer (#1608).

- **Factory `lane-enqueue`**: a `PREQUEUE_FAILED` refusal now names the adapter's `install`
  command in its suggestion and in `details.install`, so a cell whose new or rebased worktree was
  not installed knows to run it and enqueue again with nothing to commit (#1594).

- **An ejected cell that waits on the owner no longer holds a seat** (lushly-dev/afd#1593). Once a cell's own ejections reach `cells.maxEjections`, it frees its seat toward `cells.max`, and `canStartCell` reflects that; the lane raises `queue-room` when that opens a seat, and `lane-status` counts the cell in `waitingOnOwner`. An ejected cell under the limit, which its foreman is repairing, keeps its seat, and an `ejection-excuse` that brings a cell back under the limit seats it again, even past `cells.max`, which then refuses new cells until enough seats free.

- Parse actual TypeScript (`vitest`) and Rust (`cargo-tarpaulin`) coverage percentages from isolated per-run report directories in `dev_check_coverage`, rejecting failed runs, stale reports, and invalid percentages instead of hardcoding `0` (#1874).
- Use atomic owner-only (`0600`) temp-file writes (`mkstemp` + `fsync` + `os.replace`, with short retry on Windows `PermissionError`), per-file scope locks, and concurrent-deletion tolerance in `botcore-memory` `LocalMemoryStore` (#1875).

### Security

- **`botcore-llm` tool calls follow host policy.** Commands bridged into an LLM session are now served through a managed Botcore host, and every tool call a model makes enters `host.execute`, as a CLI or MCP `call` does: argument checks, command policies, the execution profile and path confinement apply, and a refused call reaches the model as the host's error with its suggestion (for example `EFFECT_DENIED`). By default the host covers the current workspace with the `inspection` profile and serves the admitted core commands plus, when it is installed, the connectors plugin's. `tool_profile` and `tool_plugins` under `[tool.botcore.plugins.llm]` change it (a local setup opts in with `tool_profile = "trusted-local"`), and Python callers can pass their own host to `botcore_llm.commands.set_tool_host`. A command that host does not serve is refused with `UNKNOWN_COMMAND` when the session is created.
- **Tool hosts release their plugins.** A session closes the plugins of the tool host it built (the connectors' HTTP clients) when `llm_session_destroy` runs; `build_host` now keeps the selected plugins on `host.plugins`, and `host.aclose()` closes them.
- **The connectors plugin is admitted to managed hosts.** `ConnectorsPlugin` declares `host_context_safe` and a policy for each GitHub command: the `service` and `subprocess` effects, since credential lookup may run `gh auth token`. An agent with connectors now starts with its connector tools served by the tool host; under the default `inspection` profile their calls are refused with `EFFECT_DENIED`, and a `trusted-local` host runs them.
- **The shell allowlist approves each command on its own.** A shell request is approved only when its command line parses (POSIX `shlex`) into a single command: a line break, `;`, `&`, `&&`, `||`, `|`, a redirection, a subshell, `$` or backtick substitution, a backslash, a glob, `~` or `#` outside quotes, or `$`, a backtick or a backslash inside double quotes, refuses it. Command lists and pipelines are refused even when every part matches. Quoted arguments may hold any other text. The program must equal the pattern's first word, and the pattern is matched against the parsed arguments. A refusal now says what refused it and how to recover. The runtime's own parse of the request must agree (exactly one command, the same program and arguments, no redirection), or the request is refused. On Windows, `&`, `|`, `<`, `>`, `^`, `%` and `!` are refused even inside quotes, because `.cmd` shims such as `npm` and `pnpm` re-read their arguments through `cmd /c`.
- **Model tool calls run as an agent.** A tool host whose actor is a human with an id keeps the agent as caller and records that human as `on_behalf_of`; a host whose actor is a service, a script or a human without an id is refused with `TOOL_HOST_ACTOR_REFUSED` when the session is created. A tool call whose arguments are not an object now reaches the host's `VALIDATION_ERROR` instead of being treated as empty.

- **`botcore serve` serves only over stdio.** Its run tool executes any Python its client sends, so `--transport sse` is now refused with exit code 2 and a pointer to `botcore.host_http` (`create_host_http_app`, run with `serve_hosts`), which serves a managed host's commands over HTTP behind bearer tokens from `botcore host-token issue`. Code that calls `create_mcp_server(...).run(transport="sse")` directly is unchanged.

- **`docs_lint` stays inside the worktree.**
  - **Outside links:** a link whose target leaves the worktree, through `..`, a leading `/..` or a symlink, is reported as a `link-outside-workspace` warning instead of being read or tested for existence. The `..` check is lexical, so such a target is never looked up. A symlink inside the worktree is still resolved to find where it points.
  - **Symlinked files and start paths:** a Markdown file reached through a symlink out of the worktree is not linted. A starting directory outside the worktree is refused with `PATH_OUTSIDE_WORKSPACE`.
  - **Links between units:** still checked. The boundary is the worktree (the managed host's, or the nearest directory above the workspace that holds `.git`), not the selected unit.

- Reject shell metacharacters (`\n`, `\r`, `\0`, backticks, `$` expansion, subshells, redirections, single `&`, `&&&`, `|||`) and vacuous/empty shell segments in `botcore-llm` command permission checks (#1871).
- Enforce `tenant_id` and `allowed_groups` authorization on `TeamsBot.on_invoke_activity()` and normalize missing AAD/tenant fields safely in `botcore-teams` (#1872).
- Reject Windows drive/backslash/NUL escapes in `CommandHost` `package` validation (#1873).

## [0.7.0] - 2026-11-13

The bloat sweep, shared with Lushly: a skill and the `[sweep]` section it reads. A `[sweep]` section in `botcore.toml` needs this release, since earlier ones refuse unknown keys.

### Added

- **`bloat-sweeper` skill.** A periodic pass that ranks files over `file_size_warn` by size and churn, finds code copied between files, judges each candidate's seam, and fixes the worst few in one PR, so a commit gate only needs to guard runaway growth. Its `scripts/sweep.mjs` needs only Node and git (and `gh` for open pull requests and the trend issue), ships in the wheel, and reads a new `[sweep]` section (`SweepConfig`): `trend_issue`, `cohesive`, `exclude`, `churn_days`, `extensions` and `measures`. Adapted from Lushly's `do-sweep` bloat mode, with areas taken from the nearest package manifest and stories left out of the ranking. A repository adopting it with its own trend issue and cohesive file sets `trend_issue` and `cohesive`, and carries measures such as bundle sizes or test-only exports through `measures`; a `[sweep]` section needs this release, since older ones refuse unknown keys.

## [0.6.1] - 2026-11-12

Fixes for repositories that seed Botcore's skills, and docs checks that cover a whole
monorepo. Prepared on 2026-11-07 and released with the docs-check fix that landed since.

### Fixed

- **Docs checks cover the whole repository**
  ([#779](https://github.com/lushly-dev/afd/issues/779)). `docs_check_changelog` reads staged
  code under any `src/` directory, in any of the common languages, against the CHANGELOG.md
  nearest it, so each package of a monorepo answers to its own; before, only `.py` under a
  top-level `src/` counted. `docs_check_agents` also sees new packages (`package.json`,
  `pyproject.toml`, `Cargo.toml`), skills and workflows, and command modules in any language.
  `docs_lint` lints a single file it is given, where it checked nothing, and skips
  `node_modules`, virtual environments and build output. In an npm repository the checks
  suggest its Changesets command rather than `changeset_create`, which refuses one.
  `docs_check_agents` now reports packages, skills and workflows only when they are added, and
  labels an edited command module "Changed command"; in a monorepo these advisory checks can
  flag more than before. `docs-manager` 2.1.1 describes the checks as they now are.
- **Seeded skills** read correctly outside AFD. `security-auditor` defers to a repository lane
  that defines blockers by impact; `docs-manager` allows a root `CLAUDE.md` whose only line is
  `@AGENTS.md`; `plugin-builder`, `mcp-builder`, `security-auditor` and `botcore-config` link
  `host-composition.md` on GitHub and name package modules rather than AFD repository paths.
  Their versions are bumped so `skill-status` reports the drift and `skill-seed --update`
  refreshes them.
- **skill-manager** (4.1.1) no longer names AFD's `pnpm verify` as its example of a single source, so seeded
  copies don't cite a command a consuming repository lacks.

## [0.6.0] - 2026-11-07

The first release published from lushly-dev/afd (`publish-botcore.yml`); 0.5.0 and earlier
were published from lushly-dev/botcore. It carries every change made in either repository
since 0.5.0.

### Added

- **0.6.0 managed hosts:** explicit worktree/target contexts, host-owned identity,
  deterministic plugin admission, effects metadata/policy and shared CLI/MCP/DirectClient dispatch.
- **Quality verdicts:** strict adapters keep execution success separate from passing checks,
  with target/evidence and nonpassing empty/skipped/unavailable aggregate behavior.
- **Provenance:** imported from upstream Botcore main with exact source allowlist and MIT notices;
  its envelope records that AFD publishes `lushly-botcore` and that the other distributions
  have no publisher.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **botcore-llm** -- `llm_chat_stream` (in `botcore_llm.chat_stream`) streams a chat turn as afd stream chunks: progress for the sent message and each tool started, `{"text": ...}` data chunks from the Copilot SDK's `assistant.message_delta` events, then a complete or error chunk. Closing it early aborts the turn. `llm_chat` now collects this stream; its result is unchanged, but cancelling `llm_chat` now also aborts the turn in the session. Data chunks carry `message_id`; a turn that uses tools streams every assistant message, and the complete chunk's `content` is the final one. When the SDK returns no final message, `llm_chat` now returns the last streamed message's text and id instead of empty strings

- **botcore-agents** -- `task_status` shows a running task's progress: `partial_result` (the reply text streamed so far) and `progress_message` (the latest progress, such as `Running grep`). They are held in memory only, not saved with orchestrator state, and are dropped when the task completes, fails, or is cancelled, or when state is restored

- **research** -- `research_stream` streams a research answer as afd stream chunks (progress, text data chunks, then a complete or error chunk); `research_query` collects it into the same result as before and no longer blocks the event loop. The MCP `{name}-research` tool forwards the stream as MCP progress notifications and now returns the result's JSON fields instead of its string form

- **botcore-agents** -- `task_assign_stream` and `task_resume_stream` stream an agent task as afd chunks: a progress chunk with the task id and agent, the agent's chat progress and `{"text", "message_id", "task_id"}` data chunks from `llm_chat_stream`, then a complete or error chunk. `task_assign` and `task_resume` now collect these streams with unchanged results. Closing a stream early aborts the chat turn and marks the task `cancelled`. A task cancelled by `agent_stop` while running now stays `cancelled` (`TASK_CANCELLED`) and its agent stays stopped, and `TASK_EXECUTION_ERROR` now carries a suggestion. Stopping and deleting an agent while its task runs now ends the task as `TASK_CANCELLED` instead of raising

### Changed

- **Publishing moves to AFD for `lushly-botcore` only.** PyPI releases come from AFD's
  `publish-botcore.yml` on a `botcore-vX.Y.Z` tag, after the release inventory admits the
  `botcore` unit on the `pypi-botcore` route and the native guard checks the tag, manifest and
  built artifacts. 0.5.0 was the last release from `lushly-dev/botcore`; 0.6.0 is the first
  from AFD. `botcore-connectors`, `botcore-llm`, `botcore-agents`, `botcore-memory` and
  `botcore-teams` stay quarantined with no publisher. The handoff record is
  `docs/features/active/platform-monorepo/botcore-handoff.md` in AFD.
- **skills: one lint rule set, and ownership in `metadata:`** -- `skill_lint` (MCP, Alfred)
  and `botcore skill-lint` / `skill_lint_spec` (CLI) now share one rule set. Before, the
  first warned when `triggers` or `version` were missing while the second called them
  unsupported, which led a consumer to strip `source:` and silently stop seeding.
  - **Retired rules:** SK006 (triggers required) and SK013 (version required).
  - **Errors:** SK004 (name format and directory) and SK005 (description over 1,024
    characters) are errors.
  - **New warnings:**
    - SK016: description over 300 characters.
    - SK017: `triggers` fields and "Triggers:" lists.
    - SK019: listing over `[skills] listing_budget`, default 8,000 characters. The
      count mirrors how hosts list descriptions.
  - **SK018** accepts current Claude Code fields, and warns on an unquoted numeric
    `version`.
  - **SK001** also covers a `metadata:` that is not a mapping.
  - **SK009** counts lines (500), not characters.
  - **SK012** now flags a lowercase `skill.md`; SK004 covers a directory/name mismatch.
  - **SK008** runs even without a `references/` directory.
  - **SK010** looks only for upper-case TODO, FIXME and TBD, and Lorem ipsum.
  - **Strict:** `strict=True` turns every warning into an error.
  - **`skill_lint_spec`** keeps the default budget and reports `listing.config_error` when
    the enclosing workspace's config fails to load. It counts a mirrored copy of a skill
    once.
  - **Ownership:** botcore now records `source`, `version` and `portable` under the
    open standard's `metadata:` map. It still reads top-level fields from older copies.
    Seed, adopt and render write `metadata:`, and the bundled skills use it. A numeric
    version becomes text instead of hiding the skill's owner.
- **skills: the remaining skills rewritten and merged** -- nine bundled skills remain. Each
  is a single SKILL.md (2.0.0) whose API claims were checked against the code.
  - **Merges.** `review` merged into `code-reviewer`; `docs-update` and `content-humanizer`
    merged into `docs-manager`. All three are now renames, so `skill_seed` migrates
    managed copies.
  - **Code reviewer.** It no longer treats phased delivery as a blocker or requires web
    research on every review.
  - **Plugins.** `plugin-builder` documents the managed host, command policies,
    `error(code, message, ...)` and fail-closed discovery.
  - **MCP servers.** `mcp-builder` documents the MCP SDK and managed raw Python, and
    gives the correct client config locations.
  - **Security.** `security-auditor` covers MCP, command and agent security against
    Botcore's real boundaries.
  - **Browser automation.** `browser-automation` documents the trace commands and the
    CDP commands' actual behaviour. A test checks it names every exported command.
  - **Configuration.** `botcore-config` and `agent-config` state only settings the code
    reads, and `agent-config` gains the `state` block.
  - **Help text.** The `docs` help topic now describes what `docs_lint`,
    `docs_check_changelog` and `docs_check_agents` check.
- **skills: generic skills retired** -- 43 bundled skills whose content was general
  engineering guidance that current models already know are removed, leaving 12 with
  botcore- or ecosystem-specific content. The retired set is every `-learn` skill, the
  commit/PR/hotfix/release/cleanup workflow chain, and api-designer, component-tester,
  content-designer, dependency-manager, design-implementer, dev-checks,
  duplication-finder, git-manager, license-auditor, persona-creator, problem-solver,
  project-manager, prompt-creator, research, spec-writer, storybook-builder,
  systems-architect and test-writer. `RETIRED_SKILLS` lists them under their current and
  earlier names. `skill_seed` removes botcore-managed copies, and their `.agent/skills`
  mirrors, when no `include` list is set and `skip` doesn't name them. It reports the
  copies it keeps in `retired_locally_owned` and never suggests deleting a copy another
  source owns. `skill_status` reports them as `retired`. Renames whose target was
  retired are dropped.
- **skills: skill-manager rewritten for current models** -- the skill now covers what belongs
  in a skill (context an agent can't derive, observed gotchas, repository workflows) and what
  belongs in a hook, script, AGENTS.md or the owning doc instead; descriptions of a sentence
  or two without trigger lists, sized against the shared listing budget; goal-and-constraint
  bodies with reasons instead of capitalised rules; and with/without and trigger evaluations.
  Its references, templates, README and CI example (a removed PowerShell linter) are
  deleted; the 13,000-word reference set restated the open standard. Skill version 4.0.0.
- **skills: mcp-builder token guidance** -- the skill and its `token-budget`/`troubleshooting`
  references replaced the fixed "under 10 tools" and "under 50 tokens per description" caps
  with measuring the serialized `tools/list` payload and keeping it small, dropped
  model-version claims in favour of model-neutral observations to re-test, and made the
  execute pattern an option to re-test on the target client rather than a rule. Skill
  version 1.2.0.
- `{name}-run` output is bounded by `MAX_OUTPUT_LENGTH` (100,000 characters) instead of a
  hard-coded 8,000; the code input guard is `MAX_RUN_CODE_LENGTH` (32,000 characters), an
  abuse guard rather than a context budget.
- `research_stream` and `research_query` take `max_length`; the default
  `MAX_RESEARCH_LENGTH` is 100,000 characters (was 12,000).
- Bundled skills state the linter's SK009 threshold (50,000 characters) instead of line
  targets, describe file-size thresholds from configuration, and ground the file-length
  target in cohesion rather than context-window size.
- Managed raw Python requires explicit trusted-local mode. Legacy trusted-local MCP/CLI
  aliases retain their behavior and are ineligible for restricted profiles.
- Duplicate command/docs registrations and foreign category fragments now reject clearly.
  Category release operations safely deny npm projects pending host protocol/unit routing.
- Development uses the repository's Python AFD source and MCP SDK 2.3; a lazy SDK
  adapter retains MCP 1 support and wheel metadata retains `afd>=0.9.0`.
- Agents wildcard discovery declares an optional connectors extra and returns an
  actionable unavailable-integration result before session creation when absent.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **research** -- **Breaking:** `research_query` now uses OpenAI GPT models with the built-in web search instead of Gemini + Google Search. The `research` extra installs `openai` instead of `google-genai`, and the key is `OPENAI_API_KEY` (was `GEMINI_API_KEY`; `EnvConfig.gemini_api_key` is now `openai_api_key`). Modes: `fast` uses GPT-6 Luna, `deep` and `thinking` use GPT-6.1 Sol at higher reasoning effort

- **skills** -- update LLM guidance for current models: adaptive thinking and effort instead of chain-of-thought prompts and budget_tokens, output_config structured outputs, agent loops that handle early end_turn, pause_turn, and refusal, model-ID placeholders instead of pinned IDs and price tables, and content-humanizer specifics that must come from verified sources Superseded later in this release: AFD retired that skill.

- **deps** -- require `afd>=0.9.0` (was 0.6.0) in botcore and all plugin packages. Pipeline step aliases are now referenced as `$steps.<alias>` (`$g.field` is a literal in afd 0.9); the built-in pipeline docs describe the full 0.9 reference syntax. A command handler that raises now returns `COMMAND_EXECUTION_ERROR` with a generic message (the exception is logged to the `afd.direct` logger) instead of `VALIDATION_ERROR` with the exception text

- **skills** -- make AGENTS.md the only agent instruction file: docs-manager, docs-update, and commit no longer generate or sync a CLAUDE.md (Claude Code reads AGENTS.md only when no CLAUDE.md exists)

- **botcore-llm, botcore-agents** -- **Breaking:** `default_model` no longer defaults to `"gpt-4.1"`. Set it under `[tool.botcore.plugins.llm]` / `[tool.botcore.plugins.agents]` (or pass a model explicitly); otherwise `llm_session_create` and `agent_start` return `CONFIG_ERROR` naming the missing setting. Use `llm_model_list` to find model IDs your Copilot account can use.

- **skills: LLM integration** -- add GPT-6.1 Sol and Claude Sonnet 5.5 model guidance with effort and completed-task cost evaluation. Superseded later in this release: AFD retired that skill.

- Update bundled Node environment skill guidance for the Node 24 LTS baseline. Superseded later in this release: AFD retired that skill.

### Fixed

- `smart_truncate` keeps 40% head and 60% tail of its budget at every size. The head and
  tail had stayed pinned at 3,000 and 4,000 characters after `MAX_OUTPUT_LENGTH` rose to
  100,000, so output just over the cap shrank to about 7,000 characters.

<!-- Ported from lushly-dev/botcore's unreleased changesets (changes made there after 0.5.0 and imported at `7d5c54ca`): -->

- **core** -- `botcore` imports on Python 3.11 again: `skill_lint.py` used a PEP 695 `type` alias (3.12+ syntax), which made `import botcore.commands` raise `SyntaxError` on 3.11 even though the package declares `requires-python >=3.11`

- **botcore-llm** -- works with github-copilot-sdk 1.0.26 (now the minimum): client connects via `connection=`, sessions use keyword `create_session`/`send_and_wait` and `disconnect()`, tool results use snake_case `ToolResult` fields, and the permission gate reads the SDK's typed requests and returns `PermissionDecision` objects instead of denying every request

- **skill lint** -- SK008 no longer flags repo paths that contain a `references/` segment (e.g. `docs/references/x.md`) or leaks backticks and other markdown delimiters into the reported file name, in both `skill_lint` and `skill-lint` spec checks

- **skills: renamed skill migration** -- projects seeded before 0.4.0 ended up with each renamed skill twice (e.g. `manage-documentation` next to `docs-manager`) after upgrading. `skill_seed` now reads a bundled old-to-new name map: an old-name skill with `source: botcore` is removed and the new name seeded in its place (reported under `migrated`); an old-name skill botcore doesn't own is left untouched, reported under `renamed_locally_owned` with a delete-or-adopt suggestion, and its new name is not seeded alongside it. `skill_status` reports old-name skills with the new `renamed` status.

- **skill_lint** -- report the linted skill directory in `path` when a path is given (it previously always showed the default skills directory), and make `SKILL_NOT_FOUND` name the directory it checked with a suggestion

- **skill** -- `render_frontmatter` now emits valid YAML for triggers and descriptions containing special characters (e.g. `!bash`, `@file`), and `skill_seed`/`skill_adopt` inject `source:` with a minimal line edit instead of rewriting the frontmatter. Fixes `commands-learn` showing as `unmanaged` after a fresh seed and never updating with `skill_seed --update`.

## [0.5.0] - 2026-07-28

### Changed

- **runner: raise the default output budget to 100,000 chars** -- `MAX_OUTPUT_LENGTH` was 8000, a limit inherited from small-context models. Truncating a structured payload (JSON, NDJSON) does not shorten it, it *corrupts* it into an unparseable string, so any command returning structured data over 8KB failed at the parse step rather than degrading gracefully. Callers that relied on the old default now receive up to 100,000 chars.
- **runner: report truncation explicitly** -- `run_command` now returns a `truncated: bool` on every return path, so a caller can detect a clipped payload instead of silently parsing corrupt output.
- **skills: mcp-builder output guidance** -- the skill and its `token-budget`/`troubleshooting` references taught the 8000 default as the recommended pattern. Guidance is now "bound prose, never truncate structured payloads."

### Added

- **runner: `max_output` parameter** -- `run_command(..., max_output=N)` overrides the default budget per call; `max_output=None` disables truncation entirely for commands whose output must survive intact.

### Fixed

- **runner: `smart_truncate` with small budgets** -- head/tail sizes were hardcoded at 3000/4000, so any `max_len` under 7000 returned output *longer* than the requested budget. Head and tail now scale to fit `max_len`.
- **`__version__` drift** -- v0.4.0 bumped `pyproject.toml` but not `botcore.__version__`, so `botcore --version` and the MCP server handshake both advertised `0.3.5` from a `0.4.0` package. A test now pins `__version__` to the `[project] version`, so the two cannot diverge again.
- **changeset: platform-dependent paths in command results** -- `changeset_create`, `changeset_delete`, and `changeset_status` returned `str(Path.relative_to(...))`, which emits `.changeset\name.md` on Windows and `.changeset/name.md` elsewhere. Those values are handed to agents and fed back into `changeset_delete` as `undo_args`, so results now use POSIX separators on every platform.

## [0.4.0] - 2026-04-02

### Changed

- **BREAKING: skill naming convention** -- All 55 bundled skills renamed from verb-noun to noun-first format. Three naming tiers: bare noun for actions (`commit`, `pr`, `release`), noun-role for agent skills (`code-reviewer`, `mcp-builder`, `test-writer`), and noun-`learn` for reference skills (`caching-learn`, `authentication-learn`, `concurrency-learn`). Update any `skills` lists in agent configs and `include`/`skip` lists in `[skills]` config to use new names.

### Added

- **agents: state config model** -- `AgentsStateConfig` nested model replaces flat `state_backend`/`state_path`/`state_retention_hours` fields with structured `state.enabled`, `state.resolve_path()`, and `state.autosave` support.
- **agents: per-agent permissions** -- Agent capability declarations and permission profiles for shell, filesystem, MCP, and custom tool access.
- **skills: configure-agents** -- New skill for configuring botcore agent teams with MAS research patterns, persona definitions, and skill granularity guidance.

## [0.3.5] - 2026-03-19

### Improved

- **trace summaries** -- Split Chrome trace summaries into clearer signal buckets so main-thread work, browser/compositor pressure, and metric spans are reported separately. Summaries now surface `mainThreadTopByDuration`, `primaryThreadLongTasks`, `browserPipelineLongTasks`, `metricSpans`, and a compact `signals` block to make “is this a real app red flag?” easier to answer quickly.

## [0.3.4] - 2026-03-19

### Added

- **trace analysis** -- Add `cdp_trace_query` and `cdp_trace_summary` so Chrome DevTools traces can be queried and summarized through Perfetto instead of raw JSON parsing. The new workflow exposes a stable summary for automation plus direct PerfettoSQL for deeper investigation.

### Fixed

- **cdp tracing** -- Replace the earlier Playwright trace artifact path with real Chrome DevTools `Tracing.start/end` capture and save traces into a dedicated `.botcore/traces` directory. This produces Perfetto-readable trace files that FAST-AF and other botcore consumers can analyze directly.
- **cdp extra** -- Include `perfetto` in the `cdp` extra so trace analysis works in standard BotCore browser installs instead of requiring a one-off local dependency.

## [0.3.3] - 2026-03-19

### Fixed

- **cdp_snapshot** -- Replace the removed `page.accessibility` path with Playwright's current locator-based `aria_snapshot()` API. Accessibility snapshots now work again in the CDP toolchain, including subtree snapshots via `root_selector`, and return both a structured tree and the raw ARIA snapshot text.

## [0.3.2] - 2026-03-19

### Fixed

- **cli** -- Restore plugin command registration in the Click CLI startup path by registering discovered plugin commands with explicit command names. This fixes `botcore skill-lint` and other plugin-backed CLI flows that were crashing during startup with `SimpleRegistry.register()` argument errors.
- **version** -- Sync `src/botcore/__init__.py` with the package version so runtime metadata now matches `pyproject.toml`.

## [0.3.1] - 2026-03-14

### Added

- `dev_check_lockfile()` command -- detects lockfile drift (lockfile staged without manifest change), supports TypeScript/Python/Rust ecosystems
- `staged_only` parameter on `dev_check_size()` -- filters to only staged files for pre-commit hooks

### Fixed

- `quality_gate.py` now uses smart script name lookup for TypeScript projects (tries `type-check` before `typecheck`, `test:run` before `test`)

## [0.3.0] - 2026-03-14

### Added

- **cli** -- Click CLI entry point (`botcore` command) with `init`, `serve`, `skill-seed`, `skill-list`, `skill-status`, `info`, `changeset-create`, `changeset-status`, and `changeset-consume` subcommands. `botcore init` scaffolds a new project with language-detected `botcore.toml` and skill seeding. `--non-interactive --json` mode for agent-safe zero-prompt setup with structured output. `--language`, `--force`, `--no-skills`, and extension flags (`--with-agents`, `--with-llm`, `--with-memory`) for fine-grained control. `botcore serve` starts the MCP server. `python -m botcore` delegates to the CLI. Entry point registered via `[project.scripts]` in pyproject.toml.
- **changesets** -- Changeset-based changelog workflow. Each user-visible change gets a `.changeset/<id>.md` file with type and description. Three new commands: `changeset_create` (create a changeset file), `changeset_status` (list pending changesets), `changeset_consume` (consume changesets into CHANGELOG.md grouped by type). `docs_check_changelog` updated to be changeset-aware — passes when changeset files exist for staged changes. CLI commands: `botcore changeset-create`, `botcore changeset-status`, `botcore changeset-consume`. No new dependencies.
- **botcore-agents** -- Per-agent permission profiles (`AgentPermissionsConfig`) extending `LlmPermissionsConfig` with `shell_allowlist` (fnmatch glob patterns, shell operator splitting) and `filesystem_paths` (resolved prefix matching). Each agent declares its own `permissions` in config; the orchestrator passes them through to `llm_session_create`. Permission handler includes `agent_name` in all audit log messages. Secure by default — shell and filesystem denied unless explicitly enabled.
- **botcore-architecture skill** — System topology, package map, request flows, security boundaries, and extension points for agent learning
- **botcore-principles skill** — 12 design tenets (CommandResult Everywhere, Opt-In Composability, Constrained Agency, Meta-Tool Pattern, etc.) with decision heuristics and anti-patterns
- **ROADMAP.md** — Feature trajectory: foundation (active), Phase 2 (proposed), future, and non-goals
- **3 foundation specs** (`docs/features/active/`) — Agent capability declarations, orchestrator state serialization, per-agent permissions
- **4 proposed specs** (`docs/features/proposed/`) — Async task execution, cost-aware routing, SQLite memory backend, Azure connectors
- **botcore-connectors** -- New plugin package for typed HTTP connectors (`pip install botcore-connectors`)
  - **Connector base layer** (spec 01) -- `ConnectorBase` with inlined retry, rate-limiting, backoff, telemetry (trace ID + timing), and HTTP-to-error-code mapping. `ConnectorContext` Pydantic model for shared config.
  - **Auth & credential resolution** (spec 02) -- `DefaultCredentialResolver` with env var → `gh` CLI fallback chain, token caching with TTL, 401 auto-retry with invalidation, and token redaction from logs/serialization.
  - **Config & plugin wiring** (spec 03) -- `ConnectorsConfig` Pydantic model with per-connector sub-models, `[connectors].enabled` filtering, `ConnectorsPlugin` with two-phase init and `BotCorePlugin` protocol conformance.
  - **Security model** (spec 04) -- Input validation helpers (`check_max_length`, `check_owner_repo`, `check_no_path_traversal`, `validate_inputs`), scope enforcement (`check_scope`), and structured audit logging with `sanitize_args`.
  - **GitHub connector** (spec 05) -- `GitHubConnector` subclass with dual rate-limit tracking (API vs search), `X-RateLimit-Reset` backoff, error remapping (NOT_FOUND → GITHUB_NOT_FOUND, etc.), and 8 commands: `github_issue_create`, `github_issue_list`, `github_issue_comment`, `github_pr_create`, `github_pr_list`, `github_pr_review`, `github_search_code`, `github_search_issues`. 248 tests passing.
- **botcore-memory plugin (Phase 1)** -- New `packages/botcore-memory` package providing persistent agent memory with local JSON file store, 5 CRUD commands (`memory_set`, `memory_get`, `memory_search`, `memory_delete`, `memory_list`), three scopes (agent/team/task), scope-based access control, and `MemoryStore` ABC for future backends (Cosmos DB)
- **botcore-agents plugin (Phase 1)** -- Separate `packages/botcore-agents/` package providing single-agent lifecycle management
  - `AgentsPlugin` implementing `BotCorePlugin` protocol with entry-point discovery
  - `AgentOrchestrator` singleton managing agent pool, task store, and LLM session lifecycle
  - `AgentConfig` / `AgentsPluginConfig` Pydantic models with `extra="forbid"` validation
  - `Task`, `AgentHealth`, `AgentState` domain models with field constraints and status literals
  - 9 commands: `agent_create`, `agent_start`, `agent_stop`, `agent_status`, `agent_heartbeat`, `task_assign`, `task_status`, `state_save`, `state_load`
  - Direct `botcore-llm` integration — agents backed by LLM sessions with scoped tools
  - Role-based agent pooling — `task_assign(role="pm")` routes to idle agents or auto-spawns new instances from config templates when all are busy
  - `_resolve_agent_for_role` with search order: reuse idle → spawn from template → error at pool capacity
  - Sequential instance naming (`researcher-1`, `researcher-2`, …) with config inheritance from role template
  - Capability declarations — `connector_commands` field on `AgentConfig` for fine-grained tool access, `resolve_connector_commands()` with 4-step resolution (explicit list → deny-by-default → wildcard via `KNOWN_CONNECTORS` → prefix filter), and `_resolve_tools()` combining skills + connector commands at session creation
  - Synchronous task execution via `llm_chat` (background execution planned for Phase 3)
  - **State serialization** — `OrchestratorSnapshot` model, `OrchestratorStateBackend` Protocol, and `JsonStateBackend` with atomic writes (`tempfile` + `os.replace`), async I/O via `asyncio.to_thread()`, and configurable retention. `save_state`/`load_state` on orchestrator with `NO_BACKEND`, `STATE_SAVE_ERROR`, `STATE_LOAD_ERROR` error codes. Restored agents forced to `stopped` with cleared session metadata.
  - 110 unit + integration tests with mocked LLM commands
- **botcore-llm plugin (Phase 1)** -- Separate `packages/botcore-llm/` package providing LLM runtime via Copilot SDK
  - `LlmPlugin` implementing `BotCorePlugin` protocol with entry-point discovery
  - `CopilotClientManager` singleton for client lifecycle (start/stop)
  - Command-to-tool bridge (`botcore_command_to_copilot_tool`) auto-converts botcore commands to Copilot SDK tools
  - Permission gate denying shell/filesystem by default, configurable via `LlmPermissionsConfig`
  - In-memory `SessionRegistry` for active session tracking
  - 5 commands: `llm_session_create`, `llm_session_destroy`, `llm_session_list`, `llm_model_list`, `llm_chat`
  - `LlmConfig` Pydantic model with permissions, cost, and session settings
  - 40 unit tests with mocked Copilot client (no real CLI needed)
- **Lefthook git hooks** -- Pre-commit, pre-push, and on-demand quality gate hooks
  - `check-file-size.mjs` -- Warn >300 lines, error >500, hard cap 1000 with `# botcore-override: max-lines=N` escape hatch
  - `check-portability.mjs` -- Detect machine-specific paths in Python source
  - Pre-commit: ruff check --fix (staged), ruff format (staged), portability, file-size
  - Pre-push: Full ruff lint, format-check, pytest, portability, file-size
  - On-demand `check`: Same as pre-push
- **Comprehensive test coverage** -- 22+ tests covering non-CDP modules (#1)
- **do-documentation-update** -- standalone skill for documentation update passes (CHANGELOG, AGENTS.md, README.md, specs, roadmap, link verification). Includes changelog-versioning reference covering SemVer, git tags, comparison links, and monorepo strategies.
- **do-clean-repo** -- periodic repo cleanup skill for stale branches, orphaned worktrees, dead test files, agent artifacts, build output, orphaned configs, and lockfile hygiene. Scan and full modes with confirmation before destructive actions.
- **retry_async** -- shared async retry utility in `botcore.utils.runner` with configurable attempts, delay, and input validation. CDP retry loops refactored to use it.
- **AFD 0.6.0 adoption** -- Full adoption of AFD 0.6.0 features across botcore core:
  - **Middleware stack** -- `MiddlewareRegistry` wrapper applies `default_middleware()` (trace_id, logging, timing) plus plugin-registered middleware to every command execution via `get_client()`
  - **Telemetry** -- Opt-in telemetry via `telemetry_enabled` and `telemetry_format` config fields; wires `ConsoleTelemetrySink` into the middleware chain when enabled
  - **Batch execution** -- `batch_execute()` helper runs multiple commands with timing, summary, confidence, and `stop_on_error` support
  - **Pipeline docs** -- `PIPELINE_DOCS` constant documenting `DirectClient.pipe()` with variable resolution, aliases, conditionals, and error handling
  - **Richer CommandResult** -- `suggestions` on info/docs commands, `confidence` and `sources` on research results
  - **Testing helpers** -- Migrated 10 test files (~80 assertions) to `afd.testing.assert_success` / `assert_error`
  - **Plugin middleware wiring** -- `add_middleware()` activated with proper signature; CLI startup discovers plugins and wires middleware into registry
- **5 active plugin specs** -- LLM Runtime, Agent Orchestration, Connectors, Memory System, and Teams Interface plugin specs with AFD integration sections
- **botcore-teams plugin (Phase 1)** -- Microsoft Teams bot interface as first external plugin in `plugins/botcore-teams/`
  - Regex intent parser (6 patterns: task_assign, task_status, team_status, task_cancel, task_list, unknown)
  - Adaptive Card v1.4 renderer for `CommandResult` (success/error, plan steps, sources, confidence, suggestions)
  - Tenant-gated auth (`validate_tenant`, `extract_identity` → `TeamsIdentity`)
  - Command handlers (`teams_handle_message`, `teams_handle_card_action`) with stub dispatch fallback
  - Bot Framework webhook (`TeamsBot` + `create_app()` via aiohttp + botbuilder)
  - `TeamsPlugin` entry-point implementing `BotCorePlugin` protocol
  - 62 tests, 94% coverage

### Fixed

- **version** -- `__init__.__version__` now matches `pyproject.toml` version (was `0.2.0`, should be `0.2.1`)
- **connectors** -- Fix stale pre-flight GitHub rate-limit gating by allowing requests after reset window expiry; harden audit sanitization to recurse into list/tuple/set containers so nested sensitive keys are redacted
- **teams** -- Repair dispatch path to use DirectClient with UNKNOWN_TOOL fallback; add `allowed_groups` authorization gate; thread `original_text` through Retry button action data; change `TeamsIdentity.roles` to immutable `tuple[str, ...]`
- **memory** -- Wire plugin config injection via `configure` hook in `build_namespace`; enforce `max_entries_per_scope` atomically in local store with `MEMORY_SCOPE_FULL` error
- **plugins** -- Inject validated plugin config in `build_namespace` and call plugin `configure` hooks before registration; add configure hooks for botcore-agents and botcore-llm; reset agents orchestrator on config change
- **retry_async** -- Add `attempts >= 1` validation (was unreachable error path); remove misleading `RuntimeError` fallback

### Changed

- **afd** -- Bumped minimum from `>=0.1.0` to `>=0.6.0`. Picks up Python-TypeScript parity (batch execution, streaming, middleware stack, telemetry, MCP client, testing helpers, connectors, handoff), contextual tool loading, output shape predictability, schema examples, and command prerequisites. No breaking changes for botcore — all existing `CommandResult`, `success`, `error`, `DirectClient` usage is unchanged.
- **`__main__.py`** — `python -m botcore` now delegates to the CLI instead of starting the MCP server directly. Use `botcore serve` to start the server.
- **AGENTS.md** — Added CLI section with command table; added `cli.py` to architecture tree
- **AGENTS.md** — Added Architecture & Principles section and Roadmap section referencing new skills and feature trajectory
- **LANDSCAPE.md** — Trimmed to pure competitive positioning; architecture and vision sections replaced with pointers to skills, specs, and ROADMAP.md
- **monorepo layout** -- Moved `botcore-llm/` into `packages/botcore-llm/` to establish `packages/` convention for plugin packages
- **botcore.toml** -- Expanded configuration with language, tooling, threshold, and hygiene settings
- **CONTRIBUTING.md** -- Comprehensive rewrite with lefthook setup, development workflow, and contribution guidelines
- **do-commit** -- Step 3 (Documentation Gate) now delegates to the `do-documentation-update` skill instead of inlining checks. Adds spec completion, roadmap updates, and link verification to the documentation pass.

## [0.2.1] - 2026-02-22

### Changed

- Promoted project status from Alpha to Beta across repository docs and package metadata.

## [0.2.0] - 2026-02-22

### Changed

- Migrated to standalone repository from `libraries/py/packages/botcore`

### Added

- `do-commit`, `do-pr`, `do-release`, `do-review`, `do-hotfix` action skills
- `automate-browsers`, `build-botcore-plugins`, `configure-botcore`, `run-dev-checks` skills
- 52 bundled universal skills total
- Multi-language project support. `LanguageConfig` model with per-language `root`, `linter`, `test_runner`, `formatter`. `language_config` dict on `BotCoreConfig` with `languages` property and `get_tools_for()` method. `resolve_language()` 5-step priority chain (explicit override → root prefix → package override → marker walkup → primary fallback). All dev commands (`lint`, `test`, `build`) accept `--language` and `--path` params. Quality commands (`check-size`, `check-coverage`, `check-deps`) dispatch to npm/cargo ecosystems. Analysis commands (`dead-code`, `circular-imports`, `unused-deps`, `dep-graph`) dispatch to knip, madge, depcheck, cargo-udeps, cargo-modules. `run_external_tool()` helper with skip-with-warning behavior. Multi-language "run all" mode. Config validation warns on primary language not in `language_config` and overlapping root prefixes. `language` field added to `PackageOverrideConfig`. 24 new tests.

## [0.1.0] - 2026-02-19

Initial release (developed in `libraries/py/packages/botcore`).

### Added

- Shared bot infrastructure package (Phases 1a–1c). Config system, plugin contract, and full command extraction from lushbot: dev commands (lint, test, build, quality gates, analysis, portability), docs (lint, changelog, agents), CDP browser automation (28 commands), research (Gemini + Google), spec lifecycle, and undo/history. Language-aware dispatch (Python/TypeScript/Rust). 80 tests.
- Skill registry (Phase 2). 6 new commands: `skill_seed` (copy skills with `source:` ownership), `skill_list` (installed + available), `skill_status` (version drift detection), `skill_lint` (SK001–SK015 quality rules), `skill_adopt` (claim unmanaged skills), `skill_index` (generate `_index.md`). YAML frontmatter engine with `SkillManifest` model. Three-tier skill ownership via `source:` protocol. 21 bundled universal skills. 70 new tests (150 total).
- Unified plugin system (Phase 3). MCP server factory (`create_mcp_server`), dynamic namespace builder (`build_namespace`), and docs aggregator (`build_docs`). Plugin commands and docs automatically wired into MCP and CLI surfaces. `PluginRegistry` gains `add_docs()`/`docs` for topic-based documentation. `CORE_DOCS` dict centralizes botcore command documentation. 22 new tests (172 total).
- Phase 1d: lushbot wired to botcore plugin system. `LushxPlugin` registers agent commands + afd-lint + docs via `botcore.plugins` entry point. Dead extension code removed (~100 lines).
