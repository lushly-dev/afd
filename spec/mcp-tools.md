# MCP tools: extra `_meta` and advertised schemas

Two parts of a command's MCP tool that the core specifies beside
[command metadata](./command-metadata.md): **extra `_meta` entries** a command declares, and an
**advertised input schema** kept apart from the one the registry validates with. Both are opt-in
per command; a command that uses neither is unchanged. They were specified with MCP resources and
skills ([`mcp-resources.md`](./mcp-resources.md)) until the contract was split into a core and
profiles; resources and skills are a profile, and these two rules are the core's.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The rules follow the MCP specification
[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) (`_meta` key names) and the
[MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview)
(`io.modelcontextprotocol/ui`).

## Terms

| Term | Meaning |
| --- | --- |
| Extra tool `_meta` | `_meta` entries a command declares (`toolMeta`), emitted on its tool beside the entries the server sets itself |
| Advertised schema | The input schema a command shows on every surface; by default the same as its validation schema |

## Options

| | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Extra tool `_meta` | `defineCommand({ toolMeta })` | `@server.command(tool_meta=...)` | `CommandDefinition::with_tool_meta(key, value)` | `CommandDefinition::tool_meta` |
| Advertised schema | `defineCommand({ advertisedInputSchema })` | `advertised_input_schema=` | `CommandRegistry::register_with_schemas(command, validation, advertised)` | `CommandDefinition::advertised_input_schema` |

All four languages implement these options.

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
| Tool `inputSchema` (individual, hybrid first-class), grouped `_meta.actions` and inlined grouped schemas | Advertised, with the `confirm` property where [Confirmations](./confirmations.md) adds it |
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

The `toolMetaKeys` section of [`vectors/mcp-resources.json`](./vectors/mcp-resources.json), which
the registry assigns to the core: defining a command whose `toolMeta` holds `key` with `value`
succeeds when `allowed` is `true` and fails, naming the key, when it is `false`.

## Implementation status

<!-- generated:capabilities:spec.mcp-tools.status:start -->
| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Extra tool `_meta` (T1 to T3) | Yes (`defineCommand({ toolMeta })`) | Yes (`tool_meta` on `@server.command`/`define_command`/`CommandDefinition`; #1981) | Yes (step 0b) | Yes (`CommandDefinition::tool_meta`; #1983) |
| Advertised and validation schemas (V1, V2) | Yes (`advertisedInputSchema`) | Yes (`advertised_input_schema`; #1981) | Yes (step 0b) | Yes (`CommandDefinition::advertised_input_schema`; #1983) |
<!-- generated:capabilities:spec.mcp-tools.status:end -->
