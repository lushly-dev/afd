import { initializeCore, registry } from '@lushly-dev/violet-afd';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMcpServer } from './server.js';

describe('MCP protocol (in-memory client)', () => {
	const cleanups: Array<() => Promise<void>> = [];

	beforeAll(() => {
		initializeCore();
	});

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function connect(): Promise<Client> {
		const server = await createMcpServer({ useMemory: true, skipInit: true });
		const client = new Client({ name: 'test-client', version: '1.0.0' });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		cleanups.push(async () => {
			await client.close();
			await server.close();
		});
		return client;
	}

	function parseText(result: Awaited<ReturnType<Client['callTool']>>): {
		success: boolean;
		data?: Record<string, unknown>;
		error?: { code: string; message: string };
	} {
		const content = result.content as Array<{ type: string; text: string }>;
		return JSON.parse(content[0].text);
	}

	it('lists every command with its real input schema', async () => {
		const client = await connect();
		const { tools } = await client.listTools();

		expect(tools.length).toBe(registry.list().length);

		const nodeCreate = tools.find((t) => t.name === 'node.create');
		expect(nodeCreate).toBeDefined();
		expect(nodeCreate?.inputSchema.type).toBe('object');
		expect(Object.keys(nodeCreate?.inputSchema.properties ?? {})).toEqual(
			expect.arrayContaining(['name', 'type']),
		);
		expect(nodeCreate?.inputSchema.required).toEqual(expect.arrayContaining(['name']));
	});

	it('passes tool arguments through to the command', async () => {
		const client = await connect();

		const created = await client.callTool({
			name: 'node.create',
			arguments: { name: 'Brand', type: 'product' },
		});
		expect(created.isError).toBeFalsy();
		const createdBody = parseText(created);
		expect(createdBody.success).toBe(true);
		const node = createdBody.data?.node as { id: string; name: string; type: string };
		expect(node.name).toBe('Brand');
		expect(node.type).toBe('product');

		const fetched = await client.callTool({ name: 'node.get', arguments: { id: node.id } });
		expect(fetched.isError).toBeFalsy();
		expect(parseText(fetched).success).toBe(true);
	});

	it('reports validation errors for missing arguments', async () => {
		const client = await connect();
		const result = await client.callTool({ name: 'node.create', arguments: {} });

		expect(result.isError).toBe(true);
		expect(parseText(result).error?.code).toBe('VALIDATION_ERROR');
	});

	it('reports unknown tools as errors', async () => {
		const client = await connect();
		const result = await client.callTool({ name: 'does.not.exist', arguments: {} });

		expect(result.isError).toBe(true);
		expect(parseText(result).error?.code).toBe('COMMAND_NOT_FOUND');
	});
});
