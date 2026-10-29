# SQLite Memory Backend

> Proposed — upgrades memory storage from JSON files to SQLite with full-text search.

## Summary

Replace the JSON file memory backend with SQLite + FTS5 for production-grade search, while keeping the same memory command interface and access control model. The scoped access model (agent/team/task with contextvar isolation) stays exactly the same — only the storage engine changes.

## Why This Matters

- JSON file store works for coordination but doesn't scale to knowledge retrieval
- Substring matching in `memory_search` can't handle semantic or fuzzy queries
- SQLite FTS5 provides ranked full-text search with BM25 scoring
- Future: vector embeddings via sqlite-vec for semantic search

## Key Design Decisions

- Implement `SqliteMemoryStore` conforming to existing store interface (set/get/search/delete/list)
- FTS5 virtual table for full-text indexing of key + value fields
- Tag filtering via JSON column with containment check
- Access control unchanged — same contextvar-based scope enforcement
- Config switch: `[memory] backend = "sqlite"` (default remains "json" for backwards compatibility)

## Prerequisite Specs

None — the memory store interface is already clean. This is a drop-in backend swap.

## Scope

- SQLite backend implementing existing store interface
- FTS5 for text search (replaces substring matching)
- Migration tool: `memory_migrate --from json --to sqlite`
- Optional: sqlite-vec integration for vector embeddings (future extension)

## Estimated Effort

Medium — SQLite schema + FTS5 setup + store interface implementation + migration tooling.
