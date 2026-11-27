/**
 * @fileoverview MCP server options for the todo backend, shared by
 * `server.ts` and the tests.
 */

import { randomBytes } from 'node:crypto';
import type { CommandMiddleware, JournalSink } from '@lushly-dev/afd-core';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import {
	createApprovalMiddleware,
	createJournalMiddleware,
	defaultMiddleware,
	defineCommand,
	type McpHandlerOptions,
	success,
	type TaskOptions,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server';
import { z } from 'zod';
import { createClearCountsMiddleware, summarizeClear } from './commands/clear.js';
import { allCommands } from './commands/index.js';
import { TODO_CONTEXTS } from './contexts.js';
import { createHistoryMiddleware } from './history.js';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Ports of the dev frontends in the todo README: the Vite dev servers of the
 * FAST-AF page (`pnpm dev:web`, 5173) and the React page (`pnpm dev:react`, 5174).
 */
export const DEV_FRONTEND_PORTS = [5173, 5174] as const;

/** The dev frontends' origins, on both loopback names. */
export function devFrontendOrigins(): string[] {
	return DEV_FRONTEND_PORTS.flatMap((port) => [
		`http://localhost:${port}`,
		`http://127.0.0.1:${port}`,
	]);
}

/**
 * Browser origins allowed to call the server: the dev frontends plus the exact
 * origins in `ALLOWED_ORIGINS` (comma-separated). `*` and `null` are refused.
 */
export function resolveAllowedOrigins(env: Env): string[] {
	const extra = (env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
	for (const origin of extra) {
		let valid = false;
		try {
			const url = new URL(origin);
			valid = (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
		} catch {}
		if (!valid) {
			throw new Error(
				`ALLOWED_ORIGINS entry "${origin}" must be an exact http(s) origin such as http://localhost:8080 ("*" and "null" are not allowed)`
			);
		}
	}
	return [...new Set([...devFrontendOrigins(), ...extra])];
}

/** The `confirmations` server option from `CONFIRMATIONS` (default `off`). */
export function resolveConfirmations(env: Env): 'off' | 'enforce' | 'require-human' {
	const value = env.CONFIRMATIONS ?? 'off';
	if (value === 'off' || value === 'enforce' || value === 'require-human') return value;
	throw new Error(`CONFIRMATIONS must be off, enforce or require-human, not "${value}"`);
}

/**
 * Whether calls are held for approval, from `APPROVALS` (default `agents`): `agents` holds
 * `todo-clear` for any caller that is not a person; `off` holds nothing, because
 * {@link createTodoCommands} then serves `todo-clear` with no approval policy. The shared
 * conformance suites run with `off`, as they set `CONFIRMATIONS`.
 */
export function resolveApprovals(env: Env): 'agents' | 'off' {
	const value = env.APPROVALS ?? 'agents';
	if (value === 'agents' || value === 'off') return value;
	throw new Error(`APPROVALS must be agents or off, not "${value}"`);
}

/**
 * The key that signs approval tokens: `TODO_APPROVAL_SECRET` (at least 32 bytes) when set, so
 * several processes accept each other's tokens, else a random key for this process.
 */
export function resolveApprovalSecret(env: Env): string | Uint8Array {
	const secret = env.TODO_APPROVAL_SECRET;
	if (secret === undefined) return randomBytes(32);
	if (Buffer.byteLength(secret) < 32) {
		throw new Error('TODO_APPROVAL_SECRET must be at least 32 bytes');
	}
	return secret;
}

/**
 * The commands the server serves. With `APPROVALS=off` there is no approval middleware, and the
 * engine refuses a command that declares an approval policy without one (`APPROVAL_UNAVAILABLE`),
 * so `todo-clear` is served without its policy: it runs for every caller, and `_meta.approval`
 * does not advertise a hold the server does not make.
 */
export function createTodoCommands(env: Env): ZodCommandDefinition[] {
	const base =
		resolveApprovals(env) === 'agents'
			? allCommands
			: allCommands.map((command) => {
					if (command.approval === undefined) return command;
					const { approval: _approval, ...ungated } = command;
					return ungated as ZodCommandDefinition;
				});
	const extra: ZodCommandDefinition[] = [];
	if (env.PROTOCOL_CONFORMANCE === '1') {
		// Private command not exposed to MCP, for D4 protocol conformance (spec/protocol-conformance.json).
		extra.push(
			defineCommand({
				name: 'todo-internal-ping',
				description: 'Private internal probe not exposed to MCP',
				expose: { mcp: false, agent: true },
				input: z.object({}),
				handler: async () => success({ pong: true }),
			})
		);
	}
	if (env.TASK_CONFORMANCE === '1') {
		extra.push(
			defineCommand({
				name: 'todo-slow-task',
				description: 'Sleep for delayMs to test task execution budgets and retention',
				expose: { mcp: true },
				task: 'optional',
				input: z.object({ delayMs: z.number().int().min(0).max(10_000) }),
				async handler(input, context) {
					await new Promise<void>((resolve) => {
						if (context.signal?.aborted) {
							resolve();
							return;
						}
						const timer = setTimeout(() => {
							context.signal?.removeEventListener('abort', onAbort);
							resolve();
						}, input.delayMs);
						const onAbort = () => {
							clearTimeout(timer);
							resolve();
						};
						context.signal?.addEventListener('abort', onAbort, { once: true });
					});
					return success({ delayedMs: input.delayMs });
				},
			}),
			defineCommand({
				name: 'todo-unserializable-task',
				description: 'Return a result JSON cannot hold, so its task ends failed',
				expose: { mcp: true },
				task: 'required',
				input: z.object({}),
				async handler() {
					return success({ count: 1n });
				},
			})
		);
	}
	return extra.length > 0 ? [...base, ...extra] : base;
}

function parseOptionalPositiveInt(env: Env, name: string): number | undefined {
	const raw = env[name]?.trim();
	if (!raw) return undefined;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer, not "${raw}"`);
	}
	return parsed;
}

export function resolveTaskOptionsFromEnv(env: Env): TaskOptions | undefined {
	const maxRunMs = parseOptionalPositiveInt(env, 'TASK_MAX_RUN_MS');
	const ttlMs = parseOptionalPositiveInt(env, 'TASK_RETENTION_MS');
	const pollIntervalMs = parseOptionalPositiveInt(env, 'TASK_POLL_INTERVAL_MS');
	const checkIntervalMs = parseOptionalPositiveInt(env, 'TASK_CHECK_INTERVAL_MS');
	if (
		maxRunMs === undefined &&
		ttlMs === undefined &&
		pollIntervalMs === undefined &&
		checkIntervalMs === undefined
	) {
		return undefined;
	}
	return {
		...(maxRunMs !== undefined ? { maxRunMs } : {}),
		...(ttlMs !== undefined ? { ttlMs } : {}),
		...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
		...(checkIntervalMs !== undefined ? { checkIntervalMs } : {}),
	};
}

/** What the server is built with besides the environment, for tests and the replay module. */
export interface TodoServerDeps {
	/**
	 * Where the journal goes. Default: a JSON Lines file at `TODO_JOURNAL` when it is set,
	 * else no journal.
	 */
	journal?: JournalSink;
}

/**
 * The middleware, outermost first:
 *
 * 1. `defaultMiddleware()`: a trace ID for each call, logging (with inputs and results in dev
 *    mode or at `LOG_LEVEL=debug`) and a warning for slow calls.
 * 2. For `todo-clear`, the counts its approval summary shows, read here because the store is
 *    asynchronous and the approval middleware's `summarize` is not (when approvals are on).
 * 3. The approval hold, so a held call never runs.
 * 4. The journal, when there is one: it records each call that got past the hold, failures
 *    included, with the clock and random values the call read, so `afd replay` can run the
 *    session again. A held call is not recorded: its result carries an approval token and an
 *    expiry from the approval middleware's own clock, which no replay can reproduce and a
 *    journal should not keep. Once approved, the call is recorded like any other.
 * 5. The change history, which records each change that did run.
 */
export function createTodoMiddleware(env: Env, deps: TodoServerDeps = {}): CommandMiddleware[] {
	const devMode = env.NODE_ENV === 'development';
	const logLevel = env.LOG_LEVEL ?? 'info';
	const middleware: CommandMiddleware[] = defaultMiddleware({
		logging: devMode || logLevel === 'debug' ? { logInput: true, logResult: true } : {},
	});
	if (resolveApprovals(env) === 'agents') {
		// The store is asynchronous and the approval summary is not: read the counts first
		middleware.push(createClearCountsMiddleware());
		middleware.push(
			createApprovalMiddleware({
				secret: resolveApprovalSecret(env),
				// An MCP client that declares form elicitation asks its person; any other caller
				// gets APPROVAL_REQUIRED with a suggestion to ask the person.
				relay: 'mcp-elicitation',
				summarize: (command, input, context) =>
					command === 'todo-clear' ? summarizeClear(input, context) : undefined,
			})
		);
	}
	const journal =
		deps.journal ?? (env.TODO_JOURNAL ? new FileJournalSink(env.TODO_JOURNAL) : undefined);
	if (journal) {
		middleware.push(
			createJournalMiddleware(journal, {
				recordFailures: true,
				onError: (error) => console.error('[Journal]', error.message),
			})
		);
	}
	middleware.push(createHistoryMiddleware());
	return middleware;
}

/**
 * Options for `createMcpServer` (add `transport`) or `createMcpHandler`.
 *
 * Dev mode (`NODE_ENV=development`) enables verbose errors and stack traces. In
 * every mode only same-origin requests and the origins from
 * {@link resolveAllowedOrigins} are accepted.
 */
export function createTodoServerOptions(env: Env, deps: TodoServerDeps = {}): McpHandlerOptions {
	const devMode = env.NODE_ENV === 'development';
	const logLevel = env.LOG_LEVEL ?? 'info';
	const taskOptions = resolveTaskOptionsFromEnv(env);

	return {
		name: 'todo-app',
		version: '1.0.0',
		commands: createTodoCommands(env),
		// Adds the afd-help, afd-docs and afd-schema bootstrap tools
		bootstrap: true,
		port: Number.parseInt(env.PORT ?? '3100', 10),
		host: env.HOST ?? 'localhost',
		devMode,
		// Send CORS headers so the browser frontends can read responses. This does
		// not widen which origins are accepted: that is allowedOrigins.
		cors: true,
		allowedOrigins: resolveAllowedOrigins(env),
		confirmations: resolveConfirmations(env),
		// Registers afd-context-list, -enter and -exit (src/contexts.ts).
		contexts: TODO_CONTEXTS,
		...(taskOptions ? { taskOptions } : {}),
		// Answers a repeat of todo-create, todo-toggle and todo-toggle-batch, which declare
		// idempotency: 'keyed', from an in-memory store (spec/idempotency.md, S1 to S13).
		idempotency: {},

		middleware: createTodoMiddleware(env, deps),

		// Log command execution
		onCommand(command, input, result) {
			if (logLevel === 'debug') {
				console.error(`[Command] ${command}:`, { input, result });
			}
		},

		// Log errors
		onError(error) {
			console.error('[Error]', error);
		},
	};
}
