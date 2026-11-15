---
"@lushly-dev/violet-elements": minor
---

Make ARIA references reach their targets across shadow roots.

- `violet-button`: `aria-labelledby`, `aria-describedby`, `aria-errormessage` and `aria-controls` are now host attributes as well as properties. Their ids are found in the host's tree and set on the inner button as element references, so they resolve; `aria-description` is forwarded.
- `violet-tooltip`: describes its trigger with `aria-description` (from `content`) or by adding the slotted content's ids to the trigger's `aria-describedby`, keeping the trigger's own ids, instead of overwriting it with an id inside the tooltip's shadow root.
- `violet-menu` and `violet-teaching-tip`: where shadow roots support Reference Target, the trigger's `aria-controls` names the host (given an id if it has none) and reaches the panel; elsewhere `aria-controls` is left off instead of naming an unreachable id.
