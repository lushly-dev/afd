---
'@lushly-dev/specimen-afd': patch
---

Allow the `events` channel in `specimen-diff`'s output schema, constrained to `ChannelDifference['channel']`, so comparing two observations whose recorded event histories differ returns `status: 'changed'` instead of failing with `SPECIMEN_OUTPUT_INVALID` (#1131).
