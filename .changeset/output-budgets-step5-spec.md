---
"afd-spec": patch
---

Promote `spec/output-budgets.json` to `spec/vectors/output-budgets.json` now that all four languages (TypeScript, Python, Rust and C++) implement B1–B8 and load the shared vectors (#1993). Add `dev.afd/outputBudget` to the `meta` argument description of all five meta-tools in `spec/meta-tools.json`, update `spec/context-fields.md`, `spec/output-budgets.md`, `spec/protocol-conformance.md` and `spec/vectors/README.md`, and move the feature documentation to `docs/features/complete/output-budgets/`.
