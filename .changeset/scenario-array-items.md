---
'@lushly-dev/afd-testing': minor
---

Scenario expectations match an array that holds objects item by item. The arrays must have the same length, and each object item checks only the fields it names and may use matchers, as a nested object always could: `violations: [{ number: 203, rule: { contains: one execution } }]` now passes against a violation whose `rule` contains that text, where it was compared literally and could never pass. A failure names the item (`data.violations[0].rule`), and a different length fails as `data.violations.length`. Matchers inside items are validated like any other. An array of plain values is still compared whole, and `{ equals: [...] }` still compares any array literally, so use it where an object item was meant as a literal.
