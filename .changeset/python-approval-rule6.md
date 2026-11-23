---
"afd-python": minor
---

### Changed

- **`create_approval_middleware`'s `include_token` now defaults to `None`**, matching `spec/command-metadata.md`, "Approvals", rule 6 ([#1665](https://github.com/lushly-dev/afd/issues/1665)). When unset, `APPROVAL_REQUIRED` omits `details.approvalToken` for calls whose `context.extra["interface"]` is `"mcp"` and includes it elsewhere, matching TypeScript, Rust and C++. Pass `include_token=True` to opt in on MCP calls, or `include_token=False` to omit it on non-MCP calls.
