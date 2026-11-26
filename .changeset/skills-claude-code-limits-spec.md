---
"afd-spec": patch
---

The Skills section of `spec/mcp-resources.md` notes that a host may load less than the extension's limits: Claude Code shows up to 100 skills a server and, for the skills it scans, loads up to 100 KB a text file and 400 KB a skill. `afd validate --surface` warns about a catalog past those limits without refusing it.
