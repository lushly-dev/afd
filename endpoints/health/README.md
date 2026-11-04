# Health

Explicit, local repository health audits with a versioned JSON report. Health is an
endpoint: the repository it audits needs no AFD, Botcore or Health dependency, and
the headless audit core uses only the Python standard library.

> **Status:** quarantined import. The distribution identity `lushly-health` 0.1.0 and
> the import package `lushly_health` are tentative. Nothing here is published, and
> `scripts/release/inventory.json` holds the `health` unit in quarantine.

## What it does

- **Explicit targets.** Every audit names its targets (id, directory, language). Health
  never reads an inventory, walks sibling directories or guesses a language. A caller
  may keep its own targets file outside this package.
- **Configuration-driven policy.** A policy selects check ids, disables some, sets each
  one's severity (`required` or `advisory`) and declares the remediation policy. There
  is no implied organization baseline.
- **Versioned results.** Each outcome carries `schema_version`, a stable `check_id`,
  `target`, `status`, `severity`, `message`, `evidence` and `remediation`. Statuses
  are `passed`, `failed`, `warn`, `skipped` (did not apply to the target), `disabled`
  (turned off by the policy), `unavailable` and `error`, each with its own summary
  count. The report also records `generated_at` (UTC, whole seconds) and Health's
  `verdict`. The contract is the JSON Schema
  [`src/lushly_health/schemas/report-1.2.json`](src/lushly_health/schemas/report-1.2.json),
  also available as `lushly_health.report_schema()` and `python -m lushly_health schema`.
  The earlier [`report-1.0.json`](src/lushly_health/schemas/report-1.0.json) stays
  available as `report_schema("1.0")`.
- **One verdict.** `verdict.status` is `passed` only when the report has at least one
  counted required check and every counted required check passed. Required checks
  disabled by the policy are not counted; any other non-passing required status,
  including `skipped`, prevents a pass, and advisory results never affect it. With no
  counted required checks the verdict is `no_required_checks`, never a pass.
  `aggregate_verdict()` applies the same rule to any list of outcomes.
- **Read-only audit.** `audit()` reads the selected targets and returns data. It writes
  nothing, opens no browser, makes no network request, installs nothing and runs no
  project script. The optional `last_commit` check runs a bounded
  `git --no-optional-locks log` (5 seconds); every other check reads files.
- **Explicit output scope.** `write_report()` exclusively creates one JSON file in a
  caller-given directory outside every audited target, and never overwrites.
- **No remediation.** None is implemented. Policies may only declare
  `remediation = "none"`; checks return remediation guidance as text.

## Use

```sh
python -m lushly_health capabilities
python -m lushly_health audit \
  --target sample ./sample-project typescript \
  --check node_version_alignment --check gitattributes_lf \
  --output-dir ./health-reports
python -m lushly_health audit --targets my-targets.toml --policy my-policy.toml --require-pass
```

`--require-pass` makes the exit code 1 unless the verdict is `passed`. `--fail-on`
makes it 1 when a `required` check has one of the listed statuses. Otherwise a
completed audit exits 0. Invalid selections exit 2.

Policy and targets files are TOML or JSON with `schema_version = "1.0"` (configuration
has its own version, separate from the report's); relative
target paths resolve against the file's own directory. See
[`config.py`](src/lushly_health/config.py) for the format.

```python
from pathlib import Path
from lushly_health import ArtifactScope, Policy, Target, audit, write_report

report = audit(
    (Target("sample", Path("sample-project"), "typescript"),),
    Policy(
        ("node_version_alignment", "gitattributes_lf"), severity={"gitattributes_lf": "advisory"}
    ),
)
print(report["verdict"]["status"])
write_report(report, ArtifactScope(Path("health-reports")))
```

`audit(..., generated_at=datetime)` pins the timestamp for reproducible output. Reports
contain each target's absolute path. Treat them as caller-local data when sharing.

## Checks

All checks are opt-in heuristics over declared configuration. They do not prove that
rules run, coverage is met, CI succeeds or a repository is secure.

| Check id | Reads |
| --- | --- |
| `node_version_alignment` | `.nvmrc`, `.node-version`, `package.json` engines, workflow `node-version` including lists, matrix references and `fromJSON` over literal lists (TypeScript); other ranges or expressions produce `warn` |
| `codex_skills_mirror` | `.codex/skills` is a live mirror of `.claude/skills` |
| `lefthook_configured` | `lefthook.yml` declares pre-commit and pre-push |
| `linter_strict` | Biome rules (TypeScript) or `[tool.ruff]` (Python) |
| `ci_present` | A workflow mentioning test and build that runs on pull requests or branch pushes; one only run by tags, releases, schedules or by hand doesn't count |
| `dependabot_configured` | `.github/dependabot.yml` |
| `commitlint_configured` | A commitlint config (TypeScript) |
| `coverage_thresholds` | Vitest thresholds or Botcore `coverage_threshold` |
| `dead_code_tool` | knip (TypeScript) or vulture (Python) declared |
| `gitattributes_lf` | `eol=lf` in `.gitattributes` |
| `changesets_configured` | `.changeset/` and its tooling |
| `last_commit` | Latest commit timestamp; requires `git` |
| `dependency_version_drift` | `pnpm-lock.yaml`, `uv.lock` and `Cargo.lock` files, compared within each ecosystem; advisory by default. `warn` when a direct dependency resolves to several versions; other splits are only counted (`evidence.metric`). A lockfile format it can't read, such as pnpm's older versions, gives `warn`. Skips `node_modules`, `target`, `dist`, `build`, `venv` and hidden directories |

### Units inside a larger repository

A target can name the repository that contains it with `repository_root` (in a targets
file) or `--repository-root` (on the command line). Checks about the repository then read
that root: `node_version_alignment`, `codex_skills_mirror`, `lefthook_configured`,
`ci_present`, `dependabot_configured`, `commitlint_configured`, `gitattributes_lf`,
`changesets_configured`, `last_commit` and `dependency_version_drift`. `linter_strict` and
`dead_code_tool` read it for TypeScript, whose Biome and knip configuration sits at the
root, and the target for Python, where each unit has its own `pyproject.toml`.
`coverage_thresholds` always reads the target. Such an outcome has `evidence.base = "repository_root"`, the report's target row records the root,
and the root also counts as audited, so reports can't be written inside it. A target
without a root is treated as its own repository, as before.

A check whose declared inputs (its `evidence.paths`) resolve outside the target, or
outside its repository root for a repository check, through a link is `unavailable`; unrelated links, such as a local virtual
environment's interpreter, do not affect it. `last_commit` requires the target to be
the checkout root, so it never reports an enclosing repository, and it ignores
inherited `GIT_*` variables. A check exception becomes `error` with only the exception
type recorded. Filesystem races are outside the single-process contract: audit
trusted local checkouts or snapshots.

## Botcore and Alfred

Install the `botcore` extra for the AFD/Botcore command adapter
(`health_audit`, `health_capabilities`), registered as the `health` entry point in
`botcore.plugins`. Hosts admit it explicitly with its declared effects:

```python
from botcore import ExecutionContext, build_host
from lushly_health.commands import host_policies

host = build_host(
    "tools", ExecutionContext(workspace), plugins=("health",), policies=host_policies()
)
```

`alfred.host.build_alfred_host(..., plugins=("health",), policies=host_policies())`
admits it the same way; Alfred's default catalog does not include Health. Inside a
host, target paths must lie within the host's selected target, and `last_commit`
requires a `trusted-local` profile because it runs a subprocess.

## Provenance

Health's source repository is private. Only reviewed, generic implementation was
extracted, under MIT, by the owner's authorization; see
[`provenance/provenance.json`](provenance/provenance.json). Private inventories,
reports, baselines, history, access configuration, the HTML dashboard and the source
Git history were not imported. The local FAST-AF dashboard for these reports is a
separate endpoint, [`endpoints/health-dashboard`](../health-dashboard/README.md).

## Development

```sh
uv sync --frozen --extra dev
uv run --frozen ruff check src tests scripts
uv run --frozen pytest -q
uv run --frozen python scripts/package_smoke.py
```
