# Specimens proposal review

Original review: 2026-10-28. **Original verdict: REVISE REQUIRED.** The findings below describe the proposal before the revision requested later that day. The command-based component bench is a credible direction, but its original observation and migration contracts did not support the claimed decisions and preservation guarantees.

The [proposal](specimens.proposal.md) was moved from Violet at Jason's request and subsequently revised to incorporate the responses below. The original findings and probe results are preserved as historical evidence. **Current disposition: design responses recorded; native feasibility implementation is tracked in the [implementation plan](../../active/specimens/implementation.md).** Full compatibility, impact and cutover acceptance remain open. This proposal review is not approval to remove Storybook.

## Revision responses — 2026-10-28

| Finding | Proposal response | Evidence still required |
| --- | --- | --- |
| B1: visual changes absent from output | [Observation envelope](specimens.proposal.md#observation-envelope) adds layout, selected computed styles, live state and completeness; [honesty check](specimens.proposal.md#the-honesty-check) moves to workstream 0 | Seeded CSS/state/accessibility regressions detected; unavailable visual evidence handled explicitly |
| B2: removal before replacement gates | [Replacement checks](specimens.proposal.md#replacement-checks-and-retirement) and [sequencing](specimens.proposal.md#sequencing-and-acceptance) put list/inspect/coverage and Fastbot retirement proof before cutover | Operational replacements, rule-by-rule failure fixtures and consumer full gates |
| B3: undefined dual-runner semantics | [CSF compatibility contract](specimens.proposal.md#csf-compatibility-contract) preserves original metadata, global setup, identities, policies and precedence; cleanup is deferred | Representative failure detection and three qualifying full parity runs |
| B4: container used as viewport | [Context and lifecycle](specimens.proposal.md#context-and-lifecycle) separates browsing-context dimensions, container size, media emulation and motion suppression | Media queries, viewport units and innerWidth agree across drivers |
| B5: incomplete token detector | [Consumption](specimens.proposal.md#consumption-and-dependencies) and [impact](specimens.proposal.md#impact-algorithm-and-result) cover accessible sheet types/scopes, conservative candidates and observed effects | Detector fixture matrix and Violet resolution/impact comparisons, including incomplete cases |
| I1: rationale/cost baseline | [Problem and existing capabilities](specimens.proposal.md#problem-and-existing-capabilities) acknowledges Storybook MCP and its actual Vitest path | Measured baseline with bound source/environment and declared tolerances |
| I2: dependency budget and eager imports | [Bench discovery](specimens.proposal.md#bench-and-discovery) uses metadata plus lazy cases; [budgets](specimens.proposal.md#static-build-and-budgets) count transitive/deferred bench chunks | Prototype satisfies proposed numeric ceilings and unrelated modules never execute |
| I3: readiness/isolation | [Context and lifecycle](specimens.proposal.md#context-and-lifecycle) defines ready, bounded checkpoints, disposal, baseline reset and profiler timing | Repeat/failure/timeout/cancellation cleanup fixtures across drivers |
| I4: coverage overclaims | [Coverage](specimens.proposal.md#coverage-and-generation) links target states and checkpoints to executed expectations; unknown is not covered | Runtime evidence and failure fixtures for required state/form obligations |
| I5: scenario adaptation | [Scenario execution](specimens.proposal.md#scenario-execution) names the host/browser adapter, explicit runner dispatch and cancellation boundaries | DOM/AFD/FAST-AF dispatch and timeout proof for each adopted capability |
| I6: destructive normalization | [Comparison](specimens.proposal.md#comparison-and-normalization) retains raw captures, ID relationships, whitespace and live state | Stable generated-id captures plus broken-reference/whitespace/state detection |
| I7: provenance | [Observation envelope](specimens.proposal.md#observation-envelope) and [comparison](specimens.proposal.md#comparison-and-normalization) bind captures to source, dependencies, browser, context and versions | Isolated git-ref comparison, mismatch rejection and correct cache identity |
| I8: events/completeness | [Format](specimens.proposal.md#specimen-format) declares event types/targets; lifecycle installs listeners before mount; channels expose partial/unsupported status | Scoped/non-composed event fixtures and evidence that unknown observations cannot become empty successful claims |

The response table records the documentation revision. Subsequent runtime progress and validation are recorded in the implementation plan; the original review evidence below remains historical.

## Evidence and limits

| Source | Inspected revision |
| --- | --- |
| Original Violet proposal and Violet implementation | `2b1f94321a1ef458c1364a91ad63f29b304266e4` |
| AFD checkout | `bc43019a4acd237e5ef3a2bf65f21564900143aa` |
| FAST-AF checkout | `e9abdf25516401221183821e81b0e02cd7e1c498` |
| Lushly checkout | `70d482217259e53c865d05518980c22bfcd876f5` |

This review inspected source, current primary documentation, and isolated browser probes. It did not implement Specimens, run the repository-wide suites, demonstrate migration parity, or measure the existing Storybook test suite's performance. Installed probe dependencies were Playwright 1.62.1 and Vitest 4.1.10; Chromium reported `151.0.7922.34`. Installed dependency versions can differ from package manifests; findings about executable behavior refer to these installed versions.

The proposal's inventory was independently reproduced: FAST-AF has 67 `violet-elements` story files, 143 `play:` declarations, and plays in all 67 files; Lushly has 116 story files, 614 `play:` declarations, and plays in 111 files. These are source counts, not executed-test counts.

## Blockers

### B1. The render contract misses real visual changes

**Proposal:** Summary, Principles, Render result shape, Serialization, and The honesty check.

DOM markup, accessibility structure, consumed custom-property values, and emitted events can all remain identical while a component changes visibly. Adopted stylesheets are especially relevant: FAST-AF supports them, and its button styles contain literal layout values as well as tokens. HTML serialization does not include the contents of an adopted stylesheet.

**Executed probe:** An open-shadow component contained a native button. Its adopted stylesheet changed `padding: 8px` to `padding: 40px`. The serialized DOM and Playwright ARIA snapshot were identical before and after; neither version used custom properties. The button nevertheless grew from approximately **50.39 × 35 px to 114.39 × 99 px**. Both observations would produce an empty diff under the stated contract. An agent cannot recover information the output omits.

This is consistent with the documented scope of [HTML serialization](https://developer.mozilla.org/en-US/docs/Web/API/Element/getHTML) and [ARIA snapshots](https://playwright.dev/docs/aria-snapshots). Neither promises a record of rendered appearance.

**Required revision:** Define which review questions the output can answer. Add the needed evidence, such as selected computed styles, geometry, overflow, live control state, and state checkpoints, or explicitly limit the command to structural comparison and retain a visual review path for the rest. Screenshots can remain optional for structural questions; their absence must not imply visual equivalence.

Run the observation experiment before committing to the replacement product. Include controlled CSS-only and interaction-state regressions with known answers. Three merged PRs alone are a weak oracle: their final versions may no longer contain the regression the reviewer caught. Identify the actual faulty and corrected revisions, or deliberately seed the faults. This is a technical validation gate, not a request to indefinitely defer the feature.

### B2. Storybook removal precedes required replacement gates

**Proposal:** How each job is covered; Sequencing workstreams 0–5; risk concerning overlapping contract checks.

Workstream 2 removes Storybook and requires green consumer checks. But the replacement Fastbot contract depends on `specimen-list` and `specimen-inspect`, scheduled for workstream 3, and `specimen-coverage`, scheduled for workstream 5. Meanwhile, the early codemod removes `autodocs` and relocates descriptions that the existing checker examines.

The [current Fastbot checker](https://github.com/lushly-dev/fast-af/blob/e9abdf25516401221183821e81b0e02cd7e1c498/plugins/fastbot-fast-af/src/fastbot_fast_af/commands.py#L780) checks the preview's accessibility policy, requires `autodocs`, checks plays and baseline/state exports, and requires FormData and validity assertions. The proposal's promise that both contract systems overlap for one release has no executable placement in the workstream order.

**Required revision:** Put a dependency gate on removal: every existing required check must either have an operational replacement or continue unchanged. Move the minimal index/inspection/coverage capability earlier, or describe a temporary checker that preserves the existing obligations until the later commands land. Explicitly name which metadata survives the overlap period and when each old rule can retire. A change that removes a gate is not equivalent to a passing replacement.

### B3. The dual-runner migration lacks a shared semantic contract

**Proposal:** Goals, Field semantics, Mapping from CSF, How each job is covered, and Parity before removal.

The proposal changes fields to `context` and `a11y` while promising that both runners execute the same files with equivalent behavior. Storybook does not automatically interpret those new fields. Conversely, merely retaining `title` does not preserve every test's identity or its environment.

Concrete existing dependencies include:

- [Lushly's global preview decorator](https://github.com/lushly-dev/lushly/blob/70d482217259e53c865d05518980c22bfcd876f5/.storybook/preview.ts#L126), which sets the theme global read by every story frame, applies canvas styles, and disables motion. Counting decorators only inside story files misses this project-level behavior.
- Explicit story display names such as `ByField` with `name: 'By field'`. The proposed field contract omits `name`. [Lushly's flake reader](https://github.com/lushly-dev/lushly/blob/70d482217259e53c865d05518980c22bfcd876f5/scripts/run-final-storybook.mjs#L43) builds identities from the reported file, ancestor titles, and test title.
- Storybook's installed Vitest integration composes project/meta/story annotations, applies the viewport, and calls the composed story's lifecycle. [The portable-stories documentation](https://storybook.js.org/docs/api/portable-stories/portable-stories-vitest) confirms that the annotations and lifecycle are part of the story.

Matching two all-green reports does not prove these behaviors match: both suites can pass while one omits a check or renders the wrong theme.

**Required revision:** Define a temporary translation layer or retain CSF metadata until the comparison ends. Name the supported precedence and identity rules, including global initialization, meta args, explicit story names, theme overrides, accessibility settings, skipped tests, and cleanup. Compare the exact discovered test set as well as outcomes. Add representative deliberately failing interaction and accessibility fixtures so the new runner must demonstrate that it detects failures, not just that the happy path passes.

The migration can still be mostly mechanical. Describe it as a codemod plus bounded manual exceptions; “one import line” is accurate only for the helper swap, not the full file migration already listed in the proposal.

### B4. A fixed-size container is not a viewport

**Proposal:** Context-provider plugin point; Runtime, bench-page step 3; `specimen-matrix`.

The core provider currently defines `viewport` as a fixed-size frame. If that means an ordinary container, it changes container layout without changing `window.innerWidth`, viewport units, or viewport media queries. The human index, CLI, and Vitest paths can consequently show different states for the same context.

**Executed probe:** With a 1,200 px browser viewport and a 375 px container, `matchMedia('(max-width:600px)')` remained false and a `50vw` button was 600 px wide. With a real 375 px viewport, the media query became true and the button was 187.5 px wide.

This matters to the existing consumers: [Lushly's app shell](https://github.com/lushly-dev/lushly/blob/70d482217259e53c865d05518980c22bfcd876f5/apps/web/src/components/shell/lushly-app-shell/lushly-app-shell.ts#L32) uses viewport breakpoints and `matchMedia`; other stories use `100dvh` and `100vw`. The installed Storybook addon explicitly calls the Vitest browser viewport API.

**Required revision:** Define viewport as the specimen's actual browsing-context dimensions. CLI/tests can resize the browser viewport; the catalog can use an appropriately sized iframe. Give ordinary container sizing its own field. Verify media queries, viewport units, and `matchMedia` through all three drivers. Also distinguish motion suppression for stable sampling from emulating `prefers-reduced-motion`; otherwise the declared context can disagree with browser-observed preferences.

### B5. Token detection is too narrow to support the impact claim

**Proposal:** Token consumption, Render result shape, `specimen-impact`, and workstream 4.

The proposal identifies token-name mapping as the largest unknown, but detecting consumption is a separate unresolved problem. Reading only each shadow root's `adoptedStyleSheets` omits ordinary shadow `<style>` sheets and document styles, both valid for the advertised compatibility tiers.

**Executed probe:** A custom element used `<style>button { color: var(--accent) }</style>` inside its open shadow root and inherited `--accent` from the document. The button computed to red. The root had **zero adopted sheets and one ordinary sheet**, so the stated scan would miss the dependency entirely.

Matching rules is also not the same as determining which declarations affect the current render. The contract must account for cascade winners, inactive media conditions, `:host`, slotted content, pseudo-elements, aliases/fallbacks, and interaction states. These are not hypothetical framework features: the current Violet button has `:host`, hover, active, and focus-visible token references. A map keyed only by token name also loses information when separate descendant scopes resolve that token differently.

Finally, a token that is referenced need not change visually, and a change can propagate through aliases. [Violet's existing `changes.impact`](https://github.com/lushly-dev/violet/blob/2b1f94321a1ef458c1364a91ad63f29b304266e4/packages/core/src/commands/changes/impact.ts#L54) already distinguishes changed, shielded, unaffected, and unresolved effects, including indirect reference effects. A direct membership filter must not discard those distinctions.

**Required revision:** Distinguish conservative dependency candidates from observed before/after render changes. Declare supported stylesheet and state coverage, include scoped observations, and return incomplete/unknown when observation is partial. Use Violet's resolved effects to select candidates, then validate render impact where the command claims an actual change. Prove the detector on ordinary stylesheets, adopted sheets, aliases, overrides, and an interaction-dependent token before approving workstream 4's current promise.

## Improvements

### I1. Update the replacement rationale and measure the relevant cost

The claims that the catalog is not agent-facing and that every test run pays for the manager/docs runtime need qualification. Storybook 10.6 documents MCP development and testing tools across frameworks, including previews and test execution. Its component-documentation toolset does not yet support the web-components renderer, and the AI features remain preview. That limitation preserves a meaningful opportunity for Specimens; it does not support the categorical claim that none of Storybook is agent-facing. See [Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview).

The [Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) already transforms stories to tests without needing a running Storybook instance. Static bundle caps therefore do not establish what a test actually downloads or executes. Keep the accurately labeled caps, but add observed cold/warm startup, suite time, memory, and loaded bytes before using performance as the basis for replacement. No current Storybook performance measurement was made in this review.

### I2. Define the runtime budget and load specimens independently

“One small module,” a registry importing every story, and a 50 kB budget need a common accounting boundary. A small plain-Vite probe importing and using only Vitest `expect` and `vi.fn` emitted **276,426 bytes of minified JavaScript**: a 258,768-byte entry chunk and a 17,658-byte additional chunk, before Testing Library, jest-dom, axe, or any component. The entry code did execute successfully in Chromium outside the Vitest runner. These are UTF-8 build-output sizes, not measured network transfer or a complete Specimens build. The issue is dependency weight, not a demonstrated inability to run standalone.

Specify whether the cap includes transitive bench code and test helpers; measure the shell, chosen specimen, and test-only assets separately without hiding bench dependencies in uncounted chunks. Separate a lightweight index from loading a specimen. An eager whole-catalog registry would also contaminate per-component loading metrics and execute unrelated story module side effects.

### I3. Make readiness and isolation part of the common runtime contract

The profiler's proposed ready selector is `#specimen-root`, which can exist before the custom element upgrades, asynchronous work settles, or fonts load. Rendering returns only an element, with no stated cleanup contract for framework roots, portals, listeners, or fixtures. Repeating `specimen-matrix` cells may then retain state that the Vitest path resets.

Define mount-ready, capture checkpoints, timeout behavior, and disposal across drivers. Returning the same DOM element type is not sufficient to make the drivers equivalent. Test a rerender and a second run after failure. Keep intentional asynchronous loading specimens possible; readiness must be explicit rather than a universal “network idle” guess.

### I4. Define what schema coverage proves for custom renders and plays

The proposal permits arbitrary render args, exempts those args from schema validation, and accepts imperative plays, but then promises coverage derived from schema states with at least one expectation. A schema cannot infer what arbitrary rendering code mounted or what an unrelated assertion proved.

This already applies to the [FAST-AF button story](https://github.com/lushly-dev/fast-af/blob/e9abdf25516401221183821e81b0e02cd7e1c498/packages/violet-elements/src/button/violet-button.stories.ts#L18): custom args construct slots and mutate properties. Several named exports have no play even though their file contains one. File-level play counts must not become per-specimen assertion coverage.

Use explicit coverage claims checked against observed state and successful expectations, or report unverifiable imperative coverage as unknown. Keep “state represented,” “assertion executed,” and “behavior verified” separate. Cover finite booleans/enums and declared partitions for open-ended values; avoid promising every possible value of a string or number. Give form participation and validity checks concrete representation before retiring the existing Fastbot checks.

### I5. Account for the scenario adapter as new work

The current [AFD `Step` contract](../../../../packages/testing/src/types/scenario.ts) requires a `command` and an expectation with `success`. It does not directly accept the proposal's `{ action }` or standalone `{ expect }` steps. The [in-process executor](../../../../packages/testing/src/runner/in-process-executor.ts) also owns fixture loading and execution context; it is not a drop-in browser-action runner.

Reusing it is reasonable through an explicit adapter, but name that adapter, its execution side, and responsibility for selectors, action completion, event history, timeouts, and cancellation. Resolve dispatch when FAST-AF and AFD command runners are both enabled. This can remain a short contract in the proposal; it does not need implementation bodies.

### I6. Normalize noise without deleting semantic evidence

The diff policy strips generated IDs and collapses whitespace without defining scope. ID relationships can be meaningful to `for`, `aria-controls`, and `aria-labelledby`; whitespace can be meaningful in preformatted content. HTML also omits some live DOM properties.

Specify consistent identifier remapping that preserves references, whitespace-sensitive handling, and selected live properties. Retain the original observation for diagnosis. Treat unstable output as something to investigate before normalizing it away. Add cases that distinguish harmless generated-ID churn from a broken relationship.

### I7. Bind observations to the environment that produced them

The diff API accepts git refs and render results, but the result shape carries no source revision, dependency identity, browser version, schema version, or readiness/state checkpoint. Comparing old and new code with the same current dependencies can obscure what actually changed; importing two versions in one browser context can also collide in the custom-element registry.

Require an observation manifest with the specimen/source revision, relevant dependency/build identity, browser, resolved context, normalization version, and capture checkpoint. Keep each revision's runtime isolated. Define failure for missing specimens and incompatible captures. These are needed for trustworthy before/after evidence, not just caching optimizations.

### I8. Define observable events and preserve partial-result status

“Records DOM events from mount onward” needs a scope: there is no generic wildcard event listener, and non-composed shadow events do not reach a listener outside their root. Specify declared event types, observation roots, and ordering boundaries, with the schema/plugin providing additional event knowledge where available.

Do not return `confidence: 1` merely because mounting succeeded when roots, styles, event types, or states were not observed. Report explicit completeness and warnings. The closed-root wording should also be precise: `getHTML` can serialize a closed root when a reference is supplied; an arbitrary external bench usually cannot obtain that reference.

## What is worth preserving

- Commands before the UI, with the catalog as a consumer of the same operations, directly supports the intended agent workflow.
- The inventory is unusually concrete and its story/play counts checked out. The proposal accounts for flake identities, worker limits, scaffolding, profiling, and human review instead of treating the migration as dependency deletion.
- Static Violet token exports keep component tests independent of a running Violet service.
- Optional FAST-AF, Violet, and AFD integrations are a sensible ownership boundary. Keeping UI-panel plugins out limits scope.
- Requiring test parity before removal, retaining a minimal human index, and gating further investment on an observation experiment are good decisions once their acceptance criteria and dependency order are repaired.
- The proposal openly records the lack of component adoption for commands/trust events and does not use it to block ordinary DOM testing.

## Recommended acceptance order

1. Correct the rationale and prototype the observation contract against known CSS, state, and accessibility changes. Record the current cost baseline and define the bundle accounting boundary.
2. Prove a representative dual-runner slice with identical IDs, resolved contexts, positive cases, and deliberately failing interaction/accessibility cases. Include a custom renderer, explicit story name, global theme, form control, and responsive component.
3. Complete the full migration and every required replacement gate. Compare exact discovery and outcomes over the planned repeated runs; preserve the consumer's resource and flake policies. Remove Storybook only after this checkpoint.
4. Validate token dependency completeness and Violet's before/after resolution behavior before advertising reliable impact results. Validate coverage semantics before replacing the old contract rules.
5. Build the optional lens from those proven command results.

This supports the proposal's intended direction while turning its largest assumptions into explicit, testable decisions. It is not an approval to remove Storybook yet.
