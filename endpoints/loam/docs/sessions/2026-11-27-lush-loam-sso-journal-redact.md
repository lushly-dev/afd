# Single sign-on state kept out of the journal (#2786)

- Date: 2026-11-27
- Area: phase 3, identity
- Pull request: [#2983](https://github.com/lushly-dev/afd/pull/2983), on `lush/loam-sso-journal-redact`, for [#2786](https://github.com/lushly-dev/afd/issues/2786)

Decided to redact rather than accept: `redactJournalRecord` (`kernel/src/journal-redact.ts`) cuts an
`auth-sign-in` record's `SIGN_IN_REDIRECT` warning's authorize URL to its origin and path, so the
journal keeps where sign-in continued but neither the single-use `state` nor the PKCE challenge. A URL
that does not parse is withheld whole. The caller's own answer still carries the full URL. A replay
never follows it: its Mock signs in at once, so a redirecting entry already diverged on replay before
this change, whatever its URL held; the reviews found that, filed as
[#2954](https://github.com/lushly-dev/afd/issues/2954). The specification's 2026-11-22 follow-up row
is closed in place, and P3-E15's row names the cut. The redactor is in first paint: under D115,
`budget`'s minified JavaScript ceiling rose from 353,000 to 354,000 bytes (353,363 measured), and the kernel's alone from
165,300 to 166,000 (165,516).

Verified 2026-11-27 on Node 26 with `pnpm vitest run src/kernel.test.ts` in
`endpoints/loam/packages/kernel`, whose two new cases fail with the redaction removed, and `pnpm verify`.
