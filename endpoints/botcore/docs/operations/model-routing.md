# Development model routing

Updated 2026-11-17. This guidance applies to agents developing Botcore. It does not choose models for applications built with Botcore.

Botcore is developed in the AFD repository and follows AFD's routing: [development model routing](../../../../docs/operations/model-routing.md) holds the routes, the rules for choosing and pinning them, and the evidence behind them. It is the only copy, so a route changes there.

In short, three models do the work:

- **GPT-6.2 Sol** for lower-cost, higher-volume tasks, `high` by default. It is on a measured trial from 2026-11-17, and review in a Codex session stays on GPT-6.1 Sol `high` until a replay.
- **Claude Opus 5.5** for the mid range: `medium` as the everyday model of a Claude session, `high` for independent review.
- **Claude Fable 5.2** for the high end: `low` for difficult contained work, `medium` for the approach to high-risk work, `high` only for stuck work, a high blast radius or strategy.

GPT-6.2 Astra is not yet a route: it is tried only when the owner asks, in a Codex session, for the approach to high-risk work, an advisor or stuck work, and never for review or assurance. Claude Sonnet 5.5, GPT-6 Luna and GPT-6 Astra are no longer routes.

Model choice never replaces deterministic tooling: run the task's required linters, tests and acceptance checks. Give the agent the authorized scope and a stop condition; a stronger route must not prompt extra work or a self-started review cycle.
