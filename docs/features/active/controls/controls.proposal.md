# Controls: an agent reads and fills the controls on a screen

A designed path for an agent inside an AFD application to see the controls a person is looking
at and to change their values. Commands still do an application's work. This covers what
happens before one is called: the draft a person and an agent fill in together.

## Status

- **State:** active. Written 2026-11-24 against `8347a597`, and approved by the owner the same
  day, who agreed with the six recommendations he was shown
  ([section 10](#10-for-the-owner)) and said to proceed with phase A. It has eighteen jobs, fourteen of them as scenario files, four drafted
  commands and four error codes. The scenario checks pass, and one reader who did not write
  them walked the paths three times ([section 6](#6-what-the-walks-changed)).
  [STATUS.md](STATUS.md) tracks progress, and [spec.md](spec.md) is phase A's specification.
- **Verified:** the claims in [What exists today](#2-what-exists-today) that carry no mark were
  read first-hand on 2026-11-24 at `8347a597`.
- **Not verified:**
  - Everything in [Design direction](#4-design-direction). Nothing was built or run.
  - The lines marked *surveyed* in section 2. Three reader agents read them the same day and
    cited each line; a sample was then checked first-hand, and the sample is what carries no
    mark.
  - That an agent with these commands fills a real form well. No model has used them.
- **Next:** phase A ([#2487](https://github.com/lushly-dev/afd/issues/2487)), built to
  [spec.md](spec.md).

| Field | Value |
| --- | --- |
| Epic | [#1385](https://github.com/lushly-dev/afd/issues/1385), step 8. One issue for each phase: [#2487](https://github.com/lushly-dev/afd/issues/2487) (A), [#2488](https://github.com/lushly-dev/afd/issues/2488) (B), [#2489](https://github.com/lushly-dev/afd/issues/2489) (C), [#2490](https://github.com/lushly-dev/afd/issues/2490) (D). They replace #2275, whose approach this proposal was |
| Units likely touched | `packages/view-state`; `packages/testing` (a fixture adapter); `foundations/specimen` and `integrations/specimen-fast-af` (the state contract); `foundations/fast-af/packages/violet-elements` (components held to it); one example application |
| Related | [Agent-First Design](../agent-first-design/agent-first-design.proposal.md#510-where-the-parts-live), section 5.10 and question 13; [`afd-view-state`](../../../../packages/view-state/README.md) |

## 1. Problem

On 2026-11-24 the owner agreed that an agent inside an AFD application should see and fill
what is on the screen, through `afd-view-state` and with no actions declared by components
([Agent-First Design](../agent-first-design/agent-first-design.proposal.md#9-for-the-owner),
question 13). Asked the same day what "shoehorning it in with some other command/ui layer" had
meant, the owner said that "a system designed to allow an agent to edit controls and their
content is better than what AFD might have done without the feature which would have been a
work around; something like have a commands(s) that helps set values then some code in the UI
that applies it", and that "we should have a proper path to allow the UI on AFD to be
manipulated by an agent (fields updated, etc)". That sentence was about a designed path in
place of a workaround. It chose nothing further about packages or layers.

Three facts make the gap:

- **An agent inside an application can call commands and set registered view state, and
  nothing else.** `@lushly-dev/afd-view-state` has three commands over ids whose state is an
  opaque record ([section 2](#the-command-layer)). It cannot say what a field is called, what
  it holds or what it would accept.
- **Every view-state handler is written by hand.** The todo example's filter is the workaround
  in miniature: its controls call a session method, which calls `registry.set`, and a
  hand-written handler applies what a command sets
  (`packages/examples/todo/frontends/shared/src/view-state.ts:109`). No element is bound to
  anything (*surveyed*).
- **A draft is not a command's business.** A command does the work: it books the seat. Helping
  a person fill the form comes before it, and the person reads the form and submits it. A
  command that took the values would skip the form and the person's look at it.

## 2. What exists today

### The command layer

- **View state is three commands.** `view-state-get`, `view-state-set` and `view-state-list`
  read and write a `Record<string, unknown>` under an id
  (`packages/view-state/src/commands.ts`). A set returns `undoCommand` when the handler can
  replace its whole state (`:246`). Given an adapter, the registry persists every state
  (`packages/view-state/README.md`, "Persistence").
- **A handler knows who called.** Its context carries `actor`
  (`packages/core/src/commands.ts:425`), which a `DirectClient` sets to a person unless told
  otherwise and an MCP server sets to an agent.
- **`allow` sees a command's name and nothing else** (`packages/client/src/direct-types.ts:67`,
  `packages/server/src/direct-registry.ts:158`). Two capabilities can be granted apart only
  when they are different commands.
- **A command is exposed to the palette and the in-app agent unless it says otherwise.** MCP
  and the CLI are opt-in (`packages/core/src/commands.ts:97`).
- **A batch is not atomic.** `afd-batch` reports each item, and the items that succeeded stay
  applied (*surveyed*, `packages/core/src/batch.ts`).
- **No AFD package acts on `undoCommand`.** The client copies it through
  (`packages/client/src/result-state.ts:121`); offering the undo is the application's, as the
  todo example does (`packages/examples/todo/frontends/shared/src/session.ts:274`).
- **A host bounds a command's output only when the command declares a budget** (*surveyed*,
  `packages/server/src/direct-registry.ts`).
- **Some interface state is not a command.** "Not commands: ephemeral UI state (hover, focus,
  scroll, tooltips), view preferences that are not persisted, values derived from data the
  client already has (totals, formatting, local sorting) and framework events." The test it
  gives starts: "would an agent ever need to do this?"
  (`.claude/skills/afd/references/command-schema.md:87`). Neither that page nor the whitepaper
  says where view state stands (*surveyed*).

### The component library

`violet-elements` has 77 elements. A reader agent surveyed the 25 that hold state a person
changes. All of this subsection is *surveyed* except the lines that cite a file, which were
checked first-hand.

- **Nothing binds an element generically.** FAST's `twoWay` directive is used by no component
  and no application. Loam's console has separate code for a checkbox, a select and a text
  field.
- **The state contract is not uniform.** 20 of the 25 emit `change`, with eleven shapes of
  `detail` among them. At least eleven break one of the three rules of
  [4.6](#46-the-librarys-part) somewhere:

  | Rule | Where it breaks |
  | --- | --- |
  | Settable | `violet-combobox`: choosing from script needs `selectValue()` (`src/combobox/violet-combobox.ts:815`), and its guide says assigning `value` "changes only the text" (`violet-combobox.guide.json`, `combobox.script`). `violet-color-picker`: `open` can be assigned and nothing opens (`src/color-picker/violet-color-picker.ts:607`) |
  | Announced | `violet-segmented-control`: `change` carries no detail (`src/segmented-control/violet-segmented-control.ts:288`). `violet-pagination`: two events for one change, `page-change` and a `change` with no detail (`src/pagination/violet-pagination.ts:246`). `violet-tabs`: `change` carries the tab element (`src/tabs/violet-tabs.ts:417`). `violet-accordion-item`: it announces a request, and its parent changes it (`src/accordion-item/violet-accordion-item.ts:223`) |
  | Quiet | `violet-tabs`, `violet-dialog`, `violet-popover`, `violet-menu`, `violet-date-picker` and `violet-date-range-picker`: a script's write emits the event too, so it cannot tell a person from a script |

  `violet-select` is not among them: its `value` can be assigned
  (`src/select/violet-select.ts:404`), and its `selectValue()` is a second way in that also
  emits. The survey raised smaller points on others, a list box's `value` in its multiple mode
  and a tree's second event among them, which a closer reading has to settle.
- **A label cannot be read the same way twice.** Most take a `label` attribute; the checkbox,
  the switch and the radio take their label from the default slot. No component has a `labels`
  property (no `get labels` in `src/`), though 14 are form-associated.
- **The manifest does not record an event's detail.** `custom-elements.json` gives each event
  a name and a description.
- **The guides say the rules in prose.** `field.input-change`, `event.input-once`,
  `toggle.form-value` and `overlay.open-change` are shared rules in `src/shared.guide.json`.
  Each is a statement its author wrote, and no check verifies any of them.

### Specimen

*Surveyed*, except the lines that cite a file.

- **The story contract is a fixed list of codes** (`foundations/specimen/src/contract.ts:48`).
  For a form-associated component it already asks for evidence that a play read `FormData` and
  checked validity (`:221`). A library cannot add a rule as data.
- **A story's play can change a control and assert what followed,** and the capture of a story
  keeps no events. A guide statement becomes `verified` when a play's claim carries a check
  that held.
- **One passing claim on one component verifies a shared rule**
  (`foundations/specimen/src/guide-coverage.ts:130`). A rule owed by every stateful component
  fits the contract, which already loops over components, and not a shared guide rule.

### A published design

UI SDK's agent bridge, read on 2026-11-24 and summarised in
[Agent-First Design](../agent-first-design/agent-first-design.proposal.md#a-published-design-to-compare),
section 5.10. [Section 4.7](#47-kept-different-on-purpose) says where this direction differs
from it.

## 3. Jobs

Eighteen jobs. Fourteen are scenario files in [`scenarios/`](scenarios/), numbered as here;
four cannot be one ([section 7](#7-what-a-scenario-cannot-show)). All fourteen are tagged
`slice`: the proposed first slice is every job a scenario can show.

| # | Job | For | Sentence | As |
| --- | --- | --- | --- | --- |
| 1 | `read-the-screen` | Agent | When a person asks me to help with the form in front of them, I want the controls on the screen with their labels, kinds, values and choices, so that I know what can be filled and with what | Scenario, `slice` |
| 2 | `fill-several-at-once` | Agent | When I know the values a person wants, I want to set several controls in one call and be told what each held before, so that the form is filled in one step and I can say what changed | Scenario, `slice` |
| 3 | `all-or-nothing` | Agent | When one of the values I send is refused, I want none of them applied, so that the person never sees a form that is half one fill and half what it was | Scenario, `slice` |
| 4 | `corrected-by-the-refusal` | Agent | When I set a control to a value it does not take, I want the refusal to say what it does take, so that I can correct the value without reading the screen again | Scenario, `slice` |
| 5 | `find-a-choice-in-a-long-list` | Agent | When a control offers more choices than its listing carries, I want to search them by their text, so that I can find the value to set without reading every choice | Scenario, `slice` |
| 6 | `secret-stays-secret` | Person | When a control holds a secret, the agent must not be shown its value or its error, or be able to set it, so that my secrets never pass through an agent | Scenario, `slice` |
| 7 | `not-editable-is-refused` | Agent | When a control is disabled, read-only or not shown to the person, I want my change refused with the reason, so that nothing changes that the person could not have changed or cannot see | Scenario, `slice` |
| 8 | `left-the-screen` | Agent | When a control I mean to change is not on the screen, I want to be told and sent back to read the screen, so that I do not act on a screen that is gone | Scenario, `slice` |
| 9 | `do-not-overwrite-what-was-typed` | Person | When I have changed a control since the agent read it, I want its write to that control refused, so that it never replaces what I just typed without having seen it | Scenario, `slice` |
| 10 | `nothing-bound` | Agent | When the application has bound no controls on the screen, I want an empty answer that says so, not an error, so that I know there is nothing here for me to fill | Scenario, `slice` |
| 11 | `take-it-back` | Person | When an agent has filled controls on my screen, I want one step that puts back what was there and keeps anything I changed since, so that a wrong fill costs me nothing | Scenario, `slice` |
| 12 | `hand-it-back` | Agent | When the form is filled, I want to know what the screen is, which command its form is for and what is still missing, so that I can tell the person it is ready for them to read and submit | Scenario, `slice` |
| 13 | `errors-after-a-fill` | Agent | When a value I set is accepted and the form then shows an error for it, I want that error in the answer, so that I can correct it without reading the screen again | Scenario, `slice` |
| 14 | `one-change-moves-another` | Agent | When setting one control changes another, its choices or its value or whether it can be edited, I want the answer to carry the controls that moved, so that I have them without reading the screen again | Scenario, `slice` |
| 15 | `see-what-the-agent-changed` | Person | When an agent changes a control, I want the screen to show me which ones it changed, until I change them myself, so that I read those before I submit | Tests of the registry's notice |
| 16 | `bind-once` | Developer | When I build a form, I want to bind its controls in one place, with no handler written per control, so that the agent's path costs me a line and not a layer | Tests of the binder |
| 17 | `panels-not-contents` | Developer | When I let an agent move around my application, I want to keep what a person has typed from it, so that giving it navigation never exposes anyone's draft | Tests of `allow` |
| 18 | `hold-a-component-to-the-contract` | Library author | When I add a component that holds state, I want a check to fail if its state cannot be set as a property or its change is not announced, so that any control can be bound with no code written for it | Specimen fixtures |

## 4. Design direction

Not verified. It is the direction each phase's specification is written against;
[spec.md](spec.md) is phase A's.

### 4.1 Where it lives

In `@lushly-dev/afd-view-state`, the package the owner agreed to, as entries of its own beside
the existing ones: a `ControlRegistry` and the binder under `/controls`, and the commands
under `/controls/commands`. Within that package a control is not an id in the view-state
registry, and its commands are not `view-state-*`, for four reasons:

1. **Permission.** `allow` sees a name, so reading what a person typed has to be a different
   command from switching a panel (job 17).
2. **Persistence.** View state is written to storage when an adapter is given. A draft, which
   can sit beside secrets, is not.
3. **Description.** A control has a label, a kind, choices and limits. View state is an opaque
   record, and widening it would change `view-state-list` for every caller.
4. **One binding core.** The binder #2275 first asked for, an element's property and change
   event behind a view-state id, and the binder for a control are the same core with two
   registries.

Separate commands inside the agreed package is the session's technical choice.

### 4.2 A control

What `control-list` returns for each bound control:

| Field | Meaning |
| --- | --- |
| `id` | The name it is bound under |
| `rev` | A token the registry issues for the control as it now is. It changes whenever anything in this row changes, whoever changed it, and when the control is bound again. Absent for a secret |
| `group` | The part of the screen it belongs to, when the application names one |
| `kind` | `text`, `number`, `boolean`, `choice` or `choices` (several at once) |
| `label` | What a person reads beside it |
| `description` | The help text a person reads with it, when there is any |
| `value` | A string, a number, a boolean, a choice's value or a list of them, by kind. Absent for a secret |
| `format` | The form text must have: `email`, `date`, `time`, `color` |
| `required`, `disabled`, `readOnly`, `hidden`, `secret` | Present when true. `hidden` means bound and not rendered to the person: hidden, inert, or inside a closed section or an inactive tab. A control further down a page that scrolls is not hidden |
| `min`, `max`, `maxLength` | The limits it declares |
| `choices` | `{ value, label }` for each, when there are ten or fewer |
| `choiceCount` | How many there are, when there are more than ten and `choices` is left out |
| `error` | The message the control shows when it is invalid. Absent for a secret |

A control with two values, a date range for one, is bound as two controls. Ten is a starting
point, not a finding.

### 4.3 Commands

| Command | Input | Data | Refuses with |
| --- | --- | --- | --- |
| `control-list` | `group?`, `limit?` (50, at most 100), `offset?` | `screen?`, `command?`, `controls`, `total`, `more` | `NOT_FOUND` for a group the screen does not have |
| `control-set` | `values`: 1 to 50 of `{ id, value, rev }` | `changed`: `{ id, value, previous, rev, error? }` for each; `unchanged`: ids that already held the value; `affected`: other controls the write moved, each as `control-list` gives it; `missing`: ids of required controls still empty | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_ERROR` |
| `control-restore` | `controls`: 1 to 50 of `{ id, rev }` | `restored`: `{ id, value, rev }` for each; `skipped`: `{ id, reason }`; `affected`; `missing` | Nothing of its own: what it cannot put back it skips and reports |
| `control-choices` | `id`, `search?`, `limit?` (20, at most 50), `offset?` | `id`, `choices`, `total`, `more` | `NOT_FOUND`; `VALIDATION_ERROR` for a control with no choices |

| Code | When | The suggestion | `recovery` |
| --- | --- | --- | --- |
| `NOT_FOUND` | An id or a group is not on the screen | Names `control-list` | `call` |
| `FORBIDDEN` | The control is a secret | Says the person enters it themselves | `external` |
| `FORBIDDEN` | `control-set` is called as a person | Says to create the client as an agent | `external` |
| `CONFLICT` | The control is disabled or read-only | Says which | `stop` |
| `CONFLICT` | The control is not shown | Says the person opens that part of the screen | `external` |
| `CONFLICT` | The `rev` sent is not the control's own | Names `control-list` | `call`, without `thenRetry` |
| `VALIDATION_ERROR` | The value breaks a limit the control declares: its kind, its choices, its range, its length, its format | Says what the control takes, or names `control-choices` when the choices are many | `fix-input`, or `call` |
| `VALIDATION_ERROR` | `control-choices` is asked about a control that has no choices | Says what the control takes, and names `control-set` when the caller may call it | `call`, or `stop` when the caller may not |

All four codes are in the shared catalog, and `recovery` is as
[`spec/recovery.md`](../../../../spec/recovery.md) defines it.

- **`screen` and `command`** are what the application names when it binds a form: the screen a
  person is on, and the command the form is for. With `missing`, they are what an agent tells
  the person when it hands the form back (job 12).
- **`control-list` declares an output budget** and pages, since a host bounds nothing a
  command does not declare. `more` is how many are left after the page returned, here and in
  `control-choices`. A screen with nothing bound is a success whose `reasoning` says so.
- **The descriptions carry what a model must know with no skill installed:**
  - read the screen first, and send each control's `rev` back as it was read;
  - an id is not a label, and a `rev` is never made up;
  - the value each kind takes, and that a choice may be given by its label;
  - a secret is the person's to type;
  - a fill does not submit; the form's command is called only when the person asks, with what
    the screen then shows and not what the agent remembers writing;
  - `details` lists every refusal;
  - after a refusal for a control that changed, read what it now holds and keep the person's
    edit unless they ask otherwise;
  - `control-restore` is the undo, and takes what `changed` returned.

### 4.4 Rules

- **Bound, or not there.** An application binds the controls an agent may see. A control it
  did not bind is not listed and cannot be set, and a refusal does not tell it from a control
  that does not exist. An application may bind one for reading only, and it then lists as
  `readOnly`. This is the default a command has toward MCP: private until it says otherwise.
- **A write proves what it replaces.** Each control has a `rev`, and a write sends the `rev` of
  the control it changes. If that is not the control's own `rev`, because a person, an agent
  or the application changed the control, or it was bound again, the write is refused with
  `CONFLICT`. The guard is per control, so it holds across pages, groups and other writes, and
  for a `rev` the registry never issued (job 9). It also refuses a write meant for one record
  that would land on another bound under the same names (job 8). A `rev` is never issued
  twice. A write returns the new `rev` of each control it changed, and of each it moved, so a
  caller's next write needs no read between. What the guard proves is that the caller holds
  the control as it now is. It does not prove the caller weighed what the person typed, which
  is why the descriptions tell a model to keep it.
- **A change that announces nothing still counts.** A script's write fires no event, and
  neither does a control that becomes disabled or is shown. So the registry does not wait to
  be told: each time a command reads or writes a control it compares the control with what it
  recorded, and a control that differs has a new `rev`.
- **Within its entry, a secret is refused before anything else is checked.** A control is a
  secret when the application says so, when it is a password field, or when its `autocomplete`
  names a password, a one-time code or a card number. An application can mark more controls
  as secrets and cannot unmark one of these. Its value, its error and its `rev` are never
  returned, in a listing, a result or a notice, and it is never named in `missing`, which
  would tell whether it is empty. Setting it is `FORBIDDEN` (job 6).
- **All or nothing.** `control-set` checks every entry before it writes any. The error is the
  first refusal in the order sent, its message counts them and its `details` lists them all.
  If a write throws, the ones made before it are put back. Fifty is the most one call carries,
  so a longer fill is two calls and is whole only within each.
- **What is declared is refused; what the form then shows is reported.** A value that breaks
  a limit the control declares is refused. `required` is not such a limit: a control may be
  emptied, and `missing` reports it. An error the form shows by the time the write returns
  comes back in `changed` (job 13); one that arrives later is seen on the next read.
- **What the person cannot see is not filled.** A control whose element has left the document
  is unbound. One that is bound and not shown lists as `hidden` and refuses a write (job 7).
- **Values, not presses.** There is no command to press a button. Saving a form is a command
  of the application's, with its schema, its approval and its undo, which the person
  triggers, or the agent calls when the person asks. A press would be a second way to run it
  that has none of those.
- **A choice by its value or its label.** A label is accepted when exactly one choice has it,
  compared without case. The result always gives the value.
- **Who changed it.** The registry tells the application of every change with the caller's
  `actor`, a person's among them, so a screen can mark what an agent filled and clear the mark
  when the person changes it (job 15). Nothing is added to a component's event. `control-set`
  refuses a caller that is a person, so a client that forgot to say it is an agent fails
  loudly the first time, and never marks an agent's fill as the person's.
- **Undo is a command of its own.** For the last `control-set` to write a control, the
  registry remembers the value it replaced and the `rev` it returned. `control-restore` takes
  the `id` and `rev` of each control a fill changed, which is `control-set`'s `undoArgs`, and
  puts that value back when the `rev` is the one that write returned and the control's value
  has not changed since. It carries no values, so it cannot be used to set one, and a value
  that was there before is put back whatever the limits say.
  - **What drops the memory:** any later change to the control's value, by a person, the
    application, another write or a restore, and the control being bound again or unbound. A
    `rev` read after a person's edit therefore restores nothing, and nothing remembered for
    one record can land on another.
  - **What it skips:** a control with nothing remembered, one that is no longer shown or
    editable, one that has left the screen, and a secret, each reported with its reason
    (job 11). An error that arrives late, or choices loaded again, do not stop a restore.
  - **Checked whole, then written.** Every entry is checked against the screen as it was
    before any is put back, so a control the restore itself moves is not skipped for that.
  - **One level, and no undo of the undo.** A restore is not remembered and returns no
    `undoCommand`. A second one, or a second press of a person's undo button, puts back
    nothing.
- **Exposure.** `control-list`, `control-set` and `control-choices` go to the in-app agent
  only, by default: not the palette, where a person has the controls themselves, and not MCP
  or the CLI. `control-restore` goes to the agent and the palette, so an application's undo
  button can call it as the person. An application may expose them to MCP as it may expose
  view state.
- **Not stored.** The registry persists nothing.

### 4.5 Binding

Interfaces only; the bodies are the specification's and the build's.

```ts
// @lushly-dev/afd-view-state/controls
const controls = new ControlRegistry();
const unbind = bindControls(controls, form, {
  screen: 'Book a workshop seat', command: 'workshop-book', group: 'Booking',
});                                                          // every control inside the form
bindControl(controls, element, { id: 'session', contract }); // one element, its contract stated
controls.onChange(({ id, value, previous, actor }) => {});   // job 15

// @lushly-dev/afd-view-state/controls/commands
const commands = createControlCommands(controls);
```

- **Native controls need nothing stated.** An `input`, a `textarea` and a `select` have a
  standard property, standard events, `labels` and `validity`. A control is named by its
  `name`, else its `id`. Radio buttons of one name are one `choice`, checkboxes of one name
  one `choices`, a single checkbox a `boolean`. A control with no label, or a name already
  bound, is not bound, and the binder says so while developing.
- **A custom element needs its contract,** as data: its kind, the property that holds its
  state, the event that announces a change, and where its label and choices are read
  ([4.6](#46-the-librarys-part)). A contract that names a property or an event the element
  does not have fails when it is bound, not when it is first written to.
- **One flow for the application.** After a write the binder dispatches the control's change
  event, so the listeners an application already has run as they do for a person, and no
  second path applies an agent's value. The binder ignores the events it dispatched itself;
  who made a change is known from the registry's notice and from nowhere else. This is the
  part of the direction most in need of proof: a framework that controls an input, React
  among them, may need more than a property write.
- **The first binder is this one's core.** Binding a property and its event to a view-state
  id, which is what #2275 was filed for, is the same code with the other registry. Opening a
  dialog or a panel is view state, and stays there.

### 4.6 The library's part

A foundation may not import AFD, and a component declares no actions. What the library owes is
that its components can be bound with no code written for each. Three rules, for every
component that holds state a person changes:

1. **Settable.** Assigning the state property from script changes what the person sees and
   what a form would submit.
2. **Announced.** A person's change emits one event, and its `detail` carries the new state
   under the property's name.
3. **Quiet.** A script's write emits nothing, so a listener can tell a person from a script.

- **Where a component says which property and event.** In its guide file, beside the
  statements, as data a tool can read. The manifest cannot carry it today, since it records no
  event detail.
- **How it is checked.** As codes in Specimen's story contract, which already loops over
  components and asks for evidence that a play asserted something. A play changes the control
  as a person would and by script, and a helper records what followed. A component that
  declares state and has no such evidence fails, as one with no `FormData` assertion does
  today.
- **What it would find.** The table in [section 2](#the-component-library). Each is a change
  to a component's behaviour in a preview package, which is why this is the third phase and
  not the first.
- **What the library then ships.** The declared contracts as one data file inside its package,
  so the file a binder reads is the installed version's. No AFD package is imported by the
  library, and no library is imported by `afd-view-state`.

### 4.7 Kept different on purpose

Against UI SDK's bridge, as its
[documentation for agents](https://ui-sdk.dev/docs/agents/llms.txt) describes it:

| UI SDK | Here | Why |
| --- | --- | --- |
| A component may declare its agent actions | A component declares none | The owner's decision; a capability is a command |
| `press` runs a button | No presses | Saving is a command, with its schema, approval and undo |
| Every component on the page is listed, and the application hides regions | The application binds what is listed | Private until bound, as a command is private to MCP until exposed. The owner decided this as [question 4](#10-for-the-owner) |
| A failed step leaves earlier steps applied | All or nothing | Job 3 |
| A component is named by its label or a ref | By the id it is bound under | One name, the same on every read |
| An agent can type into a secret field | A secret is refused | Job 6 |
| A change is refused only if the application cancels it | A control that changed since it was read is refused | Job 9 |
| A history restores values through the same steps | The undo is its own command and carries no values | Job 11 |

## 5. What writing the jobs changed

The first draft had four commands, and not the four it has now.

- **`control-get` was cut.** No job read one control that `control-list` with a `group` did
  not serve.
- **`afd-batch` could not carry job 3,** because a batch keeps what succeeded. `control-set`
  takes a list and applies it whole.
- **A label is accepted for a choice.** Job 4 counted a refused call and a second call for
  every choice a model named as it reads on the screen.
- **`unchanged` was added.** Job 2 could not otherwise tell "set" from "already so" without a
  second read.
- **An unknown group is refused, not answered empty,** so that an empty answer means one
  thing: nothing is bound (job 10).
- **A per-value `was` came from job 9,** and job 6 showed it could leak a secret: a wrong
  guess and a right one would have been refused differently. The walks then replaced it, twice
  ([section 6](#6-what-the-walks-changed)).

The checks, run on 2026-11-24 on the scenarios as they now stand, as
[jobs first](../../../../.claude/skills/afd/references/jobs-first.md) describes:

- `afd scenario validate`: 14 of 14 valid.
- The dry run with fixtures: no error in 14 files and 65 steps. It loads each fixture file and
  applies none: no adapter for these fixtures exists until phase A, which also defines the
  fields only a fixture has (`rejects`, `moves`, and `screen` and `command` at its root).
- Coverage: 4 of 4 drafted commands and 4 of 4 drafted error codes are used; no scenario calls
  a command that is not drafted.

## 6. What the walks changed

One fresh reader on Claude Opus 5.5 at `high` took the three seats in turn: it drafted its own
list of jobs from the owner's words before opening this document, walked the person's, the
developer's and the library author's journeys, then read the host's own files and counted
calls. It walked three times, because each rework added a job or a command.

### The first walk, of fifteen jobs and three commands

**Taken:**

- **The overwrite guard depended on the caller.** `was` was optional, so the person's
  protection held only when an agent chose to send it. A required revision replaced it, and
  job 9 moved into the first slice.
- **Undo failed whole when one control had moved.** It became a restore that puts back the
  rest and reports what it left (job 11).
- **Three jobs were missing:** handing the form back (12), an error the form shows after a
  fill (13) and a change that moves another control (14).
- **A control the person cannot see** is listed as `hidden` and refuses a write, and one whose
  element left the document is unbound.
- **A secret's error is withheld** with its value. "Required" tells whether it is empty.
- **`description`, `maxLength`, paging and an output budget** on `control-list`.
- **The binder's rules were unstated:** how a native control is named and what kind it is,
  what a missing label or a duplicate name does, that the binder ignores its own events, and
  the command factory.
- **A `recovery` for each refusal,** and what the descriptions must say for a model with no
  skill installed.
- **Jobs 3 and 17 were reworded** around what the person and the developer get.
- **The owner had accepted the package.** Section 1 said the reply named none.
- **Opening a dialog** was both out of scope and in the contract. It is view state.

**Declined:**

- **Folding job 10 into job 1 and job 4 into a rule.** Jobs first counts what a feature
  refuses and what it stays quiet about as jobs, and each keeps its scenario.
- **Refusing a write to the control that has focus.** A `rev` moves with each thing typed, and
  focus alone changes nothing.
- **A saving command for each group.** One for each bound form; a screen with several forms is
  the specification's.
- **Cutting `control-choices`** now that a label is accepted. An agent that does not know the
  label still has to find it.

### The second walk, of eighteen jobs and one revision for the screen

**Taken:**

- **One revision for the screen passed over changes the agent never saw.** A write returned a
  new revision, and that revision was later than a person's edit to another control, so the
  next write replaced the edit. A page or a group read did the same. Each control now has its
  own `rev`, and a write proves what it replaces.
- **A revision could be invented.** A `rev` is a token the registry issues, and any other is
  refused.
- **Undo was refused by the limits.** Putting back an empty choice broke "one of its choices".
  The undo became `control-restore`, which carries no values and puts back what was held.
- **A skip on an ordinary fill would apply half of it.** `control-set` no longer has one; only
  the restore skips, and for any reason a control cannot be put back.
- **"Out of sight" was undefined.** It could have meant below the fold, where no long form
  could be filled. `hidden` is defined as not rendered, and its recovery is the person's.
- **A warning for a caller that forgot it is an agent reached the model,** which cannot fix
  it. `control-set` refuses a person instead, and the person's undo is `control-restore`,
  which the palette can call.
- **`affected` had no shape,** so job 14's "so that" could not be reached. It carries the
  controls as `control-list` gives them, with their new `rev`, and job 14 became a scenario.
- **`missing`** tells an agent the form is ready without another read (job 12).
- **`format` was a hint in one place and a limit in another.** It is a limit.
- **Job 15's "or submit"** had no rule behind it and was dropped from the sentence.

**Left for the specification,** each listed in [section 9](#9-risks-and-open-points): what a
write waits for; the cost of a control bound again by a framework; how a page of controls
meets the output budget; the person's undo surface; `pattern`; a mark for "the agent may read
this and not write it" that does not tell the person the control is read-only.

**Counted, not measured:** an ordinary fill is a read and a write, two calls and two to three
thousand tokens on the twelve-control fixture by the reader's estimate; a screen of a hundred
controls would be seven to nine thousand for each read, which is why `control-list` pages.

### The third walk, of the four commands and a `rev` for each control

**Taken:**

- **A fresh `rev` could undo a person's edit.** The restore checked only that the `rev` sent
  was the control's own, so a caller that read the screen after a person typed could put back
  what was there before the fill, or carry one record's value to another. The memory is now
  tied to the write: it holds the `rev` that write returned, and any later change to the value
  drops it.
- **A change that fires no event left the `rev` where it was,** which the Quiet rule of
  [4.6](#46-the-librarys-part) and every native input make the usual case for a script's
  write. The registry compares a control with what it recorded each time a command touches
  it.
- **`missing` named a required secret that was empty,** the leak a secret's error was
  withheld for. A secret is never named there.
- **An undo of an undo was undefined,** and a double press would have swung a form between two
  states. A restore is not remembered.
- **A restore that moved a control then skipped it.** It checks every entry before it writes
  any.

It tried to pass a write over a change the caller had not seen, through pages, groups, two
agents, `affected`, a rebound control and an unchanged write, and found no way other than the
two above. It found every `rev` in the fourteen files to be the control's own at that step,
and every job's sentence the same in the table and its file.

**Left for the specification:** that a `rev` returned is read with the row it comes with, once
a write waits; the order inside one `control-set` when an entry moves another's limits;
putting back a control the fill moved and did not write; `rev` in the registry's notice, so an
application can build the person's undo; the words a skip gives as its reason; and tests for
`maxLength`, `offset` and each reason a restore skips.

No fourth walk followed: these fixes state rules and add no job and no command.

## 7. What a scenario cannot show

- **Who is calling.** Every step runs as a test actor, so one file cannot show an agent
  allowed and a person refused (jobs 15 and 17), or a change carrying its actor.
- **A person at the screen.** No step types into a control or leaves the screen. Jobs 8, 9
  and 11 use a command to stand in for the person, and each file says so in its first lines.
- **A control that changes state by itself.** A fixture cannot disable a control or bind it
  again between two steps, so the restore's other reasons to skip are the unit's tests'.
- **That an agent stops.** Job 12 shows what the agent is told, not that it leaves submitting
  to the person.
- **`undoCommand` and `undoArgs`.** `expect` does not reach them. Job 11 makes the call they
  describe.
- **`recovery` and an error's `details`.** The same limit.
- **An application's own logic.** A fixture stands in for it with one rule each in jobs 13
  and 14: a value a control rejects, and a control another one moves.
- **The binder and the library's contract.** They have no commands (jobs 16 and 18).
- **Whether it works for a model.** That needs a measure: the same form filled by a model
  through these commands, through the workaround and through UI SDK's public
  [benchmark task](https://github.com/vercel-labs/ui/tree/main/benchmarks/agent), counting
  calls, tokens and wrong fills.

## 8. Phases

Each ends on something that can be checked. The order assumes the owner ranks the jobs a
scenario can show first.

| Phase | What | Exit |
| --- | --- | --- |
| 0. Jobs | This document, the scenarios, walks by a reader who did not write them, the owner's ranking | Done 2026-11-24: the owner agreed with the ranking proposed |
| A. Commands ([#2487](https://github.com/lushly-dev/afd/issues/2487)) | The [specification](spec.md), then `ControlRegistry` and the four commands with no DOM: a control is a handler, as a view state is today. A fixture adapter for the scenarios | Every scenario passes in the package's tests; tests show `allow` granting panels and not controls, a person refused by `control-set`, a failed write put back, a restore skipping for each of its reasons, a `rev` read after an edit restoring nothing, and a second restore putting back nothing |
| B. Binding ([#2488](https://github.com/lushly-dev/afd/issues/2488)) | `bindControls` and `bindControl` for native controls, the registry's notice with its actor, and the view-state binder #2275 asked for | Browser tests: a person's change and an agent's reach the same listener; a controlled input in React follows a write; a person's typing and a script's write each give the control a new `rev`; the registry's notice carries the caller's actor; a property and its event bound to a view-state id read and write both ways; an unbound control is never listed |
| C. The contract ([#2489](https://github.com/lushly-dev/afd/issues/2489)) | The three rules as Specimen contract codes with passing and failing fixtures, the declaration in a guide file, and `violet-elements`' components brought to it | `pnpm test:stories` holds every stateful component to the rules; the library ships its contracts as one file |
| D. In an application ([#2490](https://github.com/lushly-dev/afd/issues/2490)) | Library controls bound by tag from that file, and one application where a person watches an agent fill a form and takes it back | The measure in [section 7](#7-what-a-scenario-cannot-show) is run and reported |

Phases A and B change no component and need no release of the library.

## 9. Risks and open points

- **Dispatching the change event may not be enough.** If a framework ignores it, the "one flow"
  of [4.5](#45-binding) fails and an application needs a second path, which is the workaround.
  Phase B's exit tests it before anything depends on it.
- **What a write waits for.** A panel just opened binds its controls after it renders, a
  control whose choices depend on another may load them later, and an application may check a
  value on a server. `changed`, `affected` and `missing` hold what is true when the write
  returns, and no rule yet says how long that is. Nor does one say what happens inside a
  single call when one entry moves the limits of another.
- **A control bound again has a new `rev`.** A framework that mounts a control twice, or
  unmounts a tab's panel, makes the next write to it cost a read. That is the guard working,
  and how often it happens is not known.
- **The journal records what was sent.** A journal keeps a command's input, so `control-set`
  puts a draft's values in it. A refused call is not recorded by default, so a value sent to a
  secret is not kept; a journal set to record failures (`recordFailures`,
  `packages/server/src/journal.ts:343`) would keep it. Whether the journal should skip or
  redact these commands, as two recorders skip `auth-*`, is open.
- **A write put back has already been heard.** The binder dispatches a control's change event
  after its write. If a later write in the same call throws and the earlier ones are put
  back, the application's listeners have run on them. Job 3 holds for what the screen shows,
  not for what a listener did meanwhile.
- **A restore is the agent's change.** When an agent takes back its own fill, the notice
  carries the agent as the actor, and a screen that marks what an agent changed would mark a
  control that again holds what the person left. The specification says how a notice tells a
  restore from a fill.
- **Recognising a secret by its attributes is a guess.** A field that holds one and says so
  nowhere is listed with its value. The application's own mark is the rule; the attributes are
  a floor.
- **The person's undo.** `control-restore` can be called as the person, and nothing here draws
  the button or hands an application the `rev`s it needs. No AFD package acts on `undoCommand`
  today ([section 2](#the-command-layer)). The undo goes back one write, and a control the fill
  moved without writing it is not put back.
- **The contract changes preview components.** At least eleven break one of its rules today
  ([section 2](#the-component-library)). Each change needs its own look at who listens.
- **A label is not always there to read.** Without `labels`, a custom element's label comes
  from where its contract says, and three components keep it in a slot.
- **Read, and not write.** A control bound for reading lists as `readOnly`, which is also
  what a control the person cannot edit lists as. An agent may tell the person the wrong one.
- **Repeated rows.** How the controls of a row that repeats are named is the specification's.
  Adding a row is a press, so it is a command of the application's or it is view state.
- **A form as the draft of a command's input.** A form names the command it is for, and
  nothing here ties a control to a field of that command's input. Doing so would let the
  command's schema supply the limits, `pattern` among them, and would spare an agent that is
  asked to submit from sending the values again. It is not proposed.
- **A page against the budget.** What `control-list` returns when fifty controls are more
  than its output budget is the specification's.
- **Ten choices, fifty values and fifty controls a page are starting points.**
- **Languages.** `afd-view-state` exists in TypeScript only, as
  [the parity page](../../../language-parity.md) already records. These commands run beside an
  interface in a browser, so no other language is owed them.
- **A name without a verb.** `control-choices` follows `afd-docs` and `afd-schema` in naming a
  thing. Whether it should name an action is the specification's.

## 10. For the owner

**Decided 2026-11-24.** The owner was shown the six questions, each with the recommendation
quoted below, and replied: "Agree with all six recommendations, proceed with phase A". What
follows each quotation is this document's own detail, which he was not shown.

1. **The jobs.** Cut, add and rank the eighteen. Shown: "I recommend the fourteen a scenario
   can show first, then the three that need the binder, then the library contract."
   **Decided: agreed.** None was cut or added. In this document's numbers that is 1 to 14,
   then 15 to 17, then 18.
2. **Secrets.** Whether an agent may ever fill a password, a one-time code or a card number.
   Shown: "I recommend never, so a person types their own secrets." **Decided: agreed.** That
   an application can mark more controls as secrets and cannot unmark one is
   [4.4](#44-rules)'s.
3. **Agents outside the application.** Whether an agent that reaches the application through
   MCP may read what is on a person's screen. Shown: "I recommend no, unless the app turns it
   on." **Decided: agreed.** View state has the same default.
4. **What an agent sees.** Whether an application lists the controls an agent may see, or the
   agent sees every control unless the application hides it, as UI SDK's does. Shown: "I
   recommend the app lists them, so nothing a person typed reaches an agent by default."
   **Decided: agreed.**
5. **Submitting.** Whether an agent that has filled a form may also run the command that
   saves it. Shown: "I recommend only when the person asks." **Decided: agreed.** That it
   otherwise says the form is ready, and the person reads it and submits, is
   [4.3](#43-commands)'s.
6. **The library's components.** Whether to bring `violet-elements`' components to one
   contract, which changes how at least eleven of them hold or announce their state in the
   preview package. Shown: "I recommend yes, as a later phase." **Decided: agreed.** That the
   later phase is C, after the commands and the binder have shown the path works on native
   controls, is [section 8](#8-phases)'s.

## 11. Out of scope

- Pressing buttons, moving focus and scrolling.
- Opening a menu, a dialog or a panel with these commands. That is view state.
- Actions declared by a component.
- Reading text that is not a control: headings, tables, messages.
- Choices a control fetches as a person types. `control-choices` searches the choices a
  control holds.
- Adding or removing a repeated row.
- Driving an application that has not bound its controls. Browser automation does that.
- Files. A file upload is not a value an agent supplies.
- A confirmation before a fill. A fill changes a draft and can be taken back; the command the
  person then runs carries its own approval.
- Publishing any unit.
