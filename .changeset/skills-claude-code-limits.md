---
"@lushly-dev/afd-testing": minor
"@lushly-dev/afd-cli": minor
"@lushly-dev/afd-client": patch
---

`afd validate --surface` now checks a server's skill catalog against Claude Code's limits when the server declares `io.modelcontextprotocol/skills`. It warns about a catalog of more than 100 skills, which Claude Code applies to every server, and, for the skills Claude Code scans (claude.ai Directory connectors and connectors with organization scanning), about a text file over 100 KB, a skill whose text files total over 400 KB, and a skill it would not load because it holds an archive, another binary file (such as WebP or OTF) or text under `dist/`. Each warning names the skill, the limit and Claude Code. Images, fonts, media and dependency lock files are not counted, and a KB is taken as 1,000 bytes. The check follows `skills/list` pages, counts dynamic skills toward the 100, and reports an entry or file it could not read as not checked; that, too, is a warning. The findings never fail the run unless `--strict` is set, and `--suppress <rule>` or `--suppress <rule>:<skill>` turns one off. `@lushly-dev/afd-testing` exports the check as `checkClaudeCodeSkillLimits`, with `CLAUDE_CODE_SKILL_LIMITS`. `McpClient.request` over `streamable-http` now forwards `skills/list` and `skills/get` instead of answering that the transport does not support them.
