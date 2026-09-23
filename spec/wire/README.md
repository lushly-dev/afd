# Golden wire fixtures

These JSON files are the canonical wire shapes of AFD results. The TypeScript server produced them
through real `tools/call`, `afd-batch` and `afd-pipe` requests (stream chunks come from the core
constructors that the stream route uses).

| File | Shape |
| --- | --- |
| `result-success-minimal.json` | `CommandResult` with only `success`, `data` and server metadata |
| `result-success-full.json` | `CommandResult` with every optional field set |
| `result-failure.json` | `CommandResult` failure with a full `CommandError` |
| `batch-result.json` | `BatchResult` with one success and one failure |
| `pipeline-result.json` | `PipelineResult` with an alias and a `$prev` reference |
| `stream-chunks.json` | One each of the progress, data, complete and error `StreamChunk` |

## Contract

- **Every language round-trips every file.** Parse it into the language's native result types, serialize those
  types back to JSON, and the result must equal the file (object key order aside). This is enforced by:
  - TypeScript: `packages/server/src/wire-fixtures.test.ts`, which also regenerates the files;
  - Python: `python/tests/test_wire_fixtures.py`;
  - Rust: `packages/rust/tests/wire_fixtures.rs`.
- Keys are camelCase.
- Optional fields that are not set are **omitted**, never `null`.
- Run-dependent values are normalized in the files: durations (`*Ms`) are `0`, timestamps (`*At`) are
  `2026-01-01T00:00:00.000Z`, and `traceId` is `trace-fixture`.

## Changing a shape

A change to any of these files is a wire-format change. Make it deliberately in all three
languages in the same pull request.

To regenerate the files after an intentional TypeScript change:

```bash
pnpm build
UPDATE_WIRE_FIXTURES=1 pnpm -F @lushly-dev/afd-server exec vitest run src/wire-fixtures.test.ts
```
