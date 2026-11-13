# Phase 4 specification: settings, experiments, notifications, overlays

| Field | Value |
| --- | --- |
| Phase | 4, settings, experiments, notifications, overlays ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 4 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [jobs](#jobs-and-scenarios) and their [scenarios](scenarios/), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.4, 4.1, 7.3 and 2.4), the [documents specification](../2-documents/spec.md) (its 5.5), the [identity specification](../3-identity/spec.md) (its 3.3, 3.4, 4.5, 6 and 7), the [hosts specification](../6-hosts/spec.md) (its 6 and 7), the [phase 1 specification](../1-app-contract/spec.md) (its 4 and 8), the [architecture](../../architecture.md), the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-13 by the design sub-agent against `main` at `f7ecbd43`, and **revised the same day after two independent reviews** of `445b2bd7` (one on trust and security, one general). Each review found it "approvable once fixed". The revision also applies the coordinator's rulings R1 to R6. Every finding and its answer is in [Review 2026-11-13](#review-2026-11-13). The branch was brought up to `main` at `724a3e54` by a merge. **Not approved.** The coordinator approves it under the owner's standing grant after a re-check. The [questions for the owner](#questions-for-the-owner) are the owner's to answer, and the text is written to each recommendation. D116 to D127 are proposed here and in the [decision log](../../decisions.md), marked proposed.
- **Last verified:** 2026-11-13 against `main` at `f7ecbd43`, and the revision against `724a3e54`, which changed no file this specification cites. Evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `overlays.ts:20` (`TOAST_CAP = 5`), `:28-49` (`OverlayStore`: `open` takes `'toast' | 'modal'` only; `closeForSwitch` dismisses toasts and cancels a modal); `overlay-owner.ts` (`SHELL_OWNER` is "the owner of an overlay a person or an agent opened");
    - `late/overlay-commands.ts` (`toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list`):
      - `modal-open` refuses `OVERLAY_OWNER_INACTIVE` for an app that is neither active nor the active tab's owner (`:118-127`), and `OVERLAY_MODAL_BUSY` while a modal is open (`:128-135`);
      - **`overlay-dismiss` checks the owner only when a `caller` is set (`:167-178`), so the agent interface, which has none, may answer any overlay today**;
    - `late/editor-commands.ts:185-192` (`editor-close` on a dirty tab answers `EDITOR_TAB_DIRTY`, and the chrome opens the close modal);
    - `appearance.ts:29` (`APPEARANCE_VIEW_STATE_ID = 'loam.appearance'`), registered as a view-state handler in `shell-state.ts:208`, written by `view-state-set` in `SESSION_50` (`session.ts:227-228`);
    - `scope/personal.ts:18-21` (`PERSONAL`: `loam.scope`, `loam.apps`, `loam.editor`, `loam.layout` are per person in `provider` mode; `loam.appearance` stays the profile's);
    - `keybindings.ts:25-33` (the seven reserved chords), `:60-78` (`createKeybindings`: the reserved chords, then the active app's band);
    - `palette-index.ts` (`PaletteItem.kind`); `types.ts:296-306` (`APP_CALLABLE_SHELL_COMMANDS_V1`);
    - `late/session-settle.ts:69-74` (the membership re-read before an owner's command; "step 4 adds the rest of `OWNER_COMMANDS`");
    - **`HUMAN_REQUIRED` and `HUMAN_COMMANDS` are not in `endpoints/loam/packages` yet.** Phase 3's steps 3 to 7 bring them ([1.2](#12-dependencies-on-phase-3s-steps));
    - `scope/records.ts:18` (`WorkspaceV1.trashDays`).
  - **Manifest:**
    - `schemas/app-manifest.v2.json`: `$defs.ui` has no `settings`, `experiments`, `menus` or `account`; `$defs.command` and `$defs.mountTool` set `confirm_prompt: false` (`:255`, `:316`); `$defs.keybinding.chord` takes one chord;
    - `src/refusal-map.ts:109-116`; `src/catalogs.ts:108-111` and `:163`.
  - **SDK:** `sdk/src/index.ts:324-328` (`OverlaysV1`), `:392-422` (`OverlayKindV1`).
  - **Chrome:** `rail/bands.ts:19` (`bandFor`); `elements/palette.ts:54` ("(needs input)").
  - **AFD:**
    - `spec/command-metadata.md:29,44-46,100-104`: `confirmPrompt` is a frontend's declaration. AFD enforces it on MCP surfaces by elicitation, answering `CONFIRMATION_DECLINED` or `CONFIRMATION_REQUIRED`.
    - `packages/core/src/errors.ts:114-115` (`RATE_LIMITED`, `QUOTA_EXCEEDED`).
  - **Issues read:** #857, #869, #877, #881, #710, and the open `loam:` issues. Those five name phase 4, and #708 touches its overlays.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-13.
- **Done:** this specification, its jobs and scenarios, and its revision after two reviews.
- **Not done:**
  - its approval;
  - the owner's answers to Q1 to Q5;
  - the walk of the jobs by fresh readers;
  - every step of the [plan](#20-implementation-plan).
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 5, scope is shell-level; 6, overlays have owners; 8, agents are first-class users; 13, deterministic core; 15, AFD first.
- **Decisions it depends on:**
  - D1: settings, experiments and notifications are shell sections. D3: they are commands.
  - D6: the overlay policy. D11: persona is a lens, never a grant. D12: experiments.
  - D41: autonomy. **Settings in phase 4, enforcement in phase 5.**
  - D51: phase 4's settings take over appearance's storage. D54: native apps are trusted code. D67: phase 4 completes the overlay manager.
  - D71 to D73 and D83: scope, the order of a call, the ports. D75 and R8: a personal rail order.
  - D85 to D87 and D96: modes, owners, owner commands. D89: persona. D98: connected agents. D110: who changes a project's members.
  - D103 and D104: trust records and MCP on the hosted lane. D115: size limits do not gate the epic.
- **Decisions this specification proposes:** D116 to D127 ([Amendments](#amendments-to-the-architecture-and-the-decision-log)).

### Carried from earlier phases, answered here

| Item | Answer |
| --- | --- |
| D51: settings take over appearance's storage | [3.6](#36-appearance-taken-over-d117) |
| R8 and D75: a personal rail order | [3.7](#37-the-shells-own-sections): `loam.rail.order` |
| Phase 1's 8: popover, dialog, prompt, global, sticky toasts; an app's element in a modal | [Section 6](#6-the-overlay-manager-d121) |
| Phase 1's `confirm_prompt` refused until phase 4 | [7.2](#72-confirm_prompt-and-confirmations) |
| Phase 1's follow-ups: overlays do not name their app; the toast region has no F6 stop; a view swallows the shell's chords | [6.6](#66-whose-overlay-it-is), [6.7](#67-focus-and-the-toast-region), [8.6](#86-chords-inside-a-view) |
| [#869](https://github.com/lushly-dev/afd/issues/869): a palette that prompts for a command's input | [7.1](#71-the-palettes-input-prompt-869) |
| [#881](https://github.com/lushly-dev/afd/issues/881): a three-button close prompt | [7.3](#73-the-close-prompt-881) |
| [#857](https://github.com/lushly-dev/afd/issues/857): a chord for the project switcher | [8.4](#84-the-reserved-chords-version-1) |
| [#877](https://github.com/lushly-dev/afd/issues/877): layout-aware chords | [8.2](#82-matching-a-key-877) |
| [#710](https://github.com/lushly-dev/afd/issues/710): limits on a view's message size, call rate and storage | **In part:** [section 11](#11-limits-710-in-part-d124). Deferred by name: the journal's total budget, the origin's budget, and what happens on `QuotaExceededError` ([Follow-ups](#follow-ups)). #710 stays open, re-scoped to them |
| Phase 1's `ui.menus` served from phase 4 | [Section 9](#9-menus-d127) |
| Phase 3's 6.1: `emphasis.sections` | Gains `settings` and `inbox` (A-P3-1) |

### Beyond the architecture's phase 4 row, and why

The row names settings at three scopes, the autonomy section, experiments, the inbox and the complete overlay manager. This specification also carries:

| Addition | Why it is here |
| --- | --- |
| Limits (#710, in part) | Phase 1 filed it to be settled before untrusted apps widen. The broker and the store are already in this phase's overlays and settings code |
| Menus | Phase 1's catalog serves `ui.menus` from phase 4, and a menu is a popover, which this phase builds |
| Prompts, `confirm_prompt`, the close prompt | Phases 1 and 2 deferred each one to "phase 4's prompts" (#869, #881) |
| Keybindings version 1 | Phase 1 deferred sequences and `when` to phase 4. #857 and #877 name this phase, and overrides are the keybindings section that the row's "settings" implies |
| Notification actions | The architecture's surface catalog lists an `action` on an inbox item, and R3 needs the inbox to hold confirmations |
| `MANIFEST_TITLE_RESERVED` | 6.6's owner line means nothing if an app's title can read as the shell's |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-13 (sources S98 to S100 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 4 |
| --- | --- | --- | --- |
| R3, W4 | Overlays on the top layer with `inert` and anchor positioning; anchor positioning in Safari 26 | Unchanged: anchor positioning in Chrome 125, Firefox 147 and Safari 26 [S19] | Popovers and menus use `popover="auto"` and anchor positioning, with phase 1's fallback ([6.3](#63-placement-and-the-platform)) |
| New W38 | Not watched | `<dialog closedby>` in Chrome and Edge 134 and Firefox 141. Safari has not shipped it (WebKit bug 284592); it is in Interop 2026 [S98] | **Not used.** A modal closes by Escape or its buttons, and a non-modal dialog never light-dismisses |
| New W39 | Not watched | `popover="hint"`: a first version in Chrome 133; caniuse's data lists a corrected version in Firefox 153 and Chrome 151. Safari has not shipped it; it is in Interop 2026. Interest invokers are shipping in Chromium [S99] | **Not used.** The rail's shared tooltip stays, and menus and info popovers are `auto` |
| R8 | A personal, reorderable rail | Unchanged | A person setting ([3.7](#37-the-shells-own-sections)) |
| R10 | Experiments with audiences | Not re-checked externally. The research's practice [S34] stands, including "not a permission model" | [Section 5](#5-experiments-d119) |
| R15, W26 | Autonomy policy in settings; OWASP's agentic Top 10 with ASI09 | Published 2025-12-09. Summaries describe ASI09, human-agent trust exploitation, as polished explanations leading people to approve harmful actions, with forced confirmation as a first defense [S100] | Only a person raises autonomy ([section 4](#4-the-autonomy-section-d118)). The shell draws a header on every confirmation an agent or app raises ([7.2](#72-confirm_prompt-and-confirmations)) |
| W11 | MCP Events, SEP-3415 | Not re-checked | Nothing projects the inbox over MCP in phase 4 |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and the terms of phases 2 and 3. This specification adds:

| Term | Meaning |
| --- | --- |
| Section | A settings section: an id, a title, a schema and the levels it may be set at ([3.1](#31-a-section)) |
| Key | One property of a section's schema, with a default |
| Level | Where a value is set: `person`, `workspace` or `project`. The architecture's "user scope" is `person` |
| Shared value | A value set at `workspace` or `project` level, which every member reads |
| Resolved value | What a key reads for one person in one scope ([3.3](#33-resolution)) |
| Autonomy mode | `suggest`, `ask` or `act` (D41) |
| Ceiling | A limit on autonomy modes: the workspace's own, and each workspace row narrowed to an app or a command ([4.2](#42-resolution)) |
| Stage | An experiment's lifecycle stage, set by its author ([5.1](#51-the-declaration)) |
| Enablement | Whether an experiment is on, for one person or for the workspace ([5.2](#52-enablement)) |
| Gate | `requires_experiment`: the gated app, surface or entry is present only while the experiment is on for the person |
| Inbox | The shell's notifications section ([section 10](#10-the-inbox-d120)) |
| Overlay slot | The one place a modal or a prompt occupies, shell-wide ([6.1](#61-kinds-and-the-policy-table)) |
| Human gesture | A call through `kernel.call` with a human actor and no `caller`: the person at the palette or the chrome. It is the only answer that confirms ([6.5](#65-commands-and-who-may-answer)) |
| Pending confirmation | A confirmation an agent or a background app raised, waiting in the inbox ([7.2](#72-confirm_prompt-and-confirmations)) |

## Jobs and scenarios

The jobs are written first, as the `afd` skill's `jobs-first.md` asks, one file per job in [`scenarios/`](scenarios/). Until the commands exist they are checked, not run; each becomes a test beside its code in the step that builds it. **P4-E16 starts from "every scenario passes".** Every step runs as `actor: { kind: 'test' }`, so for a job about who is refused (an agent, a non-owner), the refusal is written in a comment and shown by the exit test named there.

| Job | When … I want … so that … | File | Tags |
| --- | --- | --- | --- |
| Scope a setting per project | When a project needs an app to behave differently, I want to set that app's setting for the project alone, so that the other projects keep theirs | [`setting-per-project.scenario.yaml`](scenarios/setting-per-project.scenario.yaml) | `slice` |
| Find a setting from the palette | When I know what I want to change but not where it lives, I want to find it from the palette, so that I never browse the settings tree | [`setting-from-palette.scenario.yaml`](scenarios/setting-from-palette.scenario.yaml) | `slice` |
| Read my autonomy, and not raise it | When an agent acts for me, it wants to know whether it may act, ask or only suggest, and it must not be able to raise that itself, so that only people decide what agents do | [`agent-reads-autonomy.scenario.yaml`](scenarios/agent-reads-autonomy.scenario.yaml) | `slice` |
| Narrow autonomy for one command | When one command in a project is risky, I want agents to ask before it while the rest of the project acts, so that I'm interrupted only where it matters | [`autonomy-per-command.scenario.yaml`](scenarios/autonomy-per-command.scenario.yaml) | |
| Try an experiment | When an app offers something new, I want to turn it on for myself and see what may change and when it ends, so that I opt in knowingly | [`opt-into-experiment.scenario.yaml`](scenarios/opt-into-experiment.scenario.yaml) | `slice` |
| Run a command that needs input from the palette | When a command needs input, I want the palette to ask me for it, so that I can run any command without opening its app | [`palette-prompts-for-input.scenario.yaml`](scenarios/palette-prompts-for-input.scenario.yaml) | `slice` |
| Decline a confirmation | When an agent or an app asks to run something I didn't intend, I want to decline it, have nothing run, and not be asked again at once, so that I can't be worn down into agreeing | [`decline-confirmation.scenario.yaml`](scenarios/decline-confirmation.scenario.yaml) | `slice` |
| Act from the inbox | When an app tells me something I need to act on, I want the notice to wait in my inbox with the action, so that I act when I'm ready | [`inbox-action.scenario.yaml`](scenarios/inbox-action.scenario.yaml) | |
| Be stopped by a limit, with the way forward | When an app sends more than it should, I want it refused with what the limit is and who can change it, so that one app can't exhaust the shell | [`limit-refuses-call.scenario.yaml`](scenarios/limit-refuses-call.scenario.yaml) | |
| Close an unsaved tab | When I close a tab with unsaved work, I want to save, discard or keep editing, so that I never lose work by one keystroke | [`close-unsaved-tab.scenario.yaml`](scenarios/close-unsaved-tab.scenario.yaml) | |

**What writing them changed:**

- `setting-set` and `setting-reset` take a required `level`, because the per-project job could not say which level an omitted one meant.
- `autonomy-set` gained `level: 'person'`, because no command wrote a person's cap.
- `autonomy-get` answers an unknown project as `PROJECT_NOT_FOUND`, because the agent's job reads a project by id.
- `experiment-list` reports `changes` and `ends`, because the opt-in job needs them shown before the toggle.
- `notification-act` was added, because the inbox and decline jobs had no command to run an action, or answer a confirmation, as the person.
- The palette's input prompt is the command `palette-run`, because a job cannot press a chrome control.
- The close prompt stays the chrome's answer to phase 2's `EDITOR_TAB_DIRTY`, so its job shows the command half.

**What no scenario can show,** so the exit tests show it instead:

- an agent refused and a person allowed in one file, because the actor is fixed;
- the clock moving: a pending confirmation's timeout and the decline window;
- an error's `details`, such as a limit's figures;
- inputs too large to write by hand.

**Checks:** Run on 2026-11-13 at this revision.
  - `afd scenario validate` passed all 10 files.
  - The dry-run check and coverage report found no errors. 10 jobs, 49 steps; 17 of the 22 drafted commands and 7 of the 22 drafted error codes are used.
  - The calls not drafted here are existing commands: `palette-search`, `section-open`, `editor-close`, `editor-get` and tally's `tally-get` and `tally-add`. `hello-greet` and `tally-reset` are the new commands that 1's table gives hello and tally.
  - **Drafted commands no job uses, and why they stay:**
    - `setting-schema-get`, `setting-list` and `keybinding-list` are what the settings section renders from, and E1 and E9 use them.
    - `setting-reset` is `setting-set`'s undo.
    - `autonomy-list` is the autonomy section's read (E4).
    - `notification-read` and `-archive` keep the inbox (E6).
    - `popover-open`, `dialog-open` and `prompt-open` are the overlay kinds the architecture's row requires (E7).
  - **Refusals no job shows** are each in an exit test's row.

**Not yet done:** fresh readers have not walked the paths. The re-check is asked to walk them ([Review](#review-2026-11-13)), and **Q5 asks the owner to cut and rank the jobs**.

## 1. Units and repository placement

No new package. Every change is in the units of phases 0 to 3.

| Package | Change |
| --- | --- |
| `kernel` | `late-settings`, a chunk of its own loaded inside `loadLate` beside `late-identity`, holding: the `setting-*`, `autonomy-*`, `experiment-*` and `notification-*` commands, `palette-run` and `keybinding-list`; `resolveSetting`, `resolveAutonomy`, `experimentOn` and `settingWriteRule`. In `late`: the overlay store's new kinds, its state machine and the answer rule. Also the `setting`, `autonomy`, `experiment-enablement` and `notification` tables; the person's settings record `loam.settings`; keybindings version 1; the limits; kernel interface version 4 |
| `chrome` | `loam-settings-section` and its schema form (chunk `settings`); `loam-inbox` (chunk `inbox`); `loam-popover`, `loam-dialog`, `loam-prompt` and the global strip (chunk `overlays`); the modal's actions, header and owner line; the palette's setting rows, app titles and input prompt; Settings enabled in the rail; menus |
| `manifest` | `ui.settings`, `ui.experiments`, `ui.menus`, `requires_experiment`, `confirm_prompt`, keybinding sequences and `when` ([12.1](#121-the-manifest)) |
| `sdk` | `SettingsV1`, `NotificationsV1`, the widened `OverlaysV1` and `OverlayKindV1`, `settingsChanged` |
| `console` | Its schema form moves to `chrome/src/forms/`, so the settings section and the prompt share it |
| `testing` | `createAppTestKernel` takes `settings` and `experiments` seeds |
| `apps/hello` | One project-level setting, one experiment gating its inspector, one menu entry, one sticky toast, one notification with an action (`hello-greet`) |
| `apps/tally` | `tally-reset` with a `confirm_prompt` |

- **Release inventory, repository contract and `AGENTS.md`:** unchanged, since there is no new unit.
- **`loam.yml`:** the Chromium step runs the new files under `web/test/browser/settings/`, `overlays/`, `inbox/` and `keybindings/`.
- **Scenarios:** they move beside the kernel (`kernel/scenarios/`) as each step builds its commands, and run in `kernel/src/scenarios.test.ts`.
- **Changesets:** none, since every unit is private. **`@lushly-dev/loam-host` is not touched** (R1).

### 1.2 Dependencies on phase 3's steps

Phase 4 runs beside phase 3's steps 3 to 10 and changes none of its trust rules. Where it needs one of them, it waits.

| Phase 4 needs | From phase 3 | Phase 4 steps that wait |
| --- | --- | --- |
| `HUMAN_REQUIRED` and the frozen `HUMAN_COMMANDS` list in `late-identity`. Phase 4 adds names to the list and never creates it | The first of steps 3 to 7 that lands them (its 3.4) | 1 (the human and owner cases of `setting-*`), 4 (the answer rule), 6, 8, 9 |
| The rest of `OWNER_COMMANDS`, and the membership re-read for them | Step 4 | 1, 8, 9 |
| Two signed-in people in Chromium, one of them an owner (`authHost`, sign-in) | Steps 3 and 4 | The Chromium parts of E4, E5, and E6's "another person" case. The units run earlier on the Mock |
| The `signed-out` notice the global overlay shows, and the revoked-session notice | Step 3 | 4 (the `signed-out` global); 5 (the shell's push for it) |
| Persona emphasis in the palette's ranking | Step 5 | 6's ranking. Until then the palette ranks by app only |
| `--phase` in `scripts/loam-exit-check.mjs` | Step 9 | 11 |
| Phase 3's local exit tests passing, for P4-E14 | Step 9 | 11 |

Nothing in phase 4 waits on phase 6 (R1).

## 2. What phase 4 does not change

- **The access decision.** No setting, experiment, autonomy mode or persona is an input to `decideAccess`, `checkedCall`, the grants, the auth gate, line 0, or the owner and human checks. P4-E2 holds this.
- **Enforcement of autonomy.** Phase 4 stores, resolves and shows the policy, and phase 5 enforces it (D41). Until then, D98's sentence on the consent screen stands.
- **Commands that exist.** These keep their names, inputs and results, and their new fields are optional: `appearance-get`, `appearance-set`, `toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list`, `editor-close`, and `view-state-* { id: 'loam.appearance' }`. `overlay-dismiss` narrows who may answer `confirm` ([6.5](#65-commands-and-who-may-answer)). That is a fix, not a new shape.
- **The hosted lane.** No phase 4 code runs on `@lushly-dev/loam-host` (R1, [section 13](#13-hosted-provider-deployments-d125)).

## 3. Settings (D116)

### 3.1 A section

An app declares sections in `ui.settings`, and the shell declares its own in code ([3.7](#37-the-shells-own-sections)).

```ts
export interface SettingSectionV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in the app. Its full id is `<plugin.id>.<id>`; the shell's are `loam.<id>`. */
	id: string;
	title: string;                    // 1 to 40
	description?: string;             // 1 to 200, plain text
	/** The levels a value may be set at; at least one. */
	levels: Array<'person' | 'workspace' | 'project'>;
	schema: SettingSchemaV1;
	requires_experiment?: string;     // 5.3
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
	| { type: 'string'; maxLength: number /* 1 to 1000 */; default: string }
	| { type: 'integer' | 'number'; minimum: number; maximum: number; default: number }
	| { type: 'array'; items: { type: 'string'; enum: string[] }; maxItems: number /* 1 to 32 */; uniqueItems: true; default: string[] }
);
```

- **Every key has a default** inside its own bounds (`MANIFEST_SETTING_DEFAULT`). A key's own `levels` narrows its section's.
- **No `pattern`, nesting, `$ref` or `oneOf`** (`MANIFEST_SETTING_SCHEMA`). A free string is bounded by length only, so no regular expression an app supplies ever runs in the shell. A setting that needs more is an app command with its own UI.
- **A section's resolved object is at most 16 KiB** as JSON (`SETTING_TOO_LARGE`).
- **Text is plain** and passes phase 1's `textRules`. A key named like `token`, `password`, `secret` or `apiKey` warns `MANIFEST_SETTING_SECRET`, because settings are not a secret store.
- **A mounted manifest declares no section in phase 4** (`MANIFEST_SETTINGS_MOUNTED`). Phase 5 decides this together with `calls`.
- **At most 8 sections per app** (`MANIFEST_SETTINGS_LIMIT`).

### 3.2 Who writes a value

`settingWriteRule(section, key, level)` is one pure function in `late-settings`. The handler, the owner check, the human check and the membership re-read all call it. It returns `'person' | 'member' | 'owner'`, plus whether the key is human-only. **`level` is required on every write**, so no rule ever has to guess it.

| Level | Rule | Person | Agent interface | Port | MCP |
| --- | --- | --- | --- | --- | --- |
| `person` | `person` | Themselves | For its person. But `loam.autonomy`, `loam.keybindings`, `loam.notifications.muted` and `loam.experiments` are human: `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served |
| `project` | `member` | Any member who may enter the project (`decideAccess`), for a key of an app enabled for it | **`HUMAN_REQUIRED`** ([Q4](#q4-may-a-persons-agent-write-project-level-settings)) | `CALL_NOT_GRANTED` | Not served |
| `workspace` | `owner` | An owner (D96); anyone else gets `OWNER_REQUIRED` | `HUMAN_REQUIRED`, as for every owner case | `CALL_NOT_GRANTED` | Not served |

- **How this fits phase 3's frozen lists.** `HUMAN_COMMANDS` and `OWNER_COMMANDS` stay lists of names.
  - `autonomy-set`, `experiment-enable`, `experiment-disable` and `notification-act` join `HUMAN_COMMANDS` whole.
  - `setting-set` and `setting-reset` are on neither list. Their handler refuses based on `settingWriteRule`, just as phase 3's 3.4 refuses an agent's `project-update` with `access` in the handler.
  - The membership re-read (phase 3's 7.6, `session-settle.ts:69-74`) gains a predicate, `needsMembershipRead(command, input)`. It is true for `setting-*` with `level: 'workspace'`, for `autonomy-set` with `level` `workspace` or `project`, and for `experiment-*` with `audience: 'workspace'`. So a demoted owner is refused at once (A-P3-1).
- **An app never writes a setting.** The `settings` grant reads only the app's own sections ([3.8](#38-the-settings-grant)).
- In `local` mode every actor is an owner and a member, but the agent interface's `HUMAN_REQUIRED` still applies.

### 3.3 Resolution

For key `k` of section `s`, for person `p` in scope `{ workspace, project? }`, the value is the first of these that applies:

1. `p`'s own value, if `k` may be set at `person` and `p` has set one;
2. the project's value, if a project is in scope and `k` may be set at `project`;
3. the workspace's value, if `k` may be set at `workspace`;
4. the schema's default.

`resolveSetting` is pure and returns `{ value, from: 'person' | 'project' | 'workspace' | 'default' }`. A key declared at both a person level and a shared level is a shared default that each person may change for themselves. A key that must apply to everyone alike declares only shared levels. A stored value that no longer validates is skipped, as if absent, with a warning that names the key. It is kept until the next write.

### 3.4 Storage

- **Person values** are one record per person, `loam.settings`, in the view-state store's backing table. In `provider` mode it is keyed through `personalRecordId`. Its shape is `{ [sectionFullId]: { [key]: value } }`.
  - **`loam.settings` is not a view-state id.** It is never registered as a view-state handler. `view-state-get`, `-set` and `-list` on it are refused with `VIEW_STATE_NOT_FOUND`, and `view-state-list` leaves it out.
  - Only `setting-*`, `autonomy-set { level: 'person' }`, `experiment-*` and the `appearance` alias (3.6) reach it. E3 holds this.
- **Shared values** are rows of the workspace store's `setting` table.
  - Each row's id is `<sectionFullId>/workspace` or `<sectionFullId>/project/<projectId>`, and its shape is `{ section, level, project?, values, updatedAt, updatedBy }`, with the record fields of phase 2's 4.1.
  - Project rows are archived and restored together with their project.
- **Hosted `provider` deployments:** shared writes are refused there ([section 13](#13-hosted-provider-deployments-d125)).

### 3.5 The settings section

- **Where:** a shell section, opened by `section-open { section: 'settings' }`, at `/<workspace>/~/settings` and `~/settings/<sectionFullId>`. The rail's Settings entry is enabled.
- **What it shows:**
  - A tree: the shell's sections first (Appearance, Keybindings, Autonomy, Experiments, Notifications, Limits, Documents), then each enabled app's, in rail order.
  - A level switcher: **You**, **Workspace** and, while a project is active, **Project <name>**. It offers only the levels a section allows. Where the person may not write a level, it shows read-only, with the reason.
  - Each key as a field of the shared schema form, marked "Set here", "From the workspace", "From the project" or "Default", with **Reset** (`setting-reset`).
- **A gated section** is absent while its experiment is off for the person.
- **No app code runs in the settings section.** An app's sections are rendered from their schema alone.
- **Lazy:** it is the `settings` chunk.

### 3.6 Appearance taken over (D117)

- `appearance-get` and `appearance-set` read and write the keys `theme` and `density` of `loam.appearance`, a person-level shell section. Their inputs and results are unchanged.
- `view-state-get` and `view-state-set { id: 'loam.appearance' }` stay, as aliases of **those two keys only**, so `SESSION_50` replays unchanged.
- **The profile's last appearance (R4).** The profile keeps a record, `loam.appearance.last`. It is not per person and holds only `theme` and `density`. It is written whenever the signed-in person's appearance is applied.
  - **Stage A and the signed-out page paint with it,** so there is no flash and no default theme after sign-out.
  - Once the probe answers with a person, that person's own value applies.
  - The record decides nothing.
- **Migration happens once, and never while signed out.** It applies when the signed-in person's `loam.settings` has no `loam.appearance` and the old view-state record exists. Stage B's first write then:
  - moves the value, journaled as `setting-set` with `migrated: true`;
  - removes the old record;
  - seeds `loam.appearance.last`.
- **A change for `provider` mode (A-P3-2):** appearance becomes per person, where phase 3 kept it per profile.

### 3.7 The shell's own sections

| Section | Levels | Keys |
| --- | --- | --- |
| `loam.appearance` | person | `theme`, `density` |
| `loam.rail` | person | `order`: up to 64 instance ids, the person's order within each band. `bandFor`'s comparator reads it after persona emphasis (R8) |
| `loam.keybindings` | person, human | `overrides`: up to 64 `{ command, keys: string \| null }` ([8.3](#83-a-persons-overrides)) |
| `loam.autonomy` | person, project, workspace | [Section 4](#4-the-autonomy-section-d118). Written only by `autonomy-set` |
| `loam.experiments` | person, human | Enablements and opt-outs. Written only by `experiment-*` |
| `loam.notifications` | person | `toastSticky`: `'never' \| 'danger' \| 'always'`, default `'danger'`. `muted` (human): up to 64 instance ids. `shell` and `agent:*` cannot be muted (`SETTING_MUTE_SHELL`) |
| `loam.limits` | workspace | [Section 11](#11-limits-710-in-part-d124) |
| `loam.documents` | workspace | `trashDays`: 1 to 365, default 30. From step 1 it is the source of `WorkspaceV1.trashDays`, which is written through (A-P2-2) |

### 3.8 The `settings` grant

```ts
export interface SettingsV1 {
	/** The resolved value of `key` in one of this app's own sections, for the call's person and effective scope. */
	get<T = unknown>(section: string, key: string): Promise<T>;
	section(section: string): Promise<Record<string, unknown>>;
}
```

- With the `settings` grant, `setting-get` and `setting-list` become callable through the app's port, **for its own sections only**. Another app's section is refused with `SETTING_NOT_OWNED`.
- `SettingsV1` wraps those two commands for a native app. **A view** calls them itself, through its broker's `tools/call`.
- **Changes:** after a write touching an app's sections, the kernel emits `settingsChanged: ['<section>']`, and the app re-reads:
  - a native surface receives `settingsChanged(sections)`;
  - a view receives `ui/notifications/host-context-changed` with `{ "dev.loam/settingsChanged": ["<section>"] }`.

### 3.9 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `setting-schema-get` | query | `{ section? }` | `{ sections: Array<SettingSectionV1 & { fullId; owner }> }`, the sections the person may see, gates applied |
| `setting-list` | query | `{ section?; level? }` | `{ values: Array<{ section; key; value; from; writable; reason? }> }` |
| `setting-get` | query | `{ section; key }` | `{ value; from }` |
| `setting-set` | mutation | `{ section; key; value; level }`, **`level` required** | `{ value; from; previous }`. Undo: `setting-set` with `previous`, or `setting-reset` when there was none |
| `setting-reset` | mutation | `{ section; key; level }`, `level` required | `{ value; from }`. Undo: `setting-set` |

`loam.autonomy` and `loam.experiments` are refused here (`SETTING_USE_AUTONOMY`), and the error points to their own commands. Each command joins `call-scope.test.ts`'s table.

### 3.10 From the palette

`palette-search` gains rows of `kind: 'setting'`:

- **name:** `<sectionFullId>.<key>`;
- **title:** the key's title;
- **description:** `<section title>: <key description>`;
- the owning app's title.

Choosing a row runs `section-open { section: 'settings', target: '<sectionFullId>.<key>' }`. A key that may be set only at project level is listed only while a project is active. The index is built in `late-settings` when the palette first opens after stage B, and rebuilt on `settingsChanged`, a manifest change or a scope change. It is never part of first paint.

## 4. The autonomy section (D118)

### 4.1 The record

```ts
export type AutonomyModeV1 = 'suggest' | 'ask' | 'act';

export interface AutonomyRowV1 {
	/** `<level>/<project or ->/<instance or *>/<command or *>`. */
	id: string;
	level: 'workspace' | 'project';
	project?: string;              // with `level: 'project'`
	/** An enabled instance, or 'shell'; required when `command` is set. */
	instance?: string;
	command?: string;
	mode: AutonomyModeV1;
	/** The workspace row with no instance or command only. */
	ceiling?: AutonomyModeV1;
	updatedAt: number; updatedBy: string;
}
```

The rows are the table `autonomy` in the workspace store. **A person's own cap** is the person-level key `loam.autonomy.cap`, an `AutonomyModeV1`, default `act`. Only `autonomy-set { level: 'person', cap }` writes it.

### 4.2 Resolution

`resolveAutonomy` is pure and lives in `late-settings`:

1. **Project rows,** when a project is in scope: the first of project and command, project and instance, project.
2. **Workspace rows:** the first of workspace and command, workspace and instance, workspace.
3. **The mode:** the project row's when there is one, else the workspace row's, else the default ([Q3](#q3-the-default-autonomy)):
   - `act` for a command that is not a mutation;
   - `ask` for a mutation;
   - **`ask` for every mounted tool**, because a mounted tool's `mutation` comes from an untrusted server's annotations.
4. **Ceilings (R2).** Lower the mode to each of these that applies:
   - the workspace's `ceiling`;
   - **when a project row decided the mode, the workspace row for this instance and the one for this command.**

   So an owner's workspace row `tally-reset: suggest` binds every project. A project's own row can lower within it but never raise above it.
5. **The person's cap:** lower the mode to it.

The result is `{ mode, from, ceilings, cap, chain: Array<{ id; mode; as: 'mode' | 'ceiling' | 'cap' }> }`. **Only rows of projects the caller may enter appear in it** (I2).

### 4.3 Who sets it

- **Workspace rows and the ceiling:** owners.
- **Project rows:** owners and the project's creator ([Q1](#q1-who-sets-a-projects-autonomy-within-the-owners-ceilings)), within the ceilings. For a project that a team instance lists, owners only (D87, D110). Anyone else gets `OWNER_REQUIRED`.
- **The person's cap:** the person.
- **Every autonomy write is a human command.** The agent interface gets `HUMAN_REQUIRED`, ports get `CALL_NOT_GRANTED`, and MCP does not serve it.
- **A row above a ceiling that binds it** is refused with `AUTONOMY_ABOVE_CEILING`. Lowering a ceiling keeps the rows under it, which resolution then lowers.

### 4.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `autonomy-get` | query | `{ command; instance?; project? }` | `resolveAutonomy`'s result for the caller's person. **A project the caller may not enter, or that does not exist, gives `PROJECT_NOT_FOUND`, byte-identical to phase 2's** |
| `autonomy-list` | query | `{ level?; project? }` | `{ rows; ceiling; cap }`, only rows of projects the caller may enter. An unknown or restricted project gives `PROJECT_NOT_FOUND` |
| `autonomy-set` | mutation, human | `{ level: 'workspace' \| 'project'; project?; instance?; command?; mode?: AutonomyModeV1 \| null; ceiling? } \| { level: 'person'; cap: AutonomyModeV1 }` | `{ row?; cap?; previous }`. Undo restores `previous` |

### 4.5 What phase 5 does with it

Phase 5 calls `resolveAutonomy` before every call the copilot or the agent interface makes for a person:

- `act` runs the call;
- `ask` raises a confirmation ([7.2](#72-confirm_prompt-and-confirmations)) showing the command, its input and the chain;
- `suggest` returns the call as a suggestion.

Phase 4 builds none of that.

## 5. Experiments (D119)

### 5.1 The declaration

```ts
export interface ExperimentV1 {
	id: string;                  // `^[a-z0-9][a-z0-9-]{0,39}$`; full id `<plugin.id>.<id>`, the shell's `loam.<id>`
	title: string;               // 1 to 60
	changes: string;             // 1 to 400, plain text: D12's "what may change"
	ends: string;                // `YYYY-MM-DD`: D12's "every flag has an end"
	stage: 'hidden' | 'visible' | 'graduated' | 'removed';
}
```

- Experiments are declared in `ui.experiments`, at most 8 per app. The **stage** is the author's:
  - **`hidden`:** listed to nobody, and off. The one exception is a `local` deployment's `experiment-list { hidden: true }`, which lists it so an author can turn it on to test it.
  - **`visible`:** listed, and off until enabled.
  - **`graduated`:** on for everyone, with no toggle.
  - **`removed`:** off for everyone, with no toggle. The next `experiment-enable` or `experiment-disable` sweep **deletes its stored enablements**, so re-shipping the same id revives nothing.
- **The architecture's fifth state, `enabled`, is an enablement, not a stage.**
- If `ends` is in the past while an experiment is `hidden` or `visible`, `app check` warns with `EXPERIMENT_OVERDUE`. Nothing turns off on a date.

### 5.2 Enablement

- **For a person:** `experiment-enable { experiment, audience: 'person' }`, a human command. It is stored in the person's `loam.settings` record.
- **For the workspace:** `audience: 'workspace'`, an owner command. It is a row of the workspace store's `experiment-enablement` table.
- **Each enablement stores the SHA-256 of `changes`** as it was shown (I6). If a new manifest ships a different `changes`, every enablement with the old digest counts as off until it is re-enabled.
- **An experiment is on for a person** when any of these holds:
  - its stage is `graduated`;
  - its stage is `visible` and the person enabled it with the current digest;
  - its stage is `visible`, the workspace enabled it with the current digest, and the person has not turned it off ([Q2](#q2-may-a-person-opt-out-of-a-workspace-enabled-experiment)).

### 5.3 Gates

- `requires_experiment: "<fullId>"` may be set on `ui.surfaces.<surface>`, on a settings section, on a `ui.menus` entry, or on `app`. It names an experiment of the same app or of the shell.
- **A gate decides presence, never permission.** It is not an input to `decideAccess`, the grants or line 0.
  - A gated surface is not created.
  - A gated app is listed with `state: 'gated'`, its rail entry is absent, and its commands are not registered.
  - A gated menu entry or section is absent.
- **When enablement changes,** `experiment-enable` and `-disable` emit `experimentsChanged`. The chrome re-renders, and `app-instance-refresh` loads or unloads a gated app in the same call.
- **Replay:** `experimentOn` reads only the store and the manifest.

### 5.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `experiment-list` | query | `{ hidden?: true }` (`local` only) | `{ experiments: Array<{ fullId; owner; title; changes; ends; stage; on; by; changed; overdue }> }` |
| `experiment-check` | query | `{ experiment }` | `{ on; by }`. An unknown or `hidden` id answers `on: false, by: null`, the same bytes for both |
| `experiment-enable` | mutation, human; owner for `workspace` | `{ experiment; audience: 'person' \| 'workspace' }` | `{ on; by }`. Undo: `experiment-disable` |
| `experiment-disable` | mutation, human; owner for `workspace` | `{ experiment; audience }` | `{ on; by }`. Undo: `experiment-enable` |

`experiment-check` is callable through a port, for the app's own experiments only (`EXPERIMENT_NOT_OWNED`).

## 6. The overlay manager (D121)

### 6.1 Kinds and the policy table

| Kind | Opened by | Lifetime | On app switch | Placement | Limit |
| --- | --- | --- | --- | --- | --- |
| toast | `toast-show` | Timed, 1 to 30 s; `sticky: true` never times out | Dismissed. A sticky one, or one that `loam.notifications.toastSticky` selects, is also written to the inbox when it opens | The shell's toast region | 5 on screen; a sixth dismisses the oldest, with `reason: 'cap'` |
| popover | `popover-open` | Light dismiss (`popover="auto"`) | Closed | Anchored to its invoker, in the top layer | One per invoker; a second replaces the first |
| dialog | `dialog-open` | Until closed | **Parked**, and restored with its app; with `cancelOnLeave: true`, cancelled | Top layer, non-modal | 3 open or parked per instance (`OVERLAY_LIMIT`) |
| modal | `modal-open` | Until closed | Cancelled, with the result reported to its owner | Top layer, with the rest of the shell inert | **One overlay slot, shell-wide**, shared with prompts |
| prompt | `prompt-open`, `palette-run`, a person's or the active app's confirmation, the close prompt | Until answered | Cancelled | As a modal, in the slot | One at a time (the slot) |
| global | The kernel's internal `overlay-global-set` only | Until its condition ends | Survives | **Top layer**, a strip under the title bar | One per id: `offline`, `signed-out`, `update` |

- **Opening while not active.** An app that is neither active nor the active tab's owner may open only a toast. Any other kind gives `OVERLAY_OWNER_INACTIVE`. Its confirmations wait in the inbox instead ([7.2](#72-confirm_prompt-and-confirmations)).
- **The slot.** While the slot is held, `modal-open`, `prompt-open` and `palette-open` give `OVERLAY_MODAL_BUSY`, which is retryable, and nothing runs.
- **Global overlays:** only the kernel opens them. `overlay-global-set` is internal and journaled, and it is never served or callable.

### 6.2 The state machine

Every overlay is `open`, `parked` (dialogs only) or `closed`. Each move carries a `reason`, one of `'user' | 'timeout' | 'app-switch' | 'cap' | 'park' | 'restore' | 'person' | 'replaced' | 'inbox'`. `'person'` is phase 3's change of person, which closes every overlay. `'inbox'` is a confirmation moved to the inbox. A replay reproduces every id, state and reason.

### 6.3 Placement and the platform

- **By kind:**
  - Toasts use phase 1's region.
  - Popovers use `popover="auto"` with CSS anchor positioning.
  - Dialogs use `<dialog>` with `show()`.
  - Modals and prompts use `showModal()`.
- **Not used:** `closedby` and `popover="hint"` (W38, W39).
- **An anchor** is `{ surface; anchor }`. `anchor` is the value of a `data-loam-anchor` attribute inside the owner's surface root. For a view, the anchor is the frame itself. An anchor that cannot be resolved gives `OVERLAY_ANCHOR_NOT_FOUND`. The kernel stores the anchor as data, and the chrome resolves it (D68).

### 6.4 Content

| Kind | Content |
| --- | --- |
| toast | Phase 1's `ToastInputV1`, plus `sticky?` and `link?: ResourceLinkV1` |
| popover | `{ kind: 'info'; title?; body }`, or `{ kind: 'menu'; items: Array<{ command; label; input? }> /* 1 to 16 */ }` |
| dialog | `{ title; body?; actions?: OverlayActionV1[]; element?; cancelOnLeave? }` |
| modal | Phase 1's `ModalInputV1`, plus `actions?` and `element?` |
| prompt | `{ title; body?; schema?; value?; confirmLabel?; cancelLabel?; danger? }`. **The input has no `for`:** only the kernel sets `for: { command, caller }`, on the prompts it raises itself |

```ts
/** Up to 3; the first with `default: true` is the Enter action. */
export interface OverlayActionV1 { id: string /* ^[a-z][a-z0-9-]{0,19}$ */; label: string /* 1 to 40 */; tone?: 'primary' | 'danger' | 'neutral'; default?: boolean }
```

- **Menu items** must be the owner's own commands with `expose.palette`, and **never a `HUMAN_COMMANDS` or `OWNER_COMMANDS` entry** (`OVERLAY_ITEM_RESERVED`). This is checked when the menu opens and again when the item runs.
- **A result** is `{ result: 'confirm' | 'cancel' | 'dismissed' | <action id>; value? }`. When `actions` are given, Escape answers `cancel` only if one of the actions has the id `cancel`.
- **An app's element** is rendered with a surface port (D83), for **native apps only** (`OVERLAY_ELEMENT_VIEW`).

### 6.5 Commands, and who may answer

- `toast-show`, `modal-open`, `overlay-dismiss` and `overlay-list` gain the optional fields above.
- New commands: `popover-open`, `dialog-open` and `prompt-open`. Each is a mutation that returns an `OverlayRefV1`, and each is callable through a port.

**Who may answer (B1).** These rules govern `overlay-dismiss` with a result other than `cancel` or `dismissed`:

| Overlay | Accepted from |
| --- | --- |
| **The shell's** (`SHELL_OWNER`: the palette's prompt, a confirmation, the close prompt) | **A human gesture only** |
| **An app's own** | A human gesture, or its owning app |
| **An agent's** (`agent:<id>`) | A human gesture only |

Any other caller may only cancel or dismiss. A confirm or an action from any other caller gives `HUMAN_REQUIRED`, and nothing runs. This closes today's gap at `late/overlay-commands.ts:167-178`.

### 6.6 Whose overlay it is

- **App overlays** show their owner, for example "From Tally".
- **Agent overlays (B2):**
  - An overlay that the agent interface opens is owned by `agent:<id>`, never by `SHELL_OWNER`.
  - The shell draws "Requested by <agent label> for <person>" in its header.
  - `SHELL_OWNER` now means the shell's own code alone, and `overlay-owner.ts`'s comment is corrected.
- **The shell's own overlays** carry no owner line.
- **An app's `title`** may not contain "Loam" as a word (`MANIFEST_TITLE_RESERVED`).

### 6.7 Focus and the toast region

- Focus returns to the invoker, and modals and prompts trap focus.
- **The toast region is an F6 stop** while it holds a toast. A toast keeps itself while it has focus or the pointer.
- A sticky toast's **Open inbox** action opens the inbox at it.

## 7. Prompts (D122)

### 7.1 The palette's input prompt (#869)

- A command that needs input is listed, no longer marked "(needs input)".
  - Choosing it runs `palette-run { command }`, which opens a shell-owned prompt and returns `{ prompt: OverlayRefV1 }`.
  - The prompt shows the command's title and app, with its input schema as the form.
  - **Run** is a human gesture. It sends `palette-run { command, input }`, which validates the input and calls the command through the palette interface. On a failure the prompt stays open, showing the error and its suggestion.
  - `palette-run` with `input` runs only from a human gesture. Any other caller gets `HUMAN_REQUIRED`.
- **What the palette lists:** the `expose.palette` commands of **every app that is enabled for the active scope** and loaded.
  - It ranks them by the active app first, then the active tab's owner, then the rest, then persona emphasis.
  - **Every app row shows the app's title.**
  - This removes phase 0's "only while the app is active" filter (A-P0-1, A-P1-1).

### 7.2 `confirm_prompt` and confirmations

**How this relates to AFD.** AFD's `confirmPrompt` is a declaration for a frontend. AFD enforces it only on its MCP surfaces, by elicitation, answering `CONFIRMATION_DECLINED` or `CONFIRMATION_REQUIRED`. In-process registries never enforce it. Loam's kernel is the frontend, so the kernel enforces it in process, with AFD's two codes and their meanings. AFD's approval middleware is a separate thing: phase 4 declares no `approval`.

- `commands[].confirm_prompt` is allowed in a native or view manifest: plain text, 1 to 200 characters. A mounted tool's stays refused.
- **Where a confirmation waits depends on who asked (R3):**

| Caller | Where it waits | Header the shell draws |
| --- | --- | --- |
| A person (the palette, the chrome, the console) | A prompt in the slot. If the slot is busy: `OVERLAY_MODAL_BUSY`, retryable, nothing run | The command's title and app |
| The active app's port, or the active tab owner's | The same | "Tally asks to run Reset count" |
| **An agent, a background app or an inactive app** | **A pending confirmation in the inbox** (10.1). It is announced, and never shown as a modal | "Requested by <agent> for <person>", or "Tally asks to run …" |

- **What the confirmation shows:** the app's `confirm_prompt` text sits beneath the shell's header, set apart from it, together with the resolved input.
- **Answering.** Only a human gesture confirms. Anything else declines it: Cancel, the caller's own cancellation, a change of person, or the timeout.
- **Timeout.** A pending confirmation **times out after 10 minutes** on the kernel's clock. The call then answers `CONFIRMATION_REQUIRED`, which is retryable.
- **Pending limit.** Each caller may have at most 5 pending confirmations. A sixth gives `RATE_LIMITED`.
- **A decline** answers `CONFIRMATION_DECLINED`, journaled, and nothing runs. **For the next 60 seconds,** the same command from the same caller is refused with `CONFIRMATION_DECLINED` without the person being asked again. This applies only to non-human callers; a person's own calls are never held back.
- **Over MCP,** no app command is served (D104), so no confirmation ever waits there.
- **In a replay,** each confirmation is answered from its journaled answer.

### 7.3 The close prompt (#881)

On phase 2's `EDITOR_TAB_DIRTY`, the chrome opens a shell-owned modal with three actions:

- **`save`** (the default, primary): runs the editor's `save()` and closes the tab. If the save fails, the tab stays open and the error is shown.
- **`discard`** (danger): closes the tab without saving.
- **`cancel`, or Escape:** keeps the tab open.

Only a human gesture answers `save` or `discard` (6.5). Phase 2's own `editor-close { discard: true }`, which saves first, is unchanged. This amends the documents specification's 5.5 (A-P2-1).

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

- **`keys`** is one chord or two. In a sequence, the first chord must include `Mod`, and **it must not be a reserved chord**. A sequence waits 1,500 ms for its second chord.
- **`chord`** stays as a synonym.
- **Precedence:** the person's overrides, then the reserved chords, then the active app's bindings, then the active tab owner's bindings with `when: editor`.

### 8.2 Matching a key (#877)

A chord's letter matches `event.key`, case-folded, when the key is a single Latin letter or digit. Otherwise it falls back to `event.code`. Function keys match `event.code`.

### 8.3 A person's overrides

`loam.keybindings.overrides` can rebind or unbind any binding except `F6`, `Shift+F6` and `Escape` (`KEYBINDING_RESERVED`). Overrides are human only (3.2).

### 8.4 The reserved chords, version 1

Phase 0's seven, plus one:

| Keys | Command | Why |
| --- | --- | --- |
| `Mod+Alt+P` | `section-open { section: 'projects', target: 'switcher' }` (#857) | `Mod+P` is the browser's print. P4-E9 asserts that the page receives `Mod+Alt+P` in Chromium. Firefox and WebKit wait for #706's suites, and a person can rebind the chord |

The first draft also reserved `Mod+,`, `Mod+Shift+I` and `Mod+Alt+T`. **They are dropped,** because none can be shown to reach a page:

- `Mod+,` opens the browser's own settings on macOS;
- `Ctrl+Shift+I` opens developer tools;
- `Ctrl+Alt+T` opens a terminal on some Linux desktops.

### 8.5 Commands

`keybinding-list` is a query, `{}` to `{ bindings }`. Changes go through `setting-set` on `loam.keybindings`. `keybinding` joins the shell's domains.

### 8.6 Chords inside a view

Loam forwards no keys from a view: a view that could claim a key would let untrusted code drive the shell's chords. Phase 1's follow-up closes as decided.

## 9. Menus (D127)

- **Declaration:** `ui.menus` holds up to 16 entries of `{ context; command; label?; when?; requires_experiment? }`. `context` is one of `sidebar-item`, `editor-tab`, `document-row` and `project-row`.
- **Opening:** a context-menu gesture or Shift+F10 opens the shell's `menu` popover.
- **Running an entry:** it runs as the person, with `{ target: ResourceLinkV1 }`. The manifest is refused at load if the entry's command has no `target` in its input (`MANIFEST_MENU_INPUT`), or if it names a human or owner command (`MANIFEST_MENU_RESERVED`).
- **Where entries appear:** on the app's own targets, and on `project-row`.

## 10. The inbox (D120)

### 10.1 The record

```ts
export interface NotificationV1 {
	id: string;                    // `ntf_` and 16 of [a-z0-9]
	workspace: string;
	person: string;                // the recipient
	source: string;                // an instance id, 'shell', or `agent:<id>`
	kind: 'notice' | 'confirmation';
	title: string;                 // 1 to 120, plain text
	body?: string;                 // 1 to 1000, plain text
	tone: 'info' | 'success' | 'warning' | 'danger';
	link?: ResourceLinkV1;
	action?: { command: string; label: string; input?: object };
	/** Set by the kernel only. */
	confirmation?: { command: string; caller: string; input: object; expiresAt: number; state: 'pending' | 'confirmed' | 'declined' | 'expired' };
	scope: ScopeV1;
	createdAt: number; readAt?: number; archivedAt?: number;
}
```

- **Storage and access.** Notifications are the table `notification`, listed by `person`.
  - **Only the notification's person, and that person's agents, can read it.**
  - **Reads are filtered by `decideAccess` on the notification's `scope`** (I3).
- **An action** must be one of the source app's own `expose.palette` commands, **and never a `HUMAN_COMMANDS` or `OWNER_COMMANDS` entry**. This is checked at push and again at run.
  - **A notification an agent pushes carries no action** (B2).
  - `notification-act` runs the action as the person, through the palette interface.
- **A confirmation** is `kind: 'confirmation'`, created only by the kernel, and answered by `notification-act { answer }`.
- **Quota:** at most 500 notifications per person. Past that, the oldest read and archived ones are dropped first, then the oldest read ones. Unread ones are never dropped. A push that would exceed 500 unread gives `QUOTA_EXCEEDED`.

### 10.2 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `notification-push` | mutation | `{ title; body?; tone?; link?; action? }`, for the call's person | `{ notification }` |
| `notification-list` | query | `{ cursor?; unread?; source?; kind?; limit?: 1..100 }` | `{ notifications; cursor; unread }`, newest first |
| `notification-read` | mutation | `{ notification } \| { all: true; source? }` | `{ read }`. Undo marks them unread |
| `notification-archive` | mutation | `{ notification }` | `{ archived: true }`. Undo restores |
| `notification-act` | mutation, human | `{ notification; answer?: 'confirm' \| 'decline' }` | The action's `CommandResult`, or `{ state }` |

- **Port:** `notification-push` is callable through a port, for the call's own person only.
- **Rate:** 10 pushes a minute per source, **counting sticky toasts that land in the inbox**. Past that, `RATE_LIMITED`, journaled once per window.
- **The shell pushes** for a sticky toast, an unseen failed autosave, and phase 3's revoked-session notice.

### 10.3 The section

- **Where:** `section-open { section: 'inbox' }`, at `~/inbox`.
- **The bell:** in the title bar, showing the unread count.
- **Order:** pending confirmations sort first.
- **Lazy:** it is the `inbox` chunk, and the count is read in stage B.

## 11. Limits (#710, in part, D124)

`loam.limits` is a workspace section that an owner sets, with fixed bounds:

| Key | Default | Bounds | Enforced at | Refusal |
| --- | --- | --- | --- | --- |
| `messageBytes` | 1,048,576 | 65,536 to 8,388,608 | The view broker, before it parses a message | The message is dropped, and the frame is told `INPUT_TOO_LARGE` |
| `inputBytes` | 262,144 | 16,384 to 1,048,576, **and at most a quarter of `journalEntryBytes`** | Every app command's input through a port or a broker, before the handler (A-P2-3) | `INPUT_TOO_LARGE` |
| `callsPerSecond` | 50, burst 200 | 5 to 500 | A token bucket per instance | `RATE_LIMITED`, with `details: { limit, retryAfterMs }` |
| `storeBytes` | 26,214,400 | 1,048,576 to 268,435,456 | The `store` grant, per instance per workspace | `QUOTA_EXCEEDED`, with `details: { kind: 'store', limit, used }` |
| `journalEntryBytes` | 1,048,576 | 262,144 to 4,194,304 | The journal sink, on **the whole entry**: a larger one keeps `{ truncated: true, bytes, sha256 }` in place of its input and result, and is marked `unreplayable` | None to the caller |

- **Fail closed (I4a).** The defaults are compiled into the kernel and enforced from boot. An unreadable value or a failed store leaves the defaults in force.
- **The bounds hold each other (I4b).** A write that breaks the quarter rule gives `VALIDATION_ERROR`.
- **Replay stops at an unreplayable entry (I4d)** with `REPLAY_ENTRY_TRUNCATED`.
- **The mount relay (I4f)** applies the smaller of `request_body_bytes` and `messageBytes`. This is obligation 6 of section 13.
- **What this does not answer of #710:**
  - a total budget for the journal and the origin;
  - retention;
  - what the journal sink does on `QuotaExceededError`.

  These are deferred by name, and **#710 stays open**. The per-entry and per-call bounds keep one call's damage small, but they do not bound a view that calls within its rate for hours.

## 12. The kernel and the SDK

- **Kernel interface version 4.** `APP_CALLABLE_SHELL_COMMANDS_V2` adds `popover-open`, `dialog-open`, `prompt-open`, `experiment-check` and `notification-push`, and `setting-get` and `setting-list` for the app's own sections.
- **SDK** (a minor version): `SettingsV1`, `NotificationsV1`, the new kinds in `OverlaysV1`, and `settingsChanged`.
- **New shell domain:** `keybinding`.
- **New shell commands:** `palette-run`, `notification-act`, `autonomy-list`, `setting-reset`, `notification-archive` and `keybinding-list`.
- **Internal commands:** `overlay-global-set` and `store-usage-settle`.

### 12.1 The manifest

| Key | Rule | Codes |
| --- | --- | --- |
| `ui.settings` | 3.1 | `MANIFEST_SETTING_SCHEMA`, `MANIFEST_SETTINGS_LIMIT`, `MANIFEST_SETTINGS_MOUNTED`, `MANIFEST_SETTING_DEFAULT`; `MANIFEST_SETTING_SECRET` warns |
| `ui.experiments` | 5.1 | `MANIFEST_EXPERIMENTS_LIMIT`, `MANIFEST_EXPERIMENT_DATE`; `EXPERIMENT_OVERDUE` warns |
| `ui.menus` | Section 9 | `MANIFEST_MENU_CONTEXT`, `MANIFEST_MENU_INPUT`, `MANIFEST_MENU_RESERVED`, `MANIFEST_MENUS_LIMIT` |
| `requires_experiment` | 5.3 | `MANIFEST_EXPERIMENT_UNKNOWN` |
| `commands[].confirm_prompt` | 7.2 | For a mounted tool, still `MANIFEST_CONFIRM_UNAVAILABLE` |
| `ui.surfaces.keybindings[]` | 8.1 | `MANIFEST_KEYBINDING_KEYS`, `MANIFEST_KEYBINDING_WHEN`, `MANIFEST_KEYBINDING_RESERVED` |
| `plugin.title` | 6.6 | `MANIFEST_TITLE_RESERVED` |

Each refusal carries a suggestion. Each row gains a valid and a refused case.

## 13. Hosted `provider` deployments (D125)

**Phase 4 exits locally and runs nothing on the hosted server (R1).**

- **Until a later step serves them,** a hosted `provider` deployment refuses these writes with **`SHARED_RECORD_UNAVAILABLE`**. Each refusal is journaled, and nothing is written:
  - `setting-set` and `setting-reset` with `level` `workspace` or `project`;
  - `autonomy-set` at every level;
  - `experiment-*` with `audience: 'workspace'`.

  It is **never a silent write to the browser's copy**. Reads answer the defaults and the person's own values. Person-level settings, person enablements and the inbox work as everywhere else.
- **The step that brings these records to the server is phase 5's "shell commands over MCP"**, because enforcing autonomy against them needs them there. Its specification must:
  1. **Route by input:** run `settingWriteRule` on the server, in step 4 of phase 6's 6.2 transport, refusing any `level: 'person'` write that reaches it;
  2. **Hold the person's cap and the person's experiment enablements as server records** (B5);
  3. **Name the agent owner line** for connected agents' overlays and notifications, and keep those notifications free of actions;
  4. **Filter the snapshot:** `TrustRecordSnapshotV1` gains shared settings rows, autonomy rows and workspace enablements, each only for projects the person may enter;
  5. **Serve reads over MCP:** `setting-schema-get`, `setting-list`, `setting-get`, `autonomy-get`, `autonomy-list` and `experiment-list`, including the cap;
  6. **Apply the relay's message limit** (I4f);
  7. **Record by input for replay**, amending phase 6's A5.
- **Why not phase 6.** Phase 6's specification is approved, and its M1 is on phase 3's path. Adding these records there would put phase 4 on M1's path.

## 14. Budgets

These are estimates, under D115. Against first paint of 288,822 bytes and 89,309 gzip:

| Step | First-paint parts | Estimate (bytes, gzip) |
| --- | --- | --- |
| 1 | Stage A reads `loam.settings` and `loam.appearance.last` | 400, 160 |
| 3 | The toast region's F6 stop and owner line | 300, 120 |
| 7 | The key matcher's `event.key` path and sequences | 600, 250 |
| **Total** | | **about 1,300, 530** |

| Row | Estimate | Note |
| --- | --- | --- |
| `late` | +4,500 | Overlay kinds, the state machine and the answer rule; limits; keybindings |
| `late-settings` (new) | 22,000 | Sections 3, 4, 5 and 10, the resolvers, confirmations |
| `settings` (new) | 30,000 | The settings section and its form |
| `inbox` (new) | 9,000 | |
| `overlays` (new) | 12,000 | |
| `apps` | Measured by step 2 | |

## 15. Accessibility

- **The settings section:**
  - a `tree` and a form;
  - labels from each key's title;
  - `aria-describedby` from each key's description;
  - a tab list as the level switcher.
- **Overlays:**
  - popovers are `menu` or `dialog`;
  - menu items are `menuitem`s, with arrow keys and type-ahead;
  - modals and prompts are `aria-modal`;
  - the "Requested by" line is part of the dialog's name.
- **The inbox:**
  - the bell's name includes the unread count;
  - the list is a `feed`;
  - Confirm and Decline buttons carry the command's title in their names.
- **Checks:** axe WCAG 2.2 AA in three themes, and Specimen captures (P4-E13). #708's screen-reader pass covers the new overlays. It is manual and not a gate.

## 16. Failure modes and error codes

| Code | When | Retryable | Suggestion |
| --- | --- | --- | --- |
| `SETTING_NOT_FOUND` | An unknown or gated section or key | No | List the sections with `setting-schema-get` |
| `SETTING_LEVEL_UNAVAILABLE` | A level the key does not allow | No | Names the allowed levels |
| `SETTING_PROJECT_REQUIRED` | `project` level with no project in scope | No | Run `scope-set` with the project first |
| `SETTING_TOO_LARGE` | A section over 16 KiB | No | Shorten the longest values, or split the section |
| `SETTING_NOT_OWNED` | An app reads another app's section | No | Read only this app's own sections |
| `SETTING_USE_AUTONOMY` | `setting-*` on `loam.autonomy` or `loam.experiments` | No | Use `autonomy-set` or `experiment-enable` |
| `SETTING_MUTE_SHELL` | Muting `shell` or an agent | No | Mute an app's notifications instead |
| `SHARED_RECORD_UNAVAILABLE` | Section 13 | No | Set it in a local deployment, or wait for the release that serves it |
| `AUTONOMY_ABOVE_CEILING` | A row above a ceiling that binds it | No | Names the ceiling, and says that an owner sets it |
| `EXPERIMENT_NOT_FOUND` | An unknown, hidden or removed id | No | List with `experiment-list` |
| `EXPERIMENT_NOT_OWNED` | Checking another app's experiment | No | Check only this app's own experiments |
| `OVERLAY_ANCHOR_NOT_FOUND` | An anchor that cannot be resolved | No | Set `data-loam-anchor` on the invoker |
| `OVERLAY_ELEMENT_VIEW` | `element` from a view | No | Use text, actions or a prompt |
| `OVERLAY_LIMIT` | A fourth dialog | No | Close one of this app's dialogs first |
| `OVERLAY_ITEM_RESERVED` | An action or menu item that is a human or owner command | No | Let the person run it from the palette |
| `CONFIRMATION_DECLINED` | Declined, or declined within the last 60 s | No | Ask the person before trying again; do not repeat the call |
| `CONFIRMATION_REQUIRED` | A pending confirmation expired | Yes | The person did not answer; ask them, then retry |
| `KEYBINDING_RESERVED` | Overriding F6, Shift+F6 or Escape | No | Bind another key; these keep the keyboard path through the parts |
| `INPUT_TOO_LARGE` | Section 11 | No | Send less, or ask an owner to raise `loam.limits.inputBytes` |
| `RATE_LIMITED` | Calls, pushes or pending confirmations over their rate | Yes | Wait `retryAfterMs`, then retry; an owner sets the call rate in `loam.limits` |
| `QUOTA_EXCEEDED` | A store or the notifications over their quota | No | Delete what this app no longer needs, or archive notifications |
| `REPLAY_ENTRY_TRUNCATED` | A replay reaches an `unreplayable` entry | No | Replay up to the named entry only |

`RATE_LIMITED` and `QUOTA_EXCEEDED` are AFD's own codes, used with `details`, because their meaning is AFD's. `INPUT_TOO_LARGE` is Loam's, since AFD has no code for a bounded input.

## 17. Security

- **No new grant.** P4-E2 holds this.
- **Autonomy goes up only through a person,** within an owner's ceilings. A cap can only lower it.
- **Only a human gesture confirms** (6.5). An agent may only cancel.
- **Nothing passes for the shell or for someone else.** Apps carry their name, agents carry "Requested by", and only the kernel sets `for`.
- **An action or a menu entry** runs one of its owner's own palette commands as the person. It is never a human or owner command, never runs on display, and never comes from an agent's notification.
- **Limits.** For a view they are a boundary, and for a native app a contract (D54). They fail closed. They bound each call, not the journal's total (#710 is answered only in part).
- **No secrets, and no regular expressions from apps** (3.1).
- **The hosted lane** refuses shared writes (section 13).

## 18. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam |
| --- | --- | --- |
| Enforcing autonomy, approvals and their metrics | Phase 5 (D41) | `resolveAutonomy`, confirmations, `chain` |
| Shared records on the hosted server, and their MCP reads | Phase 5's shell commands over MCP | `SHARED_RECORD_UNAVAILABLE`, `settingWriteRule` |
| An agent member's own cap | Phase 5 | `resolveAutonomy`'s caps |
| Notifications to another person | The collaboration service or phase 5's events | `NotificationV1.person` |
| The journal's total budget and retention | A follow-up, with D82's retention | `journalEntryBytes` |
| A mounted app's settings and experiments | Phase 5 | `MANIFEST_SETTINGS_MOUNTED` |
| A view's element in a dialog | When MCP Apps defines nested views | `OVERLAY_ELEMENT_VIEW` |
| Native notifications on the desktop | Phase 6's desktop lane | The inbox |

## 19. Exit criterion and tests

The phase exits when all of these hold:

- **every scenario in [`scenarios/`](scenarios/) passes** in `kernel/src/scenarios.test.ts`;
- every test below passes on `main`, in the place its row names;
- STATUS.md records the runs.

**The exit is local only** (D126). Every title starts `P4-E<n>:`, except E14's.

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P4-E1 | **An app's setting is searchable from the palette and scoped per project** | Chromium; Units | Hello's project-level `greeting`, in Atlas and Beacon, through the palette, the section and the grant, including `settingsChanged`. `setting-set` with no `level` gives `VALIDATION_ERROR` |
| P4-E2 | **Settings, experiments and autonomy grant nothing** | Units | Phase 3's E2 sweep, on twin stores. **Exempt from comparing `data` (never `ok` or `error.code`):** `setting-*`, `autonomy-*`, `experiment-*`, `keybinding-list`, `appearance-get`, `palette-search` (compared as a set), `app-list` and `app-get` (a gated app's `state`). **Exempt entirely:** commands of an app that is gated in one twin. A type check, and a scan of `scope/access.ts`, `scope/middleware.ts`, `late/port-callable.ts`, `late/port-refusals.ts` and `late-identity`'s owner and human checks |
| P4-E3 | **Appearance is taken over** | Units; Chromium | Phase 0's tests pass. `SESSION_50` replays. The migration happens signed in and never signed out. `loam.appearance.last` prevents any flash (a frame captured before the probe answers). Two people keep their own themes. `view-state-*` on `loam.settings` is refused, and the alias reaches only `theme` and `density` |
| P4-E4 | **An autonomy level set on a project is inherited by its apps and overridden for one command** | Units; Chromium | The scenarios' cases. **An owner's workspace row `tally-reset: suggest` holds in Atlas.** The ceiling and the cap. The agent's `autonomy-set` gives `HUMAN_REQUIRED`. A non-owner non-creator gives `OWNER_REQUIRED`, and so does the creator of a project a team instance lists. A mounted tool with no row resolves `ask`. A restricted project gives `PROJECT_NOT_FOUND`, byte-identical |
| P4-E5 | **An experiment gates a surface until a person opts in, and a workspace owner can enable it for all** | Chromium; Units | Hello's `inspector-v2` for Bea and Olu, through personal enablement, workspace enablement, Olu's opt-out (Q2) and `OWNER_REQUIRED`. A changed `changes` turns enablements off. `graduated`, and `removed` with re-shipping. Hidden and unknown ids answer the same. A gated app loads on enable |
| P4-E6 | **The inbox** | Chromium; Units | A sticky toast lands and counts against the rate. Actions run through `notification-act`. Read, archive and undo. The quota and the rate. Another person's notification reads as missing. A project the person was removed from is filtered out. An agent's notification has no action. An action that is a human command is refused |
| P4-E7 | **Every overlay kind follows the policy table** | Chromium; Units | The matrix of kinds × opening while active and inactive, switching away and back, limits, placement and focus. Each `reason`. Owner and "Requested by" lines. F6. A change of person closes everything. **The agent's `overlay-dismiss { result: 'confirm' }` gives `HUMAN_REQUIRED`, and its `cancel` is accepted** |
| P4-E8 | **Prompts and confirmations** | Chromium; Units | `checklist-item-add` through `palette-run`. Tally's `confirm_prompt` waits in the slot from the palette, and in the inbox from an agent or an inactive tally, with the shell's header. **An agent confirming its own confirmation gives `HUMAN_REQUIRED`, and nothing runs.** A decline, and the 60-second window (the person's own call still prompts). The 10-minute timeout on a fake clock. A busy slot. Replay. The three-button close, and an agent's `discard` answer refused |
| P4-E9 | **Keybindings** | Chromium; Units | `Mod+Alt+P` reaches the page in Chromium. German and Cyrillic layouts. Sequences and their timeout. `when`. A sequence starting with `Mod+K` is refused. Overrides, F6 refused, an agent's override `HUMAN_REQUIRED`. The rail order persists and replays |
| P4-E10 | **Limits** (#710, in part) | Chromium; Units | Each refusal in section 11 with its `details`. A truncated entry from a large result. **A replay stops with `REPLAY_ENTRY_TRUNCATED`.** The defaults hold when `late-settings` fails to load. The quarter rule. Widening a limit |
| P4-E11 | **Menus** | Chromium; Units | Right-click and Shift+F10. Entries absent on another app's rows. Gated entries. A human command refused at load |
| P4-E12 | **Budgets** | Budget; Chromium | The rows of section 14; the first paint and chunk-loading assertions |
| P4-E13 | **Accessibility and captures** | Chromium | Section 15, and the keyboard paths |
| P4-E14 | **What exited stays exited** | Earlier phases' places | The local exit tests of phases 0 to 3, amended only as listed |
| P4-E15 | **Every new command replays** | Units | A seeded session, stopping only at a truncated entry |
| P4-E16 | **Every scenario passes, and no job was skipped** | Units; the exit step | `scenarios.test.ts`, then `node scripts/loam-exit-check.mjs --phase 4` |
| P4-E17 | **Hosted refusal** | Units | A hosted `provider` projection: each write in section 13 gives `SHARED_RECORD_UNAVAILABLE`, journaled, and no table changes. Person-level writes succeed |

## 20. Implementation plan

Each step is one pull request, merged on green, and it updates this status block and STATUS.md. **Steps 4, 6, 8 and 10 each get a trust review.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 1 | Settings core | 3.1 to 3.4, 3.6, 3.8, 3.9; section 13's refusal; `settingWriteRule`; appearance with `loam.appearance.last`; `loam.documents`; kernel interface 4; the architecture's amendments; E2's units, E3, E17, and E15 so far | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | The settings section and the palette's setting rows | 3.5, 3.7, 3.10; the form moved; `loam.rail`; hello's setting; E1 | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 3 | Overlays I: toasts and popovers | Sticky toasts, owner lines and `agent:<id>`, F6, popovers with anchors and menu items; E7's columns for them | `pnpm check`, `loam.yml`, `budget` |
| 4 | Overlays II: dialogs, modals, prompts, global | Parked dialogs, actions, elements, prompts, the slot, **the answer rule**, `overlay-global-set`; E7's other columns. **Trust review** | `pnpm check`, `loam.yml`, `budget` |
| 5 | The inbox | Section 10 except confirmations; E6 | `pnpm check`, `loam.yml`, `budget` |
| 6 | Prompts and confirmations | Section 7; tally's command; E8. **Trust review** | `pnpm check`, `loam.yml` |
| 7 | Keybindings and menus | Sections 8 and 9; E9, E11 | `pnpm check`, `loam.yml`, `budget` |
| 8 | Autonomy | Section 4; E4. **Trust review** | `pnpm check`, `loam.yml` |
| 9 | Experiments | Section 5; E5 | `pnpm check`, `loam.yml` |
| 10 | Limits | Section 11; E10. **Trust review** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 11 | Exit | Minimums; every row; the scenarios moved and passing; #710 re-scoped; follow-ups filed | The check exits 0 |

**Order:**

- **Step 1** comes first, after phase 3's step 4 (1.2).
- **Steps 2, 3 and 10** need step 1, and may run in parallel.
- **Step 4** needs step 3, and phase 3's `HUMAN_REQUIRED`.
- **Step 5** needs step 3.
- **Step 6** needs steps 4 and 5.
- **Step 7** needs steps 2 and 3.
- **Steps 8 and 9** need step 2 and phase 3's `HUMAN_REQUIRED`. Their Chromium cases also need phase 3's steps 3 and 4.
- **Step 11** comes after steps 1 to 10 and phase 3's step 9.

**Nothing waits on phase 6.** Each step rebases on `main` before review. No step changes a phase 3 trust rule; any names a step adds to phase 3's lists are listed in its pull request.

## Questions for the owner

**Asked 2026-11-13, and revised the same day after review.** The text is written to each recommendation. An answer that differs amends the named section before its step starts.

### Q1. Who sets a project's autonomy, within the owners' ceilings?

Autonomy decides whether agents act on their own, ask first, or only suggest. Owners set two kinds of limit:

- the workspace's level, and an overall ceiling;
- any rule for one app or one command, which every project stays within (4.2).

The question is who else may set a project's own level, which can only be at or below those ceilings. "The project's creator" means whoever created the project, and any member may create one. For a project that a team instance lists, only owners may, as for its members (D87, D110).

- **Owners and the project's creator (recommended).** This matches who may change a project's members (D110). The creator runs their own project without waiting, and stays inside every rule the owners set.
- **Owners only.** The strictest option. Every project change waits for an owner.
- **Any member of the project.** The most self-service option. The tradeoff: one member can let agents act unprompted for everyone in the project, up to the owners' ceilings.

### Q2. May a person opt out of a workspace-enabled experiment?

- **Yes (recommended).** Nobody is held in an experiment they don't want.
- **No.** Everyone sees the same thing. The tradeoff: a person stuck with a broken experiment has to wait for an owner.

### Q3. The default autonomy

What should agents do where nobody has set autonomy? Until phase 5 enforces it, a connected agent can make any change its person can (D98).

- **Act on reads, ask before changes, and ask before any tool of a mounted server (recommended).** A mounted server labels its own tools, and that label can't be trusted, so its tools count as changes. Owners can loosen this.
- **Ask for everything.** The most cautious option. The tradeoff: agents ask before every lookup, and people learn to click through.
- **Act on everything.** Today's behavior. The tradeoff: agents change things unprompted until an owner tightens it.

### Q4. May a person's agent write project-level settings?

Every member of a project reads its project-level settings.

- **No, people only (recommended).** This matches D110's "no agent changes who is in a project": what everyone in a project sees is changed by a person, never by an agent acting for one. The answer is the same locally and on the hosted lane.
- **Yes, as the person.** The tradeoff: one person's agent can change what every member sees, unprompted until phase 5.

### Q5. Cut and rank the jobs

The ten jobs in [Jobs and scenarios](#jobs-and-scenarios) are a draft. Their ranking decides what is built first.

- **Accept the draft and its `slice` (recommended):** per-project settings, finding a setting, an agent reading its autonomy, trying an experiment, the palette's input prompt, and declining a confirmation. Together these cover the architecture's exit criterion and the two trust rules a person meets first.
- **Cut, add or re-rank** any of them.

## Proposed amendments to other phases

- **A-P0-1 (step 6):** phase 0's palette filter is removed, and `createKeybindings` takes overrides and sequences (step 7).
- **A-P1-1 (step 6):** the surface catalog's `palette` row changes from "Filtered by active app and scope" to "Filtered by scope, ranked by active app".
- **A-P2-1 (step 6):** 5.5's "Three buttons wait for phase 4" is replaced by 7.3.
- **A-P2-2 (step 1):** `WorkspaceV1.trashDays` is written through from `loam.documents.trashDays`.
- **A-P2-3 (step 10):** the 256 KiB instance-command input bound becomes `loam.limits.inputBytes`.
- **A-P3-1 (step 1):**
  - `emphasis.sections` is widened;
  - `HUMAN_COMMANDS` gains `autonomy-set`, `experiment-enable`, `experiment-disable` and `notification-act`;
  - the `setting-*` cases are decided in the handler;
  - `needsMembershipRead` joins the re-read.
- **A-P3-2 (step 1):** appearance becomes per person in phase 3's 4.5 and in `scope/personal.ts`, with `loam.appearance.last`.

## Amendments to the architecture and the decision log

- **Section 4, Settings:** settings are set per person, workspace and project level, with 3.3's precedence.
- **Section 4, Overlay policy:**
  - the prompt row's limit becomes "the overlay slot; confirmations from agents and background apps wait in the inbox";
  - the global row's placement becomes "top layer, a strip under the title bar".
- **Section 5:**
  - the new commands, and `keybinding` as a domain;
  - an experiment's `state` is a stage plus enablement.
- **Section 9:** phase 4's exit is local, and it depends only on phase 2 (D126).
- **Glossary:** the terms above.
- **Decision log:** D116 to D127, marked proposed.

| ID | Proposed decision |
| --- | --- |
| D116 | Settings: a closed schema subset with no `pattern`, and a default per key; three levels; resolution from the person, then the project, then the workspace, then the default; one `settingWriteRule`, with `level` required; workspace values set by an owner, project values by a person who may enter the project (agents per Q4); `loam.settings` is not a view-state id; the `settings` grant reads only the app's own sections |
| D117 | Appearance, keybindings and the rail order are person settings. Appearance is per person in `provider` mode, with the profile's last appearance used for the signed-out page and stage A. The commands are unchanged, and nothing migrates while signed out |
| D118 | Autonomy rows at workspace or project level, narrowed to an instance and a command. A project row decides within the workspace's ceiling and its rows for that app and command, and then the person's cap applies. The default follows Q3, with mounted tools at `ask`. Every write is a human command; project rows follow Q1; reads are filtered. Phase 4 stores, resolves and shows; phase 5 enforces |
| D119 | Experiments: an author's stage, `changes` and `ends`. Enablement per person, or per workspace by an owner, each tied to the digest of `changes`. Opt-out follows Q2. Removing an experiment deletes its enablements. Gates decide presence, never permission |
| D120 | The inbox: per person, filtered by scope, pushed only for the call's own person. At most one action, which must be the source's own palette command and never a human or owner command; agents' notifications carry none. Confirmations wait here. Uses AFD's quota and rate codes |
| D121 | The overlay manager complete. Agents own their overlays as `agent:<id>`, with a header the shell draws. Only a human gesture confirms a shell, app or agent overlay |
| D122 | `palette-run` prompts for input across the apps enabled for the scope. `confirm_prompt` is enforced in process, with AFD's codes. Confirmations from a person or the active app wait in the slot; those from an agent or a background app wait in the inbox. Confirmations time out, and declines open a 60-second window. The close prompt has three actions |
| D123 | Keybindings version 1: layout-aware; sequences that cannot start on a reserved chord; a closed `when` vocabulary; human overrides, except for F6, Shift+F6 and Escape; `Mod+Alt+P`; no forwarding from views |
| D124 | Limits per message, input, call rate, store and whole journal entry. The bounds hold each other, and the limits fail closed. A replay stops at a truncated entry. #710 is answered in part |
| D125 | Phase 4 runs nothing on the hosted server. Hosted `provider` deployments refuse shared writes with `SHARED_RECORD_UNAVAILABLE`. Phase 5's shell commands over MCP bring these records to the server, under section 13's seven obligations |
| D126 | Phase 4's exit is local and includes every scenario passing. It waits on phase 3's step 9, and on nothing of phase 6 |
| D127 | Menus: `ui.menus` entries in four contexts, rendered as the shell's popover. Each runs the app's own command as the person, never a human or owner command |

## Review 2026-11-13

Two independent reviews of `445b2bd7`, one of trust and security and one general, each found the specification "approvable once fixed". The coordinator ruled on the open choices as R1 to R6.

### Coordinator's rulings

| Ruling | Answer |
| --- | --- |
| R1: hosted serving leaves phase 4 | Section 13 is now a refusal plus seven obligations on phase 5's shell commands over MCP. H1, H2 and D126's hosted half are gone. P4-E17 is added |
| R2: workspace rows for an app or a command are ceilings for project rows | 4.2 step 4, E4, and Q1 restated |
| R3: confirmations from agents and background apps wait in the inbox | 7.2, 10.1, the timeout and the decline window |
| R4: appearance | `loam.appearance.last`, no migration while signed out, A-P3-2 |
| R5: owner questions | Q1 restated, Q3 covers mounted tools, Q4 and Q5 added |
| R6: smaller choices | `pattern` dropped; three chords dropped; AFD's codes used; step 3 split; #710 answered in part |

### Trust and security review

| Finding | Answer |
| --- | --- |
| B1: an agent confirms its own prompt | 6.5's answer rule; E7 and E8 |
| B2: agent overlays and notifications show as the shell's | `agent:<id>` and "Requested by"; no action from agents; no human or owner command as an action or item; `for` set by the kernel only |
| B3: unlabelled app text, raised from the background | R3; the shell's header; `OVERLAY_MODAL_BUSY` |
| B4: `level` was optional | Now required; one `settingWriteRule`; E1's case. The server's half is obligation 1 |
| B5: no command for the cap | `autonomy-set { level: 'person' }`. The server's half is obligation 2 |
| B6: `loam.settings` reachable through `view-state-*` | Not a view-state id; the alias covers only two keys; E3 |
| B7: Q1's premise | R2 |
| I1: hosted versus local agents | Q4 |
| I2: leaks through autonomy reads | Reads filtered, with `PROJECT_NOT_FOUND`. Obligation 4 for the snapshot |
| I3: notifications outlive access | Filtered by scope; E6 |
| I4 (a) to (f): limits | All six in section 11. (f) is obligation 6 |
| I5: confirmation fatigue | R3 |
| I6: re-consent to experiments | The digest; removal deletes enablements |
| I7: E2's exemptions | Listed |
| I8: the palette across apps | "Enabled for the active scope"; app titles shown |
| I9: appearance amendment unlisted | A-P3-2 |
| I10: sequences and muting | 8.1; 3.7 |

### General review

| Finding | Answer |
| --- | --- |
| B1: no jobs | [Jobs and scenarios](#jobs-and-scenarios), Q5 and E16. **Not done:** the walk by fresh readers, asked of the re-check |
| B2: unstated dependencies on phase 3 | 1.2 and the Order |
| B3: the wrong phase 6 step | R1: no phase 6 step is named |
| B4: no command for the cap | As trust B5 |
| B5: person-dependent reads on the server | R1, and obligations 2 and 5 |
| I1: Q1's claim | R2 |
| I2: #710 | Answered in part; sections 11 and 17 softened |
| I3: suggestions and codes | Every row has a suggestion; AFD's codes; manifest codes moved into 12.1 |
| I4: input-routed rules versus frozen lists | 3.2; A-P3-1; obligation 7 |
| I5: first-paint and sign-in regressions | R4 |
| I6: amendments | A-P0-1, A-P1-1, A-P2-2, A-P2-3, and the architecture's |
| I7: a held slot; AFD | 7.2 |
| I8: reserved chords | Three dropped |
| I9: `pattern` | Dropped |
| I10: mounted tools in Q3 | Q3 and 4.2 |
| I11: scope creep | [Beyond the row](#beyond-the-architectures-phase-4-row-and-why); section 13 removed |
| I12: step sizes | Step 3 split |
| I13: W39 | Re-read and updated |
| Nits | `instance` required with `command`; the budget order; the broker names in 3.8; E2's scan; hidden experiments testable in `local` |

**Declined:** none. Two findings were answered differently from the reviewer's first suggestion:

- **Trust B3:** its suggestion was to refuse an inactive app's confirmation. Instead, the confirmation waits in the inbox (R3).
- **General I8:** its suggestion was an E9 case per chord per engine. Instead, the three chords were dropped (R6), because #706's Firefox and WebKit suites don't exist yet.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Phase 4 specification | Revisit `closedby` and `popover="hint"` when Safari ships them (W38, W39) | Open |
| 2026-11-13 | Phase 4 specification | Notifications to another person | Open; seam `NotificationV1.person` |
| 2026-11-13 | Phase 4 specification | An agent member's own autonomy cap | Open; phase 5 |
| 2026-11-13 | Phase 4 specification | #708's screen-reader pass over the new overlays | Open; with #708 |
| 2026-11-13 | Review (R1) | Phase 5's shell commands over MCP: section 13's seven obligations | Open; phase 5 |
| 2026-11-13 | Review (#710) | The journal's total and origin budget, retention, and `QuotaExceededError`, together with D82's retention | Open; #710 re-scoped at step 11 |
| 2026-11-13 | Review (jobs) | Walk the ten jobs with fresh readers in `jobs-first.md`'s three seats | Open; the re-check |
| 2026-11-13 | Review (I8) | Whether Firefox and WebKit pages receive `Mod+Alt+P` | Open; with #706 |
