# umbel-sdk

The Umbel plugin SDK: the portable plugin API. One `Plugin` value serves every
plugin kind. The host links it as a compiled plugin, `export_component!`
builds it as a WebAssembly component (the `component` feature), and
`serve_mounted` runs it as a stdio MCP server (the `mounted` feature). The
crate does not depend on the host crate. The phase 1
[specification](../docs/phases/1-plugin-contract/spec.md), section 5, defines
it.

A handler gets the validated input and a `Cx`, its handle to the host services
its plugin was granted, and answers an `Outcome`.

## Host services, by grant family

The host services of one call are split into one trait per grant family
([D218](../docs/decisions.md)). A read grant and its write grant are separate
traits.

| Trait | Grant | Methods |
| --- | --- | --- |
| `ConfigServices` | `config` | `config` |
| `LogServices` | `log` | `log` |
| `PackServices` | `packs` | `pack_list`, `pack_read` |
| `EventServices` | `events` | `events` |
| `ClockServices` | `clock` | `now_ms` |
| `RandomServices` | `random` | `random` |
| `ContentServices` | `content` | `content_list`, `content_collections`, `content_read` |
| `ContentWriteServices` | `content_write` | `content_replace` |
| `DocumentServices` | `documents` | `doc_get`, `doc_list`, `doc_changes`, `doc_position`, `doc_position_of`, `reader_tokens`, `readable_collections`, `doc_own` |
| `DocumentWriteServices` | `documents_write` | `doc_put`, `doc_delete` |
| `RecordServices` | `records` | `record_get`, `record_list`, `record_read`, `record_find`, `record_match` |
| `RecordWriteServices` | `records_write`; a mark on a document needs `documents` too | `record_put`, `record_put_cited`, `record_decide`, `doc_own_mark`, `doc_own_unmark`, `record_forget_history` |
| `IndexServices` | `index` | `index_search`, `index_chunks`, `index_applied` |
| `IndexWriteServices` | `index_write` | `index_writer` |
| `GraphServices` | `graph` | `graph_neighbors`, `graph_nodes`, `graph_edges`, `graph_subgraph`, `graph_applied` |
| `GraphWriteServices` | `graph_write` | `graph_apply` |
| `DeriveServices` | `index_write` or `graph_write`, in a command with the `store-write` effect | `derive_changes`, `derive_document`, `derive_head` |
| `MaintenanceServices` | `documents_write`, `records_write`, `index_write` or `graph_write`, allowed for the space, in a call that may write | `checkpoint`, `truncate_wal` |
| `ReaderServices` | no grant of its own: a command exposed to the CLI alone, for a human caller; each read through the reader needs that read's grant | `as_reader` |
| `MemoryServices` | `memory` | `memory_get`, `memory_history`, `memory_list`, `memory_recall`, `memory_left_out`, `memory_changes`, `memory_counts`, `memory_usage`, `memory_head`, `memory_key_file` |
| `MemoryWriteServices` | `memory_write` | `memory_write`, `memory_invalidate`, `memory_confirm`, `memory_forget`, `memory_erase`, `memory_erase_preview`, `memory_sweep`, `memory_reindex` |

Every method has a default that answers `HostError::NotGranted` for the grant
it names, and `log`'s default is a no-op. An implementor, such as a host or a
plugin's test stub, writes the methods of the families it serves and an empty impl
for each of the others:

```rust
impl RecordServices for Stub {
    fn record_get(&self, space: &str, kind: &str, id: &str) -> Result<Option<Record>, HostError> {
        // ...
    }
}
impl GraphServices for Stub {}
// ... one line for each family the stub does not serve.
```

Two traits combine the families, and each is implemented for every type that
implements its parts, so you never implement one by hand:

- `AllServices` is every family. A `Cx` holds one: `Cx::new(call, services)`.
- `ReadServices` is the four read families: documents, records, the index and
  the graph. A `Reader`, which is what `as_reader` returns, holds one, so no
  write method can be reached through a reader.

Plugins call the services through `Cx` and `SpaceCx`, whose methods check the
call's spaces before they reach the host. Those methods did not change with
the split.

`HostServices`, the single trait of all 66 methods from before the split, is
**frozen**. Blanket impls forward each of its methods to the family that now
owns it, so a type written against it is still an `AllServices` and still
compiles, and `Cx` and `Reader` dispatch to it as before. No method is ever
added to it: a method a family gains later answers that family's default for a
legacy implementor. It will be removed in a later minor version, once no
implementor in this repository uses it.

One call can change for a legacy implementor: with both `HostServices` and a
family trait in scope (`use umbel_sdk::*`), a method call on the implementor
itself, such as `stub.now_ms()`, is ambiguous (`E0034`), because both traits
supply it. Import only `HostServices`, or write the call as
`HostServices::now_ms(&stub)`.

## Versioning

This policy is [D218](../docs/decisions.md). It applies from 0.2.0.

- **What is versioned.** The SDK's version is the `version` in this crate's
  `Cargo.toml`. The SDK's public API is everything `umbel_sdk` exports,
  together with its Cargo features, its macros and the `umbel_store` types it
  re-exports. The plugin protocol (`protocol`), the manifest version
  (`manifest_version`) and the WIT worlds are versioned apart, each by its own
  rules. A change to one of them is not an SDK version, and an SDK version does
  not change them.
- **Before 1.0**, Cargo's caret rule applies: `0.MINOR` is the compatibility
  track. A breaking change bumps the minor version (0.2 to 0.3). An addition
  or a fix bumps the patch version (0.2.0 to 0.2.1). **From 1.0**, a breaking
  change bumps the major version, an addition bumps the minor version and a fix
  bumps the patch version.
- **These changes are breaking:**
  - removing or renaming an exported item, or changing a signature
  - adding a method without a default to a trait that others implement
  - adding a supertrait to such a trait
  - adding a grant family, which is a new supertrait of `AllServices`. It
    also needs its own blanket `impl<T: HostServices> NewServices for T {}`
    in `legacy.rs`, or legacy implementors stop being `AllServices`; that is
    the one change the frozen trait's file still takes.
  - a default body that answers anything but `NotGranted` for the same grant
  - a new variant in an exhaustive enum
  - a new public field in a struct whose fields are all public, except
    `CallContext` and `PersonDecision` under the contract below
  - removing or renaming a Cargo feature
- **These changes are not breaking:**
  - adding a method with a `NotGranted` default to a family, when the method
    is dyn-compatible: no generic parameter or `Self` in its signature, or
    `where Self: Sized`, so `dyn AllServices` and `dyn ReadServices` still
    work. A method that is not is breaking.
  - adding a `Cx` or `SpaceCx` method
  - a new `HostError` variant (the enum is `#[non_exhaustive]`)
  - a new field in `CallContext` or `PersonDecision`. This is the SDK's own
    contract, and it is stricter than Cargo's guide, which counts a new public
    field as breaking. Code outside the host builds these structs with
    `..Default::default()` and matches them with `..`. Code that builds or
    matches them exhaustively is outside the contract and may break in a
    patch release.
- **Name collisions.** A new method can make a call ambiguous (`E0034`) in
  code that has another trait with a method of the same name in scope. As in
  Cargo's guide,
  that is a possible break, not a breaking change: it does not bump the
  minor version, and the changelog names the method.
- **The host and its plugins.** A compiled plugin is linked into the host
  binary, and the host takes its `Plugin` only if both resolve to the same
  `umbel-sdk` crate. Cargo can link two incompatible versions into one
  binary, and then the plugin's `Plugin` is not the host's and the build
  fails. A plugin crate therefore depends on the SDK from the same source as
  the host, and on the same `0.MINOR`. While the SDK is unpublished, that is a
  path or git dependency on the same checkout, as the plugins under
  `plugins/` have: `umbel-sdk = { path = "../../sdk" }`.
- **Releases.** Every version bump adds an entry to the changelog below. The
  crate stays `publish = false`. Publishing it is the maintainer's decision, at
  phase 7, Distribution and guides.

## Changelog

### 0.2.0

- **Breaking:** the host services are split into 21 traits, one per grant
  family, combined as `AllServices` and `ReadServices`
  ([#1775](https://github.com/lushly-dev/afd/issues/1775), D218).
  - `Reader::new` takes a `Box<dyn ReadServices>`.
  - `NoServices` and the mounted server's services implement the family traits
    and no longer implement `HostServices`.
  - A type cannot implement both `HostServices` and a family trait (`E0119`),
    so a legacy implementor moves to the families all at once.
  - With both `HostServices` and a family trait in scope, a method called on
    a legacy implementor itself is ambiguous (`E0034`); see above.
  - `HostServices` is frozen. Every type that implements it is still an
    `AllServices`, so `Cx::new`, which now takes `impl AllServices`, takes it
    as before.

### 0.1.0

- The plugin SDK as phases 1 to 5 built it, before this version policy.
