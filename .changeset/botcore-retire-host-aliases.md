---
"lushly-botcore": minor
---

### Breaking changes

- **`create_host_mcp_server` no longer serves the `{name}-start`, `{name}-call` and `{name}-docs` tools (#2505).** They were compatibility aliases for AFD's own tools and shipped as such in 0.10.0. A client calls these instead:
  - **`{name}-start`:** `afd-discover` lists the commands, and `afd-detail` gives each one's description, input schema and declared effects. Each command now carries its effects as `effect:<name>` tags, which `afd-discover` also filters on. The new `info_catalog` command returns what `-start` did: every catalog row the caller may see, with its policy, plus the host's profile and documentation topics. It leaves out `-start`'s absolute `workspace` and `target`, as the HTTP host's catalog does; `info_workspace` has them where a host serves it.
  - **`{name}-call`:** `afd-call` takes `{"command": ..., "input": {...}}` where the alias took `arguments`.
  - **`{name}-docs`:** the new `info_docs` command.

  The three names stay reserved, so a host command cannot take one. A call to one is refused as `TOOL_RETIRED`, with a suggestion naming its replacement. `{name}-run` (`raw_python=True`) is unchanged. So are the legacy trusted-local `create_mcp_server` (`botcore serve`) and its tools.
- **Every host from `build_host` now serves two more commands, `info_catalog` and `info_docs`** (`info-catalog` and `info-docs` under `kebab_names=True`), whatever `core_commands` selects. A plugin or extra command already using either name now makes `build_host` raise `Duplicate command`. Every host's catalog gains the two rows, so the host CLI's `catalog`, the HTTP host's catalog and `afd-discover`'s totals each list two more commands.

### Added

- **`info_catalog()` and `info_docs(topic="overview")` describe the host serving the call on every surface (#2505):** the host CLI's `call`, DirectClient and MCP (`afd-call`, or each one's own tool under `command_tools=True`).
  - **`info_docs`:** `overview` lists the host's documentation topics (core docs and every plugin's `add_docs`). An unknown topic is refused as `UNKNOWN_TOPIC`, naming the topics that exist.
  - **The serving host:** the commands describe the innermost host running the call, or the host it names in the new `CommandHost.serves_as`. A host that runs each call on a child host, as Alfred's does, sets the child's `serves_as` to itself, so the catalog is its own, including any fields its `catalog()` adds. `botcore.host.serving_host(host)` names one by hand.
  - **Authorization:** `info_catalog` leaves out the commands the caller's scope view hides (spec/authorization.md, M6), as `afd-discover` does.
  - **Called outside a host,** each command is refused as `NO_HOST`.
