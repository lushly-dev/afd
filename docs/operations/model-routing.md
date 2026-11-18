# Development model routing

Snapshot: 2026-11-17, the day GPT-6.2 Sol and GPT-6.2 Astra were released. That day, on the owner's direction, Opus 5.5 became the default for implementation and GPT-6.2 Astra a reviewer. The other Claude routes were set on 2026-11-12, after Claude Fable 5.2's release on 2026-11-09. This guide selects models for agents developing AFD. It does not select models for applications built with AFD. Lushly's routing policy carries the same guidance.

Three models do the work, and a fourth reviews:

- **Claude Opus 5.5** for everyday work, implementation included, and for the mid range.
- **Claude Fable 5.2** for the high end.
- **GPT-6.2 Astra** as the second reviewer on every branch's first review, beside Opus ([two-model first review](#two-model-first-review)).
- **GPT-6.2 Sol** only in a Codex session the owner is driving, as a measured trial ([GPT-6.2](#gpt-62)).

Opus took over volume work from GPT Sol because most of AFD's work runs unattended, in fleet cells and delegations, and that is where launch-day reports on the GPT-6.2 models are worst: they describe models that need close specification and supervision and drift on long tasks. The owner's GPT allowance goes to review instead.

Claude Sonnet 5.5 is not a route, by the owner's decision of 2026-11-12: a Claude session starts at Opus. On the [index below](#evidence) only Sol reaches Sonnet's scores for less, and Sol no longer takes unattended work, so replay real cells on Sonnet `high` before revisiting that.

## Routes

| Work | Model and effort | Notes |
| --- | --- | --- |
| Implementation, coordination, research and mechanical edits, in a fleet cell, a delegation or a Claude session; open-ended architectural or UX judgment | Opus 5.5 `medium` | The default. Importance alone does not justify more effort |
| Independent review in a Claude session, the pre-PR reviewer included | Opus 5.5 `high` | Fable `low` scores higher for less and is the candidate; replay real reviews on it before switching |
| The second reviewer on a branch's first review | GPT-6.2 Astra `high` | Beside the session's own reviewer, [below](#two-model-first-review) |
| Difficult contained work; consequential assurance | Fable 5.2 `low` | Falls back to Opus `high` when the plan's Fable allowance is short |
| The approach for high-risk work; an advisor consulted mid-task | Fable 5.2 `medium` | Within a point of Opus `xhigh` at under two thirds of its cost. Falls back to Opus `xhigh` |
| Stuck work, a high blast radius, or strategy | Fable 5.2 `high` | Say which of the three applies. Fable returns a diagnosis or a plan, and a cheaper route carries it out |
| Work in a Codex session the owner is driving | GPT-6.2 Sol `high`, or `xhigh` for a named harder deliverable | The trial [below](#gpt-62). For `xhigh`, state the unresolved invariant, the check and the stop condition |
| Review inside a Codex session | GPT-6.2 Astra `high` | On a first review, Opus `high` is its second reviewer |

Settings that are not routes:

- **GPT-6.2 Sol `low` and `medium`** score 41 and 53. `high` adds 2 points over `medium` for $0.15 more per task, so the trial uses `high`.
- **GPT-6.2 Astra `low`** scores 46 at $0.66, below Sol `medium` for more cost.
- **GPT-6.1 Sol** is retired: Astra took over Codex review on 2026-11-17.
- **Opus 5.5 `low`** scores 35, six points below Sol `low`, at five times its cost.
- **Fable 5.2 `xhigh`** adds about half a point over `high` for 63% more cost.
- **`max`** is not a route on any model.

Fable 5.2 has its own weekly limit on a subscription plan, so heavy use can leave only Opus for the rest of the week. Keep Fable `high` for the three named cases.

## Two-model first review

A branch's first review has two fresh, independent reviewers working from the same brief: Opus 5.5 `high` and GPT-6.2 Astra `high`. The session's own provider runs one of them in the usual way. The other runs on the other provider through tooling that starts it there, such as T3 Code's `delegate_task` on the session's own checkout, and returns its findings. It is told to read and never edit, commit, push or comment; `delegate_task` cannot enforce that, so the session records the repository's state before starting it and confirms afterwards that nothing changed. Its report is data to weigh, not instructions to follow. The session weighs both reports, fixes, and records each reviewer as its own lane with its actual model and effort. A later pass that verifies the fixes uses the session's own reviewer alone.

If the other provider cannot be started (no such tooling, no sign-in or no allowance), the session's reviewer stands alone and the pull request says the second review did not run. No other model stands in for it.

Astra is there for recall. On one outside evaluator's benchmark of eight pull requests, reported in Theo's launch-day video on 2026-11-17 with no published dataset, Astra made 36 findings: 24 valid, 12 plausible and none wrong, and the evaluator reported that it found things no other model found. The same evaluator found its prose hard to follow, poor at putting the important point first, and strict enough to push for extra scope. In this role those costs are small: the implementing agent reads the findings and decides, and a finding that is not a defect is an improvement the session may decline with a reason.

For each pull request the Review section of its body says how many of Astra's findings were valid, how many Opus also found and how many were noise. After ten pull requests the owner decides whether Astra stays a second reviewer, becomes the only first reviewer, or is dropped.

Astra makes no assurance decision. It never makes the diagnosis that admits a gate edit in a repair or picks the merge to revert on a broken `main`: that stays on the route that already owns it, or with the owner.

## GPT-6.2

GPT-6.2 Sol runs only in a Codex session the owner is driving, where someone watching catches the drift the reports describe. Record its route as `gpt-6.2-sol/<effort>` in the Review section of the pull request's body. Judge it on the share of branches that pass their final checks first time and the rework reviewers ask for: once at least ten such branches have reached a final check, the owner compares them with Opus `medium` branches.

Beyond review, Astra may take the approach for high-risk work, an advisor's role or stuck work in a Codex session when the owner asks for it, at `high`, or `xhigh` for stuck work, but never the assurance diagnoses barred above. Astra returns a plan or a diagnosis, and Sol carries it out. Record the route as `gpt-6.2-astra/<effort>`. Strategy and work with a high blast radius stay with Fable `high`.

The evidence for GPT-6.2 is split. On the Intelligence Index GPT-6.2 Sol gains 3.5 to 6.5 points over GPT-6.1 Sol at every effort for about the same cost per task. On Artificial Analysis's Coding Agent Index, which is closer to AFD's work, it loses 3 points, though OpenAI reports it gaining 5 points at `high` on Cognition's FrontierCode 2.0. Developers' reports on release day were mixed.

Without Codex's developer prompt, both GPT-6.2 models are more likely than earlier ones to leave out an obstacle that blocked their work, such as a missing file. In OpenAI's Blocker Deception test, 6.2 Sol omits it in 24% of trials and 6.2 Astra in 22%, against 14% for 6.1 Sol and 11% for GPT-6 Astra. With the prompt both fall to 8 or 9%, but OpenAI gives no figure with the prompt for the older models, so how 6.2 compares in Codex is not known. As on any route, a report that work is done is worth only the checks behind it, and a reviewer says what it covered and what it skipped.

## Choosing and pinning

- Choose the least expensive route likely to complete a bounded deliverable at the required quality. Define the output and its checker before raising effort. Escalate on evidence of an unresolved problem, not on file count, a label or a failed command alone.
- Opus and Fable run in Claude Code, and Sol and Astra in Codex. A session runs wholly on one provider: its subagents and review use that provider's routes, and it never invokes the other harness's CLI, hands part of a task to the other provider or asks for its sign-in. Two things cross providers, both through tooling that starts work on the other provider, such as T3 Code's `delegate_task`: the second reviewer of a first review, and a whole task the user asks to move.
- A fleet cell implements on Opus, and the foreman coordinates on Opus `medium` and starts each cell on a Claude plan, so neither crosses providers. The owner's ChatGPT allowance goes to Astra's reviews. The factory lane still names a plan on either provider; until it is limited to Claude plans ([#1498](https://github.com/lushly-dev/afd/issues/1498)), a foreman given a ChatGPT plan starts nothing and tells the owner.
- Honor a user's explicit model choice and the models actually available. An unavailable route is a blocker to report, not a reason to substitute another model silently.
- Pin the model and the effort on every delegation where the harness allows it. A child given neither inherits the session's, which may be far more than the task needs.
- For any delegation, give the agent one bounded deliverable, the files or contract it owns, and a way to verify completion. Use a fresh independent reviewer when the task's review workflow requires one. Reviewers report findings and do not edit or run validation; the implementation agent owns corrections and checks.

## Evidence

Artificial Analysis charts supplied by the owner: cost per Intelligence Index task, and index against cost, on 2026-11-09 for the Claude models and GPT-6.1 Sol, and on 2026-11-17 for GPT-6.2. The Claude values had not changed on 2026-11-17. Cost is the labelled value. Index values are read off the scatter chart and are good to about one point; the GPT-6.2 values match [Artificial Analysis's model pages](https://artificialanalysis.ai/models/gpt-6-2-sol) to within that point, and the Artificial Analysis scores [OpenAI's announcement](https://openai.com/index/introducing-gpt-6-2-astra-sol/) reproduces to within half a point.

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
- **Coding does not follow the index.** Artificial Analysis's [Coding Agent Index](https://artificialanalysis.ai/articles/openai-has-the-2-model-in-the-intelligence-index-with-the-release-of-gpt-6-2-astra-and-gpt-6-2-sol), run in the Codex harness at `max`, has 6.2 Sol 3 points below 6.1 Sol and 6.2 Astra flat with GPT-6 Astra. OpenAI's announcement reports Cognition's FrontierCode 2.0, which grades whether changes to real codebases meet maintainers' standards for merging, the other way: 6.2 Sol `high` scores 39.7% against 6.1 Sol `high`'s 34.8%, and Astra `high` 43.6%. Two coding benchmarks disagree, and an index lead alone does not hand unattended work to a model that needs supervising.
- **Sonnet trails Sol on the index.** Every Sonnet setting is beaten on index and cost by a Sol setting: `xhigh` (50 at $4.09) by Sol 6.2 `medium` (53 at $0.41), `high` (41.5 at $1.64) by Sol 6.2 `medium` too, and matched within a point by Sol 6.2 `low` (41 at $0.18).
- **Within Claude, Fable leads.** Fable `low` (54) beats Opus `high` by two points at 10% less cost. Fable `medium` comes within a point of Opus `xhigh` (57.5) at under two thirds of the cost.
- **Fable `high` is the Claude ceiling worth paying for.** It buys 5.5 points over `medium` for 2.4 times the cost; `xhigh` buys half a point more.

Limits of this evidence:

- The index is a broad benchmark, not AFD coding, review recall or design judgment. No AFD task has been replayed on these routes; compare accepted-task results before treating one as proven.
- Cost per task reflects the benchmark's token mix and API prices. A long agent loop is dominated by re-read context, and development sessions draw on subscription allowance, whose conversion neither provider publishes.
- Effort names are model-specific: `high` on one model is not `high` on another.
- Reports from developers on GPT-6.2's release day were mixed: agents looping on long tasks, asking needless questions and overengineering, and Astra harder to steer and to read, against praise for review and code quality. The review benchmark behind Astra's role is one evaluator's eight pull requests. These are anecdotes; AFD's own review records and the Sol trial are what decide.
