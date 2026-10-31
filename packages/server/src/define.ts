/**
 * @fileoverview Transport-free entry point: `@lushly-dev/afd-server/define`
 *
 * Exposes `defineCommand`, the Zod schema helpers and the result helpers
 * without loading the MCP SDK or any Node.js builtin (`node:http`, `node:tls`,
 * `node:child_process`). Import from here in code that runs in the browser or
 * that only defines commands, such as shared command modules, UI state
 * packages and in-app agents.
 *
 * The root entry (`@lushly-dev/afd-server`) still exports everything below,
 * plus `createMcpServer` and `createMcpHandler`, which need Node.js. The
 * `/direct` entry adds `createDirectRegistry`, the journal and the middleware
 * that run without Node.js.
 *
 * Module-graph rule: this file and `schema.ts` take runtime values from
 * `@lushly-dev/afd-core` only through its narrow subpaths (`/commands`,
 * `/result`), so the entry stays the smallest way to define commands.
 * `entry-points.test.ts` bundles this entry with esbuild for the browser to
 * enforce the rule.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { defineCommand, success } from '@lushly-dev/afd-server/define';
 *
 * export const panelOpen = defineCommand({
 *   name: 'panel-open',
 *   description: 'Open a panel',
 *   input: z.object({ id: z.string() }),
 *   expose: { mcp: true },
 *   async handler(input) {
 *     return success({ id: input.id, open: true });
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

// Type-only exports are erased from the emitted JavaScript, so they add nothing
// to the runtime module graph.
export type {
	ApprovalDecision,
	ApprovalPolicy,
	CommandContext,
	CommandError,
	CommandExample,
	CommandResult,
	ExposeOptions,
	JsonSchema,
} from '@lushly-dev/afd-core';
export { defaultExpose } from '@lushly-dev/afd-core/commands';
export { error, failure, isFailure, isSuccess, success } from '@lushly-dev/afd-core/result';
export {
	defineCommand,
	getRequiredFields,
	isObjectSchema,
	type ZodCommandDefinition,
	type ZodCommandOptions,
	zodToJsonSchema,
} from './schema.js';
