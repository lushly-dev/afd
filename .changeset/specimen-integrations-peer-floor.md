---
'@lushly-dev/specimen-afd': patch
'@lushly-dev/specimen-fast-af': patch
---

Each integration's peer on `@lushly-dev/specimen` (and, for `specimen-fast-af`, on `@lushly-dev/fast-element`) now requires at least the version it was built against, instead of any preview of that line. A consumer who updated only an integration used to install an older Specimen cleanly and then hit missing commands at runtime: `specimen-themes` and `specimen-pack*` in `specimen-afd`, and guide sources in `specimen-fast-af`. The install now asks for the Specimen it needs. Update Specimen with the integration.
