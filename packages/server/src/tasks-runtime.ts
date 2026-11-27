/**
 * @fileoverview MCP Tasks runtime: creation, background execution, cancellation, deadlines and
 * `tasks/get`, `tasks/update`, `tasks/cancel` handlers (`spec/command-metadata.md`, "Tasks";
 * SEP-2663).
 */

import { randomBytes } from 'node:crypto';
import type {
	Actor,
	Clock,
	CommandContext,
	CommandError,
	CommandResult,
} from '@lushly-dev/afd-core';
import { ErrorCodes, failure, systemClock, truncateName } from '@lushly-dev/afd-core';
import {
	CLIENT_CAPABILITIES_META_KEY,
	type McpRequestContext,
	ProtocolError,
	ProtocolErrorCode,
	type Server,
	type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { bindContextState, resolveContextState } from './context-scope.js';
import { withHostState } from './host-state.js';
import { JsonRpcError } from './json-rpc.js';
import { bindOutputBudgetAsk, OUTPUT_BUDGET_ASK } from './output-budget.js';
import { type PrincipalCredentials, principalBinding } from './principal-binding.js';
import type { ZodCommandDefinition } from './schema.js';
import { bindScopeView, type ScopeView, scopeViewOf } from './scope-view.js';
import type { TaskDispatch } from './task-dispatch.js';
import {
	finishedTaskTtlFor,
	InMemoryTaskStore,
	isTaskExpired,
	isTerminalTaskStatus,
	type ResolvedTaskOptions,
	resolveTaskOptions,
	TASKS_EXTENSION_ID,
	type TaskChange,
	type TaskOptions,
	type TaskRecord,
	type TaskRpcError,
	type TaskStatus,
	type TaskStore,
	TaskStoreError,
	taskOwnerMatches,
	taskTtlFor,
} from './tasks.js';
import { resultContent, type ToolCallResult } from './tool-router.js';
import { cloneVerifiedCredentials, unbrandVerifiedCredentials } from './verified-credentials.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WIRE TYPES & SIGNAL
// ═══════════════════════════════════════════════════════════════════════════════

/** Wire representation of a `tools/call` response that started a task (SEP-2663). */
export interface WireCreateTaskResult {
	resultType: 'task';
	taskId: string;
	status: 'working';
	statusMessage?: string;
	createdAt: string;
	lastUpdatedAt: string;
	ttlMs: number;
	pollIntervalMs: number;
}

/** Wire representation of a `tasks/get` result (SEP-2663; SDK adds `resultType: 'complete'`). */
export interface WireDetailedTask {
	taskId: string;
	status: TaskStatus;
	statusMessage?: string;
	createdAt: string;
	lastUpdatedAt: string;
	ttlMs: number;
	pollIntervalMs: number;
	result?: ToolCallResult;
	error?: TaskRpcError;
}

/**
 * Thrown by the task dispatch inside `tools/call` so the patched `Server._wrapHandler` returns a
 * `CreateTaskResult` without running the SDK's `CallToolResultSchema` check over it.
 */
export class CreateTaskSignal {
	constructor(readonly result: WireCreateTaskResult) {}
}

/**
 * Patch `server._wrapHandler` so a {@link CreateTaskSignal} thrown from `tools/call` returns its
 * `CreateTaskResult` straight to `Protocol._onrequest` (preserving request validation, input
 * required handling and response encoding).
 */
export function patchToolsCallForTasks(server: Server): void {
	const sdk = server as unknown as {
		_wrapHandler(
			method: string,
			handler: (request: unknown, ctx: unknown) => Promise<unknown>
		): (request: unknown, extra: unknown) => Promise<unknown>;
	};
	const originalWrap = sdk._wrapHandler.bind(server);
	sdk._wrapHandler = (method, handler) => {
		if (method !== 'tools/call') return originalWrap(method, handler);
		const wrapped = originalWrap(method, handler);
		return async (request, extra) => {
			try {
				return await wrapped(request, extra);
			} catch (error) {
				if (error instanceof CreateTaskSignal) return error.result;
				throw error;
			}
		};
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// IDS & WIRE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const TASK_ID_LENGTH = 26;
const TASK_ID_RE = /^[a-z2-7]{26}$/;
const MAX_TIMEOUT_MS = 2_147_483_647;
const utf8 = new TextEncoder();

/** Generate a 128-bit cryptographic random task id in unpadded lowercase RFC 4648 base32. */
export function newTaskId(): string {
	const bytes = randomBytes(16);
	let id = '';
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			id += BASE32[(buffer >>> bits) & 31];
		}
	}
	if (bits > 0) {
		id += BASE32[(buffer << (5 - bits)) & 31];
	}
	return id;
}

/** Whether `id` could be a task id issued by this server. */
export function isTaskId(id: string): boolean {
	return id.length === TASK_ID_LENGTH && TASK_ID_RE.test(id);
}

function isoTimestamp(ms: number): string {
	return new Date(ms).toISOString();
}

function wireCreateTask(record: TaskRecord): WireCreateTaskResult {
	return {
		resultType: 'task',
		taskId: record.id,
		status: 'working',
		...(record.statusMessage !== undefined && { statusMessage: record.statusMessage }),
		createdAt: isoTimestamp(record.createdAt),
		lastUpdatedAt: isoTimestamp(record.lastUpdatedAt),
		ttlMs: record.ttlMs,
		pollIntervalMs: record.pollIntervalMs,
	};
}

function wireDetailedTask(record: TaskRecord): WireDetailedTask {
	const base: WireDetailedTask = {
		taskId: record.id,
		status: record.status,
		...(record.statusMessage !== undefined && { statusMessage: record.statusMessage }),
		createdAt: isoTimestamp(record.createdAt),
		lastUpdatedAt: isoTimestamp(record.lastUpdatedAt),
		ttlMs: record.ttlMs,
		pollIntervalMs: record.pollIntervalMs,
	};
	if (record.status === 'completed') {
		base.result = record.result ?? { content: [], isError: false };
	} else if (record.status === 'failed') {
		base.error = record.error ?? internalErrorObject();
	}
	return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether `ctx` is an MCP 2026-07-28 request whose envelope client capabilities declare the Tasks
 * extension. A 2025-era request never does.
 */
export function requestDeclaresTasks(era: McpRequestContext['era'], ctx: ServerContext): boolean {
	if (era !== 'modern') return false;
	const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
	const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY];
	if (!isRecord(capabilities)) return false;
	const extensions = capabilities.extensions;
	if (!isRecord(extensions)) return false;
	return isRecord(extensions[TASKS_EXTENSION_ID]);
}

function missingTasksCapability(): ProtocolError {
	return new ProtocolError(
		ProtocolErrorCode.MissingRequiredClientCapability,
		`Client does not declare required capability: ${TASKS_EXTENSION_ID}`,
		{
			requiredCapabilities: {
				extensions: { [TASKS_EXTENSION_ID]: {} },
			},
		}
	);
}

function taskNotFound(): ProtocolError {
	return new ProtocolError(ProtocolErrorCode.InvalidParams, 'Task not found');
}

function internalRpcError(): ProtocolError {
	return new ProtocolError(ProtocolErrorCode.InternalError, 'Internal error');
}

function internalErrorObject(): TaskRpcError {
	return { code: -32603, message: 'Internal error' };
}

function taskLimitError(): CommandError {
	return {
		code: ErrorCodes.RATE_LIMITED,
		message: 'The task could not start: a task limit was reached, so nothing ran',
		suggestion: 'Wait for one of your tasks to finish or expire, then call again.',
		retryable: true,
		recovery: { kind: 'retry' },
	};
}

function compositeTaskError(tool: 'afd-batch' | 'afd-pipe', commandName: string): CommandError {
	return {
		code: tool === 'afd-batch' ? 'INVALID_BATCH_REQUEST' : 'INVALID_PIPELINE_REQUEST',
		message: `Command '${truncateName(commandName)}' requires MCP Tasks and cannot run inside ${tool}`,
		suggestion: `Call '${truncateName(commandName)}' directly or through afd-call on an MCP 2026-07-28 client declaring ${TASKS_EXTENSION_ID}`,
		retryable: false,
	};
}

function unidentifiedCallersError(command: string): CommandError {
	return {
		code: ErrorCodes.UNAUTHORIZED,
		message: `Command '${truncateName(command)}' runs only as a task, and this server cannot tell its callers apart, so it starts no task`,
		suggestion:
			"Nothing ran. The server's operator must configure authorization, or declare that the server's context hook identifies every caller; calling again will not help until then.",
		retryable: false,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER STATE & DEADLINE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

type StopReason = 'cancelled' | 'token-expired' | 'ttl-ended' | 'run-timeout' | 'lost';
type StopStage = 'not-started' | 'running' | 'finished';

interface RunningTask {
	readonly controller: AbortController;
	reason: StopReason | undefined;
	stop(reason: StopReason): void;
}

function createRunningTask(): RunningTask {
	const controller = new AbortController();
	const running: RunningTask = {
		controller,
		reason: undefined,
		stop(reason: StopReason) {
			if (running.reason === undefined) {
				running.reason = reason;
			}
			if (!controller.signal.aborted) {
				controller.abort();
			}
		},
	};
	return running;
}

/** What deadline is due at `nowMs`: token expiry first, then TTL, then optional run budget. */
export function dueTaskStop(
	tokenDeadlineMs: number | undefined,
	ttlDeadlineMs: number,
	nowMs: number,
	runDeadlineMs?: number
): StopReason | undefined {
	if (tokenDeadlineMs !== undefined && nowMs >= tokenDeadlineMs) return 'token-expired';
	if (nowMs >= ttlDeadlineMs) return 'ttl-ended';
	if (runDeadlineMs !== undefined && nowMs >= runDeadlineMs) return 'run-timeout';
	return undefined;
}

/** Build `TIMEOUT` for a task whose run budget elapsed, retryable unless a mutation may have run. */
export function taskRunTimeoutError(stage: StopStage, mutation: boolean): CommandError {
	if (stage === 'not-started') {
		return {
			code: ErrorCodes.TIMEOUT,
			message: 'The task did not start before its run budget elapsed',
			suggestion:
				'Nothing ran. Increase the task run budget or simplify the request and start it again.',
			retryable: true,
		};
	}
	return {
		code: ErrorCodes.TIMEOUT,
		message: 'The task stopped because its run budget elapsed',
		suggestion: mutation
			? 'The command may have made part of its change before it stopped: check its effect before starting it again.'
			: 'Simplify or narrow the request, or increase the task run budget, and start it again.',
		retryable: !mutation,
	};
}

/** Build `TASK_TOKEN_EXPIRED`, retryable unless a mutation may have started. */
export function tokenExpiredError(stage: StopStage, mutation: boolean): CommandError {
	let message: string;
	let suggestion: string;
	if (stage === 'not-started') {
		message = 'The task did not start: the access token that started it had expired';
		suggestion = 'Nothing ran. Obtain a new access token and start the task again.';
	} else if (stage === 'running') {
		message = 'The task stopped because the access token that started it expired';
		suggestion = mutation
			? 'The command may have made part of its change before it stopped: check its effect, then start it again with a new access token if it is still needed.'
			: 'Obtain a new access token and start the task again.';
	} else {
		message =
			'The task finished after the access token that started it expired, so its result is not delivered';
		suggestion = mutation
			? 'The command ran to the end and made its change: check its effect before starting it again with a new access token.'
			: 'Obtain a new access token and start the task again.';
	}
	return {
		code: ErrorCodes.TASK_TOKEN_EXPIRED,
		message,
		suggestion,
		retryable: stage === 'not-started' || !mutation,
	};
}

function completionChange(
	result: CommandResult,
	maxResultBytes: number,
	at: number,
	ttlMs: number
): TaskChange {
	// A result JSON cannot hold (a BigInt, a cycle) throws in resultContent too: the task fails
	// with an internal error instead of staying `working`.
	let toolResult: ReturnType<typeof resultContent>;
	let serialized: string;
	try {
		toolResult = resultContent(result, !result.success);
		serialized = JSON.stringify(toolResult);
	} catch {
		return { kind: 'failed', error: internalErrorObject(), at, ttlMs };
	}
	const size = utf8.encode(serialized).byteLength;
	if (size <= maxResultBytes) {
		return { kind: 'completed', result: toolResult, at, ttlMs };
	}
	const tooLarge: CommandError = {
		code: ErrorCodes.INTERNAL_ERROR,
		message: 'The command ran, but its result is larger than this server keeps for a task',
		suggestion:
			'The command ran: check its effect before running it again. For a read, ask for less (narrow the request or set an output budget).',
		details: { limitBytes: maxResultBytes, actualBytes: size },
		retryable: false,
	};
	return { kind: 'completed', result: resultContent(failure(tooLarge), true), at, ttlMs };
}

/** Copy string-keyed properties and only the safe symbols (`scopeView`, `contextState`). */
function cloneTaskContext(
	context: CommandContext,
	signal: AbortSignal,
	reportProgress: (message: string) => void
): CommandContext {
	const copy: Record<string, unknown> = {};
	for (const key of Object.keys(context)) {
		copy[key] = (context as Record<string, unknown>)[key];
	}
	// MCP Tasks are bounded by their own run budget (default 1 h), TTL and cancellation signal
	// rather than the inline server defaultTimeoutMs; keep an explicit per-request timeout if set.
	if (copy.timeout === undefined) {
		copy.timeout = 0;
	}
	let taskContext: CommandContext = {
		...(copy as CommandContext),
		signal,
		reportProgress,
	};
	const view = scopeViewOf(context);
	if (view) taskContext = bindScopeView(taskContext, view);
	const state = resolveContextState(context, undefined);
	if (state !== undefined) taskContext = bindContextState(taskContext, state);
	if (Object.hasOwn(context, OUTPUT_BUDGET_ASK)) {
		taskContext = bindOutputBudgetAsk(
			taskContext,
			(context as Record<symbol, unknown>)[OUTPUT_BUDGET_ASK]
		);
	}
	// The idempotency step never acts on a task run, and the retry middleware counts it as carrying
	// no key (spec/idempotency.md, S11).
	return withHostState(taskContext, { taskRun: true });
}

const taskIdParamsSchema = z.object({ taskId: z.string() });
const updateTaskParamsSchema = z.object({
	taskId: z.string(),
	inputResponses: z.record(z.string(), z.unknown()).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// TASK RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

export interface TaskRuntimeDeps {
	commands: readonly ZodCommandDefinition[];
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	store?: TaskStore;
	options?: TaskOptions;
	clock?: Clock;
	hasAuth: boolean;
	hasContextHook: boolean;
	actor?: Actor;
}

export interface InstallTaskHandlersOptions {
	era: McpRequestContext['era'];
	isHttp: boolean;
	requestValues?: () => Promise<Record<string, unknown>>;
	requestView?: () => ScopeView | undefined;
	internalError: (error: unknown) => ProtocolError;
}

export class TaskRuntime {
	readonly store: TaskStore;
	readonly options: ResolvedTaskOptions;
	readonly servesTasks: boolean;
	private readonly clock: Clock;
	private readonly hasAuth: boolean;
	private readonly hasContextHook: boolean;
	private readonly actor: Actor | undefined;
	private readonly executeCommand: TaskRuntimeDeps['executeCommand'];
	private readonly running = new Map<string, RunningTask>();

	constructor(deps: TaskRuntimeDeps) {
		this.store = deps.store ?? new InMemoryTaskStore();
		this.options = resolveTaskOptions(deps.options);
		this.clock = deps.clock ?? systemClock;
		this.hasAuth = deps.hasAuth;
		this.hasContextHook = deps.hasContextHook;
		this.actor = deps.actor;
		this.executeCommand = deps.executeCommand;
		this.servesTasks = deps.commands.some(
			(cmd) => cmd.task === 'optional' || cmd.task === 'required'
		);
	}

	private get hookIdentifiesCallers(): boolean {
		return this.options.callersIdentifiedByHook && this.hasContextHook;
	}

	/** Whether HTTP configuration identifies callers well enough to serve MCP Tasks. */
	get identifiesHttpCallers(): boolean {
		return this.hasAuth || this.hookIdentifiesCallers;
	}

	/** Whether this server declares the Tasks extension on this transport (`isHttp`). */
	declaresTasksTo(isHttp: boolean): boolean {
		return this.servesTasks && (!isHttp || this.identifiesHttpCallers);
	}

	/** Whether a task may be created for a request on this transport with `credentials`. */
	identifiesCaller(isHttp: boolean, credentials: unknown): boolean {
		return !isHttp || (this.hasAuth && credentials !== undefined) || this.hookIdentifiesCallers;
	}

	/** Build the {@link TaskDispatch} for one modern/stdio `tools/call`. */
	dispatchFor(
		era: McpRequestContext['era'],
		isHttp: boolean,
		ctx: ServerContext,
		credentials: unknown
	): TaskDispatch {
		return {
			dispatch: async (command, input, context) => {
				if (command.task !== 'optional' && command.task !== 'required') return undefined;
				if (!this.identifiesCaller(isHttp, credentials)) {
					if (command.task === 'required') {
						return resultContent(failure(unidentifiedCallersError(command.name)), true);
					}
					return undefined;
				}
				if (!requestDeclaresTasks(era, ctx)) {
					if (command.task === 'required') throw missingTasksCapability();
					return undefined;
				}
				return this.startTask(command, input, context);
			},
			refuseComposite: compositeTaskError,
		};
	}

	/** Build the {@link TaskDispatch} for the 2025-era `/message` HTTP lane. */
	legacyHttpDispatchFor(credentials: unknown): TaskDispatch {
		return {
			dispatch: async (command) => {
				if (command.task !== 'required') return undefined;
				if (!this.identifiesCaller(true, credentials)) {
					return resultContent(failure(unidentifiedCallersError(command.name)), true);
				}
				throw new JsonRpcError(
					ProtocolErrorCode.MissingRequiredClientCapability,
					`Client does not declare required capability: ${TASKS_EXTENSION_ID}`,
					`Call '${truncateName(command.name)}' over MCP 2026-07-28 declaring the ${TASKS_EXTENSION_ID} extension`,
					{ requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } }
				);
			},
			refuseComposite: compositeTaskError,
		};
	}

	/** Abort all locally running tasks without overwriting shared store state (server stop/dispose). */
	dispose(): void {
		for (const running of this.running.values()) {
			running.stop('lost');
		}
		this.running.clear();
	}

	/** Install `tasks/get`, `tasks/update` and `tasks/cancel` handlers on `server`. */
	installHandlers(server: Server, opts: InstallTaskHandlersOptions): void {
		if (!this.declaresTasksTo(opts.isHttp)) return;

		const resolveCaller = async (
			ctx: ServerContext
		): Promise<{ owner: string; view: ScopeView | undefined }> => {
			if (!requestDeclaresTasks(opts.era, ctx)) {
				throw missingTasksCapability();
			}
			const view = opts.requestView?.();
			const reqDecision = view?.decideRequest();
			if (view && reqDecision && reqDecision !== 'proceed') {
				const error = view.insufficientScope(reqDecision.forbidden);
				throw new ProtocolError(ProtocolErrorCode.InvalidRequest, error.message, {
					code: error.code,
					suggestion: error.suggestion,
					scopes: reqDecision.forbidden,
				});
			}
			let values: Record<string, unknown>;
			try {
				values = opts.requestValues ? await opts.requestValues() : {};
			} catch (error) {
				throw opts.internalError(error);
			}
			const actor = (values.actor ?? this.actor) as Actor | undefined;
			const credentials = (view?.credentials ?? values.credentials) as
				| PrincipalCredentials
				| undefined;
			let owner: string;
			try {
				owner = principalBinding(actor, credentials);
			} catch {
				throw internalRpcError();
			}
			return { owner, view };
		};

		const findTask = async (
			caller: { owner: string; view: ScopeView | undefined },
			taskId: string,
			needsCommand: boolean
		): Promise<TaskRecord> => {
			if (!isTaskId(taskId)) throw taskNotFound();
			let record: TaskRecord | undefined;
			try {
				record = await this.store.get(taskId, caller.owner);
			} catch {
				throw internalRpcError();
			}
			const now = this.clock.now();
			if (
				!record ||
				record.id !== taskId ||
				!taskOwnerMatches(record.owner, caller.owner) ||
				isTaskExpired(record, now)
			) {
				throw taskNotFound();
			}
			if (caller.view && !caller.view.known(record.command)) {
				throw taskNotFound();
			}
			if (needsCommand && caller.view) {
				const decision = caller.view.decideTask(record.command);
				if (decision !== 'proceed') {
					const error = caller.view.insufficientScope(decision.forbidden);
					throw new ProtocolError(ProtocolErrorCode.InvalidRequest, error.message, {
						code: error.code,
						suggestion: error.suggestion,
						scopes: decision.forbidden,
					});
				}
			}
			return record;
		};

		server.setRequestHandler('tasks/get', { params: taskIdParamsSchema }, async (params, ctx) => {
			const caller = await resolveCaller(ctx);
			const record = await findTask(caller, params.taskId, true);
			return wireDetailedTask(record) as never;
		});

		server.setRequestHandler(
			'tasks/update',
			{ params: updateTaskParamsSchema },
			async (params, ctx) => {
				const caller = await resolveCaller(ctx);
				await findTask(caller, params.taskId, true);
				return {} as never;
			}
		);

		server.setRequestHandler(
			'tasks/cancel',
			{ params: taskIdParamsSchema },
			async (params, ctx) => {
				const caller = await resolveCaller(ctx);
				const record = await findTask(caller, params.taskId, false);
				if (isTerminalTaskStatus(record.status)) {
					this.running.get(record.id)?.stop('lost');
					return {} as never;
				}
				try {
					await this.store.update(record.id, caller.owner, { kind: 'cancel-requested' });
				} catch {
					throw internalRpcError();
				}
				this.running.get(record.id)?.stop('cancelled');
				return {} as never;
			}
		);
	}

	private async startTask(
		command: ZodCommandDefinition,
		input: unknown,
		context: CommandContext
	): Promise<ToolCallResult> {
		const actor = (context.actor ?? this.actor) as Actor | undefined;
		const credentials = context.credentials as
			| (PrincipalCredentials & { expiresAt?: unknown })
			| undefined;
		let owner: string;
		try {
			owner = principalBinding(actor, credentials);
		} catch {
			throw internalRpcError();
		}

		const id = newTaskId();
		const now = this.clock.now();
		await this.store.expire(now).catch(() => {});

		const expiresAtSeconds =
			typeof credentials?.expiresAt === 'number' ? credentials.expiresAt : undefined;
		const ttlMs = taskTtlFor(this.options, now, expiresAtSeconds);
		const record: TaskRecord = {
			id,
			owner,
			command: command.name,
			status: 'working',
			createdAt: now,
			lastUpdatedAt: now,
			ttlMs,
			pollIntervalMs: this.options.pollIntervalMs,
			cancelRequested: false,
		};

		if (this.running.size >= this.options.maxRunning) {
			return resultContent(failure(taskLimitError()), true);
		}
		const running = createRunningTask();
		this.running.set(id, running);

		try {
			await this.store.create(record, { command, input, context });
		} catch (error) {
			this.running.delete(id);
			if (
				error instanceof TaskStoreError &&
				(error.kind === 'owner-limit' || error.kind === 'total-limit')
			) {
				return resultContent(failure(taskLimitError()), true);
			}
			return resultContent(
				failure({
					code: ErrorCodes.INTERNAL_ERROR,
					message: 'The task could not be recorded, so nothing ran',
					suggestion: 'Retry later.',
					retryable: true,
				}),
				true
			);
		}

		let latestProgress: string | undefined;
		let hasProgress = false;
		const verifiedCredentials =
			context.credentials && typeof context.credentials === 'object'
				? cloneVerifiedCredentials(context.credentials)
				: undefined;
		const taskContext = cloneTaskContext(
			verifiedCredentials ? { ...context, credentials: verifiedCredentials } : context,
			running.controller.signal,
			(message) => {
				if (typeof message === 'string') {
					latestProgress = message;
					hasProgress = true;
				}
			}
		);
		const takeProgress = (): string | undefined => {
			if (!hasProgress) return undefined;
			hasProgress = false;
			const msg = latestProgress;
			latestProgress = undefined;
			return msg;
		};
		const tokenDeadlineMs = expiresAtSeconds !== undefined ? expiresAtSeconds * 1000 : undefined;
		const ttlDeadlineMs = record.createdAt + record.ttlMs;
		const runDeadlineMs = Math.min(
			Number.MAX_SAFE_INTEGER,
			record.createdAt + this.options.maxRunMs
		);

		void this.runTask({
			id,
			owner,
			commandName: command.name,
			mutation: command.mutation === true,
			createdAt: record.createdAt,
			expiresAtSeconds,
			input,
			context: taskContext,
			running,
			takeProgress,
			tokenDeadlineMs,
			ttlDeadlineMs,
			runDeadlineMs,
			verifiedCredentials,
		});

		throw new CreateTaskSignal(wireCreateTask(record));
	}

	private async runTask(job: {
		id: string;
		owner: string;
		commandName: string;
		mutation: boolean;
		createdAt: number;
		expiresAtSeconds: number | undefined;
		input: unknown;
		context: CommandContext;
		running: RunningTask;
		takeProgress: () => string | undefined;
		tokenDeadlineMs: number | undefined;
		ttlDeadlineMs: number;
		runDeadlineMs: number;
		verifiedCredentials: object | undefined;
	}): Promise<void> {
		let outcome:
			| { kind: 'finished'; result: CommandResult }
			| { kind: 'stopped'; stop: StopReason; stage: StopStage }
			| { kind: 'internal' };
		try {
			outcome = await this.driveTask(job);
		} catch {
			outcome = { kind: 'internal' };
		} finally {
			this.running.delete(job.id);
			if (job.verifiedCredentials) {
				unbrandVerifiedCredentials(job.verifiedCredentials);
			}
		}

		const now = this.clock.now();
		const finalTtlMs = finishedTaskTtlFor(this.options, job.createdAt, now, job.expiresAtSeconds);
		let change: TaskChange;
		if (outcome.kind === 'finished') {
			change = completionChange(outcome.result, this.options.maxResultBytes, now, finalTtlMs);
		} else if (outcome.kind === 'internal') {
			change = { kind: 'failed', error: internalErrorObject(), at: now, ttlMs: finalTtlMs };
		} else if (outcome.stop === 'cancelled') {
			change = { kind: 'cancelled', at: now, ttlMs: finalTtlMs };
		} else if (outcome.stop === 'token-expired') {
			change = completionChange(
				failure(tokenExpiredError(outcome.stage, job.mutation)),
				Number.MAX_SAFE_INTEGER,
				now,
				finalTtlMs
			);
		} else if (outcome.stop === 'run-timeout') {
			change = completionChange(
				failure(taskRunTimeoutError(outcome.stage, job.mutation)),
				Number.MAX_SAFE_INTEGER,
				now,
				finalTtlMs
			);
		} else if (outcome.stop === 'ttl-ended') {
			await this.store.expire(now).catch(() => {});
			return;
		} else {
			// 'lost': another process or server shutdown ended it; write nothing.
			return;
		}

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await this.store.update(job.id, job.owner, change);
				break;
			} catch {
				if (attempt < 2) {
					await new Promise<void>((resolve) =>
						setTimeout(resolve, Math.min(this.options.checkIntervalMs, MAX_TIMEOUT_MS))
					);
				}
			}
		}
	}

	private async driveTask(job: {
		id: string;
		owner: string;
		commandName: string;
		input: unknown;
		context: CommandContext;
		running: RunningTask;
		takeProgress: () => string | undefined;
		tokenDeadlineMs: number | undefined;
		ttlDeadlineMs: number;
		runDeadlineMs: number;
	}): Promise<
		| { kind: 'finished'; result: CommandResult }
		| { kind: 'stopped'; stop: StopReason; stage: StopStage }
		| { kind: 'internal' }
	> {
		const initialStop =
			dueTaskStop(job.tokenDeadlineMs, job.ttlDeadlineMs, this.clock.now(), job.runDeadlineMs) ??
			job.running.reason;
		if (initialStop !== undefined) {
			return { kind: 'stopped', stop: initialStop, stage: 'not-started' };
		}

		let execSettled = false;
		let execResult: CommandResult | undefined;
		let execFailed = false;
		const execPromise = Promise.resolve()
			.then(() => this.executeCommand(job.commandName, job.input, job.context))
			.then(
				(result) => {
					execSettled = true;
					execResult = result;
					return 'exec' as const;
				},
				() => {
					execSettled = true;
					execFailed = true;
					return 'exec' as const;
				}
			);

		const stoppedPromise = new Promise<'stopped'>((resolve) => {
			if (job.running.controller.signal.aborted) {
				resolve('stopped');
			} else {
				job.running.controller.signal.addEventListener('abort', () => resolve('stopped'), {
					once: true,
				});
			}
		});

		const stopReason = (): StopReason | undefined => job.running.reason;
		for (;;) {
			if (stopReason() === 'lost') {
				return { kind: 'stopped', stop: 'lost', stage: 'running' };
			}
			if (execSettled) {
				if (execFailed || !execResult) return { kind: 'internal' };
				// A handler that already returned keeps its result unless the token or TTL expired.
				const due = dueTaskStop(job.tokenDeadlineMs, job.ttlDeadlineMs, this.clock.now());
				return due !== undefined
					? { kind: 'stopped', stop: due, stage: 'finished' }
					: { kind: 'finished', result: execResult };
			}

			const now = this.clock.now();
			const due = dueTaskStop(job.tokenDeadlineMs, job.ttlDeadlineMs, now, job.runDeadlineMs);
			if (due !== undefined) {
				job.running.stop(due);
			}

			if (stopReason() === undefined) {
				const message = job.takeProgress();
				if (message !== undefined) {
					await this.store
						.update(job.id, job.owner, { kind: 'progress', message, at: now })
						.catch(() => {});
				}
				if (this.store.heartbeat) {
					await this.store.heartbeat(job.id, job.owner, now).catch(() => {});
				}
				try {
					const current = await this.store.get(job.id, job.owner);
					if (!current || isTaskExpired(current, now)) {
						job.running.stop('ttl-ended');
					} else if (isTerminalTaskStatus(current.status)) {
						job.running.stop('lost');
					} else if (current.cancelRequested) {
						job.running.stop('cancelled');
					}
				} catch {
					// Transient store read failure: try again on the next check.
				}
			}

			const reason = stopReason();
			if (reason === 'lost' || reason === 'ttl-ended') {
				return { kind: 'stopped', stop: reason, stage: 'running' };
			}
			if (execSettled) continue;
			if (reason !== undefined) {
				return { kind: 'stopped', stop: reason, stage: 'running' };
			}

			const hardDeadline = Math.min(job.ttlDeadlineMs, job.runDeadlineMs);
			const nearest =
				job.tokenDeadlineMs !== undefined
					? Math.min(job.tokenDeadlineMs, hardDeadline)
					: hardDeadline;
			const until = Math.max(1, nearest - now);
			const waitMs = Math.min(this.options.checkIntervalMs, until, MAX_TIMEOUT_MS);

			let timer: ReturnType<typeof setTimeout> | undefined;
			const tickPromise = new Promise<'tick'>((resolve) => {
				timer = setTimeout(() => resolve('tick'), waitMs);
			});
			try {
				await Promise.race([execPromise, stoppedPromise, tickPromise]);
			} finally {
				if (timer !== undefined) clearTimeout(timer);
			}
		}
	}
}
