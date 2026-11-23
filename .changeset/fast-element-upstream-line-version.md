---
"@lushly-dev/fast-element": patch
"@lushly-dev/violet-elements": patch
"@lushly-dev/specimen-fast-af": patch
---

`fast-element`'s version now names the Microsoft FAST Element release it carries: the next preview is `3.1.4-preview.0` instead of `3.0.1-preview.3` ([#1790](https://github.com/lushly-dev/afd/issues/1790)). Later releases on the 3.1.4 line count on from it (`.1`, `.2`) and need no release of the packages that build on it. `violet-elements` and `specimen-fast-af` release with this one, because their published `fast-element` peers (`^3.0.1-preview.2` and `^3.0.1-preview`) do not accept the 3.1.4 line; their new peers start at `^3.1.4-preview.0`.
