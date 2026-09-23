---
'@lushly-dev/afd-core': minor
---

Add `@lushly-dev/afd-core/connectors` for `GitHubConnector`, `PackageManagerConnector` and their types. The root entry still re-exports them, now marked `@deprecated`; those re-exports will be removed in the next major version. They pull `node:child_process` into any bundle of the root entry, so until then a browser bundle of even `import { success } from '@lushly-dev/afd-core'` fails. Import connectors from the subpath, and use `@lushly-dev/afd-core/result` or `/commands` in browser code.

Minor: a new subpath plus deprecations; nothing is removed.
