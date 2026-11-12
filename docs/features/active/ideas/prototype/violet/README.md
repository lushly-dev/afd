# Step 0.6: framings on Violet's engine

Does Violet's hierarchy engine, as it is on `main`, fit ideas in place of design tokens? This folder
answers [step 0.6](../../ideas.proposal.md#8-phase-0-measure-before-specifying) by running it.

| File | What it is |
| --- | --- |
| [`framings.mjs`](framings.mjs) | The script: invented ideas, the tree of framings, 15 named checks, timings |
| [`results.json`](results.json) | Outcome, one-line note and evidence for each check, and the timings |

```sh
# from the repository root, after `pnpm check` has built Violet's dist
fnm exec --using "$(cat .nvmrc)" -- node docs/features/active/ideas/prototype/violet/framings.mjs
```

## Method

The script imports the built `integrations/violet-afd` package and calls its command registry, the
layer the `violet` CLI and MCP server call, over the in-memory store. Nothing was changed in
Violet. It generates 300 invented gardening ideas, each `{statement, type, tags}`, with every 37th
tagged `private`, and adds each at the root as a composite token value with an id `idea.iNNNN`.
The framings are `core` (root), three children `public`, `book` and `product`, and one grandchild
`public-short` under `public`. Each check calls the commands and records what the store resolves
afterwards. Timings repeat the load at 300 and 3000 ideas with 30 overrides in `public`.

Every claim below comes from the run (in `results.json`) or from a source line, cited as
file:line under `foundations/violet/packages/core/src` (core) or
`integrations/violet-afd/src` (afd).

## The checks

| # | Check | Outcome | How |
| --- | --- | --- | --- |
| 1 | Root idea resolves in every framing | Works as is | `tokens.resolve` returns the composite whole in all five framings (run) |
| 2 | Override in one framing, siblings unaffected | Works as is | `token.override` on `book`; `public` and `product` keep the root statement (run) |
| 3 | A root change reaches framings that did not override | Works as is | A root change is an override at the root (no update command); a framing that overrode keeps its own wording, with no notice (run) |
| 4 | Subtract hides it from the framing's child too | Works as is | Subtract in `public` hides it in `public-short`; `book` keeps it (run) |
| 5 | Reset restores | Works awkwardly | Reset of an override restores; reset of a subtract is accepted and does nothing, the idea stays hidden (run; core `engine/resolver.ts:298-310` acts only on a token still present). No command removes an operation (afd has no caller of `removeOperation`) |
| 6 | Add an idea only a framing has | Works as is | `token.add` on `product`; adding an id an ancestor holds is refused, `TOKEN_ALREADY_EXISTS` (run; afd `commands/token/add.ts:99`) |
| 7 | Copy: pins or follows | Works awkwardly | Copy follows its source: `product` read `book v1`, then `book v2` after `book` changed; lineage says `tracksSource: true` (run; core `engine/resolver.ts:329`). No pinned copy |
| 8 | Lineage in the grandchild | Works as is | `token.lineage` on `public-short`: `core:add > public:override > public-short:inherit`, resolved at `public` (run) |
| 9 | Compare two framings | Works as is, coarse | `tokens.compare` and `compare.nodes` run and mark each cell inherited or overridden with its source; values compare whole, so a tag change and a rewording look the same (run) |
| 10 | Impact of one change and of a batch across nodes | Works awkwardly | `changes.impact` previews 1 to 50 changes at one node and writes nothing; 51 is refused; changes at a second node cannot be stated, and an extra key is dropped silently (run; afd `commands/changes/impact.ts:21,47`) |
| 11 | Change one field (tags) without overriding the statement | Not possible | Override replaces the whole value: after tagging in `book` and rewording at the root, `book` still has the old statement. A partial `{tags}` is accepted and the statement is gone. A `metadata` key on override is dropped silently (run) |
| 12 | Read the tree as of an earlier moment | Not possible | No resolve, lineage or compare input takes a moment (run, schemas). `audit.list` has the change. Replaying stored operations up to the moment through `resolveInheritance` gave the earlier statement, but that is code outside the engine and node edits are not versioned |
| 13 | An idea held back from descendants until released | Works awkwardly | Emulated by a subtract in every child. A framing created later gets the idea at once, and reset does not release it (check 5), so it cannot be released by any command (run) |
| 14 | "A public framing may not hold an idea tagged private" | Works awkwardly | A `pattern` constraint on `idea.*` at `public` over the value's JSON text (`^(?!.*"private").*$`). Validate finds the 9 private ideas in `public` and, inherited, in `public-short`. A write that breaks it is accepted and only reported (run) |
| 15 | Other: ids, value types, node types | Works awkwardly | Any non-empty id is accepted, spaces and slashes included, except reserved segments (`__proto__`); a bare array value is refused; a composite's `resolvedValue` is JSON text; every idea carries design defaults (`category: custom`, `tier: semantic`); node type `framing` is refused, so framings are `custom` (run; core `types/node.ts:6-16`, `types/token.ts:63`) |

## Timings

In memory, Node 26.13, one run on a laptop. Load is `token.add` per idea at the root.

| Ideas | Load | Per add | Resolve the grandchild | Compare two framings | Impact of one root change |
| --- | --- | --- | --- | --- | --- |
| 300 | 10 ms | 0.03 ms | 1 ms | 4 ms | 23 ms |
| 3000 | 218 ms | 0.07 ms | 9 ms | 36 ms | 246 ms |

None is a constraint at these sizes. The impact preview grows fastest, about ten times for ten
times the ideas; it reports on every framing below the changed one (run).

## What this means for the plan

**What fits.** The tree semantics fit ideas without change: an idea stated at the root resolves
everywhere, a reframe stays in its framing and its subtree, an omit hides an idea below it, a new
idea can live in one framing, and lineage explains a resolved idea step by step. Composite values
are stored and resolved whole. Compare and the single-node preview work as they do for tokens. The
plan's *state*, *reframe*, *omit*, *borrow* and lineage map to `token.add`, `token.override`,
`token.subtract`, `token.copy` and `token.lineage`; *include* maps to node `includes`, not run here.
Speed is no concern at 3000 ideas.

**What breaks.**

- *Restore after an omit.* Reset brings back a reframed idea, but not an omitted one, and no command
  removes the omit. The plan's restore must work on both.
- *Whole values.* A reframe copies the whole idea, so tags and type are frozen with the wording and
  a later change at the root no longer reaches that framing. Compare cannot tell a tag change from
  a rewording.
- *Silent acceptance.* A partial value wipes the statement, and unknown keys (`metadata` on
  override, a second node in a preview) are dropped without a word.
- *Rules are reports.* The constraint holds the private rule only as a regex over JSON text, and a
  breaking write still lands.
- *Token vocabulary.* Design metadata defaults, the node types, and `resolvedValue` as a string
  belong to tokens and would need hiding or replacing.

**Operations ideas would use.** `token.add`, `token.override`, `token.subtract`, `token.reset`,
`token.copy`, `token.lineage`, `tokens.resolve`, `tokens.compare`, `changes.impact`,
`constraints.set` and `constraints.validate`, `audit.list`, and `node.create` with `includes`.
Export, import, the matrix, specimens and the colour validators would not be used.

**P7, item by item.**

| P7 says Violet lacks | Confirmed by the run? |
| --- | --- |
| Pinned copies | Yes. Copy follows its source (check 7); a pin is only an override with a pasted value, which loses lineage to the source |
| Reading the tree as of a moment | Yes. No command takes a moment (check 12); operations carry `createdAt`, so a replay is possible for operations, not for node changes |
| Changing one field of a value | Yes. Override replaces the whole value, and a partial value erases the rest (check 11) |
| A preview of a batch across nodes | Yes. The preview takes one node and at most 50 changes (check 10) |
| A value held back from descendants until released | Yes. Only emulated by per-child omits, which new framings do not get and nothing can undo (checks 5 and 13) |

The run adds two items P7 does not list: restoring an omitted value, and a rule that refuses a
write rather than reporting it. The plan's fallback in section 8 (keep the flat set if framings do
not fit) is not triggered: the hierarchy fits, and the gaps are the ones P7 names plus these two.
