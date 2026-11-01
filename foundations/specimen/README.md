# Specimens

Experimental native component observation bench. A separate `@lushly-dev/specimen-afd` integration exposes `specimen-list`, `specimen-validate`, `specimen-render`, `specimen-run`, `specimen-diff` and `specimen-build` through the validated definitions shared by the `@lushly-dev/specimen-cli` JSON endpoint and available to MCP hosts.

It captures actual Chromium geometry, selected computed styles, native control state, open-shadow DOM and ARIA snapshots. These observations detect changes that identical DOM markup can conceal. Each render gets a new browser context and registry; declared readiness and cleanup run before the environment is discarded.

The package is the feasibility milestone of the [Specimens proposal](../../docs/features/proposed/specimens/specimens.proposal.md). Storybook migration, the full runner, schema coverage, axe, token dependencies, event history, plugins and pixel comparison remain later work. This package does not establish that removing Storybook is safe.

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
  "preview": ".storybook/preview.ts"
}
```

Each `stories` entry is a glob, directory, file or `{ "directory", "files", "titlePrefix" }`, read as Storybook's `stories` entries are, relative to the configuration file. Extended globs such as `@(a|b)` are rejected; use braces.

The native host reads the files statically, without running them, and lists each story with the id, title, name and tags Storybook's index gives it. A story's entry also says whether it has a play, which annotations it sets, and which values only running it can settle.

Discovery that fails makes `list()`, `render()` and `build()` throw. It fails on an unreadable file, a dynamic title, duplicate ids or an incomplete export order. `validate()`, `specimen-validate` and `specimen validate [--id ID | --file PATH]` report each problem with a suggestion. They also report annotations compatibility mode does not run, such as `loaders` or `beforeEach`, and values that are deferred to runtime.

`render()` captures a retained story, and `run()` (`specimen-run`, `specimen run ID`) runs it as Storybook's Vitest addon does:
1. Compose the project, meta and story annotations with Storybook's field-specific rules.
2. Settle the story's viewport from `globals.viewport` and its theme from the project's theme global. Media keep the browser's defaults: the manifest records `themeMedia: 'browser-default'`.
3. Render through the decorators into a plain `div` canvas.
4. Run the play.
5. Run the accessibility check with axe-core 4.13.0 over the body, under the story's `parameters.a11y` policy.

A run reports `passed`, `failed` (by `render`, `play` or `a11y`), `skipped` or `excluded`. `test: { include, exclude, skip }` in the configuration selects stories as the addon's `tags` option does. A story that relies on something the runtime does not reproduce fails rather than running without it. See the [T05 record](../../docs/features/active/specimens/t05-compatibility.md).

## Build a review page

```sh
node endpoints/specimen-cli/dist/bin.js --root foundations/specimen/fixtures build /tmp/specimen-static
python3 -m http.server 4173 --directory /tmp/specimen-static
```

The output directory must be empty. Open `/index.html` for the metadata index, or `/specimen.html?id=baseline&viewport=375x812&theme=dark` for a preview. The page also reads `container` (`WIDTH` or `WIDTHxHEIGHT`), `locale`, `reducedMotion` and `motion`. A selected viewport uses a sized iframe so width media queries, viewport units and `innerWidth` reflect its actual dimensions. Each case loads through a separate dynamic import. The shell budget is **50,000 minified UTF-8 JavaScript bytes**, counting its emitted/static dependencies. `specimen-build.json` reports each JavaScript chunk as shell or consumer code. Interaction-library and axe budgets from the proposal are still untested because those integrations are not included yet.

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
- The selected style/geometry scope is accessible light DOM and open shadow roots. HTML-construction tracking observes the initialized specimen realm and reads genuine `TrustedHTML` (as FAST and Lit assign it) through the native stringifier; other non-string HTML stays opaque rather than being converted a second time; pre-existing or untouched foreign-realm closed roots cannot be retrospectively identified. Closed roots, raster content, pseudo-element geometry and running animations carry limitations. Natural animations make layout/style evidence partial; request `motion: 'settled'` programmatically for an explicitly suppressed sample. The media preference for reduced motion remains separate.
- ARIA snapshots come from Chromium's own accessibility tree (capture version 0.2), in the indented YAML form of Playwright's ARIA snapshots: `- role "name" [state]`, text as `- text:` lines, with generic containers and Chromium's internal roles flattened and a text field's value written after its name. Roles and names are Chromium's, so an unnamed `<form>` appears as `form`. Axe is reported as `not-run`; no empty violation list stands in for an axe check. Token dependencies and event history are explicitly unsupported.
- Screenshots are review artifacts. `requireVisual: true` always returns insufficient evidence until pixel comparison exists, even when both screenshot paths are present.
- Normalization preserves whitespace and authored identifiers. Only ids exactly matching `specimen-generated-N` are canonicalized, together with references in the same tree scope. Broken relationships remain observable.
- Comparison rejects incompatible browser/version/context/checkpoint captures. An intentional context axis must be declared explicitly. Differing dependency identities are reported as an attribution limit.

The static preview applies the theme attribute, CSS `color-scheme` (`light` for high contrast), `lang`, container and motion mode. An iframe cannot emulate `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` or `navigator.language`, so those follow the viewer's browser: the page shows a notice whenever they differ from the requested context, and a capture taken there reports each difference as a `Context mismatch` limitation. A bench render applies all of them. The [driver comparison](../../docs/features/active/specimens/driver-context-validation.md) records which values each driver gives a specimen.

## Native host

Rendering runs in `specimen-host`, a Rust binary in [`host/`](host). It bundles the bench page and each case with Rolldown, serves every bundle generation from memory on 127.0.0.1 (each render under its own path, so the source digest names exactly the files that render loaded), and drives Chromium's headless shell over CDP through `--remote-debugging-pipe`. Pages get the environment Playwright 1.64 gives them: the same launch switches, default font families and context emulation. A changed source file rebuilds the bundle before the next render.

The bundle follows Vite's import forms: `.css` imports inject a style element, `?inline` CSS and `?raw` files import as strings, `?url` imports resolve to the file's served path, and a stylesheet's relative `@import`s and `url()`s resolve against the stylesheet. Other import queries are rejected. A module that fails to bundle fails only the specimens that use it, and fixing it rebuilds the bench. Selector targets are CSS selectors; Playwright's own selector syntax (`text=`, `>>`, `:has-text()` and the like) is rejected.

Build it with `pnpm -F @lushly-dev/specimen build:host` (rustup installs the pinned Rust 1.98.0). The bench looks for `host/target/release/specimen-host` beside the package, or `SPECIMEN_HOST_BINARY`, and for Playwright's installed headless shell unless `executablePath` is given. The host supports macOS and Linux; Windows is not supported yet. Packaging prebuilt hosts is publication work and has not been done.

The host owns Chromium's process group. Each render is bounded by its deadline, from context creation to capture; disposal and closing the context are each bounded by at most one second more. Bundling and Chromium's startup, which is bounded at 10 seconds, come before the deadline, as the earlier runtime's bundle step and browser launch did. Close waits for accepted renders, then stops the browser group, and losing the host's owner stops it at once. Chromium inherits only its CDP pipe, so if the host itself is killed the browser sees the pipe close and exits; the bench also kills the browser group when the host exits unexpectedly, and fails a request the host does not answer in time.

## Validation

`pnpm -F @lushly-dev/specimen test:browser` builds the host, then runs the full native suite: unit, resource-collector, process-worker and Chromium integration tests. It then runs the reference driver (`vitest.reference.config.ts`): the same browser runtime inside Vitest browser mode, the harness the consumers' Storybook Vitest addon uses. Chromium must be installed (`pnpm -F @lushly-dev/specimen exec playwright install chromium`) and the Rust toolchain available; missing binaries are failures, not skipped acceptance. The host's own format, lint and tests run in `foundations/specimen/host` (`cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked`). The repository-wide `pnpm test` and `pnpm check` run only the browser-free subset (`pnpm -F @lushly-dev/specimen test`, see `vitest.unit.config.ts`); the full suite and the packed-artifact consumers run in the path-filtered `specimen.yml` workflow. The adapter and CLI retain their tests in their own packages. `src/compat.test.ts` runs Storybook 10.6.2's own indexer over the `compat/` fixtures as the reference, and `src/compat-run.test.ts` runs its Vitest addon over the same stories and requires every outcome to match; Storybook is a development dependency only. Browser-runtime coverage comes from those real-browser assertions; the Node V8 coverage report excludes browser-only modules because they execute in a different process.

Read [current status](../../docs/features/active/specimens/STATUS.md) for verified progress, known gaps and delivery state, then the [implementation plan](../../docs/features/active/specimens/implementation.md) for ordered tasks and the remaining acceptance gates.

The [warm CPU investigation](../../docs/features/active/specimens/cpu-hotspot-validation.md) records a development-server sourcemap optimization and its separate diagnostic and ordinary resource measurements. Existing maps and source invalidation remain covered by HTTP/browser regressions.

The opt-in [real consumer probes](experiments/README.md) exercise actual FAST-AF and Lushly source with recorded dependency limitations. They are separate from the self-contained package suite and do not establish retained-CSF parity.

## Unreleased package split

The selected feasibility source was never admitted for publication. The imported native package keeps version 2.2.0 while its AFD bindings and CLI move to separate distributions. This is a reviewed source transition, not permission to publish 2.2.0 or overwrite a released artifact. See [the split transition](../../docs/features/active/platform-monorepo/specimen-transition.md).

Install `@lushly-dev/specimen` for the native API. It requires no AFD, FAST-AF, or Violet runtime, peers, configuration, or install hooks. Native validation contracts are available from `@lushly-dev/specimen/schema`. Install the separate `@lushly-dev/specimen-cli` endpoint for the `specimen` command, or `@lushly-dev/specimen-afd` with compatible AFD core/server packages for commands/MCP composition. The endpoint may install those foundations for its own operation; inspected applications do not need them.
