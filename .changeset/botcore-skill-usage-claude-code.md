---
"lushly-botcore": minor
---

### Added

- **`skill-usage-collect`** also reads Claude Code's own transcripts, so a session that never ran under T3 Code (one started in the Claude desktop app or from the command line) is counted. A tool call T3 Code ran is left to T3 Code's store, told by the program that started the session or by the call's id, which the store holds too, so a load both sources show is one load. Only a transcript that changed is read again, what it gave before is replaced by what it gives, and one that cannot be read whole is left as it was. A session is filed under the repository it ran in, or as `unknown` outside one. `BOTCORE_SKILL_USAGE_CLAUDE_DIR` names the transcripts folder, and an empty value turns the source off. `sources` in the result says what each source did (#1820).
