---
"afd-python": patch
---

### Fixed

- **`afd-help` in the `full` format leaves out empty `tags` and `examples`** (#1480; `spec/command-metadata.md`, "Reporting rules"): every command that declared none was reported with `tags: []` and `examples: []`, where `afd-detail` and the TypeScript, Rust and C++ `afd-help` leave them out. They are still reported when set.
