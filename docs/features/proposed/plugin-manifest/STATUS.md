# Shared plugin manifest: status

Read this before the [proposal](plugin-manifest.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** proposed 2026-11-01, step 0. The proposal and this file are written and are in review
  in the pull request that adds them.
  - The proposal was revised after an independent review.
  - It was extended at the owner's request of 2026-11-01: Umbel instances join a Loam instance as
    headless mounted apps.
  - Six questions are the owner's, including who approves (question 4). Four are for Umbel's owner
    (U1 to U4) and ten for Loam's phase 1 specification (L1 to L10); see
    [Open questions](plugin-manifest.proposal.md#open-questions).
  - Nothing is implemented, and steps 1 to 8 are not started.
- **Last verified:** 2026-11-01 against `main` at `355aa994`. The current state was read from:
  - Umbel: `endpoints/umbel/schemas/plugin-manifest.v2.json` and the examples in
    `schemas/examples/`; `src/plugins/manifest.rs`, `mod.rs` and `compiled.rs`;
    `plugins/hello/manifests/compiled.toml` and `plugins/todo/umbel-plugin.toml`;
    `docs/decisions.md` (D3, D36 to D47, D54, O3); `docs/architecture.md`; and sections 2, 3, 7
    and 8 of `docs/phases/1-plugin-contract/spec.md`.
  - Loam: `endpoints/loam/docs/decisions.md` (D2, D4, D9 to D11, D18, D21, D23, D30, D44, D47 to
    D49), `architecture.md` (sections 2, 4, 5, 8 and 9) and `proposal.md`.
  - Plugin Discovery's proposal and spec.
  - AFD: `spec/command-metadata.md`, `spec/mcp-resources.md`, `packages/core/src/commands.ts` and
    `mcp.ts`, `packages/server/src/schema.ts`, `meta-keys.ts` and `server-types.ts`, and
    `packages/rust/src/commands.rs` and `server.rs` (`HttpOptions`).
  - For the headless-app extension: `endpoints/umbel/src/surfaces/http.rs`,
    `src/plugins/mounted/naming.rs` and `src/cli/parse.rs`; `spec/tool-strategies.md` H8;
    `endpoints/loam/packages/web/index.html` (its CSP) and `src/zod-jitless.ts`;
    `endpoints/health-dashboard/tooling/report-validator.ts`; `.github/workflows/loam.yml`;
    `scripts/affected/scope.mjs`; `spec/vectors/README.md`.
  - Botcore: `endpoints/botcore/src/botcore/host.py`.

  The line ranges are cited in the proposal. The checks run are listed in the session log.
- **Done:** step 0, the proposal. It covers:
  - the core and profile shape, with a closing contract that applies at every depth;
  - the core's keys, the shared grant names, and app identity versus instance identity;
  - JSON Schema sketches of the core and of Loam's profile, and where each of Loam's manifest
    contents goes;
  - worked examples: Umbel's hello plugin (real), a Loam hello app, the Umbel host's headless
    manifest, and one Loam instance with two Umbel instances;
  - the connection per Loam host, and how Umbel's tools, resources and skills surface in Loam;
  - the collisions C1 to C12;
  - the mappings onto AFD, Umbel's manifest and Plugin Discovery;
  - versioning, validation and language parity (standalone validators under Loam's CSP), and trust;
  - alternatives, open questions and the plan.

  The feature index row is added, Loam's status records the proposal, and Umbel's follow-ups have
  a pointer to it.
- **Not done:** steps 1 to 8 ([Implementation plan](plugin-manifest.proposal.md#implementation-plan)).
  No `spec/` file, schema, case, reader or test exists. None of the open questions is answered.

## Steps

| Step | State | Owner | Evidence |
| --- | --- | --- | --- |
| 0. Proposal | Written 2026-11-01, in review | Design sub-agent | This pull request |
| 1. `spec/` core, vectors, changelog, parity row | Not started | None (Loam's phase 1 agent, or an AFD session before it) | None |
| 2. Loam's profile, reader, `app check`, drift test against Umbel's examples | Not started | Loam's phase 1 agent | None |
| 3. Umbel adopts the core (optional) | Not started | Umbel's owning agent, at its choice | None |
| 4. `expose.apps`, core version 2 | Not started | D30's AFD proposal | None |
| 5. `grants[].targets` | Not started | The first grant that needs it | None |
| 6. Plugin Discovery revised | Not started | None | None |
| 7. CORS in the `afd` crate's HTTP service (only if U1 is yes) | Not started | None | None |
| 8. The first-party `umbel` app in Loam | Not started | Loam, after Umbel's phase 2 and Loam's phase 5 | None |

## Independent review

**First review, 2026-11-01.** A fresh general-purpose subagent was given the proposal and pointed at
the primary sources, not this session's conclusions. It was asked whether the proposal serves both
Loam's phase 1 and Umbel, whether any field contradicts a recorded decision, and whether any claim
about the code is wrong.

It spot-checked about 40 citations and found nearly all accurate. It reported 3 must-fix,
15 should-fix and 7 nit findings. Every one was checked against the source and held up. All were
fixed in the revision:

- **Must-fix.**
  - (1) Loam's sketch closed `plugin` without its own `$ref`, which refuses every valid manifest:
    `unevaluatedProperties` cannot see a cousin path. Fixed in the sketch and stated in the profile
    contract.
  - (2) Nested objects stayed open. The profile contract now requires closing every admitted object
    at every depth, with a refusal case for each.
  - (3) "No Umbel decision changes" overstated it: the proposal replaces the mechanism that Umbel
    D37's note and the phase 1 specification's "Room for Loam" describe, and it adds non-UI keys to
    what Loam's architecture calls Umbel's. Reworded to "no Umbel schema, file or code changes". The
    annotation is left to Umbel, and approval authority is owner question 4.
- **Should-fix.**
  - (4) The quote from Loam D10's correction was about event fields. It now cites Loam's
    architecture lines 393 to 395 and Umbel's phase 1 lines 508 and 509.
  - (5) Loam D10 shares the grant vocabulary, so a shared grant names table was added.
  - (6) Scope levels moved to Loam's non-UI `app` section.
  - (7) Every item of Loam's manifest now has a place.
  - (8) Collisions C9 to C12 were added, and each transport value has one meaning.
  - (9) Ajv under Loam's CSP: validators are standalone and the kernel reads JSON only.
  - (10) The dual-host path now lists every Umbel change it would need.
  - (11) The drift check binds Umbel, so it moved to step 3. CI path filters and `EXTRA_INPUTS`
    were added to step 2.
  - (12) The cases moved to `spec/plugin-manifest.json`.
  - (13) `mount` now has one definition.
  - (14) Where a view app's handlers run is question L5.
  - (15) Question 1 names the Loam lines it would amend.
  - (16) Approval authority (question 4) was added, and `targets` was softened to a reserved name.
  - (17) Step 1 now lands spec first, and the Loam status wording was corrected.
  - (18) The compiled-plugin claim was narrowed.
- **Nits.** (19) to (25): the definition names, the undefined `native` and `view`, the protocol
  comment, unit prefixes on decision numbers, defaults for `required` and `approval`, suggestions in
  refusals, and wording.

The headless-app section was added after this review, at the owner's request.

**Second review, 2026-11-01.** A fresh general-purpose subagent reviewed the headless-app section,
its worked example and the document's consistency against the primary sources. It reported 3
must-fix, 12 should-fix and 8 nit findings. The main claims were checked against the source and held
up. All were fixed:

- **Must-fix.**
  - (1) CORS is not only an AFD change: Umbel's bearer layer refuses a preflight, so U1 touches
    Umbel D32. U1, step 7 and the Packages row now say so.
  - (2) The `work` entry could not serve both a hosted and a desktop Loam. "Loam instance" is now
    defined, and the example is one desktop Loam with both hosts on one laptop, followed by what
    changes on a hosted Loam.
  - (3) A stdio instance is not "external": Umbel's owner decision 2 says a stdio mount is as trusted
    as compiled. The trust table now has a child-process row, and owner question 6 asks about Loam's
    stdio trust class and who may write `command`.
- **Should-fix.**
  - (4) The principal is now stated per transport, and question 5 covers stdio.
  - (5) The space mapping could look like scoping when it was only a default, so pinning is
    recommended (L9).
  - (6) Loam reads AFD's `mutation`, `destructive` and `approval` first, and trust in them is L10.
  - (7) `<instance>/<name>` is Loam's rule across servers. Within a host, Umbel's "once per plugin"
    rule stands.
  - (8) The conflict policy is consistent: `error` across instances, recommended for an app's own
    commands (L4).
  - (9) The per-instance transport override is a stated rule, for Loam.
  - (10) Instance prefixes extend Loam D18, and (11) the instance entry as the callee's declaration
    extends Loam D30. Loam's phase 1 annotates both, and L6 has per-command exposure.
  - (12) The worked example's steps agree, (13) its journal names `instance` and `app`, and (14) L7
    reflects the static CSP.
  - (15) The resource-link form is pointed to Loam's phase 5.
- **Nits.** (16) to (23): the citations for the Origin check and the agent surface, the renaming
  rule's steps, how the loader reaches `afd-help`, the hypothetical skill name, absolute paths in
  argv, the deliberate difference from Umbel D50's stdio default, and the plan's last line.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Proposal | Umbel's D37 and its phase 1 specification ("Room for Loam") say Loam's schema can reference Umbel's `$defs`. The proposal shows why that does not work for `plugin`, `domain`, `command` and `expose`, and replaces it with the core. Umbel's documents may want a pointer to the proposal; its decisions need no change | Open; pointer added to Umbel's follow-ups |
| 2026-11-01 | Proposal | Owner questions 1 to 6: native Loam apps' trust class, Umbel carrying and projecting `ui`, signing before W9, approval authority for a `spec/` addition, a multi-member Loam over a single-principal Umbel, and Loam's stdio instances | Open, the owner's |
| 2026-11-01 | Proposal | Umbel owner questions U1 to U4: CORS, reach beyond loopback, a host description or server card, and scope with space | Open, Umbel's owner |
| 2026-11-01 | Proposal | Before Loam's phase 6, check how browsers restrict a public-origin page calling a loopback address, in Loam's trajectory refresh | Open |
| 2026-11-01 | Proposal | A shared origin key on tools (`dev.afd/origin` beside `dev.umbel/origin`) once a second host emits one | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-01 | Design sub-agent | Read the sources listed above. Wrote the proposal and this file. Added the feature index row. Updated Loam's status: the follow-up, the prerequisites row, the phase 1 gate and the session log. Added a pointer in Umbel's follow-ups. Ran the first independent review and fixed every finding. Added the owner's headless-app requirement: Umbel instances in Loam. Ran a second independent review of that section and fixed every finding. Checked with `node --test scripts/repository-contract.test.mjs` and the pre-push hook |
