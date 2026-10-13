# Durable REST persistence harness

This directory closes the local implementation gap for issue #362 H3. It is disposable test
infrastructure and is excluded from the published `@lushly-dev/local-db` package. The REST
fixture is deliberately small and must not be used as an application server or treated as a new
runtime supported by AFD.

## Local lifecycle

The local runner needs Node 24 because the fixture uses the built-in `node:sqlite` module. Select a
Node 24 runtime, build the actual adapters, then run the lifecycle:

```sh
pnpm -F @lushly-dev/local-db build
pnpm -F @lushly-dev/afd-view-state build
node packages/local-db/hosted/run-local.mjs
```

`run-local.mjs` creates a temporary SQLite file, starts the REST fixture, runs the write phase in
a child process, stops the server, proves a bounded native-fetch failure while it is unavailable,
and starts a new server process over the same file. A separate read process checks the persisted
run marker, unchanged store identity, changed server instance, CRUD/query/batch records, and a new
`ViewStateRegistry` hydration. It then removes only the exact run IDs for both synthetic
principals, independently reads back every deletion, stops the server, and removes the temporary
database. A cleanup failure is a harness failure and retains the database directory for diagnosis.

The local server derives tenancy from one of exactly two bearer tokens. It returns 401 without a
valid token, returns 403 if a token tries to select the other principal, and never accepts a
client-provided tenant namespace. View-state `category` remains a list filter within the
server-owned tenant.

## External hosted phases

`run-phase.mjs` imports the built `HttpAdapter` and `ViewStateRegistry`. It does not provision,
restart, or delete a hosted service. Its required nonsecret configuration is:

- `AFD_TEST_HTTP_BASE_URL`: complete HTTPS API base URL, such as
  `https://host.example/api/v1`; cleartext HTTP is accepted only for a loopback fixture
- `AFD_TEST_HTTP_TABLE`: isolated entity table where missing `PATCH` returns 404
- `AFD_TEST_HTTP_RUN_ID`: stable 8-80 character marker reused for every phase
- `AFD_TEST_HTTP_APP_REVISION`: nonsecret application revision for `write` and `read`
- `AFD_TEST_HTTP_STORE_ID`: stable nonsecret backing-store identity when `/health` does not return
  `storeId`
- `AFD_TEST_HTTP_DEADLINE_MS`: optional per-request deadline, default 5000 ms

If the service uses authentication, set both `AFD_TEST_HTTP_TOKEN` and
`AFD_TEST_HTTP_SECONDARY_TOKEN` to two scoped synthetic principals. Supplying only one fails
preflight. Keep them in the environment; the harness does not print them or response bodies.

Validate configuration without making a network request:

```sh
AFD_TEST_HTTP_PHASE=preflight node packages/local-db/hosted/run-phase.mjs
```

Then perform the hosted lifecycle as separate processes:

```sh
AFD_TEST_HTTP_PHASE=write node packages/local-db/hosted/run-phase.mjs

# Externally restart the application while retaining the identified durable store.
# Record the provider/deployment restart receipt outside this process, then set a nonsecret marker.
export AFD_TEST_HTTP_RESTART_ACK=restart-2026-10-12T120000Z
export AFD_TEST_HTTP_APP_REVISION=<revision-after-restart>

AFD_TEST_HTTP_PHASE=read node packages/local-db/hosted/run-phase.mjs
AFD_TEST_HTTP_PHASE=cleanup node packages/local-db/hosted/run-phase.mjs
```

The read phase refuses to run without `AFD_TEST_HTTP_RESTART_ACK`. It reports the revision stored
by the write phase and the current revision. When health exposes `instanceId`, it also requires the
instance to have changed. A passing write or read phase is only a phase receipt; neither alone is a
hosted durability pass. The H3 claim requires the write receipt, external restart evidence, read
receipt, stable store identity, and successful cleanup receipt from the same run ID.

To exercise the documented unavailable surface, intentionally stop the disposable application,
set a nonsecret `AFD_TEST_HTTP_UNAVAILABLE_ACK` identifying that controlled outage, and run
`AFD_TEST_HTTP_PHASE=unavailable`. This phase passes only on a deadline-bounded native fetch
rejection; an HTTP application response or malformed base URL is not accepted as unavailability.
Restart the service and complete `read` to prove recovery. Run `cleanup` after any partial failure.
Cleanup targets the fixed IDs derived from the run marker and never clears a table.
