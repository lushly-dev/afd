---
"lushly-botcore": minor
---

### Added

- **`botcore-factory` `provenance-rerecorded` record and report count**: the lane writes a dedicated `provenance-rerecorded` measurement record (raising record schema to 4) whenever `regenerate` resolves a provenance-only merge conflict, and `lane-report` reports `provenanceRerecorded` and its comparison delta (#1472).
