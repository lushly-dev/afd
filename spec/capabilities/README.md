# Capability manifests

Machine-readable capability manifests for AFD's four implementations (#1738).

Each implementation owns one file here:

| File | Implementation |
| --- | --- |
| [`typescript.json`](./typescript.json) | TypeScript (`@lushly-dev/afd-*`) |
| [`python.json`](./python.json) | Python (`afd`) |
| [`rust.json`](./rust.json) | Rust (`afd` crate) |
| [`cpp.json`](./cpp.json) | C++ (`afd-cpp`) |

[`catalog.json`](./catalog.json) lists every capability ID, its canonical label, and every table
rendered from these manifests across [`docs/language-parity.md`](../../docs/language-parity.md)
and `spec/*.md`.

They live in `spec/capabilities/` rather than inside each language's build root so that updating
status notes or evidence does not trigger unrelated downstream unit builds (such as Rust/Umbel or
Loam's mounted suite) while still keeping one manifest per implementation.

## Updating a capability

1. Edit only the affected language's manifest (`spec/capabilities/<language>.json`).
2. Update `status` (`yes`, `partial`, `no`, `planned`, `deferred`, `na`), `note`, `views` (if
   the capability appears in a spec table with a shorter test-focused note), and `evidence` (the
   source or test files proving the claim).
3. Run `pnpm capabilities:sync` to regenerate every table across `docs/language-parity.md` and
   `spec/*.md`.
4. Run `pnpm check:capabilities` (also part of `pnpm check`) to verify.

A new capability ID also needs an owner in [`spec/registry.json`](../registry.json): the core, one
profile, or `outsideContract` for a language's own tooling. The status changes the table of the core
and profiles each language implements, so after a status change run `pnpm spec-registry:sync` and
`pnpm check:spec-registry` too ([registry](../registry.md)).

## Manifest rules

`scripts/check-capabilities.mjs` enforces:

- Every capability in `catalog.json` is present in all four manifests, and no manifest contains
  an unknown capability ID.
- Every `status` is one of `yes`, `partial`, `no`, `planned`, `deferred`, `na`. Views may shorten
  or specialize the detail text for a spec table, never the status word itself.
- Every `yes` or `partial` entry carries non-empty `evidence`, and every `evidence` entry is a
  repository-relative path that exists on disk.
- Every `planned` or `deferred` entry carries a `note`, `issue`, or `evidence`.
- Every `<!-- generated:capabilities:<id>:start -->` / `<!-- generated:capabilities:<id>:end -->`
  region in `docs/language-parity.md` and `spec/*.md` matches the rendered output byte for byte,
  with no orphan markers and no generated row exceeding `scripts/policy/doc-line-limits.json`'s
  limit on any policy-tracked document.
