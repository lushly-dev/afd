# Doctor layout-only pack checks for component plugins (D223)

- Date: 2026-11-27
- Area: the plugin contract, worlds and the component journal
- Pull request: [#2944](https://github.com/lushly-dev/afd/pull/2944), on `t3/umbel-doctor-component-pack-checks`

Recorded the owner's 2026-11-27 decision on [#1445](https://github.com/lushly-dev/afd/issues/1445)
as D223: `umbel workspace doctor`'s `plugins.pack_checks` reports space overrides that `seal` found
of loaded component plugins as checked for layout only (naming the component instances and count,
noting that components have no `check-pack` export, and keeping the disclosure on mixed-workspace
warnings and failures as well as passes), while adding a `check-pack` WIT export waits until WIT
world 1.2.0 is triggered by [#1381](https://github.com/lushly-dev/afd/issues/1381) (D192). Updated
`endpoints/umbel/src/plugins/doctor.rs`, `endpoints/umbel/docs/decisions.md`, the phase 1
specification section 9.2, the components specification section 9.1 and A23 follow-up and the
components plugin README, and fixed `spec/plugin-manifest.md` to list `v7.json` under Umbel's
profile.

Verified 2026-11-27: unit tests in `src/plugins/doctor.rs` (5 passed), integration tests in
`tests/it/component_components.rs` (5 passed, seen failing before the fix) and
`tests/it/doctor_pack_checks.rs` (8 passed), `cargo clippy --locked -p umbel --all-targets -- -D warnings`,
`scripts/check-doc-lines.mjs`, and `pnpm verify` (Node 26).
