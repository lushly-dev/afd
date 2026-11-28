# @lushly-dev/afd-auth

## 3.0.0

### Major Changes

- [#2645](https://github.com/lushly-dev/afd/pull/2645) [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543) Thanks [@Falkicon](https://github.com/Falkicon)! - `zod` is now a peer dependency (`^4.6.6`) of `@lushly-dev/afd-server`, `@lushly-dev/afd-testing` and `@lushly-dev/afd-view-state` instead of a dependency, so an application's command schemas and the server use one copy of Zod. With two copies the schemas still validated, but TypeScript can reject an application's schema passed to `defineCommand`, because the two copies' types do not unify. `@lushly-dev/afd-cli` now depends on `zod` itself, since it runs the server, and `@lushly-dev/afd-auth`'s optional `zod` peer rises from `^4.0.0` to `^4.6.6` to match the server it runs on. Shape detection for a `VALIDATION_ERROR`'s `expectedFields`, `unexpectedFields` and `missingFields`, and `isObjectSchema()`, now read a schema's `_zod.def.type` instead of using `instanceof` against afd-server's own Zod classes, so they do not depend on which copy of Zod built the schema.

  This is a breaking install change, so it is a major. npm 7 or later, pnpm and Bun install a missing peer themselves, but these applications need a change:

  - One that depends on a `zod` outside `^4.6.6`, such as 3.25 (whose `zod/v4` entry it may have used for its commands): npm stops with `ERESOLVE` where it used to nest a second copy, and pnpm warns and then links the server to that `zod`, which it cannot run on. Upgrade the application to `zod@^4.6.6`.
  - One that never depended on `zod`, for example one that uses only `@lushly-dev/afd-view-state` or `@lushly-dev/afd-testing`, where peers are not installed automatically (Yarn, npm's `legacy-peer-deps`, or pnpm with `auto-install-peers=false`): the install warns, and the server may fail to import `zod` or find another package's copy. Add `zod@^4.6.6` to its dependencies.

### Minor Changes

- [#2524](https://github.com/lushly-dev/afd/pull/2524) [`612c0cb`](https://github.com/lushly-dev/afd/commit/612c0cb29ed8de62850dcd2db0e18dc365523c9f) Thanks [@Falkicon](https://github.com/Falkicon)! - `createMcpServer` and `createMcpHandler` with `auth` now throw when they are built with afd-auth's `createAuthMiddleware` lacking `isVerifiedCredentials`, in `middleware` directly or inside `composeMiddleware`. Without it, every token's call was gated on the local adapter's session and ran as the session's user. Pass `createAuthMiddleware(adapter, { isVerifiedCredentials })`, importing `isVerifiedCredentials` from `@lushly-dev/afd-server/credentials`. A server without `auth`, and a direct registry, are unaffected. The check sees afd-auth's middleware only directly or inside `composeMiddleware`: one wrapped in a host's own function is not seen, so pass the option there too, taking `isVerifiedCredentials` from the copy of afd-server that serves the request. afd-auth's middleware marks itself under a registered symbol so the check works across installed copies, and `composeMiddleware` carries the mark.

- [#2554](https://github.com/lushly-dev/afd/pull/2554) [`aee069e`](https://github.com/lushly-dev/afd/commit/aee069e37965bc8ee1138d4f543f2f50134f365f) Thanks [@Falkicon](https://github.com/Falkicon)! - `auth-sign-in` is no longer exposed to agents (`expose.agent` is now `false`; it stays on the palette and the CLI, and off MCP). A person signs in, so an agent is never handed a password or a sign-in to drive; an agent's call is refused with `COMMAND_NOT_EXPOSED` and the command is not in its list. An in-app agent that called `auth-sign-in` loses that command: it asks the person to sign in instead, as the `UNAUTHORIZED` and `TOKEN_EXPIRED` suggestions now say. A Loam journal that recorded an agent's sign-in before this still replays, from its record. `auth-sign-out` and `auth-session-get` are unchanged.

- [#3061](https://github.com/lushly-dev/afd/pull/3061) [`c54136d`](https://github.com/lushly-dev/afd/commit/c54136dcbad66506caade4022441729f7ae8dff2) Thanks [@Falkicon](https://github.com/Falkicon)! - `useConvexAuthAdapter` supports `@convex-dev/auth` 2.x, and the optional peer is now `>=0.0.95 <3`. Version 2 has a hook per sign-in method instead of `useAuthActions().signIn`. Pass the functions those hooks return (`ConvexAuthV2AdapterOptions`): `signOut`, `signInWithPassword` (from `useSignInWithEmailPassword(api.auth)`) and `oauth` by provider (for example `useSignInWithGithub(api.auth).signIn`). The methods return errors as values, and they map to the adapter's codes: a wrong password, an unknown account or a password that breaks the rules is `INVALID_CREDENTIALS`; a rate limit is `PROVIDER_ERROR`, with the wait in its suggestion; any other failure is mapped from its cause, so a failed fetch is `NETWORK_ERROR`. The 0.0.x options (`useAuthActions`) are unchanged, and support for them is planned to end in the next major.

- [#2576](https://github.com/lushly-dev/afd/pull/2576) [`67f32e8`](https://github.com/lushly-dev/afd/commit/67f32e875872c6da44205e6170bc5dd2d392a609) Thanks [@Falkicon](https://github.com/Falkicon)! - Commands can declare `secret: true` when they take or return a secret, such as a password or an issued token. `createJournalMiddleware` never records a call to such a command unless it was given `redact`, whatever its `filter` returns, in a server and in a direct registry; `redact` gets a second argument, `{ secret }`, saying which calls those are. A journal in a DirectClient's own middleware, which cannot read the declaration, records nothing without `redact`. A non-boolean `secret` is refused when the command is defined. afd-auth's `auth-sign-in`, which takes a password, now declares it.

### Patch Changes

- Updated dependencies [[`3f13a98`](https://github.com/lushly-dev/afd/commit/3f13a984e9857444a3ebb1bd5f58299d14050924), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`612c0cb`](https://github.com/lushly-dev/afd/commit/612c0cb29ed8de62850dcd2db0e18dc365523c9f), [`e0dbde6`](https://github.com/lushly-dev/afd/commit/e0dbde69123eff2c7ff8372705dd05410701855e), [`bb791f8`](https://github.com/lushly-dev/afd/commit/bb791f81fa5b2aaf9cdf9f79c910eae0d4ff0f75), [`e179b98`](https://github.com/lushly-dev/afd/commit/e179b98aff85f0ee7d17e55cdc4fca6cb13d85bc), [`2f91ebc`](https://github.com/lushly-dev/afd/commit/2f91ebc786a4fa0cf5b3cee956ccb4a574efa576), [`b96288b`](https://github.com/lushly-dev/afd/commit/b96288b7e861937029f14f295c6c1484e51ee0e7), [`ea0155f`](https://github.com/lushly-dev/afd/commit/ea0155f120f98cb23757da697d3dd00456e77422), [`7f994c7`](https://github.com/lushly-dev/afd/commit/7f994c7e4e32c94a210e90669e59824cac0b4221), [`0bb74cc`](https://github.com/lushly-dev/afd/commit/0bb74cc86269a6b17400a30f0aabc2142a936967), [`b2fa476`](https://github.com/lushly-dev/afd/commit/b2fa4767043a672767d3b02d6c9e113e2808425b), [`e7f7b64`](https://github.com/lushly-dev/afd/commit/e7f7b64667544c05392367f2b1dc8692a8dc3b10), [`5e33124`](https://github.com/lushly-dev/afd/commit/5e33124bc3d6d698192741dc38bfbe43186fd7f1), [`ca7326e`](https://github.com/lushly-dev/afd/commit/ca7326effcfd756493344e40564772aa43e3cc81), [`3917a96`](https://github.com/lushly-dev/afd/commit/3917a966cff1cdef93dde68b9cef3ace0d676c19), [`0dc9bde`](https://github.com/lushly-dev/afd/commit/0dc9bde2e8da5670ce24b5b8f87d00a5a636f68f), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`67f32e8`](https://github.com/lushly-dev/afd/commit/67f32e875872c6da44205e6170bc5dd2d392a609), [`64247b5`](https://github.com/lushly-dev/afd/commit/64247b51e9f959be7d795708d07c145456a89e10), [`3d9ab45`](https://github.com/lushly-dev/afd/commit/3d9ab45bde620af5ebe982073089c81bf47a841e), [`64f1aa0`](https://github.com/lushly-dev/afd/commit/64f1aa013cfb7dce02b7e4dece3cfc201d611e6a), [`be12d09`](https://github.com/lushly-dev/afd/commit/be12d098a66416639485d5219ecd316f62a93897), [`a91e0ea`](https://github.com/lushly-dev/afd/commit/a91e0ea58d150cb3cd04df8d34fb474e50f3a83f), [`5c9ebec`](https://github.com/lushly-dev/afd/commit/5c9ebec174e8cad39e15ef4f1d99e966bbca38a8), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543)]:
  - @lushly-dev/afd-core@3.0.0
  - @lushly-dev/afd-server@3.0.0

## 2.5.0

### Patch Changes

- [#978](https://github.com/lushly-dev/afd/pull/978) [`cfbdc10`](https://github.com/lushly-dev/afd/commit/cfbdc10d859d02e9e9512df463af0c4b61ad0793) Thanks [@Falkicon](https://github.com/Falkicon)! - `BetterAuthAdapter.refresh()` no longer resolves before the provider has answered. Better Auth cancels a session request when a newer one starts (after a sign-in or sign-out, on window focus, from another tab or on its poll), and the cancelled `refetch` resolved with no error stored, so `refresh()` could report the session kept while the provider was unreachable. It now waits for the session store to settle, and rejects with `NETWORK_ERROR` or `REFRESH_FAILED` as documented.

- [#1813](https://github.com/lushly-dev/afd/pull/1813) [`902e5ee`](https://github.com/lushly-dev/afd/commit/902e5ee2cb711bc9f45bf4ffa1b74dc248a0d1eb) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix P0/P1 security, reliability, and Windows compatibility bugs across TypeScript AFD packages:

  - Fail closed with `TOKEN_EXPIRED` in `createAuthMiddleware` when `afd-server`-branded credentials expire instead of falling through to the local `AuthAdapter` session, and propagate admission clock skew on the brand ([#1701](https://github.com/lushly-dev/afd/issues/1701)).
  - Enforce `requiredScopes` on `GET /sse` and post-routing on `resources/*` and `skills/*` handlers ([#1702](https://github.com/lushly-dev/afd/issues/1702)).
  - Guard `handler.admit()` and `handler.preDispatchCheck().decide()` against protocol-relative and malformed `req.url` values ([#1703](https://github.com/lushly-dev/afd/issues/1703)).
  - Bound `$input`/variable expansion nodes, characters, and combined nesting depth in `resolveVariables()` and map limit violations to `VALIDATION_ERROR` in `executePipeline()` ([#1704](https://github.com/lushly-dev/afd/issues/1704)).
  - Defer `FileJournalSink.lastSeq` assignment until `appendFile()` succeeds so failed first appends preserve unterminated/torn tail recovery ([#1705](https://github.com/lushly-dev/afd/issues/1705)).
  - Translate MCP SDK `SdkHttpError` into `HttpStatusError` in `McpClient.request()` so `call()`, `batch()`, and `pipe()` classify HTTP 4xx/5xx responses accurately ([#1706](https://github.com/lushly-dev/afd/issues/1706)).
  - Frame `PipelineResult` `isError` from step failures in `DirectTransport` on tool-surface registries ([#1707](https://github.com/lushly-dev/afd/issues/1707)).
  - Use `cwd` and normalized separators in `findScenarioFiles()` so `afd scenario run`/`validate` work on Windows and directories with glob metacharacters ([#1708](https://github.com/lushly-dev/afd/issues/1708)).

- Updated dependencies [[`ea0cd02`](https://github.com/lushly-dev/afd/commit/ea0cd0276bc784c31f9bf923a7c67a97a06cf3dd), [`d676427`](https://github.com/lushly-dev/afd/commit/d6764276fdabede07f7f9eaf33785e046829a7d4), [`67ca558`](https://github.com/lushly-dev/afd/commit/67ca558ab822145a3ec2f5403b4dc94e1425cc4d), [`8c3425d`](https://github.com/lushly-dev/afd/commit/8c3425d880a4894255264a742dc57f447e6fef49), [`eb33657`](https://github.com/lushly-dev/afd/commit/eb33657896346ece72368a362ded232abae08e36), [`0928fc9`](https://github.com/lushly-dev/afd/commit/0928fc99fa557b4e5dc5b52f25e560c096a2a61a), [`902e5ee`](https://github.com/lushly-dev/afd/commit/902e5ee2cb711bc9f45bf4ffa1b74dc248a0d1eb), [`dcabc87`](https://github.com/lushly-dev/afd/commit/dcabc87a4384dc6229608837f1fcdb1dc502773f), [`67bfdaa`](https://github.com/lushly-dev/afd/commit/67bfdaaef1cd56f30531c66597c950cfb8127eb1), [`7aacc49`](https://github.com/lushly-dev/afd/commit/7aacc498709944a0eef463ef3a10ba7930ce7184), [`619909a`](https://github.com/lushly-dev/afd/commit/619909adbb14f7bb3115ce4e6c6ee485676d069e), [`9c3f9f2`](https://github.com/lushly-dev/afd/commit/9c3f9f24c59c50dcd81298545f133825af2c2554)]:
  - @lushly-dev/afd-core@2.5.0

## 2.4.0

### Minor Changes

- [#896](https://github.com/lushly-dev/afd/pull/896) [`eba33ef`](https://github.com/lushly-dev/afd/commit/eba33efa826865dabd1770941f61e1f9e86ce544) Thanks [@Falkicon](https://github.com/Falkicon)! - `@lushly-dev/afd-auth` signs in with passkeys and gains three optional adapter capabilities. `SignInOptions` adds `{ method: 'passkey', autoFill? }`, and `auth-sign-in` accepts it. `AuthAdapter` adds `refresh()`, `sessions` (list the signed-in person's sessions, by a handle that is the first 16 hex characters of SHA-256 over the token, never the token, with a device label and no IP address; revoke one, the others, or all), `passkeys` (list, add, rename, remove) and `organization` (membership, members, invitations and roles, each call naming the organization by id; an empty id is a `TypeError`, so no call falls back to the provider's active organization). Two codes, `PASSKEY_CANCELLED` and `PASSKEY_UNSUPPORTED`, neither retryable, come from the new exported functions `passkeyCancelled()` and `passkeyUnsupported()`. `BetterAuthAdapter` implements all three on Better Auth's session routes and its organization and passkey client plugins, takes an `initial` state, and is tested on Better Auth 1.7.18 with `@better-auth/passkey` 1.7.18, now an optional peer. `MockAuthAdapter` takes a `clock`, and `refresh()` signs out a session past its expiry on it; its capabilities are attached in memory by `withMockCapabilities(mock, { roles })` from the new `@lushly-dev/afd-auth/mock-capabilities` entry, so a host that only signs in with the Mock never bundles them. The Convex adapter refuses a passkey sign-in with `PASSKEY_UNSUPPORTED`.

  `createAuthMiddleware` takes `isVerifiedCredentials` and `clock`. With the predicate, a call whose `credentials` afd-server set itself after verifying a token keeps its actor and runs without reading the adapter's session, `context.auth` is deleted, and the built-in `auth-*` commands are refused with `UNAUTHORIZED`, since a token has no session; `credentials` a caller supplies, or a copy, are not recognised. Without it, every call is gated on the session as before. A host that serves MCP with token authorization through this middleware must pass it. `clock` is the time a session's `expiresAt` is compared with; a host that gives `MockAuthAdapter` its own clock passes the same one here. `BetterAuthAdapter.refresh()` rejects with `NETWORK_ERROR` or `REFRESH_FAILED` when the provider did not answer, and the `better-auth` peer range is now `^1.7.18`.

  `@lushly-dev/afd-server` exports `isVerifiedCredentials(credentials, now?)`, from the root and from the new browser-safe `@lushly-dev/afd-server/credentials` entry. It recognises only the object afd-server branded, and froze, after verifying a token, and only until its `expiresAt` or the end of its request; nothing brands one yet, until the server verifies tokens itself.

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@2.4.0

## 2.3.0

### Minor Changes

- [#727](https://github.com/lushly-dev/afd/pull/727) [`2f3624e`](https://github.com/lushly-dev/afd/commit/2f3624e06dde5c0a34e41afc535087c487214a6e) Thanks [@Falkicon](https://github.com/Falkicon)! - Define the auth and view-state commands on Zod Mini through `defineCommandWithSchema`, each schema beside its JSON Schema as a literal, so a browser host that uses them bundles neither classic Zod nor `toJSONSchema`. What a command advertises does not change: its input and output JSON Schemas are the same as before, and a test in each package holds them equal to the schemas.

  `@lushly-dev/afd-auth/commands` adds `createAuthSessionGetCommand(adapter)` and `createAuthMutationCommands(adapter, options)`, in modules of their own, so a host can load `auth-session-get` before first paint and the sign-in commands later. `createAuthCommands` returns both, in the same order.

  Two things a caller can see:

  - `inputSchema` and `outputSchema` of these commands are now Zod Mini schemas, though `ZodCommandDefinition` still types `inputSchema` as classic. `safeParse` and `parse` still work; classic's methods such as `.optional()`, `.extend()` or `.shape.id.describe()` do not.
  - With no Zod locale loaded, as on Zod Mini alone, a bad email at `auth-sign-in` says `Invalid email` rather than `Invalid email address`, and an in-process `NaN` or `Infinity` is described as `nan` or `number`, which JSON cannot carry. With classic Zod loaded anywhere in the process nothing changes.

### Patch Changes

- [#725](https://github.com/lushly-dev/afd/pull/725) [`a5830b4`](https://github.com/lushly-dev/afd/commit/a5830b4d7a360af0406c473fcafff87ee2eef8cb) Thanks [@Falkicon](https://github.com/Falkicon)! - `MockAuthAdapter.signIn` derives the user id from the email, `mock-user-<email>`, in place of `mock-user-<Date.now()>`, so the same person keeps one id across sign-ins, adapters and replays. Session ids stay time-based, and `_setUser` is unchanged. A test that needs two different users must sign in with two different emails.
- Updated dependencies [[`dc3e085`](https://github.com/lushly-dev/afd/commit/dc3e085a51e2a8a2e1b8b693f1ed1de69d949d65), [`8e2e46f`](https://github.com/lushly-dev/afd/commit/8e2e46f4283d7c9fb3cafbfd0006efbe09495c42), [`5f11192`](https://github.com/lushly-dev/afd/commit/5f111922eee6240e116cbb267bc4d410ba2f2743), [`2ab549a`](https://github.com/lushly-dev/afd/commit/2ab549a40614f998c9004fe8a103c62e8a8597c2), [`0c9192f`](https://github.com/lushly-dev/afd/commit/0c9192feaa7db53cb57f9be72041e784eed09007), [`c80a9b4`](https://github.com/lushly-dev/afd/commit/c80a9b4dc9078f408876ab0250d8d82c40653dc2), [`13c2a8f`](https://github.com/lushly-dev/afd/commit/13c2a8f4294518e4f9b2587206f82a88700a2303), [`7ae2bc2`](https://github.com/lushly-dev/afd/commit/7ae2bc2c08932c3fe074dd3620b53b34326cb291)]:
  - @lushly-dev/afd-core@2.3.0

## 2.2.1

### Patch Changes

- Updated dependencies [[`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e)]:
  - @lushly-dev/afd-core@2.2.1

## 2.2.0

### Minor Changes

- [#406](https://github.com/lushly-dev/afd/pull/406) [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd) Thanks [@Falkicon](https://github.com/Falkicon)! - Add standard `actor`, `clock` and `random` fields to `CommandContext` ([#271](https://github.com/lushly-dev/afd/issues/271), [#274](https://github.com/lushly-dev/afd/issues/274)).

  - **Core:** `Actor` (`kind`: `human`, `agent`, `service`, `script` or `test`, with optional `id`, `label` and `onBehalfOf`), `Clock`, `RandomSource`, `systemClock`, `systemRandom`, `fixedClock()` (a manual clock with `set` and `advance`), `seededRandom()` (reproducible, not cryptographic) and `withContextDefaults()`. `ResultMetadata` and `TelemetryEvent` gain `actorKind`. The core registry gives handlers a clock and a random source.
  - **Server:** new `clock`, `random` and `actor` options. MCP calls run as `{ kind: 'agent' }` unless the option or `createContext` says otherwise; every context gets a clock and a random source; results carry `metadata.actorKind` (the kind only, never the id). `executionTimeMs`, the telemetry middleware and HTTP session expiry use the clock. `createDirectRegistry()` accepts the same three defaults.
  - **Client:** `DirectClient` accepts `actor` (default `{ kind: 'human' }`), `clock` and `random` (default: the registry's own); a call's own context wins.
  - **Auth:** `createAuthMiddleware` fills `context.actor` from the verified session: a human actor gets the user's `id` and `label`, other actors get `onBehalfOf`.
  - **Testing:** `createTestContext()` sets `actor: { kind: 'test' }`, a clock and a random source (`now` stops the clock); `InProcessExecutor` takes a `context` for every step and runs steps as a test actor. `fixedClock` and `seededRandom` are re-exported.

  The golden wire fixtures now include `"actorKind": "agent"` in result metadata.

  The server engine, `createDirectRegistry()` and the core registry now pass handlers a copy of the caller's context (with the defaults filled in), so changes middleware or handlers make to it no longer show on the caller's object. The CLI talks to servers over MCP, so its calls run as `agent` unless the server's `actor` option or `createContext` says otherwise; the same holds for `ScenarioExecutor`, which runs steps through the CLI.

### Patch Changes

- Updated dependencies [[`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0), [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60), [`f152bb9`](https://github.com/lushly-dev/afd/commit/f152bb93c62a3fe06162705b37abcd0ddfc29fc9), [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd), [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd)]:
  - @lushly-dev/afd-core@2.2.0

## 2.1.0

### Patch Changes

- [#324](https://github.com/lushly-dev/afd/pull/324) [`8abba60`](https://github.com/lushly-dev/afd/commit/8abba6092afc5cff4114988c32f5d92dbc9d2d4c) Thanks [@Falkicon](https://github.com/Falkicon)! - Internal peer dependencies now publish as caret ranges. `@lushly-dev/afd-auth` peers on `@lushly-dev/afd-server` `^X.Y.Z` and `@lushly-dev/afd-view-state` peers on `@lushly-dev/local-db` `^X.Y.Z`, where each previously required that exact version. `@lushly-dev/afd-adapters` peers on `@lushly-dev/afd-core` `^X.Y.Z` instead of `>=2.0.0`, so a future major of afd-core is no longer accepted without a matching adapters release.

- [#367](https://github.com/lushly-dev/afd/pull/367) [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568) Thanks [@Falkicon](https://github.com/Falkicon)! - Accept Better Auth's vanilla session store directly, preserve legacy store accessors, and normalize nullable provider image fields. Add a real local provider cookie/session regression test.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-core@2.1.0

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix session expiry, sign-in results, listener isolation, the Convex adapter and session sync in `@lushly-dev/afd-auth`.

  - **Behaviour change: expired sessions are rejected.** `createAuthMiddleware` returns a retryable `TOKEN_EXPIRED` failure, with a suggestion, when `session.expiresAt` is at or before now or is not a valid date. `Session.expiresAt` is now optional (a type change for code that reads it): the Convex adapter no longer invents a 24 h expiry, and a session without `expiresAt` is never treated as expired.
  - **Behaviour change: middleware defaults.** `auth-sign-in`, `auth-sign-out` and `auth-session-get` always bypass the middleware (new `AUTH_COMMAND_NAMES`), so signing in no longer needs an `exclude` entry. `context.auth` is set or deleted on every call, excluded commands included, so a caller-supplied value never reaches a handler; a `CommandContext` module augmentation types it as `AuthenticatedSessionState | undefined`. `AuthMiddlewareOptions` is exported from the package root.
  - **Behaviour change: `auth-sign-in` reports the real outcome.** It used to read the session right after `signIn()` and return a stale `unauthenticated` state with the reasoning "Signed in". `AuthAdapter.signIn()` may now resolve with a `SignInOutcome` (`signed-in`, `redirect` with the provider URL, or `pending`); resolving with nothing still works. A redirect or pending sign-in returns the current state with "Not signed in yet" reasoning and a `SIGN_IN_REDIRECT` or `SIGN_IN_PENDING` warning. Otherwise the command waits for the next non-loading state change, up to the new `createAuthCommands(adapter, { signInTimeoutMs })` (default 10 s), returns `SIGN_IN_PENDING` when the wait runs out, and fails with `PROVIDER_ERROR` when the adapter settles on no session.
  - **Listener isolation.** Every adapter calls each `onAuthStateChange` subscriber in its own `try/catch`: a throwing subscriber no longer stops later ones from seeing a sign-out, and `MockAuthAdapter.signOut()` no longer rejects after signing out. Errors go to the new `onListenerError` option, or are rethrown in a microtask.
  - **Convex adapter.** Credentials sign-in now calls `signIn(passwordProviderId, { email, password, flow: 'signIn' })` (new option, default `'password'`, the stock Password provider), so it works against a default setup. A missing password is rejected, OAuth `redirectTo` is forwarded, and OAuth `scopes` are rejected because Convex configures them on the server. Convex errors map to `INVALID_CREDENTIALS`, `NETWORK_ERROR` and `PROVIDER_ERROR` instead of surfacing as `COMMAND_EXECUTION_ERROR`. The adapter reports `loading`, not `unauthenticated`, while `meQuery` is loading; returns the same adapter object on every render; no longer logs `console.debug` on every render in development; and its options type now accepts the real `useAuthActions()` result.
  - **Better Auth adapter.** Forwards OAuth `scopes` and reports its social sign-in redirect URL.
  - **Session sync.** Received messages are debounced per type, and `signed-out` is delivered at once, so a sign-out followed by another message is no longer dropped. Messages are a typed `SessionSyncMessage` union; received payloads are validated and stripped to known fields, and `notifySessionChanged()` throws a `TypeError` for an invalid message. `lockCheckDelayMs` now drives the new `acquireRefreshLockAsync()`, which reads the lock back after that delay before claiming it. A lock timestamp more than 1 s in the future is treated as stale instead of blocking refresh.

  Minor: new options and exports (`signInTimeoutMs`, `passwordProviderId`, `onListenerError`, `acquireRefreshLockAsync`, `SignInOutcome`, `AuthenticatedSessionState`, `SessionSyncMessage`, `AUTH_COMMAND_NAMES`).

### Patch Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add a transport-free `@lushly-dev/afd-server/define` entry point. It exports `defineCommand`, `ZodCommandDefinition`, `ZodCommandOptions`, the schema helpers (`zodToJsonSchema`, `getRequiredFields`, `isObjectSchema`), the result helpers (`success`, `failure`, `error`, `isSuccess`, `isFailure`) and `defaultExpose`, and nothing in its module graph imports the MCP SDK or a Node.js builtin, so browser code can define commands (esbuild `--platform=browser` bundles it). The root entry is unchanged.

  To support it, `@lushly-dev/afd-core` adds two browser-safe subpaths, `@lushly-dev/afd-core/commands` and `@lushly-dev/afd-core/result`. `@lushly-dev/afd-auth/commands` now imports from `/define`, so it no longer loads the MCP transport either.

  Minor for server and core: new subpath exports, no changes to existing ones.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0
  - @lushly-dev/afd-server@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`b9eeeff`](https://github.com/lushly-dev/afd/commit/b9eeeff6502c922ea88ef7bc8a596025c13f7c95)]:
  - @lushly-dev/afd-server@1.0.0
  - @lushly-dev/afd-core@1.0.0

## 1.0.0

### Minor Changes

- ### Breaking Changes
  - **Node.js 22+ required** — dropped Node 20 support, CI tests on 22.x and 24.x
  - **Zod 4** — upgraded from Zod 3. `zod-to-json-schema` replaced with built-in `z.toJSONSchema()`. `ZodEffects` replaced by `ZodPipe` for transforms. Schema introspection uses `.unwrap()`/`.removeDefault()` instead of `._def.innerType`.
  - **eventsource 4** — named import (`{ EventSource }` instead of default), custom `fetch` option for headers instead of `EventSourceInitDict`. `@types/eventsource` removed (types now bundled).

  ### Other Updates
  - TypeScript target bumped to ES2024
  - All dependencies updated to latest: commander 14, conf 15, glob 13, ora 9, jsdom 28, dotenv 17, vite 8, commitlint 20
  - Replaced custom `scripts/release.mjs` with `@changesets/cli` for versioning and changelogs
  - Removed redundant eslint from React example (biome covers React hooks rules)
  - Refactored `direct.ts` — extracted `unknown-tool.ts` and `direct-validation.ts`
  - Refactored `executor.ts` — extracted `validator.ts`
  - CI now runs `pnpm check` (lefthook quality gate) to prevent local/CI desync

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@1.0.0
  - @lushly-dev/afd-server@1.0.0
