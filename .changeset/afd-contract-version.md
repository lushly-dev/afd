---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

`@lushly-dev/afd-core` exports `AFD_CONTRACT_VERSION`, the version of the AFD contract the package implements. The contract is the wire shapes, pipeline variables, behavior vectors and conformance suite that the TypeScript, Python, Rust and C++ implementations share. Its `MAJOR.MINOR` version lives in `spec/VERSION` and is independent of the package version. It reads `1.0-rc` until every language loads every vector file.

The `afd-help` bootstrap command returns it as `contractVersion`, so an agent can tell which contract a server implements.
