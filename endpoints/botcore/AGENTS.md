# Botcore development

This endpoint was imported from public Botcore main. Read `provenance/provenance.json`
and `docs/host-composition.md` for authority, compatibility and managed-host boundaries.
`lushly-botcore` publishes to PyPI from AFD: the root inventory admits the `botcore` unit on
`pypi-botcore`, and `.github/workflows/publish-botcore.yml` runs on a `botcore-vX.Y.Z` tag that
only the owner pushes (see `docs/features/complete/platform-monorepo/botcore-handoff.md`). The
other five distributions remain quarantined; source import authorizes no publishing.

Use the repository Python AFD source through `[tool.uv.sources]`. Distribution
metadata retains `afd>=0.9.0`. Run
`uv sync --frozen --extra dev --extra mcp --extra cdp --group packages`,
`uv run --frozen ruff check src/ tests/ scripts/ packages/ botcore-connectors/src/ botcore-connectors/tests/ plugins/botcore-teams/`,
`uv run --frozen pytest tests/ --ignore=tests/integration -q` and
`uv run --frozen python scripts/package_tests.py` (the sibling packages' tests) on Python 3.11
and 3.12.
The Botcore workflow runs these core gates plus all six wheel/sdist and asset smoke checks.
`ruff format` is compared against base only: format the files a change touches and leave the
rest, whose drift is known (lushly-dev/afd#513).
Optional integration scenarios require separately installed plugins and are outside this core gate;
do not report them as passed. Native tool wrappers impose no AFD architecture rules on target apps.

Managed hosts must explicitly admit plugin effects and per-host state safety.
Optional stateful plugins remain preserved, not admitted without adapters. Legacy MCP/raw
Python and global clients are trusted local compatibility interfaces, not restricted hosts.
Never change process cwd or share mutable context/configuration between managed worktrees.

Only edit owned files. Keep root release inventory, canonical skills and shared policy with
their owning change. Do not commit caches, venvs, history/session state, or publisher credentials.
