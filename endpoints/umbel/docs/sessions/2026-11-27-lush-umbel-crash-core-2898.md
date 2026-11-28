# Crash-point tests leave no core file

- Date: 2026-11-27
- Area: every other area
- Pull request: [#2962](https://github.com/lushly-dev/afd/pull/2962), on `lush/umbel-crash-core-2898`, for [#2898](https://github.com/lushly-dev/afd/issues/2898)

`UMBEL_TEST_CRASH_AT=<point>` makes `umbel-store-embedded`'s `testkit` crash point call
`std::process::abort()` (`src/memory/points.rs`), in children that `memory_keyfile.rs`,
`memory_backup.rs` and `memory_machine_backup.rs` start from the test binary. Where a container
allows unlimited cores and the kernel's `core_pattern` is `core` (Colima on `random`, so the Loam
OS session image there), each abort wrote a `core` file into the crate folder, Cargo's working
directory for integration tests. `pnpm verify` then wrote no record, because the checkout had
changed.

The fix, on every host: `umbel-process` gains `disable_core_dumps()`, a safe function that lowers
the soft `RLIMIT_CORE` to 0 (its Unix module already holds Umbel's process FFI; a no-op elsewhere),
with a unit test that raises the soft limit to the hard one where the host allows cores, then
checks that a child shell reads `ulimit -c` as 0. The crash point calls it before it aborts, so
`testkit` now pulls in `umbel-process`; `umbel-store-embedded` keeps its one `unsafe` exception. The three tests also run their children in a temporary working directory of
their own, so a core that could not be turned off lands outside the checkout and outside the
store's directory, whose contents the tests check, and each asserts that its child's directory is
still empty, so a crash point that stops turning cores off fails them where cores are allowed
instead of hiding behind the directory. No other test in the repository aborts a child
on purpose: the component fixture's `probe-trap` is a WebAssembly trap, and the C++ fuzzers abort
only on a real bug.

Verified on Hero, 2026-11-27, in a container from the session image built from this branch's
container file (unchanged from `main`), started with `--ulimit core=-1` and the Docker VM's
`core_pattern` set to `core` for each run, then restored (Docker Desktop's defaults, a limit of 0
and a pipe, hide the bug). On `main` at `acbe384de`, `cargo test -p umbel-store-embedded --test
it memory_` passed 71 and left `?? endpoints/umbel/store-embedded/core` (4 MB). With the fix,
`cargo test --no-fail-fast --locked -p umbel-store -p umbel-store-embedded -p umbel-process`
passed (5, 52, 43, 28 and 160 on the first form; on the final form 159 of 160, the one failure
`memory_keyfile.rs:153`'s `forget: Busy` under load, [#2728](https://github.com/lushly-dev/afd/issues/2728),
which then passed 5 of 5 alone), `git status --porcelain --untracked-files=all` was empty and no
`core` file was anywhere in the container. With the rlimit call removed, 7 crash tests failed on
the new assertion, and the checkout stayed clean.

Not done here: the issue's second check, a full `pnpm verify --all` in the image that writes its
record, which needs a run of about two hours on `random`; #2898 stays open for it.
