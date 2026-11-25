# Agent-First Design: a fixed architecture, defaults a product can replace, and a review a person can keep up with

How design work is done when a person and an agent build an AFD app together. AFD fixes the
architecture and ships good defaults. A company or a product customizes, replaces or adds to the
defaults. Agents review early and often, and a person decides at the points that need one.

## Status

- **State:** scaffold with a design direction and Phase A draft specification. Written 2026-11-14
  against `545316f2`. It states the problem, what exists, a model, draft jobs, a design direction
  and the owner's decisions. The owner answered the direction and ranked the jobs first, the order
  the [Scales scaffold](../../active/scales/STATUS.md) set; on 2026-11-24 Phase A drafted the
  commands, 12 ranked-job scenario files and proposed companion amendments in
  [`spec.md`](spec.md) and [`scenarios/`](scenarios/), walked by three fresh readers.
  [STATUS.md](STATUS.md) tracks progress.
- **Amended:** 2026-11-16, with [5.10](#510-where-the-parts-live), where the result-state work
  and interface state live, and two facts in [section 2](#specimen-violet-and-umbel) about the
  component runtime and how applications render results.
- **Amended 2026-11-24:** with the owner's answer on what an agent inside an application sees
  of the screen ([question 13](#9-for-the-owner)) and a published design to compare it with,
  both in [5.10](#510-where-the-parts-live).
- **Amended 2026-11-24, later:** with the owner's clarification of that answer, under
  question 13, and the [Controls proposal](../../active/controls/controls.proposal.md), which now
  carries the work.
- **Verified:** every claim in [What exists today](#2-what-exists-today) was read first-hand on
  2026-11-14 at `545316f2`, except where a line says otherwise.
- **Not verified:**
  - Everything in [Design direction](#5-design-direction). It is a direction to write jobs
    against.
  - The Python, Rust and C++ copies of the confidence guidance
    ([5.3](#53-default-opinions-move-out-of-the-contract)). Only TypeScript's was read.
  - How much result handling Loam repeats. A text search for `undoCommand` or `.suggestion`
    matched 43 source files outside tests across its packages, 18 of them in the chrome; none
    was read. On 2026-11-16 the chrome's shared pieces were read (section 2), not every caller.
  - The claims about agents as test users in [5.5](#55-review) that have no citation here. They
    come from the owner's earlier brainstorm and were not rechecked.
- **Read for ideas, from outside this repository:**
  - Six public design skills, read from their default branches on 2026-11-14: Impeccable,
    Anthropic's frontend-design, UI UX Pro Max, Taste, Emil Kowalski's skills and Vercel's Web
    Interface Guidelines. [Section 5.8](#58-the-skill) says what was taken.
  - The owner's earlier design-engine brainstorm and its app specification, in a private
    repository. Nothing here depends on them, and none of their text or data is used.
  - [UI SDK](https://ui-sdk.dev/)'s documentation for agents, read on 2026-11-24. It was not
    installed or run. [Section 5.10](#a-published-design-to-compare) says what it bears on.
- **Next:** phase 0 closed on 2026-11-24 with the owner's step 0.6 decision (**go with changes**;
  [`bench/record/`](bench/record/README.md)), keeping steps 0.2 and 0.5 deferred. Phase A's
  drafted commands, 12 scenarios, three-seat walks and proposed companion amendments are in
  [`spec.md`](spec.md) and [`scenarios/`](scenarios/), waiting on the owner to accept or refuse
  [`spec.md` §4](spec.md#4-proposed-amendments-for-the-owner) before moving them into Patterns,
  Design Decisions and Screens from Jobs. The owner also answers the questions still open in
  [For the owner](#9-for-the-owner): 4, 8, 9 and 10.

| Field | Value |
| --- | --- |
| Epic | None for this proposal yet; opening one is the owner's call. [#1385](https://github.com/lushly-dev/afd/issues/1385) carries the code of [5.10](#510-where-the-parts-live) |
| Units likely touched | The `afd` skill and `packages/core` documentation; `foundations/specimen` and `integrations/specimen-afd` (a persona runner, statuses, a decision card); `endpoints/umbel` (its `components` plugin, later a copy plugin); `packages/examples` (the bench); a new local skill; for [5.10](#510-where-the-parts-live), `foundations/fast-af`, `packages/client` and `packages/view-state` |
| Related | [Patterns](../../active/patterns/patterns.proposal.md), [Design Decisions](../../active/design-decisions/design-decisions.proposal.md), [Screens from Jobs](../../active/screens-from-jobs/screens-from-jobs.proposal.md), [Pointing](../../active/pointing/pointing.proposal.md), [Scales](../../active/scales/scales.proposal.md), [Component Briefs](../../complete/component-briefs/STATUS.md), [Agent Engine research](../agent-engine/research.md), [epic #1385](https://github.com/lushly-dev/afd/issues/1385) (where FAST-AF's parts live) |
| Rank | Not ranked. It frames the five design proposals and adds what none of them covers |

## 1. Problem

1. **Design guidance for agents assumes the old way of building.** The public design skills
   teach an agent to act as a human designer would inside an existing stack. None changes how
   the work is done. An AFD app differs in ways they cannot use: every action is a command, a
   job is a scenario file, and what the person did is in a journal.
2. **Someone building their own product on AFD gets no design help.** This repository has two
   design skills, and each is for one of its own products. The README tells a newcomer to copy
   skill folders by hand.
3. **The design proposals do not say how they fit together, or what a product may change.**
   Five proposals each cover a part. None says which parts are AFD's architecture and which are
   content a company replaces. Patterns leaves pattern ownership open and rules out pattern
   inheritance.
4. **Default opinions sit in the contract's documentation.** How an interface should treat a
   confidence value is written into the result type's comments. A product cannot replace an
   opinion that lives there.
5. **A person's review has two sizes: everything, or what the gates left over.** Design
   Decisions narrows review to what no gate settles and tells agents not to answer those
   questions. Nothing reviews judgement before a person does, and nothing says when a person
   must be asked.
6. **More context has not made pages measurably better.** In the Component Briefs prototype a
   brief made pages cheaper and not measurably more correct. A design skill is more context, so
   it has to prove itself.

**Goal.**

- A product built on AFD starts from defaults that are good, and can customize, replace or add
  to them at the level of a company or a product.
- An agent building a screen is told what applies at the moment it needs it, and its work is
  reviewed by other agents before a person sees it.
- A person reviews the final change to guidance or interface before it ships, and is asked
  earlier only at a point of decision.
- Each default is held to evidence, and a default that products keep changing is questioned.

**Non-goals.**

- Fitting toolchains built for the old way: a drawing tool and a handoff, another framework's
  build habits, or a second design-system format. A product is built as an AFD app.
- Imposing a style. Any kind of application, in any style, must be buildable.
- Replacing the five design proposals. This one amends them
  ([section 6](#6-what-this-changes-elsewhere)).

## 2. What exists today

Read first-hand on 2026-11-14 at `545316f2`.

### The contract

- **Results carry more than data.** A full result has `confidence`, `reasoning`, `sources`,
  `plan`, `alternatives`, `warnings`, `suggestions`, `undoCommand` and `undoArgs`
  (`spec/wire/result-success-full.json`). An error has `code`, `message`, `suggestion`,
  `retryable` and `details` (`spec/wire/result-failure.json`). `spec/wire` also holds a batch
  result and a pipeline result.
- **Confidence comes with a treatment.** The result type's comment says 0.9 to 1.0 is "auto-apply
  safe" and 0.7 to 0.9 is "show as recommendation" (`packages/core/src/result.ts:63`). The
  `afd` skill repeats the bands (`.claude/skills/afd/references/command-schema.md:56`), and the
  whitepaper adds that an interface "can show confidence meters"
  (`docs/whitepaper/AFD-Whitepaper.md:322`) and repeats the bands (`:393`).
- **The skill tells the interface what to show.** Step 4 of the workflow reads "the UI calls the
  command and shows its `reasoning`, `confidence` and `warnings`"
  (`.claude/skills/afd/SKILL.md:34`). Step 3 reads "Don't start the UI until the CLI call works"
  (`:32`).
- **Two sources disagree on who a suggestion is for.** The error type's comment calls it "what
  the user can do", with examples in task language (`packages/core/src/errors.ts:43-50`). The
  skill's example names a command, "Use todo-list to see available todos" (`SKILL.md:48`), as
  does the wire fixture, and the jobs-first example asserts that a suggestion contains a
  command name (`references/jobs-first.md`).
- **Trust metadata exists.** `destructive`, `confirmPrompt`, `approval`, `expose` and `undoable`
  (`references/command-trust-config.md`). An approval can depend on the actor's kind.
- **Journals record executed commands,** in all four languages (`spec/journal.md`). A recorder
  may skip calls, and the TypeScript and Python recorders skip `auth-*` commands by default.
  The browser registry has a journal too
  ([Browser-Safe Direct Registry](../../complete/browser-direct-registry/STATUS.md)).
- **View state is already commands.** `@lushly-dev/afd-view-state` exposes panels, selections
  and tool modes (`packages/view-state/README.md`).
- **Jobs are scenario files,** and fresh readers walk a proposal from three seats before the
  owner decides: the person, the job list and the calling agent
  (`references/jobs-first.md`, "Walking the paths").

### Specimen, Violet and Umbel

- **Specimen** captures geometry, selected computed styles, control state, open shadow DOM and
  ARIA snapshots, and runs axe (`foundations/specimen/README.md`). It does not emulate forced
  colors (line 37). Prebuilt hosts exist for Linux on glibc and for macOS. Windows x64 is
  supported in this checkout, with its host built from source until that host is first released;
  "musl and Windows on arm64 are not supported yet" (lines 18 and 499; updated 2026-11-21). Its
  application-command runner, T11, is not started
  (`docs/features/complete/specimens/STATUS.md:23`).
- **Violet** is a hierarchical token engine: "nodes inherit tokens from their parents and add,
  override, subtract, reset or copy them" (`foundations/violet/packages/core/README.md:3`). It
  also has constraints on token values.
- **Umbel** serves a space's component pack, which holds at most 64 libraries
  (`endpoints/umbel/plugins/components/README.md:102`). Its host "serves their packs and skills"
  for the plugins it loads (`endpoints/umbel/README.md:22`). Its `plugins/` folder holds
  components, context, curator, hello, ideas, knowledge, memory, sources-filesystem and todo.
  There is no copy plugin.
- **`violet-elements` has no component bound to a result.** It has alert, toast, snackbar,
  empty-state, progress, skeleton and dialog, among others
  (`foundations/fast-af/packages/violet-elements/src`).
- **The component runtime carried an older command layer** (read 2026-11-16 at `a67433d7`;
  removed on 2026-11-17 in [#1398](https://github.com/lushly-dev/afd/pull/1398), under epic
  #1385, so the rest of this point describes the runtime before that change).
  `fast-element` has a `@command` decorator, an in-page command registry, confirm and undo
  behaviours, a confirm dialog, component-list and lint commands, and trust fields on emitted
  events (`foundations/fast-af/packages/element/packages/fast-element/src/command`, `src/trust`),
  written in lushly-dev/fast-af in January 2026. FAST-AF may not import a package of AFD's
  family (`scripts/check-boundaries.mjs:259`), so the runtime keeps its own copy of AFD's types
  (`src/command/types.ts:14`). Its `CommandResult` (`types.ts:52`) has no `confidence`,
  `warnings`, `sources`, `plan`, `alternatives` or `undoCommand`. Its confirmation reads a
  `confirmPrompt` of its own command entry, not AFD's `confirmPrompt` or `approval`, and its undo
  calls a `${method}Undo()` method on the element, not `undoCommand`. No application uses any of
  it; the one user is Specimen's FAST-AF plugin, which runs a component's `@command` methods in
  a story (`integrations/specimen-fast-af/src/index.ts`). The browser-safe `createDirectRegistry`
  does the registry's job now with the real contract.
- **Applications render results in the application.** Loam's chrome calls its kernel and
  renders each result by hand: its own answer type, confirm and name dialogs, a notice element
  with the suggestion, and pending state set per component
  (`endpoints/loam/packages/chrome/src/identity/account-parts.ts`,
  `src/elements/notice.ts`). Lushly, a component-heavy AFD application outside this repository,
  read on 2026-11-16, does the same: no component calls a command; components emit intent
  events and the application turns them into commands, and it built its own confirm dialog,
  list states and result normalisation. Neither renders `confidence`, `sources`,
  `alternatives`, `plan` or an undo offer, and neither takes a confirmation's wording from a
  command's `confirmPrompt`. Loam's editor reads `undoCommand` once, to decide whether an opened
  tab should close again (`endpoints/loam/packages/chrome/src/editor/editor.ts:883`).

### Loam and the skills

- **Loam has screen states as specimens,** `ListEmpty` and `ListFailed` among them
  (`endpoints/loam/packages/chrome/specimens/apps.specimens.ts:201-206`).
- **Two design skills, both for AFD's own products:** `loam-design` and `afd-site-design`.
- **The todo example covers part of the contract.** Its TypeScript backend has eleven command
  modules, three of them batch. Outside its tests, `destructive` appears in three source files and
  `confirmPrompt` in one; `approval`, `undoable`, `undoCommand` and `plan` appear in none
  (`packages/examples/todo/backends/typescript/src`). It has React and vanilla frontends. The
  owner said on 2026-11-14 that the example is out of date and is a reference only.
- **A newcomer copies skills by hand:** `npx degit lushly-dev/afd/.claude/skills/afd
  .claude/skills/afd` (`README.md:457`). A copy made that way carries no version and gets no
  notice when its source changes.
- **The listing budget is 6,300 characters** (`botcore.toml:24`).
- **The audit of 2026-11-03 removed Botcore's generic design, content and accessibility skills**
  as textbook material, and cut Botcore from 55 skills to about 9
  (`docs/operations/skills-audit-2026-11.md`). It also records that skills a model wrote for
  itself scored slightly negative.

### The design proposals

| Proposal | What it gives this one | What it leaves open |
| --- | --- | --- |
| [Patterns](../../active/patterns/patterns.proposal.md) | Statements (`useWhen`, `avoidWhen`, `keep`, `customize`), portable gates, reuse by instance or by copy, a brief that carries patterns | Who owns a pattern (its question 4); inheritance is a non-goal; a copy is `complete` or `draft`, with no record that a person approved it |
| [Design Decisions](../../active/design-decisions/design-decisions.proposal.md) | Variants as specimens, a recorded choice with its reason, a review that shows only what no gate settled, `decidedBy` as `person` or `script` | Agents are told not to answer a review item; nothing reviews judgement before the person |
| [Screens from Jobs](../../active/screens-from-jobs/screens-from-jobs.proposal.md) | A job's scenario drives the application through its states | "No automated check here can judge layout or hierarchy" |
| [Pointing](../../active/pointing/pointing.proposal.md) | A person shows an agent which element they mean | Pointing starts on Specimen's review page; pointing in the running application is deferred |
| [Scales](../../active/scales/scales.proposal.md) | Two-stage ramps (`ref.*`), purpose-named semantic tokens and governed off-ramp reasons | Approved under [#1111](https://github.com/lushly-dev/afd/issues/1111) (Slice 1 + Slice 2); implementation open |

The [design-to-code proposal](../design-to-code/00-overview.md) assumes designs are made in a
drawing tool. The Patterns status file already asks whether to retire or rewrite it.

### Evidence

- **Component Briefs' prototype:** a brief scored 66 of 75 against 61 for today's route, which
  is inside "as good". It cost 40% less than handing over the whole pack (p < 0.001). Two faults
  in the library capped every arm (`docs/features/complete/component-briefs/prototype.md`). Its
  75 sessions cost $18.91, as Patterns records.
- **Simulated users are not users.** The Agent Engine research found simulated behavior
  "unlike real people" and says to "treat simulations as probes and hypotheses, not participant
  research" (`docs/features/proposed/agent-engine/research.md:112`).
- **No route has been tested on design judgement** (`docs/operations/model-routing.md:74`).

## 3. Model

### 3.1 Three kinds of thing

| Kind | What it is | Who owns it |
| --- | --- | --- |
| **Fixed** | The architecture: commands and the result contract, jobs as scenarios, the journal, the Violet engine, Specimen, Umbel, the pack and pattern formats, and the working loop below | AFD |
| **Default content** | The design system held in Violet, the patterns, copy voice, guidance on direction and motion, the example applications | AFD ships it. A company or a product customizes, replaces or adds |
| **The product's own** | Its jobs, its recorded decisions, its saved references | The product. AFD ships none |

**The rule that follows:** nothing in the fixed row may assume a style. A rule such as Loam's
"the shell recedes" is content for one product.

AFD's own products are the first test. Loam and the afd.dev site should each be expressible as
the defaults it names, the defaults it copied and changed, and patterns of its own. If Loam's
design record cannot be written that way, the model is wrong.

### 3.2 The working loop

| Step | What happens | Carried by |
| --- | --- | --- |
| 1. Frame | State the obstacle, who has it and what would show it is gone. A change to the interface is one possible answer; a fix elsewhere, or no change, are others | This proposal |
| 2. Jobs | Write the jobs as scenario files | Jobs first |
| 3. States | Take the screen states from the command surface and the job's steps | Screens from Jobs; the default patterns ([5.2](#52-the-default-pattern-set)) |
| 4. Variants | Build alternatives that differ in how they solve the problem, not only in styling | Design Decisions |
| 5. Rules | Hold values and structure to rules a machine can check | Patterns' gates, Violet's constraints, Scales |
| 6. Check | Capture the rendered screens and run the gates | Specimen |
| 7. Panel | Agents walk the jobs and review what gates cannot read | This proposal |
| 8. Decide | A person chooses at a decision point and approves before release | Design Decisions, amended |
| 9. Record | Keep the choice with its reason and its scope | Design Decisions |
| 10. Observe | Read the journal after release against step 1 | This proposal ([5.7](#57-how-a-default-improves)) |

A known defect takes a short route through this. The loop is the order of reasoning, not a
ceremony for every change.

### 3.3 Assumptions this drops

| Old assumption | Replaced by | Already said in |
| --- | --- | --- |
| A design is drawn, then handed to a builder | The rendered screen is the medium | Design Decisions, out of scope; Patterns' status file |
| A maintained component is the only unit of reuse | Reuse by instance, or by copy with a record of its source | Patterns, decision 2 |
| A short ladder of values a person can remember | A rule an agent can check | Scales, section 1 |
| Guidance is a document to read | Statements selected and served at the moment of need | Component Briefs |
| A person reviews everything | Gates settle what they can, agents review next, a person decides | Design Decisions, and [5.5](#55-review) here |
| Done means shipped | Implemented, released, observed and learned are four states | This proposal |

## 4. Draft jobs

Sentences only. No commands are drafted and no scenario files are written yet. The owner
confirmed the list and its [rank](#rank) on 2026-11-14
([question 11](#9-for-the-owner)). A job keeps its number, so a merged job leaves a gap.

| # | Rank | Seat | Sentence |
| --- | --- | --- | --- |
| 1 | 2 | Product builder | When I start a product on AFD, I want patterns, voice and guidance that are good without setup, so that my first screens are sound before I have written any rules of my own |
| 2 | 6 | Product builder | When a default does not suit my company or my product, I want my own copy of that pattern with its source recorded, or my own pattern named where the default was, so that agents build to my rule and nothing changes it for me |
| 3 | | | Merged into job 2 |
| 4 | 11 | Product builder | When I remove something a default requires, I want to give a reason and see it reported, so that a dropped requirement is never invisible |
| 5 | 7 | Product builder | When a default I copied is changed upstream, I want to see what changed, statement by statement, and take it after review, so that an improvement reaches me by my choice |
| 6 | 1 | Building agent | When I build a screen for a job, I want every state the commands can produce named, with the pattern for each, so that no error, empty or pending state is left undesigned |
| 7 | 9 | Building agent | When I have no skill installed, I want the commands to tell me what applies, so that the guidance reaches me in any harness |
| 8 | 4 | Reviewing agent | When I walk a job as a kind of user, I want only that user's way of perceiving and acting, so that what I find is what they would meet |
| 9 | 5 | Person | When agents have reviewed a change, I want to see only the points that need my decision, each with the evidence for both sides, so that my time goes on choosing |
| 10 | 3 | Person | When a change to guidance or interface is ready to ship, I want one view of what changed, why, and what it affects, and to say why when I turn one down, so that nothing reaches users that I did not approve and nothing is proposed again for the wrong reason |
| 11 | | | Folded into job 10 |
| 12 | 8 | Person | When agents agree with each other, I want to know how often I would have disagreed, so that I know whether their agreement means anything |
| 13 | Deferred | Default's owner | When many products change the same default, I want to be told, with their reasons, so that I can ask whether the default is wrong |
| 14 | 10 | Product builder | When I have not set something up, I want reports to say what went unmeasured and what would measure it, so that I add things because they help |
| 15 | 12 | Person | When a change I approved has been in use, I want the journal read against what it was meant to fix, so that I know whether it worked |

Thirteen jobs: twelve ranked and one deferred. Jobs 4, 8 and 10 hold refusals or limits. Job 14
is the quiet one.

### Rank

Proposed on 2026-11-14 at the owner's request, and confirmed by the owner the same day.

| Rank | Job | Why here |
| --- | --- | --- |
| 1 | 6. Every state named, with its pattern | The main new value, and what step 0.2 tests |
| 2 | 1. Good defaults with no setup | The way in for a product. Job 6 and the default set deliver most of it |
| 3 | 10. One view before release | The owner's requirement that a person approves what ships |
| 4 | 8. A reviewer held to one modality | The panel rests on it, and step 0.3 tests it |
| 5 | 9. Only the points that need a decision | Needs job 8. Carries the split trigger |
| 6 | 2. A copied pattern with its source | The customizing the owner decided |
| 7 | 5. See what changed upstream and take it | Needs job 2 |
| 8 | 12. How often a person would have disagreed | Without it, agents' agreement is taken on trust |
| 9 | 7. Commands say what applies, with no skill | The path from a skill to an Umbel tool |
| 10 | 14. Reports name what went unmeasured | A property of every report |
| 11 | 4. A dropped requirement has a reason | Small once job 2 exists |
| 12 | 15. Whether an approved change worked | The loop's last step. It needs a released application with a journal |

Ranks 1 to 5 are the first slice.

- **Job 3 is merged into job 2.** Replacing a default is one row of the table in
  [5.1](#51-customizing-a-default).
- **Job 11 is folded into job 10.** Why a change was turned down is a field on the decision
  card.
- **Job 13 is deferred.** It needs sight of other companies' repositories, which AFD does not
  have. It works only inside one company's space.
- **Job 15 is added** for the loop's last step, which no job covered.

## 5. Design direction

### 5.1 Customizing a default

**Decided by the owner on 2026-11-14: a product customizes a default pattern by copying it.**
Patterns are not layered. The owner's rule is Patterns' decision 2 applied to the pattern
itself: what is managed centrally and takes updates is a component, and a pattern is a copy
that its holder owns.

**A term.** In Patterns, "copy", "revision" and "provenance marker" belong to a saved region of
a screen. This section is about a pattern file copied into another library, and calls it a
**copied pattern**. It needs its own record of its source.

| A product wants to | How | When the default changes |
| --- | --- | --- |
| Use a default as it is | Name it as `<library>/<pattern>` at a version, as Patterns' question 4 proposes | It arrives when the product takes a new version of the default library |
| Change a default | Copy the pattern file into its own library, with a line naming the source pattern and its revision, and edit it | Nothing changes. A comparison reports what moved |
| Add a pattern | Write it in its own library | Nothing |
| Replace a default | Name its own pattern where the default was named | Nothing |

- **Nothing reaches a product without a change in the product's own repository.** A named
  default changes when the product takes a new version. A copied pattern changes when someone
  edits it. Both are changes a person reviews before release ([5.5](#55-review)).
- **A copied pattern is the whole file.** A pattern file holds its statements and their gates
  together (Patterns, section 5.1), so a changed `keep` statement and its gate change in one
  place.
- **Statement ids carry over.** Ids are unique within a library, not across a pack
  (`foundations/specimen/docs/pack-format.md:202`), so a copied pattern in another library
  keeps its source's ids and the comparison matches on them.
- **A company's library** holds its copied patterns and its own. Its products name the
  company's patterns or copy them. Nothing computes a combined result.
- **Tokens are not affected.** Violet's hierarchy stays as it is. Whether copy voice is named
  or copied is for the Umbel plugin that will carry it.

**Seeing what changed, and taking it.** A comparison between a copied pattern and its source
reports each statement, by its id, as unchanged, changed here, changed upstream, changed in
both, dropped here or added upstream. A person or an agent can run it at any time. Taking a
change is an edit to the copied pattern, proposed on a decision card like any other change to
guidance. An agent can do the merge; a person approves it.

**Dropping a requirement.** A copied pattern that removes a `keep` statement records a reason,
and the comparison reports it as a waiver. Specimen's coverage waivers already carry a reason
(`foundations/specimen/src/schema.ts:582-589`, as Screens from Jobs cites it; not reread
here).

**What Patterns lacks for this.** Each is an amendment
([section 6](#6-what-this-changes-elsewhere)):

- **A record of source on a pattern file.** Today only a saved region carries a marker.
- **Its outdated-copies job extended to a copied pattern,** with the comparison above.
- **The source as it was.** Telling "changed here" from "changed upstream" needs the source at
  the recorded revision. The catalog holds a digest per pattern and not the old text, so a
  copied pattern may need to record a digest per statement when it is made. Not designed here.
- **Which pattern a product's screens are held to.** A component claims a pattern in its guide
  with `implements` (Patterns, section 5.3). A library such as `violet-elements` would still
  claim the default, so nothing yet says how a product's screens are held to the gates of its
  copied pattern. Not designed here.

**Considered and dropped: layering.** The first draft recommended that a product hold only its
differences (override, add, subtract) and that a resolver combine them with the defaults, as
Violet does for tokens. It was dropped for three reasons:

- An upstream change would reach a product that had not chosen it, and a new `keep` could
  fail its screens.
- An overridden statement could separate from its gate.
- It needs a resolver, and Patterns rules out pattern inheritance.

### 5.2 The default pattern set

Patterns asks who owns a pattern that several libraries implement. For the states a command
result can produce, the answer is AFD, because the states come from AFD's contract and from no
library. The owner decided this on 2026-11-14 ([question 3](#9-for-the-owner)).

| Candidate pattern | Contract fields it renders | Setup starts from |
| --- | --- | --- |
| An error with its recovery | `error.code`, `message`, `suggestion`, `retryable` | `spec/wire/result-failure.json` |
| An undo offer | `undoCommand` and `undoArgs`, with the command's `undoable` | `spec/wire/result-success-full.json` and the command's definition |
| A confirmation before a destructive command | `destructive`, `confirmPrompt` | The command's definition |
| An approval request | `approval` | The command's definition |
| Progress | `plan` | `spec/wire/result-success-full.json` |
| A choice among alternatives | `alternatives`, `confidence` | `spec/wire/result-success-full.json` |
| Warnings | `warnings` | `spec/wire/result-success-full.json` |
| Evidence for a result | `reasoning`, `sources` | `spec/wire/result-success-full.json` |
| A batch with some failures | Per-item results | `spec/wire/batch-result.json` |
| An empty collection, a failed collection | A successful empty result; an error | Loam's `ListEmpty` and `ListFailed` |

- **Setups come from fixtures every language already agrees on.**
- **Gates stay inside Patterns' vocabulary.** "The recovery is an operable control with a name"
  and "focus moves to the notice" need only roles, names and focus.
- **Loam is the first implementation.** A product with another design system builds its own and
  is held to the same gates, which is Patterns' job 3.
- **Each pattern is built in three places** ([5.10](#510-where-the-parts-live)): presentational
  pieces in the component library; turning a result into what they show in AFD's browser
  client; the wording and the wiring in the application. That the library's pieces take plain
  properties is the plan's position, open until its step starts.
- **Statements are not written from the public skills.** Patterns' decision 8 holds that save
  writes no guidance, because an invented `keep` reads as a requirement. A statement here comes
  from the owner or from a fault seen in phase 0, and stays `authored` until a gate verifies it.

### 5.3 Default opinions move out of the contract

The contract says what a field means. How an interface treats it is a default, and belongs
where a product can replace it.

| Opinion | Where it sits today | Proposed home |
| --- | --- | --- |
| Confidence of 0.9 or more is safe to apply automatically | `result.ts:63`, `command-schema.md:56`, the whitepaper | The alternatives pattern. Whether a result applies by itself depends on whether it can be undone; confidence decides only how strongly it is presented |
| The interface shows `reasoning`, `confidence` and `warnings` | `afd` skill, step 4 | The evidence and warnings patterns. The skill says the person can reach them |
| An interface can show confidence meters | The whitepaper | The alternatives pattern: a number appears only where a person can act on it |
| Do not start the interface until the CLI call works | `afd` skill, step 3 | Reworded: it governs what ships. A prototype on fixtures may come first, as Loam's screen specimens on stub clients already do |

Two points this section does not settle:

- **Who a suggestion is for.** The sources disagree ([section 2](#the-contract)). A structured
  recovery beside the prose (a command, its input and a label, in the shape `undoCommand` and
  `undoArgs` already have) would let an interface render a button and an agent call it. That
  changes the contract in four languages, so it is its own proposal.
- **"The best UI is no UI"** opens `references/philosophy.md`. Its claim about architecture
  holds: the interface carries no business logic. Its claim about value sits badly beside a
  proposal about making interfaces good. The text is the owner's.

### 5.4 Status: proposed, approved, deprecated

Having a pattern, a saved copy or a statement must not mean it is approved. "Saved copy" is
Patterns' copy: the saved markup and styles of a region.

- **A pattern, a saved copy and a statement each carry a status.** Something an agent proposes
  carries no weight until a person approves it.
- **This is separate from what Patterns records.** `complete` and `draft` say whether a copy
  could be saved whole. `verified` and `authored` say whether a gate ran and held.
- **Only approved content is served by default.** Proposed content is listed for review.

### 5.5 Review

**Three tiers.**

1. **Gates settle what a machine can decide.** A failure goes back to the building agent and is
   never a question for anyone, as Design Decisions already has it.
2. **A panel of agents reviews early and often:** personas walking the jobs, and focused passes
   on one question each, such as accessibility or copy.
3. **A person decides** at a decision point, and approves the final change to guidance or
   interface before it ships.

**The panel.**

- **A persona card** names a kind of user, how experienced they are, a modality and a stance.
- **The runner enforces the modality.** The card alone is not a modality.

  | Modality | Perceives | Acts with |
  | --- | --- | --- |
  | Sighted, pointer | Screenshots only | Pointer and typing |
  | Keyboard only | Screenshots with the focus indicator | Keys only |
  | Screen reader | The accessibility tree and announcements only | Keys only |
  | Low vision | Screenshots at high zoom and at 320 px wide | Pointer and keys |

  A forced-colors modality needs emulation, and neither has it. Specimen has none. Botcore's
  `cdp_emulate` sets a colour scheme, a viewport and offline, and takes a user agent and CPU
  throttling without applying them
  (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:716`, read 2026-11-14 at
  `fd0781e4`).
- **A job script is the scenario's sentence and starting state, without its steps.** The steps
  are the path the persona is not shown.
- **The path is measured, not only the outcome.** The journal records which commands the
  persona's actions ran. Wrong turns, repeats and errors are read from it against the
  scenario's steps. A job completed with many wrong turns is a finding.
- **A finding carries its evidence class.** A defect that a trace reproduces is *observed*. A
  judgement about how a person would feel is a *hypothesis*, and stays one until evidence from
  people supports it.
- **A panel gives coverage, not votes.** Agreement among agents is not evidence that they are
  right. Runs of one model may share its blind spots, which is a hypothesis here and not a
  finding. Reviewers differ in model family and in
  seat, and each round reports how far their findings overlap.

**When a person is asked.** The owner agreed these triggers and their numbers on 2026-11-14
([question 6](#9-for-the-owner)). The numbers are a starting point, not a finding.

| Trigger | Why |
| --- | --- |
| Reviewers split close to evenly | The split is the signal. With a panel of five, a 3 to 2 split asks the person |
| Reviewers agree, against a recorded decision | `decision-check` finds it |
| No earlier answer covers this kind of question | The first answer sets the precedent, and later ones settle by it |
| The change is to guidance | One statement alters every later screen |
| The change cannot be undone, or goes to other products as a default | The cost of being wrong |

**What agents may settle.** Agents can send work back without asking anyone. A panel may
answer a review item provisionally; the author of the change may not
([question 5](#9-for-the-owner), decided). Only a person accepts a change for release. No class
of change has standing approval.

**The decision card.** One per proposed change, or per tight group.

| Part | Holds |
| --- | --- |
| What | The change in one sentence, whose it is (a default, a company's or a product's), and what it touches |
| Visual | Before and after for the same screen, state, viewport, theme and modality, with the changed region marked. Where no picture is possible, the nearest concrete thing: an announcement transcript, a focus order |
| Why | The findings behind it, their evidence class, how many reviewers met it, and the split |
| Effect | Gates before and after, and the bench's check-level results |
| Risk | What else it affects, and whether it can be undone |
| Decision | Approve, ask for changes, turn down with a reason and a scope, or defer |

- **A refusal records its scope:** unsafe, wrong for this context, or not a priority now. Only
  the first is lasting.
- **Accepting a regression and approving an intended change are separate answers.**
- **The person's capacity is part of the budget.** Cards are capped per round and sorted by
  severity. A queue nobody can read slows the loop; it does not lower the bar.

**Keeping the panel honest.**

- **Seeded faults.** The bench plants known faults. The panel's recall, and its precision once a
  person has judged its other findings, are measured per modality.
- **Jobs held out.** Some jobs are never shown to the building agent. If the shown jobs improve
  while the held-out ones do not, the loop is fitting its reviewers.
- **A sample of agreement.** A person sees a sample of what the panel agreed on, so the rate at
  which they would have disagreed is known.
- **Stop rules.** The person sets a budget of rounds and cost. The loop also stops when two
  rounds find nothing new of weight, when a gate regresses, or when results level off.
- **No circle.** A guideline an agent wrote, an agent building to it and an agent praising the
  result prove nothing. The builder and the reviewers do not share context, and learned
  guidance needs a person's approval before it is promoted.

### 5.6 Adoption by degrees

Nothing is required of a product. Each addition measures more, and every report names what went
unmeasured and what would measure it.

| A product has | This adds |
| --- | --- |
| Commands only | The default patterns by lookup, and the list of states its commands can produce |
| Jobs as scenarios | Job scripts for the panel, and states taken from job steps |
| Specimens of its screens | Gates, captures and review |
| A journal | Paths measured against scenarios, and work ranked by real use |
| Its own library | Its own patterns, named where it replaced a default, and its changes to copied patterns reported |

A report never fails because a product set up less.

### 5.7 How a default improves

- **A changed copied pattern is a lead, not a verdict.** A group of products changing the same
  statement of one default starts an investigation, with their reasons.
- **A change to a default moves through three states:** draft, then preview, where products opt
  in, then stable or withdrawn.
- **A change records what it was meant to fix,** and the next reading of the journal says
  whether that moved. Movement after a release is not proof the change caused it.

### 5.8 The skill

What is left for a skill once the rest exists is small: the loop in [3.2](#32-the-working-loop),
which instrument to use when, and the judgements no pattern owns and no gate can read.

- **One skill, with one reference per topic** that will later be served: direction for a whole
  screen, motion, and copy voice. Several skills would each spend listing budget.
- **Each reference is written as one-line entries with ids,** the form a pack already uses, so
  moving it is a file move.
- **Three stages for each topic:**
  1. a reference in the skill;
  2. a skill served by an Umbel plugin, which the host already does for its plugins;
  3. a tool that selects what applies, as the copy plugin will for voice.
- **The skill says to prefer the tool once it exists,** and the reference is then deleted.
- **What the six public skills hold, sorted by kind.** The table says where content of each
  kind belongs. It writes no pattern statement: one comes only from the owner or from a fault
  seen in phase 0 ([5.2](#52-the-default-pattern-set)). The public skills themselves are given
  to a building agent only in arm 1 of the bench. The direction and motion references draw on
  them, and what those hold stays `authored`.

  | Kind of content | Where that kind belongs |
  | --- | --- |
  | When to use a piece of interface and when not ("a modal for a task that needs no interruption") | `avoidWhen` and `useWhen` statements on a pattern |
  | Behaviour every implementation must keep ("Escape closes and returns focus") | A `keep` statement with a gate |
  | Motion and style rules a gate cannot read (how often something is seen decides whether it animates) | The motion reference |
  | Judgement about a whole screen (ground the design in its subject; spend boldness in one place) | The direction reference |
  | The looks a model falls back on | A check on rendered output, not text in a prompt, as the audit concluded for prose |
  | Textbook material and each skill's own process | Dropped |

### 5.9 The bench

A new reference application that both proves the defaults and calibrates the panel. The todo
example is not its base ([question 7](#9-for-the-owner)). Its draft specification, with a
recommended domain and a budget, is [bench.md](bench.md).

- **A specification that states needs, not components.** It lists jobs, screens, the states of
  each with what the user must be able to do, and what counts as done. Choosing components,
  layout and copy is what gets judged.
- **The commands are the data contract,** and scenario fixtures force each state.
- **It exercises every pattern in [5.2](#52-the-default-pattern-set).**
- **Two folders.** The builder sees the specification. The seeded faults, the held-out jobs and
  the persona cards are kept outside the builder's worktree. That is not a wall, so each
  session's tool calls are checked for a read of them ([bench.md](bench.md#runs)).
- **Arms, with the rule for "go" fixed before any run:**

  | Arm | The building agent gets |
  | --- | --- |
  | 0 | Nothing beyond what a session in this repository has today, which includes the components brief |
  | 1 | A general public design skill |
  | 2 | The default patterns through the brief |
  | 3 | Arm 2 and this proposal's skill |
  | 4 | Arm 3 and the panel loop |

  The [bench specification](bench.md) adds a bare arm to step 0.1, given no list of states.
  The owner approved it on 2026-11-15.

- **Results are reported check by check,** with what was measured, excluded and unmeasured.
  No single score ranks the arms. The owner's blind choice between arms is the judgement measure.
- **Runs per arm follow Component Briefs:** fifteen.

### 5.10 Where the parts live

Added 2026-11-16 ([question 13](#9-for-the-owner)). The owner's test for the component layer:
just because something can go into FAST-AF, should it? Each part goes where it belongs and is
worth its complexity, which is often not the component layer. That nothing uses a part today is
not by itself a reason to remove it; the question is whether an application should use it
there. Lushly and Loam are the checks ([section 2](#specimen-violet-and-umbel)).

Four questions place a part:

1. Should an application use it at all? If not, it lives nowhere, however little it costs to
   keep.
2. Can only the component runtime do it? Then it is the runtime's.
3. Does it need the command contract? Then it cannot be in FAST-AF, Specimen or Violet, which
   may not import a package of AFD's family (`scripts/check-boundaries.mjs:259`), and it belongs
   in an AFD package or the application.
4. Did more than one application need it? Then it is shared, in the library or an AFD package;
   otherwise it is the application's.

| Part | Where it lives |
| --- | --- |
| A result-state pattern's presentation: an error with its suggestion and a retry, a confirmation with busy and error states, list states, and the rest of [5.2](#52-the-default-pattern-set) | The component library (`violet-elements`). That its pieces take plain properties (a message, a suggestion, a busy flag, a label) and know nothing about commands is the plan's position, open until its step starts |
| Turning a result into what a piece shows: loading, ready, empty or error, with the message, suggestion, `retryable`, code, warnings and the rest of the result kept | AFD's browser client, beside the browser-safe DirectClient ([#655](https://github.com/lushly-dev/afd/issues/655)). The direct registry's command summary should also carry `confirmPrompt`, `examples`, `requires` and `tags`, which it drops today (`packages/server/src/direct-registry.ts:214`) |
| Wording, which command a control calls, and what happens after | The application |
| An agent seeing and setting interface state (an open panel, a selection, a tab) | `@lushly-dev/afd-view-state`, which Loam already uses with handlers it writes by hand; Lushly describes where the person is in a string it sets by hand. Proposed: a helper in that package that binds an element's properties and change events to a view-state id, and a rule Specimen can check, that a stateful component exposes its state as a settable property with a change event |
| An agent seeing and filling what is on the screen (a field's label, its value, its choices) | Decided 2026-11-24 ([question 13](#9-for-the-owner)): an agent inside an application can, where today it can only call commands and set the state in the row above. Components still declare no actions. The recommendation the owner agreed to named `afd-view-state`. The [Controls proposal](../../active/controls/controls.proposal.md), which the owner approved the same day, places commands of its own there, with its jobs as scenarios. Its phases are sub-issues of the epic, [#2487](https://github.com/lushly-dev/afd/issues/2487) first; they replace #2275. Nothing is built |
| What an agent knows about a component | Specimen's pack and Umbel's `components-brief`, as now |
| Scoped registries in the render path, the loader for their polyfill, and the opt-in definition schema Specimen reads | The component runtime (`fast-element`). Its scoped mixin and registry builders went with the command layer on 2026-11-17 ([#1398](https://github.com/lushly-dev/afd/pull/1398)): Loam, the application that needs scoped registries, uses the browser's own API |

What this rules out:

- **Commands declared by components.** AFD's honesty check keeps business logic in commands a
  person and an agent can run from the CLI, and says ephemeral interface state is not a command
  (`.claude/skills/afd/SKILL.md`, "The honesty check"). A capability that exists only while a
  component is on the screen fails it. What a component can offer an agent is interface state,
  which its properties and events already carry and `afd-view-state` exposes.
- **A command system in the runtime.** The runtime's command layer (`@command`, its in-page
  registry, confirm and undo, the confirm dialog, the component-list and lint commands) and its
  trust fields on emitted events leave it, with Specimen's FAST-AF plugin losing the path that
  runs `@command` methods. AFD's direct registry, Specimen's pack and the library cover what
  they meant to do. `@command` was removed entirely, rather than kept for interface
  operations, on 2026-11-17 ([#1398](https://github.com/lushly-dev/afd/pull/1398)).
- **A binding package between the runtime and AFD.** Components do not call commands in either
  application, so it would have little to do.

[Epic #1385](https://github.com/lushly-dev/afd/issues/1385) holds the steps, the runtime
cleanup first. They are its work, not this proposal's; an agent inside a product acting for its
user stays out of scope ([section 10](#10-out-of-scope)). The row on seeing and filling the
screen records the owner's answer and what it leaves open, and nothing more: what such an
agent may do for its user is designed under the epic, not here.

#### A published design to compare

[UI SDK](https://ui-sdk.dev/) is a library of interface behaviours, written once and rendered
in React, Vue, Svelte, Solid and custom elements, with a bridge that lets an agent read and
change the components on a page. Its
[documentation for agents](https://ui-sdk.dev/docs/agents/llms.txt) was read on 2026-11-24, from
its plain-text copy. That documentation carries no version number; npm tagged `0.1.0-beta.17`
as `latest` when it was read, and the package was first published on 2026-11-12. It was not
installed or run, and no other design was surveyed. Its bridge is a published design close to
the screen row above:

- **What an agent reads.** `snapshot()` returns an entry for each registered component: its
  kind, its accessible name as `label`, its state (`value`, `checked`, `open`), its choices as
  `items` when it has ten or fewer, its `errors`, whether it is `disabled`, and the names of the
  `actions` it accepts. A snapshot holds at most 100 components; `query()` finds one past that
  limit and reads a longer list of choices.
- **What an agent may not read.** A password, card or one-time-code field's value, or one
  inside `data-agent-secret`, reads `"[redacted]"`. Components inside `data-agent-hidden` are
  left out.
- **How a change is made.** `act()` calls a component's own methods: "They don't simulate
  pointer or keyboard input." An agent's change reaches the same callbacks as a person's, with
  the change's source given as `agent`, and the application can cancel it. A failed step says
  what to do next: `No item "XL" in Size (c1). Its items: Small, Medium, Large.`
- **Who confirms.** The application's `allow` callback "runs before the step changes
  anything". `data-agent-confirm` on an element marks a step that needs a person: without
  `allow` the step fails, and with it the callback is given the mark's text. The documentation
  warns that an `allow` which returns `true` without reading that text "answers yes for the
  person".

It differs from this section on where an agent's capability lives, in two ways:

- **A component can declare its agent actions,** with an `agent` key on its definition (its
  Checkbox has `agent: { actions: ["setChecked"] }`), as `@command` did. The key is optional
  and marked experimental: without it, "the bridge guesses from method names". The decision of
  2026-11-24 keeps actions out of components.
- **The bridge is all it gives an agent to act with,** and the bridge works only on a page
  open in a browser: it "reads and changes the components on the page, so it runs in the
  browser." A step reaches what that page can render, opening a closed tab or section to find
  a component, and an application may give its agent other tools of its own. Its documentation
  gives the limits that follow:
  - "Earlier steps stay applied; there is no rollback."
  - Of a `set` action's arguments only the first is checked, and only where its option is a
    boolean, a number or read by an attribute parser. The rest "arrive unchecked, so check
    them in the method".
  - Its history, marked experimental, restores recorded component values and can undo an
    agent's changes. It "doesn't undo a network request, recreate a removed component or
    reverse an action such as saving a form."

  In AFD those belong to the command: its input schema, `undoCommand` and the journal.

Two other parts of it meet [epic #1385](https://github.com/lushly-dev/afd/issues/1385):

- **What an agent knows when it writes markup** (step 9,
  [#1157](https://github.com/lushly-dev/afd/issues/1157)). Each of its packages carries its
  Markdown documentation for the installed version (`node_modules/@ui-sdk/react/docs/llms.txt`),
  and `@ui-sdk/core` carries a skill (`node_modules/@ui-sdk/core/skills/ui-sdk/SKILL.md`).
  `violet-elements`' pack is not in its npm package.
- **WebMCP** (step 12, [#2278](https://github.com/lushly-dev/afd/issues/2278)). Its
  `registerTools` registers three tools for any page, `snapshot`, `act` and `query`, through
  `document.modelContext`, with `readOnlyHint` on `snapshot`, `consequentialHint` on `act` and
  `untrustedContentHint` on all three. Loam's
  [phase 5 specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md#11-webmcp-885-d149)
  has its projection register each command exposed to MCP and names the same three hints
  (section 11), so this adds no requirement there. That projection is an optional step and is
  not started.

Its benchmark is its own: one task on a settings screen, the median of three runs, Sonnet
through Claude Code. In React the bridge took 2 tool calls and 21.8k tokens where browser tools
took 17 and 291.1k on Base UI, and it adds that its own screen driven with browser tools "took
about as much as the other libraries, so the difference comes from the tools." No AFD
application has been measured on that task.

## 6. What this changes elsewhere

Each is an amendment for the owner to accept, not an edit made here.

| Document | Change |
| --- | --- |
| Patterns | Question 4 answered for result states: AFD owns them. The inheritance non-goal stays. A record of source on a pattern file, the outdated-copies job extended to a copied pattern, the source as it was, how a product's screens are held to a copied pattern, and a reason for a dropped `keep` ([5.1](#51-customizing-a-default)). A status on patterns, saved copies and statements ([5.4](#54-status-proposed-approved-deprecated)) |
| Design Decisions | A panel may answer a review item provisionally; the author of a change may not (decided, question 5). Its recommendation 7, that an answer given through the CLI settles a review item, conflicts with "only a person accepts a change for release" ([5.5](#55-review)); the owner rules on it there. `decidedBy` gains a third kind for a panel, with its reviewers and its split. A review item gains the decision card's why, effect and risk. Variants should differ in mechanism, where its example differs in density |
| Screens from Jobs | The panel walks the running application, and its paths are read from the journal. Screens from Jobs' captures supply the decision card's before and after. Its stated limit on judging layout and hierarchy gains a partial check: the measured path |
| Pointing | No change. Its question about pointing in the running application stands |
| `afd` skill, `command-schema.md`, `result.ts` comments, the whitepaper | The edits in [5.3](#53-default-opinions-move-out-of-the-contract) |
| Design to Code | Retire or rewrite it; the owner's call, already raised in the Patterns status file |
| `fast-element`, `violet-elements`, AFD's browser client, `afd-view-state` | Where the result-state work and interface state live ([5.10](#510-where-the-parts-live)). Decided 2026-11-16 (question 13), with an addition on 2026-11-24: an agent inside an application sees and fills what is on the screen, which the [Controls proposal](../../active/controls/controls.proposal.md) carries. The code changes are [epic #1385](https://github.com/lushly-dev/afd/issues/1385)'s, not this document's |

## 7. Phases

### Phase 0. Prove it

The owner said on 2026-11-14 to run it. The bench is kept. The scripts that run the arms are
throwaway, and only their record is merged. Every rule for "go" is fixed before the first run,
because later steps reuse earlier steps' builds ([bench.md](bench.md#rules-for-go)).
No step here runs arm 4: the panel loop is built in phase C, and step 0.3 tests first whether
a panel finds faults at all.

| Step | Question | How |
| --- | --- | --- |
| 0.0 | Is there a bench? | Write the bench's specification ([5.9](#59-the-bench), drafted in [bench.md](bench.md)): an invented domain, its commands and fixtures, the seeded faults, the held-out jobs, the persona cards, a run count and a cost estimate. The owner approves the domain and the budget before any session runs |
| 0.1 | What goes wrong today? | Arms 0 and 1 on the bench, and a bare arm given no list of states. The owner reviews the results blind and names the faults. Those faults, and no others, become the first statements |
| 0.2 | Do the default patterns help? | Arm 2 against arm 0, scored on the result states |
| 0.3 | Can a panel find planted faults? | Seed faults in one build. Measure recall and judged precision per modality, and the overlap between reviewers |
| 0.4 | Does the measured path tell a good screen from a bad one? | The same job on a clean build and a seeded one; compare the paths read from the journal |
| 0.5 | Does the skill add anything? | Arm 3 against arm 2. If it does not, it is not written |
| 0.6 | Decision | The owner: go, go with changes, or stop |

### Phase A. Specify

Copying a default with its provenance and comparison, the statuses, the panel's `decidedBy` and
the decision card, as amendments to the proposals that own them. The jobs in
[section 4](#4-draft-jobs) become scenario files against drafted commands, and readers walk
them.

**Exit:** the owner has accepted or refused each amendment, and each job in the first slice the
owner confirms is a scenario file whose paths readers have walked. A part that has moved takes
its exit from the proposal that owns it.

### Phase B. Defaults

The result-state pattern set, with Loam as its first implementation, built where
[5.10](#510-where-the-parts-live) places each part. The edits in
[5.3](#53-default-opinions-move-out-of-the-contract). The skill, if step 0.5 says so.

**Exit:** every pattern in [5.2](#52-the-default-pattern-set) has gates that hold on Loam's
implementation and fail on a seeded fault, and the edits the owner accepts under question 4
are merged wherever the opinion is repeated.

### Phase C. Review

The persona runner with enforced modalities, the triggers, the decision card and the pre-ship
view.

**Exit:** on the bench's seeded faults the panel meets the rule step 0.3 fixed, and one change
has gone from the panel to a decision card to a person's approval in the pre-ship view.

### Phase D. Adoption and improvement

Reports that name what went unmeasured. Counts of changed copied patterns. The draft, preview
and stable states for a default. Topics moving from the skill into Umbel.

**Exit:** a product with commands only gets a report that names what went unmeasured, and one
topic is served from Umbel with its reference deleted from the skill.

## 8. Risks and open points

| Risk or open point | Response |
| --- | --- |
| A sixth design proposal, when the owner has decided little in the other five | [Question 1](#9-for-the-owner) is decided: it stays the frame, and each part moves into the proposal that owns it. It drafts no commands until the jobs are ranked |
| Agents' findings are read as what users think | Evidence classes on every finding; a hypothesis stays one |
| The loop fits its own reviewers | Held-out jobs, seeded faults, a sample of agreement, and the owner's blind review |
| A brief grows. Loam's is already 88,400 bytes, over its target (Patterns, section 3) | A statement moves from a guide to a pattern and is sent once. Phase 0 measures it, as Patterns' step 0.4 does |
| A copied pattern falls behind its source | The comparison is a command an agent can run in the loop, and taking a change is an agent's merge and a person's approval. One that nobody compares stays as it was; it never changes unasked |
| Specimen's Windows host is not released | Windows x64 runs in this checkout with the host built from source (updated 2026-11-21; this row first said Specimen does not run on Windows). Outside the checkout, the panel can drive a browser through Botcore's `cdp_*` commands, and gates and captures wait on the released host |
| Non-web applications | Patterns' gates read Chromium's accessibility tree. Statements still apply to an engine or native interface; gates do not. Open ([question 8](#9-for-the-owner)) |
| The skill is one more description in a full listing | One skill; a description under 300 characters; step 0.5 can cancel it |
| Panel cost | One panel per cause, not per screen. The person sets the budget |
| Ideas taken from a private source | Only the ideas. The bench uses an invented domain and invented data |

## 9. For the owner

Each recommendation is for the owner to decide.

1. **One proposal or several.** *Recommendation: keep this as the frame, and move each part into
   the proposal that owns it once you have ruled:* customizing and statuses into Patterns, the
   panel and the card into Design Decisions.
   **Decided 2026-11-14: agreed.** Each part moves once its own question is ruled on.
2. **Layering or forking.** **Decided 2026-11-14: forking.** The owner: a pattern is a copy,
   and something managed centrally would be a component. A copy lets a person or an agent look
   at what changed upstream and take it after review, where layering could change a product
   unexpectedly. The first draft recommended layering; [5.1](#51-customizing-a-default) is
   rewritten. One point followed from it: whether a product that changes nothing names the
   defaults at a version, or copies the whole set when it starts. **Decided 2026-11-14: it
   names them at a version.** A new version is then the only way an unchanged default moves,
   and a product's copied patterns are exactly what it changed.
3. **Who owns the result-state patterns.** *Recommendation: AFD, as a default set every library
   names.* This answers Patterns' question 4 for these patterns only.
   **Decided 2026-11-14: agreed.**
4. **Which opinions move out of the contract.** *Recommendation: all four in
   [5.3](#53-default-opinions-move-out-of-the-contract).* The suggestion question and the
   philosophy page are separate and yours.
5. **Whether a panel may answer provisionally.** *Recommendation: yes, never the author of the
   change, and never for release.* Design Decisions says agents do not answer review items.
   **Decided 2026-11-14: agreed.**
6. **The triggers and their numbers.** *Recommendation: the five triggers in
   [5.5](#55-review), a panel of five, and a person asked on a 3 to 2 split.* The numbers are a
   starting point, not a finding. **Decided 2026-11-14: agreed.**
7. **The bench application.** The owner ruled out building on the todo example on 2026-11-14:
   it is out of date and has no approval, undo or plan ([section 2](#loam-and-the-skills)).
   The bench is a new specification. *Recommendation: an invented domain whose jobs need every
   pattern in [5.2](#52-the-default-pattern-set).* Which domain is yours to choose.
   **Decided 2026-11-15: a seed library,** as the [bench specification](bench.md) describes.
8. **Non-web applications.** Whether statements without gates are enough for an engine or a
   native interface, for now.
9. **The skill.** *Recommendation: one skill with a reference per topic, written only if step
   0.5 shows it helps.* Its name is open; `afd-design` fits the existing names.
10. **Design to Code.** Retire it, or rewrite it around the rendered screen.
11. **The jobs.** Cut, add and rank the fourteen jobs of the first draft. The owner asked for
    a proposal on 2026-11-14. **Decided 2026-11-14: the [rank](#rank) as proposed,** with
    job 3 merged into job 2, job 11 folded into job 10, job 13 deferred and job 15 added.
    Ranks 1 to 5 are the first slice.
12. **Phase 0.** Whether to run it, and its budget. **Decided 2026-11-14: run it.** The budget
    is in the [bench specification](bench.md) (step 0.0). **Decided 2026-11-15:** the sessions
    run on Opus 5.5 at `medium` on a second machine of the owner's, draw on its subscription
    allowance, and take no more than a fifth of a week's allowance in any one week. The owner
    confirmed the rules for "go" on 2026-11-21.
13. **Where the parts live.** Raised 2026-11-16 by a review of what FAST-AF added for AFD.
    **Decided 2026-11-16:** the owner set the test in [5.10](#510-where-the-parts-live), asked
    for this amendment, and asked for the plan as an epic and to start it
    ([#1385](https://github.com/lushly-dev/afd/issues/1385)). Three of its calls are the plan's
    position and stay open to change until their step starts: the runtime's `@command` goes
    entirely rather than staying for interface operations; its scoped mixin and registry
    builders go; and the library's result-state pieces take plain properties. The first two were
    carried out on 2026-11-17 ([#1398](https://github.com/lushly-dev/afd/pull/1398)).
    **Decided 2026-11-24,** after a comparison with
    [UI SDK](#a-published-design-to-compare). The question put: "Should an agent inside an AFD
    app see and fill what is on screen (labels, values, choices), or only call commands and
    switch panels as today? I recommend the first, through `afd-view-state` with UI SDK's
    snapshot as the reference, and still no actions declared by components." It gave its
    confidence as "high on refusing component actions, medium on how far the snapshot should
    go." The owner: "Agree, I think that fills a nice gap and shoehorning it in with some other
    command/ui layer is not ideal." The reply does not say which layer it would be shoehorned
    into, or how far the snapshot goes, so both stay open: where the code goes, in
    `afd-view-state` or in a layer of its own, and how much of the screen an agent sees
    ([5.10](#510-where-the-parts-live)).
    **Clarified 2026-11-24.** Told that the reply did not say which layer was meant, the
    owner: "Re question 1 (own layer): I was just saying that a system designed to allow an
    agent to edit controls and their content is better than what AFD might have done without
    the feature which would have been a work around; something like have a commands(s) that
    helps set values then some code in the UI that applies it. It was just making a case that
    we should have a proper path to allow the UI on AFD to be manipulated by an agent (fields
    updated, etc).." The session reads that as a case for a designed path in place of a
    workaround, which names no layer. On that reading the
    [Controls proposal](../../active/controls/controls.proposal.md) places the code itself, as
    commands of its own inside `afd-view-state`, and put how much of the screen an agent sees
    to the owner as its question 4. The owner approved that proposal on 2026-11-24, agreeing
    with all six of its recommendations.

## 10. Out of scope

- Publishing any unit.
- Research with people. The loop proposes it; a person authorizes it.
- Measuring outcomes with real users in production.
- Token names, scales and derived values, which are Scales'.
- Journeys across several products.
- An agent inside a product acting for its user. Approving a change to an interface does not
  authorize that.
