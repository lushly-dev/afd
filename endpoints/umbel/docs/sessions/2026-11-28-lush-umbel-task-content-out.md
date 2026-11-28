# What a task keeps: no content, no input

- Date: 2026-11-28
- Area: phase 5, auth and hosted
- Pull request: [#3048](https://github.com/lushly-dev/afd/pull/3048), on `lush/umbel-task-content-out`

The security review of the #2506 change (GPT-6.2 Astra, 2026-11-28) found two ways a task kept
what 12.2 says it never keeps ([#3010](https://github.com/lushly-dev/afd/issues/3010)). A pipeline
built its result from its steps' data without their `dev.umbel/trust: "content"` label, so a
`knowledge-refresh` task kept a result the store refuses from `sources-sync` itself; the pipeline
now carries the label when any step's result had it. And the store kept a command's failure as it
came, though its words may repeat the call's input; it now keeps a failure in the host's words: its
own notices rebuilt with their recovery advice, any other failure as a registered code (else
`COMMAND_EXECUTION_ERROR`) and whether it is retryable. It refuses any trust label, `external`
included, and caps the result as stored. Both reviews (Astra, Claude) of the first version found
the host notices and the mounted label; the second version covers them. The
phase 5 specification has a section for it (Amendments from #3010).

Verified 2026-11-28 on Windows with a private temp folder. The task store's 19 unit tests passed,
and so did the 29 pipeline and task end-to-end tests. The knowledge plugin's end-to-end test of
both paths, which fails without the pipeline change, lands in its own pull request (the plugin
isolation gate). `pnpm verify` passed every step but the stores' clippy,
which fails on Windows on `memory_keyfile.rs`'s unix-only import from #3007, not on this change.
