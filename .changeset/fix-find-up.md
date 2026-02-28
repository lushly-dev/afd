---
'@lushly-dev/afd-core': patch
---

fix(core): upgrade find-up 7→8 to fix unicorn-magic version conflict

find-up@7.0.0 declares unicorn-magic@^0.1.0 but uses the toPath API from >=0.3.0. Consumers get 0.1.0 resolved by npm, causing "No matching export for toPath" at Vite startup. find-up@8.0.0 correctly requires unicorn-magic@^0.3.0.
