# MCP resources, skills and tool `_meta`

What an AFD MCP server serves beyond tools: MCP **resources** (`resources/list`, `resources/read`),
the **Skills over MCP extension** (`io.modelcontextprotocol/skills`, SEP-2640), **extra `_meta`
entries on a command's tool**, and a command's **advertised input schema** kept apart from the one
the registry validates with. All four are opt-in; a server that uses none of them is unchanged.
Which languages serve them is in [Implementation status](#implementation-status).

Every rule here is new and normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The [MCP resources and skills proposal](../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md)
explains why, records the choices this page makes, and tracks progress in its
[status](../docs/features/complete/mcp-resources-skills/STATUS.md). Prompts are not specified yet; the
proposal records them as the next step.

The rules follow the MCP specification [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
(resources, caching, `_meta` key names, extension negotiation, Streamable HTTP headers), the
[Skills extension](https://modelcontextprotocol.io/seps/2640-skills-extension) (SEP-2640, Final),
the [Agent Skills specification](https://agentskills.io/specification) and the
[MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview)
(`io.modelcontextprotocol/ui`). Where those leave a choice, this page makes it and says so. Every AFD
server is dual-era ([protocol conformance](./protocol-conformance.md#eras)): unless a rule names an
era, it holds on both.

## Terms

| Term | Meaning |
| --- | --- |
| Resource provider | What a server is given to serve resources: a list of resource entries and a read function. Its shape is per language (see [Options](#options)) |
| Resource entry | One item of `resources/list`: `uri`, `name` and the optional MCP fields |
| Skill catalog | What a server is given to serve skills: an ordered set of skills, each a skill path and its files' bytes, fixed when the server is built |
| Skill path | The `/`-separated path that locates a skill: optional prefix segments, then the skill's `name` |
| Skill file | One file of a skill, addressed by its path relative to the skill's root (`SKILL.md`, `references/STYLE.md`) |
| Digest | `sha256:` followed by the 64 lowercase hexadecimal characters of the SHA-256 of a file's raw bytes, the Skills extension's format |
| Extra tool `_meta` | `_meta` entries a command declares (`toolMeta`), emitted on its tool beside the entries the server sets itself |
| Advertised schema | The input schema a command shows on every surface; by default the same as its validation schema |

## Options

| | TypeScript (`createMcpServer`, `createMcpHandler`) | Python (`create_server`, `ServerConfig`) | Rust (`McpServer`, `server` feature) | C++ |
| --- | --- | --- | --- | --- |
| Resources | `resources: ResourceProvider` | `resources=ResourceProvider` | `with_resources(impl ResourceProvider)` | `StdioServerOptions::resources` (`ResourceProvider`) |
| Skills | `skills: SkillCatalog` | `skills=SkillCatalog` | `with_skills(SkillCatalog)` | `StdioServerOptions::skills` (`SkillCatalog`, `skill_from_directory`) |
| Directory reads | A catalog option, off by default | Same | `SkillCatalog::with_directory_read(true)` | `SkillCatalog::directory_read = true` |
| Extra tool `_meta` | `defineCommand({ toolMeta })` | `@server.command(tool_meta=...)` | `CommandDefinition::with_tool_meta(key, value)` | `CommandDefinition::tool_meta` |
| Advertised schema | `defineCommand({ advertisedInputSchema })` | `advertised_input_schema=` | `CommandRegistry::register_with_schemas(command, validation, advertised)` | `CommandDefinition::advertised_input_schema` |

All four languages implement these options.

## Resources

### R1. Opt-in and the capability

A server given a resource provider, a skill catalog or both MUST declare the `resources`
capability, in the `server/discover` result and in the `initialize` result. It MUST NOT set
`subscribe` or `listChanged` to `true`: AFD servers push nothing. It MAY omit both or set them to
`false`.

A server given neither MUST NOT declare `resources`. No AFD server serves prompts yet, so none may
declare `prompts`. How a server without resources answers a `resources/*` request is not specified:
today some answer `-32601` and some answer an empty list, and either conforms. (Python's SDK
declared empty `resources` and `prompts` capabilities by default; step 3 removed them. See the
proposal's [current behavior](../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md#how-servers-behave-today).)

### R2. Resource entries

Each entry carries:

| Field | Rule |
| --- | --- |
| `uri` | REQUIRED. An absolute URI ([RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986)) with a scheme and no whitespace or control character; unique within the server. Compared as an exact string: no normalization, no case folding |
| `name` | REQUIRED, non-empty |
| `title`, `description`, `icons`, `annotations` | Optional, as MCP defines them, passed through unchanged |
| `mimeType` | Optional; SHOULD be set |
| `size` | The length in bytes of the raw content `resources/read` returns. REQUIRED when the provider gives the content's bytes up front, as it does for every skill file; otherwise SHOULD be set when known. When set, it MUST equal the byte length of what a read returns |
| `_meta` | Optional. Keys follow the [key rule](#t2-the-key-rule), except that `ui` is not allowed on a resource entry. The server adds `dev.afd/digest` (R6) and nothing else |

The server MUST refuse to start, with an error naming the entry, when the provider's entries break
any rule in this table, when two entries share a `uri`, when a provider entry uses the `skill://`
scheme (it belongs to the skill catalog, [S5](#s5-skill-files-as-resources)), or when a `ui://` entry
lacks the `mimeType` `text/html;profile=mcp-app` (MCP Apps reserves the scheme for that
type). Where a language's provider can change its entries while the server runs, the server checks
them each time it lists them and answers `-32603` for a list that breaks a rule.

### R3. `resources/list`

- **Contents and order.** The provider's entries in the provider's order, then the skill files of
  [S5](#s5-skill-files-as-resources). The order MUST be the same on every call while the entries
  are unchanged.
- **One page.** The whole list is returned with no `nextCursor`. A request carrying a `cursor`
  answers `-32602`: the server never issues one.
- **Variation by authorization only.** The list MUST NOT vary per connection, per 2025 session, as a
  side effect of other requests, or by `_meta["dev.afd/context"]`: AFD contexts scope commands, not
  resources. MCP lets a list vary by authorization: where a language's resource provider supports
  per-caller listings (such as Rust's `ResourceProvider::list_for`,
  [MCP authorization](./authorization.md#other-methods)), the server passes the request's verified
  credentials so the provider may filter entries per caller. Without per-caller providers (or with
  no authorization configured and no verified credentials on the request), the list does not vary by
  caller.
- **Cache hints.** In MCP 2026-07-28, `ttlMs` and `cacheScope` are fields of the **result**, not of
  each resource. A modern-era result carries `ttlMs` equal to the server's `tools/list` TTL option
  (`toolsListTtlMs`, `tools_list_ttl_ms`, `with_tools_list_ttl_ms`), 300,000 by default. Contexts do
  not lower it to 0, because the list does not vary by context. `cacheScope` is `"private"` whenever
  a `ResourceProvider` is attached on a server that supports per-caller providers and either
  authorization is configured or the request carries verified credentials (failing safe even for a
  static provider on such a server); otherwise — including skills-only servers and unauthenticated
  servers — `cacheScope` is `"public"`. A legacy-era result MAY omit both.

### R4. `resources/read`

- **Lookup.** `params.uri` is matched exactly against the URIs the server serves. A server MAY
  serve a URI it does not list, as the Skills extension allows for unlisted skills; an AFD skill
  catalog serves only what it lists. Where a language's provider supports per-caller reads (such as
  Rust's `ResourceProvider::read_for`, [MCP authorization](./authorization.md#other-methods)), the
  server passes the request's verified credentials, and a resource the caller may not read answers
  `-32602` (`Resource not found`), identical to an absent URI.
- **Unknown URI.** A JSON-RPC error `-32602` with message `Resource not found` and
  `data: { "uri": <the requested URI> }`, on **both** eras. MCP 2026-07-28 requires `-32602` and
  forbids `-32002`; 2025-11-25 recommends `-32002` (a SHOULD) but does not require it. A
  2026-07-28 client is told to accept both codes, and a 2025 client receives a standard JSON-RPC
  Invalid params error, so one code serves both eras. An empty `contents`
  array is never an answer.
- **Result.** `contents` holds exactly one item for the URI: `uri`, `mimeType` (the entry's, when
  set), and `text` when the bytes are valid UTF-8, otherwise `blob` with their standard base64
  encoding (RFC 4648, with padding). A provider MAY add `_meta` to the item under the
  [key rule](#t2-the-key-rule), where `ui` *is* allowed, so MCP Apps views can carry their
  `_meta.ui` (`csp`, `permissions`, `domain`, `prefersBorder`). A read of a listed entry with a
  `size` MUST return that many bytes.
- **Cache hints.** A modern-era result carries R3's `ttlMs`. For a read served from a
  `ResourceProvider`, `cacheScope` follows R3 (`"private"` when the server supports per-caller
  providers and either authorization is configured or the request carries verified credentials;
  otherwise `"public"`). Reads served from a static `SkillCatalog` always carry
  `cacheScope: "public"`, because skill catalogs are fixed at build time and do not vary by caller.
  A legacy-era result MAY omit both.
- **Not a command.** A read runs no command, middleware, confirmation, approval or journal entry,
  and the Rust context hook does not run for it. Errors are JSON-RPC errors, not `CommandResult`s.

### R5. Headers, templates and subscriptions

- **`Mcp-Name`.** On Streamable HTTP in the modern era, `resources/read` carries `Mcp-Name` equal to
  `params.uri` (base64-sentinel encoded when not plain ASCII). A missing or mismatched header is HTTP
  400 with `-32020`, as for `tools/call`; AFD relies on each SDK for it
  ([protocol conformance](./protocol-conformance.md#acceptance-index)). MCP requires the header only
  on `tools/call`, `resources/read` and `prompts/get`, so a server MUST NOT reject `skills/list`,
  `skills/get` or `resources/directory/read` for lacking it.
- **Templates.** `resources/templates/list` answers an empty `resourceTemplates` list, with R3's
  `ttlMs` and `cacheScope: "public"` on the modern era. Resource templates are not specified in this
  version.
- **Subscriptions.** None. `resources/subscribe` answers `-32601`, and a modern
  `subscriptions/listen` asking for `resourceSubscriptions` gets no resource notifications.

### R6. Digests in resource `_meta`

A resource's digest goes in **its own `_meta`**, under the key `dev.afd/digest`, as a
[digest](#terms) string. The server sets it:

- on every skill file's entry, computed from the bytes it serves, so it equals the digest in that
  skill's `skills/list` manifest;
- on a provider entry, when the provider gives the content's bytes up front, computed the same way.

A provider cannot set `dev.afd/digest` itself (the key rule reserves `dev.afd/`). Hosts on top of
AFD that also want their own key MAY add one under their own prefix; Umbel reads AFD's. Digests are
unsigned and come from the same server as the content: they show consistency, not trust.

## Skills

### S1. Opt-in and the declaration

A server given a skill catalog MUST declare the extension in the `extensions` field of its
capabilities, in the `server/discover` result and in the `initialize` result:

```json
{
  "capabilities": {
    "resources": {},
    "extensions": { "io.modelcontextprotocol/skills": {} }
  }
}
```

`directoryRead` is omitted, or `false`, unless the catalog enables directory reads
([S6](#s6-directory-reads)); then the settings object is `{ "directoryRead": true }`. The server MUST
also declare `resources` (R1) and serve every skill file as a resource (S5). It answers `skills/list`
and `skills/get` whether or not the client declared the extension: answering a request needs no
client capability. A server with no catalog answers both with `-32601`.

### S2. The catalog and its checks

A catalog is fixed when the server is built: the server reads each skill's bytes once and never
re-reads them. It MUST refuse to start, with an error naming the skill and the rule, when:

| Check | Rule |
| --- | --- |
| `SKILL.md` | Every skill has one at its root |
| Frontmatter | `SKILL.md` begins with a line `---`, then YAML, then a line `---`. The YAML is one mapping with string keys, read with the YAML 1.2 core schema, using no tags, anchors or aliases; every value is a string, finite number, boolean, null, sequence or mapping, nested at most 64 levels deep; no key is repeated. So `2026-11-01` unquoted is a string, as in JSON |
| `name` | A string of 1 to 64 characters of `a-z`, `0-9` and `-`, not starting or ending with `-`, with no `--` (Agent Skills) |
| `description` | A non-empty string of at most 1,024 characters (Agent Skills) |
| Skill path | Its last segment equals `name`. Prefix segments, if any, follow the same character rule as `name`. Unique in the catalog |
| Names | Unique in the catalog, even under different prefixes. The extension only asks that names SHOULD be unique; AFD requires it, so no host can confuse two of one server's skills |
| File paths | Relative, `/`-separated, valid UTF-8; no empty, `.` or `..` segment; no two equal. A file read from disk is a regular file inside the skill's directory: a symbolic link that leaves it is refused |
| Manifest boundary | Each file's URI, `skill://<skill path>/<file path>`, identifies a distinct file inside the skill's directory, as SEP-2640 requires of every manifest URI. Compare the URIs after RFC 3986 normalization (section 6.2.2), which decodes percent-encoded unreserved characters, so `%2e` is `.` and `%41` is `A`. In the path before any `?` or `#`, resolving `.` and `..` segments must not leave the skill's directory, the last segment is not empty, `.` or `..`, and no two files' URIs are equal. So `%2e%2e/x.md` and `refs/%2E` are refused, and so is `%41.md` beside `A.md` |
| Limits | At most 512 files and 16 MiB (16,777,216 bytes) in total per skill, `SKILL.md` included: the extension's limits, which every conforming host accepts |

A host may load less than these limits. Claude Code shows up to 100 skills a server, and for the
skills it scans (from claude.ai Directory connectors and connectors with organization scanning, not
a server added with `claude mcp add`) loads up to 100 KB a text file and 400 KB a skill. So a catalog
that passes S2 can be partly invisible there; `afd validate --surface` warns about it without
refusing the catalog.

The server never acts on a skill's content. It reads only the frontmatter, to check it and to serve
it; the body and every other file are served as bytes.

### S3. `skills/list`

- **Entries.** One per skill, in catalog order, each with:
  - `uri`: `skill://<skill path>/SKILL.md`;
  - `frontmatter`: the parsed frontmatter as a JSON object, every field the author wrote, unchanged;
  - `resources`: the skill's complete manifest, `{ "uri", "digest", "size" }` for every file,
    `SKILL.md` first, then the other files in ascending order of their paths' UTF-8 bytes. `size` is
    the file's length in bytes and `digest` covers the same bytes. An AFD catalog never emits
    `"dynamic"`: its bytes are fixed.
- **One page.** No `nextCursor`; a `cursor` answers `-32602`, as in R3.
- **Cache hints.** A modern-era result carries R3's `ttlMs` and `cacheScope: "public"`; a legacy-era
  result MAY omit them.

### S4. `skills/get`

`params.uri` must equal an entry's `uri` exactly. Otherwise the answer is `-32602`, the code
SEP-2640 requires, including for the URI of a skill file other than `SKILL.md`. When `params.uri`
has the form of a `SKILL.md` URI (no `?` or `#`, and a last path segment `SKILL.md` after a
non-empty one), the error carries `data: { "uri": <the requested URI> }`. For any other URI, `data`
MAY be omitted. SEP-2640 does not specify the error's `data`, and an SDK may refuse such a URI
before the server's handler sees it: the Rust SDK, `rmcp`, does so from 3.9 and sends no `data`.
When a `data.uri` is present, it equals the requested URI. The result is `{ "skill": <the entry> }`,
identical to the entry `skills/list` returns.
The extension leaves open whether `skills/get` carries cache hints; an AFD modern-era result carries
the same `ttlMs` and `cacheScope: "public"` as S3, which hosts may ignore.

### S5. Skill files as resources

Every skill file is a resource, listed by `resources/list` after the provider's entries, skill by
skill in catalog order and, within a skill, in its manifest order:

| Field | Value |
| --- | --- |
| `uri` | `skill://<skill path>/<file path>` |
| `name` | For `SKILL.md`, the frontmatter `name`; otherwise the file path |
| `description` | For `SKILL.md`, the frontmatter `description`; otherwise omitted |
| `mimeType` | By the file's suffix, compared case-insensitively: `.md` `text/markdown`; `.txt` `text/plain`; `.json` `application/json`; `.yaml`, `.yml` `application/yaml`; `.toml` `application/toml`; `.csv` `text/csv`; `.html` `text/html`; `.css` `text/css`; `.js`, `.mjs` `text/javascript`; `.ts` `text/x-typescript`; `.py` `text/x-python`; `.sh` `text/x-shellscript`; `.svg` `image/svg+xml`; `.png` `image/png`; `.jpg`, `.jpeg` `image/jpeg`; `.gif` `image/gif`; `.pdf` `application/pdf`; anything else `application/octet-stream` |
| `size` | The file's length in bytes |
| `_meta` | `{ "dev.afd/digest": <its digest> }` (R6) |

`resources/read` of a skill file returns its bytes as R4 describes: `text` when they are valid
UTF-8, otherwise `blob`. Skill files are served whichever AFD context is active.

### S6. Directory reads

Off by default. When the catalog enables them, the server declares `directoryRead: true` and answers
`resources/directory/read` for every directory of every skill: the skill's root
(`skill://<skill path>`, with no trailing slash) and each subdirectory that holds a file. The result's
`resources` array (the field SEP-2640 names, with R3's `ttlMs` and `cacheScope: "public"` on the
modern era) lists the
directory's direct children in ascending order of each child's own name, its last path segment, by
UTF-8 bytes: files as their S5 resources, subdirectories as
`{ "uri", "name", "mimeType": "inode/directory" }` with `name` the segment. Any other URI
answers `-32602`. Directory resources are not listed by `resources/list`. With directory reads off,
`resources/directory/read` answers `-32601`.

### S7. Skills are untrusted content

A catalog's skills are served as data. The server never executes a skill file, never follows
instructions in one, and never widens anything for a skill: `allowed-tools` and every other field
are passed through in `frontmatter` and mean nothing to the server. What the extension asks of
hosts (origin shown to the model, per-skill approval, no implicit execution) is the host's job.

### S8. Command skills are separate

The [Skill Knowledge Layer](../docs/features/proposed/skill-knowledge-layer/skill-knowledge-layer.spec.md)
proposes `*.skill.md` **command skills**: guidance co-located with a command's source, linked from
its definition and returned by a `skill-docs` bootstrap command. They are a separate, local
convention and are not Agent Skills served over MCP. A server MAY also publish guidance as an Agent
Skill by putting it in its catalog; nothing converts one into the other.

## Tool `_meta`

### T1. Extra entries on a command's tool

A command MAY declare extra tool `_meta` entries (`toolMeta`, a map from key to JSON value). The
server emits them, beside its own entries ([Surfaces](./command-metadata.md#surfaces)):

| Where | Emitted |
| --- | --- |
| A command tool: the individual strategy, and the first-class tools of the hybrid strategy | In the tool's `_meta` |
| A grouped tool | In the command's entry of `_meta.actions`, with the other per-command `_meta` fields, where the language emits `_meta.actions` ([tool strategies](./tool-strategies.md#grouped)) |
| `afd-detail` | As `toolMeta`, on every strategy |
| Meta-tools, context tools and the grouped tool itself | Never |

Unset or empty is omitted, following the [reporting rules](./command-metadata.md#reporting-rules).
The order of keys is not significant.

### T2. The key rule

An extra key is allowed when it is either:

1. **a prefixed key** in MCP's `_meta` key format, with a prefix of **two or more** labels: labels
   separated by `.`, each starting with a letter and ending with a letter or digit, with only
   letters, digits and `-` between, then `/`, then a name that begins and ends with a letter or
   digit and has only letters, digits, `-`, `_` and `.` between. For example `dev.umbel/origin` or
   `com.example/flags`. It MUST NOT be under `dev.afd/`, and MUST NOT be under a prefix MCP reserves
   (any whose second label is `modelcontextprotocol` or `mcp`, such as `io.modelcontextprotocol/`);
   both prefix checks ignore case; or
2. **exactly `ui`**, the MCP Apps key. Its value MUST be an object; when it has `resourceUri`, that
   MUST be a string beginning `ui://`. AFD checks nothing else in it (`visibility` and future fields
   pass through), and does not check that the URI is served. Loam's views use it to name their
   `ui://` resource.

Every other key is refused when the command is defined or registered, with an error naming the
command and the key: in particular every key the server sets itself (`category`, `requires`,
`mutation`, `destructive`, `undoable`, `approval`, `examples`, `outputSchema`, `contexts`,
`actions`), every other unprefixed key, the deprecated MCP Apps key `ui/resourceUri` (its prefix has
one label), MCP's reserved keys (`progressToken`, `traceparent`, `tracestate`, `baggage`), and a key
holding a value that is not JSON. So an extra entry can never replace an entry the server sets.

The same rule governs a resource entry's and a read content item's `_meta` (R2, R4).

### T3. Lists stay fixed

Extra `_meta` is part of the command's definition, so it is fixed while the server runs and does not
vary by request or context. A hybrid first-class tool still equals the individual tool for the same
command ([H3](./tool-strategies.md#h3-the-tool-list-and-its-order)), extra entries included.

## Advertised and validation schemas

### V1. Two schemas, one command

A command MAY be registered with two input schemas: the **validation schema**, which the registry
compiles and validates every call against exactly as [validation](./validation.md) describes, and the
**advertised schema**, which every surface shows. Without an advertised schema, both are the
command's one schema, as today.

| Surface | Schema |
| --- | --- |
| Tool `inputSchema` (individual, hybrid first-class), grouped `_meta.actions` and inlined grouped schemas | Advertised, with the `confirm` property where [Confirmations](./command-metadata.md#confirmations) adds it |
| `afd-detail` `inputSchema`, `afd-schema`, the `afd-docs` parameter table | Advertised |
| Validation of every call, on every route and surface | Validation |

The use is a wrapped tool whose schema uses keywords AFD's checker refuses: the host advertises the
wrapped server's schema unchanged and validates with the subset it can check, and the wrapped server
validates the rest.

### V2. What is checked

The advertised schema MUST be a JSON object whose `type` is `"object"`; nothing else in it is
checked or compiled, and an advertised schema that is not an object, or has another `type`, is
refused at registration naming the command. The validation schema follows every existing rule. AFD
cannot prove the two agree and does not try: keeping the validation schema no wider than the
advertised one is the registering code's duty. `afd validate --surface` SHOULD warn when a property
is required by one schema and absent from the other.

## Conformance

[`vectors/mcp-resources.json`](./vectors/mcp-resources.json) pins the rules a language can get subtly wrong: the key
rule (accepted and refused keys), the skill manifest, the skill files as resources and their reads
(digests, sizes, MIME types, `text` or `blob`), the catalog checks that must fail, and the read and
get errors. It is written by hand from this page; its digests were computed with `shasum -a 256` over
the exact bytes in the file (each `text` encoded as UTF-8, each `base64` decoded). It sits in
[`vectors/`](./vectors/README.md), where `alfred parity` verifies that all four languages load it.

The file's sections and what a loader checks:

- **`toolMetaKeys`:** defining a command whose `toolMeta` holds `key` with `value` succeeds when
  `allowed` is `true` and fails, naming the key, when it is `false`.
- **`catalog`:** a skill catalog of the listed skills, each a skill path and its files (`text` or
  `base64`). With it, and no provider:
  - `skills/list` returns exactly `skillsList.skills`;
  - `resources/list` returns exactly `resourcesList.resources`, in order;
  - each entry of `reads` returns exactly its `contents` for its `uri`;
  - each entry of `skillsGet` returns `{ "skill": ... }` equal to the `skillsList` entry at
    `skillsListIndex`;
  - each entry of `errors` answers JSON-RPC error `code` to `method` with `params.uri` set to `uri`,
    with `data.uri` equal to it. An entry with `"dataOptional": true` (S4, a URI that is not a
    `SKILL.md` URI) MAY omit `data`; a `data.uri` it carries still equals `uri`.

  The files of a skill are given out of order on purpose: the manifest sorts them.
- **`catalogFailures`:** each catalog must fail when the server is built, with an error message
  containing `entry`.

Cache hints and `resultType` are not part of the expected results; R3 and S3 state them.

## Implementation status

<!-- generated:capabilities:spec.mcp-resources.status:start -->
| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Resources (R1 to R6) | Yes (`resources` option; `/mcp` and stdio; per-caller `ResourceCaller` and `"private"` `cacheScope` under `auth`, #2265; not the deprecated `/sse` lane) | Yes (`resources` option; Streamable HTTP, SSE and stdio, both eras; per-caller `ResourceCaller` and `"private"` `cacheScope` under `auth`, #2266; #1981) | Yes (Umbel phase 1 step 0b; per-caller `list_for`/`read_for` and `"private"` `cacheScope` under `server-auth`, #1880) | Yes (`StdioServerOptions::resources` on `afd::mcp_stdio`, both eras; #1983) |
| Skills extension (S1 to S6) | Yes (`skills: SkillCatalog`) | Yes (`skills=SkillCatalog`, `skill_from_directory`, optional `directory_read`; #1981) | Yes (step 0b) | Yes (`StdioServerOptions::skills`, `skill_from_directory`, optional `directory_read`; #1983) |
| Extra tool `_meta` (T1 to T3) | Yes (`defineCommand({ toolMeta })`) | Yes (`tool_meta` on `@server.command`/`define_command`/`CommandDefinition`; #1981) | Yes (step 0b) | Yes (`CommandDefinition::tool_meta`; #1983) |
| Advertised and validation schemas (V1, V2) | Yes (`advertisedInputSchema`) | Yes (`advertised_input_schema`; #1981) | Yes (step 0b) | Yes (`CommandDefinition::advertised_input_schema`; #1983) |
| Loads [`vectors/mcp-resources.json`](./vectors/mcp-resources.json) | Yes (`mcp-resources-vectors.test.ts`, over Streamable HTTP and stdio) | Yes (`tests/test_mcp_resources_vectors.py` and `test_tool_meta.py`, over Streamable HTTP and stdio; #1981) | Yes (step 0b: `tests/mcp_resources_vectors.rs`) | Yes (`tests/mcp_resources_vectors_test.cpp` and `tests/tool_meta_test.cpp`, over stdio in both eras; #1983) |
<!-- generated:capabilities:spec.mcp-resources.status:end -->

All four languages — Rust (`packages/rust`, Umbel phase 1 step 0b), TypeScript (`packages/server`,
#615), Python (`python/`, #1981) and C++ (`packages/cpp`, #1983) — serve resources,
the Skills extension and extra tool `_meta`, and keep an advertised schema apart from the validation
schema. TypeScript serves them on `/mcp` and stdio, in both eras; its deprecated `/sse` and `/message`
lane (MCP 2024-11-05, not an era this page governs) serves none of it and declares none of it.
Rust (`ResourceProvider::list_for`/`read_for`, `ResourceCaller`, #1880), TypeScript
(`ResourceProvider.list`/`read` with `ResourceCaller`, #2265) and Python
(`ResourceProvider.list`/`read` with `ResourceCaller`, #2266) support per-caller resource providers
and emit `cacheScope: "private"` on modern-era `resources/list` and provider-backed `resources/read`
whenever a `ResourceProvider` is attached on an authorized server or a request carrying verified
credentials, while keeping static `SkillCatalog` reads `"public"`. C++'s `afd::mcp_stdio` is
stdio-only with no HTTP authorization layer, so its resource results carry `cacheScope: "public"`.
The proposal's
[current behavior](../docs/features/complete/mcp-resources-skills/mcp-resources-skills.proposal.md#how-servers-behave-today)
records the pre-implementation baseline.

One rule depends on the SDK: Rust's `skills/get` omits `data` for a URI that is not a `SKILL.md`
URI, because `rmcp` 3.9 refuses it before the server's handler runs (S4), whereas TypeScript, Python
and C++ send
`data.uri` there too. All four languages — Rust (with `rmcp`'s own check), TypeScript (`SkillCatalog`
in `packages/server/src/skills.ts`), Python (`SkillCatalog` in `python/src/afd/server/skills.py`),
and C++ (`ResourceService` in `packages/cpp/src/mcp_stdio/resources.cpp`) — enforce the S2 RFC 3986
manifest boundary when the catalog is built, and all four run every case in
[`vectors/mcp-resources.json`](./vectors/mcp-resources.json). Progress is recorded in the
[status](../docs/features/complete/mcp-resources-skills/STATUS.md).
