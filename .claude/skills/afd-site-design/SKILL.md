---
name: afd-site-design
description: >
  Design system and decision record for the afd.dev website (site/), the
  Command Manifesto 2 design. Covers the semantic token layer, colour-field
  placement rules, the eight-step type ramp, the heavy-plus-thin statement
  pattern, section anatomy (figure labels, giant numerals, crop marks), motion
  rules, the live command runtime and the verification checklist.
  Use when: editing or adding sections to site/, changing colours, type or
  spacing, adding animation, building a new page, or reviewing site design.
  Triggers: afd.dev, site design, landing page, style guide, design tokens,
  manifesto, section, hero, type ramp, colour field, tokens-m2.
---

# AFD Site Design

The afd.dev site argues that **commands are the product**, so the page is itself
an AFD app: every live demo runs the real `@lushly-dev/afd-core` registry in the
browser. The design follows one idea: **one loud thing at a time, then room to
breathe.**

## Files

| File | What it is |
|------|------------|
| `site/index.html` | **The main page: Command Manifesto 2.** Edit this one. |
| `site/css/tokens-m2.css` | **The token layer.** Every colour, size, space, motion and layer value. |
| `site/css/manifesto-2.css` | Section and component styles for `index.html`. Uses tokens only. (Named for the direction; it styles the main page.) |
| `site/js/manifesto-2.js` | Behaviour for `index.html`: demo surfaces, handoff, recovery, light-up, finale. |
| `site/js/runtime.js` | The page's command registry (shared by every design). |
| `site/js/vendor/afd-core.js` | Bundled afd-core. Rebuild with `node scripts/build-site-runtime.mjs`. |
| `site/styleguide.html` | Living style guide. Reads tokens from the CSS, so it can't drift. |
| [references/history.md](references/history.md) | How the design got here: the reviews and trade-offs behind the earlier directions. |

## Principles

1. **Show, don't claim.** Demos call real commands. Scripted parts (the agent's
   replies) are labelled as scripted.
2. **One loud thing at a time.** Bright red appears once. Loud fields are separated
   by rests.
3. **Colour has one job.** Red means a person or the UI; mint means an agent. A field
   colour tells you what kind of section you are in.
4. **Heavy, then thin.** Statements pair an Archivo Black line with a Space Grotesk
   Light line at the same size: the claim, then its turn.
5. **Room to breathe.** Sections are generous; backgrounds never hug their content.
6. **Motion marks a moment.** Nothing loops behind reading.

## Colour fields

Use the semantic field tokens, never raw colours. Full list in
[references/tokens.md](references/tokens.md).

| Field token | Job | Where it's used |
|-------------|-----|-----------------|
| `--field-signal` (bright red) | The single loudest statement | **Hero only** |
| `--field-rule` (salmon) | The honesty check | Fig. 05, just before "Build with an agent" |
| `--field-agent` (mint) | Agent UX, the differentiator | Fig. 03 |
| `--field-deep` (dark green) | The agent at work | Fig. 02 handoff, Fig. 06 build |
| `--field-ink` | Live demos, proof, finale | Demo, proof band, Fig. 08 |
| `--field-rest` (cream) | Breathing room | Fig. 01, 04, 07 |

Current sequence: signal → ink (demo) → rest → deep → agent → rest → rule → deep →
ink (proof) → rest → ink (finale).

**Placement rules**

- Bright red (`--field-signal`) is the hero and nothing else. Never add a second red field.
- The salmon rule field must never share a screen with the hero. Keep at least three
  sections between them.
- Never put two loud fields (signal, rule, agent) next to each other, and never two
  rests next to each other: that reads as one long "sea of text".
- Numerals and the hero slash are tone-on-tone: use the matching
  `--numeral-on-*` token for the field. Rests have no numeral.
- Small red text on light backgrounds uses `--accent-human-text`, not `--accent-human`
  (contrast).

## Type

Font sizes use the shared ramp or a role-specific token. **Never write a px font
size in component CSS.** Hero, honesty and closing-command sizes use fixed
breakpoints; check the longest word at the narrow edge of each breakpoint.

| Token | Use |
|-------|-----|
| `--t-display` | The hero headline only |
| `--t-honesty` | The honesty statement |
| `--t-command` | The closing command |
| `--t-statement` | Section headlines (the statement pattern) |
| `--t-title` | Sub-headlines, step titles, the demo intro |
| `--t-lead` | Opening paragraph of a section, `--weight-thin` |
| `--t-body` | Running text |
| `--t-small` | Notes, secondary UI |
| `--t-code` | Code, terminal output |
| `--t-label` | Uppercase mono labels, figure chips |

**The statement pattern.** The thin line is a *direct child* `<span>` of the `h2`:

```html
<h2>Access isn't enough.<br><span>Agents need good UX.</span></h2>
```

CSS targets `h2 > span:not(.lit-word)`, so light-up word spans stay heavy. In dark
fields the thin line takes the field's accent (mint on deep green); in light fields it
takes a muted or accent-text colour.

The hero must stay on two lines at 1440px ("COMMANDS ARE / THE PRODUCT."). If you
change `--t-display`, check it.

## Space

- Supporting sections use `padding-block: var(--section-pad)`; handoff, agent UX,
  build and the honesty check use `--statement-pad` for more space. The demo starts
  at `--space-6` so its headline peeks below the hero.
- Below every section headline: `var(--heading-gap)`.
- Inside components: the `--space-1`…`--space-9` scale.

## Section anatomy

Every numbered section has a figure label. Colour fields also get a giant numeral.
Snippets for each piece are in [references/patterns.md](references/patterns.md).

```html
<section class="agent-design" id="agent-ux">
	<span class="big-numeral" aria-hidden="true">03</span>
	<div class="wrap">
		<div class="editorial-heading">
			<span class="section-index"><span class="fig-chip">Fig. 03</span>Design for the agent</span>
			<h2>Access isn't enough.<br><span>Agents need good UX.</span></h2>
		</div>
		…
	</div>
</section>
```

- Figure numbers run in page order (01–08). Renumber when you move a section.
- Numerals sit bottom-right, bleeding off the edge; bottom-left when a panel fills the
  right side (recovery pattern). One size for all.
- Crop marks frame the hero poster, the honesty slab and live stages. Nothing else.
- No drafting grids or graph-paper backgrounds. They were tried and removed.

## Motion

- **Light-up** (`class="lit" data-lit`): words gain emphasis as the statement scrolls in;
  `--motion-rest-opacity` is 0.65 so the whole statement stays readable while the
  word-by-word emphasis remains visible. At
  most **three per page**, far apart. Currently "Your app isn't its buttons", the
  honesty check and "Before it draws a screen".
- **Stamp**: a `<mark>` inside a lit statement slams in at 1.35× scale when the
  statement completes. It stays readable throughout the animation.
- **Entrance**: the hero slash slides in once (`--motion-enter`, `--ease-out`).
- Every animation has a static state under `prefers-reduced-motion`. Animate only
  transform and opacity. Hide content with `hidden`/`inert`, never opacity alone.
  Statements also initialize when reduced motion is turned off after page load.
- Contract panels show live metadata and outcome summaries first. Full JSON is
  available in native disclosures with bounded, scrollable code regions.
- Section jumps add history entries and focus the destination heading. The finale
  renders one complete real result per run and blocks concurrent submissions.

## The live runtime

- Commands live in `site/js/runtime.js` (`todo-*`, `section-go`, `install-copy`,
  `view-set`, `get-started`, `log-clear`). They run on real afd-core, return real
  `CommandResult`s, and enforce `expose` per surface.
- Call them with `call(name, input, { surface })`, where `surface` is `ui`, `cli`,
  `palette` or `agent`.
- Add a command in `runtime.js`, following the existing ones: validation failures go
  through `invalid()` so they match afd-cli's output, and every error has a `suggestion`.

## Changing the design

1. Change a **token** when the change is systemic (a role, a size, a spacing step). Add
   a semantic token rather than reusing a primitive for a new role.
2. Change **manifesto-2.css** for one section. Use tokens only; no hex values, no px
   font sizes.
3. New section? Pick its field from the placement rules first, then follow the anatomy
   above.
4. Verify with [references/checklist.md](references/checklist.md) before committing.
