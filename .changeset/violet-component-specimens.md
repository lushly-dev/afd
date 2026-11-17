---
"@lushly-dev/violet-core": minor
"@lushly-dev/violet-afd": minor
---

Component specimens for a text block (`text`), a link (`link`), a checkbox (`checkbox`) and a focus ring (`focus`), with new roles `font.family`, `line.height`, `underline`, `underline.offset`, `size`, `check`, `ring`, `ring.width` and `ring.offset`. Each role turns its value into a declaration only through an allow-list validator; `safeTextDecoration` is new in `@lushly-dev/violet-core/css`, and the checkbox's check colour is drawn through the `--violet-specimen-check` custom property. Each entry of `SPECIMEN_COMPONENTS` now lists its own `roles` and the `required` role it cannot be drawn without (the text block and link need `foreground`, the focus ring needs `ring`); `specimenComponentHasRole` checks a pair. `specimen.get` reports each component's own roles and its `required` role, and `specimen.set` refuses a role the component does not take, suggesting that component's roles. Button, input and card keep their ten roles.
