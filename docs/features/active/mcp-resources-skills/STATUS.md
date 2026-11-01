# MCP resources, skills and tool `_meta`: status

Read this before the [proposal](mcp-resources-skills.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows the
shape of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them; link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** approved 2026-11-01 under the owner's delegation of 2026-10-31; the owner approved the
  direction with the Umbel phase 1 specification (D47, [#583](https://github.com/lushly-dev/afd/pull/583),
  merged as `880779ff`). Step 0 (`spec/`) is written in the pull request that adds this file
  (Umbel phase 1 step 0a); Rust implements it as of Umbel phase 1 step 0b, no other language yet.
- **Last verified:** 2026-11-01 against `main` at `880779ff`. Current behavior read from
  `packages/server/src` (`mcp-modern.ts`, `http-handler.ts`, `tools.ts`, `lazy-tools.ts`,
  `schema.ts`, `execution.ts`), `packages/core/src/command-metadata.ts`, `python/src/afd/server`
  (`factory.py`, `tools.py`, `lazy_tools.py`, `decorators.py`) and `python/src/afd/core/commands.py`,
  `packages/rust/src` (`server.rs`, `server/strategy.rs`, `server/meta_tools.rs`, `commands.rs`,
  `schema_validation.rs`), `rmcp` 3.7.0 (`handler/server.rs`, `transport/common/mcp_headers.rs`),
  `packages/cpp/src/registry.cpp` and `packages/examples/todo/backends/cpp/src/mcp_stdio.cpp`.
  Python's capabilities were read by calling `get_capabilities` on a fresh `create_server` under
  `mcp` 2.3.0 (`uv sync --frozen --all-extras`). External rules checked the same day against the MCP
  2026-07-28 pages (resources, caching, `_meta`, versioning, Streamable HTTP), the 2025-11-25
  resources page, SEP-2640 (Final), the Agent Skills specification and the MCP Apps specification
  (2026-01-26). The digests in `spec/mcp-resources.json` were recomputed with Node's `crypto` from
  the file's own bytes.
- **Done:** step 0 (`spec/`, merged as #588) and step 1, Rust (Umbel phase 1 step 0b,
  [#PR](https://github.com/lushly-dev/afd/pull/PR)): `McpServer::with_resources`, `with_skills`,
  `SkillCatalog::with_directory_read`, `CommandDefinition::with_tool_meta` and
  `CommandRegistry::register_with_schemas` in `packages/rust`, with `tests/server_resources.rs`
  (every case of `spec/mcp-resources.json` over Streamable HTTP and stdio in both eras) and
  `tests/server_tool_meta.rs`. `rmcp` 3.8.0 routes `skills/list`, `skills/get` and
  `resources/directory/read` through `on_custom_request`, so the spec stood.
- **Not done:** steps 2 to 5 of the proposal's [implementation plan](mcp-resources-skills.proposal.md#implementation-plan)
  (TypeScript, Python, C++, vectors); prompts.

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Done (#588) | New [`spec/mcp-resources.md`](../../../../spec/mcp-resources.md) and [`spec/mcp-resources.json`](../../../../spec/mcp-resources.json); amendments to `command-metadata.md`, `protocol-conformance.md` and `CHANGELOG.md`; parity rows Planned. `spec/VERSION` stays `1.0-rc` | Merge |
| 1. Rust | Done | [#PR](https://github.com/lushly-dev/afd/pull/PR): `packages/rust` `server` feature (`src/server/resources.rs`, `skills.rs`, `frontmatter.rs`), `src/meta_keys.rs`, `CommandRegistry::register_with_schemas`; `tests/server_resources.rs`, `tests/server_tool_meta.rs`; CHANGELOG, parity rows, `afd-rust` skill. Spec clarifications in the Umbel phase 1 specification's "Amendments from step 0b" | Umbel steps 3, 5 and 6 may now build on it |
| 2. TypeScript | Not started | None | Step 0 merged. Loam phase 1 waits on it |
| 3. Python | Not started | None | Step 0 merged |
| 4. C++ | Not started | None | Step 0 and parity D2 ([#341](https://github.com/lushly-dev/afd/issues/341)) merged |
| 5. Vectors, conformance rows, skills | Not started | None | Steps 1 to 4 |
| Next. Prompts | Not started | None | A phase that needs workflows as prompts |

## Open questions

None. The choices the phase 1 plan left open are made in the proposal's
[choices](mcp-resources-skills.proposal.md#choices-this-proposal-made) and stated in the spec.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Step 0 session | Python's SDK declares empty `resources` and `prompts` capabilities today, with `subscribe` and `listChanged` true on the modern era; the Python step must remove them (R1), or an earlier fix may | Open |
| 2026-11-01 | Step 0 session | Move `spec/mcp-resources.json` into `spec/vectors/` (and the loader table in `vectors/README.md`) in the step that makes the fourth language load it | Open |
| 2026-11-01 | Step 0 session | If `rmcp` cannot route `skills/list`, `skills/get` or `resources/directory/read`, step 1 stops and amends the spec, as Umbel's phase 1 plan says | Done in step 1: `rmcp` 3.8.0 routes them through `ServerHandler::on_custom_request`; the spec stood |
| 2026-11-01 | Step 0 session | Resources in the in-process registries (`DirectClient`, `createDirectRegistry`) if Loam's browser kernel needs `ui://` resources without an MCP server | Open, Loam to raise |
| 2026-11-01 | Step 0 session | MCP prompts in AFD servers, the next step, when a phase needs workflows as prompts | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-01 | Step 0 session (Umbel phase 1 step 0a) | Proposal, this status file, `spec/mcp-resources.md` and its cases, the `command-metadata.md`, `protocol-conformance.md` and `CHANGELOG.md` amendments, parity rows; the Skill Knowledge Layer's out-of-scope note points here; Umbel's phase 1 specification takes AFD's `dev.afd/digest` in place of `dev.umbel/sha256`. No code |
| 2026-11-01 | Umbel phase 1 step 0b | Rust implementation in `packages/rust` and the todo library split. Clarified in the spec: directory-read results are in `resources` (SEP-2640), frontmatter depth and repeated keys, reserved prefixes compared without case, no whitespace in a resource URI. New optional dependency `saphyr-parser` for the frontmatter. Parity rows and status tables updated for Rust |
