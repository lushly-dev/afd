---
"afd-spec": patch
---

Move TypeScript (#2128), Python (#2129), Rust (#2130), and C++ batch limits and validation issue cap (#2131) from `gaps` to executed in `spec/vectors/execution-controls.json` and `spec/execution-controls.md`, leaving only C++ single-command deadlines and cancellation tracked in #1766.

Regenerate `spec/vectors/validation.json` to replace `issue-count-uncapped` with `issue-count-capped`, pinning the default `maxValidationIssues = 100` cap, `details.truncated`, `details.limit`, `details.totalErrors`, and truncation suggestion notice across all four languages.
