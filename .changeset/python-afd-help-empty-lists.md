---
"afd-python": minor
---

### Breaking changes

- **`afd-help` in the `full` format leaves out empty lists** ([#1480](https://github.com/lushly-dev/afd/issues/1480)): an entry no longer carries `tags` or `examples` when the command declares none (see Fixed). Code that reads one of them, such as `entry["tags"]`, should treat a missing key as empty.

### Fixed

- **`afd-help` in the `full` format leaves out empty `tags` and `examples`** ([#1480](https://github.com/lushly-dev/afd/issues/1480); `spec/command-metadata.md`, "Reporting rules"): every command that declared none was reported with `tags: []` and `examples: []`, where `afd-detail` and the TypeScript, Rust and C++ `afd-help` leave them out. They are still reported when set.
