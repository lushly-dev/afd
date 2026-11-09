# umbel-testkit-idp

**Test-only.** A credential-free identity provider, authorization server, gateway signer and
certificate authority for Umbel's auth tests (phase 5 specification, sections 1 and 14, step 1b).
Use it from `[dev-dependencies]` only. Umbel is never an authorization server (A7, D107), and the
host's `tests/no_auth_server.rs` fails if a shipped crate can reach this one.

- It binds `127.0.0.1` on ephemeral ports (HTTPS, and a plain-HTTP listener that serves only
  the metadata and JWKS), never another address.
- It makes every key and certificate in memory when it starts, and writes nothing to disk.
- Its users' passwords are fixed test strings.
- It is `publish = false`, quarantined in the release inventory with no route, and has no binary.

```rust
let kit = umbel_testkit_idp::TestIdp::start().await?;
let resource = "https://127.0.0.1:8443/mcp";
let token = kit
    .authorization_server()
    .access_token(resource)
    .subject("ada")
    .scopes(["umbel:read"])
    .sign();
let refused = kit
    .authorization_server()
    .access_token(resource)
    .break_rule(umbel_testkit_idp::Break::MultipleAudiences)
    .sign();
// Trust kit.ca().certificate_pem() to reach kit.authorization_server().metadata_urls().oauth.
```

## Roles

All three roles share one HTTPS listener and its test CA (`TestIdp::ca`). The CA issues server
certificates and client certificates for mTLS and RFC 8705 `x5t#S256`.

### Identity provider (`<base>/idp`)

- **Discovery.** OpenID Connect discovery and RFC 8414 metadata, served at the path-inserted
  `/.well-known/oauth-authorization-server/idp` and `/.well-known/openid-configuration/idp`, and at
  the appended `/idp/.well-known/openid-configuration`.
- **Keys.** A JWKS at `/idp/jwks`.
- **Login.** An authorization endpoint with a scripted login (`ScriptedLogin`, `LoginScript`), or
  a password form for the synthetic users `ada`, `bo` and `cy`.
- **Tokens.** A token endpoint that redeems a code with PKCE `S256` for an ID token. The ID token
  carries `nonce`, `auth_time`, `acr`, `amr` and `groups`.
- **Token exchange.** RFC 8693, from an ID token to an ID-JAG
  (draft-ietf-oauth-identity-assertion-authz-grant).

### Authorization server (`<base>/as`)

- **Metadata and keys.** The same metadata locations and a JWKS.
- **Grants.** The authorization code grant with PKCE, client credentials, and the RFC 7523 JWT
  bearer grant that redeems an ID-JAG.
- **Access tokens.** RFC 9068 tokens for one audience (RFC 8707), certificate-bound when the
  client is registered so.
- **Introspection.** RFC 7662, with client authentication.

### Gateway signer

- **Assertions.** It signs the per-request `Umbel-Gateway-Assertion` of section 4.4 (`typ`
  `umbel-gw+jwt`).
- **Pinning.** It offers a key set to pin and a client certificate.

## Negative tests

- **Token breaks.** `TokenBuilder::break_rule` breaks exactly one rule of section 3.2.
  `Break::rule` names the rule code AFD's `JwtVerifier` refuses the token with.
- **Introspection answers.** `IntrospectionAnswer` scripts the introspection response.
- **Endpoint faults.** A `Fault` makes an endpoint misbehave: a status, a redirect that must not
  be followed, a delay, an oversized body or a malformed body.
- **Metadata and keys.** `Issuer::set_metadata_patch` patches the metadata (for example, an
  `issuer` that does not match). The key set rotates, retires keys or serves an override.

Signing keys come in every kind AFD verifies: RSA, EC P-256 and P-384, and Ed25519.

- **Recorded requests.** `Issuer::authorization_requests` returns every authorization request the
  kit received, so a test can assert what a relying party asked for.
- **A plain listener.** `TestIdp::plain_base_url` serves the metadata and JWKS over plain HTTP and
  counts each fetch (`Issuer::plain_hits`), so a test proves a client refused an `http` URL rather
  than failing to reach it.
- **Shared login queue.** Login scripts are consumed in order by whichever authorization request
  arrives first. With several processes behind one URL, queue a script just before the request it
  is for.

The kit runs on a thread and Tokio runtime of its own, so a test that blocks its runtime cannot
stall it.

The crate's own suite (`cargo test -p umbel-testkit-idp`) exercises every role and every hook end
to end. It verifies the kit's access tokens with AFD's `JwtVerifier` and `check_introspection`.
