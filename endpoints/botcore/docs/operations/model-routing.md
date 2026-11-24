# Development model routing

Updated 2026-11-23. This guidance applies to agents developing Botcore. It does not choose models for applications built with Botcore.

Botcore is developed in the AFD repository and follows AFD's routing: [development model routing](../../../../docs/operations/model-routing.md) holds the routes, the rules for choosing and pinning them, and the evidence behind them. It is the only copy, so a route changes there.

In short, four models do the work:

- **Gemini 4 Neon** (in T3 Code's Antigravity harness) as the preferred default when Google plans have room: `medium` for standard work, `high` for harder bounded work and independent review, bounded `xhigh` for a named escalation gap. No other Google model is a route.
- **Claude Opus 5.5** as the co-default on Claude plans: `medium` for standard work and current lane-assigned fleet cells, `high` for harder bounded work and independent review (and bounded `xhigh` only as the Fable-exhausted escalation fallback).
- **GPT-6.2 Astra** `high` only, as a cross-provider second reviewer on `risk:high`, security or deep-logic pull requests (routine PRs pair Neon `high` and Opus `high` to conserve OpenAI allowance). It makes no assurance decision.
- **Claude Fable 5.2** `high` only, reserved for stuck work, a high blast radius, or strategy.

GPT-6.2 Sol, GPT-6.1 Sol, GPT-6 Luna, GPT-6 Astra, GPT-6.2 Astra `low`/`medium`/`xhigh`, Claude Sonnet 5.5, Haiku 5.5, Fable `low`/`medium`/`xhigh`, `low` and `max` on any model, and all non-Neon Google models are not routes.

Model choice never replaces deterministic tooling: run the task's required linters, tests and acceptance checks. Give the agent the authorized scope and a stop condition; a stronger route must not prompt extra work or a self-started review cycle.
