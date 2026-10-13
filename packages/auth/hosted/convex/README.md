# Convex hosted authentication fixture

This opt-in fixture validates `useConvexAuthAdapter` against a disposable, real Convex Auth
deployment and Chromium. It is not part of the credential-free default suite, and a local bundle
or typecheck is not hosted-provider evidence.

These fixtures execute the reviewed workspace source commit. Receipt package
versions describe manifests; they do not establish installation from npm.
Published SDK delivery needs a separate packed/downloaded fresh consumer.

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

Use a fresh Cloud development deployment in a dedicated disposable Convex project. The fixture
pins Convex CLI `1.32.0`; this CLI does not provide the newer `convex deployment create` command.
Create the disposable project and its development deployment in the Convex Dashboard, then use
the pinned CLI to link and deploy this fixture. Do not select a production deployment.

1. In the Convex Dashboard, create a project named for this run under the intended team, then
   create a **Development** deployment in the cloud for that project. Do not reuse a project with
   a development deployment that must be preserved.
2. Open that deployment's settings and set a short expiration, recommended 24 hours. Record its
   deployment name and the dashboard-provided `.convex.cloud` and `.convex.site` URLs. The two
   URLs must have the same deployment name.
3. From this fixture directory, configure the pinned CLI for that existing project and deploy
   the checked-in backend:

```sh
../../node_modules/.bin/convex dev --once --configure existing --team <team_slug> --project <project_slug> --dev-deployment cloud --typecheck enable
../../node_modules/.bin/auth --web-server-url http://127.0.0.1:<fixture-port>
```

The first command selects the project's cloud development deployment, writes ignored
`.env.local` configuration, typechecks, and deploys this fixture. Confirm the deployment name it
prints matches the name recorded from the Dashboard before continuing. If it names a different
deployment, stop and correct the project selection before setting variables or running the
browser test. The second command configures Convex Auth with the same fixed loopback origin used
for the OAuth return URL. The private `package.json` in this folder establishes the CLI project
root. The relative binary paths use the versions installed by `packages/auth`; the local gate
checks the pinned CLI help and SDK compatibility.

Use the Convex Dashboard to set secrets and fixture scope variables on this deployment; do not
put them in this repository. The auth CLI may offer to create starter files, so review its
proposed changes and retain this fixture's checked-in backend. Deploy the fixture again after
setting the auth keys and environment variables.

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
| `AFD_AUTH_HOSTED_CONVEX_SITE_URL` | yes | HTTPS site URL for the same canonical Convex deployment |
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

The callback URL is distinct from the final application return URL. The provider requests only
`read:user user:email`. The fixture reads GitHub's authenticated-user and email-list endpoints and
accepts exactly one verified primary email from the email-list response. It does not use the
public profile email or fall back to an unverified address. Choose one of two identity modes:

- `run-scoped` (the default) keeps the existing rule that the verified primary email contains the
  invocation run ID and ends with the configured suffix.
- `verified-github-account` allows an explicitly configured reusable account only when both the
  stable numeric GitHub account ID and the normalized verified primary email match exactly.
  Password identities still require the invocation run ID and suffix, and the three addresses must
  remain distinct.

For reusable mode, set these server variables on the disposable Convex deployment in the Dashboard.
The existing Password scope variables must also be set there:

| Server variable | Required in reusable mode | Meaning |
| --- | --- | --- |
| `AFD_AUTH_TEST_OAUTH_IDENTITY_MODE=verified-github-account` | yes | Explicitly opts into exact stable GitHub identity matching |
| `AFD_AUTH_TEST_OAUTH_GITHUB_ACCOUNT_ID` | yes | Positive numeric GitHub account ID, stored as a string |
| `AFD_AUTH_TEST_OAUTH_EMAIL` | yes | Exact verified primary email, normalized by the fixture |
| `AFD_AUTH_TEST_PRIMARY_EMAIL` | yes | First Password identity; still run-ID/suffix scoped |
| `AFD_AUTH_TEST_SECONDARY_EMAIL` | yes | Second Password identity; still run-ID/suffix scoped and distinct |

Do not put identity values in source, receipts, or issue comments. The backend identifies a
successful exact match as `github-verified-primary` in authenticated preflight; this reports the
allowlist class without returning the configured ID or email. The account ID and verified email are
both checked when the provider profile is created, when an existing account is reused, before a
session is created, and in the AFD current-user query and protected fixture calls. A stale session
whose account no longer matches deployment configuration returns no user profile. Password
profiles reject extra identity fields and cannot link to the GitHub account by email. The exact
allowlist is a narrow fixture setting; it does not permit production deployments, broader OAuth
scopes, or other GitHub identities.

Add these runner values:

| Runner variable | Meaning |
| --- | --- |
| `AFD_AUTH_HOSTED_PROVIDER_ID=github` | Enables the OAuth case |
| `AFD_AUTH_HOSTED_PROVIDER_CALLBACK_URL` | Exact registered Convex site callback |
| `AFD_AUTH_HOSTED_RETURN_URL` | Fixed HTTP loopback origin with an explicit nonzero port, such as `http://127.0.0.1:4173` |
| `AFD_AUTH_HOSTED_OAUTH_EMAIL` | Exact GitHub verified primary email |
| `AFD_AUTH_HOSTED_OAUTH_IDENTITY_MODE` | Optional; `run-scoped` by default, or `verified-github-account` |
| `AFD_AUTH_HOSTED_OAUTH_GITHUB_ACCOUNT_ID` | Required only for reusable mode; exact positive numeric GitHub account ID |
| `AFD_AUTH_HOSTED_OAUTH_HEADFUL=true` | Opens Chromium for test-identity login |
| `AFD_AUTH_HOSTED_OAUTH_STORAGE_STATE` | Protected Playwright state for that identity |
| `AFD_AUTH_HOSTED_OAUTH_DEADLINE_MS` | Callback bound, default 180 seconds |

The headful flow supports provider login, consent, MFA, or denial UI. The runner does not
automate unknown provider forms. A storage-state file is a secret because it contains the test
identity's provider session; keep it outside the repository and delete it after the run. Neither
path exposes provider client secrets or administrative credentials to the app.

In default `run-scoped` mode, the runner requires the verified primary email to contain the exact
`AFD_AUTH_HOSTED_RUN_ID`, end with `AFD_AUTH_HOSTED_EMAIL_SUFFIX`, and differ from both Password
emails. In reusable mode, it requires the explicit numeric account ID and normalized email and
still rejects either Password email. Use reusable mode only for the exact human-approved GitHub
identity configured on both runner and deployment; do not substitute an arbitrary email, a
production deployment, or broader OAuth scopes. The runner checks these values before starting the
fixture server, and the backend independently enforces the same identity policy after OAuth.

For the supervised run, create a dedicated OAuth App in GitHub Developer Settings and register
only the callback URL above. Copy its client ID and secret to the disposable Convex deployment's
environment settings; do not put them in the runner or repository. Start the runner headfully and
complete GitHub sign-in, consent, and any MFA in Chromium. Confirm the browser returns to the fixed
loopback origin, the email shown in the app is the configured primary email, and authenticated
preflight reports `principalKind: github-verified-primary` and
`identityMode: verified-github-account`. The runner does not automate provider forms or retain the
provider response in its receipt.

The runner binds the configured loopback port and holds it before Chromium starts, so the browser
cannot contact Convex until the port preflight succeeds. If another process wins the bind race, the
run fails with `loopback-port-in-use` before any browser or provider request. Port `0`, an omitted
port, and a path/query/fragment on the return URL are rejected because the OAuth callback must
return to the exact origin the server binds.

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
statuses, and limits. It excludes emails, GitHub account IDs, raw provider profiles, passwords,
cookies, JWTs, refresh tokens, OAuth codes, raw error bodies, console errors, and network dumps.
Provider token rotation is not observable through `AuthAdapter` and is not claimed. The
`convex-<user id>` session ID is an identity mapping, not a revocable bearer token.

The runner verifies scoped account deletion, but it cannot delete the deployment or revoke the
upstream OAuth grant while it is still executing. Those cleanup items remain `not-run`, so its
machine receipt remains partial even when every H2 browser assertion passes. After reviewing the
receipt and recording the in-run cleanup readbacks:

1. In GitHub Developer Settings, delete the dedicated OAuth App used for this run (or revoke that
   app's grant and verify the grant is absent). This cleanup must never delete or change the GitHub
   account, its repositories, or its organizations.
2. In the Convex Dashboard, open the recorded development deployment's settings, permanently
   delete that deployment, and confirm the deletion. Expiration is only a failsafe. If the project
   was created solely for this run and is empty afterward, delete that project too.
3. Refresh the Dashboard and confirm the deployment is absent. Record the deployment name, the
   deletion time, and the absence readback separately from the runner receipt.
4. Remove any local `.env.local`, generated Convex files, provider storage state, and disposable
   execution worktree after preserving the redacted receipt. Confirm the worktree has no tracked
   changes before removing it.
