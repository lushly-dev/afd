# The copy before a migration on Windows

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2948](https://github.com/lushly-dev/afd/pull/2948), on `t3/umbel-windows-migration-copy`, for [#2847](https://github.com/lushly-dev/afd/issues/2847)

Two Windows gaps from #2740 (D214). The copy taken before a migration
(`store-embedded/src/migration_copy.rs` and `shared::copy_before_migration` for `person.sqlite3`)
flushed `<copy>.partial` through a handle opened only to read. Linux allows that; Windows refuses
`FlushFileBuffers` on such a handle with "Access is denied" (os error 5), so on Windows every store
at an older schema version failed to open, and `workspace-backup`, which copies its SQLite files
through the same `copy_database`, failed too. Both now open the file to write before `sync_all`. And
`workspace_backup.rs`'s `DirBuilder` is mutated only on Unix, so `unused_mut` failed the workspace
clippy step on Windows; the binding now allows it off Unix.

Verified 2026-11-27 on Windows 11 (Rust 1.100), in the default `%TEMP%`: the two `migration_copy`
tests failed with os error 5 before the change and pass after it. `cargo test --locked -p umbel
--lib shared::person` (13), `cargo test --locked -p umbel-store -p umbel-store-embedded` (52, 43,
28 and 157, `lane_schema` among them), `cargo test --locked -p umbel --test it store_commands`
(17, `workspace-backup`'s), umbel.yml's workspace clippy step and its `knowledge` job's
`umbel-store-embedded` clippy step, and `cargo fmt --all --check` pass. Two independent reviews
(Opus 5.5 high, Gemini 4 Neon high) approved. Left: `umbel.yml` runs on Linux, and macOS on
schedule, with no Windows leg, so nothing keeps Windows from regressing; that leg is the open
2026-10-31 follow-up row "Windows in the `umbel.yml` matrix" in [STATUS.md](../STATUS.md), which
the owner has not approved.
