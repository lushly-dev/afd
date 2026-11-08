# T08 consumer cutover and distribution

**State, 2026-11-02:** done for AFD's FAST-AF stories, which now run only on Specimen, and open for Lushly. Specimen is marked as a preview. [Three qualifying pairs](#qualifying-pairs) agree exactly on main. Lushly's move is [its issue](https://github.com/lushly-dev/lushly/issues/2116), blocked until the packages can be installed. **2026-11-04:** the owner approved the release as a preview, and the units are [admitted for it](#the-preview-release); nothing is on npm until its release PR merges.

T08's acceptance comes from the [implementation plan](implementation.md#ordered-implementation-queue): three consecutive qualifying full runner pairs on accepted consumer main snapshots with no migration change between them, normal consumer gates passing, review, scaffold and flake behaviour preserved, legacy Fluent exceptions accounted for, and exact rollback checkpoints. Package admission and main delivery go through their normal workflows.

## Where each requirement stands

| Requirement | State | Who |
| --- | --- | --- |
| Three consecutive pairs agree exactly | FAST-AF: [qualified on AFD's main](#qualifying-pairs). Lushly: [rehearsed](#the-rehearsal) | Lushly's, at its cutover |
| Resource gate | **On a first measurement, full suites use more CPU than Storybook.** [The owner accepts that for now](#the-owners-decisions) | Done for now, stays open as a follow-up |
| Budgets | Met on both consumers, including Lushly's upgrade, and [lower on native helpers](#native-helpers-and-types) | Done, re-measured each change |
| Replacement gates | Every story rule has its evidence and retirement record ([T07](t07-coverage.md#retirement-records)). [`specimen contract` now gates AFD's stories](#afds-fast-af-stories) | Done here. Lushly has no story contract to replace |
| Native helpers and types | [Done](#native-helpers-and-types) | Done |
| Normal consumer gates, with no root Storybook | FAST-AF: [done here](#afds-fast-af-stories). Lushly: not started | Lushly's repository |
| Rollback checkpoints | FAST-AF: [recorded](#rollback-for-afds-stories). Lushly: not started | Lushly's, at its cutover |
| Legacy Fluent exceptions | None here: those components were not imported. Lushly: not started | Lushly's |
| Human review of the index | All 407 links verified on AFD's stories. The owner reviewed the page on 2026-11-04: "Index looks good, nice and simple" | Done |
| Settled accessibility check | [Added](#the-settled-accessibility-check), and on for AFD's stories, which pass it | Done here. Lushly's one story is Lushly's |
| Distribution | [Admitted for the npm `preview` prerelease](#the-preview-release): Specimen's four units, the FAST-AF plugin made public, and `fast-element`, which the plugin needs | **Owner**: the trusted publishers for the nine new names, then merging the release PR |

## The rehearsal

`experiments/run-retained.mjs --mode full`, three consecutive times per consumer on one build of Specimen at `4a26cc0b`, with two workers, recorded fonts and no retries.

| | FAST-AF `24e4eb86` (upstream's head) | Lushly `309f46b5` (main on 2026-11-02) |
| --- | --- | --- |
| Discovered, indexed | 407, 407 | 880, 880 |
| Identity mismatches | 0, 0, 0 | 0, 0, 0 |
| Passed in both, disagreements | 407, 0, three times | 880, 0, three times |

Lushly's snapshot was refreshed for this, six commits past the one T06 used, and those brought Storybook 10.6.5, Playwright 1.64 and new stories. Parity held through the upgrade with no change to Specimen, and its budgets did not move: shell 45,329, interaction support 595,647, accessibility 586,666, total 1,227,642.

**These were not the qualifying runs.** They ran in AFD's harness on read-only snapshots, not through each consumer's authoritative validation path, and nobody has accepted these snapshots. Lushly's main moved six commits in a day, so the proposal's rule that relevant consumer changes invalidate evidence means its qualification has to happen at its cutover. FAST-AF's is [below](#qualifying-pairs).

## Resources

The proposal says "the primary outcome MUST be lower resource cost for equivalent verified work". T04 passed on its representative wrapper components. Its full-suite figures remained open as G03, and this is the first measurement of them. Each side ran alone, once, under `/usr/bin/time -l`.

| | FAST-AF Storybook | FAST-AF Specimen | Lushly Storybook | Lushly Specimen |
| --- | --- | --- | --- | --- |
| Wall-clock | 12.1 s | 41.9 s | 83.3 s | 133.8 s |
| CPU, user and system | 67.8 s | 107.9 s | 211.1 s | 387.4 s |
| CPU per verified case | 0.167 s | 0.265 s | 0.240 s | 0.440 s |
| Largest single process | 1,007 MiB | 294 MiB | 2,244 MiB | 501 MiB |

| Specimen compared with Storybook | FAST-AF | Lushly | T04's criterion |
| --- | --- | --- | --- |
| CPU per verified case | 1.59× | 1.84× | At most 1× |
| Wall-clock | 3.46× | 1.61× | At most 1.25×, as a guardrail on startup and render |
| Largest single process | 0.29× | 0.22× | At most 1× |

**On this evidence, full suites would not meet T04's CPU criterion or its latency guardrail, while memory looks much better.** [The owner accepts the extra CPU for now.](#the-owners-decisions)

What this measurement is and is not:

- **It is one run per side on a shared host,** at a load around 5, and not T04's recorder, its calibrated host or its repetition policy. CPU time is less sensitive to load than wall-clock, but this is a first reading and not a verdict.
- **CPU includes the descendants each side waited for,** which should cover both browsers. The memory figure is the largest single process, not the footprint of the whole tree, so it may flatter either side.
- **The likely cause is known and not profiled.** Each story gets a fresh browser context, a page load and axe's parse, as the proposal's isolation rule asks, where Storybook shares a page across a file. T06 recorded the same gap in wall-clock.

## The owner's decisions

Made on 2026-11-02, in answer to this record's first version.

| Question | Decision | What follows |
| --- | --- | --- |
| Full suites use more CPU than Storybook | "Extra CPU is fine for now" | Cutover is not blocked on it. The proposal's resource goal stands, so the [figures above](#resources) stay on record as a follow-up |
| `violet-calendar`'s `Disabled` story | Fix it | In AFD's copy, since FAST-AF now lives here |
| Distribution | Once it works end to end, the docs mark it as a preview | Lifting quarantine and publishing are still separate, and still the owner's |
| Fastbot's adapter and rule retirement | Do it here: "FAST-AF moved into the AFD repo" | Fastbot itself was not imported, so `specimen contract` is the gate here, with no adapter to install |
| Lushly's migration | An issue for Lushbot | [lushly#2116](https://github.com/lushly-dev/lushly/issues/2116), in Lushly's repository, where the work lands |
| Where AFD's FAST-AF stories run (G12) | The owner asked for a recommendation | Here, on Specimen, in AFD's FAST-AF gates. Upstream's Storybook configuration was never imported, and these stories are the ones AFD owns |
| Human review of the index | The owner reviews it when ready | On AFD's own stories, once they run here |
| Publishing (2026-11-02) | A prerelease of the core and CLI, after the review of the index | Lifting quarantine, a named publisher and release admission stay the owner's. The prebuilt hosts it needs are packaged (G13) |
| The FAST-AF plugin's distribution (2026-11-02) | Publish it with Specimen | It stops being private for the prerelease, so Lushly can install it |
| A settled accessibility check (2026-11-02) | Add it and fix the 3 stories | [Done](#the-settled-accessibility-check), kept separate from the check that matches Storybook's timing, which T06's agreement evidence uses |
| The index (2026-11-04) | "Index looks good, nice and simple" | Reviewed, after the page was styled at the owner's request on 2026-11-03 |
| The release (2026-11-04) | "Approved release. Let's mark it as preview" | [The preview release](#the-preview-release): `2.2.0-preview.0` under the npm tag `preview`. The owner sets up the publisher with computer use |
| `fast-element`, which the plugin needs and npm does not have (2026-11-04) | Publish it too | In the same prerelease, `3.0.1-preview.0`. `violet-elements` stays quarantined |
| What a plain `npm install` gets once the preview is out (2026-11-04) | The preview | The owner points `latest` at it after the release; `release.yml` never moves `latest` |
| Which release goes first, the preview or AFD 2.3.0 ([#559](https://github.com/lushly-dev/afd/pull/559)) (2026-11-04) | "Whatever you recommend" | The preview: the workflow tries the prerelease route first. #559 returns after the preview publishes |

## Native helpers and types

Without these, Storybook could not be removed. `@lushly-dev/specimen/test` has `expect`, `fn`, `spyOn`, `userEvent`, `waitFor` and `within`. `@lushly-dev/specimen/types` adds `Meta`, `StoryObj` and what they need, and `@lushly-dev/specimen/preview` has `setCustomElementsManifest`. `specimen migrate --helpers` switches a story file's imports. The [README](../../../../foundations/specimen/README.md#helpers-and-types) describes them.

The proposal requires that "all plays and metadata MUST remain semantically equivalent". The helpers are the libraries `storybook/test` bundles, at the same versions, with its `expect` assembled the same way. Storybook's instrumentation is the one thing left out, and it was never in Specimen's runs, because it does nothing outside an iframe.

Each of these held:

| Check | Result |
| --- | --- |
| The same fixtures under both runners, in `compat/native/` | Same outcomes, passing and failing, including jest-dom matchers, spies, typing and `waitFor` timeouts. In CI |
| Every FAST-AF story `24e4eb86` on native helpers, on a throwaway copy | 407 of 407 passed, 0 identity mismatches |
| Every Lushly story `309f46b5` on native helpers, on a throwaway copy | 880 of 880 passed, 0 identity mismatches |
| Lushly's own `type-check:storybook` on native types | 0 errors, the same as with Storybook's |
| FAST-AF's 79 story files on native types | Clean. The only 2 errors are `?raw` imports, because that check had no Vite types |
| A packed install outside the workspace, with no Storybook installed | A story passes, a failing one fails, and the build has no Storybook code. In CI |

Each copy's Storybook side is the [rehearsal](#the-rehearsal) on the same snapshot, where every story passed. These were runs of the candidate alone, so they show the helpers keep every story passing. They are not qualifying pairs.

### What it did to the budgets

| Category | Ceiling | FAST-AF, was | FAST-AF, native | Lushly, was | Lushly, native |
| --- | --- | --- | --- | --- | --- |
| Shell | 50,000 | 45,329 | 45,329 | 45,329 | 45,329 |
| Interaction support | 600,000 | 498,250 | 457,025 | 595,647 | 457,541 |
| Accessibility | 650,000 | 586,666 | 586,666 | 586,666 | 586,666 |
| **Total** | **1,300,000** | **1,130,245** | **1,089,020** | **1,227,642** | **1,089,536** |

Lushly's 4,353 bytes of headroom are now 142,459, and the helpers now cost both consumers about the same. Storybook's code is gone from FAST-AF's build. Lushly's keeps 67,152 bytes of it, for the reason below.

**A project has to switch its stories together.** One carrying both sets of helpers is over the interaction ceiling, at about 854,000 bytes on the fixtures. The codemod switches every file at once, so this only catches a partial migration.

### What Lushly has beyond the codemod

The codemod reads story files. On Lushly's snapshot these also need attention:

- Three modules that are not stories import `storybook/test`: `lushly-scheduling-surface.story-queries.ts`, `season-narrow-story-fixture.ts` and `lushly-catalog-workbench.story-helpers.ts`.
- `frames.story-helpers.ts` imports `instrument` from `storybook/internal/instrumenter`, which is the 67,152 bytes above.
- `.storybook/preview.ts` calls `setCustomElementsManifest`.

## AFD's FAST-AF stories

These stories were frozen copies that nothing in AFD ran, since upstream's Storybook configuration and Fastbot were not imported. Now they run here, which answers G12.

| Piece | What it is |
| --- | --- |
| `specimen.config.json`, `specimen/preview.ts` | What upstream's Storybook preview gave every story, without what only its toolbar and addons read |
| The 79 story files | `specimen migrate --helpers --apply`, which changed exactly their two import lines |
| `pnpm test:stories` | Typechecks the stories, runs every one with its accessibility check, applies the story contract, and builds the review page within its budgets |
| The `stories` job in `specimen.yml` | Runs that when `violet-elements`, fast-element or Specimen changes |

`violet-elements` takes Specimen as a development dependency only, so its packed package is unchanged, and `check-boundaries` now treats `.stories.` files as it does `.spec.` files.

**Fastbot.** It was not imported, so there is no adapter to install here and no rule to delete. `specimen contract` is the gate, and it applies every rule Fastbot's story contract did. The adapter stays in `experiments/` for anyone still running Fastbot upstream.

| On AFD's stories | Result |
| --- | --- |
| Stories run | 407 of 407 passed |
| Story contract, `fastbot-parity@1` | 0 errors, 0 warnings, over 77 components and 79 story files |
| Budgets | Shell 45,329, interaction support 457,025, accessibility 586,666, total 1,089,020 |
| Storybook's code in the build | None |

The gate fails when it should: with the calendar bug below put back, the same run reports `MISSING_STATE_STORY` and exits 1.

### The calendar story

The [`Disabled` story that disabled nothing](t07-coverage.md#finding-a-disabled-story-that-disables-nothing) now passes `disabled` through, and its play asserts every inner button is disabled.

**Fixing the story found a real bug in the component.** A disabled calendar disabled only its 2 navigation buttons. Its 42 day buttons stayed enabled and focusable, doing nothing when pressed, and the whole calendar was dimmed, which failed axe's contrast check. `violet-calendar` now passes its `disabled` state into the grid, so every day button is really disabled, and the dimming on the root is gone, since disabled buttons already dim themselves. A spec covers disabling and re-enabling. An accessibility exception would have hidden this.

### The settled accessibility check

The owner decided on 2026-11-02 to add a check that sees a story after it has settled, kept apart from the one that matches Storybook's timing. `test: { settledAccessibility: true }` in a configuration turns it on. After the usual check, a run waits until the story's elements are defined, its fonts are loaded and two frames are drawn, then checks again under the same policy. The run reports both, as `a11y` and `settled`, and a violation in the second fails the story as `settled-a11y`. With it on, `specimen-a11y` and a capture report the settled check. It is off by default, so T06's agreement holds; a qualifying pair compares Storybook's timing and runs with it off.

`compat/settled/` proves the difference in `src/compat-run.test.ts`. Its story dims its text one frame after rendering. Storybook and Specimen's default check both pass it, and the settled check fails it at `color-contrast`. A second story dims the same way but marks itself `aria-disabled`, and passes, as WCAG exempts inactive controls.

AFD's configuration turns it on, so `pnpm test:stories` and the `stories` job run it on all 407 stories. Of the 3 failures T06 found, 2 are AFD's, and both were in the components rather than the stories:

- **A disabled listbox told assistive technology its options were enabled.** Each option set `aria-disabled="false"`, which overrides the listbox's own `aria-disabled="true"`, for a screen reader as for axe. An option now states `aria-disabled` only when it is disabled itself, so a disabled listbox's state reaches every option. The option's and combobox's specs and the option's story now expect no attribute on an enabled option, and a listbox spec covers it.
- **A disabled switch dimmed its supporting text to 3.17:1.** That text usually says why the control is unavailable, as the story's does, so it should stay readable. A disabled switch now dims its control and label and leaves its supporting text alone. The checkbox and radio dimmed theirs the same way and passed only because axe saw it as a disabled control's label; they follow the same rule now. A switch spec checks the opacities.

All 407 stories pass both checks. The third failure, Lushly's settings surface at 3.03:1, is in Lushly's repository, and the check finds it when Lushly turns the setting on ([lushly#2116](https://github.com/lushly-dev/lushly/issues/2116)).

### The release route

Specimen's release unit is fixed: the core and its four prebuilt hosts release together, at one version. Each host must be built on its own platform, and the publishing job runs on one Linux runner. So when an approved intent selects `specimen`, `release.yml` first builds the four hosts, each on the image `specimen.yml` checks it on, with no build cache and read-only permissions. The publishing job then stages each into its package through `stage.mjs`, after the quality gate and before the planner packs. The steps are in [platform release controls](../../../operations/platform-releases.md#npm-workflow), and `scripts/repository-contract.test.mjs` keeps the workflow building and staging every platform package.

**A local rehearsal packed the unit and uploaded nothing.** In a scratch worktree, never pushed, the unit was admitted and an intent recorded for it. The four hosts CI built for #785 were staged the way the workflow stages them, and `pnpm release:plan` packed all five packages under `npm-main`:

- each host package holds an executable `bin/specimen-host`, byte-identical to CI's build, with its `os`, `cpu` and, on Linux, `libc: glibc`;
- the core's `optionalDependencies` name all four hosts at its version, 2.2.0;
- with one host removed, packing fails at that package's `prepack`: `no host binary at …/host-darwin-x64/bin/specimen-host`;
- staging a Linux build as `darwin-x64` is refused: `built for linux-x64, not darwin-x64`.

Nothing in that rehearsal published.

### The preview release

The owner approved the release on 2026-11-04 as a preview. Five units are admitted on the `npm-prerelease` route under the npm tag `preview`: `specimen` (the core and its four hosts), `specimen-afd`, `specimen-cli`, `specimen-fast-af`, no longer private, and `fast-element`. The FAST-AF plugin needs `fast-element`, which npm does not have. Each manifest starts at a seed (`2.2.0-preview`, `0.1.0-preview`, `3.0.1-preview`), one fragment covers all five, and the release PR's Changesets run turns each seed into `.0`. The peer ranges inside the family accept the preview and the stable releases after it (`^2.2.0-preview`), and `fast-element`'s manifest now names AFD as its repository, which npm's provenance check compares with the publishing workflow. [Platform release controls](../../../operations/platform-releases.md#npm-workflow) describes the route.

**A second local rehearsal versioned and packed the preview and uploaded nothing.** It ran on a throwaway commit of this branch, never pushed, with the plain Changesets changelog, because the GitHub one looks up commits on GitHub:

- `pnpm version-packages` selected the five units on `npm-prerelease`. It wrote `2.2.0-preview.0`, `0.1.0-preview.0` and `3.0.1-preview.0`, each package's changelog under that heading, and the intent, then removed the fragment. It left no `pre.json`, and no peer range changed;
- `pnpm release:plan`, given no route or tag, planned `npm-prerelease` under `preview`. With CI's four hosts staged, it packed all nine packages. The core names its hosts at `2.2.0-preview.0`, and the CLI names the core and the bindings at `^2.2.0-preview.0`. Each host package still holds exactly its four files;
- the nine tarballs, with this Mac's host only, and AFD core and server 2.2.1 from npm, installed into a clean npm project. The `specimen` command ran and replied in JSON, and the core imported in Node. The plugin imports only in a browser, where the bench loads it.

**The release PR merged before the publishers existed, and one run failed at its first upload.** [#559](https://github.com/lushly-dev/afd/pull/559), the preview's release PR, merged on 2026-11-07, before the trusted publishers were set up. Its two Release runs, on `d19f35e3` and `ceefba8c`, were cancelled while the hosts were still building. They would have stopped at the claim inspection anyway, because the five units' `authority` was a description, and both the claim inspection and the finalization read it as exactly `github: owner/repo`. [#790](https://github.com/lushly-dev/afd/pull/790) fixed that and re-bound the intent. Its own Release run was cancelled too, but the next push to main, [#791](https://github.com/lushly-dev/afd/pull/791) (`e40ca5e3`), started one that went all the way to the upload. npm answered the first one, `@lushly-dev/fast-element`, with a 404, because the name did not exist yet, and the publisher stopped there. No version reached npm, but that run had claimed the intent, so its failed claim held every Release run after it.

**The designed recovery does not apply, so a new intent replaces the held one.** Recovery adopts an upload whose acceptance it can verify, then uploads the rest; it refuses an uncertain upload that is absent. Here the upload was refused outright, and the registry has none of the nine versions. A claim belongs to the intent's exact bytes, so [#796](https://github.com/lushly-dev/afd/pull/796) commits a new intent, re-bound over this record and its provenance with the same versions, and the held claim stays on #790's commit `f776c32d` as the failure record. It also stops a repeat: `pnpm release:plan` now refuses a planned package npm does not have, so a run stops before it claims anything.

**The owner set up the publishers on 2026-11-07.** Each of the nine names has a public, deprecated `0.0.0-bootstrap.0` holding `bootstrap` and `latest`, with a GitHub Actions trusted publisher for `lushly-dev/afd` `release.yml`, no environment, publishing allowed and dist-tag management off. Each also lists `0.0.0-stage`, the stub npm creates on a package's first publish; it satisfies no range in the release.

**The first preview published empty, and `.1` replaces it.** #796's Release run published the nine packages under `preview` on 2026-11-07, with provenance, tags and GitHub prereleases, and completed its claim. A clean install then failed with `ERR_MODULE_NOT_FOUND`: five of the nine tarballs held only `package.json`, the readme and the license. The four hosts were complete, since their binaries are built and staged by their own jobs. `release.yml` sets `LEFTHOOK=0` so Changesets' push skips the git hooks, and `pnpm check:all` runs its gate as `lefthook run check`, which `LEFTHOOK=0` switches off: the gate took under three seconds, built nothing, and packing found no `dist/` to copy. This had been so since [#631](https://github.com/lushly-dev/afd/pull/631); no release published from `release.yml` between them. [#803](https://github.com/lushly-dev/afd/pull/803) makes the gate drop `LEFTHOOK`, makes planning refuse a tarball without what its manifest promises (it refuses all five published tarballs and accepts the built ones and AFD's nine), and adds a fragment, so the next preview is `2.2.0-preview.1`, `0.1.0-preview.1` and `3.0.1-preview.1`. `latest` stays on the placeholders until `.1` is verified; the owner deprecates the five empty `.0` versions.

**`.1` is out and works from npm.** [#802](https://github.com/lushly-dev/afd/pull/802) merged on 2026-11-08, and its Release run built and tested the whole workspace in its quality gate (about five minutes) before packing. It published the nine packages under `preview` (`2.2.0-preview.1`, `0.1.0-preview.1`, `3.0.1-preview.1`) with provenance, tags and GitHub prereleases, and completed its claim. Uploads took about five minutes each, 48 in all. Every `.1` tarball holds what its manifest promises. In a clean npm project, the core, the AFD bindings and the CLI ran, and after installing the headless shell for the Playwright the install resolved (1.65.0), the bench listed the 39 fixture stories and rendered one through the published darwin-arm64 host. `fast-element` imports only in a browser, as the Chromium consumer checks cover. The owner then deprecates the five empty `.0` versions and points `latest` at `.1` for the nine names. The host's missing-browser message named a command that works only in this repository; it now names the exact Playwright version and `npx playwright@<version> install --only-shell chromium`, which ships with the next preview.

### Qualifying pairs

`experiments/run-afd-pairs.mjs` compares the two runners on AFD's exact stories and components. AFD has no Storybook, so that side is an overlay outside the repository: upstream's Storybook configuration and dependencies, with AFD's `src`, tokens, manifest and built packages over them, and Storybook's helpers restored in each story. Specimen's side is AFD's own configuration. So the two sides share no helper code.

Three consecutive pairs on AFD's main at `7b26afb4`, with a clean tree, one build of Specimen, two workers and no retries:

| Pair | Stories | Passed in both | Disagreements | Identity mismatches |
| --- | --- | --- | --- | --- |
| 1 | 407 | 407 | 0 | 0 |
| 2 | 407 | 407 | 0 | 0 |
| 3 | 407 | 407 | 0 | 0 |

Identities are checked against Storybook's own `storybook index` of the overlay. The normal gates passed on the same change, in `pnpm verify` and on the pull request, including the new `stories` job. `experiments/check-index.mjs` opened every link of the review page: 407 of 407, with no failed requests, page errors or empty previews.

**A dry run before these disagreed on one story, and the reason was already on record.** `components-switch--disabled` failed axe on a cold Storybook run, at 3.17:1 on disabled text, and passed on Specimen. This is [T06's finding](t06-full-runner.md#finding-storybooks-check-can-miss-a-components-rendered-state): both runners normally check before a FAST component applies its args, and a frame slipping through on a cold start shows the settled state. So these pairs ran with Storybook's caches warm, and a cold start could disagree in this one way.

### Rollback for AFD's stories

Reverting [#717](https://github.com/lushly-dev/afd/pull/717) (`7b26afb4`) takes AFD's stories back to frozen and unrun. Its parent, `7fc226e6`, is the checkpoint for source, lockfile and configuration, and [#716](https://github.com/lushly-dev/afd/pull/716) can stay, since nothing but these stories uses its helpers.

## What is left

- **Lushly's move:** [lushly#2116](https://github.com/lushly-dev/lushly/issues/2116) has the steps, including what the codemod cannot reach, and Lushly's own qualifying pairs.
- **For the owner, [the preview's publication](#the-preview-release):** the nine trusted publishers, then merging its release PR and pointing `latest` at it. Lushly's issue unblocks once the preview installs.
- **A follow-up, since the extra CPU is accepted only for now:** measure full suites under T04's policy, and profile where the per-story time goes.

T09 to T11 are optional additions and are not prerequisites for cutover.
