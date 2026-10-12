# Provider and durable persistence verification

Tracks [#362](https://github.com/lushly-dev/afd/issues/362). These fixtures prepare
the application contracts before any hosted resources are provisioned. They are
development infrastructure, excluded from published package payloads.

## Credential-free local gate

Use Node 24 (the SQLite fixtures use `node:sqlite`), the repository's pinned pnpm,
OpenSSL and Playwright's matching Chromium:

```sh
pnpm install --frozen-lockfile
pnpm -F @lushly-dev/afd-auth exec playwright install chromium
pnpm test:hosted:local
```

The command builds the workspace, checks runner contracts, exercises the real
Better Auth HTTPS/OAuth fixture, compiles/bundles the real Convex SDK fixture,
and runs the SQLite REST/view-state restart lifecycle. The separate
`hosted-fixtures.yml` workflow runs it without external credentials. `pnpm check`
remains the TypeScript quality gate and does not download a browser.

| Fixture | Local evidence | Still requires hosted execution |
|---|---|---|
| [Better Auth](../../packages/auth/hosted/better-auth/README.md) | Actual provider, local test OAuth callback, browser cookies and persistent-provider lifecycle | Deployment HTTPS/callback configuration, selected external identity provider, infrastructure restart and external grant/account cleanup |
| [Convex](../../packages/auth/hosted/convex/README.md) | Installed SDK frontend/backend type checks, browser bundle and runner contract checks | Real deployed functions, authentication hooks/query behavior, credentials/OAuth, continuity and protected-read isolation |
| [Durable REST](../../packages/local-db/hosted/README.md) | Actual HttpAdapter and ViewStateRegistry over SQLite, separate write/read processes and application restart | Hosted routes/storage/authentication, deployment restart and unavailable/recovery receipts |

A local test OAuth provider proves the callback integration, not a selected
identity provider's hosted configuration. A successful Convex build proves SDK
compatibility at compile time, not deployed authentication behavior.

## Provisioning handoff

Start with the smallest disposable topology: an HTTPS test application and durable
store for Better Auth and REST, a dedicated OAuth test client, and one Convex
development deployment. The fixture READMEs define the actual environment
variables, deployable files and opt-in commands. Do not provision from a database
URL alone: the REST contract needs application routes, and Convex needs deployed
auth functions, current-user query and provider configuration.

Choose synthetic principals and a unique run marker. Keep passwords, provider
secrets and bearer tokens in local/provider secret stores. Callback URLs registered
with the provider and application return URLs supplied as `redirectTo` have
different roles. Hosted TLS verification stays enabled.

Run preflight before contacting a service. Explicit hosted execution with missing
configuration fails; it does not become a passing skipped test. Follow each
fixture's phases and record a deployment revision. For persistence, write in one
process, restart the application retaining the same store, read in a new process,
then perform exact-ID cleanup. A restart acknowledgement is a reference to external
restart evidence, not independent proof that a restart happened.

## Evidence and closure

Retain the candidate/source revision, runtime and provider versions, nonsecret
deployment/store identifiers, each assertion's result, independent read-backs and
cleanup result. Exclude cookie/token/password values, OAuth codes, raw response
bodies and network traces. Inspect the runner's partial/not-run results; do not
turn a phase pass into a complete H1/H2/H3 pass.

Delete only this run's records, synthetic accounts/sessions and dedicated OAuth
grants. Verify cleanup before removing disposable services. Local cleanup cannot
prove external grant or deployment cleanup. Keep #362 open until the hosted
assertions and cleanup receipts are reviewed.

These checks do not establish upstream OAuth token rotation, immediate rejection
of every previously issued Convex JWT, all browser engines, arbitrary third-party
cookie topologies, simultaneous localStorage locking, offline writes, conflict
resolution or exactly-once delivery. No new public AuthAdapter or DataAdapter
guarantee is introduced.
