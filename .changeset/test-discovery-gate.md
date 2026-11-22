---
"lushly-botcore": minor
---

### Added

- **`gate-discipline` test-discovery guard (`scripts/check-test-discovery.mjs`)** checks that every tracked JavaScript/TypeScript, Python, C++ and Rust test file is claimed by an active test runner (Vitest, Vite, Playwright, Jest, `node --test` and active JS launchers, pytest, CMake/CTest, Cargo, or workflow-verified custom drivers), reconciles in both directions so dead runners and stale or recovered `unrun` exemptions in `scripts/policy/test-discovery.json` fail loudly, and runs with Node and git alone (#1519).
