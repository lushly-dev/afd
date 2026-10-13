# Rust and C++ first-release handoff

Updated 2026-10-13. npm 2.1.0 and Python 0.9.0 contain the October stabilization
fixes; see [published receipts](stabilization-release.md). C++ 0.1.0 is now
published; Rust 0.1.0 is published on crates.io. Both implement contract
`1.0-rc`.

| Platform | Tracker | Publication status and remaining work |
|---|---|---|
| Rust | [#376](https://github.com/lushly-dev/afd/issues/376) | Published [0.1.0](https://crates.io/crates/afd/0.1.0); downloaded-crate consumers and `rust-v0.1.0` checks passed |
| C++ | [#327](https://github.com/lushly-dev/afd/issues/327) | Published `cpp-v0.1.0`; remote-tag and installed CMake consumers passed |

## C++ publication receipt

The annotated [cpp-v0.1.0](https://github.com/lushly-dev/afd/releases/tag/cpp-v0.1.0)
tag resolves to `a3115622ce8252a45ffff9d752e3cc161a481035` (#377). The tag and
GitHub Release were created with explicit maintainer authorization after all
post-merge gates passed. [C++ CI](https://github.com/lushly-dev/afd/actions/runs/38354126911)
includes GCC, MSVC, pinned clang-cl 22.1.8, Linux ASan/UBSan and TSan, macOS,
Emscripten, package consumers and five 60-second fuzz targets. The conformance,
Rust, TypeScript, browser and local fixture workflows also passed on that source.

Fresh external projects fetched the public tag using Git and CMake FetchContent,
and installed its package for a separate `find_package(afd 0.1 CONFIG REQUIRED)`
consumer. Both passed the real quickstart and exact header/library version and
contract checks (2/2 each) on macOS with Apple Clang 17. These are independent
tagged-consumer checks; they do not claim a new tagged Windows test invocation.

## Rust publication receipt

The [afd 0.1.0 crate](https://crates.io/crates/afd/0.1.0) and annotated
[rust-v0.1.0](https://github.com/lushly-dev/afd/releases/tag/rust-v0.1.0) tag use
`a3115622ce8252a45ffff9d752e3cc161a481035` (#377). The maintainer authorized the
first manual upload after source CI and clean package validation passed. The
initial authenticated attempt was rejected because the new crates.io account
needed a verified email; publication succeeded after that prerequisite was met.

The downloaded archive's SHA-256 matches registry metadata:
`edc8ee95009c1071f1ace06a3d73e140cccb74db01c8f02e5728315c4869bc9c`.
All 38 packaged files match the published payload, and `.cargo_vcs_info.json`
records the clean source above. Fresh exact-version consumers with separate empty
Cargo homes passed with default and no-default features: command registration,
dispatch, defaults, unknown-field stripping, validation errors with suggestions
and contract `1.0-rc`. The application supplies its own Tokio runtime in both
consumers. [docs.rs](https://docs.rs/afd/0.1.0/afd/) serves the release API docs.

The GitHub trusted publisher was created and read back for crate `afd`, owner
`lushly-dev`, repository `afd`, workflow `publish-rust.yml`, environment `crates-io`.
[Tag workflow 38359125471](https://github.com/lushly-dev/afd/actions/runs/38359125471)
passed its version and Rust gates and correctly skipped the existing 0.1.0 upload.
That skip verifies the first-release workflow path; a future new version must
still demonstrate the OIDC exchange and upload. The bootstrap token was removed from local Cargo storage and revoked by the
maintainer on crates.io; a refreshed token list confirmed no active API tokens.

The published archive retains the pre-publication README wording from the reviewed
source. The repository README now recommends `cargo add afd`; docs-only follow-up
does not require replacing or republishing the immutable 0.1.0 artifact.

## Candidate acceptance

Merge reviewed preparation only after the exact candidate passes applicable CI.
The C++ release includes the clang-cl warnings-as-errors repair (#342), the
MSVC 2022 minimum diagnostic (#344) and configure-policy regressions. The Windows
clang-cl job supplies actual compiler evidence beyond simulated CMake policy
tests. The macOS ASan startup hang remains tracked in #331; Linux sanitizer jobs
provide sanitizer coverage and that limitation must stay visible.

For Rust run fmt, clippy and tests with default and no-default features, the wasm
check, and a clean `cargo publish --dry-run`. For C++ run dev and no-exceptions/
no-RTTI builds, the workflow compiler/sanitizer matrix and fresh installed
`find_package` and source `FetchContent` consumers. Both participate in the shared
34-case todo conformance suite. Store exact source revisions with the receipts.

## Maintainer publication

First refresh main and select the reviewed merge commit explicitly. Recheck
registry/tag state so a successful publication is never repeated because of stale
metadata. The [release skill](../../.claude/skills/do-release/SKILL.md) describes
the maintainer steps and tag validation.

Rust's first manual upload, public tag, downloaded consumers and publisher
configuration are complete. Future versions use `publish-rust.yml` and the
reviewed-merge procedure in the release skill. Verify each downloaded artifact
and fresh consumers after publication; do not repeat the successful 0.1.0 upload.

C++ has no registry upload. Its first tag, GitHub Release and fresh tagged-consumer
checks are complete; future releases follow the same reviewed-merge procedure.

C++ package/skill/site installation snippets now pin `cpp-v0.1.0`; the public tag
badge reports 0.1.0, distribution status is published and the feature record is
under `docs/features/complete/cpp-support/`. Rust package/skill/site installation
now recommends the published crate. Rust remains a preview in-process library;
publication does not provide the historical proposal's general-purpose MCP
transports or distribution framework.

No hosted provisioning is needed to publish these core libraries. #362 remains
an independent auth/persistence verification task; local fixture preparation
does not certify hosted providers.
