---
"afd-spec": patch
---

A step of an `afd-batch` or `afd-pipe` approved up front is validated, when it runs, on the input it is about to run as well as on the input as sent, and the schema must read that input back to the same canonical JSON (`command-metadata.md`, "One approval up front for `afd-batch` and `afd-pipe`"). A retry whose gated step had no kept input, whose input no longer has the binding of any approval it carries, and that is too long to keep with a new question is refused with `APPROVAL_REQUIRED` and `details.reason: "input-not-kept"` instead of being asked about again without end; an approval that only expired is still asked about again.
