---
"lushly-botcore": minor
---

### Added

- **botcore-agents registers `team_status`, `task_list`, and `task_cancel`** (lushly-dev/afd#2234). `team_status` returns live health snapshots across all agents and task counts, `task_list` lists tracked tasks with optional `status`/`agent` filters and live progress for running tasks, and `task_cancel` cancels pending, assigned, or running tasks (aborting live chat streams and freeing the agent slot).

### Fixed

- **Teams cancel, task-list, and team-status intents reach registered `botcore-agents` commands** (lushly-dev/afd#2234). `botcore-teams` now parses cancel messages into `task_id` (returning `MISSING_TASK_ID` with a suggestion when no id is present, without falling through to `task_assign`), renders task IDs/descriptions and agent names/statuses in Adaptive Cards for list responses, and tests every Teams intent through a real registry holding `AGENT_COMMANDS`.
