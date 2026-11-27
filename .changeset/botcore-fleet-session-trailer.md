---
"lushly-botcore": minor
---

### Added

- **`skill-usage-triggers`** judges a fleet cell's change. A fleet's merge lane opens the pull request itself, so no session was linked as its opener and the change read `unknown`. Botcore Factory's lane now names each thread that worked on the cell in the commit it folds the branch into (`Factory-session: sha256:<24 hex>`). A change with those trailers and no opener link is judged by the sessions they name, as of the commit's author time. A miss of such a change also has `commit`, and its `change` is null when the subject names no pull request (#1887).
