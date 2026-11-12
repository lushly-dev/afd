# Ideas: status

Read this before the [proposal](ideas.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- What Ideas needs from Umbel is specified in Umbel's own documents, and progress on it is in the
  [Umbel status](../../../../endpoints/umbel/docs/STATUS.md). This file holds the plan's steps and
  points there for the detail; when they disagree, the area's ledger wins.
- The owner's content never enters this repository. A measurement on his corpus is recorded here
  as counts, rates and the tools that produced them. Fixtures and examples are invented.
- **Questions for the owner are queued**, not asked one at a time
  ([the queue](#questions-for-the-owner)). Work goes on past a question that has a
  recommendation, and the row says so. Work stops only at what the owner alone can do or decide.

## Status block

- **State:** active; phase 0 under way. The owner merged the proposal's third revision
  ([#1012](https://github.com/lushly-dev/afd/pull/1012)) on 2026-11-12 UTC, answered the questions
  that stood before phase 0, and directed that the work carry on through its phases, with
  questions queued (the proposal's [section 11](ideas.proposal.md#11-for-the-owner)). Nothing is
  implemented.
- **Last verified:** 2026-11-11 against `main` at `bcc1280f`. The 29 scenario files parse and pass
  the runner's dry-run validation, and every one of the 51 draft commands and 5 error codes is
  used by a job (`afd scenario validate`, and the coverage snippet in
  [`jobs-first.md`](../../../../.claude/skills/afd/references/jobs-first.md)). No code was built
  or run.
- **Done:** the [proposal and plan](ideas.proposal.md) and its [scenarios](scenarios/): first
  version in [#990](https://github.com/lushly-dev/afd/pull/990), and the revision after two walks
  of its paths in [#1012](https://github.com/lushly-dev/afd/pull/1012). Reviews are in the
  [session log](#session-log).
- **Not done:** every step below that is not marked done.
- **Follow-ups:** the [table at the end](#follow-ups-not-yet-issues).

## Steps

The plan's [section 8](ideas.proposal.md#8-phase-0-measure-before-specifying) defines phase 0
and [section 9](ideas.proposal.md#9-steps) the rest.

| Phase | Step | State |
| --- | --- | --- |
| 0 | 0.1 The unit and the types | Run 2026-11-11 by models on the owner's archive ([results](prototype/README.md#01-the-unit-and-the-types)): 28 ideas per 1 000 words; 90% of one extractor's reviewed ideas the right size and 73% of the other's; the common fault is two ideas in one; the seven types held (93% accepted); free tags do not converge. Open: the owner's check of a sample |
| 0 | 0.2 Matching | Run 2026-11-11 on 1 717 model-labelled pairs and eight local models ([results](prototype/README.md#02-can-matching-be-trusted-to-refuse)): refusing cannot be trusted across documents (half the duplicates missed at 2% wrong refusals), offering candidates can (the duplicate in the first five for 91% to 97% with both lanes). Open: the owner's check of a sample of labels, and the model, which is P3's |
| 0 | 0.3 Questions answered from ideas | In part, 2026-11-11 ([results](prototype/README.md#03-can-questions-be-answered-from-ideas)): of twenty questions a model drafted in the owner's voice, retrieval alone answered 10 fully, 9 partly and 1 not at all; lookups work, areas and tensions need relations, dates and syntheses. Open: twenty of the owner's own questions |
| 0 | 0.4 Review load, and whether attested can be trusted | In part, 2026-11-11 ([results](prototype/README.md#04-the-sentence-rule-and-attested-in-part)): 23% of sentences lack a terminal mark, 83% of them list items; on the 12 sources two extractors both read, 61% of one's ideas and 93% of the other's are his words, word for word; 8% to 22% of those lean on their neighbours. Open: what the owner would disown, and the length of a sitting, which need him |
| 0 | 0.5 Themes | In part, 2026-11-11 ([results](prototype/README.md#05-do-derived-themes-group-ideas-as-the-owner-would-in-part)): themes derived by a nearest-neighbour graph put seven in ten ideas in a theme, never one giant theme, and most join several documents; they agree across methods and models above chance but far from fully (adjusted Rand index 0.06 to 0.49, most pairs 0.13 to 0.49), so a theme is a view, not an identity. Open: whether they match the owner's grouping (part 4 of Q5) |
| 0 | 0.6 Framings in Violet | Done 2026-11-11 on invented ideas ([results](prototype/violet/README.md)): seven of fifteen checks work as they are, 3 000 ideas load in about a quarter of a second; every P7 gap is confirmed, and two more found: an omission cannot be undone, and rules report and do not refuse |
| 0 | 0.7 Records or documents | Done 2026-11-11 ([reasoning](prototype/README.md#07-records-or-documents)): records, indexed through P2, as question 2 recommends |
| 0 | 0.8 The owner's walk of the jobs | Not started |
| 0 | 0.9 Confirming from the owner's harnesses | Not started; needs the owner at a harness |
| 0 | 0.10 Finding the store with no skill | In part, 2026-11-11, on paper ([probe](prototype/discovery/README.md)): with the three Ideas commands and `memory-remember` first-class, both models tried routed 24 of 24 everyday requests right; without `memory-remember`, requests to remember went to no tool. Open: real harnesses against a hosted instance |
| A | A1 P1 as amendments to Umbel's architecture and decision log | Not started |
| A | A2 Host specifications for P2, P3 and P15 to P18 | Not started |
| A | A3 The plugin's specification, with the scenarios moved beside it | Not started |
| A | A4 P14 and the relay part of P15 as AFD changes | Not started |
| B | Matching in the host | Not started |
| C | C1 to C5, the loop, hosted | Not started; C1 needs the first instance (question Q1) |
| D | D1 to D5, the rest of the slice | Not started |
| E to G | The hierarchy: specification, engine and host, the plugin whole | Not started; waits for the owner's answer on whether it is wanted |
| H | After the exit | Not started |

## Questions for the owner

Kept in the order they will be needed. A row leaves this table when it is answered, and its
answer is recorded in the proposal's section 11 and in the session log.

| | Question | Recommendation | Needed by | State |
| --- | --- | --- | --- | --- |
| Q1 | The first instance: which machine it runs on, which authorization server it signs in through, and which directory on that machine holds the first archive | One machine with the embedded store and a persistent disk (agreed). The other two have no recommendation yet; one is due with the plugin's specification, step A3 | Step C1's hosted exit. The loop is developed over stdio until then | Open |
| Q2 | Confirm, or overturn, the answers taken on recommendation: questions 1 to 6, 8, 9, 12, 13 and 15 of the proposal's section 11 | Each as the proposal recommends | Nothing waits on it. Each is settled for good when the specification that depends on it is approved | Open |
| Q3 | Scope of P9 to P12: this plan's last phase, or plans of their own | None yet | Phase H | Open |
| Q4 | The phase 0 corpus. The one chosen is an archive of his writing and research in his private repository. It may not stand for what his own instance will hold. Confirm it, or name another corpus to run again | Keep it for phase 0: the questions are about the shape of writing, not its subject. Run 0.1 and 0.2 again on another corpus when he names one | Nothing waits on it | Open |
| Q5 | Check, in one sitting, samples of what models decided in phase 0: about 40 idea pairs labelled same, related or distinct, about 40 extracted ideas judged for size, about 40 of his own sentences taken as ideas, each to keep or disown, and five derived themes, each to accept and name | The samples are drawn and kept with the corpus | Settling the thresholds in the host's matching specification (step A2) and the attested rule in the plugin's (step A3) | Open |

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-11 | Jobs-first process | `afd scenario validate` only parses, and there is no command for coverage against a command list, so the check is a library snippet. No CI job reads scenario files under `docs/` | Open. Part of P14 (step A4) |
| 2026-11-11 | Second walk | The runner resolves a step reference only in a step's input, so no expectation can use one | Open. Part of P14 (step A4) |
| 2026-11-11 | Independent review of the revision | The last set of fixes in #1012, after the focused pass, had no independent pass | Open. The plugin's specification (step A3) re-reads every command, and its review covers them |
| 2026-11-11 | Phase 0, step 0.2 | Matching offers candidates and a model judges; the engine refuses on its own only above a threshold that never refused wrongly in phase 0. This changes the plan's section 4.4 and measure 1 | Proposed for the plugin's specification (step A3) and the host's matching specification (P3, step A2) |
| 2026-11-11 | Phase 0, step 0.2 | A static embedding model (`potion-base-8M`) gave about a third of the meaning lane's gain, within noise, with no inference runtime; transformer models gave the rest. Which one, and whether the host needs an inference runtime at all | For the host's matching specification (P3, step A2) |
| 2026-11-11 | Phase 0, step 0.1 | Free tags scatter (729 of 1 656 used once). The pack should hold the tags in use and offer them | For the plugin's specification (step A3), with job 27 |
| 2026-11-11 | Phase 0, step 0.4 | A word-for-word idea can lean on the sentences around it, so a read of an attested idea should be able to return them; and two ideas in one is the extractor's most common fault | For the plugin's specification (step A3) and the extraction prompt |
| 2026-11-11 | Phase 0, step 0.4 | Whether a source is a transcript cannot be read from its text: labelled fields take turns as speakers do. The plan already makes it a setting | Confirmed; nothing to change |
| 2026-11-11 | Phase 0, step 0.10 | Question 12's recommendation is reversed by the probe: keep `memory-remember` first-class and leave `workspace-show` and `event-list` out. Recorded in the proposal's section 11. The instruction to call `ideas-guide` first led one model to call it before every request | For the plugin's documentation of `mcp.first_class_tools`, and the instructions paragraph (step A3) |
| 2026-11-11 | Phase 0, step 0.6 | P7 gains two items: releasing an omission (Violet's reset of a subtract does nothing, `resolver.ts`), and rules that can refuse a write | For the hierarchy specification (P7, step E1), if the owner wants the hierarchy (question 14) |
| 2026-11-11 | Phase 0, step 0.3 | Two link kinds the plan lacks: a later view of an earlier idea, which a model may state without retiring anything, and part of. A bundle should carry each idea's date | A lead from one judge on model-drafted questions, whose list of kinds differed from the plan's. To confirm on the owner's twenty questions with the plan's list before section 4.5 changes |
| 2026-11-11 | Phase 0, step 0.5 | Themes change with the method and the model, so a synthesis names its member ideas and never a theme, and each embedding model needs its own similarity floor | For the plugin's specification (step A3); consistent with the plan's section 4.7 |
| 2026-11-11 | Phase 0, step 0.3 | A third of a retrieved bundle is off the question. A rerank by the calling model, or a budget by kind of question, is to be tried before the bundle is specified | For the plugin's specification (step A3) |
| 2026-11-11 | Phase 0, step 0.1 | Extraction prompt version 2 adds tests for one idea and for standing alone | Done 2026-11-11 ([results](prototype/README.md#01-the-unit-and-the-types)): with Opus 5.5 it gave 39 of 40 ideas the right size against 38 and 22 for the earlier extractors, and 27% word for word against 55% and 89%. Which extractor and prompt the loop uses, and how attested trades against ideas that stand alone, are for the plugin's specification (step A3) |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-11 | Design discussion with the owner | The proposal and plan written against `main` at `8ef7aa68`, with twenty jobs as AFD scenarios, and merged as [#990](https://github.com/lushly-dev/afd/pull/990). Revised twice the same day on the owner's direction before that merge: matching by meaning, a thin slice first, review by use, themes, a hosted instance, and jobs as the benchmark |
| 2026-11-11 | The walks | Three fresh readers walked the plan's paths from three seats and found seven faults that broke a job. The owner agreed five decisions. The revision added jobs and commands, so three new readers walked it again and found faults in what the first walk had produced, four of them wrong claims about the host; each host claim was then checked in the host's code at `069af7b6`. An independent review found six blockers and eighteen improvements, all fixed, and a focused pass found one more contradiction, also fixed. Merged by the owner as [#1012](https://github.com/lushly-dev/afd/pull/1012): 29 jobs, 369 steps, 51 draft commands |
| 2026-11-11 | The owner's answers | The owner confirmed the second walk's changes, answered questions 7, 11 and 14 as recommended, and directed that the work carry on through its phases with questions queued. Recorded in the proposal's section 11. The feature moved from `proposed/` to `active/`, and this file was written |
| 2026-11-11 | Phase 0, steps 0.1, 0.2 and part of 0.4 | Tools written in [`prototype/`](prototype/README.md), with tests on invented fixtures. Run on the owner's archive of 107 files, which stays in his private repository: a census, the sentence rule, extraction by two models (3 701 ideas), a review of 212 of them, 1 717 pairs labelled for matching, and eight local embedding models scored. Only counts are recorded here. Every judgment was a model's; the owner's checks are queued (Q5). The Fable subagents hit a spend limit part way through labelling; their finished labels were kept and the rest done by Claude Opus 5.5 |
