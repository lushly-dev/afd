# Specimen foundation split and compatibility transition

Source: Specimen feasibility branch `codex/specimens-feasibility` of this repository at `ceaa5156ae0461c2b076168ea4949535f8fcf176` (five commits on base `bc43019a`, never merged to main or published). Imported in platform migration Phase 3 as three quarantined units. File-level hashes and adaptation reasons are in [`foundations/specimen/provenance`](../../../../foundations/specimen/provenance/provenance.json).

| Unit | Layer | Path | Contract |
| --- | --- | --- | --- |
| `@lushly-dev/specimen` | foundation | [`foundations/specimen`](../../../../foundations/specimen/README.md) | Native bench, diff, normalization, types and data validators. No AFD, FAST-AF, Violet, integration or endpoint dependency, peer, type reference or install hook. |
| `@lushly-dev/specimen-afd` | integration | [`integrations/specimen-afd`](../../../../integrations/specimen-afd/README.md) | AFD command definitions. Peers: `@lushly-dev/specimen`, `@lushly-dev/afd-core`, `@lushly-dev/afd-server`, each `^2.2.0`. |
| `@lushly-dev/specimen-cli` | endpoint | [`endpoints/specimen-cli`](../../../../endpoints/specimen-cli/README.md) | The `specimen` binary and `runCli`/`CliIO`. Depends on the integration and both foundations. |

## Upgrade path

| Selected-source contract | Imported contract | Transition |
| --- | --- | --- |
| `@lushly-dev/specimen` root native functions, constants and types | Same name, version 2.2.0 and native exports | Existing native imports stay valid. |
| Root `createSpecimenCommands`, `executeSpecimenCommand` | `@lushly-dev/specimen-afd` root | Change the import and install the integration with supported Specimen and AFD core/server peers. |
| Internal command schemas and `SpecimenCommandBench` | Integration root; native data validators from `@lushly-dev/specimen/schema` | The old internal paths were not package exports and remain unsupported. |
| `specimen` binary bundled with the native package | Same binary from `@lushly-dev/specimen-cli` | Install the endpoint. Commands, options, the single stdout JSON envelope, output files and 0/1 exit codes are unchanged. |
| Internal `runCli`, `CliIO` | `@lushly-dev/specimen-cli` root | New public embedding entry point. |

The removed root AFD exports and the moved binary are an explicit unreleased breaking transition. It is acceptable at 2.2.0 only because the selected package was never published: an anonymous npm read returned 404, which is not proof of publisher rights or absence of private versions. If any prior publication is confirmed, revisit semver and this transition before release.

The AFD peer ranges match the AFD 2.2.0 that the source branch built against. AFD core/server sources are unchanged between the source base and this import, so the move does not silently raise the AFD API requirement. A missing explicitly requested integration fails with normal package resolution naming `@lushly-dev/specimen-afd`; strict peer installation rejects absent or incompatible peers.

## Validation routes

- `pnpm check` runs the browser-free native subset (`foundations/specimen/vitest.unit.config.ts`) and the integration and CLI suites.
- [`specimen.yml`](../../../../.github/workflows/specimen.yml) installs Chromium and runs the full native suite (`test:browser`) and the packed-artifact consumers in [`tests/consumers/specimen`](../../../../tests/consumers/specimen/verify-artifacts.mjs).
- The consumers pack all five involved tarballs, then install them in temporary projects outside the workspace: native-only, integration present, requested-but-absent integration, missing peers, and incompatible Specimen or AFD peers.

## Limits

Pixel comparison, axe, token dependencies and event history remain unsupported; `requireVisual` yields insufficient evidence. Screenshots and structured observations do not establish visual equivalence. Storybook removal is not authorized. The [current status ledger](../specimens/STATUS.md) and [implementation plan](../specimens/implementation.md) now track the split units and remaining work; dated validation documents retain the pre-split source receipts and later branch experiments. The [proposal](../specimens/specimens.proposal.md) retains the full replacement contract with the package allocation reconciled to this transition. All three distributions are quarantined, no publisher is recorded, and the consumers use local tarballs rather than registry installation.
