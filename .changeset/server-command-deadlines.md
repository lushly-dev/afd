---
'@lushly-dev/afd-server': patch
---

Enforce positive finite `CommandContext.timeout` deadlines in the server engine, returning a
`TIMEOUT` failure with a recovery suggestion and aborting the command signal. Prevent cancelled
or timed-out commands from starting after delayed middleware or approval work resumes.
