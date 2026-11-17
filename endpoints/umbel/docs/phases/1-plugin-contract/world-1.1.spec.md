# Host specification: WIT world `umbel:plugin/plugin@1.1.0`

| Field | Value |
| --- | --- |
| Serves | A sandboxed component command sees its call's output budget and fits its result to it, as a compiled command already does. The first user is Component Briefs step D2 ([#1155](https://github.com/lushly-dev/afd/issues/1155)): the `components` plugin built as a component for the stock `umbel` binary |
| Issue | [#1364](https://github.com/lushly-dev/afd/issues/1364) |
| Owner | Repository owner approves; the agent working #1364 writes and implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 1 specification](spec.md) (sections 3 and 4), the [phase 2 specification](../2-knowledge/spec.md) (sections 3.3, 3.4 and 8.6), the [phase 3 specification](../3-memory-context/spec.md) (sections 2.3's `journal`, 6.1, 6.2 and 7.1), the [phase 4 specification](../4-curator/spec.md) (section 2.2's `confirm_preview`), the [components specification](../../plugins/components/spec.md) (W17), and the [decision log](../../decisions.md) (D38, D40, D54, D151, and D189 to D191, made here) |
| Elevation | Exact names, shapes, codes, files and tests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

Code paths are relative to `endpoints/umbel/` unless they start with `packages/`.

## Status

- **State:** written 2026-11-16 and revised the same day after an independent review (one blocker, the manifest
  schemas, fixed in section 4; the component `journal` moved to the owner's questions; the rest taken). D189 to D191
  are decided under the owner's delegation for #1364, which keeps every change to the trust model with the owner
  (section 8). Step 2 (the world, the host and the SDK) is implemented in its pull request, with the amendment in
  section 3 item 4.
- **Last verified:** 2026-11-16 against `origin/main` at `959a08e7`, by reading the files cited at each claim and
  wasmtime 48.0.8's `Linker` and `NameMap` (`wasmtime-environ` `src/component/names.rs`). **No code was built or run.**
- **Not done:** step 3, D2 itself (#1155), and the owner's questions (section 8). An export newer than 1.1 is
  refused by the same check as a newer import, and is not tested with a fixture of its own. **Follow-ups:** the [table at the end](#follow-ups).

## What this specification serves

Four features name world 1.1.0 as their prerequisite today:

| Named for 1.1.0 | Where | What it needs from a component |
| --- | --- | --- |
| The output budget | Phase 2, 3.4 and 8.6; `src/plugins/manifest.rs` `output_budget` | Read the call's budget |
| Four `host-error` cases (`conflict`, `busy`, `corrupt`, `io`) | Phase 2, 3.3, review item M9 and D8 | Tell those refusals apart |
| Store grants (`content`, `documents`, `index`, `graph`, `records`, `memory`, `memory_write`) | Phase 2, 3.3; phase 3, 6.1; D54 | Read or write the stores |
| Masking of component writes | Phase 3, 6.2 | Write memory with masking that does not rely on the component |

The first two give a component nothing it could not already reach. The last two change what a sandboxed component may
read and write, which is the trust model (architecture principles 3 and 9; D42), and stay with the owner.

D2 needs two more things that are not the world's (section 7): the `components` manifest declares
`journal = { mode = "digest", ... }` on each of its three commands (`plugins/components/umbel-plugin.toml`), which a
component command may not (phase 3, 2.3); and the plugin uses `HashMap`, whose seed is a `wasi:random` import a
component holds only with the `random` grant (phase 1, section 4).

## 1. Scope (D189)

**World 1.1.0 carries the output budget and the four `host-error` cases. Store grants, the masking of component
writes and `journal` on a component command wait for the owner (section 8); store grants and masking would then come
in a later minor version of world 1.**

- **Plugin protocol stays 1, and no manifest version is added.** The budget is a new interface the world may import,
  which phase 1 section 3's table makes a minor version. No manifest key is new: `output_budget` exists from
  manifest version 2, and only the kind rule relaxes (sections 4 and 6), so the table's "new manifest version" row
  does not apply.
- **An exception to phase 1 section 3, stated.** The four new cases change `host-error`, so `packs.list`,
  `packs.read` and `events.list` change signature, which that table classes as a major version: wasmtime checks a
  variant by its case count and names (`typecheck_variant`), so a 1.0.0 component could not bind to 1.1.0's `packs`.
  The table's purpose is that a component built against an older 1.y keeps loading. Section 3 keeps that by linking
  both worlds, each import binding to its own version, instead of only the newest as phase 1 section 4 says. A
  variant may therefore gain cases in a minor version only while the host links every earlier minor version beside
  it.
- **`journal` is not admitted.** Its refusal on a component command was justified by memory (phase 3, 2.3), but
  admitting it is a trust-model choice of its own: a `digest` journal drops a call's result data from the deployer's
  journal and makes its replay `recorded` (phase 3, 7.1), so the author of a sandboxed component would choose how
  much of its own behaviour the deployer can audit. It stays refused, and is the owner's question.
- Every refusal message that names world 1.1.0 for something 1.1.0 does not carry is reworded (section 6).

Why not store grants now: no component needs one yet. D2's plugin holds only `config`, `packs` and `log` (D151). A
store import would be a new trust decision with no user waiting for it.

## 2. The world

The new file `wit/umbel-plugin-1.1.0/world.wit` is normative; this is its content. `wit/umbel-plugin-1.0.0/world.wit`
does not change, and both stay in the tree for as long as the host serves world 1.

```wit
package umbel:plugin@1.1.0;

/// Shared types. JSON travels as UTF-8 text; the host parses and validates it.
interface types {
  type json = string;

  /// What the command is called with. The principal is a summary: plugins never
  /// see credentials or tokens. Unchanged from 1.0.0; the budget is `call`'s.
  record call-context {
    command: string,
    trace-id: string,
    /// The resolved space for a command with a `space` input; none otherwise.
    space: option<string>,
    actor-kind: string,
    actor-id: option<string>,
    on-behalf-of: option<string>,
    /// mcp, cli, agent or palette.
    %interface: string,
  }

  variant host-error {
    /// The grant was not declared, or the deployer denied it.
    not-granted(string),
    not-found(string),
    invalid(string),
    too-large(string),
    /// A compare-and-set or revision check failed and nothing was written: what the store holds now.
    conflict(option<string>),
    /// A lock wait ran past the store's lock timeout; retry.
    busy(string),
    /// The stored data is not what the store wrote; run store-check.
    corrupt(string),
    /// The operating system or the database failed.
    io(string),
  }
}

/// No grant. What the host knows about this call beyond the call context.
interface call {
  /// The call's effective output budget in bytes: the command's declared
  /// `default_bytes`, or the caller's ask clamped to `max_bytes`. None for a
  /// command that declares no `output_budget`.
  output-budget: func() -> option<u64>;
}

/// Grant `config`. The instance's configuration, validated, with defaults applied.
interface config {
  use types.{json};
  get: func() -> json;
}

/// Grant `log`. Lines go to the host's stderr log, tagged with the instance id.
interface log {
  enum level { error, warn, info, debug, trace }
  write: func(level: level, message: string);
}

/// Grant `packs`. Read the call's space's effective copy of one of this plugin's packs.
interface packs {
  use types.{host-error};
  %list: func(pack: string) -> result<list<string>, host-error>;
  read: func(pack: string, path: string) -> result<list<u8>, host-error>;
}

/// Grant `events`. Read one space's event log by cursor, as event-list returns it.
interface events {
  use types.{json, host-error};
  %list: func(space: option<string>, after: option<string>, limit: u32) -> result<json, host-error>;
}

/// Grant `clock`. The command context's clock, in epoch milliseconds; recorded on the tape.
interface clock {
  now: func() -> s64;
}

/// Grant `random`. The command context's random source, in [0, 1); recorded on the tape.
interface random {
  next: func() -> f64;
}

/// What a component provides: one entry point for every command it declares.
interface command {
  use types.{json, call-context};
  /// Returns an AFD CommandResult as JSON.
  execute: func(name: string, input: json, context: call-context) -> json;
}

world plugin {
  import config;
  import log;
  import packs;
  import events;
  import clock;
  import random;
  import call;
  export command;
}
```

**Why a `call` interface rather than a field of `call-context` (D190).** `call-context` is the parameter of
`command.execute`, the one export. Adding a field changes `execute`'s signature, which phase 1's section 3 makes a
major version. An import is additive: a 1.0.0 component never sees it, and a 1.1.0 component calls it only if it wants
the budget. Later per-call facts (the `spaces` list, an attestation) can be added to `call` as functions in later minor
versions without touching the export.

**`call` needs no grant.** It returns a number about the caller's own call, which AFD already enforces on the result
and a compiled plugin already reads (`CallContext::output_budget`). It names no space, principal or data.

## 3. How the host serves both worlds (D190)

1. **Two sets of bindings.** `src/plugins/component/state.rs` keeps the 1.0.0 `bindgen!` module, renamed
   `bindings_1_0`, and adds `bindings_1_1` from `wit/umbel-plugin-1.1.0`. `CallState` implements both sets of host
   traits. The 1.0.0 implementations do not change, including `wit_error`'s mapping of any other `HostError` to
   `invalid(<text>)` (phase 2 review D8).
2. **Both linked, exact names first.** `add_world_to_linker` adds the whole 1.0.0 world, then from 1.1.0 only the
   interfaces that differ: `types`, `packs`, `events` and the new `call`, each through its own generated
   `add_to_linker`. `CallState` implements the 1.0.0 traits and those four 1.1.0 traits; the 1.1.0 `config`, `log`,
   `clock` and `random` traits are generated and unused. wasmtime 48 resolves an import by its exact name first and
   only then by a semver-compatible alternate (`NameMap::get`; the alternate for the `@1` track is the highest version
   defined). So a 1.0.0 component's `umbel:plugin/packs@1.0.0` binds to the frozen 1.0.0 implementation and its
   four-case `host-error`; a 1.1.0 component's `packs@1.1.0` binds to the new one; and a 1.1.0 component's
   `config@1.1.0`, identical in both worlds, resolves through the alternate to `config@1.0.0`. One edge: an import
   at `packs@1.0.x` with x > 0 would resolve to 1.1.0 and fail its type check; no such version exists or will.
3. **The export.** `call.rs` calls `command.execute` dynamically through the export the analysis found. Its
   parameter types are the same in both worlds (`call-context` is unchanged), so one typed function serves
   `umbel:plugin/command@1.0.0` and `@1.1.0`.
4. **The analysis.** `src/plugins/component/analyze.rs`: `KNOWN_MINOR` becomes `1`. The export's minor version is
   checked as the imports' are (today only its major is): an export newer than `1.1` is
   `PLUGIN_PROTOCOL_UNSUPPORTED`. `umbel_grant("call")` is `Some(None)`, an interface that needs no grant. The export's
   minor version is used for section 4's budget check inside `check`; it is not stored in `Analysis`, since nothing
   else reads it (amended by step 2).
5. **The budget a component sees.** `CallState` gains `output_budget: Option<u64>`, set in `call.rs` from the
   `call_context` it already builds (`src/plugins/compiled.rs`, `output_budget: context.output_budget()`).
   `call::Host::output_budget` returns it. A component call has a fresh store per call, so the value is that call's.
6. **The 1.1.0 error mapping.** `wit_error_1_1` maps `NotGranted`, `NotFound`, `Invalid` and `TooLarge` as 1.0.0
   does, and `Conflict { current }`, `Busy`, `Corrupt` and `Io` to their cases. Every other variant (the memory
   variants, `QueryTooBroad`) becomes `invalid(<text>)`: no component holds a grant whose service returns one.
7. **Constants.** `WIT_WORLD` (`src/plugins/mod.rs`) becomes `"umbel:plugin/plugin@1.1.0"`, the newest world the host
   serves; `workspace-show`'s `versions.wit` reports it. `PLUGIN_PROTOCOL_VERSION`, `MANIFEST_VERSION` and
   `MANIFEST_VERSIONS` do not change. The missing-export message names world 1.1.0 and `umbel-sdk`'s
   `export_component!`.

## 4. The output budget on a component (D190)

- **The manifest.** `output_budget` on a component plugin's command is no longer refused by `manifest.rs`'s
  `output_budget`. The rest of its checks hold (manifest version 2 or later, both keys, `default_bytes` no more than
  `max_bytes`).
- **At load, the world must carry it.** `analyze::check` takes `budgeted: bool`, true when any of the manifest's
  commands declares `output_budget`. A budgeted component whose export is `umbel:plugin/command@1.0.x` fails with
  `PLUGIN_PROTOCOL_UNSUPPORTED`: the message names the export and says a command declares `output_budget`, which
  needs world 1.1.0; the suggestion is to rebuild with `umbel-sdk` (which targets 1.1.0) or remove `output_budget`.
  Both callers pass it: `component::check` (`plugin-check`) and `ComponentRuntime::load` (`seal`).
- **The schemas.** The rule in each of `schemas/plugin-manifest.v2.json` to `v6.json` that refuses `output_budget`
  on a component command is removed in place, and the `output_budget` description says a component's needs world
  1.1.0. The schemas mirror the host's rules (`tests/schemas.rs` holds each to refuse what the host refuses), the
  change only admits more, and the unit is unpublished; a new manifest version for one relaxed kind rule would copy a
  schema to say nothing new. A schema cannot see the component's world, so that check stays the loader's.
- **Not required to import `call`.** A 1.1.0 component that never reads its budget still loads. AFD's backstop still
  refuses a result over the budget (phase 2, 8.6), as it does for a compiled command that ignores its budget.
- **Mounted tools** still declare no budget: they have no manifest command entries.

## 5. The SDK (D190)

- `sdk/src/component.rs` generates the 1.1.0 bindings. `run` fills `CallContext::output_budget` from
  `call::output_budget()`, read once per call. Every component built with `umbel-sdk` therefore exports
  `umbel:plugin/command@1.1.0` and imports `umbel:plugin/call@1.1.0` and `types@1.1.0`, and loads only on a host that
  serves 1.1.0. `umbel-sdk` is unpublished (`publish = false`) and versioned with the host, so no released host is left
  behind.
- `host_error` maps the four new cases to `HostError::Conflict { current }`, `Busy`, `Corrupt` and `Io`.
- The doc comments that say a component never sees a budget, or that the budget is for compiled plugins only, are
  corrected (`sdk/src/cx.rs`'s `CallContext::output_budget`, `HostError`).
- A component built against 1.0.0 by hand, or with an older SDK, keeps loading and keeps its four-case `host-error`.
  The fixtures in `tests/fixtures/components/` stay on 1.0.0 to prove it (section 9).

## 6. Manifest rules for component commands, and the messages (D191)

| Key or grant on a component | Before | After |
| --- | --- | --- |
| `output_budget` | `PLUGIN_MANIFEST_INVALID`, naming world 1.1.0 | Admitted; the component must export world 1.1.0 (section 4) |
| `journal` (`plain` or `digest`) | `PLUGIN_MANIFEST_INVALID`, naming world 1.1.0 | Still refused (section 1). The message says whether a sandboxed component may choose how the journal records its calls is not decided, naming no world. The schemas keep their rule |
| `authority_prompt` | `PLUGIN_MANIFEST_INVALID`, naming world 1.1.0 | Still refused: it is for memory writes, which a component cannot make. The message says a component holds no memory grant, naming no world |
| `confirm_preview` | `PLUGIN_MANIFEST_INVALID`, naming world 1.1.0 because a preview declares a journal | Still refused, for the same reason; the message names no world |
| Store grants, `memory`, `memory_write` | `PLUGIN_GRANT_UNAVAILABLE` naming world 1.1.0 (loader and doctor) | Still refused. The message says components hold no store grant in plugin protocol 1 yet, and that a later minor version of world 1 decides it; it names no version |

`src/plugins/manifest.rs`, `src/plugins/manifest/v4.rs`, `src/plugins/loader.rs` and `src/plugins/doctor.rs` carry these
messages; the tests that assert "1.1.0" in them (`tests/manifest_v2.rs`, `tests/doctor_plugins.rs`,
`src/plugins/loader.rs`'s own test) are updated to the new wording. The schemas change only for `output_budget`
(section 4).

## 7. What D2 needs that is not the world's

The `components` plugin's component build (#1155) is the plugin's own change and needs no host change beyond this
world, but its manifest and source do:

- **`random`.** ~~`src/brief.rs`, `src/select.rs` and `src/pack/mod.rs` use `HashMap` and `HashSet`, whose
  `RandomState` makes the component import `wasi:random/insecure-seed`, which needs the `random` grant (phase 1,
  section 4; `analyze.rs`'s `wasi_grant`). D2 either declares `random` in the component manifest (amending D151's
  grant list) or uses `BTreeMap` and `BTreeSet`.~~ Corrected 2026-11-17 by D2 itself (D198, components
  specification A29). `BTreeMap` alone does not remove the import: `regex-automata`'s map of capture names, reached
  through `regex`, seeds from it too. Rust's standard library also imports `wasi:clocks/monotonic-clock`. So the
  component manifest declares `random` (amending D151's grant list) and `clock`, and the source keeps its maps.
- **`journal`.** The owner answered (D195): the deployer sets it in `umbel.toml`, built in
  [#1382](https://github.com/lushly-dev/afd/issues/1382) by the [component journal specification](component-journal.spec.md)
  (`[plugins.<id>.journal]`, added to configuration version 7). Until then, a component manifest beside the compiled one, as
  hello keeps `manifests/component.toml`, declares no `journal`, so the journal records its calls as it records any
  plain command, input and result included.
- **Pack checks.** The doctor's `plugins.pack_checks` reaches compiled plugins only (components specification, A23).

## 8. What stays with the owner

> **Answered 2026-11-16 by the owner** (D192 to D195), each as recommended on #1364: (1) the first store reads a
> component gets are read-only `documents` and `index`, in world 1.2.0, when a component first needs them
> ([#1381](https://github.com/lushly-dev/afd/issues/1381)); (2) no write grant for components in protocol 1; (3) if
> components ever write memory, the host masks, never the component; (4) the deployer, not the component's author,
> chooses a component instance's journal mode in `umbel.toml` ([#1382](https://github.com/lushly-dev/afd/issues/1382)).
> Nothing below changes until those are built.

Store grants for components, the masking of their writes and a component's `journal` stay refused, as today, until
the owner decides them (#1364's thread carries the questions). Each would let a sandboxed, untrusted component read or write
what today only trusted, compiled code may (D42). When decided, they become a further minor version of world 1 with
its own specification, and these questions frame it:

1. Which store reads a component may hold (`content`, `documents`, `index`, `graph`, `records`, `memory`), under the
   caller's reader filter as compiled plugins do.
2. Whether a component may hold any write grant, and `memory_write` in particular.
3. If `memory_write`: how the host, not the component, masks the text before it is stored (phase 3, 6.2 item 4).
4. Whether a component's manifest may choose `journal = { mode = "digest" }`, so that the deployer's journal keeps
   no result data of its calls, or whether the deployer should choose it in `umbel.toml`.

## 9. Tests

| Test | Proves |
| --- | --- |
| `tests/schemas.rs` | `wit/umbel-plugin-1.1.0/world.wit` starts with `package umbel:plugin@1.1.0;` and is the file section 2 prints; `WIT_WORLD` is 1.1.0; `wit/umbel-plugin-1.0.0/world.wit` is byte-identical to its 1.0.0 content (a pinned SHA-256); the version 2 schema now admits `output_budget` on a component command |
| `tests/plugin_component.rs` | hello, built with `umbel-sdk`, exports `command@1.1.0`, and its pinned import list moves to `@1.1.0` and gains `umbel:plugin/call@1.1.0`; the 1.0.0 fixtures (`behaviors`, `imports`, `sockets`) load and run unchanged; the `future` fixture (2.0.0) is still refused |
| `tests/plugin_component.rs` (budget) | A new fixture `tests/fixtures/components/budget/`, built with `umbel-sdk` and `export_component!`, answers `cx.call().output_budget` as data; declared with `output_budget = { default_bytes = 100, max_bytes = 200 }`, it reads 100 with no ask, the caller's ask of 150, and 200 for an ask of 500; without a declaration it reads none |
| `tests/plugin_component.rs` (world check) | The `imports` fixture (world 1.0.0) with a budgeted command is refused at seal with `PLUGIN_PROTOCOL_UNSUPPORTED` naming `output_budget`, the command and its `command@1.0.0` export. `plugin-check` runs the same `analyze::check` |
| `tests/plugin_commands.rs` | `workspace-show`'s `versions.wit` is 1.1.0 |
| `src/plugins/component/state.rs` unit tests | `wit_error_1_1` maps the eight cases by name and the memory variants to `invalid`; `wit_error` (1.0.0) still maps all four new ones to `invalid` |
| `src/plugins/component/analyze.rs` unit tests | `call` needs no grant |
| `tests/manifest_v2.rs` | A component command admits `output_budget`, with the same key checks as a compiled one |
| `tests/manifest_v3.rs`, `tests/manifest_v4.rs`, `tests/schemas/phase4.rs` | `journal`, `authority_prompt` and `confirm_preview` are still refused on a component command, and the messages name no world |
| `tests/doctor_plugins.rs`, `src/plugins/loader.rs` | A store grant on a component is still `PLUGIN_GRANT_UNAVAILABLE`, naming a later minor version of world 1 and no version |

The budget fixture is a host test file under `tests/`, not a plugin crate, so the plugin-isolation gate is not
crossed. Like hello, it builds the component only with its own `component` feature, so a workspace build does not
unify the SDK's `component` feature into the host's. It joins the fixture build and clippy lists in
`tests/support/components.rs`, `umbel.yml` (both legs) and `scripts/affected/suites.mjs`, and `Cargo.lock`. The
`plugin new` component template (`src/templates/component/lib.rs.tmpl`), the README and the architecture name world
1.1.0 where they named 1.0.0 for what the SDK builds.

## 10. Implementation plan

1. **This specification**, with D189 to D191 in the decision log, STATUS, and a note on each specification that named
   world 1.1.0 (phase 1 section 4, phase 2 section 3.3, phase 3 sections 6.1 and 6.2, the components specification's
   W17). Documents only.
2. **The world, the host and the SDK**, sections 2 to 7 and 9, in one pull request that touches `wit/`, `src/`,
   `sdk/` and `tests/`, and no plugin crate (the plugin-isolation gate). Unblocks #1155.
3. **D2 itself** (#1155) is the components plugin's own pull request: it builds the plugin with
   `export_component!` and needs no host change, with section 7's `random` and `journal` points settled in it.

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-16 | This specification | Store reads for components, write grants and `memory_write` with host-side masking (section 8): the owner's decision, then a later minor version of world 1 | Open, the owner's |
| 2026-11-16 | This specification | `spaces` on `call` for a component command with a `spaces` input (the SDK fills it from `space` today) | Open, the first component command with a `spaces` input |
| 2026-11-16 | This specification | `plugins/hello/src/lib.rs` says its build exports world 1.0.0; with the SDK on 1.1.0 it exports 1.1.0. A plugin file, so not in step 2's pull request | Open, the next pull request that touches hello |
