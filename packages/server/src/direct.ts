/**
 * @fileoverview In-process entry point: `@lushly-dev/afd-server/direct`
 *
 * Exposes what a host that runs commands in its own process needs: the validating
 * `createDirectRegistry`, the command journal with an in-memory sink and its replay, and the
 * middleware whose module graph loads no Node.js built-in, plus everything `/define` exports. It
 * loads neither the MCP SDK nor a Node.js built-in, so the same code runs in a browser, a web
 * worker or a webview as in Node.js. The name says what the entry is for, not where it runs: a
 * Node.js host that does not want the MCP SDK can use it too.
 *
 * The root entry (`@lushly-dev/afd-server`) still exports everything below. The approval
 * middleware joins this entry once it runs on WebCrypto.
 *
 * Module-graph rule: nothing reachable from this file may import the MCP SDK, a Node.js built-in
 * or the core subpaths that need Node.js (`/platform`, `/connectors`, `/journal-file`).
 * `entry-points.test.ts` bundles this entry with esbuild for the browser to enforce the rule, and
 * holds AFD's own code to a size budget.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import {
 *   createDirectRegistry,
 *   createJournalMiddleware,
 *   defineCommand,
 *   MemoryJournalSink,
 *   success,
 * } from '@lushly-dev/afd-server/direct';
 *
 * const panelOpen = defineCommand({
 *   name: 'panel-open',
 *   description: 'Open a panel',
 *   input: z.object({ id: z.string() }),
 *   async handler(input) {
 *     return success({ id: input.id, open: true });
 *   },
 * });
 *
 * const journal = new MemoryJournalSink();
 * const registry = createDirectRegistry([panelOpen], {
 *   middleware: [createJournalMiddleware(journal)],
 * });
 * await registry.execute('panel-open', { id: 'settings' });
 * ```
 *
 * @packageDocumentation
 */

export type {
	CommandMiddleware,
	JournalEntry,
	JournalRecord,
	JournalSink,
	TelemetryEvent,
	TelemetrySink,
} from '@lushly-dev/afd-core';
export { MemoryJournalSink } from '@lushly-dev/afd-core';
export * from './define.js';
export {
	createDirectRegistry,
	type DirectCommandRegistry,
	type DirectRegistryCommand,
	type DirectRegistryOptions,
	type ExposeInterface,
} from './direct-registry.js';
export { createJournalMiddleware, type JournalMiddlewareOptions } from './journal.js';
export {
	type JournalReplayTarget,
	type ReplayDifference,
	type ReplayEntryReport,
	type ReplayJournalOptions,
	type ReplayReport,
	type ReplayStatus,
	replayJournal,
} from './journal-replay.js';
export {
	ConsoleTelemetrySink,
	type ConsoleTelemetrySinkOptions,
	composeMiddleware,
	createAutoTraceIdMiddleware,
	createLoggingMiddleware,
	createRateLimitMiddleware,
	createRetryMiddleware,
	createTelemetryMiddleware,
	createTimingMiddleware,
	createTracingMiddleware,
	type DefaultMiddlewareOptions,
	defaultMiddleware,
	type LoggingOptions,
	type RateLimitOptions,
	type RetryOptions,
	type Span,
	type TelemetryOptions,
	type TimingOptions,
	type TraceIdOptions,
	type Tracer,
	type TracingOptions,
} from './middleware.js';
