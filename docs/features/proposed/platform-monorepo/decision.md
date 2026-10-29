# Proposed decision: foundations and endpoints in AFD

| Field | Value |
| --- | --- |
| Status | Proposed; not accepted or implemented |
| Date | 2026-10-28 |
| Decision owner | Jason |
| Proposal | [AFD platform monorepo](./proposal.md) |
| Review history | [Initial review](./review.md); [focused rereview](./rereview.md) |

## Context

AFD, Specimen, Violet, FAST-AF, Botcore, Health, and developer applications share development concerns and require coordinated changes. Separate repositories duplicate agent setup, dependency updates, validation infrastructure, and release maintenance. AFD already supplies configured package publishing and quality workflows that can serve multiple release families.

Consolidation must preserve independent adoption. A user can build an AFD app without Violet or FAST-AF, observe components with Specimen without AFD, or export Violet tokens to another component system. Developer tools are different: Botcore and Health can use AFD internally, and a Health dashboard can use FAST-AF, without imposing those choices on the supported application.

## Options considered

| Option | Benefit | Cost |
| --- | --- | --- |
| Keep repositories separate and improve automation | Lowest source-migration cost; current release ownership stays intact | Cross-repository compatibility changes and duplicated setup remain |
| Combine all projects and versions | One checkout and one coordinated version | Couples unrelated consumers, dependencies, releases, and validation |
| Share a repository with foundations, optional integrations, and endpoints | Coordinated development and publishing while retaining independent adoption | Requires enforced boundaries, release groups, consumer tests, and staged cutover |

## Proposed decision

Adopt the third option, subject to review of the proposal:

1. AFD becomes the shared repository for admitted platform capabilities. Lushly remains a separate product repository.
2. Foundations are independently adoptable library families. Required dependencies within a family are allowed; required dependencies on other foundation families or endpoints are prohibited.
3. Optional integrations connect foundations through public APIs and compatible version ranges.
4. Endpoints are runnable applications and tools. They may compose multiple foundations and reusable endpoint tooling, including AFD-powered Botcore/Health and a FAST-AF Health dashboard.
5. AFD's publishing infrastructure is reused and extended. Package families retain appropriate independent versions and independently selectable release batches; endpoint deployments remain separate from package publishing. Existing AFD fixed-group membership remains coordinated. Required new dependencies and deliberately shared release intent may couple a batch; an unrelated held family does not.
6. Required quality gates remain in force until replacements demonstrate equivalent coverage. Every admitted public distribution and supported entry point maps to clean external installation/import/type/dependency checks, alongside representative behavior fixtures and negative integration cases. C++ source tags, paths, CMake identity, and vendoring receive equivalent distribution acceptance.
7. Migration requires separate implementation authorization and proceeds through phases with explicit exit criteria. This record authorizes documentation only.
8. Alfred is the main monorepo bot, powered by Botcore, with common and area-specific commands in one catalog. Plugins organize reusable/specialized implementations; individual subprojects do not require their own bots. Invocation scope, host identity, and worktree context remain explicit.
9. Before source imports, publication admission must exclude quarantined candidates from every route while preserving existing AFD releases. A release plan selects only approved admitted units and approved prerequisites. Publisher transfer requires one authority, reconciled queued/in-flight work, and a recorded hold/restoration procedure; saved credentials are not publication evidence.
10. Alfred release commands resolve protocol and unit ownership. npm Changesets fragments must never be consumed as Botcore category fragments. Incompatible formats and incomplete coordinated selections fail before mutation.
11. Alfred preserves quality verdicts separately from execution success across CLI, MCP, workers, and aggregation. Commands declare effects/capabilities and share dispatch policy. Mutations are explicitly selected within authorization; any retained arbitrary Python execution is trusted-local and unavailable in restricted profiles, not a sandbox.

## Consequences

Related changes can be developed and reviewed together, shared agent knowledge has a canonical home, and publishing infrastructure is maintained once. Native library APIs remain usable outside the platform's preferred application stack.

The repository acquires shared lockfile and tooling coordination costs. Specimen and Violet need explicit boundaries between native APIs and AFD command surfaces. Before imports, namespace-wide version assumptions need replacement and release eligibility, batch selection, and fragment ownership need enforcement. Unified Alfred needs command-collision handling, target routing, consistent verdicts, and effects policy while retaining domain-specific checks. Private Health operations and upstream FAST-AF provenance require deliberate handling.

Repository consolidation does not make multi-registry releases atomic, eliminate external consumer upgrades, or prove that selective CI is complete. The proposal's artifact verification, phase exits, and rollback rules remain required.

## Acceptance status

No migration decision has been accepted. Exact package identities, import scope, performance budgets, and cutover details remain Phase 0 work. Approval of this architecture must not be treated as automatic approval to publish packages, deploy endpoints, or archive repositories.
