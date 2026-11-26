# Verified recovery: status

**State** Complete (2026-11-25). All five steps merged; remaining follow-ups are filed as GitHub issues below.
Epic: [#2424](https://github.com/lushly-dev/afd/issues/2424).
[Proposal](verified-recovery.proposal.md) · [Research](recovery-research.md)

## How to keep this file

Each step has its own line below, made before the step starts. Record the date, the pull request
and the evidence when it lands on `main`. Never write which steps are done or next in a shared
sentence; edit only your step's line. Keep earlier entries as history.

## Steps

- **Step 1, fix what is known:** merged 2026-11-24 as [#2433](https://github.com/lushly-dev/afd/pull/2433).
  - The factory's `NOT_LANE_HOST` named `lane-handoff`, which no host serves. It now tells the
    cell to stop and tell the foreman, naming the lane host and `lane-enqueue`.
  - `tests/test_suggestions.py` reads every refusal's suggestion in the plugin, including those
    built from variables, parameters and helper functions, and fails on any hyphenated name that
    is neither a command the factory serves nor on its short list of skills, events and
    settings. It failed on `lane-handoff` first. It checks against every command the factory
    serves, not the commands of the host the caller is on (a cell's host serves three).
  - Python scenarios read and check `expect.error.suggestion` as strictly as TypeScript: a
    string, or a matcher whose every key is a matcher key and whose values suit it, `equals`
    included. `{equals: ...}` is now a matcher under `data` too, as in TypeScript; Python's `data`
    matchers otherwise stay as lenient as before.
  - The schema README now says what checks suggestions: shared vectors pin a few engine
    suggestions' text, `error-codes.md` limits the meta-tools one may name, and both testing
    packages warn when one is missing.
  - Kept: the gateway's `CLAIM_LOST` names the factory's `lane-drop` while telling the caller to
    stop; it describes what the foreman does, so it is an external step for that caller, not a
    command it should call.
  - Umbel's suggestions that spell CLI commands its parser refuses were fixed on their own branches,
    since Umbel has its own gate (merged as [#2448](https://github.com/lushly-dev/afd/pull/2448)
    and [#2459](https://github.com/lushly-dev/afd/pull/2459)).

- **Step 2, a structured recovery:** merged 2026-11-24 as [#2442](https://github.com/lushly-dev/afd/pull/2442).
  - `CommandError.recovery` ([`spec/recovery.md`](../../../../spec/recovery.md)): `call`,
    `fix-input`, `retry`, `external` or `stop`, beside the prose `suggestion`. Producer rules keep
    a recovery to commands the caller can see, keep acknowledgements, approvals, credentials and
    untrusted text out of `input` (the schema refuses `confirm` there), and define how
    `fix-input` changes the input. Consumer rules read a recovery that breaks
    `$defs/recovery` as none, grant a follower nothing, and bound its waits and chains.
  - `spec/vectors/recovery.json`: 17 valid, 1 normalized and 31 invalid errors, each invalid one
    with the error a reader must produce. TypeScript, Python, Rust and C++ each produce exactly
    that, and each reader keeps a recovery exactly when the schema accepts it; an independent
    probe of 26 further inputs, `afterMs` boundaries included, found all four in agreement.
  - The wire fixtures carry a recovery; `McpClient` drops an unreadable one from what it
    returns; Python's context-hook refusals keep it.

- **Step 3, follow and assert:** merged 2026-11-24 as [#2476](https://github.com/lushly-dev/afd/pull/2476).
  - Scenarios in both runners assert a refusal's recovery (`expect.error.recovery`, like `data`;
    a missing or unreadable one fails) and `follow` it: `call` (with `thenRetry`, the refused call
    again), `fix-input` and `retry`. A followed call that comes back with the same refusal fails
    whatever the scenario expects; `external`, `stop`, missing and unreadable recoveries have
    nothing to follow. `follow.input` gives only what the recovery `needs`, so a scenario cannot
    correct a wrong recovery, and rule 3 is checked. Both runners read a recovery with step 2's
    readers (`isCommandRecovery`, `is_command_recovery`) and give the same messages.
  - Every refusal the factory's commands return carries a recovery (the gateway is a separate
    surface): `call`, `fix-input`, `retry`, `external` or `stop`. The executed jobs assert them
    and follow ten a program can take;
    `test_recoveries.py` requires one on every refusal, a served command its every wording names
    for each `call`, and shows a planted wrong recovery failing the job it follows, with and
    without an assertion on its fields.

- **Step 4, small worlds:** merged 2026-11-25 as [#2518](https://github.com/lushly-dev/afd/pull/2518). The owner agreed on
  2026-11-24 to a pilot on the factory.
  - `tests/small_worlds.py` in the factory plugin explores the factory host in process:
    - worlds: four scenario fixtures (fresh, backlog, ejected, host-offline), each merged over
      `fresh.json`;
    - depth: sequences of up to two calls;
    - inputs: drawn from each state's issues, branches, machines, events and runs, plus missing
      and out-of-range values.
  - For every refusal with a `call`, `fix-input` or `retry` recovery, it checks the recovery
    before following it: each `needs` field must be a parameter of the command, and `input` and
    `needs` must not share a field (rule 3). It then follows it as the scenario runners do:
    - the recovery's own call must not refuse;
    - a `thenRetry` repeat must succeed;
    - no followed call may come back with the same refusal.
    Last, it checks that the refused call succeeds, or can still succeed within the bound,
    counting the states one step past the bound. `lane-run`, which blocks, and `lane-host-set`
    with `recover`, the wholesale rebuild, are left out.
  - For a `call` without `thenRetry` (all reads in the factory), the check is that the call is
    enabled and does not destroy reachability. Whether the read is the right one is what a
    scenario's `follow.expect` checks.
  - One run: 1,058 states, 15,667 calls, 2,385 followable refusals, 2,659 follows, in about 20
    seconds. 1,658 refusals were judged sound, and 727 had a refused call that cannot succeed from
    their own state at this depth. The test pins every (command, code) pair it judges sound, and
    caps the calls at 19,000.
  - **What it found:**
    - `lane-report` on a lane that never ran sent the caller to `lane-start`, which refuses on any
      machine that does not host the lane. It now sends it to `lane-status`, which is judged sound,
      and the test lists no known violations.
    - It also listed `FOREMAN_BUSY` and `NOT_FOREMAN`, whose `stop` is followed by a success once
      `foreman-handoff` is called with the holder's session. That step belongs to the holding
      foreman, so `stop` stays, but any caller can take it: see the follow-ups.
  - Eight planted wrong recoveries are caught. Each failed against an explorer without the check
    that catches it:
    - a `call` that comes back with the same refusal;
    - a `call` after which the refused call can never succeed;
    - a `call` that refuses itself;
    - a misspelled `needs` field;
    - a field in both `input` and `needs`;
    - a `thenRetry` whose repeat refuses;
    - a recovery that leads away one step past the bound;
    - a `fix-input` whose fixed call fails with another code, which the test's pinned pairs
      catch.
  - Whether to build it for other surfaces is the owner's decision.

- **Step 5, engine recoveries:** merged 2026-11-25 as [#2539](https://github.com/lushly-dev/afd/pull/2539). The owner agreed on
  2026-11-24 to take it after step 4. It takes up step 2's two follow-up rows.
  - `spec/recovery.md`'s "Engine errors" table gives each error the engines emit its recovery:
    - an unknown command calls `afd-discover` or `afd-help`, and a command outside the active
      context calls `afd-context-list`, each only when the caller can call it;
    - `CONTEXT_NOT_FOUND` and `CONTEXT_DEPTH_EXCEEDED` call the context commands, on the same
      condition;
    - a command not exposed or not granted, a confirmation, an approval a person must give and a
      missing approval step are `external`;
    - a declined confirmation or approval is `stop`;
    - a rate limit is `retry`, with `afterMs` when the window's end is known;
    - a call the caller must reshape carries none.
  - Each engine decides once whether the caller can call a command, and names it in both the
    suggestion and the recovery only then. The checks are registration, exposure, the active
    context, an `allow` list and authorization.
  - The fix changed what some engines said:
    - Python's in-process `server.execute` and TypeScript's HTTP lanes stopped naming tools they
      cannot run;
    - the "or afd-context-enter to switch" clause now needs that command to be callable;
    - a DirectClient approval hook that fails keeps the hold, `external`, and only one that
      answers no is a decline.
  - The default instructions keep "follow error.suggestion to recover" and add what
    `error.recovery` is. Umbel's Ideas spec and README quote the new sentence.
  - `dispatch.json`, `tool-strategies.json` and `app-calls.json` pin the recoveries, and every
    language compares them. Each language has its own tests for the rows no vector reaches.
  - Merging `main` brought TypeScript's host-verified confirmation (#2514); its refusals carry
    `external` and `stop`.
  - The routing code adds about 600 bytes to Loam's first paint (349,561 to 350,177 before #2514)
    and about 900 to the kernel alone. Under D115, Loam's STATUS records the kernel's ceiling
    raised; first paint fits after #2534 gave it one chunk.

## Follow-ups

| Raised | By | Follow-up | Tracking |
| --- | --- | --- | --- |
| 2026-11-24 | Step 2 | Engine-emitted errors carry no `recovery` yet: unknown commands, rate limits, confirmations and approvals. Add them in all four languages at once | Done in Step 5 ([#2539](https://github.com/lushly-dev/afd/pull/2539)) |
| 2026-11-24 | Step 2 | The server's default instructions still say "follow error.suggestion to recover"; once engines set `recovery`, say to follow it when present | Done in Step 5 ([#2539](https://github.com/lushly-dev/afd/pull/2539)) |
| 2026-11-24 | Step 3 | `botcore-factory` still requires `afd>=0.9.0` though its refusals use `recovery`; raise the floor to the first afd release that ships it | [#2607](https://github.com/lushly-dev/afd/issues/2607) |
| 2026-11-24 | Step 3 | A malformed `expect.error.suggestion` matcher is worded differently by the runners: TypeScript says `Invalid assertion at error.suggestion: 'contains' expects a string`, Python `'expect.error.suggestion.contains' expects a string`. Recovery assertions are worded alike. Give suggestions TypeScript's wording in Python, which also drops the doubled field name in a `follow.expect` message (`'follow.expect': 'follow.expect.error.suggestion…'`). One more gap: each runner checks `matches` with its own regular-expression engine, so `(?P<a>x)` passes only in Python and `(?<a>x)` only in TypeScript. Python refuses `not_exists` in a recovery assertion, where TypeScript would read it as a field name, and prints a whole-number float in an unreadable recovery as `1.0` where TypeScript prints `1` | [#2608](https://github.com/lushly-dev/afd/issues/2608) |
| 2026-11-24 | Step 4 | `foreman-handoff` frees the foreman for whoever passes the holder's session id, which `FOREMAN_BUSY`'s details show. So a refused foreman can take over instead of stopping. Decide whether a handoff needs more than the id | [#2609](https://github.com/lushly-dev/afd/issues/2609) |
| 2026-11-24 | Step 4 | The explorer accepts a `fix-input` or `retry` whose call made again refuses with another code when the refused call can still succeed, where the scenario runners' default expects success; 9 such cases pass today. Two branches of its judgement are untested: a `fix-input` or `retry` whose call leaves the explored states is out of reach and never fires, and only the first remaining way is checked for that. Decide the rule for both if the explorer grows, and whether to expand small-worlds exploration beyond the factory pilot | [#2610](https://github.com/lushly-dev/afd/issues/2610) |
| 2026-11-24 | Step 4 | `gate-allow` records an allowance for a head no branch has (the explorer passes `0000000` on a working cell). Decide whether it should refuse a head that does not exist | [#2611](https://github.com/lushly-dev/afd/issues/2611) |
| 2026-11-24 | Step 5 | Engine errors left without a recovery in step 5: `VALIDATION_ERROR` (a `fix-input` from `details`, though unexpected fields need `external`), `OUTPUT_BUDGET_EXCEEDED` (the budget is in `_meta`, not `input`), the timeout and stream errors (the command may have run), `INSUFFICIENT_SCOPE`, the Tasks `UNAUTHORIZED` and `TASK_TOKEN_EXPIRED`. Give each a recovery where its step can be named | [#2612](https://github.com/lushly-dev/afd/issues/2612) |
| 2026-11-25 | Step 5 | A host-verified confirmation the server cannot relay from inside `afd-batch` or `afd-pipe` tells the caller to call the command on its own, and carries `external` (the table's `CONFIRMATION_REQUIRED` row), while the same step for an approval carries none (`APPROVAL_REQUIRED`'s reshape row). Decide whether the confirmation should carry none too, in all four languages, or say in `spec/recovery.md` why the two differ | [#2613](https://github.com/lushly-dev/afd/issues/2613) |
