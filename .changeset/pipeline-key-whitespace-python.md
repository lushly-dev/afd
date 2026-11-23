---
"afd-python": patch
---

### Fixed

- **Pipeline reference keys and aliases match JavaScript's `\s` whitespace set** ([#1962](https://github.com/lushly-dev/afd/issues/1962); `spec/pipeline-variables.md`). `parse_reference`, `parse_path`, `get_nested_value`, `resolve_variable`, `resolve_variables`, `evaluate_condition` and `reads_step_data` now use an explicit 25-code-point character class matching ECMAScript `WhiteSpace` and `LineTerminator` instead of Python `re`'s Unicode `\s`: `U+001C`–`U+001F` and `U+0085` are now allowed in keys and aliases (resolving and enforcing expansion limits as in TypeScript and C++), and `U+FEFF` (BOM) is treated as whitespace (making strings containing it literals).
