---
"afd-python": minor
---

### Added

- **`ErrorCodes.APPROVAL_UNAVAILABLE`**, which joins the shared catalog (`spec/command-metadata.md`, "Approvals"): a server engine refuses a command whose declared approval policy is not `not-required` when no approval step admitted the call. Python defines the constant; its engine does not refuse such calls yet.
