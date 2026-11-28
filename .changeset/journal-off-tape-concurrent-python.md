---
"afd-python": patch
---

### Security

- **`create_journal_middleware` and `run_off_tape`** no longer swap `context.clock` and `context.random` on a context object that concurrent calls share. Each dispatch now reads its recording or untaped sources through a per-dispatch view (a context variable), so a secret call running beside a recorded one on the same context, as through Botcore's `CommandHost`, puts none of its values on the sibling's tape, and no longer marks the sibling's tape `truncated` or leaves its recorder on the context (#2703).
- **A read on a thread that carries no context variables** (`loop.run_in_executor`, a middleware that moves the chain to such a thread) goes to the innermost journal step when the steps running on the context are nested in one another. When siblings run, it reads the context's own source and every running recording's tape is marked `truncated`, rather than guessing whose read it was. Use `asyncio.to_thread` or `contextvars.copy_context().run` to keep such reads exact. A context whose `clock` or `random` was `None` keeps `None` after a recorded call instead of coming back with the system source (#2703).
