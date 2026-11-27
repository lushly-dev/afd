/**
 * @fileoverview MCP Tasks store, record model and options (`spec/tasks.md`;
 * MCP 2026-07-28 Tasks extension, SEP-2663).
 *
 * Keeps the store contract and in-memory default separate from the MCP transport runtime
 * (`tasks-runtime.ts`) so custom stores and unit tests can import the data model directly.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { CommandContext, CommandError, TaskSupport } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';
import { resultContent, type ToolCallResult } from './tool-router.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Extension identifier for MCP Tasks (SEP-2663). */
export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';

/** A task's default post-completion retention (`TaskOptions.ttlMs`): one hour. */
export const DEFAULT_TASK_TTL_MS = 3_600_000;

/** A task's default execution run budget (`TaskOptions.maxRunMs`): one hour. */
export const DEFAULT_TASK_MAX_RUN_MS = 3_600_000;

/** A task's default `pollIntervalMs`: one second. */
export const DEFAULT_TASK_POLL_INTERVAL_MS = 1_000;

/** How often a running task checks deadlines, progress and store cancellation by default. */
export const DEFAULT_TASK_CHECK_INTERVAL_MS = 1_000;

/** Largest serialized `CallToolResult` a task keeps by default: 1 MiB. */
export const DEFAULT_MAX_TASK_RESULT_BYTES = 1024 * 1024;

/** Default per-owner limit for {@link InMemoryTaskStore}. */
export const DEFAULT_MAX_TASKS_PER_OWNER = 32;

/** Default total limit across all owners for {@link InMemoryTaskStore}. */
export const DEFAULT_MAX_TASKS = 256;

/** Default maximum number of concurrently running tasks in one server process. */
export const DEFAULT_MAX_RUNNING_TASKS = 64;

// ═══════════════════════════════════════════════════════════════════════════════
// RECORD & STATE MODEL
// ═══════════════════════════════════════════════════════════════════════════════

/** A task's status (SEP-2663). AFD tasks never pause for user input, so never `input_required`. */
export type TaskStatus = 'working' | 'completed' | 'failed' | 'cancelled';

/** JSON-RPC error object stored on a `failed` task. */
export interface TaskRpcError {
	code: number;
	message: string;
	data?: unknown;
}

/** Whether a task status is terminal (`completed`, `failed` or `cancelled`). */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
	return status !== 'working';
}

/**
 * One task as a {@link TaskStore} keeps it.
 *
 * Holds no token, credentials or input: only the owner's principal binding, the command name,
 * the status, timestamps and the result or error once finished. Times are epoch milliseconds from
 * the server's clock.
 */
export interface TaskRecord {
	/** 128-bit cryptographic random id in unpadded lowercase RFC 4648 base32 (26 chars). */
	id: string;
	/** Principal binding of the caller who owns this task. Never sent on the wire or logged. */
	owner: string;
	/** Name of the command this task executes. Never sent on the wire. */
	command: string;
	/** Current lifecycle status. */
	status: TaskStatus;
	/** Latest progress message, if any. */
	statusMessage?: string;
	/** Creation time, epoch milliseconds. */
	createdAt: number;
	/** Last update time, epoch milliseconds. */
	lastUpdatedAt: number;
	/** Lifetime from `createdAt` in milliseconds; past `createdAt + ttlMs`, the task is gone. */
	ttlMs: number;
	/** Suggested client polling interval in milliseconds. */
	pollIntervalMs: number;
	/** Whether `tasks/cancel` requested cooperative cancellation. */
	cancelRequested: boolean;
	/** MCP `CallToolResult` when `status === 'completed'`. */
	result?: ToolCallResult;
	/** JSON-RPC error object when `status === 'failed'`. */
	error?: TaskRpcError;
}

/** A change applied atomically to a working task record. */
export type TaskChange =
	| { kind: 'progress'; message: string; at: number }
	| { kind: 'cancel-requested' }
	| { kind: 'completed'; result: ToolCallResult; at: number; ttlMs?: number }
	| { kind: 'failed'; error: TaskRpcError; at: number; ttlMs?: number }
	| { kind: 'cancelled'; at: number; ttlMs?: number };

/** Whether `record`'s `ttlMs` has elapsed at `now` (epoch milliseconds). */
export function isTaskExpired(
	record: Pick<TaskRecord, 'createdAt' | 'ttlMs'>,
	now: number
): boolean {
	return now >= record.createdAt + record.ttlMs;
}

/**
 * Compare two owner bindings in constant time (via SHA-256 digest + `timingSafeEqual`) so neither
 * content nor length leaks through timing.
 */
export function taskOwnerMatches(a: string, b: string): boolean {
	const digestA = createHash('sha256').update(a, 'utf8').digest();
	const digestB = createHash('sha256').update(b, 'utf8').digest();
	return timingSafeEqual(digestA, digestB);
}

/**
 * Apply `change` to `record` in place following the store rules: a finished task is unchanged,
 * and only the changed fields move. Returns `true` if `record` was updated.
 */
export function applyTaskChange(record: TaskRecord, change: TaskChange): boolean {
	if (isTerminalTaskStatus(record.status)) return false;
	switch (change.kind) {
		case 'progress':
			record.statusMessage = change.message;
			record.lastUpdatedAt = change.at;
			return true;
		case 'cancel-requested':
			record.cancelRequested = true;
			return true;
		case 'completed':
			record.status = 'completed';
			record.result = change.result;
			record.lastUpdatedAt = change.at;
			if (change.ttlMs !== undefined) {
				record.ttlMs = Math.min(record.ttlMs, Math.max(1, change.ttlMs));
			}
			return true;
		case 'failed':
			record.status = 'failed';
			record.error = change.error;
			record.lastUpdatedAt = change.at;
			if (change.ttlMs !== undefined) {
				record.ttlMs = Math.min(record.ttlMs, Math.max(1, change.ttlMs));
			}
			return true;
		case 'cancelled':
			record.status = 'cancelled';
			record.lastUpdatedAt = change.at;
			if (change.ttlMs !== undefined) {
				record.ttlMs = Math.min(record.ttlMs, Math.max(1, change.ttlMs));
			}
			return true;
	}
}

/**
 * Build the `CallToolResult` an inline call returns for a failed command (`completed`, `isError:
 * true`): useful for a host's custom store that ends an orphaned task on its own.
 */
export function taskFailureResult(error: CommandError): ToolCallResult {
	return resultContent(failure(error), true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORE CONTRACT & DEFAULT IN-MEMORY STORE
// ═══════════════════════════════════════════════════════════════════════════════

/** Failure kind returned by a {@link TaskStore}. */
export type TaskStoreErrorKind = 'owner-limit' | 'total-limit' | 'duplicate-id' | 'unavailable';

/** Error thrown by a {@link TaskStore} when an operation cannot be completed. */
export class TaskStoreError extends Error {
	constructor(
		readonly kind: TaskStoreErrorKind,
		message: string
	) {
		super(message);
		this.name = 'TaskStoreError';
	}
}

/** The call that created a task, passed to {@link TaskStore.create} so host stores may inspect it. */
export interface TaskCall {
	readonly command: ZodCommandDefinition;
	readonly input: unknown;
	readonly context: CommandContext;
}

/**
 * Durable store for MCP task records (`spec/tasks.md`).
 *
 * Implementations must uphold:
 * - `create` is durable before resolving, rejects duplicate ids (`duplicate-id`), and may reject
 *   capacity limits with `owner-limit` or `total-limit`.
 * - `get` and `update` are scoped by `owner` using constant-time matching (`taskOwnerMatches`).
 *   `update` is a no-op for another owner, an unknown id, or an already terminal record, and
 *   applies changes as {@link applyTaskChange} does.
 * - `expire(now)` removes every record with `isTaskExpired(record, now)` and returns the count.
 */
export interface TaskStore {
	create(record: TaskRecord, call: TaskCall): Promise<void>;
	get(id: string, owner: string): Promise<TaskRecord | undefined>;
	update(id: string, owner: string, change: TaskChange): Promise<void>;
	expire(now: number): Promise<number>;
	/** Optional lease renewal called periodically by the runner while the task executes. */
	heartbeat?(id: string, owner: string, now: number): Promise<void>;
}

/** Options for {@link InMemoryTaskStore}. */
export interface InMemoryTaskStoreOptions {
	/** Maximum tasks held at once per owner (working + finished until TTL). Default: 32. */
	maxPerOwner?: number;
	/** Maximum tasks held at once across all owners. Default: 256. */
	maxTotal?: number;
}

function cloneRecord(record: TaskRecord): TaskRecord {
	return {
		...record,
		...(record.result !== undefined && { result: structuredClone(record.result) }),
		...(record.error !== undefined && { error: structuredClone(record.error) }),
	};
}

/**
 * Default in-process {@link TaskStore}, bounded per owner and globally.
 *
 * When a limit is reached, finished tasks are evicted before their TTL (oldest finished for the
 * owner limit; oldest finished of the owner holding the most finished tasks for the total limit).
 * Only when all tasks blocking capacity are still `working` is creation refused with
 * {@link TaskStoreError} (`'owner-limit'` or `'total-limit'`).
 */
export class InMemoryTaskStore implements TaskStore {
	private readonly records = new Map<string, TaskRecord>();
	private readonly maxPerOwner: number;
	private readonly maxTotal: number;

	constructor(options: InMemoryTaskStoreOptions = {}) {
		const maxPerOwner = options.maxPerOwner ?? DEFAULT_MAX_TASKS_PER_OWNER;
		const maxTotal = options.maxTotal ?? DEFAULT_MAX_TASKS;
		if (!Number.isSafeInteger(maxPerOwner) || maxPerOwner < 1) {
			throw new RangeError('InMemoryTaskStore maxPerOwner must be a positive integer');
		}
		if (!Number.isSafeInteger(maxTotal) || maxTotal < 1) {
			throw new RangeError('InMemoryTaskStore maxTotal must be a positive integer');
		}
		this.maxPerOwner = maxPerOwner;
		this.maxTotal = maxTotal;
	}

	async create(record: TaskRecord, _call?: TaskCall): Promise<void> {
		this.purgeExpired(record.createdAt);
		if (this.records.has(record.id)) {
			throw new TaskStoreError('duplicate-id', 'Task id already exists');
		}

		// Per-owner capacity check, evicting this owner's oldest finished task (by lastUpdatedAt).
		let ownerCount = 0;
		let oldestOwnerFinished: TaskRecord | undefined;
		for (const existing of this.records.values()) {
			if (!taskOwnerMatches(existing.owner, record.owner)) continue;
			ownerCount += 1;
			if (isTerminalTaskStatus(existing.status)) {
				if (
					!oldestOwnerFinished ||
					existing.lastUpdatedAt < oldestOwnerFinished.lastUpdatedAt ||
					(existing.lastUpdatedAt === oldestOwnerFinished.lastUpdatedAt &&
						existing.id < oldestOwnerFinished.id)
				) {
					oldestOwnerFinished = existing;
				}
			}
		}
		if (ownerCount >= this.maxPerOwner) {
			if (!oldestOwnerFinished) {
				throw new TaskStoreError('owner-limit', 'Owner task limit reached');
			}
			this.records.delete(oldestOwnerFinished.id);
		}

		// Global capacity check, evicting the oldest finished task of the owner with the most finished.
		if (this.records.size >= this.maxTotal) {
			const finishedByOwner = new Map<string, { count: number; oldest: TaskRecord }>();
			for (const existing of this.records.values()) {
				if (!isTerminalTaskStatus(existing.status)) continue;
				const bucket = finishedByOwner.get(existing.owner);
				if (!bucket) {
					finishedByOwner.set(existing.owner, { count: 1, oldest: existing });
				} else {
					bucket.count += 1;
					if (
						existing.lastUpdatedAt < bucket.oldest.lastUpdatedAt ||
						(existing.lastUpdatedAt === bucket.oldest.lastUpdatedAt &&
							existing.id < bucket.oldest.id)
					) {
						bucket.oldest = existing;
					}
				}
			}
			let victim: { count: number; oldest: TaskRecord } | undefined;
			for (const bucket of finishedByOwner.values()) {
				if (
					!victim ||
					bucket.count > victim.count ||
					(bucket.count === victim.count &&
						(bucket.oldest.lastUpdatedAt < victim.oldest.lastUpdatedAt ||
							(bucket.oldest.lastUpdatedAt === victim.oldest.lastUpdatedAt &&
								bucket.oldest.id < victim.oldest.id)))
				) {
					victim = bucket;
				}
			}
			if (!victim) {
				throw new TaskStoreError('total-limit', 'Global task limit reached');
			}
			this.records.delete(victim.oldest.id);
		}

		this.records.set(record.id, cloneRecord(record));
	}

	async get(id: string, owner: string): Promise<TaskRecord | undefined> {
		const existing = this.records.get(id);
		if (!existing || !taskOwnerMatches(existing.owner, owner)) return undefined;
		return cloneRecord(existing);
	}

	async update(id: string, owner: string, change: TaskChange): Promise<void> {
		const existing = this.records.get(id);
		if (!existing || !taskOwnerMatches(existing.owner, owner)) return;
		applyTaskChange(existing, change);
	}

	async expire(now: number): Promise<number> {
		return this.purgeExpired(now);
	}

	/** Current number of stored records (useful in tests). */
	get size(): number {
		return this.records.size;
	}

	private purgeExpired(now: number): number {
		let removed = 0;
		for (const [id, record] of this.records) {
			if (isTaskExpired(record, now)) {
				this.records.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIONS & VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Server-level MCP Tasks configuration (`McpServerOptions.taskOptions`). */
export interface TaskOptions {
	/** Post-completion retention in ms (counted from finish; at least 1; default: 3,600,000). */
	ttlMs?: number;
	/** Maximum execution run budget in ms (counted from creation; at least 1; default: 3,600,000). */
	maxRunMs?: number;
	/** Suggested polling interval in ms (at least 1; default: 1,000). */
	pollIntervalMs?: number;
	/** How often a running task checks deadlines, progress and cancellation in ms (default: 1,000). */
	checkIntervalMs?: number;
	/** Largest serialized `CallToolResult` kept for a task in bytes (default: 1 MiB). */
	maxResultBytes?: number;
	/** Maximum tasks running concurrently in this process (default: 64). */
	maxRunning?: number;
	/**
	 * When set (including `0`), cap each task's `ttlMs` at `tokenExpiresAt * 1000 + graceMs`.
	 * Unset by default (TTL is `maxRunMs + ttlMs` while working, tightened to elapsed + `ttlMs`
	 * on finish).
	 */
	tokenExpiryGraceMs?: number;
	/**
	 * Security declaration: the server's `createContext` hook identifies every HTTP caller with a
	 * distinct verified actor, allowing MCP Tasks over HTTP without `auth`. Counted only when
	 * `createContext` is configured.
	 */
	callersIdentifiedByHook?: boolean;
}

/** Resolved task options with all defaults applied. */
export interface ResolvedTaskOptions {
	readonly ttlMs: number;
	readonly maxRunMs: number;
	readonly pollIntervalMs: number;
	readonly checkIntervalMs: number;
	readonly maxResultBytes: number;
	readonly maxRunning: number;
	readonly tokenExpiryGraceMs: number | undefined;
	readonly callersIdentifiedByHook: boolean;
}

function positiveInt(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`taskOptions.${name} must be a positive integer`);
	}
	return value;
}

/** Validate and normalize `TaskOptions`. */
export function resolveTaskOptions(options: TaskOptions = {}): ResolvedTaskOptions {
	const ttlMs = positiveInt(options.ttlMs, DEFAULT_TASK_TTL_MS, 'ttlMs');
	const maxRunMs = positiveInt(options.maxRunMs, DEFAULT_TASK_MAX_RUN_MS, 'maxRunMs');
	const pollIntervalMs = positiveInt(
		options.pollIntervalMs,
		DEFAULT_TASK_POLL_INTERVAL_MS,
		'pollIntervalMs'
	);
	const checkIntervalMs = positiveInt(
		options.checkIntervalMs,
		DEFAULT_TASK_CHECK_INTERVAL_MS,
		'checkIntervalMs'
	);
	const maxResultBytes = positiveInt(
		options.maxResultBytes,
		DEFAULT_MAX_TASK_RESULT_BYTES,
		'maxResultBytes'
	);
	const maxRunning = positiveInt(options.maxRunning, DEFAULT_MAX_RUNNING_TASKS, 'maxRunning');
	let tokenExpiryGraceMs: number | undefined;
	if (options.tokenExpiryGraceMs !== undefined) {
		if (!Number.isSafeInteger(options.tokenExpiryGraceMs) || options.tokenExpiryGraceMs < 0) {
			throw new Error('taskOptions.tokenExpiryGraceMs must be a non-negative integer');
		}
		tokenExpiryGraceMs = options.tokenExpiryGraceMs;
	}
	return {
		ttlMs,
		maxRunMs,
		pollIntervalMs,
		checkIntervalMs,
		maxResultBytes,
		maxRunning,
		tokenExpiryGraceMs,
		callersIdentifiedByHook: options.callersIdentifiedByHook === true,
	};
}

function capTtlAtTokenExpiry(
	options: ResolvedTaskOptions,
	createdAtMs: number,
	uncappedTtlMs: number,
	expiresAtSeconds?: number
): number {
	if (options.tokenExpiryGraceMs === undefined || expiresAtSeconds === undefined) {
		return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, uncappedTtlMs));
	}
	const endMs = expiresAtSeconds * 1000 + options.tokenExpiryGraceMs;
	const remaining = Math.max(0, endMs - createdAtMs);
	return Math.max(1, Math.min(uncappedTtlMs, remaining));
}

/**
 * Compute initial `ttlMs` (counted from `createdAt`) for a task created at `nowMs` with optional
 * token `expiresAtSeconds`: `maxRunMs + ttlMs`, capped at token expiry plus grace when configured.
 */
export function taskTtlFor(
	options: ResolvedTaskOptions,
	nowMs: number,
	expiresAtSeconds?: number
): number {
	const total = Math.min(Number.MAX_SAFE_INTEGER, options.maxRunMs + options.ttlMs);
	return capTtlAtTokenExpiry(options, nowMs, total, expiresAtSeconds);
}

/**
 * Compute final `ttlMs` (counted from `createdAtMs`) for a task that reached a terminal state at
 * `finishedAtMs`: `min(options.maxRunMs, max(0, finishedAtMs - createdAtMs)) + options.ttlMs`,
 * capped at token expiry plus grace when configured (never wider than initial `ttlMs`).
 */
export function finishedTaskTtlFor(
	options: ResolvedTaskOptions,
	createdAtMs: number,
	finishedAtMs: number,
	expiresAtSeconds?: number
): number {
	const elapsed = Math.min(options.maxRunMs, Math.max(0, finishedAtMs - createdAtMs));
	const total = Math.min(Number.MAX_SAFE_INTEGER, elapsed + options.ttlMs);
	return capTtlAtTokenExpiry(options, createdAtMs, total, expiresAtSeconds);
}

const VALID_TASK_SUPPORT = new Set<TaskSupport>(['never', 'optional', 'required']);

/**
 * Validate `task` metadata on every registered command (`spec/tasks.md`):
 * a command whose `task` is `'optional'` or `'required'` cannot also declare `confirmPrompt`,
 * `approval` (other than `'not-required'`), or `confirmationMode`.
 */
export function assertValidTaskCommands(commands: readonly ZodCommandDefinition[]): void {
	for (const cmd of commands) {
		if (cmd.confirmationMode !== undefined && cmd.confirmationMode !== 'host-verified') {
			throw new Error(
				`command "${cmd.name}": invalid confirmationMode "${String(cmd.confirmationMode)}" (expected "host-verified")`
			);
		}
		const task = cmd.task;
		if (task === undefined) continue;
		if (!VALID_TASK_SUPPORT.has(task)) {
			throw new Error(
				`command "${cmd.name}": invalid task support "${String(task)}" (expected "never", "optional" or "required")`
			);
		}
		if (task !== 'optional' && task !== 'required') continue;
		const conflicts: string[] = [];
		if (cmd.confirmPrompt !== undefined) conflicts.push('confirmPrompt');
		if (cmd.approval !== undefined && cmd.approval !== 'not-required') conflicts.push('approval');
		if (cmd.confirmationMode !== undefined) conflicts.push('confirmationMode');
		if (conflicts.length > 0) {
			throw new Error(
				`command "${cmd.name}": task: "${task}" cannot be combined with ${conflicts.join(', ')}`
			);
		}
	}
}
