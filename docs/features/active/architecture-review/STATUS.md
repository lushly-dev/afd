# Architecture review: status

Epic: [#1732](https://github.com/lushly-dev/afd/issues/1732). File new work for this area as its sub-issue.

This file tracks the follow-up work from an architecture review of the whole repository on 2026-11-21, at `e6395319d`. Each issue carries its own evidence and acceptance criteria; read the issue before starting. Active since 2026-11-21.

## How to keep this file

- A pull request edits the line of the issue it works on and no other: append "merged in #N" when its work lands, or "closed: <reason>" when it is closed without a change. Issues sit under their area, with a blank line between them, so two branches don't conflict on adjacent lines.
- No sentence says which issues are done or next: read the lines and the issues.
- An issue filed later under the epic gets its own line under its area in the pull request that files or first works on it.
- A question the owner answers is recorded in [decisions.md](decisions.md) or in the area's own decision log, and the line of its issue says where.

## Related epics

These keep their own work; this review only cross-references them.

- [#1551](https://github.com/lushly-dev/afd/issues/1551), parity closure (closed 2026-11-26; its remaining gaps are standalone issues)
- [#1555](https://github.com/lushly-dev/afd/issues/1555), output budgets
- [#1385](https://github.com/lushly-dev/afd/issues/1385), FAST-AF's place in AFD
- [#1387](https://github.com/lushly-dev/afd/issues/1387), test integrity and trends
- [#1546](https://github.com/lushly-dev/afd/issues/1546), Umbel, and [#1541](https://github.com/lushly-dev/afd/issues/1541), Loam

## Issues

### The contract

- [#1733](https://github.com/lushly-dev/afd/issues/1733) spec: a JSON Schema for CommandResult, CommandError, BatchResult, PipelineResult and StreamChunk; merged in #1950

- [#1734](https://github.com/lushly-dev/afd/issues/1734) spec: vectors written from the specification, and AFD's own validation issue codes; merged in #2142

- [#1735](https://github.com/lushly-dev/afd/issues/1735) decide: a stable core contract with versioned profiles, advertised on the wire: decided 2026-11-21, yes to all three ([decisions.md](decisions.md), AR1 to AR3), which also answers [#541](https://github.com/lushly-dev/afd/issues/541); the work is #1925, #1926 and #1927; merged in #1940

- [#1736](https://github.com/lushly-dev/afd/issues/1736) spec: a dispatch-order page with vectors run by all four languages; merged in #1950

- [#1737](https://github.com/lushly-dev/afd/issues/1737) spec: deadlines, cancellation and batch limits in execution-controls.md, with vectors; merged in #2142

- [#1738](https://github.com/lushly-dev/afd/issues/1738) docs: one capability manifest per language, with the parity tables rendered from it; merged in #2196

- [#1739](https://github.com/lushly-dev/afd/issues/1739) conformance: a shared protocol case file every backend runs, checked against the result schema; merged in #2142

- [#1740](https://github.com/lushly-dev/afd/issues/1740) spec: error-code entries with retryability and profile, and a reserved prefix for hosts; merged in #1950

- [#1741](https://github.com/lushly-dev/afd/issues/1741) mcp: read-only hints from Python, Rust and C++, and a typed error in every outputSchema

- [#1742](https://github.com/lushly-dev/afd/issues/1742) docs: a decision record on four hand-written implementations, a shared core or explicit tiers

- [#1925](https://github.com/lushly-dev/afd/issues/1925) spec: the contract as a core and versioned profiles, in one registry; 13 profiles decided 2026-11-27 ([decisions.md](decisions.md), AR4); merged in #2929

- [#1926](https://github.com/lushly-dev/afd/issues/1926) spec: declare core 1.0 (spec/VERSION, the four constants and the changelog)

- [#1927](https://github.com/lushly-dev/afd/issues/1927) mcp: { version, profiles } advertised on server/discover and initialize by all four languages

### TypeScript core and server

- [#1743](https://github.com/lushly-dev/afd/issues/1743) server: one admission pipeline for every TypeScript lane; merged in #2652

- [#1744](https://github.com/lushly-dev/afd/issues/1744) server: pin the MCP SDK and add guard tests for the internals AFD patches

- [#1745](https://github.com/lushly-dev/afd/issues/1745) core: one canonical JSON implementation instead of four

- [#1746](https://github.com/lushly-dev/afd/issues/1746) server: stop recomputing tool lists, context-field schemas and the SDK server on every request; merged in #2660

- [#1747](https://github.com/lushly-dev/afd/issues/1747) core: createCommandRegistry.execute runs the server engine, or is deprecated

- [#1748](https://github.com/lushly-dev/afd/issues/1748) packages: zod as a peer dependency of server, testing and view-state; merged in #2645

### TypeScript packages around the core

- [#1749](https://github.com/lushly-dev/afd/issues/1749) client and cli: _meta on calls, an authorization provider, and the session on streams

- [#1750](https://github.com/lushly-dev/afd/issues/1750) client: a single call() with an unknown write outcome returns OUTCOME_UNKNOWN, not retryable; merged in #2308

- [#1751](https://github.com/lushly-dev/afd/issues/1751) cli: output, errors and exit codes made for agents

- [#1752](https://github.com/lushly-dev/afd/issues/1752) client: a browser-safe McpClient on Streamable HTTP

- [#1753](https://github.com/lushly-dev/afd/issues/1753) local-db: app tables out of the generic contract, typed batches, queries pushed to the store

- [#1754](https://github.com/lushly-dev/afd/issues/1754) auth: SessionSync's refresh lock on the Web Locks API, or removed

- [#1755](https://github.com/lushly-dev/afd/issues/1755) cli: afd validate --execute calls only tools positively marked read-only; merged in #2308

### Python

- [#1756](https://github.com/lushly-dev/afd/issues/1756) python: a tested mcp SDK range, a weekly newest-SDK run, and fewer private internals; merged in #2646

- [#1757](https://github.com/lushly-dev/afd/issues/1757) python: lint and type gates across afd, Botcore, Alfred and Health; merged in #2357

- [#1758](https://github.com/lushly-dev/afd/issues/1758) python: afd.testing installs and imports alone, transports load lazily, root names stop colliding

- [#1759](https://github.com/lushly-dev/afd/issues/1759) python: move the multi-language linter (lushx_ext) out of the runtime wheel

- [#1760](https://github.com/lushly-dev/afd/issues/1760) python: per-call schema work cached, one result rule for raw returns, one telemetry type; merged in #2646

### Rust

- [#1761](https://github.com/lushly-dev/afd/issues/1761) rust: a public surface that can stay stable, before 0.3.0

- [#1762](https://github.com/lushly-dev/afd/issues/1762) rust: one compiled input validator, built once at registration; merged in #2464

- [#1763](https://github.com/lushly-dev/afd/issues/1763) rust: split commands.rs and collapse the server-only state on CommandContext

- [#1764](https://github.com/lushly-dev/afd/issues/1764) rust: per-call allocation and a file journal that does not block async threads

- [#1765](https://github.com/lushly-dev/afd/issues/1765) rust: gates for the crate (MSRV per tier, a CI lockfile, fuzzing, lints, the missing feature build, a wasm run); merged in #2357

### C++

- [#1766](https://github.com/lushly-dev/afd/issues/1766) cpp: the registry honours cancellation and deadlines; a cancelled queued request no longer runs

- [#1767](https://github.com/lushly-dev/afd/issues/1767) cpp: fuzz the stdio server, keep a corpus, build the compiler floor, measure coverage

- [#1768](https://github.com/lushly-dev/afd/issues/1768) cpp: hot-path copies in pipeline resolution, CommandContext and the middleware chain

- [#1769](https://github.com/lushly-dev/afd/issues/1769) cpp: an ABI and distribution strategy, and Expected that traps instead of undefined behaviour

### Umbel

- [#1770](https://github.com/lushly-dev/afd/issues/1770) umbel: a journal lifecycle (what is recorded, segments with retention, an fsync policy, streamed catch-up)

- [#1771](https://github.com/lushly-dev/afd/issues/1771) umbel: indexed event reads instead of linear scans of unbounded files

- [#1772](https://github.com/lushly-dev/afd/issues/1772) umbel: restore, a workspace-wide backup, and a copy before migrations

- [#1773](https://github.com/lushly-dev/afd/issues/1773) umbel: metrics per command and structured logs for operators

- [#1774](https://github.com/lushly-dev/afd/issues/1774) umbel: a crate and test layout that stops the 14 GB target directory; merged in #2357

- [#1775](https://github.com/lushly-dev/afd/issues/1775) umbel: the plugin SDK's HostServices split by grant family, with SDK semver

- [#1776](https://github.com/lushly-dev/afd/issues/1776) umbel: throughput of the per-request rate limit and the readable-graph cache

- [#1931](https://github.com/lushly-dev/afd/issues/1931) umbel: one v1 of each pre-release shape, and architecture.json's surfaces generated from versions.rs

- [#1932](https://github.com/lushly-dev/afd/issues/1932) umbel: the owner's review of D158 to D188 before phase 5's steps 11 and 12

### Loam

- [#1777](https://github.com/lushly-dev/afd/issues/1777) loam: persistent storage and a workspace export on the local path

- [#1778](https://github.com/lushly-dev/afd/issues/1778) loam: the kernel split by domain, with import rules, and private interfaces without version chains

- [#1779](https://github.com/lushly-dev/afd/issues/1779) loam-desktop: a macOS job, and the frame-to-IPC barrier measured on WKWebView

- [#1780](https://github.com/lushly-dev/afd/issues/1780) loam: deployment reading moves out of the developer CLI, so the hosted server stops importing it

- [#1928](https://github.com/lushly-dev/afd/issues/1928) loam-desktop: the store in a SQLite file the Rust host owns

- [#1929](https://github.com/lushly-dev/afd/issues/1929) loam: an end date for D115 and an asserted first-contentful-paint ceiling; merged in #2260 and #2939 (D115 ends on 2026-11-30, D161)

- [#1930](https://github.com/lushly-dev/afd/issues/1930) loam: the hosted lane frozen behind its own CI job, and the local MockAuthAdapter renamed

### Foundations, integrations and their tools

- [#1781](https://github.com/lushly-dev/afd/issues/1781) violet-afd: commands on defineCommand with domain-action names, and the domain moved into violet-core

- [#1782](https://github.com/lushly-dev/afd/issues/1782) boundaries: build-time edges, sub-layers in the endpoint families, examples in scope, stale entries out; merged in #2296

- [#1783](https://github.com/lushly-dev/afd/issues/1783) violet-elements: its own unit, outside FAST-AF's upstream provenance and inside the size gate; merged in #2347

- [#1784](https://github.com/lushly-dev/afd/issues/1784) violet-elements: Firefox and WebKit in the suite, an anchor-positioning fallback, a unique anchor per popover; merged in #2347

- [#1785](https://github.com/lushly-dev/afd/issues/1785) violet-elements: per-component exports and define modules, so one import registers one component

- [#1786](https://github.com/lushly-dev/afd/issues/1786) violet: one token pipeline and one runtime theming path

- [#1787](https://github.com/lushly-dev/afd/issues/1787) specimen: a pinned browser revision, optional build-only dependencies, and the Windows host in the consumer check

- [#1788](https://github.com/lushly-dev/afd/issues/1788) specimen: the pack format from one schema for the TypeScript and Rust readers

- [#1789](https://github.com/lushly-dev/afd/issues/1789) cli: violet-cli and specimen-cli generated from their command definitions

- [#1790](https://github.com/lushly-dev/afd/issues/1790) fast-element: a version that names the upstream line it carries, and a peer range that does not force re-releases

### Botcore

- [#1791](https://github.com/lushly-dev/afd/issues/1791) botcore: serve through the AFD server layer, with effects as AFD metadata and Botcore in conformance

- [#1792](https://github.com/lushly-dev/afd/issues/1792) botcore: every capability on the managed surface, and the CLI generated from the host catalog

- [#1793](https://github.com/lushly-dev/afd/issues/1793) botcore: CI runs every package's tests, the factory on macOS and Windows, and a multi-process lock test; merged in #2220

- [#1794](https://github.com/lushly-dev/afd/issues/1794) botcore: blocking work off the event loop, and process groups killed on timeout

- [#1795](https://github.com/lushly-dev/afd/issues/1795) botcore: one plugin loader with failure containment and a plugin API version

- [#1796](https://github.com/lushly-dev/afd/issues/1796) botcore-factory: a state store with bounded growth, fsync before rename and a safe stale-lock break

- [#1797](https://github.com/lushly-dev/afd/issues/1797) botcore-teams: a missing command returns made-up results instead of a failure

### Gates and CI

- [#1798](https://github.com/lushly-dev/afd/issues/1798) ci: path filters cover every input a suite reads, starting with spec/**

- [#1799](https://github.com/lushly-dev/afd/issues/1799) ci: scheduled failures open an issue, fail-fast off, schedules for every language, PR titles linted, job timeouts; merged in #2296

- [#1800](https://github.com/lushly-dev/afd/issues/1800) ci: shared setup and caching, a reusable queue job, and suites.mjs generated from the workflows; merged in #2296

- [#1801](https://github.com/lushly-dev/afd/issues/1801) gates: gate scripts canonical in scripts/, not inside generated skill content; merged in #2296

- [#1802](https://github.com/lushly-dev/afd/issues/1802) gates: the size gate and the bloat sweep over Rust, Python, C++ and code AFD authors inside imported families; merged in #2296

### Documents and owner decisions

- [#1803](https://github.com/lushly-dev/afd/issues/1803) docs: Loam's and Umbel's STATUS files fit on one screen, with history archived

- [#1804](https://github.com/lushly-dev/afd/issues/1804) decide: owner questions from the architecture review (Loam store and scope, Umbel versions and unread decisions): decided 2026-11-21, each as recommended (Loam's D160 to D162, Umbel's D200 and D201; listed in [decisions.md](decisions.md#recorded-in-an-areas-log)); the work is #1928 to #1932; merged in #1940

### Dependencies

- [#1805](https://github.com/lushly-dev/afd/issues/1805) dependencies: pnpm 12, Python 3.11 to 3.14, Rust 1.100, jsonwebtoken 12, rusqlite 0.43, Tauri patches, a WASI 0.3 plan
