# Violet in Loam: the plugin's specification

The normative specification of the [Violet in Loam proposal](../../../../../docs/features/active/violet-app/violet-app.proposal.md),
approved by the owner on 2026-11-16 with every recommendation in its section 12 accepted. It
specifies interfaces, schemas, contracts and tests, and no implementation bodies. Read the
[status](../../../../../docs/features/active/violet-app/STATUS.md) first. Issue
[#2205](https://github.com/lushly-dev/afd/issues/2205), under epic
[#1556](https://github.com/lushly-dev/afd/issues/1556); the build is
[#2207](https://github.com/lushly-dev/afd/issues/2207).

## Status

- **State:** approved 2026-11-23 — drafted 2026-11-23 against `main` at `2e63c766`, revised the
  same day after independent review (verdict "revise", five blockers fixed), re-verified against
  `main` at `73f71572`, approved by the owner on 2026-11-23 (UX sign-off U1 to U6 and technical
  resolutions Q4 to Q13 all accepted as recommended), and revised after a two-model independent
  review ([section 11](#11-review)); lands in [#2251](https://github.com/lushly-dev/afd/pull/2251).
- **Covers:** the package and its manifest (3), the `violet-tree` document type (4), the engine
  port (5), the twenty-two commands and `document-create` (6), the screens and the Specimen
  matrix (7), CI and the D109 boundary (8), and the verification of exit criteria 1, 2 and 4 of
  the proposal's [section 10](../../../../../docs/features/active/violet-app/violet-app.proposal.md#10-exit-criteria)
  (9). Exit criterion 3 was verified by [#1974](https://github.com/lushly-dev/afd/issues/1974).
- **Does not cover:** the mounted `violet-server` behind the same port (the proposal's question
  2, after phase 5 or the plugin-engine specification); agents inside Loam (phase 5); Lushly's
  tree.
- **Checked against the code (2026-11-23, `2e63c766`, re-checked at `73f71572`):** `@lushly-dev/violet-afd/worker`
  (`integrations/violet-afd/src/worker.ts`, `commands/registry.ts`, `context-sources.ts`,
  `value-checks.ts` and each command named in 6); `@lushly-dev/violet-core/worker`, `/css`,
  `/engine` and `/types` (`foundations/violet/packages/core/src/`); `@lushly-dev/loam-sdk`
  (`endpoints/loam/packages/sdk/src/index.ts`); `@lushly-dev/loam-testing`
  (`createAppTestKernel`, `packages/testing/src/index.ts:52-94`); `@lushly-dev/loam-manifest`'s
  generated manifest type (`packages/manifest/src/_generated/types.ts`); `@lushly-dev/afd-testing`'s
  scenario runner (`packages/testing/src/runner/`); `.github/workflows/loam-plugins.yml`;
  `scripts/affected/suites.mjs`; `architecture.json` and `scripts/check-boundaries.mjs`;
  `notes` as the reference document type (`endpoints/loam/apps/notes/`); and the documents
  specification ([phase 2](../../../docs/phases/2-documents/spec.md)) for the type's rules.

## 1. What checking the proposal against the code changed

The proposal was written against `6eeb545d`, before the seven gaps merged. Checking it against
`2e63c766` (and re-checking at `73f71572`) found contradictions it could not see. Each is resolved
here; the resolution is normative, and those that change an approved choice are recorded in
[section 10](#10-decisions).

| # | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| F1 | An `export_command` must be a query, so `violet-tree-export` cannot reset a count of unexported changes | Documents specification 2.1: "`export_command` is an instance command with `effects = ["inspect"]`" (`DOCUMENT_COMMAND_INVALID`) | The content keeps `rev` and `syncedRev`; export reports `rev`; a replacing import passes it back (4.5, Q4) |
| F2 | Violet's `token.reset` records a `reset` operation, which `export.tree` refuses, so the undo of an override would make a tree unexportable | `commands/token/reset.ts` appends `type: 'reset'`; `commands/export/tree.ts:335-339` refuses subtract, reset and copy | `violet-token-reset` runs `token.remove` on the node's own operations, which leaves none behind (5.7, Q5) |
| F3 | A binding's selection cannot be "a node and a token" | `BindingV1.selection` is `'none' \| 'text-range' \| 'item'` (`sdk/src/index.ts:355-362`); `item` is `{ kind: 'item'; id }` (documents specification, 3.1) | `selection = "item"`, with the token in the id (4.4) |
| F4 | `violet-tree-compare` must check another document's record, which needs the `documents` grant | Documents specification 11: a port calls `document-get` only with the grant | Grants are `store`, `clock`, `random` and `documents` (3.2, Q6) |
| F5 | The `example` template's `size.focus.width` is in neither the components' interface nor Loam's tree, so scenario 14 (the default fills the pinned interface) cannot pass | `size.focus-ring.width` is the id in `violet-elements/tokens/interface.json` and `loam-theme/contract/tokens.json`; `size.focus.width` is in neither | The template uses `size.focus-ring.width`; scenario 03 changes with it when it moves (4.2, Q7) |
| F6 | The interface is contract version 3 with 98 ids, not version 1 with 89 | `foundations/fast-af/packages/violet-elements/tokens/interface.json` | Read the version from the file; nothing pins 89 |
| F7 | `violet-elements`' theme set is global: `installVioletThemeSet` replaces the active set and rewrites every adopted runtime sheet, in every document and shadow root | `src/theme/violet-theme-runtime.ts:250-282` | The preview sets custom properties with CSSOM on its own root, and never installs a theme set (7.4) |
| F8 | A `tree` sidebar's command takes `{}`, so it cannot list one document's nodes | Scope and projects specification, 7.4 (`2-scope-projects/spec.md:1151`) | A UX decision (7.2, U1) |
| F9 | Constraints did not travel in tree files in slice 1 | `export.tree` originally wrote adds and overrides only (`import/tree.ts:23-33`) | Resolved in #2330: `export.tree` and `import.tree` now carry `$extensions["dev.lushly.violet"].constraints` with `dropped: []` (Q8) |
| F10 | A deleted node cannot be brought back by any command: deletion is soft, and `node.create` refuses an existing id | `node/delete.ts` sets `deletedAt`; `node/create.ts:60-69` | `violet-node-create` takes `restore: true` (6.4, Q9) |
| F11 | Violet's registry stamps `metadata.executionTimeMs` from the wall clock and `traceId` | `commands/registry.ts`, `execute` | The port drops Violet's metadata, so a replay compares equal (5.6) |
| F12 | Violet's `INVALID_TOKEN_VALUE` suggestion says "colour", and scenario 07 asserts "color" | `value-checks.ts`, `unsafeValueSuggestion` | The port names the token's type (5.8) |
| F13 | `NODE_HAS_CHILDREN` names the children only in a warning | `node/delete.ts:68-82` | The port puts them in the suggestion (5.8) |
| F14 | `audit.list` has no operation field, and `constraints.set` originally wrote no audit event | `audit/list.ts:28-38`; `constraints/set.ts` | The port maps events to operations (6.2, `violet-change-list`), including `constraint_set` → `constraint-set` (resolved in #2329, Q10) |
| F15 | `initializeWorkerCore()` registers into one global registry and throws if called twice | `commands/registry.ts`, `register` | The port initializes once per module (5.1) |
| F16 | `node.create` requires `name`; `interface.check` requires the interface as input | `CreateNodeInputSchema`; `analyze/interface.ts:32-37` | The port passes the id as the name, and the bundled interface unless config pins one (5.2, 6.4) |
| F17 | `import.tree` needs at least one file, so an empty seed cannot go through it | `import/tree.ts:41-50`, `files.min(1)` | An empty seed, or no content, is an empty database built without it (5.2) |
| F18 | `app pack` inlines a type's `content_schema` but not a template's `content`, so a generated template cannot be named by path | `cli/src/file-rules.ts:212-215`; `cli/src/check.ts:36-53` | The build writes `afd-default`'s content into `loam-app.toml`, and a check fails when it is stale (4.2, Q11) |
| F19 | A `MemoryDatabase.transaction` rolls back only when its function throws, and gives no isolation to overlapping calls | `db/memory.ts:369-455`; Violet's handlers return `failure()` rather than throw | The port throws inside the transaction on a failed result, and runs one call at a time per document (5.1) |
| F20 | The desktop's store is a SQLite file the Rust host owns, not IndexedDB | D160 (`decisions.md:175`), amending D106 | 9.3 checks persistence there |
| F21 | Loam's manifest validator forbids custom element names starting with `violet-` (reserved for `@lushly-dev/violet-elements`) or `loam-` | `endpoints/loam/packages/manifest/src/loam-rules.ts:458-459` (`MANIFEST_ELEMENT_INVALID`) | Custom elements use the `token-tree-` prefix: `token-tree-editor`, `token-tree-inspector`, `token-tree-main` (3.2, 7) |

## 2. Terms

- **Tree:** one `violet-tree` document. **Node:** a Violet node in it, named by its id, a path
  such as `example/dark`. **Token:** a dotted id such as `color.text.primary`.
- **Own operation:** an operation a node holds itself (`add` or `override`; the app writes no
  other kind).
- **The port:** the module through which every handler reaches Violet's engine (5).
- **Pinned interface:** the seven-entry interface the app's tests pass as config (6.4,
  `violet-interface-check`), so scenarios 09, 10 and 14 count small.

## 3. Package and manifest

### 3.1 Layout

```text
endpoints/loam/plugins/violet/
  docs/spec.md                 this file
  app/                         @lushly-dev/loam-app-violet, private
    loam-app.toml              3.2
    package.json               3.3
    schemas/                   one input schema per command, violet-tree.content.json (4.1), config.json (3.2)
    templates/                 write.mjs: writes afd-default's content into loam-app.toml (4.2)
    src/
      native.ts                defineApp: handlers, activate
      handlers.ts              one handler per command, through the port
      port/                    the engine port (5): engine.ts, content.ts, results.ts, suggestions.ts, undo.ts
      interface.ts             the bundled components' interface (6.4)
      elements/                the editor (with its node column and five views), inspector, and main view (7)
    scenarios/                 the fifteen scenarios, moved here from docs/features/active/violet-app/scenarios/
    specimens/                 specimen.config.json, violet.specimens.ts (7.6)
    test/                      scenarios.test.ts, port.test.ts, specimen.test.ts, boundary.test.ts
```

Violet's engine stays where it is: the app imports it (D109; an endpoint may depend on an
integration, `scripts/check-boundaries.mjs:256-262`).

### 3.2 `loam-app.toml`

Manifest version 2. Every key below is one the generated manifest type declares
(`manifest/src/_generated/types.ts`); `notes` (`apps/notes/loam-app.toml`) is the model.

```toml
manifest_version = 2
protocol = 1
afd_contract = "1.0"

[plugin]
id = "violet"
title = "Violet"
version = "0.1.0"
description = "Token trees: browse, compare, change with a preview first, check contrast and the components' interface, and export."
kind = "native"
domains = ["violet"]
license = "MIT"

[native]
entry = "dist/native.js"

[app]
scope_levels = ["workspace", "project"]

[[grants]]
name = "store"
reason = "Keeps each tree's nodes, operations, rules and history."

[[grants]]
name = "clock"
reason = "Stamps each change, so a replayed session writes the same times."

[[grants]]
name = "random"
reason = "Draws each record's id, so a replayed session writes the same ids."

[[grants]]
name = "documents"
reason = "Finds the other tree a comparison names, and lists trees to compare with."

# One [[commands]] entry per command in section 6, each with input_schema = "schemas/<name>.input.json",
# category = "violet", the effects, undoable and errors that section gives, and its description.

[[ui.documents]]
id = "violet-tree"
title = "Token tree"
icon = "system/folder"           # U5 (approved 2026-11-23): from the eight ICONS_V1 entries
content_schema = "schemas/violet-tree.content.json"
content_version = 1
instance_commands = [ ... all twenty-two names ... ]
export_command = "violet-tree-export"
import_command = "violet-tree-import"

[ui.documents.editor]
element = "token-tree-editor"

[ui.documents.inspector]
element = "token-tree-inspector"

[ui.documents.binding]
model = "command"
selection = "item"
locator = "item"
conflict = "last-writer-wins"

[[ui.documents.templates]]
id = "blank"
title = "Blank tree"
content = { format = "violet-tree", version = 1, rev = 0, syncedRev = 0, seed = { files = [] } }

[[ui.documents.templates]]
id = "example"
title = "Example tree"
content = { ... 4.2 ... }

[[ui.documents.templates]]
id = "afd-default"
title = "AFD default tree"
content = { ... generated, 4.2 ... }

[config]
schema = "schemas/config.json"

[ui.surfaces.rail]
label = "Violet"
icon = "system/folder"

[ui.surfaces.main]
element = "token-tree-main"
# No [ui.surfaces.sidebar]: U1 (approved 2026-11-23) puts the node tree inside token-tree-editor.
# Custom elements use `token-tree-*` because `violet-*` is reserved for violet-elements (F21).
```

- **No `autosave_ms`.** Every edit is a command at once, as `checklist`'s is (documents
  specification, 10.1).
- **`expose`** is left to AFD's default, palette and agent on, MCP and CLI off (phase 1
  specification, `commands[].expose`). `approval` is omitted: its only value is `none`.
- **`[config] schema`** (`schemas/config.json`, with `additionalProperties: false` at the root as
  `manifest/src/core-rules.ts:154-155` requires) declares one optional key, `interface`, the
  components' interface the check uses (6.3); the deployment entry's `config` sets it, and the test
  kit's `config` option pins it.

### 3.3 Package

`@lushly-dev/loam-app-violet`, private, `type: module`, `engines.node` `>=24`, as `violet-afd`'s. Scripts as
`notes`' (`build`, `typecheck`, `test`, `lint:tokens`, `pack`), `test:specimen`, and
`templates:write` and `templates:check` (4.2).

| Dependency | Kind | Why |
| --- | --- | --- |
| `@lushly-dev/loam-sdk` | runtime | `defineApp`, the contexts, `documentContentKey`, `success`, `failure` |
| `@lushly-dev/violet-afd` | runtime | `/worker` (the registry, `initializeWorkerCore`, `createMemoryDatabase` re-exported) and `/css` (`checkCssTokenValue`) |
| `@lushly-dev/violet-core` | runtime | `/types` (`Node`, `OperationRecord`, `Constraint`, `AuditEvent` TypeScript types, and `NodeSchema`, `ConstraintSchema`, `TokenValueSchema`, `TokenCategorySchema`, `TokenMetadataSchema`) |
| `@lushly-dev/fast-element` | runtime | The app's own elements (7); shared components come through `context.kit.define` (`KIT_ELEMENT_NAMES_V1`), as `notes`' do |
| `@lushly-dev/loam-testing`, `@lushly-dev/afd-testing`, `@lushly-dev/loam-cli` | dev | `createAppTestKernel`; `parseScenarioFile` and the evaluator; `readAppManifest` and `app pack` |
| `@lushly-dev/loam-theme`, `@lushly-dev/specimen`, `@lushly-dev/violet-elements` | dev | Fixtures' theme CSS and components; the Specimen bench; `loam-theme`'s tree files generate `afd-default` (4.2); `violet-elements`' `tokens/interface.json`, bundled at build (6.3) |

`pnpm-workspace.yaml` gains `endpoints/loam/plugins/*/app`. `architecture.json` needs no entry:
`endpoints/loam/plugins/violet/app/package.json` classifies as an endpoint of family `loam` by
its path (`check-boundaries.mjs`, `classification`).

## 4. The `violet-tree` document type

### 4.1 Content, version 1

The content lives in the plugin's `store` under the document's scope at
`documentContentKey(document)` (`doc/<id>`), and only the app's commands read or write it
(documents specification, 3). `schemas/violet-tree.content.json` is the JSON Schema of:

```ts
interface VioletTreeContentV1 {
	format: 'violet-tree';
	version: 1;
	/** Raised by one by every mutation that succeeds. */
	rev: number;                 // integer >= 0
	/** `rev` when the tree last equalled files: after an import, or 0 for a template. */
	syncedRev: number;           // integer >= 0, <= rev
	/** Exactly one of `seed` and `records`. */
	seed?: {
		files: Array<{ name: string; content: string }>;   // DTCG, as import.tree reads them
		constraints?: Record<string, Constraint[]>;       // optional template rules by node id, merged over file-embedded rules (#2330)
	};
	records?: {
		nodes: Node[];                           // creation order, deleted nodes included
		operations: OperationRecord[];           // by node, in sequence order
		constraints: Record<string, Constraint[]>;
		audit: AuditEvent[];                     // oldest first
	};
}
```

`Node`, `OperationRecord`, `Constraint` and `AuditEvent` are `@lushly-dev/violet-core/types`'
shapes (`NodeSchema` and `ConstraintSchema` are exported Zod schemas; `OperationRecord` and
`AuditEvent` are TypeScript interfaces). Timestamp strings in `schemas/violet-tree.content.json`
use plain `"type": "string"` without `"format": "date-time"`, because `loam-manifest`'s schema
fidelity check rejects JSON Schema `format` keywords (`manifest/src/schema-fidelity.ts:271`). A
template holds `seed`; the first mutation writes `records` (5.3). **No content at all**
(a record `document-import` created, which holds none until its `import_command` runs; documents
specification, 4.1) reads as `{ format, version: 1, rev: 0, syncedRev: 0, seed: { files: [] } }`. A record whose
`version` is above 1 is the shell's `DOCUMENT_CONTENT_VERSION_NEWER`; one that fails the schema
is `VIOLET_CONTENT_INVALID`, whose suggestion is to import the tree's files again.

### 4.2 Templates

| Template | Content | Notes |
| --- | --- | --- |
| `blank` | `seed: { files: [] }` | An empty tree; scenario 11 imports into it |
| `example` | `seed`: four files and one rule, below | The scenarios' fixture |
| `afd-default` | `seed`: Loam's seven DTCG files (`endpoints/loam/packages/theme/tree/*.tokens.json`) and no constraints | Written into `loam-app.toml` by the app's `templates:write` script; `templates:check`, run by `test`, fails when it differs from `loam-theme`'s files (F18). An independent copy that inherits nothing from Loam's tree |

**`example`** (proposal 4.2, with F5's id): `example.tokens.json`, a `product` root, adds
`color.surface.page #ffffff`, `color.text.primary #1b1b1f`, `color.text.muted #6b6b75`,
`color.field.border #8a8a94`, `color.action.primary.background #5b3fd1` and
`size.focus-ring.width 2px`; `example_light.tokens.json` (`example/light`, `theme`, no
operations); `example_dark.tokens.json` (`example/dark`, `theme`) overrides
`color.surface.page #121214`, `color.text.primary #ececf1`, `color.text.muted #9a9aa6` and
`color.field.border #6e6e7a`; `example_high-contrast.tokens.json` (`example/high-contrast`,
`theme`) overrides `color.text.primary #000000`, `color.field.border #000000` and
`size.focus-ring.width 3px`. `constraints.example`: one rule, `id: text-on-page`,
`name: Text on the page`, `applyTo: "color.text.*"`,
`config: { type: contrast, against: color.surface.page, min: 4.5 }`. Each file carries
`$extensions["dev.lushly.violet"]` with `node`, `parent` and `type`, and `$type` on each root
token, as Loam's files do.

`app pack` inlines no template `content` (F18), so every template's content is in
`loam-app.toml` itself; the `templates/` folder of 3.1 holds only `templates:write`'s script.
`app check` and `app pack` check each template's `content` against the content schema
(documents specification, 2.1, `DOCUMENT_TEMPLATE_INVALID`). The `afd-default` content is about
40 KB, measured as files (STATUS, #1974: 39,674 B raw). The manifest reader has no size bound on a
template; its effect on the deployment's `apps` budget is measured when built, against
[phase 2's budget table](../../../docs/phases/2-scope-projects/spec.md#24-the-budget-and-the-rule).

### 4.3 Scope

`scope_levels` is the app's: `["workspace", "project"]` (the owner's answer to question 5). A
handler's store is the call's scope's, so every command, `violet-tree-compare`'s other tree
included, reaches only trees in the call's scope.

### 4.4 Binding and selection

`model = "command"`, `conflict = "last-writer-wins"`, `selection` and `locator` both `item`
(F3). The selection's `id` is `<node>` for a node, or `<node>#<token>` for a token on it. Token
ids cannot hold `#` (`validateTokenId` allows letters, digits, `_` and `-` in dot-separated
segments, #1957), so the id splits at its last `#`; and `violet-node-create` and
`violet-tree-import` refuse a node id holding `#` (`VALIDATION_ERROR`), so a node's own id is never
read as one. The editor dispatches
`EDITOR_SELECTION_EVENT` with `{ kind: 'item', id }` or `null`, and `editor-selection-set`
checks the shape (documents specification, 3.1).

### 4.5 Export, import and the size bound

- **Export** is `violet-tree-export`, a query, over `export.tree`. `document-export` wraps its
  `{ content }` in `{ loam_document: 1, type, content_version, title, tags, content }`
  (documents specification, 4.1).
- **Import** is `violet-tree-import`, taking `{ document, content, replace?, exportedRev? }`;
  `document-import` creates the record and names it in `data.next`.
- **Unexported changes** are `rev - syncedRev`, which `violet-node-list` reports as `unexported`. A replacing import is allowed when that is 0, or
  when `exportedRev` equals `rev` (the caller holds an export of the tree as it is). Otherwise it
  is refused with `OPERATION_NOT_ALLOWED`, whose suggestion names `violet-tree-export` and
  `exportedRev`. A replacing import (`replace: true`), or an additive import into a tree with no
  unexported changes (`rev === syncedRev`, including a blank tree), sets `syncedRev` to the new
  `rev`; an additive import (`replace` omitted/false) on a tree that already has unexported edits
  (`rev > syncedRev`) preserves the existing `syncedRev` so those edits remain guarded against a
  later replacing import without an export. This replaces the proposal's "export resets the count" (F1).
- **The bound.** An instance command's input over `loam.limits.inputBytes` (default 262,144
  bytes) is `DOCUMENT_CONTENT_TOO_LARGE` before the handler (documents specification, 4.4, as
  amended by phase 4's step 10). Only `violet-tree-import` carries a tree; Loam's measured
  45,642 bytes as `{ content: { files } }` (17.41%, #1974). Every other command's input is
  small; `violet-change-apply`'s 50 changes are its largest.

## 5. The engine port

### 5.1 Interface

```ts
// app/src/port/engine.ts — signatures only
import type { AppCallContextV1, CommandResult } from '@lushly-dev/loam-sdk';
import type { Database } from '@lushly-dev/violet-afd/worker';

/** A Violet command's result, already mapped: Loam names, no Violet metadata. */
export interface PortResult<T> { result: CommandResult<T>; wrote: boolean }

export interface VioletPort {
	/** Read access: the tree's database, built or taken from the cache (5.2). */
	read<T>(document: string, context: AppCallContextV1,
		run: (db: Database, engine: Engine) => Promise<CommandResult<T>>): Promise<CommandResult<T>>;
	/** Write access: runs `run` in one `db.transaction`, then persists (5.3) when it succeeded. */
	write<T>(document: string, context: AppCallContextV1,
		run: (db: Database, engine: Engine) => Promise<CommandResult<T>>): Promise<CommandResult<T>>;
	/** Builds a fresh database from files, all or nothing (5.5). */
	importFiles(files: TreeFile[], constraints: Record<string, Constraint[]>,
		context: AppCallContextV1): Promise<CommandResult<{ db: Database }>>;
}

/** Runs one Violet command by its dotted name on `db`, with the context's actor, clock and ids. */
export interface Engine {
	call<T>(name: VioletCommandName, input: unknown): Promise<CommandResult<T>>;
}
```

- **One registry.** The module calls `initializeWorkerCore()` once, at import, and keeps
  `registry` (F15). It registers no Node-only command (`worker.ts:1-33`).
- **The context.** `Engine.call` runs `registry.execute(name, input, violetContext)` with
  `violetContext = { db, actor, traceId, now, random }`: `actor` is the Loam actor's id
  (`'local'` without one), `now` and `random` are the call context's (`AppCallContextV1.now`,
  `.random`), so every timestamp and id Violet writes comes from them (`context-sources.ts`;
  G9). Without the `clock` or `random` grant the handler fails with `APP_GRANT_MISSING`, as
  `notes` does for `store`, rather than fall back to the wall clock.
- **One call at a time per document.** The port queues calls by document id, so a preview
  never reads an Apply half written and a rolled-back write never undoes another call's (F19).
- **Rollback.** `write` runs `run` inside `db.transaction`, and throws a private sentinel out of it
  when `run`'s result is a failure, so the `MemoryDatabase` restores its snapshot; it then answers
  that failure and drops the cached database as well (F19).
- **Only the port imports Violet.** Handlers import the port; a unit test fails on any other
  import of `@lushly-dev/violet-afd` or `@lushly-dev/violet-core` outside `src/port/` and
  `src/interface.ts`.

### 5.2 Building and caching

- **Build from `records`:** `createMemoryDatabase()`, then `createNode` for each node in order,
  `addOperation` for each operation (keeping its id and sequence), `setConstraints` per node, and
  `addAuditEvent` per event. It draws no id and reads no clock. Only `Database`'s public methods
  (`storage.ts`); `MemoryDatabase`'s snapshot is private.
- **Build from `seed`:** with no files, an empty database (F17). Otherwise `import.tree { files }`
  into a scratch database, then the nodes, operations and the seed's rules copied into a fresh one
  with no audit events, since a template's contents are no one's change. The scratch build's ids
  come from a generator seeded by the document id, not the call's `random()`, and its times from
  the call's `now()`, which no command returns; so every build of one seed gives the same ids.
- **Cache.** One database per document, keyed by the document id and a SHA-256 digest of the
  stored content's JSON (`crypto.subtle.digest`, in the browser and in Node). A call reads the
  content first and rebuilds on any other digest, so a second tab, an undo, a replay or another
  kernel that reuses a document id (the test kit seeds each kernel alike,
  `testing/src/index.ts:140-141`) never reads another tree. After a write the entry is keyed by the
  digest of the content put; when the put fails (`QUOTA_EXCEEDED` among others) the entry is
  dropped, so no read sees an edit that was not saved. A seed is never cached. Since neither
  build draws from the call's `random()`, a hit and a rebuild leave the same journal.
- **A seed in a query** is built in memory and not persisted: a query writes nothing. The first
  mutation builds it again, identically, and persists `records`.

### 5.3 Persistence

After a write whose `run` succeeded, the port reads every node (deleted included), operation,
constraint set and audit event back through `Database` and puts
`{ format, version: 1, rev: rev + 1, syncedRev, records }` at `documentContentKey(document)` with
one `store.put`. A write whose `run` failed puts nothing and raises no `rev`. `violet-tree-import`
updates `syncedRev` to the new `rev` only when `replace: true` or when the tree had zero unexported
changes before the import (`rev === syncedRev`); otherwise `syncedRev` stays unchanged (4.5).

**Size.** The content is the plugin's store, bounded per instance by `loam.limits.storeBytes`
(default 26,214,400 bytes; phase 4 specification, 11), past which a write is `QUOTA_EXCEEDED`, which
the port passes on. Each change adds an operation and an audit event, so the history is the part
that grows without bound; how much of it a tree keeps is Q12.

### 5.4 Deterministic replay

`createAppTestKernel`'s `replay()` re-runs the journal on a fresh kernel and throws on any
difference (`testing/src/index.ts:73-80`). The port holds to it by: drawing every id and time
from the context (5.1); dropping Violet's `metadata` (F11) and `reasoning`, `sources`; ordering
every list it returns (5.6); and keeping no state between calls but the cache, which is keyed by
the document id and the stored content's digest (5.2).

### 5.5 Atomic import

`importFiles` builds into a fresh `createMemoryDatabase()`: when `files` is empty (`files: []`),
it returns an empty database without calling `import.tree` (F17, allowing blank documents to
round-trip through `document-export` / `document-import`); otherwise it runs `import.tree { files }`,
then applies each constraint set. Any failure discards the fresh database and the document is
untouched; this closes `import.tree`'s partial writes (`import/tree.ts:89-93`). Only on success
does the handler replace the cache and persist. Without `replace`, the fresh tree is built from the
existing tree (its records, or its seed built as 5.2) plus the files (if any), so a file naming an
existing node is `NODE_ALREADY_EXISTS`.

### 5.6 Results

- **Names.** Every output uses the app's names: `node`, `token`, `value`, `from`, never
  `nodeId`, `tokenId`, `resolvedAt`.
- **Order.** Nodes in tree pre-order, siblings in creation order (the template's file order, so
  `example`, `example/light`, `example/dark`, `example/high-contrast`); the port re-sorts every list of
  nodes Violet returns, `interface.check`'s `nodes`, `missing`, `invalid` and `leaked` among them
  (re-sorting `leaked` by code point rather than `localeCompare`, `analyze/interface.ts:155`). Tokens
  by id, ascending, by code point. Compare cells in the input's node order. History newest first.
- **Metadata.** Violet's `metadata`, `reasoning`, `sources` and `confidence` are dropped. Violet's
  `warnings` are kept only where 6 says.
- **Undo.** Set by the handler as `undoCommand` and `undoArgs` (5.8), never Violet's.

### 5.7 Undo

| Command | `undoCommand` | `undoArgs` beside `document` |
| --- | --- | --- |
| `violet-token-override`, `inherited: true` | `violet-token-reset` | `node`, `token` |
| `violet-token-override`, `inherited: false` | `violet-token-override` | `node`, `token`, `value: oldValue` |
| `violet-token-add` | `violet-token-reset` | `node`, `token` |
| `violet-token-reset` | `violet-change-apply` | `node`, `changes`: one collapsed change restoring the node's own state on the token — `{ operation: 'add', token, value: lastValue, metadata }` if the removed operations included an `add` (carrying that add's `metadata` and the last removed operation's `value`), else `{ operation: 'override', token, value: lastValue }` |
| `violet-change-apply` | `violet-change-apply` | `node`, `changes`: each change's single inverse by the rows above, in reverse order (guaranteed `<= 50` changes for any valid apply, with unambiguous ordering even when a reset removed multiple operations) |
| `violet-node-create` | `violet-node-delete` | `node` |
| `violet-node-delete` | `violet-node-create` | `parent`, `id`, `type`, `restore: true` |
| `violet-constraint-set` | `violet-constraint-set` | `node`, `constraints: previous`, `merge: false` (`previous` is the node's local rules only, always `<= 50`) |
| `violet-tree-import` | none | The import is atomic; a document made by `document-import` goes to the trash |

The reset's `undoArgs` come from `getOperations` on the node, read before `token.remove`, since
`token.remove`'s result carries no metadata (`token/remove.ts:25-31`). Collapsing a token's
removed operations to one `add` or `override` with the last value matches `export.tree`'s own
collapsing rule (`export/tree.ts:151-155`), keeps the inverse within `violet-change-apply`'s
50-change cap even after >50 historical overrides, and produces byte-identical exported files.

**The reset rule (F2).** `violet-token-reset` runs `token.remove { nodeId, tokenId }`, which
removes every own operation the node holds on the token and leaves no operation behind, so the
node follows its parent again and `export.tree` can still write it. Violet's `token.reset` is not
used. An `add` that other nodes still read is refused by `token.remove` with
`OPERATION_NOT_ALLOWED` (`token/remove.ts:101-113`), which keeps the undo of an add safe.

### 5.8 Suggestions

Every error the port passes on names a command that exists in this app (the honesty check). The
port rewrites the dotted names below inside `message` and `suggestion`, then applies the
per-error rules after it. A suggestion still naming a dotted command, `violet call`, `--force`,
`force: true` or `--schema` fails a unit test over every error each Violet command declares.

| Violet | App |
| --- | --- |
| `node.list`, `node.get`, `node.create`, `node.delete` | `violet-node-list`, `-get`, `-create`, `-delete` |
| `token.add`, `token.override`, `token.reset`, `token.remove` | `violet-token-add`, `-override`, `-reset`, `-reset` |
| `tokens.resolve`, `token.lineage`, `tokens.compare`, `tokens.catalog` | `violet-token-resolve`, `-lineage`, `-compare`, `violet-token-find` |
| `changes.impact`, `audit.list`, `constraints.set`, `analyze.violations` | `violet-change-preview`, `violet-change-list`, `violet-constraint-set`, `violet-violation-list` |
| `interface.check`, `export`, `export.tree`, `import.tree` | `violet-interface-check`, `violet-export`, `violet-tree-export`, `violet-tree-import` |
| `node.update`, `token.subtract`, `token.copy`, `violet node list`, `violet call <name> --schema` | No counterpart: the per-error rule below replaces the clause |

| Error | Rule | Scenario |
| --- | --- | --- |
| `NODE_NOT_FOUND` | Names `violet-node-list`, and the other tree's id when the node is in it | 01, 13 |
| `TOKEN_NOT_FOUND` from lineage | Names `violet-token-find` | 03 |
| `TOKEN_NOT_FOUND` from override | Names `violet-token-add` and `violet-token-find` | 06 |
| `NODE_ALREADY_EXISTS` | Names `violet-node-list`; for a deleted node, `violet-node-create` with `restore: true` | 12 |
| `NODE_HAS_CHILDREN` | Lists the active children's ids, from Violet's `HAS_CHILDREN` warning | 12 |
| `INVALID_TOKEN_VALUE` | "Give a plain `<type>` value", where `<type>` is the token's `$type` (`color` for scenario 07), else "a plain value of the token's type", then Violet's list of what is refused | 07 |
| `INVALID_PARENT` | From `node.create` and `import.tree`: names the parent and `violet-node-list` | — |
| `OPERATION_NOT_ALLOWED` from `token.remove` | Keep the dependent nodes list and `violet-token-reset` guidance, and strip `, or pass force: true` (`violet-token-reset` has no `force` parameter) | — |
| `OPERATION_NOT_ALLOWED` from `export.tree` | "Replace each subtract, reset or copy with `violet-token-override` or `violet-token-reset`, then export again" (the app writes none; an imported Violet database could hold them) | — |
| `OPERATION_NOT_ALLOWED` from `violet-change-apply` (`expectedRev` mismatch) | "The tree changed since the preview; run `violet-change-preview` again before applying" | — |
| `TOKEN_REFERENCE_NOT_FOUND` from `export` | Names the missing reference target and `violet-token-lineage` / `violet-token-override` | — |
| `CIRCULAR_REFERENCE` from `export` / `import.tree` | Names the cycle and `violet-token-lineage` / `violet-token-override` | — |
| `NOT_IMPLEMENTED` from `export` (reference transform) | "Replace the reference transform with a plain value using `violet-token-override` before exporting" | — |
| `DUPLICATE_CONSTRAINT_ID` | Names the duplicate id and `merge` | — |
| `TOKEN_ALREADY_EXISTS` | Names `violet-token-override` | 09 |
| `OPERATION_NOT_ALLOWED` from import | Names `violet-tree-export` and `exportedRev` | 11 |
| `VALIDATION_ERROR` from Violet's registry | "Check the input against `<app command>`'s schema (afd-detail returns it)" | — |
| `VALIDATION_ERROR` from Loam's schema check | AFD's own (`server/src/execution.ts`, `formatEnhancedValidationError`), which states the limit or the allowed values | 04, 10 |
| `INTERNAL_ERROR` | Message kept; suggestion "Report this with the tree's exported files" | — |

## 6. Commands

### 6.1 Common rules

- **Every command is an instance command** of `violet-tree`: its input schema has a required
  string `document`, the shell checks it first (exists, readable, this type, in the call's scope,
  not trashed; documents specification 4.2), and its errors are the shell's
  (`DOCUMENT_NOT_FOUND` and the rest) before any below.
- **Schemas.** JSON Schema, `additionalProperties: false`, in `schemas/<name>.input.json`. `node`
  and `token` are strings of 1 to 256 characters; `reason` is a string of 1 to 500. A token `value`
  matches `@lushly-dev/violet-core/types`' `TokenValueSchema` (`string | number | object`, so
  imported references, platform maps and composite values can be edited and undone without schema
  rejection; `checkCssTokenValue` still guards unsafe CSS values). `limit` defaults as given and is
  bounded.
- **Effects.** Queries are `["inspect"]`; mutations are `["store-write"]` and `undoable = true`,
  but `violet-tree-import` (`undoable` false). No command is `destructive`: each write is undoable
  but the import, which is atomic and refused over unexported changes.
- **Descriptions** are agent-facing and carry the four facts the proposal's 4.4 names: find a tree
  with `document-list { type: "violet-tree" }`; node ids are paths; `add`, `override` and `reset`
  differ; writes are not checked against the rules, so preview first. Each description below is
  the manifest's `description`, verbatim.
- **`errors`** in each manifest entry lists the codes given below.

### 6.2 Reading the tree

**`violet-node-list`** — over `node.list { view: 'flat' }` and each node's own operations.
"List a token tree's nodes (ids are paths like product/dark) with each node's kind, parent and
how many tokens it sets itself. Find trees with document-list { type: \"violet-tree\" }."

- Input: `{ document }`.
- Output: `{ root: string | null, nodes: [{ id, parent: string | null, type, customizations }], unexported }`.
  `root` is the first root node's id, `null` for an empty tree; `customizations` counts the
  distinct tokens the node holds an operation on; deleted nodes are left out; `unexported` is
  `rev - syncedRev` (4.5).
- Errors: none of its own. Scenario 01.

**`violet-node-get`** — over `node.get { includeOperations: true }`. "Read one node of a token
tree and the tokens it sets itself, each with its operation (add or override) and value."

- Input: `{ document, node }`.
- Output: `{ node: { id, parent, type }, own: [{ token, operation: 'add' | 'override', value }] }`,
  `own` by token id; where a node holds two operations on one token, the later one.
- Errors: `NODE_NOT_FOUND`. Scenario 03.

**`violet-token-resolve`** — over `tokens.resolve`. "Resolve the tokens a node ends up with, each
with the node that set it. filter is a glob such as color.text.*; read summaries first on large
trees."

- Input: `{ document, node, filter?, limit? }`, `limit` 1 to 2,000, default 500.
- Output: `{ node, tokens: [{ id, value, from }], total, truncated }`. `value` is Violet's
  `resolvedValue`; `from` its `resolvedAt`; `total` before `limit`.
- Errors: `NODE_NOT_FOUND`. Scenario 01.

**`violet-token-find`** — over `tokens.catalog { query, category }` (omitting `rootId`, so an empty
`blank` tree returns `{ tokens: [], total: 0 }` rather than failing `z.string().min(1)`, and
multi-root imported trees are searched in full). "Find tokens by words in their id, description or
category, with the nodes that set each. An empty list is not an error."

- Input: `{ document, query, category? }`, `query` 1 to 200 characters; `category` one of
  `TokenCategorySchema`'s values.
- Output: `{ tokens: [{ id, category, customizedAt }], total }`, where `customizedAt` is
  `definedAt` followed by `customizedOn`, in node order.
- Errors: none of its own. Scenario 02.

**`violet-token-lineage`** — over `token.lineage`. "Show where a node's value for a token comes
from: each node on the way from the one that added it, and what each did (add, override,
inherit)."

- Input: `{ document, node, token }`.
- Output: `{ token, value, from, chain: [{ node, operation, value? }] }`, `chain` root first, as
  Violet orders it; `from` is the last chain entry that is not `inherit` or `superseded`.
- Errors: `NODE_NOT_FOUND`, `TOKEN_NOT_FOUND`. Scenarios 03, 05.

**`violet-token-compare`** — over `tokens.compare { onlyDifferent: true }`. "Compare two to four
nodes of one tree side by side, only tokens that differ; each cell says whether it differs from
the first node."

- Input: `{ document, nodes, filter? }`, `nodes` 2 to 4 strings (`minItems: 2`, `maxItems: 4`).
- Output: `{ nodes, rows: [{ token, cells: [{ node, value, differs }] }], summary: { differing } }`.
  `rows` from Violet's `tokens`, cells in input order from its `cells` record, `differing` its
  `summary.different`.
- Errors: `VALIDATION_ERROR` (count; duplicates, from Violet's "Pass 2–4 different nodes"),
  `NODE_NOT_FOUND`. Scenarios 04, 12.

**`violet-tree-compare`** — `tokens.resolve` on each tree. "Compare a node of this tree with a
node of another tree in the same scope: tokens whose values differ, and tokens only one side has."

- Input: `{ document, node, other: { document, node }, filter? }`.
- Output: `{ rows: [{ token, here: value | null, there: value | null }], summary: { differing, onlyHere, onlyThere } }`,
  rows by token, `null` where a side lacks it; `differing` counts rows with both sides.
- Errors: `DOCUMENT_NOT_FOUND` when `other.document` is not a readable, untrashed `violet-tree` in
  the call's scope (by a nested `document-get`, a query, under the `documents` grant);
  `NODE_NOT_FOUND` for either node, naming which tree. Scenario 13.

**`violet-change-list`** — over `audit.list`. "List changes to a tree's nodes and tokens, newest
first, with the old and new value, who made each and the reason given."

- Input: `{ document, node?, token?, limit? }`, `limit` 1 to 500, default 50.
- Output: `{ changes: [{ node, token: string | null, operation, oldValue, value, reason: string | null, actor, at }], total }`.
- Operations: `token_created` is `add`; `token_updated` whose new value is `{ reset: true }` is
  `reset`, otherwise `override`; `operation_removed` is `reset` (5.7); `node_created`,
  `node_updated`, `node_deleted` are `node-create`, `node-restore`, `node-delete`; `constraint_set`
  is `constraint-set` (#2329). `audit.list`
  already parses JSON strings (`audit/list.ts:112-117`) and omits absent fields; the port unwraps
  `newValue.value` for `token_created` (`token/add.ts:154-157`), normalizes omitted `targetToken`,
  `oldValue`, `newValue` and `reason` to `null`, reads `reason` from the event's metadata, and maps
  `at` from its timestamp. When `node` is supplied, the port checks `db.getNode(node)` (accepting
  soft-deleted nodes so their history remains readable, and returning `NODE_NOT_FOUND` for unknown
  ids since `audit.list` without `subtree` does not check node existence).
- Errors: `NODE_NOT_FOUND`. Scenario 15.

### 6.3 Checking

**`violet-change-preview`** — shared staging dry-run + `changes.impact`. "Preview token changes on
a node without writing: which nodes change, which are shielded by their own override, and which
contrast rules break. Apply exactly that with the apply step it returns."

- Input: `{ document, node, changes }`, `changes` 1 to 50 of `{ operation: 'add', token, value,
  metadata? }`, `{ operation: 'override', token, value }` or `{ operation: 'reset', token }`;
  `metadata` is `{ type?, category?, tier?, description? }` of `TokenMetadataSchema`.
- Output: `{ written: false, summary: { changed, shielded, violationsIntroduced }, nodes: [{ id, effect, violationsIntroduced }], apply: { command: 'violet-change-apply', input } }`,
  where `changed` sums `summary.effects.changes + summary.effects.added + summary.effects.removed`
  (so adds and removes are counted beside value overrides, `impact.ts:489-510`), `shielded` is
  `summary.effects.shielded`, and `apply.input` carries `{ document, node, changes, expectedRev }`
  with `expectedRev` set to the tree's current `rev`.
- **Shared preview/apply staging rule:** before calling `changes.impact`, both
  `violet-change-preview` and `violet-change-apply` execute the exact batch in order (`token.add`,
  `token.override`, `token.remove`) inside a transaction (always rolled back in preview; committed
  in apply). This guarantees every invalid `reset` (an inherited-only token with no own operation ->
  `TOKEN_NOT_FOUND`; an `add` still read by descendants -> `OPERATION_NOT_ALLOWED`) fails
  identically in preview and apply. When calling `changes.impact`, each `reset` translates to
  `subtract` if no ancestor provides the token (e.g., an `add` on a root or subtree root, avoiding
  `token.reset`'s `INVALID_PARENT` on roots, `token/reset.ts:66-72`) and to `reset` when an
  ancestor provides it.
- Errors: `NODE_NOT_FOUND`, `TOKEN_NOT_FOUND`, `TOKEN_ALREADY_EXISTS`, `INVALID_TOKEN_VALUE`,
  `OPERATION_NOT_ALLOWED`, `VALIDATION_ERROR` (Violet's "reaches more than N nodes"). Scenario 05.

**`violet-theme-preview`** — `tokens.resolve` and `checkCssTokenValue`. "Return the custom
properties a preview of a node applies (--violet-color-text-primary: #1b1b1f), and any value refused as
unsafe to draw."

- Input: `{ document, node }`.
- Output: `{ node, count, properties: [{ name, value }], refused: [{ token, reason }] }`. `name`
  is `--` and the id with `.` as `-`; a value `checkCssTokenValue` refuses is in `refused`, not
  `properties`; `count` is `properties.length`.
- Errors: `NODE_NOT_FOUND`. Scenario 07.

**`violet-violation-list`** — over `analyze.violations { rootId }`. "List contrast and other rule
failures across every node of the tree, each with its token, rule and measured ratio."

- Input: `{ document, root? }`.
- Output: `{ violations: [{ node, token, rule, severity, ratio?, min? }], summary: { total, errors } }`.
  `ratio` and `min` are parsed from a contrast violation's `actual` (`"3.21:1"`) and `expected`
  (`">= 7:1"`, `constraints/validators.ts:318-319`).
- Errors: `NODE_NOT_FOUND`. Scenario 08.

**`violet-interface-check`** — over `interface.check`. "Check that every entry of the shared
components' token interface resolves in each theme node; list each missing entry by node."

- Input: `{ document, nodes? }`, 1 to 200.
- The interface is `config.interface` when set, otherwise the one bundled at build time from
  `@lushly-dev/violet-elements/tokens/interface.json` (F6; contract version 3, 98 ids at
  `2e63c766`). Tests set `config.interface` to the pinned interface: the `example` template's six
  ids and `color.action.danger.background`, contract version 1.
- Output: `{ interface: { version }, complete, nodes, missing: [{ node, token, reason }], invalid: [{ node, token, type, problem }], leaked: [{ token, reason }] }`. (`leaked` passes through `interface.check`'s private-prefix / global-tier leak check, added in `#2295`.)
- Errors: `NODE_NOT_FOUND`. Scenarios 09, 14.

### 6.4 Writing

**`violet-token-add`** — over `token.add`. "Add a token a node defines (its children inherit it).
To change an existing token's value use violet-token-override; writes are not checked against the
rules, so preview first."

- Input: `{ document, node, token, value, metadata?, reason? }`, `metadata` as
  `violet-change-preview`'s, so a token added here carries a `$type` and category to its file and
  to the value check.
- Output: `{ node, token, value }`. Undo: 5.7.
- Errors: `NODE_NOT_FOUND`, `TOKEN_ALREADY_EXISTS`, `INVALID_TOKEN_VALUE`, `VALIDATION_ERROR`
  (an unsafe token id, #1957). Scenario 09.

**`violet-token-override`** — over `token.override`. "Set a node's own value for a token it
already has; the result says whether the value it replaced was inherited. Preview first with
violet-change-preview."

- Input: `{ document, node, token, value, reason? }`.
- Output: `{ node, token, oldValue, inherited, value }`. `inherited` is whether the value replaced
  resolved at another node before the write (the resolved token's `resolvedAt`, as
  `previous-value.ts` computes it). Undo: 5.7.
- Errors: `NODE_NOT_FOUND`, `TOKEN_NOT_FOUND`, `INVALID_TOKEN_VALUE`, `VALIDATION_ERROR`.
  Scenarios 06, 07, 08, 11, 13, 15.

**`violet-token-reset`** — over `token.remove { tokenId }` (5.7). "Take back a node's own value
for a token, so it follows its parent again; on the node that added the token, this removes it."

- Input: `{ document, node, token, reason? }`.
- Output: `{ node, token, value, from }` after the reset, from `token.lineage`; both `null` when the
  token no longer resolves at the node.
- Errors: `NODE_NOT_FOUND`; `TOKEN_NOT_FOUND` when the node holds no operation of its own on the
  token, naming `violet-token-lineage`; `OPERATION_NOT_ALLOWED` when other nodes still read an add.
  Scenario 06.

**`violet-change-apply`** — `token.add`, `token.override` and `token.remove` in one
`db.transaction`. "Apply up to 50 token changes on one node as one change with one undo, as
violet-change-preview showed them."

- Input: `{ document, node, changes, reason?, expectedRev? }`, `changes` as
  `violet-change-preview`'s. When `expectedRev` is supplied (as `violet-change-preview`'s
  `apply.input` always populates it) and does not equal the tree's current `rev`, the handler
  refuses before writing with `OPERATION_NOT_ALLOWED` (5.8). Direct callers (including Scenario 05)
  may omit `expectedRev`.
- Output: `{ applied, summary: { changed, shielded, violationsIntroduced } }`, `summary` computed
  by the same translated `changes.impact` helper as `violet-change-preview` (6.3, including
  `reset -> subtract` when no ancestor provides the token and summing `changes + added + removed`);
  `applied` is `changes.length`.
- All or nothing: the first refusal rolls every change back and answers that change's error, its
  index in `error.details.index`. Undo: 5.7.
- Errors: as each change's command, plus `OPERATION_NOT_ALLOWED` on `expectedRev` mismatch.
  Scenario 05.

**`violet-node-create`** — over `node.create { id, name: id, parentId, type }`. "Add a node,
usually a theme, under a parent; it inherits every value until it overrides one. restore: true
brings back a deleted node with its tokens."

- Input: `{ document, parent: string | null, id, type, restore? }`, `parent` `null` to create a
  root node in a `blank` tree (`node.ts:84`), `type` one of `NodeTypeSchema`'s values.
- `restore: true` needs a deleted node with that id and parent; the port clears its `deletedAt`
  with `Database.updateNode(id, { deletedAt: null })` and writes a `node_updated` audit event, in
  one transaction (F10).
- Output: `{ node: { id, parent, type } }`. Undo: 5.7.
- Errors: `NODE_ALREADY_EXISTS`; `INVALID_PARENT` for a missing parent, and the port refuses a
  deleted parent the same way (`node.create` accepts one); `NODE_NOT_FOUND` when there is no
  deleted node to restore; `VALIDATION_ERROR` for an id holding `#`. Scenario 12.

**`violet-node-delete`** — over `node.delete` (never `force`). "Delete a node that has no
children; its tokens are kept so the undo brings it back."

- Input: `{ document, node, reason? }`.
- Output: `{ node }`. Undo: 5.7.
- Errors: `NODE_NOT_FOUND`, `NODE_HAS_CHILDREN` naming the children. Scenario 12.

**`violet-constraint-set`** — over `constraints.list { nodeId, includeInherited: false }` then
`constraints.set`. "Set a node's rules, such as contrast floors (text against the page at 4.5:1);
merge: true adds to the node's rules. Rules are checked by violet-violation-list, not on write."

- Input: `{ document, node, constraints, merge? }`, `constraints` 0 to 50 of
  `@lushly-dev/violet-core/types`' `ConstraintSchema`, `merge` default `false`.
- The port rejects missing or soft-deleted nodes (`!node || node.deletedAt` -> `NODE_NOT_FOUND`,
  since `constraints.set` only checks `!node`), reads local rules only (`includeInherited: false`,
  `constraints/list.ts:15`), and refuses a `merge: true` whose resulting local list would exceed 50
  rules with `VALIDATION_ERROR`, guaranteeing `previous` is always local-only and `<= 50` so its
  undo always satisfies the schema (5.7).
- Output: `{ node, constraints, previous }`, both the node's local rule lists. Undo: 5.7.
- Errors: `NODE_NOT_FOUND`, `DUPLICATE_CONSTRAINT_ID`, `VALIDATION_ERROR`. Scenario 08.

### 6.5 Files and formats

**`violet-export`** — over `export { nodeId, format, selector }`. "Export a node's resolved
tokens in one format (css under a selector, json, …), with the tree's open checks stated beside
it."

- Input: `{ document, node, format, selector? }`, `format` the enum `json`, `css`, `scss`,
  `typescript`, `swift`, `kotlin`, `dart`, `tailwind`, `lua` (`export/export.ts:18-28`),
  `selector` 1 to 200 characters matching `^[A-Za-z0-9_\-\[\]="':.#>+~*(), ]+$`, so no `{`, `}`,
  `;`, `/`, `\` or `@` can open a rule in the stylesheet (Violet's CSS transformer writes it as given,
  `core/src/export/transformers/css.ts:52`, `:83`).
- Output: `{ format, content, tokenCount, checks: { violations: number, unfilled: number } }`,
  where `violations` counts `analyze.violations { rootId: node }` entries with `nodeId === node`
  (excluding descendants' violations), and `unfilled` is `missing.length` from
  `interface.check { nodes: [node] }`.
- Errors: `NODE_NOT_FOUND`, `VALIDATION_ERROR` (format), `INVALID_TOKEN_VALUE` (a value unsafe in
  the format, `css.ts`'s check), `TOKEN_REFERENCE_NOT_FOUND` (missing alias target),
  `CIRCULAR_REFERENCE` (alias cycle), `NOT_IMPLEMENTED` (reference transform,
  `export.test.ts:496-515`). Scenario 10.

**`violet-tree-import`** — 5.5. "Bring a tree in from DTCG token files, one node per file, all
or nothing. replace: true replaces the tree, refused while changes are unexported unless
exportedRev is the rev violet-tree-export returned."

- Input: `{ document, content: { files: [{ name, content }] }, replace?, exportedRev? }`, `files`
  0 to 200 (`minItems: 0`, so an exported `blank` tree round-trips cleanly through `document-export`
  and `document-import` / `data.next`, 5.5).
- Output: `{ nodes: [{ id, parent, tokens }], rev }`, `tokens` Violet's `tokensImported`.
- Not undoable. Errors: `NODE_ALREADY_EXISTS` (without `replace`), `OPERATION_NOT_ALLOWED`,
  `INVALID_TOKEN_VALUE`, `INVALID_PARENT`, `CIRCULAR_REFERENCE`, `VALIDATION_ERROR` (a file Violet
  cannot read, or a node id holding `#`). Scenario 11.

**`violet-tree-export`** — over `export.tree`. A query, the type's `export_command`. "Write the
tree back as DTCG files, one per node with only that node's own values, and the rev to pass to a
later replacing import."

- Input: `{ document }`.
- Output: `{ content: { files: [{ name, content }] }, rev, dropped }`. `dropped` is Violet's list
  (constraints now round-trip in `$extensions["dev.lushly.violet"].constraints`, #2330). It reports
  no `unexported`: that is
  `violet-node-list`'s, and an export changes nothing (F1). Scenario 11's `unexported: 0`
  becomes `rev: { exists: true }` when it moves (Q7).
- Errors: `OPERATION_NOT_ALLOWED` (an operation a file cannot hold), `INVALID_TOKEN_VALUE`,
  `VALIDATION_ERROR` (an invalid stored constraint a file cannot carry).
  Scenario 11.

### 6.6 `document-create` and coverage

`document-create` is the shell's: `{ type: 'violet-tree', template, title }` answers the record,
whose `id` the scenarios use. With `afd-default` it is scenario 14's start.

| Scenario | Tag | Commands |
| --- | --- | --- |
| 01 browse | slice | `document-create`, `violet-node-list`, `violet-token-resolve` |
| 02 find | | `violet-token-find` |
| 03 lineage | slice | `violet-token-lineage`, `violet-node-get` |
| 04 compare themes | slice | `violet-token-compare` |
| 05 preview first | slice | `violet-change-preview`, `violet-token-lineage`, `violet-change-apply` |
| 06 change and back | slice | `violet-token-override`, `violet-token-reset` |
| 07 preview a theme | slice | `violet-theme-preview`, `violet-token-override` |
| 08 contrast | slice | `violet-constraint-set`, `violet-violation-list`, `violet-token-override` |
| 09 interface | | `violet-interface-check`, `violet-token-add` |
| 10 export | slice | `violet-export` |
| 11 files in and out | slice | `violet-tree-import`, `violet-token-override`, `violet-tree-export` |
| 12 add a theme | | `violet-node-create`, `violet-token-compare`, `violet-node-delete` |
| 13 two trees | slice | `violet-token-override`, `violet-tree-compare` |
| 14 from the default | | `violet-interface-check` |
| 15 history | | `violet-token-override`, `violet-change-list` |

Every command is called by a scenario. What no scenario reaches is tested by port units (9.1):
`violet-node-list`'s `unexported`, `violet-tree-import`'s `exportedRev` (F1) and `metadata` on adds.

## 7. Screens and Specimen *(approved 2026-11-23, U1 to U6)*

At the `loam-design` skill's level: parts, layout classes, tokens and states; no markup. Before
any markup, the implementer calls `components-brief` once for the page with `consumer: "loam"`,
as `AGENTS.md` requires.

### 7.1 Parts

| Part | Holds |
| --- | --- |
| Rail | "Violet", `[ui.surfaces.rail] label = "Violet"`, `icon = "system/folder"` (U5), one entry for both scopes (D29) |
| Sidebar | None as a shell surface (U1): the open tree's nodes render as a left column inside `token-tree-editor`, each row showing its id's last segment, kind and customization count (`violet-node-list`); the selected row is the editor's selection |
| Main | With no tree open, `token-tree-main` lists the scope's trees (`documents.list({ type: 'violet-tree' })`) and points to New; apps do not create records (D82). With trees open, the editor area, each tab one `token-tree-editor` |
| Editor | Left node column (U1) plus five views over the selected node, chosen by a tab list drawn by the editor (U2): Tokens, Compare, Preview, Checks, History (7.3). A split is the editor area's own "open beside": one document in two groups, each its own view (documents specification, 5.7, "One model, any number of editors") |
| Files | In the editor's toolbar: **Import files**, a file input taking several `.tokens.json` files, read as text into `violet-tree-import { content: { files } }`, with `replace: true` and the `rev` of the last export made in this editor when the tree is not empty; and **Export files**, `violet-tree-export`, one download per file, named as the file *(U6)* |
| Inspector | `token-tree-inspector`, the document type's inspector: the selected token's lineage, its value field, and the change preview with Apply and Cancel (7.5) |
| Panel, status bar | Not used: a type declares no panel (`MANIFEST_SURFACE_UNAVAILABLE`), and the slice puts nothing in the status bar |

### 7.2 The node tree *(U1, approved)*

A `tree` sidebar's command takes `{}` and returns at most depth 8 and 2,000 items (scope and
projects specification, 7.4), so it cannot be handed the open document (F8). Three shapes were
evaluated; option 1 was approved on 2026-11-23:

1. **The node tree inside the editor** *(selected)*: a left column of `token-tree-editor`, with no
   app sidebar. One element owns selection; no new command.
2. **A custom sidebar** *(rejected)*: `shape = "custom"` drawing the active tab's nodes. `loam-tree`
   is not a kit element (`KIT_ELEMENT_NAMES_V1`), so it would draw `violet-tree` itself and load the
   `ref` chunk a second time, which `budget` refuses (`loam-design`, "The documents section").
3. **A `tree` sidebar of every tree and its nodes** *(rejected)*: over a new no-input query
   (`violet-tree-outline`), a twenty-third app command; selection then opens a document.

### 7.3 The editor's views

| View | Reads | Holds | States |
| --- | --- | --- | --- |
| Tokens | `violet-token-resolve`, `violet-node-get` | Resolved tokens: id, value with a swatch for colors, the node that set it; the node's own overrides marked by text ("Set here") and a mark, never by color alone | Empty tree; filter with no match; loading |
| Compare | `violet-token-compare`, `violet-tree-compare`, `documents.list` | Two to four nodes of this tree, or one node of another tree, as columns; differing cells marked by text and a mark; a summary line | Fewer than two nodes; the other tree gone (`DOCUMENT_NOT_FOUND`) |
| Preview | `violet-theme-preview` | The shared components (button, field, checkbox, select, badge) drawn in the node's values inside a scoped root; the refused list | Refused values present; nothing to draw |
| Files | `violet-tree-import`, `violet-tree-export` | The toolbar's Import and Export files (7.1) | A refused import (`OPERATION_NOT_ALLOWED`, naming Export first; `NODE_ALREADY_EXISTS`); a file Violet cannot read |
| Checks | `violet-violation-list`, `violet-interface-check` | Violations (pair, ratio, floor), unfilled (`missing`), type-incompatible (`invalid`) and private/global leaked (`leaked`, `#2295`) interface entries; each row selects its token | All clear; checks failing (including a tree with zero missing entries that fails on `invalid` or `leaked`) |
| History | `violet-change-list` | Changes: when, who, operation, old and new value, reason | No changes |

- **Swatches are content.** A swatch shows the tree's value and always its value as text; the
  chrome around it stays on contract tokens, and `lint:tokens` passes over the app's styles.
- **Compact** shows one view at a time; the others are a choice in the view list.

### 7.4 The scoped preview

The preview root is an element inside the editor's shadow root. The editor sets each
`properties[i]` with `root.style.setProperty(name, value)` (CSSOM, which `style-src 'self'`
allows) and clears what it set before setting a new node's. It never writes to
`document.documentElement`, never sets `data-loam-theme`, and never calls
`installVioletThemeSet`, which replaces the active theme set in every adopted runtime sheet (F7).
`refused` values are not set. A dark node previewed in a light Loam leaves every element outside
the root on Loam's light values; 7.6's scoped fixture proves it.

### 7.5 The inspector

- The selected token's lineage (`violet-token-lineage`) as an ordered list, root first.
- Its value field (`violet-text-field`), and for a color a swatch beside it.
- **The change preview.** An edit does not write: it adds the change to a pending list for the
  selected node and calls `violet-change-preview` with the whole list. The inspector shows
  `summary` (nodes changed, shielded, violations introduced, each as text) and Apply and Cancel.
  Apply calls `violet-change-apply` with the preview's `apply.input`; Cancel clears the list. A
  list longer than 50 changes refuses the 51st with the limit stated. *(The batching is U3.)*

### 7.6 Layout classes and Specimen

| Class | Shape |
| --- | --- |
| `expanded` (≥ 1024 px) | Editor's node column (U1), main view and inspector inline |
| `medium` (640 to 1023 px) | The inspector overlays main |
| `compact` (< 640 px) | The tab bar replaces the rail; inspector is a modal drawer; editor stacks/collapses the node column and shows one view at a time |

**The Specimen matrix** *(U4, approved)*: `app/specimens/specimen.config.json` declares one specimen per row and
its `Compact` twin, which sets the compact **density** (`data-loam-density`), not the compact
layout class; `test/specimen.test.ts` renders each with `createSpecimenBench({ root })` in
`light`, `dark` and `high-contrast` (`context: { theme }`, viewport 1280 by 800, reduced motion),
as `endpoints/loam/packages/web/test/browser/specimen.test.ts:242-257` does for `notes`.

| Specimen id | Surface | State shown |
| --- | --- | --- |
| `violet-tokens` | Editor, Tokens | `example/dark`, two own overrides selected |
| `violet-compare` | Editor, Compare | light, dark and high contrast, text colors |
| `violet-compare-trees` | Editor, Compare | `example/dark` against another tree's |
| `violet-preview` | Editor, Preview | `example/high-contrast` |
| `violet-preview-scoped` | Editor, Preview, in its shell frame | `example/dark` inside a Loam whose own theme is the context's (light in the light run) |
| `violet-checks` | Editor, Checks | One violation, three unfilled entries, one invalid entry and one leaked entry (plus a unit/fixture case with zero missing entries and one `leaked` entry) |
| `violet-history` | Editor, History | Three changes with reasons |
| `violet-sidebar` | Editor, node column (U1) | `example`'s four nodes, one selected |
| `violet-inspector` | Inspector | A token's lineage, a pending change and its preview |
| `violet-inspector-empty` | Inspector | Nothing selected |

That is 10 specimens, 20 with their compact twins, and 60 captures. The layout classes are the
shell's and need the shell, which the plugin's suite does not load (D109); `violet-tokens` and
`violet-inspector` are also captured at 800 and 500 px wide, where the editor's own one-view and
stacked rules apply, 12 more captures. The `medium` overlay and `compact` inspector drawer /
collapsed node column are checked by hand in 9.3. Each is **clean** when its console has no errors,
its ARIA snapshot is not empty and names the expected rows, and no `Context mismatch` is reported
(the `expectClean` rule of the web suite). `violet-preview-scoped` also asserts, by computed style,
that the shell frame's node column and inspector backgrounds equal Loam's `color.surface.card` for
the run's theme while the preview root's `--violet-color-surface-page` is `#121214`. Fixtures stub the
client as `notes`' do (`apps/notes/specimens/notes.specimens.ts`).

## 8. CI and the boundary

### 8.1 The D109 one-way check

D109: "a plugin may import Loam's SDK and test kit; Loam's core and its own suite load no real
plugin", and "the boundary check is due with the first plugin that has a TypeScript part"
(`endpoints/loam/docs/decisions.md:124`). This is that plugin. The check:

- **Rule.** No file outside `endpoints/loam/plugins/` imports a path under it or a package whose
  directory is under it, and no `package.json` outside it depends on one. Within
  `endpoints/loam/plugins/`, a plugin imports no other plugin.
- **Where.** `scripts/check-boundaries.mjs`, which `pnpm check:boundaries` runs, reading the
  plugin root from `architecture.json` (a new top-level key, `oneWay`, with `path` and `reason`),
  so the rule is declared where the layers are.
- **Proof.** A unit fixture that fails it: a file in `endpoints/loam/packages/` importing
  `@lushly-dev/loam-app-violet`, and a relative import into `endpoints/loam/plugins/violet/`
  (the `maintain-gates` rule: watch it fail).

### 8.2 `loam-plugins.yml` and `pnpm verify`

- **Triggers.** `push`, `pull_request` and the merge queue's paths gain every workspace package
  the app depends on, directly or transitively (derived from
  `pnpm -F "@lushly-dev/loam-app-violet..." ls --depth -1`): at `73f71572`,
  `endpoints/loam/packages/{cli,copilot,kernel,manifest,sdk,testing,theme}/**`,
  `foundations/fast-af/packages/**`, `foundations/specimen/**`, `foundations/violet/**`,
  `integrations/specimen-fast-af/**`, `integrations/violet-afd/**`,
  `packages/{auth,client,core,local-db,server,testing,view-state}/**` and `pnpm-lock.yaml`.
  Plugin docs stay excluded (except Mail's existing `docs/scenarios/**`). `ci.yml`'s `pnpm check`
  already runs the app's `build`, `typecheck` and `test` when a dependency changes, since the app
  is a workspace package; this job adds `test:specimen` and `pack`. A gate test verifies that a
  dependency-only change (for example under `packages/local-db/` or `packages/auth/`) triggers the
  `violet` gate.
- **Gate.** `scope` gains an output `violet` from `node scripts/affected.mjs gate --package
  @lushly-dev/loam-app-violet --path endpoints/loam/plugins/violet/ --except
  endpoints/loam/plugins/violet/docs/ --path .github/workflows/loam-plugins.yml`; `--package`
  opens it for a change in any of the package's workspace dependencies.
- **Job `violet`.** Install with the `.nvmrc` Node and `pnpm install --frozen-lockfile`; build
  `pnpm -F "@lushly-dev/loam-app-violet..." build`; then `typecheck`, `lint:tokens`, `test`
  (scenarios and units), `test:specimen` with Chromium installed, and `pack`.
- **Local.** `scripts/affected/suites.mjs`'s `loam-plugins.yml` entry gains `gate: 'violet'` steps
  with the same commands, so `pnpm verify` runs them. `scripts/affected.mjs:187-193` already
  supports per-step `tools?: string[]` (`step.tools ?? suite.tools`), and `chromium` is not in the
  preflighted `TOOLS` set (`scripts/affected.mjs:182-184`), so Mail's steps keep `tools: ['cargo']`
  and Violet's steps set `tools: []` so a machine without `cargo` can run them.
- **`loam.yml`** is unchanged: it already excludes `endpoints/loam/plugins/**`.
- **What the plugin imports from Loam.** D109 names the SDK and the test kit; the app also uses
  `loam-cli` (`app pack`, `readAppManifest`) and `loam-theme` (fixtures' CSS, the `afd-default`
  files), both as development dependencies. 8.1's check is one-way and does not limit them (Q13).

## 9. Verification plan

### 9.1 Exit criterion 1: every `slice` scenario passes

- **Harness.** `test/scenarios.test.ts` reads each file in `app/scenarios/` with
  `parseScenarioFile` (`@lushly-dev/afd-testing`), boots `createAppTestKernel({ manifest,
  definition, config: { interface: PINNED } })` per scenario, runs each step through
  `kernel.call(command, input)` after `resolveStepReferences`, and judges it with
  `evaluateResult`. Arrays of objects match in order and length (`runner/evaluator.ts:182-220`),
  so 5.6's orders are tested.
- **All fifteen run**; the ten tagged `slice` are exit criterion 1. Each scenario also ends with
  `replay()`, which must not throw (5.4).
- **Undo**, which scenarios cannot express: for every undoable mutation (excluding
  `violet-tree-import`, which advertises no undo), a unit runs the mutation, runs its `undoCommand`
  with `undoArgs`, and asserts `violet-tree-export`'s `files` and `violet-node-list`'s `root` and
  `nodes` equal those before, that `unexported` advanced by 2 (mutation + undo), and for
  `violet-constraint-set` that `constraints.list { includeInherited: false }` equals
  `previous` (alongside the exported files, which now carry constraints per #2330). Cases cover: an inherited override (reset), an
  own override, an add, a multi-change apply, a delete with `restore`, a constraint set (including
  a merged child rule set where the parent also has rules), the reset of a removed add, resetting a
  token with >50 historical overrides (collapsed to 1 inverse change), and undoing an edit on an
  imported composite/reference token value.
- **Port units** (`test/port.test.ts`): the store round trip (records out and in give equal
  exports); a seed built twice gives equal exports; the atomic import (a bad second file leaves the
  tree and `rev` as they were); the replacing-import guard (refused at `rev > syncedRev`, allowed
  with `exportedRev === rev`, and an additive import after an edit preserves `unexported > 0` so a
  subsequent replacing import without an export is still refused); blank-tree shell round trip
  (`document-export` -> `document-import` -> `data.next` with `files: []`); preview/apply parity
  (inherited-only reset and root-add reset fail or succeed identically in `violet-change-preview`
  and `violet-change-apply`, and `expectedRev` mismatch refuses stale apply); `violet-export`
  error codes (`TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE`, `NOT_IMPLEMENTED`) and node-only
  violation counts; the reset rule (no `reset` operation is ever stored, so an export after any
  undo succeeds); suggestion rewriting over every error each Violet command declares (asserting no
  dotted names, `violet call`, `--force`, `force: true` or `--schema`); metadata dropped;
  `APP_GRANT_MISSING` without `clock` or `random`; two kernels that reuse one document id with
  different templates, and with the same template and different edits, read their own trees (the
  cache key); a refused `store.put` leaves the next read on the stored tree; a query and a mutation
  on a seed build the same ids; an add with `metadata`, reset and undone, exports the same file;
  and `afd-default` against the bundled interface, every id filled in every theme node (scenario 14
  checks only the seven pinned ids).
- **Prerequisites** G1, G2, G9 and G10 merged in #1942: `export.tree`, `interface.check`, the
  context's `now()` and `random()`, `INVALID_TOKEN_VALUE`.

### 9.2 Exit criterion 2: Specimen fixtures render clean

`test:specimen` renders the twenty specimens of 7.6 in three themes, sixty captures, and the
twelve narrow captures, each clean
by 7.6's rule, with the scoped assertion; and axe over each, as `notes`' accessibility suite does.
It runs in the `violet` job, never in `loam.yml` (D109).

### 9.3 Exit criterion 4: the owner's desktop Loam

Phase 6's step 11 merged in #1337. The check is by hand, recorded in the feature's STATUS with
the date and the build:

1. Pack the app and write a desktop deployment naming the instance `violet` (`cli.ts:45, 58`):
   - `loam app pack endpoints/loam/plugins/violet/app --out <pack-dir>`
   - `loam deployment write --config <deployment.toml> --dist <web-dist> --out <out-dir> --host desktop`
2. In the desktop build: New → Token tree → AFD default tree; the five views open; Preview shows
   dark in a light Loam with the chrome unchanged.
3. Import Loam's seven files into a blank tree; override `color.surface.page` in `loam/dark`;
   export; the downloaded `loam_dark.tokens.json` differs from the repository's by one line (as
   #1974's test does in `theme.test.ts`).
4. Quit and reopen: the tree and its history are there (the desktop's store, a SQLite file the
   Rust host owns, D160).
5. At 800 px wide: the inspector overlays main. At 500 px wide: the tab bar replaces the rail, the
   inspector opens as a modal drawer, and `token-tree-editor` stacks/collapses its node column
   (U1) and shows one view at a time.
6. History growth measurement (Q12): apply a workload of 50 overrides on `afd-default`, record the
   serialized `VioletTreeContentV1` byte size in `STATUS.md`, and compare against the 1 MiB
   bounding threshold.

Files move by a file input and a download, which need no Loam grant *(unverified on the
desktop; if the webview refuses either, record it and file it against phase 6)*.

## 10. Decisions

**Answered 2026-11-23:** the owner accepted every UX recommendation (U1 to U6) and every technical
resolution (Q4 to Q13) as recommended.

**UX (`needs:ux`, approved 2026-11-23):**

1. **U1, the node tree's place:** left column inside `token-tree-editor`, no app sidebar (7.2, F21).
2. **U2, the five views as tabs in one editor:** tabs drawn by the editor itself (7.1, 7.3).
3. **U3, batching:** edits collect into one pending change until Apply, up to 50 changes (7.5).
4. **U4, the Specimen matrix:** 10 specimens, 20 with compact density twins, 60 theme captures plus
   12 narrow captures = 72 total (7.6).
5. **U5, the icon:** `system/folder` from `ICONS_V1` for slice 1 (3.2, 7.1).
6. **U6, files:** Import files and Export files in the editor's toolbar, one download per file (7.1).

**Technical (F-rows of section 1, accepted 2026-11-23):**

7. **Q4, the replacing-import guard:** by `rev` and `exportedRev` (F1).
8. **Q5, reset as removal:** `violet-token-reset` runs `token.remove` (F2).
9. **Q6, the `documents` grant:** declared for cross-tree comparison (F4).
10. **Q7, two scenario amendments when moving to `app/scenarios/`:** `size.focus-ring.width` in
    the `example` template and scenario 03 (F5), and scenario 11's export asserting `rev` rather
    than `unexported: 0` (F1).
11. **Q8, constraints in files (F9):** filed as post-slice follow-up
    [#2330](https://github.com/lushly-dev/afd/issues/2330) under #1556; not in slice 1.
12. **Q9, `restore: true` on `violet-node-create`:** accepted (F10).
13. **Q10, rule changes in the history (F14):** filed as post-slice follow-up
    [#2329](https://github.com/lushly-dev/afd/issues/2329) under #1556; not in slice 1.
14. **Q11, where `afd-default` lives (F18):** written into `loam-app.toml` by `templates:write`
    and guarded by `templates:check` for slice 1.
15. **Q12, history retention:** kept whole in slice 1 and measured in 9.3; bound when a tree nears
    1 MiB.
16. **Q13, D109's list:** D109's list applies to runtime dependencies; `loam-cli` and `loam-theme`
    are allowed as development dependencies.

## 11. Review

**2026-11-23, one independent reviewer** (Claude Opus 5.5, a fresh agent given only the files,
issue #2205 and the base `2e63c766`, reading the code; it ran no tests). Verdict: revise, with
five blockers, all fixed in this revision:

| Blocker | Fix |
| --- | --- |
| The cache keyed by document id and `rev`, which two test kernels reuse, so one scenario could read another's tree and a hit and a rebuild could leave different journals | Keyed by a digest of the stored content; seeds never cached; neither build draws the call's `random()` (5.2) |
| `blank`'s empty seed cannot go through `import.tree`, which needs one file | An empty seed, or no content, is an empty database (F17, 4.1, 5.2) |
| `app pack` does not inline a template's content from a path | `templates:write` writes `afd-default` into `loam-app.toml`, `templates:check` guards it (F18, Q11) |
| The undo of resetting an add lost the token's `$type` and category, and an add made in the app had none | `metadata` on adds and in the reset's undo (5.7, 6.3, 6.4) |
| No screen imported or exported files, so 9.3's check could not run | The Files row of 7.1 (U6) |

Improvements applied: every error list against the engine (`INVALID_PARENT`,
`DUPLICATE_CONSTRAINT_ID`, `CIRCULAR_REFERENCE`, the preview's staging codes) and rewrite rules for
the suggestions with no counterpart; the explicit re-sort of `interface.check`'s nodes; rollback by
throwing, and one call at a time per document (F19); content absent read as empty; one meaning of
`unexported`; `customizations` as distinct tokens; the preview of a reset dry-running `token.remove`;
`#` refused in node ids; the export `selector` restricted; CI triggers over every dependency, and
Chromium for the local suite; `violet-elements` as a development dependency, `engines.node`
`>=24`; density named as density, and narrow captures; a test of `afd-default` against the real
interface; the desktop store as SQLite (F20); the 7.4 reference; store quota and history growth
(Q12); D109's list (Q13). Praised: the F-table, reset as removal, the `rev` guard; the reviewer
walked scenarios 01 to 15 and found the others consistent with the contracts.

**A focused re-check the same day** (a fresh agent, scope: the five blockers) found blockers 2 to 5
resolved and the cache only partly: 5.4 still said "keyed by `rev`", and nothing said what a write
or a failed put does to the cache entry. Both fixed (5.2, 5.4), with its improvements: the seed in
an import without `replace`, the `templates:*` scripts, the reset's metadata read before removal,
a refused import's state, and a same-template two-kernel test.

**2026-11-23, two-model independent review after owner approval and base sync to `73f71572`**
(Gemini 4 Neon `high` + GPT-6.2 Astra `high`, both fresh read-only reviewers given the same brief
against `73f71572`, reading the code; neither ran tests). Both returned "revise"; every blocker
and improvement from both reviewers was applied:

- **Gemini 4 Neon `high` (3 blockers, 7 improvements):** renamed the three custom elements from
  `violet-*` to `token-tree-*` (F21: `loam-rules.ts:458-459` refuses `violet-*` with
  `MANIFEST_ELEMENT_INVALID`); unified preview/apply staging dry-run and root-add `reset -> subtract`
  translation; collapsed `violet-token-reset` undo to 1 change per token (staying within the 50-change
  cap); fixed `violet-change-list` (`audit.list` already parses JSON, unwrap `token_created`
  `newValue.value`, check `db.getNode(node)`), stripped `, or pass force: true` from `token.remove`
  suggestions, made `violet-export`'s `checks` node-only integer counts, dropped `rootId` from
  `violet-token-find`, allowed `parent: null` on `violet-node-create` and soft-deleted guard on
  `violet-constraint-set`, added `[config]` to the manifest snippet, noted `schema-fidelity.ts`
  forbids `"format": "date-time"`, re-sorted `leaked` by code point, and updated `suites.mjs`
  per-step `tools` and `validators.ts:318-319`.
- **GPT-6.2 Astra `high` (11 findings: 9 blockers, 2 improvements — 11 valid, 4 overlapping with
  Gemini 4 Neon, 7 unique, 0 noise):** fixed additive import preserving `syncedRev` on dirty trees;
  allowed `TokenValueSchema` values, local-only `constraints.list { includeInherited: false }` with
  <=50 merge cap, and collapsed reset undo; fixed the undo acceptance test to compare `root`/`nodes`
  and `files` rather than `unexported` and to check constraints directly; added `expectedRev` to
  `violet-change-apply` (populated by `violet-change-preview`); allowed `files: []` (`minItems: 0`)
  for blank-document round-trip; added `TOKEN_REFERENCE_NOT_FOUND`, `CIRCULAR_REFERENCE` and
  `NOT_IMPLEMENTED` to `violet-export`; fixed §9.3 CLI flags, U1 500 px check and Q12 1 MiB
  history measurement; expanded §8.2 CI trigger paths to the full transitive workspace graph;
  summed `effects.changes + added + removed` in `violet-change-preview`; carried `invalid` and
  `leaked` into Checks view & Specimen; and clarified base-verification vs landing wording in
  `STATUS.md` and `spec.md`.

**Focused re-check (2026-11-23, Gemini 4 Neon `high`, fresh read-only agent, scope: all 10 blockers):**
verdict "approve" — all 10 blockers verified resolved against `73f71572`; fixed the one non-blocking
anchor nit (`#10-open-questions` -> `#10-decisions`).
