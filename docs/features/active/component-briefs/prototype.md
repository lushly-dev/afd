# Component Briefs: prototype record (step 0.2)

The record of the phase 0 experiment in the
[proposal](./component-briefs.proposal.md): 75 page-building sessions, with
and without a brief, scored by the rules fixed in
[`baseline.md`](./baseline.md) before any of them ran.

## Status

- **State:** run and scored 2026-11-09 on `main` at `cfb70942`.
- **Verified:** every number in [Result](#result), [How sure this is](#how-sure-this-is)
  and [What the briefed pages used](#what-the-briefed-pages-used) is
  printed from the two data files committed here.
  `node prototype/summarize.mjs prototype/results.json` prints the table,
  which arm beats which and the rule that decides.
  `node prototype/sessions.mjs report prototype/results.json prototype/sessions.json`
  prints the differences between arms with their p values, the medians by
  task, the faults, what each arm did with its material and what the pages
  used. All 75 sessions wrote their page and changed no other file. Every
  arm used what it was given: 15 of 15 runs read the pack (arm b), called
  the brief (c, e) or ran the check (d, e).
- **Not reproducible from this repository:** the two data files themselves.
  [`results.json`](./prototype/results.json) holds what `summarize.mjs --json`
  printed from the 75 runs' records, and [`sessions.json`](./prototype/sessions.json)
  what `sessions.mjs collect` printed from their streams and pages, both
  formatted as the repository's lint requires. The raw
  sessions and pages are kept by the author outside the repository. Step
  0.3's first three answers came from running the library's stories in the
  built checkout the runs were scored in, and need one to print again.
- **Printed by scripts step C4 deleted:** the pack's counts and bytes by
  `prototype/build-pack.mjs`, and a brief's bytes by the `brief.mjs` it
  wrote, called with a task's components. Step C4 deleted the hand-built
  pack's sources (`build-pack.mjs` and `guides/`) and the two stand-in
  scripts (`brief.template.mjs`, `check.template.mjs`) on 2026-11-11, once
  Specimen built the real pack and Umbel served it; they are in the history
  at `fdfd4874`. The tasks, their acceptance checks and the harness stay
  for step C5. Still printed here: step 0.3's fourth answer by
  `prototype/unknowns.mjs forms`. The 475 bytes a component and the
  percentages of the declarations are arithmetic on those and on
  `baseline.mjs`.
- **Not verified:** the two library faults named below were seen in these
  runs and not investigated. The taxonomy reviewer's two findings were not
  checked by a person.
- **Step 0.3:** done the same day, [below](#step-03-the-four-unknowns),
  except the macOS against Linux half of the third unknown.
- **Decision (step 0.4):** the owner decided go on 2026-11-09.

## Result

By the rules fixed beforehand, the outcome is rule 3: **go, the brief as
planned**, and `components-check` does not join phase C.

| Arm | Score of 75 | Complete | Mounts | Accessible | In manifest | Taxonomy | Median tokens (range) | Median tool calls (range) | Cost of 15 runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a. Today | 61 | 15 | 7 | 9 | 15 | 15 | 398 723 (265 002 to 566 808) | 10 (6 to 16) | $3.21 |
| b. Whole pack as a file | 62 | 14 | 10 | 8 | 15 | 15 | 517 266 (396 738 to 1 076 623) | 8 (7 to 13) | $6.12 |
| c. Brief before writing | 66 | 15 | 11 | 10 | 15 | 15 | 309 151 (264 783 to 489 385) | 7 (6 to 11) | $2.62 |
| d. Check after writing | 63 | 15 | 9 | 10 | 15 | 14 | 467 528 (336 257 to 723 047) | 9 (6 to 13) | $4.03 |
| e. Both | 65 | 14 | 12 | 10 | 15 | 14 | 310 019 (183 584 to 608 933) | 8 (5 to 15) | $2.94 |

Each check column counts the runs of 15 that passed it. Tokens are a whole
session's input, cache writes and reads included, plus output.

Which arm beats which, by the thresholds: c beats a, b and d; e beats a, b
and d. Nothing else beats anything. Each of those is "as good and cheaper":
no arm is better than another on acceptance by the 8 points the threshold
asks.

## How sure this is

Less sure than "go" sounds.

- **The saving is real in direction and thin in evidence.** The brief used
  22.5 % fewer tokens than today's route at the median, against a threshold
  of 20 %, and three fewer tool calls. With 15 runs an arm, a permutation
  test on the medians gives p = 0.17: a difference this large would turn up
  by chance about one time in six. By task, the brief was cheaper on the
  form (266 000 against 399 000) and the dialog page (434 000 against
  553 000) and slightly dearer on the browser page (305 000 against
  290 000).
- **The brief did not make pages measurably more correct.** 66 against 61
  is inside "as good". The one place the arms clearly differed is the form:
  3 of 5 pages written from today's sources failed an assertion their own
  author wrote about how a control reports its value, and none of the 15
  written from a brief or the pack did.
- **Two checks were swamped by faults in the library, not in the pages.**
  24 of the 25 pages with a dialog open failed axe's colour-contrast rule
  once settled, in every arm. 21 of the 25 pages with tabs logged
  `tab.syncPresentation is not a function`, in every arm, with all three tab
  modules imported. Those 45 failures tell the arms apart by nothing, and
  they cap every arm's score.
- **What is solid.** Handing an agent the whole pack as a file is worse
  than today: 30 % more tokens (p = 0.03) and nearly twice the cost. A brief
  costs 40 % less than the whole pack (p < 0.001). A check alone does not
  beat today's route.

## What the briefed pages used

Step 0.2 was to record which sections of a brief an agent used. A session
does not show what an agent read of an answer, so this counts what its page
names instead: for the 30 pages written from a brief (arms c and e), each
fact of the brief that appears in the page's source.

| Of the briefs | Offered | Named on the page | Pages naming at least one |
| --- | --- | --- | --- |
| Attributes | 1 381 | 394 (29 %) | 29 of 30 |
| Attributes with a fixed set of values, set to one of them | 222 | 62 (28 %) | 29 of 30 |
| Slots | 462 | 28 (6 %) | 19 of 30 |
| Events | 171 | 10 (6 %) | 10 of 30 |
| Import paths | 264 | 0 | 0 of 30 |

An agent asked for a median of 8 components and put 7 of them on its page.

How far this goes:

- **It is a rough count by pattern, mostly an undercount.** It sees markup
  and elements created in code and held in a variable, for the components
  the agent asked a brief for. An attribute set any other way is missed.
- **It says nothing about statements.** Whether an agent used a usage
  statement, an accessibility statement or a shared rule does not show in
  its page.
- **Import paths were no use here by construction.** The tasks' pages sit
  inside the library and import by relative path.
- **For the order sections are shed in:** attributes are used far more than
  slots and events, which fits attributes leaving last. Where statements
  belong in that order is not tested. Step C5 checks it on real briefs.

## What it means for the plan

| Finding | Consequence |
| --- | --- |
| A selected brief beats the whole pack by a wide margin | Selection earns its place. This is evidence for the owner's second question, with a limit: the arm ran a local script, so it shows that selecting matters, not that Umbel must do it |
| The size target does not hold | With guidance as actually written (475 bytes of statements a component, and 26 shared rules), a brief was 30 % to 42 % of the same components' declarations, not a fifth: 14 694 bytes for the form's 7 components, 11 055 for the dialog page's 7, 13 517 for the browser page's 11. Exit criterion 2 is reset to "at most half", or the guidance is cut |
| The default budget is too small for twenty components | At about 1 500 bytes a component, 24 000 bytes holds 14 to 16 in full; a twenty-component page would shed sections. A default of 40 000 holds it. The maximum of 96 000 still holds a whole library at the floor, not with guidance for all 77 |
| `components-check` did not help | It stays in phase D. Every page in every arm already passed the manifest check, so there was nothing for it to catch on these tasks |
| Agents called the brief about twice a run | Once to list tags and once for the page (33 calls in 15 runs). `components-list` is part of the loop, not an extra |
| A real pack would say more than this one | 46 attributes got finite values by a script reading type aliases; the manifest gives 6. The FAST-AF plugin's schema is where a real pack gets them |

## Step 0.3: the four unknowns

Run 2026-11-09 with `prototype/unknowns.mjs` on the library's own 407
stories, all of which passed, in the same built checkout.

| Unknown | Answer | Numbers |
| --- | --- | --- |
| 1. Can a role in Specimen's ARIA snapshot be tied to one component's element? | **Not dependably.** The snapshot is one string for the page | By pairing the nth node of a role with the nth element that could own it: 241 of 450 component instances tied (54 %), 112 with no role of their own to tie (25 %), 97 with a role and no way to tie it (22 %). 38 of 77 components tied in every instance. 15 stories have an empty snapshot, among them the plain checkbox, switch and radio-group overviews and the decorative variants. So, in the runs, did any page with a modal dialog open; Specimen fixed that case afterwards (#915), and this was not run again. Five components set a role through `ElementInternals`, which no attribute shows |
| 2. Does markup taken from a mounted story reproduce it? | **For about three in four** | Each story's light DOM, mounted again with no play: 313 of 407 gave the same ARIA snapshot and the same component attributes (77 %). 193 of 219 stories with no play (88 %); 120 of 188 with one (64 %). Not reproduced: mostly components fed by properties, led by data grid (21), gantt (16), the foundations pages (13) and file explorer (9) |
| 3. Are observations byte-identical between builds? | **Not quite on one machine; untested across systems** | Two passes on this Mac: ARIA snapshot identical in 406 of 407 stories, normalized DOM in 401, every element's attributes in 392. What differs: generated `id` values (8 stories), object URLs, and one carousel story whose state depends on timing. macOS against Linux was not run: it needs a branch pushed and a workflow run |
| 4. Which form of answer costs least? | **Text, by about 30 %** | For the three task pages, against a basis on every fact (16 626, 12 101 and 14 753 bytes): a basis per section is 85 % to 87 %, and quoted text is 67 % to 73 % |

What follows for the plan, now written into it:

- Roles are observed only once Specimen records each element's computed
  role and name (a new step, B2a). Until then they are authored.
- The build mounts each example again and leaves out any that differs.
- A record takes declared attribute states only, and a case that differs
  between two passes contributes nothing. The cross-system test moves to
  step B3's exit.
- The JSON answer states its basis per section; text is the form to inject.

Unknown 1's rule is a count, with a rough table of the roles native elements
carry, so its 54 % is an estimate of what a simple rule achieves, not a
ceiling.

## What the runs showed about the library

Seen while running, and worth their own issues; none is filed.

- An open `violet-dialog` fails axe's colour-contrast rule once settled, on
  its title, text and footer buttons. The library has no story that opens a
  dialog at mount, which is why its own stories do not show it.
- `violet-tabs` calls `syncPresentation` on a tab that does not have it yet
  (`src/tabs/violet-tabs.ts`, about line 362), in most pages that build
  tabs from markup.
- From the guidance author's reading of the source, not run: `violet-button`
  with `type="submit"` does not submit an enclosing form; `violet-menu`'s
  documented fallback to its trigger's text does not exist; the manifest
  lists no events or slots for select, option, option-group, combobox and
  listbox; the tabs module does not register tab or tab-panel.

## How it was run

- **Sessions.** `claude -p` with Sonnet 5.5 at medium effort, project
  settings only, no MCP servers, no subagents or web tools; file edits
  accepted, and shell limited to `node`, `ls`, `cat`, `grep`, `rg`, `find`,
  `head`, `tail`, `wc`, `sed` and `git`. Each session started in a worktree
  reset to `cfb70942`, which held neither the tasks nor the checks. Each
  arm's material sat in a directory of its own outside the worktree, and a
  session was told only its own arm's path. That is not a wall: `cat` and
  `node` can read any path on the machine, so a session could have reached
  another arm's material had it looked for it. By the author's check of the
  raw streams, none of the 674 tool calls names a path of another arm or of
  the held material; a reader cannot repeat that check from this
  repository. `sessions.json` shows the weaker thing: by file name, no
  session read the pack, called the brief or ran the check unless its arm
  was given it.
- **The pack.** `prototype/build-pack.mjs` (deleted at step C4; see the
  status above): the API of all 77 components
  from the manifest, and guidance for 38 from `prototype/guides/`, written
  by an agent that read only the library and was shown neither the tasks
  nor the checks. 80 654 bytes. The brief and check scripts carry it
  embedded, so an agent given a script could not read it as a file.
- **Scoring.** `prototype/evaluate.mjs` mounts each page in Specimen
  (`bench.run`, with the settled accessibility check) in a built checkout
  and scores checks 1 to 4. `prototype/review.mjs` runs check 5: a fresh
  reviewer per page, given the page under a random name and the taxonomy.
- **Amendments.** Two pilot sessions, not counted, showed where a frozen
  procedure could not be carried out. The changes, all made before the 75
  runs and none depending on the guidance, are listed at the end of
  [`prototype/tasks-and-acceptance.md`](./prototype/tasks-and-acceptance.md).
- **Cost.** $18.91 for the 75 sessions, about $0.25 each, plus the reviews,
  the two pilots and one guidance author.

## Before step C5 reruns these tasks

The tasks and checks are now readable in this folder. Step C5's sessions
must run in a checkout without it, or they can read what is counted.

Step C5 did, on 2026-11-12: arms a and c, in a repository of one commit
holding `047268ab`'s tree without this folder. Its record is
[`first-consumer.md`](./first-consumer.md).
