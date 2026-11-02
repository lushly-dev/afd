# Hello

Loam's reference app, in one handler module (`src/handlers.ts`). This directory holds the native
kind, `manifests/native.toml`, the view kind, `manifests/view.toml`, and the mounted kind,
`manifests/mounted.toml`.

- **Native:** trusted, not sandboxed. Native apps share the shell's page, so this app's grants are a
  contract, not a boundary. Ship untrusted code as a view.
- **View:** sandboxed: its grants are enforced. `src/view-main.ts` compiles into `dist/main.html`, and the
  same handlers run in `dist/handlers.html`, a hidden frame. A deployment needs `dist/sandbox/` on a second
  origin.
- **Mounted:** an external server's `hello-greet`, in the console. No code of this directory runs: Umbel's own
  hello plugin answers in the suite. Its annotations are the server's own claim, and its results are data,
  labeled untrusted.

`pnpm build` builds the first two, `pnpm pack`, `pnpm pack:view` and `pnpm pack:mounted` pack each kind into
`dist/package`, `dist/package-view` and `dist/package-mounted`, and `pnpm test` runs its scenario and replays it.
