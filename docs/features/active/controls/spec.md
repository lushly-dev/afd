# Controls, phase A: the registry and the four commands

The specification of phase A of [Controls](controls.proposal.md): a `ControlRegistry` and the
commands `control-list`, `control-set`, `control-restore` and `control-choices` in
`@lushly-dev/afd-view-state`, with no DOM. A control is a handler an application registers, as
a view state is today. The binder that makes a handler from an element is phase B's.

## Status

- **State:** specified 2026-11-24, for [#2487](https://github.com/lushly-dev/afd/issues/2487).
  Not built.
- **Approved approach:** the proposal's sections 4.2 to 4.4. The owner approved the proposal
  on 2026-11-24, not this document. Where this document is more exact than the proposal, this
  document holds; where it changes or adds to a rule of the proposal, it says so under
  [What this settles](#9-what-this-settles).
- **Acceptance:** the fourteen files in [`scenarios/`](scenarios/), and the tests in
  [section 10](#10-tests-and-exit).

## 1. Where the code goes

| Entry | File | Exports |
| --- | --- | --- |
| `@lushly-dev/afd-view-state/controls` | `src/controls/index.ts` | `ControlRegistry` and the types of [section 2](#2-types) |
| `@lushly-dev/afd-view-state/controls/commands` | `src/controls/commands.ts` | `createControlCommands`, its options and result types |

- **Browser-safe, like `/commands`.** The commands are defined with `defineCommandWithSchema`
  from `@lushly-dev/afd-server/define` on Zod Mini. Each declares `output`, and each input and
  output JSON Schema is written out, with a test holding it equal to `zodToJsonSchema` of its
  schema.
- **The root entry and `/commands` do not change.** Nothing here imports the view-state
  registry, and nothing there imports this.
- **No new dependency,** in the package or its tests.

## 2. Types

```ts
export type ControlKind = 'text' | 'number' | 'boolean' | 'choice' | 'choices';
export type ControlValue = string | number | boolean | string[];
export type ControlFormat = 'email' | 'date' | 'time' | 'color';
export interface ControlChoice { value: string; label: string }

/** What a handler says its control is, each time it is asked. */
export interface ControlState {
  kind: ControlKind;
  label: string;
  value: ControlValue;
  group?: string;
  description?: string;
  format?: ControlFormat;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  secret?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  choices?: ControlChoice[]; // every choice; the registry decides what a listing carries
  error?: string;
}

export interface ControlHandler {
  read(): ControlState;
  write(value: ControlValue): void;
}

/** A control as `control-list` gives it: the proposal's section 4.2. */
export interface Control extends Omit<ControlState, 'value' | 'choices' | 'error'> {
  id: string;
  rev?: string;
  value?: ControlValue;
  choices?: ControlChoice[];
  choiceCount?: number;
  error?: string;
}
```

- **A flag that is false is left out** of a `Control`, as the proposal's table says.
- **A handler is synchronous.** `read` and `write` return when they are done. What a write
  waits for beyond that is not this phase's.

## 3. The registry

```ts
export interface ControlRegistryOptions {
  /** Issues the tokens revs are made of. Tests pass a counter; the default is random. */
  token?: () => string;
}

export class ControlRegistry {
  constructor(options?: ControlRegistryOptions);
  setScreen(screen: { name?: string; command?: string }): void;
  register(id: string, handler: ControlHandler): () => void; // returns its unregister
  unregister(id: string): void;
  has(id: string): boolean;
}
```

The commands reach the registry through methods of its own that this document does not name;
they are not part of the package's surface.

- **`register`** throws for an id already registered, and for an id that is empty. Ids are
  listed in the order they were registered.
- **`unregister`** of an id that is not registered does nothing. The function `register`
  returns unregisters only the handler it registered: called after the id was registered
  again, it does nothing.
- **`setScreen`** names the screen and the command its form is for, and replaces what was set
  before. One registry is one screen; an application moving to another screen sets it again.
- **A `rev`** is an opaque string. It is never issued twice by one registry, and one cannot be
  worked out from another: the default joins a counter to random bytes from
  `crypto.getRandomValues`.
- **Observing.** For each control the registry keeps its `rev` and a copy of the last state
  it read. To observe a control is to read its handler again and compare the state with the
  copy, field by field, with a false flag the same as an absent one and a list compared item
  by item. If anything differs, the control gets a new `rev`. If its `value` differs, what was
  remembered for a restore is dropped.
- **Every command observes first.** `control-list` and `control-choices` observe the controls
  they answer about. `control-set` and `control-restore` observe every registered control
  before they check anything, and again after they have written.
- **Registering again.** A control registered under an id that was unregistered has a new
  `rev` and nothing remembered.
- **A `read` that throws** fails the command with `INTERNAL_ERROR`: message `<id> could not be
  read: <the error's message>`, suggestion `Tell the person this screen could not be read`,
  `retryable: false`, recovery `{ kind: 'stop' }`. If the command had already written, what it
  wrote is written back first, as [5.3](#53-writing) does for a `write` that throws.

## 4. `control-list`

| | |
| --- | --- |
| Input | `group?: string`; `limit?: integer`, 1 to 100, default 50; `offset?: integer`, 0 or more, default 0 |
| Data | `screen?: string`, `command?: string`, `controls: Control[]`, `total: number`, `more: number` |
| Mutation | No |
| Errors | `NOT_FOUND`, `INTERNAL_ERROR` |
| Output budget | `defaultBytes: 16384`, `maxBytes: 65536` |

- **`total`** counts the controls the call selects, after `group`. **`more`** counts those
  after the last one returned. An `offset` at or past `total` returns `controls: []` and
  `more: 0`.
- **The page ends early at the budget.** A page always holds its first control. Each further
  control is added only while the result, measured as the host measures it (the UTF-8 bytes
  of the result as JSON, without `metadata`), stays within `context.outputBudget`. `more`
  then counts the rest, so a caller reads on with `offset`. Called with no budget in its
  context, as a test may, a page ends only at `limit`.
- **A secret** is listed with `secret: true` and without `value`, `error` or `rev`. A choice
  control lists `choices` when it has ten or fewer and `choiceCount` otherwise.
- **Nothing registered** is a success whatever `group` says: `controls: []`, `total: 0`,
  `more: 0`, and `reasoning: "The application has bound no controls on this screen."`
- **A `group` no control has,** when something is registered, is `NOT_FOUND`: message `No
  group "<group>" on this screen`, suggestion `Use control-list with no group to see every
  control and its group`, recovery `{ kind: 'call', command: 'control-list' }`.

## 5. `control-set`

| | |
| --- | --- |
| Input | `values`: 1 to 50 of `{ id: string, value: string \| number \| boolean \| string[], rev: string }` |
| Data | `changed: { id, value, previous, rev, error? }[]`, `unchanged: string[]`, `affected: Control[]`, `missing: string[]` |
| Mutation | Yes; `approval: 'not-required'`; `undoable: true`; `requires: ['control-list']` |
| Errors | `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_ERROR`, `INTERNAL_ERROR` |

### 5.1 Checks

Before any entry: a caller whose `context.actor.kind` is `human` is refused with `FORBIDDEN`.
An actor of any other kind, `test` among them, or none, is not.

Then every registered control is observed, and every entry is checked against what that
found, in the order sent. Nothing is written if any entry is refused. Each entry stops at its
first failing check:

| # | Check | Code | Reason, in the message | Suggestion | Recovery |
| --- | --- | --- | --- | --- | --- |
| 1 | The id is registered | `NOT_FOUND` | `is not on this screen` | `Use control-list to read the controls on this screen` | `{ kind: 'call', command: 'control-list' }` |
| 2 | It is not a secret | `FORBIDDEN` | `<label> is a secret` | `Ask the person to enter it themselves` | `{ kind: 'external' }` |
| 3 | No earlier entry of the call has its id | `VALIDATION_ERROR` | `is sent more than once` | `Send each control once` | `{ kind: 'fix-input', needs: ['values'] }` |
| 4 | It is not disabled | `CONFLICT` | `<label> is disabled` | `<label> is disabled, so the person cannot change it either` | `{ kind: 'stop' }` |
| 5 | It is not read-only | `CONFLICT` | `<label> is read-only` | `<label> is read-only, so the person cannot change it either` | `{ kind: 'stop' }` |
| 6 | It is not hidden | `CONFLICT` | `<label> is not shown` | `<label> is not shown to the person. Ask them to open that part of the screen` | `{ kind: 'external' }` |
| 7 | `rev` is the control's own | `CONFLICT` | `has changed since it was read` | `Use control-list to read it again, and keep what the person entered unless they ask otherwise` | `{ kind: 'call', command: 'control-list' }` |
| 8 | The value fits the control ([5.2](#52-values)) | `VALIDATION_ERROR` | By kind, below | By kind, below | `{ kind: 'fix-input', needs: ['values'] }`; for a choice among more than ten, `{ kind: 'call', command: 'control-choices', input: { id } }` |

- **The error is the first refused entry's.** Its message is
  `<refused> of <sent> values refused: <id>: <reason>`. Its `details.refused` lists every
  refused entry as `{ id, code, reason }`. No refusal sets `retryable`.
- **The caller-is-a-person refusal:** message `control-set is an agent's command`, suggestion
  `Create the client with actor { kind: 'agent' }; a person changes the controls themselves`,
  recovery `{ kind: 'external' }`.

### 5.2 Values

Each is checked in the order given, and stops at the first that fails.

| Kind | Takes | Refused with the reason | Suggestion |
| --- | --- | --- | --- |
| `text` | A string, no longer than `maxLength`, in the `format` when one is declared | `takes text`; `is longer than <maxLength> characters`; `is not <an email address \| a date \| a time \| a colour>` | `Send text`; `Send at most <maxLength> characters`; `Send an email address`, `Send a date as YYYY-MM-DD`, `Send a time as HH:MM`, `Send a colour as #rrggbb` |
| `number` | A finite number, at least `min` and at most `max` where each is declared | `takes a number`; `is not between <min> and <max>`, `is less than <min>`, `is more than <max>` | `Send a number`; `Send a number between <min> and <max>`, `Send a number of at least <min>`, `Send a number of at most <max>` |
| `boolean` | `true` or `false` | `takes true or false` | `Send true or false` |
| `choice` | A string that names one choice | `takes one of its choices`; `is not one of its choices`; `matches more than one choice` | `Its choices: <value> (<label>), …` for ten or fewer; otherwise `Use control-choices to search its <n> choices` |
| `choices` | A list of strings, each naming one choice, none named twice | `takes a list of its choices`; then as `choice`; `names <value> more than once` | As `choice` |

- **Naming a choice.** A string equal to a choice's `value` names it. Otherwise it names the
  choice whose `label` equals it without regard to case, when exactly one does.
- **The formats.** An email address has no white space, one `@` with text before it, and a
  dot with text on both sides after it. A date is `YYYY-MM-DD` and a day that exists. A time
  is `HH:MM` or `HH:MM:SS` on a 24-hour clock. A colour is `#` and six hexadecimal digits in
  either case.
- **`maxLength`** counts as `String.length` does.
- **Emptying.** An empty string is a text any `text` control takes, whatever its `format`. An
  empty list is a value any `choices` control takes. An empty string is taken by a `choice`
  control only when one of its choices has that value. A `number` and a `boolean` cannot be
  emptied. `required` refuses nothing: `missing` reports it.
- **A value is compared after it is resolved** to the choice it names. A `choices` value is
  compared without regard to order. A value equal to what the control holds changes nothing.

### 5.3 Writing

1. Entries whose resolved value equals the control's are `unchanged`.
2. The others are written in the order sent: `write` is given the resolved value.
3. **An entry an earlier one moved is checked again.** At each entry's turn in the order sent,
   after the first write, its control is observed, whether step 1 found it unchanged or not. If it changed since the
   checks of [5.1](#51-checks), checks 1, 2, 4, 5, 6 and 8 run again on it, and whether it is
   unchanged is decided again. A refusal is then the call's error, in the same words with
   `1 of <sent>`, and every control the call wrote is written back.
4. **If a `write` throws,** every control the call wrote is written back to what it held, in
   reverse order, and the command fails with `INTERNAL_ERROR`: message `<id> could not be
   written: <the error's message>`, suggestion `Nothing was changed. Use control-list to read
   the screen`, `retryable: false`, recovery `{ kind: 'call', command: 'control-list' }`. If
   writing one back throws too, the others are still written back, and the message ends
   `; <ids> could not be put back` and the suggestion drops its first sentence.
5. Every registered control is observed again. For each control written, anything remembered
   before is dropped, and the registry remembers the value it replaced and its new `rev`.
6. `changed` lists the controls written, in the order sent. `previous` is what the control
   held before the call, `value` what it holds after, `rev` its new `rev`, and `error` what
   it now shows, when it shows one.
7. `affected` lists every control the call did not write whose `rev` differs between the
   observation before the checks and the one after the writes, as `control-list` gives it. A
   secret is never listed.
8. `missing` lists the ids of controls that are `required`, not secrets, and hold an empty
   string or an empty list.
9. With anything in `changed`, the result carries `undoCommand: 'control-restore'` and
   `undoArgs: { controls: [{ id, rev }] }` for each control written.

## 6. `control-restore`

| | |
| --- | --- |
| Input | `controls`: 1 to 50 of `{ id: string, rev: string }` |
| Data | `restored: { id, value, rev }[]`, `skipped: { id, reason }[]`, `affected: Control[]`, `missing: string[]` |
| Mutation | Yes; `approval: 'not-required'` |
| Errors | `INTERNAL_ERROR` |

A person may call it. Every registered control is observed, then every entry is checked
before any is written. An entry is skipped for the first of these that holds, in this order:

| Reason in `skipped` | When |
| --- | --- |
| `not-on-screen` | The id is not registered |
| `secret` | The control is a secret, whatever it holds |
| `changed` | Nothing is remembered for the control, the `rev` sent is not the one remembered, or an earlier entry of the call has its id |
| `not-editable` | The control is disabled or read-only |
| `not-shown` | The control is hidden |

- **What is restored** is written back through `write`, in the order sent, with no check of
  [5.2](#52-values), since the control held it before. An entry that an earlier write of the
  call moved is still written.
- **A `write` that throws** is handled as in [5.3](#53-writing), and nothing remembered is
  dropped.
- **After the writes** every registered control is observed again. `restored` lists the
  controls written, in the order sent, each with the value it now holds and its new `rev`.
  `affected` and `missing` are as in [5.3](#53-writing).
- **What a restore forgets.** Once the writes have succeeded, nothing is remembered for the
  controls restored, and the result carries no `undoCommand`.
- **A call that restores nothing** is still a success.

## 7. `control-choices`

| | |
| --- | --- |
| Input | `id: string`; `search?: string`; `limit?: integer`, 1 to 50, default 20; `offset?: integer`, 0 or more, default 0 |
| Data | `id`, `choices: ControlChoice[]`, `total: number`, `more: number` |
| Mutation | No; `requires: ['control-list']` |
| Errors | `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR` |

- **`search`** keeps the choices whose `label` contains it, without regard to case, in the
  control's order. `total` counts them, and `more` those after the page. An `offset` at or
  past `total` returns `choices: []` and `more: 0`.
- **An id that is not registered** is `NOT_FOUND`: message `<id> is not on this screen`, with
  the suggestion and recovery of check 1 in [5.1](#51-checks).
- **A control with no choices** is `VALIDATION_ERROR`: message `<id> has no choices: it
  takes <text | a number | true or false>`.
  - For a caller that is not a person, on a control that is not a secret: suggestion `Use
    control-set to give it a value`, recovery
    `{ kind: 'call', command: 'control-set', needs: ['values'] }`.
  - Otherwise: suggestion `It has no choices to search`, recovery `{ kind: 'stop' }`.

## 8. The factory, exposure and descriptions

```ts
export interface ControlCommandsOptions {
  /** Merged over each command's default exposure. */
  expose?: ExposeOptions;
}
export function createControlCommands(
  registry: ControlRegistry,
  options?: ControlCommandsOptions
): ControlCommands; // [controlList, controlSet, controlRestore, controlChoices]
```

| Command | Default exposure |
| --- | --- |
| `control-list`, `control-set`, `control-choices` | `{ agent: true, palette: false, mcp: false, cli: false }` |
| `control-restore` | `{ agent: true, palette: true, mcp: false, cli: false }` |

All four have `category: 'control'` and `executionTime: 'instant'`. Their descriptions say
what the proposal's section 4.3 lists a model must know:

| Command | Description |
| --- | --- |
| `control-list` | List the controls on the screen the person is looking at: each one's id, label, kind, value, limits and choices, and the rev to send back when changing it. Read this before control-set. |
| `control-set` | Set the values of controls on the person's screen, all or none. Send each control's id (not its label), a value of its kind (a choice by its value or its label), and the rev control-list or an earlier result gave for it; never invent a rev. If a control changed since you read it, read it again and keep what the person entered unless they ask otherwise. A secret is the person's to type. This fills a draft and does not submit it: run the form's command only when the person asks, with what the screen then shows. An error's details list every refused value. |
| `control-restore` | Put back what controls held before a control-set changed them, skipping any the person has changed since. Send the id and rev of each control as control-set's result gave them. |
| `control-choices` | Search or page through the choices of one control that offers more than control-list carries. |

## 9. What this settles

Where this document changes or adds to the proposal, and what it leaves.

**Changed from the proposal:**

- **One screen for a registry.** The proposal drew `screen` and `command` as options of
  binding a form. Here they are the registry's, set with `setScreen`; phase B's `bindControls`
  calls it. A screen with several forms names at most one command.
- **The order inside an entry.** The proposal refuses a secret "before anything else is
  checked". Here whether the id is registered is checked first, since an id that is not has
  nothing to be a secret; a secret is still refused before everything else about it, an id
  sent twice included.
- **`affected` is what the write moved.** The proposal's words. Here that is measured: the
  controls that differ between an observation made before the checks and one made after the
  writes. A control a person changed before the call is therefore not in it, and a secret
  never is.
- **A group on an empty screen.** The proposal refuses a group the screen does not have. Here
  a screen with nothing registered answers empty whatever group is asked, so that an empty
  answer always means one thing: nothing is bound.
- **A handler cannot see a client's `allow`.** The proposal has a refusal name `control-set`
  "when the caller may call it". A handler knows the caller's actor and the control, and not
  what the client allows. So `control-choices` names `control-set` unless the caller is a
  person or the control is a secret, and the four commands name each other on the ground that
  an application grants them together. An application that grants one without the others
  gets a suggestion that names a command its caller lacks.

**Added:**

- **`INTERNAL_ERROR`** is a fifth code, for a handler whose `read` or `write` throws. The
  proposal's four are the refusals a caller can cause.
- **A person calling `control-set`** is refused only when the actor says `human`.
- **An id sent twice** is refused by `control-set` and skipped by `control-restore`.
- **The words a skip gives** are the five in [section 6](#6-control-restore), and their order.
- **A number is a number.** Text that reads as a number is refused.
- **What can be emptied,** and the four formats, are in [5.2](#52-values).
- **The order inside one call.** Every entry is checked before any write, and an entry an
  earlier one moved is checked again before its own, so a value is never written past a limit
  that an earlier entry of the same call set.
- **How a page meets the budget** is in [section 4](#4-control-list).
- **Journals.** A `rev` is issued by the registry and not by a handler, so a journal that
  replays these commands reports their results as different. Whether a journal skips them is
  still open (the proposal's section 9); this phase adds nothing to a journal.

**Not this phase's,** and still open where the proposal's section 9 says so: the registry's
notice of a change and how it tells a restore from a fill, which are phase B's with the
binder; what a write waits for beyond a handler's return; a `rev` in that notice for a
person's undo; a control the fill moved without writing it; `pattern`; a mark for "read, and
not write"; repeated rows; and whether `control-choices` should carry a verb, which this
phase leaves as it is.

## 10. Tests and exit

**What the build touches:** `src/controls/` and its tests; the `exports` of the package's
`package.json`; its README; a changeset for `@lushly-dev/afd-view-state`; this folder's
`STATUS.md`. The scenario files and fixtures move from this folder to
`packages/view-state/scenarios/controls/`, and the links to them here follow.

- **A fixture adapter, in the tests only.** The test makes a `controls` adapter for
  `@lushly-dev/afd-testing` around a holder of its own. The adapter's `apply` makes a registry
  from a fixture file into that holder, and the scenario's handler dispatches to the commands
  made from the registry the holder has. The registry has one handler for each entry of
  `controls`, and `setScreen` from `screen` and `command`. `rejects` is an `error` the control
  shows while it holds that value, and `moves` is fields another control takes while this one
  holds that value. `packages/testing` does not change.
- **Each input and output JSON Schema** equals `zodToJsonSchema` of its schema.
- **The entries** `/controls` and `/controls/commands` import no Node builtin and no MCP SDK,
  and the root entry and `/commands` are unchanged in what they load.

**Exit**, which is the proposal's phase A and what its section 6 left to this document:

- every scenario passes;
- a direct registry called with `allow` for `view-state-*` alone runs and lists no
  `control-*` command, and one called with `allow` for `control-*` alone does not run
  `view-state-set`;
- `control-set` called with `actor: { kind: 'human' }` is `FORBIDDEN`, and `control-restore`
  is not;
- every refusal's `recovery` passes `isCommandRecovery`, and `details.refused` lists each
  refused entry of a call with three;
- a `write` that throws on the second of three entries leaves all three as they were, and one
  whose write-back throws too says which could not be put back;
- a `read` that throws is `INTERNAL_ERROR` from each of the four commands;
- an entry whose limit an earlier entry of the same call moved is refused, and the earlier
  one is put back;
- a restore skips with each of its five reasons, and in their order when two hold;
- a `rev` read after the control's value changed restores nothing;
- a second restore of the same controls restores nothing, and a restore's result has no
  `undoCommand`;
- `control-set`'s result has `undoCommand` and `undoArgs` that `control-restore` takes as
  they are;
- a handler whose state changes without a command gets a new `rev` on the next read, and its
  old `rev` is refused;
- a control a person changed before a call is not in that call's `affected`, and a secret
  that changed during a call is in neither `affected` nor `missing`;
- an id sent twice is refused by `control-set` and skipped the second time by
  `control-restore`;
- `maxLength`; each of the four formats, taken and refused; a `number` with only `min` and
  with only `max`; a `choices` value with an unknown entry and with one named twice; a label
  two choices share; an empty string to a text with a format, and to a choice without an
  empty choice;
- `offset` and `limit` on `control-list` and `control-choices`, an `offset` past the end, and
  a page that ends early at a small output budget with `more` counting the rest;
- a function `register` returned does nothing after its id was registered again;
- a `rev` is never issued twice across ten thousand changes.

Not in this phase: the binder, any DOM, the registry's notice, a component's contract.
