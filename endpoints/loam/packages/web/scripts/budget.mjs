#!/usr/bin/env node
/**
 * budget: the bundle budget of Loam's web host (phase 0 specification, 8.1).
 *
 *   pnpm -F @lushly-dev/loam-web budget [--json]
 *
 * Builds the shell with Vite in production mode and measures what the empty shell loads before
 * first paint: `index.html`'s entry and every chunk it imports statically (a chunk imported
 * dynamically loads later). It also builds `@lushly-dev/loam-kernel` alone, minified with its
 * dependencies, as Vite bundles it for the browser. What loads later has rows of its own (phase 2
 * specification, 2.4): the kernel's late commands, its `src/apps/` with the readers and validators and
 * classic Zod, the chrome's surfaces, its view host and the console. Each is a static closure, charged
 * what a page has not loaded by then. Hello's and tally's bundles are recorded and not limited. It fails
 * when a measure is over its ceiling, when first paint holds classic Zod or `toJSONSchema`, or when it holds
 * a chunk of stage B: `late`, `apps`, the readers, `surfaces`, `url-sync` (phase 2 specification, 2.2). That first
 * paint is the same for every deployment. `dist/` is rebuilt, so run it after `build` or in its place. It runs
 * `ceiling-raises.mjs` first, which, once D115 has ended (D161), fails a ceiling raised without its amendment.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { runCeilingRaiseCheck } from './ceiling-raises.mjs';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './narrow-zod.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ceilings, in bytes, as phase 2's step 1 sets them (2.4): first paint lowered, the kernel's its
 * measured value plus 10% now that Zod's classic API has left it, `late` added, and `apps` its measured
 * value plus 5%, the one raise, for the bytes that left first paint. Step 3 raised `apps` once more, to
 * its new measured value plus 5%, for manifest version 2's validator (about 40 KB of generated code).
 * Step 2 changed no ceiling: first paint 273,179 and 83,564 gzip, `apps` 377,811 (2.4's table).
 * Step 4 changed none either: first paint 277,772 and 85,346 gzip, the kernel alone 110,680, `late`
 * 47,868 with the `store` chunk it shares with `apps`, and `apps` 377,547 (2.4's table). Step 5 changed
 * none and added `urlMinified`: the URL's commands and writes are a `url-sync` chunk loaded when stage B
 * ends, after `apps` and before `surfaces`, 3,719 of 5,091, its measurement plus 10% and 1,000 for steps
 * 7 and 11's shapes, unrounded (approved by the coordinator); first paint 279,728 and 86,097 gzip, the
 * kernel alone 110,790, `late` 48,425. Step 6 changed none and added two rows: `switcherMinified`, the
 * project switcher's list, measured at 10,288 against a first estimate of 30,000, so lowered by phase 0's
 * rule to its measurement plus 10%, 11,317; and `tooltipMinified`, the rail's tooltip, 2,841 of 3,126, its
 * measurement plus 10%, which left first paint to meet the step's allowance. First paint, after its
 * reviews and re-checks, 285,302 and 87,964 gzip, the kernel alone 111,055, `late` 49,890, `surfaces`
 * 83,468, `switcher` 11,316. After its reviews the coordinator
 * approved a third row, `switcherColdMinified` (2.4, 2026-11-03): what a press of the switcher downloads on
 * an empty shell, which never loads `surfaces` (7.8), 41,057 of 45,163, its measurement plus 10%, unrounded,
 * as `urlMinified`'s is. No other ceiling rose. Step 8 changed none: first paint 285,270 and 87,954 gzip,
 * the kernel alone 111,019, `late` 50,851, `apps` 378,907 (86 left) and `mount` 215,943, with 9.2's checks in
 * `apps` and the disabled gate's refusals moved to `late`, which `apps` had no room for. Step 7
 * added `sectionsMinified`, the projects section with
 * the kernel's summary rows that `project-summary-get` loads on its first call, 42,975 of 45,000, its first
 * estimate kept as the measurement is above 70% of it; and raised `appsMinified` by 833, to 379,826, for
 * `ui.project_summary`'s rule in the one validator, measured as the closure with it less without it (379,007
 * less 378,174 on step 6's base), approved by the coordinator, 2026-11-03. On step 8's base: first paint
 * 285,404 and 87,998 gzip, with `vite.config.ts`'s `events` group keeping the preload helper in first paint's
 * `events` chunk; the kernel alone 111,238, `late` 51,893, `url-sync` 4,347, `apps` 379,806 (20 left).
 * Step 9 leaves `late-documents-` out of the `late` closure, as that chunk gets a row of its own (2.4),
 * `lateDocumentsMinified`, set at its measurement plus 10% (12,016, so 13,218), over its ledger's 11,000,
 * accepted by the coordinator; and raised `appsMinified` by 4,427, to 384,253, approved by the coordinator,
 * 2026-11-03: the manifest's document rules in the one validator over untrusted input (4,185, with the
 * trust review's rule on `export_command` and `import_command`), the redaction of a call the kernel's own
 * bound refused, by its mark, in `apps.redact` (about 180: 184 and 178 by two removals), and the port's
 * `documents` row (58), each measured as the closure with it less without it, with no slack. The parts are
 * approximate, since the minifier's renaming interacts with what is removed; the total is exact. First
 * paint 285,348 and 87,990 gzip, the kernel alone 111,350, `late` 56,860, `apps` 384,233.
 * Step 10 adds `editorMinified`, the editor area's chunk, loaded on the first document opened, restored
 * or routed to, charged after the surfaces as `sections` is: first measured at 24,720 against the documents
 * specification's first estimate of 40,000 (12), at 62%, so lowered by phase 0's rule to its measurement
 * plus 10%, 27,192; 27,182 after the step's reviews, with the tabs' icons. It records `notes`' bundle, as
 * `tasks`' is. The editor's state and commands are a chunk of their own, `late-editor`, loaded inside
 * `loadLate` beside `late-documents`, with a row of its own, `lateEditorMinified`, first 13,111, so 14,423,
 * its measurement plus 10% (an amendment to 2.4 the coordinator decided, 2026-11-07), and 14,389 after the
 * reviews: `late`'s closure leaves both out. After the reviews, first paint 285,523 and 88,061 gzip, the bytes
 * 25 over step 10's allowance of 150 (the busy heading and an observable `mainBusy`), accepted by the
 * coordinator; the kernel alone 111,543; `late` 57,661; `late-documents` 12,105; `url-sync` 4,806; `apps`
 * 384,077, as the port's callable list moved to `late`; `surfaces` 83,946, with `host()`. The re-check's
 * fixes raised `lateEditorMinified` by 221, to 14,644, and `editorMinified` by 573, to 27,765, approved by the
 * coordinator, 2026-11-07, each part measured as the chunk with it less without it (2.4 has them); after it,
 * first paint 285,503 and 88,055, the kernel alone 111,521, `late` 57,956 with a server's events,
 * `late-editor` 14,610 and `editor` 27,755. The narrow re-check's raised them again by their measured
 * cost, `lateEditorMinified` by 406 to 15,050 and `editorMinified` by 13 to 27,778, approved by the
 * coordinator, 2026-11-07; after it, first paint 285,503 and 88,055, `late` 58,015, `late-documents`
 * 12,169, `late-editor` 15,016 and `editor` 27,768. The second narrow re-check's raised `editorMinified` by
 * its measured cost, 394, to 28,172, approved by the coordinator, 2026-11-07, chiefly a draft kept when its
 * save rejects after another's close; `late-editor` fell to 14,957, `late` 58,089, `late-documents` 12,125.
 * The third raised `lateEditorMinified` by 255, to 15,305, and `editorMinified` by 661, to 28,833, their
 * measured costs, approved by the coordinator, 2026-11-07: `document-open`'s `stay` and the suggestion that
 * says a rejected save's draft comes back, less what one read-and-write step saved; and a draft kept in every
 * case but those deviation 16 lists. The fourth raised `editorMinified` by 257, to 29,090, approved by the
 * coordinator, 2026-11-07: a rejected draft's tab marked before its closed tab's mark goes (83), a full group's
 * retry beside (58), and every group searched for its document's clean tab (44), with the loop that does it
 * (about 72). The fifth raised it by 210, to 29,300, approved by the coordinator, 2026-11-07: a parked editor
 * still saving taken back, with its draft, by its tab shown again; `late` rose to 58,480 with an instance
 * mutation's check, write and stamp in its document's chain. The sixth raised it by 323, to 29,623, approved
 * by the coordinator, 2026-11-07: one leave at a time for a frame taken back and parked again (195), each frame's
 * count of edits, so a leave knows of one made after its save began (82), and a tab whose parked editor is
 * still saving counted as unsaved by a rejected draft's reopen (46). The seventh raised it by 455, to 30,078,
 * approved by the coordinator, 2026-11-08: one lifecycle for every frame in place of the patches before it, a
 * life each with one place that one function moves (about 377), the getter a test's check of its invariants
 * reads (72), and a lost draft's mark cleared with it (6). The eighth raised it by 1,004, to 31,082, approved
 * by the coordinator, 2026-11-08, after the independent review of the lifecycle: a mark no editor holds
 * cleared from the person's page, also while an app shows (360), a parked editor whose tab another's call
 * closed reopened (112), a slot another frame holds refused (about 70), the person's close kept in its own
 * scope (28), and visits of a scope, timers by frame, a leaving frame taken off the page and the rest (about
 * 424), and the split of its helpers into `editor-parts.ts`, under the file-size limit (10). The re-check after it raised it by 199, to 31,281, approved by the coordinator,
 * 2026-11-08: a mark cleared when its tab's editor is ready and clean (65), a leaving editor of the scope
 * rendered keeping its tab's mark across a round trip (about 97), and the person's close disposing only a
 * frame still its tab's (37). The next raised it by 178, to 31,459, approved by the coordinator, 2026-11-08: a tab
 * whose earlier editor still saves its draft keeping its mark, whatever a newer one says (about 95), and the
 * person's Discard of an editor still leaving recorded on its life (83). The third raised it by 244, to 31,703,
 * approved by the coordinator, 2026-11-08: a newer leave of a tab keeping the mark an older leave still holds
 * (61), and the person's Discard during a reopen's open closing the new tab (127), never adopted, and reset when
 * a tab takes the frame back (56). The fourth raised it by 718, to 32,421, approved by the coordinator,
 * 2026-11-08: one rule and one reconciler for every mark in place of six sites, with the closed tabs a leave
 * still owes, the person's close asking, the Discard by count of edits and the moves to `editor-parts.ts`, net
 * of what they replaced (273); a mark the rule wants set at once, before any read (256); a Discard of a draft
 * a reopen has given to another tab (122); and the reopen's check of the tab it opened (67 over its 127). The
 * final re-check raised it by 242, to 32,663, approved by the coordinator, 2026-11-08: a closed tab a leave owed
 * kept until its mark is known gone (151), the state the immediate set trusts kept true to what was sent (46),
 * and an editor's mark only for its own document (36), with about 9 between them. The re-check after it raised
 * it by 353, to 33,016, approved by the coordinator, 2026-11-08: a draft rejected while the area is away kept
 * until it shows (161), a tab closed while an app shows leaving at once (117), and the prune they share, the
 * clear's result, a sign-in's sync and `hostOf` moved to `editor-parts.ts` (115), less 40 that settling only on
 * a read or a clear that succeeded saved. The last round's raised it by 349, to 33,365, approved by the
 * coordinator, 2026-11-08: a modal the kernel closed with no answer taken as Keep editing (228), a kept draft's
 * save tried once more when its scope goes first, and on `pagehide` (90), and the scopes out of reach (31).
 * Step 11 adds `documentsMinified`, the documents section with `loam-tree` and `violet-tree`, and
 * `newMinified`, the New menu with `violet-menu`. The documents specification's first estimates were 45,000
 * and 12,000; measured at 51,194 and 15,787, each was set at its measurement plus 10%, 56,314 and 17,366,
 * approved by the coordinator, 2026-11-09, since both load only when the section or the menu opens. Parts:
 * `documents` holds `violet-tree` and `violet-tree-item` (about 16,000), the section, its sidebar, the tree,
 * their styles and sync (about 33,000) and `cards` (1,969, shared with `sections`); `new` holds `violet-menu`
 * and its item (about 9,000) and `loam-new-menu` with `readNew` and `runNew` (about 6,800).
 * Step 11's reviews raised `appsMinified` by their measured cost, 861, to 385,114, approved by the
 * coordinator, 2026-11-09: `ui.new`'s rules as a rule of their own, run for every manifest, with the mounted
 * and levels refusals (652), "needs input" decided by the kernel's own parse of `{}` (75), bidirectional
 * formatting characters refused in Loam's display text (68), and `ui.new` titles in that rule (66).
 * Its narrow re-check raised `urlMinified` by its measured cost, 156, to 5,247, approved by the coordinator,
 * 2026-11-09: a `documents` chunk that does not load, with a tab open, says so in the sidebar and leaves main
 * to the editor, where with no tab main's landing says it (5,038 before).
 * The input-schema rule's fix raised `appsMinified` by its measured cost, 2,672, to 387,786, keeping the 159
 * bytes left before it, approved by the coordinator, 2026-11-09: the manifest's reader refuses a schema Zod
 * would accept and not honour (the documents specification's Follow-ups), measured as the closure with it
 * less without it (387,627 less 384,955). Parts: the schema walker and its table of keywords (about 2,500),
 * the suggestion's words on restructuring (86) and the check's place in the input, config and content rules
 * (about 90). First paint and the kernel alone are unchanged: "needs input" keeps its own branch recursion.
 * Its independent review raised it by that round's measured cost, 5,423, to 393,209, keeping the 159 bytes
 * left, approved by the coordinator, 2026-11-09 (393,050 less 387,627): each refusal's reason and remedy in one
 * table, used at the input, pipeline, content and config sites (about 2,950 over the messages it replaced),
 * the rules the review and its fuzz found (about 2,400: `minItems` and `maxItems` with no `items`, a tuple Zod
 * pads, a value Zod lets go missing through branches, `patternProperties` keys, `$ref`'s forms and cycles, and
 * defaults at the root and in `prefixItems`), and the sites' remedy (about 50). First paint and the kernel
 * alone are unchanged.
 * Its re-check raised it by that round's measured cost, 885, to 394,094, keeping the 159 bytes left, approved
 * by the coordinator, 2026-11-09 (393,935 less 393,050), each part the closure with it less without it: a
 * closed object a join reaches through `$ref` or nested branches (574), names `Object.prototype` holds (346),
 * and cycles through a typed node's branches with the order that says two branch keywords first (-35, as the
 * cycle walk is simpler). First paint's code is unchanged: its gzip is one byte more only for the `apps`
 * chunk's new hash in its name, and with the old name it is equal. The third re-check's last nit, refusing a
 * declared `__proto__` too, shrank the closure by 17, to 393,918, under the same ceiling, 176 bytes left.
 * Step 12's deviation 7, the coordinator's decision of 2026-11-09, adds `editorMoveMinified`, `editor-move` alone,
 * a view editor's save before a move where the browser has no `moveBefore`, which only that browser loads:
 * 591, set at 650, its measurement plus 10%; and raises `editorMinified` by its measured cost, 1,140, to 34,505,
 * keeping the 44 bytes left, approved by the coordinator on 2026-11-09: the frame held where it is while it
 * saves (about 500), the area hidden rather than removed and a group kept while an unsaved view editor in it
 * saves (about 300), and the tab actions and Mod+S moved to `editor-actions.ts` under the file-size limit (about
 * 316).
 * Step 12's review raised `editorMinified` by that round's measured cost, 613, to 35,118, and `editorMoveMinified`
 * by 134, to 784, approved by the coordinator on 2026-11-09. Parts of `editor`, approximate, the total exact:
 * groups placed among live ones, by `moveBefore` where it exists (about 210, G-B1); Mod+S from inside a view
 * editor's frame (about 150, S7); an embed's editor events kept out of its tab (about 110, T-S1); only the
 * person's own move saves (about 80, T-S2); the first live group's border (about 70, G-N7); a refused move back
 * not asked again (about 25, G-N6); less about 30 that G-S4's restructure saved: the action host's ten closures
 * gone (about 270) against the plain functions the file-size limit then needed (about 240). `editor-move`: the
 * two toasts and the refusal's stop. `late` rose by 36, to 67,011, for the link id taken only from an undo and a
 * failed first list retried, approved within its 75,000.
 * Step 12's re-check raised `editorMinified` by that round's measured cost, 196, to 35,314, and `viewMinified` by
 * 25, to 25,105, approved by the coordinator on 2026-11-09. Parts of `editor`, approximate, the total exact: a
 * frame's and a group's `connectedMoveCallback`, so `moveBefore` keeps them (about 60, N-B1); the person's move
 * read from the event, an undo's among them (about 60); a view's save requests one at a time (about 40); a
 * refused move back cleared once it settles (about 20); the area's check as a function (about 15). `view`: its
 * own `connectedMoveCallback`. `late` rose by 46, to 67,057, for the bound on the removed link ids;
 * `documents` by 256, to 54,795, the inspector hidden rather than closed and focus only for its own open;
 * `embed` by 25, to 6,072, its `connectedMoveCallback`; `editor-move` by 27, to 752, the reload count; each
 * within its row.
 * Step 12's second re-check raised `editorMinified` by that round's measured cost, 131, to 35,445, and
 * `editorMoveMinified` by 83, to 867, approved by the coordinator on 2026-11-09. Parts of `editor`, approximate,
 * the total exact: save requests during a save coalesced into one more (about 55, N1); a view editor held, and
 * shown nowhere, after its move back is refused (about 45, N2); that hold cleared by the next move (about 30).
 * `editor-move`: saving again for an edit made during the save, and the edits that save covered (S3). `late` rose
 * by 335, to 67,392, for `layout-get` answering an undeclared inspector closed (B1, S1), within its 75,000;
 * `documents` by 47, to 54,842, focus after a hidden inspector and its closed drawer, main when the active view
 * cannot take it yet (B1, S2), within its row.
 * First paint is unchanged, 286,084: `late` compares the documents layout's id as a literal, since importing it
 * made the first paint's `shell-state` chunk export one more binding (4 bytes).
 * Step 12's final re-check raised `editorMoveMinified` by that round's measured cost, 3,338, to 4,205, approved by
 * the coordinator on 2026-11-09: `loam-editor-held`, the placeholder a held view editor's tab shows after its move
 * back is refused, with Move back and Save, its template, styles and words (S-1), and the move back shared by the
 * two. `late` rose by 217, to 67,609, for one `presented` helper over every layout read (S-2), within its 75,000;
 * `documents` by 80, to 54,922, the drawer's close watched on the shell's presentation (N-1), within its row;
 * `editor` fell by 34, to 35,367. First paint is unchanged.
 * Step 12 adds `embedMinified`, `loam-embed` in a chunk of its own, which the kit loads for the first editor
 * that embeds, since `editor` had 693 bytes left: first measured at 5,542, set at its measurement plus 10%,
 * 6,096, approved by the coordinator, 2026-11-09. Parts: the element, its read and re-check and its states (about 5,050), and `resourceLinkUrl` with `formatRoute`, which `sections` also loads (about 490). `late` rose by
 * 4,990, within step 12's ledger line of 5,000; `editor` 33,321 before deviation 7's save before a move, `view` 25,012, `surfaces` 83,556 and
 * `documents` 53,757, within their rows; first paint's bytes, `apps` and `late-editor` are unchanged.
 * Step 13 adds `checklist`, the second type, with no shell change: every row and ceiling is as step 12 left
 * them, and its view's pages, the editor and the handlers' frame, are recorded beside the native bundles,
 * never limited, as `notes`' bundle is.
 * Phase 3's step 1 (identity core) set `kernelMinified` to its measurement after the coordinator's cuts,
 * 114,364, approved by the coordinator on 2026-11-09: the access decision version 2, the stage A identity and
 * membership, the person's view-state reads and the agent interface's wait for stage B. First paint
 * 288,583 and 89,185 gzip, +1,697 and +688 over step 0b's 286,886 and 88,497, within the coordinator's
 * step 1 target of 1,700 and 750; `late` 70,597. It raised `appsMinified` by 800, to 394,894, approved by
 * the coordinator 2026-11-09: stage B's full check of a version 3 projection's `identity`, the one that fails
 * closed (822), the outer actor copied onto port, nested and refusal calls (88), the version 3 deployment
 * rows (53) and `member` (9), less what `apps` had left. After its review's fixes, under the same ceilings:
 * first paint 288,566 and 89,207 gzip (+1,680, +710), the kernel alone 114,351, `apps` 394,885, `late` 70,924.
 * #872's refinement of the input-schema rule, a closed tagged union (a `oneOf` of two or more branches
 * beside only `type: 'object'`) read branch by branch, cost `apps` 88 and raised `appsMinified` by that less
 * what `apps` had left, 79, to 394,973, approved by the owner on 2026-11-12 (`apps` 394,973).
 * Phase 3's step 0c (AFD's MCP authorization scopes) raised `kernelMinified` to 114,444, approved by the
 * coordinator on 2026-11-10: the kernel bundles afd-server's lean `/define` path, where `defineCommand` now
 * carries a command's `scopes` (M6's metadata) and the engine two optional hooks that look a hidden command
 * up as a missing one; no authorization code. First paint 288,640 and 89,242 gzip, +74 and +35 over `main`
 * at `dd5d3616` (288,566 and 89,207), within 0c's allowance of 80 and 40; the kernel alone 114,444 (+93).
 * Phase 3's step 3 (sign-in, the probe and sessions) raised the ceilings it passed under D115 (size limits do not
 * gate the epic; 2026-11-13), each to its measurement plus a margin. First paint 294,515 and 91,544 gzip, +5,693
 * and +2,234 over `main` at `f7ecbd43` (288,822 and 89,310), past step 3's allowance of 1,950 and 800: the probe
 * and `DeferredAuthAdapter` in `identity.ts` (about 2,300), the signed-out main and the title bar's account
 * button, and afd-auth's errors, listeners and session state, which `auth` shares and the `events` group pins
 * into first paint (the last two not measured apart). `jsGzip` 91,000 to 92,000. `lateIdentityMinified` 16,000 to
 * 24,000: the identity commands, `HUMAN_REQUIRED`, the follow-ups of step 2 and the Mock's session and passkey
 * capabilities (22,629, from 7,304). New rows: `authMinified`, Better Auth's client with its passkey and
 * organization plugins, `BetterAuthAdapter` and `SessionSync`, 68,767, set at 72,000; `signInMinified`, 8,489,
 * set at 9,300; `accountMenuMinified`, 3,543, set at 3,900. `late` 73,968 (+493) and the kernel alone 114,402
 * (+153) are within their rows; `switcher` 11,317 is at its ceiling.
 * Phase 3's step 4 (the account section, members and owners) raised the ceilings it passed under D115, each to its
 * measurement plus a margin, measured against `main` at `4e11c2ce` on the same machine. First paint 296,364 and
 * 92,051 gzip, +1,639 and +434 over `main` (294,725 and 91,617), with no allowance in 13: `DeferredAuthAdapter`'s
 * deferred `organization` and `account` capabilities, the not-a-member notice's invitations button, the account
 * route and the shell's `invitations` action, and `section-open`'s `account`. `jsGzip` 92,000 to 93,000;
 * `kernelMinified` 114,444 to 114,800 (114,628, from 114,402); `lateMinified` 75,000 to 77,000 (76,194, from 74,036:
 * the owner rules in `project-*` and `workspace-app-set`); `lateIdentityMinified` 24,000 to 37,000 (34,529, from
 * 22,631: the eleven account and member commands); `signInMinified` 9,300 to 10,500 (10,011, from 8,489: "Can't
 * sign in?"); `urlMinified` 5,247 to 5,700 (5,506, from 5,194: the account section's sync). New row
 * `accountMinified`, the `account` chunk, 20,530 against 13's estimate of 46,000, set at 22,500: it uses no FAST
 * element, since importing FAST's `css` there parts FAST's core from first paint into a chunk of its own.
 * Merged with step 5 and `main` at its later head, step 4 measured again against that `main` on the same machine: first
 * paint 299,204 and 92,920 gzip, +1,639 and +439 over `main` (297,565 and 92,481). `lateMinified` 77,000 to 78,500
 * (77,115, from `main`'s 74,573); `lateIdentityMinified` 37,000 to 47,000 (45,777, from `main`'s 32,468: step 4's
 * eleven commands beside step 5's personas). The kernel alone 115,199 (from 114,973), `sign-in` 10,011,
 * `account-menu` 5,077, `account` 21,046 and `url-sync` 5,506 are within their rows.
 * Phase 3's step 5 (persona) raised the ceilings it passed under D115, each to its measurement plus a margin.
 * First paint 296,567 and 92,170 gzip, +1,842 and +553 over `main` at `4e11c2ce` (294,725 and 91,617), past step
 * 5's allowance of 750 and 300: stage A's read of `loam.persona~<person>` and each call's `persona` context field
 * in the kernel, the rail's emphasis (`railOrder`'s rank and `loam-app-entry`'s emphasized state, +658 in the
 * `events` chunk), the shell's read of the active persona with its announcement, and the title bar's persona
 * title. `jsGzip` 92,000 to 93,000. `kernelMinified` 114,444 to 115,500 (114,969, +567). `lateIdentityMinified`
 * 24,000 to 34,000: the five `persona-*` commands, sign-in's landing and project, and the palette's emphasis
 * (31,821, +9,190). `accountMenuMinified` 3,900 to 5,400: the persona switch (4,868, +1,325). `late` 74,573
 * (+537) is within its row.
 * Phase 6's step 3 (provider and deployment version 4) raised `appsMinified` under D115, from 394,973 to 395,700:
 * measured against `main` at `3c0a3b25` on the same machine, `apps` 394,970 to 395,318 (+348), the projection
 * validator's chunk reading a version 4 projection's `host` by hand, as it reads version 3's `identity` (phase 6
 * specification, 14's row "measured first"), and the shared refusal rows naming version 4. First paint +14 and +7
 * gzip (299,218 and 92,927; `readBoot` reads version 4), the kernel alone +22 and `late` +206
 * (`workspace-deployment-apply`'s journaled `host`), each within its row.
 * Phase 3's step 6 (agent members) raised the two lazy ceilings it passed under D115, each to its measurement plus a
 * margin, against the figures step 4 recorded at `main`'s head (`3c0a3b25`) on the same machine. First paint 299,247
 * and 92,939 gzip, +43 and +19 (the two settle commands' names in `BOOT_ONLY`), within its ceilings, so neither is
 * raised. `lateIdentityMinified` 47,000 to 63,000 (60,649, from 45,777: the seven `agent-member-*` commands with their
 * schemas, `membership-settle` and `agent-member-settle`, the members read for the sponsor rules and the rows filtered
 * for the caller). `accountMinified` 22,500 to 28,000 (25,727, from 21,046: the members tab's agent table, the
 * sponsor's confirm and decline and an owner's add form). `late` 77,579 (+464: line 4 on every command of an agent
 * member and the sponsor's read before the handler) and the kernel alone 115,379 (+180) are within their rows.
 * Phase 5's step 1 (the copilot core) added four rows and raised two under D115, measured on this branch against
 * those figures. First paint 302,781 and 94,604 gzip (+117 and +25: the shell's hook that loads the panel when its
 * part opens, and clears it on a change of person); the copilot itself is never in it. `kernelMinified`
 * 115,500 to 116,800 (116,395, +1,016): kernel interface 5's minted options for the agent port, the trace a nested
 * call inherits, the context fields `late/` adds and the gate in the chain. `lateMinified` 78,500 to 80,500 (79,691,
 * +2,112): the copilot's deps, its input digest and its load beside the other late chunks. New rows, each at its
 * measurement plus a margin: `lateCopilotMinified` 13,900 (12,630 plus 10%, 13,128 after the trust review's fixes: the copilot's seven commands, its
 * records, the agent port's half and the gate); `copilotPanelGzip` 72,800 (58,244 plus 25%, 58,576 after the fixes, as the phase 5
 * specification's 16 sets its rows from a measurement; under its 113 KB, which counted FAST and the spike's
 * harness); and the runtime frame's two chunks, read from `@lushly-dev/loam-copilot`'s `dist/frame/sizes.json`, at
 * 16's 120,000 gzip (95,308 for `anthropic` and `test`, 95,178 for the OpenAI kinds).
 * Phase 4's step 1 (the settings core) added a row and raised three under D115, measured on its branch from `main` at
 * `8f58c33e`. First paint 303,593 and 94,914 gzip, within its rows (section 14's estimate for the step was 450 and
 * 180: stage A's read of the person's `loam.settings` and, in `provider` mode, `loam.appearance.last`, and the
 * appearance's three sources). `kernelMinified` 116,800 to 118,000 (117,473): that read, the shell state's three
 * appearance sources and `appearanceFrom`, and kernel interface 4's types. `lateMinified` 80,500 to 82,000 (81,246):
 * the settings chunk's wiring, the `loam.appearance` alias's write through the settings, `trashDays` written through
 * and the hosted flag. `appsMinified` 395,700 to 417,500 (416,423): the manifest validator's `ui.settings`, five
 * closed definitions that Ajv's standalone code adds about 28,000 unminified bytes for (329,227 to 357,289 for
 * `validate.generated.js`). New row: `lateSettingsMinified` 22,800 (20,698 plus 10%; section 14 estimated 26,000):
 * the five `setting-*` commands, their rules and the shell's two sections. Rebased onto `main` at `1465d4f5`, after
 * phase 5's step 2 had raised `kernelMinified` to 118,000 and `appsMinified` to 397,000 for its own code and the
 * Refined design first paint and CSS: the kernel 118,693, raised to 119,500; `late` 81,372 of 82,000; `apps` 417,099
 * of 417,500; first paint 307,956 and 96,069 gzip, within phase 5's rows.
 * Phase 4's step 2 (the settings section and the palette) added a row and raised four under D115, measured on its
 * branch from `main` at `99055637` on Windows with Node 26.13.1, against step 1's figures above. `jsMinified` 308,000
 * to 308,500 (307,956 to 308,160, +204; gzip 96,132 of 96,500): `~/settings` in the router with a key as its
 * fragment, the rail's comparator reading the person's `railRank`, and the shell refreshing the rail when `loam.rail`
 * changes. `lateMinified` 82,000 to 84,000 (81,372 to 82,866, +1,494): `palette-search`'s `kind` filter and its
 * setting rows' merge by score then name, `section-open`'s `target`, and `app-list`'s rows given the person's rail
 * order. `lateSettingsMinified` 22,800 to 30,500 (22,217 to 27,782, +5,565): the shell's `loam.rail`,
 * `loam.keybindings` and `loam.notifications` with their checks, the palette's setting index, `section-open`'s target
 * and the rail order. `urlMinified` 5,700 to 6,400 (6,077): the settings section's sync and its fragment. New row:
 * `settingsMinified` 36,000, section 14's estimate (30,242: the section, the console's form model with native
 * controls, and the three custom editors; with the console's Violet controls it measured 75,453, so the section's
 * fields are native, as the account and documents sections' are). The manifest's settings checks, shared by
 * `late-settings` and `apps`, are named `setting-checks` so they never read as the `settings` chunk; `apps` 417,105.
 * Phase 4's step 3 (overlays I: toasts, popovers, the F6 stop), under D115, on Windows with Node 26.13.1: `jsMinified`
 * 308,000 to 308,400 (308,140, +184: the toast region's F6 stop, `PART_ORDER`'s `toasts`, and the shell's
 * `overlayAnchors`; section 14 estimated 300 and 120, and gzip stays 96,115 of 96,500). `lateMinified` 82,000 to 88,500
 * (87,930, +6,558): `popover-open` and its menu, anchor and path rules, the toast's `sticky` and `link`, agent toasts and
 * the push rate, each with its written JSON Schema, over section 14's +5,000 for the whole phase. `surfacesMinified`
 * 85,000 to 88,200 (87,677, +3,176): the toast's owner line, link and sticky timer, the region's F6 stop, the anchor
 * finder the kernel's `overlayAnchors` asks, and the `overlays` chunk's loader. New row: `overlaysMinified`, the
 * chrome's `overlays` chunk (`loam-popover`, its layer and a toast's link), 6,336 against section 14's 11,000, at 58%,
 * so lowered by phase 0's rule to its measurement plus 10%, 6,970; step 4's dialogs raise it. After the step's two
 * reviews, `lateMinified` 88,500 to 91,000 (90,158, +2,228: owners held by kind, menu items checked against the
 * palette and their schemas, a change of person closing every overlay, the agent rate per agent interface and person,
 * agent names refused as an app's); `apps` 417,348, `surfaces` 87,943 and `overlays` 6,608 within their rows.
 *
 * Phase 4's step 4 (overlays II), under D115, after its trust review (R3): `main` at `42f9e1c1` and the branch
 * measured from clean package builds in one tree, on Windows with Node 26.13.1. `lateMinified` 93,000 to 104,500
 * (92,316 to 103,981, +11,665: `dialog-open`, `prompt-open` and `overlay-global-set` with their written JSON Schemas,
 * `modal-open`'s actions and element, a prompt's field schema and its value and bound checks, 6.5's answer rule, and
 * the scope an app's question keeps; step 3's re-estimate gave this step about 6,000). `appsMinified` 417,500 to
 * 418,500 (417,370 to 418,055, +685: a view's waiting question refused at a change of person, and its
 * `dev.loam/overlay-result`). `viewMinified` 26,100 to 26,400 (26,043 to 26,236, +193: the view host's
 * `dev.loam/overlay-result` and the overlay openers a leaving view may not send). `surfacesMinified` 88,200 to
 * 93,500 (87,996 to 93,192, +5,196: `loam-modal` as the slot's renderer, with actions, an owner line, an app's
 * element and the person's answer by a private callback, and the layer's loader). `overlaysMinified` 6,970 to
 * 11,000 (6,608 to 10,766, +4,158: dialogs, a prompt's fields and `loam-global`, moved here from `surfaces` by R3;
 * section 14 estimated the whole chunk at 11,000). `lateEditorMinified` 15,305 to 15,400 (15,304 to 15,336, +32).
 * First paint 308,966 to 309,167 (+201, the answer registry the `surfaces` and `editor` chunks share) and 96,387 to
 * 96,477 gzip, the kernel alone 118,894 to 118,973, and `editor` 35,393 to 35,361, within their rows. The first
 * measurement of this step's `surfaces`, 96,469, read a stale chrome build; these replace it.
 *
 * Phase 4's step 8 (autonomy) raised two under D115, measured on its branch from `main` at `9f4bb6d2` on Windows with
 * Node 26.13.1. `lateSettingsMinified` 30,500 to 43,500 (28,400 to 42,595, +14,195): the `autonomy` table, the pure
 * `resolveAutonomy` with its ceilings and write-time bound, `autonomy-get` (single and bulk), `autonomy-list`,
 * `autonomy-set` with its N9 check order and hand-off, and boot's `autonomy-settle`; about a third of it is the three
 * commands' descriptions, input schemas and refusals in words. `settingsMinified` 36,000 to 40,000 (32,094 to 39,323,
 * +7,229): `loam-autonomy-section`, its words and the tree's Autonomy entry. First paint 308,800 and 96,345 gzip,
 * within its rows (`autonomy-settle` joins `BOOT_ONLY`); `late` 83,668 of 84,000, the chunk's wiring. After the step's
 * trust review, with descriptions and refusal text trimmed first (-471): `lateSettingsMinified` 43,500 to 45,500 (42,595
 * to 44,544: identity and catalog state per instance, the workspace in the row's key, `autonomy-list`'s pages, the
 * identifier checks and the copilot's hand-off rule); `settingsMinified` 40,000 to 41,000 (39,323 to 40,198: the
 * section's pages and the cap's link). First paint 308,836 and 96,360 gzip; `late` 83,989 of 84,000.
 * Merged with step 3 (`main` at `9d611137`): `lateMinified` 93,000 to 94,000 (93,244 combined: step 3's overlay wiring
 * beside step 8's autonomy deps, its settle after a refresh or `workspace-app-set`, and the copilot gate's hand-off
 * rule); first paint 309,020 and 96,411 gzip, the kernel alone 119,000, and every other row within its ceiling.
 * Phase 4's step 5 (the inbox), under D115, on Windows with Node 26.13.1, against the figures this file records for
 * `main` with steps 2 and 3 merged. `jsMinified` 309,500 to 310,000 (308,966 to 309,560, +594; gzip 96,545, its row
 * 96,500 to 96,700): the title bar's Inbox button with its count and name, the shell's `unread`, `~/inbox` in the
 * router, and the overlay store's `land` and `openClosed` (section 14 estimated nothing for this step's first paint;
 * the count and the announcement are kept in the `surfaces` chunk instead). `lateMinified` 93,000 to 94,000 (92,316
 * to 93,596, +1,280): the inbox's wiring, one palette verdict shared by menus and actions, and `toast-show` wrapped.
 * `lateSettingsMinified` 30,500 to 45,500 (28,400 to 41,258, +12,858): the five `notification-*` commands with their
 * written JSON Schemas, the quota, the list's cursor and budget, R10's protection, and `toast-show`'s inbox half, over
 * step 3's re-estimate of about 7,000 for them. `appsMinified` 417,500 to 418,000 (417,348 to 417,629, +281): the
 * SDK's `NotificationV1` and `notificationsOver`. `surfacesMinified` 88,200 to 91,000 (87,943 to 90,199, +2,256): the
 * Inbox button's count and the announcement (`apps/inbox-bell.ts`), and a toast's "Open inbox". New row:
 * `inboxMinified`, the chrome's `inbox` chunk (`loam-inbox`), 7,809 against section 14's 10,000, at 78%, so kept at
 * 10,000. After the step's two reviews: first paint 309,769 and 96,595 gzip (+209: the shell loads the count's own
 * chunk, `inbox-bell`, 1,041 with `inbox-words` 266, apps or none, and the button's `99+`), within 310,000;
 * `lateSettingsMinified` 43,941 (+2,683: admission one person at a time, the act's claim, resource links, a lookup by
 * id, the owner line), its row tightened from 45,500 to 44,600; `late` 93,818; `surfaces` 89,549 (the count moved
 * out); `inbox` 9,637 (clearing on a change of access, the lookup by id, the act's busy button). `editorMinified`
 * 35,445 to 35,600 (35,393 to 35,479, +86): a failed save's toast in a module of its own, sticky when the page was
 * hidden; the step's first commit was already over this row, which its record had not measured.
 * Steps 5 and 8 merged (step 5's branch with `main` at `254249c3`), under D115: `lateSettingsMinified` 45,500 to 61,500
 * (60,469 combined: step 5's inbox, 43,976 on its own, beside step 8's autonomy, 44,544 on its own, over the chunk's
 * shared 28,400 of settings); `lateMinified` 94,000 to 95,500 (94,828: both steps' wiring in `late`). First paint 309,930
 * and 96,671 gzip, within 310,000 and 96,700; every other row within its ceiling.
 * Steps 4, 5 and 8 merged (step 5's branch with `main` at `03b036bb`), under D115: `jsMinified` 310,000 to 310,500
 * (310,131; gzip 96,764 of 97,000); `lateMinified` 105,500 to 107,500 (106,836); `surfacesMinified` 93,500 to 95,500
 * (94,868), each both steps' code together. Every other row within its ceiling.
 * Phase 4's step 6 (prompts and confirmations), under D115, on its branch from step 5's head (`3a35be2f`, steps 4, 5
 * and 8 merged) on Windows with Node 26.13.1, against the figures above for those steps merged. First paint 310,406
 * (+275) and 96,862 gzip (+98), within 310,500 and 97,000: the kernel's chain gains the confirmations' gate and two
 * late context fields, and `late/` an unqueued runner. `kernelMinified` 119,500 to 120,000 (119,623, the same).
 * `lateSettingsMinified` 61,500 to 78,500 (60,469 to 78,180, +17,711): `confirmations.ts`, the gate's slot and inbox
 * paths with the key, the window, the limit of five and expiry, the re-check and the one run on confirm, the internal
 * `prompt-settle`, `palette-run` with its prompt's fields, `confirmation-get` and `-withdraw`, each with its written
 * JSON Schema and refusals in words, the act's read and claim on the person's chain. `lateMinified` 107,500 to 110,000 (106,836 to 109,463, +2,627): the
 * confirmations' wiring (the re-check, the palette's command and input check, titles and the digest), the palette's
 * ranking by the active app, its settings with it, each row naming its app (A-P0-1), and the persona ranked after it. `lateEditorMinified` 15,400
 * to 16,000 (15,336 to 15,813, +477): the close prompt (7.3). `appsMinified` 418,500 to 420,500 (418,055 to 420,134,
 * +2,079): a command's `confirm_prompt` and the strict refusal of `confirm` naming `confirmation-get`, with classic
 * Zod's custom and pipe types. `surfacesMinified` 95,500 to 96,500 (94,868 to 96,179, +1,311): the slot's kernel
 * prompts (a confirmation's input, Decline focused, the input prompt answered by `palette-run`), the palette's input
 * rows and app names, and the bell's count and announcement of a confirmation. `editorMinified` 35,600 to 36,000
 * (35,479 to 35,762, +283): the close prompt's answers in place of phase 2's discard modal. `inboxMinified` 10,000 to
 * 11,500 (9,637 to 11,340, +1,703, over section 14's 10,000, accepted under D115 by the coordinator): a confirmation's
 * header, input and state, and Confirm and Decline naming the command.
 * Step 6's trust review, under D115, the same machine: `jsMinified` 310,500 to 311,000 (310,406 to 310,720, +314; gzip
 * 96,945 of 97,000): the journal's redaction of `palette-run`'s wrapped input (R4), the slot's read and answer past
 * the queue once stage B has ended (blocker 8), and the close prompt's tab told to the answer registry (blocker 12).
 * `kernelMinified` 120,000 to 120,500 (120,034, the same). `lateSettingsMinified` 78,500 to 81,000 (78,180 to 80,506,
 * +2,326): the bucket, the shared prior answer, the per-person limit, the slot's stored decline and re-check, the
 * fill's consume and scope, and the list's bounded input. `appsMinified` 420,500 to 421,000 (420,134 to 420,544,
 * +410): the manifest's refusal of a `confirm` input beside a `confirm_prompt`. `inboxMinified` 11,500 to 12,000
 * (11,340 to 11,941, +601): a cut input shown whole before Confirm, and the trusted press.
 * Step 6's second round, under D115, the same machine: `jsGzip` 97,000 to 97,500 (96,945 to 97,013, +68; minified
 * 310,909 of 311,000): a queued call's release (`QueuedTicket.release`) and the recursive redaction of wrapped inputs.
 * `lateMinified` 110,000 to 110,500 (109,568 to 110,023, +455): the release, the archive re-check and the bucket's
 * namespace wired. `lateSettingsMinified` 81,000 to 81,500 (80,506 to 81,152, +646): namespaced buckets with one
 * ownership rule, the bounded slot declines, a listed result bounded, and the archive re-check. `editorMinified`
 * 36,000 to 36,500 (35,912 to 36,153, +241): the close prompt's answer acting only where its scope and document match.
 * Step 6's third round, under D115, the same machine, `redactWrapped` cut first (-330): `jsMinified` 311,000 to 312,000
 * (310,909 to 311,462, +553; gzip 97,256 of 97,500): the redaction of every input another command carries, a notice's
 * action, a menu's items and `overlay-list`'s projection among them, with an unknown command's dropped.
 * `kernelMinified` 120,500 to 121,500 (120,034 to 121,058): that, and the document chain a waiting call gives up.
 * `lateSettingsMinified` 81,500 to 84,500 (81,152 to 83,764, +2,612): the waiting call's chain released and retaken, a
 * call that never ran answered from its record, the slot's decline and the act's end written by `prompt-settle`, the
 * key held across the slot and the inbox, and the per-app bound that never evicts a live window. `surfacesMinified`
 * 96,500 to 97,000 (96,544): `withdrawn` sent for the shell's own questions alone.
 *
 * Phase 4's step 10 (limits, section 11), measured on Windows with Node 26.13.1 against `main` at `254249c3` built on
 * the same machine (first paint 309,128 and 96,461 gzip; the kernel alone 119,119; `late` 93,244; `late-settings`
 * 44,788; `apps` 417,370; `settings` 40,575), each raised to its measurement plus a margin under D115:
 * `jsMinified` 309,500 to 310,600 and `jsGzip` 96,500 to 97,200 (310,360, +1,232, and 97,076, +615: the kernel's
 * limits object, which enforces the defaults from boot, and the journal sink's bound on a whole entry, which must hold
 * when no late chunk loads; the call rate and the hour's counting were moved out of it into `apps` and `late-settings`
 * first, -314); `kernelMinified` 119,500 to 121,000 (120,771, +1,652); `lateMinified` 94,000 to 95,200 (94,953,
 * +1,709: `app-limit-refuse`, the document bound read from `inputBytes` (A-P2-3) and the wiring);
 * `lateSettingsMinified` 45,500 to 51,000 (50,583, +5,795: `loam.limits` with its five keys' words, the quarter rule,
 * `limit-usage-get`, `store-usage-settle` and the settings' reads of the section); `appsMinified` 417,500 to 420,500
 * (420,251, +2,881: the store quota and its `store-usage` rows, the port's rate and input checks, the view broker's
 * message bound, and 25 for the manifest schema's reserved `limit`); `settingsMinified` 41,000 to 42,200 (41,946,
 * +1,371: the usage beside each key).
 * After step 10's trust review (blockers 1 to 12, R1 to R3), against the step's own figures: `jsMinified` 310,600 to
 * 311,800 and `jsGzip` 97,200 to 97,800 (311,543, +1,183, and 97,564, +488: the journal bound that bounds every field it
 * keeps and leaves the sink's margin, JSON measured with no value read as 0, and the refusals in per-minute buckets);
 * `kernelMinified` 121,000 to 122,600 (122,351); `lateMinified` 95,200 to 95,800 (95,556, +603: the documents' charge
 * and refund, the setting rows keyed by workspace, the limits read again once the host is known); `appsMinified`
 * 420,500 to 423,000 (422,704, +2,453: the frame gate, the broker's charges and reads in flight, the port's one JSON
 * copy, the store's charged bytes, charge and refund, and a native handler answering the kernel's refusal); `viewMinified`
 * 26,100 to 26,600 (26,498, +455: the channel's gate before any dispatch, and a refusal's details across the frame).
 * Step 10 merged with `main` at `cb4d5dff` (steps 4, 5 and 8 merged), measured on the combined build, under D115:
 * `jsMinified` to 312,800 and `jsGzip` to 98,000 (312,548 and 97,875: step 10's limits and journal bound beside steps 4
 * and 5's first paint); `lateMinified` to 109,500 (109,143); `lateSettingsMinified` to 67,500 (67,013: the inbox, autonomy
 * and the limits over the settings); `appsMinified` to 424,000 (423,710); `viewMinified` to 26,800 (26,691: the frame
 * gate beside step 4's overlay result). Every other row within its ceiling. Then the owners' notice through the inbox
 * (`limit-notice-push`): `lateMinified` to 109,800 (109,503, +360) and `lateSettingsMinified` to 68,000 (67,841, +828).
 * Step 6 merged with `main` at `ca1b11f3` (step 10 merged), measured on the combined build with the step's inputBytes
 * re-check of a confirmed app's run, under D115: `jsMinified` to 314,500 and `jsGzip` to 98,700 (313,878 and 98,362:
 * step 10's limits and journal bound beside step 6's gate and wrapped redaction); `kernelMinified` to 125,000 (124,312);
 * `lateMinified` to 113,800 (113,255: both steps' wiring); `lateSettingsMinified` to 91,200 (90,579: the confirmations
 * beside the limits' section and commands); `appsMinified` to 426,500 (425,879: the port's limits beside the
 * manifest's `confirm_prompt`). Every other row within its ceiling.
 * Step 6's fourth round, under D115, the same machine: `lateSettingsMinified` 91,200 to 92,500 (90,579 to 91,964,
 * +1,385): the one re-check before every confirmed run, the recorded route in a replay, a settle bound to its row and
 * merged onto it, and the key and the bound held through a decline's write. First paint 314,281 and 98,524 gzip, the
 * kernel alone 124,857 (forwarded results redacted, never failing), within their rows.
 * Step 6's fifth round, under D115, the same machine, `palette-run` split into its own module first: `jsMinified`
 * 314,500 to 315,500 (314,281 to 314,747, +466; gzip 98,653 of 98,700): an act's result redacted by its action's rule,
 * a forwarded result through its target's own rule, and a failed redaction kept unreplayable. `kernelMinified` 125,000
 * to 126,000 (124,857 to 125,473). `lateSettingsMinified` 92,500 to 94,000 (91,964 to 93,273, +1,309): the person in
 * the last check, a replay's bound settle and recorded answer, the shared chain, and declines counted by id.
 * Step 6's sixth round, under D115, the same machine: `jsMinified` 315,500 to 316,500 and `jsGzip` 98,700 to 99,300
 * (314,747 to 315,994, +1,247, and 98,653 to 99,048): the journal's private provenance, each wrapper journaling its
 * child's own journal-safe outcome and an act's command kept out of its result, and a fixed diagnostic for a failed
 * redaction. `kernelMinified` 126,000 to 127,800 (125,473 to 127,272).
 * Step 6's seventh round, under D115, the same machine: `jsMinified` 316,500 to 317,500 and `jsGzip` 99,300 to 99,600
 * (315,994 to 316,903, +909, and 99,048 to 99,332): `journal-provenance.ts`, the running wrappers' children taken from
 * the sink, and each wrapper's entry built from them, failing closed. `kernelMinified` 127,800 to 129,000 (127,272 to
 * 128,497). A follow-up in the spec moves this into `late`.
 * Step 6's eighth round, under D115, the same machine: `kernelMinified` 129,000 to 129,500 (128,497 to 129,028): a
 * wrapper's child started, the whole recorded outcome, and the lossy entry of an untracked wrapper. First paint 317,299
 * and 99,456 gzip, within their rows.
 * Step 6 merged with step 7 (`main` at `c5a97c9d`, #1657), measured on the combined build, under D115: `jsMinified`
 * to 322,800 and `jsGzip` to 101,700 (322,160 and 101,328: step 7's key matcher beside step 6's gate and the journal's
 * wrapper provenance); `kernelMinified` to 132,200 (131,578); `lateMinified` to 117,200 (116,561); `lateEditorMinified`
 * to 16,400 (16,074); `lateSettingsMinified` to 101,500 (100,819: the keybinding resolver and overrides beside the
 * confirmations); `appsMinified` to 428,800 (428,162). Every other row within its ceiling.
 *
 * Phase 4's step 7 (keybindings, section 8), measured on Windows with Node 26.13.1 on its branch from `main` at
 * `ca1b11f3`, against step 10's merged figures above, each raised to its measurement plus a margin under D115:
 * `jsMinified` 312,800 to 316,500 and `jsGzip` 98,000 to 99,500 (315,952, +3,384, and 99,161, +1,276; section 14
 * estimated 600 and 250 for the key matcher): the matcher on any layout (8.2), a sequence's wait (8.1), `when`'s focus
 * terms, Mod+Alt+P's switcher, save through the bindings in force, the registry's resolver seam and its phase 1 band
 * until the late load, and a reserved action's refusal (R1). The resolver itself, overrides and `keybinding-list` were
 * moved out of first paint into `late-settings` first (-1,526); `kernelMinified` 122,600 to 125,200 (124,650: the
 * registry, the refusal, the runnable check, and the index's types and `whenProblem`); `lateMinified` 109,800 to
 * 110,500 (110,224: the wiring); `lateEditorMinified` 15,400 to 15,600 (15,447: the active tab's type for `when`);
 * `lateSettingsMinified` 68,000 to 73,500 (72,883, +5,042: the resolver, `keybinding-list` and the person's overrides
 * read per workspace); `appsMinified` 424,000 to 426,500 (426,064, +2,354: the manifest's sequences and `when`, their
 * two codes and the version 1 refusal); `settingsMinified` 42,200 to 44,800 (44,352, +2,152: the editor's sequences,
 * target and warnings, and the chunk's copies of the matcher's rules).
 * After step 7's reviews (keys trusted and resolved once in the shell, overrides tied to their person, eligibility and
 * the palette's shortcut map moved into `late-settings`, `whenProblem` no longer re-exported), against the step's own
 * figures: first paint 316,078 and 99,262 gzip (+126 and +101), within `jsMinified` and `jsGzip`; `kernelMinified`
 * 125,200 to 124,300 (123,775, -875); `lateMinified` 110,500 to 111,000 (110,541: the command info read from the
 * registry); `lateSettingsMinified` 73,500 to 74,200 (73,694: the shortcut map, R7's and R8's checks);
 * `settingsMinified` 44,800 to 46,400 (45,912, +1,560: the editor's copy of the whole list's check and its warnings).
 * Of those moves, the override eligibility went to `late` (its command info, read from the registry) and the palette's
 * shortcut map to `late-settings` (the re-check's 10).
 * After step 7's re-check (one readiness for dispatch, the list and the hints; the late load's failure applying the
 * defaults; Mod+S held while not ready; repeats and AltGr; the switcher's and palette's guards), against the figures
 * above: `jsMinified` 316,500 to 317,500 and `jsGzip` 99,500 to 100,000 (316,988, +910, and 99,580, +318: the shell's
 * held save and its notice, the prefix cleared in the capture phase, the matcher's repeats and AltGr, and the kernel's
 * readiness states); `kernelMinified` 124,300 to 125,000 (124,503); `switcherMinified` 11,317 to 11,600 (11,445: the
 * guard on the listbox); `settingsMinified` 46,400 to 46,900 (46,410: the warnings by the list's order).
 * After step 7's third round (the adapter's person in readiness, the shell's toast with unreadable preferences, the
 * retry stopped on dispose, `oneOf` eligibility): first paint 317,050 and 99,602 gzip, within its rows; `late` 110,968
 * of 111,000; `lateSettingsMinified` 74,200 to 74,800 (74,598: the toast's default preferences, the retry's stop and
 * the overrides reader moved into `setting-overrides.ts`).
 * After step 7's fourth round (the failure state first, disposal across the late load, `emptyMeets`, the editor's
 * winner): first paint 317,125 and 99,614 gzip, within its rows; `lateMinified` 111,000 to 111,500 (111,103: `emptyMeets`
 * and the disposal flag); `settings` 46,865 of 46,900.
 * After step 7's fifth round (the kernel's disposal carried into the late load, `emptyMeets` failing safe in its own
 * module, the failure's defaults in `keybinding-list`, an expiring session still naming its user): first paint 317,298
 * and 99,660 gzip, within its rows; `lateMinified` 111,500 to 112,800 (112,243); the `settings` chunk 46,900 to 47,400
 * (47,028: the editor's warning runs the resolver's rule over the proposed list, R12).
 * After step 7's sixth round (stage B and the late load end at each await once the kernel is disposed; a mounted
 * schema discovery replaced gets no chord; the failure's hints leave out an app's `when` bindings): first paint 317,362
 * and 99,692 gzip, within its rows; the kernel alone 125,000 to 125,500 (125,037); `late` 112,345 of 112,800.
 * Phase 5's step 3 (enforcement and approval health), under D115, on macOS with Node 26, against `main` at
 * `0ab76415`: `jsMinified` 326,800 to 327,500 (326,812, +12: a confirmed copilot call's trace and a host command's
 * definition passed to `late/`); `kernelMinified` 137,400 to 138,000 (137,497); `lateMinified` 118,500 to 121,500
 * (120,298: the enforcement's wiring, the inbox reads its cards and approval health take, and the members hand-off);
 * `lateCopilotMinified` 13,900 to 24,000 (22,599, +8,699: the gate of 6.1, the suggestion records, approval health's
 * daily counters, rates and flag, the waiting turn and its continuation); `lateSettingsMinified` 101,500 to 104,500
 * (103,709: the confirmations' enforced record and "Run it" in `palette-run`). The `copilot-panel` chunk, with Violet's
 * approval card, 64,287 gzip of its 72,800. After the trust review's fixes: `lateMinified` 121,500 to 122,500 (121,581:
 * the held-by and mount checks, the members hand-off moved to `copilot-wiring.ts`); `settingsMinified` 47,400 to 48,500
 * (48,162: approval health beside the autonomy rules, 6.3); `late-copilot` 23,823 of 24,000, `late-settings` 104,210 of
 * 104,500 and the panel 64,427 gzip, within their rows. After the re-checks' fixes (the port's binding, withdrawal in
 * the settle, dead suggestion prompts): `lateCopilotMinified` 24,000 to 25,000 (24,506); `lateSettingsMinified` 104,500
 * to 105,000 (104,545). After the third and fourth re-checks (the late withdrawal by its call, the reader's access):
 * `lateCopilotMinified` 25,000 to 25,800 (25,177).
 * Phase 5's step 4 (labels, taint and grants to mounts), under D115, on macOS with Node 26, against `main` at
 * `f602b0f9`: `lateCopilotMinified` 25,800 to 32,500 (31,628, +6,451: 5.1's labels and walk, 4.5's schema cut, taint's
 * record and its stored outcomes, 5.3's lowering and the nested gate); `lateMinified` 125,200 to 126,000 (125,280: the
 * copilot's mount wiring and the taint words of a generic ask); `appsMinified` 443,200 to 450,500 (449,407: the
 * manifest validator's `[[calls]]`, the projection's `labels` and a command's `expose.apps`, the port's grant check).
 * After the trust review's fixes: `jsMinified` 330,300 to 331,000 (330,492: the kernel's app-call registry and its
 * refusal of a client kept past a traced call); `lateMinified` 126,000 to 127,000 (126,493: the catalog reads' sources,
 * the confirmed run's grant re-check); `lateCopilotMinified` 32,500 to 35,000 (34,025: stored outcomes in inbox reads,
 * a nested ask's turn waiting, the kernel's answers for a mounted command, the per-part schema cut).
 */
export const CEILINGS = Object.freeze({
	// Raised under D115 by #1786's phase 4, the `violet-` prefix on every token property (seven bytes per name in the
	// chrome's and components' CSS and `loam-theme.css`), each to its measurement against `main` at `56a536413` plus
	// about 300 bytes. Measured: `jsMinified` 349,561; `jsGzip` 109,972; `cssMinified` 12,261; `signInMinified` 11,947;
	// `accountMenuMinified` 5,636; `accountMinified` 40,050; `surfacesMinified` 102,268; `viewMinified` 29,762;
	// `switcherMinified` 11,730; `editorMinified` 36,676; `embedMinified` 6,178; `settingsMinified` 52,816;
	// `editorMoveMinified` 6,092; `overlaysMinified` 11,302; `inboxMinified` 12,366.
	// Raised from 300,000 and 93,000 under D115 by AFD's port of Microsoft FAST Element 3.1.4 into
	// fast-element: measured against `main` at `38d883d9` on the same machine, first paint 299,415 to 303,018
	// (+3,603) and 92,996 to 94,579 gzip (+1,583), the runtime's DOM sink guards on every entrypoint and its
	// hydration markers and traversal; set to each measurement plus a margin. `surfaces` (+100), the cold
	// `switcher` (+100) and `tooltip` (+5) are within their rows.
	// Raised again under D115 by phase 5's step 2 (model access on the desktop), measured at its final head with
	// `main` at `e96c2f00` merged in: first paint 305,658 of 304,000 and 95,533 of 95,500 gzip (stage A's strict
	// reader of the projection's `copilot`, the lazy copilot handed to the kernel and the panel, the panel part's
	// column and scroll stop, and the shell's reset on a sign-in or sign-out), set to 308,000 and 96,500. AFD's
	// theme, Refined (D159), adds 392 (the entry's import of the typefaces' stylesheet and the chrome reading the
	// font tokens); measured with it merged onto `main`, 307,063 and 95,739 gzip, which these ceilings hold.
	// Raised from 308,000 to 309,500 under D115 by the replay and journal follow-ups (#859, #861, #663): measured
	// against `main` at `626187de`, 307,984 to 308,570 (+586) and 96,272 gzip, within its row. Nearly all of it is
	// `IndexedDbJournalSink`'s `last` read (#663), a key cursor back from the end so the status bar reads one entry
	// at boot rather than the whole journal; the rest the kernel's chain placing `late`'s write-through (#861).
	// Phase 4's step 2 on top: 308,160 before that merge (the settings route, the person's rail order and Settings in
	// the rail); measured with that merged, 308,782, which this ceiling holds.
	// Phase 4's step 3 on top, with step 2 merged: 308,966, which this ceiling holds.
	// Phase 4's step 5 on top: 309,560 and 96,545 gzip, the Inbox button (above); set to 310,000 and 96,700.
	// Steps 4, 5 and 8 together (step 5's branch with `main` at `03b036bb`): 310,131; set to 310,500 under D115.
	// Step 6's trust review: 310,720 (the header records it); set to 311,000 under D115.
	// Step 6's third round: 311,462 (the header records it); set to 312,000 under D115.
	// Step 6 merged with step 10: 313,878 and 98,362 gzip (the header records it); set to 314,500 and 98,700 under D115.
	// Step 6's fifth round: 314,747 (the header records it); set to 315,500 under D115.
	// Step 6's sixth round: 315,994 and 99,048 gzip (the header records it); set to 316,500 and 99,300 under D115.
	// Step 6's seventh round: 316,903 and 99,332 gzip (the header records it); set to 317,500 and 99,600 under D115.
	// Phase 4's step 7: 315,952 and 99,161 gzip, the key matcher (the header records it); set to 316,500 and 99,500.
	// After its re-check: 316,988 and 99,580; set to 317,500 and 100,000.
	// Steps 6 and 7 merged: 322,160 and 101,328 gzip (the header records it); set to 322,800 and 101,700 under D115.
	// Raised under D115 by #1701 (expired branded token fail-closed check in afd-auth) and #1704 (bounded pipeline
	// variable expansion in afd-core): measured 325,057 minified and 102,213 gzip against `main` at `e6395319`;
	// set to 325,800 and 102,700.
	// Approval admission in afd-server (the engine records each call's approval policy and admission and refuses an
	// unadmitted gated call), measured in one tree against `main` at `2700c62e`: 325,057 to 326,342 (+1,285); set to
	// 326,800 under D115. Gzip 102,213 to 102,675, within its row.
	// Phase 4's step 9 (experiments), measured in one tree against `main` at `0ab76415`: 326,696 to 326,921 (+225, the kernel's gate filter on the apps' commands and
	// the rail leaving a gated app out); set to 327,000 under D115. Gzip 102,796 to 102,891, within its row.
	// The approval-admission follow-ups, in one tree against `main` at `d6764276`: 326,696 to 326,777 (+81) and gzip
	// 102,795 to 102,827, within both rows. Their review fixes (an approval step admits only a call it may gate, every
	// step's admission must match, an input changed while the step decides is refused): 326,961 and gzip 102,905; set
	// to 327,300 under D115.
	// Phase 3's step 7 (identity over MCP), measured in one tree against `main` at `0ab76415`: 326,696 to 328,238
	// (+1,542): the kernel's principal gate hook (the `gate` option, `KERNEL_OWN`, the server's own call marks and the
	// scope runtime's `membershipOf`/`agentOf`) and the OAuth pages' route in `main.ts`; the gate itself is its own lazy
	// chunk. Set to 328,800 under D115. Gzip 102,796 to 103,170, within its row. After its review's fixes, 328,317 and
	// 103,184, within both rows. Phase 4's step 9 merged on top (`main` at `09f3b0c0`), the combined build: 328,540,
	// within its row.
	// All three merged (phase 3's step 7, phase 4's step 9 and the approval-admission follow-ups, `main` at `f9f61a7c`
	// merged into step 9): 328,805 and gzip 103,379; set to 329,300 under D115.
	// FAST-AF controller-replacement edges (#1389, mid-connect disconnect, connected-behavior tracking, notifier reuse
	// and safe mid-render teardown in fast-element's ElementController), measured against `main` at `4de94c10`: 328,805
	// to 329,804 (+999; gzip 103,590, within 103,700); set to 330,300 under D115.
	// Phase 6's step 5 (the trust-record transport), measured in one tree against `main` at `01d92259`: 330,093 to 330,537
	// (+444; gzip 103,724 to 103,894, within its row): the hosted transport's port and its refresh in the web host, the
	// provider hook's mark in `execute`, and `trust-record-settle` and `member-leave` in the kernel's lists; set to 331,000
	// under D115.
	// #1936 (replay parity for agents' writes: `journal-order.ts` in the kernel's chain and the `autonomy` context field),
	// measured in one tree against `main` at `01d92259`: 330,093 to 331,342 (+1,249); set to 331,800 under D115. After
	// its reviews (each app store's reads and writes told to the journal's order, the replayed decision): 331,750; set to
	// 332,200 under D115.
	// Both merged (#1936 on phase 6's step 5, `main` at `2b304beb`), the combined build: 332,238; set to 332,700 under
	// D115.
	// Phase 5's step 4 merged on both (`main` at `5b01fe89`), the combined build: 332,903; set to 333,400 under D115.
	// Phase 3's step 9, the coordinator's R9: the join, recovery, OAuth login and consent pages apply the profile's
	// last appearance, else the system's, with forced colors winning (`web/src/page-appearance.ts`), in first paint's
	// entry since a lazy chunk would part the modules it uses from first paint. Measured on one tree against the same
	// branch without it (#2061, on `663afd52`): 330,093 to 330,846 (+753; gzip 103,724 to 103,987, +263); on `main` at
	// `fa8ab4a5`, the combined build: 333,649; set to 334,100 under D115.
	// Phase 6's step 11b (the desktop's inbound endpoint, 10.8), against `main` at `663afd52`: 330,391 without it to
	// 331,185 (+794: `main.ts`'s load of the `inbound` chunk on the desktop, and the bindings first paint's `events` chunk
	// now exports to it, the direct registry and its engine, which `vite.config.ts` keeps there so first paint's chunks are
	// unchanged). Merged with step 5 (`main` at `2b304beb`), the combined build: 331,750; set to 332,300 under D115.
	// Merged with #1936 too (`main` at `5b01fe89`), the combined build: 333,363; set to 333,900 under D115.
	// Phase 6's step 11b merged with phase 5's step 4 too (`main` at `06dde692`), the combined build: 334,043; set to
	// 334,600 under D115.
	// Phase 6's step 11b merged with phase 3's step 9 too (`main` at `31b409fb`), the combined build: 334,951; set to
	// 335,500 under D115.
	// Phase 5's step 6 (units, 7.3; the journal's rule for a unit's entries, which first paint's journal applies): 333,441
	// on `main` at `fa8ab4a5`; merged with phase 3's step 9 and phase 6's step 11b (`main` at `d74ab7be`), the combined
	// build: 335,482; set to 336,000 under D115.
	// Raised under D115 by #865 (`JOURNAL_RESULT_UNSERIALIZABLE` fallback in `afd-server`'s journal middleware):
	// measured 336,158 against `main` at `b77e8674`; set to 336,600.
	// Raised under D115 by #1989 / PR #2215 (TypeScript output budgets in `afd-core` and `afd-server`, with
	// `vite.config.ts` keeping both `output-budget.js` modules in first paint's `events` chunk): measured
	// 340,626 against `main` at `0b56ceecb`; set to 341,100.
	// Bug batch #2111/#2112 merged with `main` at `9c3f9f24` (stage A `boot.gated`, lazily hydrated project layout
	// reconciliation in `shell-state.ts`, and `event.experiments` layout refresh in `shell.ts`): measured 341,192
	// (gzip 107,828, within 108,100); set to 341,600 under D115.
	// Raised under D115 by #2117 (cycle-free RAW/WAR `journal-order.ts`, `track` for hosted MCP, `suspend`):
	// measured 342,980 against `main` at `804e17cc`; set to 343,500.
	// Raised under D115 by #1045 (WAW ordering in `journal-order.ts`) and #1634 (`waitForLock` in `host.ts` and
	// `main.ts`), merged on `main` at `bfa42bff`: set to 344,000.
	// Raised under D115 by #2128 (execution-controls batch limits in `afd-core` and validation issue cap in
	// `afd-server/direct`): combined build against `main` at `88cd5f02b` measured 345,762; set to 346,200.
	// Raised under D115 by the violet-elements bug sweep (#1436: `radius.round` in the field token block, which first
	// paint's `violet-token-defaults` chunk carries): measured 346,220 against `main` at `bc316e8e`; set to 346,600.
	// Raised under D115 by #2253/#2300 (`observeGate` + `gateRefusal` provenance in `journal-provenance.ts` and
	// `observeThrows` + thrown `COMMAND_EXECUTION_ERROR` lossy marking in `kernel.ts`/`journal-redact.ts`): combined
	// build measured 347,192 against `main` at `99359760a`; set to 347,600.
	// #2107 (inject wrapper provenance and `redactWrapped` from `late/journal-wrappers.ts`):
	// first-paint JS dropped from 349,265 to 344,982 (-4,283) against `main` at `bd30d790b`; lowered to 346,000.
	// Raised under D115 by #2539 (engine errors carry a recovery in `afd-server`'s `command-routing.ts`, on top of
	// #2576's `secret` commands): measured 346,326 with `main` at `ad9e42890` merged; set to 346,800.
	// Raised under D115 by #2599 (Violet's redrawn system icons: `folder`, `document`, `close`, `search` and
	// `warning`, which first paint carries, grow and `settings` shrinks): measured 346,861 with `main` at `7e75987e9`
	// merged, against 346,795 with main's icons (+66); set to 347,200.
	jsMinified: 353_000, // D115: shell keys (348,039, 5ade6c0f4); #2645 (348,354, 871c1a98a); step 10's 9.1; its 9.2, 348,711; #2846's journal seams, 349,276 (55548acc8); #2675's idempotency keys, 352,572 (7f994c7e4).
	// Raised from 96,500 to 97,000 under D115 by phase 4's step 4 with `main` at `8c3425d8` (phase 5's step 0b) merged,
	// both measured from clean builds in one tree: 96,436 to 96,527 gzip (+91) and 309,074 to 309,275 minified (+201,
	// within its row): the answer registry the `surfaces` and `editor` chunks share, in `events` (+180), and 21 in `layout`.
	// With step 8 merged too (`main` at `254249c3`, 309,128 and 96,461): 309,329 and 96,551, within both rows.
	// afd-server's approval admission with its refusal reasons, against `main` at `2700c62e`: 102,213 to 102,795 gzip
	// (+582); set to 103,200 under D115.
	// Phase 3's step 7 and phase 4's step 9 combined (`main` at `09f3b0c0` merged into step 9): 103,265; set to 103,700
	// under D115.
	// With phase 3's step 7 (`main` at `09f3b0c0`, 103,184) and the approval-admission follow-ups merged: 103,302; set
	// to 103,700 under D115.
	// Phase 5's step 3 with phase 3's step 8 merged (`main` at `46f7ab11`), the combined build: 103,724; set to 104,200
	// under D115.
	// #1936, against `main` at `01d92259`: 103,724 to 104,204 (+480); set to 104,600 under D115. After its reviews:
	// 104,396, within its row. With phase 6's step 5 merged (`main` at `2b304beb`), the combined build: 104,595; set to
	// 105,000 under D115.
	// Phase 3's step 9, the coordinator's R9 (the identity pages' appearance, `jsMinified` above), on `main` at
	// `fa8ab4a5`, the combined build: 105,119 (+263 on its own base); set to 105,500 under D115.
	// Phase 6's step 11b, the same build: 103,821 to 104,363 (+542). Merged with step 5, the combined build: 104,567; set
	// to 105,000 under D115. Merged with #1936 too (`main` at `5b01fe89`), the combined build: 105,232; set to 105,600 under
	// D115.
	// Merged with phase 5's step 4 too (`main` at `06dde692`): 105,541; set to 106,000 under D115.
	// Merged with phase 3's step 9 too (`main` at `31b409fb`): 105,876; set to 106,300 under D115.
	// Phase 5's step 6 (units) merged on them (`main` at `d74ab7be`): 106,042, within its row.
	// #865 (`JOURNAL_RESULT_UNSERIALIZABLE` fallback in `afd-server`'s journal middleware) on `main` at `b77e8674`:
	// measured 106,295 (5 bytes left); set to 106,600 under D115.
	// #1989 / PR #2215 (TypeScript output budgets in `afd-core` and `afd-server`) on `main` at `0b56ceecb`:
	// measured 107,631; set to 108,100 under D115.
	// Bug batch #2111/#2112 merged with `main` at `9c3f9f24`: 107,828, within 108,100.
	// #2117 (`journal-order.ts` RAW/WAR DAG, `track`, `suspend`) on `main` at `804e17cc`: measured 108,293; set to 108,800 under D115.
	// #1045 and #1634 merged on `main` at `bfa42bff`: within 108,800.
	// #2128 (execution-controls batch limits and validation issue cap) merged on `main` at `88cd5f02b`:
	// measured 109,066; set to 109,500 under D115.
	// #2253/#2300 (`observeGate`/`gateRefusal` and `observeThrows` throw tracking) merged on `main` at `2b134a73`:
	// measured 109,491; set to 109,900 under D115.
	// #862 (one `$initial` code-splitting group for first paint): collapsed 14 chunks to 1 (`index`),
	// lowering first-paint gzip from 109,973 to 103,971 (-6,002) against `main` at `bd374912`; lowered to 105,000.
	// #2107 (inject wrapper provenance and `redactWrapped` from `late/journal-wrappers.ts`):
	// first-paint gzip dropped from 104,118 to 102,691 (-1,427) against `main` at `bd30d790b`; lowered to 103,600.
	jsGzip: 105_700, // D115: local workspace export and shell key commands (103,742 on 5ade6c0f4); #2846's journal seams, 104,017 to 104,223 (55548acc8); #2675's idempotency keys, 105,362 (7f994c7e4).
	// Raised from 8,496 to 10,500 by AFD's theme, Refined (D159, D115): `loam-theme.css` 8,217 to 8,431 (+214, the
	// longer shadows and the three font stacks), and the theme's typefaces' `@font-face` rules, 1,820, the first
	// stylesheet `index.html` links; measured 10,251, plus a margin.
	cssMinified: 12_600,
	// AFD's typefaces (D159): six latin woff2 files, Inter 400, 500 and 600, Space Grotesk 600 and IBM Plex Mono
	// 400 and 500, 115,268 bytes, which first paint's text asks for; plus a margin.
	fontsBytes: 116_000,
	// Step 2 too: 117,495 of 116,800, the stop on a sign-in or sign-out and the copilot's new checks; set to 118,000.
	// Raised again under D115 by phase 4's step 1 (the settings core) on top of it: 118,693 of 118,000 (the person's
	// settings read for stage A's paint, the migration's call and kernel interface 4), set to 119,500. `late` 80,500 to
	// 82,000 the same step (81,372: the host decision, the move and the settings chunk's loader).
	// The second review of #1604 (#859, #861, #663), measured in one tree against `main` at `1ec16f4c`: 131,596 to
	// 132,207 (+611): the `oversized` journal mark, the nested-call exposure check, and `afd-view-state` reporting and
	// keeping a failed write; set to 132,600 under D115. First paint (322,183 to 322,639, 101,339 to 101,493 gzip) and
	// `late` (116,561 to 117,193) stay within their rows.
	// Raised under D115 by #1701 and #1704: measured 135,309 against `main` at `e6395319`; set to 136,000.
	// Approval admission in afd-server, against `main` at `2700c62e`: 135,309 to 136,945 (+1,636); set to 137,400 under
	// D115.
	// Phase 4's step 9, measured in one tree against `main` at `0ab76415`: 137,347 to 137,728 (+381); set to 137,800 under D115.
	// Its follow-ups (a listed policy's gate, the canonical input decided on, the middleware's `input-not-canonical`
	// answer), against `main` at `d6764276`: 137,347 to 137,446 (+99); set to 137,800 under D115.
	// Phase 3's step 7, against `main` at `0ab76415`: 137,347 to 141,140 (+3,793): the principal gate's chunk, the
	// connected agents in the member reads and `account-agent-*`; set to 141,700 under D115. Phase 4's step 9 merged on top,
	// the combined build: 141,685; set to 142,200 under D115.
	// Phase 5's step 3 merged on top (`main` at `21374a6d`), the combined build: 142,194 (+509: a confirmed copilot
	// call's trace and a host command's definition passed to `late/`); set to 142,300 under D115. First paint 328,926 of
	// 329,300 and 103,421 gzip of 103,700; `late-copilot` 25,336 of 25,800.
	// Phase 6's step 5, against `main` at `01d92259`: 141,347 to 142,585 (+1,238): the trust records' list and digest,
	// the server's snapshot and calls in the principal gate's chunk, and the provider hook's mark; set to 143,000 under D115.
	// #1936, against `main` at `01d92259`: 141,347 to 143,050 (+1,703: the journal's order for a read a write's handler
	// caused, the replay's recorded answer at the handler and the enforcement gate's journaled decision); set to 143,500
	// under D115. After its reviews (the order by what each read saw): 143,721; set to 144,200 under D115.
	// Both merged (#1936 on phase 6's step 5, `main` at `2b304beb`), the combined build: 145,003; set to 145,500 under
	// D115.
	// Phase 5's step 4 merged on phase 6's step 5 and #1936, the combined build: 145,888; set to 146,300 under D115.
	// Phase 6's step 11b merged with step 5 (`main` at `2b304beb`): 143,189 (`KernelParts.inboundCommands()`, 10.8); set to
	// 143,700 under D115. Merged with #1936 too (`main` at `5b01fe89`), the combined build: 145,542; set to 146,000 under
	// D115.
	// Phase 6's step 11b merged with phase 5's step 4 too (`main` at `06dde692`), the combined build: 146,386; set to
	// 146,800 under D115.
	// Phase 5's step 6 (units, 7.3: the journal's rule for a unit's entries, a mounted command's tool kept with its owner):
	// 146,588 on `main` at `fa8ab4a5`; merged with phase 6's step 11b (`main` at `d74ab7be`), the combined build: 147,148;
	// set to 147,600 under D115.
	// #865 (`JOURNAL_RESULT_UNSERIALIZABLE` fallback in `afd-server`'s journal middleware) on `main` at `b77e8674`:
	// measured 148,058; set to 148,500 under D115.
	// #1989 / PR #2215 (TypeScript output budgets in `afd-core` and `afd-server`) on `main` at `0b56ceecb`:
	// measured 153,404; set to 153,900 under D115.
	// Bug batch #2111/#2112 merged with `main` at `9c3f9f24`: 154,150 (stage A `boot.gated` and lazily hydrated project layout reconciliation in `shell-state.ts`); set to 154,600 under D115.
	// #2117 (`journal-order.ts` RAW/WAR DAG, `track`, `suspend`, `emit` helper) on `main` at `804e17cc`: measured 156,690; set to 157,200 under D115.
	// #1045 (WAW ordering in `journal-order.ts`) merged on `main` at `bfa42bff`: within 157,200.
	// #2128 (execution-controls batch limits in `afd-core` and validation issue cap in `afd-server/direct`)
	// merged on `main` at `88cd5f02b`: measured 159,157; set to 159,600 under D115.
	// Bug batch #2179/#2119/#2118/#2016/#1952 merged with `main` at `b868f8c1`: measured 161,391 (+2,234 over #2128's
	// 159,157: a replay's rerun of a notice's action in `execute`, the gate's journaled `taint`); set to 161,900 under D115.
	// Raised under D115 by #2253/#2300 (`observeGate`/`gateRefusal` in `journal-provenance.ts` and `observeThrows` /
	// thrown `COMMAND_EXECUTION_ERROR` lossy marking in `kernel.ts`/`journal-redact.ts`): measured 162,843 against
	// `main` at `2b134a73`; set to 163,300.
	// Raised under D115 by #2325 (`rerun.done` early-return/throw handling in `kernel.ts` and `contextOmitted` taint
	// unreplayable marking in `journal-redact.ts`): measured 163,350 against `main` at `f7bdb229`; set to 163,900.
	// Raised under D115 by #2105 (per-caller `journalsCommand` filter for `notification-list`, `listedUnit`
	// marker redaction and `JOURNAL_REPLAY` guard in `journal-redact.ts`/`kernel.ts`, on top of #2514 in
	// `@lushly-dev/afd-server`): measured 164,413 against `main` at `adae8843`; set to 164,800.
	// Lowered by #2107 (wrapper provenance and `redactWrapped` injected from `late/journal-wrappers.ts`):
	// measured 158,530 against `main` at `bd30d790b` (-6,036); lowered to 159,000.
	// Raised under D115 by #2576 (`secret` commands in afd-server's journal): measured 159,823 at `main` `e62387541`; set to 160,100.
	// Raised under D115 by #2539 (engine errors carry a recovery: `canCall` and its builders in `afd-server`'s
	// `command-routing.ts`, through the kernel's direct registry): measured 160,603 with `main` at `ad9e42890`
	// merged (after #2576's 159,823); set to 161,000.
	// Raised under D115 by #2648 (`applyContextFields` keeps a schema's exception text out of production errors
	// and reports it to `onError`, in `afd-server`, through the kernel's direct registry): measured 161,059 on
	// `main` at `8b3123580` plus #2648; set to 161,500.
	// Raised under D115 by #2652 (#1743: afd-server's host-state token and one admission pipeline): measured 161,182
	// on `main` at `5ade6c0f4`, 161,304 with #2648 merged (`main` at `e0dbde691`); set to 161,600.
	kernelMinified: 165_300, // D115: #2675's idempotency keys through the direct registry (164,943, 7f994c7e4).
	// Phase 4's steps 2 (+1,494) and 3 (+8,786) together: 92,316 measured with both merged; set to 93,000.
	// Phase 4's step 5: 93,596, the inbox's wiring (above); set to 94,000.
	// With step 8 merged beside them, 93,244; set to 94,000 (the header records it).
	// Steps 5 and 8 together: 94,828; set to 95,500 (the header records it). Step 4 merged on top, measured from
	// clean builds in one tree against `main` at `254249c3`: 93,244 to 105,000 (+11,756), set to 105,500 under D115.
	// Steps 4, 5 and 8 together: 106,836 (step 4's dialogs, prompts and answer rule beside the inbox's wiring); set to
	// 107,500 under D115.
	// Raised under D115 by #1867: measured 117,980 against `main` at `7571d34c` (+780 for overlay scope propagation and
	// agent overlay-list caller isolation); set to 118,500.
	// Phase 4's step 9, measured in one tree against `main` at `0ab76415`: 117,980 to 119,597 (+1,617: the experiments' wiring, the unload of R14 and the gates the
	// apps' detail reads); set to 120,000 under D115. After its two reviews, 120,275 (the per-person notices' wiring and
	// R14's host); set to 120,800.
	// Phase 3's step 8's review: 118,490 to 118,602 (+112), `ownerTitle` moved into its own module, `owner-title`, which
	// the account chunk shares; set to 119,000 under D115. Merged with phase 4's step 9 (`main` at `1832a444`): 120,450,
	// within that step's 120,800, which stands.
	// Phase 5's step 3 merged on top (`main` at `21374a6d`), the combined build: 124,575 (+4,300: enforcement's wiring,
	// the cards' and health's reads, the members hand-off); set to 125,200 under D115.
	// Phase 6's step 5, against `main` at `01d92259`: 124,664 to 127,384 (+2,720): the trust records' wiring, `member-leave`,
	// the server's per-call roster for the sponsor rule, and the routed list `late` shares with `late-hosted`; set to
	// 127,500 under D115.
	// Phase 5's step 4 merged on phase 6's step 5 and #1936, the combined build: 129,416; set to 129,900 under D115.
	// Phase 5's step 5, against `main` at `fa8ab4a5`: 134,203 (+4,787: the mounted approvals' gate, preview and release);
	// set to 134,800 under D115.
	// #2137 (step 5's follow-ups), against `main` at `e28d5629`: 134,928 (+604: the server's code kept out of the
	// shell's words, the refused preview's own suggestion); set to 135,500 under D115.
	// Bug batch #2097/#2098/#2111/#2112/#2113 merged with `main` at `dbc84611`: 135,291, within 135,500.
	// #2108 and #2117 (`tab-sync.ts` cross-tab sync, `recordOrder` in `document-types.ts`/`scope-commands.ts`/`links.ts`/`copilot-wiring.ts`, `suspendOrder`):
	// measured 139,141 against `main` at `804e17cc`; set to 139,700 under D115.
	// #2107 (moved `journal-provenance.ts` and `redactWrapped` from first paint into `late/journal-wrappers.ts`):
	// measured 144,170 against `main` at `bd30d790b` (+4,850 moved from first paint); set to 144,700 under D115.
	lateMinified: 173_100, // D115: 150,050 (5ade6c0f4); step 10's 9.1 to 150,062, its 9.2 to 163,695, its 9.3 to 171,015; its mounted-ui slot (#2719), 171,002 to 172,785.
	// #2117 (`recordOrder` calls in `documents.ts`): measured 13,584 against `main` at `804e17cc`; set to 13,800 under D115.
	lateDocumentsMinified: 13_800,
	// Bug batch #2113: 17,514 (`closeApp` across persisted scopes with R14 dirty re-check, `document-open` gated refusal, `isTypeGated`, `Editors.projects()`); set to 18,000 under D115.
	lateEditorMinified: 18_000,
	// Phase 3's step 7, against `main` at `0ab76415`: 62,702 to 64,976 (+2,274): `account-agent-list` and `-disconnect`,
	// connected agents in `agent-member-list`, `-get` and `-remove`, the account read by the call's person; set to 65,500.
	// After its review's fixes, 65,750 (an owner's removal kept, provider failures mapped); set to 66,300.
	// Phase 6's step 5, against `main` at `01d92259`: 65,829 to 66,629 (+800): `member-leave` and its refusals, and the
	// agent members' roster per call on the server; set to 67,000 under D115.
	lateIdentityMinified: 67_000,
	// Phase 5's step 4 merged on phase 6's step 5 and #1936, the combined build: 34,722; set to 35,500 under D115.
	// Phase 5's step 6 (units, 7.3), with `main` at `fa8ab4a5` merged in: 40,034 (+5,312: the unit's reading and its
	// refusals, the submit and its mode, the composer's hand-off and taint's leaving a unit out); set to 40,500 under D115.
	// After its review's fixes: 41,974 (the composer's context built in the kernel and its body checked, fixed refusals,
	// a confirmed run's unit withheld, the submit's tool resolved); set to 42,500 under D115.
	// #2307 (track changed-preview confirmation replacements across pending registration, waiting turns,
	// `turnsOf`, `check` rescans, and resumed `confirmation-get` reads so a reshow never resumes early and
	// withdraws its replacement): measured 43,684 against `main` at `bc316e8e`; set to 44,000 under D115.
	lateCopilotMinified: 49_100, // D115 (measured 48,645 against cdaf8e1ff): #1508 copilot-message-send attachment validation, read, atomic taint and resume
	// Steps 5 and 8 together: 60,469; set to 61,500 (the header records it). Step 6: 78,180; set to 78,500; after its trust review 80,506, set to 81,000; after its second round 81,152, set to 81,500; after its third, 83,764, set to 84,500; merged with step 10, 90,579, set to 91,200; after its fourth round, 91,964, set to 92,500; after its fifth, 93,273, set to 94,000; merged with step 7, 100,819, set to 101,500.
	// Phase 4's step 9, measured in one tree against `main` at `0ab76415`: 101,093 to 116,636 (+15,543: the four `experiment-*` commands and boot's settle, their
	// rules, refusals and notices in words); set to 117,000 under D115. After its two reviews, 118,500 (removals kept,
	// each person told, the boot withdrawal); set to 119,000. After its re-checks, 119,907 (each plugin's declared ids);
	// set to 120,500.
	// Phase 5's step 3 merged on top, the combined build: 123,388 (+3,481: the confirmations' enforced record and "Run
	// it"); set to 124,000 under D115.
	// Phase 5's step 5, against `main` at `fa8ab4a5`: 124,934 (+1,466: the preview on a confirmation, the release around
	// its run, a changed preview's new confirmation); set to 125,500 under D115.
	// #2108, #2114, #2117 (cross-tab sync change detection + R14 deferral, SemVer stale-shell protection, confirmation `recordOrder`):
	// measured 129,394 against `main` at `804e17cc`; set to 129,900 under D115.
	// #2105 (`recordOrder` for `notification-list`/mutations and budget-cut `replay = 'recorded'`):
	// measured 130,186 against `main` at `05885007`; set to 130,500 under D115.
	lateSettingsMinified: 130_500,
	// Phase 6's step 5: the trust records' routing, the copy and its settle, 3,964 at its first measurement; set to 4,400,
	// that plus 10%. After its trust review and re-check, 5,829 (the copy's holder record and one batch, the person rule, the journal's
	// bound, the strip, the agent reads from the copy and a replay's periods); set to 6,200 under D115.
	lateHostedMinified: 6_200,
	copilotPanelGzip: 72_800,
	copilotRuntimeAnthropicGzip: 120_000,
	copilotRuntimeOpenaiGzip: 120_000,
	// Phase 3's step 7, against `main` at `0ab76415`: 71,703 to 72,707 (+1,004), the OAuth pages' provider client and the
	// connected agents' requests; set to 73,200 under D115.
	authMinified: 73_200,
	// #1484 (Refined field well in `sign-in.ts` and Refined key shadows/transitions in `action-styles.ts`):
	// measured 11,129 against `main` at `a5e79aab`; set to 11,600 under D115.
	signInMinified: 12_300,
	accountMenuMinified: 6_000,
	// Phase 3's step 7, against `main` at `0ab76415`: 25,727 to 30,973 (+5,246), the OAuth login and consent pages and the
	// agents tab; set to 31,500 under D115. After its review's fixes, 31,705 (single sign-on on the login page, `prompt`
	// honoured, only web addresses followed, an owner's removal shown as such); set to 32,300.
	// Phase 3's step 8, against `main` at `09f3b0c0`: 31,835 to 34,627 (+2,792), an app's account sections (5.5): their
	// tabs from `app-list`, a native surface through the surfaces' host, a view's frame from the view chunk. After its
	// review's fixes and re-check 39,283 (+7,448 in all): each tab named by `ownerTitle` (its own `owner-title` chunk, with
	// `shell-name`), the app's settings delivered through `surface-calls` (1,700, shared with `surfaces`), the change of
	// person and main's gate, the view's teardown and the wait for the app surfaces; set to 39,900 under D115.
	accountMinified: 41_000, // D115: phase 5 step 10's 9.2 (the SDK's events): 40,241 to 40,951.
	// Raised under D115 by #862 (`__vite__mapDeps` table emitted in `url-sync` once `vite/preload-helper` lives in the
	// single `$initial` `index` chunk): measured 6,601 against `main` at `bd374912`; set to 6,900.
	urlMinified: 6_900,
	// Step 2 too: 396,210 of 395,700, the stage B reader of the projection's `copilot`; set to 397,000.
	// Phase 4's step 1 on top: 417,099, the manifest validator's `ui.settings`; set to 417,500.
	// Phase 4's step 5 on top: 417,629, the SDK's notices; set to 418,000. Step 4's own rows: 418,500 and 93,500.
	// Phase 4's step 9, measured in one tree against `main` at `0ab76415`: 428,162 to 437,173 (+9,011: the manifest validator's `ui.experiments` and the gates, and
	// `gatesOf`); set to 437,500 under D115.
	// Phase 3's step 8, against `main` at `09f3b0c0`: 428,162 to 433,524 (+5,362), `ui.account` (5.5): its closed branch
	// in the generated validator (Vite's `validate.generated` chunk, 245.62 kB to 249.25 kB before minification) and its
	// rules; set to 434,200 under D115, measured first as 5.5 asks. Nothing moved out: the branch is the validator's, and
	// the validator is what `apps` holds. Merged with phase 4's step 9 (`main` at `1832a444`): 442,582, both steps'
	// branches in the validator; set to 443,200 under D115.
	// Phase 6's step 6, against `main` at `2b304beb`: 444,931, 1,731 over: the hosted relay's sixteen codes in
	// `MountFailureCode`, each with the kernel's own message, suggestion and `retryable` (8.1), and `firstClass` read
	// only under `hybrid`; set to 445,500 under D115.
	// Phase 5's step 4: 449,455 after its review; merged on phase 6's step 5 and #1936, the combined build: 449,668.
	// Phase 6's step 11b merged with #1936 (`main` at `5b01fe89`), the combined build: 443,282 (the step's branch before
	// the merge, 443,081); set to 443,800 under D115.
	// Phase 6's step 11b merged with phase 5's step 4 (`main` at `06dde692`), the combined build: 449,993, within the row.
	// Phase 6's step 6 merged on it (`main` at `06dde692`), the combined build: 452,033; set to 452,600 under D115.
	// Phase 6's steps 6 and 11b together (`main` at `c274ddaa`), the combined build: 452,358, within step 6's row.
	// Phase 5's step 5, against `main` at `fa8ab4a5`: 460,678 (+11,010: the release, the hold, the token's strip and the
	// lane's word); merged on phase 6's steps 6 and 11b (`main` at `49857af5`), the combined build: 463,368; 463,600 stands.
	// #2137 (step 5's follow-ups), against `main` at `e28d5629`: 464,046 (+678: the preview's walk bound, the dispose
	// checks, the era's words for `http`); set to 464,600 under D115.
	// Bug batch #2111/#2112 merged with `main` at `dbc84611`: 464,400, within 464,600.
	// #871 (`fromJsonSchema` + `stripOwnProto` in `@lushly-dev/loam-manifest/validate` and parsed config) and #876 (native
	// handler deadline and post-timeout/commit-time store/client guard in `native.ts`/`store.ts`), merged on `main` at
	// `276855fc`: set to 474,000 under D115.
	// Bug batch #2179/#2119/#2118/#2016/#1952 merged with `main` at `b868f8c1`: 474,014 (+217 over its 473,797 at
	// `a5e79aab`, main's changes since); set to 474,500 under D115.
	appsMinified: 481_500, // D115: phase 5 step 10's 9.1, 473,988 to 478,337; its 9.2, to 478,642; its 9.3 (mounted views), to 480,912; #2846's journal seams, to 481,004.
	// Steps 4 and 5 together: 94,868 (step 4's slot and dialogs beside the inbox's Open inbox and hidden toasts' timers);
	// set to 95,500 under D115.
	// Phase 5's step 3 with phase 3's step 8 merged (`main` at `46f7ab11`; step 8's `surface-calls`, shared with
	// `surfaces`), the combined build: 97,007; set to 97,500 under D115.
	// Phase 5's step 5, against `main` at `fa8ab4a5`: 98,225 (+1,218: the preview's words in the slot); set to 98,800
	// under D115.
	// #2137 (step 5's follow-ups): 98,610 against `main` at `e28d5629` (the preview's escapes and key steps), within the
	// row; merged on `main` at `2e29283a` (FAST-AF's violet borders and options, #2164, and Violet's Loam token tree,
	// #2166), the combined build: 99,063; set to 99,600 under D115.
	// #1484 (Refined key shadows and transitions in `action-styles.ts`, imported by `surfaces`):
	// measured 99,613 against `main` at `a5e79aab`; set to 100,100 under D115.
	// #2235 (explicit empty value and element-identity option tracking in `violet-option`/`violet-listbox`,
	// imported by `surfaces`): measured 100,335 against `main` at `44e711eb`; set to 100,800 under D115.
	surfacesMinified: 104_500, // #2755 (D174's floor): 103,036 at `7d0135d8`; phase 5 step 10's 9.2 to 103,680, raised; D115: its mounted-ui slot (#2719), 104,121 to 104,299.
	// Raised from 25,105 to 25,900 by AFD #1190 (D115): `dev.loam/tokens` reads the contract's component
	// ids, which grew from 108 to 115 with violet-elements' token interface; measured 25,793, plus a margin.
	// Raised from 25,900 to 26,100 by the Refined design (D115): the interface's contract version 2 gives Loam's
	// component ids two more (the heading font and the field's inner shadow; Loam already had the five field
	// colours), 117 in all; measured 25,969, with violet-elements' built styles no longer carrying their
	// comments, plus a margin.
	// Raised from 26,800 to 27,200 by AFD #1577 (D115): `violet-elements`' token interface contract version 3
	// adds `color.accent.background` and `color.accent.text` (119 component ids in all), which `dev.loam/tokens`
	// reads; measured 26,891 against `main` at `11331eca`, plus a margin.
	// Raised from 27,200 to 28,900 by AFD #1486 (D115): the shell's faces for a view's frame, `styles.css.fonts`
	// (`fonts.ts`: the shell's `@font-face` rules, each same-origin file read once as a `data:` URL, with its
	// review's timeout, type check and retry); measured 28,754 against `main` at `2e63c766` (26,891, +1,863), plus
	// a margin. No font byte enters a chunk.
	viewMinified: 30_100,
	consoleMinified: 91_222,
	// Phase 6's step 11b (10.8): the dispatcher, the direct registry's MCP tool surface (the tool router, the meta-tools,
	// the bootstrap tools' describers) and what it shares with `apps`; 36,799, and 37,624 merged with step 5, plus a margin.
	// #1989 / PR #2215 (TypeScript output budgets and `assertToolMeta` on `createDirectToolSurface`, plus `outputBudget`
	// in `afd-detail`/`afd-help`/`afd-docs`) on `main` at `0b56ceecb`: measured 41,008; set to 41,500 under D115.
	// #2128 (`checkBatchLimits`, 41,202) and #2263 (`confirmationMode` / `humanRelay` in `tool-router`/`tools`/`lazy-tools`,
	// measured 41,977 against `main` at `4da8efebe`); raised 41,500 → 42,500 under D115.
	// #2652 (#1743: router outcome, lane acknowledgement, host-state token): 42,572 at `5ade6c0f4`, 42,500 → 43,000;
	// #1746 (the router's name map and lazy groups): 43,015 at `5e33124bc`; raised 43,000 → 43,500 under D115.
	inboundMinified: 44_300, // D115: #2675's idempotency keys in the router and engine (43,977, 7f994c7e4).
	mountMinified: 238_268,
	switcherMinified: 12_100,
	switcherColdMinified: 45_163,
	// Raised from 3,126 to 3,490 by AFD #1054: an Escape is the dialog's while a modal dialog that does not hold
	// the tooltip's entry is open, so the tooltip looks for one through the shadow roots; measured against `main`
	// at `683d8e20` on the same machine, 2,932 to 3,173 (+241), plus phase 0's 10%.
	tooltipMinified: 3_490,
	// Raised from 45,000 to 46,200 by AFD #1159 (D115): violet-button resolves its id-list ARIA attributes to
	// element references on its inner button, so they reach across its shadow root; measured 45,651
	// (+778 over 44,873), plus a margin. Raised from 46,200 to 51,000 by AFD #863 (D115): the home's loading
	// state is `violet-progress`, as design.md's States table asks, and no chunk loaded before the section holds
	// it; measured against `main` at `959a08e7` on the same machine, 45,657 to 50,182 (+4,525), plus a margin.
	// Raised from 51,000 to 52,100 by AFD #1586 (D115): `violet-text-field` adds `error-text` and
	// `part="error-message"` and `loam-projects-section` binds `error-text`; combined build against
	// `main` at `aca2a3397` measured 51,616, plus a margin.
	sectionsMinified: 52_100,
	// Phase 4's step 5: 35,479, a failed save's toast sticky when unseen (above); set to 35,600.
	editorMinified: 37_000,
	// #1484 (`violet-select` replacing native `<select>` in `documents-section.ts`, plus Refined field/button styles):
	// measured 72,452 against `main` at `a5e79aab` (vs 54,560 before #1484); set to 73,000 under D115.
	documentsMinified: 73_000,
	newMinified: 17_366,
	embedMinified: 7_000, // D115: phase 5 step 10's 9.3 (ResourceLinkV2's links): 6,334 to 6,838.
	// Phase 4's step 9, measured in one tree against `main` at `0ab76415`: 47,028 to 50,336 (+3,308: `loam-experiments-section` and its words); set to 50,800 under
	// D115.
	// Phase 5's step 3 merged on top, the combined build: 51,470 (+1,134: approval health beside the autonomy rules); set
	// to 52,000 under D115.
	// Bug batch #2097/#2098: 52,214 (separate read counters, `#showing` commit guard, atomic chrome paint, and stale-safe `settingsHashTarget`); set to 52,500 under D115.
	settingsMinified: 54_000, // D115: shell autonomy rules and storage status (53,660 on 5ade6c0f4).
	// #1484 (Refined primary/secondary `.action` key styles and transitions in `LoamEditorHeld`):
	// measured 5,476 against `main` at `a5e79aab`; set to 5,900 under D115.
	editorMoveMinified: 6_400,
	overlaysMinified: 12_200, // D115: phase 5 step 10's 9.3 (ResourceLinkV2's links): 11,304 to 11,808.
	// Phase 5's step 5: 12,050 (the preview's lines), set to 12,300 under D115.
	inboxMinified: 12_700,
});

/** Group a module id by the package it belongs to. */
function packageOf(id) {
	const path = id.replace(/\\/g, '/').replace(/\?.*$/, '');
	const store = path.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (store) return store[1];
	const nested = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (nested) return nested[1];
	for (const [pattern, name] of [
		[/endpoints\/loam\/packages\/([^/]+)\//, (m) => `@lushly-dev/loam-${m[1]}`],
		[/foundations\/fast-af\/packages\/violet-elements\//, () => '@lushly-dev/violet-elements'],
		[
			/foundations\/fast-af\/packages\/element\/packages\/fast-element\//,
			() => '@lushly-dev/fast-element',
		],
		[
			/\/packages\/(core|server|auth|view-state|local-db)\//,
			(m) => (m[1] === 'local-db' ? '@lushly-dev/local-db' : `@lushly-dev/afd-${m[1]}`),
		],
	]) {
		const match = path.match(pattern);
		if (match) return name(match);
	}
	return path;
}

/** Bytes per package of the chunks given, from Rolldown's rendered lengths. */
function breakdown(chunks) {
	const sizes = new Map();
	for (const chunk of chunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			sizes.set(packageOf(id), (sizes.get(packageOf(id)) ?? 0) + info.renderedLength);
	return [...sizes.entries()].sort((a, b) => b[1] - a[1]);
}

async function measurePage() {
	const result = await build({ root: ROOT, logLevel: 'warn', build: { write: true } });
	const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
	const chunks = new Map(
		output.filter((item) => item.type === 'chunk').map((c) => [c.fileName, c])
	);
	const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
	const initial = new Set();
	const visit = (fileName) => {
		if (initial.has(fileName)) return;
		initial.add(fileName);
		for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
	};
	for (const match of html.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)) visit(match[1]);
	const css = [];
	for (const match of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.?\/?([^"]+)"/g))
		css.push(match[1]);
	if (![...chunks.keys()].some((name) => /^assets\/surfaces-/.test(name))) {
		throw new Error('budget: the build has no `surfaces` chunk to measure');
	}
	if (![...chunks.keys()].some((name) => /^assets\/console-/.test(name))) {
		throw new Error('budget: the build has no `console` chunk to measure');
	}
	const initialChunks = [...initial].map((name) => chunks.get(name)).filter(Boolean);
	const classic = initialChunks
		.flatMap((chunk) => Object.keys(chunk.modules ?? {}))
		.filter((id) => /zod[\\/]v4[\\/](classic[\\/]|core[\\/]to-json-schema)/.test(id));
	if (classic.length > 0) {
		throw new Error(`budget: first paint holds what belongs to \`apps\`: ${classic.join(', ')}`);
	}
	// One first paint for every deployment: nothing stage B reads is in it (phase 2 specification, 2.2).
	const stageB = [...initial].filter((name) =>
		/^assets\/(apps|validate\.generated|deployment|surfaces|late|url-sync|switcher|tooltip|sections|project-summary-rows|editor|auth|sign-in|account-menu)-/.test(
			name
		)
	);
	if (stageB.length > 0) {
		throw new Error(`budget: first paint holds a chunk of stage B: ${stageB.join(', ')}`);
	}
	// First paint's chunks, by name without their hash: one `index` chunk via `vite.config.ts`'s `$initial`
	// code-splitting group (#862), holding the entry, Vite's preload helper and every shared first-paint module.
	// Any chunk split off by a lazy import fails here.
	const FIRST_PAINT_CHUNKS = ['index'];
	const held = [...initial]
		.map((name) => name.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, ''))
		.sort();
	if (held.join() !== FIRST_PAINT_CHUNKS.join()) {
		throw new Error(
			`budget: first paint's chunks changed: ${held.join(', ')}, not ${FIRST_PAINT_CHUNKS.join(', ')}`
		);
	}
	// `vite.config.ts`'s `$initial` group keeps Vite's preload helper in first paint's single `index` chunk (#862):
	// a chunk of its own would cost first paint an extra request and its gzip overhead.
	if ([...initial].some((name) => /^assets\/preload-helper-/.test(name))) {
		throw new Error(
			'budget: first paint holds a `preload-helper-` chunk: check the `$initial` group'
		);
	}
	const inInitial = Object.keys(chunks.get([...initial][0]).modules ?? {}).map((id) =>
		id.replace(/\\/g, '/')
	);
	if (!inInitial.some((id) => id.includes('vite/preload-helper'))) {
		throw new Error(
			'budget: first paint `index` chunk does not hold vite/preload-helper: check the `$initial` group'
		);
	}
	// With what it imports statically and what loaded before it has not, such as the listbox.
	const closure = (pattern, loaded) => {
		const found = new Set();
		const visitChunk = (fileName) => {
			if (loaded.has(fileName) || found.has(fileName)) return;
			found.add(fileName);
			for (const imported of chunks.get(fileName)?.imports ?? []) visitChunk(imported);
		};
		for (const name of chunks.keys()) if (pattern.test(name)) visitChunk(name);
		return found;
	};
	// In the order a page loads them, so a shared chunk, classic Zod's among them, is charged to the first.
	// `late-documents` is a chunk of its own, with a row of its own, so `late` leaves it out (2.4, step 9).
	// `late-editor` too, step 10's, with a row of its own (2.4, amended 2026-11-07), and phase 3's
	// `late-identity` (phase 3 specification, 13).
	// Phase 5's `late-copilot` too, the copilot's records and commands (phase 5 specification, 2 and 16).
	// Phase 4's `late-settings` too, its settings commands (phase 4 specification, 1 and 14).
	// Phase 6's `late-hosted` too, loaded only in a hosted `provider` shell (phase 6 specification, 14): charged below.
	const late = closure(
		/^assets\/late-(?!documents-|editor-|identity-|copilot-|settings-|hosted-)/,
		initial
	);
	if (late.size === 0) throw new Error('budget: the build has no `late` chunk to measure');
	// `loadLate` awaits it before stage B's last `setAppCommands`, so it loads after `late` and before `apps`.
	const lateDocuments = closure(/^assets\/late-documents-/, new Set([...initial, ...late]));
	if (lateDocuments.size === 0) {
		throw new Error('budget: the build has no `late-documents` chunk to measure');
	}
	// Awaited beside it in `loadLate`, so charged after `late` and `late-documents`, before `apps`.
	const lateEditor = closure(
		/^assets\/late-editor-/,
		new Set([...initial, ...late, ...lateDocuments])
	);
	if (lateEditor.size === 0) {
		throw new Error('budget: the build has no `late-editor` chunk to measure');
	}
	// Awaited beside them, phase 3's (13): charged after `late-editor`, whose state it shares.
	const lateIdentity = closure(
		/^assets\/late-identity-/,
		new Set([...initial, ...late, ...lateDocuments, ...lateEditor])
	);
	if (lateIdentity.size === 0) {
		throw new Error('budget: the build has no `late-identity` chunk to measure');
	}
	// Phase 5's (its 2): awaited after them in `createLateParts`, so charged last of the late chunks.
	const lateCopilot = closure(
		/^assets\/late-copilot-/,
		new Set([...initial, ...late, ...lateDocuments, ...lateEditor, ...lateIdentity])
	);
	if (lateCopilot.size === 0) {
		throw new Error('budget: the build has no `late-copilot` chunk to measure');
	}
	// Phase 4's (its 1): awaited beside `late-identity` in `loadLate`, so charged after the late chunks before it.
	const lateSettings = closure(
		/^assets\/late-settings-/,
		new Set([...initial, ...late, ...lateDocuments, ...lateEditor, ...lateIdentity, ...lateCopilot])
	);
	if (lateSettings.size === 0) {
		throw new Error('budget: the build has no `late-settings` chunk to measure');
	}
	const afterLate = new Set([
		...initial,
		...late,
		...lateDocuments,
		...lateEditor,
		...lateIdentity,
		...lateCopilot,
		...lateSettings,
	]);
	// Phase 3's `auth` (13): Better Auth's client, `BetterAuthAdapter` and `SessionSync`, which stage B loads in
	// `provider` mode only, after `late-identity` and before `apps`. A `local` shell never loads it, so it is charged
	// here and left out of `afterLate`, which every deployment's later rows build on.
	const auth = closure(/^assets\/auth-/, afterLate);
	if (auth.size === 0) throw new Error('budget: the build has no `auth` chunk to measure');
	const afterAuth = new Set([...afterLate, ...auth]);
	// Phase 6's `late-hosted` (its 6.1, 6.3): the routing and the copy, loaded in stage B of a hosted `provider` shell
	// alone, so charged here, after `late`, and left out of `afterLate`, as `auth` is.
	const lateHosted = closure(/^assets\/late-hosted-/, afterLate);
	if (lateHosted.size === 0)
		throw new Error('budget: the build has no `late-hosted` chunk to measure');
	// The sign-in dialog and the account menu, each loaded on a press in a `provider` deployment, whose rail may be
	// empty, so no `surfaces` before them: charged after `auth`, with what they share with later chunks.
	const signIn = closure(/^assets\/sign-in-/, afterAuth);
	if (signIn.size === 0) throw new Error('budget: the build has no `sign-in` chunk to measure');
	const accountMenu = closure(/^assets\/account-menu-/, afterAuth);
	if (accountMenu.size === 0)
		throw new Error('budget: the build has no `account-menu` chunk to measure');
	// Phase 3's step 4: the `account` chunk, the account section, the invitations panel and the join and recovery
	// pages, loaded when one shows, after `auth` (13's estimate 46,000).
	const account = closure(/^assets\/account-(?!menu-)/, afterAuth);
	if (account.size === 0) throw new Error('budget: the build has no `account` chunk to measure');
	// The bundler parts the kernel's `src/apps/` from the validators, because the host reads with them too.
	const apps = closure(/^assets\/(apps|validate\.generated|deployment)-/, afterLate);
	if (apps.size < 3) throw new Error('budget: the build has no `apps` chunks to measure');
	const afterApps = new Set([...afterLate, ...apps]);
	// The URL's chunk loads when stage B ends, after `apps` and before the surfaces start (6.3).
	const url = closure(/^assets\/url-sync-/, afterApps);
	if (url.size === 0) throw new Error('budget: the build has no `url-sync` chunk to measure');
	const afterUrl = new Set([...afterApps, ...url]);
	const surfaces = closure(/^assets\/surfaces-/, afterUrl);
	// What a view app or a console adds when it opens: the surfaces have loaded by then.
	const afterSurfaces = new Set([...afterUrl, ...surfaces]);
	const view = closure(/^assets\/view-/, afterSurfaces);
	if (view.size === 0) throw new Error('budget: the build has no `view` chunk to measure');
	const consoleFiles = closure(/^assets\/console-/, afterSurfaces);
	const mount = closure(/^assets\/mount-/, afterSurfaces);
	if (mount.size === 0) throw new Error('budget: the build has no `mount` chunk to measure');
	// The desktop's inbound dispatcher (phase 6 specification, 10.8), loaded once stage B has, on the desktop alone:
	// charged after `apps`, with the direct registry's tool surface it adds.
	const inbound = closure(/^assets\/inbound-/, afterApps);
	if (inbound.size === 0) throw new Error('budget: the build has no `inbound` chunk to measure');
	// The project switcher's list, loaded on its first press (phase 2 specification, 7.2): in "the rest" of
	// 2.4's load order, so charged after the surfaces.
	const switcher = closure(/^assets\/switcher-/, afterSurfaces);
	if (switcher.size === 0) throw new Error('budget: the build has no `switcher` chunk to measure');
	// The same press on an empty shell, which loads no `apps` and never `surfaces` (7.8): what it downloads
	// after first paint, `late` and `url-sync`, the kit's listbox and option among it (2.4,
	// `switcherColdMinified`, approved by the coordinator on 2026-11-03).
	const cold = new Set([...afterLate, ...closure(/^assets\/url-sync-/, afterLate)]);
	const switcherCold = closure(/^assets\/switcher-/, cold);
	// The rail's tooltip, loaded on its first hover, focus or press, which can come before `late` (7.5).
	const tooltip = closure(/^assets\/tooltip-/, initial);
	if (tooltip.size === 0) throw new Error('budget: the build has no `tooltip` chunk to measure');
	// The projects section (phase 2 specification, 7.7), loaded when main first shows it, in "the rest" of
	// 2.4's order, so after the surfaces; with the kernel's summary rows, which `project-summary-get` loads on
	// its first call, from the section's home: what showing the section costs.
	const sections = closure(/^assets\/(sections|project-summary-rows)-/, afterSurfaces);
	if (closure(/^assets\/sections-/, afterSurfaces).size === 0) {
		throw new Error('budget: the build has no `sections` chunk to measure');
	}
	// The editor area (documents specification, 5 and 12), loaded by the URL's chunk on the first document
	// opened, restored or routed to: in "the rest" of 2.4's order, after the surfaces, which hold the app
	// surfaces' `host()` its frames mount through.
	// Less `editor-move`, a chunk of its own with a row of its own, which loads only without `moveBefore`.
	const editor = closure(/^assets\/editor-(?!move-)/, afterSurfaces);
	// A view editor's move where the browser has no `moveBefore` (documents specification, 5.6): loaded by the
	// editor area then alone, after it. Never first paint's, and charged to no other row.
	const editorMove = closure(/^assets\/editor-move-/, new Set([...afterSurfaces, ...editor]));
	if (editorMove.size === 0)
		throw new Error('budget: the build has no `editor-move` chunk to measure');
	for (const name of editorMove)
		if (initial.has(name))
			throw new Error(
				`budget: \`${name}\` is in first paint, and must load only without \`moveBefore\``
			);
	if (editor.size === 0) throw new Error('budget: the build has no `editor` chunk to measure');
	// The documents section (documents specification, 8 and 12), loaded by the URL's chunk beside the editor
	// area's, with `loam-tree` and `violet-tree`, which an app's tree sidebar loads this chunk for: in "the
	// rest" of 2.4's order, after the surfaces.
	const documents = closure(/^assets\/documents-/, afterSurfaces);
	if (documents.size === 0)
		throw new Error('budget: the build has no `documents` chunk to measure');
	// The New menu with `violet-menu` (documents specification, 7 and 12), loaded on the New button's first
	// press or the palette's first `new` query, after the surfaces as the rest are.
	const newMenu = closure(/^assets\/new-menu-/, afterSurfaces);
	if (newMenu.size === 0) throw new Error('budget: the build has no `new` chunk to measure');
	// `loam-embed` (documents specification, 9.2), a chunk of its own the kit loads for the first editor that
	// embeds, since the `editor` chunk is at its ceiling: after the surfaces, which hold the kit's loader.
	const embed = closure(/^assets\/embed-/, afterSurfaces);
	if (embed.size === 0) throw new Error('budget: the build has no `embed` chunk to measure');
	// The settings section (phase 4 specification, 3.5 and 14), loaded by the URL's chunk when main first shows it:
	// the section, the console's schema form and the three custom editors, after the surfaces as the rest are.
	const settingsSection = closure(/^assets\/settings-/, afterSurfaces);
	if (settingsSection.size === 0)
		throw new Error('budget: the build has no `settings` chunk to measure');
	// Phase 4's overlay renderer (its 14): popovers, and a toast's link, loaded with the first, after the surfaces.
	const overlaysChunk = closure(/^assets\/overlays-/, afterSurfaces);
	if (overlaysChunk.size === 0)
		throw new Error('budget: the build has no `overlays` chunk to measure');
	// Phase 4's inbox (its 10.3 and 14), loaded by the URL's chunk when main first shows it, after the surfaces.
	const inboxChunk = closure(/^assets\/inbox-/, afterSurfaces);
	if (inboxChunk.size === 0) throw new Error('budget: the build has no `inbox` chunk to measure');
	const sizeOf = (files) =>
		[...files].reduce((sum, name) => sum + Buffer.byteLength(chunks.get(name).code), 0);
	// The copilot's panel (phase 5 specification, 16), loaded when the panel part first opens, after the surfaces:
	// a gzip row, as 16 sets it from the spike's measurement.
	const copilotPanel = closure(/^assets\/copilot-panel-/, afterSurfaces);
	if (copilotPanel.size === 0)
		throw new Error('budget: the build has no `copilot-panel` chunk to measure');
	const gzipOfFiles = (files) =>
		[...files].reduce(
			(sum, name) => sum + gzipSync(Buffer.from(chunks.get(name).code), { level: 9 }).length,
			0
		);
	const js = initialChunks.map((chunk) => Buffer.from(chunk.code));
	const gzipOf = (code) => gzipSync(code, { level: 9 }).length;
	const cssAssets = output.filter((item) => item.type === 'asset' && css.includes(item.fileName));
	// The typefaces the linked stylesheet names (D159): every font file the build emits.
	const fontAssets = output.filter(
		(item) => item.type === 'asset' && /\.(woff2?|ttf|otf)$/.test(item.fileName)
	);
	// loam-theme.css is adopted through a constructable stylesheet, so it ships inside the entry.
	let inlineCss = 0;
	for (const chunk of initialChunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			if (/\.css\?inline$/.test(id)) inlineCss += info.renderedLength;
	return {
		files: initialChunks.map((chunk) => ({
			file: chunk.fileName,
			bytes: Buffer.byteLength(chunk.code),
			gzip: gzipOf(Buffer.from(chunk.code)),
		})),
		lazy: [...chunks.keys()].filter((name) => !initial.has(name)),
		lateMinified: sizeOf(late),
		lateDocumentsMinified: sizeOf(lateDocuments),
		lateEditorMinified: sizeOf(lateEditor),
		lateIdentityMinified: sizeOf(lateIdentity),
		lateCopilotMinified: sizeOf(lateCopilot),
		lateSettingsMinified: sizeOf(lateSettings),
		lateHostedMinified: sizeOf(lateHosted),
		copilotPanelGzip: gzipOfFiles(copilotPanel),
		authMinified: sizeOf(auth),
		signInMinified: sizeOf(signIn),
		accountMenuMinified: sizeOf(accountMenu),
		accountMinified: sizeOf(account),
		urlMinified: sizeOf(url),
		appsMinified: sizeOf(apps),
		surfacesMinified: sizeOf(surfaces),
		viewMinified: sizeOf(view),
		consoleMinified: sizeOf(consoleFiles),
		mountMinified: sizeOf(mount),
		inboundMinified: sizeOf(inbound),
		switcherMinified: sizeOf(switcher),
		switcherColdMinified: sizeOf(switcherCold),
		tooltipMinified: sizeOf(tooltip),
		sectionsMinified: sizeOf(sections),
		editorMinified: sizeOf(editor),
		documentsMinified: sizeOf(documents),
		newMinified: sizeOf(newMenu),
		embedMinified: sizeOf(embed),
		settingsMinified: sizeOf(settingsSection),
		editorMoveMinified: sizeOf(editorMove),
		overlaysMinified: sizeOf(overlaysChunk),
		inboxMinified: sizeOf(inboxChunk),
		jsMinified: js.reduce((sum, code) => sum + code.length, 0),
		jsGzip: js.reduce((sum, code) => sum + gzipOf(code), 0),
		cssMinified:
			cssAssets.reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0) + inlineCss,
		fontsBytes: fontAssets.reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0),
		packages: breakdown(initialChunks),
	};
}

async function measureKernel() {
	const outDir = await mkdtemp(join(tmpdir(), 'loam-kernel-budget-'));
	try {
		const entry = fileURLToPath(import.meta.resolve('@lushly-dev/loam-kernel'));
		const result = await build({
			configFile: false,
			root: ROOT,
			logLevel: 'warn',
			plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema()],
			build: {
				outDir,
				emptyOutDir: true,
				write: false,
				target: 'es2022',
				minify: true,
				lib: { entry, formats: ['es'], fileName: 'kernel' },
				// Without `src/apps/` and `src/late/`, which load after first paint. What they widen in the
				// shared Zod is counted on the page's row (9.5).
				rolldownOptions: {
					external: (id) => /[\\/](apps|late)[\\/]index\.js$/.test(id),
					output: { codeSplitting: false },
				},
			},
		});
		const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
		const chunks = output.filter((item) => item.type === 'chunk');
		return {
			kernelMinified: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
			packages: breakdown(chunks),
		};
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

/** An app's own bundle, as its build left it: `recorded, not limited` (9.2). */
/**
 * An app's built files, recorded and never limited: a native app's `.js`, or for a view type, `checklist`
 * (step 13), its pages, each one self-contained file, the editor and the handlers' frame.
 */
function appBundle(app, kind = 'native') {
	const dist = resolve(ROOT, `../../apps/${app}/dist`);
	if (!existsSync(dist)) return null;
	const extension = kind === 'view' ? '.html' : '.js';
	const files = readdirSync(dist).filter((name) => name.endsWith(extension));
	const sources = files.map((name) => readFileSync(join(dist, name)));
	return {
		app,
		kind,
		minified: sources.reduce((sum, source) => sum + source.length, 0),
		gzip: sources.reduce((sum, source) => sum + gzipSync(source, { level: 9 }).length, 0),
	};
}

const ROWS = [
	['jsMinified', 'JavaScript, minified'],
	['jsGzip', 'JavaScript, gzip'],
	['cssMinified', 'CSS, minified, including loam-theme.css'],
	['fontsBytes', "The theme's typefaces, woff2"],
	['kernelMinified', '@lushly-dev/loam-kernel alone, minified with Zod Mini'],
	['lateMinified', "The kernel's `late` chunk and its imports, minified"],
	['lateDocumentsMinified', "The kernel's `late-documents` chunk and its imports, minified"],
	['lateEditorMinified', "The kernel's `late-editor` chunk and its imports, minified"],
	['lateIdentityMinified', "The kernel's `late-identity` chunk and its imports, minified"],
	['lateCopilotMinified', "The kernel's `late-copilot` chunk and its imports, minified"],
	['lateSettingsMinified', "The kernel's `late-settings` chunk and its imports, minified"],
	['lateHostedMinified', "The kernel's `late-hosted` chunk and its imports, minified"],
	['copilotPanelGzip', 'The `copilot-panel` chunk and its imports, gzip'],
	['copilotRuntimeAnthropicGzip', 'The copilot runtime for `anthropic` and `test`, gzip'],
	['copilotRuntimeOpenaiGzip', 'The copilot runtime for the OpenAI kinds, gzip'],
	['authMinified', "The `auth` chunk, Better Auth's client and `SessionSync`, minified"],
	['signInMinified', 'The `sign-in` chunk, `loam-sign-in-dialog`, minified'],
	['accountMenuMinified', 'The `account-menu` chunk, `loam-account-menu`, minified'],
	[
		'accountMinified',
		'The `account` chunk, the account section and the join and recovery pages, minified',
	],
	['urlMinified', "The chrome's `url-sync` chunk and its imports, minified"],
	['appsMinified', "The kernel's `apps` chunks and imports, with classic Zod"],
	['surfacesMinified', "The chrome's `surfaces` chunk and its imports, minified"],
	['viewMinified', "The chrome's `view` chunk and its imports, minified"],
	['consoleMinified', 'The `console` chunk and its imports, minified'],
	['mountMinified', 'The `mount` chunk and its imports, minified: the MCP client'],
	['inboundMinified', "The desktop's `inbound` chunk and its imports, minified"],
	['switcherMinified', "The chrome's `switcher` chunk and its imports, minified"],
	['switcherColdMinified', 'The `switcher` chunk on an empty shell, with the listbox, minified'],
	['tooltipMinified', "The chrome's `tooltip` chunk and its imports, minified"],
	['sectionsMinified', "The `sections` chunk, with the kernel's summary rows, minified"],
	['editorMinified', "The chrome's `editor` chunk and its imports, minified"],
	['documentsMinified', 'The `documents` chunk, with `loam-tree` and `violet-tree`, minified'],
	['newMinified', 'The `new` chunk, with `violet-menu`, minified'],
	['embedMinified', 'The `embed` chunk, `loam-embed` and its link, minified'],
	[
		'settingsMinified',
		'The `settings` chunk, the settings section, its form and three editors, minified',
	],
	[
		'editorMoveMinified',
		"The `editor-move` chunk, a view editor's move with no `moveBefore`, minified",
	],
	['overlaysMinified', "The chrome's `overlays` chunk, popovers and a toast's link, minified"],
	['inboxMinified', "The chrome's `inbox` chunk, the inbox section, minified"],
];

export async function measure() {
	// Every ceiling is measured and every row has one: a row dropped from `ROWS` would leave its ceiling
	// unenforced where `ceiling-raises`, which reads `CEILINGS`, cannot see it.
	const measured = ROWS.map(([key]) => key).sort();
	const ceilings = Object.keys(CEILINGS).sort();
	if (JSON.stringify(measured) !== JSON.stringify(ceilings))
		throw new Error(
			`budget: ROWS and CEILINGS differ: ${[...new Set([...measured, ...ceilings])].filter((key) => !measured.includes(key) || !ceilings.includes(key)).join(', ')}`
		);
	const page = await measurePage();
	const kernel = await measureKernel();
	// The runtime frame's chunks, built by `@lushly-dev/loam-copilot` and copied to `sandbox/copilot/` (16).
	const frame = JSON.parse(readFileSync(resolve(ROOT, '../copilot/dist/frame/sizes.json'), 'utf8'));
	const values = {
		...page,
		kernelMinified: kernel.kernelMinified,
		copilotRuntimeAnthropicGzip: frame['runtime-anthropic.js'].gzipBytes,
		copilotRuntimeOpenaiGzip: frame['runtime-openai.js'].gzipBytes,
	};
	const rows = ROWS.map(([key, label]) => ({
		key,
		label,
		bytes: values[key],
		ceiling: CEILINGS[key],
		over: values[key] > CEILINGS[key],
	}));
	return {
		rows,
		page,
		kernel,
		apps: [
			...['hello', 'tally', 'tasks', 'notes'].map((app) => appBundle(app)),
			appBundle('checklist', 'view'),
		].filter(Boolean),
	};
}

async function main() {
	// Before the build, so its verdict is not lost in the measurements; to stderr with `--json`.
	const json = process.argv.includes('--json');
	const raises = runCeilingRaiseCheck({ log: json ? console.error : console.log });
	const { rows, page, kernel, apps } = await measure();
	if (json) {
		console.log(JSON.stringify({ rows, page, kernel, apps }, null, '\t'));
	} else {
		const pad = (text, width) => String(text).padEnd(width);
		console.log('Loaded before first paint:');
		for (const { file, bytes, gzip } of page.files)
			console.log(
				`  ${pad(file, 44)} ${pad(bytes.toLocaleString('en-US'), 8)} gzip ${gzip.toLocaleString('en-US')}`
			);
		if (page.lazy.length) console.log(`Loaded later: ${page.lazy.join(', ')}`);
		for (const row of rows)
			console.log(
				`${pad(row.label, 52)} ${pad(row.bytes.toLocaleString('en-US'), 10)} of ${pad(row.ceiling.toLocaleString('en-US'), 10)} ${row.over ? 'OVER' : `${Math.round((row.bytes / row.ceiling) * 100)}%`}`
			);
		for (const { app, kind, minified, gzip } of apps)
			console.log(
				`${pad(`${app}'s ${kind === 'view' ? 'view pages' : 'native bundle'}, recorded`, 52)} ${minified.toLocaleString('en-US')}, gzip ${gzip.toLocaleString('en-US')}`
			);
		console.log('\nThe page by package (rendered bytes, before minification of names):');
		for (const [name, bytes] of page.packages.slice(0, 15))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
		console.log('\nThe kernel alone by package:');
		for (const [name, bytes] of kernel.packages.slice(0, 8))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
	}
	const over = rows.filter((row) => row.over);
	if (over.length) {
		console.error(`\nbudget: over the ceiling: ${over.map((row) => row.label).join('; ')}`);
		process.exitCode = 1;
	}
	if (raises > 0) {
		console.error(
			`\nbudget: ${raises} ceiling change(s) without what D115's end restores (ceiling-raises above)`
		);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
