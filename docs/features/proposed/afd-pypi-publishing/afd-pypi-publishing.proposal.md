# AFD Python Package - PyPI Publishing

> **Status:** PROPOSED  
> **Created:** 2026-01-13  
> **Author:** Agent + Jasfalk  

---

## Summary

Publish the existing AFD Python package (`AFD/python/`) to PyPI, enabling `pip install afd` for Python AFD projects like Noisett.

---

## Motivation

The AFD Python package already exists with full feature parity:
- `CommandResult`, `CommandError`, helper functions
- Full metadata types (`Source`, `PlanStep`, `Alternative`, `Warning`)
- `HandoffResult` for streaming operations
- Bootstrap tools (`afd-help`, `afd-docs`, `afd-schema`)
- FastMCP transport integration
- CLI (`afd` command)

**Blocked:** Noisett and future Python AFD projects cannot easily consume this without PyPI publishing.

---

## Package Details

| Field | Value |
|-------|-------|
| **Name** | `afd` (check availability) or `lushly-afd` |
| **Version** | `0.1.0` (already set in pyproject.toml) |
| **License** | MIT |
| **Python** | ≥3.10 |

### Optional Dependencies

```toml
[project.optional-dependencies]
server = ["fastmcp>=0.1.0"]
cli = ["click>=8.0", "rich>=13.0"]
testing = ["pytest>=8.0", "pytest-asyncio>=0.23"]
all = ["afd[server,cli,testing]"]
```

---

## Implementation Steps

### Phase 1: Pre-Flight

- [ ] Check `afd` name availability on PyPI
- [ ] Decide on package name (`afd` vs `lushly-afd` vs `afd-python`)
- [ ] Update author email in pyproject.toml
- [ ] Add py.typed marker for type hints
- [ ] Run tests: `pytest tests/ -v`
- [ ] Build: `python -m build`

### Phase 2: PyPI Setup

- [ ] Create PyPI account (if needed)
- [ ] Generate API token
- [ ] Configure `~/.pypirc` or use `twine` with env vars

### Phase 3: Publish

```bash
cd AFD/python
python -m build
twine upload dist/*
```

### Phase 4: Verify

```bash
pip install afd
python -c "from afd.core.result import success; print(success({'ok': True}))"
```

---

## Post-Publishing

1. Update Noisett to use `afd>=0.1.0` dependency
2. Update AFD README with pip install instructions
3. Add GitHub Actions workflow for automated releases

---

## Verification Plan

### Automated
```bash
# Build test
cd AFD/python
python -m build

# Install from wheel
pip install dist/afd-0.1.0-py3-none-any.whl

# Import test
python -c "from afd.core.result import CommandResult, success, error"
python -c "from afd.core.handoff import HandoffResult"
python -c "from afd.server.bootstrap import get_bootstrap_commands"
```

### Manual
- Install in fresh virtualenv
- Run Noisett tests with `afd` dependency
