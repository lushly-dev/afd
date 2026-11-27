# Factory Gateway: status

Epic: [#1550](https://github.com/lushly-dev/afd/issues/1550). File new work for this area as its sub-issue.

Read this before the [proposal](factory-gateway.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- A milestone is done only when its process files have changed too, in both repositories, and the
  two process checks pass
  ([Keeping the process current](factory-gateway.proposal.md#keeping-the-process-current)). Record
  each file and the pull request that changed it in the milestone's row, and mark the milestone
  `landed` in [`process.json`](process.json) in the same pull request.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** active by the owner's direction of 2026-11-14. The proposal merged on 2026-11-14 as
  [#1222](https://github.com/lushly-dev/afd/pull/1222) (merge commit `57397cdb`), so it is no
  longer in review. Work started on 2026-11-14 in a session on `random`, the machine the gateway
  will run on: botcore's host changes and G1's command skeleton against a fake GitHub, which need
  no GitHub App. The owner's ranking of the jobs, the six questions in
  [For the owner](factory-gateway.proposal.md#for-the-owner) and the App (G0) are still his.
- **Last verified:** 2026-11-24 (dates in this file are Pacific time): the gateway updated to
  `c22624e1` by the new `install.sh`, built beside the running code, below; earlier the same
  day to `6819de18` with the `/heartbeat` route. 2026-11-23: the rate-limit replay
  through the deployed gateway, the gateway updated to `3fe08c00`, then to `36aed322` with
  the read cache, to `317accc6` with the validation-lag fix and to `dde05aa3` with the lanes'
  health, all below. 2026-11-21:
  G0's exit, after a restart of `random`, from all three machines; also the rebase-credit test, the variables write
  and the runbook's install script, all below. On 2026-11-20: G0's test writes in Lushly. On 2026-11-19 against `main` at `d742f591`: the gateway runs on `random` as a launch daemon built from that commit. Over the
  tailnet with the owner's token, `factory-gateway call gateway-status` answered as
  `lushly-factory-gateway[bot]` for both repositories with a rate limit of 5000, and `issue-get`
  (afd#1550, lushly#2392) and `pr-status` (#1627) read the real GitHub.
- **Done:** the proposal, jobs and manifest (#1222); botcore's host changes 1, 2, 5 and 6
  ([#1230](https://github.com/lushly-dev/afd/pull/1230), merged 2026-11-15); the G1 command
  skeleton in `botcore-factory` against a fake GitHub, all fifteen jobs of 2026-11-15 passing
  ([#1232](https://github.com/lushly-dev/afd/pull/1232), merged 2026-11-15); the commit-credit
  check in both repositories' `ci-ok` ([afd#1250](https://github.com/lushly-dev/afd/pull/1250),
  [lushly#2403](https://github.com/lushly-dev/lushly/pull/2403)).
- **Reviewed and merged in #1265:** `COMMIT_AUTHOR_NOT_OWNER` (a push adding a commit the owner did not author,
  checked only for commits GitHub does not already have), each repository's merge method
  (`mergeMethods`, a merge commit by default; `MERGE_METHOD_NOT_ALLOWED` when GitHub refuses
  it) and the `/session` route's push to its queue ref; job 15 gained the author step
  ([#1265](https://github.com/lushly-dev/afd/pull/1265)). An independent review (Opus 5.5) found
  three blockers, all fixed: an upload without a commit list passed the check (now
  `UPLOAD_INCOMPLETE`), "GitHub already has it" exempted agent commits on any branch (now only
  commits on `main` are exempt, through the port's `on_main`), and the auto-merge path's method
  was untested. Its upload route (botcore change 4) must read commits and authors from the bundle,
  never from the caller. Open: a session or cell can overwrite another branch's queue ref, since
  the fast-forward rule covers only `refs/heads/`.
- **Done since:** the credit and handoff rules (`COMMIT_AUTHOR_NOT_OWNER`, each repository's
  merge method, the `/session` queue push;
  [#1265](https://github.com/lushly-dev/afd/pull/1265)); botcore's changes 4 and 7, the HTTP
  surface with per-caller tokens and its client
  ([#1267](https://github.com/lushly-dev/afd/pull/1267), merged 2026-11-15 as `b5d175fe`); the
  gateway as a server (`factory-gateway-admin serve`, `token issue|list|revoke`;
  `factory-gateway` for callers) with bundle uploads read by git into a bare mirror per
  repository ([#1271](https://github.com/lushly-dev/afd/pull/1271), merged 2026-11-15 as
  `270f4450`). Security passes (Opus 5.5) found three blockers across #1267 and #1271, all fixed
  with tests.
- **Done since:** the App-backed adapter, `serve --app-key` and pushes leased on the head they
  read, which closes the queue-ref overwrite gap
  ([#1290](https://github.com/lushly-dev/afd/pull/1290), merged 2026-11-15 as `396e61b9`); the
  key's permission check on Windows ([#1360](https://github.com/lushly-dev/afd/pull/1360)); an
  explicit body on every squash merge ([#1520](https://github.com/lushly-dev/afd/pull/1520)); the
  lane and gateway behind a merge queue ([#1627](https://github.com/lushly-dev/afd/pull/1627),
  merged 2026-11-19).
- **The App (G0):** created and installed by the owner on 2026-11-15: `lushly-factory-gateway`,
  App ID `5777732`, installation `182417554` on `lushly-dev`, limited to `lushly-dev/afd` and
  `lushly-dev/lushly`, with the proposal's permissions (actions and metadata read; actions
  variables, checks, contents, issues, pull requests and workflows read and write). The owner
  generated its private key on 2026-11-19 (no client secret exists); it went through the secure
  prompt straight to the service user, never through chat.
- **The service on `random` (G0):** installed 2026-11-19 as the launch daemon
  `dev.lushly.factory-gateway`, running as the hidden account `_factorygw` (no login). The app
  and its Python live root-owned in `/Library/FactoryGateway/app`, since 2026-11-24 a link to
  a release in `releases` (below); state in `data` (service
  only), the configuration and key in `etc` (the key mode 0600, the service's), the log in `log`.
  It listens on `random`'s tailnet address, port 8787. The owner's token is in
  `~/.config/factory-gateway/owner.token` on `random`. Its configuration squashes in both
  repositories (`mergeMethods`, 2026-11-19, since AFD became squash-only; superseded for Lushly
  on 2026-11-21, below). Both mains fetched at startup (the log shows no fetch warning across
  two starts; not read again after the restart of 2026-11-21). It survived that restart
  (G0's exit, below).
- **Operating it:** the [runbook](../../../operations/factory-gateway.md), with the install
  script, the launch daemon and an example configuration beside it. On 2026-11-21 its two
  scripts ran on `random` as they stand at commit `8c72670c` of
  [#1834](https://github.com/lushly-dev/afd/pull/1834), which lists what changed in them after that run. Six refusals each left
  the daemon running under the same process: `install.sh` given a configuration the gateway
  would not load, a staged configuration that was a link to a file only root reads, a key file
  holding no key, and a key path that was a link to the installed key; `reconfigure.sh` given
  the bad configuration and the link. Then `install.sh` in its update form, with a good
  configuration staged and no key passed, rebuilt the service from `main` at `bc7ae160` and
  kept the key, the tokens and the journal, and `reconfigure.sh` installed a configuration,
  kept `gateway.json.prev` and restarted the daemon. Not run in this form: a first install (no
  account, key or configuration there yet); a real key passed in (the key's check ran only
  against a throwaway key, off the machine); and a staged configuration the old code accepts
  and the new code refuses. The service was first built on 2026-11-19 by an
  earlier form of the script.
- **Every route, from two machines (2026-11-21):** `gateway-status` answered on `cell`,
  `session`, `foreman`, `lane` and `owner` from `random` and from `macbook-air` over the tailnet,
  naming the App and both repositories; a `cell` token was refused on `/lane` (`FORBIDDEN`). The
  four test tokens (actors `g0-check@<route>`, in `~/.config/factory-gateway/g0/` on `random`)
  are to be revoked at G0's exit. Not checked: from `hero`, which `random` cannot reach by SSH.
  Its open items are superseded by G0's exit, next.
- **G0's exit, met 2026-11-21:** the owner restarted `random`. The daemon came back by itself
  (launchd records two runs since boot: the first exited with code 3, the second has run since;
  the log, readable only as root, was not read). Then `gateway-status` answered on all five
  routes, naming the App and both repositories: from `random` and from `macbook-air` at about
  04:28, and from `hero` at 04:32–04:33 (a session there, through T3, fetching each token over SSH
  without printing it; a call with no token got 401). The four test tokens were then revoked
  (`token list` shows them revoked and only the owner's active; a revoked one now gets
  `UNAUTHORIZED`) and their copies on `random` deleted.
- **G0's test writes (2026-11-20, Lushly, owner route):** issues: `issue-create`, `issue-label`,
  `issue-claim`, `issue-comment` and `issue-release` on
  [lushly#2706](https://github.com/lushly-dev/lushly/issues/2706), all by the bot. Contents and
  pull requests: `upload`, `branch-push` and `pr-open` made
  [lushly#2707](https://github.com/lushly-dev/lushly/pull/2707) from one commit the owner
  authored, and its push started Lushly's CI (`ci-ok` passed). Checks: `verification-record`
  published `factory/verification` as success. Workflows: `branch-push` of a change to
  `.github/workflows/` on a throwaway branch succeeded (the branch was then deleted).
  Variables (2026-11-21): as the service account, the App's adapter created, updated and
  deleted `FACTORY_GATEWAY_G0_CHECK` in Lushly, outside `variable-set`, whose only allowed name
  holds Lushly's live lane host. G0's own calls over three days never left the App under 4,991
  of 5,000 an hour (before the replay below).
- **Rate limit, settled 2026-11-23: the App's budget carries a fleet's busiest hour, REST and
  GraphQL both read live.** Both limits are hourly, so the busiest hour decides whether a day
  fits. The scripts and results are in [rate-replay/](rate-replay/README.md).
  - **Demand:** every `gh` read agents ran in AFD and Lushly on five of the busiest days
    (2026-11-03, -07, -09, -21 and -23), from the Claude and Codex transcripts on `random` and
    `macbook-air` (`hero` was unreachable). Polling loops are counted by how long they ran
    over their sleep. Each read is mapped to the gateway read that answers it: `gh pr view`,
    `pr checks` and `run view|list` to `pr-status`; `issue view` to `issue-get` or
    `comment-list`; `issue list`, `pr list` and `search` to `claim-list`.
  - **Cost per read:** the gateway's own `Gateway` and `GitHubApp` code, run through a metering
    transport. Its REST counts match `gateway-status` on the deployed gateway. `pr-status` is
    2 REST calls and 1 GraphQL point on an open pull request, `issue-get` 1 REST and 7 points,
    `comment-list` 1 point, `claim-list` 16 to 18 points (GitHub's own `rateLimit { cost }`).
    `claim-list` and `issue-get` grow with the backlog: they page through every open issue or
    pull request, and the 100 latest closed ones.
  - **Busiest hours:** priced as if every pull request were open, and every `claim-list` at 18
    points, they were 246 REST calls (2026-11-09, 23:00) and about 1,315 GraphQL points
    (2026-11-23, 00:00), of 5,000 an hour each.
  - **Replay:** those two hours and 2026-11-21's 18:00, 410 reads, went through the deployed
    gateway with four callers in about 8 minutes, inside one rate window. They used 347 REST
    calls (4,990 to 4,643; 457 if every pull request had been open, less since many had
    merged) and about 2,850 GraphQL points at the upper costs. Nothing failed except 13
    `NOT_FOUND`s, where the replay read a `--limit` value as a number.
  - **GraphQL read live:** the build that ran the replay (`bc7ae160`) could not report GraphQL's
    budget. Once the gateway ran `3fe08c00` (below), the App's GraphQL window that held the
    replay (02:44 to 03:44 UTC) read 4,278 of 5,000. That is at most 722 points for the replay
    and every other App call in the window, a quarter of the computed 2,850, so the computed
    figures are upper bounds. Read one at a time afterwards, `claim-list` showed 4 points and
    `issue-get` and `pr-status` none, though `issue-get` makes four queries: unexplained, and
    perhaps lag in GitHub's budget reading.
  - **Not counted:**
    - `hero`'s sessions;
    - the Lushly lane's own calls;
    - `gh` inside scripts and botcore commands;
    - T3 Code's GitHub tools (`pull_request_*`, the issue tools);
    - polling in background shells;
    - loops without `sleep` or `seq`, counted as three passes;
    - writes, at most 46 an hour;
    - reads that have no gateway command yet (`gh pr diff`, raw GraphQL, sub-issues, job
      logs), 91 in the busiest hour for them.
  - **Margin:** even at the computed costs, and 10 points for each of those 91, the busiest
    hour would be about 2,200 points. Everything else uncounted would need to add more than
    twice what `random` and `macbook-air` read together before GraphQL ran out; at the charges
    read live, several times that.
  - **Found:** `claim-list` (9 to 18 s) and `issue-get` (5 s) scan every open issue or pull
    request on each call, and no read is cached
    ([#2385](https://github.com/lushly-dev/afd/issues/2385)).
- **Read cache ([#2385](https://github.com/lushly-dev/afd/issues/2385)): merged in [#2394](https://github.com/lushly-dev/afd/pull/2394).**
  The repository scans behind `claim-list`, `gateway-audit` and `gateway-wait` are shared by
  every route for `cache.graphqlSeconds` (15), one scan at a time, and dropped by any write
  through the gateway to that repository; writes that de-duplicate still read GitHub.
  `issue-get` reads only the issue: its claim from the issue's own comments and `linkedPrs`
  from GitHub's closing references (all states, so older merged pull requests now count),
  where it paged every open and 100 closed pull requests. `pr-status` reads check runs once.
  Conditional REST requests (`ETag`) are not built: REST is the looser budget. Deployed on
  `random` on 2026-11-23 by the runbook's code update to `main` at `36aed322`, configuration
  kept: `claim-list` for AFD took 9.6 s, and again within the window 0.2 s.
- **Squash credit, settled 2026-11-20: an App's squash takes the credit.** `pr-merge` squashed
  lushly#2707 as `72adbcc5`, whose author is `lushly-factory-gateway[bot]` and committer GitHub,
  with no line for the owner, who wrote its only commit (`bc996e25`): the gateway's explicit
  body ([#1520](https://github.com/lushly-dev/afd/pull/1520)) leaves out the `Co-authored-by`
  line GitHub would otherwise add, and with it the owner would still be only a co-author. In
  AFD's merge queue the squash would carry that line and `ci-ok` refuses any co-author, so an
  App's pull request cannot merge there at all. Until the owner chooses how factory merges keep
  his credit, the gateway must not merge: lushly#2707 is the only such merge. Superseded for
  Lushly on 2026-11-21 by the owner's choice, next.
- **Rebase credit, settled 2026-11-21: a rebase merge by the App keeps the owner as author.**
  By the owner's decision the gateway rebase-merges one commit he authored. Lushly now allows
  rebase merging and the gateway's `mergeMethods` says `rebase` for it. `pr-merge` landed
  [lushly#2782](https://github.com/lushly-dev/lushly/pull/2782) as `2a5fd602`: author the
  owner, committer `lushly-factory-gateway[bot]`, the message unchanged, and `ci-ok` passed on
  `main`. Two effects: the commit is unsigned, as every rebase merge GitHub makes is, and its
  subject carries no pull request number. AFD is not done: its merge queue squashes every pull
  request, so the gateway must not merge in AFD until
  [#1809](https://github.com/lushly-dev/afd/issues/1809) moves the queue to rebase (done in its
  step 4, below).

- **#1809 step 1, the probe (2026-11-21):** GitHub's rebase merge drops a branch's merges of
  `main` and lands each of its own commits as it is, author kept, unsigned (lushly#2811 into a
  throwaway base). **Step 2, one commit per pull request: merged in
  [#1901](https://github.com/lushly-dev/afd/pull/1901)** for sessions: `pnpm branch:squash`
  folds a branch into one commit on the `main` it merged, same tree, and carries the
  `pnpm verify` record; `prepare-pr` pushes one commit; and `ci-ok` refuses more than one once
  `main`'s queue rebases (dormant while it squashes). **The lane's half, merged in
  [#1920](https://github.com/lushly-dev/afd/pull/1920):** the
  lane folds each merged slot into one commit on the base, same tree, authored and committed as
  the branch's own commits were, before it validates, so what it pushes and merges is one
  commit; a branch with no commit of its own, with two author addresses, or whose message
  folds to nothing is ejected. **Step 3, the texts, merged in
  [#1956](https://github.com/lushly-dev/afd/pull/1956) just before the switch:** the skills,
  workflow comments and gateway docs describe the rebasing queue; `commit-credit.mjs` names a
  co-author's fix by how the queue merges. **Step 4, switched 2026-11-22 with the owner's
  go-ahead and the queue empty:** AFD allows rebase merges only, and the "main merge queue"
  ruleset's `merge_method` is `REBASE` (only that changed, from `SQUASH`; the repository
  allowed squash merges only before). The deployed gateway's `mergeMethods` for AFD was set to
  `rebase` on 2026-11-23, with its code updated to `main` at `3fe08c00` by the runbook's
  `install.sh` (the replaced file kept as `gateway.json.prev`). The first queue rebases
  (`da923b15` and three others) kept the owner as author, with the enqueuing account as
  committer, unsigned and no ` (#n)` in the subject; `main-credit` passed on each push. Without
  the number botcore's skill-usage audit read every change as `no_pull_request`
  ([#2023](https://github.com/lushly-dev/afd/issues/2023)): `pnpm branch:squash` now ends the
  folded subject with the open pull request's number
  ([#2088](https://github.com/lushly-dev/afd/pull/2088)); the lane's half waits, by the owner's
  decision of 2026-11-22, until [#1887](https://github.com/lushly-dev/afd/issues/1887) is
  designed. **Closed 2026-11-23:** the first merge the gateway's App enqueued in AFD,
  [#2400](https://github.com/lushly-dev/afd/pull/2400) by `pr-merge`, landed as `38f5c2bb`:
  author the owner, committer `lushly-factory-gateway[bot]`, unsigned, the subject keeping
  ` (#2400)` from `pnpm branch:squash`, and `main-credit` passed. The App's queued merges keep
  the owner's credit as a session's do.
- **Validation lag ([#2401](https://github.com/lushly-dev/afd/issues/2401)), found 2026-11-23:**
  that `pr-merge`, a second after its `verification-record`, was refused as
  `VALIDATION_MISSING`: GitHub's check-runs list had not yet listed the run, and the lane
  records and merges in that order every time. Fixed in
  [#2403](https://github.com/lushly-dev/afd/pull/2403): the
  gateway keeps its own record of each validation for a week and lets it decide (only it
  writes `factory/verification`); a failure is kept before its check run, a pass after.
  GitHub's list answers for heads with no record in that week. Deployed on `random` on
  2026-11-23 at `317accc6`, configuration kept; `gateway-status` answered after.

- **Follow-up (2026-11-20, this session):** a merge that closes a claimed issue leaves the
  claim's `status:in-progress` label on the closed issue, and `issue-release` then answers
  `changed: false` without removing it (removed by hand with `issue-label` on lushly#2706).
  Filed as [#1810](https://github.com/lushly-dev/afd/issues/1810), fixed in
  [#2157](https://github.com/lushly-dev/afd/pull/2157). `gateway-status`'s credential ages and
  GraphQL budget ([#1833](https://github.com/lushly-dev/afd/issues/1833)) landed in
  [#2303](https://github.com/lushly-dev/afd/pull/2303). Both run on `random` since the update
  to `3fe08c00` on 2026-11-23.
- **Next, in order:** the lanes reporting their health: Lushly's `merge-lane.mjs`, which runs
  on `random` already, calling `lane-heartbeat` (Lushly's side,
  [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392), coordinated with its
  foreman, with a `/heartbeat` token issued only after it merged and the lane reloaded
  cleanly; it merged and reloaded on 2026-11-25, and reports since 2026-11-27, below), and
  botcore's lane once it runs for AFD; the factory plugin on the gateway (the
  lane loop landed in #1295; `feat/factory-lane-loop` is stale); Lushly's side ([lushly#2392](https://github.com/lushly-dev/lushly/issues/2392));
  the process files and the two process checks.
- **Not done:** every milestone below.

## Milestones

| Milestone | State | Jobs | Process files changed |
|---|---|---|---|
| G0: stand it up | In progress: the App created and installed 2026-11-15; the adapter ([#1290](https://github.com/lushly-dev/afd/pull/1290)); the service on `random` with its key, service user and start at boot, installed 2026-11-19; test writes for every write permission 2026-11-20 and 2026-11-21; credit settled 2026-11-21 (rebase, done in Lushly; AFD in [#1809](https://github.com/lushly-dev/afd/issues/1809)); the runbook; exit met 2026-11-21 (`gateway-status` on each route from `random`, `macbook-air` and `hero` after a restart of `random`); the rate-limit replay 2026-11-23; open: the two process checks, which G1 builds, so `process.json` keeps G0 unlanded | — | AFD: `docs/operations/factory-gateway.md` and `SETUP.md` ([#1834](https://github.com/lushly-dev/afd/pull/1834)). Lushly: `SETUP.md` ([lushly#2707](https://github.com/lushly-dev/lushly/pull/2707), [lushly#2782](https://github.com/lushly-dev/lushly/pull/2782), [lushly#2809](https://github.com/lushly-dev/lushly/pull/2809), which names `gateway-status`; merged by the gateway by rebase as `482ee117`, the owner its author) |
| G1: one writer (MVP) | In progress since 2026-11-14: botcore host changes ([#1230](https://github.com/lushly-dev/afd/pull/1230)) and the command skeleton against a fake GitHub ([#1232](https://github.com/lushly-dev/afd/pull/1232)), all fifteen jobs passing, both merged 2026-11-15; job 16 (a stopped lane) added and passing 2026-11-24; job 17 (issue types and parents, `issue-set`) added and passing 2026-11-27; Lushly side tracked in [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) | `mvp` (01–11, 15–17) | — |
| G2: review as a record | Open | `records` (12) | — |
| G3: events, not polling | Open | `events` (13–14) | — |
| G4: no credential outside the door | Open | unit tests and the exit | — |
| G5: sessions through the door | Not specified; specified when G4 exits unless the owner ranks it earlier | — | — |

## Owner decisions

| Date | Decision |
|---|---|
| 2026-11-14 | The gateway lives in `botcore-factory`; it runs on the always-on machine, `random`; it is built as an MVP and then milestones, each updating the skills, tools and `AGENTS.md` that use it as it lands; the proposal goes in `active/` |
| 2026-11-15 | Work that reaches GitHub is credited to the owner as its main contributor: the commits the gateway pushes and merges carry his authorship, whichever account opens or merges the pull request. The gateway refuses a commit he did not author and merges by each repository's method; G0 tests how an App's squash merge is credited in Lushly. Agents are listed with an email-free `Assisted-by:` trailer, enforced in both repositories' `ci-ok` |
| 2026-11-15 | Setup for other people waits until there are other people: the project has one developer and no second account to test with. G4 stays the last milestone |
| 2026-11-15 | Interactive sessions hand their branches to the lane through the gateway (the `/session` route's queue push, in G1) instead of merging them themselves; documentation-only pull requests may still merge directly. Prompted by `main` moving under running validations in Lushly |
| 2026-11-15 | The lane runs on `random` beside the gateway: the Mac is not always on. `gateway-status` reports the lane |
| 2026-11-21 | Factory merges keep the owner as the commit's author by rebase: the gateway rebase-merges one commit he authored, in both repositories, after a squash by the App credited the bot (lushly#2707). He accepted that rebase merging is allowed in both repositories and that AFD's merge queue then rebases every pull request, a session's included, so a branch of several commits is squashed to one before it is queued. Tested in Lushly before anything changed in AFD ([#1809](https://github.com/lushly-dev/afd/issues/1809)) |
| 2026-11-26 | The gateway sets an issue's type and parent in G1 ([#2515](https://github.com/lushly-dev/afd/issues/2515)): `type` and `parent` on `issue-create`, and `issue-set` to change or clear them, so the foreman's and owner's epic writes in `references/epics.md` move with G1's other triage writes; a session that opens an epic stays on `gh` until G5, by the rule of 2026-11-15. Drafted in the proposal; implementation and its job in [#2729](https://github.com/lushly-dev/afd/issues/2729) |
| Open | The six questions in [For the owner](factory-gateway.proposal.md#for-the-owner), the ranking of the jobs first |

## Session log

- 2026-11-14: proposal, fifteen jobs and fixtures written and checked. Three readers walked them
  (the people, the job list, the calling agent, each with Opus 5.5 at medium effort); the revision
  that followed is recorded in the proposal's
  [Walking the paths](factory-gateway.proposal.md#walking-the-paths). Checks rerun after it.
- 2026-11-14: one independent review (Opus 5.5, high effort): 3 blockers, 9 improvements and 6
  nits, all fixed in the same pull request except one nit declined: a scenario for
  `VARIABLE_NOT_ALLOWED`, since `variable-set` belongs to the factory's job 02 and has no job here.
  A focused pass by a second fresh reviewer (Opus 5.5, high effort) then verified the fixes: eight resolved, four partly, with
  four new improvements and five nits; all were fixed. See the proposal's
  [Review](factory-gateway.proposal.md#review). Checks rerun after it: 15 files, 70 steps.

- 2026-11-14: proposal merged as #1222 (`57397cdb`). A new session on `random` took the work over
  from the proposal session on Hero. Overlap check against open AFD pull requests and the four
  branches in flight on Hero, read 2026-11-14:
  - `feat/botcore-host-catalog` merged as #1181 (plugin policies, input schemas in the catalog,
    named refusals), `feat/factory-plugin-intake` as #1183 and `feat/factory-plugin-queue` as
    #1185. These are on `main`; the host changes build on them.
  - `feat/factory-lane-loop` (`1ba67bb3`, 2026-11-13) is pushed with no pull request. It changes
    `botcore-factory` (the lane process, loop, hosts and report, and a rewrite of
    `real_world.py`), the root `botcore.toml`'s `[plugins.factory]` keys, and the software
    factory's scenario 10 with two new fixtures; it does not touch botcore's host. The gateway is added as new modules so the two do not
    collide; its claims, queue push and lane steps move onto the gateway after it lands.
  - No open pull request touches `endpoints/botcore/`.
  - So this work does the host changes once, for the gateway and the factory's Phase 1 together
    (the follow-up below).
- 2026-11-14: [#1230](https://github.com/lushly-dev/afd/pull/1230) opened with botcore's host
  changes 1, 2, 5 and 6. `pnpm verify` caught that a default kebab-case rename broke Alfred's
  host (56 tests), so names became opt-in; two independent reviews (Opus 5.5, high) found a
  crash on unresolvable type hints and Alfred choosing targets by the spelling called, both
  fixed. Its gates pass (botcore 782 tests, the factory plugin 229, Alfred 130, Health).
- 2026-11-14: the G1 skeleton, [#1232](https://github.com/lushly-dev/afd/pull/1232), stacked on #1230. Verified with
  `uv run --frozen pytest tests/test_gateway_scenarios.py` in `botcore-factory`: all fifteen
  jobs pass through AFD's TypeScript scenario runner (`scenarios/run.mjs`, now shared with the
  factory's jobs: `FACTORY_HARNESS` picks the harness and `FACTORY_SCENARIO_ENV` each job's
  route), each on the route its header names. Job 13 runs on the foreman's route throughout,
  since a file runs against one route; its third step's consumer is the lane by name. Unit
  tests (`tests/test_gateway_routes.py`) cover the route boundaries, the owner's `force`, the
  write budget, `GITHUB_UNAVAILABLE`, `CHECK_NOT_REQUIRED`, `NOT_MERGEABLE`,
  `NOT_FAST_FORWARD`, `VARIABLE_NOT_ALLOWED`, the built-in secret rules, the cutover window and
  the journal. One job changed: 09's `expect` referenced an earlier step, which AFD's runner
  resolves only in `input`, so it now asserts issue 105, as job 04 does; the checks the
  proposal session ran (`validate`, dry run) do not execute steps and could not catch it.
  Refusals added beyond the draft: `UPLOAD_NOT_FOUND` (no live upload for `branch-push`),
  `BODY_TOO_LARGE` (text over `body.maxBytes`), `RESERVED_MARKER` (caller text holding a
  claim, release or dedupe marker, which would otherwise forge one as the bot),
  `CLOSING_KEYWORD_IN_BODY` (`pr-open` writes the closing lines itself), `NOT_GATEWAY_PR`
  (`pr-open` updates only pull requests the gateway opened) and `PR_CLOSED` (`pr-merge` of a
  pull request closed without merging). `issue-release` takes `force` only on the owner's
  route, so elsewhere it is refused as an input the command does not take. The proposal's
  tables are not yet updated for these.
- 2026-11-14: one independent review of the skeleton (Opus 5.5, high): 5 blockers, 9
  improvements and 2 nits. All blockers fixed, each with a test: claim and release markers
  forged through `issue-comment` (now `RESERVED_MARKER`), a multi-issue claim left partial by
  the write budget (now spent before the first write; a retry after an outage completes it),
  `pr-merge` queuing a closed pull request (`PR_CLOSED`), holders, dedupe keys, refs and
  branch names reaching GitHub unchecked, and concurrent writes racing (one lock on the shared
  state, with a concurrency test). Improvements fixed: the GitHub port gained `merge_pull`,
  `enable_auto_merge`, `disable_auto_merge` and `create_revert` in place of the fake's field
  updates; `pr-open`'s two refusals above; ref format checks; release by branch and machine;
  `VALIDATION_ERROR` for a bad `cursor` or `since`; `cancel` before the head check; event
  reads off the event loop; Lushly's legacy lease counts the account's latest activity, not
  only its start. Deferred: claims are released when the gateway merges at once; a queued
  auto-merge that lands later is released from G3's merge events. A focused second pass verified
  every fix and approved, with four small improvements: three fixed (a merge racing a push is
  `HEAD_MOVED`, closing keywords with issue URLs are refused, legacy activity counts only
  before the cutover) and one left to the App adapter (it runs `git check-ref-format` rather
  than the skeleton's pattern).
- 2026-11-14: botcore's change 3 (each command as its own MCP tool) is written on
  `lush/botcore-command-tools` but held back: its review found that the MCP SDK's own argument
  model, which validates before the host, rejects `**kwargs` handlers, can stop the server
  from being built on an unresolvable hint, and answers bad input outside AFD's error shape
  while dropping unknown keys. The fix is to publish the catalog's schema and pass arguments
  through so the host is the only validator, which needs a different hook into the SDK.
- 2026-11-24: change 3 redesigned on `lush/host-command-tools`, replacing
  `lush/botcore-command-tools`. `create_host_mcp_server(host, command_tools=True)` subclasses
  the SDK's server (SDK 1 and 2) and overrides `list_tools`, which lists each command with the
  catalog's schema and its read-only or destructive hint, and `call_tool`, which hands a
  command tool's arguments whole to the `-call` meta-tool. The SDK never models them, so the
  host is the only validator: `**kwargs` handlers and unresolvable hints are served, bad input
  is refused as `VALIDATION_ERROR` with its suggestion, and no key is dropped. Commands are
  read per request; only the served spelling is a tool; SDK 2's `Mcp-Param` header check
  reads the catalog schema. The tests pass on SDK 2.3.0 and 1.30.0, over each SDK's in-memory
  client too. Reviewed by Opus and Gemini 4 Neon; their findings applied, the type-ignore
  blocker among them. The annotations are hints: `-call` still reaches every command.
- 2026-11-24: botcore's change 3 merged in [#2409](https://github.com/lushly-dev/afd/pull/2409)
  (`b62d874`), its content checked against the reviewed head. The gateway serves no MCP yet,
  so its callers keep the CLI.
- 2026-11-24: the lane's health in `gateway-status`, the gateway's side (job 16, "See a stopped
  lane instead of waiting on it", added for the owner's 2026-11-15 decision). `lane-heartbeat`
  (`/lane` and `/owner`) keeps each host's own report for a repository's lane (host, running,
  queued, `last_merge_at`) with the time it arrived, in `state.json`; `gateway-status` lists
  every served repository in `lanes[]`, `running` only while a report says so and is younger than
  `laneStaleMinutes` (5; the lane steps every 5 seconds). One entry per repository, since each
  has its own lane, where the proposal had one `lane`. Not a GitHub write: it spends no write
  budget, and it is not journaled (the journal is never pruned:
  [#2413](https://github.com/lushly-dev/afd/issues/2413)). A second host reporting for the same
  repository, its report also saying running and recent, shows in `otherHosts[]`; each host's
  report is kept apart, so a stopped host cannot hide a running one and a clean move between
  hosts is not two lanes (Gemini's review). `state.json` is now written to a side
  file and moved into place. No lane calls it yet. Merged in
  [#2414](https://github.com/lushly-dev/afd/pull/2414) (`dde05aa`) and deployed on `random` the
  same day by the runbook's code update, configuration kept: `gateway-status` lists
  `lushly-dev/afd` and `lushly-dev/lushly`, each `running: false` with `reportedAt: null`. Lushly's lane already runs on
  `random` (`merge-lane.mjs` from `~/github/lushly`, its foreman said on 2026-11-24); AFD has no
  lane running: its sessions merge through the merge queue.
- 2026-11-24: a `/heartbeat` route for the lanes' token. Lushly's foreman asked that the lane
  hold a token that can only report its health, since the lane runs queued branches' code as
  its own process and that code can read any token the lane can; a `/lane` token can merge.
  `/heartbeat` serves `gateway-status` and `lane-heartbeat` only, for the host its token's
  actor names (`lane-heartbeat@<host>`, else `HOST_NOT_TOKEN_S`). Opus's review found that
  any route could store uploads: a route that cannot push now takes none (`/foreman` too),
  refused in botcore's HTTP surface (`upload_routes`) before a slot is taken; Gemini's, that
  the host match must be exact and the read routes' docs said "every route".
  Not closed: Lushly's lane runs as the owner's account, which holds his gateway token and
  `gh` sign-in, so queued code can read those already; a separate OS user (G4) closes it.
  Merged in [#2427](https://github.com/lushly-dev/afd/pull/2427) (`4136c64`) and deployed on
  `random` at `6819de18` the same day: `gateway-status` answers with both lanes not yet
  reported, and `/heartbeat` refuses a call without a token (401). No `/heartbeat` token is
  issued yet.

- 2026-11-24: AFD's process check, `scripts/check-process.mjs`, run by the pre-push hook and
  `pnpm check`. It runs both of the proposal's checks for AFD from `process.json`:
  - **The manifest:** once a milestone is `landed`, each listed file must name its commands, each
    as a word of its own, so a script's path does not count.
  - **The door:** a GitHub write the gateway serves is refused in AFD's agent-facing files
    (`door.scope.afd`, new, by file type: instruction files, skills, runbooks, scripts, hooks,
    MCP configuration and Botcore's code, docstrings included). It covers the CLI, the REST
    API and GraphQL. Comments are not read, and the gateway itself is out of scope.
  Exemptions expire: an allowed file fails once its milestone lands, or once it holds no write.
  A scope glob that matches no file fails. Five files that write were not allowed. Each is now
  allowed until G1, which removes its write: the triage skill's `references/epics.md`,
  `scripts/issue-claim.mjs`, and the factory's `real_world.py`, `lane_merge.py` and `world.py`.
  The manifest gained G5, so its exemptions can expire. G1's list gained `scripts/issue-claim.mjs`
  and `run-fleet`. The manifest is now a factory gate path, so a repair cannot add an exemption.
  Not covered yet:
  - the cell hook, which G1 lists once it exists;
  - Lushly's own check (its half of the manifest moves to Lushly, a later entry that day);
  - proof that `.claude/settings.json` denies `gh` writes. G1's entry asks only that the file
    name `gh` and `git push`, which a read permission satisfies.
- 2026-11-24: `install.sh` builds beside the running gateway and switches (the follow-up of
  2026-11-21).
  - Each update builds a release of its own in `/Library/FactoryGateway/releases` while the old
    code serves.
  - The new code checks the configuration it will read (the installed one when none is staged)
    and a key passed to it. A staged launch daemon must parse and name its address and port.
    The owner's token is issued if there is none.
  - Only then does the daemon stop, `app` (now a link) switch and the daemon start. A failed
    build or check removes the new release and leaves the gateway running. A lock keeps to one
    run at a time, and a signal ends the run through the same cleanup.
  - The switch counts once the daemon's address answers HTTP. The script waits up to 15 minutes
    while launchd shows it running, since a first start fetches the mirrors before it listens,
    and fails after 10 seconds of launchd showing it not running.
  - The script keeps the new release, `app.last-good` (the last that answered, which a failed
    run never replaces) and the release `app` left. On a failure it prints a way back that
    starts the daemon whether or not launchd still holds it.
  - `gateway.json.prev` and the launch daemon's `.prev` keep the last good release's copies.
  - The first update moves the old `app` aside and removes it once the new release answers.
  - `reconfigure.sh` no longer ends at its state line when launchd prints none or the pipe
    closes early.

  An independent review (Opus 5.5) found three blockers, all fixed: a 30-second start window
  too short for a first start; a way back that only `kickstart`ed, which cannot start a daemon
  launchd no longer holds; and pruning that could delete a release the owner had gone back to.
  A second review (Opus 5.5) found no blocker and confirmed the eight earlier items fixed. Its
  improvements were taken: links read as the directories they name, so a link written by hand
  with a trailing slash still keeps its release; the wait counted in seconds, not passes; a
  daemon launchd restarts under a new process counted as a failed start; the plist's `Label`
  and account checked; and clearer messages and runbook text.
  Proved as a normal user against a scratch root, with stubs for `sudo`, `dscl`, ownership and a
  `launchctl` that refuses `kickstart` on an unloaded label and `bootstrap` on a loaded one. The
  real `uv` and the real gateway served `127.0.0.1`:
  - a first install with a generated key, and an update of a layout the old script installed;
  - a daemon that listens only after 45 seconds, waited on;
  - seven failures before the stop (a refused configuration, key, plist, a plist without an
    address, a failed build, a revision that is not a commit, a held lock), each leaving the
    same process answering with no call to `launchctl`;
  - a `SIGHUP` during the build (exit 129, release removed, lock freed);
  - a daemon that never starts, twice, and a `bootstrap` that fails: each printed way back
    brought the last good release up, and `gateway.json.prev` kept the good configuration;
  - a by-hand switch back, after which an update kept the release it ran;
  - launchd holding the daemon after `bootout`: the run ended with the start command;
  - after the second review: a by-hand switch back through links with a trailing slash and a
    relative path, a plist under another `Label` (refused before the stop), and a daemon that
    lives 25 seconds and is restarted (failed in 30 seconds, not 15 minutes).
  Merged in [#2465](https://github.com/lushly-dev/afd/pull/2465). First run as root on
  `random` the same day, updating the gateway from `6819de18` to `c22624e1`, after Lushly's
  foreman said go (its lane was in a coverage run, with no landing in flight). The old `app`
  directory is gone and `releases` holds only `c22624e14-20261125T000711Z`, which `app` and
  `app.last-good` link. The installed configuration, key and owner's token were kept, and the
  repository's plist, unchanged, was installed again. `gateway-status` then answered `success`
  as `lushly-factory-gateway[bot]`, with a rate limit of 5000 and `ages`. Not read: the
  gateway's log (root only) for the mirrors' fetch at start. Lushly's lane does not call the
  gateway yet: its foreman found no call in `scripts/merge-lane*.mjs`, and Lushly's `main`
  names the gateway only in `SETUP.md`.
- 2026-11-24: each repository keeps its own half of the process manifest (`process.json`
  version 2), by Lushly's foreman's direction. The manifest's Lushly entries had gone stale:
  Lushly's skills overhaul (lushly#2587) renamed `do-init-lushly`, `do-triage`, `do-run-fleet`,
  `do-end-session`, `do-prepare-pr` and `do-sweep`, and nothing in Lushly could see a copy kept
  in AFD.
  - **AFD's half** stays in this folder, holding only AFD's files.
  - **Lushly's half** moves to Lushly's `Docs/operations/factory-gateway/process.json`, built in
    Lushly's pull request for lushly#2392. Until that merges, no manifest lists Lushly's files.
    That half was prepared from the old entries, renamed, with a door scope at Lushly's paths. Run
    against Lushly's `main` at `f430fcc8`, AFD's checker found three writers nobody had allowed:
    - the triage skill's `references/epics.md`, now allowed until G1;
    - `scripts/issue-claim.mjs`, until G1;
    - `scripts/post-merge-backstop.mjs`, until G4. Only a workflow runs it, with Actions' own
      token. The proposal's G4 now lists the decision whether such scripts stay outside the door.

    With those three allowed, it passed: 603 files read, 13 allowed.
  - **The checker** now holds the door's patterns (`DOOR_PATTERNS`, unchanged), so Lushly's
    sync of the one file carries them.
  - **New checks:**
    - Every listed file must be tracked, whether or not its milestone has landed, so a rename
      fails until the manifest follows it.
    - Every allow entry needs a `reason` and an `issue` (a GitHub issue URL). AFD's entries link
      the epic, and Lushly's G1 entries link lushly#2392.
    - Exclusions are now exemptions like the rest. Each gives its reason, and fails once it
      removes nothing in scope (`.github/workflows/**`, `**/*.test.ts` and `**/tests/**` went
      for that reason). A scope glob that reads no file once exclusions apply fails too.
    - The shape is checked strictly: all six milestones, no unknown key (a version-1 leftover
      fails), a clear message for a missing manifest. `repo` must name the origin remote's
      repository.
  - **Docstrings:** two of the factory's, in `lane_merge.py` and `world.py`, only said the lane
    never uses `gh pr merge`. They are reworded and their allow entries deleted, so AFD now
    allows 9 files.
  - **Watched it fail:** a listed path renamed back to `do-run-fleet` and an allow entry without
    its issue each failed with its message, then passed once restored. Eight mutations of the
    new rules each failed a test.
  - **Reviews:** Opus 5.5 reviewed the stale entries' fix (approved) and then the split
    (approved). Its improvements were taken: exclusions, the strict shape, `repo`, the
    reasons, and four mutations the tests had missed.
- 2026-11-14: filed [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392), Lushly's side
  of G1 (claim script, lane steps, flake filer, process files and checks), as G1 started.

- 2026-11-19: `pr-merge` queues instead of merging behind a merge queue on `main` (#1627, for
  [#1598](https://github.com/lushly-dev/afd/issues/1598)). A required queue refuses the REST merge.
  Where a pull request's base has one (GitHub's `isMergeQueueEnabled`, no configuration), nothing
  merges at once: `enqueuePullRequest` with the expected head when the required check passed, and
  auto-merge bound to the head, which GitHub turns into a queue entry, while it still runs. The
  answer is `state: queued` with `mergeQueue {required, queued, state?,
  position?}`; `pr-status` carries the same while the pull request is open, with `removed {at,
  reason}` once a queue let it go, and `cancel` takes it out of the queue and reports what GitHub
  then shows. Without a queue nothing changed. Verified with
  `uv run --frozen pytest tests/test_gateway_routes.py tests/test_github_app.py` against the fake
  GitHub and a mocked App; no real queue has been written to. Open, and blocking a gateway on a
  repository with both a queue and AFD's `ci-ok`: the App opens the pull request, so the queue's
  squash, which takes no body, may credit the owner as a co-author and fail the group (G0's
  squash-credit test must cover the queue); whether the App may read the merge-queue fields, which
  every pull request read now asks for on every repository, and call `enqueuePullRequest`,
  without another permission. Not done, as before: nothing releases a
  queued or auto-merged pull request's claims when it merges (`pr-merged` is only an event).

- 2026-11-26: issue types and sub-issues added to G1 by the owner's decision on
  [#2515](https://github.com/lushly-dev/afd/issues/2515): the proposal drafts `type` and `parent`
  on `issue-create` and a new `issue-set` (foreman and owner; the lane's `issue-create` takes the
  fields too), with their retry rules and `type`, `parent` and `subIssues` on `issue-get`, and
  names them in G1's builds and process. `process.json` lists `epics.md` among G1's files and moves
  its exemption to G5, for sessions. Checked with `node scripts/check-process.mjs`. Two reviewers
  (Opus 5.5 high, Gemini 4 Neon high) walked triage's epic path; their blockers (retry of a filing
  with a parent, and no route for a session) are fixed in the same pull request. Not built: the commands, their job and the App adapter are
  [#2729](https://github.com/lushly-dev/afd/issues/2729). Lushly's copy of the triage skill moves
  with G1's Lushly process work ([lushly#2392](https://github.com/lushly-dev/lushly/issues/2392)).

- 2026-11-27: Lushly's half of the process check landed: lushly-dev/lushly#3096 merged as
  `2163c895`, closing [lushly#2961](https://github.com/lushly-dev/lushly/issues/2961).
  - **What runs.** `pnpm check:process` is in Lushly's `check-invariants` lefthook group, so
    pre-push, the lane's preflight and its final all run it. It first checks that
    `scripts/check-process.mjs` is the byte copy of AFD's file that
    `scripts/check-process.source.json` records (`pnpm process:sync <afd commit>` updates both,
    from a commit on AFD's `main` only). It then runs it against Lushly's half,
    `Docs/operations/factory-gateway/process.json`. Checked by content on Lushly's `main`: the
    record names AFD `4f36a6fe`, and the scripts, the hook and the manifest are present.
  - **The ejection.** Lushly's lane ejected the branch on 2026-11-25:
    `check-gate-justifications` (lushly#2734), which landed after the branch was cut, wants a
    leading `Standard-tool-first:` note in every `check-*` script. The note went into AFD's
    checker ([#2807](https://github.com/lushly-dev/afd/pull/2807), `4f36a6fe`) and was synced
    from there.
  - **New allow entries.** Lushly's `main` had meanwhile gained 13 door writes in seven files:
    its merge-queue mode (lushly#3063) and a Dependabot freshness check. Each is allowed with
    its milestone:
    - the lane's queue writes until G1;
    - `Docs/operations/merge-queue.md`'s owner steps until G5;
    - the freshness check, which only a workflow runs with Actions' token, until G4.
  - **Result.** On the branch: 606 files read, 20 allowed. Two reviewers (`lushly-reviewer` and
    `lushly-security-auditor`, Opus 5.5 high) found no blockers on the repair.
  - **One gap, filed as [#2809](https://github.com/lushly-dev/afd/issues/2809)** (corrected by the
    `pr-merge` entry below: the code already dequeued; the record of it was the gap). G1's
    `pr-merge` `cancel` turns auto-merge off. It does not take a pull request out of a merge
    queue that has already accepted it (`dequeuePullRequest`), which Lushly's queue mode does
    when it ejects. The entry above (2026-11-24) said no manifest listed Lushly's files until
    this merged; one does now.
- 2026-11-27: Lushly's lane heartbeat ([lushly#2979](https://github.com/lushly-dev/lushly/pull/2979),
  `scripts/merge-lane-heartbeat.mjs`) merged on 2026-11-25 at 10:04Z.
  - **Reload.** The lane reloaded cleanly 12 seconds later: `definition-reload`, `run-stopped`
    and `run-started` in its `events.jsonl`.
  - **Still off.** It waits for the `gateway.url` dial and a `/heartbeat` token at
    `~/.config/factory-gateway/heartbeat.token`. Neither exists yet, because issuing the token
    needs the owner's sudo on `random`.
  - **Coordination.** Lushly's foreman, which asked to be told before the dial is set, no longer
    runs, so that step is the owner's.
- 2026-11-27: Lushly's lane reports to the gateway. Superseding "Still off" above.
  - **The token.** The owner ran sudo on `random`, and the `/heartbeat` token was issued with
    `token issue --route heartbeat --kind service --actor lane-heartbeat@random`. Its id is
    `d4c0945d`, issued at 09:54Z.
  - **Where it lives.** The token went straight into `~/.config/factory-gateway/heartbeat.token`
    (0600, outside the repository and the lane's worktrees). It was never printed.
  - **The dial.** Set at 09:54Z, in the same session as the token: `node scripts/merge-lane.mjs
    dial gateway.url http://100.82.142.64:8787`.
  - **When it started.** The lane reads its dials only between steps, so the first beat came
    once the coverage run on `main` it was in had finished.
  - **Verified.** `gateway-status` (owner route) at 11:12Z: `lushly-dev/lushly` on `random`,
    `running: true`, `stale: false`, `queued: 5`, `lastMergeAt` 09:48Z. The lane's `lane.log`
    says `heartbeat: reporting to the gateway`.
  - **Not yet reporting:** AFD's lane, which reports once botcore's lane runs for AFD.
- 2026-11-27: `pr-merge`'s `cancel` and the merge queue
  ([#2809](https://github.com/lushly-dev/afd/issues/2809), in
  [#2857](https://github.com/lushly-dev/afd/pull/2857)). The code already took a queued pull
  request out of the queue with `dequeuePullRequest` (since #1627, 2026-11-19); the proposal's
  command table still said only that it turned auto-merge off, and nothing recorded which of the
  two a cancel did.
  - **Now.** The answer carries `dequeued`, the journal keeps it with the input's `cancel` (the
    audit redaction kept neither), and the reasoning names each step taken. The proposal's row and
    the gateway's `docs` topic say a queued pull request is dequeued, and job 05 expects
    `dequeued: false` for a cancel outside a queue.
  - **For Lushly.** The lane's ejection (`scripts/merge-lane-queue-github.mjs`) can call
    `pr-merge` with `cancel` once it is on the gateway, so its direct `dequeuePullRequest` holds
    only until G1, as its manifest allows.
  - **Checked** with `uv run --frozen pytest -q` in `botcore-factory` against the fake GitHub; no
    real queue was written to. `random` serves the change after the owner's update.
- 2026-11-27: issue types and parents through the gateway
  ([#2729](https://github.com/lushly-dev/afd/issues/2729), in
  [#2869](https://github.com/lushly-dev/afd/pull/2869)), by the owner's decision on
  [#2515](https://github.com/lushly-dev/afd/issues/2515).
  - **Built.** `issue-create` takes `type` and `parent` and answers both; `issue-set` (foreman and
    owner) changes or clears either, and a field left out is kept; `issue-get` gives `type`,
    `parent` and `subIssues { total }`. Both check the type and parent before writing, and write
    the parent first, so a refused attach changes neither. A retry its `dedupe_key` matches sets
    whatever the issue still lacks. An attach GitHub refuses or does not answer names the issue
    it filed; that `GITHUB_UNAVAILABLE` is retryable only with a `dedupe_key`. The App adapter
    writes the type by name over REST, offers only enabled types, and writes sub-issues through
    `POST .../sub_issues` with `replace_parent` and `DELETE .../sub_issue`; the type, parent and
    count come only on the one-issue read, never in a scan.
  - **Beyond the draft.** `PARENT_IN_OTHER_REPO` (a parent in another repository, shown as
    `owner/name#number`, can be replaced but not detached) and `VALIDATION_ERROR` for an
    `issue-set` given neither field; the proposal's row says so. `issue-create` moved from
    `service.py` to `gateway/issue_tree.py` with `issue-set`.
  - **Job 17** (`mvp`, foreman route) files an epic and a part, retries the part, attaches an
    open issue, counts the parts, types an open issue `Epic`, moves a part, detaches it twice and
    refuses an unknown type and a missing parent. The proposal's Jobs table and G1's list carry it.
  - **The door check** now finds `addSubIssue`, `removeSubIssue` and `updateIssueIssueType`
    beside `mutation` or `(input:` (`scripts/check-process.mjs`). Watched failing: a planted
    `addSubIssue` mutation in `docs/operations/factory-gateway.md` passed before and was named
    after; `epics.md`'s two calls are now found, and its `door.allow` entry to G5 covers them.
    Lushly's byte copy takes it with `pnpm process:sync` once this merges. The door still misses
    `pr-merge`'s own queue and auto-merge mutations:
    [#2848](https://github.com/lushly-dev/afd/issues/2848).
  - **Carried from #2809's review:** the generic `STILL_QUEUED` keeps GitHub's refusal in its
    details, with a test of that branch.
  - **Checked** against the fake GitHub and a mocked App only: no real issue type or sub-issue
    has been written. Open: the owner's update of `random` (the runbook step), then a real
    `issue-set` on a test issue; `triage-issues`' `references/epics.md` moves to these commands
    when G1's process lands, in both repositories.
- 2026-11-27: the door check finds `pr-merge`'s own writes
  ([#2848](https://github.com/lushly-dev/afd/issues/2848), in
  [#2908](https://github.com/lushly-dev/afd/pull/2908)), superseding the "still misses" line
  in the issue types entry above. `scripts/check-process.mjs` now
  refuses `dequeuePullRequest`, `enablePullRequestAutoMerge` and `disablePullRequestAutoMerge`
  beside `mutation` or `(input:`, as it does `enqueuePullRequest`, and, from the second review,
  `clearLabelsFromLabelable` (`issue-label`'s GraphQL twin), `createRef` and `updateRef`, and
  REST writes to `git/refs` (`branch-push`'s API twins). Watched failing: a planted
  `dequeuePullRequest` mutation in `docs/operations/factory-gateway.md` passed before and was
  named after, and so did a planted `PATCH .../git/refs/...`, `createRef` and
  `clearLabelsFromLabelable`; reading a ref stays allowed. Nothing in AFD's scope makes these writes outside the gateway's own code, which
  `door.exclude` leaves out, so no allow entry is added. `node --test
  scripts/check-process.test.mjs` passes 22 of 22, and every name is now tested in the bare
  `name(input:` form too. Lushly's copy follows with `pnpm process:sync`, which also brings
  #2729's sub-issue names: this script, run against Lushly's half at `4a46cac` with
  `node scripts/check-process.mjs --manifest Docs/operations/factory-gateway/process.json`,
  passed (615 files read, 20 allowed), the new names finding only
  `scripts/merge-lane-queue-github.mjs` and `Docs/operations/merge-lane.md`, both allowed until G1.

## Follow-ups not yet issues

| Raised | By | Follow-up |
|---|---|---|
| 2026-11-14 | Proposal session | ~~A Lushly issue tracking Lushly's side of G1 (claim script, lane steps, flake filer, process files and checks), filed when G1 starts~~. Superseded: filed as [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) on 2026-11-14 |
| 2026-11-14 | Proposal session | botcore's host changes ([What botcore needs](factory-gateway.proposal.md#what-botcore-needs)) overlap the factory's Phase 1 host changes; whichever starts first does them once for both. Superseded: taken 2026-11-14 by the gateway's G1 session on `random`: the gateway's host changes are done once, for both |
| 2026-11-18 | Commit-credit session | `lushly-dev/afd` now allows squash merges only, at the owner's direction: a merge commit or rebase merge carried branch commits, co-author lines included, onto `main` unchanged ([#1523](https://github.com/lushly-dev/afd/pull/1523)). A gateway that serves AFD needs `"mergeMethods": {"lushly-dev/afd": "squash"}`. Its default merge commit is now refused with `MERGE_METHOD_NOT_ALLOWED`. Its squashes already give their own commit message ([#1520](https://github.com/lushly-dev/afd/pull/1520)). Superseded: the merge queue rebases since 2026-11-22 ([#1809](https://github.com/lushly-dev/afd/issues/1809)), and the gateway's `mergeMethods` for AFD is `rebase` since 2026-11-23 |
| 2026-11-21 | Gateway session, from the runbook's review | ~~The install script removes the running code before it builds the new, so a failed build leaves the gateway down: build beside it and switch~~ (done 2026-11-24, session log). Its update form ran as root on `random` on 2026-11-24; its first-install form and a real key passed in have not run as root in its present shape (the first install ran only against a scratch root). ~~`reconfigure.sh`'s state line can still end its run after the restart~~ (fixed 2026-11-24). ~~Separately, `gateway-status` does not report the key's age the proposal promises: [#1833](https://github.com/lushly-dev/afd/issues/1833)~~ (merged in [#2303](https://github.com/lushly-dev/afd/pull/2303) on 2026-11-23: `ages { appKey, token }` on every route, plus `rateLimit.graphql` when GitHub supplies the GraphQL budget; `random` serves them since its update to `3fe08c00` on 2026-11-23) |
