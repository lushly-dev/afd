# Multi-Language Project Support

> Enable botcore to natively support projects with multiple languages (TypeScript, Python, Rust) instead of forcing a single `language` value.

---
status: implemented
created: 2026-02-21
revised: 2026-02-21
author: agent
effort: L (5-8 days)
---

## Problem

Botcore's config model assumes a single primary language per workspace:

```toml
language = "typescript"
linter = "biome"
test_runner = "vitest"
```

Projects like AFD contain TypeScript, Python, and Rust code in parallel subdirectories. Today, `dev_lint` dispatches to biome regardless of what you're linting, `dev_check_size` only scans `.py` files, and `dev_check_deps` only checks PyPI. There's no way to say "this workspace has three languages" and have botcore do the right thing.

## Current State

| Command | Python support | TS support | Rust support | Notes |
|---------|---------------|------------|-------------|-------|
| `dev_lint` | ruff (if configured) | biome (if configured) | clippy (if configured) | Single-language dispatch via `config.linter` |
| `dev_test` | pytest (if configured) | vitest (if configured) | cargo test (if configured) | Single-language dispatch via `config.test_runner` |
| `dev_build` | hatch | turbo | cargo build | Single-language dispatch via `config.language` |
| `dev_check_size` | `*.py` only | -- | -- | Hardcoded `rglob("*.py")` |
| `dev_check_coverage` | pytest --cov | -- | -- | Python-only, reads `coverage.json` |
| `dev_check_deps` | pyproject.toml + PyPI (httpx) | -- | -- | Reads `pyproject.toml`/`requirements.txt`, queries PyPI |
| `dev_dead_code` | vulture | -- | -- | Python-only subprocess |
| `dev_circular_imports` | ast.parse on `*.py` | -- | -- | Python-only AST walk |
| `dev_unused_deps` | pyproject.toml + AST scan | -- | -- | Compares declared deps against `*.py` imports |
| `dev_dep_graph` | ast.parse on `*.py` | -- | -- | Python-only module graph |
| `dev_check_paths` | all text files | all text files | all text files | Language-independent |
| `dev_skill_lint` | skill files | skill files | skill files | Language-independent |

Only `dev_lint`, `dev_test`, and `dev_build` support language dispatch at all — but they pick one language from config and stick with it. The remaining quality/analysis commands are hardcoded to Python.

## Proposed Solution

### 1. Config model: `language_config` dict

Replace the three overlapping fields (`languages`, `languages_map`, `language_config`) originally considered with a single source of truth:

```python
class LanguageConfig(BaseModel):
    """Per-language tooling configuration."""
    root: str | None = None        # Subdirectory for this language
    linter: str | None = None
    test_runner: str | None = None
    formatter: str | None = None

class BotCoreConfig(BaseModel):
    # Existing (backward compat)
    language: str | None = None     # Primary/default language
    linter: str | None = None
    test_runner: str | None = None
    formatter: str | None = None

    # New
    language_config: dict[str, LanguageConfig] = {}

    @property
    def languages(self) -> list[str]:
        """Derive active languages from language_config keys."""
        if self.language_config:
            return list(self.language_config.keys())
        return [self.language] if self.language else []

    def get_tools_for(self, lang: str) -> dict[str, str | None]:
        """Merge _TOOL_DEFAULTS with language_config overrides."""
        defaults = _TOOL_DEFAULTS.get(lang, {})
        overrides = {}
        if lang in self.language_config:
            lc = self.language_config[lang]
            overrides = lc.model_dump(exclude_none=True, exclude={"root"})
        return {**defaults, **overrides}
```

**Backward compatible:** The existing single `language` field continues to work. When `language_config` is empty, behavior is identical to today. When `language_config` has entries, the `languages` property derives from its keys.

Add `language` override to `PackageOverrideConfig`:

```python
class PackageOverrideConfig(BaseModel):
    language: str | None = None  # Override detected language for this package
    # ... existing fields ...
```

**Config validation rules:**
- Auto-populate tools from `_TOOL_DEFAULTS` when a language entry exists but tools are not explicitly set
- Warn if `language` (primary) is set but not present in `language_config` keys
- Warn on overlapping `root` prefixes (e.g., `"packages/"` and `"packages/rust/"` — longest prefix wins but the overlap is suspicious)

TOML representation:

```toml
language = "typescript"   # primary/default

[language_config.typescript]
# tools auto-populated from _TOOL_DEFAULTS (biome, vitest, biome)

[language_config.python]
root = "python/"
# tools auto-populated (ruff, pytest, ruff)

[language_config.rust]
root = "packages/rust/"
# tools auto-populated (clippy, cargo-test, rustfmt)
```

### 2. Language resolution priority

When a command needs to determine which language to use, apply this 5-step priority chain:

1. **Explicit `--language` flag** — user override, highest priority
2. **`language_config[lang].root` prefix matching** — longest prefix wins (e.g., `python/src/foo.py` matches `root = "python/"`)
3. **`PackageOverrideConfig.language`** — per-package override for the detected package
4. **Marker-based walk-up** — existing `detect_language()` logic in `workspace.py`, but applied path-relative (walk up from the target path, not just workspace root)
5. **`config.language` fallback** — the primary language field

```python
def resolve_language(
    path: Path | None,
    config: BotCoreConfig,
    workspace: Path,
    language_override: str | None = None,
) -> str | None:
    """Resolve language for a given path using the priority chain."""
    # 1. Explicit override
    if language_override:
        return language_override

    if path:
        rel = path.relative_to(workspace)

        # 2. Root prefix matching (longest prefix wins)
        best_match: str | None = None
        best_len = 0
        for lang, lc in config.language_config.items():
            if lc.root and str(rel).startswith(lc.root):
                if len(lc.root) > best_len:
                    best_match = lang
                    best_len = len(lc.root)
        if best_match:
            return best_match

        # 3. Per-package override
        pkg_name = detect_package(path, workspace)
        if pkg_name and pkg_name in config.packages:
            pkg_lang = config.packages[pkg_name].language
            if pkg_lang:
                return pkg_lang

        # 4. Marker-based walk-up (path-relative)
        detected = detect_language(path)
        if detected:
            return detected

    # 5. Primary language fallback
    return config.language
```

This avoids the monorepo problem where a root `pyproject.toml` shadows TypeScript subdirectories — step 2 (root prefix matching) resolves the correct language before the walk-up reaches the root.

### 3. Language-aware dispatch with `--language` override

```python
# Before: single dispatch
async def dev_lint(package: str | None = None, fix: bool = False):
    config = load_config(workspace=ws)
    linter = config.linter  # One linter for all

# After: multi-language dispatch
async def dev_lint(
    package: str | None = None,
    fix: bool = False,
    language: str | None = None,  # NEW: explicit override
    path: str | None = None,      # NEW: auto-detect from path
):
    config = load_config(workspace=ws)
    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    )
    tools = config.get_tools_for(lang)
    linter = tools.get("linter")
```

### 4. Multi-language quality scanning

Extend file-scanning commands to handle all configured languages:

```python
# dev_check_size: scan by extension
EXTENSIONS = {
    "python": [".py"],
    "typescript": [".ts", ".tsx", ".js", ".jsx"],
    "rust": [".rs"],
}

# dev_check_deps: check per ecosystem
async def dev_check_deps(language: str | None = None, staged_only: bool = True):
    langs = [language] if language else config.languages
    for lang in langs:
        if lang == "python":
            await _check_pypi_deps(...)
        elif lang == "typescript":
            await _check_npm_deps(...)
        elif lang == "rust":
            await _check_cargo_deps(...)
```

### 5. External tool availability strategy

Phase 3 introduces external tools (knip, madge, depcheck, cargo-udeps, cargo-outdated) that may not be installed on the user's machine.

**Strategy:** Skip with warning, suggest install command. Never abort a multi-language run because one tool is missing.

```python
async def _run_external_tool(
    tool: str, args: list[str], install_hint: str, cwd: Path,
) -> dict | None:
    """Run an external tool, returning None with a warning if not installed."""
    import shutil
    if not shutil.which(tool):
        warnings.warn(
            f"{tool} not found. Install with: {install_hint}",
            UserWarning, stacklevel=2,
        )
        return None
    return await run_command([tool, *args], cwd=cwd)
```

| Tool | Language | Command | Install |
|------|----------|---------|---------|
| ruff | Python | `ruff check .` | `pip install ruff` |
| vulture | Python | `vulture <path>` | `pip install vulture` |
| biome | TypeScript | `npx biome check .` | `npm i -D @biomejs/biome` |
| knip | TypeScript | `npx knip` | `npm i -D knip` |
| madge | TypeScript | `npx madge --circular .` | `npm i -D madge` |
| depcheck | TypeScript | `npx depcheck` | `npm i -D depcheck` |
| clippy | Rust | `cargo clippy` | `rustup component add clippy` |
| cargo-udeps | Rust | `cargo +nightly udeps` | `cargo install cargo-udeps` |
| cargo-outdated | Rust | `cargo outdated -R` | `cargo install cargo-outdated` |

## Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Parallel vs sequential? | **Sequential** with per-language headers (`=== [python] ruff ===`) | Parallel interleaves output, making errors unattributable |
| Failure semantics? | **Run all, aggregate, fail-if-any-fail** | "Fail on first" loses information about other languages |
| Per-package language? | **Yes**, add `language` to `PackageOverrideConfig` | Simple override for packages outside their language's root |

## Example: AFD After This Feature

```toml
# AFD/botcore.toml
language = "typescript"

[language_config.typescript]
# tools auto-populated from _TOOL_DEFAULTS

[language_config.python]
root = "python/"

[language_config.rust]
root = "packages/rust/"

[skills]
skip = ["afd", "afd-contracts", "afd-developer", "afd-directclient", "afd-python", "afd-rust", "afd-typescript"]
```

Then commands just work:

```bash
# Lint everything — runs biome, ruff, clippy sequentially with headers
botcore dev lint

# Lint just Python
botcore dev lint --language python

# Auto-detect from path
botcore dev lint --path python/src/

# Check deps across all ecosystems (default when language_config has multiple entries)
botcore dev check-deps

# File size check across all languages
botcore dev check-size
```

## Implementation Plan

### Phase 1: Config model (no behavior change)
- [ ] Add `LanguageConfig` model with `root`, `linter`, `test_runner`, `formatter`
- [ ] Add `language_config: dict[str, LanguageConfig]` to `BotCoreConfig`
- [ ] Add `languages` property that derives from `language_config.keys()`
- [ ] Add `get_tools_for(lang)` method that merges `_TOOL_DEFAULTS` with overrides
- [ ] Add `language: str | None` to `PackageOverrideConfig`
- [ ] Config validation: auto-populate tools from `_TOOL_DEFAULTS`
- [ ] Config validation: warn if `language` not in `language_config` keys
- [ ] Config validation: warn on overlapping `root` prefixes
- [ ] Update `_apply_language_defaults()` to populate per-language configs

### Phase 2: Language resolution
- [ ] Add `resolve_language()` with full 5-step priority chain to `workspace.py`
- [ ] Add `language` and `path` params to `dev_lint`, `dev_test`, `dev_build`
- [ ] Dispatch uses `resolve_language()` + `get_tools_for()` instead of global default

### Phase 3: Multi-language quality commands
- [ ] `dev_check_size`: scan `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs` by language
- [ ] `dev_check_coverage`: add vitest coverage (TS), cargo-tarpaulin (Rust) alongside pytest --cov
- [ ] `dev_check_deps`: add npm (`npm outdated --json`) and cargo (`cargo outdated -R --format json`)
- [ ] `dev_dead_code`: add knip (TS), cargo-udeps (Rust) alongside vulture
- [ ] `dev_circular_imports`: add madge (TS) alongside Python AST scanner
- [ ] `dev_unused_deps`: add depcheck (TS), cargo-udeps (Rust) alongside pyproject.toml scanner
- [ ] `dev_dep_graph`: add madge (TS), cargo-modules (Rust) alongside Python AST graph
- [ ] Add `_run_external_tool()` helper with skip-with-warning behavior

### Phase 4: Multi-language "run all" mode
- [ ] Sequential execution with per-language headers (`=== [python] ruff ===`)
- [ ] `dev lint` with no flags runs linters for all configured languages
- [ ] `dev test` with no flags runs test suites for all configured languages
- [ ] Aggregate results: per-language sections in `CommandResult`, fail-if-any-fail semantics
- [ ] All quality/analysis commands iterate `config.languages` when no `--language` given

## Success Criteria

- [ ] AFD can configure all three languages in `botcore.toml` using `language_config`
- [ ] `languages` property correctly derives from `language_config` keys
- [ ] `dev lint` with no args runs biome, ruff, and clippy sequentially with headers
- [ ] `dev test` with no args runs vitest, pytest, and cargo test
- [ ] `dev check-size` scans `.ts`, `.py`, and `.rs` files
- [ ] `dev check-coverage` supports pytest (Python), vitest (TS), cargo-tarpaulin (Rust)
- [ ] `dev check-deps` checks npm, PyPI, and crates.io
- [ ] `dev dep-graph` generates graphs for Python, TS, and Rust modules
- [ ] Missing external tools produce a warning with install hint, not an abort
- [ ] Config validation warns on `language` not in `language_config` keys
- [ ] Config validation warns on overlapping `root` prefixes
- [ ] Existing single-language configs continue to work unchanged
- [ ] `--language` flag overrides auto-detection on all dev commands
- [ ] Per-package `language` override works in `PackageOverrideConfig`
