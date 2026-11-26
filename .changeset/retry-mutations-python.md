---
"afd-python": minor
---

### Fixed

- **Behaviour change: `create_retry_middleware` no longer repeats a mutation** ([#2673](https://github.com/lushly-dev/afd/issues/2673)). It used to retry any command whose failure code was `TRANSIENT_ERROR` or `TIMEOUT`, so a handler that returned `TIMEOUT` after a downstream write could have that write applied twice. A command that declares `mutation=True` now runs once and its failure is returned. The middleware reads the declaration from the command the engine's dispatch runs, through the continuation it was handed (as the journal reads `secret`), never from its name; a call whose declaration it cannot read (a direct call, or a `next` the engine did not build) counts as a mutation. Pass `retry_mutations=True` to restore the old behaviour, and only when every mutation it wraps is safe to repeat.
