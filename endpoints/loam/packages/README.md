# Loam packages

The TypeScript packages of AFD Loam: phase 0's four and phase 1's as they land, with the apps
in `../apps/`. All are private and quarantined: `private: true`, no release route, and gated by
`pnpm check` and `loam.yml`. Read [`../docs/STATUS.md`](../docs/STATUS.md), the
[phase 0 specification](../docs/phases/0-kernel-chrome/spec.md) and the
[phase 1 specification](../docs/phases/1-app-contract/spec.md) first.

| Directory | Package | Responsibility |
| --- | --- | --- |
| `manifest/` | `@lushly-dev/loam-manifest` | The app manifest profile, the deployment file and its browser projection: schemas, generated types, standalone validators, the readers and refusals at `/validate`, and the catalogs at the root; no DOM and no Node.js builtin. `schema:build` regenerates `src/_generated/` and `dist/*.generated.js`; its test fails when the committed files are stale |
| `sdk/` | `@lushly-dev/loam-sdk` | The whole contract an app codes against: `defineApp`, the contexts, the client, the kit, the overlays and the surface element; `/view` for code in a sandbox (`connectView`, `serveHandlers`), over `postMessage` alone |
| `cli/` | `@lushly-dev/loam-cli` | The `loam` bin: `app new`, `app check`, `app pack`, `deployment check`, `deployment write`. `/check` is the pure `checkApp`, `/deployment` is `writeDeployment`, `/vite` is `singleFileHtml`. The only unit that reads TOML |
| `theme/` | `@lushly-dev/loam-theme` | Loam's Violet tree (light, dark, high contrast, each with compact density), its exports, the token contract and the token-only lint; see [its README](theme/README.md) |
| `kernel/` | `@lushly-dev/loam-kernel` | The registries, kernel interface version 1, the shell and app commands, the app port, overlays' state, per-app layout, the keybindings registry, the layout model, the palette index and the journal options; `src/apps/` loads packages when a deployment lists an app, and is imported dynamically; replay, the journal diff, the reference workspace and the `probe` fixture at `/testing`; no DOM dependency |
| `testing/` | `@lushly-dev/loam-testing` | The test kit an app's own tests use: `createAppTestKernel` boots a headless kernel with only the app, replays what it ran, and fails a definition whose import defines a global element |
| `chrome/` | `@lushly-dev/loam-chrome` | The shell parts as FAST-AF elements (`loam-shell` is the one controller), the palette and resize handles (loaded after first paint), the app surfaces at `/apps` (`AppSurfaces`, `loam-mount`, `loam-list`, the overlays and the kit, a chunk of its own), the reserved chords, the layout classes, the router seam and theme application; `mountShell` and `renderNotice`. Its Specimen fixtures and E2's committed journal are in `specimens/` |
| `web/` | `@lushly-dev/loam-web` | The browser host: the kernel over IndexedDB with the journal's writer lock and the second-tab notice, the deployment read and `webPorts`, the static shell built with Vite, its Chromium suite and `serveDeployment` harness, and the bundle `budget` |
| `../apps/hello/`, `../apps/tally/` | `@lushly-dev/loam-app-hello`, `@lushly-dev/loam-app-tally` | The reference app and the second app, which lands with no shell change: each builds to a self-contained native module, packs with `loam app pack` and tests through `createAppTestKernel` |

## Commands

```sh
pnpm -F "@lushly-dev/loam-web..." build      # the web host and everything it needs
pnpm -F "./endpoints/loam/packages/*" -F "./endpoints/loam/apps/*" test   # browser-free units (also run by pnpm check)
pnpm -F @lushly-dev/loam-theme theme:check   # the committed token contract and layout defaults against the tree
pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome -F @lushly-dev/loam-app-hello -F @lushly-dev/loam-app-tally lint:tokens   # token-only lint (needs the build)
pnpm -F @lushly-dev/loam-web test:browser    # builds Specimen's native host (Rust), then Chromium against dist/ (needs the build)
pnpm -F @lushly-dev/loam-web budget          # the bundle budget of spec 8.1
pnpm -F @lushly-dev/loam-chrome session:record   # regenerate E2's journal fixture after SESSION_50 changes
```
