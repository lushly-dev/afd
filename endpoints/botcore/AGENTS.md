# Botcore development

This endpoint was imported from public Botcore main. Read `provenance/provenance.json`
and `docs/host-composition.md` for authority, compatibility and managed-host boundaries.
All six distributions remain quarantined; source import authorizes no publishing.

Use the repository Python AFD source through `[tool.uv.sources]`. Distribution
metadata retains `afd>=0.9.0`. Run `uv sync --frozen --extra dev --extra mcp --extra cdp`,
`uv run --frozen ruff check src/ tests/`, and
`uv run --frozen pytest tests/ --ignore=tests/integration -q` on Python 3.11 and 3.12.
The Botcore workflow runs these core gates plus all six wheel/sdist and asset smoke checks.
Optional integration scenarios require separately installed plugins and are outside this core gate;
do not report them as passed. Native tool wrappers impose no AFD architecture rules on target apps.

Managed hosts must explicitly admit plugin effects and per-host state safety.
Optional stateful plugins remain preserved, not admitted without adapters. Legacy MCP/raw
Python and global clients are trusted local compatibility interfaces, not restricted hosts.
Never change process cwd or share mutable context/configuration between managed worktrees.

Only edit owned files. Keep root release inventory, canonical skills and shared policy with
their owning change. Do not commit caches, venvs, history/session state, or publisher credentials.
