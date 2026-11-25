---
"@lushly-dev/specimen-afd": minor
---

Add `ExecuteSpecimenCommandOptions` (`actor`, `humanConfirmed`, `confirmedBy`) to `executeSpecimenCommand` so MCP hosts enforcing `confirmations: 'require-human'` record `decidedBy: { kind: 'person' }` exclusively from accepted human elicitation while CLI calls continue recording `decidedBy: { kind: 'script' }` (#2213).
