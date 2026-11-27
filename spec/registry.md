# Contract registry

The AFD contract is a **core** that every implementation carries and a set of optional, versioned
**profiles**, which an implementation may claim one by one. This page says what belongs to each.
[`registry.json`](./registry.json) is the machine-readable copy and the one source: it names each
owner's pages, vectors, fixtures, conformance cases, error codes and capabilities.
`node scripts/check-spec-registry.mjs`, which `pnpm check` runs, keeps it complete.

The owner decided the split on 2026-11-21 (AR1, AR2 and AR3 in the
[architecture review's decisions](../docs/features/active/architecture-review/decisions.md)) and the
list of profiles on 2026-11-27 (AR4).

## The core

The core is result, errors, dispatch, validation, batch, pipeline, exposure and the meta-tools. An
implementation of AFD implements all of it. Its version is [`VERSION`](./VERSION), and
[`CHANGELOG.md`](./CHANGELOG.md) says how it changes.

| Part | Pages | Vectors and fixtures |
| --- | --- | --- |
| Result and errors | [error codes](./error-codes.md), [recovery](./recovery.md) | `schema/result.json`, `schema/error.json`, the `wire/result-*.json` fixtures, `vectors/error-codes.json`, `vectors/recovery.json` |
| Dispatch | [dispatch](./dispatch.md), [execution controls](./execution-controls.md), [context fields](./context-fields.md) | `vectors/dispatch.json`, `vectors/execution-controls.json`, the dispatch id in `vectors/journal-seams.json` |
| Validation | [validation](./validation.md) | `vectors/validation.json` |
| Batch and pipeline | [pipeline variables](./pipeline-variables.md) | `schema/batch.json`, `schema/pipeline.json`, `wire/batch-result.json`, `wire/pipeline-result.json`, `vectors/batch-controls.json`, `vectors/pipeline-variables.json` |
| Exposure and the meta-tools | [command metadata](./command-metadata.md), [MCP tools](./mcp-tools.md), [tool strategies](./tool-strategies.md), [protocol conformance](./protocol-conformance.md) | `meta-tools.json`, `schema/output-envelope.json`, `vectors/output-schema.json`, `vectors/tool-strategies.json`, the `toolMetaKeys` of `vectors/mcp-resources.json`, `protocol-conformance.json` |

Owning a rule and requiring it are kept apart. A profile owns the pages, cases and error codes that
specify it, but the core may require any implementation to act on one of them:

- **Error-code constants.** Every implementation defines all the shared constants, a profile's
  included ([error codes](./error-codes.md#the-shared-catalog)). An implementation emits a profile's
  code where it implements that profile, and wherever a core rule says so.
- **Approvals fail closed.** A command that declares an `approval` policy other than `not-required`
  runs only when an approval step admitted the call. An implementation without the `approvals`
  profile has no approval step, so it refuses every such command with `APPROVAL_UNAVAILABLE`
  before the handler (dispatch rule 9 and the `approval-unavailable` case of
  [`vectors/dispatch.json`](./vectors/dispatch.json)). Accepting the `approval` field and holding
  the call are therefore the core's; asking a person and issuing tokens are the profile's.
- **Fields.** [Command metadata](./command-metadata.md#fields) lists every field. A field a
  profile acts on (`confirmPrompt` enforcement, `confirmationMode`, `task`, `scopes`,
  `outputBudget`, `idempotency`, `expose.apps`, `contexts`) is enforced only where that profile is
  implemented; `approval` is the exception above.
- **Dispatch.** The [dispatch order](./dispatch.md) places each profile's stage among the core's.
  An implementation without the profile skips that stage, except the approval admission check
  (stage 9), which every implementation runs.

## The profiles

A profile is optional. An implementation that claims one implements all of it; one that does not
claim it need not implement it, apart from what the core requires above. Each profile has its own
`MAJOR.MINOR` version, changed by the same rules as the core's (a minor version adds and breaks
nothing; a changed vector or fixture, or a removed or renamed field, is a major version). A server
advertises the core version and the profiles it has with `_meta["dev.afd/contract"]`
([#1927](https://github.com/lushly-dev/afd/issues/1927)).

<!-- generated:spec-registry:profiles:start -->
| Profile | Version | Applies to | Pages | Error codes |
| --- | --- | --- | --- | --- |
| `authorization` | 1.0 | A server that verifies bearer tokens on HTTP | [`authorization.md`](./authorization.md) | `INSUFFICIENT_SCOPE` |
| `tasks` | 1.0 | A server that serves the MCP Tasks extension | [`tasks.md`](./tasks.md) | `TASK_TOKEN_EXPIRED` |
| `output-budgets` | 1.0 | A command that declares a budget, or a call that asks for one | [`output-budgets.md`](./output-budgets.md) | `OUTPUT_BUDGET_EXCEEDED` |
| `approvals` | 1.0 | A server that runs an approval step for commands with an approval policy | [`approvals.md`](./approvals.md) | `APPROVAL_REQUIRED`, `APPROVAL_UNAVAILABLE` |
| `app-calls` | 1.0 | A registry given a callGrant for the apps interface | [`app-calls.md`](./app-calls.md) | `CALL_NOT_GRANTED` |
| `resources-and-skills` | 1.0 | A server given a resource provider or a skill catalog | [`mcp-resources.md`](./mcp-resources.md) | None |
| `plugin-manifest` | 1.0 | A host that reads or checks the shared plugin manifest | [`plugin-manifest.md`](./plugin-manifest.md) | None |
| `contexts` | 1.0 | A server configured with contexts | [`contexts.md`](./contexts.md) | `COMMAND_NOT_IN_CONTEXT`, `SESSION_REQUIRED`, `CONTEXT_NOT_FOUND`, `CONTEXT_DEPTH_EXCEEDED` |
| `streaming` | 1.0 | A command run as a stream of chunks | [`streaming.md`](./streaming.md) | `STREAM_ABORTED`, `STREAM_TIMEOUT`, `STREAM_ERROR`, `STREAM_ENDED_UNEXPECTEDLY`, `COMMAND_FAILED` |
| `confirmations` | 1.0 | A server that enforces confirmPrompt | [`confirmations.md`](./confirmations.md) | `CONFIRMATION_REQUIRED`, `CONFIRMATION_DECLINED` |
| `journal` | 1.0 | A host that records or replays a command journal | [`journal.md`](./journal.md) | None |
| `idempotency` | 1.0 | A command that declares idempotency, and an engine given the idempotency step | [`idempotency.md`](./idempotency.md) | `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `OUTCOME_UNKNOWN` |
| `http` | 1.0 | A server that serves MCP on Streamable HTTP | [`http.md`](./http.md) | None |
<!-- generated:spec-registry:profiles:end -->

Which languages implement the core and each profile is rendered, from the
[capability manifests](./capabilities/README.md), in the
[language parity matrix](../docs/language-parity.md#core-and-profiles). A language implements an
owner when every capability the registry assigns it is `yes` there, or `na` where it does not apply
to the language by design (a CLI OAuth client in a server-only crate). It implements the owner in
part when some capability is `yes` or `partial`.

## Loading the vectors

Today every language loads every file in [`vectors/`](./vectors/README.md#contract), profile files
included, and `alfred parity` checks it. A profile's vector file that some language does not load
sits beside `vectors/` instead (`authorization.json`, `authorization-client.json`,
`plugin-manifest.json`), and those profiles' own suites load it. Making the gate read this registry,
so that a language loads every core file and the files of each profile it implements wholly or in
part, wherever they sit, is [#2904](https://github.com/lushly-dev/afd/issues/2904). A language that
implements a profile in part loads its cases for the parts it has.

## What owns what

- **One owner per file.** Every file under `spec/` belongs to the core, to exactly one profile or,
  for the files that describe the contract rather than state it (this page, `registry.json`,
  `VERSION`, `CHANGELOG.md`, the READMEs, `capabilities/` and the vector generators), to neither.
- **Parts of a file.** A file whose sections or entries serve more than one owner keeps one owner,
  and `registry.json`'s `parts` assigns the sections and entries that are another's, by section name
  or by entry: the profile cases of the core's `vectors/dispatch.json` (out of context, approval
  required, confirmations) and `vectors/tool-strategies.json` (the contexts server and its
  context tools, the confirmation calls), the approval summary in `vectors/journal-seams.json`, the
  `toolMetaKeys` of `vectors/mcp-resources.json`, and the streaming cases and the `context_*` tests
  of `protocol-conformance.json`. Each part has one owner across every `parts` record. One loader
  reads each file. The core's dispatch and tool-strategy cases still run against a setup that
  configures contexts; making them independent of it is
  [#2904](https://github.com/lushly-dev/afd/issues/2904).
- **Shared cases.** Every profile has cases a language runs: a vector file, a fixture, conformance
  cases or a part of another owner's file. A profile without them names the issue that adds them
  in `pendingVectors`; `http` names [#2905](https://github.com/lushly-dev/afd/issues/2905).
- **Error codes.** Each shared code belongs to one owner, and its `profile` in
  [`vectors/error-codes.json`](./vectors/error-codes.json) says the same.
- **Capabilities.** Each capability ID in [`capabilities/catalog.json`](./capabilities/catalog.json)
  belongs to one owner, or is listed in `outsideContract` when it is a language's own tooling
  (constructors, clients, the CLI, application auth, UI packages).
- **Wording.** "Every implementation" is said only on the core's pages. A profile's page names its
  profile in its opening lines and speaks of the implementations that claim it.
- **Clock and random.** `context.clock` and `context.random` are the core's: the journal's tape
  records them, and the core's dispatch-id cases read them.

## Introducing a profile

A profile arrives in one pull request with all of these:

1. An entry in [`registry.json`](./registry.json): a kebab-case `id`, a `title`, its `version`
   (`1.0`), its `optIn` (the condition under which a server has it, which decides when a server
   advertises it), and what it owns.
2. Its page, which names the profile at the top.
3. Its shared cases, **specification-authored**, or format-generated where computing them by hand
   is infeasible ([vectors](./vectors/README.md#authored-vs-generated-vectors)); until they exist,
   the issue that adds them in `pendingVectors`. A profile's vectors
   never come from the output of the first language that implements it, so no implementation
   judges itself; the check refuses a legacy reference-generated file in a profile.
4. Its error codes in [`error-codes.md`](./error-codes.md) and
   [`vectors/error-codes.json`](./vectors/error-codes.json), with `profile` set, and a constant in
   every language.
5. Its capability IDs in [`capabilities/catalog.json`](./capabilities/catalog.json) and all four
   manifests.
6. A changeset fragment for the contract ([recording a change](./CHANGELOG.md#recording-a-change)).

A profile is named for what it is, never for the endpoint phase that first needed it. A rule that
starts as one host's need is written for any host, and the pull request that adds it names the
profile it joins, or proposes a new one.
