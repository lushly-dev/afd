---
"afd-spec": patch
---

[`pipeline-variables.md`](./pipeline-variables.md), "Limits", says exactly how the expansion budget is counted, so all four implementations reach the same verdict at its boundaries ([#1722](https://github.com/lushly-dev/afd/issues/1722)):

- **Template values:** each one costs a value, and literal strings and object keys also cost their characters.
- **References:** a resolved reference costs a value, and an unresolved one costs a value only in an array.
- **Repeats:** a referenced value is charged in full only when the step input has already expanded it. An object or array counts as the same by its location, so `$prev` and `$steps[N]` naming one step reach the same values. TypeScript compares objects by identity, so in-process data sharing one object counts once there. A non-empty string counts as the same when it is equal.
- **Cycles:** a reference may pass through circular in-process step data, but copying a cycle into a step input fails as nested too deep.
- **Characters:** counted in UTF-16 code units.
- **Error details:** the failure is `{ stepIndex, limit }`, where `limit` is `"depth"`, `"nodes"` or `"chars"`.

The conformance minimum adds three cases: a referenced value nested 65 levels deep, repeated fan-out over the value budget, and one large reference under it.
