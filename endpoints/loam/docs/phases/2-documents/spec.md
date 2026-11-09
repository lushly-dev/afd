# Phase 2 specification: documents

| Field | Value |
| --- | --- |
| Phase | 2, scope, projects and documents ([architecture section 9](../../architecture.md#9-phases)). This is the second of the phase's two specifications (D35); the [scope and projects specification](../2-scope-projects/spec.md) is the first, and holds what they share: first paint, scope, the stores' rules, the URL and the phase's order |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review; the phase 2 owning agent implements |
| Read first | The [scope and projects specification](../2-scope-projects/spec.md), then the [phase 1 specification](../1-app-contract/spec.md) and D23, D46 and D49 of the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-02 and revised the same day after two independent reviews (see [Review](#review-2026-11-02)). Approved 2026-11-02 by the coordinator under the owner's delegation, with the condition that the step building 3.6's surface port gets a review focused on that boundary. Step 9, document records, implemented on 2026-11-03, step 10, the editor area and `notes`, on 2026-11-07, and step 11, New and the documents section, on 2026-11-09, open for review (below); each step's state is one line in STATUS.md's phase 2 block.
- **Last verified:** 2026-11-02 against `main` at `980cc1aa`. Evidence read beyond the [scope and projects specification's](../2-scope-projects/spec.md#status):
  - `endpoints/loam/packages/manifest/src/catalogs.ts:58-81`, `:145-151` (`documents`, `new`, `editor`, `embed` and `project-summary` served from 2);
  - `endpoints/loam/packages/manifest/src/refusal-map.ts:103-105`;
  - `endpoints/loam/packages/kernel/src/kernel.ts:58-59` (`UNJOURNALED_COMMANDS`), `:205-215` (`palette-search`), `palette-index.ts`;
  - `endpoints/loam/packages/kernel/src/apps/mounted.ts` (a mounted manifest has no surface but the rail, phase 1's 4.2);
  - `endpoints/loam/packages/chrome/src/apps/surfaces.ts:498` (`#enter`), `:850` (`#mount`), and `elements/mount.ts`, `view/view-frame.ts`, `view/channel.ts`;
  - `foundations/fast-af/packages/violet-elements/src/`: `tabs`, `tab`, `tab-panel`, `tree`, `tree-item`, `menu`, `popover`, `breadcrumb` and `listbox` exist;
  - `packages/view-state/src/registry.ts`; phase 0's specification, 8.2 (A4, A5).
- **Done:** this specification. Steps 9 and 10 (below); step 11 implemented, open.
- **Step 9, document records, implemented 2026-11-03** (its pull request is linked from STATUS.md's step line; evidence and checks there). Sections 2, 3, 4 but `document-open`, 11 at the port, and D3's, D4's and D6's units:
  - **Where the code is.** `kernel/src/late/document-types.ts`, in the `late` chunk: the registry (`buildDocumentTypes`, 2.2), 4.2's check (`find`), line 5 of an instance command with 4.4's bound first, and the `updatedAt` stamp after one that changes its document. `kernel/src/late/documents.ts`, the `late-documents` chunk, which `createLateParts`, now asynchronous, awaits inside `loadLate`: the eleven `document-*` commands and the boot-only `document-trash-expire`. `kernel/src/late/document-kit.ts` hands that chunk the functions it runs with (below). The manifest's rules are `manifest/src/document-rules.ts`, one of `loamRules`, in the one validator, so a bad type refuses the whole package; a template's `content` against its `content_schema` is `app check`'s and `app pack`'s (`cli/src/check.ts`), which also inline a `content_schema` path. The fixture is the `probe` type, `kernel/src/testing-documents.ts`, exported from `@lushly-dev/loam-kernel/testing`.
  - **The check, on every path.** A person's and an agent's calls, an app's port, a surface's port, a handler's nested client and MCP all reach `find` through the same registry and middleware, so a Beacon document named from an app in Atlas, or a Citadel document for a non-member, answers the same bytes as a missing id, first, and a person's cross-project mutation is `SCOPE_MISMATCH` naming Beacon (`kernel/src/late/documents.test.ts`, `mcp-scope.test.ts`). Through a port, `document-list` refuses another project or `all` as `SCOPE_NOT_GRANTED` **before any project is looked up,** so the answer is the same for a project that exists, is restricted or is missing.
  - **The `documents` grant** is served at the port: `document-get` and `document-list` join `appCallable`; `document-open`, `editor-get` and the link commands join with steps 10 and 12. Without it, an app reads no record (`CALL_NOT_GRANTED`), and with it no app creates, renames, moves, trashes, exports or imports one.
  - **The shell reads no content** (D79): a fixture store that records every read of `doc/` sees none but `document-move`'s one read of the row it moves. Expiry deletes the content row without reading it.
  - **Replay.** Every document command re-executes; an instance command's stamp after it runs is on the journal's tape; `document-export`'s nested query is answered from its entry; `document-trash-expire` is boot's own and replays from its entry, and stage B runs it only when a trashed record is older than the workspace's `trashDays`. `SESSION_50` is unchanged (its calls name no document command), so `session:record` did not run.
  - **The budget** is the [scope and projects specification's 2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule): first paint smaller than `main`'s, `late` within its 5,000, `late-documents` 12,016 against its 11,000 (accepted by the coordinator), and `appsMinified` raised by 4,427, approved by the coordinator.
  - **After the trust review of 2026-11-03,** whose findings the coordinator confirmed by probes:
    - **The call's own scope is decided** (its blocker). With no `project` input, `document-list`, `-create` and `-import` acted at `context.scope` unchecked, so a non-member with `{ scope: citadel }` read and wrote there, on every path. `decideAccess` on `context.scope` now runs in the middleware first for every shell command that acts at the call's scope (`AT_CALL_SCOPE`, in `late`; the [scope and projects specification's 3.4](../2-scope-projects/spec.md#34-the-order-of-a-call-d72) says so), and a restricted project and a missing one answer the same `PROJECT_NOT_FOUND`. `target` decides an absent `project` too, as a second line. The audit of every shell command found the same gap in `app-get`, `app-selection-get`, `app-selection-set` and `status-item-set`, which keep a value per project, and they take the same line. Units: person, agent, a surface's port and MCP, for each of the three commands and the four, asserting the same bytes and nothing written.
    - **`export_command` and `import_command` are each one of `instance_commands`** (2.1), `DOCUMENT_COMMAND_INVALID` otherwise, so content an import writes passes 4.2's check, 4.4's bound, the stamp and the event; `probe-import` is one, and each command has a profile case.
    - **The redaction keeps `document` only as an id,** 1 to 128 characters, and an input of any other shape is journaled as `{}`.
    - **The stamp follows the record the check found,** held by the call, never `input.document` read again after a handler that could change it; `document-list` through a port refuses `all` by name; `document-import` requires `envelope.type` to be the type.
  - **After the general review of 2026-11-03,** which found no blocker:
    - **A trash of a trashed document, or a restore of one not in the trash, changes nothing and returns no undo,** where it returned one that would change state.
    - **A restore brings back the status the document had when trashed** (deviation 11), so an archived document trashed and restored is archived again.
    - **`document-create` and `document-move` write through `check.put`,** which refuses a record with no workspace, actor or time (`checkStamped`), taking what must land with the record, its content or its moved row, in the same batch.
    - **`document-type-list`, `document-create`, `-import` and `-move` ask `canOpen` for the type's instance** at the call's or the target's scope, beside the type's own levels. No native or view instance can list `projects` (`DEPLOYMENT_INSTANCE_MISMATCH`), and only those kinds declare types, so no deployment reaches this refusal today; a unit proves the wiring over a check of its own.
    - **Guards:** a unit fails on any import in `late/documents.ts` that is not `import type` (deviation 6), and `budget` asserts first paint's exact chunk list, so a split fails whatever its cause. `DOCUMENT_TYPE_CONFLICT` is proved through `createLateParts` into `app-get` and `app-instance-list`, the later app loaded with a notice. P2-E7's impostor is back, registered under a boot-only name in the palette registry beside the real command.
  - **After the independent re-check of 2026-11-03,** which found no blocker: **the call scope's guard loops over every registered command, not a list.** `kernel/src/scope/call-scope.test.ts`, "P2-D6: answers a restricted project as a missing one, by every command, through %s", calls every command the palette registry holds, each shell command with an input decided in the test and each app command with what its schema requires, signed out, on twin workspaces seeded with the member's document, content, selection and status value, one at Citadel and one at `prj_nowhere`, through a person, an agent and the surface ports of `dual` and `probe`. The result, the new journal entries, the events and the whole store must be identical after normalising only the project's id, the context digest and what a wall clock decides, and nothing of the member's may appear. A shell command with no decided input, or an internal one with no named reason to skip it, fails the test until someone decides it. Dropping `app-get` from `AT_CALL_SCOPE` fails it for the person and the agent.
  - **After the three reviews of 2026-11-07** (trust, accessibility, general with budget), all fixed with tests that fail on revert where they are behavior:
    - **Blockers.** `editor-move` built a state the validator refused, a preview into a group with one or a tab into a full group, and crashed: a moved preview now replaces the target's, and a full group makes room or refuses with `EDITOR_TAB_LIMIT` (G-B1). Reordering the strip with `insertBefore` blurred the focused tab: gone items go first, a kept item moves by `moveBefore` where the browser has it, focus is put back otherwise, and after `Move to a new group` it follows the tab (A-B1). `mainBusy` was not observable, so main kept `aria-busy` for the rest of the session after a restore (A-B2).
    - **Trust.** `section-get` gave a server's caller the active tab's document id: the path is derived only for a call in this page whose actor may enter the active scope (T-S1); the call-scope guard also asserts that no answer names the member's document. `document-open` decided a switch from the call's scope: it now decides from the active scope, reports `scope` only for a switch that ran, and a server's call writes the document's record alone, closing no app and moving no main (T-S2). The editor owner is the type's instance only while its document is in the active scope and its type is registered and opens there, so a disabled instance owns nothing (T-S3). A restored record keeps only tabs whose document is in its own scope and not trashed, whatever a hydration reads, and `recordOf` checks the scope (T-N1). The deep-DOM check walks every shadow root under main (T-S4).
    - **General.** A save finishing after its frame left the area never cleared dirty: a leaving frame's save clears its own tab's flag in its document's scope, frames are matched by identity, and a parked frame's timer stops (G-S1). Undoing `document-open` of a document already open closed the person's tab: deviation 15 (G-S2). The validator requires `nextTab` from 1 and `nextGroup` from 2 (G-N1); `notes-editor` saves one at a time and a re-read equal to its draft is clean (G-N2); a tab being closed mounts no throwaway frame (G-N3); a moved tab leaves its old group's parking order (G-N4); `notes-import` replaces what a note held and has an undo, since section 10 does not say "into a new note" (T-N2); `scope.callable` is set once both chunks have loaded.
    - **Accessibility.** Delete in the group that is not active keeps focus in that group (A-S1). On a Mac, Backspace, which the key labelled delete sends, closes a tab too, and `aria-keyshortcuts` and the description say so (A-S2). Busy main has a visually hidden `h1`, "Opening", so a held restore passes `page-has-heading-one` (A-S3). Tab from the menu moves on to the editor (A-N1); a pointer's menu gives focus back, on Escape, to what had it (A-N2); the menu is named "Actions for {title}" before focus enters it (A-N3); the hint is `hidden` (A-N4); Mod+S says "{title} saved" in the shell's polite region (A-N5); each tab shows its type's icon (A-N6); `pairs.ts` holds `color.control.selected.foreground` on the page and the subtle surface (A-N7); Specimen captures the group, the open menu, both frame states and `notes-editor` with its conflict notice (A-N8, the last in `apps/notes/specimens/`, since no chrome file names a type). Layout-aware chords are a Follow-up (A-N9). The CI run's `color-contrast` was a color transition sampled half way: axe now runs once every animation, in the page and its shadow roots, has finished.
  - **After the independent re-check of 2026-11-07,** which confirmed every finding fixed and found no blocker, all fixed with tests that fail on revert where they are behavior:
    - **No agent can lose a person's draft (R-S1).** An agent could mark an unsaved tab saved with `editor-dirty-set` and close it with no `discard`, and the frame went unsaved. Every editor command stays an agent's (5.4); instead, when another's call closes a tab, the chrome saves an editor that still says unsaved before it goes, a rejection a `danger` toast, whatever the kernel's flag says, and when the kernel's flag says saved while the editor still says unsaved, the chrome reports it unsaved again (deviation 16). The chrome-only commands' descriptions name them the chrome's again. Chromium: an agent's mark-saved then close, refused, then with `discard: true`, and then both at once, each with the text saved.
    - **Focus stays with a tab another's call takes (R-S2).** An agent closing or moving the focused tab left focus on the page: it goes to the tab in the group it moved to, or its group's new active tab, or main when the group is empty. Both are in the strip's keyboard test.
    - **A server changes nothing the person sees unannounced (R-S3).** A server's `document-open` into the active scope made its tab active with no event, so the person's `section-get` named a document the area and the URL did not show. Every mutation a server makes now reaches the page's listeners as the kernel's event, with what the call noted, `mainChanged` among it, so the area renders and the URL follows; and a server's `document-open` into the active scope adds its tab without activating it (deviation 17). An MCP unit holds both, for `document-open` and `editor-activate`.
    - **Nits.** `settledAxe` waits for no animation without an end and names any still running at its deadline (R-N1), with a test of both; a leaving editor's save clears its tab's flag only with a record's scope, and not when that scope's tab holds a newer unsaved edit (R-N3, Chromium with the frame's save held by the test across a return and a newer edit, and with no record); a trashed or moved document is no longer trusted by the scope it left (R-N4), a unit; a tab's type icon is blank until the app surfaces register the icons, then drawn, as the rail's are (R-N5), Chromium with the surfaces held. The pull request's T-S1 row now says the MCP row is what catches it, since Citadel is never active in the call-scope guard (R-N2).
  - **After the narrow re-check of 2026-11-07,** which confirmed the re-check's fixes and found one should-fix and two nits, all fixed with tests that fail on revert where they are behavior:
    - **A trash or a move no longer loses a draft (S-1).** An agent's or a server's `document-trash` or `document-move` of an open document closed its tabs before the chrome's save, which was then refused with `DOCUMENT_TRASHED` or `DOCUMENT_NOT_FOUND`. Both are now refused with `EDITOR_TAB_DIRTY` while any tab of the document holds an unsaved mark, in any scope's record, naming `editor-close { tab, discard: true }`, which saves first; an agent or a server may no longer mark an unsaved tab saved; and another's `editor-close` keeps the mark until the chrome's save clears it, so a trash at once after it waits (deviation 16, the refusal of an agent's `dirty: false` one marked check for the owner). Units through `kernel.agent` and MCP; Chromium: an agent's trash, move and mark refused with the text kept, the person's Mod+S then a trash that runs and a restore holding the text, and an agent's discard close whose save clears the mark before a trash runs.
    - **Nits.** A server's `document-open` that activates its tab in an empty area main shows notes `mainChanged: 'replace'`, so the URL follows it (N-1, an MCP unit); the chrome's re-report of unsaved carries its document's scope (N-2, with no test, since the rendered scope and the active one differ only between a read and the call). A server's event reaches the page only when the page's actor may enter the call's scope (deviation 17, an MCP unit with a project only `local` may enter).
  - **After the second narrow re-check of 2026-11-07,** which found one should-fix and four nits, all fixed, every behavior fix with a test that fails on revert:
    - **No leftover mark (should-fix).** A clean tab an agent marked unsaved and closed left its mark, so trash and move were refused until reload, suggesting an `editor-close` of a tab that no longer existed: the clean editor now clears it from the person's page. A save that rejects after another's close no longer drops the draft: the editor takes a new tab of its document, unsaved, beside the toast, and the closed tab's mark goes (deviation 16 says exactly when it cannot). For a closed tab the refusal names no `editor-close`. Chromium: the clean tab's leftover mark, then a trash that runs; a rejecting save whose draft comes back whole in `t2`, a trash refused naming `t2`, the person's Discard, then a trash that runs.
    - **N1.** The unsaved check runs inside `closeDocument`, after its last wait and in the same step as the close, refusing rather than clearing marks; a unit holds that the person's `dirty: true` in the same tick as an agent's trash ends with the trash refused. **N2.** A server's event is emitted when the page's actor could enter the call's scope before the call or can after it, so a call that takes the person out of a project is heard; an MCP unit. **N3.** Deviation 16 and 5.5 state the guarantee exactly. **N4.** N-2's test: the area's `editor-get` answer held on a gate across the person's switch to Atlas, its re-report journaled at the workspace and Atlas's `t1` still clean; and `EDITOR_TAB_DIRTY` says the person has unsaved changes, naming no type's save, which an agent's save cannot stand for.
  - **After the third narrow re-check of 2026-11-07,** which found three should-fix items, two avoidable exceptions and three nits, all fixed, every behavior fix with a test:
    - **SF-3, concurrent calls.** Each editor command read its record in one step and wrote it in a later one, so two at once undid each other: `read` now hands the record to the command in the step that reads it, which writes before any wait. Units: two agents' closes at once; an agent's close racing the person's mark; five mutations of distinct tabs at once; an agent's trash racing the person's mark, in both orders. Each fails with a wait put back between the read and the write.
    - **SF-1, two rejected saves.** The frames waiting for a new tab are kept by document, each removing only its own; and one in the background takes its tab directly. Chromium: two active tabs in two groups, both saves held and rejected together, both drafts back. It fails against the shape the re-checker probed, one slot and no direct take; each fix alone keeps both drafts there, so the test cannot fail with only one of them reverted.
    - **SF-2, the person dragged back.** The reopen is `document-open`'s new `stay`, the person's page's alone (since the fourth narrow re-check, not an app's port or a nested call either), refused once main no longer shows the document's scope, and never switching the scope, closing an app or changing main. Units: an agent's and a server's `stay` refused, the person's in the background activating nothing, and refused after a switch, leaving the person there; Chromium: the toast and the area's read of the scope held on a gate across the person's switch to Atlas, which they keep.
    - **E-1 and E-2.** A rejected draft whose document is open in the active group takes that tab when its editor is clean, or opens beside it when not; a parked editor whose save rejects goes back into its tab. Chromium, one each.
    - **Nits.** The open tab's suggestion says a rejected draft comes back, so the agent asks the person (N-1); a reopen activates its tab only when the closed tab was the active one, else in the background with no URL move, a Chromium test with two background drafts (N-2); deviation 16 and 5.5 state what holds exactly, and STATUS.md matches (N-3).
  - **After the fourth narrow re-check of 2026-11-07,** which found three should-fix items and three nits, all fixed:
    - **SF-A, a trash just after the clear.** The tab a rejected draft lands in is marked unsaved before the closed tab's mark goes, on every path, so a trash or a move between meets a mark. Chromium: an agent's trash fired the moment the closed tab's mark clears, refused, with the draft kept, on the new active tab, the background, the clean take and beside; without the explicit mark the clean take and the background fail, while the other two pass, as the open's second render marks them first.
    - **SF-B, document records.** Each record's changes run one at a time (deviation 18). Units, both orders: a trash and a rename, a move and a trash, an update and a rename, a restore and an update, and an instance command's stamp held on a read across a rename. Without the chain, the first two fail in both orders, the update in one, and the stamp; a restore and an update cannot lose one another, since `document-update` refuses a trashed document.
    - **SF-C, ports.** `person` also requires no caller and no parent, so an app's port, which runs on the palette's interface, cannot use `stay`; no port can call `editor-dirty-set`. A unit: the port's `stay` refused (failing without the fix), a nested `document-open` refused before it reaches `stay`, a nested `dirty: false` not granted.
    - **Nits.** `editor-selection-set` reads the record first and writes in the step that finds the tab still open, a unit with a close racing it (NIT-1); a rejected draft takes its document's clean tab in any group, a Chromium test with three groups, and a full group retries beside, untested (NIT-2); this list's order and the suggestion's wording (NIT-3).
  - **After the fifth narrow re-check of 2026-11-07,** which found two should-fix items and a nit, all fixed with tests that fail on revert:
    - **SF-1, an instance save racing a move.** A type's instance mutation's check, its handler's write and its stamp now run together in the document's chain, so a move waits for the save, or the save waits for the move and is checked against the scope it left; the stamp no longer chains itself, so nothing waits on its own chain. Nested mutations are refused at the port and instance queries are not chained, so nothing chained waits on itself. A unit: the app's write held on a gate, a move asked for meanwhile, then released: the move waits, Atlas holds `v2-saved`, and no row of the content is left in the old scope.
    - **SF-2, a parked draft shown again.** A parked editor still saving is kept by tab; a tab shown again meanwhile takes it back, with its draft, and its retiring treats it as kept. Chromium: ten opens park a held draft, the person shows its tab, the save rejects, and the tab holds the draft.
    - **Nit.** Deviation 16 says a beside reopen is always active and moves the URL and the active group; `budget.mjs` carries each raise's approval.
  - **After the sixth narrow re-check of 2026-11-07,** which found one should-fix, a related case and two doc nits, all fixed with tests that fail on revert:
    - **SF-A, parked again.** A frame taken back, edited and parked again ran a second leave beside the first, whose end cleared the tab's mark and disposed the frame under the second save. A frame now leaves once at a time: a second retire records itself and re-adds the frame to the parking map, and runs once the first settles, unless the tab took the frame back; a leave with another waiting leaves the parking entry and the frame to it; a frame is disposed only when it is in neither map; and the mark is cleared only when its editor reported no edit after its save began, counted per frame (a frame off the page after a change of scope reports none, so its save still clears it). Chromium: parked with its save held, taken back, edited, parked again, the first save resolved: the tab stays unsaved, a trash is refused, and when the second save rejects the same frame, drawn, holds "AB". It fails with either the single leave or the edit count reverted; a first build that read the frame's own unsaved flag instead failed the scope-change test, whose frame, off the page, never hears its editor's clean report.
    - **The reopen and a parked editor.** A tab whose parked editor is still saving counts as unsaved in `#reopen`, so a rejected draft goes beside rather than into it. Chromium: the same note parked with its save held in one group and closed beside with its save held; the beside save rejects first and its draft lands in a new tab, and then the parked one rejects and keeps its own.
    - **Doc nits.** The scope and projects specification credits the fifth raise of `editorMinified` to the parked editor taken back, the chain's cost being `late`'s; deviation 18 says a native handler that never answers holds its document's chain, a Follow-up.
  - **After the seventh narrow re-check of 2026-11-08,** which found a blocker and a should-fix from one weakness, a frame's place spread across two maps and a leave's bookkeeping, the patches gave way to one lifecycle:
    - **The lifecycle.** Each frame has one life: the scope key it was made in, one place (`shown` in `#frames`, `parked` in `#parking`, `leaving` in neither, `disposed`), its editor's edits, and a leave asked again. One function, `#move`, takes a frame out of both maps and puts it in the one its place names, or disposes it, once. A frame of another scope than the one rendered only leaves, as `left`, and goes: it never enters the scope's maps, never reopens, and reports no mark there; the re-report after a render touches only frames of the scope rendered. One leave at a time: asked again while one runs, it runs once that settles, unless its tab took the frame back. A kept frame leaves `#parking` in the same move that puts it in `#frames`. A draft that cannot be kept takes its tab's mark with it.
    - **B-1, a frame in the wrong scope.** A frame parked again in the workspace, with its first save pending, then a switch to a project whose own note is its `t1`: the queued leave ended as `left`, and Elsewhere's `t1` is There's, with no mark reported again and again. Chromium: Elsewhere's frames hold There and not First, `t1`'s draft is not the workspace's, the journal stops growing and holds no `editor-dirty-set`, and the workspace draft, whose save then rejects, is lost after its toast, the scope-change case of deviation 16.
    - **S-1, a frame left in the parking map.** Kept back with a park queued, then saved, then its note opened beside and closed by an agent with its save rejecting: one frame of the note is on the page, `t1`'s. Chromium.
    - **The invariants**, checked by `frameViolations` in the documents suites after every `editorIdle`, so in every editor test: every frame in `#frames` or `#parking` is of the scope rendered and in its place for that map; none is in both; none in a map is disposed, or off the page while the area shows; every mounted frame is in a map or leaving with its save in flight; every tab the active scope marks unsaved has a frame in a map, a leave under way, or the person's own close running. A seeded walk (mulberry32, seed `0x5eed10`, 200 steps of parking, taking back, typing, a save resolved, rejected or held, a switch of scope, an agent's close and an open beside) checks them after each step. B-1 and S-1 fail against the controller before this round; the walk passes there only because that controller has no lifecycle to check.
    - **Nits.** The SDK's editor contract and its copy here say the `dirty` event is dispatched on each edit; deviation 16 says a frame parked again goes back into its tab when its first save rejects.
  - **After the independent review of the lifecycle, 2026-11-08,** which confirmed `#frames`, `#parking` and the dispose are written only in `#move`, and reproduced two blockers and three should-fix items that the five invariants missed, all fixed with tests that fail on revert:
    - **B1, a parked editor's tab closed by an agent.** The render's loop over closed tabs now moves a parked frame whose tab is gone out of `#parking`, and its leave, finding the tab gone, ends as a close's: a rejected save reopens the draft, its tab marked before the closed tab's mark goes. Chromium: a held save, ten opens, an agent's discard close, the save rejects; the draft comes back and a trash is refused.
    - **B2, the person's close across a change of scope.** The close keeps the scope and visit it began in, passes that scope to `editor-close`, and `#closing` holds `<visit> <tab>`; `close-others` stops at a change of scope. Chromium: Here's close held while the person goes to Atlas, whose `t1` is There; Here's tab closes in the workspace and Atlas keeps its own.
    - **SF3, a leaving editor on the page.** A frame goes off the page as it starts leaving. Chromium: a closed active tab's editor is hidden while its save runs.
    - **SF4, a scope round trip.** A life holds the visit it was made in, and `#dropAll` starts a new one and turns every leaving frame's queued leave into `left`, so a frame of an earlier visit is never here. Chromium: a queued park held across Atlas and back never returns to `#parking`; it fails only with both defenses reverted.
    - **SF5, a mark no editor holds.** After a render, and while an app shows, the person's page clears the mark of any tab of the scope rendered with no frame, no leave and no close of the person's. Chromium: after a reload, an agent's `dirty: true` on a tab with no editor clears, and a trash runs.
    - **Nits.** `#move` refuses a slot another frame holds; autosave timers are keyed by frame; the `lifecycle` getter, kept in production, folds in the older `frames` getter, and holds the visit and the state rendered. The controller's helpers and types moved to `editor-parts.ts`, in the same chunk, which keeps `editor.ts` under the 1,000-line limit.
    - **The nine invariants**, `frameViolations`, checked after every `editorIdle`, which now waits until the controller's queue holds still: (1) every frame in `#frames` or `#parking` is of this visit, in its place for that map, under its own tab; (2) none is in both; (3) none in a map is disposed, or off the page while the area shows; (4) a mounted frame in no map has its save or its reopen under way; (5) every tab the active scope marks unsaved has a frame in a map, a leave under way, or the person's own close running; (6) a group shows at most one frame, its active tab's, and no leaving or parked frame shows; (7) every key of `#frames` and `#parking` is a tab of the state rendered; (8) every group's active tab has a frame in `#frames`, unless its close or leave is under way; (9) a frame in `#frames` whose editor says unsaved has its tab marked unsaved. The existing tests all pass under them.
    - **The walk**, mulberry32 on seeds `0x5eed10`, 1, 2, `0xdeadbeef` and 42, 200 steps each, checking the nine after every step, drawn from parking, taking back, typing, a save resolved, rejected or held, a switch of scope (round trips among them), an agent's `editor-move`, `editor-close` with or without `discard`, `editor-dirty-set`, `document-trash` and `document-move`, the person's close with Discard or Keep editing, `pagehide`, a held `editor-get`, a reload, a switch to an app and back, and an open beside, up to three groups; the eleventh editor's park comes of parking. The five take 197 s together, about 40 s each. A failure names its seed, its step and every step before it. Its first runs found the SF5 case while an app shows, now fixed.
  - **After the re-check of 2026-11-08,** which confirmed the review's fixes and found a blocker and a should-fix, both reproduced, all fixed with tests that fail on revert:
    - **The person's Discard and a reopen.** The person's close took its tab's editor before awaiting its save and the modal, and then disposed it even after a reopen had given it to another tab. It now disposes the editor only while it is still the tab's, in `#frames` or `#parking`, through `#move`. Chromium: the person's close and an agent's of the same tab, both saves held and rejected, the draft reopened in `t2`, then Discard: `t2` keeps its editor, its draft and its mark. The walk's seed 9, which found it, is one of its seeds now.
    - **A round trip and a held save.** `#unmark` cleared the mark of a tab whose editor, of the visit before, still saved. A leaving editor of the scope rendered, of any visit, now keeps its tab's mark, and invariant 5 counts it. Chromium: Alpha typed with its save held, Beta active, Atlas and back, then a trash of Alpha refused.
    - **Nits.** An agent's `dirty: true` on a tab whose editor is ready and clean goes at the next render, a Chromium test with the trash then running; `editorIdle` fails when the queue does not settle in 20 rounds, rather than going on.
    - **The walk** runs on pull requests with seeds `0x5eed10`, 9, 1, 2, `0xdeadbeef` and 42, 200 steps each, now also drawing an agent's `editor-pin` and `editor-activate`, a refused `stay`, a rejected save during `pagehide`, and a tab moved while a save is held; locally the six take 215 s. A long walk is a Follow-up.
  - **After the second re-check of 2026-11-08,** which found two should-fix items, both reproduced, fixed with tests that fail on revert:
    - **A round trip with the tab active on return.** The new editor read the stored text and reported clean, which cleared the mark while the earlier visit's editor still saved the draft. One predicate, an editor of the tab and the scope rendered, of any visit and the same document, still leaving or parked, now keeps the mark in both branches of `#unmark` and in `dirty()` before it sends `dirty: false`, which still updates the frame itself; the earlier leave's own end clears the mark. Invariant 10, a tab of the active scope whose leaving editor of that scope still saves its document unsaved is marked, joins `frameViolations`. Chromium: Alpha typed with its save held, Atlas and back with Alpha active, then a trash refused.
    - **The person's Discard of an editor still leaving.** Blocker 1's guard skipped the dispose when another's close had taken the editor, so a rejected save afterwards reopened the draft the person had discarded. The Discard is now recorded on the frame's life, and its leave then reopens nothing and clears the mark; a save already under way may still write, as deviation 16 says. Chromium: the person's close and an agent's of the same tab, only the person's save rejecting, Discard, then the leave's save rejecting; nothing comes back and a trash runs. Blocker 1's test keeps the other order.
    - **The walk** gains a round trip in one step and six step kinds, typing and the person's close while saves are held, a rename, an agent's close then a move, a close twice and Mod+S, and seeds 12 and 100, which fail without the round-trip fix, so its seeds are `0x5eed10`, 9, 12, 100, 1, 2, `0xdeadbeef` and 42, 200 steps each; locally the eight take 310 s.
  - **After the third re-check of 2026-11-08,** which confirmed both fixes and found two should-fix items, both reproduced, fixed with tests that fail on revert:
    - **A newer leave's clear.** Two leaves of the same tab across two round trips, the newer settling first, cleared the mark the older one still held. `#held` now takes the frame to leave out and the scope, counts only leaves whose save or reopen is under way, and also guards the leave's own final clear. Chromium: every save held, Alpha typed, a round trip, typed again, a second round trip; the newer save resolves and a trash is refused, then the older resolves and the trash runs.
    - **The person's Discard during a reopen's open.** A Discard given while the reopen's `document-open` ran was left on the frame the new tab then took. The reopen, after its awaits, now closes the new tab it opened and takes nothing when the frame is discarded; the render never adopts a discarded frame; and a tab that takes a frame clears its Discard. Chromium: the person's close and an agent's of the same tab, the reopen's open held at a gate, the leave's save then the person's rejecting, Discard, the gate released; no tab comes back and a trash runs. The control is Keep editing: the draft returns in `t2`, is edited, an agent closes it, its save rejects, and `t3` holds "Draft More". Reverting the reopen's check fails the Discard case alone; the adopt guard is a second defense that no test reaches by itself.
    - **Invariant 11** joins `frameViolations`: a marked tab whose editor of this visit is ready and clean has an older leaving editor of the same tab, document and scope whose save is under way.
    - **The walk** adds seed 20, so its seeds are `0x5eed10`, 9, 12, 20, 100, 1, 2, `0xdeadbeef` and 42, 200 steps each, checking the eleven invariants after every step; locally the nine take 334 s.
  - **After the fourth re-check of 2026-11-08,** which found no blocker and named why the marks kept producing bugs, six places each deciding a tab's mark with exceptions of their own, the six gave way to one rule and one reconciler:
    - **One rule, `wantsMark`.** A tab of a scope holds unsaved work when its editor, shown or parked, says so; when a leave of that tab, document and scope, of any visit, still holds its draft, unsaved as it began and not yet saved, kept or lost; or while the person's own close of it saves or asks. `#held`, `#unmark`'s branches, the render's re-mark, `dirty()`'s send, the reopen's mark and the leave's final clear are gone; each now changes its own state and asks the reconciler.
    - **One reconciler,** `#reconcile`, the chrome's only caller of `editor-dirty-set`, in the controller's queue: it reads the marks of the scope rendered and of each scope a leave may still owe a tab, a closed tab's among them, sets every mark the rule wants before clearing any it does not, asks the rule again before each clear, and passes `{ scope }` on every call; a burst of changes shares one pass. A mark the rule wants that the last read left unset is set at once, before any read, so an agent's trash just after typing meets it. SF5 and Nit 3, a mark an agent set with nothing behind it, are its ordinary clear; the kernel keeps refusing an agent's `dirty: false`.
    - **The Discard** is of the draft as the modal found it: recorded on the editor with its count of edits when the modal opened, and holding while no edit has followed. Its outcome no longer depends on timing: whether the reopen lands just before the click or just after, the draft goes, with the tab the reopen opened for it; an editor typed into after the modal opened is kept. The reopen closes the tab it opened only while that tab's editor is clean with no edits since. The render still never adopts a discarded editor, which the reopen's check relies on; `#take`'s reset is gone, since an edit ends a Discard.
    - **Invariant 12,** for the active scope each tab's mark equals `wantsMark` once the queue settles, joins `frameViolations`; 5, 9, 10 and 11 stay as diagnostics, 11 now also allowing the person's close saving or asking, which the rule counts. Blocker 1's test now asserts the timing-independent outcome, in two cases: untouched, the draft goes with the reopen's tab and a trash runs; typed into after the modal opened, `t2` keeps "Draft More" and its mark.
    - **The walk** settles a random held save, not the oldest, and adds holding a reopen's open at a gate and releasing it, a race of typing, the person's Delete and an agent's close of the same tab, the person's own open of an open document, an agent's `notes-content-set`, and an agent's close of a tab just typed into, once with its save rejected at once. It counts the reopens each seed reaches and fails a seed that reaches none; at this head, drafts taken by another tab plus reopen opens per seed: `0x5eed10` 7, 9 6, 12 7, 20 11, 100 2, 1 5, 2 6, `0xdeadbeef` 7, 42 12. Before the new steps, most seeds reached none; the counts held across three local runs, and the floor is 1 since CI's timing may move them. Locally the nine take 374 s; all nine run on pull requests.
  - **After the final re-check of 2026-11-08,** which found a blocker, a should-fix and two nits, all fixed with tests that fail on revert, and a test that failed once on CI:
    - **A closed tab's mark that could stay forever.** A pass dropped a tab a leave owed whenever the rule no longer wanted its mark at the pass's end, whether or not it had sent the clear; a leave letting go during the pass's later awaits lost its tab without one, and no later pass can see a closed tab. A pass now forgets an owed tab only once its mark is known gone, read unmarked or cleared by that pass, and otherwise has another. Chromium: two tabs typed, both saves held, an agent closes both; the second's save resolves, and while its clear waits at a gate the first's resolves; both trashes then run.
    - **The person's close across a round trip.** Invariant 5 counted only the person's close of this visit; it now also counts one still saving or asking, as the rule does. Chromium: Beta typed, its save held, the person's Delete; Alpha active, a round trip, Beta's leave's save rejects; Beta has no frame and no leave, and its mark holds while the close saves. Seed 32, which found it, joins the walk.
    - **Nits.** The state the immediate set reads is kept true to each mark the reconciler sends, so typing straight after a clear is marked at once; and an editor's dirty state counts only for its own document's tab, so an editor of one scope never marks another scope's tab of the same id.
    - **The CI failure** was the test: a read of the trap made once, in the gap between the new tab's mark and the closed tab's clear; it now waits for the trap's trash. No trash ever ran.
    - **Invariant 13:** once the queue settles, no tab a leave owes has the rule false, and every tab marked in a scope with a leave in flight has the rule true or is owed. Since no read lists a closed tab's mark, the walk also ends with a check: once every gate, save and modal has settled, a trash of each document no tab of either scope holds must not meet `EDITOR_TAB_DIRTY`.
    - **The walk** runs seeds `0x5eed10`, 9, 12, 20, 32, 100, 1, 2, `0xdeadbeef` and 42, 200 steps each, all on pull requests; locally the ten take 434 s. Reopens per seed: `0x5eed10` 4+3, 9 3+3, 12 2+5, 20 5+6, 32 2+2, 100 1+1, 1 2+3, 2 2+4, `0xdeadbeef` 3+4, 42 5+7.
  - **After the re-check of the final round, 2026-11-08,** which found a blocker from before it, two should-fix items and two nits, all fixed with tests that fail on revert:
    - **A scope the pass cannot read.** A pass settled every tab a leave owed in a scope it could not read, and ignored a refused clear, so signed out of a restricted project, a closed tab's mark there was dropped for good. A tab now settles only on positive evidence, a read that shows it unmarked or a clear that succeeded; a scope out of reach keeps what it owes, with no pass queued for it, and any later sync, a sign-in (an `auth-` command now syncs) or a return among them, clears it. Invariant 13 allows owed tabs of a scope the person cannot read. Chromium, closed and open: Vault, restricted to the person, a note typed with its save held, an agent's close for the closed case, sign-out, the save resolves; while away, Vault's `t1` is still owed its clear; after sign-in, before any return, nothing is owed and Vault's open tab is unmarked; after the return, a trash runs.
    - **A tab closed while an app shows.** Main showing an app ran no render, so a tab another's call closed kept its unsaved editor in `#frames` with no leave, and a trash was told the editor was saving. The area now prunes closed tabs whether or not it shows, so the leave and its save start at once; a draft whose save rejects while main shows an app or another section is kept, marked, and comes back in a tab once the documents area shows again in that visit, which deviation 16 now says. `EDITOR_TAB_DIRTY`'s suggestion for a closed tab reads "retry once its editor saves them or reopens them in a tab", true in every case. Chromium: Alpha typed with its save held, hello opened, an agent's close; the editor leaves at once; resolved, a trash runs while hello shows; rejected, a trash is refused, and once documents shows, the draft is back in `t2`. Seed 43, which found it, runs at 300 steps.
    - **The walk's end check** reads both scopes: every tab's mark must be the rule's answer, then a trash of every walk document may meet `EDITOR_TAB_DIRTY` only for an open tab the rule marks; the settle loop opens the documents area first, so a kept draft comes back.
    - **Nits.** The walk's title says its steps and thirteen invariants; the comment on an unreadable scope no longer says archiving makes the read fail.
    - **Its own CI job.** The walk moved to `walk.test.ts` with `vitest.walk.config.ts` and `test:walk`, run by `loam.yml`'s new "Editor walk" job, gated and built like the `loam` job, which leaves the file out; `scripts/affected/suites.mjs` runs both for `pnpm verify`. Seeds `0x5eed10`, 9, 12, 20, 32, 43 (300 steps), 100, 1, 2, `0xdeadbeef` and 42; locally the eleven take 471 s; reopens per seed as before, and 43 1+3.
  - **After the re-check of that round, 2026-11-08,** the last before merge, which found no defect in behaviour and two should-fix items and three test nits, all fixed with tests that fail on revert; its CI run had every job pass, `loam` in 10m47s and Editor walk in 9m18s:
    - **A kept draft and a change of scope.** A draft kept while an app showed was dropped, with no toast and no second save, when the person changed scope before the documents area showed. Its save is now tried once more, in its own scope, when its wait ends that way, and on `pagehide`; rejected, it is lost after its toast, which deviation 16 now lists. Chromium: Alpha typed, saves held, hello opened, an agent's close, the save rejects; the person goes to Atlas; the second save writes the text, or rejects with a second toast, and either way the mark goes.
    - **The walk sees what the area keeps while an app shows.** Invariant 7 also checks every editor the controller holds against the kernel's own read, not only the state rendered, which goes stale while an app shows, allowing for the person's close. The walk signs in at its start, with Vault restricted to the person, and adds Vault, sign-out and sign-in steps; its end signs in again and reads Vault too.
    - **A modal the kernel cancels.** The strengthened walk found the person's close of a Vault tab waiting forever on a modal that a sign-out's change of scope had cancelled with no answer, holding the tab's mark. The area now reads `overlay-list` after a change of scope or a dismissal while it waits on a modal, and takes one no longer open as Keep editing. Chromium: the person's close in Vault, its save rejected and the modal open; an agent's sign-out; the close ends and nothing is asking.
    - **Nits.** The Vault test asserts what is owed through `lifecycle` while away, and that nothing is after sign-in, in both variants, not a trash that a clean note fails too; a clear the kernel refuses, though the read succeeds, keeps what is owed, and a later sync clears it; the controller keeps the scopes its last pass could not reach, which invariant 13 allows. Seed 32 now runs at 300 steps, as the new step kinds left it no reopen at 200; locally the eleven seeds take 540 s.
  - **Spec deviations,** numbered as in the pull request:
    1. **`new-list` and `document-link-*`** are in 4.1's table, and their sections are steps 11's and 12's (7 and 9), so step 9 registers neither.
    2. **`document-trash-expire` deletes the record and its content, not its links,** since the `document-link` table is step 12's (accepted by the coordinator, 2026-11-03). **Step 12 must make expiry delete a document's links too, in the same batch,** as its row in [section 15](#15-implementation-plan) says; `kernel/src/late/documents.test.ts` proves today that nothing of the record or its content is left.
    3. **`KernelEventV2.document` is set when an instance command that is a mutation succeeds** (5.7), not on every instance command 4.2's last row lets run: an editor re-reads on the event, and a query that set it would make each re-read raise another.
    4. **A call the kernel's own 256 KiB bound refused is journaled as `{ document }`,** its document's id alone when it is one of 1 to 128 characters, since `spec/journal.md` requires `input` (`{}` otherwise, and for `document-import`'s envelope, which names none). **The kernel marks the call at that check, and nothing in the result decides it** (changed at the coordinator's direction, 2026-11-03): `markOversized` adds its trace ID to the kernel's own set, which `apps.redact` consumes, and sets the call's `replay: 'recorded'`, a field only trusted code sets, so a replay answers the entry from its record, as it cannot re-run what the journal does not hold. An app whose handler returns `DOCUMENT_CONTENT_TOO_LARGE` itself gets an ordinary entry, its input whole, and a replay re-runs it. Both are units in `kernel/src/late/documents.test.ts`.
    5. **`DocumentsV1` on an app's context waits for steps 10 and 12,** whose `document-open` and `document-link-list` its `open` and `links` call; until then an app with the grant calls `document-get` and `document-list` through its client. Serving half the object now would also have added to the `apps` closure, which the coordinator's raise does not cover.
    6. **The `late-documents` chunk imports types alone.** `late` hands it the functions it runs with in `DOCUMENT_KIT`, since a module first paint shares, imported by that chunk too, was parted into chunks of its own and first paint grew by 255 bytes and 653 gzip on the first build. For the same reason the kernel keeps its own `documentContentKey`, which a unit test holds equal to the SDK's.
    7. **The registry is built when it is read,** from the apps as they stand, not once in stage B, so a disabled instance's types leave it at once and return on enable, as 2.2 asks, with no event to rebuild on.
    8. **A title or tags out of range is `VALIDATION_ERROR`, from the handler,** so it is journaled; 4.5 names no code for it.
    9. **A `late-documents` chunk that does not load fails the late load whole,** since `createLateParts` awaits it, as the `late` chunk's own failure does. How the shell recovers or reports it: `loadLate` reports the error (`reportError`) and sets `kernel.lateFailure`; the boot commands keep running (layout, appearance, `app-list`, `auth-session-get`), so the first frame and the rail stay; every other name answers `LATE_COMMANDS_UNAVAILABLE`, retryable, whose suggestion is to reload and check that the deployment serves its assets; the shell's main shows "Could not load. Reload to try again." (`chrome/src/elements/shell.ts`), and each app of the deployment is listed `failed`. A reload loads both chunks again. `kernel/src/late-documents-failure.test.ts` proves it, beside `late-failure.test.ts`.
    10. **D2's scan is step 13's,** with its exit test: step 9 renamed `COMMAND_NAME_SUGGESTION`'s example to `reports-create` and every `notes` in the kernel, chrome and web host, `testing-probe.ts`'s labels among them, so the scan passes once added.
    11. **`DocumentRecordV1` gains `trashedFrom`,** `'active' | 'archived' | null`: the status it had when trashed, null when it is not in the trash, so `document-restore` returns it there (section 3's record has no field for it; the general review asked for it).
- **Step 10, the editor area and `notes`, implemented 2026-11-07** (its pull request is linked from STATUS.md's step line; evidence and checks there). Sections 5 and 6, and section 10 without links: D5's native half, D7, D1's first half and D10 so far.
  - **Where the code is.** `kernel/src/late/editor-state.ts`, in the `late-editor` chunk: `EditorStateV1`, `validateEditorState`, the operations on a state, and the per-scope records `loam.editor` and `loam.editor@<project>`, registered on first use and read before anything writes them, with `DirtyTabsV1` and the selections in memory, which `resetSession` forgets. `kernel/src/late/editor-commands.ts`, the `late-editor` chunk's entry, which imports types alone besides its own state module, with what it runs taken from `DOCUMENT_KIT`: `document-open` and the seven `editor-*` commands, the editor owner, and `section-get` with the active tab's document as the documents section's path, which `late` registers in place of the boot one. `chrome/src/editor/`, the `editor` chunk: `loam-editor-area`, `loam-editor-group`, `loam-editor-frame`, and the controller that follows the state, saves and hears `KernelEventV2.document`. `apps/notes/`: the manifest, the four instance commands and `notes-editor`. Mod+S is `{ chord: 'Mod+S', command: null, save: true }` in `SHELL_KEYBINDINGS_V0` and `SHELL_RESERVED_CHORDS_V1`.
  - **The call scope and the port.** Every `editor-*` command and `document-open` acts at `context.scope`'s record, decided first by the middleware (`AT_CALL_SCOPE`); the call-scope guard decides all eight, on twin workspaces with the member's tab open, dirty and selected in the restricted project (`kernel/src/scope/call-scope.test.ts`). Through a port, `editor-get` is the only `editor-*` (the others `CALL_NOT_GRANTED`), and `document-open` opens only for the active app or the editor owner (`DOCUMENT_OPEN_NOT_ACTIVE`), in the scope main shows, so it never switches; a document outside the surface's scope answers the same bytes as a missing id. A person's or an agent's `document-open` of a document in another scope switches by `applyScopeChange`, reason `document-open`, and answers `scope: { from, to }`. A restore journals no `document-open`.
  - **D-rows' tests.** Kernel units `P2-D5:` (`late/editor-state.test.ts`, the invariants as a table and each operation; `late/editor-commands.test.ts`, the commands, their undos and `mainChanged`, a dirty close, per-scope records, a switch, the port, the editor owner's modal and overlays, trash and move closing tabs, the selection's shape and `view-state-set`'s refusal, with a replay). Chromium (`web/test/browser/documents/`): `P2-D1:` two notes side by side and their restore, with the editor chunk held, the same tabs, document, active tab and URL, no `document-open` for the restore, every entry with `context.scope` and a replay with no difference; `P2-D5:` the strip by keyboard, preview and pinned, saving on `autosave_ms`, on Mod+S and on a dirty close, a rejecting save's toast and the discard modal, parking with its scroll, an app's main hiding the tabs, scopes, and Mod+S left to the browser with no editor; `P2-D7:` one note in two groups; `P2-D10:` axe in each theme and density, with the menu open, under forced colors and in the compact class, and Specimen captures of `editor-area` and `editor-area-empty` in three themes and two densities. Units `P2-D10:` in `apps/notes/test/app.test.ts`: a save over 256 KiB is `DOCUMENT_CONTENT_TOO_LARGE`, journaled without its input; **30 saves of a 10,000-character note grew the journal by 912,209 bytes of JSON**, about three copies of the text a save (its input, its undo's and its result's), recorded and not limited (#710).
  - **`SESSION_50`** was re-recorded by `session:record`: its `view-state-list` now lists the active scope's `loam.editor`, which stage B registers. The clock tape shifts by one reading from step 9's expiry check, which `diffJournals` ignores, so step 9 did not re-record.
  - **The budget** is the [scope and projects specification's 2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule), after the coordinator's amendment (deviation 14): first paint 285,523 and 88,061 gzip after the reviews, +175 and +71 over step 9's, **the bytes 25 over the step's allowance of 150, accepted by the coordinator on 2026-11-07, since both are accessibility fixes that first paint must hold** (the gzip within its 100): the reviews' busy `h1` and observable `mainBusy` (A-S3, A-B2), about 79 after the template's whitespace and two conditions were trimmed; before them, +96 and +34; its chunk list unchanged; the kernel alone 111,543; `late` 57,661 after the reviews (57,632 before them), +801 over step 9's against its line of 6,000; `late-editor` 14,389 after the reviews (13,111 first), its row set at 14,423 from its first measurement plus 10%, and the chrome-only commands' descriptions shortened to stay under it; `late-documents` 12,105; `url-sync` 4,806 of 5,091; `apps` 384,077, 156 under step 9's, as the port's callable list moved to `late`; `surfaces` 83,946 with `host()`; `sections` 43,007; `editorMinified` 27,182 after the reviews, with the tabs' icons (5.8) and the strip's focus fixes; its first measurement, 24,720, was 62% of section 12's first estimate of 40,000, so phase 0's rule lowered it to 27,192. `notes` is recorded: 67,857 bytes, 18,611 gzip. **What step 10 adds to the kernel's stage B, by part,** each measured in the minified chunk (the parts are approximate, the totals exact): in `late-editor`, the state module 6,132 (the validator about 1,730, the operations about 3,040, the per-scope records with dirty tabs and selections about 1,080, the ids and empty state about 280), the factory's schemas, helpers and editor owner about 1,520, `document-open` 1,195, `editor-get` 302, `editor-activate` 325, `editor-close` 865, `editor-pin` 387, `editor-move` 514, `editor-dirty-set` 353, and `editor-selection-set` with the parts handed back to `late` about 1,520; in `late`, the port's callable list 210 (moved from `apps`), the two chunks' boundary and wiring about 250, the editor records' read-only refusal in `view-state-set` about 140, the archived exception in 4.2's check about 60, the editor owner in `modal-open` about 45, and the middleware's `settle` call about 25. Nothing of it was found avoidable: one definer gives every command its shared fields, and the validator's reasons are what its table checks. The ledger's 6,000 was a first estimate for a smaller editor than 5.2 to 5.5 specify. **After the independent re-check,** first paint 285,503 and 88,055 gzip, 20 and 6 fewer, as `mcpOptions` passes the registries' holder and the listener set; the kernel alone 111,521; `late` 57,956, with the middleware that hands a server's mutations to the page's listeners (295); `late-editor` 14,610 and `editor` 27,755, **their ceilings raised by the measured cost of the re-check's fixes, 221 to 14,644 and 573 to 27,765, approved by the coordinator on 2026-11-07,** the parts in 2.4's rows. **After the narrow re-check,** first paint 285,503 and 88,055 gzip, unchanged; `late` 58,015, the events' scope filter 59; `late-documents` 12,169, the trash and move refusal 64; `late-editor` 15,016 and `editor` 27,768, **their ceilings raised again by the measured cost, 406 to 15,050 and 13 to 27,778, approved by the coordinator on 2026-11-07,** the parts in 2.4's rows. **After the second narrow re-check,** first paint unchanged; `late` 58,089, the check before the call 74; `late-documents` 12,125 and `late-editor` 14,957, smaller, as the check moved into `closeDocument` and the suggestion names no type's save; `editor` 28,162, **its ceiling raised by the measured cost, 394, to 28,172, approved by the coordinator on 2026-11-07**, the parts in 2.4's row. **After the third narrow re-check,** first paint unchanged; `late-editor` 15,212 and `editor` 28,823, **their ceilings raised by the measured cost, 255 to 15,305 and 661 to 28,833, approved by the coordinator on 2026-11-07,** the parts in 2.4's rows. **After the fourth narrow re-check,** first paint unchanged (gzip 88,054 to 88,056 across builds, as the lazy chunks' hashed names change); `late` 58,266, each document record's changes run one at a time (177); `late-documents` 12,260, its five changes through that chain (135); `late-editor` 15,292, within its ceiling; `editor` 29,080, **its ceiling raised by the measured cost, 257, to 29,090, approved by the coordinator on 2026-11-07**, the parts in 2.4's row. **After the fifth narrow re-check,** first paint's minified bytes unchanged; `late` 58,480, an instance mutation's check, write and stamp in its document's chain (214); `editor` 29,290, **its ceiling raised by the measured cost, 210, to 29,300, approved by the coordinator on 2026-11-07**, all of it a parked editor still saving taken back by its tab. **After the sixth narrow re-check,** first paint's minified bytes unchanged; `editor` 29,613, **its ceiling raised by the measured cost, 323, to 29,623, approved by the coordinator on 2026-11-07**: one leave at a time (195), each frame's count of edits (82) and a parked editor still saving counted by the reopen (46). **After the seventh narrow re-check,** first paint's minified bytes unchanged; `editor` 30,068, **its ceiling raised by the measured cost, 455, to 30,078, approved by the coordinator on 2026-11-08**: one lifecycle for every frame (about 377), the getter a test's check of its invariants reads (72), and a lost draft's mark cleared with it (6). **After the independent review of the lifecycle,** first paint's minified bytes unchanged; `editor` 31,072, **its ceiling raised by the measured cost, 1,004, to 31,082, approved by the coordinator on 2026-11-08**, the parts in 2.4's row. **After the re-check that followed,** `editor` 31,271, **its ceiling raised by the measured cost, 199, to 31,281, approved by the coordinator on 2026-11-08**. **After the second,** `editor` 31,449, **its ceiling raised by the measured cost, 178, to 31,459, approved by the coordinator on 2026-11-08**. **After the third,** first paint's minified bytes unchanged; `editor` 31,693, **its ceiling raised by the measured cost, 244, to 31,703, approved by the coordinator on 2026-11-08**: a newer leave keeping an older leave's mark (61), and the person's Discard during a reopen's open (183). **After the fourth,** first paint's minified bytes unchanged (gzip 88,056, a byte of the hashed names); `editor` 32,411, larger, not smaller, **its ceiling raised by the measured cost, 718, to 32,421, approved by the coordinator on 2026-11-08**: the rule and reconciler in place of the six sites, with the owed closed tabs, the close's asking, the Discard by count of edits and the moves to `editor-parts.ts`, net (273); the mark set at once (256); a Discard of a draft given to another tab (122); the reopen's check (67 over its 127). **After the final re-check,** first paint unchanged; `editor` 32,653, **its ceiling raised by the measured cost, 242, to 32,663, approved by the coordinator on 2026-11-08**: an owed tab kept until its mark is known gone (151), the immediate set's state kept true (46), the document match (36), about 9 between them. **After its re-check,** first paint unchanged; `late-editor` 15,302, the closed tab's suggestion 10 longer, within its ceiling; `editor` 33,006, **its ceiling raised by the measured cost, 353, to 33,016, approved by the coordinator on 2026-11-08**: a rejected draft kept until the area shows (161), a tab closed while an app shows leaving at once (117), and the prune they share, the clear's result, a sign-in's sync and `hostOf` moved to `editor-parts.ts` (115), less 40 that settling on positive evidence saved. **After the last round's re-check,** first paint unchanged; `editor` 33,355, **its ceiling raised by the measured cost, 349, to 33,365, approved by the coordinator on 2026-11-08**: a modal the kernel closed taken as Keep editing (228), a kept draft's save tried again (90), and the scopes out of reach (31).
  - **After the coordinator's decision of 2026-11-07,** besides the chunk (deviation 14): two accessibility defects the new assertions found, fixed. A working frame showed its failure's Close button, focusable, since `.failed`'s `display` beat `[hidden]` at the same specificity; and Escape on the tab menu left focus on a menu item inside the closed popover, since the template's `toggle` binding never restored it. Escape, a choice and a light dismiss now return focus to the tab.
  - **Spec deviations,** numbered as in the pull request:
    1. **`document-open` is defined in `late-editor`,** with the `editor-*` commands (`late/editor-commands.ts`), not in `late-documents` with the other `document-*` commands (section 1's table): it writes the editor's state, which that chunk holds, and `late-documents` has 1,113 bytes left of its ceiling.
    2. **The documents section's path is derived.** `late` replaces `section-get` with one that names the active tab's document as `path` while the documents section shows with no app (5.1), so the URL follows the active tab, in any scope, with no `loam.apps` write to keep in step; a `section-open { section: 'documents', path }`'s path is not what the URL shows. Step 5's E8 unit that kept a documents path is amended. A deep link to a document runs `document-open`; one already open there runs nothing, as after a reload.
    3. **A tab's close and menu buttons are `aria-hidden`,** besides `tabindex="-1"` (5.8 and D1 have siblings of the tab in a hand-written strip). axe refuses a named button inside a `tablist` (`aria-required-children`), measured with axe 4.13 before building the strip, as it refuses one inside a `tab` (`nested-interactive`). The buttons are for the pointer: a press keeps focus where it was (`mousedown` is prevented), so no one lands on a hidden control, and axe's `aria-hidden-focus` passes. The keyboard reaches both actions on the tab: Delete closes it (and on a Mac, Backspace, which the key labelled delete sends), Shift+F10 or the context-menu key opens its menu, which `aria-keyshortcuts` names and the tab's description says. A menu a pointer opened gives focus back, on Escape, to what had it; one the keyboard opened, to the tab. **Siblings outside the `tablist`** were possible, with the strip laid out by subgrid and each button's column set through CSSOM, and not used: in reading order a screen reader would meet every tab, then every Close and More apart from its tab, unless `display: contents` merged them, which has dropped a `tablist`'s role from the accessibility tree in browsers still supported; and as Tab stops they would add two per tab between the strip and the editor, against a `tablist`'s one stop. `P2-D5:` "the strip by keyboard" checks the attributes, the description, Tab from a tab reaching the editor past them, a press on More focusing the menu and Escape returning focus to the editor that had it, and the keyboard's menu returning to the tab.
    4. **`AppSurfaces.host()`'s `createMount(instance, element, { scope, document })`** takes the document's scope and reference in place of 2.2's `label`: the editor's surface port is fixed to the document's scope, and its element receives `document` before it connects, through `MountOptions.document`.
    5. **The port's callable list moved to `late`** (`late/port-callable.ts`), which the scope runtime hands the port (`callable`), as `late` hands it `oversized`: `apps` had 20 bytes left and the two names the step adds cost 29, so `apps` now holds less than before, and no ceiling rose.
    6. **A full group,** 50 tabs, drops its first unpinned tab that is neither dirty nor active, and refuses with `EDITOR_TAB_LIMIT` when none can go (5.2 bounds a group and names no code).
    7. **`editor-close`'s `previous` is the closed tab's `{ document, group, pinned }`,** and its undo `document-open { document, preview }`; **`editor-move` to `new` with three groups uses the last,** as `beside` does, and an unknown group is `EDITOR_TAB_UNKNOWN` naming it (5.4 leaves both shapes open).
    8. **The editor owner's overlays** close as an app switch's after any call that moves main, the active tab or the scope (the scope middleware's `settle`), so leaving the documents section, or another plugin's tab becoming active, closes them (5.4). **The palette's ordering by the editor owner,** with the document's instance commands first, joins step 11 with the palette's rows.
    9. **`document-open` of a document in an archived project opens it** (4.2: its documents may be read; opening changes the editor, not the document); a trashed one is `DOCUMENT_TRASHED`, since its tabs close.
    10. **`notes` declares `store` and `clock`;** `documents` joins with step 12's `Insert link` and inspector, which call `document-list` and the link commands, and so does `notes-content-set`'s warning for an unlinked token.
    11. **With no tab open,** main shows the area's "No documents are open" in place of step 11's list; **`loam.layout.~documents`** is step 11's (2.4's ledger), so the documents section keeps the no-app layout record; and a view type's document shows `DOCUMENT_TYPE_UNAVAILABLE`, its editor being step 12's. **Reversed by step 11:** with no tab, the area hides and the documents section's list holds main, as 5.1 has it (step 11's deviation 10).
    12. **Restoring:** the shell's first frame holds main busy for a persisted documents section, and the URL chunk's boot awaits the editor area's first render, so the landing never shows on the way (6); a route that leaves the documents section releases main from the URL chunk. A frame waits up to 15 seconds for the app surfaces, which load beside stage B, before it fails with `APP_RUNTIME_UNAVAILABLE`.
    13. **Switching to an app keeps the editors,** off the page with their drafts, and returning shows them again; **a change of scope drops them,** after asking each dirty one to save, so nothing of one scope stays under another (5.1, 7.6). Mod+S saves the editor holding focus, else the active group's.
    14. **The editor is a `late-editor` chunk of its own** (amended 2026-11-07, the coordinator's decision): `late/editor-commands.ts` and `late/editor-state.ts`, loaded inside `loadLate` with `await import()` beside `late-documents`, so restore after a reload and stage B's queue behave as before; a unit holds that they import types alone but the state module, and `DOCUMENT_KIT` gains `setMain`. What stays in `late`, and why: the port's callable list (moved from `apps`; the port reads it as `late` loads, before any app), the editor records' read-only refusal in `view-state-set` (a shell command `late` defines, which names the records by pattern so it imports nothing of the chunk), the archived exception in 4.2's check, the editor owner's question in `modal-open`, the middleware's `settle` call, and the wiring. A `late-editor` chunk that does not load fails the late load whole and is reported, as deviation 9 has it for `late-documents` (`kernel/src/late-editor-failure.test.ts`).
    15. **Undoing `document-open` of a document already open activates the tab that was active,** in its group, and closes nothing; one that opened a tab is undone by `editor-close` of it, as 5.4 says, and opening the active tab has no undo (5.4 amended; G-S2 of the reviews).
    16. **Only the person discards a draft.** A tab closed by any call but the person's own close, an agent's `editor-close` with `discard: true` among them, saves an editor that still says unsaved first, and an editor still unsaved is reported unsaved again whoever marked its tab saved. **What holds, exactly** (as built after the independent review of 2026-11-08): no agent's, server's or app's call loses a draft an open editor holds. Every frame has one life, made in one visit of a scope, each change of scope a new visit, so a return to the same scope is not the same visit; one place, held by its tab, parked while it saves, leaving, or gone, which one function changes, refusing a slot another frame holds; so a frame is in one map or none, and only frames of this visit are in either. A frame of an earlier visit only leaves and goes. A frame leaving goes off the page at once, so nothing is typed into an editor no tab holds, and leaves once at a time: one taken back, edited and parked again saves again once its first save settles, or, when that save rejects, goes back into its tab, and its tab stays unsaved while its editor says so. When the save of an editor whose tab another's call closed rejects, a parked editor's among them, a `danger` toast says so and the editor keeps its draft, unsaved, for the person to save or discard: in a tab of its document whose editor is clean, or not drawn, in any group, the active one first, the clean editor going; otherwise in a new tab, active only when the closed tab was, else in the background with no move of the URL, or beside when every group holding the document has an unsaved editor, or when a full group refuses it; a beside reopen is always active, so it moves the URL and the active group. The person's page opens it with `document-open`'s `stay`, which moves no one's scope, app or section. Whichever tab takes it is marked unsaved before the closed tab's mark goes, so a trash or a move meets a mark throughout. A parked editor whose save rejects goes back into its tab, which its group then holds beyond ten; one still saving when its tab shows again is taken back by it; a tab whose parked editor is still saving counts as unsaved. The person's own close finishes in the scope it began in, whatever scope is active by then. **The person's Discard is of the draft as the modal found it, whatever has happened to it by the time they choose:** it is recorded on that editor with its count of edits when the modal opened, and holds while no edit has followed, so its outcome does not depend on which of a save, a reopen and the click comes first. The editor goes, whether it is still the tab's, still leaving under it, or given meanwhile by a reopen to another tab; a tab the reopen opened for it closes, and a tab of the document it took keeps its place and draws a clean editor; a save that rejects afterwards brings nothing back, and a reopen whose tab opens after the Discard closes that tab while its editor holds nothing typed since. An editor typed into after the modal opened is kept, with its tab and its mark, since its draft is no longer the one discarded. A modal the kernel closes with no answer, as a change of scope cancels the shell's, counts as Keep editing. A save already under way may still write, since it began before the Discard. **One rule decides every mark the chrome sets or clears** (5.4): a tab of a scope holds unsaved work, `wantsMark`, when its editor, shown or parked, of the tab's own document, says unsaved; when a leave of that tab, document and scope, of any visit, still holds its draft, unsaved as the leave began and not yet saved, kept or lost; or while the person's own close of it saves or asks. One reconciler, the only caller of `editor-dirty-set` in the chrome, brings the kernel's marks to that rule for the scope rendered and for each tab a leave may still owe, a closed tab's among them, which it forgets only once that tab's mark is known gone, read unmarked or cleared, and keeps while the person cannot read its scope, signed out or no longer a member, until a later sync, a sign-in or a return among them, in the tab's own scope, after every change of an editor's place, a leave's start and end, an editor's dirty report and every render, whether the area or an app shows: it sets every mark before any goes, asks the rule again just before each clear, and coalesces a burst of changes into one pass in the controller's queue; a mark the rule wants that the last read left unset is set at once, before any read, so a trash just after typing meets it. So a mark an agent set with nothing behind it goes, a newer editor reading clean or a newer leave settling first leaves an older leave's mark, and a draft that cannot be kept takes its tab's mark with it. A tab another's call closes while an app or another section shows leaves at once, as when the area shows, its editor saving; a draft whose save rejects while main shows an app or another section is kept, marked, and comes back in a tab once the documents area shows again in that visit; when the person changes scope first, or the page goes, its save is tried once more, in its own scope. **A draft is lost, each time after its `danger` toast, only when:** a kept draft's save, tried once more when the person changed scope before the documents area showed, rejects again; or its save rejects after the person has changed scope, this visit or a queued leave of an earlier one; or the page goes (`pagehide`, whose saves are not waited for); or the reopen's `stay` is refused, because main moved between the toast and the reopen; or the beside open that every group holding the document with an unsaved editor sends it to lands in a group that holds it already; or the reopen meets `EDITOR_TAB_LIMIT` in its group and beside it too. The person's Discard in the modal is otherwise the one way a draft is lost. `EDITOR_TAB_DIRTY` says the person has unsaved changes in the tab, and for an open tab suggests asking them to save, then retrying, or `editor-close` with `discard: true`, which saves their editor first and brings a rejected draft back in a tab; for a closed one, retrying once its editor saves them or reopens them in a tab; it names no type's save, since an agent's save writes its own content and clears no mark. **The flag follows the same rule** (the narrow re-check's S-1): `editor-dirty-set { dirty: false }` on an unsaved tab is accepted only from the person's own page, the chrome's marked call on the palette interface, and refused from an agent or a server with `EDITOR_TAB_DIRTY`; another's `editor-close` keeps the tab's mark until the chrome clears it from the person's page, after its editor's save, or at once for a clean editor, so a mark an agent set on a clean tab does not outlive it; and `document-trash` and `document-move` are refused with `EDITOR_TAB_DIRTY` while any tab of the document holds a mark, in any scope's record, checked in the same step as the close of its tabs, so no trash or move lands before the save and no mark set meanwhile is lost. **Narrowing what an agent may do is the owner's to decide:** the refusal of an agent's `dirty: false` is one check in `late/editor-commands.ts`, marked as the owner's decision, and deleting it is the whole of the other choice; the trash and move refusal stands either way (5.4, 5.5 and 4.1 amended; R-S1 of the re-check).
    17. **A server's call reaches the page.** Each mutation a server makes that succeeds reaches the page's listeners as the kernel's event, `interface: 'agent'`, with what the call noted, through a middleware `late` puts first in `mcpOptions`' chain; a query's or a refusal's does not. **A server's `document-open` into the active scope adds its tab in the background:** in the active group, `beside` notwithstanding, activating nothing, and a plain tab where a preview would replace the active one, unless the area is empty, when its tab is the group's first and active one and, while main shows the area, the URL follows it with `mainChanged: 'replace'`; into any other scope it opens as before, in that scope's record. **An event goes only to a page whose actor may enter the call's scope:** of a scope it may not enter, the page hears nothing, neither the scope nor the document (5.4 amended; the scope and projects specification's 3.3; R-S3 of the re-check, N-1 and the events of the narrow re-check).
    18. **Each document record's changes run one at a time** (the fourth narrow re-check's SF-B): `document-rename`, `-update`, `-move`, `-trash` and `-restore`, and a type's instance mutation, its check (4.2's line 5), its handler's write of the content and its stamp of `updatedAt` together (since the fifth narrow re-check), each wait for every earlier change to the same record, so none writes over another with a copy it read before, and a save never lands in a scope the document has left. An instance query, its export command among them, is not chained. A native handler that never answers holds its document's rename, move, trash and restore, and its other instance mutations, until it does, since native handlers have no deadline, while a view's call is bounded at 30 s and a mounted app's at 60 s; a deadline for native handlers is a Follow-up. `document-create` and `-import` make a new record and `document-trash-expire` runs inside stage B before any queued call, so none waits; nothing that waits makes a nested call that could wait on its own record (4.1, 4.2).
- **Step 11, New and the documents section, implemented 2026-11-09, open for review** (its pull request is linked from STATUS.md's step line; evidence and checks there). Sections 7 and 8, `loam-tree` for an app's `tree` sidebar, the palette's rows, a project's card and the `Links` item; D8, E8's last shapes, and D10 so far. Links themselves, embed, view editors and `document-link-*` are step 12's.
  - **Where the code is.** `kernel/src/late/new-list.ts`, in `late`: `new-list` and `loam.new.recent`, registered in stage B and read before anything writes it, written by `document-create { recent: true }` through a wrapper there, so `late-documents` gains only the field. `kernel/src/late/palette-documents.ts`, in `late`: the palette's `kind: 'document'` rows. `chrome/src/new/new-menu.ts`, the `new` chunk: `loam-new-menu`, `readNew` and `runNew`, which the palette's host and the list's empty state use too. `chrome/src/sections/documents.ts`, the `documents` chunk, with `tree.ts` (`loam-tree`), `documents-sidebar.ts`, `documents-section.ts` and `documents-styles.ts`. The project home's card is `sections/projects-section.ts` and `cards.ts`, in `sections`. `loam.layout.~documents` is `kernel/src/shell-state.ts`, in first paint, beside `~projects`. `ui.new`'s rules are `manifest/src/loam-rules.ts`'s `commandRules`; tasks declares `[[ui.new]]` Task, by `tasks-add-blank`.
  - **Trust.** `new-list` acts at the call's scope, which the middleware decides first (`AT_CALL_SCOPE` held it since step 9), so a restricted project answers `PROJECT_NOT_FOUND` in the bytes of a missing one; the call-scope guard decides it, and `document-create`'s `recent: true` there, which writes nothing on a refusal. Every palette document row is filtered through `decideAccess` for the caller's actor at query time; the tree, the list, its `All projects` and the card read `document-list`, which only answers what the actor may read; recents hold types and templates, never documents. Units: `kernel/src/late/new-list.test.ts`; Chromium: `documents/new.test.ts`'s non-member case.
  - **D-rows' tests.** Kernel units `P2-D8 (kernel unit):` in `late/new-list.test.ts`: `new-list` by scope and the rail's order, recents first and at most five, kept across a reload, read-only, a restricted project as a missing one, a disabled instance left out; the palette's rows by title, filtered at query time, following a rename, a trash and a restore; the editor owner's commands with no app active, its instance commands first. Manifest: `ui-new-served`, `ui-new-command-unknown` and `ui-new-needs-input` in `profile-cases.json`, `not-yet-served-ui-new` removed. Chromium `P2-D8:` in `web/test/browser/documents/new.test.ts`: the menu by keyboard, Enter and ArrowDown on its first item and ArrowUp on its last, a heading per plugin, Escape back to the button and a second press closing it; a template creating, opening and focusing its editor, kept as a recent and listed first in a project; a creator running, and its failure a `danger` toast; nothing to create at workspace level, naming the project-only type, and offered in a project; the palette's `New:` rows and title search opening a document; the tree's Recent, types and Trash, a press's preview, a second press and Enter keeping it, a `mousedown` landing; each row's menu, Rename, Links, Trash and Restore; the list's filter, status and the trash's Restore; a project's home by type, its link opening the document; a hostile title as text in the tree, the list and the palette; and a non-member seeing nothing of a restricted project. `P2-E8:` in the same file, under `/` and `/loam/`: `/<ws>/~/documents` shows the list and `/<ws>/p/<slug>/~/documents/<id>` opens its document, journaling `document-open`. `P2-D10:` axe over the tree with its menu open, the list, its trash and the New menu, in each theme and density, under forced colors and in the compact class (`documents/accessibility.test.ts`), and Specimen captures of `documents-tree`, `documents-tree-menu`, `app-tree`, `documents-section`, `documents-section-trash`, `documents-section-empty` and `new-menu` in three themes and two densities (`specimen.test.ts`). The walk's `person-open` presses the tree's row on even steps, with no draw of its own.
  - **`SESSION_50`** was re-recorded by `session:record`: its `view-state-list` now holds `loam.layout.~documents` and `loam.new.recent`.
  - **The budget** is the [scope and projects specification's 2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule): first paint 286,098 and 88,272 gzip, 595 and 217 over step 10's, within the step's 600 and 250, with ArrowDown and ArrowUp on the New button (112 and 51); `late` 61,596, 3,116 over step 10's against its line of 3,000, **116 over it, accepted by the coordinator on 2026-11-09**; `documentsMinified` 51,194 and `newMinified` 15,795, **their rows set at their measurements plus 10%, 56,314 and 17,366, approved by the coordinator on 2026-11-09,** since both chunks load only when the section or the menu opens (deviation 18).
  - **After the three reviews of 2026-11-09** (trust, accessibility, general with budget), three blockers and every should-fix and nit fixed, each behaviour fix with a test that fails on revert:
    - **T-B1, `ui.new`'s rules for every manifest.** They ran only from `surfaceRules`, which returns early with no `ui.surfaces`, as `notes` has, so a creator could name a shell command or another app's, which New would run as the person. `newRules` is a rule of its own: a declared command of this manifest, needing no input, in levels the app takes; a mounted manifest's `ui.new` is `MANIFEST_SURFACE_KIND`. `new-list` also lists a creator only when its app owns the command (`apps.owners`). Cases: no surfaces with an unknown command and with a command needing input, a shell command's name, `minProperties`, mounted, levels, a control and a bidirectional character in a title; a unit for the owner check.
    - **A-B1 and A-S2, Rename.** Enter on Cancel saved: the dialog is a form, Save its submit button, so Enter submits from the field and presses the button it is on. A refused title is said in a `role="alert"` line, `aria-invalid` on the field, and focus goes back to it.
    - **A-B2, a row's Trash or Restore.** Focus went to the page with its row: `loam-tree` hands focus from a row that leaves to the next row, else the previous, else its branch, and the sidebar says `<title> moved to Trash` or `<title> restored` in a polite line; the list's Restore hands focus to the next row's Restore, else the heading.
    - **T-N2, recents per person,** the coordinator's amendment of section 7: `loam.new.recent~<actor>`, read and written only for the call's actor, refused to any other through `view-state-get` and left out of `view-state-list`. `SESSION_50` re-recorded, as no record registers at boot now. Units: five kept and the sixth evicting the oldest, a pair created again moving first with no copy, and two people's recents apart.
    - **T-N3 and T-N4.** "Needs input" is one predicate, `needsInputShape` in the manifest package's root, which the kernel's palette and chords use too: a `required` property or `minProperties` above 0 at the root, in any `allOf` branch, or in every branch of an `anyOf` or `oneOf`, at any depth. The manifest's rule and a chord's check, which run where the validator is, add its parse of `{}`, so a `const` or an `enum` that `{}` is not counts as well (corrected after the re-check of 2026-11-09, which found the parse alone dropped `required` inside a branch); a creator's `scope_levels` are a subset of the app's (`MANIFEST_INVALID`).
    - **T-N1.** The tree and the list also re-read on an instance command's save, whose event carries `document`, and on `project-update`; the list reads the projects' names with its rows.
    - **G-S1.** `textRules` holds `ui.new[].title`, and Loam's display text refuses bidirectional formatting characters as well as control characters (deviation 19).
    - **G-S2, G-S3.** The recents' bound and order are tested, as above; `loam.layout.~documents` has a unit: the section reads it, the inspector and the panel are `LAYOUT_PART_UNDECLARED`, the no-app record keeps its own, and a reload keeps it.
    - **G-S4.** The list reads 200 rows at a time, by `offset`, with `Show more` and `Showing N of M`.
    - **A-S1, A-S3.** A row with no actions, a branch, has no More button and no `aria-keyshortcuts`; Tab in a row's menu closes it and moves on from the row, where the popover's `toggle` took focus back to the row.
    - **Nits.** The palette's index builds again when a record is written during its build; the New menu's mark of a press that closed it is taken by that press's click, so a press dragged off leaves Enter to open it; a second press keeps a document whichever row of it is pressed, in the tree and the list; `New:` rows follow the rest of the query; the `documents` chunk's failure is its own; `el`, `dateOf`, `isoOf` and `numberOf` are `sections/dom.ts`, 514 bytes, so `documents` no longer loads the cards (1,969); the `mousedown` test enters the tree from outside with another row active, which is the fault #712 named; the palette's rows pause between title and description, and its field, list and empty text say commands and documents; the list says "Loading…" while it first reads; the Links dialog's failure is styled as one; no row repeats its keys as a description; captures `documents-section-loading` and `app-projects-section-documents`; a Follow-up for the dialogs' captures.
    - **The budget** after them (`budget`, 2026-11-09): first paint unchanged at 286,098 and 88,271 gzip, and after the re-check 286,050 and 88,193; `late` 61,985, the per-person recents and their read gate 316, the creator's owner check 40 and the palette's rebuild 33, approved by the coordinator; `apps` 384,938, **its row raised by the measured cost, 861, to 385,114, approved by the coordinator on 2026-11-09**, the parts in 2.4's row; `documents` 51,321 of 56,314, `new` 15,998 of 17,366, `sections` 44,597 of 45,000 and `url-sync` 4,968 of 5,091, within. After the re-check, with no row raised: `apps` 384,927, `url-sync` 5,038 (the chunk's failure handler, its heading's text written once), `documents` 51,681, the kernel alone 111,667.
  - **After the re-check of 2026-11-09,** which confirmed every finding of the three reviews and found four should-fix items and two nits, all fixed, each with a test that fails on revert:
    - **One "needs input"** for the palette, a chord and New: `needsInputShape`, in the manifest package's root (no validator, so first paint reads it), true for `required` or `minProperties` above 0 at the root, in any `allOf` branch or in every branch of an `anyOf` or `oneOf`, at any depth; the manifest's rule and a chord's check add the validator's parse of `{}`. The parse alone had dropped `required` inside a branch, so an `anyOf` creator was accepted while the palette marked it. Cases `ui-new-needs-input-any-of`, `-one-of`, `-all-of` and an `anyOf` with a branch `{}` meets, accepted; a manifest unit of both halves; a kernel unit of the palette's flag. First paint is 48 bytes and 78 gzip smaller for it.
    - **Show more** focuses the first row it adds, since its button goes with the last page.
    - **A leaving row hands focus within its branch:** its next sibling, else the previous, else the branch, never a row of another.
    - **A documents chunk that does not load** says "Could not load. Reload to try again." in main, through its landing, and a later visit loads it and puts the landing's text back; a Chromium test aborts the chunk.
    - **Nits.** Loam's display text refuses every `Bidi_Control` character, U+061C among them (deviation 19, a case for it); a Restore sets where focus goes only while the trash still shows, and leaving the trash forgets it.
  - **Spec deviations,** numbered as in the pull request:
    1. **The New button is markup in `loam-titlebar`'s template** (`.new > button`), not an element `loam-new-button` of its own, which would cost first paint a definition for one button; its menu is `loam-new-menu`.
    2. **`violet-menu` is laid over the button** (`position: absolute; inset: 0`, the host taking no pointer), not given it as its slotted trigger, since the button is first paint's and the menu the `new` chunk's; `loam-new-menu` keeps the button's `aria-expanded`, returns focus to it on Escape and a choice, and treats a press that light-dismisses the open menu as its close. The button's ArrowDown and ArrowUp, APG's menu button keys, open it on its first and last item through `violet-menu`'s own trigger handling.
    3. **Recents are written by a wrapper of `document-create` in `late`,** which reads the input's `recent`; `late-documents` gains the field alone (39 bytes). Each person's record, `loam.new.recent~<actor>`, registers on their first use and is read before anything writes it (section 7 amended by the coordinator, 2026-11-09).
    4. **`NOT_YET_SERVED` and its loop are gone with their last key,** `ui.new`: no version 2 key is left unserved, and the bytes paid for `ui.new`'s two rules, so `appsMinified` is unchanged at 384,077. A later key arrives with a manifest version of its own.
    5. **The palette's document index is built on the first query that needs one,** not in stage B, and built again after any record is written (`check.put`, the only writer of an active record; expiry deletes trashed ones, which it never holds). An empty query lists commands alone.
    6. **The editor owner's instance commands lead as its types' commands:** an instance with two types puts both types' first, since `late-editor` has 3 bytes left and its active tab's type is not handed to `late`.
    7. **`Trash` in the tree is a branch,** its documents each with when it was trashed and when it goes, and Restore in its menu; the list's `Show` picker has a Trash view with the same table, Restore and dates. 5.1 gives main to the editor area while tabs are open, so the tree's Trash cannot show main's table then. Kept as built, with no amendment of 5.1, by the coordinator's decision of 2026-11-09.
    8. **`Links` opens a dialog of the sidebar's,** with that document's rows from `document-link-list` by the person's client, for the same reason, kept so by the same decision; the command is step 12's, so until then the dialog says its links could not be read, with the kernel's message. Rename uses the same dialog.
    9. **The documents section's fields and buttons are native,** on the field and action tokens: `violet-text-field` and `violet-button` added about 16 KB to the `documents` chunk.
    10. **With no tab, the editor area hides,** region and `h1`, and the list holds main; `editor-area-empty`'s Specimen fixture and step 10's "No documents are open" are gone. Closing the last tab puts focus on main, which hands it to the list's heading; step 10's keyboard test is amended for that.
    11. **The `documents` chunk loads from the URL's chunk** beside the editor's, so first paint holds no `documents` boundary (`url-sync` +159); an app's `tree` sidebar loads the same chunk for `loam-tree` (7.2).
    12. **`loam.layout.~documents` declares the sidebar alone;** the inspector joins with the first type that has one, step 12's `notes-inspector`, with 5.1's recomputation of `declared` on a tab change.
    13. **The project home's card** lists each type the project allows with its count and five most recent, "None yet" for none; it re-reads on any document mutation while the home shows.
    14. **D8's deployment has no `checklist`,** which is step 13's, where D2 proves New for it again from its deployment entry alone: `memos`, a test fixture with a project-only type and a failing creator, stands in for the second type there.
    15. **`new-list` orders by the rail's order, `order` then the instance,** the rail's one comparator, so an app with no rail entry follows those with one; each app's types come before its creators.
    16. **The list's owner column** reads `You, signed out` for `local` and the Mock's email for its id; phase 3 brings names.
    17. **The tree's choice is `loam-list-select`, as a list's,** with how it was made, so an app's `tree` sidebar reaches the surfaces' selection unchanged; the documents sidebar stops its own before the shell hears it.
    18. **`documentsMinified` and `newMinified` were over their first estimates,** measured 51,194 of 45,000 and 15,787 of 12,000, and **set at their measurements plus 10%, 56,314 and 17,366, approved by the coordinator on 2026-11-09:** both were first estimates, and both chunks load only when the section or the menu opens. By module: `violet-tree` and `violet-tree-item` about 16,000 minified, the section, sidebar, tree, styles and sync about 33,000, and `cards` 1,969 shared with `sections`; `violet-menu` and its item about 9,000 and `loam-new-menu` with `readNew` and `runNew` about 6,800 (15,795 with the arrow keys' key). Native controls took the first from 70,166. The coordinator kept `violet-menu`, the shared accessible component, over a hand-written menu, and the list in the `documents` chunk, beside the sidebar it loads with.
    19. **Loam's display text refuses bidirectional formatting characters,** every `Bidi_Control` character (U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069), as well as control characters, `MANIFEST_TEXT_INVALID`, in every key `textRules` reads, `ui.new[].title` among them, since they can reorder what a person reads (G-S1). The core's own keys keep the core's rule.
- **Not done:** every step of the [implementation plan](#15-implementation-plan) but steps 9, 10 and 11, and step 11's review. Step 11 leaves links, embeds, view editors and `document-link-*` to step 12, with the inspector's declaration in `loam.layout.~documents` and `Links`' rows.
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
| `kernel/src/late/documents.ts` | The `document-*` commands' definitions | Stage B, in a chunk of their own, `late-documents`, which `loadLate` imports with `await import()` before stage B's final `setAppCommands`, so they register in stage B (amended 2026-11-03 with [scope and projects 2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule)) |
| `kernel/src/late/` registry and check, `links.ts` | The type registry and the check, the index | Stage B, in the `late` chunk |
| `kernel/src/late/editor-commands.ts`, `editor-state.ts` | `document-open` and the `editor-*` commands, the editor's state and validator | Stage B, in a chunk of their own, `late-editor`, which `loadLate` imports with `await import()` beside `late-documents` (amended 2026-11-07 with [scope and projects 2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule), by the coordinator's decision on step 10) |
| `chrome/src/editor/` | `loam-editor-area`, `loam-editor-group`, `loam-editor-frame`, `loam-embed` | `editor` chunk, on the first document opened, restored or routed to |
| `chrome/src/sections/documents.ts` | `loam-documents-section`, and `loam-tree` | `documents` chunk |
| `chrome/src/new/` | `loam-new-menu` | `new` chunk, on first press of the New button, which is in first paint (in `loam-titlebar`'s template, step 11's deviation 1) |

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
| `document-move` | mutation | `{ document; project: string \| null }` | The record. Undo moves back. Refused with `EDITOR_TAB_DIRTY` while a tab of it holds an unsaved change, in any scope's editor record; its tabs in the scope it leaves then close (amended by step 10, Status deviation 16) |
| `document-trash` | mutation | `{ document }` | The record. Undo: `document-restore`. Refused with `EDITOR_TAB_DIRTY` while a tab of it holds an unsaved change, in any scope's editor record, its suggestion naming `editor-close { tab, discard: true }`, which saves the person's editor first, while the tab is open; checked in the same step as its tabs close, as `app-switch` closes a surface, none of them unsaved (amended by step 10, Status deviation 16) |
| `document-restore` | mutation | `{ document }` | The record. Undo: `document-trash` |
| `document-open` | mutation | `{ document; group?: 'active' \| 'beside'; preview?: boolean; stay?: 'active' \| 'background' }` | [5.4](#54-the-commands) |
| `document-export` | query | `{ document }` | The envelope below |
| `document-import` | mutation | `{ type; envelope; title?; project? }`, the envelope bounded as [4.4](#44-limits) bounds an instance command's input | The new record, undo `document-trash` |
| `document-link-add`, `document-link-remove`, `document-link-list` | | | [Section 9](#9-references) |

Names reserved and **not registered**, so no app can take them: `document-apply-update`, `document-share`, `document-share-revoke`. `SHELL_DOMAINS_V1` holds `document`, `presence` and `thread`, so they are safe. They arrive with the [collaboration specification](#13-collaboration-the-seam-and-nothing-more).

- **`document-create`.** Writes the record and the template's content through one `adapter.batch`, so neither lands alone. `title` defaults to the template's. A type with no template named uses the first. It does not open the document; the New menu then calls `document-open`, so an agent can create without changing the screen.
- **`document-move`** is the architecture's move. It needs `decideAccess` on both scopes, refuses an archived target with `PROJECT_ARCHIVED`, moves the content row's id and `scope` in one `batch`, raises `epoch` by one, leaves references alone, and closes the document's tabs in the old scope's editor state. A type not supporting the target's level is `DOCUMENT_SCOPE_UNSUPPORTED`.
- **Trash.** `document-trash` sets `status`, `trashedAt` and leaves everything else. The boot-only command `document-trash-expire { before }` ([stage B](../2-scope-projects/spec.md#22-two-stages-d69)) runs when any record's `trashedAt` is older than the workspace's `trashDays`, and deletes the record, its content and its links, by `batch`, journaled. With nothing to do, nothing runs or is journaled. No person, app or agent can call it.
- **Export and import.** `document-export` calls the type's `export_command` as a nested query, and answers `{ loam_document: 1, type, content_version, title, tags, content }`. With no `export_command`, `DOCUMENT_EXPORT_UNAVAILABLE`, as the shell never reads content. `document-import` is the same envelope: `document-create` with no template, then `import_command`, called by the chrome and the agent's client. A nested mutation is refused by D68, so `document-import` itself is not an outer handler: it creates the record, with no content, and `data.next` says `{ command: import_command, input: { document, content } }`. The Documents section runs it. `DOCUMENT_IMPORT_VERSION_NEWER` for an envelope newer than the type.

### 4.2 The check on every document command

For a command with a `document` input, reading the `ProjectCache` and one row. An instance command is an owned command, so this is [line 5 of a call](../2-scope-projects/spec.md#34-the-order-of-a-call-d72), after its lines 1 to 4. A shell `document-*` command has line 1, [as that section's table says](../2-scope-projects/spec.md#34-the-order-of-a-call-d72), and then this:

| Case | Answer |
| --- | --- |
| **`fields.caller` is set, an app called, and the document is outside the call's effective scope** | **`DOCUMENT_NOT_FOUND`, in the same bytes as a missing id, first,** before every row below, for every command, instance commands included. So `checklist-get { document: <a Beacon document> }` tells a plugin nothing, not its project, not that it exists, not its type |
| No such record | `DOCUMENT_NOT_FOUND` |
| Its scope's project is one `decideAccess` refuses for this actor | `DOCUMENT_NOT_FOUND`, with the same bytes |
| Its scope is not the call's effective scope, and the command is not `document-get`, `document-open`, `document-list`, `document-link-*`, `document-trash`, `document-restore` or `document-move` | **`SCOPE_MISMATCH`**: `` `Roadmap` is in the project Beacon, not Atlas ``, with `` Switch with scope-set { project: "beacon" } and run this again. `` A document at workspace level says `the workspace` and `scope-set { project: null }` |
| `status: 'trashed'`, and the command is a mutation other than `document-restore` or `document-trash` | `DOCUMENT_TRASHED`, naming `document-restore` |
| An instance command of another type than the record's | `DOCUMENT_TYPE_MISMATCH` |
| Otherwise | The call runs, and for an instance command the `KernelEventV2` carries `document` |

**The commands exempted can name across projects:** `document-get` and `document-list` because the actor may read there, the rest because they state a target. `decideAccess` still ran on the document's own project. A person seeing a document found through `document-list project: 'all'` opens it with `document-open`, which changes the scope first: see below. **So "a mutation naming a resource in another project is refused after the access decision" holds for every content change, by the instance commands, and for `document-rename` and `document-update`, the shell's.**

**`document-open`'s scope.** A document in another scope, of a project the actor may enter, runs `scope-set` to it first, in the same command, and that switch's rules ([4.3 of the first specification](../2-scope-projects/spec.md#43-the-project-store)) apply: the app may be left. The result says `scope: { from, to }`.

**Through an app's port, none of that widens.** "An app never chooses a project" ([3.2](../2-scope-projects/spec.md#32-the-field)), so with `fields.caller` set, on top of the table's first row: `document-list`'s `project` may only be the call's level, so another project or `all` is `SCOPE_NOT_GRANTED`, which names no document; `document-open` never runs `scope-set`; `document-link-list` leaves out each row whose other document is outside the call's scope, and counts nothing; and `document-link-add` and `-remove` answer `DOCUMENT_NOT_FOUND` for any end outside it. So a sandboxed view in Atlas cannot read Beacon's titles, or learn that an id exists there. The table's exemptions are for a person's and an agent's calls.

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
| `document-open` | mutation | `{ document; group?: 'active' \| 'beside'; preview?: boolean; stay?: 'active' \| 'background' }` | `{ tab, group, scope?: { from; to } }`. Undo: `editor-close` of that tab, when the call opened one; when the document was already open there, `editor-activate` of the tab that was active, so the undo closes nothing the person had (amended by step 10, Status deviation 15). `scope` is reported only when the active scope switched. `beside` puts it in the next group, creating one up to 3, and then uses the last. A server's call into the active scope adds the tab without activating it, in the active group (amended by step 10, Status deviation 17). `stay` is the person's page's alone, `DOCUMENT_OPEN_STAY_REFUSED` from any other caller, an app's port and a nested call among them, or once main no longer shows the document's scope: it opens the tab active or in the background and moves no one, never switching the scope, closing an app or changing main; the chrome's reopen of a rejected draft uses it (amended by step 10, Status deviation 16) |
| `editor-get` | query | `{}` | `context.scope`'s `EditorStateV1`, with `dirty` per tab. `view-state-set` is read-only for these records and `loam.new.recent` ([3.4](../2-scope-projects/spec.md#34-the-order-of-a-call-d72)) |
| `editor-activate` | mutation | `{ tab }` | `{ tab, previous }`. Undo restores |
| `editor-close` | mutation | `{ tab; discard?: boolean }` | `{ closed, previous }`. A dirty tab with no `discard` is `EDITOR_TAB_DIRTY`: the person has unsaved changes, and its suggestion names `discard: true` (amended by step 10: no type's save, Status deviation 16), and the chrome asks first ([5.5](#55-saving)). Whoever closes it, the chrome saves an editor still unsaved first (amended by step 10, Status deviation 16). Undo: `document-open` |
| `editor-pin` | mutation | `{ tab; pinned: boolean }` | `{ tab, pinned }`. Undo restores |
| `editor-move` | mutation | `{ tab; group: string \| 'new' }` | `{ tab, group }`. `EDITOR_TAB_UNKNOWN` |
| `editor-dirty-set` | mutation | `{ tab; dirty: boolean }` | `{ tab, dirty }`. The chrome's, from an editor's event; not callable through a port. An editor still unsaved is reported unsaved again, whoever marked its tab saved. **`dirty: false` on an unsaved tab is accepted only from the person's own page** (a marked call on the palette interface, the chrome's among them); from an agent or a server it is `EDITOR_TAB_DIRTY`, while `dirty: true` stays anyone's. A tab another's call closed keeps its mark until the person's page clears it, after its editor's save or at once for a clean one, and the person's page may clear a closed tab that holds none (amended by step 10, Status deviation 16) |
| `editor-selection-set` | **query, unjournaled** | `{ tab; selection }` | `{ tab }`. Held in memory for the inspector. It joins `UNJOURNALED_COMMANDS`, since it runs per keystroke as `palette-search` does, changes nothing a replay reproduces, and is `mutation: false`. `EDITOR_SELECTION_INVALID` for a shape off the binding's |

Each reads its scope's record and writes it in one step, after its last wait, so concurrent calls never undo one another (amended by step 10's third narrow re-check). All are late commands, and all may be run by a person's chrome or an agent: `document-open` is how the copilot opens one. **Through a port, an app may call only `editor-get`,** with `documents` granted, answering the call's scope. The chrome hears an editor's dirty and selection events and calls those commands itself, so no plugin can close, move or mark another's tab.

**Overlay rules.** The active tab's owning plugin is the **editor owner**. Section 8's rule on `modal-open`, "from an app that is not active", accepts the editor owner too. Leaving the documents section, or a tab of another plugin becoming active, follows section 8 as an app switch for that plugin. `palette-search` shows shell commands and the commands of the active app or the editor owner, with the document's `instance_commands` first ("filtered by active app, document and scope").

### 5.5 Saving

- **The hook.** An editor's `save()` writes through its own commands. **The shell has no save command:** a type's instance commands are what write, and an agent saves by calling them.
- **`autosave_ms`.** `editor-dirty-set { dirty: true }` starts the chrome's timer, which calls `save()` when it ends. Every further edit restarts it. With none, Mod+S calls it. **Mod+S is a new kind of binding,** `{ chord: 'Mod+S', save: true }`, since `ShellKeybindingV0` holds a `command` or `focus` (`keybindings.ts:7-18`) and the shell has no save command; it joins `SHELL_RESERVED_CHORDS_V1` and `SHELL_KEYBINDINGS_V0` together, whose test holds them equal. `keybindingFor` skips it. The chrome calls `preventDefault` only when an editor is the active owner, and Mod+S with a type that saves itself still flushes it.
- **Closing a dirty tab.** The chrome calls `save()` first when the type autosaves. When it does not, or `save()` rejects, it opens a phase 1 modal: `Close without saving?`, confirm `Discard`, `danger`, cancel `Keep editing`. Three buttons wait for phase 4. A tab another's call closes, an agent's `discard: true` among them, saves an editor still unsaved first; when that save rejects, a `danger` toast says so and the editor keeps its draft in a tab of its document, unsaved, for the person to save or discard, and a parked editor whose save rejects goes back into its tab. A draft is lost after its toast only in the cases Status deviation 16 lists: main has left that scope's area, the person changes scope, the page goes, the reopen's `stay` is refused, or every group the reopen can reach already holds the document with an unsaved editor or is full (amended by step 10).
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

/** What an editor dispatches, bubbling and composed, from its element; dirty on each edit, not only on a change. */
export const EDITOR_DIRTY_EVENT = 'loam-editor-dirty';        // detail: { dirty: boolean }
export const EDITOR_SELECTION_EVENT = 'loam-editor-selection'; // detail: the selection, or null
export function documentContentKey(document: string): string;
```

`loam-editor-frame` hears them and calls `editor-dirty-set` and `editor-selection-set`, the first on a change only. An editor dispatches dirty on each edit, since the shell's autosave timer restarts on each and a leaving editor counts them to know of an edit made after its save began (amended by step 10's sixth narrow re-check). `context.client`, in an editor, is a [surface port](../2-scope-projects/spec.md#36-a-surfaces-port-d83) created with the document's scope. `selection` and `selectionLevel` do not apply.

**The chrome's way in.** `loam-editor-frame` uses `AppSurfaces.host()` ([2.2](../2-scope-projects/spec.md#22-two-stages-d69)) for `ensureActivated` and `createMount`.

**View.** `loam-editor-frame` makes a `loam-view-frame` of `editor.resource`, through a `DocumentViewSource`, the seam of phase 1's section 13, and the same proxy, sandbox and CSP as 6.1. The profile is unchanged, and adds, all `dev.loam/`, as the profile leaves open:

| Direction | Method | Rule |
| --- | --- | --- |
| In `hostContext` | `dev.loam/document` | `DocumentRefV1`, and `host-context-changed` when its title changes |
| View → host | `dev.loam/editor-dirty` (notification) | `{ dirty: boolean }` |
| View → host | `dev.loam/editor-selection` (notification) | The selection |
| Host → view | `dev.loam/editor-save` (request) | Answered when saved. Unanswered in 10 seconds is a failure, as above |
| Host → view | `dev.loam/document-changed` (notification) | `DocumentChangeV1` |

`@lushly-dev/loam-sdk/view`'s `connectView` gains `onSave`, `onDocumentChanged`, `reportDirty` and `reportSelection`, and the frame's broker is a [surface port's](../2-scope-projects/spec.md#36-a-surfaces-port-d83), created with the document's scope, so `tools/call` holds to it. **A view's editor is torn down with its tab hidden, since a frame cannot be moved or parked,** after `dev.loam/editor-save`, with the same 500 ms as a teardown, and rebuilt when its tab is shown. **A native editor is parked,** by the phase 1 mechanism that parks a sidebar, up to 10 per group, oldest dropped through `dispose`. So a split of two view editors holds two frames on one sandbox origin, which 6.1 allows, each opaque.

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
| The New button (in `loam-titlebar`), `loam-new-menu` | [Section 7](#7-new) |
| `loam-documents-section` | [Section 8](#8-the-documents-section) |

**A deep DOM's focus.** A tab's activation moves focus to the editor's element when the person pressed in the strip with Enter, and leaves it in the strip for arrows, as a tablist has it. Tab from the strip enters the panel. Closing the active tab focuses the next tab, or main.

## 6. Restore after reload

- `loam.apps.section`, persisted, tells stage A that documents are the owner, and main is `aria-busy` in the first frame, with no landing ([2.2](../2-scope-projects/spec.md#22-two-stages-d69)). The editor's state and validator are in the `late` chunk, so **`loam.editor`'s handler registers in stage B, and is `hydrateOne`d then,** for the active scope, not in stage A's `hydrate`, which drops a record with no handler (`registry.ts:157-162`).
- After `appsReady`, the `editor` chunk loads, and each group's active tab mounts. Inactive tabs show their titles, from `document-get`, and mount on activation. So a reload reads as many editors as there are groups.
- No `document-open` entry is journaled for a restored tab, since the state did not change, as phase 1's reopen has it. A `document-get` read at boot is journaled, and re-executes in a replay against the same record.
- A document gone meanwhile shows the frame's notice, with Close, and the rest restore.

## 7. New

"New is shell-owned." The New button is in first paint, in the title bar before the search button (markup in `loam-titlebar`'s template, not an element of its own, step 11's deviation 1), with `aria-haspopup="menu"` and the text `New`, with no icon: the 16 generated system icons have no `add`, and adding one is an edit to the imported set for no gain here. The first press loads the `new` chunk.

```ts
export type NewItemV1 =
	| { kind: 'document'; type: string; template: string; title: string; icon: string; recent: boolean }
	| { kind: 'creator'; instance: string; command: string; title: string; icon: string };
```

- **`new-list`** returns every template of each type whose `scope_levels` hold the active level, and each `ui.new` entry whose levels hold it. Recents first: the last 5 distinct types and templates **of the person** (amended by the coordinator, 2026-11-09), from the view-state record `loam.new.recent~<actor>`, `{ items: Array<{ type; template }> }`, one per actor in the workspace, the actor's id encoded, registered on the actor's first use and written by `document-create` when the `new` menu calls it with `recent: true`, read and written only for the call's own actor; then by the rail's order. A type of a disabled, refused or failed plugin is not listed.
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
- A press opens as a preview, as above. Each item has a menu: Open beside, Rename, Links, Trash or Restore. **`Links`** shows that document's rows in main's table, by the person's client and `document-link-list`, so a cross-project link is visible here, to someone who may enter both.
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
- **Read-only is enforced per surface.** The chrome creates the embed's mount or frame with `port.surface({ scope: target.scope, readOnly: true })` ([3.6](../2-scope-projects/spec.md#36-a-surfaces-port-d83)), on the target type's plugin: only the chrome can choose that scope. A mutation through it is `EMBED_READ_ONLY`, journaled by the internal `app-embed-refuse`. A query it may call cannot write, since `dev.loam/store` and `context.store` refuse `put` and `delete` under a query ([the first specification's section 5](../2-scope-projects/spec.md#5-the-store-grant-d77)). **For a view that is a boundary; for a native plugin a contract** (D54).
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
- **Who may read.** Each row of `document-link-list` is read through `decideAccess`. **A backlink from a project the reader may not enter is left out, and nothing counts it.** Through a port, so is any row outside the call's scope ([4.2](#42-the-check-on-every-document-command)). A trashed target keeps its row, with its status, so a reader sees `In trash`.
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
- **`notes-editor`.** A `violet-text-area` on the kit, filling the frame, holding a draft until `save()`. It dispatches dirty on each edit and selection on select. `Insert link` opens a list from `document-list`, filtered as typed, and inserts the token. `documentChanged` re-reads and, when the store's text differs from the draft and the draft is clean, replaces it, keeping the caret by offset. When dirty, it shows `This note changed elsewhere`, with `Keep mine` and `Use theirs`, since D46's conflict rule is per property and the text is one. Tokens are parsed by `parseLinks(text)`, which is pure.
- **Links, by the surface.** After a successful `save()`, the editor diffs `parseLinks` against `document-link-list { direction: 'out' }` and calls `document-link-add` and `-remove`. **A handler cannot,** by D68's "a nested call may only be a query". An agent setting text calls the link commands too, and `notes-content-set`'s result reminds it, with `warnings: ['links are separate: document-link-add']` when the text has a token not linked.
- **`notes-inspector`,** when the tab is active: this document's `Links` and `Backlinks`, from `document-link-list`, each a link that opens beside, and its status. Its calls go through a port, so **it shows links within the note's own scope, and says nothing of a cross-project one.** `Insert link` lists the same scope, so `notes` cannot make one. A person sees every link of a document in the documents section ([8.1](#81-the-sidebar)). The `document-*` and `editor-*` events reach it through `documentChanged`, and a link's own events through `selection`'s re-read. **This is what "show backlinks" means in the exit test.**
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

- **The whole list:** with the grant, a port may call `document-get`, `document-list`, `document-link-list`, `document-open` and `editor-get`, and from a surface, never from a handler, by D68, `document-link-add` and `-remove`; without it, none. Each answers within the call's scope ([4.2](#42-the-check-on-every-document-command)). A type's plugin needs the grant to call them, even for its own: `notes` declares it, since its editor lists documents and links. Its own instance commands need none.
- `app-open`'s rule stands: an app never switches another's screen. `documents.open` from a surface whose app is not the editor owner or active is refused, `DOCUMENT_OPEN_NOT_ACTIVE`, as `modal-open` is for an inactive app.
- `document-create`, `-rename`, `-move` and `-trash` are not callable through a port, in phase 2. They are a person's and an agent's, through the shell and the registry. An app's own commands that create documents wait for `calls` in phase 5, when a type's document is a resource it may ask for. **So "Apps never create or delete projects" has its twin here:** an app does not create shell-owned document records either, for now.

## 12. Budgets

Rows the [budget table](../2-scope-projects/spec.md#24-the-budget-and-the-rule) adds. Each is after first paint.

| Row | Holds | Loaded | Ceiling, a first estimate; phase 0's rule lowers it |
| --- | --- | --- | --- |
| `editorMinified` | `chrome/src/editor/`, what it imports that nothing earlier has | A document opens or restores | 33,365, raised by 349 by the last round's re-check, 353 by the re-check of step 10's final round, 242 by its final re-check after the review, 718 by its fourth, 244 by its third, 178 by its second, 199 by its re-check and by 1,004 after its independent review of the lifecycle, 455 by its seventh narrow re-check, 323 by its sixth, 210 by its fifth, 257 by its fourth, 661 by its third, 394 by its second, 13 by its narrow re-check and 573 by its re-check, each approved by the coordinator, 2026-11-07 (the scope and projects specification's 2.4 has the parts); 27,192 before: first measured by step 10 at 24,720, 62% of the first estimate of 40,000, so lowered by phase 0's rule to the measurement plus 10%; 27,182 after step 10's reviews, with the tabs' icons; 27,755 after its re-check; 27,768 after its narrow re-check; 28,162 after its second; 28,823 after its third; 29,080 after its fourth; 29,290 after its fifth; 29,613 after its sixth; 30,068 after its seventh; 31,072 after the review; 31,271 after its re-check; 31,449 after its second; 31,693 after its third; 32,411 after its fourth; 32,653 after its final; 33,006 after the re-check of that; 33,355 after the last |
| `documentsMinified` | The section, `loam-tree`, `violet-tree` and `violet-tree-item` | The section opens, or an app's `tree` sidebar | 45,000; 51,194 measured by step 11; **set at 56,314, its measurement plus 10%, approved by the coordinator on 2026-11-09** (Status, step 11's deviation 18): `violet-tree` and its item about 16,000, the section, sidebar, tree, styles and sync about 33,000, `cards` 1,969 |
| `newMinified` | `loam-new-menu`, `violet-menu` | First press, or `new` in the palette | 12,000; 15,787 measured by step 11, 15,795 with the New button's arrow keys; **set at 17,366, its measurement plus 10%, approved by the coordinator on 2026-11-09** (Status, step 11's deviation 18): `violet-menu` and its item about 9,000, `loam-new-menu`, `readNew` and `runNew` about 6,800 |
| `lateMinified` | Shared with the other specification, whose [2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule) holds its ceiling and ledger: the registry, the check and the index | Stage B | 75,000, as 2.4 has it |
| `lateDocumentsMinified` | `late-documents`: the `document-*` commands' definitions, what they import that `late` has not loaded. `budget.mjs`'s `late` closure leaves this chunk out, so it is counted once | Stage B, with `late` | Its measurement plus 10%, set by step 9 |
| `lateEditorMinified` | `late-editor`: `document-open`, the `editor-*` definitions and the editor's state, validator and operations, what they import that `late` and `late-documents` have not loaded. `budget.mjs`'s `late` closure leaves this chunk out too | Stage B, with `late` | 15,305, raised by 255 by step 10's third narrow re-check, 406 by its narrow re-check and 221 by its re-check, each approved by the coordinator, 2026-11-07 (2.4 has the parts); 14,423 before: first measured by step 10 at 13,111, plus 10% (amended 2026-11-07); 14,389 after step 10's reviews; 14,610 after its re-check; 15,016 after its narrow re-check; 14,957 after its second; 15,212 after its third; 15,292 after its fourth |

Recorded, not limited: `notes` and `checklist`, as `hello` is. First paint's only addition here is the New button ([the ledger](../2-scope-projects/spec.md#24-the-budget-and-the-rule)).

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
| D1 | **Two `notes` documents open side by side, link to each other, show backlinks and restore after reload** (architecture section 9) | Chromium | New, twice. `Open beside` shows two groups, in two `role="tablist"` strips, each with its editor, in the deep DOM. In A, `Insert link` to B, save. In B, a link to A. The inspector of A shows B under both `Links` and `Backlinks`, and of B the same. Reload, with a delay on the `editor` chunk: the first frame is busy; the same two tabs, the same document in each, the same active tab, the same URL; and the inspector's rows. The journal holds the commands with `context.scope`, and has no `document-open` entry for the restore. Replay has zero differences |
| D2 | **A second document type lands with no shell change** | Chromium; Units | `checklist`, a view, on a second origin, appears in New from its deployment entry alone, creates, opens in a real sandboxed frame beside a note, and works through its handler frame. A unit test scans `kernel`, `chrome` and `web/src` for `notes-` and `checklist` and fails on a match. Step 13's `git diff` is empty in `kernel`, `chrome` and `web/src`, which is why step 12 lands the view editor's support, proved there by a fixture. Its document works with its view closed, through `checklist-item-add` from the palette |
| D3 | **Types and the registry** | Units | The manifest: each row of 2.1's table, with a case in `profile-cases.json`, including a missing and a `crdt` binding, a mounted manifest with `ui.documents`, `ui.documents[].panel`, a template off its schema, a version 1 manifest with `ui.documents`. A type conflict leaves the app loaded, with a notice. A failed plugin's document opens to `DOCUMENT_TYPE_UNAVAILABLE`, and its record stays |
| D4 | **The record and the store** | Units | Over both adapters, each command's row: fields set, `updatedAt` by an instance command, the batch of `document-create`, a failed batch leaving neither, `document-move` moving content between scopes and back through undo, with `epoch` raised. Trash and restore, undo of each, `trashDays`' expiry deleting record, content and links, journaled, and journaling nothing with nothing to do. `document-export` and `document-import`, and refusing a newer envelope. **The shell never reads content,** by a fixture store that fails any read of `doc/` outside the type's calls, `document-move` and `document-create` |
| D5 | **The editor area** | Units; Chromium | `validateEditorState`'s invariants as a table. Commands on the state: preview replacing preview, promoting, pinning, up to three groups, a fourth `beside` using the last, a dirty close, a tab moved. A persisted bad record is ignored. Per scope: Atlas's tabs are gone under Beacon and back on return, with nothing of Atlas in the deep DOM. Keyboard: `tablist` arrows, close, focus moves. A native editor parks, with its scroll, and a view tears down and rebuilds. An editor's `save` on `autosave_ms`, on Mod+S and on close; a rejecting `save` keeps it dirty with a toast. A modal from the editor owner works, and the rail's app is not active. Switching to an app leaves the tabs in `editor-get` and on no screen, with overlays as an app switch |
| D6 | **A cross-project mutation on a document** | Units; Chromium | `document-rename` and `notes-content-set` of a Beacon document, in Atlas: `SCOPE_MISMATCH`, naming Beacon, journaled, its bytes equal in both. `document-get` of a restricted project's document, for a non-member: `DOCUMENT_NOT_FOUND`, in the same bytes as a missing id, and it is left out of `document-list` and backlinks, with no count. `document-open` across scopes switches, with its rules. A trashed document refuses `notes-content-set`. The wrong type refuses. **Through a port, each with its own row,** from a view in Atlas: `scope-get` answers `{ scope }` with no record, and `{ workspace }` for a workspace-only app; `project-list` holds no `access`; `document-get`, `document-open`, `document-link-add`, `document-link-remove` and an instance command of a Beacon document each answer **the same bytes as a missing id**; `document-link-list` leaves out a Beacon row and holds no count; `document-list { project: 'all' }` is `SCOPE_NOT_GRANTED`. Each named `project` or `link` of 4.1 has a row of its own. A view's call sent in Atlas and answered after `scope-set` lands in Atlas |
| D7 | **One model, many editors** | Chromium | The same note in two groups. A save in one, a `kernel.agent` `notes-content-set` and an undo through `undoCommand` each reach the other's text. An editor that is dirty when another save lands shows the notice, and neither loses text until a person chooses |
| D8 | **New and the section** | Chromium | With hello, notes and checklist: `new-list` by scope, recents first, with a project-only type's sentence at workspace level. The menu by keyboard. A creator's failure. The tree: types, recents, trash, a preview on a press, promote on a second, a `mousedown` that lands. The list's filter, and title search in the palette opening a document. A project's home shows documents by type. A hostile `title` in a record renders as text |
| D9 | **References and embed** | Units; Chromium | A4 at or under 500 ms for 2,000 documents and 20,000 links. Links across projects; a backlink from a refused project left out. `loam-embed`: renders a note in a note; a removed member sees `Not available`, re-checked at render, as a missing one does; depth 3 and a cycle stop; a mutation through it is `EMBED_READ_ONLY`, journaled, and a query's handler writing to the store is `STORE_WRITE_IN_QUERY`, in a real handler frame. A resource link with an unknown `kind` is dropped with a warning; a `project-summary` link navigates. Each element in its own scoped registry, with `customElements.get('notes-editor')` undefined |
| D10 | **Accessibility, captures, limits** | Chromium; Units | Specimen captures of each element, in the three themes, two densities, with an ARIA snapshot, with #707's workaround. Axe with phase 0's tags with two groups, a view editor, the tree, the menu open, the compact class and `forcedColors: 'active'`, zero violations; axe inside the view's frame as E2 of phase 1 does. Over 256 KiB, `DOCUMENT_CONTENT_TOO_LARGE`, journaled without the input. The journal's growth for a 10,000-character note saved 30 times is measured and recorded, not limited. #708's passes stay open, and it says so |

## 15. Implementation plan

The phase's order is in [the first specification](../2-scope-projects/spec.md#16-implementation-plan). Each step is one pull request, merged on green, and updates both status blocks and STATUS.md before it merges.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 9 | Document records | `src/late/documents.ts`: the registry, the record, the commands of [section 4](#4-the-instance-store) but `document-open`, the check, the limits, the grant, `documentContentKey`; the `document` rules from step 3 now served; a `probe` type in `kernel/src/testing`. `COMMAND_NAME_SUGGESTION`'s `notes-create` (`kernel.ts:56`) and `testing-probe.ts:39-74`'s `notes` names are renamed `reports-*`, for D2's scan; D3, D4, D6's units | `pnpm check`, `loam.yml`, `budget` |
| 10 | The editor area and `notes` | [Sections 5 and 6](#5-the-editor-area), [`notes`](#10-the-notes-type) without links, `chrome/src/editor/`, `document-open`, Mod+S, `loam.editor`, the `editor` chunk's row, `design.md` and the skill, `lint:tokens` for `notes` in `loam.yml` and `suites.mjs`, which selects the whole workspace; D5's native half, D7, D1's first half, D10 so far | `pnpm verify`, `loam.yml`, `budget`, `theme:check`, `lint:tokens` |
| 11 | New and the documents section | [Sections 7 and 8](#7-new), `loam-new-button` within its allowance, `loam-tree`, `tree` for an app's sidebar, the palette's rows, a project's card, the `Links` item; D8, E8's last shapes, D10 so far | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 12 | References, embed and view editors | [Section 9](#9-references), using step 7's `ResourceLinkV1`, `createDocumentIndex`, A4, **`document-trash-expire` deleting a document's links in its batch (step 9 deletes the record and its content, [Status](#status), deviation 2)**, `loam-embed`, `notes`' links, inspector and embed; `DocumentViewSource`, a document's surface port for a view, and `dev.loam/editor-*` in `/view` and the frame, proved by a fixture view in `web/test/browser/pages/`; D5's view half, D1, D9, D10 so far | `pnpm check`, `loam.yml`, `budget` |
| 13 | The second type | [`apps/checklist`](#101-the-checklist-type) alone, its tests, `lint:tokens` in `loam.yml` and `suites.mjs`, which selects the whole workspace, and the inventory, so `git diff` is empty in `kernel`, `chrome` and `web/src`; D2, D10 | `pnpm verify`, `loam.yml`, `budget`, `lint:tokens` |

Order: 9 needs step 6. 10 needs 9. 11 needs 10 and 7, for a project's card. 12 needs 10, and may run beside 11, except for D1, which needs both to close, in whichever merges second. 13 needs 12. Step 14, exit, is last.

## Amendments

This pull request adds to the [decision log](../../decisions.md):

- **D79.** A document's record is the shell's and its content the type's, under `store`, at `doc/<id>`; the shell reads no content. A type declares a binding, required and copied to each record, as D46 asks from phase 2. `crdt` is refused until the collaboration specification. A mounted plugin declares no type until phase 5. Annotates D23.
- **D80.** The editor area is main when the section `documents` is active with tabs; an active app's stage hides it, and its tabs stay. Up to three equal columns, with per-group tabs, preview and pinned, one state record per scope. The model is behind the type's commands, and an editor hears each change. A native editor is parked; a view is torn down, since a frame cannot move. Decided with the documents specification.
- **D81.** References are a `document-link` table with a per-reader filter, in one form of resource link, `ResourceLinkV1`, which phase 5's row extends. A backlink the reader may not reach is not counted. An embed re-checks access at render and is read-only: a boundary for a view, a contract for a native plugin. A view embeds nothing in phase 2.
- **D82.** `notes` is a native plugin with no rail, the first of its shape; `checklist`, a view, is the second type and first view editor. A plugin with `ui.documents` and no rail, sidebar or main has no rail entry. Apps do not create document records until `calls` in phase 5. Instance commands bound their input at 256 KiB. The journal still keeps each save whole, so a replay can re-run it, until #710 settles retention.

**Amended 2026-11-09, by the coordinator's decisions on step 11:** `documentsMinified` and `newMinified` set at their measurements plus 10%, 56,314 and 17,366 (section 12); `late` accepted at 116 over step 11's ledger line, and its reviews' 389 more approved (the scope and projects specification's 2.4); 5.1 kept as written, the editor area holding main while tabs are open, with Trash and Links in the sidebar; and New's recents per person, `loam.new.recent~<actor>` (section 7).

**Amended 2026-11-07, by the coordinator's decision on step 10:** `document-open` and the `editor-*` commands, with the editor's state, validator and operations, are a `late-editor` chunk of their own, loaded inside `loadLate` beside `late-documents`, with a `budget` row of its own (section 12), so `late`'s ledger keeps room for steps 11 and 12 (scope and projects specification, 2.4). Section 1's table and section 12 say so. **Amended again 2026-11-07, after step 10's re-check:** only the person discards a draft, since a tab another's call closes saves an editor still unsaved first, only the person's page marks an unsaved tab saved, and a trash or a move waits while a tab of the document is unsaved (4.1, 5.4, 5.5), and a server's `document-open` into the active scope adds its tab without activating it, every mutation a server makes reaching the page as an event (5.4); Status deviations 16 and 17.

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

**Left from that review, for the coordinator or the owner.**

- **D29 with no active project (finding 35).** The rail's table follows D29's "otherwise in workspace scope". D5 says the bottom band lists "apps that never take a project". It is an owner's decision being read, so it goes to the owner, in the report and in [7.1](../2-scope-projects/spec.md#71-the-bands-d75). The change is one row if the answer differs.
- **D55 reached by self-service (finding 33).** Recorded in [9.1](../2-scope-projects/spec.md#91-an-instance-and-its-projects-d55) as a limit that cannot bite until phase 3, and made a condition of phase 3's specification, rather than adding a deployer-owned project record now.
- **The exit criterion's wording (finding 35).** "Through a test-only handler" is added to the architecture's row, with D64 as precedent, for the coordinator to approve by name.

### Second review, 2026-11-02

A second independent review of the pull request at `69037b7a` returned six must-fixes and a list of should-fixes, and approved subject to them. The author checked each against the code, and each held, but for the one point in M6 below. All are addressed in the text above.

| Finding | What it found | What changed |
| --- | --- | --- |
| M1 | The sign-out fix only half took: `run` moved the scope, but surfaces, the URL and the rail were tied to `scope-set`, a replay never runs `run` (`testing.ts:322`), and an expiry runs no `auth-*` command | `applyScopeChange`, called from `scope-set`, `document-open`, `project-archive` and `scopeMiddleware`. `scopeChanged` and `mainChanged` on the event, and the chrome keys on them. "What `run` may do" is stated. An expiry takes effect at the next call, by comparing actors, which the review did not prescribe |
| M2 | A signed-in session does not survive a reload, so E4 could not pass, and a refusal became an allow in replay | `resetSession` signs the replay's Mock out. A reload in a restricted project under the Mock lands at workspace level until sign-in, stated in 6.3. E4 signs in after its reload. **Added beyond the finding:** `actorOf` gives a replay the journal's actor, since one Mock across a journal also cannot match an expiry |
| M3 | Boot-only commands were reachable over MCP, which never calls `run` | `mcpOptions().commands` leaves out `BOOT_ONLY` and `INTERNAL_COMMANDS`. E5 asserts it |
| M4 | A view could read project names, members and other projects' titles | `scope-get` through a port is `{ scope }` alone. An out-of-scope document answers as a missing one, first, for every caller that is an app. Link rows outside the scope are left out. `AppProjectV1` holds no members. `notes-inspector`'s limit is stated, with the section's `Links` for a person. D6 has a row per path |
| M5 | A surface's bound scope needed a port that did not exist | [3.6](../2-scope-projects/spec.md#36-a-surfaces-port-d83), D83: `port.surface({ scope, readOnly })`. Section 13 is corrected |
| M6 | E14 could not fail for most rows | Titles are `P2-E<n>:` and `P2-D<n>:`, a skip or todo fails, and `ci.yml` is dispatched too. **One disagreement, with evidence:** the finding says to read `entry-points.test.ts`'s and `plugin-manifest.test.mjs`'s passes from `ci.yml`'s log, and that log cannot show them, since `pnpm check` runs under lefthook with `output: [summary, failure]` (`lefthook.yml:12-14`); a local `pnpm verify` log showed 24 lines and no test title. So `ci.yml`'s dispatch proves the workspace, and a named step in `loam.yml`'s `loam` job runs those two tests verbosely |

**Should-fixes, all done:** the plan's step assignments, with `ResourceLinkV1` moved to step 7 and an exit test closing in its last step; `role="tablist"` in D1; reporters in the three configs; `createAuthSessionGetCommand` for first paint; one list of what a port may call, with `editor-*` reduced to `editor-get` rather than widened; shell `document-*` commands having line 1 alone; `view-state-*` and `editor-*` deciding `@` ids; read-only records stated; `readBoot` checking `instance` and `workspace.id` with an exit test; a query that cannot write; D73's native contract; `scope-set`'s `previous` from the record; layouts registered from `context.scope`; a disabled instance as a gate, which also removes `reload`; a stop condition with the coordinator's approval and a named fallback; gzip's margin, now 250, with the running base carried from step 1; a ledger for `late`, whose ceiling rises to 75,000 on a rough count; and what E5 does not prove, with `onBehalfOf` named as phase 3's.

The owner's D29 question stays as recorded.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-09 | Step 11's accessibility review | Specimen captures of the documents sidebar's Rename and Links dialogs, once Specimen observes a modal dialog's ARIA snapshot (its snapshot is empty while one is open); axe covers them meanwhile | Open |
| 2026-11-02 | Phase 2 specification | Group sizes, rows, and dragging a tab or a group | Open |
| 2026-11-08 | Step 10's re-check after the independent review | A long walk of the editor area, scheduled or run by hand, with many seeds and more steps than the six of 200 a pull request runs, once Loam's CI has a schedule | Open |
| 2026-11-07 | Step 10's fifth narrow re-check | A deadline for a native handler holding its document's chain: one that never answers holds the document's rename, move, trash and restore, which a view's 30 s and a mounted app's 60 s bound for theirs (Status, deviation 18) | Open |
| 2026-11-07 | Step 10's accessibility review | Layout-aware chords: Mod+S, like every reserved chord, matches by physical key (`keyboard.ts`), so a layout that moves S moves the chord | Open |
| 2026-11-02 | Phase 2 specification | Favorites, in the proposal's list and not in the architecture's | Open |
| 2026-11-02 | Phase 2 specification | Content search, phase 0's A5, when a consumer needs it | Open |
| 2026-11-02 | Phase 2 specification | `ui.documents[].panel`, a view's inspector, and an embed in a view's editor, each when a type asks | Open |
| 2026-11-02 | Phase 2 specification | A three-button close prompt (Save, Discard, Cancel), with phase 4's prompts | Open; phase 4 |
| 2026-11-02 | Phase 2 specification | Journal size under autosave: 4.4 bounds one input and leaves growth open. Consider snapshots, or deltas with the collaboration service's `document-apply-update` | Open; #710 |
| 2026-11-02 | Phase 2 specification | Apps creating and driving other plugins' documents, under `calls` | Open; phase 5 |
