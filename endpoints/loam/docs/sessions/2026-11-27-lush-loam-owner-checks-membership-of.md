# Owner checks read the call's membership (#2785)

- Date: 2026-11-27
- Area: phase 3, identity
- Pull request: [#2979](https://github.com/lushly-dev/afd/pull/2979), on `lush/loam-owner-checks-membership-of`, for [#2785](https://github.com/lushly-dev/afd/issues/2785)

The settings', experiments', limits' and autonomy's `isOwner` now take the call and read
`scope.membershipOf(call)` (`kernel/src/late/index.ts`), as the agent-member, scope and member owner
checks already did. A principal-gated server kernel holds no members kernel-wide, so before this an
owner principal reached through phase 6's `callAs` was refused `OWNER_REQUIRED`. The browser kernel
is unchanged: there `membershipOf` returns the kernel's own membership. The specification's
2026-11-21 follow-up row is closed in place.

Verified 2026-11-27 on Node 26: `server/trust-records.test.ts` holds `limit-usage-get` for an owner
principal and refuses a member; it fails without the `late/index.ts` change. `pnpm verify
--keep-going` on `66e348140` failed only timing-bound tests while other verifies ran on this machine
(tally's replay, `mount.test.ts`'s P6-E5, a rail focus case and `relay-limits.test.ts`). Each
passed when rerun alone, apart from the rail case, which was left to CI. A second `test:hosted` run
failed a different timing case (P6-H8's crash restart). Linux CI is the authoritative run.
