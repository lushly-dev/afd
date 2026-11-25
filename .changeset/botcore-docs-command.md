---
"lushly-botcore": minor
---

### Added

- **`botcore docs [TOPIC]`** prints a docs topic on the command line: the same text the local server's docs tool returns, from the same function (`botcore.server.render_docs_topic`), so the two cannot drift. With no topic it lists every topic with its first line; an unknown topic is refused with the topics that exist and exit code 1 (`UNKNOWN_TOPIC` with `--json`). The disk-hygiene skill's pointer, `botcore docs skill`, now works (#2479).
