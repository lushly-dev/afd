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

- **State:** approved 2026-11-01; steps 0 and 1 are done, and step 1's `spec/` files are what Loam's
  phase 1 specification cites.
  - The owner took every recommendation in
    [For the owner](plugin-manifest.proposal.md#for-the-owner) and confirmed the `spec/` addition;
    the coordinator approved it for Loam's phase 1 after two independent reviews. Loam's decision
    log records this as D54 to D58.
  - It was extended at the owner's request of 2026-11-01: Umbel instances join a Loam instance as
    headless mounted apps.
  - Four questions remain for Umbel's owner (U1 to U4) and ten for Loam's phase 1 specification
    (L1 to L10), which it answers; see [Resolutions](#resolutions-of-l1-to-l10) and
    [Open questions](plugin-manifest.proposal.md#open-questions).
  - No host reads the core yet, and steps 2 to 8 are not started.
- **Last verified:** 2026-11-01 against `main` at `d74f1299`, with the results under
  [Step 1 verification](#step-1-verification). The proposal's state was read earlier, at `355aa994`,
  from:
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
- **Done:** step 1, in [#677](https://github.com/lushly-dev/afd/pull/677):
  [`spec/plugin-manifest.md`](../../../../spec/plugin-manifest.md),
  [`spec/plugin-manifest.core.v1.json`](../../../../spec/plugin-manifest.core.v1.json),
  [`spec/plugin-manifest.json`](../../../../spec/plugin-manifest.json) (234 cases, 77 rule cases, 6 mutation and 11 renaming cases),
  `spec/CHANGELOG.md`, the Python and C++ row in `docs/language-parity.md`, and
  `scripts/plugin-manifest.test.mjs` in the tooling tests. `spec/VERSION` stays `1.0-rc`: the core has
  its own version, and no fixture, vector, wire field or error code changes, as earlier `spec/`
  additions did. No changeset: no publishable package changes.
- **Not done:** steps 2 to 8 ([Implementation plan](plugin-manifest.proposal.md#implementation-plan)).
  No host or package reads the core, and the Rust check of the cases is not a permanent test. The
  owner's questions are decided; U1 to U4 are not answered, and L1 to L10 are answered by Loam's phase 1
  specification ([Resolutions](#resolutions-of-l1-to-l10)).

## Steps

| Step | State | Owner | Evidence |
| --- | --- | --- | --- |
| 0. Proposal | Done 2026-11-01 | Design sub-agent | [#669](https://github.com/lushly-dev/afd/pull/669) |
| 1. `spec/` core, cases, changelog, parity row | Done 2026-11-01 | Implementation sub-agent | [#677](https://github.com/lushly-dev/afd/pull/677); [Step 1 verification](#step-1-verification) |
| 2. Loam's profile, reader, `app check`, drift test against Umbel's examples | Specified 2026-11-01, not started | Loam's phase 1 agent | [Phase 1 specification](../../../../endpoints/loam/docs/phases/1-app-contract/spec.md) |
| 3. Umbel adopts the core (optional) | Not started | Umbel's owning agent, at its choice | None |
| 4. `expose.apps`, core version 2 | Not started | D30's AFD proposal | None |
| 5. `grants[].targets` | Not started | The first grant that needs it | None |
| 6. Plugin Discovery revised | Not started | None | None |
| 7. CORS in the `afd` crate's HTTP service (only if U1 is yes) | Not started | None | None |
| 8. The first-party `umbel` app in Loam | Not started | Loam, after Umbel's phase 2 and Loam's phase 5 | None |

## Step 1 verification

Run on 2026-11-01. The proposal marked these as unverified.

**1. The core and the cases compile and validate.** `node --test scripts/plugin-manifest.test.mjs`, in
`pnpm test:tooling`, with Ajv 8.20's 2020-12 build under `strict: true`, both with and without
`allErrors`: the core is `$defs` only with no closed object, every fixture schema compiles, and every
case gets its answer. With `allErrors`, the keys Ajv names equal each refusal's pointer exactly. The
test also runs a standalone validator of the reference profile against the profile's cases, and a
reference check of the rules, whose key rule agrees with `spec/mcp-resources.json`'s cases.

**2. `unevaluatedProperties` does not behave identically in Ajv and Rust in general. It does for a
profile that follows the contract.** A throwaway crate outside the repository, `jsonschema = { version
= "=0.60.2", default-features = false }` and `serde_json`, built with the shared `CARGO_TARGET_DIR` and
then removed, ran `spec/plugin-manifest.json` through `iter_errors` with a retriever for the core. It
was not committed, because Umbel must not change in this step; a permanent version is step 3.

- **The cases.** Compared with Ajv over 341 instances: all 234 cases, all 77 rule manifests, 16 edge
  instances (Unicode whitespace in `\S`, a trailing newline against `$`, code-point lengths, `1.0` as an
  integer, `null`, a non-object) and Umbel's 14 example and TOML manifests. **All 341 agree, on the
  answer and on the set of keys named,** including the reference profile at every depth and the cousin
  cases: both refuse `plugin.id`, `title`, `version`, `description` and `domains` under a `plugin` closed
  with no `$ref` of its own, and both answer the test suite's own cousin case the same.
- **The difference.** The first comparison also agreed everywhere, and it was wrong to conclude from
  it: no case reached this path. The independent review found that a `then` beside the `$ref` makes Ajv
  refuse a valid manifest. A matrix of 14 schema shapes over 7 instances, in Ajv with and without
  `strict` and `allErrors`, and in Rust, shows Ajv refusing what Rust accepts, and what 2020-12 says, for
  `if` with `then` or `else` (or both) beside a `$ref`, beside an `allOf` holding the `$ref`, or at the end
  of a `$ref` chain, and for `dependentSchemas` beside a `$ref`. These shapes agree: a conditional inside
  `allOf` beside the `$ref`, `allOf`, `anyOf`, `oneOf`, `not` or `properties` beside the `$ref`, and a
  conditional with no `$ref`. So the reference profile holds its conditional in `allOf`, the contract
  (P1) forbids the other shape, and the page's Validators section gives the reproduction.

**3. Umbel conforms to core version 1.** The same test validates against the core's `manifest`
definition Umbel's 7 `plugin-manifest*` examples, its 7 TOML manifests (`plugins/*`,
`plugins/hello/manifests/*`, the `todo-http` fixture) and its 4 scaffolds, read with `smol-toml`.
Beyond examples, for each of its schema versions it checks four things: only the keys its profile owns
are added; every object is closed; every core refusal in the cases is refused, naming the same key or
the key above it; and, key by key, no value the core refuses is admitted, with the one exception below.
A test shows the comparison notices a widened copy.

**What turned out false, corrected in the proposal:**

- **"`unevaluatedProperties` behaves the same in both validators"**, above: false in general, true
  under the amended contract.
- **Loam's sketch failed under Ajv's `strict: true`**, the Health dashboard's mode, with "missing type
  object" and, once that was fixed, `strictRequired` on `domains`. As first written it compiled without
  strict mode, and in Rust. The sketch now carries `type` and `"domains": true`, and compiles and accepts
  the two Loam-profile worked examples, in strict Ajv and in Rust.
- **The core sketch does not compile by itself:** it is abbreviated, and its references to the
  definitions not shown do not resolve. The proposal now says so and points to the file.
- **"It conforms as written" needs the reader for one key:** Umbel's schema alone admits
  `mount.prefix = "afd"`, which the core refuses. Its reader refuses it through two rules. No change to
  Umbel is needed, and the spec records it.
- **The rules list left out many of Umbel's rules**, now in the spec with cases; the proposal lists them.
  The proposal also gave the kind `mounted` no rule, and left `afd_contract`'s comparison untested.
- **C12 gave the wrong default prefix.** It said the app id is the first instance's default prefix. The
  Instances table and Umbel say `mount.prefix`, which differ when `plugin.id` is not the domain.
- **`HTTP_<status>`** in `spec/error-codes.md` does not match the `errors` pattern literally. It is a
  family, whose members do. Every other code fits.
- **The drift check moved:** the proposal left a check of Umbel's examples to step 3. The coordinator
  asked for it now, and it runs from `scripts/`, with no change to Umbel.

One addition the proposal did not sketch: the core sets reserved keys, `apps`, `mutation`, `url` and
`bearer_env` to `false`, so a profile's `$ref` refuses them whatever the profile says. The core is
consistent with Loam's D54 to D58: it says nothing of trust (D54, D55), leaves `mount.command` to a
profile and refuses `url` and `bearer_env` (D56), has the kind `mounted` and headless manifests (D57),
and keeps `signature` reserved and `on_conflict` refused (D58).

**Also measured, and a wrong guess dropped:** one bad value is reported more than once in both
validators, because a closing profile reaches the core by two paths, and Ajv alone repeats a failed
`then` or `else` as `if`. Before measuring, this session expected a failed `$ref` to make
`unevaluatedProperties` report every key it covers. It does not in either validator, so the spec tells a
reader to report each key once and to filter nothing else.

## Independent review

**Step 1 review, 2026-11-01.** A fresh general-purpose subagent was given the core, the cases, the
spec page, the test and the proposal, not this session's conclusions, and ran its own profile and
mutants against them in Node. It reported 5 must-fix, 13 should-fix and 7 nit findings. All were fixed
except where noted:

- **Must-fix.**
  - (1) A `then` beside `$ref` makes Ajv refuse a valid manifest, and no case reached it. Reproduced in
    Ajv and in Rust ([Step 1 verification](#step-1-verification)). The profile's conditional moved to
    `allOf`, P1 forbids the shape, and accepted cases now carry every core key through the profile.
  - (2) A `$ref` admits every core key a profile does not mention, and `ui` stayed open. P2 says so, P1
    lists `ui`, and the reference profile closes it, with cases.
  - (3) The renaming rule could not be implemented from the page. The algorithm is on the page, with
    `renaming` cases.
  - (4) Rules Umbel's reader enforces were missing: added with cases.
  - (5) C12 contradicted the Instances table on the default prefix: corrected in the page and the
    proposal.
- **Should-fix.** (6) A refused effect stayed open on pipelines and mount tools: P2 names all three
  places, with cases. (7) `mutation`'s derivation is stated, with cases. (8) `max_bytes` has output
  budgets' limit. (9) `afd_contract`'s comparison is a rule, with cases. (10) A schema that is not a
  schema is refused, with cases. (11) The reference path check now covers every path key, dangling links
  and `..x`. (12) The test now requires a case for each required and refused core key, pins enums and
  defaults, requires a closing entry for each core object, and tests each `$ref` link deep. (13) The
  Umbel comparison gained a closed-objects check and a differential check of every core refusal, over
  every schema version. (14) The contract has a stated exception for a profile that does not reference
  the core. (15) The kind `mounted` and `mount` are a rule. (16) The accepted `tool_meta` case no longer
  shows a host's own key, and a host must refuse or overwrite such a key. (17) The validator claim is
  dated and scoped. (18) The test reads only the code tables and names its one test fixture, and the
  known exception is no longer pinned exactly.
- **Nits.** All fixed but one: the core still accepts `C:/x/in.json`, as Umbel's schema does, since
  refusing it would make Umbel's schema admit a value the core refuses. The rule `path-inside-root`
  covers it on Windows.
- **Not re-measured:** the reviewer's mutation counts (50 of 305 core mutants and 171 of 367 Umbel
  mutants surviving) describe the test before these fixes. It was not re-run after them.
- **Evidence limit:** the reviewer ran no Rust, as briefed. Its claims about Umbel's reader were read
  from the code, and this session checked each against the code before changing anything.

**First review, 2026-11-01.** A fresh general-purpose subagent was given the proposal and pointed at
the primary sources, not this session's conclusions. It was asked whether the proposal serves both
Loam's phase 1 and Umbel, whether any field contradicts a recorded decision, and whether any claim
about the code is wrong.

It spot-checked about 40 citations and found nearly all accurate. It reported 3 must-fix,
15 should-fix and 7 nit findings. The main claims were checked against the source and held up; the
rest were taken from the reviewer's evidence. All were fixed in the revision:

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

## Resolutions of L1 to L10

Decided 2026-11-01 by [Loam's phase 1 specification](../../../../endpoints/loam/docs/phases/1-app-contract/spec.md),
which proposes them as Loam D59 to D66. They stand when that specification is approved. It carries out
step 2 of the plan in its steps 1, 2 and 7.

| Question | Resolution | Loam decision |
| --- | --- | --- |
| L1 | `loam-app.toml` for authors; a packed `app-manifest.json` at runtime, which the kernel alone reads | D59 |
| L2 | `native`, `view`, `mounted` | D59 |
| L3 | AFD's defaults for app commands; the instance entry for mounted ones | D65 |
| L4 | `error`, against the shell and across apps and instances | D66 |
| L5 | A module beside the view, in a hidden sandboxed handler frame (`view.handlers`) | D61 |
| L6 | The deployer's `loam.deployment.toml`, one `[apps.<instance>]` per instance, with a browser projection holding no location, credential or command line. Discovery runs at boot, on `app-instance-refresh`, and once after a `COMMAND_NOT_FOUND` | D63 |
| L7 | Always the same-origin route `mounts/<instance>/mcp`; the static CSP gains no instance origin. Phase 1 proves it through a test-only relay until the hosted lane serves it | D64 |
| L8 | Warn | D66 |
| L9 | Pinned | D65 |
| L10 | Display and defaults; an unreported command is a mutation, hidden until the entry names it; the entry overrides | D65 |

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
| 2026-11-01 | Implementation sub-agent | Step 1: wrote the spec page, the core and the cases, and wired `scripts/plugin-manifest.test.mjs` into the tooling tests. Proved the three unverified claims ([Step 1 verification](#step-1-verification)), corrected the proposal where they were false, and updated the parity row, the changelog and Loam's status |
