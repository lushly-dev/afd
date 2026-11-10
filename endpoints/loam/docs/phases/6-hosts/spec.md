# Phase 6 specification: hosts and distribution

| Field | Value |
| --- | --- |
| Phase | 6, hosts and distribution ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 6 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 3 specification](../3-identity/spec.md) (its [10.2](../3-identity/spec.md#102-what-phase-6-must-deliver-first), [9.5](../3-identity/spec.md#95-the-server-kernel-and-its-chain), [2.5](../3-identity/spec.md#25-where-provider-mode-is-enforced), [7.5](../3-identity/spec.md#75-the-providers-own-endpoints) and [7.6](../3-identity/spec.md#76-freshness) above all), the [phase 1 specification](../1-app-contract/spec.md)'s [7.1](../1-app-contract/spec.md#71-how-a-browser-reaches-an-instance), the [scope and projects specification](../2-scope-projects/spec.md)'s [3.3](../2-scope-projects/spec.md#33-over-mcp) and [6.2](../2-scope-projects/spec.md#62-a-deep-link-and-the-base), the [architecture](../../architecture.md), the [decision log](../../decisions.md), [`spec/authorization.md`](../../../../../spec/authorization.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-09 by the design sub-agent, after phase 3's approval and the coordinator's decision of the same day that phase 6's hosted lane comes first ([phase 3's 10.3](../3-identity/spec.md#103-the-order-recommended-for-the-coordinator-to-decide)). **Revised the same day** after two independent reviews of `96e1ed9a`, a trust and security review and a general review, each of which called it approvable once fixed; every finding is answered in [Review 2026-11-09](#review-2026-11-09), with the coordinator's rulings where the reviews differed. **A focused re-check of `45bd2fcd`** confirmed most of that round, including every relay bypass B1 named, and found two relay blockers (discovery of a project-listed instance; an instance's error posing as the relay's) and eight should-fix items; all are answered in [its table](#re-check-2026-11-09). **A relay re-check of `64da28d8`** confirmed those closed and found three more relay blockers, all present since `45bd2fcd` (AFD's `grouped` strategy, scope read from a first-class tool's `meta`, and `server/discover`); 8.1 is restructured as parse, decide, rebuild, and every finding is answered in [its table](#relay-re-check-2026-11-09). **An adversarial re-check of `3e9a2f26`** found no route around parse, decide, rebuild, and two fail-open gaps in step 11 and a partial deny-list from step 15 on; both are closed, and everything is in [its table](#relay-re-check-2-2026-11-09). **Relay re-check 3 of `87758b5d`** confirmed those closed and found one blocker the new response allow-list introduced (answers other than a `200` carrying a message); step 15 now decides by status, and the rest is in [its table](#relay-re-check-3-2026-11-09). **Relay re-check 4 of `ce5c82ed` called it approvable**, with no blocker and no bypass; its three should-fix items and six nits are applied ([its table](#relay-re-check-4-2026-11-09)). Q1 and Q2 block only the steps that build them, not the approval. **Approved by the coordinator on 2026-11-09** at `71d41a9e`, under the owner's standing grant, after two independent reviews and five re-checks. D100 to D108 are decided with that approval ([decision log](../../decisions.md)), and so are the eight amendments to phase 3's specification ([Amendments to phase 3](#proposed-amendments-to-phase-3)), none of which moves a trust boundary phase 3 approved. The owner's two questions, Q1 and Q2, await answers and block only the steps they name ([Questions for the owner](#questions-for-the-owner)).
- **Last verified:** 2026-11-09 against `main` at `37f383c0`, from this evidence read in the repository:
  - **AFD's MCP handler:** `packages/server/src/server.ts:245-248` (`createMcpHandler` returns a Node `(req, res)` handler and starts no server), `:140` and `:188` (a server's actor defaults to `{ kind: 'agent' }`); `packages/server/src/http-handler.ts:49` (`JSON_RPC_PATHS`), `:406`, `:410` and `:466` (routes matched on the absolute path: `/mcp`, `/health`, `/sse`, `/message`, `/rpc`, `/batch`, `/stream/*`); `packages/server/src/http-security.ts:30-66` (`validateHttpRequest`: the scheme is `https` only on a `TLSSocket`, `:35`; `allowedHosts` defaults to loopback names, `:39`; an `Origin` other than the request's own needs `allowedOrigins`, `:43-53`; `Sec-Fetch-Site` without `Origin`, `:56-64`); `packages/server/src/meta-argument.ts:5-10` (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` take a `meta` argument applied "as if the request had sent them in `_meta`"); `packages/server/src/journal.ts:259` and `:290` (the journal appends after `next()`); `packages/core/src/builtin-tools.ts:11-37` (`AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES` and `AFD_BUILTIN_TOOL_NAMES`; there is no `isMetaTool`).
  - **Stores and journal:** `packages/local-db/src` has the memory, IndexedDB and HTTP adapters and no SQLite one; `packages/core/src/journal-file.ts:24-44` (`FileJournalSink`, one JSON line per entry, "do not point two sinks (or two processes) at the same file", no `fsync`).
  - **Kernel:** `endpoints/loam/packages/kernel/src/commands.ts:9-14` (`SHELL_EXPOSE`, `mcp: false` and `cli: false` for every shell command "until phase 6"), applied at `kernel.ts:303-305` and `:406`; `kernel.ts:195` and `:778` (`mcpOptions()` is undefined until `late/` has loaded); `late/index.ts:66-74` (`PERSON_SESSION`), `:315-357` (`mcpOptions`); `types.ts:94-104` (`host: 'browser' | 'desktop' | 'hosted' | 'test'`, `storeKind: 'memory' | 'indexeddb'`); `apps/mounted.ts:257`, `:292` and `:320` (`pinMountedInput`, `unlistedProject` and `flagsOf`, pure and exported), `:418-466` (`discoverInstance` over a `MountTransportV2`: `afd-help`, then `afd-detail` in batches, under `DISCOVERY_LIMITS`, with `mount.only`), `:682` (a command that is not first-class is called as `tools/call afd-call { command, input }`).
  - **Web host and CLI:** `endpoints/loam/packages/web/index.html:5-8` (the CSP as a `<meta>`, so no `frame-ancestors`); `web/src/mount.ts:27` (the mount transport answers its own `GET` with 405, so the page opens no event stream), `:64-81` (a refusal maps the HTTP status alone, 401 and 403 to `MOUNT_UNAUTHORIZED`, everything else to `MOUNT_UNREACHABLE`; the body is never read) and `:148-155` (whose comment says `close()` lets the SDK send its session `DELETE`; SDK 2.4.0's `close()` sends none, client `dist/index.mjs:1677-1685`, so implementation step 6 corrects the comment); `web/test/mounted/mount-relay.ts:1-29` (the test-only relay forwards `POST`, `GET` and `DELETE` with an allow-list of headers); `web/test/browser/harness.ts:196-253` (`serveDeployment`, which writes the sandbox's origin into the file after binding its port, `:209-219`) and `:330` (`openShell(browser, origin, options, context)`); `cli/src/deployment.ts:327-420` (`writeDeployment`, with `404.html` at `:387` and the 0600 `mountsOut`, which writes the bearers' values, at `:388-399`); `cli/src/deployment-analysis.ts:36-40` (`MountAccess` is `{ instance, url, bearer? }`).
  - **Manifest:** `manifest/schemas/deployment.v2.json`: `$defs.site` holds only `base_path`; an instance has `audience`, `transport`, `url`, `bearer_file`, `bearer_env`, `command`, `cwd`, `projects`, `space`, `expose` and `commands`. The projection carries the version as `deployment_version`.
  - **CI and tooling:** `.github/workflows/loam.yml` (jobs `Affected units`, `Build, unit and Chromium`, `Editor walk`, `Mounted against Umbel`); `scripts/loam-exit-check.mjs:36-47` (`WORKFLOWS`: a run's jobs must equal the list exactly, `:250-256`) and `:57` (`LOCATIONS`); `scripts/affected/suites.mjs:90` (`loam.yml`'s local entry) and `:128` (`hosted-fixtures.yml` needs `openssl`); `packages/auth/hosted/better-auth/local.ts:80-96` (`openssl` makes the hosted fixture's certificate); `scripts/repository-contract.test.mjs:323` (every Loam unit's gates must be `pnpm check`, `loam.yml`, `release-approval`); `.gitignore:48-52` (`Cargo.lock` ignored, with negations per Cargo workspace); `.nvmrc` is `26`; every Loam unit in `scripts/release/inventory.json` is `quarantined` with `routes: []`.
  - **Phase 3, approved and not yet built:** `@lushly-dev/loam-identity` with `createLoamAuthOptions`, `loamServerPlugin`, `bootstrapOrganization`, `createMcpAuth`, `createServerKernel`, `principalGate` and `credentialsGate` ([its section 1](../3-identity/spec.md#1-units-and-repository-placement)); deployment and projection version 3; steps 0a and 0c for AFD's TypeScript MCP authorization.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-09, and the published packages read for it and for the reviews: `@hono/node-server` 2.1.6 exports `HttpBindings` (`incoming`, `outgoing`) and `RESPONSE_ALREADY_SENT` (`dist/index.d.mts:37-45`, `dist/utils/response.d.mts:2`); `@better-auth/oauth-provider` 1.7.18 exports `oauthProviderAuthServerMetadata` and `oauthProviderOpenIdConfigMetadata`; `@better-auth/core` 1.7.18 reads a client's address only from `advanced.ipAddress.ipAddressHeaders`, default `x-forwarded-for` (`dist/utils/ip.mjs:196-219`), and `better-auth` 1.7.18's rate limiter keys a request with no address to one shared bucket (`dist/api/rate-limiter/index.mjs:242-248`); its `/organization/leave` deletes the member without `beforeRemoveMember` or `afterRemoveMember` and counts only the creator role as an owner (`dist/plugins/organization/routes/crud-members.mjs:404-433`, against `:211` and `:222` for removal).
- **Done:** this specification and its revisions after two reviews and five re-checks; the coordinator's approval of the whole on 2026-11-09, at `71d41a9e`.
- **Step 1, the host skeleton** ([#932](https://github.com/lushly-dev/afd/pull/932), merged at `784b7e1f`): `@lushly-dev/loam-host` with `createLoamHost` on Hono 4.13.17 and `@hono/node-server` 2.1.6, the `Host` check before the adapter, 3.5's headers, `serveSite`, the data directory and its OS lock, the site written to `public/site`, the sandbox origin, TLS from `[tls]`, `check` and `doctor`'s read-only part; `server.v1.json` and `readServerConfig`; the inventory entry, `loam.yml`'s gates and build, the repository contract; P6-E1's and P6-E2's units so far. It also carries the amendments this specification says step 1 applies: the architecture's sections 4, 6 and 9 and its glossary, phase 1's `secrets` row, A1 to A8 in phase 3's specification, and the notes on D36, D46 and D52. **Deviations, each with its reason:**
  1. **Every response on the shell's origin that is neither a shell page nor a script or style sheet** (`sandbox/proxy.html`, a page or an SVG in an app's package, the projection) is served inert, `sandbox; default-src 'none'; frame-ancestors 'none'`: 3.5 names no policy for it, and nothing navigates to one there, since a view's HTML reaches its sandbox as data. The review widened it from HTML to every such response, an SVG being a document too. The sandbox origin still serves `sandbox/` under 3.5's `frame-ancestors <origin>`. **Approved by the coordinator 2026-11-09.**
  2. **A workspace id the hosted server answers at the top level under `<base>`** is refused, `DEPLOYMENT_WORKSPACE_INVALID` on `workspace.id`, the code `readDeployment` gives a reserved id: `api` and `mcp` by `loam-host`, while version 2's schema already refuses `mounts` (its reserved list) and `.well-known` (its pattern admits no dot). `api` covers the default `identity.path` and every `HostModule`, which live under `<base>api/`. **Approved by the coordinator 2026-11-09.**
  3. **`readServerConfig` holds the file-alone rules**, at a new entry `@lushly-dev/loam-manifest/server` that no page imports; what needs the file system, the environment or the deployment file (a secret's value or mode, the sandbox against the deployment's, `[oidc]` against the methods, the kind) is `loam-host`'s `checkHost`, which `check` and `createLoamHost` share. Paths in `loam.server.toml` are read against the file's own directory, as the deployment file's `package` is.
  4. **The registrable domain** in the same-site rule comes from the Public Suffix List through `tldts` 7.4.19, pinned exactly in the manifest (section 2 lists no such dependency; the lockfile already held it through `tough-cookie`), private entries included as browsers read them. The manifest's entry test holds `.` and `/validate` clear of `tldts`, the server reader and every Node.js builtin. **Approved by the coordinator 2026-11-09.**
  5. **`[auth]` and `[mail]` are optional in `server.v1.json`**: a `local` deployment has no provider. Step 3 requires both for a `provider` deployment.
  6. **On Windows, `HOST_SECRET_PERMISSIONS` fails closed**: the ACL read 3.2 names is not built, so every secret file, key and data directory is refused there. The hosted server runs on Linux, macOS and its image. **Approved by the coordinator 2026-11-09 as fail-closed;** a follow-up builds the ACL check.
  7. **`<base>api/health`** (3.4) is served from step 1; `<base>mcp`, `<base>api/kernel/call` and `<base>mounts/*` answer 404 with `no-store` until their steps (3.3). A request with no `Host`, two, or an absolute target naming another host is 421 (Node's own 400 for a missing `Host` is turned off so the gate answers it).
  8. **A built page whose policy the header cannot carry as it is** (an entity, a line break, two policy tags, or a `frame-ancestors` or `form-action` of its own, which would win over the header's) refuses the start as `DEPLOYMENT_PATH_INVALID` on `--dist`, the CLI's code for a bad `--dist`.
  9. **Versions 1 and 2 only:** deployment version 3 is not on `main` yet, so `hostKindOf`, `identityModeOf`, `oidcMethodsOf` and `hostRouteSegments` read versions 1 and 2 (`static`, `local`, no methods, 3.4's segments) and gain version 3 when phase 3's step 1 lands.
  10. **Not in step 1:** `modules`, `HostModule` and `HOST_MODULE_RESERVED`, which need the server kernel's `sessionPrincipal` and `callAs` (step 4 at the earliest; step 2's `startDevHost` names `modules`); `doctor`'s database reads and instance probes, which come with the steps that build them. `doctor` never opens `lock.sqlite`, since even its shared read would make a server starting at that moment meet `HOST_DATA_LOCKED`.
  11. **Tests:** the test-only option is a symbol, `SERVE_STATIC_DEPLOYMENT`, kept out of the package's entry; bound ports reach a test through `boundAddresses`, so `LoamHost` keeps 3.1's shape. The lock's own unit is not titled `P6-`, since P6-H1's lock case is step 2's; nor are the units for the `Host` check over a socket, the sandbox's listeners, the in-process `HOST_DATA_LOCKED`, TLS and HSTS, `api/health` and `base_path` serving, which are P6-H1's and P6-H4's criteria and close in steps 2 and 4. The TLS unit makes its certificate with `openssl`, so `suites.mjs` gives `loam.yml` `openssl` a step before step 2. E13 of phase 3 does not exist yet, so `loam-host`'s own unit scans `web/src`, `chrome/src` and `kernel/src` for an import of it.
  12. **A raw `\` in the request line never reaches the host:** Node's HTTP parser answers it `400` before any code runs, so `serveSite`'s `\` refusal (`404`) is proved at its unit, and over a socket the request gets Node's `400` with nothing read. `%5c` reaches the host and is `404`.
- **The independent review of `a1485d78`** ([#932](https://github.com/lushly-dev/afd/pull/932)) said merge after fixes, and found the `Host` check, `serveSite` and the seams sound. Applied:
  - **B1:** a retry of the lock in the same process closed a descriptor to `lock.sqlite`, which on POSIX dropped the lock the process held. A retry is now refused from a set of held directories before it touches the file, and only a file the call created is ever closed.
  - **I1:** the inert policy covers every non-shell response but scripts and style sheets (deviation 1).
  - **I2:** the misfiled `P6-` titles are dropped (deviation 11).
  - **I3:** a failed start leaves nothing half-built. The check's one read of `[tls]` is the one the host serves, so nothing is read once the lock is held, and any failure after the lock releases it. A failed `listen()` closes whatever started and may run again.
  - **I4:** the header unit reads the page through happy-dom, independently, and `sandbox` and `report-uri` join the directives a `<meta>` policy may not hold.
  - **Nits:** `HOST_DIST_INVALID` removed; `:443` normalized away from `Host`; the resolved secrets serialize as their names only; the server reader's admitted keys held equal to `server.v1.json`'s; the manifest's entry test.
- **Step 4 obligation** (the review, 2026-11-09): step 1 matches its few routes on the raw path in one catch-all. Step 4 and step 6 register the MCP route and the relay as prefix routes, and decide how a dot segment or an encoded separator in such a path is matched.
- **For the deployment guide** (step 10): two hosts started at the same moment on one data directory can both be refused `HOST_DATA_LOCKED`, since with a busy timeout of 0 neither waits for the other; start one, then retry.
- **Step 3 obligation** (the coordinator, 2026-11-09): version 4's reserved workspace ids gain `api`, `mcp`, `mounts` and `.well-known`, the configured `identity.path`'s first segment, and every `HostModule` name; step 1's refusal in `loam-host` (deviation 2) then moves into the schema, keeping its code.
- **Step 2, the development profile** (this pull request, on `main` at `784b7e1f`): `loam-host dev` in 5.1's order (the lock; the certificate by 5.1's `openssl` command and the generated secret, kept across runs; both listeners bound before the configuration; `dev.json`'s ports, `HOST_PORT_TAKEN` and `HOST_DEV_PORT_CHANGED`; the sandbox on `https://127.0.0.1:<second port>`, the site written with it; the mail sink; `.gitignore` of `*`, files 0600 and directories 0700); `startDevHost` and `scanSecrets` at `@lushly-dev/loam-host/testing`; the harness on a `DevHost` (`launchForDevHost`, and the response CSP read beside the `<meta>`); the `Hosted development profile` job and its `Hosted criterion against the development profile` step; `WORKFLOWS.loam.jobs` and the exit check's recorded run gain it; `suites.mjs` runs `test:hosted`, with `openssl` from step 1; `AGENTS.md`; P6-H1 and P6-H2, with step 1's cases for the `Host` check, the sandbox, the lock in a second process, TLS, health and `base_path`. **Section 14's rows:** `ubuntu-latest` measured 301 ms and 93 MB in #945's `Hosted development profile` job, so the ceilings are 377 ms and 117 MB (approved by the coordinator 2026-11-10), which P6-H1 asserts. The development machine (macOS, Apple silicon, under other agents' load) measured 138 to 408 ms and 97 to 98 MB, so a loaded machine can exceed the cold-start ceiling. **Deviations, each with its reason:**
  1. **A `local` deployment of version 2 is served only through the test-only option until step 3**, which brings version 4. The bin's `dev` refuses one as `HOST_DEPLOYMENT_KIND` (3.3), so P6-H1's "`loam-host dev` from an empty directory" runs through `startDevHost`'s child, which runs the bin's own `runDev` with the option; the bin's case is a unit now and moves to P6-H1 in step 3.
  2. **`dev` takes `--dist`**, defaulting to the workspace's `web/dist`: 5.1's command names none, and the server needs the build it serves.
  3. **The host serves through `@hono/node-server`'s request listener** on servers it creates, or that `dev` hands it already bound (5.1's step 3), rather than through `serve`, which binds as it creates. The gate still runs before the adapter.
  4. **The sandbox's listener is bound when the deployment has a view app or a `[sandbox]` of its own**, since a `[sandbox]` with no listener is `HOST_SANDBOX_INVALID`; 5.1 names the view app.
  5. **`DevHost` gains `data`**, the data directory's path, which P6-H1 and `scanSecrets` read. **`scanSecrets`' `found` names each secret by its index in `known` (or `auth secret`) and its place, never its value**, so a failing assertion cannot print one; it also scans for the profile's generated secret.
  6. **`startDevHost` refuses `organization`, `people`, `resources`, `accessTokenTtlSeconds` and `modules`** until the steps that build them; `db()` opens a database only once it exists (steps 3 and 4), and `journal()` is empty until step 4 writes `journal.jsonl`. The certificate is made before the child starts, so `NODE_EXTRA_CA_CERTS` names it from the child's first line.
  7. **`loam-host` no longer has `loam-web` as a dev dependency**, since `web`'s harness now depends on `loam-host`. The header unit reads the web host's page source, whose `<meta>` `vite build` keeps, declared in `scripts/affected/scope.mjs`'s `EXTRA_INPUTS`.
  8. **A fix to step 1:** the gate normalized `:443` away from `Host` but passed the header on unchanged, so the per-socket dispatch missed and answered 404. It now passes on the authority it decided, in `headers` and in `rawHeaders`, from which `@hono/node-server` builds the `Request`; `:443` is dropped only from a host with no other port.
  9. **No new codes for the profile's own refusals.** A `--data` that is not the profile's, a `dev.json` that does not hold ports, and a missing or failing `openssl` are each `HOST_CONFIG_INVALID`, keyed by the path or by `openssl`, with a suggestion. `dev` takes a data directory only when it is missing, empty, or already the profile's (it holds `dev.json`, or a `.gitignore` of exactly `*`), so it never re-modes or writes into another.
  10. **Unit coverage leaves out two files,** with the reason in `vitest.config.ts`: `testing/child-launcher.ts`, which spawns the child, and `testing/dev-child.ts`, the child's entry. They run only as the built child, so only the hosted suite reaches them. `startDevHost`'s `DevHost` takes a launcher, and the units drive everything else of it with the profile in-process.
- **The independent review of `bfda381c`** ([#945](https://github.com/lushly-dev/afd/pull/945)) said merge after fixes, with no blocker, and found 5.1's order, the sandbox's site separation, deviation 3 and the testing seams sound. Applied: `Host` rewritten in `rawHeaders` (I1); P6-H1's restart case reopening the shell in a context kept open across it and finding its project (I2); `scanSecrets` reading every file's bytes but the profile's two secret files, and looking for the TLS key's body, with units (I3); the data directory taken only when it is the profile's (I4); section 14's ceilings (I5); and the nits: `:443` only from a host with no other port, a corrupt `dev.json` refused, `HOST_PORT_TAKEN` naming `--port` or the real `dev.json`, a recorded sandbox port kept, a failed `listen()` closing the host and a retried one adding no second handler, a missing `openssl` named, `basePath` merged into an existing `[site]`, one cached `db()` handle per host, the header test's title, STATUS.md's next steps, `AGENTS.md`'s list of what `pnpm check` does not cover, and the `[::1]` follow-up.
- **Not done:** everything else it specifies (steps 0a and 3 to 13); the owner's answers to Q1 and Q2, which block only the steps they name.
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 7, identity once; 8, agents are first-class users; 13, deterministic core; 15, AFD first; the architecture's "Hosts" and "Distribution" components: browser, Tauri desktop and hosted server with the same chrome and the same kernel; a static site, desktop installers, an OCI image and an MCP registry entry, with deployers hosting it.
- **Decisions it depends on:** D9 (three app kinds); D14 (placement under `endpoints/loam/`, every unit quarantined); D15 (AFD first); D25 (TypeScript first; the desktop is Tauri 2 with the kernel in the webview); D32 (single-tenant); D33 (Tauri mobile reserved); D36 (Hono, with AFD's `createMcpHandler` mounted by Hono's Node adapter); D46 (the collaboration service after phases 2 and 6); D52 (IndexedDB on the desktop, SQLite only on a measurement); D54 (native apps are trusted code); D55 and D56 as narrowed by **D95** (no `stdio` instance in a `provider` workspace); D62 (the sandbox proxy on a second origin); D63 (no secret in the projection); D64 (the same-origin route `mounts/<instance>/mcp`, which "the hosted lane serves in phase 6"); D65 (a mounted instance's exposure); D71 and D78 (scope over MCP and to an instance); D74 (the URL scheme, `index.html` for a path with no file); D84 (phase 3's hosted criterion on phase 6's development profile); D85 to D99, phase 3's, which phase 6 delivers and does not redesign; D98 (a connected agent has at most its person's access).
- **Decisions this specification records:** D100 to D108, decided with this specification's approval on 2026-11-09, in [Amendments](#amendments-to-the-architecture-and-the-decision-log) and the decision log. D100 stays the coordinator's reading of D46, which the owner may overrule.

### Carried from earlier phases, answered here

| Item | Answer |
| --- | --- |
| [Phase 3's 10.2](../3-identity/spec.md#102-what-phase-6-must-deliver-first), items 1 to 6 | Milestone M1, the development profile ([section 5](#5-the-development-profile-milestone-m1)); [5.3](#53-phase-3s-102-item-by-item) maps each item to the test that proves it |
| Phase 3's 2.5: "phase 6 decides how a browser sends" the trust-record commands | [Section 6](#6-trust-records-on-the-hosted-lane-d103) |
| Phase 3's 4.3: "phase 6 measures" the cost of no cookie cache | [Section 14](#14-budgets), row `whoami` |
| Phase 2's 3.3: `mcpOptions().commands` "with `expose.mcp` as phase 6 will decide"; phase 0's 6.1: "phase 6 revisits" CLI and MCP exposure | [Section 7](#7-the-hosted-mcp-surface-d104) |
| Phase 2's 6.2: "phase 6's hosted lane serves" `index.html` for a path with no file, and documents `frame-ancestors` | [3.4](#34-routes) and [3.5](#35-response-headers-the-csp-and-static-files) |
| Phase 0's 9: `frame-ancestors` "moves to a response header with the hosted lane" | [3.5](#35-response-headers-the-csp-and-static-files) |
| Phase 1's follow-up: the route `mounts/<instance>/mcp` "must require `Origin` or `Sec-Fetch-Site`" | [Section 8](#8-the-mount-relay-d105), as phase 3's 10.2 item 5 already requires |
| Phase 1's follow-up: "run the mounted suite against a real hosted server, with its secrets, membership and limits, on the same route" | P6-M1 ([section 19](#19-exit-criterion-and-tests)), in M2 |
| Phase 1's catalog: `secrets`, "Phase 6" | [Section 13](#13-secrets-d108): resolved on the server only; the grant moves to phase 5 with `http` |
| D52: SQLite on the desktop "admitted in phase 6 only on a measurement" | [10.5](#105-the-store-and-d52s-measurement) |
| [#706](https://github.com/lushly-dev/afd/issues/706): run the suites in Firefox and WebKit | Partly: the desktop lane runs the shell in WebKitGTK and WebView2 (P6-D1); Firefox and Safari stay with #706 |
| [#711](https://github.com/lushly-dev/afd/issues/711): "whether the browsers phase 6 adds differ" on WebRTC from a view | Recorded, not decided: P6-D3 records the result in each webview; the decision stays the owner's on #711 |
| [#858](https://github.com/lushly-dev/afd/issues/858): first paint on a real low-end device | Stays open: it needs a device, not a host. The development profile makes the measurement easy to take over a network; [follow-ups](#follow-ups) |
| OP10: "a server card, a well-known catalog entry and a plain guide for agents" | [11.5](#115-the-server-card-the-catalog-and-the-guide), in M4 |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-09 (sources S88 to S97 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 6 |
| --- | --- | --- | --- |
| W7 | Tauri 2.12.5 on 2026-10-21; 3.0 in alpha | The `tauri` crate 2.12.5 (2026-10-21, MSRV 1.90) is current; `@tauri-apps/cli` 2.12.4 (2026-10-21); 3.0.0-alpha.6 (2026-11-06) [S90]. WebDriver: "Driven directly, only Windows and Linux are supported on desktop, as macOS has no WKWebView driver tool available" (page updated 2026-06-29) [S91] | The desktop lane pins 2.12; Linux runs the suite under `tauri-driver` on pull requests, Windows daily, macOS builds only ([10.7](#107-the-desktop-suite)) |
| W30 | Chrome's Local Network Access since 142, split in 145; Firefox and Safari not found | Chrome 142 launched the prompt (Chrome's post, updated 2025-09-29); 145 split `local-network-access` into `local-network` and `loopback-network`, keeping the old name as an alias (blink-dev intent to ship) [S93]. Firefox and Safari: not found on 2026-11-09 | Unchanged reasoning: a browser reaches an instance through the hosted server (D64). The hosted shell's `Permissions-Policy` denies both to the page ([3.5](#35-response-headers-the-csp-and-static-files)) |
| W21 | Windows on-device agent registry in preview; "the desktop packages the hosted server as an MCP bundle" | Not re-checked; nothing in phase 6 waits on it | The MCP bundle stays reserved ([section 18](#18-out-of-scope-and-the-seams-reserved)) |
| New W34 | Not watched | `hono` 4.13.17 (2026-11-07), 5.0.0-rc.1 tagged `next`; `@hono/node-server` 2.1.6 (2026-11-02), peer `hono` `^4 \|\| ^5.0.0-0`, Node `>=20`; its Node bindings expose `incoming` and `outgoing`, and `RESPONSE_ALREADY_SENT` tells it the handler wrote the response [S88, S89] | The hosted server on Hono 4.13 (D101); Hono 5 is watched |
| New W35 | Not watched | The MCP Registry is in preview, "Breaking changes or data resets may occur before general availability"; `server.json` at schema `2025-12-11`; OCI images on Docker Hub, GHCR and three cloud registries, verified by the `io.modelcontextprotocol.server.name` annotation; it "**does not** support private servers" [S94] | A registry entry can describe Loam's image, never a deployer's private server; phase 6 writes and validates it, and submits nothing ([11.4](#114-the-registry-entry)) |
| New W36 | Umbel's R11 cites SEP-2127 | SEP-2127, MCP Server Cards, is **Final**; a card "MAY" be at `<streamable-http-url>/server-card`, media type `application/mcp-server-card+json`, `Access-Control-Allow-Origin: *`, `ETag` and `304`; an AI Catalog "MAY" be at `/.well-known/ai-catalog.json`; cards carry no tools and nothing sensitive [S95] | The hosted server serves a card; the catalog is the deployer's choice ([11.5](#115-the-server-card-the-catalog-and-the-guide), Q2) |
| New W37 | Not watched | Node 26 is LTS ("Lithium"), 26.13.0 on 2026-10-28; `node:26-trixie-slim` updated 2026-11-05 [S96] | The hosted server and image run Node 26 (`.nvmrc`); the image pins its base by digest |
| W33 (phase 3) | MCP Authorization, Better Auth issuing tokens | Unchanged since 2026-11-09. `@better-auth/oauth-provider` 1.7.18 ships helpers for serving its metadata at the origin's root when a `basePath` keeps it off it; `better-auth` 1.7.19 appeared at 2026-11-10T00:24Z, inside the three-day `minimumReleaseAge`, so phase 3's pin of 1.7.18 holds [S97] | The hosted server owns the origin's `/.well-known/oauth-*` paths ([3.7](#37-the-provider-and-the-well-known-documents)) |

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
| Effective command | What a relayed `tools/call` runs at the instance: its tool, or `afd-call`'s `arguments.command` ([8.1](#81-the-route-parse-decide-rebuild)) |
| Milestone | A named exit point inside phase 6 that unblocks something on its own ([section 1](#1-milestones-and-the-order-d100)) |

## 1. Milestones and the order (D100)

### 1.1 Four milestones and the exit

| Milestone | What it delivers | What it unblocks | Steps |
| --- | --- | --- | --- |
| **M1, development profile** | Everything phase 3's 10.2 lists, on `https://localhost`, by one command, with the `Hosted development profile` job, and nothing more | **Phase 3's step 10** (P3-H1 to P3-H5) and **phase 5**'s MCP criterion | 0a, 1 to 7 |
| **M2, hosted lane** | The production profile: the deployer's origin, TLS or a proxy, real mail and single sign-on, limits, `doctor`; the mounted suite through the hosted relay | **The collaboration service's specification** (D100's reading of D46) | 8 |
| **M3, desktop lane** | The same build in Tauri 2 on Linux, Windows and macOS, with mounts over the Rust host | Nothing before phase 7 | 11, 12 |
| **M4, distribution** | The static site documented, the OCI image, installers, the registry entry, and the server card, catalog and guide, built and verified, **nothing published** (Q1) | Nothing before phase 7 | 9, 10, and 12's installers |
| **Exit** | M1 to M4, and the copilot served from the same process once phase 5's runtime exists ([section 12](#12-the-copilot-in-the-same-process)) | **Phase 7** | 13 |

**Why the exit waits for phase 5.** The architecture's exit criterion says the hosted server serves "the copilot from one process", and the copilot runtime is phase 5's. Phase 6 provides the seam; the row that proves it runs when phase 5 has a runtime. Phase 7 needs phases 4, 5 and 6 anyway, so nothing waits longer than it would.

**Why the collaboration service waits for M2, not M1.** This is the coordinator's reading of D46, and the owner may overrule it. The sync endpoint will carry real people's content between real browsers, so its design depends on what only M2 decides: a deployer's origin behind TLS or a proxy, the client address the server trusts, its limits, real mail for the invitations sharing needs, and a store that survives restarts in production. M1 is `https://localhost` with a mail sink, enough for phase 3's and phase 5's criteria and nothing a team runs.

**M1 is the earliest exit point.** Steps 0a, 1 and 2 need nothing of phase 3 and can start at once; steps 3 to 6 follow phase 3's steps as 1.2 lists; step 7 records M1. Nothing in M2, M3 or M4 is on M1's path: the server card, catalog, guide and registry entry are M4's, and the mounted suite against a stock `umbel` through the hosted relay is M2's, while M1 proves 10.2 item 5 against phase 2's scope fixture.

### 1.2 Dependencies on phase 3's steps

Phase 3's plan is in [its section 19](../3-identity/spec.md#19-implementation-plan).

| Phase 6 step | Needs from phase 3 | Why |
| --- | --- | --- |
| 0a, SQLite adapter | Nothing | AFD's `local-db` |
| 1, host skeleton | Nothing | Serves `local` deployments of versions 1 to 3 through a test-only option, removed in step 3 |
| 2, development profile | Nothing | HTTPS, certificate, data directory, harness, the new job |
| 3, provider and deployment version 4 | **Step 1** (`createLoamAuthOptions`, `loamServerPlugin`, deployment version 3) and **step 4** (`bootstrapOrganization`; the join and recovery pages) | 10.2 items 1 and 2 |
| 4, server kernel and MCP | **Steps 0a and 0c** (AFD's TypeScript MCP authorization) and **step 7** (`createServerKernel`, `createMcpAuth`, `credentialsGate`, the OAuth provider and its pages, so `getOAuthServerConfig` exists for the root metadata) | 10.2 item 3, and A2 |
| 5, trust-record transport | **Step 7** (`principalGate`'s session source) | 10.2 item 4 |
| 6, hosted relay | **Step 7** (the server's membership read and `decideAccess` version 2) | 10.2 item 5 |
| 7, M1 recorded | Phase 3's step 9's `--phase` option in the exit check, if it has merged; otherwise step 7 adds it and step 9 rebases | 10.2 item 6 |

Phase 3's step 10 needs phase 6's step 7. Phase 3's steps 0b, 2, 5, 6 and 8 are not on phase 6's path.

## 2. Units and repository placement

Two new packages, private and quarantined, under the workspace glob `endpoints/loam/packages/*` (D14):

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/packages/host/` | `@lushly-dev/loam-host` | **Server only.** `createLoamHost(config)` ([section 3](#3-the-hosted-server-d101)); the `loam-host` bin (`dev`, `start`, `bootstrap`, `check`, `doctor`, `health`); `HOSTED_MCP_COMMANDS`; the server's store, journal and lock; the static handler; the trust-record transport; the hosted relay; the server card, catalog and guide; under `/testing`, `startDevHost()` and `scanSecrets()` ([5.2](#52-the-test-harness)); `Containerfile` ([11.2](#112-the-oci-image)) | `hono` and `@hono/node-server`, exact ([below](#pins)); `nodemailer` exact (step 8); `@lushly-dev/loam-identity`, `@lushly-dev/loam-kernel`, `@lushly-dev/loam-manifest`, `@lushly-dev/loam-cli` (for `writeDeployment`), `@lushly-dev/afd-server`, `@lushly-dev/afd-client`, `@lushly-dev/afd-core`, `@lushly-dev/local-db`; dev: `smtp-server` (step 8), `@lushly-dev/loam-web` |
| `endpoints/loam/packages/desktop/` | `@lushly-dev/loam-desktop` | The Tauri 2 app: `src-tauri/` (the Rust host crate `loam-desktop`, `publish = false`, its own `Cargo.lock` committed), the front end being `web`'s `dist`; the `loam` and `loam-sandbox` protocols; the desktop's mount transport over IPC ([section 10](#10-the-desktop-lane-d106)); its WebDriver suite | `@tauri-apps/cli` and `@tauri-apps/api`, exact; crates `tauri`, `tauri-build`, `tauri-plugin-single-instance`, `tauri-plugin-updater` and `reqwest` (`default-features = false, features = ["rustls", "stream", "http2"]`; 0.13.5 has no `rustls-tls` feature), each `=`-pinned; dev: `webdriverio`, exact; `tauri-driver` in CI |

<a id="pins"></a>**Pins and age.** Package versions live in each `package.json` and `Cargo.toml`, not in this document's decisions; on 2026-11-09 they are:

| Dependency | Version | Published | Clears the three-day `minimumReleaseAge` |
| --- | --- | --- | --- |
| `hono` | 4.13.17 | 2026-11-07T04:56Z | 2026-11-10; a step landing earlier takes 4.13.16 (2026-11-01) |
| `@hono/node-server` | 2.1.6 | 2026-11-02 | Yes |
| `nodemailer` | 10.4.0 | 2026-11-07T20:30Z | 2026-11-10 |
| `smtp-server` | 3.21.3 | 2026-10-29 | Yes |
| `@tauri-apps/cli`, `@tauri-apps/api` | 2.12.4 | 2026-10-21, 2026-10-14 | Yes |
| `tauri` | 2.12.5 | 2026-10-21 | Yes |
| `tauri-build` | 2.7.4 | 2026-10-21 | Yes |
| `tauri-plugin-single-instance` | 2.5.5 | 2026-10-28 | Yes |
| `tauri-plugin-updater` | 2.14.1 | 2026-10-28 | Yes |
| `reqwest` | 0.13.5 | 2026-09-08 | Yes |
| `tauri-driver` | 2.1.0 | 2026-09-26 | Yes |
| `webdriverio` | 10.2.0 | 2026-11-06T02:04Z | 2026-11-09 |

- **The host never reaches a browser.** E13's scan of phase 3 gains `@lushly-dev/loam-host`: no import of it from `web/src`, `chrome/src` or `kernel/src`. The `loam-host` bin never imports `@lushly-dev/loam-host/testing`; a unit scans the bin's graph.
- **The Rust toolchain.** `packages/desktop/src-tauri/rust-toolchain.toml` pins **1.98.0**, Umbel's, so the shared `CARGO_TARGET_DIR` builds third-party crates once; `pnpm rust:sweep` covers it as a Cargo workspace with a `target/`. `.gitignore` gains `!endpoints/loam/packages/desktop/src-tauri/Cargo.lock`.
- **Release inventory.** Two entries in phase 1's shape: `loam-host` and `loam-desktop`, `state: "quarantined"`, `routes: []`, `fixed: false`, `private: true`; `loam-host`'s gates are `pnpm check`, `loam.yml`, `release-approval`; `loam-desktop`'s add `loam-desktop.yml`, so `scripts/repository-contract.test.mjs:323` gains an exception naming `loam-desktop` and its four gates. **Nothing publishes** (Q1).
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names both, in steps 1 and 11.
- **`AGENTS.md`.** The architecture tree gains `host` and `desktop`; the Loam key rule names the new jobs, steps and workflow; the CI table gains the `OCI image` job and `loam-desktop.yml`. Steps 1, 2, 9 and 12 do it.
- **Changesets.** Step 0a carries one for `@lushly-dev/local-db`. None for the private units.

| Existing package | Change |
| --- | --- |
| `kernel` | **Nothing in first paint.** `SHELL_EXPOSE` stays as it is in the browser. The `late-hosted` chunk with `SERVER_COMMANDS`, `trust-record-settle`, `trust-record-snapshot`, the routing of trust-record commands and A6's narrowing ([section 6](#6-trust-records-on-the-hosted-lane-d103)); `KernelPortsV1` gains an optional `serverCall`; `storeKind` gains `'sqlite'`; a Node-safe subpath, `@lushly-dev/loam-kernel/mounted`, exporting `discoverInstance`, `isMetaTool`, `unlistedProject`, `pinMountedInput`, `SCOPE_V1`, `DISCOVERY_LIMITS` and the catalog's types for the relay ([8.2](#82-the-tools-the-relay-knows)); `MountFailureCode`, `CODES` and `MOUNT_FAILURES` (`apps/mounted.ts`) and `LoamKernelErrorCode` (`errors.ts`) gain the relay's codes, each with the kernel's own message; `late-identity` exposes `refreshSession()` for the relay's and the transport's 401 ([8.1](#81-the-route-parse-decide-rebuild)); **`discoverInstance` sets `firstClass` only when the catalog's `toolStrategy` is `'hybrid'`**, the relay's rule, where today it ignores the strategy and sets the flag at `mounted.ts:435-437` and `:545` |
| `manifest` | `deployment.v4.json` and `projection.v4.json` with `[host]` ([3.3](#33-the-deployment-version-4)); `loam.server.toml`'s schema `server.v1.json` and `readServerConfig` |
| `cli` | `deployment write --host static\|hosted\|desktop`; for `desktop`, the IPC sources and the sandbox scheme's `frame-src` in the `<meta>` CSP, and `stdio` entries in `MountAccess` ([10.4](#104-mounts-over-the-rust-host)) |
| `web` | `server-call.ts`, loaded by `late-hosted` only ([6.2](#62-the-transport)); `mount.ts` carries a body's code only under the relay's `Loam-Relay-Refusal: 1` header, and its `request` reconnects first after `MOUNT_SESSION_UNKNOWN` ([8.1](#81-the-route-parse-decide-rebuild)); the harness opens a `DevHost` ([5.2](#52-the-test-harness)); the CSP checks read the response header too |
| `identity` | A7 (`ipAddressHeaders`), S4's `leave` endpoint and `/organization/leave` disabled, and A8's `PROVIDER_HOOK_FIELDS` ([Proposed amendments](#proposed-amendments-to-phase-3)) |
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
	/**
	 * A path segment under `<base_path>api/`. `kernel`, `health` and the first segment of the deployment's
	 * `identity.path` after `api/` (`auth` by default) are reserved; a module naming one refuses construction.
	 */
	name: string;
	routes(app: Hono<{ Bindings: HttpBindings }>, host: HostServices): void;
}
/** Opaque: only `sessionPrincipal` creates one, so a module never builds a principal or holds the kernel. */
export interface ModulePrincipal { readonly person: string; readonly brand: unique symbol }
export interface HostServices {
	/** 6.2's first and third rows, then the principal from the session, as phase 3's 9.5 builds it: always the human. */
	sessionPrincipal(request: Request): Promise<{ ok: true; principal: ModulePrincipal } | { ok: false; response: Response }>;
	/** Runs one command on the server kernel under that principal, through phase 3's principal chain. */
	callAs(principal: ModulePrincipal, command: string, input: unknown, scope: ScopeV1): Promise<CommandResult>;
}
export function createLoamHost(config: LoamHostConfig): Promise<LoamHost>;
export interface LoamHost { readonly origin: string; readonly sandboxOrigin: string | null; listen(): Promise<void>; close(): Promise<void> }
```

`createLoamHost` refuses to construct, with its code ([section 16](#16-failure-modes-and-error-codes)), on any refusal of 3.2 or 3.3, a locked data directory, an unreadable secret, a reserved module name, or a `provider` deployment with a `stdio` instance (D95, `DEPLOYMENT_STDIO_TEAM`). It awaits the server kernel's stage B before reading `mcpOptions()`, which is undefined until `late/` has loaded (`kernel.ts:195`, `:778`). **Only `start`** also refuses a `provider` deployment whose organization was never bootstrapped (`HOST_NOT_BOOTSTRAPPED`, naming `loam-host bootstrap`); `dev` starts, and its shell shows phase 3's `IDENTITY_ORGANIZATION_UNKNOWN` until `bootstrap --dev` runs ([5.1](#51-one-command)).

**Which `host` each kernel reports.** The server kernel reports `host: 'hosted'` and `store: 'sqlite'` in `shell-info-get`; the browser's kernel on a hosted deployment is still `host: 'browser'`, since it runs in a browser.

### 3.2 The server configuration, `loam.server.toml` version 1

The deployment file says what the workspace is and what the browser may know (D63). **What only the server reads goes in a second file**, which phase 3's 2.2 calls "the hosted lane's" configuration: `manifest/schemas/server.v1.json`, read by `readServerConfig`, never served, never in a projection.

```toml
server_version = 1

origin = "https://loam.example.com"   # exact: https, host and port; the deployment's base_path follows it
listen = "127.0.0.1:8443"              # host:port
data = "/var/lib/loam"                 # the data directory (section 4); created 0700

[tls]                                  # absent: plain HTTP, allowed only on a loopback `listen` behind a TLS proxy
cert_file = "/etc/loam/fullchain.pem"  # with [sandbox] on the same `listen`, it must name both hosts
key_file = "/etc/loam/privkey.pem"

[sandbox]                              # needed when the deployment has a view app (D62)
origin = "https://loam-sandbox.example.net"   # another site; must equal the deployment's [sandbox] origin
listen = "127.0.0.1:8444"              # optional; absent, served on `listen` by Host, and [tls]'s certificate names both hosts

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
relay_session_idle_ms = 900000

[discovery]                            # Q2; defaults shown
server_card = true
ai_catalog = false
agent_guide = false
```

| Refusal | Code |
| --- | --- |
| Unknown key, wrong type, `server_version` not 1 | `HOST_CONFIG_INVALID` |
| `origin` not `https:`, or with a path, query, fragment or userinfo. **Every origin is `https:`**, `localhost` included | `HOST_ORIGIN_INSECURE` |
| No `[tls]` and a `listen` (or `[sandbox] listen`) that is not a loopback address | `HOST_LISTEN_INSECURE` |
| A secret given both ways, neither, an unreadable file, an empty variable, or an auth secret under 32 bytes | `HOST_SECRET_UNAVAILABLE` |
| On POSIX, a secret file, `key_file` or the data directory readable by group or others (on Windows, an ACL granting anyone but the owner) | `HOST_SECRET_PERMISSIONS`, naming the file and `chmod 600` (`700` for the directory) |
| `[sandbox] origin` present and different from the deployment's, not `https:`, or **the same site** as `origin` (the same registrable domain, or the same host for an IP address or `localhost`) | `HOST_SANDBOX_INVALID` |
| An `oidc:<id>` method with no `[oidc.<id>]`, or a table no method names | `HOST_OIDC_INVALID` |
| `[mail] transport = "sink"` with an `origin` whose host is not `localhost` | `HOST_MAIL_SINK_EXPOSED`: a sink keeps join and recovery links in a file, which only the development profile may do |

**The origin is configured, never derived.** No `X-Forwarded-*` header is read, ever. Every request's `Host` must be `origin`'s host and port, or `[sandbox] origin`'s; any other is `421 Misdirected Request` with nothing run (`HOST_MISDIRECTED`). Better Auth's `baseURL`, the passkey `rpID` and `origin`, the MCP resource, AFD's `allowedHosts` and `allowedOrigins`, and the server card's URL all come from `origin` and `base_path`.

**Why the sandbox is another site.** D62's proxy must not share the shell's cookies or storage partition: a different port on the same host is a different origin but the same site, and `SameSite` cookies, including phase 3's session cookie, are sent to it. A different site is what keeps a view's frame from riding the person's session.

### 3.3 The deployment, version 4

`deployment.v4.json` and `projection.v4.json`; `readDeployment` reads 1 to 4, `readBoot` and `readProjection` 2 to 4. Everything of version 3 stands. It adds:

```toml
deployment_version = 4

[host]
kind = "hosted"     # "static" (the default, as versions 1 to 3 read), "hosted" or "desktop"
```

- **The projection** gains `host: { kind: 'static' | 'hosted' | 'desktop' }`, and for `hosted`, `kernel: 'api/kernel'`, a same-origin path under `base_path`, as phase 3's `identity.path` is. Nothing else. **`workspace-deployment-apply`'s journaled input gains `host: { kind }`**, so a replay knows the kind from the journal (A5).
- **`deployment write --host <kind>`** sets the kind when the file does not, and refuses a mismatch (`DEPLOYMENT_HOST_MISMATCH`). For `desktop` it also writes the desktop's CSP sources into the `<meta>` policy ([10.2](#102-origins-and-the-csp)).
- **`loam-host` writes the site itself.** At start it runs `writeDeployment` into `<data>/public/site` with `--host hosted` and **without `mountsOut`**, since that file holds the bearers' values (`cli/src/deployment.ts:388-399`); it keeps `result.mounts` in memory only. The deployer never copies a written site by hand.
- **Rules.** `[identity] mode = "provider"` with `kind = "static"` is a warning, `DEPLOYMENT_PROVIDER_NEEDS_HOST`: "A provider deployment needs the hosted server; a static host serves no provider" (phase 3's test-only auth host still serves one in tests). `provider` with `kind = "desktop"` is refused, `DEPLOYMENT_DESKTOP_PROVIDER` ([10.1](#101-what-the-desktop-is)). `stdio` with `kind = "static"` keeps phase 1's `MOUNT_TRANSPORT_UNAVAILABLE` at run time; with `kind = "desktop"` it is served ([10.4](#104-mounts-over-the-rust-host)); with `provider` it stays refused (D95).
- **Version 3 deployments keep working.** A version 1 to 3 file reads as `kind = "static"`. `loam-host` refuses one that is not version 4 with `kind = "hosted"` (`HOST_DEPLOYMENT_KIND`), so a static deployment is never served by the hosted server by accident, and every fixture of phases 0 to 3 stays as it is.
- **The hosted server serves a team.** `loam-host start` refuses a `local` deployment (`HOST_IDENTITY_LOCAL`): phase 3's `createServerKernel` refuses `local`, since there every actor is an owner. `loam-host dev` serves one with the shell's routes only (`<base>mcp`, `api/kernel/call` and `mounts/*` answer 404), so P6-H2 can compare the hosted shell with the static one.

### 3.4 Routes

`<base>` is the deployment's `base_path`. Every route first passes the `Host` check (3.2). **Only these paths reach code; every other path under the origin is the static site's or a 404.**

| Route | Methods | Served by | Auth |
| --- | --- | --- | --- |
| `<base>` and every path below not listed here | `GET`, `HEAD` | The written site through `serveSite` (3.5): a file if one exists; otherwise, for `Accept` naming `text/html`, `index.html` with `200` (D74); otherwise 404 | None |
| `<base><identity.path>/*` (default `api/auth/*`) | As Better Auth's routes | `auth.handler(request)` from `createLoamAuthOptions` ([3.7](#37-the-provider-and-the-well-known-documents)), which also serves its OpenID configuration at `<base><identity.path>/.well-known/openid-configuration` itself | The provider's |
| `<base>mcp` | `POST`; `GET` and `DELETE` as AFD's handler answers them | AFD's `createMcpHandler` ([3.6](#36-mounting-afds-handler)) | Bearer, phase 3's 9.2 |
| `<base>mcp/server-card`, `<base>mcp/agents.md` | `GET`, `HEAD`, `OPTIONS` | [11.5](#115-the-server-card-the-catalog-and-the-guide), from step 10 | None; public |
| `<base>api/kernel/call` | `POST` | The trust-record transport ([6.2](#62-the-transport)) | Session |
| `<base>mounts/<instance>/mcp` | `POST`, `DELETE`; `GET` answers 405 | The hosted relay ([section 8](#8-the-mount-relay-d105)) | Session |
| `<base>api/health` | `GET` | `{ "ok": true }`, `Cache-Control: no-store`; nothing else, so it reveals no version or state | None |
| `<base>api/<module>/*` | The module's | A `HostModule` (phase 5's copilot) | The module's, through `sessionPrincipal` |
| `/.well-known/oauth-protected-resource<base>mcp`, `/.well-known/oauth-protected-resource` | `GET` | AFD's handler, M7's two URLs for the resource `<origin><base>mcp` | None |
| `/.well-known/oauth-authorization-server<base><identity.path>` | `GET` | `oauthProviderAuthServerMetadata(auth)` (A2), from step 4 | None |
| `/.well-known/ai-catalog.json` | `GET`, `HEAD`, `OPTIONS` | Only with `[discovery] ai_catalog = true` (Q2); otherwise 404 | None |
| On `[sandbox] origin`: `/sandbox/**` | `GET`, `HEAD` | The written site's `sandbox/` through `serveSite`, with `frame-ancestors <origin>` (D62); every other path there 404 | None |

- **Order.** Routes are registered most specific first: the well-known paths, `<base>mcp/server-card` and `agents.md`, `<base>mcp`, `<base>api/*` and `<base>mounts/*`, then the site's catch-all.
- **AFD's other routes are never reachable.** `/sse`, `/message`, `/rpc`, `/batch`, `/stream/*` and `/health` of AFD's handler (`http-handler.ts:406-466`) are not routed, under `<base>` or at the root; P6-H4 asserts each is a 404.
- **One deployment per origin.** The session cookie is host-only with `Path=/` (phase 3's 9.5, `__Host-`), so every path on the origin receives it, and the hosted server answers the origin's root `/.well-known/oauth-*`. So `base_path` serves a proxy that maps a path, never an origin shared with another application. `loam-host check` warns `HOST_ORIGIN_SHARED` when `base_path` is not `/`, with that sentence, and the distribution guide says it.

### 3.5 Response headers, the CSP and static files

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`; on a non-loopback origin, `Strict-Transport-Security: max-age=31536000`. **On the routes that answer `RESPONSE_ALREADY_SENT`** (`<base>mcp` and the relay), the host sets these with `outgoing.setHeader` before handing the response to the handler, since Hono's middleware never sees it; P6-H4 and P6-H6 assert them. HTML responses add:

| Pages | `Content-Security-Policy` response header |
| --- | --- |
| Every shell page (`index.html` at any path) | **The `<meta>` policy `deployment write` wrote into that `index.html`, read from the file at start, plus `; frame-ancestors 'none'`.** Phase 0's directives are unchanged, so no source widens; the header and the `<meta>` are both enforced, and the header adds only what a `<meta>` cannot carry |
| `~/oauth/login`, `~/oauth/consent`, `~/join`, `~/recover` (phase 3's 9.4, 5.6, 5.7) | The same, plus `; form-action 'self'` |
| `sandbox/` on the sandbox origin | `frame-ancestors <origin>`, as phase 1's harness serves it |

- **`Permissions-Policy`** on shell pages: `camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=()` (W30). `publickey-credentials-get` and `publickey-credentials-create` keep their default, `self`, which passkeys need.
- **Caching.** `index.html`, `404.html` and `deployment.json`: `Cache-Control: no-cache`. `assets/*`, whose names carry their hashes: `public, max-age=31536000, immutable`. **`<base>api/kernel/call`, `<base>mounts/*`, `<base>mcp` and `<base><identity.path>/*`: `no-store`.** Anything else: `no-cache`.
- **Static files.** `serveSite(root)`, Loam's own handler in `loam-host` (not `@hono/node-server`'s `serveStatic`, so its refusals are in one tested function): it decodes the path once, refuses any request whose raw or decoded path holds `..`, `%2e`, `%2f`, `%5c`, `\` or `NUL` (404), resolves the result with `realpath`, and serves it only when the resolved path is inside `realpath(<data>/public/site)`, so a symlink out of the site is a 404 too. Only `<data>/public/site` is ever passed to it, and nothing else is under `<data>/public/`.
- **A unit holds the header builder**: the header equals the file's `<meta>` content with `frame-ancestors 'none'` appended, for every written `index.html` of the fixtures, and adds nothing else.

### 3.6 Mounting AFD's handler

D36 stands, read against the code: AFD's handler is a Node `(req, res)` handler that matches the absolute paths `/mcp` and `/health` (`http-handler.ts:406-410`). So, once the server kernel's stage B has ended:

```ts
const options = kernel.mcpOptions()!;   // phase 3's 9.5: the server kernel's chain, credentialsGate first
const mcp = createMcpHandler({
	...options,
	commands: hostedCommands(options.commands),   // section 7: only HOSTED_MCP_COMMANDS, `expose.mcp` set on copies
	name: 'loam', version: SHELL_VERSION,
	auth: createMcpAuth(config),            // phase 3's 9.3 and 9.4; resource `${origin}${base}mcp`
	allowedHosts: [new URL(origin).hostname],
	allowedOrigins: [origin],
	maxBodyBytes: limits.request_body_bytes,
});
app.on(['POST', 'GET', 'DELETE'], `${base}mcp`, (c) => {
	const { incoming, outgoing } = c.env;   // @hono/node-server's HttpBindings
	setSecurityHeaders(outgoing, { cache: 'no-store' });   // 3.5
	incoming.url = `/mcp${new URL(c.req.url).search}`;     // the handler's own path; `base` is the host's
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
- **The client's address (A7).** Better Auth 1.7.18 reads a client's address only from `ipAddressHeaders`, default `x-forwarded-for`, and keys every request with none to one shared rate-limit bucket (S97). So before any route, the host **deletes any incoming `x-forwarded-for` and `x-loam-client-ip`**, then sets `x-loam-client-ip` from `incoming.socket.remoteAddress`; `createLoamAuthOptions` gains `advanced.ipAddress.ipAddressHeaders: ['x-loam-client-ip']`. A forged header can neither pick a bucket nor escape one (P6-H10).
- **Leaving the organization (S4).** Better Auth's `/organization/leave` deletes the member without `beforeRemoveMember` or `afterRemoveMember`, and counts only the creator role as an owner (S97). `createLoamAuthOptions` adds it to `disabledPaths`, and `member-leave` runs through `loamServerPlugin`'s own `leave` endpoint, which takes **the same removal path as `member-remove`**: phase 3's 7.1 last-owner rule as D96 reads it (`MEMBER_LAST_OWNER`), then `revoke-person`, then the server's `agent-member-settle` (A4, A8).
- **The settle runs once on either path.** `createLoamAuthOptions` takes one callback from the host, **`onMemberRemoved({ organizationId, userId, removedBy })`**, which runs `agent-member-settle` on the server kernel. Better Auth's removal fires `afterRemoveMember`, which calls `revoke-person` and then `onMemberRemoved`. The `leave` endpoint deletes the member row itself after the last-owner check, so `afterRemoveMember` does not fire on it, and it calls the same `revoke-person` and `onMemberRemoved` once. A unit holds that each path calls `onMemberRemoved` exactly once.
- **Mail.** `mail` is `createMail(server.mail)`: `sink` appends one JSON line per message (`{ to, subject, text, at }`) to `<data>/mail.jsonl`, mode 0600; `smtp` sends through `nodemailer` with the URL from its secret ([section 9](#9-the-production-profile-milestone-m2)). A failed send is logged with the message's kind and the recipient's domain only, never the link.
- **The authorization server's metadata at the root (A2).** OAuth clients find the issuer's metadata by RFC 8414's path insertion, `/.well-known/oauth-authorization-server` before the issuer's path, and `oauthProviderAuthServerMetadata` exists for a `basePath` that keeps the provider off the root (S97). **The hosted server owns that path at its origin's root.** It needs the OAuth provider's `getOAuthServerConfig`, phase 3's step 7, so it lands in step 4 with the MCP route. Better Auth serves the OpenID configuration under its own path.
- **Bootstrap** has two forms, each running phase 3's `bootstrapOrganization` against the data directory and taking the lock, so it never runs beside a server:
  - `loam-host bootstrap --server <file> --deployment <file> --slug <slug> --name <name> --owner-email <email>`, for a production profile, with the server stopped;
  - `loam-host bootstrap --dev --deployment <file> [--data <dir>] --slug --name --owner-email`, for the development profile: it reads the origin from the data directory's `dev.json`, and its generated secret and mail sink (5.1); on an empty directory it creates the certificate, the secret and the ports itself, as `dev` would; and it refuses while `dev` holds the lock (`HOST_DATA_LOCKED`).

  Each creates the organization, pins the binding, sends the owner's invitation through `mail`, and prints `{ organization: { id, slug }, invited }`. It refuses when a binding exists (`HOST_ALREADY_BOOTSTRAPPED`) and when the deployment's `[identity] organization` differs from `--slug` (`DEPLOYMENT_IDENTITY_INVALID`). It is the only way the first organization comes to exist (10.2 item 2).
- **The cost of no cookie cache** is measured by P6-H3 ([section 14](#14-budgets)). Secondary storage is added only if the row fails, never the cookie cache.

### 3.8 The `loam-host` commands

Each prints a `CommandResult` as JSON and exits with the AFD CLI's codes, as `loam` (phase 1's CLI) does.

| Command | Does |
| --- | --- |
| `loam-host dev --deployment <file> [--data <dir>] [--port <n>]` | [Section 5](#5-the-development-profile-milestone-m1) |
| `loam-host start --server <file> --deployment <file> --dist <dir>` | Checks, takes the lock, writes the site, starts; on `SIGTERM` and `SIGINT` stops accepting, waits up to 10 s for requests in flight, flushes the journal and releases the lock |
| `loam-host bootstrap …` | 3.7's two forms |
| `loam-host check --server <file> --deployment <file> --dist <dir>` | Every refusal and warning of 3.2, 3.3 and phase 3's 2.2, without starting |
| `loam-host doctor --server <file> --deployment <file>` | `check`, plus, **opening both databases read-only and never taking the lock**: the lock's holder as `.lock` reports it, the binding and `IDENTITY_BINDING_MISMATCH`, each mounted instance reachable with its bearer (`MOUNT_UNREACHABLE` or `MOUNT_UNAUTHORIZED`, never the token), the data directory's files and sizes, and which of them to back up |
| `loam-host health --server <file>` | One `GET <base>api/health` to `listen`, with TLS's SNI and `Host` set to `origin`'s host, accepting the configured certificate; exits 0 on `200`. The image's `HEALTHCHECK` ([11.2](#112-the-oci-image)) |

## 4. The server's store and journal (D102)

| Path in the data directory | Holds | Written by |
| --- | --- | --- |
| `lock.sqlite` | Nothing but the lock ([below](#the-lock)) | `start`, `dev`, `bootstrap` |
| `.lock` | `{ pid, startedAt, host }`, informational only | The lock's holder |
| `loam.sqlite` | The server kernel's workspace store | `SqliteAdapter` |
| `journal.jsonl` | The server kernel's journal, and every relayed call's record ([8.4](#84-what-the-relay-records)) | `FileJournalSink` |
| `auth.sqlite` | The provider's database, with `loamServerPlugin`'s tables | Better Auth |
| `mail.jsonl` | The development profile's sent mail | The sink |
| `public/site/` | The written site, and nothing else under `public/` | `writeDeployment` |
| `tls/` | The development profile's certificate and key | `dev` |
| `secrets/` | The development profile's generated auth secret | `dev` |

- **AFD first: `SqliteAdapter`** (step 0a) in `@lushly-dev/local-db/sqlite`, a Node-only entry outside `/` and the browser graph, over `node:sqlite`'s `DatabaseSync` (**Node 22.13 or later**, where it needs no flag), fitting `DataAdapter` as the IndexedDB adapter does:
  - **One table:** `records(tbl TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (tbl, id)) WITHOUT ROWID`, the value JSON;
  - **Lists** go through `queryRows`, as the other adapters' do, filtered in the adapter after a range scan on `tbl`;
  - **Each batch** runs in `BEGIN IMMEDIATE … COMMIT`, rolled back on any failure;
  - `PRAGMA journal_mode = WAL` and **`synchronous = FULL`**, so a committed write survives a power loss.
  - It passes `runDataAdapterContract` from `@lushly-dev/local-db/testing`, titled `P6-E7:`, in the new step `AFD's host path` ([section 19](#19-exit-criterion-and-tests)). **`local-db`'s `src/entry.test.ts`** gains `/sqlite` and asserts the root entry never loads it. `storeKind` gains `'sqlite'`, and `shell-info-get` reports it.
- **The journal** is AFD's `FileJournalSink`. It appends after `next()` (`journal.ts:259`, `:290`) and does not `fsync`, so after a crash the store can hold a write the journal lost, never the reverse while it stays one process: P6-H8's invariant is **"every project the journal holds is in the store; the store holds at most the in-flight count beyond it"**.
- <a id="the-lock"></a>**The lock is the operating system's.** `start`, `dev` and `bootstrap` open `<data>/lock.sqlite` with `PRAGMA locking_mode = EXCLUSIVE`, the rollback journal (`journal_mode = DELETE`, never WAL, whose shared memory would not hold an exclusive lock across processes) and a busy timeout of 0, make one write, and keep the connection open for the process's life. A second process opens the file without error; **`SQLITE_BUSY` arrives on its first statement**, which is `HOST_DATA_LOCKED`. The lock ends with the process, however it ends, so a container's restart (where the server is pid 1) or a `SIGKILL` never leaves a stale lock. `.lock` is written beside it for `doctor` and people, and nothing reads it as a rule. **The data directory must be on a local filesystem, not NFS**, where SQLite's locks are unreliable; the guide says so.
- **Postgres is reserved.** D32's single tenant and one process fit SQLite. A second writer, or a deployment past SQLite's measured limits, is a follow-up with its own adapter and the same contract.
- **Backups** are the deployer's: `doctor` names the files, and the distribution guide says to copy `loam.sqlite` and `auth.sqlite` with SQLite's online backup or with the server stopped. Nothing in phase 6 automates it.

## 5. The development profile (milestone M1)

### 5.1 One command

`loam-host dev --deployment <file> [--data <dir>] [--port <n>]`, with `--data` defaulting to `.loam-dev/` beside the deployment file:

1. Takes the lock. Creates the data directory 0700 and writes `.loam-dev/.gitignore` containing `*`; every file it writes is 0600 and every directory 0700.
2. On first run, makes a self-signed certificate for `localhost` and `127.0.0.1`, as the hosted fixture does (`local.ts:80-96`): `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout tls/key.pem -out tls/cert.pem -days 30 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1`; and a 32-byte auth secret into `secrets/auth`. Later runs reuse both until the certificate expires. **The section 13 exception:** the development profile's generated secret is the only one written to the data directory.
3. **Binds both listeners first:** the shell on `127.0.0.1:<port>` (`--port 0` picks a free one), and, when the deployment has a view app, the sandbox on `127.0.0.1:<a second free port>`. **It records `{ port, sandboxPort }` in `<data>/dev.json` and reuses them on every later run**, so the origin, which passkeys and the provider's `baseURL` bind to, never changes for a data directory; a recorded port that is taken is `HOST_PORT_TAKEN`, naming it, rather than a silent new origin. **A `--port` that differs from `dev.json`'s** is refused with `HOST_PORT_TAKEN`'s sibling `HOST_DEV_PORT_CHANGED`, naming both, since it would change the origin the provider and every passkey are bound to; removing `dev.json` is the deliberate way to change it. **A view app added after `dev.json` was written with no `sandboxPort`** binds a free port for the sandbox and adds `sandboxPort` to `dev.json`, which leaves the shell's origin unchanged.
4. **Then builds the server configuration from the bound ports,** in memory: `origin = "https://localhost:<port>"`, `[tls]` from step 2, `[mail] transport = "sink"`, and `[sandbox] origin = "https://127.0.0.1:<second port>"`, **another site** from `localhost` (3.2), which the certificate already names. It writes the site with `--host hosted`, **overriding the deployment's `[sandbox] origin`** with that one, as the harness does today after binding (`harness.ts:209-219`).
5. Starts, and prints `{ origin, sandboxOrigin, spki, mail }`, where `spki` is the base64 SHA-256 of the certificate's public key.

A deployment for the profile needs `[host] kind = "hosted"`; `--deployment` with an older file is refused as 3.3 says. A `provider` deployment that was never bootstrapped starts, and its shell shows phase 3's `IDENTITY_ORGANIZATION_UNKNOWN` until `loam-host bootstrap --dev` runs with `dev` stopped (3.7).

### 5.2 The test harness

`@lushly-dev/loam-host/testing` exports:

```ts
export interface DevHost {
	origin: string; root: string; sandboxOrigin: string | null; spki: string;
	/** The dev certificate's path, for `NODE_EXTRA_CA_CERTS` in anything that fetches the host. */
	certificate: string;
	mail(): Promise<{ to: string; subject: string; text: string; at: string }[]>;
	db(): { auth: DatabaseSync; loam: DatabaseSync };   // read-only handles, for assertions
	journal(): Promise<JournalEntry[]>;
	logs(): string[];                                    // the server's log lines, for the secrets scan
	restart(): Promise<void>;                            // keeps `dev.json`'s ports, so the origin is the same
	kill(): Promise<void>;                               // SIGKILL, for P6-H8
	close(): Promise<void>;                              // removes the data directory on success and failure
}
export function startDevHost(options: {
	config: string;                      // the deployment file's text, as `serveDeployment` takes it
	basePath?: string;
	organization?: { slug: string; name: string };     // bootstraps, then seeds as `startTestAuthHost` does
	people?: { email: string; name: string; role: 'owner' | 'admin' | 'member'; methods?: ('passkey' | 'password')[] }[];
	modules?: HostModule[];
	/** Extra entries in the OAuth provider's `resources`, for P3-H1's second audience. */
	resources?: string[];
	/** Test-only: the access token lifetime, for P3-H4's expiry. Refused outside `startDevHost`. */
	accessTokenTtlSeconds?: number;
	/** The child process's environment additions. */
	env?: Record<string, string>;
}): Promise<DevHost>;
/** Scans the served files, the projection, both journals, the logs, every store row and every `localStorage` value for 13's secrets. */
export function scanSecrets(host: DevHost, pages: Page[], known: string[]): Promise<{ found: string[] }>;
```

- **The host runs in a child process**, as `startTestAuthHost` does, so a test can `kill` it, with `NODE_EXTRA_CA_CERTS` set to its own certificate so its provider can fetch its own origin.
- **Seeding is phase 3's.** People are seeded through the same function `startTestAuthHost` uses, from `@lushly-dev/loam-identity/testing`, against the dev host's provider.
- **P3-H3's client metadata document** is served by a same-origin `HostModule` fixture, `clientMetadataFixture`, at `<base>api/test-client/metadata.json`, so its `client_id` is an `https` URL the provider can fetch with the dev certificate trusted.
- **Chromium trusts only that certificate:** the harness launches the browser with `--ignore-certificate-errors-spki-list=<spki>`, so a different certificate is still refused, and cookies are `Secure` as in production. Pages open with the existing `openShell(browser, devHost.root, options, context)` (`harness.ts:330`), whose CSP check also reads the response header.
- **The secrets scan** runs inside each of P6-H3 to P6-H6, before `close()`, through `scanSecrets`; P6-H7 is its own scenario on one dev host.

### 5.3 Phase 3's 10.2, item by item

| 10.2 item | Delivered in | Proved by |
| --- | --- | --- |
| 1. One Node process on Hono serving the built shell under `base_path`, phase 0's CSP as response headers with `frame-ancestors`, and the OAuth pages' stricter CSP | Steps 1, 3, 4 | P6-H1, P6-H2; P6-E2 and P6-H3 for the OAuth pages' CSP (the pages exist from phase 3's step 7, so P6-H3's case for them closes in step 4) |
| 2. Better Auth at `<base_path><identity.path>` with its database in the data directory and a mail sink; the one-time bootstrap | Step 3 | P6-H3 |
| 3. `createMcpHandler` at `<base_path>mcp` through Hono's Node adapter, over `createServerKernel` with `credentialsGate` and `createMcpAuth`; RFC 9728 metadata (and A2's RFC 8414 metadata) | Step 4 | P6-H4 |
| 4. A server kernel whose store is authoritative for `ProjectV1.access`, `AgentMemberV1` and `WorkspaceAppV1.overrides`, and the transport, with the same-origin JSON `POST` rule | Steps 4, 5 | P6-H5, P6-H8 |
| 5. The mount relay enforces, with the same rule | Step 6 | P6-H6, P6-E5 |
| 6. HTTPS on `localhost` with a generated certificate, by one command; the `Hosted development profile` job and its `Hosted criterion against the development profile` step | Steps 2, 7 | P6-H1, P6-H7, P6-E8 |

**M1 is reached** when P6-E1 to P6-E5, P6-E7 to P6-E9 and P6-H1 to P6-H8 pass on `main` in their places, and STATUS.md records "development profile reached". Phase 3's step 10 then adds P3-H1 to P3-H5 to the same step.

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

- **`trust-record-snapshot`**, a new query, served only to the transport: `{}` to `TrustRecordSnapshotV1`, exactly what `project-list { status: 'all' }`, `workspace-app-list` and `agent-member-list { status: 'all' }` answer the session's person on the server.

  ```ts
  export interface TrustRecordSnapshotV1 {
  	/** SHA-256 of this snapshot's canonical JSON, without this field: a digest of what this person sees, never a global counter. */
  	generation: string;
  	projects: ProjectV1[];              // only those `project-list` shows this person
  	workspaceApps: WorkspaceAppV1[];
  	agents: AgentMemberRowV1[];         // filtered for the caller, as phase 3's 8.2; installed and connected
  }
  ```

- **In the browser,** each of these is routed in the kernel's `late-hosted` chunk: line 0 and the auth gate run as in phase 3, then instead of its handler, the call goes to `ports.serverCall({ command, input, scope })` and returns the server's `CommandResult` unchanged. **The routed call writes nothing in the browser on any path, and nothing in the browser ever writes the server's records;** the copy changes only through `trust-record-settle` (6.3).
- **`server-call.ts`'s mapping** of the transport's answers: `200` is the body's `result`; `401` is afd-auth's `UNAUTHORIZED`, after which it calls the kernel's `refreshSession()` (8.1), phase 3's 4.3 refresh run at once, which settles the person if the session is gone; `400`, `403` and `404` are the body's `code` with its message and suggestion; a `5xx` or a network failure is **`SERVER_UNAVAILABLE`**, retryable, journaled, with nothing written.
- **The agent interface (A6).** A browser's agent never reaches the transport: phase 3's 9.5 says the server takes every session call as the human, and "the browser forwards trust-record calls only from `kernel.call`, never from its agent interface". So in a hosted `provider` deployment, the agent interface's `project-create`, `project-update`, `project-archive`, `project-restore`, `workspace-app-set` and `agent-member-*` writes are `HUMAN_REQUIRED`, before any request; their reads are answered from the copy. An agent changes these records over MCP, as its own connected agent. This narrows phase 3's 3.4 Agent column for this deployment kind, and is declared as A6.
- **`workspace-deployment-apply`** runs on the server at its start, from the projection it wrote; in a hosted provider deployment, the browser's boot apply writes only its copy and is overwritten by the first settle.

### 6.2 The transport

`POST <base>api/kernel/call`, in this order:

1. **The same-origin JSON rule**, phase 3's 9.5 and 10.2 item 4: `POST` only; `Content-Type` whose media type is `application/json`; `Origin` present and exactly `origin`; `Sec-Fetch-Site` absent or `same-origin`. Any failure is `403` with `{ "code": "REQUEST_NOT_SAME_ORIGIN" }`, nothing read further. No CORS header is ever sent.
2. **The body,** at most `request_body_bytes` (otherwise `413` `REQUEST_TOO_LARGE`), `{ command: string; input: unknown; scope: { workspace: string; project?: string } }` and nothing else; otherwise `400` `REQUEST_INVALID`.
3. **The session,** from the provider with the cookie cache off, then the principal: always the human, never an actor the browser sends; a user id starting `agt_` is `401` `AGENT_CANNOT_SIGN_IN`; no session is `401` with afd-auth's `UNAUTHORIZED` as the body's code.
4. **The command** must be in `SERVER_COMMANDS`; otherwise `404` `SERVER_COMMAND_NOT_SERVED`. `scope.workspace` must be the deployment's; otherwise `400` `REQUEST_INVALID`.
5. `serverKernel.call(command, input, { scope, principal })` through phase 3's principal chain, journaled in `journal.jsonl` with the human actor.
6. **The answer:** `200` with `{ result: CommandResult; generation: string }`, `generation` that person's snapshot digest after the call. A refusal is still `200`, with the refusal in `result`, so the browser journals the server's code.

### 6.3 The browser's copy

- **Stage B** in a hosted provider deployment calls `trust-record-snapshot` once and runs the internal **`trust-record-settle`** top-level, before any call that is not boot's own work and after phase 3's first `session-settle`.
- **It runs again** after every routed call whose answer's `generation` differs from the copy's; after every `session-settle` that changes the person (`reason: 'session'`), so one person's copy never serves another; and on phase 3's 4.3 refresh (focus, `online`, every 60 seconds while visible), fetching the snapshot and settling when `generation` differs. Each runs top-level, before the next queued call.
- **`trust-record-settle { reason: 'boot' | 'call' | 'refresh' | 'session'; snapshot: TrustRecordSnapshotV1 }`** is internal, like `session-settle`: journaled with its input **as data**, not served, not callable through a port, refused on the agent interface, exempt from line 0. It replaces the `project` and `workspace-app` tables' rows with the snapshot's, and the `agent-member` table's rows with **only the snapshot's `kind: 'installed'` rows, stored as the filtered `AgentMemberRowV1`**; connected agents are held in memory for display, since phase 3 keeps them in the provider's database (its 9.2). A project the person may no longer see leaves the copy, and `applyScopeChange(…, 'actor')` runs if the active project is gone. Its input is at most 2 MiB; a larger snapshot is `TRUST_RECORDS_TOO_LARGE`, journaled, and the copy is left as it was, with a notice through the existing status item and live region.
- **What the copy is for.** `ProjectCache`, `canOpen`, `opensIn`, the rail and the projects section read it, so the shell paints and works offline as before. **It grants nothing**: every write is the server's, and the relay decides against the server's records. A copy can be stale by up to 60 seconds for a change someone else made; the server is never stale.

### 6.4 Replay

A routed call's whole effect is on the server, so in a hosted provider deployment **`SERVER_COMMANDS` join the kernel's recorded table**, as phase 3 records the provider-only commands: a replay answers each from its entry and never reaches a server, and one with no entry stops as `REPLAY_NOT_RECORDED`. `trust-record-settle` re-runs from its input, so the copy replays exactly. **A replay reads whether the deployment was hosted from the journal**, from `workspace-deployment-apply`'s recorded input (3.3), never from the projection it is replayed against. That amends phase 3's 3.4 for this one deployment kind (A5). In every other deployment phase 3's rule stands: these commands write the browser's store and re-run.

## 7. The hosted MCP surface (D104)

Phase 0 set every shell command's `expose.mcp` and `expose.cli` to `false` "until phase 6". **On the hosted server, MCP serves exactly the commands whose records the server holds or reads from the provider**, so an agent over MCP never writes a store its person cannot see. This follows from D46 (documents and app data live in browsers until the collaboration service) and D98 (an agent has at most its person's access):

```ts
/** Served over MCP by the hosted server (7); in `@lushly-dev/loam-host`, never in a browser's graph. */
export const HOSTED_MCP_COMMANDS = ['shell-info-get', 'workspace-get', 'workspace-app-list', 'app-list',
	'app-get', 'project-list', 'project-get', 'project-create', 'project-update', 'project-archive',
	'project-restore', 'account-get', 'persona-list', 'member-list', 'agent-member-list',
	'agent-member-get'] as const;
```

- **Applied on the server only.** `loam-host`'s `hostedCommands(commands)` keeps the commands of `mcpOptions()` that are in the list, as copies with `expose.mcp: true`, and passes those to `createMcpHandler`. **`SHELL_EXPOSE` does not change**, so the browser's kernel and first paint are untouched.
- **Phase 3's rules stand inside it.** `HUMAN_COMMANDS` and `OWNER_COMMANDS` are not served; an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` with `access`, is `HUMAN_REQUIRED` from the handler; `account-get` reads for the token's person (phase 3's 9.2). **`persona-list` answers only `default` on the server** (A6), since personas are held in each browser, and its description says so.
- **Not served, and why:** page state (`view-state-*`, `layout-*`, `appearance-*`, `palette-*`, `overlay-*`, `toast-show`, `modal-open`, `status-item-set`, `app-selection-*`, `editor-*`, `section-get`, `scope-get`), because a server has no page; `PERSON_SESSION` and `auth-*`, as phase 2 decided; **documents, `new-list`, `document-type-list`, `project-summary-get` and app commands**, because their records and handlers are in each browser until the collaboration service (D46) and phase 5's calls; `app-command-list`, `app-instance-list` and `app-instance-refresh`, with mounted instances over MCP, which phase 5's "shell commands over MCP" takes up. In plain words: **connected agents can manage projects and see members and apps; documents wait for the collaboration service.**
- **A unit holds the list:** every name is registered on the server kernel; none is in `HUMAN_COMMANDS`, `OWNER_COMMANDS`, `PERSON_SESSION` or `INTERNAL_COMMANDS`; `tools/list` over MCP equals it plus AFD's meta-tools, for every token.
- **The CLI.** The AFD CLI can reach `<base>mcp` with `--header "Authorization: Bearer …"`, but it has no OAuth client to obtain a token, so `expose.cli` stays `false` and the CLI is a [follow-up](#follow-ups) for AFD.

## 8. The mount relay (D105)

### 8.1 The route: parse, decide, rebuild

`<base>mounts/<instance>/mcp` serves phase 1's contract (`MountTransportV2`, unchanged in the browser but for this section's codes) with phase 3's 10.2 item 5's enforcement and the amendments A1 and A3. **It works in three stages: it parses the page's message strictly, decides the effective command, input and scope against the server's records, and forwards only a message it builds itself from those decisions; the answer comes back the same way, by allow-list.** Nothing the page or the instance sent passes unless a rule below names it.

#### The gate

1. **Method and path.** `GET` is `405` with `Allow: POST, DELETE`, which the page never sends (`mount.ts:27`). `POST` and `DELETE` continue. The path must be exactly `<base>mounts/<instance>/mcp`; any further path segment, query or fragment is `404` `INSTANCE_UNKNOWN`.
2. **The same-origin rule:** 6.2's first row's `Origin` and `Sec-Fetch-Site` checks (`403` `REQUEST_NOT_SAME_ORIGIN`); for `POST`, the `application/json` media type. A `DELETE` carries no body and needs `Mcp-Session-Id` (A1).
3. **The session and the principal**, as 6.2's third row (`401` `UNAUTHORIZED` or `AGENT_CANNOT_SIGN_IN`).
4. **The instance** must be in the server's deployment, `mounted`, `http`, and enabled in the server's `workspace-app` record; otherwise `404` `INSTANCE_UNKNOWN`, the same bytes for a disabled one.

#### Parse

5. **One message.** The body (`POST`) is at most `request_body_bytes` (`413` `REQUEST_TOO_LARGE`), nested no deeper than `DISCOVERY_LIMITS.depth` (`400` `REQUEST_INVALID`), and one JSON object with `jsonrpc: "2.0"`. **A batch array is `400` `MOUNT_BATCH_REFUSED`** (A3): MCP 2025-06-18 removed batching. Anything else that is not such an object is `400` `REQUEST_INVALID`.
6. **Six methods are accepted, five are forwarded.** Only `initialize`, `server/discover`, `notifications/initialized`, `notifications/cancelled`, `ping` and `tools/call` are accepted; `notifications/cancelled` is the relay's own and is never forwarded (step 17). `server/discover` is the first request the page's SDK sends, since `mount.ts` connects in `mode: 'auto'` (`:47`); without it the mount fails era negotiation or falls back to the legacy era. A JSON-RPC response from the page, `tools/list` (which the page never sends, `mounted.ts:420`), or any other method (`resources/read`, `prompts/get`, `logging/setLevel`, a `tasks/*` method) is `400` `MOUNT_METHOD_REFUSED`. **Ids:** `initialize`, `server/discover`, `ping` and `tools/call` must carry an `id` that is a string or a safe integer, and `notifications/*` must carry none; anything else is `400` `REQUEST_INVALID`.
7. **The fields the relay reads**, each checked for its type and nothing else read:
   - `tools/call`: `params.name`, which must be a string, else `400` `REQUEST_INVALID`; `params.arguments`, an object or absent; `params._meta`, an object or absent.
   - `initialize`: `params.protocolVersion` (a string) and `params.clientInfo` (`{ name, version }` strings).
   - `server/discover` and any modern-era request: in `params._meta`, `io.modelcontextprotocol/protocolVersion` (a string) and `io.modelcontextprotocol/clientInfo` (`{ name, version }` strings).
   - Every request: `params._meta.progressToken` (a string or a safe integer), when present.
   - `notifications/cancelled`: `params.requestId`, a string or a safe integer, and an optional string `params.reason`.
8. **The scope the message carries.** From `params._meta["dev.loam/scope"]`, and **for `afd-call` and `afd-detail` only**, from `arguments.meta["dev.loam/scope"]`: AFD lifts `meta` only for the exact `AFD_META_TOOL_NAMES` (`meta-argument.ts:65`), so a first-class tool's `arguments.meta` is never read as scope, by AFD or by the relay. A `null` or missing value is absent, as AFD reads it. **Each present value is parsed with the kernel's strict `SCOPE_V1`** (`scope/field.ts:16`), and its `workspace` must be the deployment's; anything else is `400` `REQUEST_INVALID`. Present in both places, the two parsed values must be equal, or `400` `REQUEST_INVALID`. The result is **the message's scope**, or none.

#### Decide

9. **The effective command, for `tools/call`.**
   - **`afd-help` and `afd-detail`**, matched by exact name only, are discovery.
   - **`afd-call`:** the effective command is `arguments.command`, which must be a string (`400` `REQUEST_INVALID`), and the input is `arguments.input`, an object or absent (`{}`); any other `arguments.input` is `400` `REQUEST_INVALID`. A command that the kernel's `isMetaTool` (`mounted.ts:416`, exported from `/mounted`) or `afd-core`'s `isAfdBuiltinName` matches is `403` `MOUNT_COMMAND_NOT_EXPOSED`. Otherwise it must be the `tool` of a command in the instance's catalog (8.2).
   - **Any other name:** it must equal the `tool` of a catalog command **with `firstClass: true`, in a catalog whose `toolStrategy` is `'hybrid'`**, or `403` `MOUNT_COMMAND_NOT_EXPOSED`; the input is `arguments`. The kernel sends a bare name only for a first-class command (`mounted.ts:680-682`), and `afd-help` reports first-class tools only under the `hybrid` strategy. **This is what stops AFD's `grouped` strategy**, `createMcpServer`'s default (`server.ts:65`, `:280`): a group tool such as `notes` routes `arguments.action` to another command before its name is looked up (`tool-router.ts:417-472`, groups from `command-routing.ts:20-23`), so `tools/call notes { action: "delete" }` would run a hidden `notes-delete`. A group tool is never first-class, so it is refused. The Rust crate groups the same way and is refused the same way.
   - **Exposure:** the matched catalog command's computed `expose` must give `palette` or `agent`, or `403` `MOUNT_COMMAND_NOT_EXPOSED`. A command `afd-detail` reports `callable: false` is never in the catalog (`mounted.ts:501`). The relay never recomputes flags from annotations.
10. **Discovery and the session's own messages are decided at workspace level:** `initialize`, `server/discover`, `notifications/*`, `ping`, the session `DELETE`, `afd-help` and `afd-detail`. Each must carry no scope (step 8's result, which includes `afd-detail`'s `arguments.meta`), or `400` `REQUEST_INVALID`. The decision is membership; then, if the entry lists `projects`, at least one listed project must pass `decideAccess` for the person, otherwise `403` `MOUNT_PROJECT_NOT_LISTED`. **Each is forwarded with no scope.**
11. **A command, at the message's scope or with none.** Every `tools/call` of a command (step 9) passes 11.0 to 11.4, as the kernel's own mounted call does (`mounted.ts:640-652`):
    0. **No scope.** A command with no scope is decided at workspace level: 11.1 is membership; 11.2 gives no slug; 11.3 calls `unlistedProject(entry, undefined, …)`, which refuses `MOUNT_PROJECT_NOT_LISTED` whenever the entry lists `projects` (`mounted.ts:300`); 11.4 calls `pinMountedInput(entry, null, …)`. **No step is skipped for want of a scope.**
    1. **Access:** `decideAccess` version 2 for the principal's person, with the server's `ProjectV1` and membership read for this request: `403` `WORKSPACE_NOT_MEMBER` or `PROJECT_NOT_FOUND`.
    2. **The project's slug:** with a scope, the slug of the server's `ProjectV1` whose `id` is `scope.project`. The scope carries ids (D71); the instance's projects and its pinned spaces are keyed by slug.
    3. **The instance's projects:** phase 2's 9.2 through the kernel's own `unlistedProject`, which applies to every `tools/call` of a command, with the slug or with none: `403` `MOUNT_PROJECT_NOT_LISTED`.
    4. **The pinned space:** `pinMountedInput(entry, { project: slug }, command.inputSchema, input)`, with the catalog command's schema: `403` `MOUNT_SPACE_PINNED`. Passing the id instead of the slug would skip the pin silently (`mounted.ts:263`). **It fails closed, by allow-list.** `pinMountedInput` passes an input through unchanged when `properties.space` is missing at the top level (`mounted.ts:268`), which covers `allOf`, `anyOf`, `oneOf` and `$ref`, and a root whose `type` is not `object` (`:406-408`). So, **in a pinned project, after `pinMountedInput`:** any key equal to `space` or `spaces` ignoring case, at any depth, other than the top-level `space` the pin set, is `403` `MOUNT_SPACE_PINNED`; so is a schema whose root holds any keyword outside `type`, `properties`, `required`, `additionalProperties`, `title`, `description`, `$schema`, `$defs`, `definitions`, `examples` and `default` (`definitions` beside `$defs`, since AFD's `zodToJsonSchema` targets draft-7, `json-schema.ts:36`), whatever the input carries; so is a schema that declares a property named `space` or `spaces`, ignoring case, anywhere but its top-level `properties.space` and `properties.spaces` beside it, under `properties`, `patternProperties`, `$defs` or `definitions` at any depth, whatever the input carries. **A command whose input is a discriminated union (a root `oneOf`, `anyOf`, `if`/`then` or the like) therefore cannot be called in a pinned project**; the deployer pins only instances whose commands take plain object inputs, and the console shows the refusal. The result is **the decided input**.

#### Rebuild

12. **The message the relay sends** is its own serialization of `{ jsonrpc: "2.0", id, method, params }`, with `id` the page's, **sent to the entry's `url` exactly**, never to a path, query or fragment from the page (AFD's handler also serves `/rpc`, `/batch` and `/message`, `http-handler.ts:286-302`, `:439-447`), and `params` built only from the decisions:

    | Method | `params` |
    | --- | --- |
    | `tools/call` of a first-class tool whose catalog schema does not declare `confirm` | `{ name, arguments, _meta }`: `arguments` the page's, with the pin applied and **any top-level `confirm` dropped**, since AFD reads a top-level `confirm: true` as the acknowledgement of a command's `confirmPrompt` (`tool-router.ts:507-508`). Any `arguments.meta` passes untouched, since AFD never lifts it there |
    | `tools/call` of a first-class tool whose catalog schema declares `confirm` | **Forwarded as `afd-call`:** `{ name: "afd-call", arguments: { command: tool, input: arguments }, _meta }`, the pin applied to `input`. A declared `confirm` is the command's own input, but AFD would still read `input.confirm === true` as the acknowledgement whenever the command has a `confirmPrompt`; `afd-call` reads the acknowledgement only from its own top-level `confirm` (`:238`, `:276`), which the relay never sets, so the command receives `confirm` as data and nothing is acknowledged |
    | `tools/call` of `afd-call` | `{ name: "afd-call", arguments: { command, input }, _meta }`: `input` the decided input; `meta` and `confirm` are dropped. `confirm` is dropped because it would acknowledge the command's confirmation for the person, which only the kernel's own flow may do, and the kernel never sends it (`mounted.ts:683`) |
    | `tools/call` of `afd-help` | `{ name, arguments: { filter?, format? }, _meta }`, rebuilt from its schema: `filter` a string, `format` `brief` or `full` |
    | `tools/call` of `afd-detail` | `{ name, arguments: { command }, _meta }`, rebuilt from its schema: `command` a string, or an array of at most 10 strings |
    | `initialize` | `{ protocolVersion, clientInfo, capabilities: {} }` |
    | `server/discover` | `{ _meta }` only |
    | `ping` | None, or `{ _meta }` when a modern envelope is built (as for `notifications/cancelled` when the relay sends one itself, step 17) |
    | `notifications/initialized` | None |

    Any other `params` or `arguments` field the page sent, `params.task` among them, is dropped.
13. **`_meta`, rebuilt:**
    - `dev.loam/scope` is the scope the relay decided (step 11), or absent when none was decided (steps 10 and 11.0).
    - `progressToken` is kept when step 7 read it. Nothing else of AFD's: the kernel never sends `dev.afd/outputBudget`, so it is dropped.
    - On a modern-era request, `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientInfo` are kept as step 7 read them, and `io.modelcontextprotocol/clientCapabilities` is `{}`, since the page declares none (phase 1) and the relay answers no server request (step 15).
    - Every other key is dropped: every other `io.modelcontextprotocol/*` key, the trace-context keys (`traceparent`, `tracestate`), and anything else.
14. **The request headers the relay sets; no header from the page is forwarded.** (The HTTP client adds its own, such as `Content-Length`, `Host` and `Accept-Encoding`; those are the client's, never the page's.)
    - `Content-Type: application/json`, `Accept: application/json, text/event-stream`, and **`Accept-Encoding: identity`**, so `relay_response_bytes` and a `Content-Length` count the same bytes.
    - `Mcp-Method` from the rebuilt `method`, and `Mcp-Name` from its `params.name` on a `tools/call`.
    - `MCP-Protocol-Version`: for a modern-era request, the rebuilt `io.modelcontextprotocol/protocolVersion`; for a legacy-era session, the version the instance answered `initialize` with, recorded with the session's binding (step 16); for a stateless legacy-era instance, which issues no session, the page's `MCP-Protocol-Version` header when it is one of the client SDK's `SUPPORTED_PROTOCOL_VERSIONS` (`@modelcontextprotocol/client`), and none otherwise.
    - `Mcp-Session-Id` from the binding, for a legacy-era session. **An `initialize` is forwarded with no `Mcp-Session-Id`**, and any session id the page sends with it is ignored.
    - `Authorization: Bearer` with the deployer's bearer, from its secret ([section 13](#13-secrets-d108)).
    - No `Origin`, no `Cookie`.
15. **The answer, by allow-list.** At most `relay_concurrency_per_person` requests are in flight per person (`429` `MOUNT_LIMIT`, `Retry-After: 1`). An aborted page request aborts its upstream request and frees its slot.
    - **By status.** A `3xx` is `502` `MOUNT_RESULT_INVALID`. A `2xx` with an empty body (an instance's `202` to a notification, its `200` or `204` to a session `DELETE`) passes back with that status, no body and no `Content-Type`. A `200` with a body must have the media type `application/json` or `text/event-stream`, and the two rules below apply to it. **Any other status** passes back with that status; its body passes only when it is exactly one JSON-RPC error response, re-serialized as `{ jsonrpc, id, error: { code, message, data? } }`, its `id` the request's or `null`, and any other body is replaced by none. **On any body it re-serializes, the relay sets `Content-Type: application/json`** (or `text/event-stream` for a stream). The page never reads such a body for a code (the refusal table's sixth row), but the SDK's era probe reads a `4xx`'s JSON-RPC error to fall back or correct its version. A JSON body is read whole, up to `relay_response_bytes`, before the status is sent; past that limit it is `502`. No response headers within `relay_timeout_ms` is `504` `MOUNT_TIMEOUT`.
    - **Parsing.** The media type is parsed with its parameters ignored, but a `charset` other than `utf-8`, compared ignoring case and quotes, is `502` `MOUNT_RESULT_INVALID`, and the bare type is what passes back. Bodies are decoded with `TextDecoder`, which drops a byte-order mark. An event stream is parsed as WHATWG's server-sent events define it: several `data:` lines are joined with `\n`; `id:`, `retry:` and comments are dropped; and an event whose `event` field is set and is not `message` is dropped.
    - **Only the status, that bare `Content-Type`, and `Mcp-Session-Id` as step 16 allows, are passed back**, with a body the relay re-serializes. No other header of the instance's reaches the page, `Set-Cookie`, `Retry-After` and `Loam-Relay-Refusal` among them.
    - **A JSON body** of a `200` must be exactly one JSON-RPC response **whose `id` equals the forwarded request's `id`**, which the relay re-serializes; any other JSON body is `502` `MOUNT_RESULT_INVALID`.
    - **An event stream:** each event's `data` must parse as one JSON-RPC notification or response, which the relay re-serializes as the event's only field. A response's `id` must equal the forwarded request's `id`, or the stream is cut. **A stream carries at most one response, and the relay ends the stream after it**; notifications that arrive before it pass through. Any other event is dropped: a server-to-client request (one with a `method` and an `id`), an event holding a JSON-RPC array, and anything that does not parse.
    - **After the status is sent,** past `relay_response_bytes` or `relay_timeout_ms`, the relay **aborts the stream**, which `mount.ts` reports as `MOUNT_RESULT_INVALID` (over the size) or `MOUNT_UNREACHABLE` (a cut stream), as phase 1's own bound does.
16. **The upstream session.** For a legacy-era server, the relay binds and passes back `Mcp-Session-Id` **only on the answer to a legacy `initialize`**; on any other answer it is dropped. The binding is `(person, instance)`, with the protocol version the `initialize` answer named.
    - An id the instance issues that is already bound to another person is `502` `MOUNT_RESULT_INVALID`.
    - **At most 4 bindings per `(person, instance)`,** each expired after `relay_session_idle_ms` without a request (default 900,000, 15 minutes, in `loam.server.toml`'s `[limits]`), **and `DELETE`d upstream when it expires, as when it is evicted**: the page never sends a session `DELETE` itself, since the SDK 2.4.0 client's `close()` does not call `terminateSession()` (client `dist/index.mjs:1677-1685`, `:1823`). A fifth `initialize` evicts **the least recently used binding with no request in flight**, which the relay `DELETE`s upstream; if all 4 have a request in flight, the fifth is `429` `MOUNT_LIMIT`.
    - An upstream `404` on a bound id drops the binding.
    - A request carrying an id bound to another person, or one the relay does not know, is `404` `MOUNT_SESSION_UNKNOWN`, with nothing forwarded. A `DELETE` is forwarded only for the person's own bound id, and then the binding is dropped; **a `DELETE` for an unknown, evicted or foreign id is answered `204` with nothing forwarded**, the same bytes in all three cases.
    - **Bindings live in memory.** After a restart none exists, and pages recover through `MOUNT_SESSION_UNKNOWN`.
    - The modern era has no session.
    - **After `MOUNT_SESSION_UNKNOWN`,** the call fails, retryable. `mount.ts` closes its transport, and **its `request` calls `transport.connect()` before sending when it closed for `MOUNT_SESSION_UNKNOWN`**, so the next call reconnects, as phase 1's rediscovery (`AUTO_DISCOVERY_MS`) also would; the SDK does not start a new session on its own. P6-H6 asserts it against a stateful legacy fixture.
17. **Cancellation is the relay's own.** `notifications/cancelled` is never forwarded. When its `requestId` names a request this person has in flight through this relay, to this instance and through the same binding, the relay aborts its own upstream request. With no binding (the modern era, or a stateless legacy instance), it aborts nothing; the page's abort of its own request (step 15) ends the upstream request. Either way the page gets `202`, and a `notifications/cancelled` holds no slot of `relay_concurrency_per_person`.

#### The relay's refusals, and the kernel

**Every refusal of the relay's own** has the body `{ code, message, suggestion }` **and the response header `Loam-Relay-Refusal: 1`**, which step 15's allow-list never passes from an instance, so an instance can never set it; **nothing reaches the instance**. These rules are the HTTP layer's only: a tool result's own content is phase 1's, as the table's last row says.

| Answer | `mount.ts` and the kernel | What the failed call returns |
| --- | --- | --- |
| `Loam-Relay-Refusal: 1` with a code in `CODES` (400, 403, 404, 413, 429, 502, 504) | A `MountRefusal` carrying **that code only**, with the kernel's own message and suggestion | That code: `PROJECT_NOT_FOUND`, `WORKSPACE_NOT_MEMBER`, `MOUNT_PROJECT_NOT_LISTED`, `MOUNT_SPACE_PINNED`, `MOUNT_COMMAND_NOT_EXPOSED` and the rest, as themselves. `REQUEST_NOT_SAME_ORIGIN` is not retryable: it means a shell bug or a forged request |
| `Loam-Relay-Refusal: 1`, `401`, code `UNAUTHORIZED` | The kernel's `refreshSession()` (below) | afd-auth's `UNAUTHORIZED`, with "Sign in again" |
| `Loam-Relay-Refusal: 1`, `401`, code `AGENT_CANNOT_SIGN_IN` | `refreshSession()`, which signs the session out | `AGENT_CANNOT_SIGN_IN` |
| `Loam-Relay-Refusal: 1`, `404` `MOUNT_SESSION_UNKNOWN` | Closes the transport; the next `request` reconnects first (step 16) | `MOUNT_SESSION_UNKNOWN`, retryable |
| `Loam-Relay-Refusal: 1` with a code not in `CODES`, or a body that is not such JSON | Nothing read further | `MOUNT_UNREACHABLE` |
| **No `Loam-Relay-Refusal` header**, whatever the body says (an instance's own `401 {"code":"UNAUTHORIZED"}` or `403 {"code":"PROJECT_NOT_FOUND"}`), or a network failure | The body is not read, and no refresh runs | As phase 1: `MOUNT_UNAUTHORIZED` for 401 and 403, `MOUNT_UNREACHABLE` otherwise |
| **A tool result** (an HTTP `200` carrying a `tools/call` result) whose `CommandResult` holds an error code, `UNAUTHORIZED` among them | `parseMountedResult` (`mounted.ts:174-202`), as phase 1 | **The instance's code, labelled `untrusted` with `dev.loam/instance`**; nothing refreshes or closes on a result's code |

**`mount.ts`'s mechanics,** in implementation step 6 ([section 20](#20-implementation-plan)):

- **`boundedFetch`** reads the header. On a response that carries `Loam-Relay-Refusal: 1`, it reads at most 4 KiB of the body, takes a `code` only if it is in `CODES` (`MOUNT_UNREACHABLE` otherwise), and throws a `MountRefusal` with it. A body's `message` and `suggestion` are never read, as `mounted.ts:61` says of every failure: "never a server's or a transport's".
- **`Failure`** (`mount.ts:54`) widens to the relay's codes.
- **`refusalOf`** returns a `MountRefusal` found on the error, or anywhere on its `cause` chain, unchanged, before `statusOf` (`:65-83`) can remap it to a status.
- **`request`** calls `transport.connect()` before sending when the transport closed for `MOUNT_SESSION_UNKNOWN` (step 16).
- **`refreshSession()`** is the one refresh both the relay's 401 and `server-call.ts`'s 401 call. `late-identity` (phase 3) exposes it on the kernel, and it runs phase 3's 4.3 refresh at once: `adapter.refresh()`, then `session-settle` if the person changed or the session is gone.

**The kernel's codes.** `failureOf` accepts only the closed `MountFailureCode` set (`mounted.ts:52-58`, `:120-126`). So implementation step 6 widens `MountFailureCode`, `CODES` and `MOUNT_FAILURES` with the relay's codes, each with the kernel's own message, suggestion and `retryable`: `REQUEST_NOT_SAME_ORIGIN`, `REQUEST_INVALID`, `REQUEST_TOO_LARGE`, `INSTANCE_UNKNOWN`, `MOUNT_BATCH_REFUSED`, `MOUNT_METHOD_REFUSED`, `MOUNT_COMMAND_NOT_EXPOSED`, `MOUNT_PROJECT_NOT_LISTED`, `MOUNT_SPACE_PINNED`, `MOUNT_SESSION_UNKNOWN`, `MOUNT_LIMIT`, `WORKSPACE_NOT_MEMBER`, `PROJECT_NOT_FOUND`, `UNAUTHORIZED` and `AGENT_CANNOT_SIGN_IN`. **`MountFailureCode` is an `Extract` of `LoamKernelErrorCode` (`errors.ts:13`), so every one of them also joins `LoamKernelErrorCode`**, where phases 2 and 3 have not already added it.

### 8.2 The tools the relay knows

The relay discovers each enabled instance **exactly as the browser's kernel does**: it calls the kernel's own `discoverInstance` (exported for it from `@lushly-dev/loam-kernel/mounted`) with a server-side `MountTransportV2` over AFD's `StreamableHttpTransport` carrying the deployer's bearer: `afd-help`, then `afd-detail` in batches, under `DISCOVERY_LIMITS`, with the manifest's `effects`, the entry's `commands` overrides and `mount.only`. Since `discoverInstance` takes a transport and does no I/O of its own, the relay needs no copy of its parts. **It keeps the `InstanceCatalogV1` it returns**, whose commands carry their `tool`, their computed `expose` and their `inputSchema`, and decides 8.1 steps 9 and 11's exposure and pinning from it, with `firstClass` set only when the catalog's `toolStrategy` is `'hybrid'`, a rule `discoverInstance` itself now applies (section 2), so the relay and the kernel agree. It runs at start and every 10 minutes. A `tools/call` whose effective command is not in the catalog triggers one rediscovery; still absent, it is `403` `MOUNT_COMMAND_NOT_EXPOSED`. Rediscovery of one instance is never more frequent than once per 30 seconds.

**Why a subpath.** `mounted.ts` is already in the browser's graph, in the `apps` chunk. `@lushly-dev/loam-kernel/mounted` exists so the relay, in Node, imports `discoverInstance`, `isMetaTool`, `unlistedProject`, `pinMountedInput`, `SCOPE_V1`, `DISCOVERY_LIMITS` and the catalog's types without the kernel root's other modules, which assume a page.

### 8.3 Discovery is not the person's

Phase 1's kernel discovers through the relay from the browser, as before. **`app check` warns** when an entry pins a `space` but lists no `projects`, since without `projects` the instance also serves calls at workspace level, where no pin applies (11.0 calls `pinMountedInput` with no project). 8.1 lets `afd-help` and `afd-detail` through at workspace level; the relay's own discovery only feeds 8.1's decision and is never answered to a browser. D55 holds: an instance still sees one principal, the deployer's bearer, so a team instance must be one every member of its projects may read in full, and the relay is what keeps a non-member's request from reaching it.

### 8.4 What the relay records

Each forwarded `tools/call` is appended to the server's journal as a record of command `mount-relay` (not a registered command, and never replayed): `{ instance, command, actor, scope, status, ms }`, `command` the effective command, with no arguments, no result and no header. Refusals of 8.1 are recorded the same way with their code, from step 4 on; **refusals made before step 3, which have no actor, are counted** by code in the server's metrics, **not journaled**. **No token, cookie or session id is ever logged**; `scanSecrets` checks the logs and journal for them.

## 9. The production profile (milestone M2)

`loam-host start` with a full `loam.server.toml` (3.2):

- **TLS** on the server from `cert_file` and `key_file`, re-read on `SIGHUP` so a renewed certificate needs no restart; or **behind a TLS-terminating proxy** on a loopback `listen`, the origin still configured, never derived (3.2). The distribution guide shows both, and that the proxy must pass `Host` unchanged and must not add CORS.
- **Mail** by SMTP through `nodemailer`, with `smtps://` or STARTTLS required (`requireTLS: true`); a plain `smtp://` URL with no TLS is refused at start (`HOST_MAIL_INSECURE`), except to a loopback host.
- **Single sign-on** from `[oidc.<id>]`, passed to `createLoamAuthOptions`' `oidc`, phase 3's 2.6 rules unchanged.
- **Limits** from `[limits]`; Better Auth's own rate limit on its routes, keyed by **`x-loam-client-ip`, which the host alone sets from the socket** (3.7, A7). Behind a proxy that address is the proxy's, so the per-address limit becomes a per-deployment one; the guide says so, and a deployer wanting per-client limits sets them at the proxy.
- **Logs** are one JSON line per request on stdout: time, method, route **pattern** (never the path, which can carry a restricted slug), status, ms, and for an authenticated request the actor's kind only. Nothing else.
- **`doctor`** (3.8) complete.
- **The mounted suite through the hosted relay** against a stock `umbel` (P6-M1), so phase 1's relay proof no longer stands alone.

**M2 is reached** when P6-H9, P6-H10 and P6-M1 pass.

## 10. The desktop lane (D106)

### 10.1 What the desktop is

**The same `web` build in Tauri 2's webview, as a personal shell in `local` identity mode** (phase 3's 2.1), with the kernel in the webview (D25), the store in IndexedDB (D52), and mounted instances through the Rust host. A `provider` deployment on the desktop is refused (`DEPLOYMENT_DESKTOP_PROVIDER`): passkeys bind to the deployment's host, which a webview's custom-scheme origin is not, and a team member uses the hosted shell in a browser. Joining a hosted workspace from the desktop is [reserved](#18-out-of-scope-and-the-seams-reserved).

### 10.2 Origins and the CSP

- **The shell** is served by the Rust host's **`loam` custom protocol** (`register_uri_scheme_protocol`; `loam://localhost` on macOS and Linux, `http://loam.localhost` on Windows) from `<app data>/site` when it exists and the bundled empty shell otherwise. It applies D74's fallback (`index.html` for a path with no file and `Accept: text/html`), sends the `<meta>` policy plus `frame-ancestors 'none'` as a header, and resolves every path with `canonicalize` inside the site's directory, so no path, encoded or through a symlink, reaches `mounts.json` or anything else outside it. The kernel's `host` is `'desktop'`.
- **The sandbox proxy** is a second custom protocol, `loam-sandbox`, serving only the site's `sandbox/` with `frame-ancestors` naming the shell's origin. Its origin differs from the shell's, as D62 requires; P6-D3 proves it in each webview.
- **The CSP** is the shell's phase 0 policy, written into the `<meta>` by `deployment write --host desktop` with **`connect-src 'self' ipc: http://ipc.localhost`**, the IPC sources Tauri's own example uses (S92), and `frame-src` the sandbox scheme's origin when a view app is deployed. No other source widens.
- **Capabilities (S11).** `core:default` would grant every core plugin's defaults, so **no `core:*` permission is granted**: the menus are built in Rust, not from JavaScript. One capability file, `"local": true`, scoped to the main webview by label, grants only Loam's own three commands (10.4). No `shell`, `fs`, `http`, `opener` or updater JavaScript permission exists, so the webview can neither spawn a program, read a file nor drive an update. Custom schemes count as local origins to Tauri, and a webview label cannot tell one frame from another, so neither is what keeps the sandbox and its frames from `invoke`. **What does:** the sandbox's and a view's policies hold no `ipc:` or `http://ipc.localhost` in `connect-src` (phase 1's frame CSP, unchanged), and Tauri injects its IPC script and invoke key into the main frame only, so a frame has neither the channel nor the key. P6-D4 tests `invoke` from both frames. **If it fails,** each of the three Rust commands refuses an invoke whose origin is not the shell's, and that is specified by amendment, not improvised in the step.

### 10.3 The deployment on the desktop

The person who owns the desktop is its deployer (D56). They write `loam.deployment.toml` with `[host] kind = "desktop"` and run `loam deployment write --host desktop --dist <app's bundled dist> --out <app data>/site --mounts-out <app data>/mounts.json`. **The Rust host reads only `mounts.json`**, never the TOML; on POSIX it must be mode 0600, and on Windows its ACL must grant only the profile's owner, or the host refuses it (`DESKTOP_MOUNTS_PERMISSIONS`). Nothing in the webview can write either file, and no command reaches them, so D56's "no command, app or agent may write it" holds by construction.

### 10.4 Mounts over the Rust host

`MountAccess` gains, for `--host desktop` only, `{ instance, transport: 'stdio', command: string[], cwd?: string }` beside phase 1's `{ instance, url, bearer? }`. The desktop's `ports.mountTransport` is `DesktopMountTransport`, behind the same `MountTransportV2`, over three Tauri commands. **The Rust side is a transport only**, with no MCP logic of its own:

| Command | Input | Does |
| --- | --- | --- |
| `mount_open` | `{ instance }` | For `http`: a `reqwest` 0.13 client (features `rustls`, `stream`, `http2`) that `POST`s each message with the bearer and the `Mcp-Session-Id` the server issued, reading a JSON or an event-stream answer. For `stdio`: spawns `command` in `cwd` with a clean environment but `PATH`, `HOME` and the platform's minimum, stdin and stdout piped and **framed as one JSON-RPC message per line**, stderr to the app's log. Returns a handle |
| `mount_send` | `{ handle, message }` | One JSON-RPC message, at most 1 MiB; a reply bounded at 4 MiB, as the web host's |
| `mount_close` | `{ handle }` | For `http`, the session's `DELETE`; for `stdio`, `SIGTERM`, then after 5 s `SIGKILL` |

- **What comes back.** A response returns from `mount_send`. A server notification (a `method` with no `id`) arrives as the Tauri event `loam://mount/<handle>`, to the main webview only; a server-to-client request is dropped, as the relay drops it (8.1).
- **The webview names an instance, never a URL, token or command line.** `mount_open` for an instance not in `mounts.json` is `INSTANCE_UNKNOWN`.
- **A child that exits** fails its calls with `MOUNT_UNREACHABLE`, retryable; the kernel's phase 1 recovery reopens it on the next discovery.
- **Scope** travels in `_meta` exactly as phase 2's 9.2 sends it; the Rust host forwards the message untouched. The desktop is `local` and single-person, so no relay checks are needed between the person and their own instances.

### 10.5 The store and D52's measurement

IndexedDB in the webview, as in the browser. **D52's measurement**, taken in step 11 in WebKitGTK and WebView2 on the A4 reference workspace (2,000 documents, 20,000 links): S1, listing every document record of one project, p95 at most 50 ms over 200 runs; S2, 1,000 sequential record writes in at most 2,000 ms. Both pass: no SQLite plugin, and STATUS.md records the numbers. Either fails: a SQLite store through a Tauri plugin is specified by amendment, with the store contract, before it is built.

### 10.6 Native integrations and updates

| Integration | Phase 6 | Why |
| --- | --- | --- |
| Single instance | `tauri-plugin-single-instance`: a second launch focuses the first window | Two kernels on one IndexedDB would race the journal's writer lock |
| Menus | Built in Rust: the platform's application menu with "Command palette" (Mod+K, which emits an event the shell answers with `palette-open`), "Reload", "Quit", and on macOS the standard edit items | Native expectations; each item runs a shell command; no JavaScript menu permission |
| Window state | The OS keeps size and position; nothing persisted by Loam | Layout is the kernel's, not the window's |
| Updates | `tauri-plugin-updater` in Rust only, **off unless the build is given a public key and an endpoint** (`LOAM_UPDATER_PUBKEY`, `LOAM_UPDATER_ENDPOINT`); with them, a signed update over HTTPS is required and an unsigned or tampered one refused. `dangerousInsecureTransportProtocol` is never set | Who signs is Q1's |
| Notifications, files, deep links, tray | Reserved | Notifications follow phase 4's inbox; files need a grant no app has; deep links need the URL scheme on a custom protocol |

### 10.7 The desktop suite

`loam-desktop.yml`, a new pull-request workflow. The suite is **Vitest with `webdriverio` as its WebDriver client**, run with `--reporter=verbose` so the exit check reads its titles, driving the webview through WebDriver's `execute` with the same kernel calls `web`'s harness makes.

| Job | When | Tools | Timeout | Does |
| --- | --- | --- | --- | --- |
| `Desktop on Linux` | Pull requests touching `endpoints/loam/**` (not `docs/`), the workflow, `endpoints/umbel/**` (not `docs/`, for P6-D2's `hello-mcp`), `packages/rust/**` or the lockfile, gated by `Affected units`; daily; manual | Rust, `libwebkit2gtk-4.1-dev`, `webkit2gtk-driver`, `xvfb`, `tauri-driver` | 45 min | Builds `web`, then the app; runs the suite under `tauri-driver` with `WebKitWebDriver`; builds `.deb` and `.AppImage`; records WebKitGTK's version |
| `Desktop on Windows` | Daily, manual | Rust, WebView2, `msedgedriver`, `tauri-driver` | 60 min | The same; builds `.msi` |
| `Desktop on macOS` | Daily, manual | Rust | 45 min | Builds the `.app` and `.dmg` and runs the Rust tests; no WebDriver suite, since macOS has no WKWebView driver (S91) |

**Its local entry** in `scripts/affected/suites.mjs` (the tooling tests require one) runs the desktop crate's `cargo test` and a debug build with `cargo`, and names the WebDriver suites and the other operating systems as `remote` only, since a developer's macOS machine has no driver for any of them. **On a shared machine** the build runs under the heavy-command lock, one at a time, with the shared target directory and `pnpm rust:sweep`.

## 11. Distribution (D107)

**Every artifact is built and verified in CI. Nothing is published, pushed or submitted in phase 6** (Q1); each stays quarantined in the release inventory until the owner admits it.

### 11.1 The static site

Unchanged from phases 1 and 2: `loam deployment write` with `--host static` (the default). Step 10 writes `endpoints/loam/docs/guides/deploy.md`: a static host must answer `index.html` for a path with no file (D74) and send `frame-ancestors` and the other headers of 3.5 as response headers; the sandbox's second origin, on another site (D62, 3.2); that a static host serves `local` identity only; and the hosted and desktop profiles. The guide is linked from STATUS.md and `endpoints/loam/README.md`.

### 11.2 The OCI image

`endpoints/loam/packages/host/Containerfile`, built in `loam.yml`'s new **`OCI image`** job: triggered as the rest of `loam.yml` is, gated by `Affected units` on `@lushly-dev/loam-host` and its dependencies, with the runner's Docker. Its `suites.mjs` entry runs it locally where `docker` is present and names it `remote` otherwise; `AGENTS.md`'s CI table gains its row.

- **Base** `node:26-trixie-slim`, pinned by digest in the file, with the digest recorded in step 9 and updated by Dependabot's Docker ecosystem.
- **Two stages:** the first runs `pnpm install --frozen-lockfile`, builds `web`, `host` and their dependencies, and runs **`pnpm -F @lushly-dev/loam-host deploy --prod --legacy /out`** (pnpm 10.30.1 refuses `deploy` without `--legacy` in this workspace); the second copies `web`'s `dist` and `/out`, with no compiler, `pnpm` or source.
- **Runs as** a non-root user, UID 10001, `ENTRYPOINT ["node", "/app/bin/loam-host.js"]`, `CMD ["start", "--server", "/config/loam.server.toml", "--deployment", "/config/loam.deployment.toml", "--dist", "/app/dist"]`, `VOLUME ["/data"]`, `EXPOSE 8443`, **`HEALTHCHECK CMD ["node", "/app/bin/loam-host.js", "health", "--server", "/config/loam.server.toml"]`** (3.8: the image has no `curl`, and a bare probe would get 421 and a certificate for another name), and labels `org.opencontainers.image.source`, `.revision`, `.version` and `.licenses`. The `io.modelcontextprotocol.server.name` label is added only when Q1 admits a registry entry.
- **TLS:** the image's configuration needs `[tls]`, or a TLS-terminating sidecar proxy in front of a loopback `listen`; the guide shows both.
- **No secret in the image.** Configuration and secrets are mounted at `/config` and `/run/secrets`; the guide gives Kubernetes `defaultMode: 0400` with `runAsUser: 10001`, so 3.2's permission check passes. P6-I1 scans the image's filesystem.

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

From step 10, in M4; none is on M1's path.

| Document | Where | Default | Holds |
| --- | --- | --- | --- |
| **Server card** (SEP-2127, Final) | `<base>mcp/server-card`, `application/mcp-server-card+json` | On (`[discovery] server_card`) | The card's identity fields from the deployment (`name` from the workspace's id, `title` from its name), **no version**, matching `api/health`; one remote endpoint `{ type: "streamable-http", url: "<origin><base>mcp" }`; `supportedProtocolVersions: ["2026-07-28", "2025-11-25"]`. No tools, no instance, project, member or person; **it shows anyone with the address the workspace's name**, which the 401 challenge does not |
| **AI catalog** | `/.well-known/ai-catalog.json`, `application/ai-catalog+json` | **Off** (Q2) | `{ specVersion: "1.0", entries: [{ identifier, type: "application/mcp-server-card+json", url }] }` |
| **Agent guide** | `<base>mcp/agents.md`, `text/markdown` | **Off** (Q2) | Generated from the registry: how to connect (the OAuth flow, the scopes), and `HOSTED_MCP_COMMANDS` with their descriptions. No instance's or app's commands |

- **Served** with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`, `Cache-Control: public, max-age=3600`, an `ETag` over the body, and `304` for a matching `If-None-Match`, as the extension's discovery document asks (S95). These are the only routes with CORS.
- **Validated** by a unit against the extension's `schema.json`, vendored at a pinned commit with its SHA-256, as 11.4's schema is.
- **Umbel** plans its own card and catalog file in its phase 7 (Umbel's R11, whose notes record the check that the two agree on field use).

## 12. The copilot in the same process

D24 and D25 put the copilot runtime in-process on the hosted server, and phase 5 builds it. Phase 6 gives it a place and nothing else:

- **The seam** is `HostModule` (3.1): phase 5's runtime registers its routes under `<base>api/copilot/`, gets a `ModulePrincipal` only through `sessionPrincipal`, which applies 6.2's first and third rows, and calls the server kernel only through `callAs` with that principal. It never holds the kernel, and has no session logic of its own.
- **The row** P6-X1 is phase 5's to write in its specification: the copilot's stream and a tool call, served by the same `loam-host` process that serves the shell and MCP. Phase 6 exits when it passes.
- **Where the copilot's data is** is phase 5's question, made sharper by section 7: on the server, the runtime sees the server's records, not a person's documents; in a browser worker, its trust-record writes are `HUMAN_REQUIRED` in a hosted `provider` deployment (A6). A [follow-up](#follow-ups) for phase 5.

## 13. Secrets (D108)

- **The server resolves every secret, and only the server.** The auth secret, the SMTP URL, OIDC client secrets (3.2) and the mount bearers (`bearer_file` and `bearer_env` in the deployment) are read at start, held in memory, never written to the data directory, a log, the journal, the projection, a response or the image. `loam-host` never writes `mountsOut` (3.3). A secret file must be 0600 (`HOST_SECRET_PERMISSIONS`). **The one exception** is the development profile's generated `secrets/auth`, 0600 in a 0700 directory ignored by Git (5.1), refused with any origin but `localhost`'s by `HOST_MAIL_SINK_EXPOSED`'s rule.
- **The `secrets` grant moves to phase 5,** with the `http` grant it serves. An app's handlers run in the browser (D54, D61), so a secret's value given to an app would reach the browser, which phase 1 forbids ("The browser holds none"). The grant will name a secret the kernel attaches to an outbound `http` request made through the hosted server, and never give its value to app code. Phase 1's catalog row "`secrets`, Phase 6" is amended to "Phase 5, with `http`" (D108).
- **The desktop** holds `mounts.json`'s bearers in the Rust host's memory, never in the webview, as the hosted server does.

## 14. Budgets

**First paint does not change.** Phase 3's ceiling and allowances stand; phase 6 adds nothing to first paint, and nothing to `late` but the check that loads `late-hosted`:

| Row | Where | Estimate | Note |
| --- | --- | --- | --- |
| First paint | | **0, 0** | `host` is read from the projection in stage B, not from the boot record; `SHELL_EXPOSE` is unchanged |
| `late-hosted` (new) | Loaded inside `loadLate` only when `host.kind` is `hosted` and `identity.mode` is `provider` | 6,500 | The routing of `SERVER_COMMANDS`, A6's narrowing, `trust-record-settle`, the snapshot refresh, `server-call.ts` |
| `late` | Both modes | +150 | The condition that loads `late-hosted` |
| The projection validator's chunk | Stage B | Measured first | Version 4's `host`; step 3 measures, then moves code or amends the row by its measurement, as phase 3's step 8 does for `apps` |

The `budget` script's closures gain `late-hosted` after `late-identity`. P6-E9 holds that a `local` shell and a static `provider` shell never request `late-hosted`.

**Server and desktop budgets**, measured on `ubuntu-latest` in the job that runs them. Each ceiling is the step's measurement plus 25%, recorded in this section by that step with the coordinator's approval, as phase 0's budgets were:

| Row | Measured by | Proposed ceiling before measurement |
| --- | --- | --- |
| `loam-host dev` cold start to the first `200` on `<base>` | P6-H1 | **377 ms**: 301 ms measured on `ubuntu-latest` in [#945](https://github.com/lushly-dev/afd/pull/945)'s `Hosted development profile` job, plus 25%, rounded up. Approved by the coordinator 2026-11-10; proposed 3,000 ms before measurement |
| Resident memory after boot and E1's scenario | P6-H1 | **117 MB**: 93 MB measured in the same job, plus 25%, rounded up. Approved by the coordinator 2026-11-10; proposed 300 MB before measurement |
| **`whoami` p95 over 500 sequential signed-in requests**: the cost of no cookie cache (phase 3's 4.3) | P6-H3 | 25 ms; past it, secondary storage is specified, never the cookie cache |
| `tools/list` p95 over 200 requests | P6-H4 | 50 ms |
| The relay's added latency over a direct request, p95 | P6-H6 | 20 ms |
| The image's uncompressed size | P6-I1 | 400 MB |
| Each installer's size | P6-D5 | Recorded only, in step 12 |
| Desktop cold start to stage A's paint | P6-D1 | 2,500 ms |

## 15. Accessibility

Phase 6 adds no chrome to the browser, so phases 0 to 3's rules and tests stand unchanged. In addition:

- **Every page the hosted server serves** is the shell's: P6-H2 runs phase 0's axe scenarios (light, dark, high contrast, forced colors) against the dev host, so a response header that broke a style or a script would show.
- **The trust-record copy's notice** (6.3) uses the existing status item and live region, so it adds no element.
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
| `HOST_SANDBOX_INVALID`, `HOST_OIDC_INVALID`, `HOST_MAIL_SINK_EXPOSED`, `HOST_MAIL_INSECURE` | 3.2, 9 | Will not start | Per row; for the sandbox, another site |
| `HOST_DEPLOYMENT_KIND`, `HOST_IDENTITY_LOCAL` | 3.3 | Will not start | A version 4 file with `kind = "hosted"`; `provider` identity, or a static host or the desktop for a personal shell |
| `HOST_DATA_LOCKED` | Section 4, 3.7 | Will not start; a bootstrap is refused | Another process holds the directory |
| `HOST_NOT_BOOTSTRAPPED`, `HOST_ALREADY_BOOTSTRAPPED` | 3.1, 3.7 | `start` will not start; the bootstrap is refused | `loam-host bootstrap`; nothing, it is done |
| `HOST_ORIGIN_SHARED` | 3.4 | A `check` warning | One deployment per origin |
| `HOST_MODULE_RESERVED` | 3.1 | Will not start | Another module name |
| `HOST_MISDIRECTED` | 3.2 | `421`, nothing run | Use the configured origin |
| `HOST_PORT_TAKEN` | 5.1, a port `dev.json` records is in use | `dev` and `bootstrap --dev` will not start | Free the port, or remove `dev.json` and accept a new origin |
| `HOST_DEV_PORT_CHANGED` | 5.1, a `--port` other than `dev.json`'s | `dev` will not start | Drop `--port`, or remove `dev.json` to change the origin deliberately |
| `DEPLOYMENT_IDENTITY_INVALID` | 3.7, bootstrap's `--slug` against `[identity] organization` | The bootstrap is refused | Use the deployment's slug |
| `IDENTITY_BINDING_MISMATCH` | `doctor` (phase 3's 2.3) | A warning | Fix the binding on the server |
| `REQUEST_NOT_SAME_ORIGIN` | 6.2 row 1, 8.1 row 2 | `403`, nothing run | Call from the shell |
| `REQUEST_INVALID`, `REQUEST_TOO_LARGE` | 6.2, 8.1 | `400`, `413`, nothing run | Per row |
| afd-auth's `UNAUTHORIZED`, phase 3's `AGENT_CANNOT_SIGN_IN` | 6.2 row 3, 8.1 row 3 | `401`; the browser runs its session refresh | Sign in again |
| `SERVER_COMMAND_NOT_SERVED` | 6.2 | `404` | None: the shell sends only `SERVER_COMMANDS` |
| `SERVER_UNAVAILABLE` | 6.1 | A failure, retryable, journaled; nothing written | Try again; the hosted server did not answer |
| `TRUST_RECORDS_TOO_LARGE` | 6.3 | Journaled; the copy unchanged; a status notice | Archive projects; the limit is 2 MiB |
| `INSTANCE_UNKNOWN` | 8.1, 10.4 | `404` | Check the deployment's instances |
| `MOUNT_BATCH_REFUSED`, `MOUNT_METHOD_REFUSED` | 8.1 | `400`, nothing forwarded | Send one message per request; the shell sends only the methods it needs |
| Phase 3's `WORKSPACE_NOT_MEMBER`, phase 2's `PROJECT_NOT_FOUND`, `MOUNT_PROJECT_NOT_LISTED` and `MOUNT_SPACE_PINNED` | 8.1 step 11 | `403`, nothing forwarded; the code reaches the kernel | As phases 2 and 3 |
| `MOUNT_COMMAND_NOT_EXPOSED` | 8.1, 8.2 | `403` | Ask the deployer to expose it |
| `MOUNT_SESSION_UNKNOWN` | 8.1 step 16 | `404`; the call fails, retryable, and the next call reconnects | None: the shell starts a new session |
| `MOUNT_LIMIT` | 8.1 | `429`, `Retry-After: 1` | Try again shortly |
| `MOUNT_TIMEOUT` | 8.1 | `504`, retryable | Try again; the instance was slow |
| Phase 1's `MOUNT_UNREACHABLE`, `MOUNT_UNAUTHORIZED`, `MOUNT_RESULT_INVALID` | 8.1 (`502` for the last), 10.4 | As phase 1 | As phase 1 |
| `DESKTOP_MOUNTS_PERMISSIONS` | 10.3 | The desktop mounts nothing | Restrict `mounts.json` to your user |
| `DEPLOYMENT_HOST_MISMATCH`, `DEPLOYMENT_DESKTOP_PROVIDER` | 3.3 | `deployment write` stops | Per row |
| `DEPLOYMENT_PROVIDER_NEEDS_HOST` | 3.3 | A warning | Serve it with `loam-host` |
| Phase 3's `DEPLOYMENT_STDIO_TEAM` (D95) | 3.1 | The server will not start | An HTTP instance |

## 17. Security

- **Phase 3's boundaries, delivered as written.** The provider, the server kernel and the relay are the enforcement points (phase 3's 2.5); the server takes every session call as the human (9.5); the transport and the relay accept only same-origin JSON and serve no CORS (10.2); the session cookie is host-only. "A cookie-forwarded call is always the person's own" rests on D54: native apps are trusted code in the page, so they could reach the transport, and the server still takes their call as the person, never as more. Nothing in this specification lets a browser choose an actor, widens a CSP source, or adds a route that runs a command without one of phase 3's two principal sources, but the server card, catalog and guide, which run none.
- **The origin is configuration.** No forwarded header is trusted; a request for another host is 421 (3.2); the rate limiter's address is the socket's, set by the host (A7). One deployment per origin, since the cookie and the root well-known paths belong to the origin (3.4). The sandbox is another site (3.2).
- **The relay is now a boundary** for team instances, so it applies everything the browser's kernel applies to a mounted call, through the meta-tools as well as first-class tools: the six methods it accepts and five it forwards (cancellation is its own), the message it rebuilds with only the `_meta` keys and headers it names, sent to the entry's `url` exactly, first-class tools only by bare name in a `hybrid` catalog, the effective command and scope, exposure from the discovered catalog, access, `unlistedProject` on every command call with or without a scope, and the pinned space, **by allow-list**: no other `space` or `spaces` key at any depth and no root schema keyword outside a short list (A3); the answer comes back by allow-list too, by status: an empty `2xx` as it is, a `200` with one JSON-RPC response bound to the request's `id` or a stream ending after that one response, any other status with at most one JSON-RPC error, re-serialized, and no header of the instance's but its bare `Content-Type` and an `initialize`'s `Mcp-Session-Id`; discovery needs membership and, for a team instance, one listed project the person may enter; it binds an upstream session to its person and drops server-to-client requests. **Its own refusals carry `Loam-Relay-Refusal: 1`**, which an instance cannot set, so an instance's error can never trigger a session refresh or put its words in the kernel's message. **These are rules of the HTTP layer.** A tool result's own error code stays the instance's, labelled `untrusted` with `dev.loam/instance`, as phase 1's `parseMountedResult` does; nothing refreshes or closes on it.
- **Agents over MCP reach only records the server holds** (section 7), so a connected agent never changes something its person cannot see; phase 3's rules on human and owner commands stand inside that list.
- **Removal is one path.** `/organization/leave` is disabled, so leaving runs the same last-owner check, revocation and settle as removal (3.7).
- **Static files** are served only from `<data>/public/site`, resolved with `realpath`, with traversal and encoded separators refused (3.5).
- **Durability and the lock.** The store syncs fully; the lock is the operating system's and ends with the process (section 4).
- **Secrets** are the server's alone (section 13), and file permissions are checked at start.
- **The development profile is not a deployment.** Its mail sink holds working join and recovery links in a file, so it is refused on any origin but `localhost` (`HOST_MAIL_SINK_EXPOSED`).
- **Supply chain.** Every new dependency is pinned exactly and past `minimumReleaseAge`; the image's base is pinned by digest; installers are unsigned and say so; the updater refuses an unsigned update and is off without a key.
- **The desktop.** The webview holds no `core:*` permission and reaches no file, no program and no network but its own origin and three IPC commands that take an instance name; frames cannot `invoke`; a `stdio` command line is the desktop owner's, in a file only they can read (D56).
- **Public documents.** The server card says what the 401 challenge already says, plus the workspace's display name; the catalog and the guide are off by default (Q2).

## 18. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 6 |
| --- | --- | --- |
| Documents, app data and personas on the server, and sync with browsers | The collaboration service (D46) | `HOSTED_MCP_COMMANDS`; the store adapter; `trust-record-settle`'s shape |
| Mounted instances' and apps' commands over MCP, and `calls` | Phase 5 | `@lushly-dev/loam-kernel/mounted`; the relay's discovery |
| The copilot runtime | Phase 5 | `HostModule` (12) |
| A CLI with an OAuth client for the hosted server | An AFD follow-up | `expose.cli` |
| Postgres, a second server process | When a measurement or consumer asks | `DataAdapter`; the lock |
| Joining a hosted workspace from the desktop | A follow-up, with a passkey story for a webview | `[host] kind`; `DEPLOYMENT_DESKTOP_PROVIDER` |
| Tauri mobile | D33 | Responsive chrome |
| An MCP bundle for platform registries (W21) | D39 | `server.json` |
| Publication of any artifact, signing identities, the update key | The owner (Q1) | The inventory entries; `LOAM_UPDATER_PUBKEY` |
| Automated backups | A follow-up | `doctor` names the files |

## 19. Exit criterion and tests

The phase exits when every test below passes on `main` in the place its row names, and STATUS.md records the runs and each milestone as it is reached. **Every exit test's title starts `P6-E<n>:`, `P6-H<n>:`, `P6-M<n>:`, `P6-I<n>:`, `P6-D<n>:` or `P6-X<n>:`**, and every file holding them runs with a verbose reporter. `node scripts/loam-exit-check.mjs --phase 6 <loam run id> <ci run id> <loam-desktop run id>` reads a manual run of each, with `scripts/loam-exit-check.p6.minimums.json`. **The third id, and `WORKFLOWS.desktop`, are read only under `--phase 6` without `--milestone`**: `--phase 6 --milestone m1` takes the two ids it takes today (`loam-exit-check.mjs:287-288`) and reads only the rows M1 lists, and phases 2 and 3 never read the desktop workflow. The desktop run must be of the same commit as the other two, as the check already requires of `loam.yml`'s and `ci.yml`'s (`loam-exit-check.mjs:289-292`). **A row named in several steps closes in the last step that names it.**

**`WORKFLOWS` changes with each job,** since the check requires a run's jobs to equal its list exactly (`loam-exit-check.mjs:250-256`): step 2 adds `Hosted development profile` to `WORKFLOWS.loam.jobs`, step 9 adds `OCI image`, and step 11 adds `loam-desktop.yml` with its jobs, each in the pull request that adds the job.

| Place | Workflow and job | Step |
| --- | --- | --- |
| Units | `loam.yml`, `Build, unit and Chromium` | `Unit suites with coverage` |
| Chromium | `loam.yml`, `Build, unit and Chromium` | `Chromium suite against the built shell (phase 0's E1 to E10, phase 1's so far, A1 to A3; the walk is its own job)` |
| Host path | `loam.yml`, `Build, unit and Chromium` | `AFD's host path` (new in step 0a: `local-db`'s SQLite contract, verbose) |
| Budget | `loam.yml`, `Build, unit and Chromium` | `Bundle budget` |
| Hosted | `loam.yml`, `Hosted development profile` (new in step 2) | `Hosted criterion against the development profile` |
| Production | `loam.yml`, `Hosted development profile` | `Production profile on TLS files and behind a proxy` (new in step 8) |
| Mounted | `loam.yml`, `Mounted against Umbel` | `Mounted suite through the hosted relay` (new in step 8, beside the existing step, which keeps its name for phase 2's E6 and phase 3's E12) |
| Image | `loam.yml`, `OCI image` (new in step 9) | `Build and run the image` |
| Desktop | `loam-desktop.yml`, `Desktop on Linux`; `Desktop on Windows` | `Desktop suite under tauri-driver` |
| Desktop build | `loam-desktop.yml`, each job | `Build the installers` |

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P6-E1 | **The server configuration and the deployment, version 4** | Units | A case per refusal of 3.2 and 3.3, including a non-`https` `localhost` origin and a same-site sandbox; version 1 to 3 files read as `static`; the projection holds `host` and nothing more; `workspace-deployment-apply`'s input holds `host.kind`; `--host` mismatch; `DEPLOYMENT_PROVIDER_NEEDS_HOST`; `DEPLOYMENT_DESKTOP_PROVIDER` |
| P6-E2 | **The headers and static files** | Units | 3.5's builder on every fixture's `index.html`: the `<meta>` policy plus `frame-ancestors 'none'`, plus `form-action 'self'` on the four pages, nothing else; `serveSite`'s refusals |
| P6-E3 | **The frozen lists** | Units | Section 7's unit; `SERVER_COMMANDS` registered on the server and routed only in a hosted provider deployment; in every other deployment kind and mode each runs its phase 3 handler, byte-identical to before; `SHELL_EXPOSE` unchanged |
| P6-E4 | **The browser's routing and copy** | Units | Over a fake `serverCall`: each routed command writes nothing locally; `server-call.ts`'s mapping of 200, 401 (and the refresh), 400, 403, 404, 5xx and a network failure; `trust-record-settle` journaled with its input, run top-level, replacing the three tables, **writing only installed rows into `agent-member`, as the filtered row**, and run after a person-changing `session-settle`; **`generation` the digest of that person's snapshot**, equal for equal snapshots and different for two people's; the active project gone after a settle leaves it; `TRUST_RECORDS_TOO_LARGE`; the agent interface's writes `HUMAN_REQUIRED` (A6); a replay of the journal has zero differences, reads the kind from `workspace-deployment-apply`'s entry, and makes no `serverCall` |
| P6-E5 | **The relay's decisions** | Units | 8.1's decision function over every row: methods (`resources/read`, `tools/list` and a bare JSON-RPC response refused), `initialize`'s capabilities replaced, step 13's `_meta` and `meta` keys dropped (`dev.afd/outputBudget` among them), **ids: a request with no id or a non-safe-integer id, a notification with one, and a `notifications/cancelled` whose `requestId` is neither a string nor a safe integer, each `REQUEST_INVALID`**, a path beyond `mcp`, a query or a fragment `INSTANCE_UNKNOWN`, a message nested past `DISCOVERY_LIMITS.depth`, headers, batch, scope from `_meta` and from `arguments.meta` (and the two differing, and `null` read as absent), access, `unlistedProject` with the effective scope's slug, **exposure by the catalog: the command whose `tool` matches and its computed `expose`, no recomputing**, **`afd-call` naming a hidden mutation, `afd-call` with `meta` scope in a restricted project, `afd-call` naming `afd-context-enter`, `afd-call` or `AFD-BATCH`, `afd-call` with no or a non-string `command`, `afd-batch`, `afd-pipe`, `afd-discover`**, `afd-help` and `afd-detail` let through at workspace level and refused with a scope, **a member of a listed project discovering a project-listed instance**, and a member of none refused `MOUNT_PROJECT_NOT_LISTED`, **a member of no listed project sending a scope-less `tools/call` to a project-listed instance refused `MOUNT_PROJECT_NOT_LISTED` (11.0)**, the pinned space and the forwarded rewritten arguments, **the pin's allow-list: in a pinned project, a nested `target.space`, a `Space` case variant, a root `if`/`then`, and a root `oneOf`, each `MOUNT_SPACE_PINNED`; and, with the input leaving the field out, a schema declaring `properties.target.properties.space` and one with a top-level `spaces` and no `space`, each `MOUNT_SPACE_PINNED`, while a plain object schema with the pinned top-level `space` passes**, **a first-class tool's top-level `confirm` dropped, and one whose schema declares `confirm` forwarded as `afd-call { command: tool, input: arguments }` with no acknowledgement**, an `afd-call` whose `arguments.input` is not an object `REQUEST_INVALID`, **`discoverInstance` setting `firstClass` only under `hybrid`**, `notifications/cancelled` never forwarded and aborting only this person's in-flight request through the same binding, with `202` either way, `relay_session_idle_ms`, eviction of the least recently used idle binding and `429` when all four are busy, a `DELETE` for an unknown, evicted or foreign id answered `204` with the same bytes, an `initialize` forwarded with no `Mcp-Session-Id`, `afd-help`'s and `afd-detail`'s arguments rebuilt from their schemas, `firstClass` ignored in a catalog whose `toolStrategy` is not `'hybrid'`, unknown and foreign session ids, limits; server-to-client requests and JSON-RPC arrays dropped from a stream; **the rebuilt message**: a page's `params.task`, `params.inputResponses`, `params.requestState`, `_meta["dev.afd/confirm"]`, extra `params` fields, `afd-call`'s `meta` and `confirm`, every `_meta` key but those steps 12 and 13 name, and its own `Mcp-Method`, `Mcp-Name` and `MCP-Protocol-Version` never reach the instance, and the relay's headers come from the rebuilt message; **a `grouped` fixture where `tools/call notes { action: "delete" }` is refused and never reaches the instance**; a non-string `params.name`; **a member of project A sending a first-class call with `arguments.meta` set to A and no `_meta` is decided and forwarded at workspace level, with no `dev.loam/scope`**; the slug, not the id, passed to `pinMountedInput`; a scope off `SCOPE_V1`'s shape; `server/discover` decided at workspace level with `clientCapabilities` replaced and the modern keys kept; and **`mount.ts`'s mapping**: a body code read only under `Loam-Relay-Refusal: 1` and arriving with the kernel's own message, a relay 401 `UNAUTHORIZED` running the session refresh, the same body without the header giving `MOUNT_UNAUTHORIZED` and no refresh, `MOUNT_SESSION_UNKNOWN` closing the transport and `request` reconnecting before the next send; **a tool result whose `CommandResult` carries `UNAUTHORIZED` returned as the instance's code, labelled `untrusted` with `dev.loam/instance`, with no refresh and no close**; the answer's allow-list: by status (`3xx` `502`, an empty `2xx` passed with no `Content-Type`, another status with at most one JSON-RPC error re-serialized and any other body replaced by none), only `application/json` or `text/event-stream` on a `200` with a body, a `charset` other than `utf-8` refused, a byte-order mark dropped, multi-line `data:` joined, `id:`, `retry:`, comments and a non-`message` event dropped, one JSON-RPC response per JSON body with the request's `id`, a stream ended after its one response with notifications before it passed, an `Mcp-Session-Id` passed back only on `initialize`'s answer, one already bound to another person `502`, at most 4 bindings per person and instance; the kernel's `MountFailureCode` and `LoamKernelErrorCode` holding each relay code; a `MountRefusal` passing through `refusalOf` unchanged from its `cause` chain; a code outside `CODES` under the header giving `MOUNT_UNREACHABLE`; `refreshSession()` called by both the relay's and the transport's 401 |
| P6-E6 | **The registry entry and the server card** | Units | `server.json` and a generated card validate against their vendored schemas, whose SHA-256 the test checks; the card holds no version |
| P6-E7 | **`SqliteAdapter`** | Host path | `runDataAdapterContract` on `node:sqlite`, every case; a batch is one transaction (a fault mid-batch leaves nothing); `synchronous` reads `FULL`; `local-db`'s `entry.test.ts` holds `/sqlite` out of the root |
| P6-E8 | **No job was skipped** | The exit step | `node scripts/loam-exit-check.mjs --phase 6` (and `--milestone m1` for M1) exits 0 |
| P6-E9 | **Budgets** | Budget; Chromium; Hosted | Section 14's browser rows under their ceilings, first paint unchanged; a `local` shell and a static `provider` shell never request `late-hosted`, and a hosted `provider` shell requests it once, in stage B |
| P6-H1 | **One command, one process** | Hosted | `loam-host dev` from an empty directory prints its origin; `.loam-dev/.gitignore` holds `*`, files are 0600 and directories 0700; the shell boots over HTTPS under `base_path = "/loam/"`; a deep link is `index.html` with `200`; hashed assets `immutable`; **`GET /loam/../auth.sqlite`, its `%2e%2e`, `%2f` and `%5c` variants, and a symlink in the site pointing out of it each answer 404**; a request with another `Host` is 421; a second `dev` on the same directory is `HOST_DATA_LOCKED`; after a restart the data is there and **the origin is the same**, from `dev.json`; cold start and memory rows of 14 |
| P6-H2 | **The shell hosted, as it was static** | Hosted | In `local` mode: phase 2's E1 chunk list equal to `serveDeployment`'s byte for byte; a reload restores scope; phase 0's axe scenarios; every page's response CSP is 3.5's, and no CSP violation in any scenario; a view app renders through the sandbox origin `https://127.0.0.1:<port>`, another site |
| P6-H3 | **The provider and bootstrap** | Hosted | A `provider` deployment under `dev`: the shell shows `IDENTITY_ORGANIZATION_UNKNOWN` before bootstrap; `bootstrap --dev` refused while `dev` runs (`HOST_DATA_LOCKED`), then, with `dev` stopped, succeeds once and is `HOST_ALREADY_BOOTSTRAPPED` after; the owner's invitation in the mail sink; `start` on a fresh data directory is `HOST_NOT_BOOTSTRAPPED`; a `stdio` instance refuses the start (D95); the four pages carry `form-action 'self'`; **after `restart()`, the origin is the same and a passkey sign-in still works**; the `whoami` row of 14; `scanSecrets` clean |
| P6-H4 | **The MCP route and the well-known documents** | Hosted | No token: 401 with `resource_metadata` naming `/.well-known/oauth-protected-resource/loam/mcp`, which answers, as does the root form; **`/.well-known/oauth-authorization-server/loam/api/auth` names the issuer `<origin>/loam/api/auth`, as does Better Auth's own OpenID configuration**; `tools/list` with a valid token equals `HOSTED_MCP_COMMANDS` plus the meta-tools; both eras through `<base>mcp`; a foreign `Origin` 403; `/sse`, `/message`, `/rpc`, `/batch`, `/stream/x` and `/health`, under `/loam/` and at the root, 404; 3.5's headers and `Cache-Control: no-store` on `<base>mcp`'s answers; the `tools/list` row; `scanSecrets` clean |
| P6-H5 | **The trust-record transport** | Hosted | A signed-in owner's `project-create`, **`workspace-app-set` and `agent-member-add`** from the shell each land in `loam.sqlite`; a second person's tab sees the project after its refresh; `trust-record-settle` in both journals; the server stopped, `project-create` is `SERVER_UNAVAILABLE` and the copy is unchanged; `GET`, `text/plain`, a foreign `Origin`, `Sec-Fetch-Site: cross-site`, an oversized body, no session, a mismatched `scope.workspace`, and a command not in `SERVER_COMMANDS` each refused before anything runs, the store unchanged; **`/organization/leave` is 404, and `member-leave` runs `revoke-person` and the server's `agent-member-settle` exactly once**; `scanSecrets` clean |
| P6-H6 | **The hosted relay** | Hosted | Against phase 2's Node fixture server (`web/test/mounted/scope-server.ts`, stateless), and for step 16's rows **a stateful, legacy-only fixture** on the SDK's Streamable HTTP server transport, which issues sessions: a member's call reaches it with the scope in `_meta`; a non-member of the project is refused before forwarding, by the fixture's log, **and the kernel shows `PROJECT_NOT_FOUND`**; `WORKSPACE_NOT_MEMBER`, `MOUNT_PROJECT_NOT_LISTED` and `MOUNT_SPACE_PINNED` each reach the kernel as themselves; **`afd-call` with `meta` scope in a restricted project, `afd-call` naming a hidden mutation, `afd-batch`, `resources/read` and a bare JSON-RPC response** are each refused and never reach the fixture; a pinned space rewritten in what the fixture receives, the fixture's log showing only the rebuilt message and the relay's headers; **the era negotiated through the hosted relay equals the test-only relay's**, with `server/discover` answered; **against a `grouped` fixture, `tools/call notes { action: "delete" }` is refused and never reaches it**; **a member of project A's first-class call with `arguments.meta` set to A and no `_meta` reaches the fixture at workspace level, with no scope**; **a member of a listed project discovers a project-listed instance**: on the modern era `server/discover`, `afd-help` and `afd-detail` pass, and on the legacy fixture `initialize` and the session `DELETE`, sent by the test with `fetch`, do; **a member of no listed project sending a scope-less `tools/call` to a project-listed instance is refused `MOUNT_PROJECT_NOT_LISTED`, and the call never reaches it**; **an instance answering `403 {"code":"MOUNT_SPACE_PINNED"}` with `Loam-Relay-Refusal: 1`, `Set-Cookie` and `Retry-After` gives `MOUNT_UNAUTHORIZED`, and none of those headers reaches the page**; a redirect, a `text/html` answer and a JSON body holding two responses are each `502`; **a notification's `202` passes back empty; a session `DELETE`'s empty `200` passes back empty; a legacy instance's `4xx` JSON-RPC error to `server/discover` reaches the page and the SDK falls back to the legacy era**; a response with another `id` cuts the stream; on the stateful fixture, a `notifications/cancelled` for an in-flight call aborts it upstream, by the fixture's log, and holds no concurrency slot; an event holding a server request is dropped and the rest of the stream arrives; **an instance answering `401 {"code":"UNAUTHORIZED"}` gives `MOUNT_UNAUTHORIZED`, with no session refresh**, and one answering `403 {"code":"PROJECT_NOT_FOUND","message":…}` gives `MOUNT_UNAUTHORIZED` with none of its words; **a stream cut past `relay_response_bytes` or `relay_timeout_ms` after its status is reported as `MOUNT_RESULT_INVALID` or `MOUNT_UNREACHABLE`**; on the stateful fixture: `Mcp-Session-Id` passed back only on `initialize`'s answer, a legacy session's `DELETE` forwarded for its person and refused for another, a fifth binding evicting the least recently used idle one with an upstream `DELETE`, **an idle binding `DELETE`d upstream at `relay_session_idle_ms`, by the fixture's log**, an upstream `404` dropping the binding, and `MOUNT_SESSION_UNKNOWN` followed by `mount.ts` reconnecting and a working new session; an aborted page request freeing its slot; `GET` 405; 3.5's headers on the relay's answers; the deployer's bearer reaches the fixture and never the page, a log or the journal; limits, `413`, and the `502` and `504` sent before the status of 8.1; the latency row; `scanSecrets` clean |
| P6-H7 | **No secret anywhere** | Hosted | On one dev host, its own sign-in, MCP token, transport and relay calls, then `scanSecrets` before `close()`: no auth secret, bearer, cookie value, access or refresh token, join or recovery token, or session id in the served files, the projection, either journal, the server's logs, any store row or `localStorage`; **no `mounts.json` exists anywhere under the data directory**; a secret file of mode 0644 refuses the start |
| P6-H8 | **A crash** | Hosted | `kill` (SIGKILL) during a burst of `project-create`s through the transport; **the restart succeeds at once**, the OS lock released with the process; the journal reads with its last partial line dropped; **every project the journal holds is in the store, and the store holds at most the in-flight count beyond it** |
| P6-H9 | **The production profile on TLS files** | Production | `loam-host start` with a certificate from a test CA; HSTS on a non-loopback name; `SIGHUP` re-reads a renewed certificate; SMTP mail to `smtp-server` over STARTTLS; a plain `smtp://` to a non-loopback host refused; `doctor`'s report, with both databases opened read-only while the server runs; `loam-host health` exits 0 |
| P6-H10 | **Behind a proxy** | Production | Plain HTTP on loopback behind a test TLS proxy: passkey sign-in (phase 3's virtual authenticator), the MCP 401 and a token's call, the transport and the relay all work with `Secure` cookies; an `X-Forwarded-Host` naming another host changes nothing; **a forged `X-Forwarded-For` or `X-Loam-Client-Ip` neither picks nor escapes a rate-limit bucket**: past the limit, every request from that socket is refused whatever the header says |
| P6-H11 | **The discovery documents** | Hosted | From step 10: the server card's media type, CORS, `ETag` and `304`, and no version; the catalog and the guide 404 by default and served when on |
| P6-M1 | **The mounted suite on the hosted relay** | Mounted | Phase 1's E3 and E4 and phase 2's E6 scenarios against a stock `umbel`, once through the test-only relay as today and once through `startDevHost`'s relay; the same results, the relay's proof no longer standing alone |
| P6-I1 | **The image** | Image | Builds; runs as UID 10001; `HEALTHCHECK` healthy through `loam-host health`; the shell and the MCP 401 served with mounted configuration and `[tls]`; no secret in its filesystem; its base digest is the file's; its size row |
| P6-D1 | **The same build on the desktop** | Desktop | Boot in the webview through the `loam` protocol; the written `<meta>` CSP holds `--host desktop`'s IPC sources and the `loam-sandbox` `frame-src`, and nothing else beyond phase 0's; phase 0's layout scenario journaled and replayed; reload restores from IndexedDB; no CSP violation; `shell-info-get` reports `host: 'desktop'`; axe in light and dark; menus' "Command palette" opens it; a second launch focuses the first; D52's S1 and S2 recorded; the cold start row |
| P6-D2 | **Mounts over the Rust host** | Desktop | A `stdio` `hello-mcp` and an `http` fixture server mounted from `mounts.json`: `hello-greet` answers in the console; the scope in `_meta`; a notification arrives as the event; the command line, URL and bearer never in the webview's DOM, store or journal; a killed child fails with `MOUNT_UNREACHABLE` and recovers; `mount_open` for an unknown instance refused; a `mounts.json` readable by others refused; **and, from P6-E1's unit, `MountAccess`'s `stdio` entries appear only for `--host desktop`** |
| P6-D3 | **A view on the desktop** | Desktop | Hello's view renders through `loam-sandbox`, a different origin from the shell's; phase 1's E2 scenario; the WebRTC probe of phase 1's 9.7 run and its result recorded for #711, not asserted |
| P6-D4 | **The capabilities** | Desktop | No `core:*` permission and no plugin's JavaScript permission is granted; the IPC allow-list is the three commands; `invoke` of anything else from the main webview is refused; **`invoke` from the `loam-sandbox` proxy frame and from the opaque view frame inside it is refused**; the `loam` protocol answers 404 for a path reaching `mounts.json`, encoded or through a symlink |
| P6-D5 | **Installers and updates** | Desktop build | Each job's installers built and hashed; with a test key, a signed update from a local feed **over HTTPS with a test CA** installs and a tampered one is refused; without a key, no update request is made |
| P6-X1 | **The copilot from the same process** | Named by phase 5 | Phase 5's specification writes it on `HostModule` (12) |

**What exited stays exited.** Phases 0 to 3's exit tests pass unchanged; the exit check reuses their rows and minimums, as phase 3's E12 does, so there is no `P6-` title for them.

## 20. Implementation plan

Each step is one pull request, merged on green. It updates this status block and STATUS.md before it merges. **Steps 4, 5 and 6 each get a review focused on the trust boundary they build; step 11 gets one on the desktop's capabilities.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: `SqliteAdapter` | `@lushly-dev/local-db/sqlite` on `node:sqlite` (section 4's shape); the contract; `entry.test.ts`; the `AFD's host path` step in `loam.yml`; a changeset; P6-E7 | `pnpm check`, `pnpm verify` |
| 1 | Host skeleton | `@lushly-dev/loam-host`: `createLoamHost`, Hono and the Node adapter, `readServerConfig` and `server.v1.json`, the data directory and OS lock, `serveSite`, 3.5's headers, the `Host` check, the sandbox origin, `check`, `doctor`'s read-only part; serves `local` deployments of versions 1 to 3 through a test-only option until step 3; the inventory entry; `loam.yml`'s `Affected units` and unit step gain the package; P6-E1's and P6-E2's units so far | `pnpm check`, `loam.yml` |
| 2 | Development profile | `loam-host dev` with 5.1's order; the certificate, secret and mail sink; `startDevHost` and `scanSecrets`; the harness on a `DevHost`; the `Hosted development profile` job with its step; **`WORKFLOWS.loam.jobs` gains it**; `suites.mjs` gains `openssl` for `loam.yml`; `AGENTS.md`; P6-H1, P6-H2 | `pnpm check`, `pnpm verify`, `loam.yml` |
| 3 | Provider and version 4 | **Needs phase 3's steps 1 and 4.** Deployment and projection version 4, `deployment write --host`, `workspace-deployment-apply`'s `host`; P6-H1 and P6-H2 move to version 4 and the test-only option goes; Better Auth mounted, `auth.sqlite`, mail; A7's header and `ipAddressHeaders`; both forms of `bootstrap`; D95's start refusal; the four pages' CSP; the projection validator's chunk measured; P6-E1, P6-E2, P6-H3 | `pnpm check`, `loam.yml`, `budget` |
| 4 | Server kernel and MCP | **Needs phase 3's 0a, 0c and 7, and 0a here.** `createServerKernel` on `SqliteAdapter`, `FileJournalSink` and the lock; `HOSTED_MCP_COMMANDS` in `loam-host`; AFD's handler mounted with its headers; A2's root metadata; the OAuth pages exist from phase 3's step 7, so P6-H3's case for their CSP closes here; P6-E3's list half, P6-H3, P6-H4. **Trust review: the route and the served list** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 5 | Trust-record transport | `api/kernel/call`, `SERVER_COMMANDS`, `trust-record-snapshot`, `trust-record-settle`, `late-hosted`, `server-call.ts`, A5's recorded table, A6's narrowing and `persona-list`; S4's `leave` endpoint and `/organization/leave` disabled; A4 and A8 (`PROVIDER_HOOK_FIELDS`); P6-E3, P6-E4, P6-E9, P6-H5, P6-H8, and P6-H7 for the transport's part. **Trust review: the transport, the copy and the hook** | `pnpm check`, `loam.yml`, `budget` |
| 6 | Hosted relay | **After step 5, whose transport P6-H7 uses.** Section 8 with A1 and A3, parse, decide and rebuild, `@lushly-dev/loam-kernel/mounted`, the relay's discovery and records, deployer bearers resolved, `Loam-Relay-Refusal`, `mount.ts`'s codes, its comment at `:148-155` corrected (SDK 2.4.0's `close()` sends no `DELETE`), `refreshSession()`, and the kernel's widened `MountFailureCode` and `LoamKernelErrorCode`; P6-E5, P6-H6, P6-H7, which closes here. **Trust review: the relay as a boundary, through the meta-tools and the `grouped` strategy** | `pnpm check`, `pnpm verify`, `loam.yml` |
| 7 | **M1, development profile** | `--phase 6 --milestone m1` and `loam-exit-check.p6.minimums.json`; `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`; STATUS.md records "development profile reached", unblocking phase 3's step 10 and phase 5 | The check exits 0 for M1 |
| 8 | **M2, production profile** | Section 9: TLS files with `SIGHUP`, SMTP, OIDC, limits, logs, `doctor`, `health`, `start`'s shutdown; the `Production` step; the `Mounted suite through the hosted relay` step; P6-H9, P6-H10, P6-M1; STATUS.md records M2 | `pnpm check`, `loam.yml` |
| 9 | OCI image | `Containerfile`, the `OCI image` job, **`WORKFLOWS.loam.jobs` gains it**, its `suites.mjs` entry and `AGENTS.md` row, Dependabot's Docker entry; P6-I1 | `loam.yml` |
| 10 | **M4's documents** | `server.json` and its vendored schema; the server card, catalog and guide; `docs/guides/deploy.md`; README and STATUS links; P6-E6, P6-H11 | `pnpm check`, `loam.yml` |
| 11 | Desktop lane | `@lushly-dev/loam-desktop`, the `loam` and `loam-sandbox` protocols, the Rust host's three commands, the capability file, single instance and Rust menus; `deployment write --host desktop`'s CSP and `MountAccess`'s `stdio`; `loam-desktop.yml`'s Linux job, its `suites.mjs` entry, the repository contract's exception, `.gitignore`'s negation, **`WORKFLOWS` gains the workflow**; D52's measurement; P6-D1 to P6-D4. **Trust review: the capabilities and the IPC** | `pnpm check`, `pnpm verify`, `loam-desktop.yml` |
| 12 | **M3 and M4** | The Windows and macOS jobs; installers and their sums; the updater and its HTTPS test; `AGENTS.md`; P6-D5; STATUS.md records M3 and M4 | `loam-desktop.yml` by `workflow_dispatch` |
| 13 | Exit | **After phase 5's runtime step.** P6-X1 as phase 5 writes it; `--phase 6`; STATUS.md records the exit; follow-ups filed | The check exits 0 |

Order: 0a, 1 and 2 first, in parallel. Step 3 after 1 and phase 3's steps 1 and 4. Step 4 after 0a, 3 and phase 3's 0a, 0c and 7. Step 5 after 4; step 6 after 5. Step 7 after 2 and 6. Step 8 after 7. Steps 9 and 10 after 8. Step 11 after 3 (version 4); step 12 after 11. Step 13 after everything and phase 5's runtime.

**Host capacity.** The hosted job runs Chromium and a server child per file; on a shared machine, one Vitest worker. The desktop's Rust build uses the shared target directory and `pnpm rust:sweep`, one at a time under the heavy-command lock.

## Questions for the owner

Each is about who can do what, or who is trusted. The specification is written to each recommendation, and says where an answer would change it. **As in phase 3, an open question blocks only the steps that build it, not the approval:** **Q1 and Q2 await the owner's answers at the approval of 2026-11-09.** Q1 blocks steps 9 to 12 (the image, the registry entry, the installers and the updater); Q2 blocks step 10's server card, catalog and guide.

### Q1. Does anything publish from phase 6, and who signs?

Phase 6 builds desktop installers, a server image and a registry entry. Publishing them puts the project's name on them, and a desktop app that updates itself trusts whoever holds its update key.

- **(a) Build and check everything, publish nothing yet (recommended).** Artifacts are made and tested in CI and kept there; publishing, the signing identities and the update key wait for a release you approve, unit by unit. The tradeoff: nobody can install Loam without building it until then.
- **(b) Publish the server image and its registry entry as previews, with no desktop updater.** Deployers can run Loam from the image without building it. Desktops are still built by hand. The tradeoff: the project's name is on a preview image people may run in production.
- **(c) Publish desktops as well, with an update key you hold.** People can install the desktop and receive updates. The tradeoff: whoever holds that key can push code to every installed desktop, and an unsigned installer still draws the operating system's warning until a signing identity exists.

### Q2. Should a hosted Loam announce itself?

A hosted deployment can publish a card that tells agents how to connect, a listing that lets crawlers find it, and a guide that names its commands. **The card shows anyone who has the deployment's address the workspace's name.**

- **The connection card only (recommended).** An agent given the address can connect without setup. The listing and the guide stay off until the deployer turns them on. The tradeoff: agents cannot find a deployment by searching the domain, and anyone with the address learns the workspace's name.
- **All three on by default.** Agents and indexes find every deployment and its commands with no setup. The tradeoff: anyone on the internet learns that the deployment exists, its workspace's name and what it can do.
- **All off by default.** Nothing is public, the name included. The tradeoff: every agent must be configured by hand.

## Proposed amendments to phase 3

**Approved with this specification on 2026-11-09, and applied to phase 3's specification in step 1, as written.** Each fills a gap in what phase 3 handed phase 6, or says how one of its rules is met on the hosted lane; none moves a boundary phase 3 approved: each adds a check, narrows an agent, or keeps a record honest.

| # | Amends | Proposed text | Why |
| --- | --- | --- | --- |
| A1 | 10.2 item 5's "accept only `POST` with `Content-Type: application/json`" for the relay | The relay accepts `POST` with that media type, and `DELETE` with no body and an `Mcp-Session-Id`, under the same `Origin` and `Sec-Fetch-Site` rule; `GET` is `405` | A raw `DELETE` (the SDK 2.4.0 page sends none on close) is accepted so sessions can end; the relay also ends idle ones itself (8.1 step 16). A cross-site `DELETE` needs a CORS preflight the relay never answers, so allowing it adds no cross-site path |
| A2 | 10.2 items 2 and 3 | The hosted server also serves the authorization server's metadata at the origin's root, `/.well-known/oauth-authorization-server<base><identity.path>`, and so owns its origin's `/.well-known/oauth-*` paths | MCP clients discover the issuer from the protected-resource metadata and then fetch RFC 8414's document, which a `base_path` keeps off the root; without it P3-H3's client cannot register or authorize |
| A3 | 10.2 item 5's relay checks | Beside `decideAccess` and phase 2's 9.2, the relay parses strictly, decides, and forwards only a message it rebuilds from its decisions: six methods accepted (`server/discover` among them) and five forwarded, `notifications/cancelled` being its own, only the `_meta` keys it names, first-class tools only by bare name (so AFD's `grouped` strategy cannot route to another command), scope read from `arguments.meta` only for `afd-call` and `afd-detail`, finds the effective command and scope through `afd-call` and `meta`, refuses every other AFD built-in or AFD-like tool name, applies the instance's exposure from its discovered catalog (D65) and pinned space (`pinMountedInput`, then an allow-list: no other `space` or `spaces` key at any depth, no root schema keyword outside a short list), applies `unlistedProject` to every command call, with a scope or without one, decides discovery at workspace level with one listed project the person may enter, refuses JSON-RPC batches, binds an upstream session to its person, drops server-to-client requests, marks its own refusals with `Loam-Relay-Refusal: 1` so an instance cannot pose as it, and passes the instance's answer back only by allow-list, by status, bound to the request's `id` | Once the relay is the boundary for a team, a person can send it any request directly, through the meta-tools as well; D65's "mutations stay hidden until the entry names them" and the pinned space were only the browser kernel's, which binds nobody |
| A4 | 9.5's "`agent-member-settle` … not registered" on the server | The server registers `agent-member-settle` as internal, run only through the host's `onMemberRemoved` callback, which `createLoamAuthOptions` takes from the host and which Better Auth's `afterRemoveMember` hook and `loamServerPlugin`'s `leave` endpoint each call exactly once per removal (`leave` deletes the member row itself, so the hook does not also fire), journaled on the server | Line 2 already refuses a removed sponsor's agents on the server; this keeps 8.3's "so the record says why" true for the server's authoritative record |
| A5 | 3.4's replay rule, "a command that writes Loam's store is never recorded" | In a hosted `provider` deployment, the trust-record commands are recorded, answered from their entries in a replay, and the browser's copy replays through `trust-record-settle`'s journaled input; a replay reads the deployment's kind from the journal's `workspace-deployment-apply` entry | There they write the server's store, not the browser's; re-running them in a replay would reach a server, which phase 3 forbids |
| A6 | 3.4's Agent column, and `persona-list`'s row | In a hosted `provider` deployment, the agent interface's `project-create`, `project-update`, `project-archive`, `project-restore`, `workspace-app-set` and `agent-member-*` writes are `HUMAN_REQUIRED`; `persona-list` on the server answers only `default` | 9.5 forwards trust-record calls only from `kernel.call`, so an agent changes these over MCP as its own connected agent; the server holds no personas |
| A7 | 2.6's `createLoamAuthOptions` | It sets `advanced.ipAddress.ipAddressHeaders: ['x-loam-client-ip']`, a header only the host sets, from the socket, after deleting any incoming copy and `x-forwarded-for` | Better Auth 1.7.18 reads only that list, default `x-forwarded-for`, and puts every request with no address in one bucket (S97): left alone, any client could pick its own bucket, or every client would share one |
| A8 | 9.5's list of what `principalGate` admits with no principal | A kernel-only `PROVIDER_HOOK_FIELDS`, compared by reference like `BOOT_FIELDS`, admitted for `agent-member-settle` only, and passed only by `onMemberRemoved`. The journaled actor is the removing person when the hook's request has a session, otherwise `{ kind: 'system', id: 'provider-hook' }`. A failed settle is logged, and line 2's refusal stays in force | A4's hook runs outside any MCP or session call, so it needs its own admitted fields, as boot's own work does, and its entry must say who caused it |

## Amendments to the architecture and the decision log

Approved with this specification on 2026-11-09; applied in step 1:

- **Architecture section 4, Hosts and Distribution:** the hosted server is `@lushly-dev/loam-host`; the desktop is `local` only; distribution artifacts are built and verified, and published only by the owner's release (Q1).
- **Architecture section 6, libraries:** Hosted server row: Hono 4.13 and `@hono/node-server` 2.1; the server store on SQLite through `local-db`'s `SqliteAdapter`; the fetch-style handler not needed (D101). Desktop row: Tauri 2.12 pinned, 3.0 watched.
- **Architecture section 6, AFD prerequisites:** a row for `SqliteAdapter`, phase 6, step 0a; the fetch-style `createMcpHandler` row stays optional and unused.
- **Architecture section 9:** phase 6's row gains its four milestones and the exit's wait for phase 5's runtime (D100); the collaboration service's gate reads "phase 6's M2".
- **Architecture glossary:** "Hosted server", "Server configuration", "Development profile", "Trust-record command", "Milestone (phase)".
- **Phase 1's surface catalog:** `secrets` moves from "Phase 6" to "Phase 5, with `http`" (D108).
- **Phase 3's specification:** A1 to A8, each in the section it names. **Phase 3's step 10 says "the check gains the hosted job"; phase 6's step 2 now does that** (it adds `Hosted development profile` to `WORKFLOWS.loam.jobs`), so phase 3's step 10 adds only its P3-H rows and minimums.
- **Decision log:** D100 to D108, below, decided with this specification's approval on 2026-11-09. D36 gains a note pointing to D101; D46 a note pointing to D100; D52 a note pointing to D106's measurement.

| ID | Decision |
| --- | --- |
| D100 | Phase 6 has four milestones: M1, the development profile, unblocks phase 3's hosted criterion and phase 5; M2, the production profile, is what the collaboration service's "after phase 6" waits for (the coordinator's reading of D46, which the owner may overrule); M3, the desktop lane, and M4, distribution, gate nothing before phase 7; the exit also needs the copilot served from the same process, once phase 5 has its runtime |
| D101 | The hosted server is `@lushly-dev/loam-host`: one Node 26 process per data directory and deployment on Hono 4.13 and `@hono/node-server` 2.1, mounting AFD's `createMcpHandler` through the Node bindings at `<base>mcp` alone; its own configuration file, `loam.server.toml`; an `https` origin, configured, never derived from forwarded headers; the sandbox on another site; one deployment per origin; the root `/.well-known/oauth-*` paths its own; a one-command development profile on `https://localhost` |
| D102 | The server's store is SQLite through AFD's new `SqliteAdapter` on `node:sqlite` with `synchronous = FULL`, its journal AFD's `FileJournalSink`, both in a data directory held by an operating-system lock that ends with the process; Postgres reserved |
| D103 | In a hosted `provider` deployment, the browser runs the trust-record commands on the server through `POST <base>api/kernel/call` and keeps a copy fed by the journaled `trust-record-settle`, which grants nothing; no failure writes; deployment and projection version 4 say which host serves a deployment |
| D104 | The hosted server serves over MCP only the commands whose records it holds or reads from the provider (`HOSTED_MCP_COMMANDS`), applied on the server; documents, app commands and page state are not served until the collaboration service and phase 5; `expose.cli` stays off until AFD's CLI can obtain a token |
| D105 | The hosted relay enforces phase 3's 10.2 item 5 against the server's records, through the meta-tools and AFD's `grouped` strategy as well: a strictly parsed message, rebuilt from its decisions and nothing else; six accepted methods, five forwarded, the effective command and scope, exposure from the discovered catalog, the pinned space, discovery decided at workspace level, no batches, sessions bound to their person, no server-to-client requests, and its own refusals marked so an instance cannot pose as it; it adds the deployer's bearer and never logs it, and discovers as the kernel does |
| D106 | The desktop is the same build in Tauri 2.12's webview, `local` identity only, IndexedDB unless D52's measurement fails, the shell on a `loam` protocol and the sandbox on `loam-sandbox`, mounts (`http` and `stdio`) through three IPC commands over a file only its owner can read, no `core:*` or plugin JavaScript permission, and an updater that is off without a key |
| D107 | Distribution: the static site with a deployment guide, an OCI image, installers, a `server.json` for the image, and a server card at `<base>mcp/server-card`, all built and verified in CI and none published; the AI catalog and the agent guide are off by default (Q2) |
| D108 | Every secret is resolved only by the server (or the desktop's Rust host), never written or sent, but the development profile's own generated secret; the `secrets` grant moves to phase 5 with `http`, attaching a named secret to a request and never giving its value to app code |

## Review 2026-11-09

Two independent reviews of `96e1ed9a`, a trust and security review and a general review, each called the specification approvable once fixed. The coordinator ruled where they differed: the sandbox keeps the **cross-site** rule; **Q3 is dropped**, since D104 follows from D46 and D98; the amendments are numbered **A6** (the agent-interface narrowing), **A7** (the client-address header) and **A8** (the provider-hook fields). Every finding is answered in this revision:

| Finding | Fix | Where |
| --- | --- | --- |
| B1: the relay bypassed through `afd-call`'s `command` and `meta`, `afd-batch` and `afd-pipe`; 8.2 as written refused `afd-help` and `afd-detail` | 5a, the six forwarded methods; step 6's effective command and scope; every other AFD built-in tool refused; `flagsOf` and `pinMountedInput` on the effective command with rewritten arguments; 8.2 calls `discoverInstance` itself; server-to-client requests dropped; P6-E5 and P6-H6 cases. **Deviation, stated:** AFD has no `isMetaTool`, so the rule reads `AFD_BUILTIN_TOOL_NAMES` from `@lushly-dev/afd-core`; and `discoverInstance` takes a `MountTransportV2` and does no I/O of its own, so it is exported whole, from a Node-safe subpath `@lushly-dev/loam-kernel/mounted` rather than the root, which keeps it out of any browser graph | 8.1, 8.2, 2, A3, D105 |
| M1: bootstrap in the development profile contradicted itself | Only `start` refuses `HOST_NOT_BOOTSTRAPPED`; `bootstrap --dev`, refused while `dev` holds the lock; P6-H3 rewritten | 3.1, 3.7, 3.8, 5.1, P6-H3 |
| M2, S1: the sandbox origin | Cross-site kept and explained; dev's sandbox on `https://127.0.0.1:<second port>`; 3.2's example another registrable domain; listeners bound first, then the configuration, with the deployment's sandbox origin overridden | 3.2, 5.1, P6-H2 |
| M3: the relay's codes never reached the browser | `mount.ts` carries a body code; 401 runs the session refresh; the codes listed in 8.1 and 16 and tested; who starts a new session after `MOUNT_SESSION_UNKNOWN` | 8.1, 16, P6-E5, P6-H6 |
| M4: the exit check broke between steps | `WORKFLOWS` updated in steps 2, 9 and 11; a new step `Mounted suite through the hosted relay` beside the unrenamed one; desktop and image suites verbose Vitest | 19, 20, 10.7 |
| M5: steps before their dependencies | The root metadata and its assertion to step 4 and P6-H4; P6-H8 to step 5 | 1.2, 3.7, 20 |
| M6: undeclared amendments | A6 declared, named in D103's consequence and STATUS.md; A7 | 6.1, 7, amendments |
| S2: server-to-client requests in a relayed stream | Dropped | 8.1 |
| S3: rate-limit identity | `x-loam-client-ip` from the socket, incoming copies deleted; A7; P6-H10 | 3.7, 9, A7 |
| S4: `/organization/leave` skips the removal hooks | Disabled; `member-leave` through `loamServerPlugin`'s `leave` on the removal path; A8's fields and actor; a failed hook logged, line 2 in force | 3.7, A4, A8 |
| S5: the copy's rows and `generation` | Installed rows only, as the filtered row; connected agents in memory; `generation` a digest of the person's snapshot; P6-E4 | 6.1, 6.3 |
| S7: insecure origins | Every origin `https:` | 3.2, P6-E1 |
| S8: a stale lock in a container | The OS lock on `lock.sqlite`; `.lock` informational; no NFS; P6-H8 | 4 |
| S9: durability | `synchronous = FULL` in D102; P6-H8's invariant | 4, D102, P6-H8 |
| S10: static files beside secrets | `<data>/public/site`; `serveSite` with `realpath` and refusals; P6-H1's cases | 3.5, 4, P6-H1 |
| S11: the desktop's IPC | No `core:*`; Rust menus; the main webview only, `local: true`; no updater JavaScript permission; no insecure transport; frames' `invoke` refused in P6-D4 | 10.2, 10.6, P6-D4, P6-D5 |
| S12: the image's healthcheck and secrets | `loam-host health` with SNI and `Host`; Kubernetes `defaultMode: 0400` and `runAsUser: 10001`; `[tls]` or a sidecar | 3.8, 11.2 |
| S13: bearers in `mounts.json` | `loam-host` never passes `mountsOut`; P6-H7 asserts no such file | 3.3, 13, P6-H7 |
| G1: `startDevHost` for P3-H1 to H5 | `resources`, `accessTokenTtlSeconds`, `env`; the client metadata document by a `HostModule` fixture; the dev certificate trusted by the provider's fetch | 5.2 |
| G2: `SqliteAdapter` on `DataAdapter` | One `records` table, `queryRows`, `BEGIN IMMEDIATE`; `local-db`'s `entry.test.ts`; Node 22.13 | 4 |
| G3: keep M1 minimal | The card, catalog, guide and P6-E6 to step 10, with P6-H11; P6-M1 to step 8 (M2) | 1.1, 11.5, 19, 20 |
| G4: exit rows | P6-E9 in step 5 at Budget, Chromium and Hosted; P6-E7 and its step in step 0a; E1's `stdio` case into P6-D2, and the closing rule stated | 19, 20 |
| G5: P6-H7 after `close()` | `scanSecrets` inside H3 to H6; H7 on one host before `close()` | 5.2, 19 |
| G6: wiring | `openssl` in `suites.mjs`; the `OCI image` job's trigger, gate, tool and row; `loam-desktop.yml`'s remote legs, tools, timeouts and shared-machine rule; the repository contract's exception; `.gitignore` | 2, 10.7, 11.2, 20 |
| G7: the openssl command | The full command with `-nodes`, `-keyout`, `-out` | 5.1 |
| G8: first paint | `SHELL_EXPOSE` unchanged; `HOSTED_MCP_COMMANDS` applied in `loam-host`; `late` +150 only | 2, 7, 14 |
| G9: section 6 | `server-call.ts`'s mapping; `REQUEST_INVALID` for a workspace mismatch; `reason: 'session'`; 6.1's wording | 6.1, 6.2, 6.3 |
| G10: P6-H5 | `workspace-app-set` and `agent-member-add` land in `loam.sqlite` | 19 |
| G11: section 16 | The relay codes, `AGENT_CANNOT_SIGN_IN`, `UNAUTHORIZED`, bootstrap's `DEPLOYMENT_IDENTITY_INVALID`, `doctor`'s `IDENTITY_BINDING_MISMATCH`, `504`, `413`, `502`, row 2's `403` | 16 |
| G12: the desktop's CSP and IPC | `--host desktop` writes the sources; the `loam` protocol with D74 and traversal refused; the Rust transport with `reqwest`, `Mcp-Session-Id`, line-framed stdio and notifications as events; the Windows ACL | 10.2, 10.3, 10.4 |
| G13: follow-ups now | Two issue texts prepared, filed at approval; the phase 5 one noted in STATUS.md; the Umbel card note in Umbel's R11 | Follow-ups, STATUS.md, Umbel's trajectory |
| G14: `pnpm deploy` | `--legacy` | 11.2 |
| G15: headers on `RESPONSE_ALREADY_SENT` routes | `outgoing.setHeader` first; P6-H4 and P6-H6 | 3.5, 3.6 |
| Q1 and Q2 | Q1 in three options; Q2 kept, saying the card shows the workspace's name; Q3 dropped by the coordinator | Questions |
| Nits | `ModulePrincipal` and `callAs` in place of a raw kernel; `no-store` on the four routes; dev's `.gitignore`, modes, section 13's exception and the bin's imports; no version in the card; the OpenID row dropped, Better Auth serving it under its path; section 17's D54 note; A5's journal reading; `doctor` read-only; 5.3's proofs; `openShell`'s signature and each kernel's `host`; stage B before `mcpOptions()`; `SHELL_EXPOSE`'s lines; "Hono 4.13" in D101 with the pins in a table; `identity.path`'s segment reserved; P6-H1 and H2 on version 4 from step 3; 1.7.19's time; 6.3's notice; D100's reason and the owner's say | Throughout |

### Re-check 2026-11-09

A focused re-check of `45bd2fcd` confirmed most of the first round, including every route through the relay that B1 named, and found the following; each is answered in this revision:

| Finding | Fix | Where |
| --- | --- | --- |
| B-a: methods with no scope were decided by `unlistedProject` with no slug, which refuses whenever `entry.projects` is set (`mounted.ts:292-308`), so a team instance could not be discovered | Discovery (`initialize`, `notifications/*`, `ping`, the session `DELETE`, `afd-help`, `afd-detail`) is decided at workspace level: membership, then at least one listed project passing `decideAccess`; `unlistedProject` with a slug applies only to a `tools/call`'s effective command; P6-E5 and P6-H6 cases | 8.1 step 6 |
| B-b: an instance's error body could pose as the relay's (`401 UNAUTHORIZED` triggering a refresh; its words in the kernel's message), and `failureOf` accepts only the closed `MountFailureCode` set | The relay's own refusals carry `Loam-Relay-Refusal: 1`, outside the forwarded allow-list; `mount.ts` reads a body's code only under it, and a 401 refreshes only under it; `MountFailureCode`, `CODES` and `MOUNT_FAILURES` gain the relay's codes with the kernel's own messages, and a body's `message` is never read; P6-E5 and P6-H6's posing instance | 8.1, 2, P6-E5, P6-H6 |
| 1: exposure recomputed from annotations | The relay keeps `discoverInstance`'s `InstanceCatalogV1` and decides by the command whose `tool` matches and its computed `expose`; no match (`callable: false` is never in it) refuses; never recomputed. The catalog also refuses `afd-call` naming `afd-context-enter`, `afd-call` or `AFD-BATCH`, now P6-E5 cases | 8.1 step 6, 8.2 |
| 2: the effective scope's edges | `null` or missing is absent, as AFD reads it, otherwise equal JSON; only `dev.loam/scope`, `progressToken` and `dev.afd/outputBudget` forwarded in `_meta`, only `dev.loam/scope` in `meta`; `afd-call` with no or a non-string `command` is `REQUEST_INVALID` | 8.1 5b, step 6 |
| 3: limits after the status is sent | The stream is aborted, reported as `MOUNT_RESULT_INVALID` or `MOUNT_UNREACHABLE`; `502` and `504` only before headers; P6-H6 | 8.1 step 8 |
| 4: the dev origin across runs | `dev.json` records and reuses the ports; `bootstrap --dev` reads it, or creates the certificate, secret and ports on an empty directory; `restart()` keeps them; `HOST_PORT_TAKEN`. **Deviation, stated:** P6-H1 runs from step 2, before any provider, so it asserts the same origin after a restart, and the passkey sign-in after a restart is in P6-H3 (step 3) | 3.7, 5.1, 5.2, 16, P6-H1, P6-H3 |
| 5: rows closing before their code | `/organization/leave` and `member-leave`'s cases from P6-H3 to P6-H5 (step 5); `--host desktop`'s CSP from P6-E1 to P6-D1 | 19 |
| 6: the exit check's third run | `--phase 6` takes a third id for `loam-desktop.yml`, and `WORKFLOWS.desktop` is read only without `--milestone`; M1 and phases 2 and 3 take two ids | 19 |
| 7: what keeps frames from `invoke` | Named: the frames' `connect-src` holds no IPC source, and Tauri's IPC script and invoke key are in the main frame only; a webview label cannot tell frames apart. If P6-D4 fails, an origin check in each Rust command, by amendment | 10.2 |
| 8: reqwest's features | `default-features = false, features = ["rustls", "stream", "http2"]` | 2, 10.4 |
| Nit: the meta-tool predicate | `isMetaTool` exported from `/mounted`; refused by it and by `afd-core`'s `isAfdBuiltinName` | 8.1, 2 |
| Nit: the subpath's reason | `mounted.ts` is already in the browser graph; the subpath keeps the relay off the root's other modules | 8.2 |
| Nit: `tools/list` | Dropped: five methods | 8.1 5a, A3, D105, 17 |
| Nit: server-to-client requests | An event holding a JSON-RPC array is dropped too; a forwarded `initialize`'s `capabilities` replaced with `{}` | 8.1 |
| Nit: the leave path's settle | `onMemberRemoved`, the one callback `createLoamAuthOptions` takes from the host, runs once per removal on either path | 3.7, A4, A8 |
| Nit: the lock | The rollback journal, never WAL, a busy timeout of 0; `SQLITE_BUSY` on the first statement | 4 |
| Nit: the certificate | With `[sandbox]` on the same `listen`, the certificate names both hosts | 3.2 |
| Nit: phase 3's step 10 | Its "the check gains the hosted job" is done by phase 6's step 2, noted in the amendments | Amendments |

### Relay re-check 2026-11-09

A relay re-check of `64da28d8` confirmed B-a and B-b closed as designed, and found three more blockers in 8.1, all present since `45bd2fcd`, with one pattern: the relay still passed through fields the page sent and it never decided. **8.1 is restructured as parse, decide, rebuild:** the relay parses the message strictly, decides the effective command, input and scope, and forwards only a message it builds itself from those decisions. Every finding is answered:

| Finding | Fix | Where |
| --- | --- | --- |
| B1: AFD's `grouped` strategy (`createMcpServer`'s default, `server.ts:65`, `:280`) routes `tools/call notes { action: "delete" }` to a hidden `notes-delete` (`tool-router.ts:417-472`, `command-routing.ts:20-23`); the Rust crate groups the same way | Any name but `afd-call` must equal the `tool` of a catalog command with `firstClass: true`; `afd-help` and `afd-detail` by exact name only; a non-string `params.name` is `REQUEST_INVALID`; a `grouped` fixture in P6-E5 and P6-H6 | 8.1 steps 7, 9 |
| B2: the relay read scope from a first-class tool's `arguments.meta`, which AFD never lifts (`meta-argument.ts:65`), so it decided at A while the instance ran at workspace level | `arguments.meta` read only for `afd-call` and `afd-detail`; the forwarded message carries only the decided scope in `params._meta["dev.loam/scope"]`, or none; `afd-call`'s `meta` deleted; a first-class tool's `arguments` pass through but for the pin; the scenario in P6-E5 and P6-H6 | 8.1 steps 8, 12, 13 |
| B3: `server/discover`, the SDK's first request in `mode: 'auto'` (`mount.ts:47`), was refused, and 5b dropped the modern envelope's keys | `server/discover` forwarded, decided at workspace level: six methods (A3, D105, section 17); `io.modelcontextprotocol/protocolVersion` and `clientInfo` kept, `clientCapabilities` replaced with `{}`, every other `io.modelcontextprotocol/*` key and the trace-context keys dropped; P6-H6 compares the era with the test-only relay's | 8.1 steps 6, 7, 13 |
| S1: `mount.ts`'s mechanics | `boundedFetch` reads the header and at most 4 KiB, a code outside `CODES` is `MOUNT_UNREACHABLE`; `Failure` widened; `refusalOf` passes a `MountRefusal` through from its `cause` chain; `refreshSession()` named, shared with `server-call.ts`; what the failed call returns for `UNAUTHORIZED`, `AGENT_CANNOT_SIGN_IN` and `REQUEST_NOT_SAME_ORIGIN`; the codes join `LoamKernelErrorCode` | 8.1's last part, 2, 6.1 |
| S2: project ids and slugs | The slug of the server's `ProjectV1` whose `id` is `scope.project`, passed to `unlistedProject` and `pinMountedInput(entry, { project: slug }, …)`; scope parsed with the kernel's strict `SCOPE_V1`, exported from `/mounted` | 8.1 steps 8, 11 |
| S3: scope on messages decided at workspace level | "Carrying a scope" is step 8's result, `afd-detail`'s `arguments.meta` included; every such message is forwarded with no scope | 8.1 step 10 |
| S4: the rebuilt message | The relay's own `{ jsonrpc, id, method, params }`; `tools/call`'s `params` only `{ name, arguments, _meta }` (`params.task` dropped); `afd-call`'s `arguments` only `{ command, input }`; `Mcp-Method`, `Mcp-Name` and `MCP-Protocol-Version` set from the rebuilt message, the legacy version from the session's binding | 8.1 steps 12 to 14, 16 |
| S5: the OAuth pages' CSP asserted before the pages exist | P6-H3 named in step 4 too, where that case closes; 5.3 item 1 reads "Steps 1, 3, 4" | 5.3, 20 |
| S6: step order | Step 6 after step 5; P6-H7 named in both, closing in step 6 | 20 |
| Nit: the response's allow-list | Only status, `Content-Type` and `Mcp-Session-Id` pass back | 8.1 step 15 |
| Nit: `mounted.ts:62` | `:61` | 8.1 |
| Nit: `MOUNT_SESSION_UNKNOWN` in 16 against step 7 | Both say the call fails, retryable, and the next call reconnects | 8.1 step 16, 16 |
| Nit: `--port` against `dev.json`; a view app added later | `HOST_DEV_PORT_CHANGED`; a free sandbox port added to `dev.json` with the shell's origin unchanged | 5.1, 16 |
| Nit: the desktop run's commit | It must share the other two runs' `headSha` (`loam-exit-check.mjs:289-292`) | 19 |

**Checked against the code, with nothing to correct:** `server.ts:65` and `:280`, `tool-router.ts:417-425`, `command-routing.ts:18-24`, `meta-argument.ts:60-67`, `mount.ts:44-56`, `mounted.ts:59-63`, `:261-264` and `:679-684`, `scope/field.ts:16`, and the `io.modelcontextprotocol/*` keys in AFD's server and client. AFD itself puts no trace keys in `_meta`; "the trace keys" are read as W3C trace context, `traceparent` and `tracestate`, dropped with every other key 8.1 does not name.

### Relay re-check 2 2026-11-09

An adversarial re-check of `3e9a2f26` found that parse, decide, rebuild closes the last round's three blockers, with no new route around it across TypeScript's, Rust's and Python's routing. It found two fail-open gaps in step 11, and that step 15 onward was still partly a deny-list. Every finding is answered:

| Finding | Fix | Where |
| --- | --- | --- |
| B1: a scope-less `tools/call` could skip `unlistedProject` if it were gated on `scope?.project`, reaching a team instance at workspace level | 11.0, "No scope": membership, no slug, `unlistedProject(entry, undefined, …)`, `pinMountedInput(entry, null, …)`, as `mounted.ts:640-652` and `:300` do; 11.3 applies to every command call, with or without a slug; P6-E5 and P6-H6 cases | 8.1 step 11 |
| B2: the pin failed open when the schema hid `space` from the top level (`mounted.ts:266-267`, `:405-407`) | 11.4 fails closed: in a pinned project, a schema without a top-level `space` and an input carrying `space` or `spaces` at any depth, or a schema with `allOf`, `anyOf`, `oneOf` or `$ref` at its root, is `MOUNT_SPACE_PINNED`; P6-E5 cases | 8.1 step 11, 17, A3 |
| 1: `dev.afd/outputBudget` | Dropped: the kernel never sends it | 8.1 steps 7, 13 |
| 2: `confirm` on first-class tools | A top-level `confirm` dropped unless the schema declares it, since AFD reads `confirm: true` as acknowledgement (`tool-router.ts:508-509`); `afd-call`'s reason corrected; a P6-E5 case | 8.1 step 12 |
| 3: session binding | `Mcp-Session-Id` bound and passed back only on a legacy `initialize`'s answer; already bound to another person is `502`; at most 4 bindings per person and instance, idle-expired, the evicted one `DELETE`d upstream; an upstream `404` drops the binding | 8.1 step 16 |
| 4: responses by allow-list | Only `application/json` or `text/event-stream`; one JSON-RPC response per JSON body; each event one notification or response, re-serialized; any other event dropped, any other body `502`; redirects `502` | 8.1 step 15 |
| 5: a tool result's error code | A new last row: the instance's code, labelled `untrusted` with `dev.loam/instance`, nothing refreshed or closed (`parseMountedResult`, `mounted.ts:174-202`); section 17 says the header rules are the HTTP layer's; a P6-E5 case | 8.1, 17 |
| 6: reconnecting after `MOUNT_SESSION_UNKNOWN` | `mount.ts`'s `request` calls `transport.connect()` before sending when it closed for it; in section 2's web row | 8.1 step 16, 2 |
| 7: P6-H6's fixture is stateless | A stateful, legacy-only fixture on the SDK's Streamable HTTP server transport for step 16's rows; the modern discovery case reads `server/discover`, `afd-help` and `afd-detail` | 19 |
| 8: header spoofing, tested | P6-H6: an instance's `403 {"code":"MOUNT_SPACE_PINNED"}` with `Loam-Relay-Refusal: 1`, `Set-Cookie` and `Retry-After` gives `MOUNT_UNAUTHORIZED`, none of the headers reaching the page | 19 |
| 9: ids | A request's `id` a string or a safe integer, a notification none, `notifications/cancelled`'s `requestId` the same type, else `REQUEST_INVALID`; P6-E5 cases | 8.1 steps 6, 7 |
| 10: the upstream URL | Sent to the entry's `url` exactly; a path after `mcp`, a query or a fragment is `INSTANCE_UNKNOWN` (`http-handler.ts:286-302`, `:439-447`) | 8.1 steps 1, 12 |
| Nit: stale references | 8.2 to steps 9 and 11; P6-E5 to steps 12 and 13; "implementation step 6 (section 20)" | 8.1, 8.2, 19 |
| Nit: A3's wording | "every other AFD built-in or AFD-like tool name" | A3 |
| Nit: step 2 | "6.2's first row's `Origin` and `Sec-Fetch-Site` checks" | 8.1 step 2 |
| Nit: step 8 | Each scope parsed with `SCOPE_V1` before comparing; nesting bounded at parse by `DISCOVERY_LIMITS.depth`, `400` | 8.1 steps 5, 8 |
| Nit: step 13 | `ping` and `notifications/cancelled` take `{ _meta }` when a modern envelope is built | 8.1 step 12 |
| Nit: step 12 | `afd-help`'s `{ filter?, format? }` and `afd-detail`'s `{ command }` (a string or at most 10) rebuilt from their schemas | 8.1 step 12 |
| Nit: step 14 | "No header from the page"; the HTTP client's own headers are the client's | 8.1 step 14 |
| Nit: a stateless legacy instance | `MCP-Protocol-Version` from the page's header when it is one of the client SDK's `SUPPORTED_PROTOCOL_VERSIONS`, none otherwise | 8.1 step 14 |
| Nit: aborts | An aborted page request aborts its upstream request and frees its slot | 8.1 step 15 |
| Nit: 8.4 | Refusals before step 3, with no actor, are counted, not journaled | 8.4 |
| Nit: first-class tools | `firstClass` honoured only when the catalog's `toolStrategy` is `'hybrid'` | 8.1 step 9, 8.2 |

**Checked against the code, with nothing to correct:** `mounted.ts:640-653`, `:263-268`, `:296-301`, `:172-182`; `tool-router.ts:505-511`; `afd-help`'s input schema (`bootstrap/afd-help.ts:16-19`); `afd-detail`'s (`meta-tools.ts:145-152`, a string or an array); `SUPPORTED_PROTOCOL_VERSIONS` exported by `@modelcontextprotocol/client`; and no `outputBudget` anywhere in the kernel or the web host.

### Relay re-check 3 2026-11-09

Relay re-check 3 of `87758b5d` confirmed the last round's B1 and B2 closed, and found one new blocker that round's response allow-list introduced. Every finding is answered:

| Finding | Fix | Where |
| --- | --- | --- |
| B1: step 15 refused every answer that was not a `200` carrying a JSON-RPC message, so a notification's empty `202` (`http-handler.ts:272-275`) and the session `DELETE` became `502`, an instance's `4xx` body became `MOUNT_UNREACHABLE`, and the SDK's era probe lost the `4xx` JSON-RPC error it falls back on | Step 15 decides **by status**: a `3xx` is `502`; an empty `2xx` passes with its status and no `Content-Type`; a `200` with a body follows the media-type and message rules; any other status passes with at most one JSON-RPC error, re-serialized, and any other body replaced by none; a JSON body read whole up to the limit before the status. P6-H6: a notification's `202`, a `DELETE`'s empty `200`, and a legacy instance's `4xx` to `server/discover` falling back | 8.1 step 15, 19 |
| S1: the pin in 11.4 | An allow-list after `pinMountedInput`: any `space` or `spaces` key ignoring case at any depth but the pin's own, and any root schema keyword outside `type`, `properties`, `required`, `additionalProperties`, `title`, `description`, `$schema`, `$defs`, `examples` and `default`, is `MOUNT_SPACE_PINNED`; a command whose input is a discriminated union cannot be called in a pinned project; P6-E5's `target.space`, `Space` and root `if`/`then` | 8.1 step 11 |
| S2: a declared `confirm` still acknowledges (`tool-router.ts:507-508`) | A first-class call whose schema declares `confirm` is forwarded as `afd-call { command: tool, input: arguments }`, since `afd-call` reads only its own top-level `confirm` (`:238`, `:276`); P6-E5 | 8.1 step 12 |
| S3: an answer bound to its request | A response's `id` must equal the forwarded request's; a stream carries at most one response and ends after it; notifications before it pass | 8.1 step 15 |
| S4: cancellation | `notifications/cancelled` is never forwarded; for this person's in-flight request through this relay, this instance and the same binding, the relay aborts its own upstream request; the page gets `202` either way; six accepted, five forwarded (A3, D105, section 17) | 8.1 steps 6, 17 |
| S5: step 16's open decisions | `relay_session_idle_ms`, default 900,000; eviction of the least recently used binding with nothing in flight, `429` when all four are busy; a `DELETE` for an unknown, evicted or foreign id `204` with the same bytes and nothing forwarded; `initialize` forwarded with no `Mcp-Session-Id`; bindings in memory, recovered through `MOUNT_SESSION_UNKNOWN` after a restart | 3.2, 8.1 steps 14, 16 |
| N1: step 15's parsing | The media type's parameters ignored, a non-`utf-8` `charset` refused, the bare type passed; `TextDecoder`; WHATWG event-stream parsing, multi-line `data:` joined, `id:`, `retry:`, comments and a non-`message` event dropped | 8.1 step 15 |
| N2: `Accept-Encoding: identity` | Sent, so the limit and `Content-Length` count the same bytes | 8.1 step 14 |
| N3: line references | `mounted.ts:268` and `:406-408` | 8.1 step 11 |
| N4: `afd-call`'s `arguments.input` | Not an object: `REQUEST_INVALID` | 8.1 step 9 |
| N5: `firstClass` under `hybrid` in the kernel | `discoverInstance` sets it only under `hybrid`, as the relay reads it (today `mounted.ts:680` ignores the strategy); section 2's kernel row and P6-E5 | 2, 8.2, 19 |
| N6: a pin with no `projects` | `app check` warns, since such an instance also serves workspace-level calls, which no pin covers | 8.3 |

**Checked against the code, with nothing to correct:** `http-handler.ts:270-276` (a notification's `202` with no body), `tool-router.ts:236-238` and `:274-277` (`afd-call`'s own `confirm`), and `mounted.ts:266-268`, `:405-408` and `:678-682`.

### Relay re-check 4 2026-11-09

Relay re-check 4 of `ce5c82ed` called the specification approvable: no blocker, no bypass, and the handshakes working end to end in both eras. Its three should-fix items and six nits are applied as worded, each checked against the code:

| Finding | Fix | Where |
| --- | --- | --- |
| 1: the page never sends a session `DELETE`: SDK 2.4.0's `close()` does not call `terminateSession()` (client `dist/index.mjs:1677-1685`, `:1823`) | An idle binding is `DELETE`d upstream when it expires, as when evicted; A1's reason rewritten; P6-H6's `DELETE` sent by the test with `fetch`, and an idle binding's upstream `DELETE` at `relay_session_idle_ms`; implementation step 6 corrects `mount.ts:148-155`'s comment | 8.1 step 16, A1, Status, 19, 20 |
| 2: step 17 with no binding | It aborts nothing with no binding; the page's own abort ends the upstream request; `202` either way; no concurrency slot held; P6-H6's case on the stateful fixture | 8.1 step 17, 19 |
| 3: a schema declaring `space` elsewhere | A schema that declares `space` or `spaces`, ignoring case, anywhere but the top-level `properties.space` and `properties.spaces`, under `properties`, `patternProperties`, `$defs` or `definitions` at any depth, is `MOUNT_SPACE_PINNED`; P6-E5's `properties.target.properties.space` and top-level `spaces`, the input leaving the field out | 8.1 step 11 |
| Nit: step 12's table | The two rows indented to render inside item 12 | 8.1 step 12 |
| Nit: `definitions` | Allowed beside `$defs` at the root, since AFD's `zodToJsonSchema` targets draft-7 (`json-schema.ts:36`) | 8.1 step 11 |
| Nit: step 15, any other status | The error's `id` the request's or `null`; `Content-Type: application/json` on any body the relay re-serializes | 8.1 step 15 |
| Nit: step 15, parsing | `charset` compared ignoring case and quotes | 8.1 step 15 |
| Nit: line references | N5's flag at `mounted.ts:435-437` and `:545`; step 9's `:680-682` | 2, 8.1 step 9 |
| Nit: P6-E5's list | `params.inputResponses`, `params.requestState` and `_meta["dev.afd/confirm"]` never reach the instance | 19 |
| Owner questions | Q1 blocks steps 9 to 12, and Q2 step 10's card, catalog and guide; neither blocks the approval, as in phase 3 | Questions |

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-09 | Phase 6 specification | An OAuth client in the AFD CLI (authorization code with a loopback redirect and PKCE), so the CLI can reach a hosted server and `expose.cli` can follow `expose.mcp` | Filed as [#912](https://github.com/lushly-dev/afd/issues/912) on 2026-11-09 |
| 2026-11-09 | Phase 6 specification | Where the copilot runs relative to a person's data before the collaboration service: on the server it sees the server's records, not the person's documents (section 7); in a browser worker, its trust-record writes are `HUMAN_REQUIRED` in a hosted `provider` deployment (A6), so it changes projects only over MCP as a connected agent | Filed as [#913](https://github.com/lushly-dev/afd/issues/913) on 2026-11-09; noted in STATUS.md for phase 5 |
| 2026-11-09 | Phase 6 specification | A browser MCP client on another origin cannot use `<base>mcp`, which serves no CORS (3.6). Decide whether a deployer may list client origins | Open |
| 2026-11-09 | Phase 6 specification | Postgres, and a second server process, when a measurement or consumer asks (section 4) | Open |
| 2026-11-09 | Phase 6 specification | Automated backups of `loam.sqlite` and `auth.sqlite` | Open |
| 2026-11-10 | Phase 6 step 2 | The development profile binds the shell and the sandbox on `127.0.0.1` only. `[::1]` is not checked for `HOST_PORT_TAKEN`, and a browser may resolve `localhost` to it: decide whether `dev` also binds, or refuses, `[::1]:<port>` | Open |
| 2026-11-09 | Phase 6 step 1 | Build 3.2's Windows ACL check for secret files, the TLS key and the data directory, before any Windows host or the desktop lane depends on secrets; until then `HOST_SECRET_PERMISSIONS` refuses everything on Windows | Open |
| 2026-11-09 | Phase 6 specification | Joining a hosted workspace from the desktop, with a passkey story for a webview (10.1) | Open |
| 2026-11-09 | Phase 6 specification | Check that Loam's server card and Umbel's (its phase 7) use the extension's fields the same way (11.5) | Recorded in Umbel's R11 |
| 2026-11-09 | Phase 6 specification | [#858](https://github.com/lushly-dev/afd/issues/858), first paint on a real low-end device, is easier over the development profile but still needs a device | Open |
