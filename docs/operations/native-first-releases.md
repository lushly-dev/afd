# Rust and C++ first-release handoff

Updated 2026-10-13. npm 2.1.0 and Python 0.9.0 contain the October stabilization
fixes; see [published receipts](stabilization-release.md). C++ 0.1.0 is now
published; Rust 0.1.0 is published on crates.io. Both implement contract
`1.0-rc`. Rust 0.2.0 and 0.2.1 and C++ 0.2.0 followed on 2026-10-27; see [later releases](#later-releases).

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
still demonstrate the OIDC exchange and upload. Rust 0.2.0 demonstrated it ([later releases](#later-releases)). The bootstrap token was removed from local Cargo storage and revoked by the
maintainer on crates.io; a refreshed token list confirmed no active API tokens.

The published archive retains the pre-publication README wording from the reviewed
source. The repository README now recommends `cargo add afd`; docs-only follow-up
does not require replacing or republishing the immutable 0.1.0 artifact.

## Bootstrapping a new crate

crates.io offers trusted publishing only for a crate that already exists, so a
new crate's first version is published by hand, once. This is how `afd` 0.1.0
was bootstrapped (the name was free on crates.io on 2026-09-27); never repeat it
for `afd`.

1. In the release pull request, also:
   - add exact-version registry instructions to the crate's README, explicitly
     conditional on publication; the README is packaged into the crate.
   - keep usable git and path instructions, and a truthful unpublished status,
     in the README, the language skill and `docs/language-parity.md` until the
     registry is verified.
2. The maintainer, on the merge commit and with a crates.io API token that can
   publish new crates, runs `cargo login`, then `cargo publish` in the crate's
   directory.
3. The maintainer adds a GitHub trusted publisher under the crate's
   Settings → Trusted Publishing (for `afd`: owner `lushly-dev`, repository
   `afd`, workflow `publish-rust.yml`, environment `crates-io`), then revokes the
   API token.
4. The maintainer pushes the tag for the same commit. The publish workflow runs
   its checks and skips the upload, because crates.io already has the version;
   later versions publish through the workflow.
5. Download the published crate and verify fresh consumers. Then change the
   default installation to `cargo add <crate>` and the Distribution row to
   crates.io.

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

C++ package/skill/site installation snippets pin the latest published tag (`cpp-v0.2.0` as of 2026-11-04); distribution status is published and the feature record is
under `docs/features/complete/cpp-support/`. Rust package/skill/site installation
now recommends the published crate. Rust remains a preview in-process library;
publication does not provide the historical proposal's general-purpose MCP
transports or distribution framework.

No hosted provisioning is needed to publish these core libraries. #362 remains
an independent auth/persistence verification task; local fixture preparation
does not certify hosted providers.

## Later releases

### Rust 0.2.0 and 0.2.1

0.2.0 was published on 2026-10-27 from #454's merge commit
`ddb42ad294e79fcbb096d03d7351f45d56f6c2ce`
([Publish Rust Crate run 40472313107](https://github.com/lushly-dev/afd/actions/runs/40472313107)),
the first version uploaded through crates.io trusted publishing. Its docs.rs
build failed with E0658: `doc(cfg)` badges without
`#![cfg_attr(docsrs, feature(doc_cfg))]`. 0.2.1
([run 40616779408](https://github.com/lushly-dev/afd/actions/runs/40616779408),
#456's merge commit `87fd19bdcede7712e2f6fb5a1abff15c19b952d6`) fixed that with
no code change and documents on docs.rs. #457 then added `rust.yml`'s `docs-rs`
job, which builds the docs the way docs.rs does and which `publish-rust.yml`
runs before uploading. It passes `--cfg docsrs` to rustdoc only: as `RUSTFLAGS`
it reaches dependencies whose docsrs paths no longer build on nightly.

### C++ 0.2.0

`cpp-v0.2.0` was published on 2026-10-27 from
`ddb42ad294e79fcbb096d03d7351f45d56f6c2ce` (#454). Its GitHub Release was
created with `--latest=false`, so the npm release kept "Latest". Fresh
`FetchContent` and installed `find_package(afd 0.2)` consumers built and ran
from the tag. Because the CMake package uses `SameMinorVersion` compatibility,
the minor bump also had to change `find_package(afd 0.2 …)` in
`packages/cpp/tests/consumer/CMakeLists.txt`; the `C++ (package, …)` jobs
failed until it did.
