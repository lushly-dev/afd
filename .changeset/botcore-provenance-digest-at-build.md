---
"lushly-botcore": patch
---

### Changed

- **Provenance digest at build time**: the repository's `provenance/provenance.json` no longer
  commits the sha256 of `adaptations.json`, whose one line made any two branches that recorded
  different files conflict. A new build hook (`hatch_build.py`) stamps it into the wheel's and
  sdist's `provenance.json`, computed from the `adaptations.json` they ship, so the published
  records are unchanged; `scripts/verify_provenance.py --artifacts dist` checks a build
  (lushly-dev/afd#1610).
