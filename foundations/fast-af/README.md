# FAST-AF foundation

Maintained FAST-AF runtime and components, imported from [lushly-dev/fast-af](https://github.com/lushly-dev/fast-af) at `dc3a2b98edb2d60a1162b142523e839d2b686e57` and reconciled on 2026-10-30 with every later upstream main commit to the imported paths, through `5e64a6a5e7d459643fa62d0fe8ea22146afc4db1` (fast-af #185, #186, #230, #232, #235, #237). Moved code is frozen upstream; changes are made here. Paths below this directory keep their upstream layout, so `foundations/fast-af/<path>` is upstream `<path>`. File hashes and every adaptation, with reasons, are in [`provenance`](./provenance/provenance.json).

| Package | Path | Contract |
| --- | --- | --- |
| `@lushly-dev/fast-element` 3.0.1 | [`packages/element/packages/fast-element`](./packages/element/packages/fast-element/README.md) | Web component runtime, 38 export paths with types and production/development root conditions. Depends only on `@webcomponents/scoped-custom-element-registry`. |
| `@lushly-dev/violet-elements` 0.1.0, `private: true` | [`packages/violet-elements`](./packages/violet-elements/README.md) | The FAST-AF component package despite its name: root barrel that registers its elements, per-element modules under `dist/*`, `custom-elements.json`, `tokens/*` and `package.json`. Peer of `@lushly-dev/fast-element` 3.0.1. It has local theme registries and no dependency on Violet's token engine. |

Neither package depends on AFD, Specimen or Violet. [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md) are the upstream files, unchanged. `NOTICE.md` also lists upstream components that were not imported (Fluent reference components, Creator). Each package directory carries a verbatim copy of its applicable license so the packed artifact includes it: Microsoft's for `fast-element`, the Lushly root license for `violet-elements`.

Not imported: Creator, the legacy Fluent components, the upstream-named router, the reference sites (except the one path-export page the runtime's documentation check reads), the obsolete fast-html distribution, benchmarks, the CLI, Fastbot, Storybook configuration and the upstream root tooling. Violet web keeps its patched FAST archives; these packages do not replace them.

## Gates

From the repository root, using the Node version in `.nvmrc`:

```sh
pnpm install --frozen-lockfile
pnpm -F "@lushly-dev/violet-elements..." build          # part of pnpm build
pnpm -F @lushly-dev/violet-elements verify:exports       # packed contents, exports and source maps
pnpm -F @lushly-dev/fast-element test                    # browser-free; part of pnpm check
pnpm -F @lushly-dev/fast-element exec playwright install chromium firefox webkit
pnpm -F @lushly-dev/fast-element test:ci                 # migration rules and three-browser suites
pnpm -F @lushly-dev/violet-elements exec playwright install chromium
pnpm -F @lushly-dev/violet-elements test:browser         # Chromium suite with coverage thresholds
node tests/consumers/fast-af/verify-artifacts.mjs        # packed tarballs outside the workspace
```

`pnpm check` runs the build and the browser-free runtime test (lint, API reports, path-export documentation, declaration and export smoke checks). [`fast-af.yml`](../../.github/workflows/fast-af.yml) runs the browser suites, the migration rules, the generated-artifact check and the packed consumers. `@ast-grep/cli` 0.51 ships JavaScript bin shims that locate the platform binary, so its postinstall is not run; running it replaces the shims with the native binary, which pnpm's `node` bin wrapper cannot execute.

The fast-element build rewrites its API reports when the public API changes, as upstream; the provenance test then fails until the change is recorded. It no longer regenerates `SIZES.md`; run `pnpm -F @lushly-dev/fast-element build:sizes` to refresh that report.

## Publication

Both units are quarantined in [`scripts/release/inventory.json`](../../scripts/release/inventory.json). The upstream repository remains authoritative: it versions with Changesets and has no publish workflow, tags or releases. The 45 changesets pending upstream at import were not imported; the three describing the reconciled violet-elements changes are in [`.changeset`](../../.changeset). No package may publish under a Microsoft or other upstream namespace.
