# MCP resources, skills and tool `_meta`

What an AFD MCP server serves beyond tools: MCP **resources** (`resources/list`, `resources/read`),
the **Skills over MCP extension** (`io.modelcontextprotocol/skills`, SEP-2640), **extra `_meta`
entries on a command's tool**, and a command's **advertised input schema** kept apart from the one
the registry validates with. All four are opt-in; a server that uses none of them is unchanged.
Which languages serve them is in [Implementation status](#implementation-status).

Every rule here is new and normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The [MCP resources and skills proposal](../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md)
explains why, records the choices this page makes, and tracks progress in its
[status](../docs/features/active/mcp-resources-skills/STATUS.md). Prompts are not specified yet; the
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
| Resources | `resources: ResourceProvider` | `resources=ResourceProvider` | `with_resources(impl ResourceProvider)` | After `afd::mcp_stdio` ([#341](https://github.com/lushly-dev/afd/issues/341)) |
| Skills | `skills: SkillCatalog` | `skills=SkillCatalog` | `with_skills(SkillCatalog)` | After #341 |
| Directory reads | A catalog option, off by default | Same | `SkillCatalog::with_directory_read(true)` | After #341 |
| Extra tool `_meta` | `defineCommand({ toolMeta })` | `@server.command(tool_meta=...)` | `CommandDefinition::with_tool_meta(key, value)` | `CommandDefinition::tool_meta` |
| Advertised schema | `defineCommand({ advertisedInputSchema })` | `advertised_input_schema=` | `CommandRegistry::register_with_schemas(command, validation, advertised)` | `CommandDefinition::advertised_input_schema` |

The Rust names are binding: Umbel's [phase 1 plan](../endpoints/umbel/docs/phases/1-plugin-contract/spec.md#step-0-afd-first)
builds on them. The other languages' names are proposed; each language's step may adjust the
idiom, never the behavior.

## Resources

### R1. Opt-in and the capability

A server given a resource provider, a skill catalog or both MUST declare the `resources`
capability, in the `server/discover` result and in the `initialize` result. It MUST NOT set
`subscribe` or `listChanged` to `true`: AFD servers push nothing. It MAY omit both or set them to
`false`.

A server given neither MUST NOT declare `resources`. No AFD server serves prompts yet, so none may
declare `prompts`. How a server without resources answers a `resources/*` request is not specified:
today some answer `-32601` and some answer an empty list, and either conforms. (Python's SDK declares
empty `resources` and `prompts` capabilities today; its step removes them. See the proposal's
[current behavior](../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md#how-servers-behave-today).)

### R2. Resource entries

Each entry carries:

| Field | Rule |
| --- | --- |
| `uri` | REQUIRED. An absolute URI ([RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986)) with a scheme; unique within the server. Compared as an exact string: no normalization, no case folding |
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
- **No variation by request.** The list MUST NOT vary per connection, per 2025 session, as a side
  effect of other requests, or by `_meta["dev.afd/context"]`: AFD contexts scope commands, not
  resources. MCP lets a list vary by the authorization on the request; this version gives the
  provider no request input, so an AFD list never does. Per-caller resources wait for the
  [MCP authorization proposal](../docs/features/proposed/mcp-authorization/mcp-authorization.proposal.md).
- **Cache hints.** In MCP 2026-07-28, `ttlMs` and `cacheScope` are fields of the **result**, not of
  each resource. A modern-era result carries `ttlMs` equal to the server's `tools/list` TTL option
  (`toolsListTtlMs`, `tools_list_ttl_ms`, `with_tools_list_ttl_ms`), 300,000 by default, and
  `cacheScope: "public"`. Contexts do not lower it to 0, because the list does not vary by context.
  A legacy-era result MAY omit both.

### R4. `resources/read`

- **Lookup.** `params.uri` is matched exactly against the URIs the server serves. A server MAY
  serve a URI it does not list, as the Skills extension allows for unlisted skills; an AFD skill
  catalog serves only what it lists.
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
- **Cache hints.** A modern-era result carries the same `ttlMs` and `cacheScope: "public"` as R3. A
  legacy-era result MAY omit both.
- **Not a command.** A read runs no command, middleware, confirmation, approval or journal entry,
  and the Rust context hook does not run for it. Errors are JSON-RPC errors, not `CommandResult`s.

### R5. Headers, templates and subscriptions

- **`Mcp-Name`.** On Streamable HTTP in the modern era, `resources/read` carries `Mcp-Name` equal to
  `params.uri` (base64-sentinel encoded when not plain ASCII). A missing or mismatched header is HTTP
  400 with `-32020`, as for `tools/call`; AFD relies on each SDK for it
  ([protocol conformance](./protocol-conformance.md#acceptance-index)). MCP requires the header only
  on `tools/call`, `resources/read` and `prompts/get`, so a server MUST NOT reject `skills/list`,
  `skills/get` or `resources/directory/read` for lacking it.
- **Templates.** `resources/templates/list` answers an empty `resourceTemplates` list, with the R3
  cache hints on the modern era. Resource templates are not specified in this version.
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
| Frontmatter | `SKILL.md` begins with a line `---`, then YAML, then a line `---`. The YAML is one mapping with string keys, read with the YAML 1.2 core schema, using no tags, anchors or aliases; every value is a string, finite number, boolean, null, sequence or mapping. So `2026-11-01` unquoted is a string, as in JSON |
| `name` | A string of 1 to 64 characters of `a-z`, `0-9` and `-`, not starting or ending with `-`, with no `--` (Agent Skills) |
| `description` | A non-empty string of at most 1,024 characters (Agent Skills) |
| Skill path | Its last segment equals `name`. Prefix segments, if any, follow the same character rule as `name`. Unique in the catalog |
| Names | Unique in the catalog, even under different prefixes. The extension only asks that names SHOULD be unique; AFD requires it, so no host can confuse two of one server's skills |
| File paths | Relative, `/`-separated, valid UTF-8; no empty, `.` or `..` segment; no two equal. A file read from disk is a regular file inside the skill's directory: a symbolic link that leaves it is refused |
| Limits | At most 512 files and 16 MiB (16,777,216 bytes) in total per skill, `SKILL.md` included: the extension's limits, which every conforming host accepts |

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

`params.uri` must equal an entry's `uri` exactly. Otherwise the answer is `-32602` with
`data: { "uri": <the requested URI> }`, including for the URI of a skill file other than
`SKILL.md`. The result is `{ "skill": <the entry> }`, identical to the entry `skills/list` returns.
The extension leaves open whether `skills/get` carries cache hints; an AFD modern-era result carries
the same `ttlMs` and `cacheScope: "public"` as `resources/read`, which hosts may ignore.

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
(`skill://<skill path>`, with no trailing slash) and each subdirectory that holds a file. The result
lists the directory's direct children in ascending order of their names' UTF-8 bytes: files as their
S5 resources, subdirectories as `{ "uri", "name", "mimeType": "inode/directory" }`. Any other URI
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
   or
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

[`mcp-resources.json`](./mcp-resources.json) pins the rules a language can get subtly wrong: the key
rule (accepted and refused keys), the skill manifest, the skill files as resources and their reads
(digests, sizes, MIME types, `text` or `blob`), the catalog checks that must fail, and the read and
get errors. It is written by hand from this page; its digests were computed with `shasum -a 256` over
the exact bytes in the file (each `text` encoded as UTF-8, each `base64` decoded). Each language's
step adds its loader.

It sits beside [`tool-strategies.json`](./tool-strategies.json), not in [`vectors/`](./vectors/README.md),
because `alfred parity` requires every file in `vectors/` to be loaded by all four languages. It moves
to `vectors/` in the pull request that makes the fourth language load it.

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
    with `data.uri` equal to it.

  The files of a skill are given out of order on purpose: the manifest sorts them.
- **`catalogFailures`:** each catalog must fail when the server is built, with an error message
  containing `entry`.

Cache hints and `resultType` are not part of the expected results; R3 and S3 state them.

## Implementation status

| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Resources (R1 to R6) | Planned | Planned | Planned (Umbel phase 1 step 0b) | Planned (after #341) |
| Skills extension (S1 to S6) | Planned | Planned | Planned (step 0b) | Planned (after #341) |
| Extra tool `_meta` (T1 to T3) | Planned | Planned | Planned (step 0b) | Planned |
| Advertised and validation schemas (V1, V2) | Planned | Planned | Planned (step 0b) | Planned |
| Loads [`mcp-resources.json`](./mcp-resources.json) | Planned | Planned | Planned (step 0b) | Planned |

Today no language serves resources, the Skills extension or extra tool `_meta`, and none keeps an
advertised schema apart from its validation schema. Python's SDK declares empty `resources` and
`prompts` capabilities, which R1 forbids. The proposal's
[current behavior](../docs/features/active/mcp-resources-skills/mcp-resources-skills.proposal.md#how-servers-behave-today)
records what each does instead. Progress is recorded in the
[status](../docs/features/active/mcp-resources-skills/STATUS.md).
