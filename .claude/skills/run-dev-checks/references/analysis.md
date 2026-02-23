# Static Analysis Commands Reference

## dev_dead_code()

```python
async def dev_dead_code() -> CommandResult[dict]
```

Uses **vulture** to find unused functions, variables, and imports.

**Behavior:**
- Runs vulture on the workspace source directory
- Configurable confidence threshold (higher = fewer false positives)
- Reports unused code with file paths, line numbers, and confidence scores

**Parameters:**
- Uses default vulture confidence threshold (can be configured)

**Return data:**
- `items` — List of unused code findings, each with:
  - `file` — File path
  - `line` — Line number
  - `message` — Description (e.g., "unused function 'old_helper'")
  - `confidence` — Vulture confidence percentage
- `count` — Total findings

**Requires:** `vulture` package (`pip install vulture`)

## dev_circular_imports()

```python
async def dev_circular_imports() -> CommandResult[dict]
```

Detects circular import dependencies using AST parsing and depth-first search cycle detection.

**Behavior:**
1. Parses all Python files with `ast` module
2. Extracts `import` and `from ... import` statements
3. Builds a directed graph of module dependencies
4. Runs DFS to find cycles
5. Reports each cycle as an ordered list of modules

**Return data:**
- `cycles` — List of cycles, each a list of module names forming the cycle
- `count` — Number of cycles found
- `modules_scanned` — Total modules analyzed

**Config integration:**
- `circular_deps_allowed` (default: 0) — Number of cycles allowed before failing
- Per-package overridable

**No external dependencies** — uses only Python's `ast` module.

## dev_unused_deps()

```python
async def dev_unused_deps() -> CommandResult[dict]
```

Finds declared dependencies in `pyproject.toml` that are not actually imported in source code.

**Behavior:**
1. Reads `[project.dependencies]` from `pyproject.toml`
2. Scans all Python files for import statements
3. Filters out standard library modules
4. Reports dependencies that appear in pyproject.toml but have no corresponding import

**Return data:**
- `unused` — List of dependency names not found in imports
- `count` — Number of unused dependencies
- `total_deps` — Total declared dependencies
- `total_imports` — Total unique imports found

**Caveats:**
- May flag dependencies used only at runtime (e.g., pytest plugins)
- Does not detect dynamic imports (`importlib.import_module()`)
- Normalizes package names (hyphens → underscores) for matching

## dev_dep_graph()

```python
async def dev_dep_graph() -> CommandResult[dict]
```

Generates a dependency graph of Python modules within the workspace.

**Behavior:**
1. Parses all Python files with `ast` module
2. Extracts import relationships
3. Outputs as JSON or Graphviz DOT format

**Output formats:**
- **JSON** — Module nodes and edges as structured data
- **DOT** — Graphviz DOT format for visualization (`dot -Tpng graph.dot -o graph.png`)

**Return data:**
- `format` — "json" or "dot"
- `modules` — List of module names (JSON mode)
- `edges` — List of `[source, target]` pairs (JSON mode)
- `dot` — DOT format string (DOT mode)

## Using Analysis Results

### Dead Code Cleanup

```
1. Run dev_dead_code()
2. Review findings at confidence > 80%
3. Verify each finding manually (check for dynamic usage)
4. Remove confirmed dead code
5. Re-run dev_test() to confirm no regressions
```

### Breaking Circular Imports

```
1. Run dev_circular_imports()
2. For each cycle, identify the lowest-level module
3. Extract shared types/interfaces into a separate module
4. Update imports to reference the shared module
5. Re-run to confirm cycle is broken
```

### Removing Unused Dependencies

```
1. Run dev_unused_deps()
2. Cross-reference with runtime-only usage (pytest plugins, type stubs)
3. Remove genuinely unused deps from pyproject.toml
4. Run dev_test() to confirm nothing breaks
```
