# Phase 6, the approach for the desktop's SQLite store (#1928)

- Date: 2026-11-27
- Area: phase 6, hosts and distribution
- Pull request: [#3005](https://github.com/lushly-dev/afd/pull/3005), on `t3/loam-desktop-sqlite-store-approach`, for [#1928](https://github.com/lushly-dev/afd/issues/1928)

The approach `needs:approach` asks for, as an amendment of phase 6's
[10.5](../phases/6-hosts/spec.md#105-the-store-and-d52s-measurement), proposed and not yet approved. The
desktop's store and journal go in `<app data>/loam.sqlite`, with `SqliteAdapter`'s schema and two tables of
the desktop's own, on one connection the Rust host owns (WAL, `synchronous = FULL`), behind an
operating-system lock and a per-page-load lease. Four IPC commands (`store_open`, `store_read`,
`store_write`, `store_move`) take a table, an id, a JSON value and a lease, never a path or SQL; the
contract's rules stay in TypeScript (`DesktopStoreAdapter`, `DesktopJournalSink`), and filters run in
SQLite with results exactly `queryRows`'. `loam-desktop store backup` and `store path` serve backups and
outside readers, and AFD's `SqliteAdapter` gains `readOnly`. The move from IndexedDB is checked by count
and content before the drop and starts again when interrupted. Steps 11c to 11e build it, P6-D8 tests
it, section 16 gains six codes, and the owner's Q7 and Q8 ask about automatic backups and a copy kept
after the move. D160 and D106 point to the amendment; no new decision is needed.

Verified 2026-11-27 by `pnpm verify` on Node 26 and `node scripts/check-doc-lines.mjs`. Nothing is built
yet: the three step lines under phase 6 wait for the coordinator's approval.
