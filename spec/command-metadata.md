# Command metadata

The canonical fields of a command definition, their types and defaults, and where each one surfaces.
Every AFD implementation carries these fields. Which ones each language has today is tracked in the
[language parity matrix](../docs/language-parity.md#command-definition).

Names below are the wire (JSON) spelling. Code may use the language's own casing, such as
`confirm_prompt` in Python, Rust and C++, and C++ calls `requires` `prerequisites`. Anything
serialized uses the names below.

## Fields

| Field | Type | Default | Where it surfaces |
| --- | --- | --- | --- |
| `name` | string, `domain-action` kebab-case | Required | Every surface |
| `description` | string | Required | Every surface; afd-discover shortens it to its first sentence, at most 120 characters |
| `category` | string | None; grouping falls back to the name's first segment | `_meta`, afd-detail, afd-discover, afd-help (full), afd-docs headings, grouped tool names, `afd tools` groups |
| Input schema | JSON Schema object (TypeScript: Zod `input`, or core `parameters`) | Required | Tool `inputSchema`, afd-detail, afd-schema, afd-docs parameter table |
| Output schema (`returns`) | JSON Schema of `CommandResult.data` | None | `_meta.outputSchema`, afd-detail `outputSchema` |
| `errors` | string[] of error codes | None | afd-detail |
| `version` | string | None | afd-detail; results carry it as `metadata.commandVersion` |
| `tags` | string[] | None | afd-detail, afd-help (full), afd-docs; afd-discover filters on it |
| `requires` | string[] of command names | None | `_meta`, afd-help (brief and full). Metadata only: not enforced at runtime |
| `mutation` | boolean | `false` | `_meta`, afd-detail, afd-discover (`includeMutation`), afd-help (full), afd-docs |
| `destructive` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools`. `afd validate --execute` never calls it |
| `confirmPrompt` | string | None; a frontend MAY show a generic prompt | afd-detail, afd-docs |
| `undoable` | boolean | `false` | `_meta`, afd-detail, afd-help (full), afd-docs, `DirectRegistry.listCommands()`, `afd tools` |
| `executionTime` | `instant`, `fast`, `slow` or `long-running` | None | afd-detail |
| `handoff` | boolean | `false` | afd-detail; adds the `handoff` tag |
| `handoffProtocol` | `websocket`, `webrtc`, `sse`, `http-stream` or another string | None | afd-detail; adds the `handoff:<protocol>` tag |
| `expose` | `palette`, `agent`, `mcp`, `cli` booleans | `palette` and `agent` true, `mcp` and `cli` false, per flag | Not reported. It decides which surfaces list and run the command; afd-detail reports the result as `callable` |
| `examples` | `{ title, input }[]` | None | `_meta`, afd-help (full). Each `input` must pass the input schema when the command is defined |
| `contexts` | string[] | None: the command is visible in every context | `_meta`; tools/list and the context tools scope on it |

`destructive`, `confirmPrompt` and `undoable` are declarations for frontends and agents. AFD
carries them and does not act on them: an undo mechanism, and the confirmation UI, belong to the
consumer.

## Reporting rules

- **Unset is omitted.** A surface reports a field only when the command sets it, never as `null`.
  Consumers read an absent boolean as its default. An explicit `false` is reported as `false`.
- **Two exceptions:** afd-detail always reports `mutation`, and afd-discover reports it when
  `includeMutation` is set. Both use `false` when it is unset.
- **`_meta` omits empty arrays** (`requires`, `examples`, `contexts`).
- **`_meta` carries planning signals, not display text.** It has `destructive` and `undoable` but
  not `confirmPrompt`, which is for a frontend's confirmation dialog. Agents get it from afd-detail.
- **Grouped tools** (`toolStrategy: 'grouped'`) carry the per-command `_meta` fields on each entry
  of `_meta.actions`, not on the tool.

## Surfaces

| Surface | Fields |
| --- | --- |
| tools/list `_meta` | `category`, `requires`, `mutation`, `destructive`, `undoable`, `examples`, `outputSchema`, `contexts` |
| afd-detail | `name`, `description`, `category`, `tags`, `mutation`, `executionTime`, `errors`, `inputSchema`, `outputSchema`, `destructive`, `confirmPrompt`, `undoable`, `handoff`, `handoffProtocol`, `version`, `callable` |
| afd-discover | `name`, `description`, `category`, and `mutation` with `includeMutation` |
| afd-help | `name`, `description`, `requires`; the `full` format adds `category`, `tags`, `mutation`, `destructive`, `undoable`, `examples` |
| afd-docs | `category`, `name`, `description`, `tags`, `mutation`, `destructive`, `confirmPrompt`, `undoable`, parameters |
| afd-schema | `name`, `description`, `inputSchema` |
