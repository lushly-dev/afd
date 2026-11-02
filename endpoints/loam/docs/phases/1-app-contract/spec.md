# Phase 1 specification: app contract

| Field | Value |
| --- | --- |
| Phase | 1, app contract ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review; the phase 1 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 0 specification](../0-kernel-chrome/spec.md), the [architecture](../../architecture.md), the [decision log](../../decisions.md) and the [shared plugin manifest proposal](../../../../../docs/features/active/plugin-manifest/plugin-manifest.proposal.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-01 and revised the same day after an independent
  review (see [Review](#review-2026-11-01)). Approved 2026-11-01 by the coordinator
  under the owner's delegation, after that review (D17). Implementation is in progress: steps 0a, 0b, 1,
  2, 3, 4 and 5 are merged, and each step's state is one line in STATUS.md's phase 1 block.
- **Last verified:** 2026-11-01 against `main` at `d74f1299`, and for the manifest's
  step 1 at `9be3ad12`. Evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `types.ts:13-29` (`LoamKernelV0`, `options.commands` at `:64`);
    - `kernel.ts:103-126` (name refusal), `:177-185` (extra commands keep their
      own `expose`), `:190-193` (middleware order: auth, then journal),
      `:196-206` (two registries built once), `:215-252` (`run`);
    - `commands.ts:45-69` (`SHELL_EXPOSE`, `SHELL_COMMAND_NAMES`);
    - `keybindings.ts:20-27` (the frozen reserved chords);
    - `testing.ts:109-130` (`replayKernel`).
  - **Chrome:** `endpoints/loam/packages/chrome/src`:
    - `elements/app-nav.ts:15-34` (the rail and tab bar hold only the disabled
      settings entry);
    - `elements/main.ts:11-35` (the landing and not-found page);
    - `elements/shell.ts:118`, `:371-436`, `:498-505` (the sidebar's empty
      state, boot, the re-reads);
    - `router.ts:7`, `:59-73` (two routes, the Navigation API seam);
    - `define.ts:27-41`, `:54-62` (global registration under `loam-`).
  - **Web host:** `endpoints/loam/packages/web`:
    - `index.html:5-8` (the static CSP, `connect-src 'self'`, no `frame-src`);
    - `src/host.ts:60-91`, `src/main.ts:12-21`;
    - `test/browser/harness.ts:18-45` (`serveDist`);
    - `scripts/budget.mjs:28` (`CEILINGS`);
    - `vite.config.ts`.
  - **FAST-AF:** `foundations/fast-af/packages/element/packages/fast-element/src`:
    - `scoped/detection.ts:34-58` (`supportsScopedRegistries`),
      `scoped/registry.ts:11-27` (a FAST definition defined into any registry,
      idempotent per registry), `scoped/index.ts`;
    - `components/element-controller.ts:864-870` (a scoped host renders its
      template against its registry);
    - `components/fast-definitions.ts:560-588`;
    - `package.json:210` (the polyfill dependency of D34).
  - **Violet elements:** `foundations/fast-af/packages/violet-elements/src`: the
    component directories (`button`, `text-field`, `text-area`, `checkbox`,
    `select`, `option`, and the rest), and the 16 `system-*` icons in
    `icon/generated/icons/`.
  - **AFD client:** `packages/client`:
    - `package.json:5-11` (one root entry);
    - `src/index.ts`, `src/transport.ts:7` (the root imports `eventsource`);
    - `src/streamable-http-transport.ts:15-19`, `:158-196` (`send` serves
      `initialize`, `tools/list` and `tools/call` only).
    - Measured 2026-11-01 with esbuild 0.27, browser platform and conditions:
      the SDK's `Client` and `StreamableHTTPClientTransport` bundle to 324,094
      bytes minified, 87,889 gzip, with no `new Function` and no `eval`; the
      SDK's browser shim uses the `@cfworker/json-schema` validator
      (`@modelcontextprotocol/client` 2.4.0, `dist/shimsBrowser.mjs`).
  - **AFD adapters:** `packages/adapters/src`:
    - `utils.ts:27-37` (`styledSpan` writes a `style` attribute, which
      `style-src 'self'` refuses);
    - `utils.ts:15-22` (`escapeHtml`), `web-adapter.ts:252-283`
      (`renderCommandResult`).
  - **AFD server:** `packages/server/src`:
    - `direct-registry.ts:340-376` (a registry is fixed when built; a duplicate
      throws), `:285-310` (`isExposedTo`);
    - `schema.ts:28-147` (`ZodCommandOptions`, `advertisedInputSchema`,
      `toolMeta`);
    - `journal.ts:113-135`, `journal-replay.ts:21-28`, `:76-96`.
  - **AFD core:** `packages/core/src`: `commands.ts:25-40`
    (`validateCommandName`), `:58-75` (`ExposeOptions`, `defaultExpose`);
    `journal.ts:59-90` (`JournalEntry.context`).
  - **AFD testing:** `packages/testing/src/surface/validate.ts:186`,
    `surface/types.ts:326-335` (`validateCommandSurface`).
  - **AFD specification:** `spec/context-fields.md`, `spec/journal.md`,
    `spec/mcp-resources.md` (R2, T2), `spec/command-metadata.md`,
    `spec/tool-strategies.md` (H7, H8), `spec/meta-tools.json`.
  - **Umbel:** `endpoints/umbel`:
    - `src/main.rs:13-17` (the stock binary compiles in no plugin);
    - `src/surfaces/http.rs:1-6`, `:30-44`, `:121-164` (the bearer layer runs
      first, on every request);
    - `src/cli/parse.rs:57-70` (`serve --http --bind --print-token`),
      `src/cli/serve.rs:67-68` (the `umbel listening on` line);
    - `src/workspace/mod.rs:92-123` (`init`), `src/workspace/config.rs:1197`
      (loopback only);
    - `src/plugins/mounted/naming.rs:3-16` (the renaming rule),
      `tests/mount_naming.rs`;
    - `src/commands/event_ack.rs:80-95` (`event-ack`, a mutation exposed to MCP);
    - `plugins/hello/manifests/mounted.toml`,
      `plugins/hello/schemas/hello-greet.input.json`,
      `plugins/hello/src/bin/hello-mcp.rs`;
    - `tests/support/mounted.rs:77-84` (`hello_dir`), `tests/process.rs:308-325`
      (`--bind 127.0.0.1:0`), `tests/hello_three_ways.rs`;
    - `.github/workflows/umbel.yml:101-114`;
    - `packages/rust/src/server.rs:135-155`, `:805-815` (an AFD server refuses an
      `Origin` it was not told about, and passes a request with none).
  - **Repository tooling:** `.github/workflows/loam.yml`,
    `scripts/affected/scope.mjs:34-39`, `scripts/affected/suites.mjs:81-89`,
    `scripts/repository-contract.test.mjs:227-250`,
    `scripts/check-boundaries.mjs:44`, `pnpm-workspace.yaml:9`,
    `scripts/release/inventory.json:535-553`,
    `endpoints/health-dashboard/tooling/report-validator.ts:32-41`.
  - **The manifest's step 1:** merged in [#677](https://github.com/lushly-dev/afd/pull/677) as `9be3ad12`:
    [`spec/plugin-manifest.md`](../../../../../spec/plugin-manifest.md),
    `spec/plugin-manifest.core.v1.json`, `spec/plugin-manifest.json`,
    `scripts/plugin-manifest.test.mjs`, and its corrections to the proposal's Loam sketch. Where
    the proposal and that page differ, this specification follows the page.
  - **Outside the repository:** the MCP Apps specification 2026-01-26 and its
    development draft
    ([`specification/2026-01-26/apps.mdx`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)),
    read 2026-11-01; `@modelcontextprotocol/ext-apps` 2.0.4 on npm. See
    [Trajectory refresh](#trajectory-refresh).
- **Done:** this specification, and the steps STATUS.md's phase 1 block marks merged. Step 2 delivered
  `@lushly-dev/loam-sdk` and `@lushly-dev/loam-cli`, the `rules` cases that need files and E13's CLI
  part; [11.2](#112-decided-by-step-2) records what it decided. Step 3 delivered kernel interface 1,
  `kernel/src/apps/` for native and view, `@lushly-dev/loam-testing`, E8 and the kernel unit of E9;
  [9.5](#95-decided-by-step-3) records what it decided. Step 4 delivered the chrome's app surfaces, the web
  host's deployment read, hello native and tally, E1, E5, E6, E7's browser part, E9's Chromium part and E11
  so far, with hello's own scenario and `app check` on it for E8 and E13; [9.6](#96-decided-by-step-4) records
  what it decided. Step 5 delivered the proxy, `loam-view-frame`, the broker, the handler frame, hello view and E2 with
  its conformance fixture; [9.7](#97-decided-by-step-5) records what it decided and what the browser disproved.
- **Not done:** the rest of the [implementation plan](#15-implementation-plan). E11's console part waits for
  step 6, and E9's mounted part for step 7.
- **Depends on:** step 1 of the plugin manifest proposal, merged in
  [#677](https://github.com/lushly-dev/afd/pull/677). The proposal says that step "lands before Loam's phase 1
  specification is approved, or in the same pull request", which holds.
- **Follow-ups:** see [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:**
  - 2, apps are the unit;
  - 3, everything is a command;
  - 4, opt-in surfaces, nothing inherited;
  - 6, overlays have owners;
  - 9, layout is data;
  - 10, one library, scoped registries;
  - 12, apps are web components, and the SDK is the whole contract;
  - 14, every mutation is an event;
  - 15, AFD first.
- **Decisions:**
  - D2, D7 and D18 for manifests, surfaces, layout and names;
  - D6 for overlays, in the part phase 1 needs;
  - D9 for the three kinds, D10 and D58 for the manifest;
  - D15 for AFD first, D16 and D17 for status and approval;
  - D21 for the SDK boundary, D25 for TypeScript;
  - D34 for the polyfill;
  - D48 for the console;
  - D54 for native trust, D55 and D56 for instances, D57 for the Umbel proof.
- **New decisions this specification proposes:** D59 to D68, listed in
  [Amendments](#amendments-to-the-architecture-and-the-decision-log) and added to
  the decision log by this pull request. The coordinator approves them by
  approving the specification. None changes a trust model or D54 to D58.
- **It decides L1 to L10** of the plugin manifest proposal:

  | Question | Decision | Where |
  | --- | --- | --- |
  | L1 | `loam-app.toml` for authors, `app-manifest.json` at runtime | D59, [2.1](#21-files-and-encoding) |
  | L2 | `native`, `view`, `mounted` | D59, [2.2](#22-the-profile) |
  | L3 | AFD's defaults for app commands; the instance entry for mounted ones | D65, [2.2](#22-the-profile), [7.4](#74-exposure-and-trust) |
  | L4 | `error`, against the shell and across apps | D66, [10](#10-failure-modes-and-error-codes) |
  | L5 | A module beside the view, in a sandboxed handler frame | D61, [6.3](#63-the-handler-frame) |
  | L6 | The deployment file's `[apps.<instance>]` entries | D63, [3](#3-the-deployment-file) |
  | L7 | Always same-origin; the static CSP gains no instance origin | D64, [7.1](#71-how-a-browser-reaches-an-instance) |
  | L8 | Warn | D66, [2.4](#24-rules-beyond-the-schema) |
  | L9 | Pinned | D65, [7.5](#75-a-mapped-space-is-pinned) |
  | L10 | Display and defaults; an unreported command is a mutation; the entry overrides | D65, [7.4](#74-exposure-and-trust) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-01:

| Row | Recorded | Now | Effect on phase 1 |
| --- | --- | --- | --- |
| W1 | MCP Apps 2026-01-26 stable, draft open | Unchanged: the only dated version is 2026-01-26, with `draft` beside it; `@modelcontextprotocol/ext-apps` is at 2.0.4 (2026-10-27). The draft softens the proxy's two `ready` steps from MUST to SHOULD and keeps the rest of the section | Phase 1 pins 2026-01-26: `text/html;profile=mcp-app`, `_meta.ui.resourceUri`, and the web-host rule that **a sandbox proxy has a different origin from the host, with `allow-scripts allow-same-origin`**. This was not in the architecture, and D62 records it |
| W2 | Serving resources from AFD servers not implemented | Done: Rust #608, TypeScript #615; the in-process registry serves none | Phase 1's packaged views need no AFD resource server. Views served by a mounted server wait for phase 5 ([13](#13-out-of-scope-and-the-seams-reserved)) |
| W3 | Scoped registries in all three engines (Firefox 159, 2026-10-27) | MDN still marks the constructor "limited availability" and gives no Baseline; Firefox 159 was not re-confirmed from a primary page | D34's polyfill path stays. `loam.yml` is Chromium only, so phase 1 proves Chromium; a follow-up runs the mount suite in Firefox and WebKit |
| W6 | Precommit handler missing in Safari | Not re-checked; phase 1 adds no route | None |
| W13 | Agent Skills in shells | Not re-checked; skills are admitted and listed, served from phase 5 | None |
| R6 | Versioned surface ids and a removal rule | Taken up: the catalog carries one version, and removal needs a new `manifest_version` ([4.1](#41-the-catalog-version-1)) | |
| R7 | Native apps as ES modules under import maps | **Revised by D60.** An inline import map is a script under `script-src 'self'` and needs a hash in the CSP, and exposing shared chunks under stable names risks the first-paint budget, which leaves 94% used. The entry is a self-contained ES module; the bundler-free contract holds, and an import map stays a seam | [5.1](#51-the-entry) |
| New | Signing | The owner decided on 2026-11-01 that signing waits, and that Loam adds a row. D58's "W9" is Umbel's row; Loam's own W9 is about Rust frontends | W29 added, naming Umbel's W9 |
| New | Browsers restricting a public page calling loopback | Chrome's Local Network Access gates such requests behind a permission since 142, split into `local-network` and `loopback-network` in 145 ([Chrome](https://developer.chrome.com/blog/local-network-access), [intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/Zl3P6NHhMBw)). Firefox and Safari not found | One more reason for D64; W30 added, closing the proposal's follow-up for now |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary).
This specification adds:

| Term | Meaning |
| --- | --- |
| Profile | Loam's closed schema for one manifest version, conforming to the plugin manifest core |
| Package | A directory holding `app-manifest.json` and the files it names; what `loam app pack` writes and a deployment lists |
| Deployment file | The deployer's `loam.deployment.toml`: phase 1's workspace app list, with every instance entry |
| Browser projection | `deployment.json`, written from the deployment file, with no location, credential or command line in it |
| Mount | The shell-provided `loam-mount` element whose shadow root an app's surface renders into, under the app's scoped registry. Never the manifest's `mount` table, which is the MCP mount (C9) |
| Handler frame | A hidden sandboxed iframe that runs a view app's command handlers |
| Sandbox proxy | The page on a second origin that hosts a view's iframe, as MCP Apps requires of a web host |
| Mount relay | The same-origin server route a browser host reaches an instance through. Phase 1 has a test-only one; the hosted lane serves the real one |
| App port | The kernel's object for one app instance, through which the SDK's client calls |

## 1. Units and repository placement

Five new TypeScript packages and two apps, all private and quarantined:

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/packages/manifest/` | `@lushly-dev/loam-manifest` | `app-manifest.v1.json`, `deployment.v1.json`, `projection.v1.json`, generated types, standalone validators, the readers and refusals, the catalogs, and the two layout and chord constants the rules need, which the kernel re-exports. No DOM, no Node.js builtin in its root or `/validate` | `zod` and `ajv`'s `dist/runtime` helpers (`/validate` only); build-time: `ajv`, `json-schema-to-typescript`, `spec/plugin-manifest.core.v1.json` |
| `endpoints/loam/packages/sdk/` | `@lushly-dev/loam-sdk` | The public contract: `defineApp`, the context and client types, the overlay types, the surface element contract; `/view` for sandboxed code. It depends on no kernel, and the kernel takes its types from here | `@lushly-dev/loam-manifest` (types), `@lushly-dev/afd-core` |
| `endpoints/loam/packages/testing/` | `@lushly-dev/loam-testing` | The test kit an app's own tests use: `createAppTestKernel`. Part of the SDK contract for authors, and its own unit because it needs the kernel, which depends on the SDK | `@lushly-dev/loam-sdk`, `@lushly-dev/loam-kernel`, `@lushly-dev/afd-core`, `@lushly-dev/local-db` |
| `endpoints/loam/packages/console/` | `@lushly-dev/loam-console` | `loam-console`: the command list, forms from input schemas, results through the adapters. It binds to the SDK's client only | `@lushly-dev/loam-sdk`, `@lushly-dev/afd-adapters`, `@lushly-dev/fast-element`, `@lushly-dev/violet-elements` (deep imports) |
| `endpoints/loam/packages/cli/` | `@lushly-dev/loam-cli` | The `loam` bin: `app new`, `app check`, `app pack`, `deployment check`, `deployment write`; `/deployment`, `/check`, and `/vite` (the single-file HTML plugin for views). The only unit that reads TOML | `@lushly-dev/loam-manifest`, `@lushly-dev/afd-server` (`/define`), `@lushly-dev/afd-testing`, `@lushly-dev/loam-theme` (its lint bin), `smol-toml`, `zod` |
| `endpoints/loam/apps/hello/` | `@lushly-dev/loam-app-hello` | The reference app, in all three kinds, with one handler module | `@lushly-dev/loam-sdk`, `@lushly-dev/fast-element`; dev: `@lushly-dev/loam-cli`, `@lushly-dev/loam-testing`, `vite` |
| `endpoints/loam/apps/tally/` | `@lushly-dev/loam-app-tally` | The second app, native: a counter on main, a panel view and a status item. It exists to land with no shell change | The same |

The four phase 0 packages change as follows:

| Package | Change |
| --- | --- |
| `kernel` | Kernel interface version 1, `src/apps/` loaded dynamically, the new commands; adds `@lushly-dev/loam-manifest` and `@lushly-dev/loam-sdk`. `LAYOUT_DEFAULTS_V0` moves to `manifest` and stays exported from the kernel, so `theme:check` and the chrome are unchanged |
| `chrome` | The rail and tab bar's app list, `loam-mount`, the surfaces, overlays, the view host, the keybindings registry; adds `@lushly-dev/loam-console`, `@lushly-dev/loam-sdk` |
| `web` | The deployment read, the mount transport, the sandbox proxy, the suites; adds `@lushly-dev/afd-client`; dev: `@lushly-dev/loam-cli`, `@lushly-dev/loam-testing`, `@lushly-dev/loam-app-hello`, `@lushly-dev/loam-app-tally`, `@modelcontextprotocol/ext-apps` |
| `theme` | Nothing. No token is added; the contract stays version 1 |

- **Workspace.** `pnpm-workspace.yaml` gains `endpoints/loam/apps/*`. The boundary
  check classifies these as endpoints of family `loam` by path
  (`scripts/check-boundaries.mjs:44`), so `architecture.json` needs nothing (D14).
- **Release inventory.** Seven more entries in `scripts/release/inventory.json`, in
  the shape of phase 0's section 1: ids `loam-manifest`, `loam-sdk`, `loam-testing`,
  `loam-console`, `loam-cli`, `loam-app-hello`, `loam-app-tally`, each `state: "quarantined"`,
  `routes: []`, `fixed: false`, `private: true`,
  `gates: ["pnpm check", "loam.yml", "release-approval"]`. Nothing publishes.
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names
  the eleven units and the new glob, and is renamed. Step 1 renames it and adds the glob and `manifest`;
  each later step adds the units it creates, as the inventory entries do.
- **Scripts:**

  | Package | Scripts |
  | --- | --- |
  | all seven new units | `build`, `typecheck`, `test` (browser-free Vitest, run by `pnpm check`) |
  | `manifest` | `schema:build`, which writes the types and validators and fails when the committed schema's `$ref`s do not resolve against `spec/` |
  | `console` | `lint:tokens` |
  | `hello`, `tally` | `lint:tokens`, `pack` (`loam app pack . --out dist/package`, per manifest for hello) |
  | `web` | `test:mounted`, `build:umbel` |

- **`scripts/affected/scope.mjs`.** `EXTRA_INPUTS` gains
  `{ prefix: 'spec/plugin-manifest', packages: ['@lushly-dev/loam-manifest'] }` and
  `{ prefix: 'spec/VERSION', packages: ['@lushly-dev/loam-manifest'] }`.
- **`.github/workflows/loam.yml`.** See [Section 14](#14-exit-criterion-and-tests)
  for what runs; the workflow changes are:
  - The path filters gain `spec/plugin-manifest*`, `spec/VERSION`, `packages/client/**`,
    `packages/adapters/**` and `packages/testing/**`. **Step 7** adds `endpoints/umbel/**`,
    `!endpoints/umbel/docs/**` and `packages/rust/**`, with its `mounted` job, and the exception they
    need in `scripts/repository-contract.test.mjs`'s Umbel test: until a job runs against Umbel, an Umbel
    change has nothing to run here. Step 1 added them early, and step 2 moved them out.
  - The `pnpm -F` selectors for typecheck, units and tokens gain
    `./endpoints/loam/apps/*`. `lint:tokens` gains console, hello and tally.
  - The `scope` job gets a second output, `mounted`, from
    `node scripts/affected.mjs gate` with the same arguments plus
    `--path endpoints/umbel/ --path packages/rust/`.
  - The `loam` job's `if` stays `run`. A new job, `mounted`, named "Mounted against
    Umbel", runs when `mounted` is true, with `timeout-minutes: 45` and
    `CARGO_PROFILE_DEV_DEBUG: line-tables-only`, as `umbel.yml` sets. It installs
    the toolchain from `endpoints/umbel/rust-toolchain.toml`, caches with
    `workspaces: endpoints/umbel`, runs `pnpm -F "@lushly-dev/loam-web..." build`,
    installs Chromium, runs `pnpm -F @lushly-dev/loam-web test:mounted`, checks a
    clean tree and uploads `test-results/`. So an Umbel change runs the proof
    without running Loam's whole suite. `contents: read` only; no publish route.
  - `scripts/affected/suites.mjs`'s `loam.yml` entry gains the `mounted` gate and
    `pnpm -F @lushly-dev/loam-web test:mounted`, with `cargo` in `tools`, and its
    `packages/*` selector gains `apps/*`.
- **`AGENTS.md`.** The architecture tree gains the seven units, and the Loam row and
  key rule name `test:mounted`. The paragraph about what `pnpm check` does not cover
  says Loam's mounted suite needs the Rust toolchain and Umbel.
- **Changesets.** None for the private units. Steps 0a and 0b carry their own.

## 2. The manifest profile

This is the proposal's step 2. It implements the profile contract of
[`spec/plugin-manifest.md`](../../../../../spec/plugin-manifest.md#profiles) (P1 to P6), written from the proposal's
sketch as step 1 corrected it. Keys and meanings the core defines are not repeated here; that page holds
them, and the rules beyond the schema and the renaming rule with them.

### 2.1 Files and encoding

Decides L1.

- **`loam-app.toml`** is what an author writes, at the root of an app's source.
  Its schema paths are relative, as Umbel's are.
- **`app-manifest.json`** is what `loam app pack` writes: the same document as JSON,
  with every `input_schema`, `returns` and `config.schema` path replaced by the
  schema it names. The kernel reads this and nothing else. A manifest still holding
  a path is refused at runtime with `MANIFEST_NOT_PACKED`.
- **The schema** is `endpoints/loam/packages/manifest/schemas/app-manifest.v1.json`,
  with `$id` `https://afd.dev/loam/schemas/app-manifest.v1.json` and the title
  "Loam app manifest, version 1 (conforms to plugin manifest core version 1)".
- **A builder's artifact** (phase 7) writes JSON directly. `app-manifest.json`
  is the only shape it needs.

### 2.2 The profile

The schema closes every object it admits, at every depth, as P1 requires: `$ref` to the
core definition, its own `properties`, and `unevaluatedProperties: false` in the same schema object.
It has a refusal case for each closed object, in `manifest/src/profile-cases.json`.

- **It compiles under Ajv's `strict: true`**, and `schema:build` uses that mode: `type` sits beside every
  `properties` or `items`, even where the `$ref` supplies the type, and each key in a `required` is listed in
  the same object's `properties` (`"domains": true`).
- **Conditionals go in `allOf`** (P1). Each `if`/`then`/`else` that ties a kind to its section sits in an
  `allOf` beside the `$ref`, never directly beside it, because Ajv and Rust's `jsonschema` disagree with one
  there and Ajv refuses valid manifests. The schema uses no `dependentSchemas`.
- **A key is refused with `false`** (P2): a `$ref` admits every key of the core definition the profile does not
  mention, and `unevaluatedProperties` does not refuse those. So `pipelines` is `false` at the root, and
  `confirm_prompt`, `output_budget` and `first_class` in a command, and so on below. `workspace-write` is refused in
  the places effects appear that the profile admits: a command and a mount tool.
- **Owned sections** are P3's: `app`, `native`, `view`, `ui` here, and `agent` from phase 5.

| Key | Rule in Loam's profile |
| --- | --- |
| `manifest_version` | `const: 1` |
| `protocol` | `const: 1`, Loam's app protocol. It covers `AppDefinitionV1`, the surface element contract, the mount contract and the handler frame's methods; it is raised when any of them changes incompatibly |
| `afd_contract` | Optional, for any kind. The rule `afd-contract` compares it with `spec/VERSION`, which `schema:build` writes into `manifest`'s `AFD_CONTRACT` constant |
| `plugin.kind` | `enum: ["native", "view", "mounted"]` (L2) |
| `plugin.domains` | Required, exactly `[plugin.id]` (D18). Otherwise `MANIFEST_DOMAIN_INVALID` |
| `plugin.id` | The core's pattern, and not a shell domain or `afd`: `SHELL_DOMAINS_V1` is the architecture's section 5 list with `status` added (D68), and `auth`, the domain of the `auth-*` commands it names. Otherwise `MANIFEST_ID_RESERVED` |
| `native` | `{ entry }`, a relative path to a JavaScript file. Required when and only when `kind = "native"`, in `allOf` |
| `view` | `{ handlers? }`, a relative path to a single HTML file. Allowed only when `kind = "view"`, in `allOf` |
| `mount` | `{ prefix, transport, only?, tools? }`. The rules `mounted` and `mount-prefix` tie it to the kind and to `plugin.domains`. `transport` is `http` or `stdio`. `tools[]` admits `tool`, `name` and `effects` of the core's keys, the profile narrowing `confirm_prompt`, `approval` and `first_class` away: the shell has no gate to back the first two in phase 1, and no first-class list. `command`, `cwd`, `env`, `bearer`, `bind_space`, `url` and `bearer_env` are not admitted |
| `app` | `{ scope_levels? }`, each `workspace` or `project`, default `["workspace"]`. Recorded and shown in phase 1; phase 2 acts on it (D29) |
| `grants[]` | `name`, `required` (default `true`), `reason`. The core refuses `targets` and `allow`. The name is checked at load against the [grant catalog](#43-grants), not by the schema (K6). A `mounted` manifest declares none: `GRANT_NOT_APPLICABLE` |
| `commands[]` | Allowed when `kind` is `native` or `view`. A `mounted` manifest has none (the rule `mounted`) |
| `commands[].effects` | `inspect`, `plugin-state`, `external`, `store-write`. `workspace-write` is `MANIFEST_EFFECT_REFUSED`, since an app has no file system. `store-write` needs the `store` grant; `external` needs the `http` grant, which phase 1 does not serve |
| `commands[].expose` | `mcp`, `agent`, `cli`, `palette`; the core refuses `apps` until its version 2. A flag left out takes AFD's default: palette and agent on, MCP and CLI off (C5, L3). `app check` reports the effective flags |
| `commands[].approval` | `none` only. `required` is `MANIFEST_APPROVAL_UNAVAILABLE`, naming phase 5: no approval middleware is in the kernel's chain, and the shell does not claim a gate it does not have |
| `commands[].confirm_prompt` | Refused with `MANIFEST_CONFIRM_UNAVAILABLE`, naming phase 4: in-process registries never enforce it (`spec/command-metadata.md`), and the prompt overlay arrives there |
| `commands[].output_budget` | Refused with `MANIFEST_BUDGET_UNAVAILABLE`, until TypeScript implements output budgets (the proposal's reconciliation table) |
| `commands[].tool_meta` | AFD's key rule (T2), with the `dev.loam/` prefix refused, since the kernel sets those. `ui.resourceUri` must name one of `ui.resources` |
| `commands[].first_class` | Refused: a suggestion to a hybrid host, and Loam's registry has no such thing. `MANIFEST_KEY_REFUSED` |
| `contexts[]`, `skills[]` | Admitted and validated. `app-get` lists them. They reach the agent surface in phase 5 |
| `pipelines[]` | Refused, `false` in the profile: `MANIFEST_KEY_REFUSED`, naming phase 5. The core says a pipeline registers as a command, and phase 1's kernel has no use for one before the agent surface, so it refuses the key rather than change its meaning (P2, P4) |
| `config` | `{ schema }`. The deployer's instance configuration, from the deployment entry ([3.1](#31-the-file)), checked when the app loads with `z.fromJSONSchema`, `APP_CONFIG_INVALID` otherwise, and passed as `context.config`. Never a person's settings |
| `ui` | `{ surfaces?, layout?, compositions?, resources? }`, [Section 4](#4-surfaces-grants-and-compositions). A manifest with no `ui` is a headless app, and is valid in every kind |
| `ui.resources[]` | `{ uri, path, title?, prefers_border?, csp?, permissions? }`. `uri` is `ui://<plugin.id>/<name>`; `path` is one HTML file; `csp` and `permissions` have MCP Apps' shapes, are admitted so a view can be exported to other hosts, and are ignored here with `VIEW_CSP_IGNORED` ([6.1](#61-the-sandbox-proxy)). Allowed only when `kind = "view"` |
| Reserved (K9) | `connectors`, `backends`, `dependencies`, `signature`, `scopes`, `on_conflict`, `commands[].scopes`, `expose.apps`, `grants[].allow`, `grants[].targets`, each `false` in the core: `MANIFEST_RESERVED_KEY`, with the core's meaning in the message. So are `commands[].mutation`, which the host derives, and `mount.url` and `mount.bearer_env`, which are the deployer's |
| Other hosts' keys | `component`, `packs`, `commands[].confirm`, `mount.tools[].bind_space`: `MANIFEST_RESERVED_KEY`, naming Umbel's profile. So are `mount.command`, `cwd`, `env` and `bearer`, which name the deployer's entry. An Umbel `kind` is `MANIFEST_KIND_UNKNOWN`, naming the three kinds |
| Later phases' keys | `agent`, `ui.documents`, `ui.new`, `ui.project_summary`, `ui.account`, `ui.settings`, `ui.experiments`, `ui.menus`, `ui.automations`: `MANIFEST_SURFACE_UNAVAILABLE`, naming the phase |

A later phase that adds a key writes `app-manifest.v2.json` with
`manifest_version: 2`, and the kernel reads both. A shell given a version it cannot
read refuses it with `MANIFEST_VERSION_UNSUPPORTED`, naming the versions it serves
(architecture section 8, versioning).

### 2.3 The sketch

```toml
manifest_version = 1
protocol = 1
afd_contract = "1.0"

[plugin]
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, a sidebar list and a main view: the reference app."
kind = "native"
domains = ["hello"]
license = "MIT"

[native]
entry = "dist/native.js"

[app]
scope_levels = ["workspace", "project"]

[[grants]]
name = "store"
reason = "Keeps the names greeted."

[[grants]]
name = "clock"
reason = "Stamps each greeting with the command context's clock."

[[commands]]
name = "hello-greet"
title = "Greet someone"
description = "Greet someone and remember the name."
effects = ["store-write"]
input_schema = "schemas/hello-greet.input.json"
undoable = true

[[commands]]
name = "hello-list"
title = "List greetings"
description = "List the names greeted, as a sidebar list."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[commands]]
name = "hello-forget"
title = "Forget a name"
description = "Remove a greeted name; the undo of hello-greet."
effects = ["store-write"]
input_schema = "schemas/hello-forget.input.json"

[[skills]]
name = "hello-guide"
path = "skills/hello-guide"

[config]
schema = "schemas/config.schema.json"

[ui]
compositions = ["list-detail"]

[ui.layout]
sidebar = { open = true, width = 260 }
inspector = { open = false }

[ui.surfaces.rail]
label = "Hello"
icon = "system/document"
order = 10

[ui.surfaces.sidebar]
shape = "list"
command = "hello-list"

[ui.surfaces.main]
element = "hello-main"

[ui.surfaces.inspector]
element = "hello-inspector"

[[ui.surfaces.keybindings]]
chord = "Mod+Shift+H"
command = "hello-greet"
```

### 2.4 Rules beyond the schema

`readManifest` applies the [rules of `spec/plugin-manifest.md`](../../../../../spec/plugin-manifest.md#rules-beyond-the-schema)
after the schema, by their names there. It does not restate them. Each refusal names the key and gives a suggestion
(P5). The rule table's code for each:

| Rule | Code |
| --- | --- |
| `command-domain` | `MANIFEST_NAME_DOMAIN`, for commands and contexts |
| `mounted` | `MANIFEST_SECTION_KIND` |
| `mount-prefix` | `MANIFEST_MOUNT_PREFIX` |
| `unique` | `MANIFEST_DUPLICATE`, for what the profile admits; pipelines' parts through `readCoreManifest` |
| `context-declared` | `MANIFEST_CONTEXT_UNDECLARED` |
| `text` | `MANIFEST_TEXT_INVALID` |
| `input-schema` | `MANIFEST_INPUT_SCHEMA_INVALID`. Loam's "AFD checker" is `z.fromJSONSchema`, which refuses `not` (but `{ not: {} }`), `if` and `unevaluatedProperties`, among others. It does not check a keyword's own shape, accepting `properties: 1`, so the reader also runs `schemas/json-schema-shape.json`, the 2020-12 metaschema's keyword types in one small document, whose test holds it equal to Ajv's metaschema over a table of schemas |
| `config-schema` | `MANIFEST_CONFIG_SCHEMA_INVALID`. The same two checks, since the load runs `z.fromJSONSchema` on it |
| `output-budget` | `MANIFEST_BUDGET_INVALID`, through `readCoreManifest` only: Loam refuses `output_budget` |
| `skill-name` | `MANIFEST_SKILL_NAME` |
| `tool-meta` | `MANIFEST_TOOL_META_INVALID`, and the `dev.loam/` prefix is refused as the host's own. A `ui.resourceUri` not in `ui.resources` is `MANIFEST_RESOURCE_UNKNOWN` |
| `requires` | `MANIFEST_REQUIRES_UNKNOWN`, **a warning** (L8) |
| `afd-contract` | `MANIFEST_AFD_CONTRACT` |
| `path-inside-root`, `files` | `MANIFEST_PATH_ESCAPE`, `MANIFEST_FILE_MISSING`. These need a file system, so `app check` and `app pack` apply them, and the kernel, reading a packed JSON file in a page, cannot |

`mutation` is derived as the core says: `true` unless `effects` is exactly `["inspect"]`
(`deriveMutation` in `manifest`).

Loam's own rules, each with a case in `manifest/src/profile-cases.json`:

| Rule | Code |
| --- | --- |
| A grant name outside the catalog; a required grant phase 1 does not serve ([4.3](#43-grants)) | `GRANT_UNKNOWN`, `GRANT_UNAVAILABLE` |
| Any grant on a `mounted` manifest | `GRANT_NOT_APPLICABLE` |
| `store-write` without the `store` grant; `external` without `http` | `GRANT_REQUIRED` |
| A surface that its kind cannot use ([4.2](#42-surface-contracts)) | `MANIFEST_SURFACE_KIND` |
| A repeated `ui.resources[].uri`, panel view id, status item id or chord | `MANIFEST_DUPLICATE` |
| A `ui.resources[]` declaring `csp` or `permissions` | `VIEW_CSP_IGNORED`, a warning ([6.1](#61-the-sandbox-proxy)) |
| A `view` manifest with commands and no `view.handlers` ([6.3](#63-the-handler-frame)) | `MANIFEST_SECTION_KIND` |
| A manifest still holding a schema path ([2.1](#21-files-and-encoding)) | `MANIFEST_NOT_PACKED` |
| An `element` that is not a valid custom element name, or starts `loam-` or `violet-` | `MANIFEST_ELEMENT_INVALID` |
| A surface's `command` or binding names a command the manifest does not declare | `MANIFEST_COMMAND_UNKNOWN` |
| A `resource` not in `ui.resources`, or a `ui.resources[].uri` outside `ui://<id>/` | `MANIFEST_RESOURCE_UNKNOWN` |
| A chord in `SHELL_RESERVED_CHORDS_V1` | `KEYBINDING_RESERVED` |
| A `layout` value outside `LAYOUT_DEFAULTS_V0`'s bounds | `MANIFEST_LAYOUT_INVALID` |
| A composition's required part not declared ([4.4](#44-compositions)) | `MANIFEST_COMPOSITION_INCOMPLETE` |

**Conformance.** `scripts/plugin-manifest.test.mjs` is what checks a profile against the core. Step 1 of
the plan extends it with Loam's profile: it adds only the keys P3 gives Loam, closes every object it defines,
admits nothing the core refuses (its `widenings` comparison), and refuses every core refusal in the cases,
naming the same key. The comparison handles `unevaluatedProperties` as well as Umbel's `additionalProperties`
in that step. Beside it, `manifest`'s own `test` runs `spec/plugin-manifest.json` through this package's code:

| Section of the cases | Runs against |
| --- | --- |
| `cases`, `schemas` | The same Ajv options `schema:build` uses, `strict: true` and `allErrors` |
| `rules` | `readCoreManifest` for every rule but `path-inside-root` and `files`, whose cases run in `cli`'s test against `checkApp`'s file checks |
| `mutation` | `deriveMutation` |
| `renaming` | `mountCommandName` |

`readCoreManifest` is the reader with a validator compiled from the core's `manifest` definition alone, since
a profile may refuse what the core accepts. That is the proposal's "`app check` running the core cases": the same
code `app check` calls passes them, and `profile-cases.json` covers what Loam narrows.

### 2.5 The reader and its refusals

```ts
// @lushly-dev/loam-manifest
export type ManifestV1 = /* generated from app-manifest.v1.json */;
export interface ManifestRefusal {
	code: ManifestRefusalCode;
	key: string;            // 'ui.surfaces.tray', 'commands[0].expose.pallete'
	message: string;
	suggestion: string;
}
export type ManifestRead =
	| { ok: true; manifest: ManifestV1; warnings: ManifestRefusal[] }
	| { ok: false; refusals: ManifestRefusal[]; warnings: ManifestRefusal[] };

// @lushly-dev/loam-manifest/validate: the root imports no validator
export function readManifest(json: unknown): ManifestRead;
export function readCoreManifest(json: unknown): ManifestRead;
export function deriveMutation(effects: readonly string[]): boolean;
export function mountCommandName(manifestPrefix: string, prefix: string, tool: string, override?: string): string | { unnameable: string };
export function readDeployment(json: unknown): DeploymentRead; // the same shape, with `deployment`
export function readProjection(json: unknown): ProjectionRead; // the same shape, with `projection`

// @lushly-dev/loam-manifest
export type DeploymentV1 = /* generated */;
export type ProjectionV1 = /* generated */;
export type ProjectionAppV1 = ProjectionV1['apps'][number];
export type ProjectionMountedV1 = ProjectionAppV1 & { prefix: string; transport: 'http' | 'stdio' };
export interface SurfaceEntry {
	id: string;
	place: string;                  // 'ui.surfaces.rail', 'commands[].expose.palette'
	owner: string;                  // the architecture's column
	onSwitch: string;               // the architecture's column
	servedFrom: number;             // the phase
}
export interface GrantEntry { name: string; servedFrom: number | 'collaboration' }
export interface CompositionEntry { name: string; parts: string[]; servedFrom: number | null }
export const SURFACE_CATALOG_V1: readonly SurfaceEntry[];
export const GRANT_CATALOG_V1: readonly GrantEntry[];
export const COMPOSITIONS_V1: readonly CompositionEntry[];
export const ICONS_V1: readonly string[];
export const SHELL_DOMAINS_V1: readonly string[];
export const SHELL_RESERVED_CHORDS_V1: readonly string[]; // the kernel's test holds it equal to SHELL_KEYBINDINGS_V0
export const LAYOUT_DEFAULTS_V0: LayoutDefaultsV0;
```

- **Validators.** `schema:build` compiles the schemas with Ajv's 2020 build, `strict: true`,
  `allErrors: true`, `inlineRefs: false` (which shares a core definition's function between a closing
  profile's two paths), and `ajv/dist/standalone` in the Health dashboard's pattern
  (`report-validator.ts:32-41`), with the core added by `addSchema` from
  `spec/plugin-manifest.core.v1.json`, into three modules in `dist/`, so a page carries only what it reads
  (the package has `sideEffects: false`): `validate.generated.js` (the profile and the projection),
  `validate-shape.generated.js` (the keyword shapes) and `validate-host.generated.js` (the core's
  `manifest` and the deployment file, for `readCoreManifest` and `readDeployment`). The output's
  `require`s of Ajv's runtime helpers are rewritten to imports, and its unread `schemaPath`s dropped. No
  `new Function` runs in the page. A schema that does not compile strictly fails the build. The types and
  `AFD_CONTRACT` are committed in `src/_generated/`, a test holding them equal to a fresh generation; a
  test compiles the validators in memory, so it needs no build.
- **What the reader reports** follows the page's [Validators](../../../../../spec/plugin-manifest.md#validators): it
  drops Ajv's `if` errors, since the failure itself names the key, and reports each key once, since a closing
  profile reaches the core by two paths.
- **Mapping.** An `unevaluatedProperties` error names the key from
  `params.unevaluatedProperty`; a `false schema` error names it from its instance path, as for every key the
  core or the profile sets to `false`. Then, in order:
  1. a key in a reserved or later-phase row takes that row's code; a key this profile set to `false` takes
     its row in the next table;
  2. a key directly under `ui.surfaces` that is a catalog id is `MANIFEST_SURFACE_UNAVAILABLE`, and any
     other is `MANIFEST_UNKNOWN_SURFACE`;
  3. anything else is `MANIFEST_UNKNOWN_KEY`.

  The suggestion names the closest admitted key (edit distance at most 2) and lists
  the admitted keys, so `pallete` says "Did you mean `palette`?" and `tray` lists the
  surfaces.
- **Every other Ajv error** goes through `refusalFor(error)` in
  `manifest/src/refusal-map.ts`, this table, matched on the instance path:

  | Instance path | Code |
  | --- | --- |
  | `/plugin/kind` | `MANIFEST_KIND_UNKNOWN` |
  | `/plugin/domains` | `MANIFEST_DOMAIN_INVALID` |
  | `/plugin/id` | `MANIFEST_ID_RESERVED` when it is a shell domain, else `MANIFEST_INVALID` |
  | `/manifest_version` | `MANIFEST_VERSION_UNSUPPORTED` |
  | `/commands/*/effects/*`, `/mount/tools/*/effects/*` | `MANIFEST_EFFECT_REFUSED` |
  | `/commands/*/approval` | `MANIFEST_APPROVAL_UNAVAILABLE` |
  | `/commands/*/confirm_prompt` | `MANIFEST_CONFIRM_UNAVAILABLE` |
  | `/commands/*/output_budget` | `MANIFEST_BUDGET_UNAVAILABLE` |
  | `/commands/*/first_class`, `/pipelines`, `/mount/tools/*/confirm_prompt`, `/mount/tools/*/approval`, `/mount/tools/*/first_class` | `MANIFEST_KEY_REFUSED` |
  | `/native`, `/view`, `/ui/resources` (wrong kind, from `allOf`) | `MANIFEST_SECTION_KIND` |
  | `/ui/compositions/*` | `MANIFEST_COMPOSITION_UNAVAILABLE` for a name in `COMPOSITIONS_V1`, else `MANIFEST_COMPOSITION_UNKNOWN` |
  | `/ui/surfaces/sidebar/shape` | `MANIFEST_SURFACE_UNAVAILABLE` for `tree`, else `MANIFEST_INVALID` |
  | Anything else | `MANIFEST_INVALID`, with the instance path and the schema's message |
- **The kernel's use.** The reader is imported dynamically, only when a deployment
  lists an app ([9.2](#92-the-budget)). A manifest is untrusted input: the kernel
  validates it at load even though `app pack` did. `readProjection` is the web host's
  ([9.4](#94-web-host)).

## 3. The deployment file

Decides L6. It is phase 1's "Workspace app list" (architecture section 4). Phase 1
has no workspace, so it is a deployer's file; phase 2's workspace store takes the
same entries, except what D56 keeps in configuration.

### 3.1 The file

`loam.deployment.toml`, schema `manifest/schemas/deployment.v1.json`, closed at every
depth, read only by `@lushly-dev/loam-cli`:

```toml
deployment_version = 1

[sandbox]
origin = "https://sandbox.example.com"   # required when a view app is listed

[apps.hello]                             # the instance id
app = "hello"
package = "../apps/hello/dist/package"   # relative to this file
order = 10
config = { default_name = "friend" }     # checked against the manifest's config.schema

[apps.work]
app = "umbel"
package = "./apps/umbel"
title = "Work knowledge"
prefix = "work"
audience = "team"                        # "team" or "person"; required for a mounted app
transport = "http"
url = "http://127.0.0.1:7410/mcp"
bearer_file = "/srv/work-umbel/state/keys/http.token"   # or bearer_env = "WORK_UMBEL_TOKEN"
projects = ["atlas", "borealis"]         # absent: the whole workspace
space = { atlas = "atlas", borealis = "default" }
expose = { agent = true, palette = true } # defaults for commands that report no mutation

[apps.work.commands."work-event-ack"]    # per-command overrides, by the final name
expose = { palette = true }
effects = ["plugin-state"]

[apps.home]
app = "umbel"
package = "./apps/umbel"
prefix = "home"
audience = "person"
transport = "stdio"
command = ["umbel", "--workspace", "/home/me/notes-umbel", "serve", "--stdio"]
```

| Instance key | Rule |
| --- | --- |
| The table's name | The instance id: `^[a-z][a-z0-9]{0,31}$`, unique. For `native` and `view` it must equal `app`, so one instance per app. For `mounted` it is the deployer's, and defaults nothing: every mounted entry names itself |
| `app` | Equals the package manifest's `plugin.id`; otherwise `DEPLOYMENT_APP_MISMATCH` refuses that instance at load, and `deployment check` fails |
| `package` | A directory holding `app-manifest.json` |
| `order` | The rail's order hint, overriding `ui.surfaces.rail.order`. Ties break by instance id |
| `title` | The rail's label and the console's heading, overriding the manifest's |
| `config` | Checked against `config.schema` at `deployment check` and at load (`APP_CONFIG_INVALID`) |
| `prefix` | Mounted only. Defaults to `mount.prefix` for the first instance of an app; a further instance must name its own (`INSTANCE_PREFIX_REQUIRED`). Unique among prefixes, app ids and shell domains (`INSTANCE_PREFIX_CONFLICT`). Both are load-time refusals of that instance ([3.2](#32-writing-the-browser-projection)) |
| `audience` | Mounted only, required. `team` is D55's case: `transport` must be `http` (`DEPLOYMENT_TEAM_NEEDS_HTTP`), and `app check` and the console show the D55 notice |
| `transport` | Mounted only; overrides `mount.transport` |
| `url`, `bearer_file`, `bearer_env` | For `http`. `url` must be `http://` on a loopback address or `https://`. At most one credential key |
| `command`, `cwd` | For `stdio` (D56). An array of strings, never a shell line |
| `projects`, `space` | Recorded and projected. Phase 2 enforces `projects` by membership (D55); `space` is pinned ([7.5](#75-a-mapped-space-is-pinned)) |
| `expose` | `agent` and `palette` for the instance's commands that report no mutation; each defaults to `true`. `mcp` and `cli` may be `false`; `true` is refused in phase 1 (no surface; `DEPLOYMENT_EXPOSE_UNAVAILABLE`). `apps` is refused until D30 lands, naming phase 5 |
| `commands."<name>"` | `expose`, `effects`, `destructive`. The only way to expose a command that reports a mutation (D65). A flag a named override leaves out is off. A name matching no discovered command is a warning on the instance, `INSTANCE_OVERRIDE_UNKNOWN` |

`readDeployment` applies what the file alone can say, each refusal naming the key and giving a suggestion:

| Refusal | Code |
| --- | --- |
| The schema: an unknown key at any depth, a value out of shape | `DEPLOYMENT_INVALID` |
| A `deployment_version` it does not read | `DEPLOYMENT_VERSION_UNSUPPORTED` |
| An entry with no mounted key whose table name is not its `app` | `DEPLOYMENT_INSTANCE_MISMATCH` |
| A mounted key with no `audience` | `DEPLOYMENT_AUDIENCE_REQUIRED` |
| `audience = "team"` with `transport = "stdio"` or a `command` | `DEPLOYMENT_TEAM_NEEDS_HTTP` |
| `bearer_file` with `bearer_env` | `DEPLOYMENT_CREDENTIAL_CONFLICT` |
| A `url` that is neither `https://` nor `http://` on a loopback address | `DEPLOYMENT_URL_INVALID` |
| A key of the other transport, `transport = "http"` with no `url`, or `transport = "stdio"` with no `command` | `DEPLOYMENT_TRANSPORT_KEYS` |
| `expose.mcp` or `expose.cli` true, or `expose.apps` | `DEPLOYMENT_EXPOSE_UNAVAILABLE` |

What needs a package's manifest (the kind, the transport it defaults, `DEPLOYMENT_APP_MISMATCH`, a required `sandbox.origin`) is `loam deployment check`'s, in step 2. A projection that fails `readProjection` is `DEPLOYMENT_INVALID`, whichever key it names.

### 3.2 Writing the browser projection

`loam deployment write --config <file> --dist <web dist> --out <dir>`, also exported
as `writeDeployment()` from `@lushly-dev/loam-cli/deployment`:

1. Reads and validates the file. **Only what makes the file unreadable stops the write:**
   its schema, `DEPLOYMENT_*`, and a credential that cannot be read. A package's refusal,
   a missing package and a prefix conflict do not: the instance stays in the projection,
   the kernel refuses it at load, and the rail shows it refused (D66). The result's
   `warnings` list each, and `loam deployment check` fails on them for a deployer who wants
   that gate.
2. Copies `<dist>` to `<out>`, and each package to `<out>/apps/<instance>/`. It reads
   `app-manifest.json` as data and never interprets it beyond step 1's warnings, so a
   package `app pack` would refuse can still be listed, which is how E7 reaches a browser.
3. Writes `<out>/deployment.json`, the **browser projection**:

   ```json
   {
   	"deployment_version": 1,
   	"sandbox_origin": "https://sandbox.example.com",
   	"apps": [
   		{ "instance": "hello", "app": "hello", "package": "apps/hello/", "order": 10, "config": { "default_name": "friend" } },
   		{
   			"instance": "work", "app": "umbel", "package": "apps/work/", "title": "Work knowledge",
   			"prefix": "work", "audience": "team", "transport": "http", "route": "mounts/work/mcp",
   			"projects": ["atlas", "borealis"], "space": { "atlas": "atlas", "borealis": "default" },
   			"expose": { "agent": true, "palette": true },
   			"commands": { "work-event-ack": { "expose": { "palette": true }, "effects": ["plugin-state"] } }
   		},
   		{ "instance": "home", "app": "umbel", "package": "apps/home/", "prefix": "home", "audience": "person", "transport": "stdio" }
   	]
   }
   ```

   **`url`, `bearer_file`, `bearer_env`, `command` and `cwd` never appear in it.**
   Its schema, `manifest/schemas/projection.v1.json`, has no such keys and is closed,
   so a projection holding one fails `readProjection`.
4. Rewrites `<out>/index.html`'s CSP: `frame-src` becomes the sandbox origin, or stays
   `'none'` when no view app is listed. Nothing else in the CSP changes.
5. Returns `{ mounts: [{ instance, url, bearer }] }` to the caller, in memory. The CLI
   writes it only under `--mounts-out <path>`, with mode 0600, outside `<out>`, and
   refuses a path inside it. `bearer` is read here from `bearer_file` or `bearer_env`.

`vite build` itself writes `dist/deployment.json` holding
`{ "deployment_version": 1, "sandbox_origin": null, "apps": [] }`, so the web host
needs no special path for the empty shell, and no 404 appears at boot.

### 3.3 Who may write it (D55, D56)

- **No command, app or agent writes an instance entry.** The kernel has
  `app-instance-list` and `app-instance-refresh`. It has no command that adds,
  removes or changes an instance, and E4 checks that no shell command's input
  schema has a `command`, `url` or `bearer` key. The autonomy policy (phase 5) and the
  builder (phase 7) have nothing to reach.
- **A stdio entry** is written by the deployer or, in phase 6's desktop lane, by the
  person who owns the workspace through the host's own settings, outside the registry.
  Phase 1's browser host cannot spawn: the instance loads as `failed` with
  `MOUNT_TRANSPORT_UNAVAILABLE`, whose suggestion names the desktop and hosted lanes.
  `loam deployment check` reports `STDIO_TRUSTED_CODE`: "This instance runs as the
  host's OS user. It is trusted code, not sandboxed."
- **D55's notice.** `audience = "team"` adds `TEAM_INSTANCE_SINGLE_PRINCIPAL` to `loam
  deployment check` and the console: "Umbel sees one principal for every member of this
  instance's projects. Mount it only where each of them may read all of it."

## 4. Surfaces, grants and compositions

### 4.1 The catalog, version 1

`SURFACE_CATALOG_V1` holds all 22 of the architecture's surfaces, each with where a
manifest declares it, its owner, its rule on app switch and when it is served. The
owner and switch columns are the architecture's. `shell-info-get` reports
`surfaceCatalog: 1`. A surface id is removed only by a new `manifest_version`, after
one version that warns (R6).

| Surface | Where declared | Served |
| --- | --- | --- |
| rail | `ui.surfaces.rail`; absent, a default entry | Phase 1 |
| sidebar | `ui.surfaces.sidebar` | Phase 1: `list`, `custom`. `tree`: `MANIFEST_SURFACE_UNAVAILABLE`, naming phase 2, whose documents and projects sections first need one |
| header | `ui.surfaces.header` | Phase 1: title, primary actions. Breadcrumbs with phase 2's URL scheme |
| main | `ui.surfaces.main`; absent, the console (D48) | Phase 1 |
| inspector | `ui.surfaces.inspector` | Phase 1 |
| panel | `ui.surfaces.panel` | Phase 1 |
| status | `ui.surfaces.status` | Phase 1: right items. Left items with scope, in phase 2 |
| palette | `commands[].expose.palette` | Phase 1. Quick picks with phase 4's prompts |
| overlays | Commands, no key | Phase 1: toast and modal ([8](#8-overlays-in-phase-1)). The rest in phase 4 |
| keybindings | `ui.surfaces.keybindings` | Phase 1: chords. Two-key sequences and `when` in phase 4 |
| agent | `contexts[]`, `skills[]`; later `agent` | Listed in phase 1; served in phase 5 |
| documents, new, editor, embed, project-summary | `ui.documents` (with its editor and embed), `ui.new`, `ui.project_summary` | Phase 2 |
| account | `ui.account` | Phase 3 |
| settings, experiments, menus | `ui.settings`, `ui.experiments`, `ui.menus` | Phase 4 |
| notifications | Commands, no key | Phase 4 |
| automations | `ui.automations` | Phase 7 |

An id under `ui.surfaces` that is not in the catalog is `MANIFEST_UNKNOWN_SURFACE`. A catalog id that
is not served, whether under `ui.surfaces` or at its own place, is `MANIFEST_SURFACE_UNAVAILABLE`,
naming the phase and the place.

### 4.2 Surface contracts

Each object under `ui.surfaces` is closed.

| Surface | Keys | Native | View | Mounted | On switch |
| --- | --- | --- | --- | --- | --- |
| `rail` | `label?` (default `plugin.title`), `icon?` (one of `ICONS_V1`, default `system/folder`), `order?` (integer, default 100) | Yes | Yes | Yes | Stays; the active item changes |
| `sidebar` | `shape` (`list` or `custom`), `command` (required for `list`), `element` (required for `custom`), `title?` | Yes | `list` only | No | Parked and restored |
| `header` | `title?`, `actions?`: `[{ command, label }]`, at most 3, the first primary | Yes | Yes | No | Replaced |
| `main` | Native: `element`. View: `resource`, `command?`. Mounted: none admitted | Yes | Yes | No key; the console | Replaced |
| `inspector` | `element`, `title?` | Yes | No | No | Cleared |
| `panel` | `views`: `[{ id, title, element }]`, at least 1 | Yes | No | No | Parked and restored |
| `status` | `items`: `[{ id, label, command?, priority? }]`, at most 4 | Yes | Yes | No | Removed |
| `keybindings` | `[{ chord, command }]` | Yes | Yes | No | Deactivate |

- **A `mounted` manifest** admits only `ui.surfaces.rail`. Its commands are unknown until discovery, so
  no surface can bind one, and an instance stays headless (D58).
- **`ICONS_V1`** is the system icons `violet-elements` generates that suit an app:
  `system/attach`, `system/calendar`, `system/checkmark`, `system/clock`,
  `system/document`, `system/folder`, `system/search`, `system/warning`. An unknown
  icon is `MANIFEST_INVALID`. The chrome registers them in the nav's lazy chunk.
- **A `list` sidebar's command** takes `{}` and returns
  `{ items: Array<{ id: string; title: string; description?: string }> }`. The shell
  renders it with `loam-list` (a listbox) and re-reads it after a successful mutation
  of the same app. Selecting an item calls `app-selection-set`.
- **A chord** matches `^(Mod\+)?(Shift\+)?(Alt\+)?[A-Z0-9]$` or a function key, and
  must carry `Mod` or be a function key. Reserved chords and a chord another installed
  app holds are refused: `KEYBINDING_RESERVED`, and at load `KEYBINDING_CONFLICT`,
  which refuses the later app's binding, reports it in `app-get`, and leaves the app
  loaded. A chord runs its command only while its app is active, and only if the
  command needs no input.
- **The registry** is `createKeybindings(shell, apps)` in the kernel, read by the chrome through
  `kernel.listKeybindings()`, in place of importing `SHELL_KEYBINDINGS_V0`. The constant stays and is its
  first band. `keybindingFor` reads the registry, so `listCommands` reports app chords.

### 4.3 Grants

`GRANT_CATALOG_V1` is the architecture's host services catalog. Each row says what
phase 1 does; the enforcement column is D54's distinction.

| Grant | Phase 1 | How it is enforced |
| --- | --- | --- |
| `store` | Served: `context.store`, a key-value namespace per instance over the kernel's `DataAdapter`, table `app-<instance>` | The API is given only when declared. Native: a contract. View: a boundary, because the store is reached only through the broker |
| `clock`, `random` | Served: `context.now()`, `context.random()`, from the command context, on the journal's tape | Native: a contract, since the page has `Date.now()`. View: the handler frame gets the values with the call |
| `projects`, `documents` | Phase 2 | |
| `settings` | Phase 4 | |
| `collaboration` | The collaboration specification | |
| `events`, `calls` | Phase 5 | |
| `http` | Phase 5, with the hosted lane | |
| `secrets` | Phase 6 | |

- **A store record** is `{ key, value, app, instance, actor, updatedAt, scope: null }`, the kernel filling
  everything but `key` and `value` (architecture section 7), with `updatedAt` from the command's clock so
  a replay reproduces it. Phase 2 fills `scope`.
- **At load.** A name outside the catalog is `GRANT_UNKNOWN`, naming the catalog. A
  `required` grant phase 1 does not serve is `GRANT_UNAVAILABLE`, naming its phase,
  and refuses the app. With `required = false` the app loads without it, the API is
  absent, and `app-get` says so.
- **Every call an app makes** goes through its app port ([5.3](#53-the-app-port)). A
  call to a command outside its own and `APP_CALLABLE_SHELL_COMMANDS_V1` is refused with
  `CALL_NOT_GRANTED`, whose suggestion says the `calls` grant arrives in phase 5, before lookup,
  exposure or validation, so a view learns nothing of another app's commands. The refusal is
  journaled, with the caller.
- **`app check` says what is a boundary.** For `native` it reports
  `TRUSTED_NOT_SANDBOXED`: "Trusted, not sandboxed. Native apps share the shell's page,
  so this app's grants are a contract, not a boundary. Ship untrusted code as a view." `app-get` carries the same line. For `view`: "Sandboxed: its grants are
  enforced." For `mounted`: "External: its results are labeled untrusted."
  A mounted manifest's `app check` also prints D55's notice, whichever instance later mounts it:
  `TEAM_INSTANCE_SINGLE_PRINCIPAL`, "A team instance is mounted only where every member of its projects may read all of it."

### 4.4 Compositions

Composition library version 1 (`COMPOSITIONS_V1`; `shell-info-get` reports
`compositionLibrary: 1`):

| Name | Parts it needs | Selection model | Phase |
| --- | --- | --- | --- |
| `console` | main | None | 1. Implicit when a manifest has no `ui.surfaces.main`; a manifest may also name it |
| `list-detail` | sidebar with `shape = "list"`, and main | One id, in `app-selection-get`; given to main and the inspector | 1 |
| `split`, `board`, `document`, `dashboard`, `wizard` | | | Named and refused: `MANIFEST_COMPOSITION_UNAVAILABLE`, saying a later phase adds them when a first app needs them |

- An unknown name is `MANIFEST_COMPOSITION_UNKNOWN`.
- An app with `list-detail` gets the list, the selection and an inspector that follows
  it, when it declares one, and nothing else (D2).
- A selection is per instance, held in the kernel's memory and not persisted. `app-selection-set`
  is journaled. Leaving the app clears it, as the inspector is cleared, and returning starts with none.
- **Delivery.** Main and the inspector get it as the surface element's `selection` property. A
  view gets it as `hostContext["dev.loam/selection"]` and `ui/notifications/host-context-changed`.

### 4.5 Layout preset and per-app state

`ui.layout` is `{ sidebar?: { open?, width? }, inspector?: { open?, width? }, panel?: {
open?, height? } }`, within `LAYOUT_DEFAULTS_V0`'s bounds.

- **A part is available only when the active app declares it** (principle 4). With no
  active app, every part is available, as in phase 0.
- **Keying.** Each instance has a view-state handler `loam.layout.<instance>`, registered while the
  kernel reads the deployment, before its one `hydrate()`. Its initial state is the defaults
  overlaid with the preset, with its undeclared parts closed, which a persisted record then replaces, so the
  preset seeds only the first open. It goes through `validateLayoutPatch`, and the kernel's `view-state-set` guard covers it as it
  does `loam.layout`. `loam.layout` keeps its
  phase 0 handler for the no-app state. `layout-get`, `layout-set` and `layout-reset`
  act on the active owner's record. The kernel's wrappers of `view-state-get` and
  `view-state-set` rewrite the id `loam.layout` to the active owner's record before
  delegating, so `view-state-get { id: 'loam.layout' }` still equals `layout-get`, and a write
  persists under the right id (`packages/view-state/src/registry.ts:115` persists by the id
  it is given). Phase 2 appends the scope to the key.
- **`loam.apps`** is read-only through view-state: `view-state-set` on it answers
  `VIEW_STATE_READ_ONLY`, naming `app-open`, since a write would skip the switch's overlay and
  surface rules.
- **A refusal.** `layout-set` opening a part the active app did not declare returns
  `LAYOUT_PART_UNDECLARED`, naming the part and the manifest key, and is journaled. Its
  width or height may still be set. The chrome's chords and toggles do not call it for an
  undeclared part: a toggle shows `aria-disabled`, and a chord does nothing.
- **Presentation.** `presentLayout` is unchanged. The chrome passes it a layout with
  undeclared parts closed, and hides those parts' handles.

### 4.6 The app list in the rail and tab bar

- **`loam-rail` and `loam-tabbar`** render, above the settings entry, one button per
  entry of `app-list`, sorted by `order` then instance id: `violet-icon`, and the label
  as visible text in the tab bar and as `aria-label` and tooltip in the rail. The active
  entry has `aria-current="page"` and `color.control.selected.*`.
- **A press** calls `app-open`. Entries are in the Tab order.
- **A `failed` or `refused` entry** stays listed, with `system/warning` and "(unavailable)"
  after its label. A press still opens it, and main shows the console's or the notice's
  explanation. A refused app is never hidden.
- **`loading`** (a mounted instance still discovering, or an app restored at boot) shows
  `aria-busy="true"`.
- **The tab bar** is horizontally scrollable when its entries overflow, with
  `overflow-inline: auto` and each entry at `size.target.comfortable`. There is no "More".
- **Main.** With no app active: "No apps yet" when `app-list` is empty, as in phase 0;
  otherwise "Choose an app" with the same palette line. The router seam is unchanged: an
  app has no URL until phase 2, and the active instance is the view-state record
  `loam.apps`, `{ active: string | null }`.

## 5. Native ES module

### 5.1 The entry

- `native.entry` is an ES module, **self-contained** apart from dynamic imports of its
  own relative chunks. It default-exports an `AppDefinitionV1` (D60).
- The contract names no bundler. Hello and tally build with Vite in library mode.
- **Top-level code must not touch the DOM or the global registry.** `app check` cannot
  verify this, because it does not run the code; the test kit fails an app whose import
  defines a global element.
- **The module is loaded lazily**: on the first call to one of its commands, or the
  first time the app opens, and a persisted active app opens only after first paint
  ([5.5](#55-lifecycle)). So an app cannot slow first paint.
- The module may bundle its own `@lushly-dev/fast-element`. Two copies of FAST in one
  page each keep their own registry and update queue, and meet only at the DOM.

### 5.2 The SDK

The whole contract an app codes against (D21, D68). Transports and the kernel do not
appear in it.

```ts
// @lushly-dev/loam-sdk
export const SDK_VERSION = 1;

export function defineApp(definition: AppDefinitionV1): AppDefinitionV1;

export interface AppDefinitionV1 {
	readonly sdk: 1;
	/** One per command in the manifest, by its full name. `never` so a handler may type its input. */
	handlers: Record<string, AppCommandHandlerV1<never>>;
	/** Runs once, before the first surface renders. Not for commands, which run without it. */
	activate?(context: AppContextV1): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

export type AppCommandHandlerV1<I = unknown, T = unknown> = (
	input: I,
	context: AppCallContextV1
) => Promise<CommandResult<T>>;

export interface AppCallContextV1 {
	readonly traceId: string;
	readonly actor?: Actor;
	/** Present with the `clock` grant; the same reading for the whole call in a view. */
	now?(): number;
	/** Present with the `random` grant. */
	random?(): number;
	/** Present with the `store` grant. */
	readonly store?: AppStoreV1;
	readonly config: Readonly<Record<string, unknown>>;
	/** For queries only: a nested mutation answers NESTED_MUTATION_REFUSED (5.3). */
	readonly client: LoamClientV1;
}

export interface AppContextV1 {
	readonly instance: string;
	readonly app: string;
	readonly version: string;
	readonly config: Readonly<Record<string, unknown>>;
	readonly client: LoamClientV1;
	/** The app's scoped registry: define the app's own elements here. Native only. */
	readonly registry: CustomElementRegistry;
	readonly kit: KitV1;
	readonly overlays: OverlaysV1;
}

export interface LoamClientV1 {
	call<T = unknown>(name: string, input?: unknown, options?: { signal?: AbortSignal }): Promise<CommandResult<T>>;
}

export interface AppStoreV1 {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}

export interface KitV1 {
	/** Defines the named kit elements in this app's scoped registry. */
	define(names: readonly KitElementNameV1[]): Promise<void>;
}

export interface OverlaysV1 {
	toast(input: ToastInputV1): Promise<CommandResult<OverlayRefV1>>;
	/** Resolves when the modal closes, for whatever reason. */
	modal(input: ModalInputV1): Promise<OverlayResultV1>;
}

/** What a surface's element receives. Assigned before it connects. */
export interface LoamSurfaceElementV1 extends HTMLElement {
	context?: AppContextV1;
	/** The selection, for `main` and `inspector` under `list-detail`. */
	selection?: string | null;
}

export type OverlayKindV1 = 'toast' | 'modal';
export interface OverlayRefV1 { overlayId: string; owner: string; kind: OverlayKindV1; lifetime: 'transient' | 'session' }
export interface ToastInputV1 { message: string; tone?: 'info' | 'success' | 'warning' | 'danger'; durationMs?: number }
export interface ModalInputV1 { title: string; body: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export interface OverlayV1 extends OverlayRefV1 { input: ToastInputV1 | ModalInputV1 }
export interface OverlayResultV1 {
	overlayId: string;
	result: 'confirm' | 'cancel' | 'dismissed';
	reason: 'user' | 'timeout' | 'app-switch' | 'cap';
}
```

- **An app's own elements and the registry.** A surface's element is defined in `context.registry`, inside
  `activate`. For its own template to see scoped elements, an element's shadow root must also use that registry: with
  FAST, `FASTElement.define(Class, { name, template, registry: context.registry, shadowOptions: { mode: 'open',
  customElementRegistry: context.registry } })`, without which FAST's cloning uses the global registry and a scoped tag
  is never upgraded (`templating/compiler.ts:203-210`). `registry` is what keeps the definition out of the global
  registry, since a definition defaults to it (`fast-definitions.ts:505`); as first written, this sketch left it out
  ([9.6](#96-decided-by-step-4)). Hello shows it. A surface naming an element the app did not
  define shows `APP_ELEMENT_UNDEFINED` in the mount.

- **`KitElementNameV1`** is `violet-badge`, `violet-button`, `violet-checkbox`,
  `violet-divider`, `violet-empty-state`, `violet-icon`, `violet-option`,
  `violet-select`, `violet-switch`, `violet-text-area`, `violet-text-field`, `loam-list`
  and `loam-status-item`. Each loads through a dynamic deep import in the chrome's
  `kit-loader.ts`. More join by a new SDK minor, as apps need them (principle 18).
- **Handlers only.** The manifest is the single source of a command's metadata
  (D59). The handler holds behavior. An app needs no Zod and imports no AFD server code;
  `success` and `failure` are re-exported from `@lushly-dev/afd-core`. A handler without a
  command, or a command without a handler, is `APP_HANDLER_MISSING`.
- **`/view`** is for code inside a sandbox. It uses only `window.parent.postMessage` and defines no
  element:

  ```ts
  export function connectView(info?: { name: string; version: string }): Promise<ViewConnectionV1>;
  export function serveHandlers(definition: AppDefinitionV1): void; // 6.3

  export interface ViewHostContextV1 {
  	theme: 'light' | 'dark';
  	platform: 'web';
  	displayMode: 'inline';
  	containerDimensions: { width: number; height: number };
  	'dev.loam/tokens': Record<string, string>;
  	'dev.loam/selection'?: string | null;
  }

  export interface ViewConnectionV1 {
  	readonly hostContext: ViewHostContextV1;
  	readonly client: LoamClientV1;           // tools/call, through the broker
  	readResource(uri: string): Promise<string>;
  	onToolInput(listener: (args: unknown) => void): () => void;
  	onToolResult(listener: (result: CommandResult) => void): () => void;
  	onToolCancelled(listener: (reason?: string) => void): () => void;
  	onHostContext(listener: (context: Partial<ViewHostContextV1>) => void): () => void;
  	onTeardown(listener: () => void | Promise<void>): () => void;
  }
  ```

  `connectView` sends `ui/initialize`, applies `hostContext["dev.loam/tokens"]` to
  `document.documentElement`, sends `ui/notifications/initialized`, and resolves. A view that does not use
  it, such as one built on `@modelcontextprotocol/ext-apps`, still works.
- **`@lushly-dev/loam-testing`** is the test kit: `createAppTestKernel({ manifest, definition, grants? })`,
  which boots a headless kernel with only the app and returns `{ kernel, port, replay() }`.
  It runs AFD scenarios through `kernel.call` and `kernel.agent.call`, and drives the
  layout through the view-state commands. It fails when importing the definition defines a global
  element ([9.5](#95-decided-by-step-3) says how). Affordance grading is phase 7 (D49).

### 5.3 The app port

The kernel's object per instance, which the chrome turns into the SDK's objects. It
is not part of the SDK.

```ts
export interface AppPortV1 {
	readonly instance: string;
	/** The validated manifest: what the chrome renders from. */
	readonly manifest: ManifestV1;
	readonly config: Readonly<Record<string, unknown>>;
	readonly packageUrl: string;
	/** Imports the native module once. Rejects with APP_HANDLER_MISSING and sets `failed`. */
	load(): Promise<AppDefinitionV1>;
	/** Reads a file of the package, for a view's HTML. Only `ui.resources` paths and `view.handlers`. */
	readResource(uri: string): Promise<string>;
	/** The chrome's report that `activate` threw, since `activate` needs the DOM. */
	reportActivationFailed(message: string): void;
	call<T = unknown>(name: string, input?: unknown, options?: CallOptionsV1): Promise<CommandResult<T>>;
	waitOverlay(overlayId: string): Promise<OverlayResultV1>;
	readonly store?: AppStoreV1;
}

export const APP_CALLABLE_SHELL_COMMANDS_V1 = [
	'toast-show', 'modal-open', 'overlay-dismiss', 'overlay-list',
	'status-item-set', 'app-selection-get', 'app-selection-set',
	'appearance-get', 'shell-info-get',
] as const;
```

- **`port.call`** runs these checks before it reaches a registry, then runs on the `palette` registry with the
  declared context fields `caller` and, for a nested call, `parent` set by trusted code. The `apps` interface
  is D30's, in phase 5.
  1. The name is the app's own, or in `APP_CALLABLE_SHELL_COMMANDS_V1`. Otherwise the port runs the internal
     command `app-call-refuse { command }`, which returns `CALL_NOT_GRANTED`, and returns that. It is
     journaled by the normal path, holds the name and not the input, and is missing from `listCommands`
     (`INTERNAL_COMMANDS`).
  2. **Scoping:** `app-selection-get` and `app-selection-set` with an `instance` other than the caller's are
     refused the same way. `overlay-list` returns the caller's own overlays when `caller` is set.
     `overlay-dismiss` is `OVERLAY_NOT_OWNER` on another's. So a sandboxed view sees nothing of another app.
  3. **Nested calls.** A call made through a handler's `context.client` carries `parent`, the outer call's trace
     ID. A nested call to a mutation is `NESTED_MUTATION_REFUSED`, naming D68: its effect would run twice on
     replay, once in the outer handler and once as its own entry, and phase 1 has no way to pair them. The port
     runs the internal command `app-nested-refuse { command }`, so the refusal is journaled as 1's is.
- **An activation failure** is the kernel's in-memory `state: 'failed'`, not journaled: it depends on the page and
  not on a command, and `REPLAY_RECORDED_QUERIES` ([7.6](#76-journal-behaviour)) keeps it out of a replay's comparison.

### 5.4 Scoped registries and the mount

`loam-mount` is the mount contract (D34, D9, principle 10).

- **One registry per instance**: `new CustomElementRegistry()`, created at activation.
  It holds the app's elements and the kit elements it asked for. Lookup does not fall
  through to the global registry, so an app sees only what it defined.
- **`loam-mount`** is a chrome element defined globally. Its shadow root is attached
  with `{ mode: 'open', customElementRegistry: registry, registry, customElements: registry }`:
  the first is the platform's key, and the polyfill reads the other two
  (`scoped/detection.ts:41-45`, and the polyfill's `src/scoped-custom-element-registry.ts:106-115`).
  - Its stylesheet is `:host { all: initial; display: block; block-size: 100%; contain:
    content; font-family: ...; color: var(--color-text-primary); }`. `all: initial`
    resets inherited styles and does not reach custom properties, so tokens flow
    through and inherited styles do not.
  - It creates the surface's element with `document.createElement(name, {
    customElementRegistry: registry })`, assigns `context` and `selection`, and appends
    it.
  - The chrome's parts stay in its own shadow roots, so an app's selectors cannot reach
    them. D54 applies: this is a contract, since an app can walk the DOM.
- **The polyfill.** The chrome calls `ensureScopedRegistrySupport()` from
  `@lushly-dev/fast-element/scoped.js` before the first native app activates (D34), and
  the mount's element creation has one branch: `shadowRoot.createElement(name)` when the polyfill is
  in use, which scopes through the key above.
- **Kit elements in a scoped registry.** `kit.define` imports the element's module, finds
  its `FASTElementDefinition` through `fastElementRegistry.getByType`, and calls
  `definition.define(registry)`, as `scoped/registry.ts:22-23` does; a constructor may
  be defined once per registry. The element's own shadow root stays on the global
  registry, where its module also defined it and its inner elements.

### 5.5 Lifecycle

| Event | What the shell does |
| --- | --- |
| Boot | Reads manifests, registers commands with lazy handlers. Runs no app code before first paint. If `loam.apps.active` names an instance, the shell renders main with `aria-busy`, and after first paint opens it as `app-open` does, with no journal entry, since the state did not change. A `failed` or `refused` active app shows its explanation |
| First call to a command | Imports the module, checks the handler set, runs the handler. `activate` does not run |
| `app-open`, first time | Imports the module if needed, runs `activate`, creates the mounts, seeds the layout |
| `app-open`, again | Restores parked mounts, re-creates main and the header |
| Switching away | Per the catalog: sidebar and panel mounts are parked, removed from the document with their element kept and their scroll offsets recorded on the controller, which restores them; main, the header and the inspector are removed and dropped; status items are removed; app keybindings deactivate; overlays follow [Section 8](#8-overlays-in-phase-1) |
| A throwing `activate` or import | The app's state becomes `failed`, with `APP_ACTIVATION_FAILED` and the message; main shows `loam-notice`'s body; the rail entry stays |

`deactivate` runs only at kernel disposal in phase 1, since parked apps stay activated.
Nothing is unloaded.

## 6. Sandboxed view

### 6.1 The sandbox proxy

MCP Apps requires of a web host: "The Host and the Sandbox MUST have different origins"
and "The Sandbox MUST have ... `allow-scripts`, `allow-same-origin`". D62 follows it.

- **The file.** `web/public/sandbox/proxy.html` and `proxy.js`, copied by `vite build` to
  `dist/sandbox/`, and deployed by the deployer **on `sandbox.origin`**. `proxy.html`'s
  `<meta>` CSP is `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; frame-src 'self';
  base-uri 'none'`. It must permit what the inner document may use, since a `srcdoc`
  document inherits it; the inner document's own CSP (below) narrows it.
- **The outer iframe.** The chrome's `loam-view-frame` creates
  `<iframe sandbox="allow-scripts allow-same-origin allow-forms" src="<origin>/sandbox/proxy.html?host=<encoded shell origin>&title=<encoded app title>" title="<app title>">`. `allow-forms` is there because a child frame takes only flags its parent has.
- **Refusals.** No `sandbox_origin`, or one equal to the shell's origin, makes the app
  `failed` with `VIEW_SANDBOX_ORIGIN_INVALID`, whose suggestion says to deploy
  `dist/sandbox/` on a second origin and set `[sandbox] origin`.
- **The inner iframe.** The proxy, on `ui/notifications/sandbox-resource-ready`, creates
  `<iframe sandbox="allow-scripts allow-forms" title="<title>" srcdoc="...">`, opaque-origin, so views do not
  share the sandbox origin's storage. `proxy.html` has `lang="en"` and sets `document.title` from `title`. It ignores the message's `sandbox` override. `srcdoc`
  is the view's HTML with this as its very first bytes, before anything of the view's:

  ```html
  <!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'">
  ```

  A `srcdoc` document holds the proxy's policy as well as this one, so the stricter of each directive wins:
  `base-uri` is `'none'` for a view in practice, and one violation reports twice ([9.7](#97-decided-by-step-5)).

  This is MCP Apps' default CSP. **Phase 1 serves no `_meta.ui.csp`**: a resource's
  declared domains (`ui.resources[].csp`) are ignored, `hostCapabilities.sandbox.csp` is empty, and `app check`
  warns `VIEW_CSP_IGNORED`. No `permissions` are granted. Phase 7 sets the sandbox policy
  for drafts (the follow-up in STATUS.md).
- **Messages.** The proxy forwards everything but `ui/notifications/sandbox-*`, in both
  directions, checking `event.source`: `window.parent` with `event.origin` equal to `host`,
  or the inner window. The proxy creates no request of its own. The chrome accepts only
  `event.source === frame.contentWindow && event.origin === sandboxOrigin`.
- **The shell's CSP.** `frame-src` in `index.html` is `'none'` from `vite build` and the
  sandbox origin after `deployment write`. `script-src` and `connect-src` do not change.
- **`frame-ancestors`.** A deployer serves `sandbox/` with `Content-Security-Policy:
  frame-ancestors <shell origin>`. The Chromium suite's server does. A `<meta>` cannot set
  it, and phase 6's distribution documents it.

### 6.2 The view protocol

Pinned to MCP Apps 2026-01-26: JSON-RPC over `postMessage`. A resource is one HTML file
with its script and style inline, of type `text/html;profile=mcp-app`, fetched by the
shell from the package and sent as `html`.

| Direction | Method | Rule |
| --- | --- | --- |
| Proxy → host | `ui/notifications/sandbox-proxy-ready` | Then the host sends `ui/notifications/sandbox-resource-ready` with `{ html }` |
| View → host | `ui/initialize` | The result is below. Its `protocolVersion` is `2026-01-26` |
| View → host | `ui/notifications/initialized` | **The host sends nothing to a view before this** |
| Host → view | `ui/notifications/tool-input`, then `ui/notifications/tool-result` | Once per call of a bound command ([below](#which-calls-reach-a-view)) |
| Host → view | `ui/notifications/tool-cancelled` | When a bound call aborts or the app switches first |
| Host → view | `ui/notifications/host-context-changed` | On `appearance-*`, on resize and on a selection change: `theme`, `dev.loam/tokens`, `containerDimensions`, `dev.loam/selection` |
| Host → view | `ui/resource-teardown` | On a switch away from a view that has sent `initialized`, and the frame is removed after the answer or 500 ms. Before that, the frame is simply removed |
| View → host | `tools/call` | Brokered ([below](#the-broker)) |
| View → host | `resources/read` | Only the app's own `ui.resources`, read from the package. Anything else answers `-32602` |
| View → host | `ping` | Answered |
| View → host | `notifications/message` | Logged through the host's `reportError` at `error` level, ignored otherwise |
| View → host | `ui/notifications/size-changed` | Ignored: main's view has fixed dimensions |
| View → host | `ui/open-link`, `ui/message`, `ui/update-model-context` | `-32601`, with data naming phase 5. The capabilities do not offer them |
| View → host | `ui/request-display-mode` | Answers `{ mode: 'inline' }` |
| View → host | Any other method | `-32601` |

The `ui/initialize` result:

```json
{
	"protocolVersion": "2026-01-26",
	"hostInfo": { "name": "loam", "version": "<kernel interface>" },
	"hostCapabilities": { "serverTools": {}, "serverResources": {}, "logging": {}, "sandbox": {} },
	"hostContext": {
		"theme": "light",
		"platform": "web",
		"displayMode": "inline",
		"containerDimensions": { "width": 800, "height": 600 },
		"dev.loam/tokens": { "--color-surface-page": "#FFFEFA" }
	}
}
```

- **`theme`** is `dark` when `appearance-get`'s `resolved` is `dark`, otherwise `light`.
- **`dev.loam/tokens`** holds each of the contract's 108 component ids' custom property,
  with the resolved value from `getComputedStyle(document.documentElement)`, read in the
  view host's chunk from `@lushly-dev/loam-theme/contract.json`. Shell ids are not sent.
  **`styles.variables` is omitted in phase 1:** MCP Apps closes it to its standardized names
  (`--color-background-primary` and the rest), and `@modelcontextprotocol/ext-apps`' `App` refuses others at
  `ui/initialize`. `hostContext` is open, so Loam's ids take a `dev.loam/` key. The mapping onto standard names
  arrives with phase 5's foreign views ([13](#13-out-of-scope-and-the-seams-reserved)).
- **Size.** Main's view is fixed: `{ width, height }` of the part.

#### Which calls reach a view

- **A bound command.** `ui.surfaces.main.command` runs with `{}` when the view opens,
  in parallel with rendering, as MCP Apps' lifecycle has it. Its input and result wait until
  `initialized`.
- **A linked command.** A call of a command whose `tool_meta.ui.resourceUri` names the
  resource now rendered, from any interface, pushes `tool-input` then `tool-result` to
  it. If that resource is not rendered, nothing renders: a call never switches the app.

#### The broker

- `tools/call { name, arguments }` becomes `port.call(name, arguments)` on the view's own
  app port, so the checks of [5.3](#53-the-app-port) apply. This is a boundary for a
  view (D54). The checks are in the kernel, in `port.view` ([9.7](#97-decided-by-step-5)).
- **Visibility.** A command whose `tool_meta.ui.visibility` omits `app` is refused
  `-32602`. One that omits `model` is registered with `expose.agent = false`.
- **The result** is `{ content: [{ type: 'text', text: JSON.stringify(result) }],
  structuredContent: result, isError: !result.success }`.
- **Data.** A view gets only what is pushed to it or what it calls for. It never sees
  the journal, the session, the actor's credentials or another app's data.

### 6.3 The handler frame

Decides L5 (D61). A view app's commands must work with its view closed, and untrusted
code must not run in the shell's page, so the handlers run in their own sandbox.

- **Declared by** `view.handlers`: one HTML file, in the same inner iframe and under the
  same CSP as a view, created through a second proxy instance, hidden (`display: none`,
  `aria-hidden`, `tabindex="-1"`). A `view` manifest with commands needs it:
  `MANIFEST_SECTION_KIND` otherwise. A view app with no commands has none.
- **Lazy.** The kernel's port creates it on the first call to one of the app's commands.
  It is reused while the page lives.
- **`serveHandlers(definition)`** from `@lushly-dev/loam-sdk/view` runs in it. The same
  `defineApp` value runs native or here, so hello's handlers are written once.

| Direction | Method (JSON-RPC over the proxy) | Shape |
| --- | --- | --- |
| Frame → host | `dev.loam/handlers-ready` (notification) | `{ sdk: 1, commands: string[] }`. Checked against the manifest: `APP_HANDLER_MISSING` otherwise |
| Host → frame | `dev.loam/handler-call` (request) | `{ callId, command, input, context: { traceId, now?, randomSeed?, config, grants: string[] } }`, answered by a `CommandResult` |
| Frame → host | `tools/call` (request) | The broker, with `_meta["dev.loam/call"]: callId`, so it is a nested call of that handler call ([5.3](#53-the-app-port)) |
| Frame → host | `dev.loam/store` (request) | `{ callId, op: 'get' \| 'put' \| 'delete' \| 'list', key?, value?, prefix? }`. Refused `-32601` without the `store` grant |

- **Tied to a call.** The kernel uses `callId` to take the actor and the clock for a store record. A frame's
  `tools/call` or `dev.loam/store` with no `callId`, or one that is not in flight, as from a timer, is refused
  `HANDLER_NO_CALL`, so a frame cannot change anything outside a journaled command.

- **Clock and random in the frame.** `context.now()` returns the one reading the kernel
  took for this call, which is on the tape. `context.random()` is a `mulberry32` generator
  seeded from one tape value. Both are deterministic for replay.
- **Validation.** The kernel validates input before the call reaches the frame, as for a
  native handler.
- **Deadlines.** A frame that sends no `handlers-ready` in 10 seconds fails with
  `HANDLER_READY_TIMEOUT`. A call unanswered in 30 seconds fails with `HANDLER_TIMEOUT`, and the frame
  is discarded and re-created on the next call. A result that is not a `CommandResult`
  fails with `HANDLER_RESULT_INVALID`.
- **Replay.** The test kit's ports run the same definition in process, so a journal with
  view commands replays with no iframe.

## 7. Mounted server

### 7.1 How a browser reaches an instance

Decides L7 and D57's how (D64). **A browser host reaches an instance only at a same-origin
route, `mounts/<instance>/mcp` under the document's base.**

The proposal found that a direct connection needs CORS and preflights past Umbel's bearer
layer (U1), a CSP change, and a workspace token in the browser; Chrome's Local Network
Access adds a permission. It recommends the hosted server, and phase 6's hosted lane is
later. So:

| Phase | What serves the route |
| --- | --- |
| Phase 1, browser host | Nothing in a deployment: without a relay, an instance fails with `MOUNT_UNREACHABLE`, and is reported, not dropped. In the Chromium suite, the **test-only mount relay** |
| Phase 6, hosted lane | The hosted server, with the deployer's secrets. This route is its contract |
| Phase 6, desktop lane | Tauri's Rust host, over IPC, behind the same `MountTransportV1` |

**The relay.** `web/test/mounted/mount-relay.ts`, in the suite's server and in no `dist`:

- It takes `writeDeployment`'s `mounts` list.
- `POST`, `GET` and `DELETE` on `/mounts/<instance>/mcp` forward to `url`.
  - Forwarded request headers, an allow-list: `content-type`, `accept`,
    `mcp-protocol-version`, `mcp-session-id`, `mcp-method`, `mcp-name`, `last-event-id`.
  - It adds `authorization: Bearer <token>` and `host: <url's host>`. It sends no `origin`
    and no `cookie`, and drops any `authorization` from the page.
  - The status, `content-type`, `mcp-session-id` and the body stream back unchanged.
- A request with an `origin` other than the page's is 403. An unknown instance is 404.
- It records each request's method and headers for E4's assertions.

**What this proves, and what it does not.**

| Proved against a real Umbel | Not proved |
| --- | --- |
| The stock `umbel` binary, a real workspace, a mounted plugin, the bearer token over real Streamable HTTP with Umbel's Host and Origin checks | A hosted server: the relay is a test harness with no auth, membership, limits or deployment |
| The browser's MCP client under the shell's CSP, in both directions, with no CORS, CSP change or token in the page | Deployer secrets handling |
| Hybrid discovery through `afd-help` and `afd-detail`, renaming, prefixes, exposure, conflicts | A multi-member deployment: Umbel sees one principal (D55), and phase 1 has one Mock person and no projects |
| The console rendering it, untrusted labels, the journal's marks, replay with Umbel stopped | The desktop lane and stdio instances: `MOUNT_TRANSPORT_UNAVAILABLE` is all a browser can do |
| A failed instance is reported and skipped, and a restarted one recovers | Reach beyond loopback (Umbel's phase 5), resources and skills ([13](#13-out-of-scope-and-the-seams-reserved)) |

STATUS.md and the exit run say "through a test-only relay".

**Nothing is asked of Umbel.** Loam is one more MCP client under Umbel D32's loopback and
token rules: no Umbel schema, file or code changes, and U1 to U4 stay Umbel's owner's.

### 7.2 The Umbel instance in the suite

D57 asks for a real instance, shown in the console. The suite's `web/test/mounted/umbel-fixture.ts`:

- **Binaries.** `web`'s `build:umbel`, run by `test:mounted` first, runs in `endpoints/umbel`:
  `cargo build --locked -p umbel --bin umbel` (default features, the combination
  `umbel.yml` tests; wasmtime makes it heavy, so CI caches it) and `cargo build --locked -p
  umbel-plugin-hello --features mounted --bin hello-mcp`. The harness finds them in
  `$LOAM_UMBEL_TARGET_DIR`, else `$CARGO_TARGET_DIR`, else `endpoints/umbel/target`, under
  `debug/`. A missing binary fails with the command to build it.
- **Plugin.** Umbel's own hello plugin, in its mounted build, because the stock binary
  compiles in no plugin (`src/main.rs:13-17`) and the component build needs `wasm32-wasip2`.
  `createUmbelWorkspace(dir)`:
  1. runs `umbel init <dir>`;
  2. lays out `plugins/hello/` as `tests/support/mounted.rs:77-84` does: `umbel-plugin.toml`
     from `manifests/mounted.toml`, `bin/hello-mcp`, `packs/`, `skills/`;
  3. appends `[plugins]` `enabled = ["hello"]` to `umbel.toml`.
- **Start.** `umbel --workspace <dir> serve --http --bind 127.0.0.1:0`. The harness reads
  the port from the stderr line, matching `umbel listening on http://127\.0\.0\.1:(\d+)/mcp` (the line goes on
  to name the token file), waits at most 30 seconds, and then writes the deployment, with `bearer_file =
  <dir>/state/keys/http.token`. It stops the process with SIGTERM.
- **Manifests.** The harness packs both with `loam app pack`. `web/test/mounted/apps/umbel/loam-app.toml` is
  the proposal's headless `umbel` manifest, verbatim. It is a test fixture: the first-party `umbel` app stays after
  Umbel's phase 2 and Loam's phase 5 (D57). `apps/hello/manifests/mounted.toml` is hello's,
  with `prefix = "hello"` and `only = ["hello-greet"]`.
- **Expected names.** Under the `umbel` manifest with prefix `work`:
  `work-hello-greet`, `work-workspace-show`, `work-event-ack`, and the rest. Under
  hello's: `hello-greet`, because the manifest's prefix is replaced by the instance's.
  With `hello-greet { name: 'Ada', space: 'main' }`, Umbel's `data` is `{ greeting: 'Hello,
  Ada!', space: 'main', at }` (`tests/hello_three_ways.rs`).

### 7.3 The transport and discovery

```ts
// In the kernel: a port the host supplies.
export interface MountTransportV1 {
	connect(signal?: AbortSignal): Promise<{ protocolVersion: string }>;
	listTools(signal?: AbortSignal): Promise<McpTool[]>;
	callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpToolCallResult>;
	close(): Promise<void>;
}
```

- **The web host's implementation** is a chunk loaded only when a deployment lists a
  mounted app. It wraps `StreamableHttpTransport` from the new
  `@lushly-dev/afd-client/streamable-http` (step 0a), with `mode: 'auto'`, the route as
  `url`, and no headers. #655's `/direct` is a different entry and stays phase 5's; the
  chrome does not use `DirectClient` (the SDK's client wraps the app port).
- **Discovery** is `discoverInstance(entry, manifest, transport)` in `kernel/src/apps/`, and only
  the command `app-instance-refresh` runs it, so every discovery is journaled with what it found. `startInstances()`
  calls that command for each `http` instance, in the background after first paint, with a 10-second deadline per
  instance, and so do the [triggers below](#when-to-discover-again):
  1. `connect`.
  2. `listTools`, for the first-class tools' `_meta` and to learn the strategy.
  3. `callTool('afd-help', { format: 'full' })`, by name (H7, H8). A tool error or a result
     that is not a `CommandResult` is `MOUNT_NOT_AFD`: phase 1 mounts AFD servers (D9), and
     its suggestion names a plain MCP server as phase 5's.
  4. Take `commands` from it, dropping `afd-*` names and, when `mount.only` is set, any name
     outside it. `afd-*` tools are the loader's means and never become Loam commands.
  5. `callTool('afd-detail', { command: [...] })`, ten names at a time, for each command's
     `inputSchema`, `title`, `description`, `mutation`, `destructive`, `undoable`, `approval`,
     `callable`. An entry with `found: false` or `callable: false` is dropped, and a `found: false` is a
     warning.
  6. Rename each by `mountCommandName(manifestPrefix, prefix, original, override)` in `manifest`, the
     [renaming rule of `spec/plugin-manifest.md`](../../../../../spec/plugin-manifest.md#instances), whose test runs that file's
     `renaming` cases. A tool with no valid name is reported in the instance's `warnings` as
     `MOUNT_TOOL_UNNAMEABLE`, not registered.
  7. Apply `mount.tools[]` overrides, then the entry's `commands` overrides, per
     [7.4](#74-exposure-and-trust).
  8. Name refusal, conflicts ([10](#10-failure-modes-and-error-codes)), then rebuild the
     registries.
- **A call.** A mounted command's definition is `defineCommand({ name, title, description,
  input: z.looseObject({}), advertisedInputSchema: schema, mutation, destructive, undoable,
  expose, handler })`. The server validates input; the console's form validates what it
  can first. The handler sends a first-class tool by its own name, any other through
  `afd-call { command, input }` (the proposal's rule), never setting `confirm`, with a
  60-second deadline, or the caller's `signal`.
- **The result.** `parseMountedResult(result)` in `kernel/src/apps/mounted.ts` takes `structuredContent`, else
  parses the text content. It must be an object with a boolean `success`, and a failure must have an `error` with
  string `code` and `message`; a server is untrusted, and `isCommandResult` in `packages/client` checks only
  `success` and is not exported. Otherwise it fails with `MOUNT_RESULT_INVALID`. To `metadata` it adds
  `dev.loam/trust: 'untrusted'` and `dev.loam/instance`, keeping whatever the server sent:
  Umbel's `dev.umbel/trust`, `dev.umbel/replay`, and `trust: "content"` inside `data`.
- **Confirmations.** No `onElicitation` is given in phase 1. A command that needs one
  returns Umbel's `CONFIRMATION_REQUIRED` or `INPUT_REQUIRED` with its suggestion, which the
  console shows. Approval evidence never comes from tool arguments.
- **Under the CSP.** Zod keeps its configuration on `globalThis`, so the web host's `zodJitlessByDefault` also covers
  a second copy of Zod in this chunk, and E3's CSP check holds that.
- **Credentials.** The kernel holds none. It forwards no person's token. The `Authorization`
  header exists only between the relay and the instance.

#### When to discover again

Decides the rest of L6:

- at boot;
- on `app-instance-refresh`, which the console's "Refresh" button calls;
- once, automatically, when a call answers `COMMAND_NOT_FOUND`, at most once per instance
  per 30 seconds, after which the call's failure is returned as it was.

A command that disappears is unregistered, and `app-instance-list` says so. A refresh that
fails keeps the last good commands, sets `state: 'failed'`, and calls to them return
`MOUNT_UNREACHABLE` until a refresh succeeds. The automatic trigger calls `app-instance-refresh` like any other.
The chrome re-reads `app-list` and `listCommands` after a successful `app-instance-refresh`.

### 7.4 Exposure and trust

Decides L3 and L10 (D65). A mounted tool carries no Loam flags, so the instance entry is the
callee's declaration, which annotates D30.

| Effective | Mutation in Loam | Exposure |
| --- | --- | --- |
| Not a mutation | No, for display and defaults | The entry's `expose`, each defaulting to on; `mcp` and `cli` off |
| A mutation, or nothing reported | **Yes** | All off, until named under `commands` |
| `destructive: true` | As reported | Off until named, like a mutation; the console shows "Destructive" |

- **Precedence**, for whether a command is a mutation: the server's `mutation`; then the manifest's
  `mount.tools[].effects`, by `deriveMutation`, since a deployer chose that package; then the entry's
  `commands."<name>".effects`. For `destructive`: the server's, then the entry's. A command named under `commands`
  takes exposure from there, a flag left out being off; every other takes the table's.

- **Annotations are the server's own claim.** They set display and defaults and are never a
  security decision: the server is untrusted (D41, Umbel D43), and the entry's overrides win.
  `app check` and `deployment check` say so with `MOUNT_ANNOTATIONS_UNTRUSTED`.
- **`approval`** reported as `required` is displayed. Enforcement is the server's own
  until phase 5.
- **Trust.** Every result carries `dev.loam/trust: 'untrusted'`. The console labels it.
  The copilot's use of the label is phase 5.

### 7.5 A mapped space is pinned

Decides L9 (D65). `pinMountedInput(entry, scope, schema, input)` in `kernel/src/apps/mounted.ts`:

- With no active project, or a project with no mapping: the input is unchanged. Umbel's
  default space and its other spaces stay reachable.
- With a mapping, and a schema that has a `space` property: it sets `space`. A different
  `space` in the input, or any `spaces`, is refused with `MOUNT_SPACE_PINNED`, naming the
  project and the space. This is Loam's policy on its own calls, not a boundary inside
  Umbel.

Phase 1 has no project, so the call site passes `scope: null`. The function ships with its
unit tests, so phase 2 only supplies the scope.

### 7.6 Journal behaviour

Recorded, not replayable (architecture section 8).

- **Declared context fields** (`spec/context-fields.md`), on both registries, all
  `journal: true`, all set only by the kernel:

  | Name | `_meta` key | Value |
  | --- | --- | --- |
  | `caller` | `dev.loam/caller` | The calling instance, when an app called. Absent for a person or agent |
  | `app` | `dev.loam/app` | The owning app id of an app or mounted command |
  | `instance` | `dev.loam/instance` | The owning instance |
  | `replay` | `dev.loam/replay` | `recorded`, on a mounted command's call. Absent otherwise |
  | `parent` | `dev.loam/parent` | The outer call's trace ID, on a nested call ([5.3](#53-the-app-port)) |

  The proposal's worked example, `instance: work, app: umbel`, is this.
- **A mounted call's entry** has `context.replay: 'recorded'` and the whole result. A result
  over 256 KiB of JSON is recorded by `redact` as `{ success, error?, metadata, data: {
  truncated: true, bytes } }`: a journal is not a mounted server's archive.
- **`app-instance-refresh`** is a journaled mutation with `replay: 'recorded'`, and its
  `data.catalog` holds what discovery built. A replay rebuilds the commands from it.
- **Replay.** `replayKernel(entries, { deployment, ports })` passes `replayJournal` a target that wraps the
  registries' `execute`, and looks up the entry it is replaying by trace ID:
  - An entry with `replay: 'recorded'`, or a command in `REPLAY_RECORDED_QUERIES` (`app-list`, `app-get`,
    `app-command-list`, `app-instance-list`, whose answers depend on what has loaded), is answered with its recorded
    result, with no network and no handler. `app-instance-refresh` first registers its `data.catalog`, so later
    state holds. A local failure such as `MOUNT_UNREACHABLE` is replayed the same way.
  - An entry with `parent` is not replayed on its own. The outer handler runs, its nested query goes through
    the port, and the replay's port answers from the entries with that `parent`, in order.
  - Everything else re-executes and is compared.

  So a journal with mounted calls replays with Umbel stopped. Each such entry's status is `same`, and the kernel's
  report adds `recorded: number[]`, the `seq`s answered from the record, so nothing claims they re-ran.
- **Not replayable** means a replay does not reach the server and cannot show that the server
  would answer the same. The console says "Recorded, not replayable".

### 7.7 The minimal console

The console is the mounted kind's renderer and every new app's first UI (D48), minimal in
phase 1, complete in phase 5. It uses the SDK's `LoamClientV1` only, so it has no kernel
dependency.

- **Where.** `loam-console` renders in main's mount when a manifest has no
  `ui.surfaces.main`, in every kind. It is the chrome's, trusted, so its elements are defined
  in that mount's registry, and its client makes a person's calls (no `caller`).
- **What it shows.**
  1. A heading `h1`: the app's title, and the trust line of `app-get`.
  2. Notices: D55's, and a failed instance's error with its suggestion and a "Refresh" button.
  3. For a mounted app: its transport, the instance state, the command counts, and "*n* hidden:
     the deployer exposes these".
  4. A filter field over the command list, a `violet-listbox`. Each row: the command's title or
     name, and "Changes data" or "Destructive" when so.
  5. For the selected command: its description as plain text, the form, and "Run".
  6. The result, in a `region` named "Result", with `status` live text saying success or failure.
- **Forms from input schemas.** `renderForm(schema)` in `console/src/form.ts` is pure and unit-tested:

  | Schema | Control | Sent |
  | --- | --- | --- |
  | `string` | `violet-text-field`; `violet-text-area` when `maxLength` exceeds 200 | The string; an empty optional is omitted |
  | `string` with `enum`, or `anyOf` of `const` strings | `violet-select` with `violet-option`s; an empty first option when optional | The value |
  | `boolean` | `violet-checkbox`; optional starts unset and is omitted unless changed | The boolean |
  | `number`, `integer` | `violet-text-field` with `type="number"` | A number; `integer` refuses a fraction |
  | `array` of `string` | `violet-text-area`, one per line | An array; empty lines dropped |
  | Anything else: `object`, other arrays, `anyOf`, `oneOf`, `$ref`, no `type` | `violet-text-area` labeled "JSON" | `JSON.parse`, refused inline when invalid |
  | No properties | No control; "No input" | `{}` |

  - Each control's label is the property's `title` or its name, and its description is the
    field's helper text. Required properties are marked and set `required`. `default` pre-fills.
  - The form checks `required`, `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` and
    `enum` before it calls, with `aria-invalid` and a message per field. The server remains the
    authority: its `VALIDATION_ERROR` shows with its suggestion.
  - A `pattern` that does not compile is skipped. Unknown keywords are ignored.
- **Results through the adapters.** `WebAdapter.renderCommandResult(result, { styling: 'classes' })`
  (step 0b), set with `innerHTML` in the console's own shadow root. The adapter escapes every value.
  Nothing from a server is rendered as markup, as a link or as markdown. The console's stylesheet
  maps the adapter's `afd-status-*` classes to `color.state.*`.
- **Labels on each result.**
  - `dev.loam/trust` shows "Untrusted: from *instance*";
  - `metadata["dev.loam/replay"]` shows "Recorded, not replayable", beside `metadata["dev.loam/seq"]`, which
    the kernel's `run` adds to every result it returns, after journaling, so a client needs nothing more;
  - the server's own `dev.umbel/trust` is shown as it came.
- **Keyboard.** Filter, list, form, Run, in order. Enter in a single-line field runs. A running
  call disables Run and shows `violet-spinner`.
- **Not in phase 1, seams in** [13](#13-out-of-scope-and-the-seams-reserved): the journal of
  calls and the usage view, resources and skills, a generic document editor, elicitation.

## 8. Overlays in phase 1

The exit criterion needs a toast and a modal. Phase 1 builds those two kinds under the
architecture's policy table; phase 4 completes the manager (D67). A later kind extends this,
with no change to these commands.

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `toast-show` | mutation | `{ message: string (1 to 200); tone?: 'info' \| 'success' \| 'warning' \| 'danger'; durationMs?: 1000 to 30000, default 5000 }` | `{ overlayId, owner, kind: 'toast', lifetime: 'transient' }` |
| `modal-open` | mutation | `{ title: string (1 to 80); body: string (1 to 1000); confirmLabel?; cancelLabel?; danger?: boolean }` | `{ overlayId, owner, kind: 'modal', lifetime: 'session' }` |
| `overlay-dismiss` | mutation | `{ overlayId; result?: 'confirm' \| 'cancel'; reason?: 'timeout' \| 'user' }`. `result` defaults to `dismissed` for a toast and `cancel` for a modal | `OverlayResultV1` |
| `overlay-list` | query | `{}` | `{ overlays: OverlayV1[] }`; only the caller's own when an app calls |

- **Owner.** `caller`, or `shell` when absent. A person's or agent's call is `shell`-owned.
- **Ids.** `ovl-<n>`, a counter in the kernel, so a replay reproduces them.
- **Text only.** A modal holds a title, a body and two buttons, as text. An app's own
  element in a modal arrives with phase 4.
- **Refusals.** `OVERLAY_OWNER_INACTIVE`: a `modal-open` from an app that is not active. A
  toast from any app is allowed, as the architecture says. `OVERLAY_MODAL_BUSY`: a modal
  already open. `OVERLAY_NOT_FOUND`. `OVERLAY_NOT_OWNER`: an app dismissing another's.
- **On app switch**, inside `app-open` and `app-close`, atomically and before the new app's
  surfaces render:
  - the previous owner's toasts are dismissed with `reason: 'app-switch'`;
  - its modal is cancelled, `result: 'cancel'`, `reason: 'app-switch'`, reported to
    `waitOverlay`;
  - `shell`-owned toasts stay; a `shell`-owned modal also stays, and refuses the switch with
    `OVERLAY_MODAL_BUSY`.
- **Stack cap.** Five toasts. A sixth dismisses the oldest with `reason: 'cap'`.
- **Timer.** The chrome runs a toast's timer and calls `overlay-dismiss { reason: 'timeout' }`.
  A replay has no timer: the journal's entry does it.
- **Rendering.**
  - `loam-toast-region` is `role="status"`, `aria-live="polite"`, in the top layer with
    `popover="manual"`, at the inline-end block-end corner; a `danger` toast's item is
    `role="alert"`. `loam-toast` is one item, using `color.state.*` and `shadow.floating`, with
    a dismiss button.
  - `loam-modal` is a native `<dialog>` opened with `showModal()`, heading in `h2`, focus on
    the cancel button when `danger`, otherwise confirm. Escape cancels. Focus returns to the
    invoker. It wraps Tab as the drawers do (phase 0, 7.1).
- **The one-modal rule (phase 0, 5.3).** The modals are now the palette, a compact drawer and
  an app's modal. `modal-open` while the palette or a drawer is open closes those first, as
  the palette closes a drawer. Mod+K while a modal is open does nothing, and `palette-open`
  answers `OVERLAY_MODAL_BUSY`.
- **Re-reads.** The shell re-reads `overlay-list` after a successful mutation of `toast-*`,
  `modal-*`, `overlay-*`, `app-open` and `app-close`.
- **`SDK overlays.modal`** calls `modal-open`, then `waitOverlay`.

## 9. The kernel and the chrome

### 9.1 Kernel interface, version 1

```ts
export const KERNEL_INTERFACE_VERSION = 1;

export interface LoamKernelV1 {
	readonly version: 1;
	call<T = unknown>(name: string, input?: unknown, options?: CallOptionsV1): Promise<CommandResult<T>>;
	listCommands(): CommandSummaryV1[];
	subscribe(listener: (event: KernelEventV1) => void): () => void;
	readonly agent: Pick<LoamKernelV1, 'call' | 'listCommands'>;
	/** The port for one instance, for the chrome to give an app. */
	appPort(instance: string): AppPortV1;
	/** The reserved chords, then the active app's bindings (4.2). */
	listKeybindings(): ShellKeybindingV0[];
	/** Calls `app-instance-refresh` for each mounted instance. The chrome calls it after first paint. */
	startInstances(): Promise<void>;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export type CallOptionsV1 = CallOptionsV0;

export interface CommandSummaryV1 extends CommandSummaryV0 {
	/** The owning instance. Absent for a shell command. */
	instance?: string;
}

export interface KernelEventV1 extends KernelEventV0 {
	caller?: string;
	instance?: string;
}

/** Every URL a port receives is absolute, resolved by the kernel against `baseUrl` (9.5). */
export interface KernelPortsV1 {
	/** The document's base, which a package's relative path resolves against. */
	readonly baseUrl: string;
	fetchJson(url: string): Promise<unknown>;
	fetchText(url: string): Promise<string>;
	importNative(url: string): Promise<AppDefinitionV1>;
	openHandlerFrame(instance: string, html: string): Promise<HandlerFrameV1>;
	mountTransport(entry: ProjectionMountedV1, url: string): Promise<MountTransportV1>;
}

export interface HandlerFrameV1 {
	/** Resolves with the frame's command names, from `dev.loam/handlers-ready`. */
	readonly ready: Promise<string[]>;
	call(request: { callId: string; command: string; input: unknown; context: unknown }, signal?: AbortSignal): Promise<CommandResult>;
	/** The frame's `tools/call` and `dev.loam/store`, answered by the kernel. */
	onRequest(handler: (method: string, params: unknown) => Promise<unknown>): void;
	close(): void;
}

export interface KernelOptionsV1 extends Omit<KernelOptionsV0, 'commands'> {
	commands?: ZodCommandDefinition[];
	/** The browser projection, already validated by the host through `readProjection` (9.4). */
	deployment?: ProjectionV1;
	/** Required when `deployment` lists an app. */
	ports?: KernelPortsV1;
}
```

- **The move.** `LoamKernelV0` and its types stay exported from `kernel/src/types.ts` for the
  `extends` above. The chrome checks `version === 1`, and its full-page mismatch error still
  names both.
- **`createKernel`** rejects only as phase 0 does, for a bad name in `options.commands`
  (E8 of phase 0 holds). A bad **app** never rejects it: it is reported ([10](#10-failure-modes-and-error-codes)).
- **Registries are rebuilt.** A direct registry is fixed when built, so a change to the
  command set builds two new registries over the same definitions and the same journal
  middleware instance, so one journal sequence. The auth middleware closes over its `exclude`
  list, so it is a new instance over the same adapter. In-flight calls finish on the old registries.
  The palette index is dropped with them.
- **App commands** come from the manifest:
  `defineCommand({ name, title, description, category, tags, version, requires, undoable,
  destructive, errors, examples, contexts, toolMeta, input: z.fromJSONSchema(inputSchema),
  advertisedInputSchema: inputSchema, output, mutation: deriveMutation(effects),
  expose, handler })`, where `handler` loads the module lazily and calls the app's handler
  with the `AppCallContextV1`. Input schemas that `fromJSONSchema` cannot express are
  refused at load.
- **No DOM.** `ports` are how the kernel reaches a module, a frame or the network, so tests
  and replay pass fakes. `kernel/src/apps/` is imported dynamically when a deployment lists
  an app, so the empty shell's kernel chunk is unchanged but for the commands below.

**Commands added**, all with `SHELL_EXPOSE`:

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `app-list` | query | `{}` | `{ active: string \| null, apps: AppSummaryV1[] }` |
| `app-get` | query | `{ instance }` | `AppDetailV1` |
| `app-open` | mutation | `{ instance }` | `{ active, previous }`; undo is `app-open` with `previous`, or `app-close` |
| `app-close` | mutation | `{}` | `{ active: null, previous }`; undo is `app-open` |
| `app-command-list` | query | `{ instance }` | `{ commands: Array<CommandSummaryV1 & { inputSchema; destructive?; replay?: 'recorded' }>, hidden: number }` |
| `app-instance-list` | query | `{}` | `{ instances: AppInstanceV1[] }` |
| `app-instance-refresh` | mutation | `{ instance }` | `{ instance, state, commands: string[], catalog }`; no undo; `replay: 'recorded'` |
| `app-selection-get` | query | `{ instance }` | `{ id: string \| null }` |
| `app-call-refuse` | internal | `{ command }` | Always `CALL_NOT_GRANTED`. Not in `listCommands` |
| `app-nested-refuse` | internal | `{ command }` | Always `NESTED_MUTATION_REFUSED`. Not in `listCommands` |
| `app-modal-refuse` | internal | `{ command }` | Always `OVERLAY_COOLDOWN`, for a view ([9.7](#97-decided-by-step-5)). Not in `listCommands` |
| `app-selection-set` | mutation | `{ instance; id: string \| null }` | `{ id }`; undo restores it |
| `status-item-set` | mutation | `{ id; value: string (0 to 40) }` | `{ id, value }`. Only the owning app; `shell` may not. An unknown id is `STATUS_ITEM_UNKNOWN` |
| `toast-show`, `modal-open`, `overlay-dismiss`, `overlay-list` | [Section 8](#8-overlays-in-phase-1) | | |

```ts
export type AppStateV1 = 'ready' | 'loading' | 'failed' | 'refused';

export interface AppSummaryV1 {
	instance: string;
	app: string;
	title: string;
	kind: 'native' | 'view' | 'mounted';
	icon: string;
	order: number;
	state: AppStateV1;
	/** Set when `state` is `failed` or `refused`. */
	error?: CommandError;
}

export interface AppDetailV1 extends AppSummaryV1 {
	version: string;
	/** "Trusted, not sandboxed", "Sandboxed", or "External". */
	trust: 'trusted' | 'sandboxed' | 'external';
	trustLine: string;
	surfaces: string[];
	compositions: string[];
	grants: Array<{ name: string; required: boolean; served: boolean; reason: string }>;
	contexts: string[];
	skills: string[];
	warnings: ManifestRefusal[];
	notices: Array<{ code: string; message: string }>;
	/** Each status item's value, for the ones the app has set (9.5). */
	statusItems: Record<string, string>;
}

/** Never a location, a credential or a command line. */
export interface AppInstanceV1 {
	instance: string;
	app: string;
	prefix: string;
	audience: 'team' | 'person';
	transport: 'http' | 'stdio';
	state: AppStateV1;
	protocolVersion?: string;
	toolStrategy?: string;
	commands: number;
	hidden: number;
	discoveredAt?: string;
	error?: CommandError;
	warnings: Array<{ code: string; message: string }>;
	notices: Array<{ code: string; message: string }>;
}
```

- **`shell-info-get`** gains `manifestVersion: 1`, `appProtocol: 1`, `surfaceCatalog: 1`,
  `compositionLibrary: 1`, `sdk: 1`, and reports `kernelInterface: 1`.
- **`metadata["dev.loam/seq"]`.** `run` adds it to the result of a person's or agent's call, when the call was
  journaled, and does not change the journal's copy. Never to an app's: a seq counts every app's calls, and a handler may
  return a nested result as its own, which would put the number in the journal.
- **`palette-search` and `listCommands`.** `listCommands` returns all the palette registry's
  commands, each with its `instance`. `palette-search` shows shell commands and the active
  app's only (the catalog's "filtered by active app"). An inactive app's commands stay
  callable by name, and `kernel.agent.listCommands()` lists them all.
- **Domains.** `status` joins the shell domains (D68). `app`, `toast`, `modal` and `overlay`
  are already in the architecture's list.
- **Replay.** `REPLAY_IGNORE` is unchanged; [7.6](#76-journal-behaviour) handles what depends on loading.
  `SESSION_50` keeps its calls, and its fixture is regenerated with `session:record`, since `shell-info-get` has
  new fields. The kernel's tests use a fixture app `probe` in `kernel/src/testing`, so the kernel names no real app. `web`'s
  `test/browser/apps/session-apps.ts`, which opens hello and tally, calls commands, opens overlays and switches, is E9's
  scripted session.

### 9.2 The budget

Phase 0's ceilings in 8.1 of its specification hold unchanged for the empty shell. The kernel's
new commands are small and the rest is lazy:

| Measure | Loaded | Ceiling |
| --- | --- | --- |
| JavaScript before first paint, the empty shell, minified and gzip | As phase 0 | 320,000 and 95,000. Step 3 measured 319,794 and 93,012: 206 bytes were left, so step 4's chrome goes behind dynamic imports. Step 4 measured 317,922 and 94,024 ([9.6](#96-decided-by-step-4)) |
| The kernel alone | As phase 0, without `src/apps/` | 231,360. Step 3 measured 225,238 |
| CSS | As phase 0 | 8,496 |
| `apps` chunk: the kernel's `src/apps/`, the readers and validators | When a deployment lists an app. An empty projection never loads it | 300,000. Step 1 measured the readers and the page's validators alone at 227,031 minified, 32,302 gzip, without Zod, which the kernel shares: a closing profile's standalone validator under `allErrors` is mostly error objects, which minify poorly and compress well. The first estimate, 150,000, was not measured. The coordinator approved 300,000 on 2026-11-01 as an estimate: it did not yet hold the kernel's `src/apps/`. Step 3 measured the page's whole `apps-*.js` chunk at 262,730, and `budget` has the row. Step 4 confirms the ceiling: 265,155 over three chunks, 88% of it, so it is neither raised nor lowered ([9.6](#96-decided-by-step-4)) |
| `surfaces` chunk: the chrome's `AppSurfaces` and its elements, with `loam-mount`, the nav's entries and the overlays, and what it imports that first paint has not loaded, such as the listbox | When a deployment lists an app, or the first toast or modal on a shell with none | 85,000. A row step 4 adds, for what 9.2 did not name. Step 4 measured 76,622 |
| `mount` chunk: the MCP client | When a deployment lists a mounted app, after first paint | 340,000 (the measured 324,094 before Rolldown shares Zod) |
| `console` chunk | When a console renders | 150,000 |
| `view` chunk: the view host | When a view app opens, or a view app's command is first called | 25,080. Step 5 measured 22,800, under 70% of the first ceiling of 60,000, so it is lowered by phase 0's rule ([9.7](#97-decided-by-step-5)) |
| `kit` chunks | Per element, on `kit.define` | None |
| Hello's native bundle, tally's | The app's own; recorded, not limited | None. Step 4 measured 65,024 (gzip 17,897) and 79,167 (21,338), each with its own FAST |

`budget` gains the rows, and fails over them. Step 4 records the measured values; phase 0's rule
applies: under 70% of a ceiling, it is lowered to the measurement plus 10%, and raising one
needs an amendment. If the empty shell exceeds its ceilings, the step moves code behind
a dynamic import rather than raising them.

### 9.3 The chrome

New elements, each under the [component checklist](../../design.md#the-component-checklist), each
with a line in `design.md`'s component list and a Specimen fixture:

| Element | What |
| --- | --- |
| `loam-mount` | The mount contract ([5.4](#54-scoped-registries-and-the-mount)) |
| `loam-list` | A `list` sidebar: a `violet-listbox` over `{ items }`, empty and error states |
| `loam-part-header` | Main's header surface: title and action buttons |
| `loam-toast-region`, `loam-toast`, `loam-modal` | [Section 8](#8-overlays-in-phase-1) |
| `loam-view-frame` | The sandboxed view's outer iframe and protocol host, with loading and failed states |
| `loam-console` | [Section 7.7](#77-the-minimal-console), from `@lushly-dev/loam-console` |

- **One controller.** `loam-shell` stays the only element holding the kernel (phase 0, 7.1).
  It gains `AppSurfaces`, a controller class in `chrome/src/apps/`, which owns mounts and
  parked elements and re-reads `app-list` after `app-open`, `app-close`,
  `app-instance-refresh`, and at boot.
- **Status items.** The right side of the status bar renders the active app's items, as
  `loam-status-item`, each a button when it has a `command`, sorted by `priority` then id.
- **The header.** Rendered inside `loam-main` above its slot, only when declared.
- **Page heading.** An app's main is responsible for its `h1`, with `app check` unable to
  verify it. The console and landing pages have theirs. The axe runs in E11 catch a miss.
- **The landing's `h1`** does not render while an app is active.

### 9.4 Web host

```ts
// src/main.ts; `zodJitlessByDefault` in the build starts Zod jitless (9.5)
const raw = await fetch('deployment.json').then((response) => response.json());
// A hand-written check in the first-paint bundle: only a projection that lists apps loads the reader.
const deployment = isEmptyProjection(raw) ? undefined : await readOrNotice(raw);
const host = await createHostKernel({ environment, deployment, ports: webPorts(document) });
```

- **`readOrNotice`** imports `@lushly-dev/loam-manifest/validate` dynamically and calls `readProjection`. The host
  owns this, and `createKernel` takes only a validated value.

- **`webPorts`.** `fetchJson`, `fetchText` (same-origin `fetch`), `importNative` (`import(/* @vite-ignore */ url)`,
  under `script-src 'self'`, with the absolute URL, since a relative one would resolve against the chunk),
  `openHandlerFrame` (delegates to the chrome's frame code), `mountTransport` (a dynamic import of the mount chunk).
- **Failure.** A `deployment.json` that does not parse or fails `readProjection` shows "Loam
  cannot start", with the refusal, as an unopenable store does.

### 9.5 Decided by step 3

What the sections above left open, and what the code showed. Later steps build on these.

**The budget: 9.2's premise was wrong about Zod, and the rows hold another way**

- **What 9.2 missed.** It measured the readers "without Zod, which the kernel shares", as if a lazy chunk cost the
  first-paint chunk nothing. `z.fromJSONSchema`'s file builds `const z = { ..._schemas, ..._checks, iso: _iso }`.
  That spread uses every export of Zod's classic schemas and checks, a bundler tree-shakes across the whole graph and
  not per chunk, and a module is split whole. So the first dynamic import of `fromJSONSchema` put the rest of Zod's
  classic API in the shared first-paint chunk: 351,858 bytes of JavaScript against 320,000, and 278,421 for the kernel
  against 231,360.
- **`narrowZodFromJsonSchema`** (`web/scripts/narrow-zod.mjs`), a Vite plugin in `web`'s build and `budget`, writes that
  object out with the names the file reads, so the rest tree-shakes. It changes no behaviour, and stops the build on a
  name it cannot place or a file of another shape. A unit test bundles it and holds its answers equal to Zod's own for
  every keyword and format listed there. A host built without it works and is larger. The formats `fromJSONSchema` reads stay in the shared chunk,
  about 11 KB, because they are used from a module that is shared.
- **`budget`'s rows.** The kernel row measures what phase 0's did, the kernel with its dependencies and without
  `src/apps/`, which the empty shell never loads, so it does not count those 11 KB (Zod there is 178,126, as in phase
  0). The page's row does count them, and it is the one that matters. The `apps` row reads the page's own `apps-*.js`
  chunk, because Vite's library mode for ES does not remove whitespace, which measured 367,314 for the same code.
- **`zodJitlessByDefault`,** in the same file, because splitting broke phase 0's way of setting `jitless`. The entry's `config({ jitless: true })`
  runs after the shared chunk it imports, whose top-level object schemas already ran Zod's `new Function` probe: a CSP violation on every page,
  which the Chromium suite caught. Making the first import a module of its own would not help, since it imports `config` from that same chunk. So
  the build starts Zod's global configuration `jitless`, in every chunk, and the file is checked as above. `src/zod-jitless.ts` stays for a
  page built as one chunk, the accelerator page.
- **What moved behind the dynamic import,** so the shell stays under: everything the app commands do but their
  definitions (`apps/operations.ts`), the two internal commands, and `LAYOUT_DEFAULTS_V0`, which has its own module in
  `manifest` so that it does not bring the catalogs. With no app listed, `EMPTY_APPS` answers. `budget`'s row for the
  page's JavaScript now has 206 bytes left.

**The interface**

- **`KernelPortsV1.baseUrl`.** 9.1 said a port's URLs are absolute, "resolved against the document's base by the kernel's
  caller", and the kernel has no document, and is itself the caller of a port. So the host gives the base with the
  ports, and `webPorts(document)` sets it from `document.baseURI`.
- **No ports.** `ports` is optional, and `createKernel` rejects only as phase 0 does, so a deployment with no ports refuses
  each app with `APP_PACKAGE_UNAVAILABLE`.
- **`app-nested-refuse`** is the second internal command, because section 10 has a nested mutation's refusal journaled, and
  `app-call-refuse` is always `CALL_NOT_GRANTED`.
- **`statusItems` in `app-get`.** Nothing in 9.1 lets the chrome read a value `status-item-set` wrote. A value stays
  across a switch, since an app has no callback for coming back, and the chrome renders the active app's alone.
- **`port.store`** is for the chrome and tests, and an app's surface never gets it: a write there is not journaled.
- **A refused request from a frame.** `onRequest`'s handler rejects with a `LoamKernelError`, whose `details.rpcCode` is the
  JSON-RPC code. So step 5's host sends that code, with `data: { code, suggestion }`, which is what the SDK reads
  (11.2). `HANDLER_NO_CALL` is `-32600`, a store with no grant `-32601` and a hidden command `-32602`, both `VIEW_CALL_REFUSED`
  rather than `CALL_NOT_GRANTED`, which is always journaled, and malformed parameters `-32602`.
- **Handlers.** A native handler that throws or answers no `CommandResult` gets the frame's codes, `HANDLER_THREW` and
  `HANDLER_RESULT_INVALID`. A native throw's message goes to the page's `reportError`, not the result or the journal, as AFD's engine
  does; a frame's `HANDLER_THREW` still carries it (11.2), superseded by [9.7](#97-decided-by-step-5): neither carries it. A frame's call that rejects otherwise, as an abort does, is `CALL_ABORTED`.
- **`deactivate` is the chrome's,** since `activate` is: a module loaded only by a command never activated, and the kernel cannot tell.
  So step 4's `AppSurfaces` runs it at disposal, for what it activated, and 5.5's row holds there.
- **A failed `apps` chunk** rejects `createKernel`, and the host shows "Loam cannot start": no app can load, and nothing in the kernel can list them. Superseded by [9.6](#96-decided-by-step-4): this went against D66.
- **A path that leaves its package** (`native.entry`, `ui.resources[].path`, `view.handlers`) is refused at run time as well,
  since a manifest is untrusted input and the reader sees a path only as `app pack` left it.
- **`load()`** on a view or mounted app rejects with `APP_NOT_READY`: only a native app has a module in the page.

**The rules**

- **Undeclared parts start closed,** so `layout-get` says what the chrome shows, and `layout-set`'s refusal is never a success
  that changes nothing. `layout-reset` restores the instance's first layout, not the phase 0 default. The refusal also covers
  `view-state-set`, which could otherwise bypass it, and `compact.drawer` and `compact.sheet`, which open the same parts.
- **A chord that needs input** is not bound, and `app-get`'s notices say so: `KEYBINDING_NEEDS_INPUT`. `KEYBINDING_CONFLICT` is a notice too,
  since each is a binding refused and not an app.
- **A deployment entry** is checked as `loam deployment check` checks it, with its messages: the codes of 11.2 and `APP_CONFIG_INVALID`,
  in the order `DEPLOYMENT_APP_MISMATCH`, the kind's own, then the domain or prefix, the instance's name and the config. As there, every
  entry claims its domain in deployment order, whatever else refuses it. A refused instance is left out of `startInstances`.
- **A mounted instance before step 7** is read and listed: its prefix is checked, and it has its notices. It is `failed` with
  `MOUNT_TRANSPORT_UNAVAILABLE`, whose message says discovery arrives in step 7, and `app-instance-refresh` answers the same.
- **Replay: what the page decided.** Besides 7.6's, a failure the kernel marks in `error.details["dev.loam/page-decided"]` answers from its
  record: `APP_NOT_READY`, `APP_ACTIVATION_FAILED`, `HANDLER_READY_TIMEOUT`, `HANDLER_TIMEOUT` and `CALL_ABORTED`. A marker and not the code,
  since an app may return those codes itself, and that is an ordinary result to compare. A handler that had written before its call timed out
  shows as a difference later, which is right: a timed-out call is not deterministic.
- **Replay: nested calls.** A nested call matches the next entry with that `parent` on its command and what its input names; a schema may fill a default in the
  journal's copy. One refused before the middleware, by exposure or validation, left no entry, and runs again. Any other that differs, and a recorded call that no longer
  happens, marks the outer entry `different` even if its result is the same.
- **Replay: a journal across reloads.** The web host's journal outlives the page, and overlays, their counter, selections and status values do not. A replay
  forgets them where the trace IDs' base changes, as the reload did. The active app and layouts are persisted, so they carry over.

**The test kit**

- **Watching the global registry.** A definition arrives already imported, so `@lushly-dev/loam-testing` watches from its own import, and
  an app's test imports it first. Under Node it installs stand-ins for `customElements` and `HTMLElement`, since neither exists there and a
  module defining an element would otherwise fail with a bare `ReferenceError`. `definition` may also be a function that imports it. The failure is
  `APP_GLOBAL_ELEMENT`, once, so the next app is not blamed.
- **For step 4:** there is no stand-in `document`, and `@lushly-dev/fast-element` reads it on import. So a module with handlers must import its
  FAST elements dynamically, in `activate`, for the kit to load it under Node. That is what 5.1 asks of its top level anyway.
- **Beyond 5.2:** `config`, `journal`, a manifest the kernel refuses as a rejection with its code, and `grants` as the subset of the manifest's
  to keep. A mounted manifest is refused: it has no handler.
- **`createFixturePorts`** is in `@lushly-dev/loam-kernel/testing`, with `probe` (`src/testing-probe.ts`), because the kernel's tests and the test
  kit both need it.
- **E13's scaffold test runs in `testing`,** not in `web`: it spawns Vitest over a scaffold in a temporary directory, with this unit's `node_modules`
  linked in and itself aliased to its `dist`. `web` takes a dev dependency on it, as on the CLI (11.2), so `pnpm -F "@lushly-dev/loam-web..." build`
  builds what that test needs and the workflow's build line does not change.

### 9.6 Decided by step 4

What the sections above left open, and what the browser showed. Later steps build on these. **The sandbox's
assumptions got their test in step 5 ([9.7](#97-decided-by-step-5)); the scoped-registry assumptions got theirs here, and they held in
Chromium 156, natively,** with the two corrections below.

**The budget**

- **Measured.** The empty shell's JavaScript is 317,922 of 320,000 minified and 94,024 of 95,000 gzip, CSS 7,719
  of 8,496, the kernel alone 226,603 of 231,360. No ceiling is raised. 2,078 bytes and 976 gzip bytes are left, so **a
  later step with more first-paint code than that moves something out first**.
- **What made room.** `loam-resize-handle` now loads with the palette, after first paint: until then a part has its
  border and nothing to drag, and no layout shifts. `loam-notice` loads when one is shown. `whenIdle` waits two frames, so idle work
  never lands before the first frame. The kernel's first-paint chunk gained only `unavailableApps`, the shell a seam of a
  few lines (`ShellApps`), and the host `isEmptyProjection`.
- **Chunks.** The bundler makes a chunk per set of dynamic imports sharing a module, and each boundary costs imports,
  exports and a compression window, so a lazy module that statically imports what first paint already holds costs first
  paint bytes. Keep the graph narrow: `kit-loader` looks up the elements the shell has already defined with
  `customElements.get`, for this reason. Forcing everything first paint reaches into one chunk (`manualChunks`, walking
  the entry's static imports) was tried and was worse, 354,487 bytes: a barrel's static edge pulls in modules only a lazy
  chunk uses once tree-shaken.
- **`apps` chunk.** With the host also reading the projection, the bundler parts `apps-*`, `validate.generated-*` and
  `deployment-*`. They load together, so `budget`'s row sums them: 265,155, or 88% of the ceiling.
- **What first paint holds with an app.** `surfaces` and the `apps` chunks load before the shell's first frame in a
  deployment that lists an app, because 5.5's boot reads manifests before it registers commands, 9.1's kernel takes them
  before its one `hydrate()`, and the rail must be right in that frame. So the empty shell is under its ceilings and a
  deployment with apps is about 340,000 bytes more, recorded here and limited only by those rows' ceilings. An app's own
  module is never among them.
- **E5 as written was wrong about one file.** 5.5's boot reads each package's `app-manifest.json`, so a second app adds
  its manifest before first paint as well as `deployment.json`. The test holds everything else byte for byte, with and
  without tally, and a second test holds that the empty shell requests none of what apps load.
- **First paint, in a test,** is `first-contentful-paint`. `first-paint` fires for the theme's background on an empty
  body, so what precedes it depends on the machine.

**What the code showed**

- **A failed `apps` chunk (D66).** 9.5's rejection blanked the shell. `createKernel` now catches it, reports it, and uses
  `unavailableApps` (in `apps-runtime.ts`, since nothing lazy can be relied on then): each projection entry is listed
  `failed` with `APP_RUNTIME_UNAVAILABLE`, its title and order from the entry, each field checked as it is read. The host
  passes `appsUnavailable` when its own reader's chunk fails, and the raw projection then, so the kernel uses nothing of it
  but those fields. With no manifest there is no layout record, so an open app uses the no-app record and every part
  stays available; a persisted active app is not restored in that page, and its record is untouched for the next.
  The chrome's own chunk failing sets main's heading to "Apps could not load. Reload to try again."
- **FAST defines globally by default.** 5.2's sketch left out `registry`, so `hello-main` landed in the global registry.
  See the amended 5.2.
- **Specimen cannot wait for a scoped element.** Its `settle` calls `customElements.whenDefined` on every tag in an open
  shadow root (`foundations/specimen/src/browser/index.ts:265`, `:534`), which never resolves for a name only a scoped
  registry holds. The `loam-mount` fixture therefore defines the name globally as well. A follow-up.
- **Playwright will not click `aria-disabled`.** A test of a disabled toggle clicks with `force`, or it times out.
- **An app has no event for its own command** until phase 5's `events`, and the catalog gives a surface no callback. A
  status item or a form that must follow a command run from the palette or an agent hears it within its own module: hello's and
  tally's handlers call a listener their elements registered. Nothing in the contract changes, a replay has no listener, and it works only because a native app's handlers and surfaces share a page.

**The chrome**

- **`deactivate`** runs at the chrome's teardown, for what activated, since 5.5's "kernel disposal" cannot reach the chrome:
  the kernel's interface has no such event, and the chrome owns what `activate` began. Removing `loam-shell` is that teardown,
  and it also takes what the controller put in the parts. The web host never removes the shell, so a page's unload runs none.
- **`ShellApps`** is all `loam-shell` knows of apps: `modalOpen`, `undeclared(part)`, `run(command)`, `start()`, `dispose()`.
  The shell loads `apps/surfaces.ts` before its first frame when `mountShell` says the deployment lists an app, or on the
  first toast or modal otherwise, so an agent's `toast-show` on an empty shell renders.
- **`prepare`** reads `app-list`, and `app-get` for a persisted active app, before the parts render, so the first frame has
  the right landing and main busy. So a deployment with apps journals those reads at boot. An empty shell's journal is
  unchanged, which phase 0's E2 holds. The persisted app's surfaces wait two frames after that, with no `app-open` entry.
- **Styles from the chunk.** `addStyles` gives `loam-main`, the rail and the tab bar what they need with an app, so their
  first-paint sheets did not grow. The landing's `h1` is `display: none` while an app is active, which takes it out of the accessibility tree.
- **`loam-app-entry` and `loam-status-action`** are elements 9.3 did not list. An entry has its own tooltip and states, and
  a status item with a command is a button, which `loam-status-item`, in first paint, should not grow to hold.
- **A panel with several views** stacks them, each a `region` under its title, in one `loam-mount` per view. Tabs arrive when
  an app needs them.
- **`overlays.modal` rejects** when `modal-open` is refused, with `code` and `suggestion` on the error: 5.2 says it resolves
  when the modal closes, and a refused one never opened.
- **A surface's command** (a header action, a status item, a chord) runs as a person's call, with no input. If it fails, the
  shell shows its message as a `danger` toast. One that needs input is `aria-disabled`, and its chord was refused at load.
- **Focus.** A surface holding focus when it leaves moves focus to main, or the panel when a maximized panel has made main
  inert, after the new layout is in. So do a toast dismissed while focused and a modal whose invoker has gone. A status button
  is updated in place by its id, so a press keeps focus.
- **A toast and a modal.** `showModal()` makes everything outside it inert, the top layer too, so a toast behind any modal (this
  one, the palette or a compact drawer) can be neither heard nor dismissed. While one is open a new toast waits, and a
  shown one's timer stops, and both go on when it closes. `overlay-list` still lists it, so only what is on screen waits. Section 8
  has the region above: the region is simply under the modal's backdrop until then.
- **A toast's timer** stops while it is hovered or holds focus, and restarts in full (WCAG 2.2.1). The failure of a command a
  person ran from a surface lasts the longest a toast may, 30 seconds, since it is the only report of it. A sticky one is phase 4's.
- **The live region stays open** while empty, since a region added with its text is not announced. It says `aria-atomic="false"`
  and `aria-relevant="additions"`, so a new toast does not read the others again; a `danger` item stays `role="alert"` as section 8
  says, and whether screen readers then speak it once is a follow-up. It also announces an app opening or being unavailable,
  which nothing else says, and `document.title` names the app (WCAG 2.4.2).
- **A slow app says so.** After 400 ms main shows "Opening Hello…", and `loam-list` says "Loading…".
- **The rail does not scroll yet.** Its list would clip the tooltips beside it, and those are the rail's only visible labels. The
  tab bar's entries scroll in their slot, with the settings entry outside it. A follow-up, for a deployment with more apps than the
  rail has height.
- **`loam-list` marks its rows itself,** because `violet-option` hides whether it is active, and its active and selected colors do
  not reach 3:1: the active row gets the focus ring while the list holds focus, and a selection the control colors and a start-edge
  bar. Under forced colors only a selection is filled.
- **A view app's sidebar list works here,** and its main says step 5 serves it. `activate` is for native apps alone.

**Handler error text (D66 and section 12)**

A native handler's, an import's or `activate`'s thrown message **does not go through the journal's `redact`, because it never
reaches the journal**. A throw from a handler or an import goes to `reportError`; a throw from `activate` goes to `reportError` and
to main's notice, in that page alone. The kernel's record, which `app-get` reports and so journals, says only that it threw.
`redact` stays what section 12 says, the removal of a known field, because it cannot recognise a secret in free text. A failure
an app returns is its own result, and is journaled as any result is. A view frame's `HANDLER_THREW` still carried the
handler's message into the journal (11.2) until step 5, which [decided the same rule for it](#97-decided-by-step-5).

### 9.7 Decided by step 5

What the sections above left open, and what real frames showed. This was the sandbox's first test: a second origin,
`allow-scripts allow-same-origin allow-forms` on the proxy, an opaque inner iframe, `/view` over real frames and the
handler frame, in Chromium 156. E2 holds all of it.

**What held**

- **6.1 as written.** The frame's origin is the sandbox's, the inner document's `self.origin` is `null`, and from
  inside it `parent.document`, `top.document`, `document.cookie`, `localStorage` and `indexedDB` throw `SecurityError`,
  `fetch` fails, and neither `top` nor `parent` can be navigated. `window.open` answers `null`.
- **The prefix.** `<!doctype html><meta ...>` before a view's own `<!doctype html><html lang="en"><head>`: the parser
  ignores the second doctype and head, and adds `lang` to the element it already made, so the view's language survives
  and the policy is the head's first child.
- **`/view`,** but for the decision below, and **`@modelcontextprotocol/ext-apps` 2.0.4's `App`**: it connects, passes
  its own schema on `ui/initialize` with `dev.loam/tokens` in `hostContext`, calls a tool and answers teardown. A test
  also parses the result with `McpUiInitializeResultSchema` directly.
- **A hidden frame runs.** `hidden` on the outer iframe, so `display: none`, stops neither frame's script or messages.

**What the browser disproved, or added**

- **Section 12 was wrong about navigation,** and is amended. A view's `location.href` to another origin is refused by
  the proxy's `frame-src 'self'`, as a `frame-src` violation, with no request sent; the inner frame shows an error page.
  To the sandbox's own origin the request goes out and `frame-ancestors` refuses to render the response. Either way the
  frame is dead until the app is switched, which then takes the 500 ms path, since it cannot answer.
- **A `srcdoc` document holds two policies,** the proxy's and its own. So one `fetch` reports two `connect-src`
  violations, which is why E2 lists the provoked one twice, and the inner policy's `base-uri 'self'` has no effect:
  the proxy's `'none'` refuses a `<base>`. 6.1 is amended; the inner policy stays MCP Apps' default, word for word.
- **A view built on `App` needs Zod `jitless`, or it reports a violation.** Zod's `new Function` probe runs under a CSP
  with no `unsafe-eval`, and reports two `script-src eval` violations and goes on. So the conformance fixture is built
  with `zodJitlessByDefault`, as the shell is. Nothing Loam can do from outside changes it; a view's author sees it in
  the console. Phase 5's foreign views should say so.
- **Axe runs per document.** The page's `h1` is in the view's document, as 9.3 has it, and axe does not see through a
  frame it was not injected into. So the run around the frame disables `page-has-heading-one` alone, and the run inside
  the frame has it on.
- **A request id is not a kind.** The shell's own requests count from 1 in their own space, so a view's `id` 1 and the
  shell's `id` 1 can both be live. A hand-written view must tell a response from a request by `method`; a fixture that
  did not lost its teardown. The SDK and `App` already do.

**Text a frame chose (D54, D66, section 12)**

- **`HANDLER_THREW` from a frame follows the native rule.** `serveHandlers` sends what was thrown to the frame's own
  `reportError` and answers `` The handler of `x` threw. ``, so the message never reaches the journal. The spec gives no
  reason for a view to be less guarded: its text is less trusted, and a thrown message is the one kind of text an app
  did not choose to report. Debugging it costs opening the frame's console. The test kit's in-process frame answers the
  same, and E2 scans the journal for a thrown string.
- **That rule is about accidents, not hostility.** A hostile frame can return `failure({ message })` with any text, and
  that is its own result, journaled as any is. So the kernel does not try to tell one failure from another.
- **The kernel takes no other free text from a frame.** `CALL_ABORTED` no longer holds a cause's message. A JSON-RPC
  error answered to `dev.loam/handler-call` is `HANDLER_RESULT_INVALID`, since it is no result, and its text goes nowhere.
  `handlers-ready`'s names are read only if they look like command names, and the mismatch message names only those, up
  to 512 characters, because `markFailed`'s record reaches `app-get` and so the journal.
- **`dev.loam/page-decided` is stripped** from what a frame returns. 9.5 made it a marker because "an app may return those
  codes itself, and that is an ordinary result to compare"; a frame that set it could otherwise hide its results from a
  replay. A frame that writes and then never answers still earns it through `HANDLER_TIMEOUT`, as 9.5 accepts.

**What the security review found (2026-11-02)**

An independent review, with hostile fixtures in Chromium, confirmed the origin checks, the attributes and the message
handling as written, and found these. The first is a limit of the design and is for the owner; the rest are fixed here
unless they say otherwise.

- **WebRTC leaves the sandbox.** Section 12 is corrected, and D62's consequences say so. A test pins that the API is
  reachable, so a browser that closes it fails the test and this text gets corrected. The packets themselves were
  checked by hand once, and are not in the suite, since a runner's UDP to loopback is not a thing to rest CI on.
- **A command could run with no journal entry.** Structured clone carries a `BigInt` and a cycle, the journal's write
  threw on them, and its `onError` dropped the entry, while the command had run and any store write stayed. That broke
  6.3's promise. So what a frame returns, the `arguments` of a view's or a frame's `tools/call`, and a stored value go
  through JSON first: a result that cannot is `HANDLER_RESULT_INVALID`, and the others are `-32602`.
- **A view could lock the shell.** One that reopens `modal-open` at once holds the page inert behind `showModal()`, and
  a reload brings it back, since its app is reopened: only clearing site data got out, against D66. So a view's
  `modal-open` within 5 seconds of a person closing one of its modals is `OVERLAY_COOLDOWN`, journaled through the
  internal `app-modal-refuse`, in `port.call`, so the first-paint kernel holds only that name. Native apps are unchanged,
  since they are trusted. Modals opened and closed by the app itself count too, which costs an honest view nothing.
- **A trace ID counts every call in the kernel,** which 9.1 keeps from a view as a seq. So `toolCallResult` drops
  `metadata.traceId`, and a frame's `callId` and `context.traceId` are `<instance>-<n>`. `parent` is still the real one.
  `OVERLAY_NOT_FOUND` against `OVERLAY_NOT_OWNER` still says that another app holds an `ovl-<n>`: 5.3 asks for that code,
  it says no more than that, and it stays.
- **A leaving view could toast over the next app,** answering teardown with `toast-show`. `toast-show` and `modal-open`
  from a view are refused once teardown starts. Other calls still run, since MCP Apps lets a view save its state then.
  A handler frame can still toast with its app closed, inside a call, which section 8 allows; overlays naming their
  owner is a follow-up.
- **`..%2f` in a path.** `packageFile` kept it inside the package as a URL, and a server that decodes `%2F` would serve
  what is outside. It now refuses `%` and `\\` at run time. `app check`'s path shape is the core's, unchanged.
- **Not fixed: size and rate.** A 5,000,000-character input was journaled whole, 2,000 calls took about 3 seconds, and the
  journal has no retention, so one view can exhaust the origin's quota, which every app's store shares. That needs a
  decision on limits across the journal and the store, so it is a follow-up.

**The interface**

- **`AppPortV1.view`, `ViewBrokerV1`,** which 5.3 did not list: `sandboxOrigin`, `toolsCall`, `resourcesRead`, `runBound`
  and `onLinkedCall`. The chrome speaks the protocol and the kernel does the checks, so a boundary has no DOM in it and is
  tested without a browser (`kernel/src/apps/view-broker.ts`). `resources/read` checks `ui.resources` itself, since
  `port.readResource` also serves `view.handlers` for the kernel.
- **The bound command runs through the port,** with `caller` set, so it is journaled as the app's and its result carries
  no `dev.loam/seq`, which `kernel.call`'s would, and which a view must not see (9.1).
- **A linked call is heard where the handler returns,** in the lazy chunk, so `run` in the first-paint kernel is
  unchanged and `KernelEventV1` carries no input or result. A call refused before the handler, by validation, pushes
  nothing. A bound command may also link to its own resource, as an MCP tool does; it is told apart by its `signal`,
  so it is one push.
- **Reading the theme.** `MutationObserver` on `data-loam-theme` and `data-loam-density`, since `appearance-*`'s event
  precedes the shell's re-read and applying it, and a change of system preference is covered too. `theme` reads
  `loam-shell`'s `appearance.resolved`, as 6.2 says, so forced colors with a dark setting still says `dark`.
- **A change before `initialized`** is held, and sent once as one `host-context-changed` before the bound call's pushes.
- **`loam-view-frame.leave()`.** Removing or moving an iframe ends it, so on a switch the element is `hidden`, told, and
  removed after the answer or 500 ms. `AppSurfaces` calls this and not `remove()`. `aria-busy` stays on main until
  `initialized` or a failure, and the frame is `visibility: hidden` until then, so nothing unstyled shows.
- **`ViewSource` and `packageViewSource`,** as section 13 reserved, are in `chrome/src/view/`. The element also has
  `heading`, `state` and `failure`, for its Specimen fixtures of the loading and failed states; an open view needs a
  second origin, so it is E2's.
- **The handler frame's parent** is `document.body`, beside the shell, not in a part: it has no surface, and a part's
  contents move and park. A handler frame is one per instance, and the page's only other iframe is the open view.

**The budget: nothing of this step loads for an empty shell or a native-only deployment**

- **E2 holds it:** a native-only deployment and an empty shell request no `view-*` chunk and nothing under `sandbox/`,
  and hold no iframe.
- **First paint** is 318,000 of 320,000 and 94,056 of 95,000 gzip, 78 and 32 more than step 4: the entry names one more
  chunk, and the kernel one more internal command. Before two things moved it was 318,100 and 94,344, and later steps
  should watch for the same:
  - `ports.ts`'s own dynamic import put the bundler's preload helper in a chunk of its own, because the `deployment`
    chunk needed it without the shell's. So `main.ts` names the import and passes it to `readOrNotice`, as `loadView`.
  - `ref` in the view frame split `ref` out of the shared chunk. It queries its shadow root instead.
- **Rows.** `view` is 22,800, so its ceiling falls from 60,000 to 25,080 by phase 0's rule. `surfaces` is 77,451 of 85,000,
  `apps` 268,338 of 300,000 and the kernel 226,628 of 231,360. `budget` fails if the build has no `view-*` chunk.

**The repository**

- **Hello's pages are in `src/pages/`,** so each Vite build's `root` holds one page and `dist/main.html` is named by
  11.1. `pnpm build` runs three builds, the native one first since it empties `dist`.
- **`hello-greet` links to `ui://hello/main`** in `view.toml`, so an agent's or the palette's greeting reaches an open
  view. 11.1's list has no status item, inspector or header for a view, and neither does the manifest.
- **`dist/sandbox/` also lands on the shell's origin,** since `deployment write` copies `--dist` whole. It is unused
  there, and harmless: `proxy.js` opens nothing on its own, and what it renders is opaque. A deployer serves it on the
  second origin too, as 6.1 says.
- **`web` takes dev dependencies** on `@modelcontextprotocol/ext-apps`, pinned at 2.0.4, and `@lushly-dev/loam-sdk`, for
  the fixtures in `test/browser/pages/`. No workflow, `scripts/affected/` or root manifest changed.

## 10. Failure modes and error codes

Decides L4 (D66). **Conflicts are `error`, against the shell and across apps; one app's failure
never stops the shell or another app.** Every code has a suggestion and appears in `app-list` or
`app-instance-list`, or as a `CommandResult`. Codes that are not refusals of a manifest are added
to `LoamKernelErrorCode`. Each row is covered by a unit test or an exit test.

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `MANIFEST_*`, `GRANT_*`, `APP_CONFIG_INVALID` ([2](#2-the-manifest-profile)) | A package's manifest or config is refused | `state: 'refused'`, listed, not loaded | The fix, per row |
| `APP_PACKAGE_UNAVAILABLE` | `app-manifest.json` cannot be fetched | `refused` | Run `loam deployment write` |
| `DEPLOYMENT_*` | The file itself is refused ([3.2](#32-writing-the-browser-projection)) | `deployment write` stops | The fix |
| `APP_DOMAIN_CONFLICT` | Two apps with one id or prefix, or an id that is a shell domain | The later one, in deployment order, is `refused` | Rename, or set a prefix |
| `APP_COMMAND_CONFLICT` | A name the shell holds, reachable only as an id such as `view` with `view-state-get`, or a mounted instance's renamed tool another holds | That app is `refused`, or that command unregistered with a warning for a mounted tool | Rename the command or the prefix |
| `INSTANCE_PREFIX_CONFLICT` | A prefix already used | The later instance is `refused`: "Command prefix `umbel` is already used by instance `work`; choose another prefix for `home`." | Choose another prefix |
| `INSTANCE_PREFIX_REQUIRED` | A second instance of an app without a prefix | The later instance is `refused`, and `deployment check` fails | Name a prefix |
| `APP_HANDLER_MISSING` | The module's handlers do not match the manifest | `failed` at first load | Add the handler, or remove the command |
| `APP_ACTIVATION_FAILED` | The import or `activate` threw | `failed` | Read the error; fix the app |
| `APP_RUNTIME_UNAVAILABLE` | `kernel/src/apps/` or the readers could not load ([9.6](#96-decided-by-step-4)) | Each deployed app is `failed`, listed from its projection entry, until a reload | Reload; check that the deployment serves its assets |
| `APP_ELEMENT_UNDEFINED` | A surface names an element the app did not define | Shown in the mount | Define it in `activate` |
| `APP_GLOBAL_ELEMENT` | Importing a definition in the test kit defined a global element | The test kit fails | Define the element in `activate`, in `context.registry` |
| `APP_NOT_FOUND` | `app-open` or `app-get` of an unknown instance | A failure result | `app-list` |
| `APP_NOT_READY` | A call into a command of a `failed` or `loading` app. `app-open` of a `failed` or `refused` app succeeds, and main explains it | A failure result, retryable when `loading` | `app-instance-list`, or fix the app |
| `CALL_NOT_GRANTED` | [4.3](#43-grants) | A failure result, journaled | `calls` arrives in phase 5 |
| `STATUS_ITEM_UNKNOWN`, `LAYOUT_PART_UNDECLARED`, `KEYBINDING_CONFLICT`, `KEYBINDING_NEEDS_INPUT`, `OVERLAY_*` | As defined | A failure result, or a reported binding | Per row |
| `VIEW_SANDBOX_ORIGIN_INVALID` | [6.1](#61-the-sandbox-proxy) | `failed` | Deploy the proxy on a second origin |
| `VIEW_RESOURCE_UNAVAILABLE` | The resource file cannot be fetched | Main shows the failure | `app pack` |
| `VIEW_READY_TIMEOUT` | No `initialized` in 15 seconds | The frame is removed and main shows the failure | Reopen; check the view calls `ui/initialize` |
| `HANDLER_READY_TIMEOUT`, `HANDLER_TIMEOUT`, `HANDLER_RESULT_INVALID`, `HANDLER_NO_CALL`, `HANDLER_THREW`, `CALL_ABORTED` | [6.3](#63-the-handler-frame), [9.5](#95-decided-by-step-3) | A failure result | Per row |
| `OVERLAY_COOLDOWN` | A view's `modal-open` within 5 seconds of a person closing one of its modals ([9.7](#97-decided-by-step-5)) | A failure result, journaled, retryable | Ask again in a few seconds, or show a toast |
| `NESTED_MUTATION_REFUSED` | [5.3](#53-the-app-port) | A failure result, journaled | Do the mutation from the surface, or move it into this command's handler |
| `VIEW_STATE_READ_ONLY` | `view-state-set` on `loam.apps` | A failure result, journaled | `app-open` |
| `MOUNT_UNREACHABLE` | A network error, a 404, 405 or 502, a response that is not MCP (a static host's HTML), or a relay absent | `failed`, retryable | "Is the instance running? A browser reaches it through the hosted server." |
| `MOUNT_UNAUTHORIZED` | 401 from the instance | `failed` | Check the deployment's credential reference; the token itself is never shown |
| `MOUNT_NOT_AFD` | [7.3](#73-the-transport-and-discovery) | `failed` | Plain MCP servers arrive in phase 5 |
| `MOUNT_TIMEOUT` | A deadline | A failure, retryable | Retry; `app-instance-refresh` |
| `MOUNT_RESULT_INVALID` | Not a `CommandResult` | A failure | Report to the server's owner |
| `MOUNT_TRANSPORT_UNAVAILABLE` | `stdio` on a browser host | `failed` | Use `http`, or the desktop or hosted lane |
| `MOUNT_TOOL_UNNAMEABLE`, `INSTANCE_OVERRIDE_UNKNOWN` | [7.3](#73-the-transport-and-discovery), [3.1](#31-the-file) | A warning on the instance | Add an override |
| `MOUNT_SPACE_PINNED` | [7.5](#75-a-mapped-space-is-pinned) | A failure, journaled | Switch project, or drop `spaces` |
| `DEPLOYMENT_INVALID` | `deployment.json` fails `readProjection` | The "Loam cannot start" notice | Rewrite the deployment |

A failed mounted instance defaults to not required for every transport, as the proposal says:
it is reported and skipped, and the rest of the shell is unaffected.

## 11. `app new`, `app check` and the CLI

`@lushly-dev/loam-cli`'s bin, `loam`. Each subcommand is a `defineCommand` with `expose: { cli: true,
palette: false, agent: false, mcp: false }`, named `app-new`, `app-check`, `app-pack`,
`deployment-check` and `deployment-write`, and invoked as `loam <domain> <action>`. The CLI is a
Node program with no kernel. Output is a `CommandResult` as JSON; exit 0 on success, 1 on failure.

- **`loam app new <id> --kind native|view|mounted [--dir <dir>]`** writes:
  - `loam-app.toml` with the kind's sections, one command (none for `mounted`) and **no `ui`**, so the
    first UI is the console (D48);
  - for `native`: `src/app.ts` with `defineApp` and the handler; for `view`: also `src/handlers.ts`,
    `src/main.html`; for `mounted`: nothing else;
  - `schemas/<id>-ping.input.json`, `package.json`, `vite.config.ts`, `tsconfig.json`;
  - `test/app.test.ts`, using `createAppTestKernel`;
  - `README.md` with the trust line for the kind.

  `--dep-spec <spec>` sets the dependency spec for the Loam units in that `package.json`; the default is
  `workspace:*`, and an app outside the workspace passes a `link:` or tarball path, since nothing publishes.
  A path names one package, so `{unit}` in the spec becomes each unit's short name (`link:/repo/packages/{unit}`).
  A view's `vite.config.ts` imports `singleFileHtml` from `@lushly-dev/loam-cli/vite`. `app new` then runs `app check` on
  the result. A refused id (a shell domain, a bad pattern)
  writes nothing.
- **`loam app check [<dir>]`** runs, in order, and reports everything it finds:
  1. The TOML parses, and the rules `path-inside-root` and `files` hold.
  2. `readManifest` after inlining: the schema, then [2.4](#24-rules-beyond-the-schema).
  3. The effective exposure of each command, in `data.exposure`.
  4. `validateCommandSurface` from `@lushly-dev/afd-testing`, over summaries built from the manifest
     (name, description, category, `jsonSchema`, `requires`, `examples`, `contexts`). Its findings are
     warnings, except an injection finding in a description, which fails.
  5. For native and view sources: `loam-lint-tokens` over `src/**`, when it exists.
  6. For view: each `ui.resources` file, when built, is one HTML file with no external script or
     stylesheet reference; `VIEW_CSP_IGNORED` when a resource declares `csp`.
  7. For each file named that does not exist yet: `ENTRY_NOT_BUILT`, a warning.
  8. **The trust line**, always, in `data.trust`: `TRUSTED_NOT_SANDBOXED` for native (D54), the
     sandboxed line for view, and for mounted the external line, `MOUNT_ANNOTATIONS_UNTRUSTED` and
     `TEAM_INSTANCE_SINGLE_PRINCIPAL` (D55).

  It runs none of the app's code.
- **`loam app pack [<dir>] [--manifest <path>] --out <dir>`** runs `app check`, fails on any refusal or
  `ENTRY_NOT_BUILT`, inlines schemas, writes `app-manifest.json`, and copies the files the manifest
  names, with `native.entry`'s whole directory, since an entry may import its own chunks. `--manifest` is how
  hello packs one source three ways.
- **`loam deployment check <file>`** validates the file and its packages without writing, and reports
  `STDIO_TRUSTED_CODE`, `TEAM_INSTANCE_SINGLE_PRINCIPAL` and `MOUNT_ANNOTATIONS_UNTRUSTED`.
- **`loam deployment write`** is [3.2](#32-writing-the-browser-projection).

Phase 7's `app-check` shell command reuses `checkApp(files)`, a pure function over a file map that
this step exports from `@lushly-dev/loam-cli/check`, with no Node.js builtin in that entry.

### 11.1 Hello and tally

`endpoints/loam/apps/hello/`:

```text
manifests/native.toml, view.toml, mounted.toml   # as Umbel's plugins/hello/manifests
src/handlers.ts      # defineApp: hello-greet, hello-forget, hello-list. Written once.
src/native.ts        # default-exports it, with activate defining hello-main and hello-inspector
src/view-main.ts     # connectView; compiled into dist/main.html
src/view-handlers.ts # serveHandlers(handlers); compiled into dist/handlers.html
src/pages/           # main.html and handlers.html, the pages Vite needs to reach those two (9.7)
schemas/, skills/hello-guide/
test/app.test.ts
```

- **`hello-greet { name? }`** returns `{ greeting: 'Hello, <name>!', at }`, stores the name under
  `store`, and returns `undoCommand: 'hello-forget'` with `undoArgs`. `hello-list` returns `{ items }`.
  With no name it uses `config.default_name`.
- **Native surfaces:** rail, a `list` sidebar, main, an inspector following the selection, a header
  action, a status item (the count) and a keybinding, under `list-detail`. Main has a form using
  the kit, with buttons that call `toast-show` and `modal-open`, for E6.
- **View surfaces:** rail, a `list` sidebar, main as `ui://hello/main` with `command = "hello-list"`.
- **Mounted:** the manifest of [7.2](#72-the-umbel-instance-in-the-suite). The console is its UI.
- **Single-file HTML.** `singleFileHtml()`, exported from `@lushly-dev/loam-cli/vite`, is the Health dashboard's
  single-file Vite plugin (`tooling/single-file.ts`) without its CSP injection. Hello's and the scaffold's
  builds use it.

`endpoints/loam/apps/tally/` is native: `tally-add`, `tally-get` with `store`; main; a panel view;
a status item. **No file in `kernel`, `chrome` or `web/src` names it.** `tally`'s own custom element is
named `x-card`, as is one of hello's, so E1 shows their scoped registries keep them apart.

### 11.2 Decided by step 2

What the sections above left open, and what the code showed. Later steps build on these.

**The CLI's entries**

- **`checkApp(files, options?)`.** `options` holds `symlinks` (a link's path to its target, relative to the link's
  directory, the shape of `spec/plugin-manifest.json`'s `rules`), `manifest` (the path in the map) and `surface`.
- **`validateCommandSurface` is injected.** `@lushly-dev/afd-testing` has one entry, and its root imports Node.js builtins,
  so `/check` cannot import it and stay free of them. `app check` passes it. Phase 7's shell command passes one, or AFD gives
  the testing package a narrower entry then. The token lint is `app check`'s too, since it runs a process.
- **A root entry.** `@lushly-dev/loam-cli` exports `appCheck`, `appNew`, `appPack`, `runCli` and `readAppManifest(dir,
  manifest?)`. The last is how a scaffold's test gets its manifest, because this is the only unit that reads TOML.
- **`--manifest`** is on `app check` as well as `app pack`, because hello has no `loam-app.toml` to check otherwise. Its paths
  stay relative to `<dir>`.

**`app check` and `app pack`**

- **The token lint is a refusal,** `APP_TOKEN_LINT`, naming each violation, so `app pack` fails on it. When it cannot run (the
  theme is not built) it is the warning `TOKEN_LINT_UNAVAILABLE`, and with no file to lint it says nothing.
- **Surface findings** are `SURFACE_<RULE>`, for example `SURFACE_DESCRIPTION_QUALITY`. Findings of severity `info` are left out.
- **One file.** A built `ui.resources[].path` or `view.handlers` with an external script or stylesheet is `VIEW_NOT_SINGLE_FILE`.
  Those paths and `native.entry` also take `MANIFEST_PATH_ESCAPE`, as the core's paths do.
- **What a refusal looks like.** The failure's `error.code` is the first refusal's, and `error.details` holds `refusals`,
  `warnings`, `exposure`, `kind` and `trust`, so the trust line survives a failed check.
- **`APP_ENTRY_AT_ROOT`.** `native.entry`'s whole directory goes in a package, so an entry directly in the root is refused.
- **`.loam-output`.** `app pack` and `deployment write` each mark what they write with this file, and replace a directory only when it is
  empty or holds the mark. A file with a common name, such as `app-manifest.json` or `deployment.json`, is not leave for a recursive delete.
  The mark is not copied, and a directory holding one, such as hello's package for another manifest, is left out of a copy.
- **`APP_PACK_OUT_INVALID`.** `--out` may not be the app or above it, may not hold what is being packed, and is replaced only as above.
  `--out` inside the entry's directory (`dist/package`) is left out of the copy.
- **The core's path shape.** The reader sees the schema that replaced a path, so `app check` applies `jsonPath` itself: an absolute or `..` path is
  `MANIFEST_PATH_ESCAPE`, and anything else off that shape is `MANIFEST_INVALID`. A test holds both patterns equal to the core's.
- **A link loop** in what is copied is refused by `app pack` as `MANIFEST_PATH_ESCAPE`, and skipped by `deployment write`.
- **`APP_DIR_NOT_EMPTY`.** `app new` overwrites nothing.

**The scaffold**

- **Mounted** gets `loam-app.toml`, `package.json` and `README.md`: section 11's list has no use for the rest with no command
  and no source.
- **View** also gets `src/handlers.html`, the page Vite needs to reach `src/handlers.ts`. Each page is its own Vite build, chosen
  with `--mode`, because two pages in one build share a chunk, and a shared chunk cannot be inlined.
- **`singleFileHtml`** differs from the Health dashboard's in more than the CSP: it takes a page with no stylesheet, inlines where
  the reference was, turns off Vite's preload polyfill, and fails on anything left beside the page, including a dynamic import's chunk.

**The deployment file**

- **Codes.** `DEPLOYMENT_APP_MISMATCH` and the kind-dependent `DEPLOYMENT_*` of 3.1 are what the kernel will refuse at load, so a
  write warns of them and `deployment check` fails. These stop a write: `DEPLOYMENT_CREDENTIAL_UNREADABLE`, for 3.2's "a credential
  that cannot be read", and `DEPLOYMENT_PATH_INVALID`, for a `--dist` with no `index.html` or CSP, an `--out` overlapping what is
  read or holding other files, or a `--mounts-out` inside anything served.
- **A view with no `[sandbox]`** is `VIEW_SANDBOX_ORIGIN_INVALID`, the kernel's own code.
- **`sandbox.origin` is canonical,** a new refusal in `readDeployment`: the projection's pattern admits `;` and `"`, and this value
  reaches the shell's CSP.
- **`config` with no `config.schema`** is `APP_CONFIG_INVALID`, and its message names paths and rules, never values. Step 3's load
  must answer the same.
- **Secrets in what is served.** A package and `--dist` are served whole, so the deployment file or a `bearer_file` inside one stops a write
  (`DEPLOYMENT_PATH_INVALID`), and a package's case fails `deployment check` too. `--out` may not hold them, and `--mounts-out` may not replace them.
- **A TOML error** in the deployment file names the line and column and quotes nothing, since the parser's own message quotes the source, which
  holds `url` and `command`.
- **Only a package is copied.** A `package` with no readable `app-manifest.json` stays in the projection, with `APP_PACKAGE_UNAVAILABLE`, and none
  of its files are served. `--dist` is copied by the same rule as a package, so a link leaving it is skipped.
- **`frame-src`.** Today's `web/index.html` has none, so the write adds it before `object-src`. Step 4 or 5 adds `'none'` to the
  source, as 6.1 says, and the write then replaces it.
- **Symbolic links.** A link that leaves what is being copied is not copied: `APP_PACKAGE_LINK_SKIPPED`, a warning.
- **`bearer_file`** is relative to the deployment file, as `package` is, and its contents are trimmed. `deployment check` reads
  credentials too, so it fails where a write would stop.

**The SDK**

- **Changed from 5.2 as first written:** `handlers` takes `AppCommandHandlerV1<never>`, since under `strict` a handler that typed its input could
  not be assigned to one taking `unknown`, and the caller casts; and `onToolCancelled` is added, since 6.2 pushes `tool-cancelled` and nothing heard it.
- **`/view`** is written and unit-tested over a fake parent window here. It first met real frames in step 5's E2, which changed only `HANDLER_THREW`.
- **Codes.** A refused `tools/call` is a failure, not a rejection. It takes the code in the JSON-RPC error's `data.code` when the host
  names one, otherwise `VIEW_CALL_REFUSED`. So step 5's broker sends `HANDLER_NO_CALL` as `data: { code, suggestion }`. An answer with no
  result is `VIEW_RESULT_INVALID`, an aborted call is `CALL_ABORTED`, and a frame's handler that throws is `HANDLER_THREW`,
  with a fixed message since step 5 ([9.7](#97-decided-by-step-5)).
- **Early pushes.** `connectView` holds a `tool-input`, `tool-result` or context change until its first listener, since a view may await
  something else after connecting.
- **Exports beyond 5.2:** `KIT_ELEMENT_NAMES_V1`, the list behind `KitElementNameV1`, for the chrome's loader, and `mulberry32` from
  `/view`, for a test kit that must reproduce a frame's `random()`. `ManifestV1` is re-exported from the root.
- **`TRUST_LINES_V1` and `NOTICES_V1`** are in `manifest`'s root, not the CLI, so step 3's `app-get` and the console say the same words.

**The repository**

- **The bin is committed,** `bin/loam.mjs`, importing `dist/cli.js`. pnpm links a dependent's bin at install, and only to a file that exists then, so a
  bin in `dist/` would not reach the scaffold's or hello's `loam` scripts after a fresh install.
- **`web` takes its dev dependency on `@lushly-dev/loam-cli` in this step,** not step 4, so `pnpm -F "@lushly-dev/loam-web..." build` builds
  what the CLI's tests import in `loam.yml` and in `suites.mjs`, and neither file's build line changes. Editing `scripts/affected/` selects the
  whole workspace.
- **`spec/plugin-manifest*` reaches the CLI's test** through `manifest`'s `EXTRA_INPUTS` row and its dependents, so `scope.mjs` needs no row.

## 12. Security

The manifest is untrusted input, and trust comes from the kind (the proposal's Signing and trust; D54).

| Kind or path | Boundary | What phase 1 enforces |
| --- | --- | --- |
| `native` | **None: trusted code, not sandboxed** (D54). Its grants, its scoped registry and its reset are a contract. `app check`, `app-get` and the app's `README` say so | Only what a page can: the shell's CSP. A deployer lists a native app knowingly |
| `view` | The sandbox: an opaque-origin iframe inside a proxy on a second origin, under a CSP with no `connect-src` | The grants, in the broker. A view reaches only what the broker answers, and sees only what is pushed to it |
| Handler frame | The same | The same, and it has no surface |
| `mounted`, `http` | The network: the kernel holds no credential, and results are data | Untrusted labels; no server content rendered as markup; annotations as display only; hidden mutations |
| `mounted`, `stdio` | **None: trusted code** (D56) | A browser host refuses it. No command, app or agent can write `command` |

- **The shell's CSP.** As phase 0's, plus `frame-src`:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self';
  frame-src 'none' | <sandbox origin>; object-src 'none'; base-uri 'none'`. `script-src` and `connect-src`
  do not widen for any app or instance. Every Chromium scenario fails on a violation.
- **Secrets.** The browser holds none. `url`, `bearer_*`, `command` and `cwd` stop at `deployment write`, and
  `readProjection` refuses them if they ever reach the page. `writeDeployment`'s `mounts` is in memory, or
  in a 0600 file outside the served directory. A relay never logs a token.
- **The journal.** `redact` still removes `input.password`; a mounted result is bounded; no credential
  enters a context field. Only a field that never carries a secret is `journal: true`, and these four carry
  ids.
- **Message channels.** The chrome and the proxy check `source` and `origin` on every message ([6.1](#61-the-sandbox-proxy)).
  A proxy framed by another site can only render that site's own HTML in an opaque iframe. A deployer
  sets `frame-ancestors` on `sandbox/`.
- **What the sandbox does not stop.** **A view's data is not confidential from its author.** `connect-src` does not
  cover WebRTC, so a view or a handler frame can send anything it holds to any host: on 2026-11-02 in Chromium 156, an
  opaque inner frame's `RTCPeerConnection` sent STUN packets to a listener named in its configuration, with no CSP
  violation. CSP's `webrtc 'block'` is ignored by that Chromium, and deleting the constructor is undone by a `srcdoc`
  child frame, so nothing in this design closes it. So a view is isolated from the shell and from other apps: it cannot
  reach their data or their commands. What it can leak is what its own app holds, including its store, its `config`
  and what is pushed to it, and it can leak that anywhere. A deployer must not give an untrusted app data its author
  should not see. Phase 7's sandbox policy for drafts starts from this, and a follow-up asks whether the browsers
  phase 6 adds differ. As first written, this said only that a view may navigate its own frame with data in the URL.
  That was wrong about navigation, and missed WebRTC: in Chromium the proxy's `frame-src 'self'` refuses navigation to
  any other origin, and one to the sandbox's own origin sends a request and renders nothing, since `frame-ancestors`
  lists the shell alone ([9.7](#97-decided-by-step-5)).
- **What a frame says.** A frame is untrusted, so what it says is treated as text it chose, and what it sends must be
  JSON: see [9.7](#97-decided-by-step-5).
- **Personal data.** Phase 1 adds none beyond the Mock email and what apps store. Journal entries carry the
  input of each call, as phase 0's do; `redact` is where phase 3 extends.
- **Prompt injection through mounted content** is phase 5's, with the copilot: phase 1 has no model. The
  label is on every result already.

## 13. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 1 |
| --- | --- | --- |
| Scope, projects, the URL scheme, rail bands, membership | Phase 2 | `app.scope_levels`, `projects` and `space` recorded; `pinMountedInput` with `scope`; layout keys take a suffix |
| Document types, New, editors, embeds | Phase 2 | `ui.documents` and `ui.new` named and refused |
| Identity on apps, `MCP`-hosted auth | Phases 3, 6 | The actor flows to the handler; D55's membership on `projects` |
| Settings, experiments, notifications, menus, other overlay kinds, sticky toasts, two-key sequences, `when`, an app's element in a modal, confirmation prompts | Phase 4 | `overlay-*` over kinds; `MANIFEST_CONFIRM_UNAVAILABLE`; `createKeybindings`' bands |
| `calls` between apps, the `apps` flag, events | Phase 5 | `CALL_NOT_GRANTED`; the `caller` field; the deployment refuses `apps` by name |
| The copilot, agent surface, skills and contexts delivered, approvals, agent packs | Phase 5 | Admitted and listed; `kernel.agent` |
| A plain MCP server (not AFD) and its Apps views, in the console | Phase 5 | `MOUNT_NOT_AFD`; `loam-view-frame` takes `{ html }` from a `ViewSource`, of which `PackageViewSource` is phase 1's, so `McpViewSource` adds no contract. The AFD transport's `resources/*` is a follow-up |
| Mounted skills and resources, `<instance>/<name>`, citations as resource links | Phase 5 | `AppInstanceV1`; the instance keys them |
| The console's journal of calls and usage view | Phase 5, phase 7 | The `caller`, `instance` and `replay` fields |
| A real mount relay, secrets, `frame-ancestors` as a deployment | Phase 6 | The route `mounts/<instance>/mcp`; `writeDeployment`'s `mounts`; `MountTransportV1` |
| Desktop and stdio instances | Phase 6 | `MountTransportV1`; the `stdio` keys; D56's rule |
| A shell-side `app-check`, drafts, the sandbox policy, kit delivery into a sandbox, promotion, export | Phase 7 | `checkApp(files)`; `styles.variables`; the frame's CSP in one place |
| Signing | W29 | `signature` stays reserved |
| The first-party `umbel` app | After Umbel's phase 2 and Loam's phase 5 | The fixture manifest moves |
| Import maps | When a measurement asks | A self-contained module may later import a mapped specifier without a contract change |

## 14. Exit criterion and tests

The phase exits when every test below passes on `main` in `loam.yml`, and STATUS.md records the run
with "through a test-only relay" beside E3 and E4.

`web`'s `test:browser` keeps its phase 0 tests, which run on the empty shell, and gains the
`test/browser/apps/` suite. `test:mounted` is `pnpm -F @lushly-dev/loam-web build:umbel && vitest run --config
vitest.mounted.config.ts`, over `test/mounted/`. The harness gains `serveDeployment({ config, sandbox?: true,
mounts?: true })`, which runs `writeDeployment` into a temporary directory after the ports are known,
then serves it, a second loopback origin for `sandbox/` with `frame-ancestors`, and the relay. Every
scenario fails on any CSP violation, as phase 0's do, except the violations a test provokes on purpose, which it
lists by frame and directive (E2's `fetch` from a view).

| # | Criterion | Test |
| --- | --- | --- |
| E1 | **Hello loads native** (architecture section 9), under a scoped registry | Chromium: a deployment with hello native. The rail lists it; `app-open`; the sidebar's list, main, inspector and header render; `hello-greet` from main, from the palette and from `kernel.agent` each add a journal entry and update the list. Selecting an item reaches main and the inspector. Hello's chord runs its command only while hello is active. `customElements.get('hello-main')` is undefined. With tally too, each app's `x-card` upgrades to its own class. A font and color set on the shell's parts do not reach an element in the mount, and a token does. No module is requested before first use (the server's log). `app-get` says trusted, not sandboxed |
| E2 | **Hello loads as a sandboxed view**, on the MCP Apps profile | Chromium: hello view. The frame's origin differs from the shell's, and its `sandbox` attribute is `allow-scripts allow-same-origin allow-forms`. The bound command's `tool-input` and `tool-result` arrive only after `initialized` (a fixture view records the order, and a delayed `initialized` delays them). `hello-greet` from the view works through the broker, and with the view closed through the handler frame. `parent.document` throws; `fetch` and `document.cookie` fail in the view; a `tools/call` of `tally-add`, with valid and with invalid input and for a name that does not exist, gets the same `CALL_NOT_GRANTED`, journaled with `caller`; `overlay-list` shows no other app's overlay, and `app-selection-set` on tally is refused; a `dev.loam/store` from a grantless fixture is refused, and one from a timer outside a call is `HANDLER_NO_CALL`. Changing the theme to dark changes the view's background through `host-context-changed`. A switch sends `ui/resource-teardown` and removes the frame. **Conformance:** a fixture view built on `@modelcontextprotocol/ext-apps`' `App` connects, passes that package's schema check of the `ui/initialize` result, reads its host context, calls a tool and receives teardown. Axe passes inside the frame |
| E3 | **Hello loads mounted, and a real Umbel appears in the console** (D57) | `test:mounted`, the stock `umbel`, hello's `hello-mcp`, through the relay. Hello mounted: `hello-greet` from the console's form returns `Hello, Ada!`, equal to the native and view answers on `greeting`. The `umbel` manifest with instance `work`: discovery reads `afd-help` and `afd-detail`; the console lists `work-hello-greet` and `work-workspace-show`, and not any `afd-*`. `work-hello-greet`'s form has the two optional fields from the schema, an empty optional is omitted, and the result renders through the adapters, labeled "Untrusted: from work" and "Recorded, not replayable". The journal entry has `context: { app: 'umbel', instance: 'work', replay: 'recorded' }`. With Umbel stopped, `replayKernel` on that journal has zero differences and reports the `seq`s in `recorded`. `work-event-ack`, which reports a mutation, is hidden and refused until the entry names it |
| E4 | **Instances** (D55, D56, D58, L6, L7) | `test:mounted`, two Umbel workspaces, instances `work` and `home`. Both load, and names stay apart. The same prefix twice refuses the second with the exact message. A shell domain as a prefix is refused. The served files, `deployment.json`, the journal and every `app-*` result hold no instance URL, token or command line, by scanning for those exact strings; the relay's log shows the page sent no `authorization`; `connect-src` is still `'self'`. No shell command's input schema has a `command`, `url` or `bearer` key (mounted tools are the server's own). A `stdio` entry loads `failed` with `MOUNT_TRANSPORT_UNAVAILABLE`, and `deployment check` reports `STDIO_TRUSTED_CODE`. A wrong token gives `MOUNT_UNAUTHORIZED`; a stopped instance gives `MOUNT_UNREACHABLE`, is listed and skipped, leaves the other working, and recovers on `app-instance-refresh`. A team instance's console shows D55's notice |
| E5 | **A second app lands with no shell change** | Chromium: tally appears, works and renders its panel and status item, from a deployment entry alone. A unit test scans `kernel`, `chrome` and `web/src` for `tally` and fails on a match. The server's log shows the bytes requested before first paint are the same with and without it in the deployment, but for `deployment.json` and its own `app-manifest.json`, which 5.5's boot reads ([9.6](#96-decided-by-step-4)) |
| E6 | **A toast and a modal in hello leave nothing on screen after a switch** | Chromium: hello opens a toast and a modal; `kernel.agent` calls `app-open` on tally. `overlay-list` is empty, no `loam-toast` or open `dialog` is in the deep DOM, nothing of hello's mounts is connected, its status items and keybinding are gone, and the modal's `waitOverlay` resolves `cancel`. Returning restores hello's sidebar, the same element at its scroll offset, and main is re-created. `modal-open` from an inactive app, and a second modal, are refused and journaled |
| E7 | **A manifest that declares an unknown surface is refused with a suggestion** | Manifest unit, and Chromium over a deployment holding a fixture package with that raw `app-manifest.json`, which `deployment write` carries ([3.2](#32-writing-the-browser-projection)): `ui.surfaces.tray` gives `MANIFEST_UNKNOWN_SURFACE` with the list of surfaces, the rail shows the app as unavailable, opening it explains why, and the rest of the shell works. The proposal's matrix, each naming the key and a suggestion: `expose = { pallete = true }` ("Did you mean `palette`?"), an unknown key at each closed depth, `kind = "compiled"`, `scopes`, `packs`, `ui.documents` (naming phase 2), a composition `board` (unavailable) and `boards` (unknown), `workspace-write`. `spec/plugin-manifest.json`'s sections pass as [2.4](#24-rules-beyond-the-schema) says, and `scripts/plugin-manifest.test.mjs` passes with Loam's profile in it. `schema:build` compiles under `strict: true`. Hello's manifest validates in all three kinds, and so does the headless `umbel` manifest |
| E8 | **Grants** | Manifest and kernel units: an unknown grant, a required unserved one refused naming its phase, an optional one loading without the API. A native handler without `store` has no `context.store`. `app check` on hello native prints `TRUSTED_NOT_SANDBOXED`. An id `layout`, a shell domain, gives `MANIFEST_ID_RESERVED`. An id `view` declaring `view-state-get`, which the shell holds, gives `APP_COMMAND_CONFLICT`, with nothing of that app registered. A duplicate id gives `APP_DOMAIN_CONFLICT` |
| E9 | **Layout, persistence and replay with apps** | Step 4, Chromium: per-app layouts stay apart across a switch and a reload, under the id each was written; the preset seeds the first open; a persisted active app reopens after first paint with no journal entry; `layout-set` opening an undeclared part is `LAYOUT_PART_UNDECLARED`; a toggle for it is `aria-disabled`; `view-state-get { id: 'loam.layout' }` equals `layout-get` while an app is active. Kernel unit, over `probe`, and `web`, over `session-apps.ts`: a scripted session with apps, overlays and switches replays with zero differences; a handler's nested query replays from the record and a nested mutation is refused. Step 7, `test:mounted`: the same with mounted calls, including boot discovery. The phase 0 E1 and E2 tests still pass unchanged |
| E10 | **The console is every new app's first UI** (D48) | Chromium: `loam app new demo --kind native` in a temporary directory, built with Vite's API with the Loam units aliased to the workspace's `dist` (`test/browser/bundle.ts`), packed and deployed, shows the console with its command, and the form runs it. `renderForm`'s unit table covers every row of 7.7, including a nested object as JSON and an invalid JSON refusal. A failing command shows its code and suggestion. An XSS string in a server's result renders as text |
| E11 | **Accessibility and captures** | Specimen captures of each new element in the three themes and two densities, each with an ARIA snapshot, including the rail's unavailable entry. Axe with phase 0's tags on the shell with hello native open, with the console open, with a toast and a modal, in each theme and density and under `forcedColors: 'active'`, and in the compact class with the tab bar's app entries, zero violations. The rail's entries are reachable and operable by keyboard; a modal traps and returns focus; F6's order is unchanged |
| E12 | **Budgets** | `budget` passes every row of 9.2; A1 to A3 stay within budget |
| E13 | **`app new`, `app check`, the test kit** | CLI units: each kind scaffolds and passes `app check`; each refusal path exits 1 with JSON; `app check` runs no app code (a module that throws on import still checks); `createAppTestKernel` runs hello's scenario and replays it, and fails a definition whose import defines a global element; the scaffold's own test passes, run by Vitest from `testing` ([9.5](#95-decided-by-step-3)) over the workspace's `dist`. `app check` on a mounted manifest prints D55's notice. `app pack` refuses a symlink leaving the root. `deployment write` refuses `command` reaching the projection (a schema test) |

## 15. Implementation plan

Each step is one pull request, merged on green. It updates this specification's status block and
STATUS.md before it merges.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: a browser-safe MCP transport | `@lushly-dev/afd-client/streamable-http` exporting `StreamableHttpTransport` and its types; a module graph with no `eventsource` of ours and no Node.js builtin; an entry-point test in the pattern of `packages/server/src/entry-points.test.ts`, with a size budget of 340,000 bytes; a parity row; a changeset. `#655` is unchanged, naming this as the first browser entry | `pnpm check` |
| 0b | AFD: adapters without inline styles | `RenderOptions.styling?: 'inline' \| 'classes'`, default `inline`, so existing callers are unchanged. `classes` writes `class="afd-status-<type>"` and `afd-bold`; `css/afd-theme.css` gains the classes; a changeset | `pnpm check` |
| 1 | Manifest package | The package, its inventory entry, the glob, `app-manifest.v1.json` from the proposal's corrected sketch, `deployment.v1.json`, `projection.v1.json`, strict standalone validators and generated types, the readers, refusals and catalogs, `mountCommandName`, `deriveMutation`, profile cases, the core's sections, Loam's profile added to `scripts/plugin-manifest.test.mjs`, the repository contract test, `EXTRA_INPUTS`, the `loam.yml` path filter | `pnpm check`, `loam.yml` |
| 2 | SDK and CLI | `loam-sdk` (root, `/view`), `loam-cli`: `app new`, `app check`, `app pack`, `deployment check`, `deployment write`, `checkApp`, `singleFileHtml`; the `rules` cases that need files; E13's CLI part | `pnpm check` |
| 3 | Kernel, version 1 | `LAYOUT_DEFAULTS_V0` re-exported from `manifest`, the phase 0 copy removed, and the test holding `SHELL_RESERVED_CHORDS_V1` equal to `SHELL_KEYBINDINGS_V0`, since step 1 changes no kernel code. The interface, the ports, `kernel/src/apps/` for native and view, the commands, the port's checks, context fields, overlays' state, per-app layout, keybindings, replay with apps and the `probe` fixture; `@lushly-dev/loam-testing`; E8; regenerated `session-50`; the chrome's version check moved | `pnpm check`, `loam.yml` |
| 4 | Chrome and web, native apps | The nav's app list, `loam-mount`, surfaces, `loam-list`, the header, status items, overlays' elements, the kit loader, the web host's deployment read, the harness; hello native; tally; E1, E5, E6, E7, E9, E11 so far; `budget` rows; `design.md` and skill lines. The workflow's selectors | `pnpm check`, `loam.yml` |
| 5 | Sandboxed view | The proxy, `loam-view-frame`, the broker, the handler frame, `/view`, hello view, E2 with the conformance fixture, `@modelcontextprotocol/ext-apps` as a dev dependency; `budget`'s `view` row | `pnpm check`, `loam.yml` |
| 6 | Console | `loam-console`, `renderForm`, adapters with classes, E10, E11's console part, `budget`'s row | `pnpm check`, `loam.yml` |
| 7 | Mounted, against Umbel | Step 0a's use in `web`, `discoverInstance`, naming, exposure, pinning, the journal's marks, replay of recorded entries, the relay, the Umbel fixture, `build:umbel`, `test:mounted`, the `mounted` job with `loam.yml`'s Umbel and `packages/rust` path filters and the Umbel contract test's exception for them, `suites.mjs`, `AGENTS.md`, hello mounted, E3, E4, E9's mounted part. Its diff touches nothing under `endpoints/umbel/`, as the proposal's acceptance requires | `pnpm check`, `pnpm -F @lushly-dev/loam-web test:mounted`, `git diff --exit-code origin/main -- endpoints/umbel`, `loam.yml` |
| 8 | Exit | STATUS.md and this block record the exit run; follow-ups filed; the proposal's step 2 marked done | `loam.yml` on `main` |

Order:

- Steps 0a, 0b and 1 run in parallel. Step 2 needs 1. Step 3 needs 2. `@lushly-dev/loam-testing` lands in 3, since it needs the kernel.
- Step 4 needs 3. Steps 5 and 6 need 4 and may run in parallel; step 6 needs 0b.
- Step 7 needs 0a and 6. Step 8 is last.

**Host capacity.** Steps 4 to 7 run Chromium, and step 7 runs a heavy Rust build, because the
stock `umbel` links wasmtime. On a shared machine, run these under a load of 20, with `cargo -j4`,
one Vitest worker and a shared `CARGO_TARGET_DIR`, which the harness honors.

## Amendments to the architecture and the decision log

This pull request adds to the [decision log](../../decisions.md):

- **D59.** Loam's manifest profile is `app-manifest.v1.json` in `@lushly-dev/loam-manifest`.
  Authors write `loam-app.toml`, the kernel reads a packed `app-manifest.json`. The kinds are
  `native`, `view`, `mounted`, and `domains` is exactly `[id]`. The manifest is the single source of
  a command's metadata; an app's module supplies handlers only, and the kernel builds each definition
  with `z.fromJSONSchema`. Decides L1, L2.
- **D60.** A native entry is a self-contained ES module, loaded on first use, with no import map:
  an inline import map needs a CSP hash, and shared chunks under stable names risk the first-paint
  budget. Revises reservation R7, keeping its "no bundler coupling".
- **D61.** A view app's handlers run in a hidden sandboxed handler frame beside the view, so its
  commands work with the view closed and untrusted code never runs in the shell's page. The same
  `defineApp` runs native or there. Decides L5.
- **D62.** Loam follows MCP Apps' web-host rule: a sandbox proxy on a second origin the deployer
  provides, with `allow-scripts allow-same-origin`, and each view in an opaque inner iframe under the
  default CSP. `deployment write` sets the shell's `frame-src`. Phase 1 serves no `_meta.ui.csp`.
- **D63.** Phase 1's workspace app list is a deployer's `loam.deployment.toml`. Its browser projection
  holds no location, credential or command line, and no command writes an entry. Phase 2's store takes
  the entries except those D56 keeps in configuration. Decides L6.
- **D64.** A browser host reaches an instance only at the same-origin route `mounts/<instance>/mcp`,
  which the hosted lane serves in phase 6. Phase 1 proves the mounted kind against a real Umbel through
  a test-only relay in the Chromium suite, and says so wherever the result is recorded: the proxy, the
  client, discovery, console and journal are real, and the hosted server is not. Decides L7 and how D57
  runs.
- **D65.** A mounted instance's entry is the callee's declaration for its tools, annotating D30. AFD's
  defaults apply to app commands. A mounted server's annotations set display and defaults only; an
  unreported command is a mutation; mutations and destructive commands are hidden until the entry names
  them; a mapped space is pinned. An instance prefix replaces the domain, annotating D18. Decides L3,
  L9, L10.
- **D66.** Conflicts are `error`, against the shell and across apps and instances. A refused or failed
  app is listed with its reason and never stops the shell or another app. A `requires` entry naming an
  unknown command warns. Decides L4, L8.
- **D67.** Surface catalog version 1 names all 22 surfaces and serves the ones listed in this
  specification; a known surface not yet served is refused naming its phase. Composition library version 1
  serves `console` and `list-detail`. Phase 1 builds the toast and modal of the overlay manager, as text,
  and phase 4 completes it.
- **D68.** Kernel interface version 1, with ports for everything that needs a DOM or a network. The SDK,
  `@lushly-dev/loam-sdk`, is the whole contract: `defineApp`, the contexts, the client, the kit, the
  surface element, with the test kit in `@lushly-dev/loam-testing`. `status` joins the shell domains. Until `calls`
  arrives, apps call their own commands and a fixed list of shell commands scoped to themselves, a refusal is
  journaled, and a handler's nested call may only be a query.

The decision log's D18 and D30 gain amendment notes pointing to D65. D54 to D58 are not altered.

The architecture is amended:

- **Section 4**, surface catalog: a note that catalog version 1 and what phase 1 serves are in this
  specification; the app loader row's "mounted AFD servers rendered by the console" stands.
- **Section 5**: the domain list gains `status`; the minimum shell commands gain `app-get`, `app-close`,
  `app-command-list`, `app-instance-list`, `app-instance-refresh`, `app-selection-get`,
  `app-selection-set` and `status-item-set`. "MCP Apps profile" gains the sandbox proxy on a second origin.
- **Section 8**, repository placement: the workspace globs gain `endpoints/loam/apps/*`.
- **Section 9**, phase table: phase 1's row says the mounted proof runs through a test-only relay until
  the hosted lane (D64).

The [trajectory watch](../../trajectory.md) is amended: R7 per D60; W1 and W2 refreshed; W29 (signing,
tracking Umbel's W9) and W30 (browsers restricting public pages calling loopback) added. The proposal's
"Before Loam's phase 6" follow-up points to W30.

## Review 2026-11-01

An independent review of the first draft, by a fresh agent given the specification and the source documents and
asked the four questions of the process, returned 35 findings: 9 must-fix, 19 should-fix, 7 nits. It checked the claims
against the code, and it reasoned about browser behaviour from the HTML and CSP specifications rather than running
it, and ran one Node check of `z.fromJSONSchema`. The author re-checked its main claims against the source (`execution.ts`'s
order, FAST's `compiler.ts`, the polyfill's keys, ext-apps' `McpUiStylesSchema`, `registry.ts`'s persistence) and they held. All are
addressed in the text above:

1. **What the chrome renders from.** The port gained the manifest, `load`, `readResource` and an activation report (5.3).
2. **A leak across views.** `overlay-list` and `app-selection-*` were not scoped to the caller. They are now, and E2 tests it
   (5.3, D54).
3. **Replay of discovered commands.** Boot discovery was not journaled. Only `app-instance-refresh` discovers now, and replay
   answers recorded entries directly (7.3, 7.6).
4. **`styles.variables`.** ext-apps closes it to its standard names, so the conformance fixture would have failed at
   `ui/initialize`. Loam's tokens take a `dev.loam/` host context key (6.2).
5. **Refused apps could not reach a browser.** Only file-level refusals stop `deployment write` now, so E7 and D66's rail are
   reachable (3.2).
6. **D55 in `app check`.** A mounted manifest's check now prints the notice (4.3, 11).
7. **Nested calls.** They would run twice on replay. A handler's nested call is a query, answered from the record (5.3, 7.6).
8. **The dependency table.** The test kit became its own unit, the kernel takes types from the SDK, and the constants the rules
   need moved to `manifest` (1, 2.5).
9. **The scaffold outside the workspace.** `--dep-spec`, and aliases in the tests (11, 14).
10. **Should-fix:** E2's expected violations; a table from instance path to code (2.5); `ui.resources[]`, `element` and the
    undefined types (2.2, 5.2, 9.1); who runs `readProjection` (9.4); a boot row, and `view-state` on `loam.layout` and `loam.apps`
    (4.5, 5.5); the check moved before lookup, through `app-call-refuse` (5.3); the polyfill's keys (5.4); `allow-forms` on the
    outer frame (6.1); E8's unreachable conflict; the approval order against #677; `callId` on frame requests (6.3); pack copying
    the entry's directory (11); `mount.tools[]` narrowed, with precedence (2.2, 7.4); the surface element's registry (5.2); `seq`
    on the result (7.7, 9.1); a stricter mounted result check (7.3); the core's cases through `readCoreManifest` (2.4); the
    session fixture out of the kernel and E9 split by step; E5's budget claim and E4's scans made testable; the untested items
    added to E1, E11 and E13, and the diff check on `endpoints/umbel` added to step 7.
11. **Nits:** 22 surfaces, not 21; titles and `lang` in the frames; which middleware instance stays; teardown before `initialized`
    and `size-changed`; absolute URLs; the stderr line; `suites.mjs`' selector; `spec/VERSION` in the filters; `expose.mcp = false`
    admitted; the wording of "Trusted, not sandboxed".

**After the review**, step 1 of the manifest ([#677](https://github.com/lushly-dev/afd/pull/677), merged as `9be3ad12`) reported what its verification changed, and this
specification follows it: conditionals in `allOf`, the corrected sketch under `strict: true`, keys refused with `false`, grants
checked at load and not by the schema, and the rules and renaming cited from `spec/plugin-manifest.md` (2, 2.4, 2.5, 7.3).

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Phase 1 specification | Run the mount and scoped-registry suite in Firefox and WebKit, with D34's polyfill branch, since `loam.yml` is Chromium only | Open |
| 2026-11-01 | Phase 1 specification | `resources/list`, `resources/read` and the skills calls in AFD's `StreamableHttpTransport` (`send` answers `-32601` for them), needed when a mounted instance's resources, skills and views surface in phase 5 | Open; for AFD, before phase 5 |
| 2026-11-01 | Phase 1 specification | The MCP Apps standardized style variables (`--color-background-primary` and the rest), mapped from the token contract, for views from other servers | Open; phase 5 |
| 2026-11-01 | Phase 1 specification | A scan of mounted descriptions before they reach the agent surface, reusing `packages/testing/src/surface/injection-vectors.json` as Umbel's loader does | Open; phase 5 |
| 2026-11-01 | Phase 1 specification | Measure the mount chunk with Rolldown once it shares Zod, and whether a small fetch-based client is worth having if 340,000 bytes proves a burden after first paint | Open |
| 2026-11-01 | Phase 1 specification | Umbel's owner may annotate D37 and "Room for Loam", per the proposal's step 3; nothing is asked of Umbel by this phase | Open; Umbel's owner |
| 2026-11-02 | Phase 1 step 4 | Specimen's `settle` waits on the global registry for each tag in an open shadow root, so it hangs to its deadline on an element only a scoped registry holds (`foundations/specimen/src/browser/index.ts:265`, `:534`). `chrome`'s `loam-mount` fixture defines the name globally as well to get past it; Specimen should ask the element's own registry | Open |
| 2026-11-02 | Phase 1 step 4 | Only 2,078 bytes and 976 gzip bytes are left for the empty shell (317,922 of 320,000, 94,024 of 95,000). Zod is 178,000 of the page; a smaller first-paint schema layer would end this pressure, and each later step must otherwise move code out first | Open |
| 2026-11-02 | Phase 1 step 4 | Screen-reader passes with NVDA and VoiceOver over the toast region, the nested `role="alert"`, the app-open announcement and the modal. axe and the ARIA snapshots cannot judge what is actually spoken | Open |
| 2026-11-02 | Phase 1 step 4 | A non-empty toast region has no F6 stop or chord, and is last in the Tab order, so reaching a toast by keyboard before its timer ends is hard. With phase 4's sticky toasts | Open; phase 4 |
| 2026-11-02 | Phase 1 step 4 | The rail does not scroll when its entries overflow (9.6), and needs its tooltips out of the list, in a popover, first. In `unavailableApps`, a shell-owned modal does not refuse a switch, as section 8 has it, because no modal is likely in a page that could not load its apps | Open |
| 2026-11-02 | Phase 1 step 4 | `scripts/affected/suites.mjs` still runs `pnpm -F "./endpoints/loam/packages/*" test`, without `apps/*`, because editing it selects the whole workspace; `pnpm check` covers the apps' units. Step 7 changes that entry anyway, as section 1 says | Open; step 7 |
| 2026-11-02 | Phase 1 step 5 | **For the owner.** A view's data is not confidential from its author: WebRTC reaches any host, and no policy here stops it in Chromium 156 (section 12, D62). Decide whether that is acceptable for untrusted apps as phases 6 and 7 widen who deploys them, and whether to add `webrtc 'block'` for browsers that honour it | Open; owner |
| 2026-11-02 | Phase 1 step 5 | Nothing limits a view's or a frame's message size, call rate or storage: a 5,000,000-character input is journaled whole, and one view can exhaust the origin's quota, shared by the journal and every app's store (9.7). A journal that cannot append drops the entry, so this also widens what escapes it. Decide limits across the broker, the journal and the store | Open |
| 2026-11-02 | Phase 1 step 5 | With focus inside a view, the shell's chords (Mod+K, F6 and the rest) go to the frame's document and do nothing, since a cross-origin frame's keys never reach the shell. A person leaves with Tab. MCP Apps has no key-forwarding message; decide with phase 4's keybindings whether the SDK offers one | Open; phase 4 |
| 2026-11-02 | Phase 1 step 5 | Run E2 in Firefox and WebKit, as the mount's follow-up above asks of its suite. 9.7's navigation and WebRTC results are Chromium's | Open; phase 6 |
| 2026-11-02 | Phase 1 step 5 | Toasts and modals do not name the app that opened them, so an app's text can pass for the shell's, or for another app's: give an overlay its owner's name | Open; phase 4 |
