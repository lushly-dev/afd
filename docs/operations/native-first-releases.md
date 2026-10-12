# Rust and C++ first-release handoff

Prepared 2026-10-12. npm 2.1.0 and Python 0.9.0 already contain the October
stabilization fixes; see [published receipts](stabilization-release.md). Rust and
C++ remain **unpublished 0.1.0 candidates**, implementing contract `1.0-rc`.
Their dated changelogs are release preparation, not publication evidence.

| Platform | Tracker | Remaining public action |
|---|---|---|
| Rust | [#376](https://github.com/lushly-dev/afd/issues/376) | First crates.io upload, downloaded-crate consumers, trusted-publisher setup and `rust-v0.1.0` |
| C++ | [#327](https://github.com/lushly-dev/afd/issues/327) | `cpp-v0.1.0`, GitHub Release and fresh tagged CMake consumers |

## Candidate acceptance

Merge reviewed preparation only after the exact candidate passes applicable CI.
The C++ candidate includes the clang-cl warnings-as-errors repair (#342), the
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

Rust's first crate must be uploaded using a locally configured credential allowed
to create the crate. Run the final clean package dry-run at the merge commit, then
publish once. Download the actual crate and test fresh exact-version default and
no-default consumers. Configure its GitHub trusted publisher as owner `lushly-dev`,
repository `afd`, workflow `publish-rust.yml`, environment `crates-io`; revoke the
bootstrap credential. Tag the same commit `rust-v0.1.0`. The workflow rechecks the
version and skips an already published version. Verify registry/docs.rs availability.

C++ has no registry upload. Tag the reviewed merge commit `cpp-v0.1.0` and create
the GitHub Release from its changelog. Verify the tag's source and run fresh
FetchContent/install/find_package consumers against the actual tagged source.

After publication evidence exists, update install snippets and distribution
status. C++ references in the package README, `afd-cpp` skill, site HTML/runtime/
llms text and language parity should pin `cpp-v0.1.0`; verify the tag badge and
move the completed proposal. Rust can then recommend `cargo add afd` as the
default installation. Until then retain usable source installation instructions.

No hosted provisioning is needed to publish these core libraries. #362 remains
an independent auth/persistence verification task; local fixture preparation
does not certify hosted providers. This preparation does not push tags, create
releases, upload packages or change publishing settings.
