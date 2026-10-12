# Convex hosted authentication fixture

This opt-in fixture validates `useConvexAuthAdapter` against a disposable, real Convex Auth
deployment and Chromium. It is not part of the credential-free default suite, and a local bundle
or typecheck is not hosted-provider evidence.

## Local checks

From `packages/auth`, run:

```sh
node hosted/convex/check.mjs
```

This uses the installed Convex 1.32.0 and Convex Auth 0.0.95 SDKs to typecheck the deployable
schema/functions and bundle the real React fixture. It also checks configuration failure,
receipt redaction, cleanup orchestration, deadlines, and fresh unauthenticated browser startup
with an intentionally unreachable deployment endpoint. It prints `hosted provider NOT RUN`;
the disconnected startup check is not Convex service evidence.

The hosted entrypoint is:

```sh
node hosted/convex/run.mjs --hosted
```

Without `--hosted` or `AFD_AUTH_HOSTED_ADAPTER`, a direct invocation exits successfully with
`not-run`. The package script uses `--hosted`, so missing or invalid configuration exits with code
2 and does not emit a green receipt. Setting `AFD_AUTH_HOSTED_ADAPTER=convex` is also an explicit
request, with the same fail-closed behavior.

## Disposable deployment

Deploy the `convex/` directory in this folder to a dedicated development deployment. Run the
Convex CLI from this directory so that it finds this schema rather than another application's
backend. The installed CLIs support these setup commands:

```sh
../../node_modules/.bin/convex dev --once --typecheck enable
../../node_modules/.bin/auth --web-server-url http://127.0.0.1:<fixture-port>
```

The private `package.json` in this folder establishes the CLI project root. The relative binary
paths use the SDKs installed by `packages/auth`; both `--help` commands are exercised by the local
implementation gate. Run the commands from this folder exactly as shown.

Use the Convex dashboard or its environment-variable command to configure secrets; do not put
them in this repository. The auth CLI may offer to create starter files, so review its proposed
changes and retain this fixture's checked-in backend. Push the fixture again after setting the
auth keys and environment variables.

The deployment requires these nonsecret scope controls:

| Server variable | Purpose |
| --- | --- |
| `AFD_AUTH_TEST_RUN_ID` | Exact invocation accepted by protected fixture functions |
| `AFD_AUTH_TEST_EMAIL_SUFFIX` | Dedicated synthetic-account suffix |
| `AFD_AUTH_TEST_REVISION` | Revision returned by authenticated capability preflight |
| `AFD_AUTH_TEST_RETURN_URL` | Exact loopback origin allowed after OAuth |

Convex Auth also requires its normal `SITE_URL`, `JWT_PRIVATE_KEY`, and `JWKS` configuration. The
runner never provisions a project or fabricates those values.

Password authentication is always configured. The backend rejects account creation and session
creation unless the email contains the configured run ID and ends with the configured suffix.
Protected test functions additionally require a real authenticated principal and the exact
server-configured run ID. The cleanup mutation exists only in this fixture, applies only to the
current scoped principal, and removes that user's fixture records, refresh tokens, verifiers,
sessions, verification codes, accounts, and user document in one Convex mutation.
The same transaction records exact deleted-row counts and verifies the scoped rows are absent. A
one-use random proof lets the browser read and consume that tombstone after its session is deleted;
the proof is generated in the browser fixture, is restricted to the server run ID, and is never
written to the machine receipt.

## Runner configuration

Provide secrets through the executor's local secret store. The runner reads values directly; it
does not accept a shell command, evaluate environment text, or put provider administration
secrets into the browser.

| Runner variable | Required | Meaning |
| --- | --- | --- |
| `AFD_AUTH_HOSTED_ADAPTER=convex` | yes | Explicit opt-in |
| `AFD_AUTH_HOSTED_CONVEX_URL` | yes | HTTPS deployment URL |
| `AFD_AUTH_HOSTED_CONVEX_SITE_URL` | yes | HTTPS site URL used for auth routes |
| `AFD_AUTH_HOSTED_REVISION` | yes | Must equal authenticated backend preflight revision |
| `AFD_AUTH_HOSTED_RUN_ID` | yes | 8-64 character alphanumeric/hyphen invocation ID |
| `AFD_AUTH_HOSTED_EMAIL_SUFFIX` | yes | Synthetic account suffix configured on the backend |
| `AFD_AUTH_HOSTED_PRIMARY_EMAIL` | yes | First identity; must contain the run ID |
| `AFD_AUTH_HOSTED_PRIMARY_PASSWORD` | yes | First identity secret |
| `AFD_AUTH_HOSTED_SECONDARY_EMAIL` | yes | Distinct second identity; must contain the run ID |
| `AFD_AUTH_HOSTED_SECONDARY_PASSWORD` | yes | Second identity secret |
| `AFD_AUTH_HOSTED_DEADLINE_MS` | no | Per-operation bound, default 60 seconds |
| `AFD_AUTH_HOSTED_RUN_DEADLINE_MS` | no | Whole-run bound, default 3 or 6 minutes |
| `AFD_AUTH_HOSTED_RECEIPT_FILE` | no | Redacted receipt path; defaults under `/private/tmp` |

TLS verification remains enabled. The browser app is served only on loopback and connects to the
configured HTTPS Convex deployment. Its authenticated preflight must return the exact revision
and the `afd-adapter`, `cleanup-v1`, `cleanup-readback-v1`, `principal-isolation`, and
`protected-read` capabilities.
This prevents a deployment URL alone from being treated as the intended fixture.

## Optional GitHub OAuth callback

The checked-in backend includes the installed Auth.js GitHub provider only when both
`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` are configured in the Convex deployment. Register this
exact provider callback:

```text
https://<deployment>.convex.site/api/auth/callback/github
```

The callback URL is distinct from the final application return URL. Add these runner values:

| Runner variable | Meaning |
| --- | --- |
| `AFD_AUTH_HOSTED_PROVIDER_ID=github` | Enables the OAuth case |
| `AFD_AUTH_HOSTED_PROVIDER_CALLBACK_URL` | Exact registered Convex site callback |
| `AFD_AUTH_HOSTED_RETURN_URL` | Loopback app destination allowed by server config |
| `AFD_AUTH_HOSTED_OAUTH_EMAIL` | Dedicated test identity in the run email scope |
| `AFD_AUTH_HOSTED_OAUTH_HEADFUL=true` | Opens Chromium for test-identity login |
| `AFD_AUTH_HOSTED_OAUTH_STORAGE_STATE` | Protected Playwright state for that identity |
| `AFD_AUTH_HOSTED_OAUTH_DEADLINE_MS` | Callback bound, default 180 seconds |

The headful flow supports provider login, consent, MFA, or denial UI. The runner does not
automate unknown provider forms. A storage-state file is a secret because it contains the test
identity's provider session; keep it outside the repository and delete it after the run. Neither
path exposes provider client secrets or administrative credentials to the app.

## Assertions and receipt limits

The runner checks fresh loading to unauthenticated state, credential registration and sign-in,
actual AFD/provider identity agreement, stable snapshots, profile notifications, absence of an
invented `expiresAt`, reload and disconnect/reconnect continuity, protected read denial after
sign-out, and separation between two real principals. It accepts either `INVALID_CREDENTIALS` or
the production-safe `PROVIDER_ERROR` for a bad password because Convex may hide server text.

When configured, OAuth also checks unsupported per-sign-in scopes, real redirect initiation,
callback completion, the expected synthetic identity, and the same backend preflight. Without
OAuth, that assertion is `not-run` and the receipt is partial.

The receipt includes assertion statuses, package versions, revision, deployment origin, cleanup
statuses, and limits. It excludes emails, passwords, cookies, JWTs, refresh tokens, OAuth codes,
raw error bodies, console errors, and network dumps. Provider token rotation is not observable
through `AuthAdapter` and is not claimed. The `convex-<user id>` session ID is an identity mapping,
not a revocable bearer token.

The runner verifies scoped account deletion, but it cannot delete the deployment or revoke the
upstream OAuth grant while it is still executing. Those cleanup items remain `not-run`, so its
machine receipt remains partial even when every H2 browser assertion passes. After reviewing the
receipt, remove the OAuth grant/client or test grant as appropriate, delete the disposable Convex
deployment, verify both are gone, and record that external cleanup separately.
