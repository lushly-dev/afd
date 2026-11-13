# Phase 4 specification: settings, experiments, notifications, overlays

| Field | Value |
| --- | --- |
| Phase | 4, settings, experiments, notifications, overlays ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 4 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.4, 4.1, 7.3 and 2.4), the [documents specification](../2-documents/spec.md) (its 5.5), the [identity specification](../3-identity/spec.md) (its 3.3, 3.4, 4.5 and 6), the [hosts specification](../6-hosts/spec.md) (its 6 and 7), the [phase 1 specification](../1-app-contract/spec.md) (its 4 and 8), the [architecture](../../architecture.md), the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-13 by the design sub-agent, against `main` at `f7ecbd43`. **Not reviewed, not approved.** The coordinator commissions two independent reviews and approves it under the owner's standing grant; the [questions for the owner](#questions-for-the-owner) are the owner's, and the text is written to each recommendation. D116 to D127 are proposed here and in the [decision log](../../decisions.md), marked proposed.
- **Last verified:** 2026-11-13 against `main` at `f7ecbd43`, from this evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `overlays.ts:20` (`TOAST_CAP = 5`), `:28-49` (`OverlayStore`: `open` takes `'toast' | 'modal'` only; `closeForSwitch` dismisses toasts and cancels a modal); `overlay-owner.ts` (`SHELL_OWNER`);
    - `late/overlay-commands.ts` (`toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list`; `modal-open` refuses `OVERLAY_OWNER_INACTIVE` for an app neither active nor owning the active tab, `:118-127`, and `OVERLAY_MODAL_BUSY` while a modal is open, `:128-135`; a toast's `durationMs` is 1,000 to 30,000);
    - `appearance.ts:29` (`APPEARANCE_VIEW_STATE_ID = 'loam.appearance'`), registered as a view-state handler in `shell-state.ts:208`, written by `view-state-set` in `SESSION_50` (`session.ts:227-228`);
    - `scope/personal.ts:21` (`PERSONAL`: `loam.scope`, `loam.apps`, `loam.editor`, `loam.layout` are per person in `provider` mode; `loam.appearance` stays the profile's);
    - `keybindings.ts:25-33` (the seven reserved chords), `:60-78` (`createKeybindings`: the reserved chords, then the active app's band; no sequence, no `when`, no override);
    - `palette-index.ts` (`PaletteItem.kind` is `'document'` or absent); `types.ts:296-306` (`APP_CALLABLE_SHELL_COMMANDS_V1`);
    - `scope/records.ts:18` (`WorkspaceV1.trashDays`, phase 2's one workspace-level setting).
  - **Manifest:** `schemas/app-manifest.v2.json`: `$defs.ui` has no `settings`, `experiments`, `menus` or `account` (phase 3's step 8 adds `account`); `$defs.command` and `$defs.mountTool` set `confirm_prompt: false` (`:255`, `:316`); `$defs.keybinding.chord`'s pattern takes one chord; `src/refusal-map.ts:109-116` (`later('ui.settings', 4)`, `ui.experiments`, `ui.menus`, `confirm_prompt` naming phase 4); `src/catalogs.ts:108-111` (`settings`, `experiments`, `notifications` served from 4), `:163` (the `settings` grant from 4).
  - **SDK:** `sdk/src/index.ts:324-328` (`OverlaysV1`: `toast` and `modal`), `:392-422` (`OverlayKindV1 = 'toast' | 'modal'`, `OverlayResultV1.reason` without `park`).
  - **Chrome:** `rail/bands.ts:19` (`bandFor`, R8's seam); `elements/palette.ts:54` ("(needs input)"); `design.md`'s `loam-rail` row (Settings "`aria-disabled` … 'Settings arrive in phase 4'").
  - **Issues read:** #857, #869, #877, #881, #710; the open `loam:` issues list, of which these five name phase 4 and #708 (screen-reader passes) touches its overlays. [Carried](#carried-from-earlier-phases-answered-here) answers each.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-13.
- **Done:** this specification.
- **Not done:** everything it specifies. No step has started.
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 5, scope is shell-level; 6, overlays have owners; 8, agents are first-class users; 13, deterministic core; 15, AFD first.
- **Decisions it depends on:** D1 (settings, experiments and notifications are shell sections); D3 (they are commands); D6 (the overlay policy); D11 (persona is a lens, never a grant); D12 (experiments: a lifecycle, off by default, per-person opt-in, workspace-wide by an owner, what may change and a graduation date shown); D41 (autonomy: suggest, ask or act, inherited downward; **settings in phase 4, enforcement in phase 5**); D51 (phase 4's settings take over appearance's storage without changing its commands); D54 (native apps are trusted code); D67 (phase 4 completes the overlay manager); D71 to D73 and D83 (scope, the order of a call, the ports); D75 and R8 (a personal rail order moves to phase 4); D85 to D87 and D96 (modes, owners, owner commands); D89 (persona); D98 and D110 (connected agents; who changes a project's members); D103 and D104 (trust records and MCP on the hosted lane); D115 (size limits do not gate the epic).
- **Decisions this specification proposes:** D116 to D127 ([Amendments](#amendments-to-the-architecture-and-the-decision-log)).

### Carried from earlier phases, answered here

| Item | Answer |
| --- | --- |
| D51: settings take over appearance's storage | [3.6](#36-appearance-taken-over-d117): `appearance-*` and `view-state-* { id: 'loam.appearance' }` unchanged; the value lives in the person's settings record |
| R8 and D75: a personal rail order | [3.7](#37-the-shells-own-sections): `rail.order`, a person setting `bandFor`'s comparator reads |
| Phase 1's 8: popover, dialog, prompt, global, sticky toasts; an app's element in a modal | [Section 6](#6-the-overlay-manager-d121) |
| Phase 1's `confirm_prompt` refused until phase 4 | [7.2](#72-confirm_prompt) |
| Phase 1's follow-ups: overlays do not name their app; the toast region has no F6 stop; a view swallows the shell's chords | [6.6](#66-whose-overlay-it-is), [6.7](#67-focus-and-the-toast-region), [8.6](#86-chords-inside-a-view) |
| [#869](https://github.com/lushly-dev/afd/issues/869): a palette that prompts for a command's input | [7.1](#71-the-palettes-input-prompt-869) |
| [#881](https://github.com/lushly-dev/afd/issues/881): a three-button close prompt | [7.3](#73-the-close-prompt-881) |
| [#857](https://github.com/lushly-dev/afd/issues/857): a chord for the project switcher | [8.4](#84-the-reserved-chords-version-1) |
| [#877](https://github.com/lushly-dev/afd/issues/877): layout-aware chords | [8.2](#82-matching-a-key-877) |
| [#710](https://github.com/lushly-dev/afd/issues/710): limits on a view's message size, call rate and storage | [Section 11](#11-limits-710-d124) |
| Phase 1's `ui.menus` served from phase 4 | [Section 9](#9-menus-d127) |
| Phase 3's 6.1: `emphasis.sections` names `projects`, `documents`, `account` | Gains `settings` and `inbox` ([3.7](#37-the-shells-own-sections)) |
| Phase 3's 17: "Settings, autonomy: phase 4, seam `ui.account`'s surface" | The account area stays phase 3's; settings are their own section ([3.5](#35-the-settings-section)) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-13 (sources S98 to S100 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 4 |
| --- | --- | --- | --- |
| R3, W4 | Overlays on the top layer with `inert` and anchor positioning; anchor positioning in Safari 26 | Unchanged: the popover attribute in every engine, anchor positioning in Chrome 125, Firefox 147 and Safari 26 [S19] | Popovers and menus use `popover="auto"` and anchor positioning, with phase 1's fallback for older engines ([6.3](#63-placement-and-the-platform)) |
| New W38 | Not watched | `<dialog closedby>` (light dismiss and close requests on a dialog) in Chrome and Edge 134 and Firefox 141; Safari not shipped, tracked as WebKit bug 284592; in Interop 2026 [S98] | **Not used.** A modal closes by Escape (the close request every engine sends) or its buttons, never by a click outside; a non-modal dialog never light-dismisses. Revisit when Safari ships |
| New W39 | Not watched | `popover="hint"` in Chrome 133; Firefox's intent to ship posted February 2026, partial support reported; interest invokers (`interestfor`) shipping in Chromium; Safari not found [S99] | **Not used.** The rail's one shared tooltip stays as phase 2 built it; menus and info popovers are `auto` |
| R8 | A personal, reorderable rail, persisted as view-state | Unchanged; no external dependency | Lands as a person setting ([3.7](#37-the-shells-own-sections)) |
| R10 | Experiments with audiences | Not re-checked externally; the research's practice [S34] stands: opt-in, off by default, an organization-wide toggle, visibility apart from enablement, "not a permission model" | [Section 5](#5-experiments-d119) |
| R15, W26 | Autonomy policy in settings; OWASP's agentic Top 10 with ASI09 | OWASP's Top 10 for Agentic Applications was published 2025-12-09; summaries describe ASI09, human-agent trust exploitation, as polished explanations leading people to approve harmful actions, with forced confirmation of sensitive actions as the first defense [S100] | The autonomy section shows the resolved level and where it came from, and only a person can raise it ([section 4](#4-the-autonomy-section-d118)); enforcement and approval metrics stay phase 5's |
| W11 | MCP Events, SEP-3415 | Not re-checked | The inbox is a store a person reads by cursor; nothing projects it over MCP in phase 4 |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and phases 2 and 3's. This specification adds:

| Term | Meaning |
| --- | --- |
| Section | A settings section: an id, a title, a schema and the levels it may be set at ([3.1](#31-a-section)) |
| Key | One property of a section's schema, with a default |
| Level | Where a value is set: `person`, `workspace` or `project`. The architecture's "user scope" is `person`, phase 3's word |
| Shared value | A value set at `workspace` or `project` level, which every member reads |
| Resolved value | What a key reads for one person in one scope ([3.3](#33-resolution)) |
| Autonomy mode | `suggest`, `ask` or `act` (D41) |
| Ceiling | The workspace's highest autonomy mode, which no row below it may exceed ([4.2](#42-resolution)) |
| Stage | An experiment's lifecycle stage, set by its author: `hidden`, `visible`, `graduated`, `removed` ([5.1](#51-the-declaration)) |
| Enablement | Whether an experiment is on, for one person or for the workspace ([5.2](#52-enablement)) |
| Gate | `requires_experiment` on an app or a surface: present only while the experiment is on for the person |
| Inbox | The shell's notifications section: a person's notifications, read by cursor ([section 10](#10-the-inbox-d120)) |
| Overlay slot | The one place a modal or a prompt occupies, shell-wide ([6.1](#61-kinds-and-the-policy-table)) |

## 1. Units and repository placement

No new package. Every change is in phase 0 to 3's units.

| Package | Change |
| --- | --- |
| `kernel` | `late-settings`, a chunk of its own loaded inside `loadLate` beside `late-identity`: the `setting-*`, `autonomy-*`, `experiment-*` and `notification-*` commands, `resolveSetting`, `resolveAutonomy`, `experimentOn`; the overlay store's new kinds and its state machine (`late`); the `setting`, `autonomy`, `experiment-enablement` and `notification` tables; the person's settings record `loam.settings` ([3.4](#34-storage)); keybindings version 1 ([section 8](#8-keybindings-version-1-d123)); the limits ([section 11](#11-limits-710-d124)); kernel interface version 4 ([12](#12-the-kernel-and-the-sdk)) |
| `chrome` | `loam-settings-section` and its schema form (chunk `settings`); `loam-inbox` (chunk `inbox`); `loam-popover`, `loam-dialog`, `loam-prompt` and the global strip (chunk `overlays`); the modal's actions and owner line; the palette's setting rows and input prompt; Settings enabled in the rail; menus |
| `manifest` | `ui.settings`, `ui.experiments`, `ui.menus`, `requires_experiment`, `confirm_prompt` and keybinding sequences and `when` in `app-manifest.v2.json`, with their rules and refusals ([12.1](#121-the-manifest)) |
| `sdk` | `SettingsV1` on the handler and surface context (the `settings` grant); `OverlaysV1` gains `popover`, `dialog`, `prompt`; `OverlayKindV1` widens; `NotificationsV1`; `MenuContextV1` |
| `console` | Its schema form moves to `chrome/src/forms/` so the settings section and the prompt share it; the console imports it from there |
| `host` | The server-held shared records of [section 13](#13-the-hosted-lane-d125), when phase 6's step 4 has served `SERVER_COMMANDS` |
| `testing` | `createAppTestKernel` takes `settings` and `experiments` seeds |
| `apps/hello` | One project-level setting, one experiment gating its inspector, one menu entry, one sticky toast and one notification with an action, for E1, E5, E6 and E11 |
| `apps/tally` | One command with `confirm_prompt`, for E8 |

- **Release inventory, repository contract, `loam.yml`:** no new unit, so nothing new to list. `loam.yml`'s Chromium step runs the new files under `web/test/browser/settings/`, `overlays/`, `inbox/` and `keybindings/`.
- **`AGENTS.md`:** unchanged.
- **Changesets:** none; every unit is private.

## 2. What phase 4 does not change

- **The access decision.** No setting, experiment, autonomy mode or persona is an input to `decideAccess`, `checkedCall`, the grants, the auth gate, line 0 or the owner and human checks. Phase 3's E2 sweep gains this phase's records as a twin: [P4-E2](#19-exit-criterion-and-tests).
- **Enforcement of autonomy.** Phase 4 stores, resolves and shows the policy. Phase 5 makes the copilot and the agent interface obey it (D41). Until then D98's sentence on the consent screen stands.
- **Commands that exist.** `appearance-get`, `appearance-set`, `toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list` and `view-state-* { id: 'loam.appearance' }` keep their names, inputs and results; new fields are optional.

## 3. Settings (D116)

### 3.1 A section

An app declares sections in `ui.settings`; the shell declares its own in code ([3.7](#37-the-shells-own-sections)).

```ts
export interface SettingSectionV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in the app. Its full id is `<plugin.id>.<id>`; the shell's are `loam.<id>`. */
	id: string;
	title: string;                    // 1 to 40
	description?: string;             // 1 to 200, plain text
	/** The levels a value may be set at; at least one. */
	levels: Array<'person' | 'workspace' | 'project'>;
	schema: SettingSchemaV1;
	/** Optional: present only while the experiment is on for the person (5.3). */
	requires_experiment?: string;
}

/** A closed subset of JSON Schema, so every key is a form field, a search row and a bounded value. */
export interface SettingSchemaV1 {
	type: 'object';
	properties: Record<string, SettingKeyV1>;   // 1 to 32 keys, each `^[a-z][a-zA-Z0-9]{0,39}$`
	additionalProperties: false;
}

export type SettingKeyV1 = { title: string /* 1 to 60 */; description?: string /* 1 to 200 */; levels?: Array<'person' | 'workspace' | 'project'> } & (
	| { type: 'boolean'; default: boolean }
	| { type: 'string'; enum: string[] /* 1 to 32, each 1 to 60 */; enumTitles?: string[]; default: string }
	| { type: 'string'; maxLength: number /* 1 to 1000 */; pattern?: string; default: string }
	| { type: 'integer' | 'number'; minimum: number; maximum: number; default: number }
	| { type: 'array'; items: { type: 'string'; enum: string[] }; maxItems: number /* 1 to 32 */; uniqueItems: true; default: string[] }
);
```

- **Every key has a default**, inside its own bounds, checked by `app check`. A key's `levels` narrows its section's; absent, it takes the section's.
- **No nesting, no `$ref`, no `oneOf`.** Anything else is refused `MANIFEST_SETTING_SCHEMA` naming the key. A setting that needs more is an app command with its own UI, not a setting.
- **A section's resolved object is at most 16 KiB** as JSON (`SETTING_TOO_LARGE`).
- **Text is plain.** `title`, `description` and `enumTitles` pass phase 1's `textRules`.
- **A mounted manifest declares no section in phase 4** (`MANIFEST_SETTINGS_MOUNTED`): a mounted server has no handler context to read one. Phase 5 decides with `calls`.
- **At most 8 sections per app** (`MANIFEST_SETTINGS_LIMIT`).

### 3.2 Who writes a value

| Level | Who may write | Agent interface | Port | Over MCP (hosted) |
| --- | --- | --- | --- | --- |
| `person` | The person, for themselves | Its person's, but `loam.autonomy` and `loam.keybindings` are `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served |
| `project` | Any member who may enter the project (`decideAccess`), for a key of an app enabled for it; the shell's `loam.autonomy` per [Q1](#q1-who-sets-a-projects-autonomy) | As the person, but `loam.autonomy` is `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served in phase 4 |
| `workspace` | An owner (D96); others `OWNER_REQUIRED` | `HUMAN_REQUIRED`, as every owner case (phase 3's 3.4) | `CALL_NOT_GRANTED` | Not served |

- **An app never writes a setting.** The `settings` grant reads the app's own sections ([3.8](#38-the-settings-grant)). A person changes an app's settings in the settings section, from the palette, or through an agent.
- **A project member, not only its creator,** writes an app's project values, as they write the app's project data. Autonomy is the exception, because it decides what agents may do for every member ([section 4](#4-the-autonomy-section-d118)).
- In `local` mode every actor is an owner and a member, so every row above allows the person.

### 3.3 Resolution

For key `k` of section `s`, for person `p` in scope `{ workspace, project? }`:

1. `p`'s value, if `k` may be set at `person` and `p` set one;
2. else the project's value, if a project is in scope and `k` may be set at `project`;
3. else the workspace's value, if `k` may be set at `workspace`;
4. else the schema's default.

`resolveSetting(section, key, { person, scope }, rows)` is pure and in `late-settings`; it returns `{ value, from: 'person' | 'project' | 'workspace' | 'default' }`. **A person's value beats a shared one**: a key declared at both levels is a shared default each person may change for themselves. A key an app wants to apply to everyone alike declares only shared levels.

A stored value that no longer validates against the section's current schema (an app upgraded its manifest) is skipped as if absent, with a warning on `setting-get`'s result naming the key; it is kept until the next write, so a downgrade restores it.

### 3.4 Storage

- **Person values** are one record per person, `loam.settings`, in the view-state store, added to `scope/personal.ts`'s `PERSONAL` pattern so `provider` mode keys it `loam.settings~<person>`: `{ [sectionFullId]: { [key]: value } }`, only keys the person set. Stage A reads it, in place of `loam.appearance`, for the theme and density and the keybinding overrides ([3.6](#36-appearance-taken-over-d117)); the reads cost first paint nothing new, since `personalRecordId` and the store's `get` are already there.
- **Shared values** are rows of the workspace store's `setting` table, one per section and level: id `<sectionFullId>/workspace` or `<sectionFullId>/project/<projectId>`, `{ section, level, project?, values, updatedAt, updatedBy }`, carrying the record fields phase 2's 4.1 requires. Project rows go with the project: archived with it, and readable again when it is restored.
- **In a hosted `provider` deployment** shared rows and autonomy rows are the server's ([section 13](#13-the-hosted-lane-d125)); person records stay in the browser, as phase 6 keeps personas there.

### 3.5 The settings section

- **Where:** a shell section, `section-open { section: 'settings' }`, at `/<workspace>/~/settings`, and `~/settings/<sectionFullId>` for one section; the rail's Settings entry is enabled (it was `aria-disabled` since phase 0).
- **What it shows:** a tree, the shell's sections first (Appearance, Keybindings, Autonomy, Experiments, Notifications, Limits), then each enabled app's in rail order; a level switcher, **You**, **Workspace** and, with a project active, **Project <name>**, showing only levels the section allows and the person may write (others read-only with the reason); each key as a field of the shared schema form, with "Set here", "From the workspace", "From the project" or "Default" beside it and a **Reset** that runs `setting-reset`.
- **A gated section** (3.1's `requires_experiment`) is absent while its experiment is off for the person.
- **An app's sections render from their schema only.** No app code runs in the settings section, so a view's or a mounted app's section is the same as a native one's, and nothing in it is a boundary to cross.
- **Lazy.** The section is the `settings` chunk; nothing of it is first paint.

### 3.6 Appearance taken over (D117)

- `appearance-get` and `appearance-set` read and write keys `theme` and `density` of `loam.appearance`, a person-level shell section, through `resolveSetting`. Their inputs and results are unchanged.
- `view-state-get` and `view-state-set { id: 'loam.appearance' }` stay registered, as aliases of the same keys, so `SESSION_50`'s committed journal replays unchanged.
- **Migration, once:** stage A reads `loam.settings`; when it holds no `loam.appearance` and the old `loam.appearance` view-state record exists, stage A uses it and stage B's first write moves it, journaled as `setting-set` with `migrated: true`, and removes the old record.
- **A change for `provider` mode:** appearance becomes per person, keyed by `personalRecordId`, where phase 3 kept it the profile's. People sharing a browser profile no longer share a theme; signed out, the `~signed-out` record's appearance applies. Phase 3's 6.2 (persona defaults applied through `appearance-set`'s code) is unchanged.

### 3.7 The shell's own sections

| Section | Levels | Keys |
| --- | --- | --- |
| `loam.appearance` | person | `theme`, `density` (phase 0's values) |
| `loam.rail` | person | `order`: up to 64 instance ids, the person's order inside each band, which `bandFor`'s comparator reads after persona emphasis (R8); an id not enabled is ignored |
| `loam.keybindings` | person | `overrides`: up to 64 `{ command, chord: string \| null }`, `null` unbinding ([8.3](#83-a-persons-overrides)) |
| `loam.autonomy` | person, project, workspace | [Section 4](#4-the-autonomy-section-d118); its own commands, not `setting-set` |
| `loam.experiments` | person | None of its own: it lists experiments ([section 5](#5-experiments-d119)) |
| `loam.notifications` | person | `toastSticky`: `'never' \| 'danger' \| 'always'`, default `'danger'`, when a toast also lands in the inbox; `muted`: up to 64 instance ids whose notifications are kept but not announced |
| `loam.limits` | workspace | [Section 11](#11-limits-710-d124) |
| `loam.documents` | workspace | `trashDays`: 1 to 365, default 30, which replaces `WorkspaceV1.trashDays` as the source (the field stays, written through, for phase 2's reader) |

Phase 3's `PersonaV1.emphasis.sections` widens to `('projects' | 'documents' | 'account' | 'settings' | 'inbox')[]` (amendment A-P3-1).

### 3.8 The `settings` grant

```ts
export interface SettingsV1 {
	/** The resolved value of `key` in one of this app's own sections, for the call's person and effective scope. */
	get<T = unknown>(section: string, key: string): Promise<T>;
	/** Every key of one of this app's sections, resolved. */
	section(section: string): Promise<Record<string, unknown>>;
}
```

- On a handler's context and a surface's, when the manifest grants `settings`. `section` is the app's short id; another app's is refused `SETTING_NOT_OWNED`, as the architecture's catalog says.
- **A view** reads through its broker by the same two calls; **a native app** under D54's contract.
- **An app hears a change** by an event the kernel emits after a `setting-set` or `setting-reset` touching its sections, `settingsChanged: ['<section>']`, which the surface element receives as `settingsChanged(sections)`; it re-reads.
- **Replay:** `get` runs inside a journaled call, so a replay reads the replay's store, which holds the replayed writes.

### 3.9 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `setting-schema-get` | query | `{ section? }` | `{ sections: Array<SettingSectionV1 & { fullId; owner: 'shell' \| string }> }`, those the person may see (gates applied) |
| `setting-list` | query | `{ section?; level? }` | `{ values: Array<{ section; key; value; from; writable: boolean; reason?: string }> }`, resolved for the call's scope |
| `setting-get` | query | `{ section; key }` | `{ value; from }`, plus a warning when a stored value was skipped (3.3) |
| `setting-set` | mutation | `{ section; key; value; level }`, `level` defaulting to the most specific the key allows and the person may write | `{ value; from; previous }`. Undo: `setting-set` with `previous`, or `setting-reset` when there was none |
| `setting-reset` | mutation | `{ section; key; level }` | `{ value; from }`, the newly resolved value. Undo: `setting-set` |

- `section` is the full id. A key not in the schema is `SETTING_NOT_FOUND`; a value outside it `VALIDATION_ERROR` with the key and the bound; a level the key does not allow `SETTING_LEVEL_UNAVAILABLE`; a `project` level with no project in scope `SETTING_PROJECT_REQUIRED`, whose suggestion names `scope-set`.
- `loam.autonomy` is refused here, `SETTING_USE_AUTONOMY`, suggesting `autonomy-set`, so its stricter rules ([section 4](#4-the-autonomy-section-d118)) have one door.
- Each joins `call-scope.test.ts`'s table, through a person, an agent and two surface ports, on twin workspaces.

### 3.10 From the palette

`palette-search` gains rows `kind: 'setting'`, from one `PaletteIndex` over every key the person may see in the active scope: name `<sectionFullId>.<key>`, title the key's title, description `<section title>: <key description>`. Choosing one runs `section-open { section: 'settings', target: '<sectionFullId>.<key>' }`, which opens the section at the key and focuses its field. A key whose levels are only `project` is listed only while a project is active. The index is built in `late-settings` when the palette first opens after stage B and rebuilt on `settingsChanged`, a manifest change or a scope change; it is never first paint. **P4-E1** holds this.

## 4. The autonomy section (D118)

### 4.1 The record

```ts
export type AutonomyModeV1 = 'suggest' | 'ask' | 'act';

export interface AutonomyRowV1 {
	/** `<level>/<project or ->/<instance or *>/<command or *>`. */
	id: string;
	level: 'workspace' | 'project';
	project?: string;              // with `level: 'project'`
	instance?: string;             // an enabled instance, or absent for every app and the shell
	command?: string;              // a registered command of `instance` (or a shell command when `instance` is 'shell')
	mode: AutonomyModeV1;
	/** Workspace level, no instance or command only: the highest mode any row may give. */
	ceiling?: AutonomyModeV1;
	updatedAt: number; updatedBy: string;
}
```

Table `autonomy` in the workspace store. A person's own cap is the person-level key `loam.autonomy.cap`, an `AutonomyModeV1`, default `act`: a person may make the agents acting for them more cautious, never less.

### 4.2 Resolution

`resolveAutonomy({ command, instance, scope, person, mutation }, rows, cap)`, pure, in `late-settings`:

1. Take the first row that exists, most specific first: project and command; project and instance; project; workspace and command; workspace and instance; workspace. **A project's row beats any workspace row**, so a project set to `ask` is inherited by its apps and overridden only by a narrower project row (the exit criterion).
2. None: the default, [Q3](#q3-the-default-autonomy): `act` for a command that is not a mutation, `ask` for a mutation.
3. **Lower it to the ceiling**, the workspace row's `ceiling`, default `act`. Order: `suggest` < `ask` < `act`.
4. **Lower it to the person's cap.**

It returns `{ mode, from: AutonomyRowV1['id'] | 'default', ceiling, cap, chain: Array<{ id; mode }> }`: the chain is every row that applied, in order, so "the resolved action always shown" (D41) has its source.

### 4.3 Who sets it

- **Workspace rows and the ceiling:** owners. **Project rows:** owners and the project's creator, within the ceiling ([Q1](#q1-who-sets-a-projects-autonomy)); others `OWNER_REQUIRED`.
- **Every autonomy write is a human command** (phase 3's 3.4): the agent interface gets `HUMAN_REQUIRED`, ports `CALL_NOT_GRANTED`, MCP does not serve it. An agent never changes what agents may do.
- **A row above the ceiling** is refused `AUTONOMY_ABOVE_CEILING` at write; lowering the ceiling under existing rows keeps them and resolution lowers them (step 3), and the section marks each "capped by the workspace".

### 4.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `autonomy-get` | query | `{ command; instance?; project? }` | `resolveAutonomy`'s result for the call's person; `project` defaults to the scope's |
| `autonomy-list` | query | `{ level?; project? }` | `{ rows: AutonomyRowV1[]; ceiling; cap }`, a project's only to someone who may enter it |
| `autonomy-set` | mutation, human | `{ level; project?; instance?; command?; mode?; ceiling? }`; `mode: null` removes the row | `{ row; previous }`. Undo restores `previous` |

`autonomy-list` is a new name beside the architecture's `autonomy-get` and `autonomy-set`: one reads the resolved mode, the other the rows.

### 4.5 What phase 5 does with it

Phase 5 calls `resolveAutonomy` before every call the copilot or the agent interface makes for a person: `act` runs, `ask` opens a prompt overlay ([6.1](#61-kinds-and-the-policy-table)) showing the resolved command, input and the chain, `suggest` returns the call as a suggestion the person runs. **Phase 4 builds none of that.** It builds the record, the resolution, the commands, the section and one Chromium test that the section shows a command's resolved mode and chain (P4-E4).

## 5. Experiments (D119)

### 5.1 The declaration

```ts
export interface ExperimentV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`; full id `<plugin.id>.<id>`, the shell's `loam.<id>`. */
	id: string;
	title: string;               // 1 to 60
	/** What may change or break, plain text, shown beside the toggle: D12's "what may change". */
	changes: string;             // 1 to 400
	/** ISO date by which it graduates or is removed: D12's "every flag has an end". */
	ends: string;                // `YYYY-MM-DD`
	stage: 'hidden' | 'visible' | 'graduated' | 'removed';
}
```

- In `ui.experiments`, at most 8 per app. The **stage** is the author's, changed by shipping a new manifest. `hidden`: declared, listed to nobody, off. `visible`: listed, off until enabled. `graduated`: on for everyone, its toggle gone, its gates satisfied. `removed`: off for everyone, toggle gone, gates closed, stored enablements ignored.
- **The architecture's fifth state, `enabled`, is not a stage** but an enablement (5.2): a stage says what the author offers, enablement says who took it.
- `ends` in the past while the stage is `hidden` or `visible`: `app check` warns `EXPERIMENT_OVERDUE`, and the experiments section shows "Past its end date". Nothing turns off on a date: the clock is the author's prompt, not a switch, so a replay never depends on today.

### 5.2 Enablement

- **For a person:** `experiment-enable { experiment, audience: 'person' }`, by the person for themselves, a human command. Stored in the person's `loam.settings` record under `loam.experiments`.
- **For the workspace:** `experiment-enable { experiment, audience: 'workspace' }`, an owner command (others `OWNER_REQUIRED`, agents `HUMAN_REQUIRED`). Stored as a row of the workspace store's `experiment-enablement` table.
- **On for a person** when the stage is `graduated`, or the stage is `visible` and either the person enabled it, or the workspace did and the person has not turned it off: `experiment-disable { audience: 'person' }` on a workspace-enabled experiment records the person's opt-out ([Q2](#q2-may-a-person-opt-out-of-a-workspace-enabled-experiment)).
- **Who sees it:** `visible` experiments of apps enabled for the workspace, in the experiments section, each with its title, `changes`, `ends`, who enabled it ("You" or "Your workspace") and the toggle.

### 5.3 Gates

- `requires_experiment: "<fullId>"` may be set on `ui.surfaces.<surface>`, on a settings section, on a `ui.menus` entry and on `app` (the whole app). It names an experiment of the same app or of the shell.
- **A gate decides presence, never permission.** A gated surface is not created; a gated app is listed in `app-list` with `state: 'gated'` and the experiment's title, its rail entry absent and its commands not registered for the page; a gated menu entry or section is absent. **No gate is an input to `decideAccess`, the grants or line 0**, and P4-E2's sweep holds it. The research's warning stands: an experiment is not a permission model.
- **When it changes:** `experiment-enable` and `-disable` emit `experimentsChanged`; the chrome re-renders gated surfaces and menus at once; a gated app is loaded (or unloaded, after `app-close`'s rules) by `app-instance-refresh` for that instance, journaled, inside the same call. After a change of person (phase 3's `session-settle`) gates are re-evaluated with the rest.
- **Replay:** `experimentOn` reads the store and the manifest's stage only, so a replay reproduces every gate.

### 5.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `experiment-list` | query | `{}` | `{ experiments: Array<ExperimentV1 & { fullId; owner; on: boolean; by: 'person' \| 'workspace' \| 'graduated' \| null; overdue: boolean }> }`, `visible` and `graduated` only |
| `experiment-check` | query | `{ experiment }` | `{ on: boolean; by }`; an unknown or `hidden` id answers `on: false`, the same bytes, so a hidden experiment's existence is not learned |
| `experiment-enable` | mutation, human; owner for `workspace` | `{ experiment; audience: 'person' \| 'workspace' }` | `{ on; by }`. Undo: `experiment-disable` with the same audience |
| `experiment-disable` | mutation, human; owner for `workspace` | `{ experiment; audience }` | `{ on; by }`. Undo: `experiment-enable` |

`experiment-check` is in `APP_CALLABLE_SHELL_COMMANDS_V1`, for an app's own experiments only (`EXPERIMENT_NOT_OWNED`).

## 6. The overlay manager (D121)

### 6.1 Kinds and the policy table

The architecture's table, as built. Each row is a column of P4-E7's matrix.

| Kind | Opened by | Lifetime | On app switch | Placement | Limit |
| --- | --- | --- | --- | --- | --- |
| toast | `toast-show` | Timed, 1 to 30 s; `sticky: true` never times out | Dismissed; a sticky one, or one `loam.notifications.toastSticky` selects, is also written to the inbox when it opens | The shell's toast region | 5 on screen; a sixth dismisses the oldest, `reason: 'cap'` |
| popover | `popover-open` | Light dismiss (`popover="auto"`) | Closed, `reason: 'app-switch'` | Anchored to its invoker, top layer | One per invoker; a second replaces the first |
| dialog | `dialog-open` | Until closed | **Parked**, `state: 'parked'`, and restored with its app; with `cancelOnLeave: true`, cancelled | Top layer, non-modal, in the app's region | 3 open or parked per app instance (`OVERLAY_LIMIT`) |
| modal | `modal-open` | Until closed | Cancelled, result to its owner | Top layer, the rest of the shell inert | **One overlay slot, shell-wide**, shared with prompts |
| prompt | `prompt-open`, the palette, `confirm_prompt`, the close prompt | Until answered | Cancelled | As a modal, in the overlay slot | One per root call (one per agent turn from phase 5) |
| global | The kernel's internal `overlay-global-set` only | Until the condition ends | Survives | A strip under the title bar | One per id: `offline`, `signed-out`, `update` |

- **Opening while not active:** an app that is neither the active app nor the active tab's owner may open only a toast or a sticky toast (phase 1's rule); every other kind is `OVERLAY_OWNER_INACTIVE`.
- **The slot.** `modal-open` and `prompt-open` while the slot is held are `OVERLAY_MODAL_BUSY`, as phase 1; `palette-open` too, as today.
- **Global overlays are not a command an app or agent can reach:** `overlay-global-set { id; on: boolean }` is internal, journaled, run by the kernel on `online` and `offline`, on phase 3's sign-out notice, and by phase 6's updater.

### 6.2 The state machine

Every overlay is `open`, `parked` (dialogs only) or `closed`, with a `reason` from `'user' | 'timeout' | 'app-switch' | 'cap' | 'park' | 'restore' | 'person' | 'replaced'` on each move. `'person'` is phase 3's change of person, which closes every overlay; `'replaced'` a popover a second one on the same invoker replaced. `overlay-list` reports `state`; `overlay-dismiss` closes from `open` or `parked`. Each move is one entry in the kernel's overlay store, kept in the journal through the command that caused it, so a replay reproduces every id, state and reason. **P4-E7** checks each transition of each kind.

### 6.3 Placement and the platform

- Toasts: phase 1's region. Popovers: `popover="auto"` with CSS anchor positioning on the invoker the chrome resolves; phase 1's fallback where anchor positioning is absent. Dialogs: `<dialog>` with `show()`. Modals and prompts: `<dialog>` with `showModal()`, which makes the rest inert. **`closedby` and `popover="hint"` are not used** (W38, W39).
- **An anchor** is `{ surface: 'sidebar' | 'main' | 'inspector' | 'panel' | 'header' | 'status'; anchor: string }`, the value of a `data-loam-anchor` attribute inside the owner's surface root; for a view, its frame element itself. Unresolvable is `OVERLAY_ANCHOR_NOT_FOUND`. The kernel stores the anchor as data and the chrome resolves it, so the kernel stays free of the DOM (D68).

### 6.4 Content

| Kind | Content |
| --- | --- |
| toast | Phase 1's `ToastInputV1`, plus `sticky?: boolean` and `link?: ResourceLinkV1` |
| popover | `{ kind: 'info'; title?; body }` (plain text), or `{ kind: 'menu'; items: Array<{ command; label; input? }> /* 1 to 16 */ }`, each item one of the owner's own commands with `expose.palette`, run as the person through the palette interface |
| dialog | `{ title; body?; actions?: Action[]; element?: string; cancelOnLeave? }` |
| modal | Phase 1's `ModalInputV1`, plus `actions?: Action[]` and `element?: string` |
| prompt | `{ title; body?; schema?: JsonSchema; value?: object; confirmLabel?; cancelLabel?; danger?; for?: { command: string } }` |

```ts
/** Up to 3; the first with `default: true` is the Enter action; replaces confirmLabel and cancelLabel when given. */
export interface OverlayActionV1 { id: string /* ^[a-z][a-z0-9-]{0,19}$ */; label: string /* 1 to 40 */; tone?: 'primary' | 'danger' | 'neutral'; default?: boolean }
```

- **A modal or dialog result** is `{ result: 'confirm' | 'cancel' | 'dismissed' | <action id>; value? }`; with `actions`, Escape answers `cancel` only if an action has id `cancel`, otherwise Escape is refused and the dialog stays (so a three-way choice cannot be answered by a stray key).
- **An app's element** (`element`) is a custom element name the app defined in its scoped registry, rendered inside the shell's dialog frame with a surface port created for it (D83) and given `context`; **native apps only**, since a view's element is in its own frame (`OVERLAY_ELEMENT_VIEW`). A view uses text, actions and prompts. This is phase 1's "an app's element in a modal arrives with phase 4".
- **A prompt's `schema`** is a command input schema, rendered by the shared schema form; its result's `value` is validated against it before the overlay closes.

### 6.5 Commands

`toast-show`, `modal-open`, `overlay-dismiss` and `overlay-list` gain the optional fields above. New: `popover-open`, `dialog-open`, `prompt-open`, each a mutation returning `OverlayRefV1`, and resolving through the SDK's `OverlaysV1` when it closes. `popover-open`, `dialog-open` and `prompt-open` join `APP_CALLABLE_SHELL_COMMANDS_V1`. `OverlayKindV1` widens to every kind but `global`, which no app ever sees in `overlay-list`.

### 6.6 Whose overlay it is

Every overlay an app opens shows its owner: a toast and a popover carry the app's title as their first line in `color.text.subtle`, a dialog, modal and prompt in their header, "From Tally". The shell's own carry none. An app's `title` text cannot contain the string "Loam" as a separate word (`MANIFEST_TITLE_RESERVED`), so no app passes for the shell. This closes phase 1's follow-up.

### 6.7 Focus and the toast region

- Focus returns to the invoker on close; modals and prompts trap focus (phase 0's rule, unchanged).
- **The toast region becomes an F6 stop** while it holds a toast, after the status bar, and `Mod+Alt+T` focuses its newest toast; a toast keeps itself while it has focus or the pointer, its timer resumed after. This closes phase 1's follow-up on reaching a toast by keyboard.
- A sticky toast's **Open inbox** action opens the inbox at it.

## 7. Prompts (D122)

### 7.1 The palette's input prompt (#869)

- A command that needs input (`needsInput`) is listed, no longer "(needs input)", and choosing it opens a prompt owned by the shell: the command's title, its input schema as the form, **Run** and **Cancel**. Run validates and calls the command through the palette interface with the value; a failure keeps the prompt open with the error and its suggestion.
- The palette lists an app's commands with `expose.palette` **whatever app is active**, ranked active app first, then the active tab's owner, then others, then persona emphasis (phase 3's 6.2). This removes phase 0's "only while the app is active" filter, which existed because nothing could prompt; a command of an app that is not loaded (gated, failed) is not listed.
- So `checklist-item-add` runs from the palette with the view closed, as the coordinator's amendment of phase 2's D2 left for here.

### 7.2 `confirm_prompt`

- `commands[].confirm_prompt` is allowed in a native or view manifest: plain text, 1 to 200, which the profile stops refusing (`MANIFEST_CONFIRM_UNAVAILABLE` retires). A mounted tool's stays refused: its server declares nothing Loam can trust to ask.
- **When a person calls it** (the palette, the chrome, the console), the kernel opens a prompt with the text before the handler runs; Cancel returns `CONFIRMATION_DECLINED`, journaled, nothing run.
- **When an agent calls it** (the agent interface, and phase 5's copilot), the call waits on the same prompt shown to the person, with the line "Requested by <agent>" and the command's resolved input. Phase 4 has no turn, so the call's own root is the "turn". **Over MCP** no app command is served (D104), so nothing waits there.
- **A port's call** (an app calling its own command) prompts too, owned by the shell, so an app cannot skip its own command's confirmation by calling it from code.
- **Replay** answers the prompt from the journaled `prompt` result, never by showing one.

### 7.3 The close prompt (#881)

Phase 2's dirty-tab close opens a modal with three actions, `save` (default, primary), `discard` (danger) and `cancel`, in place of phase 1's two buttons. `save` runs the editor's `save()` and closes on success, keeping the tab and showing the error on failure; `discard` closes without saving; `cancel` and Escape keep the tab. The text and order are the documents specification's 5.5, amended (A-P2-1).

## 8. Keybindings, version 1 (D123)

### 8.1 What a binding is

```ts
export interface KeybindingV1 {
	/** One chord, or two separated by a space: "Mod+G P". */
	keys: string;
	command: string;
	/** A closed vocabulary, joined by " && ": `editor`, `sidebar`, `main`, `project`, `!project`, `documentType == <type>`. */
	when?: string;
}
```

- The manifest's `keybinding` gains `keys` (one or two chords, the first of which must have `Mod`, so a sequence never starts on a bare letter) and `when`; `chord` stays as a synonym of a one-chord `keys`. A sequence waits 1,500 ms for its second chord; any other key cancels it with nothing run.
- **Precedence:** the person's overrides, then the reserved chords, then the active app's, then (new) the active tab owner's with `when: editor`. An app binding that collides with a reserved chord or an earlier app binding in the same band is refused at load, as phase 1 does.

### 8.2 Matching a key (#877)

A chord's letter matches `event.key`, case folded, when `event.key` is one Latin letter or digit; otherwise (a non-Latin layout) it falls back to `event.code`, as phase 0 does for every chord today. So a layout that moves S moves Mod+S with it, and a Cyrillic layout still reaches Mod+S. Function keys, `F6` among them, match `event.code`. `Mod` is Command on macOS and Control elsewhere, unchanged.

### 8.3 A person's overrides

`loam.keybindings.overrides` rebinds or unbinds any command's binding, the reserved ones included but for `F6`, `Shift+F6` and `Escape`, which stay so the keyboard path through the parts is never lost (`KEYBINDING_RESERVED`). The Keybindings section lists every binding with its source ("Shell", "Tally", "You") and records a new one by pressing it. Overrides are person settings, so they replay.

### 8.4 The reserved chords, version 1

Phase 0's seven, plus:

| Keys | Command | Why |
| --- | --- | --- |
| `Mod+Alt+P` | `section-open { section: 'projects', target: 'switcher' }`, the project switcher (#857) | `Mod+P` is the browser's print in every engine; a page may cancel it in Chromium, but taking print from people is the wrong default. A person who wants `Mod+P` binds it in 8.3 |
| `Mod+,` | `section-open { section: 'settings' }` | The convention in desktop applications |
| `Mod+Alt+T` | Focus the newest toast (6.7) | |
| `Mod+Shift+I` | `section-open { section: 'inbox' }` | |

### 8.5 Commands

`keybinding-list` (query, `{}` to `{ bindings: Array<KeybindingV1 & { source: 'shell' | 'you' | string; active: boolean }> }`) is new; changes go through `setting-set` on `loam.keybindings`. `keybinding` joins the shell's domains.

### 8.6 Chords inside a view

A cross-origin frame's keys never reach the shell, and MCP Apps defines no message to forward them. **Decided: Loam forwards none.** A view that wanted to could only claim a key the shell then honours, which lets untrusted code drive the shell's chords; the person leaves a view with Tab or with the keyboard trap phase 1 gives the frame's edges. Phase 1's follow-up closes as decided.

## 9. Menus (D127)

- `ui.menus`: up to 16 entries `{ context; command; label?; when?; requires_experiment? }`, where `context` is one of `sidebar-item` (the app's own sidebar rows), `editor-tab` (tabs of the app's document types), `document-row` (the documents section's rows of the app's types) and `project-row` (the projects section's rows).
- **Opened by** a context-menu gesture or Shift+F10 on the target, as a shell-owned `menu` popover: the shell's own entries first, then the app's. Choosing one runs the command through the palette interface as the person with input `{ target: ResourceLinkV1 }`; a command whose input has no `target` property is refused at load (`MANIFEST_MENU_INPUT`).
- An app's entries appear only on its own targets and on `project-row`, never on another app's rows.

## 10. The inbox (D120)

### 10.1 The record

```ts
export interface NotificationV1 {
	id: string;                    // `ntf_` and 16 of [a-z0-9], from the kernel's random source
	workspace: string;
	person: string;                // the recipient, the person the pushing call was for
	source: string;                // an instance id, or 'shell'
	title: string;                 // 1 to 120, plain text
	body?: string;                 // 1 to 1000, plain text
	tone: 'info' | 'success' | 'warning' | 'danger';
	link?: ResourceLinkV1;         // opened through the existing open path, access re-checked
	action?: { command: string; label: string; input?: object };
	scope: ScopeV1;                // where it was pushed from
	createdAt: number; readAt?: number; archivedAt?: number;
}
```

- Table `notification`, in the workspace store, listed by `person`. **Read only by its person** and their agents; to anyone else it answers as missing.
- **An action** is one of the source app's own commands with `expose.palette`, validated at push; choosing it runs the command as the person through the palette interface, prompting for missing input (7.1) and for its `confirm_prompt` (7.2). An action never runs on display.
- **Per person, at most 500**; past that the oldest read and archived ones go first, then the oldest read; unread ones are never dropped, and a push past 500 unread is `NOTIFICATION_LIMIT`.

### 10.2 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `notification-push` | mutation | `{ title; body?; tone?; link?; action? }`, for the call's person | `{ notification }` |
| `notification-list` | query | `{ cursor?; unread?: boolean; source?; limit?: 1..100 }` | `{ notifications; cursor; unread: number }`, newest first |
| `notification-read` | mutation | `{ notification } \| { all: true; source? }` | `{ read: number }`. Undo marks them unread |
| `notification-archive` | mutation | `{ notification }` | `{ archived: true }`. Undo restores |

- `notification-push` is in `APP_CALLABLE_SHELL_COMMANDS_V1`; an app pushes only to the person its call is for, never another member. **Pushing to another person needs a server**, which the collaboration service or phase 5's events bring; until then the inbox is what this person's apps and shell told them (the architecture's "push delivery to a disconnected person" is not its job).
- **Rate:** 10 pushes a minute per instance, then `NOTIFICATION_RATE_LIMITED`, retryable, journaled once per window (11).
- **The shell pushes** for a sticky toast (6.1), a failed autosave the person has not seen, and phase 3's notices that today use a toast (a revoked session elsewhere).

### 10.3 The section

`section-open { section: 'inbox' }`, at `~/inbox`; a bell in the title bar with the unread count, announced politely when it rises unless the source is muted. Rows show source, title, time and tone; Enter opens the link; the action is a button. Lazy, the `inbox` chunk; the count is read in stage B, not first paint.

## 11. Limits (#710, D124)

`loam.limits`, a workspace section an owner sets, each key bounded so an owner can tighten and widen within reason:

| Key | Default | Bounds | Where it is enforced | Refusal |
| --- | --- | --- | --- | --- |
| `messageBytes` | 1,048,576 | 65,536 to 8,388,608 | The view broker, before parsing a frame's message | The message dropped and the frame told `VIEW_MESSAGE_TOO_LARGE` |
| `inputBytes` | 262,144 | 16,384 to 1,048,576 | Every app command's input through a port or a broker, as JSON, before the handler (documents' 256 KiB becomes this) | `INPUT_TOO_LARGE` |
| `callsPerSecond` | 50, burst 200 | 5 to 500 | A token bucket per instance in the broker and in `checkedCall` | `CALL_RATE_LIMITED`, retryable, `retryAfterMs`; journaled once per second per instance with a count |
| `storeBytes` | 26,214,400 | 1,048,576 to 268,435,456 | The `store` grant per instance per workspace, counted as JSON length on write, kept in a `store-usage` row | `STORE_QUOTA_EXCEEDED`, suggesting the app's own cleanup |
| `journalEntryBytes` | 1,048,576 | 262,144 to 4,194,304 | The journal sink: a larger entry is kept with its input replaced by `{ truncated: true, bytes, sha256 }` and marked unreplayable | None to the caller; the entry says so |

- A refused call is journaled, so nothing escapes the journal by being large; the journal's own entry is bounded, so one view cannot exhaust the origin's quota through the journal.
- **Native apps** get the same checks in their ports as a contract (D54); a view's broker and a mounted relay are boundaries.
- `storeBytes` counts from the step that adds it; existing data is counted at first write, by one scan of the instance's rows, journaled as `store-usage-settle`.

## 12. The kernel and the SDK

- **Kernel interface version 4**: `shell-info-get` reports `kernelInterface: 4`; the ports gain `settings`, the widened overlays and `notifications`; `APP_CALLABLE_SHELL_COMMANDS_V1` becomes `_V2` with `popover-open`, `dialog-open`, `prompt-open`, `experiment-check`, `notification-push` added.
- **SDK** (a minor): `SettingsV1`, `NotificationsV1 { push(input): Promise<CommandResult<{ notification }>> }`, `OverlaysV1.popover`, `.dialog`, `.prompt`, `LoamSurfaceElementV1.settingsChanged?(sections)`.
- **New shell domains:** `keybinding`. `setting`, `experiment`, `notification`, `autonomy`, `popover`, `dialog`, `prompt` and `overlay` are already listed.
- **Internal commands:** `overlay-global-set`, `store-usage-settle`, exempt from line 0, journaled, never served or callable.

### 12.1 The manifest

All additions are under `ui`, `app` and `commands[]` of version 2 (D76), refused under version 1:

| Key | Rule | Refusals |
| --- | --- | --- |
| `ui.settings` | 3.1 | `MANIFEST_SETTING_SCHEMA`, `MANIFEST_SETTINGS_LIMIT`, `MANIFEST_SETTINGS_MOUNTED`, `MANIFEST_SETTING_DEFAULT` |
| `ui.experiments` | 5.1 | `MANIFEST_EXPERIMENTS_LIMIT`, `MANIFEST_EXPERIMENT_DATE`; `EXPERIMENT_OVERDUE` warns |
| `ui.menus` | Section 9 | `MANIFEST_MENU_CONTEXT`, `MANIFEST_MENU_INPUT`, `MANIFEST_MENUS_LIMIT` |
| `requires_experiment` on `app`, a surface, a section, a menu entry | 5.3 | `MANIFEST_EXPERIMENT_UNKNOWN` |
| `commands[].confirm_prompt` | 7.2 | Mounted: still `MANIFEST_CONFIRM_UNAVAILABLE` |
| `ui.surfaces.keybindings[].keys`, `.when` | 8.1 | `MANIFEST_KEYBINDING_KEYS`, `MANIFEST_KEYBINDING_WHEN` |

The refusal map's `later(…, 4)` entries are removed, the catalog's served-from 4 rows become served, and the profile's conformance cases gain one valid and one refused case per row. **Budget:** `apps` holds the generated validator; the step that adds these measures the row and raises it under D115.

## 13. The hosted lane (D125)

In a hosted `provider` deployment (phase 6's 6.1), **shared values, autonomy rows and workspace enablements are trust records**: they say what everyone sees and what agents may do, so the server holds them, as it holds projects.

- **`SERVER_COMMANDS` gains** `setting-set` and `setting-reset` when `level` is `workspace` or `project`, `autonomy-set`, and `experiment-enable` and `-disable` when `audience` is `workspace`. Routing reads the input, so phase 6's `late-hosted` gains a predicate `serverRouted(command, input)` in place of a name test (amendment A-P6-1). A person-level write stays in the browser.
- **`TrustRecordSnapshotV1` gains** `settings` (the shared rows the person may see), `autonomy` (the rows, the ceiling) and `experiments` (workspace enablements), and `trust-record-settle` replaces those tables in the copy (A-P6-2).
- **The server validates** a shared value against the section's schema read from the instance's packed manifest, which it serves.
- **`HOSTED_MCP_COMMANDS` gains** `setting-schema-get`, `setting-list`, `setting-get`, `autonomy-get`, `autonomy-list` and `experiment-list`, reads only, for the token's person (A-P6-3). A connected agent can learn what it is allowed and how its person's workspace is set; it changes none of it. MCP writes of settings wait for phase 5.
- **Phase 5 enforces on the server too:** the server's kernel holds the autonomy rows, so a connected agent's call is decided against the server's policy, never a browser's copy.
- Until phase 6's step 4 has merged, phase 4's steps build and test in `local` and in phase 3's test-only auth host, where these records stay in the browser; step 10 adds this section.

## 14. Budgets

Estimates, under D115: a step that needs more raises the row in its own pull request and records the figures and the reason here; the independent review flags growth out of proportion. Against first paint of 288,822 bytes and 89,309 gzip (phase 3's step 2):

| Step | First-paint parts | Estimate (bytes, gzip) |
| --- | --- | --- |
| 1 | Stage A reads `loam.settings` in place of `loam.appearance`, with the migration's one branch | 300, 120 |
| 5 | The key matcher's `event.key` path and sequences' first-chord state; overrides read from the record stage A already holds | 600, 250 |
| 3 | The toast region's F6 stop and owner line in phase 1's toast element | 300, 120 |
| **Total** | | **about 1,200, 490** |

| Row | Estimate | Note |
| --- | --- | --- |
| `late` | +4,000 | The overlay store's kinds and state machine, the limits in `checkedCall`, keybindings' resolver |
| `late-settings` (new) | 20,000 | Every command of sections 3, 4, 5 and 10, the resolvers, the palette's setting rows |
| `settings` (new) | 30,000 | The section and the shared schema form |
| `inbox` (new) | 8,000 | |
| `overlays` (new) | 12,000 | Popover, dialog, prompt, the global strip, menus |
| `apps` | Measured by step 2 | The generated validator's new branches |

P4-E12 asserts that an empty shell's first paint requests exactly phase 3's chunks, and that `late-settings` loads in stage B while `settings`, `inbox` and `overlays` load only on use.

## 15. Accessibility

- The settings section is a `tree` of sections and a form; each field's label is its key's title and its description its `aria-describedby`; the level switcher is a tab list; "From the workspace" is text, not color.
- Popovers carry `role="menu"` or `role="dialog"` with a name; menu items are `menuitem`s with arrow keys and type-ahead; dialogs `role="dialog"` with `aria-labelledby`; modals and prompts `aria-modal`.
- The inbox's bell has its unread count in its name; the list is a `feed` with each row an `article`.
- Every new element passes axe WCAG 2.2 AA in light, dark and high contrast, and Specimen captures each in the three themes (P4-E13). **#708's screen-reader pass** covers the new kinds too, recorded as manual, by the owner's operator, not a gate.

## 16. Failure modes and error codes

| Code | When | Retryable | Suggestion |
| --- | --- | --- | --- |
| `SETTING_NOT_FOUND` | Unknown section or key, or a gated one | No | List with `setting-schema-get` |
| `SETTING_LEVEL_UNAVAILABLE` | A level the key does not allow | No | Names the allowed levels |
| `SETTING_PROJECT_REQUIRED` | `project` level with no project in scope | No | Run `scope-set` first |
| `SETTING_TOO_LARGE` | A section's object past 16 KiB | No | |
| `SETTING_NOT_OWNED` | An app reads another's section | No | Read only your own sections |
| `SETTING_USE_AUTONOMY` | `setting-set` on `loam.autonomy` | No | Use `autonomy-set` |
| `AUTONOMY_ABOVE_CEILING` | A row above the workspace ceiling | No | Names the ceiling and who may raise it |
| `EXPERIMENT_NOT_FOUND` | Enable or disable an unknown, hidden or removed id | No | List with `experiment-list` |
| `EXPERIMENT_NOT_OWNED` | `experiment-check` on another app's | No | |
| `OVERLAY_ANCHOR_NOT_FOUND` | A popover's anchor is not in the owner's surface | No | Set `data-loam-anchor` on the invoker |
| `OVERLAY_ELEMENT_VIEW` | `element` from a view app | No | Use text, actions or a prompt |
| `OVERLAY_LIMIT` | A fourth dialog for one instance | No | Close one first |
| `CONFIRMATION_DECLINED` | The person cancelled a `confirm_prompt` | No | |
| `KEYBINDING_RESERVED` | Overriding F6, Shift+F6 or Escape | No | |
| `NOTIFICATION_LIMIT`, `NOTIFICATION_RATE_LIMITED` | 10.1, 10.2 | No, yes | |
| `VIEW_MESSAGE_TOO_LARGE`, `INPUT_TOO_LARGE`, `CALL_RATE_LIMITED`, `STORE_QUOTA_EXCEEDED` | Section 11 | No, no, yes, no | Name the limit and that an owner sets it |

Phase 1 to 3's codes (`OVERLAY_MODAL_BUSY`, `OVERLAY_OWNER_INACTIVE`, `OVERLAY_NOT_OWNER`, `OWNER_REQUIRED`, `HUMAN_REQUIRED`, `CALL_NOT_GRANTED`) keep their meaning. Every new code joins `kernel/src/errors.ts`'s union and carries a suggestion.

## 17. Security

- **No new grant of authority.** Settings, experiments and autonomy rows are never inputs to the access decision (section 2); P4-E2's sweep, type and scan hold it as phase 3's E2 does for personas.
- **Autonomy only goes up by a person.** Every write is a human command; the ceiling is an owner's; a person's cap only lowers; MCP reads it and never writes it.
- **An overlay cannot pass for the shell or another app** (6.6), and the slot keeps one app from stacking over another.
- **An action or a menu entry runs one of the owner's own palette commands as the person,** through the palette interface, under its `confirm_prompt` and the person's access; it never runs on display.
- **A view's limits are a boundary** (section 11); a native app's a contract (D54).
- **A setting is not a secret store.** `app check` warns on a key named like `token`, `password`, `secret` or `key` (`MANIFEST_SETTING_SECRET`), and phase 3's E15 scan widens to settings rows.
- **The hosted lane** holds the shared records (section 13), so a browser's copy grants nothing there.

## 18. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 4 |
| --- | --- | --- |
| Enforcing autonomy; approvals of plans and capabilities; approval-health metrics | Phase 5 (D41) | `resolveAutonomy`, the prompt overlay, `chain` |
| An agent member's own autonomy cap | Phase 5, with delegation | `resolveAutonomy`'s caps as a list |
| Notifications to another person | The collaboration service or phase 5's events | `NotificationV1.person` |
| Settings over MCP that write | Phase 5 | Section 13's reads |
| A/B measurement | Not planned (the architecture) | |
| A mounted app's settings and experiments | Phase 5, with `calls` | `MANIFEST_SETTINGS_MOUNTED` |
| A view's element in a dialog | When MCP Apps defines nested views | `OVERLAY_ELEMENT_VIEW` |
| Native notifications on the desktop | Phase 6's desktop lane | The inbox |

## 19. Exit criterion and tests

The phase exits when every test below passes on `main` in the place its row names, and STATUS.md records the runs. **Every exit test's title starts `P4-E<n>:` or `P4-H<n>:`, but E14's, which are earlier phases' own.** The exit has two parts (D126): the local criterion, E1 to E16, and the hosted criterion, H1 and H2, on phase 6's development profile. Places are phase 3's 18 table's `Units`, `Chromium`, `Budget` and `Hosted`.

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P4-E1 | **An app's setting is searchable from the palette and scoped per project** | Chromium; Units | Hello's project-level `greeting`: in project Atlas, the palette finds "Greeting" and opens the settings section at its field; set to "Hi Atlas" there; in Beacon it reads the default; hello's main, through the `settings` grant, shows each project's value, and re-reads on `settingsChanged`; the key is not listed with no project active. Units: `resolveSetting`'s table over levels and `from` |
| P4-E2 | **Settings, experiments and autonomy grant nothing** | Units | Phase 3's E2 sweep on twin stores differing only in settings, experiment enablement and autonomy rows: every command's `ok` and `error.code` equal, but those reading these records; a type (`AccessInputV2`'s keys unchanged); a scan of `scope/access.ts`, `scope/middleware.ts`, `late/port-callable.ts`, `late/port-refusals.ts` for `setting`, `experiment`, `autonomy` |
| P4-E3 | **Appearance is taken over** | Units; Chromium | Phase 0's appearance tests unchanged and passing; `SESSION_50` replays with zero differences; a profile with only `loam.appearance` boots with its theme and moves it at the first write; `provider` mode keeps two people's themes apart |
| P4-E4 | **An autonomy level set on a project is inherited by its apps and overridden for one command** | Units; Chromium | Workspace `ask`; Atlas set `act`: every hello and tally command in Atlas resolves `act` from Atlas's row; `tally-reset` set `suggest` in Atlas resolves `suggest`; Beacon resolves the workspace's; a ceiling of `ask` lowers Atlas to `ask` and the section marks it; a person's cap lowers it for them alone; the agent interface's `autonomy-set` is `HUMAN_REQUIRED`; a non-owner non-creator's project row `OWNER_REQUIRED`; the section shows each command's resolved mode and chain |
| P4-E5 | **An experiment gates a surface until a person opts in, and a workspace owner can enable it for all** | Chromium; Units | Hello's `inspector-v2` gates its inspector: absent for Bea and Olu; Bea enables it, sees it, Olu does not; an owner enables it for the workspace, Olu sees it; Olu turns it off for themselves (Q2) and it goes; a non-owner's workspace enable `OWNER_REQUIRED`; `graduated` shows it to all with no toggle, `removed` to none; `experiment-check` answers a hidden and an unknown id the same; a gated app is `state: 'gated'` with its commands unregistered, then loads on enable |
| P4-E6 | **The inbox** | Chromium; Units | A sticky toast lands in the inbox and stays after an app switch; hello's notification with an action runs the action as the person through the palette interface, prompting for its input; read, read-all, archive and undo; the bell's count and its announcement; the limit and the rate; another person's notification answers as missing |
| P4-E7 | **Every overlay kind follows the policy table** | Chromium; Units | A matrix over toast, sticky toast, popover, dialog, dialog with `cancelOnLeave`, modal, prompt and global × open while active, open while inactive, app switch away and back, limit, placement (top layer, anchor, region) and focus return: each cell's outcome as 6.1 says, each transition's `reason` as 6.2 says; the owner line on every app overlay; the toast region's F6 stop; a change of person closes every one |
| P4-E8 | **Prompts** | Chromium; Units | `checklist-item-add` from the palette with the view closed (#869); tally's `confirm_prompt` command through the palette, an agent and a port, each prompting, Cancel `CONFIRMATION_DECLINED` with nothing run; a replay answers from the journal; the three-button close prompt on a dirty tab, each action's result (#881) |
| P4-E9 | **Keybindings** | Chromium; Units | `Mod+Alt+P` opens the project switcher (#857); a German and a Cyrillic layout (by `event.key` and `event.code` pairs) reach Mod+S and Mod+K (#877); a two-key sequence and its timeout; `when: editor`; a person's override rebinds the palette and unbinding F6 is refused; the rail's personal order (R8) persists and replays |
| P4-E10 | **Limits** (#710) | Chromium; Units | A view's 2 MiB message dropped with `VIEW_MESSAGE_TOO_LARGE`; a 300 KiB input `INPUT_TOO_LARGE`; 300 calls in a second rate-limited, journaled once a second; a store past its quota refused; a 2 MiB journal entry kept truncated and marked unreplayable; an owner widens `inputBytes` and the same call passes |
| P4-E11 | **Menus** | Chromium; Units | Hello's `sidebar-item` entry by right click and Shift+F10, run with its target as the person; absent on another app's rows; gated with its experiment |
| P4-E12 | **Budgets** | Budget; Chromium | Every row of 14 under its ceiling as last raised; an empty shell's first paint requests exactly phase 3's chunks; `late-settings` in stage B; `settings`, `inbox`, `overlays` only on use |
| P4-E13 | **Accessibility and captures** | Chromium | Section 15's elements under axe and Specimen in three themes; the keyboard path through the settings section, a prompt, a menu, a dialog parked and restored, and the inbox |
| P4-E14 | **What exited stays exited** | Earlier phases' places and minimums | Phases 0 to 3's exit tests pass, amended only as listed in the step that amends them (phase 1's "(needs input)" palette test, phase 2's two-button close test) |
| P4-E15 | **Every new command replays** | Units | A seeded session over every command of sections 3 to 11 replays with zero differences; each joins `call-scope.test.ts` |
| P4-E16 | **No job was skipped** | The exit step | `node scripts/loam-exit-check.mjs --phase 4`, for the local part; again with the hosted job for the hosted part |
| P4-H1 | **Shared records are the server's** | Hosted | A non-owner's workspace `setting-set`, `autonomy-set` and workspace `experiment-enable` over the transport are `OWNER_REQUIRED` and the server's store unchanged; an owner's succeed and reach a second browser's copy within one refresh; a person-level `setting-set` never reaches the server |
| P4-H2 | **A connected agent reads its autonomy and writes none** | Hosted | Over MCP, `autonomy-get` answers the token's person's resolved mode and chain; `autonomy-set` and `setting-set` are `COMMAND_NOT_FOUND`; `tools/list` equal across tokens |

## 20. Implementation plan

Each step is one pull request, merged on green. It updates this status block and STATUS.md before it merges. **Steps 6 and 9 each get a review focused on the trust boundary they change.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 1 | Settings core | 3.1 to 3.4, 3.6, 3.8, 3.9: `ui.settings` in the manifest with its rules, the `setting` table and `loam.settings`, `resolveSetting`, the five commands in `late-settings`, the `settings` grant and SDK, appearance taken over, `loam.documents.trashDays`; kernel interface 4; the architecture's amendments; E2's units, E3, E15 so far | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | The settings section and the palette | 3.5, 3.7, 3.10: the schema form moved to `chrome/src/forms/`, `loam-settings-section`, Settings enabled in the rail, the palette's setting rows, `loam.rail` in `bandFor`, hello's setting; E1; `apps` measured | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 3 | The overlay manager | Section 6: kinds, state machine, placement, content, actions, an app's element, owner line, F6 stop, `overlay-global-set`; E7 | `pnpm check`, `loam.yml`, `budget` |
| 4 | Prompts | Section 7: the palette's input prompt and its new listing, `confirm_prompt`, the close prompt; tally's command; E8; phase 1 and 2's amended tests | `pnpm check`, `loam.yml` |
| 5 | Keybindings and menus | Sections 8 and 9: `KeybindingV1`, matching, sequences, `when`, overrides, the reserved chords, `keybinding-list`, `ui.menus`; E9, E11 | `pnpm check`, `loam.yml`, `budget` |
| 6 | Autonomy | Section 4: the table, `resolveAutonomy`, the three commands, the section; E4. **Trust review: who may raise a mode, the ceiling, human-only writes** | `pnpm check`, `loam.yml` |
| 7 | Experiments | Section 5: `ui.experiments`, `requires_experiment`, enablement, gates, the four commands, the section; hello's experiment; E5, E2's twin | `pnpm check`, `loam.yml` |
| 8 | The inbox | Section 10: the table, the four commands, sticky toasts, the bell and section; E6 | `pnpm check`, `loam.yml`, `budget` |
| 9 | Limits | Section 11 across the broker, the ports, the store and the journal; E10. **Trust review: the broker's and the journal's bounds** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 10 | The hosted lane | Section 13 and amendments A-P6-1 to A-P6-3. **Waits for phase 6's step 4** | `pnpm check`, `pnpm verify`, `pnpm test:hosted:local` |
| 11 | Local exit | `loam-exit-check.p4.minimums.json`; every `P4-E` row; STATUS.md records "local criterion met" | The check exits 0 |
| 12 | Hosted exit | H1, H2 on the development profile; STATUS.md records the exit; follow-ups filed | The check exits 0 for both parts |

**Order:** 1 first. 2, 3 and 9 need 1 and run in parallel. 4 needs 3. 5 needs 2 and 3. 6 and 7 need 2. 8 needs 3. 10 needs 6, 7 and phase 6's step 4. 11 after 1 to 9. 12 after 10 and 11. An exit test named in several steps closes in the last.

**Beside phase 3.** Phase 4 touches files phase 3's remaining steps touch (`late/index.ts`, `types.ts`, the chrome's shell, the rail): each phase 4 step rebases on `main` before review, and **no phase 4 step changes a phase 3 trust rule**; where it widens one of phase 3's lists (`APP_CALLABLE_SHELL_COMMANDS`, `HUMAN_COMMANDS`, `OWNER_COMMANDS`), it adds names only, each listed in its pull request.

## Questions for the owner

**Asked 2026-11-13.** Each is a change to who may do what. The specification is written to each recommendation; an answer that differs amends the named section before its step starts.

### Q1. Who sets a project's autonomy?

Autonomy decides whether agents act on their own, ask first, or only suggest, for everyone in a project. A workspace owner always sets the workspace's level and a ceiling no project can exceed.

- **Owners and the project's creator, within the workspace's ceiling (recommended).** This matches who changes a project's members (D110): the creator runs their project without waiting on an owner, and can never go past what the owners allowed.
- **Owners only.** The strictest option. Every project's change waits for an owner.
- **Any member of the project, within the ceiling.** The most self-service option. The tradeoff: one member can let agents act unprompted for everyone in the project.

### Q2. May a person opt out of a workspace-enabled experiment?

When an owner turns an experiment on for the workspace, can someone turn it off for themselves?

- **Yes (recommended).** Nobody is held in an experiment they don't want, which keeps D12's "nothing experimental reaches anyone who did not ask" as close as an owner's switch allows.
- **No.** Everyone sees the same thing. The tradeoff: a person stuck with a broken experiment waits for an owner.

### Q3. The default autonomy

What should agents do in a workspace where nobody has set autonomy? Today, until phase 5 enforces it, a connected agent can make any change its person can, unprompted, and the consent screen says so (D98).

- **Act on reads, ask before changes (recommended).** Agents look things up freely and ask the person before changing anything. Owners can loosen it.
- **Ask for everything.** The most cautious option. The tradeoff: an agent asks before every lookup, which people learn to click through, the approval decay D41 measures.
- **Act on everything.** Today's behavior. The tradeoff: agents change things unprompted unless an owner tightens it.

## Proposed amendments to other phases

Applied with the step named, when the coordinator approves this specification:

- **A-P2-1 (step 4):** the documents specification's 5.5, "Three buttons wait for phase 4", becomes 7.3's three actions.
- **A-P3-1 (step 2):** phase 3's 6.1, `emphasis.sections` widened (3.7); its 3.4 trust table's human commands gain `autonomy-set`, `experiment-enable`, `experiment-disable`, and `setting-set` on `loam.keybindings`; its owner cases gain workspace-level `setting-set`, `setting-reset`, workspace `experiment-*` and workspace `autonomy-set`.
- **A-P6-1 to A-P6-3 (step 10):** section 13's routing predicate, snapshot fields and MCP reads.

## Amendments to the architecture and the decision log

Proposed; applied when the coordinator approves this specification, in step 1:

- **Architecture section 4, Settings:** "user, workspace and project scope" reads "person, workspace and project level", with 3.3's precedence.
- **Architecture section 5, shell commands:** adds `autonomy-list`, `setting-reset`, `notification-archive`, `keybinding-list`; `keybinding` among the domains.
- **Architecture section 5, Settings and experiments records:** an experiment's `state` is the author's stage plus enablement (5.1).
- **Architecture glossary:** Level, Ceiling, Stage, Enablement, Gate, Inbox.
- **Decision log:** D116 to D127, marked proposed, decided with the coordinator's approval but for the parts the owner's Q1 to Q3 decide.

| ID | Proposed decision |
| --- | --- |
| D116 | Settings: sections with a closed schema subset and a default per key, at `person`, `workspace` and `project` levels; resolution person, project, workspace, default; person values in the person's `loam.settings` record, shared values in the `setting` table; workspace values an owner's, project values any member's who may enter it; the `settings` grant reads the app's own resolved values, and no app writes one |
| D117 | Appearance, keybindings and the rail order (R8) are person-level shell settings. `appearance-*` and `view-state-* { id: 'loam.appearance' }` keep working; the old record moves once. In `provider` mode appearance becomes per person |
| D118 | Autonomy rows at workspace or project level, optionally narrowed to an instance and a command; the most specific row wins, a project's over any workspace's; lowered to the workspace's ceiling and the person's cap; default per Q3; every write a human command, workspace rows an owner's, project rows per Q1; phase 4 stores, resolves and shows; phase 5 enforces |
| D119 | Experiments: an author's stage (`hidden`, `visible`, `graduated`, `removed`) with `changes` and `ends`; enablement per person and, by an owner, per workspace, with a person's opt-out per Q2; `requires_experiment` gates presence, never permission; dates prompt the author and switch nothing |
| D120 | The inbox: notifications per person in the workspace store, pushed only for the call's person, with a link and at most one action that runs the source's own palette command as the person; sticky toasts land there; 500 per person and 10 pushes a minute per instance |
| D121 | The overlay manager complete: popover, dialog (parked and restored), prompt (in the modal's slot), global (internal only), sticky toasts; up to three actions on a modal or dialog; an app's element in a dialog or modal, native apps only; every app overlay names its owner; the toast region an F6 stop |
| D122 | Prompts: the palette prompts for a command's input and lists every app's palette commands; `confirm_prompt` is allowed for native and view apps and prompts the person on every path, an agent's and a port's included; the close prompt has three actions |
| D123 | Keybindings version 1: layout-aware matching by `event.key` with `event.code` as the fallback; two-chord sequences starting with `Mod`; a closed `when` vocabulary; person overrides but for F6, Shift+F6 and Escape; `Mod+Alt+P` for the project switcher; no key forwarding from views |
| D124 | Limits on a view's message size, an app command's input, an instance's call rate and store, and a journal entry's size, as owner-set workspace settings within fixed bounds |
| D125 | In a hosted `provider` deployment, shared settings, autonomy rows and workspace enablements are trust records the server holds, routed by input; their reads are served over MCP; nothing writes them over MCP in phase 4 |
| D126 | Phase 4's exit has a local criterion and a hosted criterion on phase 6's development profile; the local run unblocks nothing on its own, as D84 for phase 3 |
| D127 | Menus: `ui.menus` entries on four contexts, rendered as the shell's menu popover, each running the app's own command with `{ target }` as the person |

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Phase 4 specification | Revisit `<dialog closedby>` and `popover="hint"` when Safari ships them (W38, W39) | Open; trajectory watch |
| 2026-11-13 | Phase 4 specification | Notifications to another person, with the collaboration service or phase 5's events | Open; seam `NotificationV1.person` |
| 2026-11-13 | Phase 4 specification | An agent member's own autonomy cap, with phase 5's delegation | Open; phase 5 |
| 2026-11-13 | Phase 4 specification | #708's screen-reader pass over the new overlay kinds and the settings section | Open; with #708 |
