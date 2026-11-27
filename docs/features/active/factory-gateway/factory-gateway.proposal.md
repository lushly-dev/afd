# Factory Gateway: one door to GitHub for agents

A service in `botcore-factory` that becomes the only way factory agents reach GitHub. It holds
the GitHub credential as a GitHub App, serves typed commands to each kind of caller with its own
token and policy, makes every factory write as one bot identity, records each write with the
agent it acted for, shares and settles GitHub reads, and wakes the lane and the foreman on
events. It runs on the always-on machine. GitHub stays the record: code, pull requests, CI and
the claims themselves.

## Status

- **State:** active, by the owner's direction of 2026-11-14 (below). Nothing is built. Written
  2026-11-14 against `main` at `2a1253bc`.
- **Origin:** a conversation with the owner on 2026-11-14 about whether a layer on top of
  GitHub, like the one [Entire](https://entire.com) adds, could make GitHub work better for
  agents. The answer was yes, but not as a parallel forge: as the agents' only route to GitHub,
  built from the AFD pieces that already exist.
- **Relation to the [Software Factory](../software-factory/software-factory.proposal.md):**
  this is the factory's GitHub side. The factory's commands stay as they are; the GitHub calls
  inside them (claims in `cells.py`, the queue push in `queue.py`, the reads and writes in
  `real_world.GhGitHub`) go through the gateway.
- **Verified:** the facts in [What exists today](#what-exists-today) were read on `main` at
  `2a1253bc` (AFD) and `2f4394b6` (Lushly). No code was built or run except the scenario checks.
- **Not verified:** how GitHub attributes a squash merge made by an App, whether the App's
  installation rate limit carries a full fleet day, and how long GitHub takes to settle
  mergeability for an App's pull requests. G0 settles these.
- **Jobs:** fifteen, written as scenarios, checked ([Checks](#checks)) and walked by three readers
  who did not write them ([Walking the paths](#walking-the-paths)). The owner ranks them next
  ([For the owner](#for-the-owner)). A sixteenth, seeing a stopped lane, was added on
  2026-11-24 for his decision that `gateway-status` reports the lane.
- **Progress:** [STATUS.md](STATUS.md).

## Decisions

The owner's answers of 2026-11-14.

| Question | Decision | What it changes |
|---|---|---|
| Where it lives | `botcore-factory`, the botcore plugin the factory is built as | One implementation, in Python, as AFD commands on botcore's managed host. No new package, and no third copy beside Lushly's lane and the factory |
| Where it runs | The always-on machine, `random`: always on, on the tailnet, with HTTPS certificates, already serving an MCP server | The gateway is a long-running service there. The lane can run on any host; only the gateway holds a GitHub credential |
| How it is built | An MVP first, then features in milestones | [Milestones](#milestones) G0 to G5, each with jobs, an exit, and the process it changes |
| Process | As each milestone lands, update the skills, tools and `AGENTS.md` that tell agents how to use it | Each milestone has a process manifest and none is done until its files change and the checks pass ([Keeping the process current](#keeping-the-process-current)) |
| Lifecycle | Goes in `active/`; work starts when the proposal is done | The owner ranks and cuts the jobs before G1 starts |

The owner's answers of 2026-11-15.

| Question | Decision | What it changes |
|---|---|---|
| Credit | Work reaching GitHub is credited to the owner as its main contributor; agents are listed as supporting (an email-free `Assisted-by:` trailer), never as author or co-author | `branch-push` refuses a commit whose author is not one of the owner's emails (`COMMIT_AUTHOR_NOT_OWNER`); `pr-merge` uses each repository's merge method (merge commits in AFD, which keep the original authors); G0 reads how GitHub credits an App's squash merge in Lushly, and rebase merging is enabled there only if it credits the App. Updated 2026-11-21, after G0 read it: a squash by the App credits the bot and a rebase merge keeps the commit's author, so by the owner's decision the gateway rebase-merges one commit he authored, in both repositories (AFD allows only squash merges since 2026-11-18, and its merge queue moves to rebase in [#1809](https://github.com/lushly-dev/afd/issues/1809)). Both repositories' `ci-ok` refuse agent authors and co-authors (afd#1250, lushly#2403) |
| Sessions and `main` | Interactive sessions hand their branches to the lane through the gateway instead of merging them themselves; a documentation-only pull request may still merge directly | The `/session` route gains `branch-push` to `refs/factory/queue/<branch>` in G1, and the prepare-PR skills in both repositories default to handing off. The part of G5 that keeps `main` from moving under a running validation lands in G1; the rest of G5 is unchanged |
| Where the lane runs | `random`, beside the gateway, instead of the Mac, which is not always on | `gateway-status` reports the lane (`lanes[] { repo, host, running, stale, queued, lastMergeAt, reportedAt, otherHosts[]? }`, one per repository), so a stopped lane is seen rather than stalling every handoff; the lane's validation checkouts need space on `random`'s dev drive |
| Other people | Nothing is set up for other people until there are other people; G4 stays the last milestone | G4's separate operating-system users are for the agents and validation on the owner's machines, not for other people, and need no second GitHub account |

The owner's answer of 2026-11-26.

| Question | Decision | What it changes |
|---|---|---|
| Issue types and sub-issues ([#2515](https://github.com/lushly-dev/afd/issues/2515)) | The gateway sets an issue's type and its parent in G1, rather than leaving triage's epic writes on `gh` until a later milestone | `issue-create` takes `type?` and `parent?`, and `issue-set` changes or clears either on an existing issue. Triage's epic writes (`addSubIssue`, `removeSubIssue` and `updateIssueIssueType` through `gh api graphql`, in `triage-issues`' `references/epics.md`) move to the gateway with G1's other triage writes, so the foreman and the owner make them through the gateway from G1. A session that opens an epic keeps them on the owner's `gh` sign-in until G5, as its other writes (the decision of 2026-11-15), so `epics.md`'s exemption runs to G5 for that path |

## The problem

Factory agents use GitHub as their shared memory, through one person's `gh` sign-in. Lushly,
which has run a fleet since 2026-11-11, shows what that costs:

- **No identity boundary.** "A cell runs as the same user as the lane, with the same `git` and
  `gh` sign-in"; it "could push and merge on its own, relabel an issue". "The reviewers a cell
  names are its own claim" ([merge lane runbook](https://github.com/lushly-dev/lushly/blob/main/Docs/operations/merge-lane.md)).
  On GitHub every write, by Jason or by any agent, looks like Jason.
- **Locks in comments, written by anyone.** A claim is a `status:in-progress` label plus a lease
  comment holding a marker and JSON. The claimer posts, reads back, and backs off with a release
  comment if it "lost the claim race", because "every agent acts through one GitHub account, so
  an assignee cannot say which session owns an issue" (`scripts/issue-claim.mjs`). AFD's factory
  plugin does the same (`claims.py`). An earlier hash-chained ledger in issue comments was retired
  with about 1,500 lines of procedure.
- **Evidence in prose.** The review-lanes table, the `## Verification` section, screenshot links
  and `Closes` against `Refs` are markdown conventions agents follow from skills. A script checks
  only the review-lane names, and nothing reads `## Verification` back. "A keyword inside a code
  span looks right and does nothing."
- **GitHub's ambiguous states, relearned per agent.** `.state` is `closed` for merged and
  abandoned pull requests alike; mergeability can be `UNKNOWN` ("read again"); an unfinished
  run's conclusion is an empty string and its `startedAt` can be its creation time; closing
  references link "some seconds after the body is written", so the lane waits up to 90 seconds.
- **Writes that are not idempotent.** "Label writes re-apply safely; the deferral comment
  doesn't." Flake issues de-duplicate on a hash in their body.
- **Every agent spends the same request budget.** Each `issue-claim check` costs three or four
  `gh` calls, and `stale` and `related` repeat them for up to 200 issues, all against the owner's
  personal rate limit. Nothing is shared between agents reading the same pull request.
- **Polling.** In Lushly's fleet benchmark of 2026-11-09, 400 of 1,980 owner turns only waited
  or polled. A GitHub Actions outage left a pull request queued, and "a run stuck queued cannot be
  rerun".

None of this limits merge throughput, which local validation sets (the factory's
[Capacity](../software-factory/software-factory.proposal.md#capacity)). It limits trust,
cost and the record: anything that can write can write anything, every agent re-derives GitHub's
rules and spends the owner's request budget, and nobody can say afterwards which agent did what.

## Goal

1. Every factory write to GitHub is made by one service, as a bot identity people can tell apart
   from the owner, and recorded with the caller its token names and the agent it said it acted for.
2. Each kind of caller can do only its own work: a cell reads and hands over its branch; an
   interactive session claims and releases; the foreman claims and triages; the lane pushes, opens,
   records validation and merges; the owner can do anything. A merge needs the lane's validation of
   that exact head, whoever asks.
3. Claims stay on GitHub, and only the gateway writes them, one at a time, so they cannot race
   and a restart loses nothing.
4. GitHub's states reach agents settled and normalised, shared between callers, with text anyone
   can write labelled as content.
5. Waiting is an event, not a loop.
6. Eventually (G4), nothing outside the gateway holds a credential that can write to the
   repository, and the code the lane validates cannot reach one.

It is not a forge. It adds no repository hosting, review interface or pull-request replacement,
and it does not change how fast the lane validates.

## What exists today

| Fact | Where it was read |
|---|---|
| botcore's `CommandHost` builds the CLI (`catalog`, `call`), the MCP tools and a DirectClient from one registry; every command has a `CommandPolicy` of effects, a host may narrow and never widen it, and an unadmitted effect is refused with `EFFECT_DENIED`; on any profile but `trusted-local` every effect other than `inspect` is refused | `endpoints/botcore/src/botcore/host.py`; `endpoints/botcore/docs/host-composition.md` |
| The host registers each command under its Python function's name (`issue_claim`); an unknown name fails with `COMMAND_NOT_FOUND` and "Inspect the host catalog". The factory proposal already plans catalog and wrong-case changes for its Phase 1 | `host.py`, `build_host` and `execute`; the factory proposal, [The plugin and its host](../software-factory/software-factory.proposal.md#the-plugin-and-its-host) |
| The MCP surface is a plain FastMCP server with three tools (`<host>-start`, `-call`, `-docs`) and no authentication hook; its `call` passes no context to `host.execute`, so AFD's journal middleware, which writes to the context, cannot run behind it as it stands | `endpoints/botcore/src/botcore/host_surfaces.py`; `python/src/afd/server/journal.py` |
| Confirmations, approvals and output budgets belong to AFD's MCP server, which botcore's host does not use | [`spec/command-metadata.md`](../../../../spec/command-metadata.md); [`spec/output-budgets.md`](../../../../spec/output-budgets.md); `host_surfaces.py` |
| The factory separates callers by host (`factory-cell`, `factory`), wraps `gh` in `GhGitHub`, claims with a label and a `botcore-factory:claim {branch, machine, leaseUntil}` comment (`claims.py`, `cells.py`), and `lane-enqueue` pushes the cell's head to `refs/factory/queue/<branch>` from the cell's worktree | `botcore-factory/src/botcore_factory/hosts.py`, `real_world.py`, `claims.py`, `cells.py`, `queue.py` |
| `botcore-connectors` has eight GitHub commands over `api.github.com` with rate-limit backoff and a redacting audit log; the managed host does not admit it yet | `endpoints/botcore/botcore-connectors/src/botcore_connectors/github.py`, `github_commands.py` |
| AFD's journal is an append-only JSON Lines record of each call's command, validated input, actor (`kind`, `id`, `onBehalfOf`) and result; context values outside an allowlist never enter it. Python implements it | [`spec/journal.md`](../../../../spec/journal.md); `python/src/afd/server/journal.py` |
| AFD's MCP authorization (bearer tokens, per-command scopes) is implemented in Rust first, with TypeScript and Python to follow | [`spec/authorization.md`](../../../../spec/authorization.md); the [MCP Authorization](../mcp-authorization/mcp-authorization.proposal.md) status |
| Umbel and Mail label text from documents and mail `trust: "content"` | [Mail proposal](../mail/mail.proposal.md), section 4 |
| Lushly's coordination scripts (`issue-claim.mjs`, `merge-lane*.mjs`, `issue-labels.mjs`, the flake filer) have subcommands, `--json` and exit codes, all on `gh` subprocesses. Neither repository has a GitHub App acting as a bot, a webhook handler or a check run written by a script | Lushly `scripts/`; AFD `endpoints/`, `alfred/` |

## Design

```
                     tailnet, HTTPS, one token per caller
 cells ────────► /cell ─────┐
 sessions ─────► /session ──┤
 foreman ──────► /foreman ──┤                                  App installation token
 lane process ─► /lane ─────┼─► gateway on random ─────────────────────────────► GitHub
 owner (CLI) ──► /owner ────┘   botcore hosts, journal,        (issues, PRs, checks,
                                read cache, event cursors       refs, variables)
                                      ▲                                │
                                      └──────── events (polling, G3) ◄─┘
```

### Identity: a GitHub App

A new App, installed on each repository the factory serves. Its private key sits on `random`,
readable only by the gateway's service user. The gateway exchanges it for installation tokens,
which last an hour, and never hands a token to a caller.

- Every factory write appears on GitHub as `<app>[bot]`, so people can tell it from the owner.
  Inside the bot, the journal names the caller.
- The App has its own rate limit, separate from the owner's, which his own sessions keep.
- Pushes and pull requests made with an installation token start workflows, unlike those made
  with `GITHUB_TOKEN`, so CI runs as it does today.
- Permissions: contents, pull requests, issues, checks, variables and workflows (write; GitHub
  requires the workflows permission to push a change to `.github/workflows`, which gate repairs
  do), actions and metadata (read). Administration is not granted, so the gateway cannot change
  branch protection or rules. G0 checks each with a test write.

### Callers, tokens and policy

The gateway is one process serving a botcore host per kind of caller, each behind its own
route (five at first; `/heartbeat` added 2026-11-24):

| Route | Host | Caller | May do |
|---|---|---|---|
| `/cell` | `gateway-cell` | Cells | Read; push its head to `refs/factory/queue/<branch>`; record its review (G2) |
| `/session` | `gateway-session` | Interactive sessions outside a fleet (`start-session` in both repositories) | Read; claim and release their own issues; push their head to `refs/factory/queue/<branch>` to hand it to the lane (from G1, by the owner's decision of 2026-11-15). Everything else stays on the owner's `gh` sign-in until G5 |
| `/foreman` | `gateway-foreman` | The foreman, the factory commands it calls (`cell-register`, `cell-park`, `lane-drop`) and its triage passes (`triage-issues`) | Read; claim and release; label, comment and file issues, and set an issue's type and parent; open revert pull requests; set the lane-host variable; read the audit; wait for events |
| `/lane` | `gateway-lane` | The lane process | Read; claim, renew and release; push branches; open pull requests; record validation; merge; revert; file flakes; wait for events |
| `/owner` | `gateway-owner` | The owner's CLI | Everything, and the overrides only he has (`issue-release` with `force`) |
| `/heartbeat` | `gateway-heartbeat` | A lane's loop, reporting its health | `gateway-status` and `lane-heartbeat` for the host its token names; no uploads |

- **Tokens.** Each caller has its own bearer token, issued, listed and revoked with an operator
  CLI on `random` that is not served over any route. The route checks the token before the host;
  the token decides the host and the actor (`kind`, `id`, such as `lane@workstation`).
  `onBehalfOf` (the cell a lane step served) is what the caller says, and the journal keeps it
  marked as asserted.
- **What that boundary is.** Until G4 it is a policy and attribution boundary, not a credential
  boundary: agents run as the owner's operating-system user, so a cell could read another caller's
  token file or the owner's `gh` sign-in. G1 makes that harder and visible (below); G4 removes it.
- **The foreman never merges.** `pr-merge`, `branch-push` to a branch people see and
  `verification-record` are on the lane's route only. A foreman misled by text in an issue has no
  command that lands code.
- **No raw escape hatch.** There is no `gh api` passthrough and no code-running tool; botcore's
  legacy `{name}-run` meta-tool is not served. A write the commands do not cover is a new command.
- **A write budget.** Each caller has a budget of writes per hour (`writes.perHour`, per class).
  Beyond it a write is refused with `WRITE_BUDGET_EXCEEDED`, so a runaway loop or a bulk mistake
  stops at a known size.
- **Never around the door.** The CLI client reports an unreachable gateway as
  `GATEWAY_UNAVAILABLE`, apart from GitHub's own `GITHUB_UNAVAILABLE`, and agents never fall back
  to `gh` for a write. In G1 cells get a read-only fine-grained token for `gh` reads and a hook
  (Claude Code's, and Codex's equivalent) that refuses `gh` writes and `git push` in a cell
  worktree.

### Claims: GitHub is the record, the gateway its only writer

A claim is what it is today: the `status:in-progress` label and one comment in the factory's
`botcore-factory:claim {branch, machine, leaseUntil}` marker. What changes is who writes it.

- **One writer.** Only the gateway writes claim comments, and it serialises claims per issue in
  its one process, so two claims cannot race. `issue-claim` takes `numbers[]` and claims all of
  them or none. A holder is a branch and a machine; claiming again with the same holder renews.
- **Only the bot counts.** The gateway reads back only claim comments the App wrote, apart from
  the cutover rule below. A comment anyone else writes in the same marker is ignored.
- **Restart.** The gateway keeps a cache of claims for speed and rebuilds it from GitHub when it
  starts, so a restart or a lost disk loses no claim and needs no command.
- **Sessions claim through it too.** Interactive sessions claim on the `/session` route from G1, so
  the single writer holds for every claim, not only the fleet's.
- **Cutover.** Before G1 a repository's claims were written by the owner's account (Lushly's
  `lushly-issue-claim` lease, and the factory's `botcore-factory:claim` before the gateway). The
  gateway honours such a claim, read-only, only when the owner's account wrote it before the cutover
  began (`cutover.from`), and only while it is live by its own rule: a factory claim until its
  `leaseUntil`, a Lushly lease (`harness`, `session`, `host`, `branch`, `startedAt`, no expiry) until it
  goes four hours without activity, as `scripts/issue-claim-leases.mjs` decides today. After
  `cutover.legacyUntil` none is honoured. A legacy marker written by any other account never counts.
- **Lifecycle.** The lane renews the claims of branches it holds (queued, held or validating) on
  each loop. When the gateway sees a pull request it opened merge, it releases the claims on the
  issues that pull request closes. `pr-open` and `pr-merge` refuse with `CLAIM_LOST` when an issue
  in `closes[]` is now held by another branch, so a holder that lapsed and woke up cannot finish
  the work twice. A label removed by hand is reported (`labelMatches: false`, and in the audit)
  and does not end the claim; the owner frees an issue with `issue-release` and `force`.

The gateway's own state is small: the claim cache, review records (G2) until their head is pushed,
the idempotency index, event cursors (G3) and the journal. Only review records and cursors are not
rebuildable from GitHub; losing them costs a review re-record and an event delivered twice.

### Writes that can be retried

Every write is idempotent, so a caller that times out or meets `GITHUB_UNAVAILABLE` retries the
same call:

- `issue-create` and `issue-comment` take a `dedupe_key`; the gateway writes it into a marker in
  the text and finds it again. A filing with a `type` or `parent` is more than one GitHub write, so
  an `issue-create` its key matches sets whichever of them the issue still lacks before it answers
  `created: false`: a retry after a failed attach finishes the attach.
- `issue-create` checks its labels, `type` and `parent` before it files anything, so a refusal
  leaves no issue behind. `issue-set` reports `changed: false` when the type and parent are already
  as asked, a detached issue detached again included.
- `pr-open` returns the open pull request for the branch if there is one (`created: false`), and
  updates its title, body and closing lines when they changed (`updated: true`);
  `pr-revert` returns the open revert of a merged pull request; `branch-push` and `pr-merge` report
  `changed: false` when nothing changed; `issue-release` by the holder of an already-released claim
  succeeds with `changed: false`.
- Text is inline, up to `body.maxBytes` (64 KiB), never a path, because the gateway is on another
  machine. Before any text reaches GitHub (titles, bodies, comments, summaries, review records,
  variable values) it is checked against secret rules (the gitleaks rule set and the repository's
  own patterns) and refused with `SECRET_IN_BODY`.

### Reads: shared, settled and labelled

- **Shared.** The gateway caches GitHub reads and revalidates REST reads with conditional
  requests, which a `304 Not Modified` answer does not charge to the rate limit. The few fields only
  GraphQL serves (closing references, auto-merge state) are cached for `cache.graphqlSeconds` (15),
  since GraphQL has no conditional requests. Ten agents asking about one pull request cost about one
  request. `gateway-status` reports the App's remaining budget.
- **Settled.** `pr-status` returns `state` as `open`, `merged` or `closed` (closed without
  merging); `mergeable` as `clean`, `conflict`, `blocked` or `pending`; `settled: false` with
  `retryAfterMs` while GitHub has not computed mergeability or linked closing references; and
  `requiredCheck.state` as `running`, `passed`, `failed`, `stalled` or `missing`. `stalled` means
  queued with no runner past `stallMinutes`, with GitHub's own status incident as `cause` when
  there is one, so an outage is never read as a failure.
- **Labelled.** Text anyone can write (issue bodies, comments) comes as `{ trust: "content", text }`,
  apart from the typed fields, with the author's relationship to the repository (`OWNER`, `MEMBER`,
  `NONE`). Lists take `limit` (default 50) and `cursor`.
- **Full SHAs.** Every head is a full 40-character SHA; a short one is refused by the input schema.

### Pushing without a credential

`branch-push` takes a git bundle uploaded first to the gateway's upload route (`POST /uploads` on
the caller's own route, returning an id that lasts an hour; an MCP result cannot carry the bytes),
and pushes one ref from it through a bare mirror of the repository on `random`. It refuses `main`
and protected refs, a head the bundle does not contain, and a non-fast-forward to a branch people
see (`NOT_FAST_FORWARD`, whose suggestion is to merge `main` in and validate again). On the cell's
and session's routes it pushes only to `refs/factory/queue/<branch>`, which is what the factory's `lane-enqueue`
does today from the cell's worktree, so cells need no push credential from G1. The upload route and
the bundle steps are in the `factory` docs topic and in `branch-push`'s description.

### Validation and review as records

- **Validation (G1).** `verification-record` is how the lane says it validated a head: result and
  summary, published as the `factory/verification` check. `pr-merge` refuses a head with no passed
  record (`VALIDATION_MISSING`), whoever calls, so a merge cannot skip the lane. For a validated head
  it merges at once when the pull request is already clean with its required check passed (GitHub
  will not enable auto-merge then) and otherwise enables auto-merge bound to the head, by the repository's merge method (`mergeMethods`; a merge commit unless the repository allows only squash).
- **Review (G2).** A cell records its review lanes' verdicts against its head with `review-record`.
  When that head is pushed, the gateway publishes the `factory/review` check from the record, with
  the conclusion the record holds, so no caller chooses it. The verdicts are still the cell's own
  report of its reviewers, as today; the record makes them typed and visible, not proven.

### The journal and the audit

The gateway builds a context for each call from the route's verified caller, so AFD's journal
middleware runs and records the actor from the token. Declared context fields (`repo`, `branch`)
are kept; tokens and headers never are. The journal rotates daily and is kept for
`journal.keepDays` (365).

`gateway-audit` answers "who did this" for an issue, a pull request or a time window. It also lists
writes to watched targets (claimed issues, factory branches and pull requests) that GitHub reports
and the journal does not hold. From G1 the gateway polls the repository's issue events
(`/repos/{owner}/{repo}/issues/events`: labels, closes and reopens on issues and pull requests) and
issue comments (`/repos/{owner}/{repo}/issues/comments?since=`), every `events.pollSeconds` (30), with
conditional requests, and compares the head of each watched pull request with the pushes the journal
holds, since issue events do not include pushes. Until
sessions use the gateway (G5), an outside write from the owner's account may be an agent using his
sign-in, so it is reported for a look and never treated as the owner's decision.

### Events

`gateway-wait` returns events a named consumer has not seen: `pr-merged`, `checks-passed`,
`checks-failed`, `checks-stalled`, `owner-commented`, `outside-write`. Delivery is at least once.
It blocks for at most 300 seconds over MCP and without limit from the CLI, as the factory's
`lane-wait` does. G3 builds it on polling, which needs no public endpoint: the issue events and
comments G1 already reads, each watched pull request (merged or not), and the check runs of each
watched head (`/repos/{owner}/{repo}/commits/{sha}/check-runs`), all with conditional requests. The
repository-wide events feed is not used: it carries no check or workflow runs, and GitHub documents
its delay as anywhere from 30 seconds to 6 hours. An event reaches a waiting consumer within about
one poll interval. GitHub webhooks through Tailscale Funnel are an option the owner can take later
for faster events ([For the owner](#for-the-owner)). The gateway posts events to the factory's T3 Code webhook,
coalescing a burst (`wake.coalesceSeconds`) so fifteen answers from the owner start one foreman
session, not fifteen. `owner-commented` carries `sharedAccount: true` until G5: it is a prompt for
triage to read the comment, never authority.

### When `random` is down

Every factory write stops, and the CLI reports `GATEWAY_UNAVAILABLE`. The lane pauses with a
`lane-error`, which reaches the owner's queue as operator work. Nothing is lost: claims are on
GitHub, the factory's queue is in `refs/factory/queue/*`, and leases that lapse during the outage
are taken over only through the gateway, after it is back. People can still read with `gh`. A
pre-launch project accepts that; a second gateway is not planned.

### What botcore needs

Like the factory's Phase 1 host changes, these are botcore work in G0 and G1:

1. Serve commands under their kebab-case names (`issue-claim`), with a closest-name suggestion on
   `COMMAND_NOT_FOUND`.
2. Build a per-call context with the verified caller as actor, so AFD's journal runs behind the
   host.
3. Serve each command as its own MCP tool with read-only and destructive annotations, beside the
   meta-tools, so a client's permission rules can tell `pr-merge` from `issue-get`.
4. An HTTP surface: one route per host with a bearer check, the upload route, and binding to the
   tailnet address only.
5. Typed nested inputs (Pydantic models for `holder` and `lanes`) so the catalog's schemas say what
   to send, and refusals that carry their facts in `details` (the holder and expiry for
   `ALREADY_CLAIMED`, the current head for `HEAD_MOVED`).
6. A profile for authenticated remote callers. Today `ExecutionContext` knows only `inspection` and
   `trusted-local`, and the host refuses every effect but `inspect` outside `trusted-local`
   (`context.py`, `host.py`). The gateway's hosts need a profile that admits `service` and
   `history-write` for a verified caller, narrowed per host, without the local trust
   `trusted-local` implies.
7. A client for the HTTP surface: the CLI that scripts and agents call (`call`, `catalog`, and
   `upload` for bundles) sends the call to the gateway's route with the caller's token instead of
   running it in process, and reports `GATEWAY_UNAVAILABLE` when the gateway cannot be reached.

The gateway's commands take no file paths, so each host's execution target is the gateway's data
directory; `repo` selects the GitHub repository and its mirror.

### How the factory and Lushly use it

- **The factory plugin** (Phase 1, in progress): `cell-register` claims through `issue-claim` with
  all of the cell's issues at once (in `cells._claim`, not as a drop-in `GhGitHub`); `lane-enqueue`
  pushes through `branch-push`; the lane renews claims, pushes, opens, records validation, merges
  and reverts through the gateway; `lane-host-set` writes `FACTORY_LANE_HOST` with `variable-set`.
- **Lushly's lane**, until the factory's Phase 4 moves Lushly onto the plugin, calls the gateway
  from its scripts through the gateway's client CLI ([What botcore needs](#what-botcore-needs), 7),
  as it calls `gh` today: `issue-claim.mjs`, the lane's push, pull-request, merge, auto-merge
  cancel and revert steps, and the flake filer.

## Commands (draft)

Names follow `domain-action`; inputs are snake_case, as in the factory. Every call takes `repo`
(refused with `REPO_NOT_ALLOWED` outside the configured repositories), and every refusal carries a
`suggestion`. Every GitHub command can fail with `GITHUB_UNAVAILABLE` (`retryable: true`); retrying
the same call is safe. A refusal GitHub itself gives (a permission, a rule, a state the gateway did
not foresee) is `GITHUB_REFUSED` with GitHub's message, and repeating the call will not help. A
`branch-push` whose ref moved between the gateway's read and its push is `HEAD_MOVED`: the push is
made with git's `--force-with-lease`, so it never overwrites what another writer put there. Effects use botcore's names: reads are `inspect`, GitHub writes `service`,
writes to the gateway's own state `history-write`. Routes: C cell, S session, F foreman, L lane,
O owner, H heartbeat (added 2026-11-24: `gateway-status` and `lane-heartbeat` only, the token a
lane's loop can hold without its queued branches' code being able to merge).

| Command | Routes | Input | Result `data` | Refusals | From |
|---|---|---|---|---|---|
| `gateway-status` | all | — | `host`, `writes[]` (this route's write commands), `identity`, `app`, `repos[]`, `rateLimit { remaining, resetAt, graphql? { remaining, resetAt } }`, `ages { appKey, token, readOnlyToken? }` (`appKey`: seconds since the key file was modified; `token`: seconds left on the current installation token; `readOnlyToken` enters with the cells' read-only token in G1), `journal { bytes, oldest }`, `lastEvent?`, `lanes[] { repo, host, running, stale, queued, lastMergeAt, reportedAt, otherHosts[]? }` (G1; one per repository, each lane's own `lane-heartbeat`, `running` false once the report is `laneStaleMinutes` old) | — | G0 |
| `issue-get` | C S F L O | `number` | `state`, `title`, `labels[]`, `type?`, `parent?`, `subIssues { total }` (G1, with `issue-set`), `assignees[]`, `claim?`, `author { login, association }`, `body { trust, text }`, `linkedPrs[]` | `NOT_FOUND` | G1 |
| `comment-list` | C S F L O | `number`, `limit?`, `cursor?` | `comments[] { id, author, association, trust, text, at }`, `nextCursor?` | `NOT_FOUND` | G1 |
| `claim-list` | C S F L O | `stale?` | `claims[] { number, holder { branch, machine }, leaseUntil, stale, legacy, labelMatches }` | — | G1 |
| `pr-status` | C S F L O | `number` | `state`, `head`, `mergedAt?`, `mergeable`, `settled`, `retryAfterMs?`, `requiredCheck { name, state, stalledMinutes?, cause? }`, `checks[]`, `autoMerge`, `closes[]` | `NOT_FOUND` | G1 |
| `issue-claim` | S F L O | `numbers[]`, `holder`, `lease_hours?` | `claims[] { number, holder, leaseUntil, renewed, previousHolder? }`, `record { label, commentAuthor }` | `ALREADY_CLAIMED`, `ISSUE_CLOSED`, `NOT_FOUND`; none is claimed if any is refused | G1 |
| `issue-release` | S F L O | `number`, `holder`, `reason`, `force?` (owner only) | `released`, `changed`, `record { label }` | `NOT_CLAIMED`, `NOT_HOLDER`, `SECRET_IN_BODY` | G1 |
| `issue-label` | F O | `number`, `add?`, `remove?` | `labels[]`, `previous[]` | `LABEL_UNKNOWN`, `NOT_FOUND` | G1 |
| `issue-set` | F O | `number`, `type?` (`null` clears it), `parent?` (`null` detaches it; a new parent replaces the old); a field left out is unchanged, and at least one is given | `type`, `parent`, `previous { type, parent }`, `changed` | `TYPE_UNKNOWN`, `PARENT_NOT_FOUND`, `NOT_FOUND` | G1 |
| `issue-comment` | F L O | `number`, `body`, `dedupe_key?` | `url`, `deduplicated` | `NOT_FOUND`, `SECRET_IN_BODY` | G1 |
| `issue-create` | F L O | `title`, `body`, `labels[]`, `type?`, `parent?` (the new issue is filed as that issue's sub-issue), `dedupe_key?` | `number`, `created`, `type`, `parent`; a call its `dedupe_key` matches files nothing and completes a missing `type` or `parent` ([Writes that can be retried](#writes-that-can-be-retried)) | `LABEL_UNKNOWN`, `TYPE_UNKNOWN`, `PARENT_NOT_FOUND`, `SECRET_IN_BODY` | G1 |
| `branch-push` | C S L O | `ref`, `head`, `bundle` | `ref`, `head`, `changed`, `by`, `checksPublished[]` (G2) | `PROTECTED_REF`, `REF_NOT_ALLOWED`, `HEAD_NOT_IN_BUNDLE`, `NOT_FAST_FORWARD`, `COMMIT_AUTHOR_NOT_OWNER` (a commit the push adds, not already on `main`, authored by someone other than the owner), `UPLOAD_INCOMPLETE` (the upload does not list the commits leading to `head`) | G1 |
| `pr-open` | L O | `branch`, `title`, `body`, `closes[]` | `number`, `created`, `updated`, `closes[]`, `author`: opens the pull request for the branch, or updates the open one's title, body and closing lines, which the gateway writes | `NO_BRANCH`, `CLAIM_LOST`, `SECRET_IN_BODY` | G1 |
| `verification-record` | L O | `head`, `result` (`passed` or `failed`), `summary` | `check { name, conclusion }` | `NOT_FOUND` (head not on GitHub), `SECRET_IN_BODY` | G1 |
| `pr-merge` | L O | `number`, `head`, `cancel?` | `state` (`merged`, or `queued` under auto-merge bound to `head`, by the repository's merge method; with `cancel`, `open` with auto-merge off and out of the merge queue, as the lane does when it ejects the branch: a pull request the queue already holds is dequeued, since turning auto-merge off leaves it queued ([#2809](https://github.com/lushly-dev/afd/issues/2809)); `merged` with `changed: false` when it merged first), `autoMerge`, `changed`, `dequeued` (with `cancel`; journaled with it) | In this order: `HEAD_MOVED`, `VALIDATION_MISSING`, `CLAIM_LOST`, `CHECK_NOT_REQUIRED` (the required check is not required on `main`, so auto-merge would not wait), `NOT_MERGEABLE`; `MERGE_METHOD_NOT_ALLOWED` when GitHub refuses the configured method; `PR_CLOSED` for a pull request closed without merging; with `cancel`, `STILL_QUEUED` when GitHub still shows it set to merge | G1 |
| `pr-revert` | F L O | `numbers[]`, `reason` | `revertPrs[] { reverts, number, created }` | `NOT_MERGED`, `NOT_FOUND`, `SECRET_IN_BODY` | G1 |
| `variable-set` | F O | `name`, `value` | `name`, `value`, `previous` | `VARIABLE_NOT_ALLOWED`, `SECRET_IN_BODY` | G1 |
| `gateway-audit` | F O | `issue?`, `pr?`, `since?`, `actor?`, `limit?`, `cursor?` | `entries[] { seq, timestamp, command, actor, target, success }`, `outside[] { at, kind, target, by, label? }`, `nextCursor?` | — | G1 |
| `review-record` | C O | `branch`, `head`, `lanes[] { lane, model, effort, verdict, fixed, deferred }` | `record { head, verdict, lanes }`; recording the same head again replaces it | `SECRET_IN_BODY` | G2 |
| `review-get` | C S F L O | `head` | `verdict`, `lanes[]`, `recordedAt` | `NOT_FOUND` | G2 |
| `lane-heartbeat` | L O H | `host`, `running`, `queued`, `last_merge_at?` | `lane` (as `gateway-status` lists it) | `VALIDATION_ERROR` (a time without its zone), `SECRET_IN_BODY` | G1 |
| `gateway-wait` | F L O | `consumer`, `kinds[]?`, `timeout_ms?` | `events[] { id, kind, target, at, sharedAccount?, detail? }`, or `{ events: [], timedOut: true }` | — | G3 |

Every write can also be refused with `WRITE_BUDGET_EXCEEDED`.

**Issue types and parents.** `type` is the type's name as the organization lists it (`Epic`, not
a node id); `TYPE_UNKNOWN`'s suggestion lists the organization's types. `parent` is an issue's
number in the same repository, open or closed; `PARENT_NOT_FOUND` when there is none. GitHub's own
limits (an issue as its own parent, a cycle, 100 sub-issues) come back as `GITHUB_REFUSED`. The
gateway does not enforce triage's two levels; that stays the skill's rule.

**Why `variable-set` has no job of its own.** It exists for the factory's `lane-host-set`, whose
job (the factory's job 02, "move the lane to another machine") covers it.

**Why `issue-set` and the new `issue-create` fields have no job yet.** The owner added them to G1
on 2026-11-26 ([#2515](https://github.com/lushly-dev/afd/issues/2515)), after G1's command
skeleton was built. Their job, filing an epic and attaching its parts, lands with their
implementation ([#2729](https://github.com/lushly-dev/afd/issues/2729)), since every scenario in
`scenarios/` runs against the plugin.

**Not drafted.** No command deletes anything, changes branch protection, reruns or cancels a
workflow, dispatches a workflow, publishes a release or approves a pull request. Those stay with
people.

## Milestones

Each milestone is small enough to ship and use on its own, and lists what it builds, the jobs it
must pass, the process it changes and its exit.

### G0: stand it up

- **Builds:** the App, created and installed by the owner (operator work); the service user on
  `random`; botcore's host changes 1, 2 and 4 ([What botcore needs](#what-botcore-needs)); the
  gateway with `gateway-status`, the five routes, the token CLI and the journal; start on boot; a
  runbook, `docs/operations/factory-gateway.md`.
- **Settles:** squash-merge attribution for App merges; each permission with a test write,
  workflows included; the App's rate limit against a replay of a fleet day's reads.
- **Process:** the runbook and `SETUP.md` in both repositories (operators only; nothing changes for
  agents yet).
- **Exit:** `gateway-status` answers on each route from each of the owner's machines over the
  tailnet, names the App and both repositories, and survives a restart of `random`.

### G1 (MVP): one writer

- **Builds:** every G1 command on the five routes; botcore's host changes 3, 5, 6 and 7; the
  issue-events and comments reader behind `gateway-audit`; the factory plugin's claims, queue push
  and lane steps on the gateway; Lushly's claim script, lane steps and flake filer on the gateway;
  the cutover rule; the cells' read-only token and the hooks. By the owner's decisions of
  2026-11-15: the `/session` route's queue push and sessions handing off to the lane by default;
  the lane on `random`, reported in `gateway-status`; `COMMIT_AUTHOR_NOT_OWNER` and each
  repository's merge method. By the owner's decision of 2026-11-26, issue types and sub-issues:
  `type` and `parent` on `issue-create`, and `issue-set`
  ([#2515](https://github.com/lushly-dev/afd/issues/2515)). A session that opens an epic does not
  get them until G5: `/session` makes no issue writes other than claims until then.
- **Jobs:** `mvp` (01 to 11, 15 and 16, and the job for issue types and parents that
  [#2729](https://github.com/lushly-dev/afd/issues/2729) adds).
- **Process** (the manifest's G1 entry):
  - AFD: `AGENTS.md` (factory agents reach GitHub through the gateway, never `gh` writes);
    `triage-issues` (its `references/epics.md` files epics and attaches their parts through
    `issue-create` and `issue-set` on the foreman's and owner's routes, and keeps `gh` for a
    session until G5); `prepare-pr` lane mode, the default for sessions; the factory's `run-fleet`; botcore's `factory` docs
    topic and catalog descriptions; the cell hook and its Codex equivalent; the MCP configuration
    that registers the gateway's routes.
  - Lushly: `AGENTS.md`'s "Claim an issue before starting it" line; `INIT.md`'s claiming section;
    `start-session` (sessions claim on `/session`), `prepare-pr` (sessions hand off to the
    lane by default), `triage-issues` (epics through `issue-create` and `issue-set`, and `gh` for a session until G5), `run-fleet`, `end-session`;
    `Docs/operations/merge-lane.md`; the scripts above (`issue-claim.mjs`, `merge-lane-worker.mjs`,
    `merge-lane-operations.mjs`, `merge-lane-ci.mjs`, `final-validation-flakes.mjs`); its MCP and
    hook configuration; a `skill-seed --update` for any seeded Botcore skill that changed.
  - AFD's `start-session` claims on `/session` too.
- **Exit:** every `mvp` scenario passes against the plugin. One fleet run in each repository ends
  with every factory write to GitHub made by the bot and found in the journal, no write to a
  claimed issue or factory pull request during the run that the journal does not hold, and the
  number of GitHub requests per merge reported against Lushly's pre-gateway count. The G1 process
  checks pass in both repositories.

### G2: review as a record

- **Builds:** `review-record`, `review-get`, and the `factory/review` check published on push; the
  lane's `REVIEW_MISSING` reads `review-get` for the exact head.
- **Jobs:** `records` (12).
- **Process:** AFD `prepare-pr` and `review-code`; Lushly `review-code-lushly` and its
  `review-lanes.md`, `prepare-pr`, `scripts/check-review-lanes.mjs --verify-handoff`; the
  pull-request body guidance in both stops asking for a hand-written review table. Making
  `factory/review` a required check is a gate change and goes through each repository's gate rules.
- **Exit:** the `records` scenario passes; a fleet run's pull requests carry the review as a check,
  and no skill asks for the hand-written table.

### G3: events, not polling

- **Builds:** pull-request and check-run polling with conditional requests, `gateway-wait`, stall
  detection, coalesced T3 Code wakes; the lane's CI wait and the foreman's `owner-replied` come from
  gateway events.
- **Jobs:** `events` (13, 14).
- **Process:** the factory's `run-fleet` and Lushly's `run-fleet` drop their polling guidance;
  `merge-lane.md`'s CI wait section; Lushly's `end-session` and `lushly-worktree-discipline` read
  `pr-status` instead of `gh api .../pulls/<n> --jq .merged`.
- **Exit:** the `events` scenarios pass; a fleet run's foreman wakes come from gateway events, and
  a GitHub Actions stall during a run pauses the lane without an ejection.

### G4: no credential outside the door

- **Builds:** cell tokens issued by `cell-register` and bound to the cell's queue ref; agents
  (cells and the foreman) run as an operating-system user, or on a machine, where no gateway token
  of another class and no `gh` sign-in is readable; the lane runs a branch's validation as a user
  with no token at all, so code under validation cannot reach a credential; the read-only token and
  the G1 hooks are retired.
- **Jobs:** the `boundary` property of job 15 (a cell's token pushes only its own queue ref), shown
  by the plugin's unit tests, and the exit below.
- **Process:** the factory's cell start, Lushly's `run-fleet` and `lushly-worktree-discipline`,
  `SETUP.md` in both repositories. Lushly's `scripts/post-merge-backstop.mjs`, which only a
  workflow runs, with Actions' own token: whether a script only a workflow runs stays outside the
  door (the door's exclusions name it) or writes through it.
- **Exit:** a test cell that tries `gh issue edit`, `git push` or another cell's queue ref fails
  for lack of a credential, not because a hook refused it; a test branch whose tests try to read
  the lane's token finds none.

### G5: sessions through the door

Interactive sessions (Lushly's `start-session` to `prepare-pr` outside a fleet) claim through
the `/session` route from G1, but every other write they make (pushes, pull requests, comments,
authorised merges) still uses the owner's `gh` sign-in after G4, so a write from his account is
still ambiguous. G5 widens the `/session` route to those writes, including merging its own pull
request when authorised, so the owner's account writes only as the owner. It is specified when G4
exits, unless the owner ranks it earlier. Handing a branch to the lane moved to G1 (the owner's
decision of 2026-11-15), so sessions no longer merge to `main` themselves from G1 on.

## Keeping the process current

The owner's direction is that each milestone updates the skills, tools and `AGENTS.md` that use it
as it lands. Two checks make that hold, in each repository, both gate changes that go through that
repository's gate rules (AFD's `gates.md`, Lushly's `lushly-gate-discipline`):

- **The manifest.** Each repository keeps its own half of the process manifest, so that a rename
  and the manifest change in the same pull request: AFD's is `process.json` in this folder,
  Lushly's `Docs/operations/factory-gateway/process.json`. Each lists, per milestone, every file
  of its repository the milestone changes (instruction files, skills, runbooks, scripts, hook and
  MCP configuration) and the gateway commands each must name. Every listed file must be tracked;
  once a milestone is marked landed there, the check fails until each listed file names its commands.
  The check is AFD's `scripts/check-process.mjs`, which holds the door's patterns and which
  Lushly syncs.
- **The door.** A check fails when an instruction file, skill, runbook, script, hook or MCP
  configuration runs or tells an agent to run a `gh` write the gateway serves, outside an allowlist
  in the manifest. Each allowed file names the milestone that removes it (the interactive-session
  skills and runbooks are allowed until G5), why it may write until then and the issue that
  removes it, and the check fails on an allowed file once that milestone has landed.

A milestone is done when its code and its process files have merged in both repositories, the two
checks pass, and `STATUS.md` names every file and the pull request that changed it. AFD's seeded
skills reach Lushly through `skill-seed --update`, which is a listed step wherever a seeded skill
changes.

## Security

| Threat | Answer |
|---|---|
| The App key leaks from `random` | The file is readable only by the service user; the gateway never returns an installation token; the App has no administration permission, so it cannot remove protection; `gateway-status` reports the key's age, and rotation is in the runbook |
| A caller's token leaks | Tokens are per caller and revoked with the operator CLI; the route listens on the tailnet only; the write budget bounds the damage before anyone notices |
| An agent is misled by text in an issue | Issue text arrives labelled content; cells have no write but their queue ref; the foreman has no merge or push; the lane merges only a head it recorded as validated |
| Code under validation reaches a credential | Until G4, a branch's tests run where the lane's token and the owner's sign-in are readable, as they do today; G4 runs validation as a user with neither |
| A caller forges a claim by writing the marker comment | Only the bot's comments count, apart from the owner's own claims during the cutover; claims are written only by the gateway |
| An agent bypasses the gateway with the owner's sign-in | G1 makes it harder (read-only token, hooks) and visible (`gateway-audit`); G4 removes the credential; G5 removes the ambiguity |
| A secret is posted to a public issue | Every text field is checked against secret rules before any write (`SECRET_IN_BODY`); the journal keeps only allowlisted context |
| A bug lets the gateway write to `main` | `branch-push` refuses protected refs, and branch protection on GitHub refuses them anyway |

## Alternatives considered

- **Entire.** It captures sessions and adds a forge on top of GitHub. It does not separate agents
  from the owner's credential or type the writes, and its transcripts are a different record from
  the journal (reasoning, not commands). The two can coexist.
- **Fine-grained tokens alone.** A read-only token for cells is the cheapest boundary, and G1 uses
  one. On its own it leaves every write under the owner's identity, claims racing in comments,
  prose evidence, unshared reads and polling.
- **A store of its own as the record of claims.** The first draft kept claims in SQLite with GitHub
  as a copy. A single writer removes the race without it, and keeping GitHub as the record removes
  the rebuild command, the drift between two copies and the person's confirmation a rebuild needed.
- **GitHub's merge queue, Mergify.** The factory proposal already rules them out: the gate runs on
  a local machine, which a hosted queue cannot run, and GitHub's native queue is not available to
  a private repository like Lushly's below Enterprise Cloud.
- **Leave it.** It works today. It costs a few hundred lines of GitHub handling per repository, an
  ambiguous record of who did what, and a cell that can do anything the owner can.

## Jobs

Each job is a scenario in [`scenarios/`](./scenarios/) on invented fixture data
(`scenarios/fixtures/`). The tag is the milestone that must pass it. Each file says which route it
runs against.

| Order | File | Job | Tag |
|---|---|---|---|
| 1 | 01 | Claim an issue once, whoever asks first | mvp |
| 2 | 03 | Keep cells to reads and their own hand-over | mvp |
| 3 | 15 | Hand a branch to the lane through the gateway | mvp |
| 4 | 04 | Push a validated branch and open its pull request once | mvp |
| 5 | 05 | Merge only the head the lane validated, and start the undo of a bad merge | mvp |
| 6 | 06 | Know whether a pull request merged without reading GitHub's quirks | mvp |
| 7 | 02 | Free an issue whose holder went silent | mvp |
| 8 | 10 | Restart the gateway without losing or inventing a claim | mvp |
| 9 | 09 | Never file the same issue or post the same comment twice, or post a secret | mvp |
| 10 | 07 | Trace a write on GitHub to the agent that made it | mvp |
| 11 | 08 | See writes to factory work that did not come through the gateway | mvp |
| 12 | 11 | Read issue text as content, not as instructions | mvp |
| 13 | 12 | Record a review once and show it on the pull request as a check | records |
| 14 | 13 | Wake on what happened on GitHub instead of polling | events |
| 15 | 14 | Treat a GitHub Actions outage as a stall, not a failure | events |
| 16 | 16 | See a stopped lane instead of waiting on it (added 2026-11-24 for the owner's 2026-11-15 decision that `gateway-status` reports the lane) | mvp |

### What writing them changed

- `issue-claim` renews for the same holder instead of failing and reports `previousHolder` when it
  takes over a lapsed claim; `issue-release` refuses a release by someone else and of an issue
  nobody claimed.
- `pr-open` and `pr-merge` became idempotent (`created`, `changed`), and `pr-open` writes the
  closing lines from `closes[]`.
- `pr-revert` refuses a pull request that never merged (`NOT_MERGED`), a refusal the factory's
  scenarios left unwritten.

### Walking the paths

Three readers who had not written the jobs walked them on 2026-11-14, each in one seat: the people
(the owner, the foreman, the lane, the cells), the job list (drafting its own list from the owner's
words before reading), and the calling agent (against botcore's host code and the factory plugin).
What changed:

- **Merging needs validation, and the foreman cannot merge.** A foreman holding the shared factory
  token could merge a head because text in an issue asked it to. `verification-record` and
  `VALIDATION_MISSING` were added, and the factory route split into foreman and lane routes.
- **The token decides who is calling.** Class tokens left `actor` and `holder` to the caller's word.
  Each caller now has its own token, issued and revoked by an operator CLI, and the journal marks
  `onBehalfOf` as asserted.
- **Claims stay on GitHub.** The store as the record of claims, its rebuild command and the
  person's confirmation the host cannot provide were replaced by a single writer over the existing
  marker, a cache rebuilt at start, and a cutover rule for claims the owner's account wrote (job 10,
  rewritten).
- **The claim lifecycle is complete:** atomic multi-issue claims (`numbers[]`, as `cell-register`
  needs), renewal by the lane, release on merge, `CLAIM_LOST` for a holder that lapsed and woke, and
  an owner override.
- **Cells already push.** `lane-enqueue` pushes the cell's head from its worktree, which G1's
  read-only token would have broken. `branch-push` to the cell's queue ref moved into G1 (job 15,
  rewritten).
- **Botcore's host is described as it is:** names registered as snake_case, no context for the
  journal, no confirmations or output budgets, no caller authentication, and one execution target
  per host. [What botcore needs](#what-botcore-needs) lists the changes; claims about the host that
  the code does not support were removed.
- **Inputs work across machines:** inline bodies instead of paths, the upload route documented,
  full SHAs only, every write retriable, `GATEWAY_UNAVAILABLE` apart from `GITHUB_UNAVAILABLE`.
- **Safety at volume:** a write budget per caller, a secret check on every body (`SECRET_IN_BODY`),
  coalesced foreman wakes, `owner-commented` marked as possibly an agent, and G4 now covers code
  under validation reaching a credential.
- **The owner's opening ask is answered:** shared, conditional reads and the request count per
  merge in G1's exit.
- **The process mechanism is checkable:** a manifest per milestone of the files and the commands
  each must name, and a door check that also covers scripts, hooks and MCP configuration, the
  Codex hook, and `skill-seed`.
- **Smaller:** polling instead of Tailscale Funnel for events, which needs no public endpoint;
  `check-publish` removed, since the gateway publishes checks from records; App permissions gained
  workflows.
- **Jobs reworded to their outcomes:** 05 starts the undo rather than finishing it; 14 lets the lane
  pause, which is the factory's rule.

Declined, with the reason:

- **A command to rerun or cancel a stuck workflow.** GitHub does not rerun a queued run, and
  cancelling one is a judgement the lane's pause leaves to a person.
- **Moving sessions (G5) earlier.** That is the owner's call, so it is a question for him.
- **Undoing a caller's writes in bulk.** The write budget bounds a bulk mistake, and `issue-label`
  returns `previous[]` for a targeted repair.

### What scenarios cannot show

- Every step runs as the same test actor, so each file names the route it runs against. Which token
  reaches which route, the token's binding to a cell's queue ref (G4), the foreman's lack of
  `pr-merge` and `issue-release` with `force` are covered by the plugin's unit tests.
- The clock cannot move between steps, so lapsed leases (02), the cutover window (10) and stalls
  (14) start from fixtures already past their limits. Releasing claims on merge and renewing them
  on each lane loop happen between commands and need unit tests.
- `expect` cannot read an error's `details`, so the holder in `ALREADY_CLAIMED` and the head in
  `HEAD_MOVED` are asserted through the message.
- Whether shared reads lower GitHub requests, whether the write budget is the right size, and
  whether the hooks and the bot identity keep agents off the owner's sign-in in practice are
  measured by G1's exit over real fleet runs.

### Checks

Run 2026-11-14 after the walks' revision
([jobs first](../../../../.claude/skills/afd/references/jobs-first.md)): `afd scenario validate`
and the dry-run check pass all 15 files (70 steps) with fixtures resolved. The coverage report
uses 19 of 20 drafted commands (all but `variable-set`, explained above) and 17 of 24 error codes;
no scenario calls an undrafted command.

Seven refusals have no scenario. Five depend on the environment or on GitHub, which a fixture
cannot produce: `GITHUB_UNAVAILABLE`, `GATEWAY_UNAVAILABLE` (produced by the client),
`CHECK_NOT_REQUIRED` (branch protection read from GitHub), `NOT_MERGEABLE` (a conflict GitHub
computes) and `NOT_FAST_FORWARD` (ancestry a fixture does not model). `VARIABLE_NOT_ALLOWED` belongs
to `variable-set`, which has no job here, and `WRITE_BUDGET_EXCEEDED` needs volume. The plugin's
unit tests cover all seven.

### Review

An independent reviewer (Opus 5.5 at high effort) read the revision on 2026-11-14 and checked the
code and GitHub facts. What changed: the event sources (the repository-wide events feed carries no
check runs and lags up to six hours, so G1 polls issue events and comments and G3 polls pull
requests and check runs); a `/session` route in G1 so interactive sessions' claims go through the
single writer too; the cutover counts a legacy claim only when the owner's account wrote it before
the cutover, by its own liveness rule; `pr-merge` merges at once when the pull request is already
clean, since GitHub will not enable auto-merge then; botcore's sixth change, a profile for remote
callers; the secret check on every text field; `comment-list` in place of `issue-comments`; the
manifest's scripts and dated allowlist; and fixture fixes (numbers shared by issues and pull
requests, a fresh head for the review push, filtered waits).

A focused pass by a second fresh reviewer (Opus 5.5, high effort) verified the fixes and found what
the lane still did through
`gh`: turning auto-merge off when it ejects a branch, and updating an open pull request. `pr-merge`
gained `cancel` and `pr-open` updates in place. It also added botcore's seventh change (a client for
the HTTP surface), the `/session` route in G0's diagram and build, pushes in the audit's sources,
`SECRET_IN_BODY` on every text input, the refusal order for `pr-merge`, the hook and MCP
configuration and the sweepers in the manifest, and fixture fixes (event kinds as the endpoints name
them, the cutover's start, a created issue referenced by step).

## Not in this proposal

- A replacement for pull requests, review interfaces or repository hosting.
- Approvals for person-only actions (releases, production). AFD's approval tokens fit them, and
  they can be added once G5 settles the caller classes.
- Session capture. The journal records what agents did, not their reasoning.
- A second gateway for availability.

## Exit criteria

- G0: `gateway-status` on each route from each of the owner's machines, after a restart of
  `random`.
- G1: every `mvp` scenario passes; one fleet run per repository with every factory write by the bot
  and journaled, no unjournaled write to factory work, and requests per merge reported; the G1
  process checks pass in both repositories.
- G2, G3, G4: their scenarios or tests pass, their exits above are met, and their process checks
  pass.
- G5: specified when G4 exits.

## For the owner

1. **Jobs.** Cut, add and rank the fifteen jobs. The order above is the proposed build order.
2. **The App.** A new App for the factory, separate from AFD's release App, so the factory cannot
   publish and the release flow cannot merge. Recommended.
3. **Lushly before Phase 4.** Move Lushly's claim script and lane writes onto the gateway in G1,
   before the factory's Phase 4 moves Lushly onto the plugin, because Lushly is where fleets run
   now and G1's exit needs a real run. Recommended; the client code is small and is deleted in
   Phase 4.
4. **Sessions (G5).** Leave interactive sessions' writes other than claims on the owner's sign-in
   until G4 exits, or rank G5 earlier so that writes from his account are his alone sooner. Leaving it is recommended, since
   the fleet is where agents write at volume. *Answered in part on 2026-11-15:* sessions hand off
   to the lane from G1 ([Decisions](#decisions)); their other writes stay as recommended.
5. **Webhooks.** Events by polling with conditional requests (recommended: no public endpoint), or
   GitHub webhooks through Tailscale Funnel on one path of `random` for faster events.
6. **G4's separate users.** An operating-system user for agents and one for validation on each
   machine that runs them, which is operator work on each. *Answered on 2026-11-15:* G4 stays
   last and nothing is set up for other people until there are some ([Decisions](#decisions)).
