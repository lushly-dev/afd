# Better Auth H1 harness (#362)

This opt-in harness runs actual Better Auth server/client code, the AFD
`BetterAuthAdapter`, React hooks and explicit `SessionSync` refetch wiring. It is
outside default tests and published package files. Node **24+**, OpenSSL and
Playwright Chromium are required for local mode. Normal package/runtime behavior
and default tests remain on their existing Node support range.

From `packages/auth` with Node 24 selected:

```sh
pnpm exec playwright install chromium
node hosted/better-auth/run.mjs --local
node --test hosted/better-auth/contract.test.mjs
pnpm exec tsc -p hosted/better-auth/tsconfig.json
```

Local mode generates a one-day self-signed HTTPS certificate in private OS
scratch storage, starts a separate Better Auth process backed by a SQLite file,
and runs real Chromium against it. Only local mode accepts that generated
certificate. A separate **test-only OAuth authorization-code provider** validates
the registered callback, client authentication, one-use codes and S256 PKCE; it
serves a synthetic user and explicit allow/deny consent buttons. Better Auth
session/auth endpoints and state are never mocked. This provider uses loopback
HTTP; it is not a hosted identity provider or an OIDC certification test.

The local assertions cover fresh signed-out hooks, adapter redirect before
callback authentication, observed callback requests, denial then recovery,
independent provider read-back, two tabs, isolated context, reload, actual
Secure/HttpOnly/SameSite=Lax/root cookies, a **new server process** retaining the
same SQLite file/secret and exact session/user, real session renewal, sign-out
synchronization, independent revoked-cookie rejection, and idle cookie/session
expiry with independent replay rejection. Synthetic cookies remain in process
memory. Database, WAL files, generated private key/certificate, test OAuth state,
server processes, browser profiles and generated bundles are removed on success
and failure. Contract tests include an intentionally short deadline while the
real provider/browser run is underway and verify scratch cleanup after failure. SIGINT/SIGTERM also abort pending work and unwind cleanup; a real SIGTERM subprocess regression verifies this path. SIGKILL cannot execute cleanup.

These fixtures execute the reviewed workspace source commit. Receipt package
versions describe manifests; they do not establish installation from npm.
Published SDK delivery needs a separate packed/downloaded fresh consumer.

## External deployment and runner

No service, OAuth client, account, grant or paid resource is provisioned by this
code. Choose a dedicated disposable application/store and synthetic provider
identity. The fixture supports **same-origin HTTPS**, backed by a persistent
SQLite volume, and one external OIDC provider through Better Auth's supported
`genericOAuth` plugin with discovery/JWKS ID-token verification required. This
bounded topology intentionally excludes split-origin/CORS/third-party-cookie
claims. Never point it at a shared or production auth database.

Both `serve.mjs` and `run.mjs --hosted` require:

| Variable | Contract |
| --- | --- |
| `AFD_BA_DISPOSABLE` | Exactly `1`, acknowledging a dedicated disposable deployment |
| `AFD_BA_APP_URL` | HTTPS fixture origin, root path; no credentials/query/fragment |
| `AFD_BA_PROVIDER_ID` | Lowercase kebab identifier configured by the fixture |
| `AFD_BA_CALLBACK_URL` | Registered exact Better Auth `/api/auth/callback/<provider-id>` URL |
| `AFD_BA_RETURN_URL` | HTTPS application root destination; distinct from provider callback |
| `AFD_BA_EXPECTED_EMAIL` | Synthetic provider identity expected after callback |
| `AFD_BA_REVISION` | Deployed source commit, 7–64 hex characters; compared with fixture read-back |
| `AFD_BA_CONTROL_KEY` | Random secret, at least 32 characters, for exact synthetic-user cleanup |
| `AFD_BA_RESTART_COMMAND` | JSON argv array invoking deployment-specific restart, without a shell |
| `AFD_BA_DEADLINE_MS` | Optional browser-run deadline, 10000–900000; default 180000 |

The fixture additionally requires deployment-side secrets/configuration:

| Variable | Contract |
| --- | --- |
| `AFD_BA_DATABASE_PATH` | SQLite file on persistent dedicated volume, preserved during restart |
| `AFD_BA_SECRET` | Stable random Better Auth secret, at least 32 characters |
| `AFD_BA_CLIENT_ID`, `AFD_BA_CLIENT_SECRET` | Dedicated OIDC client configuration |
| `AFD_BA_DISCOVERY_URL` | HTTPS OIDC discovery URL; issuer/JWKS required by Better Auth |
| `AFD_BA_ISSUER` | Exact expected HTTPS issuer from the dedicated provider registration |
| `AFD_BA_PORT` | Optional local ingress port; default 3000 |

Store secrets in local/deployment secret stores. Do not paste them into issues,
receipts, shell transcripts or chat. Register the callback on the dedicated
provider client. The runner also checks `redirect_uri` from the **actual Better
Auth authorization response** against that exact registered callback. The final
application return URL is supplied through AFD `redirectTo`.

Run the fixture from the auth package directory behind a TLS ingress that proxies
to `127.0.0.1:AFD_BA_PORT` on the same host. Forward `/`, `/fixture.js`,
`/api/auth/*` and `/harness/*` unchanged, including cookies and request bodies.
Do not cache auth or harness routes. The fixture sets Secure cookies even when
its private ingress socket is HTTP. The auth database is migrated using installed
Better Auth migration APIs at startup. The session lifetime is 45 seconds with a
5-second update age. Configure the restart command to **finish only after a real
application process restart has completed**, preserving the volume and secret.
The runner requires a different server instance ID and independently verifies
that the pre-restart session and user still exist; a newly signed-in session
cannot satisfy it.

```sh
# Supply the documented environment through your secret/configuration store.
node hosted/better-auth/serve.mjs
# From another terminal/session, with matching public contract + control key:
node hosted/better-auth/run.mjs --hosted
```

The hosted runner opens headed Chromium and prints bounded operator instructions:
first deny/cancel provider consent, then complete a successful synthetic sign-in,
and later sign in once more after revocation for the expiry test. It does not
assume provider login selectors, capture network traces, or save screenshots.
TLS verification stays enabled for hosted mode. The browser deadline includes
operator interaction; increase it within the documented bound if necessary.
Missing configuration is an explicit nonzero preflight failure, never a skipped
provider pass. Startup, navigation/API calls, restart and tests have deadlines. The isolated server process installs a real-fetch network policy before provider initialization: every external server-side request requires HTTPS without URL credentials, redirects are rejected, and each discovery response is checked for the exact configured issuer and HTTPS authorization/token/userinfo/JWKS endpoints. It delegates to native network fetch and does not fabricate provider responses. Only the explicit local test-provider origin permits loopback HTTP.

`node hosted/better-auth/build.mjs OUTPUT_DIRECTORY` also builds `server.mjs` and
`fixture.js`. Generated server bundles retain external package imports and must
run with the auth package's installed dependencies available. `serve.mjs` builds
into its ignored dependency cache and supplies the private internal config to a
child process; do not invoke `server.mjs` with copied secret JSON in transcripts.

## Receipts and cleanup

The runner prints a JSON allowlist: source revision, local/runtime/client/server
versions, browser version, origin, explicit provider kind, named assertion
results and remaining `not-run` checks, failure phase and cleanup status. It
omits synthetic identity values, session/user IDs, OAuth codes/state, cookie
values, passwords, secret keys, raw errors and raw network logs.

`cleanup` describes authenticated deletion and read-back for the configured
synthetic Better Auth user and its session/account rows, plus closing the runner.
Local `resourceCleanup=passed` includes the entire disposable SQLite volume,
test OAuth provider and certificate cleanup. External `resourceCleanup=not-run`
is deliberate: provider grants/accounts/client registrations and deployment/
volume disposal require the deployment operator. A successful hosted application
run reports **`result=partial`**, exits zero for completed executable assertions,
and does not close H1/#362. A failed assertion or application cleanup exits
nonzero. Preserve and review the receipt, then revoke only the dedicated test
grants, remove any dedicated provider account/client created for the test,
remove the deployment and volume, and record their independent cleanup receipts
before claiming H1 complete. In-flight OAuth verification records in the external
dedicated store are removed when that test volume is disposed.

Local evidence cannot establish real hosted OIDC/provider compatibility,
production TLS trust, arbitrary cross-site cookie policy, upstream OAuth token
rotation, simultaneous refresh-lock atomicity, other browser engines or Convex
Auth. These remain separate evidence requirements.
