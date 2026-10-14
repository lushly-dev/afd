# Hosted verification round for #362

Prepared 2026-10-13 against reviewed main
`db56f17bcf08dbef4b568c8c9e3cc1b47a86ab64`. Status: **local preparation implemented;
nothing provisioned**. The preparation PR records final review and gate receipts.
The baseline harnesses merged in #377. H1/H2/H3 external runs remain **NOT RUN**.
Use [the existing handoff](hosted-verification.md) for fixture contracts and
[the package update process](../../.claude/skills/do-release/references/next-round.md)
for subsequent SDK/dependency changes.

## What remains

| Lane | Established locally | Hosted evidence still needed |
|---|---|---|
| H1 Better Auth | Real provider, Chromium, test OAuth callback, cookies, renewal/revocation/expiry and SQLite restart | Public trusted HTTPS, a selected external OIDC callback with denial/recovery, same session after infrastructure restart, external cleanup |
| H2 Convex Auth | Real SDK compilation and disconnected browser startup; deployable backend and runner | Deployed Password and GitHub OAuth flows, real hooks/user query, continuity, protected reads and two-principal isolation, external cleanup |
| H3 REST/view-state | Real HttpAdapter/ViewStateRegistry over SQLite, atomic batches, separate processes and local restart | Hosted routes/tenancy, persistent volume across infrastructure restart, controlled edge outage/recovery, durable hydration and cleanup |

Auth fixtures execute reviewed workspace source; REST/view-state use workspace
builds. Their manifest-version fields do not prove an npm installation. Runtime
sources under auth/local-db/view-state are unchanged from the verified npm 2.1.0
source `0148d2290ccf06769fd33c2b6484d3a8e4940669` at this planning baseline;
later preparation must record its own source SHA. Registry delivery uses separate
packed/downloaded consumers.

## Proposed services

Use two independent Render services in one disposable project, plus one Convex
cloud development deployment. Keeping H1/H3 on one host reduces account/control
setup while preserving separate processes, volumes, secrets and cleanup.

| Resource | Proposed configuration | Purpose |
|---|---|---|
| Render H1 | One paid `0.5c-512mb` Node 24 instance, managed HTTPS, 1 GB disk at `/var/data`, SQLite `auth.sqlite`, auto-deploy off | Same-origin Better Auth fixture and real process restart |
| Render H3 | One paid `0.5c-512mb` Node 24 instance, managed HTTPS, separate 1 GB disk at `/var/data`, SQLite `rest.sqlite`, auto-deploy off | Durable REST service with explicit restart/suspend/resume controls |
| Google | One disposable Cloud project and External/Testing OAuth Web client; a dedicated synthetic identity by default, or this run's explicitly approved existing signed-in account as the sole test user; `openid email profile` only | H1 OIDC discovery/JWKS, real consent denial and success |
| Convex | One fresh non-production cloud development deployment on Free, if capacity allows | H2 actual auth functions, Password provider, protected records and user queries |
| GitHub | One dedicated OAuth App and either a run-scoped test identity or an explicitly allowlisted existing account | H2 exact supported OAuth callback, with only profile/email scopes |
| Operator Mac | Node 24, pinned pnpm, matching Chromium, provider control CLI/API | Headed browser interactions and orchestration; no hosted browser service needed |

Render supports [persistent disks](https://render.com/docs/disks) only on paid
services. Its [restart procedure](https://render.com/docs/deploys) retains the
current configuration; suspension produces documented
[HTTP 503](https://render.com/docs/troubleshooting-deploys#503-service-unavailable).
Use a single instance for each SQLite volume. No managed Postgres, Redis, domain
purchase or production application is needed for this bounded fixture topology.

Alternative considered: Railway can provide a small free service/volume, but Free
has [one volume per project](https://docs.railway.com/volumes/reference) and
[limited trials can restrict outbound network](https://docs.railway.com/pricing/free-trial).
Fly provides inexpensive Machines/volumes but requires additional container and
control setup. Render is the proposed common host for deterministic control-plane
receipts; it is a choice for this verification round, not an AFD runtime dependency.

## Cost and approval gate

Proposal: **$10 maximum incremental spend for a 48-hour verification window**,
with deletion as soon as receipts are accepted. No resources or charges are
approved by this document. Preserve the existing GitHub Actions spending setting.

At the inspected [Render pricing](https://render.com/pricing), two $7/month
instances plus two 1 GB disks at $0.25/GB/month have a roughly $14.50/month run
rate. Compute/storage are [prorated](https://render.com/docs/faq); 48 hours is
about $1 before taxes, egress or extra build usage. This is an estimate, not a
provider-enforced cap. Read the actual workspace/instance/disk/build quote first,
retain a pre-create quote and final billing/usage readback, use included build
capacity, monitor usage before each phase, and stop if the
chosen configuration cannot fit the approved ceiling. No workspace upgrade or
unapproved overage is part of the plan.

Choose Convex Free with available team/deployment capacity, not an automatically
metered paid upgrade; see [pricing](https://www.convex.dev/pricing) and
[limits](https://docs.convex.dev/production/state/limits). Google OAuth setup uses
no paid APIs or billing-enabled project. If an account requires a paid plan,
additional identity service or billing change, obtain a new scoped decision first.

## Local preparation before provisioning

The preparation changes below are development infrastructure. They preserve the
public AuthAdapter, HttpAdapter and ViewStateRegistry contracts. Provision only
the final preparation commit after independent review and all applicable gates.

1. **H1 deployment binding and restart timing.** `AFD_BA_HOST` accepts loopback
   (default) or `0.0.0.0`; port precedence is `AFD_BA_PORT`, platform `PORT`, then
   3000. Hosted sessions default to 180 seconds with a 5-second update age.
   `AFD_BA_OPERATION_TIMEOUT_MS` defaults to 15 seconds;
   `AFD_BA_RESTART_TIMEOUT_MS` gives the control command and new-instance polling
   one shared 90-second budget. `AFD_BA_DEADLINE_MS` is a separate whole-run bound
   (10 minutes by default, 15 minutes in the Render recipe). Before restart the
   runner renews and independently reads the same session, requiring sufficient
   remaining lifetime for restart, one shared post-restart observation window
   and a one-second clock-skew margin. Impossible timing combinations fail
   preflight. The final idle-expiry assertion remains.
   Local mode retains fast 12-second sessions and loopback binding. See the
   [H1 configuration contract](../../packages/auth/hosted/better-auth/README.md).
2. **H3 managed-edge outage.** Native-fetch rejection remains the default.
   `AFD_TEST_HTTP_UNAVAILABLE_HTTP_STATUS=503` explicitly selects the Render edge
   outage mode, requiring exactly HTTP 503 and a distinct provider-edge receipt.
   Wrong statuses, healthy responses, malformed URLs and acknowledgement alone
   fail. Independent provider suspension evidence is still required; the runner
   does not attest control-plane state. Real HttpAdapter tests cover both modes.
3. **H2 identity and deployment preflight.** The runner requires three distinct
   Password-primary/Password-secondary/OAuth identities, canonical matching
   `.convex.cloud`/`.convex.site` origins and a fixed nonzero loopback port. It
   binds that port before Chromium starts. The default GitHub identity mode
   requires a verified run-scoped email. Optional `verified-github-account` mode
   admits one configured stable GitHub account ID and exact verified primary
   email, checked server-side against GitHub provider evidence. It retains
   strict run-scoped Password users and run-scoped protected records. Confirm
   the selected identity and reviewed mode before creating paid resources;
   an arbitrary email/suffix exception is never sufficient. The
   [H2 recipe](../../packages/auth/hosted/convex/README.md) uses Dashboard creation
   and the pinned CLI 1.32 deployment flow; no SDK upgrade is implicit.
4. **Reproducible deploy/control assets.** The
   [Render recipe](hosted-render.md) and `scripts/hosted/render.yaml` define two
   separate Node 24 services, frozen dependency install, one replica each,
   persistent disks, readiness and disabled auto-deploy. The local ownership
   ledger binds exact service/disk IDs, roles and the reviewed source. A bounded
   helper reads provider identity and implements restart, suspend/resume and
   cleanup with redacted receipts. Administrative credentials stay local, never
   in fixture environment, JSON argv, browser or receipts. Its injected-response
   tests are part of `pnpm test:hosted:local`; they make no provider requests.
5. **Final gate and review.** Run `pnpm check`, `pnpm test:hosted:local`, the
   separate auth browser suite and applicable CI on the final candidate. Require
   independent source review, including deployment definitions and control
   failure paths. These checks do not create hosted resources or establish live
   provider behavior. Record the final source SHA in the resource ledger and
   retain actual provider deploy/source readbacks during execution.

The REST server already has a standalone entrypoint; no replacement server is
needed. Its HTTP health endpoint requires bearer auth, so use the platform's TCP
readiness check and let the runner perform authenticated health. H1 can use
`/harness/info` for platform readiness. Startup must retain installed fixture build
and runtime dependencies; do not prune Better Auth/esbuild/React needed by serve.

## Execution order

1. **Freeze the candidate and resource ledger.** Record source SHA, runtime/SDK/
   browser versions, approved spend/window, run-scoped principal labels and any
   explicitly approved existing-account exception. Plan exact service/project/
   client/deployment/store IDs, owners and removal steps. No secrets or private
   identity values go into public receipts.
2. **Configure and preflight services.** After approval, create the disposable
   resources, pin source, set local/deployment secrets and register exact provider
   callbacks. Read back provider deploy commit/configuration separately from the
   fixtures' self-reported revision strings. Disable auto-deploy during the run.
   Time an empty-session H1 restart first and require a new instance within budget.
3. **H3 first.** Run configuration preflight, then the existing hosted baseline
   and extended write phase. Capture stable store ID, instance, disk and deploy.
   Suspend H3, poll its suspended control-plane state, observe the explicit 503
   outage assertion, resume and restart the same source/store, and read from a
   new process. Require a changed instance, unchanged store identity, CRUD/batch
   readbacks and new ViewStateRegistry hydration. Finish exact-ID cleanup and
   independent deletion reads. The fixture server's environment is `AFD_FIXTURE_*`;
   runner configuration is `AFD_TEST_HTTP_*`, with table `integration_records`,
   both scoped tokens and `AFD_TEST_HTTP_EXPECT_FIXTURE_AUTH=1`.
4. **H1 next.** Run headed Chromium with the configured Google test identity:
   deny consent, recover through a real callback, verify Secure/HttpOnly/SameSite/
   path, independent session mapping, two tabs, isolated context and reload.
   Restart the actual H1 process with its volume/secret unchanged; prove the exact
   old session and user survived. Then prove renewal, sign-out/revoked-cookie
   rejection and idle expiry. Use `AFD_BA_*`; never send operator control
   credentials to this application.
5. **H2 last.** Configure Convex Password + GitHub, deploy checked-in auth schema/
   routes/functions, verify the authenticated revision/capabilities, and run real
   hooks/query state, credentials/bad-password, profile notifications, reload/
   reconnect, protected-read denial and two-principal isolation. Complete GitHub
   OAuth in headed Chromium and verify the exact user and callback. Use
   `AFD_AUTH_HOSTED_*` locally and `AFD_AUTH_TEST_*` plus normal Convex Auth secrets
   in the deployment. An OAuth-not-run receipt cannot close H2.
6. **Triage before retry.** A failure stops its lane and captures the failed phase,
   independent readback and cleanup status. Attribute it to the SDK, fixture,
   provider configuration or service rather than widening success criteria.
   Reuse #362 for harness/provider preparation; file reproduced SDK defects as
   linked fixes. A source repair creates a new candidate with fresh review/gates.
   Do not blindly rerun writes or uncertain OAuth cleanup.
7. **External cleanup and review.** Delete this run's application records,
   accounts and sessions, verify absence, then revoke dedicated provider grants/
   clients and remove services/disks/Convex deployment. Remove local secret files/
   provider browser state and any dedicated identity created for this round,
   subject to provider account deletion rules. An existing allowlisted GitHub
   account is retained; cleanup removes its test grant and Convex test user/data,
   never the GitHub account, repositories or organization memberships. An
   explicitly approved
   existing Google account is also retained; remove its dedicated app grant and
   the fixture's exact app-user/session/account rows, never the upstream Google
   account. Use the provider control plane to delete and read back exact service/
   disk IDs, not merely stop a process or observe an HTTP error. Render references:
   [delete service](https://api-docs.render.com/reference/delete-service),
   [delete disk](https://api-docs.render.com/reference/delete-disk),
   [service readback](https://api-docs.render.com/reference/retrieve-service).
   Retain only redacted receipts. Stop paid resources
   within the approved window even if a lane remains failed or partial.

## Callback and identity contract

| Lane | Provider callback | Final application destination |
|---|---|---|
| H1 Google OIDC | `https://<h1>.onrender.com/api/auth/callback/google` | `https://<h1>.onrender.com/` |
| H2 GitHub | `https://<deployment>.convex.site/api/auth/callback/github` | Fixed loopback origin such as `http://127.0.0.1:4173` |

H1 discovery is `https://accounts.google.com/.well-known/openid-configuration`,
with issuer `https://accounts.google.com`; confirm live metadata at setup. Use a
dedicated Google Cloud project and Web application client with an External/Testing
audience, requesting only `openid`, `email` and `profile`. A dedicated synthetic
Google identity remains the recommended default. For this run, the explicitly
approved existing signed-in Google account may instead be the sole account in the
OAuth test-user allowlist; set `AFD_BA_EXPECTED_EMAIL` to that account's exact
email. Keep the fixture application and store dedicated. After the run, revoke
the dedicated app grant, remove the fixture's exact app-user/session/account rows
and dispose of the fixture app/store while retaining the upstream Google account.
The fixture already requests `prompt=consent` for denial/recovery.
See [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
and [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

For H2, a second GitHub account is optional. Existing-account mode requires the
exact immutable GitHub account ID plus its exact verified primary email, separate
from both Password users. Use a dedicated OAuth App requesting only `read:user`
and `user:email`; do not request repository or organization scopes. The account
and email must be confirmed before paid provisioning. See the
[H2 identity contract](../../packages/auth/hosted/convex/README.md) for matching
runner/deployment configuration. Provider authorization remains an explicit
operator step; local identity checks do not prove a completed OAuth callback.

For H2, GitHub is the runner's exact implemented OAuth provider. Read the callback
from the same Convex deployment as the client endpoint; the final loopback return
is not the registered GitHub callback. Provider login/consent/MFA happens only in
the supervised browser, without credentials in the harness. See
[Convex GitHub setup](https://labs.convex.dev/auth/config/oauth/github),
[manual auth setup](https://labs.convex.dev/auth/setup/manual) and
[GitHub OAuth App setup](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

## Receipt and closure gates

Each lane needs assertion-level results, exact source/deploy binding, nonsecret
resource identities, SDK/runtime/browser versions, independent state readbacks,
external restart/outage evidence where applicable, and cleanup evidence. A caller-
supplied SHA, restart acknowledgement or phase exit alone is not attestation.

The auth runners deliberately remain **partial** after successful application
checks because external grant/deployment disposal is not their job. Add a separate
operator receipt and independent absence readback before accepting H1/H2. Convex
fixture cleanup does not prove removal of every auxiliary auth row after failure
(e.g. `authRateLimits`); disposal of the entire dedicated deployment closes that
uncertainty. Expiration is a failsafe, not a substitute for verified deletion.

Keep #362 open until H1, H2 including OAuth, H3, and external cleanup are reviewed.
Do not infer upstream OAuth token rotation, immediate old-Convex-JWT revocation,
other browser engines, arbitrary third-party-cookie support, simultaneous lock
acquisition, offline queues or exactly-once writes. No SDK release is needed for
fixture-only preparation; any discovered SDK repair follows the next-round guide.
