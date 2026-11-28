---
"lushly-botcore": patch
---

### Fixed

- **Importing `botcore.host` no longer raises afd's `DeprecationWarning`.** The host imported `afd.direct.CommandContext`, an alias afd 0.14.0 deprecates and 0.15.0 removes. It now uses `afd.direct.DirectContext`, so Botcore keeps working with afd 0.15.0.
