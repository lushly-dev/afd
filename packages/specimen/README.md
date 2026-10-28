# Specimens

Experimental component observation bench built on AFD. This first implementation exposes `specimen-list`, `specimen-render`, `specimen-diff` and `specimen-build` through the same validated definitions used by the JSON CLI and available to MCP hosts.

It captures actual Chromium geometry, selected computed styles, native control state, open-shadow DOM and ARIA snapshots. These observations detect changes that identical DOM markup can conceal. Each render gets a new browser context and registry; declared readiness and cleanup run before the environment is discarded.

The package is the feasibility milestone of the [Specimens proposal](../../docs/features/proposed/specimens/specimens.proposal.md). Storybook migration, full CSF discovery, schema coverage, axe, token dependencies, event history, plugins and pixel comparison remain later work. This package does not establish that removing Storybook is safe.

## Run the fixtures

From the repository root, using the Node version in `.nvmrc`:

```sh
pnpm install --frozen-lockfile
pnpm -F @lushly-dev/afd-core -F @lushly-dev/afd-server -F @lushly-dev/specimen build
pnpm -F @lushly-dev/specimen exec playwright install chromium
node packages/specimen/dist/bin.js --root packages/specimen/fixtures list
node packages/specimen/dist/bin.js --root packages/specimen/fixtures render baseline --output /tmp/specimen-left.json
node packages/specimen/dist/bin.js --root packages/specimen/fixtures render padded --output /tmp/specimen-right.json --screenshot /tmp/specimen-right.png
node packages/specimen/dist/bin.js diff /tmp/specimen-left.json /tmp/specimen-right.json
```

Every command emits one `CommandResult` JSON value on stdout. Errors use stderr for diagnostics and a nonzero exit code. Capture files may contain raw observations or successful command-result envelopes. Output paths are resolved relative to `--root`; absolute paths work as shown. `diff` does not need a project or browser.

Use `--viewport 375x812`, `--container 320x600`, `--theme dark` or `--checkpoint hovered` with `render`. Viewport changes the browsing context; container constrains the mount element inside it. The `interactive` fixture exposes `hovered` and `focused` checkpoints. By default rendering stops at `mount`; `after-run` executes all supported scenario steps. The feasibility runner supports named click, focus, hover, fill and capture steps, using real Playwright input.

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

## Build a review page

```sh
node packages/specimen/dist/bin.js --root packages/specimen/fixtures build /tmp/specimen-static
python3 -m http.server 4173 --directory /tmp/specimen-static
```

The output directory must be empty. Open `/index.html` for the metadata index, or `/specimen.html?id=baseline&viewport=375x812&theme=dark` for a preview. A selected viewport uses a sized iframe so media queries and viewport units reflect its actual dimensions. Each case loads through a separate dynamic import. The shell budget is **50,000 minified UTF-8 JavaScript bytes**, counting its emitted/static dependencies. `specimen-build.json` reports each JavaScript chunk as shell or consumer code. Interaction-library and axe budgets from the proposal are still untested because those integrations are not included yet.

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

`createSpecimenCommands(bench)` returns MCP-exposed AFD definitions suitable for `createMcpServer({ commands })`. CLI and programmatic command execution validate the same inputs and outputs. Browser resources and Vite's local server remain owned by the bench and must be closed by its caller.

## Interpret the evidence

- `changed` means a difference was observed in compatible DOM, ARIA, layout, selected styles or live state. `no-change-observed` is restricted to that scope. Partial required channels yield `insufficient-evidence`, with observed differences retained.
- Captures bind a source revision/dirty status when Git is available, a digest of the configuration and loaded page/module/style responses, a nearest lockfile digest, browser version, effective context and checkpoint. Streaming application traffic is excluded from that source digest and cannot hold readiness open. The loaded-resource digest is not a snapshot of every unused project file or proof of all external resources.
- The selected style/geometry scope is accessible light DOM and open shadow roots. HTML-construction tracking observes the initialized specimen realm; pre-existing or untouched foreign-realm closed roots cannot be retrospectively identified. Closed roots, raster content, pseudo-element geometry and running animations carry limitations. Natural animations make layout/style evidence partial; request `motion: 'settled'` programmatically for an explicitly suppressed sample. The media preference for reduced motion remains separate.
- ARIA snapshots are collected. Axe is reported as `not-run`; no empty violation list stands in for an axe check. Token dependencies and event history are explicitly unsupported.
- Screenshots are review artifacts. `requireVisual: true` always returns insufficient evidence until pixel comparison exists, even when both screenshot paths are present.
- Normalization preserves whitespace and authored identifiers. Only ids exactly matching `specimen-generated-N` are canonicalized, together with references in the same tree scope. Broken relationships remain observable.
- Comparison rejects incompatible browser/version/context/checkpoint captures. An intentional context axis must be declared explicitly. Differing dependency identities are reported as an attribution limit.

The static page's Theme control applies CSS color-scheme and theme attributes. Forced browser/OS media preferences can still differ; parity of `prefers-color-scheme` across the static UI and the CLI's browser emulation remains part of the later driver gate.

## Validation

`pnpm -F @lushly-dev/specimen test` runs unit, command/CLI and Chromium integration tests. Chromium must be installed; missing binaries are failures, not skipped acceptance. Browser-runtime coverage comes from those real-browser assertions; the Node V8 coverage report excludes browser-only modules because they execute in a different process.

See [implementation status](../../docs/features/active/specimens/implementation.md) for the current acceptance boundary and remaining proposal gates.
