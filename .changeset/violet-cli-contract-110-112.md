---
'@lushly-dev/violet-core': minor
'@lushly-dev/violet-cli': patch
'@lushly-dev/violet-server': patch
'@lushly-dev/violet-afd': minor
---

`violet call <command> --schema` prints the command's input as JSON Schema instead of a serialized Zod object, and `violet --json commands` lists every command with its input schema. Core adds `toJsonSchema` and `registry.getInputJsonSchema`, which the MCP tool generator and `docs.generate` now use too, so every surface shows the same schema.

`violet api spec` prints the hosted API's OpenAPI document (every documented `/api/v1` path), built by core's new `buildOpenApiSpec`. `--yaml` emits valid YAML, and the servers are the `--server` / `VIOLET_API_URL` deployment and the local `vercel dev` server on port 3000, which `violet api start` now uses by default. `HOSTED_EXPORT_FORMATS` moves to core.
