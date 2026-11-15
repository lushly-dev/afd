# Review: AFD platform monorepo

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Verdict | **REVISE REQUIRED before migration approval** |
| Findings | 2 blockers; 7 improvements |
| Reviewed artifacts | [Proposal](./proposal.md), 378 lines; [proposed decision](./decision.md), 47 lines |
| Method | Primary review plus three fresh, read-only reviews of foundation independence, publishing, and Alfred scope; source inspection and primary documentation research |
| Scope | Proposal review only. No migration, implementation changes, validation suite execution, publishing, deployment, or registry-setting changes. |

The architecture is coherent: independently adoptable foundation families, optional integrations, and endpoints that compose them. One main Alfred bot with area-specific commands is consistent with that architecture. Health may use AFD, and its dashboard may use FAST-AF, without imposing those choices on an audited application.

The two blockers are concrete interactions with existing release behavior. The migration plan admits packages before defining how they are excluded from the active publisher, and the proposed common Alfred catalog includes changeset commands whose file format conflicts with AFD's npm Changesets workflow. Both need proposal-level ownership/sequencing rules before implementation is approved.

The findings below are recommendations, not changes already applied to the design. The reviewed proposal and decision text remain unchanged so their line references stay stable.

## BLOCKERS

### B1 — P1: Exclude imported candidates from publication before they enter the live workspace

**Proposal locations:** lines 301–305 prepare expanded workspace/release discovery; lines 311, 322–325, and 333–335 import packages; lines 344–349 defer publisher handoff to Phase 5. Line 354 leaves the original repository authoritative until cutover.

**Evidence:** AFD's [release workflow](../../../../.github/workflows/release.yml), lines 3–5 and 38–48, runs on main pushes and calls the root publication command. [package.json](../../../../package.json), line 32, runs `changeset publish` without a package-admission boundary. The [version-matched Changesets 2.31.1 documentation](https://github.com/changesets/changesets/blob/%40changesets/cli%402.31.1/docs/command-line-options.md#publish) explains that publishing selects manifest versions absent from npm; a package does not need to be named in the most recent changeset to qualify. The [current CLI guide](https://changesets.dev/guide/cli#publish) also explicitly identifies accidental publication of newly added packages as a risk.

**Consequence:** A new split package, imported unreleased version, or subsequent candidate version can enter the publication set during phases 2–4. With registry authority, it can publish before handoff; without authority, it can fail the shared release run. Replacing fixed version groups and checking a version plan do not establish exclusion from publication.

**Required proposal revision:** Phase 1 must establish an explicit publication-admission state for each distribution before imports become discoverable. Candidate packages must remain buildable and packable for local/external-consumer testing while excluded from authoritative publication until their documented cutover. Existing AFD releases must continue to work. The exclusion mechanism belongs in the implementation specification; no particular Changesets option is assumed sufficient here.

**Acceptance criterion:** A non-publishing release-selection check includes an existing approved AFD release, excludes an imported package whose version is absent from its registry, and admits only a selected package and its approved prerequisites when that package is cut over. Equivalent admission rules apply to added language-specific routes.

### B2 — P1: Assign ownership of release fragments before exposing Botcore changeset commands through Alfred

**Proposal locations:** line 174 lists changesets among shared Botcore commands; lines 211 and 227–240 retain npm Changesets and separate release families; lines 311–314 consolidate tooling.

**Evidence:** Botcore's [changeset implementation](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/commands/changeset.py#L14-L54) selects every Markdown fragment in `.changeset` except README and parses a `type:` category. Its creator writes that format at lines 97–98. The consumer [treats unrecognized fragments as changelog additions](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/commands/changeset.py#L223-L230), writes the root changelog, and [deletes all selected fragments](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/commands/changeset.py#L286-L291). AFD instead uses [npm Changesets configuration](../../../../.changeset/config.json) and its [package-to-semver fragment format](https://github.com/changesets/changesets/blob/%40changesets/cli%402.31.1/docs/command-line-options.md#add).

**Consequence:** A correctly targeted Botcore consume command can erase AFD's package-release intent after interpreting it as generic prose. Command-name collision detection does not prevent this: the collision is between release protocols sharing storage.

**Required proposal revision:** Alfred release commands must resolve a declared release protocol and release unit. npm Changesets must own its fragments. Other changelog formats must use separate storage or an explicit compatible adapter. Unknown formats must fail without mutation, and generic commands must not consume another family's release records.

**Acceptance criterion:** A mixed-format fixture demonstrates that create/status/consume/delete operations affect only their declared protocol and release unit. An incompatible invocation leaves every fragment and changelog unchanged. This is a future acceptance requirement; the destructive operation was not run during review.

## IMPROVEMENTS

### I1 — P2: Preserve quality verdicts across Alfred's CLI, MCP, and aggregate checks

**Proposal locations:** lines 174–189 admit shared and specialist quality commands; line 276 describes the unified-Alfred fixture. Health has an explicit outcome model at line 155, but the main bot has no corresponding aggregation rule.

**Evidence:** [Alfred lint](../../../../alfred/src/alfred/commands/lint.py), lines 84–94, returns a successful command result with a separate `data.passed` value. The [CLI](../../../../alfred/src/alfred/cli.py), lines 41–68, separately interprets `passed`, `total_gaps`, and `issue_count` to set its exit status. Botcore's MCP surface invokes the underlying functions directly. Successful execution and a passing quality check are intentionally distinct today.

**Why it matters:** A new common runner that aggregates only `CommandResult.success` can declare a pass for findings that make the existing CLI fail. The draft does not require that mistake, but it does not prohibit it or define the aggregate contract.

**Recommended revision:** Require a machine-readable quality verdict or a registered verdict interpretation for each check. Preserve that meaning in CLI exits, MCP responses, and aggregation, including skipped, unavailable, and execution-error states. Keep execution success distinct from the check's outcome.

**Acceptance criterion:** The same failing lint/parity/quality fixtures produce equivalent verdicts through all supported surfaces; successful execution with failed checks never becomes an aggregate pass.

### I2 — P2: Define command effects and execution policy alongside target scope

**Proposal locations:** lines 185–190 specify discovery, targets, identity, dependencies, and worktree context. Explicit audit/remediation separation at line 156 covers Health but does not establish the rest of Alfred's command contract.

**Evidence:** The catalog includes file writers such as changeset/specification commands and Fastbot's [baseline-recording operation](https://github.com/lushly-dev/fast-af/blob/e9abdf25516401221183821e81b0e02cd7e1c498/plugins/fastbot-fast-af/src/fastbot_fast_af/commands.py#L2039-L2061). Botcore's [MCP runner](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/server.py#L158-L184) executes Python with raw registered callables, whereas [registry middleware](https://github.com/lushly-dev/botcore/blob/40f829cc254ae243fde6cb3852afec1b84b74647/src/botcore/registry.py#L34-L42) is applied through a different invocation path.

**Why it matters:** Correct targeting does not tell a caller whether an operation inspects files, changes a baseline, modifies source, launches a browser, or contacts a service. A policy attached to one execution surface does not automatically govern another.

**Recommended revision:** Catalog entries should declare meaningful effects and required capabilities. Supported invocation surfaces should apply the same relevant policy; mutations should be explicitly selected. State that retained Python execution is trusted local execution, and distinguish operational scoping from an adversarial sandbox. This does not require a new permission prompt for every command or separate subproject bots.

**Acceptance criterion:** Discovery distinguishes inspection from mutations and browser/service requirements. If an inspection-only mode is offered, no supported invocation route may reach a writer in that mode, and rejected calls must have no effects. Target and worktree context must be preserved on every route.

**Classification:** This is a contract clarification to settle before Phase 2's unified endpoint is implemented. It is not evidence that one catalog is inherently unsafe or that a remote multi-tenant service is required.

### I3 — P2: Map independence evidence to every admitted public distribution and supported entry point

**Proposal locations:** lines 42 and 124–131 define a strong independence contract. Lines 266–279 provide one representative behavior fixture per family, while line 289 already calls for a package/API inventory.

**Evidence:** FAST-AF's [runtime manifest](https://github.com/lushly-dev/fast-af/blob/e9abdf25516401221183821e81b0e02cd7e1c498/packages/element/packages/fast-element/package.json#L18-L85) exposes multiple subpaths and conditions; its maintained component package is a separate unit. Violet has distinct core and browser-runtime surfaces. One example cannot prove every admitted artifact's dependency/type contract.

**Why it matters:** A passing token export or single component can coexist with an eager cross-family import, required peer, or exported type dependency elsewhere in the same admitted family.

**Recommended revision:** Make the Phase 0 inventory the coverage map for installation, dependency, peer, exported-type, and supported-import checks. Representative behavior examples can stay small; all admitted distributions and supported entry points need explicit coverage or a documented limit.

**Acceptance criterion:** Every admitted artifact is represented in the independence inventory. Supported entry points receive import/type checks in the appropriate environment, and the family behavior fixtures run from built artifacts without undeclared platform dependencies.

### I4 — P2: Add negative integration cases to the acceptance matrix

**Proposal locations:** line 130 promises native operation without integrations and actionable errors for unavailable integrations; line 274 describes successful integration installation and version-range checks.

**Evidence:** Current Specimen exposes its AFD command exports through the root barrel, and Violet's core [barrel](https://github.com/lushly-dev/violet/blob/46701c2f59931ec0e1393e5a1a3ae84166395917/packages/core/src/index.ts#L7-L17) and [result types](https://github.com/lushly-dev/violet/blob/46701c2f59931ec0e1393e5a1a3ae84166395917/packages/core/src/types/command-result.ts#L7-L21) contain the coupling being separated. Moving code into another directory alone will not prove removal of eager imports or declaration references.

**Recommended revision:** Extend the matrix with absent integration, unsupported version combination, and explicitly requested unavailable integration cases. Align the diagnostic requirement with the installation/runtime failure point; a package-manager compatibility rejection need not be converted into an application exception.

**Acceptance criterion:** Native imports and representative operations work with integrations absent. Unsupported compositions fail at the documented boundary with useful recovery guidance. Generated declarations and root exports do not accidentally reintroduce required integrations.

### I5 — P2: Include C++ source-consumption contracts in relocation acceptance

**Proposal locations:** line 228 preserves C++ distribution; lines 240 and 266–279 discuss artifacts and registry installation; line 343 completes remaining path moves.

**Evidence:** [C++ consumption documentation](../../../../packages/cpp/README.md), lines 118–149, explicitly uses no package registry. It documents immutable source tags, `FetchContent` with `SOURCE_SUBDIR packages/cpp`, installed `find_package(afd ...)`, the `afd::afd` target, and vendoring. The proposed tree eventually moves that directory.

**Why it matters:** npm/wheel/registry smoke checks cannot establish continuity for a CMake consumer. Updating internal paths and documentation does not decide whether downstream source-subdirectory usage remains compatible at a new release.

**Recommended revision:** Treat source tags, supported source-subdirectory paths, and exported CMake package/target identity as public distribution contracts. Choose a compatibility path or a documented breaking transition before relocating the C++ source distribution. Preserve existing immutable tags.

**Acceptance criterion:** An external consumer uses the intended release through both `FetchContent` and installed `find_package`; existing immutable tags remain usable. Explicitly account for supported vendoring paths in the compatibility decision.

### I6 — P2: Define recovery when publishing authority transfer fails

**Proposal locations:** line 344 disables the old publisher before enabling the new one; lines 353–355 address source/package rollback but do not explicitly cover a handoff that fails before the first successful publication.

**Evidence:** [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/adding-a-publisher/) binds a publisher to a repository owner, repository, workflow filename, and optionally environment. [npm's documentation](https://docs.npmjs.com/trusted-publishers/) states that saved publisher configuration is not validated when saved and that publishing requires matching repository metadata.

**Why it matters:** A configured handoff can leave neither route able to publish. Simply restoring an old workflow can also race queued work or activate two authorities if part of the new route succeeded.

**Recommended revision:** Each cutover record should name its current authority, queued/in-flight release handling, verification evidence, and restoration procedure. Restoration must establish one active publisher and preserve immutable release history. Define the fallback before disabling the original route.

**Acceptance criterion:** A simulated authentication failure has an unambiguous recovery outcome; the old route can be restored where appropriate without competing publication or overwriting a released artifact. Actual registry mutation is future authorized migration work.

### I7 — P2: Decide whether independent versions also require independently releasable batches

**Proposal locations:** line 217 promises independent release plans; lines 229–243 establish independent versions and held dependents; line 353 allows holding one family's migration independently.

**Evidence:** The current [release workflow](../../../../.github/workflows/release.yml), lines 38–45, has one version command and one publish command. The [Changesets v1 action](https://github.com/changesets/action/blob/maintenance/v1/README.md) creates/updates a release PR containing pending package version/changelog changes. Independent semver families can still share an aggregate approval batch.

**Why it matters:** A single aggregate release PR is a valid choice, but it does not itself promise that a held family leaves unrelated approved releases unblocked. The draft uses independence in both senses without choosing the intended operational behavior.

**Recommended revision:** Explicitly accept aggregate release batches, or require a way to hold one family while releasing unrelated approved families and their prerequisites. Keep this a behavioral requirement; it does not require duplicated pipelines or a new release system.

**Acceptance criterion:** A release-plan example with one held family and one unrelated approved family has a documented, testable result. Any implementation must respect dependency ordering and the publication-admission rule from B1.

## PRAISE

- **Foundation independence is well defined.** Lines 16–44 cover runtime and transitive dependencies, peers, types, hooks, and configuration. Internal family dependencies and optional integrations are distinguished clearly.
- **Existing coupling is acknowledged honestly.** Specimen/Violet's current AFD dependencies are migration work, with compatibility transitions, rather than incorrectly presented as already independent.
- **Endpoint composition matches the intended use.** Botcore/Health can use AFD; the Health dashboard can use FAST-AF/Violet; Lushly remains an external product. Removing AFD from Health would work against this design.
- **One Alfred is a sound default.** Specialist commands can share a catalog while retaining domain ownership. The draft already identifies collisions, branding, target applicability, worktree context, and optional heavy dependencies.
- **Publishing reuse is appropriately qualified.** The draft identifies both namespace-wide version-coupling mechanisms and preserves language-specific versions. It separates source coordination, publication, installation verification, and endpoint deployment.
- **Phases have technical exit criteria.** Bootstrap, artifact independence, private Health extraction, and external consumer verification are meaningful gates. Existing full quality gates remain in place until replacements establish equivalent coverage.

## Phase 0 decisions already acknowledged; not additional blockers

| Item | Review assessment |
| --- | --- |
| Exact new package names and compatibility facades | Already reserved for inventory/transition planning. A proposal does not need final package manifests to establish the architecture. |
| FAST-AF publication identity | The inspected fork uses `@microsoft/fast-element`, and the maintained component package is private. Namespace authority and publishable scope must be resolved in Phase 0; the draft already requires that inventory. |
| Violet-named components inside FAST-AF | Naming alone does not establish a dependency on the Violet token engine. Classify by actual dependencies and behavior. |
| Violet browser runtime's remote loading | Distinguish optional service-client behavior from offline token/export behavior in the adoption inventory. It is not evidence of another foundation dependency. |
| Private Health extraction and Creator overlap | Explicit scope decisions already present; no private source/history import is implied. |
| Scheduler choice and numeric performance budgets | Baseline-dependent decisions are reasonably deferred. No build-speed improvement has been established by this review. |

## Recommended proposal revision order

1. Add publication admission before imports and release-protocol ownership for Alfred (B1–B2).
2. Define Alfred's quality verdict and effects/invocation contract (I1–I2).
3. Expand the consumer evidence matrix to distribution/entry-point coverage, negative integrations, and C++ source consumers (I3–I5).
4. Clarify authority-transfer recovery and release-batch behavior (I6–I7).

After those revisions, perform a focused rereview of the changed contracts. Keep the foundation/endpoint model, independent family adoption, shared publishing infrastructure, and main Alfred bot. No finding requires starting migration now.

## Evidence scope and reproducibility

The three independent passes received the proposal, user requirements, repository guidance, and read-only source access without the drafting conversation. Findings were consolidated and checked for duplication and false positives. In particular, unspecified registry permissions were not treated as a new blocker, and current coupling was not confused with a contradiction in the proposed target.

| Reviewed source | Revision / identity |
| --- | --- |
| AFD proposal checkout | `bc43019a4acd237e5ef3a2bf65f21564900143aa` |
| Botcore checkout | `40f829cc254ae243fde6cb3852afec1b84b74647` |
| Violet checkout | `46701c2f59931ec0e1393e5a1a3ae84166395917` |
| FAST-AF checkout | `e9abdf25516401221183821e81b0e02cd7e1c498` |
| Separate Specimen worktree | `ceaa5156ae0461c2b076168ea4949535f8fcf176`; inspected working files, not a claim that all observations are committed or published |
| Proposal SHA-256 | `e65a31ec2d206b58f90287a67a677bb38da6a3a8d1a048172a34d375fbcb35ef` |
| Decision SHA-256 | `c2b36e3bed47e4c4db05f801c05ac95d01dfb50f6c882d01d9e97b836c41f4fe` |

Primary references were checked on the review date. Changesets publication semantics were verified against the configured 2.31.1 line; the current guide is supplementary. No upgrade to newer CLI commands is assumed. Registry permissions, live publisher configuration, actual imported artifacts, CI behavior, and runtime effects remain unverified. No test suite or destructive changeset operation was executed. This review supplies architectural findings and future acceptance criteria, not implementation or publication receipts.

## Verdict

**REVISE REQUIRED.** Resolve B1 and B2 before approving the migration plan. Address I1–I7 in the proposal or record explicit decisions before their corresponding implementation phases. The overall architecture is supported; the review does not recommend returning to separate subproject bots or making foundations depend on one another.
