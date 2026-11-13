# Specimens

**Preview.** Specimen works end to end on [AFD's FAST-AF stories](../fast-af/README.md#stories), which use it as their only runner. Its API can still change, and Lushly has not moved to it yet. It is published to npm as a prerelease under the `preview` tag, with its hosts, CLI, AFD bindings and FAST-AF plugin. The first preview, `2.2.0-preview.0`, was published without its built code and is deprecated; use `2.2.0-preview.1` or later.

A native component observation bench. A separate `@lushly-dev/specimen-afd` integration exposes its operations as `specimen-*` commands, through the validated definitions shared by the `@lushly-dev/specimen-cli` JSON endpoint and available to MCP hosts.

It captures actual Chromium geometry, selected computed styles, native control state, open-shadow DOM and ARIA snapshots. These observations detect changes that identical DOM markup can conceal. Each render gets a new browser context and registry; declared readiness and cleanup run before the environment is discarded. Readiness waits on each custom element's own registry, so an element defined only in a scoped registry settles too. While a modal dialog is open, the rest of the page is inert, so the ARIA snapshot is the dialog's.

It runs stories in Storybook's format, with their plays, helpers and accessibility checks, and needs [no Storybook installed](#helpers-and-types). On FAST-AF's 407 stories, three consecutive full runs against Storybook [agreed on every story](../../docs/features/active/specimens/t08-cutover.md#qualifying-pairs). On a first measurement it uses more CPU than Storybook over a full suite, about 1.6 to 1.8 times per story, and about a quarter of the memory in its largest process. The [Specimens proposal](../../docs/features/proposed/specimens/specimens.proposal.md) is the design, and [its status](../../docs/features/active/specimens/STATUS.md) lists what is still open.

## Install

```sh
npm install @lushly-dev/specimen@preview
npx playwright@<version> install --only-shell chromium
```

npm installs the prebuilt native host for your system with it: Linux on glibc (x64 and arm64) or macOS (arm64 and x64). Specimen renders in Chromium's headless shell, so install the one its Playwright names. The first render that cannot find it says which version to install. Add `@lushly-dev/specimen-cli@preview` for the `specimen` command, `@lushly-dev/specimen-afd@preview` for AFD commands, and `@lushly-dev/specimen-fast-af@preview` with `@lushly-dev/fast-element@preview` for FAST-AF components.

## Run the fixtures

From the repository root, using the Node version in `.nvmrc`:

```sh
pnpm install --frozen-lockfile
pnpm -F @lushly-dev/specimen-cli... build
pnpm -F @lushly-dev/specimen exec playwright install chromium
pnpm -F @lushly-dev/specimen build:host
node endpoints/specimen-cli/dist/bin.js --root foundations/specimen/fixtures list
node endpoints/specimen-cli/dist/bin.js --root foundations/specimen/fixtures render baseline --output /tmp/specimen-left.json
node endpoints/specimen-cli/dist/bin.js --root foundations/specimen/fixtures render padded --output /tmp/specimen-right.json --screenshot /tmp/specimen-right.png
node endpoints/specimen-cli/dist/bin.js diff /tmp/specimen-left.json /tmp/specimen-right.json
```

Every command emits one `CommandResult` JSON value on stdout. Errors use stderr for diagnostics and a nonzero exit code. Capture files may contain raw observations or successful command-result envelopes. Output paths are resolved relative to `--root`; absolute paths work as shown. `diff` does not need a project or browser.

Use `--viewport 375x812`, `--container 320x600`, `--theme dark`, `--locale fr-FR`, `--reduced-motion reduce`, `--motion settled` or `--checkpoint hovered` with `render`. Viewport changes the browsing context; container constrains the mount element inside it. `--theme` is `light`, `dark` or `high-contrast`: the bench renders high contrast in the light color scheme with `prefers-contrast: more`, so a page that resolves its theme from media queries selects high contrast itself, and the document's `data-specimen-theme` attribute is `high-contrast`. Forced colors is not a theme; Specimen does not emulate it. The `interactive` fixture exposes `hovered` and `focused` checkpoints. By default rendering stops at `mount`; `after-run` executes all supported scenario steps. The feasibility runner supports named click, focus, hover, fill and capture steps. Actions use real browser input after Playwright's actionability checks: a click or hover waits until its target is visible, enabled, stable for one frame and the element that receives the pointer, and fill follows Playwright's fill. Selector targets match across open shadow roots as Playwright's CSS engine does; role targets use Chromium's accessibility tree.

Each action includes one animation-frame boundary before the next action or checkpoint, covering already queued frame callbacks and their microtasks. Later asynchronous work and animation completion require a future explicit readiness contract. Automated renders load a prebuilt bundle, so no dependency discovery or reload can replace a document during capture; the interactive Vite bench keeps hot reload.

## Register a component

The feasibility manifest is explicit metadata, so listing and loading one specimen never executes unrelated modules. Paths are relative to the configuration file and must resolve inside the project root. Automatic CSF discovery is a separate compatibility workstream.

```json
{
  "specimens": [
    {
      "id": "button-primary",
      "title": "Components/Button",
      "module": "./button.stories.ts",
      "exportName": "Primary",
      "component": "my-button"
    }
  ]
}
```

Save this as `specimen.config.json`. A module can export meta defaults and a specimen object with args, a custom renderer, targets and scenario steps. Custom renderers return an `HTMLElement` or `{ element, ready, dispose }`. An element-returning renderer can instead declare specimen-level `ready` and `dispose` hooks. Hook promises are bounded by the render deadline. Duplicate hook declarations fail instead of silently selecting one.

The fallback component renderer assigns args as properties. Schema validation, slots, imperative Storybook plays and command/expectation scenario steps are not implemented in this milestone. Use custom renderers for the supported native fixtures; unsupported format features must not be assumed to execute.

## Discover retained stories

In CSF compatibility mode a configuration names the consumer's existing Storybook story files, beside or instead of native specimens. `preview` is the project annotations module:

```json
{
  "stories": ["src/**/*.stories.ts"],
  "preview": "specimens/preview.ts"
}
```

Any path relative to the configuration works. A project moving from Storybook can point at its existing `.storybook/preview.ts`; a new one needs no `.storybook` directory.

Each `stories` entry is a glob, directory, file or `{ "directory", "files", "titlePrefix" }`, read as Storybook's `stories` entries are, relative to the configuration file. Extended globs such as `@(a|b)` are rejected; use braces.

The native host reads the files statically, without running them, and lists each story with the id, title, name and tags Storybook's index gives it. A story's entry also says whether it has a play, which annotations it sets, and which values only running it can settle.

Discovery that fails makes `list()`, `render()` and `build()` throw. It fails on an unreadable file, a dynamic title, duplicate ids or an incomplete export order. `validate()`, `specimen-validate` and `specimen validate [--id ID | --file PATH]` report each problem with a suggestion. They also report annotations compatibility mode does not run, such as `loaders` or `beforeEach`, and values that are deferred to runtime.

`render()` captures a retained story, and `run()` (`specimen-run`, `specimen run ID`) runs it as Storybook's Vitest addon does:
1. Compose the project, meta and story annotations with Storybook's field-specific rules.
2. Settle the story's viewport from `globals.viewport` and its theme from the project's theme global. Media keep the browser's defaults: the manifest records `themeMedia: 'browser-default'`.
3. Render through the decorators into a plain `div` canvas.
4. Run the play.
5. Run the accessibility check with axe-core 4.14.0 over the body, under the story's `parameters.a11y` policy.

A run reports `passed`, `failed` (by `render`, `play` or `a11y`), `skipped` or `excluded`. `test: { include, exclude, skip }` in the configuration selects stories as the addon's `tags` option does. A story that relies on something the runtime does not reproduce fails rather than running without it. See the [T05 record](../../docs/features/active/specimens/t05-compatibility.md).

A story runs in one chain, as under Storybook's runner: render, then play, then the accessibility check, with no frame between them, so a component that renders on its next frame is seen as Storybook's run sees it. A custom element a story leaves undefined does not hold it up; the capture records it.

That timing can miss what a component draws on its next frame, such as a FAST component applying its args: Storybook's check runs before then. `test: { settledAccessibility: true }` adds a second check once the story has settled, with its elements defined, its fonts loaded and two frames drawn, under the same policy. The run reports it as `settled`, beside `a11y`, and a violation there fails the story as `settled-a11y`. With it on, `specimen-a11y` and a capture's `channels.a11y.axe` report the settled check. It is off by default, so runs agree with Storybook's. AFD's own FAST-AF stories turn it on.

An uncaught error or unhandled rejection from when the story's module loads until its last check fails the story as `error`, naming the message, where Storybook's Vitest addon fails the run. The same two cases are left out as under Vitest: an event with no error value, such as a ResizeObserver notice, and any event of a kind the page listens for itself, which is how a story says it expects one. One raised after the last check is not recorded, because the story's page closes then.

Two things consumers' stories rely on are available:

- `staticDirs` serves directories at the page's origin, as Storybook's option does: `"staticDirs": ["./public", { "from": "./site", "to": "/site" }]`. Paths are relative to the configuration and inside the root.
- `userEvent.keyboard` from `vitest/browser` drives the real keyboard, with testing-library's key syntax. A retained play gets this one method; any other on `userEvent` throws. On a page without the host, such as a static preview, `userEvent` is undefined.

### Suites

`runSuite()` (`specimen-run` without an `id`, `specimen run` without an `ID`) runs many stories against one snapshot of the sources:

```ts
const suite = await bench.runSuite({
  filter: { tags: ['smoke'], file: 'src/button.stories.ts', match: 'disabled', ids: ['a--b'] },
  workers: 2,
  retry: true,
  flakeCap: 2,
  capture: 'failed',
});
```

- `filter` selects stories, and every condition given must hold. No filter selects them all.
- `workers` limits how many run at once. It defaults to `test.workers` in the configuration, then 2.
- `retry` retries failures once, one at a time, if no more than `flakeCap` stories failed (default 2). A failure that passes its retry is `flaky`. The suite's `outcome` is then `passed-with-flake` if every retried story passed, or `failed-after-retry` if any failed again.
- `timeoutMs` is each story's deadline. It defaults to `test.timeoutMs` in the configuration, then 15,000 ms, Vitest's browser default.
- `capture` chooses which stories keep an observation: `failed` (the default), `all` or `none`. A capture costs more than some stories' runs.

Each story reports its `attempts` and a `flakeId` in the form `storybook:<file>::<name>`, the key a consumer's flake records already use. `sourcesChanged` is true if a bundled source changed during the run, in which case the stories ran against the sources as they were when it started.

## Declare events

A native specimen's `events` names the events a capture should record, and an `expect` step checks one was seen:

```ts
export const Primary: SpecimenDefinition = {
  render,
  targets: { control: { role: 'button', name: 'Save' } },
  events: [{ type: 'click', target: 'control' }],
  scenario: [
    { id: 'activate', action: { click: 'control' } },
    { id: 'clicked', expect: { event: 'click', since: 'activate' } },
    { capture: 'after-click' },
  ],
};
```

`channels.events` lists each event in order: its type, target, the named step whose interval it fell in, whether it was composed, bubbling and trusted, and a `CustomEvent`'s `detail`. An `expect` must name the step that begins its interval, so an earlier event cannot satisfy it, and an expectation the specimen does not declare fails before running. It waits up to `timeoutMs` (default 1,000 ms) within the render's deadline.

Only declared types are observed. The mount root's listener is installed before insertion and sees what is composed or in its light tree. A target, and its open shadow root, get their own listeners once the target exists, so a non-composed event inside it is seen. Until a target exists, an event of that type is kept with `target: null`, since it cannot be ruled out. A target that never resolved makes the channel `partial`. With no `events`, the channel is `not-requested`. Retained stories declare none.

`diffObservations` treats a change in the events' types, targets and intervals as a difference when both captures recorded them.

## Compare contexts

`matrix()` (`specimen-matrix`, `specimen matrix ID`) captures one entry once per combination of explicit axes, each in its own browser context, at most 64 cells:

```ts
const run = await bench.matrix({
  id: 'button',
  axes: { theme: ['light', 'dark'], viewport: [{ width: 375, height: 812 }, { width: 1280, height: 720 }] },
});
```

Each cell after the first captured one reports a `diff` against it: its status, the channels that changed, and any limitations. A cell that could not be captured stays in the report as `unavailable` with its reason, and is not an error. `observations: true` keeps each capture. The default checkpoint is a native scenario's end, or a retained story's `mount`.

## Declare and check themes

An entry follows the theme unless it says otherwise. A story that is meant for some themes only, such as a sign-in page that stays light to match a marketing site, declares it with a tag on the story or its meta:

```ts
export default { title: 'Auth/Sign in', tags: ['light-only'] };
```

`light-only`, `dark-only` and `high-contrast-only` each add their theme, so `light-only` with `high-contrast-only` supports both. A story that pins its own theme, as a Light and Dark pair set through args does, declares it the same way: `light-only` on one, `dark-only` on the other. A native specimen declares it in the configuration, with an optional one-line reason:

```json
{ "id": "sign-in", "title": "Auth/Sign in", "module": "./sign-in.specimens.ts", "exportName": "Page",
  "themes": { "supported": ["light"], "reason": "Matches the marketing site." } }
```

Discovery puts the declaration on the entry as `themes` (`{ supported, basis: 'declared', reason? }`), which `list()` returns and the review page shows.

`themes()` (`specimen-themes`, `specimen themes [ID]`) renders one entry by `id`, or those a `filter` selects, in each theme and compares the screenshots pixel by pixel. It is not part of `run`; ask for it when you want the audit:

```sh
specimen themes --match auth --theme light,dark --threshold 0.02
```

The defaults are all three themes, the `mount` checkpoint, reduced motion and a threshold of 0.02: two frames count as the same when at most 2% of their pixels differ. That figure is from an audit of 916 stories, where the pages meant to stay light changed 0% and stories that follow the theme changed 10% or more. Each report has a `status`:

| Status | Meaning |
| --- | --- |
| `follows` | The frame changes with the theme |
| `declared` | It declares its themes, and its frame under a theme it does not support looks as it does under one it does; or it declares every compared theme and its frame stays the same |
| `pinned` | The frame stays the same because the story sets its own theme global |
| `undeclared` | The frame stays the same and nothing declares it |
| `contradicted` | It declares a limit, but its frame changes under a theme it does not support |
| `unavailable` | A theme did not render; `reason` says why |

Each report also lists, per theme, the theme it rendered in and the share of pixels that differ from the first theme's frame. `valid` is false, and the CLI exits 1, when any entry is `undeclared`, so a consumer can gate on it.

## Check accessibility

`a11y()` (`specimen-a11y`, `specimen a11y [ID]`) runs axe at a checkpoint, on one entry by `id` or those a `filter` selects. The default checkpoint, `after-run`, is a native scenario's end or a retained story's play. Each report lists:

- `violations`, with axe's explanation per target;
- `incompleteChecks`, what axe could not decide and a person must, such as contrast over an image;
- `exceptions`, each with its reason and what it excused;
- `failures`, what stopped the run before the check, such as a story's play.

A retained story keeps its effective `parameters.a11y` policy. A native specimen's check covers its mount root, and its `a11y` field declares any exclusion:

```ts
export const Legacy: SpecimenDefinition = {
  render,
  a11y: {
    exceptions: [{ rule: 'image-alt', target: '[data-legacy]', reason: 'Replaced in the next release.' }],
  },
};
export const BrokenState: SpecimenDefinition = {
  render,
  a11y: { disabled: { reason: 'A fixture of the broken state itself.' } },
};
```

An exception excuses only its rule, only on its target and what is inside it, through shadow roots. An exclusion without a reason, or an exception without a target, fails the specimen. An exception that excused nothing reports `matched: []`, so a stale one is visible. There are no schema checks yet: the proposal asks for what is available, and no schema source declares any.

A run's capture records its check in `channels.a11y.axe`, and `diffObservations` treats a change in what axe found as a difference.

## Report coverage

`coverage()` (`specimen-coverage`, `specimen coverage [TAG]`) runs the cases a filter selects and reports what they show of each component's required partitions. A schema says which states a component can have, not that anything exercised them, so a level is earned only from what a run observed.

```ts
const run = await bench.coverage({ component: 'violet-button' });
// { obligations: 'schema-partitions@1', complete: false, components: [...], counts, cases, ... }
```

Required of each component the manifest describes: its default state, each value of a finite property or attribute, each slot empty and filled, each event and command, and, when an element is seen to be form-associated, form participation and validity. A member with no finite values is listed as `openEnded`, and nothing is required of it.

| Level | Meaning |
| --- | --- |
| `verified` | A claim's expectations ran and held, about this target, in this state |
| `asserted` | In that state, and a claim's expectations held, but they were not about this |
| `represented` | A case that passed shows an element with this tag in that state |
| `missing` | No case shows it |
| `unknown` | The capture could not tell: nothing could read the member, or no case declares the event |

Only `verified` counts toward `complete`, so a run of plain captures is never complete.

A native specimen says what its expectations prove with `coverage`:

```ts
export const Disabled = {
  render: () => field({ disabled: true }),
  targets: { control: { selector: 'x-field' } },
  events: [{ type: 'click', target: 'control' }],
  scenario: [
    { id: 'focused', action: { focus: 'control' } },
    { id: 'inert', expect: { event: 'click', target: 'control', since: 'focused', absent: true } },
    { id: 'marked', expect: { target: 'control', state: { attribute: 'disabled', equals: '' } } },
    { capture: 'disabled' },
  ],
  coverage: [
    {
      target: 'control',
      obligation: 'property:disabled=true',
      checkpoint: 'disabled',
      expectations: ['marked', 'inert'],
    },
  ],
};
```

An `expect` step can hold an event (`absent: true` for one that must not happen), a property or attribute (`state`), an entry in the real `FormData` of the target's form (`form`) or the target's `checkValidity()` (`validity`). A claim is checked against the run:

- An obligation about an event needs an expectation that saw it, a command needs the scenario to have run it, and `form:participation` and `form:validity` need `form` and `validity` expectations.
- A claim whose expectations were about something else stays `asserted`.
- A claim that cannot be true is listed in `invalidClaims` and credits nothing: its target was not in that state, its expectations did not run, or the component has no such obligation. Any of these keeps a run from being complete.

A retained story's play links an assertion with `claim`, after the assertion, so a failure never reaches it. It does nothing under Storybook. A play that says nothing keeps its test result, and what it proves stays unknown.

```ts
import { claim } from '@lushly-dev/specimen/evidence';

await expect(button).toHaveAttribute('disabled');
claim(button, 'property:disabled=true', 'disabled-attribute');
```

A project with guide files (see [Component packs](#component-packs)) gets a second obligation set, `guides@1`, under `guides` in the report: each statement is an obligation, `guide:<id>`, `verified` when a claim's check ran and held in a case that passed, and `authored` otherwise. It has its own `counts`, `invalidClaims` and `complete`, and nothing in it changes `schema-partitions@1`'s results. A native specimen's claim names its `expect` steps as for any obligation; a capture taken only for a guide claim's checkpoint is evidence for `guides@1` alone. A play's `guide:` claim must carry its check, which `claim()` runs: it records the claim only when the check holds, and rethrows when it does not (by throwing, as `expect()` does, or by returning `false`), so the story fails. Outside Specimen it still runs the check. A `guide:` claim with no check, an unknown id, or a component the statement is not about is an invalid claim in `guides@1` only.

```ts
await claim(combobox, 'guide:combobox.label-required', 'named-by-label', () =>
  expect(input).toHaveAccessibleName('Supplier'));
```

The configuration can waive an obligation, with a version and a reason. A waiver excuses an obligation from `complete` without raising its level, and the report lists the version and any entry that matched nothing. None is applied automatically.

```json
{ "coverage": { "waivers": { "version": "2026-11-02", "entries": [
  { "component": "violet-button", "obligation": "property:type=reset", "reason": "Not a form button." }
] } } }
```

- **Evidence is observed.** Each obligation names the first few cases showing it, with their checkpoint and the element's reference. Slots are read from the slots themselves, and properties live from the element, so a story's args prove nothing on their own.
- **Any element with the tag counts,** including one inside another component.
- **A failed case proves nothing.** `cases.failed` names each with its message, and `specimen coverage` exits non-zero when there is one. Unverified coverage alone does not fail the command.

## Propose specimens

`suggest()` (`specimen-suggest`, `specimen suggest TAG`) proposes native specimens and claims for a component's gaps: those named by `gaps`, or what a coverage run leaves unverified. Everything it returns is `unverified`: run it and correct it, and only that run counts.

```sh
specimen suggest violet-button --out src/button/violet-button.specimens.ts
```

`entries` are the configuration entries to add, and `--out` never writes over an existing file.

- **What the schema decides is written to hold or fail on its merits,** such as an attribute's value in the state being claimed.
- **What only a person knows fails until replaced.** A form's submitted value and what a command changes are written as `REPLACE_WITH_WHAT_THIS_SHOULD_BE`, marked `placeholder`, so a proposal cannot pass unread.
- **Assumptions are noted,** such as that a click causes an event, in a comment on the specimen and in `note`.
- **What it cannot propose is listed in `skipped`,** with the reason.

## Check the story contract

`contract()` (`specimen-contract`, `specimen contract [TAG]`) reports what FAST-AF's Fastbot story contract would, on evidence from a run instead of source text. Each code is the rule it replaces, so the two can run side by side. It needs a custom elements manifest, and exits non-zero when `valid` is false: an error, or a case that failed.

```ts
const run = await bench.contract({ component: 'violet-button' });
// { rules: 'fastbot-parity@1', valid: true, findings: [], counts, stats, cases, ... }
```

| Code | Evidence |
| --- | --- |
| `MISSING_STORY`, `MISSING_STORY_EXPORT` | A story file beside the module the manifest names, with a story discovery finds |
| `MISSING_GLOBAL_A11Y_ERROR_POLICY` | The preview's own `a11y.test` is `error` |
| `MISSING_AUTODOCS_TAG` | A story's index tags |
| `MISSING_PLAY_FUNCTION` | A play ran |
| `MISSING_DOCS_DESCRIPTION` (warning) | The composed `parameters.docs.description` |
| `MISSING_BASELINE_STORY` | A story exported as `Overview` or `Default` |
| `MISSING_STATE_STORY` | The element seen as `disabled`, `invalid`, `readonly`, `checked`, `selected` or `busy`, by attribute, live property or `data-` attribute, or that attribute set during a play |
| `MISSING_FORMDATA_ASSERTION`, `MISSING_VALIDITY_ASSERTION` | For a form-associated element: a play ran `new FormData(form)` with it in the form, and something checked its validity |
| `UNDOCUMENTED_A11Y_EXCEPTION` | A story turning axe off has `parameters.a11yException`, or an `A11Y_EXCEPTION:` comment in its file |

This is parity, and coverage asks more. A story named `Disabled` that never disables anything fails here, where a check of its name would pass.

## Profile

`profile()` (`specimen-profile`, `specimen profile [ID]`) measures entries at a checkpoint over a few fresh runs, one at a time, since a neighbour's work would be in every number. The default checkpoint is `mount`, the ready checkpoint, and the default is 3 runs. Each report has:

- `samples` and a `summary` of min, median and max: first contentful paint, DOMContentLoaded, load, ready and capture time, elements, custom elements, shadow hosts, requests, transfer size and heap, with console counts totalled;
- `flags` for a slow paint, a large DOM, many shadow hosts or console messages;
- `provenance`: when, with what source, and which browser.

`profile.baselines` in the configuration names a baselines file, in the shape FAST-AF's `story-performance-baselines.jsonc` already has. `recordBaseline()` (`specimen-baseline`, `specimen baseline ID`) writes it, defaulting to 5 runs, keeping budgets a person set. A failed run records nothing. With no id or filter, `profile()` checks everything that has a baseline, and `orphanedBaselines` lists any that name no current entry.

A comparison's `status` is one of:

- `passed`, or `warnings` past a metric's tolerance: first paint and heap 1.2 times the baseline, elements and transfer 1.15, requests 1.1;
- `failed` past an absolute budget, or with more console errors than allowed;
- `not-comparable` with a `reason`, when the baseline came from another page, viewport, checkpoint or browser. A baseline from Storybook's page never reads as a regression or a pass. A budget still applies, since it is absolute.

Chromium only.

## Migrate retained stories

`migrate()` (`specimen-migrate`, `specimen migrate`) is the preview-first codemod. For each configured story file, it reports:
- whether the meta names its component;
- the component it can name: only when the file imports the module the manifest says defines that tag, and the file is named for it;
- the metadata it keeps, which is all of it;
- each Storybook import, and what would replace it;
- the manual tasks left;
- the change as a diff.

It writes only with `apply: true`, and only to files unchanged since they were read.

With `helpers: true` (`--helpers`) it instead switches helper and type imports to [Specimen's own](#helpers-and-types), one import at a time, and only where Specimen has every name that import uses. Anything else stays, as a manual task. It names no components then, since that gives a story new args and is a separate step. A preview's `setCustomElementsManifest` and `Preview` are not story files, so those two lines are yours to change.

## Helpers and types

A retained story needs no Storybook to run. `@lushly-dev/specimen/test` has the helpers a play uses, and `@lushly-dev/specimen/types` has the types the story is written against:

```ts
import { expect, fn, spyOn, userEvent, waitFor, within } from '@lushly-dev/specimen/test';
import type { Meta, StoryObj } from '@lushly-dev/specimen/types';
```

The helpers are the libraries `storybook/test` bundles, at the versions it bundles, with its `expect` assembled the same way, jest-dom's matchers included. A story using them still runs in Storybook during an overlap, without the interactions panel's step list. A build counts them as interaction support, with everything they bring, so switch a project's stories together: one carrying both Storybook's helpers and these is over the interaction ceiling.

`@lushly-dev/specimen/preview` has `setCustomElementsManifest`, for a preview. `Preview` is in `./types`.

## Plugins and inspection

`"plugins": ["./specimen.plugins.ts"]` names page modules whose default export is a plugin, or an array of them. Declare one with `definePlugin`; each plugin may implement any of four points:

- **Schema source:** `schema(tag, schema)` enriches what core reads from `"manifest"`, a custom elements manifest. Knowledge no source has stays in the schema's `unknown` list.
- **Context provider:** `themes` names presets a native specimen's `theme` context applies.
- **Token map:** `tokens` holds public variable names to token ids, and private aliases to public variables. `composeTokenMaps` composes and validates them together: versions, owners, conflicting ids, unresolved aliases and cycles.
- **Command runner:** `runners` handles explicit `command` scenario steps by runner id.

Plugins install before any specimen or story module loads. A plugin, runner or theme registered twice is an error, and a step naming a missing runner fails before it runs.

A fifth point, the **guide source**, runs in Node, not in the page: `"guideSources": ["./specimen.guides.mjs"]` names modules whose default export is a guide source, or an array of them, declared with `defineGuideSource`. Its `rules(context)` returns shared rules, `{ id, text, appliesTo }` as a guide file states them, from data the library already keeps; `context.read(path)` reads a file relative to the configuration and refuses one outside the root, and `context.schemas` is what the manifest says. Its rules join the guide files' before any check, so `specimen-validate` reports their problems against the module, `guides@1` counts them, a pack's rules file holds them, and `specimen-pack-export` rebuilds them with no browser. It runs in Node because a rule is text, not something a render shows: in the page, export could not recheck it and a static check would need a browser. `guideSources` needs `manifest`.

`inspect()` (`specimen-inspect`, `specimen inspect ID`) resolves an entry without capturing it. It reports the args, the context, a retained story's composed annotations, the plugins installed, and the component's schema from the manifest and the plugins. A component no source describes is reported as a limitation.

`@lushly-dev/specimen-fast-af` is FAST-AF's plugin, and its `/guides` entry FAST-AF's guide source, which states an attribute taxonomy's definitions as shared rules.

## Build a review page

```sh
node endpoints/specimen-cli/dist/bin.js --root foundations/specimen/fixtures build /tmp/specimen-static
python3 -m http.server 4173 --directory /tmp/specimen-static
```

The output directory must be empty. Open `/index.html` for the index, or `/specimen.html?id=baseline&viewport=375x812&theme=dark` for a preview.

The index groups specimens by component, a story's title or a native specimen's title without its last segment, under a heading for each shared prefix such as `Components`. A story with a play is tagged `play`, and one that declares its themes is tagged with them, such as `light only`, with its reason as the tag's title. The filter matches every word against a specimen's name, group, id and tags, and keeps its text in `q`, so a reloaded or shared link opens filtered. Every count follows the filter. A preview names the specimen, its id and its group, each segment of the group a link to the index filtered to it, and shows the frame on a stage captioned with its size and theme. When the selected theme is one the specimen does not support, the preview says so above the frame, with the declared reason, so a light frame under Dark reads as intended. The viewport is a device preset (Phone, Large phone, Tablet, Laptop, Desktop or Wide) or a custom width and height, A theme or a preset applies as soon as you pick it; a custom size applies when you press Apply. Drag the frame's corner to resize it: the story sees its window resize, as on a device, and the caption, the viewport controls and the URL's `viewport` follow, so a reload or a shared link opens at that size.

The pages have one small stylesheet of their own, linked only on the index and the preview. A story's frame and an automated render never load it, so it cannot change an observation. Restyle the pages by setting its custom properties, such as `--specimen-surface`, `--specimen-text` and `--specimen-accent`. Its colors use `light-dark()`, and follow the theme the page selects. The page also reads `container` (`WIDTH` or `WIDTHxHEIGHT`), `locale`, `reducedMotion` and `motion`. A selected viewport uses a sized iframe so width media queries, viewport units and `innerWidth` reflect its actual dimensions. Each case loads through a separate dynamic import. The shell budget is **52,000 minified UTF-8 JavaScript bytes**, counting its emitted/static dependencies; the proposal's 50,000 left no room once the shell's own code reached 49,800 bytes. `specimen-build.json` reports each JavaScript chunk as shell or consumer code. Interaction-library and axe budgets from the proposal are still untested because those integrations are not included yet.

Each bench page, this one included, starts `Math.random` from a fixed seed, so a framework's random marker comes out the same each time and a link reopens to the same DOM. A capture's manifest records this in `checkpoint.baseline`. The clock stays real, so a story showing today's date will still differ tomorrow.

A link can also carry `checkpoint`: `after-run` runs a retained story's play in the preview, for up to 15 seconds. Any other named checkpoint needs the host's real input, so the page shows the mount and names the `specimen render` command that reaches it. The preview's frame sets `data-specimen-preview="ready"` on its root element when it is done, and shows any error in `#specimen-page-error`.

`specimen-build.json` describes the build without running it:

- `entries`: each case's identity and `url`.
- `styles`: the pages' stylesheet, in minified bytes against its own ceiling of **8,000 bytes**. A build over it fails, as does one that does not emit it. A story's own CSS is not counted here.
- `categories` and `total`: the shell, interaction support and accessibility in minified bytes against their ceilings. A build over a ceiling fails. Capture code counts as shell, and a play's helpers, such as `storybook/test`, count as interaction support however a story imports them.
- `reported`: what has no ceiling, namely the `catalog` of cases, the `incumbent` (what else a preview imports from Storybook) and `consumer` code.
- `chunks`: every emitted chunk with its category and size.

## Component packs

A component pack describes a library's components for an agent: attributes, slots, events, roles, guidance and shared rules, each fact labelled with where it came from. `@lushly-dev/specimen/pack` has the format's version 1: its schemas, `checkPack` and the catalog writer, and `@lushly-dev/specimen/pack/<kind>.schema.json` has a JSON Schema for each file kind. Version 1 is fixed: any change to it is a new version, and version 0, the trial form, is no longer read. [The format](docs/pack-format.md) describes it, and `fixtures/pack/` holds an example library and one invalid case per problem `checkPack` reports.

Guidance a library's authors write lives in guide files, found through the `guides` key: `"guides": ["src/**/*.guide.json"]`, which needs `manifest`. A file holds one component's `summary`, `status`, `usage`, `a11y`, `roles` (its roles in states a capture does not show, such as an open popup's) and `detail`, or, with a top-level `rules`, rules stated once with what each applies to. Each statement has a stable `id`, and may list in `members` the attributes, properties, slots, events, CSS properties or commands it names. `@lushly-dev/specimen/guide/<kind>.schema.json` has a JSON Schema for each kind (`component`, `rules`). `specimen-validate` checks them with no browser: the shape, the 160- and 240-character limits, tags and members the manifest does not have, and duplicate tags and ids. Where a plugin could add a member the manifest lacks, an unknown member is reported as `deferred`, not as an error. `specimen-coverage` reports each statement's level in `guides@1` (see [Report coverage](#report-coverage)).

A `pack` key names the library a project builds a pack for, which needs `manifest`:

```json
"pack": {
  "library": "example",
  "title": "Example components",
  "prefix": "example-",
  "directory": "./pack",
  "package": "./package.json",
  "import": "example-components/{module}"
}
```

Every component whose tag starts with `prefix` gets a record. `directory` is the committed form's root, `package` the manifest whose name and version export stamps, and `import` the specifier that registers a component (`{module}` is the module the manifest names, `{tag}` the tag and `{name}` the tag without the prefix); `examples` caps how many a record keeps (3 by default).

- `bench.pack()` runs every case twice, retrying a failed case once, and writes the committed form: one record per component and the library's rules. A case whose observations differ between the passes contributes nothing and is listed as `unstable`; a run with a failed case writes nothing unless `allowFailed` names it. An example is the markup a case about the component mounted, mounted again on its own and kept only when it shows the same; each one left out is listed with its reason. The report lists each component's gaps, and anything the build left out of a record, such as a manifest description over its limit.
- `component` rebuilds one record. Its cases come from an index each full build writes (a cache in `node_modules/.cache/specimen/`, not committed): the cases that rendered each tag, every case that failed listed under every tag. The index is used only when the bench's bundle and the configuration are unchanged since it was written; otherwise every case runs, and the report's `selection` says why. Only that record is written or compared. A full build in CI stays the authority.
- `bench.packCheck()` builds the same way, writes nothing, and names the committed files that differ (`changed`, `added`, `removed`); `valid` is true only when none does and no case failed.
- `bench.packExport({ directory, revision? })` writes the exported form from the committed records, with no browser: the records, the rules and the catalog, stamped with the package. It first rebuilds what files alone say, the facts the manifest declares and the statements in the guide files, and refuses, naming the record, when one differs from what was committed. Other libraries already in `directory` stay as they are, and so does a deployment's `pack.toml`: export writes beside the target and swaps the directories.

`specimen-pack`, `specimen-pack-check` and `specimen-pack-export` in `@lushly-dev/specimen-afd`, and `specimen pack [TAG]`, `pack-check [TAG]` and `pack-export DIR` in the CLI, call these. How each fact's basis is decided is in [the format](docs/pack-format.md#how-specimen-builds-a-pack). `fixtures/pack-library/` is the example library the format's fixture pack is built from.

## Use programmatically

```ts
import { createSpecimenBench, diffObservations } from '@lushly-dev/specimen';

const bench = await createSpecimenBench({ root: './components' });
try {
  const before = await bench.render({ id: 'baseline' });
  const after = await bench.render({ id: 'changed' });
  const comparison = diffObservations(before, after);
} finally {
  await bench.close();
}
```

`createSpecimenCommands(bench)` from the separately installed `@lushly-dev/specimen-afd` integration returns MCP-exposed AFD definitions suitable for `createMcpServer({ commands })`. CLI and programmatic command execution validate the same inputs and outputs. The native host process and its browser remain owned by the bench and must be closed by its caller.

Creating or listing a bench loads configuration without starting a browser. The first render starts the [native host](#native-host), which renders outside the caller's process: the caller loads neither Vite, Playwright nor an HTML parser to render, and closing the bench ends the host and its browser. `build()` loads Vite. Operations accepted by one bench run serially; `close()` rejects new work, drains accepted work and releases its backend references. Always await it.

`runtimeIsolation: 'process'` also moves the bench's remaining Node-side work (validation, provenance and observation assembly) into one private Node worker, started on first use; close waits for its exit. Reuse a bench across captures to amortize startup. The compiled package must be built before using this mode, including from source tests; it launches plain JavaScript without inheriting TypeScript loaders.

Before the native host, process isolation was how a long-lived host recovered the runtime's memory: an in-process close kept Vite, Playwright and their caches resident. The [heap lifetime validation](../../docs/features/active/specimens/heap-lifetime-validation.md) records that tradeoff. With the host, the in-process default keeps only the bench's small Node modules after close, and the worker mainly adds a Node start; the [T04 optimization record](../../docs/features/active/specimens/t04-optimization.md) measures both. Normal close does not unload imported modules or promise immediate RSS reclamation.

## Interpret the evidence

- `changed` means a difference was observed in compatible DOM, ARIA, layout, selected styles or live state. `no-change-observed` is restricted to that scope. Partial required channels yield `insufficient-evidence`, with observed differences retained.
- Captures bind a source revision/dirty status when Git is available, a digest of the configuration and loaded page/module/style responses, a nearest lockfile digest, browser version, effective context and checkpoint. Streaming application traffic is excluded from that source digest and cannot hold readiness open. The loaded-resource digest is not a snapshot of every unused project file or proof of all external resources.
- The manifest also records what produced a capture: `bench` with its plugins, `driver`, `browser.platform`, and `checkpoint` with its `name`, `actionMode`, `ready` steps and outcome, and `baseline`. `context` gains `pixelRatio`, `observed` (what the document saw) and `resources` (font faces and other origins' URLs). Comparison refuses a different browser, checkpoint name, action mode, baseline or pixel ratio, and reports different fonts as a limitation.
- The selected style/geometry scope is accessible light DOM and open shadow roots. HTML-construction tracking observes the initialized specimen realm and reads genuine `TrustedHTML` (as FAST and Lit assign it) through the native stringifier; other non-string HTML stays opaque rather than being converted a second time; pre-existing or untouched foreign-realm closed roots cannot be retrospectively identified. Closed roots, raster content, pseudo-element geometry and running animations carry limitations. Natural animations make layout/style evidence partial; request `motion: 'settled'` programmatically for an explicitly suppressed sample. The media preference for reduced motion remains separate.
- ARIA snapshots come from Chromium's own accessibility tree (capture version 0.2), in the indented YAML form of Playwright's ARIA snapshots: `- role "name" [state]`, text as `- text:` lines, with generic containers and Chromium's internal roles flattened and a text field's value written after its name. Roles and names are Chromium's, so an unnamed `<form>` appears as `form`. Axe is reported as `not-run`; no empty violation list stands in for an axe check. Token dependencies and event history are explicitly unsupported.
- Each accessible element carries its computed role and accessible name in `accessibility` (capture version 0.9), from the same tree, by the element's reference, so a role is tied to the component that owns it: the element itself or one in its shadow tree. A role set through `ElementInternals`, which no attribute shows, is included. An element the tree ignores (hidden, inert behind a modal, inside a closed shadow root) or whose role is `generic`, `none` or `presentation` has none, and so does the mount root itself. If the page changes between its capture and the accessibility tree's, no role is recorded and a limitation says so. Only the native host records it; comparison reports a change under `a11y`.
- Screenshots are review artifacts. `requireVisual: true` always returns insufficient evidence until pixel comparison exists, even when both screenshot paths are present.
- Normalization preserves whitespace and authored identifiers. Only ids exactly matching `specimen-generated-N` are canonicalized, together with references in the same tree scope. Broken relationships remain observable.
- Comparison rejects incompatible browser/version/context/checkpoint captures. An intentional context axis must be declared explicitly. Differing dependency identities are reported as an attribution limit.

The static preview applies the theme attribute, CSS `color-scheme` (`light` for high contrast), `lang`, container and motion mode. An iframe cannot emulate `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` or `navigator.language`, so those follow the viewer's browser: the page shows a notice whenever they differ from the requested context, and a capture taken there reports each difference as a `Context mismatch` limitation. A bench render applies all of them. The [driver comparison](../../docs/features/active/specimens/driver-context-validation.md) records which values each driver gives a specimen.

## Native host

Rendering runs in `specimen-host`, a Rust binary in [`host/`](host). It bundles the bench page and each case with Rolldown, serves every bundle generation from memory on 127.0.0.1 (each render under its own path, so the source digest names exactly the files that render loaded), and drives Chromium's headless shell over CDP through `--remote-debugging-pipe`. Pages get the environment Playwright 1.64 gives them: the same launch switches, default font families and context emulation. A changed source file rebuilds the bundle before the next render.

The bundle follows Vite's import forms: `.css` imports inject a style element, `?inline` CSS and `?raw` files import as strings, `?url` imports resolve to the file's served path, and a stylesheet's relative `@import`s and `url()`s resolve against the stylesheet. `import.meta.glob` calls with literal arguments expand as Vite expands them: a pattern or an array of patterns (`!` excludes), relative to the file or, with a leading `/`, to the root, with the `eager`, `import` and `query` options. Any other glob argument, and other import queries, are rejected. A module that fails to bundle fails only the specimens that use it, and fixing it rebuilds the bench. Selector targets are CSS selectors; Playwright's own selector syntax (`text=`, `>>`, `:has-text()` and the like) is rejected.

The host comes prebuilt, one package per platform, which `@lushly-dev/specimen` lists as optional dependencies so a package manager installs only the one that matches: `@lushly-dev/specimen-host-darwin-arm64`, `-darwin-x64`, `-linux-arm64-gnu` and `-linux-x64-gnu`. The Linux hosts link glibc, as Playwright's headless shell does, and are built against glibc 2.35, Playwright's oldest supported Ubuntu; musl and Windows are not supported yet. They release with the core, at its version, in the `preview` prerelease; until it is out, the host comes from a source build.

The bench looks for the host in this order, then for Playwright's installed headless shell unless `executablePath` is given:

1. `SPECIMEN_HOST_BINARY`, if set.
2. In a source checkout, the release build beside the package, `host/target/release/specimen-host`. Build it with `pnpm -F @lushly-dev/specimen build:host` (rustup installs the pinned Rust 1.98.0).
3. The installed platform package. If it is missing, for example after an install that omitted optional dependencies, rendering fails and names it.

`pnpm -F @lushly-dev/specimen stage:host` copies a release build into this platform's package (`node host/stage.mjs <platform> --binary <path>` stages one built elsewhere). It reads the binary's header and refuses one built for another system or architecture. Each platform package checks this again before it is packed, so an empty or mismatched package cannot be packed.

The host owns Chromium's process group. Each render is bounded by its deadline, from context creation to capture; disposal and closing the context are each bounded by at most one second more. Bundling and Chromium's startup, which is bounded at 10 seconds, come before the deadline, as the earlier runtime's bundle step and browser launch did. Close waits for accepted renders, then stops the browser group, and losing the host's owner stops it at once. Chromium inherits only its CDP pipe, so if the host itself is killed the browser sees the pipe close and exits; the bench also kills the browser group when the host exits unexpectedly, and fails a request the host does not answer in time.

## Validation

`pnpm -F @lushly-dev/specimen test:browser` builds the host, then runs the full native suite: unit, resource-collector, process-worker and Chromium integration tests. It then runs the reference driver (`vitest.reference.config.ts`): the same browser runtime inside Vitest browser mode, the harness the consumers' Storybook Vitest addon uses. Chromium must be installed (`pnpm -F @lushly-dev/specimen exec playwright install chromium`) and the Rust toolchain available; missing binaries are failures, not skipped acceptance. The host's own format, lint and tests run in `foundations/specimen/host` (`cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked`). The repository-wide `pnpm test` and `pnpm check` run only the browser-free subset (`pnpm -F @lushly-dev/specimen test`, see `vitest.unit.config.ts`); the full suite and the packed-artifact consumers run in the path-filtered `specimen.yml` workflow. The adapter and CLI retain their tests in their own packages. `src/compat.test.ts` runs Storybook 10.6.2's own indexer over the `compat/` fixtures as the reference, and `src/compat-run.test.ts` runs its Vitest addon over the same stories and requires every outcome to match; Storybook is a development dependency only. Browser-runtime coverage comes from those real-browser assertions; the Node V8 coverage report excludes browser-only modules because they execute in a different process.

Read [current status](../../docs/features/active/specimens/STATUS.md) for verified progress, known gaps and delivery state, then the [implementation plan](../../docs/features/active/specimens/implementation.md) for ordered tasks and the remaining acceptance gates.

The [warm CPU investigation](../../docs/features/active/specimens/cpu-hotspot-validation.md) records a development-server sourcemap optimization and its separate diagnostic and ordinary resource measurements. Existing maps and source invalidation remain covered by HTTP/browser regressions.

The opt-in [real consumer probes](experiments/README.md) exercise actual FAST-AF and Lushly source with recorded dependency limitations. They are separate from the self-contained package suite and do not establish retained-CSF parity.

## Package split

The selected feasibility source was never published. The native package and its separate AFD bindings and CLI start their first release, a preview, at `2.2.0-preview`, which Changesets versions to `2.2.0-preview.0`; the owner approved it on 2026-11-04. No `2.2.0` exists to overwrite. See [the split transition](../../docs/features/active/platform-monorepo/specimen-transition.md).

Install `@lushly-dev/specimen` for the native API. It requires no AFD, FAST-AF, or Violet runtime, peers, configuration, or install hooks. Native validation contracts are available from `@lushly-dev/specimen/schema`. Install the separate `@lushly-dev/specimen-cli` endpoint for the `specimen` command, or `@lushly-dev/specimen-afd` with compatible AFD core/server packages for commands/MCP composition. The endpoint may install those foundations for its own operation; inspected applications do not need them.
