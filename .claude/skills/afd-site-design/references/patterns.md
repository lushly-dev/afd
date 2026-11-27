# Patterns

Markup for the recurring pieces of the AFD sites, shown on `site/styleguide.html`.
The product hero, the plain `d-section` and the parts a tool's page shares are in
[area-pages.md](area-pages.md).

## Figure label

Opens every numbered section. Numbers run from 01 in page order.

```html
<span class="section-index"><span class="fig-chip">Fig. 04</span>The recovery</span>
```

On dark and agent fields the chip inverts (mint on ink); on the salmon slab it's ink
with salmon text. That's handled in CSS per section.

## Statement headline

```html
<h2>A dead end.<br><span>Or a way <em>forward.</em></span></h2>
```

- The first line is heavy (Archivo Black). The direct child `<span>` is thin (Space
  Grotesk 300) at the same size.
- Add `class="lit" data-lit` to make it light up on scroll. Budget: three per page.

## Giant numeral

Colour fields only. First child of the section, before `.wrap`.

```html
<section class="handoff" id="workflow">
	<span class="big-numeral" aria-hidden="true">02</span>
	<div class="wrap">…</div>
</section>
```

The section needs `position: relative; isolation: isolate; overflow: clip`, a
`--numeral-fill`, and `> .wrap { position: relative; z-index: 1 }`. For a numeral at
bottom-left, override `right: auto; left: -0.05em`.

## The honesty slab

The page's second-loudest moment, in the salmon rule field.

```html
<section class="slab" id="honesty" aria-labelledby="honesty-quote">
	<span class="crop crop--tl" aria-hidden="true"></span> … (tr, bl, br)
	<span class="big-numeral" aria-hidden="true">05</span>
	<div class="wrap slab__inner">
		<span class="section-index"><span class="fig-chip">Fig. 05</span>The honesty check</span>
		<blockquote class="slab__quote lit" id="honesty-quote" data-lit>
			<p>“If it can’t be done via <mark>CLI</mark>, the architecture is wrong.”</p>
		</blockquote>
		<p class="slab__caption">One rule, applied to every feature. No UI-only code paths.</p>
	</div>
</section>
```

## Crop marks

Only on the hero poster, the honesty slab and live stages.

```html
<span class="crop crop--tl" aria-hidden="true"></span>
<span class="crop crop--tr" aria-hidden="true"></span>
<span class="crop crop--bl" aria-hidden="true"></span>
<span class="crop crop--br" aria-hidden="true"></span>
```

## Hero slash

The AFD slash as a tone-on-tone poster shape, at the wordmark's lean (`skewX(-20deg)`).

```html
<div class="opening-art" aria-hidden="true">
	<span class="slash"></span>
	<span class="slash slash--thin"></span>
</div>
```

The slash was chosen over diagonal stripes and a warm gradient. Keep the hero to this one shape.

The thin slash is for `index.html` only. A hero with a facts strip (the proposed home
pages and every tool's page) uses the wide slash alone: the thin one runs through the
facts.

## Mark

A small label on a fact. Its weight says how much stands behind the word.

```html
<span class="mark" data-mark="solid">Verified</span>   <!-- proven, complete -->
<span class="mark" data-mark="outline">Observed</span> <!-- seen, partly there -->
<span class="mark" data-mark="dashed">Declared</span>  <!-- stated, not run -->
<span class="mark" data-mark="plain">Authored</span>   <!-- someone's word -->
<span class="mark" data-mark="alert">Undeclared</span> <!-- needs a decision -->
```

A page script maps a tool's own words onto these five. Never mint, and red only for
the alert.

## Facts strip

Three facts under a rule, at the foot of a hero.

```html
<dl class="hero-facts">
	<div>
		<dt>34 commands</dt>
		<dd>Checked input goes in, a structured result comes out.</dd>
	</div>
	… two more …
</dl>
```

A count a reader can check, a way in, and the one difference. Read a count from the
tool (`data-command-count`), not from memory.

## "People get / agents get"

Pairs a drawn human UI pattern with its agent equivalent, inside the agent-UX tabs.

```html
<div class="translate" aria-hidden="true">
	<div class="ux-art"><div class="ua-dialog">…</div></div>
	<span class="translate__arrow">→</span>
	<span class="translate__agent">A person gets a confirmation dialog. An agent’s caller gets the same pause.</span>
</div>
```

Available drawings: `ua-menu` (discovery), `ua-toast` (feedback), `ua-dialog`
(confirmation).

## The family list

The rest of the AFD family (Specimen, FAST-AF, Violet, Umbel, Botcore, Loam), as a second block inside
the ink proof band. It isn't a numbered section, so it has no figure label or numeral.

```html
<div class="evidence family" id="family">
	<div class="evidence-heading">
		<h3>The same rule,<br><span>one layer up.</span></h3>
		<span class="mono">THE AFD FAMILY</span>
	</div>
	<p class="family-lead">…</p>
	<ul class="family-list">
		<li>
			<h4>Specimen</h4>
			<p>One or two sentences.</p>
			<span data-maturity="specimen" class="mono family-status family-status--out">Preview, on npm</span>
			<a href="specimen/" aria-label="Specimen: compare two captures">Compare two captures <i class="icon icon--right" aria-hidden="true"></i></a>
		</li>
	</ul>
</div>
```

- The heading is `--t-title`, not `--t-statement`: "Don't take it on faith" stays the
  band's one statement.
- `family-status--out` (paper) marks a project people can install; without it the status
  is muted. Mint and red keep their meanings, so neither is used for status.
- A status opens with its word from the one ladder (Stable, Beta, Preview, In development,
  Internal), then where it is: "Preview, on npm", "Beta, on PyPI", "In development, not
  released". The words and their meanings are in the README's "What each status means".
- Every status label (`.family-status`, `.edition`, the `.area-status` lead) carries
  `data-maturity="<part>"`. `pnpm check:maturity` checks its word against
  `scripts/release/inventory.json` and refuses a `.family-status` or `.edition` without
  one; `data-maturity="none"` marks an `.edition` that is not a status ("Open source,
  MIT"). To change a status, change the unit's `maturity` there, run
  `pnpm maturity:sync`, and fix what the check then names.
- On the proposed home pages, a tool with a page links to it on that side, with a link
  that says what you will do there; the rest link out to the repository.

## Buttons

```html
<a class="button button--ink" href="#inversion">See it in action <i class="icon icon--down" aria-hidden="true"></i></a>
<a class="button button--red" href="…">Open the quickstart <i class="icon icon--out" aria-hidden="true"></i></a>
<button class="button button--mint" type="button">Request deletion <i class="icon icon--right" aria-hidden="true"></i></button>
<a class="text-link" href="…">Read the thinking <i class="icon icon--out" aria-hidden="true"></i></a>
```

Buttons are keys: rounded and one step up, flat when pressed (`refined.css`). Use `--red` for
the primary CTA, `--ink` on light fields, `--mint` for agent actions.

## Finale

```html
<form class="finale__line" data-finale>
	<span class="finale__prompt" aria-hidden="true">$</span>
	<label class="finale__cmd" for="finale-run">afd call get-started</label>
	<button class="button button--red finale__run" id="finale-run" type="submit">Run …</button>
</form>
<pre class="finale__out" data-finale-out aria-live="polite" tabindex="0">…static fallback…</pre>
```

The `<pre>` holds a static fallback, so the CTA works without JS. `manifesto-2.js`
replaces it with the real `get-started` CommandResult on submit.
