# Development model routing

Snapshot: 2026-11-17, the day GPT-6.2 Sol and GPT-6.2 Astra were released. The Claude routes were set on 2026-11-12, after Claude Fable 5.2's release on 2026-11-09. This guide selects models for agents developing AFD. It does not select models for applications built with AFD. Lushly's routing policy carries the same guidance.

Three models do the work, and a fourth is on trial:

- **GPT-6.2 Sol** for lower-cost, higher-volume tasks. It replaced GPT-6.1 Sol on 2026-11-17 as a measured trial, and review in a Codex session stays on GPT-6.1 Sol until a replay ([the GPT-6.2 trial](#the-gpt-62-trial)).
- **Claude Opus 5.5** for the mid range, and as the everyday model of a Claude session.
- **Claude Fable 5.2** for the high end.
- **GPT-6.2 Astra** is on trial for the high end of a Codex session, only when the owner asks ([the GPT-6.2 trial](#the-gpt-62-trial)). It is not yet a route.

Claude Sonnet 5.5 is not a route. On the [index below](#evidence) Sol reaches each Sonnet score for a fraction of its cost, and Opus and Fable cover the rest.

## Routes

| Work | Model and effort | Notes |
| --- | --- | --- |
| High-volume work: implementation, coordination, research and mechanical edits in a Codex session | GPT-6.2 Sol `high` | The default for volume work |
| Review inside a Codex session, the pre-PR reviewer included | GPT-6.1 Sol `high` | Until the review replay [below](#the-gpt-62-trial). If Codex no longer offers 6.1, the route is unavailable: report it to the owner, who chooses between running the replay first and reviewing on 6.2 Sol `high` with the substitution recorded in the pull request |
| A named harder bounded deliverable | GPT-6.2 Sol `xhigh` | State the unresolved invariant, the check and the stop condition |
| Everyday work in a Claude session; open-ended architectural or UX judgment | Opus 5.5 `medium` | Importance alone does not justify more effort |
| Independent review in a Claude session, the pre-PR reviewer included | Opus 5.5 `high` | Fable `low` scores higher for less and is the candidate; replay real reviews on it before switching |
| Difficult contained work; consequential assurance | Fable 5.2 `low` | Falls back to Opus `high` when the plan's Fable allowance is short |
| The approach for high-risk work; an advisor consulted mid-task | Fable 5.2 `medium` | Within a point of Opus `xhigh` at under two thirds of its cost. Falls back to Opus `xhigh` |
| Stuck work, a high blast radius, or strategy | Fable 5.2 `high` | Say which of the three applies. Fable returns a diagnosis or a plan, and a cheaper route carries it out |

Settings that are not routes:

- **GPT-6.2 Sol `low` and `medium`** score 41 and 53. `high` adds 2 points over `medium` for $0.15 more per task. The step is small, but so is its cost, and `high` is the setting 6.1's record was built on, so the trial compares like with like.
- **GPT-6.2 Astra `low`** scores 46 at $0.66, below Sol `medium` for more cost.
- **Opus 5.5 `low`** scores 35, six points below Sol `low`, at five times its cost.
- **Fable 5.2 `xhigh`** adds about half a point over `high` for 63% more cost.
- **`max`** is not a route on any model.

Fable 5.2 has its own weekly limit on a subscription plan, so heavy use can leave only Opus for the rest of the week. Keep Fable `high` for the three named cases.

## The GPT-6.2 trial

On the Intelligence Index GPT-6.2 Sol gains 3.5 to 6.5 points over GPT-6.1 Sol at every effort for about the same cost per task. On Artificial Analysis's Coding Agent Index it loses 3 points, and that index is closer to AFD's work. The trial settles which result holds here:

- **Sol 6.2 carries volume work from 2026-11-17.** Record the route with the full model ID, `gpt-6.2-sol/high`, in a fleet cell's `--route` and in a pull request's review record, so its results stay separate from 6.1's. Judge it on the share of branches that pass their final checks first time and the rework reviewers ask for, against any fleet cells recorded as `sol/high` and the Codex pull requests merged before 2026-11-17. One bad branch is not a verdict: once at least ten 6.2 branches have reached a final check, the owner compares them, and if 6.2 does worse on either measure the route returns to `gpt-6.1-sol`.
- **Codex review stays on 6.1 until a replay.** Replay a set of real reviews on 6.2 Sol `high`, and switch only if it finds at least what 6.1 found. The coding-index loss comes from repository question answering, where 6.2 more often leaves out key facts: that is how a reviewer misses a finding.
- **Astra 6.2 is tried only when the owner asks for it** in that session or a fleet's brief. The trial covers the jobs a Codex session has no route for above Sol `xhigh`: the approach for high-risk work and an advisor consulted mid-task at Astra `high`, and stuck work at Astra `xhigh`. Otherwise Sol `xhigh` stays the route. Astra returns a plan or a diagnosis, and Sol carries it out. Record the route as `gpt-6.2-astra/<effort>` in a fleet cell's `--route` and in the pull request's review record, with whether the plan led to a branch that passed its final checks; the owner ends or extends the trial from those records. Strategy and work with a high blast radius stay with Fable `high`, and work moves to Fable only when the user moves it.
- **Astra is not tried for review or assurance.** Astra never makes the diagnosis that admits a gate edit in a repair or picks the merge to revert on a broken `main`: that is assurance, and it stays on the route that already owns it, or with the owner. Astra's system card reports it omitting a known obstacle in 22% of Blocker Deception trials, twice GPT-6 Astra's 11%. OpenAI says Codex's developer prompt reduces this.

## Choosing and pinning

- Choose the least expensive route likely to complete a bounded deliverable at the required quality. Define the output and its checker before raising effort. Escalate on evidence of an unresolved problem, not on file count, a label or a failed command alone.
- Sol and Astra run in Codex, and Opus and Fable in Claude Code. Start volume work where Sol runs. A session runs wholly on one provider: its subagents and review use that provider's routes, and it never invokes the other harness's CLI, hands part of a task to the other provider or asks for its sign-in. A whole task moves to the other provider only when the user asks, through tooling that starts it there, such as T3 Code's `delegate_task`.
- Honor a user's explicit model choice and the models actually available. An unavailable route is a blocker to report, not a reason to substitute another model silently.
- Pin the model and the effort on every delegation where the harness allows it. A child given neither inherits the session's, which may be far more than the task needs.
- For any delegation, give the agent one bounded deliverable, the files or contract it owns, and a way to verify completion. Use a fresh independent reviewer when the task's review workflow requires one. Reviewers report findings and do not edit or run validation; the implementation agent owns corrections and checks.

## Evidence

Artificial Analysis charts supplied by the owner: cost per Intelligence Index task, and index against cost, on 2026-11-09 for the Claude models and GPT-6.1 Sol, and on 2026-11-17 for GPT-6.2. The Claude values had not changed on 2026-11-17. Cost is the labelled value. Index values are read off the scatter chart and are good to about one point; the GPT-6.2 values match [Artificial Analysis's model pages](https://artificialanalysis.ai/models/gpt-6-2-sol) to within that point.

| Model | Effort | Index | Cost per task |
| --- | --- | ---: | ---: |
| GPT-6.2 Sol | low | 41 | $0.18 |
| GPT-6.2 Sol | medium | 53 | $0.41 |
| GPT-6.2 Sol | high | 55 | $0.56 |
| GPT-6.2 Sol | xhigh | 56 | $0.65 |
| GPT-6.2 Astra | low | 46 | $0.66 |
| GPT-6.2 Astra | medium | 57 | $1.62 |
| GPT-6.2 Astra | high | 60 | $2.07 |
| GPT-6.2 Astra | xhigh | 62 | $2.52 |
| GPT-6.1 Sol | low | 35 | $0.16 |
| GPT-6.1 Sol | medium | 46.5 | $0.36 |
| GPT-6.1 Sol | high | 50.5 | $0.59 |
| GPT-6.1 Sol | xhigh | 52.5 | $0.76 |
| Claude Sonnet 5.5 | low | 25.5 | $0.51 |
| Claude Sonnet 5.5 | medium | 31 | $0.78 |
| Claude Sonnet 5.5 | high | 41.5 | $1.64 |
| Claude Sonnet 5.5 | xhigh | 50 | $4.09 |
| Claude Opus 5.5 | low | 35 | $0.98 |
| Claude Opus 5.5 | medium | 48 | $2.45 |
| Claude Opus 5.5 | high | 52 | $3.46 |
| Claude Opus 5.5 | xhigh | 57.5 | $6.05 |
| Claude Fable 5.2 | low | 54 | $3.10 |
| Claude Fable 5.2 | medium | 56.5 | $3.80 |
| Claude Fable 5.2 | high | 62 | $9.08 |
| Claude Fable 5.2 | xhigh | 62.5 | $14.83 |

What it shows:

- **Sol 6.2 gains at every effort.** It adds 6 points at `low`, 6.5 at `medium`, 4.5 at `high` and 3.5 at `xhigh` over 6.1, for slightly more at `low` and `medium` and less at `high` and `xhigh`.
- **On the index, GPT-6.2 matches or beats every Claude route for a fraction of the cost.** Sol `medium` (53 at $0.41) is above Opus `medium` and level with or above Opus `high`. Sol `high` (55 at $0.56) is level with or above Fable `low`. Astra `medium` (57 at $1.62) is level with Fable `medium` and Opus `xhigh`, and Astra `xhigh` (62 at $2.52) is level with Fable `high` at 28% of its cost.
- **Coding does not follow the index.** Artificial Analysis's [Coding Agent Index](https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol), run in the Codex harness at `max`, has 6.2 Sol 3 points below 6.1 Sol and 6.2 Astra flat with GPT-6 Astra. That is why 6.2 is a trial and the Claude routes are unchanged: a session's provider is set by the user and the plan with room, and an index lead alone does not move work across providers.
- **Sonnet has no place.** Every Sonnet setting is beaten on index and cost by a Sol setting: `xhigh` (50 at $4.09) by Sol 6.2 `medium` (53 at $0.41), `high` (41.5 at $1.64) by Sol 6.2 `medium` too, and matched within a point by Sol 6.2 `low` (41 at $0.18).
- **Within Claude, Fable leads.** Fable `low` (54) beats Opus `high` by two points at 10% less cost. Fable `medium` comes within a point of Opus `xhigh` (57.5) at under two thirds of the cost.
- **Fable `high` is the Claude ceiling worth paying for.** It buys 5.5 points over `medium` for 2.4 times the cost; `xhigh` buys half a point more.

Limits of this evidence:

- The index is a broad benchmark, not AFD coding, review recall or design judgment. No AFD task has been replayed on these routes; compare accepted-task results before treating one as proven.
- Cost per task reflects the benchmark's token mix and API prices. A long agent loop is dominated by re-read context, and development sessions draw on subscription allowance, whose conversion neither provider publishes.
- Effort names are model-specific: `high` on one model is not `high` on another.
- Reports from developers on GPT-6.2's release day were mixed: agents looping on long tasks, asking needless questions and overengineering, and Astra harder to steer, against praise for review and code quality. These are anecdotes, and the trial is what decides.
