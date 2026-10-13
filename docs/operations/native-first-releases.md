# Rust and C++ first-release handoff

Updated 2026-10-12. npm 2.1.0 and Python 0.9.0 contain the October stabilization
fixes; see [published receipts](stabilization-release.md). C++ 0.1.0 is now
published; Rust remains an unpublished 0.1.0 candidate. Both implement contract
`1.0-rc`.

| Platform | Tracker | Publication status and remaining work |
|---|---|---|
| Rust | [#376](https://github.com/lushly-dev/afd/issues/376) | First crates.io upload, downloaded-crate consumers, trusted-publisher setup and `rust-v0.1.0` |
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

Rust's first crate must be uploaded using a locally configured credential allowed
to create the crate. Run the final clean package dry-run at the merge commit, then
publish once. Download the actual crate and test fresh exact-version default and
no-default consumers. Configure its GitHub trusted publisher as owner `lushly-dev`,
repository `afd`, workflow `publish-rust.yml`, environment `crates-io`; revoke the
bootstrap credential. Tag the same commit `rust-v0.1.0`. The workflow rechecks the
version and skips an already published version. Verify registry/docs.rs availability.

C++ has no registry upload. Its first tag, GitHub Release and fresh tagged-consumer
checks are complete; future releases follow the same reviewed-merge procedure.

C++ package/skill/site installation snippets now pin `cpp-v0.1.0`; the public tag
badge reports 0.1.0, distribution status is published and the feature record is
under `docs/features/complete/cpp-support/`. Rust can recommend `cargo add afd`
after its own downloaded-consumer verification. Until then retain its usable
source installation instructions and unpublished status.

No hosted provisioning is needed to publish these core libraries. #362 remains
an independent auth/persistence verification task; local fixture preparation
does not certify hosted providers. Rust's first upload still requires a locally
configured crates.io credential, followed by downloaded-consumer verification
and trusted-publisher setup. C++ publication does not establish Rust availability.
