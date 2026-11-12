# Development model routing

Snapshot: 2026-11-09, the day Claude Fable 5.2 was released; the routes were set on 2026-11-12. This guide selects models for agents developing AFD. It does not select models for applications built with AFD. Lushly's routing policy carries the same guidance.

Three models do the work:

- **GPT-6.1 Sol** for lower-cost, higher-volume tasks.
- **Claude Opus 5.5** for the mid range, and as the everyday model of a Claude session.
- **Claude Fable 5.2** for the high end.

Claude Sonnet 5.5 is not a route. On the [index below](#evidence) Sol reaches each Sonnet score for a fraction of its cost, and Opus and Fable cover the rest.

## Routes

| Work | Model and effort | Notes |
| --- | --- | --- |
| High-volume work: implementation, coordination, research, mechanical edits, and review inside a Codex session | Sol `high` | The default for volume work |
| A named harder bounded deliverable | Sol `xhigh` | State the unresolved invariant, the check and the stop condition |
| Everyday work in a Claude session; open-ended architectural or UX judgment | Opus 5.5 `medium` | Importance alone does not justify more effort |
| Independent review in a Claude session, the pre-PR reviewer included | Opus 5.5 `high` | Fable `low` scores higher for less and is the candidate; replay real reviews on it before switching |
| Difficult contained work; consequential assurance | Fable 5.2 `low` | Falls back to Opus `high` when the plan's Fable allowance is short |
| The approach for high-risk work; an advisor consulted mid-task | Fable 5.2 `medium` | Within a point of Opus `xhigh` at under two thirds of its cost. Falls back to Opus `xhigh` |
| Stuck work, a high blast radius, or strategy | Fable 5.2 `high` | Say which of the three applies. Fable returns a diagnosis or a plan, and a cheaper route carries it out |

Settings that are not routes:

- **Sol `low` and `medium`** score 35 and 46.5. `high` adds 4 points over `medium` for $0.23 more per task, so one default covers volume work.
- **Opus 5.5 `low`** scores the same 35 at six times Sol `low`'s cost.
- **Fable 5.2 `xhigh`** adds about half a point over `high` for 63% more cost.
- **`max`** is not a route on any model.

Fable 5.2 has its own weekly limit on a subscription plan, so heavy use can leave only Opus for the rest of the week. Keep Fable `high` for the three named cases.

## Choosing and pinning

- Choose the least expensive route likely to complete a bounded deliverable at the required quality. Define the output and its checker before raising effort. Escalate on evidence of an unresolved problem, not on file count, a label or a failed command alone.
- Sol runs in Codex, and Opus and Fable in Claude Code. Start volume work where Sol runs. A session runs wholly on one provider: its subagents and review use that provider's routes, and it never invokes the other harness's CLI, hands part of a task to the other provider or asks for its sign-in. A whole task moves to the other provider only when the user asks, through tooling that starts it there, such as T3 Code's `delegate_task`.
- Honor a user's explicit model choice and the models actually available. An unavailable route is a blocker to report, not a reason to substitute another model silently.
- Pin the model and the effort on every delegation where the harness allows it. A child given neither inherits the session's, which may be far more than the task needs.
- For any delegation, give the agent one bounded deliverable, the files or contract it owns, and a way to verify completion. Use a fresh independent reviewer when the task's review workflow requires one. Reviewers report findings and do not edit or run validation; the implementation agent owns corrections and checks.

## Evidence

Artificial Analysis charts supplied by the owner on 2026-11-09: cost per Intelligence Index task, and index against cost. Cost is the labelled value. Index values are read off the scatter chart and are good to about one point.

| Model | Effort | Index | Cost per task |
| --- | --- | ---: | ---: |
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

- **Sol is the volume model.** Sol `high` (50.5) sits between Opus `medium` and Opus `high` at a quarter to a sixth of their cost, and Sol `xhigh` (52.5 at $0.76) matches Opus `high` at under a quarter of its cost.
- **Sonnet has no place.** Every Sonnet setting is beaten on index and cost by a Sol setting: `xhigh` (50 at $4.09) by Sol `xhigh` (52.5 at $0.76), `high` (41.5 at $1.64) by Sol `medium` (46.5 at $0.36).
- **Above Sol, Fable leads.** Fable `low` (54) is the cheapest setting clearly past Sol `xhigh`, and it beats Opus `high` by two points at 10% less cost. Opus `xhigh` (57.5) is also above Sol, but Fable `medium` comes within a point of it at under two thirds of the cost.
- **Fable `high` is the ceiling worth paying for.** It buys 5.5 points over `medium` for 2.4 times the cost; `xhigh` buys half a point more.

Limits of this evidence:

- The index is a broad benchmark, not AFD coding, review recall or design judgment. No AFD task has been replayed on these routes; compare accepted-task results before treating one as proven.
- Cost per task reflects the benchmark's token mix and API prices. A long agent loop is dominated by re-read context, and development sessions draw on subscription allowance, whose conversion neither provider publishes.
- Effort names are model-specific: `high` on one model is not `high` on another.
