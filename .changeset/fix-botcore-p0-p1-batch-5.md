---
"lushly-botcore": patch
---

### Security
- Reject shell metacharacters (`\n`, `\r`, `\0`, backticks, `$` expansion, subshells, redirections, single `&`, `&&&`, `|||`) and vacuous/empty shell segments in `botcore-llm` command permission checks (#1871).
- Enforce `tenant_id` and `allowed_groups` authorization on `TeamsBot.on_invoke_activity()` and normalize missing AAD/tenant fields safely in `botcore-teams` (#1872).
- Reject Windows drive/backslash/NUL escapes in `CommandHost` `package` validation (#1873).

### Fixed
- Parse actual TypeScript (`vitest`) and Rust (`cargo-tarpaulin`) coverage percentages from isolated per-run report directories in `dev_check_coverage`, rejecting failed runs, stale reports, and invalid percentages instead of hardcoding `0` (#1874).
- Use atomic owner-only (`0600`) temp-file writes (`mkstemp` + `fsync` + `os.replace`, with short retry on Windows `PermissionError`), per-file scope locks, and concurrent-deletion tolerance in `botcore-memory` `LocalMemoryStore` (#1875).
