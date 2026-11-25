import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { commandToolAnnotations } from '@lushly-dev/afd-core';
import { createSpecimenBench, writeCaptureSet } from '@lushly-dev/specimen';
import { CAPTURE_VERSION, NORMALIZATION_VERSION } from '@lushly-dev/specimen/types';
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
			expect(tools).toHaveLength(32);
			expect(tools).toEqual(
				definitions.map((command) => ({
					name: command.name,
					description: command.description,
					inputSchema: command.jsonSchema,
					annotations: commandToolAnnotations(command),
				}))
			);
			expect(tools.find((tool) => tool.name === 'specimen-job-create')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-job-run')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-capture')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-compare')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-migrate')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-point')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-point-move')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'specimen-point-check')?.annotations).toEqual({
				readOnlyHint: true,
			});
			expect(tools.find((tool) => tool.name === 'specimen-note-list')?.annotations).toEqual({
				readOnlyHint: true,
			});
			for (const mut of [
				'specimen-note-add',
				'specimen-note-check',
				'specimen-note-move',
				'specimen-note-resolve',
				'specimen-note-reopen',
			]) {
				expect(tools.find((tool) => tool.name === mut)?.annotations).toEqual({
					readOnlyHint: false,
					destructiveHint: false,
				});
			}
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
		const missingPoint = await client.callTool({
			name: 'specimen-point-check',
			arguments: { id: 'pt-000000000000' },
		});
		expect(missingPoint.isError).toBe(true);
		expect(envelope(missingPoint as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'POINT_NOT_FOUND', suggestion: expect.stringContaining('specimen-point') },
		});
		const badPointer = await client.callTool({
			name: 'specimen-point',
			arguments: { pointer: 'http://bad' },
		});
		expect(badPointer.isError).toBe(true);
		expect(envelope(badPointer as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'POINTER_INVALID', suggestion: expect.stringContaining('review page') },
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
		const unknownCompare = await client.callTool({
			name: 'specimen-compare',
			arguments: {
				ids: ['cheap', 'cheep'],
			},
		});
		expect(unknownCompare.isError).toBe(true);
		expect(envelope(unknownCompare as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'SPECIMEN_NOT_FOUND',
				message: expect.stringContaining('cheep'),
				suggestion: expect.stringContaining('cheap'),
			},
		});
		const notAJob = await client.callTool({
			name: 'specimen-job-run',
			arguments: { id: 'cheap' },
		});
		expect(notAJob.isError).toBe(true);
		expect(envelope(notAJob as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'NOT_A_JOB',
				suggestion: expect.stringContaining('specimen-list'),
			},
		});
		const emptyNotes = await client.callTool({
			name: 'specimen-note-list',
			arguments: {},
		});
		expect(emptyNotes.isError).toBe(false);
		expect(envelope(emptyNotes as CallToolResult)).toMatchObject({
			success: true,
			data: { notes: [] },
		});
		const missingNote = await client.callTool({
			name: 'specimen-note-resolve',
			arguments: { id: 'note-000000000000', outcome: 'fixed', reason: 'Done' },
		});
		expect(missingNote.isError).toBe(true);
		expect(envelope(missingNote as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'NOTE_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-note-list'),
			},
		});
		const emptyNoteText = await client.callTool({
			name: 'specimen-note-add',
			arguments: { pointer: 'specimen:cheap#ref=root/div:1', text: '' },
		});
		expect(emptyNoteText.isError).toBe(true);
		expect(envelope(emptyNoteText as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'NOTE_EMPTY',
				suggestion: expect.stringContaining('what'),
			},
		});
	});

	it('creates a job specimen over MCP and reflects it immediately in specimen-list, specimen-validate, and JOB_NEEDS_RUN on the same server session', async () => {
		await writeFile(
			join(root, 'job-source.mjs'),
			`export default {
	id: 'json-source',
	async parseScenario(ctx) {
		return JSON.parse(await ctx.read(ctx.scenarioPath));
	},
};\n`,
			'utf8'
		);
		await writeFile(
			join(root, 'keep-a-draft.scenario.json'),
			JSON.stringify({
				job: 'keep-a-draft',
				steps: [
					{ step: 1, command: 'note-create', description: 'A note is created' },
					{ step: 2, command: 'note-open', description: 'The note opens beside itself' },
				],
			}),
			'utf8'
		);
		await writeFile(
			join(root, 'dummy-plugin.mjs'),
			`export default { id: 'dummy-runner' };\n`,
			'utf8'
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				plugins: ['./dummy-plugin.mjs'],
				jobSources: ['./job-source.mjs'],
				specimens: [{ id: 'cheap', title: 'Test/Cheap', module: './case.ts', exportName: 'Cheap' }],
			}),
			'utf8'
		);

		const client = await connect();
		const created = await client.callTool({
			name: 'specimen-job-create',
			arguments: {
				id: 'example-keep-a-draft',
				scenario: './keep-a-draft.scenario.json',
				module: './case.ts',
				exportName: 'Cheap',
				target: 'app',
				captures: [2],
			},
		});
		expect(created.isError).toBe(false);
		expect(envelope(created as CallToolResult)).toMatchObject({
			success: true,
			data: {
				written: 'specimen.config.json',
				entry: {
					id: 'example-keep-a-draft',
					kind: 'job',
					job: {
						captures: [
							{ after: 'The note opens beside itself', name: 'the-note-opens-beside-itself' },
						],
					},
				},
			},
		});

		const jobs = await client.callTool({
			name: 'specimen-list',
			arguments: { kind: 'job' },
		});
		expect(jobs.isError).toBe(false);
		expect(envelope(jobs as CallToolResult)).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'example-keep-a-draft', kind: 'job' }] },
		});

		const validated = await client.callTool({
			name: 'specimen-validate',
			arguments: { id: 'example-keep-a-draft' },
		});
		expect(validated.isError).toBe(false);
		expect(envelope(validated as CallToolResult)).toMatchObject({
			success: true,
			data: { valid: true, checked: 1, issues: [] },
		});

		const needsRun = await client.callTool({
			name: 'specimen-render',
			arguments: { id: 'example-keep-a-draft' },
		});
		expect(needsRun.isError).toBe(true);
		expect(envelope(needsRun as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'JOB_NEEDS_RUN',
				suggestion: expect.stringContaining('specimen-job-run'),
			},
		});
	});

	it('exposes jobs@1 specimen-coverage schema and evaluates set-backed jobs@1 coverage with waivers and CAPTURE_SET_NOT_FOUND over MCP', async () => {
		await writeFile(
			join(root, 'custom-elements.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'src/components.ts',
						declarations: [
							{
								tagName: 'example-notice',
								members: [
									{
										kind: 'field',
										name: 'variant',
										attribute: 'variant',
										type: { text: "'warning' | 'error'" },
									},
								],
							},
							{
								tagName: 'example-chip',
								members: [
									{
										kind: 'field',
										name: 'size',
										attribute: 'size',
										type: { text: "'small' | 'medium'" },
									},
								],
							},
						],
					},
				],
			}),
			'utf8'
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				manifest: './custom-elements.json',
				specimens: [{ id: 'cheap', title: 'Test/Cheap', module: './case.ts', exportName: 'Cheap' }],
				coverage: {
					waivers: {
						version: '2026-11-23',
						entries: [
							{
								component: 'example-chip',
								obligation: 'unreached:size=small',
								reason: 'Small chips appear only in a settings dialog no job opens.',
							},
						],
					},
				},
			}),
			'utf8'
		);
		await writeCaptureSet(root, {
			kind: 'job',
			context: {
				viewport: { width: 1280, height: 720 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
			},
			checkpoint: {
				name: 'conflict-notice',
				actionMode: 'real-input',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '130.0.0.0' },
			axe: false,
			revision: 'abc1234',
			dirty: false,
			label: 'main',
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'example-keep-a-draft/4',
					id: 'example-keep-a-draft',
					status: 'captured',
					checkpoint: 'conflict-notice',
					step: 4,
					job: 'keep-a-draft',
					observation: {
						manifest: {
							captureVersion: CAPTURE_VERSION,
							normalizationVersion: NORMALIZATION_VERSION,
							specimenId: 'example-keep-a-draft',
							capturedUtc: '2026-11-23T00:00:00.000Z',
							bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
							driver: { name: 'host', emulates: ['viewport'] },
							checkpoint: {
								name: 'conflict-notice',
								actionMode: 'real-input',
								ready: { steps: [], outcome: 'ready', deadlineMs: 10_000 },
								baseline: {
									clock: 'real',
									random: { source: 'seeded', seed: 1 },
									storage: 'empty',
								},
							},
							source: { revision: 'abc1234', digest: 'deadbeef', dirty: false },
							dependencies: 'lock',
							browser: {
								name: 'chromium',
								version: '130.0.0.0',
								platform: 'linux-x64',
								build: null,
							},
							job: { name: 'keep-a-draft', step: 4, description: 'Another writer saves the note' },
							context: {
								viewport: { width: 1280, height: 720 },
								theme: 'light',
								locale: 'en-US',
								reducedMotion: 'no-preference',
								motion: 'natural',
								pixelRatio: 1,
								observed: {
									width: 1280,
									height: 720,
									media: true,
									colorScheme: 'light',
									contrast: 'no-preference',
									reducedMotion: 'no-preference',
									language: 'en-US',
									devicePixelRatio: 1,
								},
								resources: { fonts: [], remote: [] },
							},
						},
						channels: {
							dom: { raw: '<div></div>', normalized: '<div></div>' },
							a11y: { snapshot: '', axe: 'not-run' },
							events: { declared: [], history: [] },
							evidence: {
								expectations: [],
								claims: [],
								commands: [],
								formData: [],
								validity: [],
								attributesSet: [],
							},
							elements: [
								{
									ref: 'root/example-notice:1',
									tag: 'example-notice',
									attributes: { variant: 'warning' },
									box: { x: 0, y: 0, width: 100, height: 24 },
									scroll: { width: 100, height: 24, clientWidth: 100, clientHeight: 24 },
									styles: {},
									state: {},
								},
								{
									ref: 'root/example-chip:1',
									tag: 'example-chip',
									attributes: { size: 'medium' },
									box: { x: 0, y: 0, width: 60, height: 20 },
									scroll: { width: 60, height: 20, clientWidth: 60, clientHeight: 20 },
									styles: {},
									state: {},
								},
							],
							console: { errors: [], warnings: [] },
							visual: { path: null },
						},
						completeness: {
							dom: { status: 'complete', scope: 'dom', reasons: [] },
							a11y: { status: 'partial', scope: 'a11y', reasons: ['AXE_NOT_RUN'] },
							layout: { status: 'complete', scope: 'layout', reasons: [] },
							styles: { status: 'complete', scope: 'styles', reasons: [] },
							tokens: { status: 'unsupported', scope: 'tokens', reasons: [] },
							events: { status: 'not-requested', scope: 'events', reasons: [] },
							visual: { status: 'not-requested', scope: 'visual', reasons: [] },
						},
					},
				},
			],
		});

		const client = await connect();
		const { tools } = await client.listTools();
		const coverageTool = tools.find((tool) => tool.name === 'specimen-coverage');
		expect(coverageTool?.annotations).toEqual({ readOnlyHint: true });
		expect(coverageTool?.inputSchema).toMatchObject({
			properties: {
				obligations: { enum: ['schema-partitions@1', 'jobs@1'] },
				captures: { type: 'string' },
			},
		});

		const noticeRes = await client.callTool({
			name: 'specimen-coverage',
			arguments: { component: 'example-notice', obligations: 'jobs@1', captures: 'main' },
		});
		expect(noticeRes.isError).toBe(false);
		expect(envelope(noticeRes as CallToolResult)).toMatchObject({
			success: true,
			data: {
				obligations: 'jobs@1',
				components: [
					{
						tag: 'example-notice',
						jobs: {
							reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
							unreached: ['variant=error'],
						},
					},
				],
			},
		});

		const chipRes = await client.callTool({
			name: 'specimen-coverage',
			arguments: { component: 'example-chip', obligations: 'jobs@1', captures: 'main' },
		});
		expect(chipRes.isError).toBe(false);
		expect(envelope(chipRes as CallToolResult)).toMatchObject({
			success: true,
			data: {
				waived: 1,
				complete: true,
				components: [{ tag: 'example-chip', jobs: { unreached: [] } }],
			},
		});

		const missingSet = await client.callTool({
			name: 'specimen-coverage',
			arguments: { obligations: 'jobs@1', captures: 'no-such-set' },
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
