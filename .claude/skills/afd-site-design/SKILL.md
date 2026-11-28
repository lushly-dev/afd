---
name: afd-site-design
description: >
  Design rules for the AFD websites in site/ (afd.dev, afd.design): tokens,
  colour fields, type, heroes, sections, tool pages, the Refined interface,
  motion and checks. Use when editing a page or its CSS, adding a section or
  tool page, or reviewing site design; for Loam's chrome, use loam-design.
---

# AFD Site Design

The site argues that **commands are the product**, so each page is itself an AFD
app: every live demo runs real command code in the browser. The design follows one
idea: **one loud thing at a time, then room to breathe.**

## Two sides

AFD has two sites that share one wordmark, type system and token layer:

- **afd.dev, Agent-First Development.** Opens on red (a person, the UI). Commands,
  code and packages.
- **afd.design, Agent-First Design.** Opens on mint (an agent). What a person sees
  and what an agent is told.

A tool's page has the same address on both sides (`site/violet/` and
`site/design/violet/`), and the Dev/Design switch in the nav links the pair. `<html>`
carries `data-side="dev"` or `data-side="design"`. Give a tool a page on both sides
only when each has something of its own to say.

**Public and working pages.** Every page is public (listed in `site/sitemap.xml`, no
`noindex`, a title naming Agent-First Development or Agent-First Design) except the
redirects, `404.html` and the working pages (`styleguide.html`, `fast-af/review/`), which
carry `noindex`; a working page says "A working page" where a visitor reads it.
`scripts/check-site.mjs` keeps the sitemap equal to the indexable pages and
`scripts/site-indexing.test.mjs` checks what each public page says; a new page goes in the
sitemap or in that test's `NOT_PUBLIC` list. A tool's page says what AFD is under its crumb (`.crumb-about`).

## Files

| File | What it is |
|------|------------|
| `site/index.html`, `site/design/index.html` | The dev home and the design home. `manifesto-3.html` and `manifesto-2.html` redirect to the dev home. |
| `site/<tool>/`, `site/design/<tool>/` | A tool's page, dev side and design side. |
| `site/css/tokens-m2.css` | **The token layer.** Every colour, size, space, motion and layer value. |
| `site/css/manifesto-2.css` | Base section and component styles. Tokens only. |
| `site/css/manifesto-3.css` | The proposal's changes to the base, loaded by every proposal page: nav switch, home hero, facts strip, the no-widows rule. |
| `site/css/area.css` | Scaffolding for the design home and every tool's page: the product hero and the plain `d-section`. |
| `site/css/area-kit.css` | Parts more than one tool's page uses: marks, chips, code tabs, package layers, install rows, steps, the foot. |
| `site/css/design.css` | The design side's mint hero and the design home's figures. |
| `site/css/<tool>.css`, `<tool>-dev.css` | One tool's own figures: shared by its two pages, then dev only. |
| `site/css/refined.css` | **The interface layer, Refined.** Loaded last by every page; rounds, raises and wells the controls, panels and drawn UI. See Interface below. |
| `site/svg/icons/site/` | The control icons, one `.icon--<name>` mask each in `manifesto-2.css`, drawn in Violet's system style (1.75 line, round caps, 2 to 2.5 corners). An icon-kit set: each icon's `icon.json` beside `outline-24.svg`, with `brief.md` and `provenance.md`. Draw a new one from scratch, never from an icon library; `foundations/fast-af/packages/violet-elements/icons/ATTRIBUTION.md` says how. |
| `site/js/runtime.js` | The home pages' command registry. |
| `site/js/<tool>-runtime.js` | A tool's commands in the page, over a bundle in `site/js/vendor/`, or its recorded run. |
| `site/<tool>/` beside the page | What the tool wrote for the page, unedited: Specimen's `captures/` and `pack/`, Umbel's and Botcore's `runs.json`, FAST-AF's `library.json`. |
| `site/js/widows.js`, `statements.js` | No one-word last lines; statements that light up. Every page imports both. |
| `scripts/build-site-*.mjs` | Build a vendor bundle (Violet, FAST-AF), the captures and the pack (Specimen), a recorded run (Umbel, Botcore), or the social preview image (`og`, `site/og.png`). |
| `site/styleguide.html` | Living style guide, a working page. Reads tokens and draws samples from the real CSS, so it can't drift. |
| The family map on both homes | Generated from `scripts/release/inventory.json` (each map part's `summary` and `site` links) between `generated:maturity:map` markers; edit the inventory and run `pnpm maturity:sync`, never the block. |

Stylesheet order on a tool's page: `tokens-m2`, `manifesto-2`, `manifesto-3`, `area`,
`area-kit`, then `design` (design side only), then the tool's own.

The site's tokens are its own, though some share a name with Violet's old unprefixed ones
(`--color-text-muted`, `--shadow-well`, `--weight-medium`). The shared components read Violet's
`--violet-*` properties (violet-elements' token interface, version 4), so CSS that styles them,
in `site/fast-af/themes/` and `site/js/fast-af-*.js`, names `--violet-color-text-muted`, never the
site's token.

## Principles

1. **Show, don't claim.** Demos call real commands. Every number on a page is read
   from a run, not typed in. Scripted parts are labelled as scripted.
2. **Say what it is first.** Someone who lands on a page knows what it is before
   they scroll. A slogan is not a description.
3. **One loud thing at a time.** A hero colour appears once as a hero. Loud fields are
   separated by rests.
4. **Colour has one job.** Red means a person or the UI; mint means an agent. A field
   colour tells you what kind of section you are in.
5. **Heavy, then thin.** Statements pair an Archivo Black line with a Space Grotesk
   Light line at the same size: the claim, then its turn.
6. **Room to breathe.** Sections are generous; backgrounds never hug their content.
7. **Motion marks a moment.** Nothing loops behind reading.

## Colour fields

Use the semantic field tokens, never raw colours. Full list in
[references/tokens.md](references/tokens.md).

| Field token | Job | Where it's used |
|-------------|-----|-----------------|
| `--field-signal` (bright red) | The single loudest statement | **A dev-side hero only** |
| `--field-rule` (salmon) | A page's one-line slab | The honesty check; a tool's "in one line" |
| `--field-agent` (mint) | The agent | A design-side hero; any section about the agent |
| `--field-deep` (dark green) | The agent at work | Handoff, build, package layers, a page's foot |
| `--field-ink` | Live demos, proof, finale | Demos and terminals |
| `--field-rest` (cream) | Breathing room | Between colour fields |

**Placement rules**

- Bright red is a dev-side hero and nothing else. Never add a second red field.
- The salmon slab must never share a screen with the hero. Keep at least two sections
  between them.
- Never put two loud fields (signal, rule, agent) next to each other, and never two
  rests next to each other: that reads as one long "sea of text". Avoid two dark
  fields (ink, deep) in a row as well.
- Numerals and the hero slash are tone-on-tone: use the matching
  `--numeral-on-*` token for the field. Rests have no numeral.
- Small red text on light backgrounds uses `--accent-human-text`, not `--accent-human`
  (contrast).

**Dark scheme.** `prefers-color-scheme: dark` turns only the light surfaces: the page,
rests and their `--color-*` text, lines and accents (`tokens-m2.css`, section 8). The
colour fields keep their colour, and the fields and light demo windows listed there take
the light set back. So: text on a rest reads `--color-text`, never `--ink`, which stays the
fixed dark half of the ink/paper pair; text on a mint or red fill reads `--color-on-accent`.
A new loud field or light window joins that list, or carries `data-scheme="light"`.

## Interface: Refined

The site's controls follow AFD's component design, Refined (lushly-dev/afd#1430, decided by
the owner on 2026-11-17), so the site and the components it sells look like one system. It is
`site/css/refined.css`, loaded last by every page, its rules under `:root` so they outrank the
page styles. Put new interface parts there, or style them the same way.

- **Interface text is Inter** (`--font-ui`): navigation, buttons, fields, tabs, chips, pickers,
  and the text inside drawn UI. Headlines, statements, paragraphs and code keep Archivo Black,
  Space Grotesk and IBM Plex Mono; figure labels and section indexes stay mono.
- **Press or type into it: rounded** (`--radius-control` 8px, `--radius-mark` 5px for small marks);
  **panels a step more** (`--radius-panel` 14px). Posters, colour fields, figure chips and crop
  marks stay square: the rounding is the contrast to them.
- **Surfaces and shadows, not outlines.** Filled buttons are keys (`--shadow-key`, flat with
  `--shadow-key-pressed`); an outline button is a tonal key; fields are wells (`--well`,
  `--shadow-well`); panels float (`--shadow-float`, `--shadow-float-dark` on dark fields).
  Tabs are keys, the open one filled with a 2px line inside its foot; a segmented control is a
  well with the chosen segment raised.
- **Drawn UI is Refined too.** An illustration of a menu, dialog, toast or window draws it the way
  the components would.
- **Forced colours:** an edge removed for a shadow comes back in the forced-colours block.

## Type

Font sizes use the shared ramp or a role-specific token. **Never write a px font
size in component CSS.** A size between two steps is a fraction of a step
(`calc(var(--t-display) * 0.8)`), never a new pixel value. Hero, honesty and
closing-command sizes use fixed breakpoints; check the longest word at the narrow
edge of each breakpoint.

| Token | Use |
|-------|-----|
| `--t-display` | A hero's poster line or a tool's name |
| `--t-honesty` | The honesty statement |
| `--t-command` | The closing command |
| `--t-statement` | Section headlines (the statement pattern) |
| `--t-title` | Sub-headlines, step titles, a hero's "what it is" line |
| `--t-lead` | Opening paragraph of a section, `--weight-thin` |
| `--t-body` | Running text |
| `--t-small` | Notes, secondary UI |
| `--t-code` | Code, terminal output |
| `--t-label` | Uppercase mono labels, figure chips, marks |

**The statement pattern.** The thin line is a *direct child* `<span>` of the `h2`:

```html
<h2>Access isn't enough.<br><span>Agents need good UX.</span></h2>
```

CSS targets `h2 > span:not(.lit-word)`, so light-up word spans stay heavy. In dark
fields the thin line takes the field's accent (mint on deep green); in light fields it
takes a muted or accent-text colour. Keep each line short enough to sit on one line
at 1440px: a thin line that wraps leaves a one-word last line.

**Running text never ends on one word.** `p, li, dd, figcaption, blockquote` use
`text-wrap: pretty`, and `js/widows.js` ties the last two words together where a
browser lacks it. Display type (`.display`, `.slab__quote p`) is exempt. A hyphenated
name in running text (FAST-AF) goes in `<span class="keep">` so it cannot break at
the hyphen.

**A comparison table holds only rows that differ.** A row with the same value in
every column reads as a mistake. If it is the control (what was held equal), say it
in one sentence under the table.

## Heroes

A **home page** opens on a poster: one loud line (four fifths of display above
850px), then the name in bold and what it is, the way in, and three facts. It keeps
its crop marks and has no proof figure.

A **tool's page** opens on a product hero: the name, one line naming what kind of
thing it is, 15 to 35 words of description, the way in, one small picture as proof,
and three facts. No crop marks. Neither hero uses the thin slash, which would run
through the facts. Markup and the rules for each part are in
[references/area-pages.md](references/area-pages.md).

On `index.html`, the hero must stay on two lines at 1440px ("COMMANDS ARE / THE
PRODUCT."). If you change `--t-display`, check it.

## Space

- Supporting sections use `padding-block: var(--section-pad)`; statements use
  `--statement-pad` for more space. On the home page the demo starts at `--space-6`
  so its headline peeks below the hero.
- Below every section headline: `var(--heading-gap)`.
- Inside components: the `--space-1`…`--space-9` scale.

## Section anatomy

Every numbered section has a figure label. Colour fields also get a giant numeral.
Snippets for each piece are in [references/patterns.md](references/patterns.md).

```html
<section class="d-section d-section--deep" id="packages">
	<span class="big-numeral" aria-hidden="true">03</span>
	<div class="wrap">
		<div class="editorial-heading">
			<span class="section-index"><span class="fig-chip">Fig. 03</span>The layers</span>
			<h2>Five packages.<br><span>Take the layer you need.</span></h2>
		</div>
		…
	</div>
</section>
```

- The design home and every tool's page use `d-section` with one of `--rest`, `--ink`,
  `--deep` or `--agent`; the modifier sets the field, the numeral fill and the thin
  line's colour. `index.html` uses a class per section.
- Figure numbers run in page order from 01. Renumber when you move a section, and
  the numeral with it.
- Numerals sit bottom-right, bleeding off the edge; bottom-left when a panel fills the
  right side (recovery pattern). One size for all.
- Crop marks frame a home page's hero poster, the salmon slab and live stages. Nothing
  else.
- No drafting grids or graph-paper backgrounds. They were tried and removed.

## Marks

A mark is a small mono label on a fact: a status, a result, where the fact came from.
Its weight says how much stands behind the word, the same way on every page. Use
`class="mark"` with `data-mark`:

| `data-mark` | Means | Looks |
|-------------|-------|-------|
| `solid` | Proven, or complete | Ink, filled |
| `outline` | Seen, or partly there | Ink, outlined |
| `dashed` | Stated but not run, or not available | A broken outline |
| `plain` | Someone's word | No box |
| `alert` | Needs a decision | The one red mark |

A mark is never mint, and red is only the alert. Map a tool's own words onto these
five in the page script (Specimen's `verified`, `observed`, `declared`, `authored`);
don't add a sixth look.

## Motion

- **Light-up** (`class="lit" data-lit`): words gain emphasis as the statement scrolls in;
  `--motion-rest-opacity` is 0.65 so the whole statement stays readable while the
  word-by-word emphasis remains visible. At most **three per page**, far apart.
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

- A home page's commands live in `site/js/runtime.js` (`todo-*`, `section-go`,
  `install-copy`, `view-set`, `get-started`). They run on real afd-core, return real
  `CommandResult`s, and enforce `expose` per surface. Call them with
  `call(name, input, { surface })`, where `surface` is `ui`, `cli`, `palette` or
  `agent`. Validation failures go through `invalid()` so they match afd-cli's output,
  and every error has a `suggestion`.
- A tool's page runs that tool. Find the part of the tool that can really run in a
  browser tab, bundle it into `site/js/vendor/`, and build the page's demo on it.
  Where a part cannot run in a tab, say which part and why, and let the command
  report it the way it reports any failure.
  [references/area-pages.md](references/area-pages.md) has both tools' approaches.

## Changing the design

1. Change a **token** when the change is systemic (a role, a size, a spacing step). Add
   a semantic token rather than reusing a primitive for a new role.
2. Change one section in the stylesheet that owns it. Tokens only; no hex values, no
   px font sizes.
3. A part a second tool's page needs moves to `area-kit.css`, with a neutral name.
   Compare full-page screenshots of the pages that used it, before and after.
4. New section? Pick its field from the placement rules first, then follow the anatomy
   above. New page for a tool? Start from
   [references/area-pages.md](references/area-pages.md).
5. Verify with [references/checklist.md](references/checklist.md) before committing.
