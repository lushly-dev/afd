# Umbel

AFD Umbel is an empty host for capability plugins, reachable over MCP and as
a CLI. It ships with no capability of its own; knowledge, memory, context,
tools and connectors arrive as plugins, some built here as examples and
first-party defaults, most built by the people who deploy it for their own
stack. One deployment can hold several isolated knowledge bases, called
spaces, that never mix by default. The frontier model calling it does the
reasoning; Umbel keeps that model informed, remembered and connected, with
every answer traceable to its source.

An umbel is an inflorescence in which every flower stalk rises from a single
point and none depends on another. That is the architecture.

## Status

Phase 0, the host skeleton, is done: the empty host serves MCP over stdio and
Streamable HTTP and a CLI from one registry, with a workspace, the journal and
its per-space event log, approvals and confirmations, and no plugins. Phase 1,
the plugin contract, is done too (its
[specification](docs/phases/1-plugin-contract/spec.md) is met): the host loads
compiled, component and mounted plugins, serves their packs and skills, and
scaffolds and checks them with `plugin new` and `plugin check`; the hello
plugin answers alike built all three ways, and the todo example's conformance
suite passes against it. Phase 2, knowledge, is done (its
[specification](docs/phases/2-knowledge/spec.md) is met, with the exit criterion in
`plugins/knowledge/tests/exit_thousand.rs`): the embedded SQLite and tantivy stores, the host
services (store grants with allow lists, reader filters), the `sources` plugin that reads files into
the stores, and the `knowledge` plugin (search, open, the structural graph, code symbols, proposals
and verification, the eval harness) are in, behind the `umbel-knowledge` binary. Its fixture is
synthetic with planted terms, so its recall measures the pipeline and regressions, not quality on
real content. Access filtering is exact only for embedders until phase 5
(see [below](#access-is-not-a-security-boundary-yet)). Nothing is released or published; the
crate is `publish = false` and its release unit is quarantined with no route under the
[platform migration](../../docs/features/active/platform-monorepo/) rules.
[STATUS.md](docs/STATUS.md) says exactly what is done.

## Build and run

Umbel needs Rust 1.97 or later (`rust-toolchain.toml` pins it) and builds
against the in-repository `afd` crate.

```sh
cd endpoints/umbel
cargo build --locked
cargo test --locked

# A workspace with one space, `main`.
./target/debug/umbel init ~/umbel-ws
cd ~/umbel-ws
umbel workspace doctor        # exits 0 with "healthy": true
umbel help                    # the commands the CLI can run
umbel workspace show

# MCP for a harness, over stdio (stdout carries only JSON-RPC).
umbel serve --stdio

# MCP over Streamable HTTP, loopback only. Every request needs the bearer
# token in state/keys/http.token; --print-token writes it to stdout.
umbel serve --http --bind 127.0.0.1:7410 --print-token
```

The workspace is found from `--workspace`, then `UMBEL_WORKSPACE`, then the
nearest `umbel.toml` upward. Several processes may use one workspace at once:
stdio servers from different harness sessions, an HTTP server and one-shot CLI
commands. The [phase 0 specification](docs/phases/0-host-skeleton/spec.md)
defines the configuration, commands, surfaces and shapes.

## Write a plugin

A plugin is a directory (or, for a compiled plugin, a crate) with one manifest, `umbel-plugin.toml`.
It runs one of four ways, which its `plugin.kind` names:

| Kind | What it is | Isolation |
| --- | --- | --- |
| `compiled` | A Rust crate linked into a host binary through `umbel-sdk` | None: it runs with the host's permissions, and its grants are a declaration |
| `component` | The same source built as a WebAssembly component for `wasm32-wasip2` | A sandbox: no network, files or environment; only the interfaces its grants allow; fuel, time and memory limits per call |
| `mounted` | An external MCP server the host starts over stdio (or reaches over HTTP), its tools renamed under a prefix | A separate process with a cleared environment; no caller credential ever reaches it |
| `pack` | Content only: packs and skills, no code | Not applicable |

Scaffold one, check it, and read the manifest it writes:

```sh
umbel plugin new kind=component id=notes dir=notes   # compiled | component | mounted | pack
cd notes && cargo test                               # the plugin through the test kit
cargo build --release --target wasm32-wasip2 --features component
cp target/wasm32-wasip2/release/umbel_plugin_notes.wasm notes.wasm
umbel plugin check path=.                            # the manifest, grants, schemas, packs, skills,
                                                     # config, the component's imports, and a boot
```

`plugin new` refuses a directory that is not empty. A compiled or component crate depends on
`umbel-sdk` and, for its tests, on `umbel` with the `testkit` feature; the scaffold names them by git,
and `umbel_path=<checkout of endpoints/umbel>` names them by path instead. It also copies the
host's toolchain pin, so the crate builds with the compiler the host does.

**The manifest** holds the plugin's identity and kind, its `domains` (the first name segment of its
commands), `[[commands]]` with their JSON Schemas and `effects`, `[[packs]]`, `[[skills]]`, an
optional `[config]` schema, and `[[grants]]`. Commands are named `domain-action`. `effects` is
`inspect` (changes nothing) or `plugin-state` and `external` (change something, so the host writes an
event). A mounted plugin declares `[mount]` instead of commands: its tools come from the server, and
`[[mount.tools]]` says what each really does. The
[specification](docs/phases/1-plugin-contract/spec.md#2-the-manifest) is normative.

**Grants** are the host services a plugin may use: `config`, `log`, `packs`, `events`, `clock` and
`random`. Declare each with a `reason`; the deployer sees the reasons and may deny an optional grant.
A component imports a service only when its code calls it, and the host refuses an import its
manifest has no grant for: `plugin check` names the grant to add. A compiled plugin's grants are a
declaration and not a sandbox. Mounted and pack plugins declare none.

**Building a component.** `umbel-sdk`'s `export_component!` exports the WIT world
`umbel:plugin/plugin@1.0.0` from the same `Plugin` implementation the tests run as a compiled
plugin. Build with `--target wasm32-wasip2 --features component`; the toolchain file the scaffold
writes already names the target. A component keeps no state between calls and reads time and
randomness only through `Cx`. Random bytes are written to the journal, so never use them for keys.

**Mounting a server.** Any MCP server over stdio works; AFD's TypeScript (`@lushly-dev/afd-server`),
Python (`afd` with FastMCP) and Rust (`afd` with its `server` feature, or `umbel-sdk`'s
`serve_mounted`) servers all do. `umbel plugin check path=<dir>` reads the manifest and does not
start the server. `spawn=true` starts it, lists its tools and reports what mounts, what was skipped
and which descriptions match the `description-injection` rule. It runs the plugin's own program, so
it is off unless you ask for it.

**The test kit.** `umbel::testkit::TestHost` (feature `testkit`) boots an in-process host with only
your plugin and a fixed clock, with `call`, `mcp`, `http`, `cli` and `replay`; the scaffold's
`tests/plugin.rs` is a working example. [`plugins/hello`](plugins/hello) is the reference plugin:
one command, one pack and one skill, built compiled, as a component and mounted.

**Reading files into the stores.** [`plugins/sources-filesystem`](plugins/sources-filesystem) is the
first plugin that fills the document store (its id is `sources`, so enable `compiled:sources`). It
reads the markdown and code files of the collections a space declares in `umbel.toml` (version 3),
with `sources-sync` and `sources-status`. Changes are found by content hash; a symbolic link inside
a root is never followed; a file over `max_file_bytes` or with malformed frontmatter is skipped and
counted, not guessed at. Its results give totals for every file and the ids of the documents the
caller can read, and only a person at the command line also gets paths. Content that looks like
instructions or hides text is flagged and stored, never blocked. It needs the write grants
`documents_write` and `records_write` allowed for the space in `umbel.toml`, as the plugin's
tests show.

**Searching them.** [`plugins/knowledge`](plugins/knowledge) is the second, `compiled:knowledge`:
`knowledge-index` brings a space's search index up to date, `knowledge-search` is fielded BM25 over
the documents the caller may read (terms, phrases, `+`/`-`, `AND`/`OR`/`NOT`, `field:term`,
`term^boost`, `prefix*`), and `knowledge-open`, `knowledge-find`, `knowledge-describe`,
`knowledge-list` and `knowledge-changes` read them back. The pipeline `knowledge-refresh` runs the
sync and then the index. Every part of a result that came from a document is labeled `trust:
"content"`: it is data to read, never instructions. Results are fitted to a per-command output
budget (fewer hits, a shorter window, and a warning that says so). The `umbel-knowledge` binary is
the `umbel` command line with `sources` and `knowledge` compiled in (the stock `umbel` binary
compiles in no plugin); enable both with `plugins.enabled = ["sources", "knowledge"]`, and allow
`index_write`, `graph_write` and `records_write` for the space
(`[plugins.knowledge.grants.index_write] allow = ["main"]`, and the same under `graph_write` and
`records_write`). `knowledge-index` also builds the structural graph (the directory hierarchy,
headings, links and backlinks, tags, owners, supersession and co-citation); `knowledge-search`
expands along it, and `knowledge-neighbors`, `-related`, `-path`, `-outline` and `-stale` read it,
all only over the documents the caller can read.

**Changing them by proposal.** The knowledge base changes only by proposal. `knowledge-propose`
(create, update, deprecate or verify a document, with a rationale and evidence) stores a decision
trace and changes nothing; `knowledge-proposal-list` and `knowledge-proposal-show` read it. A person
at a terminal decides: `knowledge-approve` writes the file and the document, `knowledge-reject`
records a reason, and `knowledge-verify` attests a document. Those three run only on the command
line, at a terminal, and are never reached from MCP or an agent. Declare who approves what as
areas (`[plugins.knowledge.config.areas.<id>]` with `space`, `collection`, an optional `prefix`,
`approvers` as `principal:human:<id>` or `group:<id>` entries, and `allow_self_approval`); an area
is required for a document to be proposed. To apply a proposal the instance also needs
`documents_write` and `content_write` allowed for the collection. An approved document is searchable
after the next `knowledge-refresh`.

`knowledge-propose-batch` submits up to 50 proposals in one call, with a result for each. Called as a
step of a drafter's pipeline (the curator's `curator-run`, from phase 4), the host attests the drafter,
and the knowledge instance accepts it only when its configuration lists that instance as
`[plugins.knowledge.config.drafters.<instance>]` (default none), with the target its creates go to in each
space: a markdown `collection` and an optional `prefix` of plain segments. A drafted create must be exactly
`<collection>/<prefix>/<derived id>`; a drafter with no target in a space drafts no create there. The
drafter's own configuration names the same target, and the knowledge instance's is the one enforced. A drafter's claims are verified, not trusted: through its read-only `memory`
grant, under the caller's reader filter, the knowledge instance reads every memory record a draft
cites and checks that it is live, at the cited version, and copied field by field, and that the
content, rationale, candidate, key and document id are the curator's fixed rendering and derivations
of those records; a mismatch is `PROPOSAL_DRAFT_MISMATCH`, naming the check, and nothing is stored.
`knowledge-approve` reads the sources again: a source gone is `PROPOSAL_SOURCE_GONE`, a target now
wider than its sources is `PROPOSAL_ACCESS_WIDENED`, and approving a draft of your own memory is
self-approval. The `memory` grant needs no `allow` list; deny it (`deny = ["memory"]` under
`[plugins.knowledge]`) and memory-derived drafts are refused with `PROPOSAL_DRAFT_UNVERIFIABLE`. The
same pipeline withdraws its own drafts, and redacts one whose memory source was forgotten, and reads
the decisions on them with `knowledge-proposal-feed`.

**Auto-approval, off by default.** One kind of proposal may be applied without a person, and only in an
area whose deployer lists it: `auto = ["deprecate-declared"]` under `[plugins.knowledge.config.areas.<id>]`
(default `[]`; any other value fails the configuration). `knowledge-auto-approve` (command line only, a
prompt that `--yes` answers from cron, never as a pipeline step) then applies each pending drafted
`deprecate` of that area whose `supersededBy` equals the document's `superseded_by`, when a person's
applied `create` or `update` wrote that declaration into the document's current bytes (its diff added
the line) and the successor is a document every reader of the deprecated one can read and that is not
itself deprecated. A `superseded_by` typed into a file, or carried through a later edit or verification,
never triggers it, and no `create`, `update`, `verify`, memory-derived, flagged or alternative proposal is
ever applied this way. The record says `decision.channel = "policy"`, decided by `policy:<area>` for the
principal who ran it; the caller must be one of the area's approvers.

`plugin check` does not run AFD's surface validation, which is a TypeScript tool: run `afd validate
--surface` against `umbel serve --http` with the plugin enabled.

## Run the knowledge plugin

`umbel-knowledge` is the `umbel` command line with the `sources` and `knowledge` plugins compiled in
(the stock `umbel` compiles in none). Enabling them is not enough: each plugin's write grants need an
explicit `allow` list in `umbel.toml`: a plugin whose required grant has none does not load
(`PLUGIN_GRANT_DENIED`, naming the grant and the line to add). The ones that matter, and who needs them:

| Grant | Plugin | Needed for | `allow` entries |
| --- | --- | --- | --- |
| `documents_write` | `sources` | `sources-sync` (reading files into the document store) | `<space>/<collection>` or `<space>/*` |
| `records_write` | `sources` | `sources-sync` (its bookkeeping records) | `<space>` or `*` |
| `index_write` | `knowledge` | `knowledge-index` | `<space>` or `*` |
| `graph_write` | `knowledge` | `knowledge-index` (the structural graph) | `<space>` or `*` |
| `records_write` | `knowledge` | `knowledge-propose` and every proposal state | `<space>` or `*` |
| `documents_write` | `knowledge` | applying a proposal with `knowledge-approve` | `<space>/<collection>` or `<space>/*` |
| `content_write` | `knowledge` | applying a proposal (it writes the file) | `<space>/<collection>` or `<space>/*` |

The first five are required. The last two are optional and only for applying proposals; without
them the workspace loads and an approval is recorded, then stops with `PROPOSAL_APPLY_UNAVAILABLE`.
`knowledge` also declares `memory`, read only and optional, to verify drafted proposals; a read grant
needs no `allow` entry, so the file below is unchanged by it. A proposal also needs an *area* that says who may approve changes to
a collection. This `umbel.toml` runs everything (a workspace made with `umbel-knowledge init
~/umbel-ws` starts with only `config_version = 3`; add the rest):

```toml
config_version = 3
default_space = "main"

# The person at this machine's command line is human:ada; their agents are agent:ada.
[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.main.collections.handbook]
root = "spaces/main/handbook"          # inside the workspace, or an absolute path

[spaces.main.collections.code]
root = "spaces/main/src"
kind = "code"                           # indexed by symbol (Rust, Python, TypeScript, JavaScript)

[plugins]
enabled = ["sources", "knowledge"]

[plugins.sources]
source = "compiled:sources"

[plugins.sources.grants.documents_write]
allow = ["main/*"]
[plugins.sources.grants.records_write]
allow = ["main"]

[plugins.knowledge]
source = "compiled:knowledge"

[plugins.knowledge.grants.index_write]
allow = ["main"]
[plugins.knowledge.grants.graph_write]
allow = ["main"]
[plugins.knowledge.grants.records_write]
allow = ["main"]
[plugins.knowledge.grants.documents_write]
allow = ["main/*"]
[plugins.knowledge.grants.content_write]
allow = ["main/*"]

# Who may approve a change to the handbook.
[plugins.knowledge.config.areas.handbook]
space = "main"
collection = "handbook"
approvers = ["principal:human:ada"]
allow_self_approval = true              # a one-person workspace; leave it out otherwise

# Drafted proposals (phase 4): accept the curator's pipeline, and send its creates in the space
# main exactly to handbook/learned/<derived id>. The curator's own configuration names the same
# target; this one is enforced. Leave it out if you run no curator.
[plugins.knowledge.config.drafters.curator.targets.main]
collection = "handbook"
prefix = "learned"
```

Then put Markdown under `spaces/main/handbook` and source files under `spaces/main/src`, and:

```sh
cd ~/umbel-ws
umbel-knowledge workspace doctor                       # "healthy": true
umbel-knowledge call knowledge-refresh '{}'            # read the files, then build the index and graph
umbel-knowledge call knowledge-search '{"query": "deploy checklist"}'
umbel-knowledge call knowledge-open '{"doc": "handbook/deploy"}'
umbel-knowledge call knowledge-propose '{"idempotency_key": "k1", "rationale": "why",
  "evidence": [{"kind": "text", "ref": "where it came from"}],
  "change": {"op": "create", "doc": "handbook/monitoring", "content": "# Monitoring\n..."}}'
umbel-knowledge call knowledge-proposal-show '{"proposal": "p-..."}'   # the whole diff and the flags
umbel-knowledge call knowledge-approve '{"proposal": "p-..."}'         # a terminal: a preview, two prompts
umbel-knowledge call knowledge-refresh '{}'            # the approved file is searchable again
umbel-knowledge serve --stdio                          # the same commands to a harness over MCP
```

`knowledge-approve` asks twice at a terminal (the plugin's confirmation, then AFD's approval). Before
the first prompt it shows `knowledge-proposal-preview`: the proposal's id, op, document, area, change
hash, flags and evidence, and the first 80 lines of its diff, each line prefixed `> `
(`knowledge-reject` shows it too). `knowledge-proposal-show` has the whole diff. It refuses without a
terminal and to `--yes` or `--approve`, and refuses with `CONFIRMATION_PREVIEW_FAILED` when the
preview cannot be shown, such as for a proposal you may not read.

## Access is not a security boundary yet

Phase 2 gives every document, chunk, node and edge an access set and turns the caller's principal
into a reader filter that every store query applies before ranking; a space's `readers` decide who
may open it at all (`SPACE_NOT_READABLE`). That filtering is **exact only for embedders and
tests**, who set the principal themselves. Until phase 5 verifies callers, nothing vouches for who
is on the other end of stdio or loopback HTTP: every stdio caller is the one principal
`agent:<principal.local_id>` (acting for `principal.on_behalf_of` when you set it), every HTTP
caller is `agent:loopback`, and the CLI is always `human:<principal.local_id>`. So on those
surfaces access is a policy, not a boundary, and it protects nothing a local process could not
read from the files. To make one person's CLI and that person's agents line up, set
`principal.local_id` and `principal.on_behalf_of` to the same id. `workspace-show` reports this as
`access: { principals: "unverified", exact: ["library"] }` until phase 5 changes it. Hidden
content and ids are never returned, but hidden counts are not fully hidden: scores, revision and
`seq` gaps, `store-show`'s head and the totals of index-building commands can reveal how many
hidden things exist (an accepted limit, listed in the specification's section 6).

A plugin's write grants (`content_write`, `documents_write`, `records_write`, `index_write`,
`graph_write`) are not given by enabling it: each needs `[plugins.<id>.grants.<grant>] allow =
[...]` in `umbel.toml` (`<space>/<collection>` or `<space>/*` for files and documents, `<space>`
or `*` for the rest). A compiled plugin's store grants are trusted code, not a sandbox, and a
command marked `confirm = "require-human"` runs only when a person answers its prompt at a
terminal: `--yes` and `--approve` do not count, and MCP and agents never reach it.

**Memory (phase 3) follows the same rules, and its own.** The `memory` grant reads a space's memory
store under the caller's reader filter; `memory_write` needs an allow list, and its table also takes
`default_access` (`private` unless you set `space`), `writers` and `agents_may_share`. Every record is
private to its principal unless a person, or a listed writer, shares it, and a captured transcript is
always private. The host, not the plugin, fills a record's owner, agent and **authority**: `person`
only for a human through the library, or for a person at a terminal who answered the command's
`authority_prompt` yes; `tool` for the CLI without that answer (a script, `--yes`, `--approve`, input
read with `@-`, or an agent variable such as `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT` or one
you list in `principal.agent_env`); `agent` for every other caller. **That is a terminal check, not an
attestation**: a process that runs the CLI in a pseudo-terminal with those variables removed passes
it, and phase 5 replaces it. Session start pushes only `person` records by default, and that default
rests on this check. A stdio agent and its person are one principal only when `on_behalf_of` equals
`local_id`; streamable HTTP is `agent:loopback`, so a person mixing HTTP with the CLI shares
remembered facts with `default_access = "space"`, and captured episodes stay readable only from the
principal that captured them. Memory commands are journaled as digests (no text, no result data), so
the journal never holds what a forget removes; text an agent copies into another command is
journaled as it is. Each record is sealed under its own key in `memory.keys`: losing that file loses
all memory, `store-backup` never copies it (back it up yourself, after the database copy), a copy of
it taken before a forget brings the record back, and a file-level copy of `memory.sqlite3` holds
every live record's text in clear in its index. On macOS both files are kept out of Time Machine
unless `store.exclude_memory_from_machine_backup = false`. Before phase 5 all of this, like access
above, is exact only for embedders and tests, and local same-user processes can read everything.

## Documents

Read [STATUS.md](docs/STATUS.md) first: it says exactly what is done, what
is not, and what future sessions must know. No agent should have to scan the
codebase to learn what is current.

| Document | Purpose |
| --- | --- |
| [Status](docs/STATUS.md) | Source of truth for progress: document and phase state, exact done and not-done lists, follow-ups not yet issues, session log |
| [Architecture](docs/architecture.md) | The through line: vision, principles, system shape, components, interfaces, libraries and phases. Each phase's owning agent writes a detailed specification against it |
| [Proposal](docs/proposal.md) | What Umbel is, the plugin contract, first-party plugins, scale profiles, open decisions and the first proof |
| [Decision log](docs/decisions.md) | Dated decisions each phase specification cites |
| [Trajectory watch](docs/trajectory.md) | Where the protocol, harnesses and enterprise context are heading, what Umbel reserves for each, and the dated watchlist |
| [Research](docs/research.md) | Synthesis of public sources on agent memory, retrieval and the MCP stack |
| [Sources](docs/sources.md) | Annotated source ledger with dates and inference limits |

The feature index in [docs/features](../../docs/features/README.md) lists Umbel
under proposed features and points here.
