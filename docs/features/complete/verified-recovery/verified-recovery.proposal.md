# Verified recovery

**Problem.** Every AFD error should carry a `suggestion`, and the server tells every agent to "follow
error.suggestion to recover". Nothing checks that a suggestion is true. Of 379 suggestions measured
across five surfaces, 18% could be followed by a program exactly as written and 42% not at all. One
named a command no surface registers, and its test passed because it matched text
([research](recovery-research.md)). Studies of agents show they follow such advice faithfully, even
when they cannot carry it out.

**Outcome.** An agent that follows a refusal's advice gets further, and a test shows it. The
technique has precedent elsewhere: compilers apply their own fix suggestions and recompile, and
proof assistants replay a suggestion before offering it. No agent-facing interface the research
found does it.

**Status.** Complete (2026-11-25, closes [#2424](https://github.com/lushly-dev/afd/issues/2424)). All five steps merged ([#2433](https://github.com/lushly-dev/afd/pull/2433), [#2448](https://github.com/lushly-dev/afd/pull/2448), [#2459](https://github.com/lushly-dev/afd/pull/2459), [#2442](https://github.com/lushly-dev/afd/pull/2442), [#2476](https://github.com/lushly-dev/afd/pull/2476), [#2518](https://github.com/lushly-dev/afd/pull/2518), [#2539](https://github.com/lushly-dev/afd/pull/2539)); remaining follow-ups are tracked as [#2607](https://github.com/lushly-dev/afd/issues/2607)–[#2613](https://github.com/lushly-dev/afd/issues/2613) in [STATUS.md](STATUS.md).

## The steps

| Step | What it builds | Exit |
| --- | --- | --- |
| 1. Fix what is known | The suggestions the research found wrong; Python scenarios check `expect.error.suggestion` as TypeScript does; a factory test that every command a refusal names is served | The named defects fixed, each with a test that failed first |
| 2. A structured recovery | `CommandError.recovery` beside the prose: `call` a command, `fix-input`, `retry`, `external` or `stop`, specified in `spec/recovery.md`; schema, shared vectors and the wire fixtures in all four languages | Every language loads `spec/vectors/recovery.json` and round-trips the wire fixtures |
| 3. Follow and assert | A scenario expectation that follows a refusal's recovery and judges the result, in the TypeScript and Python runners; the factory's refusals carry recoveries its scenarios follow | The factory's executed jobs follow every recovery they reach; a planted wrong recovery fails a job |
| 4. Small worlds | A pilot on the factory: explore short command sequences over its fixture worlds and check that every refusal's recovery leads back toward a job's success | Every `call`, `fix-input` and `retry` recovery the explorer reaches is enabled and lands where the refused call can still succeed; a planted wrong recovery fails; what it finds is fixed or recorded. Whether to build it for other surfaces is decided with the owner after the pilot |
| 5. Engine recoveries | The errors AFD's engines emit carry recoveries: unknown command, rate limit, confirmation and approval, in all four languages, and the default server instructions say to follow `recovery` when present | The shared vectors pin each engine error's recovery, and every language produces it |

## What "progress" means

"The refusal went away" is not enough: automated program repair learned that a check the fix can
satisfy by removing the guard proves only plausibility. Step 3 therefore judges a followed recovery
in layers, each of which a test can read:

1. **The step can be taken.** A `call` names a command the caller can call, and it does not refuse
   in the same way.
2. **The original call gets further.** With `thenRetry`, the repeated call succeeds or fails with a
   different code the scenario names.
3. **An independent check holds.** The scenario's next steps read state the recovery cannot fake.
4. **Chains end.** Following recoveries from a refusal ends within a bound and never returns to the
   refusal it started from.

A recovery whose step bypasses the guard that refused (forcing, disabling a check) is legitimate
only where the scenario says so, as with the confirmation flow's repeated call.

## Scope

- The contract adds one optional field. No existing field, command input or engine behaviour
  changes; consumers that do not know `recovery` ignore it. Step 3 adds recoveries to the
  factory's refusals, which changes what those refusals return, not what they mean.
- Engine-emitted errors (`COMMAND_NOT_FOUND`, `RATE_LIMITED`, the confirmation and approval flows)
  gain recoveries in step 5, in all four languages at once, because each changes what an agent
  sees.
- Rust and C++ have no scenario runner, so step 3 covers TypeScript and Python; the other two
  check the field through the shared vectors and wire fixtures.
