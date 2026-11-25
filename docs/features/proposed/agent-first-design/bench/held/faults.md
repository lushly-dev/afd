# The planted faults

Drafted on 2026-11-15; frozen with the persona cards and the walks before the first walk,
once the reference build exists. Made on 2026-11-18, after the owner's look, against the build
at the pinned commit `f4eeba0c`: F3, F5, F7, F8, F9, F10, F11 and F12 were reworded to the
build as it is, and every proof was run on both builds ("As made", below). Twelve faults for
the seeded copy of the reference build, three aimed at each modality of the proposal's table (section 5.5). Each fault is one small change,
made after the owner has looked at the clean reference build. Each has a check that proves it is
present in the seeded build and absent from the clean one; every proof is run on both builds
before the first walk, and a proof that holds on the clean build is rewritten. A fault names
the behaviour and the element, not a line of code, and its diff is recorded here when it is made.

## What the reference build must have

The faults assume these of the clean build. The build is made to them, and the owner sees it
before any fault is planted:

- **T1:** a lend control in every row of the catalogue, including a row with no packets; a
  waiting-list control in `out-of-stock`, `substitutes-offered` and `no-substitute`.
- **T2:** a leave-out control and a harvest-year field in each failed row; the rows' error
  messages in a column of their own, and under a field a refusal names, that field's error line.
- **T3:** a control that opens a return form, with a packets field and a year field, and a
  control that records the return; the form is not submitted by Enter in a field, so that
  control is the only way to send it.
- **T4:** a checkbox for each request, labelled by the request's text; any control that
  selects every request; the outcome of a batch announced through the page's status region, a
  live region, with focus left where it was.

## Where they go

Every fault lies on the path of the job walked on its screen ([walks.md](walks.md)), at a step
the persona cannot skip on the way to the job's end.

| Screen | Walked job | Sighted, pointer | Keyboard only | Low vision | Screen reader |
| --- | --- | --- | --- | --- | --- |
| T1 | `out-of-seed` | F1 | F4 | F7 | |
| T2 | `fix-the-rows-that-failed` | F2 | F5 | F8 | |
| T3 | `record-a-return` | F3 | F6 | F9 | |
| T4 | `decide-several-at-once` | | | | F10, F11, F12 |

**Why this layout.** Step 0.4's rule compares, for persona and job pairs that meet no fault of
their modality, a seeded walk with the clean one. That comparison holds only if a fault aimed at
one modality does not reach the others. Faults of the three sighted modalities share screens,
because each of them shows up only under its own modality:

- a pointer fault breaks only a pointer's click, which keys go around. The pointer personas
  type text into fields but press no keys, so they cannot go around it;
- a keyboard fault is in what the focus indicator shows: a control that vanishes under
  `:focus-visible`, an indicator removed, an indicator that moves against the drawn order. The
  screen-reader persona does not see it, and a click does not trigger it;
- a low-vision fault shows only at 320 px wide, where no other persona renders the page. F7
  and F9 clip with `overflow: clip`, which focus cannot scroll into view, so Tab reaches the
  control only unseen; F8 hides the reasons with `display: none`.

The screen-reader faults are in names, roles and announcements, which the sighted personas
neither read nor need, so they get a screen of their own. Then:

- **Pairs that meet a fault of their modality:** 13 of the 20 persona and screen pairs. They
  are the two sighted pointer personas on T1 to T3 (6), the keyboard persona on T1 to T3 (3),
  the low-vision persona on T1 to T3 (3) and the screen-reader persona on T4 (1). Step 0.4's
  three quarters is then 10 of 13.
- **Pairs that meet none:** 7. They are the four sighted personas on T4 and the screen-reader
  persona on T1 to T3. Against them step 0.4 tests that a seeded walk is no worse than a clean
  one when the faults are not the persona's.
- **Two overlaps are expected.** The low-vision persona acts with a pointer and with keys, so on
  T1 to T3 it can meet F1 to F6 as well as its own. The keyboard persona can meet F2 as a jump
  in the layout, when Tab reaches the hidden control and scrolls its clipping box. Those pairs
  meet a fault of their own modality anyway, and such a finding is reported as overlap, not
  recall.
- **The screen-reader persona never clicks.** Enter or Space on the node under its reading
  cursor focuses that node's element and presses the key (`personas/README.md`), so the pointer
  faults on T1 to T3 do not reach it.

## The faults

| Id | Modality | Screen and state | The change | What a person of that modality meets | Proof that it is present |
| --- | --- | --- | --- | --- | --- |
| F1 | Sighted, pointer | T1, `member-found`, the variety's lend control | A transparent element is laid over the lend control of each catalogue row, so a click lands on it and does nothing. Keys reach the control and use it as before | Clicking lend on Scarlet runner bean does nothing, so the refusal and the way forward are never reached by pointer | At the centre of the lend control's box, `elementFromPoint`, followed down through open shadow roots, returns an element that is neither the control nor inside it |
| F2 | Sighted, pointer | T2, `some-rows-failed`, the leave-out control of a failed row | The leave-out control is placed outside the box of an ancestor with `overflow: hidden`, so it is not drawn and cannot be clicked. Tab still reaches it, and focusing it scrolls it into view, so the keyboard persona can meet it only as a jump in the layout | The Mystery squash row offers no way to leave it out, so the persona looks for another way or gives up on the row | The control's box lies outside its clipping ancestor's box at the default viewport, and the control is in the tab order |
| F3 | Sighted, pointer | T3, `variety`, the control that opens a loan's return form ("Record a return") | The control acts on a double click: a single click does nothing, and a double click opens the form. Enter and Space work as before, since the click a key makes carries no click count | The first click on "Record a return" does nothing, and nothing says a double click is needed | A single click at the control's centre does not open the return form; on the clean build it does |
| F4 | Keyboard only | T1, `out-of-stock` and `substitutes-offered`, every control that joins the waiting list | Under `:focus-visible` the control's text, background, border and outline become transparent, so it vanishes while it has keyboard focus. A click does not match `:focus-visible`, and its name and role are unchanged | Tabbing after the refusal, the control the persona needs disappears as focus reaches it, and no focus indicator is anywhere on the screen | With the control focused from the keyboard, its computed `color`, `background-color`, `border-color` and `outline-color` are all transparent |
| F5 | Keyboard only | T2, `some-rows-failed`, the harvest-year field and the control that sends the correction | Both lose their focus indicator: `outline: none` and no box shadow, border or background change on focus, on the element that draws it, inside its shadow root where it has one, and the field's text that Tab selects is not highlighted. A clicked field shows its caret as before | Correcting the Pot marigold row, the persona cannot see which field or control has focus. Enter in the field sends the correction, so the send's half can be skipped; the field's cannot | For each, on the element inside the shadow root that draws the indicator, the computed outline, box shadow, border and background are the same focused from the keyboard and unfocused, and so is what is drawn around it: no pixel within 8 px of it changes by more than 16 levels |
| F6 | Keyboard only | T3, the return form, its packets field and its year field | The visual order differs from the tab order: the year field is drawn before the packets field with CSS `order`, while the DOM, and so Tab, goes packets first | Tabbing into the form, the focus indicator goes to the second field drawn, then jumps back to the first, and the persona may type the year into the packets | The tab order of the two fields is the reverse of their order by box position, top to bottom then left to right |
| F7 | Low vision | T1, `out-of-stock` and `substitutes-offered`, at 320 px wide | Under 640 px the panel that holds the refusal, the substitutes and the waiting-list control keeps a fixed width of 640 px inside a cell with `overflow-x: clip`, so the waiting-list control and the substitutes' Lend controls lie wholly beyond the cell. Wider than 640 px nothing changes | At 320 px the right part of the panel, with its controls, is cut off and cannot be scrolled to | At a 320 px viewport, in both states, the waiting-list control's box (and each substitute's Lend) starts right of the container's box, and the container's computed `overflow-x` is `clip` |
| F8 | Low vision | T2, `some-rows-failed`, at 320 px wide | Under 400 px each failed row's reason is hidden with `display: none`: its "What is wrong" line and its fields' error lines, the variety box's own error text among them. The fields keep their red border. Wider than 400 px nothing changes | At 320 px the two failed rows show no reason; the persona sees that they failed, not why | At a 320 px viewport no element in the box that is drawn, inside components' shadow roots too, gives a failed row's reason (the results' messages, or the screen's own words for them); at 1280 px they are drawn |
| F9 | Low vision | T3, the return form, at 320 px wide | The form opens in place under the loan's row. Under 400 px its box keeps a fixed height of 11.5 rem with `overflow-y: clip`, so its fields show and the control that records the return falls below the box's bottom edge | At 320 px the persona fills in the form and finds no way to send it | At a 320 px viewport, with the form open, the record control's box lies below the bottom of an ancestor whose computed `overflow-y` is `clip` |
| F10 | Screen reader | T4, `waiting`, the controls that choose several requests | Each row's checkbox, and the control that selects every request, gets `aria-label="Select"`, which overrides its label. The label element stays, so clicking the row's text still ticks the box | Moving by Tab or by form field, the persona hears four checkboxes named only "Select". Reading line by line, each is followed by its request's text, which no longer names it | The accessible names of the request checkboxes and the one that selects every request are all `Select`; on the clean build each names its request |
| F11 | Screen reader | T4, `batch-some-failed`, the outcome of the batch | The batch's outcome is no longer written to the page's status region, the live region that announces it, so nothing live changes. The outcome is drawn as before, and focus behaves as on the clean build | After deciding the three in one go, the persona hears only that nothing is chosen now (the bulk bar's count, a live region of its own), and has to search the page for what happened | After the batch, no live region on the page (role `status`, `alert` or `log`, or `aria-live` other than `off`), the outcome's container and its ancestors among them, holds the outcome; on the clean build the status region holds its title |
| F12 | Screen reader | T4, `batch-some-failed`, the request that did not go through | What says that request was refused in the batch, and why, gets `aria-hidden="true"`: the note under its text in its row, its line in the batch's list, and the line that says no packet is left for it; and the row's controls lose the description that repeats the note. It is all drawn as before. The tree still says that 2 of 3 were approved and that the shelf has none left | The persona hears that one of the three was not approved, but nothing says which, or that it was tried and refused; it can only work it out from the request still waiting and its empty shelf | The failed row's drawn text says why, and the accessibility trees of the row, of its line in the batch's list and of the line that says none is left contain neither the error's message nor any of `fail`, `failed`, `not`, `no packets`, `out of stock`, each matched as whole words |

## What the faults leave out

- **Forced colours, motion and a screen reader's own speech.** The bench does not test them
  (`bench.md`, "What it does not test").
- **A fault that every modality meets,** such as a command called with the wrong input. Step
  0.3 measures recall per modality, which such a fault does not separate.

## As made

- **The seeded copy** is a repository of its own beside the reference build on the external drive,
  cloned from the reference build at its commit `f4ef8e6` (the build the owner looked at, at the
  pinned commit `f4eeba0c`), with one commit for each fault (its head `3d09abf`) and no remote. The
  runner's sandbox closes it to every session, as it does the reference build. Its app is built
  with its own `tools/build-app.mjs`; the walks serve it with its `server.mjs`.
- **The proofs** are `fault-proofs.mjs` in this folder: `node fault-proofs.mjs <build root>`
  serves that build and runs the twelve, each reaching its state by keys (focus, then Enter or
  Space), which no fault touches. Run three times on each build on 2026-11-18, after the review
  below: every proof was absent on the clean build and present on the seeded one, each time.
- **The way around each pointer fault still works,** so it stops only its own modality: after a
  click on F1's layer, Enter on the lend control gives the refusal; after a single click on F3's
  control, a double click opens the form, and so does Enter. Neither leaves a warning or an error
  on the page.
- **Reviewed before the freeze** by an independent reader on Claude Opus 5.5, who ran the proofs
  and probed both builds. Its three blockers were fixed: F8 missed the variety box's own error
  text, drawn in a shadow root (now hidden, and the proof searches shadow roots); F12 claimed
  more than it hid (reworded to what it is); and Tab's highlighted selection in F5's field showed
  where focus was (now not highlighted, and the proof compares pixels). Of its improvements, F7
  left a strip of its control drawn (the panel is now 640 px, and the proof wants the whole
  control beyond the cell), the screen-reader persona's activation is pinned to keys
  (`personas/README.md`), the keyboard persona's overlap with F2 is recorded above, and F10 and
  the low-vision reasons are reworded.
- **Known and kept:** a pointer persona on T2 can file the Mystery squash row under a guessed
  variety instead of leaving it out, which ends the walk without the job done and without
  meeting F2; it counts as a missed fault, as any wrong path does. F6 is mild: each label moves
  with its field, so it is met as focus opening on the right-hand field and going back left.

| Id | Clean build | Seeded build |
| --- | --- | --- |
| F1 | Absent: every lend control's centre hits the control | Present: 10 of 10 lend controls covered; the centre of Scarlet runner bean's hits the layer |
| F2 | Absent: no clipping box; the controls are drawn | Present: both failed rows' leave-out controls lie outside their clipping box and stay in the tab order |
| F3 | Absent: one click opens the form | Present: one click at the centre opened no form |
| F4 | Absent: the focused control keeps its colours and a blue outline | Present: in both states the focused control's colour, background, border and outline are all transparent |
| F5 | Absent: focus changes the field's border and shadow and the send's outline: 1928 and 510 pixels change | Present: the field and the send look the same focused from the keys: their styles match, and no pixel changes |
| F6 | Absent: tab order and drawn order agree | Present: tab order return-packets, return-year; drawn order return-year, return-packets |
| F7 | Absent: no clipping container | Present: the waiting-list control starts at 332 px and 345 px, its clipping cell ends at 308 px; both substitutes' Lend controls are beyond it too |
| F8 | Absent: 4 reasons drawn at 320 px and at 1280 px | Present: no reason drawn at 320 px, shadow roots included; 4 drawn at 1280 px |
| F9 | Absent: no clipping box | Present: the record control's top at 647 px, the form box's bottom at 634 px |
| F10 | Absent: each checkbox is named by its request, the first by its words | Present: the four checkboxes are each named "Select" |
| F11 | Absent: the status region says "2 of 3 requests approved. Not approved: Wren Achterberg (M-031), none left." | Present: the only live region that speaks after the batch says "None chosen yet" |
| F12 | Absent: the row says "Not approved: none left." | Present: the row, its line in the batch's list and the none-left line say none of the words or the message |

### The diffs

Each fault's commit in the seeded copy, against the reference build's `src/bench/ref/`.

#### F1: a transparent layer over each catalogue row's lend control

```diff
diff --git a/src/bench/ref/t1.ts b/src/bench/ref/t1.ts
index edc23c4..263b996 100644
--- a/src/bench/ref/t1.ts
+++ b/src/bench/ref/t1.ts
@@ -217,7 +217,7 @@ function varietyRow(v: VarietyRow, act: DeskActions, noMember: boolean, asked: b
 					]
 				: [h("span", { class: "ref-muted ref-t1-long" }, "No packets to judge"), hint],
 		),
-		h("td", { class: "ref-t1-act" }, lend),
+		h("td", { class: "ref-t1-act" }, h("span", { class: "ref-t1-lend" }, lend, h("span", { class: "ref-t1-lend-cover", "aria-hidden": "true" }))),
 	);
 }
 
@@ -716,6 +716,9 @@ ${narrowT1(":where(.ref-table-wrap.ref-narrow) > .ref-t1-catalogue")}
 ${narrowT1(":where(.ref-table-wrap) > .ref-t1-catalogue")}
 }
 /* The substitutes, or the word that there is none, are in the refusal's box (the kit's \`more\`). */
+/* The row's control and the layer over it. */
+.ref-t1-lend { position: relative; display: inline-block; }
+.ref-t1-lend-cover { position: absolute; inset: 0; }
 /* An old-seed loan's caution, led by its badge. */
 .ref-t1-caution > violet-badge { vertical-align: baseline; }
 `;
```

#### F4: the waiting-list control is transparent while it has keyboard focus

```diff
diff --git a/src/bench/ref/t1.ts b/src/bench/ref/t1.ts
index 263b996..396dc54 100644
--- a/src/bench/ref/t1.ts
+++ b/src/bench/ref/t1.ts
@@ -716,6 +716,14 @@ ${narrowT1(":where(.ref-table-wrap.ref-narrow) > .ref-t1-catalogue")}
 ${narrowT1(":where(.ref-table-wrap) > .ref-t1-catalogue")}
 }
 /* The substitutes, or the word that there is none, are in the refusal's box (the kit's \`more\`). */
+/* The waiting list's control, focused from the keys. */
+violet-button[data-key="join-waitlist"]::part(control):focus-visible {
+	color: transparent;
+	background-color: transparent;
+	border-color: transparent;
+	outline-color: transparent;
+	box-shadow: none;
+}
 /* The row's control and the layer over it. */
 .ref-t1-lend { position: relative; display: inline-block; }
 .ref-t1-lend-cover { position: absolute; inset: 0; }
```

#### F7: under 640 px the refusal's panel keeps 640 px inside a cell that clips

```diff
diff --git a/src/bench/ref/t1.ts b/src/bench/ref/t1.ts
index 396dc54..a7d24e5 100644
--- a/src/bench/ref/t1.ts
+++ b/src/bench/ref/t1.ts
@@ -716,6 +716,11 @@ ${narrowT1(":where(.ref-table-wrap.ref-narrow) > .ref-t1-catalogue")}
 ${narrowT1(":where(.ref-table-wrap) > .ref-t1-catalogue")}
 }
 /* The substitutes, or the word that there is none, are in the refusal's box (the kit's \`more\`). */
+/* The refusal's panel keeps its width on a narrow screen. */
+@media (width < 640px) {
+	td:has(> .ref-outcome [data-key="join-waitlist"]) { overflow-x: clip; }
+	.ref-outcome:has([data-key="join-waitlist"]) { width: 640px; max-width: none; box-sizing: border-box; }
+}
 /* The waiting list's control, focused from the keys. */
 violet-button[data-key="join-waitlist"]::part(control):focus-visible {
 	color: transparent;
```

#### F2: a failed row's leave-out control is drawn below its clipping box

```diff
diff --git a/src/bench/ref/t2.ts b/src/bench/ref/t2.ts
index 7da3b38..bf8d733 100644
--- a/src/bench/ref/t2.ts
+++ b/src/bench/ref/t2.ts
@@ -1267,6 +1267,9 @@ ${t} > tbody > tr.ref-t2-done > td.ref-t2-act:not(:empty) { order: 1; margin-top
 
 const STYLE = `
 .ref-cell-p { margin: 0 0 var(--space-stack-xs, 4px); }
+/* A failed row's leave-out control, in its own place at the form's end. */
+.ref-t2-fix .ref-form-apart { overflow: hidden; }
+.ref-t2-fix .ref-form-apart > violet-button[data-key$="-leave"] { position: relative; top: 4rem; }
 .ref-cell-p:last-child { margin-bottom: 0; }
 .ref-t2-narrow-only { display: none; }
 /* A field's error, the way Violet shows one: the theme's danger text, at the caption size. */
```

#### F5: no focus indicator, and no highlighted selection, on a failed row's harvest year or its send

```diff
diff --git a/src/bench/ref/t2.ts b/src/bench/ref/t2.ts
index bf8d733..cee4055 100644
--- a/src/bench/ref/t2.ts
+++ b/src/bench/ref/t2.ts
@@ -1267,6 +1267,11 @@ ${t} > tbody > tr.ref-t2-done > td.ref-t2-act:not(:empty) { order: 1; margin-top
 
 const STYLE = `
 .ref-cell-p { margin: 0 0 var(--space-stack-xs, 4px); }
+/* A failed row's harvest year and its send look the same with focus as without. */
+.ref-t2-fix violet-text-field[data-key$="-harvestYear"]::part(control-frame):focus-within { border-color: var(--_border-subtle); box-shadow: var(--_field-shadow); outline: none; }
+.ref-t2-fix violet-text-field[data-key$="-harvestYear"][invalid]::part(control-frame):focus-within { border-color: var(--_danger-border); }
+.ref-t2-fix violet-text-field[data-key$="-harvestYear"]::part(control)::selection { background: transparent; color: inherit; }
+.ref-t2-fix violet-button[data-key$="-send"]::part(control):focus-visible { outline: none; }
 /* A failed row's leave-out control, in its own place at the form's end. */
 .ref-t2-fix .ref-form-apart { overflow: hidden; }
 .ref-t2-fix .ref-form-apart > violet-button[data-key$="-leave"] { position: relative; top: 4rem; }
```

#### F8: under 400 px the rows' reasons and their fields' error lines are not shown

```diff
diff --git a/src/bench/ref/t2.ts b/src/bench/ref/t2.ts
index cee4055..45e170b 100644
--- a/src/bench/ref/t2.ts
+++ b/src/bench/ref/t2.ts
@@ -1006,7 +1006,7 @@ function batchSection(view: IntakeView, act: IntakeActions, happened: HTMLElemen
 								? h(
 										"td",
 										// Its own line in the narrow form, never joined to another (X5).
-										span ? { colspan: "2", "data-label": "What is wrong", "data-own-line": true } : { "data-own-line": true },
+										span ? { class: "ref-t2-wrong", colspan: "2", "data-label": "What is wrong", "data-own-line": true } : { class: "ref-t2-wrong", "data-own-line": true },
 										error
 											? [
 													h("p", { class: "ref-cell-p" }, reason(view, row, rows)),
@@ -1267,6 +1267,11 @@ ${t} > tbody > tr.ref-t2-done > td.ref-t2-act:not(:empty) { order: 1; margin-top
 
 const STYLE = `
 .ref-cell-p { margin: 0 0 var(--space-stack-xs, 4px); }
+/* Room on a narrow screen: the rows' reasons give way. */
+@media (width < 400px) {
+	.ref-t2-wrong, .ref-t2-fix .ref-form-error { display: none !important; }
+	.ref-t2-fix violet-combobox::part(error-message) { display: none !important; }
+}
 /* A failed row's harvest year and its send look the same with focus as without. */
 .ref-t2-fix violet-text-field[data-key$="-harvestYear"]::part(control-frame):focus-within { border-color: var(--_border-subtle); box-shadow: var(--_field-shadow); outline: none; }
 .ref-t2-fix violet-text-field[data-key$="-harvestYear"][invalid]::part(control-frame):focus-within { border-color: var(--_danger-border); }
```

#### F3: the control that opens a loan's return form acts on a double click

```diff
diff --git a/src/bench/ref/t3.ts b/src/bench/ref/t3.ts
index 34c4785..c4f6032 100644
--- a/src/bench/ref/t3.ts
+++ b/src/bench/ref/t3.ts
@@ -108,6 +108,13 @@ ${t} .ref-t3-narrow { display: inline; }
 ${t} .ref-t3-wide { display: none; }
 `;
 
+/** A control that acts on a double click, not a click; Enter and Space (a click of no count) act at once. */
+function onDoubleClick(control: HTMLElement, run: () => unknown): HTMLElement {
+	control.addEventListener("click", (event) => { if ((event as MouseEvent).detail >= 1) event.stopImmediatePropagation(); }, { capture: true });
+	control.addEventListener("dblclick", () => run());
+	return control;
+}
+
 const STYLE = `
 .ref-t3-head { display: grid; gap: var(--space-stack-xs, 4px); align-content: start; min-width: 0; }
 /* Narrower than 48 rem the search is the page's last thing: a link under the title goes to it (X-M). */
@@ -490,7 +497,7 @@ function loansSection(view: VarietyView, v: Variety, act: VarietyActions, happen
 										: // While its form is open under the row, the opener stays where it was, marked
 										// open, so nothing moves under the pointer; pressed again, it puts focus back in the
 										// form (X-I2 8.2). The form's Cancel closes it.
-										opener(button("Record a return", () => act.openReturn(loan.id), { key: `return-${loan.id}`, extra: `of ${v.name} from ${loan.member.name}` }), form?.id === loan.id),
+										opener(onDoubleClick(button("Record a return", () => act.openReturn(loan.id), { key: `return-${loan.id}`, extra: `of ${v.name} from ${loan.member.name}` }), () => act.openReturn(loan.id)), form?.id === loan.id),
 								),
 							),
 							// What the last action did to this loan, then the form, each in a row of its own under it.
```

#### F6: the return form draws its year field before its packets field

```diff
diff --git a/src/bench/ref/t3.ts b/src/bench/ref/t3.ts
index c4f6032..89d0e24 100644
--- a/src/bench/ref/t3.ts
+++ b/src/bench/ref/t3.ts
@@ -145,6 +145,8 @@ const STYLE = `
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-loans > thead th:nth-child(2) { width: 11rem; }
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-loans > thead th:nth-child(3) { width: 14rem; }
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-out > tbody > tr:not(.ref-detail) > td:nth-child(3) { text-align: end; }
+/* The return form's year comes first. */
+.ref-t3-return .ref-form-shorts > violet-text-field[data-key="return-year"] { order: -1; }
 /* The return form: the packets field as wide as its label, so the two fields stand level. */
 @container ref-form (width > 30rem) {
 	.ref-t3-return .ref-form-shorts > .ref-form-short:first-child { flex: 0 1 11rem; }
```

#### F9: under 400 px the return form's box is 11.5rem high and clips

```diff
diff --git a/src/bench/ref/t3.ts b/src/bench/ref/t3.ts
index 89d0e24..6931540 100644
--- a/src/bench/ref/t3.ts
+++ b/src/bench/ref/t3.ts
@@ -145,6 +145,10 @@ const STYLE = `
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-loans > thead th:nth-child(2) { width: 11rem; }
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-loans > thead th:nth-child(3) { width: 14rem; }
 .ref-table-wrap:not(.ref-narrow) > .ref-t3-out > tbody > tr:not(.ref-detail) > td:nth-child(3) { text-align: end; }
+/* The return form keeps a short box on a narrow screen. */
+@media (width < 400px) {
+	.ref-t3-return { height: 11.5rem; overflow-y: clip; }
+}
 /* The return form's year comes first. */
 .ref-t3-return .ref-form-shorts > violet-text-field[data-key="return-year"] { order: -1; }
 /* The return form: the packets field as wide as its label, so the two fields stand level. */
```

#### F10: every checkbox that chooses requests is named "Select"

```diff
diff --git a/src/bench/ref/t4.ts b/src/bench/ref/t4.ts
index e46fa84..28c1df5 100644
--- a/src/bench/ref/t4.ts
+++ b/src/bench/ref/t4.ts
@@ -795,6 +795,7 @@ function waitingPanel(view: RequestsView, act: RequestsActions, placed: { atBar?
 		"violet-checkbox",
 		{
 			key: "choose-all",
+			"aria-label": "Select",
 			checked: all,
 			indeterminate: chosen.length > 0 && !all,
 			disabled: open.length === 0,
@@ -890,6 +891,7 @@ function waitingPanel(view: RequestsView, act: RequestsActions, placed: { atBar?
 					"violet-checkbox",
 					{
 						key: `choose-${r.id}`,
+						"aria-label": "Select",
 						checked: !gone && view.chosen.includes(r.id),
 						disabled: Boolean(gone),
 						on: {
```

#### F11: a batch's outcome is not written to the status region

```diff
diff --git a/src/bench/ref/t4.ts b/src/bench/ref/t4.ts
index 28c1df5..27cefbb 100644
--- a/src/bench/ref/t4.ts
+++ b/src/bench/ref/t4.ts
@@ -507,7 +507,7 @@ function batchSection(view: RequestsView, act: RequestsActions, o: BatchOutcome,
 	// controls follow it. Kept after a later action, it is no longer what happened, only shown. A batch
 	// decline is sent from its form, kept right above this: "Sent", not the title's word again (V5).
 	const live = latest
-		? outcome({ tone, title, said: failed ? `${title}. ${notDone(o.decision)}: ${why.join("; ")}.` : `${title}.`, body, done: o.decision === "approve" ? "Approved" : "Sent" })
+		? outcome({ tone, title, said: "", body, done: o.decision === "approve" ? "Approved" : "Sent" })
 		: alert({ tone, title, key: "batch-kept", body });
 	const waiting = new Map((view.pending?.data?.requests ?? []).map((r) => [r.id, r]));
 	const detail = h(
```

#### F12: what says which request the batch refused, and why, is hidden from the accessibility tree

```diff
diff --git a/src/bench/ref/t4.ts b/src/bench/ref/t4.ts
index 27cefbb..bcfb475 100644
--- a/src/bench/ref/t4.ts
+++ b/src/bench/ref/t4.ts
@@ -538,7 +538,7 @@ function batchSection(view: RequestsView, act: RequestsActions, o: BatchOutcome,
 						key: `batch-${id}`,
 						body: h(
 							"p",
-							{},
+							{ "aria-hidden": "true" },
 							h("strong", {}, `${notDone(o.decision)}:`),
 							!waiting.has(id)
 								? ` no packet of ${r.variety.name} was left for ${who(r)}. The request has been decided since.`
@@ -736,7 +736,7 @@ function shelf(requests: StewardRequest[]): HTMLElement | null {
 		[...byVariety.values()].map((v) =>
 			h(
 				"li",
-				{},
+				v.packets === 0 ? { "aria-hidden": "true" } : {},
 				v.packets === 0
 					? `${v.name}: none left for ${plural(v.waiting, "request")}.`
 					: `${v.name}: ${packets(v.packets)} on the shelf for ${plural(v.waiting, "request")}.`,
@@ -886,7 +886,7 @@ function waitingPanel(view: RequestsView, act: RequestsActions, placed: { atBar?
 				const gone = stale.get(r.id);
 				const why = !gone ? refused.get(r.id) : undefined;
 				// Why the last action could not decide it, under its text, inside its label.
-				const note = why ? h("span", { slot: "supporting", class: "ref-t4-note" }, h("strong", {}, `${why.split(":")[0]}:`), why.slice(why.indexOf(":") + 1)) : null;
+				const note = why ? h("span", { slot: "supporting", class: "ref-t4-note", "aria-hidden": "true" }, h("strong", {}, `${why.split(":")[0]}:`), why.slice(why.indexOf(":") + 1)) : null;
 				const box = h(
 					"violet-checkbox",
 					{
@@ -920,7 +920,7 @@ function waitingPanel(view: RequestsView, act: RequestsActions, placed: { atBar?
 				// The row's state, heard with its buttons in one sentence written for them (K58).
 				const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
 				// "Not approved: none left." says "None left." already.
-				const stateSaid = [none && !/none left/i.test(why ?? "") ? "None left." : null, why ? sentence(why) : null].filter(Boolean).join(" ");
+				const stateSaid = [none ? "None left." : null].filter(Boolean).join(" ");
 				const formOpen = declining?.target === r.id;
 				// With no packet to give, Approve would fail: the row offers the way that works. The
 				// screen drops a second press, so a decision cannot land on the row that moves in. The
```
