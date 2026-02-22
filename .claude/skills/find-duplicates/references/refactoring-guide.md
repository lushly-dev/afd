# Refactoring Guide for Duplicate Consolidation

Detailed workflows and templates for safely eliminating code duplication.

## Red-Green-Refactor Workflow

### 1. Red -- Write Tests First

Create tests that cover BOTH (or all) duplicate implementations. These tests
become the safety net for refactoring.

```python
# Create tests that cover BOTH duplicate implementations
def test_format_date_legacy():
    """Test existing formatDate in utils/date.ts"""
    assert format_date_legacy("2026-01-11") == "Jan 11, 2026"

def test_format_date_new():
    """Test duplicate in components/calendar.ts"""
    assert format_date_new("2026-01-11") == "Jan 11, 2026"
```

### 2. Green -- Verify Tests Pass

Run the tests against the current (duplicated) implementations. Every test must
pass before any refactoring begins. If tests fail at this stage, fix the tests
-- not the production code.

### 3. Refactor -- Create Unified Utility

```python
def format_date(date_str: str) -> str:
    """Unified date formatter. Replaces duplicates in:
    - utils/date.ts
    - components/calendar.ts
    """
    ...
```

### 4. Update Call Sites

Replace all duplicate usages with the new shared utility. Search the entire
codebase for imports and direct usages of the old implementations.

### 5. Verify -- Tests Still Pass

The same tests from step 1 must pass against the unified implementation. If any
fail, the refactoring introduced a behavioral change that needs investigation.

## Output Format Template

When reporting duplicate analysis results, use this format:

```markdown
# Duplicate Analysis: [Project Name]

## High-Value Refactoring (3+ occurrences)
1. `functionName` (N occurrences, X% similar)
   - `src/path/file1.ts:12-28`
   - `src/path/file2.ts:45-61`
   - `src/path/file3.ts:89-105`
   -> Suggestion: Extract to `shared/module-name.ts`

## Moderate Duplication (2 occurrences)
1. `functionName` (2 occurrences, X% similar)
   - `src/path/file1.ts:34-42`
   - `src/path/file2.ts:67-75`
   -> Suggestion: Consider extraction if reused again

## Potential Shared Utilities
- Pattern description appears in N+ files
- Another pattern that could be standardized

## Summary
Found N duplicate patterns totaling ~M lines. Extracting high-value
duplicates could reduce codebase by ~L lines (X% reduction).
```

## Cross-Repo Detection

### Current: Single-Repo Focus

Standard JSCPD and AI analysis operate within a single repository. This is the
default and recommended starting point.

### Future: Multi-Repo Analysis

For multi-repo ecosystems, cross-repo detection requires:

1. Mounting multiple repositories into a unified index
2. Running JSCPD or vector search across the combined codebase
3. Reporting duplicates with repo-qualified paths

```python
# Example: Mount multiple repos for unified indexing
mcp_server.mount("/repo-a", path="/path/to/repo-a")
mcp_server.mount("/repo-b", path="/path/to/repo-b")

# Cross-repo search
results = search_utilities("format currency", repos=["repo-a", "repo-b"])
```

Cross-repo duplication typically indicates a need for a shared package or library
rather than simple extraction into a utility file.

## MCP Discovery Layer (Prevention)

The best duplication is the one that never happens. When MCP-based discovery is
available, agents should search for existing utilities before implementing new ones:

```python
@mcp.tool()
def search_utilities(query: str, language: str = "python") -> str:
    """
    Find existing utilities before creating new ones.
    Use this BEFORE implementing common functionality.
    """
    results = vector_db.query(query, lang=language)
    return format_results(results)
```

**Agent instruction:** Before creating utility functions, call `search_utilities`
to check if similar functionality exists. Reuse existing code when found.
