# Health dashboard

A static, local page for reading Health audit reports (report schema 1.1). You pick
or drop report files and it shows each report's targets, every check result and an
overall verdict. It's an optional endpoint: Health audits and CI run without it, and
nothing here is installed with Health.

> **Status:** `@lushly-dev/health-dashboard` 0.1.0 is `private: true` and quarantined in
> `scripts/release/inventory.json` with no route. Nothing is published or deployed.

## Privacy

Reports stay on your device. The page reads selected files in the browser and keeps
them in memory only: no upload, telemetry, cookies, local storage or third-party
request. Its Content Security Policy allows only its own inlined, hash-pinned script and
stylesheet and `connect-src 'self'`, so the one request it can make is a `?report=`
path on the server that serves it. Reports record each target's absolute path; treat
them as private when sharing, and note that the dashboard displays that path.

## Build and open

From the repository root, with the Node version in `.nvmrc`:

```sh
pnpm install --frozen-lockfile
pnpm -F "@lushly-dev/health-dashboard..." build
```

The build writes one self-contained file, `endpoints/health-dashboard/dist/index.html`
(script and styles inlined). Open it directly from disk, or serve the directory with
any static server, for example:

```sh
python3 -m http.server --bind 127.0.0.1 8000 --directory endpoints/health-dashboard
```

## Load reports

- **Select or drop files.** Use **Browse files** or drop JSON files on the drop area.
  You can load several reports at once; removing a file from the list removes its report.
- **`?report=` (served pages only).** `dist/index.html?report=../fixtures/reports/mixed-status.report.json`
  loads a path relative to the page; repeat the parameter for more reports. Absolute
  URLs, other origins and other schemes are refused before any request. It doesn't
  work from `file://`, where browsers block reading local files.

Create a report with Health, for example:

```sh
python -m lushly_health audit --targets targets.toml --policy policy.toml --output-dir health-reports
```

## What it shows

Per report: the generator, schema and generation time (UTC), an overall verdict with
its reasons, summary counts for all seven statuses, a targets table with a per-target verdict, and a checks
table (status, check, target, severity, message, evidence, remediation) that you can
filter by status and target and sort.

- **Statuses** `passed`, `failed`, `warn`, `skipped`, `disabled`, `unavailable` and
  `error` each have their own words, icon and color/fill, so none relies on color. Only
  `passed` uses the success treatment.
- **Verdict.** Health writes the verdict into the report; the dashboard recomputes it with
  the same platform rule ([proposal](../../docs/features/active/platform-monorepo/proposal.md#quality-verdicts-and-command-effects))
  to explain it, and rejects a report whose recorded verdict disagrees. A report or
  target passes only when it has at least one counted required check and every counted
  required check passed. Required checks `disabled` by the policy are not counted. A
  required `failed`, `error`, `unavailable`, `warn` or `skipped` result prevents a pass;
  advisory results stay visible but never decide it; an empty report, or one with no
  counted required checks, is "Not passing: no required checks".
- **Invalid files are never shown as reports.** A file is rendered only when it parses
  as JSON, declares `schema_version` 1.1, validates against Health's
  [`report-1.1.json`](../health/src/lushly_health/schemas/report-1.1.json) and is
  consistent (unique targets, outcomes naming known targets and checks, summary counts
  and the verdict equal to what the outcomes give). Reports with schema 1.0 are refused
  with an explanation: write them again with the current Health. Otherwise you get an error naming the file, what's wrong and
  what to do. Files over 10 MB aren't read.

The schema isn't copied: the build compiles Health's schema file into a standalone
Ajv validator, so the shipped page needs no `eval`.

## Composition

- FAST-AF only: `@lushly-dev/fast-element` and `@lushly-dev/violet-elements` (file
  upload, select, badge, alert, empty state, button, icon) with violet-elements'
  built-in light and dark theme, applied through a constructed stylesheet. The page
  follows `prefers-color-scheme`.
- No AFD dependency: the page runs no commands and has no server.
- Violet's token engine and runtime (`foundations/violet`) are not used. A Violet theme
  would be an optional, separate composition; the page must keep working without it.
- `pnpm check:boundaries --dependencies @lushly-dev/health-dashboard` lists its
  repository edges: the two FAST-AF packages and `lushly-health`, declared in
  `architecture.json` as a configuration dependency for the build-time schema read.
  Nothing depends on the dashboard.

## Development

```sh
pnpm -F @lushly-dev/health-dashboard test          # browser-free units; part of pnpm check
pnpm -F @lushly-dev/health-dashboard typecheck
pnpm -F @lushly-dev/health-dashboard exec playwright install chromium
pnpm -F @lushly-dev/health-dashboard test:browser  # Chromium: statuses, invalid files, keyboard, CSP, axe
pnpm -F @lushly-dev/health-dashboard fixtures:check
node endpoints/health-dashboard/scripts/verify-health-isolation.mjs
```

`fixtures/reports/` is written by `pnpm -F @lushly-dev/health-dashboard fixtures`, which
runs the real Health CLI (through uv and `endpoints/health`'s lock) on small plain
repositories it creates in a temporary directory, then replaces each target path with
`<fixture>/<id>` and pins `generated_at` to `2026-01-01T00:00:00Z`. `fixtures/invalid/` is hand-written. `fixtures:check` fails when the
committed reports differ from the CLI's output. `verify-health-isolation.mjs` builds
Health's wheel from a copy of its sources and fails if it has an unconditional
requirement or ships any frontend file.

[`health-dashboard.yml`](../../.github/workflows/health-dashboard.yml) runs all of
these; `pnpm check` runs the build, typecheck and unit suites.
