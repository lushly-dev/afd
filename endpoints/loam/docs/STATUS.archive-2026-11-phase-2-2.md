# Loam status archive: phase 2, part 2 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

### 2. Scope, projects and documents (continued)

#### Exit run, 2026-11-09

`node scripts/loam-exit-check.mjs 42699728786 42699734639`, run on 2026-11-09 against [`loam.yml` run 42699728786](https://github.com/lushly-dev/afd/actions/runs/42699728786) and [`ci.yml` run 42699734639](https://github.com/lushly-dev/afd/actions/runs/42699734639), exited 0. Each row counts the passing tests with its title in the job and step it names, each count at or above `scripts/loam-exit-check.minimums.json`: Units is the `loam` job's unit step, Chromium its `test:browser` step, Mounted the `mounted` job's `test:mounted`, Editor walk its own job, and AFD's lean path the `loam` job's step of that name.

<details>
<summary>The script's full output</summary>

```
Repository lushly-dev/afd
loam.yml run 42699728786, attempt 1 (workflow_dispatch on main at 9815022f), https://github.com/lushly-dev/afd/actions/runs/42699728786: Affected units success, Build, unit and Chromium success, Editor walk success, Mounted against Umbel success
ci.yml run 42699734639, attempt 1 (workflow_dispatch on main at 9815022f), https://github.com/lushly-dev/afd/actions/runs/42699734639: TypeScript (Node 24.x) success, TypeScript (Node 26.x) success, TypeScript (Node 22.x) success
P2-E1: Chromium 7
P2-E2: Bundle budget JavaScript, minified 286084 of 300000, JavaScript, gzip 88196 of 91000; Chromium 2; AFD's lean path 2
P2-E3: Chromium 25
P2-E4: Units 22; Chromium 4
P2-E5: Units 20
P2-E6: Mounted 11
P2-E7: Units 32; Chromium 3
P2-E8: Units 186; Chromium 31
P2-E9: Chromium 5
P2-E10: Units 20; Chromium 1
P2-E11: Units 5; AFD's lean path 6
P2-E12: Chromium 19
P2-E13: Chromium 155; Mounted 11; Units 44
P2-E14: this check
P2-D1: Chromium 2
P2-D2: Chromium 2; Units 2
P2-D3: Units 8
P2-D4: Units 48
P2-D5: Units 63; Chromium 71; Editor walk 15
P2-D6: Units 25; Chromium 1
P2-D7: Chromium 1
P2-D8: Chromium 23
P2-D9: Units 14; Chromium 5
P2-D10: Chromium 26; Units 7

The exit check passes: every job a success, every row passing where it names.
```

</details>

#### Handoff, 2026-11-02

Written when the session coordinating phase 2 ran out of account capacity. `main` was at `2f3624e0`. Read this block, then the [plan](phases/2-scope-projects/spec.md#16-implementation-plan).

**Authority.** The owner's standing grant covers commit, pull request and merge on green, and approving later phase specifications after an independent review, recording the approval here, with no check-in between phases. Never publish or release. A change to the trust model, or contradicting an owner decision, goes to the owner as a question.

**Update, later on 2026-11-02.** Steps 2 and 3 are merged ([#731](https://github.com/lushly-dev/afd/pull/731), [#730](https://github.com/lushly-dev/afd/pull/730)), and nothing is in flight again. **Step 4 is next:** its prerequisites, 0b, 2 and 3, are met. Steps 2 and 3 each landed after independent reviews and re-checks, and every finding was fixed. The paragraphs below are kept as written; the step lines above and the session log carry what changed.

**Update, at the exit, 2026-11-09.** Phase 2 has exited: E1 to E14 and D1 to D10 pass in [`loam.yml` run 42699728786](https://github.com/lushly-dev/afd/actions/runs/42699728786) and [`ci.yml` run 42699734639](https://github.com/lushly-dev/afd/actions/runs/42699734639) on `main` at `9815022f`, every job `success`, none skipped ([the exit run](#exit-run-2026-11-09)). Nothing is in flight. The paragraphs below are kept as written.

- **Delivered:** one first paint for every deployment, in two stages (D69), and the shell's commands on Zod Mini through AFD's lean schema path (D70), with their results in [2.4](phases/2-scope-projects/spec.md#24-the-budget-and-the-rule); scope on every command, in the journal and replay, over MCP and to a mounted instance (D71, D72, D78); the workspace and project stores (D73); the URL scheme (D74); the rail's two bands, the project switcher and the projects section with each app's summary (D75); manifest version 2 (D76); the store grant keyed by scope (D77) and a port per surface (D83). For documents: the type registry and the shell's records, with content the type's (D79); the editor area, with restore after reload (D80); New and the documents section; links, backlinks, embed and view editors (D81); and `notes` with a second type, `checklist`, a sandboxed view, landed with no shell change (D82).
- **Carried:** first paint is 286,084 / 88,196 of 300,000 / 91,000. Rows at their ceilings: `apps` 393,918 of 394,094, `late-editor` 15,302 of 15,305, `switcher` 11,316 of 11,317, `editor` 35,367 of 35,445, `view` 25,082 of 25,105 and `embed` 6,072 of 6,096; a change that adds to one moves code out or amends the row first. The editor area's frame lifecycle, its fifteen invariants and the seeded walk stay the guard for any change to it. A new shell command still needs deciding in `kernel/src/scope/call-scope.test.ts`.
- **Open with the owner, and not depended on:** whether an agent may ever cause a person's unsaved edits to be lost. As built it may not: an agent never discards a person's draft. Also still open: WebRTC from a view (#711) and D65's reach.
- **Follow-ups now issues:** every open row of the two specifications' Follow-ups tables, #851 to #867 from scope and projects and #868 to #882 from documents (journal size under autosave was already #710), and of "Follow-ups not yet issues" below, #883 to #889. Rows found already done were closed in place: `data.user.id` in the replay's ignore lists (step 2), the workspace glob and the design document (phase 0), and Umbel's vocabulary and placement ([#522](https://github.com/lushly-dev/afd/pull/522)). The two recurring rows stay as standing rules.
- **Next:** phase 4's specification, which phase 2's exit allows, and phase 3's, which phase 1's exit already allowed and which must settle [#852](https://github.com/lushly-dev/afd/issues/852) and [#853](https://github.com/lushly-dev/afd/issues/853). Phase 5 waits on phase 3 and phase 6's hosted lane; the collaboration service waits on phase 6.

**Update, later on 2026-11-09.** Step 13 is merged ([#848](https://github.com/lushly-dev/afd/pull/848)), and D2 closed with it, as the coordinator amended it on 2026-11-09: with its view closed, `checklist-item-add` runs from an agent and through the person's palette interface, since the palette prompts for no input before phase 4. A pull request of its own fixed three things before the exit ([#849](https://github.com/lushly-dev/afd/pull/849)): the input-schema fuzz test's timeout, which `ci.yml`'s scheduled run had hit; focus going into a view's frame after an agent's open, the F6 flake; and the kernel's reference workspace naming `notes`, with D2's scan widened to a quoted `notes`. **Step 14 is next: the exit.** It writes `scripts/loam-exit-check.mjs`, runs `loam.yml` and `ci.yml` by hand on `main`, and records the script's output: every job `success` and none `skipped`, E1 to E14 of the [scope and projects specification](phases/2-scope-projects/spec.md#16-implementation-plan) and D1 to D10 of the [documents specification](phases/2-documents/spec.md#14-exit-criterion-and-tests), each by its title in the log. Carried:

- **Open with the owner, and not depended on:** whether an agent may ever cause a person's unsaved edits to be lost; as built it may not, and an agent never discards a person's draft.
- **Follow-ups that stay open past phase 2,** none of them an exit test, all in the [documents specification's Follow-ups](phases/2-documents/spec.md#follow-ups): a palette that prompts for a command's input and a three-button close, with phase 4's prompts; the shell's chords, F6 among them, inside a view's frame, phase 1's follow-up for phase 4; the differences between Zod and JSON Schema the manifest cannot refuse, and the closed tagged union it over-refuses; Specimen captures of the embed, the inspector and step 11's dialogs; `DocumentsV1` on a handler's context; a deadline for a native handler holding its document's chain; layout-aware chords; a long walk of the editor area once Loam's CI has a schedule; and the rows the phase 2 specification left for later phases.

**Update, end of 2026-11-09.** Step 12 is merged ([#846](https://github.com/lushly-dev/afd/pull/846)), and the manifest's input-schema fidelity rule before it ([#845](https://github.com/lushly-dev/afd/pull/845)); nothing is in flight. D1 closed in step 12. **Step 13 is next** (the second type, `apps/checklist`, ordered in the [documents specification](phases/2-documents/spec.md#15-implementation-plan)); its prerequisite, step 12, is met. Step 13's `git diff` must be empty in `kernel`, `chrome` and `web/src` (D2), so it adds no shell code: a gap it finds is a shell bug to raise, not to patch in that step. Then step 14, the exit. Carried, all recorded in the [documents specification's status](phases/2-documents/spec.md#status):

- **Budget:** first paint 286,084 / 88,196; `late` 67,609 of 75,000 (step 12 ended +5,624 against its line of 5,000, each round approved); `editor` 35,367 of 35,445; `editor-move` 4,173 of 4,205 (the held-draft placeholder, loaded only where `moveBefore` is missing); `view` 25,082 of 25,105; `embed` 6,072 of 6,096; `documents` 54,922 of 56,314; `apps` 393,918 of 394,094.
- **View editors** go through the editor's frame lifecycle and unsaved-mark rule, with fifteen invariants after every step and a seeded walk of fourteen seeds (5, 7 and 77 take view steps). `connectedMoveCallback` keeps a view's window through `moveBefore`; a seed that finds a bug joins the walk.
- **`checklist`:** the `memos` fixture (step 11) and the `sheet` fixture view type (step 12) stood in for it, as those steps' deviations record; step 13 proves D2, and D8's second type, with `checklist` itself.
- **Open with the owner, and not depended on:** whether an agent may ever cause a person's unsaved edits to be lost; as built it may not.

**Update, later on 2026-11-09.** Step 11 is merged ([#837](https://github.com/lushly-dev/afd/pull/837)), and nothing is in flight. **Step 12 is next** (references, embed and view editors, ordered in the [documents specification](phases/2-documents/spec.md#15-implementation-plan)); its prerequisite, step 10, is met, and step 13 needs it. D1 closes in step 12, now that step 11 has merged. First, a pull request of its own fixes the manifest's input-schema checker, which accepts `required` and `minProperties` inside `anyOf`, `oneOf` and `allOf` branches that the kernel's validator ignores (the documents specification's Follow-ups, raised by step 11's re-check). Carried, all recorded in the [documents specification's status](phases/2-documents/spec.md#status):

- **Budget:** first paint 286,084 / 88,195, with 19 bytes of step 11's allowance unused; `apps` 384,955 of 385,114; `url-sync` 5,194 of 5,247; `editor` 32,672 and `late-editor` 15,302 of 15,305; `late` 61,985, step 12's running figure 66,985; `documents` 51,907 of 56,314; `new` 15,998 of 17,366. Step 12's links, embed and view editors add to `editor`, `late-editor` and `late`, so it measures and amends those rows, or moves code to a chunk of its own, first.
- **Recents are per person** (`loam.new.recent~<actor>`, section 7 amended by the coordinator); New's creators must be their own app's commands, and `ui.new` from a mounted manifest is refused.
- **"Needs input"** is one shape check shared by the manifest, chords and the palette, with the parse of `{}` added where the validator is.
- **Open with the owner, and not depended on:** whether an agent may ever cause a person's unsaved edits to be lost; as built it may not.

**Update, 2026-11-09.** Step 10 is merged ([#814](https://github.com/lushly-dev/afd/pull/814)), and nothing is in flight. **Step 11 is next** (New and the documents section, ordered in the [documents specification](phases/2-documents/spec.md#15-implementation-plan)); its prerequisites, steps 10 and 7, are met. Step 12 needs step 10 and may run beside 11. Carried, all recorded in the [documents specification's status](phases/2-documents/spec.md#status) and the Follow-ups:

- **Budget rows near their ceilings:** `editor` 33,359 of 33,365 and `late-editor` 15,302 of 15,305, each raised by its measured cost with the coordinator's approval through step 10's reviews; `url-sync` 4,806 of 5,091; `apps` 384,077 of 384,253; `late` 58,480 of 75,000. Step 12's links, embed and view editors add to `editor` and `late-editor`, so it measures and amends those rows, or moves code to a chunk of its own, first. Step 11's running first-paint allowance is 286,103 and 88,305 (2.4).
- **The editor's frame lifecycle and unsaved marks:** one life per frame moved only by `#move`, and one rule (`wantsMark`) applied by one reconciler, the chrome's only caller of `editor-dirty-set`. Thirteen invariants run after every step of every editor test (`frameViolations`), and a seeded walk (`test:walk`, eleven seeds) runs in `loam.yml`'s `Editor walk` job. A change to the editor area keeps both green, and a seed that finds a bug joins the walk.
- **A new shell command** still needs deciding in `kernel/src/scope/call-scope.test.ts`; step 10's eight are.
- **Deviations 1 to 18** of the documents specification's Status, among them: only the person discards a draft, and an agent's or a server's call never loses one but in the listed toasted cases (16); a server's `document-open` adds its tab without moving the person's screen (17); document records change one at a time per document (18).
- **Open with the owner, and not depended on:** whether an agent may ever cause a person's unsaved edits to be lost. As built it may not: an agent's `editor-dirty-set { dirty: false }` on an unsaved tab is refused, one marked check in `late/editor-commands.ts`.

**Update, 2026-11-07.** Step 9 is merged ([#771](https://github.com/lushly-dev/afd/pull/771)), and nothing is in flight. **Step 10 is next** (the editor area and `notes`, ordered in the [documents specification](phases/2-documents/spec.md#15-implementation-plan)); its prerequisite, step 9, is met. Step 11 needs step 10, and step 12 needs step 10 and may run beside 11. Carried, all recorded in the [documents specification's status](phases/2-documents/spec.md#status) and the Follow-ups:

- **`apps` is 384,233 of 384,253, 20 bytes left,** after the coordinator approved raising it by step 9's measured 4,427 bytes: a step that adds to the `apps` closure moves code to `late` or a chunk of its own, or amends the row, first. Reviewing what `apps` holds, and whether the manifest reader's rules should be a chunk of their own, is a Follow-ups row for a pull request of its own.
- **`late` is 56,860 and `late-documents` 12,016 of its 13,218 ceiling.** First paint is 285,348 / 87,990, and `budget` asserts its exact chunk list.
- **A new shell command must be decided in `kernel/src/scope/call-scope.test.ts`.** The test calls every registered command on a restricted project and a missing one, and fails for a command with no decided input or no named reason to skip it. A command that reads or writes at the call's own scope also belongs in `AT_CALL_SCOPE` (`kernel/src/late/scope-change.ts`), as 3.4's table says.
- **Left by step 9's deviations:** `new-list` and `document-link-*` to steps 11 and 12 (1); expiry must delete a document's links once step 12 adds them (2); `DocumentsV1` on an app's context to steps 10 and 12 (5); D2's scan to step 13 (10).
- **Host note:** T3's preparation of a fresh worktree for a delegated reviewer hung twice on 2026-11-04 and 2026-11-07, never starting; the re-check ran in the coordinator's own clean checkout instead, and returned it clean.

**Update, end of 2026-11-03.** Steps 7 and 8 are merged ([#766](https://github.com/lushly-dev/afd/pull/766), [#764](https://github.com/lushly-dev/afd/pull/764)), and nothing is in flight. **Step 9 is next** (document records, ordered in the [documents specification](phases/2-documents/spec.md#15-implementation-plan)); its prerequisite, step 6, is met, and step 11 also needs step 7, now met. Carried, all recorded in the [specification's status](phases/2-scope-projects/spec.md#status) and Follow-ups:

- **Step 9:** the `document-*` definitions in a `late-documents` chunk of their own, as the coordinator's amendment to 2.4 says. **`apps` is 379,806 of 379,826, 20 bytes left,** after the coordinator approved raising it by the summary rule's measured 833 bytes: a step that adds to the `apps` closure moves code to `late` or a chunk of its own, or amends the row, first.
- **Step 11:** the documents card on a project's home and a summary's `document` links, which open "Nothing here" until then; `loam-tree` in place of `loam-list`'s indented rows; `loam.layout.~documents`, registered beside `~projects` with its ledger line.
- **First paint:** 285,404 / 87,998 after step 7. A `budget` guard holds the preload helper in `events`; the broader regrouping of first paint's shared modules (measured 285,071 / 85,285) is a follow-up for a pull request of its own.
- **Follow-ups opened by steps 7 and 8:** `violet-progress` for the section's loading state (done 2026-11-16, [#863](https://github.com/lushly-dev/afd/issues/863); see the session log); a replayed nested call's subset match on the raw input; a native result AFD's journal middleware cannot serialize, which drops its entry (`JOURNAL_RESULT_UNSERIALIZABLE`); a session that expires with no `auth-*` call and no active project leaves restricted names in the list until the next read; the status bar's project item cut off at 320 px.

**Update, last on 2026-11-03.** Step 6 is merged ([#752](https://github.com/lushly-dev/afd/pull/752)), and nothing is in flight. **Steps 7 and 8 are next, and may run in parallel** (section 16): both need only step 6, as step 9 does. D29 is now confirmed by the owner as the bottom band step 6 built (see the session log). Carried from step 6, all recorded there:

- **Step 7:** what Projects shows, and E3's clauses that land in the projects section, which assert the state and the URL until then, so main says "Choose an app" under `Projects · Personal`; `tasks`' `ui.project_summary`; `loam.layout.~projects`.
- **Step 8:** a mounted instance's own refusal of a project its `projects` does not list. Step 6 dims it, refuses `app-open` and `scope-set { app }` through `canOpen`, leaves it on a switch, and settles a persisted one at boot with `app-settle`, all before the call reaches the instance.
- **Step 11:** `loam-tree` in place of `loam-list`'s indented rows, `tasks`' `ui.new`, Documents, and `rail: false`.
- **Budget:** first paint is 26 bytes under step 6's allowance (285,302 of 285,328), and `switcher` is 11,316 of 11,317. Steps 7, 10 and 11 keep their own allowances of 150, 150 and 600 bytes.

**Update, later on 2026-11-03.** Step 5 is merged ([#739](https://github.com/lushly-dev/afd/pull/739)), and nothing is in flight. **Step 6 is next:** its prerequisite, step 4, is met, and it builds on step 5's router. Step 6 is the first step that depends on the owner's open question on D29: one row of `bandFor`, with the bottom band as specified until the owner answers. Carried from step 5, all recorded in the [specification's status](phases/2-scope-projects/spec.md#status):

- **Step 6:** recreate the surfaces of an app that stays open when Back or Forward changes the scope under it (7.6); a re-sync only acts when the active app changes. Breadcrumbs.
- **Step 7:** what a project's home shows, and E8's projects-section shape. `app-close` inside a project already lands on `{ section: 'projects', path: '' }`, the project's home that its URL names.
- **Step 11:** E8's documents-section and document shapes, which close E8; `urlMinified` (3,719 of 5,091) holds 1,000 bytes of headroom for steps 7 and 11.
- **Phase 3:** browser history keeps the slugs of restricted projects a person visited while allowed in, and slugs come from names. Acceptable while one person holds a store, since the same profile already holds that store and its journal.

**Update, 2026-11-03.** Step 4 is merged ([#735](https://github.com/lushly-dev/afd/pull/735)), and nothing is in flight. **Step 5 is next:** its prerequisite, step 4, is met. Carried from step 4, all recorded in the [specification's status](phases/2-scope-projects/spec.md#status):

- **Step 5:** the chrome's journaled `scope-set { project: null }` at boot for a reload inside a restricted project (6.3), and the URL's `initialScope`. Step 4 only made an explicit `scope-set` to the active scope persist `loam.scope`.
- **Step 8:** a disabled mounted instance is still discovered, and enabling one does not run `app-instance-refresh` (4.1). Its calls are refused as `APP_DISABLED` meanwhile.
- **Step 9:** the `document-*` command definitions go to a kernel chunk of their own, `late-documents`, loaded by an awaited `import()` inside `loadLate` before stage B's last `setAppCommands`, so `createLateParts` becomes asynchronous; and `budget.mjs`'s `late` closure must leave out `late-documents-`, or the chunk counts twice. The coordinator approved this amendment to 2.4's `late` ledger, which no longer reaches the 75,000 ceiling through step 12 (68,625); both specifications agree on it.
- **Phase 6:** over MCP, `layout-*` and `view-state-set` can still write the person's view state. The commands that move a person's scope, main or session (`PERSON_SESSION`) are not served over MCP, and a call `run` did not make moves no scope.
- **A follow-up, step 12 or phase 5:** a frame can name another in-flight `callId` of its own instance, so a view's query can write under a concurrent mutation's call; a per-call channel fixes it, and it weakens D77's "by construction" for views until then.

**Nothing is in flight.** Steps 0a, 0b and 1 are merged, no Loam step has a pull request or a delegate running, and the next steps haven't started. The worktrees `t3-f80183a9` and `t3-65b3c9f9` are finished; their branches are merged and they hold only reproducible build output.

**Next, in the plan's order:** step 2, whose prerequisite is met, and step 3, which may run beside it; step 4 needs 0b, 2 and 3; 5 then 6 need 4; 7 and 8 need 6; 9 needs 6, and 9 to 13 follow the documents specification, with 11 also needing 7; 14 is the exit. Then phase 3, whose specification must restrict `project-create` and `members` as its row in the phase table says, and the phases after it. Phases 3 to 8 have no specification yet.

**Carried into later steps:**

- **Step 2:** keep E5's exclusion of the idle-loaded `palette` and `resize-handle` chunks from its first-paint comparison when it rewrites that test. The failure it answered is [#718](https://github.com/lushly-dev/afd/issues/718).
- **Step 4:** builds 3.6's surface port, which gets a review focused on that boundary. This is the condition of the specification's approval.
- **Step 4:** adds `BOOT_ONLY`'s check in `run` and its exclusion from `mcpOptions().commands`, as 2.2 and E5 and E10 require, when it adds `workspace-deployment-apply` and `document-trash-expire`. Step 2's `KernelParts.runBoot` runs any name with `BOOT_FIELDS`, past the queue, and holds no such check yet.
- **Steps 4 and 6:** await `hydrateOne` before any `set`, because a `set` during a pending read can be lost, and carry out the invalid-record choice as 0b records it in the spec.
- **Step 2:** its regenerated `session-50` is the next `session:record`, so remove `data.user.id` from `REPLAY_IGNORE` and `DIFF_IGNORE` there, which 0b's stable Mock id makes unnecessary. Its `boot` replaces `deferLate`, which step 1 added to carry the web host. A deployment that lists an app is about 10,500 bytes heavier before first paint until then, summed from the budget rows and not measured in Chromium.
- **Steps 0b and 1 together:** the independent review covered step 1 before 0b merged. Only the test suites and CI cover the two combined.
- **Budgets:** first paint is 264,350 bytes and 80,341 gzip on `main`, under step 1's 272,000 and 82,000, against the ceilings of 300,000 and 91,000; the spec's 2.4 ledger runs from these figures. `/direct`'s entry budget was 38,997 of 39,000 when 0a merged, so anything added to the registry's graph must move something out first. Raising a ceiling needs the coordinator's approval.
- **What's left to recover:** `zod/v4/core` still costs 56,683 rendered bytes in first paint, the largest item. `narrow-zod.mjs` stays: without it first paint is 280,521 and 85,070, which misses the target.

**How the work has run:**

- **One step, one pull request.** Each is written in its own worktree by a delegate, which can't wait on CI, so the coordinator watches the pull request and enqueues its verified head (`prepare-pr`'s step 9).
- **Accepting a green:** read `skipping` in `gh pr checks`. "All passed" hid a `mounted` job that never ran ([#705](https://github.com/lushly-dev/afd/pull/705)).
- **After a rebase:** re-read `pnpm verify --list`, run `pnpm install --frozen-lockfile`, rebuild with `pnpm -F "@lushly-dev/loam-web..." build`, and test every replayed commit.
- **Commits:** Conventional Commits, subjects of at most 72 characters, no `loam` scope. Never skip a hook.
- **The word to keep out:** the external reference project stays out of every Loam document and commit; grep before committing.

**The host is shared with other owners' jobs:**

- For a heavy command (`pnpm check`, `pnpm verify`, the pre-push hook, Chromium, workspace builds), check at least 10 GiB free on the disk the checkout writes to (`/Volumes/Dev` on both machines, 1 TB each since November 2026), at least 5 GiB free on the system disk, and a 1-minute load under 50 on the MacBook Air (M5) or 40 on `random` (the Mac mini, M4) (raised from 20 by the owner on 2026-11-13: both have 10 cores and have run well above 20 without failing, the M5 is the faster, and an overloaded Mac only stalls sessions; dial it back if they stall), then hold `/tmp/loam-heavy.lock` with `mkdir`, and `rmdir` it after. New worktrees go on `/Volumes/Dev`, not the system disk.
- **If a delegate ended without finishing, that lock may be orphaned.** Confirm no Loam gate is running before removing it.
- Use `CARGO_BUILD_JOBS=4`. Don't set `CARGO_TARGET_DIR` for Specimen's host; `LOAM_UMBEL_TARGET_DIR` is for Umbel.
- Never stop a process you can't attribute to yourself, or touch another owner's worktree, cache or lock. Free only your own reproducible build output, and keep source, reviews and raw failures.

**Waiting on the owner, none blocking:** WebRTC from a view, #711, recommended accept for now; and D65's reach, recommended accept. D29's rail placement was confirmed on 2026-11-03. Added 2026-11-09, at the exit: whether an agent may ever cause a person's unsaved edits to be lost; as built it may not. Asked 2026-11-09 by the [phase 3 specification](phases/3-identity/spec.md#questions-for-the-owner): six questions, four answered by the owner the same day (D95 to D98), and Q2 (who changes a project's members) and Q4 (whether a sponsor confirms) on 2026-11-12, each as recommended (D110, D111).
