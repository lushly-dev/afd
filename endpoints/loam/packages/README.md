# Loam packages

The TypeScript packages of AFD Loam, with the apps in `../apps/`. All are private and
quarantined: `private: true`, no release route, and gated by `pnpm check` and `loam.yml`. Read
[`../docs/STATUS.md`](../docs/STATUS.md) first, then the specification of the phase your change
belongs to, under [`../docs/phases/`](../docs/phases/).

| Directory | Package | Responsibility |
| --- | --- | --- |
| `manifest/` | `@lushly-dev/loam-manifest` | The app manifest profile, the deployment file and its browser projection: schemas, generated types, standalone validators, the readers and refusals at `/validate`, and the catalogs at the root; no DOM and no Node.js builtin. `schema:build` regenerates `src/_generated/` and `dist/*.generated.js`; its test fails when the committed files are stale |
| `sdk/` | `@lushly-dev/loam-sdk` | The whole contract an app codes against: `defineApp`, the contexts, the client, the kit, the overlays and the surface element; `/view` for code in a sandbox (`connectView`, `serveHandlers`), over `postMessage` alone |
| `cli/` | `@lushly-dev/loam-cli` | The `loam` bin: `app new`, `app check`, `app pack`, `deployment check`, `deployment write`. `/check` is the pure `checkApp`, `/deployment` is `writeDeployment`, `/vite` is `singleFileHtml`. The only unit that reads TOML |
| `theme/` | `@lushly-dev/loam-theme` | Loam's Violet tree (light, dark, high contrast, each with compact density), its exports, the token contract and the token-only lint; see [its README](theme/README.md) |
| `kernel/` | `@lushly-dev/loam-kernel` | The registries, kernel interface version 1, the shell and app commands, the app port, overlays' state, per-app layout, the keybindings registry, the layout model, the palette index and the journal options; `src/apps/` loads packages when a deployment lists an app, and is imported dynamically; replay, the journal diff, the reference workspace and the `probe` fixture at `/testing`; no DOM dependency |
| `testing/` | `@lushly-dev/loam-testing` | The test kit an app's own tests use: `createAppTestKernel` boots a headless kernel with only the app, replays what it ran, and fails a definition whose import defines a global element |
| `console/` | `@lushly-dev/loam-console` | `loam-console`, every new app's first UI and the mounted kind's renderer: the command list, forms from input schemas (`renderForm` is pure) and results through the adapters; it binds to the SDK's client alone, and the chrome loads it only when one renders |
| `chrome/` | `@lushly-dev/loam-chrome` | The shell parts as FAST-AF elements (`loam-shell` is the one controller), the palette and resize handles (loaded after first paint), the app surfaces at `/apps` (`AppSurfaces`, `loam-mount`, `loam-list`, the overlays and the kit, a chunk of its own), the reserved chords, the layout classes, the router seam and theme application; `mountShell` and `renderNotice`. Its Specimen fixtures and E2's committed journal are in `specimens/` |
| `web/` | `@lushly-dev/loam-web` | The browser host: the kernel over IndexedDB with the journal's writer lock and the second-tab notice, the deployment read and `webPorts`, the static shell built with Vite, its Chromium suite and `serveDeployment` harness, and the bundle `budget` |
| `identity/` | `@lushly-dev/loam-identity` | **Server side only**, never imported by `web`, `chrome` or `kernel` (phase 3 specification, 1): `createLoamAuthOptions`, Better Auth's options for a `provider` deployment; `loamServerPlugin`, its `whoami`, the workspace's binding to an organization by id, and the hooks that keep the provider's own organization endpoints within Loam's rules; and, at `/testing`, `startTestAuthHost`, a real Better Auth server in a child process for tests, which proves no hosted lane |
| `host/` | `@lushly-dev/loam-host` | The hosted server (phase 6): one Node process on Hono that serves a deployment's shell from its data directory, with its configuration, lock, headers and checks. The `loam-host` bin has `check`, `doctor` and `dev`, the development profile on `https://localhost` with a generated certificate; `/testing` holds the harness that starts it as a child process |
| `../apps/hello/` | `@lushly-dev/loam-app-hello` | The reference app: one handler module in all three kinds, native, a sandboxed view and mounted from a server |
| `../apps/tally/` | `@lushly-dev/loam-app-tally` | The second app, native: a counter on main, a panel view and a status item |
| `../apps/tasks/` | `@lushly-dev/loam-app-tasks` | The project-scoped app, native: tasks in a sidebar list and main, kept per project |
| `../apps/notes/` | `@lushly-dev/loam-app-notes` | The first document type, native: notes, text a person writes in the editor area |
| `../apps/checklist/` | `@lushly-dev/loam-app-checklist` | The second document type, a sandboxed view: checklists, items a person ticks off in the editor area |

Every app after `hello` lands with no shell change. Each packs with `loam app pack` and tests through `createAppTestKernel`.

## Commands

```sh
pnpm -F "@lushly-dev/loam-web..." build      # the web host and everything it needs
pnpm -F "@lushly-dev/loam-host..." build     # the hosted server, which test:hosted starts
pnpm -F "./endpoints/loam/packages/*" -F "./endpoints/loam/apps/*" test   # browser-free units (also run by pnpm check)
pnpm -F @lushly-dev/loam-theme theme:check   # the committed token contract and layout defaults against the tree
pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome -F @lushly-dev/loam-console -F @lushly-dev/loam-app-hello -F @lushly-dev/loam-app-tally -F @lushly-dev/loam-app-tasks -F @lushly-dev/loam-app-notes -F @lushly-dev/loam-app-checklist lint:tokens   # token-only lint (needs the build)
pnpm -F @lushly-dev/loam-web test:browser    # builds Specimen's native host (Rust), then Chromium against dist/ (needs the build)
pnpm -F @lushly-dev/loam-web test:walk       # the editor area's seeded walk, in Chromium
pnpm -F @lushly-dev/loam-web budget          # the bundle budget of spec 8.1
pnpm -F @lushly-dev/loam-web test:hosted     # the built shell served by `loam-host dev`, in Chromium (needs both builds and openssl)
pnpm -F @lushly-dev/loam-web test:mounted    # builds a stock umbel (Rust), then hello mounted and umbel in the console through a test-only relay
pnpm -F @lushly-dev/loam-chrome session:record   # regenerate E2's journal fixture after SESSION_50 changes
```
