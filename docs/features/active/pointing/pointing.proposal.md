# Pointing: show the agent which element you mean, and see a correction before it is written

## Status

- **State:** active. Approved by the owner on 2026-11-22 and promoted from `proposed/` to
  `active/`. Drafted 2026-11-13 against `main` at `f7ecbd43`, walked once by a fresh reader
  covering three seats ([section 7](#7-what-the-walk-changed)), and reviewed independently.
  [STATUS.md](STATUS.md) is the source of truth for delivery progress.
- **Verified:** every claim in [What exists today](#2-what-exists-today) was read first-hand on
  2026-11-13 at `f7ecbd43`, with `endpoints/specimen-server` (`#1320`) and `host/src/page.rs`
  re-verified on 2026-11-22. The mechanisms in [the design](#4-design) draw on the owner's earlier
  editor work in a private repository, read for ideas only; nothing here depends on it.
- **Delivery order:** Slice 1 Targeting (Jobs 1–4: [#2046](https://github.com/lushly-dev/afd/issues/2046),
  [#2042](https://github.com/lushly-dev/afd/issues/2042), [#2043](https://github.com/lushly-dev/afd/issues/2043))
  → Slice 2 Notes (Jobs 7–9: [#2044](https://github.com/lushly-dev/afd/issues/2044)) → Slice 3
  Preview (Jobs 5–6, with T09 [#1211](https://github.com/lushly-dev/afd/issues/1211):
  [#2045](https://github.com/lushly-dev/afd/issues/2045)).

| Field | Value |
| --- | --- |
| Epic | [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| Units likely touched | `foundations/specimen` (the host and the review page), `integrations/specimen-afd`, `endpoints/specimen-cli`, `endpoints/specimen-server`; for Slice 3 preview, Specimen's Violet work (T09, [#1211](https://github.com/lushly-dev/afd/issues/1211)) and `integrations/violet-afd` |
| Related | [Design Decisions](../design-decisions/design-decisions.proposal.md), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), [Patterns](../patterns/patterns.proposal.md), [Specimens status](../../complete/specimens/STATUS.md) (T09, T10) |
| Rank among the four | Third. Pointing starts on Specimen's review page (Slice 1 ships independently of Design Decisions); Design Decisions' review adopts it later |

## 1. Problem

A person looking at a rendered screen sees the thing that is wrong. To get it fixed they
describe it in words ("the second button in the toolbar, the one next to search"), and the
agent guesses which element and which source file that means. Two of the jobs a design
toolchain needs are missing:

1. **Targeting.** No way to click an element and hand the agent a reference to it that is
   precise, stable and tied to its source.
2. **Correction.** Violet can preview what a token change does to token values, but not to the
   rendered screen, so a correction is judged after it is written.

## 2. What exists today

Read first-hand on 2026-11-13 at `f7ecbd43`, with `endpoints/specimen-server` (`#1320`) and
`host/src/page.rs` re-verified on 2026-11-22.

### Specimen

- **Captures** hold an `ElementObservation` per element (`foundations/specimen/src/types.ts:572-588`):
  `ref`, `tag`, attributes, box, scroll, styles, state and, from the native host only, the
  accessibility role and name.
- **Element references are positional paths,** such as `root/shadow/example-button:1/button:2`
  (`src/browser/capture.ts:260-271`). They change when the DOM changes.
- **Targets** are `{ selector }` or `{ role, name? }` (`src/types.ts:43`). The host resolves them
  in `host/src/page.rs`, and every outcome other than exactly one element ends in one untyped
  error, "Target must identify exactly one element" (line 417): not-found and ambiguous are not
  told apart.
- **A capture knows its source,** but not per element and not as a per-file digest map. Its
  manifest has the specimen id and one aggregate `source.digest` over `config.digest` and every
  bundle file the page loaded (`src/types.ts:638-652`, `src/bench-runtime.ts:315`). An entry has
  its `module` and `exportName` (`src/types.ts:191-196`). The custom elements manifest gives each
  component's module path (`src/manifest.ts:36,113`), which `specimen-inspect` already reads.
- **The review page** (`src/browser/page.ts`) is a static index and preview, opened at
  `specimen.html?id=…&viewport=…&theme=…` from any static server. It has no inspector, overlay or
  click-to-select, and a search of Specimen finds no inspect-mode or selection code.
- **19 commands** in `integrations/specimen-afd/src/commands.ts`, each with one failure code of
  its own, such as `SPECIMEN_RENDER_FAILED`, dispatched by name (line 600). The CLI,
  `endpoints/specimen-cli`, maps its options by hand per command (`src/cli.ts:95`) and creates a
  browser bench on each call (line 338).
- **The local MCP server,** `endpoints/specimen-server` (`#1320`), hosts `@lushly-dev/specimen-afd`
  over stdio using the CLI's validated execution path and keeps its browser bench alive until
  stdin EOF or termination.
- **The host resolves `{role, name}`** through `Accessibility.queryAXTree` to the element the
  accessibility node belongs to (`host/src/page.rs:361-403`). For a custom element whose shadow
  root holds a native `<button>`, that is the inner button, not the custom element.
- **T09, Violet context and impact, and T10, the Violet lens,** are "Not started, optional"
  ([#1211](https://github.com/lushly-dev/afd/issues/1211),
  [status](../../complete/specimens/STATUS.md)). The Specimens proposal plans `specimen-impact`,
  taking an offline snapshot and `changes.impact`'s input, returning "observed render effects per
  node/state" (`docs/features/complete/specimens/specimens.proposal.md:165`).

### Violet

- **`token.override`** takes `{nodeId, tokenId, value, reason?}`
  (`integrations/violet-afd/src/commands/token/override.ts:17-20`).
- **`changes.impact`** (`src/commands/changes/impact.ts`) takes a node and up to 50 changes
  (`MAX_IMPACT_CHANGES`, line 21) of type `add`, `override`, `subtract` or `reset`, applies them
  to a read-only overlay, and returns the effects and an `apply` list of the commands that would
  make them (line 130). It previews token values, not anything rendered.
- **`specimen.get`** (`src/commands/specimen/get.ts:62-72`) returns, for a node, which token draws
  each role of each component, whether it resolves and whether its value is valid.

### Elsewhere

- **Botcore's `cdp_*` commands** (`endpoints/botcore/src/botcore/commands/cdp/`) let an agent
  inspect a page by selector. There is no picker for a person.
- **Loam** has document selections (`editor-selection-set`, a text range or an item), not UI
  elements. Its phase 5, the copilot, is not started (`endpoints/loam/docs/STATUS.md:46`).

## 3. Jobs

Each job is one scenario in [`scenarios/`](scenarios/). The owner confirmed all nine jobs on
2026-11-22 in three ranked slices: **Slice 1 (`slice`, Targeting: Jobs 1–4)** → **Slice 2 (`notes`,
Notes: Jobs 7–9)** → **Slice 3 (`preview`, Preview: Jobs 5–6, with T09 [#1211](https://github.com/lushly-dev/afd/issues/1211))**.

| # | Job | Scenario | Slice / Tags |
| --- | --- | --- | --- |
| 1 | **Point instead of describe.** When I see something wrong on a rendered screen, I want to click it and hand the agent a reference, so that I do not have to describe it in words and the agent does not guess. | [01](scenarios/01-point-instead-of-describe.scenario.yaml) | Slice 1 (`slice`) |
| 2 | **Choose the right level.** When my click lands on a part of what I meant, I want to move the reference to its parent, a child, a sibling or the component that contains it, so that the reference names what I meant. | [02](scenarios/02-choose-the-right-level.scenario.yaml) | Slice 1 (`slice`) |
| 3 | **Enough, not everything.** When I hand the agent a reference, I want it to get the element's role, name, component, source and a capped neighbourhood, and none of the rest of the page, so that it can act without loading the page and its context holds what I pointed at. | [03](scenarios/03-enough-not-everything.scenario.yaml) | Slice 1 (`slice`, quiet) |
| 4 | **Refuse a stale reference.** When the code has changed since I pointed, I want work on that reference refused and a fresh point asked for, so that a change never lands on the wrong element. | [04](scenarios/04-refuse-a-stale-reference.scenario.yaml) | Slice 1 (`slice`, refuse) |
| 7 | **Leave a note.** When I notice something I will not fix now, I want to pin a note to the element for an agent to pick up later, so that the observation is not lost. | [07](scenarios/07-leave-a-note.scenario.yaml) | Slice 2 (`notes`) |
| 8 | **Keep an orphaned note, and settle it.** When the element a note was pinned to no longer exists, I want the note kept and marked orphaned, not dropped or moved by guesswork, so that I can see what it was about and either re-pin it or close it. | [08](scenarios/08-keep-an-orphaned-note.scenario.yaml) | Slice 2 (`notes`, refuse) |
| 9 | **Close a note with a reason.** When an agent resolves a note, I want it to say what it did and why, so that I can check the work, and I want resolved notes out of the open list, so that the list shows only what is left. I can reopen one I disagree with. | [09](scenarios/09-close-a-note-with-a-reason.scenario.yaml) | Slice 2 (`notes`, quiet) |
| 5 | **See the change first.** When I ask for a token correction to what I pointed at, I want it rendered before it is written and shown to me, so that I judge the result on the screen and not a token value. Layout, copy and markup fixes are not covered ([section 10](#10-limits)). | [05](scenarios/05-see-the-change-first.scenario.yaml) | Slice 3 (`preview`) |
| 6 | **Name what else moves.** When a correction for the element I pointed at would also change other elements, I want those named before it is written, so that a fix for one thing does not quietly move another. | [06](scenarios/06-name-what-else-moves.scenario.yaml) | Slice 3 (`preview`) |

## 4. Design

### 4.0 Shared conventions (confirmed)

Shared with [Design Decisions](../design-decisions/design-decisions.proposal.md) and
[Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md); confirmed by
the owner on 2026-11-21 (`#1132`) and 2026-11-22:

- **Ids.** A record a person or an agent writes has a random id: `note-`, `pt-` or `dec-` and 12
  lowercase Crockford base-32 characters (`0123456789abcdefghjkmnpqrstvwxyz`, excluding `i`, `l`,
  `o`, `u`; scenarios match `/^[0-9a-z]{12}$/`), so records made on two branches cannot collide.
  Captured data is content-addressed (`set-` and 12 hex characters).
- **Storage.** Committed records live under `specimens/` (`specimens/notes/<id>.json`, and
  Design Decisions' `specimens/decisions/<id>.json`); commands write files and never run
  `git commit`. Ephemeral working data lives under `.specimen/`: points (`.specimen/points/<id>.json`),
  impact screenshots (`.specimen/impact/<id>/`), and capture sets. `.specimen/` is gitignored
  ([#1132](https://github.com/lushly-dev/afd/issues/1132)).
- **Mutation.** Every command that writes a file is declared a mutation (`mutation: true`).
- **`SPECIMEN_NOT_FOUND`** names the nearest specimen ids in its suggestion, rather than pointing
  at an unfiltered `specimen-list`, which runs to tens of thousands of tokens on a large project.
- **The MCP host** is [`endpoints/specimen-server`](../../../../endpoints/specimen-server/README.md)
  (`#1320`), which serves `@lushly-dev/specimen-afd` over stdio with a long-lived browser bench.
  Agents use `specimen-server` for interactive pointing and staleness checks; `endpoints/specimen-cli`
  remains one-shot with no CLI bench daemon in Slice 1.

### 4.1 One rule for what is selected

One shared function decides which element a hit selects, and both the review page and
`specimen-point` use it, so a click and a named target agree:

- **Meaningful** means an element with a role, an accessible name, or a custom element tag —
  excluding decorative or `aria-hidden="true"` elements (such as icons) inside an interactive role.
- **Two-step climb (normal click and named targets):**
  1. Starting from the hit, climb to the nearest meaningful ancestor (stopping at the hit itself if
     it is meaningful and not a decorative icon inside an interactive role). So a click on an
     `<svg>` or decorative `<violet-icon>` inside a `<button>` first reaches the `<button>`.
  2. From that element, climb while the parent is a custom element whose shadow root contains no
     other meaningful element outside the subtree we came from. So the inner `<button>` inside
     `example-button` climbs to `example-button`.
- **The hit's role and name are kept.** A point's `element` is the final selection; its
  `accessible` carries the `role`, `name` and `from` path of the accessibility node. Naming
  `{ role: "button", name: "Share" }` resolves through the accessibility tree to the inner button
  and climbs to the exact same `example-button` a click selects.
- **Deepest on request.** A modifier click, or `depth=deepest` in a pointer, skips both climb
  steps and selects the raw hit.

### 4.2 Picking on the review page

The preview gains a **Pick** mode. The first click selects by the two-step climb in 4.1. A click
inside the current selection steps one level deeper; a click outside starts again; a modifier click
picks deepest; Escape selects the parent. The page outlines the selection, shows its breadcrumb path
(`toolbar › Share › icon`) and a **Copy pointer** button.

A **pointer** is one line of text the person pastes into the conversation or a CLI call:

```text
specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1&text=Share&pin=0.42,0.58
```

Pointer URI wire grammar:

```text
specimen:<specimenId>?<contextParams>#ref=<positionalRef>[&text=<uriEncodedHint>][&depth=deepest][&pin=<x>,<y>]
```

- `<specimenId>`: required specimen id.
- `<contextParams>`: URL query parameters naming the preview context (`theme`, `viewport`,
  optional `checkpoint`, `locale`, `motion`, etc.).
- `ref`: required positional path computed identically to Specimen captures.
- `text`: optional short text hint (URL-encoded, capped at 200 chars on decode).
- `depth=deepest`: optional flag; when present, `specimen-point` skips the climb.
- `pin=<x>,<y>`: optional fractional coordinates in `[0, 1]` relative to the selected element's
  bounding box (`0.5,0.5` when omitted or when pointing by `{ role, name }` / `{ selector }`).
- Malformed scheme, missing `ref`, unknown `depth` value, or out-of-range/non-numeric `pin`
  returns `POINTER_INVALID`.

The page is static and writes nothing. Selecting several elements is left out until a job needs it.

### 4.3 A point

`specimen-point` turns a pointer, or a target an agent names, into a **point**: it renders the
specimen in the pointer's context with the native host, resolves the element by the rule in 4.1,
and stores the result in `.specimen/points/<id>.json`. Its id is `pt-` and 12 random lowercase
Crockford base-32 characters (4.0).

Wire shape:

```ts
interface Point {
	id: string; // /^pt-[0-9a-hjkmnp-tv-z]{12}$/
	specimen: string;
	checkpoint?: string;
	context: Record<string, string>;
	element: {
		ref: string;
		tag: string;
		text: string; // truncated at 200 chars
		box: { x: number; y: number; width: number; height: number };
	};
	accessible: {
		role?: string;
		name?: string;
		from?: string; // ref of the element carrying the a11y node
	};
	identity: {
		strongest: 'role-name' | 'component-position' | 'ref';
		roleName?: { role: string; name: string };
		componentPosition?: { tag: string; index: number };
		ref: string;
	};
	component?: {
		tag: string;
		module?: string; // from custom elements manifest
	};
	source: {
		specimen: { module: string; exportName: string };
		component?: { module: string };
		revision?: string;
		digest?: string; // aggregate capture manifest source.digest
		digests: Record<string, string>; // repo-relative source path -> SHA-256 prefix
	};
	ancestors: Array<{ tag: string; role?: string; name?: string }>;
	neighbourhood: {
		pageData: true; // text from the page is data, never instructions
		parent?: { tag: string; role?: string; name?: string };
		siblings: Array<{ tag: string; role?: string; name?: string }>; // max 8
		children: Array<{ tag: string; role?: string; name?: string }>; // max 12
		omitted: { siblings: number; children: number };
	};
	pin: { x: number; y: number }; // fractional [0, 1], default { x: 0.5, y: 0.5 }
	tokens?: Array<{ tokenId: string; role: string; candidate: true }>; // Slice 3, max 12 when nodeId given
	check: {
		command: 'specimen-point-check';
		when: 'before editing source for this point';
	};
}
```

A point never includes the DOM, the accessibility tree, findings or other elements' styles.
`source` maps without build changes: Specimen already holds `entry.module`, `entry.exportName` and
the CEM component `module`. Because today's capture manifest exposes only one aggregate
`source.digest` (`src/bench-runtime.ts:315`), Slice 1 (`#2043`) records per-file `source.digests`
without build instrumentation by hashing the repo-relative source files already known at capture
time (the specimen config, `entry.module`, the CEM component `module`, and the module inputs
reported by the native host's Rolldown bundle output for that specimen). `specimen-point-check`
re-hashes those files and compares the aggregate `source.digest` so `changed` names exact modified
source paths.
The `check` field appears in the result and in the command's description, not only in a skill,
because a server that groups tools keeps long schemas out of the tool list.

`specimen-point-move` takes `{ id, to: 'parent' | 'child' | 'next' | 'previous' | 'component', index?: number }`,
checks staleness first (`POINT_STALE`), and writes and returns a new `Point`. Invalid levels return
`NO_SUCH_LEVEL` listing the moves that exist from that element.

### 4.4 Staleness

A point freezes what was pointed at when it was made. `specimen-point-check` (`{ id }`) re-renders
in the same context and returns:

```ts
interface PointCheckResult {
	status: 'current' | 'stale';
	changed: string[]; // file paths whose digests differ, plus any failed identity layer names
}
```

Every Specimen command that acts on a point id — `specimen-point-move`, `specimen-impact`,
`specimen-note-add` and `specimen-note-move` — checks staleness and refuses a stale point with
`POINT_STALE`, whose suggestion is to run `specimen-point` to point again.

Specimen cannot stop an agent editing a source file; [section 10](#10-limits) says so. Agents
should run `specimen-point-check` through `endpoints/specimen-server` (warm bench); one-shot calls
through `endpoints/specimen-cli` launch a browser bench per invocation.

### 4.5 Previewing a correction (Slice 3)

`specimen-impact` is T09's planned command ([#1211](https://github.com/lushly-dev/afd/issues/1211)),
taking an offline snapshot and the input `changes.impact` takes. Slice 3 adds an optional `point`
input (mutually exclusive with `{ id, context }`). Without `point`, every changed element is
reported under `outside`. It asks Violet for the after values, applies them as custom-property
overrides at the specimen's root, renders before and after, writes the two PNGs under
`.specimen/impact/<id>/`, and returns:

```ts
interface SpecimenImpactResult {
	status: 'changed' | 'no-change-observed' | 'insufficient-evidence';
	tokens: Array<{ tokenId: string; property?: string; applied: boolean }>;
	element?: { changed: string[] }; // computed CSS properties changed on pointed element
	outside: Array<{ tag: string; role?: string; name?: string; changed?: string[] }>;
	screenshots: { before: string; after: string };
	preview: string; // relative review-page URL with overrides= applied at root
	apply: Array<{ command: string; input: Record<string, unknown>; cli: string }>; // Violet's ApplyStepSchema unchanged
}
```

A token with no custom property on the page is listed with `applied: false`, never silently
dropped. Invalid Violet changes return `CHANGE_INVALID` carrying Violet's reason from
`changes.impact`. Preview covers token changes only; layout, copy and markup fixes are source
edits with no preview here.

### 4.6 Notes (Slice 2)

A note is a committed file beside the specimen configuration (`specimens/notes/<id>.json`), so it
is reviewed in a pull request with the change that resolves it. Commands write files and never run
`git commit`. Its id is `note-` and 12 random lowercase Crockford base-32 characters (4.0).

Wire shapes:

```ts
type NoteOutcome = 'fixed' | 'declined' | 'duplicate' | 'obsolete' | 'withdrawn';

interface Note {
	id: string; // /^note-[0-9a-hjkmnp-tv-z]{12}$/
	text: string;
	subject: {
		specimen: string;
		checkpoint?: string;
		context: Record<string, string>;
		accessible: { role?: string; name?: string; from?: string };
		identity: Point['identity'];
	};
	pin: { x: number; y: number }; // fractional [0, 1], default { x: 0.5, y: 0.5 }
	state: 'open' | 'resolved';
	orphaned: boolean; // orthogonal to state: an open note can be orphaned
	assignee?: string; // 'agent' or a person's name
	resolution?: {
		outcome: NoteOutcome;
		reason: string;
		evidence?: { revision?: string; capture?: string };
	};
	history: Array<{
		change: 'moved' | 'resolved' | 'reopened';
		reason: string;
		outcome?: NoteOutcome; // set on 'resolved' entries
		evidence?: { revision?: string; capture?: string }; // set on 'resolved' entries when provided
		at?: string;
	}>;
}

interface NoteResolveResult {
	resolved: Note[];
	skipped: Array<{
		id: string;
		code: 'NOTE_ALREADY_RESOLVED' | 'NOTE_NOT_FOUND';
		reason: string;
	}>;
}

interface NoteCheckResult {
	checked: number;
	orphaned: string[];
	weakened: string[];
	unchecked: Array<{
		specimen: string;
		reason: 'render-failed' | 'specimen-missing';
		notes: string[];
	}>;
	restored: string[];
}
```

- `specimen-note-add` takes `{ point | pointer, text, assignee? }`. Empty `text` fails with
  `NOTE_EMPTY`. A stale `point` fails with `POINT_STALE`. `pin` comes from the point/pointer's
  fractional coordinates (defaulting to `{ x: 0.5, y: 0.5 }`).
- `specimen-note-list` returns open notes by default (`state: 'open'`), filtered by optional
  `specimen`, `state`, `assignee`, `orphaned`, paged with `limit` (default 20, max 100) and
  `after` / `next`.
- `specimen-note-check` re-resolves each open note's subject:
  - Missing or ambiguous subject sets `orphaned: true` (never moved by guesswork); re-resolving
    clears the flag and lists the id in `restored`.
  - Resolving only by a weaker identity layer (e.g. role+name gone, component+position matches)
    lists the id in `weakened`, not `orphaned`.
  - A specimen that fails to render or no longer exists orphans nothing and appears in `unchecked`
    with `render-failed` or `specimen-missing`.
- `specimen-note-move` takes `{ id, point | pointer, reason }` (`REASON_REQUIRED`, `POINT_STALE`),
  re-pins the note, clears `orphaned`, and appends a `moved` entry to `history`.
- `specimen-note-resolve` takes `{ id | ids, outcome, reason, evidence? }` (`REASON_REQUIRED`) and
  **on success, always** returns `NoteResolveResult` (`{ resolved, skipped }`). On a single `id`
  that is missing or already resolved, it fails with `NOTE_NOT_FOUND` or `NOTE_ALREADY_RESOLVED`
  (suggesting `specimen-note-reopen` or `specimen-note-add`); on bulk `ids`, missing or
  already-resolved entries are returned in `skipped` with `code: 'NOTE_NOT_FOUND' | 'NOTE_ALREADY_RESOLVED'`.
- **The way back.** `specimen-note-reopen` takes `{ id, reason }` (`REASON_REQUIRED`,
  `NOTE_NOT_RESOLVED`), reopens the note and preserves the prior resolution in `history`. Withdrawing
  a note resolves it with `outcome: 'withdrawn'`. Editing a note's text stays a direct git edit.

## 5. Command contracts

All commands live in Specimen, bound in `integrations/specimen-afd`, mapped in
`endpoints/specimen-cli` (one-shot), and served by `endpoints/specimen-server` (warm bench).

| Command | Slice | Mutation | Input | Result | Jobs |
| --- | --- | --- | --- | --- | --- |
| `specimen-point` | 1 | Yes, writes a point | `pointer`, or `id`, `context`, optional `checkpoint` and `target` (`{role, name?}` or `{selector}`); Slice 3 adds optional Violet `nodeId` | `{ point }` (4.3) | 1, 2, 3, 4, 5, 6, 8 |
| `specimen-point-move` | 1 | Yes, writes a point | `id`, `to` (`parent`, `child`, `next`, `previous`, `component`), optional `index` | `{ point }` | 2, 4 |
| `specimen-point-check` | 1 | No | `id` | `PointCheckResult` (4.4) | 4 |
| `specimen-note-add` | 2 | Yes, writes a note | `point` or `pointer`, `text`, optional `assignee` | `{ note }` (4.6) | 7 |
| `specimen-note-list` | 2 | No | Optional `specimen`, `state` (default `open`), `assignee`, `orphaned`, `limit`, `after` | `{ notes, next? }` | 7, 8, 9 |
| `specimen-note-check` | 2 | Yes, updates `orphaned` | Optional `specimen` | `NoteCheckResult` (4.6) | 8 |
| `specimen-note-move` | 2 | Yes, updates a note | `id`, `point` or `pointer`, `reason` | `{ note }` | 8 |
| `specimen-note-resolve` | 2 | Yes, updates note(s) | `id` or `ids`, `outcome`, `reason`, optional `evidence` | `NoteResolveResult` (`{ resolved, skipped }`) | 8, 9 |
| `specimen-note-reopen` | 2 | Yes, updates a note | `id`, `reason` | `{ note }` | 9 |
| `specimen-impact` | 3 | Yes, writes screenshots | `point`, or `id` and `context`; `nodeId`, `changes` (as `changes.impact`) | `SpecimenImpactResult` (4.5) | 5, 6 |

| Error | From | Recovery the suggestion names |
| --- | --- | --- |
| `POINTER_INVALID` | `specimen-point`, notes taking a pointer | Copy the pointer again from the review page |
| `SPECIMEN_NOT_FOUND` | `specimen-point`, `specimen-impact` | The nearest specimen ids |
| `TARGET_NOT_FOUND` | `specimen-point` | Point again in the review page, or name a role and name that exist |
| `TARGET_AMBIGUOUS` | `specimen-point` | Add a name, or point in the review page; the count of matches is given |
| `POINT_NOT_FOUND` | Every command taking a point | `specimen-point` |
| `NO_SUCH_LEVEL` | `specimen-point-move` | The moves that exist from this element |
| `POINT_STALE` | `specimen-point-move`, `specimen-impact`, `specimen-note-add`, `specimen-note-move` | `specimen-point` to point again |
| `CHANGE_INVALID` | `specimen-impact` | Violet's own reason from `changes.impact` |
| `NOTE_EMPTY` | `specimen-note-add` | Say what you noticed |
| `NOTE_NOT_FOUND` | Every command taking a single note `id` (bulk `ids` on resolve records it in `skipped`) | `specimen-note-list` |
| `REASON_REQUIRED` | `specimen-note-resolve`, `-move`, `-reopen` | Give a reason: what was done and why |
| `NOTE_ALREADY_RESOLVED` | `specimen-note-resolve` (single `id`; bulk `ids` records it in `skipped`) | `specimen-note-reopen`, or `specimen-note-add` for a new observation |
| `NOTE_NOT_RESOLVED` | `specimen-note-reopen` | `specimen-note-resolve` |

`TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` need the host's single error split in two
([#2046](https://github.com/lushly-dev/afd/issues/2046)); the Patterns proposal drafts the same two
codes. Four codes appear in no scenario: `POINTER_INVALID`, `SPECIMEN_NOT_FOUND`,
`POINT_NOT_FOUND` and `NOTE_NOT_FOUND` are plain lookups with nothing to choose.

## 6. What writing the jobs changed

- **A point is stored and passed by id.** Writing jobs 4 and 7 with the whole reference as input
  made the agent repeat page content in each call. Storing it lets notes and the preview take an
  id.
- **The page writes nothing.** A static review page cannot reach the agent, so the click produces
  a pointer the person copies, and `specimen-point` re-resolves it. The running application can
  produce the same pointer later.
- **Refusal moved to where Specimen acts.** "Refuse a stale reference" cannot be kept for a file
  edit Specimen never sees. It is kept for Specimen's own commands, and the check is a command the
  agent runs before editing.
- **"Leave the rest alone" became job 6.** The scaffold's job asked the agent to change only the
  element, which no command can enforce. What can be shown is the `outside` list before a
  correction is written.
- **Job 3 is the stay-quiet job,** and job 9 adds a second: resolved notes leave the open list.
- **`specimen-point-move` exists** because job 2 has an agent side: "no, the whole button" in the
  conversation should not need a new click.

## 7. What the walk changed

One fresh reader walked the draft on 2026-11-13, covering the three seats (the person, the job
list and the calling agent). Three blockers and nine improvements, all taken:

- **One selection rule, really.** Scenarios 01 and 02 disagreed about whether `example-button` or
  its inner `<button>` was the element, and the host resolves a role to the inner one. The climb
  in 4.1 is now shared by the page and `specimen-point`, and a point keeps the hit's role and name
  as `accessible`.
- **The preview is shown.** `specimen-impact` returns before and after screenshots and a review
  page link with the overrides applied; the first draft returned only styles.
- **Orphans can be settled.** `specimen-note-move` re-pins a note, and `specimen-note-resolve`
  takes `ids` to close many with one reason. Job 8 no longer ends at detection.
- **Correction is token-only,** said in job 5 and section 10.
- **`specimen-note-add` takes a pointer,** saving a call and serving the CLI.
- **`specimen-note-check`** lists unchecked specimens instead of orphaning their notes, and lists
  notes held only by a weaker identity layer.
- **A way back:** `specimen-note-reopen`, and `withdrawn` as an outcome; text edits stay with git.
- **Note ids are random,** because notes are committed and sequential ids collide across
  branches.
- **A point names candidate tokens** from Violet's `specimen.get` when given a node, so the agent
  does not guess the token for `specimen-impact`.
- **`specimen-note-list` pages,** with `limit` and `next`.
- **The check-before-editing rule** is in `specimen-point`'s result and description.
- **The CLI** is named as touched, with the cost of a browser launch per check.
- **Partial list assertions** in the scenarios were rewritten as dotted paths, because the
  scenario evaluator compares a list under `expect.data` exactly.

An independent review of the draft followed on 2026-11-13. It found that two assertions used
step references, which the runner resolves only in `input` (now literal values), a refusal with
no suggestion, scenarios that started from points and notes without declaring a fixture (now in
`scenarios/fixtures/`), and element refs numbered across tags instead of by tag (the two buttons
are `example-button:1` and `:2`). `specimen-impact` now takes `point` optionally and is a
mutation, and the conventions shared with the other two proposals are in 4.0.

The owner walkthrough on 2026-11-22 tightened four details without adding jobs or commands:
`specimen-point-move` now checks staleness (`POINT_STALE`) so Slice 1 scenario 04 is
self-contained; the climb in 4.1 is explicitly two-step for nested hits; the pointer URI supports
optional `&pin=x,y` (default `0.5,0.5`); and `specimen-note-resolve` always returns
`{ resolved, skipped }`.

## 8. Owner decisions (2026-11-22)

1. **Where pointing happens.** Specimen's review page first; defer a live-app development overlay
   producing the same pointer URI until [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md)
   needs states no specimen reaches.
2. **Source locations.** Zero-build mapping first: the specimen's `module` and `exportName` plus
   the component's `module` from the custom elements manifest. Defer file:line template stamping to
   the live-app phase.
3. **Storage.** Ephemeral points live in `.specimen/points/` (gitignored, `#1132`); Notes live as
   committed files under `specimens/notes/<id>.json`, matching
   [Design Decisions](../design-decisions/design-decisions.proposal.md).
4. **Rendered preview.** Jobs 5–6 extend T09's `specimen-impact` ([#1211](https://github.com/lushly-dev/afd/issues/1211))
   with an optional `point` (token-only CSS custom-property overrides). No separate preview path.
5. **Typed target errors.** Split the host's error into `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS`
   in Slice 1 ([#2046](https://github.com/lushly-dev/afd/issues/2046)).
6. **Loam's copilot.** Do nothing in Loam now; `point` is the reference shape Loam phase 5 adopts.
7. **Job ranking.** Keep all 9 jobs: **Slice 1 Targeting (Jobs 1–4)** → **Slice 2 Notes (Jobs 7–9)**
   → **Slice 3 Preview (Jobs 5–6, with T09)**.
8. **Slice 1 staleness.** `specimen-point-move` checks staleness and refuses with `POINT_STALE`;
   scenario 04 asserts `POINT_STALE` on `specimen-point-move`.
9. **Climb rule.** Two-step climb on normal click; modifier-click / `depth=deepest` unchanged.
10. **Note contracts.** Optional `&pin=x,y` (default `0.5,0.5`) on pointer URI; unified
    `{ resolved, skipped }` return shape on `specimen-note-resolve`.
11. **CLI vs MCP.** No CLI bench daemon in Slice 1; document `endpoints/specimen-server` (`#1320`)
    for warm agent checks and keep `endpoints/specimen-cli` one-shot.
12. **Shared conventions & spec.** Confirmed all §4.0 conventions (random `pt-`/`note-`/`dec-` ids,
    file-writing commands as mutations, nearest-id `SPECIMEN_NOT_FOUND`, `endpoints/specimen-server`
    as MCP host). Skip a separate `spec.md` PR; wire shapes are carried here and in `scenarios/`.

## 9. Delivery slices

Tracked under Epic [#1110](https://github.com/lushly-dev/afd/issues/1110) and [STATUS.md](STATUS.md):

- **Slice 1 — Targeting (Jobs 1–4, unblocked):**
  - [#2046](https://github.com/lushly-dev/afd/issues/2046): Split host target errors into
    `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS`.
  - [#2042](https://github.com/lushly-dev/afd/issues/2042): Shared two-step climb, pointer URI
    (`&pin`, `depth=deepest`), and review page Pick mode + browser test.
  - [#2043](https://github.com/lushly-dev/afd/issues/2043): `specimen-point`, `specimen-point-move`,
    `specimen-point-check`, CLI/MCP wiring, and scenarios 01–04.
- **Slice 2 — Notes (Jobs 7–9, follows Slice 1):**
  - [#2044](https://github.com/lushly-dev/afd/issues/2044): `specimen-note-{add,list,check,move,resolve,reopen}`
    in `specimens/notes/<id>.json` and scenarios 07–09.
- **Slice 3 — Preview (Jobs 5–6, blocked on T09 [#1211](https://github.com/lushly-dev/afd/issues/1211)):**
  - [#2045](https://github.com/lushly-dev/afd/issues/2045): Point-scoped `specimen-impact`, `nodeId`
    candidate tokens, `?overrides=` preview link, and scenarios 05–06.

## 10. Limits

- **The click is not in any scenario.** Picking, levels by click and Escape, and copying the
  pointer are page behaviour. The scenarios start from the copied pointer. A browser test of the
  page covers it once built.
- **A file edit is not gated.** Job 4's refusal covers Specimen's commands. An agent that edits a
  source file without `specimen-point-check` is not stopped; the point's `check` field and the
  command's description say to check first.
- **Only token corrections are previewed.** Layout, copy and markup fixes are source edits the
  person sees after they are written.
- **The clock cannot move between steps,** so "the code changed since I pointed" is set up in each
  file's opening comment, not shown.
- **Pixels are not asserted.** Screenshots and the preview link are asserted by shape; whether the
  result looks right is for the person.

## 11. Exit criteria

- **Slice 1 ([#2046](https://github.com/lushly-dev/afd/issues/2046), [#2042](https://github.com/lushly-dev/afd/issues/2042), [#2043](https://github.com/lushly-dev/afd/issues/2043)):**
  - Every `slice` scenario (01–04) passes against the built commands.
  - The review page's Pick mode has a browser test covering first click, click inside, modifier
    click, Escape, Copy pointer, and proving a click (including on a decorative icon) and a named
    target agree on the element.
  - The host reports `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` apart (with match count).
- **Slice 2 ([#2044](https://github.com/lushly-dev/afd/issues/2044)):** Every `notes` scenario
  (07–09) passes against the built commands.
- **Slice 3 ([#2045](https://github.com/lushly-dev/afd/issues/2045)):** Every `preview` scenario
  (05–06) passes against the built commands and T09's `specimen-impact`.

## 12. Out of scope

- Live collaboration: other people's selections and cursors.
- A visual editor that writes source without an agent.
- Selecting several elements at once, until a job needs it.
- A long-lived CLI bench daemon (agents use `endpoints/specimen-server` over MCP).
