---
"@lushly-dev/specimen": minor
---

A component pack record now takes a component's default-state role from its open shadow tree when the component has none of its own: the role of the one accessible element there, as a component that keeps its control inside (a button's inner `button`) exposes it. Instances that were not rendered (no box) are not counted, and a laid-out instance with no role, or with two or more accessible elements in its shadow tree, still leaves the role out. A role taken from the shadow tree has no `name`. The pack format's version is unchanged.
