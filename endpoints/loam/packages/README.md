# Loam packages

The TypeScript packages of AFD Loam: phase 0's four and phase 1's as they land.
All are private and quarantined: `private: true`, no release route, and gated by
`pnpm check` and `loam.yml`. Read [`../docs/STATUS.md`](../docs/STATUS.md), the
[phase 0 specification](../docs/phases/0-kernel-chrome/spec.md) and the
[phase 1 specification](../docs/phases/1-app-contract/spec.md) first.

| Directory | Package | Responsibility |
| --- | --- | --- |
| `manifest/` | `@lushly-dev/loam-manifest` | The app manifest profile, the deployment file and its browser projection: schemas, generated types, standalone validators, the readers and refusals at `/validate`, and the catalogs at the root; no DOM and no Node.js builtin. `schema:build` regenerates `src/_generated/` and `dist/*.generated.js`; its test fails when the committed files are stale |
| `theme/` | `@lushly-dev/loam-theme` | Loam's Violet tree (light, dark, high contrast, each with compact density), its exports, the token contract and the token-only lint; see [its README](theme/README.md) |
| `kernel/` | `@lushly-dev/loam-kernel` | The registries, kernel interface version 0, the shell commands, the layout model, the palette index and the journal options; replay, the journal diff and the reference workspace at `/testing`; no DOM dependency |
| `chrome/` | `@lushly-dev/loam-chrome` | The shell parts as FAST-AF elements (`loam-shell` is the one controller), the palette (loaded after first paint), the reserved chords, the layout classes, the router seam and theme application; `mountShell` and `renderNotice`. Its Specimen fixtures and E2's committed journal are in `specimens/` |
| `web/` | `@lushly-dev/loam-web` | The browser host: the kernel over IndexedDB with the journal's writer lock and the second-tab notice, the static shell built with Vite, its Chromium suite for E1 to E10 and A1 to A3, and the bundle `budget` |

## Commands

```sh
pnpm -F "@lushly-dev/loam-web..." build      # the web host and everything it needs
pnpm -F "./endpoints/loam/packages/*" test   # browser-free units (also run by pnpm check)
pnpm -F @lushly-dev/loam-theme theme:check   # the committed token contract and layout defaults against the tree
pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome lint:tokens   # token-only lint (needs the build)
pnpm -F @lushly-dev/loam-web test:browser    # builds Specimen's native host (Rust), then Chromium against dist/ (needs the build)
pnpm -F @lushly-dev/loam-web budget          # the bundle budget of spec 8.1
pnpm -F @lushly-dev/loam-chrome session:record   # regenerate E2's journal fixture after SESSION_50 changes
```
