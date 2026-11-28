# The required journal mode (Loam OS M1 step 1)

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2947](https://github.com/lushly-dev/afd/pull/2947), on `lush/umbel-required-journal-2913` ([#2913](https://github.com/lushly-dev/afd/issues/2913))

Built D208 as amended by D221, with the details they left open recorded as
[D224](../decisions.md): `JournalPolicies` and `HostBuilder::with_journal_policies`, the
innermost required-mode middleware over `state/journal.ahead.jsonl` (an intent synced before
the handler, keyed by the dispatch id, and an outcome written when `next` returns), the
`JOURNAL_UNAVAILABLE` and `DISPATCH_ID_MISSING` refusals, the policy sink that holds buffered
entries and drops and counts the rest while the journal cannot be written, the unsettled report
on open, and the `JournalHealth` handle with `writable`, `pending`, `dropped` and `flush`. The
approval that admits a held required call is filed beside its intent through
`with_on_approval_accepted`. A compiled or component plugin can now mark a success as changing
nothing (`Outcome::with_no_change`), which the gate keeps only for an instance with no store write grant whose call wrote no store
revision, so no event is projected. A workspace with no policies installs none of it. A
Windows-only `unused_mut` in `workspace_backup.rs` that failed clippy on Windows is allowed
there.

Verified on Hero (Windows 11) on 2026-11-27, with `TMP` and `TEMP` at `C:\Users\falki\.tmp-hero`:
`cargo test --locked -p umbel --test it journal_required` (14 passed), `cargo test --locked -p
umbel --lib journal_policy` (5 passed), and `cargo clippy --locked -p umbel -p umbel-sdk
--all-targets -- -D warnings` clean. The full `pnpm verify` result is in the pull request.

The first review (Opus 5.5 and GPT-6.2 Astra, both high) found the write-ahead file's directory
never synced once the open had made the file, a torn last line swallowing the next record, a
dropped call able to write a held entry twice, a reference cycle that kept a dropped host's
journal state alive, a fresh policy host refusing its own restore, and a no-change marker that a
store-writing plugin could set over a ledger race. All are fixed: the open makes no file, each
append starts its own line and syncs the directory on the process's first append, the sink's
writes run on tasks of their own, the handle holds the sink weakly, and only an instance with no
store write grant may say no change.

Left open, in the follow-ups of every other area: the write-ahead file is never compacted and the
backup, `store-check` and the doctor do not read it; two processes number `seq` on their own
until Loam OS step 10 forwards the command line; an embedder cannot mark an unsettled intent
reconciled; and, from before D224, a memory writer's ordinary store revision and the trace-keyed
call ledger. Loam OS step 2 reads the handle in `host-status`.
