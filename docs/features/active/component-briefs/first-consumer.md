# Component Briefs: first consumer (step C5)

The record of step C5 of the [proposal](./component-briefs.proposal.md): the repository's agents
given the real `components` plugin, what that costs, one real Loam change made with it, and phase 0's
tasks run again against it. Section 10's criteria 9 and 10 are judged from it in the
[status](./STATUS.md#the-exit-criteria-steps-c4-and-c5).

## Status

- **State:** run and recorded 2026-11-12, on branch `lush/components-first-consumer` from `main` at
  `047268ab`.
- **Verified:** every number below is printed by a script committed here, from data committed here,
  or is a command's output quoted with its date. `node first-consumer/measure.mjs` prints the setup's
  cost; `node prototype/summarize.mjs first-consumer/results.json` the rerun's table;
  `node first-consumer/sessions.mjs report first-consumer/sessions.json` what each session did with the
  plugin and what its page used.
- **Not reproducible from this repository:** the two data files themselves, as in phase 0:
  [`results.json`](./first-consumer/results.json) is what `summarize.mjs --json` printed from the 30
  runs' records and [`sessions.json`](./first-consumer/sessions.json) what `sessions.mjs collect`
  printed from their streams and pages. The raw sessions, pages and the three Loam sessions' streams
  were kept outside the repository and are not committed.
- **Not verified:** whether an agent used a brief's statements (usage, accessibility, rules), which a
  page does not show; the reviews' cost, which the review script does not record.

## The setup and its cost

`node scripts/umbel-components.mjs` is the `umbel` server in the root `.mcp.json`. Each start writes
`.umbel/components/umbel.toml` (the `components` plugin alone), exports `violet-elements`' pack into
space `main`'s override with `specimen pack-export`, and execs `umbel-first-party serve --stdio`. It
builds nothing, and it does not start when the export fails. The
[plugin's README](../../../../endpoints/umbel/plugins/components/README.md#use-in-this-repository) has
the steps.

| Cost | Measured 2026-11-12 on the shared 10-core Mac |
| --- | --- |
| Build | `cargo build --locked --release -p umbel-first-party` with `CARGO_BUILD_JOBS=4` into the shared target directory, cold: 318 s until it failed (below), then 165 s after the fix, about 8 minutes under a load of 11 to 30. It adds 1.3 GB under `release/`. `pnpm build` for Specimen's CLI is already part of any session |
| Binary | 51 381 776 bytes (49.0 MiB) release; the debug build is 126 MiB |
| Start | From spawning the launcher to the server's `initialize` answer: median 884 ms (707 to 2 109 ms) of five, the export 0.6 to 0.9 s of it, under a load of 25 to 27 |
| A session | 8 tools in `tools/list` (9 633 bytes): the host's five `afd-*` meta-tools, `workspace-show`, `event-list` and `components-brief`. Claude Code 2.1.321 defers MCP tools, so each session that briefed first spent one `ToolSearch` call loading the tool (15 of 15 rerun sessions) |
| A call | `components-brief` on step 0.1's four pages, release build: median 53 ms (8 tags) to 129 ms (22 tags), five calls each; 251 to 593 ms with the debug build. 32 407 to 39 319 bytes an answer |

**A build fault, fixed here.** `cargo build -p umbel-first-party` did not compile: the `umbel` crate's
`auth` feature uses the `http` crate's types (the gateway, the HTTP layers) without enabling
`dep:http`, and every build until now enabled it through another feature (`mounted`, `testkit`) that
the workspace's other members unify in. `auth` now names `dep:http`.

## The Loam change

The change: the Loam console's first read showed only "Loading…", where
[design.md's States table](../../../../endpoints/loam/docs/design.md) asks a loading state for a
progress indicator. [#863](https://github.com/lushly-dev/afd/issues/863) is the same gap in the
projects section, which cannot take it: its chunk is at 44 818 of 45 000 bytes. The console's has
room (83 605 of 91 222).

Three sessions, each Sonnet 5.5 at medium effort through `claude -p` in this checkout with the
repository's `.mcp.json`, project settings, and the same task text, which asked for "that progress
indicator, following Loam's design rules" and did not name the plugin:

| Session | What it was given beyond the task | Brief calls | What it made | Tokens, cost |
| --- | --- | --- | --- | --- |
| 1 | design.md's new section and the skill's | **0**. It grepped design.md for "progress", "loading" and "console" and read `violet-progress`'s `.d.ts` and built JavaScript | An indeterminate `violet-progress label="Loading"` beside the text | 479 321 in, 4 835 out; $0.16 |
| 2 | The same, and a row in AGENTS.md's "Read first" table | **0**. It loaded `loam-design`, whose new section says to brief first, and still read the `.d.ts` | The same, hidden under reduced motion; the console chunk 88 299 of 91 222 | 477 927 in, 5 012 out; $0.22 |
| 3 | The same, and one sentence: "Before you write, brief on the components the change touches, as AGENTS.md says." | **1**, after one `ToolSearch`: `{"tags":["violet-spinner"]}`, 4 826 bytes, nothing shed | A decorative `violet-spinner size="sm"` beside the text, in the row Run and Refresh use; the console chunk 83 700 of 91 222 (95 bytes more) | 298 979 in, 3 177 out; $0.19 |

Session 3's change is the one committed, with a Specimen fixture added by hand (`ConsoleLoading`, the
console holding its first read, captured in every theme and density by the Chromium suite). It chose
the spinner before it briefed (the console already imports it, so the chunk grew 95 bytes where session 2's `violet-progress` added 4 694) and
briefed only on it, not on `violet-progress`, which design.md's Loading row names.

What the brief gave that the session used: `decorative` and why (visible text already says it is
loading, `spinner.decorative` and the shared rule `a11y.decorative`), `size`'s three values, and the
reduced-motion statement, which with design.md's "never a spinner alone" let it keep the text. What
it left out or got wrong, for Loam:

- **The import.** `import: "@lushly-dev/violet-elements"` with the rule `import.root`. Loam deep-imports
  each component (design.md, Iconography); the root would load the whole library into a chunk. The
  session already had the import, so it did not matter here.
- **`theme.install`.** The rule says to install the library's theme; Loam supplies the tokens through
  its own theme and must not. Not acted on.
- **Private CSS properties.** Its three `cssProperties` are `--_spinner-size`, `--_spinner-stroke` and
  `--_spinner-track`, which no consumer may set: bytes with no use (criterion 2's option 2).
- **No role.** `gaps` says no role was observed; the role (`img`, named by `label`) is in an `authored`
  accessibility statement only (B4's open follow-up on roles in shadow trees).
- **A statement the change did not act on.** `spinner.status`: "Announce when loading starts and ends
  with text in a status region of your own". The console's "Loading…" line is not a live region; the
  region's `aria-busy` is what it had before, and the change leaves that as it was.

**What this says about criterion 9 and the risk "Nobody calls it."** The tool is reachable: every
session connected to it. But the design record, the skill and the routing table did not get it
called. A deferred MCP tool is out of sight until a task names it; the rerun's sessions, told to call
it, all did. One sentence in the task was enough.

## Phase 0's tasks, rerun

Run 2026-11-12 with [`first-consumer/run.mjs`](./first-consumer/run.mjs): phase 0's harness, its three
tasks, preamble and acceptance checks unchanged, five runs a task and arm, Sonnet 5.5
(`claude-sonnet-5-5`) at medium effort with the same tools. **Arms:** a, today's route, unchanged; and
c, phase 0's "brief before writing", with the stand-in script replaced by the real plugin over MCP
([`arms.json`](./first-consumer/arms.json)), served by the launcher above from a workspace of its own
per slot with the release build. Arms b, d and e were not run: b is a file, not the plugin, and d and
e need `components-check`, which phase 0 left out of phase C. Arm a was run again because the base
moved from `cfb70942` to `047268ab` and arm c had to be compared with today's route on the same one.

**The checkout.** Each session ran in a worktree of a repository holding one commit: `047268ab`'s tree
without `docs/features/active/component-briefs/`, so neither the tasks and checks nor what is counted
could be read, in the tree or in its history (`git grep` for the tasks' text found nothing else).
Every session wrote its page and changed no other file. The pilot of one run each (t1, a and c) used
the procedure unchanged and is counted.

**Scoring** as phase 0: `prototype/evaluate.mjs` in this checkout (calibration found the same four
undeclared attribute uses as phase 0) and `prototype/review.mjs`, a blind reviewer per page.

| Arm | Score of 75 | Complete | Mounts | Accessible | In manifest | Taxonomy | Median tokens (range) | Median tool calls (range) | Cost of 15 runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a. Today, at `047268ab` | 63 | 14 | 9 | 11 | 15 | 14 | 293 340 (183 601 to 445 926) | 9 (6 to 14) | $2.83 |
| c. The real plugin | 65 | 13 | 12 | 10 | 15 | 15 | 257 810 (160 940 to 446 751) | 9 (6 to 15) | $2.87 |
| a. Today, phase 0 (`cfb70942`) | 61 | 15 | 7 | 9 | 15 | 15 | 398 723 (265 002 to 566 808) | 10 (6 to 16) | $3.21 |
| c. The stand-in script, phase 0 | 66 | 15 | 11 | 10 | 15 | 15 | 309 151 (264 783 to 489 385) | 7 (6 to 11) | $2.62 |

By the thresholds step 0.1 set:

- **Against the prototype's arm c:** as good (65 against 66) and not costlier (16.6 % fewer tokens).
  More tool calls, 9 against 7, one of them the `ToolSearch` that loads the tool.
- **Against today's route on the same base:** as good (65 against 63), 12.1 % fewer tokens (p = 0.37,
  the permutation test phase 0 used) and the same tool calls: not "cheaper", which needs 20 %, so it
  does not "beat" today's route as the prototype's arm c did (22.5 %, p = 0.17). By task, against arm a:
  t1, the form, 196 945 against 307 502; t2, the dialog page, 359 710 against 301 857; t3, the browser
  page, 246 817 against 255 372.
- **Today's route got 26 % cheaper** between the two runs (398 723 to 293 340) with the same task text
  and model name. What moved is not separated: the repository (B4 named a component in 59 story files
  and committed the pack, which no arm-a session read), and Claude Code's version.

The scores are swamped by the same two library faults as phase 0's: an open `violet-dialog` failed axe's
colour contrast in 7 of 10 t2 pages, and `tab.syncPresentation is not a function` failed 7 of 10 t3
pages (5 of 5 in arm a, 2 of 5 in arm c; why three briefed pages escaped it was not investigated).

**What arm c did with the plugin** (`sessions.mjs report`): every session called `components-brief`,
16 calls in 15 runs, median 36 926 bytes (34 091 to 39 385), never by `source`; one asked for
`render: "text"` with `maxBytes` 60 000. One first passed bare names (`breadcrumb`, `tree`), which the
plugin refused as `COMPONENTS_INVALID` with a generic suggestion; the session called `components-list`
and briefed again. 4 sessions called `components-list` (11 894 bytes each), none `components-open`.
Arm c read component source 3 times and stories 28 times; arm a 3 and 45.

## What the briefed pages used, against the shedding order

For the 14 pages written from a JSON brief, each fact of the last brief that the page names, by the
same patterns as phase 0's count, now on real answers:

| Section, in the order sections are shed | Offered | Named on the page | Pages naming one |
| --- | --- | --- | --- |
| 1. Examples | 77 (shed from 10 of the 14 briefs) | not visible in a page | |
| 2. CSS properties | 336 | **0** | 0 |
| 4. Declared-only attributes with no finite values | 80 | 6 (8 %) | 4 |
| 5. Usage statements | 327 | not visible | |
| 6. Events | 82 | 3 (4 %) | 3 |
| 7. Form facts and roles | 25 and 25 | not visible | |
| 8. Slots (named ones) | 117 | 5 (4 %) | 5 |
| 9. Rule text | 27 % of the bytes | not visible | |
| 10. Accessibility statements | 166 | not visible | |
| 11. The remaining attributes | 538 | 173 (32 %) | 14 |
| Of attributes with finite values, set to one of them | 28 | 8 (29 %) | 7 |

Agents asked for a median of 7 components and put 7 on the page. The last briefs shed examples (10),
CSS properties (6), usage (1) and one piece (`declaredAttributes`); at about 7 tags a brief mostly
fits whole.

Against the order: attributes are what pages use, and they leave last, which fits. CSS properties,
second to leave, were never named, and examples, first, cannot be seen; neither is evidence against
shedding them early. Slots are named on few pages but leave eighth: this count sees only named slots,
not children put in a default slot (a select's options), so it undercounts them, and it is not enough
to move them. Where the statements and rule text belong is still not shown by a page: they are 48 % of
the bytes (rule text 27 %, usage 14 %, accessibility 7 %).

## What C5's data says about criterion 2

The owner's decision ([What step C4 found](./STATUS.md#what-step-c4-found)); the data, not a choice:

- **The briefs agents actually received were larger than the declarations they replace.** The 14 JSON
  briefs were a median of 113 % of the same components' manifest declarations (55 % to 142 %); none
  was at most half. A 7-tag page fits the default 40 000 bytes almost whole, so the budget does not
  shrink it as it does C4's 20-tag pages.
- **Where those bytes went:** rule text 27 %, attributes 20 %, usage 14 %, accessibility 7 %,
  examples 7 %, CSS properties 6 %, rule ids 5 %, slots 4 %.
- **Option 2 (smaller briefs)** has the most to work on: rule text is the largest part, and private
  `--_` CSS properties are bytes no page used (0 of 336 properties named).
- **Option 3 (a default without CSS properties and examples)** would take about 13 % off these briefs,
  and in this data took nothing a page was seen to use.
- **Option 1 (reset the criterion)** is what the rerun's other number argues: briefs this size still
  cost 16.6 % fewer tokens than the prototype's and 12.1 % fewer than today's route.

## How it was run

- **Sessions.** `claude -p` (Claude Code 2.1.321), project settings, the harness stripping
  `CLAUDE_CODE_*` variables as phase 0's did; arm c with `--mcp-config` naming the launcher and
  `mcp__umbel` allowed, `--strict-mcp-config` for both arms. Five at a time, run by run, task by task,
  arm by arm, on the shared Mac under a load of 12 to 36.
- **The launcher** gained its binary check before the export, and a lock around the export, after
  these runs; they used one workspace per slot, so no two exports shared an override.
- **Cost.** $5.70 for the 30 sessions, plus 30 reviews (not recorded), plus $0.57 for the three Loam
  sessions.
