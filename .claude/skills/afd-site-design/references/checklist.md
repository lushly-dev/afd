# Verification checklist

Run this before committing a site design change.

## Tokens and type

- [ ] No hex colours in any stylesheet but the token layer. Check with:
      `grep -nE '#[0-9a-fA-F]{3,6}\b' site/css/*.css | grep -v tokens-m2` (expected: none)
- [ ] No px font sizes, including in the `font:` shorthand. Check with:
      `grep -nE 'font-size:\s*[0-9.]+px|font:\s*([a-z0-9()-]+\s+)*[0-9.]+px' site/css/*.css | grep -v tokens-m2`
      (expected: none)
- [ ] A size between two ramp steps is a fraction of a step, not a new value.
- [ ] A new systemic value became a token in `tokens-m2.css`, with a comment saying
      what it's for.

## Colour placement

- [ ] Bright red appears only in a dev-side hero; a design-side page opens on mint.
- [ ] The salmon slab and the hero never share a screen at 1440×900.
- [ ] No two loud fields (signal, rule, agent), no two rests and no two dark fields
      (ink, deep) are adjacent.
- [ ] A mark is one of the five (`solid`, `outline`, `dashed`, `plain`, `alert`); none is mint.
- [ ] Numerals only on colour fields, with the matching `--numeral-on-*` fill.
- [ ] Figure numbers run in page order.

- [ ] Text meets AA (4.5:1, 3:1 for large) in both schemes, measured against what is
      painted under it, the hero's slash included. Emulate `prefers-color-scheme: dark`.
- [ ] `node scripts/check-site.mjs` passes: the conformance count and the sitemap follow
      the repository.

## Layout and motion

- [ ] Hero headline is two lines at 1440×900 and larger than section headlines at 375px.
- [ ] No horizontal overflow at 375, 500, 620, 900 and 1440px:
      `document.documentElement.scrollWidth - innerWidth` is 0 at each. Check the widths
      between breakpoints too; one bug lived only from 441 to 620px.
- [ ] A tool's name fits its column at 1100, 1440 and 1920px (`.area-name--long` for
      eight letters or more).
- [ ] No one-word last line in running text at 1440px. A thin headline line that wraps
      is the usual cause: shorten it.
- [ ] At most three `data-lit` statements.
- [ ] Figure numbers and numerals run in page order after any move.
- [ ] Every animation has a reduced-motion state.

## A tool's page

- [ ] The first screen says what the tool is: name, the kind of thing, 15 to 35 words,
      the way in, a proof figure, three facts.
- [ ] Every number is read from the tool or its data. Change the data and the page
      follows.
- [ ] The status block matches the tool's README: what is released, what is not.
- [ ] The switch and the footer link the same tool on the other side, and both home
      pages' family rows link here.
- [ ] After moving a rule into `area-kit.css`, full-page screenshots of every page that
      used it match the ones taken before.
- [ ] `site/styleguide.html` shows any new shared part.

## Behaviour

- [ ] No console errors.
- [ ] The List / Board / Terminal / Agent demo still updates one shared list.
- [ ] Terminal: an invalid call prints a real `VALIDATION_ERROR` with a suggestion.
- [ ] The agent view opens and returns.
- [ ] The finale's `afd call get-started` prints a result.

## Gotchas

- **Lazy images in element screenshots.** `loading="lazy"` images can be missing from a
  headless element screenshot. Small figures don't need it.
- **Caching.** `python3 -m http.server` lets browsers cache CSS and JS. In the in-app
  browser, refresh with
  `await Promise.all(['/','/index.html','/css/manifesto-2.css','/css/tokens-m2.css','/js/manifesto-2.js'].map(a => fetch(a, {cache:'reload'}))); location.reload()`.
  People should hard-refresh (⌘⇧R).
- **Headless screenshots.** A very tall headless Chrome window makes `vh` enormous, so
  sections sized in `vh` look wrong and scroll-driven effects look unlit. Check those in
  a real 1440×900 window instead.
- **Hidden tabs.** Background tabs throttle timers, so the demo autoplay and typing
  crawl. That isn't a bug.
