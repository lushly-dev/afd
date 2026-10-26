/**
 * `actor`, `clock` and `random` on the command context (#271, #274): what each server
 * surface fills in, what callers can override, and `metadata.actorKind`.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient } from '@lushly-dev/afd-client';
import {
	type CommandContext,
	type CommandMiddleware,
	fixedClock,
	seededRandom,
	success,
	systemClock,
	systemRandom,
} from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

let seen: CommandContext[] = [];
afterEach(() => {
	seen = [];
});

const inspect = defineCommand({
	name: 'context-inspect',
	description: 'Report the clock, random source and actor the handler sees',
	expose: { mcp: true },
	input: z.object({}),
	handler: async (_input, context) => {
		if (context) seen.push(context);
		return success({
			now: context?.clock?.now(),
			roll: context?.random?.next(),
			actor: context?.actor ?? null,
		});
	},
});

async function remote(options: Partial<McpHandlerOptions> = {}) {
	const handler = createMcpHandler({
		name: 'context-primitives',
		version: '1',
		host: '127.0.0.1',
		commands: [inspect],
		toolStrategy: 'individual',
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const client = new McpClient({ url: `${url}/message`, transport: 'http', autoReconnect: false });
	cleanups.push(async () => {
		await client.disconnect();
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	await client.connect();
	return client;
}

describe('MCP server context defaults', () => {
	it('calls remote commands as an agent with the real clock and random source', async () => {
		const client = await remote();
		const result = await client.call('context-inspect', {});
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ actor: { kind: 'agent' } });
		expect(result.metadata?.actorKind).toBe('agent');
		expect(seen[0]?.clock).toBe(systemClock);
		expect(seen[0]?.random).toBe(systemRandom);
	});

	it('uses the configured clock, random source and actor', async () => {
		const client = await remote({
			clock: fixedClock('2026-01-01T00:00:00Z'),
			random: seededRandom('abc'),
			actor: { kind: 'service', id: 'batch-runner' },
		});
		const result = await client.call('context-inspect', {});
		expect(result.data).toEqual({
			now: Date.UTC(2026, 0, 1),
			roll: 0.5166419988963753,
			actor: { kind: 'service', id: 'batch-runner' },
		});
		// The fixed clock makes the reported duration deterministic.
		expect(result.metadata).toMatchObject({ actorKind: 'service', executionTimeMs: 0 });
	});

	it('lets createContext set a per-request actor', async () => {
		const client = await remote({
			createContext: () => ({ actor: { kind: 'script', label: 'nightly import' } }),
		});
		const result = await client.call('context-inspect', {});
		expect(result.data).toMatchObject({ actor: { kind: 'script', label: 'nightly import' } });
		expect(result.metadata?.actorKind).toBe('script');
	});

	it('reports the actor kind after middleware refines it, but never the id', async () => {
		const promote: CommandMiddleware = (_name, _input, context, next) => {
			context.actor = { kind: 'human', id: 'user-1', label: 'Ada' };
			return next();
		};
		const client = await remote({ middleware: [promote] });
		const result = await client.call('context-inspect', {});
		expect(result.metadata?.actorKind).toBe('human');
		expect(JSON.stringify(result.metadata)).not.toContain('user-1');
	});
});

describe('in-process execution', () => {
	it('server.execute() fills clock and random but assumes no actor', async () => {
		const server = createMcpServer({ name: 'local', version: '1', commands: [inspect] });
		const result = await server.execute('context-inspect', {});
		expect(result.data).toMatchObject({ actor: null });
		expect(result.metadata?.actorKind).toBeUndefined();
		expect(seen[0]?.clock).toBe(systemClock);

		const tested = await server.execute('context-inspect', {}, { actor: { kind: 'test' } });
		expect(tested.metadata?.actorKind).toBe('test');
	});

	it('createDirectRegistry() applies its defaults, and the caller’s context wins', async () => {
		const registry = createDirectRegistry([inspect], {
			clock: fixedClock(1000),
			random: seededRandom('abc'),
			actor: { kind: 'agent', label: 'assistant' },
		});
		const defaults = await registry.execute('context-inspect');
		expect(defaults.data).toEqual({
			now: 1000,
			roll: 0.5166419988963753,
			actor: { kind: 'agent', label: 'assistant' },
		});

		const caller = await registry.execute(
			'context-inspect',
			{},
			{
				clock: fixedClock(5),
				random: { next: () => 0.5 },
				actor: { kind: 'human' },
			}
		);
		expect(caller.data).toEqual({ now: 5, roll: 0.5, actor: { kind: 'human' } });
		expect(caller.metadata?.actorKind).toBe('human');
	});
});
