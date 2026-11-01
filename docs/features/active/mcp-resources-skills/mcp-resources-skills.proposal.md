# MCP resources, skills and tool `_meta`

> **Goal**: AFD MCP servers serve MCP resources, the Skills over MCP extension and extra `_meta`
> entries on a command's tool, and can advertise an input schema apart from the one they validate
> with. Specified once in [`spec/mcp-resources.md`](../../../../spec/mcp-resources.md), then
> implemented in Rust first (for Umbel), TypeScript (for Loam), Python and C++.

| Field | Value |
|---|---|
| Status | Approved 2026-11-01 under the owner's delegation of 2026-10-31: the owner approved this direction with the [Umbel phase 1 specification](../../../../endpoints/umbel/docs/phases/1-plugin-contract/spec.md#step-0-afd-first) (decision D47), merged in [#583](https://github.com/lushly-dev/afd/pull/583). Spec step done; Rust (step 1) and TypeScript (step 2) implement it. Progress is in [STATUS.md](STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Requested by | [Umbel](../../../../endpoints/umbel/docs/STATUS.md), decision [D47](../../../../endpoints/umbel/docs/decisions.md) and step 0a of its [phase 1 plan](../../../../endpoints/umbel/docs/phases/1-plugin-contract/spec.md#step-0-afd-first); [Loam](../../../../endpoints/loam/docs/architecture.md#afd-prerequisites), which needs `ui://` resources and MCP Apps' `_meta.ui.resourceUri` from the same mechanism. Under Umbel's D25 it lands in AFD, spec first, for every language |
| Packages | `spec/`, `packages/server`, `python/`, `packages/rust`, `packages/cpp` (with the todo backends) |
| Related | [Skill Knowledge Layer](../../proposed/skill-knowledge-layer/skill-knowledge-layer.proposal.md) (reconciled below); [Hybrid tool strategy](../hybrid-tool-strategy/hybrid-tool-strategy.proposal.md), whose shape this follows; [MCP 2026-07-28 upgrade](../mcp-2026-07-28/proposal.md); [MCP authorization](../../proposed/mcp-authorization/mcp-authorization.proposal.md), which per-caller resources wait for; [Language parity](../../../language-parity.md) item D2 (C++ `afd::mcp_stdio`, [#341](https://github.com/lushly-dev/afd/issues/341)) |

## Problem

AFD servers serve tools and nothing else. Two consumers need more, and both want it the same way in
every language:

| Need | Umbel (phase 1) | Loam (phase 1) |
|---|---|---|
| MCP resources | Every plugin skill file as a resource, with size and digest | `ui://` resources for sandboxed MCP Apps views |
| The Skills extension | Plugin skills through `skills/list` and `skills/get`, beside resources and the CLI export, because no major client supports the extension yet | Agent packs in the Agent Skills format, later |
| Extra tool `_meta` | `_meta["dev.umbel/origin"]` on every plugin command's tool | `_meta.ui.resourceUri` linking a tool to its view |
| Advertised and validation schemas | Mounted MCP servers' tools re-served unchanged although their schemas use keywords AFD's checker refuses | Not yet |

Prompts are the obvious fourth primitive. No phase of either consumer needs them yet, so they are
the next step, not this one.

## How servers behave today

Read from the code on `main` at `880779ff`, 2026-11-01.

No language serves resources, prompts, the Skills extension or an `extensions` capability, lets a
command add `_meta` to its tool, or keeps an advertised schema apart from its validation schema. The
details differ, and two of them matter for the spec:

| Concern | TypeScript (`packages/server/src`) | Python (`python/src/afd/server`) | Rust (`packages/rust/src`, `server` feature) | C++ (todo backend `mcp_stdio.cpp`) |
|---|---|---|---|---|
| Capabilities | `{ tools: { listChanged: false } }` on the modern lane (`mcp-modern.ts`, `createServerFactory`); `{ tools: {} }` on the deprecated `/sse` lane (`http-handler.ts`) | **`resources` and `prompts` are declared, empty.** AFD builds the SDK's `MCPServer` (`mcp` 2.3.0), which registers `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list` and `prompts/get` itself and derives capabilities from its handlers. Read 2026-11-01 from `get_capabilities` on a fresh `create_server`: legacy `resources: { subscribe: false, listChanged: false }`, `prompts: { listChanged: false }`; modern `resources: { subscribe: true, listChanged: true }`, `prompts: { listChanged: true }`, because the SDK serves `subscriptions/listen`. AFD forces only `tools.listChanged` to `false` (`factory.py`, `_advertise_fixed_tools_list`) | `enable_tools()` with `listChanged: false` (`server.rs`, `get_info`); `discover` adds the TTL and `cacheScope: public` | `{ tools: { listChanged: false } }` in `server/discover` and `initialize` |
| `resources/*` today | Not routed: `-32601` (`http-transport.test.ts`, "answers unknown methods with -32601") | Empty lists from the SDK | Not overridden, so `rmcp` 3.7's defaults: `resources/list` and `resources/templates/list` answer empty lists, `resources/read` and `resources/subscribe` answer `-32601` (`handler/server.rs`) | `-32601` (`mcp_stdio_test.cpp`) |
| Tool `_meta` | `commandToolMeta` (`packages/core/src/command-metadata.ts`): the nine fields of [Surfaces](../../../../spec/command-metadata.md#surfaces), each when set; grouped tools carry them per entry of `_meta.actions` (`tools.ts`) | `command_to_mcp_tool` (`afd/core/commands.py`): always `mutation`, no `category`; grouped tools carry no `_meta` (`tools.py`) | `CommandRegistry::get_tool` (`commands.rs`) adds only `_meta.approval` to individual and hybrid tools; grouped entries get the nine fields (`server/strategy.rs`, `command_tool_meta`) | `_meta.approval` only |
| A hook for extra `_meta` | None on `defineCommand` or the server options | None on the decorator or `CommandDefinition` | `McpServer::with_tools(Vec<Value>)` replaces a command's listed tool JSON wholesale, for individual and hybrid tools only; grouped tools and `afd-detail` still use the registry's schema | None |
| `afd-detail` | Flat fields, no `_meta` (`lazy-tools.ts`) | Flat fields, plus `requires`, `contexts`, `examples` (`lazy_tools.py`) | Flat fields, no `_meta` (`server/meta_tools.rs`) | No meta-tools |
| Input schemas | One: `zodToJsonSchema` of the Zod `input` is advertised and Zod validates (`schema.ts`, `execution.ts`) | One: the Pydantic model's JSON Schema, checked by AFD's subset validator, then `model_validate` (`decorators.py`) | One: `register_with_schema` compiles it with the crate's own subset checker (`schema_validation.rs`) and both advertises and validates it; only `with_tools` can advertise another | One: compiled at registration (`src/registry.cpp`) and advertised by the backend |
| `Mcp-Name` | From the SDK | From the SDK | From `rmcp`, which maps `resources/read` to `params.uri` (`transport/common/mcp_headers.rs`) | N/A: stdio |
| Cache hints | `toolsListTtlMs`, default 300,000, 0 under contexts except hybrid; `tools/list` and `server/discover` | `tools_list_ttl_ms`, same rule | `with_tools_list_ttl_ms`, same rule | 300,000, fixed |

What follows for the spec:

- **Python already advertises resources and prompts it does not serve**, and on the modern era claims
  `subscribe` and `listChanged` that no AFD server honors. R1 forbids both; the Python step removes
  the SDK's empty handlers or corrects the capabilities. The language parity matrix records it.
- **Rust's `with_tools` is the only existing way to put extra `_meta` on a tool**, and it replaces
  the whole tool, `inputSchema` included. T1 and V1 give that use a supported path; `with_tools`
  stays as it is.
- **Rust's individual tools carry only `_meta.approval`**, short of the nine fields
  [`command-metadata.md`](../../../../spec/command-metadata.md#surfaces) lists (already a "Partial"
  in the parity matrix). T1 adds extra entries beside whatever the server sets; it does not depend on
  closing that gap.
- **`server/discover` and `tools/list` cache hints exist in every language**, so R3's rule, reusing
  the `tools/list` TTL option, adds no new option.
- **No `spec/` page yet said that `Mcp-Name` carries `params.uri` or that lists must not vary per
  connection**; both were recorded only in the [MCP 2026-07-28 proposal](../mcp-2026-07-28/proposal.md).
  R3 and R5 now state them.

## Proposal

[`spec/mcp-resources.md`](../../../../spec/mcp-resources.md) carries the normative rules: R1 to R6
for resources, S1 to S8 for skills, T1 to T3 for tool `_meta`, V1 and V2 for the two schemas. This
section explains the choices.

### Resources: a provider, a fixed public list

A server takes a **resource provider**: entries plus a read function. Its `resources/list` is the
provider's entries then the skill files, in one page, in a stable order, and never varies by
connection, session or AFD context (R3). That last rule comes straight from MCP 2026-07-28, which
says lists MUST NOT vary per connection, and it lets AFD mark the list `cacheScope: "public"` with
the server's existing `tools/list` TTL. MCP lets a list vary by authorization; this version gives
the provider no request input at all, so per-caller resources wait for the authorization proposal
instead of being half-specified here.

In 2026-07-28, `ttlMs` and `cacheScope` are fields of the list **result** (and of the
`resources/read` result), not of each resource. Umbel's first draft put them on each resource; the
review of [#583](https://github.com/lushly-dev/afd/pull/583) caught it, and R3 and R4 follow the
specification.

A read runs no command, so none of AFD's command machinery applies: no middleware, confirmations,
approvals or journal entry (R4). Resources are content a server already decided to publish.

### Where digests go

A resource's digest goes in its own `_meta`, under **`dev.afd/digest`**, as the Skills extension
writes digests: `sha256:` and 64 lowercase hex characters (R6). AFD sets it on every skill file
from the bytes it serves, so it equals the digest in that skill's `skills/list` manifest, and on
any provider entry whose bytes the provider gives up front. The key is AFD's because AFD computes
the value; Umbel reads it instead of minting `dev.umbel/sha256` (its phase 1 specification is
amended to match in this pull request).

### Skills: a fixed catalog of Agent Skills

A server takes a **skill catalog**: skills read once, when the server is built (S2). That buys
digests that never go stale while the server runs, a manifest computed from the bytes actually
served, and every check up front: frontmatter, the Agent Skills name rule, the path, unique names
and the extension's limits of 512 files and 16 MiB. The catalog never emits `"resources":
"dynamic"`. A generated skill would need a provider-style interface; nobody needs one yet.

Each skill is served three ways at once: `skills/list` and `skills/get` (S3, S4), every file as a
resource (S5), and `resources/directory/read` when the catalog turns directory reads on (S6, off by
default as the phase 1 plan asks). The extension commits a server to `skills/list` and `skills/get`
and requires `resources`; the resources path also serves clients that do not speak the extension,
which today is most of them.

### Tool `_meta`: a key rule, with room for MCP Apps

A command may carry extra tool `_meta` entries, emitted on its tool under every strategy that lists
command tools, on its grouped action entry, and by `afd-detail` (T1). The key rule (T2) allows:

- reverse-DNS prefixed keys with two or more labels, outside `dev.afd/` and outside the prefixes MCP
  reserves; and
- exactly **`ui`**, MCP Apps' key, so Loam can write `_meta.ui.resourceUri`.

Everything else is refused at registration, which means an extra entry can never replace one the
server sets (`approval`, `category`, `actions` and the rest). The deprecated flat
`ui/resourceUri` is refused: its prefix has one label, and MCP Apps itself has moved to
`_meta.ui`.

### Advertised and validation schemas

A command may be registered with the schema it shows and a separate one the registry validates
with (V1). Umbel needs it to re-serve a mounted server's tool unchanged when its schema uses
keywords AFD refuses. Only the validation schema is compiled; the advertised one must merely be an
object schema (V2). Keeping the two consistent is the registering code's job, and
`afd validate --surface` SHOULD warn about obvious disagreements.

## Reconciliation with the Skill Knowledge Layer

The [Skill Knowledge Layer](../../proposed/skill-knowledge-layer/skill-knowledge-layer.spec.md)
proposes **command skills**: `*.skill.md` files beside a command's source, linked from
`defineCommand({ skill })`, returned by a `skill-docs` bootstrap command and validated by
`validateCommandSkills()`. It listed "MCP resource exposure" as out of scope.

The two do not overlap, and this proposal keeps them apart (S8):

| | Command skills (Skill Knowledge Layer) | Agent Skills over MCP (this proposal) |
|---|---|---|
| Unit | One `*.skill.md` file per command or category | A directory with `SKILL.md` and supporting files |
| Linked to | A command or category | Nothing; a skill stands alone |
| Served by | The `skill-docs` bootstrap command (a tool) | `skills/list`, `skills/get`, `resources/read` |
| Format | Agent Skills-compatible frontmatter | The Agent Skills specification, unchanged |
| State | Proposed, not implemented | Specified here |

A server may put guidance in its catalog as an Agent Skill; nothing converts a command skill into
one. If the Skill Knowledge Layer is ever implemented, serving command skills as resources would
reuse R1 to R6, and its out-of-scope note now points here.

## Spec changes, landing before any language

This pull request:

| File | Change |
|---|---|
| New [`spec/mcp-resources.md`](../../../../spec/mcp-resources.md) | R1 to R6, S1 to S8, T1 to T3, V1 and V2, conformance and implementation status |
| New [`spec/mcp-resources.json`](../../../../spec/mcp-resources.json) | Hand-written cases: 28 `_meta` keys, a two-skill catalog with its `skills/list`, `resources/list`, reads, a `skills/get` and six errors, and nine catalogs that must fail. Beside `tool-strategies.json`, not in `vectors/`, until all four languages load it |
| [`spec/command-metadata.md`](../../../../spec/command-metadata.md) | `toolMeta` field and the advertised schema in [Fields](../../../../spec/command-metadata.md#fields); the [reporting rules](../../../../spec/command-metadata.md#reporting-rules) and [Surfaces](../../../../spec/command-metadata.md#surfaces) |
| [`spec/protocol-conformance.md`](../../../../spec/protocol-conformance.md) | Four acceptance rows, all Planned |
| [`spec/CHANGELOG.md`](../../../../spec/CHANGELOG.md) | An entry under `1.0-rc`, and the new page in the scope. `spec/VERSION` stays `1.0-rc`: additive changes during the release candidate are recorded under it, as the hybrid strategy's were |
| [`docs/language-parity.md`](../../../language-parity.md) | Four rows in the MCP server matrix, Planned in every language |

No error code, wire fixture or existing vector changes. The 34-case todo conformance suite does not
change.

## Implementation plan

| Step | Language | Work | Size | Depends on |
|---|---|---|---|---|
| 0 | `spec/` | This pull request | M | Owner approval (given through D47) |
| 1 | Rust | Umbel phase 1 step 0b: `McpServer::with_resources`, `with_skills`, `SkillCatalog::with_directory_read`, `CommandDefinition::with_tool_meta`, `CommandRegistry::register_with_schemas`; the `rmcp` routing of `skills/list`, `skills/get` and `resources/directory/read` (if `rmcp` cannot route them, step 1 stops and amends the spec); tests over stdio and Streamable HTTP in both eras loading `mcp-resources.json`; CHANGELOG, parity rows, `afd-rust` skill | L | Step 0 |
| 2 | TypeScript | The same options on `createMcpServer` and `createMcpHandler`; `toolMeta` and `advertisedInputSchema` on `defineCommand`; `afd validate --surface` warning (V2); loader; changeset | M | Step 0. Loam's phase 1 waits on it |
| 3 | Python | `create_server(resources=..., skills=...)`, `tool_meta`, `advertised_input_schema`; frontmatter read with the YAML 1.2 core schema, not PyYAML's 1.1 default; the SDK's empty `resources` and `prompts` handlers removed or their capabilities corrected (R1); loader | M | Step 0 |
| 4 | C++ | On `afd::mcp_stdio`, stdio only | M | Step 0 and parity D2 ([#341](https://github.com/lushly-dev/afd/issues/341)) |
| 5 | All | Move `mcp-resources.json` into `vectors/`; conformance rows filled; skills document the options | S | Steps 1 to 4 |
| Next | All | MCP prompts (`prompts/list`, `prompts/get`), when a phase needs workflows as prompts | — | A new proposal or an amendment to this one |

Steps 1, 2 and 3 can run in parallel. Step 1 is the one Umbel needs.

## Acceptance

- Each language loads `spec/mcp-resources.json` and matches it.
- A server with neither option declares no `resources` capability and lists the same tools as
  before, byte for byte.
- On each language's server, over stdio and Streamable HTTP in both eras: `resources/list` and
  `skills/list` return the fixture's catalog in order with the modern-era cache hints;
  `resources/read` of an unknown URI is `-32602`; a modern `resources/read` without `Mcp-Name` is
  HTTP 400 with `-32020` on Streamable HTTP.
- A command with `toolMeta: { "ui": { "resourceUri": "ui://x/view.html" } }` lists it on its
  individual tool and its hybrid first-class tool, and `afd-detail` returns it.
- A command registered with an advertised schema that the validator would refuse is listed with
  that schema and validated with the other.

## Rollback

Every part is opt-in and additive. Removing it is a minor change per language; a server that did
not opt in never changed.

## Out of scope

- Prompts (the next step), resource templates (R5 answers an empty list), subscriptions and
  `listChanged`.
- Per-caller resource lists, which wait for the MCP authorization proposal.
- Dynamic skills (`"resources": "dynamic"`) and skills that change while the server runs.
- Resources in the in-process `DirectClient` and `createDirectRegistry`; if Loam's browser kernel
  needs them, that is a follow-up.
- Importing a mounted server's resources, prompts or skills, which Umbel reserves for federation.
- The host side of the Skills extension (approval, origin tagging, caching), which belongs to
  clients.

## Choices this proposal made

The phase 1 plan left these open; each is recorded here and in the spec.

1. **One error code for unknown resources on both eras**: `-32602`, which 2026-07-28 requires and
   2025-11-25 permits (R4).
2. **Cache hints**: the server's `tools/list` TTL and `cacheScope: "public"` on `resources/list`,
   `resources/read`, `resources/templates/list`, `skills/list` and `skills/get` in the modern era;
   the extension leaves `skills/get` open (S4).
3. **The digest key and format**: `dev.afd/digest`, `sha256:<hex>`, set by AFD (R6). Umbel's
   `dev.umbel/sha256` with bare hex is replaced.
4. **Names unique in a catalog**, even under different prefixes, where the extension says SHOULD
   (S2).
5. **Frontmatter parsing**: the YAML 1.2 core schema, no tags, anchors or aliases, so four languages
   produce the same JSON (S2).
6. **Prefixed tool `_meta` keys need two labels**, which refuses MCP Apps' deprecated
   `ui/resourceUri` (T2).
7. **Skill files' MIME types** come from a fixed suffix table, and `text` versus `blob` from whether
   the bytes are valid UTF-8 (S5, R4).
8. **`resources/templates/list` answers an empty list** rather than an error, so clients that call it
   after seeing `resources` do not fail (R5).

## Amendments from step 2

Step 2 (`packages/server`, TypeScript) found the spec able to stand as written and made these choices,
none of which changes what a consumer sees on the wire:

| Section | Was | Now | Why |
| --- | --- | --- | --- |
| T2, `toolMeta` "refused when the command is defined or registered" | Implied at definition | `createMcpServer` and `createMcpHandler` refuse a bad key when they register the command, naming the command and the key; `defineCommand` and the in-process `createDirectRegistry` do not check | The key rule costs about 1.5 KB minified, and the `/direct` entry has fixed size budgets. A hand-built command definition skips `defineCommand` anyway, so registration is the one check that covers every server. `commandToolMeta` puts the server's own fields after `toolMeta`, so an unchecked key still cannot replace one |
| V2, `afd validate --surface` SHOULD warn when a property is required by one schema and absent from the other | A step 2 deliverable | Not implemented | `afd validate --surface` is a wire client: it reads `tools/list`, which carries only the advertised schema, so it cannot see the validation schema. A language that holds both in process (TypeScript could compare the Zod-derived schema in `defineCommand`) can warn there; no language does yet. Left as a follow-up |
| R1, S1: the capability "in the `server/discover` result and in the `initialize` result" | Every transport | `/mcp` and stdio, in both eras. The deprecated `/sse` and `/message` lane (MCP 2024-11-05) serves no resources and still declares only `tools` | It is a separate, deprecated transport the spec's "eras" do not cover; declaring what it cannot serve would break R1 the other way |
| R2, a provider entry's `size` "REQUIRED when the provider gives the content's bytes up front" | The provider sets it | `ResourceEntry.content` carries the bytes; the server fills `size` and `dev.afd/digest` from them, and refuses an entry whose `size` is also given and differs | Less to get wrong than a size and bytes that must agree by hand |
| S2, "no two [file paths] equal" | A check | A `Skill`'s `files` is a record keyed by path, so a repeated path cannot be written; the other path rules (relative, `/`-separated, valid UTF-8, no empty, `.` or `..` segment) are checked | The idiomatic TypeScript shape |
| S2, frontmatter | YAML 1.2 core schema | The `yaml` package (`version: '1.2'`, `schema: 'core'`, `uniqueKeys`, no merge keys), its tree walked here to refuse tags, anchors, aliases, non-string keys, non-finite numbers and nesting beyond 64 levels; a `__proto__` key stays data. The parse of the Rust reader's own test cases is identical | A new runtime dependency of `@lushly-dev/afd-server` (already in the lockfile through Vite) |
| R3 cache hints | `ttlMs` equals the `tools/list` TTL option | Resource and skill results use `toolsListTtlMs ?? 300000`, never the context-lowered default. The SDK stamps `ttlMs`, `cacheScope` and `resultType` on `resources/*` results; `skills/*` results (custom methods) carry them from the handler, on the modern era only | The SDK client caches a modern `resources/list` for its TTL (`resources.test.ts` shows one `list()` call for two lists) |
