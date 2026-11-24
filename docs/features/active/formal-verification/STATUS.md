# Formal verification and stateful property checking

**State** Active for the approved claims pilot. The implementation is in review as [#2422](https://github.com/lushly-dev/afd/pull/2422). The triage job belongs to the [Software Factory](../software-factory/STATUS.md). Later verification methods remain proposals.

## How to keep this file

Record the date, revision and evidence for each step. Mark work done when it lands on main. Keep earlier decisions as history and mark superseded plans explicitly.

## Steps

| Step | State | Evidence or exit |
| --- | --- | --- |
| Initial draft, 2026-11-23 | Revised before merge | Drafted at `841511f23`. The original alternatives were factory stateful tests, a Rust/Kani pilot, and later TLC, a drift guard and skill changes. |
| Research and contract review, 2026-11-23 | In review on the branch | Refreshed to `38f5c2bba`. Read production studies and replayed three isolated claim histories through the factory host and Node CLI entry point. The two-live-claim case returned different holders. Both paths refused the observer. [Research](formal-verification.proposal.md#what-changes-with-the-industry-evidence) · [Fixture observations](formal-verification.proposal.md#baseline-observations) |
| Choose the holder rule | Approved 2026-11-23 | Earliest still-standing live claimant for the common two-branch case. [Pilot decision](formal-verification.proposal.md#pilot-decision) |
| Shared fixture and scenario | In review, [#2422](https://github.com/lushly-dev/afd/pull/2422) | Both readers use the [fifteen claim histories](../software-factory/scenarios/fixtures/claim-histories.json). The [factory scenario](../software-factory/scenarios/14b-identify-the-standing-claimant.scenario.yaml) follows the refusal to successful registration on a free issue. |
| Independent review, 2026-11-24 | Findings applied on branch | A fresh reviewer applied the diff to `38f5c2bba` and ran both readers, the commands that write and the gateway's reader. Three blockers and seven improvements, all applied: [what it found](#review-of-2026-11-24). |
| Releases and renewals keep the rule | In review, [#2422](https://github.com/lushly-dev/afd/pull/2422) | The label stays with a live claim that still stands, a non-holder takes back its own claim, and the CLI's read-back follows the readers. [What keeps the contract](formal-verification.proposal.md#baseline-observations) |
| Renewed holder's place after its first lease | Open for the owner | Both readers pass the issue to a rival that claimed in between. Recommended: keep it. [Pilot decision](formal-verification.proposal.md#pilot-decision) |
| Enumerated operation histories | Conditional | Compare incremental detection, replay and maintenance cost with the fixed cases. Keeping just the fixed cases is a successful outcome. |
| Adopt or stop | Not started | The plan's step 4: setup time, history and transition counts, added wall time over five runs on one runner, and a replay by another maintainer. Nothing is measured yet. |
| Kani, TLC and process changes | Deferred | Each requires its own unanswered question and a maintainer. [Investment decisions](formal-verification.proposal.md#where-to-invest-after-the-pilot) |

## Verification record

On 2026-11-23, `node --test --test-reporter=dot scripts/issue-claim.test.mjs` passed. The factory's locked development environment ran `tests/test_claims.py` and `tests/test_commands.py::test_already_claimed_names_the_holding_branch` under pytest (7 passed). The separate three-history comparison used temporary fixture data. It did not modify a GitHub issue. No generated history suite, solver or protocol model has been benchmarked.

The 2026-11-23 implementation reproduced the old factory refusal naming `fix/bravo` instead of `fix/alpha` on issue 302 before changing the reader. All six command steps then passed. The CLI already returned the expected holder.

Full local verification passed on Windows with Node 26 and Python 3.12, including the factory suite (913 passed, one skipped). The first run hit the token-store suite's permission check on the default Windows temp directory. The successful run used a private temp directory under the user profile. Remote CI has not run.

### Review of 2026-11-24

The reviewer rebuilt the 2026-11-23 change from its diff on `38f5c2bba`, on macOS with Node 24 and Python 3.12. Its suites passed there (the factory's 914, the CLI's 20), and with the base reader restored the new command test and the scenario failed on "Two live claims", as recorded above.

What it found, each by running the code:

- The gateway's reader, in the same plugin, names `fix/bravo` for the two-live-claims and later-branch-released histories when its App wrote the comments. The proposal had said the convention spans two readers only.
- Releasing through either command took the label off whatever else stood, which hid the other branch's live claim from both readers. After `lane-drop` a third cell registered beside a live claim. A later claimant could not release without `--force`, which ended both claims.
- The CLI's renewal beside a later rival released the holder's own claim.
- The Python reader's new renewal test named a property that held only until the first lease lapsed, and nothing pinned what happens after.
- `issue-check` no longer lists a live claim as stale when a later claim lapsed. The change had no test at the command and no line in the changeset.
- The plan's own planted fault failed the command test with a `TypeError`, not a named mismatch.
- Of nine planted reader faults in Python, existing unit tests caught every one the fixture test caught. In the CLI, "name the latest live claim" was caught by the fixture test alone.

Applied on 2026-11-24, on `c29634c61`:

- The proposal names the gateway's reader, its rule and when the pilot's contract ends.
- The label stays while another live claim stands, in the CLI's `release` and undo and in the factory's `lane-drop` and failed registration. A non-holder takes back its own claim without `--force`.
- The CLI's read-back backs off only when another branch's claim is the earliest live one. Both readers report a renewed holder's current lease.
- The fixture grew from five histories to fifteen: lapsed leases, a renewal on either side of its first lease, and three known differences, in four rows, with what each reader observes (a fourth, the hand-applied label, has a test on each side).
- The command test compares the holder as a whole and names the history, expected and observed values.

Watching each fix fail: with a fix taken out, one of the new tests failed, for each of the twelve changes tried (seven in the CLI, five in the factory). One of them was the fix the review itself proposed for the renewal, which is wrong for a claim made again after its lease ran out; a test holds that too.

Verified on 2026-11-24 on macOS with Node 26 and Python 3.14, with the changes uncommitted: `pnpm verify --keep-going` passed every step it planned (`ci.yml`'s check, and the local suites of `alfred.yml`, `botcore.yml`, `botcore-factory.yml` with 925 passed, and `health.yml`), and `node --test scripts/issue-claim.test.mjs` passed its 25 tests. Not run: Windows, Linux, Python 3.11 and 3.12, and remote CI.

Pull-request review, 2026-11-24, on the merge of `3cdfdb1b9`: two fresh reviewers (Opus 5.5 high and Gemini 4 Neon high), given the acceptance criteria and not this record. Both found one blocker, the same one: the CLI's `claim` read-back counted a claim live by its lease only, while `check` also counts an open PR on its branch, so `claim` could take back an issue `check` had just called the caller's, or report claimed an issue `check` then called held. Fixed, with the read-back, `check` and the release message now sharing one holder function, and tests on rows 312 and 313. Also fixed from their improvements: the release message names the remaining holder by its latest lease; `lane-drop` posts its release comment before it changes the label, so a failed comment leaves the issue held, and it keeps the label for a lapsed claim whose branch has an open PR, which the CLI reads as holding; a release marker's branch must be a string; and tests for a branch that released and claims again, and for a caller whose own lapsed claim sits on an issue an open PR holds. The proposal now names the hand-applied label as a fourth known difference and the gateway's G1 milestone. Each test for a fix failed with that fix taken out; the tests added for coverage alone pass before and after. A focused third pass verified these fixes; from it, `claim`'s read-back now asks whether any of the holding branch's live claims is the caller's, as `check` does, and a release reads the open PRs once.

Selection, read with `pnpm verify --list --files <path>`: a change to the fixture alone selects `botcore-factory.yml`, as does one to the factory's reader. A change to `scripts/issue-claim.mjs` alone selects no path-filtered workflow; its tests are in the tooling suite, which `ci.yml` runs on every pull request. No affected scope needed changing.

## Earlier open questions

The initial draft asked which tool to pilot, whether a SHA-based drift check should block merges and when to edit skills. The 2026-11-23 revision supersedes that sequence with a claims contract decision, an executable fixture, and evidence-based choices for subsequent work. No gate or skill change has been approved.
