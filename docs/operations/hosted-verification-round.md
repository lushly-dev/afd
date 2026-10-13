# Hosted verification round for #362

Prepared 2026-10-13 against reviewed main
`db56f17bcf08dbef4b568c8c9e3cc1b47a86ab64`. Status: **proposed; nothing provisioned**.
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
| Google | One disposable Cloud project, External/Testing OAuth Web client, one dedicated synthetic Google identity, `openid email profile` only | H1 OIDC discovery/JWKS, real consent denial and success |
| Convex | One fresh non-production cloud development deployment on Free, if capacity allows | H2 actual auth functions, Password provider, protected records and user queries |
| GitHub | One dedicated OAuth App and a separate verified synthetic GitHub identity | H2 exact supported OAuth callback; never use the maintainer's usual identity |
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

These are proposed changes, **not currently implemented configuration options**.
Keep them within #362 and development infrastructure; do not change AuthAdapter,
HttpAdapter or ViewStateRegistry public guarantees merely to pass a fixture.

1. **H1 deployment binding and restart timing.** Add validated hosted bind/port
   configuration (`0.0.0.0`, platform `PORT` fallback) while local mode remains
   loopback. Current `provider.ts` binds `127.0.0.1`; the README assumes an extra
   same-host proxy that managed ingress alone does not provide.
   Replace the fixed hosted 45-second session/30-second command/20-second poll
   combination with bounded hosted settings. Target a 180-second session,
   5-second update age, one shared 90-second restart deadline and a 15-minute run
   bound. Update the current `run.ts` identity assertion (`expiresIn <= 60`) and
   introduce separate bounded whole-run, per-operation and shared restart settings;
   today `AFD_BA_DEADLINE_MS` is reused across waits and is not an independent
   restart budget. Renew and independently capture the same session immediately before
   restart; require sufficient remaining lifetime plus a margin. Do not give the
   command and poll separate full budgets or remove the final expiry assertion.
   Keep the fast local timings unchanged and add focused contract regressions.
2. **H3 managed-edge outage.** Preserve the existing native-fetch rejection mode.
   Add explicit expected-HTTP-status mode for Render suspension, e.g. proposed
   `AFD_TEST_HTTP_UNAVAILABLE_HTTP_STATUS=503`. Require exactly 503 in that mode,
   a distinct `provider-edge-http-503-unavailable` result and matching independent
   suspend evidence. Wrong HTTP status, malformed URL, a 200 or an acknowledgement
   string alone must fail. Never report an HTTP 503 as a native network rejection.
3. **H2 identity and deployment preflight.** Confirm a dedicated GitHub identity
   has a verified primary email containing the chosen run ID and allowed suffix;
   add a runner preflight check and regression that requires three distinct
   Password-primary/Password-secondary/OAuth identities. Current `lib.mjs` only
   compares the two Password emails, so this is a local source prerequisite.
   The current fixture enforces that email scope on the backend and runner. If a
   reusable fixed OAuth test identity is needed, first add an exact server-side
   OAuth allowlist separate from the run marker, retaining strict Password and
   record scoping; do not broadly disable the identity guard. Resolve this before
   paid resources. Reserve the loopback return port and check the deployment's
   canonical `.cloud`/`.site` URL pair. Use dashboard provisioning with the pinned
   SDK CLI for fixture deployment: installed Convex 1.32 lacks the newer
   `deployment create` administration command. No SDK upgrade is implicit.
4. **Reproducible deploy/control assets.** Add validated Render definitions or an
   equally reproducible wrapper for each service, Node 24 and pinned dependency
   install, volume mounts, one replica, health/readiness and auto-deploy off.
   Add a bounded control helper that reads service/deploy/disk identity, restarts,
   suspends/resumes and records redacted evidence. Operator admin credentials stay
   local, never in fixture environment, JSON argv, browser or receipts.
5. **Run and review the local gate.** `pnpm check`, `pnpm test:hosted:local`, the
   separate auth browser suite, focused new configuration/outage regressions and
   applicable CI must pass on the final candidate. Review deployment definitions
   without creating resources. Record exact head and require independent review.
   Provision that reviewed preparation commit, not this planning baseline.

The REST server already has a standalone entrypoint; no replacement server is
needed. Its HTTP health endpoint requires bearer auth, so use the platform's TCP
readiness check and let the runner perform authenticated health. H1 can use
`/harness/info` for platform readiness. Startup must retain installed fixture build
and runtime dependencies; do not prune Better Auth/esbuild/React needed by serve.

## Execution order

1. **Freeze the candidate and resource ledger.** Record source SHA, runtime/SDK/
   browser versions, approved spend/window and synthetic principal labels. Plan
   exact service/project/client/deployment/store IDs, owners and removal steps.
   No secrets or identity values go into public receipts.
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
4. **H1 next.** Run headed Chromium with the Google test identity: deny consent,
   recover through a real callback, verify Secure/HttpOnly/SameSite/path, independent
   session mapping, two tabs, isolated context and reload. Restart the actual H1
   process with its volume/secret unchanged; prove the exact old session and user
   survived. Then prove renewal, sign-out/revoked-cookie rejection and idle expiry.
   Use `AFD_BA_*`; never send operator control credentials to this application.
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
7. **External cleanup and review.** Delete this run's records/accounts/sessions,
   verify absence, then revoke dedicated provider grants/clients and remove
   services/disks/Convex deployment. Remove local secret files/provider browser
   state and any dedicated identity created for this round, subject to provider
   account deletion rules. Use the provider control plane to delete and read back exact service/disk IDs,
   not merely stop a process or observe an HTTP error. Render references:
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
Google Web application client, External/Testing audience and only the synthetic
Google test user. The fixture already requests `prompt=consent` for denial/recovery.
See [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)
and [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

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
