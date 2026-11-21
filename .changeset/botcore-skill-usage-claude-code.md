---
"lushly-botcore": minor
---

### Added

- **`skill-usage-collect`** also reads Claude Code's own transcripts, so a session that never ran under T3 Code (one started in the Claude desktop app or from the command line) is counted. A session T3 Code ran is left to T3 Code's store, told by the program that started it or by a tool call the store holds too; a load both sources show is one load; and only a transcript that changed is read again. `BOTCORE_SKILL_USAGE_CLAUDE_DIR` names the transcripts folder, and an empty value turns the source off. `sources` in the result says what each source did (#1820).
