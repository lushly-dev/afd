---
"@lushly-dev/afd-core": patch
---

`commandResultOutputSchema` moves an output schema's `$defs` and `definitions` from `data` to the envelope's root (#1416). `#/$defs/...` and `#/definitions/...` references resolve against the document root, so a command whose output schema keeps nested types there, as Zod does for a recursive type, advertised an `outputSchema` whose references pointed nowhere, and an MCP client rejected the tool's results. Python and C++ already did this.
