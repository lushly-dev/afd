# Shared plugin manifest

> **Goal**: one manifest format that a Loam app and an Umbel plugin both describe themselves with.
> It is a host-neutral core, specified once in `spec/` as JSON Schema `$defs` with cases, plus one
> closed profile per host that adds that host's sections and closes its enumerations. Umbel's
> `umbel-plugin.toml` (manifest versions 1 and 2) already conforms and does not change. Loam's
> phase 1 writes the second profile against the core.
>
> The same format describes a **headless app**: an app with no UI contributions, whose UI is Loam's
> console. One such app is an Umbel host itself. One or more Umbel instances can join a Loam
> instance as mounted headless apps and give Loam's apps and copilot shared MCP tools, resources
> and skills. Plugin Discovery keeps its field meanings.

| Field | Value |
|---|---|
| Status | Proposed 2026-11-01. Revised the same day after an independent review, and extended at the owner's request with headless apps and several Umbel instances in one Loam instance ([Umbel instances as headless Loam apps](#umbel-instances-as-headless-loam-apps)). Approval of Loam's specifications is delegated to the coordinator after an independent review. This proposal also adds an AFD `spec/` shape and changes the mechanism an Umbel note describes, so the owner decides who approves it (open question 4). Progress is in [STATUS.md](STATUS.md) |
| Author | jasfalk (drafted with Claude) |
| Requested by | [Loam](../../../../endpoints/loam/docs/STATUS.md), in two places: the follow-up of 2026-10-30, "Write the `docs/features` proposal for the shared plugin manifest, reconciled with Umbel's manifest and Plugin Discovery, before phase 1", and the prerequisites row of [Loam's architecture](../../../../endpoints/loam/docs/architecture.md#afd-prerequisites) (line 774). Also the owner, on 2026-11-01: Umbel instances as first-class headless apps in Loam. Loam D10 and Umbel D37 both name this manifest |
| Packages | Step 1: `spec/`. Step 2, Loam's phase 1: Loam's packages under `endpoints/loam/packages/`. Step 3, at Umbel's choice: `endpoints/umbel/`. Step 7: `packages/rust` and `endpoints/umbel` for CORS, only if open question U1 is answered yes. Step 6: `packages/server`, only when Plugin Discovery is implemented |
| Related | [Plugin Discovery](../plugin-discovery/plugin-discovery.proposal.md) and its [spec](../plugin-discovery/plugin-discovery.spec.md); [MCP resources and skills](../../active/mcp-resources-skills/mcp-resources-skills.proposal.md); [Output budgets](../../active/output-budgets/output-budgets.proposal.md); [Hybrid tool strategy](../../active/hybrid-tool-strategy/hybrid-tool-strategy.proposal.md); [`spec/command-metadata.md`](../../../../spec/command-metadata.md); [`spec/tool-strategies.md`](../../../../spec/tool-strategies.md); section 2 of Umbel's [phase 1 specification](../../../../endpoints/umbel/docs/phases/1-plugin-contract/spec.md#2-the-manifest) |

Decision numbers carry their unit: "Umbel D37", "Loam D10". Both logs use D1 upward.

## Problem

Two hosts in this repository load plugins, and a third mechanism is proposed:

| Host | What a plugin is | Manifest on `main` (2026-11-01) |
|---|---|---|
| Umbel (`endpoints/umbel/`) | A Rust host for capability plugins over MCP and the CLI. Kinds: `compiled`, `component`, `mounted`, `pack` | `umbel-plugin.toml`, manifest versions 1 and 2, protocol 1: `endpoints/umbel/schemas/plugin-manifest.v2.json` (closed JSON Schema 2020-12) and `src/plugins/manifest.rs`; Umbel D37, D40, D54 |
| Loam (`endpoints/loam/`) | An application shell. Apps are web components with commands, surfaces, document types, settings and skills. Kinds: a native ES module, a sandboxed MCP Apps view, a mounted AFD server (Loam D9) | None. Phase 1 must settle "Manifest format and its relation to Umbel's" (architecture line 746) |
| Plugin Discovery (`docs/features/proposed/plugin-discovery/`) | An npm package whose `package.json` `afd.plugin` entry exports an `AfdPlugin` object | None. It is a runtime TypeScript API with no manifest file, and nothing of it is implemented (its disposition note, line 3) |

The owner adds a fourth need. Umbel instances, such as a work knowledge host and a personal one,
should join a Loam instance as first-class headless apps. Their tools, resources and skills then
serve Loam's apps and copilot.

The recorded decisions agree on the direction:

- **Loam D10** (`endpoints/loam/docs/decisions.md` line 25): "The app manifest extends the plugin
  manifest Umbel and Plugin Discovery define, with UI contributions as an extension; the event
  shape and the grant vocabulary are shared ... A plugin with UI is one manifest; no second plugin
  contract in the repository." Its correction of 2026-10-31 says the shared artifact is a schema
  package after Loam D25, not a crate.
- **Loam's architecture**, lines 388 to 396: the app manifest "follows the Plugin Discovery fields
  where they apply and the manifest Umbel settles for everything that is not UI". Umbel's phase 1
  specification, lines 508 and 509, agrees: "Field names that both use keep Umbel's meaning."
- **Umbel D37** (`endpoints/umbel/docs/decisions.md` line 46) reserves `ui` for "Loam's UI
  contributions, which Loam's own schema adds by referencing this schema's `$defs`". The same is in
  the schema's description (`plugin-manifest.v2.json` line 5) and the phase 1 specification's "Room
  for Loam" (lines 502 to 509).

The mechanism they describe, Loam's schema referencing Umbel's `$defs`, does not work as written.
These four reasons are read from Umbel's schema:

1. **Umbel's definitions are closed and host-specific.**
   - `$defs/plugin` closes `kind` to Umbel's four kinds (lines 263 to 265).
   - `$defs/domain` refuses Umbel's host domains and CLI verbs by name (lines 304 to 325).
   - `$defs/command` sets `additionalProperties: false` (line 507), so nothing can be added to it.
2. **Umbel's `expose` cannot carry Loam's `apps` flag** (Loam D30). It admits only `mcp`, `agent`,
   `cli` and `palette` (lines 581 to 598).
3. **Loam needs command fields that AFD has and Umbel's manifest lacks**, listed in
   [`spec/command-metadata.md`](../../../../spec/command-metadata.md):
   - `title` (line 19), the palette's label;
   - `requires` (line 26);
   - `undoable` (line 30);
   - `toolMeta` (line 38), without which a command cannot set MCP Apps' `_meta.ui.resourceUri`.
4. **Versions would couple.** Loam's schema would move with each Umbel manifest version, under
   Umbel's rules (phase 1 specification section 3, lines 511 to 531; Umbel D40 as annotated by
   D54).

Umbel's `grant`, `context`, `pipeline`, `skill`, `config` and `schemaOrPath` definitions, and its
path rules, are host-neutral and carry over. Some words already mean different things in the two
hosts' documents, and the format must resolve each one before a second meaning ships
([Collisions](#collisions)).

## Goals

- **One format family.** A Loam app and an Umbel plugin use the same keys with the same meanings.
  A reader that knows the core reads the shared part of either file.
- **Umbel is untouched.** Its manifests stay valid, and no Umbel schema, file or code changes. Umbel
  D37's decision stands. The way its consequence and its phase 1 specification say Loam's schema is
  built is replaced, which Umbel annotates if it agrees ([Umbel's manifest](#reconciliation-with-umbels-manifest)).
- **Loam's phase 1 cites one document** for the manifest's shared part and settles only its own
  sections.
- **Closed manifests.** Each host keeps a closed manifest, so an unknown key, at any depth, is refused
  (Umbel D36, D37).
- **The command entry projects AFD's command metadata.** The manifest never invents a field AFD
  already defines.
- **Headless apps and instances.** A headless app is a valid manifest, and an Umbel host can be one.
  Several instances of one app run in one Loam instance, each with its own identity and its own
  command namespace.
- **Language-neutral.** A JSON Schema and cases that TypeScript, Rust and Python read the same way.

## Non-goals

- **A runtime package or crate.** Loam D10's correction makes the shared artifact a schema. A
  package is reconsidered when a second TypeScript reader exists, such as Plugin Discovery.
- **Loading and discovery behavior.** Each host keeps its own. Umbel loads an explicit list
  (Umbel D37), and Loam loads declared apps without scanning (architecture line 215). This
  proposal only recommends one conflict policy.
- **Loam's surface schemas, mount contract, composition library and the content of `ui`.** These
  are Loam's phase 1. This proposal fixes where they go.
- **Signing.** `signature` stays reserved, with Umbel's meaning.
- **Changes to Umbel's or Loam's trust model** ([Trust](#signing-and-trust)). Where a question
  touches one, it is listed for the owner.

## Consumers

| Consumer | Reads | Needs |
|---|---|---|
| Umbel's host and `plugin-check` | `umbel-plugin.toml` | What it has. The core asks nothing of it |
| Loam's kernel, `app new`, `app check`, the builder (Loam D47, D49) | Loam's app manifest | Identity, commands with exposure (`apps` later), grants, skills, contexts, configuration, kind sections, the app section, `ui` |
| A Loam instance mounting Umbel hosts | A headless `umbel` app manifest and the deployer's instance entries | Instance identity, prefixes, the connection per Loam host, discovery of the tools a hybrid server lists ([Umbel instances](#umbel-instances-as-headless-loam-apps)) |
| An Umbel plugin with UI rendered in Loam | Loam reads the plugin's tools and resources over MCP, not its file | The projection of the plugin's `ui` ([Dual-host plugins](#dual-host-plugins)) |
| Plugin Discovery, once implemented | `package.json`, plus an optional manifest | Identity, version, configuration schema, origin and diagnostics, under the same names |
| MCP clients | Nothing directly | The MCP projection AFD already specifies: tool `_meta`, `title`, resources, skills |
| Agents writing plugins (Loam's builder agent, `plugin new`) | The core and profile schemas | One schema and its cases |

## Proposal

### Shape: a shared core and host profiles

```text
spec/plugin-manifest.md                 rules: keys, meanings, the profile contract, rules beyond the schema
spec/plugin-manifest.core.v1.json       $defs only, host-neutral, objects left open
spec/plugin-manifest.json               cases: accepted and refused fragments, each refusal naming its key

endpoints/umbel/schemas/plugin-manifest.vN.json             Umbel's profile (exists, closed, unchanged)
endpoints/loam/packages/<pkg>/schemas/app-manifest.v1.json  Loam's profile (Loam's phase 1, closed)
```

The cases sit at `spec/`'s root, as `spec/mcp-resources.json` and `spec/output-budgets.json` do.
They are not in `spec/vectors/`, whose README says every language loads every file there.

**The core** defines the keys both hosts use, each with one meaning. Its objects are left open
(no `additionalProperties: false`), so a profile can extend a definition and still close it. A
closed definition cannot be extended, which is reason 1 above.

**A profile** is one host's closed schema for one manifest version. It must meet this contract:

- **Closing.** A profile MUST close every core object it admits, at every depth: the root, `plugin`,
  each command, `expose`, `examples[]`, `output_budget`, each grant, context, pipeline and step,
  skill, `config`, `mount` and each mount tool.
  - It closes an object with `$ref` to the core definition, its own `properties`, and
    `unevaluatedProperties: false`, all in the same schema object.
  - 2020-12's `unevaluatedProperties` sees what that object's own `$ref` evaluated. It does not see
    a sibling path. The official test suite's case "unevaluatedProperties can't see inside cousins"
    is exactly this.
  - Each closed object has refusal cases.
- **Narrowing.** A profile MAY refuse an optional core key, and MAY close a core vocabulary: kinds,
  the host's own domains, a grant catalog, transports.
- **Adding.** A profile MAY add keys of its own. A host-only top-level key belongs in a section that
  host owns. The core spec keeps a table of section owners, so no two hosts claim one name.
- **Limits.** A profile MUST NOT change a core key's type, meaning or default, admit a value the
  core refuses, or give a reserved key another meaning.
- **Refusals.** Every refusal names the key and carries a suggestion, as an AFD error does.
- **One profile per file.** A profile names the core version it conforms to. A file is written for
  one profile, which its file name identifies. The file's `manifest_version` and `protocol` are that
  profile's version and that host's plugin protocol, in Umbel D40's sense.

Umbel's profile today is manifest versions 1 and 2, and it conforms to core version 1 as written:

- it refuses the core's optional additions;
- it closes `kind`, the domain rule and its grant catalog;
- it owns `component`, `packs`, the command key `confirm`, the stdio mount keys and `bind_space`;
- it names the grants that `store-write` and `workspace-write` need.

Umbel adopts the core by `$ref` only if it chooses to (step 3).

### What the core holds (version 1)

Keys and meanings are Umbel's wherever Umbel has them (Loam's architecture lines 393 to 395; Umbel's
phase 1 specification lines 508 and 509). So the spelling is snake_case, and a file is TOML or JSON
read as JSON (Umbel D37). The [AFD mapping](#mapping-onto-afd) gives each key's camelCase wire name.

**Versions.**

- **Keys:** `manifest_version` and `protocol`, required integers, the profile's. `afd_contract`,
  optional.
- **`afd_contract`** names the AFD contract version (`spec/VERSION`, `1.0-rc` today) that the
  plugin's results follow. A host compares the major part and refuses a mismatch with a suggestion.
- Umbel's profile refuses `afd_contract`: its protocol 1 already fixes the WIT world's result
  (Umbel D38). In Loam it is optional for any kind, and most useful for a mounted server.

**Identity.**

- **Keys:** `plugin.id`, `title`, `version`, `description`, `kind`, `domains`, `homepage`, `license`.
- Patterns and lengths are Umbel's (schema lines 238 to 286).
- `plugin.id` is the app or plugin identity and the default instance id. Instances are the
  deployer's ([Instances](#app-identity-and-instance-identity)).
- `kind` is a lowercase name, which each profile closes.
- `domains` items match `^[a-z][a-z0-9]{0,31}$` and are never `afd`. Each profile refuses its own
  host domains.

**Commands.**

- **Keys:** `commands[]`, optional at the top level, each with `name`, `title`, `description`,
  `effects`, `input_schema`, `returns`, `category`, `tags`, `version`, `requires`, `contexts`,
  `first_class`, `confirm_prompt`, `destructive`, `undoable`, `approval` (default `none`),
  `execution_time`, `expose`, `examples`, `output_budget`, `errors` and `tool_meta`.
- Umbel's keys keep their definitions (lines 505 to 660).
- Five keys are new and optional, each AFD's field of the same meaning (spec/command-metadata.md):
  `title` (line 19), `requires` (line 26), `undoable` (line 30), `errors` (line 23) and `tool_meta`
  (line 38).
- `tool_meta` follows AFD's key rule ([`spec/mcp-resources.md`](../../../../spec/mcp-resources.md#t2-the-key-rule)
  T2; `packages/server/src/meta-keys.ts` lines 43 to 74). A profile may refuse its own prefix there.
- `mutation` is never declared. The host derives it from `effects`.
- A manifest with no `commands` is valid. A mounted app's commands come from the server, and a
  headless app may have no commands of its own.

**Effects.**

- **Values:** `inspect`, `plugin-state`, `external`, `store-write`, `workspace-write`. `inspect`
  stands alone.
- Meanings are Umbel's (section 7.3; schema lines 519 to 535), in the shape of Botcore's
  `CommandPolicy` (`endpoints/botcore/src/botcore/host.py` lines 37 to 60).
- `store-write` means "writes through one of the host's store write grants", and `workspace-write`
  "writes files outside the host's own state". The profile names the grants each one needs.
- Loam apps have no file system, so Loam's profile would refuse `workspace-write`.

**Exposure.**

- **Keys:** `expose` with `mcp`, `agent`, `cli` and `palette`. `apps` is reserved.
- The flags mean what AFD's `ExposeOptions` means (`packages/core/src/commands.ts` lines 58 to 67).
- A manifest's flags are the app's default exposure, and a deployer may narrow them (Loam's
  architecture line 391, "exposure defaults"). A flag left out takes the profile's default
  ([C5](#collisions)). A mounted app's tools declare no Loam flags, so its instance entry declares
  them ([How tools surface](#how-umbels-tools-surface-in-loam)).
- `apps` joins the core with Loam D30's AFD feature.

**Grants.**

- **Keys:** `grants[]` with `name`, `required` (default `true`, as Umbel's: `manifest.rs` line 1195)
  and `reason`. The name `targets` is reserved.
- The entry's shape is shared, and so is the grant vocabulary (Loam D10): a name both hosts use has
  one meaning, listed in [Shared grant names](#shared-grant-names). Names only one host uses are in
  that host's profile, and a name outside the host's catalog is refused at load (schema line 499).

**Contributions.**

- **Keys:** `contexts[]`, `pipelines[]`, `skills[]`, `config`.
- These are Umbel's definitions: `contextName` and `context` at lines 679 to 714, `pipeline` at
  715 to 779, `skill` at 800 to 820, `config` at 821 to 831.
- `config` is the deployer's instance configuration. It is never a person's settings.

**Mounting.**

- **Keys:** `mount` with `prefix`, `transport` and `only`, plus `tools[]` (`tool`, `name`,
  `effects`, `confirm_prompt`, `approval`, `first_class`).
- This is the part of Umbel's `mount` and `mountTool` (lines 358 to 478) that is not Umbel's alone.
- `transport` has one meaning per value: `stdio` is MCP over a child's standard streams, and `http`
  is MCP Streamable HTTP. Umbel's profile adds `command`, `cwd`, `env`, `bearer` and `bind_space`,
  with its stdio rules (lines 410 to 430).
- `url` and `bearer_env`, where and with what credential, are refused in every profile: they are the
  deployer's (Umbel D43 as amended; `manifest.rs` lines 144 to 154).

**Reserved.** Reserved with Umbel's meanings, now shared (`manifest.rs` lines 43 to 77 and 96;
phase 1 section 2, lines 475 to 483):

- top level: `ui`, `connectors`, `backends`, `dependencies`, `signature`, `scopes`, `on_conflict`;
- in a command: `scopes`;
- in a grant: `allow`, `targets`.

`ui` is Loam's section. `dependencies` is never defined (Umbel D3, Loam D2).

The core leaves out Umbel's packs (Umbel D46), which no other host has. The schema's patterns
appear inline in Umbel's file (the semantic version, the command name, `output_budget`). Step 1
names them as core definitions.

### Shared grant names

Loam D10 shares the grant vocabulary. Six names appear in both catalogs:

- Umbel's: `endpoints/umbel/src/plugins/mod.rs` lines 90 to 107, plus `http` and `secrets`, which
  are named and refused (phase 1 section 7.1).
- Loam's: architecture lines 299 to 310.

| Name | One meaning | Umbel | Loam |
|---|---|---|---|
| `clock`, `random` | Time and randomness from the command context, recorded for replay | Phase 1 | Catalog |
| `events` | Read the host's event stream by cursor, under the caller's access, without appending to it | Phase 1 | Catalog |
| `documents` | Read documents the host holds, under the caller's access. What a document is, is the host's | Phase 2 (store documents) | Catalog (metadata, references, backlinks) |
| `http` | Outbound HTTP to hosts the plugin asks for, never with the caller's credentials | Named, refused | Catalog |
| `secrets` | Named deployer secrets, never a person's tokens | Named, refused | Catalog |

Host-only names stay in their profile: Umbel's `config`, `log`, `packs` and store grants; Loam's
`store`, `projects`, `settings`, `collaboration` and `calls`. A name moves into the table only when
a second host defines it with the same meaning.

`targets` is reserved for what a plugin asks a grant to reach: hosts for `http`, commands for
`calls`, secret names. Its form is defined with the first grant that needs it, with the agreement
of the hosts that share the name. It grants nothing. The deployer's allow-list stays in the host's
instance configuration (Umbel D42's `allow`). Umbel's architecture already says `http` reaches
"hosts the manifest declares" (line 177).

### App identity and instance identity

An app or plugin has one identity, its `plugin.id`. An instance is a deployer's use of it, and a
host may run several instances of one app. Umbel already works this way:

- `plugins.enabled` lists instance ids;
- `[plugins.<id>] source` names the plugin (Umbel D41);
- an instance prefix replaces the plugin's domain (Umbel D43 as amended).

The core makes these rules shared, except where a row names one host:

| Rule | Meaning |
|---|---|
| Instance id | The deployer's name, unique in the host. It defaults to `plugin.id` for the first instance, and a second instance must name its own. Never in the manifest |
| Instance prefix | The first command-name segment every command of a mounted instance takes. It defaults to `mount.prefix` for the first instance. Unique among the host's apps and shell or host domains. Never in the manifest. For Loam this extends Loam D18 ("the app id as the domain"), so Loam's phase 1 annotates D18, as Umbel D43's amendment did for Umbel |
| Renaming | Umbel's rule (`endpoints/umbel/src/plugins/mounted/naming.rs` lines 3 to 16). An override name becomes `<prefix>-<name>`. Otherwise the tool's name is normalized; if it starts with the manifest's prefix, that segment is replaced by the instance prefix, and any other name gets the instance prefix in front. A tool that yields no valid command name is reported, not registered |
| Transport | The manifest's `mount.transport` is the app's default. Loam's instance entry may override it, because the same server can be reached differently per Loam host. In Umbel the manifest's value stands, as its D50 default depends on it |
| Conflict policy | Across instances, always `error`: two instances, or an instance and the host, that would register one name fail that instance's load, and nothing is overridden silently. Umbel fixes this (Umbel D37). It is the recommendation for Loam, whose phase 1 settles its policy (L4). Plugin Discovery's default, `explicit-wins` (spec FR-6), suits one server's own commands, not two deployers' instances. The reserved `on_conflict` stays unset |
| Skills and resources, between servers | Loam's rule: each mounted server's skills and resources are keyed by instance and URI, because two servers may both serve `skill://knowledge-guide/SKILL.md`. Loam shows them as `<instance>/<name>` and never merges them. The Skills extension asks that same-named skills never silently replace each other (Umbel's phase 1 section 8.3). Within one Umbel host the rule stays Umbel's: a plugin's skills are served once per plugin, however many instances mount it (Umbel D43 as amended) |
| References | A resource link or journal entry names the instance, not only the app |

### JSON Schema sketch

The core: definitions only, open objects. Abbreviated. Step 1 writes it in full with Umbel's
patterns.

```json
{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://afd.dev/spec/plugin-manifest.core.v1.json",
	"title": "AFD plugin manifest core, version 1",
	"$defs": {
		"manifest": {
			"type": "object",
			"required": ["manifest_version", "protocol", "plugin"],
			"properties": {
				"manifest_version": { "type": "integer", "minimum": 1 },
				"protocol": { "type": "integer", "minimum": 1 },
				"afd_contract": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+(-[0-9a-z.]+)?$" },
				"plugin": { "$ref": "#/$defs/plugin" },
				"mount": { "$ref": "#/$defs/mount" },
				"grants": { "type": "array", "items": { "$ref": "#/$defs/grant" } },
				"commands": { "type": "array", "items": { "$ref": "#/$defs/command" } },
				"contexts": { "type": "array", "items": { "$ref": "#/$defs/context" } },
				"pipelines": { "type": "array", "items": { "$ref": "#/$defs/pipeline" } },
				"skills": { "type": "array", "items": { "$ref": "#/$defs/skill" } },
				"config": { "$ref": "#/$defs/config" },
				"ui": { "type": "object" }
			}
		},
		"plugin": {
			"type": "object",
			"required": ["id", "title", "version", "description", "kind"],
			"properties": {
				"id": { "type": "string", "pattern": "^[a-z][a-z0-9]{0,31}$" },
				"title": { "type": "string", "minLength": 1, "maxLength": 80 },
				"version": { "$ref": "#/$defs/semver" },
				"description": { "type": "string", "minLength": 1, "maxLength": 500 },
				"kind": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
				"domains": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/domain" } },
				"homepage": { "type": "string", "pattern": "^https://\\S+$" },
				"license": { "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[A-Za-z0-9 .+()-]+$" }
			}
		},
		"domain": { "type": "string", "pattern": "^[a-z][a-z0-9]{0,31}$", "not": { "const": "afd" } },
		"effects": {
			"type": "array", "minItems": 1, "uniqueItems": true,
			"items": { "enum": ["inspect", "plugin-state", "external", "store-write", "workspace-write"] },
			"if": { "contains": { "const": "inspect" } }, "then": { "maxItems": 1 }
		},
		"expose": {
			"type": "object",
			"properties": {
				"mcp": { "type": "boolean" }, "agent": { "type": "boolean" },
				"cli": { "type": "boolean" }, "palette": { "type": "boolean" }
			}
		},
		"command": {
			"type": "object",
			"required": ["name", "description", "effects", "input_schema"],
			"properties": {
				"name": { "$ref": "#/$defs/commandName" },
				"title": { "type": "string", "minLength": 1, "maxLength": 80 },
				"description": { "type": "string", "minLength": 1, "maxLength": 500 },
				"effects": { "$ref": "#/$defs/effects" },
				"input_schema": { "$ref": "#/$defs/schemaOrPath" },
				"returns": { "$ref": "#/$defs/schemaOrPath" },
				"requires": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/commandName" } },
				"undoable": { "type": "boolean" },
				"errors": { "type": "array", "uniqueItems": true, "items": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]*$" } },
				"tool_meta": { "type": "object" },
				"approval": { "enum": ["none", "required"] },
				"expose": { "$ref": "#/$defs/expose" },
				"output_budget": { "$ref": "#/$defs/outputBudget" }
			}
		},
		"grant": {
			"type": "object",
			"required": ["name", "reason"],
			"properties": {
				"name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
				"required": { "type": "boolean" },
				"reason": { "type": "string", "minLength": 1, "maxLength": 500 }
			}
		},
		"mount": {
			"type": "object",
			"required": ["prefix", "transport"],
			"properties": {
				"prefix": { "$ref": "#/$defs/domain" },
				"transport": { "enum": ["stdio", "http"] },
				"only": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
				"tools": { "type": "array", "items": { "$ref": "#/$defs/mountTool" } }
			}
		}
	}
}
```

The definitions not shown follow Umbel's text, without `additionalProperties: false`: `semver`,
`commandName`, `schemaOrPath`, `jsonPath`, `relativePath`, `outputBudget`, `contextName`,
`context`, `pipeline` with its step, `skill`, `config` and `mountTool`. So do the command keys not
shown. Step 1 checks every code in `spec/error-codes.md` against the `errors` pattern.

A profile closes the core. Loam's sketch for step 2 follows. Loam's phase 1 decides the kind names,
the sections' contents and the defaults, and closes every object as the contract requires (only
three are shown).

```json
{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"$id": "https://afd.dev/loam/schemas/app-manifest.v1.json",
	"title": "Loam app manifest, version 1 (conforms to plugin manifest core version 1)",
	"$ref": "https://afd.dev/spec/plugin-manifest.core.v1.json#/$defs/manifest",
	"properties": {
		"manifest_version": { "const": 1 },
		"protocol": { "const": 1 },
		"plugin": { "$ref": "#/$defs/plugin" },
		"commands": { "items": { "$ref": "#/$defs/command" } },
		"app": { "$ref": "#/$defs/app" },
		"native": { "$ref": "#/$defs/native" },
		"view": { "$ref": "#/$defs/view" },
		"ui": { "$ref": "#/$defs/ui" }
	},
	"unevaluatedProperties": false,
	"$defs": {
		"plugin": {
			"$ref": "https://afd.dev/spec/plugin-manifest.core.v1.json#/$defs/plugin",
			"properties": { "kind": { "enum": ["native", "view", "mounted"] } },
			"required": ["domains"],
			"unevaluatedProperties": false
		},
		"command": {
			"$ref": "https://afd.dev/spec/plugin-manifest.core.v1.json#/$defs/command",
			"properties": { "effects": { "items": { "not": { "const": "workspace-write" } } } },
			"unevaluatedProperties": false
		},
		"app": {
			"type": "object",
			"properties": {
				"scope_levels": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "enum": ["workspace", "project"] } }
			},
			"unevaluatedProperties": false
		},
		"native": { "type": "object", "required": ["entry"], "properties": { "entry": { "type": "string" } }, "unevaluatedProperties": false },
		"view": { "type": "object", "unevaluatedProperties": false },
		"ui": {
			"type": "object",
			"properties": {
				"surfaces": { "type": "object" },
				"layout": { "type": "object" },
				"compositions": { "type": "array" },
				"resources": { "type": "array" }
			},
			"unevaluatedProperties": false
		}
	}
}
```

The Rust validator Umbel uses, `jsonschema` 0.60.2 (`endpoints/umbel/Cargo.lock` line 1767),
implements `unevaluatedProperties`. So does Ajv's 2020-12 build. Step 1's cases check that both
behave the same.

Some rules need more than a schema. Every reader applies them, naming the key and giving a
suggestion, and each has cases:

- A declared command's first name segment is one of `plugin.domains`. A mounted command takes its
  instance prefix instead.
- Names are unique, and so are context, pipeline and skill ids.
- An `input_schema` is a `type: object` schema the host's AFD checker accepts.
- Paths stay inside the plugin root once symlinks are resolved.
- `output_budget.default_bytes` is at most `max_bytes`.
- A skill's name equals the plugin id or starts with `<id>-`.
- `tool_meta` follows the key rule.
- A `requires` entry that names an unknown command warns, since AFD calls `requires` "metadata
  only".

These are Umbel's rules from its phase 1 section 2, lines 449 to 473. The `tool_meta` and
`requires` rules are new.

### Where Loam's contents go

Loam's architecture lists what an app manifest holds (lines 388 to 391). Each item has one place:

| Item (Loam's architecture) | Place | Phase |
|---|---|---|
| Identity, version, protocol version | Core `plugin`, `manifest_version`, `protocol` | 1 |
| Commands, exposure defaults | Core `commands[]` with `expose` (C5) | 1 |
| Supported scopes | `app.scope_levels`, in Loam's non-UI `app` section, never `scopes` (C1). A mounted or console-only app has scope too. Loam D31 plans to unify scope with Umbel's space AFD-wide, and that would move this key into the core | 1 |
| Required grants with declared effects | Core `grants[]` and command `effects` | 1 |
| Skills, AFD contexts | Core `skills[]` and `contexts[]`. They also feed the `agent` surface | 1 |
| Configuration schema | Core `config`: the deployer's, never a person's settings | 1 |
| Surfaces, layout preset, compositions | `ui.surfaces`, `ui.layout`, `ui.compositions` | 1 |
| Sandboxed views' resources | `ui.resources` (`ui://` URIs and their files) | 1 |
| Document types and New creators | `ui.documents`, `ui.new`. Umbel's reservation of `ui` names document types too (`manifest.rs` line 47) | 2 |
| Settings sections | `ui.settings`, a person's settings at their scopes, distinct from `config` | 4 |
| Experiments | `ui.experiments` | 4 |
| Specialists, prompts, agent packs | Loam's `agent` section, not `ui` (Loam D44: "an app may be only a pack") and not `packs` (C4) | 5 |
| Triggers and actions | `ui.automations` | 7 |

A headless app, with no UI contributions and the console as its UI (Loam D48), is a manifest with
no `ui`. It is valid in every kind.

### Worked example: an Umbel plugin

Umbel's hello plugin as it exists, `endpoints/umbel/plugins/hello/manifests/compiled.toml` lines 1
to 53, abridged:

```toml
manifest_version = 1          # Umbel's profile version
protocol = 1                  # Umbel's plugin protocol (Umbel D40)

[plugin]                      # core identity; Umbel's profile closes kind
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, one pack, one skill: the reference plugin."
kind = "compiled"
domains = ["hello"]

[[grants]]                    # core shape; a name from Umbel's catalog
name = "packs"
reason = "Reads the salutation from the greetings pack."

[[commands]]                  # core command entry
name = "hello-greet"
description = "Greet someone, in a space, with the pack's salutation."
effects = ["inspect"]
input_schema = "schemas/hello-greet.input.json"
returns = "schemas/hello-greet.output.json"
category = "hello"
tags = ["example"]
version = "1.0.0"
first_class = true
examples = [{ title = "Greet Ada", input = { name = "Ada" } }]

[[packs]]                     # Umbel's section
id = "greetings"
path = "packs/greetings"

[[skills]]                    # core
name = "hello-guide"
path = "skills/hello-guide"

[config]                      # core
schema = "schemas/config.schema.json"
```

Every key is either a core key with Umbel's meaning or an Umbel profile key, so the file conforms
to core version 1 unchanged. The seven `plugin-manifest*` files in
`endpoints/umbel/schemas/examples/` conform too.

### Worked example: a Loam app

This is a hypothetical `hello` app for Loam's phase 1 exit criterion, "hello loads native, as a
sandboxed view and mounted" (architecture line 746). It is shown as a native module. The contents
of the `native`, `app` and `ui` sections are illustrative; Loam's phase 1 decides them.

```toml
manifest_version = 1          # Loam's profile version
protocol = 1                  # Loam's app protocol version; Loam's phase 1 decides what it covers
afd_contract = "1.0"

[plugin]                      # core identity; Loam requires domains = [id] (Loam D18)
id = "hello"
title = "Hello"
version = "0.1.0"
description = "One command, a sidebar list and a main view: the reference app."
kind = "native"
domains = ["hello"]
license = "MIT"

[native]                      # Loam's kind section
entry = "dist/hello.js"

[app]                         # Loam's non-UI section
scope_levels = ["workspace", "project"]

[[grants]]                    # core shape; a name from Loam's catalog
name = "store"
reason = "Keeps the names greeted, per workspace and project."

[[commands]]
name = "hello-greet"
title = "Greet someone"       # core addition: AFD's title, the palette's label
description = "Greet someone and remember the name in this scope."
effects = ["store-write"]     # through the store grant; mutation is derived
input_schema = "schemas/hello-greet.input.json"
undoable = true
expose = { palette = true, agent = true, mcp = false, cli = false }

[[commands]]
name = "hello-list"
title = "List greetings"
description = "List the names greeted in this scope."
effects = ["inspect"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[[skills]]
name = "hello-guide"
path = "skills/hello-guide"

[ui]                          # Loam's section, the one Umbel D37 reserved
compositions = ["list-detail"]

[ui.surfaces.rail]
label = "Hello"
icon = "hand-wave"

[ui.surfaces.sidebar]
shape = "list"                # the surface catalog's "views: list, tree or custom"
command = "hello-list"

[ui.surfaces.main]
element = "hello-main"        # the app's custom element, rendered into the shell's mount (C9)
```

Without its `[ui]` section, this is a headless app that the console renders.

As a sandboxed view, the app sets `kind = "view"`, lists a `ui://hello/main` resource in
`ui.resources`, and links its command to it with `tool_meta = { ui = { resourceUri =
"ui://hello/main" } }`, which AFD already admits (T1, T2).

A sandboxed iframe cannot host command handlers. Loam's documents present a view app as coming
from an MCP server with Apps support (proposal lines 621 and 622), and a builder draft's commands
are built through the store (Loam D47). Where a view app's handlers run is therefore Loam's phase 1
question L5.

As a mounted server, the app sets `kind = "mounted"`, `[mount] prefix = "hello"` and
`transport = "http"`. Its commands then come from the server.

### Umbel instances as headless Loam apps

The owner's requirement: one or more Umbel instances join a Loam instance as first-class headless
apps. Each provides MCP tools, resources and skills to Loam's apps and copilot. Loam already plans
this: "the Umbel app after Umbel's phase 2", where Umbel is mounted as the copilot's knowledge and
memory (architecture line 761; proposal lines 757 to 760).

Here, a **Loam instance** is one running shell with its own workspace store: a desktop install, or a
hosted server together with the browsers it serves. An **Umbel instance** is one Umbel host on one
workspace, as Loam's app list names it.

#### The Umbel host's own manifest

Here the app is the Umbel host, not one of its plugins. Its manifest is a Loam-profile file:

```toml
manifest_version = 1
protocol = 1
afd_contract = "1.0"

[plugin]
id = "umbel"
title = "Umbel"
version = "0.1.0"             # the host version this description was written for
description = "An Umbel host: knowledge, memory and context tools from its enabled plugins."
kind = "mounted"
domains = ["umbel"]
homepage = "https://afd.dev/umbel"

[mount]
prefix = "umbel"              # the default instance prefix; the deployer names one per instance
transport = "http"            # the default; an instance entry may choose stdio where its host can spawn

[app]
scope_levels = ["workspace", "project"]

# No [[commands]]: they come from the instance, and depend on its enabled plugins.
# No [ui]: headless. The console is its UI (Loam D48).
```

- **Headless and command-free by design.** An Umbel deployment's commands depend on its
  `plugins.enabled`, so a static list would be wrong for every deployment but one. The manifest
  says what the app is. Each instance's commands are discovered at load.
- **The file is Loam's.** It conforms to the core and to Loam's profile, not to Umbel's: Umbel reads
  `umbel-plugin.toml` for plugins, never this file. Loam can ship it as the first-party `umbel` app.
  Whether Umbel should publish or serve it is question U3.

#### Instances

The deployer adds instances in the Loam workspace's app list (the architecture's "Workspace app
list", line 273). Its syntax is Loam's phase 1 (L6). Each instance entry holds:

| Instance key | Meaning |
|---|---|
| Instance id | Unique in the Loam instance, for example `work` and `home` |
| `app` | `umbel`, the manifest above |
| `prefix` | The instance prefix: `work`, `home` |
| `transport` and the location | For `http`, a URL and a credential reference. For `stdio`, the command, for example `umbel --workspace <dir> serve --stdio` (`src/cli/parse.rs` line 4). Who may write a command line is owner question 6 |
| Where it applies | The projects or the workspace it is enabled for, as Umbel enables instances per space (Umbel D44) |
| Exposure | The deployer's flags for the instance's tools, per instance and per command ([How tools surface](#how-umbels-tools-surface-in-loam)) |
| Space mapping | Optional: the Umbel space a Loam project uses ([Scope and space](#scope-and-space)) |

The location and the credential never enter a manifest, by Umbel D43's rule and the core's.

#### Discovery on a hybrid server

Umbel serves the hybrid tool strategy (Umbel D27, D31, D45). Its `tools/list` holds the meta-tools
and at most eight first-class tools, not every command. Bootstrap tools such as `afd-help` are
listed only when first-class (`spec/tool-strategies.md` line 237). So Loam's mounted loader cannot
learn the commands from `tools/list` alone.

AFD already gives a way:

- A `tools/call` naming an exposed command that is not listed still runs it (line 293), so the
  loader can call `afd-help` by name.
- `afd-help` reports `toolStrategy` and `firstClassTools`, and `afd-discover`, `afd-detail` and
  `afd-call` reach every other command (H8, lines 300 to 312).
- The loader reads `afd-help`, then `afd-detail` for input schemas.
- It calls a first-class command by its tool, and any other through `afd-call`.

The instance's `afd-*` tools are the loader's means of reaching the server. They are never renamed
into Loam commands; Loam's registry has its own. This holds for any hybrid or lazy AFD server Loam
mounts, so it belongs to the mounted loader in Loam's phase 1. When to discover again, for example
after an Umbel host restarts with other plugins, is part of L6.

#### Naming

The renaming rule is Umbel's ([Instances](#app-identity-and-instance-identity)). With manifest
prefix `umbel`, the work instance's `knowledge-search` becomes `work-knowledge-search` and its
`workspace-show` becomes `work-workspace-show`. The home instance's become `home-knowledge-search`
and `home-workspace-show`.

A prefix collision fails the second instance's load, with a suggestion to choose another prefix. A
shell domain as a prefix is refused the same way.

#### The connection, per Loam host

| Loam host | How it reaches an Umbel instance | What has to hold |
|---|---|---|
| Hosted server (Loam phase 6) | Server-side, over Streamable HTTP or by spawning `umbel serve --stdio` as a child of the Node process | Until Umbel's phase 5, Umbel binds loopback only and needs its bearer token (Umbel D32). So an HTTP instance runs on the same machine or network namespace, with the token from a deployer secret: the analogue of Umbel D43's `bearer_env`, never a person's token. A server-side request carries no `Origin`, which Umbel accepts (`packages/rust/src/server.rs` lines 140 to 142). Umbel D29 lets one workspace be opened by several host processes, so a stdio child and a running `serve --http` coexist |
| Desktop (Tauri, Loam D25) | Tauri's Rust host spawns `umbel serve --stdio` as a sidecar and bridges it to the kernel in the webview over IPC. Or it connects to a loopback HTTP instance from the Rust side | The webview cannot spawn a process. A webview fetch to `http://127.0.0.1` is cross-origin and meets the CORS gap below, so the connection belongs in the Rust host. Tauri capabilities scope the sidecar |
| Browser | Streamable HTTP only. Best through the hosted server, which mounts the instance and serves its commands as Loam's own. Directly, only to a loopback Umbel on the person's machine | Directly, it needs three changes, each in someone else's code. See below |

A direct browser connection needs:

1. **CORS and preflights.** Umbel checks `Origin` against `http.allowed_origins`
   (`endpoints/umbel/src/surfaces/http.rs` lines 26 to 43; `packages/rust/src/server.rs` lines 768
   and 769), but neither Umbel nor the `afd` crate answers a preflight or sends `Access-Control-*`
   headers. A cross-origin request with `Authorization` needs both. Umbel's bearer layer also runs
   first and refuses a request with no `Authorization` (`http.rs` lines 5 and 120 to 127), and a
   preflight has none. So this is not only an AFD change: it touches Umbel D32's "required on every
   HTTP request" (question U1).
2. **Loam's CSP.** The web host sets `connect-src 'self'` in a static `<meta>` in the built page
   (`endpoints/loam/packages/web/index.html` lines 5 to 8), while the app list is runtime data. Adding
   instance origins needs a server-sent header or a build-time list (L7).
3. **The token.** Umbel's token is a workspace secret (`state/keys/http.token`, mode 0600, Umbel
   D32). It would sit in the browser's storage, readable by any script in the page.

Browsers also restrict a page on a public origin from calling a loopback address; this needs
checking in Loam's trajectory refresh before phase 6.

The recommendation is to reach Umbel from the hosted server and the desktop first. The browser
reaches Umbel through the hosted server, and a direct browser connection waits on U1 and L7.

#### How Umbel's tools surface in Loam

| Concern | Rule | Source |
|---|---|---|
| Loader kind | `mounted` (Loam D9). The console renders the commands, with forms from their input schemas and results through the adapters (Loam D48) | Loam architecture line 215, phase 1 row |
| Mutation and effects | Loam reads AFD's own metadata first: `mutation`, `destructive` and `approval` from `_meta` and `afd-detail` (spec/command-metadata.md lines 68 to 70). `_meta["dev.umbel/origin"].effects` adds detail where present; it is specified for plugin commands, not built-ins (Umbel phase 1, line 1187). All of this is the server's own claim. How far Loam trusts it, or requires deployer overrides as Umbel's `[[mount.tools]]` does, is L10 | Umbel D43 ("annotations are untrusted") |
| Exposure | A mounted tool carries no Loam flags, so for a mounted app the instance entry is the callee's declaration. This extends Loam D30's "the callee declares", which Loam's phase 1 annotates. The entry sets defaults and per-command overrides (L6). Recommended: `agent` and `palette` on for commands that report no mutation; mutations named one by one; `mcp` off, so Loam does not re-export another server; `apps` off until Loam D30 lands | Loam D30, C5 |
| App-to-app calls | A Loam app calls `work-knowledge-search` only with a `calls` grant naming it (or a pattern such as `work-knowledge-*`), and only when the instance entry exposes that command to `apps`. The kernel checks both | Loam D30; architecture lines 425 to 429 |
| Copilot | It sees the tools exposed to `agent`, through the registry, under the autonomy policy. Contexts follow the active app and document (architecture line 246) | Loam D24, D41 |
| Untrusted labels | Every result from an instance is labeled untrusted (architecture lines 669 and 670). Umbel's own labels, `trust: "content"` on hits and windows (Umbel D67) and `dev.umbel/trust`, are kept and shown | Loam architecture, Umbel D67 |
| Journal | Each call is journaled with the instance id (a declared context field, `journal: true`, #528) and marked recorded and not replayable: "Calls to mounted servers are recorded but cannot be replayed, and are marked so" (lines 687 and 688). Umbel journals the same call on its side | Loam architecture section 8 |
| Confirmations and approvals | Umbel's `confirm = "require-human"` commands are CLI-only and never exposed over MCP (Umbel D54), so Loam never sees them. Commands that need approval answer through MCP elicitation where Umbel serves it, or fail with Umbel's suggestion. Approval evidence never comes from tool arguments (architecture lines 672 and 673) | Umbel D54; MCP Confirmations |
| Credentials | Loam forwards no person's token to an instance (architecture line 667). The principal Umbel sees depends on the transport. Over HTTP it is one `loopback` agent. Over stdio it is the workspace's local principal (Umbel's phase 0 specification, lines 973 and 974). Owner question 5 | Both |
| Skills | Each instance's skills come from `skills/list` or the `skill://` resources and join the copilot's agent surface, shown as `<instance>/<name>` | Umbel D47; the agent surface (architecture line 246) |
| Resources | Listed per instance and shown in the console. Umbel's citations (locator version 1, `umbel:<space>/<doc>#L...`, Umbel D61) open as resource links that call `<prefix>-knowledge-open`, never as URLs. The resource-link form itself is for Loam's phase 5 to settle (architecture phase table) | Umbel D61 |
| Health | The console shows the instance's `<prefix>-workspace-show` and a failing connection. A failed instance is reported and skipped, never silently dropped. It defaults to not required for every transport. That follows Umbel D50's amendment for HTTP mounts and deliberately differs from its stdio default, because one Loam host may lack a transport | Umbel D50 |

#### Scope and space

Loam's project and Umbel's space are both "where a command runs". Loam D31 plans to propose scope
AFD-wide when a second consumer needs it, unified with Umbel's space. Mounting Umbel brings that
question closer; it is question U4, and the recommendation is to defer it.

For now Loam maps them without an Umbel change. The instance entry may name a space per Loam
project, and the loader passes it as the command's `space` input, which Umbel's commands already
take. `knowledge-search` also takes `spaces`, up to eight (Umbel's phase 2 specification, line
1186).

So a mapping that only supplies a default does not narrow anything: a copilot in Atlas could still
name another space. Loam D4 says the active project narrows. The recommendation is that the loader
**pins** a mapped space, setting `space` and refusing a different `space` or any `spaces` (L9). That
is Loam's policy on its own calls, not a boundary inside Umbel. With no mapping, Umbel's default
space and the instance's other spaces stay reachable.

#### What Umbel would need

Nothing, for a hosted or desktop Loam reaching Umbel over loopback HTTP or stdio. Umbel's existing
surface serves it: Streamable HTTP with the bearer token, stdio, the hybrid tools with `afd-help`,
skills and resources, and the origin and effects `_meta`.

The rest are questions for Umbel's owner, U1 to U4 in [Open questions](#open-questions). None is
assumed. Loam is one more MCP client of Umbel, under Umbel D32's loopback and token rules. Only U1
would touch a recorded Umbel rule, and it is recommended against for now.

### Worked example: one Loam instance, two Umbel instances

One person runs Loam's desktop app on a laptop. Two Umbel hosts run on the same laptop, each on its
own workspace:

| Instance | Umbel host | Connection | Applies to | Space mapping |
|---|---|---|---|---|
| `work` | A work knowledge base, served by `umbel serve --http` | `http`, from the Tauri Rust host to `http://127.0.0.1:7410/mcp`, with the token from that workspace's `state/keys/http.token` | Projects Atlas and Borealis | Atlas to `atlas`, Borealis to `default` |
| `home` | A personal notes workspace | `stdio`, spawned by the Tauri Rust host | The workspace and every project | None |

An app-list entry might read as follows. The syntax is illustrative; Loam's phase 1 settles it (L6).

```toml
[apps.work]
app = "umbel"
prefix = "work"
transport = "http"
url = "http://127.0.0.1:7410/mcp"
bearer_file = "/home/me/work-umbel/state/keys/http.token"
projects = ["atlas", "borealis"]
space = { atlas = "atlas", borealis = "default" }
expose = { agent = true, palette = true, mcp = false }    # commands that report no mutation
apps = ["work-knowledge-search", "work-knowledge-open"]   # callable by apps once Loam D30 lands

[apps.home]
app = "umbel"
prefix = "home"
transport = "stdio"
command = ["umbel", "--workspace", "/home/me/notes-umbel", "serve", "--stdio"]
expose = { agent = true, palette = true, mcp = false }
```

What happens:

1. **Load.** The loader calls each instance's `afd-help` by name, sees `toolStrategy: "hybrid"` with
   `knowledge-search` and `knowledge-open` among the first-class tools, and reads every command's
   schema through `afd-detail`.
   - Commands register as `work-knowledge-search`, `work-knowledge-open`, `work-workspace-show`, and
     so on, and as `home-knowledge-search` and the rest.
   - Had both instances been given the prefix `umbel`, the second would have failed to load:
     "Command prefix `umbel` is already used by instance `work`; choose another prefix for `home`."
2. **The palette** in project Atlas lists the commands of both instances. Outside Atlas and Borealis
   it lists only `home`'s.
3. **The copilot.** In Atlas, it calls `work-knowledge-search { query: "release checklist" }`, and
   the loader pins `space: "atlas"` (L9).
   - Hits come back labeled untrusted, with `trust: "content"`, and their locators render as links
     that open through `work-knowledge-open`.
   - The journal records the call with `instance: work, app: umbel`, marked recorded and not
     replayable.
   - The person also asks it to compare with their own notes, and it calls `home-knowledge-search`.
     The two result sets stay labeled by instance and are never written into each other, as Umbel
     D26 asks of multi-space reads.
4. **Skills.** If both hosts serve a skill named `knowledge-guide` (a hypothetical name),
   `work/knowledge-guide` and `home/knowledge-guide` appear in the copilot's agent surface,
   separately.
5. **A Loam app.** A `notes` app with a `calls` grant on `work-knowledge-*` calls
   `work-knowledge-search` once Loam D30 lands. A call without the grant, or to a command the
   instance does not expose to `apps`, is refused and journaled.
6. **Who Umbel sees.** `work` sees one `loopback` agent, and `home` its workspace's local principal.
   With one person that is accurate.

**The same `work` on a hosted Loam for a team.** The entry moves to the hosted server's app list.
The Umbel host runs on that machine, and the token comes from a deployer secret. Nothing else
changes, except who Umbel sees: every member's call reaches it as the one `loopback` agent, so
Umbel's per-document access cannot tell members apart before its phase 5. Access to `work` is then
decided on Loam's side, by project membership and the instance's projects. Whether that is
acceptable is owner question 5. `home` is not reachable from there and stays on the desktop.

### Dual-host plugins

Loam D10 asks for one manifest for a plugin with UI. The realistic case is an Umbel plugin, such as
knowledge, whose UI renders in Loam through a mounted Umbel instance. Loam never reads the
plugin's file: it sees tools and resources. For the plugin's `ui` to reach Loam, Umbel would have to
do three things:

- accept and carry a `ui` table in a later manifest version;
- project it over MCP, serving its views as `ui://` resources and putting `_meta.ui.resourceUri` on
  the linked tools;
- admit `tool_meta`, or derive that key from the view binding.

Serving views is partial interpretation, which Umbel D37 excludes ("without Umbel interpreting
UI"). That is Umbel's decision: owner question 2. Nothing in Loam's phase 1 waits on it. Until it is
decided, an Umbel instance is headless in Loam.

A Loam native app does not run in Umbel: its commands are TypeScript handlers in Loam's kernel
(Loam D21, D25). Its only way into Umbel is as a mounted server, which takes an Umbel manifest of
kind `mounted`.

### Collisions

| # | Collision | Resolution |
|---|---|---|
| C1 | `scopes`. Umbel reserves it, top level and per command, for per-command authorization scopes (`manifest.rs` lines 59 and 96). Loam D4 gives "scope" to workspace and project, and Loam D11 also says "per-command scopes" for authorization | `scopes` keeps Umbel's meaning. Loam's supported levels are `app.scope_levels` |
| C2 | `documents` grant. In Umbel it reads store documents (Umbel D54; its version 2 example). In Loam it reads document metadata, references and backlinks (architecture line 303) | One shared meaning: [Shared grant names](#shared-grant-names) |
| C3 | `allow` in a grant. Umbel reserves it, and allow-lists live in the deployer's `umbel.toml` (`manifest.rs` lines 74 to 77). Loam's `calls` and `http` grants need what the plugin asks for (architecture lines 308, 425 to 429) | `allow` stays the deployer's, never in a manifest. What a plugin asks for is the reserved `targets`, which grants nothing |
| C4 | "Pack". Umbel's pack is a plugin's data, reference material and rules (Umbel D46), and `pack` is also an Umbel kind. Loam's agent pack is skills, `.mcp.json` connectors, commands and sub-agents, and an app may be only one (Loam D44) | `packs` and the kind `pack` stay Umbel's. Loam's agent packs go in its `agent` section, and a pack-only Loam app takes another kind name (phase 5) |
| C5 | Exposure defaults. AFD's: palette and agent on, MCP and CLI off (`packages/core/src/commands.ts` lines 70 to 75; `packages/rust/src/commands.rs` lines 303 to 324; spec/command-metadata.md line 35). Umbel's manifest: MCP, agent and CLI on, palette off (`manifest.rs` lines 317 to 326) | The meanings are shared, and the default for a flag left out is the profile's. `plugin-check` and `app check` report the effective flags. Recommended for Loam: AFD's defaults. A manifest meant for more than one tool sets every flag |
| C6 | Confirmation. AFD's `confirmations: 'off' \| 'enforce' \| 'require-human'` is server-wide (`packages/server/src/server-types.ts` line 201). Umbel version 2's per-command `confirm = "require-human"` makes a command CLI-only (schema lines 633 to 659) | `confirm_prompt` is in the core. `confirm` stays Umbel's, since its rule is tied to Umbel's CLI |
| C7 | `approval` values. Umbel: `none \| required` (schema lines 575 to 577). AFD: `not-required \| required`, or a function (spec/command-metadata.md line 31) | The core keeps `none`, which maps to `not-required`. A function cannot be data |
| C8 | The kind `mounted` | One meaning: an MCP server whose tools become commands under an instance prefix. Each profile closes the transports it admits, and each transport value has one meaning |
| C9 | "Mount". The top-level `mount` is the MCP mount. Loam's "mount" is the shell-provided element an app renders into (architecture line 398) | `mount` is the MCP mount. Loam's surface keys name the app's element (`element`), not a `mount` |
| C10 | "View". It is Loam's kind `view`, its `[view]` section, the sandboxed resources and the surface catalog's sidebar "views" | The kind and section are `view` (Loam D9). The resources are `ui.resources`. The sidebar key is Loam's phase 1 choice (`shape` in the example) |
| C11 | `connectors`. The core reserves it for Umbel's federation contract after O1. Loam's agent packs carry `.mcp.json` "connectors" (architecture line 499) | `connectors` keeps the reserved meaning. Loam's agent packs mount `.mcp.json` servers as instances of kind `mounted` |
| C12 | Instance and app. Umbel's `plugin.id` is "the default instance id" (schema line 244). Loam's app id is the command domain (Loam D18) | The app id is the identity, and the default instance id and prefix for the first instance. Each further instance names its own ([Instances](#app-identity-and-instance-identity)) |

### Mapping onto AFD

A manifest command entry is declarative AFD command metadata. Umbel builds the definition from the
entry and attaches the plugin's handler (`PluginCommand::Handler`), so such a plugin cannot claim
metadata its manifest does not declare. A plugin that supplies a finished definition
(`PluginCommand::Definition`) is checked on name, description, schema, `mutation` against the
effects, `confirm_prompt`, `approval` and `contexts` only (`endpoints/umbel/src/plugins/compiled.rs`
lines 54 to 74).

The recommendation to Loam: the kernel builds or checks each command an app registers against
every field its manifest declares, and `app new` writes the entries from the app's `defineCommand`
calls, so nothing is typed twice.

| Manifest key | AFD field (wire) | TypeScript (`ZodCommandOptions`, `packages/server/src/schema.ts` lines 28 to 147) | Rust (`CommandDefinition`, `packages/rust/src/commands.rs` lines 698 to 784) | MCP surface (spec/command-metadata.md lines 64 to 75) |
|---|---|---|---|---|
| `name`, `description` | Same | Same | Same | Tool name and description |
| `title` (new) | `title` | `title` | `title` | Tool `title` |
| `input_schema` | Input schema | `input`, or `advertisedInputSchema` | `register_with_schema` | `inputSchema` |
| `returns` | `returns` | `output` | `returns` | `_meta.outputSchema` |
| `effects` | Derived `mutation` | `mutation` | `mutation` | `_meta.mutation`. On Umbel, also `_meta["dev.umbel/origin"].effects` (phase 1 section 8.1, line 1187) |
| `category`, `tags`, `version`, `examples` | Same | Same | Same | `_meta.category` and `_meta.examples`. Tags and version through `afd-detail` |
| `requires` (new) | `requires` | `requires` | `requires` | `_meta.requires` |
| `contexts` | `contexts` | `contexts` | `contexts` | `_meta.contexts` |
| `destructive`, `undoable` (new) | Same | Same | Same | `_meta` |
| `confirm_prompt` | `confirmPrompt` | Same | `confirm_prompt` | `afd-detail`, never `_meta` |
| `approval` | `approval` (`none` becomes `not-required`) | Same | Same | `_meta.approval` |
| `execution_time` | `executionTime` | Same | `execution_time` | `afd-detail` |
| `expose` | `expose` | `expose` | `expose` | Which surfaces list the command |
| `output_budget` | `outputBudget` | Not yet: step 2 of output budgets has not started (its STATUS) | `output_budget` | `_meta["dev.afd/outputBudget"]` |
| `errors` (new) | `errors` | `errors` | `errors` | `afd-detail` |
| `tool_meta` (new) | `toolMeta` | `toolMeta` (line 138) | `tool_meta` | Merged into the tool's `_meta` (T1) |
| `first_class` | None. It is a suggestion to a hybrid host (Umbel D45; hybrid proposal lines 152 and 153) | None | None | The first-class list, if the host accepts it |
| `skills[]` | Skills catalog | `skills` option (#615) | `with_skills` (#608) | `skill://` resources and the Skills extension |
| `ui.resources` (Loam) | Resources | `resources` option (#615) | `with_resources` (#608) | `ui://` resources and `_meta.ui` |

`handoff` and `handoffProtocol` (spec/command-metadata.md lines 33 and 34) are not in the core.

### Reconciliation with Umbel's manifest

Field by field, against `plugin-manifest.v2.json` and `manifest.rs`:

| Umbel key | Core version 1 | Loam profile (recommended) |
|---|---|---|
| `manifest_version`, `protocol` | Core, the profile's versions | 1 and 1, Loam's own |
| `plugin.id`, `title`, `version`, `description`, `homepage`, `license` | Core, same patterns | Same |
| `plugin.kind` | Core as a name, closed by the profile | `native`, `view`, `mounted` |
| `plugin.domains` | Core. Host domains are the profile's (Umbel's `HOST_DOMAINS`, `src/plugins/mod.rs` lines 78 to 86, and its CLI verbs) | Exactly `[plugin.id]` (Loam D18), with Loam's shell domains refused |
| `component.path` | Umbel profile | Not admitted |
| `mount.prefix`, `transport`, `only`; `tools[].tool`, `name`, `effects`, `confirm_prompt`, `approval`, `first_class` | Core | Admitted, transports per host |
| `mount.command`, `cwd`, `env`, `bearer`; `tools[].bind_space` | Umbel profile | Not admitted. A stdio instance's command is the deployer's |
| `grants[].name`, `required`, `reason` | Core shape and the shared names | Loam's catalog |
| `commands[]` version 1 keys | Core | Admitted |
| `commands[].output_budget` (version 2) | Core | Once TypeScript implements output budgets |
| `commands[].confirm` (version 2) | Umbel profile (C6) | Not admitted |
| Effects `store-write`, `workspace-write` (version 2) | Core; the profile names their grants | `store-write` through `store`; `workspace-write` refused |
| `contexts[]`, `pipelines[]`, `skills[]`, `config` | Core | Admitted |
| `packs[]` | Umbel profile | Not admitted (C4) |
| Reserved `ui`, `connectors`, `backends`, `dependencies`, `signature`, `scopes`, `on_conflict` and `grants[].allow` | Core reserved, same meanings | `ui` defined by Loam; the rest stay reserved |

No Umbel file, schema or code changes. Umbel D37's decision stands: one `umbel-plugin.toml`, `ui`
reserved for Loam, a closed schema. Two Umbel documents describe the superseded mechanism ("Loam's
own schema adds [ui] by referencing this schema's `$defs`"): D37's text and consequence, and its
phase 1 specification's "Room for Loam". If the owner agrees, Umbel annotates both to point here.
This pull request adds only a pointer in Umbel's follow-ups.

### Reconciliation with Plugin Discovery

Plugin Discovery keeps its meanings. Umbel made them declarative (phase 1 specification lines 485
to 500), and the core inherits that:

| Plugin Discovery | Core |
|---|---|
| `protocolVersion: 1` (FR-1, lines 32 to 70) | `protocol` |
| `name` | `plugin.id` |
| `PluginMetadata { description, version, homepage }` (FR-2) | `plugin.description`, `version`, `homepage` |
| `configSchema()` | `config.schema` |
| `register(registry)` adding commands | `commands[]`, with the host attaching handlers |
| `addMiddleware` | None. Neither host lets plugins add middleware (Umbel phase 1, line 496) |
| `package.json` `afd.plugin` (FR-3, lines 124 to 173) | Unchanged. An optional `afd.manifest` path is a step 6 option |
| `CommandOrigin`, `PluginDiagnostics`, `afd-plugins` (FR-6, FR-7) | Host reports, not manifest fields. Umbel's `plugin-list` and `dev.umbel/origin` are the precedent. Loam's console reports instances the same way |
| `onConflict` (default `explicit-wins`) | Reserved `on_conflict`. Umbel fixes `error`, it is recommended for Loam (L4), and across instances it is always `error` |

Plugin Discovery has no instances: one package is one plugin. If it gains them, the instance rules
above apply.

### Versioning and compatibility

- **The core.** Integer versions, in the file name and `$id`.
  - A new version only adds: an optional key, a reserved key defined, or a value in an open
    vocabulary.
  - A meaning or default never changes and a key is never removed. Anything else is a new format and
    needs the owner.
  - Additions wait for their consumer: `apps` with Loam D30's feature, `targets` with its first
    grant, `signature` after Umbel's watch row W9.
- **Profiles.** Each manifest version pins one core version and follows its host's rules: Umbel D40
  as annotated by D54, and Loam's architecture line 694. Adopting a newer core version means a new
  manifest version, so an older host refuses the newer file and says what it serves.
- **The AFD contract.** The core is listed in `spec/CHANGELOG.md`. Its version is its own, separate
  from `spec/VERSION`.

### Validation and language parity

| Language | Reader | When |
|---|---|---|
| Rust | Umbel's host (`src/plugins/manifest.rs`) for its profile. The `afd` crate needs none | Exists. Step 3, at Umbel's choice, adds the core cases to `tests/schemas.rs` |
| TypeScript | Loam's kernel and `app check` for Loam's profile. Types generated from the profile, the SDK's "manifest types" (architecture line 507) | Step 2, Loam's phase 1 |
| TypeScript, `afd-server` | Plugin Discovery, if it gains `afd.manifest` | Step 6 |
| Python | None. Botcore's plugins register through entry points | Recorded in [language parity](../../../language-parity.md) as an intended difference when step 1 lands. The cases let a reader be written |
| C++ | None | Same |

**Loam runs no validator code from strings.** Its web host's CSP is `script-src 'self'`, and Zod
already runs jitless for that reason (`endpoints/loam/packages/web/src/zod-jitless.ts`). Ajv
compiles validators with `new Function`, so Loam generates standalone validators at build time with
Ajv's standalone code. The Health dashboard does the same, with Ajv as a dev dependency
(`endpoints/health-dashboard/tooling/report-validator.ts` lines 1 to 6).

**No TOML parser in the kernel.** `app new`, `app check`, the build and installation turn TOML into
JSON, so the kernel reads JSON only. The kernel's bundle budget then counts only the generated
validator.

**Cases and drift.**

- Every reader runs `spec/plugin-manifest.json`.
- A test outside `spec/` that reads it is declared in `EXTRA_INPUTS` (`scripts/affected/scope.mjs`
  lines 34 to 39, which map `spec/` only to core, server and cli today).
- `loam.yml`'s path filters (lines 6 to 20 and 23 to 36) gain `spec/plugin-manifest*`, with the
  Affected-units gate and `scripts/affected/suites.mjs` to match.
- A check that Umbel's examples still conform to the core binds Umbel, so it is Umbel's to add, in
  step 3.

### Signing and trust

The manifest is untrusted input. A host never takes a plugin's trust from it: trust comes from the
kind, and each host decides it. This proposal records the parallel and changes neither model.

| Trust class | Umbel (decided) | Loam (as documented) |
|---|---|---|
| In process, trusted. Grants are a declaration and an API | `compiled` (Umbel D42, owner decision 1). A stdio `mounted` is as trusted as compiled (Umbel D43, owner decision 2) | `native` runs in the page. Loam's documents do not name its class, and say "isolation is enforced here, not by apps" (architecture lines 296 and 297) and "The `calls` grant is the only path between apps" (lines 676 and 677). Question 1 |
| Sandboxed | `component` (WASI 0.2, imports checked against grants; Umbel D38) | `view`: a sandboxed iframe that gets only pushed data and calls tools through the registry (architecture lines 667 to 669). Drafts run here until promoted (Loam D47) |
| External, over the network | An HTTP `mounted` instance. Annotations are untrusted, and results are stamped `external` and never replayed (Umbel D43) | `mounted` over `http`, including an HTTP Umbel instance. Results are labeled untrusted and calls are not replayed |
| Child process | A stdio `mounted` runs as the host's OS user and is as trusted as a compiled plugin; clearing the environment is hygiene, not isolation (Umbel D43, owner decision 2). Its results are still stamped `external` | A stdio instance spawned by the desktop's Rust host or the hosted Node process is the same case. Loam's documents do not decide it, and its results are still labeled untrusted. Question 6 |
| Data | `pack` | None |

**Consent** is each host's. In Umbel, enabling an instance consents to its declared grants minus
`deny`, and any future write, `http` or `secrets` grant needs the deployer's `allow` (Umbel D42).
Nothing in the core weakens this. Loam mounting an Umbel instance changes nothing in Umbel either:
Loam is one more MCP client, under Umbel D32's loopback and token rules.

**Signing.** `signature` stays reserved with Umbel's meaning. Umbel anchors it to its watch row W9,
which tracks Agent Skills versioning and security. Loam has no such row yet. Loam's published app
is "a versioned, revocable artifact in the workspace store", approved by an owner (Loam D47).
Question 3 asks whether that is enough until signing is settled.

## Alternatives considered

| Alternative | Why not |
|---|---|
| One closed schema for every host | The hosts' kinds, grant catalogs and domains differ. A schema that admits all of them is either open, losing closed manifests, or admits each host's values in the other |
| Loam `$ref`s Umbel's `$defs` (Umbel D37's note, phase 1 lines 502 to 509) | The four reasons in [Problem](#problem). It works only for `grant`, `context`, `pipeline`, `skill` and `config`, which the core takes as they are |
| A separate Loam manifest | Loam D10: "no second plugin contract in the repository" |
| A runtime package now | Loam D10's correction says a schema. Each language has one reader until Plugin Discovery is implemented |
| camelCase keys, as on AFD's wire | Renames every key Umbel shipped, against Umbel's "Field names that both use keep Umbel's meaning" (phase 1 line 508) |
| Commands from code only | A manifest is read before code runs: by `plugin-check`, `app check`, the builder, and a deployer deciding what to enable. Writing entries from code and checking them at load keeps the benefit |
| The core in Umbel's `schemas/` | Makes Umbel own Loam's contract and its version cadence. `spec/` holds AFD's cross-language shapes |
| A static command list in the Umbel host's manifest | Wrong for every deployment but one. A hybrid server's commands are discovered through `afd-help` and `afd-detail` (H8) |
| Every Umbel instance's commands under the one domain `umbel` | Two instances collide. The instance prefix is Umbel's own rule for mounted servers |
| A direct browser-to-Umbel connection as the default | It needs CORS that neither Umbel nor the `afd` crate has, preflights past Umbel's bearer layer, a CSP change, and a workspace token in the browser. The hosted server and the desktop reach Umbel without any of them |

## Open questions

### For the owner

These touch a trust model, another unit's decisions, or approval authority.

1. **Native Loam apps' trust class.**
   - Recommendation: trusted, not sandboxed, as Umbel's compiled plugins are (Umbel D42, owner
     decision 1). `app check` says "trusted, not sandboxed", and untrusted apps ship as views.
   - A yes amends Loam's architecture lines 296 and 297 and 676 and 677, which read as isolation
     between apps. The amendment would say isolation is enforced for views and mounted apps, and
     native apps are trusted code.
2. **Umbel carrying and projecting `ui`.** Should a later Umbel manifest version carry a `ui` table,
   serve its views as `ui://` resources, and admit `tool_meta` or derive `_meta.ui.resourceUri`?
   That is partial UI interpretation, which Umbel D37 excludes.
   - Recommendation: decide it when Loam's Umbel app is specified, after Umbel's phase 2. Until
     then, Umbel instances are headless in Loam.
3. **Signing before W9.**
   - Recommendation: no. Workspace-store digests and Loam D47's owner approval cover Loam's
     published apps, `signature` stays reserved, and Loam adds a trajectory row for signing.
4. **Approval authority.** This proposal adds a shape to AFD's `spec/` contract, and it replaces the
   mechanism described in Umbel D37's note and Umbel's phase 1 specification. The coordinator's
   delegation covers Loam's specifications.
   - Recommendation: the coordinator approves the proposal for Loam's phase 1, and the owner
     confirms the `spec/` addition. Umbel annotates D37 and "Room for Loam" itself.
5. **A multi-member Loam over a single-principal Umbel.** Until Umbel's phase 5, every Loam call to
   an instance reaches Umbel as one loopback principal (Umbel D32). Umbel's per-document access
   cannot separate Loam members, and its filtering is exact only for embedders (Umbel D53).
   - A stdio instance on a hosted server is the same, with every member acting as the workspace's
     local principal (Umbel's phase 0 specification, lines 973 and 974).
   - Recommendation: accept it until Umbel's phase 5, with access decided in Loam by project
     membership and the instance's projects. Use HTTP for team instances. Mount a team instance only
     where every member of those projects may read all of it. `app check` and the console say so.
6. **Stdio instances in Loam.** A stdio child runs as the Loam host's OS user, so on the desktop or
   the hosted server it can read what that user can. Umbel treats its own stdio mounts as trusted as
   compiled plugins (Umbel D43, owner decision 2). An instance entry's `command` is also a command
   line held in workspace data, and Loam's builder works through journaled commands (Loam D47).
   - Recommendation: a stdio instance is trusted code, as in Umbel. Only a person who owns the
     workspace on the desktop, or the deployer's configuration on the hosted server, can add or
     change `command`. No command, app or agent may write it, and the autonomy policy cannot grant it.

### For Umbel's owner

Each is a question, not an assumption. U1 alone would amend a recorded rule (Umbel D32).

- **U1. CORS.** Should a browser-hosted Loam be able to reach a loopback Umbel directly? It needs
  the `afd` crate's Streamable HTTP service to answer preflights and send `Access-Control-*` headers
  for `allowed_origins` (an AFD feature, Umbel D25). It also needs Umbel's bearer layer to let
  preflights through, which amends Umbel D32's "required on every HTTP request", though a preflight
  carries no data and runs no command.
  - Recommendation: no, at least not before Loam's phase 6. The hosted server and the desktop do not
    need it.
- **U2. Reach beyond loopback before Umbel's phase 5.**
  - Recommendation: no. Umbel D32 stands, and Loam co-locates.
- **U3. A host description.** Should Umbel publish its host manifest (the headless Loam-profile file
  above) or serve its identity, for example through its phase 7 server card?
  - Recommendation: Loam ships the first-party `umbel` app manifest. A server card can replace it
    later, and Umbel needs nothing now.
- **U4. Scope and space.** Loam D31 says scope is proposed AFD-wide "when a second consumer needs
  it, unified with Umbel's space". Unify them as one declared context field now?
  - Recommendation: not in Loam's phase 1. Map project to space through the `space` input, and
    decide in Loam's phase 2 specification.

### For Loam's phase 1 specification

- **L1.** File name and encoding. Recommendation: TOML for authors, as Umbel's; JSON for
  builder-written artifacts and at runtime.
- **L2.** The kind names. Recommendation: `native`, `view`, `mounted`.
- **L3.** Exposure defaults. Recommendation: AFD's, for app commands (C5). The instance entry sets
  them for mounted instances.
- **L4.** The conflict policy for an app's own commands against the shell's. Recommendation: `error`,
  as Umbel's and as it already is across instances.
- **L5.** Where a `view` app's command handlers run: a server it is served with, a module beside it,
  or nowhere, so that a view app has no commands of its own.
- **L6.** The workspace app list's syntax for instances, in Loam's terms: id, app, prefix, transport,
  location, credential reference, projects, exposure defaults and per-command overrides, space
  mapping. Also when to discover an instance's commands again.
- **L7.** Whether the browser always reaches instances through the hosted server (recommended), or
  the web host's static CSP gains instance origins through a server-sent header or a build-time list.
- **L8.** A `requires` entry that names an unknown command. Recommendation: warn.
- **L9.** Whether a mapped space is pinned (recommended) or only a default.
- **L10.** How far Loam trusts a mounted server's reported `mutation`, `destructive`, `approval` and
  effects. Recommendation: use them for display and defaults, treat an unreported command as a
  mutation under the autonomy policy, and let the instance entry override them.

## Implementation plan

| Step | What | Packages | Gate |
|---|---|---|---|
| 0 | This proposal and its status | `docs/` | Independent review and approval (question 4) |
| 1 | `spec/plugin-manifest.md`: the keys, meanings, profile contract, rules beyond the schema, shared grant names, instance rules, collisions and the AFD mapping. Also `spec/plugin-manifest.core.v1.json`, `spec/plugin-manifest.json`, `spec/CHANGELOG.md`, and the Python and C++ row in `docs/language-parity.md` | `spec/`, `docs/` | Lands before Loam's phase 1 specification is approved, or in the same pull request ("spec first", Loam's architecture line 774) |
| 2 | Loam's profile `app-manifest.v1.json`, generated types, standalone validators, a JSON-only kernel reader, `app check` running the core cases, the mounted loader's hybrid discovery, and instance entries (L6). Also `loam.yml`, `EXTRA_INPUTS` and `suites.mjs` | `endpoints/loam/packages/` (Loam's phase 1) | `loam.yml` |
| 3 | Optional, Umbel's choice: the core cases and an examples-conform check in `tests/schemas.rs`; the D37 and "Room for Loam" annotations; later, a manifest version that `$ref`s the core; `ui` per question 2 | `endpoints/umbel/` | `umbel.yml` |
| 4 | `expose.apps` as core version 2, with Loam D30's AFD proposal | `spec/`, then each language's `ExposeOptions` | Loam's phase 5 |
| 5 | `grants[].targets`, with the first grant that needs it | `spec/`, the hosts | Loam's phase 5 (`calls`) or Umbel's `http` |
| 6 | Plugin Discovery revised to cite the core, with an optional `afd.manifest` | `packages/server` | When Plugin Discovery is taken up |
| 7 | Only if U1 is answered yes: CORS on the `afd` crate's Streamable HTTP service, spec first, and preflights past Umbel's bearer layer | `packages/rust`, `endpoints/umbel` | Before Loam's browser host mounts directly |
| 8 | The first-party `umbel` app in Loam: the headless manifest above, mounted through the instance entries | `endpoints/loam/` | After Umbel's phase 2 and Loam's phase 5 (architecture line 761) |

Loam's phase 1 specification depends on step 1 and carries out step 2. It depends on nothing in
steps 3 to 8.

## Acceptance

- **Step 1.**
  - The core is valid JSON Schema 2020-12.
  - Every case passes in TypeScript (Ajv 2020) and in Rust (`jsonschema` 0.60), including one
    refusal per closed object and the "cousin" case.
  - Umbel's seven `plugin-manifest*` examples validate against the core's `manifest` definition
    unchanged.
- **Step 2.**
  - Loam's profile refuses each of these, at any depth, naming the key and giving a suggestion:
    - an unknown key, including `expose = { pallete = true }`;
    - an unknown surface;
    - an Umbel kind;
    - `scopes` or `packs`.
  - Hello's manifest validates in all three kinds, and so does the headless `umbel` manifest.
  - Two mounted instances of one app load under different prefixes, and the same prefix twice is
    refused.
- **No Umbel schema or code changes** in steps 0 to 2.

## Rollback

Steps 0 and 1 are documents and a schema with no runtime reader, and withdrawing them restores
today's state. Step 2 is Loam's and is rolled back by Loam. Umbel is unaffected at every step it
does not choose.

## Out of scope

- Loam's surface schemas, mount contract, composition library, and the contents of `ui` and `agent`.
- Connectors and backends, which stay reserved.
- A shared origin key on tools (`dev.afd/origin` beside `dev.umbel/origin`), until a second host
  emits one.
- Prompts and hot reload.
- Dependencies between plugins, which are never added (Umbel D3, Loam D2).
- Federation between Umbel deployments (Umbel D18), which Umbel specifies.
