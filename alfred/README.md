# Alfred managed repository host

Alfred presents one explicit command catalog through CLI, MCP and AFD DirectClient.
The common Botcore commands use native project tools. AFD lint, parity and description
quality checks apply only to AFD's native packages and integrations. Future foundation
commands require their own explicitly admitted plugins and policies.

```sh
alfred --workspace /path/to/worktree catalog
alfred --workspace /path/to/worktree --target python --profile trusted-local call dev_lint '{}'
alfred --workspace /path/to/worktree quality
python -m alfred.mcp_server --workspace /path/to/worktree
```

```python
from alfred.host import build_alfred_host
host = build_alfred_host('/path/to/worktree', target='worktree')
client = host.direct_client()
result = await client.call('info-targets')
```

Select a package name from release inventory, an existing area path, or `worktree`.
The default AFD aliases keep AFD scope. Generic commands at an ambiguous monorepo
root require an explicit selection. For `dev_*` commands, `package` selects like
`target`, and `path` narrows to a directory inside the selected target; a path that
leaves the target is rejected. `skill_lint` takes `path` as a skill name inside the
configured skills directory. No route changes process cwd or falls back to
an unrelated parent repository. `info_targets` reads every current release unit,
including quarantined units, without importing or enabling their command plugins.

CommandResult execution success is separate from `metadata.quality.status`.
Use `alfred-check-plan` with a `checks` list of command/arguments objects. Each
check may declare a strict boolean `required` (default true) or complementary
`optional` flag. The entire plan is validated before any handler starts. Optional
results remain visible with an explicit exclusion reason and do not satisfy the
required plan. An entirely optional plan cannot pass.

A required check plan passes only when every required verdict passes; empty,
failed, unavailable, skipped and errored checks never become a passing plan.
Inspection rejects subprocesses and declared writers before invocation. Trusted
local code, project configuration and subprocesses are not adversarially confined.

## AFD skill profile validation

At a selected AFD worktree root with `skills/exports.json`, skill list/status/lint
use the repository's read-only `scripts/skill-profiles.mjs --check --json` checker.
Legacy skill names are intentional projections, so status reports projection
freshness and local ownership instead of treating those names as missing or
renamed canonical skills. Lint combines this evidence with the native Botcore
skill content rules. These routes declare subprocess effects and require the
trusted-local profile. Ordinary external projects retain Botcore's native skill
behavior and can inspect skills without this subprocess adapter.

## npm release controller binding

`build_alfred_host(..., npm_controller=controller)` binds a reviewed controller:
`controller(root: Path, operation: str, unit: str, arguments: dict) -> CommandResult`
may be synchronous or async. Root is always the original selected worktree;
unit must be admitted and own the `npm-changesets` protocol in root inventory.
Status may use subprocess/network access, so it requires trusted-local.

- `create`: arguments `packages: {name: patch|minor|major}`, `summary: str`.
- `status`: no extra arguments.
- `delete`: argument `fragment: str`.
- `consume`: no extra arguments; the binder must run the approved root version
  controller, preserving package-manifest, changelog and fragment operations.

The controller must validate exact unit/protocol ownership and arguments before
mutation. Use approved `fragmentOperation` for create/status/delete, with Node
ESM and structured JSON input; use root `scripts/release-control.mjs version`
for consume. No generic category consumer or unbound fallback is exposed.
Verified AFD roots bind this controller automatically. Other projects receive an
actionable unsupported-controller result. Custom hosts may supply an explicit
reviewed controller. Named deletion rejects a unit with multiple pending fragments
so a request for one fragment cannot silently remove the rest.

## Compatibility and packaging

The `lint`, `parity` and `quality` CLI names and `--path` options remain aliases
for managed AFD commands. They now require an explicit global `--workspace`;
existing invocations should add that option. Managed MCP uses `alfred-call`;
clients migrate from arbitrary `alfred-run` code to structured command calls.
The new canonical IDs are `info-targets` and `alfred-check-plan`; their underscore
spellings remain dispatch aliases for compatibility, and a plugin command using
either spelling fails host construction.
Raw Python is available only by explicit `--raw-python --profile trusted-local`.
The legacy Alfred Botcore plugin remains a trusted compatibility interface and
is deliberately ineligible for a restricted managed host.

This additive host API requires Botcore >=0.6.0. The AFD uv source override
`afd = { path = "../python", editable = true }` is retained, alongside the local
Botcore source at `../endpoints/botcore`; wheel metadata has
normal registry dependency requirements and no local source paths. Alfred 0.2 records the explicit-workspace CLI compatibility transition. Source import
alone conveys no publication authority.
