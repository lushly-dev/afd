# Host specification: the deployer's journal mode for a component instance

| Field | Value |
| --- | --- |
| Serves | The deployer chooses how the journal records a sandboxed component's calls, `plain` or `digest` with `keep`, in `umbel.toml`, as the owner decided (D195). The first user is Component Briefs step D2 ([#1155](https://github.com/lushly-dev/afd/issues/1155)): the `components` plugin built as a component, whose compiled build journals a digest so that a page's source and the pack text stay out of the journal |
| Issue | [#1382](https://github.com/lushly-dev/afd/issues/1382) |
| Owner | Repository owner approves; the agent working #1382 writes and implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 1 specification](spec.md) (sections 9.1 and 9.2), the [world 1.1.0 specification](world-1.1.spec.md) (sections 7 and 8), the [phase 3 specification](../3-memory-context/spec.md) (sections 2.3, 2.4 and 7.1), and the [decision log](../../decisions.md) (D72, D188, D191, D195, and D196 and D197, made here) |
| Elevation | Exact keys, rules, codes, files and tests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

Code paths are relative to `endpoints/umbel/` unless they start with `packages/`.

## Status

- **State:** written 2026-11-17 and revised the same day after an independent review (two blockers: an explicit
  `plain` must stay visible to `plugin-show`, and a refused pipeline of a required instance stops the host; both
  fixed in sections 2 and 3; the improvements taken). D196 and D197 are decided under the owner's delegation for #1382; the trust-model
  choice itself (who chooses) is the owner's, D195, and nothing here widens what a component may do.
- **Last verified:** 2026-11-17 against `origin/main` at `80d53bdd`, by reading the files cited at each claim.
  **No code was built or run.**
- **Not done:** everything; step 2 implements it. **Follow-ups:** the [table at the end](#follow-ups).

## What this specification serves

Phase 3 made digest journaling a manifest key (section 2.3, D72): the plugin's author declares
`journal = { mode = "digest", keep = [...] }` per command, and the journal then keeps the entry's metadata and the kept
input keys, and drops the rest of the input and the result's data (section 7.1). A component command may not declare
it (D191): the author of sandboxed, untrusted code would choose how much of its own behaviour the deployer can audit.
The owner decided that the deployer chooses instead (D195). Until this lands, every component call is journaled in
full, input and result included.

## 1. The key (D196)

**Configuration version 7 gains `[plugins.<id>.journal]` on a plugin instance, additively (section 5).** It is read
only for a component instance.

```toml
config_version = 7

[plugins.components]
source = "plugins/components/component"

# Every command of the instance, unless a command entry says otherwise.
[plugins.components.journal]
mode = "digest"
keep = ["space", "library"]

# One command, whole: an entry replaces the instance's mode and keep for that command.
[plugins.components.journal.commands]
components-brief = { mode = "digest", keep = ["space", "library", "detail", "render", "consumer"] }
components-show = { mode = "digest", keep = ["space", "library", "tag"] }
```

This is the configuration D2 needs: it gives the three commands the modes and kept keys the compiled manifest
declares (`plugins/components/umbel-plugin.toml`), `components-list` through the instance's own `mode` and `keep`.

| Key | Rule |
| --- | --- |
| `journal` | A table, keys `mode`, `keep` and `commands`; absent means every command is `plain`, as today |
| `journal.mode` | `"digest"` or `"plain"`. Optional: absent means `plain` for every command that `commands` does not name, and then `keep` is refused |
| `journal.keep` | With `mode = "digest"` only. At most 16 strings (`MAX_JOURNAL_KEEP`), none twice. Each names a top-level input key whose value stays in the entry under phase 3 section 7.1's rule (a string, a number, a boolean, or a list of at most 100 strings). A key a command's input lacks is not kept, so one list serves every command |
| `journal.commands` | A table from a command name to `{ mode, keep }`, where `mode` is required and `keep` has `journal.keep`'s rules. The entry replaces the instance's `mode` and `keep` for that command; nothing merges. Its keys are names the deployer chooses, so the table is open over names; each value is a closed table |

**Rules a configuration file can check** (each `WORKSPACE_CONFIG_INVALID`, naming the key):

- `journal` before version 7: "needs config_version = 7".
- Any other key in `journal` or a command entry: "is not a known key". `show` is not admitted: it is for a command a
  person decides on the person page (phase 5 step 6), which no component command is.
- `mode` not `digest` or `plain`; `keep` with `plain` or with `mode` absent; `keep` over 16 keys or naming a key
  twice; a `commands` value that is not a table; a command entry without `mode`; a command name that is not an AFD
  command name (`afd::validate_command_name`).

Both paths that read `[plugins]` give the same version message: `ConfigFile::into_config` through `is_v7_key`, which
gains a `plugins.<id>.journal` arm, and `ConfigFile::plugins` (which the doctor's `plugins.config` calls), which today
says "is not a known key" for every unknown `plugins.*` key and gains the same check first.

**Rules that need the manifest** (each `PLUGIN_CONFIG_INVALID` for the instance, naming the key, checked by
`plugins::doctor::fits` with `limits`):

- `journal` on an instance whose plugin is not a component: "applies only to a component plugin: a compiled
  plugin's manifest declares its journal modes, and a mounted tool's are not configurable".

The manifest's own refusal of `journal` on a component command (`src/plugins/manifest.rs`, D191) still says the
question "is not decided". It becomes: "is not available to a component plugin: the deployer sets a component's
journal mode in umbel.toml, [plugins.<id>.journal]", and the manifest tests assert that wording.
- A `journal.commands` entry that names no command of the manifest: "names `<name>`, which is not a command of
  the plugin". A pipeline is not a command here: it inherits its mode from its steps (section 3).

Why no version 8: D188's rule. The key is optional and its absence is today's behaviour, nothing outside this
repository reads version 7 (Umbel is `publish = false` and has no release tag), and the auth profiles (D188) and the
local page's `public_origin` ([A50 of the Ideas host-review specification](../../plugins/ideas/host-review.spec.md)) were added to it the same way. A host built before this key refuses it as an
unknown key rather than ignoring it, so no host journals in full what the deployer asked to keep out. A version 8 is
needed only once version 7 ships; phase 6, which proposes its own configuration number, takes the next one free under D170.

Why only components: a compiled plugin's journal modes are its author's, and its author is trusted code linked into
the binary (D42), and the phase 3 rules that require `journal` on every command of a memory plugin rest on that.
A mounted tool may not declare `journal` either (phase 3, 2.3); letting the deployer choose for a mount is the same
idea, not needed by anyone yet, and is a follow-up.

## 2. What the host does with it (D197)

**The host applies the setting to the instance's manifest when it prepares the instance**, after `fits` passes and
before anything reads a command's journal mode: each component command's `journal` becomes the deployer's entry, or
the instance's `mode` and `keep`. An explicit `plain`, from the instance or an entry, becomes
`Some(JournalDecl { mode: Plain, keep: [], show: [] })`, so `plugin-show` can tell it from nothing set; a command the
key does not reach keeps `None`. The gate and the known-commands map test only for `Digest`, so the two read the
same everywhere else. A component's manifest can carry no `journal` of its own
(D191), so there is never a conflict to resolve and no precedence rule.

Everything downstream then reads it as it reads a manifest's digest today, with no second path:

- `loader.rs` puts the kept keys in the gate entry (`GateEntry.digest`), and `host::digest_commands` collects them
  into the journal recorder's redact set, fixed at seal (phase 3, 7.1).
- Every route that records is covered as for a compiled command: a direct call, a batch item, an `afd-pipe` step and
  a plugin pipeline step, each journaled under its own name.
- The entry's `metadata` carries `dev.umbel/journal: "digest"` and `dev.umbel/replay: "recorded"`, so the test kit's
  replay skips it and names it. A component's tape (its clock and random reads, `component_replay.rs`) stays in the
  entry, as 7.1's table says the tape does.
- `show` is always empty.

**A changed setting applies from the next seal.** Entries written before stay as written: the journal is append-only,
and a switch to `digest` does not reach earlier entries. `plugin-show` reports what is in force now (section 4).

## 3. Pipelines

A pipeline's mode follows its steps, wherever the pipeline is declared (`src/plugins/pipelines.rs`, phase 3 section
2.3). Because the deployer's setting is in the manifest before seal builds the known commands, the existing rules
apply to a component command made digest exactly as to a compiled one:

- **Inheritance.** A pipeline, of any instance, with a step that is a digest component command is journaled as
  digest with no kept key.
- **Flow.** A pipeline that passes a digest step's output to a step that is not digest is `PLUGIN_MANIFEST_INVALID`
  at seal, naming the pipeline and the step, and fails the pipeline's instance as it does today. So a deployer who
  makes a component command digest can make another instance's pipeline refuse to load. **Instances are required by
  default, and a required instance's failure stops the host from opening** (`loader.rs`'s seal returns the error),
  so in the common case the host does not start, and the doctor's `plugins.loaded`, which runs only on a sealed host,
  reports it only for an optional instance. The error itself therefore names the cause: when the digest step's mode
  comes from the deployer, the message ends "(digest by plugins.<id>.journal)", naming the step's instance. The
  deployer then makes the downstream component command digest as well, or sets the upstream one back to `plain`, or
  does not enable that pipeline's instance. Refusing is the point: the plain step's journaled input would hold what
  the deployer asked to keep out. `Known` gains whether its digest came from the deployer, for the message.
- `afd-pipe` stays the stated limit of phase 3 section 7.1: its steps resolve inside AFD, so a plain step it passes
  a digest result to journals that result.

## 4. What `plugin-show` and the doctor report

**`plugin-show`** gains a `journal` object on each command and each pipeline, for every kind:

| Field | Value |
| --- | --- |
| `mode` | `"digest"` or `"plain"`: what the journal does with the command's calls now |
| `keep` | The kept input keys; `[]` for `plain` and for a pipeline |
| `setBy` | `"manifest"` (a compiled plugin's declaration), `"deployer"` (this key, on a component, `plain` included), `"steps"` (a pipeline with a digest step) or `"default"` (nothing declared: `plain`) |

A mounted tool's entry is `{ "mode": "plain", "keep": [], "setBy": "default" }`. A pipeline's is `steps` or
`default` only, never `manifest`: a pipeline's own declared `journal` does not set how it is journaled
(`loader.rs` sets its gate entry's digest from its steps alone), the memory plugin's included. A pipeline not
registered (a missing step, or not loaded) reports `default`, and its existing `state` says why. The field is
additive; no existing field changes.

**The doctor** needs no new check. Section 1's configuration rules fail `plugins.config`, which reads `[plugins]`.
Its manifest rules are `fits`'s, which the doctor runs as it resolves each source, so they show in `plugins.sources`
as a misplaced `limits` does: `fail` for a required instance, `warn` for an optional one. A pipeline refused by
section 3's flow rule shows in `plugins.loaded` for an optional instance; for a required one the host does not open,
and the open's error, with section 3's message, is what the deployer reads.

## 5. Configuration version 7, additively

`config_version` stays 7, `CONFIG_VERSIONS` is unchanged and `umbel init` writes no new key. Versions 1 to 6 read with
no `journal`.

- `schemas/workspace-config.v7.json` gains `journal` on `$defs/instance` and a closed `$defs/journalEntry`, in place,
  and its description names this specification and D196. `schemas/examples/` gains `workspace-config.v7.journal.json`
  with a component instance's `journal`.
- The key scan (`scan_plugins`) admits `journal` on an instance from version 7, scans `journal` and each command
  entry as closed tables, and leaves `commands` open over names (its values are checked when parsed);
  `is_v7_key` gains the `plugins.<id>.journal` arm for the "needs config_version = 7" message.
- `single_plugin_config` (`src/plugins/check.rs`), which `plugin-check` and the test kit's `TestHost` share, writes
  `config_version = 7` when the instance's keys hold `journal`, and 2 otherwise as today: the lowest version that
  admits the instance's keys. A test sets it with `TestHost::directory(...).instance_keys(...)`.
- `PluginInstance` gains `journal: Option<InstanceJournal>`, holding `mode: Option<JournalMode>`, `keep` and
  `commands: BTreeMap<String, JournalDecl>`.

## 6. Tests

| Test | Proves |
| --- | --- |
| `tests/config_v7.rs` | The key parses as section 1 prints it; each configuration rule of section 1 is refused with `WORKSPACE_CONFIG_INVALID` naming its key, `journal` in version 6 with "needs config_version = 7", and `show` as an unknown key; the schema and the host agree on the example |
| `tests/schemas.rs` | `workspace-config.v7.json` validates the new example and refuses `keep` over 16, an unknown key in a command entry and a command entry without `mode` |
| `tests/component_journal.rs` (new, `component` feature) | With the `budget` fixture and `mode = "digest"`, `keep = ["space"]`: the journal entry of a call holds `dev.umbel/journal: "digest"`, `dev.umbel/replay: "recorded"`, the kept `space` and the input's byte count, and neither a canary in the input nor the result's data; `TestHost::replay` skips it and names it; a `commands` entry `plain` for the same command journals it in full; with no `journal` the call is journaled in full, as today; a canary in the input of a batch item and an `afd-pipe` step is absent too |
| `tests/component_journal.rs` (results and failures) | With the `behaviors` fixture made digest: `probe-echo`'s canary, echoed into the result, is absent from the journal, and `probe-bad`'s failure (a result that is not JSON) keeps only its code, with `message` `"(digest)"` and no suggestion |
| `tests/component_journal.rs` (pipelines) | A component manifest whose pipeline has the digest command as a step is journaled digest and `plugin-show` reports `setBy: "steps"`; one that passes that step's output to a plain step fails with `PLUGIN_MANIFEST_INVALID` naming the step, and its message ends "(digest by plugins.<id>.journal)"; making the second step digest too loads it |
| `tests/component_journal.rs` (refusals) | `journal` on a compiled instance is `PLUGIN_CONFIG_INVALID` naming `journal`; a `commands` entry naming no command is `PLUGIN_CONFIG_INVALID` naming it; the doctor's `plugins.sources` fails for each on a required instance, and `plugins.config` fails for `journal` in version 6 |
| `tests/component_journal.rs` (`plugin-show`) | Each command's `journal` with `setBy` `deployer` (a digest entry and a `plain` entry) and `default`; a compiled digest command (the memory plugin's) reports `manifest` |
| `tests/manifest_v3.rs` | `journal` on a component command is refused with the message of section 1, naming `[plugins.<id>.journal]` |

The tests use the existing `budget` and `behaviors` fixtures, whose manifests the tests write, so no plugin crate and no
fixture build changes. A test of a compiled instance writes its version 7 `umbel.toml` itself.

## 7. Implementation plan

1. **This specification**, with D196 and D197 in the decision log, STATUS, and notes in phase 1 section 9.1, phase 3
   section 2.3, and the world 1.1.0 specification's section 7. Documents only.
2. **The host**: sections 1 to 6 in one pull request touching `src/`, `schemas/` and `tests/`, and no plugin crate.
3. **D2** (#1155) sets the `components` instance's journal in the workspace that serves it, mirroring the compiled
   manifest's three `journal` lines, in its own pull request.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-17 | This specification | A deployer-chosen journal mode for a mounted tool, the same key on a mounted instance | Open, the first deployer who needs it |
