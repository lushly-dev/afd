# Hello

Loam's reference app, in one handler module (`src/handlers.ts`). This directory holds the native
kind, `manifests/native.toml`; the view and mounted kinds join it in later steps of phase 1.

Trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a contract, not a
boundary. Ship untrusted code as a view.

`pnpm build` builds it, `pnpm pack` packs it into `dist/package`, and `pnpm test` runs its scenario and
replays it.
