# Host specification: sign-in rules chosen by the deployer, with provider presets

| Field | Value |
| --- | --- |
| Serves | A deployer of an Umbel instance chooses its sign-in provider. Today a hosted Umbel accepts only providers that issue RFC 9068 access tokens and report OpenID Connect EAP `acr` values. This lets the deployer describe the provider's tokens and say which login evidence proves a person, with named presets for Better Auth and Microsoft Entra ID |
| Owner | Repository owner approves; the phase 5 owning agent writes and implements |
| Read first | [STATUS.md](../../STATUS.md), the [phase 5 specification](spec.md) (sections 2.2, 3.1 to 3.3, 6.1, 7.1, 7.2), [`spec/authorization.md`](../../../../../spec/authorization.md) (M3, M3.1, M3.2, M4, M5, M7), the [MCP Authorization proposal](../../../../../docs/features/active/mcp-authorization/mcp-authorization.proposal.md), the [review host specification](../../plugins/ideas/host-review.spec.md) (sections 6.4 and 6.5, and its H1 amendments), [language parity](../../../../../docs/language-parity.md) (rows "MCP authorization"), and the [decision log](../../decisions.md) (D106, D108, D115, D180, D181, and D182 to D188, made here) |
| Elevation | Exact names, shapes, defaults, codes, files, tests and pull requests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

Code paths are relative to `endpoints/umbel/` unless they start with `packages/` or `spec/`.

## Status

- **State:** written 2026-11-12. **The principle is the owner's decision of 2026-11-12 (D182).** Every shape below
  (D183 to D188) is **decided under his direction of 2026-11-12; he has not read this specification.** Each stays open
  to him. Nothing is implemented.
- **Last verified:** 2026-11-12 against `origin/main` at `b25d2870`, by reading the files cited at each claim. The
  provider facts come from two read-only research notes of the same day: an Entra fit study (Microsoft's public
  documentation and `curl` against public tenant metadata) and a Better Auth fit study (the published 1.7.22 and
  1.8.0-beta.9 packages). Facts not confirmed against a real Entra tenant are listed in section 9. **No code was built
  or run.**
- **Not done:** everything (section 11). **Follow-ups:** the [table at the end](#follow-ups).

## What this specification serves

The owner, 2026-11-12: "we should not require specific auth rules... That should be up to the person who makes the
final MCP." And: "If I go make an instance of Umbel..., I should be able to define the auth layer.
Maybe we offer better auth as a default. But I think they should be able to use what they want."

Today the rules are fixed in two places:
- **AFD's verifier.** `typ` must be `at+jwt` (`packages/rust/src/server/auth/claims.rs:202-209`;
  `packages/server/src/mcp-auth-rules.ts:227`, `:238`). `aud` must equal the resource (`claims.rs:337`;
  `resource.rs:93-102`). `jti` and `client_id` are required under those names (`claims.rs:345-349`). Scopes come only
  from `scope` (`claims.rs:378-382`; `mcp-auth-rules.ts:370`).
- **Umbel's person page.** Every login asks for `scope=openid` only (`src/person/oidc.rs:560`). The ID token must carry
  `acr` from `acr_values` and an `amr` method from `uv_amr` (`oidc.rs:746-772`), where `uv_amr` may name only RFC 8176's
  six methods, or `mfa` under `phr` or `phrh` (`src/auth/mod.rs:56-110`; D115, D181). `auth.person` fails when the
  provider's `claims_supported` lacks `acr` or `amr` (`oidc.rs:112-124`). Scopes are published as bare
  `<prefix>:<verb>` (`src/surfaces/http.rs:387`).

An Entra deployment breaks each of these: its access tokens are typed `JWT`, carry a GUID audience, `uti`, `azp` and
`scp`; its passkey `amr` is `fido` and `mfa`; it reports no `phr`; its discovery omits `amr` from `claims_supported`.

| Rule | How this serves it |
| --- | --- |
| Defaults stay strict | Every new setting defaults to today's rule. A file that sets none of them behaves exactly as today |
| Loosening is explicit | A deployer loosens only by naming a setting or a preset. Nothing widens by detection |
| The doctor says what is lost | Each loosened rule warns, naming what Umbel can no longer check |
| Records tell strong from weak | Every person decision records the rule and the evidence that proved it, and a login proven by the deployer's own rule has its own level |

## 1. Where each part belongs (D183)

**One specification, here, with an AFD part (section 2) and an Umbel part (sections 3 to 8).**

- **AFD's part** changes the language-neutral verifier rules of `spec/authorization.md`, held to parity in TypeScript,
  Python and Rust. AFD's process for a change to an approved, active feature is an amendment specified where the need
  arises, then written into `spec/` in a documents-only step with its cases, then implemented per language. Phase 5 did
  exactly this for MCP Authorization itself: its section 3.1 specified AFD's step 0, and step 0a wrote
  `spec/authorization.md` ([phase 5, 3.1](spec.md#31-afd-first-step-0-d106)). MCP Authorization is approved and active,
  so no new AFD proposal is needed. Its proposal gains decision row A8 pointing here. It has no STATUS file of its own;
  its state lives in its proposal's Status row and in this repository's Umbel status.
- **Umbel's part** (the person page, scope names, configuration, presets, the doctor) is host code in phase 5's area,
  so it sits beside phase 5's specification, as D158 placed the Ideas host changes beside their plugin.
- **Two documents** would split one decision across two reviews, and the AFD part has no consumer but this one yet.

**Languages.** The AFD change is specified for all three. TypeScript and Rust implement it (steps A2 and A3). Python
has no MCP authorization verifier yet (`spec/authorization.md`, implementation status, "Planned"), so it implements the
profile with M1 to M4, from the same cases. C++ has no HTTP server.

## 2. AFD: a claim profile per issuer, and a scope qualifier (D184)

### 2.1 The claim profile

A JWT issuer may carry a **claim profile**. Its defaults are today's rules. Introspection (M3, "Introspection") keeps
today's rules and takes no profile: RFC 7662 fixes its member names.

| Setting | Values | Default | Replaces |
| --- | --- | --- | --- |
| Token types | A non-empty set of `at+jwt` and `JWT`. `at+jwt` admits a header `typ` of `at+jwt` or `application/at+jwt`; `JWT` admits `JWT`. Both compare ignoring ASCII case. An absent `typ` is never admitted | `at+jwt` | M3 rule 2, `typ` |
| Audience | One string of 1 to 255 characters in `%x21-7E` | None: the resource, compared by M3.1 | M3 rule 6 |
| Token id claim | `jti` or `uti` | `jti` | M3 rule 7 |
| Client id claim | `client_id`, `azp` or `appid` | `client_id` | M3 rule 7, M4 `clientId` |
| Scope claims | A non-empty ordered set of `scope`, `scp` and `roles` | `scope` | M3 rule 9, M3.2 |

Rules, added to M3:
- **Rule 2.** `typ` must be admitted by the issuer's token types: else `typ`.
- **Rule 6.** With an audience set, `aud` is a string, or an array of exactly one string, **byte-equal** to it: else
  `audience`. There is no URL comparison. Without one, M3.1 applies unchanged. Either way, `credentials.resource` stays
  the configured resource.
- **Rule 7.** The required claims are `exp`, `iat`, `sub`, the token id claim and the client id claim, under today's
  limits. **When the token types admit `JWT`, at least one of the scope claims must be present: else `claims`.** An
  OpenID Connect ID token is also typed `JWT` and carries no `scp` or `roles`, so it cannot pass as an access token.
  The audience is the second guard: Umbel refuses at open a profile whose audience is a person-login client id (3.2).
- **Rule 9.** Each scope claim is read in the profile's order. `scope` and `scp` are strings under M3.2's grammar.
  `roles` is an array of strings, each one M3.2 scope token. A claim of the wrong type, or a bad token, is
  `scope-malformed`. Absent claims grant nothing. The scopes join in that order, a repeat counting once at its first
  place. The qualifier (2.2), then the prefix and the limit, apply to the joined list.
- **M4.** `clientId` is the client id claim's value; `scopes` the joined list. Nothing else changes.

A profile is refused when built (an error naming the setting, as `TokenRules` refuses today) for: an empty set; a
value not listed; a repeat; an audience outside its limits.

### 2.2 The scope qualifier

Some providers name a scope by its resource: Entra's clients request `<Application ID URI>/<value>`, while the token's
`scp` carries the bare value. A **scope qualifier** is a string of 1 to 255 characters, each `%x21 / %x23-5B / %x5D-7E`.
Default: none.

- **Verification (M3.2).** With a qualifier, a scope token that starts with it is read as the rest. A token equal to
  the qualifier alone is dropped. Bare tokens are read as today. So both a qualified and a bare token verify.
- **Publishing (M5, M7).** Every scope the server publishes is prefixed with it: `scopes_supported`, the 401's
  `scope`, the 403's `scope`, and the scopes named in the 403 body's and `INSUFFICIENT_SCOPE`'s suggestion. Scope
  decisions inside the server stay bare.

### 2.3 Names per language

| | Rust (`afd::server::auth`, `server-auth`) | TypeScript (`@lushly-dev/afd-server`) | Python (`afd.server.auth`, with M1 to M4) |
| --- | --- | --- | --- |
| Profile | `ClaimProfile::default()`, `.with_token_types(I) -> Result`, `.with_audience(s) -> Result`, `.with_token_id_claim(TokenIdClaim)`, `.with_client_id_claim(ClientIdClaim)`, `.with_scope_claims(I) -> Result`; enums `TokenType { AtJwt, Jwt }`, `TokenIdClaim { Jti, Uti }`, `ClientIdClaim { ClientId, Azp, Appid }`, `ScopeClaim { Scope, Scp, Roles }` | `createClaimProfile(options?: ClaimProfileOptions): ClaimProfile` with `tokenTypes?: ('at+jwt' \| 'JWT')[]`, `audience?`, `tokenIdClaim?: 'jti' \| 'uti'`, `clientIdClaim?: 'client_id' \| 'azp' \| 'appid'`, `scopeClaims?: ('scope' \| 'scp' \| 'roles')[]`; throws on an invalid option | `ClaimProfile(token_types=("at+jwt",), audience=None, token_id_claim="jti", client_id_claim="client_id", scope_claims=("scope",))`, frozen; `ValueError` on an invalid one |
| On an issuer | `JwtIssuer::with_profile(self, ClaimProfile) -> Self` | `JwtIssuer.profile?: ClaimProfile \| ClaimProfileOptions` | `JwtIssuer(profile=...)` |
| Rule functions | `check_jws_header_for(header, algorithms, &ClaimProfile)`, `check_claims_for(claims, issuer, rules, &ClaimProfile, now, certificate)`; today's `check_jws_header` and `check_claims` keep their signatures and use the default profile (`claims.rs:198`, `:325`) | `checkJwsHeader(header, algorithms, profile?)`, `checkClaims(claims, issuer, rules, now, certificate?, profile?)` (`mcp-auth-rules.ts:235`, `:345`) | `check_jws_header(header, algorithms, profile=None)`, `check_claims(..., profile=None)` |
| Qualifier | `TokenRules::with_scope_qualifier(q) -> Result` (beside `with_scope_prefix`, `claims.rs:85`); `ProtectedResource::with_scope_qualifier(q) -> Result` (beside `with_scopes_supported`, `resource.rs:178`) | `TokenRulesOptions.scopeQualifier`, `ProtectedResourceOptions.scopeQualifier` (`mcp-auth-rules.ts:102`, `mcp-auth-resource.ts:130`) | `TokenRules(scope_qualifier=None)`, `ProtectedResource(scope_qualifier=None)` |

Every new item is additive with today's default, so it is a minor release in each package.

### 2.4 Cases

`spec/authorization.json` gains cases in its existing sections, so every loader reads them without a new section:
- `jwtHeaders`: a case may carry `profile`. Cases: `JWT` refused by default; `JWT` admitted by a `JWT` profile;
  `jwt` admitted (case); `at+jwt` refused by a `JWT`-only profile; absent `typ` refused under both.
- `claims`: a case's `config` may carry `profile`. Cases: a GUID audience accepted byte-equal and refused in another
  case; an array of one accepted and of two refused; `uti` and `azp` read; `appid` read; `jti` missing under a `uti`
  profile accepted; `uti` missing refused with `claims`; `scp` and `roles` joined in order with a repeat counted once;
  `roles` not an array is `scope-malformed`; under a `JWT` profile no scope claim is `claims` (the ID-token case);
  under a `JWT` profile an empty `scp` passes with no scopes.
- `scopeClaims`: a case may carry `qualifier`. Cases: qualified read as bare; bare read as bare; the qualifier alone
  dropped; a qualified scope outside the prefix dropped; the limit counted after the qualifier.
- `challenges` and `metadataDocuments`: a case may carry `scopeQualifier`. Cases: a 401 and a 403 with qualified
  scopes; a metadata document with qualified `scopes_supported`.

## 3. Umbel: tokens

### 3.1 Configuration

Added to configuration version 7 (D188). All optional; the defaults are today's rules.

```toml
[auth]
scope_qualifier = "https://umbel.example.com/mcp/"   # default: none, or the entra preset's (7.2)

[auth.issuers.work]
preset = "entra"                                     # "better-auth" | "entra"; default: none (7)
issuer = "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0"
namespace = "work"
audience = "66666666-7777-8888-9999-000000000000"    # default: http.public_url, by M3.1
token_types = ["JWT"]                                # "at+jwt" | "JWT"; default ["at+jwt"]
token_id_claim = "uti"                               # "jti" | "uti"; default "jti"
client_id_claim = "azp"                              # "client_id" | "azp" | "appid"; default "client_id"
scope_claims = ["scp", "roles"]                      # "scope" | "scp" | "roles"; default ["scope"]
```

`IssuerConfig` (`src/workspace/hosted.rs:321-348`) gains `preset: Option<Preset>` and `profile: ClaimProfileConfig`
(the five settings, with defaults). `ISSUER_KEYS` (`hosted.rs:78-89`) gains the six keys; `AUTH_KEYS` gains
`scope_qualifier`. They are configuration version 7 keys: a version 5 or 6 file naming them is refused with "needs
config_version = 7", as `is_v7_key` (`src/workspace/person.rs:257`) answers today.

### 3.2 Rules at open

Each fails with `WORKSPACE_CONFIG_INVALID` naming the key:
- **Values.** Each setting holds only its listed values, with no repeat; `audience` and `scope_qualifier` are within
  2.1's and 2.2's limits; `scope_qualifier` followed by `<prefix>:read` is a scope token.
- **JWT issuers only.** The five profile keys are refused on an issuer with `verify = "introspection"` ("applies only
  to verify = \"jwt\"") and on one with `access_tokens = false` ("applies only to an issuer whose access tokens are
  accepted").
- **The ID-token guard.** An issuer whose `token_types` admits `JWT` must set `audience`, and it must differ from the
  `client_id` of every person login whose `issuer` is this issuer (key `auth.issuers.<alias>.audience`: "is the person
  login's client id, so an ID token issued to it could pass as an access token; register the API apart from the person
  login"). This with rule 7's scope claim (2.1) is the guard.
- **Gateway.** In mode `gateway`, issuers accept no access tokens (phase 5, 4.4), so the profile keys are refused there
  as on any issuer with `access_tokens = false`.

### 3.3 Verifier and metadata

- `token_rules` (`src/auth/verifier.rs:82-101`) adds `.with_scope_qualifier(q)` when `auth.scope_qualifier` is set.
- `HostVerifier::from_config` (`verifier.rs:112`) builds each JWT issuer's `ClaimProfile` from its settings and calls
  `JwtIssuer::with_profile`.
- `protected_resource` (`src/surfaces/http.rs:366-389`) adds `.with_scope_qualifier(q)`. `scopes_supported` becomes
  `["<qualifier><prefix>:read"]`, and every challenge names qualified scopes (2.2).
- Mapping (phase 5, 4.1), services and groups are unchanged: they read the credentials and the subject claim.

## 4. Umbel: scope names a provider can carry (D184)

Umbel's scope grammar (`<prefix>:<verb>[:<space>]`, phase 5, 5.1) is unchanged. The qualifier of 2.2 is the only
change: it lets a provider that names scopes by resource carry them.

- With `scope_qualifier` set, clients see `https://umbel.example.com/mcp/umbel:read`, and a token's `scp` of
  `umbel:read umbel:write:alpha` grants `umbel:read` and `umbel:write:alpha`.
- **Doctor `auth.provider`** warns when `scope_qualifier` is set and an access-token issuer reads `scope`: "issuer
  `<alias>` reads `scope`; clients now request qualified scopes, so its tokens must carry qualified or bare Umbel
  scopes".
- Whether Entra accepts `:` in a scope value is unconfirmed (section 9, E1). If it does not, a mapping from provider
  scope names to Umbel scopes is needed; that is a follow-up, not part of this specification.

## 5. Umbel: the person login's request (D186)

A namespace's person login (`PersonLogin`, `hosted.rs:353-368`) gains, in configuration version 7:

| Key | Values | Default | Today |
| --- | --- | --- | --- |
| `scopes` | 1 to 8 distinct RFC 6749 scope tokens, including `openid` | `["openid"]` | `scope=openid` (`oidc.rs:560`) |
| `claims_supported_check` | `"fail"` or `"warn"` | `"fail"` | Fail (`oidc.rs:112-124`) |
| `assurance` | An array of rules (6.1), at most 8 | `[]` | None |

- **The request** (phase 5, 7.2 step 2; `authorization_url`, `oidc.rs:541-570`): `scope` is `scopes` joined by
  spaces. The `claims` request's `id_token` member holds `amr` and `auth_time` as essential (as today), `acr` with
  the standard rule's and every `acr` rule's values when any exists, and `acrs` with every `acrs` rule's values when
  any exists. One value is sent as `"value"`, several as `"values"` (OIDC Core 5.5.1). `acr_values` is sent only when
  some rule reads `acr`, holding those values.
- **The `claims_supported` check** (`login_findings`, `oidc.rs:48-133`): the claims required are `amr`, plus `acr`
  when some rule reads it, plus `acrs` when some rule reads it. A published list lacking one fails, as today, or
  warns where `claims_supported_check = "warn"`: "`<at>`'s claims_supported lacks `<claims>`; the deployer says its ID
  tokens carry them anyway; each login is still checked for them". The check at return is unchanged: a missing claim
  still refuses the login. `acr_values_supported` is compared with the `acr` values only.

## 6. Umbel: what proves a person (D185)

### 6.1 Rules

A person login proves a person by the first rule that matches its ID token.

**The standard rule** is today's rule, named `standard`. It exists when the login sets `acr_values` and `uv_amr`, and
it is checked exactly as today: at open (`uv_amr_problem`, `src/auth/mod.rs:75`), and at return (`oidc.rs:746-772`,
`proves_user_verification`, `mod.rs:106`), including mode `gateway`'s phishing-resistant `acr` (`oidc.rs:755-757`). It
is D115's floor with D181's coupling. A login it proves has the level `verified`.

**A declared rule** is the deployer's own:

```toml
[[auth.namespaces.work.person.assurance]]
name = "entra-passkey"           # ^[a-z][a-z0-9-]{0,31}$, unique in the login, never "standard"
acr_claim = "acrs"               # "acr" | "acrs"; default "acr"
acr_values = ["c1"]              # 1 to 8 values, each 1 to 64 characters in %x21-7E
amr_all = ["fido", "mfa"]        # every one must be in amr
amr_any = []                     # when non-empty, one must be in amr
```

- `amr_all` and `amr_any` each hold at most 8 values of 1 to 32 characters `[A-Za-z0-9_-]`, with no repeat. At least
  one of them is non-empty.
- **It matches** when the ID token's `acr_claim` names one of its `acr_values` (`acr`: a string; `acrs`: a string or
  an array of strings, any one matching), and its `amr` is an array of strings holding every `amr_all` value and, when
  `amr_any` is non-empty, one of those.
- A login it proves has the level **`declared`**.

Rules at open, each `WORKSPACE_CONFIG_INVALID` naming the key:
- `acr_values` and `uv_amr` are both set or both absent (`...person.uv_amr`: "is set without acr_values", and the
  reverse). A login has the standard rule, at least one declared rule, or both. One with neither is refused with
  today's message for an empty `acr_values`.
- **Mode `gateway` refuses declared rules** (`...person.assurance`: "is not served in mode gateway, where every login
  must report a phishing-resistant acr (phase 5, amendment from step 5b)").

**Order and refusal.** The standard rule is tried first, then the declared rules in file order. When none matches,
the login is refused with `PERSON_VERIFICATION_INSUFFICIENT`, as today: `Refusal::Acr` when no rule's `acr` part
matched, else `Refusal::Amr`. An ID token whose `acr` is absent is refused only when no `acrs` rule matches.

### 6.2 What the doctor says

`auth.person` warns once per declared rule. The warning names the namespace, the rule and what is lost:

> namespace `<ns>`: assurance rule `<name>` is the deployer's: Umbel cannot check that `<acr_claim>` `<values>` means
> a phishing-resistant login with user verification (D115, D181). Logins it proves are recorded as level `declared`,
> which a space's `verified_levels` admits only where it lists `declared`.

When no value of the rule's `amr_all` or `amr_any` is `mfa` or one of RFC 8176's six methods, it adds: "It requires no
multi-factor or user-verification method, so a single factor may pass." The check's suggestion names the standard rule
as the strict choice. A warning never stops the page: the deployer chose the rule.

### 6.3 What is recorded (D187)

Every login the page accepts records **how** it was proven:

```json
"evidence": { "rule": "entra-passkey", "acrClaim": "acrs", "amr": ["fido", "mfa"] }
```

- `rule` is `standard` or a declared rule's name. `acrClaim` is `acr` or `acrs`. `amr` is the ID token's `amr`: the
  first 16 strings of 1 to 32 characters in `%x21-7E`, in token order.
- `acr`, where a shape already holds it, holds the matched value of the rule's claim (`c1` above).

Where it is recorded:

| Shape | Change | Where today |
| --- | --- | --- |
| `Proved` | Gains `level` and `evidence` | `src/person/oidc.rs:218-224` |
| Person decision, version 2 | Gains `evidence`: `null` until decided, the object after; `level` may be `declared` | `schemas/person-decision.v2.json` (H1) |
| `PersonMark` | Gains `evidence`; `level` from the login, no longer the constant `"verified"` | `src/person/mod.rs:121`; `src/person/service.rs:656` |
| `umbel_sdk::PersonDecision` | Gains `evidence: Option<Evidence>` (`None` for `local`); `level` may be `declared` | `sdk/src/cx.rs:143-165` |
| `umbel_store::Assurance` | Gains `evidence: Option<Evidence>`. Level `declared`, method `person-page`, with `namespace`, `authTime`, `acr` and `evidence` all required. A `verified` assurance may carry `evidence`; new writes always do. `Assurance::declared(namespace, auth_time, acr, evidence)` and `Assurance::with_evidence(evidence)` | `store/src/envelope.rs:145-223` |
| Provenance envelope, version 4 | Admits `declared`, and `evidence` on `verified` and `declared` (`is_valid`, `envelope.rs:204`). An envelope holding either is written as version 4 | `schemas/provenance-envelope.v4.json` |
| Principal version 1, `humanPresent` | `level` may be `declared`, with the fields `verified` requires | `schemas/principal.v1.json`; `src/principal.rs:75` |
| `AssuranceLevel` | Gains `Declared` (`"declared"`); `ALL` holds four. `DEFAULT_VERIFIED_LEVELS` is unchanged: `terminal` and `verified` | `src/workspace/person.rs:47-80` |

`Evidence` is one struct in `umbel_store` (`rule: String`, `acr_claim: String`, `amr: Vec<String>`, serialised in
camel case, `deny_unknown_fields`), re-exported by the SDK.

**What changes for a command.** A command with `person.mcp = "verified"` (phase 5, 2.3) is served by the page when the
namespace's login exists, as today. A login proven by a declared rule decides it: the deployer chose that rule. What a
plugin or reader sees is the level and the evidence. `verified_only` (D180) admits a `declared` affirmation only where
`spaces.<id>.verified_levels` lists it.

## 7. Presets (D186)

### 7.1 What a preset is

`preset` on an issuer names a set of defaults. Any key the file sets wins over the preset. A preset fills only keys the
file leaves out, and never a deployer's value such as `issuer` or `audience`. It applies to the issuer, to every
person login whose `issuer` is that issuer, and, where noted, to `[auth]`. No preset is the default, and no preset
behaves as today. `umbel doctor` prints each value a preset filled (7.4).

### 7.2 The two presets

| Key | `better-auth` | `entra` |
| --- | --- | --- |
| `algorithms` | `["EdDSA"]` (the JWT plugin's default) | `["RS256"]` |
| `subject_claim` | `sub` | `oid` |
| `token_types` | `["at+jwt"]` | `["JWT"]` |
| `audience` | None (`http.public_url`) | **Required**: the API app's application (client) ID. Missing: `WORKSPACE_CONFIG_INVALID` naming `audience`, "the entra preset needs the API app's application (client) ID" |
| `token_id_claim` | `jti` | `uti` |
| `client_id_claim` | `client_id` | `azp` |
| `scope_claims` | `["scope"]` | `["scp", "roles"]` |
| `services` | None | `{ claim = { name = "idtyp", value = "app" } }` |
| `[auth] scope_qualifier` | None | `http.public_url` followed by `/`, when an access-token issuer has this preset |
| `[auth] max_token_lifetime_s` | 3600 | 5400, when an access-token issuer has this preset (Entra's 60 to 90 minutes) |
| Person `scopes` | `["openid"]` | `["openid", "profile"]` (Entra issues `oid` only with `profile`) |
| Person `subject_claim` | `sub` | `oid` |
| Person `claims_supported_check` | `fail` | `warn` (Entra's discovery omits `amr`, confirmed against public metadata) |
| Person rules, when the file sets none of `acr_values`, `uv_amr` and `assurance` | The standard rule with `acr_values = ["phr"]`, `uv_amr = ["mfa"]` (D181's passkey login) | Two declared rules, both `acr_claim = "acrs"`, `acr_values = ["c1"]`: `entra-passkey` with `amr_all = ["fido", "mfa"]`, and `entra-hello` with `amr_all = ["hwk", "ngcmfa", "mfa"]` |

`better-auth` is the suggested preset: its claim and assurance rules are today's. Choosing `entra` is an explicit
loosening: its logins are `declared`, and the doctor warns (6.2, 7.4).

### 7.3 Status of a preset

`better-auth` is **supported**. `entra` is **provisional** until section 9's tests pass in a real tenant: it is
accepted, and `auth.provider` warns "preset entra is provisional: section 9 of the auth profiles specification lists
what is not yet confirmed against a real tenant". The pull request that records the tests removes the warning.

### 7.4 Doctor `auth.provider`

A new check, after `auth.issuers`. Per issuer with a preset, it notes the values the preset filled and the provider-side
settings Umbel cannot see, as a checklist. It warns for a provisional preset (7.3), for 4's `scope` case, and for any
issuer whose audience is not `http.public_url`: "issuer `<alias>`'s tokens are for audience `<audience>`, not the
resource; the binding to this resource holds only while that API registration serves this resource alone". Otherwise
it passes. Without a preset it passes with no notes.

**Better Auth checklist:**
- version 1.8 or later, whose `authenticationContext` reports `acr` and `amr`;
- the `jwt()` plugin on and `disableJwtPlugin` unset, so access tokens are JWTs;
- a `resources` entry for `http.public_url` whose `allowedScopes` are the Umbel scopes, without `openid`, so `aud`
  has one value;
- `authenticationContext.acrValuesSupported` listing `phr`, and `resolve` returning `phr` with `amr` `["mfa"]` only for
  a passkey sign-in whose user verification was checked;
- the passkey plugin with `authenticatorSelection.userVerification = "required"`;
- `advertisedMetadata.claims_supported` listing `acr`, `amr` and `auth_time`;
- `pairwiseSecret` unset, so `sub` is public;
- the person-page client registered as a confidential client with the page's redirect URI.

**Entra checklist:**
- the API app registration: `requestedAccessTokenVersion = 2`; Application ID URI equal to `http.public_url`, with no
  trailing slash and a verified domain; one exposed scope per Umbel scope; the optional claim `idtyp`;
- the person-login app: a separate registration (3.2); optional claims `auth_time` and `amr`;
- a Conditional Access authentication context (`c1` by default) whose policy requires the built-in Phishing-resistant
  MFA strength, with sign-in frequency "every time";
- passkeys (FIDO2) enabled with user verification required;
- MCP clients pre-registered or pre-authorised (Entra offers neither dynamic registration nor client metadata
  documents);
- no continuous access evaluation (`xms_cc`) on the API app, whose long-lived tokens exceed `max_token_lifetime_s`.

## 8. What stays as it is

- Mode `none`, stdio and the CLI: untouched.
- Mode `gateway`: no profile and no declared rule (3.2, 6.1).
- Error codes: none added. Configuration problems are `WORKSPACE_CONFIG_INVALID`, logins `PERSON_VERIFICATION_INSUFFICIENT`,
  tokens AFD's existing rule codes.
- D115's and D181's checks, as the standard rule, unchanged in every detail.

## 9. What a real Entra tenant must confirm

Each test runs against a test tenant with invented users, by a deployer, and is recorded as an amendment here with its
date and result. Until all pass, `entra` stays provisional (7.3).

| # | Unconfirmed fact | Test that settles it |
| --- | --- | --- |
| E1 | A scope value may contain `:`, as `umbel:read:alpha` | Expose `umbel:read` and `umbel:write:alpha` on the API app. Pass: both save, and a token requested for them carries both in `scp` |
| E2 | A client may request the qualified scope beside `resource=<public_url>`, and `scp` carries the bare value | Request `scope=<public_url>/umbel:read` with `resource=<public_url>`, then the bare scope with the same `resource`. Record which succeed. Pass: the qualified request succeeds and its `scp` is `umbel:read` |
| E3 | Access tokens for a custom API carry `oid` without `profile` | Request a token with only the API's scopes. Pass: `oid` present |
| E4 | v2 ID tokens carry `acrs` and `amr` for a passkey sign-in, with values `c1` and `fido`, `mfa` | Sign in with a passkey through the person page with the `amr` optional claim set. Decode the ID token. Pass: `acrs` holds `c1`, `amr` holds `fido` and `mfa` |
| E5 | Entra accepts Umbel's `claims` request for an essential `acrs` in the ID token, and ignores rather than refuses `acr_values` and `max_age` | Run the page's authorization request unchanged. Pass: no error, and the policy for `c1` is enforced |
| E6 | Entra requires user verification for a passkey | Sign in with a security key whose PIN is skipped. Pass: refused, or `amr` lacks `fido` |
| E7 | `prompt=login` yields a fresh `auth_time` | Sign in twice within a minute. Pass: the second `auth_time` is the second sign-in's |
| E8 | Tokens without continuous access evaluation live at most 5400 seconds | Decode ten tokens. Pass: each `exp - iat` is at most 5400 |
| E9 | App-only tokens carry `idtyp = "app"` and `roles` as an array | Request a client-credentials token. Pass: both, and Umbel maps it to a service |
| E10 | The two guards hold with real tokens | Send Umbel an ID token issued to the person-login app, and one issued to the API app. Pass: both refused, with `audience` and `claims` |

## 10. Tests

| File | What it pins |
| --- | --- |
| `packages/rust/tests/authorization_cases.rs` | Loads 2.4's new cases |
| `packages/rust/tests/auth_verifier.rs` | One test per new rule with signed tokens: a `JWT` token passes a `JWT` profile and fails the default; GUID audience; `uti`; `azp`; `appid`; `scp` and `roles`; an ID-token shape refused with `claims`; the qualifier read and published; each profile construction error |
| `packages/server/src/authorization-cases.test.ts` | The same cases |
| `packages/server/src/mcp-auth-verifier.test.ts` | The same signed-token tests |
| `tests/auth_profiles_config.rs` | 3.1 and 3.2, 5's keys, 6.1's rules at open, 7's presets (each filled value, a file value winning, `entra` without `audience` refused, the `[auth]` defaults), version 5 and 6 files refused with "needs config_version = 7", and a file with no new key equal to today's parse |
| `tests/auth_profiles_tokens.rs` | Through the HTTP surface with `umbel-testkit-idp` (`TokenBuilder::header_member`, `claim`, `without_claim`, `testkit-idp/src/token.rs:530-559`): an Entra-shaped token admitted and mapped by `oid`, with `scp` and `roles`; an ID token refused; qualified `scopes_supported` and challenges; an issuer without settings refusing the same token exactly as today |
| `tests/person_assurance.rs` | With the test identity provider's `adjust_token` and `set_metadata_patch` (`testkit-idp/src/role.rs:312`, `:650`): the request's `scope`, `claims` and `acr_values` per 5; the standard rule unchanged (D181's cases repeated); each declared rule matching and not; order; `acr` absent with an `acrs` rule; refusal codes; `claims_supported` lacking `amr` failing, then warning; `evidence` and `declared` in the decision record, `PersonDecision`, the envelope and `humanPresent`; `verified_only` refusing `declared` by default and admitting it when listed |
| `tests/doctor_auth_provider.rs` | 6.2's warnings, with and without the single-factor sentence; 7.4's notes, warnings and pass |
| `tests/schemas.rs` | The changed schemas stay closed, and new examples validate: `workspace-config.v7.entra.json`, `person-decision.v2.declared.json`, `provenance-envelope.v4.declared.json` |

## 11. Implementation plan

Each step is one pull request. AFD's steps change only `spec/`, `docs/` and `packages/`. Umbel's change only
`endpoints/umbel/` outside `plugins/`, so the plugin isolation rule (`.github/workflows/umbel.yml:377-399`) holds.

| Step | Deliverable | Exit |
| --- | --- | --- |
| A1. AFD spec | `spec/authorization.md` (M3 rules 2, 6, 7 and 9, M3.2, M4, M5, M7, Options, Conformance) and `spec/authorization.json` (2.4); the language parity rows; decision A8 in the MCP Authorization proposal. Documents and cases only | The repository's documentation checks; each new case's expected value computed by Node from the rules, as for step 0a |
| A2. AFD Rust | 2.1 to 2.3 in `claims.rs`, `jwt.rs`, `resource.rs`, with the release note the Rust package asks for | `cargo test` with `server-auth`; `authorization_cases.rs` and `auth_verifier.rs` pass; `tests/auth_canary.rs` unchanged |
| A3. AFD TypeScript | The same in `mcp-auth-rules.ts`, `mcp-auth-jwt.ts`, `mcp-auth-resource.ts`, with a changeset (minor) | The server package's tests; the two test files pass |
| U1. Shapes (needs nothing) | 3.1, 5 and 6.1's keys parsed and validated; the presets as data in `src/auth/presets.rs`; `Evidence`, `AssuranceLevel::Declared`, the schemas and examples of 6.3. Nothing acts on them | The Umbel gate; `auth_profiles_config.rs` and `schemas.rs` pass |
| U2. Tokens (needs A2, U1) | 3.3 and 4 | The Umbel gate; `auth_profiles_tokens.rs` passes |
| U3. Person page (needs U1) | 5, 6.1 and 6.3: the request, the rules at return, the evidence carried to every shape, `verified_levels` reading `declared` | The Umbel gate; `person_assurance.rs` passes |
| U4. Doctor and presets (needs U2, U3) | 6.2 and 7.4; the README's hosted section names the presets and links here | The Umbel gate; `doctor_auth_provider.rs` passes |
| E. Tenant tests (needs U4 and a tenant) | Section 9 run and recorded here; the provisional warning removed if all pass | Every row of section 9 recorded |

Python implements 2.1 to 2.3 with its M1 to M4, from the same cases; no Python step is planned here.

## 12. Versions (D188)

**Configuration version 7, additively.** Every new key is optional and defaults to today's rule, so every valid
version 7 file keeps its meaning. Version 7 was made by step H1 the same day (`b25d2870`); nothing reads it outside
this repository, and Umbel is unpublished. The precedent is `ca_file`, added to version 5 in phase 5's step 2c while
version 5 was the newest (STATUS, phase 5 step 2c). The same holds for person decision version 2, envelope version 4
(H1's, which nothing writes yet) and principal version 1's `humanPresent`. If the renumbering follow-up between
configuration version 7 and phase 6 moves version 7, these keys move with it.

A version 8 is needed only if version 7 has shipped in a release, or a deployment reads it, before step U1 merges.

## 13. For the owner

**Decided by you, 2026-11-12 (D182):** the deployer defines the sign-in layer; defaults stay strict; loosening is
explicit; the doctor warns; every confirmation records how the person was proven.

**Decided here under your direction; you have not read them (D183 to D188).** The ones worth your eye:
- **A login proven by the deployer's own rule gets its own level, `declared`**, and `verified_levels` leaves it out by
  default. So an Entra instance's Ideas `verified_only` admits nothing from the page until the deployer lists
  `declared`. The other choice was to record `verified` with the evidence beside it, which keeps Entra working with no
  extra step but makes the strong and the declared look alike to any reader that checks only the level.
- **The `entra` preset ships provisional**, and its person rules (`acrs` `c1` with `fido` and `mfa`, or Windows Hello)
  rest on Microsoft's documentation, not a tenant (section 9).
- **Mode `gateway` takes no declared rules**, as it takes no phishable class today.

## Follow-ups

| Date | Raised by | Follow-up | Where it goes |
| --- | --- | --- | --- |
| 2026-11-12 | This specification | If Entra refuses `:` in a scope value (E1), Umbel needs a mapping from provider scope names to its scopes | A new amendment here |
| 2026-11-12 | This specification | Entra issuers are per tenant; a multitenant `{tid}` issuer template would be a new AFD rule | Open; AFD's |
| 2026-11-12 | This specification | A command cannot ask for the standard rule only (for example `person.mcp = "verified-standard"`) | Open; a manifest change, the owner's |
| 2026-11-12 | This specification | Better Auth 1.8 is in beta; the `better-auth` checklist names it. Which `amr` Lushly's `resolve` returns for a passkey sign-in is not confirmed | Lushly's sign-in work |
| 2026-11-12 | This specification | A gateway backed by Entra needs its own signer of `umbel-gw+jwt` assertions; no Entra product provides one | Open |
