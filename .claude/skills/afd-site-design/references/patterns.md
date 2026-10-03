# Patterns

Markup for the recurring pieces of Command Manifesto 2. All of them are live on
`site/index.html` and shown on `site/styleguide.html`.

## Figure label

Opens every numbered section. Numbers run 01–08 in page order.

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

The slash was chosen over two alternatives (diagonal stripes, a warm gradient); see
`history.md`. Keep the hero to this one shape.

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

## Buttons

```html
<a class="button button--ink" href="#inversion">See it in action <i class="icon icon--down" aria-hidden="true"></i></a>
<a class="button button--red" href="…">Open the quickstart <i class="icon icon--out" aria-hidden="true"></i></a>
<button class="button button--mint" type="button">Request deletion <i class="icon icon--right" aria-hidden="true"></i></button>
<a class="text-link" href="…">Read the thinking <i class="icon icon--out" aria-hidden="true"></i></a>
```

Buttons are the only rounded elements. Use `--red` for the primary CTA, `--ink` on
light fields, `--mint` for agent actions.

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
