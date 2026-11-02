# Phase 2 specification: documents

| Field | Value |
| --- | --- |
| Phase | 2, scope, projects and documents ([architecture section 9](../../architecture.md#9-phases)). This is the second of the phase's two specifications (D35); the [scope and projects specification](../2-scope-projects/spec.md) is the first, and holds what they share: first paint, scope, the stores' rules, the URL and the phase's order |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review; the phase 2 owning agent implements |
| Read first | The [scope and projects specification](../2-scope-projects/spec.md), then the [phase 1 specification](../1-app-contract/spec.md) and D23, D46 and D49 of the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-02 and revised the same day after an independent review (see [Review](#review-2026-11-02)). Awaiting the coordinator's approval. Nothing is implemented.
- **Last verified:** 2026-11-02 against `main` at `980cc1aa`. Evidence read beyond the [scope and projects specification's](../2-scope-projects/spec.md#status):
  - `endpoints/loam/packages/manifest/src/catalogs.ts:58-81`, `:145-151` (`documents`, `new`, `editor`, `embed` and `project-summary` served from 2);
  - `endpoints/loam/packages/manifest/src/refusal-map.ts:103-105`;
  - `endpoints/loam/packages/kernel/src/kernel.ts:58-59` (`UNJOURNALED_COMMANDS`), `:205-215` (`palette-search`), `palette-index.ts`;
  - `endpoints/loam/packages/kernel/src/apps/mounted.ts` (a mounted manifest has no surface but the rail, phase 1's 4.2);
  - `endpoints/loam/packages/chrome/src/apps/surfaces.ts:498` (`#enter`), `:850` (`#mount`), and `elements/mount.ts`, `view/view-frame.ts`, `view/channel.ts`;
  - `foundations/fast-af/packages/violet-elements/src/`: `tabs`, `tab`, `tab-panel`, `tree`, `tree-item`, `menu`, `popover`, `breadcrumb` and `listbox` exist;
  - `packages/view-state/src/registry.ts`; phase 0's specification, 8.2 (A4, A5).
- **Done:** this specification.
- **Not done:** every step of the [implementation plan](#15-implementation-plan).
- **Depends on:** steps 0a to 6 of the [phase's plan](../2-scope-projects/spec.md#16-implementation-plan).
- **Follow-ups:** see [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 2, apps are the unit; 3, everything is a command; 13, a deterministic core; 14, every mutation is an event; 17, documents are shell resources and types are contributions; 19, multiplayer is a shell service, only by its seam here.
- **Decisions:** D23, the document model; D35, this specification; D46, the binding; D49, the type kit's later place; D54, native trust; D61, view handlers.
- **New decisions:** D79 to D82, [below](#amendments).

## Terms

| Term | Meaning |
| --- | --- |
| Type | One entry of `ui.documents`: a document type, contributed by one plugin |
| Owning plugin | The instance whose manifest declares a document's type |
| Instance command | A type's command that takes a document id in the input property `document` |
| Group | A column of the editor area, with its own tabs |
| Tab | One document in one group. The same document may be open once in each group |
| Editor | A type's element or view, rendering one document in one tab |
| Editor owner | The owning plugin of the active tab, which the overlay rules treat as an active app |

## 1. Units and repository placement

No new package. The two apps are in the [units table](../2-scope-projects/spec.md#1-units-and-repository-placement). The code is:

| Directory | What | Loads |
| --- | --- | --- |
| `kernel/src/late/documents.ts`, `editor-state.ts`, `links.ts` | The commands, the editor's state and validator, the index | Stage B, in the `late` chunk |
| `chrome/src/editor/` | `loam-editor-area`, `loam-editor-group`, `loam-editor-frame`, `loam-embed` | `editor` chunk, on the first document opened, restored or routed to |
| `chrome/src/sections/documents.ts` | `loam-documents-section`, and `loam-tree` | `documents` chunk |
| `chrome/src/new/` | `loam-new-menu` | `new` chunk, on first press of `loam-new-button`, which is in first paint |

**No file in `kernel`, `chrome` or `web/src` names `notes` or `checklist`:** a unit test scans for them, as phase 1's E5 does for `tally`.

## 2. The document type registry

### 2.1 The contribution (D23)

Under `ui.documents` in a [version 2 manifest](../2-scope-projects/spec.md#8-the-manifest-version-2-d76), for `native` and `view` plugins. **A `mounted` plugin declares none in phase 2:** `MANIFEST_SURFACE_KIND`, naming phase 5, because a mounted editor would be a `ui://` resource from the server, which phase 1's D61 leaves to phase 5, and a mounted instance's commands are unknown until discovery. D23's "any plugin" holds for the two kinds that have an editor today, and mounted joins with its views.

```toml
manifest_version = 2

[plugin]
id = "notes"
kind = "native"
domains = ["notes"]

[app]
scope_levels = ["workspace", "project"]

[[grants]]
name = "store"
reason = "Keeps each note's text."

[[ui.documents]]
id = "notes"                       # the type: the plugin's id, or `<plugin id>-<name>`
title = "Note"
icon = "system/document"
content_schema = "schemas/note.content.json"
content_version = 1
autosave_ms = 2000                 # omitted: the type saves when told
instance_commands = ["notes-content-get", "notes-content-set"]
export_command = "notes-export"    # optional
import_command = "notes-import"    # optional
scope_levels = ["workspace", "project"]   # optional; a subset of `app.scope_levels`

[ui.documents.editor]
element = "notes-editor"           # native. A view has `resource = "ui://checklist/editor"`

[ui.documents.embed]
element = "notes-embed"            # optional. A view has `resource`

[ui.documents.inspector]
element = "notes-inspector"        # optional, native only

[ui.documents.binding]
model = "command"
selection = "text-range"
locator = "text-range"
conflict = "last-writer-wins"

[[ui.documents.templates]]
id = "blank"
title = "Blank note"
content = { text = "" }
```

| Key | Rule | Refusal |
| --- | --- | --- |
| `id` | `^[a-z][a-z0-9]{0,31}(-[a-z][a-z0-9]{0,31})?$`, whose first part is `plugin.id`. Unique in the manifest | `DOCUMENT_TYPE_ID_INVALID` |
| `title`, `icon` | As `rail`'s; `icon` from `ICONS_V1` | `MANIFEST_INVALID` |
| `content_schema` | A path or an object, inlined by `app pack` as other schemas are; the rule `input-schema`'s checks | `MANIFEST_INPUT_SCHEMA_INVALID` |
| `content_version` | An integer from 1 | `MANIFEST_INVALID` |
| `autosave_ms` | 200 to 60,000 | `MANIFEST_INVALID` |
| `instance_commands` | Each a declared command, whose input schema has a required string property `document` | `DOCUMENT_COMMAND_INVALID` |
| `export_command`, `import_command` | Each declared. `export_command` is an instance command with `effects = ["inspect"]`, and returns `{ content: unknown }`; `import_command` takes `{ document, content }` | `DOCUMENT_COMMAND_INVALID` |
| `scope_levels` | A subset of `app.scope_levels`, default all of them | `DOCUMENT_SCOPE_INVALID` |
| `editor` | Required. Native: `element`. View: `resource`, in `ui.resources` | `MANIFEST_SURFACE_KIND`, `MANIFEST_RESOURCE_UNKNOWN`, `MANIFEST_ELEMENT_INVALID` |
| `embed` | Optional, the same shape | The same |
| `inspector` | Optional, native only: a view's inspector needs a second sandboxed frame, which nothing asks for yet | `MANIFEST_SURFACE_KIND` |
| `binding` | Required ([3.1](#31-the-binding-d46)) | `MANIFEST_DOCUMENT_BINDING` |
| `templates` | At least 1, unique `id`, at most 20; `content` is checked against `content_schema` by `app check` and `app pack` with `z.fromJSONSchema` | `DOCUMENT_TEMPLATE_INVALID` |
| A type with no `store` grant | Its content has nowhere to live | `GRANT_REQUIRED` |

**`panel`.** D23 and the catalog name it as an optional surface. No type here needs one, so `ui.documents[].panel` is `MANIFEST_SURFACE_UNAVAILABLE`, saying a later version adds it when a type asks. Principle 18's "built as needed" holds.

`ui.new`, beside them:

```toml
[[ui.new]]
title = "Task"
icon = "system/checkmark"
command = "tasks-add-blank"       # declared, needing no input
scope_levels = ["project"]        # optional; default `app.scope_levels`
```

`MANIFEST_COMMAND_UNKNOWN` and `MANIFEST_COMMAND_NEEDS_INPUT`. Mutations are allowed. A creator's command is an ordinary call at the active scope.

### 2.2 The registry

`DocumentTypesV1`, in `kernel/src/late/documents.ts`, built in stage B from every admitted app's manifest.

- **Conflict.** Two plugins with one type id is `DOCUMENT_TYPE_CONFLICT`: the later app in deployment order keeps its other contributions, and that type is reported in `app-get`'s `notices`, as a keybinding's conflict is (D66). The id's first part is the plugin's, so this takes two instances of one package, which phase 1 allows only for `mounted`. It stays, for what a later kind brings.
- **A refused or failed app's** types are not registered. A document of one shows `DOCUMENT_TYPE_UNAVAILABLE` where it opens, and its record stays.
- **A disabled instance** is the same.
- **`document-type-list`** returns `DocumentTypeV1[]`:

  ```ts
  export interface DocumentTypeV1 {
  	id: string; title: string; icon: string; instance: string; app: string;
  	scopeLevels: Array<'workspace' | 'project'>;
  	contentVersion: number;
  	templates: Array<{ id: string; title: string }>;
  	surfaces: Array<'editor' | 'embed' | 'inspector'>;
  	binding: BindingV1;
  	instanceCommands: string[];
  	editorKind: 'native' | 'view';
  }
  ```

  It holds no content. A template's `content` is read by `document-create`, in the kernel.

## 3. The document record

Table `document`, keyed by `id`:

```ts
export interface DocumentRecordV1 {
	id: string;                  // `doc_` and 12 characters, from the command's random
	workspace: string;
	type: string;
	instance: string;            // the owning plugin when created
	title: string;               // 1 to 200 characters
	scope: ScopeV1;              // exactly one scope (architecture section 7)
	scopeKey: string;            // `w` or `p:<project>`, for `queryRows`
	owner: string;               // the actor's id, or 'local'
	tags: string[];              // at most 20, each 1 to 40
	status: 'active' | 'archived' | 'trashed';
	trashedAt: number | null;
	contentVersion: number;      // the type's, when written last
	binding: BindingV1;          // copied from the type when created (D46)
	epoch: number;               // 0. Reserved: raised when it moves between projects; the collaboration service reads it
	createdAt: number;
	updatedAt: number;
	createdBy: string;
	updatedBy: string;
}
```

- **Content is the type's.** It lives in the owning plugin's `store` under the document's scope, at key `documentContentKey(id)`, exported from the SDK as `doc/<id>`, under the type's schema (architecture section 5). **The shell never reads it**, but for one write: `document-create` puts the template's `content` there, and `document-move`, which moves the row whole and does not read inside it.
- **`updatedAt` and `updatedBy`.** An instance command that is a mutation sets them, in the middleware, after it succeeds. So `document-list`'s recents are right however the content changes.
- **`contentVersion`.** A type that raises `content_version` migrates in its own commands: the record says what was last written, and `DOCUMENT_CONTENT_VERSION_NEWER` is shown when a record's is above the type's, as the editor's first failure mode, and never overwrites.

### 3.1 The binding (D46)

D46: "bound by a contract every document type declares from phase 2." So it is required, and on the record:

```ts
export interface BindingV1 {
	/** `crdt` is refused until the collaboration specification chooses a library (W28). */
	model: 'command';
	selection: 'none' | 'text-range' | 'item';
	locator: 'none' | 'text-range' | 'item';
	/** Per-property last-writer-wins is D46's default, and the only value until that specification. */
	conflict: 'last-writer-wins';
}
```

- A `crdt` model is `BINDING_MODEL_UNAVAILABLE`, naming the collaboration specification.
- **`selection`'s shapes.** `text-range`: `{ kind: 'text-range'; start: number; end: number }`, in UTF-16 units. `item`: `{ kind: 'item'; id: string }`. `none`: `null`. What an editor reports must match, which `editor-selection-set` checks ([5.4](#54-the-commands)).
- **`locator`** names the form later threads anchor to. Nothing reads it in phase 2.

## 4. The instance store

### 4.1 Commands

All `SHELL_EXPOSE`, late commands, unless a row says otherwise. Every one that names a document runs the resource check first ([4.2](#42-the-check-on-every-document-command)).

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `document-type-list` | query | `{ all?: boolean }` | `{ types: DocumentTypeV1[] }`, those the active scope allows, or every type with `all` |
| `new-list` | query | `{}` | `{ items: NewItemV1[] }`, [section 7](#7-new) |
| `document-create` | mutation | `{ type; template?; title?; project?: string \| null }`. `project` defaults to the call's scope; a named project runs `decideAccess` first, and an archived one is `PROJECT_ARCHIVED`; a type that does not support the level is `DOCUMENT_SCOPE_UNSUPPORTED` | `DocumentRecordV1`, with `undoCommand: 'document-trash'` |
| `document-get` | query | `{ document }` | `DocumentRecordV1` |
| `document-list` | query | `{ type?; status?: 'active' \| 'archived' \| 'trashed'; project?: string \| null \| 'all'; tag?; query?: string (1 to 200); sort?: 'recent' \| 'title'; limit?: 1 to 200; offset? }`. Default: active, in the active scope, recent, 50 | `{ documents: DocumentRecordV1[], total }`, only what `decideAccess` allows. `query` matches the title, case-folded. `project: 'all'` spans the projects the actor may enter |
| `document-rename` | mutation | `{ document; title }` | The record. Undo restores |
| `document-update` | mutation | `{ document; tags?; status?: 'active' \| 'archived' }` | The record. Undo restores |
| `document-move` | mutation | `{ document; project: string \| null }` | The record. Undo moves back |
| `document-trash` | mutation | `{ document }` | The record. Undo: `document-restore`. Its tabs close, as `app-switch` closes a surface, with no save |
| `document-restore` | mutation | `{ document }` | The record. Undo: `document-trash` |
| `document-open` | mutation | `{ document; group?: 'active' \| 'beside'; preview?: boolean }` | [5.4](#54-the-commands) |
| `document-export` | query | `{ document }` | The envelope below |
| `document-import` | mutation | `{ type; envelope; title?; project? }`, the envelope bounded as [4.4](#44-limits) bounds an instance command's input | The new record, undo `document-trash` |
| `document-link-add`, `document-link-remove`, `document-link-list` | | | [Section 9](#9-references) |

Names reserved and **not registered**, so no app can take them: `document-apply-update`, `document-share`, `document-share-revoke`. `SHELL_DOMAINS_V1` holds `document`, `presence` and `thread`, so they are safe. They arrive with the [collaboration specification](#13-collaboration-the-seam-and-nothing-more).

- **`document-create`.** Writes the record and the template's content through one `adapter.batch`, so neither lands alone. `title` defaults to the template's. A type with no template named uses the first. It does not open the document; the New menu then calls `document-open`, so an agent can create without changing the screen.
- **`document-move`** is the architecture's move. It needs `decideAccess` on both scopes, refuses an archived target with `PROJECT_ARCHIVED`, moves the content row's id and `scope` in one `batch`, raises `epoch` by one, leaves references alone, and closes the document's tabs in the old scope's editor state. A type not supporting the target's level is `DOCUMENT_SCOPE_UNSUPPORTED`.
- **Trash.** `document-trash` sets `status`, `trashedAt` and leaves everything else. The boot-only command `document-trash-expire { before }` ([stage B](../2-scope-projects/spec.md#22-two-stages-d69)) runs when any record's `trashedAt` is older than the workspace's `trashDays`, and deletes the record, its content and its links, by `batch`, journaled. With nothing to do, nothing runs or is journaled. No person, app or agent can call it.
- **Export and import.** `document-export` calls the type's `export_command` as a nested query, and answers `{ loam_document: 1, type, content_version, title, tags, content }`. With no `export_command`, `DOCUMENT_EXPORT_UNAVAILABLE`, as the shell never reads content. `document-import` is the same envelope: `document-create` with no template, then `import_command`, called by the chrome and the agent's client. A nested mutation is refused by D68, so `document-import` itself is not an outer handler: it creates the record, with no content, and `data.next` says `{ command: import_command, input: { document, content } }`. The Documents section runs it. `DOCUMENT_IMPORT_VERSION_NEWER` for an envelope newer than the type.

### 4.2 The check on every document command

For a command with a `document` input, a shell command or an instance command, after [lines 1 to 4](../2-scope-projects/spec.md#34-the-order-of-a-call-d72) of a call and at its line 5, reading the `ProjectCache` and one row:

| Case | Answer |
| --- | --- |
| No such record | `DOCUMENT_NOT_FOUND` |
| Its scope's project is one `decideAccess` refuses for this actor | `DOCUMENT_NOT_FOUND`, with the same bytes |
| Its scope is not the call's effective scope, and the command is not `document-get`, `document-open`, `document-list`, `document-link-*`, `document-trash`, `document-restore` or `document-move` | **`SCOPE_MISMATCH`**: `` `Roadmap` is in the project Beacon, not Atlas ``, with `` Switch with scope-set { project: "beacon" } and run this again. `` A document at workspace level says `the workspace` and `scope-set { project: null }` |
| `status: 'trashed'`, and the command is a mutation other than `document-restore` or `document-trash` | `DOCUMENT_TRASHED`, naming `document-restore` |
| An instance command of another type than the record's | `DOCUMENT_TYPE_MISMATCH` |
| Otherwise | The call runs, and for an instance command the `KernelEventV2` carries `document` |

**The commands exempted can name across projects:** `document-get` and `document-list` because the actor may read there, the rest because they state a target. `decideAccess` still ran on the document's own project. A person seeing a document found through `document-list project: 'all'` opens it with `document-open`, which changes the scope first: see below. **So "a mutation naming a resource in another project is refused after the access decision" holds for every content change, by the instance commands, and for `document-rename` and `document-update`, the shell's.**

**`document-open`'s scope.** A document in another scope, of a project the actor may enter, runs `scope-set` to it first, in the same command, and that switch's rules ([4.3 of the first specification](../2-scope-projects/spec.md#43-the-project-store)) apply: the app may be left. The result says `scope: { from, to }`.

**Through an app's port, none of that widens.** "An app never chooses a project" ([3.2](../2-scope-projects/spec.md#32-the-field)), so with `fields.caller` set: a document outside the call's effective scope is `SCOPE_NOT_GRANTED` for `document-get`, `document-open` and `document-link-list`, whatever the table above exempts; `document-list`'s `project` may only be the call's level, so `project: 'all'` is refused the same way; and `document-open` never runs `scope-set`. So a sandboxed view in Atlas cannot read Beacon's titles. The exemptions are for a person's and an agent's calls.

**Named targets.** Every `project` a command names runs `decideAccess` first, and a refusal is `PROJECT_NOT_FOUND`. `document-link-remove`'s `link` is read, then `decideAccess` runs on both its documents' scopes, and either refusal is `DOCUMENT_NOT_FOUND`, the same bytes as a missing id. A trashed document may be read, restored, or named as a link's target. A document in an archived project may be read, and its mutations are `PROJECT_ARCHIVED`.

### 4.3 The documents grant

[Section 11](#11-the-documents-grant).

### 4.4 Limits

**This path's own, leaving [#710](https://github.com/lushly-dev/afd/issues/710) for the rest.** A document's content travels as a command's input, which is journaled whole, and every save writes a copy of it.

- **An instance command's input** over 256 KiB of JSON is refused with `DOCUMENT_CONTENT_TOO_LARGE`, in the middleware, before the handler, as discovery's 200 KiB catalog bounds its own path (9.9). It is journaled, with the input left out by `redact`, so a refused save does not itself store what it refused. Its suggestion names the type's owner. A type whose documents grow past that waits for the collaboration service's deltas.
- **Retention is not settled here.** A `notes-content-set` journals the whole text, and a journal has no retention (#710). So **the journal grows by a note's size per save,** which `notes` limits by autosaving no faster than every 2,000 ms, and D10 measures and records for a 10,000-character note edited for a minute. Truncating an entry's input was rejected: replay could then not re-run it, every later read of that document would differ, and "a replayed journal reproduces the session" would stop holding for documents. #710 owns the answer, which is likely snapshots or deltas.

### 4.5 Failure modes and error codes

Every code has a suggestion and joins `LoamKernelErrorCode` or the manifest's refusals. Each row is covered by a unit test or an exit test. A manifest's refusals are in [2.1](#21-the-contribution-d23).

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `DOCUMENT_NOT_FOUND` | [4.2](#42-the-check-on-every-document-command): none, or not allowed. One message for both | A failure, journaled | `document-list` |
| `DOCUMENT_TRASHED` | A mutation of a trashed document | A failure, journaled | `document-restore` |
| `DOCUMENT_TYPE_MISMATCH` | An instance command of another type | A failure, journaled | `document-get`'s `type` |
| `DOCUMENT_TYPE_UNAVAILABLE` | The owning plugin is refused, failed, disabled or gone | A failure, and shown in the tab; the record stays | `app-list`, or redeploy it |
| `DOCUMENT_TYPE_CONFLICT` | [2.2](#22-the-registry) | A notice on the later app; that type is unregistered | Rename the type |
| `DOCUMENT_TEMPLATE_UNKNOWN` | `document-create` names a template the type lacks | A failure | `document-type-list` |
| `DOCUMENT_SCOPE_UNSUPPORTED` | A type at a level it does not support, on create, move or import | A failure, journaled | The levels it supports |
| `DOCUMENT_CONTENT_TOO_LARGE` | [4.4](#44-limits) | A failure, journaled without the input | Report to the type's owner |
| `DOCUMENT_CONTENT_VERSION_NEWER` | A record's `contentVersion` above its type's | Shown in the tab, and nothing is overwritten | Update the app |
| `DOCUMENT_EXPORT_UNAVAILABLE`, `DOCUMENT_IMPORT_UNAVAILABLE`, `DOCUMENT_IMPORT_VERSION_NEWER` | [4.1](#41-commands) | A failure | Per row |
| `DOCUMENT_OPEN_NOT_ACTIVE` | [Section 11](#11-the-documents-grant) | A failure, journaled | Open it from the active app |
| `EDITOR_TAB_UNKNOWN`, `EDITOR_TAB_DIRTY`, `EDITOR_SELECTION_INVALID` | [5.4](#54-the-commands) | A failure | Per row |
| `EMBED_READ_ONLY`, `EMBED_DEPTH_EXCEEDED` | [9.2](#92-embed) | A failure, journaled through `app-embed-refuse`; depth is shown in place | An embed reads |
| `BINDING_MODEL_UNAVAILABLE` | [3.1](#31-the-binding-d46) | The package is refused | Use `command` until the collaboration specification |

## 5. The editor area

### 5.1 Where it shows (D80)

"The main part when documents are open." Main has one owner at a time:

| `loam.apps` | Main shows |
| --- | --- |
| `active` is set | The app's stage. Tabs stay in state, unseen ("Tabs stay; the active editor changes") |
| `section` is `documents`, and the scope's editor state has tabs | The editor area |
| `section` is `documents`, with no tabs | The documents section's list |
| `section` is `projects` | The projects section |
| Neither | The landing |

- **`document-open`** sets `section: 'documents'`, clearing `active`, as `section-open` does. A person returns to an app from the rail, and to documents from Documents.
- **The Documents rail entry** runs `section-open { section: 'documents' }`. It shows `aria-current` with the area or the list, and a small count when tabs are open.
- **The URL** is `/<ws>[/p/<slug>]/~/documents/<document id>` for the active tab of the active group, and `/~/documents` for the list. Activating a tab moves it with `history: 'replace'`, opening one with `push`. A deep link runs `document-open`. A link to a document in another scope is that scope's URL, so a person cannot reach the mismatch; an agent can, and gets `document-open`'s switch.
- **Per scope.** The state is `loam.editor` at workspace level, and `loam.editor@<project id>` in a project, by the same suffix as layouts, so a switch swaps the whole area and nothing of Atlas stays on screen under Beacon. First entry to a scope registers its record and `hydrateOne`s it.
- **Layout.** `loam.layout.~documents`, with `sidebar` declared, and `inspector` declared when the active tab's type has one. Toggling tabs recomputes `declared` as phase 1's records do.

### 5.2 State, version 1

`kernel/src/late/editor-state.ts`, a view-state handler per scope, through one validator, as `loam.layout` is:

```ts
export interface EditorTabV1 {
	id: string;            // `t<n>`, from `nextTab`
	document: string;
	pinned: boolean;
	preview: boolean;
}
export interface EditorGroupV1 {
	id: string;            // `g<n>`, from `nextGroup`
	tabs: EditorTabV1[];   // at most 50
	active: string | null;
}
export interface EditorStateV1 {
	version: 1;
	groups: EditorGroupV1[];  // 1 to 3, in order, as columns
	activeGroup: string;
	nextTab: number;
	nextGroup: number;
}
```

- **Invariants** `validateEditorState` holds: a group's `active` is one of its tabs, or null when it has none; at most one `preview` tab per group; a `pinned` tab is not `preview`; pinned tabs lead; at most one tab per document per group; a group with no tabs is removed unless it is the only one. A persisted record that fails is ignored, as an invalid layout is, and an empty state replaces it.
- **Dirty** is not here. It is per tab, in memory, in the kernel: `DirtyTabsV1`, a `Map`, read by `editor-get`, lost on reload as an unsaved change is ([5.5](#55-saving)), and cleared by `resetSession`, so `EDITOR_TAB_DIRTY` replays the same across a reload. So nothing persists a claim that cannot be true.
- **Splits are columns, of equal width, up to three.** Enough for "side by side". Sizes, rows and drag are follow-ups.
- **The compact class** shows only the active group, and its tab strip scrolls. The chrome hides `Open beside` there. An agent's `group: 'beside'` still changes the state, which stays valid, and a wider window shows it.

### 5.3 Preview and pinned

As VS Code's: a single press in the tree or list opens with `preview: true`; a second, Enter on the tree item, or a first edit promotes it. A preview tab is replaced by the next preview in that group. A pinned tab cannot be replaced by anything and is not closed by `Close others`, and stays with `editor-close { tab }` if the person names it. Its title is italic only with a text label too, `(preview)` in its accessible name.

### 5.4 The commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `document-open` | mutation | `{ document; group?: 'active' \| 'beside'; preview?: boolean }` | `{ tab, group, scope?: { from; to } }`. Undo: `editor-close` of that tab. `beside` puts it in the next group, creating one up to 3, and then uses the last |
| `editor-get` | query | `{}` | `EditorStateV1`, with `dirty` per tab |
| `editor-activate` | mutation | `{ tab }` | `{ tab, previous }`. Undo restores |
| `editor-close` | mutation | `{ tab; discard?: boolean }` | `{ closed, previous }`. A dirty tab with no `discard` is `EDITOR_TAB_DIRTY`: its suggestion names the type's save and `discard: true`, and the chrome asks first ([5.5](#55-saving)). Undo: `document-open` |
| `editor-pin` | mutation | `{ tab; pinned: boolean }` | `{ tab, pinned }`. Undo restores |
| `editor-move` | mutation | `{ tab; group: string \| 'new' }` | `{ tab, group }`. `EDITOR_TAB_UNKNOWN` |
| `editor-dirty-set` | mutation | `{ tab; dirty: boolean }` | `{ tab, dirty }`. Its port rule: only the tab's owning plugin, or the chrome |
| `editor-selection-set` | **query, unjournaled** | `{ tab; selection }` | `{ tab }`. Held in memory for the inspector. It joins `UNJOURNALED_COMMANDS`, since it runs per keystroke as `palette-search` does, changes nothing a replay reproduces, and is `mutation: false`. `EDITOR_SELECTION_INVALID` for a shape off the binding's |

All are late commands, and all may be run by an agent: `document-open` is how the copilot opens one. An app calls them through a port only with `documents` granted, and `editor-*` other than `editor-get` from its own editor's tab.

**Overlay rules.** The active tab's owning plugin is the **editor owner**. Section 8's rule on `modal-open`, "from an app that is not active", accepts the editor owner too. Leaving the documents section, or a tab of another plugin becoming active, follows section 8 as an app switch for that plugin. `palette-search` shows shell commands and the commands of the active app or the editor owner, with the document's `instance_commands` first ("filtered by active app, document and scope").

### 5.5 Saving

- **The hook.** An editor's `save()` writes through its own commands. **The shell has no save command:** a type's instance commands are what write, and an agent saves by calling them.
- **`autosave_ms`.** `editor-dirty-set { dirty: true }` starts the chrome's timer, which calls `save()` when it ends. Every further edit restarts it. With none, Mod+S calls it. **Mod+S is a new kind of binding,** `{ chord: 'Mod+S', save: true }`, since `ShellKeybindingV0` holds a `command` or `focus` (`keybindings.ts:7-18`) and the shell has no save command; it joins `SHELL_RESERVED_CHORDS_V1` and `SHELL_KEYBINDINGS_V0` together, whose test holds them equal. `keybindingFor` skips it. The chrome calls `preventDefault` only when an editor is the active owner, and Mod+S with a type that saves itself still flushes it.
- **Closing a dirty tab.** The chrome calls `save()` first when the type autosaves. When it does not, or `save()` rejects, it opens a phase 1 modal: `Close without saving?`, confirm `Discard`, `danger`, cancel `Keep editing`. Three buttons wait for phase 4.
- **Reload and `pagehide`.** The chrome calls `save()` of every dirty editor on `pagehide`, without waiting, as it flushes view-state, and #660's loss applies to it. An edit lost so is what a type accepts by choosing a long `autosave_ms`.
- **`save()` failing.** The tab stays dirty, and the failure is a `danger` toast, with its code and suggestion, as a surface's command failing is (9.6).

### 5.6 The editor contract

**Native.** `loam-editor-frame` activates the plugin if it has not been ([phase 1's 5.5](../1-app-contract/spec.md#55-lifecycle), which runs with no rail entry too), creates a `loam-mount` with the plugin's registry, and in it the type's `element`:

```ts
// @lushly-dev/loam-sdk
export interface DocumentRefV1 {
	readonly id: string; readonly type: string; readonly title: string;
	readonly scope: ScopeV1; readonly contentVersion: number;
	readonly binding: BindingV1;
	/** True in an embed. */
	readonly readOnly: boolean;
}
export interface DocumentChangeV1 { readonly document: string; readonly command: string; readonly seq?: number }

/** Assigned before it connects. Every hook is optional, and all are called by the shell. */
export interface LoamEditorElementV1 extends LoamSurfaceElementV1 {
	document?: DocumentRefV1;
	/** Write through the type's own commands. Rejecting keeps the tab dirty. */
	save?(): Promise<void>;
	/** Called before the element is dropped. Not given a time limit. */
	dispose?(): void | Promise<void>;
	/** Another call changed this document: re-read it. Called on every open editor of it, this one's own calls included (5.7). */
	documentChanged?(change: DocumentChangeV1): void;
}

/** What an editor dispatches, bubbling and composed, from its element. */
export const EDITOR_DIRTY_EVENT = 'loam-editor-dirty';        // detail: { dirty: boolean }
export const EDITOR_SELECTION_EVENT = 'loam-editor-selection'; // detail: the selection, or null
export function documentContentKey(document: string): string;
```

`loam-editor-frame` hears them and calls `editor-dirty-set` and `editor-selection-set`, the first on a change only. `context.client`, in an editor, calls at the document's scope. `selection` and `selectionLevel` do not apply.

**The chrome's way in.** `loam-editor-frame` uses `AppSurfaces.host()` ([2.2](../2-scope-projects/spec.md#22-two-stages-d69)) for `ensureActivated` and `createMount`.

**View.** `loam-editor-frame` makes a `loam-view-frame` of `editor.resource`, through a `DocumentViewSource`, the seam of phase 1's section 13, and the same proxy, sandbox and CSP as 6.1. The profile is unchanged, and adds, all `dev.loam/`, as the profile leaves open:

| Direction | Method | Rule |
| --- | --- | --- |
| In `hostContext` | `dev.loam/document` | `DocumentRefV1`, and `host-context-changed` when its title changes |
| View → host | `dev.loam/editor-dirty` (notification) | `{ dirty: boolean }` |
| View → host | `dev.loam/editor-selection` (notification) | The selection |
| Host → view | `dev.loam/editor-save` (request) | Answered when saved. Unanswered in 10 seconds is a failure, as above |
| Host → view | `dev.loam/document-changed` (notification) | `DocumentChangeV1` |

`@lushly-dev/loam-sdk/view`'s `connectView` gains `onSave`, `onDocumentChanged`, `reportDirty` and `reportSelection`, and the kernel's broker holds `tools/call` to the document's scope, as the port does. **A view's editor is torn down with its tab hidden, since a frame cannot be moved or parked,** after `dev.loam/editor-save`, with the same 500 ms as a teardown, and rebuilt when its tab is shown. **A native editor is parked,** by the phase 1 mechanism that parks a sidebar, up to 10 per group, oldest dropped through `dispose`. So a split of two view editors holds two frames on one sandbox origin, which 6.1 allows, each opaque.

### 5.7 One model, any number of editors

"One model per instance, any number of editors." **The model is behind the type's commands, in the store. No editor holds it.**

- When an instance command that is a mutation succeeds, from anyone, `KernelEventV2.document` is set. The chrome calls `documentChanged` on every open editor of that document, in any group, with its `seq`. So an agent's edit, a second tab's and an undo reach all.
- An editor that made the call hears it too, re-reads, and finds nothing new. A native `notes-editor` keeps its caret by comparing the text first. Phase 1's 9.6 has a native app's elements hearing their own handlers through a listener; this is the shell's version, for every kind.
- **What a type does between keystrokes and a save is its own.** `notes` holds its draft in the element until `save()`, and with two editors open a draft shows in the other after that save. Live typing across editors is collaboration's.
- **A trashed or moved document** closes its tabs: `documentChanged` is not called, and `dispose` is.

### 5.8 The elements

Each under the checklist, with a `design.md` line and a Specimen fixture.

| Element | What |
| --- | --- |
| `loam-editor-area` | Main's `region` "Documents": the groups as columns, one F6 stop. The page's `h1` is the active document's title, visually hidden, so an editor needs no `h1` |
| `loam-editor-group` | A hand-written `role="tablist"`, not `violet-tabs`, whose fixed trigger and panel pairing does not fit a closable tab. Each tab is a `button` with `role="tab"`, with its icon, title and dirty mark (`●` and "unsaved" in its name), and **its close and menu buttons are siblings of it,** since an interactive child of a `tab` fails axe's `nested-interactive`, with `tabindex="-1"`; `Delete` on a focused tab closes it. Arrow keys move, as `tablist` has it, and one tab panel shows. The menu: Pin, Close, Close others, Open beside, Move to a new group |
| `loam-editor-frame` | One tab's mount or view frame, with loading and failed states: `DOCUMENT_NOT_FOUND`, `DOCUMENT_TYPE_UNAVAILABLE`, `DOCUMENT_CONTENT_VERSION_NEWER` and `APP_ACTIVATION_FAILED` each as a `loam-notice` body, with Close |
| `loam-embed` | [9.2](#92-embed) |
| `loam-new-button`, `loam-new-menu` | [Section 7](#7-new) |
| `loam-documents-section` | [Section 8](#8-the-documents-section) |

**A deep DOM's focus.** A tab's activation moves focus to the editor's element when the person pressed in the strip with Enter, and leaves it in the strip for arrows, as a tablist has it. Tab from the strip enters the panel. Closing the active tab focuses the next tab, or main.

## 6. Restore after reload

- `loam.apps.section`, persisted, tells stage A that documents are the owner, and main is `aria-busy` in the first frame, with no landing ([2.2](../2-scope-projects/spec.md#22-two-stages-d69)). The editor's state and validator are in the `late` chunk, so **`loam.editor`'s handler registers in stage B, and is `hydrateOne`d then,** for the active scope, not in stage A's `hydrate`, which drops a record with no handler (`registry.ts:157-162`).
- After `appsReady`, the `editor` chunk loads, and each group's active tab mounts. Inactive tabs show their titles, from `document-get`, and mount on activation. So a reload reads as many editors as there are groups.
- No `document-open` entry is journaled for a restored tab, since the state did not change, as phase 1's reopen has it. A `document-get` read at boot is journaled, and re-executes in a replay against the same record.
- A document gone meanwhile shows the frame's notice, with Close, and the rest restore.

## 7. New

"New is shell-owned." `loam-new-button` is in first paint, in the title bar before the search button, with `aria-haspopup="menu"` and the text `New`, with no icon: the 16 generated system icons have no `add`, and adding one is an edit to the imported set for no gain here. The first press loads the `new` chunk.

```ts
export type NewItemV1 =
	| { kind: 'document'; type: string; template: string; title: string; icon: string; recent: boolean }
	| { kind: 'creator'; instance: string; command: string; title: string; icon: string };
```

- **`new-list`** returns every template of each type whose `scope_levels` hold the active level, and each `ui.new` entry whose levels hold it. Recents first: the last 5 distinct types and templates, from the view-state record `loam.new.recent`, `{ items: Array<{ type; template }> }`, registered with the late commands and written by `document-create` when the `new` menu calls it with `recent: true`; then by the rail's order. A type of a disabled, refused or failed plugin is not listed.
- **`loam-new-menu`** is a `violet-menu` in a popover: items as `menuitem`, a heading per plugin when more than one, keyboard as a menu has it. Choosing a template calls `document-create`, then `document-open { preview: false }`, and adds to `loam.new.recent`. Choosing a creator calls its command, and a failure is a `danger` toast. Focus goes to the new editor, or returns to the button.
- **With nothing to offer:** the menu says `Nothing to create here` and, at workspace level with project-only types, `Choose a project to create a <title>`, naming them. So the button does not disappear with the scope.
- **The palette** lists the same as `New: <title>`, by `new-list`, when the query starts `new`, loaded when the menu's chunk is, or on the first such query. An agent calls the commands.

## 8. The documents section

`loam-documents-section`, in the `documents` chunk: "the browser" (D23).

### 8.1 The sidebar

A `loam-tree`, over `violet-tree`, in the shell's sidebar part:

```text
Recent                      (the last 10, from `document-list`)
Notes                       (each type the scope allows)
  Roadmap
  ...
Checklists
Trash                       (`document-list status: 'trashed'`)
```

- A type's children load when opened, 200 at a time with a `Show more`, by `document-list`. The tree re-reads on `document-*` events.
- **Press and #712.** `violet-listbox`'s `handleFocus` moves a row out from under the pointer, and `loam-list` and the palette have it. `violet-tree` is another element: step 11 reads and tests it for the same fault. If it has it, `loam-tree` does as the console does, making the pressed row active on `mousedown` ([9.8](../1-app-contract/spec.md#98-decided-by-step-6)). Nothing is forked.
- A press opens as a preview, as above. Each item has a menu: Open beside, Rename, Trash or Restore.
- **`tree`'s reader** is the same as an app's ([7.4](../2-scope-projects/spec.md#74-sidebar-header-and-status-bar)), for the part's rules only: this tree is the shell's, and reads commands.

### 8.2 The list

With no tab open: `h1` `Documents`, a filter field (`document-list`'s `query`), type and tag filters, and a table of title, type, project when `project: 'all'`, updated, and owner. `Trash` in the sidebar shows the same table with `Restore`, and `Trashed <date>, kept until <date>`. Empty: `No documents yet`, with the New button's menu.

**Search** is the title, through `document-list`, and through the palette: `palette-search` gains `kind: 'document'` rows, from a `PaletteIndex` over every active record, built in stage B and updated on `document-*` events, **each result filtered through `decideAccess` at query time,** so a sign-out or a change of members never shows an old actor's titles. **Content search does not land here,** so phase 0's A5 stays unmeasured; that row's "when search lands" stands.

**Favorites,** in the proposal's list, are not in D23 or the architecture. They are a follow-up.

### 8.3 In a project

The [project's home](../2-scope-projects/spec.md#77-project-summary) ends with a `Documents` card, by the shell, not an app's summary: per type, the count and the 5 most recent, from `document-list`. So `project-summary` "shows a project's documents by type", with no plugin writing a summary for it.

## 9. References

### 9.1 A resource link

The architecture's shape, here first, so `project-summary` and references use one form. Phase 5's "resource-link form" then extends it, and its row is amended.

```ts
export type ResourceLinkV1 =
	| { kind: 'document'; document: string; scope: ScopeV1; anchor?: unknown }
	| { kind: 'app'; instance: string; route?: string; scope: ScopeV1 };

/** The URL it navigates to, or undefined when it cannot be opened in this page. */
export function resourceLinkUrl(link: ResourceLinkV1, base: string, projects: ProjectLookup): string | undefined;
```

**Navigation, never execution** (architecture): it names no command. Validation is by hand and by shape: an unknown `kind` is dropped with a warning in the result, and a `scope` the reader's `decideAccess` refuses opens "Nothing here", as any URL does. An app gives one in `project-summary` as data, with no port rule, because it does nothing until a person follows it.

### 9.2 Embed

`loam-embed`, in the `editor` chunk, is the kit element a native editor puts in its own surface, by name with `kit.define(['loam-embed'])`. `KitElementNameV1` gains it, and it is not added to the first-paint kit list. **A view's editor embeds nothing in phase 2:** it would need an iframe in a sandbox, and its CSP has `frame-src 'none'`; `kit` is native-only, so there is nothing to refuse, and a view links instead.

- `document` is a property: the id. **Access is re-checked at render, by `document-get` with the reader's actor and no scope override, and again on `documentChanged`.** A refused or missing target shows `Not available`, the same for both, and takes no other detail.
- **What it renders:** the target type's `embed`, in a mount or view frame of its plugin, with `DocumentRefV1.readOnly: true`, or with none declared, the title, icon and a link. Depth is at most 3, and a cycle stops at the first repeat: `EMBED_DEPTH_EXCEEDED`, shown in place.
- **Read-only is enforced.** Its surface's client is the shell's own, whose calls carry `scope: target.scope`, the one port exception, for that document's scope only. A mutation through it is `EMBED_READ_ONLY`, journaled by the internal `app-embed-refuse`, in the port. **For a native plugin that is a contract, for a view a boundary** (D54).
- A native element embedding the target of another plugin keeps each in its own registry, by a `loam-mount` each. So types do not import each other's code (D23).
- **Owner.** "The embedding document": it follows its editor, and goes when it goes.

### 9.3 The index

Table `document-link`:

```ts
export interface DocumentLinkV1 {
	id: string;        // `lnk_` and 12 characters
	workspace: string;
	from: string;      // a document id
	to: string;        // a document id
	anchor: unknown;   // JSON, at most 1 KiB; the from document's locator, under its binding
	kind: string;      // `reference` by default, or `embed`; `^[a-z][a-z-]{0,31}$`
	createdAt: number;
	createdBy: string;
}
```

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `document-link-add` | mutation | `{ from; to; anchor?; kind? }` | The link. Undo: `document-link-remove` |
| `document-link-remove` | mutation | `{ link }` | `{ link }`. Undo: `document-link-add` with the same id |
| `document-link-list` | query | `{ document; direction?: 'out' \| 'in' \| 'both' }`, default both | `{ out: LinkRowV1[]; in: LinkRowV1[] }` |

```ts
export interface LinkRowV1 { link: DocumentLinkV1; document: { id: string; title: string; type: string; status: string; scope: ScopeV1 } }
```

- **`document-link-add`** needs `decideAccess` on both documents' scopes; a target missing or refused is `DOCUMENT_NOT_FOUND`, and `from` must not be trashed. Links cross projects freely, within one workspace ("per workspace and never crosses workspaces"), and one `document-link-add` of an existing `(from, to, kind, anchor)` answers that link. A link to itself is allowed.
- **Who may read.** Each row of `document-link-list` is read through `decideAccess`. **A backlink from a project the reader may not enter is left out, and nothing counts it.** A trashed target keeps its row, with its status, so a reader sees `In trash`.
- **The index.** `createDocumentIndex` in `kernel/src/late/links.ts`, two `Map`s, built once by one `list` of the table at the first `document-link-list` or `-add`, and updated by those commands and `document-trash-expire`. **A4 is this rebuild: 2,000 documents and 20,000 links at most 500 ms in Chromium in CI,** measured from `createReferenceWorkspace`, which gains them, in `test/browser/budget.test.ts`.
- **Replay.** The commands re-execute. `document-link-list` reads the record of links, so a replay gets what was added.

## 10. The `notes` type

`endpoints/loam/apps/notes/`: "text with links and embeds, small enough to read, real enough to use." Native, no rail, no main.

```text
loam-app.toml, schemas/, src/handlers.ts, src/native.ts, src/notes-editor.ts, src/notes-inspector.ts, src/notes-embed.ts, test/app.test.ts
```

- **Manifest.** The [sketch of 2.1](#21-the-contribution-d23), with the `store`, `clock` and `documents` grants.
- **Content.** `{ text: string; embeds?: string[] }`, `content_version = 1`, under `documentContentKey(id)`. A link in the text is `[[doc_abc123|Roadmap]]`: its id and the title when it was made.
- **Commands.** `notes-content-get { document }`, `inspect`. `notes-content-set { document, text, embeds? }`, `store-write`, `undoable`, returning `undoCommand: 'notes-content-set'` and the previous text as `undoArgs`, which [4.4](#44-limits)'s bound also limits. `notes-export` and `notes-import`, with `export_command` and `import_command`. Both `expose` to palette and agent. None needs a `calls` grant, since each is its own.
- **`notes-editor`.** A `violet-text-area` on the kit, filling the frame, holding a draft until `save()`. It dispatches dirty on a change and selection on select. `Insert link` opens a list from `document-list`, filtered as typed, and inserts the token. `documentChanged` re-reads and, when the store's text differs from the draft and the draft is clean, replaces it, keeping the caret by offset. When dirty, it shows `This note changed elsewhere`, with `Keep mine` and `Use theirs`, since D46's conflict rule is per property and the text is one. Tokens are parsed by `parseLinks(text)`, which is pure.
- **Links, by the surface.** After a successful `save()`, the editor diffs `parseLinks` against `document-link-list { direction: 'out' }` and calls `document-link-add` and `-remove`. **A handler cannot,** by D68's "a nested call may only be a query". An agent setting text calls the link commands too, and `notes-content-set`'s result reminds it, with `warnings: ['links are separate: document-link-add']` when the text has a token not linked.
- **`notes-inspector`,** when the tab is active: this document's `Links` and `Backlinks`, from `document-link-list`, each a link that opens beside, and its status. The `document-*` and `editor-*` events reach it through `documentChanged`, and a link's own events through `selection`'s re-read. **This is what "show backlinks" means in the exit test.**
- **`notes-embed`.** The first 2,000 characters of `notes-content-get`, as text, in a block: `readOnly` by contract, and it holds no form. `notes-editor`'s `Embed` adds an id to `embeds`, and each renders a `loam-embed` under the text area, plus a `kind: 'embed'` link.
- **Tokens only.** `lint:tokens` on its source, `app check` clean, the trust line in its README.

### 10.1 The `checklist` type

`endpoints/loam/apps/checklist/`: a `view` plugin, with no rail, no main and `scope_levels = ["workspace", "project"]`, the second type. It proves that a type lands from a deployment entry alone, in a sandbox.

- **Manifest.** `ui.documents[0]`: `id = "checklist"`, `editor = { resource = "ui://checklist/editor" }`, `binding = { model = "command", selection = "item", locator = "item", conflict = "last-writer-wins" }`, one template `blank`, no `autosave_ms`, since each change is a command at once. `view.handlers = "dist/handlers.html"`, as D61 needs. Grants: `store`, `clock`, `random`.
- **Content.** `{ items: Array<{ id: string; text: string; done: boolean }> }`, at most 500.
- **Commands.** `checklist-get { document }`, `checklist-item-add { document, text }`, `checklist-item-toggle { document, item }`, `checklist-item-remove { document, item }`, each with `undoCommand`, in `instance_commands`.
- **The editor.** One HTML file through `singleFileHtml`, on `connectView`: a list of checkboxes, an add field, tokens from `dev.loam/tokens`. It re-reads on `dev.loam/document-changed`, reports `dev.loam/editor-selection` as `{ kind: 'item', id }`, and never reports dirty, since it holds no draft.

## 11. The documents grant

`documents`, as the architecture's catalog has it: "read metadata, references and backlinks of documents the caller may read; open one. Content is read only through the type's editor and commands, under `store`."

```ts
// @lushly-dev/loam-sdk
export interface DocumentsV1 {
	get(document: string): Promise<DocumentRecordV1 | null>;
	list(options?: { type?: string; tag?: string; query?: string; limit?: number }): Promise<DocumentRecordV1[]>;
	links(document: string): Promise<{ out: LinkRowV1[]; in: LinkRowV1[] }>;
	open(document: string, options?: { group?: 'active' | 'beside' }): Promise<void>;
}
```

- A port with the grant may call `document-get`, `document-list`, `document-link-list` and `document-open`, and without it none. A type's plugin needs the grant to call them, even for its own: `notes` declares it, since its editor lists documents and links. Its own instance commands need none. `document-link-add` and `-remove` are callable with the grant by a surface, never from a handler, by D68.
- `app-open`'s rule stands: an app never switches another's screen. `documents.open` from a surface whose app is not the editor owner or active is refused, `DOCUMENT_OPEN_NOT_ACTIVE`, as `modal-open` is for an inactive app.
- `document-create`, `-rename`, `-move` and `-trash` are not callable through a port, in phase 2. They are a person's and an agent's, through the shell and the registry. An app's own commands that create documents wait for `calls` in phase 5, when a type's document is a resource it may ask for. **So "Apps never create or delete projects" has its twin here:** an app does not create shell-owned document records either, for now.

## 12. Budgets

Rows the [budget table](../2-scope-projects/spec.md#24-the-budget-and-the-rule) adds. Each is after first paint.

| Row | Holds | Loaded | Ceiling, a first estimate; phase 0's rule lowers it |
| --- | --- | --- | --- |
| `editorMinified` | `chrome/src/editor/`, what it imports that nothing earlier has | A document opens or restores | 40,000 |
| `documentsMinified` | The section, `loam-tree`, `violet-tree` and `violet-tree-item` | The section opens | 45,000 |
| `newMinified` | `loam-new-menu`, `violet-menu` | First press, or `new` in the palette | 12,000 |
| `lateMinified` | Shared with the other specification: these commands are most of it | Stage B | 60,000 |

Recorded, not limited: `notes` and `checklist`, as `hello` is. First paint's only addition here is `loam-new-button` ([the ledger](../2-scope-projects/spec.md#24-the-budget-and-the-rule)).

## 13. Collaboration: the seam, and nothing more

D46 is **a later phase's service, with its own specification after phases 2 and 6.** What phase 2 gives it:

| The seam | Where |
| --- | --- |
| A required binding on every type, and copied to every record | [3.1](#31-the-binding-d46) |
| `model: 'crdt'` named, and refused until then | The same |
| `epoch` on a document, raised on a move; `memberEpoch` on a project, raised on an access change | [Section 3](#3-the-document-record), [its sibling's 4.3](../2-scope-projects/spec.md#43-the-project-store) |
| Every change goes through a journaled instance command, so the journal is the system of record and attribution is free | [Section 4](#4-the-instance-store), [5.7](#57-one-model-any-number-of-editors) |
| A selection in the binding's model, in memory, by `editor-selection-set`, so presence has what to express | [5.4](#54-the-commands) |
| `locator` on the binding, and `anchor` on a link, which a thread will share | [3.1](#31-the-binding-d46), [9.3](#93-the-index) |
| `document-apply-update`, `document-share`, `document-share-revoke`, `presence-get`, `thread-*`, reserved by name and domain | [4.1](#41-commands) |
| [5.7](#57-one-model-any-number-of-editors)'s `documentChanged`, which a remote change would also call | The same |

**Not in phase 2:** a CRDT, presence, sharing, links with generations, threads, a sync endpoint, offline merging, and revalidating a live session. One person in one browser profile has no one to sync with, and a second tab is refused by phase 0's writer lock.

**Phase 6's and later concerns:** the store interface is the seam for a hosted backend. Nothing here assumes IndexedDB but the adapter, and `ProjectCache` and `createDocumentIndex` read through it.

## 14. Exit criterion and tests

With the [first specification's E1 to E14](../2-scope-projects/spec.md#15-exit-criterion-and-tests), and in the same run. `test:browser` gains `test/browser/documents/`. **Each row names the job:** Units is the `loam` job's unit step, Chromium its `test:browser` step.

| # | Criterion | Job | Test |
| --- | --- | --- | --- |
| D1 | **Two `notes` documents open side by side, link to each other, show backlinks and restore after reload** (architecture section 9) | Chromium | New, twice. `Open beside` shows two groups, in two `violet-tabs` strips, each with its editor, in the deep DOM. In A, `Insert link` to B, save. In B, a link to A. The inspector of A shows B under both `Links` and `Backlinks`, and of B the same. Reload, with a delay on the `editor` chunk: the first frame is busy; the same two tabs, the same document in each, the same active tab, the same URL; and the inspector's rows. The journal holds the commands with `context.scope`, and has no `document-open` entry for the restore. Replay has zero differences |
| D2 | **A second document type lands with no shell change** | Chromium; Units | `checklist`, a view, on a second origin, appears in New from its deployment entry alone, creates, opens in a real sandboxed frame beside a note, and works through its handler frame. A unit test scans `kernel`, `chrome` and `web/src` for `notes-` and `checklist` and fails on a match. Step 13's `git diff` is empty in `kernel`, `chrome` and `web/src`, which is why step 12 lands the view editor's support, proved there by a fixture. Its document works with its view closed, through `checklist-item-add` from the palette |
| D3 | **Types and the registry** | Units | The manifest: each row of 2.1's table, with a case in `profile-cases.json`, including a missing and a `crdt` binding, a mounted manifest with `ui.documents`, `ui.documents[].panel`, a template off its schema, a version 1 manifest with `ui.documents`. A type conflict leaves the app loaded, with a notice. A failed plugin's document opens to `DOCUMENT_TYPE_UNAVAILABLE`, and its record stays |
| D4 | **The record and the store** | Units | Over both adapters, each command's row: fields set, `updatedAt` by an instance command, the batch of `document-create`, a failed batch leaving neither, `document-move` moving content between scopes and back through undo, with `epoch` raised. Trash and restore, undo of each, `trashDays`' expiry deleting record, content and links, journaled, and journaling nothing with nothing to do. `document-export` and `document-import`, and refusing a newer envelope. **The shell never reads content,** by a fixture store that fails any read of `doc/` outside the type's calls, `document-move` and `document-create` |
| D5 | **The editor area** | Units; Chromium | `validateEditorState`'s invariants as a table. Commands on the state: preview replacing preview, promoting, pinning, up to three groups, a fourth `beside` using the last, a dirty close, a tab moved. A persisted bad record is ignored. Per scope: Atlas's tabs are gone under Beacon and back on return, with nothing of Atlas in the deep DOM. Keyboard: `tablist` arrows, close, focus moves. A native editor parks, with its scroll, and a view tears down and rebuilds. An editor's `save` on `autosave_ms`, on Mod+S and on close; a rejecting `save` keeps it dirty with a toast. A modal from the editor owner works, and the rail's app is not active. Switching to an app leaves the tabs in `editor-get` and on no screen, with overlays as an app switch |
| D6 | **A cross-project mutation on a document** | Units; Chromium | `document-rename` and `notes-content-set` of a Beacon document, in Atlas: `SCOPE_MISMATCH`, naming Beacon, journaled, its bytes equal in both. `document-get` of a restricted project's document, for a non-member: `DOCUMENT_NOT_FOUND`, in the same bytes as a missing id, and it is left out of `document-list` and backlinks, with no count. `document-open` across scopes switches, with its rules. A trashed document refuses `notes-content-set`. The wrong type refuses. **Through a port,** a view in Atlas is refused `document-get`, `document-link-list` and `document-open` of a Beacon document, `document-list { project: 'all' }`, and a `document-link-remove` of a link it cannot read; each named `project` or `link` of 4.1 has a row of its own |
| D7 | **One model, many editors** | Chromium | The same note in two groups. A save in one, a `kernel.agent` `notes-content-set` and an undo through `undoCommand` each reach the other's text. An editor that is dirty when another save lands shows the notice, and neither loses text until a person chooses |
| D8 | **New and the section** | Chromium | With hello, notes and checklist: `new-list` by scope, recents first, with a project-only type's sentence at workspace level. The menu by keyboard. A creator's failure. The tree: types, recents, trash, a preview on a press, promote on a second, a `mousedown` that lands. The list's filter, and title search in the palette opening a document. A project's home shows documents by type. A hostile `title` in a record renders as text |
| D9 | **References and embed** | Units; Chromium | A4 at or under 500 ms for 2,000 documents and 20,000 links. Links across projects; a backlink from a refused project left out. `loam-embed`: renders a note in a note; a removed member sees `Not available`, re-checked at render, as a missing one does; depth 3 and a cycle stop; a mutation through it is `EMBED_READ_ONLY`, journaled. A resource link with an unknown `kind` is dropped with a warning; a `project-summary` link navigates. Each element in its own scoped registry, with `customElements.get('notes-editor')` undefined |
| D10 | **Accessibility, captures, limits** | Chromium; Units | Specimen captures of each element, in the three themes, two densities, with an ARIA snapshot, with #707's workaround. Axe with phase 0's tags with two groups, a view editor, the tree, the menu open, the compact class and `forcedColors: 'active'`, zero violations; axe inside the view's frame as E2 of phase 1 does. Over 256 KiB, `DOCUMENT_CONTENT_TOO_LARGE`, journaled without the input. The journal's growth for a 10,000-character note saved 30 times is measured and recorded, not limited. #708's passes stay open, and it says so |

## 15. Implementation plan

The phase's order is in [the first specification](../2-scope-projects/spec.md#16-implementation-plan). Each step is one pull request, merged on green, and updates both status blocks and STATUS.md before it merges.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 9 | Document records | `src/late/documents.ts`: the registry, the record, the commands of [section 4](#4-the-instance-store) but `document-open`, the check, the limits, the grant, `documentContentKey`; the `document` rules from step 3 now served; a `probe` type in `kernel/src/testing`. `COMMAND_NAME_SUGGESTION`'s `notes-create` (`kernel.ts:56`) and `testing-probe.ts:39-74`'s `notes` names are renamed `reports-*`, for D2's scan; D3, D4, D6's units | `pnpm check`, `loam.yml`, `budget` |
| 10 | The editor area and `notes` | [Sections 5 and 6](#5-the-editor-area), [`notes`](#10-the-notes-type) without links, `chrome/src/editor/`, `document-open`, Mod+S, `loam.editor`, the `editor` chunk's row, `design.md` and the skill, `lint:tokens` for `notes` in `loam.yml` and `suites.mjs`, which selects the whole workspace; D5, D7, D1's first half, D10 so far | `pnpm verify`, `loam.yml`, `budget`, `theme:check`, `lint:tokens` |
| 11 | New and the documents section | [Sections 7 and 8](#7-new), `loam-new-button` within its allowance, `loam-tree`, `tree` for an app's sidebar, the palette's rows, a project's card; D8, D10 so far | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 12 | References, embed and view editors | [Section 9](#9-references), `ResourceLinkV1`, `createDocumentIndex`, A4, `loam-embed`, `notes`' links, inspector and embed; `DocumentViewSource`, the broker's hold on a document's scope and `dev.loam/editor-*` in `/view` and the frame, proved by a fixture view in `web/test/browser/pages/`; D1, D9, D10 so far | `pnpm check`, `loam.yml`, `budget` |
| 13 | The second type | [`apps/checklist`](#101-the-checklist-type) alone, its tests, `lint:tokens` in `loam.yml` and `suites.mjs`, which selects the whole workspace, and the inventory, so `git diff` is empty in `kernel`, `chrome` and `web/src`; D2, D10 | `pnpm verify`, `loam.yml`, `budget`, `lint:tokens` |

Order: 9 needs step 6. 10 needs 9. 11 needs 10. 12 needs 10, and may run beside 11, except for D1, which needs both to close, in whichever merges second. 13 needs 12. Step 14, exit, is last.

## Amendments

This pull request adds to the [decision log](../../decisions.md):

- **D79.** A document's record is the shell's and its content the type's, under `store`, at `doc/<id>`; the shell reads no content. A type declares a binding, required and copied to each record, as D46 asks from phase 2. `crdt` is refused until the collaboration specification. A mounted plugin declares no type until phase 5. Annotates D23.
- **D80.** The editor area is main when the section `documents` is active with tabs; an active app's stage hides it, and its tabs stay. Up to three equal columns, with per-group tabs, preview and pinned, one state record per scope. The model is behind the type's commands, and an editor hears each change. A native editor is parked; a view is torn down, since a frame cannot move. Decided with the documents specification.
- **D81.** References are a `document-link` table with a per-reader filter, in one form of resource link, `ResourceLinkV1`, which phase 5's row extends. A backlink the reader may not reach is not counted. An embed re-checks access at render and is read-only: a boundary for a view, a contract for a native plugin. A view embeds nothing in phase 2.
- **D82.** `notes` is a native plugin with no rail, the first of its shape; `checklist`, a view, is the second type and first view editor. A plugin with `ui.documents` and no rail, sidebar or main has no rail entry. Apps do not create document records until `calls` in phase 5. Instance commands bound their input at 256 KiB. The journal still keeps each save whole, so a replay can re-run it, until #710 settles retention.

The decision log's D23 and D46 gain notes pointing here. The architecture's section 5 gains `document-type-list`, `document-update`, `document-link-remove`, `editor-*` and `new-list`, and notes that `document-apply-update` and the sharing, presence and thread commands wait for the collaboration specification. Section 9's phase 5 row notes that phase 2 starts `ResourceLinkV1`.

## Review 2026-11-02

One independent review of both specifications, by a fresh agent given the two documents and the source documents, not the author's conclusions, asked the five questions of the process: can an agent implement this with no further design decision, does anything contradict a recorded decision, is anything claimed about the code wrong, are the exit tests sufficient, does the budget plan hold. It read the code and ran throwaway builds. It returned 61 numbered findings and a list of nits: 15 must-fix, the rest should-fix. The author re-read the code behind the main claims (`mock.ts:52`, `testing.ts`'s `diffJournals` and `REPLAY_IGNORE`, `kernel.ts:225-228`, `:338`, `validation.ts:73-84`, the shell's boot reads) and they held. All are addressed in the text above, but for the three named at the end:

1. **The shell could lock a person out.** Lines 2 and 6 of a call ran for every command, so signing out inside a restricted project refused `auth-sign-in`, and an archived project refused `project-restore`. They now run for owned commands, and a shell command checks what it names ([3.4](../2-scope-projects/spec.md#34-the-order-of-a-call-d72)).
2. **The actor's id did not survive a reload or a replay,** since the Mock's holds `Date.now()`. Step 0b derives it from the email.
3. **Replay would apply a deployment twice,** and step 5 of stage B now skips under replay. `diffJournals` did not compare `context`, as a first draft claimed; step 4 adds it.
4. **The second-type exit test contradicted its plan,** with chrome code in the step that must have an empty diff. View editors' support moved to step 12.
5. **"Read-only to every command" was false.** `INTERNAL_COMMANDS` only filters a list, and every shell command takes `agent: true`, so an agent could have called `workspace-deployment-apply` and rewritten a mount's `projects`. Boot-only commands now need an object in the kernel's closure, and E10 calls them.
6. **Step 0a would have broken `budget`,** with both layers in first paint. No package moves until step 1, in one pull request.
7. **The ledger's base and allowances did not hold,** with no literals, no locale and step 6 priced below its own first two elements. Its sum would have exceeded the ceilings. Moving the non-boot definitions out, first a fallback, is now planned, the acceptance is ceiling less ledger, each lazy boundary has a line, and the review's measurements are recorded in [2.1](../2-scope-projects/spec.md#21-what-was-measured).
8. **Mini has no locale,** so `VALIDATION_ERROR`'s text would have changed on the page when classic loaded. `formatZodIssue` builds it from the issue.
9. **Editor state could not hydrate at stage A,** from the late chunk; **a traverse's commands would have pushed,** destroying forward history; **an app could reach across projects** through `document-open` and `document-list`; **an app's route could walk the URL** with `..`; and **named targets had no stated access check.** Each is fixed, with a test.
10. **Late commands were lost on mounted discovery,** by a second caller of `setAppCommands`. They join `fixed`.
11. **`role="tab"` with buttons inside would have failed axe by construction.** The strip is hand-written, with siblings.
12. **E14's "appears in the logs" could not be checked,** with no verbose reporter, and E2 and E11 named the wrong jobs. `scripts/loam-exit-check.mjs` reads them, and every exit test's title starts with its row.

**Left, for the coordinator or the owner.**

- **D29 with no active project (finding 35).** The rail's table follows D29's "otherwise in workspace scope". D5 says the bottom band lists "apps that never take a project". It is an owner's decision being read, so it goes to the owner, in the report and in [7.1](../2-scope-projects/spec.md#71-the-bands-d75). The change is one row if the answer differs.
- **D55 reached by self-service (finding 33).** Recorded in [9.1](../2-scope-projects/spec.md#91-an-instance-and-its-projects-d55) as a limit that cannot bite until phase 3, and made a condition of phase 3's specification, rather than adding a deployer-owned project record now.
- **The exit criterion's wording (finding 35).** "Through a test-only handler" is added to the architecture's row, with D64 as precedent, for the coordinator to approve by name.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-02 | Phase 2 specification | Group sizes, rows, and dragging a tab or a group | Open |
| 2026-11-02 | Phase 2 specification | Favorites, in the proposal's list and not in the architecture's | Open |
| 2026-11-02 | Phase 2 specification | Content search, phase 0's A5, when a consumer needs it | Open |
| 2026-11-02 | Phase 2 specification | `ui.documents[].panel`, a view's inspector, and an embed in a view's editor, each when a type asks | Open |
| 2026-11-02 | Phase 2 specification | A three-button close prompt (Save, Discard, Cancel), with phase 4's prompts | Open; phase 4 |
| 2026-11-02 | Phase 2 specification | Journal size under autosave: 4.4 bounds one input and leaves growth open. Consider snapshots, or deltas with the collaboration service's `document-apply-update` | Open; #710 |
| 2026-11-02 | Phase 2 specification | Apps creating and driving other plugins' documents, under `calls` | Open; phase 5 |
