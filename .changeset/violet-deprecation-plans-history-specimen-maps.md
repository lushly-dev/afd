---
'@lushly-dev/violet-core': minor
'@lushly-dev/violet-cli': minor
'@lushly-dev/violet-server': patch
'@lushly-dev/violet-afd': minor
---

Deprecation plans, rule-check history and specimen role maps. Nodes carry `sunsetAt` and `replacedBy` (`node.create` / `node.update`, `violet node create|update --sunset --replaced-by`), checked on write, with warnings for a date without a replacement and a deprecated replacement; `analyze.health` reports each plan with its usage and flags `sunset-without-replacement`, `replacement-deprecated` and `past-sunset`, and `nodes.graph` carries both fields. New `analyze.snapshot` (`violet snapshot`) stores rule check results, which `analyze.trends` reads back as `recorded` per day and `summary.history`. New `specimen.get` and `specimen.set` (`violet specimen get|set`) store which tokens draw each component specimen role, on the root of each tree; the component and role lists and each role's validated declaration are in `@lushly-dev/violet-core/css`. The `Database` interface gains `addCheckSnapshot`, `listCheckSnapshots`, `getSpecimenMap` and `setSpecimenMap`; SQLite and Postgres add the columns and tables on open, safely on existing data. The demo seed plans its deprecated branch and records checks along its history. The MCP server instructions describe the new commands.
