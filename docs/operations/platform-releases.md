# Platform release controls

The [platform migration](../features/active/platform-monorepo/) separates source admission from publishing. `scripts/release/inventory.json` records exact units, distribution identities, source paths, protocols, authority, routes, states, and required gates. The current nine AFD npm packages remain one coordinated unit. Registry scope alone does not make a package part of that unit.

## Importing source safely

An imported or split distribution starts quarantined. An unknown public manifest discovered in current or future roots is also quarantined. Declare its family, installation contract, export coverage, protocol, original publisher, and cutover requirements before release selection. A source move does not enable a publisher or grant registry rights. Preserve the old source authority until its recorded transfer.

Foundation dependencies must remain inside their family or third-party dependencies; separately installed integrations and endpoints compose families. Boundary checks inspect declared installation graphs and supported static source/configuration references. Clean artifact consumers remain required to establish actual runtime/type independence. A graph check alone is not complete consumer evidence.

## npm workflow

1. Add npm semver release intent using `pnpm changeset`. Botcore category fragments must never share npm fragment storage. Malformed/foreign formats fail before the approved wrapper runs.
2. `pnpm release:select` inspects complete eligible units and prerequisite evidence. A held family retains its fragments. Explicit multi-unit fragments must be selected as a whole or revised through review.
3. The main-branch workflow uses `pnpm version-packages` to run Changesets 2.31.1 in a disposable Git worktree with only selected workspace units and fragments. It validates the write set before copying selected manifests/changelogs and consumed-fragment deletions back. It updates parity documentation and `.release/npm-intent.json`.
4. Review the version PR and its committed intent. That record binds selected units, resulting versions/manifests, and package source content. A changed pending candidate holds publication. Missing intent never authorizes a version merely because it is absent from npm.
5. After the reviewed version PR merges and required gates pass, `intent-status` distinguishes missing, fulfilled, and pending intent. Fulfilled intent is an inert record, even if later development changed source. Pending intent must remain current.
6. `pnpm release:plan --plan <temporary-path>` packs only the approved selection and validates actual portable manifests, dependency ranges, identities, and hashes. This step performs no upload. Build first with the required gate.
7. Authorized automation calls `pnpm publish:npm --plan <temporary-path> --receipt <temporary-receipt>`. It revalidates the plan and each upload, publishes explicit tarballs in dependency order, and records outcomes. The receipt finalizer compares npm integrity with each approved archive, verifies candidate tags, then pushes explicit tags and creates GitHub Releases.

The npm workflow checks pending version intent independently from held fragments. Before any upload it creates a durable GitHub commit-status claim for the exact intent digest. A pending or failed claim holds later runs, including runs where every version reached npm but tag/release finalization did not finish. Success is recorded only after artifact integrity and finalization verification. Restoring identical intent bytes must preserve their existing claim. Runner receipts, plans and tarballs are retained as additional evidence; they are not the durable claim store.

Changesets' own version/publish branch decision is not a publication-admission mechanism. Never use raw `changeset publish` on the complete workspace. Direct arbitrary shell execution remains trusted operator execution; these tools do not claim to sandbox an operator.

## Native routes

Existing Python and Rust tag routes remain distinct. Each checks exact admitted unit/route, triggering tag and checked-out source, manifest identity/version, and packaged metadata before authentication/upload. Python validates its complete wheel/sdist set and hashes; Rust validates its packaged Cargo identity and VCS/source data, then rechecks before `cargo publish`. Cargo repackages source during upload, so the local archive receipt is trace evidence rather than proof of the registry's exact bytes.

C++ remains a source distribution. Immutable tags, `packages/cpp`, `afd::afd`, FetchContent, installed find_package, and vendoring contracts remain intact. Any relocation needs the migration's explicit compatibility decision and external consumer evidence.

## Holds and recovery

A failed or uncertain publication requires receipt and registry reconciliation before retry. Never overwrite versions, infer absence from a stale cached response, automatically fall back to a second publisher, or label a partial family as fully released. Tag/release finalization failures also hold their receipts; repair the missing step only after matching registry bytes and source identity.

An accepted npm upload can precede registry metadata visibility. Upload and finalization readback use fresh full metadata with bounded retries for an absent version. A mismatch or network failure holds the release; uploads are never retried automatically.

For a held upload whose acceptance can be verified, review and commit `.release/npm-recovery.json` with the original run/attempt, source revision, plan binding, intent digest and exact failed status ID. After that change passes review and CI, dispatch `release.yml` on `main` with the SHA-256 of those approval bytes as `recovery_approval`. The recovery job runs the quality gate, downloads the retained original evidence, restores the sealed artifact paths, and checks the frozen source in a separate worktree. It verifies the uncertain upload before appending an owned recovery claim linked to the original failed status. Original failure history is preserved.

Recovery adopts verified existing versions even if a later registry listing regresses, uploads only the remaining artifacts once, and requires the complete planned package/tag/release set before success. The original plan is neither repacked nor resealed. Missing retention evidence, an absent uncertain upload, changed source/intent, conflicting tags/releases or unknown registry state require further reconciliation. A failed recovery remains held; the previous approval cannot acquire or replace an active/successful claim.

Before any publisher transfer, record old/new authority, queued/in-flight release handling, frozen candidate/artifact identity, registry settings, and restoration steps. Simulated authentication failure tests the decision process only. Actual credentials, first upload, registry readback, and isolated installations remain separate Phase 5 evidence.

## Scoped development

Use existing language-native commands and pnpm filters for the selected area. For example, `pnpm -F @lushly-dev/afd-core test` works without browser/native environments; `uv` commands in `python/` or `alfred/` use their own locked environments. Full `pnpm check` and path-specific native/conformance workflows remain mandatory where applicable. Shared skills remain authored in the current canonical source until Botcore source/asset ownership is reconciled in Phase 2.
