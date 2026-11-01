# Loam packages

The four TypeScript packages of AFD Loam's phase 0. All are private and
quarantined: `private: true`, no release route, and gated by `pnpm check` and
`loam.yml`. Read [`../docs/STATUS.md`](../docs/STATUS.md) and the
[phase 0 specification](../docs/phases/0-kernel-chrome/spec.md) first.

| Directory | Package | Responsibility |
| --- | --- | --- |
| `theme/` | `@lushly-dev/loam-theme` | Loam's Violet tree (light, dark, high contrast, each with compact density), its exports, the token contract and the token-only lint; see [its README](theme/README.md) |
| `kernel/` | `@lushly-dev/loam-kernel` | The registries, kernel interface version 0, the shell commands, the layout model, the journal and replay; no DOM dependency |
| `chrome/` | `@lushly-dev/loam-chrome` | The shell parts as FAST-AF elements, the palette, keyboard and the responsive rules |
| `web/` | `@lushly-dev/loam-web` | The browser host: the static shell built with Vite, its Chromium suite and its budget |

## Commands

```sh
pnpm -F "@lushly-dev/loam-web..." build      # the web host and everything it needs
pnpm -F "./endpoints/loam/packages/*" test   # browser-free units (also run by pnpm check)
pnpm -F @lushly-dev/loam-theme theme:check   # the committed token contract and layout defaults against the tree
pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome lint:tokens   # token-only lint (needs the build)
pnpm -F @lushly-dev/loam-web test:browser    # Chromium against dist/ (needs the build)
```
