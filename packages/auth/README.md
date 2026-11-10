# @lushly-dev/afd-auth

Provider-agnostic authentication adapters for AFD applications. The main
entrypoint exposes the `AuthAdapter` contract, structured auth errors, the auth
middleware, multi-tab session synchronization, and the Mock and Better Auth
adapters.

Auth command definitions are available from the optional commands subpath:

```ts
import { createAuthCommands } from '@lushly-dev/afd-auth/commands';

const authCommands = createAuthCommands(adapter, { signInTimeoutMs: 10_000 });
```

They are defined on Zod Mini, with their JSON Schemas written out, so a browser host bundles neither
classic Zod nor `toJSONSchema` for them. A host that loads code in stages can take
`createAuthSessionGetCommand(adapter)` and `createAuthMutationCommands(adapter, options)`, the two
parts `createAuthCommands` returns together, from the same subpath.

React hooks are available from the optional `@lushly-dev/afd-auth/react`
subpath:

```ts
import { createAuthHooks, useConvexAuthAdapter } from '@lushly-dev/afd-auth/react';

const { useSession, useUser } = createAuthHooks(adapter);
```

The root import stays usable for server and non-React consumers without
installing React, `@lushly-dev/afd-server`, or `zod`. Import
`useConvexAuthAdapter` from `/react` and `createAuthCommands` from `/commands`
when those integrations are needed.

## Middleware

```ts
import { createAuthMiddleware } from '@lushly-dev/afd-auth';

const middleware = createAuthMiddleware(adapter, { exclude: ['public-cmd'] });
```

| Adapter state | Result |
| --- | --- |
| `unauthenticated` | `UNAUTHORIZED`, not retryable |
| `loading` | `UNAUTHORIZED`, retryable |
| `authenticated`, `session.expiresAt` at or before now (or not a valid date) | `TOKEN_EXPIRED`, retryable |
| `authenticated` | sets `context.auth`, fills `context.actor` from the session user and runs the command |
| any state, with `credentials` afd-server verified (below) | deletes `context.auth`, keeps `context.actor` and runs the command, without reading the session |

- The built-in commands `auth-sign-in`, `auth-sign-out` and `auth-session-get`
  (`AUTH_COMMAND_NAMES`) always run, so a signed-out caller can sign in.
  `exclude` adds more commands.
- The middleware sets or deletes `context.auth` on every call, excluded
  commands included. A handler never sees a `context.auth` that the caller
  supplied.
- With a verified session, a `human` (or missing) `context.actor` becomes
  `{ kind: 'human', id: user.id, label: user.name }`. An `agent`, `service` or
  `script` actor keeps its identity and gets `onBehalfOf: user.id`, replacing any
  `onBehalfOf` the caller set.
- Importing the package types `context.auth` as
  `AuthenticatedSessionState | undefined` through a `CommandContext` module
  augmentation.
- `Session.expiresAt` is optional. A session without it (Convex) is never
  rejected as expired; the provider manages the token lifetime.

### Calls authorized by a token

On an MCP server that verifies tokens, a call's caller is the token, not the
session the adapter holds. Tell the middleware which calls those are:

```ts
import { createAuthMiddleware } from '@lushly-dev/afd-auth';
import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';

const middleware = createAuthMiddleware(adapter, { isVerifiedCredentials });
```

- A host that serves MCP with token authorization through this middleware
  must pass it. Without it, a token's call is gated on the adapter's session
  and its actor is stamped with the session user, as for any other call.
- afd-server marks the `credentials` object it sets after verifying a token
  with a private brand; `isVerifiedCredentials` recognises only that object.
  `credentials` a caller puts on the context itself (on a direct registry, say),
  a copy of branded ones, and those a host's `createContext` sets are not
  recognised and get the session treatment above.
- `@lushly-dev/afd-server/credentials` loads nothing else of the server, so
  the import costs a browser bundle a few hundred bytes. The root import of
  this package still needs no `@lushly-dev/afd-server`.

## Sign-in results

`SignInOptions` is `{ method: 'credentials', email, password? }`,
`{ method: 'oauth', provider, scopes?, redirectTo? }` or
`{ method: 'passkey', autoFill? }` (`autoFill` offers passkeys in the browser's
autofill). An adapter without passkeys throws `PASSKEY_UNSUPPORTED`; a dismissed
or timed-out ceremony is `PASSKEY_CANCELLED`. Neither is retryable: only the
person can try again.

`AuthAdapter.signIn()` may resolve with a `SignInOutcome`:
`{ kind: 'signed-in' }`, `{ kind: 'redirect', url? }` (OAuth continues at the
provider) or `{ kind: 'pending' }` (another step, such as email verification).
Resolving with nothing is still allowed and counts as `signed-in`.

`auth-sign-in` uses it to report what happened:

- `redirect` / `pending`: returns the current (not yet signed-in) state with
  "Not signed in yet" reasoning and a `SIGN_IN_REDIRECT` or `SIGN_IN_PENDING`
  warning. The redirect URL is in the warning's `details.url`.
- otherwise: waits for the next non-loading `onAuthStateChange`, up to
  `signInTimeoutMs` (default 10 s), and returns the new session. If the wait
  runs out it returns the current state with a `SIGN_IN_PENDING` warning; if
  the adapter settles on no session it fails with `PROVIDER_ERROR`.

## Capabilities

An adapter may also offer these, each optional on `AuthAdapter`:

| Member | What it does |
| --- | --- |
| `refresh()` | Reads the session from the provider now; resolves once `getSession()` holds the answer |
| `sessions` | `listSessions()` and `revokeSession(handle \| 'others' \| 'all')` for the signed-in person |
| `passkeys` | `listPasskeys()`, `addPasskey({ name? })`, `renamePasskey(id, name)`, `removePasskey(id)` |
| `organization` | `membership(orgId)` (the role, or `null`), `listMembers`, `invite`, `listInvitations`, `cancelInvitation`, `removeMember`, `setRole`, `leave`, and for the invitee `listOwnInvitations`, `acceptInvitation`, `rejectInvitation` |

- A `SessionRow` is `{ handle, current, createdAt, updatedAt, expiresAt?, device? }`.
  The handle is the first 16 hex characters of SHA-256 over the session's
  token; the token stays in the adapter's memory. `device` is a label read from
  the user agent, such as `Chrome on macOS`. No IP address leaves the adapter.
- A `PasskeyRow` is `{ id, name?, createdAt, deviceType?, backedUp? }`, with no
  key material.
- Every `organization` call names the organization by id. An empty id is a
  `TypeError`, so no call can fall back to the provider's active organization.

## Adapters

All adapters accept `onListenerError`. Each `onAuthStateChange` subscriber
runs in its own `try/catch`: one that throws does not stop the others from
seeing the change, and does not make `signIn()`/`signOut()` reject. The error
goes to `onListenerError`, or is rethrown in a microtask when none is set.

### Convex

```ts
const adapter = useConvexAuthAdapter({
  useAuthActions,
  useConvexAuth,
  meQuery: () => useQuery(api.users.me),
  passwordProviderId: 'password', // default: the stock Password() provider
});
```

- Credentials sign-in calls `signIn(passwordProviderId, { email, password, flow: 'signIn' })`.
  A missing password is rejected with `INVALID_CREDENTIALS`.
- OAuth sign-in forwards `redirectTo`. `scopes` are rejected with
  `PROVIDER_ERROR`: Convex configures scopes on the provider in
  `convex/auth.ts`.
- Errors use the same codes as Better Auth: `InvalidAccountId`,
  `InvalidSecret` and `Invalid credentials` become `INVALID_CREDENTIALS`, fetch
  failures `NETWORK_ERROR`, everything else `PROVIDER_ERROR`. Production
  Convex deployments hide server error text unless it is thrown as a
  `ConvexError`, so there bad credentials surface as `PROVIDER_ERROR`.
- The state is `loading` while `meQuery` returns `undefined`, and
  `unauthenticated` when it returns `null`.
- The session has no `expiresAt`, because Convex refreshes its token
  internally.
- The hook returns the same adapter object on every render.

### Better Auth

```ts
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { organizationClient } from 'better-auth/client/plugins';

const client = createAuthClient({ plugins: [organizationClient(), passkeyClient()] });
const adapter = new BetterAuthAdapter({ client, initial }); // initial: optional
```

- Tested on Better Auth 1.7.18 with `@better-auth/passkey` 1.7.18, both pinned
  exactly in this package's development dependencies.
- `BetterAuthAdapter` forwards OAuth `scopes` and `redirectTo` (as
  `callbackURL`) to `signIn.social`, and reports its redirect URL as a
  `redirect` outcome.
- `initial` is the state to report until the client's session store first
  answers, such as a session the page read from its server. `refresh()` calls
  the store's `refetch`.
- It has all three capabilities. `passkeys` and passkey sign-in need
  `passkeyClient()` and the server's `passkey()` plugin, `organization` needs
  `organizationClient()` and `organization()`; without them the provider
  answers `PROVIDER_ERROR`. `sessions` uses Better Auth's own routes, and
  `/list-sessions` needs a fresh session.
- Passkey calls check for WebAuthn first (`PASSKEY_UNSUPPORTED`).
- Better Auth lists and accepts invitations only for a verified email.

### Mock

`MockAuthAdapter` is for tests. It takes `{ delay?, clock?, roles? }` and has
all three capabilities in memory:

- `clock` (afd-core's `Clock`) times everything it records. A session expires
  one hour after sign-in on it, and `refresh()` signs out a session past its
  `expiresAt`.
- `roles` is `{ [organizationId]: { [userId]: role } }`. Owners and admins
  manage members and invitations; the last owner can neither leave nor be
  demoted.
- A passkey sign-in signs in the holder of the passkey added last.
  `_setPasskeyCeremony('cancel' | 'unsupported' | 'complete')` sets how later
  ceremonies end.

## Session sync

`SessionSync` exchanges typed `SessionSyncMessage` values: `signed-in`,
`signed-out`, `session-refreshed`, `profile-updated` (both with an optional
`userId`) and `visibility-refresh`. Received payloads are validated and reduced
to those fields; `notifySessionChanged()` throws a `TypeError` for an invalid
message.

Received messages are debounced per type by `debounceMs`. `signed-out` is
delivered at once and cancels older messages still waiting, so it is never
coalesced away.

`SessionSync.acquireRefreshLock()` and `releaseRefreshLock()` provide a
synchronous best-effort fallback for coordinating refreshes between tabs. The
fallback records an instance owner and only that owner can release its current
lock. `acquireRefreshLockAsync()` waits `lockCheckDelayMs` after writing the
lock and reads it back before claiming it, which catches most write races. A
lock timestamp more than one second in the future counts as stale.
`localStorage` does not provide compare-and-swap, so acquisition remains
non-atomic under a simultaneous cross-tab race; applications that require
stronger serialization should use a provider-level refresh mechanism.

## Integration evidence

`pnpm -F @lushly-dev/afd-auth exec vitest run src/adapters/better-auth.integration.test.ts`
starts the installed Better Auth provider on an ephemeral loopback port with its memory
adapter. The actual vanilla client and `BetterAuthAdapter` exercise registration,
cookie issuance, credential rejection, sign-in, session expiry mapping, independent
session read-back, sign-out and revocation of the old cookie. A small Node cookie jar
forwards real `Set-Cookie` values; it does not implement browser cookie policy.
The test disposes subscriptions, closes sockets and discards all synthetic data.
Both the real vanilla store and the legacy function accessor are supported.

The separate browser suite installs only development tooling and runs without
provider credentials:

```sh
pnpm -F @lushly-dev/afd-auth exec playwright install chromium
pnpm -F @lushly-dev/afd-auth test:browser
```

`browser/lifecycle.test.ts` starts the actual Better Auth memory provider and
bundles a small application using `BetterAuthAdapter`, `createAuthHooks` and
`SessionSync`. Chromium uses its own cookie jar and two real tabs in one fresh
context. The application explicitly broadcasts auth changes and refetches provider
state on received AFD messages. The suite checks:

- Registration, invalid credentials, sign-in, React session/user rendering and
  restoration after reload; a separate browser context stays signed out.
- Actual HttpOnly cookie protection from `document.cookie`, SameSite=Lax and path
  attributes, cookie removal on sign-out and expiry, and independent replay of
  revoked or expired synthetic cookies against the provider.
- Cross-tab sign-in, sign-out and session renewal with BroadcastChannel, then with
  BroadcastChannel unavailable to exercise real localStorage `storage` events.
- Refresh-lock ownership across tabs: a non-owner cannot acquire or release an
  existing lock, and the next owner can acquire after release.
- Real wall-clock provider session renewal and expiry. The expiry case first
  observes Chromium remove the cookie while asserting that no provider request
  occurs, then refetches and verifies the signed-out hooks and expired-cookie
  rejection. It uses no fake timers, injected sessions, cookie shim or mocked
  provider endpoints.

Each run uses ephemeral loopback ports and synthetic accounts. Teardown closes
browser contexts, provider connections and servers and clears provider memory,
including after failed assertions. Session cookies and tokens are never written to
an evidence file. Startup, test and CI deadlines bound the run. The path-filtered
`Auth browser integration` workflow runs the same suite on Node 26 with a pinned
Playwright version and its matching Chromium. It is separate from `pnpm check`,
so the TypeScript gate does not require a downloaded browser binary.

This is local Chromium/provider evidence using HTTP with `Secure=false`. It does
not establish HTTPS Secure-cookie or cross-site SameSite enforcement, OAuth
callbacks, refresh of upstream OAuth tokens, simultaneous refresh-lock atomicity,
other browsers or Convex deployment behavior. Those deployment-specific checks
remain tracked in [#362](https://github.com/lushly-dev/afd/issues/362).

The additional [Better Auth HTTPS/OAuth fixture](hosted/better-auth/README.md)
uses a local test OAuth provider and SQLite-backed Better Auth. It exercises the
callback, Secure cookies and restart persistence without a hosted account. The
[Convex fixture](hosted/convex/README.md) bundles actual React/provider SDKs and
deployable backend functions; its local checks do not execute a Convex deployment.

After installing Chromium, run `pnpm test:hosted:local` from the repository root
on Node 24 or newer (`.nvmrc` pins 26). It also runs the durable REST/view-state lifecycle. Separate opt-in
commands `test:hosted:better-auth` and `test:hosted:convex` require the fixture's
explicit disposable-service configuration and fail preflight when it is missing.
See the [hosted verification handoff](../../docs/operations/hosted-verification.md)
for local evidence, provisioning order, receipt requirements and cleanup. External
OAuth grants, deployment restart and actual Convex authentication remain pending
under #362; a local fixture pass does not close them.
