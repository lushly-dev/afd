/**
 * @fileoverview Unit tests for `McpClient` and `StreamableHttpTransport` MCP Tasks support
 * against a minimal MCP 2026-07-28 SDK server.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
	CLIENT_CAPABILITIES_META_KEY,
	createMcpHandler,
	ProtocolError,
	ProtocolErrorCode,
	Server,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';
import type { TaskInfo } from './types.js';

const TASKS_EXT = 'io.modelcontextprotocol/tasks';
const PASS_PARAMS = {
	'~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length > 0) {
		await cleanups.pop()?.();
	}
});

class CreateTaskSignal {
	constructor(readonly result: Record<string, unknown>) {}
}

async function startSdkTaskServer() {
	const tasks = new Map<
		string,
		{ polls: number; status: string; cancelled: boolean; statusMessage?: string; mode: string }
	>();
	let seq = 0;

	const factory = () => {
		const server = new Server(
			{ name: 'sdk-tasks', version: '1.0.0' },
			{ capabilities: { tools: {}, extensions: { [TASKS_EXT]: {} } } as never }
		);
		const sdk = server as unknown as {
			_wrapHandler(
				method: string,
				handler: (req: unknown, ctx: unknown) => Promise<unknown>
			): (req: unknown, extra: unknown) => Promise<unknown>;
		};
		const origWrap = sdk._wrapHandler.bind(server);
		sdk._wrapHandler = (method, handler) => {
			if (method !== 'tools/call') return origWrap(method, handler);
			const wrapped = origWrap(method, handler);
			return async (req, extra) => {
				try {
					return await wrapped(req, extra);
				} catch (error) {
					if (error instanceof CreateTaskSignal) return error.result;
					throw error;
				}
			};
		};
		server.setRequestHandler('tools/list', async () => ({
			tools: [
				{ name: 'job-ok', description: 'Completes after 1 poll', inputSchema: { type: 'object' } },
				{
					name: 'job-hang',
					description: 'Stays working until cancelled',
					inputSchema: { type: 'object' },
				},
				{
					name: 'job-rpc-fail',
					description: 'Fails with JSON-RPC error',
					inputSchema: { type: 'object' },
				},
			],
		}));
		server.setRequestHandler('tools/call', async (request, ctx) => {
			const caps = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
				CLIENT_CAPABILITIES_META_KEY
			] as { extensions?: Record<string, unknown> } | undefined;
			const hasTasks = Boolean(caps?.extensions?.[TASKS_EXT]);
			if (!hasTasks) {
				throw new ProtocolError(
					ProtocolErrorCode.MissingRequiredClientCapability,
					'Client must declare io.modelcontextprotocol/tasks',
					{ requiredCapabilities: { extensions: { [TASKS_EXT]: {} } } }
				);
			}
			const taskId = `task${String(++seq).padStart(22, 'a')}`;
			tasks.set(taskId, {
				polls: 0,
				status: 'working',
				cancelled: false,
				mode: request.params.name,
			});
			const now = new Date().toISOString();
			throw new CreateTaskSignal({
				resultType: 'task',
				taskId,
				status: 'working',
				createdAt: now,
				lastUpdatedAt: now,
				ttlMs: 60_000,
				pollIntervalMs: 15,
			});
		});
		server.setRequestHandler('tasks/get', { params: PASS_PARAMS as never }, async (params) => {
			const { taskId } = params as { taskId: string };
			const state = tasks.get(taskId);
			if (!state) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Task not found');
			state.polls += 1;
			const now = new Date().toISOString();
			if (state.cancelled) {
				return {
					taskId,
					status: 'cancelled',
					createdAt: now,
					lastUpdatedAt: now,
					ttlMs: 60_000,
					pollIntervalMs: 15,
				} as never;
			}
			if (state.mode === 'job-ok' && state.polls === 1) {
				state.statusMessage = 'halfway';
				return {
					taskId,
					status: 'working',
					statusMessage: 'halfway',
					createdAt: now,
					lastUpdatedAt: now,
					ttlMs: 60_000,
					pollIntervalMs: 15,
				} as never;
			}
			if (state.mode === 'job-ok') {
				const body = { success: true, data: { ok: true } };
				return {
					taskId,
					status: 'completed',
					createdAt: now,
					lastUpdatedAt: now,
					ttlMs: 60_000,
					pollIntervalMs: 15,
					result: {
						content: [{ type: 'text', text: JSON.stringify(body) }],
						structuredContent: body,
						isError: false,
					},
				} as never;
			}
			if (state.mode === 'job-rpc-fail') {
				return {
					taskId,
					status: 'failed',
					createdAt: now,
					lastUpdatedAt: now,
					ttlMs: 60_000,
					pollIntervalMs: 15,
					error: { code: -32603, message: 'Worker crashed' },
				} as never;
			}
			return {
				taskId,
				status: 'working',
				createdAt: now,
				lastUpdatedAt: now,
				ttlMs: 60_000,
				pollIntervalMs: 15,
			} as never;
		});
		server.setRequestHandler('tasks/cancel', { params: PASS_PARAMS as never }, async (params) => {
			const { taskId } = params as { taskId: string };
			const state = tasks.get(taskId);
			if (!state) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Task not found');
			state.cancelled = true;
			return {} as never;
		});
		return server;
	};

	const handler = createMcpHandler(factory);
	const http = createServer(toNodeHandler(handler));
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
	cleanups.push(async () => {
		await handler.close();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, tasks };
}

describe('McpClient MCP Tasks protocol handling', () => {
	it('polls tasks/get, reports progress transitions, handles failed status and AbortSignal cancel', async () => {
		const { url, tasks } = await startSdkTaskServer();
		const client = new McpClient({
			url,
			protocolMode: 'modern',
			tasks: true,
			autoReconnect: false,
		});
		await client.connect();
		cleanups.push(() => client.disconnect());

		const updates: TaskInfo[] = [];
		const ok = await client.call<{ ok: boolean }>(
			'job-ok',
			{},
			{ onTaskProgress: (t) => updates.push(t) }
		);
		expect(ok.success).toBe(true);
		expect(ok.data).toEqual({ ok: true });
		expect(updates.map((u) => `${u.status}:${u.statusMessage ?? ''}`)).toEqual([
			'working:',
			'working:halfway',
			'completed:',
		]);

		const rpcFail = await client.call('job-rpc-fail', {});
		expect(rpcFail.success).toBe(false);
		expect(rpcFail.error?.code).toBe('INTERNAL_ERROR');

		const ac = new AbortController();
		const cancelled = await client.call(
			'job-hang',
			{},
			{
				signal: ac.signal,
				onTaskProgress: () => ac.abort(),
			}
		);
		expect(cancelled.success).toBe(false);
		expect(cancelled.error?.code).toBe('COMMAND_CANCELLED');
		expect(cancelled.error?.retryable).toBe(false);
		await vi.waitFor(
			() => {
				const hangTask = [...tasks.values()].find((t) => t.mode === 'job-hang');
				expect(hangTask?.cancelled).toBe(true);
			},
			{ timeout: 2000 }
		);
	});

	it('maps -32021 to MISSING_CLIENT_CAPABILITY when tasks is disabled', async () => {
		const { url } = await startSdkTaskServer();
		const client = new McpClient({
			url,
			protocolMode: 'modern',
			tasks: false,
			autoReconnect: false,
		});
		await client.connect();
		cleanups.push(() => client.disconnect());

		const denied = await client.call('job-ok', {});
		expect(denied.success).toBe(false);
		expect(denied.error?.code).toBe('MISSING_CLIENT_CAPABILITY');
		expect(denied.error?.retryable).toBe(false);
	});
});
