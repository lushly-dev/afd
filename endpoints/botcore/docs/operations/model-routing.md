# Development model routing

Updated 2026-11-17. This guidance applies to agents developing Botcore. It does not choose models for applications built with Botcore.

Botcore is developed in the AFD repository and follows AFD's routing: [development model routing](../../../../docs/operations/model-routing.md) holds the routes, the rules for choosing and pinning them, and the evidence behind them. It is the only copy, so a route changes there.

In short, three models do the work, and a fourth reviews:

- **Claude Opus 5.5** for everyday work, implementation and fleet cells included: `medium` by default, `high` for independent review.
- **Claude Fable 5.2** for the high end: `low` for difficult contained work, `medium` for the approach to high-risk work, `high` only for stuck work, a high blast radius or strategy.
- **GPT-6.2 Astra** `high` as the second reviewer on every branch's first review, started on the other provider beside Opus. It makes no assurance decision.
- **GPT-6.2 Sol** only in a Codex session the owner is driving, as a measured trial.

Claude Sonnet 5.5, GPT-6.1 Sol, GPT-6 Luna and GPT-6 Astra are no longer routes.

Model choice never replaces deterministic tooling: run the task's required linters, tests and acceptance checks. Give the agent the authorized scope and a stop condition; a stronger route must not prompt extra work or a self-started review cycle.
