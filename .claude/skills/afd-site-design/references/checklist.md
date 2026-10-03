# Verification checklist

Run this before committing a site design change.

## Tokens and type

- [ ] No new hex colours in `manifesto-2.css`. Check with:
      `grep -nE '#[0-9a-fA-F]{3,6}\b' site/css/manifesto-2.css` (expected: none)
- [ ] No px font sizes, including in the `font:` shorthand. Check with:
      `grep -nE 'font-size:\s*[0-9]+px|font:\s*([0-9]{3}\s+)?[0-9]+px' site/css/manifesto-2.css` (expected: none)
- [ ] A new systemic value became a token in `tokens-m2.css`, with a comment saying
      what it's for.

## Colour placement

- [ ] Bright red appears only in the hero.
- [ ] The salmon honesty slab and the hero never share a screen at 1440×900.
- [ ] No two loud fields (signal, rule, agent) and no two rests are adjacent.
- [ ] Numerals only on colour fields, with the matching `--numeral-on-*` fill.
- [ ] Figure numbers run in page order.

## Layout and motion

- [ ] Hero headline is two lines at 1440×900 and larger than section headlines at 375px.
- [ ] No horizontal overflow at 375px. In the browser console:
      `[...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('pre, .big-numeral, .opening-art'))`
      should return an empty list.
- [ ] At most three `data-lit` statements.
- [ ] Every animation has a reduced-motion state.

## Behaviour

- [ ] No console errors.
- [ ] The List / Board / Terminal / Agent demo still updates one shared list.
- [ ] Terminal: an invalid call prints a real `VALIDATION_ERROR` with a suggestion.
- [ ] The agent view opens and returns.
- [ ] The finale's `afd call get-started` prints a result.

## Gotchas

- **Caching.** `python3 -m http.server` lets browsers cache CSS and JS. In the in-app
  browser, refresh with
  `await Promise.all(['/','/index.html','/css/manifesto-2.css','/css/tokens-m2.css','/js/manifesto-2.js'].map(a => fetch(a, {cache:'reload'}))); location.reload()`.
  People should hard-refresh (⌘⇧R).
- **Headless screenshots.** A very tall headless Chrome window makes `vh` enormous, so
  sections sized in `vh` look wrong and scroll-driven effects look unlit. Check those in
  a real 1440×900 window instead.
- **Hidden tabs.** Background tabs throttle timers, so the demo autoplay and typing
  crawl. That isn't a bug.
