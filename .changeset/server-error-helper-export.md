---
'@lushly-dev/afd-server': patch
---

Re-export the core `error(code, message, options)` helper from `@lushly-dev/afd-server`, alongside `success` and `failure`, so the documented `import { defineCommand, success, error } from '@lushly-dev/afd-server'` compiles.
