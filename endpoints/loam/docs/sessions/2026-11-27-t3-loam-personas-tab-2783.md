# Loam: the account section's personas tab (#2783)

- Date: 2026-11-27
- Area: phase 3, identity
- Pull request: [#3050](https://github.com/lushly-dev/afd/pull/3050), on `lush/loam-account-personas-tab`, for [#2783](https://github.com/lushly-dev/afd/issues/2783)

Built the account section's `personas` tab (phase 3 specification, 5.1), which step 5 left to the
account menu's switch: `chrome/src/identity/personas.ts`, in the `account` chunk, lists the
person's personas, switches, edits, removes and makes them, each through its `persona-*` command.
Recorded in the specification's status ("After the exit, the personas tab"), with its D115 raise of
`accountMinified` (to 49,400 once merged with #2781's and #2784's raises) and an open follow-up row, filed as
[#3017](https://github.com/lushly-dev/afd/issues/3017): the tab has no form for a persona's avatar,
defaults or emphasis.

Verified 2026-11-27 on Node 26: `persona.test.ts`, `specimen.test.ts`,
`identity/accessibility.test.ts` and `identity/account.test.ts` in Chromium, `pnpm -F @lushly-dev/loam-web budget`, and
`pnpm verify`.
