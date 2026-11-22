---
"afd-spec": patch
---

Define the specification-authored vs. mechanically generated vector provenance rule in `spec/vectors/README.md`, establish AFD's nine-code validation issue catalog in `spec/validation.md` with advisory issue wording, and add the CI drift and behaviour-change changeset guard (`scripts/check-vector-drift.mjs`) (#1734).

Define server default deadlines (`30000` ms), cooperative cancellation propagation, batch ceilings (`maxBatchSize = 500`, `maxBatchParallelism = 16`) and the non-silent validation issue cap (`maxValidationIssues = 100`) in `spec/execution-controls.md`, with specification-authored vectors in `spec/vectors/execution-controls.json` loaded by all four languages (#1737).

Add the shared protocol conformance case file (`spec/protocol-conformance.json`) covering discovery, exposure and D4 hiding, batch, pipe, contexts in both MCP eras, and JSON Schema validation against `spec/schema/{result,batch,pipeline,stream}.json`, plus packed-artifact verification in `.github/workflows/release.yml` (#1739).
