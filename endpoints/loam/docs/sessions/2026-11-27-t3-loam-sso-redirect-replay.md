# Replay redirecting single sign-on `auth-sign-in` without diverging (#2954)

- Date: 2026-11-27
- Area: phase 3, identity
- Pull request: [#3042](https://github.com/lushly-dev/afd/pull/3042), on `t3/loam-bug-sweep-step9a-auth-export-chrome`, for [#2954](https://github.com/lushly-dev/afd/issues/2954)

`replayKernel` (`endpoints/loam/packages/kernel/src/testing.ts`) now drives its `MockAuthAdapter`
to return the recorded `{ kind: 'redirect', url? }` outcome when replaying a successful `oauth`
`auth-sign-in` entry carrying a `SIGN_IN_REDIRECT` warning. Running the entry through the full
command pipeline keeps `provider`-mode `identity.methods` checks, input validation, `afd-auth`'s
`incompleteSignIn` handler, and whole-result session-state comparison active while leaving the
replay Mock's session state unchanged (matching the live redirect).

`endpoints/loam/packages/kernel/src/testing.test.ts` verifies local and bare-URL redirects,
`provider`-mode redirect + reload-return settlement, non-redirecting synchronous `oauth` sign-ins,
and `REPLAY_DIVERGED` on disallowed `identity.methods` or tampered session/method entries. The fix
lives solely in `@lushly-dev/loam-kernel/testing`, so first-paint bundle sizes are unchanged.
