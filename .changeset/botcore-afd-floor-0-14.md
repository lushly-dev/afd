---
"lushly-botcore": minor
---

### Changed

- **Botcore requires `afd>=0.14.0`, and its `mcp` extra `afd[server]>=0.14.0`** (was `afd>=0.9.0` and `afd[server]>=0.13.0`). `CommandPolicy(secret=True)` relies on `afd.core.open_dispatch` and `afd.server.run_off_tape`, which first ship in afd 0.14.0, so the fallback that left `secret` without effect on an older afd, and the `RuntimeWarning` it raised at registration, are removed. **Migration:** upgrade `afd` to 0.14.0 or later alongside Botcore.
