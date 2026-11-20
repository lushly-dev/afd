# Phase 4 specification: settings, experiments, notifications, overlays

Epic: [#1543](https://github.com/lushly-dev/afd/issues/1543). File new work for this area as its sub-issue.

| Field | Value |
| --- | --- |
| Phase | 4, settings, experiments, notifications, overlays ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answered on 2026-11-18; the phase 4 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [jobs](#jobs-and-scenarios) and their [scenarios](scenarios/), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.4, 4.1, 7.3 and 2.4), the [documents specification](../2-documents/spec.md) (its 5.5), the [identity specification](../3-identity/spec.md) (its 3.1, 3.3, 3.4, 4.5, 6 and 7), the [hosts specification](../6-hosts/spec.md) (its 6 and 7), the [phase 1 specification](../1-app-contract/spec.md) (its 4 and 8), the [architecture](../../architecture.md), the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State: Approved** 2026-11-13 by the coordinator under the owner's standing grant, after three review rounds (two reviews, a re-check with three job walks, and a second re-check). **The owner answered Q1 to Q5 on 2026-11-18, each as recommended** (D154 to D158), so the text, written to each recommendation, stands unchanged. The history:
  - Written 2026-11-13 by the design sub-agent against `main` at `f7ecbd43`.
  - Revised the same day after two independent reviews of `445b2bd7` and the coordinator's rulings R1 to R6 ([Review 2026-11-13](#review-2026-11-13)).
  - That revision merged to `main` in [#1119](https://github.com/lushly-dev/afd/pull/1119) (`e7c813e1`) before its re-check ran.
  - **Revised a second time the same day** after:
    - a re-check of `6046b01f` (findings N1 to N13);
    - three walks of the jobs by fresh readers, in the person's seat, the job list's and the calling agent's;
    - the coordinator's rulings R7 to R16.

    Every finding and its answer is in [Review 2026-11-13, second round](#review-2026-11-13-second-round).
  - **Revised a third time** after a re-check of `faa0c1d9` ("approvable once fixed", F1 to F11 and four nits) and the coordinator's rulings on F2 to F11 ([Re-check 2026-11-13, third round](#re-check-2026-11-13-third-round)).

  - **Approved** 2026-11-13 by the coordinator at `203cb3a0`, under the owner's standing grant. D116 to D127 are decided with that approval, in the [decision log](../../decisions.md). The [questions for the owner](#questions-for-the-owner) stayed open: Q1 and Q3 could amend D118, Q2 D119, and Q4 D116; Q5 orders the work and amends no decision.
  - **The owner's answers,** 2026-11-18: Q1 to Q5, each as recommended, recorded as D154 to D158 in the [decision log](../../decisions.md) and beside each [question](#questions-for-the-owner). No section changes: D116, D118 and D119 stand as written, and each now points at its answer. None of the [proposed amendments to other phases](#proposed-amendments-to-other-phases) lands with the answers: each lands with the step named beside it.
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
- **Done since approval:** the owner's answers to Q1 to Q5, 2026-11-18 (D154 to D158).
- **Done, step 1, the settings core** ([#1533](https://github.com/lushly-dev/afd/pull/1533), 2026-11-18): 3.1 to 3.4, 3.6, 3.8, 3.9, section 13's refusal, kernel interface 4, `p4-base` and the runner's phase 4 table; what it decided, measured and left is in [its record](#step-1-2026-11-18).
- **Done, step 2, the settings section and the palette** ([#1611](https://github.com/lushly-dev/afd/pull/1611), 2026-11-18): 3.5, 3.7 (`loam.rail`, `loam.keybindings`, `loam.notifications`), 3.10, the three custom editors, hello's settings, `p4-base`'s apps, and P4-E1 but for the hand-offs of steps 8 and 9; what it decided, measured and left is in [its record](#step-2-2026-11-18), with one amendment to section 1 (step 2).
- **Done, step 3, overlays I** ([#1616](https://github.com/lushly-dev/afd/pull/1616), 2026-11-18): toasts' `sticky` and `link`, owner lines, agent toasts with their rate of 5 a minute (F7), `popover-open` on every path of 6.1's table, the toast region's F6 stop and the `overlays` chunk; what it decided, measured and left is in [its record](#step-3-2026-11-18).
- **Done, step 4, overlays II** ([#1629](https://github.com/lushly-dev/afd/pull/1629), 2026-11-19): dialogs, modals' actions and elements, prompts, the slot, 6.1's path table for every kind, 6.5's answer rule with F6's cancels, `parked` and `overlay-global-set`; what it decided, measured and left, and what its trust review changed, is in [its record](#step-4-2026-11-19).
- **Done, step 5, the inbox** ([#1630](https://github.com/lushly-dev/afd/pull/1630), 2026-11-19): section 10 without confirmations, the `notification` table and `notification-push`, `-list`, `-read`, `-archive` and `-act`, sticky toasts landing (6.1), `muted`, the `inbox` chunk, the title bar's Inbox button and the announcement, a sticky toast's **Open inbox**, the palette's row, hello's guest book, and P4-E6; what it decided, measured and left is in [its record](#step-5-2026-11-19).
- **Done, step 7, keybindings** ([#1657](https://github.com/lushly-dev/afd/pull/1657), 2026-11-19): section 8 with the coordinator's rulings R1 to R5, `keybinding-list`, `Mod+Alt+P`, the manifest's sequences and `when`, the keybinding editor's sequences and warnings, the job `rebind-a-chord`, and P4-E9; what it decided, measured and left is in [its record](#step-7-2026-11-19), with amendments to 3.4, 8.1, 8.3, 8.5, 12.1, 16 and P4-E14 (step 7).
- **Done, step 8, autonomy** ([#1623](https://github.com/lushly-dev/afd/pull/1623), 2026-11-19): section 4 with its commands, the autonomy section in the settings tree, E4's units and Chromium, E13's notice, P4-E2's sweep over autonomy, and the jobs `autonomy-per-command`, `know-my-mode` and `owner-ceiling`; what it decided, measured and left is in [its record](#step-8-2026-11-19), with amendments to 3.2, 4.1, 4.2, 4.4 and 12 (step 8).
- **Done, step 10, limits** ([#1631](https://github.com/lushly-dev/afd/pull/1631), 2026-11-19, its trust review answered): section 11, `limit-usage-get` and boot's `store-usage-settle`, the Limits section with usage beside each key, A-P2-3, P4-E10's units and Chromium, and, merged with steps 4 and 5 (`main` at `cb4d5dff`), the owners' notice through the inbox and the job `limit-refuses-call`; what it decided, measured and left is in [its record](#step-10-2026-11-19).
- **Not done:** every step of the [plan](#20-implementation-plan) after step 5, steps 7, 8 and 10 apart. The [amendments to the architecture](#amendments-to-the-architecture-and-the-decision-log) were not applied at approval and name no step: each lands with the step that builds what it describes, and step 11 checks that all have.
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
| `console` | Its schema form's model, `renderForm` and `readForm`, stays here, and the console and the chrome's settings section both use it. **Amended (step 2), accepted by the coordinator:** the form does not move to `chrome/src/forms/`, since the console importing the chrome would be a package cycle; `chrome/src/forms/` holds the settings section's native controls over that model, as the account and documents sections' fields are native |
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
  - **For autonomy,** `section` is `loam.autonomy` and `key` is the row id the call would write (`workspace/-/tally/tally-reset`), or `cap`. **Amended (step 8):** `route` is the section's, `~/settings/loam.autonomy`, since a row id holds slashes that no route's fragment may (phase 2's 6.1); the cap's is `~/settings/loam.autonomy#cap`.
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
  - **Amended (step 7, R5):** a person's `loam.keybindings` is kept per workspace too, in the person's record at `<workspace>/loam.keybindings`, so another workspace in the same browser never reads a person's overrides. A value under the bare `loam.keybindings`, as step 2 kept it, is never read: overrides set before step 7 are set again.
  - **Amended (step 10, R1; closes #1614):** each id starts with its workspace, `<workspace>/<sectionFullId>/workspace` or `<workspace>/<sectionFullId>/project/<projectId>`, as step 8 keyed the autonomy rows, so two workspaces in one browser's store never share a row. A row keyed without its workspace is not this workspace's: it is never read and never written over. Values set before this step in that shape are not migrated: they read as unset, and an owner sets them again at the new id. Until then a workspace's lowered `loam.limits` reads as its defaults (section 11).

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
| `setting-schema-get` | query | `{ section?; key?; outline? }` | `{ sections }`, those the caller may see, gates applied. With `key`, that key's schema alone. Budget 16 KiB, and a caller past it is told to name a section. **Amended (step 2):** with `outline`, each section's keys by `{ key, title, levels }` and no schema, so the settings tree fits the budget; an app's section names its `instance` beside `app` |
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

`palette-search` gains an optional `kind: 'command' | 'document' | 'setting'` filter. Rows are ordered by score, then, on a tie, a command before a document before a setting (step 2), then by name, so a result is deterministic. Choosing a setting row runs `section-open { section: 'settings', target }`. A project-only key is listed only while a project is active. The index is built in `late-settings`, never in first paint.

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
	app?: string;                  // step 8, R2: the identity of the app decided about, with `instance`
	mode?: AutonomyModeV1;         // step 8: absent only on the workspace's general row holding a ceiling alone
	ceiling?: AutonomyModeV1;      // the workspace's general row only
	orphan?: true;                 // set when `command` or `instance` is gone or its app changed; a bound, never a mode (R1)
	updatedAt: number; updatedBy: string;
}
```

- **A person's own cap** is `loam.autonomy.cap`, written only by `autonomy-set { level: 'person', cap }`.
- **Amended (step 8):** `mode` is absent on the workspace's general row while it holds a `ceiling` alone, so an owner can let projects go further without changing the workspace's own mode from the default. `autonomy-set` with `mode: null` removes a row, keeping a general row's `ceiling`; `ceiling: null` clears it; `cap: null` clears the cap. A row is replaced whole at each write, so a field it no longer holds does not survive.
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

**Orphan rows** are ignored, and flagged in `autonomy-list` and in a notice to the owners who may enter the row's project (all owners for a workspace row) (10.2). **Amended (step 8, after its trust review):**

- **R1, orphans fail safe:** an orphaned row is ignored as a mode but still applies as a bound wherever it names the command's instance, and the command or none, so flagging a restrictive row can never loosen a resolution; at write time an orphaned workspace row for the instance or the command still bounds a project row.
- **R2, the app decided about:** a row naming an instance stores its app's identity, `app`: `loam` for the shell's (the plugin id no app may take), `plugin:<plugin id>` for a native or view app, and `mounted:<app>:<transport>:<route>` for a mounted instance, its deployment entry's name for its server, the most stable identity a browser kernel holds. Another identity orphans the row, and only the same identity backs it again; a command name alone never does.
- **When:** boot's own `autonomy-settle { orphaned, restored }`, journaled with the row ids so a replay flags the same rows, runs after each stage B's apply and after each `app-instance-refresh` and `workspace-app-set`, whenever something changed. An instance the deployment no longer has orphans its rows; a catalog is known only for a ready, enabled instance (a mounted one once a discovery installed it, an empty catalog included), and an unknown catalog or identity leaves every flag as it is.
- The notice is step 5's, through the seam `autonomy-settle` calls.
- **R1's edge (the re-check):** a project row orphaned by an identity change keeps its own mode as a bound, but it decides nothing, so it no longer meets the workspace's bound as a deciding project row would. That matters only once an owner writes the workspace's row for the new app: the new workspace row then decides, and the orphaned project row lowers it, which is never looser than either. Before the owner's own write nothing loosens; after it, the owner chose the new app's mode.
- **Old-format rows:** a row stored without its workspace's key is not read (4.4). That is safe only because step 8 never shipped before it was keyed: no browser holds such a row. A later change of the key needs a migration, not this rule.

**Amended (step 8), F8 for an instance row:** a project row for an instance also meets the workspace's row for that instance at write time, which resolution would lower it to.

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
| `autonomy-list` | query | `{ level?; project? }` | `{ rows; ceiling; cap }`, only rows of projects the caller may enter, orphans flagged. A `project` the caller may not enter, or that does not exist, gives `PROJECT_NOT_FOUND`. **Amended (step 8):** also `writable: { workspace; project?; cap }`, each `{ writable; reason? }` computed for the caller as `setting-list`'s (3.9), `project` for the input's project or the call's scope's |
| `autonomy-set` | mutation, human | `{ level: 'workspace' \| 'project'; project?; instance?; command?; mode?: AutonomyModeV1 \| null; ceiling? } \| { level: 'person'; cap }` | `{ row?; cap?; previous }` |

**Amended (step 8, after its trust review):** `autonomy-list` takes `limit` (1 to 200, default 100) and `cursor`, and answers `cursor` (null on the last page): rows are ordered with the general rows first, then by id, so the first page always holds them; `ceiling`, `cap` and `writable` are on every page, and `writable.project` is `PROJECT_ARCHIVED` for an archived project, as the write refuses it. `autonomy-set`'s `instance` and `command` are checked by their syntax before any key is built, never `*`, and removing a row whose target is gone needs that row, named field for field. A row is stored under `<workspace>/<row id>`, so two workspaces in one browser's store never meet; a row stored without that key is not read. **Amended (step 8):** `autonomy-get`'s result is 4.2's with `command`, `instance` and `project` (or `null`) beside it, and a command it cannot find is `AUTONOMY_COMMAND_UNKNOWN`, with `details: { index }` in bulk. `autonomy-set` at `project` level names its `project` (never the call's scope), and `ceiling` and `cap` take `null` to clear. A project row of an archived project is `PROJECT_ARCHIVED`, after the owner check. Each declares an output budget (`AUTONOMY_OUTPUT_BUDGETS`), checked for `autonomy-get` and `autonomy-list` at 64 KiB.

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
| dialog | `dialog-open` | Until closed | Parked and restored; with `cancelOnLeave`, cancelled | Non-modal (`show()`), above the parts; not the top layer, so a modal makes it inert (step 4) | 3 per instance (`OVERLAY_LIMIT`) |
| modal | `modal-open` | Until closed | Cancelled | Top layer, the rest inert | **The overlay slot** |
| prompt | `prompt-open`, `palette-run`, a confirmation in the slot, the close prompt | Until answered | Cancelled | As a modal, in the slot | The slot |
| global | The internal `overlay-global-set` | Until its condition ends | Survives | A strip under the title bar, above the parts; not the top layer (step 4) | One per id |

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
	target?: string;       // for `section-open`; amended (step 7, R2): for `layout-set`, the part a toggle chord toggles
	when?: string;         // `editor`, `sidebar`, `main`, `project`, `!project`, `documentType == <type>`, joined by " && "
}
```

- **Sequences:** a sequence's first chord has `Mod` and is never a reserved chord. It waits 1,500 ms for the second.
- **Precedence:** overrides, then the reserved chords, then the active app's, then the active tab owner's.
- **Amended (step 7), the coordinator's rulings:**
  - **R1, the reserved chords that run no command:** a binding names a command, and no command saves an editor, moves focus between the parts or opens the project switcher. So F6, Shift+F6, Mod+S and Mod+Alt+P are listed and overridden under names in the shell's domain, which no app may declare: `shell-focus-next`, `shell-focus-previous`, `shell-save` and `shell-project-switcher`. Called, each is refused with `KEYBINDING_ACTION_ONLY`, whose suggestion names `keybinding-list`. The job `rebind-a-chord` names `shell-project-switcher`, since `section-open` has no switcher. Making them commands is a [follow-up](#follow-ups).
  - **R2, the layout toggles:** Mod+B, Mod+Alt+B and Mod+J all run `layout-set`, so `target` names the part each toggles: `sidebar`, `inspector` or `panel`.
  - **R8 (step 7's reviews), `target`:** only `section-open`, a section, and `layout-set`, one of those three parts, take a `target`; on any other command, or another part, an override is `VALIDATION_ERROR`, with a suggestion that says so. A `section-open` override whose section is not one of `section-open`'s is listed with `all` and is not in force.
  - **R6 (step 7's reviews), a person's own keys:** a key becomes a call only when the browser says a person pressed it (`isTrusted`). The shell resolves each key once and sends the winning action on: to the editor area for save, through a callback, never an event, and to the kernel for a command, whether or not any app's surfaces are loaded. A sequence ending on Mod+S runs the sequence, and saves nothing.
  - **R4, `when`:** `editor`, `sidebar` and `main` hold while focus is inside the active editor or that part, and the chrome decides them. `project` and `!project` follow whether the active scope has a project, and `documentType == <type>` the active editor tab's document type; the kernel decides those.
- **Amended (step 7), collisions:** two bindings collide on the same keys, or when one is a single chord and the other a sequence that begins on it. First to last by precedence, a binding whose keys collide with one in force before it, under the same `when`, is shadowed by it. Under different `when`s both stay in force, and the first whose `when` holds runs. Apps' bindings that collide are refused at load with `KEYBINDING_CONFLICT`, as phase 1's same chords were.

### 8.2 Matching a key (#877)

`event.key` is matched when it is a single Latin letter or digit; otherwise `event.code`. Function keys match `event.code`.

### 8.3 A person's overrides

- **Overrides** rebind or unbind any binding but `F6`, `Shift+F6` and `Escape` (`KEYBINDING_RESERVED`).
- **Warnings:** `loam-keybinding-editor` warns before shadowing a reserved chord or unbinding `Mod+K`.
- **Overrides are human (3.2).**
- **Amended (step 7):**
  - **What an override does:** it replaces every binding of its command and `target`, which `keybinding-list` names as what it shadows; `keys: null` only removes them. Its binding holds everywhere: an app's `when` does not come with it. It runs its command with no input, or `section-open` with its `target` as the section; an override of a command that is not registered, or that needs input, is listed with `all` and is not in force.
  - **F6 and Shift+F6** are neither rebound nor unbound: an override naming `shell-focus-next` or `shell-focus-previous` is `KEYBINDING_RESERVED`, as one binding F6, Shift+F6 or Escape is. A sequence beginning on a reserved chord is `KEYBINDING_RESERVED`, and one whose first chord has no `Mod` `VALIDATION_ERROR`.
  - **R5, who reads and writes them:** an agent's write is `HUMAN_REQUIRED` and a port's `CALL_NOT_GRANTED` (3.2); they are kept per workspace and person (3.4, amended).
  - **The editor** also warns before an override shadows any other binding on colliding keys, an app's not in force now included, and refuses before Add what the kernel would refuse.
  - **R7 (step 7's reviews), bare keys:** an override's single chord carries `Mod`, `Ctrl` or `Meta`, as an app's carries `Mod`, unless it is a function key (F1 to F24): `A`, `Enter`, `Shift+A` or `Alt+X` alone, which typing presses, is `VALIDATION_ERROR` with the suggestion to bind a chord with Mod or a function key, and the editor refuses it before Add. A sequence's second chord may be a bare key.
  - **Whose overrides (step 7's reviews):** the kernel holds a person's overrides with whom it read them for. While those are not the overrides of the person the shell is for (before the late load, before their read, or from the moment another person signs in), only F6 and Shift+F6 dispatch, and `keybinding-list` lists no override; a failed read keeps what was read only for the same person.
  - **The editor's warnings (step 7's reviews):** one of the person's own overrides on colliding keys is said too, with which wins (the earlier); Add checks the whole list it would write, as the kernel does.
  - **R9 (step 7's re-check), when overrides cannot be known:** if the late chunk fails to load, the reserved chords and the active app's apply with no overrides (D66: never the shell). A read of a person's overrides that fails is tried again, from half a second, doubling to 30 seconds; a change of person with no call of this page's, a session ending or another tab signing in, is heard through the adapter's `session-settle` and read too. Until they are known, only F6 and Shift+F6 dispatch, and Mod+S is held, so the browser's save dialog never opens, with a toast saying the keys are not ready. `keybinding-list` then lists nothing else as active, and the palette shows no command's keys: one readiness decides all three.
  - **The first-paint gap (R9):** until stage B reads the person's overrides, no rebindable chord runs, so Mod+K reaches the browser in that moment, as it did before any override existed in phase 0's first frame; only Mod+S is held.
  - **Stored entries a newer rule refuses** (the re-check's 8): read, they are dropped one by one and the rest kept, and `keybinding-list` gives `refused`, how many; the settings section still shows the stored value as no longer valid (3.3) until the person writes the list again.
  - **R10 (step 7's third round), what R6 covers:** R6 is about keys; same-page scripts are D54's. A script of the shell's own page can reach `shell.kernel` and call any command as the person, so its faked palette or switcher `change`, or a `MessageEvent` it makes for a view's channel, is trusted as that page is; a view's sandboxed frame cannot make events in the shell's page. Those paths are unchanged. `answerSave` and `onSaveRequest` are callbacks, never events a frame could send.
  - **A person changing under the keys (the third round's A):** the keys are not ready while the adapter names another person than the settle has reached, as while it reads the new person's membership: only F6 and Shift+F6, Mod+S held. An expired session still names its user, so the settled person's own stay in force until the settle ends it (the fourth round's 5); a sign-out names no one, and the keys are not ready until it settles (the fifth round's 5): no other person's overrides ever dispatch or show.
  - **A failure decides first (the fourth round's 2):** once the late load or stage B has failed, the reserved chords and the active app's apply with no overrides, even when the person's record could be read; `keybinding-list` lists them so, with no `refused`, and the palette shows their keys (the fifth round's 2).
  - **R11 (step 7's fifth round), a mounted command's eligibility fails safe:** `{}` must be proven to meet its advertised schema. `type`, `required`, `minProperties`, `properties`, `additionalProperties`, `allOf`, `anyOf` and `oneOf` (met exactly once) are decided; annotations (`$schema`, `$id`, `title`, `description`, `default`, `examples` and the like) assert nothing; any other keyword where it must decide (`$ref`, `$defs`, `definitions`, `not`, `enum`, `const`, `if`, `then`, `else`, `dependentSchemas`, an unknown one), or a `oneOf` branch it cannot decide, makes the command ineligible (`late/empty-meets.ts`).
  - **R12 (step 7's fifth round), the editor's warning comes from the resolver:** it runs the resolver's rule over the list the edit would write: the person's own first to last, one no chord can run (`keybinding-list`'s `idle`, 8.5) passed over, each kept unless its keys collide with one kept before it, which shadows it. Never from `active` alone: an override shadowed now may be freed by the edit. One the list does not name yet, an addition or an edit of its command, is presumed runnable until it is saved.
  - **Before the late load (the third round's B):** Mod+S is held, and its "keys not ready" toast is shown once the late load answers, since `toast-show` is a late command; the shell's own toast shows even when the person's settings record cannot be read, with the default preferences.
  - **AltGr (the re-check's 9):** a printable character a key makes with AltGr is typing, never a chord, though Windows reports AltGr as Ctrl and Alt both; before this step, `Mod+Alt+<key>` matched such a key on those layouts.

### 8.4 The reserved chords, version 1

Phase 0's seven, plus `Mod+Alt+P` for the project switcher (#857). P4-E9 asserts that the page receives it in Chromium. `Mod+,`, `Mod+Shift+I` and `Mod+Alt+T` were dropped as browser or desktop chords.

### 8.5 Commands

`keybinding-list { command?; target?; all?: boolean }` returns the bindings in force (with `all`, also the shadowed ones), ordered by keys: `{ bindings: Array<KeybindingV1 & { source: 'shell' | 'app' | 'you'; app?: string; shadowed?: Array<{ source; command }>; active: boolean }> }`. `keybinding` joins the shell's domains.

**Amended (step 7):**

- **In force** are the overrides, the reserved chords, the active app's and the active tab owner's bindings, none shadowed or replaced. With `all`, also those shadowed or replaced, an override not in force, and every other app's; `keys: null` overrides are not bindings and are not listed. Equal keys keep precedence's order.
- **`active`** is in force with the `when` terms the kernel decides holding (R4): `project` and `documentType`. The focus terms, `editor`, `sidebar` and `main`, count as holding, and the command's description says so.
- **`shadowed`** names the bindings an override replaced, then those its keys shadow.
- **`app`** is the instance whose command it runs: an app's binding, or an override of one.
- **R5, the callers:** those of `setting-list`, the person and the agent acting for them; an app gets `CALL_NOT_GRANTED`, refused in the handler too; it is of the `setting` category, so it is not served over MCP.
- **`refused`** (the re-check's 8): the number of the person's stored overrides a rule now refuses, dropped on read; absent when none.
- **Not known yet** (R9): while the person's overrides are not known, only F6 and Shift+F6 are in force and active.
- **`idle`** (R12): on one of the person's own that no chord can run, whatever its keys: no binding names its command and target, and the command cannot run from a chord now. One not in force without it is shadowed.

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
  - a push past 500 unread notices gives `QUOTA_EXCEEDED`, with `details: { kind: 'notifications', limit: 500 }`;
  - *amended by step 5's R1:* the 500 binds apps and agents together; the shell's own notices, as confirmations, count for neither side and are never refused.

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
- **Refused calls each journal an entry** (step 10's R4): every refusal at the port and at a frame's boundary is an `app-limit-refuse` entry, so a replay and `limit-usage-get` agree. An app calling past its rate therefore grows the journal by a small entry per refused call, bounded per entry and not in total; folding the refusals of one window into one counted entry would leave a nested refused call with no entry to answer it from, so a replay could no longer re-run the handler that made it. The journal's total budget, which would bound this, is #710's.
- **Resource reads in flight** (step 10's trust review): at most 4 per instance; the next is refused `RATE_LIMITED` with `details: { limit: 4, retryAfterMs }` and JSON-RPC `-32602`, as the frame gate answers, and counted under `callsPerSecond`, which `limit-usage-get` reports.
- **What `messageBytes` does not reach** (step 10's trust review): the browser clones a frame's message before any script sees it, so the cost of the clone itself comes before the bound; and a value cloned in a form JSON does not show (an `ArrayBuffer`, a `Map`) is measured, and used, as its JSON form.

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
- **Internal commands:** `overlay-global-set`, `experiment-settle`, `store-usage-settle`. **Amended (step 8):** and `autonomy-settle`, in `BOOT_ONLY` (4.2).

### 12.1 The manifest

| Key | Rule | Codes |
| --- | --- | --- |
| `ui.settings` | 3.1 | `MANIFEST_SETTING_SCHEMA`, `MANIFEST_SETTINGS_LIMIT`, `MANIFEST_SETTINGS_MOUNTED`, `MANIFEST_SETTING_DEFAULT`; `MANIFEST_SETTING_SECRET` warns |
| `ui.experiments` | 5.1 | `MANIFEST_EXPERIMENTS_LIMIT`, `MANIFEST_EXPERIMENT_DATE`; `EXPERIMENT_OVERDUE` warns |
| `requires_experiment` | 5.3 | `MANIFEST_EXPERIMENT_UNKNOWN` |
| `commands[].confirm_prompt` | 7.2 | For a mounted tool, still `MANIFEST_CONFIRM_UNAVAILABLE` |
| `ui.surfaces.keybindings[]` | 8.1. **Amended (step 7, R3):** the field stays phase 1's `chord`, now one chord or a sequence of two, with `when`, in manifest version 2 only, and no `target`, since an app binds its own commands; a version 1 manifest holding either is told the version (`MANIFEST_SURFACE_UNAVAILABLE`) | Phase 1's `KEYBINDING_RESERVED` for a reserved chord, for a sequence that begins on one, and for one that ends on F6 or Shift+F6 (step 7's reviews); `MANIFEST_KEYBINDING_KEYS` for a sequence whose first chord has no `Mod`; `MANIFEST_KEYBINDING_WHEN` for a `when` outside 8.1's terms, empty or over 200 characters included, which the schema leaves to the rule (step 7's reviews) |
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
| 7 | The key matcher | 600, 250. **Measured (step 7):** 3,384, 1,276, with the resolver moved into `late-settings`; after its reviews 3,510, 1,377 (its record) |
| **Total** | | **about 1,350, 550**. **Amended (step 7's reviews):** step 7 alone measured 3,510 and 1,377 (its record), so the phase's first paint is over this estimate by step 7's excess, each row raised under D115 |

| Row | Estimate |
| --- | --- |
| `late` | +5,000 |
| `late-settings` (new) | 26,000. **Measured (step 8):** 44,544 with the settings and autonomy, the row raised under D115. **Measured (step 10):** 50,583 with the limits (+5,795), raised to 51,000 |
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
| `MANIFEST_TITLE_RESERVED` | A manifest's `plugin.title` says "Loam" as a word (6.6, 12.1) | No | Title the app after what it does, without the shell's name |
| `DEPLOYMENT_TITLE_RESERVED` | A deployment's instance `title` says "Loam" as a word (6.6; step 3) | No | Title the instance after the app, without the shell's name |
| `OVERLAY_ANCHOR_NOT_FOUND` | An anchor that cannot be resolved | No | Set `data-loam-anchor` on the invoker |
| `OVERLAY_ELEMENT_VIEW` | `element` from a view | No | Use text, actions or a prompt |
| `OVERLAY_LIMIT` | A fourth dialog | No | Close one first |
| `OVERLAY_NOT_FOUND` | `palette-run` naming a prompt that is not open for that command | No | Open it again with `palette-run { command }` |
| `OVERLAY_ITEM_RESERVED` | An action or menu item that is a human or owner command | No | Let the person run it from the palette |
| `NOTIFICATION_ACTION_FOREIGN` | An action naming another app's command | No | Use one of this app's own commands as the action |
| `NOTIFICATION_ACTION_UNAVAILABLE` | An agent's notice with an action | No | Push it with a `link` instead, or call the command for a confirmation |
| `NOTIFICATION_NOT_FOUND` | A notice that is not the caller's person's, is in a scope the caller may not enter, or does not exist (step 5) | No | List your notices with `notification-list` |
| `CONFIRMATION_PENDING` | A confirmation from an agent or a background app is waiting | Yes | Tell the person it is in their inbox; read it with `confirmation-get` |
| `CONFIRMATION_DECLINED` | Declined, or declined within 60 s for the same input | No | Ask the person before trying again; do not repeat the call |
| `CONFIRMATION_EXPIRED` | In `confirmation-get`'s `result`, after 10 minutes unanswered | No | Ask the person, then call again to raise a new one |
| `HUMAN_REQUIRED` (from these commands) | A human-only write or answer | No | Names the route; `details: { route, section, key, level }` |
| `KEYBINDING_RESERVED` | Overriding F6, Shift+F6 or Escape. **Amended (step 7):** or rebinding or unbinding F6's or Shift+F6's own binding, or a sequence beginning on a reserved chord; an app's sequence ending on F6 or Shift+F6 (its reviews) | No | Bind another key |
| `KEYBINDING_ACTION_ONLY` | A reserved chord's action called as a command (8.1, R1; step 7) | No | Press its keys: `keybinding-list { command }` names them |
| `MANIFEST_KEYBINDING_KEYS` | A sequence whose first chord has no `Mod` (12.1; step 7) | No | Begin the sequence with a Mod chord, such as `Mod+G P` |
| `MANIFEST_KEYBINDING_WHEN` | A `when` outside 8.1's terms (12.1; step 7) | No | Use editor, sidebar, main, project, !project or documentType == <type>, joined by " && " |
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
| P4-E14 | **What exited stays exited** | Earlier phases' places | Phases 0 to 3's local exit tests, amended only as listed. **Amended (step 2):** phase 0's "shows the settings tooltip on hover and focus…" (`web/test/browser/accessibility.test.ts`) expects Settings in the rail enabled, its tooltip "Settings", and a press opening the settings section; phase 2's P2-E11 (`scope/rail.test.ts`) reads hello at manifest version 2. **Amended (step 10):** phase 2's P2-D4 "never reads a document's content but to move it" (`kernel/src/late/documents.test.ts`) allows at most one list of `app-probe`: the store quota lists an instance's table to count its rows' sizes when it has no usage row, and at stage B's daily recount (section 11); expiry reads each expired content row's charge to refund it. **Amended (step 10, after merging steps 4 and 5):** phase 2's P2-E7 "a view's store under Atlas reads nothing of Beacon's, and a `p~` key is refused" (`web/test/browser/scope/session.test.ts`) expects `hello-greet { name: 'p~…' }` to fail with the store's `VALIDATION_ERROR`, not `HANDLER_THREW`, since the trust review's blocker 9 answers a kernel refusal thrown into a handler as that refusal; nothing stored and Beacon's data unread, as before. **Amended (step 7):** phase 2's P2-E10 "holds no deployer's key in any reachable command's input schema" (`kernel/src/stores.test.ts`) and phase 1's 3.3 "gives no shell command an input key for a location, a credential or a command line" (`kernel/src/apps/mounted.test.ts`) exempt `keybinding-list`'s `command`, a filter it reads and writes nowhere, as step 8 exempted autonomy's; phase 2's P2-E11 "reads every document of version 1 as it did" (`manifest/src/profile.test.ts`) counts a keybinding's sequence and `when` among the version 2 keys; and phase 0's and phase 1's reserved chord lists (`kernel/src/palette-index.test.ts`, `chrome/src/keyboard.test.ts`) gain `Mod+Alt+P` (8.4). **Amended (step 7's re-check, R6):** phase 2's P2-D5 "Mod+S inside a view after a new edit, while its save is held, saves once more when it lands" and "a save asked again during a held save is dropped once its tab closes" (`web/test/browser/documents/references.test.ts`) press Mod+S inside the view as a person does, since the view SDK no longer asks on a script-made key; "forty save requests from a view while its save runs" posts the forty requests from the view's own script, as a hostile view may, its bound unchanged; phase 6's P6-D1 "the menu's Command palette opens the palette" (`desktop/test/boot.test.ts`) evaluates the menu's new script, the shell's `openPalette`. **Amended (step 7's third round, R9):** phase 0's "paints with the late chunk held, and runs a chord pressed before it answers" (`web/test/browser/boot.test.ts`) expects the early Mod+K to run nothing, and a fresh one after the keys are ready to open the palette |
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
| 11 | Exit | Every row and scenario; #710 re-scoped; follow-ups filed; the architecture amendments all applied | The check exits 0 |

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

**Asked 2026-11-13, and revised twice the same day after review.** The text is written to each recommendation. **Answered by the owner on 2026-11-18, each as recommended** (D154 to D158), so no section changes.

### Q1. Who sets a project's autonomy, within the owners' bounds?

Autonomy decides whether agents act on their own, ask first, or only suggest. Owners bound every project:

- **The workspace's own level.** A project can never be looser than it, unless an owner sets a higher ceiling.
- **Any rule for one app or one command.**

The question is who else may set a project's own level, which then stays within those bounds. "The project's creator" means whoever created it, and any member may create a project. The creator keeps this power only while they may still enter the project. For a project a team instance lists, only owners may (D87, D110).

- **Owners and the project's creator (recommended).** This matches D110. The creator can tighten their project, or loosen it as far as the owners allow, without waiting.
- **Owners only.** The strictest option.
- **Any member of the project.** The most self-service option. The tradeoff: one member can change, for everyone in the project, how far agents act unprompted, within the owners' bounds.

**Answer (the owner, 2026-11-18; D154): owners and the project's creator,** as recommended. The creator may set the project's own autonomy within the owners' bounds only while they may still enter the project; for a project a team instance lists, only owners may. 4.3 stands.

### Q2. May a person opt out of a workspace-enabled experiment?

- **Yes (recommended).** Nobody is held in an experiment they don't want.
- **No.** Everyone sees the same thing. The tradeoff: a person stuck with a broken experiment waits for an owner.

**Answer (the owner, 2026-11-18; D155): yes,** as recommended. A person may opt out of a workspace-enabled experiment. 5.2 stands.

### Q3. The default autonomy

Where nobody has set autonomy, the default decides what agents do. **It also bounds every project until an owner sets a workspace mode or a ceiling (4.2): a stricter default bounds every project's general row,** whose bound at write time is then `ask`. Until phase 5, nothing enforces it (D98).

- **Act on reads, ask before changes, and ask before any tool of a mounted server (recommended).** A mounted server labels its own tools, and that label can't be trusted. **Owners can loosen this** by setting the workspace's mode and ceiling higher.
- **Ask for everything.** The tradeoff: agents ask before every lookup, and people learn to click through.
- **Act on everything.** The tradeoff: agents change things unprompted, and every project may then act too, until an owner tightens it.

**Answer (the owner, 2026-11-18; D156): act on reads, ask before changes, and ask before any tool of a mounted server,** as recommended. Owners loosen it with the workspace's mode and ceiling. 4.2 stands. D145, decided after this question was asked, still makes a vouched server's reads `act`; phase 5's step 3 adds that to 4.2.

### Q4. May a person's agent write project-level settings?

Every member of a project reads its project-level settings.

- **No, people only (recommended).** This matches D110's "no agent changes who is in a project". In phase 4 it holds locally. On the hosted lane, everyone's project writes are refused anyway until phase 5 (section 13). After that, the hosted transport always acts as the person, so "no" is the only answer the hosted lane can serve.
- **Yes, as the person.** It could be served locally only, until phase 5 gives connected agents a way to write over MCP. The tradeoff: one person's agent changes what every member sees.

**Answer (the owner, 2026-11-18; D157): no, people only,** as recommended. A person's agent gets `HUMAN_REQUIRED`, with the hand-off, for a project-level write. 3.2 stands.

### Q5. Cut and rank the jobs

The fourteen jobs in [Jobs and scenarios](#jobs-and-scenarios) were proposed in this order, revised after the job-list walk.

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

**Answer (the owner, 2026-11-18; D158): the slice accepted as ranked,** then the seven jobs outside it in their order, none served to connected agents over MCP in phase 4.

## Proposed amendments to other phases

Each lands with the step named beside it; none landed with the approval or with the owner's answers of 2026-11-18.

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
- **Decision log:** D116 to D127, decided with this specification's approval on 2026-11-13.

| ID | Proposed decision |
| --- | --- |
| D116 | Settings: a closed schema subset with no `pattern`; three levels; resolution person, project, workspace, default. One `settingWriteRule`, with `level` required. Workspace values are an owner's; project values a person's who may enter the project (agents per Q4, answered as D157: never). Writes record `updatedBy`, `agent:<id>` for agents, and take `expected`. `loam.settings` is not a view-state id. The grant reads only the app's own sections. A `HUMAN_REQUIRED` hands off `{ route, section, key, level }` |
| D117 | Appearance, keybindings and the rail order are person settings. In `local`, appearance migrates on the first stage B and paints from `loam.settings`. In `provider`, it is per person, `loam.appearance.last` paints the signed-out page and stage A, and nothing migrates while signed out |
| D118 | Autonomy rows at workspace or project level, narrowed to an instance and a command. A project row is bounded by the workspace's ceiling, or its general row, or the default, and by its rows for that app and command; then by the person's cap. At write time a general or instance project row with neither a workspace mode nor a ceiling is bounded by `ask`. The default follows Q3 (answered as D156), with mounted tools at `ask`. Writes are human, refused in the handler with a hand-off, check access first, and refuse unknown commands; orphans are flagged to the owners who may enter the project. Advisory in phase 4, with a notice; enforced by phase 5, which also adds the "within limits" field |
| D119 | Experiments: an author's stage, `changes` and `ends`; enablement per person and per workspace, tied to the `changes` digest; opt-out per Q2 (answered as D155: yes). `experiment-settle` deletes the enablements of removed experiments at the manifest's apply. Gates decide presence. An unload never loses a dirty tab. Changes are announced |
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

## Step 1, 2026-11-18

The settings core, in [#1533](https://github.com/lushly-dev/afd/pull/1533), on `main` at `7f381a29`, after two independent reviews whose findings are answered below.

**Built.**

- **Manifest** (`packages/manifest`): `ui.settings` in `app-manifest.v2.json`, a key of version 2, with six closed definitions (`settingSection`, `settingLevels`, `settingSchema`, `settingKey`, `settingChoices`, `settingItems`); `settings.ts`, the types of 3.1, `checkSettingValue` (shared with the kernel's writes), and `settingRules`: `MANIFEST_SETTING_SCHEMA` (a shape outside the subset, `pattern`, `$ref`, `oneOf`, nesting, a key's levels outside its section's), `MANIFEST_SETTING_DEFAULT`, `MANIFEST_SETTINGS_LIMIT` (a ninth section), `MANIFEST_SETTINGS_MOUNTED`, `MANIFEST_DUPLICATE` for a repeated id, and the `MANIFEST_SETTING_SECRET` warning. The `settings` grant is served. Each code has a case in `profile-cases.json`.
- **SDK:** `SettingsV1` and `settingsOver`; `settings` on a handler's context (native and a view's handler frame) and a native surface's, with the grant.
- **Kernel interface 4:** `APP_CALLABLE_SHELL_COMMANDS_V2` (`setting-get` and `setting-list`, callable with the `settings` grant, for the app's own sections), `LoamKernelV4`, `KernelEventV4.settings` (the sections a call changed) and `ShellInfoV4`. Version 5 extends version 4; the shell reports 5.
- **`late-settings`** (`kernel/src/late/settings.ts`, `setting-rules.ts`, `setting-sections.ts`), loaded inside `loadLate` beside `late-identity`: the five commands of 3.9; the pure `settingWriteRule`, `isHumanGesture`, `resolveSetting` and `sharedRecordUnavailable`; the shell's `loam.appearance` and `loam.documents`; the person's `loam.settings` and the workspace store's `setting` table (3.4); the hand-off; `OWNER_REQUIRED`; `loam.documents.trashDays` written through to `WorkspaceV1.trashDays` (A-P2-2); section 13's `SHARED_RECORD_UNAVAILABLE`; appearance taken over in both modes (3.6, A-P3-2). Phase 3's lists (A-P3-1): `HUMAN_COMMANDS` gains `notification-act` and `palette-run`, the re-read decides by `needsMembershipRead`, and `emphasis.sections` gains `settings` and `inbox`. `setting-*` joins the commands decided at the call's scope, so a project the caller may not enter is `PROJECT_NOT_FOUND`, and none of them is in `mcpOptions()`.
- **Chrome:** the shell repaints when an event names `loam.appearance` or the person changes. A change of an app's own sections reaches its surfaces (3.8): a native surface's `settingsChanged(sections)` (`LoamSurfaceElementV1`), and a view's `ui/notifications/host-context-changed` with `dev.loam/settingsChanged` (`ViewHostContextV1`), only for an app with the `settings` grant and only its own sections (`chrome/src/apps/surface-calls.ts`'s `settingsHeard` and `deliverSettings`).
- **E3 in Chromium:** `web/test/browser/appearance-settings.test.ts` (`local` signed out: the old record painted from the first frame, moved, and read back) and `web/test/browser/identity/appearance.test.ts` (`provider`, through the test-only auth host: two people keep their own, and the signed-out page and a reload paint `.last`).
- **The runner:** `p4-base` in `kernel/scenarios/seeds.ts`; `kernel/src/scenarios.test.ts` runs phase 4's files from `scenarios/` here, as phase 5's step 1 left phase 5's in its own folder rather than moving them to `kernel/scenarios/`, with the same known-file guard and a table naming the step that makes each runnable. None runs in step 1: the three settings jobs need hello's `hello.general` (step 2), the rest later steps' commands.

**Decided while building it,** each amending the section named:

- **Where the person's record lives** (3.4): `loam.settings` (`loam.settings~<person>` in `provider` mode, `personalRecordId`'s id) is a row of the view-state store's table, as `loam.persona~<person>` is, and never registered with the view-state registry: `view-state-*` on it is `VIEW_STATE_NOT_FOUND` and `view-state-list` leaves it out by construction. Nothing of it is cached: every read and every write reads the row from the store, a write changes one key of what it read, and a read that fails fails the call rather than writing a record it never read. Only the appearance the shell paints is held in memory. `loam.appearance.last` is a row of the same table, and no view-state id either.
- **The alias** (3.6): `loam.appearance` stays a registered view-state id. Its read is the appearance the shell paints; its record is the old one, which stage A's `hydrate` reads; `view-state-set` on it writes the person's keys as `appearance-set` does (a merge writes only the keys it names), with the registry's result shape and undo, so `SESSION_50` replays unchanged.
- **What stage A paints** (3.6): the person's own keys, over the old record until it moves, over the defaults; signed out in `provider` mode, `.last` over the old record. A signed-in person with no value of their own paints the default, not `.last`.
- **The move** (3.6, R12): `LateParts.migrate`, after stage A has hydrated and stage B's commands are registered (and after the persisted state is read in a kernel with no boot), runs one `setting-set { level: 'person', migrated: true }` per key the old record holds and the person has not set, through a palette call past the queue that carries the kernel's own `migration` context field, which no caller can set and the journal keeps. `migrated` is accepted only on a call with that field, the move itself or a replay of its entry, for `loam.appearance` at person level, so a person's refused `migrated` is refused again when it replays; from anyone else, the person's own palette included, it is `VALIDATION_ERROR`. The old row is deleted only when every move succeeded and the record read back holds every key for the same person; otherwise it stays, painted, for the next stage B. Never in a replay, and in `provider` mode never signed out.
- **`.last`** (3.6, R4): written whenever a signed-in person's appearance is applied, after a write of `loam.appearance` and after a change of person, in a replay too (its store starts empty, so a signed-out `appearance-get` replays the same), and stamped with no call's clock. A paint carries a number: one overtaken by a later paint, or by a change of person while it read, paints nothing.
- **`expected`** (3.2) is compared with what the key shows at the level written, resolving from that level down, read from the store: an undo's stored value and a reader's resolved value both match. The settings writes (`setting-set`, `setting-reset` and appearance's) run one at a time, so a write's `expected` check, size check and store write are one step against the current row: of two overlapping writes with the same `expected`, one writes and the other is `SETTING_CONFLICT`, which is retryable, as section 16 says.
- **Results** (3.9): `setting-set`'s and `setting-reset`'s `value` and `from` are the caller's resolved value after the write, as the scenarios assert; `previous` is the value stored at that level before, `null` for none. The undo is `setting-set` with `previous` and `expected`, or `setting-reset` with `expected` when nothing was stored; `setting-reset`'s undo carries `expected` too, the value the level shows after the reset. Every read returns a detached copy, so no caller holds the kernel's schemas, defaults or stored values.
- **The order of a write's refusals:** `PROJECT_NOT_FOUND` from the scope middleware; then `SETTING_USE_AUTONOMY`, `SETTING_NOT_FOUND` or `SETTING_NOT_OWNED`, `SETTING_LEVEL_UNAVAILABLE`, `SETTING_PROJECT_REQUIRED`, `HUMAN_REQUIRED` with its hand-off, `SHARED_RECORD_UNAVAILABLE`, `OWNER_REQUIRED`, `PROJECT_ARCHIVED` (or an app's key in a project its app cannot open, the app's own refusal), `VALIDATION_ERROR`, `SETTING_CONFLICT` and `SETTING_TOO_LARGE`. The agent interface gets its hand-off before the hosted refusal, as section 13's third obligation has it refused before any request.
- **Output budgets** (3.9): TypeScript's AFD does not implement `outputBudget` yet (`spec/command-metadata.md`), and `toolMeta` may not carry a `dev.afd/` key. The budgets are declared in `SETTING_OUTPUT_BUDGETS`, and the kernel checks two in UTF-8 bytes, with or without a section named: `setting-schema-get` (16 KiB) and `setting-list` (64 KiB) answer AFD's `OUTPUT_BUDGET_EXCEEDED`, telling the caller to name a section, or within a named one a key.
- **`writable`** (3.9) is computed for the caller with every refusal a write would meet, the project's included (`PROJECT_ARCHIVED`, an app the project does not open); with no `level`, at the narrowest level the key allows in the call's scope, the person's, else the project's in a project, else the workspace's.
- **The manifest:** `ui.settings` is a key of version 2, since 12.1 adds no manifest version, and is refused under version 1 with the version, as phase 2's keys are. `ui.settings[].requires_experiment` is `MANIFEST_SURFACE_UNAVAILABLE` until step 9. `loam` is a reserved plugin id (`MANIFEST_ID_RESERVED`), since `loam.` is the shell's settings namespace. A section whose defaults alone are over 16 KiB is `MANIFEST_SETTING_SCHEMA`, since no value of it could ever be read or written; a section's and a key's titles and descriptions, and a key's enum values and titles, are display text, `MANIFEST_TEXT_INVALID` with a control or bidirectional character, as every other title is.
- **An app's sections:** a full id is `<plugin.id>.<id>`, so two instances of one app share them; one in the shell's `loam.` namespace is never listed; a disabled app's are not listed. Whose a section is comes from the app that declared it, never from a prefix of its id: the grant reads the sections the calling app's plugin declared, and never the shell's.
- **`needsMembershipRead`** (A-P3-1) lives in `late-identity`, exported from `kernel/src/late/session-settle.ts` beside the re-read it decides, and decides by `level: 'workspace'`, the level `settingWriteRule` makes an owner's for every section, rather than importing the rule across chunks.
- **The E2 sweep** (P4-E2, `scope/settings-sweep.test.ts`): twins whose person's theme differs, whose app's declared section differs at workspace and project level, whose `loam.documents.trashDays` differs, and whose `setting` table differs by stray rows of a section no app declares. Of an answer outside section 19's exemptions, only a setting's own value is left out: `view-state-list`'s `loam.appearance` alias's state and `workspace-get`'s `trashDays`. With it, "the type and the scan": `AccessInputV2`'s keys, and no setting read in the access decision, the scope middleware, the port's refusals and its list (but its two grant-gated names), the owner check, the auth gate or the human check.
- **The shell's sections:** `loam.appearance` and `loam.documents` only; 3.7's others arrive with the steps that build their editors and commands.
- **`loam.documents.trashDays`** (A-P2-2): the `setting` row and `WorkspaceV1.trashDays` are written in one store batch, so the value shown and the retention applied never diverge.
- **The host, for section 13:** decided from the deployment apart from its apps: a deployment the kernel was given names it at once (a version 4 file by its `host`, an older one `static`); with a boot, the projection stage B's loader reads. A `provider` deployment whose host is not known, before the loader answers, when it fails, or when a boot lists no app, counts as hosted and refuses shared writes: fail closed, since a provider is served by the hosted server (phase 6's `DEPLOYMENT_DESKTOP_PROVIDER` and `DEPLOYMENT_PROVIDER_NEEDS_HOST`).
- **The runner:** a `[scope: …]` after a caller binds that app's port to the scope, as a surface's port is bound, and a step whose setup `app-open` fails fails.

**Left for later steps:**

- **Step 2:** E1's Chromium check of `settingsChanged` with hello's sections (the delivery is step 1's, unit-tested); the settings section, the palette's setting rows and the custom editors; hello's sections; and `p4-base`'s apps, tally's count and the document. The kernel package cannot depend on the apps (their tests depend on `@lushly-dev/loam-testing`, which depends on the kernel), so step 2 seeds them from a package that may, or through fixture ports serving the built packages. Hello's experiment waits for step 9.
- **Steps 5 to 10:** the commands `HUMAN_COMMANDS` now names (`notification-act`, `palette-run`), and the rest of `APP_CALLABLE_SHELL_COMMANDS_V2`.
- **The architecture's other amendments** (the overlay policy and "agents open toasts only", the new commands and domains, experiments, the deferred `menus` surface, the exit and the glossary) land with their steps; section 4's settings levels with 3.3's precedence landed here.

**Measured.** D115, on Windows with Node 26.13.1: first paint 303,593 and 94,914 gzip, within its rows of 304,000 and 95,500 (section 14 estimated the step at 450 and 180). Raised, each to its measurement plus a margin: `kernelMinified` 116,800 to 118,000 (117,473); `lateMinified` 80,500 to 82,000 (81,246); `appsMinified` 395,700 to 417,500 (416,423), the manifest validator's `ui.settings` (`validate.generated.js` 329,227 to 357,289 bytes unminified). New: `lateSettingsMinified` 22,800 (20,698 plus 10%; section 14 estimated 26,000). `budget.mjs` records each. **Rebased onto `main` at `1465d4f5`** (phase 5's step 2 had raised `kernelMinified` to 118,000, `appsMinified` to 397,000 and first paint to 308,000 and 96,500 for its own code, and the Refined design had grown first paint and CSS): the kernel measured 118,693 and was raised to 119,500; first paint 307,956 and 96,069 gzip, inside phase 5's rows; `appsMinified` 417,099 of 417,500.

**Verified.** 2026-11-18, on Windows 11 with Node 26.13.1: every unit test of Loam's packages and apps (the kernel 957, the manifest 1,064, chrome 224, the SDK 25, `loam-host` 211 with an owner-only temporary directory, among them), their typecheck, `budget`, `pnpm lint`, and the repository's portability, file-size, orphan, version, test-config, quarantine, boundary and skills checks; nine Chromium files (84 tests: `appearance-settings`, `shell`, `accessibility`, `boot`, `layout`, `budget`, `identity/persona`, `identity/sign-in`, `apps/console`). **Not run:** the rest of `test:browser`, whose script first builds the Specimen host with Cargo, ruled out on this machine by a parallel session's Rust build; `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and its Cargo gates. CI runs them.

**After the reviews,** on the same machine: the kernel's units (974), the manifest's (1,068), the SDK's (30) and chrome's (226), every Loam package's and app's `test --coverage`, the typecheck of every Loam package and app, `node scripts/plugin-manifest.test.mjs` (its walker reads a `properties` map's values as subschemas, so a settings section's key map named `properties` is not mistaken for the keyword, and each settings definition is asserted closed), `pnpm test:tooling` (631) and `pnpm check` pass. `budget` passes with no row raised again: first paint 303,674 and 94,933 gzip; the kernel alone 117,594 (of 118,000); `late` 81,372 (of 82,000); `late-settings` 22,217 (of 22,800); `apps` 416,445 (of 417,500); `surfaces` 84,501 (of 85,000). Chromium: `identity/appearance.test.ts`, `appearance-settings.test.ts` and `apps/second-app.test.ts` pass. Not run: Cargo and Umbel.

**After the rebase onto `1465d4f5`,** on the same machine, a full `pnpm verify --keep-going`: `check`, every Loam package's and app's `test --coverage` (the kernel 978, the manifest 1,078, the SDK 30, chrome 226, `loam-host` 211 among them), the typecheck, `test:browser` (432 and conformance 24), `test:mounted` (31) and the desktop's cargo gates passed. `budget` failed on the kernel row, raised as above. `test:walk` failed seed 32 on a reload's 30-second wait, and `test:hosted` two cases (a wait and the first paint's requested files) while the machine was loaded; each passed run again alone, the walk 15 of 15 and the hosted suite 28 of 28.

## Step 2, 2026-11-18

The settings section and the palette, on `lush/loam-p4-step2-settings-ui` from `main` at `626187de` ([#1611](https://github.com/lushly-dev/afd/pull/1611)), after two independent reviews and a re-check, answered below.

**Built.**

- **The shell's own sections** (3.7, `kernel/src/late/setting-sections.ts`): `loam.rail` (`order`), `loam.keybindings` (`overrides`, human) and `loam.notifications` (`toastSticky`, and `muted`, human), beside step 1's `loam.appearance` and `loam.documents`. Their three list keys use shapes an app cannot declare, so a `KnownSectionV1` carries `checks` for them and `checkKnownValue` decides every write and every stored value with it, else with the manifest's `checkSettingValue`: `order` and `muted` are up to 64 distinct instance ids; `muted` never names `shell` or `agent:*` (`SETTING_MUTE_SHELL`); `overrides` are up to 64 `{ command, target?, keys }`, each binding once, `keys` one chord or two or `null`, and `F6`, `Shift+F6` and `Escape` are `KEYBINDING_RESERVED`.
- **The palette** (3.10): `palette-search { kind }` (`command`, `document` or `setting`); rows of `kind: 'setting'` with `name` (`<section>.<key>`), `section`, `key`, `title`, `description` and `app`, from an index `late-settings` builds on the first query that needs it and again when the known sections change. Each query filters for the call: a port sees its own app's sections only, and a project-only key shows only with a project in the call's scope and its app enabled there. The persona's `settings` emphasis puts setting rows first, as `documents` does document rows.
- **`section-open { section: 'settings', target }`** (3.5): `target` is `<section>` or `<section>.<key>`, refused as `setting-get` would refuse it, and becomes main's path `<section>[/<key>]`; `target` with `path`, or on another section, is `VALIDATION_ERROR`.
- **The rail order** (3.7, R8, D75): `app-list` gives each app the person's `loam.rail.order` names its `railRank`, and the rail's comparator puts those next after the persona's emphasis, before `order`; the shell refreshes the rail when an event names `loam.rail`.
- **The `settings` chunk** (`chrome/src/settings/`, `chrome/src/forms/setting-field.ts`): `loam-settings-section` at `~/settings` and `~/settings/<section>#<key>`, with a hand-written `tree` (APG's keys; the shell's group, then one per app), the level switcher as a tab list ("You, everywhere", "Workspace", "Project <name>", the levels the section has here, the narrowest first), and per key the field, where its value comes from, who set it and when, and Reset, which only a value set at the shown level enables. Every read and write is a command, a write with `expected`. The three custom editors: `loam-rail-order-editor` (Move up and Move down, focus following the app), `loam-instance-picker` (a checkbox per app) and `loam-keybinding-editor` (a chord recorded by pressing it, announced with any warning before it shadows a shell chord or leaves Mod+K unbound; Escape stops recording, Tab leaves). The router reads `~/settings/<section>#<key>` with the key as the fragment, and `formatRoute` writes it.
- **Hello** (`apps/hello`): manifest version 2 for the native and view manifests, the `settings` grant, `hello.general` (`greeting`, workspace and project, default `Hello`) and `hello.project` (`board`, project only, default `Guests`). `hello-greet` greets with the greeting that applies, read through the grant; `hello-main` shows it, with the board in a project, and reads both again on `settingsChanged`; the view reads the greeting on `host-context-changed` with `dev.loam/settingsChanged`.
- **`p4-base`'s apps** (`scenarios/p4-base.seed.json`, read by `kernel/scenarios/seeds.ts` and `apps.ts`): hello, tally and checklist from their sources, and a `console` instance, served through fixture ports; tally's count at 3 through `tally-add`; `doc_checklist0000001` in Atlas written to the store before the kernel starts. `setting-per-project`, `setting-from-palette` and `agent-changes-setting` run and pass.

**Decided while building it,** each a judgement a reviewer should check:

- **Where the form is** (section 1's `console` and `chrome` rows), **accepted by the coordinator on 2026-11-18**: the console's schema form does not move to `chrome/src/forms/`, since `@lushly-dev/loam-chrome` depends on `@lushly-dev/loam-console` and the console importing the chrome would be a package cycle. The form's model, `renderForm` and `readForm`, stays in the console, and the console and the settings section both use it. `chrome/src/forms/setting-field.ts` renders it with native controls, as the account and documents sections' fields already are (design.md). With the console's Violet controls the `settings` chunk measured 75,453 against section 14's 36,000; with native ones, 30,242. **Amends section 1 (step 2).**
- **How `p4-base` reaches the apps:** the kernel's package may depend on neither the apps (their tests depend on `@lushly-dev/loam-testing`) nor `@lushly-dev/loam-cli` (it depends on `@lushly-dev/loam-theme`, whose tests depend on the kernel). `apps.ts` imports the CLI's `readAppManifest` and each app's definition by path at run time, with specifiers the type checker does not follow: no package edge, no app built first, each manifest checked by the reader `app pack` uses. The apps, the document, the call and the seed's own checks are data in `p4-base.seed.json` beside the scenarios, so no kernel source names an app or a document type (P2-E13's E5 scans `kernel/src` for the second app; P2-D2 scans all of `kernel/`). No app package is named `console`, so `console` is a native fixture app with one query that the shell renders with its console.
- **The tree's order** (3.5): the shell's group is Appearance, Rail, Keybindings, Notifications, Documents; 3.5's list does not name the rail, so it sits beside Appearance. Autonomy, Experiments and Limits are absent rather than placeholders until steps 8 to 10 build them, as 3.5 says "those whose sections exist".
- **What the palette searches** (3.10): a setting row's name and title, not its description, since a short query's letters are found in a sentence by accident (`board` matched `muted`'s description). Ties of score order a command, then a document, then a setting, then by name; an empty query lists no setting rows, as it lists no document rows.
- **Where a key lives in the URL:** the hand-off's route is `~/settings/<section>#<key>` (step 1), so the key is the fragment; main's path is `<section>/<key>`, and only the settings section reads or writes a fragment.
- **The rail order and the persona:** the person's order comes after the persona's emphasis and before the deployment's `order`. Free ids: an id names no app now (one disabled may return) and is kept.
- **Stored now, effects later:** `loam.keybindings.overrides` is stored and checked, and the editor records a chord by 8.2's rule; no matcher applies an override until step 7. `toastSticky` and `muted` are stored and checked; their effects are step 5's. *Corrected by step 5:* this line said "steps 3 and 5", and the label this step gave `toastSticky` ("Keep toasts open", "Which toasts stay until you close them") promised toasts that stay open, which no step builds: under 6.1 the setting decides which toasts **also land in the inbox**. Step 5 reworded it "Keep toasts in the inbox".
- **The level shown** is the section element's own state, not a command: it reads `setting-list { section, level }`, which is.
- **A surfaces race made visible:** `app-list` now reads the person's record, which delays the surfaces' sync enough that a selection set straight after an open was forgotten as an older app's. The surfaces count selections and keep one set while the sync reads the list (`chrome/src/apps/surfaces.ts`).
- **Settings in the rail** (section 1's `chrome` row, 3.5), by the coordinator's ruling of 2026-11-18: the rail's Settings entry, dimmed since phase 0 with "Settings arrive in phase 4", opens the settings section, is `aria-current` while it shows, and names the page "Settings"; `SETTINGS_TOOLTIP` is gone from the chrome's exports. Phase 0's accessibility test is amended to match, listed against P4-E14.
- **P2-E11** (phase 2's `rail.test.ts`) read hello at manifest version 1; hello is version 2 for its settings, so the test reads tally at version 1 and hello and tasks at version 2. Phase 0 and 2's other exit tests are unchanged.

**Left for later steps:**

- **Step 5** (*corrected by step 5*, which built both; this line said "step 3 and 5"): the effects of `toastSticky` and `muted`. **Step 7:** the overrides applied, `Mod+Alt+P`. **Step 8:** the autonomy section, and `autonomy-set`'s hand-off for E1. **Step 9:** gated sections absent (the kernel's `sections()` is the seam), the experiments list, `experiment-*`'s hand-off for E1, and hello's `hello.inspector-v2`. **Step 10:** `loam.limits` with usage beside each key.
- **E1, waiting:** the `HUMAN_REQUIRED` hand-off's `details` from `autonomy-set` (step 8) and `experiment-*` (step 9). Every other part of E1's row is a unit (step 1's and `late/settings-shell.test.ts`) or Chromium (`web/test/browser/settings.test.ts`).
- **A tree over its budget:** superseded by the reviews' item 4: the tree reads `setting-schema-get { outline: true }` and an oversized section key by key (below).

**Measured.** D115, on Windows with Node 26.13.1, against step 1's figures: first paint 308,160 and 96,132 gzip, `jsMinified` raised from 308,000 to 308,500 (+204: the settings route and fragment, the rail's `railRank` and refresh, and Settings enabled in the rail, which removed the dimmed entry's tooltip); `lateMinified` 82,000 to 84,000 (81,372 to 82,866: the `kind` filter and the rows' merge, `section-open`'s target, `app-list`'s rail order); `lateSettingsMinified` 22,800 to 30,500 (22,217 to 27,782: the three sections and their checks, the index, the target and the rail order); `urlMinified` 5,700 to 6,400 (6,077: the section's sync and its fragment). New row `settingsMinified` at section 14's 36,000 (30,242). The manifest's settings checks, which `late-settings` and `apps` share, are named `setting-checks` so they never read as the `settings` chunk; `apps` 417,105 of 417,500, `surfaces` 84,993 of 85,000. `budget.mjs` records each.

**Verified.** 2026-11-18, on Windows 11 with Node 26.13.1: every Loam package's and app's `test --coverage` (the kernel 995, chrome 235, hello 8, the manifest 1,078, `loam-host` 211 among them; `web`'s units, 53, after the seed moved to its file), the typecheck of every Loam package and app, `lint:tokens` (chrome, console, hello), `node scripts/plugin-manifest.test.mjs` (47), `budget` and `pnpm check`. Chromium, the files this step adds or touches: `settings` (4, axe in three themes), `scope/url`, `scope/rail`, `scope/first-paint`, `apps/native`, `apps/second-app`, `apps/console`, `budget`, `shell`, `accessibility`, `appearance-settings` and `identity/appearance`. **Not run:** the rest of `test:browser` (its script builds the Specimen host with Cargo), `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and every Cargo gate. **After the coordinator's rulings** (Settings in the rail; the form's placement accepted): chrome's units (235), `lint:tokens`, `budget` (first paint 308,160) and nine Chromium files, 118 tests (`accessibility`, `shell`, `layout`, `scope/rail`, `scope/url`, `scope/first-paint`, `settings`, `apps/native`, `apps/second-app`).

**After the reviews,** 2026-11-18: two independent reviews of `8f6f11e0` (one asked for a revision, one approved with improvements). Each finding and what became of it:

1. **Palette rows and project access:** `palette-search` is not decided at the call's scope, so its setting rows now apply the actor's project-access decision themselves: a project the caller may not enter is treated as no project, in filtered and mixed searches alike, revealing nothing of it (`late/settings-shell.test.ts`, a restricted project, as a person and as an agent).
2. **An edit landing in another project:** every read and write of the section is made in the scope the panel shows (the call's `scope`), a write's level and `expected` with it, and a change of scope forgets the panel before it is read again (Chromium: the scope moved, then an edit to the old field; the new project is untouched).
3. **List editors erasing values:** a move in the rail order keeps every stored id not shown, at the end; a mute keeps the others in place; an override replaces only the one for the same command and target (`editor-rules.test.ts`, and in Chromium).
4. **One large section breaking the tree:** `setting-schema-get { outline: true }` lists each section and its keys by title with no schema, within the budget; the section reads the shown one whole, or key by key past the budget (`late/settings.test.ts`, the oversize fixture). This adds an optional input to 3.9's `setting-schema-get` (step 2).
5. **The keybinding editor:** the warning is said as soon as what is pending changes (the command, the keys, Unbind), Add is `aria-disabled` while the keys are F6, Shift+F6 or Escape, and every editor shows a value only once the section gives it back after the write; a failed write reads the panel again, so a retry has a fresh `expected` (Chromium: no row for the refused F6).
6. **Settings links:** a link within the section, `#<key>` by Back or a person's link, selects the key (the section hears `hashchange`, since the router leaves a fragment-only navigation to the browser), and a link to a key chooses the narrowest level the key's own `levels` allow here; hello's `general` gains `signoff`, a workspace-only key, for it (Chromium).
7. **The surfaces race:** the counter could still subtract a selection set before the queued sync started. The surfaces now read the entering app's selection from the kernel at every mount. `apps/native.test.ts`'s "reaches a selection set straight after an open" went red when `app-list` first read the rail order, before the first fix; its new neighbour, "reaches a selection set before the surfaces start to show the app", fails on the counter and passes on the read.
8. **Shared sections across instances: declined.** A second ready instance of a native or view app cannot exist: it is refused at load with `APP_DOMAIN_CONFLICT` (a domain is one instance's), `projects` is a mounted instance's alone (`DEPLOYMENT_INSTANCE_MISMATCH` otherwise), and a mounted app declares no section (`MANIFEST_SETTINGS_MOUNTED`). Code tracking several owners was written and dropped before it was committed, as it could never run; a comment in `sections()` says why one is enough.
9. **Two values shown wrong:** hello reads its board at project level, which a call at workspace level is refused, so outside a project it says nothing of a board; a free string may be set to `""`, read as such by the settings field, which does not mark it required (Chromium). The console's own reader is unchanged: its refusal of an empty required field is phase 1's tested rule (7.7), so the console part of this finding is declined.
10. **The tree** groups by the owning instance, the title only as its label, two of one title told apart by instance; `setting-schema-get` gives each app section its `instance` (step 2).
11. **Docs and names:** the port test now says what it shows (`palette-search` is `CALL_NOT_GRANTED` at a port; the in-handler filter is defence in depth); 3.10 names the tie-break; the comments and `section-open`'s example are narrowed.
12. **Tests:** an agent writing `loam.notifications.muted` gets `HUMAN_REQUIRED`; a project-only key of a disabled app is neither listed nor writable (a native or view app opens in every project unless disabled, so that is the case there is); axe over the rail editor and the instance picker, which found the Move buttons' names lacking their visible text, now "Move up: Tally".
13. **The index's cache key** includes each key's name, title, description and levels, and a row whose key is gone is skipped.
14. **Gates:** `loam.yml` runs on `endpoints/loam/docs/phases/*/scenarios/**`, and `scripts/affected/scope.mjs` gives the kernel's own tests phase 4's scenarios and seed file, hello's, tally's and checklist's sources and the CLI's `src/`. `pnpm verify --list --files …/p4-base.seed.json` printed "no path-filtered workflow is triggered" before, and now selects `@lushly-dev/loam-kernel` and `loam.yml`.
15. **`findBinary`** classifies a binary by its own directory, `release` or `debug`; a test under a `/release/` checkout fails on the old rule and passes.
16. **Accessibility:** the Record button keeps its name, `aria-pressed` alone saying it records, with the keys shown beside it; a field's failure is said once, by the section's status, its own line no live region.
17. **`seeds.ts`** points at `document-create`'s `recordOf` for the record's shape.

Measured after the fixes: first paint 308,160 and 96,130 gzip; `late` 82,865; `late-settings` 28,400; `url-sync` 6,077; `surfaces` 84,917 (76 fewer, the counter gone); `settings` 32,094. No row raised again.

**Verified after the reviews,** on the same machine: `test --coverage` for the kernel (1,000), chrome (238), hello (8), the console (82) and `web`'s units (53); the typecheck of every Loam package and app; `lint:tokens` (chrome, console, hello); `pnpm test:tooling` (642); `node --test scripts/umbel-components.test.mjs` (20); `budget`; `pnpm check`; and eleven Chromium files, 156 tests (`settings`, `apps/native`, `accessibility`, `shell`, `layout`, `scope/rail`, `scope/url`, `scope/first-paint`, `apps/second-app`, `apps/console`, `appearance-settings`). Not run: the Cargo-gated suites.

## Step 3, 2026-11-18

Overlays I, toasts, popovers and the F6 stop, on `lush/loam-p4-step3-overlays` from `main` at `99055637` ([#1616](https://github.com/lushly-dev/afd/pull/1616)), before review.

**Built.**

- **SDK:** `ToastInputV1` gains `sticky?` and `link?` (a `ResourceLinkV1`); `OverlayKindV1` gains `popover`; `PopoverInputV1` (an `info` popover's `title?` and `body`, or a `menu`'s `label?` and 1 to 12 `PopoverItemV1 { command; label; input? }`), `OverlayAnchorV1 { surface; anchor }`, `OverlayFromV1` (the owner line), `OverlayReasonV1` (6.2's ten reasons) and `OverlayResultV1.value` (a menu's picked item); `OverlaysV1.popover?`, served on a native surface's context.
- **Kernel interface 4:** `APP_CALLABLE_SHELL_COMMANDS_V2` and the port gain `popover-open`; `KernelOptionsV5.overlayAnchors` (`OverlayAnchorsV1`), the page's answer to an anchor.
- **The store** (`kernel/src/overlays.ts`): popovers beside toasts and modals, every overlay held with its owner's kind (shell, app or agent) beside its id; one popover on screen, the earlier closed `replaced`; `openAgentToast`, which pushes off only a toast that is neither the shell's nor `danger`; every popover closed on a switch, the shell's included, and the toasts a switch dismissed returned for the inbox; records returned detached; `landsInInbox`, 3.7's `toastSticky` rule, the seam step 5 pushes through. The `parked` state is step 4's, with the dialogs.
- **The commands** (`kernel/src/late/overlay-commands.ts`): `toast-show`'s strict `sticky` and `link`; the owner line, set by the kernel alone (an app's title as the rail shows it; an agent's id and the signed-in person's name, never an email, `null` signed out); `openerOf`, 6.1's paths (a port's `caller` is the app's; with none, the agent interface or any agent actor is `agent:<id>`'s, failing closed; anything else is the shell's); an agent's toast counted against `late/push-rate.ts`'s rate of 5 a minute, and refused `RATE_LIMITED` with `details: { limit: 5, retryAfterMs }` when over the rate or when the region holds only shell and `danger` toasts; `popover-open`, refused `HUMAN_REQUIRED` from the agent interface, `OVERLAY_OWNER_INACTIVE` from an inactive app, `OVERLAY_ITEM_RESERVED` for a menu item that is not the owner's own palette command, and `OVERLAY_ANCHOR_NOT_FOUND`; `overlay-dismiss { item }` for a menu's pick.
- **Chrome:** `loam-toast`'s owner line and link, a sticky toast's missing timer, and the region's `data-part="toasts"` while it holds a toast, the last F6 stop (`PART_ORDER`); `anchors.ts`, which finds `data-loam-anchor` in the owner's own native mounts of the named part, through open shadow roots, never in another app's, a view's frame or the shell's own chrome; and the `overlays` chunk (`chrome/src/apps/overlays.ts`): `loam-popover`, `popover="auto"` shown with its anchor as `source`, placed by `position-area` with flip fallbacks, a `dialog` or a `menu` (arrow keys, Home and End), focus moved in and returned to the invoker, Escape and light dismissal reported as the person's `overlay-dismiss`, and a pick dismissed as `confirm` with its `item` before the item's command runs as the person; a toast's link is formed there too.
- **Web:** `main.ts` gives the kernel and the shell one `overlayAnchors` object.
- **Architecture:** the overlay policy's toast and popover rows, and "agents open toasts only", with the owner lines.

**Decided while building it,** each amending the section named:

- **Anchors** (6.3): the kernel cannot see the page, so the host gives it `overlayAnchors`, which the shell answers once its surfaces attach. Given and not yet answered, no anchor resolves, and absent none does either: a test gives a resolver of its own, and a replay one that answers every anchor. An `OVERLAY_ANCHOR_NOT_FOUND` the page decided carries `PAGE_DECIDED`, so a replay answers it from the record; one the kernel decides (an app naming the `shell` surface, or the shell an app's) does not. `surface` is one of `main`, `sidebar`, `inspector`, `panel` and `shell`; `anchor` matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, so a selector needs no escape. A hidden or inert element anchors nothing. **A view anchors nothing yet:** its frame is another origin, which the shell cannot read, so it is refused `OVERLAY_ANCHOR_NOT_FOUND`, for step 4 to decide. The active tab owner's native editor anchors in its own editor mount, for `surface: 'main'`; an embed never does.
- **One per invoker** (6.1) is one on screen: the platform shows one `auto` popover at a time, so the kernel closes any earlier popover, whoever's, as `replaced`, and the chrome never reports a dismissal the person did not make. A popover whose anchor left the page is closed with a reason this step adds to 6.2's list, `anchor`.
- **Every popover closes on a switch** (6.1's "Closed"), the shell's too, not only the leaving app's.
- **A menu item** (6.4) is `{ command; label; input? }`, as 10.1's action is. The owner's own palette command is an app's, by the registry's owner, or the shell's, by `SHELL_COMMAND_NAMES`. A human or owner command is `OVERLAY_ITEM_RESERVED`, and so is a foreign, internal, boot-only or unknown one, with a message that says which. A pick is `overlay-dismiss { result: 'confirm', item }`, then the item's command through the palette interface, a human gesture. **`command` is one of `stores.test.ts`'s deployer keys** (a stdio mount's executable): its scan exempts this one path, `popover-open`'s menu item, as it does `agent-member-*`'s `access.projects`, **kept by the coordinator on 2026-11-18** (R-a).
- **A toast's link** is a document's or an app's with no `route`: `route` is also a deployer key, and an app link's route waits for a step that needs one. A link the page cannot open shows none.
- **Agent toasts** (F7): the rate counts only a toast that opens; a full region's `retryAfterMs` runs until the soonest timed toast times out, on the call's clock, or a minute when all five are sticky. The rate lives in `late`, reset on a reload, for step 5's `notification-push` to share. An app's sticky toasts count against its rate of 10 only once they land in the inbox (step 5).
- **Owner lines** (6.6): a modal's is step 4's, with the slot, so `modal-open` stores none yet. An agent's names its actor's label or id; a page no one is signed in to reads "for you".
- **The agent's `modal-open`** still opens as the shell's: 6.1's modal column is step 4's, with 6.5's answer rule; this step changes only the toast and popover columns.
- **Escape** closes a popover from its own key handler, since the shell's keys would take the close request first; the rail's tooltip still takes the first Escape while it shows (WCAG 1.4.13).

**Left for later steps:**

- **Step 4:** dialogs, modals' and prompts' paths, the slot, 6.5's answer rule and F6's `HUMAN_REQUIRED` cancels; the `parked` state; a modal's owner line; a view's and an editor's anchors.
- **Step 5:** a sticky toast's notice, through `landsInInbox` and the shared push rate, with the person's `loam.notifications.toastSticky` (3.7); a sticky toast's **Open inbox** (6.7). *Corrected by step 5:* this line said step 1 had not registered the section and that registering it was step 2's; step 2 had registered it (with its label corrected by step 5, see step 2's record), and step 5 reads the person's value.

**Measured.** D115, on Windows with Node 26.13.1: first paint 308,140 and 96,115 gzip (+184 and +46 on `main`'s 307,956 and 96,069; section 14 estimated 300 and 120), its row raised from 308,000 to 308,400, with `first-paint.test.ts`'s literal; `lateMinified` 82,000 to 88,500 (87,930, +6,558, over section 14's +5,000 for the whole phase); `surfacesMinified` 85,000 to 88,200 (87,677, +3,176). New: `overlaysMinified` 6,970 (6,336 plus 10%, at 58% of section 14's 11,000). `budget.mjs` records each.

**Verified.** 2026-11-18, on Windows 11 with Node 26.13.1, before the reviews: `test --coverage` for the kernel (998), chrome (227), the SDK (30) and web (53); the typecheck of every Loam package and app; `budget`; ten Chromium files (107 tests: `apps/popovers`, new, with `apps/overlays`, `apps/accessibility`, `apps/second-app`, `apps/view`, `shell`, `accessibility`, `identity/sign-in`, `scope/first-paint` and `budget`); and `pnpm check`, whose lint failed once on a format nit, fixed, after which `pnpm lint` passed. Not run: the rest of `test:browser` (its script builds the Specimen host with Cargo), `test:walk`, `test:mounted`, `test:hosted`, the desktop suite, Cargo, `loam.yml` and `pnpm verify`.

**After the reviews,** 2026-11-18, two independent reviews of `44e6b48a` and the coordinator's rulings R-a to R-d. Each amends the section named, and supersedes what the record above says otherwise:

- **R-a, the `stores.test.ts` exemption:** kept, for a menu item's `command`, a command's name.
- **R-b, the agent rate** (6.1, 10.2): "per agent" becomes **per agent interface, per person, the copilot apart**. The agent name is the caller's own choice, so every agent the interface names for one person counts in one bucket of 5 a minute; the copilot, whose identity only the kernel mints, has a bucket of its own. Step 5's `notification-push` shares the same buckets.
- **R-c, `MANIFEST_TITLE_RESERVED`** (6.6, 12.1), built now: a manifest's `plugin.title` that says "Loam" as a word is refused, and a deployment's instance `title`, the rail's label, is `DEPLOYMENT_TITLE_RESERVED`, a code this step adds. The owner line never shows such a title even if one reached it (its instance id instead), and two instances with one title are told apart by the instance id after it.
- **R-d, the owner's kind:** the store holds every overlay's owner as a kind (shell, app instance or agent) and an id, and admission, anchors, menus, the owner line, `overlay-list`, `overlay-dismiss`, a switch and `waitOverlay` decide by the kind, never by an id compared with `shell`. `shell` and `loam` are reserved instance ids in every deployment version (`DEPLOYMENT_INSTANCE_RESERVED`), and reserved agent names, as is an agent named as one of the workspace's apps by instance or plugin id (`AGENT_NAME_RESERVED`).
- **A change of person** (6.2), in `local` and `provider` modes, closes every overlay, sticky toasts included, with `reason: 'person'`.
- **Menus** offer only the owner's commands the palette lists (`expose.palette`); an item's input is checked against its command's schema when the popover opens, `VALIDATION_ERROR` with the item's index; a pick that fails shows the person a toast with its message and suggestion.
- **The shell's** overlay is only a human gesture's (step 1's `isHumanGesture`); any other call with no `caller` that is not the agent interface's opens nothing (`HUMAN_REQUIRED`), and neither `toast-show` nor `popover-open` is served over MCP.
- **The first app opened from a shell section** closes the shell's popovers, as any switch does.
- **An agent's owner line** names the person by name, never an email (a name holding `@` reads "for you").
- **An agent confirms nothing:** its `overlay-dismiss { result: 'confirm' }`, an item's pick among them, is `HUMAN_REQUIRED`; it may cancel or dismiss. The rest of 6.5's answer rule, F6's cancels of the shell's overlays, stays step 4's.
- **The SDK's `ToastInputV1.link`** is `ToastLinkV1`, what `toast-show` takes: no document `anchor` and no app `route`.
- **A journal recorded before this step** that holds an agent's toast replays with one named difference, at `toast-show`'s `data.owner` (`shell` then, `agent:<id>` now), reported as `REPLAY_DIVERGED` with that path, as `overlay-paths.test.ts` shows. No shape version marks such entries, and phase 4's exit replays only its own sessions, so this step keeps the difference named rather than reading old entries apart.
- **Section 14's `late` row, re-estimated:** step 3 alone spent +6,558 of the phase's +5,000, and its fixes more. The rest of the phase adds, by its plan: step 4's dialogs, prompts and the slot, about 6,000; step 5's inbox commands, about 7,000; step 6's confirmations, about 8,000; steps 7 to 10, about 4,000 between them where their code is not in a chunk of its own. So `late`, from `main`'s 81,372, ends near **116,000**, not the 86,500 the row implied; each step raises it by its measured cost under D115, and step 11 records the total.

**After the focused re-check of `fd87c442`:**

- **B1, anchors stay in the owner's surface** (6.3): an app's search stops at any other surface below its own mount, another app's `loam-mount` or `loam-embed`, or a view's frame, as the shell's does, so no app anchors on, or probes, what another shows.
- **I1:** only a tab's own editor mount, marked by the editor frame, anchors in main; the inspector's document details and an embed never do.
- **I4, "Loam" as a word** is one rule, the manifest's `saysShellName`, used by `MANIFEST_TITLE_RESERVED`, `DEPLOYMENT_TITLE_RESERVED` and the owner line: read after NFKC, with invisible format characters (Unicode `Cf`, U+200B among them) removed and `_` read as a separator, so `Loam_Notes` and `Lo\u200bam` say it and `Loamy` does not.
- **I5:** an owner line never falls back to a name that says it: the title, then the instance id, then the plugin id, then "an app"; a twin's instance id is left out when it says it.
- **`reason: 'anchor'`** closes a popover only, and only from the shell's own call (a human gesture); anyone else's is `VALIDATION_ERROR`.
- **Section 16** lists `MANIFEST_TITLE_RESERVED` and `DEPLOYMENT_TITLE_RESERVED`, and phase 2's deployment table the reserved ids and the title.

**Verified after the reviews.** 2026-11-18, on Windows 11 with Node 26.13.1: the units with `--coverage` of the kernel (1,010), the manifest (1,083), chrome (227) and the SDK (30), and web's (53); the typecheck of every Loam package and app; chrome's `lint:tokens`, after the popover's two raw lengths became the shell's size tokens; `budget`, with `lateMinified` raised under D115 from 88,500 to 91,000 (90,158, +2,228 for these fixes; `apps` 417,348, `surfaces` 87,943 and `overlays` 6,608 within their rows); ten Chromium files (108 tests, `apps/popovers` with a change of person added; the chrome now re-reads its overlays after a sign-in, a sign-out or a settle, so a `local` page no longer keeps a closed toast on screen); `test:walk` alone, 15 of 15, after the coordinator's run had timed out seed 6221072 in `openPage` under load; and `pnpm check`. Not run: the rest of `test:browser`, `test:mounted`, `test:hosted`, the desktop suite and Cargo, which the coordinator's `pnpm verify` before these fixes passed. A Chromium check of a native editor's anchor and of a failed pick's toast is not written: both are unit-free chrome paths, for step 4's review to cover.

## Step 4, 2026-11-19

Overlays II, dialogs, modals, prompts, the slot and the answer rule, on `lush/loam-p4-step4-overlays` from `main` at `42f9e1c1`, before review.

**Built.**

- **SDK:** `OverlayKindV1` gains `dialog`, `prompt` and `global`; `OverlayActionV1 { id; label; tone?: 'primary' | 'danger'; default? }`; `DialogInputV1`, `PromptInputV1` with `PromptSchemaV1` (one `PromptFieldV1`, or an object of up to 12 of them), `GlobalInputV1`; `ModalInputV1.actions?` and `element?`; `OverlayV1.state?: 'parked'` and `for?`; `OverlayResultV1.result` is `confirm`, `cancel`, `dismissed` or an action's id, and `value` is `unknown` (a menu's index or a prompt's value); `OverlaysV1.dialog?` and `prompt?`, each resolving when it closes, as `modal` does.
- **Kernel interface 4:** `APP_CALLABLE_SHELL_COMMANDS_V2` and the port gain `dialog-open` and `prompt-open`; a view's prompt shares its modal's one-at-a-time hold and cooldown (#1054).
- **The store** (`kernel/src/overlays.ts`): the slot is `modalOpen()`, the open modal or prompt; `dialogsOf(owner)` counts open and parked dialogs; a switch parks the leaving app's dialogs (`park`) or, with `cancelOnLeave`, cancels them; `restore(instance)` opens them again (`restore`) when `app-open` makes the app active or its tab becomes the active one; `movesOf` keeps an overlay's moves; `for` is kept only on the shell's own prompts, whatever an option says; `setGlobal` keeps one strip per id, `replaced` by its next and `withdrawn` when its condition ends; `closeAll('person')` closes parked dialogs and strips too.
- **The commands** (`kernel/src/late/overlay-slot.ts`, new, and `overlay-commands.ts`): `dialog-open`, `modal-open` and `prompt-open` on 6.1's table, a person's gesture the shell's, the active app's or tab owner's port the app's with its owner line, an inactive app's `OVERLAY_OWNER_INACTIVE`, and the agent interface (the copilot an agent on it) or any other path `HUMAN_REQUIRED`: **the agent's `modal-open` no longer opens as the shell's**. `OVERLAY_LIMIT` on a fourth dialog of one owner; `OVERLAY_MODAL_BUSY` from `modal-open`, `prompt-open` and `palette-open` while the slot is held, and a switch held by the shell's prompt as by its modal. `OVERLAY_ELEMENT_VIEW` for a view's `element`. The internal `overlay-global-set`, only on a person's path, never listed or served over MCP. None of the five openers is served over MCP.
- **6.5's answer rule** in `overlay-dismiss` (`answerRule`): a person's gesture answers anything; the owning app answers its own; anyone else only cancels or dismisses an app's or an agent's overlay; **the shell's own close only by a person's gesture, or by the caller its `for.caller` names, whose cancel ends it `withdrawn`** (F6), so the agent's and an unrelated port's cancel of a shell prompt are `HUMAN_REQUIRED`, with `details: { route: 'shell', overlay }`. A result names one of the overlay's answers (its actions with `cancel`, or `confirm` and `cancel`); a prompt's confirm carries a value the kernel checks against its schema, `VALIDATION_ERROR` with the prompt left open.
- **Chrome:** `loam-modal` renders the slot with `showModal()` and `aria-modal`, and each open dialog with `show()`, non-modal, stacked at the inline end; it shows the owner line, the actions (the default focused, cancel first on `danger`), a prompt's fields (`prompt-fields.ts`, native controls on the field tokens, labelled, `aria-required`) or a native app's element in a `loam-mount` under its registry, and what the kernel refused, in place (`role="alert"`). A parked dialog is not shown. `loam-global` holds the strips under the title bar, each a polite `status`. The chrome re-reads overlays after `dialog-*` and `prompt-*`, and a leaving view's frame may open no overlay of any kind.
- **Architecture:** the overlay policy's dialog, modal, prompt and global rows, and "agents open toasts only", now true.

**Decided while building it,** each amending the section named:

- **A view anchors nothing** (6.3): its frame is another origin, so the shell can find no element in it; `OVERLAY_ANCHOR_NOT_FOUND` stays, as step 3 built it. A view that needs one uses a toast, a dialog or a prompt.
- **`element`** (6.4) is a custom element's name, defined in the app's own registry, mounted under the body with the app's context and a surface port of the active scope, never an anchor owner; one the app did not define shows phase 1's `APP_ELEMENT_UNDEFINED`. The shell's own overlays take none (`VALIDATION_ERROR`). With `actions`, its answers are still the buttons: the element shows, and does not answer.
- **Actions** (6.4) replace confirm; cancel stays, unless an action is `cancel`. An id is `^[a-z][a-z0-9-]{0,31}$`, unique, never `dismissed`, at most one the `default`.
- **A prompt's `schema`** (6.4) is plain fields, `string`, `number`, `integer` or `boolean`, with `enum`, `minLength`, `maxLength`, `minimum` and `maximum`, and **no `pattern`**, since an app gives the shell no regular expression (section 17). With none, the value is one line of text of up to 1,000 characters. A value is at most 16,384 characters as JSON.
- **The global strip** (6.1): `{ id; message?; tone? }`, no `message` closing it (`withdrawn`); no one dismisses it, `VALIDATION_ERROR`; a change of person closes it with everything else, and the condition's owner sets it again.
- **F6's rule covers every shell overlay**, not only prompts: an agent or a port may no longer dismiss the shell's toast, popover, dialog or modal (`HUMAN_REQUIRED`, where an app's port had `OVERLAY_NOT_OWNER`).
- **Dialogs are not in the top layer** (6.1, 6.3): `show()` leaves a dialog in the shell's tree, so it sits above the parts by `z-index.popover` and goes inert under a modal, as a non-modal surface should; 6.1's placement says so since the review.

**Left for later steps:**

- **Step 6:** the kernel's own prompts with `for` (7.1 to 7.3): `palette-run`, a confirmation in the slot with its header as part of its name, and the close prompt, which open through `overlays.open(SHELL, 'prompt', input, { for })` and are closed by the rule built here; `palette-run`'s `HUMAN_REQUIRED` and `CALL_NOT_GRANTED`; `OVERLAY_NOT_FOUND` from a stale `prompt`.
- **Step 5:** a toast's inbox notice (`landsInInbox`), unchanged.

**Measured.** D115, on Windows with Node 26.13.1, against `main` at `42f9e1c1`: first paint 308,987 (+21) of 309,500 and the kernel alone 118,973 (+79), within their rows; `lateMinified` 93,000 to 103,000 (92,316 to 102,425, +10,109, over the step's re-estimated 6,000: three commands' written JSON Schemas, the prompt's field schema and value check, and the answer rule); `lateEditorMinified` 15,305 to 15,400 (15,336, +32); `surfacesMinified` 88,200 to 97,000 (96,469, +8,526 on step 3's 87,943: the slot's and a dialog's renderer, the prompt's fields and `loam-global`). The `overlays` chunk is unchanged at 6,608: this step's chrome is in `surfaces`, with the modal it extends. `budget.mjs` records each.

**Verified.** 2026-11-19, on Windows 11 with Node 26.13.1, before the reviews: `test --coverage` for the kernel (1,058, 18 of them new in `overlay-slot.test.ts`), the manifest (1,103), chrome (243) and the SDK (30), and web's (53); the typecheck of every Loam package and app; chrome's `lint:tokens`; `budget`; eleven Chromium files (156 tests: `apps/dialogs`, new, with `apps/overlays`, `apps/popovers`, `apps/accessibility`, `apps/view`, `apps/second-app`, `shell`, `accessibility`, `documents/editor`, `scope/first-paint` and `budget`), `apps/dialogs` covering step 3's two deferred cases, a native editor's anchor and a failed menu pick's toast; `check-doc-lines`; and `pnpm check`. Not run: the rest of `test:browser`, `test:walk`, `test:mounted`, `test:hosted`, the desktop suite, Cargo, `loam.yml` and `pnpm verify`.

**After the trust review,** 2026-11-19: two independent reviews of `ae831bc8` (both "revise": 3 and 9 blockers) and the coordinator's rulings R1 to R4. Each amends the section named, and supersedes what the record above says otherwise:

- **R1, another app's overlay** (amends 6.5): "anyone else may only cancel or dismiss" means the shell's own non-human paths and the agent interface, never another app. An unrelated app's port gets `OVERLAY_NOT_OWNER` for any answer, cancel or dismiss of another app's overlay, as phase 1 has it. An explicit `result: 'dismissed'` is accepted wherever leaving the result out gives `dismissed` (a toast, a popover). The architecture's paragraph says the same.
- **R2, MCP:** `overlay-dismiss` and `overlay-list` join the overlay commands no MCP caller is served, so its `none` path neither lists nor closes an overlay.
- **R3, chunks:** dialogs, a prompt's fields and `loam-global` move into the lazy `overlays` chunk (`chrome/src/apps/questions.ts`), which loads with the first popover, dialog, prompt or strip; phase 1's modal shell stays in `surfaces`. `main` and the branch were measured again from clean builds in one tree (below).
- **R4, gates:** the coordinator runs `pnpm verify` on the final head.

**Fixed,** by the reviews' numbers:

- **1, the specification:** a replacement holding `` $` `` had copied the whole specification into this record. It was rebuilt from `main`'s text with only this step's additions, and Markdown is no longer written through a string replacement.
- **2, the answer path:** a question is answered only by a person's trusted press on a button it drew, or their Escape, through a private `onAnswer` its renderer set, with its own id; no event carries an answer or a value, so neither an app's `element` inside it nor any other element answers as the person (a forged `loam-modal-result` and a script's `click()` answer nothing, in Chromium). The editor's discard hears only what the kernel accepted (`hearAnswers`, in first paint, which the `surfaces` and `editor` chunks share). The rest of the page, which can reach `shell.kernel` itself (D54), is unchanged.
- **3, a view's waiting question:** a view's `modal-open` or `prompt-open` held behind its open one is refused `SESSION_CHANGED` when a change of person or a reload came while it waited, and the slot stays empty. `reason: 'timeout'` is the shell's toast timer only: anyone else's, or on another kind, is `VALIDATION_ERROR`, so no view passes it to close its modal without the cooldown.
- **4, a tab's owner:** the chrome reads overlays again after any `editor-*` call, `document-open` and a change of main, so a dialog parks and returns with its app's tab (Chromium, between a note and a checklist).
- **5, scope** (D83): an app's dialog, modal or prompt records the scope it opened in (`OverlayV1.scope`); its element's mount takes that scope, never the active one; a change of scope cancels, `app-switch`, every app's question opened in another, parked dialogs included, so none is restored in another project. **Chosen:** cancel, not keep: a parked dialog's element and port were bound to the scope left.
- **6, the reused `<dialog>`:** the `close` the shell's own `hide()` queued never reports, whenever it arrives, so closing one question and opening the next at once cancels nothing.
- **7, a view's answer:** `dev.loam/overlay-result { overlayId }`, the view SDK's `overlayResult`, answers a view its own overlay's result; another owner's id is `OVERLAY_NOT_OWNER`, tested through a real view frame.
- **8, a prompt's value:** the answer is exactly what was submitted, never the prompt's starting value: none, or `null`, fails the schema; a cleared number is left out; a schema-valid empty text is kept.
- **10, focus:** a dialog takes no focus when it opens (`show()` would move it; it goes back). **For step 6:** a prompt with `for` must not focus confirm, but cancel or the dialog, so a person typing elsewhere cannot confirm with Enter.
- **11 to 16:** dialogs restacked on every render; the strips one persistent polite live region whose text changes, never hidden; 6.1's placement for a dialog and the strip corrected (neither is in the top layer: `show()` keeps a dialog in the shell's tree, where a modal makes it inert, and the strip is fixed under the title bar above the parts); a schema whose bounds cross, or whose choices are not of its field's type, refused, and a `select` with no starting value picks nothing; `element` refused from any app that is not native, a mounted tool's too (`OVERLAY_ELEMENT_VIEW`); a `cancel` action may not be `danger` or the default; the overlay state between switches journaled through `overlay-list`, so a replay compares each park and restore.

**Measured again,** D115, `main` at `42f9e1c1` and the branch from clean package builds in one tree, on Windows with Node 26.13.1: first paint 308,966 to 309,167 (+201) and 96,387 to 96,477 gzip, within their rows; `late` 92,316 to 103,981 (+11,665), its row 93,000 to 104,500; `apps` 417,370 to 418,055 (+685), 417,500 to 418,500; `view` 26,043 to 26,236 (+193), 26,100 to 26,400; `surfaces` 87,996 to 93,192 (+5,196), 88,200 to 93,500; `overlays` 6,608 to 10,766 (+4,158, at 98% of section 14's 11,000), 6,970 to 11,000; `late-editor` 15,304 to 15,336, within 15,400; `editor` 35,393 to 35,361. The record's first `surfaces` figure, 96,469, read a stale chrome build.

**Verified after the review.** 2026-11-19, on Windows 11 with Node 26.13.1: `test --coverage` for the kernel (1,064), chrome (243), the SDK (30), the manifest (1,103) and web (53); the typecheck of every Loam package; chrome's `lint:tokens`; `budget`; `check-doc-lines`; `pnpm check`; Chromium: `apps/dialogs` (9) and `apps/view` with its new frame case, beside `apps/overlays`, `apps/popovers`, `apps/accessibility`, `apps/second-app`, `shell`, `accessibility`, `documents/editor`, `scope/first-paint` and `budget`. Not run here: `pnpm verify`, `loam.yml`, `test:walk`, `test:mounted`, `test:hosted`, the rest of `test:browser` and Cargo, which the coordinator runs (R4).

**After the trust re-check,** 2026-11-19, which approved `052911c0`; its three improvements:

- **The chrome's re-read** follows only the calls that move the active tab's owner (`editor-activate`, `-close`, `-move`, `-pin`), `document-open` and a change of main, never a caret's `editor-selection-set`, `editor-dirty-set` or `editor-get`, each of which journaled an `overlay-list`.
- **A view's cooldown** (#1054) begins only on a person's own close, which the store now records: an agent's or the app's own cancel starts none, so a held view modal opens after it; `surface-port.test.ts` asserts that again, beside the switch's `OVERLAY_OWNER_INACTIVE`.
- **`SESSION_CHANGED` is `retryable: false` here,** though phase 3's table calls it retryable: there it answers a call whose session changed under it, which the same caller may send again as the new person; here the question was raised for the person who left, and opening it again for the next one is the app's decision, never an automatic retry, so the suggestion says to ask again only if the new person should answer.
- **Headroom is tight,** for the next steps to plan for: first paint's gzip 96,477 of 96,500 (23 bytes), and with `main` at `8c3425d8` merged 96,527, its row raised under D115 to 97,000 (96,436 on that `main`, +91), and with step 8 merged (`main` at `254249c3`, 96,461) 96,551 of 97,000; `late` with step 8 merged 105,000 (93,244 on that `main`, +11,756), its row 105,500 (500 to spare); `late` 103,981 of 104,500 (519); `overlays` 10,766 of 11,000 (98%).

## Step 5, 2026-11-19

The inbox, on `lush/loam-p4-step5-inbox` from `main` at `42f9e1c1` (steps 1 to 3 merged), before review.

**Built.**

- **SDK:** `NotificationV1`, `NotificationActionV1`, `NotificationInputV1`, `NotificationsV1` and `notificationsOver`, served on a native surface's context as `notifications`; `OverlayRefV1.notification`, the notice a toast also landed as.
- **Kernel interface 4:** `APP_CALLABLE_SHELL_COMMANDS_V2` and the port gain `notification-push`.
- **The record and the commands** (10.1, 10.2), in `late-settings` (`kernel/src/late/notifications.ts`), as section 1 places them:
  - the workspace store's `notification` table, listed by `person`;
  - `notification-push`, `-list`, `-read`, `-archive` and `-act`, each decided at the call's scope (`AT_CALL_SCOPE`), so a project the caller may not enter is `PROJECT_NOT_FOUND`; none is served over MCP;
  - `source` from step 3's `openerOf`: the port's instance, the agent interface's `agent:<id>`, `shell` for a person's own gesture, and nothing for any other path (`HUMAN_REQUIRED`);
  - reads of the person's own notices, in scopes `decideAccess` lets the caller enter now;
  - an action, the pushing app's own palette command (or the shell's, for a person's own notice): a human or owner command is `OVERLAY_ITEM_RESERVED`, another app's or one the palette does not list `NOTIFICATION_ACTION_FOREIGN`, an input its command's schema refuses `VALIDATION_ERROR`, one decision shared with step 3's menus; an agent's action is `NOTIFICATION_ACTION_UNAVAILABLE`, its link kept;
  - the rates, on step 3's push rate (R-b): 10 a minute per app instance, and per person for the shell; 5 for the agent interface, its toasts and notices in one bucket; `RATE_LIMITED` with `details: { limit, retryAfterMs }`, saying the rate is fixed;
  - the quota: `QUOTA_EXCEEDED` with `details: { kind: 'notifications', limit: 500 }` at 500 unread notices; below it, the oldest read or archived notices make room;
  - R10's seams: a pending confirmation is refused `HUMAN_REQUIRED` alone, and skipped by `{ all: true }`, for anyone but a person's own gesture; confirmations count for neither side of the quota;
  - `notification-act`: the action run as the person through the palette interface, nested under the call and journaled with it (phase 2's 11.1), at the notice's scope, the action checked again; then the notice is `done` and read.
- **`toast-show`'s inbox half** (6.1, 3.7), a wrapper over step 3's command: a sticky toast, and one the person's `toastSticky` selects (`landsInInbox`), also lands as a notice, its id on the toast and in its result; a muted app's toast is never shown.
- **Hello's guest book:** `hello-guests` lists every visitor `hello-greet { name }` greeted, so `inbox-action` runs; `agent-leaves-notice` runs too.
- **Chrome:**
  - the `inbox` chunk (`chrome/src/inbox/inbox.ts`): `loam-inbox` at `~/inbox[/<notice>]` (`section-open { section: 'inbox', path }`), notices newest first and a waiting confirmation first (the seam step 6 fills), each with who left it (6.6), when, its action, its link, Mark read and Archive, then "Mark all read" and "Archive all", every read and write a command;
  - the title bar's Inbox button with the unread count, named "Inbox 3 unread", and the announcement of a new notice with the keyboard path to it, kept by `apps/inbox-bell.ts` in the `surfaces` chunk;
  - a sticky toast's **Open inbox**, which dismisses it and opens the inbox at its notice, focused;
  - the palette's "Open inbox" row;
  - an unseen failed autosave, made sticky when the page is hidden, so it lands whatever `toastSticky` says.
- **The settings label** (a reviewer's finding on steps 2 and 3): `loam.notifications.toastSticky` reads "Keep toasts in the inbox", "Which toasts are also kept in your inbox after they close. Toasts an app marks to stay are always kept."; the section, "Which toasts are kept in your inbox, and the apps whose notices stay quiet." Step 2's and step 3's records are corrected in place.
- **Architecture:** section 5's notifications catalog row, and its minimum command list gains `notification-archive` and `notification-act`.

**Decided while building it,** each a judgement a reviewer should check, amending the section named:

- **When a toast lands** (6.1): when it is shown, not when a switch dismisses it. 6.7's "Open inbox opens the inbox at it" needs the notice while the toast shows, and P4-E6 says "lands and counts". `closeForSwitch`'s returned toasts are left unused.
- **What a landed toast counts against** (10.2's "sticky toasts count"): an app's sticky toast counts against its rate of 10 and the quota, refused `RATE_LIMITED` or `QUOTA_EXCEEDED` past them. A toast only the person's `toastSticky` selects is shown whatever the rate, and lands only within it: the person's preference is no contract of the app's. An agent's toast counts once, as a toast, whether or not it lands.
- **What muted does to a toast** (3.7): a muted app's `toast-show` succeeds and is recorded closed at once (`reason: 'inbox'` when it landed, else `'user'`), so the app learns nothing of the preference and no shown toast is pushed off for it (the overlay store's `openClosed`). The shell shows no notice as a toast for anyone; a muted app's notices are not announced.
- **A landed toast's notice:** its message as the title, cut to 120 characters, with the whole message as the body.
- **The list** (10.2): archived notices are not listed. `unread` is every unread notice of the person's the caller may read, whatever the filters: the Inbox button's count. Ties go by id, ascending; the cursor is `<createdAt>.<id>`; a page ends early rather than pass 32 KiB, with the cursor to the rest.
- **Read and archive** answer how many they changed; `{ all: true }` is checked `true` in the handler, since the kit's Zod has no literal.
- **An action's input** is an object of at most 2,048 bytes of JSON, checked against its command's schema at the push and again at the act.
- **`notification-act`** answers `{ state: 'done', result }`, the action's data. A notice already done answers `{ state: 'done' }` and runs nothing; a confirmation is `NOTIFICATION_ACTION_UNAVAILABLE` until step 6; `answer` on a notice is `VALIDATION_ERROR`.
- **A call with no person** (`provider` signed out) has no inbox: `HUMAN_REQUIRED`, "Sign in, then try again"; the auth gate refuses first in practice.
- **`NOTIFICATION_NOT_FOUND`**, a code this step adds to section 16: one answer for a notice not the caller's person's, in a scope the caller may not enter, or none at all.
- **`stores.test.ts`'s scan** exempts `notification-push`'s `action.command`, a command's name as a menu item's is (R-a), the path step 3's comment foresaw. A third named exemption, for this step's review.
- **The scenario `agent-leaves-notice`** gave its link as `{ uri: 'loam://app/hello/guests' }`, a form no link takes; it now gives 10.1's link, a toast's (6.4): `{ kind: 'app', instance: 'hello', scope: { workspace: 'personal' } }`.
- **Hello's guest book** is built here rather than in step 6, where the runner's table put it ("steps 5 and 6"): `hello-guests` lists every greeted name, `greeted: true`. A waiting visitor, and hello's own sticky toast and notice with an action (section 1's `apps/hello` row), are left for step 6 with hello's commands.
- **The bell** (10.3, 15) is text, "Inbox" and the count, as the New button is: Violet's system icons draw no bell. Its name is "Inbox 3 unread", which holds the visible text (axe's label-in-name). A notice's announcement ends "Open it from Inbox in the title bar, or from the palette."; 10.3's sentence for a confirmation names the bell, and step 6 words it against this button.
- **The palette's row** is the chrome's, as New's rows are, offered for a query that is part of "open inbox" or names the inbox or notices, rather than a row kind of the kernel's.
- **The count and the announcement** live in the `surfaces` chunk, which loads at stage B, so first paint holds only the button.

**Left for later steps:**

- **Step 6:** raising and answering confirmations, Confirm and Decline naming the command, a confirmation's announcement, and hello's notices.
- **Step 8:** an orphan autonomy row's notice to the owners who may enter its project, through `Notifications.shellNotice`, the seam built and tested here for steps 8 to 10. *Wired after step 8 merged* (`orphanRecipients` and `orphanNotice`, units, and step 8's orphans case reading the owner's inbox): in `local` mode the one person; in `provider` mode none until the owner roster is a server record (phase 5), a follow-up. Step 8's record says how.
- **Step 9:** the experiment changes of 5.2 and a deferred unload. **Step 10:** a limit's refusal, to owners (*done by step 10* after merging this step: `limit-notice-push` through `shellNotice`, in `local` mode).
- **Phase 3's revoked session: not built, a question for the coordinator.** The kernel hears a revoked session as a change of person to no one, settled with `reason: 'tab'`, as it hears a sign-out in another tab. Nothing tells the two apart, so a notice on it would say "you were signed out" after every sign-out elsewhere too.

**Measured.** D115, on Windows with Node 26.13.1, against the figures `budget.mjs` records for `main` with steps 2 and 3 merged:

- first paint 309,560 and 96,545 gzip (+594; section 14 estimated nothing for this step's first paint), its rows raised from 309,500 and 96,500 to 310,000 and 96,700, with `first-paint.test.ts`'s literal;
- `lateMinified` 93,000 to 94,000 (93,596, +1,280);
- `lateSettingsMinified` 30,500 to 45,500 (41,258, +12,858), over step 3's re-estimate of about 7,000 for the inbox commands: five commands with their written JSON Schemas, the quota, the cursor and budget, R10 and `toast-show`'s half;
- `appsMinified` 417,500 to 418,000 (417,629, +281);
- `surfacesMinified` 88,200 to 91,000 (90,199, +2,256);
- new: `inboxMinified` at section 14's 10,000 (7,809, at 78%).

`budget.mjs` records each.

**Verified.** 2026-11-19, on Windows 11 with Node 26.13.1: `test --coverage` for the kernel (1,069; the inbox's 27 in `late/notifications.test.ts`, and both scenarios in `scenarios.test.ts`), chrome (244), the SDK (32), web (53) and hello (8); the typecheck of every Loam package and app; chrome's `lint:tokens`; `budget`; and Chromium: `inbox` (4, new), with `accessibility`, `shell`, `layout`, `apps/popovers`, `apps/overlays`, `apps/accessibility`, `settings`, `scope/first-paint` and `budget`. Not run: the rest of `test:browser`, `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and Cargo.

**After the reviews,** 2026-11-19: two independent reviews of `98a4d523` (one with two blockers, one with ten) and the coordinator's rulings R1 to R3. Each amends the section named, and supersedes what the record above says otherwise:

- **R1, the shell's notices and the quota** (amends 10.1): the shell's own notices, the person's own pushes and `shellNotice`'s (steps 8 to 10), count for neither side of the 500 and are never refused, as confirmations are not; the 500 binds apps and agents together. Whether one source can still fill the others' room is a [follow-up](#follow-ups).
- **R2, a muted app learns nothing from its own calls** (amends 3.7 and the record's "what muted does to a toast"; as the coordinator amended it after the re-check, below): a muted app's toast is held and timed as any toast, capped among hidden toasts alone, and marked `hidden` in the shell's own list, so the chrome never draws it but runs its timer. A timed one settles `timeout` after its duration, and a sticky one stays until a switch, a change of person or its own close. The app's own `overlay-list` never carries `hidden`. A toast's result, and the app's view of it, carry `notification` only for the app's own sticky toast, so neither says what the person's `toastSticky` selected; the chrome reads the notice's id from the shell's overlay record. A unit compares everything the app reads of its own calls, muted and not, and finds it equal. What R2 does not hold, by the coordinator's ruling, three signals: other apps' toasts can reveal the mute statistically, since a hidden toast is never capped by others' activity; a shown toast's timer restarts on the person's hover or focus, which a hidden one's never does; and the person can close a shown toast, or open the inbox from it, which settles it `user`, while a hidden one never settles `user`.
- **R3, the revoked session** (amends 10.2's list of the shell's notices): **deferred until the provider gives a signal.** The evidence:
  - the kernel hears a revocation as the adapter's session going to none, settled as `session-settle { reason: 'tab' }` (`late/session-settle.ts`'s `heard` and `notice('tab')`), as it hears a sign-out in another tab;
  - the web host's refresh (`web/src/auth.ts`, on `visibilitychange`, `online` and a timer) reads the session again and gets none, with no provider code saying why;
  - `SessionSync` broadcasts `signed-out` from whichever tab saw the change first, including the tab that noticed a revocation, so the broadcast cannot tell the two apart either;
  - phase 3's "revoked-session notice" is the signed-out main ("Sign in to …", P3-E3), not a distinct notice.

  A [follow-up](#follow-ups) asks the provider for a reason on the refused session.

**Fixed:**

1. **Admission races:** a push is counted against its rate the moment it is admitted, with no await between check and count (a push the quota then refuses stays counted). Each person's count, eviction and insert run on one chain, and the eviction and the insert are one store batch, so a failed insert keeps what it would have evicted. Units: 11 concurrent pushes from one app give exactly one `RATE_LIMITED`; at 499 unread notices two concurrent pushes leave 500.
2. **Act-time checks:** units act on rows written straight to the store whose action is a person's command (`OVERLAY_ITEM_RESERVED`), whose source app is gone or no longer this app, whose command is gone or not palette-listed (`NOTIFICATION_ACTION_FOREIGN`), or whose input the command now refuses (`VALIDATION_ERROR`); nothing runs.
3. **Acting twice:** `notification-act` claims a notice before it runs. The claim is an in-page guard by id, and `state: 'acting'` with a claim token written to the store and read back, so another tab that claimed it since does not run it too. The store has no compare-and-set: two tabs that write and read back in lockstep can still both run it, within two store calls. A failed run releases the claim (the row is put back whole, since a batch `PUT` merges). A completion that cannot be written leaves the notice `acting`, which never runs again and says so. `NotificationV1.state` gains `acting`, and the claim token is never listed. The inbox's button says it is busy while the call runs, and a second press does nothing. Units: two concurrent acts run the command once; a stored `acting` notice never runs.
4. **Stale chrome:** the inbox and the count clear on a change of person or of access (`auth-*`, `session-*`, `member-*`, `agent-member-*`, `project-update`, `-archive` and `-restore`, `workspace-app-set`) and read again. A refused read clears rather than keeps what was shown. An announcement is dropped when the mute cannot be read, or a newer read overtook it. Chromium: a sign-in clears the signed-out person's count and inbox.
5. **A landed toast's access:** an explicitly sticky toast is admitted as a push is: its scope (`PROJECT_NOT_FOUND`), its rate, then the quota (`QUOTA_EXCEEDED`). An agent's sticky toast at the quota is refused, not shown. A toast the person's `toastSticky` selects lands only within its scope, rate and the quota, and is shown either way.
6. **Links:** a notice's link is 10.1's `ResourceLinkV1`, an app's `route` or a document's `anchor` included. It is checked at push for this workspace, a route with no empty, `.` or `..` segment, and an anchor of at most 1 KiB (`VALIDATION_ERROR`). The renderer's guards stand. `stores.test.ts`'s exemption grows by `link.route`, for this step's re-check; its `action.command` path is kept by the coordinator (2026-11-19). `agent-leaves-notice` links to hello's `guests` route again and asserts it is listed.
7. **"Open inbox" past page one:** `notification-list { notification }` (amends 10.2's input) finds one notice by id, filtered as every read is, and the inbox opens at it wherever it is.
8. **No apps, no badge:** the count and its announcements are a chunk of their own (`inbox-bell`) that the shell loads after stage B, apps or none, announcing in the shell's own live region. Chromium: an empty deployment counts.
9. **MCP:** the shell's inbox commands are left out of `mcpOptions()` by name, so an app's own command of the `notification` category stays served (a unit).

**Improvements:** a single row past the list's 32 KiB answers `OUTPUT_BUDGET_EXCEEDED` with a suggestion. Each listed notice carries `from`, step 3's owner line (`ownerTitle`: same titles told apart by instance, never one that says "Loam"), which the inbox and the announcement show as a toast's line reads. `toastSticky`'s middle choice reads "Only errors", since it selects `danger`. The Inbox button names "Inbox 99+ unread" past 99, as it shows. STATUS's step 2 line is corrected.

**Measured after the fixes** (`budget.mjs` records each): first paint 309,769 and 96,595 gzip (+209 on the first commit, the count's own chunk and `99+`), within 310,000; `late-settings` 43,941, its row tightened to 44,600; `late` 93,818; `surfaces` 89,549; `inbox` 9,637 of 10,000; `inbox-bell` 1,041 and `inbox-words` 266, in no row. **`editorMinified` 35,445 to 35,600** (35,479): the first commit had moved a failed save's toast into a module of its own after its last budget run, and was over this row unmeasured.

**Verified after the fixes,** 2026-11-19, on Windows 11 with Node 26.13.1: `test --coverage` for the kernel (1,080; the inbox's 38 in `late/notifications.test.ts`, both scenarios), chrome (244), the SDK (32), web (53) and hello (8); the typecheck of every Loam package and app; chrome's `lint:tokens`; `budget`; `check-doc-lines`; `pnpm check`; and ten Chromium files, 111 tests: `inbox` (7), `scope/first-paint`, `budget`, `apps/overlays`, `apps/popovers`, `apps/second-app`, `settings`, `accessibility`, `shell` and `documents/editor`, `first-paint`'s P2-E2 timing out once at 30 s under load and passing alone (8 of 8). Not run: the rest of `test:browser`, `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and Cargo.

**After the re-check of `1203f5a8`** (16 of 17 resolved), 2026-11-19, and the verification of `ab2c36a8`:

- **B1, R2's leak:** a muted app's timed toast started its timer at once, while a shown one's is held under any modal, so an app could open its own modal, show a timed toast and see `waitOverlay` settle `timeout` only when muted. Hidden toasts' timers are now held under any modal exactly as shown ones are, and start again in full when it closes. Chromium: with the app's modal open, a muted timed toast stays unsettled past its duration and settles `timeout` after the modal closes. The record's claim stands, as R2 now words it: what a muted app reads of its own calls alone equals what it reads unmuted.
- **A muted app's toasts and the cap** (amends R2's "capped as any toast"): a toast is opened hidden (the store's `hideNext`, set just before `toast-show`'s original opens it), and counts toward the cap of five among hidden toasts alone. So a muted app's unseen toasts never push a shown one off, and its own are kept five at a time. **Accepted by the coordinator (option b), with R2 amended:** the muted app sees no other app's overlays, so it reads nothing of the split from its own calls; but since others' toasts never cap its own, their activity can reveal the mute statistically. A shared, age-ordered cap is a [follow-up](#follow-ups) (a unit).
- **Act-time tests:** the case named "disabled" was a foreign command and now says so; the disabled source app's case asserts `APP_DISABLED`, that nothing ran, and that the person acts again, once, after the app is enabled.
- **The claim's release and completion** put the row back from the row as stored after the run, not from the claim's snapshot, so a read or an archive made meanwhile in another tab stands; only `state` and the claim change.
- **A persisted claim** reads "Running, or ran with no outcome recorded" in the inbox, the kernel's words.
- **The `stores.test.ts` exemption** for `link.route` is kept by the coordinator (2026-11-19), and its comment says so.
- **The verification of `ab2c36a8`:**
  - the overlay layer's `waiting` now counts hidden toasts too, so a muted toast whose timer already runs is read again, and held, when the palette or a compact drawer opens (Chromium: it stays unsettled past its duration under the palette, and fails without the fix), and when the app's own modal opens (Chromium);
  - the act's write-back is skipped when the row is gone after the run (evicted by the quota, or deleted): nothing writes it again. Units: a read and an archive written while the action runs survive it; a row removed while it runs stays gone, whether the action ran or failed.
- **The verification of `2995bb7e`:** the act's read-back tells a row that is gone (`null`) from a store that could not be read (`'failed'`). A failed read after the run falls back to the claimed row, so the claim is released when the action failed and completed when it ran, at the cost of a read or an archive made meanwhile (a unit for each). A claim this call wrote but could not read back before the run stays, and the notice never runs.
- **The coordinator's `pnpm verify` of `bfbdeaa9`:** the Inbox count's `notification-list` at stage B added an entry to an empty shell's boot, against phase 2's rule (4.3) that the shell's own stage-B reads journal nothing, as `scope-get`, `section-get` and phase 3's `persona-list` do not. By the coordinator's ruling it joins `UNJOURNALED_COMMANDS` (amends 10.2): it reads and writes nothing else, so an agent's or an app's `notification-list` is not journaled either, as with `persona-list`, and phase 0's E2 is unchanged. The replay units now show a replayed notice through journaled reads (`notification-read` and `-archive` with `all`, whose counts the replay must reproduce). The refusal fixtures list hello's `hello-guests`, so they reach the throwing `activate` and import they test.

## Step 7, 2026-11-19

Keybindings, on `lush/loam-p4-step7-keybindings` from `main` at `ca1b11f3` (steps 1 to 5, 8 and 10 merged), not merged. The step stopped once, before its design, on five questions section 8 left open; the coordinator ruled R1 to R5 on 2026-11-19, and each is built and recorded in the sections it amends.

**The rulings.**

- **R1:** AFD wants every capability a command, so a binding names one where it exists: Mod+K `palette-open`, the layout toggles `layout-set`. No command saves an editor, moves focus between the parts or opens the project switcher (`section-open` has no switcher, and the editor area has no save command), so those four reserved chords are named `shell-focus-next`, `shell-focus-previous`, `shell-save` and `shell-project-switcher`, in the shell's domain: listed, rebindable but for F6's two, never an app's, and refused when called with `KEYBINDING_ACTION_ONLY`. A [follow-up](#follow-ups) makes them commands. The job `rebind-a-chord` named `section-open { target: switcher }`; it names `shell-project-switcher` now.
- **R2:** `target` names the part a layout toggle toggles. Step 2's stored `{ command: 'layout-set', keys: null }`, with no target, matches no binding and changes nothing.
- **R3:** the manifest keeps phase 1's `chord`, as a sequence too, with `when`, in version 2 only and with no `target`; phase 1's `KEYBINDING_RESERVED` stays the manifest's code, also for a sequence beginning on a reserved chord; `MANIFEST_KEYBINDING_KEYS` and `MANIFEST_KEYBINDING_WHEN` are new (12.1, 16).
- **R4:** `when`'s focus terms are the chrome's, and `keybinding-list`'s `active` counts them as holding; its description says so.
- **R5:** `keybinding-list`'s callers are `setting-list`'s; overrides stay human writes, kept per workspace and person.
- **Collisions** and **the rail order** as the step proposed: below.

**Built.**

- **The matcher** (`chrome/src/keyboard.ts`, first paint): 8.2's key, `event.key` for a Latin letter or digit, else `event.code`, so a German layout's Z is its own and a Cyrillic letter, macOS's Alt letters and a shifted digit are their physical key; `Ctrl` and `Meta` held apart from `Mod`; `pressKey`, a sequence's first chord waiting 1,500 ms for its second, a modifier alone keeping the wait and any other key matched afresh; `when`'s focus terms; `Mod+Alt+P` pressing the shown project switcher (8.4, #857).
- **The registry** (`kernel/src/keybindings.ts`, first paint): the reserved chords and the active app's, as phase 1 had them, until `late-settings` gives it the resolver; then the bindings in force by 8.1's precedence. The active tab's owner and document type reach it from the editor area's settle (`late/editor-commands.ts`); `listCommands`' keys are the person's own where they rebind one.
- **The resolver** (`kernel/src/late/keybinding-resolve.ts`, `late-settings`): precedence, an override replacing its command and target, colliding keys shadowed under the same `when`, R1's names and R2's targets, R4's kernel terms.
- **`keybinding-list`** (`kernel/src/late/keybinding-commands.ts`, `late-settings`; 8.5): strict input, the `setting` category, ordered by keys, detached copies, an output budget of 64 KiB, `CALL_NOT_GRANTED` for an app in the handler too, and refused when no registry was given (fail closed). `keybinding` joins `SHELL_DOMAINS_V1` and the manifest schema's reserved ids; `keybinding-list` joins the shell's command names and the sweeps' inputs.
- **Overrides** (`late/settings.ts`, `late/setting-sections.ts`): read into the registry at the late load, after each write of the section and on a change of person, none signed out in `provider` mode; kept at `<workspace>/loam.keybindings` in the person's record (3.4, R5); a value that no longer passes its check is none, a read that fails keeps what the registry holds. The check refuses a sequence whose first chord has no `Mod` or is reserved, and F6's two actions.
- **`KEYBINDING_ACTION_ONLY`** (`kernel.ts`): a call to one of R1's names, before any registry.
- **The manifest** (`app-manifest.v2.json`, `loam-rules.ts`, `catalogs.ts`): 12.1 as amended, `keybindingWhenProblem` shared with the kernel, `Mod+Alt+P` in `SHELL_RESERVED_CHORDS_V1`, and the version 1 refusal through `versionKeyFindings`; profile cases for each code and version. The apps' load refuses colliding keys with `KEYBINDING_CONFLICT`, the kernel handing the `apps` chunk the resolver's rule.
- **Save** (`chrome/src/editor/`): the editor area asks the shell whether a key is save (`LoamShell.isSave`, the bindings in force, so Mod+S rebound or unbound holds); a save binding that is a sequence is completed by the shell, which asks the area with `loam-save-asked`.
- **The keybinding editor** (`chrome/src/settings/editors.ts`, `editor-rules.ts`): a Mod chord followed at once by a second key records a sequence; a target field; the warnings before shadowing a shell chord, unbinding Mod+K or shadowing any other binding, from `keybinding-list { all: true }`; Add disabled, with the reason said, for keys the kernel would refuse and for F6's own binding; the command field suggests R1's names too.
- **Tests:** the kernel's `keybindings.test.ts` (the resolver, 13) and `late/keybinding-commands.test.ts` (9: the list, the job's steps, shadowing and the palette's keys, the callers, R1's refusal, P4-E15's replay, the workspace keying on one store, step 2's bare value unread, two people in `provider` mode); chrome's `keyboard.test.ts` and `settings/editor-rules.test.ts`; the manifest's profile cases; `rebind-a-chord` runs in `scenarios.test.ts`; P4-E9 in Chromium, `web/test/browser/keybindings.test.ts` (8): `Mod+Alt+P` reaching the page, German and Cyrillic layouts pressed through the DevTools protocol with each layout's `key` and `code`, a sequence and a late second key, `KEYBINDING_RESERVED`, an override with `source` and `shadowed` keeping its action and a layout toggle by its part, the editor's warnings and a recorded sequence under axe, the rail order by keyboard, and no key from a view (8.6).

**Decided while building it,** each a judgement a reviewer should check:

- **The resolver is late** (P4-E12): in first paint it measured 1,526 more; only the late load reads a person's overrides, so first paint keeps phase 1's band until then. An app binding with a `when` is not in force before it (the kernel's terms are undecided).
- **No lazy chunk imports the matcher or the registry** (phase 3's 13): the `apps` chunk is handed the collision rule; the `editor` chunk asks the shell; the `settings` chunk keeps copies of `keyOf`, the collision rule and the 1,500 ms, held equal by units, as `RESERVED_CHORDS` in `late-settings` is.
- **An override holds everywhere** and runs whenever its command is registered and needs no input, whatever app is active, as the palette would run it; an app's `when` does not come with it.
- **A non-matching second key** ends the wait and is matched as a key of its own, rather than swallowed.
- **The editor's shadow warning** counts an app's binding not in force now, since it holds whenever that app is active.
- **The rail order** in P4-E9 is read as reordering the rail from the keyboard in the settings section, the person's own order following.

**Left for later steps:**

- **Step 6** changes the palette's listing (A-P0-1); the palette shows each command's keys from `listCommands`, which this step's registry gives, so the ranking is untouched.
- **The follow-up** to make R1's actions commands.
- **#706:** whether Firefox and WebKit receive `Mod+Alt+P` (the existing follow-up).

**Measured.** D115, on Windows with Node 26.13.1, against step 10's merged figures (the budget's header records each): first paint 315,952 and 99,161 gzip (+3,384 and +1,276 against section 14's 600 and 250), `jsMinified` 316,500 and `jsGzip` 99,500 with `first-paint.test.ts`'s literal; `kernelMinified` 125,200 (124,650); `lateMinified` 110,500 (110,224); `lateEditorMinified` 15,600 (15,447); `lateSettingsMinified` 73,500 (72,883, +5,042); `appsMinified` 426,500 (426,064, +2,354); `settingsMinified` 44,800 (44,352, +2,152).

**Verified.** 2026-11-19, on Windows 11 with Node 26.13.1, at the step's last code commit: `test --coverage` for the kernel (60 files, 1,248 tests), chrome (21 files, 267), the manifest (15 files, 1,112 of 1,114: `entry.test.ts`'s two five-second import walks timed out beside the other packages' runs and passed alone, 3 of 3), the SDK (33), `web`'s units (11 files, 54), `loam-testing` (15) and the apps (hello 10, tally 2, notes 9, checklist 10, tasks 4); the typecheck of every Loam package and app; `lint:tokens` (8 packages, no violations); `node --test scripts/plugin-manifest.test.mjs` (48); `budget`; `node scripts/check-doc-lines.mjs`; and `pnpm check` (every gate). Chromium: `keybindings.test.ts` (8), and the whole `test:browser` once: 482 of 484 in 42 files, the two failures, P2-D5's view editor (`documents/references.test.ts`) and P2-E3's All projects (`scope/rail.test.ts`), passing alone (2 files, 72 tests); its conformance suite, which the failure stopped, run after (24). `test:hosted` after a rebuild: 25 of 28, twice, with the processor at 99% and 83 Node processes of other sessions: P6-H1's cold start (5,054 ms of 3,000), P6-H2's first paint's requests (the three typefaces not yet asked for; every chunk byte for byte the same) and P6-H2's axe wait. Each is a timing the record of step 1 saw under load; **not confirmed** on a quiet machine, and left to the coordinator's `pnpm verify`. **Not run:** `test:walk`, `test:mounted`, the desktop's Cargo gates and `loam.yml` (CI's).

**After the reviews,** 2026-11-19: two independent reviews of `f83cc9db` (Opus 5.5, high: revise, 1 blocker; GPT-6.2 Astra, high: revise, 10 blockers) and the coordinator's rulings R6 to R8. Each finding was shown first by a test that failed, or, where none could fail, by the reason below. What each became:

1. **R6, trusted keys** (Astra 1, Opus 3): the shell resolves a key only when `event.isTrusted`, and the editor area no longer listens for keys or hears a public `loam-save-asked`; the shell asks it to save through `answerSave`, a callback, never an event. Chromium: a dispatched Mod+K opens no palette; a dispatched Mod+S and the old public event save nothing within autosave's window (both failed before).
2. **A change of person** (Astra 2, Opus 4): the registry holds the overrides with the person they were read for and compares with whom the shell is for (`shellPerson`) at every list, so they stop the moment the person changes, before any read; a failed read keeps them only for the same person. Units: Ada's override gone on a direct change to Olu whose read fails (failed before), and the registry's own case.
3. **An empty workspace** (Astra 3): the shell runs a binding's command through the kernel, with a failure's toast, whether or not app surfaces exist. Chromium: a `section-open` override in a deployment with no apps (failed before).
4. **One resolution per key** (Astra 4, Opus 5): the shell resolves each key in the capture phase, answers save there (as the editor area answered Mod+S before), and does any other binding in the bubble phase unless the page consumed the key, which then ends a sequence's wait; a held first chord's repeats keep the wait. Chromium: a sequence `Mod+G Mod+S` toggles the sidebar and saves nothing, Mod+S alone still saves; `Mod+G` held, then D, runs the sequence (both failed before).
5. **Sequences** (Astra 5): a modifier alone keeps the wait; any other key no chord names ends it, not prevented (unit failed before). The manifest refuses F6 and Shift+F6 as a sequence's second chord, `KEYBINDING_RESERVED` (profile cases failed before).
6. **First paint** (Astra 6): until the resolver and the person's overrides are known, only F6 and Shift+F6 dispatch, so a stored unbind of Mod+B never toggles the sidebar. The kernel case passed before, since the kernel reads overrides at boot; the registry's unit, which lists before the resolver, failed.
7. **`keybinding-list`** (Astra 7): the late chunk tells the resolver what a command is (`KeybindingInfoV1`): its instance from the registry, and whether a chord runs it, registered, listed in the palette and accepting the chord's input, `section-open`'s section among it. Unit: an app command with no manifest chord names its `app`, and `section-open { section: 'nowhere' }` is not active (both failed before).
8. **The editor** (Astra 8): it warns on colliding keys of the person's own, saying which wins, and checks the whole list it would write (`overridesRefused`, held equal to the kernel's `overridesProblem` by a unit over a table). Units failed before; Chromium: the warning and a malformed name refused before Add.
9. **`when`'s codes** (Astra 9): the schema no longer bounds `when`'s length, so an empty or over-long one is `MANIFEST_KEYBINDING_WHEN` (profile cases failed before).
10. **The exemption** (Astra 10, Opus 6): `mounted.test.ts` exempts `keybinding-list`'s `command` property alone. No test could fail here: the broad exemption hid nothing today, but would hide a later `url` on the command.
11. **MCP** (Opus 1): a unit asserts `keybinding-list` is not in `mcpOptions().commands`. It passed at once: the `setting` category already kept it out; the finding asked for the assertion.
12. **R7 and R8** (Opus 2, 8): the overrides' check (kernel units failed before), the editor's copy, and 8.1 and 8.3 amended.
13. **Budget** (Astra, Opus 7): the override eligibility and the palette's shortcut map moved into `late-settings`, `whenProblem` no longer re-exported from first paint; section 14's Total row amended. Measured, against the step's figures: first paint 316,078 and 99,262 gzip (+126 and +101: the shell's capture and bubble halves and its own command runner, less the kernel's -875); the kernel alone 123,775, its row lowered to 124,300; `late` 110,541 (to 111,000); `late-settings` 73,694 (to 74,200); `settings` 45,912 (to 46,400). `budget.mjs` records each.
14. **The collision test** (Opus 9): the settings chunk's rule is compared with the kernel's `keysCollide`, which `@lushly-dev/loam-kernel/testing` now exports with `overridesProblem`. It agreed already; the test was the gap.

Declined: none. Recorded: when a key that begins a sequence arrives while another sequence waits, and the page stops that key before it reaches the window's bubble phase, the earlier wait is not replaced or ended; it ends at its 1,500 ms.

**Verified after the reviews,** 2026-11-19, same machine, at `64ab539b`: `test --coverage` for the kernel (60 files, 1,255 tests), the manifest (15 files, 1,118), chrome (21 files, 268) and `web`'s units (11 files, 54); the typecheck of every Loam package and app; `lint:tokens`; `node --test scripts/plugin-manifest.test.mjs` (48); `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check` (every gate); and six Chromium files, 121 tests: `keybindings` (13), `layout`, `settings`, `shell`, `documents/editor` and `documents/references`. **Not run:** the whole `test:browser`, `test:hosted`, `test:walk`, `test:mounted`, `pnpm verify` and the Cargo gates.

**After the re-check,** 2026-11-19: two re-checks of `7f8941cf` (Opus 5.5, high: revise, 1 blocker; GPT-6.2 Astra, high: revise, 6 blockers) and the coordinator's ruling R9. Each was shown first by a test that failed, or by a trace where none could:

1. **The desktop's "Command palette"** (Opus B1): its fixed script dispatched a Mod+K, which R6 now drops (a trace: the event is not trusted). It calls `document.querySelector('loam-shell')?.openPalette()`; `boot.test.ts`'s copy follows. The WebDriver suite is CI's.
2. **The remaining public save paths** (Astra 1): the editor frame no longer hears `loam-editor-save`; a view's own save request reaches its editor frame through `onSaveRequest`, a callback set only on a document's editor, and the view SDK asks only on a trusted Mod+S. Chromium: a dispatched `loam-editor-save` saves nothing; SDK unit: an untrusted Mod+S asks nothing (both failed before).
3. **Open controls** (Astra 2): a script's Enter chose the switcher's row and ran the palette's (Chromium, both failed before, once the test reached the listbox's own control through its open shadow root). The palette runs a row only on a trusted Enter, and both lists stop a script's Enter or Space on the listbox's shadow root before its control: Violet is unchanged. A person's own Enter still chooses in both.
4. **Sequences** (Astra 3): a held key's repeat keeps the wait and its deadline and is never a second chord (unit and Chromium, `Mod+G Mod+G` held, failed before); a new prefix clears the one that waited in the capture phase (Chromium, a prefix the page stops, failed before); save honours a key already prevented (Chromium, failed before).
5. **One readiness** (Astra 4, Opus I3): R9's above; the A→B test asserts the active keys, F6 and Shift+F6, and no shortcut on `palette-open` (failed before).
6. **Mounted commands** (Astra 5): eligibility judges a mounted command by its advertised schema, through first paint's `needsInput` given to the late chunk (unit: one requiring input is not active, failed before).
7. **The editor's winner** (Astra 6): from the list the write would leave, an edit keeping its place; each warning said, none hiding another; a colliding override not in force is said so (units failed before).
8. **R9:** the late load's failure applies the defaults (unit, failed before); the read is retried with backoff (unit); a change of person with no call is read already through `session-settle` (unit, passed at once: the existing path); Mod+S held with `unready` and a toast.
9. **Refused entries** (improvement 8): dropped one by one, the rest kept, `refused` counted (unit, failed before).
10. **AltGr** (improvement 9): excluded for a printable key (unit, failed before).
11. **The budget record** (improvement 10) attributes the eligibility to `late` and the shortcut map to `late-settings`. Measured: first paint 316,988 and 99,580 gzip (+910 and +318), `jsMinified` to 317,500 and `jsGzip` to 100,000 with `first-paint.test.ts`'s literal; `kernelMinified` to 125,000 (124,503); `switcherMinified` to 11,600 (11,445); `settingsMinified` to 46,900 (46,410). `budget.mjs` records each.

Declined: none. Also found and fixed while verifying: in `local` mode a sign-in keeps the person's record id, so `follow()` returned before reading the overrides for the new person and the registry stayed not ready (the job `rebind-a-chord` caught it); it now reads whenever the person differs from the one last read.

**Verified after the re-check,** 2026-11-19, same machine: `test --coverage` for the kernel (61 files, 1,259 tests), chrome (21 files, 271), the SDK (33) and `web`'s units (11 files, 54); the typecheck of every Loam package and app; `lint:tokens`; `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check` (every gate); the desktop's `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` (42); and eleven Chromium files, 223 tests: `keybindings` (18), `shell`, `layout`, `settings`, `documents/editor`, `documents/references`, `documents/checklist`, `apps/view`, `scope/rail` and `scope/first-paint`. **Not run,** by the brief while step 6's `pnpm verify` runs here: the whole `test:browser`, `test:hosted`, `pnpm verify`, and the desktop's WebDriver suite (CI's).

**Third round,** 2026-11-19: re-checks of `fe238b11` (Opus 5.5, high: approve, with four points; GPT-6.2 Astra, high: revise, A to G) and the coordinator's ruling R10, which keeps Astra's D as it is (8.3, above). Each was shown first by a test that failed, or checked by removing the code it holds:

- **A, a sign-in from elsewhere:** the registry also needs the adapter's person to equal the settled one (`KeybindingSourceV1.adapter`). Unit: Olu signed in by another tab while Olu's membership read is held: only F6, Shift+F6 and the held Mod+S, no shortcut shown (failed before), then Olu's keys once it answers.
- **B, the R9 toast:** `toast-show`'s shell toast takes the default preferences when the person's record cannot be read. Unit (failed before) and Chromium: with that record's reads failing after a sign-in, Mod+S is prevented, nothing saved, and the toast shows (failed before, at the toast).
- **C, the boot gate:** phase 0's "paints with the late chunk held" now expects the early Mod+K to run nothing and a fresh one to open the palette; it failed (timed out) at `fe238b11`, a file the second round did not run. Listed against P4-E14.
- **E, a repeat past its deadline:** a repeat starts no wait; only a fresh press does (unit, failed before).
- **F, a `oneOf` that `{}` meets twice:** a mounted command whose schema has one is not eligible (`oneOfMetTwice`; unit with `manifest/src/needs-input.test.ts`'s counterexample, failed before).
- **G, the editor's winner:** an earlier override that is not in force does not win; the warning says the new one would be in force (unit, failed before).
- **Opus 1, the toast:** B. **Opus 2:** a Chromium case sends a script's Enter and Space to the palette's own listbox control; it fails with `hearOnlyPeople` removed (checked). **Opus 3:** the retry and any read in flight end on dispose (unit, failed before: a read after dispose); the backoff doubles, 500 then 1,000 ms (unit, passed at once: it did); a replay schedules no retry, its keys staying not ready, recorded. **Opus 4:** `usableOverrides` uses `SHELL_LIST_MAX`; stage B's failure path applies the defaults (unit with the person's record unreadable; it fails with `useDefaults` removed, checked).

Measured: first paint 317,050 and 99,602 gzip, within its rows; `late-settings` 74,598, its row raised to 74,800 under D115 (the toast's default preferences, the retry's stop, and the overrides reader moved into `late/setting-overrides.ts` to keep `settings.ts` under the file-size gate); `budget.mjs` records it.

Declined: none. D is unchanged by R10's ruling.

**Verified after the third round,** 2026-11-19, same machine, at `ec313226`: `test --coverage` for the kernel (62 files, 1,263 tests), chrome (21 files, 273) and `web`'s units (11 files, 54); the typecheck of every Loam package and app; `lint:tokens`; `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check` (every gate); and, step 6's `pnpm verify` having finished, the whole `test:browser` once: 42 files, 496 tests, and its conformance suite, 24, all passing (`boot`, `keybindings`, `shell`, `documents/editor` and `documents/references` among them). **Not run:** `test:hosted`, `test:walk`, `test:mounted`, `pnpm verify` and the Cargo gates (no Rust changed since the second round's run).

**Fourth round,** 2026-11-19: re-checks of `ff403cfe`, the branch pushed as [#1657](https://github.com/lushly-dev/afd/pull/1657) (Opus 5.5, high: approve, with points; GPT-6.2 Astra, high: revise, 4 blockers). Each was shown first by a test that failed, but where noted:

1. **Disposed during stage B:** the late chunk's dispose hook marks it disposed, and the overrides reader, made later in the same load, starts stopped. Unit: a kernel disposed while stage B's read of the editor record is held reads the person's overrides no more after (failed before: three reads).
2. **A failure keeps no override:** the registry's failure state decides before readable overrides (`list` and `keybindingFor`). Unit: stage B failing with a readable record whose override moves `palette-open`: Mod+K in force, the personal chord absent (failed before).
3. **F, a valid `oneOf`:** `emptyMeets` asks whether `{}` meets the schema, `type` included, `oneOf` exactly once, in place of `oneOfMetTwice`. Units: `oneOf: [{ type: 'object' }, { type: 'string' }]` keeps its shortcut (failed before), two object branches still lose it.
4. **G, three entries:** the editor walks every one of the person's own on colliding keys in the list's order, and names the resolver's winner, the first in force, the edited binding's own state counted. Units: [X not in force, `palette-open` in force, edited Z] names `palette-open` (failed before); an edited override not in force with a later runnable one says the later one runs. The second round's case whose edited binding is listed not in force now says so.
5. **Session expiry (Opus 2):** the adapter naming no one keeps the settled person's own overrides, so an expiring session no longer leaves the keys not ready for a refresh; another person named still does (unit, failed before).
6. **C's check (Opus 4):** the boot gate waits 150 ms before saying the palette stayed closed.
7. **An app's toast (Astra):** with the person's record unreadable, an app's `toast-show` still fails: the fallback is the shell's alone (unit, passed at once: the code was right; the case was missing).

Measured: first paint 317,125 and 99,614 gzip, within its rows; `late` 111,103, its row raised to 111,500 under D115 (`emptyMeets` and the disposal flag); `budget.mjs` records it.

Declined: none.

**Verified after the fourth round,** 2026-11-19, same machine, at `d55b0949`: `test --coverage` for the kernel (62 files, 1,267 tests), chrome (21 files, 274) and `web`'s units (11 files, 54); the typecheck of the kernel, chrome and `web`; `lint:tokens`; `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check` (every gate); and Chromium's `keybindings`, `boot` and `settings` (3 files, 33 tests). **Not run:** the rest of `test:browser`, `test:hosted`, `test:walk`, `test:mounted`, `pnpm verify` and the Cargo gates (no Rust changed).

**Fifth round,** 2026-11-19: re-checks of `09e1052b` (Opus 5.5, high: revise, 3 blockers; GPT-6.2 Astra, high: revise, 6), with the coordinator's rulings R11 and R12 (8.3, above), meant to end the rounds on eligibility and the editor's warning. Each was shown first by a test that failed, but where noted:

1. **Disposal before the hook (Astra 1, Opus B1):** the kernel gives the late load `disposed()`, read where the session settle and the settings are made, each stopped at once when the kernel is gone; `begin()` returns after a stop. Unit: a kernel disposed while stage B's read of the agent members is held reads no overrides and subscribes to nothing after (failed before: two more reads, and the session settle's subscription). In `provider` mode the late load runs inside `createKernel`, so no disposal comes during it; `begin()`'s one early return guards the membership watch with the adapter's subscription. The Mock adapter's own directory (`withMockCapabilities`) subscribes in the late load and is not the kernel's; left as it is.
2. **Stage B failure (Astra 2, Opus I1):** `resolve()` and `refused()` take the defaults first, as `list` and `keybindingFor` do. The failure fixture asserts `keybinding-list` (Mod+K, the shell's, alone active for `palette-open`; no Mod+Shift+K; no `refused`; it failed before, listing the override) and the palette's hint, with a positive control: the override in force just before stage B failed.
3. **R11 (Astra 3, Opus B2):** `emptyMeets`, in its own module, is true only where proven. Units: Astra's `not: { const: {} }` and zod-to-json-schema's `$ref` shape on mounted commands lose their shortcut (failed before), and `empty-meets.test.ts` takes each decided keyword, annotations, each undecided keyword, an undecidable `oneOf` branch and malformed keywords in turn.
4. **R12 (Astra 4, Opus B3):** `keybinding-list` marks `idle` (8.5); the editor runs the resolver's rule over the proposed list. Units: Opus's [B: Mod+L, A: Mod+L, C: Mod+P], A moved to Mod+P, and Astra's freed-shadowed case name the moved binding as the one in force (both failed before, naming C); a sequence case, where a first-colliding rule would name the wrong binding, passed at once. The second round's fixture now has `section-open (projects)` in force, and the earlier ones' idle overrides carry `idle`.
5. **Sign-out against expiry (Astra 5):** the adapter's person, for the keys, is an expired session's user too, so an expiry keeps the settled person's own until the settle; a sign-out names no one, and the registry asks the adapter's person to equal the settled one. Units: Ada settled, Olu named, Olu signed out before Olu's settle: only F6, Shift+F6 and the held Mod+S, and no hint (failed before: Ada's Mod+Shift+K); Ada's session expiring keeps Ada's keys (passed at once).
6. **The app toast (Astra 7):** the case uses an app surface's port: its toast shows with the person's settings readable, and is refused with no new toast when they cannot be read. The fixture's nested-call command goes.
7. **The boot gate (Astra's improvement 6):** it hears the kernel's calls from before the early press, waits for `appsReady` and a call queued after any earlier one, asserts no `palette-open` ran, then that the fresh press runs it.

Not from step 7: `scope/rail.test.ts`'s "keeps hello's workspace layout and its Atlas layout apart", which timed out at 30 s in the coordinator's `pnpm verify` of `09e1052b`, passed alone four times at about 1 s each and with `boot`, `keybindings` and `settings`. It presses no key: kernel calls and scope changes, which the keys' readiness does not hold.

Measured: first paint 317,298 and 99,660 gzip, within its rows; `late` 112,243, its row raised to 112,800, and the `settings` chunk 47,028, its row raised to 47,400, under D115; `budget.mjs` records both.

Declined: none.

## Step 8, 2026-11-19

Autonomy, on `lush/loam-p4-step8-autonomy` from `main` at `9f4bb6d2` (after steps 1 and 2), not merged. It gets a trust review (section 20).

**Built.**

- **The pure rules** (`kernel/src/late/autonomy-rules.ts`): `AutonomyRowV1` and its id; the default (D156: `act` for a command that is not a mutation, `ask` for a mutation, `ask` for every mounted tool); `resolveAutonomy({ rows, command, project?, cap? })`, returning 4.2's `{ mode, from, ceilings, cap, chain }`, which ignores orphans and other projects' rows, and lowers a project row's mode to the workspace's bound (its `ceiling`, else its general mode, else the command's default) and its rows for the instance and the command, then to the cap; `writeBound`, F8's bound at write time; `orphanChanges`.
- **The commands** (`kernel/src/late/autonomy.ts`, in the `late-settings` chunk): `autonomy-get` (one, or 1 to 50 in order; the input's project, else the call's scope; the instance found from the command when not given, `shell` for the shell's own), `autonomy-list` (the workspace's rows and those of projects the caller may enter, orphans flagged, the ceiling, the cap and `writable`), `autonomy-set` (a workspace or project row, or the person's cap) and boot's `autonomy-settle`. The rows are the workspace store's `autonomy` table, read at every call; the cap is `loam.autonomy.cap` in the person's `loam.settings`, read and written through the settings module, one write at a time with `setting-*`'s. Strict inputs; every result a detached copy; every refusal with a suggestion; the category `setting`, so `mcpOptions()` serves none of them (section 13), and a port gets `CALL_NOT_GRANTED`. `setting-*` on `loam.autonomy` stays `SETTING_USE_AUTONOMY`; `section-open`'s `target` takes `loam.autonomy` and `loam.autonomy.cap`.
- **`autonomy-set`'s order (N9):** validation; line 0 (the scope middleware); the project's access, `PROJECT_NOT_FOUND` byte-identical to phase 2's for a project the caller may not enter or that does not exist; the agent's hand-off (`HUMAN_REQUIRED`, `details: { route, section: 'loam.autonomy', key: <row id or 'cap'>, level }`); section 13's `SHARED_RECORD_UNAVAILABLE` at every level; the owner check (D154: workspace rows an owner's; a project row an owner's or its creator's, while the creator may enter it and no team instance lists it, D87, D110; `OWNER_REQUIRED` otherwise); `PROJECT_ARCHIVED`; the instance and command (`AUTONOMY_COMMAND_UNKNOWN`, skipped for a removal, so an orphan can always go); the bounds (`AUTONOMY_ABOVE_CEILING`, naming the bound in `details` and saying an owner sets it). The membership is read again before a workspace or project row in `provider` mode (`needsMembershipRead`).
- **Orphans:** after each stage B's apply, not in a replay, the rows whose instance the deployment no longer has, or whose command it no longer registers, are flagged by a journaled `autonomy-settle`, and rows backed again unflagged; nothing is journaled when nothing changed. The orphan notice's seam is `AutonomyDeps.orphaned`, which step 5's inbox wires.
- **The chrome** (`chrome/src/settings/autonomy.ts`, `autonomy-words.ts`): the tree's Autonomy entry after Keybindings (3.5), at `~/settings/loam.autonomy`; `loam-autonomy-section` with the advisory notice first, exactly 4.5's text; the workspace's mode and ceiling and its rules; the active project's mode and rules; a new rule for an app or one of its commands; the person's cap, or section 13's message in its place where `autonomy-list` says the deployment cannot keep it; and "Why a command gets its mode", the chain in words. Every read and write is an `autonomy-*` command in the scope the panel shows; a part the caller may not change is disabled with the reason in words. Native controls, as the settings section's.
- **`tally-reset`** for the jobs `autonomy-per-command` and `owner-ceiling`: first added to tally, then, by the trust review's R3, moved out of the shipped app into `p4-base`'s own fixture (below).
- **The jobs:** `autonomy-per-command`, `know-my-mode` and `owner-ceiling` run and pass in `kernel/src/scenarios.test.ts`.

**Decided while building it,** each a judgement a reviewer should check:

- **`tally-reset`** was first added to tally as a plain mutation; the trust review's R3 superseded it (below).
- **F8 for an instance row** (4.2, amended): a project row for an instance also meets the workspace's row for that instance at write time, since resolution would lower it there; the specification named only the general bound for it.
- **A project row names its project** in the input, never the call's scope, so a write cannot land in a project other than the one named; reads take the input's, else the scope's, as 4.4 says.
- **Who is an owner** is phase 3's `isOwner`: in `local` mode every actor, so D154's creator and team-listed rules bind in `provider` mode.
- **An instance a new row may name** is `shell` or one the deployment has that the workspace has not disabled; a disabled instance's existing rows are not orphans.
- **`autonomy-get` refuses an unknown command** with `AUTONOMY_COMMAND_UNKNOWN` (4.4 named it for `autonomy-set` only), rather than resolve a default for a command that is not there.
- **The hand-off's route** for a row is the section's, not `#<row id>` (3.2, amended); the cap's is `#cap`.
- **`autonomy-list`'s `writable`** (4.4, amended) lets the section disable what the caller may not change and show section 13's message for the cap, with no host decision of its own.
- **Rows are replaced whole** (4.1, amended): the store's `PUT` merges into a row it holds, so a removed `mode` or an ended orphan flag would have survived; each write deletes and puts in one batch. Found by the unit for a removed mode.
- **The workspace's general row may hold a `ceiling` alone** (4.1, amended).
- **`autonomy-settle` runs at every stage B**, not only when the generation changes, since an app's package can drop a command under the same projection.
- **The category is `setting`,** so the existing `mcpOptions()` filter keeps the three off MCP with nothing new to keep in step.

**Left for later steps:**

- **Step 5:** the orphan notice to the owners who may enter the row's project, through `AutonomyDeps.orphaned`. *Done by step 5, merged with this step:* one notice from the shell per owner per settle, through the inbox's `shellNotice` (outside the push rate and the quota, R1), naming the rows that owner may see: a project row only to an owner who may enter its project (one naming no project to no one), a workspace row to every owner. **In `local` mode the one person; in `provider` mode none until the owner roster is a server record (phase 5)**, by the coordinator's ruling after the review of `363da382`: the kernel holds only the people it has settled, and the boot settle's membership is not journaled, so a replay could not send the same. The flags are still stored and shown in `autonomy-list` and the section, and the exit is local (D126). A unit replays a local settle that sent one with no difference; another finds none sent in `provider` mode. The seam is now called in a replay too (it said "never in a replay"): the notice is a store write of the settle's own, on its clock and random, so a replay writes the same and later reads agree.
- **Step 6:** tally's `tally-reset` with its `confirm_prompt`; `p4-base`'s fixture command can then go.
- **Step 3's reservation, met** (after merging `main` at `9d611137`): the deployment reader refuses `shell` and `loam` as instance ids (`DEPLOYMENT_INSTANCE_RESERVED`). R4's guard is kept, not simplified: the kernel loads any projection its host gives it, which that reader never sees, and `late/autonomy.test.ts` still boots one with a mounted instance named `shell`. With both steps merged, `lateMinified` rises from 93,000 to 94,000 under D115 (93,244 combined); first paint 309,020 and 96,411 gzip.
- **Phase 5's step 3:** enforcement through `resolveAutonomy` (D145), including a vouched server's reads at `act`.
- **E1, waiting:** `experiment-*`'s hand-off (step 9); `autonomy-set`'s is now tested (`late/autonomy.test.ts`).

**Measured.** D115, on Windows with Node 26.13.1, against step 2's figures: `lateSettingsMinified` 30,500 to 43,500 (28,400 to 42,595, +14,195: the table, the rules, the three commands and the settle, about a third of it descriptions, input schemas and refusals in words; section 14 estimated 26,000 for the whole chunk); `settingsMinified` 36,000 to 40,000 (32,094 to 39,323: the section, its words and the tree's entry). First paint 308,800 and 96,345 gzip, within its rows (`autonomy-settle` joins `BOOT_ONLY`); `late` 83,668 of 84,000; the kernel alone 118,835 of 119,500. `budget.mjs` records each.

**Verified.** 2026-11-19, on Windows 11 with Node 26.13.1: `test --coverage` for the kernel (51 files, 1,045 tests), chrome (17 files, 241), `web`'s units (11 files, 53), tally (2) and hello (8); the typecheck of every Loam package and app; `lint:tokens` (chrome); `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check`; and six Chromium files, 39 tests: `autonomy` (4, new: the section, the notice, the hand-off, the hosted cap's message through a stubbed answer, axe in three themes), `settings`, `apps/second-app`, `budget`, `scope/first-paint` and `accessibility`. **Not run:** the rest of `test:browser`, `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and every Cargo gate.

**After the trust review,** 2026-11-19: two independent reviews of `2a585380` (one blocker in one, nine in the other, both "revise") and the coordinator's rulings R1 to R4. Each finding and what became of it:

1. **Orphans flagged and restored wrongly** (a disabled or refused mounted instance read as an empty catalog; nothing settled after a refresh): an unknown catalog is never empty, the settle runs after each catalog install and change of an instance, and R1 and R2 (4.2, amended). `late/autonomy.test.ts`: a disable, a reload while disabled and a re-enable keep the restrictive row and the tool resolves `suggest`; a refresh that drops a command flags it and one that brings it back unflags it; another server at the same instance orphans its rows, still a bound; `autonomy-rules.test.ts` holds the unknown cases.
2. **The workspace in the store's key:** rows are `<workspace>/<row id>`, and an old-shaped row is never read nor merged into (test: two workspaces in one store; a row without the key).
3. **D154's team-listed rule:** one function, `late/owners.ts`'s `teamListed`, now asks for `audience: 'team'`; `project-create` and `project-update { access }` had the same defect (a person's own instance listing a slug made it an owner's) and use it too (tests: a person's mount beside a team's).
4. **The copilot's hand-off:** the copilot's gate lets a write whose own handler refuses every agent through (`Settings.refusesAgent`: `autonomy-set`, and `setting-*` of a shared value or a human key), so it answers `HUMAN_REQUIRED` with its `details`, never `AUTONOMY_UNAVAILABLE`; `autonomy-set` decides by `isHumanGesture` (`copilot/copilot.test.ts`, a scripted turn). A person-level write an agent may make for its person stays `AUTONOMY_UNAVAILABLE` until phase 5 enforces.
5. **R4, the instance id `shell`:** the shell's commands come from the live registry, so a host's `KernelOptions.commands` are known; the shell's rows carry the identity `loam`; while an app holds the instance id `shell` (a mounted instance in a projection the deployment reader never saw can; the reader refuses the id since step 3, `DEPLOYMENT_INSTANCE_RESERVED`, and a native one cannot, `DEPLOYMENT_INSTANCE_MISMATCH`), no row or read names `shell` and its stored shell rows are orphaned, still bounds (tests: a host command; a mounted instance deployed as `shell`).
6. **Removing an unknown target:** identifiers checked by syntax first (never `*`, `/` or a space), and a removal of a vanished target only for the row held, named exactly (tests).
7. **The section in a large workspace:** `autonomy-list` pages; the section reads only its scope, a page at a time, "Show more rules" for the next (units: 600 rows over seven pages, the general row first; Chromium: a page of two).
8. **R3, `tally-reset`:** removed from the shipped tally (back to `main`); `p4-base.seed.json` gives tally a `fixtureCommands` entry, a mutation that changes nothing, which `kernel/scenarios/apps.ts` adds to the manifest the runner serves, so the three autonomy jobs still run.
9. **`writable` agrees with the write:** an archived project is `PROJECT_ARCHIVED` (test).
10. **The cap's link:** `#cap` reveals and focuses the cap's control, or section 13's message (Chromium).
11. **4.1's interface** shows `mode?` and `app?`; section 14 records the measurement.
12. **"Add rule" when disabled** sends nothing, checked in its handler.
13. **`autonomy-settle`'s JSON schema** has `maxItems` 10,000 and `maxLength` 512, as its Zod does.
14. **Improvements from the re-check** (approved at `289193b1`): `autonomy-list` ends a page before its output budget as well as at `limit`, measured in UTF-8 bytes with 4,096 bytes left for the envelope and the cursor, and always holds a row; a row's `app` is shown cut to 256 characters, since a deployer's route is of unchecked length (the stored identity is whole). The section keeps the cap and the general controls when a page read fails, the failure beside them, controls disabled when nothing was read for the scope. Units: 150 rows with 128-character commands and 6,000-character routes page within the budget; Chromium: a failed read. R1's edge and the old-format rows are recorded in 4.2.
15. **The budget,** re-measured after trimming the three commands' descriptions and their longest refusals (-471): `lateSettingsMinified` 43,500 to 45,500 (44,544), `settingsMinified` 40,000 to 41,000 (40,198); first paint 308,836 and 96,360 gzip; `late` 83,989 of 84,000.

**Verified after the trust review,** 2026-11-19, same machine: `test --coverage` for the kernel (51 files, 1,059 tests), chrome (17 files, 241), `web`'s units (11 files, 53) and tally (2); the Loam typecheck; `lint:tokens` (chrome); `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check`; and five Chromium files, 32 tests (`autonomy` 5, `settings`, `apps/second-app`, `budget`, `accessibility`). Not run: the rest of `test:browser`, `test:walk`, `test:mounted`, `test:hosted`, the desktop suite and Cargo.

## Step 10, 2026-11-19

Limits, on `lush/loam-p4-step10-limits` from `main` at `254249c3` (after steps 1, 2, 3 and 8), not merged. It gets a trust review (section 20).

**Built.**

- **The limits object** (`kernel/src/limits.ts`, first paint): the five values with section 11's defaults, enforced from boot whether or not `late-settings` ever reads the workspace's (fail closed); each instance's refusals in the last hour, on the call's clock; the owners' notice seam `KernelLimits.notify`, told the first refusal of an instance in an hour; and the journal sink's bound, on the whole entry after the redaction: one over `journalEntryBytes` is kept with its input `{}`, its result's data and tape dropped (a failure keeps its code and the first 1,000 characters of its message), marked `unreplayable: true` with its `bytes`, and counted against the calling instance, else the command's owner.
- **The port** (`apps/port.ts`, `apps/call-rate.ts`): before every check of phase 1's 5.3, the instance's call rate (a token bucket of `callsPerSecond` with a burst of 200, its check and its count one step) and then its input over `inputBytes` of JSON, each refused through the internal `app-limit-refuse`, journaled and counted: `RATE_LIMITED` with `details: { limit, retryAfterMs }`, retryable, and `INPUT_TOO_LARGE` with `details: { limit }`, each suggestion naming the key an owner sets. Every path of an app's call counts: the chrome's port, a surface's and a handler's nested client.
- **The view broker** (`apps/view-broker.ts`): a `tools/call` or `resources/read` over `messageBytes` of JSON is dropped before anything reads it, and the frame is told `INPUT_TOO_LARGE` with `details: { limit }`; counted, not journaled, since nothing runs.
- **The `store` grant** (`apps/store.ts`): one quota per apps runtime, shared by every store of an instance; each write and delete runs after the instance's last one, its check, its record and its count one store batch. A write that grows past `storeBytes` rejects `QUOTA_EXCEEDED` with `details: { kind: 'store', limit, used }`; a smaller write or a delete always lands. The count is the `store-usage` table, a row per workspace and instance (`<workspace>/<instance>`, #1614's lesson), of the UTF-8 bytes of each record's `{ key, value }` as JSON; a missing row is counted from the table. Boot's journaled `store-usage-settle` (`BOOT_ONLY`) writes the count afresh for each instance whose row differs, after stage B's apply, never in a replay.
- **The section** (`late/setting-sections.ts`): `loam.limits`, workspace only, in the tree after Notifications; the quarter rule as the section's `relate`, checked on `setting-set` and on `setting-reset` (a reset that would break it is refused too): `VALIDATION_ERROR` with `details: { field: 'value' }` and the suggestion "Lower inputBytes before journalEntryBytes; raise journalEntryBytes before inputBytes". The workspace's values are read into the kernel's at the late load and after each write of the section; a read that fails leaves the defaults.
- **`limit-usage-get`** (`late/limit-commands.ts`): a query of the `setting` category, so no port and no MCP client reaches it; refused in its own handler, `CALL_NOT_GRANTED` for a port, `HUMAN_REQUIRED` for anything but a human gesture (the copilot reaches the hand-off, `refusesAgent`), then `OWNER_REQUIRED`. It answers every deployed instance, ordered by id, or the one named, with `storeBytes: { used, limit }` and each limit's refusals in the hour. `limit` joins the shell's domains (`SHELL_DOMAINS_V1`).
- **A-P2-3:** the document middleware's bound, and `document-import`'s envelope's, is `inputBytes`.
- **Replay** (`replayKernel`): the entries before the first `unreplayable` one replay as before, then `REPLAY_ENTRY_TRUNCATED` with `details: { seq, command }` and the suggestion to replay up to the seq before it.
- **The chrome** (`chrome/src/settings/limits-words.ts`): beside each key of the Limits section, the apps it refused in the hour, most first, and for `storeBytes` the three that store the most; for a member, why it is not shown. Each line is part of its field's description.

**Decided while building it,** each a judgement a reviewer should check:

- **Where the message bound sits:** the view broker, the kernel's boundary for a view (D54), measures a request's parameters; the chrome's channel is not changed, since a message is cloned before any code can measure it.
- **What counts against the rate:** every call an app makes, refused or not, nested ones included; a replay takes nothing, since its refusals are its journal's entries. The rate and the counts are the page's memory, reset by a reload, as step 3's push rate is.
- **The hand-off's `details`** for `limit-usage-get` are `{ route, section, level }`, with no `key`, since the read names none.
- **The document bound keeps its code,** `DOCUMENT_CONTENT_TOO_LARGE`, for a person's or an agent's call (phase 2's exit tests); an app's own call meets the port's `INPUT_TOO_LARGE` at the same bound first. Amended in phase 2's 4.4 (A-P2-3).
- **A stored value is its JSON form:** the grant stores what it counted, so a `Date` reads back as its string, and a value with none (a cycle, a `BigInt`) is refused with a `TypeError`.
- **Refreshing the values:** at the late load and after this page's own writes of the section; another tab's write applies here at the next reload. Values that no longer validate read as defaults, and a stored pair breaking the quarter rule enforces `inputBytes` as a quarter of `journalEntryBytes`, never more.
- **A hosted `provider` deployment** refuses the section's writes with step 1's `SHARED_RECORD_UNAVAILABLE`, and the defaults enforce (unit).
- **The job `limit-refuses-call`** asserts `notification-push`'s fixed rate of 10 a minute and `notification-list`, step 5's commands, not section 11's limits: the runner's table names step 5 for it, and step 10's own refusals are P4-E10's units and Chromium.

**Left for later steps:**

- **Step 5:** the owners' notice through `KernelLimits.notify`, and the job `limit-refuses-call` (*both done by this step* once step 5 merged; below).
- **Step 1's `setting` table key** (the step 8 follow-up): `loam.limits`'s row is `loam.limits/workspace`, filtered by its `workspace` field on read, as every shared row is until that follow-up keys them by workspace.
- **#710, re-scoped:** section 11 answers a bound per message, input, call rate, store and whole entry. What stays deferred, by name: the journal's total and origin budget, retention, and the browser's `QuotaExceededError` (the store adapter's own failure when the origin is full).

**Measured.** D115, on Windows with Node 26.13.1, against `main` at `254249c3` built on the same machine: first paint 310,360 and 97,076 gzip (+1,232 and +615: the limits object and the journal's bound, which must hold when no late chunk loads; the call rate and the hour's counting were moved out of first paint first, -314), `jsMinified` raised from 309,500 to 310,600 and `jsGzip` from 96,500 to 97,200 with `first-paint.test.ts`'s literal; `kernelMinified` 119,500 to 121,000 (120,771); `lateMinified` 94,000 to 95,200 (94,953, +1,709); `lateSettingsMinified` 45,500 to 51,000 (50,583, +5,795, section 14's row); `appsMinified` 417,500 to 420,500 (420,251, +2,881, of which 25 the schema's reserved `limit`); `settingsMinified` 41,000 to 42,200 (41,946, +1,371). `budget.mjs` records each.

**Verified.** 2026-11-19, on Windows 11 with Node 26.13.1, at `5ea3aea2`: `test --coverage` for the kernel (56 files, 1,124 tests), chrome (19 files, 249), the manifest (15 files, 1,103), `web`'s units (11 files, 53), the SDK (30), `loam-host` (211), `loam-testing` (15) and the apps (hello 8, tally 2, notes 9, checklist 10, tasks 4); the typecheck of every Loam package and app; `lint:tokens` (the theme, chrome, the console and the five apps); `node --test scripts/plugin-manifest.test.mjs` (48); `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check` (every gate); and nine Chromium files, 92 tests: `limits` (4, new: the section and its usage, hello's refusals over `inputBytes` and the rate, the quarter rule, the agent's hand-off, axe in three themes), `settings`, `autonomy`, `scope/first-paint`, `budget`, `apps/view`, `apps/second-app`, `apps/native` and `accessibility`. **Not run:** `pnpm verify`, whose plan holds the whole `test:browser` (its script builds the Specimen host with Cargo), `test:walk`, `test:mounted`, `test:hosted` and the desktop's Cargo gates, none of which this machine runs; `loam.yml` is CI's.

**After the trust review,** 2026-11-19: two reviews of `2d8aee91` (one "revise" with 2 blockers, one "revise" with 11) and the coordinator's rulings. The rulings on the step's two questions: the job `limit-refuses-call` stays with step 5; a stored value is its JSON form, accepted by both reviewers. And four new rulings, each built:

- **R1, workspace keying (closes #1614):** step 1's shared `setting` rows are keyed `<workspace>/<section>/…` (3.4, amended); `store-usage` rows already were; the quota counts and refunds only rows its workspace wrote, or a phase 1 row with none. A store's record id has no workspace part (phase 2's D77: one workspace per deployment), so a row another workspace wrote in the same browser's `app-<instance>` table is neither charged nor refunded here.
- **R2, values with no JSON form are over every limit:** the frame gate, the view broker and the port refuse one (`VALIDATION_ERROR` with a suggestion, journaled and counted under the limit it met); the journal bound keeps such an entry truncated; the store refuses one, `undefined` itself included, with `VALIDATION_ERROR` before any charge. The port measures and dispatches one detached JSON copy of the input.
- **R3, hosted:** a hosted `provider` deployment, or one whose host is not known yet, enforces the defaults and never reads a stored `loam.limits` row; the values are read again once stage B knows the host.
- **R4, journal growth from refusals:** recorded in section 11 rather than folded, since folding would break a nested refusal's replay.

The blockers, and what each became:

1. **`messageBytes` over the whole frame boundary:** the chrome's channel calls the kernel's `admit` (`FrameAdmitV1`, `apps/limit-guard.ts`) on every message from a view's frame and from a handler frame, before any dispatch, log, read or reply handling: a refused request is answered with the refusal, a refused reply fails its request, a refused notification is dropped. `ViewBrokerV1.admit` and `KernelPortsV1.openHandlerFrame`'s third argument carry it. What stays outside is in section 11.
2. **Hosted:** R3; a unit starts a hosted `provider` kernel on a store a local deployment left a lower `inputBytes` in, and it enforces the default.
3. **Documents charge the store:** `document-create` charges its template's content to the type's instance in the same batch as the record and the content (`StoreQuota.charge`), refusing `QUOTA_EXCEEDED` with nothing written; expiry refunds what each content row was charged (it reads the row's `bytes`, never the content's meaning); each record keeps the `bytes` it was charged, so an overwrite or a delete subtracts that alone. Phase 2's P2-D4 "never reads a document's content but to move it" now allows the quota's one count of the table when it has no usage row (amended, listed against P4-E14).
4. **No refund for a non-JSON overwrite:** R2; each write sends the record whole with its `bytes`, so a store that merges a PUT into the row keeps nothing of the old charge (MemoryAdapter and IndexedDB units).
5. **Workspace boundaries:** R1; a unit runs two workspaces on one store: settings rows, limits and usage never cross, and a row in the old shape is neither read nor overwritten.
6. **The journal bound:** every kept field is bounded (`error.code` to 128 characters, the message to 1,000, names, the actor), the size is checked again after truncation, falling back to fewer fields, with 256 bytes left for the sink's `seq`; no entry is kept over `journalEntryBytes`.
7. **The port's input:** measured and dispatched as one value (R2).
8. **The rate across broker and port:** a `tools/call` refused before the port (at the gate, by the broker or by the handler frame) takes its place in the rate there; one the port takes is charged at the port; so each is charged once. At most 4 `resources/read` are in flight per instance, the next refused `RATE_LIMITED` through `app-limit-refuse`.
9. **`QUOTA_EXCEEDED` reaches callers:** a kernel refusal thrown into a native handler answers as that refusal, code and details; the channel's `rpcErrorOf` keeps a refusal's `details` (but `rpcCode`); the SDK's frame answers the shell's refusal of its own request as that refusal. Units: hello's shipped `hello-greet` over a full store, the SDK's handler frame, the channel.
10. **Replay before any truncated entry:** the frame gate's refusal is journaled (`app-limit-refuse`, top level, the instance its caller), so `limit-usage-get` replays (hello's view, a unit); a nested call the rate refused is answered in a replay from its recorded `app-limit-refuse`, matched by the command it names, and counted as its handler counted it live. The nested test now runs its handler: on a clock that does not move, the outer call takes the last place and both nested calls are refused, and the session replays with no difference.
11. **Refusal accounting:** per instance, 60 per-minute buckets of five counts, O(60) per refusal, with no upper cutoff; a separate last-notified time, so the seam hears an instance at most once an hour. **A reload may notify again,** since the time is the page's, as the counts are. A unit: 100,000 refusals in well under two seconds, counted.
12. **Read-side fail closed:** units with a stored row over its bound, one not a whole number, a pair breaking the quarter rule (clamped), and a store whose read fails.

The improvements:

- **13:** stage B counts an instance's table only when it has no usage row, or its last count (`countedAt`) is a day old or from a later time; a unit boots three times and counts once.
- **14:** two tabs writing one instance's store at once can each pass the check against the same row, so the quota can be exceeded by at most one write per other tab, and the row can lose one tab's change; the daily count corrects it. Recorded, not prevented: a lock across tabs is the collaboration service's.
- **15, declined with a reason:** an entry over `journalEntryBytes` is counted against its caller when an app made the call, else against the command's owner: the owner's command accepted the input, and `limit-usage-get` reports instances, not people.
- **16:** `measureJson` skips the encoding when the string's length alone decides (longer than the bound, or a third of it or shorter).
- **17:** in section 11's notes above.

Also: the handler frame's gate refusal of a nested `tools/call` is journaled top level, as the instance, since the frame's message is refused before the call it would make exists; a replay that runs the handler natively makes that nested call and reports it unrecorded. Recorded, not changed: the frame must send over 1 MiB in one message for it. **A second edge, the same way:** a handler frame's reply over `messageBytes` fails the call live, while a replay that runs the handler natively, with no frame, succeeds and reports the difference.

**After the re-check** of `4b52e595` (every code fix confirmed; one documentation and test blocker):

- **P2-D4's amendment** is listed against P4-E14, naming both counts that list an instance's table (no usage row; the daily recount) and expiry's read of each row's charge; phase 2's spec notes it beside the test's rule; the test allows at most one `app-probe` list.
- **3.4:** old-shape shared settings are not migrated; an owner sets them again, and a lowered `loam.limits` reads as its defaults until then.
- **A provider boot with a loader:** a unit holds that no stored `loam.limits` row is read while the host is unknown, and that it is read once stage B learns a static host, and never for a hosted one.
- **The frame host's gate:** a unit holds that `createFrameHost` passes its gate as `openHandlerFrame`'s third argument, with a refused notification and a refused request, each journaled for the instance; another that `webPorts` forwards it to the view chunk.
- **Expiry's refund** after the delete has landed is caught and reported, never failing the expiry; the daily recount corrects the count.
- **Reads in flight** answer `-32602` and are counted under `callsPerSecond` (section 11).
- **The second replay edge** above.

**Measured after the review,** against the step's figures above: first paint 311,543 and 97,564 gzip (+1,183 and +488), `jsMinified` 310,600 to 311,800 and `jsGzip` 97,200 to 97,800 with `first-paint.test.ts`'s literal; `kernelMinified` 121,000 to 122,600 (122,351); `lateMinified` 95,200 to 95,800 (95,556); `appsMinified` 420,500 to 423,000 (422,704); `viewMinified` 26,100 to 26,600 (26,498); the rest within their rows. `budget.mjs` records each.

**Verified after the review,** 2026-11-19, same machine: `test --coverage` for the kernel (56 files, 1,147 tests), chrome (20 files, 252), the SDK (31), `web`'s units (53), the manifest (1,103), `loam-testing` (15), `loam-host` (211) and the apps (hello 10, tally 2, notes 9, checklist 10, tasks 4); the typecheck of every Loam package and app; `lint:tokens`; `budget`; `node scripts/check-doc-lines.mjs`; `pnpm check`; and sixteen Chromium files, 229 tests: `limits`, `settings`, `autonomy`, `scope/first-paint`, `budget`, `apps/view`, `apps/second-app`, `apps/native`, `apps/refusal`, `apps/overlays`, `accessibility` and the `documents` folder. `apps/view`'s "cannot lose a journal entry with a value JSON cannot hold" failed once on the gate's first JSON-RPC code, `-32600`; the gate answers `-32602`, invalid params, as the broker did, and it passes. **Not run:** `pnpm verify` and the Cargo-gated suites, the coordinator's.

**Merged with steps 4 and 5** (`main` at `cb4d5dff`), 2026-11-19, as merge `d4a3c0de`, keeping both sides: step 5's inbox and settings code beside R1's keying in `late/settings.ts`, step 4's `overlay-global-set` beside `app-limit-refuse` in the internal commands, the view broker's and `ViewBrokerV1`'s additions together. Then:

- **The owners' notice:** `KernelLimits.notify` runs boot's journaled `limit-notice-push` (`BOOT_ONLY`) after the call that met an instance's first refusal in an hour, and its handler pushes step 5's `shellNotice` to the person the shell is for, every person an owner in `local` mode, as the orphan notice does; in `provider` mode none, until the owner roster is a server record. Never in a replay, whose entry holds it, so a replay pushes the same notice once. A unit: two apps refused, one notice each, a second refusal in the hour none, the session replays with no difference; none in `provider` mode.
- **The job `limit-refuses-call`** runs and passes in `kernel/src/scenarios.test.ts`. Its last step is amended: hello read its own inbox with `notification-list`, which 10.2 gives no app (`CALL_NOT_GRANTED`), so the person reads it and finds the ten.
- **Measured on the combined build,** under D115: first paint 312,548 and 97,875 gzip, `jsMinified` to 312,800 and `jsGzip` to 98,000 with `first-paint.test.ts`'s literal; `lateMinified` to 109,500 (109,143); `lateSettingsMinified` to 67,500 (67,013); `appsMinified` to 424,000 (423,710); `viewMinified` to 26,800 (26,691). With the notice: `lateMinified` to 109,800 (109,503, +360) and `lateSettingsMinified` to 68,000 (67,841, +828); first paint 312,568 and 97,885 gzip. `budget.mjs` records each.

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
| 2026-11-13 | Third round | A fresh re-check of this revision | Done 2026-11-13: the coordinator checked `203cb3a0` and approved |
| 2026-11-18 | Step 2's re-check | The settings section's panel read and `show()` share one read counter, so a panel re-read during a scope change's `show()` can leave the tree and level tabs naming the old project (labels only; writes stay bound to the shown scope) | Open |
| 2026-11-18 | Step 2's re-check | `#hashHeard` may answer the shell's own `#key` writes with a duplicate, journaled `section-open`; compare the route's path rather than the key | Open |
| 2026-11-18 | Step 2's re-check | A Chromium case for the chrome's key-by-key fallback on an oversized section (the kernel half is tested) | Open |
| 2026-11-19 | Step 8 | Wire the orphan notice to the owners who may enter an orphaned row's project through `AutonomyDeps.orphaned` | Done 2026-11-19 by step 5, merged with step 8, in `local` mode |
| 2026-11-19 | Step 5's wiring of step 8's orphans (the coordinator's ruling) | The orphan notice in `provider` mode, to the owners who may enter the row's project, once the owner roster is a server record and journaled with the settle (phase 5's shell commands over MCP) | Open; phase 5 |
| 2026-11-19 | Step 8 | Flag a mounted instance's command rows when its catalog drops a command: `autonomy-settle` runs at stage B's apply, before any catalog is read, so only a gone instance orphans them | Done 2026-11-19, after the trust review: the settle runs after each catalog install |
| 2026-11-19 | Step 8 | The autonomy section's new-rule form lists the apps only; a rule for one of the shell's own commands is set with `autonomy-set` | Open |
| 2026-11-19 | Step 8 | A Chromium case for the cap's message on a real hosted `provider` projection (the step's case stubs `autonomy-list`'s answer; the kernel's unit holds the rule) | Open |
| 2026-11-19 | Step 8's trust review | Step 1's `setting` table keys a shared row by `<section>/workspace` alone, as autonomy's did: a second workspace's first write in one browser's store would replace the first's row. Key it by workspace as autonomy's now are | Done 2026-11-19 by step 10's R1 (3.4, amended; #1614) |
| 2026-11-19 | Step 5's reviews (R1) | Per-source shares of the 500: one app or the agent interface can still fill the room the others' notices need | Open |
| 2026-11-19 | Step 5's reviews (R3) | The revoked session's notice: the provider gives a reason on a refused session, so the kernel tells a revocation from a sign-out in another tab and notices it in the person's inbox | Open; with the provider |
| 2026-11-19 | Step 5's verification (R2 amended) | A shared, age-ordered cap with virtual capping, and a hidden toast's timer and `user` close simulated as a shown one's are, if mute privacy needs to hold against others' activity and the person's own handling of toasts | Open |
| 2026-11-19 | Step 5's verification of `0e2fba70` | Journal an agent's or an app's `notification-list` (a per-caller filter leaving out only the shell's own read), since `body: true` returns notice bodies and a pending confirmation's input | Open |
| 2026-11-19 | Step 10 | Wire the owners' notice of an instance's first refusal in an hour through `KernelLimits.notify` | Done 2026-11-19, after merging step 5: `limit-notice-push` |
| 2026-11-19 | Step 10 | Read `loam.limits` again when another tab writes it: today a page reads it at its late load and after its own writes | Open |
| 2026-11-19 | Step 7 (the coordinator's R1) | Make the reserved chords' actions commands (`shell-focus-next`, `shell-focus-previous`, `shell-save`, `shell-project-switcher`), which are listed and rebindable but refused when called (`KEYBINDING_ACTION_ONLY`) | Open |
| 2026-11-19 | Step 7 | Read a person's overrides again when another tab writes them: today a page reads them at its late load, after its own writes and on a change of person | Open |
