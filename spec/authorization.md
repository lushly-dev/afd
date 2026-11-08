# MCP authorization

How an AFD server on HTTP acts as an OAuth 2.1 protected resource under MCP 2026-07-28: which
requests need a token, how a token is verified, what commands see of it, how scopes are decided per
call, and the 401 and 403 answers. It is opt-in: a server without it behaves as before.

Specified 2026-11-07 as step 0a of [Umbel phase 5](../endpoints/umbel/docs/phases/5-auth-hosted/spec.md)
(decision D106), from the [MCP Authorization proposal](../docs/features/active/mcp-authorization/mcp-authorization.proposal.md),
whose decisions A4 and A5 it amends ([M6](#m6-scopes)). Rust implements it first (Umbel steps 0b
and 0c); TypeScript and Python follow, and already bind the principal (M8) in confirmation state
(step 0c). C++ has no HTTP server, so none of this applies to it.

**Sources.** MCP 2026-07-28 [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and its security considerations; RFC 6749 (OAuth 2.0) 3.3; RFC 6750 (bearer tokens) 2 and 3;
RFC 7515 (JWS) 4.1; RFC 7517 (JWK) 4; RFC 7518 (JWA) 3; RFC 7519 (JWT) 4.1; RFC 7662
(introspection) 2.2; RFC 8037 (EdDSA in JOSE) 3.1; RFC 8705 (mutual-TLS bound tokens) 3.1;
RFC 8707 (resource indicators) 2; RFC 8725 (JWT best practices) 3.11; RFC 9068 (JWT access tokens)
2 and 4; RFC 9110 (HTTP semantics) 11; RFC 9449 (DPoP) 6.1; RFC 9728 (protected-resource
metadata) 2, 3 and 5.

## Terms

| Term | Meaning |
| --- | --- |
| Resource | The server's canonical resource URI: the MCP endpoint's absolute `https` URL, with no query or fragment. It is the token audience (RFC 8707 2) and the metadata's `resource` (RFC 9728 2) |
| Issuer | An authorization server whose tokens the server accepts, named by its exact `iss` string |
| Credentials | The verified claims of one request's token ([M4](#m4-credentials)) |
| Rule code | The name of the rule a refused token broke ([M2](#m2-the-bearer-token), [M3](#m3-token-verification)). Logged, never sent |
| Principal binding | The canonical JSON of a call's actor and credentials identity ([M8](#m8-the-principal-binding)) |

## M1. Where it applies

When a server is configured with authorization, every HTTP request that can reach a command, a
tool list or a task needs a valid token: the Streamable HTTP endpoint on both eras, the deprecated
`/sse` and `/message` lane, and the AFD HTTP routes (`/rpc`, `/batch`, `/stream`). Only the metadata
routes ([M7](#m7-protected-resource-metadata)) are public; a host decides about its own other
routes (Umbel: `/health`).

**Unaffected:** stdio (MCP: stdio "SHOULD NOT" follow the authorization specification), the CLI,
`DirectClient`, and in-process registries. They carry no token and no `credentials`, and AFD checks
no scope on them. A host may check its own rules there (Umbel's scope gate does).

**Fail closed.** When authorization is configured, a request that reaches the MCP service without
credentials verified for that server is refused with `UNAUTHORIZED` before any command runs:
- an HTTP request whose credentials the server's own HTTP layer did not admit (a layer left out,
  or a layer built for another server's configuration);
- a request on any other transport, unless the server serves it as stdio or the host has
  explicitly marked that transport trusted (as it trusts a stdio peer, by authenticating it
  itself).

Nothing is read from a header the caller controls, other than the one token.

## M2. The bearer token

A request carries exactly one token, in exactly one `Authorization` header (RFC 6750 2.1):

- The field value, after the HTTP parser strips surrounding whitespace, is the scheme `Bearer`
  (compared ignoring ASCII case, RFC 9110 11.1), one or more spaces, and a `b64token`:
  `1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"="`. Anything else is refused.
- A second `Authorization` header is refused.
- A token in the query (`access_token`, RFC 6750 2.3) or in a form-encoded body (RFC 6750 2.2) is
  refused, even beside a valid header.
- No `Authorization` header, and no token anywhere else, is a request without a token.

Every refusal here is a 401 ([M5](#m5-401-and-403)). RFC 6750 3.1 suggests 400 `invalid_request`
for a token sent two ways; AFD answers 401 so that every refusal has one shape and points to the
metadata.

The token never goes further than the verifier. No command, middleware, journal entry, log line,
task record, telemetry event or error message receives it, and debug output prints `[redacted]`
for it. The HTTP layer removes the `Authorization` header before the request reaches the MCP
service, so not even a host's context hook can read it.

## M3. Token verification

Rules applied in order to every request with a token. The first broken rule refuses the request
with its rule code. **No library default is relied on**: each rule is checked explicitly, so a
library whose defaults are weaker (for example, `jsonwebtoken` 11.1 does not check `nbf`, `typ` or
`kid`, and accepts an `aud` array when any member matches) cannot weaken them.

1. **Route by shape.** A compact JWS (three base64url parts) goes to the JWT rules: its unverified
   `iss` must name a configured JWT issuer exactly, else `unknown-issuer`. Any other token goes to
   the one introspection issuer, if one is configured, else `unknown-issuer`. A token is never sent
   to an issuer that did not issue it, so an opaque token never transits elsewhere (MCP: servers
   "MUST NOT accept or transit any other tokens"). A JWS whose payload is not one JSON object with
   unique member names names no issuer: `unknown-issuer` (RFC 7519 4: a repeated claim is refused,
   never read as its last value).
2. **Header** (RFC 9068 2.1, RFC 7515 4.1, RFC 8725 3.11), in this order (a header that is not one
   JSON object with unique member names fails the first):
   - `typ` is `at+jwt` or `application/at+jwt`, compared ignoring ASCII case: else `typ`.
   - `alg` is in the issuer's algorithm list. `none` and every `HS*` algorithm are always refused,
     whatever the list says: else `alg`.
   - `kid` is a non-empty string: else `kid`.
   - No `crit` member, since no extension is understood (RFC 7515 4.1.11): else `crit`.
   - No `jku`, `x5u`, `x5c` or `jwk` member: else `key-reference`. Keys come only from the
     configured issuer.
3. **Key.** The issuer's key set holds a key with that `kid` (the key's own `kid` equal to the
   header's), and it fits the header: its `kty`
   is the `alg`'s family (`RSA` for `RS*` and `PS*`; `EC` for `ES*`, with `crv` `P-256`, `P-384`
   or `P-521` for `ES256`, `ES384` or `ES512`, RFC 7518 3.4; `OKP` with `crv` `Ed25519` or `Ed448`
   for `EdDSA`, RFC 8037 3.1); its `alg`, when present, equals the header's; its `use`, when
   present, is `sig`; its `key_ops`, when present, contain `verify` (RFC 7517 4.2 to 4.4). Else
   `key`, as for key material the verifier cannot use (a coordinate of the wrong length, a curve it
   does not implement). The host fetches keys (`KeySource`); AFD opens no socket. A key source that cannot answer
   refuses with `unavailable`.
4. **Signature** under that key: else `signature`.
5. **Issuer.** `iss` equals the issuer's configured string exactly: else `issuer`.
6. **Audience** ([M3.1](#m31-the-audience)): else `audience`.
7. **Required claims** (RFC 9068 2.2). `exp`, `iat`, `jti`, `sub` and `client_id` are present.
   `jti`, `sub` and `client_id` are non-empty strings of at most 255 Unicode code points with no
   control character (general category `Cc`); `exp`, `iat`, `nbf` and `auth_time` are finite JSON
   numbers; `acr`, when present, is a string under the same limits as `sub`. Else `claims`.
8. **Time**, with the configured clock skew `s` (default 60 seconds, at most 300) and the current
   time `now`, all in seconds:
   - `now < exp + s`: else `expired`;
   - `iat ≤ now + s`, and `nbf ≤ now + s` when present: else `not-yet-valid`;
   - `exp − iat` at least 0 and at most the configured maximum lifetime (default 3600 seconds):
     else `lifetime`. A token that expires before it was issued has no lifetime.
9. **Scopes** ([M3.2](#m32-the-scope-claim)): `scope-malformed` or `scopes-too-many`.
10. **Binding.**
    - `cnf.jkt` (DPoP, RFC 9449 6.1) is refused with `dpop-unsupported` and never treated as a
      bearer token.
    - With `cnf["x5t#S256"]` (RFC 8705 3.1), the TLS client certificate's SHA-256 thumbprint must
      equal it: else `binding`.
    - A `cnf` that is not an object, or that holds a confirmation method other than `x5t#S256`
      (and `jkt`, refused above), is refused with `binding`: the server could prove no other.
    - Without one, a server configured to require bound tokens refuses the token with `binding`.

**Introspection** (RFC 7662), for the one issuer configured for it, replaces rules 2 to 4. The
response must say `active: true` (else `inactive`) and carry `exp`, `iat`, `iss`, `aud`, `sub` and
`client_id`, all optional in RFC 7662 2.2 and all required here (else `claims`). Rules 5 to 10 then
apply to the response. An introspection endpoint that cannot answer refuses with
`unavailable`. A response may be cached by the token's SHA-256 until the earlier of its `exp` and
60 seconds. Introspection needs an HTTP client, so the host implements it as a `TokenVerifier`;
AFD's own verifier handles JWTs.

### M3.1. The audience

`aud` is a string, or an array of exactly one string, equal to the resource (RFC 8707 2, RFC 9068
4). A token with several audiences is refused even when one matches, since any of them could
replay it here. Equality:
- the scheme and the host compare ignoring ASCII case, as MCP allows;
- everything else compares exactly: the port as written (`:443` is not the same as no port), the
  path (a trailing slash differs), percent-encoding and case;
- a value with user information, a query or a fragment never matches.

### M3.2. The scope claim

`scope`, when present, is a string of scope tokens separated by single spaces (RFC 9068 2.2.3,
RFC 6749 3.3): each token is one or more of `%x21 / %x23-5B / %x5D-7E`. An empty string or an
absent claim grants no scope. Leading, trailing or repeated spaces, a forbidden character, or a
`scope` that is not a string is `scope-malformed`. A repeated scope counts once; the first
occurrence keeps its place.

Parsing is exact: case-sensitive, with no wildcard and no hierarchy. A host that orders its scopes
does so in its resolver ([M6](#m6-scopes)), as Umbel does (phase 5, section 5.1: every verb on a
space implies `read` there).

A verifier has a scope limit, default 64. With a scope prefix configured, only scopes starting
with `<prefix>:` count; otherwise all do. A token over the limit is `scopes-too-many`, a 401 and
never a 403, since asking for more scopes cannot fix it.

## M4. Credentials

A verified token becomes `credentials` on the command context: `CommandContext.credentials` in
Rust and TypeScript, `context.credentials` in Python. `context.auth` stays with
`@lushly-dev/afd-auth`, which answers a different question (which user an application signed in).

| Field | Type | From |
| --- | --- | --- |
| `issuer` | string | `iss` |
| `subject` | string | `sub` |
| `clientId` | string | `client_id` |
| `scopes` | string[] | `scope`, parsed by [M3.2](#m32-the-scope-claim), in token order |
| `resource` | string | The configured resource, as configured (not the token's spelling) |
| `expiresAt` | integer | `exp`, in whole seconds since the epoch, rounded down |
| `issuedAt` | integer | `iat`, the same way |
| `authTime` | integer, optional | `auth_time`, when present |
| `acr` | string, optional | `acr`, when present |
| `cnf` | object, optional | `{ "x5t#S256": <thumbprint> }`, when the token is certificate-bound |

Rules:
- **Never the token.** No field holds the raw token, and no API returns it.
- **Redacted in debug output.** A language's debug or display form (Rust `Debug`, Python
  `repr`) prints `[redacted]` for every field but `issuer` and `expiresAt`.
- **Only the server sets it,** from a verified request. It is never read from tool arguments,
  `_meta` or a header other than the token. In process it is absent unless trusted host code sets
  it.
- **Never passed on.** Credentials are not journaled, not in results, telemetry or logs, and not
  forwarded to a mounted server or connector. A command that calls another command in process
  passes its context as it does today.
- **The actor.** A host maps credentials to `actor` (Rust: the context hook; TypeScript:
  `createContext`). Without a mapping the server sets
  `{ "kind": "agent", "id": <clientId>, "onBehalfOf": <subject> }`.

## M5. 401 and 403

The `WWW-Authenticate` values below are exact (RFC 6750 3, RFC 9728 5.1, RFC 9110 11.6.1).
Clients read the parameters by name, so their order carries no meaning; it is fixed here so that
implementations agree byte for byte. `<metadata>` is the path-inserted metadata URL of [M7](#m7-protected-resource-metadata).

| Case | Status | `WWW-Authenticate` |
| --- | --- | --- |
| No token | 401 | `Bearer resource_metadata="<metadata>", scope="<scopes>"` |
| A token was sent and refused | 401 | `Bearer resource_metadata="<metadata>", scope="<scopes>", error="invalid_token"` |
| Missing scopes ([M6](#m6-scopes)) | 403 | `Bearer error="insufficient_scope", scope="<missing>", resource_metadata="<metadata>"` |

- In a 401, `<scopes>` is the metadata's `scopes_supported` joined by single spaces. With none
  configured, `scope=` is left out.
- In a 403, `<missing>` is every missing scope of the whole request, joined by single spaces, in
  the order [M6](#m6-scopes) gives. One challenge lets the client step up in one round (MCP:
  insufficient scope "SHOULD" be a 403 naming the needed scopes). Only scope tokens are named:
  when a resolver refused without naming one, `scope=` is left out (never sent empty) and the
  403 body's suggestion reads "Obtain a token for `<resource>` that grants the scopes this call
  needs, then retry."
- No `error_description` is sent: the rule code is logged at `warn` with the issuer, never the
  token or a claim value.

The body is JSON (`Content-Type: application/json`):
- 401: `{"error":"UNAUTHORIZED","suggestion":"Obtain a token for <resource> from an authorization server named in <metadata>."}`
- 403: `{"error":"INSUFFICIENT_SCOPE","suggestion":"Obtain a token for <resource> that also grants <missing>, then retry."}`

### Rule codes

| Rule code | Rule |
| --- | --- |
| `no-token` | No token on the request (the 401 without `error`) |
| `token-location` | A token in the query or a form body, or a second `Authorization` header |
| `token-malformed` | The `Authorization` value is not `Bearer <b64token>` |
| `unknown-issuer` | No configured issuer for this token ([M3](#m3-token-verification), rule 1) |
| `typ`, `alg`, `kid`, `crit`, `key-reference` | Rule 2 |
| `key` | Rule 3 |
| `signature` | Rule 4 |
| `issuer` | Rule 5 |
| `audience` | Rule 6 |
| `claims` | Rule 7, or a required introspection field missing |
| `expired`, `not-yet-valid`, `lifetime` | Rule 8 |
| `scope-malformed`, `scopes-too-many` | Rule 9 |
| `dpop-unsupported`, `binding` | Rule 10 |
| `inactive` | Introspection said `active: false` |
| `unavailable` | The key source or introspection endpoint could not answer; the request fails closed |

## M6. Scopes

This section amends the proposal's A4 and A5 as Umbel's D106 decided: static `scopes` stay the
default, a host resolver may decide per call, and a missing scope is a 403 decided before dispatch
wherever HTTP can answer it.

### What a call needs

**Static.** A command may declare `scopes`
([command metadata](./command-metadata.md#fields)), and the server may configure `requiredScopes`,
needed for any request. A call to a command needs `requiredScopes`, then the command's `scopes`,
without repeats. It is `Allowed` when the credentials hold each one exactly, else
`Missing(<those not held, in that order>)`. A static decision never defers.

**A resolver.** A host may install a `ScopeResolver`, which then decides every call instead of the
static rule (MCP: required scopes "may be determined dynamically based on the specific request
arguments"):

```text
ScopeResolver
    resolve(command, input, credentials) -> Allowed | Missing(scopes) | Defer
    visible(command, credentials) -> bool          // tools/list, afd-discover and the other listings
```

- `requiredScopes` still apply to every call: a call missing one is `Missing` with the required
  scopes not held first, then the resolver's, whatever the resolver answers, so `Defer` never lifts
  a missing required scope. `visible` likewise holds only with `requiredScopes`.
- `Missing(scopes)` names the scopes the call lacks, in the resolver's order. Any `Missing`
  refuses the call, even an empty one or one naming something that is not a scope token: such a
  name is the resolver's mistake, logged at `warn` without the call's input and never sent.
- `Defer` lets the call through, so the registry answers it. A host uses it when naming a scope
  would reveal something, for example a space the caller may not read (Umbel phase 5, section
  5.4).
- `input` is the call's arguments as sent before dispatch: the resolver runs before validation
  there. Because a default or a pipeline reference can supply a value the caller did not send,
  the resolver is asked again at execution on the validated input (below).

### Which commands a request names

- A command's own tool, a hybrid first-class tool, and a grouped tool's action: that command. A
  grouped action is resolved as the router would; a grouped call it cannot resolve (no action, or
  an unknown or ambiguous one) is decided as a tool that names no command, under the grouped tool's
  name, so it still needs `requiredScopes`; the router then answers it (`COMMAND_NOT_FOUND`,
  `AMBIGUOUS_ACTION` or `INVALID_GROUPED_CALL`).
- A command the request names that is unknown, or not exposed to MCP, has no `scopes` of its own,
  so a scope never reveals a command the caller cannot see
  ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)).
- `afd-call`: the command it names, with its `input`.
- `afd-batch` and `afd-pipe`: every step's command, with its input. A pipeline step's input is
  resolved with its references unresolved, as sent.
- A tool that names no command (`afd-discover`, `afd-detail`, `afd-help`, the context tools): the
  tool's own name, with its arguments. Under the static rule it needs `requiredScopes` only.
- `/rpc`, `/batch` and `/stream`: as `afd-call` and `afd-batch`.

### Before dispatch: the 403

The HTTP layer refuses a JSON-RPC batch (an array body) with 400 and a `-32600` error before
deciding anything: MCP has had no batches since 2025-06-18. It parses a request whose answer will be
the body of that request's own HTTP response: a `tools/call` on Streamable HTTP (it already caps the body), and the `/rpc`, `/batch`
and `/stream` routes. It asks for a decision on every command the request names. If **any** step
is `Missing`, the whole request is one 403 naming the missing scopes of every step, each once, in
step order. No step runs. Otherwise the request proceeds, and `Defer` steps are answered by the
registry.

A request the layer cannot decide this way, such as a call on the deprecated `/message` lane
(whose answer travels on another connection) or a body it cannot parse, is decided again after
routing.

### After routing: `INSUFFICIENT_SCOPE`

After the context hook and before the confirmation gate, the server repeats the decision for every
call that carries credentials. `Missing` fails the call with `INSUFFICIENT_SCOPE`
([error codes](./error-codes.md#authorization)), `retryable: false`,
`details.scopes` holding the missing scopes, and a suggestion to obtain a token that grants them.
A batch or pipeline fails as a whole before its first step, as a confirmation does. `Defer`
proceeds. So a missing scope never reaches a handler, whichever lane carried the call, and no
person is asked to confirm a call that cannot run.

### At execution: the resolver again

With a resolver, the registry decides again for every command it runs on a call that carries
credentials: each batch item, each pipeline step, and a nested in-process call that passes its
context on. It asks `resolve` with the **validated** input, defaults applied and pipeline
references resolved, after the required scopes, before any middleware or handler. `Missing` fails
that command with `INSUFFICIENT_SCOPE`. The decisions before dispatch stay the early answer that
lets a client step up; this one is the guarantee, so a rule keyed on an argument holds when the
caller leaves the argument to a default or draws it from a previous step. The static rule needs
no second decision, since it does not read the input.

### Listing

With `filterToolsByScope` (default off, A6), `tools/list`, `afd-discover`, `afd-detail`, `afd-help`,
`afd-docs`, `afd-schema` and a grouped tool's actions show only commands for which `visible` holds (under the static rule:
the credentials hold every scope the command needs). A grouped tool with no visible action is left
out. The meta-tools stay listed. A hidden command looks unknown on these surfaces, as an unexposed
one does ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)): no "did you mean"
suggestion on any route (a command's own tool, a grouped tool, a hybrid tool, `afd-call`,
`afd-batch`, `afd-pipe`) names it, and a grouped tool whose every action is hidden answers as a
tool that does not exist. Calls are still decided only by `resolve`.

A filtered list varies by authorization, which MCP allows (lists may vary by authorization, not by
connection). The `tools/list` result then carries `cacheScope: "private"`, in every tool strategy,
hybrid included; without filtering it stays `"public"` ([tool strategies](./tool-strategies.md#cache-hints-and-listchanged)).
The context hook does not run on `tools/list`, so filtering reads the credentials the HTTP layer
verified.

### Other methods

`tools/list`, `server/discover`, `resources/*` and `tasks/*` need a valid token and
`requiredScopes`. A `tasks/*` request is also checked against the task's owner
([tasks](./command-metadata.md#tasks)). A resource provider is given the caller's credentials
for `resources/list` and `resources/read`, so a host may list and read resources per caller (an
unreadable resource answers as an absent one).

## M7. Protected-resource metadata

RFC 9728 metadata is served without authentication, by `GET`, as `application/json`, at two URLs
built from the resource (RFC 9728 3.1): `/.well-known/oauth-protected-resource` inserted between
the host (with its port) and the path, and the same with no path. MCP clients try the first, then
the second. For `https://todo.example.com/mcp` they are
`https://todo.example.com/.well-known/oauth-protected-resource/mcp` and
`https://todo.example.com/.well-known/oauth-protected-resource`. A resource whose path is empty or
`/` has one URL. `resource_metadata` in a challenge is the first.

```json
{
  "resource": "https://todo.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["todo:read"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Todo (example)",
  "tls_client_certificate_bound_access_tokens": false
}
```

- `resource` is the resource exactly (RFC 9728 3.3: clients compare it with the URL they used).
- `authorization_servers` lists the issuers that issue access tokens, in configuration order (MCP:
  at least one).
- `scopes_supported` is what the server chooses to publish, and may be minimal: further scopes
  arrive by step-up through 403 challenges. With none configured it is left out.
- `bearer_methods_supported` is always `["header"]`.
- `resource_name` is present only when configured.
- `tls_client_certificate_bound_access_tokens` is `true` only when bound tokens are required
  (RFC 9728 2).
- Nothing else is published: no command, scope list beyond `scopes_supported`, or host detail.

## M8. The principal binding

A call's principal binding is the canonical JSON (the approval tokens' canonical JSON,
[command metadata](./command-metadata.md#approvals), rule 3) of:

```json
{ "actor": <actor>, "credentials": <identity> }
```

- `<actor>` is the actor's `kind`, `id` and `onBehalfOf` (never `label`), as approval tokens bind
  it, or `null` without an actor.
- `<identity>` is `{ "issuer", "subject", "clientId" }` from the credentials, or `null` without
  credentials.
- Credentials whose `issuer`, `subject` or `clientId` is missing or empty are never bound, since
  such a binding could not tell their holders apart, and are never taken as no credentials either.
  A call carrying them gets no confirmation or approval-relay state, and a retry carrying a state
  is refused, in each language as an internal error whose message names no one. Only a call with
  no credentials at all binds `null`.

Canonical JSON sorts the keys, so `{"actor":{"id":"a","kind":"agent"},"credentials":null}`.
Confirmation and approval-relay `requestState`
([confirmations](./command-metadata.md#confirmations)), relay evidence
([host-verified confirmation](./command-metadata.md#host-verified-confirmation)) and task owners
([tasks](./command-metadata.md#tasks)) bind it. Two calls share a binding only when their actor and
their token's issuer, subject and client are the same: a different client of the same person is a
different principal.

## Options

| Option | Meaning | Default |
| --- | --- | --- |
| `resource` | The resource ([Terms](#terms)) | Required |
| `authorizationServers` | The metadata's `authorization_servers` | Required, at least one |
| Verifier | A `TokenVerifier` (Rust: AFD's `JwtVerifier`, or the host's) with its issuers, their algorithm lists and key source, the clock skew, the maximum lifetime, the scope prefix and limit, and whether bound tokens are required | Required |
| `scopesSupported` | The metadata's `scopes_supported`, and the 401's `scope` | `[]` |
| `requiredScopes` | Scopes every request needs | `[]` |
| `resolver` | A `ScopeResolver` | None: the static rule |
| `filterToolsByScope` | List filtering ([M6](#listing)) | `false` |
| `resourceName` | The metadata's `resource_name` | None |

Rust spells them on `afd::server::auth` behind the `server-auth` feature (`BearerLayer`,
`ProtectedResource`, `JwtVerifier`, `KeySource`, `ScopeResolver`), as the Umbel specification's
section 3.3 gives.

## Conformance

[`authorization.json`](./authorization.json) pins the language-neutral parts: the `Authorization`
header and query rules, the challenges and bodies, the metadata URLs and document, the audience
comparison, the scope claim, the JWT header and key rules on decoded JSON, the claim rules after the
signature, the static scope decisions, the batch aggregation of decisions, the principal binding
and the relay input digest. It is written from this page, with each expected value computed by Node
from the rules as stated; no reference implementation exists yet, so no generator is committed.
Signatures, key fetching and introspection need keys and servers, so each language's own suite
covers them, one test per rule.

It sits beside [`vectors/`](./vectors/README.md), not in it, because `alfred parity` requires
every file in `vectors/` to be loaded by all four languages, and C++ has no HTTP server. It moves
to `vectors/` only if every language comes to load it.

The file's sections and what a loader checks:

- **`bearer`:** for the `authorization` header values (in order; `[]` for none), the request's
  `query` and a form-encoded `formBody` (each empty when missing), the result is `{ "token": … }` or
  `{ "refused": <rule code> }`.
- **`challenges`:** for the case, the `WWW-Authenticate` value is `header` and the body is `body`
  (compared as JSON).
- **`metadataUrls`:** the resource gives the URLs `urls`, the first being `resource_metadata`.
- **`metadataDocuments`:** the options give the document `expected` (compared as JSON).
- **`audience`:** with the resource, the `aud` claim value is accepted when `accepted` is `true`.
- **`scopeClaims`:** the `scope` claim (absent when the member is missing), with the limit and
  prefix, parses to `scopes` or is refused with `refused`.
- **`jwtHeaders`:** the decoded header, against the issuer's algorithm list, passes rule 2 or is
  refused with the first broken rule's code.
- **`keys`:** the decoded header and the issuer's key with that `kid` (`null` for none) pass
  rule 3 or are refused with `key`.
- **`claims`:** after rule 4, the decoded claims at `now`, with the top-level `config` and the
  case's `config` over it, become `credentials` or are refused with the first broken rule's code.
  `certificate` is the TLS client certificate's SHA-256 thumbprint (`null` for none).
- **`staticScopes`:** `requiredScopes`, the command's `scopes` and the token's scopes give the
  decision.
- **`batches`:** the steps' decisions give one 403 with `scope`, or `proceed`.
- **`principalBindings`:** the actor and credentials give `binding`, and the credentials alone give
  relay evidence's `credentialsBinding`, both compared as strings.
- **`inputDigests`:** the validated input gives its `canonical` JSON and the relay `inputDigest`.

## Implementation status

Rust serves MCP on Streamable HTTP and stdio only: it has no `/sse`, `/message`, `/rpc`, `/batch` or
`/stream` route, so its bearer layer decides `tools/call` bodies before dispatch and the server
decides every other call after routing. `tests/authorization_cases.rs` loads every case of
`authorization.json`; `tests/auth_verifier.rs` holds one test per rule of M3 with keys generated in
the test (RSA, EC P-256 and P-384, Ed25519), `tests/server_auth.rs` the layer end to end,
`tests/server_auth_hardening.rs` the fail-closed, refusal, execution-time and suggestion rules, and
`tests/auth_canary.rs` the token canary over every log line. Rust serves the layer and the service
together through `McpServer::authorized_http_service`.

The principal binding (M8) is implemented in all three languages with a confirmation gate (Umbel
phase 5 step 0c, [#532](https://github.com/lushly-dev/afd/issues/532)), and each loads the
`principalBindings` cases: Rust in `tests/authorization_cases.rs`, TypeScript in
`packages/server/src/principal-binding.test.ts`, Python in `python/tests/test_principal_binding.py`.
Rust loads the `inputDigests` cases through `afd::input_digest`, the digest its `HumanRelay` gets
and its approval middleware checks relay evidence with (step 0d).
Each binds it to confirmation state as integrity-protected input, never as readable identity:

- **Rust:** HMAC associated data of the `requestState`, after the context hook, with the verified
  credentials of an authorized server. Since Umbel phase 5 step 0d the same state carries the
  form-mode approval relay's answers, and relay evidence binds the credentials' identity
  (`credentials_binding`) beside the actor.
- **TypeScript:** the HMAC bind tag of the round's `requestState` (confirmation and approval-relay
  answers alike), with the actor the commands run with and the `credentials` that `createContext`
  sets. TypeScript does not verify tokens yet; its MCP authorization step fills `credentials`.
- **Python:** the SDK's sealed `requestState`, through `RequestStateSecurity(bind_principal=...)`,
  with the server's `actor` (Python has no per-request hook,
  [#800](https://github.com/lushly-dev/afd/issues/800)) and the access token the SDK verified. The
  SDK refuses a mismatch with `-32602` before any handler runs, as it refuses a tampered state.

Credentials with a missing or empty `issuer`, `subject` or `clientId` (a host's own credentials in
Rust and TypeScript, a token verifier's incomplete answer in Python) fail closed in all three: no
state is minted (`afd::IncompleteCredentials`; a `TypeError` in TypeScript;
`afd.server.IncompleteCredentials` in Python), and a retry carrying a state is refused with the
same internal error, before any state is verified.

A retry whose binding differs is refused as a tampered state is, in each language: TypeScript and
Rust ask again, Python answers `-32602`.

| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Bearer token, verification, audience, credentials (M1 to M4) | Planned | Planned | Yes (Umbel phase 5 step 0b; `server-auth`: `BearerLayer`, `JwtVerifier`, `KeySource`, `TokenVerifier`, `CommandContext::credentials`) | N/A: no HTTP server |
| 401 and 403, rule codes (M5) | Planned | Planned | Yes (step 0b) | N/A |
| Static scopes, the resolver, the 403 before dispatch, `INSUFFICIENT_SCOPE`, listing (M6) | Planned | Planned | Yes (step 0b; `ScopeResolver`, `Authorization::with_filter_tools_by_scope`) | N/A |
| Protected-resource metadata (M7) | Planned | Planned | Yes (step 0b; `ProtectedResource`) | N/A |
| The principal binding in confirmation state ([#532](https://github.com/lushly-dev/afd/issues/532), M8) | Yes (step 0c; `principalBinding`, with `createContext`'s `actor` and `credentials`; loads `principalBindings`) | Yes (step 0c; `afd.server.principal_binding`, with the SDK-verified token; loads `principalBindings`) | Yes (step 0c; `afd::principal_binding` in the gate's associated data; step 0d: the approval-relay state, `RelayCall::principal_binding` and relay evidence too) | N/A: no confirmation gate |
