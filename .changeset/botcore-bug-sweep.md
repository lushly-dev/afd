---
"lushly-botcore": minor
---

### Added

- Expose all 33 `cdp_*` commands through `botcore.commands.__all__`, `botcore cdp <subcommand>`, `CORE_DOCS["cdp"]`, and `CDP_POLICIES` in `botcore.host` (#778).

### Fixed

- **`skill-usage-collect`** upgrades stored `remote: false` projects to `owner/name` once git can read their origin, refiling historical events and sessions and clearing duplicate `quiet` entries (#2052).
- **`CommandHost.execute`**, `disk_*` and `skill_usage_*` commands offload synchronous blocking bodies with `asyncio.to_thread` (preserving `Step` thread bindings), `run_command` isolates subprocesses in their own process group and terminates the group on timeout or cancellation, and `run_external_tool` runs the path resolved by `shutil.which` (#1794).
- **`cdp_*` commands** persist `cdp_select_page`, `cdp_resize`, and `cdp_emulate` (including real `user_agent` and `cpu_throttle` CDP emulation), back `cdp_list_network`/`cdp_get_network` with Performance Resource Timing entries, return structured `CommandResult` errors instead of raising on unreachable browsers or invalid regexes, and fix `cdp_perf` double-wrapping and unsupported cross-call tracing (#778).
