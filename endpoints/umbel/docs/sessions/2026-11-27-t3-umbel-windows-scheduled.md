# A daily Windows job for the stores and clippy

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2967](https://github.com/lushly-dev/afd/pull/2967), on `t3/umbel-windows-scheduled`

After #2948 fixed two Windows gaps that reached `main` unseen (#2847), the owner agreed on
2026-11-27 to a small scheduled Windows job rather than a Windows leg on every pull request.
`umbel.yml` gains `windows` (`Umbel (Windows stores and clippy)`), on the daily schedule and manual
runs only, as the MSRV check is: the workspace clippy step and the stores' clippy step, `cargo test
-p umbel-store -p umbel-store-embedded` and `cargo test -p umbel --lib shared::person`, in bash so a
failing command stops the step, with aws-lc-sys's prebuilt NASM objects. `scheduled-failure-issue`
already tracks the Umbel workflow, so a failure files an issue. `sync-ci.mjs`'s remote line for
`umbel.yml` names it. The 2026-10-31 follow-up row "Windows in the `umbel.yml` matrix" records
what is still open.

Verified 2026-11-28 (UTC): a manual run of the branch,
[46100451303](https://github.com/lushly-dev/afd/actions/runs/46100451303), passed the job on
`windows-latest` in 24 minutes from a cold cache (clippy 6, the stores' tests 10, the person store's
7), with every other job of the run green or, as on any manual run, plugin isolation skipped; the timeout of 60 is two and a half times that. The red
evidence is local, not from this job: the same commands failed on Windows before #2948, as
[its session record](2026-11-27-t3-umbel-windows-migration-copy.md) says. `pnpm verify` passed all
31 steps, and `merge-group-contract`, `sync-ci --check` and their tests pass.
