# T08 consumer cutover and distribution

**State, 2026-11-02:** rehearsed, and waiting on the owner. Nothing has been cut over, no consumer's gates or Storybook configuration have changed, and nothing has been published. [What is needed](#what-is-needed-from-the-owner) is listed below.

T08's acceptance comes from the [implementation plan](implementation.md#ordered-implementation-queue): three consecutive qualifying full runner pairs on accepted consumer main snapshots with no migration change between them, normal consumer gates passing, review, scaffold and flake behaviour preserved, legacy Fluent exceptions accounted for, and exact rollback checkpoints. Package admission and main delivery go through their normal workflows.

## Where each requirement stands

| Requirement | State | Who |
| --- | --- | --- |
| Three consecutive pairs agree exactly | Rehearsed on both consumers, [below](#the-rehearsal) | Must be repeated on the accepted snapshots at cutover |
| Resource gate | **On a first measurement, full suites do not meet it.** [Below](#resources-the-decision-this-needs) | **Owner's decision** |
| Budgets | Met on both consumers, including Lushly's upgrade | Done, re-measured each change |
| Replacement gates | Every story rule has its evidence and retirement record ([T07](t07-coverage.md#retirement-records)) | One story needs the owner's decision |
| Native helpers and types | Not started: stories still import from `storybook/test` and `@storybook/web-components-vite` | Specimen's, once the owner says go |
| Normal consumer gates, with no root Storybook | Not started | Lushly's and FAST-AF's repositories |
| Rollback checkpoints | Not started | At each consumer's cutover |
| Legacy Fluent exceptions | Not started | Lushly |
| Human review of the index | Links verified ([T06](t06-full-runner.md#the-review-page)); no person has reviewed it | **Owner** |
| Distribution | All Specimen units quarantined; the FAST-AF plugin is private | **Owner** |

## The rehearsal

`experiments/run-retained.mjs --mode full`, three consecutive times per consumer on one build of Specimen at `4a26cc0b`, with two workers, recorded fonts and no retries.

| | FAST-AF `24e4eb86` (upstream's head) | Lushly `309f46b5` (main on 2026-11-02) |
| --- | --- | --- |
| Discovered, indexed | 407, 407 | 880, 880 |
| Identity mismatches | 0, 0, 0 | 0, 0, 0 |
| Passed in both, disagreements | 407, 0, three times | 880, 0, three times |

Lushly's snapshot was refreshed for this, six commits past the one T06 used, and those brought Storybook 10.6.5, Playwright 1.64 and new stories. Parity held through the upgrade with no change to Specimen, and its budgets did not move: shell 45,329, interaction support 595,647, accessibility 586,666, total 1,227,642.

**These are not yet the qualifying runs.** They ran in AFD's harness on read-only snapshots, not through each consumer's authoritative validation path, and nobody has accepted these snapshots. Lushly's main moved six commits in a day, so the proposal's rule that relevant consumer changes invalidate evidence means qualification has to happen at cutover. This shows the work is ready for that, and is stable when repeated.

## Resources: the decision this needs

The proposal says "the primary outcome MUST be lower resource cost for equivalent verified work". T04 passed on its representative wrapper components. Its full-suite figures remained open as G03, and this is the first measurement of them. Each side ran alone, once, under `/usr/bin/time -l`.

| | FAST-AF Storybook | FAST-AF Specimen | Lushly Storybook | Lushly Specimen |
| --- | --- | --- | --- | --- |
| Wall-clock | 12.1 s | 41.9 s | 83.3 s | 133.8 s |
| CPU, user and system | 67.8 s | 107.9 s | 211.1 s | 387.4 s |
| CPU per verified case | 0.167 s | 0.265 s | 0.240 s | 0.440 s |
| Largest single process | 1,007 MiB | 294 MiB | 2,244 MiB | 501 MiB |

| Specimen compared with Storybook | FAST-AF | Lushly | T04's criterion |
| --- | --- | --- | --- |
| CPU per verified case | 1.59× | 1.84× | At most 1× |
| Wall-clock | 3.46× | 1.61× | At most 1.25×, as a guardrail on startup and render |
| Largest single process | 0.29× | 0.22× | At most 1× |

**On this evidence, full suites would not meet T04's CPU criterion or its latency guardrail, while memory looks much better.**

What this measurement is and is not:

- **It is one run per side on a shared host,** at a load around 5, and not T04's recorder, its calibrated host or its repetition policy. CPU time is less sensitive to load than wall-clock, but this is a first reading and not a verdict.
- **CPU includes the descendants each side waited for,** which should cover both browsers. The memory figure is the largest single process, not the footprint of the whole tree, so it may flatter either side.
- **The likely cause is known and not profiled.** Each story gets a fresh browser context, a page load and axe's parse, as the proposal's isolation rule asks, where Storybook shares a page across a file. T06 recorded the same gap in wall-clock.

## What is needed from the owner

1. **The resource verdict, which decides whether cutover proceeds.** The options are to accept higher CPU for much lower memory and real per-story isolation, to reduce it first, or to measure it properly first. The recommendation is to measure on `random` under T04's policy, and profile where the per-story time goes, since that work needs no consumer change and would make either of the other choices better informed.
2. **The `violet-calendar` story.** [Its `Disabled` story never disables it.](t07-coverage.md#finding-a-disabled-story-that-disables-nothing) Fix it upstream, or say it should be waived, in which case the contract needs waivers.
3. **Distribution.** Whether and when to lift quarantine and publish the native core, bindings and CLI. The proposal also requires the FAST-AF plugin to have a supported distribution before a consumer cuts over, and it is private today.
4. **Consumer changes.** Lushly's migration is Lushly's, and Fastbot's adapter and rule retirement are in FAST-AF's repository. Neither has been touched.
5. **Where AFD's FAST-AF stories run** once upstream Storybook retires (G12), which is still unassigned.
6. **Human review** of the static index on a real consumer.

## What Specimen can do next, once there is a go

- A native helper entry and types (`expect`, `waitFor`, `userEvent`, `fn`, `within`; `Meta`, `StoryObj`), without which Storybook cannot be removed. This should also free Lushly's interaction budget, which has 4,353 bytes left.
- Whatever the resource verdict calls for.
- The qualifying runs themselves, at cutover, on the accepted snapshots.

T09 to T11 are optional additions and are not prerequisites for cutover.
