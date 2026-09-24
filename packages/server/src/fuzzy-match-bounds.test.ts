/**
 * Regression tests for unbounded fuzzy matching of unknown command names (H1).
 * Before the fix, a 200 KB `afd-call` name blocked the event loop for seconds.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const domains = ['todo', 'user', 'order', 'item', 'report'];
const actions = ['create', 'list', 'get', 'update', 'delete', 'toggle', 'clear', 'stats'];
// 100 commands: enough that the old full-matrix match took seconds per request.
const commands = Array.from({ length: 100 }, (_, i) =>
	defineCommand({
		name: `${domains[i % domains.length]}${Math.floor(i / 40) || ''}-${actions[i % actions.length]}${i}`,
		description: 'Fuzzy-match bound test command',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => ({ success: true, data: null }),
	})
);

async function host() {
	const handler = createMcpHandler({
		name: 'fuzzy-bounds',
		version: '1',
		host: '127.0.0.1',
		commands,
		toolStrategy: 'lazy',
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(url: string, name: string, args: unknown) {
	const response = await fetch(`${url}/message`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { result: { content: [{ text: string }] } };
	return JSON.parse(body.result.content[0].text);
}

// Before the fix these requests blocked the event loop for 5-22 s (quadratic fuzzy matching).
// The bound is far below that but leaves room for JSON/HTTP cost on a busy CI runner,
// where ~1 MB request bodies alone take 100-200 ms.
const MAX_RESPONSE_MS = 1_000;

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
	const start = performance.now();
	const value = await run();
	return { value, ms: performance.now() - start };
}

describe('fuzzy matching of untrusted command names', () => {
	it('answers afd-call with a 200 KB unknown name quickly and without echoing it', async () => {
		const url = await host();
		// Warm up the connection so the timing measures the request itself.
		expect((await call(url, 'afd-call', { command: 'todo-creat' })).error.code).toBe(
			'COMMAND_NOT_FOUND'
		);

		const name = 'x'.repeat(200 * 1024);
		const { value: result, ms } = await timed(() => call(url, 'afd-call', { command: name }));

		expect(ms).toBeLessThan(MAX_RESPONSE_MS);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('COMMAND_NOT_FOUND');
		expect(result.error.message).toBe(`Command '${'x'.repeat(128)}…' not found`);
		expect(result.error.suggestion).toBe('Use afd-discover to list all commands.');
	});

	it('answers afd-detail with 10 long names quickly', async () => {
		const url = await host();
		expect((await call(url, 'afd-detail', { command: 'todo-creat' })).success).toBe(true);

		const names = Array.from({ length: 10 }, (_, i) => String(i).repeat(87_900));
		const { value: result, ms } = await timed(() => call(url, 'afd-detail', { command: names }));

		expect(ms).toBeLessThan(MAX_RESPONSE_MS);
		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(10);
		// Each name is echoed cut to 128 characters, not in full (~88 KB each).
		expect(JSON.stringify(result).length).toBeLessThan(10_000);
		for (const [i, entry] of result.data.entries()) {
			expect(entry.name).toBe(`${String(i).repeat(128)}…`);
			expect(entry.found).toBe(false);
			expect(entry.error.code).toBe('COMMAND_NOT_FOUND');
			expect(entry.error.message).toBe(`No command named '${String(i).repeat(128)}…'`);
			expect(entry.error.suggestion).toBe('Use afd-discover to list all commands.');
		}
	});

	it('suggests at most three close matches, never every command, for an unknown tool', async () => {
		const url = await host();
		const target = commands[0]?.name as string;
		// Unknown tool names fall through to command execution (COMMAND_NOT_FOUND there).
		const result = await call(url, target.slice(0, -1), {});

		expect(result.error.code).toBe('COMMAND_NOT_FOUND');
		const suggestion: string = result.error.suggestion;
		expect(suggestion).toMatch(/^Did you mean '/);
		expect(suggestion).toContain('afd-discover');
		const named = commands.filter((command) => suggestion.includes(`'${command.name}'`));
		expect(named.length).toBeGreaterThan(0);
		expect(named.length).toBeLessThanOrEqual(3);

		const unrelated = await call(url, 'zzzz', {});
		expect(unrelated.error.suggestion).toBe('Use afd-discover to list all commands.');
	});

	it('returns compact JSON tool results', async () => {
		const url = await host();
		const response = await fetch(`${url}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'afd-discover', arguments: { limit: 5 } },
			}),
		});
		const body = (await response.json()) as { result: { content: [{ text: string }] } };
		const text = body.result.content[0].text;
		expect(text).not.toContain('\n');
		expect(text).toBe(JSON.stringify(JSON.parse(text)));
	});

	it('still suggests close matches for normal-length names', async () => {
		const url = await host();
		const target = commands[0]?.name as string;
		const typo = target.slice(0, -1);
		const called = await call(url, 'afd-call', { command: typo });
		expect(called.error.suggestion).toContain(`Did you mean '${target}'?`);
		const detail = await call(url, 'afd-detail', { command: [typo] });
		expect(detail.data[0].error.suggestion).toContain(`Did you mean '${target}'?`);
	});
});
