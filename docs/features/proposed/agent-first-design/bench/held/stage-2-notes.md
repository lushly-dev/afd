# Stage 2: notes after the freeze

Stage 2 (`faults.md`, `fault-proofs.mjs`, `personas/`, `walks.md`) was frozen on 2026-11-18,
`MANIFEST-2.sha256` hashing to
`e293ce7f690b09ecb8af1cd76a957ef25b16ebccc4744cc035a4f9996c3853c4`. As `README.md` says, what was
found after the freeze is recorded here, with what it changes, and the frozen files stay as they
were. Nothing here has run a walk; the first notes are on how the runner builds the walks.

## 2026-11-18: how the walk tools are built

- **Not through Botcore's `cdp_*` commands.** `personas/README.md` says the runner exposes each
  persona's tools "through Botcore's `cdp_*` commands". Those commands open a new connection
  for each call, keep no viewport or emulation from one call to the next, and cannot click at a
  point, so a walk could not hold the low-vision persona's 320 px window or a pointer's click at
  a point. The tools are an MCP server of the runner's (`lib/walk/persona-server.mjs`) on
  Playwright, which the `cdp_*` commands are themselves built on. What each modality perceives
  and acts with is as the README's table says. **Changes in the results:** none expected; the
  walks are run on this server from the first.
- **Perceiving is free; acting counts.** The sighted modalities get `look`, a screenshot of the
  window without an action, and the screen-reader persona `listen`, which says again what the
  reading cursor is on. The screen reader's reading moves in browse mode (the arrows, and `h`,
  `d`, `l`, `t`, `f`) are how that persona looks, as a screenshot is for a sighted one, so they
  do not count toward the cap of 60 actions either; every other key, click, scroll and typing
  does. After the cap, looking is refused too.
- **Typing is text only.** `type` types printable characters as keys and nothing else, so no
  Enter or Tab rides on it: the pointer personas press no key.
- **The low-vision window** is 320 by 800 CSS pixels, as the table says, drawn at 1.5 times the
  pixels (a 480 by 1200 screenshot): legible, and under the size at which an image is scaled
  down on its way to the model, so a point given in the screenshot's pixels lands where it was
  meant. A wheel scrolls where the pointer last was.
- **The screen reader, as built.** A reading cursor over the accessibility tree in reading
  order, kept on its node, so content added above it does not move it; the containers the
  README names are spoken as the cursor enters and leaves them. In browse mode the arrow keys and
  `h`, `d`, `l`, `t`, `f` (Shift or a capital going back) move the cursor; another letter, or
  typing, has no effect. Enter or Space focuses the element under the cursor and presses the
  key, never a pointer click; on a field that takes typing it only moves focus there and enters
  forms mode, as screen readers do; on what cannot take focus (text, a heading, a disabled
  control) nothing happens. In forms mode every key goes to the control, and Escape returns to
  browse mode. After each acting key it says where focus went (the focused node itself when it
  is a container such as a dialog or a group), a state that changed in place (a box checked), and
  what live regions said. Live regions are heard through an observer of the page, as a screen
  reader hears them: their visible text only, each change as it happens, and a region that
  appears already filled only when it is assertive. The observer watches the page's light DOM; a live region
  inside a component's shadow root would not be heard. The reference build has none.
  **Superseded 2026-11-21:** it has one, the month heading of the calendar inside T4's date
  picker. The observer now watches every shadow root, open or closed, from the moment it is
  attached, and reads a region's text through its slots (`test/live-shadow.mjs` in the runner,
  which fails on the old observer). The scripted walks give the same results on both builds.
- **Checked with no model:** each walked job was done through each modality's tools by a script
  (`test/walk-e2e.mjs` in the runner), on both builds, at the real cap. On the clean build all 16
  modality and screen pairs finish their job with nothing failed, repeated or outside the steps,
  in at most 19 actions of the 60. On the
  seeded build the scripted pointer and low-vision walks of T1 to T3 stop at their faults, the
  screen reader still finishes T1 to T3, every sighted modality still finishes T4, and the
  screen reader's scripted T4 stops: the faults reach their own modality only. A script steers
  by the controls' keys, so the keyboard faults, which change only what is drawn, do not stop it.
- **T1's clean path.** Once the member is on the waiting list, the refusal and its substitutes
  give way to the outcome; a substitute is then lent from its own catalogue row, which is still
  `loan-create` for a runner bean, so the path is clean.

## 2026-11-18: how a path is read, as built

- **Each command counts once** in step 0.4's total: as failed if it failed unexpectedly, else
  as a repeat, else as outside the steps. An undo is a repeat only when it undoes something done
  in the walk; one that undoes what was there before the walk is outside the steps.
- **T4 decided one at a time:** the first single approval meets the batch's step and the next two
  are outside it, and the third's refusal is the one the steps expect, so the path adds the two
  commands `walks.md` names. A batch with an inner failure the steps do not expect counts as
  failed.
- **Before any walk,** the runner proves each build it will walk with `fault-proofs.mjs`: the
  clean build with no fault present, the seeded one with all twelve.

## 2026-11-20: the pilot walks

Two pilot walks, both on the clean build, by the owner's word: the quick pointer persona on T1
and the screen-reader persona on T4. Neither counts in a result.

- **Both finished well inside the cap,** with a clean path: T1 in 7 actions and 21 seconds, T4
  in 8 actions and 2.5 minutes (141 turns, its reading moves free), at $0.17 and $0.44 at list
  prices against a line of $1.50. Both ended with "Done."; the runner first read them as
  unsaid, because it looked only at the first 600 characters of the last message. Fixed in the
  runner, and the two records re-read.
- **Dates.** Both personas reported, as a finding, that the screen's dates (the fixture's,
  years ahead) disagree with the date their session is given. The same on every walk and both
  builds; a reader matches it to no fault. **Changes in the results:** none to recall; it is
  one finding of noise per walk.
- **The screen reader's `f` at the bottom.** The T4 persona reported that Shift+f "skipped"
  the last button. The cursor was on that button when the arrow said "Bottom", and Shift+f
  moves to the field before the one under the cursor, as screen readers do. Kept as built.
- **A refusal shows a tick.** The T1 persona read "✓ Not lent" on the pressed Lend as a
  success. The reference build marked every pressed control done with a tick, a refusal's too.
  **Decided 2026-11-21 by the owner: a refusal takes no tick.** Changed in the reference build
  and put under the seeded copy's fault commits, which are unchanged; every proof run three
  times on each build with the same results as at the freeze, the reference 308 of 308, the
  scripted walks 16 of 16 and 9 of 16 as before. **Changes in the results:** none to the faults;
  the pilot T1 walk saw the tick, every counted walk will not.

## Steps 0.3 and 0.4, 2026-11-24

- **T2's clean build left unfinished.** Three of the five personas (both pointer personas and the
  screen reader) took in the rows they could and stopped at the row no variety fits: nothing on
  the screen says what leaving a row out does, so they would not risk it. The reference build is
  left as walked; the gap is a design follow-up, and it is why step 0.4 cannot read T2's pairs.
- **The fixed clock.** The application's clock sits in 2030, and personas compare it with their
  own date: five of the seven sampled findings judged not real by the independent check.
- **Readers and consequences.** The readers left unmatched three findings that were the
  consequence of a click doing nothing (F1 twice, F3 once).
- **Step 0.4's measure.** Faults that change only what a person perceives leave the journal's path
  as it was; personas report them and go round them.

## Walk tuning and confirmation rerun, 2026-11-24

By the owner's decision, the runner was tuned without editing any frozen stage 2 file (both
manifests verify unchanged):

- **App date in the walk prompt.** Each walk's prompt now tells the persona that today's date in
  the application is `9 March 2030` (read from `library.json`) and to judge screen dates against
  it. In the 15-walk confirmation rerun (`step-0.4-tune`), 0 of 15 walks and 0 of 29 other findings
  complained about the fixed clock.
- **Explicit ending line.** Each walk's prompt now asks for `Done.` or `Stopped, because ...` on a
  separate last line after findings, and `ending()` also recognises a standalone `Done.` or opening
  `Stopped` paragraph (all 5 formerly-`unsaid` walks in step 0.3 had put their verdict before their
  findings). In `step-0.4-tune`, 15 of 15 ended on the last line.
- **Direct consequences in the fault reader.** `walkReaderPrompt()` now matches direct consequences
  of a planted problem.
- **Blind report comparison for step 0.4 (`compare-walks`).** Each seeded walk is compared blind
  against its pair's `clean-1` walk in deterministic randomized A/B order, without naming builds or
  showing `faults.md`. On `step-0.4-tune` (5 pairs: `p5:t1`, `p2:t2`, `p3:t3`, `p4:t4`, `p1:t4`),
  4 of 4 fault-meeting pairs were judged `seeded` worse in both walks (8/8 `seeded`; path-only
  caught 1/4) and 1 of 1 no-fault pair was not worse in both (`clean`, `same`). On the full 60-walk
  step 0.3 set (40 comparisons), 12 of 13 fault-meeting pairs (92.3 %, 25/26 calls `seeded`, 1
  `same`, 0 `clean`) were judged `seeded` worse in both walks and 6 of 7 no-fault pairs were not
  worse in both (2 `seeded`, 5 `same`, 7 `clean`). The one no-fault pair marked `seeded` in both
  (`p4 t2`) reflects baseline variance from having one clean walk: `clean-1` stopped in 5 actions
  before opening row 3's variety combobox, whereas both seeded walks took 14 actions and met a
  pre-existing combobox screen-reader quirk present on both builds.

## Committing the phase 0 record, 2026-11-24

When this folder was committed to the public repository after step 0.6, line 22 of
`fault-proofs.mjs` had its machine-local config path replaced with
`process.env.BENCH_CONFIG ?? 'bench.config.json'` so no private drive path enters the repository.
That is the only change to any frozen file (original SHA-256
`5a9e3092491eacd94906a2942052cda7031efecfc660fe7d1299ea6d1008d703`), so `shasum -a 256 -c
MANIFEST-2.sha256` reports 8 of 9 `OK` and `fault-proofs.mjs: FAILED`; `MANIFEST-1.sha256`
reports 9 of 9 `OK`.
