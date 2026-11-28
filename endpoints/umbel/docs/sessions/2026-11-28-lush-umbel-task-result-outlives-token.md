# A finished task's result outlives its starting token

- Date: 2026-11-28
- Area: phase 5, auth and hosted
- Pull request: [#N](https://github.com/lushly-dev/afd/pull/N), on `lush/umbel-task-result-outlives-token`

The owner decided on 2026-11-26 that a finished task's result stays readable past the starting
token's expiry for the same principal, capped by the task's own TTL
([#2506](https://github.com/lushly-dev/afd/issues/2506)); AFD's `spec/tasks.md` says so since
[#2975](https://github.com/lushly-dev/afd/pull/2975). Umbel's `src/shared/tasks.rs` no longer caps
a task's TTL at its token's `exp` plus a minute (`options()` drops
`with_ttl_capped_at_token_expiry` and `TOKEN_EXPIRY_GRACE_MS` is gone), and `SqliteTasks` no longer
purges a finished result at the token's `exp`: `content_until_ms` is written equal to `expires_ms`
and read by nothing, so the schema stays at version 1 and a row an older build wrote lasts to its
TTL. A task still stops with `TASK_TOKEN_EXPIRED` at its token's `exp`, a gateway task at its
assertion's. D225 records the decision; the phase 5 specification has a section for it, and step
8's grace row is marked superseded.

Tests: the store's unit tests read every finished task (a result, a cancellation, the notice) with
a later token of the same principal past the starting token's `exp`, and not with another client,
until the TTL; `tests/it/tasks.rs` does the same end to end over two processes for an OAuth token
of 300 seconds and one of 30, and for a gateway assertion. VERIFY_LINE
