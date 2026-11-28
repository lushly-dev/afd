# Desktop installers ship third-party notices (#2808)

- Date: 2026-11-27
- Area: phase 6, hosts and distribution
- Pull request: [#2984](https://github.com/lushly-dev/afd/pull/2984), on `lush/loam-desktop-license-notices`, for [#2808](https://github.com/lushly-dev/afd/issues/2808)

Every desktop installer now carries `THIRD_PARTY_NOTICES.txt` and the Rust standard library's
`RUST_STANDARD_LIBRARY_NOTICES.html` beside the app. `build:installers` runs `build:notices` first and
passes `tauri build` a `--config` that bundles both as resources, so `tauri.conf.json`, `cargo test`
and `build:app` need neither.

The approach, which the issue left open (`needs:approach`), and why:

- **What ships, exactly.** The Rust half walks `cargo metadata --locked` from the desktop crate over
  normal dependencies for the six desktop targets, leaving out build and dev dependencies and proc
  macros, which ship nothing. The npm half reads module records the shell's Vite build
  (`web/scripts/module-record.mjs`, into `web/build-record/`) and the copilot frame's build
  (`dist/frame/modules.json`, not copied to `sandbox/copilot/`) now write: every file each output
  holds. A production-dependency closure would have listed the stubbed vendor SDK roots and missed
  Vite's preload helper, Rolldown's runtime and FAST-AF's Microsoft notice, which sits in this
  repository rather than in `node_modules`.
  `build:notices` refuses a record that lacks its build's entry (`src/main.ts`, `src/frame/bootstrap.ts`),
  so a broken record cannot drop the npm half silently.
- **Every notice a package ships.** Licence, copying, notice and third-party files anywhere in its
  source but its tests, benches, examples, fuzz targets and docs: the review found `uds_windows`'s
  `THIRDPARTYNOTICES`, Rolldown's `THIRD-PARTY-LICENSE` and the vendored licences in ring, tracing-core,
  regex-syntax and the OpenAI and Anthropic SDKs, which a top-level `LICENSE*` scan missed.
- **Fail closed.** A package that ships no licence file gets the standard text of each licence it
  declares (`scripts/notices/licenses/`, from SPDX's license-list-data); one with no declared licence,
  or one with no standard text here, stops the build, naming every such package.
- **Supplements** for notices the source does not carry: Microsoft's WebView2 SDK licence for the
  `WebView2LoaderStatic.lib` that `webview2-com-sys` links statically on Windows (from the
  `Microsoft.Web.WebView2` 1.0.3650.58 NuGet package), and for the polyfill, which ships no licence
  file, its copyright header and the Polymer licence that header links. No licence among the shipped packages forbids
  redistribution.
- **No installer licence page.** The MSI and DMG licence page is an agreement to the product's own
  licence; the notices run to about 1 MB. Reading them from inside the app, and the system libraries
  linuxdeploy bundles into the AppImage, are open follow-ups in the phase 6 specification.

Verified 2026-11-27 on Windows 11 (Node 26.13.1, Rust 1.100.0): `pnpm verify --keep-going`
passed 35 of 36 steps; `test:browser` failed one Chromium case (`rail.test.ts`, P2-E3, a 30 s
timeout under load), which passed 44/44 alone, with browser conformance 24/24. After merging
`main` at `23ed9cea` (which adds `rfd` to the crate graph): `build:installers` wrote a 7.72 MiB MSI
whose `msiexec /a` copy holds both notice files byte for byte (`test:installers` 4/4, the #2808 case
red when the generated file is altered), `test/notices.test.ts` 10/10, `web`'s
`test/unit/module-record.test.ts` 2/2, and `build:notices` refused an emptied module record. Linux
and macOS installers are left to `loam-desktop.yml` (Linux on pull requests; Windows and macOS daily
and on demand).
