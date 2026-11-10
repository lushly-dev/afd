# Phase 6 specification: hosts and distribution

| Field | Value |
| --- | --- |
| Phase | 6, hosts and distribution ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 6 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 3 specification](../3-identity/spec.md) (its [10.2](../3-identity/spec.md#102-what-phase-6-must-deliver-first), [9.5](../3-identity/spec.md#95-the-server-kernel-and-its-chain), [2.5](../3-identity/spec.md#25-where-provider-mode-is-enforced), [7.5](../3-identity/spec.md#75-the-providers-own-endpoints) and [7.6](../3-identity/spec.md#76-freshness) above all), the [phase 1 specification](../1-app-contract/spec.md)'s [7.1](../1-app-contract/spec.md#71-how-a-browser-reaches-an-instance), the [scope and projects specification](../2-scope-projects/spec.md)'s [3.3](../2-scope-projects/spec.md#33-over-mcp) and [6.2](../2-scope-projects/spec.md#62-a-deep-link-and-the-base), the [architecture](../../architecture.md), the [decision log](../../decisions.md), [`spec/authorization.md`](../../../../../spec/authorization.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-09 by the design sub-agent, after phase 3's approval and the coordinator's decision of the same day that phase 6's hosted lane comes first ([phase 3's 10.3](../3-identity/spec.md#103-the-order-recommended-for-the-coordinator-to-decide)). **Not yet reviewed or approved.** It proposes D100 to D108 ([decision log](../../decisions.md)), asks the owner three questions ([Questions for the owner](#questions-for-the-owner)), and proposes five amendments to phase 3's specification ([Proposed amendments to phase 3](#proposed-amendments-to-phase-3)), none of which moves a trust boundary phase 3 approved.
- **Last verified:** 2026-11-09 against `main` at `37f383c0`, from this evidence read in the repository:
  - **AFD's MCP handler:** `packages/server/src/server.ts:245-248` (`createMcpHandler` returns a Node `(req, res)` handler and starts no server), `:140` and `:188` (a server's actor defaults to `{ kind: 'agent' }`); `packages/server/src/http-handler.ts:49` (`JSON_RPC_PATHS`), `:406`, `:410` and `:466` (routes matched on the absolute path: `/mcp`, `/health`, `/sse`, `/message`, `/rpc`, `/batch`, `/stream/*`); `packages/server/src/http-security.ts:30-66` (`validateHttpRequest`: the scheme is `https` only on a `TLSSocket`, `:35`; `allowedHosts` defaults to loopback names, `:39`; an `Origin` other than the request's own needs `allowedOrigins`, `:43-53`; `Sec-Fetch-Site` without `Origin`, `:56-64`).
  - **Stores and journal:** `packages/local-db/src` has the memory, IndexedDB and HTTP adapters and no SQLite one; `packages/core/src/journal-file.ts:24-44` (`FileJournalSink`, one JSON line per entry, "do not point two sinks (or two processes) at the same file").
  - **Kernel:** `endpoints/loam/packages/kernel/src/commands.ts:9-14` (`SHELL_EXPOSE`, `mcp: false` and `cli: false` for every shell command "until phase 6"), `kernel.ts:303-304` (applied to every boot command); `late/index.ts:66-74` (`PERSON_SESSION`), `:315-357` (`mcpOptions`); `types.ts:94-104` (`host: 'browser' | 'desktop' | 'hosted' | 'test'`, `storeKind: 'memory' | 'indexeddb'`); `apps/mounted.ts:257`, `:292` and `:320` (`pinMountedInput`, `unlistedProject` and `flagsOf`, pure and exported).
  - **Web host and CLI:** `endpoints/loam/packages/web/index.html:5-8` (the CSP as a `<meta>`, so no `frame-ancestors`); `web/src/mount.ts:27` (the mount transport answers its own `GET` with 405, so the page opens no event stream) and `:148-155` (`close()` lets the SDK send its session `DELETE`); `web/test/mounted/mount-relay.ts:1-29` (the test-only relay forwards `POST`, `GET` and `DELETE` with an allow-list of headers); `web/test/browser/harness.ts:196-253` (`serveDeployment`); `cli/src/deployment.ts:327-420` (`writeDeployment`, with `404.html` at `:387` and the 0600 `mountsOut` at `:397`); `cli/src/deployment-analysis.ts:36-40` (`MountAccess` is `{ instance, url, bearer? }`).
  - **Manifest:** `manifest/schemas/deployment.v2.json`: `$defs.site` holds only `base_path`; an instance has `audience`, `transport`, `url`, `bearer_file`, `bearer_env`, `command`, `cwd`, `projects`, `space`, `expose` and `commands`. The projection carries the version as `deployment_version`.
  - **CI and tooling:** `.github/workflows/loam.yml` (jobs `Affected units`, `Build, unit and Chromium`, `Editor walk`, `Mounted against Umbel`); `scripts/loam-exit-check.mjs:36` and `:57` (`WORKFLOWS`, `LOCATIONS`); `scripts/affected/suites.mjs:90` (`loam.yml`'s local entry) and `:128` (`hosted-fixtures.yml` needs `openssl`); `packages/auth/hosted/better-auth/local.ts:80` (`openssl` makes the hosted fixture's certificate); `.nvmrc` is `26`; every Loam unit in `scripts/release/inventory.json` is `quarantined` with `routes: []`.
  - **Phase 3, approved and not yet built:** `@lushly-dev/loam-identity` with `createLoamAuthOptions`, `loamServerPlugin`, `bootstrapOrganization`, `createMcpAuth`, `createServerKernel`, `principalGate` and `credentialsGate` ([its section 1](../3-identity/spec.md#1-units-and-repository-placement)); deployment and projection version 3; steps 0a and 0c for AFD's TypeScript MCP authorization.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-09, and the published packages read for it: `@hono/node-server` 2.1.6 exports `HttpBindings` (`incoming`, `outgoing`) and `RESPONSE_ALREADY_SENT` (`dist/index.d.mts:37-45`, `dist/utils/response.d.mts:2`); `@better-auth/oauth-provider` 1.7.18 exports `oauthProviderAuthServerMetadata` and `oauthProviderOpenIdConfigMetadata`, documented as "Useful when basePath prevents the endpoint from being located at the root".
- **Done:** this specification.
- **Not done:** its review and approval; the owner's answers to Q1 to Q3; everything it specifies.
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 7, identity once; 8, agents are first-class users; 13, deterministic core; 15, AFD first; the architecture's "Hosts" and "Distribution" components: browser, Tauri desktop and hosted server with the same chrome and the same kernel; a static site, desktop installers, an OCI image and an MCP registry entry, with deployers hosting it.
- **Decisions it depends on:** D9 (three app kinds); D14 (placement under `endpoints/loam/`, every unit quarantined); D15 (AFD first); D25 (TypeScript first; the desktop is Tauri 2 with the kernel in the webview); D32 (single-tenant); D33 (Tauri mobile reserved); D36 (Hono, with AFD's `createMcpHandler` mounted by Hono's Node adapter); D46 (the collaboration service after phases 2 and 6); D52 (IndexedDB on the desktop, SQLite only on a measurement); D54 (native apps are trusted code); D55 and D56 as narrowed by **D95** (no `stdio` instance in a `provider` workspace); D62 (the sandbox proxy on a second origin); D63 (no secret in the projection); D64 (the same-origin route `mounts/<instance>/mcp`, which "the hosted lane serves in phase 6"); D65 (a mounted instance's exposure); D71 and D78 (scope over MCP and to an instance); D74 (the URL scheme, `index.html` for a path with no file); D84 (phase 3's hosted criterion on phase 6's development profile); D85 to D99, phase 3's, which phase 6 delivers and does not redesign.
- **Decisions this specification proposes:** D100 to D108, in [Amendments](#amendments-to-the-architecture-and-the-decision-log), each marked "Proposed, pending review" in the decision log.

### Carried from earlier phases, answered here

| Item | Answer |
| --- | --- |
| [Phase 3's 10.2](../3-identity/spec.md#102-what-phase-6-must-deliver-first), items 1 to 6 | Milestone M1, the development profile ([section 5](#5-the-development-profile-milestone-m1)); [5.3](#53-phase-3s-102-item-by-item) maps each item to the test that proves it |
| Phase 3's 2.5: "phase 6 decides how a browser sends" the trust-record commands | [Section 6](#6-trust-records-on-the-hosted-lane-d103) |
| Phase 3's 4.3: "phase 6 measures" the cost of no cookie cache | [Section 14](#14-budgets), row `whoami` |
| Phase 2's 3.3: `mcpOptions().commands` "with `expose.mcp` as phase 6 will decide"; phase 0's 6.1: "phase 6 revisits" CLI and MCP exposure | [Section 7](#7-the-hosted-mcp-surface-d104) |
| Phase 2's 6.2: "phase 6's hosted lane serves" `index.html` for a path with no file, and documents `frame-ancestors` | [3.4](#34-routes) and [3.5](#35-response-headers-and-the-csp) |
| Phase 0's 9: `frame-ancestors` "moves to a response header with the hosted lane" | [3.5](#35-response-headers-and-the-csp) |
| Phase 1's follow-up: the route `mounts/<instance>/mcp` "must require `Origin` or `Sec-Fetch-Site`" | [Section 8](#8-the-mount-relay-d105), as phase 3's 10.2 item 5 already requires |
| Phase 1's follow-up: "run the mounted suite against a real hosted server, with its secrets, membership and limits, on the same route" | P6-M1 ([section 19](#19-exit-criterion-and-tests)) |
| Phase 1's catalog: `secrets`, "Phase 6" | [Section 13](#13-secrets-d108): resolved on the server only; the grant moves to phase 5 with `http` |
| D52: SQLite on the desktop "admitted in phase 6 only on a measurement" | [10.5](#105-the-store-and-d52s-measurement) |
| [#706](https://github.com/lushly-dev/afd/issues/706): run the suites in Firefox and WebKit | Partly: the desktop lane runs the shell in WebKitGTK and WebView2 (P6-D1); Firefox and Safari stay with #706 |
| [#711](https://github.com/lushly-dev/afd/issues/711): "whether the browsers phase 6 adds differ" on WebRTC from a view | Recorded, not decided: P6-D3 records the result in each webview; the decision stays the owner's on #711 |
| [#858](https://github.com/lushly-dev/afd/issues/858): first paint on a real low-end device | Stays open: it needs a device, not a host. The development profile makes the measurement easy to take over a network; [follow-ups](#follow-ups) |
| OP10: "a server card, a well-known catalog entry and a plain guide for agents" | [11.5](#115-the-server-card-the-catalog-and-the-guide) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-09 (sources S88 to S97 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 6 |
| --- | --- | --- | --- |
| W7 | Tauri 2.12.5 on 2026-10-21; 3.0 in alpha | The `tauri` crate 2.12.5 (2026-10-21, MSRV 1.90) is current; `@tauri-apps/cli` 2.12.4 (2026-10-21); 3.0.0-alpha.6 (2026-11-06) [S90]. WebDriver: "Driven directly, only Windows and Linux are supported on desktop, as macOS has no WKWebView driver tool available" (page updated 2026-06-29) [S91] | The desktop lane pins 2.12; Linux runs the suite under `tauri-driver` on pull requests, Windows daily, macOS builds only ([10.7](#107-the-desktop-suite)) |
| W30 | Chrome's Local Network Access since 142, split in 145; Firefox and Safari not found | Chrome 142 launched the prompt (Chrome's post, updated 2025-09-29); 145 split `local-network-access` into `local-network` and `loopback-network`, keeping the old name as an alias (blink-dev intent to ship) [S93]. Firefox and Safari: not found on 2026-11-09 | Unchanged reasoning: a browser reaches an instance through the hosted server (D64). The hosted shell's `Permissions-Policy` denies both to the page ([3.5](#35-response-headers-and-the-csp)) |
| W21 | Windows on-device agent registry in preview; "the desktop packages the hosted server as an MCP bundle" | Not re-checked; nothing in phase 6 waits on it | The MCP bundle stays reserved ([section 18](#18-out-of-scope-and-the-seams-reserved)) |
| New W34 | Not watched | `hono` 4.13.17 (2026-11-07), 5.0.0-rc.1 tagged `next`; `@hono/node-server` 2.1.6 (2026-11-02), peer `hono` `^4 \|\| ^5.0.0-0`, Node `>=20`; its Node bindings expose `incoming` and `outgoing`, and `RESPONSE_ALREADY_SENT` tells it the handler wrote the response [S88, S89] | The hosted server on Hono 4.13 (D101); Hono 5 is watched |
| New W35 | Not watched | The MCP Registry is in preview, "Breaking changes or data resets may occur before general availability"; `server.json` at schema `2025-12-11`; OCI images on Docker Hub, GHCR and three cloud registries, verified by the `io.modelcontextprotocol.server.name` annotation; it "**does not** support private servers" [S94] | A registry entry can describe Loam's image, never a deployer's private server; phase 6 writes and validates it, and submits nothing ([11.4](#114-the-registry-entry)) |
| New W36 | Umbel's R11 cites SEP-2127 | SEP-2127, MCP Server Cards, is **Final**; a card "MAY" be at `<streamable-http-url>/server-card`, media type `application/mcp-server-card+json`, `Access-Control-Allow-Origin: *`, `ETag` and `304`; an AI Catalog "MAY" be at `/.well-known/ai-catalog.json`; cards carry no tools and nothing sensitive [S95] | The hosted server serves a card; the catalog is the deployer's choice ([11.5](#115-the-server-card-the-catalog-and-the-guide), Q2) |
| New W37 | Not watched | Node 26 is LTS ("Lithium"), 26.13.0 on 2026-10-28; `node:26-trixie-slim` updated 2026-11-05 [S96] | The hosted server and image run Node 26 (`.nvmrc`); the image pins its base by digest |
| W33 (phase 3) | MCP Authorization, Better Auth issuing tokens | Unchanged since 2026-11-09. `@better-auth/oauth-provider` 1.7.18 ships helpers for serving its metadata at the origin's root when a `basePath` keeps it off it; `better-auth` 1.7.19 appeared 2026-11-10, inside the three-day `minimumReleaseAge`, so phase 3's pin of 1.7.18 holds [S97] | The hosted server owns the origin's `/.well-known/oauth-*` paths ([3.7](#37-the-provider-and-the-well-known-documents)) |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and phases 2's and 3's. This specification adds:

| Term | Meaning |
| --- | --- |
| Hosted server | `@lushly-dev/loam-host`: one Node process serving a deployment's shell, provider, MCP route, trust-record transport and mount relay ([section 3](#3-the-hosted-server-d101)) |
| Server configuration | `loam.server.toml`: what only the server reads, never served: its origin, listener, TLS, data directory, secrets, mail and single sign-on ([3.2](#32-the-server-configuration-loamservertoml-version-1)) |
| Data directory | The server's one directory: its store, journal, provider database, mail sink, written site and lock ([section 4](#4-the-servers-store-and-journal-d102)) |
| Development profile | The hosted server on `https://localhost` with a generated certificate and a mail sink, started by one command ([section 5](#5-the-development-profile-milestone-m1)) |
| Production profile | The hosted server on the deployer's origin, on TLS files or behind a TLS-terminating proxy, with real mail ([section 9](#9-the-production-profile-milestone-m2)) |
| Trust-record command | A command whose records the hosted server holds authoritatively, run there from a browser ([6.1](#61-which-commands-run-on-the-server)) |
| Hosted relay | The real `mounts/<instance>/mcp` route, replacing phase 1's test-only relay ([section 8](#8-the-mount-relay-d105)) |
| Milestone | A named exit point inside phase 6 that unblocks something on its own ([section 1](#1-milestones-and-the-order-d100)) |

## 1. Milestones and the order (D100)

### 1.1 Four milestones and the exit

| Milestone | What it delivers | What it unblocks | Steps |
| --- | --- | --- | --- |
| **M1, development profile** | Everything phase 3's 10.2 lists, on `https://localhost`, by one command, with the `Hosted development profile` job | **Phase 3's step 10** (P3-H1 to P3-H5) and **phase 5**'s MCP criterion | 0a, 1 to 7 |
| **M2, hosted lane** | The production profile: the deployer's origin, TLS or a proxy, real mail and single sign-on, limits, `doctor` | **The collaboration service's specification** (D46's "after phases 2 and 6" read as M2, D100) | 8 |
| **M3, desktop lane** | The same build in Tauri 2 on Linux, Windows and macOS, with mounts over the Rust host | Nothing before phase 7 | 11, 12 |
| **M4, distribution** | The static site documented, the OCI image, installers, the registry entry and the server card, built and verified, **nothing published** (Q1) | Nothing before phase 7 | 9, 10, and 12's installers |
| **Exit** | M1 to M4, and the copilot served from the same process once phase 5's runtime exists ([section 12](#12-the-copilot-in-the-same-process)) | **Phase 7** | 13 |

**Why the exit waits for phase 5.** The architecture's exit criterion says the hosted server serves "the copilot from one process", and the copilot runtime is phase 5's. Phase 6 provides the seam; the row that proves it runs when phase 5 has a runtime. Phase 7 needs phases 4, 5 and 6 anyway, so nothing waits longer than it would.

**M1 is the earliest exit point.** Steps 1 and 2 need nothing of phase 3 and can start at once; steps 3 to 6 follow phase 3's steps as 1.2 lists; step 7 records M1. Nothing in M2, M3 or M4 is on M1's path.

### 1.2 Dependencies on phase 3's steps

Phase 3's plan is in [its section 19](../3-identity/spec.md#19-implementation-plan).

| Phase 6 step | Needs from phase 3 | Why |
| --- | --- | --- |
| 0a, SQLite adapter | Nothing | AFD's `local-db` |
| 1, host skeleton | Nothing | Serves `local` deployments of versions 1 to 3 |
| 2, development profile | Nothing | HTTPS, certificate, data directory, harness |
| 3, provider and deployment version 4 | **Step 1** (`createLoamAuthOptions`, `loamServerPlugin`, deployment version 3) and **step 4** (`bootstrapOrganization`; the join and recovery pages) | 10.2 items 1 and 2 |
| 4, server kernel and MCP | **Steps 0a and 0c** (AFD's TypeScript MCP authorization) and **step 7** (`createServerKernel`, `createMcpAuth`, `credentialsGate`, the OAuth pages) | 10.2 item 3 |
| 5, trust-record transport | **Step 7** (`principalGate`'s session source) | 10.2 item 4 |
| 6, hosted relay | **Step 7** (the server's membership read and `decideAccess` version 2) | 10.2 item 5 |
| 7, M1 recorded | Phase 3's step 9's `--phase` option in the exit check, if it has merged; otherwise step 7 adds it and step 9 rebases | 10.2 item 6 |

Phase 3's step 10 needs phase 6's step 7. Phase 3's steps 0b, 2, 5, 6 and 8 are not on phase 6's path.

## 2. Units and repository placement

Two new packages, private and quarantined, under the workspace glob `endpoints/loam/packages/*` (D14):

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/packages/host/` | `@lushly-dev/loam-host` | **Server only.** `createLoamHost(config)` ([section 3](#3-the-hosted-server-d101)); the `loam-host` bin (`dev`, `start`, `bootstrap`, `check`, `doctor`); the server's store and journal; the trust-record transport; the hosted relay; the server card, catalog and guide; under `/testing`, `startDevHost()` ([5.2](#52-the-test-harness)); `Containerfile` ([11.2](#112-the-oci-image)) | `hono` **4.13.17** and `@hono/node-server` **2.1.6**, exact; `nodemailer` **10.4.0**, exact (step 8); `@lushly-dev/loam-identity`, `@lushly-dev/loam-kernel`, `@lushly-dev/loam-manifest`, `@lushly-dev/loam-cli` (for `writeDeployment`), `@lushly-dev/afd-server`, `@lushly-dev/afd-client`, `@lushly-dev/afd-core`, `@lushly-dev/local-db`; dev: `smtp-server` **3.21.3** (step 8), `@lushly-dev/loam-web` |
| `endpoints/loam/packages/desktop/` | `@lushly-dev/loam-desktop` | The Tauri 2 app: `src-tauri/` (the Rust host crate `loam-desktop`, `publish = false`, its own `Cargo.lock` committed), the front end being `web`'s `dist`; the desktop's mount transport over IPC ([section 10](#10-the-desktop-lane-d106)) | `@tauri-apps/cli` **2.12.4** and `@tauri-apps/api` **2.12.4**, exact; crates `tauri` **2.12.5**, `tauri-build` **2.7.4**, `tauri-plugin-single-instance` **2.5.5**, `tauri-plugin-updater` **2.14.1**, each `=`-pinned; `tauri-driver` **2.1.0** in CI |

- **Pins and age.** Each version above is past the workspace's three-day `minimumReleaseAge` on 2026-11-10, when `hono` 4.13.17 (published 2026-11-07T04:56Z) and `nodemailer` 10.4.0 (2026-11-07T20:30Z) clear it. A step that lands earlier takes `hono` 4.13.16 (2026-11-01).
- **The host never reaches a browser.** E13's scan of phase 3 gains `@lushly-dev/loam-host`: no import of it from `web/src`, `chrome/src` or `kernel/src`.
- **The Rust toolchain.** `packages/desktop/src-tauri/rust-toolchain.toml` pins **1.98.0**, Umbel's, so the shared `CARGO_TARGET_DIR` builds third-party crates once; `pnpm rust:sweep` covers it as a Cargo workspace with a `target/`.
- **Release inventory.** Two entries in phase 1's shape: `loam-host` and `loam-desktop`, `state: "quarantined"`, `routes: []`, `fixed: false`, `private: true`; `loam-host`'s gates are `pnpm check`, `loam.yml`, `release-approval`; `loam-desktop`'s add `loam-desktop.yml`. **Nothing publishes** (Q1).
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names both, in steps 1 and 11.
- **`AGENTS.md`.** The architecture tree gains `host` and `desktop`; the Loam key rule names the new job, step and workflow; the CI table gains `loam-desktop.yml`. Steps 1, 2 and 12 do it.
- **Changesets.** Step 0a carries one for `@lushly-dev/local-db`. None for the private units.

| Existing package | Change |
| --- | --- |
| `kernel` | `shellExposeOf(name)` in place of `SHELL_EXPOSE` ([section 7](#7-the-hosted-mcp-surface-d104)); `HOSTED_MCP_COMMANDS` and `SERVER_COMMANDS`, frozen lists; the `late-hosted` chunk with `trust-record-settle`, `trust-record-snapshot` and the routing of trust-record commands ([section 6](#6-trust-records-on-the-hosted-lane-d103)); `KernelPortsV1` gains an optional `serverCall`; `storeKind` gains `'sqlite'`; `flagsOf`, `unlistedProject` and `pinMountedInput` re-exported from the package root for the relay |
| `manifest` | `deployment.v4.json` and `projection.v4.json` with `[host]` ([3.3](#33-the-deployment-version-4)); `loam.server.toml`'s schema `server.v1.json` and `readServerConfig` |
| `cli` | `deployment write --host static\|hosted\|desktop`; `MountAccess` gains `stdio` entries for `--host desktop` ([10.4](#104-mounts-over-the-rust-host)) |
| `web` | `server-call.ts`, loaded by `late-hosted` only; the harness's `openShell` takes a `DevHost` ([5.2](#52-the-test-harness)); the CSP checks read the response header too |
| `identity` | Nothing new; the host consumes it |
| `local-db` (AFD) | `SqliteAdapter` at `@lushly-dev/local-db/sqlite` ([section 4](#4-the-servers-store-and-journal-d102)) |

## 3. The hosted server (D101)

### 3.1 One process

One Node 26 process, `loam-host start` (or `dev`), on Hono 4.13 through `@hono/node-server` 2.1's `serve`, with `node:https`'s `createServer` when the server terminates TLS. Everything a deployment serves is in it: the shell, the provider, the MCP route, the trust-record transport, the hosted relay, the server card, and from phase 5 the copilot's routes. **One process per data directory, and one deployment per process.** No cluster or worker threads: the server kernel is the only writer of its store, as phase 2's `ProjectCache` assumes, and the lock ([section 4](#4-the-servers-store-and-journal-d102)) holds it.

```ts
export interface LoamHostConfig {
	server: ServerConfigV1;                 // read by `readServerConfig` (3.2)
	deployment: string;                     // the path of `loam.deployment.toml`, version 4 with `[host] kind = "hosted"`
	dist: string;                           // the web host's `vite build` output
	modules?: readonly HostModule[];        // phase 5's copilot, and test fixtures (12)
}
export interface HostModule {
	/** A path segment under `<base_path>api/`; `auth`, `kernel` and `health` are reserved. */
	name: string;
	routes(app: Hono<{ Bindings: HttpBindings }>, host: HostServices): void;
}
export interface HostServices {
	/** The checks of 6.2's first two rows, then the principal from the session, as phase 3's 9.5 builds it. */
	sessionPrincipal(request: Request): Promise<{ ok: true; principal: ServerPrincipal } | { ok: false; response: Response }>;
	kernel: ServerKernel;
	journal: JournalSink;
}
export function createLoamHost(config: LoamHostConfig): Promise<LoamHost>;
export interface LoamHost { readonly origin: string; readonly sandboxOrigin: string | null; listen(): Promise<void>; close(): Promise<void> }
```

`createLoamHost` refuses to construct, with its code ([section 16](#16-failure-modes-and-error-codes)), on any refusal of 3.2 or 3.3, a locked data directory, an unreadable secret, a `provider` deployment with a `stdio` instance (D95, `DEPLOYMENT_STDIO_TEAM`), or a `provider` deployment whose organization was never bootstrapped (`HOST_NOT_BOOTSTRAPPED`, naming `loam-host bootstrap`).

### 3.2 The server configuration, `loam.server.toml` version 1

The deployment file says what the workspace is and what the browser may know (D63). **What only the server reads goes in a second file**, which phase 3's 2.2 calls "the hosted lane's" configuration: `manifest/schemas/server.v1.json`, read by `readServerConfig`, never served, never in a projection.

```toml
server_version = 1

origin = "https://loam.example.com"   # exact: scheme, host and port; the deployment's base_path follows it
listen = "127.0.0.1:8443"              # host:port
data = "/var/lib/loam"                 # the data directory (section 4); created 0700

[tls]                                  # absent: plain HTTP, allowed only on a loopback `listen` behind a TLS proxy
cert_file = "/etc/loam/fullchain.pem"
key_file = "/etc/loam/privkey.pem"

[sandbox]                              # needed when the deployment has a view app (D62)
origin = "https://sandbox.loam.example.com"   # must equal the deployment's [sandbox] origin; served by this process, by Host

[auth]
secret_file = "/etc/loam/auth-secret"  # or secret_env = "LOAM_AUTH_SECRET"; at least 32 bytes

[mail]
transport = "smtp"                     # "sink" (the development profile's) or "smtp"
from = "Acme Loam <loam@example.com>"
smtp_url_env = "LOAM_SMTP_URL"         # or smtp_url_file; smtps:// or smtp:// with STARTTLS required

[oidc.corp]                            # one table per `oidc:<id>` in the deployment's [identity] methods
issuer = "https://login.example.com"
client_id = "loam"
client_secret_file = "/etc/loam/oidc-corp"

[limits]                               # defaults shown
request_body_bytes = 1048576
relay_response_bytes = 4194304
relay_concurrency_per_person = 16
relay_timeout_ms = 60000

[discovery]                            # Q2; defaults shown
server_card = true
ai_catalog = false
agent_guide = false
```

| Refusal | Code |
| --- | --- |
| Unknown key, wrong type, `server_version` not 1 | `HOST_CONFIG_INVALID` |
| `origin` not `https:`, with a path, query, fragment or userinfo; `http:` is allowed only for `localhost`, `127.0.0.1` and `[::1]` | `HOST_ORIGIN_INSECURE` |
| No `[tls]` and a `listen` that is not a loopback address | `HOST_LISTEN_INSECURE` |
| A secret given both ways, neither, an unreadable file, an empty variable, or an auth secret under 32 bytes | `HOST_SECRET_UNAVAILABLE` |
| On POSIX, a secret file, `key_file` or the data directory readable by group or others | `HOST_SECRET_PERMISSIONS`, naming the file and `chmod 600` (`700` for the directory) |
| `[sandbox] origin` present and different from the deployment's, or the same site as `origin` | `HOST_SANDBOX_INVALID` |
| An `oidc:<id>` method with no `[oidc.<id>]`, or a table no method names | `HOST_OIDC_INVALID` |
| `[mail] transport = "sink"` with an `origin` that is not loopback | `HOST_MAIL_SINK_EXPOSED`: a sink keeps join and recovery links in a file, which only the development profile may do |

**The origin is configured, never derived.** No `X-Forwarded-*` header is read, ever. Every request's `Host` must be `origin`'s host and port, or `[sandbox] origin`'s; any other is `421 Misdirected Request` with nothing run (`HOST_MISDIRECTED`). Better Auth's `baseURL`, the passkey `rpID` and `origin`, the MCP resource, AFD's `allowedHosts` and `allowedOrigins`, and the server card's URL all come from `origin` and `base_path`.

### 3.3 The deployment, version 4

`deployment.v4.json` and `projection.v4.json`; `readDeployment` reads 1 to 4, `readBoot` and `readProjection` 2 to 4. Everything of version 3 stands. It adds:

```toml
deployment_version = 4

[host]
kind = "hosted"     # "static" (the default, as versions 1 to 3 read), "hosted" or "desktop"
```

- **The projection** gains `host: { kind: 'static' | 'hosted' | 'desktop' }`, and for `hosted`, `kernel: 'api/kernel'`, a same-origin path under `base_path`, as phase 3's `identity.path` is. Nothing else.
- **`deployment write --host <kind>`** sets the kind when the file does not, and refuses a mismatch (`DEPLOYMENT_HOST_MISMATCH`). `loam-host` runs `writeDeployment` itself into its data directory with `--host hosted`, so the deployer never copies a written site by hand.
- **Rules.** `[identity] mode = "provider"` with `kind = "static"` is a warning, `DEPLOYMENT_PROVIDER_NEEDS_HOST`: "A provider deployment needs the hosted server; a static host serves no provider" (phase 3's test-only auth host still serves one in tests). `provider` with `kind = "desktop"` is refused, `DEPLOYMENT_DESKTOP_PROVIDER` ([10.1](#101-what-the-desktop-is)). `stdio` with `kind = "static"` keeps phase 1's `MOUNT_TRANSPORT_UNAVAILABLE` at run time; with `kind = "desktop"` it is served ([10.4](#104-mounts-over-the-rust-host)); with `provider` it stays refused (D95).
- **Version 3 deployments keep working.** A version 1 to 3 file reads as `kind = "static"`. `loam-host` refuses one that is not version 4 with `kind = "hosted"` (`HOST_DEPLOYMENT_KIND`), so a static deployment is never served by the hosted server by accident, and every fixture of phases 0 to 3 stays as it is.
- **The hosted server serves a team.** `loam-host start` refuses a `local` deployment (`HOST_IDENTITY_LOCAL`): phase 3's `createServerKernel` refuses `local`, since there every actor is an owner. `loam-host dev` serves one with the shell's routes only (`<base>mcp`, `api/kernel/call` and `mounts/*` answer 404), so P6-H2 can compare the hosted shell with the static one.

### 3.4 Routes

`<base>` is the deployment's `base_path`. Every route first passes the `Host` check (3.2). **Only these paths reach code; every other path under the origin is the static site's or a 404.**

| Route | Methods | Served by | Auth |
| --- | --- | --- | --- |
| `<base>` and every path below not listed here | `GET`, `HEAD` | The written site: a file if one exists; otherwise, for `Accept` naming `text/html`, `index.html` with `200` (D74); otherwise 404 | None |
| `<base>deployment.json`, `<base>apps/**`, `<base>assets/**` | `GET`, `HEAD` | The written site | None |
| `<base><identity.path>/*` (default `api/auth/*`) | As Better Auth's routes | `auth.handler(request)` from `createLoamAuthOptions` ([3.7](#37-the-provider-and-the-well-known-documents)) | The provider's |
| `<base>mcp` | `POST`; `GET` and `DELETE` as AFD's handler answers them | AFD's `createMcpHandler` ([3.6](#36-mounting-afds-handler)) | Bearer, phase 3's 9.2 |
| `<base>mcp/server-card` | `GET`, `HEAD`, `OPTIONS` | [11.5](#115-the-server-card-the-catalog-and-the-guide) | None; public |
| `<base>api/kernel/call` | `POST` | The trust-record transport ([6.2](#62-the-transport)) | Session |
| `<base>mounts/<instance>/mcp` | `POST`, `DELETE`; `GET` answers 405 | The hosted relay ([section 8](#8-the-mount-relay-d105)) | Session |
| `<base>api/health` | `GET` | `{ "ok": true }`, `Cache-Control: no-store`; nothing else, so it reveals no version or state | None |
| `<base>api/<module>/*` | The module's | A `HostModule` (phase 5's copilot) | The module's, through `sessionPrincipal` |
| `/.well-known/oauth-protected-resource<base>mcp`, `/.well-known/oauth-protected-resource` | `GET` | AFD's handler, M7's two URLs for the resource `<origin><base>mcp` | None |
| `/.well-known/oauth-authorization-server<base><identity.path>`, `<base><identity.path>/.well-known/openid-configuration` | `GET` | `oauthProviderAuthServerMetadata(auth)`, `oauthProviderOpenIdConfigMetadata(auth)` | None |
| `/.well-known/ai-catalog.json` | `GET`, `HEAD`, `OPTIONS` | Only with `[discovery] ai_catalog = true` (Q2); otherwise 404 | None |
| On `[sandbox] origin`: `/sandbox/**` | `GET`, `HEAD` | The written site's `sandbox/` with `frame-ancestors <origin>` (D62); every other path there 404 | None |

- **AFD's other routes are never reachable.** `/sse`, `/message`, `/rpc`, `/batch`, `/stream/*` and `/health` of AFD's handler (`http-handler.ts:406-466`) are not routed, under `<base>` or at the root; P6-H4 asserts each is a 404.
- **One deployment per origin.** The session cookie is host-only with `Path=/` (phase 3's 9.5, `__Host-`), so every path on the origin receives it, and the hosted server answers the origin's root `/.well-known/oauth-*`. So `base_path` serves a proxy that maps a path, never an origin shared with another application. `loam-host check` warns `HOST_ORIGIN_SHARED` when `base_path` is not `/`, with that sentence, and the distribution guide says it.

### 3.5 Response headers and the CSP

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`; on a non-loopback origin, `Strict-Transport-Security: max-age=31536000`. HTML responses add:

| Pages | `Content-Security-Policy` response header |
| --- | --- |
| Every shell page (`index.html` at any path) | **The `<meta>` policy `deployment write` wrote into that `index.html`, read from the file at start, plus `; frame-ancestors 'none'`.** Phase 0's directives are unchanged, so no source widens; the header and the `<meta>` are both enforced, and the header adds only what a `<meta>` cannot carry |
| `~/oauth/login`, `~/oauth/consent`, `~/join`, `~/recover` (phase 3's 9.4, 5.6, 5.7) | The same, plus `; form-action 'self'` |
| `sandbox/` on the sandbox origin | `frame-ancestors <origin>`, as phase 1's harness serves it |

- **`Permissions-Policy`** on shell pages: `camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=()` (W30). `publickey-credentials-get` and `publickey-credentials-create` keep their default, `self`, which passkeys need.
- **Caching.** `index.html`, `404.html` and `deployment.json`: `Cache-Control: no-cache`. `assets/*`, whose names carry their hashes: `public, max-age=31536000, immutable`. Anything else: `no-cache`.
- **A unit holds the header builder**: the header equals the file's `<meta>` content with `frame-ancestors 'none'` appended, for every written `index.html` of the fixtures, and adds nothing else.

### 3.6 Mounting AFD's handler

D36 stands, read against the code: AFD's handler is a Node `(req, res)` handler that matches the absolute paths `/mcp` and `/health` (`http-handler.ts:406-410`). So:

```ts
const mcp = createMcpHandler({
	...kernel.mcpOptions(),                 // phase 3's 9.5: the server kernel's chain, credentialsGate first
	name: 'loam', version: SHELL_VERSION,
	auth: createMcpAuth(config),            // phase 3's 9.3 and 9.4; resource `${origin}${base}mcp`
	allowedHosts: [new URL(origin).hostname],
	allowedOrigins: [origin],
	maxBodyBytes: limits.request_body_bytes,
});
app.on(['POST', 'GET', 'DELETE'], `${base}mcp`, (c) => {
	const { incoming, outgoing } = c.env;   // @hono/node-server's HttpBindings
	incoming.url = `/mcp${new URL(c.req.url).search}`;   // the handler's own path; `base` is the host's
	void mcp(incoming, outgoing);
	return RESPONSE_ALREADY_SENT;           // from '@hono/node-server/utils/response'
});
```

- **The rewrite is the host's.** Only `<base>mcp` is rewritten to `/mcp`; M7's metadata URLs reach the handler unchanged, since 0a builds them from `auth.resource` (`spec/authorization.json`'s `metadataUrls` has a case with a path, `/api/mcp`, which 0a loads).
- **`allowedOrigins: [origin]`.** Behind a TLS-terminating proxy, `validateHttpRequest` reads the scheme as `http` (`http-security.ts:35`), so a browser's `https` `Origin` would be refused without it. No other origin is allowed: CORS is not served, so a browser MCP client on another origin cannot use the route. That is a stated limit ([follow-ups](#follow-ups)).
- **No body is read before the handler.** Hono builds its `Request` lazily, and this route never touches `c.req.raw`'s body, so AFD reads the stream itself.
- **D36's optional fetch-style handler is not needed.** The mount keeps AFD's Host and Origin checks, contexts, confirmations and authorization. The prerequisites table's row stays "optional", for a runtime other than Node.

### 3.7 The provider and the well-known documents

- **Better Auth** at `<base><identity.path>`, from phase 3's `createLoamAuthOptions({ baseURL: `${origin}${base}${identity.path}`, secret, database, organization, methods, mail, oidc, resource: `${origin}${base}mcp` })`, its database `<data>/auth.sqlite` on `node:sqlite`, mounted as `app.on(['GET', 'POST'], `${base}${path}/*`, (c) => auth.handler(c.req.raw))`.
- **Mail.** `mail` is `createMail(server.mail)`: `sink` appends one JSON line per message (`{ to, subject, text, at }`) to `<data>/mail.jsonl`, mode 0600; `smtp` sends through `nodemailer` with the URL from its secret ([section 9](#9-the-production-profile-milestone-m2)). A failed send is logged with the message's kind and recipient's domain only, never the link.
- **The authorization server's metadata at the root.** OAuth clients find the issuer's metadata by RFC 8414's path insertion, `/.well-known/oauth-authorization-server` before the issuer's path, and OpenID's by appending, and both helpers exist for a `basePath` that keeps the provider off the root (S97). **The hosted server owns these paths at its origin's root** (proposed amendment A2).
- **Bootstrap** is `loam-host bootstrap --slug <slug> --name <name> --owner-email <email>`, which runs phase 3's `bootstrapOrganization` against the data directory with the server stopped (it takes the lock): it creates the organization, pins the binding, sends the owner's invitation through `mail`, and prints `{ organization: { id, slug }, invited }`. It refuses when a binding exists (`HOST_ALREADY_BOOTSTRAPPED`) and when the deployment's `[identity] organization` differs from `--slug` (`DEPLOYMENT_IDENTITY_INVALID`). It is the only way the first organization comes to exist (10.2 item 2).
- **The cost of no cookie cache** is measured by P6-H3 ([section 14](#14-budgets)). Secondary storage is added only if the row fails, never the cookie cache.

### 3.8 The `loam-host` commands

Each prints a `CommandResult` as JSON and exits with the AFD CLI's codes, as `loam` (phase 1's CLI) does.

| Command | Does |
| --- | --- |
| `loam-host dev --deployment <file> [--data <dir>] [--port <n>]` | [Section 5](#5-the-development-profile-milestone-m1) |
| `loam-host start --server <file> --deployment <file> --dist <dir>` | Checks, takes the lock, writes the site, starts; on `SIGTERM` and `SIGINT` stops accepting, waits up to 10 s for requests in flight, flushes the journal and releases the lock |
| `loam-host bootstrap --server <file> --deployment <file> --slug --name --owner-email` | 3.7 |
| `loam-host check --server <file> --deployment <file> --dist <dir>` | Every refusal and warning of 3.2, 3.3 and phase 3's 2.2, without starting |
| `loam-host doctor --server <file> --deployment <file>` | `check`, plus: the lock's holder, the binding and `IDENTITY_BINDING_MISMATCH`, each mounted instance reachable with its bearer (`MOUNT_UNREACHABLE` or `MOUNT_UNAUTHORIZED`, never the token), the data directory's files and sizes, and which of them to back up |

## 4. The server's store and journal (D102)

| File in the data directory | Holds | Written by |
| --- | --- | --- |
| `.lock` | `{ pid, startedAt, host }`, created with `wx` | `start`, `dev`, `bootstrap` |
| `loam.sqlite` | The server kernel's workspace store | `SqliteAdapter` |
| `journal.jsonl` | The server kernel's journal, and every relayed call's record ([8.4](#84-what-the-relay-records)) | `FileJournalSink` |
| `auth.sqlite` | The provider's database, with `loamServerPlugin`'s tables | Better Auth |
| `mail.jsonl` | The development profile's sent mail | The sink |
| `site/` | The written site | `writeDeployment` |
| `tls/` | The development profile's certificate and key | `dev` |
| `secrets/` | The development profile's generated auth secret | `dev` |

- **AFD first: `SqliteAdapter`** (step 0a) in `@lushly-dev/local-db/sqlite`, a Node-only entry outside `/` and the browser graph, over `node:sqlite`'s `DatabaseSync`: one table per store table, JSON values, the adapter's indexes as SQLite indexes, `PRAGMA journal_mode = WAL` and `synchronous = NORMAL`, every adapter batch in one transaction. It passes `runDataAdapterContract` from `@lushly-dev/local-db/testing`, as `IndexedDbAdapter` does, with its tests titled for the place `AFD's host path` ([section 19](#19-exit-criterion-and-tests)). `storeKind` gains `'sqlite'`, and `shell-info-get` reports it.
- **The journal** is AFD's `FileJournalSink`. Its own rule, one sink per file per process, is what the lock holds.
- **The lock.** `start` refuses when `.lock` exists and its `pid` is alive on this host (`HOST_DATA_LOCKED`, naming the pid). A lock whose `pid` is gone is stale: `start` replaces it and logs `HOST_LOCK_STALE` with the old `startedAt`. `bootstrap` takes the same lock, so it never runs beside a server.
- **Postgres is reserved.** D32's single tenant and one process fit SQLite. A second writer, or a deployment past SQLite's measured limits, is a follow-up with its own adapter and the same contract.
- **Backups** are the deployer's: `doctor` names the files, and the distribution guide says to copy `loam.sqlite` and `auth.sqlite` with SQLite's online backup or with the server stopped. Nothing in phase 6 automates it.

## 5. The development profile (milestone M1)

### 5.1 One command

`loam-host dev --deployment <file> [--data <dir>] [--port <n>]`, with `--data` defaulting to `.loam-dev/` beside the deployment file:

1. Takes the lock.
2. On first run, makes a self-signed certificate for `localhost` with `openssl` (`req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1`), as the hosted fixture does, into `tls/`, mode 0600; and a 32-byte auth secret into `secrets/auth`, mode 0600. Later runs reuse both until the certificate expires.
3. Writes a server configuration into memory: `origin = "https://localhost:<port>"` (`--port 0` picks a free one), `listen = "127.0.0.1:<port>"`, `[tls]` from step 2, `[mail] transport = "sink"`, and when the deployment has a view app, `[sandbox] origin = "https://localhost:<port + 1>"` on a second listener, a different origin by its port.
4. Writes the site with `--host hosted`, starts, and prints `{ origin, sandboxOrigin, spki, mail }`, where `spki` is the base64 SHA-256 of the certificate's public key.

A deployment for the profile needs `[host] kind = "hosted"`; `--deployment` with an older file is refused as 3.3 says. A `provider` deployment that was never bootstrapped starts, and its shell shows phase 3's `IDENTITY_ORGANIZATION_UNKNOWN` until `loam-host bootstrap --data <dir> …` runs.

### 5.2 The test harness

`@lushly-dev/loam-host/testing` exports:

```ts
export interface DevHost {
	origin: string; root: string; sandboxOrigin: string | null; spki: string;
	mail(): Promise<{ to: string; subject: string; text: string; at: string }[]>;
	db(): { auth: DatabaseSync; loam: DatabaseSync };   // read-only handles, for assertions
	journal(): Promise<JournalEntry[]>;
	logs(): string[];                                    // the server's log lines, for the secrets scan
	restart(): Promise<void>; kill(): Promise<void>;     // `kill` is SIGKILL, for P6-H8
	close(): Promise<void>;                              // removes the data directory on success and failure
}
export function startDevHost(options: {
	config: string;                      // the deployment file's text, as `serveDeployment` takes it
	basePath?: string;
	organization?: { slug: string; name: string };     // bootstraps, then seeds as `startTestAuthHost` does
	people?: { email: string; name: string; role: 'owner' | 'admin' | 'member'; methods?: ('passkey' | 'password')[] }[];
	modules?: HostModule[];
}): Promise<DevHost>;
```

- **The host runs in a child process**, as `startTestAuthHost` does, so a test can `kill` it.
- **Seeding is phase 3's.** People are seeded through the same function `startTestAuthHost` uses, from `@lushly-dev/loam-identity/testing`, against the dev host's provider.
- **Chromium trusts only that certificate:** the harness launches it with `--ignore-certificate-errors-spki-list=<spki>`, so a different certificate is still refused, and cookies are `Secure` as in production.
- **`openShell(page, devHost, path?)`** in `web/test/browser/harness.ts` opens `devHost.root`, as it opens `serveDeployment`'s, and the CSP check also reads the response header.

### 5.3 Phase 3's 10.2, item by item

| 10.2 item | Delivered in | Proved by |
| --- | --- | --- |
| 1. One Node process on Hono serving the built shell under `base_path`, phase 0's CSP as response headers with `frame-ancestors`, and the OAuth pages' stricter CSP | Steps 1, 3 | P6-H1, P6-H2 |
| 2. Better Auth at `<base_path><identity.path>` with its database in the data directory and a mail sink; the one-time bootstrap | Step 3 | P6-H3 |
| 3. `createMcpHandler` at `<base_path>mcp` through Hono's Node adapter, over `createServerKernel` with `credentialsGate` and `createMcpAuth`; RFC 9728 metadata | Step 4 | P6-H4 |
| 4. A server kernel whose store is authoritative for `ProjectV1.access`, `AgentMemberV1` and `WorkspaceAppV1.overrides`, and the transport, with the same-origin JSON `POST` rule | Steps 4, 5 | P6-H5 |
| 5. The mount relay enforces, with the same rule | Step 6 | P6-H6, P6-M1 |
| 6. HTTPS on `localhost` with a generated certificate, by one command; the `Hosted development profile` job and its `Hosted criterion against the development profile` step | Steps 2, 7 | P6-H1, P6-H7 |

**M1 is reached** when P6-H1 to P6-H8 pass in that job on `main`, with every other phase 6 row of steps 0a to 6, and STATUS.md records "development profile reached". Phase 3's step 10 then adds P3-H1 to P3-H5 to the same step.

## 6. Trust records on the hosted lane (D103)

Phase 3's 2.5 makes the hosted server's store authoritative for `ProjectV1.access`, installed agent members and `WorkspaceAppV1.overrides`, and leaves how a browser sends those commands to phase 6. A project's access is a field of the project record, so **the server holds the whole `project` table**, and with it the `agent-member` and `workspace-app` tables. Documents, app stores, personas and view-state stay in each browser: they decide nothing, and moving them is the collaboration service's (D46).

### 6.1 Which commands run on the server

**Only when the projection says `host.kind = "hosted"` and `identity.mode = "provider"`.** In every other deployment nothing here changes: `local` mode, a static host, the desktop, and phase 3's test-only auth host keep their records in the browser.

```ts
/** Run on the hosted server from a browser, in a hosted provider deployment (6.1). */
export const SERVER_COMMANDS = ['project-create', 'project-update', 'project-archive', 'project-restore',
	'workspace-app-set', 'agent-member-add', 'agent-member-update', 'agent-member-remove',
	'agent-member-confirm', 'agent-member-decline', 'trust-record-snapshot'] as const;
```

- **`trust-record-snapshot`**, a new query, served only to the transport: `{}` to `TrustRecordSnapshotV1`, exactly what `project-list { status: 'all' }`, `workspace-app-list` and `agent-member-list { status: 'all' }` answer the session's person on the server, with the server's `generation`.

  ```ts
  export interface TrustRecordSnapshotV1 {
  	generation: number;                 // raised by every successful write of the three tables
  	projects: ProjectV1[];              // only those `project-list` shows this person
  	workspaceApps: WorkspaceAppV1[];
  	agents: AgentMemberRowV1[];         // filtered for the caller, as phase 3's 8.2
  }
  ```

- **In the browser,** each of these is routed in the kernel's `late-hosted` chunk: line 0 and the auth gate run as in phase 3, then instead of its handler, the call goes to `ports.serverCall({ command, input, scope })` and returns the server's `CommandResult` unchanged. **No local write happens on any path.** A transport failure is `SERVER_UNAVAILABLE`, retryable, journaled, with nothing written; a refusal is the server's code (`OWNER_REQUIRED`, `HUMAN_REQUIRED`, `PROJECT_NOT_FOUND`).
- **The agent interface.** A browser's agent never reaches the transport: phase 3's 9.5 says the server takes every session call as the human, and "the browser forwards trust-record calls only from `kernel.call`, never from its agent interface". So on the agent interface, the commands of `SERVER_COMMANDS` that write are refused `HUMAN_REQUIRED` in a hosted provider deployment, before any request; the reads they would refresh are answered from the copy (6.3). An agent's change to a trust record goes over MCP, as its own connected agent.
- **`workspace-deployment-apply`** runs on the server at its start, from the projection it wrote; in a hosted provider deployment, the browser's boot apply writes only its copy and is overwritten by the first settle.

### 6.2 The transport

`POST <base>api/kernel/call`, in this order:

1. **The same-origin JSON rule**, phase 3's 9.5 and 10.2 item 4: `POST` only; `Content-Type` whose media type is `application/json`; `Origin` present and exactly `origin`; `Sec-Fetch-Site` absent or `same-origin`. Any failure is `403` with `{ "code": "REQUEST_NOT_SAME_ORIGIN" }`, nothing read further. No CORS header is ever sent.
2. **The body,** at most `request_body_bytes`, `{ command: string; input: unknown; scope: { workspace: string; project?: string } }` and nothing else; otherwise `400` `REQUEST_INVALID`.
3. **The session,** from the provider with the cookie cache off, then the principal: always the human, never an actor the browser sends; a user id starting `agt_` is `AGENT_CANNOT_SIGN_IN`; no session is `401` with afd-auth's `UNAUTHORIZED` as the body.
4. **The command** must be in `SERVER_COMMANDS`; otherwise `404` `SERVER_COMMAND_NOT_SERVED`. `scope.workspace` must be the deployment's.
5. `serverKernel.call(command, input, { scope, principal })` through phase 3's principal chain, journaled in `journal.jsonl` with the human actor.
6. **The answer:** `200` with `{ result: CommandResult; generation: number }`. A refusal is still `200`, with the refusal in `result`, so the browser journals the server's code.

### 6.3 The browser's copy

- **Stage B** in a hosted provider deployment calls `trust-record-snapshot` once and runs the internal **`trust-record-settle`** top-level, before any call that is not boot's own work and after phase 3's first `session-settle`.
- **After every routed call** whose answer's `generation` differs from the copy's, and on phase 3's 4.3 refresh (focus, `online`, every 60 seconds while visible), the kernel fetches the snapshot and, when `generation` differs, runs `trust-record-settle` top-level before the next queued call.
- **`trust-record-settle { reason: 'boot' | 'call' | 'refresh'; snapshot: TrustRecordSnapshotV1 }`** is internal, like `session-settle`: journaled with its input **as data**, not served, not callable through a port, refused on the agent interface, exempt from line 0. It replaces the three tables' rows with the snapshot's, so a project the person may no longer see leaves the copy, and runs `applyScopeChange(…, 'actor')` if the active project is gone. Its input is at most 2 MiB; a larger snapshot is `TRUST_RECORDS_TOO_LARGE`, journaled, and the copy is left as it was, with a notice in the status bar.
- **What the copy is for.** `ProjectCache`, `canOpen`, `opensIn`, the rail and the projects section read it, so the shell paints and works offline as before. **It grants nothing**: every write is the server's, and the relay decides against the server's records. A copy can be stale by up to 60 seconds for a change someone else made; the server is never stale.

### 6.4 Replay

A routed call's whole effect is on the server, so in a hosted provider deployment **`SERVER_COMMANDS` join the kernel's recorded table**, as phase 3 records the provider-only commands: a replay answers each from its entry and never reaches a server, and one with no entry stops as `REPLAY_NOT_RECORDED`. `trust-record-settle` re-runs from its input, so the copy replays exactly. That amends phase 3's 3.4 for this one deployment kind (proposed amendment A5). In every other deployment phase 3's rule stands: these commands write the browser's store and re-run.

## 7. The hosted MCP surface (D104)

Phase 0 set every shell command's `expose.mcp` and `expose.cli` to `false` "until phase 6". **On the hosted server, MCP serves exactly the commands whose records the server holds or reads from the provider**, so an agent over MCP never writes a store its person cannot see:

```ts
/** Served over MCP by the hosted server (7); every other shell command is `mcp: false`. */
export const HOSTED_MCP_COMMANDS = ['shell-info-get', 'workspace-get', 'workspace-app-list', 'app-list',
	'app-get', 'project-list', 'project-get', 'project-create', 'project-update', 'project-archive',
	'project-restore', 'account-get', 'persona-list', 'member-list', 'agent-member-list',
	'agent-member-get'] as const;
```

- **`shellExposeOf(name)`** replaces `SHELL_EXPOSE`: `palette` and `agent` as today, `mcp: HOSTED_MCP_COMMANDS.includes(name)`, `cli: false`. In the browser nothing changes, since the page serves no MCP.
- **Phase 3's rules stand inside it.** `HUMAN_COMMANDS` and `OWNER_COMMANDS` are not served; an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` with `access`, is `HUMAN_REQUIRED` from the handler; `persona-list` and `account-get` read for the token's person (phase 3's 9.2). `persona-list` answers only `default` on the server, since personas are held in each browser, and its description says so.
- **Not served, and why:** page state (`view-state-*`, `layout-*`, `appearance-*`, `palette-*`, `overlay-*`, `toast-show`, `modal-open`, `status-item-set`, `app-selection-*`, `editor-*`, `section-get`, `scope-get`), because a server has no page; `PERSON_SESSION` and `auth-*`, as phase 2 decided; **documents, `new-list`, `document-type-list`, `project-summary-get` and app commands**, because their records and handlers are in each browser until the collaboration service (D46) and phase 5's calls (Q3); `app-command-list`, `app-instance-list` and `app-instance-refresh`, with mounted instances over MCP, which phase 5's "shell commands over MCP" takes up.
- **A unit holds the list:** every name is registered on the server kernel; none is in `HUMAN_COMMANDS`, `OWNER_COMMANDS`, `PERSON_SESSION` or `INTERNAL_COMMANDS`; `tools/list` over MCP equals it plus AFD's meta-tools, for every token.
- **The CLI.** The AFD CLI can reach `<base>mcp` with `--header "Authorization: Bearer …"`, but it has no OAuth client to obtain a token, so `expose.cli` stays `false` and the CLI is a [follow-up](#follow-ups) for AFD.

## 8. The mount relay (D105)

### 8.1 The route

`<base>mounts/<instance>/mcp` serves phase 1's contract (`MountTransportV2`, unchanged in the browser) with phase 3's 10.2 item 5's enforcement and the amendments A1 and A3. In order:

1. **Method.** `GET` is `405` with `Allow: POST, DELETE`, which the page never sends (`mount.ts:27`). `POST` and `DELETE` continue.
2. **The same-origin rule**, as 6.2's first row; for `POST`, the `application/json` media type. A `DELETE` carries no body and needs `Mcp-Session-Id` (amendment A1).
3. **The session and the principal**, as 6.2's third row.
4. **The instance** must be in the server's deployment, `mounted`, `http`, and enabled in the server's `workspace-app` record; otherwise `404` `INSTANCE_UNKNOWN`, the same bytes for a disabled one.
5. **The body** (`POST`), at most `request_body_bytes`, one JSON-RPC message. **A batch array is `400` `MOUNT_BATCH_REFUSED`** (A3): MCP 2025-06-18 removed batching, and a batch would hide calls from the checks below.
6. **The decision, against the server's records** (10.2 item 5): for `tools/call`, `params._meta["dev.loam/scope"]` must be absent or `{ workspace, project? }` with the deployment's workspace; then `decideAccess` version 2 for the principal's person with the server's `ProjectV1` and membership read for this request; then phase 2's 9.2 through the kernel's own `unlistedProject`; then **the tool's exposure through the kernel's `flagsOf`**, which must give `palette` or `agent` (A3); then **`pinMountedInput`** for a mapped space (A3). Any other method (`initialize`, `notifications/*`, `ping`, `tools/list`) is decided at workspace level, as D78 sends no scope on discovery: membership, then `unlistedProject` with no slug.
7. **The upstream session.** For a legacy-era server, the `Mcp-Session-Id` the instance issues is bound to `(person, instance)`; a request carrying an id bound to another person, or one the relay does not know, is `404` `MOUNT_SESSION_UNKNOWN` with nothing forwarded, which tells an MCP client to start a new session. A `DELETE` is forwarded only for the person's own id, then the binding is dropped.
8. **Forwarding,** as phase 1's 7.1: the request headers' allow-list, the deployer's bearer added from its secret ([section 13](#13-secrets-d108)), no `Origin` and no `Cookie` sent, any `Authorization` from the page dropped; the response's status, `Content-Type`, `Mcp-Session-Id` and body streamed back, stopped past `relay_response_bytes` (`502` `MOUNT_RESULT_INVALID`); `relay_timeout_ms` per request; at most `relay_concurrency_per_person` requests in flight per person (`429` `MOUNT_LIMIT`, `Retry-After: 1`).

Each refusal is `403` (6), `404` (4, 7), `400` (5), `401` (3) or `429` with a body `{ code, message, suggestion }` the kernel's mount transport already maps to its codes, and **nothing reaches the instance**.

### 8.2 The tools the relay knows

`flagsOf` and `pinMountedInput` need each tool's annotations and input schema. The relay discovers each enabled instance itself, at start and every 10 minutes, with the deployer's bearer, through AFD's `StreamableHttpTransport` under phase 1's `DISCOVERY_LIMITS`, and keeps `tools/list`'s annotations and schemas in memory. A `tools/call` for a tool the relay has not seen triggers one rediscovery; still unknown, it is `403` `MOUNT_COMMAND_NOT_EXPOSED`. Rediscovery of one instance is never more frequent than once per 30 seconds.

### 8.3 Discovery is not the person's

Phase 1's kernel discovers through the relay from the browser, as before; the relay's own discovery only feeds 8.1's decision and is never answered to a browser. D55 holds: an instance still sees one principal, the deployer's bearer, so a team instance must be one every member of its projects may read in full, and the relay is what keeps a non-member's request from reaching it.

### 8.4 What the relay records

Each forwarded `tools/call` is appended to the server's journal as a record of command `mount-relay` (not a registered command, and never replayed): `{ instance, tool, actor, scope, status, ms }`, with no arguments, no result and no header. Refusals of 8.1 are recorded the same way with their code. **No token, cookie or session id is ever logged**; P6-H7 scans the logs and journal for them.

## 9. The production profile (milestone M2)

`loam-host start` with a full `loam.server.toml` (3.2):

- **TLS** on the server from `cert_file` and `key_file`, re-read on `SIGHUP` so a renewed certificate needs no restart; or **behind a TLS-terminating proxy** on a loopback `listen`, the origin still configured, never derived (3.2). The distribution guide shows both, and that the proxy must pass `Host` unchanged and must not add CORS.
- **Mail** by SMTP through `nodemailer` 10.4.0, with `smtps://` or STARTTLS required (`requireTLS: true`); a plain `smtp://` URL with no TLS is refused at start (`HOST_MAIL_INSECURE`), except to a loopback host.
- **Single sign-on** from `[oidc.<id>]`, passed to `createLoamAuthOptions`' `oidc`, phase 3's 2.6 rules unchanged.
- **Limits** from `[limits]`; Better Auth's own rate limit on its routes, its default, with the client address taken from the socket, since no forwarded header is trusted. Behind a proxy that address is the proxy's, so the per-address limit becomes a per-deployment one; the guide says so, and a deployer wanting per-client limits sets them at the proxy.
- **Logs** are one JSON line per request on stdout: time, method, route **pattern** (never the path, which can carry a restricted slug), status, ms, and for an authenticated request the actor's kind only. Nothing else.
- **`doctor`** (3.8) complete.

**M2 is reached** when P6-H9 and P6-H10 pass, in the `Hosted development profile` job's step `Production profile on TLS files and behind a proxy`.

## 10. The desktop lane (D106)

### 10.1 What the desktop is

**The same `web` build in Tauri 2's webview, as a personal shell in `local` identity mode** (phase 3's 2.1), with the kernel in the webview (D25), the store in IndexedDB (D52), and mounted instances through the Rust host. A `provider` deployment on the desktop is refused (`DEPLOYMENT_DESKTOP_PROVIDER`): passkeys bind to the deployment's host, which a webview's custom-scheme origin is not, and a team member uses the hosted shell in a browser. Joining a hosted workspace from the desktop is [reserved](#18-out-of-scope-and-the-seams-reserved).

### 10.2 Origins and the CSP

- **The shell** is served by Tauri from the app's assets, at Tauri's own origin for its custom protocol (`tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows). The kernel's `host` is `'desktop'`.
- **The sandbox proxy** is a second custom protocol, `loam-sandbox`, registered by the Rust host with `register_uri_scheme_protocol`, serving only the written site's `sandbox/` with `frame-ancestors` naming the shell's origin. Its origin differs from the shell's, as D62 requires; P6-D3 proves it in each webview.
- **The CSP** is the shell's phase 0 policy in `tauri.conf.json`'s `app.security.csp`, with **`connect-src 'self' ipc: http://ipc.localhost`**, the IPC sources Tauri's own example uses (S92), and `frame-src` the sandbox scheme's origin when a view app is deployed. Tauri appends its hashes and nonces at build time. No other source widens.
- **Capabilities.** One capability file grants the main window `core:default` and Loam's own three commands (10.4), and nothing else: no `shell`, `fs`, `http` or `opener` plugin is installed, so the webview can neither spawn a program nor read a file.

### 10.3 The deployment on the desktop

The person who owns the desktop is its deployer (D56). They write `loam.deployment.toml` with `[host] kind = "desktop"` and run `loam deployment write --host desktop --dist <app's bundled dist> --out <app data>/site --mounts-out <app data>/mounts.json`. The app serves `<app data>/site` when it exists and its bundled empty shell otherwise. **The Rust host reads only `mounts.json`** (mode 0600, outside `site/`), never the TOML; nothing in the webview can write either file, and no command reaches them, so D56's "no command, app or agent may write it" holds by construction.

### 10.4 Mounts over the Rust host

`MountAccess` gains, for `--host desktop` only, `{ instance, transport: 'stdio', command: string[], cwd?: string }` beside phase 1's `{ instance, url, bearer? }`. The desktop's `ports.mountTransport` is `DesktopMountTransport`, behind the same `MountTransportV2`, over three Tauri commands:

| Command | Input | Does |
| --- | --- | --- |
| `mount_open` | `{ instance }` | For `http`: an MCP client in Rust over Streamable HTTP with the bearer, from `mounts.json`. For `stdio`: spawns `command` in `cwd` with a clean environment but `PATH`, `HOME` and the platform's minimum, stdin and stdout piped, stderr to the app's log; returns a handle |
| `mount_send` | `{ handle, message }` | One JSON-RPC message, at most 1 MiB; the reply bounded at 4 MiB, as the web host's |
| `mount_close` | `{ handle }` | Closes the session, or ends the child with `SIGTERM` then, after 5 s, `SIGKILL` |

- **The webview names an instance, never a URL, token or command line.** `mount_open` for an instance not in `mounts.json` is `INSTANCE_UNKNOWN`.
- **A child that exits** fails its calls with `MOUNT_UNREACHABLE`, retryable; the kernel's phase 1 recovery reopens it on the next discovery.
- **Scope** travels in `_meta` exactly as phase 2's 9.2 sends it; the Rust host forwards the message untouched.

### 10.5 The store and D52's measurement

IndexedDB in the webview, as in the browser. **D52's measurement**, taken in step 11 in WebKitGTK and WebView2 on the A4 reference workspace (2,000 documents, 20,000 links): S1, listing every document record of one project, p95 at most 50 ms over 200 runs; S2, 1,000 sequential record writes in at most 2,000 ms. Both pass: no SQLite plugin, and STATUS.md records the numbers. Either fails: a SQLite store through a Tauri plugin is specified by amendment, with the store contract, before it is built.

### 10.6 Native integrations and updates

| Integration | Phase 6 | Why |
| --- | --- | --- |
| Single instance | `tauri-plugin-single-instance`: a second launch focuses the first window | Two kernels on one IndexedDB would race the journal's writer lock |
| Menus | The platform's application menu with "Command palette" (Mod+K, `palette-open`), "Reload", "Quit", and on macOS the standard edit items | Native expectations; each menu item runs a shell command |
| Window state | The OS keeps size and position; nothing persisted by Loam | Layout is the kernel's, not the window's |
| Updates | `tauri-plugin-updater` compiled in, **off unless the build is given a public key and an endpoint** (`LOAM_UPDATER_PUBKEY`, `LOAM_UPDATER_ENDPOINT`); with them, a signed update is required and an unsigned or tampered one refused | Who signs is Q1's |
| Notifications, files, deep links, tray | Reserved | Notifications follow phase 4's inbox; files need a grant no app has; deep links need the URL scheme on a custom protocol |

### 10.7 The desktop suite

`loam-desktop.yml`, a new pull-request workflow with its entry in `scripts/affected/suites.mjs` (the tooling tests require one):

| Job | When | Does |
| --- | --- | --- |
| `Desktop on Linux` | Pull requests touching `endpoints/loam/**` (not `docs/`), the workflow, `endpoints/umbel/**` (not `docs/`, for P6-D2's `hello-mcp`), `packages/rust/**` or the lockfile, gated by `Affected units`; daily; manual | Installs `libwebkit2gtk-4.1-dev`, `webkit2gtk-driver` and `xvfb`; builds `web`, then the app; runs the suite under `tauri-driver` 2.1.0 with `WebKitWebDriver`; builds `.deb` and `.AppImage`; records WebKitGTK's version |
| `Desktop on Windows` | Daily, manual | The same under `msedgedriver`, WebView2; builds `.msi` |
| `Desktop on macOS` | Daily, manual | Builds the `.app` and `.dmg` and runs the Rust tests; no WebDriver suite, since macOS has no WKWebView driver (S91) |

The suite drives the webview through WebDriver's `execute` with the same kernel calls `web`'s harness makes, so its scenarios are the browser's, not a second copy.

## 11. Distribution (D107)

**Every artifact is built and verified in CI. Nothing is published, pushed or submitted in phase 6** (Q1); each stays quarantined in the release inventory until the owner admits it.

### 11.1 The static site

Unchanged from phases 1 and 2: `loam deployment write` with `--host static` (the default). Step 10 writes `endpoints/loam/docs/guides/deploy.md`: a static host must answer `index.html` for a path with no file (D74) and send `frame-ancestors` and the other headers of 3.5 as response headers; the sandbox's second origin (D62); that a static host serves `local` identity only; and the hosted and desktop profiles. The guide is linked from STATUS.md and `endpoints/loam/README.md`.

### 11.2 The OCI image

`endpoints/loam/packages/host/Containerfile`, built in `loam.yml`'s `OCI image` job with the runner's Docker:

- **Base** `node:26-trixie-slim`, pinned by digest in the file, with the digest recorded in step 9 and updated by Dependabot's Docker ecosystem.
- **Two stages:** the first runs `pnpm install --frozen-lockfile` and builds `web`, `host` and their dependencies; the second copies `web`'s `dist` and `pnpm deploy --prod`'s output for `@lushly-dev/loam-host`, with no compiler, `pnpm` or source.
- **Runs as** a non-root user, UID 10001, `ENTRYPOINT ["node", "/app/bin/loam-host.js"]`, `CMD ["start", "--server", "/config/loam.server.toml", "--deployment", "/config/loam.deployment.toml", "--dist", "/app/dist"]`, `VOLUME ["/data"]`, `EXPOSE 8443`, `HEALTHCHECK` on `<base>api/health`, and labels `org.opencontainers.image.source`, `.revision`, `.version` and `.licenses`. The `io.modelcontextprotocol.server.name` label is added only when Q1 admits a registry entry.
- **No secret in the image.** Configuration and secrets are mounted at `/config` and `/run/secrets`; P6-I1 scans the image's filesystem.

### 11.3 Installers

`loam-desktop.yml` builds `.deb` and `.AppImage` on Linux, `.msi` on Windows, `.app` and `.dmg` on macOS, uploaded as workflow artifacts with their SHA-256 sums. **They are unsigned:** an operating system's signing and notarization need identities only the owner can hold (Q1). The guide says how to build a signed one.

### 11.4 The registry entry

`endpoints/loam/packages/host/server.json`, generated from the package's version by `loam-host`'s build:

```json
{
	"$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
	"name": "io.github.lushly-dev/loam",
	"title": "Loam",
	"description": "An agent-first application shell: a workspace's projects, members and apps as MCP tools",
	"version": "<loam-host's version>",
	"packages": [{
		"registryType": "oci",
		"identifier": "ghcr.io/lushly-dev/loam-host:<version>",
		"transport": { "type": "streamable-http", "url": "https://{host}/mcp" }
	}]
}
```

- It describes **the image a deployer runs**, never a deployment: the registry "does not support private servers" (S94), and every Loam deployment is its deployer's.
- **A unit validates it** against the schema at that URL, **vendored** as `host/test/fixtures/server.schema.2025-12-11.json` with its SHA-256 in the test, so CI needs no network and a changed schema is a reviewed change.
- The name, namespace and image location are placeholders until Q1 admits publication; nothing reads them at run time.

### 11.5 The server card, the catalog and the guide

| Document | Where | Default | Holds |
| --- | --- | --- | --- |
| **Server card** (SEP-2127, Final) | `<base>mcp/server-card`, `application/mcp-server-card+json` | On (`[discovery] server_card`) | The card's identity fields from the deployment (`name` from the workspace's id, `title` from its name, `version` the shell's), one remote endpoint `{ type: "streamable-http", url: "<origin><base>mcp" }`, `supportedProtocolVersions: ["2026-07-28", "2025-11-25"]`. No tools, no instance, project, member or person; nothing the 401 challenge does not already reveal but the workspace's display name |
| **AI catalog** | `/.well-known/ai-catalog.json`, `application/ai-catalog+json` | **Off** (Q2) | `{ specVersion: "1.0", entries: [{ identifier, type: "application/mcp-server-card+json", url }] }` |
| **Agent guide** | `<base>mcp/agents.md`, `text/markdown` | **Off** (Q2) | Generated from the registry: how to connect (the OAuth flow, the scopes), and `HOSTED_MCP_COMMANDS` with their descriptions. No instance's or app's commands |

- **Served** with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`, `Cache-Control: public, max-age=3600`, an `ETag` over the body, and `304` for a matching `If-None-Match`, as the extension's discovery document asks (S95). These are the only routes with CORS.
- **Validated** by a unit against the extension's `schema.json`, vendored at a pinned commit with its SHA-256, as 11.4's schema is.
- **Umbel** plans its own card and catalog file in its phase 7 (Umbel's R11). The two share no code in phase 6; when Umbel's lands, a follow-up checks the two agree on field use.

## 12. The copilot in the same process

D24 and D25 put the copilot runtime in-process on the hosted server, and phase 5 builds it. Phase 6 gives it a place and nothing else:

- **The seam** is `HostModule` (3.1): phase 5's runtime registers its routes under `<base>api/copilot/`, gets the principal through `sessionPrincipal`, which applies 6.2's first and third rows, and calls the server kernel with that principal. No session logic of its own.
- **The row** P6-X1 is phase 5's to write in its specification: the copilot's stream and a tool call, served by the same `loam-host` process that serves the shell and MCP. Phase 6 exits when it passes.
- **Where the copilot's data is** is phase 5's question, made sharper by section 7: on the server, the runtime sees the server's records, not a person's documents (Q3, and a [follow-up](#follow-ups) for phase 5).

## 13. Secrets (D108)

- **The server resolves every secret, and only the server.** The auth secret, the SMTP URL, OIDC client secrets (3.2) and the mount bearers (`bearer_file` and `bearer_env` in the deployment) are read at start, held in memory, never written to the data directory, a log, the journal, the projection, a response or the image. A secret file must be 0600 (`HOST_SECRET_PERMISSIONS`).
- **The `secrets` grant moves to phase 5,** with the `http` grant it serves. An app's handlers run in the browser (D54, D61), so a secret's value given to an app would reach the browser, which phase 1 forbids ("The browser holds none"). The grant will name a secret the kernel attaches to an outbound `http` request made through the hosted server, and never give its value to app code. Phase 1's catalog row "`secrets`, Phase 6" is amended to "Phase 5, with `http`" (D108).
- **The desktop** holds `mounts.json`'s bearers in the Rust host's memory, never in the webview, as the hosted server does.

## 14. Budgets

**First paint does not change.** Phase 3's ceiling and allowances stand; phase 6 adds nothing to first paint:

| Row | Where | Estimate | Note |
| --- | --- | --- | --- |
| First paint | | **0, 0** | `host` is read from the projection in stage B, not from the boot record |
| `late-hosted` (new) | Loaded inside `loadLate` only when `host.kind` is `hosted` and `identity.mode` is `provider` | 6,000 | The routing of `SERVER_COMMANDS`, `trust-record-settle`, the snapshot refresh, `server-call.ts` |
| `late` | Both modes | +400 | `shellExposeOf` and the two frozen lists |
| The projection validator's chunk | Stage B | Measured first | Version 4's `host`; step 3 measures, then moves code or amends the row by its measurement, as phase 3's step 8 does for `apps` |

The `budget` script's closures gain `late-hosted` after `late-identity`. P6-E9 holds that a `local` shell and a static `provider` shell never request `late-hosted`.

**Server and desktop budgets**, measured on `ubuntu-latest` in the job that runs them. Each ceiling is the step's measurement plus 25%, recorded in this section by that step with the coordinator's approval, as phase 0's budgets were:

| Row | Measured by | Proposed ceiling before measurement |
| --- | --- | --- |
| `loam-host dev` cold start to the first `200` on `<base>` | P6-H1 | 3,000 ms |
| Resident memory after boot and E1's scenario | P6-H1 | 300 MB |
| **`whoami` p95 over 500 sequential signed-in requests**: the cost of no cookie cache (phase 3's 4.3) | P6-H3 | 25 ms; past it, secondary storage is specified, never the cookie cache |
| `tools/list` p95 over 200 requests | P6-H4 | 50 ms |
| The relay's added latency over a direct request, p95 | P6-H6 | 20 ms |
| The image's uncompressed size | P6-I1 | 400 MB |
| Each installer's size | P6-D5 | Recorded only, in step 12 |
| Desktop cold start to stage A's paint | P6-D1 | 2,500 ms |

## 15. Accessibility

Phase 6 adds no chrome to the browser, so phases 0 to 3's rules and tests stand unchanged. In addition:

- **Every page the hosted server serves** is the shell's: P6-H2 runs phase 0's axe scenarios (light, dark, high contrast, forced colors) against the dev host, so a response header that broke a style or a script would show.
- **The desktop:** P6-D1 runs axe in the webview, in light and dark, through WebDriver's `execute`. The native menus are the platform's, with every item reachable from the keyboard and named; the palette item shows its chord.
- **Error pages** the hosted server writes itself (`421`, `404` for a non-HTML request) are plain text, never HTML, so nothing there needs a structure.
- #708's screen-reader passes stay open; nothing here changes what they cover.

## 16. Failure modes and error codes

Each code has a suggestion and a unit or exit test. Host codes are in `@lushly-dev/loam-host`'s `HostErrorCode`; kernel codes join `LoamKernelErrorCode`; deployment codes join the manifest's refusals.

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `HOST_CONFIG_INVALID` | 3.2 | The server will not start | The key and the fix |
| `HOST_ORIGIN_INSECURE`, `HOST_LISTEN_INSECURE` | 3.2 | Will not start | Use `https:`; put TLS in front, or listen on loopback |
| `HOST_SECRET_UNAVAILABLE`, `HOST_SECRET_PERMISSIONS` | 3.2, 13 | Will not start | The file, and `chmod 600` |
| `HOST_SANDBOX_INVALID`, `HOST_OIDC_INVALID`, `HOST_MAIL_SINK_EXPOSED`, `HOST_MAIL_INSECURE` | 3.2, 9 | Will not start | Per row |
| `HOST_DEPLOYMENT_KIND` | 3.3 | Will not start | Set `[host] kind = "hosted"` in a version 4 file |
| `HOST_IDENTITY_LOCAL` | 3.3 | `start` will not start | Use `provider` identity, or a static host or the desktop for a personal shell |
| `HOST_DATA_LOCKED` | Section 4 | Will not start | Another server (the pid) holds the directory |
| `HOST_LOCK_STALE` | Section 4 | A warning in the log | None |
| `HOST_NOT_BOOTSTRAPPED`, `HOST_ALREADY_BOOTSTRAPPED` | 3.1, 3.7 | Will not start; the bootstrap is refused | `loam-host bootstrap`; nothing, it is done |
| `HOST_ORIGIN_SHARED` | 3.4 | A `check` warning | One deployment per origin |
| `HOST_MISDIRECTED` | 3.2 | `421`, nothing run | Use the configured origin |
| `REQUEST_NOT_SAME_ORIGIN`, `REQUEST_INVALID` | 6.2, 8.1 | `403`, `400`, nothing run | Call from the shell |
| `SERVER_COMMAND_NOT_SERVED` | 6.2 | `404` | None: the shell sends only `SERVER_COMMANDS` |
| `SERVER_UNAVAILABLE` | 6.1 | A failure, retryable, journaled; nothing written | Try again; the hosted server did not answer |
| `TRUST_RECORDS_TOO_LARGE` | 6.3 | Journaled; the copy unchanged; a status notice | Archive projects; the limit is 2 MiB |
| `INSTANCE_UNKNOWN` | 8.1, 10.4 | `404` | Check the deployment's instances |
| `MOUNT_BATCH_REFUSED` | 8.1 | `400` | Send one message per request |
| `MOUNT_COMMAND_NOT_EXPOSED` | 8.1, 8.2 | `403` | Ask the deployer to expose it |
| `MOUNT_SESSION_UNKNOWN` | 8.1 | `404` | Start a new session (the client does) |
| `MOUNT_LIMIT` | 8.1 | `429`, `Retry-After: 1` | Try again shortly |
| Phase 1's `MOUNT_UNREACHABLE`, `MOUNT_UNAUTHORIZED`, `MOUNT_RESULT_INVALID` | 8.1, 10.4 | As phase 1 | As phase 1 |
| `DEPLOYMENT_HOST_MISMATCH`, `DEPLOYMENT_DESKTOP_PROVIDER` | 3.3 | `deployment write` stops | Per row |
| `DEPLOYMENT_PROVIDER_NEEDS_HOST` | 3.3 | A warning | Serve it with `loam-host` |
| Phase 3's `DEPLOYMENT_STDIO_TEAM` (D95) | 3.1 | The server will not start | An HTTP instance |

## 17. Security

- **Phase 3's boundaries, delivered as written.** The provider, the server kernel and the relay are the enforcement points (phase 3's 2.5); the server takes every session call as the human (9.5); the transport and the relay accept only same-origin JSON and serve no CORS (10.2); the session cookie is host-only. Nothing in this specification lets a browser choose an actor, widens a CSP source, or adds a route that runs a command without one of phase 3's two principal sources, but the server card, catalog and guide, which run none.
- **The origin is configuration.** No forwarded header is trusted; a request for another host is 421 (3.2). One deployment per origin, since the cookie and the root well-known paths belong to the origin (3.4).
- **The relay is now a boundary** for team instances, so it applies everything the browser's kernel applies to a mounted call: access, `unlistedProject`, exposure and the pinned space (A3), and it binds an upstream session to its person.
- **Agents over MCP reach only records the server holds** (section 7), so a connected agent never changes something its person cannot see; phase 3's rules on human and owner commands stand inside that list.
- **Secrets** are the server's alone (section 13), and file permissions are checked at start.
- **The development profile is not a deployment.** Its mail sink holds working join and recovery links in a file, so it is refused on any non-loopback origin (`HOST_MAIL_SINK_EXPOSED`).
- **Supply chain.** Every new dependency is pinned exactly and past `minimumReleaseAge`; the image's base is pinned by digest; installers are unsigned and say so; the updater refuses an unsigned update and is off without a key.
- **The desktop.** The webview reaches no file, no program and no network but its own origin and three IPC commands that take an instance name; a `stdio` command line is the desktop owner's, in a 0600 file the webview cannot reach (D56).
- **Public documents.** The server card says what the 401 challenge already says, plus the workspace's display name; the catalog and the guide are off by default (Q2).

## 18. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 6 |
| --- | --- | --- |
| Documents, app data and personas on the server, and sync with browsers | The collaboration service (D46) | `HOSTED_MCP_COMMANDS`; the store adapter; `trust-record-settle`'s shape |
| Mounted instances' and apps' commands over MCP, and `calls` | Phase 5 | `flagsOf` exported; the relay's discovery |
| The copilot runtime | Phase 5 | `HostModule` (12) |
| A CLI with an OAuth client for the hosted server | An AFD follow-up | `expose.cli` |
| Postgres, a second server process | When a measurement or consumer asks | `DataAdapter`; the lock |
| Joining a hosted workspace from the desktop | A follow-up, with a passkey story for a webview | `[host] kind`; `DEPLOYMENT_DESKTOP_PROVIDER` |
| Tauri mobile | D33 | Responsive chrome |
| An MCP bundle for platform registries (W21) | D39 | `server.json` |
| Publication of any artifact, signing identities, the update key | The owner (Q1) | The inventory entries; `LOAM_UPDATER_PUBKEY` |
| Automated backups | A follow-up | `doctor` names the files |

## 19. Exit criterion and tests

The phase exits when every test below passes on `main` in the place its row names, and STATUS.md records the runs and each milestone as it is reached. **Every exit test's title starts `P6-E<n>:`, `P6-H<n>:`, `P6-M<n>:`, `P6-I<n>:`, `P6-D<n>:` or `P6-X<n>:`.** `node scripts/loam-exit-check.mjs --phase 6` reads a manual run of `loam.yml`, `ci.yml` and `loam-desktop.yml`, with `scripts/loam-exit-check.p6.minimums.json`; `--milestone m1` reads only the rows M1 lists.

| Place | Workflow and job | Step |
| --- | --- | --- |
| Units | `loam.yml`, `Build, unit and Chromium` | `Unit suites with coverage` |
| Chromium | `loam.yml`, `Build, unit and Chromium` | `Chromium suite against the built shell (phase 0's E1 to E10, phase 1's so far, A1 to A3; the walk is its own job)` |
| Host path | `loam.yml`, `Build, unit and Chromium` | `AFD's host path` (new: `local-db`'s SQLite contract, verbose) |
| Budget | `loam.yml`, `Build, unit and Chromium` | `Bundle budget` |
| Hosted | `loam.yml`, `Hosted development profile` (new) | `Hosted criterion against the development profile` |
| Production | `loam.yml`, `Hosted development profile` | `Production profile on TLS files and behind a proxy` |
| Mounted | `loam.yml`, `Mounted against Umbel` | `E3, E4 and E9's mounted part, through a test-only relay`, renamed in step 6 to `E3, E4 and E9's mounted part, through the test-only relay and the hosted relay` |
| Image | `loam.yml`, `OCI image` (new) | `Build and run the image` |
| Desktop | `loam-desktop.yml`, `Desktop on Linux`; `Desktop on Windows` | `Desktop suite under tauri-driver` |
| Desktop build | `loam-desktop.yml`, each job | `Build the installers` |

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P6-E1 | **The server configuration and the deployment, version 4** | Units | A case per refusal of 3.2 and 3.3; version 1 to 3 files read as `static`; the projection holds `host` and nothing more; `--host` mismatch; `DEPLOYMENT_PROVIDER_NEEDS_HOST`; `DEPLOYMENT_DESKTOP_PROVIDER`; `MountAccess`'s `stdio` entries only for `desktop` |
| P6-E2 | **The headers** | Units | 3.5's builder on every fixture's `index.html`: the `<meta>` policy plus `frame-ancestors 'none'`, plus `form-action 'self'` on the four pages, nothing else |
| P6-E3 | **The frozen lists** | Units | Section 7's unit; `SERVER_COMMANDS` registered on the server and routed only in a hosted provider deployment; in every other deployment kind and mode each runs its phase 3 handler, byte-identical to before |
| P6-E4 | **The browser's routing and copy** | Units | Over a fake `serverCall`: each routed command writes nothing locally; `SERVER_UNAVAILABLE` journaled; `trust-record-settle` journaled with its input, run top-level, replacing the three tables; the active project gone after a settle leaves it; `TRUST_RECORDS_TOO_LARGE`; the agent interface's writes `HUMAN_REQUIRED`; a replay of the journal has zero differences and makes no `serverCall` |
| P6-E5 | **The relay's decisions** | Units | 8.1's decision function over every row: methods, headers, batch, scope, access, `unlistedProject`, exposure by `flagsOf`, the pinned space, unknown and foreign session ids, limits |
| P6-E6 | **The registry entry and the server card** | Units | `server.json` and a generated card validate against their vendored schemas, whose SHA-256 the test checks |
| P6-E7 | **`SqliteAdapter`** | Host path | `runDataAdapterContract` on `node:sqlite`, every case; a batch is one transaction (a fault mid-batch leaves nothing) |
| P6-H1 | **One command, one process** | Hosted | `loam-host dev` from an empty directory prints its origin; the shell boots over HTTPS under `base_path = "/loam/"`; a deep link is `index.html` with `200`; hashed assets `immutable`; a request with another `Host` is 421; a second `dev` on the same directory is `HOST_DATA_LOCKED`; after a restart the data is there; cold start and memory rows of 14 |
| P6-H2 | **The shell hosted, as it was static** | Hosted | In `local` mode: phase 2's E1 chunk list equal to `serveDeployment`'s byte for byte; a reload restores scope; phase 0's axe scenarios; every page's response CSP is 3.5's, and no CSP violation in any scenario; a view app renders through the sandbox origin |
| P6-H3 | **The provider and the well-known documents** | Hosted | A `provider` deployment: `HOST_NOT_BOOTSTRAPPED` before bootstrap; `loam-host bootstrap` once, then `HOST_ALREADY_BOOTSTRAPPED`; the owner's invitation in the mail sink; RFC 8414's and OpenID's documents at the root name the issuer `<origin>/loam/api/auth`; a `stdio` instance refuses the start (D95); the four pages carry `form-action 'self'`; the `whoami` row of 14 |
| P6-H4 | **The MCP route** | Hosted | No token: 401 with `resource_metadata` naming `/.well-known/oauth-protected-resource/loam/mcp`, which answers, as does the root form; `tools/list` with a valid token equals `HOSTED_MCP_COMMANDS` plus the meta-tools; both eras through `<base>mcp`; a foreign `Origin` 403; `/sse`, `/message`, `/rpc`, `/batch`, `/stream/x` and `/health`, under `/loam/` and at the root, 404; the server card's media type, CORS, `ETag` and `304`; the catalog and guide 404 by default and served when on; the `tools/list` row |
| P6-H5 | **The trust-record transport** | Hosted | A signed-in owner's `project-create` from the shell lands in `loam.sqlite`; a second person's tab sees it after its refresh; `trust-record-settle` in both journals; the server stopped, `project-create` is `SERVER_UNAVAILABLE` and the copy is unchanged; `GET`, `text/plain`, a foreign `Origin`, `Sec-Fetch-Site: cross-site`, no session, and a command not in `SERVER_COMMANDS` each refused before anything runs, the store unchanged |
| P6-H6 | **The hosted relay** | Hosted | Against phase 2's Node fixture server (`web/test/mounted/scope-server.ts`): a member's call reaches it with the scope in `_meta`; a non-member of the project is refused before forwarding, by the fixture's log; a tool the entry hides is `MOUNT_COMMAND_NOT_EXPOSED`; a batch 400; a pinned space enforced; a legacy session's `DELETE` forwarded for its person and refused for another; `GET` 405; the deployer's bearer reaches the fixture and never the page, a log or the journal; limits of 8.1; the latency row |
| P6-H7 | **No secret anywhere** | Hosted | After P6-H3 to P6-H6's sessions: no auth secret, bearer, cookie value, access or refresh token, join or recovery token, or session id in the served files, the projection, either journal, the server's logs, any store row or `localStorage`; a secret file of mode 0644 refuses the start |
| P6-H8 | **A crash** | Hosted | `kill` (SIGKILL) during a burst of `project-create`s; the restart takes the stale lock with `HOST_LOCK_STALE`; the journal reads with its last partial line dropped; every project the journal holds is in the store and no other |
| P6-H9 | **The production profile on TLS files** | Production | `loam-host start` with a certificate from a test CA; HSTS on a non-loopback name; `SIGHUP` re-reads a renewed certificate; SMTP mail to `smtp-server` over STARTTLS; a plain `smtp://` to a non-loopback host refused; `doctor`'s report |
| P6-H10 | **Behind a proxy** | Production | Plain HTTP on loopback behind a test TLS proxy: passkey sign-in (phase 3's virtual authenticator), the MCP 401 and a token's call, the transport and the relay all work with `Secure` cookies; an `X-Forwarded-Host` naming another host changes nothing |
| P6-M1 | **The mounted suite on the hosted relay** | Mounted | Phase 1's E3 and E4 and phase 2's E6 scenarios against a stock `umbel`, once through the test-only relay as today and once through `startDevHost`'s relay; the same results, the relay's proof no longer standing alone |
| P6-I1 | **The image** | Image | Builds; runs as UID 10001; `HEALTHCHECK` healthy; the shell and the MCP 401 served with mounted configuration; no secret in its filesystem; its base digest is the file's; its size row |
| P6-D1 | **The same build on the desktop** | Desktop | Boot in the webview; phase 0's layout scenario journaled and replayed; reload restores from IndexedDB; no CSP violation; `shell-info-get` reports `host: 'desktop'`; axe in light and dark; menus' "Command palette" opens it; a second launch focuses the first; D52's S1 and S2 recorded; the cold start row |
| P6-D2 | **Mounts over the Rust host** | Desktop | A `stdio` `hello-mcp` and an `http` fixture server mounted from `mounts.json`: `hello-greet` answers in the console; the scope in `_meta`; the command line, URL and bearer never in the webview's DOM, store or journal; a killed child fails with `MOUNT_UNREACHABLE` and recovers; `mount_open` for an unknown instance refused |
| P6-D3 | **A view on the desktop** | Desktop | Hello's view renders through `loam-sandbox`, a different origin from the shell's; phase 1's E2 scenario; the WebRTC probe of phase 1's 9.7 run and its result recorded for #711, not asserted |
| P6-D4 | **The capabilities** | Desktop | No plugin but single-instance and updater is linked; the IPC allow-list is the three commands; an attempt to invoke anything else from the webview is refused |
| P6-D5 | **Installers and updates** | Desktop build | Each job's installers built and hashed; with a test key, a signed update from a local feed installs and a tampered one is refused; without a key, no update request is made |
| P6-X1 | **The copilot from the same process** | Named by phase 5 | Phase 5's specification writes it on `HostModule` (12) |
| P6-E8 | **No job was skipped** | The exit step | `node scripts/loam-exit-check.mjs --phase 6` (and `--milestone m1` for M1) exits 0 |
| P6-E9 | **Budgets** | Budget; Chromium | Section 14's browser rows under their ceilings, first paint unchanged; a `local` shell and a static `provider` shell never request `late-hosted`, and a hosted `provider` shell requests it once, in stage B |

**What exited stays exited.** Phases 0 to 3's exit tests pass unchanged; the exit check reuses their rows and minimums, as phase 3's E12 does, so there is no `P6-` title for them.

## 20. Implementation plan

Each step is one pull request, merged on green. It updates this status block and STATUS.md before it merges. **Steps 4, 5 and 6 each get a review focused on the trust boundary they build; step 11 gets one on the desktop's capabilities.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: `SqliteAdapter` | `@lushly-dev/local-db/sqlite` on `node:sqlite`; the contract; a changeset; `entry-points` test keeps it out of `/` | `pnpm check`, `pnpm verify` |
| 1 | Host skeleton | `@lushly-dev/loam-host`: `createLoamHost`, Hono and the Node adapter, `readServerConfig` and `server.v1.json`, the data directory and lock, the static site with D74's fallback, 3.5's headers, the `Host` check, the sandbox origin, `check`; serves `local` deployments of versions 1 to 3 through a test-only option until step 3's version 4; the inventory entry; `loam.yml`'s `Affected units` and unit step gain the package; E1's and E2's units so far | `pnpm check`, `loam.yml` |
| 2 | Development profile | `loam-host dev`; the certificate, secret and mail sink; `startDevHost`; `openShell` on a `DevHost`; the `Hosted development profile` job with its step; `suites.mjs`; `AGENTS.md`; P6-H1, P6-H2, P6-H8 | `pnpm check`, `pnpm verify`, `loam.yml` |
| 3 | Provider and version 4 | **Needs phase 3's steps 1 and 4.** Deployment and projection version 4, `deployment write --host`; Better Auth mounted, `auth.sqlite`, mail; the root well-known documents; `bootstrap`; D95's start refusal; the four pages' CSP; the projection validator's chunk measured; P6-E1, P6-E2, P6-H3 | `pnpm check`, `loam.yml`, `budget` |
| 4 | Server kernel and MCP | **Needs phase 3's 0a, 0c and 7, and 0a here.** `createServerKernel` on `SqliteAdapter` and `FileJournalSink`; `shellExposeOf` and `HOSTED_MCP_COMMANDS`; AFD's handler mounted; the server card, catalog and guide; P6-E3's list half, P6-E6, P6-H4. **Trust review: the route and the served list** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 5 | Trust-record transport | `api/kernel/call`, `SERVER_COMMANDS`, `trust-record-snapshot`, `trust-record-settle`, `late-hosted`, `server-call.ts`, the recorded table for hosted provider deployments; phase 3's `afterRemoveMember` hook running the server's `agent-member-settle` (A4); P6-E3, P6-E4, P6-H5. **Trust review: the transport and the copy** | `pnpm check`, `loam.yml`, `budget` |
| 6 | Hosted relay | Section 8 with A1 and A3, the relay's discovery and records, deployer bearers resolved; the `mounted` job's renamed step; P6-E5, P6-H6, P6-H7, P6-M1. **Trust review: the relay as a boundary** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 7 | **M1, development profile** | `--phase 6 --milestone m1` and `loam-exit-check.p6.minimums.json`; `WORKFLOWS` gains the new job; `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`; STATUS.md records "development profile reached", unblocking phase 3's step 10 and phase 5 | The check exits 0 for M1 |
| 8 | **M2, production profile** | Section 9: TLS files with `SIGHUP`, SMTP, OIDC, limits, logs, `doctor`, `start`'s shutdown; the `Production` step; P6-H9, P6-H10; STATUS.md records M2 | `pnpm check`, `loam.yml` |
| 9 | OCI image | `Containerfile`, the `OCI image` job, Dependabot's Docker entry; P6-I1 | `loam.yml` |
| 10 | Registry entry and guide | `server.json` and its vendored schema; `docs/guides/deploy.md`; README and STATUS links | `pnpm check` |
| 11 | Desktop lane | `@lushly-dev/loam-desktop`, the Rust host's three commands, `loam-sandbox`, the CSP and capabilities, single instance and menus; `MountAccess`'s `stdio`; `loam-desktop.yml`'s Linux job and `suites.mjs`; D52's measurement; P6-D1 to P6-D4. **Trust review: the capabilities and the IPC** | `pnpm check`, `pnpm verify`, `loam-desktop.yml` |
| 12 | **M3 and M4** | The Windows and macOS jobs; installers and their sums; the updater and its test; `AGENTS.md`; P6-D5; STATUS.md records M3 and M4 | `loam-desktop.yml` by `workflow_dispatch` |
| 13 | Exit | **After phase 5's runtime step.** P6-X1 as phase 5 writes it; `--phase 6`; STATUS.md records the exit; follow-ups filed | The check exits 0 |

Order: 0a, 1 and 2 first, in parallel. Step 3 after 1 and phase 3's steps 1 and 4. Step 4 after 0a, 3 and phase 3's 0a, 0c and 7. Steps 5 and 6 after 4. Step 7 after 2, 5 and 6. Step 8 after 7. Steps 9 and 10 after 8. Step 11 after 3 (version 4); step 12 after 11. Step 13 after everything and phase 5's runtime.

**Host capacity.** The hosted job runs Chromium and a server child per file; on a shared machine, one Vitest worker. The desktop's Rust build uses the shared target directory and `pnpm rust:sweep`.

## Questions for the owner

Each is about who can do what, or who is trusted. The specification is written to each recommendation, and says where an answer would change it.

### Q1. Does anything publish from phase 6, and who signs?

Phase 6 builds desktop installers, a server image and a registry entry. Publishing them puts the project's name on them, and a desktop app that updates itself trusts whoever holds its update key.

- **Build and check everything, publish nothing yet (recommended).** Artifacts are made and tested in CI and kept there; publishing, the signing identities and the update key wait for a release you approve, unit by unit. The tradeoff: nobody can install Loam without building it until then.
- **Publish previews from CI now.** Unsigned installers, the image and a registry entry go out under the project's name, with an update key CI holds. The tradeoff: people can try Loam at once, but operating systems warn on unsigned installers, and anyone who controls CI could push an update to every installed desktop.

### Q2. Should a hosted Loam announce itself?

A hosted deployment can publish a card that tells agents how to connect, a listing that lets crawlers find it, and a guide that names its commands.

- **The connection card only (recommended).** An agent given the address can connect without setup. The listing and the guide stay off until the deployer turns them on. The tradeoff: agents cannot find a deployment by searching the domain.
- **All three on by default.** Agents and indexes find every deployment and its commands with no setup. The tradeoff: anyone on the internet learns that the deployment exists and what it can do.
- **All off by default.** Nothing is public. The tradeoff: every agent must be configured by hand.

### Q3. What can a connected agent reach before the collaboration service?

Until the collaboration service, documents and app data live in each person's browser. A person's agent connected over MCP reaches the server, which holds projects, members and the workspace's apps.

- **Projects, members and apps only, until the collaboration service (recommended).** An agent never changes something its person cannot see. The tradeoff: a connected agent cannot read or edit documents or app data yet.
- **Relay the agent's calls through the person's open shell.** The agent works on exactly what the person sees, but only while their shell is open, and the server would be driving a person's browser on an agent's behalf: a new path that phase 3 did not review.

## Proposed amendments to phase 3

**Proposed, pending review.** Each fills a gap in what phase 3 handed phase 6, and none moves a boundary phase 3 approved: each either adds a check or says how a stated rule is met.

| # | Amends | Proposed text | Why |
| --- | --- | --- | --- |
| A1 | 10.2 item 5's "accept only `POST` with `Content-Type: application/json`" for the relay | The relay accepts `POST` with that media type, and `DELETE` with no body and an `Mcp-Session-Id`, under the same `Origin` and `Sec-Fetch-Site` rule; `GET` is `405` | The page's MCP client ends a legacy-era session with `DELETE` (`mount.ts:148-155`). Refusing it leaves sessions open on the instance. A cross-site `DELETE` needs a CORS preflight the relay never answers, so allowing it adds no cross-site path |
| A2 | 10.2 items 2 and 3 | The hosted server also serves the authorization server's metadata at the origin's root: `/.well-known/oauth-authorization-server<base><identity.path>` and the OpenID configuration, and so owns its origin's `/.well-known/oauth-*` paths | MCP clients discover the issuer from the protected-resource metadata and then fetch RFC 8414's document, which a `base_path` keeps off the root; without it P3-H3's client cannot register or authorize |
| A3 | 10.2 item 5's relay checks | Beside `decideAccess` and phase 2's 9.2, the relay applies the instance's exposure (`flagsOf`, D65) and its pinned space (`pinMountedInput`), refuses JSON-RPC batches, and binds an upstream session to its person | Once the relay is the boundary for a team, a person can send it any request directly; D65's "mutations stay hidden until the entry names them" and the pinned space were only the browser kernel's, which binds nobody |
| A4 | 9.5's "`agent-member-settle` … not registered" on the server | The server registers `agent-member-settle` as internal, run only by the provider's `afterRemoveMember` hook through the host, journaled on the server | Line 2 already refuses a removed sponsor's agents on the server; this keeps 8.3's "so the record says why" true for the server's authoritative record |
| A5 | 3.4's replay rule, "a command that writes Loam's store is never recorded" | In a hosted `provider` deployment, the trust-record commands are recorded, answered from their entries in a replay, and the browser's copy replays through `trust-record-settle`'s journaled input | There they write the server's store, not the browser's; re-running them in a replay would reach a server, which phase 3 forbids |

## Amendments to the architecture and the decision log

Proposed; applied when the coordinator approves this specification, in step 1:

- **Architecture section 4, Hosts and Distribution:** the hosted server is `@lushly-dev/loam-host`; the desktop is `local` only; distribution artifacts are built and verified, and published only by the owner's release (Q1).
- **Architecture section 6, libraries:** Hosted server row: Hono 4.13 and `@hono/node-server` 2.1; the server store on SQLite through `local-db`'s `SqliteAdapter`; the fetch-style handler not needed (D101). Desktop row: Tauri 2.12.5 pinned, 3.0 watched.
- **Architecture section 6, AFD prerequisites:** a row for `SqliteAdapter`, phase 6, step 0a; the fetch-style `createMcpHandler` row stays optional and unused.
- **Architecture section 9:** phase 6's row gains its four milestones and the exit's wait for phase 5's runtime (D100); the collaboration service's gate reads "phase 6's M2".
- **Architecture glossary:** "Hosted server", "Server configuration", "Development profile", "Trust-record command", "Milestone (phase)".
- **Phase 1's surface catalog:** `secrets` moves from "Phase 6" to "Phase 5, with `http`" (D108).
- **Decision log:** D100 to D108, below, each "Proposed, pending review" until approval. D36 gains a note pointing to D101; D46 a note pointing to D100; D52 a note pointing to D106's measurement.

| ID | Decision |
| --- | --- |
| D100 | Phase 6 has four milestones: M1, the development profile, unblocks phase 3's hosted criterion and phase 5; M2, the production profile, is what the collaboration service's "after phase 6" waits for; M3, the desktop lane, and M4, distribution, gate nothing before phase 7; the exit also needs the copilot served from the same process, once phase 5 has its runtime |
| D101 | The hosted server is `@lushly-dev/loam-host`: one Node 26 process per data directory and deployment on Hono 4.13.17 and `@hono/node-server` 2.1.6, mounting AFD's `createMcpHandler` through the Node bindings at `<base>mcp` alone; its own configuration file, `loam.server.toml`; the origin configured, never derived from forwarded headers; one deployment per origin; the root `/.well-known/oauth-*` paths its own; a one-command development profile on `https://localhost` |
| D102 | The server's store is SQLite through AFD's new `SqliteAdapter` on `node:sqlite`, its journal AFD's `FileJournalSink`, both in a data directory held by an exclusive lock; Postgres reserved |
| D103 | In a hosted `provider` deployment, the browser runs the trust-record commands on the server through `POST <base>api/kernel/call` and keeps a copy fed by the journaled `trust-record-settle`, which grants nothing; no local write on any failure; deployment and projection version 4 say which host serves a deployment |
| D104 | The hosted server serves over MCP only the commands whose records it holds or reads from the provider (`HOSTED_MCP_COMMANDS`); documents, app commands and page state are not served until the collaboration service and phase 5; `expose.cli` stays off until AFD's CLI can obtain a token |
| D105 | The hosted relay enforces phase 3's 10.2 item 5 against the server's records, plus the instance's exposure, its pinned space, no batches and sessions bound to their person, with the deployer's bearer added and never logged; its own discovery feeds those checks |
| D106 | The desktop is the same build in Tauri 2.12's webview, `local` identity only, IndexedDB unless D52's measurement fails, the sandbox on a second custom protocol, mounts (`http` and `stdio`) through three IPC commands over a 0600 file the CLI writes, no other plugin or capability, and an updater that is off without a key |
| D107 | Distribution: the static site with a deployment guide, an OCI image, installers, a `server.json` for the image, and a server card at `<base>mcp/server-card`, all built and verified in CI and none published; the AI catalog and the agent guide are off by default (Q2) |
| D108 | Every secret is resolved only by the server (or the desktop's Rust host), never written or sent; the `secrets` grant moves to phase 5 with `http`, attaching a named secret to a request and never giving its value to app code |

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-09 | Phase 6 specification | An OAuth client in the AFD CLI (authorization code with a loopback redirect and PKCE), so the CLI can reach a hosted server and `expose.cli` can follow `expose.mcp` | Open, for AFD |
| 2026-11-09 | Phase 6 specification | Where the copilot runs relative to a person's data before the collaboration service: on the server it sees the server's records, not the person's documents (section 7, Q3); in a browser worker, its trust-record writes are `HUMAN_REQUIRED` in a hosted `provider` deployment (6.1), so it changes projects only over MCP as a connected agent | Open, for phase 5 |
| 2026-11-09 | Phase 6 specification | A browser MCP client on another origin cannot use `<base>mcp`, which serves no CORS (3.6). Decide whether a deployer may list client origins | Open |
| 2026-11-09 | Phase 6 specification | Postgres, and a second server process, when a measurement or consumer asks (section 4) | Open |
| 2026-11-09 | Phase 6 specification | Automated backups of `loam.sqlite` and `auth.sqlite` | Open |
| 2026-11-09 | Phase 6 specification | Joining a hosted workspace from the desktop, with a passkey story for a webview (10.1) | Open |
| 2026-11-09 | Phase 6 specification | Check that Loam's server card and Umbel's (its phase 7) use the extension's fields the same way (11.5) | Open, when Umbel's lands |
| 2026-11-09 | Phase 6 specification | [#858](https://github.com/lushly-dev/afd/issues/858), first paint on a real low-end device, is easier over the development profile but still needs a device | Open |
