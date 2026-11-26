---
"lushly-botcore": patch
---

### Fixed

- **A checkout whose origin is a Windows path now names its repository.** `owner/name` was read only from `/`-separated origins, so on Windows a local-path origin named no repository: `gate-outcome-collect` and the hourly job refused it with `NO_WORKSPACE`, and skill usage filed it under the folder's name. Backslashes now separate as `/` does, and the `.git/config` fallback for a folder git refuses unescapes the doubled backslashes git writes there (#2710).
