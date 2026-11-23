# MCP resources, skills and tool `_meta`: status

Epic: [#1554](https://github.com/lushly-dev/afd/issues/1554). File new work for this area as its sub-issue.

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

- **State:** completed 2026-11-22 (approved 2026-11-01 under the owner's delegation of 2026-10-31;
  D47, [#583](https://github.com/lushly-dev/afd/pull/583), merged as `880779ff`). All planned steps
  (0 through 5) are implemented across TypeScript, Python, Rust and C++ and verified against
  [`spec/vectors/mcp-resources.json`](../../../../spec/vectors/mcp-resources.json); epic
  [#1554](https://github.com/lushly-dev/afd/issues/1554) closes with step 5
  ([#1986](https://github.com/lushly-dev/afd/issues/1986)). Out-of-scope follow-ups (MCP prompts,
  Loam-driven `DirectClient` resources, `afd validate --surface` V2 schema-mismatch warning, and
  TypeScript `defineCommand` key check) remain recorded below.
- **Last verified:** 2026-11-22 on `main` (`804e17cc`, including #588, #608, #615, #2138, #2168,
  #2192, #2226) and the step 5 vector-promotion branch (#1986). Initial pre-implementation baseline
  was read on 2026-11-01 against `main` at `880779ff` and external MCP 2026-07-28 / 2025-11-25,
  SEP-2640 (Final), Agent Skills and MCP Apps (2026-01-26) specs; digests in
  `spec/vectors/mcp-resources.json` were computed with Node's `crypto` from the file's own bytes.
- **Done:** step 0 (`spec/`, merged as #588); step 1, Rust (Umbel phase 1 step 0b,
  [#608](https://github.com/lushly-dev/afd/pull/608), later updated for `rmcp` 3.9 and `#1880`
  per-caller `cacheScope: "private"`): `McpServer::with_resources`, `with_skills`,
  `SkillCatalog::with_directory_read`, `CommandDefinition::with_tool_meta` and
  `CommandRegistry::register_with_schemas` in `packages/rust`, with `tests/mcp_resources_vectors.rs`
  (originally `tests/server_resources.rs`) and `tests/server_tool_meta.rs`;
  step 2, TypeScript, merged in [#615](https://github.com/lushly-dev/afd/pull/615) as `c80a9b4d`
  (and hardened for S2 RFC 3986 manifest normalization in [#2138](https://github.com/lushly-dev/afd/pull/2138)):
  `resources` and `skills` options on `createMcpServer` and `createMcpHandler`, `toolMeta` and
  `advertisedInputSchema` on `defineCommand`, verified by `mcp-resources-vectors.test.ts`
  (originally `resources.test.ts`), `tool-meta.test.ts`, `skills.test.ts` and `frontmatter.test.ts`;
  step 3, Python, merged in [#2192](https://github.com/lushly-dev/afd/pull/2192) as `0b56ceec`
  ([#1981](https://github.com/lushly-dev/afd/issues/1981)): `create_server(resources=..., skills=...)`,
  `SkillCatalog`, `skill_from_directory`, `tool_meta`, `advertised_input_schema`, R1 capability fix,
  and `tests/{test_mcp_resources_vectors,test_tool_meta,test_skills,test_frontmatter}.py`;
  step 4, C++, merged in [#2226](https://github.com/lushly-dev/afd/pull/2226) as `00ad943b`
  ([#1983](https://github.com/lushly-dev/afd/issues/1983)): `CommandDefinition::tool_meta` and
  `advertised_input_schema`, `afd::mcp_stdio` `StdioServerOptions::{resources,skills}`,
  `skill_from_directory`, dedicated YAML 1.2 Core frontmatter parser and libFuzzer target, and
  `tests/{mcp_resources_vectors,tool_meta,frontmatter}_test.cpp`;
  step 5, vector promotion ([#1986](https://github.com/lushly-dev/afd/issues/1986)): promoted
  `spec/mcp-resources.json` to `spec/vectors/mcp-resources.json`, renamed all four vector loaders
  for `alfred parity`, refreshed capability/conformance tables and archived this folder.
- **Not done:** out-of-scope follow-ups recorded below (MCP prompts as separate future scope,
  Loam-driven `DirectClient` resources, the V2 `afd validate --surface` warning, and TypeScript
  `defineCommand` key validation).

## Implementation plan

| Step | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0. `spec/` | Done (#588) | New [`spec/mcp-resources.md`](../../../../spec/mcp-resources.md) and [`spec/vectors/mcp-resources.json`](../../../../spec/vectors/mcp-resources.json) (originally `spec/mcp-resources.json`); amendments to `command-metadata.md`, `protocol-conformance.md` and `CHANGELOG.md`; parity rows Planned. `spec/VERSION` stays `1.0-rc` | Merged as `af7bb166` |
| 1. Rust | Done | [#608](https://github.com/lushly-dev/afd/pull/608): `packages/rust` `server` feature (`src/server/resources.rs`, `skills.rs`, `frontmatter.rs`), `src/meta_keys.rs`, `CommandRegistry::register_with_schemas`; `tests/mcp_resources_vectors.rs` (originally `tests/server_resources.rs`), `tests/server_tool_meta.rs`; CHANGELOG, parity rows, `afd-rust` skill. Spec clarifications in the Umbel phase 1 specification's "Amendments from step 0b" | Umbel steps 3, 5 and 6 may now build on it |
| 2. TypeScript | Done ([#615](https://github.com/lushly-dev/afd/pull/615); verified 2026-11-01) | `packages/server`: `src/resources.ts`, `skills.ts`, `frontmatter.ts`, `meta-keys.ts`, wiring in `mcp-modern.ts`/`server.ts`; `defineCommand({ toolMeta, advertisedInputSchema })`, core `commandToolMeta`; tests `mcp-resources-vectors.test.ts` (originally `resources.test.ts`, all of `mcp-resources.json`, HTTP and stdio, both eras), `tool-meta.test.ts`, `skills.test.ts`, `frontmatter.test.ts`; README, `afd-typescript` skill, parity rows, spec status tables, minor changeset. `/direct` stays within its budgets (+0.3 KB) | Loam phase 1 may now build on it |
| 3. Python | Done ([#2192](https://github.com/lushly-dev/afd/pull/2192); verified 2026-11-22) | `python/src/afd/core/meta_keys.py`, `src/afd/server/{frontmatter,skills,resources}.py`, wiring in `factory.py`/`decorators.py`/`lazy_tools.py`/`commands.py`/`confirmations.py`/`bootstrap/`; `pyyaml>=6.0` in `afd[server]`; tests `test_mcp_resources_vectors.py` (originally `test_resources.py`, all of `mcp-resources.json`, HTTP and stdio, both eras), `test_tool_meta.py`, `test_skills.py`, `test_frontmatter.py`; R1 capability fix; `afd-python` skill, parity rows, spec status tables, minor changeset | Step 4 (C++) and step 5 (vectors) |
| 4. C++ | Done ([#2226](https://github.com/lushly-dev/afd/pull/2226); verified 2026-11-22) | `packages/cpp`: `CommandDefinition::tool_meta` & `advertised_input_schema` (`src/meta_keys.cpp`, `src/mcp.cpp`, `src/registry.cpp`, `src/bootstrap.cpp`); `afd::mcp_stdio` `StdioServerOptions::{resources,skills}`, `skill_from_directory`, `src/mcp_stdio/{frontmatter,resources}.{hpp,cpp}`, `fuzz/fuzz_frontmatter.cpp`; `tests/{tool_meta,frontmatter,mcp_resources_vectors}_test.cpp` (originally `resources_test.cpp`, all of `mcp-resources.json` over stdio, both eras); `CHANGELOG.md`, parity rows, spec status tables, `afd-cpp` skill | Step 5 (vector promotion, `#1986`) |
| 5. Vectors, conformance rows, skills | Done ([#1986](https://github.com/lushly-dev/afd/issues/1986); verified 2026-11-22) | Promoted `spec/mcp-resources.json` to [`spec/vectors/mcp-resources.json`](../../../../spec/vectors/mcp-resources.json), registered it in `scripts/check-vector-drift.mjs` and `spec/vectors/README.md`, renamed all four language vector suites for `alfred parity` (`mcp-resources-vectors.test.ts`, `test_mcp_resources_vectors.py`, `mcp_resources_vectors.rs`, `mcp_resources_vectors_test.cpp`), updated `spec/capabilities/*.json` + generated parity/conformance tables, confirmed all four language skills, and archived under `docs/features/complete/` | Complete (closes `#1554`) |
| Next. Prompts | Not started | Separate future scope | A phase that needs workflows as prompts |

## Open questions

None. The choices the phase 1 plan left open are made in the proposal's
[choices](mcp-resources-skills.proposal.md#choices-this-proposal-made) and stated in the spec.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-01 | Step 0 session | Python's SDK declares empty `resources` and `prompts` capabilities today, with `subscribe` and `listChanged` true on the modern era; the Python step must remove them (R1), or an earlier fix may | Done 2026-11-22 in step 3 ([#1981](https://github.com/lushly-dev/afd/issues/1981), [#2192](https://github.com/lushly-dev/afd/pull/2192)): unused SDK `prompts/*` and opt-out `resources/*` handlers are stripped and `subscribe`/`listChanged` stay `false` |
| 2026-11-01 | Step 0 session | Move `spec/mcp-resources.json` into `spec/vectors/` (and the loader table in `vectors/README.md`) in the step that makes the fourth language load it | Done 2026-11-22 in step 5 ([#1986](https://github.com/lushly-dev/afd/issues/1986)): promoted to `spec/vectors/mcp-resources.json`, registered in `scripts/check-vector-drift.mjs` and `spec/vectors/README.md`, and verified by `alfred parity` across all four languages |
| 2026-11-01 | Step 0 session | If `rmcp` cannot route `skills/list`, `skills/get` or `resources/directory/read`, step 1 stops and amends the spec, as Umbel's phase 1 plan says | Done in step 1: `rmcp` 3.8.0 routes them through `ServerHandler::on_custom_request`; the spec stood. Superseded 2026-11-07: `rmcp` 3.9.0 routes them itself, through `list_skills`, `get_skill` and `read_resource_directory`, which the Rust server now implements. S4 was amended for the one case `rmcp` refuses first |
| 2026-11-07 | `rmcp` 3.9 session | TypeScript's `SkillCatalog` checks only the literal `.` and `..` segments, so it still builds a catalog with a percent-encoded dot segment (`%2e%2e/x.md`) or two spellings of one file (`%41.md` beside `A.md`), which S2's manifest boundary now refuses. Make `packages/server`'s catalog refuse them, then add the cases to `catalogFailures` in `spec/mcp-resources.json` | Done 2026-11-22 ([#1984](https://github.com/lushly-dev/afd/issues/1984), [#2138](https://github.com/lushly-dev/afd/pull/2138)): `packages/server/src/skills.ts` enforces RFC 3986 §6.2.2 normalization and manifest boundary checks matching `rmcp`, and the `%2e%2e/x.md`, `refs/%2E`, and `%41.md` beside `A.md` cases are in `spec/mcp-resources.json` `catalogFailures`, verified in both `packages/server` and `packages/rust` |
| 2026-11-01 | Step 0 session | Resources in the in-process registries (`DirectClient`, `createDirectRegistry`) if Loam's browser kernel needs `ui://` resources without an MCP server | Open, Loam to raise |
| 2026-11-01 | Step 2 session | `afd validate --surface` cannot warn when the advertised and validation schemas disagree (V2, SHOULD): it reads `tools/list`, which carries only the advertised schema. A warning needs both schemas, so it belongs where a language holds both (TypeScript: `defineCommand`, at a cost to the `/direct` budget) | Open |
| 2026-11-01 | Step 2 session | `defineCommand` and the in-process registry do not check `toolMeta` keys (the server does, at registration), to keep `/direct` within its size budgets; `checkMetaEntry` is exported from the root entry only, which loads the MCP SDK | Open, Loam to raise |
| 2026-11-01 | Step 2 session | MCP prompts in AFD servers, the next step, when a phase needs workflows as prompts | Open |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-01 | Step 0 session (Umbel phase 1 step 0a) | Proposal, this status file, `spec/mcp-resources.md` and its cases, the `command-metadata.md`, `protocol-conformance.md` and `CHANGELOG.md` amendments, parity rows; the Skill Knowledge Layer's out-of-scope note points here; Umbel's phase 1 specification takes AFD's `dev.afd/digest` in place of `dev.umbel/sha256`. No code |
| 2026-11-01 | Umbel phase 1 step 0b | Rust implementation in `packages/rust` and the todo library split. Clarified in the spec: directory-read results are in `resources` (SEP-2640), frontmatter depth and repeated keys, reserved prefixes compared without case, no whitespace in a resource URI. New optional dependency `saphyr-parser` for the frontmatter. Parity rows and status tables updated for Rust |
| 2026-11-01 | Step 2 session (TypeScript) | `packages/server` serves resources, the Skills extension and `toolMeta`, and shows `advertisedInputSchema`; core `CommandDefinition.toolMeta`. New dependency `yaml`. `spec/mcp-resources.md`, `command-metadata.md`, `protocol-conformance.md`, `CHANGELOG.md`, parity rows and the Loam prerequisites row updated; proposal "Amendments from step 2" |
| 2026-11-07 | `rmcp` 3.9 session | `rmcp` 3.9.0 (2026-11-05) routes the Skills extension itself (SEP-2640), so `skills/list`, `skills/get` and `resources/directory/read` stopped reaching `on_custom_request` and answered `-32601`. The Rust server now implements `rmcp`'s `list_skills`, `get_skill` and `read_resource_directory`, keeps `on_custom_request` for params that do not parse, and its floor is `rmcp` 3.9. Spec amendments: S4 (`data` MAY be omitted on a `skills/get` error for a URI that is not a `SKILL.md` URI, which `rmcp` refuses before the handler; `dataOptional` on that case in `mcp-resources.json`) and S2 (the manifest boundary under RFC 3986 normalization, as SEP-2640 requires and `rmcp` checks). Verified by `cargo test --features server` in `packages/rust` against `rmcp` 3.9.0 |
| 2026-11-22 | `area:server` bug batch ([#1984](https://github.com/lushly-dev/afd/issues/1984), [#2138](https://github.com/lushly-dev/afd/pull/2138)) | TypeScript `SkillCatalog` (`packages/server/src/skills.ts`) now enforces S2's RFC 3986 §6.2.2 manifest boundary and normalized-URI uniqueness; added `%2e%2e/x.md`, `refs/%2E`, and `%41.md` beside `A.md` to `spec/mcp-resources.json` `catalogFailures`, verified in TypeScript (`packages/server`) and Rust (`packages/rust`) |
| 2026-11-22 | Spec alignment ([#1905](https://github.com/lushly-dev/afd/issues/1905), [#2168](https://github.com/lushly-dev/afd/pull/2168)) | Aligned `spec/mcp-resources.md` R3/R4 (and R5/S4/S6 cache-hint cross-references) with per-caller `ResourceProvider` authorization and `cacheScope: "private"` vs `"public"` behavior (`#1880`); recorded owner-approved epic sequence (`#1905 → #1981 → #1983 → #1986`) and cleared stale `#341` / TypeScript status notes in `spec/mcp-resources.md`, `spec/protocol-conformance.md`, and this file. Verified 2026-11-22 against `packages/rust/src/server/resources.rs`, `packages/rust/tests/server_auth_hardening.rs`, `packages/server/src/resources.ts`, `spec/authorization.md`, and `pnpm verify` (`pnpm check`, `pnpm check:tracks`, `alfred` suite) |
| 2026-11-22 | Step 3 session (Python, [#1981](https://github.com/lushly-dev/afd/issues/1981), [#2192](https://github.com/lushly-dev/afd/pull/2192)) | Implemented MCP resources (R1–R6), Skills extension `io.modelcontextprotocol/skills` (S1–S7, promoting `pyyaml>=6.0` into `afd[server]` with a YAML 1.2 core event-walker parser), `tool_meta` (T1–T3), and `advertised_input_schema` (V1–V2) in `python/`. Removed SDK default `prompts` and opt-out `resources` capabilities, and preserved `extensions["io.modelcontextprotocol/skills"]` across the SDK's 2025-11-25 `initialize` wire sieve. Verified 2026-11-22 with `tests/test_resources.py` (every case of `spec/mcp-resources.json` over Streamable HTTP and stdio in both eras), `test_tool_meta.py`, `test_skills.py`, `test_frontmatter.py`, `ruff`, and `mypy` |
| 2026-11-22 | Step 4 session (C++, [#1983](https://github.com/lushly-dev/afd/issues/1983), [#2226](https://github.com/lushly-dev/afd/pull/2226)) | Implemented `CommandDefinition::tool_meta` (T1–T3) and `CommandDefinition::advertised_input_schema` (V1–V2) in `afd::afd`, and opt-in MCP resources (R1–R6), Skills extension `io.modelcontextprotocol/skills` (S1–S7), `skill_from_directory`, and optional `directory_read` on `afd::mcp_stdio`, with a dedicated zero-dependency YAML 1.2 Core frontmatter parser (`src/mcp_stdio/frontmatter.{hpp,cpp}`) and libFuzzer target (`fuzz/fuzz_frontmatter.cpp`). Verified 2026-11-22 with `tests/tool_meta_test.cpp`, `tests/frontmatter_test.cpp`, and `tests/resources_test.cpp` (every case of `spec/mcp-resources.json` over stdio in both eras), unity build, macro hygiene, no-exceptions/no-RTTI, and `clang-format==22.1.8` |
| 2026-11-22 | Step 5 session (Vector promotion, [#1986](https://github.com/lushly-dev/afd/issues/1986)) | Promoted `spec/mcp-resources.json` to `spec/vectors/mcp-resources.json` (`authored` in `scripts/check-vector-drift.mjs`), added the four-language loader column to `spec/vectors/README.md`, renamed the four test loaders to `alfred parity`'s vector-test convention (`mcp-resources-vectors.test.ts`, `test_mcp_resources_vectors.py`, `mcp_resources_vectors.rs`, `mcp_resources_vectors_test.cpp`), updated `scripts/plugin-manifest.test.mjs`, `.github/workflows/rust.yml`, and `spec/capabilities/*.json` + generated status tables, confirmed all four language skills (`afd-typescript`, `afd-python`, `afd-rust`, `afd-cpp`), and archived this folder under `docs/features/complete/` (closing epic `#1554`). Verified locally 2026-11-22 with `alfred` (`pytest tests/` 136/136), TypeScript (`mcp-resources-vectors.test.ts` 119/119), Python (`test_mcp_resources_vectors.py` & `test_tool_meta.py` 21/21 + ruff), Rust (`cargo fmt --check` & `cargo test --features server --test mcp_resources_vectors` 21/21), C++ (`clang-format==22.1.8` & `afd_tests.exe -tc="*mcp-resources*"` 371/371 assertions), `pnpm check:capabilities`, `check-vector-drift`, and `check:tracks` |
