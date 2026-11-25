import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
import { type CallToolResult, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
	type ElicitAnswer = 'accept' | 'decline' | 'cancel' | 'unchecked' | 'error';

	async function connect(options?: {
		elicitation?: ElicitAnswer;
		elicitationMode?: 'form' | 'url-only' | 'legacy-empty';
		prompts?: string[];
	}) {
		const server = await createSpecimenMcpServer({ root });
		servers.push(server);
		const elicitationCapability =
			options?.elicitationMode === 'url-only'
				? { url: {} }
				: options?.elicitationMode === 'legacy-empty'
					? {}
					: options?.elicitation
						? { form: {} }
						: undefined;
		const client = new Client(
			{ name: 'specimen-test', version: '1.0.0' },
			elicitationCapability ? { capabilities: { elicitation: elicitationCapability } } : undefined
		);
		if (options?.elicitation) {
			const answer = options.elicitation;
			client.setRequestHandler(ElicitRequestSchema, async (request) => {
				options.prompts?.push(request.params.message);
				if (answer === 'error') throw new Error('Client elicitation transport failure');
				if (answer === 'accept') return { action: 'accept' as const, content: { confirm: true } };
				if (answer === 'unchecked')
					return { action: 'accept' as const, content: { confirm: false } };
				return { action: answer };
			});
		}
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
			expect(tools).toHaveLength(36);
			expect(tools).toEqual(
				definitions.map((command) => ({
					name: command.name,
					description: command.description,
					inputSchema: command.jsonSchema,
					annotations: commandToolAnnotations(command),
				}))
			);
			expect(tools.find((tool) => tool.name === 'decision-record')?.annotations).toEqual({
				readOnlyHint: false,
				destructiveHint: false,
			});
			expect(tools.find((tool) => tool.name === 'decision-get')?.annotations).toEqual({
				readOnlyHint: true,
			});
			expect(tools.find((tool) => tool.name === 'decision-list')?.annotations).toEqual({
				readOnlyHint: true,
			});
			expect(tools.find((tool) => tool.name === 'decision-check')?.annotations).toEqual({
				readOnlyHint: true,
			});
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

	it('exposes decision-record, decision-get, decision-list, and decision-check end-to-end over MCP', async () => {
		const mkObs = (id: string) => ({
			manifest: {
				captureVersion: CAPTURE_VERSION,
				normalizationVersion: NORMALIZATION_VERSION,
				specimenId: id,
				capturedUtc: '2026-11-24T00:00:00.000Z',
				bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
				driver: { name: 'host' as const, emulates: [] },
				checkpoint: {
					name: 'mount',
					actionMode: 'none' as const,
					ready: { steps: ['frame'], outcome: 'ready' as const, deadlineMs: 1000 },
					baseline: {
						clock: 'real' as const,
						random: { source: 'seeded' as const, seed: 1 },
						storage: 'empty' as const,
					},
				},
				source: { revision: 'a1b2c3d', digest: 'd', dirty: false },
				dependencies: 'lock',
				browser: { name: 'chromium', version: '130', platform: 'linux-x64', build: null },
				context: {
					viewport: { width: 1280, height: 800 },
					theme: 'light' as const,
					locale: 'en-US',
					reducedMotion: 'no-preference' as const,
					motion: 'natural' as const,
					pixelRatio: 1,
					observed: {
						width: 1280,
						height: 800,
						media: false,
						colorScheme: 'light' as const,
						contrast: 'no-preference' as const,
						reducedMotion: 'no-preference' as const,
						language: 'en-US',
						devicePixelRatio: 1,
					},
					resources: { fonts: [], remote: [] },
				},
			},
			channels: {
				dom: { raw: `<div data-id="${id}"></div>`, normalized: `<div data-id="${id}"></div>` },
				a11y: {
					snapshot: `- region "${id}"`,
					axe: {
						status: 'passed' as const,
						policy: 'error' as const,
						violations: [],
						incomplete: 0,
						incompleteChecks: [],
						exceptions: [],
					},
				},
				events: { declared: [], history: [] },
				evidence: {
					expectations: [],
					claims: [],
					commands: [],
					formData: [],
					validity: [],
					attributesSet: [],
				},
				elements: [],
				console: { errors: [], warnings: [] },
				visual: { path: null },
			},
			completeness: {
				dom: { status: 'complete' as const, scope: 'dom', reasons: [] },
				a11y: { status: 'complete' as const, scope: 'a11y', reasons: [] },
				layout: { status: 'complete' as const, scope: 'layout', reasons: [] },
				styles: { status: 'complete' as const, scope: 'styles', reasons: [] },
				tokens: { status: 'unsupported' as const, scope: 'tokens', reasons: [] },
				events: { status: 'not-requested' as const, scope: 'events', reasons: [] },
				visual: { status: 'not-requested' as const, scope: 'visual', reasons: [] },
			},
		});

		const written = await writeCaptureSet(root, {
			kind: 'compare',
			order: ['toolbar--dense', 'toolbar--airy'],
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
			},
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: mkObs('toolbar--dense'),
				},
				{
					key: 'toolbar--airy',
					id: 'toolbar--airy',
					status: 'captured',
					observation: mkObs('toolbar--airy'),
				},
			],
		});

		const prompts: string[] = [];
		const client = await connect({ elicitation: 'accept', prompts });

		// Initially listed as undecided.
		const beforeList = await client.callTool({ name: 'decision-list', arguments: {} });
		expect(beforeList.isError).toBe(false);
		expect(envelope(beforeList as CallToolResult)).toMatchObject({
			success: true,
			data: {
				decisions: [],
				undecided: [{ set: written.run.set }],
			},
		});

		// Record choice over MCP with accepted human elicitation.
		const recorded = await client.callTool({
			name: 'decision-record',
			arguments: {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: written.run.set,
				chosen: 'toolbar--dense',
				reason: 'Fits twelve commands without wrapping.',
				subjects: { files: ['case.ts'], tokens: ['space.toolbar.gap'] },
			},
		});
		expect(recorded.isError).toBe(false);
		expect(prompts).toHaveLength(1);
		expect(prompts[0]).toContain('toolbar-density');
		expect(prompts[0]).toContain('toolbar--dense');
		const recordedEnv = envelope(recorded as CallToolResult);
		expect(recordedEnv).toMatchObject({
			success: true,
			data: {
				decision: expect.stringMatching(/^dec-[0-9a-hjkmnp-tv-z]{12}$/),
				kind: 'choice',
				chosen: 'toolbar--dense',
				kept: ['toolbar--airy'],
			},
		});
		const decisionId = recordedEnv.data.decision as string;

		// Read back with decision-get: accepted MCP elicitation records decidedBy.kind === 'person'.
		const fetched = await client.callTool({
			name: 'decision-get',
			arguments: { decision: decisionId },
		});
		expect(fetched.isError).toBe(false);
		expect(envelope(fetched as CallToolResult)).toMatchObject({
			success: true,
			data: {
				decision: decisionId,
				chosen: 'toolbar--dense',
				evidence: { set: written.run.set },
				decidedBy: { kind: 'person' },
			},
		});

		// Check with decision-check.
		const checked = await client.callTool({
			name: 'decision-check',
			arguments: { files: ['case.ts'], tokens: ['space.toolbar.gap'] },
		});
		expect(checked.isError).toBe(false);
		expect(envelope(checked as CallToolResult)).toMatchObject({
			success: true,
			data: {
				decisions: [
					{
						decision: decisionId,
						matched: { files: ['case.ts'], tokens: ['space.toolbar.gap'] },
					},
				],
			},
		});

		// List now shows the decision with no stale globs and no undecided sets.
		const afterList = await client.callTool({ name: 'decision-list', arguments: {} });
		expect(afterList.isError).toBe(false);
		expect(envelope(afterList as CallToolResult)).toMatchObject({
			success: true,
			data: {
				decisions: [{ decision: decisionId, chosen: 'toolbar--dense', stale: [] }],
				undecided: [],
			},
		});

		// Missing decision returns DECISION_NOT_FOUND pointing to decision-list.
		const missing = await client.callTool({
			name: 'decision-get',
			arguments: { decision: 'dec-q7k2m4xab3nb' },
		});
		expect(missing.isError).toBe(true);
		expect(envelope(missing as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'DECISION_NOT_FOUND',
				suggestion: expect.stringContaining('decision-list'),
			},
		});
	});

	it('enforces confirmations: require-human on confirmPrompt commands over MCP while CLI records script (#2213)', async () => {
		const channel = { status: 'complete' as const, scope: 'declared targets', reasons: [] };
		const context = {
			viewport: { width: 1280, height: 800 },
			theme: 'light' as const,
			locale: 'en-US',
			reducedMotion: 'no-preference' as const,
			motion: 'natural' as const,
		};
		const mkObs = (id: string) => ({
			manifest: {
				captureVersion: CAPTURE_VERSION,
				normalizationVersion: NORMALIZATION_VERSION,
				specimenId: id,
				capturedUtc: '2026-11-24T00:00:00.000Z',
				bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
				driver: { name: 'host' as const, emulates: [] },
				checkpoint: {
					name: 'mount',
					actionMode: 'none' as const,
					ready: {
						steps: ['upgrade', 'fonts', 'frame'],
						outcome: 'ready' as const,
						deadlineMs: 10_000,
					},
					baseline: {
						clock: 'real' as const,
						random: { source: 'seeded' as const, seed: 1 },
						storage: 'empty' as const,
					},
				},
				source: { revision: 'a1b2c3d', digest: 'source', dirty: false },
				dependencies: 'lock',
				browser: { name: 'chromium', version: '130', platform: 'linux-x64', build: null },
				context: {
					...context,
					pixelRatio: 1,
					observed: {
						width: 1280,
						height: 800,
						media: false,
						colorScheme: 'light' as const,
						contrast: 'no-preference' as const,
						reducedMotion: 'no-preference' as const,
						language: 'en-US',
						devicePixelRatio: 1,
					},
					resources: { fonts: [], remote: [] },
				},
			},
			channels: {
				dom: { raw: `<div>${id}</div>`, normalized: `<div>${id}</div>` },
				a11y: {
					snapshot: `- region "${id}"`,
					axe: {
						status: 'passed' as const,
						policy: 'error' as const,
						violations: [],
						incomplete: 0,
						incompleteChecks: [],
						exceptions: [],
					},
				},
				events: { declared: [], history: [] },
				evidence: {
					expectations: [],
					claims: [],
					commands: [],
					formData: [],
					validity: [],
					attributesSet: [],
				},
				elements: [],
				console: { errors: [], warnings: [] },
				visual: { path: null },
			},
			completeness: {
				dom: channel,
				a11y: channel,
				layout: channel,
				styles: channel,
				tokens: { ...channel, status: 'unsupported' as const },
				events: { ...channel, status: 'unsupported' as const },
				visual: { ...channel, status: 'not-requested' as const },
			},
		});

		const written = await writeCaptureSet(root, {
			kind: 'compare',
			context,
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: mkObs('toolbar--dense'),
				},
				{
					key: 'toolbar--airy',
					id: 'toolbar--airy',
					status: 'captured',
					observation: mkObs('toolbar--airy'),
				},
			],
		});

		const recordArgs = {
			slug: 'toolbar-density',
			question: 'How dense should the toolbar be?',
			set: written.run.set,
			chosen: 'toolbar--dense',
			reason: 'Fits twelve commands without wrapping.',
		};

		// Reject invalid confirmations option at server creation.
		await expect(
			createSpecimenMcpServer({ root, confirmations: 'off' as 'require-human' })
		).rejects.toThrow(/require-human/);

		// 1. Agent client WITHOUT elicitation capability is refused with CONFIRMATION_REQUIRED,
		// even when sending confirm: true or _meta["dev.afd/confirm"].
		const unelicited = await connect();
		for (const call of [
			{ name: 'decision-record', arguments: recordArgs },
			{ name: 'decision-record', arguments: { ...recordArgs, confirm: true } },
			{
				name: 'decision-record',
				arguments: recordArgs,
				_meta: { 'dev.afd/confirm': true },
			},
		]) {
			const refused = await unelicited.callTool(call);
			expect(refused.isError).toBe(true);
			expect(envelope(refused as CallToolResult)).toMatchObject({
				success: false,
				error: {
					code: 'CONFIRMATION_REQUIRED',
					retryable: false,
					suggestion: expect.stringContaining('elicitation'),
					details: { commands: ['decision-record'] },
				},
			});
		}

		// 2. Eliciting client where user declines, cancels, or leaves confirm unchecked -> CONFIRMATION_DECLINED.
		for (const answer of ['decline', 'cancel', 'unchecked'] as const) {
			const prompts: string[] = [];
			const decliningClient = await connect({ elicitation: answer, prompts });
			const declined = await decliningClient.callTool({
				name: 'decision-record',
				arguments: recordArgs,
			});
			expect(declined.isError).toBe(true);
			expect(prompts).toHaveLength(1);
			expect(envelope(declined as CallToolResult)).toMatchObject({
				success: false,
				error: {
					code: 'CONFIRMATION_DECLINED',
					retryable: false,
					details: { commands: ['decision-record'] },
				},
			});
		}

		// 3. Elicitation transport failure fails closed with CONFIRMATION_REQUIRED.
		const failingElicitClient = await connect({ elicitation: 'error' });
		const failedElicit = await failingElicitClient.callTool({
			name: 'decision-record',
			arguments: recordArgs,
		});
		expect(failedElicit.isError).toBe(true);
		expect(envelope(failedElicit as CallToolResult)).toMatchObject({
			success: false,
			error: {
				code: 'CONFIRMATION_REQUIRED',
				retryable: false,
			},
		});

		// 4. Malformed input fails VALIDATION_ERROR without prompting the human.
		const validationPrompts: string[] = [];
		const validatingClient = await connect({ elicitation: 'accept', prompts: validationPrompts });
		const invalid = await validatingClient.callTool({
			name: 'decision-record',
			arguments: { chosen: 'toolbar--dense', reason: 'missing set/supersedes/items' },
		});
		expect(invalid.isError).toBe(true);
		expect(validationPrompts).toEqual([]);
		expect(envelope(invalid as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR' },
		});

		// 4b. URL-only elicitation capability cannot satisfy form confirmation.
		const urlOnlyClient = await connect({ elicitationMode: 'url-only' });
		const urlOnlyResult = await urlOnlyClient.callTool({
			name: 'decision-record',
			arguments: recordArgs,
		});
		expect(urlOnlyResult.isError).toBe(true);
		expect(envelope(urlOnlyResult as CallToolResult)).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED', retryable: false },
		});

		// None of the refused / declined / invalid calls wrote any decision file.
		await expect(readdir(join(root, 'specimens', 'decisions'))).rejects.toMatchObject({
			code: 'ENOENT',
		});

		// 5. Accepted human elicitation succeeds and records decidedBy: { kind: 'person' }.
		// Also verify sanitization (control chars, BiDi overrides, code-point truncation) and Reason display.
		const acceptedPrompts: string[] = [];
		const acceptingClient = await connect({
			elicitation: 'accept',
			elicitationMode: 'legacy-empty',
			prompts: acceptedPrompts,
		});
		const longReason = `Fits twelve commands\n\u202Ewithout wrapping ${'✨'.repeat(120)}`;
		const accepted = await acceptingClient.callTool({
			name: 'decision-record',
			arguments: { ...recordArgs, reason: longReason },
		});
		expect(accepted.isError).toBe(false);
		expect(acceptedPrompts).toHaveLength(1);
		expect(acceptedPrompts[0]).toContain('Decision: toolbar-density');
		expect(acceptedPrompts[0]).toContain('Chosen: toolbar--dense');
		expect(acceptedPrompts[0]).toContain('Reason: Fits twelve commands without wrapping');
		expect(acceptedPrompts[0]).not.toContain('\u202E');
		expect(acceptedPrompts[0]).toContain('…');
		const mcpDecisionId = envelope(accepted as CallToolResult).data.decision as string;
		const mcpFetched = await acceptingClient.callTool({
			name: 'decision-get',
			arguments: { decision: mcpDecisionId },
		});
		expect(envelope(mcpFetched as CallToolResult).data).toMatchObject({
			decision: mcpDecisionId,
			decidedBy: { kind: 'person' },
		});

		// 5b. Supersedes (array) and review-items prompt formatting both surface in elicitation.
		const followUpPrompts: string[] = [];
		const followUpClient = await connect({ elicitation: 'accept', prompts: followUpPrompts });
		const superseded = await followUpClient.callTool({
			name: 'decision-record',
			arguments: {
				supersedes: [mcpDecisionId],
				chosen: 'toolbar--airy',
				reason: 'Switch to airy toolbar.',
			},
		});
		expect(superseded.isError).toBe(false);
		expect(followUpPrompts[0]).toContain(`Supersedes: ${mcpDecisionId}`);
		expect(followUpPrompts[0]).toContain('Chosen: toolbar--airy');
		expect(followUpPrompts[0]).toContain('Reason: Switch to airy toolbar.');

		const reviewItemCall = await followUpClient.callTool({
			name: 'decision-record',
			arguments: {
				items: [`changed:deadbeef0000:deadbeef0000:${written.run.set}..${written.run.set}`],
				chosen: 'accept',
				reason: 'Review answer prompt check.',
			},
		});
		expect(reviewItemCall.isError).toBe(true);
		expect(followUpPrompts[1]).toContain('Items: 1');
		expect(envelope(reviewItemCall as CallToolResult).error?.code).toBe('REVIEW_ITEM_NOT_FOUND');

		// 6. CLI boundary: specimen decision-record via CLI records decidedBy: { kind: 'script' }.
		let cliOut = '';
		expect(
			await runCli(
				[
					'--root',
					root,
					'decision-record',
					'--slug',
					'toolbar-density-cli',
					'--question',
					'How dense via CLI?',
					'--set',
					written.run.set,
					'--chosen',
					'toolbar--airy',
					'--reason',
					'Recorded from terminal script.',
				],
				{
					stdout: (text) => {
						cliOut += text;
					},
				}
			)
		).toBe(0);
		const cliDecisionId = JSON.parse(cliOut).data.decision as string;
		const cliFetched = await acceptingClient.callTool({
			name: 'decision-get',
			arguments: { decision: cliDecisionId },
		});
		expect(envelope(cliFetched as CallToolResult).data).toMatchObject({
			decision: cliDecisionId,
			decidedBy: { kind: 'script' },
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
