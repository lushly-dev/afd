---
"afd-spec": patch
---

[`pipeline-variables.md`](./pipeline-variables.md) now names the exact whitespace set forbidden in
pipeline reference keys and step aliases ([#1962](https://github.com/lushly-dev/afd/issues/1962)):
JavaScript's `\s` (ECMAScript `WhiteSpace` and `LineTerminator`, 25 code points: `U+0009`–`U+000D`,
`U+0020`, `U+00A0`, `U+1680`, `U+2000`–`U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`
and `U+FEFF`). Characters outside this set (such as `U+001C`–`U+001F` and `U+0085`) are allowed in
keys and aliases; `U+00A0` and `U+FEFF` are whitespace.

[`vectors/pipeline-variables.json`](./vectors/pipeline-variables.json) adds keys and vectors for
`U+0085`, `U+001C`, `U+00A0` and `U+FEFF` (both reference resolution and `$exists` conditions).

Behaviour change: Python and Rust now use the explicit 25-code-point ECMAScript `\s` class for
pipeline reference keys and aliases, matching TypeScript and C++. Before, Python's `re` `\s` treated
`U+001C`–`U+001F` and `U+0085` as whitespace and omitted `U+FEFF`, while Rust's `regex` `\s` treated
`U+0085` as whitespace and omitted `U+FEFF`. `spec/vectors/pipeline-variables.json` adds cases for
these characters.
