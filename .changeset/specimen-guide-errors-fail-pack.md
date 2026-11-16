---
"@lushly-dev/specimen": patch
---

A guide with an error (one that fails validation, such as a statement over its length limit) is now a problem of the pack run, so `specimen pack` refuses to write and `pack-check` fails, naming the guide file and the error. Before, the guide was left out of every record with nothing said and the build passed (#1243).
