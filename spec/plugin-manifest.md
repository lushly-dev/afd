# Plugin manifest

One manifest format for the hosts in this repository that load plugins. A host-neutral **core**,
[`plugin-manifest.core.v1.json`](./plugin-manifest.core.v1.json), defines the keys every host shares,
each with one meaning. A **profile** is one host's closed schema for one manifest version: it
references the core, adds that host's sections and closes its vocabularies. A file is written for
one profile. A Loam app and an Umbel plugin therefore use the same keys with the same meanings, and
a reader that knows the core reads the shared part of either file. Which languages read it is in
[Implementation status](#implementation-status).

Every rule here is new and normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119. The [shared plugin manifest proposal](../docs/features/active/plugin-manifest/plugin-manifest.proposal.md)
explains why, and tracks progress in its [status](../docs/features/active/plugin-manifest/STATUS.md).
Decision numbers carry their unit: "Umbel D37", "Loam D10".

The spelling is snake_case. A file is TOML or JSON, read as JSON. The manifest is untrusted input: a
host never takes a plugin's trust from it. Loading, discovery and trust stay each host's.

## Terms

| Term | Meaning |
| --- | --- |
| Core | The definitions in `plugin-manifest.core.v1.json`: `$defs` only, with every object left open |
| Profile | One host's closed schema for one manifest version, conforming to one core version |
| App or plugin | What a manifest describes; its identity is `plugin.id` |
| Instance | A deployer's use of an app. A host may run several of one app |
| Headless | With no UI contributions: a manifest with no `ui`, valid in every kind |
| Reader | Code that loads a manifest: it validates against a profile, then applies [the rules beyond the schema](#rules-beyond-the-schema) |

## Profiles

A profile MUST meet this contract. [`plugin-manifest.json`](./plugin-manifest.json) holds a reference
profile that does, with a case for each part.

### P1. Closing

A profile MUST close every core object it admits, at every depth: the root, `plugin`, each command,
`expose`, `examples[]`, `output_budget`, each grant, context, pipeline and step, skill, `config`,
`mount`, each mount tool, and `ui` where it defines `ui`. Each closed object has a refusal case.

It closes an object with `$ref` to the core definition, its own `properties` and
`unevaluatedProperties: false`, **all in the same schema object**:

```json
{
	"type": "object",
	"$ref": "https://afd.dev/spec/plugin-manifest.core.v1.json#/$defs/plugin",
	"properties": { "kind": { "enum": ["native", "view", "mounted"] }, "domains": true },
	"required": ["domains"],
	"unevaluatedProperties": false
}
```

`unevaluatedProperties` sees what that object's own `$ref` evaluated. It does not see a sibling path,
so a profile whose root `$ref`s the core and which closes `plugin` with no `$ref` of its own refuses
every valid manifest: the JSON Schema test suite's case "unevaluatedProperties can't see inside
cousins". And it does not reach into a nested object: a root closed alone leaves
`commands[].expose.pallete` accepted. The cases `cousin-*` and `shallow-*` pin both.

A closed object MUST NOT hold `if`, `then`, `else` or `dependentSchemas` beside its `$ref`: put a
conditional in `allOf`, as the reference profile does. Ajv and `jsonschema` differ otherwise, and Ajv
refuses valid manifests ([Validators](#validators)).

The values of `input_schema`, `returns`, `config.schema`, `tool_meta`, `examples[].input` and
`steps[].input` are data, not core objects. They stay open.

### P2. Narrowing

A profile MAY refuse an optional core key, and MAY close a core vocabulary: kinds, the host's own
domains, a grant catalog, transports, effects.

A `$ref` to a core definition admits every key of that definition the profile does not mention, so
`unevaluatedProperties` does not refuse them. To refuse one, the profile sets it to `false`. To
refuse an effect it does so in each of the three places effects appear: a command, a pipeline and a
mount tool.

### P3. Adding

A profile MAY add keys of its own. A host-only top-level key belongs in a section that host owns, and
no two hosts claim one name:

| Name | Where | Owner |
| --- | --- | --- |
| `component`, `packs` | Top level | Umbel |
| `confirm` | A command | Umbel |
| `command`, `cwd`, `env`, `bearer` | `mount` | Umbel |
| `bind_space` | A mount tool | Umbel |
| `ui` | Top level, in the core as an object | Loam, which defines its contents |
| `app`, `native`, `view`, `agent` | Top level | Loam |

A change to this table is a change to this page.

### P4. Limits

A profile MUST NOT change a core key's type, meaning or default, admit a value the core refuses, or
give a reserved key another meaning. The first of those needs a reader's care; the others follow from
the `$ref`: a profile that defines `scopes`, or widens `plugin.kind` past the core's pattern, still
refuses them (the cases `overreach-*`).

### P5. Refusals

Every refusal MUST name the key and carry a suggestion, as an AFD error does. A case gives the key,
its pointer and a suggestion; the pointer is normative and the suggestion's wording is an example.

### P6. One profile per file

A profile names the core version it conforms to. A file is written for one profile, which its file
name identifies. The file's `manifest_version` and `protocol` are that profile's version and that
host's plugin protocol. A profile that does not reference the core conforms by comparison, as Umbel's
does, and this page names its core version.

### Umbel's profile

Umbel's `endpoints/umbel/schemas/plugin-manifest.v1.json` and `v2.json` are the first profile. They
conform to core version 1 unchanged, written before it and closed with `additionalProperties`, not by
`$ref`: they refuse the core's optional additions, close `kind`, the domain rule and the grant catalog,
own the keys in P3, and name the grants that `store-write` and `workspace-write` need. One check sits
in Umbel's reader, not its schema: the schema alone admits `mount.prefix = "afd"`, and the reader
refuses it, because the prefix must be one of `plugin.domains` and no domain may be `afd`.

`scripts/plugin-manifest.test.mjs` checks this conformance: the example, plugin and scaffold manifests
Umbel ships validate against the core, its schemas add only the keys in P3 and close every object they
define, they refuse every core refusal in the cases, naming the same key, and they admit no value the
core refuses, compared key by key. Umbel adopts the core by `$ref` only if it chooses to.

## Keys

[`plugin-manifest.core.v1.json`](./plugin-manifest.core.v1.json) holds each key's type, pattern and
length. These are the meanings. Keys and meanings are Umbel's wherever Umbel has them.

### K1. Versions

| Key | Required | Meaning |
| --- | --- | --- |
| `manifest_version` | Yes | The profile's manifest version, an integer from 1 |
| `protocol` | Yes | The host's plugin protocol version, an integer from 1 |
| `afd_contract` | No | The AFD contract version ([`VERSION`](./VERSION)) the plugin's results follow, checked by the rule `afd-contract`. Umbel's profile refuses the key: its protocol 1 already fixes the result |

### K2. Identity

`plugin`, required, holds:

| Key | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | The app or plugin identity, and the default instance id |
| `title`, `description` | Yes | Display text, at most 80 and 500 characters |
| `version` | Yes | A semantic version |
| `kind` | Yes | A lowercase name, which each profile closes |
| `domains` | No in the core | The first name segments the plugin's commands use. Never `afd`. Each profile refuses its own host domains, and may require the key |
| `homepage` | No | An https URL |
| `license` | No | An SPDX expression |

### K3. Commands

`commands[]` is optional: a mounted app's commands come from the server, and a headless app may have
none of its own. Each entry is declarative AFD command metadata, and [the mapping](#mapping-onto-afd)
names the AFD field of each key. `name`, `description`, `effects` and `input_schema` are required.

- `input_schema` and `returns` are a JSON Schema object or the path of a JSON file, relative to the
  plugin root.
- `approval` is `none` (the default, AFD's `not-required`) or `required`. A function cannot be data.
- `requires`, `undoable`, `title`, `errors` and `tool_meta` are AFD's fields of the same meaning.
- `first_class` is a suggestion to a hybrid host, which may decline it.
- `mutation` is never declared, and the core refuses it: the host derives it, `true` unless `effects`
  is exactly `["inspect"]`.

### K4. Effects

What a command may change. `inspect` stands alone.

| Value | Meaning | `mutation` |
| --- | --- | --- |
| `inspect` | Changes nothing anywhere | `false` |
| `plugin-state` | Changes state the plugin keeps itself | `true` |
| `external` | Acts on a system outside the host | `true` |
| `store-write` | Writes through one of the host's store write grants | `true` |
| `workspace-write` | Writes files outside the host's own state | `true` |

The profile names the grants `store-write` and `workspace-write` need, and may refuse a value.

### K5. Exposure

`expose` has `mcp`, `agent`, `cli` and `palette`, which mean what AFD's `expose` means
([command metadata](./command-metadata.md#fields)). A manifest's flags are the app's default exposure,
and a deployer may narrow them. A flag left out takes the profile's default (C5). `apps` is reserved,
and joins the core in version 2 with its AFD feature.

### K6. Grants

`grants[]` has `name`, `required` (default `true`) and `reason`. The entry's shape is shared, and so is
the vocabulary: a name two hosts use has one meaning ([Shared grant names](#shared-grant-names)). A
name outside the host's catalog is refused at load, not by the schema. `allow` stays the deployer's,
and `targets` is reserved for what a plugin asks a grant to reach.

### K7. Contributions

`contexts[]`, `pipelines[]`, `skills[]` and `config`. A pipeline is registered as a command, with
`steps` as data. `config` is the deployer's instance configuration, never a person's settings.

### K8. Mounting

`mount` has `prefix`, `transport`, `only` and `tools[]`, each tool with `tool`, `name`, `effects`,
`confirm_prompt`, `approval` and `first_class`. `transport` has one meaning per value: `stdio` is MCP
over a child's standard streams, and `http` is MCP Streamable HTTP. `url` and `bearer_env`, where and
with what credential, are the deployer's, and the core refuses them. The kind `mounted` and the key
`mount` go together, and a mounted manifest declares no `commands` (the rule `mounted`).

### K9. Reserved

Named now and refused by the core, so that no profile can give them another meaning. A later core
version may define any of them except `dependencies` and `allow`, which stay out of a manifest:

- top level: `connectors` (a federation connector contract), `backends` (store backends contributed
  by plugins), `dependencies` (plugins do not depend on each other), `signature` (signed plugins),
  `scopes` (per-command authorization), `on_conflict` (a conflict across instances is always `error`);
- in a command: `scopes`;
- in `expose`: `apps`;
- in a grant: `allow` (the deployer's), `targets`.

## Rules beyond the schema

A reader MUST apply these after the schema, naming the key and giving a suggestion. Each has cases in
the file's `rules`, each case a manifest that passes the core.

| Rule | Check | Failure |
| --- | --- | --- |
| `command-domain` | The first segment of a declared command's, pipeline's or context's name is one of `plugin.domains` | Refused |
| `mounted` | `kind = "mounted"` needs `mount`, any other kind refuses it, and a mounted manifest declares no `commands`: they come from the server, named by [Renaming](#instances) | Refused |
| `mount-prefix` | `mount.prefix` is one of `plugin.domains` | Refused |
| `unique` | Command and pipeline names are unique together, because a pipeline registers as a command. Each of these is also unique: context names, skill names, grant names, a pipeline's `steps[].as`, and a mount's `tools[].tool` and `tools[].name` | Refused |
| `context-declared` | A name in a command's `contexts` is declared in the manifest's `contexts` | Refused |
| `text` | `title`, `description`, `reason`, `confirm_prompt`, `category`, `homepage`, `license` and an example's `title` hold no control character (Unicode category Cc), since they reach a person's screen | Refused |
| `input-schema` | An `input_schema` is a `type: object` JSON Schema that the host's AFD checker accepts, which may refuse more keywords than JSON Schema does | Refused |
| `config-schema` | A `config.schema` is a `type: object` schema closed at its root (`additionalProperties: false`), valid under JSON Schema 2020-12 | Refused |
| `output-budget` | `output_budget.default_bytes` is at most `max_bytes`, and `max_bytes` is at most 2^53 − 1 ([B1](./output-budgets.md#b1-the-declaration)) | Refused |
| `skill-name` | A skill's name equals the plugin id or starts with `<id>-`, and equals the last segment of its path, a trailing `/` ignored | Refused |
| `tool-meta` | Each `tool_meta` key follows AFD's [key rule](./mcp-resources.md#t2-the-key-rule) | Refused |
| `requires` | A `requires` entry names a command or pipeline in the manifest. AFD calls `requires` metadata only | A warning |
| `afd-contract` | The major part of `afd_contract`, before the first `.`, equals that of the host's contract version | Refused |
| `path-inside-root` | A path in `input_schema`, `returns`, `config.schema` or `skills[].path` stays inside the plugin root once symbolic links are resolved. A link to nothing is refused, and so is a drive-prefixed path on Windows | Refused |
| `files` | Each such path exists. A schema path holds a JSON object, and an `input_schema` or `config.schema` file passes its rule above. A skill path is a directory holding `SKILL.md` | Refused |

## Shared grant names

A name both hosts use has one meaning. Host-only names stay in their profile, and a name moves into
this table only when a second host defines it with the same meaning.

| Name | One meaning |
| --- | --- |
| `clock`, `random` | Time and randomness from the command context, recorded for replay |
| `events` | Read the host's event stream by cursor, under the caller's access, without appending to it |
| `documents` | Read documents the host holds, under the caller's access. What a document is, is the host's |
| `http` | Outbound HTTP to hosts the plugin asks for, never with the caller's credentials |
| `secrets` | Named deployer secrets, never a person's tokens |

`targets`, when a grant defines it, says what a plugin asks a grant to reach: hosts for `http`, secret
names. It grants nothing. The deployer's allow-list stays in the host's instance configuration.

## Instances

An app has one identity, its `plugin.id`. An instance is a deployer's use of it. These rules are
shared, except where a row names one host.

| Rule | Meaning |
| --- | --- |
| Instance id | The deployer's name, unique in the host. It defaults to `plugin.id` for the first instance, and a second instance MUST name its own. Never in the manifest |
| Instance prefix | The first command-name segment every command of a mounted instance takes. It defaults to `mount.prefix` for the first instance. Unique among the host's apps and its shell or host domains. Never in the manifest |
| Renaming | An override name becomes `<prefix>-<name>`. Otherwise the tool's name is normalized: lowercased; each run of characters outside `[a-z0-9]` becomes one `-`; leading and trailing `-` are trimmed; a segment that starts with a digit gains a leading `n`. A normalized name that starts with `<manifest prefix>-` has that segment replaced by the instance prefix, and any other name gets `<prefix>-` in front. A result that fails the command name pattern, or an empty normalized name, is reported, not registered. The `renaming` cases pin this |
| Transport | The manifest's `mount.transport` is the app's default. Loam's instance entry may override it, because one server can be reached differently per Loam host. In Umbel the manifest's value stands |
| Conflict policy | Across instances, always `error`: two instances, or an instance and the host, that would register one name fail that instance's load, and nothing is overridden silently |
| Skills and resources between servers | Loam keys each mounted server's skills and resources by instance and URI, shows them as `<instance>/<name>`, and never merges them. Within one Umbel host, a plugin's skills are served once per plugin, however many instances mount it |
| References | A resource link or journal entry names the instance, not only the app |

The location and the credential of an instance are the deployer's and never enter a manifest.

## Collisions

Words that mean different things in the two hosts' documents, each resolved here.

| # | Collision | Resolution |
| --- | --- | --- |
| C1 | `scopes`. Umbel reserves it for per-command authorization scopes. Loam gives "scope" to workspace and project | `scopes` keeps Umbel's meaning. Loam's supported levels are `app.scope_levels` |
| C2 | The `documents` grant. Umbel reads store documents; Loam reads document metadata, references and backlinks | One meaning: [Shared grant names](#shared-grant-names) |
| C3 | `allow` in a grant. Allow-lists are the deployer's; Loam's `calls` and `http` grants need what the plugin asks for | `allow` stays the deployer's, never in a manifest. What a plugin asks for is the reserved `targets`, which grants nothing |
| C4 | "Pack". Umbel's pack is a plugin's data, and `pack` is also an Umbel kind. Loam's agent pack is skills, connectors, commands and sub-agents | `packs` and the kind `pack` stay Umbel's. Loam's agent packs go in its `agent` section, and a pack-only Loam app takes another kind name |
| C5 | Exposure defaults. AFD: palette and agent on, MCP and CLI off. Umbel's manifest: MCP, agent and CLI on, palette off | The meanings are shared, and the default for a flag left out is the profile's. A host's check command reports the effective flags. A manifest meant for more than one tool sets every flag |
| C6 | Confirmation. AFD's `confirmations` is server-wide. Umbel's per-command `confirm = "require-human"` makes a command CLI-only | `confirm_prompt` is in the core. `confirm` stays Umbel's, since its rule is tied to Umbel's CLI |
| C7 | `approval` values. Umbel: `none`, `required`. AFD: `not-required`, `required`, or a function | The core keeps `none`, which maps to `not-required`. A function cannot be data |
| C8 | The kind `mounted` | One meaning: an MCP server whose tools become commands under an instance prefix. Each profile closes the transports it admits |
| C9 | "Mount". The top-level `mount` is the MCP mount. Loam's "mount" is the element an app renders into | `mount` is the MCP mount. Loam's surface keys name the app's element (`element`), not a `mount` |
| C10 | "View". Loam's kind `view`, its `[view]` section, sandboxed resources and sidebar views | The kind and section are `view`. The resources are `ui.resources`. The sidebar key is Loam's |
| C11 | `connectors`. The core reserves it for a federation contract. Loam's agent packs carry `.mcp.json` connectors | `connectors` keeps the reserved meaning. Loam's agent packs mount those servers as instances of kind `mounted` |
| C12 | Instance and app. Umbel's `plugin.id` is the default instance id. Loam's app id is the command domain | The app id is the identity and the first instance's default id; the default prefix is `mount.prefix`. Each further instance names its own |

## Mapping onto AFD

A manifest command entry is declarative [command metadata](./command-metadata.md). The manifest never
invents a field AFD already defines.

| Manifest key | AFD field (wire) | MCP surface |
| --- | --- | --- |
| `name`, `description` | Same | Tool name and description |
| `title` | `title` | Tool `title` |
| `input_schema` | Input schema | `inputSchema` |
| `returns` | `returns` | `_meta.outputSchema` |
| `effects` | Derived `mutation` | `_meta.mutation` |
| `category`, `tags`, `version`, `examples` | Same | `_meta.category` and `_meta.examples`; tags and version through afd-detail |
| `requires` | `requires` | `_meta.requires` |
| `contexts` | `contexts` | `_meta.contexts` |
| `destructive`, `undoable` | Same | `_meta` |
| `confirm_prompt` | `confirmPrompt` | afd-detail, never `_meta` |
| `approval` | `approval` (`none` becomes `not-required`) | `_meta.approval` |
| `execution_time` | `executionTime` | afd-detail |
| `expose` | `expose` | Which surfaces list the command |
| `output_budget` | `outputBudget` | `_meta["dev.afd/outputBudget"]` |
| `errors` | `errors` | afd-detail |
| `tool_meta` | `toolMeta` | Merged into the tool's `_meta` ([T1](./mcp-resources.md#t1-extra-entries-on-a-commands-tool)) |
| `first_class` | None: a suggestion to a hybrid host | The first-class list, if the host accepts it |
| `skills[]` | Skills catalog | `skill://` resources and the Skills extension |

`handoff` and `handoffProtocol` are not in the core. A host that sets a `_meta` key of its own, as
Umbel sets `dev.umbel/origin`, MUST refuse that key in `tool_meta` or overwrite it, so a manifest
cannot forge it.

## Versioning

- **The core.** Integer versions, in the file name and `$id`. A new version only adds: an optional key,
  a reserved key defined, or a value in an open vocabulary. A meaning or default never changes and a
  key is never removed. Anything else is a new format.
- **Profiles.** Each manifest version pins one core version and follows its host's rules. Adopting a
  newer core version means a new manifest version, so an older host refuses the newer file and says
  what it serves.
- **The AFD contract.** The core's version is its own, separate from [`VERSION`](./VERSION). The core
  is listed in [`CHANGELOG.md`](./CHANGELOG.md), and adding it changes no fixture, vector, wire field or
  error code.

## Validators

The cases run on Ajv 8.20's 2020-12 build in Node in `scripts/plugin-manifest.test.mjs`. They were also
run once, on 2026-11-01, on the Rust `jsonschema` crate 0.60.2; the instances and the results are in
[the status](../docs/features/active/plugin-manifest/STATUS.md#step-1-verification). The two agreed on
every answer and on the keys each refusal names, for profiles written as P1 says. What a reader needs
to know:

- **A conditional beside `$ref`.** The two validators differ, and JSON Schema 2020-12 sides with
  `jsonschema`. Take `{ "$ref": "#/$defs/a", "if": { ... }, "then": { ... },
  "unevaluatedProperties": false }`, where `a` defines `x`. Ajv refuses `{ "x": 1 }` when the `then`
  branch is not taken: a skipped `then` makes it forget what the `$ref` evaluated. With `else`, it also
  refuses a key only the `if` evaluated when the `else` branch is not taken. `dependentSchemas` does
  the same, and so does `if` beside an `allOf` holding the `$ref`, or at the end of a chain of `$ref`s.
  The same conditional inside `allOf` beside the `$ref` agrees, and so do `allOf`, `anyOf`, `oneOf` and
  `not` beside `$ref`. So P1 forbids the first shape.
- **Ajv's `strict: true`.** A profile needs `type` beside `properties` or `items`
  (`strictTypes`), even when its `$ref` supplies the type, and each key in `required` listed in the
  same object's `properties` (`strictRequired`), which `"domains": true` does in P1. `jsonschema`
  needs neither. Every schema in the file compiles under `strict: true`.
- **Run-time code.** Ajv compiles validators with `new Function`. Under a `script-src 'self'` policy a
  reader generates a standalone validator at build time; one of the reference profile answers the
  profile's cases the same.
- **All errors.** Comparing a refusal's keys needs Ajv's `allErrors`; without it Ajv stops at the first
  and a case with `alsoNames` names only `pointer`. The accepted or refused answer is the same.
- **Repeated keys.** A closing profile reaches the core by two paths, the root's `$ref` and the object's
  own, so one bad value is reported more than once in both validators. A reader reports each key once.
- **`if`.** Ajv reports a failed `then` or `else` a second time as an `if` error at the object that
  holds it. A reader drops it; the failure itself names the key. `jsonschema` does not report it.
- **Annotations.** A value that fails under a `$ref` does not make `unevaluatedProperties` report the
  other keys that `$ref` covers, in either validator, so a refusal names only the keys at fault.
- **A number.** `manifest_version = 1.0` passes as an integer in both, as JSON Schema says.

## Conformance

[`plugin-manifest.json`](./plugin-manifest.json) sits beside
[`mcp-resources.json`](./mcp-resources.json), not in [`vectors/`](./vectors/README.md), because
`alfred parity` requires every file in `vectors/` to be loaded by all four languages, and Python and C++
have no reader. Every reader runs it. Its sections:

- **`schemas`:** test fixtures, none of them a host's profile. `profile` closes every core object and
  narrows, adds and requires as a host does. `cousin` and `cousinSuite` are the mistake P1 warns of,
  `shallow` closes only the root, and `overreach` breaks P4.
- **`cases`:** `fragment` validated against `against`, which is `core#/$defs/<name>`, `<schema>` or
  `<schema>#/$defs/<name>`. `accepted` is the answer. A refusal also has `pointer`, relative to the
  fragment, `key` as an author reads it, `suggestion`, and `alsoNames` where one refusal names several
  keys. The keys a validator names, each once and without Ajv's `if` errors, MUST equal `pointer` and
  `alsoNames`.
- **`rules`:** `manifest` passes the core, and then `rule` answers. `files` and `symlinks` map a path
  relative to the plugin root to contents or a link target, created first, so `../outside/in.json` is
  beside the root. `hostContract` is the host's contract version. `accepted` is the answer, with
  `pointer`, `key` and `suggestion` on a refusal and `warnings` where the rule only warns.
- **`mutation`:** the `mutation` a host derives from `effects`.
- **`renaming`:** a mounted tool's command name from `tool`, the override `name`, `manifestPrefix` and
  the instance's `prefix`: `command`, or `unnameable` when it has none.

A `pointer` is an RFC 6901 JSON Pointer, so `/` in a key is written `~1`.

## Implementation status

| Reader | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Loads [`plugin-manifest.json`](./plugin-manifest.json) | The cases and a reference check of the rules, in `scripts/plugin-manifest.test.mjs` | No reader ([intended](../docs/language-parity.md#intended-differences)) | Checked once with `jsonschema` 0.60.2 ([status](../docs/features/active/plugin-manifest/STATUS.md)); a permanent test is Umbel's choice | No reader ([intended](../docs/language-parity.md#intended-differences)) |
| Reads a profile | Loam's, in its phase 1 | No | Umbel's, without the core | No |

No AFD package reads a manifest. Umbel's host reads its own profile, and Loam's kernel will read its.
