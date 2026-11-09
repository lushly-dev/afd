# Phase 3 specification: identity

| Field | Value |
| --- | --- |
| Phase | 3, identity ([architecture section 9](../../architecture.md#9-phases)) |
| Owner | The coordinator approves under the owner's delegation of 2026-11-01, after an independent review, except the [questions for the owner](#questions-for-the-owner), which the owner answers; the phase 3 owning agent implements |
| Read first | [STATUS.md](../../STATUS.md), the [scope and projects specification](../2-scope-projects/spec.md) (its 3.3, 3.4, 4.1, 4.3 and 9.1 above all), the [documents specification](../2-documents/spec.md), the [architecture](../../architecture.md), the [decision log](../../decisions.md), [`spec/authorization.md`](../../../../../spec/authorization.md) |
| Elevation | Exact shapes, names, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State:** written 2026-11-09 by the design sub-agent, not yet reviewed or approved. Five questions wait on the owner ([Questions for the owner](#questions-for-the-owner)); the text is written to each recommendation and marks every place an answer changes, so nothing else needs rewriting when they are answered. Decisions D84 to D95 are proposed in the [decision log](../../decisions.md), "proposed, pending review". The order relative to phase 6 is the coordinator's decision; [section 10](#10-the-dependency-on-phase-6s-hosted-lane-d84) recommends one.
- **Last verified:** 2026-11-09 against `main` at `4eee0af8`, from this evidence read in the repository:
  - **Kernel:** `endpoints/loam/packages/kernel/src`:
    - `kernel.ts:326` (the auth middleware excludes every held command, so nothing needs a session), `:89-94` (`UNJOURNALED_COMMANDS`), `:113-119` (`redactJournalRecord` removes `input.password` from `auth-sign-in`), `:768-774` (`resetSession`);
    - `scope/access.ts:28-34` (`decideAccess`: no project allowed, a restricted project by `access.members.includes(actor)`), `:10` (`LOCAL_ACTOR`), `:21-22` (`actorKey`);
    - `scope/middleware.ts:64-72` (`sessionActor`: the adapter's user id, or `local`);
    - `late/index.ts:66-74` (`PERSON_SESSION`), `:315-322` (`mcpOptions` leaves those and `INTERNAL_COMMANDS` out);
    - `types.ts:279` (`APP_CALLABLE_SHELL_COMMANDS_V1`); `context-fields.ts:12-20` (the six declared fields).
  - **Web host and chrome:** `web/src/host.ts:100` (a `MockAuthAdapter` per page); `chrome/src/elements/shell.ts:827-834` (the title bar's "Sign in" calls `auth-sign-in` with the Mock's email).
  - **AFD:** `packages/auth/src/types.ts:33-49` (`SignInOptions` is credentials or OAuth, no passkey), `:99-109` (`AuthAdapter`: no session list, revocation, passkey or organization); `middleware.ts:38-44` (`actorForSession`: a human or absent actor becomes the session user, any other kind gains `onBehalfOf`); `adapters/better-auth.ts` (email and social sign-in only); `session-sync.ts` (`BroadcastChannel`, a `localStorage` fallback); `hosted/better-auth/` (a real Better Auth 1.7.14 server on `node:sqlite` with `genericOAuth`, run by `pnpm test:hosted:local`); `packages/server/src/server.ts:140,188` (a server's actor defaults to `{ kind: 'agent' }` with no id); [`spec/authorization.md`](../../../../../spec/authorization.md)'s implementation status: **TypeScript's token verification, 401 and 403, scopes and metadata are "Planned"**, Rust's done; the principal binding (M8) done in TypeScript.
  - **Issues:** #852, #853, #854 and #864, each answered in [Carried](#carried-from-phase-2-answered-here); the rest of #851 to #889 name no phase 3 work.
  - **External:** the [trajectory refresh](#trajectory-refresh), dated 2026-11-09; `better-auth` and `@better-auth/passkey` 1.7.18 on npm (2026-11-05), the workspace on 1.7.14. A browser bundle of Better Auth's client with its organization and passkey plugins measured 54,853 bytes minified, 18,213 gzip (esbuild 0.28.2, 2026-11-09); without the passkey plugin 42,473 and 14,851; `@simplewebauthn/browser` alone 8,983 and 2,976.
- **Done:** this specification.
- **Not done:** everything it specifies; the owner's five answers; the review.
- **Follow-ups:** [Follow-ups](#follow-ups).

## What this phase serves

- **Principles:** 3, everything is a command; 5, scope is shell-level; 7, identity once; 8, agents are first-class users; 13, deterministic core; 15, AFD first; 19, live sessions revalidate when membership changes (its seam, not the service).
- **Decisions it depends on:** D4 (the active project narrows, never grants); D11 (identity once on `@lushly-dev/afd-auth`, Better Auth first, persona never a grant, the persona id in Loam's context fields); D15 (AFD first); D32 (single-tenant, workspaces bound to the provider's organizations); D36 (the hosted server on Hono, Better Auth among its routes); D40 (agent members: a human sponsor, installed by an owner, scoped to projects, not a seat, unable to sign in or administer; identities here, delegation in phase 5); D46 (membership epochs, for the collaboration service); D54 (native apps are trusted code); D55 and its consequence (phase 3 must restrict `project-create` for a slug a team instance lists, and such a project's members, to an owner); D56; D63 and D73 (`workspace-app-set`, which "phase 3 restricts to an owner"); D64 (a test-only stand-in, named as such wherever its result is recorded); D71 and D72 (scope, the order of a call, `applyScopeChange`); D77 and D83 (the ports).
- **New decisions this specification proposes:** D84 to D95, in [Amendments](#amendments-to-the-architecture-and-the-decision-log). None changes a trust model on its own: every trust question is in [Questions for the owner](#questions-for-the-owner), and the decisions that depend on an answer say so.

### Carried from phase 2, answered here

| Item | Answer |
| --- | --- |
| [#852](https://github.com/lushly-dev/afd/issues/852): `project-create` for a slug a team instance lists, and such a project's members, owner-only; `PROJECT_SLUG_TAKEN`'s leak; `workspace-app-set`'s role | [7.3](#73-projects-and-owners-852) and [7.4](#74-the-workspaces-apps): owner-only, by the same check as every owner command; `PROJECT_SLUG_TAKEN` becomes `PROJECT_SLUG_UNAVAILABLE`, one answer for a slug that is taken, reserved or hidden |
| [#853](https://github.com/lushly-dev/afd/issues/853): identity over MCP | [Section 9](#9-over-mcp-and-the-hosted-token-layer-d91): a token's subject becomes the person, its client the agent acting for them; no token, no call. Pending [Q3](#q3-a-persons-own-agent-over-mcp) |
| [#854](https://github.com/lushly-dev/afd/issues/854): a session a provider ends with no command | [4.4](#44-hearing-the-adapter-d88): the kernel hears the adapter, and a change of actor is the journaled internal `session-settle` |
| [#864](https://github.com/lushly-dev/afd/issues/864): restricted names left in the projects list after an expiry | The same: `session-settle`'s event makes every section re-read |
| Phase 2's 3.4: "Phase 3 changes `access` and the actor's source and not the order" | [3.3](#33-the-access-decision-version-2-d86): `decideAccess` gains the actor's kind and the workspace's membership; the order of a call is unchanged |
| Phase 2's 4.3: `PROJECT_MEMBER_SELF_REQUIRED`, "phase 3 replaces who may change this" | [7.3](#73-projects-and-owners-852) |
| Phase 2's 6.3 and STATUS: browser history keeps restricted slugs | [Section 16](#16-security): stated for a browser profile shared by people |
| Phase 0's and 1's "`redact` is where phase 3 extends" | [Section 11](#11-journal-replay-and-secrets) |
| Phase 1's surface catalog: `account`, `ui.account`, "Phase 3" | [5.5](#55-an-apps-account-section) |
| R10, the reserved `organization` | [2.3](#23-the-workspace-bound-to-an-organization) |

## Trajectory refresh

Rows this phase depends on, re-checked 2026-11-09 (sources S80 to S86 in the [ledger](../../sources.md); the [trajectory watch](../../trajectory.md) records the refresh):

| Row | Recorded | Now | Effect on phase 3 |
| --- | --- | --- | --- |
| W12 | Better Auth 1.4 stateless sessions; revocation delayed by the cookie cache (secondary sources) | Better Auth's own page: `listSessions`, `revokeSession`, `revokeOtherSessions` and `revokeSessions`; with the cookie cache on, "revoked sessions may remain active on other devices until the cookie cache expires"; `disableCookieCache` per request, or the cache off; passkey registration always checks the database [S80]. `better-auth` 1.7.18 on 2026-11-05, 1.8.0 in beta [S81] | Loam turns the cookie cache off and probes with `disableCookieCache` ([4.3](#43-revocation-and-every-tab)), so a revoked session is refused at the server at once. The caveat is closed rather than shown |
| New W31 | Not watched | `@better-auth/passkey`, on SimpleWebAuthn: `signIn.passkey` with `autoFill` (conditional mediation), `addPasskey`, `listUserPasskeys`, `updatePasskey`, `deletePasskey`; options `rpID`, `rpName`, `origin`, `authenticatorSelection` [S82] | The adapter's passkey method and the account's passkeys ([4.1](#41-the-adapter), [5.2](#52-passkeys)) |
| New W32 | Not watched | WebAuthn Level 3 a W3C Recommendation on 2026-08-25, with the signal methods (`signalUnknownCredential`, `signalAllAcceptedCredentials`, `signalCurrentUserDetails`) and related origins [S83] | A removed passkey is signalled to the authenticator where the method exists ([5.2](#52-passkeys)); related origins are not used, since the shell and its auth are one origin |
| R10 | Workspaces bound to provider organizations | Better Auth's organization plugin: owner, admin and member roles, `setActive`, `getActiveMember`, `listMembers`, `hasPermission`, invitations that expire in 48 hours by default; the page says nothing of a last owner leaving [S84] | [2.3](#23-the-workspace-bound-to-an-organization) and [section 7](#7-memberships-and-owners-d87). Loam refuses removing or demoting the last owner itself |
| New W33 | MCP Authorization proposed in AFD | MCP 2026-07-28: servers "MUST validate that access tokens were issued specifically for them as the intended audience" (RFC 8707), "MUST NOT accept or transit any other tokens", RFC 9728 metadata required, Client ID Metadata Documents preferred and Dynamic Client Registration deprecated [S85]. AFD's [`spec/authorization.md`](../../../../../spec/authorization.md) specifies the layer; Rust has it, TypeScript does not. Better Auth's `@better-auth/oauth-provider` is an OAuth 2.1 server with resource indicators, JWT access tokens (RFC 9068) through the JWT plugin, introspection, revocation, RFC 9728 metadata and Client ID Metadata Documents through a plugin [S86] | Step 0a builds AFD's TypeScript layer from the spec; Better Auth issues the hosted server's tokens ([section 9](#9-over-mcp-and-the-hosted-token-layer-d91)) |
| R14, W5 (Umbel) | Agent members on AFD's actor and `onBehalfOf`; agent identity drafts | The IETF's on-behalf-of draft for AI agents (`draft-oauth-ai-agents-on-behalf-of-user-02`) expired with no working group adoption; an OAuth working group interim's slides (dated 2026-05-31 by a secondary summary) group about seven delegation drafts and several identity drafts, all individual [S87]. Umbel's W5 (DPoP, workload identity) unchanged since its 2026-11-03 check | Nothing standard to adopt. Loam keeps AFD's actor with `onBehalfOf` as the wire form (D40), and a token's client as the agent ([9.2](#92-the-hosted-principal-mapping)) |

## Terms

Terms follow the [architecture's glossary](../../architecture.md#12-glossary) and phase 2's. This specification adds:

| Term | Meaning |
| --- | --- |
| Identity mode | A deployment's `local` or `provider` ([2.1](#21-two-modes-d85)) |
| Provider | The deployment's identity provider: Better Auth, on the deployment's own origin, in `provider` mode |
| Person | A human with an account at the provider; an actor of kind `human` |
| Workspace member | A person who is a member of the organization the workspace is bound to |
| Owner | A workspace member whose provider role makes them an owner ([7.1](#71-who-is-an-owner)) |
| A person's own agent | An agent acting for one person with that person's access and no more: the in-process agent interface, or an MCP client the person authorized |
| Owner command, human command | A command only an owner, or only a person at the shell, may run ([3.4](#34-the-trust-table)) |
| Session probe | First paint's one request for the session, before the provider's client loads ([4.2](#42-first-paint-the-probe)) |
| Test-only auth host | A real Better Auth server behind the test harness on the shell's origin, standing in for phase 6's hosted lane, as D64's relay does for mounts |

## 1. Units and repository placement

One new package, private and quarantined:

| Directory | Package | Responsibility | Depends on |
| --- | --- | --- | --- |
| `endpoints/loam/packages/identity/` | `@lushly-dev/loam-identity` | **Server side only:** `createLoamAuthOptions(config)`, Better Auth's options for a deployment (the organization, passkey, JWT and OAuth provider plugins, the cookie cache off, user verification required); `createMcpAuth(config)`, AFD's `auth` option for `createMcpHandler` with Loam's verifier, scopes and resolver ([9.3](#93-scopes)); `principalOf(credentials, members)` ([9.2](#92-the-hosted-principal-mapping)); and, under `/testing`, `startTestAuthHost()` ([2.4](#24-the-test-only-auth-host)) | `better-auth`, `@better-auth/passkey`, `@better-auth/oauth-provider`, `@lushly-dev/afd-server`, `@lushly-dev/afd-core`; dev: `@lushly-dev/loam-kernel` |

It never reaches a browser: `web`'s scan ([E13](#18-exit-criterion-and-tests)) refuses any import of it from `web/src`, `chrome/src` or `kernel/src`. Phase 6's hosted lane imports it.

| Package | Change |
| --- | --- |
| `kernel` | `decideAccess` version 2 and `MembershipV1` in `scope/` (first paint); `session-settle` and the auth gate's lists; `late-identity`, a chunk of its own loaded inside `loadLate` beside `late-documents`, with every new command ([sections 4 to 8](#4-sessions)); the `persona` and `agent-member` tables; personal records per actor ([4.5](#45-a-persons-records-per-actor)); kernel interface version 3 ([12](#12-the-kernel-and-the-sdk)) |
| `web` | `identity.ts` in first paint: the session probe and `DeferredAuthAdapter` ([4.2](#42-first-paint-the-probe)); the `auth` chunk with `BetterAuthAdapter`; the harness's `authHost` option and a virtual authenticator; `budget` rows |
| `chrome` | The signed-out main in `provider` mode (first paint); `loam-sign-in-dialog` (`sign-in` chunk); `loam-account-menu` (`account-menu` chunk); `loam-account-section` and its tabs (`account` chunk); persona emphasis in the rail and the palette's ranking |
| `manifest` | `deployment.v3.json` and `projection.v3.json` with `[identity]` ([2.2](#22-the-deployment-file-version-3)); `ui.account` served ([5.5](#55-an-apps-account-section)) |
| `sdk` | `ActorV1` on an app's handler context, read-only; `AccountSectionV1` ([12](#12-the-kernel-and-the-sdk)) |
| `cli` | `deployment write` and `check` read version 3 |
| `testing` | `createAppTestKernel` takes `actor` |
| `apps/hello` | One `ui.account` section, for E14 |

- **Release inventory.** One more entry, `loam-identity`, in phase 1's shape: `state: "quarantined"`, `routes: []`, `fixed: false`, `private: true`, `gates: ["pnpm check", "loam.yml", "release-approval"]`. Nothing publishes.
- **Repository contract.** `scripts/repository-contract.test.mjs`'s Loam test names it, in step 1.
- **`loam.yml`.** Its path filters already cover `endpoints/loam/**` and `packages/{core,server,auth}`. A new step, **"AFD's identity path"**, runs `packages/server`'s authorization suite and `packages/auth`'s suite with the verbose reporter, so the exit check can read their titles, as "AFD's lean path" does for E2 and E11 ([E9](#18-exit-criterion-and-tests)). `web`'s Chromium suite starts the test-only auth host itself; it needs Node 26's `node:sqlite`, which the job has.
- **`AGENTS.md`.** The architecture tree gains `identity`, and the Loam key rule names the new step. Step 1 does it.
- **Changesets.** Steps 0a, 0b and 0c carry their own for `@lushly-dev/afd-server` and `@lushly-dev/afd-auth`. None for the private units.

## 2. The deployment's identity

### 2.1 Two modes (D85)

| | `local` | `provider` |
| --- | --- | --- |
| For | A personal store: the static shell, the desktop, a test | A team: one organization, one provider, on the deployment's origin |
| Adapter | `MockAuthAdapter`, as today, or none | `BetterAuthAdapter`, through the probe ([4.2](#42-first-paint-the-probe)) |
| Signed out | Works, as `local`, as phases 0 to 2 do | Only the [signed-out commands](#signed-out-and-member-exempt-commands); main shows "Sign in" |
| Workspace members | Whoever reaches the kernel (D32, phase 2's 3.4) | Members of the bound organization ([2.3](#23-the-workspace-bound-to-an-organization)) |
| Owner | The one person, signed in or `local` | By provider role ([7.1](#71-who-is-an-owner)) |
| Default | Yes: a deployment with no `[identity]` | Only by `[identity] mode = "provider"` |

**Nothing changes for `local`.** Phase 0's, 1's and 2's exit tests run in `local` mode unchanged, which [E12](#18-exit-criterion-and-tests) holds. The Mock is attribution there, not authentication, and `app check` and `deployment check` say "`local` identity: anyone with this browser profile is its owner" as a notice.

#### Signed-out and member-exempt commands

In `provider` mode the kernel's auth middleware stops excluding every command (`kernel.ts:326`). It excludes only:

```ts
/** Run with no session in `provider` mode: what the sign-in screen and the empty shell need. */
export const SIGNED_OUT_COMMANDS = ['auth-sign-in', 'auth-sign-out', 'auth-session-get', 'shell-info-get',
	'appearance-get', 'appearance-set', 'layout-get', 'palette-open', 'palette-close', 'palette-search',
	'overlay-list', 'overlay-dismiss', 'scope-get', 'section-get'] as const;

/** Run with a session but no membership: a person's own account, sessions and invitations. */
export const MEMBER_EXEMPT_COMMANDS = ['account-get', 'account-update', 'account-passkey-list',
	'account-passkey-add', 'account-passkey-rename', 'account-passkey-remove', 'account-invitation-list',
	'account-invitation-accept', 'account-invitation-reject', 'session-list', 'session-revoke'] as const;
```

Any other command, signed out, is afd-auth's `UNAUTHORIZED`; signed in without membership, `WORKSPACE_NOT_MEMBER` ([15](#15-failure-modes-and-error-codes)), from the scope middleware's new line 0 ([3.3](#33-the-access-decision-version-2-d86)), journaled. `scope-get` and `section-get` stay unjournaled. Signed out, `scope-get` answers the workspace with no project and `palette-search` lists only these commands.

### 2.2 The deployment file, version 3

`manifest/schemas/deployment.v3.json` and `projection.v3.json`. `readDeployment` reads 1 to 3; `readBoot` and `readProjection` read 2 and 3, a version 2 projection meaning `local`. Everything of phase 2's 4.2 stands. It adds:

```toml
deployment_version = 3

[identity]
mode = "provider"            # default "local"
provider = "better-auth"     # the only value
organization = "acme"        # the bound organization's slug; required for "provider"
path = "/api/auth"           # same origin, under site.base_path; default "/api/auth"
methods = ["passkey"]        # ways in: "passkey", "password", "oidc:<provider-id>"; default ["passkey"]. Pending Q5
```

The projection carries `identity: { mode, organization, path, methods }` and nothing else: no secret, no issuer key, no database. The provider's own configuration (its secret, database and OIDC clients) is the hosted lane's, through `createLoamAuthOptions`, and never in the deployment file, as D63 keeps credentials out.

| Refusal | Code |
| --- | --- |
| `mode = "provider"` with no `organization`, or an `organization` off the slug pattern | `DEPLOYMENT_IDENTITY_INVALID` |
| `path` not a path under `base_path`, holding `.` or `..`, or one a deployment's own files use | `DEPLOYMENT_IDENTITY_INVALID` |
| `methods` empty, or naming an unknown method | `DEPLOYMENT_IDENTITY_INVALID` |
| A `provider` deployment with a mounted `stdio` instance | `DEPLOYMENT_STDIO_TEAM`: D56 trusts a `stdio` child as the host's user, which a team's members are not. Refused, not warned |

### 2.3 The workspace bound to an organization

`WorkspaceV1.organization`, reserved `null` by phase 2, becomes:

```ts
export interface WorkspaceV2 extends Omit<WorkspaceV1, 'organization'> {
	/** The bound organization in `provider` mode, from the projection and the provider; `null` in `local`. */
	organization: { id: string; slug: string; name: string } | null;
	/** Raised when the workspace's membership changes; read by the collaboration service (D46). */
	memberEpoch: number;
}
```

- **The deployer binds it.** One deployment, one workspace, one organization (D32). The slug is the deployer's statement; the id and name come from the provider at stage B, and a slug the provider does not know is `IDENTITY_ORGANIZATION_UNKNOWN`, shown in main to everyone, owners included, naming the deployment file.
- **The person's active organization follows the workspace.** At sign-in, and whenever the session's active organization differs, the adapter sets it to the bound organization if the person is a member of it (Better Auth's `setActive`), so the provider's role checks and Loam's agree. A person who is not a member stays signed in, and sees "You are not a member of Acme" in main, with their pending invitations, which `MEMBER_EXEMPT_COMMANDS` lets them accept.
- **No workspace switcher.** A deployment has one workspace. The account section lists the person's organizations read-only, and which one this workspace is bound to; phase 2's title bar text stays.
- **Membership is the provider's.** Loam keeps no copy of who is a member: `MembershipV1` ([3.3](#33-the-access-decision-version-2-d86)) is read from the provider at stage B and on `session-settle`, cached in memory, and never written to the store. `memberEpoch` is Loam's, raised by each `member-*` mutation and by `session-settle` when the cached membership differs.

### 2.4 The test-only auth host

Before phase 6, nothing serves Better Auth on the shell's origin, so phase 3 proves its browser criteria against a **test-only auth host**, as D64 proved mounts through a test-only relay, and says so wherever a result is recorded.

- `startTestAuthHost({ organization, members, methods })`, in `@lushly-dev/loam-identity/testing`: a real Better Auth 1.7 server in a child process, on `node:sqlite` in a temporary directory, from `createLoamAuthOptions`, with `rpID` `localhost`. It seeds the organization, its people with their roles (an email and password each, so a test can enrol a passkey), and returns its origin and a `close()` that removes everything. It reuses `packages/auth/hosted/better-auth`'s process and cleanup code by import, not by copy.
- `serveDeployment` in `web/test/browser/harness.ts` gains `authHost?: TestAuthHost`, and proxies `<base_path>api/auth/*` to it, so the page, the probe and the provider share an origin, as the mount relay shares one for `mounts/`. The site is served on `localhost`, which WebAuthn treats as a secure context.
- **A virtual authenticator.** `addVirtualAuthenticator(page, { userVerification: true })` in the harness, through Chromium's DevTools `WebAuthn` domain on the page's CDP session (`protocol: 'ctap2'`, `transport: 'internal'`, `hasResidentKey`, `hasUserVerification`, `isUserVerified: true`). No real authenticator, platform prompt or person is involved, and E1's record says so.
- **What it does not prove:** the hosted lane, its HTTPS, its database, a second device on another network, or a provider other than Better Auth. [Section 10](#10-the-dependency-on-phase-6s-hosted-lane-d84) gives those to the hosted criterion.

## 3. The actor and the access decision

### 3.1 The actor on each path

AFD's actor is the principal on every call (architecture section 5). Phase 3 sets it on every path, so `decideAccess` never reads an actor it cannot place:

| Path | Actor | Today |
| --- | --- | --- |
| `kernel.call` (the palette, the chrome) | `{ kind: 'human', id: <user id>, label: <name> }` from the session; `local` mode signed out: none, read as `local` | The same |
| `kernel.agent.call` | **`{ kind: 'agent', id: options.agent ?? 'shell-agent', onBehalfOf: <user id> }`**: the registry's interface sets the kind and the id, afd-auth's middleware sets `onBehalfOf` from the session (`middleware.ts:38-44`) | Runs as the human, since the agent registry sets no actor and the middleware fills a missing one as `human`. **Changed:** a journal now says an agent acted ([E12](#18-exit-criterion-and-tests) lists the phase 2 tests this amends) |
| An app's port, a surface's port, a nested call | The outer call's actor, unchanged; `caller` names the app (phase 1's 7.6) | The same |
| MCP on the hosted server | From the token ([9.2](#92-the-hosted-principal-mapping)); no token, no call (401) | `{ kind: 'agent' }`, no id, read as `local` |
| Replay | The entry's recorded actor (`actorOf`), as phase 2's 10 has it | The same |

**Everything per person reads the person, not the agent.** Phase 2's `actorKey` becomes `personKey(actor)` ([3.3](#33-the-access-decision-version-2-d86)) wherever it keys a person's record (`loam.new.recent~<actor>`, [4.5](#45-a-persons-records-per-actor)'s records), decides "self" (`PROJECT_MEMBER_SELF_REQUIRED`, a recents read) or fills `createdBy` and `updatedBy`, which therefore keep meaning whose action it was. The journal keeps the whole actor, so audit names the agent and the person (architecture section 8).

`options.agent`, an id of 1 to 64 characters matching `^[a-z0-9][a-z0-9-]*$`, is phase 5's: the copilot names its agents. An id starting `agt_` is refused on this path with `AGENT_MEMBER_PATH_INVALID`, since an agent member acts only through phase 5's delegation, never by naming itself.

### 3.2 Who is who

- **A person's id** is the provider's user id (Better Auth's, opaque), or the Mock's `mock-user-<email>` in `local` mode. Never an email, so a changed email keeps every membership.
- **An agent member's id** is `agt_` and 20 characters of `[a-z0-9]` from the kernel's random source ([section 8](#8-agent-members-d90)). **No person's id may start with `agt_`**: the auth gate refuses a session whose user id does, as `AGENT_CANNOT_SIGN_IN`, whatever the adapter says. Better Auth's ids never do; the check is so that a forged or misconfigured adapter cannot make an agent member a person.
- **A person's own agent's id** is the agent interface's (`shell-agent` or phase 5's names) or `client:<clientId>` over MCP. Neither is ever in a project's `members` or an agent member's record.

### 3.3 The access decision, version 2 (D86)

```ts
/** The workspace's membership as the provider reports it, cached in memory, never stored. */
export interface MembershipV1 {
	mode: 'local' | 'provider';
	/** Person id to role. `local`: the one person, or `local`, as owner. */
	members: ReadonlyMap<string, 'owner' | 'admin' | 'member'>;
}

export interface AccessInputV2 {
	actor: { kind: ActorKind; id: string; onBehalfOf?: string };   // `local` when signed out in `local` mode
	scope: ScopeV1;
	project: ProjectV1 | undefined;
	membership: MembershipV1;
	/** The agent member's record when `actor.id` starts `agt_`, else undefined. */
	agent: AgentMemberV1 | undefined;
}
export function decideAccess(input: AccessInputV2): { allowed: true } | { allowed: false; reason: 'workspace' | 'project' };
```

1. **The person** the call is for, `personKey(actor)`: the actor's id for `human`, its `onBehalfOf` for `agent`. In `provider` mode, no actor (signed out), an `agent` with no `onBehalfOf`, or any other kind has no person, and is refused (`reason: 'workspace'`). In `local` mode it is the human's id or the agent's `onBehalfOf`, and otherwise `local`, so a signed-out agent call enters what it enters today.
2. **Workspace:** that person is in `membership.members`. Refused: `reason: 'workspace'`.
3. **Project,** when `scope.project` is set: as phase 2's 3.4 for that person (missing, or restricted without them, refused, `reason: 'project'`).
4. **Agent member,** when `actor.id` starts `agt_`: the record exists, its effective status is `active` ([8.3](#83-sponsors)), and the scope is in its `access` (`workspace: true` for workspace level, the project's id in `projects` otherwise). Refused: `reason: 'project'`, the same bytes as a missing project.
5. Otherwise allowed. **Neither the active scope nor the persona is an input** (D4, D11): `AccessInputV2` has no field for either, and a unit holds that `scope/access.ts` imports nothing that names a persona.

So **an agent never has more access than the person it acts for**, and an agent member never more than its record: the intersection, as D4's "narrows, never grants" reads for agents, and as D40's "scoped to projects" and "the person still accountable" require together.

**Where it runs.** `decideAccess` stays pure and in first paint. The scope middleware gains **line 0**, before phase 2's line 1, for every command not in `SIGNED_OUT_COMMANDS` or `MEMBER_EXEMPT_COMMANDS`: the workspace step alone, so a non-member is refused at any scope with `WORKSPACE_NOT_MEMBER`, journaled. Lines 1 to 8 of phase 2's 3.4 are unchanged; line 2 now passes the whole `AccessInputV2`, and its refusal stays `PROJECT_NOT_FOUND`. Every shell command row of phase 2's 3.4 that calls `decideAccess` calls version 2. `ProjectCache`, `canOpen`, `opensIn` and `project-list`'s filter take the actor, not its id.

**Membership in stage A.** The probe gives the person ([4.2](#42-first-paint-the-probe)) but not their role, so until stage B reads `MembershipV1`, stage A's `decideAccess` treats the person as a member for the URL's project only. Nothing of a project is shown on that basis that the project's own `members` would not allow, and every command that writes or reads a store waits for stage B, which reads membership before its first `setAppCommands`. A non-member's first frame therefore shows at most the projection's public rail, then the notice.

### 3.4 The trust table

Who may run each new or changed command on each path. "Person" is the palette or the chrome (`kernel.call`), "agent" the agent interface, "port" an app's or a surface's port and a handler's nested client, "MCP" a token's call on the hosted server, "replay" a journal's replay.

| Commands | Person | Agent | Port | MCP | Replay |
| --- | --- | --- | --- | --- | --- |
| `account-get`, `persona-list`, `member-list`, `agent-member-list`, `agent-member-get` | Own account; any member | For the person it acts for | `CALL_NOT_GRANTED` | Served, for the token's person | Answered from the entry |
| `account-update`, `account-passkey-*`, `account-invitation-*`, `account-agent-*`, `session-list`, `session-revoke`, `persona-create`, `persona-update`, `persona-remove`, `persona-set` | Own records only | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served | From the entry; never reaches the provider |
| Owner commands: `member-invite`, `member-invitation-list`, `member-invitation-cancel`, `member-remove`, `member-role-set`, `agent-member-add`, `agent-member-update`, `agent-member-remove`, `workspace-app-set`, and `project-create`, `project-update { access }` on a listed slug ([7.3](#73-projects-and-owners-852)) | An owner; others `OWNER_REQUIRED` | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served | From the entry |
| `member-leave`, `agent-member-confirm`, `agent-member-decline` | Self; the sponsor | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED` | Not served | From the entry |
| `project-update { access }` on any other project | Pending [Q2](#q2-who-may-change-who-is-in-a-project) (recommended: an owner or the project's creator) | `HUMAN_REQUIRED` | `CALL_NOT_GRANTED`, as today | Not served | From the entry |
| `session-settle` (internal) | Kernel only | Never | Never | Never | Its entry |

- **Human commands** (`HUMAN_REQUIRED`) need `actor.kind === 'human'`. D40 says an agent member "cannot sign in or administer"; this specification reads that for every agent, a person's own included: no agent changes who may do what, or a person's credentials, on a person's behalf. Pending [Q3](#q3-a-persons-own-agent-over-mcp), whose recommendation keeps this.
- **Not served over MCP** means left out of `mcpOptions().commands`, as `PERSON_SESSION` is (`late/index.ts:315-322`), so a client gets `COMMAND_NOT_FOUND`. `HUMAN_COMMANDS` and `OWNER_COMMANDS` are two frozen lists in `late-identity`, and `mcpOptions` leaves out both.
- **The ports** are unchanged: none of these is in `APP_CALLABLE_SHELL_COMMANDS_V1` or a grant's list, and **apps receive the actor and the scope, never credentials** (principle 7). E7 calls each through a port and a surface port and gets `CALL_NOT_GRANTED`, journaled.
- **Replay never reaches the provider.** Every command that calls the adapter's account, session, passkey, organization or consent methods is in the kernel's recorded table, as `app-instance-refresh` is (phase 2's 10): a replay answers it from its entry, and one with no entry stops as `REPLAY_NOT_RECORDED`. `auth-sign-in` replays against a Mock seeded with the entry's recorded actor, as today.
- **A new shell command** is decided in `kernel/src/scope/call-scope.test.ts` (STATUS, carried); each command of this phase joins its table, through a person, an agent and two surface ports, on twin workspaces.

## 4. Sessions

### 4.1 The adapter

AFD first (D15): what is generic lands in `@lushly-dev/afd-auth`, in step 0b, with its Mock.

```ts
// packages/auth/src/types.ts, additions
export interface PasskeySignInOptions { method: 'passkey'; autoFill?: boolean }
export type SignInOptions = CredentialsSignInOptions | OAuthSignInOptions | PasskeySignInOptions;

/** Optional capabilities; an adapter implements what its provider has. */
export interface SessionManagement {
	listSessions(): Promise<SessionRow[]>;
	/** A handle from `listSessions`, or every other session, or all of them. */
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
	activeMembership(): Promise<{ organization: { id: string; slug: string; name: string }; role: string } | null>;
	setActiveOrganization(slug: string): Promise<boolean>;
	listMembers(options?: { limit?: number; offset?: number }): Promise<OrganizationMember[]>;
	// invite, cancel, list invitations, remove, set role, leave; accept and reject for the invitee
}

export interface AuthAdapter {
	// …as today, and:
	/** Re-read the session from the provider, bypassing any cache. */
	refresh?(): Promise<void>;
	sessions?: SessionManagement;
	passkeys?: PasskeyManagement;
	organization?: OrganizationAccess;
}
```

- **A session's handle is never its token.** `BetterAuthAdapter.listSessions` keys each row by the first 16 hex characters of SHA-256 over the token, keeps the map in memory, and revokes by token through it. `device` is a label parsed from the user agent ("Chrome on macOS"); **no IP address leaves the adapter**, so none reaches a result or the journal.
- **`BetterAuthAdapter`** implements all three when its client has the organization and passkey plugins; `signIn({ method: 'passkey' })` calls `client.signIn.passkey({ autoFill })`, and a dismissed or failed ceremony is `AuthAdapterError` `PASSKEY_CANCELLED` (the person closed it, not retryable by an agent) or `PASSKEY_UNSUPPORTED` (no WebAuthn). It takes an `initial` state, so the probe's session needs no second request.
- **`MockAuthAdapter`** implements all three in memory, so every kernel unit and phase 0 to 2 test needs no server: passkeys as records, a fixed organization, roles from its options.
- **`createAuthMiddleware`** is unchanged. Loam passes it an `exclude` per mode ([2.1](#signed-out-and-member-exempt-commands)).
- **`createAuthCommands`'s `auth-sign-in`** accepts the passkey method. Its input schema adds the member; nothing else changes.

### 4.2 First paint: the probe

In `provider` mode, stage A must know who is signed in, or a reload inside a restricted project lands at workspace level, as phase 2's 6.3 records under the Mock. Better Auth's client is 42 to 55 KB minified, which first paint cannot hold. So:

- **`web/src/identity.ts`, in first paint:** `probeSession(path)` sends one `GET <path>/get-session?disableCookieCache=true` with `credentials: 'same-origin'`, in parallel with phase 2's boot reads, and reads `{ session: { id, expiresAt }, user: { id, email, name, image } }` or `null`. A failed or malformed answer is signed out, never an error page. **Stage A waits for it at most 1,500 ms**, then paints signed out; a later answer, or stage B's adapter, corrects it through `session-settle` ([4.4](#44-hearing-the-adapter-d88)), so a slow provider delays nothing but a restricted project's restore.
- **`DeferredAuthAdapter(initial, load)`**, in the same file: an `AuthAdapter` whose `getSession` answers the probe's state, and whose `signIn`, `signOut`, `refresh` and capabilities await `load()`, the `auth` chunk, then delegate. Listeners added before the load are moved to the real adapter. The kernel is given this adapter, so nothing in `kernel/src` changes for it.
- **Stage B loads `auth`** in `provider` mode only: `BetterAuthAdapter` and Better Auth's client with the organization and passkey plugins, created with `baseURL: <origin><path>`. It reads the membership ([3.3](#33-the-access-decision-version-2-d86)) before the late commands run.
- **`local` mode** loads neither the probe's request nor `auth`: the budget's E10 asserts that an empty `local` shell requests exactly what phase 2's did.

### 4.3 Revocation and every tab

The exit criterion: "a revoked session signs out every tab".

- **Every tab of this browser.** `session-revoke` of the current session, or `'all'`, signs this tab out through the adapter, and afd-auth's `SessionSync` (already a dependency, `BroadcastChannel` with a `localStorage` fallback) tells every other tab of the profile, whose adapters re-read the session and find none. Each tab's kernel then runs `session-settle` ([4.4](#44-hearing-the-adapter-d88)).
- **Every tab of another device.** Revoking `handle` or `'others'` deletes those sessions at the provider. **The provider refuses them at once**, since `createLoamAuthOptions` sets the cookie cache off (W12): any request those tabs make to the provider or, from phase 6, to the hosted server is refused. **What those tabs show** catches up when their adapter next reads the session: the kernel calls `adapter.refresh()` on `visibilitychange` to visible, on `online`, and every 60 seconds while the page is visible. A browser kernel runs commands against its own store, so a revoked device's tab could keep working offline on what that store already holds until then; [section 16](#16-security) states it.
- **No cookie cache, the cost.** Every provider request reads the session row. With SQLite on the hosted lane's development profile that is a local read; phase 6's hosted profile measures it, and may turn on Better Auth's secondary storage, never the cookie cache.

### 4.4 Hearing the adapter (D88)

Phase 2's scope middleware notices a change of actor only at the next call (#854), so a screen can show what its new actor may not read (#864). The kernel now hears it:

- `createKernelParts` subscribes to `auth.onAuthStateChange`. When the verified actor key (`sessionActor`, `scope/middleware.ts:64-72`) differs from the last one the kernel saw, it runs the internal command **`session-settle {}`**, journaled, on the `palette` interface, queued like any call. Two changes before it runs make one call.
- **Its handler:** reads the membership again (stage B only); runs `applyScopeChange(..., reason: 'actor')` when `decideAccess` refuses the active project, as phase 2's middleware callers do; in `provider` mode with no session, closes the active app (`app-close`'s rules, app overlays dismissed as `app-switch`) and shows the sign-in screen in main; and, with a different person, swaps the person's records ([4.5](#45-a-persons-records-per-actor)). Its result is `{ actor: string | null; left: string | null }`.
- **Its event** carries `actorChanged: true` in `KernelEventV3` ([12](#12-the-kernel-and-the-sdk)), and the chrome re-reads the rail, the projects section and the documents section on it, whatever the scope did. That closes #864: no section keeps a name its actor may not read.
- **Replay.** `session-settle`'s entry replays with its recorded actor, and its handler runs the same lines, so a replayed journal holds the same scope changes in the same order. Phase 2's two middleware callers stay, so a call that races the event is still decided right.
- **Not served,** not callable through a port, refused on the agent interface: in `INTERNAL_COMMANDS`.

### 4.5 A person's records per actor

In `provider` mode, several people may use one browser profile, and phase 2's view-state records of a person's working state are per scope, not per person. So in `provider` mode only, `loam.scope`, `loam.apps`, `loam.editor[@<project>]`, `loam.layout.<owner>[@<project>]` and `loam.persona` take the suffix `~<actor>`, as `loam.new.recent~<actor>` already does, through one function, `personalRecordId(id, person)`, beside `storeRecordId`, keyed by `personKey`. Signed out, the key is `~signed-out`, which holds only defaults and is cleared at each sign-out. `local` mode keeps phase 2's ids, so nothing migrates.

On a change of person, `session-settle` saves nothing and discards nothing: it hydrates the new person's records with `hydrateOne`, and the editor area holds the leaving person's unsaved drafts in memory, keyed by actor, restoring them if that person signs in again in the same page. A held draft makes `beforeunload` ask. **No action of another person loses a draft** (consistent with STATUS's open owner question on agents, which this does not touch).

### 4.6 Session and sign-in commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `auth-sign-in` | mutation, afd-auth's | adds `{ method: 'passkey'; autoFill?: boolean }`. A method not in `identity.methods` is `SIGN_IN_METHOD_UNAVAILABLE` | As today |
| `session-list` | query, recorded | `{}` | `{ sessions: SessionRowV1[] }`: `{ id, current, device, createdAt, updatedAt, expiresAt }`, `id` the adapter's handle |
| `session-revoke` | mutation, recorded | `{ session: string \| 'others' \| 'all' }` | `{ revoked: number; signedOut: boolean }`. No undo. An unknown handle is `SESSION_NOT_FOUND` |
| `session-settle` | internal | `{}` | [4.4](#44-hearing-the-adapter-d88) |

In `local` mode with the Mock, `session-list` answers the one session and `session-revoke` signs out.

## 5. The account section

### 5.1 What it is

A shell section (D1), `section-open { section: 'account', path }`, at `/<workspace>/~/account[/<tab>]` under phase 2's URL scheme. It always runs at workspace level, whatever project is active, and shows nothing of any project. Tabs, each a `path`: `profile`, `passkeys`, `sessions`, `personas`, `members`, `agents` (connected agents), and one per app's `ui.account` section ([5.5](#55-an-apps-account-section)). `members` shows the workspace's people and agent members; its owner controls show only to an owner.

The **account menu**, the title bar's account button (phase 0's "Sign in" or the person's name), opens `loam-account-menu`: the person's name and persona, the persona switch ([section 6](#6-persona-d89)), "Account", "Sign out".

**`AccountV1`** is not stored. `account-get` reads it from the adapter:

```ts
export interface AccountV1 {
	id: string; email: string; name: string; image: string | null;
	organizations: { id: string; slug: string; name: string; role: string; bound: boolean }[];
	workspace: { member: boolean; role: 'owner' | 'admin' | 'member' | null; owner: boolean };
	persona: string;                                   // the active persona's id, or 'default'
	methods: ('passkey' | 'password' | `oidc:${string}`)[];   // what this deployment allows
}
```

### 5.2 Passkeys

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `account-passkey-list` | query, recorded | `{}` | `{ passkeys: PasskeyRowV1[] }`, `{ id, name, createdAt, deviceType, backedUp }` |
| `account-passkey-add` | mutation, recorded, human | `{ name?: string (1 to 64) }` | `PasskeyRowV1`. Undo: `account-passkey-remove` |
| `account-passkey-rename` | mutation, recorded, human | `{ passkey; name }` | `PasskeyRowV1`. Undo restores the name |
| `account-passkey-remove` | mutation, recorded, human | `{ passkey }` | `{ removed: true }`. No undo: a credential cannot be restored. **Refused as `PASSKEY_LAST`** when it is the person's only passkey and `identity.methods` holds no other way in |

- **User verification is required** on every ceremony (`authenticatorSelection.userVerification: 'required'`, and checked by the provider), as Umbel's owner required of every person login (Umbel phase 5, 2026-11-04).
- **`account-passkey-add` needs a person's gesture.** The chrome calls it from a button press; WebAuthn refuses a ceremony without transient activation, which is `PASSKEY_CANCELLED`.
- **Signals.** After `account-passkey-remove`, where `PublicKeyCredential.signalUnknownCredential` exists, the chrome signals it (W32), so the authenticator stops offering it. Feature-detected; nothing depends on it.
- **The sign-in dialog,** `loam-sign-in-dialog`, opened by "Sign in": a "Sign in with a passkey" button first, then the email field with `autocomplete="username webauthn"` for autofill (conditional mediation, started when the dialog opens, if `PublicKeyCredential.isConditionalMediationAvailable()` says so), then each other method the deployment allows. It is a shell modal through the overlay manager (phase 1's section 8).

### 5.3 Invitations and connected agents

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `account-invitation-list` | query, recorded | `{}` | `{ invitations: { id, organization: { slug, name }, role, expiresAt }[] }`, the person's own, by their verified email |
| `account-invitation-accept` | mutation, recorded, human | `{ invitation }` | `{ organization, role }`; runs `session-settle` nested when it makes the person a member here |
| `account-invitation-reject` | mutation, recorded, human | `{ invitation }` | `{ rejected: true }` |
| `account-agent-list` | query, recorded | `{}` | `{ agents: { client, name, scopes, grantedAt }[] }`: the MCP clients the person authorized (the provider's consents), [9.4](#94-connected-agents) |
| `account-agent-revoke` | mutation, recorded, human | `{ client }` | `{ revoked: true }`: deletes the consent and revokes that client's refresh tokens |

### 5.4 Profile

`account-update { name?: string (1 to 80); image?: string | null }`, mutation, recorded, human, through the provider's `updateUser`; undo restores. `image` is a URL the provider stores, rendered by the chrome only as an `<img>` with `referrerpolicy="no-referrer"` from `img-src 'self' data:`, so a remote image does not load and the initials show instead; changing the CSP is not this phase's. **Account deletion and data export** are out of scope ([section 17](#17-out-of-scope-and-the-seams-reserved)).

### 5.5 An app's account section

Phase 1's catalog lists `account`, `ui.account`, as phase 3's. Served now, as a manifest version 2 key, by removing its `later('ui.account', 3)` line from `manifest/src/refusal-map.ts:108` and setting nothing else: the catalog already says `servedFrom: 3` (`manifest/src/catalogs.ts:153`):

```toml
[[ui.account]]
id = "hello-prefs"           # unique in the app
title = "Hello"              # 1 to 40, the tab's text, scanned by textRules
surface = "account"          # the app's surface rendered as the tab's body: a native mount or a view
```

- It runs at **workspace level** through a surface port created with `{ scope: { workspace }, readOnly: false }` (D83), with the app's grants and nothing more. It learns no more of the person than any surface: the actor through its handler's context ([12](#12-the-kernel-and-the-sdk)), never an email, a session or a credential.
- An app contributes at most 2 sections; more is `MANIFEST_ACCOUNT_LIMIT`. A mounted manifest's `ui.account` is refused (`MANIFEST_ACCOUNT_MOUNTED`), as `ui.new` from a mounted manifest is.
- `apps`' reader gains the rule; its budget row is near its ceiling ([section 13](#13-budgets)).

## 6. Persona (D89)

### 6.1 The record

D11: "Persona is a lens (presentation, defaults, emphasis), never a grant." The proposal: "A person may hold several and switch through the account menu; the switch is explicit and visible."

```ts
export interface PersonaV1 {
	id: string;                    // `per_` and 16 of [a-z0-9]
	workspace: string;
	actor: string;                 // the person; never an agent
	title: string;                 // 1 to 40: what the switch shows, "Reviewer"
	presentation: { name?: string /* 1 to 80 */; pronouns?: string /* 1 to 40 */; avatar?: string /* an ICONS_V1 id */ };
	defaults: {
		landing?: { section: 'projects' | 'documents' } | { app: string };   // applied at sign-in only
		project?: string | null;   // a slug; applied at sign-in only, through decideAccess
		density?: AppearanceDensityV0;
		theme?: AppearanceThemeV0;
	};
	emphasis: {
		apps?: string[];           // up to 12 instance ids, first in their band, marked emphasized
		sections?: ('projects' | 'documents' | 'account')[];   // ordered first in the palette's sections
	};
	createdAt: number; updatedAt: number; updatedBy: string;
}
```

- Table `persona` in the workspace store, keyed by `id`, through the store interfaces and their conformance suite, both adapters. Up to 8 per person (`PERSONA_LIMIT`). **`default`** is implicit, with no record: no presentation, defaults or emphasis, and it cannot be removed.
- **Read only by its own actor.** To anyone else a persona answers as one that does not exist, as `loam.new.recent~<actor>` does (phase 2's 3.4), and `persona-list` lists only the caller's person's.
- The active persona is the view-state record `loam.persona~<actor>` (`{ active: string }`), personal by [4.5](#45-a-persons-records-per-actor) in both modes, since a persona is always a person's.

### 6.2 What a persona may change

| Changes | How | Never |
| --- | --- | --- |
| The name, pronouns and avatar the title bar and the members tab show | `presentation` | The actor's id or label in the journal: those stay the provider's |
| Density and theme | `persona-set` applies `defaults.density` and `defaults.theme` through `appearance-set`'s code, in the same call, journaled | |
| Landing and project | At sign-in, by `session-settle`, each through `canOpen` and `decideAccess`; refused silently when not allowed | A switch never moves the person |
| Emphasis | `bandFor`'s comparator puts `emphasis.apps` first in their band, each marked with the `emphasized` part state; `palette-search` ranks their commands and `emphasis.sections` first | **Hiding.** An emphasis can order and mark, never remove an entry, a section or a command: every app the person may open stays in the rail, reachable by keyboard, and every command in the palette |

**Persona never reaches a decision.** The persona id is the declared context field `persona`, `dev.loam/persona`, `journal: true`, set by the kernel from `loam.persona~<actor>` on every in-process call. It is not declared to a server (`MCP_CONTEXT_FIELDS` stays `[scope]`), not given to apps (an app's context carries no persona), and **not an input to `decideAccess`, `checkedCall`, the grants, the auth gate or the owner and human checks**. E2 holds it three ways: a unit sweep runs every registered command through a person and an agent under two personas on twin stores and compares each result's `ok`, `error.code` and data, ignoring `persona` in the context; a unit asserts `AccessInputV2`'s keys; and a scan finds no `persona` in `scope/access.ts`, `scope/middleware.ts`, `late/port-callable.ts`, `late/port-refusals.ts` or the identity chunk's owner check.

### 6.3 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `persona-list` | query | `{}` | `{ personas: PersonaV1[]; active: string }`, `default` first |
| `persona-create` | mutation, human | `{ title; presentation?; defaults?; emphasis? }`. An `emphasis.apps` id that is not an instance is `PERSONA_INVALID` | `PersonaV1`. Undo: `persona-remove` |
| `persona-update` | mutation, human | `{ persona; title?; presentation?; defaults?; emphasis? }` | `PersonaV1`. Undo restores |
| `persona-remove` | mutation, human | `{ persona }`; the active one switches to `default` in the same call | `{ removed: true }`. Undo: `persona-create` with the same fields and id |
| `persona-set` | mutation, human | `{ persona }` | `{ persona; previous }`. Undo: `persona-set { persona: previous }` |

The switch is visible: `persona-set` announces "Persona: Reviewer" in the live region, and the title bar shows the active persona's title beside the name when it is not `default`.

## 7. Memberships and owners (D87)

### 7.1 Who is an owner

**Pending [Q1](#q1-who-counts-as-an-owner).** Written to the recommendation: in `provider` mode, a workspace member whose role in the bound organization is **`owner` or `admin`**. In `local` mode, the one person, or `local`. `MembershipV1` holds the role; `isOwner(membership, person)` in `scope/` is the only place that reads it, and every owner command calls it after line 0, then `HUMAN_REQUIRED`, then `OWNER_REQUIRED`, each journaled.

**The last owner.** `member-remove`, `member-leave` and `member-role-set` refuse to leave the organization with no `owner`-role member, `MEMBER_LAST_OWNER`, before calling the provider (Better Auth's documentation does not say it guards this, R10).

### 7.2 Member commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `member-list` | query, recorded | `{ limit?: 1 to 200; offset? }` | `{ people: MemberV1[]; agents: AgentMemberV1[]; total }`. `MemberV1` is `{ id, name, image, role, persona?: { title } }`; **`email` only when the person the call is for is an owner**. Agent members are listed apart and never counted as seats (D40) |
| `member-invite` | owner, recorded | `{ email; role: 'member' \| 'admin' \| 'owner' }`. Only an `owner`-role member may invite an `owner` | `{ invitation, expiresAt }`. Undo: `member-invitation-cancel` |
| `member-invitation-list` | owner, query, recorded | `{}` | The organization's pending invitations |
| `member-invitation-cancel` | owner, recorded | `{ invitation }` | `{ cancelled: true }` |
| `member-remove` | owner, recorded | `{ member }` | `{ removed: true; suspended: string[] }`, the agent members it sponsored ([8.3](#83-sponsors)). No undo: re-invite |
| `member-role-set` | owner, recorded | `{ member; role }`. Only an `owner`-role member grants or removes `owner` | `{ role; previous }`. Undo restores |
| `member-leave` | human, recorded | `{}` | `{ left: true }`, then `session-settle` |

Each mutation raises `WorkspaceV2.memberEpoch` and re-reads `MembershipV1`. A removed person's restricted-project entries stay in `access.members` as history; they grant nothing, since line 0 refuses a non-member first.

### 7.3 Projects and owners (#852)

D55's consequence and phase 2's 9.1: "no multi-member deployment can exist until phase 3 restricts both to an owner".

- **A listed slug** is one that a `workspace-app` record with `listed !== null` names in `projects`. For a listed slug, **`project-create` and `project-update { access }` are owner commands**: anyone else gets `OWNER_REQUIRED`, whose message says "Only an owner can create or change the members of a project a team instance serves", since the projection naming those slugs is public. So D55's "every member of its projects may read all of it" stays the deployer's and the owners' statement, and no other member can widen it.
- **`PROJECT_SLUG_TAKEN` becomes `PROJECT_SLUG_UNAVAILABLE`,** one message, "That slug can't be used. Choose another", for a slug a project already has (whether or not the caller may enter it), a reserved one, or `all`. A non-member of a restricted project learns only that a slug is unavailable, which a reserved word also answers.
- **Other projects' members.** Pending [Q2](#q2-who-may-change-who-is-in-a-project). Written to the recommendation: `project-update { access }` is allowed to an owner or the project's `createdBy`; anyone else gets `OWNER_REQUIRED`. Any member of a restricted project may remove only themselves, through `project-update { access: { mode: 'restricted', members } }` whose `members` equals the current list minus the caller.
- **`PROJECT_MEMBER_SELF_REQUIRED`** applies to a non-owner only: an owner may set a restricted list without themselves, since an owner can always change it back.
- **`PROJECT_MEMBER_NOT_PERSON`:** `access.members` holds person ids only. An `agt_` id, a `client:` id, `shell-agent` or `local` in `provider` mode is refused. Agent members reach projects through their own record (D40: not a seat).
- `project-update { access }` raises the project's `memberEpoch`, as phase 2's record already provides.

### 7.4 The workspace's apps

`workspace-app-set` becomes an owner command, as D73's consequence says. `workspace-app-list` stays any member's.

## 8. Agent members (D90)

### 8.1 The record

D40: "An agent identity has a human sponsor, is installed by a workspace owner, is scoped to projects, is not a seat, is visible on delegated work with the person still accountable, cannot sign in or administer, and reads workspace and project guidance … Identities in phase 3, delegation and guidance in phase 5."

```ts
export interface AgentMemberV1 {
	id: string;                    // `agt_` and 20 of [a-z0-9], from the kernel's random source
	workspace: string;
	name: string;                  // 1 to 80
	description?: string;          // up to 500
	sponsor: string;               // a person member's id
	installedBy: string;           // the owner who added it
	access: { workspace: boolean; projects: string[] };   // project ids; up to 200
	guidance?: string;             // up to 8 KiB; stored now, read by phase 5
	status: 'pending' | 'active' | 'suspended';
	suspended?: 'sponsor-left' | 'sponsor-declined' | 'owner';
	createdAt: number; updatedAt: number; updatedBy: string;
}
```

Table `agent-member` in the workspace store, through the store interfaces and both adapters. It has **no account at the provider**: no user row, no email, no password, no passkey, no session. That is what "cannot sign in" means here, and [3.2](#32-who-is-who)'s `agt_` rule makes it hold against a forged adapter too.

### 8.2 Commands

| Command | Kind | Input | Result data |
| --- | --- | --- | --- |
| `agent-member-add` | owner | `{ name; sponsor; access; description?; guidance? }` | `AgentMemberV1`, `status: 'pending'`, or `'active'` when the sponsor is the caller. Undo: `agent-member-remove` |
| `agent-member-list` | query | `{ status?: 'active' \| 'pending' \| 'suspended' \| 'all' }`, default `all` | `{ agents: (AgentMemberV1 & { warnings: string[] })[] }`, each with its sponsor's `name` |
| `agent-member-get` | query | `{ agent }` | The same row |
| `agent-member-update` | owner | `{ agent; name?; description?; access?; guidance?; sponsor? }`; a new sponsor makes it `pending` again unless the new sponsor is the caller | The row. Undo restores |
| `agent-member-remove` | owner | `{ agent }` | `{ removed: true }`. Undo: `agent-member-add` with the same id and fields |
| `agent-member-confirm` | human, the sponsor alone | `{ agent }` | The row, `active` |
| `agent-member-decline` | human, the sponsor alone | `{ agent }` | The row, `suspended: 'sponsor-declined'` |

None is reachable through a port; none of the mutations is served over MCP ([3.4](#34-the-trust-table)).

### 8.3 Sponsors

- **The sponsor must be a person member** (`AGENT_SPONSOR_INVALID` otherwise), and **may enter every project in `access.projects`** when the record is added or its access or sponsor changes (`AGENT_SPONSOR_INVALID`, naming the projects the sponsor cannot enter only to the owner who called). An owner cannot give an agent a project its sponsor cannot see.
- **The sponsor accepts.** Pending [Q4](#q4-naming-a-sponsor). Written to the recommendation: an agent added with another person as sponsor is `pending` until that person runs `agent-member-confirm`, and the sponsor's account menu and members tab show it waiting. A pending agent member is listed, shown with its sponsor, and allowed nothing by `decideAccess`.
- **Effective status.** `decideAccess` and `agent-member-list` read the status as stored, made `suspended` by any of: the sponsor is no longer a workspace member (`sponsor-left`), whatever removed them, the provider included. `member-remove` also writes it, so the record says why. An owner reactivates a suspended agent member only by naming a new sponsor.
- **A lapsed project.** When the sponsor later loses a project in `access.projects`, the agent member keeps it on its record, and `agent-member-list` shows the warning `SPONSOR_PROJECT_LOST` for the owner to act on. Phase 3 does not remove it silently; phase 5, which lets agent members act, decides whether delegated work in such a project is refused (a follow-up).
- **Visible with its sponsor.** The members tab lists each agent member as "Name · Agent · Sponsored by Alice", in text, never by an icon alone, with its status and projects. The journal records an agent member's calls (from phase 5) with its actor and `onBehalfOf`, so audit names both (architecture section 8).

### 8.4 How an agent member acts

Not in phase 3: delegation is phase 5's (D40). Phase 3 specifies only its access, `decideAccess`'s line 4, held by units over synthetic actors, and that **no path lets it act on its own**: the agent interface refuses an `agt_` id (3.1), MCP maps a token's client to `client:<id>` and never to an `agt_` id (9.2), and the provider holds no account for it.

## 9. Over MCP and the hosted token layer (D91)

### 9.1 AFD first: the TypeScript layer

`spec/authorization.md` (M1 to M7) is specified, and Rust implements it; TypeScript does not. **Steps 0a and 0c build it in `@lushly-dev/afd-server`,** from the spec, with no change to the spec:

- **0a, verification:** `createMcpHandler({ auth })` with the spec's options (`resource`, `authorizationServers`, a verifier, `scopesSupported`, `requiredScopes`, `resolver`, `filterToolsByScope`, `resourceName`); the bearer rules (M2) on every HTTP MCP route; `JwtVerifier` with a JWKS key source (RS256, ES256, EdDSA) and token introspection as the alternative (M3), **the audience check of M3.1 not optional**; `credentials` on the context, never the token (M4); the 401 and 403 challenges and rule codes (M5); the RFC 9728 metadata routes (M7); fail closed (M1). It loads every case of `spec/authorization.json`'s `bearer`, `challenges`, `metadataUrls`, `metadataDocuments`, `audience`, `scopeClaims`, `jwtHeaders`, `keys` and `claims`, and one test per M3 rule with keys made in the test. A test authorization server fixture, credential-free, extends `pnpm test:hosted:local`'s style.
- **0c, scopes:** static `scopes` and a `ScopeResolver`, the 403 before dispatch for `tools/call` including `afd-call`, `afd-batch` and `afd-pipe`, `INSUFFICIENT_SCOPE` after routing, listing with `filterToolsByScope`, hidden commands (M6); `staticScopes` and `batches` cases.
- `/direct`'s entry budget is unchanged: the layer is in the Node handler's graph only, which `entry-points.test.ts` asserts.
- `spec/authorization.md`'s implementation table marks TypeScript's rows done, each step its own; the parity rows of `alfred parity` move with them.

### 9.2 The hosted principal mapping

`principalOf(credentials, membership)` in `@lushly-dev/loam-identity`, called from the hosted server's `createContext`:

1. `credentials.issuer` is the provider's issuer (`<origin><identity.path>`), exactly. Otherwise refused, `PRINCIPAL_ISSUER_UNKNOWN`, which the verifier's issuer list already makes unreachable; the check is kept so that a misconfigured verifier fails closed.
2. `credentials.subject` is a person's id (Better Auth's `sub` is its user id). An `agt_` subject is `AGENT_CANNOT_SIGN_IN`.
3. **The actor is `{ kind: 'agent', id: 'client:' + credentials.clientId, label: <the client's registered name>, onBehalfOf: credentials.subject }`.** A token always means an agent acting for its person: a person at the shell signs in through the provider, never with a bearer token.
4. `decideAccess` then decides as for any agent ([3.3](#33-the-access-decision-version-2-d86)): the person's workspace membership and project access, and nothing more. A subject who is not a member gets `WORKSPACE_NOT_MEMBER` on any command; the token was valid, so it is a tool error, not a 401.
5. `credentials` is on the context, never journaled, never in a result, never forwarded to a mounted instance (M4). The journal keeps the actor.

**Pending [Q3](#q3-a-persons-own-agent-over-mcp)**, which asks whether a person may connect their own agent at all without an owner installing it. Written to the recommendation (yes, with the person's access, and no owner or human command). The other answer replaces step 3 with "the client must be an agent member's registered client", and phase 3's E8 and H3 change accordingly; the rest of this section stands.

### 9.3 Scopes

| Scope | Needed by | Note |
| --- | --- | --- |
| `loam:read` | Every request (`requiredScopes`) and every query | The 401's `scope` |
| `loam:write` | Every mutation, by `createMcpAuth`'s resolver reading the registry's `mutation` flag | A mounted instance's unreported command counts as a mutation (D65) |

- `scopesSupported: ['loam:read', 'loam:write']`, `filterToolsByScope: false`, so `tools/list` stays one list for every token (phase 2's E5 holds it), and a read-only token learns a mutation's name and its 403.
- **Human and owner commands are not served** ([3.4](#34-the-trust-table)), so no scope reaches them. No `loam:admin` scope exists.

### 9.4 Connected agents

The provider is the authorization server: Better Auth's `oauthProvider` with the JWT plugin, configured by `createLoamAuthOptions`:

- **One resource:** the hosted server's canonical MCP URI, `https://<host><base_path>mcp`, the only entry in the provider's `resources`, so every token's `aud` is exactly it (M3.1, W33). A token for any other audience is refused with a 401 by the layer.
- **Access tokens are JWTs** (RFC 9068), lifetime 10 minutes; refresh tokens rotate, lifetime 30 days; PKCE S256 required; **consent per person, per client**. Clients register by Client ID Metadata Document first, Dynamic Client Registration only if the deployer turns it on (MCP 2026-07-28 deprecates it).
- **The person sees and revokes them:** the account section's "Connected agents" tab, `account-agent-list` and `account-agent-revoke` ([5.3](#53-invitations-and-connected-agents)). Revoking deletes the consent and the refresh tokens; an access token already issued lives out its 10 minutes, which the tab says.

### 9.5 Proof before the hosted lane

**E8, through a test-only handler, as phase 2's E5 was:** a real `createMcpHandler` from step 0a with `mcpOptions()` and `createMcpAuth`, on a loopback `node:http` server; a test-only auth host issuing real tokens from Better Auth's `oauthProvider` for two audiences; AFD's `StreamableHttpTransport` as the client. What it proves and leaves out is [section 10](#10-the-dependency-on-phase-6s-hosted-lane-d84)'s.

## 10. The dependency on phase 6's hosted lane (D84)

Architecture section 9: "the hosted lane must reach its development profile before phase 3's hosted criterion". Phase 6 has no specification yet.

### 10.1 The exit, in two parts

| Part | Criterion | Proved by | Needs |
| --- | --- | --- | --- |
| **Local** | A person signs in with a passkey; persona changes emphasis and never what the person may do; a revoked session signs out every tab; an owner's agent member appears with its sponsor and cannot sign in; a token for the wrong audience is refused by AFD's layer | P3-E1 to P3-E15: the kernel, the chrome, the adapter and Better Auth, real, **through a test-only auth host and a test-only handler**, in `loam.yml` and `ci.yml` | Nothing outside this phase |
| **Hosted** | The same sign-in and refusal on the hosted lane at its development profile, with a person's own agent calling through it | P3-H1 to P3-H3, in the hosted lane's job | Phase 6's development profile ([10.2](#102-what-phase-6-must-deliver-first)) |

**Phase 3 exits when both pass.** The local part's run is recorded in STATUS.md as "local criterion met, through a test-only auth host and handler", which unblocks nothing: phase 5 needs phase 3's exit and phase 6's hosted lane anyway, and phase 4 needs neither.

### 10.2 What phase 6 must deliver first

Phase 6's specification takes these as its development profile's minimum for phase 3:

1. One Node process on Hono (D36) serving the built shell under `base_path`, with phase 0's CSP as response headers, `frame-ancestors` among them.
2. Better Auth at `identity.path` on the same origin, from `createLoamAuthOptions`, with its SQLite database in the profile's data directory.
3. `createMcpHandler` at `<base_path>mcp`, mounted through Hono's Node adapter (D36), with `mcpOptions()` and `createMcpAuth`; RFC 9728 metadata at its well-known path.
4. A kernel on the server for MCP calls, with its store; how it relates to a browser's store is phase 6's to decide, and phase 3's hosted tests use only what one server holds.
5. A development profile reachable over HTTPS on loopback with a generated certificate, as `pnpm test:hosted:local` already does, started by one command, and a `loam.yml` job that runs Chromium against it and prints test titles, which the exit check reads.

### 10.3 The order, recommended for the coordinator to decide

**Recommended: approve and start phase 3 now, write phase 6's specification next with its hosted lane first, and let phase 3's last step wait for phase 6's development profile.**

- **Most of phase 3 needs no server.** Steps 0a to 9 (AFD's TypeScript layer, the adapter's capabilities, the access decision, owners, sessions, personas, agent members, identity over MCP through a handler) are proved locally, as phase 2 proved scope over MCP before any host.
- **#852 and #853 are conditions of any multi-member deployment,** and phase 6's hosted lane is exactly the first one. Settling them before the hosted lane is built means it is built against the rules it must enforce, rather than shipping with "whoever reaches the kernel is a member".
- **The token layer is AFD's,** and phase 6 consumes it: building it first removes a dependency from phase 6 rather than adding one.
- **Phase 4 is unaffected** and may proceed in parallel.

**The alternative,** phase 6's hosted lane first: the test-only auth host and handler would be unnecessary, and phase 3 would be proved once, on the real host. It costs time: phase 3's rules, which phase 6's hosted lane must enforce, would wait, or phase 6 would build its auth wiring before the rules exist and revisit it. The test-only host is small, reuses `packages/auth/hosted/better-auth`, and keeps proving the browser path in `loam.yml` after phase 6 lands.

## 11. Journal, replay and secrets

- **No secret is journaled.** `redactJournalRecord` (`kernel.ts:113-119`) keeps removing `input.password` from `auth-sign-in`, and now also removes any `input.code` or `input.token` from any command, as a second line. A passkey ceremony's challenge and assertion never pass through a command's input or result: the adapter holds them. `session-list`'s handles are digests; no row holds a token, a cookie, an IP address or a key. `credentials` is never journaled (M4). E15 scans every entry and store row of its sessions for the seeded password, every cookie value, every token and every assertion's bytes.
- **Personal data.** The journal holds actor ids and labels, as today, and persona titles in `persona-*` inputs; `member-list`'s emails only in an owner's journal. Exporting or deleting them is the account's export and deletion, out of scope ([section 17](#17-out-of-scope-and-the-seams-reserved)).
- **Replay.** Recorded identity commands answer from their entries ([3.4](#34-the-trust-table)); `session-settle` replays its scope changes; `diffJournals` ignores the session's `id` and `expiresAt` and the Mock's ids, as today, and nothing else new.

## 12. The kernel and the SDK

- **Kernel interface version 3.** `KERNEL_INTERFACE_VERSION = 3`. `KernelEventV3` adds `actorChanged?: true` and `personaChanged?: true` to `KernelEventV2`. `LoamKernelV3.call` and `.agent.call` take `options.agent` (3.1). `shell-info-get` reports `identity: { mode, organization }`.
- **`KernelOptionsV3`** adds `identity?: IdentityV1` (from the projection; default `local`). The auth adapter stays `options.auth`.
- **The SDK.** An app's handler context gains `actor: Readonly<ActorV1>`, `{ kind, id, label?, onBehalfOf? }`, copied from the call, so an app can attribute its records (architecture section 7: every record carries the actor that wrote it). Never an email, a session, a persona, a role or a credential. `AccountSectionV1` types `ui.account`. `createAppTestKernel` takes `actor`.
- **The domains.** `account`, `persona`, `session` and `agent` are already in `SHELL_DOMAINS_V1` (`manifest/src/catalogs.ts:195-235`); `member` joins it, and the manifest refuses an app id `member` as it refuses the other shell domains.
- **Store tables** `persona` and `agent-member` join the workspace store's tables, with their indexes (`persona` by `actor`, `agent-member` by `sponsor`), in step 1's store version.

## 13. Budgets

Against phase 2's [2.4](../2-scope-projects/spec.md#24-the-budget-and-the-rule): first paint is 286,084 bytes and 88,196 gzip of 300,000 and 91,000, and its rules stand. **Account UI, passkey code and the provider's client are lazy; first paint gains only what stage A needs to know who is signed in.** Each estimate is a first figure; the step that adds the code measures it, records its ledger line in its pull request and STATUS.md, and sets each new row's ceiling at the measurement plus 10%, approved by the coordinator.

| Row | Where | Estimate | Note |
| --- | --- | --- | --- |
| `jsMinified`, `jsGzip` | First paint | **+2,600 and +1,100**: the probe and `DeferredAuthAdapter` (~900), reading `identity` (~250), `decideAccess` version 2 and `isOwner` (~500), persona emphasis in `bandFor` (~500), the signed-out main's button (~450) | To about 288,700 and 89,300. Step 1's allowance 1,000 and 450; step 3's 1,100 and 450; step 5's 500 and 200 |
| `kernelMinified` | The kernel alone | +900 | 111,761 of 113,401, so step 1 measures first, and moves `session-settle`'s subscription into `late` if the row would pass 113,401 |
| `auth` (new) | Stage B, `provider` mode only | 58,000 | The client with both plugins measured 54,853 (S81's version, esbuild, 2026-11-09), plus `BetterAuthAdapter`. **Never requested in `local` mode** (E10) |
| `late-identity` (new) | Loaded inside `loadLate`, like `late-documents` | 14,000 | Every command of sections 4 to 8 |
| `late` | | +1,500 | `session-settle`, the owner checks in `project-*` and `workspace-app-set`, `HUMAN_COMMANDS` and `OWNER_COMMANDS` in `mcpOptions`. 67,609 of 75,000 |
| `sign-in` (new) | When "Sign in" is pressed | 5,000 | The dialog. The passkey ceremony's code is in `auth`, already loaded by then |
| `account-menu` (new) | When the account button is pressed | 4,000 | The menu and the persona switch |
| `account` (new) | When the account section opens | 38,000 | Six tabs and an app's section's host; `sections` (44,707 of 45,000) is not touched |
| `apps` | | +600 | `ui.account`'s rule. **393,918 of 394,094, so step 8 amends the row by its measurement or moves code out first** |
| `surfaces` | | +300 | Mounting an account section through a surface port |

The `budget` script's closures gain the new chunks in load order (first paint, `late`, `late-identity`, `auth`, `apps`, `surfaces`, then the rest), and E10 asserts first paint's exact chunk list in both modes.

## 14. Accessibility

Phase 0's and 2's rules stand: axe with phase 0's tags in every theme and density, under `forcedColors: 'active'` and in the compact class, Specimen captures with ARIA snapshots, F6's order, and the `loam-design` checklist for every new element.

- **The sign-in dialog** is a modal with its heading as its name; focus starts on "Sign in with a passkey"; the email field's label is visible; a failed or cancelled ceremony is announced in the dialog's live region ("Passkey sign-in was cancelled. Try again or use another way in.") and focus stays on the button; Escape closes and returns focus to the account button. The browser's own WebAuthn prompt is outside the page, and the test says so.
- **The account menu** is a menu button; the persona switch is a group of `menuitemradio` with `aria-checked`; switching announces the persona in the shell's live region.
- **The account section's tabs** are a `tablist` whose tabs are links (its URL changes), as phase 2's section headers are; each table has a caption; a session row says "This device" in text; revoke and remove buttons name their row ("Revoke Chrome on macOS"); a destructive action asks through a shell modal with its consequence in the text.
- **Members:** each agent member's row says "Agent" and "Sponsored by <name>" in text; status is text, never color alone; owner controls are absent, not disabled, for a non-owner, so a screen reader is not offered what cannot be done.
- **Emphasis** is a part state with a non-color cue (a weight change and a marker visible in forced colors), and the rail's order change is announced only when the person switched persona, not on every render.
- #708's screen-reader passes stay open; E11's record says what axe cannot judge.

## 15. Failure modes and error codes

Every code has a suggestion and is added to `LoamKernelErrorCode`, afd-auth's `AuthAdapterError`, the deployment's refusals or the manifest's. Each row is covered by a unit test or an exit test. Phase 2's section 12 stands, but `PROJECT_SLUG_TAKEN`, replaced.

| Code | When | Effect | Suggestion says |
| --- | --- | --- | --- |
| `WORKSPACE_NOT_MEMBER` | Line 0 ([3.3](#33-the-access-decision-version-2-d86)) | A failure, journaled | Ask an owner of <organization> to invite you; `account-invitation-list` |
| `OWNER_REQUIRED` | An owner command by a non-owner ([3.4](#34-the-trust-table), [7.3](#73-projects-and-owners-852)) | A failure, journaled | Ask an owner; names none |
| `HUMAN_REQUIRED` | A human command from an agent | A failure, journaled | A person must do this in the shell |
| `AGENT_CANNOT_SIGN_IN` | A person's id starting `agt_`; a token's subject starting `agt_` | Signed out; a failure | Agent members act through delegation |
| `AGENT_MEMBER_PATH_INVALID` | `options.agent` starting `agt_` | A failure, journaled | Name the agent with its own id |
| `AGENT_MEMBER_NOT_FOUND`, `AGENT_SPONSOR_INVALID`, `AGENT_MEMBER_SPONSOR_ONLY` | [Section 8](#8-agent-members-d90) | A failure | Per row |
| `PROJECT_MEMBER_NOT_PERSON` | [7.3](#73-projects-and-owners-852) | A failure | Agent members get projects in their own record |
| `PROJECT_SLUG_UNAVAILABLE` | [7.3](#73-projects-and-owners-852): taken, reserved or `all` | A failure | Choose another slug |
| `MEMBER_LAST_OWNER`, `MEMBER_NOT_FOUND`, `INVITATION_NOT_FOUND` | [7.1](#71-who-is-an-owner), [7.2](#72-member-commands), [5.3](#53-invitations-and-connected-agents) | A failure | Per row |
| `SESSION_NOT_FOUND` | `session-revoke` with an unknown handle | A failure | `session-list` |
| `SIGN_IN_METHOD_UNAVAILABLE` | A method not in `identity.methods` | A failure | The methods allowed |
| `PASSKEY_CANCELLED`, `PASSKEY_UNSUPPORTED`, `PASSKEY_NOT_FOUND`, `PASSKEY_LAST` | [5.2](#52-passkeys) | A failure; `CANCELLED` not retryable | Per row |
| `PERSONA_NOT_FOUND`, `PERSONA_LIMIT`, `PERSONA_INVALID` | [Section 6](#6-persona-d89) | A failure | Per row |
| `IDENTITY_PROVIDER_UNAVAILABLE` | The provider did not answer | A failure, retryable | Try again; the shell keeps working on what this browser holds |
| `IDENTITY_ORGANIZATION_UNKNOWN` | [2.3](#23-the-workspace-bound-to-an-organization) | Shown in main | Fix `[identity] organization` |
| `DEPLOYMENT_IDENTITY_INVALID`, `DEPLOYMENT_STDIO_TEAM` | [2.2](#22-the-deployment-file-version-3) | `deployment write` stops | The fix |
| `MANIFEST_ACCOUNT_LIMIT`, `MANIFEST_ACCOUNT_MOUNTED` | [5.5](#55-an-apps-account-section) | The package is refused | The fix |
| `PRINCIPAL_ISSUER_UNKNOWN` | [9.2](#92-the-hosted-principal-mapping) | 401 | Configure the issuer |
| afd-auth's `UNAUTHORIZED`, `TOKEN_EXPIRED` | Signed out or expired in `provider` mode | A failure, journaled | `auth-sign-in` |

## 16. Security

- **The CSP does not change.** The probe and the provider are `connect-src 'self'`; WebAuthn needs no CSP source; a remote avatar does not load (5.4).
- **The provider is same-origin, and the deployer's.** `identity.path` is under the deployment's own origin and base, so a cookie never crosses origins and no third-party cookie is involved. The provider's cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, as the existing Better Auth fixture verifies. Nothing in the shell reads them.
- **A revoked session** is refused by the provider at once (no cookie cache), and by the hosted server from phase 6. A browser tab of a revoked device keeps its local store until its next refresh, at most 60 seconds while visible, or at once on focus: **a browser kernel is local-first, and what this browser profile already holds is readable by whoever holds the profile**, as phase 2 already states for one person.
- **Shared browser profiles.** In `provider` mode, people sharing one profile share its IndexedDB and its history. Records are separated by `decideAccess` and [4.5](#45-a-persons-records-per-actor); history keeps the slugs of restricted projects a person visited (phase 2's note), and slugs come from names. On sign-out the shell replaces the current history entry with the workspace's root. The account section says "Use your own browser profile on a shared computer".
- **Tokens.** Never in the browser's journal, store, results or logs; audience-bound (M3.1); short-lived; refused in the query string (M2); never forwarded to a mounted instance or an app (principle 7, M4).
- **Owner and human commands** are the only ways to change who may do what, and no agent and no port reaches them ([3.4](#34-the-trust-table)).
- **`local` mode** is not authentication, and says so (2.1). A `provider` deployment refuses a `stdio` instance (2.2), since D56's trust in the host's user does not extend to a team.
- **Native apps** remain trusted code (D54): an app's `context.actor` is a contract for one, which could read the page's memory, and a boundary for a view.

## 17. Out of scope, and the seams reserved

| Out of scope | Where it lands | Seam left in phase 3 |
| --- | --- | --- |
| Agent members acting: delegation, guidance read, runs | Phase 5 (D40) | `AgentMemberV1.guidance`; `decideAccess`'s line 4; `options.agent` |
| Settings sections, autonomy, an app's account settings with schemas | Phase 4 | `ui.account`'s surface; persona's `emphasis.sections` |
| The hosted lane itself, its store, a second writer | Phase 6 | [10.2](#102-what-phase-6-must-deliver-first) |
| Revalidating a live collaboration session on a membership change | The collaboration service (D46) | `WorkspaceV2.memberEpoch`, `ProjectV1.memberEpoch` |
| Account deletion and data export | A follow-up, with retention | `account-get`; the actor on every record |
| Identity providers other than Better Auth (Convex stays an adapter, unused by Loam) | A follow-up | `identity.provider` is an enum of one |
| Several workspaces or organizations per deployment | Not planned (D32) | `organization` on the workspace |
| DPoP or certificate-bound tokens | When AFD's TypeScript layer adds them (Umbel's W5) | The verifier's options |

## 18. Exit criterion and tests

The phase exits when every test below passes on `main` in the job its row names, and STATUS.md records the runs, with "through a test-only auth host" beside E1, E3 and E5, and "through a test-only handler" beside E8, each named as what it does not prove. **Every exit test's title starts `P3-E<n>:` or `P3-H<n>:`.** "Units" is the `loam` job's unit step, "Chromium" its `test:browser` step, "AFD's identity path" its new step ([section 1](#1-units-and-repository-placement)), and "Hosted" the hosted lane's job that phase 6 adds.

| # | Criterion | Job | Test |
| --- | --- | --- | --- |
| P3-E1 | **A person signs in with a passkey**, through a test-only auth host | Chromium; Units | On a deployment with `methods = ["passkey", "password"]`, a seeded person signs in with a password, adds a passkey in the account section (virtual authenticator, user verification on), signs out, and signs in with "Sign in with a passkey" and again by autofill. The kernel's actor is the provider's user id, `auth-sign-in { method: 'passkey' }` is journaled with no credential, and a reload inside a restricted project they belong to restores it from the probe, with the same first frame. A cancelled ceremony shows its message and keeps focus. Units: the adapter's passkey method over the Mock; `SIGN_IN_METHOD_UNAVAILABLE` |
| P3-E2 | **Switching persona changes emphasis, never what the person may do** | Units; Chromium | Chromium: two personas; `persona-set` reorders hello and tasks in their band with the `emphasized` state, ranks their commands first in the palette, applies density, announces it, and moves no scope. Units: the sweep of [6.2](#62-what-a-persona-may-change) over every registered command, through a person and an agent, under each persona, identical but `persona` in the context; `AccessInputV2`'s keys; the scan; a persona read by another actor answers as missing |
| P3-E3 | **A revoked session signs out every tab**, through a test-only auth host | Chromium | Two tabs of one context and a second context (another device). From tab A's sessions tab: revoke the second context's session; its next provider request is refused at once, and on `visibilitychange` its page shows "Sign in" within 2 seconds with nothing of a restricted project in the deep DOM. Revoke `all`: tab B shows "Sign in" within 2 seconds, by `SessionSync`, and `session-settle` is in both tabs' journals |
| P3-E4 | **A session that ends with no command takes effect at once** (#854, #864) | Units; Chromium | A Mock session expired by a fake clock: `session-settle` runs without a call, journaled, the active restricted project left as `reason: 'actor'`, and the projects section's list loses the restricted name with no other read. A replay of that journal has zero differences |
| P3-E5 | **An agent member installed by an owner appears with its sponsor and cannot sign in**, through a test-only auth host | Chromium; Units | An owner adds one with another member as sponsor: pending, shown "Agent · Sponsored by Bea", then confirmed by Bea. The provider's user table holds no row for it (read from the host's database). A non-owner's `agent-member-add` is `OWNER_REQUIRED`; an agent's is `HUMAN_REQUIRED`. Units: an adapter reporting a user id `agt_…` is signed out with `AGENT_CANNOT_SIGN_IN`; `options.agent: 'agt_…'` is `AGENT_MEMBER_PATH_INVALID`; `decideAccess`'s line 4, every case, including the intersection with the person; the sponsor rules of 8.3, a removed sponsor suspending; `PROJECT_MEMBER_NOT_PERSON`; `member-list` counting no agent as a seat |
| P3-E6 | **Owners, and #852** | Units; Chromium | A non-owner's `project-create` with a listed slug, and `project-update { access }` of a listed project, are `OWNER_REQUIRED`; an owner's succeed. `workspace-app-set` by a non-owner is `OWNER_REQUIRED`. `PROJECT_SLUG_UNAVAILABLE` has the same bytes for a slug of a restricted project the caller may not enter, one they may, and a reserved one. [7.3](#73-projects-and-owners-852)'s other rows, `MEMBER_LAST_OWNER`, and the owner role read from the provider in Chromium |
| P3-E7 | **The workspace bound to an organization, and the ports** | Chromium; Units | A signed-in member of another organization sees "You are not a member of Acme" and their invitation, accepts it, and enters, with `session-settle` and `memberEpoch` raised. Units: line 0 for every command not exempt; every command of this phase through an app's port and a surface port is `CALL_NOT_GRANTED`, journaled; `call-scope.test.ts`'s table holds each |
| P3-E8 | **Identity over MCP, and the wrong audience refused**, through a test-only handler (#853) | Units: `kernel/src/mcp-identity.test.ts` | Step 0a's `createMcpHandler` with `mcpOptions()` and `createMcpAuth`, tokens from the test-only auth host's `oauthProvider`: no token, 401 with the challenge; a token for another audience, 401; right audience, the actor `client:<id>` on behalf of the person, who enters their restricted project while a non-member's token gets `PROJECT_NOT_FOUND` and a non-member of the organization `WORKSPACE_NOT_MEMBER`; a read-only token's mutation, 403; every human and owner command `COMMAND_NOT_FOUND`; `tools/list` equal across tokens; no journal entry or result holds a token or `credentials` |
| P3-E9 | **AFD's TypeScript layer conforms** | AFD's identity path | `packages/server`'s suite loads every case of `spec/authorization.json` 0a and 0c name, and one test per M3 rule; `packages/auth`'s suite covers the capabilities over the Mock and `BetterAuthAdapter` over a stubbed client |
| P3-E10 | **Budgets** | `loam` job's "Bundle budget" step; Chromium | Every row of [section 13](#13-budgets) under its ceiling. Chromium: an empty `local` shell requests exactly phase 2's first paint, and no `auth-`, `late-identity-` or `account-` chunk; a `provider` shell's first paint adds only `identity.ts`'s code and the probe's request |
| P3-E11 | **Accessibility and captures** | Chromium | Specimen captures and axe, as section 14, for the sign-in dialog, the account menu, each account tab, the members tab with an agent member, and the signed-out main; the keyboard path through sign-in, passkey add, revoke and persona switch |
| P3-E12 | **What exited stays exited** | Chromium; Units; Mounted | Phases 0's, 1's and 2's exit tests pass in `local` mode, amended only for what this specification changes, each listed in the step that makes it: the agent interface's actor (3.1); `PROJECT_SLUG_TAKEN`; `KERNEL_INTERFACE_VERSION`; `session-50` regenerated if `session-settle` enters it |
| P3-E13 | **Placement** | Units | `web/src`, `chrome/src` and `kernel/src` import nothing of `@lushly-dev/loam-identity`; no command's input schema holds a field named `token`, `password` (but `auth-sign-in`'s), `secret` or `cookie` |
| P3-E14 | **An app's account section** | Chromium; Units | Hello's `ui.account` tab renders at workspace level with a project active, its port refusing any other scope; manifest cases for each refusal |
| P3-E15 | **No secret in the journal or the store** | Chromium; Units | After E1's, E3's and E8's sessions, a scan of every journal entry, store row and `localStorage` value finds none of the seeded passwords, any cookie value, any token, any assertion's bytes, or an IP address |
| P3-E16 | **No job was skipped** | The exit step | `scripts/loam-exit-check.mjs --phase 3`, as phase 2's step 14 runs it, for the local part; again with the hosted job for the hosted part |
| P3-H1 | **The hosted server refuses a token for the wrong audience** | Hosted | On the development profile: a token Better Auth issued for another resource, 401 with the challenge naming the metadata; the right one, 200 |
| P3-H2 | **A person signs in with a passkey on the hosted lane** | Hosted | E1's passkey path against the profile's own Better Auth, over HTTPS, with no test-only host |
| P3-H3 | **A person's own agent acts for them, and no more** | Hosted | An MCP client registered by Client ID Metadata Document, authorized by the person, enters their restricted project; a revoked consent's refresh fails; an owner command is `COMMAND_NOT_FOUND` |

## 19. Implementation plan

Each step is one pull request, merged on green. It updates this status block and STATUS.md before it merges. **Steps 3 and 6 each get a review focused on the trust boundary they change**, as phase 2's surface port did.

| Step | Pull request | Contents | Checks |
| --- | --- | --- | --- |
| 0a | AFD: TypeScript MCP authorization, verification | [9.1](#91-afd-first-the-typescript-layer)'s first bullet; the test authorization server fixture; `spec/authorization.md`'s table; parity rows; a changeset | `pnpm check`, `pnpm verify`, `pnpm test:hosted:local` |
| 0b | AFD: afd-auth's passkey method and capabilities | [4.1](#41-the-adapter); `BetterAuthAdapter` and the Mock; the Better Auth fixture gains the organization and passkey plugins; README and the `afd-auth` skill; a changeset | `pnpm check`, `pnpm test:hosted:local` |
| 0c | AFD: TypeScript MCP authorization, scopes | [9.1](#91-afd-first-the-typescript-layer)'s second bullet | `pnpm check`, `pnpm verify` |
| 1 | Identity core | `loam-identity` with `createLoamAuthOptions` and `startTestAuthHost`; deployment and projection version 3; `IdentityV1`; `decideAccess` version 2, `MembershipV1`, `isOwner`, line 0; the auth gate's lists; the agent interface's actor; `personalRecordId`; the tables; kernel interface version 3; the domains; `call-scope.test.ts`; the architecture's amendments; E12's amendments, E13, E7's units, E5's and E6's units so far | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 2 | `session-settle` | [4.4](#44-hearing-the-adapter-d88); E4. Closes #854 and #864 | `pnpm check`, `loam.yml` |
| 3 | Sign-in, the probe and sessions | [4.2](#42-first-paint-the-probe), [4.3](#43-revocation-and-every-tab), [4.6](#46-session-and-sign-in-commands), [5.2](#52-passkeys); `identity.ts`, the `auth` chunk, `loam-sign-in-dialog`, the signed-out main, the account menu without personas; the harness's `authHost` and virtual authenticator; `late-identity` begun; E1, E3, E10 so far, E11 and E15 so far. **Trust review: the auth gate, the probe and revocation** | `pnpm check`, `pnpm verify`, `loam.yml`, `budget` |
| 4 | The account section, members and owners | [5.1](#51-what-it-is), [5.3](#53-invitations-and-connected-agents), [5.4](#54-profile), [section 7](#7-memberships-and-owners-d87); the `account` chunk; E6, E7; closes #852 | `pnpm check`, `loam.yml`, `budget` |
| 5 | Persona | [Section 6](#6-persona-d89); the context field; emphasis in the rail and palette; E2 | `pnpm check`, `loam.yml`, `budget`, `lint:tokens` |
| 6 | Agent members | [Section 8](#8-agent-members-d90); E5. **Trust review: `decideAccess`'s line 4 and the sponsor rules** | `pnpm check`, `loam.yml`, `budget` |
| 7 | Identity over MCP | [Section 9](#9-over-mcp-and-the-hosted-token-layer-d91): `createMcpAuth`, `principalOf`, the scopes, the human and owner commands left out of `mcpOptions`, the provider's `oauthProvider` in `createLoamAuthOptions`, connected agents; E8. Closes #853 | `pnpm check`, `pnpm verify`, `loam.yml` |
| 8 | An app's account section | [5.5](#55-an-apps-account-section); hello's section; `apps`' row amended first; E14 | `pnpm check`, `loam.yml`, `budget` |
| 9 | Local exit | `scripts/loam-exit-check.mjs --phase 3` with `loam-exit-check.p3.minimums.json` and the new step's name; every `P3-E` row; run `loam.yml` and `ci.yml` by `workflow_dispatch` on `main`; STATUS.md records "local criterion met" with the output | The check exits 0 |
| 10 | Hosted criterion and exit | **Waits for phase 6's development profile** ([10.2](#102-what-phase-6-must-deliver-first)). P3-H1 to P3-H3 in the hosted job; the exit check gains the hosted job; STATUS.md records the exit; follow-ups filed | The check exits 0 for both parts |

Order: 0a, 0b and 0c may run in parallel, first (D15). Step 1 needs 0b. Step 2 needs 1. Step 3 needs 0b and 2. Steps 4, 5 and 6 need 3, and may run in parallel, 6 after 4 for the members tab. Step 7 needs 0a, 0c and 4. Step 8 needs 4. Step 9 is after 1 to 8. Step 10 after 9 and phase 6's profile. **An exit test named in several steps closes in the last**, each earlier step adding its clauses under the same title.

**Host capacity.** Steps 3 on run Chromium with a Better Auth child process per file; on a shared machine, one Vitest worker, and the auth host's SQLite in the test's temporary directory.

## Questions for the owner

Each is a change to who may do what, or a reading of an owner decision. Everything else here is settled. The specification is written to each recommendation, and says where an answer would change it.

### Q1. Who counts as an owner?

Owners install agent members, decide which apps the workspace runs, invite and remove people, and control the projects a team instance serves. The organization in the identity provider has three roles: owner, admin and member.

- **Owner and admin both count (recommended).** Admins can already invite and remove people in the provider itself, so if they weren't owners in Loam, they could do through the provider what Loam refused them. The tradeoff: more people can install agents and change the workspace's apps.
- **Only the provider's owner counts.** Fewer people hold that power. Admins would still manage membership at the provider, but couldn't install agents or change apps in Loam.

### Q2. Who may change who is in a project?

Today, anyone who can enter a project may restrict it or change its member list. For projects a team instance serves, an owner-only rule is already decided (#852). For other projects:

- **Owners and the person who created the project (recommended).** The creator can still run their own project. Another member can't lock everyone else out of a shared project by restricting it. Anyone may remove themselves.
- **Anyone in the project, as today.** This is the most self-service option. The tradeoff: one member can restrict a shared project and shut out the rest until an owner fixes it.
- **Owners only.** This is the strictest option. Every change to a project's members waits for an owner.

### Q3. A person's own agent over MCP

Can a person connect their own agent, such as a desktop assistant, to the hosted shell so it acts for them?

- **Yes, after the person approves it at sign-in (recommended).** It can do what that person can and no more. It can't do owner actions or change anyone's access, sign-in or sessions. The person sees it in their account and can disconnect it. The tradeoff: an agent can act without an owner's say, but only within one person's own access, and every action names both the agent and the person.
- **No, only agent members an owner installed.** Owners stay in control of every agent. The tradeoff: connecting a personal assistant needs an owner, and the agent counts as a workspace agent member, not as the person's.

### Q4. Naming a sponsor

When an owner installs an agent member and names someone else as its accountable sponsor:

- **The sponsor must confirm first (recommended).** The agent can do nothing until then. Nobody becomes accountable for an agent without agreeing to it. If the owner names themselves, no confirmation is needed.
- **The owner's word is enough.** Setup is faster. The tradeoff: a person can be made accountable for an agent they never agreed to.

### Q5. Ways to sign in

Passkeys are the main way in. What else may a team workspace allow?

- **Passkeys, plus the company's single sign-on if the deployer sets one up; no passwords by default (recommended).** A person who loses every passkey recovers through single sign-on, or by an owner inviting them again. The deployer can still turn passwords on.
- **Passkeys and passwords by default.** Recovery is easier without single sign-on. The tradeoff: passwords are what attackers steal and phish.
- **Passkeys only.** This is the strongest option. The tradeoff: a person with no working passkey can't get back in until an owner re-invites them.

## Amendments to the architecture and the decision log

Proposed; applied when the coordinator approves this specification, in step 1:

- **Architecture section 5, Identity:** the actor on each path (3.1); `decideAccess`'s workspace and agent lines (3.3); owner and human commands (3.4); the hosted principal (9.2).
- **Architecture section 5, shell commands:** the commands of sections 4 to 8 replace the list's `account-get; persona-list, persona-set; session-list, session-revoke; agent-member-add, agent-member-list, agent-member-remove`, and `member` joins the domains.
- **Architecture section 9:** phase 3's row gains "local criterion through a test-only auth host and handler; hosted criterion on phase 6's development profile (D84)".
- **Architecture glossary:** "Owner (workspace)", "Identity mode", "Session probe".
- **Decision log:** D84 to D95, below, "proposed, pending review". D11, D40, D55 and D73 gain notes pointing to them. What D54 to D58 decided is not altered.

| ID | Decision |
| --- | --- |
| D84 | Phase 3's exit has a local part, through a test-only auth host and handler, and a hosted part on phase 6's development profile; the phase exits when both pass |
| D85 | A deployment's identity is `local` or `provider`, in deployment and projection version 3; `provider` is Better Auth on the same origin, bound to one organization |
| D86 | `decideAccess` version 2: the person the call is for, workspace membership, the project, and an agent member's own record, intersected; neither persona nor the active scope is an input |
| D87 | Owner commands and human commands, decided after line 0, and never served over MCP; the owner is by provider role (pending Q1); #852's rule; `PROJECT_SLUG_UNAVAILABLE` |
| D88 | The kernel hears the adapter, and a change of actor is the journaled internal `session-settle` |
| D89 | Persona is a record per person with presentation, defaults and emphasis that orders and marks but never hides; `dev.loam/persona`, never an input to a decision |
| D90 | An agent member is a Loam record with no provider account, a sponsor who may enter its projects (and confirms, pending Q4), suspended when the sponsor leaves |
| D91 | Over MCP, a token's client acts for its subject (pending Q3), with `loam:read` and `loam:write`; Better Auth issues audience-bound JWTs for the hosted server's one resource |
| D92 | First paint gets only the session probe; Better Auth's client, the account UI and the identity commands are lazy |
| D93 | afd-auth gains a passkey sign-in method and optional session, passkey and organization capabilities, with the Mock (AFD first) |
| D94 | In `provider` mode, a person's working view-state records are per actor |
| D95 | A `provider` deployment refuses a `stdio` mounted instance |

## Follow-ups

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-09 | Phase 3 specification | Account deletion and data export, with a retention rule for the journal and records that carry the actor | Open |
| 2026-11-09 | Phase 3 specification | Whether delegated work in a project the sponsor lost (`SPONSOR_PROJECT_LOST`) is refused, decided with phase 5's delegation | Open, for phase 5 |
| 2026-11-09 | Phase 3 specification | A browser tab of a revoked device keeps its local store readable until its next refresh; revisit when the collaboration service's sync gives the browser a server to ask on each read | Open, for the collaboration service |
| 2026-11-09 | Phase 3 specification | Remote avatars: a CSP source or a proxied image for `account-update`'s `image` | Open |
| 2026-11-09 | Phase 3 specification | DPoP or certificate-bound tokens in AFD's TypeScript layer, when Umbel's W5 settles | Open |
