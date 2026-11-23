---
"lushly-botcore": minor
---

### Added

- **Read-only PR and checkout inspection commands** (`pr_status`, `pr_wait`, `pr_drift`, `dev_snapshot`) in `botcore.commands` and the `botcore` CLI, with `[pr]` configuration in `botcore.toml`, automatic GitHub GraphQL-to-REST rate-limit fallback, cross-platform opt-in locking and event watermarks for `pr_wait`, and `SK020` validation for optional `agents/openai.yaml` skill manifests in `skill_lint`.
