# Changelog

## Unreleased

- `alfred_quality` reports `description-too-long` above 300 characters (was 120) as a `warning` that does not count toward `issue_count`; each issue carries a `severity` and the result adds `warning_count`.

## 0.2.0

- Add one Alfred command host shared by CLI, MCP and AFD DirectClient, with explicit worktree/package/area selection and discoverable command effects and applicability.
- Add native development, workspace, documentation, specification and skill commands alongside the established AFD lint, parity and quality checks. AFD architectural rules remain scoped to AFD packages and integrations.
- Preserve execution success separately from quality verdicts. Required plans fail for skipped, unavailable, errored and failing checks.
- Bind npm fragment operations to the approved AFD root controller and route consume through the selected-unit version controller. Other projects retain their own release protocols.
- Require explicit CLI/MCP workspace selection. Keep lint/parity/quality aliases and provide structured `alfred-call`; raw Python requires explicit trusted-local opt-in.
- Validate AFD skill projections through the shared read-only profile checker while retaining native skill behavior for external projects.
- Require Botcore 0.6 for the opt-in host API. Preserve normal wheel dependencies and local AFD/Botcore development sources. Source import does not authorize publication.
