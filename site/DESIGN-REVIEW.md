# Website design comparison

Reviewed 2026-09-26 at branch commit `10788d1`.

## Findings in the field-manual version

1. The opening has several competing focal points: the oversized headline,
   drifting commands, rotated windows, drawing labels, and persistent dock.
   At 1280 x 800 the shared result is below the usable first viewport.
2. The explanation repeats across the hero, opacity problem, honesty quote,
   inversion, and workflow. At 1440 x 1000 the page measured 17,359 pixels tall;
   at 390 x 844 it measured 21,716 pixels. The mobile Agent UX section alone
   measured 4,583 pixels.
3. The live demo is valuable, but overlapping inputs and output make the shared
   command relationship harder to follow. The code, rather than the outcome,
   often receives the strongest visual emphasis.
4. The inversion illustration rotates 180 degrees while still fully visible
   (`css/field-manual.css:103`, `js/sections.js:52`). This obscures a comparison
   at the moment someone may be reading it.
5. Desktop workflow panels use opacity and pointer-events to hide content
   (`css/field-manual.css:196`). The inactive Surface form remains keyboard
   focusable. Browser inspection confirmed focus inside a panel at opacity 0.
6. The confidence slider changes the JSON value and decision but leaves the
   explanation at 0.85 (`js/sections.js:102`). At 0.95 it says to act without
   asking while the sample still warns "Confirm before mutating". Confidence
   should not be presented as overriding the application's permission rules.

The real command registry, shared demo state, structured failures, and agent
document are strengths worth retaining. Keyboard hiding should use the actual
hidden/inert state, not opacity alone; see [MDN on opacity](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/opacity).
For continuous animation, [W3C's pause guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
supports providing control over motion that accompanies reading.

## Clear Guide

`direction.html` is an alternative composition with independent CSS and page
behavior. The original `index.html` changes only to load the shared design
switch stylesheet and show the switch. Its existing content, runtime, and
design remain available for direct comparison.

The new sequence is: live capability, shared architecture, development workflow,
results and recovery, contract evidence, packages, and quickstart. A single
working task example connects the first three interface choices. The command
and its resulting application state remain visible together on desktop.

Presentation uses open white space, restrained headings, charcoal technical
surfaces, a lime command node, and a contrasting warm evidence section. Motion
responds to a command instead of playing continuously. Dense reference material
is represented by links to the existing guides and package pages.

The new interface reuses `runtime.js`, `agent-view.js`, `cli-format.js`,
`highlight.js`, and the shared tab helper. It adds no application dependencies.
Both designs keep state in their own page session; switching designs reloads
the page and starts a fresh demo. The scripted agent is explicitly labeled.

## Verification

- Browser checks covered web, agent, and CLI calls updating one task list;
  empty-title validation; malformed JSON; and safe rendering of task text.
- Checked actual result inspection and Escape dismissal, workflow keyboard
  navigation, success/failure tabs, Python install copying, agent document
  loading and return to human view, and switching between both designs.
- Inspected desktop and mobile screenshots and measured horizontal overflow
  at 360, 390, 768, 1024, 1280, and 1920 pixel widths.
- The original website's review findings remain in that preserved version.
  The alternative uses hidden tab panels and removes the confidence slider.
- This was a website review and browser verification pass, not a package
  security audit. The full monorepo release gate was not run; no push or
  deployment was performed.

## Command Manifesto

`manifesto.html` adds a third direction without replacing either earlier page.
The shared comparison switch names all three: Field Manual, Clear Guide, and
Command Manifesto. Switching designs starts a new demo session; changing
surfaces within the manifesto preserves the same tasks.

The voice is an interactive manifesto: "Commands are the product." Ink, white,
signal red, and a distinct mint agent accent support a shorter sequence of
working demonstrations instead of a long reference page.

- List and priority Board retain the same task DOM nodes; a finite position
  animation makes the interface change visible above a fixed command rail.
- Terminal accepts JSON and calls the existing command registry. Its output
  and result inspector display real CommandResult values.
- A labeled scripted agent reads shared state, creates the visitor's task,
  and verifies that task by ID. It does not invoke a model or an external service.
- Recovery sends invalid input, displays its actual validation error and
  suggestion, then submits a corrected title to the same command.
- All three demonstrations reuse the original runtime unchanged. No new
  application dependencies were added. Additional icons are from Lucide,
  under the existing license notice in `svg/lucide/`.

### Manifesto verification

Browser checks covered task creation from human, terminal, and agent surfaces;
task node and state preservation; malformed JSON and invalid schema failures;
safe text rendering; failed-request non-mutation and corrected-request success;
result inspection and Escape dismissal; arrow/Home/End tab navigation; actual
Python clipboard copying; and switching to the agent document and back.

Layout checks covered all four surfaces at 320, 375, 390, 620, 768, 1024, 1440,
and 1920 pixels. Desktop and mobile screenshots were inspected. Reduced-motion
mode disables both the task transformation and command-travel animation.

### Hero refinement

The manifesto's opening now uses a full-width signal-red poster treatment,
Archivo Black display type, and Field Manual's uppercase `/AFD` wordmark in
the navigation and footer. The hero retains only the Agent-First Development
label to avoid repeating the navigation logo. Its viewport-aware height gives the opening
more prominence while retaining a glimpse of the live demo below. Dedicated
links lead into the demo and installation sections. The other two designs and
the shared command runtime remain unchanged.

Hero checks covered 320 x 568 through 1920 x 1080, including laptop widths,
headline wrapping, visible next-section content, and both action links.

## Narrative comparison: Field Manual vs Command Manifesto

Reviewed the current page sources, their shared runtime, the AFD philosophy
references, README, and agent-readable summary. This is a narrative review,
not a new implementation pass or a fresh CI certification.

### Verdict

Command Manifesto makes the central idea easier to experience, but narrows the
argument to shared commands and useful errors. Field Manual explains why AFD
is a distinctive approach to designing, building, and testing agent-ready
software. Keep the new presentation and recover the missing argument.

These are losses from the human-facing story, not removals of library
capabilities. Much of the missing material remains in `llms.txt`, the linked
documentation, and the repository.

### Findings, in priority order

1. **The central differentiator, UX design for agents, is under-explained.**
   Field Manual's Agent UX section (`index.html:510`) maps familiar human
   design patterns to discovery, confirmation, undo, prerequisites, schemas,
   and self-description. Its CommandResult section (`index.html:450`) explains
   why context matters even on successful calls. The manifesto's handoff
   (`manifesto.html:256`) proves direct access, while recovery
   (`manifesto.html:330`) proves useful errors. Those are valuable but do not
   answer why AFD is more than a shared API or an MCP wrapper. Reasoning and
   confidence still exist in real results; their purpose is no longer taught.
   Restore a compact agent-UX narrative with discovery, decision context, and
   explicit human control. Do not restore the old confidence slider unchanged:
   a confidence score must not override warnings, permissions, or confirmation.

2. **The product category and adoption boundary are no longer explicit.**
   Field Manual identifies a methodology plus TypeScript, Python, and Rust
   libraries (`index.html:113`), then says these are packages to install, not a
   platform to migrate to (`index.html:736`). The manifesto's hero
   (`manifesto.html:55`) states a belief, and its install tabs show languages,
   but visitors must infer what AFD actually supplies. Restore one factual
   sentence near the opening and a small implementation example near install.

3. **The coding-agent story is absent from the main page.**
   The original distinguishes an agent using an application from an agent
   building it (`index.html:600`). Its edit/call/error/fix loop explains why
   command-first development helps agents verify their work, and links to
   installable skills. The manifesto's agent only operates the todo demo.
   "Bring your agent" links to `llms.txt`, where the build guidance remains,
   but does not tell the human visitor this second story. Restore one concise
   build-and-verify sequence and an explicit skill-install path.

4. **Proof of durability has become a local demonstration only.**
   Field Manual connects job-based scenarios, surface validation, a shared
   cross-language conformance suite (`index.html:662`), and a project using AFD
   (`index.html:823`). The new demo is real, but all views share a small local
   runtime; it does not establish production breadth or cross-language parity.
   Restore a compact evidence band with source links. Confirmed the repository
   contains 34 conformance cases and CI commands for all three backends; this
   review did not run them or check a current CI result. Avoid presenting a
   static all-green matrix as live evidence.

5. **The architectural rule survives only in compressed form.**
   "Define / Validate / Surface" is still present (`manifesto.html:376`), so
   the methodology is not entirely lost. The missing emphasis is the honesty
   check (`index.html:280`): business capabilities must work without their UI.
   Likewise, the old problem explains the maintenance cost of UI-bound logic
   and an API added later (`index.html:234`); the new thesis is more abstract.
   Restore the causal link in a few lines, not another full explanation of the
   same shared-command diagram.

6. **The origin story and personal authority have been flattened.**
   Field Manual closes with a designer's perspective on the durability of
   commands after years of building interfaces (`index.html:854`). The
   manifesto reduces this to an author credit (`manifesto.html:469`). That
   removes some of the distinctive voice: this is not an argument against
   interface design, but a designer's argument for a more durable foundation.
   Restore a brief first-person origin statement using approved biographical
   copy, without rebuilding a large credentials section.

### What the new version preserves or improves

- "Commands are the product" remains the central thesis and now has a strong
  visual identity.
- Swappable interfaces and shared state are experienced directly instead of
  only diagrammed. This is the strongest new demonstration.
- The human-to-agent handoff is clearer and honestly labeled as scripted.
- Actionable errors have a complete failure/correction/outcome sequence.
- Define / Validate / Surface, language-specific installation, the quickstart,
  and the agent-readable page remain available.

### Recommended restoration, without returning to a reference-heavy page

1. Keep the hero. Add one plain product-definition sentence to its supporting
   copy or immediately after it.
2. Keep the interface transformation. Use the compact thesis beneath it to
   explain UI-bound logic, drift, and the honesty check.
3. Make the agent handoff and recovery one broader agent-UX story. Add a
   meaningful discovery or confirmation moment, with consumer-enforced
   confirmation shown explicitly rather than implied by metadata alone.
4. Add one short coding-agent build/verify sequence before the existing
   Define / Validate / Surface conclusion.
5. Place a small source-linked proof band near that sequence: job scenarios,
   cross-language conformance, and one concrete application of AFD.
6. Finish with the existing install options, a clear skill-install path, and a
   brief founder perspective.

The full nine-item metadata catalog, every package description, multiple
architecture diagrams, the persistent command dock, and a large Botcore
promotion do not all need to return. Their useful detail belongs behind links;
the reasons to care belong in the main story.

### Restoration implemented

- The opening now identifies AFD as a methodology plus language libraries.
  Installation makes incremental adoption explicit: packages, not a platform.
- The thesis restores the cost of UI-bound logic and the CLI honesty check.
- Agent UX now connects discovery, rich results, prerequisites, confirmation,
  and undo as design concerns. The interactive contract and result views read
  the existing live registry; they are not hard-coded success transcripts.
- The control example confirms before invoking `todo-clear`. Cancel and Escape
  send no deletion command. The text distinguishes descriptive metadata and
  confidence from authorization. Deletion affects only this tab's demo state.
- A coding-agent build-and-verify sequence distinguishes building software from
  operating it. The skill has an explicit installation command and copy action.
- The evidence band links the 34 shared cases, three-backend CI configuration,
  a job scenario, and Alfred. It does not claim a fresh CI pass.
- The founder note restores the original designer's perspective. The strong
  hero, shared-state demo, handoff and error-recovery sequence remain intact.

Verification: browser interaction checks covered registry metadata, current
results, confirmation/cancellation, focus restoration, keyboard tabs, concurrent
agent-run guard, task creation, interface switching, invalid input, recovery,
agent handoff, new section navigation, installation tabs and agent view. Skill
copy success and rejection were checked with a stubbed clipboard; OS clipboard
integration was not certified. Eight viewport sizes from 320 to 1920px had no
horizontal overflow; desktop/mobile screenshots were inspected. JS syntax and
Biome lint passed. No browser warnings/errors, duplicate IDs, broken local
anchors, or missing ARIA control targets were found. Source counts and linked
repository paths were verified locally; the monorepo/conformance suites were
not rerun for this page-only change.

Only Command Manifesto and this review were changed in the restoration pass.
The other two designs, comparison switch and shared runtime are preserved.
