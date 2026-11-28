# MCP authorization

Profile: `authorization`. This page belongs to the `authorization` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it can verify bearer tokens on HTTP (M1).

How an AFD server on HTTP acts as an OAuth 2.1 protected resource under MCP 2026-07-28: which
requests need a token, how a token is verified, what commands see of it, how scopes are decided per
call, and the 401 and 403 answers. It is opt-in: a server without it behaves as before.

Specified 2026-11-07 as step 0a of [Umbel phase 5](../endpoints/umbel/docs/phases/5-auth-hosted/spec.md)
(decision D106), from the [MCP Authorization proposal](../docs/features/complete/mcp-authorization/mcp-authorization.proposal.md),
whose decisions A4 and A5 it amends ([M6](#m6-scopes)). Rust implements it first (Umbel steps 0b
and 0c); TypeScript and Python follow, and already bind the principal (M8) in confirmation state
(step 0c). C++ has no HTTP server, so none of this applies to it.

**Sources.** MCP 2026-07-28 [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and its security considerations; RFC 6749 (OAuth 2.0) 3.3 and 6; RFC 6750 (bearer tokens) 2 and 3;
RFC 7515 (JWS) 4.1; RFC 7517 (JWK) 4; RFC 7518 (JWA) 3; RFC 7519 (JWT) 4.1; RFC 7636 (PKCE) 4;
RFC 7662 (introspection) 2.2; RFC 8037 (EdDSA in JOSE) 3.1; RFC 8252 (OAuth for native apps) 7.3;
RFC 8414 (authorization-server metadata) 3; RFC 8705 (mutual-TLS bound tokens) 3.1; RFC 8707
(resource indicators) 2; RFC 8725 (JWT best practices) 3.11; RFC 9068 (JWT access tokens) 2 and 4;
RFC 9110 (HTTP semantics) 11; RFC 9207 (authorization server issuer identification) 2; RFC 9449
(DPoP) 6.1; RFC 9728 (protected-resource metadata) 2, 3 and 5; OpenID Connect Discovery 1.0 4;
OAuth Client ID Metadata Document (MCP 2026-07-28 profile).

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

## The command's `scopes` field

`scopes` ([command metadata](./command-metadata.md#fields)) names the OAuth scopes a caller's token
needs to run the command over HTTP on a server configured with authorization. A call needs the server's `requiredScopes`
and then the command's `scopes`, compared exactly. A host `ScopeResolver`, when installed, decides
every call instead, from the command, its input and the credentials, and may answer `Defer` to let
the registry answer. A missing scope is an HTTP 403 before dispatch wherever HTTP can carry it, and
`INSUFFICIENT_SCOPE` otherwise, never a handler call ([M6](#m6-scopes)). stdio,
the CLI, `DirectClient` and in-process registries ignore `scopes`.

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
    known(command, credentials) -> bool            // whether the command exists for the caller; default: visible
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
- `visible` and `known` must be pure functions of the command and the credentials: the same
  answer for the same arguments, on every route and at any point of a request. `known` decides
  whether a command exists for the caller at all ([Hidden commands](#hidden-commands)); `resolve`
  still decides every call to a command that exists for it.

### Which commands a request names

- A command's own tool, a hybrid first-class tool, and a grouped tool's action: that command. A
  grouped call is resolved as the router resolves it: a call with an `action` is a grouped call on
  any tool name, and a call without one is a grouped call only when the tool's group has a member
  the caller is shown ([Listing](#listing)); otherwise it is a call of the command the tool names,
  which the router runs directly. A grouped call it cannot resolve to one command (no action, or
  an unknown or ambiguous action) runs nothing, so it is decided as a name that does not exist:
  on `requiredScopes` alone, with `resolve` never asked about the tool's name, which may be a
  hidden command's. The router then answers it (`COMMAND_NOT_FOUND`, `AMBIGUOUS_ACTION` or
  `INVALID_GROUPED_CALL`).
- A command the request names that does not exist for the caller (unknown, not exposed to MCP, or
  [hidden](#hidden-commands) from it) is decided on `requiredScopes` alone: it has no `scopes` of
  its own, and a resolver is never asked about it, so a scope never reveals a command the caller
  cannot see ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)).
- A command hidden from the caller ([Hidden commands](#hidden-commands)) is named exactly as a
  name that does not exist: a grouped action is resolved among the commands that exist for the
  caller, so one naming a hidden command is an unknown action, and a grouped tool whose every
  action is hidden is a tool that names a command that does not exist.
- `afd-call`: the command it names, with its `input`.
- `afd-batch` and `afd-pipe`: every step's command, with its input. A pipeline step's input is
  resolved with its references unresolved, as sent.
- A tool that names no command (`afd-discover`, `afd-detail`, `afd-help`, the context tools, and
  `afd-call`, `afd-batch` or `afd-pipe` without a command for every step): the tool's own name,
  with its arguments. Under the static rule it needs `requiredScopes` only. Its arguments are the
  caller's, as sent, and may name any command, hidden ones included (`afd-detail`'s `command`, a
  malformed batch's other steps): a resolver that decides such a tool must not decide on whether
  a command its input names exists.
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

**A host's own layer.** A host whose own HTTP layer admits credentials instead of the bearer
layer (a gateway that vouches for each caller, say) may run the same decision on each request it
admitted, after admitting the credentials for the server's own authorization and reading the
body. A language that offers this runs the bearer layer's own implementation, not a copy, so the
two cannot drift, and a request gets exactly the answer the bearer layer would give it after
admitting the same credentials:

- the same body cap (over it, 413) and the same JSON-RPC batch refusal (400, `-32600`);
- the same commands named, resolved as above, with a name that does not exist for the caller
  (unknown, unexposed or hidden) and a grouped call that resolves to no command decided on
  `requiredScopes` alone, so a hidden command still answers as a missing one;
- the same aggregation: any missing step is one 403 naming every missing scope of every step,
  each once, in step order, and nothing is passed on;
- the same body for that 403, with the host's suggestion when it names what its callers obtain
  instead of a token;
- a body that cannot be parsed, and every method but `POST`, passed on to be decided after
  routing; and, under the cap, a request without credentials admitted for the server's own
  authorization not decided at all, since the server refuses it (M1). A host reads the body
  under the same cap the bearer layer reads it under.

Only the 403's challenge may differ, when the host's callers authenticate by a scheme of its own
rather than `Bearer`: `<scheme> <param>="<value>", ..., error="insufficient_scope",
scope="<missing>"`, the host's scheme and parameters (a `realm`, say) first, `scope` under M5's
rules (scope tokens only, never sent empty), and no `resource_metadata`, since such a host
publishes no metadata for its scheme. The scheme is never `Bearer`: a `Bearer` 403 is M5's.
After routing and at execution, the decisions below stay as they are.

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
`afd-docs`, `afd-schema` and a grouped tool's actions show only commands for which `visible` and
`known` hold (under the static rule: the credentials hold every scope the command needs). A grouped
tool with no visible action is left out. The meta-tools stay listed, and `afd-help`'s
`firstClassTools` names only the first-class tools the caller's list shows. A command left off the
list looks unknown on these surfaces, as an unexposed one does
([D4](./error-codes.md#unknown-and-unexposed-commands-d4)): no "did you mean"
suggestion on any route (a command's own tool, a grouped tool, a hybrid tool, `afd-call`,
`afd-batch`, `afd-pipe`) names it, and a grouped tool whose every action is hidden answers as a
tool that does not exist. Calls to a command that exists for the caller are decided by `resolve`;
one that does not exist for it is unknown on every route ([Hidden commands](#hidden-commands)).

A filtered list varies by authorization, which MCP allows (lists may vary by authorization, not by
connection). The `tools/list` result then carries `cacheScope: "private"`, in every tool strategy,
hybrid included; without filtering it stays `"public"` ([tool strategies](./tool-strategies.md#cache-hints-and-listchanged)).
The context hook does not run on `tools/list`, so filtering reads the credentials the HTTP layer
verified.

### Hidden commands

With `filterToolsByScope` and a resolver, on a call that carries credentials, a command for which
`known(command, credentials)` is false does not exist for that caller. `known` defaults to
`visible`, so by default a command the caller cannot list does not exist for it either. The
command is unknown to the caller on every route: it is looked up as a name that does not exist,
before its input is validated and before any middleware, confirmation gate, approval relay,
host-verified relay, task creation or execution-time decision, none of which sees it. The answer
is byte-identical (code, message, suggestion, `details`, `data`, `_meta`, the HTTP status and
headers) to the answer the same route gives a name that does not exist, whatever the input: valid,
invalid or none.

| Route | The answer to a hidden command |
| --- | --- |
| A command's own tool, in every strategy (lazy and hybrid included), and a hybrid first-class tool | The unknown-tool answer: `COMMAND_NOT_FOUND` |
| `afd-call` | `COMMAND_NOT_FOUND`, with the same message and suggestion shape |
| A grouped tool's action | An unknown action. A grouped tool whose every action is hidden is a tool that does not exist, with or without an `action` |
| `afd-batch` and `afd-pipe` | The same per-step failure, the other steps running as they would. A confirmation never names it, and it never fails a batch or pipeline as host-verified or task-only |
| `afd-detail` | An entry with `found: false` and `COMMAND_NOT_FOUND`, as for a name that does not exist |
| Another command's `requires` | Left out |
| `tasks/*` on a task of it | The unknown-task answer |
| `tools/list`, `afd-discover`, `afd-help`, `afd-docs`, `afd-schema` | Absent, as [Listing](#listing) specifies |
| A nested in-process call that passes the call's context on | `COMMAND_NOT_FOUND`, as for a name that does not exist |

Before dispatch and after routing, a hidden command is decided as a name that does not exist
([Which commands a request names](#which-commands-a-request-names)): on `requiredScopes` alone,
with `resolve` never asked about it, so no resolver can answer it otherwise.

The server decides `visible` and `known` for every command once per request, as the request
arrives or when the request first needs them, and at the latest before the request is answered or
a task it creates starts; it uses that answer for the whole request: a task the request creates
runs its command with it, and its runner never asks again once the request is answered. A request
that needs neither, such as `/health`, may never ask. A host whose `known` reads
state it keeps only while a request is in flight is therefore asked only then.

A command's `requires` names only commands that exist for the caller, wherever it appears:
`_meta.requires`, a grouped action's entry in `_meta.actions`, `afd-detail`, `afd-help` and
`afd-docs`. A command that exists for the caller but is hidden from its listings may be named.

On a `tasks/*` request ([Other methods](#other-methods)), a task whose command no longer exists
for its owner answers exactly as a task that does not exist (`-32602`, "Task not found"), for
`tasks/get`, `tasks/update` and `tasks/cancel` alike.

A command for which `known` holds but `visible` does not is left off the listings and still decided
by `resolve`, so a host can let a caller step up: a call of it may be refused with a 403 naming the
scope it lacks. A host overrides `known` for that, and only for commands whose existence the caller
may learn. Without `filterToolsByScope`, a resolver or credentials (stdio, a trusted transport, the
CLI, `DirectClient`, in-process calls), nothing is hidden this way, and a caller who may see the
command keeps every check: validation, confirmation, relays, tasks and the middleware. Under the
static rule a command whose scopes the caller lacks is left off the listings and its call is
refused with a 403 naming them, as before.

The hidden path is the unknown name's path, so it does the same work: no timing tells them apart
beyond what the resolver's own `known` costs.

### Other methods

`tools/list`, `server/discover`, `resources/*` and `tasks/*` need a valid token and
`requiredScopes`. A `tasks/*` request is also checked against the task's owner
([tasks](./tasks.md)). A task whose command no longer exists for the owner
([hidden commands](#hidden-commands)) answers as a task that does not exist; `tasks/get` and
`tasks/update` on one that exists also need what the command needs, as far as it is known
without the input: its `scopes` under the static rule, `visible` and `known` under a resolver. A resource provider is given the caller's credentials
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
[approvals](./approvals.md), rule 3) of:

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
([confirmations](./confirmations.md)), relay evidence
([host-verified confirmation](./confirmations.md#host-verified-confirmation)) and task owners
([tasks](./tasks.md)) bind it. Two calls share a binding only when their actor and
their token's issuer, subject and client are the same: a different client of the same person is a
different principal. Over HTTP without credentials, every caller binds alike unless a hook maps
each to its own actor, so a server creates no task there unless the host declares that its hook
does ([tasks](./tasks.md)).

## M9. The OAuth client (CLI)

How an AFD CLI obtains, stores, refreshes and redacts OAuth 2.1 bearer tokens to reach a protected
MCP server under MCP 2026-07-28 ([#912](https://github.com/lushly-dev/afd/issues/912)). Applies to
every language that ships an AFD CLI (TypeScript and Python; Rust and C++ have no CLI).

### M9.1. Discovery

Discovery resolves the server's canonical resource URI, its RFC 9728 protected-resource metadata,
and its RFC 8414 (or OpenID Connect Discovery 1.0) authorization-server metadata before any
credential or redirect is sent.

- **Canonical resource URI.** Strip query and fragment from the MCP endpoint URL. For storage
  keying, normalize scheme and host to ASCII lowercase while keeping port and path exact (matching
  [M3.1](#m31-the-audience) comparison semantics).
- **Transport security.** Every resource, `resource_metadata`, `authorization_servers`,
  `authorization_endpoint`, `token_endpoint` and Client ID Metadata Document URL MUST use `https:`.
  The only exception is loopback `http:` (`127.0.0.1`, `[::1]`, `localhost`) when the target MCP
  server URL itself is loopback `http:` (for local development or testing). An `https:` server MUST
  NEVER downgrade any discovered endpoint or metadata URL to `http:`, including loopback.
- **HTTP hardening.** Metadata and token requests MUST NOT follow redirects (`redirect: "manual"`,
  refusing 3xx responses), MUST cap response size (256 KiB) and request time, and MUST send
  `Accept: application/json` and `Cache-Control: no-store`.
- **Protected-resource metadata (RFC 9728).** Unless a 401 `WWW-Authenticate` challenge was
  already obtained, send one unauthenticated Streamable HTTP probe (`POST` to the canonical
  resource URI with `Accept: application/json, text/event-stream`,
  `Content-Type: application/json`, `MCP-Protocol-Version: 2026-07-28`,
  `Mcp-Method: server/discover`, body `{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}`)
  to capture any authoritative 401 `WWW-Authenticate: Bearer` challenge (`resource_metadata` and
  `scope`). If a 401 `WWW-Authenticate: Bearer` challenge carries `resource_metadata`, verify that
  it is same-origin with the MCP server URL (scheme, host and port match) and meets the transport
  security rule, then fetch it first. Otherwise (or if the probe did not yield `resource_metadata`),
  probe [M7](#m7-protected-resource-metadata)'s two well-known URLs in order:
  `<origin>/.well-known/oauth-protected-resource<path>`, then
  `<origin>/.well-known/oauth-protected-resource` (one probe when path is empty or `/`). Validate
  that the returned JSON object's `resource` matches the MCP server's canonical resource URI under
  [M3.1](#m31-the-audience) equality and that `authorization_servers` is a non-empty array of valid
  issuer URLs. Select the first entry, or an explicit `--issuer` that appears in
  `authorization_servers`.
- **Authorization-server metadata (RFC 8414 and OIDC Discovery 1.0).** For an issuer
  `<origin><path>` (dropping a bare trailing `/`), probe in order:
  1. `<origin>/.well-known/oauth-authorization-server<path>`
  2. `<origin>/.well-known/openid-configuration<path>`
  3. `<origin><path>/.well-known/openid-configuration` (when `<path>` is non-empty)

  Validate the returned JSON object:
  - `issuer` MUST equal the selected authorization server string byte for byte (RFC 8414 3.3);
  - `authorization_endpoint` and `token_endpoint` MUST be valid absolute URLs meeting the transport
    security rule above, with no userinfo or fragment, no credential-like query parameters on
    `authorization_endpoint`, and no query on `token_endpoint`;
  - `code_challenge_methods_supported` MUST be an array containing `"S256"` (fail closed: PKCE S256
    is mandatory);
  - `response_types_supported`, when present, MUST contain `"code"`;
  - `grant_types_supported`, when present, MUST contain `"authorization_code"`.

### M9.2. Client registration

Two registration modes are supported; Dynamic Client Registration (RFC 7591) is not used (MCP
2026-07-28 deprecates it in favor of Client ID Metadata Documents):

1. **Client ID Metadata Document (CIMD).** A `client_id` that is an `https:` URL with at least one
   non-empty path segment (rejecting empty, `/`, and slash-only paths), no userinfo, no query, no
   fragment, no `.` or `..` path segments (literal or percent-encoded), and no encoded path
   separators (`%2f`/`%5c`) or malformed percent escapes. Syntactic validation follows the CIMD
   draft and does not impose a client-side ban on IP-literal hosts (SSRF fetch policy belongs to
   the authorization server). When the user supplies no `--client-id` and the authorization server
   advertises `client_id_metadata_document_supported: true`, the CLI uses its configured or default
   CIMD URL (`https://afd.dev/oauth/cli-client.json`, published in `site/oauth/cli-client.json` and
   overridable by `--client-id` or `AFD_OAUTH_CLIENT_ID`). CIMD clients are always public
   (`token_endpoint_auth_method: "none"`); combining a CIMD URL with a client secret is refused. If
   the server explicitly sets `client_id_metadata_document_supported: false`, a CIMD flow is
   refused with a suggestion to pass a pre-registered `--client-id`.
2. **Pre-registration.** The user supplies `--client-id <id>` (or `AFD_OAUTH_CLIENT_ID`). Public
   clients authenticate with `client_id` in the token request body (`none`). Confidential clients
   supply their secret only through `AFD_OAUTH_CLIENT_SECRET` or `--client-secret-file <path>` (an
   owner-only file; never a CLI flag value that would appear in process listings or shell history),
   and MUST bind that secret to an expected issuer via `--issuer <url>` or `AFD_OAUTH_ISSUER`
   matching the authorization server `issuer` byte for byte before login or refresh (so a resource
   changing authorization servers cannot cause the CLI to send a previous issuer's secret to a
   different server). At the token endpoint, confidential clients select `client_secret_basic`
   (RFC 6749 2.3.1, preferred when listed in `token_endpoint_auth_methods_supported` or when the
   field is absent) or `client_secret_post`, failing closed if the server supports neither.

### M9.3. Authorization code flow with PKCE (S256) and loopback redirect

- **Loopback callback (RFC 8252 7.3).** Bind an HTTP listener on `127.0.0.1` (IP literal, never
  `localhost`) on an ephemeral port (`0`, or an explicit `--redirect-port` for pre-registered
  clients that pin a port), accepting only `GET /callback`. `redirect_uri` is
  `http://127.0.0.1:<port>/callback`.
- **PKCE (S256) and CSRF state.** Generate a 32-byte cryptographically random `code_verifier`
  (43 unpadded base64url characters), compute `code_challenge = base64url(SHA-256(ASCII(verifier)))`
  with `code_challenge_method = "S256"`, and generate a 32-byte cryptographically random `state`.
- **Authorization request.** Build `authorization_endpoint` query parameters: `response_type=code`,
  `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`,
  `resource=<canonical resource>` (RFC 8707), and `scope` (from `--scope`, else challenge `scope`,
  else `scopes_supported`; append `offline_access` when supported and not disabled). Print the
  authorization URL and open the system browser unless `--no-browser` or non-interactive (stdin or
  stdout is not a TTY).
- **Callback verification.**
  - Compare `state` in constant time (`timingSafeEqual` over equal-length buffers). Requests with a
    missing or mismatched `state` receive HTTP 400 static HTML and are ignored (aborting after a
    small cap of invalid callbacks).
  - **Issuer check (RFC 9207) before outcome dispatch.** If
    `authorization_response_iss_parameter_supported` is `true` in AS metadata, `iss` MUST be
    present and equal `metadata.issuer` byte for byte before processing either `code` or `error`;
    if `iss` is present even when the metadata omits the flag, it MUST still equal
    `metadata.issuer`. Refusing on mismatch prevents mix-up attacks.
  - If `error` is present with matching `state` and valid `iss`, answer with static HTML and fail
    with a sanitized/redacted OAuth error code (unrecognized or secret-bearing values fall back to
    `unknown_error`).
  - Answer the browser with static HTML (`Content-Type: text/html; charset=utf-8`,
    `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'`,
    `X-Content-Type-Options: nosniff`) that echoes NO query parameters, wait for the response to
    flush, and close the loopback listener immediately before starting the token exchange.
- **Token exchange.** `POST` `application/x-www-form-urlencoded` to `token_endpoint` with
  `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `resource`, and client
  authentication. On non-200 responses, map/sanitize `error` to recognized OAuth error codes (never
  echoing arbitrary server strings or submitted secrets). Validate HTTP 200 JSON: `token_type` MUST
  be `Bearer` (ASCII case-insensitive; unsupported schemes such as `DPoP` are refused),
  `access_token` MUST match [M2](#m2-the-bearer-token)'s `b64token` grammar, `expires_in` (when
  present) MUST be a positive finite number, and `refresh_token` (when present) MUST be a non-empty
  string. `code_verifier`, `state`, and `code` remain in memory only and are never written to disk.

### M9.4. Token storage and refresh on expiry

- **Outside the config file.** Tokens MUST NOT be stored in the CLI config file (`config.json`).
  They are persisted in a separate token store file (`tokens.json` beside the CLI config directory)
  inside a versioned envelope, keyed by canonical resource URI so a token for one server is never
  sent to another. Stored entries whose `resource` does not match their key are ignored.
- **Exact resource binding on outgoing requests.** Automatic OAuth bearer attachment applies only
  to exact-resource Streamable HTTP MCP connections (`transport === "streamable-http"`). Derived
  routes (`afd stream` targeting `/stream/<command>`, or legacy `http`/`sse` transports probing
  `/health` or secondary message endpoints) refuse to send a stored OAuth token automatically and
  require an explicit `--header` / `AFD_HEADERS` override if trusted.
- **Owner-only permissions, descriptor checks and atomic writes.** Writes go to an exclusive
  sibling temporary file whose owner-only permissions (`0o600` on POSIX inside a `0o700`
  owner-owned directory; current user, `SYSTEM`, and `Administrators` ACL on Windows) are applied
  *before* writing token bytes, flushed, and atomically renamed into place. Reads enforce the
  private directory, open the file with `O_NOFOLLOW` where available and check ownership, regular
  file type and mode on the opened descriptor on POSIX (and verify the effective DACL via SDDL on
  Windows), failing closed with a remediation suggestion. Neither `client_secret` nor transient
  PKCE/auth-code state is persisted in the token store.
- **Cross-process serialization.** Store mutations and token refreshes serialize through an
  exclusive lockfile beside `tokens.json`; after acquiring the lock, refresh re-reads the store so
  a token already rotated by another process is reused rather than refreshed twice, and permanent
  error cleanup deletes an entry only if its stored `refreshToken` still matches the attempted one.
- **Precedence.** An explicit `Authorization` header supplied via `--header` or `AFD_HEADERS`
  always takes precedence over stored OAuth tokens.
- **Proactive and reactive refresh.** Before using a stored token, if `expiresAt` is within the
  expiry skew buffer (30 seconds) or already elapsed:
  - with a `refreshToken`, `POST` `grant_type=refresh_token` with `refresh_token`, `resource` and
    client authentication (requiring `--issuer` / `AFD_OAUTH_ISSUER` match for confidential
    clients) to the stored `tokenEndpoint`, validate the response under M9.3, persist the rotated
    `refresh_token` (or keep the existing one when the server omits it, RFC 6749 6), and use the
    fresh `access_token`;
  - if refresh fails with `invalid_grant`, `invalid_client` or `unauthorized_client`, delete the
    invalid entry (only if its `refreshToken` still matches) and fail with a suggestion to
    re-authenticate;
  - if expired without a `refreshToken` (including mid-session in `afd shell`), refuse to send the
    expired token and suggest running `afd auth login <url>`.
  When an OAuth-backed connection receives a real transport HTTP 401 (never an application tool
  result carrying error code `HTTP_401`) and holds a `refreshToken`, the CLI refreshes at most once
  and retries; a second 401 fails without looping.

### M9.5. Redaction

- URLs printed or logged redact userinfo and credential query/fragment parameters, including OAuth
  `code`, `code_verifier`, `access_token`, `refresh_token`, `id_token` and `client_secret`.
  Persisted connection URLs (`afd connect`, `afd shell`) strip OAuth query/fragment credentials so
  they never reach `config.json`.
- Headers printed or logged redact sensitive headers (`Authorization`, `Proxy-Authorization`,
  `Cookie`, `Set-Cookie`, and any header whose name matches `token`, `secret`, `auth`, `key`,
  `cookie` or `credential`, case-insensitively) to `[redacted]`.
- Raw access tokens, refresh tokens, authorization codes, PKCE verifiers and client secrets never
  appear in stdout, stderr, error messages, debug output or `config.json`.

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
section 3.3 gives. A host's own layer runs the decision before dispatch through
`McpServer::pre_dispatch_check` (`PreDispatchCheck::decide`, with `ScopeChallenge` for its own
scheme and `ProtectedResource::with_scope_source` for its suggestion).

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

[`authorization-client.json`](./authorization-client.json) pins the language-neutral client parts
of [M9](#m9-the-oauth-client-cli): `WWW-Authenticate` challenge parsing (`wwwAuthenticate`),
RFC 9728 protected-resource metadata URLs (`protectedResourceMetadataUrls`), RFC 8414 and OIDC
Discovery authorization-server metadata URLs (`authorizationServerMetadataUrls`), RFC 7636 PKCE
S256 challenges (`pkceS256`), Client ID Metadata Document URL checks (`clientIdMetadataDocuments`),
canonical resource and same-origin metadata validation (`resourceValidation`), and URL/header
redaction (`redaction`). It sits beside `authorization.json` so server-only implementations without
a CLI (such as Rust) keep loading every server section unchanged.

## Implementation status

Rust serves MCP on Streamable HTTP and stdio only: it has no `/sse`, `/message`, `/rpc`, `/batch` or
`/stream` route, so its bearer layer decides `tools/call` bodies before dispatch and the server
decides every other call after routing. `tests/authorization_cases.rs` loads every case of
`authorization.json`; `tests/auth_verifier.rs` holds one test per rule of M3 with keys generated in
the test (RSA, EC P-256 and P-384, Ed25519), `tests/server_auth.rs` the layer end to end,
`tests/server_auth_hardening.rs` the fail-closed, refusal, execution-time and suggestion rules,
`tests/server_auth_hidden.rs` the hidden commands, each answer compared with a twin server's
for a name it does not have, `tests/server_auth_pre_dispatch.rs` a host's own layer running the
decision before dispatch, each answer compared byte for byte with the bearer layer's, and
`tests/auth_canary.rs` the token canary over every log line. Rust serves the layer and the service
together through `McpServer::authorized_http_service`. Its keys come from a `KeySource`:
`StaticKeys` for a fixed JWKS, or `JwksKeySource` over the host's `JwksLoader`, which applies
`jwksKeySource`'s maximum age, maximum staleness, unknown-`kid` refetch interval and shared load
to each issuer's keys (`tests/auth_jwks.rs`, on a manual clock).

TypeScript verifies (Loam phase 3 step 0a) on every HTTP route of `createMcpHandler({ auth })`
and `createMcpServer({ auth })`: `/mcp`, the deprecated `/sse` and `/message` lane, `/rpc`,
`/batch`, `/stream` and AFD's own `/health`, so only the metadata and CORS preflights are public.
`JwtVerifier` applies every rule of M3 in its own code, with `jose` 6 checking the signature only,
through WebCrypto; keys come from a `KeySource` (`jwksKeySource` over a host's JWKS loader), and
`createIntrospectionVerifier` checks opaque tokens through a host's RFC 7662 call. The verified
`credentials` are frozen and branded for `isVerifiedCredentials` until the request ends;
`createContext(req, { credentials })` maps them to the actor. An HTTP session (`Mcp-Session-Id`)
belongs to the credentials' issuer, subject and client that created it (`credentialsBinding`), so
another caller's use of it is answered as an unknown session's, and only the same subject's
`initialize` can displace it. One issuer and subject, across its clients, holds at most
`maxSessionsPerOwner` sessions (default 100), and at that quota or the session cap its least
recently used session is evicted; a subject with none is refused while the store is full (HTTP 503
with `Retry-After`, and JSON-RPC `-32000` carrying the request's `id` and
`data.code: "SESSION_LIMIT_REACHED"`) rather than another's evicted. `packages/server/src/authorization-cases.test.ts`
loads the `bearer`, `challenges`, `metadataUrls`, `metadataDocuments`, `audience`, `scopeClaims`,
`jwtHeaders`, `keys` and `claims` cases; `mcp-auth-verifier.test.ts` holds one test per rule of M3
with keys generated in the test (RSA, EC P-256 and P-384, Ed25519) by a test authorization server
serving the JWKS and introspection over loopback HTTP; `mcp-auth.test.ts` the layer end to end,
the token never on a context, in `createContext`'s request or in the journal, and the brand.
TypeScript enforces scopes (Loam phase 3 step 0c): a command's `scopes`, `requiredScopes`, a
`ScopeResolver` and `filterToolsByScope`. The bearer layer decides a `POST` body before dispatch on
`/mcp`, `/message` (whose answer is the body of its own response in TypeScript), `/rpc`, `/batch` and
`/stream`; the routes and the router decide again after routing, before the confirmation gate; and
with a resolver the remote engine decides every command again on its validated input, as its first
middleware. Each admitted request gets a scope view, decided once when first asked, which the routes,
the router, the engine and the listings read from the command context. A host's own layer admits
the callers it vouches for with `handler.admit` and runs the bearer layer's own decision with
`handler.preDispatchCheck`. `mcp-auth-scopes.test.ts` loads the `staticScopes` and `batches` cases
and covers every route, the resolver's two phases, listing, and hidden commands, each answer
compared with a twin server's for a name it does not have; `mcp-auth-host.test.ts` the host's own
layer, each answer compared with the bearer layer's and with the `challenges` 403. TypeScript also
enforces task owners, M6 command scopes, hidden commands and `TASK_TOKEN_EXPIRED` on `tasks/*`
([#1971](https://github.com/lushly-dev/afd/issues/1971), `packages/server/src/tasks.test.ts`),
and forwards verified credentials to `ResourceProvider.list`/`read` via `ResourceCaller` on
Streamable HTTP (both eras) and host-admitted requests, returning `-32602` (`Resource not found`)
identically for unreadable and absent URIs and emitting `cacheScope: "private"` on modern-era
`resources/list` and provider-backed `resources/read` while keeping static `SkillCatalog` reads
`"public"` ([#2265](https://github.com/lushly-dev/afd/issues/2265), `mcp-auth-resources.test.ts`).

The principal binding (M8) is implemented in all three HTTP-capable languages (Umbel
phase 5 step 0c, [#532](https://github.com/lushly-dev/afd/issues/532)), and each loads the
`principalBindings` cases: Rust in `tests/authorization_cases.rs`, TypeScript in
`packages/server/src/principal-binding.test.ts`, Python in `python/tests/test_principal_binding.py`
(C++'s `afd::mcp_stdio` signs confirmation `requestState` with HMAC bound to command, input and
actor; stdio carries no HTTP credentials).
Rust (`afd::input_digest`, step 0d), TypeScript (`inputDigest`, [#2263](https://github.com/lushly-dev/afd/issues/2263),
`packages/server/src/authorization-cases.test.ts`) and Python (`afd.server.input_digest`,
[#2264](https://github.com/lushly-dev/afd/issues/2264), `python/tests/test_authorization_cases.py`)
load the `inputDigests` cases, the digest their `HumanRelay` gets and their approval middleware
checks relay evidence with. Rust's task owners are the same
binding (step 0e, `tests/server_tasks.rs`): a `tasks/*` request from another actor, issuer, subject
or client gets the unknown-task answer, byte for byte.
Each binds it to confirmation state as integrity-protected input, never as readable identity:

- **Rust:** HMAC associated data of the `requestState`, after the context hook, with the verified
  credentials of an authorized server. Since Umbel phase 5 step 0d the same state carries the
  form-mode approval relay's answers, and relay evidence binds the credentials' identity
  (`credentials_binding`) beside the actor.
- **TypeScript:** the HMAC bind tag of the round's `requestState` (confirmation and approval-relay
  answers alike), with the actor the commands run with and the `credentials` that `createContext`
  sets, which on a server with `auth` are the verified credentials (Loam phase 3 step 0a).
- **Python:** the SDK's sealed `requestState`, through `RequestStateSecurity(bind_principal=...)`,
  with the call's `actor` (from `create_server(context_hook=...)`, [#800](https://github.com/lushly-dev/afd/issues/800),
  the verified credentials' default actor, or the server's default `actor`) and the verified
  credentials (from AFD's `auth` layer when configured, [#2154](https://github.com/lushly-dev/afd/issues/2154),
  else the access token the SDK verified). The SDK refuses a mismatch with `-32602` before any
  handler runs, as it refuses a tampered state.

Python verifies ([#2154](https://github.com/lushly-dev/afd/issues/2154)) on every HTTP ASGI
transport of `create_server(..., auth=McpAuthOptions(...))` (`streamable_http_app`, `sse_app`, and
HTTP/SSE `run`/`run_async`), serving RFC 9728 metadata publicly and failing closed (M1) on
unadmitted transports (stdio and `server.trusted_transport()` remain unaffected). `JwtVerifier`
applies every M3 rule in AFD code, using `cryptography` for signatures only (RSA, EC P-256/P-384,
Ed25519), with `KeySource`, `jwks_key_source` and `create_introspection_verifier`. Verified
`CommandContext.credentials` are frozen, redact every field but `issuer` and `expires_at` in
`repr`/`str`, and carry an identity-keyed brand for `is_verified_credentials` until the request
(or background MCP task) ends. Python enforces scopes ([#2155](https://github.com/lushly-dev/afd/issues/2155)):
command `scopes`, `required_scopes`, `ScopeResolver` (`resolve`, `visible`, `known`), `ScopeChallenge`
and `filter_tools_by_scope`. The ASGI bearer layer decides `POST` JSON-RPC bodies on Streamable HTTP
before dispatch (refusing JSON-RPC batches with 400 `-32600` and oversized bodies with 413), enforces
`required_scopes` on non-POST requests including `GET /sse`, decides again after routing before
confirmations (`INSUFFICIENT_SCOPE`), and re-checks a resolver on validated input at execution
(defaults, pipeline references, nested calls and background tasks). Each admitted request gets a
`ScopeView` decided once on arrival; filtered listings (`tools/list` with `cacheScope: "private"`,
`afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema`, grouped actions) omit unshown
commands, strip hidden commands from `requires`, and answer hidden commands identically to unknown
names across every route and `tasks/*`. Hosts with their own HTTP layer admit callers through
`server.admit` and run the bearer layer's pre-dispatch decision through `server.pre_dispatch_check`,
and `resources/list` and `resources/read` forward verified credentials to `ResourceProvider.list`/`read`
via `ResourceCaller` on Streamable HTTP (both eras), SSE and host-admitted requests, returning
`-32602` (`Resource not found`) identically for unreadable and absent URIs and emitting
`cacheScope: "private"` on modern-era `resources/list` and provider-backed `resources/read` while
keeping static `SkillCatalog` reads `"public"` ([#2266](https://github.com/lushly-dev/afd/issues/2266)).
`python/tests/test_authorization_cases.py` loads all twelve verification, scope and `inputDigests`
sections of `spec/authorization.json` (with `test_principal_binding.py` loading `principalBindings`
for all 13/13 sections); `test_human_relay.py` covers host-verified confirmation, `HumanRelay` and
private relay evidence; `test_auth_verifier.py` covers every M3 rule with signed tokens;
`test_mcp_auth.py` covers the HTTP bearer layer, header stripping, journal redaction, fail-closed
M1, confirmation binding and MCP Tasks; `test_mcp_auth_scopes.py` covers M6 scopes, two-phase
resolver checks, filtered listings, twin-server hidden-command parity, host admission and `tasks/*`;
`test_mcp_auth_resources.py` covers per-caller `ResourceProvider` filtering, `-32602` parity,
`cacheScope: "private"` vs `"public"`, SSE and host-admitted resource requests.

Credentials with a missing or empty `issuer`, `subject` or `clientId` (a host's own credentials in
Rust and TypeScript, a token verifier's incomplete answer in Python) fail closed in all three: no
state is minted (`afd::IncompleteCredentials`; a `TypeError` in TypeScript;
`afd.server.IncompleteCredentials` in Python), and a retry carrying a state is refused with the
same internal error, before any state is verified.

A retry whose binding differs is refused as a tampered state is, in each language: TypeScript and
Rust ask again, Python answers `-32602`.

The CLI OAuth 2.1 client ([M9](#m9-the-oauth-client-cli)) is implemented in TypeScript
(`@lushly-dev/afd-cli`, [#912](https://github.com/lushly-dev/afd/issues/912)): `afd auth login`,
`afd auth status`, `afd auth logout` and `afd auth refresh`, plus transparent token attachment and
expiry refresh across Streamable HTTP `connect`, `status`, `tools`, `call`, `batch`, `validate`,
`shell` and `scenario run`. `packages/cli/src/oauth-cases.test.ts` loads every section of
[`authorization-client.json`](./authorization-client.json); `oauth.test.ts` and `token-store.test.ts`
cover discovery, transport security, CIMD and pre-registration, PKCE/state/RFC 9207 `iss`
validation, owner-only token storage outside `config.json`, refresh rotation and redaction; and
`oauth.e2e.test.ts` runs the built CLI against an auth-protected AFD MCP server
(`createMcpHandler({ auth })`) and loopback OAuth 2.1 authorization server with a zero-leak secret
canary. Python CLI parity is tracked in [#2491](https://github.com/lushly-dev/afd/issues/2491). Rust
and C++ have no CLI.

<!-- generated:capabilities:spec.authorization.status:start -->
| Rule | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| Bearer token, verification, audience, credentials (M1 to M4) | Yes (Loam phase 3 step 0a; `createMcpHandler({ auth })`, `JwtVerifier` on `jose`, `KeySource`, `jwksKeySource`, `createIntrospectionVerifier`, `TokenVerifier`, `context.credentials`) | Yes ([#2154](https://github.com/lushly-dev/afd/issues/2154); `create_server(auth=McpAuthOptions(...))`, `JwtVerifier` on `cryptography`, `KeySource`, `jwks_key_source`, `create_introspection_verifier`, `TokenVerifier`, `context.credentials`, `is_verified_credentials`) | Yes (Umbel phase 5 step 0b; `server-auth`: `BearerLayer`, `JwtVerifier`, `KeySource`, `StaticKeys`, `JwksKeySource`, `TokenVerifier`, `CommandContext::credentials`) | N/A: no HTTP server |
| 401 and 403, rule codes (M5) | Yes (step 0a; 401 and 403 challenges and bodies; rule codes to `auth.onRefusal`) | Yes ([#2154](https://github.com/lushly-dev/afd/issues/2154), [#2155](https://github.com/lushly-dev/afd/issues/2155); 401 and 403 sent; rule codes to `auth.on_refusal`) | Yes (step 0b) | N/A |
| Static scopes, the resolver, the 403 before dispatch, `INSUFFICIENT_SCOPE`, listing (M6) | Yes (Loam phase 3 step 0c, #2265; `scopes`, `requiredScopes`, `ScopeResolver`, `filterToolsByScope`, `staticDecision`, `requestDecision`, per-caller `ResourceProvider`) | Yes ([#2155](https://github.com/lushly-dev/afd/issues/2155), [#2266](https://github.com/lushly-dev/afd/issues/2266); `scopes`, `required_scopes`, `ScopeResolver`, `filter_tools_by_scope`, `static_decision`, `request_decision`, per-caller `ResourceProvider`) | Yes (step 0b; `ScopeResolver`, `Authorization::with_filter_tools_by_scope`) | N/A |
| [A host's own layer](#before-dispatch-the-403) running the decision before dispatch (M6) | Yes (step 0c; `handler.admit`, `handler.preDispatchCheck`, `ScopeChallenge`; `mcp-auth-host.test.ts`) | Yes ([#2155](https://github.com/lushly-dev/afd/issues/2155); `server.admit`, `server.pre_dispatch_check`, `PreDispatchCheck`, `ScopeChallenge`; `test_mcp_auth_scopes.py`) | Yes (`McpServer::pre_dispatch_check`, `PreDispatchCheck`, `ScopeChallenge`; `tests/server_auth_pre_dispatch.rs`) | N/A |
| [Hidden commands](#hidden-commands) (M6): unknown on every route before validation, `resolve` never asked about them, decided once per request, `requires` filtered, `tasks/*` | Yes (step 0c + #1971; `ScopeResolver.known`, including `tasks/*`; `mcp-auth-scopes.test.ts`, `tasks.test.ts`) | Yes ([#2155](https://github.com/lushly-dev/afd/issues/2155); `ScopeResolver.known`, `tasks/*` included; `test_mcp_auth_scopes.py`) | Yes (`ScopeResolver::known`; `tests/server_auth_hidden.rs`) | N/A |
| Protected-resource metadata (M7) | Yes (step 0a; `createProtectedResource`) | Yes ([#2154](https://github.com/lushly-dev/afd/issues/2154); `create_protected_resource`, `ProtectedResource`) | Yes (step 0b; `ProtectedResource`) | N/A |
| The principal binding in confirmation state ([#532](https://github.com/lushly-dev/afd/issues/532), M8) | Yes (step 0c; `principalBinding`, with `createContext`'s `actor` and `credentials`; loads `principalBindings`) | Yes (step 0c, [#800](https://github.com/lushly-dev/afd/issues/800), [#2154](https://github.com/lushly-dev/afd/issues/2154); `afd.server.principal_binding`, with AFD's verified credentials or the SDK token; loads `principalBindings`) | Yes (step 0c; `afd::principal_binding` in the gate's associated data; step 0d: the approval-relay state, `RelayCall::principal_binding` and relay evidence too) | Partial: `afd::mcp_stdio` binds `requestState` to command, input and actor; stdio carries no HTTP credentials |
| `tasks/*` and task owners ([M6, other methods](#other-methods); M8; [tasks](./tasks.md)) | Yes ([#1971](https://github.com/lushly-dev/afd/issues/1971)): `tasks/get`, `tasks/update` and `tasks/cancel` fail closed, bind verified credentials as owner, enforce M6 command scopes and hidden commands, preserve verified credentials inside running tasks, and stop at `credentials.expiresAt` (`TASK_TOKEN_EXPIRED`); `tasks.test.ts` | Yes ([#1972](https://github.com/lushly-dev/afd/issues/1972), [#2154](https://github.com/lushly-dev/afd/issues/2154), [#2155](https://github.com/lushly-dev/afd/issues/2155)): `tasks/*` fail closed, require `required_scopes`, bind AFD verified credentials as owner, stop at `credentials.expires_at`, preserve cloned verified credentials and `ScopeView`, enforce command scopes and hidden commands on `tasks/get` and `tasks/update` (not `tasks/cancel`) | Yes (Umbel phase 5 step 0e): `tasks/get`, `tasks/update` and `tasks/cancel` fail closed, need required scopes and run the context hook; owner is principal binding, checked by `TaskStore` and server; owner must still hold command `scopes` (`visible`/`known`); stops at `credentials.expiresAt` | N/A: not planned for C++ |
| CLI OAuth 2.1 client ([M9](#m9-the-oauth-client-cli)): PKCE S256 loopback flow, RFC 9728/8414 discovery, CIMD and pre-registration, separate owner-only token store with expiry refresh, and URL/header redaction ([#912](https://github.com/lushly-dev/afd/issues/912)) | Yes ([#912](https://github.com/lushly-dev/afd/issues/912)): `afd auth` (`login`, `status`, `refresh`, `logout`), RFC 9728/8414 discovery, CIMD and pre-registration, PKCE S256 loopback flow, separate `tokens.json` with refresh rotation and URL/header redaction; loads `spec/authorization-client.json` | Planned ([#2491](https://github.com/lushly-dev/afd/issues/2491)): OAuth 2.1 CLI client (`spec/authorization.md`, M9) | N/A: no Rust CLI | N/A: no C++ CLI |
<!-- generated:capabilities:spec.authorization.status:end -->
