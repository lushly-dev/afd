$prompt = @"
Work on GitHub issue #37: [Command Pipeline] Tests and Documentation. Read the spec at docs/specs/command-pipeline/00-overview.md. Issue: https://github.com/lushly-dev/afd/issues/37. 
## Anvil Project Memory Context

### Related Specifications
- `docs\specs\command-pipeline\00-overview.md` (ID: spec-0ccebb26, areas: command-pipeline) Before implementing, review your available skills for this task. Run commit-messages and pr-review skills before creating the PR. When complete: create branch feat/issue-37, run build and test, commit, push, and create PR that closes the issue.
"@
claude --dangerously-skip-permissions $prompt
