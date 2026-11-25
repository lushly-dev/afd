# Violet in Loam: the first app of a local Loam

## Status

- **State:** complete — approved by the owner on 2026-11-16, with every recommendation in
  [section 12](#12-for-the-owner) accepted; owner accepted closeout on 2026-11-24 (closing epic
  [#1556](https://github.com/lushly-dev/afd/issues/1556)) after all 15 sub-issues merged and the
  owner confirmed the desktop Loam scaffold and relaunch persistence. The owner waived manual
  WebView2 checks for `spec.md` §9.3 step 3 (file import/download), step 5 (800/500 px resize),
  and individual walkthroughs of step 2's five views / dark-in-light preview and step 4's history
  list, accepting automated coverage (`theme.test.ts`, 15/15 scenarios, and 72 Specimen captures
  including 12 narrow captures and scoped preview isolation) as substitutes. Written 2026-11-15
  against `main` at `6eeb545d`: fifteen jobs as scenario files that pass the three checks, a
  recommended app kind, a document type, twenty-two drafted commands and the gaps they expose.
  Walked once by a fresh reader in three seats, and revised ([section 8](#8-what-the-walk-changed)).
  Shipped through [#1942](https://github.com/lushly-dev/afd/pull/1942) (`violet-afd` gaps),
  [#2090](https://github.com/lushly-dev/afd/pull/2090) (write-path hardening),
  [#2166](https://github.com/lushly-dev/afd/pull/2166) (Loam DTCG tree),
  [#2251](https://github.com/lushly-dev/afd/pull/2251) (plugin specification),
  [#2355](https://github.com/lushly-dev/afd/pull/2355) (first slice in `endpoints/loam/plugins/violet/app/`),
  and [#2513](https://github.com/lushly-dev/afd/pull/2513) (`constraints.set` audit + DTCG constraint
  round-trip). [STATUS.md](STATUS.md) holds the full verification record.
- **Verified:** every claim about existing code in [section 2](#2-what-exists-today) cites a file
  and line or a command name read first-hand on 2026-11-15 at `6eeb545d`. Anything inferred says
  so with *(inferred)*.
- **Next:** none for epic [#1556](https://github.com/lushly-dev/afd/issues/1556); mounting
  `violet-server` behind the same engine port awaits Loam phase 5 or the plugin-engine
  specification, and Lushly's tree lives in the private Lushly repository.

| Field | Value |
| --- | --- |
| Units likely touched | A new `endpoints/loam/plugins/violet/`; `integrations/violet-afd` for the engine gaps in [5.2](#52-gaps-in-violet); `.github/workflows/loam-plugins.yml` |
| Related | [Loam](../../../../endpoints/loam/README.md) and its [status](../../../../endpoints/loam/docs/STATUS.md); [Mail](../../active/mail/mail.proposal.md), the first plugin; the [Violet foundation](../../../../foundations/violet/README.md); Lushly's token-tree plan, in the private Lushly repository, read for its jobs only |
| Supersedes | The `violet` row of Loam's [first-party apps](../../../../endpoints/loam/docs/proposal.md#first-party-apps) (`proposal.md:674`: "Mounted, then native views", phase 5) |

## 1. Problem and goal

The owner is building a personal Loam first: the desktop lane, in `local` identity (D106,
`endpoints/loam/docs/decisions.md:121`), with a hosted Loam to follow in 2027. Its first app is
Violet, the token engine, because design work on two projects waits on it:

- **AFD and Loam share a default tree.** Loam's tree is the source of the theme every
  `violet-elements` component ships with (D50, `decisions.md:65`).
- **Lushly has its own tree,** which replaces that default and must fill every entry of the
  components' token interface, with contrast checked in each theme ([2.2](#22-the-two-trees)).

Violet has a command line, an MCP server and a browser runtime, and no interface a person works
in. Today a token change is made by editing TypeScript or JSON and rebuilding to see what it did.
The goal is an app in which a person, and from Loam's phase 5 an agent beside them
([4.4](#44-agents)), browses a tree, sees where each
value comes from, changes it after seeing what the change does, previews the result on the real
components in light, dark and high contrast, checks contrast and the interface, and exports.

## 2. What exists today

### 2.1 Violet

- **The engine.** `@lushly-dev/violet-core` holds the data contracts, storage, inheritance
  resolution and export (`foundations/violet/README.md:7`). A node has a parent, a type (`root`,
  `product`, `platform`, `device`, `locale`, `theme`, `experiment`, `shared`, `custom`), a status
  and mixins (`includes`, `includePolicy`) (`packages/core/src/types/node.ts:6-16`, `51-74`).
  Tokens are added, overridden, subtracted, reset and copied as operations on a node.
- **The commands.** `@lushly-dev/violet-afd` registers 46 commands with its own registry, not
  AFD's `defineCommand` (`integrations/violet-afd/src/commands/registry.ts:16-55`). Their names
  are dotted, not AFD's `domain-action`: `node.create`, `node.get`, `node.list`, `node.update`,
  `node.delete`, `nodes.graph`; `token.add`, `token.override`, `token.subtract`, `token.reset`,
  `token.copy`, `token.lineage`, `tokens.resolve`, `tokens.matrix`, `tokens.compare`,
  `tokens.catalog`; `export`; `import.json`, `import.validate`, `import.tree`;
  `constraints.set`, `constraints.list`, `constraints.validate`; `analyze.compliance`,
  `analyze.deviations`, `compare.nodes`, `analyze.violations`, `analyze.health`,
  `analyze.trends`, `analyze.snapshot`; `changes.impact`; `audit.list`; `specimen.get`,
  `specimen.set`; `docs.generate`; `doctor`, `validate`; `apikeys.create`, `apikeys.check`; and
  seven `webhooks.*` (each `name:` in `integrations/violet-afd/src/commands/**`, registered in
  each folder's `index.ts`).
- **A browser-safe entry.** `@lushly-dev/violet-afd/worker` registers the node, token, export,
  import, constraint, analyze, changes, audit and specimen commands, and leaves out the Node-only
  system, webhook and API-key commands (`integrations/violet-afd/src/worker.ts:1-33`); its store is
  `createMemoryDatabase` from `@lushly-dev/violet-core/worker` (`packages/core/src/worker.ts:9`).
  Whether it bundles under Loam's CSP and budget is unmeasured *(inferred to work: it is built
  for Workers)*.
- **Contrast.** A constraint of type `contrast` compares every token matching `applyTo` against
  one token, with a minimum ratio defaulting to 4.5 (`packages/core/src/types/constraint.ts:59-63`,
  `98-106`). The ratio is computed from RGB alone, with no alpha compositing
  (`packages/core/src/constraints/validators.ts:475-484`). Token writes do not run constraints:
  `token.override` checks only that the token exists (`commands/token/override.ts:88`).
  `changes.impact` reports the violations a change would introduce or resolve, without writing
  (`commands/changes/impact.ts:46-50`, `109-110`), using a read-only overlay
  (`packages/core/src/db/overlay.ts:33-41`).
- **Trees as files.** `import.tree` builds a tree from DTCG files, one node per file, each naming
  its parent under `$extensions["dev.lushly.violet"]`, "so a whole tree can live in a repo and be
  exported in CI without a persistent database" (`commands/import/tree.ts:9`, `68-80`). Nothing
  writes a tree back to files: `export` resolves a node's tokens into one output
  (`commands/export/export.ts:67-73`, `103-106`).
- **The MCP server.** `violet-mcp` serves MCP over stdio (`endpoints/violet-server/src/bin.ts:9-23`)
  with a SQLite file at `./violet.db` by default (`src/server.ts:48`). It lists exactly the
  registry's commands as tools, under their dotted names (`src/server.ts:108-117`,
  `src/tools/generator.ts:29-39`); any other tool name, `afd-help` included, answers
  `COMMAND_NOT_FOUND` (`src/server.ts:123-144`). It is built on the MCP SDK's `McpServer`, not on
  AFD's server (`src/server.ts:15`).
- **The browser runtime.** `@lushly-dev/violet-runtime` applies a node's resolved tokens as
  custom properties and switches themes, from a token server or from preloaded tokens
  (`packages/runtime/README.md:31-49`), with a high-contrast choice
  (`README.md:62-72`).

### 2.2 The two trees

- **Loam's tree is TypeScript.** `buildLoamTree` creates a memory database and writes every
  contract id onto a `loam` product node, then three theme nodes and a compact child of each, "Node
  only, at build time" (`endpoints/loam/packages/theme/src/tree/index.ts:1-12`, `65-108`). The
  values live in `src/tree/primitives.ts`, `components.ts`, `shell.ts`, `themes.ts` and
  `density.ts`. Its contrast pairs and per-theme floors (text 4.5:1, 7:1 in high contrast;
  non-text 3:1) are in `src/pairs.ts:1-28`, checked with alpha compositing
  (`src/contrast.ts:1-30`).
- **Lushly's tree is planned the same way.** Lushly's token-tree plan (in the private Lushly
  repository; AFD's side is tracked in #1190 to #1192) builds the tree with `violet-core` in a
  memory database at build time, deterministically; fails the build when any interface entry is
  unfilled; checks contrast in each theme; and uses no token server or browser runtime.
- **The interface both must fill** is `violet-elements`' `tokens/interface.json`, contract
  version 1, 89 token ids each with its custom property and type
  (`foundations/fast-af/packages/violet-elements/tokens/interface.json:2-5`), published by #1195.

So **neither tree lives in a Violet database a person can open.** Each is source in a repository,
built into a memory database that is thrown away. This decides more of the app's shape than
anything in Loam does (section [4.3](#43-where-a-trees-truth-lives)).

### 2.3 Loam

- **Three kinds of app**: native (an ES module rendering FAST-AF elements through the SDK), a
  sandboxed view, and a mounted AFD server rendered by the console
  (`endpoints/loam/docs/proposal.md:617-631`). A manifest names exactly one kind
  (`phases/1-app-contract/spec.md`, section 2.2, `plugin.kind`).
- **A native app** declares its commands with handlers, and gets `context.store` with the `store`
  grant (`phases/1-app-contract/spec.md:937-975`, 4.3).
- **A mounted server** must answer `afd-help`: a server that does not is `MOUNT_NOT_AFD`, and
  plain MCP servers arrive in phase 5 (`phases/1-app-contract/spec.md:1430-1432`, `2416`). Tool
  names are normalized under the instance prefix, so `tokens.resolve` would become
  `violet-tokens-resolve` (`endpoints/loam/packages/manifest/src/naming.ts:29-45`). A mounted
  mutation is exposed to nothing until the deployer names it, and every result is labelled
  untrusted (7.4).
- **App-to-app calls** are refused with `CALL_NOT_GRANTED` until phase 5's `calls` grant
  (`phases/1-app-contract/spec.md:843-846`). A native app over a separately mounted server is two
  apps, so its calls to the server wait for that grant *(inferred from the one-kind rule)*.
- **Document types** are declared under `ui.documents` by native and view plugins; "a `mounted`
  plugin declares none in phase 2", naming phase 5 (`phases/2-documents/spec.md:330`). A type's
  model lives behind its own instance commands, each taking `document`; any number of editors may
  show it (5.6, 5.7). An instance command's input over 256 KiB is refused (`:545`). A document
  type may not declare a `panel` yet (2.1).
- **`notes`** is the reference native document type, with Specimen fixtures in light, dark and
  high contrast (`endpoints/loam/apps/notes/loam-app.toml:1-10`, `67-93`;
  `apps/notes/specimens/notes.specimens.ts:1-6`).
- **The desktop** is the same web build in Tauri, `local` identity only, IndexedDB; mounts, `http`
  and `stdio`, go through three IPC commands of the Rust host (`phases/6-hosts/spec.md:724-755`).
  It is milestone M3, steps 11 and 12 (`:143`); step 11 is in progress by the owner's brief, and
  Loam's STATUS.md lists steps 4 to 13 as not done at `6eeb545d`. Files need "a grant no app has"
  (`:768`).
- **Phase 5,** bus, copilot and mounted servers, has not started (`endpoints/loam/docs/STATUS.md:46`).
- **A plugin cannot yet bring its own engine.** The owner directed on 2026-11-10 that Loam's rules
  change so it can; that needs a specification amending the manifest profile, D56, D63 and D106,
  and is open (`STATUS.md:460`; Mail's L5, `docs/features/active/mail/mail.proposal.md:384`).
- **Where plugins live** (D109, `decisions.md:124`): `endpoints/loam/plugins/<name>/`, excluded
  from `loam.yml`, one job each in `loam-plugins.yml`, importing Loam's SDK and test kit one way.
  "The boundary check is due with the first plugin that has a TypeScript part."

## 3. Jobs

Fifteen jobs, drawn from Violet's commands, the owner's brief and Lushly's plan, each a scenario
file in [`endpoints/loam/plugins/violet/app/scenarios/`](../../../../endpoints/loam/plugins/violet/app/scenarios/). The ranking is a draft for the owner
([question 1](#12-for-the-owner)). `slice` marks what the first slice must pass.

| # | Job | Scenario | Slice | Source |
| --- | --- | --- | --- | --- |
| 1 | Browse a tree: nodes, kinds, customizations, a node's resolved tokens | [01](../../../../endpoints/loam/plugins/violet/app/scenarios/01-browse-a-tree.scenario.yaml) | yes | `node.list`, `tokens.resolve` |
| 2 | See where a value comes from: the lineage, and a node's own overrides | [03](../../../../endpoints/loam/plugins/violet/app/scenarios/03-see-where-a-value-comes-from.scenario.yaml) | yes | `token.lineage`, `node.get` |
| 3 | Compare themes in one tree, only what differs | [04](../../../../endpoints/loam/plugins/violet/app/scenarios/04-compare-themes.scenario.yaml) | yes | `tokens.compare` |
| 4 | Compare two trees: a product's theme beside the default's | [13](../../../../endpoints/loam/plugins/violet/app/scenarios/13-compare-two-trees.scenario.yaml) | yes | The owner's brief ("compare trees"); Lushly's tree replaces the default |
| 5 | See what a change does, then apply exactly that as one change | [05](../../../../endpoints/loam/plugins/violet/app/scenarios/05-see-the-change-first.scenario.yaml) | yes | `changes.impact`; Lushly's plan asks that a change's consequences show in one place |
| 6 | Change a token, and take it back to where it was | [06](../../../../endpoints/loam/plugins/violet/app/scenarios/06-change-a-token-and-take-it-back.scenario.yaml) | yes | `token.override`, `token.reset` |
| 7 | Preview a theme on real components; refuse a value unsafe to draw | [07](../../../../endpoints/loam/plugins/violet/app/scenarios/07-preview-a-theme.scenario.yaml) | yes | `violet-runtime`; `violet-afd/css` validators |
| 8 | Check contrast in every theme, and clear each failure | [08](../../../../endpoints/loam/plugins/violet/app/scenarios/08-check-contrast-in-every-theme.scenario.yaml) | yes | `constraints.set`, `analyze.violations`; `loam-theme`'s pairs; Lushly's plan |
| 9 | Bring a tree in from its files, write it back, take newer files in | [11](../../../../endpoints/loam/plugins/violet/app/scenarios/11-bring-a-tree-in-and-out.scenario.yaml) | yes | `import.tree`; both trees are files ([2.2](#22-the-two-trees)) |
| 10 | Export a theme, with its open checks stated | [10](../../../../endpoints/loam/plugins/violet/app/scenarios/10-export-a-theme.scenario.yaml) | yes | `export`; Lushly's plan emits component data and CSS |
| 11 | Fill every entry of the component interface | [09](../../../../endpoints/loam/plugins/violet/app/scenarios/09-fill-the-component-interface.scenario.yaml) | | `interface.json`; Lushly's plan |
| 12 | Start a product's tree from the default | [14](../../../../endpoints/loam/plugins/violet/app/scenarios/14-start-from-the-default.scenario.yaml) | | Lushly's tree must fill all 89 entries from the start |
| 13 | See what changed and why | [15](../../../../endpoints/loam/plugins/violet/app/scenarios/15-see-what-changed-and-why.scenario.yaml) | | `audit.list`; the `reason` every write takes |
| 14 | Find a token by what it is for | [02](../../../../endpoints/loam/plugins/violet/app/scenarios/02-find-a-token.scenario.yaml) | | `tokens.catalog` |
| 15 | Add a theme to a tree, and remove it | [12](../../../../endpoints/loam/plugins/violet/app/scenarios/12-add-a-theme.scenario.yaml) | | `node.create`, `node.delete` |

What each job refuses is written into it: an unknown node (1, 4) or token (2, 6), more than four
nodes compared (3), a color value that would escape its declaration (7), a token added twice
(11), newer files over unexported edits (9), a node deleted while it has children and a
duplicate node (15), and an export format Violet does not write (10).

**Left out, with reasons.** Webhooks, API keys, `doctor` and `validate` are server operations, not
design work. `analyze.health`, `analyze.trends` and `analyze.snapshot` serve a manager watching
many trees over time; a person with two trees does not need them first. `specimen.get` and
`specimen.set` map component roles to tokens for systems that do not use the components'
interface ids; both trees use the interface's names, which specimens draw from without a map
([#1786](https://github.com/lushly-dev/afd/issues/1786)). `token.subtract`, `token.copy` and mixins are not used by either
tree today *(inferred from `buildLoamTree`, which writes only `add` and `override`)*. Each can
return as a job when the owner ranks one.

## 4. Design

### 4.1 App kind: native, with Violet's engine in the app, mounted later

The brief's likely shape was a native Loam app (FAST-AF elements) over a mounted `violet-server`.
The code argues for it as the end state and against it as the start:

| | Native over a mounted `violet-server` | **Native with the engine in the app (recommended now)** |
| --- | --- | --- |
| Discovery | Fails: `violet-mcp` answers no `afd-help`, so Loam reports `MOUNT_NOT_AFD` until phase 5's plain servers, or until `violet-server` is rebuilt on AFD's server ([2.1](#21-violet), [2.3](#23-loam)) | Not needed |
| The UI's calls | Two apps: `CALL_NOT_GRANTED` until phase 5's `calls` grant, or until a plugin can bring its engine (open) | Its own commands, served today |
| Documents | A mounted plugin declares no type until phase 5 | `ui.documents` today, as `notes` does |
| Transport | `stdio` only on the desktop (step 11, in progress); the browser host answers `MOUNT_TRANSPORT_UNAVAILABLE` | The same in the browser and the desktop |
| Writes | Exposed to nothing until the deployer names each; results labelled untrusted | The app's own, undoable, journaled |
| Files in a repository | Yes: a separate Node process can read and write them | No: the app has no file grant |
| One engine for app, CLI and agents | Yes | The same `violet-afd` code, a second process of it |

So: **a native app now, whose commands run `@lushly-dev/violet-afd/worker` in the page against a
memory database built from the document's content,** the way `buildLoamTree` builds Loam's tree
at build time. The handlers reach the engine through one port *(inferred design)*, which:

- builds and caches each document's memory database, and writes each operation through the
  `store` grant;
- gives the engine the command context's clock and random source, so a replayed journal
  reproduces each write (phase 1, 4.3); Violet's handlers call `nanoid()` and `new Date()` today
  (`commands/token/override.ts:110-111`), which is gap G9;
- rewrites Violet's suggestions, which name its dotted commands (`'token.add'` in
  `override.ts:91`), into the app's command names, so every suggestion a person or agent reads
  names a command that exists here.

When phase 5 brings the `calls` grant or plain mounts, or Loam's plugin-engine specification
lands, a mounted `violet-server` can serve the same port for trees on disk, with no change to the
commands or the screens. That later step is [question 2](#12-for-the-owner).

What this gives up: the app's engine is a second running copy of Violet's, not the one an agent
reaches through `violet-mcp`; and repository trees go in and out as file content until the mounted
step. The code is one package, so behaviour is the same by construction.

### 4.2 Documents: a `violet-tree` document type

**A token tree is a document; a node is not.** A tree is the unit a person opens, names, keeps in
a project and exports, as a note is. A node is a place inside it, like a heading in a note, and is
the editor's selection (`binding.selection`), not a document of its own. Two trees in one
workspace, AFD's default and Lushly's, are two documents, and job 4 compares them.

| Key | Proposed |
| --- | --- |
| `id` | `violet-tree` |
| `content_schema` | The tree's nodes and their operation records, as Violet stores them *(inferred: the shape `buildLoamTree` writes)* |
| `instance_commands` | Every drafted command; each takes `document` |
| `export_command` / `import_command` | `violet-tree-export` / `violet-tree-import`, so Loam's generic `document-export` envelope carries the files |
| `binding` | `model = "command"`, selection a node and a token, `last-writer-wins`, as `notes` |
| `scope_levels` | `["workspace", "project"]`: a tree belongs to the project that ships it |
| `templates` | `blank`; `example` (below, used by the scenarios); `afd-default`, AFD's default tree as an independent copy, generated from `loam-theme` when the app is built *(inferred)* |
| Grants | `store`, `clock`, `random` |

Every edit is one instance command with a small input, so a document never travels whole except
on import and export, and the 256 KiB bound applies there. Loam's tree is a few hundred tokens
*(inferred; unmeasured)*; phase 0 measures both trees' sizes as files.

**The `example` template** (invented; the scenarios use it): a product node `example` adding
`color.surface.page #ffffff`, `color.text.primary #1b1b1f`, `color.text.muted #6b6b75`,
`color.field.border #8a8a94`, `color.action.primary.background #5b3fd1` and
`size.focus.width 2px`, with one rule, `color.text.*` against `color.surface.page` at 4.5:1;
`example/light`, no overrides; `example/dark`, overriding the page `#121214`, primary text
`#ececf1`, muted text `#9a9aa6` and the field border `#6e6e7a`; and `example/high-contrast`,
overriding primary text and the field border to `#000000` and the focus width to `3px`.

### 4.3 Where a tree's truth lives

Both real trees are source files in a repository ([2.2](#22-the-two-trees)). If the app kept its
own copy in Loam's store, a change made in the app would never reach the build, and a change in
the repository would never reach the app. So the document is a working copy, and the files stay
the source:

1. **In:** the tree's files are imported into a document (`violet-tree-import`, over
   `import.tree`), all or nothing: the import builds into a fresh memory database and saves only
   when every file succeeds, since `import.tree` itself creates nodes one at a time and leaves
   earlier ones in place when a later file fails (`commands/import/tree.ts:89-93`).
2. **Work:** the person edits the document through its commands.
3. **Out:** `violet-tree-export` returns one file per node holding only that node's own
   operations, so a review sees a small diff, and resets the document's count of unexported
   changes.
4. **Again:** newer files replace the tree (`replace: true`) only when nothing is unexported;
   otherwise the import is refused, naming the export.

This needs each tree's source to be DTCG files that `import.tree` reads. Loam's is TypeScript
today, and Lushly's is not yet written. Moving both to DTCG files is [question 3](#12-for-the-owner):
it changes `loam-theme`'s inputs, not its outputs. Until a mounted engine can touch the disk,
the files move by the person's hand (a file picker and a download) *(inferred: a webview's
file input and download need no Loam grant; unverified on the desktop)*.

### 4.4 Agents

**Inside Loam, the first slice has no agent.** An app's commands reach the copilot with phase 5,
which has not started; the hosted MCP surface leaves documents to the collaboration service
(phase 6, section 7); and the desktop lane specifies no MCP server, only three IPC commands for
mounts (section 10.2). So the slice is a person's tool, and the proposal says so rather than
claim otherwise.

**Outside Loam, agents keep working on the files.** An agent edits the same DTCG files with the
`violet` CLI or `violet-mcp`, which write their own SQLite database (`./violet.db` by default,
`src/server.ts:48`); the person brings those files into the app and writes them back. The files
are where the two meet, which is a further reason for [question 3](#12-for-the-owner).

When phase 5 arrives, the app's commands become the copilot's with no change, and a model
without a skill needs four facts, which go into the commands' descriptions: find a tree with
`document-list { type: "violet-tree" }`; node ids are paths; `add`, `override` and `reset` mean
different things; and writes are not checked against the rules, so preview first. Writes then
land with no person's confirmation, since `approval` must be `none` and `confirm_prompt` waits for
phase 4 (phase 1, 2.2); that is in the [risks](#11-risks).

### 4.5 Screens

At the level of the `loam-design` skill's parts and layout classes. No markup.

| Part | What it holds |
| --- | --- |
| Rail | "Violet", in the project band when a project is active, as a dual-scope app (D29) |
| Sidebar | The tree's nodes as a `loam-tree`, each row its id, kind and customization count; the selected node is the editor's selection |
| Main | The editor area with the `violet-tree` editor. One editor element with five views over the selected node: **Tokens** (resolved values, the node that set each, own overrides marked by text and a mark, never by color alone); **Compare** (two to four nodes of this tree, or one node of another tree, in columns, differing cells marked); **Preview** (the shared components drawn in the node's values inside a scoped root, the chrome untouched); **Checks** (contrast violations and unfilled interface entries, each linking to its token); **History** (changes with their reasons). A split shows two views of one document side by side, Tokens beside Preview, by "one model, any number of editors" |
| Inspector | The selected token: its lineage, its value field, and before a write the change preview (nodes changed, shielded, violations introduced), with Apply and Cancel. Edits made while a preview is open collect into one change, applied together |
| Panel | Not used: a document type cannot declare one yet; Checks lives in the editor |
| Status bar | Nothing of the app's in the first slice |

- **Layout classes.** `expanded`: sidebar, main and inspector inline. `medium`: the inspector
  overlays main. `compact`: the tab bar replaces the rail, the sidebar and inspector open as modal
  drawers, and the editor shows one view at a time.
- **Swatches are content.** A color swatch shows the tree's value, which is the app's content and
  not the chrome's: the chrome stays on contract tokens, and every swatch carries its value as text.
- **The preview is scoped.** Properties from `violet-theme-preview` are applied with CSSOM on a
  root inside the editor's shadow root, never on `document.documentElement`, so a dark tree
  previewed in a light Loam never restyles the shell *(inferred from `violet-elements`' theme set
  API, which #1195 merged as accepting a scoped root)*.
- Before any markup, the implementer calls `components-brief` once for the page, as `AGENTS.md`
  requires.

## 5. Commands

### 5.1 Drafted commands

Each is an instance command of `violet-tree`, taking `document`, with a handler that runs the
Violet command named beside it against the document's memory database. Names follow
`domain-action`; Violet's own dotted names stay inside the engine. "Undo" is what the result's
`undoCommand` names.

| Command | Over | Input (beside `document`) | Result data | Undo | Errors |
| --- | --- | --- | --- | --- | --- |
| `violet-node-list` | `node.list` (`view: tree`) | none | `{ root, nodes: [{ id, parent, type, customizations }] }` | | |
| `violet-node-get` | `node.get` (`includeOperations`) | `node` | `{ node, own: [{ token, operation, value }] }` | | `NODE_NOT_FOUND` |
| `violet-node-create` | `node.create` | `parent, id, type` | `{ node }` | `violet-node-delete` | `NODE_ALREADY_EXISTS`, `NODE_NOT_FOUND` |
| `violet-node-delete` | `node.delete` | `node` | `{ node }` | Recreate it with its operations (the record is kept, `deletedAt`) | `NODE_HAS_CHILDREN`, naming them |
| `violet-token-resolve` | `tokens.resolve` | `node, filter?, limit?` | `{ node, tokens: [{ id, value, from }] }` | | `NODE_NOT_FOUND` |
| `violet-token-find` | `tokens.catalog` | `query, category?` | `{ tokens: [{ id, category, customizedAt }] }` | | |
| `violet-token-lineage` | `token.lineage` | `node, token` | `{ token, value, from, chain: [{ node, operation, value? }] }` | | `NODE_NOT_FOUND`, `TOKEN_NOT_FOUND` |
| `violet-token-compare` | `tokens.compare` | `nodes` (2 to 4), `filter?` | `{ nodes, rows: [{ token, cells: [{ node, value, differs }] }], summary: { differing } }` | | `VALIDATION_ERROR` |
| `violet-tree-compare` | `tokens.resolve` on each tree | `node, other: { document, node }, filter?` | `{ rows: [{ token, here, there }], summary: { differing, onlyHere, onlyThere } }` | | `NODE_NOT_FOUND`; another tree outside the call's scope is `DOCUMENT_NOT_FOUND` |
| `violet-change-preview` | `changes.impact` | `node, changes` (at most 50) | `{ written: false, summary: { changed, shielded, violationsIntroduced }, nodes, apply: { command, input } }` | | `NODE_NOT_FOUND` |
| `violet-change-apply` | `token.*` in one handler | `node, changes` (at most 50), `reason?` | `{ applied, summary }` | One undo for the whole change | As each `token.*` |
| `violet-change-list` | `audit.list` | `node?, token?, limit?` | `{ changes: [{ node, token, operation, oldValue, value, reason, actor, at }] }` | | |
| `violet-token-add` | `token.add` | `node, token, value, reason?` | `{ node, token, value }` | Remove the operation: gap G8; not undoable until then | `TOKEN_ALREADY_EXISTS`, `INVALID_TOKEN_VALUE` |
| `violet-token-override` | `token.override` | `node, token, value, reason?` | `{ node, token, oldValue, inherited, value }` | `violet-token-reset` when `inherited`, so the node follows its parent again; otherwise an override with `oldValue` | `TOKEN_NOT_FOUND`, `INVALID_TOKEN_VALUE` |
| `violet-token-reset` | `token.reset` | `node, token` | `{ node, token, value, from }` | An override with the value it removed | `TOKEN_NOT_FOUND` |
| `violet-theme-preview` | `tokens.resolve` and the `violet-afd/css` validators | `node` | `{ node, count, properties: [{ name, value }], refused: [{ token, reason }] }` | | `NODE_NOT_FOUND` |
| `violet-constraint-set` | `constraints.set` | `node, constraints, merge?` | `{ node, constraints, previous }` | Set `previous` back | `NODE_NOT_FOUND`, `VALIDATION_ERROR` |
| `violet-violation-list` | `analyze.violations` | `root?` | `{ violations: [{ node, token, rule, ratio? }], summary: { total, errors } }` | | |
| `violet-interface-check` | none: gap G2 | `nodes?` | `{ interface: { version }, complete, missing: [{ node, token }] }` | | |
| `violet-export` | `export` | `node, format, selector?` | `{ format, content, tokenCount, checks: { violations, unfilled } }` | | `VALIDATION_ERROR`; `INVALID_TOKEN_VALUE` for a value unsafe in the format |
| `violet-tree-import` | `import.tree`, all or nothing | `content: { files }, replace?` | `{ nodes: [{ id, parent, tokens }] }` | None: the document's trash is the way back | `NODE_ALREADY_EXISTS` without `replace`; `OPERATION_NOT_ALLOWED` over unexported changes; `INVALID_TOKEN_VALUE` |
| `violet-tree-export` | none: gap G1 | none | `{ content: { files: [{ name, content }] }, unexported: 0 }` | | |

`document-create`, the shell's, is the twenty-third command the scenarios call. Every error
carries a suggestion, naming the command that recovers wherever one does (the scenarios assert
eleven).
The codes are Violet's own (`packages/core/src/types/error-codes.ts`), but for Loam's
`DOCUMENT_NOT_FOUND`. The mutations are `store-write` and exposed by AFD's default (palette and
agent on, MCP and CLI off).

**Unsafe values are refused where they enter.** A value for a color, length, font, shadow,
duration or easing token is checked when written or imported, against the same allow-list
validators `violet-afd/css` exports, and refused with `INVALID_TOKEN_VALUE` (gap G10). Preview and
export check again, for documents made before the check: Violet's CSS export writes a string
value as it is (`foundations/violet/packages/core/src/export/transformers/css.ts:98-100`), so
without these checks a value such as `#121214; background: url(…)` would reach the exported
stylesheet.

### 5.2 Gaps in Violet

The jobs need things Violet lacks. Each belongs in `violet-afd`, so the CLI and `violet-mcp` gain
them too (the honesty check), and each waits for the session now working in Violet's code:

| | Gap | Job | Evidence |
| --- | --- | --- | --- |
| G1 (#1322) | Write a tree back as files, one per node with only its own operations: the inverse of `import.tree` | 9 | `import.tree` has no inverse; `export` resolves ([2.1](#21-violet)) |
| G2 (#1323) | Check a tree against `violet-elements`' interface: every id resolved in each theme node | 11, 12 | `loam-theme`'s check does it outside Violet, and Lushly's plan will too |
| G3 (#1326) | Contrast with alpha compositing, as `loam-theme`'s `contrast.ts` does | 8 | `validators.ts:475-484` reads RGB only |
| G4 (#1327) | Record why a failing rule stays: a reason beside `enabled` | 8 | `constraint.ts:98-106` has `enabled` and no reason |
| G8 (#1328) | Remove a node's own operation, the undo of `token.add` | 11 | The store has `removeOperation` (`packages/core/src/storage.ts:17`); no command exposes it |
| G9 (#1324) | Take time and ids from the caller | Replay of every write | `override.ts:110-111` |
| G10 (#1325) | Refuse a value its type cannot hold safely, on write, import and CSS export | 7, 10 | `css.ts:98-100` emits strings raw |

And three in how `violet-server` meets Loam, for the mounted step only: it answers no
`afd-help` or `afd-detail` (G5), its tool names are not `domain-action` (G6; Loam's renaming
copes), and it is built on the MCP SDK, not AFD's server (G7). Rebuilding it on
`@lushly-dev/afd-server` closes all three *(inferred)*.

## 6. Dependencies

| Built now, with Loam's SDK and test kit | Waits on the desktop lane (phase 6, step 11) | Waits on phase 5, or Loam's plugin-engine specification |
| --- | --- | --- |
| The native app, its manifest (version 2), the `violet-tree` type, its editor, sidebar and inspector, and its commands, on `createAppTestKernel` (`endpoints/loam/packages/testing/src/index.ts:88`) | Running the same app in the owner's desktop Loam; it needs nothing from the lane but the lane itself | The engine as a mounted `violet-server` behind the same port: the `calls` grant or a plugin's own engine, and plain or AFD discovery (G5 to G7) |
| Its Specimen fixtures and scenarios | `stdio` mounts, for that later engine | Reading and writing a repository's tree files on disk |
| G1, G2, G9 and G10 in `violet-afd`, which the slice needs, once the Violet session hands over | | An agent inside Loam using the app's commands (phase 5) |

The first slice runs in the browser host today and on the desktop once step 11 lands. Nothing in
it waits on phase 5; four engine gaps come first.

## 7. What writing the jobs changed

- **The tree became a document.** Writing job 1 needed somewhere to open a tree; a node-level
  document could not hold the hierarchy a person browses.
- **Import and export joined the slice (job 9).** Writing the first steps showed that no real
  tree exists in a store the app could read; both are files ([4.3](#43-where-a-trees-truth-lives)).
  That found G1.
- **The preview became a command.** Job 7 first had only page behaviour. An agent cannot see a
  preview, so `violet-theme-preview` returns what the region applies and what it refused.
- **Contrast clears by fixing the value.** Job 8's "record why it stays" could not be written
  (G4); the scenario shows the fix, and a comment says what is missing.
- **Cut:** `violet-node-graph` and `violet-token-matrix`, drafted at first, served no job that
  compare and lineage did not.

**What a scenario cannot express here:** the undo itself, which travels as `undoCommand` and
`undoArgs` (job 6 runs the reset its undo names); the preview region and the files moving by hand
(jobs 7 and 9); a person's approval against an agent's attempt, since every step runs as a test
actor; and the preview's second check, since writes refuse an unsafe value first.

## 8. What the walk changed

One fresh reader walked the paths on 2026-11-15, in all three seats, with the owner's request in
hand before the proposal, and the host's phase 1 and phase 2 specifications. It checked the code
claims and found them true, and reported six blockers and eleven improvements. Applied:

| Finding | Seat | Change |
| --- | --- | --- |
| No job compares two trees, though the brief asks for it | Job list | Job 4, `violet-tree-compare` |
| Lushly's tree would start with 89 `token.add` calls | Job list | Job 12, the `afd-default` template as an independent copy |
| "Undo restores `oldValue`" would pin an inherited value as an override (`previous-value.ts:16-24`) | Person | The override's result says `inherited`; its undo is a reset when inherited |
| "Undoable" with no inverses for create, add, constraints and import | Person | `violet-node-delete`; `previous` from `violet-constraint-set`; G8 for `token.add`; import not undoable, and atomic |
| The slice claims an agent, but the agent surface is phase 5 | Calling agent | [4.4](#44-agents) says plainly the slice is a person's, and where agents work meanwhile |
| An unsafe value is accepted on write and reaches CSS export raw | Job list | Refused on write and import; checked again in preview and export (G10) |
| Export says nothing of failing checks | Job list | `checks` in `violet-export`'s result |
| Re-importing newer files is refused, so syncing loses edits | Job list | `replace`, refused over unexported changes |
| No history, though every write takes a reason | Job list | Job 13, `violet-change-list` over `audit.list` |
| Thirty edits mean thirty undos; a preview caps at 50 changes | Person | `violet-change-apply`, one change and one undo |
| `import.tree` is not atomic | Person | All or nothing, through a fresh database |
| Replay needs the context's clock and ids | Person | `clock` and `random` grants; G9 |
| Violet's suggestions name dotted commands that do not exist in Loam | Calling agent | The port rewrites them |
| No confirmation until phase 4; unbounded reads | Calling agent | Risks; `limit` on resolve and history |
| Exit criteria depend on an unscheduled G1 | — | G1, G2, G9 and G10 are named slice prerequisites |

**Declined:** none. **Not re-checked:** the reader's estimate of the calls and tokens an agent would
spend, which waits for phase 5's host to be measured.

## 9. Home and tests

- **Home:** `endpoints/loam/plugins/violet/` (D109): `app/`, the native app package, and
  `docs/`, its specification once approved. Violet's engine stays where it is; the plugin imports
  `@lushly-dev/violet-afd/worker` (an endpoint may depend on an integration,
  `scripts/check-boundaries.mjs:259-261`), `@lushly-dev/loam-sdk` and `@lushly-dev/loam-testing`.
- **Its CI:** a job in `loam-plugins.yml` behind its own affected-units gate, as Mail's
  (`.github/workflows/loam-plugins.yml:55`). Since this is the first plugin with a TypeScript
  part, it lands D109's one-way boundary check: nothing in Loam's core or suite imports it.
- **Tests:**
  - the fifteen scenarios, moved to `app/scenarios/` and run against `createAppTestKernel`;
  - unit tests of the engine port: the store's round trip, the atomic import, the undo rule and
    the suggestion rewriting;
  - **Specimen fixtures** for the editor's five views, the sidebar and the inspector, in light,
    dark and high contrast and both densities, as `notes` has; one fixture per view previews the
    `example` tree's dark node inside a light Loam, to prove the preview stays scoped;
  - `lint:tokens` on its stylesheets, and `components-brief` before markup.

## 10. Exit criteria

1. Every scenario tagged `slice` passes against the app's test kernel, with G1, G2, G9 and G10
   in `violet-afd`.
2. The Specimen fixtures render clean in every theme and density.
3. If question 3 is answered yes: Loam's tree, as DTCG files, imports, takes one override, and
   exports with a one-line diff.
4. The app runs in the owner's desktop Loam once phase 6's step 11 lands.

## 11. Risks

- **Two engines drift.** Bounded: one package, one version, pinned by the workspace.
- **Size.** A large tree's import could pass the 256 KiB bound on an instance command's input.
  Phase 0 measures both trees.
- **No confirmation for an agent's writes** once phase 5 gives the copilot these commands, until
  phase 4's prompt arrives; every write is undoable meanwhile, but `violet-token-add` until G8.
- **Large reads.** The interface check on an empty tree can list 89 entries per theme node, and a
  theme preview every token; agents should read summaries first.
- **Violet is moving.** Another session is changing `violet-elements` and Violet's packaging
  (#1195, #1297). This proposal edits no Violet code; the gaps are filed for that work.

## 12. For the owner

**Answered 2026-11-16:** the owner accepted every recommendation below: the slice as tagged
(jobs 1 to 10); the native app now and the mounted engine later; trees as DTCG files; the seven
gaps filed (G1 #1322, G2 #1323, G3 #1326, G4 #1327, G8 #1328, G9 #1324, G10 #1325); and trees at
both the project and the workspace level.

1. **Ranking.** Cut, add and rank the fifteen jobs. *Recommendation:* the slice as tagged (jobs 1
   to 10), because job 9 is what makes the app touch a real tree and job 4 is the comparison
   Lushly's work needs. *Confidence:* medium.
2. **App kind.** A native app with Violet's engine in the page now, and the mounted
   `violet-server` behind the same port after phase 5 or the plugin-engine specification?
   *Recommendation:* yes; the mounted-first shape cannot discover, call or declare a document
   today ([4.1](#41-app-kind-native-with-violets-engine-in-the-app-mounted-later)).
   *Confidence:* high.
3. **Trees as files.** Move Loam's tree from TypeScript to DTCG token files, and write Lushly's
   that way from the start? *Recommendation:* yes; it is what `import.tree` was written for, and
   it is where the person in the app and an agent at the CLI meet. *Confidence:* medium; it
   touches `loam-theme`'s inputs.
4. **The gaps.** File G1 to G4 and G8 to G10 against `violet-afd`, to be built after the current
   Violet work lands? *Recommendation:* yes; G1, G2, G9 and G10 first, since the slice needs them.
   *Confidence:* high.
5. **Scope.** Should a tree belong to a project (AFD's default to AFD, Lushly's to Lushly), or to
   the workspace? *Recommendation:* both levels, as proposed. *Confidence:* medium.

## 13. Out of scope

Hosted Loam and sharing a tree between people; a token server; webhooks and API keys; mixins,
copies and subtraction in the editor; Figma; and building Lushly's tree, which is Lushly's plan.
