---
"lushly-botcore": minor
---

### Added

- **`skill-usage-collect`** adds the skill loads the harnesses recorded to this machine's record, so that skill use can be measured without a hook in a skill or a report from an agent. It reads T3 Code's local store read-only, which covers its Claude and Codex threads: the Skill tool, a file tool or shell command that reads a `SKILL.md`, and a message that opens by naming a skill. The record holds the skill, time, harness, model, project, session and agent, and never a prompt, a command or file contents. A changed store schema is reported as `SOURCE_SCHEMA_CHANGED` with nothing lost (#1815).
- **`skill-usage-report`** shows, per skill, the sessions that used it, loads, harness, agent, how it was loaded, the sessions where the person asked for it and its context cost, and lists the skills a checkout holds that nothing loaded. A renamed skill keeps one identity, from the renames in the project's git history (#1816).
