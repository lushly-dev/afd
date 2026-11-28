# @lushly-dev/afd-cli

## 3.0.0

### Major Changes

- [#2645](https://github.com/lushly-dev/afd/pull/2645) [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543) Thanks [@Falkicon](https://github.com/Falkicon)! - `zod` is now a peer dependency (`^4.6.6`) of `@lushly-dev/afd-server`, `@lushly-dev/afd-testing` and `@lushly-dev/afd-view-state` instead of a dependency, so an application's command schemas and the server use one copy of Zod. With two copies the schemas still validated, but TypeScript can reject an application's schema passed to `defineCommand`, because the two copies' types do not unify. `@lushly-dev/afd-cli` now depends on `zod` itself, since it runs the server, and `@lushly-dev/afd-auth`'s optional `zod` peer rises from `^4.0.0` to `^4.6.6` to match the server it runs on. Shape detection for a `VALIDATION_ERROR`'s `expectedFields`, `unexpectedFields` and `missingFields`, and `isObjectSchema()`, now read a schema's `_zod.def.type` instead of using `instanceof` against afd-server's own Zod classes, so they do not depend on which copy of Zod built the schema.

  This is a breaking install change, so it is a major. npm 7 or later, pnpm and Bun install a missing peer themselves, but these applications need a change:

  - One that depends on a `zod` outside `^4.6.6`, such as 3.25 (whose `zod/v4` entry it may have used for its commands): npm stops with `ERESOLVE` where it used to nest a second copy, and pnpm warns and then links the server to that `zod`, which it cannot run on. Upgrade the application to `zod@^4.6.6`.
  - One that never depended on `zod`, for example one that uses only `@lushly-dev/afd-view-state` or `@lushly-dev/afd-testing`, where peers are not installed automatically (Yarn, npm's `legacy-peer-deps`, or pnpm with `auto-install-peers=false`): the install warns, and the server may fail to import `zod` or find another package's copy. Add `zod@^4.6.6` to its dependencies.

### Minor Changes

- [#2528](https://github.com/lushly-dev/afd/pull/2528) [`3403a6e`](https://github.com/lushly-dev/afd/commit/3403a6e023bf1bde31301d19bf7e02363a44fff7) Thanks [@Falkicon](https://github.com/Falkicon)! - Add an OAuth 2.1 client (`afd auth login`, `status`, `refresh`, `logout`) implementing `spec/authorization.md` M9: RFC 9728 protected-resource and RFC 8414 / OIDC Discovery authorization-server metadata discovery, Client ID Metadata Document (CIMD) and pre-registered client flows, authorization code flow with PKCE (`S256`) and loopback redirect, separate owner-only token storage (`tokens.json`) outside `config.json` with automatic expiry refresh, and URL/header/token redaction ([#912](https://github.com/lushly-dev/afd/issues/912)).

- [#2864](https://github.com/lushly-dev/afd/pull/2864) [`b96288b`](https://github.com/lushly-dev/afd/commit/b96288b7e861937029f14f295c6c1484e51ee0e7) Thanks [@Falkicon](https://github.com/Falkicon)! - **Idempotency keys: a mutation a caller can safely send twice** ([#2675](https://github.com/lushly-dev/afd/issues/2675), `spec/idempotency.md`). A command declares `idempotency: 'natural'` (a repeat leaves the same state; reported as the MCP annotation `idempotentHint: true`) or `'keyed'` (a repeat with the same key and input is safe), in `_meta.idempotency`, `afd-detail` and `afd-help` (`full`). A caller sends a key in `_meta["dev.afd/idempotencyKey"]`, a meta-tool's `meta` argument, `context.idempotencyKey` in process, DirectClient's and `McpClient`'s `idempotencyKey` call option, or `afd call --idempotency-key`. Every engine validates it (1 to 200 of `A-Z a-z 0-9 . _ ~ -`, else `VALIDATION_ERROR` before confirmation, middleware or handler) and delivers it to the handler; batch items and pipeline steps run under `<key>:<i>` and `<key>:step:<i>`; a command a handler runs through the registry does not inherit it; the journal records it in `idempotencyKey` and replay restores it. `createMcpServer({ idempotency: { store, ttlMs, leaseMs } })` adds the engine's step, between the approval admission check and the handler: a repeat of a `keyed` call with a key is answered from the store with `metadata.idempotentReplay: true`, or refused with the new `IDEMPOTENCY_KEY_REUSED` (another input), `IDEMPOTENCY_IN_PROGRESS` (still running) or `OUTCOME_UNKNOWN` (the first call returned `TIMEOUT`, threw, or outlived its lease), and a `TIMEOUT` on such a call carries `recovery: { kind: 'retry' }`. A server that cannot tell its HTTP callers apart refuses such a call with `UNAUTHORIZED`, anonymous stdio connections never share keys, and `instances: 'multiple'` needs a shared `store`. A direct registry takes a step built with `createIdempotencyStep(options, { clock })`, so a host without one does not bundle it. **Behaviour changes:** the retry middleware now follows the declaration: it repeats a `natural` command, a `keyed` one only when the call carries a key, and any other unless it declares `mutation: true`; `retryMutations: true` still restores retrying everything. `idempotencyKey` is a reserved context name, so declaring a context field of that name now fails at startup, and a `context.idempotencyKey` that host code or `createContext` sets is now validated like a caller's, so a malformed one fails every call with `VALIDATION_ERROR`. A journal entry whose call carried a key hashes it as a member of `contextDigest` instead of listing its name in `keys`, so its hash differs from a recording made before. `afd validate --surface` gains `missing-idempotency`, an info finding for a `mutation: true` command that declares neither value. The three codes join the shared catalog in an `idempotency` profile.

- [#2641](https://github.com/lushly-dev/afd/pull/2641) [`cae3ac1`](https://github.com/lushly-dev/afd/commit/cae3ac179a4ba563024f90dfb29f55748677041d) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd validate --surface` now checks a server's skill catalog against Claude Code's limits when the server declares `io.modelcontextprotocol/skills`. It warns about a catalog of more than 100 skills, which Claude Code applies to every server, and, for the skills Claude Code scans (claude.ai Directory connectors and connectors with organization scanning), about a text file over 100 KB, a skill whose text files total over 400 KB, and a skill it would not load because it holds an archive, another binary file (such as WebP or OTF) or text under `dist/`. Each warning names the skill, the limit and Claude Code. Images, fonts, media and dependency lock files are not counted, and a KB is taken as 1,000 bytes. The check follows `skills/list` pages, counts dynamic skills toward the 100, and reports an entry or file it could not read as not checked; that, too, is a warning. The findings never fail the run unless `--strict` is set, and `--suppress <rule>` or `--suppress <rule>:<skill>` turns one off. `@lushly-dev/afd-testing` exports the check as `checkClaudeCodeSkillLimits`, with `CLAUDE_CODE_SKILL_LIMITS`. `McpClient.request` over `streamable-http` now forwards `skills/list` and `skills/get` instead of answering that the transport does not support them.

### Patch Changes

- Updated dependencies [[`3f13a98`](https://github.com/lushly-dev/afd/commit/3f13a984e9857444a3ebb1bd5f58299d14050924), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`612c0cb`](https://github.com/lushly-dev/afd/commit/612c0cb29ed8de62850dcd2db0e18dc365523c9f), [`e0dbde6`](https://github.com/lushly-dev/afd/commit/e0dbde69123eff2c7ff8372705dd05410701855e), [`bb791f8`](https://github.com/lushly-dev/afd/commit/bb791f81fa5b2aaf9cdf9f79c910eae0d4ff0f75), [`e179b98`](https://github.com/lushly-dev/afd/commit/e179b98aff85f0ee7d17e55cdc4fca6cb13d85bc), [`2f91ebc`](https://github.com/lushly-dev/afd/commit/2f91ebc786a4fa0cf5b3cee956ccb4a574efa576), [`b96288b`](https://github.com/lushly-dev/afd/commit/b96288b7e861937029f14f295c6c1484e51ee0e7), [`ea0155f`](https://github.com/lushly-dev/afd/commit/ea0155f120f98cb23757da697d3dd00456e77422), [`7f994c7`](https://github.com/lushly-dev/afd/commit/7f994c7e4e32c94a210e90669e59824cac0b4221), [`0bb74cc`](https://github.com/lushly-dev/afd/commit/0bb74cc86269a6b17400a30f0aabc2142a936967), [`b2fa476`](https://github.com/lushly-dev/afd/commit/b2fa4767043a672767d3b02d6c9e113e2808425b), [`e7f7b64`](https://github.com/lushly-dev/afd/commit/e7f7b64667544c05392367f2b1dc8692a8dc3b10), [`5e33124`](https://github.com/lushly-dev/afd/commit/5e33124bc3d6d698192741dc38bfbe43186fd7f1), [`ca7326e`](https://github.com/lushly-dev/afd/commit/ca7326effcfd756493344e40564772aa43e3cc81), [`3917a96`](https://github.com/lushly-dev/afd/commit/3917a966cff1cdef93dde68b9cef3ace0d676c19), [`0dc9bde`](https://github.com/lushly-dev/afd/commit/0dc9bde2e8da5670ce24b5b8f87d00a5a636f68f), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`67f32e8`](https://github.com/lushly-dev/afd/commit/67f32e875872c6da44205e6170bc5dd2d392a609), [`64247b5`](https://github.com/lushly-dev/afd/commit/64247b51e9f959be7d795708d07c145456a89e10), [`3d9ab45`](https://github.com/lushly-dev/afd/commit/3d9ab45bde620af5ebe982073089c81bf47a841e), [`cae3ac1`](https://github.com/lushly-dev/afd/commit/cae3ac179a4ba563024f90dfb29f55748677041d), [`989f34f`](https://github.com/lushly-dev/afd/commit/989f34fbafeb19fe7ce3175e73c3cc0d89257cb6), [`64f1aa0`](https://github.com/lushly-dev/afd/commit/64f1aa013cfb7dce02b7e4dece3cfc201d611e6a), [`be12d09`](https://github.com/lushly-dev/afd/commit/be12d098a66416639485d5219ecd316f62a93897), [`a91e0ea`](https://github.com/lushly-dev/afd/commit/a91e0ea58d150cb3cd04df8d34fb474e50f3a83f), [`5c9ebec`](https://github.com/lushly-dev/afd/commit/5c9ebec174e8cad39e15ef4f1d99e966bbca38a8), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543)]:
  - @lushly-dev/afd-core@3.0.0
  - @lushly-dev/afd-server@3.0.0
  - @lushly-dev/afd-client@3.0.0
  - @lushly-dev/afd-testing@3.0.0

## 2.5.0

### Minor Changes

- [#2308](https://github.com/lushly-dev/afd/pull/2308) [`e2766fc`](https://github.com/lushly-dev/afd/commit/e2766fc2769b331bf18f6d0233b1c56f31e9bffa) Thanks [@Falkicon](https://github.com/Falkicon)! - Fail closed on unannotated tools in `McpClient.call()` and `afd validate --execute` ([#1750](https://github.com/lushly-dev/afd/issues/1750), [#1755](https://github.com/lushly-dev/afd/issues/1755)).

  - `@lushly-dev/afd-client`: `McpClient.call()` now returns `OUTCOME_UNKNOWN` with `retryable: false` (and the underlying code in `details.cause`) when a timeout, dropped connection, HTTP 5xx, JSON-RPC `-32603`, or failed task poll leaves the outcome unknown for any tool not positively declared `_meta.mutation === false` before dispatch (without contradicting destructive or non-read-only markers). Tools declared `_meta.mutation === false` continue to return retryable `TIMEOUT`, `CONNECTION_ERROR`, `HTTP_5xx`, and `INTERNAL_ERROR` failures.
  - `@lushly-dev/afd-cli`: `afd validate --execute` now calls only tools positively marked read-only (`annotations.readOnlyHint === true` or `_meta.mutation === false`, without mutation/destructive/non-read-only markers). Tools without read-only metadata are skipped and reported as `skipped (not marked read-only)`, and combining `--surface` with `--execute` is rejected before connecting.

### Patch Changes

- [#1885](https://github.com/lushly-dev/afd/pull/1885) [`a9ac0fc`](https://github.com/lushly-dev/afd/commit/a9ac0fc3a57e98ac83ff6ea01c5fae5de6c6c280) Thanks [@Falkicon](https://github.com/Falkicon)! - A malformed request header is never repeated in an error, since it may hold a credential ([#1836](https://github.com/lushly-dev/afd/issues/1836)). A mistyped `-H "Authorization Bearer sk-..."` or `AFD_HEADERS` line used to print the whole header, token included, through `parseHeader` or Commander's own "argument '...' is invalid" message. The error now names only where the header came from (`--header 2`, or `AFD_HEADERS line 3`, counting blank lines) and exits 1. A header's name and value are trimmed of spaces and tabs only (`trim()` used to drop a trailing vertical tab or U+2028, and a no-break space that belonged to the value), and the value is then limited to the characters HTTP allows (tab, visible ASCII, space and 0x80–0xFF), so a control character is refused before any request. A line of `AFD_HEADERS` is blank only when it holds nothing but spaces and tabs. `-H` is now checked when the command runs rather than while Commander parses the command line: by `requireClient` for a server, before `call --module` loads its module, and before `scenario run` looks for scenarios.

- [#1518](https://github.com/lushly-dev/afd/pull/1518) [`e96c2f0`](https://github.com/lushly-dev/afd/commit/e96c2f0022745190659d9ef1eff4e024b69ce5ae) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd validate --surface` says "Commands listed with afd-discover and afd-detail" only when discovery found commands the listing did not show, now that every tool strategy lists `afd-discover` ([#533](https://github.com/lushly-dev/afd/issues/533)).

- [#1813](https://github.com/lushly-dev/afd/pull/1813) [`902e5ee`](https://github.com/lushly-dev/afd/commit/902e5ee2cb711bc9f45bf4ffa1b74dc248a0d1eb) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix P0/P1 security, reliability, and Windows compatibility bugs across TypeScript AFD packages:

  - Fail closed with `TOKEN_EXPIRED` in `createAuthMiddleware` when `afd-server`-branded credentials expire instead of falling through to the local `AuthAdapter` session, and propagate admission clock skew on the brand ([#1701](https://github.com/lushly-dev/afd/issues/1701)).
  - Enforce `requiredScopes` on `GET /sse` and post-routing on `resources/*` and `skills/*` handlers ([#1702](https://github.com/lushly-dev/afd/issues/1702)).
  - Guard `handler.admit()` and `handler.preDispatchCheck().decide()` against protocol-relative and malformed `req.url` values ([#1703](https://github.com/lushly-dev/afd/issues/1703)).
  - Bound `$input`/variable expansion nodes, characters, and combined nesting depth in `resolveVariables()` and map limit violations to `VALIDATION_ERROR` in `executePipeline()` ([#1704](https://github.com/lushly-dev/afd/issues/1704)).
  - Defer `FileJournalSink.lastSeq` assignment until `appendFile()` succeeds so failed first appends preserve unterminated/torn tail recovery ([#1705](https://github.com/lushly-dev/afd/issues/1705)).
  - Translate MCP SDK `SdkHttpError` into `HttpStatusError` in `McpClient.request()` so `call()`, `batch()`, and `pipe()` classify HTTP 4xx/5xx responses accurately ([#1706](https://github.com/lushly-dev/afd/issues/1706)).
  - Frame `PipelineResult` `isError` from step failures in `DirectTransport` on tool-surface registries ([#1707](https://github.com/lushly-dev/afd/issues/1707)).
  - Use `cwd` and normalized separators in `findScenarioFiles()` so `afd scenario run`/`validate` work on Windows and directories with glob metacharacters ([#1708](https://github.com/lushly-dev/afd/issues/1708)).

- [#1005](https://github.com/lushly-dev/afd/pull/1005) [`4eadf72`](https://github.com/lushly-dev/afd/commit/4eadf727a0a8c5ce930f7462228ad417f2bd83e6) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd scenario run` and afd-testing's `TerminalReporter` color human output only when it goes to a terminal, so piped or redirected output carries no ANSI codes ([#909](https://github.com/lushly-dev/afd/issues/909)). `NO_COLOR` or `TERM=dumb` turns color off, and `FORCE_COLOR` turns it on, or off with `0` or `false`, as chalk reads it; set `FORCE_COLOR=1` to color a pipe. `--no-color` and an explicit `colors` option still win.
- Updated dependencies [[`5962565`](https://github.com/lushly-dev/afd/commit/5962565062f2f34331f4c5e1f14b132700736959), [`274fcca`](https://github.com/lushly-dev/afd/commit/274fcca21fdeebb344a19873cea5b37a41cf80ff), [`709e64f`](https://github.com/lushly-dev/afd/commit/709e64f88733aa9879d007efe5654733f3dbd840), [`ea0cd02`](https://github.com/lushly-dev/afd/commit/ea0cd0276bc784c31f9bf923a7c67a97a06cf3dd), [`010b87a`](https://github.com/lushly-dev/afd/commit/010b87a94b39c9ae25985fdb83b3c1aec0825780), [`d676427`](https://github.com/lushly-dev/afd/commit/d6764276fdabede07f7f9eaf33785e046829a7d4), [`67ca558`](https://github.com/lushly-dev/afd/commit/67ca558ab822145a3ec2f5403b4dc94e1425cc4d), [`8c3425d`](https://github.com/lushly-dev/afd/commit/8c3425d880a4894255264a742dc57f447e6fef49), [`f1b4e51`](https://github.com/lushly-dev/afd/commit/f1b4e51fe863dcd3ba8dab509b9e9a1af390b4ce), [`8f58c33`](https://github.com/lushly-dev/afd/commit/8f58c33e2639aeebff0081921637548e9e73d12b), [`e2766fc`](https://github.com/lushly-dev/afd/commit/e2766fc2769b331bf18f6d0233b1c56f31e9bffa), [`eb33657`](https://github.com/lushly-dev/afd/commit/eb33657896346ece72368a362ded232abae08e36), [`0928fc9`](https://github.com/lushly-dev/afd/commit/0928fc99fa557b4e5dc5b52f25e560c096a2a61a), [`902e5ee`](https://github.com/lushly-dev/afd/commit/902e5ee2cb711bc9f45bf4ffa1b74dc248a0d1eb), [`bb6a71b`](https://github.com/lushly-dev/afd/commit/bb6a71b4b37084b94d52d90c659358afac9389fc), [`68b0024`](https://github.com/lushly-dev/afd/commit/68b002499c6ccd9194f48e77d5e0046fd8a1b377), [`dcabc87`](https://github.com/lushly-dev/afd/commit/dcabc87a4384dc6229608837f1fcdb1dc502773f), [`7ab1d60`](https://github.com/lushly-dev/afd/commit/7ab1d60a5cdfc6f2b0bc97c59cf6bdd0e966dd83), [`eb45732`](https://github.com/lushly-dev/afd/commit/eb4573252a377e92bcef3ffa7de3e7c38696c876), [`67bfdaa`](https://github.com/lushly-dev/afd/commit/67bfdaaef1cd56f30531c66597c950cfb8127eb1), [`7aacc49`](https://github.com/lushly-dev/afd/commit/7aacc498709944a0eef463ef3a10ba7930ce7184), [`c6e2586`](https://github.com/lushly-dev/afd/commit/c6e2586e9253f42fcf5c0f98ee369859791cc2de), [`4eadf72`](https://github.com/lushly-dev/afd/commit/4eadf727a0a8c5ce930f7462228ad417f2bd83e6), [`e28d562`](https://github.com/lushly-dev/afd/commit/e28d56294dc9f917e4e2a8e91c76baeb8fd67e1c), [`4da865f`](https://github.com/lushly-dev/afd/commit/4da865ffd7b7d7717e77b7ab83b9101b11ed8019), [`93fe92c`](https://github.com/lushly-dev/afd/commit/93fe92ccbab0660bc4e51bf78004ad0890d55418), [`c9c03be`](https://github.com/lushly-dev/afd/commit/c9c03befb0576648fcabd1ffd29717f41c0293d1), [`29d5a2f`](https://github.com/lushly-dev/afd/commit/29d5a2fa7721f1491dd923633abbbc67e9e08d95), [`9298052`](https://github.com/lushly-dev/afd/commit/9298052861aa917fa858cedd8f6f782cb20e6381), [`e96c2f0`](https://github.com/lushly-dev/afd/commit/e96c2f0022745190659d9ef1eff4e024b69ce5ae), [`641faba`](https://github.com/lushly-dev/afd/commit/641fabaa659ff9fd5eca6e2229e4eb404bd341de), [`619909a`](https://github.com/lushly-dev/afd/commit/619909adbb14f7bb3115ce4e6c6ee485676d069e), [`9c3f9f2`](https://github.com/lushly-dev/afd/commit/9c3f9f24c59c50dcd81298545f133825af2c2554), [`076b364`](https://github.com/lushly-dev/afd/commit/076b3643552fe7bac71b81f78843dc5a973f8772)]:
  - @lushly-dev/afd-server@2.5.0
  - @lushly-dev/afd-core@2.5.0
  - @lushly-dev/afd-client@2.5.0
  - @lushly-dev/afd-testing@2.5.0

## 2.4.0

### Patch Changes

- [#920](https://github.com/lushly-dev/afd/pull/920) [`5961e81`](https://github.com/lushly-dev/afd/commit/5961e81d1f4deece28360842d32a024a1cc56688) Thanks [@Falkicon](https://github.com/Falkicon)! - `@lushly-dev/afd-cli` moves its runtime dependencies to their current majors: `commander` 15, `chalk` 6, `conf` 16, `glob` 14 and `ora` 10. Each requires Node 22 or later (`commander` 22.12.0), which the CLI already requires, and none changes a command, flag or output. The saved configuration stays at the same path, so existing connections carry over. `setConfig()` no longer accepts `undefined` as a value in its types; Conf already threw on it at runtime, and `deleteConfig()` clears a value.
- Updated dependencies [[`eba33ef`](https://github.com/lushly-dev/afd/commit/eba33efa826865dabd1770941f61e1f9e86ce544), [`7aebc3f`](https://github.com/lushly-dev/afd/commit/7aebc3f5dd9cdb730f34af0d8c2620fdc1324663)]:
  - @lushly-dev/afd-server@2.4.0
  - @lushly-dev/afd-client@2.4.0
  - @lushly-dev/afd-core@2.4.0
  - @lushly-dev/afd-testing@2.4.0

## 2.3.0

### Minor Changes

- [#556](https://github.com/lushly-dev/afd/pull/556) [`0d9720a`](https://github.com/lushly-dev/afd/commit/0d9720a152313e5fdee4a19fde78da70f4d05d6f) Thanks [@Falkicon](https://github.com/Falkicon)! - Add the `hybrid` tool strategy ([`spec/tool-strategies.md`](https://github.com/lushly-dev/afd/blob/main/spec/tool-strategies.md#hybrid)).

  `createMcpServer` and `createMcpHandler` take `toolStrategy: 'hybrid'` with `firstClassTools`, an ordered list of at most 8 commands. `tools/list` is the five meta-tools (`afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`), then the `afd-context-*` tools when `contexts` are configured, then the first-class commands as individual tools. The list never varies by the active context, so `ttlMs` keeps its 300,000 default under `contexts`; a first-class command called outside its context answers `COMMAND_NOT_IN_CONTEXT`. Server creation throws, naming the entry, for an entry that is unregistered, not MCP-exposed, a meta-tool or context tool, repeated or beyond the cap, and for `firstClassTools` with any other strategy. Commands outside the set run by name and through `afd-call`, `afd-batch` and `afd-pipe`.

  `afd-help` now reports `toolStrategy` on every strategy and, on hybrid servers, `firstClassTools` and `firstClass: true`. The server also exports `ToolStrategy` and `MAX_FIRST_CLASS_TOOLS`.

  `afd validate --surface` completes a hybrid listing with `afd-discover` and `afd-detail`, and warns about a first-class command that declares `contexts`.

### Patch Changes

- Updated dependencies [[`dc3e085`](https://github.com/lushly-dev/afd/commit/dc3e085a51e2a8a2e1b8b693f1ed1de69d949d65), [`5917cf5`](https://github.com/lushly-dev/afd/commit/5917cf5625b316c5c67ab5941321267d1de7f01d), [`6c2390e`](https://github.com/lushly-dev/afd/commit/6c2390e33b45a4df11c47f8f9fc7daa9c80a4891), [`8e2e46f`](https://github.com/lushly-dev/afd/commit/8e2e46f4283d7c9fb3cafbfd0006efbe09495c42), [`8f8f94b`](https://github.com/lushly-dev/afd/commit/8f8f94b412f4304e61d0a15d7e65ffcbab4c95b9), [`5f11192`](https://github.com/lushly-dev/afd/commit/5f111922eee6240e116cbb267bc4d410ba2f2743), [`560c603`](https://github.com/lushly-dev/afd/commit/560c6033cc32d1b2b6f18e3329c057466175b4c7), [`2ab549a`](https://github.com/lushly-dev/afd/commit/2ab549a40614f998c9004fe8a103c62e8a8597c2), [`43c6fc7`](https://github.com/lushly-dev/afd/commit/43c6fc79e71c17eae2ed3286b1756f6543b4694d), [`0d9720a`](https://github.com/lushly-dev/afd/commit/0d9720a152313e5fdee4a19fde78da70f4d05d6f), [`0c9192f`](https://github.com/lushly-dev/afd/commit/0c9192feaa7db53cb57f9be72041e784eed09007), [`c80a9b4`](https://github.com/lushly-dev/afd/commit/c80a9b4dc9078f408876ab0250d8d82c40653dc2), [`550bf0c`](https://github.com/lushly-dev/afd/commit/550bf0ce016c00ad8b67ad62799444ec4e79fe78), [`13c2a8f`](https://github.com/lushly-dev/afd/commit/13c2a8f4294518e4f9b2587206f82a88700a2303), [`0e8fbcf`](https://github.com/lushly-dev/afd/commit/0e8fbcffc9838e7f90817fdf65bf57562e201b31), [`c329e9d`](https://github.com/lushly-dev/afd/commit/c329e9d15c60b14bc874ad6e08b6d4fe5ec2d4e2), [`280f65f`](https://github.com/lushly-dev/afd/commit/280f65f4a488139eb7f80d2e5347d3a16f9b9957), [`7ae2bc2`](https://github.com/lushly-dev/afd/commit/7ae2bc2c08932c3fe074dd3620b53b34326cb291)]:
  - @lushly-dev/afd-core@2.3.0
  - @lushly-dev/afd-client@2.3.0
  - @lushly-dev/afd-server@2.3.0
  - @lushly-dev/afd-testing@2.3.0

## 2.2.1

### Patch Changes

- [#479](https://github.com/lushly-dev/afd/pull/479) [`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e) Thanks [@Falkicon](https://github.com/Falkicon)! - Keep DirectClient approval credentials in a private exchange instead of returning them to the gated caller. Public call, pipe and DirectRegistry contexts discard caller-supplied approval evidence; only an affirmative trusted hook enables one verified retry. Preserve in-process CLI approval through the same exchange.

  Use matching client, core and server versions. Applications that submitted approval tokens directly through createDirectRegistry must migrate to DirectClient's onApprovalNeeded hook. Custom registries must support the private exchange; legacy token-in-result failures remain held and are returned without their token.

- Updated dependencies [[`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e)]:
  - @lushly-dev/afd-core@2.2.1
  - @lushly-dev/afd-client@2.2.1
  - @lushly-dev/afd-server@2.2.1
  - @lushly-dev/afd-testing@2.2.1

## 2.2.0

### Minor Changes

- [#432](https://github.com/lushly-dev/afd/pull/432) [`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0) Thanks [@Falkicon](https://github.com/Falkicon)! - Pre-execution approvals ([#272](https://github.com/lushly-dev/afd/issues/272)): a command can be held for a human's sign-off before its handler runs.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `approval` (`'required'`, `'not-required'` or a function of the validated input and context; `ApprovalPolicy`, `ApprovalDecision`), and `CommandContext` gains `approval`, the approval token. `ErrorCodes.APPROVAL_REQUIRED` joins the shared catalog (45 codes). Tool `_meta` reports `approval` as `'required'`, `'not-required'` or `'conditional'` (a function; `approvalMode()`).
  - `@lushly-dev/afd-server`: `defineCommand` accepts `approval` and keeps it through `toCommandDefinition()`; afd-detail and afd-docs report it. New `createApprovalMiddleware({ secret, commands })` returns `APPROVAL_REQUIRED` before the handler when a call needs approval and `context.approval` holds no valid token. `details` carries `approvalToken`, `expiresAt`, `summary` and, for a rejected token, `reason`. Tokens are HMAC-SHA256-signed with an app-supplied secret (required, at least 32 bytes, rotatable), bound to the command, the canonical validated input and the actor, short-lived (5 minutes by default) and single-use by default (`replay: 'within-ttl'` to allow reuse; `nonceStore` for several instances). Options `summarize`, `includeToken`, `onApprovalRequired` and `clock`.
  - `@lushly-dev/afd-cli`: `afd validate` warns (`MISSING_APPROVAL_POLICY`) about `mutation` or `destructive` tools, and grouped-tool actions, whose `_meta` declares no approval policy.

- [#446](https://github.com/lushly-dev/afd/pull/446) [`99fa015`](https://github.com/lushly-dev/afd/commit/99fa01517754c8b123cdca535f58cdf0a77977d9) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd call` approval flow ([#417](https://github.com/lushly-dev/afd/issues/417)). New `--module <path>` (with `--export`) runs a call in-process on the registry a module exports. When such a call fails with `APPROVAL_REQUIRED`, the CLI prints the summary and expiry, asks `Approve? [y/N]` on a terminal, and on yes retries the same command and input with the server's `details.approvalToken` as `context.approval`. `--approve` approves without asking, once, and only with a token the server returned for this call; the CLI never makes one. With no terminal and no `--approve`, the `APPROVAL_REQUIRED` result is printed unchanged with exit code 1. Over MCP the CLI cannot deliver approval evidence (tool arguments never carry it and MCP has no trusted channel yet), so `--approve` is rejected there and the result is returned unchanged.

- [#438](https://github.com/lushly-dev/afd/pull/438) [`439cd60`](https://github.com/lushly-dev/afd/commit/439cd6015542bd3be405728140506cd14aba1611) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `afd replay <file> --module <path>` ([#423](https://github.com/lushly-dev/afd/issues/423)): replay a JSON Lines command journal against a fresh in-process registry with `replayJournal` and print each entry as `same`, `different` (with the changed paths) or `error`. Exits 1 on any divergence and 2 when the journal or module cannot be loaded, so it works as a CI regression check. Options: `--export`, `--ignore`, `--seed`, `--stop-on-divergence`, `--from`/`--to`, `--format json` and `--verbose`. The journal is bounded (64 MiB file, `--max-line-bytes` 1 MiB, `--max-entries` 10,000) before parsing. Replay over MCP is not supported, because a remote server cannot be given the recorded clock and random values. `@lushly-dev/afd-server` is now a runtime dependency of the CLI.

- [#392](https://github.com/lushly-dev/afd/pull/392) [`cf7fc58`](https://github.com/lushly-dev/afd/commit/cf7fc58dddd8b7005b50cd3a038e49849351eb63) Thanks [@Falkicon](https://github.com/Falkicon)! - Talk MCP 2026-07-28 from the client, CLI and testing tools.

  - `@lushly-dev/afd-client`: new `streamable-http` transport, built on the official MCP TypeScript SDK v2 client. It speaks MCP 2026-07-28 when the server offers it and falls back to the 2025 `initialize` handshake, so `McpClient` now talks to an AFD server's `/mcp` endpoint, the Python and Rust AFD servers, and any official MCP SDK server. It is the default for URLs that do not end in `/sse`; `protocolMode: 'auto' | 'legacy' | 'modern'` controls negotiation. `stream()` on a `/mcp` URL uses the sibling `/stream` path. The `sse` and `http` transports are deprecated and removed in 3.0.
  - `@lushly-dev/afd-cli`: `--transport` accepts `streamable-http`, and `connect`, `call --connect`, `shell` and `scenario run` infer the transport from the URL (`sse` for `/sse`, `http` for `/message`, `streamable-http` otherwise) instead of defaulting to `sse` or `http`.
  - `@lushly-dev/afd-testing`: the mock MCP servers are dual-era. `initialize` echoes a supported requested version (the newest legacy revision otherwise, instead of always `2024-11-05`), and requests carrying MCP 2026-07-28 `_meta` get `server/discover`, `resultType`, `serverInfo`, cache fields and `-32022` for unsupported versions.

- [#435](https://github.com/lushly-dev/afd/pull/435) [`0e66fdb`](https://github.com/lushly-dev/afd/commit/0e66fdb5e666f7c36037a4d126374161f563807f) Thanks [@Falkicon](https://github.com/Falkicon)! - Enforce `confirmPrompt` (`spec/command-metadata.md`, "Confirmations").

  - **Server:** `createMcpServer` and `createMcpHandler` take `confirmations` (`'off'` by default, `'enforce'` or `'require-human'`) and `confirmationKey`. A call that reaches a command with `confirmPrompt` runs only after the user accepts an MCP elicitation, through an `input_required` result on `/mcp` or a server-side elicitation on a 2025 stdio connection. Under `'enforce'` the caller can instead acknowledge: `confirm: true` on the tool, `afd-call` or a grouped tool, `confirm: [names]` on `afd-batch` and `afd-pipe`, `_meta["dev.afd/confirm"]`, or the `Afd-Confirm` header on `/rpc`, `/batch` and `/stream`. Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the handler runs. Gated tools advertise the optional `confirm` argument.
  - **Client:** `McpClient` takes `onElicitation` to answer servers' form elicitations on the `streamable-http` transport. Without it, an `input_required` result becomes an `INPUT_REQUIRED` failure carrying the server's `inputRequests`.
  - **CLI:** at a terminal, the CLI asks a server's yes/no elicitation (`[y/N]`) on stderr; otherwise it declares no elicitation, so the server's error explains how to acknowledge.

### Patch Changes

- Updated dependencies [[`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0), [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60), [`f152bb9`](https://github.com/lushly-dev/afd/commit/f152bb93c62a3fe06162705b37abcd0ddfc29fc9), [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd), [`50e17b6`](https://github.com/lushly-dev/afd/commit/50e17b60e3334b8d8ae314719e417002aa35bfd3), [`99fa015`](https://github.com/lushly-dev/afd/commit/99fa01517754c8b123cdca535f58cdf0a77977d9), [`cf7fc58`](https://github.com/lushly-dev/afd/commit/cf7fc58dddd8b7005b50cd3a038e49849351eb63), [`2e10d29`](https://github.com/lushly-dev/afd/commit/2e10d299627da1286b14052d7ec073ba8d652f3d), [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd), [`a73a6b9`](https://github.com/lushly-dev/afd/commit/a73a6b9399154796b15c1a3d8359d755b3c7a761), [`0e66fdb`](https://github.com/lushly-dev/afd/commit/0e66fdb5e666f7c36037a4d126374161f563807f), [`ac87f87`](https://github.com/lushly-dev/afd/commit/ac87f879217c1af4f4536eeaf8f7e6613f47eea4)]:
  - @lushly-dev/afd-core@2.2.0
  - @lushly-dev/afd-server@2.2.0
  - @lushly-dev/afd-client@2.2.0
  - @lushly-dev/afd-testing@2.2.0

## 2.1.0

### Minor Changes

- [#308](https://github.com/lushly-dev/afd/pull/308) [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95) Thanks [@Falkicon](https://github.com/Falkicon)! - Commands carry `destructive`, `confirmPrompt` and `undoable` in both definitions, and every surface reports them consistently ([#275](https://github.com/lushly-dev/afd/issues/275)). The canonical field list is in `spec/command-metadata.md`.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `destructive` and `confirmPrompt`, which only the Zod definitions had. `McpToolCommandMeta` gains `undoable`.
  - `@lushly-dev/afd-server`: `defineCommand` accepts `undoable`, and `toCommandDefinition()` now keeps `destructive`, `confirmPrompt` and `undoable` instead of dropping the first two. `undoable` is reported in the tool `_meta` (and in each grouped `_meta.actions` entry) when set, like `destructive`. It is also reported by `afd-detail`, `afd-help` with `format: 'full'` and `DirectRegistry.listCommands()`. `afd-help` full also reports `destructive`. `afd-docs` documents all three.
  - `@lushly-dev/afd-cli`: `afd tools` marks tools whose `_meta` sets `destructive` or `undoable`, for example `todo-delete (destructive, undoable)`.
  - `@lushly-dev/afd-client`: `createReconnectingHandoff` falls back to core's `defaultReconnectPolicy` (3 attempts, 1000 ms) when neither the options nor the handoff's `metadata.reconnect` set `maxAttempts` or `backoffMs`. It used to fall back to 5 attempts.

### Patch Changes

- [#367](https://github.com/lushly-dev/afd/pull/367) [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568) Thanks [@Falkicon](https://github.com/Falkicon)! - Return a failing exit status for unsuccessful streams and validate record IDs consistently in the memory adapter.

- [#292](https://github.com/lushly-dev/afd/pull/292) [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd validate --surface` now validates the server's commands whatever its `toolStrategy`. Against the default `grouped` strategy it used to validate the grouped tools themselves, so a two-command `todo` server failed with a `naming-convention` error for the tool `todo` and reported schema-complexity and missing-category findings for `todo`, `afd-batch`, `afd-pipe`, `afd-call` and `afd-detail`. Now:

  - grouped tools are expanded into one command per `_meta.actions` entry, with that command's name, description, input schema and metadata;
  - lazy servers, which list no command tools, are enumerated with `afd-discover` and `afd-detail`; so are grouped tools that do not list their actions;
  - the tools AFD provides itself (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema`, `afd-context-*`) are skipped in every strategy.

  The output says which grouped tools were expanded and which built-in tools were skipped. If discovery fails, the listed tools are validated as before and a warning says why.

  `@lushly-dev/afd-core` exports the built-in names as `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `isAfdBuiltinName()`, which the server now uses for its reserved names. `McpTool['_meta']` now types a grouped tool's `actions`.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-core@2.1.0
  - @lushly-dev/afd-client@2.1.0
  - @lushly-dev/afd-testing@2.1.0

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Harden CLI output and credentials, and fix the shell, scenario runner and tool listing.

  - **Security:** text output no longer passes server escape sequences to the terminal. Error messages, suggestions, warnings, reasoning, sources, data strings, tool names and descriptions, stream data, validation and scenario output go through a new `sanitizeForTerminal()`, which strips C0/C1 control characters and ESC sequences (OSC title/hyperlink/clipboard, CSI cursor movement, DCS/APC strings) but keeps newlines and tabs. JSON output is unchanged.
  - **Security:** the config file is written with mode `0600` (an older, wider file is narrowed on the next run). Printed URLs have their userinfo and token-like query parameters (`token`, `key`, `secret`, `auth`, `password`, ...) replaced with `***`, and `afd connect` warns when it saves a URL that carries credentials.
  - **New:** `-H, --header "Name: value"` (repeatable) on `connect`, `status`, `tools`, `call`, `batch`, `stream`, `validate`, `shell` and `scenario run`, plus the `AFD_HEADERS` environment variable (one header per line). Headers are sent on every request, including SSE and `/stream`, and are never saved. A failed connection now names the (redacted) URL and the reason, and suggests `--header`/`AFD_HEADERS`.
  - **New:** `afd scenario run --no-stop-on-failure` runs every scenario; stopping at the first failure stays the default and now also stops on a `partial` scenario. Step progress is attributed to the running scenario instead of the first one that uses the same command name, and scenario files run in sorted path order.
  - **New:** `afd shell --transport`, `--timeout` and `--no-reconnect`. The shell uses the saved transport and timeout (it used the client defaults), infers SSE/HTTP from a `--url`/`connect <url> [sse|http]`, and saves the URL together with its transport, timeout and reconnect choice. `afd connect --no-reconnect` is saved for the shell instead of being ignored.
  - **Behaviour change:** tool arguments (`call`, `stream`, shell) are parsed by one shared parser. The shell splits off only the command name, so whitespace inside JSON strings survives; `key="quoted value"` and `key=["json", "array"]` keep their spaces; and a word without `=` is now an error instead of being dropped silently.
  - **Behaviour change:** shell shorthand (`todo-create {...}`) works for kebab-case names that are in the tool list or look like AFD command names, not only dotted names. `exit` closes the input, lets queued commands finish and disconnects, instead of calling `process.exit`; lines after `exit` are ignored.
  - **Behaviour change:** `afd tools` groups by `_meta.category`, falling back to the kebab-case prefix before the first `-`, and shows full tool names. `--category` matches the same grouping.
  - `--transport` values are validated (`sse`, `http`). The CLI e2e tests rebuild `dist` in a Vitest global setup when it is older than `src`, and fail with a clear message if a workspace package they run on is stale.

### Patch Changes

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Make `afd validate` safe by default and stop CLI commands hanging over SSE.

  - **Behaviour change:** `afd validate` no longer executes tools. By default it checks only the `tools/list` entries: names, descriptions, input schemas, and `_meta.examples`. Pass `--execute` to call tools as before. Even then, tools marked `_meta.mutation: true` or `_meta.destructive: true` are skipped and reported per tool. Each call uses `_meta.examples[0].input` when the server provides one, otherwise `{}`.
  - `connect`, `call`, `status`, `tools`, `batch`, `stream` and `validate` now exit after printing their result over SSE. The CLI disconnects its client when a command finishes, and one-shot commands no longer auto-reconnect. `shell` finishes queued input before it disconnects.
  - `--category` on `validate` and `tools` (and `tools <category>` in `shell`) now matches `_meta.category`. Tools without a category match on the kebab-case `<category>-` name prefix instead of `<category>.`.
  - Confidence and progress bars no longer throw `RangeError` for values outside 0–1.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd scenario init` writes a sample that the stricter scenario parser accepts: `todo-toggle` instead of the nonexistent `todo-complete`, a numeric `gte` check on `total`, and no unsupported `verify` block.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`d091ef3`](https://github.com/lushly-dev/afd/commit/d091ef386cbbf141022b805f5382e47fcf94c95c), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f8a9d85`](https://github.com/lushly-dev/afd/commit/f8a9d851531bf2c2edea7284f031c68d7b22a455), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0
  - @lushly-dev/afd-client@2.0.0
  - @lushly-dev/afd-testing@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-client@1.0.0
  - @lushly-dev/afd-core@1.0.0
  - @lushly-dev/afd-testing@1.0.0

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
  - @lushly-dev/afd-client@1.0.0
  - @lushly-dev/afd-testing@1.0.0
