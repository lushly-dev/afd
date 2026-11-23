import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { commandToolAnnotations } from '@lushly-dev/afd-core';
import { createSpecimenBench } from '@lushly-dev/specimen';
import { createSpecimenCommands } from '@lushly-dev/specimen-afd';
import { runCli } from '@lushly-dev/specimen-cli';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpecimenMcpServer } from './server.js';

const exec = promisify(execFile);
const binary = new URL('../dist/bin.js', import.meta.url);

function envelope(result: CallToolResult) {
	const content = result.content[0];
	if (content?.type !== 'text') throw new Error('Expected a JSON text result');
	return JSON.parse(content.text);
}

describe('Specimen MCP endpoint', () => {
	let root: string;
	const clients: Client[] = [];
	const servers: Awaited<ReturnType<typeof createSpecimenMcpServer>>[] = [];
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'specimen-mcp-'));
		await writeFile(join(root, 'case.ts'), 'throw new Error("Listing must not execute modules");');
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [{ id: 'cheap', title: 'Test/Cheap', module: './case.ts', exportName: 'Cheap' }],
			})
		);
	});
	afterEach(async () => {
		await Promise.all(clients.splice(0).map((client) => client.close()));
		await Promise.all(servers.splice(0).map((server) => server.close()));
		await rm(root, { recursive: true, force: true });
	});
	async function connect() {
		const server = await createSpecimenMcpServer({ root });
		servers.push(server);
		const client = new Client({ name: 'specimen-test', version: '1.0.0' });
		clients.push(client);
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		return client;
	}

	it('lists exactly the exposed shared commands with their schemas and annotations', async () => {
		const client = await connect();
		const bench = await createSpecimenBench({ root });
		try {
			const definitions = createSpecimenCommands(bench).filter((command) => command.expose?.mcp);
			const { tools } = await client.listTools();
			expect(tools).toHaveLength(20);
			expect(tools).toEqual(
				definitions.map((command) => ({
					name: command.name,
					description: command.description,
					inputSchema: command.jsonSchema,
					annotations: commandToolAnnotations(command),
				}))
			);
			expect(tools.find((tool) => tool.name === 'specimen-capture')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-migrate')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
		} finally {
			await bench.close();
		}
	});

	it('preserves successful and invalid-input CLI envelopes', async () => {
		const client = await connect();
		let cliOutput = '';
		expect(
			await runCli(['--root', root, 'list'], {
				stdout: (text) => {
					cliOutput += text;
				},
			})
		).toBe(0);
		const listed = await client.callTool({ name: 'specimen-list', arguments: {} });
		expect(listed.isError).toBe(false);
		expect(envelope(listed as CallToolResult)).toEqual(JSON.parse(cliOutput));
		const invalid = await client.callTool({
			name: 'specimen-list',
			arguments: { unexpected: true },
		});
		expect(invalid.isError).toBe(true);
		expect(envelope(invalid as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR', suggestion: expect.any(String) },
		});
	});

	it('returns the CLI failure envelope and rejects unknown or unexposed tool names', async () => {
		const client = await connect();
		const failed = await client.callTool({ name: 'specimen-migrate', arguments: {} });
		expect(failed.isError).toBe(true);
		expect(envelope(failed as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'SPECIMEN_MIGRATE_FAILED', suggestion: expect.any(String) },
		});
		const unknown = await client.callTool({ name: 'specimen-private', arguments: {} });
		expect(unknown.isError).toBe(true);
		expect(envelope(unknown as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'COMMAND_NOT_FOUND', suggestion: expect.any(String) },
		});
		const missingSet = await client.callTool({
			name: 'specimen-diff',
			arguments: {
				left: { set: 'main', id: 'cheap' },
				right: { set: 'branch', id: 'cheap' },
			},
		});
		expect(missingSet.isError).toBe(true);
		expect(envelope(missingSet as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'CAPTURE_SET_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-capture'),
			},
		});
	});

	it('lists and calls over stdio with exactly the real CLI result envelope', async () => {
		const client = new Client({ name: 'specimen-stdio-test', version: '1.0.0' });
		clients.push(client);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [fileURLToPath(binary), '--root', root, '--config', 'specimen.config.json'],
			stderr: 'pipe',
		});
		let stderr = '';
		transport.stderr?.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		await client.connect(transport);
		expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('specimen-list');
		const result = await client.callTool({ name: 'specimen-list', arguments: {} });
		const cliBin = new URL('../../specimen-cli/dist/bin.js', import.meta.url);
		const cli = await exec(process.execPath, [fileURLToPath(cliBin), '--root', root, 'list']);
		expect(result.isError).toBe(false);
		expect(envelope(result as CallToolResult)).toEqual(JSON.parse(cli.stdout));
		expect(stderr).toBe('');
	});

	it('exits cleanly on stdin EOF without the SDK client sending termination signals', async () => {
		const child = spawn(process.execPath, [fileURLToPath(binary), '--root', root], {
			stdio: 'pipe',
			signal: AbortSignal.timeout(5000),
		});
		let stdout = '';
		let stderr = '';
		const closed = new Promise<{ code: number | null; signal: string | null }>(
			(resolve, reject) => {
				child.once('error', reject);
				child.once('close', (code, signal) => resolve({ code, signal }));
			}
		);
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.stdout.once('data', () => child.stdin.end());
		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					capabilities: {},
					clientInfo: { name: 'eof-test', version: '1.0.0' },
				},
			})}\n`
		);
		expect(await closed).toEqual({ code: 0, signal: null });
		expect(JSON.parse(stdout)).toMatchObject({
			id: 1,
			result: { serverInfo: { name: 'specimen' } },
		});
		expect(stderr).toBe('');
	});
});
