/**
 * `@lushly-dev/afd-client` on its default `streamable-http` transport against an AFD server's
 * `/mcp` endpoint: MCP 2026-07-28 end to end, including batch, pipeline and the sibling
 * `/stream` route.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient } from '@lushly-dev/afd-client';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const items = defineCommand({
	name: 'item-list',
	description: 'List items',
	expose: { mcp: true },
	input: z.object({ prefix: z.string().optional() }),
	handler: async ({ prefix }) => success({ items: ['a', 'b'].map((x) => `${prefix ?? ''}${x}`) }),
});
const count = defineCommand({
	name: 'item-count',
	description: 'Count items',
	expose: { mcp: true },
	input: z.object({ items: z.array(z.string()) }),
	handler: async ({ items }) => success({ count: items.length }),
});

async function serve() {
	const handler = createMcpHandler({
		name: 'client-e2e',
		version: '1.0.0',
		commands: [items, count],
		host: '127.0.0.1',
	});
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}

describe('McpClient against /mcp', () => {
	it.each(['auto', 'modern', 'legacy'] as const)(
		'calls, batches, pipes and streams in protocolMode %s',
		async (protocolMode) => {
			const client = new McpClient({ url: await serve(), protocolMode, autoReconnect: false });
			cleanups.push(() => client.disconnect());
			const init = await client.connect();
			expect(init.protocolVersion).toBe(protocolMode === 'legacy' ? '2025-11-25' : '2026-07-28');
			expect(init.serverInfo.name).toBe('client-e2e');

			expect(await client.call('item-list', { prefix: 'x' })).toMatchObject({
				success: true,
				data: { items: ['xa', 'xb'] },
			});

			const batch = await client.batch([
				{ command: 'item-list', input: {} },
				{ command: 'item-count', input: { items: ['1', '2', '3'] } },
			]);
			expect(batch.summary).toMatchObject({ successCount: 2, failureCount: 0 });

			const pipeline = await client.pipe([
				{ command: 'item-list', input: {} },
				{ command: 'item-count', input: { items: '$prev.items' } },
			]);
			expect(pipeline.data).toEqual({ count: 2 });

			const chunks = [];
			for await (const chunk of client.stream('item-list', {})) chunks.push(chunk.type);
			expect(chunks.at(-1)).toBe('complete');
		}
	);
});
