# Phase 0 specification: kernel, chrome and design foundation

| Field | Value |
| --- | --- |
| Phase | 0, kernel, chrome and design foundation ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | Repository owner approves; the phase 0 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), then the [architecture](../../architecture.md) and the [decision log](../../decisions.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-01 and revised the same day after an independent
  review (18 findings, all addressed; see [Review](#review-2026-11-01)).
  Approved by the owner on 2026-11-01 (D17). In implementation; each
  step's state is one line in STATUS.md's phase 0 block. Step 6
  ([#628](https://github.com/lushly-dev/afd/pull/628)) amended
  [section 4](#4-specimen-with-high-contrast-d53), because the bench now
  emulates media in its native host rather than through Playwright.
  Step 2 recorded its decisions in sections 2.1, 2.2, 2.3 and 2.7, each
  under "Decided by step 2".
  Step 5 ([#638](https://github.com/lushly-dev/afd/pull/638)) added [section 6.7](#67-decided-while-implementing-step-5),
  `flush()` in 6.2, and the kernel bundle measurement in
  [section 8.1](#81-bundle-budget).
  Step 4 wrote the
  [design document](../../design.md), which holds the visual rules step 7
  follows, and decided the resting field border (see
  [Follow-ups](#follow-ups)).
- **Last verified:** 2026-11-01 against `main` at `b0782de7`. Evidence read
  in the repository:
  - **AFD server:** `packages/server/src`:
    - `direct.ts` (the `/direct` exports);
    - `entry-points.test.ts` (`DIRECT_BUDGETS`);
    - `direct-registry.ts:341` (one `interface` per registry);
    - `journal.ts:113-135` (`recordFailures` defaults to `false`; the
      default filter drops `auth-*`);
    - `execution.ts:150-210` (schema failures return before middleware);
    - `journal-replay.ts`.
  - **AFD core:** `packages/core/src/journal.ts` and
    `commands.ts:25-33` (`validateCommandName`).
  - **View state:** `packages/view-state/src`:
    - `registry.ts:151-172` (`hydrate`, `flush`);
    - `commands.ts:142-200` (`view-state-set` calls the handler's `set`);
    - the browser bundle test.
  - **Auth:** `packages/auth/src`:
    - `middleware.ts:57-107` (refuses non-`auth-*` commands when signed
      out, unless excluded);
    - `commands.ts:44-60` (`auth-sign-in` takes
      `{method: 'credentials', email, password?}`, exposed to `cli: true`);
    - `adapters/mock.ts:38-58` (session in memory only);
    - the commands are at the `/commands` subpath.
  - **Local DB:** `packages/local-db/src` (`DataAdapter`, `MemoryAdapter`,
    `HttpAdapter`, `adapter-contract.test.ts`; no IndexedDB backend).
  - **Client:** `packages/client/package.json` (no browser-safe subpath).
  - **violet-elements:** `foundations/fast-af/packages/violet-elements`:
    - two local theme registries, `tokens/master-semantic.tokens.jsonc` (108
      tokens) and `tokens/theme-presets.jsonc` (light and dark);
    - `scripts/build-runtime-theme.mjs` and `src/theme/`;
    - 674 literal `var(--token, literal)` fallbacks across 42 component
      files;
    - `sideEffects: true`, a root entry that registers all 77 elements, and
      a `./dist/*` subpath;
    - no dependency on Violet.
  - **FAST-AF provenance:** `scripts/fast-af-provenance.test.mjs` (every
    recorded file must exist; there is no deletion classification).
  - **Violet:** `foundations/violet/packages`:
    - `core`: theme nodes, `resolveTokens`, and `exportTokens` (one glob
      filter; the JSON format is nested Style Dictionary JSON); its root
      entry imports `node:module`;
    - `runtime`: `Token` is `{id, value, …}`, `VioletRuntime` fetches over
      HTTP only, and `ThemeManager.useSystemPreference` knows light and dark
      only.
  - **Specimen:** `foundations/specimen/src`:
    - `bench-runtime.ts:157` passes `theme` to Playwright as `colorScheme`
      (corrected by step 6: since #616 the native host, `host/src/page.rs`,
      sends the media over CDP);
    - `capture.ts:283` checks the color scheme;
    - `browser/index.ts:95-96` and `browser/page.ts:50`;
    - `axe: 'not-run'`.
  - **Health dashboard:** `endpoints/health-dashboard`:
    - Vite, Playwright from Vitest, axe-core 4.13.0, `health-dashboard.yml`;
    - the CSP in `tooling/single-file.ts:14-25`;
    - its use of `violetThemeCssText` and `applyVioletThemePreset`;
    - a production bundle of 941,989 bytes when importing
      `violet-elements` from its root.
  - **Repository tooling:**
    - `scripts/check-boundaries.mjs` (a foundation may not require another
      family; endpoints are classified by path);
    - `pnpm-workspace.yaml` (`endpoints/*` matches direct children only);
    - `scripts/release/inventory.json:493-512`;
    - `skills/exports.json`.
  - **Playwright** 1.64 `newContext` takes `contrast` and `forcedColors`.

  The trajectory rows were re-checked on the same day; see the
  [trajectory refresh](#trajectory-refresh).
- **Done:** this specification and its approval. Each step of the
  [implementation plan](#12-implementation-plan) has one line in STATUS.md's
  phase 0 block, which is the record of what is merged.
- **Not done:** see that block.
- **Follow-ups:** see [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:**
  - 1, empty shell: with no app installed, the shell still renders every
    part.
  - 3, everything is a command: every layout change is a command, and the
    kernel refuses bad names.
  - 9, layout is data.
  - 10, one library.
  - 11, one kernel, TypeScript first.
  - 13, deterministic core.
  - 14, every mutation is an event.
  - 18, design foundation before UI.
- **Decisions:**
  - D3, D7, D33 and D34 for the layout.
  - D11 for Mock sign-in.
  - D14 for placement and quarantine.
  - D15 for AFD first: the generic pieces land in AFD in step 0.
  - D16 and D17 for status and approval.
  - D25 for TypeScript and D37 for the accelerator admission rule.
  - D26, D28 and D38 for the design foundation.
- **New decisions this specification proposes:** D50 to D53, listed in
  [Amendments](#amendments-to-the-architecture-and-the-decision-log) and
  added to the decision log by this pull request. D50 revises D28. The owner
  approves them by approving the specification.

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-01:

| Row | Recorded | Now | Effect on phase 0 |
| --- | --- | --- | --- |
| R5, W6 | Navigation API Baseline since 2026-01; precommit handler missing in Safari | Unchanged: the precommit handler ships in Chrome and Edge 141 and Firefox 147, and is still blocked in Safari behind a WebKit standards-position issue ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/navigation-precommit-handlers.json), [InfoQ 2026-05](https://infoq.com/news/2026/05/navigation-api-browser)) | The router uses `navigate` interception without precommit handlers; no route guard in phase 0 |
| W5 | Cross-document view transitions not in Firefox | Not re-checked; phase 0 has one document | None |
| W3, W4 | Scoped registries in all three engines (Firefox 159); anchor positioning in Safari 26 | Unchanged | The chrome registers its elements globally in phase 0; scoped registries arrive with apps in phase 1. Drawers and the palette use `<dialog>`; nothing needs anchor positioning |
| W7 | Tauri 2.12.5 on 2026-10-21, 3.0 alpha | Not re-confirmed; no newer release found | D52: the desktop store backend is IndexedDB in the webview, so phase 0 needs nothing from Tauri |
| W14 | FAST-AF and Violet quarantined; nothing publishes | Unchanged (`scripts/release/inventory.json`) | Loam consumes workspace units; nothing publishes |
| R9 | A kernel behind the SDK interface | Phase 0 defines kernel interface version 0 | [Section 6.2](#62-kernel-interface-version-0) |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary).
This specification adds:

| Term | Meaning |
| --- | --- |
| Token contract | The list of semantic token ids the shared components read, with each id's CSS custom property and type: the mapping D38 calls the design foundation's first artifact |
| Component token export | Loam's resolved themes, committed in `violet-elements` as data, from which the package generates its presets (D50) |
| Layout class | One of `compact`, `medium`, `expanded`, chosen by viewport width; it changes how parts render, never the layout state |
| Reference workspace | A deterministic, seeded data set of documented size that the accelerator budgets are measured on (D37) |

## 1. Units and repository placement

Four TypeScript packages, all private and quarantined, under
`endpoints/loam/packages/`:

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `theme/` | `@lushly-dev/loam-theme` | Loam's Violet tree (light, dark, high contrast), its exports, the token contract, the component token export and the token-only lint | `@lushly-dev/violet-core` (build-time, Node); dev: `@lushly-dev/loam-kernel` (for `LAYOUT_DEFAULTS_V0`) |
| `kernel/` | `@lushly-dev/loam-kernel` | The registries with name refusal, kernel interface version 0, the shell commands, the layout model, the palette index, the journal, replay and the test kit, and Mock identity. No DOM dependency | `@lushly-dev/afd-core`, `@lushly-dev/afd-server` (`/direct` and `/define` only), `@lushly-dev/afd-view-state`, `@lushly-dev/afd-auth` (root and `/commands`), `@lushly-dev/local-db`, `zod` |
| `chrome/` | `@lushly-dev/loam-chrome` | The parts as FAST-AF elements, the palette, keyboard, the responsive rules, the router seam and the kit's first components | `@lushly-dev/fast-element`, `@lushly-dev/violet-elements` (only through `./dist/*` deep imports), `@lushly-dev/loam-kernel` (types and the kernel interface), `@lushly-dev/loam-theme` (CSS) |
| `web/` | `@lushly-dev/loam-web` | The browser host: builds the static shell with Vite, wires kernel and chrome, and holds the Chromium suite and the budget | the three above; dev: `@lushly-dev/specimen`, `@lushly-dev/violet-runtime`, `axe-core` 4.13.0, `playwright`, `fake-indexeddb`, `vite`, `vitest` |

- **Workspace.** `pnpm-workspace.yaml` gains `endpoints/loam/packages/*`,
  because `endpoints/*` does not reach them. The architecture's
  `endpoints/loam/*` would also match `docs/`, so this is amended (see
  [Amendments](#amendments-to-the-architecture-and-the-decision-log)). The
  boundary check classifies the packages as endpoints of family `loam` by
  path, so `architecture.json` needs no entry (D14).
- **Release inventory.** Four entries in `scripts/release/inventory.json`, in
  the Health dashboard's shape:
  - `id` `loam-theme`, `loam-kernel`, `loam-chrome` or `loam-web`;
  - `family: "loam"`, `protocol: "npm-changesets"`;
  - `sourceRevision`: the commit the scaffold branches from;
  - `authority: "none: new endpoint authored in lushly-dev/afd on top of
    this revision, not imported; manifest is private: true and cannot
    publish; no route, registry identity, deployment or handoff exists"`;
  - `state: "quarantined"`, `routes: []`, `fixed: false`;
  - `gates: ["pnpm check", "loam.yml", "release-approval"]`;
  - one npm distribution with `format: "npm"`, `initialVersion: "0.1.0"`
    and `private: true`.
- **Scripts:**

  | Package | Scripts |
  | --- | --- |
  | all four | `build`, `typecheck`, `test` (browser-free Vitest, run by `pnpm check`) |
  | `theme` | `theme:build`, `theme:export-components`, `theme:check`, `lint:tokens` |
  | `chrome` | `lint:tokens` |
  | `web` | `test:browser` (Chromium against the `vite build` output, run by `loam.yml` only), `budget` |
- **CI workflow `.github/workflows/loam.yml`:**
  - Triggers: push and pull request to `main`, path-filtered to:
    - `endpoints/loam/**`, except `endpoints/loam/docs/**`;
    - `foundations/fast-af/**`, `foundations/violet/**` and
      `foundations/specimen/**`;
    - `packages/{core,server,view-state,auth,local-db}/**`;
    - `pnpm-lock.yaml`, `pnpm-workspace.yaml` and the workflow itself;
    - plus `workflow_dispatch`.
  - Node 26, `contents: read`, actions pinned to full SHAs.
  - One job, in order:
    1. install with `--frozen-lockfile`;
    2. `pnpm -F "@lushly-dev/loam-web..." build`;
    3. typecheck the four packages;
    4. `test` with coverage;
    5. `theme:check`;
    6. `lint:tokens`;
    7. `playwright install --with-deps chromium`;
    8. `test:browser`;
    9. `budget`;
    10. a clean-tree check;
    11. upload `test-results/` on failure.
  - `AGENTS.md`'s quality-gate table and key rules gain a Loam row, in the
    Health dashboard's pattern.
- **Changesets.** None while the units are private and quarantined.
  Step 0's AFD changes carry their own.

## 2. Design foundation

### 2.1 The token contract (D38)

The shared components already read 108 semantic tokens through plain CSS
custom properties with literal fallbacks. The contract keeps those names.

- **Component ids.** The 108 ids of `violet-elements`' registry,
  `registryVersion` 0.1.0, in its families:
  - `color.{surface,text,border,action,control,field,focus,state}.*`;
  - `size.{font,line,space,target}.*`, `space.{inline,stack,layout}.*` and
    `radius.*`;
  - `shadow.*`, `duration.*`, `easing.*`, `type.*` and `weight.*`;
  - `z-index.*`.

  Contract version 1 is exactly that set with no rename, so no component's
  CSS changes.
- **Custom property.** `--` + the id with `.` replaced by `-`
  (`color.surface.page` → `--color-surface-page`). This is the scheme of the
  component generator (`tokenIdToCssVar`) and of Violet's CSS transformer
  with an empty prefix.
- **Shell ids.** These are under `shell.*` and read only by
  `@lushly-dev/loam-chrome`, never by the shared components:

  | Id | Light value |
  | --- | --- |
  | `shell.size.titlebar` | 40px |
  | `shell.size.statusbar` | 24px |
  | `shell.size.rail` | 48px |
  | `shell.size.tabbar` | 56px |
  | `shell.size.sidebar.default`, `.min`, `.max` | 260px, 200px, 480px |
  | `shell.size.inspector.default`, `.min`, `.max` | 300px, 240px, 520px |
  | `shell.size.panel.default`, `.min` | 240px, 120px |
  | `shell.size.main.min` | 360px |
  | `shell.size.drawer.max` | 320px |
  | `shell.size.handle` | 4px |
  | `shell.size.focus` | 2px (3px in high contrast) |
  | `shell.color.handle.{rest,hover,active}` | references to `color.border.*` and `color.focus.ring` |

  The size defaults also exist as the kernel constant `LAYOUT_DEFAULTS_V0`
  (section 5.2), because the kernel does not depend on the theme package.
  `theme:check` fails when the two disagree.
- **Density.** `comfortable` (default) and `compact`. Compact is a Violet
  `custom` node under each theme. It overrides:
  - `size.space.*`, `space.{inline,stack}.*` and `size.target.*`;
  - `shell.size.{titlebar,statusbar,rail,tabbar}`.

  Compact never takes a target below 24px (WCAG 2.2 target size, minimum).
- **The contract file.** `endpoints/loam/packages/theme/contract/tokens.json`
  lists, per id:
  - the custom property;
  - the type (`color`, `dimension`, `duration`, `cubicBezier`, `fontWeight`,
    `number`, `typography`, `shadow`);
  - whether it is a component or shell id.

  `theme:check` fails on an id in the tree that is missing from the
  contract, or the reverse.

Decided by step 2 (2026-11-01):

- **The contract file's shape** is `{ "contractVersion": 1, "tokens": {
  "<id>": { "property", "type", "kind" } } }`, ids in code-point order, with
  `kind` `component` or `shell`. `theme:check --write` regenerates it; review
  the diff.
- **Types.** A `type.*` id aliases a size or a weight, so it takes that
  type (`dimension` or `fontWeight`); `z-index.*` is `number`. No version 1
  id has a composite `typography` value, so the type is reserved.
- **Compact** leaves `shell.size.statusbar`, `size.target.compact` and
  `size.space.xs` as they are, because they are already at their floors
  (24px, 24px, 2px). It sets `size.target.natural` 28px,
  `size.target.comfortable` 32px, the title bar 32px, the rail 40px and the
  tab bar 48px, and steps the spacing down (`size.space.sm` 2px, `.md` 6px,
  `.lg` 8px, `.xl` 16px, and `space.{inline,stack}.*` with them).
  `space.layout.*` reads the primitives directly, so compact does not change
  it.
- **`LAYOUT_DEFAULTS_V0` before the kernel has it.** The theme package maps
  each of the constant's numbers to its shell id (`LAYOUT_DEFAULT_TOKENS`)
  and compares every node with the kernel's export, which
  `theme/scripts/theme.mjs` reads: the kernel is a development dependency,
  and the boundary check refuses it in `src/`, so `theme`'s `test` compares
  the tree with the numbers of 5.2 instead. Until step 5 added the constant,
  `theme:check` printed a note and skipped that comparison; step 5 removed
  the skip, so a missing export now fails `theme:check`.

### 2.2 Loam's Violet tree

Source: `endpoints/loam/packages/theme/src/tree/`, TypeScript modules that
build a Violet memory database through `@lushly-dev/violet-core`'s public
API, at build time in Node only.

| Node | Type | Holds |
| --- | --- | --- |
| `loam` | `product` | Every contract id with its light value; primitives as reference tokens under `ref.*`, which semantic tokens reference and nothing exports |
| `loam/light` | `theme` | Nothing beyond `loam`; it exists so every theme is a named node |
| `loam/dark` | `theme` | Overrides of colors and shadows |
| `loam/high-contrast` | `theme` | Overrides meeting 7:1 for text and 3:1 for non-text and the focus ring against adjacent colors, on neutral colors; `shell.size.focus` 3px; shadows replaced by borders |
| `loam/<theme>/compact` | `custom` | The density overrides of [2.1](#21-the-token-contract-d38) |

- **Version 1 values.** The light and dark values start as today's
  `violet-elements` light values and dark preset, so the shared components
  render as they do now. High contrast and compact are new.
- **Checks in `theme`'s `test`:**
  - every color pair the design document names (text on surface, action
    text on action background, border on surface, focus ring on surface)
    meets its floor in each theme: 4.5:1 and 3:1 in light and dark, and the
    high-contrast floors above;
  - every token resolves without a broken reference;
  - the resolved id set, less `ref.*`, equals the contract.

Decided by step 2 (2026-11-01):

- **Two version 1 values differ from today's.** Today's values miss the
  floors in two places, so version 1 raises them, and step 3's fallback
  scan carries them into the components:
  - `color.text.muted` in light, `#6b7280` to `#616775`: 4.19:1 on
    `color.surface.subtle` (and on the read-only field) becomes 4.91:1, and
    3.89:1 on `color.surface.selected` (muted cells of selected rows) becomes
    4.56:1;
  - `color.border.strong`, the boundary of checkboxes, radios, switches and
    sliders, from `rgba(28, 26, 13, 0.35)` to `0.48` in light and from
    `rgba(255, 248, 235, 0.26)` to `0.37` in dark: 2.2:1 becomes 3:1 or more
    on every surface.

  The aliases of the two follow them: `color.field.placeholder`,
  `color.field.border.hover` and `shell.color.handle.hover`.
- **The pairs** are listed in `theme/src/pairs.ts`; step 4's design document
  adopts them. In every theme:
  - text: primary, secondary and muted text on the five surfaces, each
    action's text on its background, hover and pressed
    colors, state text on its background and on page and card, the selected
    control's foreground on its background, and field text and placeholder
    on both field backgrounds;
  - non-text: `color.border.strong` on page, card, subtle and floating, the
    hover field border, the hover and active handle colors, and the focus
    ring (and the field's focus border) on every surface.

  Light and dark do not hold decorative borders (`color.border.subtle` and
  the secondary-action, selected-control and state borders, which sit beside
  text or a fill), button fills, which their labels identify, or the resting
  field border to 3:1 (WCAG 1.4.11), so they keep today's values. High
  contrast holds all of them to 3:1. Step 4 decided that the resting field
  border must meet 3:1 after all; the change is a follow-up (see
  [Follow-ups](#follow-ups)).
- **High contrast** is a light scheme on neutral colors: white surfaces with
  `#F2F2F2` subtle and `#E0E0E0` selected, black text and strong borders,
  `#595959` subtle borders, a black focus ring, a black primary action, and
  danger, success and warning keeping their hue at 7:1 on white. Its
  shadows are spread shadows (`0 0 0 1px #000000`, 2px for floating), which
  draw a border without changing layout.
- **Primitives** are the solid colors of all three themes
  (`ref.color.<family>.<step>`) and the spacing scale (`ref.space.<px>`).
  Translucent colors and shadows stay literal on their semantic ids.

### 2.3 Exports

`theme:build` resolves each node with `resolveTokens`, drops `ref.*`, and
writes to `endpoints/loam/packages/theme/dist/` (gitignored):

| File | Content | Used by |
| --- | --- | --- |
| `loam-theme.css` | Four blocks:<br>1. `:root, [data-loam-theme="light"]` with every exported token.<br>2. `[data-loam-theme="dark"]` and `[data-loam-theme="high-contrast"]`, each with only the tokens whose resolved value differs from `loam/light`.<br>3. `[data-loam-theme="<theme>"][data-loam-density="compact"]` with the compact overrides. | The chrome, through a constructable stylesheet |
| `loam-theme.json` | `{ "contractVersion": 1, "nodes": { "<nodeId>": Token[] } }`, where `Token` is `@lushly-dev/violet-runtime`'s `{ id, value }` with resolved values, for every node | `VioletRuntime`'s preloaded source (step 0b) |
| `contract.json` | A copy of the contract | The lint |

The theme package renders the CSS itself, using the property scheme of 2.1,
because Violet's CSS transformer has no exclusion filter and no override
diff. Violet's own exports are not used for these files. `theme:check`
rebuilds the outputs in memory and compares the committed files
(`contract/tokens.json` and the component token export of 2.4); `dist/` is
build output and is never compared.

Decided by step 2 (2026-11-01): the compact block is one rule per theme,
`[data-loam-theme="<theme>"][data-loam-density="compact"]`, each holding the
compact node's diff against its theme. Properties are in id order. The three
files are also the package's `./loam-theme.css`, `./loam-theme.json` and
`./contract.json` exports, and `build` writes them after `tsc`, so the
workspace build produces them. `theme:check` also fails when any node
resolves to an id the contract lacks, because Violet takes an override of an
unknown id as an add. It compares the component token export from step 3,
which adds `theme:export-components` with the file.

### 2.4 The shared components onto Violet themes (D50, revising D28)

The boundary rule forbids a foundation from requiring another family, and
`foundations/fast-af` has no Violet dependency. So the components take
Violet themes as data and as custom properties, never as a package
dependency. This is D50. It revises D28's "through the Violet runtime": the
runtime stays what a consumer may use to apply a theme at runtime (step 0b),
not something the components load.

- **The component token export.** A new file,
  `tokens/violet-theme.export.json`:
  `{ "contractVersion": 1, "source": "loam", "presets": { "light": Token[], "dark": Token[], "high-contrast": Token[] } }`,
  with the component ids only.
  - Written by `pnpm -F @lushly-dev/loam-theme theme:export-components`.
  - Compared by `theme:check`.
- **The generator changes source.** `scripts/build-runtime-theme.mjs` reads
  the export in place of the two JSONC files.
  - It still writes `src/theme/generated/violet-theme.generated.ts`, with
    the same exports (`violetThemeCssText`, `installVioletTheme`,
    `applyVioletThemePreset`, `applyVioletThemeRoot`,
    `getVioletThemePreset`) and selectors.
  - It adds a third preset, `high-contrast`.
  - The Health dashboard and Specimen's FAST-AF fixture keep working
    unchanged.
- **The old registries are retired in place.** The provenance test cannot
  record a deletion: every recorded file must exist, and both files are in
  `upstream-selected.json`. So `tokens/master-semantic.tokens.jsonc` and
  `tokens/theme-presets.jsonc` stay in place:
  - their content becomes a JSONC comment naming D50 and the export, over
    an empty object;
  - they are classified `modified-after-staging`;
  - nothing reads them.

  A deletion classification for the provenance test is a follow-up.
- **Baked-in defaults are checked, not generated (D38).** Defaults live in
  two places:
  - the literal fallbacks across 42 component files (674 of them);
  - `src/theme/violet-token-defaults.ts`, which also holds non-token CSS
    such as the font stack and `calc()` aliases.

  `theme:check` scans `violet-elements/src` for `var(--<component id>,
  <literal>)` and fails when a literal differs from the export's light value
  after normalization (lowercase hex, trimmed whitespace). Step 3 edits each
  mismatching fallback to the light value, and records every edited file.
  The defaults file stays hand-written. A component renders with no theme
  and no runtime present.
- **`token-registry.ts` and its story read the export.**
  `src/foundations/token-registry.ts` and `violet-foundations.stories.ts`
  read the export in place of the registry.
- **README.** The stale `pnpm theme:violet` line is corrected to
  `theme:build`, and a section says where the values come from.
- **Provenance.** Every edited or added file under `foundations/fast-af` is
  recorded in `foundations/fast-af/provenance/adaptations.json`, with
  `import_classification` and an `import_reason` naming D50 and this
  section.
- **Another design system.** A consumer such as Lushly writes its own Violet
  tree and applies its CSS, or `VioletRuntime` with a preloaded source, at
  its root. Nothing in `violet-elements` changes for it. Only Loam's export
  is committed in the package, because Loam's light theme is the baked-in
  default (D38).

### 2.5 The design document and its skill (D26)

- **`endpoints/loam/docs/design.md`.** The design record, in the shape of
  the afd.dev record:
  - principles;
  - the token layer and the contract;
  - the type ramp;
  - color roles and the contrast floors;
  - density rules;
  - the rhythm of the parts (sizes, gutters, handles);
  - motion (durations, easings, `prefers-reduced-motion`);
  - focus and state;
  - iconography (`violet-icon`);
  - the layout classes;
  - the component checklist;
  - a dated history.

  Every rule names the tokens it uses.
- **The `loam-design` skill.** `.claude/skills/loam-design/SKILL.md` with
  `references/{tokens,patterns,checklist,history}.md`, in the
  `afd-site-design` skill's layout. It is declared in `skills/exports.json`
  under `profiles.afd.local`, mirrored to `.codex/skills` by
  `pnpm skills:sync`, and checked by `pnpm check:skills`. The skill and the
  document carry the same rules; the skill names the document as the source.

### 2.6 The component checklist

A kit or chrome component merges only when its pull request shows each item:

1. It references semantic tokens only; `lint:tokens` passes.
2. It covers every state it can take: hover, focus-visible, active,
   disabled, invalid, loading.
3. Keyboard operation and ARIA role, name and state are correct.
4. It is correct in light, dark and high contrast, in both densities, and
   under forced colors.
5. It has a Specimen fixture in `endpoints/loam/packages/chrome/specimens/`.
6. It passes axe in the Chromium suite, in all three themes.
7. It has a line in `design.md`'s component list.
8. It follows `prefers-reduced-motion`: no motion beyond opacity.

### 2.7 The token-only lint

`endpoints/loam/packages/theme/scripts/lint-tokens.mjs`, exported as the
`loam-lint-tokens` bin, which each package calls with its source globs. It
reads CSS from `.css` files and from `css` tagged templates in `.ts` files.

- **It fails on:**
  - **Raw colors:** hex, `rgb()`, `hsl()`, `oklch()`, `lab()`, `color()`,
    or a named color other than `transparent` and `currentColor`. CSS system
    colors are allowed only inside `@media (forced-colors: active)`.
  - **Raw absolute lengths:** `px`, `rem`, `em`, `pt` and the other
    absolute or font-relative units, except `0`, `1px` (hairlines), and
    lengths in `@media`/`@container` conditions, which cannot read custom
    properties.
  - **Unknown properties:** a `var(--x)` where `x` is neither a contract id
    nor a private alias `--_name`.
  - **Private aliases from nowhere:** a private alias must be either
    declared in the same stylesheet from a contract id, or listed in the
    chrome's `STATE_PROPERTIES` allowlist, the properties the controller
    sets through CSSOM from layout state (`--_sidebar-width`,
    `--_inspector-width`, `--_panel-height`).
  - **Primitives:** any `ref.*` token, which no component may read.
  - **Shell tokens in shared code:** a `shell.*` token outside
    `@lushly-dev/loam-chrome`.
- **It allows:**
  - viewport and container units (`vw`, `vh`, `dvh`, `cqi`), `%` and `fr`;
  - `auto`, `min-content`, `max-content`, `fit-content`;
  - `min()`, `max()`, `clamp()` and `calc()` whose length terms are tokens,
    allowed units or numbers.

  So `min(85vw, var(--shell-size-drawer-max))` and a sheet height of
  `40dvh` pass.

`theme`'s `test` runs the lint over a fixture corpus with one passing and
one failing case per rule. The chrome's sources must pass from the first
commit.

Decided by step 2 (2026-11-01):

- **The linted package** is the `package.json` in the working directory: its
  `name` decides whether `shell.*` is allowed, and
  `loamLintTokens.stateProperties` lists its state properties. The chrome's
  manifest lists the three of section 7, and step 7's test checks that its
  `STATE_PROPERTIES` constant equals that list.
- **A private alias** is sound when declared from a contract id, from a state
  property, or from another sound alias; declared more than once, it is sound
  when any declaration is. Outside the chrome, an alias of a shell id is not
  sound.
- **Setting is reading.** Declaring a `--ref-*` property fails as a primitive,
  and declaring a `--shell-*` property outside the chrome as a shell token.
- **Fragments.** Declarations outside any block, as in `css.partial`, are
  linted too.
- **What it does not check:** selectors and at-rule preludes, string and
  `url()` contents, and the values of `${…}` interpolations, which are
  blanked. A `css` template nested in an interpolation is linted on its own.
- **Lengths:** zero in any unit and `±1px` pass. Time, angle and resolution
  units are not lengths.
- **System colors** include the deprecated ones except `Background`, which as
  a value is usually the property name; `@media not (forced-colors: active)`
  does not count as forced colors.
- **Globs** that match no file fail, so a mistyped glob cannot pass.
- **The corpus** is `theme/fixtures/lint-tokens/`, which the root Biome
  configuration skips.

## 3. Units of work in AFD and the foundations first (D15)

**Step 0a, in AFD.** Each change has tests, docs and a changeset:

| Change | Package | Why generic |
| --- | --- | --- |
| `IndexedDbAdapter`, a `DataAdapter` over IndexedDB, at `@lushly-dev/local-db/indexeddb` | `local-db` | Any browser AFD app with offline data wants it; `types.ts:57` already anticipates it |
| The adapter contract suite exported as `runDataAdapterContract(name, create)` from `@lushly-dev/local-db/testing`, with `IndexedDbAdapter` added to it (over `fake-indexeddb` in Node) | `local-db` | One contract suite for every adapter, as `adapter-contract.test.ts` already intends, now runnable from a browser suite too |
| `IndexedDbJournalSink`, a `JournalSink` over IndexedDB with `append` and `read(range)`, at `@lushly-dev/afd-core/journal-indexeddb` | `afd-core` | The browser counterpart of `journal-file` |

- **Database ownership.** Each class owns its own database and its upgrade,
  so neither can miss the other's store.
  - `IndexedDbAdapter({ name })` opens one object store, `records`, keyed by
    `[table, id]` with an index on `table`. It therefore takes any table
    name, as `DataAdapter` requires.
  - `IndexedDbJournalSink({ name })` opens one object store, `entries`,
    keyed by `seq`.
- **One writer.** The sink takes the Web Lock `<name>:writer` before its
  first `append` and refuses `append` when another context holds it, with
  `JOURNAL_LOCKED`. This mirrors `journal-file`'s one-process-per-file rule.
  Step 0a settled what the plan left open:
  - The sink also has `lock()`, which takes the lock without appending, and
    `close()`, which releases it. The journal middleware only reports a
    failed `append` to `onError`, so a host learns of a second tab from
    `lock()` before any command runs.
  - Refusals are `IndexedDbJournalError`s with `code`, `suggestion` and
    `retryable`, which `wrapError()` keeps. Without the Web Locks API the
    sink refuses to write, with `JOURNAL_LOCK_UNAVAILABLE`; an append still
    waiting for the lock when `close()` runs rejects with `JOURNAL_CLOSED`.
  - `runDataAdapterContract` imports its test functions from `vitest`, an
    optional peer dependency of local-db, and no Node.js builtin, so the
    same call runs in Node.js and in Vitest's browser mode.
- **Parity and auth.**
  - TypeScript only, because both are browser features;
    `docs/language-parity.md` gains the rows marked TypeScript-only with
    that reason.
  - `afd-auth` needs no change: its Chromium suite (`auth-browser.yml`)
    already covers the root entry.

**Step 0b, in Violet.** Recorded in
`foundations/violet/provenance/adaptations.json`:

- `VioletRuntime` accepts a preloaded source, `source: { tokens: Token[] }`,
  in place of `apiUrl`, so a static build can apply a theme with no token
  server. `load()` resolves from it, and `switchNode` takes a new source.
- `ThemeManager.useSystemPreference` accepts an optional high-contrast
  node, chosen when `(prefers-contrast: more)` or `(forced-colors: active)`
  matches.

Decided while implementing step 0b, as the options most consistent with
the rest of this section (amended 2026-11-01):

- `source` and `apiUrl`/`apiKey` are either/or: `VioletConfig` is the union
  of `VioletHttpConfig` and `VioletSourceConfig`, and the constructor
  refuses both.
- A source token is `{ id, value }` with an optional `resolvedAt`, which
  defaults to the node, so `loam-theme.json`'s tokens feed the source as
  they are.
- A source runtime never reads or writes the cache, and `preload()` does
  nothing. `switchNode(nodeId)` without a source only reapplies the node the
  runtime holds; an HTTP runtime refuses a source.
- A `ThemeManager` theme may carry its `source`, which the manager passes to
  `switchNode`, so the manager and `useSystemPreference` work over a
  preloaded runtime.

The chrome does not use the runtime in phase 0: it applies `loam-theme.css`.
The runtime path is what D50 offers consumers. One `web` Chromium test
applies `loam-theme.json`'s `loam/dark` through `VioletRuntime` and gets the
same computed values for every component id as the stylesheet does.

## 4. Specimen with high contrast (D53)

`SpecimenContext.theme` gains `'high-contrast'`. The bench maps it to
Playwright's `colorScheme: 'light'` and `contrast: 'more'`, so a page that
resolves its theme from media queries, as the chrome does under
`appearance: system`, selects high contrast itself. The bench sets no
attribute of its own beyond its existing `data-specimen-theme`.

Amended by step 6 (2026-11-01): the bench no longer renders through
Playwright's `newContext`; since #616 its native host drives Chromium over
CDP. The mapping is therefore the same media the host sends with
`Emulation.setEmulatedMedia`, `prefers-color-scheme: light` and
`prefers-contrast: more`, and the light and dark themes now send
`prefers-contrast: no-preference` rather than leaving it to the browser.
The capture observes `prefers-contrast` beside `prefers-color-scheme`, and
reports a `Context mismatch` when either differs from what the theme
requires, so a capture that did not have high contrast is never evidence
for it.

Files that change, recorded in `foundations/specimen/provenance/adaptations.json`:

- `src/types.ts`, `src/schema.ts` and `src/validate.ts`, the bench's own
  request validation;
- `host/src/page.rs`, the context mapping, in place of
  `src/bench-runtime.ts`, which does not change;
- `src/browser/capture.ts`, whose color-scheme check expects `light` for
  high contrast and which checks `prefers-contrast`;
- `src/browser/index.ts` and `src/browser/page.ts`, the theme picker,
  `color-scheme` and `data-specimen-theme`;
- the README;
- the tests: the context probe and matrix in `fixtures/`, which gain a
  high-contrast context, the bench and static drivers in
  `src/drivers.test.ts`, the Vitest reference driver in `reference/`, and
  `src/validate.test.ts`; and the driver comparison record in
  `docs/features/active/specimens/driver-context-validation.md`.

The AFD integration and the CLI take the theme through the shared schema
and validation, so neither changes.

Specimen still does not run axe; the Loam suite does. Forced colors is a
separate condition, which overrides Loam's palette. It is tested by the
suite with `forcedColors: 'active'`, not through Specimen's theme.

## 5. The layout model

### 5.1 Parts

| Part | Element | Role and name | Present | User-collapsible |
| --- | --- | --- | --- | --- |
| title bar | `loam-titlebar` | `banner`, "Loam" | always | no |
| rail | `loam-rail` | `navigation`, "Apps" | except in `compact` | no |
| sidebar | `loam-sidebar` | `complementary`, "Sidebar" | when open | yes |
| main | `loam-main` | `main` | always | no |
| inspector | `loam-inspector` | `complementary`, "Inspector" | when open | yes |
| panel | `loam-panel` | `region`, "Panel" | when open | yes |
| status bar | `loam-statusbar` | `contentinfo`, "Status" | except in `compact` | no |
| tab bar | `loam-tabbar` | `navigation`, "Apps" | only in `compact`, in place of the rail | no |

With no app installed:

- The rail and the tab bar show only the settings entry, disabled with the
  tooltip "Settings arrive in phase 4".
- The sidebar, inspector and panel show `loam-empty-state` with a sentence
  saying what will appear there.
- Main shows the empty-shell landing: "No apps yet", plus the palette
  shortcut.
- The status bar's left side shows the signed-in actor or "Signed out", and
  its right side shows the journal's last sequence number.

### 5.2 Layout state, version 0

```ts
interface LayoutStateV0 {
	version: 0;
	sidebar: { open: boolean; width: number };
	inspector: { open: boolean; width: number };
	panel: { open: boolean; height: number; maximized: boolean };
	compact: { drawer: 'sidebar' | 'inspector' | null; sheet: boolean };
}

export const LAYOUT_DEFAULTS_V0 = {
	sidebar: { default: 260, min: 200, max: 480 },
	inspector: { default: 300, min: 240, max: 520 },
	panel: { default: 240, min: 120 },
	mainMin: 360,
} as const;
```

- **Defaults.**
  - Sidebar: open, 260 wide.
  - Inspector: closed, 300 wide.
  - Panel: closed, 240 high, not maximized.
  - Compact: no drawer, no sheet.
- **Constraints.** Widths and heights are integers in CSS pixels, within
  `LAYOUT_DEFAULTS_V0`'s bounds; the panel has no stored maximum. Its
  rendered height is capped at main's height minus `panel.min`, which is
  never stored. The state is the same in every layout class; `compact` is
  read only in the compact class.
- **One validator.** `validateLayoutPatch(state, patch)` in the kernel
  checks a deep partial against the constraints and returns the new state
  or a `VALIDATION_ERROR` naming the field, the range and a suggestion. It
  runs in the handler, never in the input schema, so a refusal reaches the
  journal (6.4). Both paths call it:
  - `layout-set`;
  - the `loam.layout` view-state handler's `set` (and `replace`), so
    `view-state-set { id: 'loam.layout' }` can bypass nothing.
- **Persistence.** The state is the view-state handler `loam.layout` on the
  kernel's `ViewStateRegistry`, persisted through the registry's `adapter`
  with the default 300 ms debounce. The chrome calls `flush()` on
  `pagehide` and `visibilitychange` to hidden. `view-state-get { id:
  'loam.layout' }` and `layout-get` return the same value. Keying by app and
  scope arrives with apps (phase 1) and scope (phase 2).

### 5.3 Layout classes and responsive rules (D33)

| Class | Viewport width | Rules |
| --- | --- | --- |
| `expanded` | ≥ 1024px | Every open part renders inline. If the inline parts would leave main narrower than `mainMin`, the inspector renders as a non-modal overlay drawer from inline-end, then the sidebar from inline-start, without changing the state |
| `medium` | 640 to 1023px | Sidebar and panel inline; the inspector, when open, is a non-modal overlay drawer from inline-end |
| `compact` | < 640px | The rail becomes the bottom tab bar, and the status bar hides. When `compact.drawer` is `sidebar` the sidebar renders as a drawer from inline-start, and when it is `inspector` the inspector renders from inline-end. A drawer is `min(85vw, var(--shell-size-drawer-max))` wide and modal (`<dialog>` with `showModal()`). When `compact.sheet` is true the panel renders as a bottom sheet above the tab bar, between `40dvh` and `80dvh` high |

- **Choosing the class.** Classes are chosen with `matchMedia`. The chrome
  sets `data-layout-class` on its root, so CSS and tests read one source.
- **Changing class.** Entering `compact` opens no drawer or sheet. Leaving
  `compact` with a drawer or sheet open calls `layout-set { compact: {
  drawer: null, sheet: false } }`, so the journal records it.
- **Modal policy.** At most one modal at a time.
  - The modals are the palette and a compact drawer.
  - Opening the palette while a compact drawer is open first calls
    `layout-set { compact: { drawer: null } }`.
  - Non-modal overlay drawers close with Escape and stay open when the
    palette opens.
  - The overlay manager takes this rule over in phase 4.

## 6. The kernel

### 6.1 Registries and name refusal

- **Two registries.** A direct registry serves one interface: it sets
  `context.interface` on every call (`direct-registry.ts:341`). So the
  kernel builds two registries with `createDirectRegistry` from
  `@lushly-dev/afd-server/direct`, over the same command definitions and
  the same middleware instances:
  - `interface: 'palette'` serves calls from the chrome and the palette,
    which are the person's surface;
  - `interface: 'agent'` serves `kernel.agent`, used by tests now and the
    copilot later.

  The shared middleware, in order, is the auth middleware (6.5) and then
  one journal middleware instance over the given sink (6.4). Sharing it
  gives both registries one sequence.
- **State is shared.** One `ViewStateRegistry` instance holds the
  `loam.layout` and `loam.appearance` handlers, and both registries'
  commands close over it.
- **Name refusal.** Before either registry is built, every command name
  goes through `validateCommandName` from `@lushly-dev/afd-core`, including
  the shell's own names and any `options.commands`.
  - A failure rejects `createKernel` with `LoamKernelError`, code
    `COMMAND_NAME_INVALID`, the name, the reason, and the suggestion
    "Rename it domain-action, e.g. notes-create".
  - A bad name never reaches a registry. `defineCommand`'s warning is
    unchanged.
- **Exposure.** The kernel sets every shell command's `expose` to
  `{ palette: true, agent: true, mcp: false, cli: false }` when it builds
  the registries. That includes overriding the auth commands' `cli: true`,
  because phase 0 has no CLI or MCP surface; phase 6 revisits it.

### 6.2 Kernel interface, version 0

This is the only surface the chrome binds to. The SDK wraps it in phase 1
(R9).

```ts
export const KERNEL_INTERFACE_VERSION = 0;

export interface LoamKernelV0 {
	readonly version: 0;
	call<T = unknown>(name: string, input?: unknown, options?: CallOptionsV0): Promise<CommandResult<T>>;
	listCommands(): CommandSummaryV0[];
	subscribe(listener: (event: KernelEventV0) => void): () => void;
	readonly agent: Pick<LoamKernelV0, 'call' | 'listCommands'>;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export interface CallOptionsV0 { signal?: AbortSignal }

export interface CommandSummaryV0 {
	name: string;
	title?: string;
	description: string;
	mutation: boolean;
	needsInput: boolean;
	keybinding?: string;
}

export interface KernelEventV0 {
	command: string;
	interface: 'palette' | 'agent';
	success: boolean;
	mutation: boolean;
	seq?: number;
}

export interface KernelEnvironmentV0 {
	matches(query: string): boolean;
	onChange(query: string, listener: () => void): () => void;
}

export interface KernelOptionsV0 {
	store: DataAdapter;
	storeKind: 'memory' | 'indexeddb';
	journal: JournalSink;
	auth: AuthAdapter;
	environment: KernelEnvironmentV0;
	host: 'browser' | 'desktop' | 'hosted' | 'test';
	commands?: ZodCommandDefinition[];
	clock?: () => number;
	random?: () => number;
}

export function createKernel(options: KernelOptionsV0): Promise<LoamKernelV0>;
```

- **`subscribe`.** It fires after every call through either registry,
  success or failure, journaled or not. `seq` is set when the call was
  journaled. The chrome re-reads `layout-get` after events for `layout-*`
  and `view-state-set`/`view-state-replace` on `loam.layout`, re-reads
  `appearance-get` after `appearance-set`, and re-reads `auth-session-get`
  after `auth-*`. It holds no layout state of its own.
- **`flush`.** It writes pending view-state persistence at once; the chrome
  calls it on `pagehide` and `visibilitychange` to hidden (5.2). Added by
  step 5 (6.7).
- **`environment`.** The browser host passes `window.matchMedia`;
  tests and replay pass a fixed table.
- **`commands`.** Extra definitions registered beside the shell's. Phase 0
  uses them only in tests; apps arrive in phase 1. They go through name
  refusal like every name.
- **`listCommands`.** It returns the palette registry's commands.
  - `needsInput` is true when the input schema has a required property;
    the palette runs only commands without required input in phase 0 and
    shows the others disabled, with their description.
  - `keybinding` comes from the kernel's constant `SHELL_KEYBINDINGS_V0`
    (section 7).
- **Versioning.** The chrome checks `version` at boot. A mismatch renders a
  full-page error naming both versions.
- **Boot.** `createKernel` hydrates the view-state registry from `store`
  before resolving, so the first `layout-get` returns the persisted state.

### 6.3 Commands in phase 0

Mutations declare `mutation: true` and return an `undoCommand` with
`undoArgs`.

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `view-state-get`, `view-state-set`, `view-state-list` | from `@lushly-dev/afd-view-state` | as the package defines | as the package defines |
| `layout-get` | query | `{}` | `LayoutStateV0` |
| `layout-set` | mutation | a deep partial of `LayoutStateV0` without `version` | the new state; undo is `layout-set` with the previous values of the fields given |
| `layout-reset` | mutation | `{}` | the default state; undo is `layout-set` with the previous state |
| `appearance-get` | query | `{}` | `{ theme: 'system' \| 'light' \| 'dark' \| 'high-contrast'; density: 'comfortable' \| 'compact'; resolved: 'light' \| 'dark' \| 'high-contrast' }` |
| `appearance-set` | mutation | `{ theme?, density? }` | as `appearance-get`; undo restores the previous values |
| `palette-open` | query | `{ query?: string }` | `{ open: true }` |
| `palette-close` | query | `{}` | `{ open: false }` |
| `palette-search` | query | `{ query: string; limit?: number }`, limit 1 to 50, default 20 | `{ items: Array<{ name: string; title?: string; description: string; score: number; field: 'name' \| 'title' \| 'description'; matches: Array<[number, number]> }> }` |
| `auth-sign-in`, `auth-sign-out`, `auth-session-get` | from `createAuthCommands` (`@lushly-dev/afd-auth/commands`) over `MockAuthAdapter` | as the package defines | as the package defines |
| `shell-info-get` | query | `{}` | `{ kernelInterface: 0; layoutState: 0; storeInterface: 0; tokenContract: 1; host; store }`, where `host` and `store` echo the options |

- **`appearance-*` state.** A second view-state handler,
  `loam.appearance`. Phase 4's settings take this record over without
  changing the commands.
- **The `system` rule.** `resolved` follows the environment:
  - `(forced-colors: active)` or `(prefers-contrast: more)` → high
    contrast;
  - otherwise `(prefers-color-scheme: dark)` → dark;
  - otherwise light.

  Under forced colors the chrome sets `data-loam-theme="high-contrast"` and
  lets the system colors win, as the components' `forced-colors` rules do.
- **Palette open and close.** `palette-open` and `palette-close` change
  chrome state that the chrome subscribes to, not stored state.
- **`palette-search`.** Deterministic, with no model and no randomness:
  - The index is `createPaletteIndex(entries)`, exported from the kernel and
    used by the command over `listCommands()`.
  - It is a subsequence fuzzy match over name, title and description.
  - Weights: name 3, title 2, description 1; plus a contiguous-run bonus and
    a word-start bonus.
  - `field` and `matches` name the best-scoring field and the matched
    ranges in it.
  - Ties break by name.
- **Domains.** `layout`, `view-state`, `auth-*` and `shell` are in the
  architecture's list. `appearance` and `palette` are added (D51).

### 6.4 Journal and replay

- **Sinks.**
  - Browser: `IndexedDbJournalSink({ name: 'loam-journal' })` (step 0a).
  - Tests and replay: `MemoryJournalSink`.
- **Journal options.** The one journal middleware instance takes:
  - `recordFailures: true`: a handler refusal such as `layout-set` out of
    range is recorded. Input-schema failures return before middleware
    (`execution.ts:150-210`) and are not journaled; they change nothing.
  - `filter`: every command except `palette-search`, which runs per
    keystroke and changes nothing.
  - The default exclusion of `auth-*` is dropped deliberately, so sign-in
    is journaled and replayable.
  - `redact`: removes `input.password` from `auth-sign-in` entries. The
    Mock adapter needs no password.
  - The clock and random tape on.
- **Retention.** Phase 0 keeps every entry. A cap and compaction are later
  concerns.
- **Replay.** `replayKernel(entries, options)` in the kernel's test kit:
  1. builds a fresh kernel over an empty `MemoryAdapter`, a fresh
     `MockAuthAdapter` and a fixed environment, with the recorded tape;
  2. runs `replayJournal` from the first entry, with `ignore` set to the
     environment-dependent results: `appearance-get`/`appearance-set`
     `data.resolved`, `shell-info-get` `data.host` and `data.store`, and
     the session's timestamps;
  3. returns the report with the final `layout-get` and `appearance-get`.

  A replay must start at `seq` 1. A journal that does not start there is
  refused, because the state it starts from is not in it. A divergence
  fails with the report's first difference.
- **Journal diff (A3).** `diffJournals(a, b)` in the test kit compares two
  journals entry by entry on command, input, result and success, ignoring
  timestamps and durations. It returns
  `{ equal, firstDifference?: { index, field }, counts }`.

### 6.5 Identity

- **Adapter and commands.** The kernel holds a `MockAuthAdapter`, whose
  session lives in memory only and ends with the page, and registers the
  auth commands.
- **Signing in.** The title bar's account button shows "Sign in" or the
  signed-in name. "Sign in" calls `auth-sign-in` with
  `{ method: 'credentials', email: 'person@example.com' }`.
- **Middleware.** `createAuthMiddleware(adapter, { exclude })` gets
  `exclude` set to every phase 0 command name, so nothing is refused when
  signed out. None requires auth before phase 3. The middleware still fills
  the actor from the session when signed in (`middleware.ts:69`), so
  journal entries carry it.

### 6.6 Stores, version 0 (D52)

- **Interface.** The store interface is local-db's `DataAdapter`,
  unchanged; Loam adds none of its own in phase 0.
- **Backends.**
  - `MemoryAdapter`, for tests and replay.
  - `IndexedDbAdapter({ name: 'loam-store' })` (step 0a), in the browser
    and, by D52, in the desktop webview too.
- **Tables.** View state uses the view-state package's defaults (table
  `settings`, category `view-state`).
- **SQLite.** SQLite on the desktop, through a Tauri plugin, is admitted in
  phase 6 only if a measurement shows IndexedDB falls short.
- **Conformance.** `runDataAdapterContract` from
  `@lushly-dev/local-db/testing` runs in `web`'s Chromium suite against the
  real IndexedDB. It already runs in Node over `fake-indexeddb` in
  local-db's own suite.
- **A second tab.** The journal sink's writer lock (step 0a) is held by the
  first tab. A second tab whose sink's `lock()` rejects with
  `JOURNAL_LOCKED` renders a full-page notice, "Loam is open in another
  tab", and does not create a kernel.

### 6.7 Decided while implementing step 5

Step 5 settled what sections 5 and 6 left open, as the options most
consistent with them (amended 2026-11-01):

- **The test kit is a subpath.** `replayKernel`, `diffJournals`,
  `createReferenceWorkspace`, `recordSession`, `createFixedEnvironment` and
  `SESSION_50`, the scripted 50-call session of E2, are exported from
  `@lushly-dev/loam-kernel/testing`, so `MemoryAdapter`,
  `MemoryJournalSink` and `MockAuthAdapter` stay out of the root's graph.
  Step 7 records its committed fixture from `SESSION_50`.
- **Names.** Name refusal also refuses a name given twice, with
  `COMMAND_NAME_DUPLICATE`, before `createDirectRegistry` would throw a
  plain `Error`. Both refusals carry `details` `{ name, reason }`.
- **Exposure and auth.** Only the shell's commands get
  `{ palette: true, agent: true, mcp: false, cli: false }`; a command in
  `options.commands` keeps its own `expose`. The auth middleware's
  `exclude` lists every registered name, `options.commands` included, so
  nothing is refused signed out.
- **Refusals as results.** A view-state handler can only refuse by
  throwing, which the engine returns as a generic
  `COMMAND_EXECUTION_ERROR` outside devMode. So the kernel wraps
  `view-state-set`: for `loam.layout` and `loam.appearance` it runs the
  shared validator first and returns its `VALIDATION_ERROR` as the result,
  which is journaled. The handlers' `set` and `replace` still validate and
  throw `LoamKernelError`, for callers of the registry itself. A
  replacement must be a complete state. The validators look fields up as
  own keys only, so an inherited name such as `constructor` or `toString` is
  an unknown field and refused, and they skip a field whose value is
  `undefined`, as a spread of optional values leaves it. `appearance-set` and the
  `loam.appearance` handler share `validateAppearancePatch` the same way.
- **Schema and handler.** `layout-set`'s input schema is strict and typed
  (unknown keys and `version` are schema failures, which change nothing and
  are not journaled); integers and ranges are checked in the handler.
- **Hydration.** A persisted record the validator refuses is ignored and
  its defaults kept, so one bad record cannot stop the other from loading.
- **`seq` in events.** The kernel gives every call a trace ID,
  `loam-<boot clock in base 36>-<n>`, and reads the `seq` the sink assigned
  to that trace ID; the journal middleware exposes no other link between a
  call and its entry. A failed append (a lost writer lock, a full quota)
  leaves the event without `seq` and goes to the host's `reportError`
  through the journal middleware's `onError`; the call's result is
  unchanged.
- **`flush`.** Section 5.2 has the chrome call `flush()` on `pagehide`, so
  `LoamKernelV0` gains `flush()` (6.2); it does nothing after `dispose()`.
- **The `system` theme.** The kernel resolves `system` at each
  `appearance-get` and emits no event when the media change; the chrome
  listens through `environment.onChange` and re-reads `appearance-get`, so
  it still holds no appearance state of its own.
- **Replay.** Each entry runs on the registry of the interface it was
  recorded on. `MockAuthAdapter` derives the session and user ids from
  `Date.now()`, so they count as the session's timestamps:
  `REPLAY_IGNORE` is `metadata.executionTimeMs`, `data.resolved`,
  `data.host`, `data.store`, `data.session.id`, `data.session.expiresAt`
  and `data.user.id`. A journal that does not start at `seq` 1 rejects with
  `LoamKernelError` `REPLAY_START_INVALID`; a divergence rejects with
  `REPLAY_DIVERGED`, whose `details` carry the report and the first
  difference. An empty journal replays to the defaults. The Mock session
  ends with the page and replay does not, so a browser journal spanning a
  reload while signed in diverges at the next `auth-*` entry; E2's fixture
  is one session, and real identity arrives in phase 3.
- **Journal diff.** `diffJournals` also ignores `metadata.traceId` and the
  Mock session's ids, and takes extra `ignore` paths. `firstDifference`
  has an optional `path`, and its `field` is `'length'` when one journal is
  longer; `counts` is `{ a, b, same, different }`.
- **Palette index.** Whitespace in a query is ignored and case does not
  matter; a character whose lower case is longer (a dotted capital I) is
  kept as it is, so offsets stay offsets into the original text. A field's
  score is its weight × (the query length + the bonuses): 1 per matched
  character that directly follows the previous one, 2 per matched character
  at a word start (after a non-alphanumeric character, or a camel-case
  capital). At most 16 starts are tried: the first occurrence of the
  query's first character, then later occurrences at word starts. Equal fields prefer
  name, then title, then description. `matches` are half-open
  `[start, end)` ranges. An empty query lists every entry by name with
  score 0. On the 5,000-entry reference workspace, Node 26 on a loaded
  10-core Mac measured a p95 of about 2.5 ms per query (A1's budget is
  8 ms in Chromium; step 7 measures it there).
- **Keybindings.** `SHELL_KEYBINDINGS_V0` is a frozen list of frozen
  `{ chord, command, toggle?, focus? }`. `listCommands` gives a command a
  `keybinding` only for a chord that runs it with no input of its own
  (`Mod+K` for `palette-open`); the toggle chords compute `layout-set`'s
  input, so `layout-set` has none.
- **`needsInput`** is also true for a union input every branch of which
  has a required property (`auth-sign-in`).
- **Disposal.** After `dispose()`, calls return `KERNEL_DISPOSED`.
- **The reference workspace** returns `{ commands, queries, calls }`:
  `size` command summaries, 200 queries (a quarter matching nothing) and
  `size` mixed shell calls, every one journaled, which `recordSession` runs
  on a test kernel for A2 and A3.

## 7. The chrome

- **The shell element.** `loam-shell` hosts the parts in a CSS grid.
  - Its tracks read the layout state through the `STATE_PROPERTIES`
    (`--_sidebar-width`, `--_inspector-width`, `--_panel-height`).
  - The controller sets them on the element through CSSOM
    (`style.setProperty`).
  - It is the only place pixel values from state enter CSS.
- **Resize handles.** `loam-resize-handle`.
  - It has role `separator`, `aria-orientation`, and `aria-valuenow`,
    `aria-valuemin` and `aria-valuemax`.
  - Pointer drag previews locally by setting the state property, then
    commits one clamped `layout-set` on release.
  - Arrow keys step by 16px and commit each step; Home and End go to the
    minimum and maximum.
- **The palette.** `loam-palette`.
  - It is a `violet-dialog` opened with `showModal()`, holding a search
    field and a `violet-listbox` of results from `palette-search`.
  - Enter runs the selected command through `kernel.call`.
  - A failure shows its message and suggestion in the list's footer.
  - Escape closes it with `palette-close`.
  - It opens on Mod+K and from the title bar's search button, both calling
    `palette-open`.
- **Reserved chords.** These are chrome-level bindings, held in the
  kernel's `SHELL_KEYBINDINGS_V0`, each calling a command. A keybindings
  registry arrives with the keybindings surface in phase 1.

  | Chord | Command |
  | --- | --- |
  | Mod+K | `palette-open` |
  | Mod+B | `layout-set { sidebar: { open: !open } }`; in compact, `compact.drawer` toggles `sidebar` |
  | Mod+Alt+B | the same for the inspector |
  | Mod+J | `layout-set { panel: { open: !open } }`; in compact, `compact.sheet` toggles |
  | F6, Shift+F6 | move focus to the next or previous present part, in the order title bar, rail or tab bar, sidebar, main, inspector, panel, status bar; no command, because focus is not state |
- **The router seam.** It uses the Navigation API with URLPattern,
  intercepting same-origin navigations; it registers no precommit handler
  (W6). Phase 0 has one route, `/`. Any other path renders main's "Nothing
  here" empty state with a link home. Phase 2 owns the URL scheme.
- **The kit's first components.** Only what the empty shell uses, each under
  the checklist:
  - the parts above, `loam-resize-handle` and `loam-palette`;
  - `loam-empty-state`, which fixes `violet-empty-state`'s use in parts;
  - `loam-status-item`.
- **Elements.** Everything else comes from `violet-elements` as it is,
  imported only through `@lushly-dev/violet-elements/dist/<component>/…`
  deep imports. The package root registers all 77 elements and is
  `sideEffects: true`, so a root import costs the whole set (the Health
  dashboard's bundle is 941,989 bytes). `chrome`'s `test` fails on a root
  import. Loam's elements register globally under the `loam-` prefix in
  phase 0; scoped registries arrive with apps in phase 1.
- **Theme application.**
  - It applies `loam-theme.css` through `adoptedStyleSheets`.
  - It sets `data-loam-theme` and `data-loam-density` on
    `document.documentElement` from `appearance-get`'s `resolved` and
    `density`.
  - No `<style>` element and no style attribute in markup is used, so a CSP
    of `style-src 'self'` holds; CSSOM changes are not restricted by
    `style-src`.

## 8. Budgets

### 8.1 Bundle budget

`web`'s `budget` script builds with Vite in production mode and measures
the files the empty shell loads before first paint. It fails over these
ceilings:

| Measure | Ceiling |
| --- | --- |
| JavaScript, minified | 320,000 bytes |
| JavaScript, gzip | 95,000 bytes |
| CSS, minified, including `loam-theme.css` | 40,000 bytes |
| `@lushly-dev/loam-kernel` alone, minified with Zod, esbuild browser bundle | 150,000 bytes |

The ceilings assume the deep imports of section 7. Step 7 records the
measured values in this specification's amendments. When a measurement is
under 70% of its ceiling, the ceiling is lowered to the measured value plus
10%. Raising a ceiling needs an amendment with the reason.

Measured by step 5 (2026-11-01), `dist/index.js` bundled by esbuild 0.27
for the browser, minified: 520,541 bytes, of which the kernel's own code is
about 16 KB, the AFD packages about 50 KB and Zod 4.6.7 about 454 KB.
Zod's root entry, which `afd-server`, `afd-view-state` and `afd-auth`
import, re-exports every locale (about 264 KB) and esbuild keeps them; Zod
without its locales is still about 190 KB. The kernel row's ceiling
therefore cannot hold, and the page's JavaScript ceilings are at risk too.
Step 7 owns the `budget` script and decides, by amendment with the
measurements, between a locale-free Zod entry in the build, measuring the
Vite (Rollup) output, which tree-shakes more, and raising the ceilings.

### 8.2 The accelerator admission rule (D37)

The reference workspace is `createReferenceWorkspace({ seed, size })` in the
kernel's test kit. It is deterministic for a seed. In phase 0 it generates
command summaries for the palette index and journals for replay and diff;
documents arrive in phase 2.

| Operation | Reference size | Budget, Chromium in CI | Measured from |
| --- | --- | --- | --- |
| A1 `createPaletteIndex` search per query | 5,000 entries, 200 fixed queries | p95 ≤ 8 ms | Phase 0 |
| A2 `replayKernel` | 10,000 entries of mixed shell commands | ≤ 2,000 ms in total | Phase 0 |
| A3 `diffJournals` | 2 × 10,000 entries | ≤ 500 ms | Phase 0 |
| A4 Reference index rebuild | 2,000 documents, 20,000 links | ≤ 500 ms | Phase 2 |
| A5 Content indexing | 2,000 documents, 20 MB of text | ≤ 3,000 ms | Phase 2, when search lands |

- **Measurement.** `web`'s `test:browser` runs A1 to A3 in one measurement
  file that reports and asserts, on `ubuntu-latest`, recorded with each run.
- **Admission.** A Rust WebAssembly module is admitted for an operation only
  when all of these hold:
  1. The operation is over budget on three consecutive runs on `main`.
  2. A TypeScript optimization was attempted and recorded in STATUS.md with
     its numbers.
  3. A spike shows the module at least twice as fast on the reference
     workspace, including the boundary crossing.
  4. The module sits behind the same TypeScript interface and passes the
     same tests, and the TypeScript implementation remains the fallback.
  5. The owner approves the amendment that admits it.

  The module is the `afd-loam` crate (D22, D25).

## 9. Security

- **No secrets.** No secrets, tokens or credentials exist in phase 0. The
  Mock session lives in memory, and the journal redacts any password.
- **Content security policy.** `index.html` carries, as
  `<meta http-equiv="Content-Security-Policy">`:
  - `default-src 'self'`, `script-src 'self'`, `style-src 'self'`;
  - `img-src 'self' data:`, `connect-src 'self'`;
  - `object-src 'none'`, `base-uri 'none'`.

  `frame-ancestors` is not settable from a `<meta>` element; it moves to a
  response header with the hosted lane (phase 6).
- **CSP test.** `test:browser` serves the `vite build` output, not the dev
  server, and fails on any CSP violation reported during its scenarios.
- **Personal data.** Phase 0 inputs carry no personal data beyond the Mock
  email. The `redact` hook is the place phase 3 extends.

## 10. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 0 |
| --- | --- | --- |
| Apps, manifests, loader kinds, scoped registries, the console, the keybindings registry | Phase 1 | The rail and tab bar render an empty list; `LoamKernelV0` is what the SDK wraps; `options.commands` |
| Scope, projects, documents, the URL scheme | Phase 2 | One view-state key per record; the router seam |
| Real identity, persona, the sessions list | Phase 3 | `createKernel({ auth })` takes any `AuthAdapter`; the `redact` hook |
| Settings, experiments, notifications, the overlay manager | Phase 4 | `appearance` as a view-state handler that settings take over; the one-modal rule of 5.3 |
| The copilot, the bus, mounted servers, WebMCP | Phase 5 | `kernel.agent` |
| Hosted server and desktop | Phase 6 | `host` on the kernel options; IndexedDB in the webview (D52); `frame-ancestors` as a header |
| A browser-safe `DirectClient` entry | Before phase 5 | A follow-up; the chrome does not use `DirectClient` |

## 11. Exit criterion and tests

The phase exits when every test below passes on `main` in `loam.yml`, and
STATUS.md records the run.

| # | Criterion (architecture section 9) | Test |
| --- | --- | --- |
| E1 | With no app installed, every layout change is a journaled command | `web` Chromium: drive every handle, chord, compact drawer and sheet, and palette action, plus `view-state-set` on `loam.layout` through `kernel.agent`; after each change, the journal has one new entry for the matching command, and the DOM's part sizes and presence match `layout-get`. Kernel unit: `view-state-set` with an out-of-range width is refused through the shared validator |
| E2 | A replayed journal reproduces the layout | Kernel unit: a scripted session of 50 calls over `MemoryAdapter`, replayed by `replayKernel` with zero differences. `web` Chromium: two Specimen modules render the chrome at a fixed viewport. One runs the 50 calls live; the other replays the committed journal fixture `chrome/specimens/fixtures/session-50.journal.json`. Their observations (geometry and ARIA snapshot) are equal under `diffObservations` |
| E3 | The chrome references semantic tokens only, verified by a lint | `lint:tokens` over `chrome` and `theme` in `loam.yml`; the lint's fixture corpus in `theme`'s `test` |
| E4 | Specimen captures the chrome, and axe passes in light, dark and high contrast in its Chromium suite | `web` Chromium: Specimen captures of each part and of the whole shell in light, dark and high contrast (D53), each with an ARIA snapshot. Axe with the Health dashboard's tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`) on the shell, with the palette open and closed, in each theme and density, plus once under `forcedColors: 'active'`, with zero violations |
| E5 | A narrow viewport shows the bottom tab bar and the drawer | `web` Chromium at 390 × 844: the rail and status bar are absent and `loam-tabbar` is present; Mod+B opens the sidebar drawer as a modal `<dialog>` with focus trapped and then returned; opening the palette closes the drawer first. At 800 and 1280 wide the medium and expanded rules hold, including the inspector's overlay fallback at 1024 with both side parts open at their maximum |
| E6 | Sign-in through the Mock adapter | `web` Chromium: sign in from the title bar; the status bar shows the actor; the `auth-sign-in` entry has no password, and the next entry carries the actor |
| E7 | The shared components on Violet themes | `theme:check` passes, including the fallback scan; `violet-elements`' Chromium suite and the Health dashboard's suites pass unchanged; one `web` test shows `VioletRuntime` with the preloaded source giving the same computed values as the stylesheet |
| E8 | The kernel refuses a bad name | Kernel unit: `createKernel({ commands: [doThing] })`, with a command named `doThing`, rejects with `COMMAND_NAME_INVALID` |
| E9 | Budgets | `budget` passes; A1 to A3 are within budget |
| E10 | Store conformance | `runDataAdapterContract` passes for `IndexedDbAdapter` in Chromium; a second page against the same origin shows the "open in another tab" notice |

## 12. Implementation plan

Each step is one pull request, merged on green. It updates this
specification's status block and STATUS.md before it merges.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: browser stores | `IndexedDbAdapter`, `runDataAdapterContract` at `/testing`, and `IndexedDbJournalSink` with its writer lock; parity rows; changesets | `pnpm check` |
| 0b | Violet: preloaded source and high contrast | [Section 3](#3-units-of-work-in-afd-and-the-foundations-first-d15)'s two runtime changes; provenance | `pnpm check`, `pnpm test:violet`, each Violet package's `lint` |
| 1 | Loam scaffold | The four packages with empty sources, the workspace glob, the inventory entries, `loam.yml` with the steps whose scripts exist (build, typecheck, units, and a Chromium test that the built shell boots under its CSP), the `AGENTS.md` rows, a repository contract test. The `theme:*` and `lint:tokens` scripts arrive with step 2 and `budget` with step 7, each adding its `loam.yml` step; `web`'s `fake-indexeddb` dev dependency arrives with step 7 | `pnpm check`, `loam.yml` |
| 2 | Theme | The Violet tree, the exports, the contract, the contrast checks, `theme:check` (without the fallback scan), the token-only lint with its corpus | `pnpm check`, `loam.yml` |
| 3 | Components onto Violet themes | [Section 2.4](#24-the-shared-components-onto-violet-themes-d50-revising-d28): the export, the generator's new source, the `high-contrast` preset, the retired registries, the fallback scan and the edits it requires, the README, provenance | `pnpm check`, `pnpm test:fast-af`, the Health dashboard's `test:browser`, `loam.yml` |
| 4 | Design document and skill | `design.md`, the `loam-design` skill, `skills/exports.json` | `pnpm check:skills`, `pnpm check` |
| 5 | Kernel | `createKernel`, the two registries, name refusal, the commands, the layout model and its validator, the palette index, the journal options, replay, diff, the test kit | `pnpm check`, `loam.yml` |
| 6 | Specimen high contrast | [Section 4](#4-specimen-with-high-contrast-d53); provenance | `pnpm check`, `pnpm test:specimen` |
| 7 | Chrome and web | The parts, the palette, the chords, the layout classes, the router seam, theme application, the Chromium suite for E1 to E10, and the budget with measured values | `pnpm check`, `loam.yml` |
| 8 | Exit | STATUS.md and this block record the exit run; follow-ups filed | `loam.yml` on `main` |

Order:

- Step 1 comes first.
- Steps 0a, 0b, 2 and 4 then run in parallel; step 2 needs step 1.
- Step 3 needs step 2, step 5 needs steps 0a and 1, and step 6 needs nothing
  but `main`.
- Step 7 needs steps 0b, 3, 5 and 6.

## Amendments to the architecture and the decision log

This pull request adds to the [decision log](../../decisions.md):

- **D50, revising D28.** The shared components take Violet themes as data
  and custom properties, never as a package dependency, because the
  boundary rule forbids a foundation from requiring another family.
  - `violet-elements` generates its presets from a committed export of
    Loam's resolved themes (`tokens/violet-theme.export.json`), and its
    literal fallbacks are checked against the light theme.
  - Its local registries are retired.
  - Loam's theme package writes and checks the export.
  - `VioletRuntime` gains a preloaded source, so consumers may apply a
    Violet theme at runtime with no token server.
- **D51.** `appearance` (theme and density) and `palette` join the shell
  domains in phase 0. Phase 4's settings take over appearance's storage
  without changing its commands.
- **D52.** The desktop's store backend is IndexedDB in the webview, the
  same as the browser. SQLite through a Tauri plugin is admitted in phase 6
  only on a measurement.
- **D53.** Specimen gains a `high-contrast` theme context, emulated with
  `prefers-contrast: more` on a light color scheme, so the chrome's captures
  cover the three themes. Forced colors and axe stay in Loam's Chromium
  suite.

The architecture is amended:

- **Section 4** (design foundation row) and **section 9** (phase 0 row)
  say the components consume Violet themes "as Violet's exported custom
  properties" per D50, not "through the runtime".
- **Section 5**'s domain list gains `appearance` and `palette`. Its
  minimum shell commands gain `appearance-get`, `appearance-set`,
  `palette-open`, `palette-close`, `palette-search` and `shell-info-get`.
- **Section 8**'s workspace glob reads `endpoints/loam/packages/*`, with
  D14's consequence noting the same.

## Review 2026-11-01

An independent review of the first draft, against the code it cites,
returned 18 findings. Each is addressed in the text above:

1. **The auth middleware** refuses signed-out calls. Fixed with `exclude`
   (6.5).
2. **Journal coverage.** The journal's defaults skipped failures and
   `auth-*`, and schema failures never reach middleware. The options are
   now explicit, and range checks live in the handler (5.2, 6.4).
3. **Interfaces.** A direct registry serves one interface, so there are two
   registries over shared middleware (6.1).
4. **Provenance.** The test cannot record deletions, so the old registries
   are retired in place (2.4).
5. **The JSON shapes.** Violet's JSON export and the runtime's `Token[]`
   differ. Exports are rendered by the theme package with pinned shapes, and
   the CSS override diff and exclusions are specified (2.3, 2.4).
6. **The literal fallbacks** in 42 component files are checked against the
   light theme. The defaults file is not generated (2.4).
7. **The kernel options** lacked seams. Added `environment`, `storeKind`,
   `commands`, `createPaletteIndex`, and `LAYOUT_DEFAULTS_V0` checked
   against the tree (2.1, 6.2).
8. **The view-state bypass.** `view-state-set` on `loam.layout` could skip
   the constraints. It now goes through the shared validator and is part of
   E1 (5.2, 11).
9. **Replay.** It starts at `seq` 1, flushes on `pagehide`, ignores
   environment-dependent results, and compares two Specimen modules (5.2,
   6.4, 11).
10. **Specimen.** The bench mapped `theme` to `colorScheme`. High contrast
    is now light plus `contrast: 'more'`, every Specimen file that changes
    is named, and forced colors is tested separately (4).
11. **The lint** rejected the spec's own CSS. Relative units and the state
    properties are now allowed, and a drawer token was added (2.1, 2.7).
12. **The focus width** had no token. Added `shell.size.focus` (2.1, 2.2).
13. **The bundle budget.** The `violet-elements` root import costs the
    whole set, so deep imports are mandated and checked (7, 8.1).
14. **IndexedDB ownership.** Each class owns its database, a writer lock
    covers a second tab, and the contract suite is reused from local-db
    (3, 6.6).
15. **The CSP.** `frame-ancestors` cannot be set from `<meta>`, so it moved
    to phase 6, and the tests run against the build output (9).
16. **D50 against D28.** D50 is marked as revising D28, and the
    architecture rows are amended.
17. **The workspace glob** is amended in the architecture and D14.
18. **Lesser findings:**
    - the A3 function is defined;
    - the sign-in input is exact;
    - the auth commands' subpath and the `cli` override are covered;
    - the inventory fields are complete;
    - `theme:export-components` is listed, and `theme:check` compares only
      committed files;
    - step order and `web`'s dev dependencies are corrected;
    - the modal policy is set;
    - the keybinding source and the `matches` field are pinned.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Phase 0 specification | A browser-safe `DirectClient` entry in `@lushly-dev/afd-client`, needed by the copilot in phase 5. There is no subpath today, and the root loads the MCP client and `eventsource` | Open |
| 2026-11-01 | Phase 0 specification | Specimen running axe itself, so the chrome's checks need no second harness | Open; not needed for phase 0 |
| 2026-11-01 | Phase 0 review | A deletion classification in `scripts/fast-af-provenance.test.mjs`, so retired imported files can be removed rather than emptied | Open |
| 2026-11-01 | Phase 0 specification | Lushly's own Violet tree for the shared components, specified in Lushly's repository (D28, D50) | Open; Lushly owns it |
| 2026-11-01 | Phase 0 step 2 | The resting field border, `color.field.border` (an alias of `color.border.subtle`), is 1.2:1 on the field background in light and 1.4:1 in dark, under WCAG 1.4.11's 3:1 for a field's boundary. Raising it changes every input's look, so it is a design decision for step 4's design document, not a value step 2 changes | Decided 2026-11-01 by step 4: it must meet 3:1, because nothing else identifies the field (its background is the page surface). The exact values are in the [design document's history](../../design.md#history): `color.field.border` aliases `color.border.strong` in light and dark (3.06:1 or more), `color.field.border.hover` becomes `rgba(28, 26, 13, 0.64)` and `rgba(255, 248, 235, 0.52)` in dark, `color.field.border.invalid` aliases `color.state.danger.text`, high contrast keeps today's values, `pairs.ts` holds the resting and invalid borders in every theme, and the eight field components draw their resting border from `color.field.border` instead of `color.border.subtle`. Open: one pull request for the theme and the components, with or after step 3 |
| 2026-11-01 | Phase 0 step 5 | The kernel's esbuild browser bundle is 520,541 bytes against the 150,000-byte ceiling of 8.1, almost all Zod (section 8.1); step 7 decides how the budget holds before it adds `budget` | Open; step 7 |
| 2026-11-01 | Phase 0 step 4 | WCAG 2.2's 2.5.7 asks for a single-pointer alternative to dragging a resize handle; section 7 gives the handle keyboard steps only, which do not count. Step 7 decides the pointer alternative and records it in the design document | Open |
| 2026-11-01 | Phase 0 step 4 | Contract version 2 candidates: a font-family id (the chrome declares the shared components' stack until then) and a focus-width id that components outside the chrome can read (`shell.size.focus` is chrome-only) | Open; not needed for phase 0 |
