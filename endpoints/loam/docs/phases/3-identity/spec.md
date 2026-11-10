# Phase 3 specification: identity

| Field | Value |
| --- | --- |
| Phase | 3, identity ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 3 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.3, 3.4, 4.1, 4.3 and 9.1 above all), the [documents specification](../2-documents/spec.md), the [architecture](../../architecture.md), the [decision log](../../decisions.md), [`spec/authorization.md`](../../../../../spec/authorization.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-09 by the design sub-agent; revised the same day after two independent reviews, a trust and security review and a general review, each of whose findings is answered in [Review 2026-11-09](#review-2026-11-09); an independent re-check of `a08572ea` found four blockers and fourteen should-fix items, answered there too, from Better Auth 1.7.18's published passkey and OAuth provider packages; a second, focused re-check of `cfabbb2d` found one blocker, ten should-fix items and six nits; and a third, of `d20ae2fd`, found two trust-boundary blockers, six should-fix items and nine nits, after which the reviewer called it approvable. Each round is recorded in the Review section. **The coordinator approved the first-paint allowances (3,900 bytes, 1,600 gzip) on 2026-11-09.** **Approved by the coordinator on 2026-11-09**, at `27028680`, under the owner's standing grant, after the third re-check. D84 to D94 are decided with that approval; D87 and D90 stay subject to the owner's answers to Q2 and Q4, which block only the steps that build them. **Six questions were asked of the owner on 2026-11-09. The owner answered four the same day** (Q1, Q3, Q5's recovery and Q6), recorded here as owner decisions D95 to D98; **Q2 and Q4 still await answers**, and the text is written to their recommendations, marking where an answer changes it ([Questions for the owner](#questions-for-the-owner)). The ways to sign in are the coordinator's decision of 2026-11-09, D99. Decisions D84 to D94 are in the [decision log](../../decisions.md). The coordinator decided the order relative to phase 6 as [10.3](#103-the-order-recommended-for-the-coordinator-to-decide) recommends: phase 3 starts now, phase 6's specification is written next with its hosted lane first, and step 10 waits for that lane's development profile.
- **Last verified:** 2026-11-09 against `main` at `4eee0af8`, from this evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `kernel.ts:325-329` (the chain: afd-auth's middleware with every held command excluded, so nothing needs a session; the journal; scope), `:330-353` (both registries and the boot registry share it), `:509-511` (`runAs`: a port's and a nested call run on the `palette` registry with only `KernelCallFields`), `:89-94` (`UNJOURNALED_COMMANDS`), `:113-119` (`redactJournalRecord`), `:768-774` (`resetSession`);
    - `context-fields.ts:12-20` (the six declared fields), `:23-30` (`KernelCallFields`: `caller`, `parent`, `scope`, no actor);
    - `apps/port.ts:128-171` (`checkedCall` builds `KernelCallFields` and calls `host.runAs`; no actor travels);
    - `scope/access.ts:10`, `:21-22`, `:28-34` (`LOCAL_ACTOR`, `actorKey`, `decideAccess`); `scope/middleware.ts:64-72` (`sessionActor`);
    - `commands.ts:23-40` (`BOOT_ONLY`, `INTERNAL_COMMANDS`); `late/index.ts:66-74` (`PERSON_SESSION`), `:315-357` (`mcpOptions`: the kernel's own chain, afd-auth's middleware first, so a server's call takes the actor of whoever the kernel's adapter has signed in); `session.ts:190` (`SESSION_50`);
    - `types.ts:279` (`APP_CALLABLE_SHELL_COMMANDS_V1`).
  - **Manifest:** `schemas/app-manifest.v2.json:63` (`unevaluatedProperties: false` on `ui`); `src/refusal-map.ts:108` (`/ui/account`: `later('ui.account', 3)`); `src/catalogs.ts:153` (`account` served from 3), `:195-235` (`SHELL_DOMAINS_V1` already holds `account`, `persona`, `session`, `agent`).
  - **Web host and chrome:** `web/src/host.ts:100` (a `MockAuthAdapter` per page); `chrome/src/elements/shell.ts:827-834` ("Sign in" calls `auth-sign-in` with the Mock's email); the chrome calls, by a scan of `chrome/src`, `app-*`, `appearance-get`, `auth-*`, `document-*`, `editor-*`, `layout-get`, `layout-set`, `modal-open`, `new-list`, `overlay-*`, `palette-*`, `project-*`, `scope-*`, `section-*`, `toast-show` and `workspace-get`.
  - **AFD:** `packages/auth/src/types.ts:33-49`, `:99-109`; `middleware.ts:38-44` (`actorForSession`: a human or absent actor becomes the session user, any other kind gains `onBehalfOf`, and it runs on every call, overwriting any actor a server set); `adapters/better-auth.ts`; `session-sync.ts`; `hosted/better-auth/` (Better Auth 1.7.14 on `node:sqlite`, outside the package's `files` and `exports`); `packages/server/src/server.ts:140,188`; `spec/authorization.md`'s implementation table (TypeScript "Planned" for M1 to M7); `spec/error-codes.md`'s package codes for auth.
  - **Better Auth 1.7.18, read from its published packages:** `@better-auth/oauth-provider`'s options (`loginPage`, `consentPage`, `accessTokenExpiresIn` default 3,600 s, `refreshTokenExpiresIn` default 30 days, `pairwiseSecret`, `allowDynamicClientRegistration`, `disableJwtPlugin`), its `/oauth2/delete-consent` endpoint, and its statement that JWT access tokens "are self-contained and cannot be revoked server-side"; `@better-auth/passkey`'s `registration.requireSession` and `resolveUser`, `attestation: "none"` by default; `@better-auth/cimd` 1.7.18; `better-auth`'s organization errors `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER` and `YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER`.
  - **Issues:** #852, #853, #854 and #864, each answered in [Carried](#carried-from-phase-2-answered-here); the rest of #851 to #889 name no phase 3 work.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-09. A browser bundle of Better Auth 1.7.18's client with its organization and passkey plugins measured 54,636 bytes minified, 18,137 gzip; with the organization plugin alone 42,128 and 14,714 (esbuild 0.28.2, 2026-11-09).
- **Done:** this specification and its revisions after two reviews and three re-checks; the coordinator's approval of the first-paint allowances, and of the whole on 2026-11-09.
- **Step 0b** (AFD: afd-auth's passkey method, capabilities and the credentials backstop): in review in [#896](https://github.com/lushly-dev/afd/pull/896), 2026-11-09. 4.1 is built on Better Auth 1.7.18 with `@better-auth/passkey` 1.7.18 pinned, the hosted fixture moved to 1.7.18, and `spec/error-codes.md` gains the two passkey codes. Two coordinator amendments of 2026-11-09 are recorded in 4.1: the middleware reads `isVerifiedCredentials` from its options, and the Mock's capabilities are `withMockCapabilities` in `@lushly-dev/afd-auth/mock-capabilities`. Section 13 gains 0b's measured row, +802 and +301, approved after the review round. An independent review at `1a67b366` found no blockers; its five improvements and nits are fixed (4.1's third amendment, the 0a row). After the review round, `pnpm verify` passed every leg (`pnpm check`, `pnpm test:hosted:local`, loam-web `budget`, the walk, mounted, Specimen, conformance, Alfred) but loam-web's Chromium suite, whose one failure, P2-D8's A-B2, timed out at 30 s under load and passed in four of five reruns of its file.
- **Step 1** (identity core): in review in [#919](https://github.com/lushly-dev/afd/pull/919), 2026-11-09, on `main` at `eba33efa`. Built: `@lushly-dev/loam-identity` (private, quarantined, server side only) with `createLoamAuthOptions`, `loamServerPlugin` (`whoami`, the binding pinned by id, the hooks of 7.5) and `startTestAuthHost`, a real Better Auth 1.7.18 provider in a child process, which proves no hosted lane; deployment and projection version 3 with `[identity]`, `DEPLOYMENT_IDENTITY_INVALID` and `DEPLOYMENT_STDIO_TEAM` (D95); `decideAccess` version 2, `MembershipV1`, `personKey`, `isOwner`, line 0 and the auth gate's lists (with `AGENT_CANNOT_SIGN_IN`); `KernelCallFields.actor`, copied on every port, nested and refusal path; the agent interface's actor and `AGENT_NAME_RESERVED`; `personalRecordId` and the per-person view-state records of `provider` mode; the `persona` and `agent-member` tables; kernel interface version 3; `member` among the shell's domains; the architecture's amendments; `loam.yml`'s "AFD's identity path" step, which runs afd-server's `verified-credentials.test.ts` until steps 0a and 0c add their suites, and afd-auth's suite. Units: P3-E5's, E6's and E7's so far, E13, E19's, in `kernel/src/scope/identity.test.ts`, `identity/src/*.test.ts` and `manifest/src/identity.test.ts`. `call-scope.test.ts` needs no row: step 1 adds no shell command. Q2 and Q4 change no step 1 code.
  - **Gates, 2026-11-09:** `pnpm verify` (`pnpm check` over the whole workspace, since `scripts/affected/scope.mjs` changed, then Violet, FAST-AF, Specimen, the Health dashboard, `loam.yml`'s every step, auth-browser, `test:hosted:local`, Alfred and conformance) passed every leg but loam-web's Chromium suite, whose two failures were this step's to amend (below); its rerun passed 380 of 381, the one failure P2-D9's embed text race, #914, filed on `main`, which failed 1 of 3 isolated reruns. afd-auth's `refresh()` network test, #911, passed in every run. loam-web `budget` passes every row.
  - **First paint** 288,583 bytes and 89,185 gzip, +1,697 and +688 over 0b, within the coordinator's step 1 target of 1,700 and 750 (13); the kernel's row set to 114,364 and `apps` raised to 394,894, each approved by the coordinator 2026-11-09; `late` 70,597.
  - **2.1's amendments to E12, each listed:** `kernel.test.ts`'s shell info and `web/src/host.test.ts`'s version read kernel interface 3 and `identity`; `scope.test.ts`'s `decideAccess` units take `AccessInputV2`; two P2-E5 tests in `mcp-scope.test.ts` read a server's call as the page's person's, by `personKey` (a server's actor is an agent whose `onBehalfOf` afd-auth's middleware sets); the manifest's and the CLI's "version it does not read" cases use 4; `read-boot.test.ts` reads `identity`; `deployment check` adds `LOCAL_IDENTITY`; `member`'s id case; `SESSION_50`'s committed journal re-recorded (its calls unchanged; `shell-info-get` reads interface 3 with `identity`, and its 16 agent calls journal `shell-agent` with the person's `onBehalfOf`); the web tests and kernel fixtures typed `ProjectionV3`; a view's `hostInfo.version` in `apps/view.test.ts` reads `'3'`; and `boot.test.ts`'s failed `late` chunk now refuses the agent's `layout-get` (`LATE_COMMANDS_UNAVAILABLE`), since the agent interface waits for stage B, while the person's still runs. No phase 0 to 2 test called a human command through the agent interface.
  - **Deviations, each the robust choice:** (1) passkey registration keeps the plugin's own `requireSession` until step 3 sets it `false` with 5.8's hooks, so no build serves registration without its checks; (2) the kernel's clock reaches afd-auth's middleware with step 2's expiry timer, which gives the Mock the same clock: passing it alone compared the Mock's system-clock expiry with a test's stepping clock; (3) the first-paint `layout-*` check decides only a project's layout, since 2.1 makes workspace-level `layout-get` and `layout-set` signed-out commands; (4) `/organization/set-active` is in `disabledPaths` rather than refused by a hook, so nothing sets an active organization; (5) the owner-role check on `/organization/update-member-role` and `/remove-member` is a `loamServerPlugin` before-hook, since Better Auth's `beforeUpdateMemberRole` receives no caller; (6) `MEMBER_INVITATION_REQUIRED` added to 15; (7) a removed member's sessions go by `internalAdapter.deleteUserSessions`, 1.7.18's name for it, and step 3's `revoke-person` adds consents and refresh tokens; (8) the test host seeds through the database adapter until step 4's `bootstrapOrganization`, and takes no `resources` until step 7; (9) `createLoamAuthOptions` takes `workspace`, the binding's key; (10) a `path` whose first segment is the workspace's id is refused too, since its routes start there; (11) an `options.agent` off the pattern answers `AGENT_NAME_RESERVED`, the one code 3.1 names; (12) `withMockCapabilities` is not attached yet: no `late-identity` command exists until steps 2 to 4; (13) `KernelPortsV1.schedule` is optional until step 2 reads it; (14) the browser's projection validator stays version 2's, and `readProjection` checks a version 3 `identity` by hand, held equal to `projection.v3.json` by a test; (15) E13's scan of `web/src` and `chrome/src` is declared in `scripts/affected/scope.mjs`, so this change checks the whole workspace; (16) `app check` reads no deployment file, so `deployment check` alone gives the `local` notice.
- **Not done:** everything else it specifies but step 1; the owner's answers to Q2 and Q4.
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 5, scope is shell-level; 7, identity once; 8, agents are first-class users; 13, deterministic core; 15, AFD first; 19, live sessions revalidate when membership changes (its seam, not the service).
- **Decisions it depends on:** D4 (the active project narrows, never grants); D11 (identity once on `@lushly-dev/afd-auth`, Better Auth first, persona never a grant, the persona id in Loam's context fields); D15 (AFD first); D32 (single-tenant, workspaces bound to the provider's organizations); D36 (the hosted server on Hono, Better Auth among its routes); D40 (agent members: a human sponsor, installed by an owner, scoped to projects, not a seat, unable to sign in or administer; identities here, delegation in phase 5); D46 (membership epochs); D54 (native apps are trusted code); D55 and its consequence (phase 3 must restrict `project-create` for a slug a team instance lists, and such a project's members, to an owner); D56 (a `stdio` instance on the hosted server by the deployer's configuration, **narrowed by D95**, the owner's decision of 2026-11-09, to refuse one in a `provider`-mode workspace); D63 and D73 (`workspace-app-set`, which "phase 3 restricts to an owner"); D64 (a test-only stand-in, named as such wherever its result is recorded); D71 and D72 (scope, the order of a call, `applyScopeChange`); D77 and D83 (the ports). The architecture glossary's **Sponsor**: "the person accountable for an agent member and named in its `onBehalfOf`".
- **Decisions this specification records:** D84 to D94, decided with this specification's approval on 2026-11-09 (D87 and D90 subject to Q2 and Q4); D95 to D98, decided by the owner on 2026-11-09; D99, decided by the coordinator on 2026-11-09; all in [Amendments](#amendments-to-the-architecture-and-the-decision-log). The two open trust questions, Q2 and Q4, are in [Questions for the owner](#questions-for-the-owner), and the decisions that depend on them say so.

### Carried from phase 2, answered here

| Item | Answer |
| --- | --- |
| [#852](https://github.com/lushly-dev/afd/issues/852): `project-create` for a slug a team instance lists, and such a project's members, owner-only; `PROJECT_SLUG_TAKEN`'s leak; `workspace-app-set`'s role | [7.3](#73-projects-and-owners-852) and [7.4](#74-the-workspaces-apps). **The rule lands in the kernel in step 4, and #852 closes in step 10,** when the hosted server's kernel and the mount relay enforce it against the server's records ([2.5](#25-where-provider-mode-is-enforced)) |
| [#853](https://github.com/lushly-dev/afd/issues/853): identity over MCP | [Section 9](#9-over-mcp-and-the-hosted-token-layer-d91): a verified token's call runs as the agent member the token's client is, acting for the token's subject, never as whoever the kernel has signed in; no token, no call |
| [#854](https://github.com/lushly-dev/afd/issues/854): a session a provider ends with no command | [4.4](#44-hearing-the-adapter-d88): the kernel hears the adapter, and times a session's expiry on its own clock |
| [#864](https://github.com/lushly-dev/afd/issues/864): restricted names left after an expiry | The same: `session-settle`'s event makes every section re-read |
| Phase 2's 3.4: "Phase 3 changes `access` and the actor's source and not the order" | [3.3](#33-the-access-decision-version-2-d86) |
| Phase 2's 4.3: `PROJECT_MEMBER_SELF_REQUIRED`, "phase 3 replaces who may change this" | [7.3](#73-projects-and-owners-852) |
| Phase 2's 6.3 and STATUS: browser history keeps restricted slugs | [Section 16](#16-security) |
| Phase 0's and 1's "`redact` is where phase 3 extends" | [Section 11](#11-journal-replay-and-secrets) |
| Phase 1's surface catalog: `account`, `ui.account`, "Phase 3" | [5.5](#55-an-apps-account-section) |
| R10, the reserved `organization` | [2.3](#23-the-workspace-bound-to-an-organization) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-09 (sources S80 to S87 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 3 |
| --- | --- | --- | --- |
| W12 | Better Auth 1.4 stateless sessions; revocation delayed by the cookie cache (secondary sources) | Better Auth's page: "When `cookieCache` is enabled, revoked sessions may remain active on other devices until the cookie cache expires (`maxAge`)", with `disableCookieCache` to fetch from the database, and `listSessions`, `revokeSession`, `revokeOtherSessions`, `revokeSessions` [S80]. `better-auth` 1.7.18 on 2026-11-05, 1.8.0 in beta [S81] | Loam turns the cookie cache off ([4.3](#43-revocation-and-every-tab)), so the provider refuses a revoked session at once |
| New W31 | Not watched | `@better-auth/passkey` 1.7.18, on SimpleWebAuthn: `signIn.passkey` with `autoFill`, `addPasskey`, `listUserPasskeys`, `updatePasskey`, `deletePasskey`; passkey-first registration with `requireSession: false` and `resolveUser` [S81, S82] | Sign-in, enrolment from an invitation and the account's passkeys ([4.1](#41-the-adapter), [5.2](#52-passkeys), [5.6](#56-enrolment)) |
| New W32 | Not watched | WebAuthn Level 3, a W3C Recommendation of 2026-08-25, with the signal methods and related origins [S83] | A removed passkey is signalled where the method exists; related origins unused |
| R10 | Workspaces bound to provider organizations | The organization plugin: owner, admin and member roles; `allowUserToCreateOrganization`; `organizationHooks` before and after each change; `sendInvitationEmail`; `requireEmailVerificationOnInvitation`; a slug `updateOrganization` may change [S84]. Its documentation is silent on the last owner, but 1.7 refuses leaving as the only owner (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`, `…_WITHOUT_AN_OWNER`), read from its package | The binding pins the organization's id, not its slug ([2.3](#23-the-workspace-bound-to-an-organization)); Loam's rules are written into the provider's hooks ([7.5](#75-the-providers-own-endpoints)) |
| New W33 | MCP Authorization proposed in AFD | MCP 2026-07-28 requires audience validation and forbids passing tokens on, requires RFC 9728 metadata, and orders registration as pre-registration, Client ID Metadata Documents, then Dynamic Client Registration, which it deprecates [S85]. AFD's `spec/authorization.md` is implemented in Rust only. `@better-auth/oauth-provider` issues resource-bound JWTs (RFC 9068) with the JWT plugin, has consent pages, introspection and revocation, and says JWT access tokens cannot be revoked server-side; `@better-auth/cimd` adds Client ID Metadata Documents [S86] | AFD's TypeScript layer is built first; Better Auth issues the hosted server's tokens with short lifetimes ([section 9](#9-over-mcp-and-the-hosted-token-layer-d91)) |
| R14, W5 (Umbel) | Agent members on AFD's actor and `onBehalfOf`; agent identity drafts | The IETF's on-behalf-of draft for AI agents expired with no working group adoption; an OAuth working group interim's slides (dated 2026-05-31 by a secondary summary) group about seven delegation drafts and several identity drafts, all individual [S87]. Umbel's W5 unchanged since 2026-11-03 | Nothing standard to adopt. AFD's actor with `onBehalfOf` stays the wire form (D40), and an external agent is an agent member ([9.2](#92-the-hosted-principal-mapping)) |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and phase 2's. This specification adds:

| Term | Meaning |
| --- | --- |
| Identity mode | A deployment's `local` or `provider` ([2.1](#21-two-modes-d85)) |
| Provider | The deployment's identity provider: Better Auth, on the deployment's own origin, in `provider` mode |
| Person | A human with an account at the provider; an actor of kind `human` |
| Workspace member | A person who is a member of the organization the workspace is bound to, by id |
| Owner | A workspace member whose provider role makes them an owner ([7.1](#71-who-is-an-owner)) |
| A person's own agent | An agent acting for one person with that person's access and no more: the in-process agent interface, or a connected agent |
| Installed agent member | An agent member an owner added ([section 8](#8-agent-members-d90)); acts through phase 5's delegation |
| Connected agent | An agent member that is an external MCP client, sponsored by the person who connected it ([9.2](#92-the-hosted-principal-mapping)) |
| Owner command, human command | A command only an owner, or only a person at the shell, may run ([3.4](#34-the-trust-table)) |
| Person key | `personKey(actor)`: whom a call is for, a human's id or an agent's `onBehalfOf` |
| Session probe | First paint's one request for the session and membership, before the provider's client loads ([4.2](#42-first-paint-the-probe)) |
| Enforcement point | A place that holds the authoritative record and refuses a call: the provider, the hosted server's kernel, the mount relay ([2.5](#25-where-provider-mode-is-enforced)) |
| Test-only auth host | A real Better Auth server behind the test harness on the shell's origin, standing in for phase 6's hosted lane, as D64's relay does for mounts |

## 1. Units and repository placement

One new package, private and quarantined:

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/packages/identity/` | `@lushly-dev/loam-identity` | **Server side only.** `createLoamAuthOptions(config)`: Better Auth's options for a deployment ([2.6](#26-the-providers-configuration)); `loamServerPlugin`, Better Auth endpoints and hooks of Loam's own (`whoami`, `binding`, `revoke-person`, recovery, invitation tokens); `createMcpAuth(config)`, AFD's `auth` option for `createMcpHandler` ([9.3](#93-scopes)); `principalOf` ([9.2](#92-the-hosted-principal-mapping)); `createServerKernel`, `credentialsGate` and `principalGate` ([9.5](#95-the-server-kernel-and-its-chain)); `bootstrapOrganization` ([5.6](#56-enrolment)); and, under `/testing`, `startTestAuthHost()` ([2.4](#24-the-test-only-auth-host)) | `better-auth`, `@better-auth/passkey`, `@better-auth/oauth-provider`, `@better-auth/cimd`, all pinned to `1.7.18` together; `@lushly-dev/afd-server`, `@lushly-dev/afd-core`; dev: `@lushly-dev/loam-kernel`, `@lushly-dev/afd-client` |

It never reaches a browser: E13's scan refuses any import of it from `web/src`, `chrome/src` or `kernel/src`. The dependency runs one way, `identity` to `kernel` as a dev dependency, so **E8's test lives in `identity/src/`**, where it can import both. Phase 6's hosted lane imports `identity`.

| Package | Change |
| --- | --- |
| `kernel` | `decideAccess` version 2, `MembershipV1`, `personKey` and `isOwner` in `scope/` (first paint); the auth gate's lists; `KernelCallFields.actor`; `session-settle`, the expiry timer and the change-of-person rule; `late-identity`, a chunk of its own loaded inside `loadLate` beside `late-documents`, with every new command ([sections 4 to 8](#4-sessions)); the `persona` and `agent-member` tables; personal records per person ([4.5](#45-a-persons-records-per-actor)); kernel interface version 3 ([12](#12-the-kernel-and-the-sdk)) |
| `web` | `identity.ts` in first paint: the session probe and `DeferredAuthAdapter` ([4.2](#42-first-paint-the-probe)); the `auth` chunk with `BetterAuthAdapter` and `SessionSync`; the harness's `authHost` option, a virtual authenticator and the mail sink; `budget` rows |
| `chrome` | The signed-out main and the notices (first paint); `loam-sign-in-dialog` (`sign-in`); `loam-account-menu` (`account-menu`); `loam-account-section` and its tabs, the join and recovery pages, and the OAuth login and consent pages (`account`); persona emphasis in the rail and the palette's ranking |
| `manifest` | `deployment.v3.json` and `projection.v3.json` with `[identity]` ([2.2](#22-the-deployment-file-version-3)); `ui.account`'s schema and rule ([5.5](#55-an-apps-account-section)); `member` in `SHELL_DOMAINS_V1` |
| `sdk` | `actor?: Readonly<ActorV1>` on an app's handler context; `AccountSectionV1` ([12](#12-the-kernel-and-the-sdk)) |
| `cli` | `deployment write` and `check` read version 3 |
| `testing` | `createAppTestKernel` takes `actor` |
| `apps/hello` | One `ui.account` section, for E14 |

- **The test-only auth host is copied, not imported.** `packages/auth/hosted/better-auth` is outside `@lushly-dev/afd-auth`'s `files` and `exports`, and its server configures `genericOAuth` for a different question. `startTestAuthHost` is written in `identity/src/testing/` against `createLoamAuthOptions`, copying the child-process and scratch-cleanup shape of `hosted/better-auth/run.ts`, with a header naming the file and commit it came from. Exporting a shared fixture is a follow-up.
- **Release inventory.** One more entry, `loam-identity`, in phase 1's shape: `state: "quarantined"`, `routes: []`, `fixed: false`, `private: true`, `gates: ["pnpm check", "loam.yml", "release-approval"]`. Nothing publishes.
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names it, in step 1.
- **`loam.yml`.** The `Build, unit and Chromium` job's "Unit suites with coverage" step gains `@lushly-dev/loam-identity`; a new step, **"AFD's identity path"**, after "AFD's lean path", runs `packages/server`'s authorization suite and `packages/auth`'s suite with the verbose reporter, so the exit check can read their titles. The Chromium step starts the test-only auth host itself; Node 26's `node:sqlite` is there.
- **`AGENTS.md`.** The architecture tree gains `identity`, and the Loam key rule names the new step. Step 1 does it.
- **Changesets.** Steps 0a, 0b and 0c carry their own for `@lushly-dev/afd-server` and `@lushly-dev/afd-auth`. None for the private units.

## 2. The deployment's identity

### 2.1 Two modes (D85)

| | `local` | `provider` |
| --- | --- | --- |
| For | A personal store: the static shell, the desktop, a test | A team: one organization, one provider, on the deployment's origin |
| Adapter | `MockAuthAdapter`, as today | `DeferredAuthAdapter`, then `BetterAuthAdapter` ([4.2](#42-first-paint-the-probe)) |
| Signed out | Works, as `local`, as phases 0 to 2 do | Only the [signed-out commands](#signed-out-and-member-exempt-commands); main shows "Sign in" |
| `MembershipV1` | **Every actor is a member and an owner** | The bound organization's members, read from the provider ([2.3](#23-the-workspace-bound-to-an-organization)) |
| Default | Yes: a deployment with no `[identity]` | Only by `[identity] mode = "provider"` |

`app check` and `deployment check` say for `local`: "`local` identity: anyone with this browser profile is its owner", a notice.

#### Signed-out and member-exempt commands

In `provider` mode the kernel's auth middleware stops excluding every command (`kernel.ts:326`). It excludes, by name:

```ts
/** Run with no session in `provider` mode: every call the chrome makes on the signed-out main. */
export const SIGNED_OUT_COMMANDS = ['auth-sign-in', 'auth-sign-out', 'auth-session-get', 'shell-info-get',
	'appearance-get', 'appearance-set', 'layout-get', 'layout-set', 'palette-open', 'palette-close',
	'palette-search', 'overlay-list', 'overlay-dismiss', 'modal-open', 'toast-show', 'scope-get',
	'section-get', 'app-list', 'workspace-get'] as const;

/** Run with a session but no membership: a person's own account, sessions and invitations. */
export const MEMBER_EXEMPT_COMMANDS = ['account-get', 'account-update', 'account-passkey-list',
	'account-passkey-add', 'account-passkey-rename', 'account-passkey-remove', 'account-invitation-list',
	'account-invitation-accept', 'account-invitation-reject', 'session-list', 'session-revoke'] as const;
```

- **The kernel's own commands are exempt by name, from the gate and from line 0:** `INTERNAL_COMMANDS` (with `BOOT_ONLY`, `commands.ts:23-40`), `session-settle`, `membership-settle` and `agent-member-settle`. A boot command or a port refusal never needs a session, since only the kernel runs them.
- **Signed out,** `app-list` answers `[]` (the rail is empty), `workspace-get` the projection's `id` and `name` only, `scope-get` the workspace with no project, `layout-get` and `layout-set` the workspace-level records of `~signed-out` ([4.5](#45-a-persons-records-per-actor)), and `palette-search` only these commands.
- Any other command signed out is afd-auth's `UNAUTHORIZED`; signed in without membership, `WORKSPACE_NOT_MEMBER` from line 0 ([3.3](#33-the-access-decision-version-2-d86)), journaled.
- **A unit** holds the lists: every name in them is registered; every command the chrome calls during E1's signed-out scenario, recorded by a spy on `kernel.call`, is in `SIGNED_OUT_COMMANDS`; and each internal and boot command runs with no session.

#### What changes for `local`

`local` mode keeps every behavior phases 0 to 2 tested, but these change, each decided here and listed in [E12](#18-exit-criterion-and-tests):

| Item | Decision |
| --- | --- |
| `SESSION_50` | Unchanged. `session-settle` runs only for a change no `auth-*` command made ([4.4](#44-hearing-the-adapter-d88)); `SESSION_50` signs in through `auth-sign-in`, which settles inside the command as phase 2's middleware caller does. A unit asserts its entries are byte-identical |
| The `persona` context field | Declared on the direct registries, so `KERNEL_CONTEXT_FIELDS` has seven. **Set only when the active persona is not `default`,** so an entry with the default persona has no `persona` key, and every recorded journal of phases 0 to 2 keeps its shape. `kernel.test.ts`'s field list is amended |
| `HUMAN_REQUIRED` | Applies in `local` too: the agent interface cannot run a human command, since an agent never changes a person's credentials, personas or who may do what ([3.4](#34-the-trust-table)). No phase 0 to 2 test calls one through the agent interface; a unit holds that |
| The agent interface's actor | `{ kind: 'agent', id, onBehalfOf }` in both modes (3.1). Phase 2 tests asserting a human actor on `kernel.agent.call` are amended, each listed in step 1 |
| `decideAccess`, `actorKey` | Their signatures change (3.3); phase 2's units are amended to `AccessInputV2` and `personKey` |
| `ui.account` | Served (5.5); phase 1's and 2's manifest cases that expect `MANIFEST_SURFACE_UNAVAILABLE` for it are amended |
| `member` | Joins `SHELL_DOMAINS_V1`; a manifest case for the id `member` |
| `PROJECT_SLUG_TAKEN` | Renamed `PROJECT_SLUG_UNAVAILABLE` (7.3); its tests amended |
| The title bar's "Sign in" | Unchanged in `local`: it calls `auth-sign-in` with the Mock's email, as `shell.ts:827-834` does |
| `deployment_version` | `readDeployment` reads 1 to 3; `deployment write` writes the version the file declares, and version 3 is needed only for `[identity]`, so phase 2's fixtures stay version 2 |

### 2.2 The deployment file, version 3

`manifest/schemas/deployment.v3.json` and `projection.v3.json`. `readDeployment` reads 1 to 3; `readBoot` and `readProjection` read 2 and 3, a version 2 projection meaning `local`. Everything of phase 2's 4.2 stands. It adds:

```toml
deployment_version = 3

[identity]
mode = "provider"            # default "local"
provider = "better-auth"     # the only value
organization = "acme"        # the bound organization's slug at first binding; required for "provider"
path = "api/auth"            # relative to site.base_path, no leading slash; default "api/auth"
methods = ["passkey"]        # "passkey", "password", "oidc:<provider-id>"; default ["passkey"] (D99)
```

**`path` has one reading:** relative to `site.base_path`, so with `base_path = "/loam/"` the provider is at `/loam/api/auth/`. The projection carries `identity: { mode, organization, path, methods }`, the slug for display only, and nothing else: no secret, no key, no database, no organization id. The provider's own configuration (secret, database, mail sender, OIDC clients) is the hosted lane's, through `createLoamAuthOptions`, never in the deployment file (D63).

| Refusal | Code |
| --- | --- |
| `mode = "provider"` with no `organization`, or one off the slug pattern | `DEPLOYMENT_IDENTITY_INVALID` |
| `path` with a leading `/`, a `.` or `..` segment, or one a deployment's own files use | `DEPLOYMENT_IDENTITY_INVALID` |
| `methods` empty, or naming an unknown method | `DEPLOYMENT_IDENTITY_INVALID` |
| A `provider` deployment with a mounted `stdio` instance. **Decided by the owner on 2026-11-09 (D95, [Q6](#q6-stdio-instances-on-the-hosted-server)), which narrows D56:** a shared workspace runs no program as the server's own user for its members | `DEPLOYMENT_STDIO_TEAM`: `deployment write` and `check` stop, naming the instance and suggesting an HTTP instance. The hosted server refuses to start with one, so a hand-edited file cannot slip it past |

### 2.3 The workspace bound to an organization

```ts
export interface WorkspaceV2 extends Omit<WorkspaceV1, 'organization'> {
	/** The bound organization in `provider` mode, from the server; `null` in `local`. */
	organization: { id: string; slug: string; name: string } | null;
	/** Raised when the workspace's membership changes; read by the collaboration service (D46). */
	memberEpoch: number;
}
```

- **The id is pinned, server-side, at first binding.** On its first start, the hosted server resolves `[identity] organization`'s slug to the organization's id and writes the binding, `{ workspace, organizationId, boundAt }`, to `loamServerPlugin`'s own table in the provider's database. From then on the id is the binding: **every membership and role read names the bound id**, a slug that later points elsewhere grants nothing, and a deployment file whose slug no longer matches the bound organization's current slug is `IDENTITY_BINDING_MISMATCH`, a warning in the server's doctor and to owners. Rebinding is a deployer's act on the server, never a command.
- **The organization cannot be moved from under it.** `createLoamAuthOptions` sets `allowUserToCreateOrganization: false`, gives no role `organization:update` or `organization:delete` on the bound organization (custom access control, [2.6](#26-the-providers-configuration)), and its `beforeUpdateOrganization` and `beforeDeleteOrganization` hooks refuse any change to the bound organization's slug or its deletion.
- **The session's active organization is never an input.** Loam never reads `activeOrganizationId` and never calls `setActive`. Membership comes from `loamServerPlugin`'s `whoami`, which reads the member row for `(boundId, userId)`; Loam's `member-*` commands pass `organizationId: boundId` to every organization endpoint. E2's scan finds no `activeOrganization` in `kernel/src`, `web/src`, `chrome/src` or `identity/src` but the hook that refuses it.
- **No workspace switcher.** The account section lists the person's organizations read-only and marks the bound one.
- **Membership is the provider's.** `MembershipV1` is read, never stored by the browser ([4.2](#42-first-paint-the-probe), [7.6](#76-freshness)). `memberEpoch` is raised by every membership change the server sees.

### 2.4 The test-only auth host

Before phase 6, nothing serves Better Auth on the shell's origin, so phase 3 proves its browser criteria against a **test-only auth host**, as D64 proved mounts through a test-only relay, and says so wherever a result is recorded.

- `startTestAuthHost({ organization, people, methods, resources })`, in `@lushly-dev/loam-identity/testing`: a real Better Auth 1.7.18 server in a child process, from `createLoamAuthOptions`, on `node:sqlite` in a temporary directory, with a mail sink (each message appended to a file the test reads), seeding the organization and its people with roles. It returns its origin, `mail()`, `db()` (read-only), and `close()`, which removes everything on success and failure.
- `serveDeployment` gains `authHost?: TestAuthHost`, and serves the site **over HTTPS on `https://localhost:<port>`** with a certificate generated per run, as `pnpm test:hosted:local` does, proxying `<base_path>api/auth/*` to the host. The page, the probe and the provider share an origin, and cookies carry `Secure` as in production. Only that origin's certificate is accepted.
- **A virtual authenticator.** `addVirtualAuthenticator(page, { userVerified })` in the harness, through Chromium's DevTools `WebAuthn` domain (`protocol: 'ctap2'`, `transport: 'internal'`, `hasResidentKey`, `hasUserVerification`, `isUserVerified`). No real authenticator or platform prompt is involved, and E1's record says so.
- **What it does not prove:** the hosted lane, its database, its server kernel, the mount relay's enforcement, a second device on another network, or another provider. [Section 10](#10-the-dependency-on-phase-6s-hosted-lane-d84) gives those to the hosted criterion.

### 2.5 Where provider mode is enforced

A browser kernel runs commands against the browser's own IndexedDB, and **nothing it checks is a boundary against the person at the keyboard**, who can edit that store or the page. Its checks give honest people the right answers and keep one person's working state from another's on a shared profile; they protect nothing from the person holding the profile. So in `provider` mode:

| Enforcement point | What it holds and refuses |
| --- | --- |
| **The provider** (Better Auth, with `loamServerPlugin`) | Accounts, credentials, sessions, consents and tokens; organization membership and roles, by the bound id; the binding; Loam's rules on its own endpoints ([7.5](#75-the-providers-own-endpoints)) |
| **The hosted server's MCP handler and its kernel** (phase 6) | Every MCP call: the token ([9.5](#95-the-server-kernel-and-its-chain)), then `decideAccess` version 2 against the server's records |
| **The mount relay** (phase 6, `mounts/<instance>/mcp`, D64) | Every browser call to a mounted instance: the session, then `decideAccess` version 2 against the server's records, with membership read on the server, before forwarding ([10.2](#102-what-phase-6-must-deliver-first)) |

**Which store is authoritative for each trust record:**

| Record | Authoritative in `provider` mode | A browser's copy |
| --- | --- | --- |
| Accounts, credentials, sessions, consents, membership, roles, the binding | The provider's database | None persisted; `MembershipV1` in memory, for answers and display |
| `ProjectV1.access`, installed agent members, `WorkspaceAppV1.overrides` | **The hosted server's store** (phase 6); the trust-record commands run there, and phase 6 decides how a browser sends them | A copy for display and offline reading. **It grants nothing outside that browser** |
| `PersonaV1`, a person's view-state | The person's own; whichever store holds them | The same: they decide nothing |

**Until phase 6,** a `provider` deployment's trust records live in each browser, so phase 3's local criterion proves the rules in the kernel, the provider and the token layer, not a team deployment. A team deployment exists from step 10, when the server's kernel and the relay hold the records and enforce them.

### 2.6 The provider's configuration

`createLoamAuthOptions({ baseURL, secret, database, organization, methods, mail, oidc?, resource })` returns Better Auth's options with:

- **Cookies and sessions:** the cookie cache off; `session.freshAge` 300 seconds ([5.2](#52-passkeys)); no `bearer` plugin, so a session token is never a bearer credential.
- **Origins:** `baseURL` the deployment's exact origin and path; `trustedOrigins` exactly that origin, no other; **passkey `rpID` the exact host** (never a parent domain), `origin` set explicitly to the same origin, `attestation: 'none'`, `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`.
- **Passkey registration:** `registration: { requireSession: false, resolveUser, afterVerification }`, with `loamServerPlugin`'s hooks restoring every session and freshness check that setting removes ([5.8](#58-registration-at-the-provider)).
- **Disabled routes:** `disabledPaths` holds the JWT plugin's `/token`, `/request-password-reset`, `/reset-password`, `/reset-password/:token`, `/forget-password/email-otp` and `/change-email` (5.7, 9.4); `user.changeEmail` is off.
- **Sign-up:** none open. `emailAndPassword` only when `methods` holds `password`, with `disableSignUp: true` and `requireEmailVerification: true`; a `databaseHooks.user.create.before` hook that refuses any new user who is not completing an invitation ([5.6](#56-enrolment)) or a configured OIDC sign-in with a verified email.
- **Organization:** `allowUserToCreateOrganization: false`; `requireEmailVerificationOnInvitation: true`; `sendInvitationEmail` through `mail` with Loam's join link ([5.6](#56-enrolment)); custom access control and `organizationHooks` ([7.5](#75-the-providers-own-endpoints)).
- **OIDC (`methods` holds `oidc:<id>`):** `genericOAuth` for that provider; `account.accountLinking` enabled only for that provider, only when its ID token says `email_verified: true`, and never to a different email.
- **OAuth provider:** [9.4](#94-connected-agents-and-their-pages).
- **Ways in (D99, the coordinator's decision of 2026-11-09):** passkeys; the deployer's single sign-on (`oidc:<id>`) if the deployer sets one up; passwords off by default, and a deployer may turn them on. **Passwords and OIDC sign-ins carry no user verification:** the provider records how each session was made, and a session from a password or an OIDC sign-in is not user-verified. Section 5.2 says what that limits.
- **Pins:** `better-auth`, `@better-auth/passkey`, `@better-auth/oauth-provider` and `@better-auth/cimd` at `1.7.18` exactly, together, in `identity` and `web`'s dev dependencies, past the workspace's three-day `minimumReleaseAge` (published 2026-11-05).

## 3. The actor and the access decision

### 3.1 The actor on each path

| Path | Actor | Today |
| --- | --- | --- |
| `kernel.call` (the palette, the chrome) | `{ kind: 'human', id: <user id>, label: <name> }` from the session; `local` signed out: none | The same |
| `kernel.agent.call` | **`{ kind: 'agent', id: options.agent ?? 'shell-agent', onBehalfOf: <user id> }`**: the agent registry sets the kind and id; afd-auth's middleware sets `onBehalfOf` from the session (`middleware.ts:38-44`) | Runs as the human: the agent registry sets no actor, and the middleware fills a missing one as `human` |
| **An app's port, a surface's port, a nested call** | **The outer call's actor, copied:** `KernelCallFields` gains `actor`, which `checkedCall` (`apps/port.ts:128-171`), the nested client and the surface port set from the calling context, and `execute` puts on the call's context before the chain | **Lost:** `runAs` runs them on the `palette` registry with only `caller`, `parent` and `scope` (`kernel.ts:509-511`, `context-fields.ts:23-30`), so afd-auth's middleware makes every one the signed-in human, even under an agent's call |
| MCP on the hosted server, and every nested call under it | The request's principal, from the token ([9.5](#95-the-server-kernel-and-its-chain)); no token, no call | `{ kind: 'agent' }`, no id, then overwritten by the kernel adapter's session user |
| A browser's trust-record call on the hosted server | The session's human ([9.5](#95-the-server-kernel-and-its-chain)) | None today |
| Replay | The entry's recorded actor (`actorOf`), as phase 2's 10 | The same |

afd-auth's middleware already keeps an agent's id and replaces only its `onBehalfOf` with the session user; a copied human actor is the session user anyway. So the copied actor survives the chain on every in-process path.

**`options.agent`** is 1 to 64 characters of `^[a-z0-9][a-z0-9-]*$`, so it can never spell an `agt_` id; `local`, `signed-out` and `shell-agent` are reserved to the kernel (`AGENT_NAME_RESERVED`). An agent member acts only through phase 5's delegation or as a connected agent over MCP, never by naming itself.

**Everything per person reads the person.** Phase 2's `actorKey` becomes `personKey(actor)` wherever it keys a person's record, decides "self", or fills `createdBy` and `updatedBy`, which therefore keep meaning whose action it was. The journal keeps the whole actor, so audit names the agent and the person (architecture section 8).

### 3.2 Who is who

- **A person's id** is the provider's user id, or the Mock's `mock-user-<email>` in `local` mode. Never an email.
- **An agent member's id** is `agt_` and 20 characters of `[a-z0-9]` from the kernel's random source. **No person's id may start `agt_`**: the auth gate signs out a session whose user id does (`AGENT_CANNOT_SIGN_IN`), and `principalOf` refuses such a token subject. Better Auth's ids never do; the check is so that a forged or misconfigured adapter cannot make an agent member a person.
- **The agent interface's** ids are `shell-agent` or phase 5's names. No agent id is ever in a project's `members`.

### 3.3 The access decision, version 2 (D86)

```ts
export interface MembershipV1 {
	mode: 'local' | 'provider';
	/** `provider`: person id to role in the bound organization. `local`: unused, every actor is a member and an owner. */
	members: ReadonlyMap<string, 'owner' | 'admin' | 'member'>;
	/** The provider's digest of the membership, recorded by `session-settle` (4.4). */
	digest: string;
}

export interface AccessInputV2 {
	actor: { kind: ActorKind; id: string; onBehalfOf?: string } | undefined;   // undefined when signed out
	scope: ScopeV1;
	project: ProjectV1 | undefined;
	membership: MembershipV1;
	/** The agent member's record when `actor.id` starts `agt_`, else undefined: `agentOf(context)`, from the principal on the server (a connected agent) or the kernel's table in a browser (9.5). */
	agent: AgentMemberV1 | undefined;
}
export function decideAccess(input: AccessInputV2): { allowed: true } | { allowed: false; reason: 'workspace' | 'project' };
export const personKey = (actor: AccessInputV2['actor']): string | undefined;
```

1. **The person,** `personKey(actor)`: a human's id, an agent's `onBehalfOf`. In `local` mode, absent either, `local`. In `provider` mode, no actor, an `agent` with no `onBehalfOf`, or any other kind has no person: refused, `reason: 'workspace'`, which answers **`WORKSPACE_NOT_MEMBER` with the message "This agent acts for no member of the workspace"** for an agent, and afd-auth's `UNAUTHORIZED` signed out.
2. **Workspace:** in `provider` mode, the person is in `membership.members`. Refused: `reason: 'workspace'`.
3. **Project,** when `scope.project` is set: as phase 2's 3.4, for the person.
4. **Agent member,** when `actor.id` starts `agt_`: the record exists; its status is `active` ([8.3](#83-sponsors)); **`actor.onBehalfOf` is its sponsor**, as the glossary names the sponsor in `onBehalfOf`; and the scope is within its `access` (`workspace: true` for workspace level; for a project, its id in `projects`, or `projects: 'sponsor'`). Refused: `reason: 'project'`, the same bytes as a missing project.
5. Otherwise allowed. **Neither the active scope, the persona, nor the session's active organization is an input** (D4, D11, 2.3).

So **an agent never has more access than the person it acts for, and an agent member never more than its record or its sponsor:** the intersection, as D4's "narrows, never grants" reads for agents, and as D40 requires.

**Where it runs.** `decideAccess` stays pure and in first paint. The scope middleware gains **line 0**, before phase 2's line 1, for every command not in `SIGNED_OUT_COMMANDS`, `MEMBER_EXEMPT_COMMANDS`, `INTERNAL_COMMANDS`, `session-settle`, `membership-settle` or `agent-member-settle`: steps 1 and 2 alone, journaled. Lines 1 to 8 of phase 2's 3.4 are unchanged; line 2 passes `AccessInputV2`, and its refusal stays `PROJECT_NOT_FOUND`. `ProjectCache`, `canOpen`, `opensIn` and `project-list`'s filter take the actor. On the server kernel, line 0 reads the principal's person (token or session) and the server's membership ([9.5](#95-the-server-kernel-and-its-chain)), never `sessionActor`. **Where line 0 runs:** in `createScopeMiddleware`, before `late.before` and line 1, in first paint; under 13's fallback, in `LateScope.before`, whose return type becomes `CommandResult<never> | undefined` so that a refusal there returns before line 1 (`scope/middleware.ts:76-97`), and not in `LateScope.run`, which runs after line 1.

**Stage A** decides with the probe's membership ([4.2](#42-first-paint-the-probe)), so a removed member's probe answers `membership: null`, `decideAccess`'s step 2 refuses in `chooseScope`, and no restricted project is painted.

### 3.4 The trust table

"Person" is the palette or the chrome, "agent" the agent interface, "port" an app's or a surface's port and a nested call, "MCP" a token's call on the hosted server, "replay" a journal's replay.

| Commands | Person | Agent | Port | MCP | Replay |
| --- | --- | --- | --- | --- | --- |
| `account-get`, `persona-list`, `member-list`, `agent-member-list`, `agent-member-get` | Own account; any member | For its person | `CALL_NOT_GRANTED` | Served, for the token's person | From the entry |
| Human commands: `account-update`, `account-passkey-add`, `-rename`, `-remove`, `account-invitation-accept`, `-reject`, `account-agent-disconnect`, `session-revoke`, `persona-create`, `-update`, `-remove`, `-set`, `member-leave`, `agent-member-confirm`, `-decline`, and every owner command | Own records; the sponsor for `agent-member-confirm` and `-decline` | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served | Provider-only ones from the entry; `persona-*` and `agent-member-confirm`, `-decline` re-run |
| `account-passkey-list`, `account-invitation-list`, `account-agent-list`, `session-list` (human commands too) | Own | `HUMAN_REQUIRED`: each lists a person's credentials or devices | `CALL_NOT_GRANTED` | Not served | From the entry |
| Owner commands: `member-invite`, `-invitation-list`, `-invitation-cancel`, `-remove`, `-role-set`, `agent-member-add`, `-update`, `-remove`, `workspace-app-set` | An owner; others `OWNER_REQUIRED` | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served | `member-*`, and `agent-member-remove` on a connected agent, from the entry; installed agent members' `agent-member-*` and `workspace-app-set` re-run |
| Owner cases of shared commands: `project-create` and `project-update { access }` on a listed slug; `project-update { access }` on another project, pending [Q2](#q2-who-may-change-a-projects-members) | An owner; others `OWNER_REQUIRED` | An agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` whose input has `access`, is `HUMAN_REQUIRED`, whatever Q2 answers | `CALL_NOT_GRANTED`, as today | **Served:** the commands are; an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` whose input has `access`, is `HUMAN_REQUIRED` from the handler, since a token's call is always an agent's | Re-run |
| `session-settle`, `membership-settle`, `agent-member-settle` (internal) | Kernel only | Never | Never | Never | Their entries |

- **Why human commands are human.** D40 says an agent member "cannot … administer"; this specification reads it for every agent, a person's own included. A persona is the person's lens, and the proposal says "the switch is explicit and visible", so an agent does not switch or edit it; `account-update` changes how a person is shown to others; credentials, sessions, invitations and connected agents are a person's own keys. An agent may read the person's account and personas, and nothing more of these.
- **Not served over MCP** means left out of `mcpOptions().commands`, as `PERSON_SESSION` is: `COMMAND_NOT_FOUND`. `HUMAN_COMMANDS` (this table's second and third rows) and `OWNER_COMMANDS` (its fourth) are frozen lists in `late-identity`. The fifth row's commands stay served, and an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` whose input has `access`, is `HUMAN_REQUIRED` in the handler, so no answer to Q2 can let an agent change who is in a project.
- **The ports** are unchanged: none of these is in `APP_CALLABLE_SHELL_COMMANDS_V1` or a grant's list. **Apps receive the actor and the scope, never credentials** (principle 7).
- **Replay never reaches the provider, and re-runs what writes Loam's store.** A command whose whole effect is at the provider (`account-*`, `session-list`, `session-revoke`, `member-*`) is in the kernel's recorded table, as `app-instance-refresh` is (phase 2's 10): a replay answers it from its entry, and one with no entry stops as `REPLAY_NOT_RECORDED`. **A command that writes Loam's store is never recorded,** owner commands included (`agent-member-*` on installed agent members, `workspace-app-set`, `project-*`, `persona-*`): a replay re-runs it, so its writes replay. `agent-member-remove` on a connected agent writes the provider's database, so it is recorded; it is "connected" when `agent` is not in the kernel's `agent-member` table, and the `REPLAY_NOT_RECORDED` decision reads that table, the kernel's own list, never the entry (as `late/scope-change.ts:248-253` reads the kernel's own table for mounted commands). Their owner check and line 0 read membership from the replay's journaled membership (4.4). The replay's Mock is driven by the recorded `auth-sign-in`, `auth-sign-out` and `session-settle` entries.
- **Every new command** joins `kernel/src/scope/call-scope.test.ts`'s table, through a person, an agent and two surface ports, on twin workspaces.

## 4. Sessions

### 4.1 The adapter

AFD first (D15): what is generic lands in `@lushly-dev/afd-auth`, in step 0b, with its Mock, on Better Auth 1.7.18 pinned with its plugins (npm cannot resolve `@better-auth/passkey` 1.7.14's peers without `--legacy-peer-deps`).

```ts
// packages/auth/src/types.ts, additions
export interface PasskeySignInOptions { method: 'passkey'; autoFill?: boolean }
export type SignInOptions = CredentialsSignInOptions | OAuthSignInOptions | PasskeySignInOptions;

export interface SessionManagement {
	listSessions(): Promise<SessionRow[]>;
	revokeSession(target: string | 'others' | 'all'): Promise<void>;
}
export interface SessionRow { handle: string; current: boolean; createdAt: Date; updatedAt: Date; expiresAt?: Date; device?: string }

export interface PasskeyManagement {
	listPasskeys(): Promise<PasskeyRow[]>;
	addPasskey(options?: { name?: string }): Promise<PasskeyRow>;
	renamePasskey(id: string, name: string): Promise<void>;
	removePasskey(id: string): Promise<void>;
}
export interface PasskeyRow { id: string; name?: string; createdAt: Date; deviceType?: 'singleDevice' | 'multiDevice'; backedUp?: boolean }

export interface OrganizationAccess {
	/** Every call names the organization by id; the session's active organization is never read. */
	membership(organizationId: string): Promise<{ role: string } | null>;
	listMembers(organizationId: string, options?: { limit?: number; offset?: number }): Promise<OrganizationMember[]>;
	// Named in step 0b (the specification's comment listed them):
	invite(organizationId: string, invitation: { email: string; role: string }): Promise<OrganizationInvitation>;
	listInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
	cancelInvitation(organizationId: string, invitationId: string): Promise<void>;   // refused for another organization's invitation
	removeMember(organizationId: string, memberId: string): Promise<void>;
	setRole(organizationId: string, memberId: string, role: string): Promise<void>;
	leave(organizationId: string): Promise<void>;
	listOwnInvitations(): Promise<OrganizationInvitation[]>;   // the invitee's
	acceptInvitation(invitationId: string): Promise<void>;
	rejectInvitation(invitationId: string): Promise<void>;
}
export interface OrganizationMember { id: string; userId: string; role: string; createdAt: Date; user: { id: string; email: string; name?: string; image?: string } }
export interface OrganizationInvitation { id: string; organizationId: string; email: string; role: string; status: 'pending' | 'accepted' | 'rejected' | 'canceled'; expiresAt: Date }

export interface AuthAdapter {
	// …as today, and:
	refresh?(): Promise<void>;
	sessions?: SessionManagement;
	passkeys?: PasskeyManagement;
	organization?: OrganizationAccess;
}
```

- **A session's handle is never its token:** the first 16 hex characters of SHA-256 over it, mapped in memory. `device` is a label from the user agent. **No IP address leaves the adapter.**
- **`BetterAuthAdapter`** implements all three with the organization and passkey client plugins; a dismissed ceremony is `AuthAdapterError` `PASSKEY_CANCELLED`, no WebAuthn `PASSKEY_UNSUPPORTED`. It takes an `initial` state from the probe. *As built in step 0b:* Better Auth's client is a path proxy that answers every property, so a missing plugin cannot be detected; the three capabilities are always present, and a provider without the plugin answers `PROVIDER_ERROR`. An unknown session handle is `PROVIDER_ERROR`. `sessions` uses Better Auth's own `/list-sessions`, which needs a fresh session; Loam's `session-list` reads `loamServerPlugin`'s endpoint instead (4.6).
- **`MockAuthAdapter`** implements all three in memory, roles from its options, and an `expiresAt` the kernel's clock reads.
  - **Amended in step 0b (coordinator, 2026-11-09).** The three capabilities live in `@lushly-dev/afd-auth/mock-capabilities`, whose `withMockCapabilities(mock, { roles })` attaches them to an existing Mock, in memory and on its clock, so the web host's first-paint Mock never bundles them (13). `new MockAuthAdapter({ clock })` keeps only what first paint uses: the clock and `expiresAt`, `refresh()` (which signs out a session past its `expiresAt` on the clock) and the passkey branch of `signIn`. Until the capabilities are attached, `sessions`, `passkeys` and `organization` are `undefined`, the interface's "not supported", and a passkey sign-in is `PASSKEY_UNSUPPORTED`; once attached, it signs in the holder of the passkey added last, and `_setPasskeyCeremony('cancel' | 'unsupported' | 'complete')` sets how ceremonies end. `roles` is `{ [organizationId]: { [userId]: role } }`. **In `local` mode the kernel's `late` path calls `withMockCapabilities` before any `late-identity` command is registered (step 1); nothing in stage A reads a capability.**
- **`createAuthMiddleware`, one change: a call whose `credentials` afd-server set itself keeps its actor,** since MCP authorization verified it and the adapter's session is not its caller. afd-server marks the credentials it sets after verification with a module-private brand (a `WeakSet` in `@lushly-dev/afd-server`, read through an exported `isVerifiedCredentials`), so a direct-registry caller passing its own `credentials` object gets no such treatment, and the middleware still deletes any caller-supplied `auth` in both cases. This is the backstop; Loam's server kernel has no session gate at all ([9.5](#95-the-server-kernel-and-its-chain)).
  - **Amended in step 0b (coordinator, 2026-11-09).** afd-auth reads the predicate from its options, `createAuthMiddleware(adapter, { isVerifiedCredentials })`, rather than importing afd-server: afd-server is an optional peer of afd-auth, and `@lushly-dev/afd-client`'s `DirectClient` runs middleware without it, so a static import would make it a required peer for consumers that never receive branded credentials. Without the predicate the middleware fails closed, as before: every call is gated on the session. afd-server exports `isVerifiedCredentials` from its root and from a browser-safe `@lushly-dev/afd-server/credentials` entry, and no entry exports the brand function, which step 0a's verifier calls; until then nothing is branded. **A branded call deletes `context.auth`, leaves `context.actor` untouched and runs without reading the adapter's session,** signed out, loading or expired; afd-server never brands `createContext`'s credentials, which the host admitted. Loam's server kernel has no session gate (9.5), so there this is belt and braces; **steps 1 and 7 pass the predicate wherever afd-auth's middleware runs on a registry that can receive verified credentials.**
  - **Amended in step 0b after its review (coordinator, 2026-11-09).** The brand is frozen, expires and ends: `brandVerifiedCredentials` freezes the credentials and their `scopes` and `cnf` before branding them; `isVerifiedCredentials(credentials, now)` is false once `expiresAt` (whole seconds, M4) is not after `now`, or when `expiresAt` is not a finite number; and an internal `unbrandVerifiedCredentials`, exported from no entry, removes the brand. The middleware takes a `clock` (default the system clock), compares a session's `expiresAt` with it and gives it to the predicate as `now`; **a kernel passes the same clock to the Mock and to the middleware.** **A branded call is refused every command in `AUTH_COMMAND_NAMES`** (`auth-sign-in`, `auth-sign-out`, `auth-session-get`) with `UNAUTHORIZED`, "This call is authorized by a token; session commands need a signed-in session", before the adapter is read: a token has no session to read, sign in to or sign out of. A nested call keeps the brand only when it is given the same credentials object.
- **`spec/error-codes.md`'s** auth package codes gain `PASSKEY_CANCELLED` and `PASSKEY_UNSUPPORTED` in step 0b. Loam's own codes ([15](#15-failure-modes-and-error-codes)) are kernel codes and stay out of it.

### 4.2 First paint: the probe

- **`web/src/identity.ts`, in first paint:** `probeSession(path)` sends one `GET <base_path><path>/loam/whoami` with `credentials: 'same-origin'`, in parallel with phase 2's boot reads. `loamServerPlugin`'s `whoami` reads the session from the database (no cookie cache exists) and the member row for the bound id, and answers `{ session: { id, expiresAt }, user: { id, email, name, image }, membership: { organization: { id, slug, name }, role, digest } | null }` or `null`. A failed or malformed answer is signed out. **Stage A waits at most 1,500 ms,** then paints signed out; a later answer is applied through `session-settle`.
- **`DeferredAuthAdapter(initial, load)`**, in the same file: `getSession` answers the probe's state; `signIn`, `signOut`, `refresh` and the capabilities await `load()`, the `auth` chunk, then delegate. Listeners move to the real adapter. The kernel takes this adapter and the probe's `MembershipV1`, so stage A's `decideAccess` has membership.
- **Stage B loads `auth`** in `provider` mode only: `BetterAuthAdapter`, Better Auth's client with the organization and passkey plugins, and **`SessionSync`, created here and only in `provider` mode** (the Mock's sessions are per page, so `local` needs none).
- **`local` mode** sends no probe and never loads `auth`.

### 4.3 Revocation and every tab

- **Every tab of this browser.** `session-revoke` of the current session, or `'all'`, signs this tab out; `SessionSync` tells every other tab of the profile, whose adapters re-read the session and find none, and each kernel runs `session-settle`.
- **Every tab of another device.** Revoking `handle` or `'others'` deletes those sessions at the provider, which refuses them at once (cookie cache off), and so does every enforcement point (2.5). What those tabs show catches up when their adapter next reads the session: on `visibilitychange` to visible, on `online`, and every 60 seconds while visible.
- **`'all'` and `'others'` revoke more than sessions:** `loamServerPlugin`'s `revoke-person` deletes the person's other sessions (Better Auth's `internalAdapter.deleteSessions`), deletes every OAuth consent the person granted, and marks every refresh token of theirs revoked, `offline_access` ones included (the provider keeps those on a plain session revocation). **An issued JWT access token cannot be revoked** (S86) and lives out its 10 minutes ([9.4](#94-connected-agents-and-their-pages)); the sessions tab says so. The connected agents it disconnects are suspended ([8.3](#83-sponsors)).
- **The cost of no cookie cache:** every provider request reads the session row; phase 6 measures it and may add secondary storage, never the cookie cache.

### 4.4 Hearing the adapter (D88)

- **Where it lives.** The listener, the expiry timer and the membership refresh are `late`'s, attached when stage B loads, so they add no first-paint code; before then no late command can run, and stage A decides with the probe. First paint holds only the person captured in `run` (below).
- **The listener.** `late` subscribes to `auth.onAuthStateChange`. When the verified person differs from the last one the kernel settled, and the change did not come from an `auth-*` command (which settles inside itself, as phase 2's middleware caller does), it runs the internal **`session-settle`**, journaled, on the `palette` interface.
- **The expiry timer (#854).** The kernel keeps one timer for the session's `expiresAt`, **on the kernel's clock** (`options.clock`, through a `schedule(at, fn)` port the web host implements with `setTimeout` and tests and replay with a fake). It **re-arms whenever the adapter reports a different `expiresAt`**, since Better Auth slides a session's expiry as it is used. A delay past 2³¹−1 ms is clamped, and the timer re-arms when it wakes early. **When it fires, the kernel calls `adapter.refresh()` first**, and runs `session-settle` only if the person really changed or the session is gone. A replay never fires it; it replays the entry.
- **Membership is journaled, first and on every change.** In `provider` mode, **`session-settle { reason: 'provider' }` with the probe's person, role and digest is journaled before any call that is not boot's own work**, so a journal always opens with the membership its first commands were decided with. **That first settle is a change from `null` in both the original and the replay** (a replay's kernel starts with no person, as the original's did before the probe), so E4's zero-difference replay cannot diverge on it. After that, whenever the kernel re-reads `MembershipV1` (before every command in `OWNER_COMMANDS`, every `project-create`, and every `project-update` carrying `access`, and on 4.3's refresh) and its `digest` differs from the last one journaled, it runs `session-settle` with `reason: 'membership'`. **Both run top-level, from `run`, before the call that needed them is dispatched,** never nested inside it, since a replay answers a nested entry from its record; a replay skips the re-reads and replays these entries. So line 0 and `isOwner` replay from the journal, never from a provider.
- **Other journaled reads.** A sponsor-membership read in `agent-member-add` and `agent-member-update` is journaled as the internal command **`membership-settle { person, role, digest }`**, top-level before the command: it records that person's role for the replay's sponsor check and **never changes the session's person**, so `session-settle` keeps one meaning. The installed agent members `member-remove` suspends are journaled as a top-level `agent-member-settle` after it.
- **Its input is the change, as data:** `{ person: string | null; role: 'owner' | 'admin' | 'member' | null; membershipDigest: string | null; reason: 'provider' | 'expiry' | 'tab' | 'membership' }`, computed by the kernel before it runs. A replay reads the person, role and digest from the entry and drives its Mock and its `MembershipV1` to them.
- **Its handler** does at least what a sign-out does, whenever the person changes: closes the active app by `app-close`'s rules and dismisses app-owned overlays as `app-switch`; clears selections; holds the leaving person's unsaved drafts (4.5); runs `applyScopeChange(…, 'actor')`; then, for a new person, hydrates their records (4.5). With no session in `provider` mode, main shows "Sign in". With `reason: 'membership'` and the same person, it only replaces `MembershipV1` and, if the active project is no longer allowed, runs `applyScopeChange`. Its result is `{ person: string | null; left: string | null }`.
- **No coalescing across people.** Two changes to the same person make one call; a change to a different person is never merged away.
- **Calls queued across a change.** `run` captures the person when a call is queued, and a call that would run after a change of person is refused `SESSION_CHANGED`, retryable, journaled, so nothing one person queued runs as another. **Two exemptions keep the ordinary paths working:** a call queued behind an `auth-*` call from the same interface takes the person that `auth-*` call leaves, so the chrome's sign-in followed by its reads (phase 0 to 2's signed-out-to-Mock path, E12) runs as the signed-in person; and the kernel's own internal commands are never refused. **A nested call whose copied person differs from the session's current person is refused `SESSION_CHANGED`**, since afd-auth's `actorForSession` would otherwise re-stamp it as the new human.
- **Its event** carries `actorChanged: true` in `KernelEventV3`; the chrome re-reads the rail and every section on it. That closes #864.
- **Not served,** not callable through a port, refused on the agent interface.

### 4.5 A person's records per actor

In `provider` mode, several people may share a browser profile. So in `provider` mode, `loam.scope`, `loam.apps`, `loam.editor[@<project>]`, `loam.layout.<owner>[@<project>]` take the suffix `~<person>`, and `loam.persona~<person>` does in both modes, through one function, `personalRecordId(id, person)`, beside `storeRecordId`. Signed out, the key is `~signed-out`, holding defaults only, cleared at each sign-out. `local` mode keeps phase 2's ids for the rest, so nothing migrates.

On a change of person, `session-settle` discards nothing: the editor area holds the leaving person's unsaved drafts in memory, keyed by person, and restores them if that person signs in again in the same page; a held draft makes `beforeunload` ask. **No action of another person loses a draft.**

### 4.6 Session and sign-in commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `auth-sign-in` | mutation, afd-auth's | adds `{ method: 'passkey'; autoFill?: boolean }`. **The kernel's auth-gate wrapper** (`late-identity`) refuses a method not in `identity.methods` with `SIGN_IN_METHOD_UNAVAILABLE` before the adapter is called | As today |
| `session-list` | query, recorded, human | `{}` | `{ sessions: SessionRowV1[] }`: `{ id, current, device, createdAt, updatedAt, expiresAt }`. Read through `loamServerPlugin`'s `sessions` endpoint, which needs a session but not a fresh one and calls `internalAdapter.listSessions`, returning handles, never tokens: Better Auth's own `/list-sessions` requires a fresh session, so it would break `freshAge` (300 s) after sign-in |
| `session-revoke` | mutation, recorded, human | `{ session: string \| 'others' \| 'all' }`. `'others'` and `'all'` need a fresh session ([5.2](#52-passkeys)) | `{ revoked: number; signedOut: boolean; disconnected: number }`. No undo. Unknown: `SESSION_NOT_FOUND` |
| `session-settle` | internal | 4.4 | 4.4 |

In `local` mode with the Mock, `session-list` answers the one session and `session-revoke` signs out.

## 5. The account section

### 5.1 What it is

A shell section, `section-open { section: 'account', path }`, at `/<workspace>/~/account[/<tab>]`. It runs at workspace level and shows nothing of any project. Tabs: `profile`, `passkeys`, `sessions`, `personas`, `members`, `agents` (connected agents), and one per app's `ui.account` section. In `local` mode, `passkeys`, `sessions`, `agents` and the owner controls of `members` are absent.

The **account menu** (the title bar's account button) opens `loam-account-menu`: the person's name and persona, the persona switch, "Account", "Sign out".

```ts
export interface AccountV1 {
	id: string; email: string; name: string; image: string | null;
	organizations: { id: string; slug: string; name: string; role: string; bound: boolean }[];
	workspace: { member: boolean; role: 'owner' | 'admin' | 'member' | null; owner: boolean };
	persona: string;                                   // the active persona's id, or 'default'
	methods: ('passkey' | 'password' | `oidc:${string}`)[];
	recovery: 'oidc' | 'email' | 'none';                // how this person could recover (5.7, D97)
}
```

### 5.2 Passkeys

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `account-passkey-list` | query, recorded, human | `{}` | `{ passkeys: PasskeyRowV1[] }` |
| `account-passkey-add` | mutation, recorded, human, fresh | `{ name?: string (1 to 64) }` | `PasskeyRowV1`. Undo: `account-passkey-remove` |
| `account-passkey-rename` | mutation, recorded, human | `{ passkey; name }` | `PasskeyRowV1`. Undo restores |
| `account-passkey-remove` | mutation, recorded, human, fresh | `{ passkey }` | `{ removed: true }`. No undo. **`PASSKEY_LAST`** when it is the person's only passkey and `AccountV1.recovery` is `none` with no other method in `identity.methods` |

- **User verification is required** on every ceremony, by `authenticatorSelection.userVerification: 'required'` and by the provider's check of the assertion's UV flag. E1 holds that an assertion without user verification is refused.
- **Fresh.** `account-passkey-add`, `account-passkey-remove` and `session-revoke { 'others' | 'all' }` need a session created within `freshAge` (300 seconds), and, for a person who already holds a passkey, **a session made by a passkey** (D99: a password or OIDC session is not user-verified). The provider enforces it ([5.8](#58-registration-at-the-provider)); the kernel answers `REAUTH_REQUIRED` first, and the chrome asks for a passkey sign-in, which makes a fresh session, then retries once. A person with no passkey yet may add their first from a fresh password or OIDC session, which is how such an account enrols one. The only other way a person who holds a passkey registers another without one is the single sign-on recovery ceremony (5.7).
- **A person's gesture.** The chrome calls `account-passkey-add` from a button press; WebAuthn refuses a ceremony without transient activation (`PASSKEY_CANCELLED`).
- **Signals.** After a removal, where `PublicKeyCredential.signalUnknownCredential` exists, the chrome signals it (W32).
- **The sign-in dialog,** `loam-sign-in-dialog`: "Sign in with a passkey" first; the email field with `autocomplete="username webauthn"` for autofill, started when the dialog opens if `PublicKeyCredential.isConditionalMediationAvailable()` says so; then each other allowed method. A shell modal through the overlay manager.

### 5.3 Invitations and connected agents

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `account-invitation-list` | query, recorded, human | `{}` | `{ invitations: { id, organization: { slug, name }, role, expiresAt }[] }`, by the person's verified email |
| `account-invitation-accept` | mutation, recorded, human | `{ invitation }`. Needs a verified email (`requireEmailVerificationOnInvitation`) | `{ organization, role }`; then `session-settle` |
| `account-invitation-reject` | mutation, recorded, human | `{ invitation }` | `{ rejected: true }` |
| `account-agent-list` | query, recorded, human | `{}` | `{ agents: { agent, name, clientHost, scopes, connectedAt, status }[] }`: the person's connected agents ([9.2](#92-the-hosted-principal-mapping)) |
| `account-agent-disconnect` | mutation, recorded, human | `{ agent }` | `{ disconnected: true }`: suspends the agent member, deletes its consent and revokes its refresh tokens; its last access token lives out its 10 minutes, which the tab says |

### 5.4 Profile

`account-update { name?: string (1 to 80); image?: string | null }`, mutation, recorded, human, through the provider's `updateUser`; undo restores. `image` renders only from `img-src 'self' data:`, so a remote image does not load and initials show. Account deletion and data export are out of scope ([17](#17-out-of-scope-and-the-seams-reserved)).

### 5.5 An app's account section

Phase 1's catalog lists `account`, `ui.account`, as phase 3's. Removing `later('ui.account', 3)` (`refusal-map.ts:108`) is not enough, since `app-manifest.v2.json`'s `ui` has `unevaluatedProperties: false` (`:63`). Step 8 adds to `ui`'s `properties`:

```json
"account": {
	"type": "array", "maxItems": 2,
	"items": {
		"type": "object", "additionalProperties": false,
		"required": ["id", "title", "surface"],
		"properties": {
			"id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,39}$" },
			"title": { "type": "string", "minLength": 1, "maxLength": 40 },
			"surface": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,39}$" }
		}
	}
}
```

and the rules in `loam-rules.ts`: `surface` names a declared surface of a native or view app (`MANIFEST_ACCOUNT_SURFACE_UNKNOWN`), ids are unique in the app, `title` is scanned by `textRules`, a mounted manifest's `ui.account` is refused (`MANIFEST_ACCOUNT_MOUNTED`), more than two is `MANIFEST_ACCOUNT_LIMIT`, and a version 1 manifest with it is refused by D76's rule.

- It runs at **workspace level** through a surface port `{ scope: { workspace }, readOnly: false }` (D83), with the app's grants and nothing more: the actor through its handler's context, never an email, a session or a credential.
- **Budget.** `apps` is 393,918 of 394,094, and a schema branch and rules in the generated validator likely cost far more than 176 bytes. **Step 8 measures first,** then moves code out of `apps` or amends the row by its measurement, before it merges.

### 5.6 Enrolment

**There is no open sign-up** in `provider` mode. A person gets an account in one of two ways:

1. **By invitation.** An owner's `member-invite` ([7.2](#72-member-commands)) creates the provider's invitation, and `loamServerPlugin` creates a single-use join token, 32 random bytes, stored as a SHA-256 hash, expiring with the invitation (48 hours), with a `pendingUserId` it reserves for the new account. `sendInvitationEmail` sends the link `<origin><base_path>~/join?invitation=<id>&token=<token>` through `createLoamAuthOptions`' `mail`; the development profile and the test host use a mail sink.
   - **The join page** (`account` chunk, top level, `frame-ancestors 'none'` on the hosted lane) shows the organization and role, and offers "Create a passkey" first. **With any session present it stops and says "Sign out first"**, since the provider would attribute a registration to that session's person ([5.8](#58-registration-at-the-provider)).
   - **An invitation to an email that already has an account** (a person removed and invited again, or one created by single sign-on) never enrols a credential: the page says "You already have an account. Sign in, then accept the invitation in your account", and the person does that with `account-invitation-accept` (5.3).
   - **Passkey-first enrolment** registers with `context` `join:<invitation>.<token>` ([5.8](#58-registration-at-the-provider)). Holding the emailed token proves the mailbox, so the new account's email is verified.
   - With `password` allowed, the same page may set a password instead, through `loamServerPlugin`'s own `join/password` endpoint, which checks the token the same way; with `oidc:<id>`, "Continue with <provider>" signs in through it, and the invitation is accepted only when the provider's email is verified and equals the invitation's.
2. **By the deployer's single sign-on.** A configured OIDC provider may create a user only with `email_verified: true`. That user is **not a member** until invited.

**Email verification is required everywhere:** for a password account (`requireEmailVerification`), for accepting any invitation, and for linking an OIDC account to an existing one.

**The first organization and its first owner.** With sign-up and organization creation off, the deployer creates both, once, with `bootstrapOrganization({ slug, name, ownerEmail })` from `@lushly-dev/loam-identity`, which phase 6's hosted lane exposes as a one-time server command (10.2's item 2): it creates the organization through the provider's server API, pins the binding (2.3), and sends an `owner` invitation to `ownerEmail`, which enrols as above. It refuses when a binding exists. The test-only auth host seeds through the same function.

### 5.7 Recovery

**Decided by the owner on 2026-11-09 (D97, [Q5](#q5-ways-to-sign-in-and-who-may-restore-access)):** a person restores their own access by an **emailed one-time link to their verified email**, or through the company's **single sign-on** where the deployer set it up. **No owner can restore another person's account:** no command, owner or otherwise, starts a recovery for someone else, and no recovery link goes to any address but the account's own verified one. D97 is the owner's and wins over the coordinator's D99 where they meet: single sign-on recovery may register a passkey for a person who holds one.

**One transaction, whichever path,** in `loamServerPlugin`, called the **recovery transaction**: every other session, every OAuth consent and every refresh token of the person is revoked; their connected agents are suspended; `recoveredAt` is recorded on the provider's user; an email goes to the account's verified address ("Your access to Acme was restored on <date>. If this wasn't you, contact an owner"), and the account section shows a notice at the next sign-in. The kernel journals the resulting `session-settle` with `reason: 'provider'`, and `account-get` reports `recoveredAt`.

**By email.**

- The person asks on the sign-in dialog's "Can't sign in?" with their email. **The answer is the same, after the same fixed delay (1,000 ms from the request), whether the email has an account, has none, or is past its limit:** at most three recovery emails per account per hour, and past that the request is dropped silently. The provider's default rate limit applies per client address.
- The link carries a recovery token: 32 random bytes, stored hashed, **single use, valid 15 minutes**, at most one outstanding per person (a new one cancels the old). It goes only to the account's verified email.
- The recovery page (top level, `frame-ancestors 'none'`) **with any session present stops and says "Sign out first"**, then registers a new passkey with `context` `recover:<token>` (5.8), which runs the recovery transaction.

**By single sign-on: an explicit ceremony.**

- "Can't sign in? Use <provider>" calls `loamServerPlugin`'s `recover/oidc/start`, which signs out any session in this browser, **sets a single-use nonce in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie** valid 300 seconds, its SHA-256 and time stored in `loamServerPlugin`'s table and deleted by `complete`, and sends the person through the deployer's OIDC sign-in with a callback to `~/recover?via=oidc`.
- On return, the page calls `recover/oidc/complete`. It succeeds only with **that nonce, unconsumed, and a session created after the nonce and within the last 300 seconds by that OIDC provider's sign-in**, whose provider reports `email_verified: true` and an email equal to the account's verified email; it consumes the nonce. It runs the recovery transaction, keeping only this session, and marks this session `recovery` for 300 seconds in its own table.
- The page then registers a new passkey with that session. **This is the only path on which a session not made by a passkey may register a passkey for a person who already holds one** (5.8).

**Password reset is the same ceremony.** Better Auth's own `/request-password-reset`, `/reset-password`, `/reset-password/:token` and `/forget-password/email-otp` are in `disabledPaths`; with `password` allowed, "Can't sign in?" sends the same recovery link, and its page offers "Set a new password" beside "Create a passkey", each running the recovery transaction. **`/change-email` is disabled** (`user.changeEmail` off and in `disabledPaths`), so the address recovery trusts never changes by a session alone.

**`PASSKEY_LAST`** reads `AccountV1.recovery`: removing the last passkey is refused only when the person would have no way back in. With D97, recovery by email is open to a verified account, so `recovery` is `email` (or `oidc` where single sign-on is set up), and `PASSKEY_LAST` applies only to an account whose email is not verified.

### 5.8 Registration at the provider

Better Auth 1.7.18's passkey plugin registers in two requests, `/passkey/generate-register-options` then `/passkey/verify-registration`, and deletes with `/passkey/delete-passkey` (read from its published package). With `registration.requireSession: false`, which the join and recovery paths need, the plugin **drops its own session and freshness checks for every registration**; a present session still wins over `resolveUser`; `resolveUser` runs when the options are generated, one request before verification; and `afterVerification` may return the `userId` the passkey is for, which the plugin refuses when a session of another person is present. So `createLoamAuthOptions` sets `requireSession: false` and `loamServerPlugin` puts back, at the provider, everything that removed. **Only `generate-register-options` takes `context`, as a query parameter; `verify-registration` reads it back from the stored challenge** (the published `index.mjs`, 381-385 and 420-422). So the rows below are checked by a `before` hook on generation, which receives `context` and reads the session with `getAuthoritativeSessionFromCtx(ctx)`, and checked again in `afterVerification`, which receives the stored `context`; a refusal there throws before the passkey is stored:

| Request | Checked by a `before` hook on `/passkey/generate-register-options`, and again in `afterVerification` |
| --- | --- |
| No `context`, a session present | The session must be fresh (300 s), and if the person holds a passkey, made by a passkey, unless it is marked `recovery` (5.7). Otherwise `401 REAUTH_REQUIRED`. This is the plugin's own check restored, plus D99 |
| No `context`, no session | `401` |
| `context` `join:…` or `recover:…`, **any session present** | `400 SIGN_OUT_FIRST` |
| `context` `join:…` | The token matches its hash, unconsumed, unexpired; the invitation pending; **no account has the invitation's email** (else `409 ACCOUNT_EXISTS`) |
| `context` `recover:…` | The token matches its hash, unconsumed, unexpired |

- **`resolveUser`** (at generation) only names the user the options are for: for `join:` the token's `pendingUserId` and the invitation's email, for `recover:` the token's person. It writes nothing.
- **`afterVerification`** (at verification) does the work, after the authenticator has proved itself. `afterVerification` first re-reads the session (`getAuthoritativeSessionFromCtx(ctx)`) and applies every row; for `join:`/`recover:` it refuses `ctx.body.createSession !== true` before writing anything. It checks the token again, then for `join:` creates the user with `pendingUserId`, the invitation's email and `emailVerified: true`, accepts the invitation and consumes the token; for `recover:` runs the recovery transaction and consumes the token. It returns `{ userId }`. **With `createSession: true`, 1.7.18 runs `afterVerification`, the passkey insert and the session in one `runWithTransaction`** (`index.mjs:446-493`). `afterVerification` writes only through `runWithTransaction(ctx.context.adapter, …)` or `getCurrentAdapter`, joining the plugin's transaction. The user, the accepted invitation, the consumed token, the recovery revocations, the passkey and the session commit together or not at all. The announcement email and any other effect outside the database are queued with `queueAfterTransactionHook`. `createLoamAuthOptions` refuses to start on an adapter whose `transaction` is `false`.
- **Deleting:** a `before` hook on `/passkey/delete-passkey` applies the first row's freshness and passkey rule.
- **Sessions:** the same freshness and passkey rule on `/revoke-other-sessions`, `/revoke-sessions` and `revoke-person`.

E17 and E18 test each row at the provider, by direct requests that bypass the shell.

## 6. Persona (D89)

### 6.1 The record

```ts
export interface PersonaV1 {
	id: string;                    // `per_` and 16 of [a-z0-9]
	workspace: string;
	person: string;                // never an agent
	title: string;                 // 1 to 40: what the switch shows, "Reviewer"
	presentation: { name?: string /* 1 to 80 */; pronouns?: string /* 1 to 40 */; avatar?: string /* an ICONS_V1 id */ };
	defaults: {
		landing?: { section: 'projects' | 'documents' } | { app: string };   // at sign-in only
		project?: string | null;   // a slug; at sign-in only, through decideAccess
		density?: AppearanceDensityV0;
		theme?: AppearanceThemeV0;
	};
	emphasis: {
		apps?: string[];           // up to 12 instance ids, first in their band, marked emphasized
		sections?: ('projects' | 'documents' | 'account')[];   // first in the palette's sections
	};
	createdAt: number; updatedAt: number; updatedBy: string;
}
```

- Table `persona` in the workspace store, indexed by `person`, on both adapters with the store conformance suite. Up to 8 per person (`PERSONA_LIMIT`). **`default`** is implicit: no record, no presentation, defaults or emphasis, never removed.
- **Read only by its person**, through a person or their agent. To anyone else a persona answers as missing.
- **What other members see:** only the active persona's `presentation` (name, pronouns, avatar), in `member-list` and the members tab. Never its title, defaults, emphasis, or that other personas exist.
- The active persona is `loam.persona~<person>` (`{ active: string }`).

### 6.2 What a persona may change

| Changes | How | Never |
| --- | --- | --- |
| Name, pronouns, avatar as others see them | `presentation` | The actor's id or label in the journal |
| Density and theme | `persona-set` applies `defaults` through `appearance-set`'s code, in the same call | |
| Landing and project | At sign-in, by `session-settle`, each through `canOpen` and `decideAccess`; refused silently when not allowed | A switch never moves the person |
| Emphasis | `bandFor`'s comparator puts `emphasis.apps` first in their band with the `emphasized` part state; `palette-search` ranks their commands and `emphasis.sections` first | **Hiding.** Every app the person may open stays in the rail and every command in the palette |

**Persona never reaches a decision.** The persona id is the declared context field `persona`, `dev.loam/persona`, `journal: true`, set by the kernel only when the active persona is not `default`. It is not declared to a server, not given to apps, and **not an input to `decideAccess`, `checkedCall`, the grants, the auth gate, line 0 or the owner and human checks**. E2 holds it three ways:

- **A sweep:** every registered command through a person and an agent under two personas on twin stores, comparing each result's `ok`, `error.code` and `data`. Exempt from comparing `data`, but not `ok` or `error.code`: `persona-list`, `persona-create`, `persona-update`, `persona-remove`, `persona-set` (they read and write personas); `appearance-get` (a persona's defaults set it); `palette-search` (compared as a set, since emphasis orders it); `account-get` (its `persona` field) and `member-list` (its `presentation` fields).
- **A type:** `AccessInputV2`'s keys.
- **A scan:** no `persona` and no `activeOrganization` in `scope/access.ts`, `scope/middleware.ts`, `late/port-callable.ts`, `late/port-refusals.ts` or `late-identity`'s owner and human checks.

### 6.3 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `persona-list` | query | `{}` | `{ personas: PersonaV1[]; active: string }`, `default` first |
| `persona-create` | mutation, human | `{ title; presentation?; defaults?; emphasis? }`. An `emphasis.apps` id that is not an instance is `PERSONA_INVALID` | `PersonaV1`. Undo: `persona-remove` |
| `persona-update` | mutation, human | `{ persona; title?; presentation?; defaults?; emphasis? }` | `PersonaV1`. Undo restores |
| `persona-remove` | mutation, human | `{ persona }`; the active one becomes `default` in the same call | `{ removed: true }`. Undo: `persona-create` with the same id and fields |
| `persona-set` | mutation, human | `{ persona }` | `{ persona; previous }`. Undo: `persona-set { persona: previous }` |

`persona-set` announces "Persona: Reviewer" in the live region, and the title bar shows a non-default persona's title beside the name.

## 7. Memberships and owners (D87)

### 7.1 Who is an owner

**Decided by the owner on 2026-11-09 (D96, [Q1](#q1-who-counts-as-an-owner)):** in `provider` mode, a member whose role in the bound organization is **`owner` or `admin`**. Both are Loam owners. `createLoamAuthOptions` keeps the provider's admin powers consistent with that ([7.5](#75-the-providers-own-endpoints)): an `admin` holds in the provider every member and invitation power an `owner` holds, so nothing Loam lets an owner do is refused to an admin at the provider, and nothing the provider lets an admin do goes beyond a Loam owner. Two things no Loam owner does in the provider, of either role: changing or deleting the bound organization (no role holds `organization:update` or `organization:delete`), and, for an `admin`, granting or removing the provider's `owner` role, which decides only who may delete the organization and who is the last owner, and changes nothing in Loam. In `local` mode, every actor. `isOwner(membership, person)` in `scope/` is the only reader; each owner command takes a membership re-read top-level before dispatch (4.4), then line 0, `HUMAN_REQUIRED`, `OWNER_REQUIRED`, each refusal journaled.6), then `OWNER_REQUIRED`, each journaled.

**Owners can enter every project** (D96): an owner may add themselves to any project's members, a restricted one or one a team instance serves, by `project-update { access }`, journaled; `decideAccess` gives an owner nothing a member list does not, so the record says who entered and when.

**The last owner.** Better Auth 1.7 refuses leaving as the only owner (`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`, `…_WITHOUT_AN_OWNER`); Loam maps both to `MEMBER_LAST_OWNER` when the caller is leaving or demoting the last owner, and maps `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER` to `OWNER_REQUIRED` when an `admin` is removing an `owner`, which only an `owner` may do. Its `beforeRemoveMember` and `beforeUpdateMemberRole` hooks refuse removing or demoting the last `owner` too, the cases the provider's errors do not name.

### 7.2 Member commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `member-list` | query, recorded | `{ limit?: 1 to 200; offset? }` | `{ people: MemberV1[]; agents: AgentMemberRowV1[]; total }`. `MemberV1` is `{ id, name, image, role, presentation? }`; **`email` only when the person the call is for is an owner**. Agents are listed apart and never counted as seats |
| `member-invite` | owner, recorded | `{ email; role }`. Only an `owner`-role member may invite an `owner` | `{ invitation, expiresAt }`. Undo: `member-invitation-cancel`. **A person removed and invited again regains the restricted projects whose `members` still name them** (7.3), which the invite form says |
| `member-invitation-list`, `member-invitation-cancel` | owner, recorded | `{}`, `{ invitation }` | The pending invitations; `{ cancelled: true }` |
| `member-remove` | owner, recorded | `{ member }` | `{ removed: true; suspended: string[] }`. Revokes the person's sessions, consents and refresh tokens through `revoke-person` (4.3), and suspends the agent members they sponsor. No undo: invite again |
| `member-role-set` | owner, recorded | `{ member; role }`. Only an `owner`-role member grants or removes `owner` | `{ role; previous }`. Undo restores |
| `member-leave` | human, recorded | `{}` | `{ left: true }`, then `session-settle` |

Each mutation names the bound id, raises `memberEpoch`, and re-reads `MembershipV1`.

### 7.3 Projects and owners (#852)

- **A listed slug** is one a `workspace-app` record with `listed !== null` names in `projects`. For a listed slug, **`project-create` and `project-update { access }` are owner commands**, `OWNER_REQUIRED` for anyone else: "Only an owner can create or change the members of a project a team instance serves". The projection naming those slugs is public, so the message reveals nothing.
- **`PROJECT_SLUG_TAKEN` becomes `PROJECT_SLUG_UNAVAILABLE`,** one message, "That slug can't be used. Choose another", for a slug a project already has, a reserved one, or `all`. **Accepted by the coordinator, and stated:** a non-member can still learn that some project or reserved word holds a slug, since slugs are unique per workspace; they learn no name, member or content.
- **Other projects' members,** pending [Q2](#q2-who-may-change-a-projects-members). Written to the recommendation: `project-update { access }` by an owner or the project's `createdBy`; anyone else `OWNER_REQUIRED`. Any member of a restricted project may remove only themselves. An owner may always add themselves.
- **`PROJECT_MEMBER_SELF_REQUIRED`** applies to a non-owner only.
- **`PROJECT_MEMBER_NOT_PERSON`:** `access.members` holds person ids only.
- `project-update { access }` raises the project's `memberEpoch`.

**Where it holds.** Step 4 builds the rule in the kernel, so a browser enforces it for honest people; **it binds a team from step 10**, when the server's kernel holds `ProjectV1.access` and the relay decides with it ([2.5](#25-where-provider-mode-is-enforced)).

### 7.4 The workspace's apps

`workspace-app-set` becomes an owner command (D73's consequence), with the same "where it holds" as 7.3.

### 7.5 The provider's own endpoints

Better Auth serves its organization endpoints on the same origin, so a person can call them directly, around Loam's commands. **Every Loam rule about the organization is therefore written into the provider** by `createLoamAuthOptions`:

| Rule | In the provider |
| --- | --- |
| The bound organization cannot be renamed, re-slugged or deleted | Access control: no role holds `organization:update` or `organization:delete`; `beforeUpdateOrganization`, `beforeDeleteOrganization` refuse |
| No new organizations | `allowUserToCreateOrganization: false` |
| Owners are `owner` and `admin` (D96); who invites, who sets roles | Access control gives `admin` the same `member` and `invitation` permissions as `owner`; `beforeCreateInvitation` and `beforeUpdateMemberRole` refuse granting the `owner` role from an `admin` |
| The last owner | `beforeRemoveMember`, `beforeUpdateMemberRole` |
| Membership only through invitation | `beforeAddMember` refuses any add not from an accepted invitation |
| A removed person's credentials go | `afterRemoveMember` calls `revoke-person` |
| Connected agents | `loamServerPlugin`'s remove endpoint (`agent-member-remove`, with `forget`) requires the session's person to hold `owner` or `admin` in the bound organization, read for that request; its disconnect endpoint (`account-agent-disconnect`) requires `sponsor === session.user.id`; the list endpoint requires membership; consents and refresh tokens are deleted server-side by `clientId` and `userId` |

**Rules that live only in Loam's store** (project access, agent members, workspace apps, personas) are enforced by the hosted server's kernel and the relay; **in a browser they are cosmetic**, as 2.5 says.

### 7.6 Freshness

- **In a browser,** `MembershipV1` is read by the probe, on `session-settle`, on 4.3's refresh (focus, `online`, every 60 seconds while visible), and **again before every command in `OWNER_COMMANDS`, every `project-create`, and every `project-update` carrying `access`**, from `whoami`.
- **On the server,** the MCP chain, the trust-record transport and the relay read the member row for `(boundId, person)` **on every request**, with no cache: one indexed read in the provider's database.

## 8. Agent members (D90)

### 8.1 The record

```ts
export interface AgentMemberV1 {
	id: string;                    // `agt_` and 20 of [a-z0-9]
	workspace: string;
	kind: 'installed' | 'connected';
	name: string;                  // 1 to 80; for `connected`, the client's self-asserted name
	description?: string;          // up to 500
	sponsor: string;               // a person member's id; its `onBehalfOf`
	installedBy: string;           // the owner, or for `connected` the person who connected it (D98)
	client?: { id: string; host: string };   // `connected` only: the OAuth client id and its metadata document's host
	access: { workspace: boolean; projects: string[] | 'sponsor' };   // default { workspace: false, projects: [] }
	guidance?: string;             // up to 8 KiB; read by phase 5
	status: 'pending' | 'active' | 'suspended';
	suspended?: 'sponsor-left' | 'sponsor-declined' | 'disconnected' | 'owner';
	createdAt: number; updatedAt: number; updatedBy: string;
}
```

Table `agent-member` in the workspace store, indexed by `sponsor` and `client.id`. **No account at the provider:** no user row, email, password, passkey or session. That is "cannot sign in", and 3.2's `agt_` rule holds it against a forged adapter. `projects: 'sponsor'` means "whatever the sponsor may enter", which only a connected agent has by default.

### 8.2 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `agent-member-add` | owner | `{ name; sponsor; access?; description?; guidance? }` | The row, `pending`, or `active` when the sponsor is the caller (Q4). Undo: `agent-member-remove` |
| `agent-member-list` | query | `{ status?: 'active' \| 'pending' \| 'suspended' \| 'all' }` | `{ agents: AgentMemberRowV1[] }` |
| `agent-member-get` | query | `{ agent }` | `AgentMemberRowV1` |
| `agent-member-update` | owner | `{ agent; name?; description?; access?; guidance?; sponsor? }` | The row. **A new sponsor, or access wider than before, returns it to `pending`** unless the sponsor is the caller (Q4). Undo restores |
| `agent-member-remove` | owner | `{ agent; forget?: boolean }` | `{ removed: true }`. For an installed agent member, undo: `agent-member-add` with the same id and fields. **For a connected agent** (`agent` not in the kernel's `agent-member` table), **it writes `loam_connected_agent` through `loamServerPlugin`, is recorded, not re-run, in replay, and has no undo** (9.2) |
| `agent-member-confirm`, `agent-member-decline` | human, the sponsor alone (`AGENT_MEMBER_SPONSOR_ONLY`) | `{ agent }` | The row, `active` or `suspended: 'sponsor-declined'` |
| `agent-member-settle` | internal | `{ agents: { agent; suspended }[] }` | Persists a suspension observed on a membership read (8.3) |

**`AgentMemberRowV1` is filtered for the caller:** `access.projects` holds only the projects the caller's person may enter, with `hiddenProjects: number` for the rest; `guidance` only for an owner or the sponsor; plus the sponsor's `name` and `warnings`.

### 8.3 Sponsors

- **The sponsor must be a person member** (`AGENT_SPONSOR_INVALID`), and **may enter every project in `access.projects`** when the record is added or its access or sponsor changes (`AGENT_SPONSOR_INVALID`, naming those projects only to the owner who called).
- **The sponsor confirms** (pending [Q4](#q4-a-sponsor-confirms)): a record naming another person as sponsor is `pending` until that person runs `agent-member-confirm`, and widening its access asks again. A pending agent member is listed with its sponsor and allowed nothing.
- **Suspended when the sponsor leaves.** `decideAccess` reads the stored status. A membership read that finds a sponsor no longer a member runs `agent-member-settle`, journaled, which writes `suspended: 'sponsor-left'`, so the record says why; `member-remove` is followed by a top-level `agent-member-settle` (4.4). An owner reactivates one only by naming a new sponsor, which then confirms.
- **A lapsed project.** When the sponsor loses a project in `access.projects`, line 4's sponsor step refuses it at once; `agent-member-list` shows `SPONSOR_PROJECT_LOST` for the owner.
- **Visible with its sponsor.** The members tab lists each as "Name · Agent · Sponsored by Bea", in text, with its kind, status and visible projects. The journal records its calls with its actor and `onBehalfOf`, so audit names both.

### 8.4 How an agent member acts

- **Installed:** only through phase 5's delegation (D40). Phase 3 specifies its access (line 4), held by units over synthetic actors.
- **Connected:** over MCP from phase 3, as [9.2](#92-the-hosted-principal-mapping) maps it.
- **No other path:** the agent interface cannot name an `agt_` id (3.1), and the provider holds no account for one.

## 9. Over MCP and the hosted token layer (D91)

### 9.1 AFD first: the TypeScript layer

`spec/authorization.md` (M1 to M7) is specified, and Rust implements it; TypeScript does not. Steps 0a and 0c build it in `@lushly-dev/afd-server`, from the spec, with no change to the spec:

- **0a, verification:** `createMcpHandler({ auth })` with the spec's options; the bearer rules (M2) on every HTTP MCP route; `JwtVerifier` with a JWKS key source **on `jose` 6 (`^6.2.14`, already in the lockfile), through WebCrypto, RS256, ES256 and EdDSA**, and introspection as the alternative (M3), **the audience check of M3.1 not optional**; `credentials` on the context, never the token (M4); the 401 and 403 challenges and rule codes (M5); the RFC 9728 metadata routes (M7); fail closed (M1). It loads `spec/authorization.json`'s `bearer`, `challenges`, `metadataUrls`, `metadataDocuments`, `audience`, `scopeClaims`, `jwtHeaders`, `keys` and `claims`, and one test per M3 rule with keys made in the test. **It marks done the table's rows "Bearer token, verification, audience, credentials (M1 to M4)", "401 and 403, rule codes (M5)" and "Protected-resource metadata (M7)".**
- **0c, scopes:** static `scopes`, a `ScopeResolver`, the 403 before dispatch for `tools/call` including `afd-call`, `afd-batch` and `afd-pipe`, `INSUFFICIENT_SCOPE` after routing, listing with `filterToolsByScope`, hidden commands (M6); the `staticScopes` and `batches` cases. **It marks done "Static scopes, the resolver, the 403 before dispatch, `INSUFFICIENT_SCOPE`, listing (M6)", "A host's own layer running the decision before dispatch (M6)" and "Hidden commands (M6)".** The `tasks/*` row stays "Planned": TypeScript serves no tasks here.
- `/direct`'s entry budget is unchanged; `entry-points.test.ts` asserts the layer is outside its graph.

### 9.2 The hosted principal mapping

**Decided by the owner on 2026-11-09 (D98, [Q3](#q3-a-persons-own-external-agent-over-mcp)):** a person may connect their own external agent over MCP **without an owner's approval**. It is a **connected agent**, an agent member the person sponsors, so D40 holds for it: its access is at most the person's own; it never gets owner actions or changes to anyone's access, sign-in or sessions (`HUMAN_REQUIRED`, and those commands are not served over MCP); every action names both the agent and the person; owners see it in the members tab; and the person or an owner can disconnect it. The mapping is in two places, so that a refusal that is about the token is an HTTP 401 and one that is about Loam is a tool error:

**In `createMcpAuth`'s verifier** (the HTTP layer, before any command):

1. `credentials.issuer` equals the provider's issuer exactly. Otherwise `PRINCIPAL_ISSUER_UNKNOWN`, **a 401 with `error="invalid_token"`**, as M5 allows, failing closed.
2. `credentials.subject` is a person's id; an `agt_` subject is `AGENT_CANNOT_SIGN_IN`, a 401. **Pairwise subjects are forbidden:** `createLoamAuthOptions` sets no `pairwiseSecret`, and a client registering `subject_type: "pairwise"` is refused at registration.

**In `credentialsGate`** (the first middleware of the server kernel's chain, 9.5), `principalOf(credentials, server)`:

3. The connected agent is the record with `client.id === credentials.clientId` and `sponsor === credentials.subject` in `loamServerPlugin`'s connected-agent table (below). None, or not `active`: `AGENT_NOT_CONNECTED`, a tool error naming the account section's agents tab, since the token was valid.
4. **The actor is `{ kind: 'agent', id: <its agt_ id>, label: <its name>, onBehalfOf: credentials.subject }`.**
5. **The principal** is `{ actor, person: credentials.subject, membership, agent }`, with `membership` a `MembershipV1` holding only the subject's member row for the bound id, read on the server for this request (7.6), and `agent` the row step 3 read (9.5). `decideAccess` decides as for any agent member (3.3), with the record's `access`, which for a connected agent is `{ workspace: true, projects: 'sponsor' }` unless its person narrowed it.
6. `credentials` is on the context, never journaled, never in a result, never forwarded to a mounted instance (M4).

**Where connected agents live.** A connected agent exists only for the hosted server, so its record is in **`loamServerPlugin`'s own `loam_connected_agent` table in the provider's database**, authoritative in every phase, with `AgentMemberV1`'s shape and `kind: 'connected'`. The kernel's `agent-member` table holds installed agent members. `account-agent-list` and `member-list` read connected agents from the provider (`loamServerPlugin`'s `connected-agents` endpoint, by the session in a browser, by the server API on the server) and merge them with installed ones.

**Connecting** creates the record: the consent page ([9.4](#94-connected-agents-and-their-pages)), on the person's approval, runs `connectAgent`, which writes it to `loam_connected_agent` with `sponsor` and `installedBy` the person and status `active`. **`connectAgent` refuses a person who is not a workspace member** (`WORKSPACE_NOT_MEMBER`), so a token is never issued to a non-member's new connection. **The sponsor confirmation of Q4 does not apply,** since the sponsor is the person connecting it. **Disconnecting:** the person by `account-agent-disconnect` (5.3), an owner by `agent-member-remove`, each of which deletes the client's consent and revokes its refresh tokens. **An owner's removal keeps the record as `suspended: 'owner'`, and `connectAgent` refuses the same client for the same person while it stands** (`AGENT_DISCONNECTED_BY_OWNER`), so the person cannot simply reconnect what an owner removed; an owner lifts it with `agent-member-remove { agent, forget: true }`, which deletes the record. A person's own disconnect deletes the record, so they may reconnect. **The coordinator's reading of D98:** this holds the same client for the same person; it is not a ban on the person's agents, and the members tab says so.

**Served for the token's person with no session.** On the server, `account-get`, `persona-list`, `member-list` and `agent-member-list` read the provider through its server API by `principal.person`, never through a session, since a token's call has none.

**No autonomy policy before phase 5.** The autonomy policy (D41) is enforced from phase 5, so until then **a connected agent with `loam:write` can make any change its person can, without asking**, within the person's access and never an owner or human command. The consent page says so in words (9.4).

### 9.3 Scopes

| Scope | Needed by |
| --- | --- |
| `loam:read` | Every request (`requiredScopes`) and every query |
| `loam:write` | Every mutation, by `createMcpAuth`'s resolver reading the registry's `mutation` flag; a mounted instance's unreported command counts as one (D65) |

`scopesSupported: ['loam:read', 'loam:write']`, `filterToolsByScope: false`, so `tools/list` stays one list. Human and owner commands are not served, so no scope reaches them; `project-create` and `project-update` are served; an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` whose input has `access`, is `HUMAN_REQUIRED` from the handler (3.4).

### 9.4 Connected agents and their pages

The provider is the authorization server: `oauthProvider` with the JWT plugin and `@better-auth/cimd`, configured by `createLoamAuthOptions`:

- **One resource:** the hosted server's canonical MCP URI, `https://<host><base_path>mcp`, the only entry in `resources`, so every token's `aud` is exactly it (M3.1). **The JWT plugin's own `/token` route is disabled** (`disabledPaths: ['/token']`), and an access token issued without `resource` is opaque, which `createMcpAuth`'s JWT-only verifier refuses.
- **Lifetimes:** `accessTokenExpiresIn: 600` (10 minutes); `refreshTokenExpiresIn` 30 days, rotating on use, so the window slides with each refresh; `idTokenExpiresIn` default. JWT access tokens cannot be revoked (S86), hence the short lifetime.
- **Registration,** in MCP 2026-07-28's order: pre-registration by the deployer; then **Client ID Metadata Documents** (`@better-auth/cimd`); `allowDynamicClientRegistration: false` unless the deployer turns it on.
- **Grants:** `grantTypes: ["authorization_code", "refresh_token"]`, so `client_credentials` is off and every token has a person.
- **PKCE S256 required for every client**, confidential ones included: no exemption is configured, and a `before` hook on client registration and on the admin client APIs refuses `requirePKCE: false`.
- **The login page's flow:** the authorize endpoint sends a person with no session to `loginPage` with the signed authorization request; the page shows the sign-in dialog's methods (passkey first); on sign-in it resumes the authorization through `oauthProviderClient`, which continues the signed request to the consent page or the client. It never accepts a redirect target of its own.
- **`loginPage` and `consentPage`** are `<base_path>~/oauth/login` and `<base_path>~/oauth/consent`, rendered as **top-level pages** by the shell (`account` chunk), served by the hosted lane with `frame-ancestors 'none'` and `form-action 'self'` in their response CSP. The consent page shows:
  - **the client id's host** (the metadata document's URL host, or "registered by the deployer"), in bold;
  - the client's name **marked "name given by the app"**, since it is self-asserted;
  - **the exact scopes**, each in words ("Read what you can read in Acme", "Change what you can change in Acme");
  - **the redirect URI's host**, and for a loopback redirect (`localhost`, `127.0.0.1`, `[::1]`) the warning "This app runs on your own computer. Connect it only if you started it yourself";
  - that connecting creates an agent you sponsor, visible to owners, which you or an owner can disconnect;
  - **with `loam:write`, "This agent can make any change you can make in Acme, without asking you first"**, since no autonomy policy exists before phase 5 (D41).
  Approve calls `/oauth2/consent` with `accept: true` by `fetch`, then navigates to the returned redirect; Deny the same with `accept: false`.
- **The person sees and disconnects them** in the account section's agents tab (5.3).

### 9.5 The server kernel and its chain

**The server's kernel never runs a call as whoever an adapter has signed in, and every call on it, top-level or nested, runs under the request's principal.**

- **`createServerKernel(options)`**, in `identity`, builds the hosted server's kernel with `identity` **required and `mode: 'provider'`**, over `createKernelParts({ gate: 'principal', auth: createNoSessionAdapter() })`: it refuses `local`, so line 0 can never read everyone as a member and owner there.
- **One chain for every registry.** `createKernelParts` gains `gate: 'session' | 'principal'`, default `'session'` (the browser's, as today). With `'principal'`, the palette, agent and boot registries are all built over `[principalGate, journal, scopeMiddleware]`, so **a port call, a nested call and a handler's client go through the same gate as the top-level call**. `runAs` reaches the registry through `run` or `execute` depending on `unqueued` (`kernel.ts:509-511`), and **the principal is copied on both**. No afd-auth middleware is on the server kernel; its `auth` is `createNoSessionAdapter()`, always `unauthenticated`, which nothing reads.
- **The principal** is `{ actor, person, membership, agent? }`, carried in `KernelCallFields.principal`, a kernel-only field never declared to a server, never journaled whole (the journal keeps `actor`), and **never on an app handler's context**. `checkedCall`, the nested client, the surface port and the port refusals (`app-*-refuse`) copy it with `actor` (3.1). `membership` is a `MembershipV1` holding **only the principal's person's row**; a command that names another person, such as `agent-member-add`'s sponsor check, reads that person's row from the provider for that request. `agent` is the connected agent's row `principalOf` read, so line 4 of `decideAccess` has it.
- **`principalGate`'s sources.** It sets `context.actor` from the principal, and refuses a call with none (`UNAUTHORIZED`), but these:
  - **A token's call over MCP:** `credentialsGate`, the MCP handler's own first middleware, refuses a call with no `context.credentials` (the HTTP layer has already answered 401 for a missing token; this is the fail-closed backstop), runs `principalOf` (9.2, steps 3 to 6), and sets the principal.
  - **A browser's trust-record call** (10.2's item 4): it carries the session cookie. Before reading the session, the transport and the relay accept only `POST` with `Content-Type: application/json`, refuse a request whose `Origin` is absent or not exactly the deployment's origin, and refuse `Sec-Fetch-Site` other than `same-origin` when present (`403`, nothing run); no CORS is served on either route. The session cookie is host-only (`__Host-`/`__Secure-` prefix, no `Domain`). Better Auth's own origin check (`api/middlewares/origin-check.mjs`) covers only its own endpoints, so these routes carry their own; `createLoamAuthOptions` leaves `crossSubDomainCookies` off. The server then verifies the session with the provider (cookie cache off) and builds the principal `{ actor: { kind: 'human', id, label }, person, membership }`, with `membership` the person's member row for `(boundId, person)`, read for this request with no cache (7.6); a user id starting `agt_` is `AGENT_CANNOT_SIGN_IN`; no session is `UNAUTHORIZED`. **A session-authenticated call is always the human; the server never takes an actor kind from the browser.** The browser forwards trust-record calls only from `kernel.call`, never from its agent interface, so a cookie-forwarded call is always the person's own.
  - **Boot's own work:** a call made with `BOOT_FIELDS` (`kernel.ts:427-428`, compared by reference) passes with no actor, as `workspace-deployment-apply`, `app-settle` and `document-trash-expire` run from `startApps`.
  - **The instance refresh:** `startInstances`' refresh runs with the kernel's own `INSTANCE_FIELDS`, an object compared by reference like `BOOT_FIELDS` (it calls `run('palette', 'app-instance-refresh', …)` with no fields today, `kernel.ts:740-745`), and passes with no actor.
  - Nothing else can pass either object.
- **The scope runtime reads the call.** `scopeMiddleware`, `ScopeRuntime.allows`, `canOpen`, `opensIn`, `checkResource`, `project-list`'s filter and `isOwner` read membership through `membershipOf(context)` and an agent member through `agentOf(context)`: on the server, `context.principal.membership` and `context.principal.agent`; in a browser, the kernel's `MembershipV1` and its `agent-member` table. Nothing on the server reads kernel-wide membership or session state.
- **No session logic on the server.** With `gate: 'principal'`: `late.before`'s change-of-actor step (phase 2's 3.4) is skipped; `session-settle`, `membership-settle` and `agent-member-settle` are not registered, since the server reads each person's membership per request; `mcpOptions()` omits its page-event middleware, whose first step reads `sessionActor(deps.auth)` (`late/index.ts:318-352`); and stage A's `chooseScope` (`kernel.ts:676-684`) sets the workspace without reading the adapter.
- **Commands:** `mcpOptions().commands`, less `HUMAN_COMMANDS` (3.4's second and third rows) and `OWNER_COMMANDS`; `project-create` and `project-update` stay, and **an agent's `project-create` of a listed slug, and any agent's `project-create` or `project-update` whose input has `access`, is `HUMAN_REQUIRED`** from the handler (3.4).

### 9.6 Proof before the hosted lane

**E8, through a test-only handler:** a real `createMcpHandler` from step 0a with `credentialsGate` and `createMcpAuth`, on loopback `node:http`, over **`createKernelParts({ gate: 'principal', auth: <a Mock>, identity: { mode: 'provider', … } })`**, not `createServerKernel`, which always uses the no-session adapter. **The Mock's signed-in person is an owner and a member of the restricted project; the refused token's person is neither**, so any fallback to the adapter would turn a refusal into an allowed call; a test-only auth host issuing real tokens from Better Auth's `oauthProvider`; AFD's `StreamableHttpTransport`. It lives in `identity/src/mcp-identity.test.ts`.

## 10. The dependency on phase 6's hosted lane (D84)

### 10.1 The exit, in two parts

| Part | Criterion | Proved by | Needs |
| --- | --- | --- | --- |
| **Local** | Passkey sign-in; persona changes emphasis and never what anyone may do; a revoked session signs out every tab; an owner's agent member appears with its sponsor and cannot sign in; a token for the wrong audience is refused by AFD's layer | P3-E1 to P3-E20, through a test-only auth host and a test-only handler, in `loam.yml` | Nothing outside this phase |
| **Hosted** | The same on the hosted lane's development profile, with the server's kernel and the mount relay enforcing the rules against the server's records | P3-H1 to P3-H5 | Phase 6's development profile (10.2) |

**Phase 3 exits when both pass.** The local run is recorded as "local criterion met, through a test-only auth host and handler", which unblocks nothing: phase 5 needs phase 3's exit and phase 6's hosted lane anyway, and phase 4 needs neither.

### 10.2 What phase 6 must deliver first

1. One Node process on Hono (D36) serving the built shell under `base_path`, with phase 0's CSP as response headers, `frame-ancestors` among them, and the OAuth pages' stricter CSP (9.4).
2. Better Auth at `<base_path><identity.path>`, from `createLoamAuthOptions`, with its database in the profile's data directory and a mail sink; and a one-time server command that runs `bootstrapOrganization` (5.6), the only way the first organization, its binding and its first owner come to exist.
3. `createMcpHandler` at `<base_path>mcp`, through Hono's Node adapter, over `createServerKernel` with `credentialsGate` and `createMcpAuth` (9.5); RFC 9728 metadata at its well-known path.
4. **A server kernel whose store is authoritative** for `ProjectV1.access`, `AgentMemberV1` and `WorkspaceAppV1.overrides` (2.5), and the transport by which a browser's trust-record commands run there. That transport carries the session cookie, and the server builds the call's principal from it as 9.5's second source says: always the human, never an actor kind the browser sends. Before reading the session, the transport and the relay accept only `POST` with `Content-Type: application/json`, refuse a request whose `Origin` is absent or not exactly the deployment's origin, and refuse `Sec-Fetch-Site` other than `same-origin` when present (`403`, nothing run); no CORS is served on either route. The session cookie is host-only (`__Host-`/`__Secure-` prefix, no `Domain`).
5. **The mount relay enforces:** each browser request to `mounts/<instance>/mcp` carries the session cookie. Before reading the session, the transport and the relay accept only `POST` with `Content-Type: application/json`, refuse a request whose `Origin` is absent or not exactly the deployment's origin, and refuse `Sec-Fetch-Site` other than `same-origin` when present (`403`, nothing run); no CORS is served on either route. The session cookie is host-only (`__Host-`/`__Secure-` prefix, no `Domain`). The relay then verifies the session with the provider, reads membership on the server, runs `decideAccess` version 2 and phase 2's 9.2 against the server's records for the request's `dev.loam/scope`, and refuses (`PROJECT_NOT_FOUND`, `WORKSPACE_NOT_MEMBER`, `MOUNT_PROJECT_NOT_LISTED`) before forwarding.
6. A development profile over HTTPS on `localhost` with a generated certificate, started by one command, and a `loam.yml` job named **`Hosted development profile`** whose step **`Hosted criterion against the development profile`** runs Chromium against it with the verbose reporter, which the exit check reads.

### 10.3 The order, recommended for the coordinator to decide

**Decided by the coordinator on 2026-11-09, as recommended.**

**Recommended: approve and start phase 3 now; write phase 6's specification next, hosted lane first, with 10.2 as its development profile's minimum; phase 3's step 10 waits for that profile.**

- Most of phase 3 needs no server: steps 0a to 9 are proved locally, as phase 2 proved scope over MCP before any host.
- #852 and #853 are conditions of any multi-member deployment, and the hosted lane is the first one; settling the rules first means it is built against what it must enforce.
- The token layer is AFD's, and phase 6 consumes it.
- Phase 4 is unaffected.

**The alternative,** phase 6's hosted lane first, needs no test-only host and proves phase 3 once, on the real host; it delays the rules the lane must enforce, or builds its auth wiring before they exist. The test-only host is small and keeps proving the browser path in `loam.yml` after phase 6 lands.

## 11. Journal, replay and secrets

- **No secret is journaled.** `redactJournalRecord` keeps removing `input.password` from `auth-sign-in`, **and nothing else changes**: no other command takes a secret, which E13's scan holds (no input property named `token`, `password` but `auth-sign-in`'s, `secret`, `code` or `cookie`). Join and recovery tokens, passkey challenges and assertions, cookies and access tokens never pass through a command's input or result. `credentials` is never journaled (M4). E15 scans for them.
- **Personal data.** Actor ids and labels, as today; persona titles in `persona-*` inputs; members' emails only in an owner's journal.
- **Replay.** Recorded identity commands answer from their entries; `session-settle`'s input carries the person and membership digest, which drive the replay's Mock; `diffJournals` ignores what it ignores today.

## 12. The kernel and the SDK

- **Kernel interface version 3.** `KernelEventV3` adds `actorChanged?: true` and `personaChanged?: true`. `call` and `agent.call` take `options.agent` (3.1). `shell-info-get` reports `identity: { mode, organization: slug }`. `KernelCallFields` gains `actor` (3.1). `KernelPortsV1` gains `schedule(at, fn)` for the expiry timer.
- **`KernelOptionsV3`** adds `identity?: IdentityV1` and `membership?: MembershipV1` (stage A's, from the probe).
- **The SDK.** An app's handler context gains **`actor?: Readonly<ActorV1>`**, `{ kind, id, label?, onBehalfOf? }`, **optional**: absent for a signed-out `local` call. It is additive, an SDK minor; no existing app breaks. Never an email, a session, a persona, a role or a credential. `AccountSectionV1` types `ui.account`. `createAppTestKernel` takes `actor`.
- **Domains.** `member` joins `SHELL_DOMAINS_V1`; the others are there.
- **Store tables** `persona` and `agent-member` join the workspace store's tables, with their indexes.

## 13. Budgets

Against phase 2's [2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule): first paint is 286,084 bytes and 88,196 gzip of 300,000 and 91,000. **2.4's rule stands: a step that adds first-paint code first moves code out, or takes an allowance the coordinator approved.** The coordinator checked the per-step allowances below and approved them on 2026-11-09, after the re-check of `cfabbb2d`. Account UI, passkey code and the provider's client are lazy.

| Step | First-paint parts | Allowance (bytes, gzip) |
| --- | --- | --- |
| 0b | afd-auth, through the web host's Mock and the kernel's auth middleware: `refresh()`, the clock and `expiresAt`, the passkey branch of `signIn`, and the middleware's verified-credentials branch, with its refusal of `auth-*` commands on a token's call and its `clock` (4.1). **Amended in step 0b (coordinator, 2026-11-09):** the Mock's capabilities are `/mock-capabilities`', attached on the `late` path (4.1), so none of them is first paint. Measured 286,886 and 88,497 against 286,084 and 88,196 on `main` at `37f383c0`; the kernel alone 112,171 (from 111,761) and `late` 67,766 (from 67,609, `auth-sign-in`'s passkey branch). **Approved by the coordinator 2026-11-09, after the review round:** the review's token-call refusal and shared clock added 119 and 47 to the 683 and 254 first approved (cap 700, 280) | 802, 301 (cap 820, 310) |
| 1 | `decideAccess` version 2, `personKey`, `isOwner` (~500); reading `identity` and `MembershipV1` from boot (~300); line 0 (~150); `personalRecordId` (~150); the person captured in `run` for `SESSION_CHANGED` (~80). **`SIGNED_OUT_COMMANDS` and `MEMBER_EXEMPT_COMMANDS` are not first paint:** stage A holds only boot commands, which the chain already excludes as today, and the lists load with `late`, where the late commands register. **Measured in step 1 (coordinator, 2026-11-09):** 288,583 and 89,185 against 0b's 286,886 and 88,497, **+1,697 and +688**. The first build measured +3,387 and +1,244; the coordinator declined a larger allowance and set a target of 1,700 and 750 after four cuts: the agent interface waits for stage B, whose `late` names its actor and checks `options.agent`; stage A boots a version 3 projection as `local` only when its `identity` is absent or exactly `{ mode: 'local' }`, anything else as `provider`, signed out, and stage B's `readProjection` checks it in full; first paint's personal store holds only what stage A reads (`get`, `list`), and `late` attaches its writes; `isOwner` and line 0 are `late`'s, 13's own fallback for the kernel's row | 1,200, 500; **target 1,700, 750; measured 1,697, 688** |
| 2 | **None.** The listener, the expiry timer, the `schedule` port's use and the membership refresh are `late`'s (4.4) | 0, 0 |
| 3 | The probe and `DeferredAuthAdapter` (~900); the signed-out main's button (~450); the not-a-member and binding notices (~350); stage A's `whoami` read wired into boot (~200) | 1,950, 800 |
| 5 | Persona emphasis in `bandFor` (~500); stage A's read of `loam.persona~<person>` (~200) | 750, 300 |
| **Total** | | **5,199, 2,089** with 0b's and step 1's measured rows (4,702 and 1,901 before step 1's, 3,900 and 1,600 before 0b's): first paint to about 291,300 and 90,300, under 300,000 and 91,000 |

The ceiling stays: about 291,300 is 97% of it, above phase 0's 70% lowering threshold.

| Row | Where | Estimate | Note |
| --- | --- | --- | --- |
| `kernelMinified` | The kernel alone | +1,100 | Step 1's first-paint parts but the boot read, which is the web host's: 111,761 to about 112,860 of 113,401. Step 1 measures first; if the row would pass, it moves **line 0 and `isOwner` into `late`'s `LateScope.before`**, given a refusal return so line 0 stays first (3.3), as phase 2 put lines 2 to 6 in `LateScope`: stage A holds only boot commands, which line 0 exempts, so nothing in stage A needs them. `personalRecordId` stays in first paint, since stage A reads a person's `loam.scope` with it, which E1's reload restore needs. **Step 1 took the fallback and measured 114,364, the row's ceiling from then, approved by the coordinator 2026-11-09** |
| `auth` (new) | Stage B, `provider` only | 58,500 | Better Auth 1.7.18's client with both plugins measured 54,636; `BetterAuthAdapter` ~2,400; `SessionSync` ~1,500 |
| `late-identity` (new) | Inside `loadLate`, in both modes | 16,000 | Every command of sections 4 to 8, `session-settle` and `agent-member-settle` |
| `late` | | +3,500 | Owner checks in `project-*` and `workspace-app-set`, `HUMAN_COMMANDS` and `OWNER_COMMANDS` in `mcpOptions`, the auth gate's two lists (~650), the listener, expiry timer and membership refresh of 4.4 (~1,200). 67,609 of 75,000. **Step 1 measured 70,597** (the auth gate and its lists, line 0, the agent interface's actor, the agent-member table, the personal store's writes) |
| `sign-in` (new) | When "Sign in" is pressed | 5,000 | |
| `account-menu` (new) | When the account button is pressed | 4,000 | |
| `account` (new) | The account section, the join and recovery pages, the OAuth pages | 46,000 | `sections` is not touched |
| `apps` | | Measured by step 8 first | 393,918 of 394,094: step 8 moves code out or amends the row by its measurement (5.5). **Step 1 raised it by 800, to 394,894, approved by the coordinator 2026-11-09,** measuring 394,894: stage B's full check of a version 3 projection's `identity`, the one that fails closed (822), the outer actor on port, nested and refusal calls (88), the version 3 deployment rows (53), `member` (9). Ajv's code for `identity` would have cost about 6,700, so `readProjection` reads it by hand, held equal to `projection.v3.json` by a test |
| `surfaces` | | +300 | An account section through a surface port |

The `budget` script's closures gain the new chunks in load order (first paint, `late`, `late-identity`, `auth`, `apps`, `surfaces`, then the rest). E10 asserts first paint's exact chunk list in both modes.

## 14. Accessibility

Phase 0's and 2's rules stand: axe with phase 0's tags in every theme and density, forced colors and the compact class, Specimen captures with ARIA snapshots, F6's order, and the `loam-design` checklist.

- **The sign-in dialog:** a modal named by its heading; focus starts on "Sign in with a passkey"; a visible label on the email field; a failed or cancelled ceremony announced in the dialog's live region with focus kept; Escape returns focus to the account button. The browser's WebAuthn prompt is outside the page, and the test says so.
- **The account menu:** a menu button; the persona switch a group of `menuitemradio` with `aria-checked`; a switch announced.
- **The account section:** a `tablist` of links; captioned tables; "This device" in text; buttons naming their row; destructive actions confirmed in a shell modal with the consequence in words; `REAUTH_REQUIRED`'s prompt explains why.
- **The join, recovery, login and consent pages:** one heading, one primary action, no time limit shown without words for it ("This link expires at 14:30"), the consent page's warnings as text, not color.
- **Members:** "Agent", its kind and "Sponsored by <name>" in text; status never by color alone; owner controls absent, not disabled, for a non-owner.
- **Emphasis:** a part state with a non-color cue visible in forced colors; the rail's reorder announced only on a switch.
- #708's screen-reader passes stay open; E11's record says what axe cannot judge.

## 15. Failure modes and error codes

Every code has a suggestion and is added to `LoamKernelErrorCode`, afd-auth's `AuthAdapterError` (and `spec/error-codes.md`'s auth list), the deployment's refusals or the manifest's. Each is covered by a unit or an exit test. Phase 2's section 12 stands, but `PROJECT_SLUG_TAKEN`, replaced.

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `WORKSPACE_NOT_MEMBER` | Line 0 (3.3) | A failure, journaled | Ask an owner of <organization> to invite you; `account-invitation-list` |
| `OWNER_REQUIRED` | An owner command by a non-owner | A failure, journaled | Ask an owner |
| `HUMAN_REQUIRED` | A human command from an agent | A failure, journaled | A person must do this in the shell |
| `REAUTH_REQUIRED` | A fresh-session command with an older session (5.2) | A failure | Sign in with a passkey again |
| `SESSION_CHANGED` | A call queued across a change of person (4.4) | A failure, retryable, journaled | Run it again as the person now signed in |
| `AGENT_CANNOT_SIGN_IN` | A person id or token subject starting `agt_` | Signed out; a 401 | Agent members act through delegation or a connection |
| `AGENT_NAME_RESERVED` | `options.agent` reserved (3.1) | A failure | Choose another name |
| `AGENT_NOT_CONNECTED` | A token's client with no active connected agent for its subject | A tool error | Connect it in the account section |
| `AGENT_DISCONNECTED_BY_OWNER` | `connectAgent` for a client an owner removed for this person (9.2) | Refused on the consent page | Ask an owner |
| `SIGN_OUT_FIRST`, `ACCOUNT_EXISTS` | A join or recovery registration with a session present; a join for an email with an account (5.8) | 400, 409 at the provider | Sign out; sign in and accept the invitation |
| `AGENT_MEMBER_NOT_FOUND`, `AGENT_SPONSOR_INVALID`, `AGENT_MEMBER_SPONSOR_ONLY` | Section 8 | A failure | Per row |
| `PROJECT_MEMBER_NOT_PERSON`, `PROJECT_SLUG_UNAVAILABLE` | 7.3 | A failure | Per row |
| `MEMBER_LAST_OWNER` | 7.1, and Better Auth's two last-owner errors mapped | A failure | Make another owner first |
| `MEMBER_INVITATION_REQUIRED` | The provider's `beforeAddMember` hook: a member added but by an accepted invitation (7.5). Added in step 1, since no Better Auth code fits | 403 at the provider | Invite them with `member-invite` |
| `MEMBER_NOT_FOUND`, `INVITATION_NOT_FOUND` | 7.2, 5.3 | A failure | Per row |
| `SESSION_NOT_FOUND` | `session-revoke` | A failure | `session-list` |
| `SIGN_IN_METHOD_UNAVAILABLE` | The kernel's wrapper of `auth-sign-in` (4.6) | A failure | The methods allowed |
| `PASSKEY_CANCELLED`, `PASSKEY_UNSUPPORTED` | afd-auth's adapter | A failure; not retryable by an agent | Per row |
| `PASSKEY_NOT_FOUND`, `PASSKEY_LAST` | 5.2 | A failure | Per row |
| `PERSONA_NOT_FOUND`, `PERSONA_LIMIT`, `PERSONA_INVALID` | Section 6 | A failure | Per row |
| `IDENTITY_PROVIDER_UNAVAILABLE` | The provider did not answer | A failure, retryable | Try again |
| `IDENTITY_ORGANIZATION_UNKNOWN`, `IDENTITY_BINDING_MISMATCH` | 2.3 | Shown in main; a server warning | Fix the binding on the server |
| `DEPLOYMENT_IDENTITY_INVALID`, `DEPLOYMENT_STDIO_TEAM` (D95) | 2.2 | `deployment write` stops; the hosted server will not start | The fix; for `stdio`, an HTTP instance |
| `MANIFEST_ACCOUNT_LIMIT`, `MANIFEST_ACCOUNT_MOUNTED`, `MANIFEST_ACCOUNT_SURFACE_UNKNOWN` | 5.5 | The package is refused | The fix |
| `PRINCIPAL_ISSUER_UNKNOWN` | 9.2 | 401, `invalid_token` | Configure the issuer |
| afd-auth's `UNAUTHORIZED`, `TOKEN_EXPIRED` | Signed out or expired in `provider` mode | A failure, journaled | `auth-sign-in` |

## 16. Security

- **Cross-site requests.** The trust-record transport and the mount relay are cookie-authenticated routes outside Better Auth's origin check, so each refuses anything but a same-origin JSON `POST` before reading the session, and serves no CORS (9.5, 10.2); the session cookie is host-only.
- **The browser is not a boundary against its holder.** A browser kernel's checks are right answers for honest people and separation between people sharing a profile; anyone holding the profile can read its store and change its code. The boundaries are the provider, the hosted server's kernel and the mount relay (2.5). Until step 10, a `provider` deployment's trust records live in each browser and bind nobody but that browser's honest users.
- **The CSP.** The shell's does not change: the probe and the provider are `connect-src 'self'`. The OAuth, join and recovery pages add `frame-ancestors 'none'` and `form-action 'self'` on the hosted lane.
- **The provider is same-origin and pinned.** `trustedOrigins` is the one origin; the passkey `rpID` is the exact host; cookies are `Secure`, `HttpOnly`, `SameSite=Lax`; no `bearer` plugin.
- **The organization is bound by id** and cannot be renamed, re-slugged, deleted or out-created (2.3), so a slug cannot be claimed into a workspace.
- **No open sign-up;** verified email for every invitation and link; join and recovery tokens single-use, hashed, short-lived (5.6, 5.7).
- **Revocation** is immediate at every enforcement point; a revoked device's tab shows it at its next refresh, and its local store stays readable to whoever holds that device, as above. Issued JWT access tokens live out 10 minutes.
- **Shared browser profiles** share history, which keeps the slugs of restricted projects a person visited (phase 2's note); on sign-out the shell replaces the current history entry with the workspace's root; the account section says "Use your own browser profile on a shared computer".
- **Tokens** are never in a browser's journal, store, results or logs; audience-bound; refused in the query string; never forwarded to a mounted instance or an app.
- **`local` mode** is not authentication, and says so.
- **Connected agents act without asking until phase 5** (D41, D98): a connected agent with `loam:write` can make any change its person can, within the person's access and never an owner or human command; the consent page says so, the journal names the agent and the person, and the person or an owner can disconnect it.
- **No `stdio` instance in a shared workspace** (D95): a `provider` deployment refuses one, so no program runs as the server's own user on every member's behalf.
- **Native apps** remain trusted code (D54): `context.actor` is a contract for one and a boundary for a view.

## 17. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 3 |
| --- | --- | --- |
| Installed agent members acting: delegation, guidance, runs | Phase 5 (D40) | `guidance`; line 4; `options.agent` |
| Settings, autonomy | Phase 4 | `ui.account`'s surface; `emphasis.sections` |
| The hosted lane, its server store, the relay's transport | Phase 6 | 10.2 |
| Revalidating a live collaboration session on a membership change | The collaboration service (D46) | `memberEpoch` on the workspace and project |
| Account deletion and data export | A follow-up | The actor on every record |
| Providers other than Better Auth | A follow-up | `identity.provider` |
| Several organizations per deployment | Not planned (D32) | The binding |
| DPoP or certificate-bound tokens | When AFD's TypeScript layer adds them | The verifier's options |

## 18. Exit criterion and tests

The phase exits when every test below passes on `main` in the place its row names, and STATUS.md records the runs, with "through a test-only auth host" beside the rows that use it and "through a test-only handler" beside E8, each named as what it does not prove. **Every exit test's title starts `P3-E<n>:` or `P3-H<n>:`, but E12's, which are phase 2's own.** Places, as `scripts/loam-exit-check.mjs` matches a job and a step by name:

| Place | Job | Step |
| --- | --- | --- |
| Units | `Build, unit and Chromium` | `Unit suites with coverage` |
| Chromium | `Build, unit and Chromium` | `Chromium suite against the built shell (phase 0's E1 to E10, phase 1's so far, A1 to A3; the walk is its own job)` |
| Identity path | `Build, unit and Chromium` | `AFD's identity path` (new) |
| Budget | `Build, unit and Chromium` | `Bundle budget` |
| Mounted | `Mounted against Umbel` | `E3, E4 and E9's mounted part, through a test-only relay` |
| Hosted | `Hosted development profile` (phase 6) | `Hosted criterion against the development profile` |
| Editor walk | `Editor walk` | `The editor area's seeded walk, every seed, thirteen invariants after each step` (phase 2's, for E12 only) |

| # | Criterion | Place | Test |
| --- | --- | --- | --- |
| P3-E1 | **A person signs in with a passkey**, through a test-only auth host | Chromium; Units | On `methods = ["passkey", "password"]`: a seeded person signs in with a password, adds a passkey, signs out, signs in with "Sign in with a passkey" and by autofill; the actor is the provider's user id; `auth-sign-in { method: 'passkey' }` journaled with no credential; a reload inside their restricted project restores it from the probe. **A virtual authenticator with `isUserVerified: false` is refused.** A cancelled ceremony keeps focus. Units: the passkey method over the Mock; `SIGN_IN_METHOD_UNAVAILABLE`; the signed-out lists' unit (2.1) |
| P3-E2 | **Persona changes emphasis, never what anyone may do** | Units; Chromium | Chromium: `persona-set` reorders and marks hello and tasks, ranks their commands first, applies density, announces it, moves no scope. Units: 6.2's sweep with its exemptions, `AccessInputV2`'s keys, the scan (persona and `activeOrganization`), another person's persona read as missing, what other members see |
| P3-E3 | **A revoked session signs out every tab**, through a test-only auth host | Chromium | Two tabs of one context and a second context: revoking the second context's session, its next provider request is refused at once, and on `visibilitychange` its page shows "Sign in" within 2 seconds with nothing restricted in the deep DOM; `session-revoke 'all'` (after a fresh sign-in) signs tab B out within 2 seconds by `SessionSync`, deletes the person's consents and marks their refresh tokens, `offline_access` included, revoked (read from the host's database); `session-settle` in both tabs' journals; a stale session gets `REAUTH_REQUIRED`; **`session-list` succeeds 301 s after sign-in** |
| P3-E4 | **A session ends with no command** (#854, #864) | Units; Chromium | The Mock's `expiresAt` on a fake kernel clock fires `session-settle` with no call, journaled with its input; the restricted project left; the projects list loses the name with no other read; a replay has zero differences and never fires the timer. A change of person closes the app, dismisses its overlays, holds a draft, and refuses a call queued across it with `SESSION_CHANGED`. `SESSION_50` byte-identical |
| P3-E5 | **An agent member installed by an owner appears with its sponsor and cannot sign in**, through a test-only auth host | Chromium; Units | An owner adds one with Bea as sponsor: pending, "Agent · Sponsored by Bea", confirmed by Bea; the provider's user table has no row for it. Non-owner `OWNER_REQUIRED`; agent `HUMAN_REQUIRED`. Units: an adapter user id `agt_…` signed out with `AGENT_CANNOT_SIGN_IN`; `AGENT_NAME_RESERVED`; line 4 in every case, the intersection with the sponsor, `onBehalfOf` not the sponsor refused; widening access returns it to pending; a sponsor's removal persisted by `agent-member-settle`; `PROJECT_MEMBER_NOT_PERSON`; list and get filtered to the caller's projects; no agent counted as a seat |
| P3-E6 | **Owners, and #852 in the kernel** | Units; Chromium | Non-owner `project-create` with a listed slug and `project-update { access }` on a listed project, `OWNER_REQUIRED`; an owner's succeed. `workspace-app-set` by a non-owner refused. `PROJECT_SLUG_UNAVAILABLE` byte-identical for a restricted project's slug, a visible one's and a reserved one. Q2's rule as answered. `MEMBER_LAST_OWNER` from Loam's hooks and from Better Auth's own error, each mapped. The owner role re-read before an owner command, so a demoted owner is refused at once |
| P3-E7 | **Membership, the binding, and the ports** | Chromium; Units | A signed-in member of another organization sees "You are not a member of Acme" and their invitation, accepts it (verified email), enters. Units: line 0 for every command not exempt; **an `agt_` actor's nested workspace read through a port refused, the nested call journaled as the agent**; the actor copied on every port, surface port and nested path; every new command through a port `CALL_NOT_GRANTED`; `call-scope.test.ts` |
| P3-E8 | **Identity over MCP, and the wrong audience refused**, through a test-only handler (#853) | Units (`identity/src/mcp-identity.test.ts`) | `createKernelParts({ gate: 'principal', auth: <a Mock>, identity: { mode: 'provider', … } })` whose signed-in person is **an owner and a member of the restricted project**, while the refused token's person is neither (9.6); tokens from the test host: no token 401; another audience 401; a JWT-plugin `/token` token refused; an opaque token issued without `resource` refused; another issuer 401 `invalid_token`; a pairwise registration refused; `connectAgent` for a non-member refused. The right token runs as the connected agent (`agt_…`) acting for the token's subject, never the kernel's person: it enters the subject's restricted project; a non-member of that project gets `PROJECT_NOT_FOUND`; **a `probe` app command, called over MCP, makes a nested read in a restricted project: allowed for the token's person, refused for another person's token, and the nested entry journaled with the `agt_` actor**; `project-create` with a listed slug over MCP is `HUMAN_REQUIRED`; a token whose client is not connected `AGENT_NOT_CONNECTED`; **`WORKSPACE_NOT_MEMBER`** for a connected agent whose person's member row the test then deletes directly in the host's database, as a provider-side removal that bypassed Loam's hooks would; a read-only token's mutation 403; human and owner commands `COMMAND_NOT_FOUND`; **a direct non-owner call to `loamServerPlugin`'s remove endpoint, with and without `forget`, is `OWNER_REQUIRED` and the record is unchanged, and a direct disconnect of another person's agent is refused the same way**; `createServerKernel` refuses `local`; the boot commands run with `BOOT_FIELDS` and `startInstances`' refresh with `INSTANCE_FIELDS`, each with no principal, and nothing else does; no call reads the adapter; `tools/list` equal across tokens; no entry or result holds a token or `credentials` |
| P3-E9 | **AFD's TypeScript layer conforms** | Identity path | `packages/server`'s suite loads every case 0a and 0c name and one test per M3 rule; `packages/auth`'s covers the capabilities, the credentials backstop (4.1), and `BetterAuthAdapter` over a stubbed client |
| P3-E10 | **Budgets** | Budget; Chromium | Every row of section 13 under its ceiling. Chromium: an empty `local` shell's first paint requests exactly phase 2's chunks, and stage B loads `late-identity` beside `late-documents` but never `auth`, `sign-in`, `account-menu` or `account`; a `provider` shell's first paint adds only `identity.ts`'s code and the probe's request |
| P3-E11 | **Accessibility and captures** | Chromium | Section 14's elements and pages under axe and Specimen; the keyboard path through sign-in, enrolment, passkey add, revoke, persona switch and consent |
| P3-E12 | **What exited stays exited** | Phase 2's places and minimums | Phases 0's, 1's and 2's exit tests pass in `local` mode, amended only by 2.1's table, each amendment listed in the step that makes it. **The exit check reuses phase 2's rows and minimums for this row,** reading the `P2-E<n>:` and `P2-D<n>:` titles in the jobs and steps `loam-exit-check.minimums.json` names, the `Editor walk` job included; there is no `P3-E12:` title |
| P3-E13 | **Placement and inputs** | Units | No import of `@lushly-dev/loam-identity` from `web/src`, `chrome/src` or `kernel/src`; no input property named `token`, `password` (but `auth-sign-in`'s), `secret`, `code` or `cookie` |
| P3-E14 | **An app's account section** | Chromium; Units | Hello's `ui.account` renders at workspace level with a project active, its port refusing any other scope; a case per schema branch and refusal |
| P3-E15 | **No secret in the journal or the store** | Chromium; Units | After E1's, E3's, E8's, E17's and E18's sessions: no seeded password, cookie value, token, join or recovery token, assertion bytes or IP address in any journal entry, store row or `localStorage` value |
| P3-E16 | **No job was skipped** | The exit step | `node scripts/loam-exit-check.mjs --phase 3`, for the local part; again with the hosted job for the hosted part |
| P3-E17 | **Enrolment by invitation only**, through a test-only auth host | Chromium; Units | An owner invites a new email; the mail sink holds the link; the invitee creates a passkey from it with no password and no prior session, and is a member with a verified email; the link fails a second time and after expiry; a direct sign-up call to the provider is refused; an OIDC sign-in with `email_verified: false` creates no user and links nothing; accepting an invitation unverified is refused. **At the provider, by direct requests:** a registration with a session older than 300 s, or a password session for a person who holds a passkey, is `REAUTH_REQUIRED`; a join registration with another person's session present is `SIGN_OUT_FIRST`; a join link for an email that already has an account is `ACCOUNT_EXISTS` and enrols nothing; a token is not consumed by option generation alone; a `join:` verification without `createSession: true` is refused; **a fault injected after `afterVerification` (the passkey insert fails) leaves no user, the invitation pending and the token unconsumed; the same link then succeeds** |
| P3-E18 | **Recovery** (D97), through a test-only auth host | Chromium; Units | By email and by single sign-on: a recovery link, sent only to the verified email, restores access with a new passkey, revokes every other session, consent and refresh token, suspends connected agents, sends the announcement and shows the notice; it fails a second time and after 15 minutes; a second link cancels the first; the request form answers the same for an unknown email; no command lets an owner start another person's recovery (a scan of the registry and the provider's routes); past the per-account limit the request is dropped with the same answer and timing; a recovery registration with another person's session present is `SIGN_OUT_FIRST`; **the single sign-on ceremony** runs the whole recovery transaction and lets that fresh OIDC session register a passkey for a person who holds one, while an ordinary fresh OIDC session for the same person is `REAUTH_REQUIRED`; Better Auth's password-reset and change-email routes answer 404; **`recover/oidc/complete` refuses a session older than 300 s, a passkey or password session, a differing or unverified OIDC email, and a call with no `start`**; `account-get` reports `recoveredAt`; **a fault injected after `afterVerification` (the passkey insert fails) leaves the person's sessions, consents and agents untouched and the token unconsumed; the same link then succeeds**; `PASSKEY_LAST` follows `recovery` |
| P3-E19 | **A re-created organization grants nothing**, through a test-only auth host | Units; Chromium | With the binding pinned: the bound organization's slug change and deletion refused by the provider; a new organization created directly in the host's database with the bound slug, and its members, are not members of the workspace; `IDENTITY_BINDING_MISMATCH` reported |
| P3-E20 | **The OAuth login and consent pages** (9.4), through a test-only auth host | Chromium; Units | The consent page shows the client id's host in bold, the name marked "name given by the app", each scope in words, the redirect host, the loopback warning for a `localhost` redirect, and the `loam:write` autonomy sentence; Deny returns `access_denied`; a client without PKCE, or one registering `requirePKCE: false`, is refused; `client_credentials` is refused; the login page signs in and resumes the authorization; the test host's responses for both pages carry `frame-ancestors 'none'` and `form-action 'self'` |
| P3-H1 | **The hosted server refuses a token for the wrong audience** | Hosted | With a second configured resource on the same provider: its token is a 401 at the MCP endpoint with the challenge naming the metadata; a token from another issuer, 401; the right one, 200 |
| P3-H2 | **A person signs in with a passkey on the hosted lane** | Hosted | E1's and E17's passkey paths against the profile's own provider, over HTTPS, no test-only host |
| P3-H3 | **A connected agent acts for its person, and no more; the relay enforces** | Hosted | A client registered by a metadata document, approved on the consent page, enters its person's restricted project and not another's; an owner command `COMMAND_NOT_FOUND`; a browser request through the mount relay for a project the session's person may not enter is refused before forwarding, by the instance's log |
| P3-H4 | **Revocation on the hosted lane** | Hosted | After `session-revoke 'all'` and after `member-remove`: the revoked session's next MCP, provider and relay requests are refused at once; the person's refresh token fails; their last access token is accepted until it expires and refused after |
| P3-H5 | **The server enforces the trust records** | Hosted | (a) By a signed-in non-owner's session on 10.2 item 4's transport: `project-create` of a listed slug, `project-update { access }` on a listed project, and `workspace-app-set` each answer `OWNER_REQUIRED`. (b) By a connected agent's token over MCP: `project-create` of a listed slug and `project-update { access }` answer `HUMAN_REQUIRED`, and `workspace-app-set` answers `COMMAND_NOT_FOUND`. (c) An owner's session makes the same three calls and each succeeds. (d) The owner's cookie with a foreign `Origin`, or `text/plain`, is refused, and the records are unchanged. After (a), (b) and (d) the server's records are unchanged, and after (c) they're changed, read back from the server's store. **#852 closes on this row** |

## 19. Implementation plan

Each step is one pull request, merged on green. It updates this status block and STATUS.md before it merges. **Steps 3, 6 and 7 each get a review focused on the trust boundary they change.**

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: TypeScript MCP authorization, verification | 9.1's first bullet on `jose`; the test authorization server fixture; the table's three rows; parity rows; a changeset. **Amended in step 0b (coordinator, 2026-11-09):** the verifier brands the `credentials` it sets with afd-server's internal `brandVerifiedCredentials` (4.1), which freezes them, and calls `unbrandVerifiedCredentials` on them when the request ends, so no credentials outlive their request as verified | `pnpm check`, `pnpm verify`, `pnpm test:hosted:local` |
| 0b | AFD: afd-auth's passkey method, capabilities and the credentials backstop | 4.1 on Better Auth 1.7.18, pinned with `@better-auth/passkey`; the Mock; the hosted fixture moved to 1.7.18; `spec/error-codes.md`'s auth list; README and the `afd-auth` skill; a changeset | `pnpm check`, `pnpm test:hosted:local` |
| 0c | AFD: TypeScript MCP authorization, scopes | 9.1's second bullet; the table's three rows | `pnpm check`, `pnpm verify` |
| 1 | Identity core | `loam-identity` with `createLoamAuthOptions`, `loamServerPlugin` (whoami, the binding, the hooks of 7.5) and `startTestAuthHost`; deployment and projection version 3; `decideAccess` version 2, `MembershipV1`, `personKey`, `isOwner`, line 0, the auth gate's lists; `KernelCallFields.actor`; the agent interface's actor; `personalRecordId`; the tables; kernel interface version 3; `member`; `call-scope.test.ts`; the architecture's amendments; 2.1's amendments to E12; E13; E7's, E5's and E6's units so far; E19's units | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | `session-settle` | 4.4: the listener, the expiry timer with its re-arming and refresh, the membership journaling, the input as data, the change-of-person rule, `SESSION_CHANGED` and its exemptions, all in `late`; E4. Closes #854 and #864 | `pnpm check`, `loam.yml`, `budget` |
| 3 | Sign-in, the probe and sessions | 4.2, 4.3, 4.6, 5.2; `identity.ts`, `auth` with `SessionSync`, `loam-sign-in-dialog`, the signed-out main, the account menu without personas; the harness's `authHost`, HTTPS on `localhost`, virtual authenticator and mail sink; `revoke-person`; 5.8's hooks on the real registration and delete routes; E1, E3, E10 so far, E11 and E15 so far. **Trust review: the gate, the probe, revocation** | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 4 | The account section, members and owners | 5.1, 5.3, 5.4, 5.6, 5.7, 5.8's join and recovery paths and the single sign-on ceremony, `bootstrapOrganization`, section 7; the `account` chunk with the join and recovery pages; E6, E7, E17, E18, E19. #852's rule in the kernel | `pnpm check`, `loam.yml`, `budget` |
| 5 | Persona | Section 6; the context field; emphasis in the rail and palette; E2 | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 6 | Agent members | Section 8, `agent-member-settle`; E5. **Trust review: line 4 and the sponsor rules** | `pnpm check`, `loam.yml`, `budget` |
| 7 | Identity over MCP | Section 9: `createMcpAuth` with 9.2's verifier steps, `createServerKernel` with `gate: 'principal'`, `principalGate`, `credentialsGate`, `KernelCallFields.principal`, `membershipOf`, `createNoSessionAdapter`, `principalOf`, the scopes, connected agents in `loam_connected_agent` and `connectAgent`, the OAuth provider's options, the login and consent pages; E8, E20. **Trust review: the server kernel's chain and nested calls.** #853's design complete; it closes at step 10 | `pnpm check`, `pnpm verify`, `loam.yml` |
| 8 | An app's account section | 5.5: the schema branch, the rules, `refusal-map.ts`; `apps`' row measured and amended or code moved first; hello's section; E14 | `pnpm check`, `loam.yml`, `budget` |
| 9 | Local exit | `scripts/loam-exit-check.mjs --phase 3`, with `loam-exit-check.p3.minimums.json` and 18's places; every `P3-E` row; `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`; STATUS.md records "local criterion met" | The check exits 0 |
| 10 | Hosted criterion and exit | **Waits for phase 6's development profile** (10.2). P3-H1 to P3-H5; the check gains the hosted job; STATUS.md records the exit; **#852 and #853 close**; follow-ups filed | The check exits 0 for both parts |

Order: 0a, 0b and 0c in parallel, first (D15). Step 1 needs 0b. Step 2 needs 1. Step 3 needs 0b and 2. Steps 4, 5 and 6 need 3, 6 after 4. Step 7 needs 0a, 0c, 4 and 6. Step 8 needs 4. Step 9 after 1 to 8. Step 10 after 9 and phase 6's profile. An exit test named in several steps closes in the last.

**Host capacity.** Steps 3 on run Chromium with a Better Auth child process per file; on a shared machine, one Vitest worker.

## Questions for the owner

**Asked 2026-11-09. The owner answered Q1, Q3, Q5's recovery and Q6 the same day; Q2 and Q4 await answers.** Each is a change to who may do what, or a reading of an owner decision. An answered question keeps its text and states the answer, which its section and decision record as the owner's. An unanswered one keeps its recommendation, to which the specification is written.

### Q1. Who counts as an owner?

Owners install agent members, choose the workspace's apps, invite and remove people, and control the projects a team instance serves. Owners can enter every project, since they can add themselves to any. The identity provider has three roles: owner, admin and member. Loam configures the provider, so it can narrow what an admin may do there.

- **Owners and admins (recommended),** with admins unable to rename or delete the organization or to make or remove owners. Day-to-day administration doesn't wait on the one owner. The tradeoff: more people can see into every project and install agents.
- **The provider's owners only.** Fewer people can do these things. Admins would have no more power in Loam than members.

**Answered by the owner, 2026-11-09: owners and admins.** The provider's `owner` and `admin` roles are both Loam owners, `createLoamAuthOptions` keeps the provider's admin powers consistent with that, and owners can enter every project (D96; [7.1](#71-who-is-an-owner), [7.5](#75-the-providers-own-endpoints)).

### Q2. Who may change a project's members?

**Awaiting the owner's answer.** This is for projects a team instance doesn't serve; for those, owners only is already decided. Owners can always add themselves.

- **Owners and the project's creator (recommended).** The creator keeps running their project. Another member can't lock everyone out of a shared project. Anyone may remove themselves.
- **Anyone in the project.** This is the most self-service option. The tradeoff: one member can shut the rest out until an owner fixes it.
- **Owners only.** This is the strictest option. Every change waits for an owner.

### Q3. A person's own external agent over MCP

An external agent, such as a desktop assistant connected to the hosted shell, is treated as an agent member that its person sponsors. So it is visible to owners, can do only what its person can, never does owner actions, and can be disconnected. The question is who lets it in.

- **The person may connect one themselves (recommended),** approving it on the connection page. Owners see it in the members list and can remove it. Connecting your own assistant doesn't wait on anyone, and it never exceeds your own access.
- **An owner must approve each connection.** Owners decide every agent in the workspace. The tradeoff: a person's own assistant waits for an owner.

**Answered by the owner, 2026-11-09: yes, without an owner's approval.** It is an agent member the person sponsors, created when the person approves the connection on the consent screen. Its access is at most the person's own, and it never gets owner actions or changes to anyone's access, sign-in or sessions. Every action names both the agent and the person. Owners see it in the members tab, and the person or an owner can disconnect it. The sponsor confirmation of Q4 does not apply, since the sponsor is the person connecting it. Until phase 5's autonomy policy, a `loam:write` agent can make any change the person can, unprompted, and the consent screen says so (D98; [9.2](#92-the-hosted-principal-mapping), [9.4](#94-connected-agents-and-their-pages)).

### Q4. A sponsor confirms

**Awaiting the owner's answer.** When an owner names someone as the accountable sponsor of an agent member, does that person confirm before the agent can act, and confirm again when its access widens?

- **Yes (recommended).** Nobody becomes accountable for an agent, or for more than they agreed to, without saying so. An owner who names themselves confirms by doing it.
- **No.** Setup is faster. The tradeoff: a person can be made accountable for an agent, or for wider access, they never agreed to.

### Q5. Ways to sign in, and who may restore access

Passkeys are the main way in. When someone loses every passkey, who may restore their access?

- **Single sign-on where the deployer has set it up; otherwise a one-time link emailed to the person's verified address; never an owner (recommended).** The person restores their own access, and everyone is told it happened. The tradeoff: whoever controls the person's email can restore their access.
- **Single sign-on only.** This is the strongest option. The tradeoff: in a workspace without single sign-on, a person with no working passkey must be invited again as a new account.
- **An owner may restore anyone's access.** This is the easiest way back for a person who has lost everything. The tradeoff: an owner can take over any account. Every owner would be told, but they could act as that person until then.

Separately, whether a deployer may allow passwords at all. The recommendation is off by default, with the deployer able to turn them on.

**Answered by the owner, 2026-11-09, for recovery: an emailed one-time link to the person's verified email, or the company's single sign-on where the deployer set it up; no owner can restore another person's account.** The link is single-use and short-lived. Using it enrols a new passkey, revokes every other session and connected agent, is journaled, and is announced to the person (D97; [5.7](#57-recovery)). **The ways to sign in were the coordinator's to decide, 2026-11-09:** passkeys, plus single sign-on if the deployer sets it up; passwords off by default, which the deployer may turn on. Passwords and OIDC sign-ins carry no user verification ([2.6](#26-the-providers-configuration), [5.2](#52-passkeys), D99).

### Q6. `stdio` instances on the hosted server

D56 lets the deployer's configuration add a `stdio` instance on the hosted server. Such a program runs as the server's own user, for every member who may reach it. D95 would refuse them in every team deployment.

- **Keep D56, with a warning (recommended).** The deployer already controls the server and chose the program. Refusing it adds no protection the deployer couldn't remove, and some tools exist only as `stdio`.
- **Adopt D95.** Team deployments run only instances reached over HTTP, so a program on the server is never shared with every member by accident. The tradeoff: a deployer must wrap a `stdio`-only tool as an HTTP server first.

**Answered by the owner, 2026-11-09: refused in shared, `provider`-mode workspaces.** D95 is adopted as the owner's decision and narrows D56 ([2.2](#22-the-deployment-file-version-3)).

## Amendments to the architecture and the decision log

Proposed; applied when the coordinator approves this specification, in step 1:

- **Architecture section 5, Identity:** the actor on each path (3.1); `decideAccess`'s workspace and agent lines (3.3); owner and human commands (3.4); the hosted principal (9.2); connected agents.
- **Architecture section 5, shell commands:** the commands of sections 4 to 8 replace the list's `account-get; persona-list, persona-set; session-list, session-revoke; agent-member-add, agent-member-list, agent-member-remove`, and `member` joins the domains.
- **Architecture section 8, Security:** where `provider` mode is enforced (2.5).
- **Architecture section 9:** phase 3's row gains "local criterion through a test-only auth host and handler; hosted criterion on phase 6's development profile (D84)"; phase 6's row gains 10.2's minimum.
- **Architecture glossary:** "Owner (workspace)", "Identity mode", "Connected agent", "Enforcement point".
- **Decision log:** D84 to D94, decided with this specification's approval on 2026-11-09; D95 to D98, decided by the owner on 2026-11-09; D99, decided by the coordinator on 2026-11-09. D11, D55 and D73 gain notes pointing to them; **D40 is annotated now**: "an agent member a person connects for themselves needs no owner (D98, owner 2026-11-09)". **D56 is narrowed by D95,** the owner's decision: "Narrowed by the owner on 2026-11-09 (D95): refused in a provider-mode workspace." D54, D55, D57 and D58 are not altered.

| ID | Decision |
| --- | --- |
| D84 | Phase 3's exit has a local part, through a test-only auth host and handler, and a hosted part on phase 6's development profile; the phase exits when both pass |
| D85 | A deployment's identity is `local` or `provider`, in deployment and projection version 3; `provider` is Better Auth on the same origin, bound by id to one organization, enforced by the provider, the hosted server's kernel and the mount relay |
| D86 | `decideAccess` version 2: the person the call is for, workspace membership, the project, and an agent member's own record with its sponsor in `onBehalfOf`, intersected; neither persona, the active scope nor the session's active organization is an input |
| D87 | Owner and human commands, never served over MCP; owners are the provider's `owner` and `admin` (D96); #852's rule; `PROJECT_SLUG_UNAVAILABLE`; the organization rules written into the provider |
| D88 | The kernel hears its adapter and times expiry on its clock; a change of person is the journaled internal `session-settle`, whose input records the person and membership as data |
| D89 | Persona is a record per person, with emphasis that orders and marks but never hides; `dev.loam/persona`, set only off `default`, never an input to a decision |
| D90 | An agent member is a Loam record with no provider account, a sponsor named in its `onBehalfOf` who may enter its projects and confirms (Q4, awaiting), suspended when the sponsor leaves; an external MCP agent is a connected agent member its person sponsors (D98) |
| D91 | Over MCP, a verified token runs as its client's connected agent acting for its subject, on a chain with no session gate; `loam:read` and `loam:write`; Better Auth issues audience-bound JWTs of 10 minutes |
| D92 | First paint gets only the session probe and a deferred adapter; the provider's client, the identity commands and the account UI are lazy |
| D93 | afd-auth gains a passkey method, optional session, passkey and organization capabilities, `refresh()`, and keeps a credentials-verified call's actor |
| D94 | In `provider` mode, a person's working view-state records are per person; there is no open sign-up, and enrolment and recovery are single-use, hashed, short-lived links |
| D95 | **Decided by the owner, 2026-11-09 (Q6).** A `provider` deployment refuses a mounted `stdio` instance. Narrows D56 |
| D96 | **Decided by the owner, 2026-11-09 (Q1).** Loam's owners are the provider's `owner` and `admin` roles, with the provider's admin powers kept consistent; owners can enter every project |
| D97 | **Decided by the owner, 2026-11-09 (Q5, recovery).** A person restores their own access by an emailed one-time link to their verified email, or through the deployer's single sign-on; no owner can restore another person's account |
| D98 | **Decided by the owner, 2026-11-09 (Q3).** A person may connect their own external agent over MCP without an owner's approval, as an agent member they sponsor, at most their own access, never an owner or human command |
| D99 | **Decided by the coordinator, 2026-11-09.** Ways in: passkeys, the deployer's single sign-on if set up, passwords off by default and the deployer's to turn on; password and OIDC sessions carry no user verification, except in the single sign-on recovery ceremony of D97, which wins |

## Review 2026-11-09

Two independent reviews of `ede753e1`, a trust and security review and a general review (implementability, decisions, code claims), found it approvable once their findings were fixed, and confirmed the core rule, most code claims, every budget figure and all eight sources. Every finding is answered in this revision:

| Finding | Where answered |
| --- | --- |
| MCP ran a token's call as the kernel's signed-in person | 9.5 (`createServerKernel`, `credentialsGate`, `createNoSessionAdapter`), 4.1's backstop, 3.3, E8 |
| Nested and port calls lost the actor | 3.1, 12 (`KernelCallFields.actor`), E7 |
| The binding by a renamable, claimable slug | 2.3, 2.6, 7.5, E2's scan, E19 |
| Where `provider` mode is enforced; authoritative stores; the relay; #852's closing | 2.5, 7.3, 10.2 items 4 and 5, 16, step 10, H3 |
| Enrolment and recovery | 2.6, 5.6, 5.7, Q5, E17, E18 |
| OAuth login and consent pages | 9.4, step 7, 16 |
| The signed-out and exempt lists | 2.1 |
| "Nothing changes for `local`" | 2.1's table, E12 |
| `ui.account`'s schema and its `apps` cost | 5.5, 13, step 8 |
| E8 against E13 and the dependency cycle | 1, 9.6, E8 |
| `startTestAuthHost` and `packages/auth/hosted` | 1 (copied, with provenance) |
| D95 narrows D56 | Q6, answered by the owner on 2026-11-09: D95 adopted (2.2) |
| Expiry with no command; replay; a change of person | 4.4 |
| Membership freshness and revocation's reach | 4.3, 7.6, 7.2's `member-remove` |
| Better Auth's own endpoints; the last owner | 7.1, 7.5; R10 corrected |
| WebAuthn settings, freshness, HTTPS on `localhost` | 2.4, 2.6, 5.2, E1 |
| Agent members: re-confirmation, filtering, persisted suspension, sponsor in `onBehalfOf`, reserved names, default access | 3.1, 3.3, 8.1 to 8.3, E5 |
| #852's remaining existence check | 7.3, accepted by the coordinator |
| `spec/authorization.md` consistency | 9.2, 9.4, E8, H1 |
| Exit-check names; hosted revocation | 18's places, H4 |
| E2's exemptions; what members see of a persona; `MembershipV1` in `local`; stage A and a removed member; E10 and `late-identity`; `SessionSync`; `identity.path`; redaction | 6.2, 6.1, 2.1, 3.3, E10, 4.2, 2.2, 11 |
| AFD prerequisites: JWKS crypto, the table's rows, `SIGN_IN_METHOD_UNAVAILABLE`, error codes, Better Auth 1.7.18 | 9.1, 4.6, 4.1, 2.6, step 0b |
| Budget arithmetic and 2.4's rule | 13 |
| The SDK's `actor`; `HUMAN_REQUIRED` on personas and the profile; 5.2's citation | 12, 3.4, 5.2 (citation dropped) |
| Nits: S80's quote, S81's versions, S85's order, token lifetimes, store versions, STATUS's decision row, re-invited members, Q3's wording, line 3's agent message | Sources and trajectory; 9.4; 12; STATUS.md; 7.2; Q3; 3.3 |

### Re-check 2026-11-09

An independent re-check of `a08572ea` confirmed most findings fixed and the owner's decisions recorded faithfully, and found:

| Finding | Where answered |
| --- | --- |
| B1: nested calls under an MCP call had no chain on the server kernel | 9.5 (`createServerKernel`, `gate: 'principal'`, `KernelCallFields.principal`, `membershipOf`, no change-of-actor step), 3.1, E8's nested read |
| B2: freshness, enrolment and recovery against the passkey plugin's real routes and `requireSession: false` | 5.8, 5.6, 5.7, 5.2; E17's and E18's provider cases |
| B3: single sign-on recovery against D99 | 5.7's ceremony; D99 amended (decision log) |
| B4: no hosted test of server-held trust records | H5; #852 closes on it |
| S1: replay of owner commands and membership | 3.4's replay rule; 4.4's `reason: 'membership'` |
| S2: the expiry timer | 4.4 |
| S3: `SESSION_CHANGED`'s exemptions and nested calls | 4.4 |
| S4: the recovery form past its limit | 5.7 |
| S5: `project-create` and `project-update` over MCP; `HUMAN_COMMANDS` | 3.4, 9.3, 9.5, E8 |
| S6: first paint for step 2; step 1's parts; `kernelMinified` | 13, 4.4 |
| S7: afd-auth's backstop and forged credentials | 4.1 |
| S8: grant types, PKCE, the login page, E20 | 9.4, E20 |
| S9: D40 annotated | Decision log |
| S10: the first organization and owner | 5.6's `bootstrapOrganization`, 10.2's item 2 |
| S11: Better Auth's reset and change-email routes | 5.7 |
| S12: connected-agent records before phase 6; an owner's removal; serving the token's person | 9.2 |
| S13: `principalOf` split between the verifier and the gate | 9.2 |
| S14: E12 and the exit check | 18 |
| N1 to N4 | What this phase serves; 7.1; E8; D56's line |

### Second re-check 2026-11-09

A focused re-check of `cfabbb2d` verified B2 and B3 against the 1.7.18 tarballs and B1 for the token path, approved the first-paint growth, and found one blocker, ten should-fix items and six nits. Each was checked against the published packages and the kernel before it was applied, and each fix is as the re-check worded it:

| Finding | Where answered |
| --- | --- |
| K1: H5 relied on a server principal for a browser caller that was never defined; the agent's code and the positive control were wrong | 9.5's second source of `principalGate`; 10.2's item 4; H5 rewritten with (a), (b) and (c) |
| S-a: line 4 needs the connected agent's row; membership holds only the subject's row | 9.5's principal `{ actor, person, membership, agent? }`, `agentOf(context)`; 3.3 |
| S-b: `principalGate` would refuse the server's boot | 9.5: `BOOT_FIELDS` passes with no actor; refusals carry the principal; `session-settle` and `agent-member-settle` unregistered |
| S-c: `mcpOptions()`'s page-event middleware and `chooseScope` read the session | 9.5: both skip the adapter with `gate: 'principal'` |
| S-d: `verify-registration` cannot see `context` | 5.8: checked on generation and again in `afterVerification` (the stored challenge carries `context`, confirmed in `index.mjs`) |
| S-e: a failed passkey save must be atomic | 5.8's `afterVerification` joins the plugin's transaction (confirmed: `runWithTransaction` with `createSession: true`; `queueAfterTransactionHook` exported by `@better-auth/core` 1.7.18); the earlier "token spent" note is dropped; E17 and E18 inject the fault |
| S-f: `/list-sessions` needs a fresh session | 4.6: `loamServerPlugin`'s `sessions` endpoint (confirmed: `freshSessionMiddleware` on `/list-sessions`); E3 |
| S-g: replay's four holes | 4.4: stage B's first `session-settle`, top-level settles before dispatch, `agent-member-settle` after `member-remove`, journaled sponsor reads; 3.4: a connected agent's removal recorded |
| S-h: the reconnect block | 8.2's `agent-member-remove`; 9.2, labelled the coordinator's reading of D98 |
| S-i: single sign-on recovery bound to its start | 5.7's nonce; E18 |
| S-j: E8 must make an adapter fallback visible | 9.6 and E8: `createKernelParts({ gate: 'principal', auth })` with an owner Mock |
| N1 to N6 | 3.4 and 9.5 (agents and `access`); 9.5 (no principal on a handler's context; `run` and `execute`); 13 (`kernelMinified`'s fallback moves line 0 and `isOwner` to `late`, keeping `personalRecordId` for E1); the decision log's D40; STATUS.md |

### Third re-check 2026-11-09

A third re-check of `d20ae2fd` confirmed K1 and nearly every second-round fix, and found two trust-boundary blockers, after which it called the specification approvable. Each code and package claim was checked before it was applied (Better Auth's `originCheckMiddleware` guards only its own endpoints; its session cookie defaults to `sameSite: "lax"` with the `__Secure-` prefix on HTTPS; `LateScope.before` returns `void` and runs before line 1; `startInstances` runs its refresh with no fields; the replay's recorded test reads the kernel's own table), and each fix is as the re-check worded it:

| Finding | Where answered |
| --- | --- |
| B1: nothing defended the cookie-authenticated routes against cross-site requests | 9.5's second source, 10.2's items 4 and 5, section 16; H5 (d) |
| B2: the provider did not authorize the connected-agent endpoints | 7.5's new row; E8's direct non-owner remove, `forget` and disconnect calls |
| S1: the server's membership read for a session-sourced call | 9.5; 7.6 names the trust-record transport |
| S2: a sponsor read journaled as `session-settle` would change the person | 4.4's `membership-settle { person, role, digest }`; the internal lists, line 0's exemptions, 9.5 |
| S3: the re-read's order and scope | 7.1; 4.4 and 7.6: before every `OWNER_COMMANDS` command, every `project-create`, every `project-update` carrying `access` |
| S4: an agent creating a listed slug without `access` | One wording in 3.4's row and bullet, 9.3 and 9.5 |
| S5: two checks placed where they cannot see `context` | 5.8: `afterVerification` re-reads the session and applies every row; the verify-registration bullet deleted |
| S6: the server's instance refresh | 9.5's `INSTANCE_FIELDS`; E8 |
| N-a to N-i | 3.3 and a 3.1 row; 3.3 and 13 (line 0 in `createScopeMiddleware`, or `LateScope.before` with a refusal return); 4.4's first settle as a change from `null`; 8.3; 3.4 and 8.2 (a connected agent is one not in the kernel's table); 5.7's nonce storage; 9.6 and E8's `identity`; 9.5 and 2.5; the Status block |

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-09 | Phase 3 specification | Account deletion and data export, with a retention rule for the journal and records that carry the actor | Open |
| 2026-11-09 | Phase 3 specification | Whether delegated work in a project the sponsor lost is refused, decided with phase 5's delegation | Open, for phase 5 |
| 2026-11-09 | Phase 3 specification | A revoked device's tab keeps its local store readable until its next refresh; revisit when the collaboration service gives a browser a server to ask | Open, for the collaboration service |
| 2026-11-09 | Phase 3 specification | Remote avatars: a CSP source or a proxied image | Open |
| 2026-11-09 | Phase 3 specification | DPoP or certificate-bound tokens in AFD's TypeScript layer, when Umbel's W5 settles | Open |
| 2026-11-09 | Review | Share one Better Auth test host between `packages/auth/hosted` and `loam-identity` instead of a copy | Open |
