---
"afd-spec": patch
---

`spec/error-codes.md` lists Python (`call()`, `afd batch`) alongside TypeScript for `OUTCOME_UNKNOWN`, lists Python on `HTTP_<status>` and `MISSING_CLIENT_CAPABILITY`, and documents `TRANSPORT_ERROR`'s varying retryability now that Python's `McpClient.call()` fails closed on unknown write outcomes ([#2319](https://github.com/lushly-dev/afd/issues/2319)).
