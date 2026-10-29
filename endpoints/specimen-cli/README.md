# Specimen CLI endpoint

Install `@lushly-dev/specimen-cli` to obtain the `specimen` binary. The commands remain `list`, `render ID`, `diff LEFT.json RIGHT.json`, and `build OUTDIR`; option validation, one CommandResult JSON value on stdout, atomic output files, and exit codes (0 success, 1 failure) are unchanged. `runCli` and `CliIO` are exported for embedding and testing. This endpoint composes Specimen and AFD through `@lushly-dev/specimen-afd`. The inspected application does not need those endpoint dependencies.

```sh
specimen list --root ./component-project
specimen render button --root ./component-project --viewport 375x812
```

Chromium is required when rendering, not for importing or listing. Browser installation remains explicit; this package has no install hooks. See [the unreleased transition](../../docs/features/active/platform-monorepo/specimen-transition.md). Publication remains quarantined.
