# Specimen CLI endpoint

**Preview,** like [Specimen](../../foundations/specimen/README.md): the commands can still change. It is admitted for the npm `preview` prerelease, with Specimen.

Install `@lushly-dev/specimen-cli` to obtain the `specimen` binary. The commands are `list`, `validate`, `inspect ID`, `render ID`, `run ID`, `migrate`, `diff LEFT.json RIGHT.json`, and `build OUTDIR`. Option validation, one CommandResult JSON value on stdout, atomic output files, and exit codes (0 success, 1 failure) are unchanged. `runCli` and `CliIO` are exported for embedding and testing. This endpoint composes Specimen and AFD through `@lushly-dev/specimen-afd`. The inspected application does not need those endpoint dependencies.

```sh
specimen list --root ./component-project
specimen validate --root ./component-project --file src/button.stories.ts
specimen render button --root ./component-project --viewport 375x812
```

`validate` checks the retained stories a configuration discovers, statically; `--id ID` or `--file PATH` narrows it to one story or file. A report with errors is still a successful command: `data.valid` is `false` and each issue carries a suggestion.

`coverage [TAG]` runs the selected cases and reports each component's required partitions at the level those runs earn. `--file`, `--tag`, `--match` and `--workers` narrow it.

`contract [TAG]` reports what FAST-AF's Fastbot story contract would, on evidence from a run, and exits non-zero when it is not valid. `--file`, `--tag`, `--match` and `--workers` narrow it.

`suggest TAG` proposes native specimens and claims for a component's gaps, always as unverified. `--gaps A,B` names them, or a coverage run finds them, and `--out FILE` saves the module, never over an existing file.

`migrate` previews the codemod over the configured story files; `--files A,B` narrows it, `--helpers` switches helper and type imports instead of naming components, and `--apply` writes the proposals. `inspect ID` reports an entry's resolved args, context and component schema without rendering it. `matrix ID` captures one entry once per combination of comma-separated `--theme`, `--viewport`, `--container`, `--locale`, `--reduced-motion` and `--motion` values, with `--workers N`, and compares each cell with the first; an unavailable cell stays in the report. `profile [ID]` measures entries at `--checkpoint` (default `mount`) over `--runs N` fresh runs (default 3), and compares with a recorded baseline; with no ID or selection it profiles everything that has one. `baseline ID` records the results in the file `profile.baselines` names, with `--note TEXT`. A failed budget or a broken run exits 1. `a11y [ID]` runs an accessibility check at `--checkpoint` (default `after-run`), on one entry or those `--file`, `--tag` and `--match` select, with `--workers N`; a failed check exits 1. `run` without an ID runs a suite: `--file PATH`, `--tag A,B` and `--match TEXT` select stories, `--workers N` limits how many run at once, `--retry` retries up to `--flake-cap N` failures once (default 2), and `--capture all|failed|none` chooses which stories keep a capture (default `failed`). A run whose stories failed exits 1. `run ID` runs a retained story's render, play and accessibility check, and takes the same context options as `render` except `--checkpoint`. `render` also accepts `--container`, `--theme`, `--locale`, `--reduced-motion`, `--motion`, `--checkpoint` and `--screenshot`. Context values pass through the shared schema, so a misspelled theme or an invalid locale tag fails before a browser starts.

Chromium is required when rendering, not for importing or listing. Browser installation remains explicit; this package has no install hooks. See [the unreleased transition](../../docs/features/active/platform-monorepo/specimen-transition.md).
