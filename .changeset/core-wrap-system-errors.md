---
'@lushly-dev/afd-core': patch
---

`wrapError()` no longer copies the message of a Node system error, which names the file or address involved (`ENOENT: no such file or directory, open '/srv/app/.env'`). An error with an `E`-prefixed `code` and Node's `errno` or `syscall` field, or with a common POSIX code such as `ENOENT`, `EACCES`, `EPERM` or `ECONNREFUSED`, keeps its `code` but gets a generic message naming it: `A system error occurred: ENOENT (no such file or directory)`. Other errors, including codes such as `ERR_INVALID_ARG_TYPE` or application codes that merely start with `E`, keep their message.
