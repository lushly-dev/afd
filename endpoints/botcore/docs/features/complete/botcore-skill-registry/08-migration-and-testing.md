# Migration & Testing Strategy

> Part of [Bot Core + Skill Registry Plan](./00-overview.md)

---

## Migration Order

1. **lushbot first** — primary consumer, most code extracted from here. Convert to
   thin plugin. Validate for 2+ weeks with real agent workflows.
2. **fabux second** — near-identical codebase. After lushbot proves stable, swap fabux's
   bundled commands for botcore imports. Lower risk since the code is byte-for-byte
   identical in many modules.
3. **proto third** — most different (sync → async, raw dicts → CommandResult, Biome
   instead of ruff). This is the real test of the plugin system across language
   ecosystems.

---

## Version Pinning

Each consumer pins botcore to a specific version:
```toml
[project.dependencies]
botcore = ">=1.0.0,<2.0.0"   # semver range, not exact pin
```

Breaking changes require a major version bump. Non-breaking additions are minor bumps.

---

## Rollback

During migration, the original command code stays in each bot until botcore is validated:
- lushbot keeps its `commands/` directory on a branch. Reverting is a branch swap.
- The plugin system's entry-point loading means uninstalling botcore and re-adding
  local commands is a pyproject.toml change, not a code rewrite.

---

## Breaking Change Policy

- Plugin contract changes are major version bumps
- New commands or capabilities are minor bumps
- Config schema additions are minor bumps (new fields have defaults)
- Config schema removals or renames are major bumps

---

## Testing Strategy

### Unit Tests

- **Config loading/validation** — valid TOML parses, typos trigger `extra="forbid"` errors,
  per-package overrides resolve correctly, env var fallback works
- **Command execution** — each extracted command returns CommandResult, handles missing
  tools gracefully, respects config thresholds
- **Plugin discovery** — entry points load, `register()` is called, commands appear in
  registry, config sections validate against plugin schemas
- **Skill seeding** — `source:` frontmatter respected, managed skills update, unmanaged
  skills skipped, skip-list honored

### Integration Tests

- **Module discovery** — installed modules register capabilities, capability dispatch
  resolves correctly, missing capabilities produce clear errors
- **MCP server** — `{name}-start`, `{name}-docs`, `{name}-run` tools respond correctly,
  run pattern validates code against allowlist
- **CLI** — `botcore dev lint` dispatches to correct tool, `botcore skill seed` writes
  files to correct location

### Canary CI

A CI job that runs botcore's test suite against each consumer repo:
```yaml
strategy:
  matrix:
    repo: [lushbot, fabux, proto]
steps:
  - uses: actions/checkout@v4
    with:
      repository: lushly-dev/${{ matrix.repo }}
  - run: pip install -e ../botcore
  - run: pytest  # consumer's own tests pass with botcore installed
```

This catches breakage before release — if lushbot's tests fail with a botcore change,
the PR is blocked.
