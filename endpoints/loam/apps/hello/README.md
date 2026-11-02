# Hello

Loam's reference app, in one handler module (`src/handlers.ts`). This directory holds the native
kind, `manifests/native.toml`, and the view kind, `manifests/view.toml`; the mounted kind joins them in
step 7 of phase 1.

- **Native:** trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a
  contract, not a boundary. Ship untrusted code as a view.
- **View:** sandboxed: its grants are enforced. `src/view-main.ts` compiles into `dist/main.html`, and the
  same handlers run in `dist/handlers.html`, a hidden frame. A deployment needs `dist/sandbox/` on a second
  origin.

`pnpm build` builds both, `pnpm pack` and `pnpm pack:view` pack each kind into `dist/package` and
`dist/package-view`, and `pnpm test` runs its scenario and replays it.
