# Pointing: show the agent which element you mean, and see a correction before it is written

## Status

- **State:** draft. Filled in 2026-11-13 against `main` at `f7ecbd43`: jobs, a design, ten
  drafted commands and nine scenario files that pass the three checks. Walked once by a fresh
  reader covering three seats ([section 7](#7-what-the-walk-changed)); not reviewed, not
  approved. [STATUS.md](STATUS.md) tracks progress.
- **Verified:** every claim in [What exists today](#2-what-exists-today) was read first-hand on
  2026-11-13 at `f7ecbd43`. The mechanisms in [the design](#4-design) draw on the owner's earlier
  editor work in a private repository, read for ideas only; nothing here depends on it.
- **Next:** an independent review, then the owner cuts, adds and ranks the jobs and decides
  [section 9](#9-for-the-owner).

| Field | Value |
| --- | --- |
| Epic | [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| Units likely touched | `foundations/specimen` (the host and the review page), `integrations/specimen-afd`, `endpoints/specimen-cli`; for the preview, Specimen's Violet work (T09) and `integrations/violet-afd` |
| Related | [Design Decisions](../design-decisions/design-decisions.proposal.md), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), [Patterns](../patterns/patterns.proposal.md), [Specimens status](../../active/specimens/STATUS.md) (T09, T10) |
| Rank among the four | Third. Design Decisions' review is the first surface to point from; pointing in the running application ([question 1](#8-recommended-answers-to-the-open-questions)) would not need it |

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

Read first-hand on 2026-11-13 at `f7ecbd43`.

### Specimen

- **Captures** hold an `ElementObservation` per element (`foundations/specimen/src/types.ts:572-588`):
  `ref`, `tag`, attributes, box, scroll, styles, state and, from the native host only, the
  accessibility role and name.
- **Element references are positional paths,** such as `root/shadow/example-button:1/button:2`
  (`src/browser/capture.ts:260-271`). They change when the DOM changes.
- **Targets** are `{ selector }` or `{ role, name? }` (`src/types.ts:43`). The host resolves them
  in `host/src/page.rs`, and every outcome other than exactly one element ends in one untyped
  error, "Target must identify exactly one element" (line 404): not-found and ambiguous are not
  told apart.
- **A capture knows its source,** but not per element. Its manifest has the specimen id and a
  `source.digest` over the configuration and every bundle file the page loaded
  (`src/types.ts:638-652`, `src/bench-runtime.ts:315`). An entry has its `module` and
  `exportName` (`src/types.ts:191-196`). The custom elements manifest gives each component's
  module path (`src/manifest.ts:36,113`), which `specimen-inspect` already reads.
- **The review page** (`src/browser/page.ts`) is a static index and preview, opened at
  `specimen.html?id=…&viewport=…&theme=…` from any static server. It has no inspector, overlay or
  click-to-select, and a search of Specimen finds no inspect-mode or selection code.
- **19 commands** in `integrations/specimen-afd/src/commands.ts`, each with one failure code of
  its own, such as `SPECIMEN_RENDER_FAILED`, dispatched by name (line 600). The CLI,
  `endpoints/specimen-cli`, maps its options by hand per command (`src/cli.ts:95`) and creates a
  browser bench on each call (line 338).
- **The host resolves `{role, name}`** through `Accessibility.queryAXTree` to the element the
  accessibility node belongs to (`host/src/page.rs:361-392`). For a custom element whose shadow
  root holds a native `<button>`, that is the inner button, not the custom element.
- **T09, Violet context and impact, and T10, the Violet lens,** are "Not started, optional"
  ([status](../../active/specimens/STATUS.md)). The Specimens proposal plans `specimen-impact`,
  taking an offline snapshot and `changes.impact`'s input, returning "observed render effects per
  node/state" (`docs/features/proposed/specimens/specimens.proposal.md:165`).

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
- An earlier proposal, [Zero Chat Tools](../zero-chat-tools/), drafted selection commands for an
  application outside this repository. Nothing here implements them.

## 3. Jobs

Each job is one scenario in [`scenarios/`](scenarios/). The tags `slice`, `preview` and `notes`
group them; `slice` is a tentative first slice until the owner ranks.

| # | Job | Scenario | Tags |
| --- | --- | --- | --- |
| 1 | **Point instead of describe.** When I see something wrong on a rendered screen, I want to click it and hand the agent a reference, so that I do not have to describe it in words and the agent does not guess. | [01](scenarios/01-point-instead-of-describe.scenario.yaml) | slice |
| 2 | **Choose the right level.** When my click lands on a part of what I meant, I want to move the reference to its parent, a child, a sibling or the component that contains it, so that the reference names what I meant. | [02](scenarios/02-choose-the-right-level.scenario.yaml) | slice |
| 3 | **Enough, not everything.** When I hand the agent a reference, I want it to get the element's role, name, component, source and a capped neighbourhood, and none of the rest of the page, so that it can act without loading the page and its context holds what I pointed at. | [03](scenarios/03-enough-not-everything.scenario.yaml) | slice, quiet |
| 4 | **Refuse a stale reference.** When the code has changed since I pointed, I want work on that reference refused and a fresh point asked for, so that a change never lands on the wrong element. | [04](scenarios/04-refuse-a-stale-reference.scenario.yaml) | slice, refuse |
| 5 | **See the change first.** When I ask for a token correction to what I pointed at, I want it rendered before it is written and shown to me, so that I judge the result on the screen and not a token value. Layout, copy and markup fixes are not covered ([section 10](#10-limits)). | [05](scenarios/05-see-the-change-first.scenario.yaml) | preview |
| 6 | **Name what else moves.** When a correction for the element I pointed at would also change other elements, I want those named before it is written, so that a fix for one thing does not quietly move another. | [06](scenarios/06-name-what-else-moves.scenario.yaml) | preview |
| 7 | **Leave a note.** When I notice something I will not fix now, I want to pin a note to the element for an agent to pick up later, so that the observation is not lost. | [07](scenarios/07-leave-a-note.scenario.yaml) | notes |
| 8 | **Keep an orphaned note, and settle it.** When the element a note was pinned to no longer exists, I want the note kept and marked orphaned, not dropped or moved by guesswork, so that I can see what it was about and either re-pin it or close it. | [08](scenarios/08-keep-an-orphaned-note.scenario.yaml) | notes, refuse |
| 9 | **Close a note with a reason.** When an agent resolves a note, I want it to say what it did and why, so that I can check the work, and I want resolved notes out of the open list, so that the list shows only what is left. I can reopen one I disagree with. | [09](scenarios/09-close-a-note-with-a-reason.scenario.yaml) | notes, quiet |

## 4. Design

### 4.0 Shared conventions

These are shared with [Design Decisions](../design-decisions/design-decisions.proposal.md) and
[Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), and are the owner's to
confirm:

- **Ids.** A record a person or an agent writes has a random id: `note-`, `pt-` or `dec-` and 12
  base-32 characters, so records made on two branches cannot collide. Captured data is
  content-addressed (`set-` and 12 hex characters).
- **Storage.** Committed records live under `specimens/` (`specimens/notes/<id>.json`, and
  Design Decisions' `specimens/decisions/<id>.json`). Local working data lives under
  `.specimen/`: points, impact screenshots and capture sets. `.specimen/` is not in `.gitignore`
  today and must be added.
- **Mutation.** Every command that writes a file is a mutation.
- **`SPECIMEN_NOT_FOUND`** names the nearest ids in its suggestion, rather than pointing at an
  unfiltered `specimen-list`, which runs to tens of thousands of tokens on a large project.
- **The MCP host** for Specimen's commands is the one Design Decisions adds in its
  [phase 5](../design-decisions/design-decisions.proposal.md#8-phases); these commands are served
  by it.

### 4.1 One rule for what is selected

One function decides which element a hit selects, and both the review page and `specimen-point`
use it, so a click and a named target agree:

- **Meaningful** means an element with a role, an accessible name, or a custom element tag.
- **The climb.** From the hit, go up while the parent is a custom element whose shadow root has
  no other meaningful element than the one we came from. The element reached is the selection.
  So a hit on the native `<button>` inside `example-button` selects `example-button`.
- **The hit's role and name are kept.** A point's `element` is the selection; its `accessible`
  is the role and name of the accessibility node, with `from`, the path of the element that
  carries it. Naming `{ role: button, name: Share }` finds the inner button through the
  accessibility tree and climbs to the same `example-button` a click selects.
- **Deepest on request.** A modifier click, or `depth=deepest` in a pointer, skips the climb.

### 4.2 Picking on the review page

The preview gains a **Pick** mode. The first click selects by the rule above. A click inside the
current selection goes one level deeper; a click outside starts again; Escape selects the
parent. The page outlines the selection, shows its path (`toolbar › Share › icon`) and a **Copy
pointer** button.

A **pointer** is one line of text the person pastes into the conversation or a CLI call:

```text
specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1&text=Share
```

It names the specimen, the context the preview was in, the selection's positional path
(computed the way captures compute it), a short text hint and, when set, `depth=deepest`. The
page is static and writes nothing. Selecting several elements is left out until a job needs it.

### 4.3 A point

`specimen-point` turns a pointer, or a target an agent names, into a **point**: it renders the
specimen in the pointer's context with the native host, resolves the element by the rule in 4.1,
and stores the result in `.specimen/points/<id>.json`. Its id is `pt-` and 12 random base-32
characters. A point has:

- `element`: the selection's `ref`, `tag`, `text` (cut at 200 characters) and `box`.
- `accessible`: `role`, `name` and `from`, as in 4.1.
- `identity`: the layers that identify the element, strongest first: role and name, then the
  component and its position among siblings of the same tag, then the positional path.
  `strongest` names the first layer that resolves to exactly one element.
- `component`: the nearest custom element at or above the element, with its module from the
  custom elements manifest.
- `source`: the specimen's `module` and `exportName`, the component's module, the revision, and
  the per-file digests the capture already computes.
- `ancestors`: the path to the specimen's root, each with tag, role and name.
- `neighbourhood`: the parent, up to 8 siblings and up to 12 children, each with tag, role and
  name only, the counts omitted, and `pageData: true`. Text from the page is data, never
  instructions to the agent.
- `tokens`, when the call names a Violet `nodeId`: up to 12 candidate tokens that draw the point's
  component on that node, from Violet's `specimen.get`, each with its role and `candidate: true`.
  They are candidates until a preview observes them; without a node there are none, and the agent
  does not guess.
- `check`: `{ command: specimen-point-check, when: "before editing source for this point" }`.
  The rule is in the result and in the command's description, not only in a skill, because a
  server that groups tools keeps long schemas out of the tool list.

A point never includes the DOM, the accessibility tree, findings or other elements' styles.

`specimen-point-move` makes a new point from an existing one: `parent`, `child` (with an
index), `next`, `previous` or `component`.

### 4.4 Staleness

A point freezes what was pointed at when it was made. `specimen-point-check` re-renders in the
same context and answers `current` or `stale`, with `changed`: the files whose digests differ and
any identity layer that no longer resolves to the same element. Specimen's own commands that act
on a point (`specimen-impact`, `specimen-note-add`, `specimen-note-move`) refuse a stale one with
`POINT_STALE`, whose suggestion is to point again.

Specimen cannot stop an agent editing a source file; [section 10](#10-limits) says so. Each check
renders the specimen, and from the CLI that also launches a browser, since the CLI creates a
bench per call; checking before every edit costs one launch each time.

### 4.5 Previewing a correction

`specimen-impact` is T09's planned command, which takes an offline snapshot and the input
`changes.impact` takes. This proposal adds an optional `point`. Without one it takes `id` and
`context`, and reports every changed element under `outside`. It asks Violet for the after
values, applies them as custom-property overrides at the specimen's root, renders before and
after, writes the two screenshots, and reports:

- `status`: `changed`, `no-change-observed` or `insufficient-evidence`, as `specimen-diff` does.
- `tokens`: each token, its custom property, and whether it was `applied`. A token with no custom
  property on the page is listed as not applied, never silently dropped.
- `element`: the computed styles of the pointed element that changed.
- `outside`: other elements whose styles changed, each with tag, role and name.
- `screenshots`: `before` and `after`, PNG paths under `.specimen/impact/<id>/`.
- `preview`: the review page's URL for the specimen in the point's context with `overrides=` set,
  relative to the page's build, so the person can open the change and resize it. The page applies
  `overrides` as custom properties at the root.
- `apply`: Violet's `apply` list, unchanged, so the agent writes the correction with Violet's own
  commands.

It previews token changes only. A layout, copy or markup correction is a source edit with no
preview here; the person sees it after it is written, in the review page.

### 4.6 Notes

A note is a file in the repository, beside the specimen configuration (`specimens/notes/<id>.json`),
so it is reviewed in a pull request with the change that resolves it. Its id is `note-` and 12
random base-32 characters (4.0).

- `text`: what the person noticed.
- `subject`: the specimen and the point's identity layers, kept apart from where the pin sits.
- `pin`: `x` and `y` as fractions of the element's box, so a resize does not move it off the
  element.
- `state`: `open` or `resolved`. `orphaned` is a separate flag: an open note can be orphaned.
- `assignee`: `agent` or a person's name.
- `resolution`: `outcome` (`fixed`, `declined`, `duplicate`, `obsolete`, `withdrawn`), `reason`
  and optional `evidence` (a revision or a capture).
- `history`: each move, resolution and reopening, with its reason.

`specimen-note-add` takes a point or a pointer, so a person can leave a note from the CLI in one
call. `specimen-note-list` returns open notes by default, at most `limit` (default 20, at most
100) with a `next` cursor.

`specimen-note-check` re-resolves each open note's subject:

- A subject that resolves to no element, or to several, marks the note `orphaned`. It is never
  moved by guesswork. A subject that resolves again clears the flag.
- A subject that now resolves only by a weaker layer (role and name gone, component and position
  still match) is listed in `weakened`, not orphaned.
- A specimen that fails to render or no longer exists orphans nothing: its notes are listed in
  `unchecked` with the reason (`render-failed`, `specimen-missing`).

An orphaned note is settled one of two ways. `specimen-note-move` re-pins it to a new point and
adds the move to its history. `specimen-note-resolve` closes it, and takes `ids` to close many
with one outcome and reason, returning `resolved` and `skipped`.

**The way back.** `specimen-note-reopen` reopens a resolved note with a reason, keeping the
resolution in its history. A note is withdrawn by resolving it as `withdrawn`. Editing a note's
text has no command: the file is in the repository, a direct edit shows in the pull request's
diff, and git can undo it.

## 5. Drafted commands

All are in Specimen, bound in `integrations/specimen-afd` and mapped in `endpoints/specimen-cli`.
Names, inputs and results are a draft to write jobs against; the exact contracts follow approval.

| Command | Mutation | Input | Result | Jobs |
| --- | --- | --- | --- | --- |
| `specimen-point` | Yes, writes a point | `pointer`, or `id`, `context`, optional `checkpoint` and `target` (`{role, name?}` or `{selector}`); optional Violet `nodeId` | `point` (4.3) | 1, 2, 3, 4, 5 |
| `specimen-point-move` | Yes, writes a point | `id`, `to` (`parent`, `child`, `next`, `previous`, `component`), optional `index` | `point` | 2 |
| `specimen-point-check` | No | `id` | `status` (`current`, `stale`), `changed` | 4 |
| `specimen-impact` | Yes, writes screenshots | `point`, or `id` and `context`; `nodeId`, `changes` (as `changes.impact`) | `status`, `tokens`, `element`, `outside`, `screenshots`, `preview`, `apply` (4.5) | 4, 5, 6 |
| `specimen-note-add` | Yes, writes a note | `point` or `pointer`, `text`, optional `assignee` | `note` (4.6) | 4, 7 |
| `specimen-note-list` | No | Optional `specimen`, `state` (default `open`), `assignee`, `orphaned`, `limit`, `after` | `notes`, `next` | 7, 8, 9 |
| `specimen-note-check` | Yes, sets `orphaned` | Optional `specimen` | `checked`, `orphaned`, `weakened`, `unchecked`, `restored` | 8 |
| `specimen-note-move` | Yes | `id`, `point` or `pointer`, `reason` | `note` | 8 |
| `specimen-note-resolve` | Yes | `id` or `ids`, `outcome`, `reason`, optional `evidence` | `note`, or `resolved` and `skipped` for `ids` | 8, 9 |
| `specimen-note-reopen` | Yes | `id`, `reason` | `note` | 9 |

| Error | From | Recovery the suggestion names |
| --- | --- | --- |
| `POINTER_INVALID` | `specimen-point`, notes taking a pointer | Copy the pointer again from the review page |
| `SPECIMEN_NOT_FOUND` | `specimen-point`, `specimen-impact` | The nearest specimen ids |
| `TARGET_NOT_FOUND` | `specimen-point` | Point again in the review page, or name a role and name that exist |
| `TARGET_AMBIGUOUS` | `specimen-point` | Add a name, or point in the review page; the count of matches is given |
| `POINT_NOT_FOUND` | Every command taking a point | `specimen-point` |
| `NO_SUCH_LEVEL` | `specimen-point-move` | The moves that exist from this element |
| `POINT_STALE` | `specimen-impact`, `specimen-note-add`, `specimen-note-move` | `specimen-point` to point again |
| `CHANGE_INVALID` | `specimen-impact` | Violet's own reason from `changes.impact` |
| `NOTE_EMPTY` | `specimen-note-add` | Say what you noticed |
| `NOTE_NOT_FOUND` | Every command taking a note | `specimen-note-list` |
| `REASON_REQUIRED` | `specimen-note-resolve`, `-move`, `-reopen` | Give a reason: what was done and why |
| `NOTE_ALREADY_RESOLVED` | `specimen-note-resolve` | `specimen-note-reopen`, or `specimen-note-add` for a new observation |
| `NOTE_NOT_RESOLVED` | `specimen-note-reopen` | `specimen-note-resolve` |

`TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` need the host's single error split in two; the Patterns
proposal drafts the same two codes. Four codes appear in no scenario: `POINTER_INVALID`,
`SPECIMEN_NOT_FOUND`, `POINT_NOT_FOUND` and `NOTE_NOT_FOUND` are plain lookups with nothing to
choose.

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

## 8. Recommended answers to the open questions

These are recommendations for the owner to decide, not decisions.

1. **Where pointing happens.** *Recommended:* Specimen's review page first. It is ours to change,
   it renders in a known context, and a point can be re-rendered to check it. The running
   application later, producing the same pointer from a development overlay, once a job needs a
   state no specimen reaches (that is [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md)).
2. **Source locations.** *Recommended:* map without a build change: the specimen's module and
   export, and the component's module from the custom elements manifest. It stops at the
   component, not the line in its template, and needs nothing from any build. Stamping file and
   line in development builds waits for the running application.
3. **Where notes live.** *Recommended:* files in the repository beside the specimen
   configuration, reviewed in pull requests. This should follow whatever
   [Design Decisions](../design-decisions/design-decisions.proposal.md) decides for decisions, so
   the two are stored the same way.
4. **Rendered preview.** *Recommended:* job 5 is T09's `specimen-impact` with an optional point,
   not a new path.
5. **Typed target errors.** *Recommended:* split the host's error into `TARGET_NOT_FOUND` and
   `TARGET_AMBIGUOUS` in the first slice; jobs 1 and 2 need both.
6. **Loam's copilot.** *Recommended:* nothing now. The point is the reference Loam's phase 5 would
   take, and its specification can adopt it then.

## 9. For the owner

- **Cut, add and rank the jobs.** The tentative first slice is jobs 1 to 4 (`slice`): pointing,
  levels, a bounded reference and refusing a stale one. It needs only Specimen. Jobs 5 and 6 wait
  on T09; jobs 7 to 9 wait on where notes live.
- **Decide the six recommendations** in section 8.
- **Whether a point should be committed.** The draft keeps points out of the repository, as
  working state, and notes in it.
- **Confirm the shared conventions** in 4.0.

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

- Every `slice` scenario passes against the built commands, then every scenario.
- The review page's pick mode has a browser test: first click, a click inside, a modifier click,
  Escape and Copy pointer, and a click and a named target agree on the element.
- The host reports `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` apart.

## 12. Out of scope

- Live collaboration: other people's selections and cursors.
- A visual editor that writes source without an agent.
- Selecting several elements at once, until a job needs it.
