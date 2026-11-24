# Verified recovery: status

**State** Active. Steps 1 to 3 are being built; step 4 waits for the owner after step 3.
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
  - Umbel's suggestions that spell CLI commands its parser refuses are fixed on their own branch,
    since Umbel has its own gate.

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

- **Step 3, follow and assert:** not started.

- **Step 4, small worlds:** waits for the owner's decision after step 3.

## Follow-ups

| Raised | By | Follow-up |
| --- | --- | --- |
| 2026-11-24 | Step 2 | Engine-emitted errors carry no `recovery` yet: unknown commands, rate limits, confirmations and approvals. Add them in all four languages at once |
| 2026-11-24 | Step 2 | The server's default instructions still say "follow error.suggestion to recover"; once engines set `recovery`, say to follow it when present |
