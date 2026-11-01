# Specimen CLI endpoint

Install `@lushly-dev/specimen-cli` to obtain the `specimen` binary. The commands are `list`, `validate`, `inspect ID`, `render ID`, `run ID`, `diff LEFT.json RIGHT.json`, and `build OUTDIR`. Option validation, one CommandResult JSON value on stdout, atomic output files, and exit codes (0 success, 1 failure) are unchanged. `runCli` and `CliIO` are exported for embedding and testing. This endpoint composes Specimen and AFD through `@lushly-dev/specimen-afd`. The inspected application does not need those endpoint dependencies.

```sh
specimen list --root ./component-project
specimen validate --root ./component-project --file src/button.stories.ts
specimen render button --root ./component-project --viewport 375x812
```

`validate` checks the retained stories a configuration discovers, statically; `--id ID` or `--file PATH` narrows it to one story or file. A report with errors is still a successful command: `data.valid` is `false` and each issue carries a suggestion.

`inspect ID` reports an entry's resolved args, context and component schema without rendering it. `run ID` runs a retained story's render, play and accessibility check, and takes the same context options as `render` except `--checkpoint`. `render` also accepts `--container`, `--theme`, `--locale`, `--reduced-motion`, `--motion`, `--checkpoint` and `--screenshot`. Context values pass through the shared schema, so a misspelled theme or an invalid locale tag fails before a browser starts.

Chromium is required when rendering, not for importing or listing. Browser installation remains explicit; this package has no install hooks. See [the unreleased transition](../../docs/features/active/platform-monorepo/specimen-transition.md). Publication remains quarantined.
