# A list bounds a confirmation's preview, so a 64 KiB one never breaks the inbox (#2801)

- Date: 2026-11-27
- Area: phase 5, bus, copilot and mounted servers
- Pull request: on `fleet/2801-inbox-preview-budget`, for [#2801](https://github.com/lushly-dev/afd/issues/2801)

A mounted command's preview may be up to 64 KiB (`PREVIEW_MAX_BYTES`), but a `notification-list`
page is bounded at 32,768 bytes, and a person's list kept the preview whole even without `body`.
A preview over about 32 KiB made the list refuse (`OUTPUT_BUDGET_EXCEEDED`), with it the bell's
`{ limit: 1, unread: true }` read, which then showed 0, until the confirmation was archived.

A list read now bounds the preview as it bounds the input (`listedPreviewOf`, beside `summaryOf` in
`settings/confirmation-parts.ts`), whatever the confirmation's state. Without `body`, a listed
preview keeps `command`, `digest`, `labels` and `changed` and leaves `data` out. With `body`, data
past `LISTED_PREVIEW_BYTES` (8,192) is left out and the preview carries `truncated: true` and its
`bytes`. A read by id (`notification`) still shows it whole. The SDK's `ConfirmationPreviewV1`
gains `truncated` and `bytes`. The refusal stays as a backstop, and its suggestion now names the
read by id with `body: true`, which never refuses. The inbox treats a cut preview as a cut input:
it says the preview is too long to list, and offers "Show the full preview" in place of Confirm
until the read by id has shown it (`inbox/inbox-cut.ts`). A change of person or access now also
forgets what was read whole, and a read by id begun before it, in the inbox or for the notice it opens at, shows nothing after it.

Verified 2026-11-27 on Hero. In the kernel, `notifications.test.ts`'s #2801 cases seed a
65,536-byte preview, pending and declined, and read it as the bell, the inbox, by id and as an
agent; a row past the page's budget is refused with the new suggestion, and following it answers.
`mounted-approvals.test.ts` lists a real mounted 65,536-byte preview the same way.
`chrome/src/apps/inbox-bell.test.ts` drives the bell against a real kernel with a 64 KiB
confirmation. With the kernel's bound removed, all three fail with the issue's refusal.
`web/test/browser/confirmations.test.ts`'s #2801 case runs `loam-inbox` in Chromium on a stubbed
`notification-list`: Confirm is withheld until "Show the full preview" reads it whole, and
again for a reshown confirmation's new id.

Size limits (D115): `inbox` 12,366 to 13,076, so its ceiling goes from 12,700 to 13,400;
`late-settings` 130,466 of 130,500, unchanged.

Review: Claude Opus 5.5 (high) approved, with five improvements. Gemini 4 Neon (high) asked for
two fixes: a test of the inbox element itself, and a test of the refusal's suggestion. Both
were made, along with the improvements: the real-kernel bell test, clearing on a change of
access, an agent's read at 64 KiB, the wording of an ended row, and the SDK's comments.
