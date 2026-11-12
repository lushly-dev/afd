---
'@lushly-dev/specimen': patch
---

The accessibility check runs axe-core 4.14.0, which turns on `label-content-name-mismatch` (WCAG 2.5.3, Label in Name): a labelled control whose accessible name does not contain the text it shows now fails a story under the `error` policy. The rule counts every text visible on screen, `aria-hidden` or not. The bench's accessibility ceiling moves from 650,000 to 680,000 bytes, since axe-core 4.14.0 is 659,293; the 1,300,000 total is unchanged.
