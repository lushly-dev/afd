# Phase 4 specification: settings, experiments, notifications, overlays

| Field | Value |
| --- | --- |
| Phase | 4, settings, experiments, notifications, overlays ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 4 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [jobs](#jobs-and-scenarios) and their [scenarios](scenarios/), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.4, 4.1, 7.3 and 2.4), the [documents specification](../2-documents/spec.md) (its 5.5), the [identity specification](../3-identity/spec.md) (its 3.1, 3.3, 3.4, 4.5, 6 and 7), the [hosts specification](../6-hosts/spec.md) (its 6 and 7), the [phase 1 specification](../1-app-contract/spec.md) (its 4 and 8), the [architecture](../../architecture.md), the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State: not approved, re-check pending.** The history so far:
  - Written 2026-11-13 by the design sub-agent against `main` at `f7ecbd43`.
  - Revised the same day after two independent reviews of `445b2bd7` and the coordinator's rulings R1 to R6 ([Review 2026-11-13](#review-2026-11-13)).
  - That revision merged to `main` in [#1119](https://github.com/lushly-dev/afd/pull/1119) (`e7c813e1`) before its re-check ran.
  - **Revised a second time the same day** after:
    - a re-check of `6046b01f` (findings N1 to N13);
    - three walks of the jobs by fresh readers, in the person's seat, the job list's and the calling agent's;
    - the coordinator's rulings R7 to R16.

    Every finding and its answer is in [Review 2026-11-13, second round](#review-2026-11-13-second-round).
  - **Revised a third time** after a re-check of `faa0c1d9` ("approvable once fixed", F1 to F11 and four nits) and the coordinator's rulings on F2 to F11 ([Re-check 2026-11-13, third round](#re-check-2026-11-13-third-round)).

  The coordinator approves it under the owner's standing grant after a fresh re-check. The [questions for the owner](#questions-for-the-owner) are the owner's to answer, and the text is written to each recommendation. D116 to D127 are proposed here and in the [decision log](../../decisions.md), marked proposed.
- **Last verified:** 2026-11-13, against `main` at `92980528`. Evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `overlays.ts:20` (`TOAST_CAP = 5`), `:28-49` (`OverlayStore`: `toast` and `modal` only), `:44` (`whenClosed`, internal);
    - `overlay-owner.ts` (`SHELL_OWNER`, "the owner of an overlay a person or an agent opened");
    - `late/overlay-commands.ts:31` (strict inputs), `:116-135` (`modal-open` with no `caller` resolves to `SHELL_OWNER` and passes the active-app check), `:167-178` (`overlay-dismiss` checks the owner only when a `caller` is set);
    - `late/editor-commands.ts:185-192` (`EDITOR_TAB_DIRTY`);
    - `scope/middleware.ts:70-78` (`sessionActor` is `undefined` in `local` signed out);
    - `appearance.ts:29`, `shell-state.ts:208`, `session.ts:227-228`;
    - `scope/personal.ts:18-21` (`loam.appearance` stays the profile's in `provider` mode);
    - `keybindings.ts:25-33`, `:60-78`;
    - `types.ts:296-306` (`APP_CALLABLE_SHELL_COMMANDS_V1`);
    - `late/session-settle.ts:69-74` (the membership re-read);
    - **`HUMAN_REQUIRED` and `HUMAN_COMMANDS` are not in `endpoints/loam/packages` yet** ([1.2](#12-dependencies-on-phase-3s-steps)).
  - **Manifest:** `schemas/app-manifest.v2.json` (no `ui.settings`, `ui.experiments` or `ui.menus`; `confirm_prompt: false` at `:255` and `:316`); `src/refusal-map.ts:109-116`; `src/catalogs.ts:108-111`, `:163`.
  - **Apps:** `apps/tally` declares `tally-add` and `tally-get`; `apps/hello` has no guest book yet.
  - **Identity:** phase 3's 3.1, which gives `kernel.call` no actor in `local` signed out (`3-identity/spec.md:291`); its 3.4 and 7.6.
  - **AFD:** `spec/command-metadata.md:29,42,44-46,100-104` (`confirmPrompt`, `outputBudget`, and the meanings of `CONFIRMATION_DECLINED` and `CONFIRMATION_REQUIRED`); `packages/core/src/errors.ts:114-115`.
  - **Issues read:** #857, #869, #877, #881, #710, #708.
  - **External:** the [trajectory refresh](#trajectory-refresh).
- **Done:** this specification, its fourteen jobs as scenarios (all valid under `afd scenario validate`), and two revisions.
- **Not done:** its approval; the owner's answers to Q1 to Q5; every step of the [plan](#20-implementation-plan).
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 5, scope is shell-level; 6, overlays have owners; 8, agents are first-class users; 13, deterministic core; 15, AFD first.
- **Decisions it depends on:**
  - D1, D3 (shell sections, as commands); D6 (the overlay policy); D11 (persona is a lens); D12 (experiments).
  - D41 (autonomy: **settings in phase 4, enforcement in phase 5**); D51 (appearance's storage); D54 (native apps are trusted code); D67 (phase 4 completes the overlay manager).
  - D71 to D73 and D83 (scope, the order of a call, the ports); D75 and R8 (a personal rail order).
  - D85 to D87, D96 (modes, owners); D89 (persona); D98, D110 (connected agents; members).
  - D103, D104 (the hosted lane); D115 (size limits do not gate the epic).
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
| [#710](https://github.com/lushly-dev/afd/issues/710): limits on a view's message size, call rate and storage | **In part,** [section 11](#11-limits-710-in-part-d124). #710 stays open, re-scoped to what is deferred |
| Phase 1's `ui.menus` served from phase 4 | **Deferred** to a specification of its own ([section 9](#9-menus-deferred-d127)) |
| Phase 3's 6.1: `emphasis.sections` | Gains `settings` and `inbox` (A-P3-1) |

### Beyond the architecture's phase 4 row, and why

| Addition | Why it is here | Its job |
| --- | --- | --- |
| Limits (#710, in part) | Phase 1 filed it to be settled before untrusted apps widen | `limit-refuses-call`; a step of its own (10) |
| Prompts, `confirm_prompt`, the close prompt | Phases 1 and 2 deferred each to "phase 4's prompts" (#869, #881) | `palette-prompts-for-input`, `decline-confirmation` |
| Keybindings version 1 | Phase 1 deferred sequences and `when` here; #857 and #877 name this phase | `rebind-a-chord` |
| Notification actions | The surface catalog lists an `action` on an inbox item; confirmations live in the inbox | `inbox-action` |
| `MANIFEST_TITLE_RESERVED` | 6.6's owner line means nothing if an app's title can read as the shell's | None needed: a refusal at load |
| Menus | **Deferred** | No job was written ([section 9](#9-menus-deferred-d127)) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-13 (sources S98 to S100 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 4 |
| --- | --- | --- | --- |
| R3, W4 | Overlays on the top layer with anchor positioning | Unchanged: anchor positioning in Chrome 125, Firefox 147 and Safari 26 [S19] | Popovers use `popover="auto"` and anchor positioning ([6.3](#63-placement-and-the-platform)) |
| New W38 | Not watched | `<dialog closedby>` in Chrome and Edge 134 and Firefox 141. Safari not shipped (WebKit bug 284592). In Interop 2026 [S98] | **Not used** |
| New W39 | Not watched | `popover="hint"`: a first version in Chrome 133; caniuse lists a corrected version in Firefox 153 and Chrome 151. Safari not shipped. Interest invokers ship in Chromium [S99] | **Not used** |
| R8 | A personal, reorderable rail | Unchanged | A person setting ([3.7](#37-the-shells-own-sections)) |
| R10 | Experiments with audiences | Not re-checked externally. The research's practice [S34] stands, "not a permission model" included | [Section 5](#5-experiments-d119) |
| R15, W26 | Autonomy policy in settings; OWASP's ASI09 | Published 2025-12-09. Summaries describe ASI09 as polished explanations leading people to approve harmful actions, with forced confirmation as a defense [S100] | Only a person raises autonomy. Agents ask through confirmations that wait in the inbox, never a modal ([7.2](#72-confirm_prompt-and-confirmations)) |
| W11 | MCP Events, SEP-3415 | Not re-checked | Nothing projects the inbox over MCP in phase 4 |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and phases 2 and 3's. This specification adds:

| Term | Meaning |
| --- | --- |
| Section | A settings section: an id, a title, a schema and the levels it may be set at ([3.1](#31-a-section)) |
| Key | One property of a section's schema, with a default |
| Level | Where a value is set: `person`, `workspace` or `project`. The architecture's "user scope" is `person`. The UI calls it **"You, everywhere"** |
| Shared value | A value set at `workspace` or `project` level, which every member reads |
| Resolved value | What a key reads for one person in one scope ([3.3](#33-resolution)) |
| Autonomy mode | `suggest`, `ask` or `act` (D41) |
| Ceiling | A bound on a project's autonomy rows: the workspace's `ceiling`, or failing that its general row or the default, and each workspace row for an app or a command ([4.2](#42-resolution)) |
| Stage | An experiment's lifecycle stage, set by its author ([5.1](#51-the-declaration)) |
| Enablement | Whether an experiment is on, for one person or for the workspace ([5.2](#52-enablement)) |
| Gate | `requires_experiment`: the gated app or surface is present only while the experiment is on for the person |
| Inbox | The shell's notifications section ([section 10](#10-the-inbox-d120)) |
| Overlay slot | The one place a modal or a prompt occupies, shell-wide ([6.1](#61-kinds-and-the-policy-table)) |
| Human gesture | **A call through the chrome or the palette interface, with no `caller`, whose actor is not `agent`**, including no actor at all in `local` signed out, and a scenario step's `kind: 'test'` (R7). The only answer that confirms ([6.5](#65-who-may-answer)) |
| Confirmation | A request, raised by the kernel, to run one command with one input, which only a human gesture can confirm ([7.2](#72-confirm_prompt-and-confirmations)) |
| Pending confirmation | A confirmation an agent or a background app raised, waiting in the inbox |

## Jobs and scenarios

The jobs are written first, as the `afd` skill's `jobs-first.md` asks, one file per job in [`scenarios/`](scenarios/). Until the commands exist they are checked, not run; each becomes a test beside its code in the step that builds it. **P4-E16 starts from "every scenario passes".**

**These files need Loam's runner.** Each is tagged `loam-runner`. AFD's scenario format has no per-step actor, scope or seed, and `afd scenario run --server` runs every step as `kind: 'test'` at workspace level, so these files pass only in `kernel/src/scenarios.test.ts`. A per-step actor and scope in AFD is a [follow-up](#follow-ups) across all four languages.

**The step directives.** A step's `description` may open with directives, which the runner reads and strips. The grammar:

| Rule | Detail |
| --- | --- |
| The form | `[` *directive* `]`, separated by single spaces, at the start of the description, before any other text |
| The order | A caller directive first, if any, then `[scope: …]` |
| The callers | **At most one** of `[agent]` (the agent interface, as `shell-agent` for the person) and `[caller: <instance>]` (that instance's port, with that app active). `[caller: <instance>, inactive]` is the port with the `console` app active instead, so the caller is neither the active app nor the active tab's owner. No caller directive: the person at the palette interface, actor `kind: 'test'`, a human gesture (R7) |
| The scope | `[scope: <project id>]`, by the project's **id**, as the scope field carries it (D71). Without it, workspace level |
| Errors | An unknown directive, two caller directives, or a scope before a caller fails the file |

**`project` in inputs is the project's id** (`prj_atlas`), as D71's scope carries it and as `autonomy-*` stores it, everywhere in this specification and its scenarios.

**The seed.** Every file runs on one fresh seed, **`p4-base`**, which the runner's seed map (`kernel/scenarios/seeds.ts`) builds before each file. AFD's `fixture` field names a file the runner loads into a server, and a kernel seed is not one, so it isn't used. `p4-base` holds:

- a `local` workspace, signed in as one person, who is therefore an owner;
- projects `prj_atlas` (slug `atlas`) and `prj_beacon` (slug `beacon`), both created by that person;
- the apps hello, tally, checklist and console, enabled for both projects;
- tally's count at 3;
- a checklist document `doc_checklist0000001` in `prj_atlas`;
- hello's experiment `hello.inspector-v2`, `visible`, ending `2027-03-01`.

**Lists.** AFD compares a YAML list in `data` whole, with matchers inside it taken literally, so the files assert a list by index (`'0': { … }`), and a single item by `'1': { notExists: true }`. Where a list's order is not fixed, the command takes a filter: `palette-search { kind }`, `experiment-list { experiment }`, `keybinding-list { command, target }`, `notification-list { kind, source, limit }`.

**Phase 4 serves none of these commands to connected agents over MCP** (section 13). The agent jobs are served to the in-process agent interface only, which has no consumer before phase 5's copilot. Q5 says so.

### The slice

Ranked; built and passing first.

| # | Job | When … I want … so that … | File |
| --- | --- | --- | --- |
| 1 | Scope a setting per project | When a project needs an app to behave differently, I want to set that app's setting for the project alone, so that the other projects keep theirs | [`setting-per-project`](scenarios/setting-per-project.scenario.yaml) |
| 2 | Find a setting from the palette | When I know what I want to change but not where it lives, I want to find it from the palette and change it there, so that I never browse the settings tree | [`setting-from-palette`](scenarios/setting-from-palette.scenario.yaml) |
| 3 | Narrow autonomy for one command | When one command in a project is risky, I want agents to ask before it while the rest of the project acts, so that I'm interrupted only where it matters | [`autonomy-per-command`](scenarios/autonomy-per-command.scenario.yaml) |
| 4 | Try an experiment | When an app offers something new, I want to turn it on for myself and see what may change and when it ends, so that I opt in knowingly | [`opt-into-experiment`](scenarios/opt-into-experiment.scenario.yaml) |
| 5 | Turn an experiment on for everyone, and let a person step out | When an experiment is ready for the whole team, I want an owner to turn it on for everyone and each person to be able to turn it off for themselves, so that nobody is held in it | [`workspace-experiment-opt-out`](scenarios/workspace-experiment-opt-out.scenario.yaml) |
| 6 | Decline a confirmation | When an agent or an app asks to run something I didn't intend, I want to decline it, have nothing run, and not be asked again at once, so that I can't be worn down into agreeing | [`decline-confirmation`](scenarios/decline-confirmation.scenario.yaml) |
| 7 | Know my mode before I act | When I am an agent about to act for my person, I want to know whether to act, ask or only suggest, and why, so that I don't surprise them | [`know-my-mode`](scenarios/know-my-mode.scenario.yaml) |

### Next, outside the slice

| # | Job | When … I want … so that … | File |
| --- | --- | --- | --- |
| 8 | Act from the inbox | When an app tells me something I need to act on, I want the notice to wait in my inbox with the action, so that I act when I'm ready | [`inbox-action`](scenarios/inbox-action.scenario.yaml) |
| 9 | Leave my person a notice | When I am an agent and finish something my person should look at, I want to leave them a notice that says it came from me and links to the thing, so that they find it when they're back | [`agent-leaves-notice`](scenarios/agent-leaves-notice.scenario.yaml) |
| 10 | Change my person's setting, and hand off what I may not | When my person asks me to change a setting, I want to change their own and hand them the exact place for one every member reads, so that nothing everyone sees changes without a person | [`agent-changes-setting`](scenarios/agent-changes-setting.scenario.yaml) |
| 11 | Set a rule no project can loosen | When one command is risky everywhere, I want to set a rule for it that no project can loosen, so that the workspace's limits hold whoever runs a project | [`owner-ceiling`](scenarios/owner-ceiling.scenario.yaml) |
| 12 | Run a command that needs input from the palette | When a command needs input, I want the palette to ask me for it, so that I can run any command without opening its app | [`palette-prompts-for-input`](scenarios/palette-prompts-for-input.scenario.yaml) |
| 13 | Open the project switcher from the keyboard, and make it mine | When I switch projects many times a day, I want a chord for the switcher that works on my keyboard layout, and to change it if it clashes, so that I never reach for the mouse | [`rebind-a-chord`](scenarios/rebind-a-chord.scenario.yaml) |
| 14 | Learn which limit my app hit, and what to change | When my app hits one of the shell's limits, I want to learn which one and what to change, so that I fix my app instead of guessing | [`limit-refuses-call`](scenarios/limit-refuses-call.scenario.yaml) |

**The close prompt has no scenario.** Its three answers are a person's gestures on a modal the chrome opens, which a step cannot reach; P4-E8 holds them.

**What writing and walking them changed:**

- **From the first round:**
  - `level` is required;
  - `autonomy-set { level: 'person' }`;
  - `PROJECT_NOT_FOUND` on autonomy reads;
  - `changes` and `ends` in `experiment-list`;
  - `notification-act`;
  - `palette-run`.
- **From the second round:**
  - **Confirmations:** a pending confirmation returns at once, with `confirmation-get` and `confirmation-withdraw` (R9).
  - **Autonomy:**
    - `autonomy-get { commands }` in bulk;
    - `AUTONOMY_COMMAND_UNKNOWN`;
    - the workspace's own mode bounds project rows (R11), so the narrowing job starts by an owner setting a ceiling.
  - **Settings:**
    - `setting-schema-get { key }`;
    - `updatedBy` on reads;
    - the `HUMAN_REQUIRED` hand-off.
  - **Notifications:**
    - `NOTIFICATION_ACTION_UNAVAILABLE` for an agent's action;
    - how `source` is derived;
    - `notification-act` reports `state: 'done'`.
  - **Experiments and apps:**
    - `app-get`'s `gates`;
    - `experiment-list`'s `workspace` field.
  - **Palette:** `palette-search` rows carry `section`, `key` and `app`.
  - **Limits:**
    - `limit-usage-get`;
    - `RATE_LIMITED` always with details;
    - the push rate's suggestion says it is fixed.
  - **Two new commands for the jobs:** hello's `hello-greet` and `hello-guests`.

**What no scenario can show**, so the exit test named beside each shows it instead:

| What | Shown by |
| --- | --- |
| An error's `details` | E1, E10 |
| The clock moving | E8 |
| Inputs of 64 KiB | E10 |
| The modal the chrome opens | E8 |
| Two people in one file | E5 |

**Checks,** run on 2026-11-13 at the third revision:

- **Validation:** `afd scenario validate` passed all 14 files, and the dry-run check found no errors.
- **Evaluation:** validation never evaluates an expectation, so two rewritten assertions were run through AFD's `evaluateResult`:
  - `decline-confirmation` step 3 passes against a realistic `notification-list` result, and fails (`data.notifications.1`) when a second notification is present;
  - `know-my-mode` step 2 passes against a realistic bulk `autonomy-get` result, and fails (`data.results.0.mode`) when the first mode is `act`.
- **Coverage:** 75 steps; 18 of the 28 drafted commands are called directly. The rest:
  - `hello-greet` runs only as the inbox action;
  - `setting-list` and `autonomy-list` are the sections' reads (E1, E4);
  - `notification-read`, `notification-archive` and `confirmation-withdraw` are E6's and E8's;
  - `popover-open`, `dialog-open` and `prompt-open` are E7's;
  - `limit-usage-get` is E10's.
- **Error codes:** every code in [section 16](#16-failure-modes-and-error-codes) has a unit test in the step that adds it, and each is named in an exit test's row (F11).

## 1. Units and repository placement

No new package.

| Package | Change |
| --- | --- |
| `kernel` | **`late-settings`**, a chunk loaded inside `loadLate` beside `late-identity`, holding:<br>• the commands `setting-*`, `autonomy-*`, `experiment-*`, `notification-*`, `confirmation-*`, `palette-run`, `keybinding-list` and `limit-usage-get`;<br>• `resolveSetting`, `resolveAutonomy`, `experimentOn`, `settingWriteRule` and `isHumanGesture`.<br>**`late`:** the overlay store's new kinds, its state machine and the answer rule.<br>**New tables:** `setting`, `autonomy`, `experiment-enablement`, `notification`, `store-usage`.<br>**Also:** the person's settings record `loam.settings`; keybindings version 1; the limits; kernel interface version 4 |
| `chrome` | **Chunks:**<br>• `settings`: `loam-settings-section`, the schema form, and the custom editors `loam-keybinding-editor`, `loam-rail-order-editor` and `loam-instance-picker`;<br>• `inbox`: `loam-inbox`;<br>• `overlays`: `loam-popover`, `loam-dialog`, `loam-prompt` and the global strip.<br>**Elsewhere:**<br>• the modal's actions, header and owner line;<br>• the palette's setting rows, app titles and input prompt;<br>• Settings in the rail;<br>• the autonomy section's advisory notice |
| `manifest` | `ui.settings`, `ui.experiments`, `requires_experiment`, `confirm_prompt`, keybinding sequences and `when` ([12.1](#121-the-manifest)) |
| `sdk` | `SettingsV1`, `NotificationsV1`, `ConfirmationsV1`, the widened `OverlaysV1`, `settingsChanged` |
| `console` | Its schema form moves to `chrome/src/forms/` |
| `testing` | `createAppTestKernel` takes `settings` and `experiments` seeds; the scenario runner's directives |
| `apps/hello` | **The setting:** `hello.general.greeting`, at workspace and project level, and `hello.project.board`, project only.<br>**The experiment:** `hello.inspector-v2`, gating its inspector.<br>**The guest book:** `hello-greet { name }` greets a visitor waiting at it, and `hello-guests` lists them.<br>**Notices:** one sticky toast, and one notification with an action |
| `apps/tally` | `tally-reset` with a `confirm_prompt` |

- **Unchanged:** the release inventory, the repository contract, `AGENTS.md` and `@lushly-dev/loam-host` (R1). No changesets.
- **`loam.yml`:** runs the new Chromium files and `kernel/src/scenarios.test.ts`. The scenarios move to `kernel/scenarios/` as their commands are built.

### 1.2 Dependencies on phase 3's steps

Phase 4 runs beside phase 3's steps 3 to 10. It **adds to** phase 3's trust lists, by the names A-P3-1 lists, and changes no rule that phase 3 decides. Where it needs one of phase 3's rules, it waits.

| Phase 4 needs | From phase 3 | Phase 4 steps that wait |
| --- | --- | --- |
| `HUMAN_REQUIRED` and the frozen `HUMAN_COMMANDS` list in `late-identity` | The first of steps 3 to 7 that lands them | 1, 4, 6, 8, 9 |
| The rest of `OWNER_COMMANDS`, and the membership re-read | Step 4 | 1, 8, 9 |
| Two signed-in people in Chromium, one an owner | Steps 3 and 4 | The Chromium parts of E4, E5 and E6 |
| The `signed-out` notice and the revoked-session notice | Step 3 | 4, 5 |
| Persona emphasis in the palette's ranking | Step 5 | 6's ranking |
| `--phase` in `scripts/loam-exit-check.mjs`; phase 3's local exit tests | Step 9 | 11 |

Nothing in phase 4 waits on phase 6 (R1).

## 2. What phase 4 does not change

- **The access decision.** No setting, experiment, autonomy mode or persona is an input to `decideAccess`, `checkedCall`, the grants, the auth gate, line 0, or the owner and human checks (P4-E2).
- **Enforcement of autonomy.** Phase 4 stores, resolves and shows the policy; phase 5 enforces it (D41). Until then, D98's sentence on the consent screen stands, and the autonomy section says so (4.5).
- **Commands that exist.** `appearance-*`, `toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list`, `editor-close` and `view-state-* { id: 'loam.appearance' }` keep their names, inputs and results.
  - New fields are optional.
  - `overlay-dismiss` and `modal-open` narrow who may call them (6.5, R8). These are fixes, not new shapes.
- **The hosted lane.** No phase 4 code runs on `@lushly-dev/loam-host` ([section 13](#13-hosted-provider-deployments-d125)).

## 3. Settings (D116)

### 3.1 A section

```ts
export interface SettingSectionV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in the app. Its full id is `<plugin.id>.<id>`; the shell's are `loam.<id>`. */
	id: string;
	title: string;                    // 1 to 40
	description?: string;             // 1 to 200, plain text
	levels: Array<'person' | 'workspace' | 'project'>;   // at least one
	schema: SettingSchemaV1;
	requires_experiment?: string;     // 5.3
}

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

- **Every key has a default** inside its bounds (`MANIFEST_SETTING_DEFAULT`). A key's `levels` narrows its section's.
- **Refused shapes:** `pattern`, nesting, `$ref` and `oneOf` (`MANIFEST_SETTING_SCHEMA`). No regular expression an app supplies ever runs.
- **Size:** a section's resolved object is at most 16 KiB (`SETTING_TOO_LARGE`).
- **Text is plain.** A key named like a secret warns `MANIFEST_SETTING_SECRET`.
- **Mounted manifests** declare no section in phase 4 (`MANIFEST_SETTINGS_MOUNTED`).
- **At most 8 sections per app** (`MANIFEST_SETTINGS_LIMIT`).
- **The shell's own sections** may use three shapes this subset cannot express: an array of objects, and arrays of free instance ids. Each is rendered by a named custom editor ([3.7](#37-the-shells-own-sections)). An app cannot declare them.

### 3.2 Who writes a value

`settingWriteRule(section, key, level)` is one pure function. The handler, the owner check, the human check and the membership re-read all call it. **`level` is required on every write.**

| Level | Rule | Person | Agent interface | Port | MCP |
| --- | --- | --- | --- | --- | --- |
| `person` | `person` | Themselves | For its person. **The human keys** are `HUMAN_REQUIRED`: `loam.autonomy`, `loam.keybindings`, `loam.notifications.muted` and `loam.experiments` | `CALL_NOT_GRANTED` | Not served |
| `project` | `member` | Any member who may enter the project, for a key of an app enabled for it | **`HUMAN_REQUIRED`** ([Q4](#q4-may-a-persons-agent-write-project-level-settings)) | `CALL_NOT_GRANTED` | Not served |
| `workspace` | `owner` | An owner; anyone else gets `OWNER_REQUIRED` | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served |

- **The hand-off (F2).** `setting-*`, `autonomy-set` and `experiment-*` refuse a non-human caller **in their own handlers**, not through phase 3's central `HUMAN_COMMANDS` check, so the refusal is theirs: `HUMAN_REQUIRED` with `details: { route, section, key, level }`, and a suggestion naming the route. For example, `route` is `~/settings/hello.general#greeting`.
  - **For a setting,** `key` is the key.
  - **For autonomy,** `section` is `loam.autonomy` and `key` is the row id the call would write (`workspace/-/tally/tally-reset`), or `cap`.
  - **For an experiment,** `section` is `loam.experiments` and `key` is the experiment's `fullId`; `level` is `person` or `workspace`.
  - The agent can then tell its person exactly where to go.
  - Or it can push a notice whose `link` goes there (10.1).
- **How this fits phase 3's frozen lists.**
  - `notification-act` and `palette-run` join `HUMAN_COMMANDS` whole.
  - `setting-set`, `setting-reset`, `autonomy-set`, `experiment-enable` and `experiment-disable` refuse in their handlers, as phase 3's 3.4 does for `project-update { access }`, so that each gives its own hand-off.
  - The membership re-read gains `needsMembershipRead(command, input)` (A-P3-1).
- **No app writes a setting.**
- **Records carry who wrote them.** Every write records `updatedAt` and `updatedBy`, per key, in person records too. `updatedBy` is the person's id, or `agent:<id>` for an agent acting for them.
- **Writing safely:** `setting-set` and `setting-reset` take `expected?`, the value the caller read. A mismatch gives `SETTING_CONFLICT`, nothing written, which keeps undo and two tabs from overwriting each other.

### 3.3 Resolution

For key `k` of section `s`, for person `p` in scope `{ workspace, project? }`, the value is the first of these that applies:

1. `p`'s own value, if `k` may be set at `person` and `p` has set one;
2. the project's value, if a project is in scope and `k` may be set at `project`;
3. the workspace's value, if `k` may be set at `workspace`;
4. the schema's default.

`resolveSetting` is pure. It returns `{ value, from, updatedAt?, updatedBy? }`. A person's value applies in every project, which is why the UI labels that level **"You, everywhere"**. A stored value that no longer validates is skipped, with a warning.

### 3.4 Storage

- **Person values** are one record per person, `loam.settings`, in the view-state store's backing table. In `provider` mode it is keyed through `personalRecordId`. Its shape is `{ [sectionFullId]: { [key]: { value, updatedAt, updatedBy } } }`.
  - **`loam.settings` is not a view-state id.** `view-state-*` on it is refused with `VIEW_STATE_NOT_FOUND`, and `view-state-list` leaves it out.
- **Shared values** are rows of the workspace store's `setting` table, `<sectionFullId>/workspace` or `<sectionFullId>/project/<projectId>`, each with per-key `updatedAt` and `updatedBy`. Project rows are archived and restored with their project.

### 3.5 The settings section

- **Where:** `section-open { section: 'settings' }`, at `~/settings` and `~/settings/<sectionFullId>#<key>`.
- **What it shows:**
  - A tree: the shell's sections first (Appearance, Keybindings, Autonomy, Experiments, Notifications, Limits, Documents), then each enabled app's.
  - A level switcher: **You, everywhere**, **Workspace** and, while a project is active, **Project <name>**.
  - Each field with where its value comes from, who set it and when, and **Reset**.
- **A gated section** is absent while its experiment is off.
- **No app code runs here.**
- **Lazy:** the `settings` chunk.

### 3.6 Appearance taken over (D117)

- **The commands:** `appearance-get` and `appearance-set` read and write `theme` and `density` of `loam.appearance`, a person-level shell section. `view-state-* { id: 'loam.appearance' }` stays as an alias of **those two keys only**, so `SESSION_50` replays.
- **In `local` mode (R12):**
  - stage A paints from `loam.settings`;
  - the first stage B moves an old `loam.appearance` record into it, journaled as `setting-set` with `migrated: true`;
  - no `.last` record is kept, since there is one person or none;
  - signed out, the record is unsuffixed, as phase 2's records are.
- **In `provider` mode:**
  - **The profile's last appearance (R4).** `loam.appearance.last` holds only `theme` and `density`, and is written whenever a signed-in person's appearance is applied.
  - **Stage A and the signed-out page paint with it.** Once the probe answers with a person, that person's value applies.
  - **Migration** happens on the first signed-in stage B, never while signed out.
  - **Signed out, `appearance-set` writes `loam.appearance.last` only,** and the next signed-in person's own value replaces it on sign-in. Phase 3's `~signed-out` record holds nothing of appearance.
  - **Appearance is per person (A-P3-2).**

### 3.7 The shell's own sections

| Section | Levels | Keys | Editor |
| --- | --- | --- | --- |
| `loam.appearance` | person | `theme`, `density` | The form |
| `loam.rail` | person | `order`: up to 64 instance ids (R8) | `loam-rail-order-editor` |
| `loam.keybindings` | person, human | `overrides`: up to 64 `{ command, target?, keys: string \| null }` | `loam-keybinding-editor`, recording a chord by pressing it, and warning before it shadows a reserved chord or unbinds `Mod+K` |
| `loam.autonomy` | person, project, workspace | Section 4, written only by `autonomy-set` | The autonomy section |
| `loam.experiments` | person, human | Written only by `experiment-*` | The experiments list |
| `loam.notifications` | person | `toastSticky`: `'never' \| 'danger' \| 'always'`, default `'danger'`. `muted` (human): up to 64 instance ids | `loam-instance-picker` for `muted` |
| `loam.limits` | workspace | Section 11 | The form, with usage beside each key |
| `loam.documents` | workspace | `trashDays`: 1 to 365, default 30 (A-P2-2) | The form |

**What `muted` means:**

- A muted app's notices are stored, listed and counted as unread, but they are never announced and never shown as a toast.
- **Confirmations are never muted.**
- `shell` and `agent:*` cannot be muted (`SETTING_MUTE_SHELL`).

### 3.8 The `settings` grant

```ts
export interface SettingsV1 {
	get<T = unknown>(section: string, key: string): Promise<T>;
	section(section: string): Promise<Record<string, unknown>>;
}
```

- **What an app may read:** with the grant, `setting-get` and `setting-list` are callable through its port for its own sections only. Another app's section gives `SETTING_NOT_OWNED`.
- **Native apps** use `SettingsV1`. **Views** call the same commands through `tools/call`.
- **Hearing a change:** a native surface's `settingsChanged(sections)`; for a view, `ui/notifications/host-context-changed` with `{ "dev.loam/settingsChanged": [...] }`.

### 3.9 Commands

**Every input is a strict object:** an unknown property is a `VALIDATION_ERROR`, never ignored. `setting-*` takes its project only from the call's scope, never from the input. Each command declares an AFD `outputBudget`.

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `setting-schema-get` | query | `{ section?; key? }` | `{ sections }`, those the caller may see, gates applied. With `key`, that key's schema alone. Budget 16 KiB, and a caller past it is told to name a section |
| `setting-list` | query | `{ section?; level? }` | `{ values: Array<{ section; key; value; from; updatedAt?; updatedBy?; writable; reason? }> }`. **`writable` and `reason` are computed for the caller**: an agent sees `writable: false` with `reason: 'HUMAN_REQUIRED'` for a project-level key |
| `setting-get` | query | `{ section; key }` | `{ value; from; updatedAt?; updatedBy? }` |
| `setting-set` | mutation | `{ section; key; value; level; expected? }` | `{ value; from; previous }`. Undo: `setting-set` with `previous` and `expected` |
| `setting-reset` | mutation | `{ section; key; level; expected? }` | `{ value; from }` |

### 3.10 From the palette

`palette-search` gains rows of `kind: 'setting'`, each carrying:

- `name`: `<sectionFullId>.<key>`;
- `section` and `key`, as separate fields;
- `title` and `description`;
- `app`: the owning app's title.

`palette-search` gains an optional `kind: 'command' | 'document' | 'setting'` filter. Rows are ordered by score, then by name, so a result is deterministic. Choosing a setting row runs `section-open { section: 'settings', target }`. A project-only key is listed only while a project is active. The index is built in `late-settings`, never in first paint.

## 4. The autonomy section (D118)

### 4.1 The record

```ts
export type AutonomyModeV1 = 'suggest' | 'ask' | 'act';

export interface AutonomyRowV1 {
	id: string;                    // `<level>/<project or ->/<instance or *>/<command or *>`
	level: 'workspace' | 'project';
	project?: string;
	instance?: string;             // an enabled instance, or 'shell'; required with `command`
	command?: string;              // a command `instance` registers
	mode: AutonomyModeV1;
	ceiling?: AutonomyModeV1;      // the workspace's general row only
	orphan?: true;                 // set by the manifest's apply when `command` or `instance` no longer exists
	updatedAt: number; updatedBy: string;
}
```

- **A person's own cap** is `loam.autonomy.cap`, written only by `autonomy-set { level: 'person', cap }`.
- **D41's "approval of a plan or a capability within limits"** has no field here. Phase 5 adds the limit (a count, a budget or a plan reference) with its approvals ([section 18](#18-out-of-scope-and-the-seams-reserved)).

### 4.2 Resolution

`resolveAutonomy` is pure:

1. **Project rows,** when a project is in scope: the first of project and command, project and instance, project.
2. **Workspace rows:** the first of workspace and command, workspace and instance, workspace.
3. **The mode:** the project row's if there is one, else the workspace row's, else **the default** ([Q3](#q3-the-default-autonomy)):
   - `act` for a command that is not a mutation;
   - `ask` for a mutation;
   - `ask` for every mounted tool.
4. **Ceilings, when a project row decided the mode** (R2, R11). Lower the mode to each of these:
   - **the workspace's bound:** its `ceiling` if an owner set one, **else its general row's mode, else the default for this command**;
   - the workspace row for this instance;
   - the workspace row for this command.

   So no project loosens past what the workspace allows. An owner who wants projects to go further sets `ceiling` higher.

   **At write time (F8),** a project row is checked against the bound it will meet:
   - **a general or instance project row** against the workspace's `ceiling`, else its general row's mode, and **when neither is set, the strictest default, `ask`**, since such a row covers commands of every kind;
   - **a command project row** against those, the default for that command, and the workspace's rows for its instance and command.
5. **The person's cap.** Lower the mode to it.

**Orphan rows** are ignored, and flagged in `autonomy-list` and in a notice to the owners who may enter the row's project (all owners for a workspace row) (10.2).

The result is `{ mode, from, ceilings, cap, chain: Array<{ id; mode; as: 'mode' | 'ceiling' | 'cap' }> }`, with only rows of projects the caller may enter.

### 4.3 Who sets it

- **Workspace rows and the ceiling:** owners.
- **Project rows:** owners, and the project's creator **while the creator may enter the project** ([Q1](#q1-who-sets-a-projects-autonomy-within-the-owners-bounds)), within the bounds. For a project a team instance lists, owners only (D87, D110). Others get `OWNER_REQUIRED`.
- **The cap:** the person.
- **Every write is a human command.**
- **Check order (N9):**
  1. line 0;
  2. the project's access, so a project the caller may not enter gives `PROJECT_NOT_FOUND`, byte-identical to phase 2's;
  3. the owner check;
  4. the instance and command must exist (`AUTONOMY_COMMAND_UNKNOWN`);
  5. the bounds (`AUTONOMY_ABOVE_CEILING`).

### 4.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `autonomy-get` | query | `{ command; instance?; project? }` or `{ commands: Array<{ command; instance? }> /* 1 to 50 */; project? }` | One result, or `{ results }` in the same order. **The project:** the input's when given, otherwise the call's scope. A project the caller may not enter, or that does not exist, gives `PROJECT_NOT_FOUND` |
| `autonomy-list` | query | `{ level?; project? }` | `{ rows; ceiling; cap }`, only rows of projects the caller may enter, orphans flagged. A `project` the caller may not enter, or that does not exist, gives `PROJECT_NOT_FOUND` |
| `autonomy-set` | mutation, human | `{ level: 'workspace' \| 'project'; project?; instance?; command?; mode?: AutonomyModeV1 \| null; ceiling? } \| { level: 'person'; cap }` | `{ row?; cap?; previous }` |

### 4.5 What phase 4 shows, and what phase 5 does

- **In phase 4 the policy is advisory.** The autonomy section says, above its rows: "Agents can read this. Loam enforces it from phase 5." E13 checks that text.
- **An agent that reads `ask`** asks through a confirmation (7.2) or in its own chat, and never through a prompt (R8).
- **Phase 5** calls `resolveAutonomy` before every call the copilot or the agent interface makes:
  - `act` runs;
  - `ask` raises a confirmation;
  - `suggest` returns a suggestion.

## 5. Experiments (D119)

### 5.1 The declaration

```ts
export interface ExperimentV1 {
	id: string;                  // `^[a-z0-9][a-z0-9-]{0,39}$`; full id `<plugin.id>.<id>`
	title: string;               // 1 to 60
	changes: string;             // 1 to 400, plain text
	ends: string;                // `YYYY-MM-DD`
	stage: 'hidden' | 'visible' | 'graduated' | 'removed';
}
```

- **`ui.experiments`**, at most 8 per app.
- **`hidden`:** listed to nobody and off. The exception is `experiment-list { hidden: true }` in `local`, for authors.
- **`visible`:** off until enabled.
- **`graduated`:** on for everyone.
- **`removed`:** off for everyone.
- **When a manifest is applied** (stage B's read, or an instance refresh), the internal, journaled `experiment-settle` **deletes the enablements of every experiment now `removed`, or no longer declared** (I6). A re-shipped id revives nothing.
- **`ends`** in the past warns `EXPERIMENT_OVERDUE`. Nothing turns off on a date.

### 5.2 Enablement

- **Per person:** a human command, in `loam.settings`.
- **Per workspace:** an owner's, in `experiment-enablement`.
- **Each enablement stores the SHA-256 of `changes` as it was shown.** A new digest counts as off until re-enabled.
- **On for a person** when any of these holds:
  - the experiment is `graduated`;
  - it is `visible`, and the person enabled it with the current digest;
  - it is `visible`, the workspace enabled it with the current digest, and the person has not opted out ([Q2](#q2-may-a-person-opt-out-of-a-workspace-enabled-experiment)).
- **Notices (10.2).** The shell pushes a notice to each affected person when:
  - an owner turns a workspace enablement on or off;
  - a digest change turns an enablement off;
  - an enabled experiment is removed.

### 5.3 Gates

- **What can be gated:** `requires_experiment: "<fullId>"` on `ui.surfaces.<surface>`, a settings section, or `app`.
- **A gate decides presence, never permission.**
  - A gated surface is not created.
  - A gated app is listed with `state: 'gated'`, and its commands are not registered.
  - `app-get` reports `gates: { [surface]: { experiment, open } }` (A-P1-2).
- **When enablement changes,** `experimentsChanged` re-renders the shell, and `app-instance-refresh` loads or unloads a gated app.
- **Unloading never loses work (R14):**
  - **A dirty tab** of the app's document types keeps the app loaded until the tab is saved or discarded.
  - **The person's own change** (`experiment-disable`, or an opt-out) is refused with `EDITOR_TAB_DIRTY`, naming the tab, while such a tab is open.
  - **An unload someone else caused** (an owner's change, a digest change, a removal) is **deferred**: the app unloads when its last dirty tab closes, and the person is told by a notice.
  - **Open dialogs** of the app are cancelled.
  - **Pending confirmations** for its commands end as `withdrawn`.
- **Replay:** `experimentOn` reads the store and the manifest only.

### 5.4 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `experiment-list` | query | `{ experiment?; hidden?: true }` (`hidden` in `local` only) | `{ experiments: Array<{ fullId; owner; title; changes; ends; stage; on; by; workspace: boolean; changed; overdue }> }` |
| `experiment-check` | query | `{ experiment }` | `{ on; by }`. Unknown and `hidden` ids answer the same bytes |
| `experiment-enable` | mutation, human; owner for `workspace` | `{ experiment; audience }` | `{ on; by }` |
| `experiment-disable` | mutation, human; owner for `workspace` | `{ experiment; audience }` | `{ on; by }`, or `EDITOR_TAB_DIRTY` |

## 6. The overlay manager (D121)

### 6.1 Kinds and the policy table

| Kind | Opened by | Lifetime | On app switch | Placement | Limit |
| --- | --- | --- | --- | --- | --- |
| toast | `toast-show` | Timed, 1 to 30 s; `sticky` never times out | Dismissed. Sticky ones, and those `toastSticky` selects, also land in the inbox | The toast region | 5 on screen; a sixth dismisses the oldest |
| popover | `popover-open` | Light dismiss | Closed | Anchored, top layer | One per invoker |
| dialog | `dialog-open` | Until closed | Parked and restored; with `cancelOnLeave`, cancelled | Top layer, non-modal | 3 per instance (`OVERLAY_LIMIT`) |
| modal | `modal-open` | Until closed | Cancelled | Top layer, the rest inert | **The overlay slot** |
| prompt | `prompt-open`, `palette-run`, a confirmation in the slot, the close prompt | Until answered | Cancelled | As a modal, in the slot | The slot |
| global | The internal `overlay-global-set` | Until its condition ends | Survives | Top layer, a strip under the title bar | One per id |

**Who may open which kind, on each path (R8):**

| Path | toast | popover | dialog | modal | prompt | `palette-run` |
| --- | --- | --- | --- | --- | --- | --- |
| A human gesture | Shell-owned | Shell-owned | Shell-owned | Shell-owned | Shell-owned | Shell-owned |
| The active app's port, or the active tab owner's | The app's | The app's | The app's | The app's | The app's | `CALL_NOT_GRANTED` |
| An inactive app's port | The app's | `OVERLAY_OWNER_INACTIVE` | `OVERLAY_OWNER_INACTIVE` | `OVERLAY_OWNER_INACTIVE` | `OVERLAY_OWNER_INACTIVE` | `CALL_NOT_GRANTED` |
| **The agent interface** | `agent:<id>`'s | **`HUMAN_REQUIRED`** | **`HUMAN_REQUIRED`** | **`HUMAN_REQUIRED`** | **`HUMAN_REQUIRED`** | **`HUMAN_REQUIRED`** |

- **Agent toasts (F7)** count against the agent's push rate, 5 a minute (10.2), and **never evict a shell toast or a `danger` toast**: when the region is full of those, the agent's toast is refused `RATE_LIMITED` with `details: { limit: 5, retryAfterMs }`, rather than pushing one off screen.
- **Why agents get toasts only.** An agent's refusal suggests a confirmation, by calling the command itself, or `notification-push`. So an agent never puts anything in the slot, and everything it asks waits in the inbox (R3).
- **The kernel's own prompts** (7.1 to 7.3) are owned by `SHELL_OWNER` and carry `for: { command, caller }`, set by the kernel alone.
- **The slot:** while it is held, `modal-open`, `prompt-open` and `palette-open` give `OVERLAY_MODAL_BUSY`, and nothing runs.

### 6.2 The state machine

- **States:** every overlay is `open`, `parked` (dialogs only) or `closed`.
- **Reasons:** each move carries one of `'user' | 'timeout' | 'app-switch' | 'cap' | 'park' | 'restore' | 'person' | 'replaced' | 'inbox' | 'withdrawn'`. `'replaced'` covers both:
  - a popover replaced on its invoker;
  - an input prompt replaced in the slot by its command's confirmation (7.1).
- **Replay** reproduces every move.

### 6.3 Placement and the platform

Toasts use phase 1's region; popovers use `popover="auto"` with anchor positioning; dialogs use `show()`; modals and prompts use `showModal()`. `closedby` and `popover="hint"` are not used.

An anchor is `{ surface; anchor }`. `anchor` is a `data-loam-anchor` value inside the owner's surface, and an anchor that cannot be resolved gives `OVERLAY_ANCHOR_NOT_FOUND`.

### 6.4 Content

| Kind | Content |
| --- | --- |
| toast | Phase 1's, plus `sticky?` and `link?` |
| popover | `{ kind: 'info'; title?; body }`, or `{ kind: 'menu'; items }`, the owner's own palette commands, never a human or owner command (`OVERLAY_ITEM_RESERVED`) |
| dialog | `{ title; body?; actions?; element?; cancelOnLeave? }` |
| modal | Phase 1's, plus `actions?` and `element?` |
| prompt | `{ title; body?; schema?; value?; confirmLabel?; cancelLabel?; danger? }`. The input has no `for` |

`OverlayActionV1`: up to 3, `{ id; label; tone?; default? }`. A result is `{ result; value? }`. An `element` is for native apps only (`OVERLAY_ELEMENT_VIEW`).

### 6.5 Who may answer

`isHumanGesture(context)` holds when the call came through the chrome or the palette interface, has no `caller`, and its actor is absent or anything but `agent` (R7). A confirm or an action, as opposed to `cancel` or `dismissed`, is accepted:

| Overlay | From |
| --- | --- |
| The shell's (`SHELL_OWNER`) | A human gesture |
| An app's own | A human gesture, or its owning app |
| An agent's toast | A human gesture |

Anything else may only cancel or dismiss, with one exception (F6):

- **A `SHELL_OWNER` overlay is closed only by a human gesture, or by the caller named in its `for.caller`** (an app cancelling the confirmation it raised in the slot). The agent interface, and any other port, get `HUMAN_REQUIRED` even for a cancel.
- **When the raising caller cancels its own confirmation, the outcome is `withdrawn`,** which never opens the decline window.

A confirm from anyone but a human gesture gives `HUMAN_REQUIRED`, and nothing runs.

### 6.6 Whose overlay it is

- **App overlays** show "From <app>".
- **Agent toasts** show "From <agent label>, for <person>".
- **Confirmations** carry the shell's header (7.2).
- **The shell's own** carry nothing.
- **An app's `title`** may not contain "Loam" as a word (`MANIFEST_TITLE_RESERVED`).

### 6.7 Focus and the toast region

- Focus returns to the invoker, and modals and prompts trap focus.
- The toast region is an F6 stop while it holds a toast.
- A sticky toast's **Open inbox** opens the inbox at it.

## 7. Prompts (D122)

### 7.1 The palette's input prompt (#869)

**`palette-run` is human only (R8):** `HUMAN_REQUIRED` from the agent interface, and `CALL_NOT_GRANTED` from a port.

1. **`palette-run { command }`** opens a shell-owned prompt for the command's input and returns `{ prompt: OverlayRefV1 }`.
2. **`palette-run { command, prompt, input }`** fills the open prompt `prompt` opened for the same `command`, and validates the input. A `prompt` that is not open, or was opened for another command, gives `OVERLAY_NOT_FOUND`, and nothing runs.
   - **On a failure,** the prompt stays open, showing the error.
   - **If the command declares `confirm_prompt`, its confirmation replaces the input prompt in the slot** (`reason: 'replaced'`, R15), showing the collected input. Confirm runs the command.
   - **Otherwise,** it runs the command through the palette interface.

**What the palette lists:** the `expose.palette` commands of every app that is enabled for the active scope and loaded, ranked by the active app first, then the active tab's owner, then the rest, then persona. Each row carries `app`, the app's title (A-P0-1, A-P1-1).

**The inbox from the palette:** "Open inbox" (`section-open { section: 'inbox' }`) is a palette row.

### 7.2 `confirm_prompt` and confirmations

**How this relates to AFD.** AFD's `confirmPrompt` is a frontend's declaration, and AFD enforces it only on MCP, answering `CONFIRMATION_DECLINED` and `CONFIRMATION_REQUIRED` ("repeat with `confirm: true`"). Loam's kernel is the frontend and enforces it in process.

- **`CONFIRMATION_DECLINED`** keeps AFD's meaning.
- **`CONFIRMATION_REQUIRED` is not used** (R9). Its AFD meaning does not fit.
- **A `confirm: true`** never confirms in Loam. In an input, the strict schema refuses it with a suggestion naming `confirmation-get`. In `_meta`, it is ignored.
- **Phase 4 declares no AFD `approval`.**

`commands[].confirm_prompt` is allowed in a native or view manifest: plain text, 1 to 200 characters. A mounted tool's stays refused.

**Where a confirmation waits (R3, R9):**

| Caller | What happens |
| --- | --- |
| A human gesture | A prompt in the slot, and the call waits for the answer. A held slot gives `OVERLAY_MODAL_BUSY`, and nothing runs |
| The active app's port, or the active tab owner's | The same, with the header "Tally asks to run Reset count" |
| **An agent, or an inactive or background app** | **The call returns at once:** `CONFIRMATION_PENDING`, retryable, `details: { notification, expiresAt }`. A pending confirmation waits in the inbox (10.1), announced and never shown as a modal |

**The order of a call (F9).** For a command with a `confirm_prompt`, from any caller:

1. strict validation of the input;
2. line 0;
3. `decideAccess`, and the calling app's grants;
4. the decline window (below);
5. a pending confirmation, or the slot;
6. the handler.

So no confirmation is raised for invalid input, and a project the caller may not enter answers `PROJECT_NOT_FOUND` before any `CONFIRMATION_PENDING` could reveal it.

**The confirmation's key (F4)** is (caller, command, input digest, scope). The repeat rule and the decline window both key on it, so an app's and an agent's identical calls, or the same call in two projects, never share one.

**The pending path:**

- **The header,** drawn by the shell: "Requested by <agent> for <person>, in <project>", or "Tally asks to run … in <project>". The app's `confirm_prompt` text sits beneath it, together with the input.
- **Confirmed by a human gesture,** through `notification-act { answer: 'confirm' }` or the inbox's button:
  - the shell re-checks the requesting actor's access in the confirmation's scope (line 0 and `decideAccess`);
  - if access fails, the confirmation ends `declined`, with `reason: 'access'`;
  - the re-check is **the same chain as steps 2 and 3**: line 0, `decideAccess`, the app's grants, and whether the app is still enabled for the project and loaded;
  - if it passes, **the shell runs the call itself, as approved, once**: the same actor, command, input and scope, journaled with the confirmation's id.
  - The outcome is stored on the confirmation.
- **The caller reads its state and outcome** with `confirmation-get`: `{ state: 'pending' | 'confirmed' | 'declined' | 'expired' | 'withdrawn'; result?: CommandResult; expiresAt }`. A caller may read only confirmations it raised.
- **A re-call on the same key until `expiresAt` (F5)** never raises a second confirmation. It returns the stored state: `CONFIRMATION_PENDING` while pending; the stored outcome once `confirmed` (the result of the one run); `CONFIRMATION_DECLINED` once declined. After `expiresAt`, a re-call raises a new one.
- **`confirmation-withdraw { notification }`** by the caller ends it as `withdrawn`. So do:
  - an unload of the app (R14);
  - a change of person.

  **`withdrawn` never opens the decline window.**
- **Expiry:** a pending confirmation expires after 10 minutes, ending as `expired`. A re-call after that raises a new one. **`CONFIRMATION_EXPIRED`** is what `confirmation-get`'s `result` holds for it.
- **Limits:** at most 5 pending per caller. A sixth gives `RATE_LIMITED`, with `details: { limit: 5, retryAfterMs }`, the time until the earliest of them expires.
- **Grouping (R16):** a confirmation carries `group?`, the agent's run, set by phase 5. Confirming or declining a whole group is phase 5's ([section 18](#18-out-of-scope-and-the-seams-reserved)).
- **The decline window (R16, F4):** after a decline, for 60 seconds, a call on the same key is refused with `CONFIRMATION_DECLINED` without asking. The inbox lists it as "Declined automatically". Only a human gesture is exempt (N8), so an active app's port, which carries a copied human actor, is held back too.
- **Over MCP** no app command is served (D104).
- **Replay** answers from the journal.

### 7.3 The close prompt (#881)

**Only the person's own close opens it:** a human gesture's `editor-close`, or the tab's close button. An agent's or a port's `editor-close` gets phase 2's `EDITOR_TAB_DIRTY`, as today, with no modal.

The prompt has three actions:

- **`save`** (the default): runs the editor's `save()`;
- **`discard`** (danger): closes without saving;
- **`cancel`, or Escape:** keeps the tab.

A human gesture answers. This amends phase 2's 5.5 (A-P2-1).

## 8. Keybindings, version 1 (D123)

### 8.1 What a binding is

```ts
export interface KeybindingV1 {
	keys: string;          // one chord, or two separated by a space: "Mod+G P"
	command: string;
	target?: string;       // for `section-open`
	when?: string;         // `editor`, `sidebar`, `main`, `project`, `!project`, `documentType == <type>`, joined by " && "
}
```

- **Sequences:** a sequence's first chord has `Mod` and is never a reserved chord. It waits 1,500 ms for the second.
- **Precedence:** overrides, then the reserved chords, then the active app's, then the active tab owner's.

### 8.2 Matching a key (#877)

`event.key` is matched when it is a single Latin letter or digit; otherwise `event.code`. Function keys match `event.code`.

### 8.3 A person's overrides

- **Overrides** rebind or unbind any binding but `F6`, `Shift+F6` and `Escape` (`KEYBINDING_RESERVED`).
- **Warnings:** `loam-keybinding-editor` warns before shadowing a reserved chord or unbinding `Mod+K`.
- **Overrides are human (3.2).**

### 8.4 The reserved chords, version 1

Phase 0's seven, plus `Mod+Alt+P` for the project switcher (#857). P4-E9 asserts that the page receives it in Chromium. `Mod+,`, `Mod+Shift+I` and `Mod+Alt+T` were dropped as browser or desktop chords.

### 8.5 Commands

`keybinding-list { command?; target?; all?: boolean }` returns the bindings in force (with `all`, also the shadowed ones), ordered by keys: `{ bindings: Array<KeybindingV1 & { source: 'shell' | 'app' | 'you'; app?: string; shadowed?: Array<{ source; command }>; active: boolean }> }`. `keybinding` joins the shell's domains.

### 8.6 Chords inside a view

Loam forwards no keys from a view. The person leaves a view with Tab, and phase 1's follow-up closes as decided.

## 9. Menus (deferred, D127)

**Menus are deferred to a specification of their own.** Phase 4 wrote no job for them, and the job-list walk found none.

- `ui.menus` stays refused at load. Its refusal names "a later specification" in place of phase 4 (A-P1-2).
- The `menu` popover kind (6.4) stays: an app may open its own menu of its own commands from its own surface.

## 10. The inbox (D120)

### 10.1 The record

```ts
export interface NotificationV1 {
	id: string;                    // `ntf_` and 16 of [a-z0-9]
	workspace: string;
	person: string;
	source: string;                // see below
	kind: 'notice' | 'confirmation';
	title: string;                 // 1 to 120
	body?: string;                 // 1 to 1000
	tone: 'info' | 'success' | 'warning' | 'danger';
	link?: ResourceLinkV1;
	action?: { command: string; label: string; input?: object };
	state?: 'done';                // a notice whose action ran
	confirmation?: { command; caller; input; group?; expiresAt; state; reason?; result? };   // kernel only
	scope: ScopeV1;
	createdAt: number; readAt?: number; archivedAt?: number;
}
```

- **`source` is derived, never given:**

  | Path | `source` |
  | --- | --- |
  | A port | Its instance |
  | The agent interface | `agent:<id>` |
  | The shell's own code | `'shell'` |
  | A human gesture's `notification-push` | `'shell'` (a person's reminder to themselves) |

- **Who can read it:** only its person and their agents. Reads are filtered by `decideAccess` on `scope`.
- **Actions:**
  - An action must be the source app's own palette command: another app's is `NOTIFICATION_ACTION_FOREIGN`, and a human or owner command is `OVERLAY_ITEM_RESERVED`.
  - **An agent's notice carries no action** (`NOTIFICATION_ACTION_UNAVAILABLE`), but it may carry a `link`.
  - `notification-act` runs the action as the person and marks the notice `done` and read.
- **Pending confirmations are protected (R10):**
  - a caller that isn't a human gesture cannot read-mark or archive one (`HUMAN_REQUIRED`);
  - confirmations do not count against the unread quota.
- **Quota:**
  - 500 per person;
  - unread notices are never dropped;
  - a push past 500 unread notices gives `QUOTA_EXCEEDED`, with `details: { kind: 'notifications', limit: 500 }`.

### 10.2 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `notification-push` | mutation | `{ title; body?; tone?; link?; action? }` | `{ notification }` |
| `notification-list` | query | `{ cursor?; unread?; source?; kind?; limit?: 1..100, default 20; body?: boolean }` | `{ notifications; cursor; unread }`, newest first, ties by id. `body` and a confirmation's `input` only with `body: true`. Budget 32 KiB |
| `notification-read` | mutation | `{ notification } \| { all: true; source? }` | `{ read }`. Pending confirmations are skipped unless the caller is a human gesture |
| `notification-archive` | mutation | `{ notification } \| { all: true; source? }` | `{ archived }`, with the same protection |
| `notification-act` | mutation, human | `{ notification; answer?: 'confirm' \| 'decline' }` | The action's result with `state: 'done'`, or `{ state }` |
| `confirmation-get` | query | `{ notification }` | `{ state; reason?; result?; expiresAt }`, for the caller that raised it |
| `confirmation-withdraw` | mutation | `{ notification }` | `{ state: 'withdrawn' }`, for the caller that raised it |

- **Rates:** 10 pushes a minute per source, and **5 for an agent**. Sticky toasts count. A push past the rate gives `RATE_LIMITED`, `details: { limit, retryAfterMs }`, and the suggestion says the rate is fixed.
- **The shell pushes** notices for:
  - a sticky toast;
  - an unseen failed autosave;
  - phase 3's revoked session;
  - the experiment changes of 5.2;
  - a deferred unload;
  - an orphan autonomy row, to the owners who may enter its project;
  - an app refused by a limit, to owners, once a window (11).
- **`confirmation-get` and `confirmation-withdraw`** are callable by the agent interface and by the raising app's port. `confirmation` joins the shell's domains.

### 10.3 The section

`section-open { section: 'inbox' }`, at `~/inbox`, also reachable from the palette's "Open inbox". The title bar's bell shows the unread count, and pending confirmations sort first. The announcement for a new confirmation says "Open it from the bell or the palette."

## 11. Limits (#710, in part, D124)

| Key | Default | Bounds | Enforced at | Refusal |
| --- | --- | --- | --- | --- |
| `messageBytes` | 1,048,576 | 65,536 to 8,388,608 | The view broker | The message is dropped; the frame is told `INPUT_TOO_LARGE` |
| `inputBytes` | 262,144 | 16,384 to 1,048,576, **at most a quarter of `journalEntryBytes`** | Ports and brokers (A-P2-3) | `INPUT_TOO_LARGE`, `details: { limit }` |
| `callsPerSecond` | 50, burst 200 | 5 to 500 | Per instance | `RATE_LIMITED`, `details: { limit, retryAfterMs }` |
| `storeBytes` | 26,214,400 | 1,048,576 to 268,435,456 | The `store` grant | `QUOTA_EXCEEDED`, `details: { kind: 'store', limit, used }` |
| `journalEntryBytes` | 1,048,576 | 262,144 to 4,194,304 | The journal sink, **on the whole entry**: one larger is kept truncated and marked `unreplayable` | None |

- **Fail closed:** the defaults are enforced from boot.
- **The bounds hold each other.** A write that breaks the quarter rule gives `VALIDATION_ERROR`. Its suggestion names the order: lower `inputBytes` before `journalEntryBytes`; raise `journalEntryBytes` before `inputBytes`.
- **Replay stops at an unreplayable entry,** with `REPLAY_ENTRY_TRUNCATED`.
- **Usage (F3):**

  | Command | Kind | Input | Result data |
  | --- | --- | --- | --- |
  | `limit-usage-get` | query, owner (`OWNER_REQUIRED` for others, `HUMAN_REQUIRED` from an agent, in its handler) | `{ instance? }` | `{ instances: Array<{ instance; storeBytes: { used; limit }; refusals: { messageBytes; inputBytes; callsPerSecond; storeBytes; journalEntryBytes } }> }`, ordered by instance. `refusals` counts each of this section's limits in the last hour |

  The shell notifies owners the first time an instance is refused in an hour. `limit` joins the shell's domains.
- **Not answered:**
  - the journal's total and origin budget;
  - retention;
  - `QuotaExceededError`.

  These are deferred by name, and #710 stays open.

## 12. The kernel and the SDK

- **Kernel interface version 4.** `APP_CALLABLE_SHELL_COMMANDS_V2` adds:
  - `popover-open`, `dialog-open` and `prompt-open`;
  - `experiment-check`;
  - `notification-push`;
  - `confirmation-get` and `confirmation-withdraw`;
  - `setting-get` and `setting-list`, for the app's own sections.
- **SDK (a minor):** `SettingsV1`, `NotificationsV1`, `ConfirmationsV1 { get, withdraw }`, the widened `OverlaysV1`, and `settingsChanged`.
- **New shell domains:** `keybinding`, `confirmation`, `limit`.
- **New commands:** `palette-run`, `notification-act`, `notification-archive`, `confirmation-get`, `confirmation-withdraw`, `autonomy-list`, `setting-reset`, `keybinding-list`, `limit-usage-get`.
- **Internal commands:** `overlay-global-set`, `experiment-settle`, `store-usage-settle`.

### 12.1 The manifest

| Key | Rule | Codes |
| --- | --- | --- |
| `ui.settings` | 3.1 | `MANIFEST_SETTING_SCHEMA`, `MANIFEST_SETTINGS_LIMIT`, `MANIFEST_SETTINGS_MOUNTED`, `MANIFEST_SETTING_DEFAULT`; `MANIFEST_SETTING_SECRET` warns |
| `ui.experiments` | 5.1 | `MANIFEST_EXPERIMENTS_LIMIT`, `MANIFEST_EXPERIMENT_DATE`; `EXPERIMENT_OVERDUE` warns |
| `requires_experiment` | 5.3 | `MANIFEST_EXPERIMENT_UNKNOWN` |
| `commands[].confirm_prompt` | 7.2 | For a mounted tool, still `MANIFEST_CONFIRM_UNAVAILABLE` |
| `ui.surfaces.keybindings[]` | 8.1 | `MANIFEST_KEYBINDING_KEYS`, `MANIFEST_KEYBINDING_WHEN`, `MANIFEST_KEYBINDING_RESERVED` |
| `plugin.title` | 6.6 | `MANIFEST_TITLE_RESERVED` |
| `ui.menus` | Section 9 | Still refused, naming a later specification |

## 13. Hosted `provider` deployments (D125)

**Phase 4 exits locally and runs nothing on the hosted server (R1).**

**Until a later step serves them,** a hosted `provider` deployment refuses these writes with **`SHARED_RECORD_UNAVAILABLE`**. Each refusal is journaled, and nothing is written:

| Command | Refused when |
| --- | --- |
| `setting-set`, `setting-reset` | `level` is `workspace` or `project` |
| `autonomy-set` | **Every level, the person's cap included** |
| `experiment-*` | `audience` is `workspace` |

- **The cap is refused,** because it must bind connected agents, and so it will be a server record. The autonomy section says so in place of the cap's field.
- **Never a silent write to the browser's copy.**
- **What does succeed:**
  - person-level `setting-set` and `setting-reset`;
  - person experiment enablements;
  - the inbox;
  - confirmations.

**The step that brings these records to the server is phase 5's "shell commands over MCP"**, because enforcing autonomy needs them there. Its specification must:

1. **Route by input** on the server, in phase 6's 6.2 transport, step 4, using `settingWriteRule` and the `level` and `audience` predicates. The server takes person-level writes only for the cap (`autonomy-set { level: 'person' }`) and person experiment enablements, which obligation 2 makes server records; it refuses every other person-level write.
2. **Hold the cap and person enablements as server records** (B5), and **move each browser's person enablements and cap there once**, by a journaled settle on the first stage B after it lands.
3. **Follow phase 6's A6:** the browser's agent interface gets `HUMAN_REQUIRED` for every routed write before any request, since the transport always takes the human. Agents write these over MCP as connected agents, under Q4's answer.
4. **Name the agent owner line** for connected agents' toasts and notices, and keep their notices free of actions.
5. **Extend phase 6's lists:**
   - `SERVER_COMMANDS` gains the routed writes;
   - `HOSTED_MCP_COMMANDS` gains `setting-schema-get`, `setting-list`, `setting-get`, `autonomy-get`, `autonomy-list`, `experiment-list` and `confirmation-get`, for the token's person, the cap included;
   - `TrustRecordSnapshotV1` gains shared settings rows, autonomy rows and workspace enablements, each filtered to projects the person may enter, within its 2 MiB cap.
6. **Apply the relay's message limit,** the smaller of `request_body_bytes` and `messageBytes`.
7. **Record by input for replay,** amending phase 6's A5.

## 14. Budgets

These are estimates, under D115.

| Step | First-paint parts | Estimate (bytes, gzip) |
| --- | --- | --- |
| 1 | Stage A reads `loam.settings`, and `loam.appearance.last` in `provider` mode | 450, 180 |
| 3 | The toast region's F6 stop and owner line | 300, 120 |
| 7 | The key matcher | 600, 250 |
| **Total** | | **about 1,350, 550** |

| Row | Estimate |
| --- | --- |
| `late` | +5,000 |
| `late-settings` (new) | 26,000 |
| `settings` (new), with three custom editors | 36,000 |
| `inbox` (new) | 10,000 |
| `overlays` (new) | 11,000 |
| `apps` | Measured by step 2 |

## 15. Accessibility

- **The settings section:** a `tree` and a form; the level switcher is a tab list, labelled "You, everywhere", "Workspace" and "Project <name>".
- **Overlays:** popovers are `menu` or `dialog`; modals and prompts are `aria-modal`; a confirmation's header is part of its name.
- **The inbox:**
  - the bell's name includes the unread count;
  - **the keyboard path from an announcement:** Tab to the bell in the title bar, or Mod+K and "Open inbox";
  - Confirm and Decline name the command.
- **The keybinding editor** announces the recorded chord and any shadowing.
- **Checks:** axe WCAG 2.2 AA in three themes, and Specimen. #708's screen-reader pass is manual.

## 16. Failure modes and error codes

| Code | When | Retryable | Suggestion |
| --- | --- | --- | --- |
| `SETTING_NOT_FOUND` | An unknown or gated section or key | No | List the sections with `setting-schema-get` |
| `SETTING_LEVEL_UNAVAILABLE` | A level the key does not allow | No | Names the allowed levels |
| `SETTING_PROJECT_REQUIRED` | `project` level with no project in scope | No | Make the call in the project's scope: `_meta` `dev.loam/scope` over MCP, or the call's `scope` option in process |
| `SETTING_TOO_LARGE` | A section over 16 KiB | No | Shorten the longest values |
| `SETTING_NOT_OWNED` | An app reads another app's section | No | Read only this app's own sections |
| `SETTING_USE_AUTONOMY` | `setting-*` on `loam.autonomy` or `loam.experiments` | No | Use `autonomy-set` or `experiment-enable` |
| `SETTING_MUTE_SHELL` | Muting `shell` or an agent | No | Mute an app instead |
| `SETTING_CONFLICT` | `expected` differs from the stored value | Yes | Read the value again, then decide |
| `SHARED_RECORD_UNAVAILABLE` | Section 13 | No | Set it in a local deployment, or wait for the release that serves it |
| `AUTONOMY_ABOVE_CEILING` | A row above a bound | No | Names the bound, and says an owner sets it |
| `AUTONOMY_COMMAND_UNKNOWN` | A row naming no registered command or instance | No | List the app's commands with `app-command-list` |
| `EXPERIMENT_NOT_FOUND` | An unknown, hidden or removed id | No | List with `experiment-list` |
| `EXPERIMENT_NOT_OWNED` | Checking another app's experiment | No | Check only this app's own |
| `OVERLAY_ANCHOR_NOT_FOUND` | An anchor that cannot be resolved | No | Set `data-loam-anchor` on the invoker |
| `OVERLAY_ELEMENT_VIEW` | `element` from a view | No | Use text, actions or a prompt |
| `OVERLAY_LIMIT` | A fourth dialog | No | Close one first |
| `OVERLAY_NOT_FOUND` | `palette-run` naming a prompt that is not open for that command | No | Open it again with `palette-run { command }` |
| `OVERLAY_ITEM_RESERVED` | An action or menu item that is a human or owner command | No | Let the person run it from the palette |
| `NOTIFICATION_ACTION_FOREIGN` | An action naming another app's command | No | Use one of this app's own commands as the action |
| `NOTIFICATION_ACTION_UNAVAILABLE` | An agent's notice with an action | No | Push it with a `link` instead, or call the command for a confirmation |
| `CONFIRMATION_PENDING` | A confirmation from an agent or a background app is waiting | Yes | Tell the person it is in their inbox; read it with `confirmation-get` |
| `CONFIRMATION_DECLINED` | Declined, or declined within 60 s for the same input | No | Ask the person before trying again; do not repeat the call |
| `CONFIRMATION_EXPIRED` | In `confirmation-get`'s `result`, after 10 minutes unanswered | No | Ask the person, then call again to raise a new one |
| `HUMAN_REQUIRED` (from these commands) | A human-only write or answer | No | Names the route; `details: { route, section, key, level }` |
| `KEYBINDING_RESERVED` | Overriding F6, Shift+F6 or Escape | No | Bind another key |
| `INPUT_TOO_LARGE` | Section 11 | No | Send less, or ask an owner to raise `loam.limits.inputBytes` |
| `RATE_LIMITED` | Calls, pushes or pending confirmations over their rate. Always `details: { limit, retryAfterMs }` | Yes | For calls: wait, then retry; an owner sets `loam.limits.callsPerSecond`. For pushes: wait; the rate is fixed. For confirmations: wait for one to be answered or expire |
| `QUOTA_EXCEEDED` | A store or the notifications over their quota | No | Delete what this app no longer needs, or archive notifications |
| `REPLAY_ENTRY_TRUNCATED` | A replay reaches an `unreplayable` entry | No | Replay up to the named entry only |

## 17. Security

- **No new grant** (P4-E2).
- **Autonomy only goes up through a person,** within the workspace's bounds. No project loosens past the workspace's own mode unless an owner raises its ceiling. A cap only lowers.
- **Only a human gesture confirms.** Agents may open toasts only. An agent's or a background app's confirmation never takes the slot. The shell runs an approved call itself, after re-checking access.
- **Pending confirmations cannot be hidden** by an agent.
- **Nothing passes for the shell or for someone else.**
- **Limits fail closed,** and bound each call, not the journal's total.
- **No secrets, and no regular expressions from apps.**
- **The hosted lane** refuses shared writes until phase 5.

## 18. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam |
| --- | --- | --- |
| Enforcing autonomy; approvals of a plan or a capability **within limits, with the limit's field on the row**; approval-health metrics | Phase 5 (D41) | `resolveAutonomy`, confirmations, `chain` |
| **Untrusted labels** on tool results and mounted content in the copilot (D41) | Phase 5 | None in phase 4 |
| Confirming or declining a whole run's confirmations at once, by `group` | Phase 5 | `confirmation.group` |
| Shared records on the hosted server, and their MCP reads | Phase 5's shell commands over MCP | Section 13 |
| An agent member's own cap | Phase 5 | `resolveAutonomy`'s caps |
| Notifications to another person | The collaboration service or phase 5's events | `NotificationV1.person` |
| The journal's total budget and retention | A follow-up | `journalEntryBytes` |
| Menus | Their own specification | The `menu` popover |
| A mounted app's settings and experiments | Phase 5 | `MANIFEST_SETTINGS_MOUNTED` |
| Counting the members who override a workspace value | Not planned: person records live in each browser on the hosted lane | None |

## 19. Exit criterion and tests

The phase exits when all of these hold:

- every scenario passes in `kernel/src/scenarios.test.ts`;
- every test below passes on `main`, in the place its row names;
- STATUS.md records the runs.

**The exit is local** (D126).

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P4-E1 | **An app's setting is searchable from the palette and scoped per project** | Chromium; Units | Hello's `greeting` through the palette, the section, the grant and `settingsChanged`. A project-only key is hidden with no project. No `level` gives `VALIDATION_ERROR`. `expected` gives `SETTING_CONFLICT`. `updatedBy` reads `agent:shell-agent` for an agent's write. The `HUMAN_REQUIRED` hand-off's `details` from each of `setting-*`, `autonomy-set` and `experiment-*` (F2). `writable` is computed for the caller. **The codes:** `SETTING_NOT_FOUND`, `SETTING_LEVEL_UNAVAILABLE`, `SETTING_PROJECT_REQUIRED`, `SETTING_TOO_LARGE`, `SETTING_NOT_OWNED`, `SETTING_USE_AUTONOMY`, `SETTING_MUTE_SHELL` |
| P4-E2 | **Settings, experiments and autonomy grant nothing** | Units | Phase 3's E2 sweep on twin stores, with the first round's exemptions (`data` compared for every command but `setting-*`, `autonomy-*`, `experiment-*`, `confirmation-*`, `keybinding-list`, `limit-usage-get`, `appearance-get`, `palette-search` as a set, `app-list` and `app-get`; commands of an app gated in one twin exempt entirely). The type and the scan |
| P4-E3 | **Appearance is taken over** | Units; Chromium | Phase 0's tests and `SESSION_50`. **`local` signed out:** the theme migrates on the first stage B, paints from `loam.settings` with no flash, and `appearance-set` persists. **`provider`:** migration only signed in; `.last` paints the signed-out page; a signed-out `appearance-set` writes `.last` only; two people keep their own. `view-state-*` on `loam.settings` is refused |
| P4-E4 | **An autonomy level set on a project is inherited by its apps and overridden for one command** | Units; Chromium | The `autonomy-per-command` and `owner-ceiling` cases. **With no `ceiling`, a project row above the workspace's general mode is `AUTONOMY_ABOVE_CEILING`, and with no general row, above the default.** The cap. Agents get `HUMAN_REQUIRED`. Non-creators and a team-listed project's creator get `OWNER_REQUIRED`. A creator removed from the project gets `PROJECT_NOT_FOUND`. `autonomy-set` on a restricted project gives `PROJECT_NOT_FOUND`, byte-identical, before any owner check. `AUTONOMY_COMMAND_UNKNOWN`, and orphan flagging after a manifest drops a command. Mounted tools resolve `ask`. Bulk `autonomy-get` |
| P4-E5 | **An experiment gates a surface until a person opts in, and a workspace owner can enable it for all** | Chromium; Units | Bea and Olu, through personal and workspace enablement, the opt-out, and `OWNER_REQUIRED`. The digest. **`experiment-settle` deletes a removed experiment's enablements at the manifest's apply, before any enable.** `app-get`'s `gates`. **R14:** Olu's own disable with a dirty tab of the gated app gives `EDITOR_TAB_DIRTY`; an owner's disable defers the unload until the tab is saved or discarded, with a notice; pending confirmations for its commands end `withdrawn`. The notices of 5.2. **The codes:** `EXPERIMENT_NOT_FOUND`, `EXPERIMENT_NOT_OWNED` |
| P4-E6 | **The inbox** | Chromium; Units | A sticky toast lands and counts. `source` on each path. Actions run through `notification-act` and end `done`. **R10:** the agent's `notification-read` and `-archive`, single and `all`, skip and refuse a pending confirmation; confirmations do not count against the 500. `notification-archive { all: true, source }`. The agent rate is 5. `notification-list`'s default of 20 and `body`. Filtered by scope. An agent's notice has no action but may carry a link |
| P4-E7 | **Every overlay kind follows the policy table** | Chromium; Units | The kinds × paths matrix of 6.1, including **the agent interface's `popover-open`, `dialog-open`, `modal-open`, `prompt-open` and `palette-run` giving `HUMAN_REQUIRED` while its `toast-show` succeeds as `agent:<id>`**. The `reason`s. A change of person closes everything. The agent's `overlay-dismiss { result: 'confirm' }` gives `HUMAN_REQUIRED`. **F6:** the agent's and an unrelated port's `overlay-dismiss { result: 'cancel' }` on a shell prompt, a confirmation in the slot and the close prompt give `HUMAN_REQUIRED`; the raising app's cancel of its own confirmation ends `withdrawn`, with no window. **F7:** a sixth agent toast within a minute gives `RATE_LIMITED`; with the region full of shell and `danger` toasts, an agent toast evicts none of them. **The codes:** `OVERLAY_ANCHOR_NOT_FOUND`, `OVERLAY_ELEMENT_VIEW`, `OVERLAY_LIMIT`, and `OVERLAY_NOT_FOUND` from `palette-run` with a stale `prompt` |
| P4-E8 | **Prompts and confirmations** | Chromium; Units | **R7:** in `local` signed out, the close prompt's Save and Discard, a confirmation's Confirm and `palette-run` with input all succeed as human gestures. **R8:** `palette-run` from a port gives `CALL_NOT_GRANTED`; an agent's `editor-close` on a dirty tab gives `EDITOR_TAB_DIRTY` and opens no modal. **R9:** an agent's `tally-reset` returns `CONFIRMATION_PENDING` at once with `details`; a re-call while pending returns the same; `confirmation-get` moves `pending`, `confirmed` (with the result of the call the shell ran) or `declined`; access re-checked on confirm; `confirmation-withdraw` gives `withdrawn` with no window; expiry after 10 minutes on a fake clock, then a new one on re-call; `confirm: true` refused in input. **R15:** `palette-run` with input on a `confirm_prompt` command replaces the input prompt in the slot with the confirmation, showing the input. **R16:** the window keys on the input digest, so a different input still asks; an active app's port is held by the window; a human gesture is not. **F4:** tally's and the agent's identical `tally-reset` calls, and the agent's in `prj_atlas` and `prj_beacon`, raise four separate confirmations. **F5:** after the person confirms, the agent's re-call returns the stored outcome and the count rises once. **F9:** a call with invalid input, or naming a project the caller may not enter, raises no confirmation (`VALIDATION_ERROR`, `PROJECT_NOT_FOUND`); when tally is disabled for the project, or loses a grant, between raising and confirming, the confirmation ends `declined` with `reason: 'access'` and nothing runs. The three-button close |
| P4-E9 | **Keybindings** | Chromium; Units | `Mod+Alt+P` in Chromium. German and Cyrillic layouts. Sequences. A sequence starting on a reserved chord refused. Overrides with `source` and `shadowed`. F6 refused. The editor's warning. The rail order |
| P4-E10 | **Limits** (#710, in part) | Chromium; Units | Each refusal with its `details`. **The owner's half (F3):** with the default `inputBytes` (262,144), setting `journalEntryBytes` to 524,288 gives `VALIDATION_ERROR` naming the order; `limit-usage-get` reports each of section 11's limits for hello after its refusals, and an agent's call gives `HUMAN_REQUIRED`. A truncated entry stops replay with `REPLAY_ENTRY_TRUNCATED`. The defaults hold when `late-settings` fails. `limit-usage-get` and the owner notice |
| P4-E11 | Withdrawn | | Menus are deferred (section 9) |
| P4-E12 | **Budgets** | Budget; Chromium | Section 14 |
| P4-E13 | **Accessibility and captures** | Chromium | Section 15; **the autonomy section's advisory notice** |
| P4-E14 | **What exited stays exited** | Earlier phases' places | Phases 0 to 3's local exit tests, amended only as listed |
| P4-E15 | **Every new command replays** | Units | A seeded session |
| P4-E16 | **Every scenario passes, and no job was skipped** | Units; the exit step | `scenarios.test.ts`, then `node scripts/loam-exit-check.mjs --phase 4` |
| P4-E17 | **Hosted refusal** | Units | A hosted `provider` projection. **Refused with `SHARED_RECORD_UNAVAILABLE`,** journaled, with no table changed: `setting-set` and `setting-reset` at `workspace` and `project` level, `autonomy-set` at every level including `person`, and workspace `experiment-*`. **These succeed:** `setting-set` at `person` level, person `experiment-*`, `notification-*` and confirmations |

## 20. Implementation plan

Each step is one pull request, merged on green. **Steps 4, 6, 8 and 10 each get a trust review.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 1 | Settings core | 3.1 to 3.4, 3.6, 3.8, 3.9; section 13's refusal; `settingWriteRule`, `isHumanGesture`; appearance in both modes; `loam.documents`; kernel interface 4; the scenario runner's directives; E2's units, E3, E17 | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | The settings section and the palette | 3.5, 3.7, 3.10; the form moved; the three custom editors; hello's settings; E1 | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 3 | Overlays I | Toasts (sticky, owner lines, agent toasts), popovers, the F6 stop | `pnpm check`, `loam.yml`, `budget` |
| 4 | Overlays II | Dialogs, modals, prompts, the slot, **6.1's path table and 6.5's answer rule**, `overlay-global-set`; E7. **Trust review** | `pnpm check`, `loam.yml`, `budget` |
| 5 | The inbox | Section 10, without confirmations; E6 | `pnpm check`, `loam.yml`, `budget` |
| 6 | Prompts and confirmations | Section 7, `confirmation-*`, R9's pending path; tally's and hello's commands; E8. **Trust review** | `pnpm check`, `loam.yml` |
| 7 | Keybindings | Section 8; E9 | `pnpm check`, `loam.yml`, `budget` |
| 8 | Autonomy | Section 4; E4. **Trust review** | `pnpm check`, `loam.yml` |
| 9 | Experiments | Section 5, `experiment-settle`, R14; E5 | `pnpm check`, `loam.yml` |
| 10 | Limits | Section 11 and `limit-usage-get`, **on their own**; E10. **Trust review** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 11 | Exit | Every row and scenario; #710 re-scoped; follow-ups filed | The check exits 0 |

**Order:**

- **Step 1** comes first, after phase 3's step 4.
- **Steps 2, 3 and 10** need step 1.
- **Step 4** needs step 3 and phase 3's `HUMAN_REQUIRED`.
- **Step 5** needs step 3.
- **Step 6** needs steps 4 and 5.
- **Step 7** needs steps 2 and 3.
- **Steps 8 and 9** need step 2 and `HUMAN_REQUIRED`. Step 9 also needs step 6, for R14's `withdrawn`.
- **Step 11** comes after steps 1 to 10 and phase 3's step 9.

Each step rebases before review. Names it adds to phase 3's lists are listed in its pull request.

## Questions for the owner

**Asked 2026-11-13, and revised twice the same day after review.** The text is written to each recommendation.

### Q1. Who sets a project's autonomy, within the owners' bounds?

Autonomy decides whether agents act on their own, ask first, or only suggest. Owners bound every project:

- **The workspace's own level.** A project can never be looser than it, unless an owner sets a higher ceiling.
- **Any rule for one app or one command.**

The question is who else may set a project's own level, which then stays within those bounds. "The project's creator" means whoever created it, and any member may create a project. The creator keeps this power only while they may still enter the project. For a project a team instance lists, only owners may (D87, D110).

- **Owners and the project's creator (recommended).** This matches D110. The creator can tighten their project, or loosen it as far as the owners allow, without waiting.
- **Owners only.** The strictest option.
- **Any member of the project.** The most self-service option. The tradeoff: one member can change, for everyone in the project, how far agents act unprompted, within the owners' bounds.

### Q2. May a person opt out of a workspace-enabled experiment?

- **Yes (recommended).** Nobody is held in an experiment they don't want.
- **No.** Everyone sees the same thing. The tradeoff: a person stuck with a broken experiment waits for an owner.

### Q3. The default autonomy

Where nobody has set autonomy, the default decides what agents do. **It also bounds every project until an owner sets a workspace mode or a ceiling (4.2): a stricter default bounds every project's general row,** whose bound at write time is then `ask`. Until phase 5, nothing enforces it (D98).

- **Act on reads, ask before changes, and ask before any tool of a mounted server (recommended).** A mounted server labels its own tools, and that label can't be trusted. **Owners can loosen this** by setting the workspace's mode and ceiling higher.
- **Ask for everything.** The tradeoff: agents ask before every lookup, and people learn to click through.
- **Act on everything.** The tradeoff: agents change things unprompted, and every project may then act too, until an owner tightens it.

### Q4. May a person's agent write project-level settings?

Every member of a project reads its project-level settings.

- **No, people only (recommended).** This matches D110's "no agent changes who is in a project". In phase 4 it holds locally. On the hosted lane, everyone's project writes are refused anyway until phase 5 (section 13). After that, the hosted transport always acts as the person, so "no" is the only answer the hosted lane can serve.
- **Yes, as the person.** It could be served locally only, until phase 5 gives connected agents a way to write over MCP. The tradeoff: one person's agent changes what every member sees.

### Q5. Cut and rank the jobs

The fourteen jobs in [Jobs and scenarios](#jobs-and-scenarios) are a draft, revised after the job-list walk.

- **Accept the slice as ranked (recommended):**
  1. per-project settings;
  2. finding and changing a setting;
  3. narrowing autonomy for one command;
  4. trying an experiment;
  5. an owner's workspace experiment, with a person's opt-out;
  6. declining a confirmation;
  7. an agent knowing its mode.

  Then the seven jobs outside the slice, in their order. **In phase 4, none of these is served to connected agents over MCP.** The agent jobs (7, 9 and 10) serve the in-process agent interface only, which has no consumer until phase 5's copilot.
- **Cut, add or re-rank** any of them.

## Proposed amendments to other phases

- **A-P0-1 (step 6):** the palette's active-app filter is removed (step 6), and `createKeybindings` takes overrides and sequences (step 7).
- **A-P1-1 (step 6):** the `palette` catalog row becomes "Filtered by scope, ranked by active app".
- **A-P1-2 (step 9):** `app-get` gains `gates`; the `menus` catalog row is served by "a later specification", not phase 4.
- **A-P2-1 (step 6):** 5.5's close prompt becomes 7.3, opened only for the person's own close.
- **A-P2-2 (step 1):** `WorkspaceV1.trashDays` is written through from `loam.documents.trashDays`.
- **A-P2-3 (step 10):** the 256 KiB instance-command input bound becomes `loam.limits.inputBytes`.
- **A-P3-1 (step 1):**
  - `emphasis.sections` widened;
  - `HUMAN_COMMANDS` gains `notification-act` and `palette-run`;
  - `setting-*`, `autonomy-set`, `experiment-*` and `limit-usage-get` refuse non-human callers in their own handlers, with their own hand-off `details` (F2), as phase 3's 3.4 does for `project-update { access }`;
  - `needsMembershipRead` joins the re-read.
- **A-P3-2 (step 1):** in `provider` mode, appearance is per person, with `loam.appearance.last` (3.6).

## Amendments to the architecture and the decision log

- **Section 4:**
  - settings levels, with 3.3's precedence;
  - overlay policy: the prompt row's limit becomes "the overlay slot; confirmations from agents and background apps wait in the inbox, and the call returns at once"; the global row's placement becomes "top layer, a strip under the title bar";
  - "agents open toasts only".
- **Section 5:**
  - the new commands and domains;
  - an experiment's `state` is a stage plus enablement;
  - the `menus` surface is deferred.
- **Section 9:** phase 4's exit is local (D126).
- **Glossary:** the terms above.
- **Decision log:** D116 to D127, marked proposed.

| ID | Proposed decision |
| --- | --- |
| D116 | Settings: a closed schema subset with no `pattern`; three levels; resolution person, project, workspace, default. One `settingWriteRule`, with `level` required. Workspace values are an owner's; project values a person's who may enter the project (agents per Q4). Writes record `updatedBy`, `agent:<id>` for agents, and take `expected`. `loam.settings` is not a view-state id. The grant reads only the app's own sections. A `HUMAN_REQUIRED` hands off `{ route, section, key, level }` |
| D117 | Appearance, keybindings and the rail order are person settings. In `local`, appearance migrates on the first stage B and paints from `loam.settings`. In `provider`, it is per person, `loam.appearance.last` paints the signed-out page and stage A, and nothing migrates while signed out |
| D118 | Autonomy rows at workspace or project level, narrowed to an instance and a command. A project row is bounded by the workspace's ceiling, or its general row, or the default, and by its rows for that app and command; then by the person's cap. At write time a general or instance project row with neither a workspace mode nor a ceiling is bounded by `ask`. The default follows Q3, with mounted tools at `ask`. Writes are human, refused in the handler with a hand-off, check access first, and refuse unknown commands; orphans are flagged to the owners who may enter the project. Advisory in phase 4, with a notice; enforced by phase 5, which also adds the "within limits" field |
| D119 | Experiments: an author's stage, `changes` and `ends`; enablement per person and per workspace, tied to the `changes` digest; opt-out per Q2. `experiment-settle` deletes the enablements of removed experiments at the manifest's apply. Gates decide presence. An unload never loses a dirty tab. Changes are announced |
| D120 | The inbox: per person, filtered by scope, `source` derived from the path. At most one action, the source's own palette command (`NOTIFICATION_ACTION_FOREIGN` otherwise), never a human or owner command, never from an agent. Pending confirmations cannot be marked or archived by a non-human, and do not count against the quota. AFD's codes, with details |
| D121 | The overlay manager complete. The agent interface opens toasts only, counted against its rate of 5 a minute and never evicting a shell or `danger` toast; every other kind and `palette-run` give `HUMAN_REQUIRED`. A human gesture is a chrome or palette call with no `caller` and an actor that is not `agent`. Only a human gesture confirms; a shell-owned overlay is closed only by a human gesture or its `for.caller`, whose cancel is `withdrawn` |
| D122 | `palette-run` is human-only, fills the prompt it names, and its confirmation replaces the input prompt. `confirm_prompt` is enforced in process, after validation, line 0, access and grants and the decline window. Confirmations from an agent or a background app return `CONFIRMATION_PENDING` at once; the person confirms in the inbox, and the shell re-checks the same chain and runs the call once. A confirmation is keyed on (caller, command, input digest, scope); a re-call on that key before `expiresAt` returns its stored state and outcome. Withdrawal and expiry never open the decline window, which keys the same way and exempts only human gestures. `group` is phase 5's. The close prompt opens only for the person's own close |
| D123 | Keybindings version 1: layout-aware; sequences that cannot start on a reserved chord; a closed `when`; human overrides, except for F6, Shift+F6 and Escape, with `source` and `shadowed`; `Mod+Alt+P`; no forwarding from views |
| D124 | Limits per message, input, call rate, store and whole journal entry; the bounds hold each other, with the order named; failing closed; a replay stops at a truncated entry; owners read usage per limit with `limit-usage-get` and are told of refusals. #710 is answered in part |
| D125 | Phase 4 runs nothing on the hosted server. Hosted `provider` deployments refuse shared writes and every autonomy write with `SHARED_RECORD_UNAVAILABLE`. Phase 5's shell commands over MCP bring them to the server, under section 13's seven obligations |
| D126 | Phase 4's exit is local and starts from every scenario passing; it waits on phase 3's step 9 and nothing of phase 6 |
| D127 | Menus are deferred to their own specification; `ui.menus` stays refused, naming it. The `menu` popover kind stays |

## Review 2026-11-13

The first round: two independent reviews of `445b2bd7` (trust and security; general), each "approvable once fixed", and the coordinator's rulings R1 to R6.

### Coordinator's rulings

| Ruling | Answer |
| --- | --- |
| R1: hosted serving leaves phase 4 | Section 13: a refusal, and obligations on phase 5. P4-E17 |
| R2: workspace rows for an app or a command bound project rows | 4.2 step 4; E4; Q1 |
| R3: confirmations from agents and background apps wait in the inbox | 7.2; 10.1 |
| R4: appearance | `loam.appearance.last`; A-P3-2 |
| R5: owner questions | Q1 to Q5 |
| R6: smaller choices | `pattern` dropped; three chords dropped; AFD's codes; step 3 split; #710 in part |

### Trust and security review

| Finding | Answer |
| --- | --- |
| B1: an agent confirms its own prompt | 6.5 |
| B2: agent overlays and notifications show as the shell's | `agent:<id>`; no actions from agents; `for` set by the kernel only |
| B3: unlabelled app text from the background | R3 |
| B4: `level` was optional | Required; `settingWriteRule` |
| B5: no command for the cap | `autonomy-set { level: 'person' }` |
| B6: `loam.settings` reachable through `view-state-*` | Not a view-state id |
| B7: Q1's premise | R2 |
| I1 to I10 | Q4; filtered reads; notifications filtered by scope; section 11; R3; the digest; E2's exemptions; the palette; A-P3-2; 8.1 and 3.7 |

### General review

| Finding | Answer |
| --- | --- |
| B1: no jobs | The jobs and scenarios |
| B2: unstated dependencies | 1.2 |
| B3: the wrong phase 6 step | R1 |
| B4, B5 | As trust B5; R1 |
| I1 to I13, and the nits | R2; #710 in part; codes; 3.2; R4; amendments; 7.2; chords; `pattern`; Q3; scope; step split; W39 |

## Review 2026-11-13, second round

The second round:

- a re-check of `6046b01f` (N1 to N13), "approvable once fixed";
- three walks of the jobs: the person's seat (gaps 1 to 19), the job list's, and the calling agent's;
- the coordinator's rulings R7 to R16.

#1119 had merged before these ran, so this revision is a pull request of its own.

### Coordinator's rulings

| Ruling | Answer |
| --- | --- |
| R7: the human gesture | Terms; 6.5's `isHumanGesture`; E8's `local` signed-out case |
| R8: what agents may open | 6.1's path table; 7.1; 7.3; 4.5; E7, E8 |
| R9: confirmations don't block | 7.2's pending path; `CONFIRMATION_PENDING`, `confirmation-get` and `confirmation-withdraw`; the shell runs the approved call; `withdrawn`; `CONFIRMATION_EXPIRED`; `confirm: true`; the `decline-confirmation` scenario |
| R10: pending confirmations are protected | 10.1, 10.2; `notification-archive { all }`; E6 |
| R11: no project loosens past the workspace | 4.2 step 4; Q1, Q3; the `autonomy-per-command` scenario's first step |
| R12: appearance in `local` | 3.6; E3 |
| R13: scenarios that could not pass | `limit-refuses-call` and `inbox-action` rewritten; `source` derived (10.1); per-step callers by directive |
| R14: unloading with unsaved work | 5.3; E5 |
| R15: input and confirmation together | 7.1; E8 |
| R16: long runs of confirmations | The window keyed on input digest; `group`; section 18 |

### Re-check

| Finding | Answer |
| --- | --- |
| N1: the human gesture | R7 |
| N2: what agents may open | R8 |
| N3: projects loosening autonomy | R11 |
| N4: appearance in `local` | R12 |
| N5 (a), (c): scenarios | R13 |
| N5 (b): a confirmation no step raised | R9 |
| N6: section 13's obligations | Obligations 1 and 2 reconciled; the move of enablements; A6; phase 6's lists named; E17 reworded |
| N7: Q4's framing | Q4 restated |
| N8: the window's exemption | Only human gestures (R16) |
| N9: `autonomy-set`'s check order | 4.3 |
| N10: `palette-run` and `confirm_prompt` | R15 |
| N11: the count of commands used | Recounted in the Checks |
| N12: "changes none of" phase 3's rules | 1.2 says "adds to" |
| N13: reading or archiving a pending confirmation | R10 |
| I6, carried from the first round: removed enablements | `experiment-settle` at the manifest's apply (5.1) |

### The person walk

| Gap | Answer |
| --- | --- |
| 1: unload with unsaved work | R14 |
| 2: agent modals | R8 |
| 3: long runs | R16 |
| 4: the limit scenario | R13 |
| 5: prompt on prompt | R15 |
| 6: autonomy is advisory | 4.5's notice; E13 |
| 7: orphan rows | `AUTONOMY_COMMAND_UNKNOWN`; `orphan` flagged at the manifest's apply, with an owner notice. **Declined in part:** an `app check` warning, because `app check` runs offline and never sees a workspace's stored rows |
| 8: who changed a setting, and safe rollback | `updatedBy` and `updatedAt`, per key; `agent:<id>`; `expected` and `SETTING_CONFLICT` |
| 9: the keybindings editor | Custom editors named (3.7); `source` and `shadowed` (8.5); the warning (8.3) |
| 10: experiments vanish without notice | 5.2's notices |
| 11: `muted` | Defined (3.7) |
| 12: one agent fills the inbox | R10; an agent rate of 5 a minute |
| 13: no hand-off | `HUMAN_REQUIRED`'s `details` (3.2); agents may link |
| 14: the keyboard path to the inbox | "Open inbox" in the palette (7.1); 15's path |
| 15: limit pressure | `limit-usage-get`; owner notices |
| 16: the hosted cap | Stated in section 13, with the section's message |
| 17: a late confirmation | The project in the header; access re-checked on confirm |
| 18: confusing levels | "You, everywhere". **Declined:** counting the members who override a workspace value, because on the hosted lane person records live in each browser, so no count could be right |
| 19: creator powers | "While the creator may enter the project" (4.3) |

### The job-list walk

| Finding | Answer |
| --- | --- |
| Missing jobs (workspace experiment, workspace default, undo, agent setting, agent notice, the person seeing autonomy) | `workspace-experiment-opt-out`; `setting-per-project`'s workspace value and reset; `agent-changes-setting`; `agent-leaves-notice`. The person's view of autonomy is the section's chain (E4), which has no scenario, since it is the chrome's |
| "Approval within limits" | Phase 5 adds the field (4.1, section 18) |
| Untrusted labels | Named in section 18 |
| Features dressed as jobs | "Read my autonomy" split into `know-my-mode` and `owner-ceiling`; the limit job recast for an app author |
| Trailing refusal steps | Moved off each job's last step |
| Jobs stopping short | Find a setting ends in `setting-set`; the experiment asserts `changes` and the gate; the decline raises and asserts the header; the inbox action asserts the outcome and `done`. **The close scenario was dropped,** relying on E8 |
| Additions with no job | Keybindings: a job written (`rebind-a-chord`). **Menus: deferred** to their own specification (section 9) |
| Limits | A step of their own (10) |
| Q5 | Restated with the slice, and with the MCP note |

### The calling-agent walk

| Finding | Answer |
| --- | --- |
| B: a confirmation blocks for 10 minutes; cancel counts as decline | R9 |
| B: `palette-run` without input | R8 |
| B: agents archiving pending confirmations | R10 |
| Agents opening prompts and reading answers | R8: they cannot; 4.5 |
| The project's source; the `scope-set` suggestion; strict inputs | 3.9; the suggestion in 16; 4.4 says the input wins |
| Output bounds | `setting-schema-get { key }`; budgets; `notification-list`'s default of 20 and `body` |
| `writable` for the caller | 3.9 |
| The hand-off | 3.2 |
| Bulk autonomy | `autonomy-get { commands }` |
| MCP serves nothing | Jobs and scenarios; Q5 |
| `CONFIRMATION_REQUIRED`'s meaning | `CONFIRMATION_EXPIRED`; `confirm: true` |
| `RATE_LIMITED` details | Always `{ limit, retryAfterMs }` |
| Palette rows | `section`, `key` and `app` |

**Declined:** two, in part. Both are in the person walk's table: the `app check` warning on orphan rows (gap 7), and counting the members who override a workspace value (gap 18).

### Re-check 2026-11-13, third round

A re-check of `faa0c1d9` found the second revision "approvable once fixed". It found every earlier trust blocker closed, and both partial declines sound. It raised one blocker (F1), ten improvements (F2 to F11) and four nits, and the coordinator ruled on F2 to F11.

| Finding | Answer |
| --- | --- |
| **F1:** ten scenarios assert lists that AFD compares whole | Every list is asserted by index, with `'1': { notExists: true }` for a single item, since AFD's validator refuses `length` beside index keys. Where order is not fixed, the command takes a filter: `palette-search { kind }`, `experiment-list { experiment }`, `keybinding-list { command, target }`, and `notification-list { kind, limit }`. Orders are stated (3.10, 8.5, 10.2). Two assertions were proved with `evaluateResult` (the Checks). AFD is unchanged; partial list matching and a step-level actor and scope are a [follow-up](#follow-ups) |
| **F2:** the hand-off from phase 3's central check | `setting-*`, `autonomy-set`, `experiment-*` and `limit-usage-get` refuse in their handlers, with `key` defined for autonomy and experiments (3.2); A-P3-1 amended; E1 |
| **F3:** the limit scenario | The owner's steps moved to E10, with `journalEntryBytes` at 524,288 against the default `inputBytes`; `limit-usage-get` has its commands-table row (11), and `refusals` names section 11's limits; the job is the app author's alone |
| **F4:** the confirmation's key | (caller, command, input digest, scope), for both the repeat rule and the window (7.2); E8 |
| **F5:** a retry after confirming | A re-call before `expiresAt` returns the stored state and outcome; a confirmed call runs once (7.2); E8 |
| **F6:** an agent cancelling the person's prompts | A `SHELL_OWNER` overlay closes only by a human gesture or its `for.caller`; the agent gets `HUMAN_REQUIRED`; the raiser's cancel is `withdrawn` (6.5); E7 |
| **F7:** agent toasts | Counted against the agent's rate of 5 a minute; they never evict a shell or `danger` toast (6.1); E7 |
| **F8:** the write-time bound of a general project row | Bounded by the workspace mode or ceiling, else by `ask` (4.2); Q3 restated |
| **F9:** the order of a call | Validation, line 0, access and grants, the window, pending or the slot, then the handler; the same chain, the app's enablement included, is re-checked on confirm (7.2); E8 |
| **F10:** the directives, seeds, `project` and portability | A grammar table, with one caller directive at most, in a fixed order, and `inactive` defined; one seed, `p4-base`, in the runner's seed map, since AFD's `fixture` names a server file; `project` is the id everywhere; every file is tagged `loam-runner` (Jobs and scenarios) |
| **F11:** the claim about error codes | Every code in section 16 has a unit test; the twelve the re-check named are in E1, E5 and E7 |
| **Nit:** the orphan notice | Sent only to owners who may enter the row's project (4.2, 10.2) |
| **Nit:** an action that is another app's command | `NOTIFICATION_ACTION_FOREIGN` (10.1, 16); a step in `inbox-action` |
| **Nit:** the guest-book wording | "Ada is waiting at the guest book", and `hello-greet` greets a waiting visitor |
| **Nit:** `autonomy-list` on a project the caller can't enter | `PROJECT_NOT_FOUND` (4.4) |
| **Nit:** `palette-run`'s input and its prompt | `palette-run { command, prompt, input }` fills the named prompt; a stale one gives `OVERLAY_NOT_FOUND` (7.1) |
| Q3's wording | "Until an owner sets a workspace mode or a ceiling", with the stricter default's bound on general rows |

**Declined:** none.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Phase 4 specification | Revisit `closedby` and `popover="hint"` when Safari ships them | Open |
| 2026-11-13 | Phase 4 specification | Notifications to another person | Open |
| 2026-11-13 | Phase 4 specification | An agent member's own autonomy cap | Open; phase 5 |
| 2026-11-13 | Phase 4 specification | #708's screen-reader pass over the new overlays | Open |
| 2026-11-13 | Review (R1) | Phase 5's shell commands over MCP: section 13's seven obligations | Open; phase 5 |
| 2026-11-13 | Review (#710) | The journal's total and origin budget, retention, and `QuotaExceededError`, together with D82 | Open; #710 |
| 2026-11-13 | Review (I8) | Whether Firefox and WebKit pages receive `Mod+Alt+P` | Open; #706 |
| 2026-11-13 | Second round (R16) | Confirm or decline a whole run's confirmations by `group` | Open; phase 5 |
| 2026-11-13 | Second round (job list) | The limit field for D41's "approval within limits", and the untrusted labels | Open; phase 5 |
| 2026-11-13 | Second round | Menus: a specification of their own, with a job | Open |
| 2026-11-13 | Third round (F1, F10) | AFD: partial list matching in the scenario evaluator, and a step-level actor and scope. Work across all four languages | Open; AFD |
| 2026-11-13 | Third round | A fresh re-check of this revision | Open |
