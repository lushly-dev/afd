---
'@lushly-dev/afd-server': minor
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-auth': patch
---

Add a transport-free `@lushly-dev/afd-server/define` entry point. It exports `defineCommand`, `ZodCommandDefinition`, `ZodCommandOptions`, the schema helpers (`zodToJsonSchema`, `getRequiredFields`, `isObjectSchema`), the result helpers (`success`, `failure`, `error`, `isSuccess`, `isFailure`) and `defaultExpose`, and nothing in its module graph imports the MCP SDK or a Node.js builtin, so browser code can define commands (esbuild `--platform=browser` bundles it). The root entry is unchanged.

To support it, `@lushly-dev/afd-core` adds two browser-safe subpaths, `@lushly-dev/afd-core/commands` and `@lushly-dev/afd-core/result`. `@lushly-dev/afd-auth/commands` now imports from `/define`, so it no longer loads the MCP transport either.

Minor for server and core: new subpath exports, no changes to existing ones.
