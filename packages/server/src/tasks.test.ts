/**
 * @fileoverview End-to-end and unit tests for MCP Tasks (`spec/command-metadata.md`, "Tasks";
 * SEP-2663), mirroring Rust's `packages/rust/tests/server_tasks.rs`.
 */

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import {
	type Actor,
	ErrorCodes,
	failure,
	fixedClock,
	success,
	type TaskSupport,
} from '@lushly-dev/afd-core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Credentials } from './mcp-auth-rules.js';
import type { ScopeResolver } from './mcp-auth-scopes.js';
import { serveModernStdio } from './mcp-modern.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import { SkillCatalog } from './skills.js';
import {
	applyTaskChange,
	DEFAULT_TASK_MAX_RUN_MS,
	DEFAULT_TASK_TTL_MS,
	finishedTaskTtlFor,
	InMemoryTaskStore,
	resolveTaskOptions,
	TASKS_EXTENSION_ID,
	type TaskOptions,
	type TaskRecord,
	type TaskStore,
	taskTtlFor,
} from './tasks.js';
import {
	dueTaskStop,
	isTaskId,
	newTaskId,
	TaskRuntime,
	taskRunTimeoutError,
	tokenExpiredError,
} from './tasks-runtime.js';
import { isVerifiedCredentials } from './verified-credentials.js';

const NOW_MS = 1_793_016_000_000;
const NOW_ISO = '2026-10-26T12:00:00.000Z';
const TTL_MS = 60_000;

interface Deferred<T = void> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

interface HttpFixture {
	url: string;
	baseUrl: string;
	server: HttpServer;
	close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		await cleanups.pop()?.();
	}
});

async function listenHandler(handler: ReturnType<typeof createMcpHandler>): Promise<HttpFixture> {
	const server = createServer((req, res) => {
		void handler(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const { port } = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${port}`;
	const fixture: HttpFixture = {
		url: `${baseUrl}/mcp`,
		baseUrl,
		server,
		async close() {
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
	cleanups.push(() => fixture.close());
	return fixture;
}

interface RpcResponse {
	status: number;
	body: Record<string, unknown>;
}

async function rpc(
	url: string,
	method: string,
	params: Record<string, unknown>,
	options: {
		tasks?: boolean;
		headers?: Record<string, string>;
		mcpName?: string;
	} = {}
): Promise<RpcResponse> {
	const meta: Record<string, unknown> = {
		'io.modelcontextprotocol/protocolVersion': '2026-07-28',
		'io.modelcontextprotocol/clientCapabilities': options.tasks
			? { extensions: { [TASKS_EXTENSION_ID]: {} } }
			: {},
		'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
	};
	const derivedName =
		options.mcpName ??
		(method === 'tools/call'
			? String(params.name ?? '')
			: method.startsWith('tasks/')
				? String(params.taskId ?? '')
				: undefined);
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
		'MCP-Protocol-Version': '2026-07-28',
		'Mcp-Method': method,
		...(derivedName ? { 'Mcp-Name': derivedName } : {}),
		...options.headers,
	};
	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method,
			params: { ...params, _meta: meta },
		}),
	});
	const body = (await response.json()) as Record<string, unknown>;
	return { status: response.status, body };
}

async function pollUntilSettled(
	url: string,
	taskId: string,
	headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const res = await rpc(url, 'tasks/get', { taskId }, { tasks: true, headers });
		expect(res.status).toBe(200);
		const result = res.body.result as Record<string, unknown>;
		if (result.status !== 'working') return result;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Task ${taskId} did not settle in time`);
}

function makeActorContext(req: IncomingMessage): Record<string, unknown> {
	const id = String(req.headers['x-test-user'] ?? 'alice');
	const actor: Actor = { kind: 'human', id };
	return { actor };
}

function makeCommands(opts: {
	runs: { echo: number; wait: number; list: number; aborted: number };
	waitStarted?: Deferred;
	waitRelease?: Deferred;
}) {
	const jobEcho = defineCommand({
		name: 'job-echo',
		description: 'Echo input as optional task',
		expose: { mcp: true },
		task: 'optional',
		input: z.object({ note: z.string().optional() }),
		async handler(input, context) {
			opts.runs.echo += 1;
			return success({
				note: input.note ?? null,
				actor: context.actor ?? null,
				hasProgress: typeof context.reportProgress === 'function',
			});
		},
	});

	const jobMust = defineCommand({
		name: 'job-must',
		description: 'Echo input as required task',
		expose: { mcp: true },
		task: 'required',
		input: z.object({ note: z.string().optional() }),
		async handler(input) {
			opts.runs.echo += 1;
			return success({ note: input.note ?? null });
		},
	});

	const jobFail = defineCommand({
		name: 'job-fail',
		description: 'Return a CommandResult failure',
		expose: { mcp: true },
		task: 'optional',
		input: z.object({}),
		async handler() {
			return failure({
				code: ErrorCodes.NOT_FOUND,
				message: 'No such job',
				suggestion: 'Check the job id',
			});
		},
	});

	const jobWait = defineCommand({
		name: 'job-wait',
		description: 'Wait until released or aborted',
		expose: { mcp: true },
		task: 'optional',
		input: z.object({}),
		async handler(_input, context) {
			opts.runs.wait += 1;
			context.reportProgress?.('phase-1');
			opts.waitStarted?.resolve();
			await new Promise<void>((resolve) => {
				const onAbort = () => {
					opts.runs.aborted += 1;
					resolve();
				};
				if (context.signal?.aborted) {
					onAbort();
					return;
				}
				context.signal?.addEventListener('abort', onAbort, { once: true });
				void opts.waitRelease?.promise.then(() => {
					context.signal?.removeEventListener('abort', onAbort);
					resolve();
				});
			});
			return success({ waited: true });
		},
	});

	const jobWrite = defineCommand({
		name: 'job-write',
		description: 'Slow mutation',
		expose: { mcp: true },
		mutation: true,
		task: 'optional',
		input: z.object({}),
		async handler(_input, context) {
			opts.runs.wait += 1;
			opts.waitStarted?.resolve();
			await new Promise<void>((resolve) => {
				context.signal?.addEventListener('abort', () => resolve(), { once: true });
				void opts.waitRelease?.promise.then(() => resolve());
			});
			return success({ written: true });
		},
	});

	const jobBig = defineCommand({
		name: 'job-big',
		description: 'Returns a large payload',
		expose: { mcp: true },
		task: 'optional',
		input: z.object({}),
		async handler() {
			opts.runs.echo += 1;
			return success({ blob: 'x'.repeat(4096) });
		},
	});

	const jobScoped = defineCommand({
		name: 'job-scoped',
		description: 'Scoped task command',
		expose: { mcp: true },
		task: 'optional',
		scopes: ['jobs:run'],
		input: z.object({}),
		async handler() {
			opts.runs.echo += 1;
			return success({ ok: true });
		},
	});

	const todoList = defineCommand({
		name: 'todo-list',
		description: 'Plain non-task command',
		expose: { mcp: true },
		input: z.object({}),
		async handler() {
			opts.runs.list += 1;
			return success([]);
		},
	});

	return [jobEcho, jobMust, jobFail, jobWait, jobWrite, jobBig, jobScoped, todoList];
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP Tasks unit primitives', () => {
	it('generates 128-bit lowercase base32 task ids and rejects malformed ids', () => {
		const a = newTaskId();
		const b = newTaskId();
		expect(a).toHaveLength(26);
		expect(b).toHaveLength(26);
		expect(a).not.toBe(b);
		expect(isTaskId(a)).toBe(true);
		expect(isTaskId('')).toBe(false);
		expect(isTaskId('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(false);
		expect(isTaskId('abcdefghijklmnopqrstuvwxy1')).toBe(false);
		expect(isTaskId('a'.repeat(27))).toBe(false);
	});

	it('prioritizes token expiry over TTL over run timeout and marks errors retryable appropriately', () => {
		expect(dueTaskStop(10, 10, 10, 10)).toBe('token-expired');
		expect(dueTaskStop(20, 10, 10, 10)).toBe('ttl-ended');
		expect(dueTaskStop(20, 20, 10, 10)).toBe('run-timeout');
		expect(dueTaskStop(undefined, 20, 10, undefined)).toBeUndefined();
		expect(dueTaskStop(undefined, 10, 9, 15)).toBeUndefined();
		expect(dueTaskStop(10, 20, 9, 15)).toBeUndefined();

		const cases: Array<['not-started' | 'running' | 'finished', boolean, boolean]> = [
			['not-started', true, true],
			['not-started', false, true],
			['running', false, true],
			['running', true, false],
			['finished', false, true],
			['finished', true, false],
		];
		for (const [stage, mutation, retryable] of cases) {
			const err = tokenExpiredError(stage, mutation);
			expect(err.code).toBe(ErrorCodes.TASK_TOKEN_EXPIRED);
			expect(err.retryable).toBe(retryable);

			const timeoutErr = taskRunTimeoutError(stage, mutation);
			expect(timeoutErr.code).toBe(ErrorCodes.TIMEOUT);
			expect(timeoutErr.retryable).toBe(retryable);
		}
	});

	it('separates run budget from post-completion retention, caps at token expiry and validates options', () => {
		const defaults = resolveTaskOptions();
		expect(defaults.maxRunMs).toBe(DEFAULT_TASK_MAX_RUN_MS);
		expect(defaults.ttlMs).toBe(DEFAULT_TASK_TTL_MS);
		expect(taskTtlFor(defaults, 1_000_000, undefined)).toBe(
			DEFAULT_TASK_MAX_RUN_MS + DEFAULT_TASK_TTL_MS
		);

		const uncapped = resolveTaskOptions({ maxRunMs: 20_000, ttlMs: 40_000 });
		expect(taskTtlFor(uncapped, 1_000_000, 1_010)).toBe(60_000);
		expect(finishedTaskTtlFor(uncapped, 1_000_000, 1_015_000, 1_010)).toBe(55_000);
		// Finishing past maxRunMs clamps elapsed to maxRunMs so ttlMs never widens past initial ttlMs
		expect(finishedTaskTtlFor(uncapped, 1_000_000, 1_025_000, 1_010)).toBe(60_000);
		// Clock regression clamps elapsed to 0
		expect(finishedTaskTtlFor(uncapped, 1_000_000, 999_000, 1_010)).toBe(40_000);

		const capped = resolveTaskOptions({
			maxRunMs: 20_000,
			ttlMs: 40_000,
			tokenExpiryGraceMs: 5_000,
		});
		expect(taskTtlFor(capped, 1_000_000, 1_010)).toBe(15_000);
		expect(finishedTaskTtlFor(capped, 1_000_000, 1_005_000, 1_010)).toBe(15_000);
		expect(taskTtlFor(capped, 1_000_000, 2_000)).toBe(60_000);
		expect(taskTtlFor(capped, 1_000_000, undefined)).toBe(60_000);
		expect(taskTtlFor(capped, 1_000_000, 900)).toBe(1);

		const rec: TaskRecord = {
			id: 'a'.repeat(26),
			owner: 'alice',
			command: 'job-echo',
			status: 'working',
			createdAt: 1_000,
			lastUpdatedAt: 1_000,
			ttlMs: 60_000,
			pollIntervalMs: 100,
			cancelRequested: false,
		};
		expect(
			applyTaskChange(rec, {
				kind: 'completed',
				result: { content: [], isError: false },
				at: 6_000,
				ttlMs: 45_000,
			})
		).toBe(true);
		expect(rec.ttlMs).toBe(45_000);

		// Widening ttlMs on terminal transition is clamped to initial ttlMs
		const recNoWiden: TaskRecord = {
			...rec,
			status: 'working',
			ttlMs: 60_000,
			result: undefined,
		};
		expect(
			applyTaskChange(recNoWiden, {
				kind: 'completed',
				result: { content: [], isError: false },
				at: 6_000,
				ttlMs: 90_000,
			})
		).toBe(true);
		expect(recNoWiden.ttlMs).toBe(60_000);

		expect(() => resolveTaskOptions({ ttlMs: 0 })).toThrow(/ttlMs/);
		expect(() => resolveTaskOptions({ maxRunMs: 0 })).toThrow(/maxRunMs/);
		expect(() => resolveTaskOptions({ maxRunning: -1 })).toThrow(/maxRunning/);
		expect(() => resolveTaskOptions({ tokenExpiryGraceMs: -1 })).toThrow(/tokenExpiryGraceMs/);
	});

	it('InMemoryTaskStore enforces owner/total limits, eviction order and duplicate ids', async () => {
		const store = new InMemoryTaskStore({ maxPerOwner: 2, maxTotal: 3 });
		const make = (id: string, owner: string, createdAt: number): TaskRecord => ({
			id,
			owner,
			command: 'job-echo',
			status: 'working',
			createdAt,
			lastUpdatedAt: createdAt,
			ttlMs: 10_000,
			pollIntervalMs: 100,
			cancelRequested: false,
		});

		await store.create(make('a'.repeat(26), 'alice', 100));
		await expect(store.create(make('a'.repeat(26), 'alice', 100))).rejects.toMatchObject({
			kind: 'duplicate-id',
		});

		await store.create(make('b'.repeat(26), 'alice', 200));
		// Owner alice has 2 working -> 3rd refuses with owner-limit
		await expect(store.create(make('c'.repeat(26), 'alice', 300))).rejects.toMatchObject({
			kind: 'owner-limit',
		});

		// Finish oldest alice task -> 3rd succeeds by evicting 'a'
		await store.update('a'.repeat(26), 'alice', {
			kind: 'completed',
			result: { content: [], isError: false },
			at: 250,
		});
		await store.create(make('c'.repeat(26), 'alice', 300));
		expect(await store.get('a'.repeat(26), 'alice')).toBeUndefined();
		expect(await store.get('c'.repeat(26), 'alice')).toBeDefined();

		// Bob takes 3rd total slot -> 4th from carol fails with total-limit while all working
		await store.create(make('d'.repeat(26), 'bob', 400));
		await expect(store.create(make('e'.repeat(26), 'carol', 500))).rejects.toMatchObject({
			kind: 'total-limit',
		});

		// Finish b (alice) and d (bob); alice and bob each have 1 finished, oldest is b (200)
		await store.update('b'.repeat(26), 'alice', { kind: 'cancelled', at: 450 });
		await store.update('d'.repeat(26), 'bob', { kind: 'cancelled', at: 460 });
		await store.create(make('e'.repeat(26), 'carol', 500));
		expect(await store.get('b'.repeat(26), 'alice')).toBeUndefined();
		expect(await store.get('d'.repeat(26), 'bob')).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION REFUSALS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP Tasks registration validation', () => {
	it('refuses task optional or required beside confirmPrompt or approval', () => {
		for (const task of ['optional', 'required'] as TaskSupport[]) {
			const withConfirm = defineCommand({
				name: 'bad-confirm',
				description: 'Bad',
				expose: { mcp: true },
				task,
				confirmPrompt: 'Sure?',
				input: z.object({}),
				handler: async () => success({}),
			});
			expect(() =>
				createMcpHandler({ name: 't', version: '1.0.0', commands: [withConfirm] })
			).toThrow(/confirmPrompt/);

			const withApproval = defineCommand({
				name: 'bad-approval',
				description: 'Bad',
				expose: { mcp: true },
				task,
				approval: 'required',
				input: z.object({}),
				handler: async () => success({}),
			});
			expect(() =>
				createMcpHandler({ name: 't', version: '1.0.0', commands: [withApproval] })
			).toThrow(/approval/);
		}

		const allowed = defineCommand({
			name: 'ok-never',
			description: 'OK',
			expose: { mcp: true },
			task: 'never',
			confirmPrompt: 'Sure?',
			approval: 'required',
			input: z.object({}),
			handler: async () => success({}),
		});
		expect(() =>
			createMcpHandler({ name: 't', version: '1.0.0', commands: [allowed] })
		).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATION, ROUTES, LIFECYCLE, OWNERSHIP, AUTH, LIMITS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP Tasks over HTTP', () => {
	const defaultTaskOptions: TaskOptions = {
		maxRunMs: TTL_MS,
		ttlMs: TTL_MS,
		pollIntervalMs: 20,
		checkIntervalMs: 5,
		callersIdentifiedByHook: true,
	};

	it('declares extension only when task commands exist and callers are identified, preserving skills', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const skills = new SkillCatalog([
			{
				path: 'demo',
				files: { 'SKILL.md': '---\nname: demo\ndescription: Demo skill\n---\n# Demo\n' },
			},
		]);
		const handler = createMcpHandler({
			name: 'tasks-test',
			version: '1.0.0',
			commands: makeCommands({ runs }),
			toolStrategy: 'individual',
			createContext: makeActorContext,
			taskOptions: defaultTaskOptions,
			skills,
		});
		const http = await listenHandler(handler);

		const disc = await rpc(http.url, 'server/discover', {});
		const caps = (disc.body.result as { capabilities: { extensions: Record<string, unknown> } })
			.capabilities;
		expect(caps.extensions[TASKS_EXTENSION_ID]).toEqual({});
		expect(caps.extensions['io.modelcontextprotocol/skills']).toEqual({});

		// Plain server without task commands omits extension and returns -32601 on tasks/get
		const plainCmd = defineCommand({
			name: 'todo-list',
			description: 'List',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => success([]),
		});
		const plainHttp = await listenHandler(
			createMcpHandler({
				name: 'plain',
				version: '1.0.0',
				commands: [plainCmd],
				createContext: makeActorContext,
				taskOptions: defaultTaskOptions,
			})
		);
		const plainDisc = await rpc(plainHttp.url, 'server/discover', {});
		const plainCaps = (
			plainDisc.body.result as { capabilities: { extensions?: Record<string, unknown> } }
		).capabilities;
		expect(plainCaps.extensions?.[TASKS_EXTENSION_ID]).toBeUndefined();
		const missing = await rpc(
			plainHttp.url,
			'tasks/get',
			{ taskId: 'a'.repeat(26) },
			{ tasks: true }
		);
		expect((missing.body.error as { code: number }).code).toBe(-32601);
	});

	it('refuses tasks on unidentified HTTP servers (optional inline, required UNAUTHORIZED)', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const http = await listenHandler(
			createMcpHandler({
				name: 'unidentified',
				version: '1.0.0',
				commands: makeCommands({ runs }),
				toolStrategy: 'individual',
				// No auth and no callersIdentifiedByHook
			})
		);

		const disc = await rpc(http.url, 'server/discover', {});
		const caps = (disc.body.result as { capabilities: { extensions?: Record<string, unknown> } })
			.capabilities;
		expect(caps.extensions?.[TASKS_EXTENSION_ID]).toBeUndefined();

		// optional runs inline even when client declares tasks
		const opt = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-echo', arguments: {} },
			{ tasks: true }
		);
		expect((opt.body.result as { resultType: string }).resultType).toBe('complete');
		expect(runs.echo).toBe(1);

		// required refuses with UNAUTHORIZED and runs nothing
		const req = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-must', arguments: {} },
			{ tasks: true }
		);
		const reqRes = req.body.result as {
			isError: boolean;
			structuredContent: { error: { code: string; retryable: boolean } };
		};
		expect(reqRes.isError).toBe(true);
		expect(reqRes.structuredContent.error.code).toBe(ErrorCodes.UNAUTHORIZED);
		expect(reqRes.structuredContent.error.retryable).toBe(false);
		expect(runs.echo).toBe(1);

		// tasks/get is -32601
		const get = await rpc(http.url, 'tasks/get', { taskId: 'a'.repeat(26) }, { tasks: true });
		expect((get.body.error as { code: number }).code).toBe(-32601);

		// Unidentified HTTP server even when createContext returns unverified credentials
		const withUnverifiedHook = await listenHandler(
			createMcpHandler({
				name: 'unverified-hook',
				version: '1.0.0',
				commands: makeCommands({ runs }),
				toolStrategy: 'individual',
				createContext: () => ({
					credentials: { issuer: 'https://fake', subject: 's', clientId: 'c' },
				}),
			})
		);
		const fakeReq = await rpc(
			withUnverifiedHook.url,
			'tools/call',
			{ name: 'job-must', arguments: {} },
			{ tasks: true }
		);
		expect(
			(fakeReq.body.result as { structuredContent: { error: { code: string } } }).structuredContent
				.error.code
		).toBe(ErrorCodes.UNAUTHORIZED);
		const fakeOpt = await rpc(
			withUnverifiedHook.url,
			'tools/call',
			{ name: 'job-echo', arguments: {} },
			{ tasks: true }
		);
		expect((fakeOpt.body.result as { resultType: string }).resultType).toBe('complete');
	});

	it('handles optional, required, never, -32021, Mcp-Name mismatch (-32020) and metadata', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const clock = fixedClock(NOW_MS);
		const http = await listenHandler(
			createMcpHandler({
				name: 'tasks-test',
				version: '1.0.0',
				commands: makeCommands({ runs }),
				toolStrategy: 'individual',
				clock,
				createContext: makeActorContext,
				taskOptions: defaultTaskOptions,
			})
		);

		// Check tools/list _meta.task and afd-detail task reporting
		const listed = await rpc(http.url, 'tools/list', {});
		const tools = (
			listed.body.result as { tools: Array<{ name: string; _meta?: { task?: string } }> }
		).tools;
		expect(tools.find((t) => t.name === 'job-echo')?._meta?.task).toBe('optional');
		expect(tools.find((t) => t.name === 'job-must')?._meta?.task).toBe('required');
		expect(tools.find((t) => t.name === 'todo-list')?._meta?.task).toBeUndefined();

		const detail = await rpc(http.url, 'tools/call', {
			name: 'afd-detail',
			arguments: { command: ['job-echo', 'job-must', 'todo-list'] },
		});
		const detailData = (
			detail.body.result as { structuredContent: { data: Array<{ name: string; task?: string }> } }
		).structuredContent.data;
		expect(detailData.find((d) => d.name === 'job-echo')?.task).toBe('optional');
		expect(detailData.find((d) => d.name === 'job-must')?.task).toBe('required');
		expect(detailData.find((d) => d.name === 'todo-list')?.task).toBeUndefined();

		// optional without tasks capability runs inline
		const inline = await rpc(http.url, 'tools/call', {
			name: 'job-echo',
			arguments: { note: 'a' },
		});
		expect((inline.body.result as { resultType: string }).resultType).toBe('complete');
		expect(runs.echo).toBe(1);

		// optional with tasks capability returns flat CreateTaskResult
		const created = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-echo', arguments: { note: 'b' } },
			{ tasks: true }
		);
		expect(created.status).toBe(200);
		const seed = { ...(created.body.result as Record<string, unknown>) };
		const taskId = String(seed.taskId);
		expect(isTaskId(taskId)).toBe(true);
		delete seed.taskId;
		expect(seed).toMatchObject({
			resultType: 'task',
			status: 'working',
			createdAt: NOW_ISO,
			lastUpdatedAt: NOW_ISO,
			ttlMs: TTL_MS * 2,
			pollIntervalMs: 20,
		});

		// Mcp-Name mismatch on tasks/get -> HTTP 400 -32020
		const mismatch = await rpc(
			http.url,
			'tasks/get',
			{ taskId },
			{ tasks: true, mcpName: 'job-echo' }
		);
		expect(mismatch.status).toBe(400);
		expect((mismatch.body.error as { code: number }).code).toBe(-32020);

		// tasks/* without tasks capability -> HTTP 400 -32021
		for (const method of ['tasks/get', 'tasks/update', 'tasks/cancel']) {
			const res = await rpc(
				http.url,
				method,
				method === 'tasks/update' ? { taskId, inputResponses: {} } : { taskId },
				{ tasks: false }
			);
			expect(res.status).toBe(400);
			expect((res.body.error as { code: number }).code).toBe(-32021);
		}

		// Poll to completion
		const done = await pollUntilSettled(http.url, taskId);
		expect(done.status).toBe('completed');
		expect(done.resultType).toBe('complete');
		const cmdResult = (
			done.result as {
				structuredContent: { success: boolean; data: { note: string; hasProgress: boolean } };
			}
		).structuredContent;
		expect(cmdResult.success).toBe(true);
		expect(cmdResult.data.note).toBe('b');
		expect(cmdResult.data.hasProgress).toBe(true);

		// required without tasks capability -> HTTP 400 -32021 and runs nothing
		const reqDenied = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-must', arguments: {} },
			{ tasks: false }
		);
		expect(reqDenied.status).toBe(400);
		expect((reqDenied.body.error as { code: number }).code).toBe(-32021);
		expect(
			(
				reqDenied.body.error as {
					data: { requiredCapabilities: { extensions: Record<string, unknown> } };
				}
			).data.requiredCapabilities.extensions
		).toEqual({ [TASKS_EXTENSION_ID]: {} });
		expect(runs.echo).toBe(2);

		// never runs inline even with tasks capability
		const never = await rpc(
			http.url,
			'tools/call',
			{ name: 'todo-list', arguments: {} },
			{ tasks: true }
		);
		expect((never.body.result as { resultType: string }).resultType).toBe('complete');
		expect(runs.list).toBe(1);
	});

	it('routes tasks across afd-call, grouped, and refuses required inside afd-batch and afd-pipe', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const http = await listenHandler(
			createMcpHandler({
				name: 'grouped-tasks',
				version: '1.0.0',
				commands: makeCommands({ runs }),
				toolStrategy: 'grouped',
				createContext: makeActorContext,
				taskOptions: defaultTaskOptions,
			})
		);

		// Grouped call
		const grouped = await rpc(
			http.url,
			'tools/call',
			{ name: 'job', arguments: { action: 'echo', params: { note: 'grp' } } },
			{ tasks: true }
		);
		expect((grouped.body.result as { resultType: string }).resultType).toBe('task');
		const groupedDone = await pollUntilSettled(
			http.url,
			String((grouped.body.result as { taskId: string }).taskId)
		);
		expect(groupedDone.status).toBe('completed');

		// afd-call
		const viaCall = await rpc(
			http.url,
			'tools/call',
			{ name: 'afd-call', arguments: { command: 'job-must', input: { note: 'via' } } },
			{ tasks: true }
		);
		expect((viaCall.body.result as { resultType: string }).resultType).toBe('task');
		const viaDone = await pollUntilSettled(
			http.url,
			String((viaCall.body.result as { taskId: string }).taskId)
		);
		expect(viaDone.status).toBe('completed');

		// afd-batch: optional runs inline
		const optBatch = await rpc(
			http.url,
			'tools/call',
			{
				name: 'afd-batch',
				arguments: { commands: [{ command: 'job-echo', input: { note: 'b' } }] },
			},
			{ tasks: true }
		);
		expect((optBatch.body.result as { resultType: string }).resultType).toBe('complete');

		// afd-batch: required refuses whole batch BEFORE any step runs
		const listBefore = runs.list;
		const reqBatch = await rpc(
			http.url,
			'tools/call',
			{
				name: 'afd-batch',
				arguments: {
					commands: [
						{ command: 'todo-list', input: {} },
						{ command: 'job-must', input: {} },
					],
				},
			},
			{ tasks: true }
		);
		expect(
			(reqBatch.body.result as { structuredContent: { error: { code: string } } }).structuredContent
				.error.code
		).toBe('INVALID_BATCH_REQUEST');
		expect(runs.list).toBe(listBefore);

		// afd-pipe: required refuses whole pipe BEFORE any step runs
		const reqPipe = await rpc(
			http.url,
			'tools/call',
			{
				name: 'afd-pipe',
				arguments: {
					steps: [
						{ command: 'todo-list', input: {} },
						{ command: 'job-must', input: {} },
					],
				},
			},
			{ tasks: true }
		);
		expect(
			(
				reqPipe.body.result as {
					structuredContent: { steps: Array<{ error?: { code: string } }> };
				}
			).structuredContent.steps[0]?.error?.code
		).toBe('INVALID_PIPELINE_REQUEST');
		expect(runs.list).toBe(listBefore);
	});

	it('tracks progress, supports tasks/update, cancels running tasks and respects TTL & result size cap', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const waitStarted = deferred();
		const waitRelease = deferred();
		const clock = fixedClock(NOW_MS);
		const http = await listenHandler(
			createMcpHandler({
				name: 'lifecycle',
				version: '1.0.0',
				commands: makeCommands({ runs, waitStarted, waitRelease }),
				toolStrategy: 'individual',
				clock,
				createContext: makeActorContext,
				taskOptions: {
					...defaultTaskOptions,
					maxResultBytes: 512,
				},
			})
		);

		// Failed CommandResult becomes completed with isError: true
		const failCreated = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-fail', arguments: {} },
			{ tasks: true }
		);
		const failDone = await pollUntilSettled(
			http.url,
			String((failCreated.body.result as { taskId: string }).taskId)
		);
		expect(failDone.status).toBe('completed');
		expect((failDone.result as { isError: boolean }).isError).toBe(true);

		// Oversized result replaced with INTERNAL_ERROR carrying limitBytes and actualBytes
		const bigCreated = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-big', arguments: {} },
			{ tasks: true }
		);
		const bigDone = await pollUntilSettled(
			http.url,
			String((bigCreated.body.result as { taskId: string }).taskId)
		);
		expect(bigDone.status).toBe('completed');
		const bigErr = (
			bigDone.result as {
				isError: boolean;
				structuredContent: {
					error: {
						code: string;
						retryable: boolean;
						details: { limitBytes: number; actualBytes: number };
					};
				};
			}
		).structuredContent.error;
		expect(bigErr.code).toBe(ErrorCodes.INTERNAL_ERROR);
		expect(bigErr.retryable).toBe(false);
		expect(bigErr.details.limitBytes).toBe(512);
		expect(bigErr.details.actualBytes).toBeGreaterThan(512);

		// Progress + tasks/update + tasks/cancel
		const waitCreated = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-wait', arguments: {} },
			{ tasks: true }
		);
		const waitId = String((waitCreated.body.result as { taskId: string }).taskId);
		await waitStarted.promise;
		// Wait for check loop to flush progress
		await vi.waitFor(
			async () => {
				const mid = await rpc(http.url, 'tasks/get', { taskId: waitId }, { tasks: true });
				expect((mid.body.result as { status: string; statusMessage?: string }).status).toBe(
					'working'
				);
				expect((mid.body.result as { statusMessage?: string }).statusMessage).toBe('phase-1');
			},
			{ timeout: 2000 }
		);

		// tasks/update acknowledges {}
		const upd = await rpc(
			http.url,
			'tasks/update',
			{ taskId: waitId, inputResponses: {} },
			{ tasks: true }
		);
		expect(upd.status).toBe(200);
		expect((upd.body.result as { resultType: string }).resultType).toBe('complete');

		// Owner isolation: bob cannot read, update or cancel alice's task (-32602 "Task not found")
		for (const method of ['tasks/get', 'tasks/update', 'tasks/cancel']) {
			const bob = await rpc(
				http.url,
				method,
				method === 'tasks/update' ? { taskId: waitId, inputResponses: {} } : { taskId: waitId },
				{ tasks: true, headers: { 'x-test-user': 'bob' } }
			);
			expect(bob.body.error).toEqual({ code: -32602, message: 'Task not found' });
		}

		// Cancel by alice stops runner and fires context.signal
		const cancel = await rpc(http.url, 'tasks/cancel', { taskId: waitId }, { tasks: true });
		expect(cancel.status).toBe(200);
		const cancelled = await pollUntilSettled(http.url, waitId);
		expect(cancelled.status).toBe('cancelled');
		expect(runs.aborted).toBe(1);

		// TTL expiry hides finished task
		clock.advance(TTL_MS);
		const expired = await rpc(http.url, 'tasks/get', { taskId: waitId }, { tasks: true });
		expect(expired.body.error).toEqual({ code: -32602, message: 'Task not found' });
	});

	it('enforces auth scopes, hidden commands, and TASK_TOKEN_EXPIRED with tokenExpiryGraceMs', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const waitStarted = deferred();
		const waitRelease = deferred();
		const clock = fixedClock(NOW_MS);
		const nowSec = Math.floor(NOW_MS / 1000);
		let hideScoped = false;
		const tokens = new Map<string, Credentials>([
			[
				'tok-full',
				{
					issuer: 'https://issuer.test',
					subject: 'sub-1',
					clientId: 'cli-1',
					scopes: ['mcp:use', 'jobs:run'],
					resource: 'https://api.example.test',
					issuedAt: nowSec,
					expiresAt: nowSec + 10,
				},
			],
			[
				'tok-no-cmd-scope',
				{
					issuer: 'https://issuer.test',
					subject: 'sub-1',
					clientId: 'cli-1',
					scopes: ['mcp:use'],
					resource: 'https://api.example.test',
					issuedAt: nowSec,
					expiresAt: nowSec + 60,
				},
			],
			[
				'tok-other-client',
				{
					issuer: 'https://issuer.test',
					subject: 'sub-1',
					clientId: 'cli-2',
					scopes: ['mcp:use', 'jobs:run'],
					resource: 'https://api.example.test',
					issuedAt: nowSec,
					expiresAt: nowSec + 60,
				},
			],
		]);

		const resolver: ScopeResolver = {
			resolve: (command, _input, creds) =>
				command === 'job-scoped' && !creds.scopes.includes('jobs:run')
					? { missing: ['jobs:run'] }
					: 'allowed',
			visible: (command, creds) =>
				command === 'job-scoped' ? !hideScoped && creds.scopes.includes('jobs:run') : true,
			known: (command) => (command === 'job-scoped' ? !hideScoped : true),
		};

		const http = await listenHandler(
			createMcpHandler({
				name: 'auth-tasks',
				version: '1.0.0',
				commands: makeCommands({ runs, waitStarted, waitRelease }),
				toolStrategy: 'individual',
				clock,
				taskOptions: {
					ttlMs: TTL_MS,
					pollIntervalMs: 20,
					checkIntervalMs: 5,
					tokenExpiryGraceMs: 5_000,
				},
				auth: {
					resource: 'https://api.example.test',
					authorizationServers: ['https://issuer.test'],
					requiredScopes: ['mcp:use'],
					resolver,
					filterToolsByScope: true,
					verifier: {
						verify: async (token) => {
							const creds = tokens.get(token);
							if (!creds) return { ok: false, rule: 'invalid_token' };
							return { ok: true, credentials: creds };
						},
					},
				},
			})
		);

		// Create a scoped task with tok-full (expires in 10s + 5s grace = 15s ttlMs)
		const created = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-scoped', arguments: {} },
			{ tasks: true, headers: { Authorization: 'Bearer tok-full' } }
		);
		expect((created.body.result as { ttlMs: number }).ttlMs).toBe(15_000);
		const scopedId = String((created.body.result as { taskId: string }).taskId);
		await pollUntilSettled(http.url, scopedId, { Authorization: 'Bearer tok-full' });

		// Different clientId of same subject -> Task not found
		const otherCli = await rpc(
			http.url,
			'tasks/get',
			{ taskId: scopedId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-other-client' } }
		);
		expect(otherCli.body.error).toEqual({ code: -32602, message: 'Task not found' });

		// Same principal with token lacking command scope -> INSUFFICIENT_SCOPE on tasks/get,
		// but tasks/cancel is allowed!
		const noScopeGet = await rpc(
			http.url,
			'tasks/get',
			{ taskId: scopedId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-no-cmd-scope' } }
		);
		expect((noScopeGet.body.error as { code: number; data: { code: string } }).code).toBe(-32600);
		expect((noScopeGet.body.error as { data: { code: string } }).data.code).toBe(
			'INSUFFICIENT_SCOPE'
		);
		const noScopeCancel = await rpc(
			http.url,
			'tasks/cancel',
			{ taskId: scopedId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-no-cmd-scope' } }
		);
		expect(noScopeCancel.status).toBe(200);

		// Hidden command -> Task not found
		hideScoped = true;
		const hidden = await rpc(
			http.url,
			'tasks/get',
			{ taskId: scopedId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-full' } }
		);
		expect(hidden.body.error).toEqual({ code: -32602, message: 'Task not found' });
		hideScoped = false;

		// Token expires while mutation is running -> TASK_TOKEN_EXPIRED with retryable: false
		const writeCreated = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-write', arguments: {} },
			{ tasks: true, headers: { Authorization: 'Bearer tok-full' } }
		);
		const writeId = String((writeCreated.body.result as { taskId: string }).taskId);
		await waitStarted.promise;
		// Advance clock past tok-full's expiresAt (10s) but within grace (15s), and poll with fresh token
		clock.advance(11_000);
		const expiredRes = await pollUntilSettled(http.url, writeId, {
			Authorization: 'Bearer tok-no-cmd-scope',
		});
		expect(expiredRes.status).toBe('completed');
		const expiredErr = (
			expiredRes.result as {
				structuredContent: { error: { code: string; retryable: boolean } };
			}
		).structuredContent.error;
		expect(expiredErr.code).toBe(ErrorCodes.TASK_TOKEN_EXPIRED);
		expect(expiredErr.retryable).toBe(false);
	});

	it('preserves verified credentials brand inside running tasks and enforces static command scopes', async () => {
		const clock = fixedClock(NOW_MS);
		const nowSec = Math.floor(NOW_MS / 1000);
		let verifiedInsideTask = false;
		let capturedCreds: unknown;
		let redactedInsideTask = false;
		const cmd = defineCommand({
			name: 'job-verified',
			description: 'Checks verified credentials after HTTP response closes',
			expose: { mcp: true },
			task: 'required',
			scopes: ['jobs:run'],
			input: z.object({}),
			async handler(_input, context) {
				// Yield so the HTTP response for tools/call has closed
				await new Promise((r) => setTimeout(r, 25));
				capturedCreds = context.credentials;
				verifiedInsideTask = isVerifiedCredentials(context.credentials, context.clock?.now());
				const debugForm = inspect(context.credentials);
				redactedInsideTask = debugForm.includes('[redacted]') && !debugForm.includes('sub-1');
				return success({ verified: verifiedInsideTask });
			},
		});
		const tokens = new Map<string, Credentials>([
			[
				'tok-ok',
				{
					issuer: 'https://issuer.test',
					subject: 'sub-1',
					clientId: 'cli-1',
					scopes: ['mcp:use', 'jobs:run'],
					resource: 'https://api.example.test',
					issuedAt: nowSec,
					expiresAt: nowSec + 60,
				},
			],
			[
				'tok-narrow',
				{
					issuer: 'https://issuer.test',
					subject: 'sub-1',
					clientId: 'cli-1',
					scopes: ['mcp:use'],
					resource: 'https://api.example.test',
					issuedAt: nowSec,
					expiresAt: nowSec + 60,
				},
			],
		]);
		const http = await listenHandler(
			createMcpHandler({
				name: 'static-scope-tasks',
				version: '1.0.0',
				commands: [cmd],
				toolStrategy: 'individual',
				clock,
				taskOptions: { ttlMs: TTL_MS, pollIntervalMs: 15, checkIntervalMs: 5 },
				auth: {
					resource: 'https://api.example.test',
					authorizationServers: ['https://issuer.test'],
					requiredScopes: ['mcp:use'],
					verifier: {
						verify: async (token) => {
							const creds = tokens.get(token);
							return creds
								? { ok: true, credentials: creds }
								: { ok: false, rule: 'invalid_token' };
						},
					},
				},
			})
		);

		const created = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-verified', arguments: {} },
			{ tasks: true, headers: { Authorization: 'Bearer tok-ok' } }
		);
		const taskId = String((created.body.result as { taskId: string }).taskId);
		const done = await pollUntilSettled(http.url, taskId, { Authorization: 'Bearer tok-ok' });
		expect(done.status).toBe('completed');
		expect(verifiedInsideTask).toBe(true);
		expect(redactedInsideTask).toBe(true);
		expect(isVerifiedCredentials(capturedCreds, clock.now())).toBe(false);

		// Static command scope enforced on tasks/get (missing ['jobs:run']), skipped on tasks/cancel
		const denied = await rpc(
			http.url,
			'tasks/get',
			{ taskId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-narrow' } }
		);
		expect(denied.body.error).toMatchObject({
			code: -32600,
			data: { code: 'INSUFFICIENT_SCOPE', scopes: ['jobs:run'] },
		});
		const cancelOk = await rpc(
			http.url,
			'tasks/cancel',
			{ taskId },
			{ tasks: true, headers: { Authorization: 'Bearer tok-narrow' } }
		);
		expect(cancelOk.status).toBe(200);
	});

	it('enforces maxRunning and store limits with RATE_LIMITED and supports cross-process cancel', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const waitStarted = deferred();
		const waitRelease = deferred();
		const sharedStore: TaskStore = new InMemoryTaskStore({ maxPerOwner: 1 });

		const httpA = await listenHandler(
			createMcpHandler({
				name: 'proc-a',
				version: '1.0.0',
				commands: makeCommands({ runs, waitStarted, waitRelease }),
				toolStrategy: 'individual',
				createContext: makeActorContext,
				taskStore: sharedStore,
				taskOptions: { ...defaultTaskOptions, maxRunning: 1 },
			})
		);
		const httpB = await listenHandler(
			createMcpHandler({
				name: 'proc-b',
				version: '1.0.0',
				commands: makeCommands({ runs }),
				toolStrategy: 'individual',
				createContext: makeActorContext,
				taskStore: sharedStore,
				taskOptions: { ...defaultTaskOptions, maxRunning: 5 },
			})
		);

		const created = await rpc(
			httpA.url,
			'tools/call',
			{ name: 'job-wait', arguments: {} },
			{ tasks: true }
		);
		const id = String((created.body.result as { taskId: string }).taskId);
		await waitStarted.promise;

		// Second call on proc-a hits maxRunning -> RATE_LIMITED
		const limitedA = await rpc(
			httpA.url,
			'tools/call',
			{ name: 'job-echo', arguments: {} },
			{ tasks: true }
		);
		expect(
			(
				limitedA.body.result as {
					structuredContent: { error: { code: string; retryable: boolean } };
				}
			).structuredContent.error
		).toMatchObject({ code: ErrorCodes.RATE_LIMITED, retryable: true });
		// A task limit: retry, with no minimum wait (spec/recovery.md, "Engine errors").
		expect(
			(limitedA.body.result as { structuredContent: { error: { recovery?: unknown } } })
				.structuredContent.error.recovery
		).toEqual({ kind: 'retry' });

		// Call on proc-b hits sharedStore owner-limit -> RATE_LIMITED
		const limitedB = await rpc(
			httpB.url,
			'tools/call',
			{ name: 'job-echo', arguments: {} },
			{ tasks: true }
		);
		expect(
			(
				limitedB.body.result as {
					structuredContent: { error: { code: string; retryable: boolean } };
				}
			).structuredContent.error
		).toMatchObject({ code: ErrorCodes.RATE_LIMITED, retryable: true });
		expect(
			(limitedB.body.result as { structuredContent: { error: { recovery?: unknown } } })
				.structuredContent.error.recovery
		).toEqual({ kind: 'retry' });

		// Cancel via proc-b reaches runner on proc-a through sharedStore
		const cancelB = await rpc(httpB.url, 'tasks/cancel', { taskId: id }, { tasks: true });
		expect(cancelB.status).toBe(200);
		const settled = await pollUntilSettled(httpB.url, id);
		expect(settled.status).toBe('cancelled');
		expect(runs.aborted).toBe(1);
	});

	it('handles 2025 /message lane and in-process execute()', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const commands = makeCommands({ runs });
		const http = await listenHandler(
			createMcpHandler({
				name: 'legacy-check',
				version: '1.0.0',
				commands,
				toolStrategy: 'individual',
				createContext: makeActorContext,
				taskOptions: defaultTaskOptions,
			})
		);

		// 2025 /message: optional runs inline, required returns -32021
		const optMsg = await fetch(`${http.baseUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'job-echo', arguments: { note: 'legacy' } },
			}),
		});
		const optJson = (await optMsg.json()) as { result: { isError: boolean } };
		expect(optJson.result.isError).toBe(false);

		const reqMsg = await fetch(`${http.baseUrl}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'job-must', arguments: {} },
			}),
		});
		const reqJson = (await reqMsg.json()) as {
			error: {
				code: number;
				data: { requiredCapabilities: { extensions: Record<string, unknown> } };
			};
		};
		expect(reqJson.error.code).toBe(-32021);
		expect(reqJson.error.data.requiredCapabilities.extensions).toEqual({
			[TASKS_EXTENSION_ID]: {},
		});

		// In-process execute() always runs inline
		const server = createMcpServer({
			name: 'in-proc',
			version: '1.0.0',
			commands,
			transport: 'http',
		});
		const directRes = await server.execute('job-must', { note: 'direct' });
		expect(directRes.success).toBe(true);
		expect(directRes.data).toEqual({ note: 'direct' });
	});

	it('serves tasks over stdio without auth or hook declaration', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const commands = makeCommands({ runs });
		const taskRuntime = new TaskRuntime({
			commands,
			executeCommand: async (name, input, ctx) => {
				const cmd = commands.find((c) => c.name === name);
				if (!cmd) return failure({ code: 'COMMAND_NOT_FOUND', message: 'Not found' });
				return cmd.handler(input as never, ctx ?? {});
			},
			options: { pollIntervalMs: 10, checkIntervalMs: 5 },
			hasAuth: false,
			hasContextHook: false,
			actor: { kind: 'agent' },
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const { createToolRouter } = await import('./tool-router.js');
		const routeToolCall = createToolRouter({
			executeCommand: async (name, input, ctx) => {
				const cmd = commands.find((c) => c.name === name);
				if (!cmd) return failure({ code: 'COMMAND_NOT_FOUND', message: 'Not found' });
				return cmd.handler(input as never, ctx ?? {});
			},
			executeBatch: async () => {
				throw new Error('unused');
			},
			executePipeline: async () => {
				throw new Error('unused');
			},
			commands,
			toolStrategy: 'individual',
			devMode: false,
		});
		const handle = serveModernStdio(
			{
				name: 'stdio-tasks',
				version: '1.0.0',
				instructions: 'test',
				getToolsList: () => [],
				routeToolCall,
				tasks: taskRuntime,
				devMode: false,
			},
			undefined,
			serverTransport
		);
		cleanups.push(async () => {
			taskRuntime.dispose();
			await handle.close();
		});

		const client = new Client(
			{ name: 'stdio-client', version: '1.0.0' },
			{
				capabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } as never,
				versionNegotiation: { mode: { pin: '2026-07-28' } },
			}
		);
		const intercepted = new Map<string, Record<string, unknown>>();
		let seq = 0;
		await client.connect(clientTransport);
		cleanups.push(() => client.close());

		const deliver = clientTransport.onmessage;
		clientTransport.onmessage = (message) => {
			const msg = message as { id?: string | number; result?: Record<string, unknown> };
			if (msg?.result?.resultType === 'task') {
				const token = String(++seq);
				intercepted.set(token, msg.result);
				deliver?.({
					jsonrpc: '2.0',
					id: msg.id as string | number,
					result: { resultType: 'complete', content: [], _meta: { __task: token } },
				} as never);
				return;
			}
			deliver?.(message);
		};

		const serverCaps = client.getServerCapabilities() as {
			extensions?: Record<string, unknown>;
		};
		expect(serverCaps.extensions?.[TASKS_EXTENSION_ID]).toEqual({});

		const called = (await client.callTool({ name: 'job-must', arguments: { note: 'stdio' } })) as {
			_meta?: { __task?: string };
		};
		const taskSeed = intercepted.get(String(called._meta?.__task));
		expect(taskSeed?.resultType).toBe('task');
		const taskId = String(taskSeed?.taskId);
		expect(isTaskId(taskId)).toBe(true);

		const passThrough = {
			'~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
		};
		let detailed: Record<string, unknown> = {};
		for (let i = 0; i < 50; i++) {
			detailed = (await client.request(
				{ method: 'tasks/get', params: { taskId } },
				passThrough as never
			)) as Record<string, unknown>;
			if (detailed.status !== 'working') break;
			await new Promise((r) => setTimeout(r, 10));
		}
		expect(detailed.status).toBe('completed');
		expect(
			(detailed.result as { structuredContent: { data: { note: string } } }).structuredContent.data
				.note
		).toBe('stdio');
	});

	it('ends a task whose result cannot be serialized as failed, with error.message (#2501)', async () => {
		// Claude Code reads a failed task's error.message; AFD sets failed only for internal errors.
		const jobBigint = defineCommand({
			name: 'job-bigint',
			description: 'Return a result JSON cannot hold',
			expose: { mcp: true },
			task: 'required',
			input: z.object({}),
			async handler() {
				return success({ count: 1n });
			},
		});
		const handler = createMcpHandler({
			name: 'tasks-failed',
			version: '1.0.0',
			commands: [jobBigint],
			toolStrategy: 'individual',
			createContext: makeActorContext,
			taskOptions: defaultTaskOptions,
		});
		const http = await listenHandler(handler);
		const started = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-bigint', arguments: {} },
			{
				tasks: true,
			}
		);
		const seed = started.body.result as { resultType?: string; taskId: string };
		expect(seed.resultType).toBe('task');
		const settled = await pollUntilSettled(http.url, seed.taskId);
		expect(settled).toMatchObject({
			resultType: 'complete',
			status: 'failed',
			error: { code: -32603, message: 'Internal error' },
		});
		expect(settled.result).toBeUndefined();
	});

	it('retains a finished task result for ttlMs after finish even past maxRunMs, and times out working tasks', async () => {
		const runs = { echo: 0, wait: 0, list: 0, aborted: 0 };
		const waitStarted = deferred();
		const waitRelease = deferred();
		const clock = fixedClock(NOW_MS);
		const http = await listenHandler(
			createMcpHandler({
				name: 'retention-test',
				version: '1.0.0',
				commands: makeCommands({ runs, waitStarted, waitRelease }),
				toolStrategy: 'individual',
				clock,
				createContext: makeActorContext,
				taskOptions: {
					// Default 1h maxRunMs + 1h ttlMs = 2h initial ttlMs
					pollIntervalMs: 10,
					checkIntervalMs: 5,
					callersIdentifiedByHook: true,
				},
			})
		);

		// 1. Task finishes at 55 minutes: stays readable past 1h run budget until finishedAt + 1h
		const created = await rpc(
			http.url,
			'tools/call',
			{ name: 'job-wait', arguments: {} },
			{ tasks: true }
		);
		const seed = created.body.result as { taskId: string; ttlMs: number };
		expect(seed.ttlMs).toBe(DEFAULT_TASK_MAX_RUN_MS + DEFAULT_TASK_TTL_MS);
		await waitStarted.promise;

		clock.advance(55 * 60_000);
		waitRelease.resolve();
		const done = await pollUntilSettled(http.url, seed.taskId);
		expect(done.status).toBe('completed');
		expect(done.ttlMs).toBe(55 * 60_000 + DEFAULT_TASK_TTL_MS);

		// Past 1h from creation (5m after finish) and 1ms before finishedAt + 1h -> still readable
		clock.advance(10 * 60_000);
		const stillThere = await rpc(http.url, 'tasks/get', { taskId: seed.taskId }, { tasks: true });
		expect((stillThere.body.result as { status: string }).status).toBe('completed');

		clock.advance(50 * 60_000 - 1);
		const lastMs = await rpc(http.url, 'tasks/get', { taskId: seed.taskId }, { tasks: true });
		expect((lastMs.body.result as { status: string }).status).toBe('completed');

		// Exactly at finishedAt + 1h -> gone (-32602)
		clock.advance(1);
		const gone = await rpc(http.url, 'tasks/get', { taskId: seed.taskId }, { tasks: true });
		expect(gone.body.error).toEqual({ code: -32602, message: 'Task not found' });

		// 2. Working task exceeding maxRunMs completes with TIMEOUT (read retryable, mutation non-retryable)
		// and keeps that TIMEOUT result for ttlMs after it stops.
		const shortClock = fixedClock(NOW_MS);
		const readStarted = deferred();
		const readRelease = deferred();
		const readHttp = await listenHandler(
			createMcpHandler({
				name: 'timeout-read',
				version: '1.0.0',
				commands: makeCommands({
					runs: { echo: 0, wait: 0, list: 0, aborted: 0 },
					waitStarted: readStarted,
					waitRelease: readRelease,
				}),
				toolStrategy: 'individual',
				clock: shortClock,
				createContext: makeActorContext,
				taskOptions: {
					maxRunMs: 10_000,
					ttlMs: 30_000,
					pollIntervalMs: 10,
					checkIntervalMs: 5,
					callersIdentifiedByHook: true,
				},
			})
		);
		const readCreated = await rpc(
			readHttp.url,
			'tools/call',
			{ name: 'job-wait', arguments: {} },
			{ tasks: true }
		);
		const readId = String((readCreated.body.result as { taskId: string }).taskId);
		await readStarted.promise;
		shortClock.advance(10_000);
		const readTimedOut = await pollUntilSettled(readHttp.url, readId);
		expect(readTimedOut.status).toBe('completed');
		expect(
			(
				readTimedOut.result as {
					structuredContent: { error: { code: string; retryable: boolean } };
				}
			).structuredContent.error
		).toMatchObject({ code: ErrorCodes.TIMEOUT, retryable: true });

		// Retained for ttlMs (30s) after timeout, then gone
		shortClock.advance(29_999);
		expect(
			(
				(await rpc(readHttp.url, 'tasks/get', { taskId: readId }, { tasks: true })).body.result as {
					status: string;
				}
			).status
		).toBe('completed');
		shortClock.advance(1);
		expect(
			(await rpc(readHttp.url, 'tasks/get', { taskId: readId }, { tasks: true })).body.error
		).toEqual({ code: -32602, message: 'Task not found' });

		// Mutation exceeding maxRunMs is NOT retryable
		const mutClock = fixedClock(NOW_MS);
		const mutStarted = deferred();
		const mutRelease = deferred();
		const mutHttp = await listenHandler(
			createMcpHandler({
				name: 'timeout-mut',
				version: '1.0.0',
				commands: makeCommands({
					runs: { echo: 0, wait: 0, list: 0, aborted: 0 },
					waitStarted: mutStarted,
					waitRelease: mutRelease,
				}),
				toolStrategy: 'individual',
				clock: mutClock,
				createContext: makeActorContext,
				taskOptions: {
					maxRunMs: 10_000,
					ttlMs: 30_000,
					pollIntervalMs: 10,
					checkIntervalMs: 5,
					callersIdentifiedByHook: true,
				},
			})
		);
		const mutCreated = await rpc(
			mutHttp.url,
			'tools/call',
			{ name: 'job-write', arguments: {} },
			{ tasks: true }
		);
		const mutId = String((mutCreated.body.result as { taskId: string }).taskId);
		await mutStarted.promise;
		mutClock.advance(10_000);
		const mutTimedOut = await pollUntilSettled(mutHttp.url, mutId);
		expect(
			(
				mutTimedOut.result as {
					structuredContent: { error: { code: string; retryable: boolean } };
				}
			).structuredContent.error
		).toMatchObject({ code: ErrorCodes.TIMEOUT, retryable: false });

		// 3. Handler returning slightly past maxRunMs (before ttlMs) keeps its result and caps ttlMs
		const lateClock = fixedClock(NOW_MS);
		const lateStarted = deferred();
		const lateRelease = deferred();
		const lateHttp = await listenHandler(
			createMcpHandler({
				name: 'late-return',
				version: '1.0.0',
				commands: makeCommands({
					runs: { echo: 0, wait: 0, list: 0, aborted: 0 },
					waitStarted: lateStarted,
					waitRelease: lateRelease,
				}),
				toolStrategy: 'individual',
				clock: lateClock,
				createContext: makeActorContext,
				taskOptions: {
					maxRunMs: 10_000,
					ttlMs: 30_000,
					pollIntervalMs: 10,
					// Long check interval so handler returns before next timeout tick
					checkIntervalMs: 5_000,
					callersIdentifiedByHook: true,
				},
			})
		);
		const lateCreated = await rpc(
			lateHttp.url,
			'tools/call',
			{ name: 'job-wait', arguments: {} },
			{ tasks: true }
		);
		const lateId = String((lateCreated.body.result as { taskId: string }).taskId);
		await lateStarted.promise;
		lateClock.advance(12_000);
		lateRelease.resolve();
		const lateDone = await pollUntilSettled(lateHttp.url, lateId);
		expect(lateDone.status).toBe('completed');
		expect((lateDone.result as { isError: boolean }).isError).toBe(false);
		expect(lateDone.ttlMs).toBe(40_000);
	});
});
