# Phase 2 Botcore import validation

Imported 541 reviewed frozen **staged-input** files, verifying each staging hash
before copying. That input includes staging additions and modified upstream files;
it is not an immutable upstream source manifest. The exact original bytes are retained
as `provenance/staged-input-allowlist.json` and explicitly labeled by the envelope.
`upstream-selected.json` is independently derived exclusively from Git objects at
`7d5c54cae8aae90e145374467456af619cf54e41` in the separate public clone.
`adaptations.json` records original SHA or null, staged SHA or null, current-import
SHA, classifications and reasons for each transition. Both provenance directories
contain identical bytes; immutable source/staging digests are pinned in the verifier.
The envelope advertises each manifest's hash and explicit original authority/quarantine.
The immutable Git baseline contains 532 paths (531 staged selections plus the original
AGENTS reference). The frozen staged input contains 523 unchanged upstream files,
8 modified upstream files and 10 staging additions. The current chain classifies
550 files: 518 exact staged imports, 23 subsequent modifications and 9 subsequent additions.
Future canonical skill/source edits must update the reviewed adaptation record without
rewriting the immutable original or staged evidence.

The root adaptation is `lushly-botcore` 0.6.0. Optional distribution names/versions
are unchanged. Built metadata retains `afd>=0.9.0`; the development-only uv source
points to `../../python`, locking actual AFD 0.10.0 and MCP 2.3.0. Existing legacy
trusted-local CLI/MCP aliases are retained, with a lazy MCP 1/2 SDK adapter.

Verified on the actual imported endpoint:

| Check | Evidence |
| --- | --- |
| Python 3.11.16 core tests | 703 passed in 4.22 s |
| Python 3.12.14 core tests | 703 passed in 4.43 s |
| Scope | `pytest tests/ --ignore=tests/integration -q`, including new host, legacy config stamp, Git-fixture isolation, and missing optional connector invocation regressions |
| Lint | `ruff check src/ tests/ scripts/ packages/botcore-agents/src/` passed |
| Locks | Root and existing `botcore-connectors` `uv lock --check` passed; frozen core sync passed on both Python versions |
| Artifacts | All six wheels and six sdists built; exact MIT notice bytes present, all 55 bundled skills present, packaged provenance/hash verified, normal registry dependency metadata retained |
| External installed-wheel consumer | Ordinary app manifest has no platform runtime dependencies; built Botcore + separately built AFD 0.10 wheel + registry MCP 2.3 passed DirectClient info, managed MCP discovery, inspection writer denial and npm category safe denial |
| Minimum compatibility smoke | Actual 0.6.0 wheel with registry AFD 0.9.0 and MCP 1.26 passed the same external consumer; that older SDK stack emitted a Pydantic-settings forward-reference warning |
| Publisher changes | None; all distributions quarantined and original Botcore repository remains authoritative |

Reproduce the artifact/consumer gate with `uv run --frozen python scripts/package_smoke.py`.
It creates external temporary fixture directories, builds distributions without uv source
substitution, and clears inherited `GIT_*`, `PYTHONPATH`, and virtual-environment routing
for child builds/consumers. Its regression proves child `git add` cannot write the caller's
index while preserving the caller's environment.

The agents package now declares `botcore-agents[connectors]` for wildcard discovery.
A missing/incompatible connector adapter returns actionable `INTEGRATION_UNAVAILABLE`
before LLM session creation; custom explicit/named connector namespaces remain independent.
The regression runs real plugin configuration/models/orchestrator with only the session
boundary mocked. This does not establish full agents/LLM runtime acceptance.

Optional stateful plugins and integration scenarios are preserved but are not admitted to
managed multi-worktree dispatch without per-host adapters and explicit effects policies.
The core gate explicitly excludes those integration scenarios; they were not counted as
passes. Artifact builds are not optional-plugin runtime/import/export coverage. Hosted CI,
publication, authority handoff, and complete Phase 2/Alfred acceptance are separate evidence.


The provenance regression rejects rehashed false upstream/staged claims and incorrect
unchanged classifications, and verifies a known license blob against its Git object ID.
Native runner outcomes distinguish absent executable/module (`unavailable`), timeout or
infrastructure errors (`error`), and completed failing checks (`failed`). Managed quality
surfaces preserve those distinctions; broken documentation links remain a failed check.
