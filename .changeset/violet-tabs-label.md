---
"@lushly-dev/violet-elements": minor
---

`violet-tabs` takes a `label` attribute that names its tab list (#1585). The `role="tablist"` element is in the shadow root, so nothing named it before, and two tab sets on one page were both announced as unnamed tab lists. `label` is not shown; name every tab set on a page that has more than one. An `aria-label` on the host still does not reach the tab list, and would name only the host, which has no role, so use `label` instead.
