# Development model routing

Updated 2026-09-29. This guidance applies to agents developing Botcore in Codex or Claude Code. It does not choose models for applications built with Botcore. Choose the model and effort for the immediate deliverable, pin delegated routes when supported, and measure completed-task quality, time, retries, and cost on representative work before changing a default.

## Codex

| Route | Use |
| --- | --- |
| GPT-6 Luna, xhigh | Bounded, repeatable work with clear acceptance checks: mechanical edits, focused tests, narrow investigation, and similar tasks. |
| GPT-6.1 Sol, medium | Default for integrative coding, repository investigation, implementation, and coordination across a few surfaces. |
| GPT-6.1 Sol, high | Deeper code reasoning or complex integration when medium lacks headroom. |
| GPT-6.1 Sol, xhigh | Optional trial for difficult but contained coding when a cheaper setting has a concrete quality gap. Name the invariant, an executable checker, and a stop condition; compare with high before adopting. |
| GPT-6 Astra, low | Starting route for contextual or UX judgment when Sol's cheaper setting has a concrete quality gap. Escalate Astra effort only for a bounded question with a stated consequence, checker, and stop condition. |

Do not make maximum effort a default. More reasoning can increase cost and delay without improving a task's result. Use the harness's supported effort names; do not translate effort labels across model families as if they represented equal work.

Model choice never replaces deterministic tooling: run the task's required linters, tests, and acceptance checks. Give the agent the authorized scope and stop condition; stronger effort must not prompt extra work or a self-started review cycle.

## Claude Code

| Route | Use |
| --- | --- |
| Claude Sonnet 5.5, medium | Default for bounded everyday implementation, coordination, and drafting. |
| Claude Sonnet 5.5, high | Candidate for difficult contained coding with a strong independent checker. Compare completed-task results with Opus before replacing an established route. |
| Claude Opus 5.5, medium | Open-ended architecture, product or UX judgment, and work requiring broader synthesis. |
| Claude Opus 5.5, high | Critical assurance or a review role whose quality has been proven on local examples. |

Treat these as routing candidates, not a claim that Sonnet is always cheaper per completed task or that it replaces a proven reviewer. Escalate based on missing quality or judgment, not file count alone. Keep each delegated task bounded and record the reason for an unusually strong route.

## Evidence and limits

[OpenAI's GPT-6.1 Sol announcement](https://openai.com/index/introducing-gpt-6-1-sol/) reports improved coding and professional-work performance over GPT-6 Sol, with API prices of $2 input, $0.10 cached input, and $10 output per million tokens. [Artificial Analysis's GPT-6.1 Sol assessment](https://artificialanalysis.ai/articles/gpt-6-1-sol-replaces-gpt-6-sol-after-just-7-days-with-near-astra-intelligence) reports that xhigh exceeded max by three points on its Coding Agent Index and scored one point above Astra at less than 15% of that index's cost per task. This is a specific coding harness result; its broader Intelligence Index ranks Astra higher and does not imply a general xhigh advantage.

[Anthropic's Sonnet 5.5 announcement](https://www.anthropic.com/claude-sonnet-5-5) describes it as a complement to Opus 5.5 for well-scoped work, with $2 input and $10 output per million tokens. [Anthropic's prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5) recommends medium for well-specified agentic coding and high for harder work, while warning that higher settings need measurement. [Artificial Analysis's Sonnet 5.5 assessment](https://artificialanalysis.ai/articles/claude-sonnet-5-5) finds that quality and cost per task vary by effort; its evaluation used a prerelease deployment with a structured-output issue that Anthropic says was fixed before release. Both providers' benchmarks have context limitations. These are evidence for trying the routes, not Botcore-specific evaluation results. Validate them against local completion criteria before changing production workflows or reviewer assignments.
