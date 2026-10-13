# Updating AFD packages in the next round

Updated 2026-10-13. Use this alongside the [release workflow](../SKILL.md) and
[release checklist](release-checklist.md). Versions are independent across the
four implementations; the private root `package.json` version is not a release.

## Start with a change and an immutable candidate

1. Refresh `origin/main`, use a clean owned worktree and record the base SHA.
2. Classify the diff: fixture/docs/tooling only, dependency update, or published
   API/runtime behavior. #362 fixtures are development infrastructure excluded
   from registry payloads; changing them alone does not require an SDK release.
3. Preserve the installed dependency versions while establishing hosted behavior.
   A dependency upgrade is a separate candidate with its own regression evidence.
4. File/reuse the issue for any reproduced SDK defect. Give each implementation
   lane named ownership, then integrate fixes and independently review the full
   final diff. Do not treat a fixture workaround as an SDK repair.

Documentation and package-description corrections can be recorded in source
without a standalone SDK release when they change no API/runtime/dependency. The
metadata reaches registries with the next planned release; do not claim an already
published artifact has been replaced. This round's local-db description correction
follows that policy and has no no-op Changeset.

Current published baselines are npm 2.1.0 (all nine packages), Python 0.9.0,
Rust 0.1.0 and C++ 0.1.0. Recheck registries and tags at the next release rather
than assuming these remain latest. Contract `1.0-rc` is a separate version;
change it only through the shared specification/compatibility process.

## Update dependencies deliberately

- Pick the affected workspace and dependency; inspect the vendor migration notes,
  peer constraints, advisory and supported runtime before selecting a version.
- Use a filtered package-manager update, retain the pinned pnpm/runtime, and review
  the manifest and lockfile diff. Avoid a repository-wide `--latest` upgrade as
  part of a verification run. Private fixtures also have locked dependencies.
- Preserve optional-peer declarations and workspace ranges. Keep application SDK
  versions distinct from a provider's administrative CLI version. If the pinned
  Convex CLI lacks a provisioning command, use its supported dashboard/setup path
  or a separately pinned administration tool; do not silently upgrade the SDK
  under test.
- Run the affected integration/local fixture gates plus the normal quality gates.
  Record the resolved versions again in the hosted receipt. Dependency-only work
  needs a release decision based on its effect on the published package, not an
  automatic version bump of every language.

## Choose the affected release track

| Track | Versioning and release path | Required evidence |
|---|---|---|
| npm | Add a Changeset for changed published behavior. The fixed group bumps all nine `@lushly-dev/*` packages together. Merge the implementation PR, review the generated Changesets release PR, then merge it for `release.yml` OIDC publication. | `pnpm check`; applicable language/fixture/conformance checks; exact implementation and release-PR head CI; packed manifest/consumer checks before publication; all nine downloaded artifacts, integrity values, tags and fresh consumers afterward. |
| Python | Update `python/pyproject.toml` and `python/src/afd/__init__.py`; refresh locks in `python/`, `alfred/` and the todo Python backend. Date the Python changelog, merge the reviewed candidate, then tag that merge `python-vX.Y.Z`. | `python.yml` on the exact release candidate, supported 3.10–3.12 matrix and isolated extra installs; downloaded wheel digest/payload and fresh base/client/server/CLI consumers. |
| Rust | Update `packages/rust/Cargo.toml` and its changelog, run clean `cargo publish --dry-run --locked`, merge the reviewed candidate, then tag that merge `rust-vX.Y.Z`. Use the existing trusted publisher. | fmt, default/no-default clippy/tests, wasm and conformance; actual OIDC exchange/upload for a new version; downloaded crate checksum/payload/source identity and fresh default/no-default consumers. |
| C++ | Update `project(afd VERSION ...)` and its changelog, merge the reviewed candidate, then tag that merge `cpp-vX.Y.Z` and create its GitHub Release. No registry upload. | Exact-candidate compiler/sanitizer/wasm/package/fuzz matrix and conformance; fresh public-tag FetchContent plus installed `find_package` consumers, including exact header/library/contract versions. |

The npm fixed group is configured in `.changeset/config.json`. Before accepting
its release PR, inspect `pnpm changeset status --verbose`, all nine manifests,
internal peer ranges and `peerDependenciesMeta`. Exercise optional peers absent
and present, especially auth commands and view-state/local-db declarations.
Never choose the next npm version by editing the private root manifest.

Rust's first bootstrap is complete. Do not create another long-lived crates.io
token for a normal update. Its publisher is owner `lushly-dev`, repository `afd`,
workflow `publish-rust.yml`, environment `crates-io`. The 0.1.0 tag skipped an
existing manual upload; the first genuinely new version must prove the OIDC path.

## Keep documentation and evidence aligned

- Use per-implementation changelogs; root `CHANGELOG.md` stays an index. No no-op
  Changeset or runtime release is needed for this guide or fixture-only changes.
- Run `node scripts/check-versions.mjs --write` after manifest changes. Review the
  Version, Distribution, Contract and Updated rows in `docs/language-parity.md`.
- Keep install snippets on the last published version/tag while preparing a new
  candidate. After registry/tag verification, update package READMEs, skills,
  site HTML, runtime copy strings and `llms.txt` together.
- For a squash merge, verify GitHub's merged state and reviewed/merged tree
  content. Then require post-merge checks on the chosen release commit.
- Retain source SHA, packed/downloaded payload identity, registry checksum,
  publication workflow, exact tag targets and fresh-consumer outcomes. A package
  name/version printed in a fixture receipt is manifest metadata, not proof of a
  registry installation. #362 source assurance and registry delivery are separate.
- If publication succeeded, do not repeat it because metadata is stale. Check
  official version metadata, download the artifact and use a fresh consumer/cache.
- Finish with main/remote parity, issue disposition, live documentation readback
  where applicable, and a durable release receipt. Keep unrun provider checks open.

See [npm/Python receipts](../../../../docs/operations/stabilization-release.md),
[native release receipts](../../../../docs/operations/native-first-releases.md)
and [hosted verification](../../../../docs/operations/hosted-verification.md).
