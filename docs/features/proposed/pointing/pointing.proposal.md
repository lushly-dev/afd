# Pointing: show the agent which element you mean, and see a correction before it is written

## Status

- **State:** scaffold. Written 2026-11-13 against `main` at `e5d683a8`. It states the problem,
  what exists, draft jobs and the ideas to start from. It has no design, no drafted commands and
  no scenario files yet. [STATUS.md](STATUS.md) tracks progress.
- **Verified:** nothing first-hand. [What exists today](#2-what-exists-today) comes from a survey
  another agent made on 2026-11-13 at `e5d683a8`; each claim names its file. The ideas in
  [section 4](#4-ideas-to-start-from) come from the owner's earlier editor work, read for ideas
  only.
- **Next:** the owner cuts, adds and ranks the [jobs](#3-jobs-draft) and answers where pointing
  happens ([question 1](#5-open-questions)).

| Field | Value |
| --- | --- |
| Epic | [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| Units likely touched | `foundations/specimen` (the host and the review page), `integrations/specimen-afd`, `integrations/violet-afd`, `endpoints/loam` |
| Related | [Design Decisions](../design-decisions/design-decisions.proposal.md), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), [Patterns](../patterns/patterns.proposal.md), [Specimens status](../../active/specimens/STATUS.md) (T09, T10) |
| Rank among the four | Third. It needs a surface to point from, which Design Decisions' review provides |

## 1. Problem

A person looking at a rendered screen sees the thing that is wrong. To get it fixed they
describe it in words ("the second button in the toolbar, the one next to search"), and the
agent guesses which element and which source file that means. Two jobs from the owner's tooling
guide are missing:

1. **Targeting.** No way to click an element and hand the agent a reference to it that is
   precise, stable and tied to its source.
2. **Correction.** Violet can preview what a token change does to token values, but not to the
   rendered screen, so a correction is judged after it is written.

## 2. What exists today

### Specimen

- **Captures** hold an `ElementObservation` per element (`foundations/specimen/src/types.ts:572-588`):
  `ref`, `tag`, attributes, box, scroll, styles, state and, from the native host, the
  accessibility role and name.
- **Element references are positional paths,** such as `root/shadow/violet-button:1/button:2`
  (`src/browser/capture.ts:260-271`). They change when the DOM changes. Generated ids are
  normalised (`src/normalize-ids.ts`).
- **Targets** are `{ selector }` or `{ role, name }` (`src/types.ts:43`). The host resolves a role
  through CDP's `Accessibility.queryAXTree` and a selector across open shadow roots
  (`host/src/page.rs:313-408`). Both end in one untyped error, "Target must identify exactly one
  element" (line 404): not-found and ambiguous are not told apart.
- **No source mapping.** A capture knows its specimen, module and export and the source revision
  (`src/types.ts:191-196,638-652`), but no element maps to a file or line.
- **The review page** has no inspector, overlay or click-to-select
  (`src/browser/page.ts:244-265,501`).
- **T09, Violet context and impact, and T10, the Violet lens,** are "Not started, optional"
  ([status](../../active/specimens/STATUS.md)). The Specimens proposal plans `specimen-impact`,
  taking an offline snapshot and `changes.impact`'s input
  (`docs/features/proposed/specimens/specimens.proposal.md:165`), with token links labelled
  "candidate" until impact is observed.

### Violet

- **`token.override`** takes `{nodeId, tokenId, value, reason?}` and does not run constraints.
- **`changes.impact`** (`integrations/violet-afd/src/commands/changes/impact.ts`) runs up to 50
  changes on a read-only overlay and returns the nodes reached, before and after per token, the
  effect on each, violations introduced and resolved, and the commands to apply. It previews
  token values, not anything rendered.

### Elsewhere

- **Botcore's `cdp_*` commands** (`endpoints/botcore/src/botcore/commands/cdp/`) let an agent
  inspect by selector and read the accessibility tree. There is no picker for a person. Nothing
  in the repository uses CDP's inspect mode, an element picker or source attributes.
- **Loam** has document selections (`editor-selection-set`, a text range or an item), not UI
  elements, and its copilot (phase 5) is not started (`endpoints/loam/docs/STATUS.md:46`).
- An earlier proposal, [Zero Chat Tools](../zero-chat-tools/), drafted selection commands for an
  application outside this repository. Nothing here implements them.

## 3. Jobs (draft)

For the owner to cut, add and rank.

1. **Point instead of describe.** When I see something wrong on a rendered screen, I want to
   click it and hand the agent a reference, so that I do not have to describe it in words.
2. **Choose the right level.** When my click lands on a child of what I meant, I want to move to
   the parent, a child or a sibling precisely, so that the reference names what I meant.
3. **Give the agent enough, not everything.** When the agent receives a reference, I want it to
   get the element's role and name, its component, its source location and its nearby structure
   within a budget, so that it can act without loading the whole page.
4. **Refuse a stale reference.** When the code has changed since I pointed, I want the agent's
   edit stopped and me asked to point again, so that a change never lands on the wrong element.
5. **See the change first.** When I ask for a correction, I want it previewed on the rendered
   screen before it is written, so that I judge the result and not the token value.
6. **Leave a note on an element.** When I notice something I will not fix now, I want to pin a
   note to the element for an agent to pick up later, so that the observation is not lost.
7. **Keep a note whose element is gone.** When the element a note was pinned to no longer
   exists, I want the note marked orphaned, not dropped or moved to another element.
8. **Close a note with a reason.** When an agent resolves a note, I want it to say what it did and
   why, so that I can check it.

## 4. Ideas to start from

Not a design. These are mechanisms worth carrying over, restated for a code repository where an
agent edits source files.

- **One selection rule.** The first click selects the outermost meaningful element at the point.
  A click inside the current selection goes one level deeper. A click outside resets. A modifier
  click goes to the deepest element, and Escape selects the parent. One predicate decides what
  is selectable, for both clicking and drilling, because two predicates disagree.
- **A set with an anchor.** Several elements can be selected; one is the anchor, which code that
  expects a single selection reads. A descendant of a selected ancestor is dropped before any
  operation.
- **Identity in layers.** A reference carries the strongest identity available and checks that
  it still resolves to the same element: role and name, then a source location, then a
  structural path. It is tied to the screen it was made on and refused anywhere else.
- **Freeze the target when it is sent.** The reference is captured when the person sends the
  request, not read live. It carries preconditions (the source file's hash, the element's tag and
  expected text), and the edit is refused if any no longer holds.
- **Bounded context.** Nearby structure (parent, siblings, children) goes with the reference, with
  each list capped, and is labelled as page data, not instructions.
- **Narrow edit lanes.** What was selected and asked decides what the agent may do: a single
  property, a text replacement, or a bounded change to a subtree using only listed elements and a
  fixed set of operations.
- **Notes anchor to a subject.** A note names its subject (a screen, an element) separately from
  where its pin sits, kept as a fraction of the element's box so it survives a resize. An
  unresolvable subject is flagged orphaned, apart from the note's own state. A note can be
  assigned to an agent, which reads its context and resolves it with a reason.

## 5. Open questions

1. **Where pointing happens.** Specimen's review page, the running application in development, or
   both. The review page is ours to change; the running app reaches real states.
2. **Source locations.** Stamping file and line onto elements in development builds, or mapping
   from the specimen's module and export. The first is precise and touches every build; the
   second needs no build change and stops at the specimen.
3. **Where notes live.** Files in the repository, or an Umbel plugin. This is the same question as
   where [decisions](../design-decisions/design-decisions.proposal.md#5-open-questions) live.
4. **Rendered preview.** Whether job 5 is T09's `specimen-impact`, or a new path that renders the
   candidate change and diffs it.
5. **Typed target errors.** Whether to split the host's single error into not-found and ambiguous
   now; the Patterns proposal drafts both codes.
6. **Loam's copilot.** How this lines up with Loam's phase 5, which will need the same reference.

## 6. Out of scope

- Live collaboration: other people's selections and cursors.
- A visual editor that writes source without an agent.
