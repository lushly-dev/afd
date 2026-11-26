import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { CommandError } from '@lushly-dev/afd-core';
import type {
	HumanRelay,
	RelayBeginResult,
	RelayCall,
	RelayOutcome,
	RelayPrompt,
	ToolStrategy,
} from '@lushly-dev/afd-server';
import { writeCaptureSet, writeCardRecord } from '@lushly-dev/specimen';
import {
	CAPTURE_VERSION,
	NORMALIZATION_VERSION,
	type Observation,
} from '@lushly-dev/specimen/types';
import { runCli } from '@lushly-dev/specimen-cli';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createSpecimenMcpHandler,
	createSpecimenMcpServer,
	type SpecimenMcpHandler,
} from './server.js';

const exec = promisify(execFile);
const binary = new URL('../dist/bin.js', import.meta.url);
const MODERN = '2026-07-28';
const PERSON_URL = 'https://person.example.com/decide/specimen-1';

function envelope(result: CallToolResult) {
	const content = result.content[0];
	if (content?.type !== 'text') throw new Error('Expected a JSON text result');
	return JSON.parse(content.text);
}

class FakeHumanRelay implements HumanRelay {
	begins = 0;
	resumes = 0;
	calls: RelayCall[] = [];
	states: string[] = [];
	outcomes: RelayOutcome[] = [];
	refusal?: CommandError;
	prompt?: RelayPrompt;
	confirmedBy?: string;

	answer(outcome: RelayOutcome): void {
		this.outcomes.push(outcome);
	}

	async begin(call: RelayCall): Promise<RelayBeginResult> {
		this.begins += 1;
		this.calls.push(call);
		if (this.refusal) return { ok: false, error: this.refusal };
		return {
			ok: true,
			prompt: this.prompt ?? {
				url: `${PERSON_URL}-${this.begins}`,
				message: `Open the link to confirm ${call.command}`,
				state: `relay-state-${this.begins}`,
			},
		};
	}

	async resume(state: string, call: RelayCall): Promise<RelayOutcome> {
		this.resumes += 1;
		this.calls.push(call);
		this.states.push(state);
		return this.outcomes.shift() ?? { kind: 'invalid' };
	}

	async approvedContext(): Promise<Record<string, unknown>> {
		return this.confirmedBy ? { 'dev.afd.specimen/confirmedBy': this.confirmedBy } : {};
	}
}

function urlCaps() {
	return { elicitation: { url: {} } };
}

function makeMcpCall(
	name: string,
	args: Record<string, unknown>,
	capabilities: Record<string, unknown> = urlCaps(),
	extra: Record<string, unknown> = {}
) {
	const { _meta: extraMeta, ...restExtra } = extra;
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: {
			name,
			arguments: args,
			_meta: {
				'io.modelcontextprotocol/protocolVersion': MODERN,
				'io.modelcontextprotocol/clientCapabilities': capabilities,
				...(extraMeta as Record<string, unknown> | undefined),
			},
			...restExtra,
		},
	};
}

async function postMcp(
	url: string,
	body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
	const name = (body.params as { name?: string } | undefined)?.name;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': MODERN,
			'mcp-method': String(body.method ?? 'tools/call'),
			...(name ? { 'mcp-name': name } : {}),
		},
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch {
		const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
		parsed = JSON.parse(dataLine ? dataLine.slice(6) : '{}') as Record<string, unknown>;
	}
	return { status: res.status, json: parsed };
}

function mcpResult(response: Record<string, unknown>): Record<string, unknown> {
	const result = response.result as {
		content?: Array<{ text: string }>;
		structuredContent?: unknown;
	};
	if (result.structuredContent && typeof result.structuredContent === 'object') {
		return result.structuredContent as Record<string, unknown>;
	}
	return JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

function makeCompareObservation(id: string): Observation {
	const channel = { status: 'complete' as const, scope: 'declared targets', reasons: [] };
	return {
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
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' as const },
			events: { ...channel, status: 'not-requested' as const },
			visual: { ...channel, status: 'not-requested' as const },
		},
	};
}

describe('Specimen MCP endpoint (@lushly-dev/afd-server)', () => {
	let root: string;
	const cleanups: Array<() => Promise<void>> = [];

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
		await Promise.all(cleanups.splice(0).map((fn) => fn()));
		await rm(root, { recursive: true, force: true });
	});

	async function mountHandler(options?: {
		humanRelay?: HumanRelay;
		toolStrategy?: ToolStrategy;
		firstClassTools?: string[];
		dir?: string;
	}): Promise<{ url: string; handler: SpecimenMcpHandler }> {
		const handler = await createSpecimenMcpHandler({
			root: options?.dir ?? root,
			host: '127.0.0.1',
			serverOptions: { instances: 'single' },
			...(options?.humanRelay ? { humanRelay: options.humanRelay } : {}),
			...(options?.toolStrategy ? { toolStrategy: options.toolStrategy } : {}),
			...(options?.firstClassTools ? { firstClassTools: options.firstClassTools } : {}),
		});
		const httpServer = createServer(handler);
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			await handler.close();
			httpServer.closeAllConnections();
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		});
		const port = (httpServer.address() as AddressInfo).port;
		return { url: `http://127.0.0.1:${port}/mcp`, handler };
	}

	async function listTools(url: string) {
		const { json } = await postMcp(url, {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/list',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MODERN,
					'io.modelcontextprotocol/clientCapabilities': urlCaps(),
				},
			},
		});
		if (!json.result) throw new Error(`tools/list failed: ${JSON.stringify(json)}`);
		return (
			json.result as {
				tools: Array<{
					name: string;
					description?: string;
					annotations?: Record<string, unknown>;
					_meta?: Record<string, unknown>;
				}>;
			}
		).tools;
	}

	async function callTool(
		url: string,
		name: string,
		args: Record<string, unknown>,
		capabilities: Record<string, unknown> = urlCaps(),
		extra: Record<string, unknown> = {}
	) {
		const { json } = await postMcp(url, makeMcpCall(name, args, capabilities, extra));
		return json;
	}

	async function callViaAfd(url: string, command: string, input: Record<string, unknown>) {
		return callTool(url, 'afd-call', { command, input });
	}

	it('uses hybrid tool strategy by default (5 meta-tools + 8 first-class Specimen tools) and supports grouped/individual strategies', async () => {
		const { url: hybridUrl } = await mountHandler();
		const hybridTools = await listTools(hybridUrl);
		const hybridNames = hybridTools.map((t) => t.name);
		expect(hybridNames).toEqual([
			'afd-discover',
			'afd-detail',
			'afd-call',
			'afd-batch',
			'afd-pipe',
			'design-states',
			'design-card-list',
			'decision-record',
			'specimen-review',
			'specimen-validate',
			'panel-walk',
			'design-release',
			'specimen-list',
		]);
		expect(
			hybridTools.find((t) => t.name === 'design-states')?._meta?.['dev.afd/outputBudget']
		).toEqual({
			defaultBytes: 32768,
			maxBytes: 98304,
		});
		expect(
			hybridTools.find((t) => t.name === 'panel-walk')?._meta?.['dev.afd/outputBudget']
		).toEqual({
			defaultBytes: 24576,
			maxBytes: 65536,
		});
		expect(
			hybridTools.find((t) => t.name === 'design-card-list')?._meta?.['dev.afd/outputBudget']
		).toEqual({
			defaultBytes: 32768,
			maxBytes: 98304,
		});
		expect(
			hybridTools.find((t) => t.name === 'design-release')?._meta?.['dev.afd/outputBudget']
		).toEqual({
			defaultBytes: 16384,
			maxBytes: 49152,
		});
		expect(hybridTools.find((t) => t.name === 'decision-record')?._meta?.confirmationMode).toBe(
			'host-verified'
		);
		expect(hybridTools.find((t) => t.name === 'design-release')?._meta?.confirmationMode).toBe(
			'host-verified'
		);

		// afd-discover reaches all 41 Specimen commands cleanly.
		const discovered = mcpResult(await callTool(hybridUrl, 'afd-discover', { limit: 100 }));
		expect(discovered.success).toBe(true);
		expect((discovered.data as { total: number }).total).toBe(41);

		// Grouped strategy exposes category groups (`specimen`, `decision`, `design`) + meta-tools.
		const { url: groupedUrl } = await mountHandler({ toolStrategy: 'grouped' });
		const groupedNames = (await listTools(groupedUrl)).map((t) => t.name);
		expect(groupedNames).toContain('specimen');
		expect(groupedNames).toContain('decision');
		expect(groupedNames).toContain('design');
		expect(groupedNames).toContain('afd-call');

		// Individual strategy exposes all 41 Specimen commands with annotations and schemas.
		const { url: individualUrl } = await mountHandler({ toolStrategy: 'individual' });
		const individualTools = await listTools(individualUrl);
		const individualSpecimen = individualTools.filter((t) => !t.name.startsWith('afd-'));
		expect(individualSpecimen).toHaveLength(41);
		expect(individualTools.find((t) => t.name === 'design-states')?.annotations).toMatchObject({
			readOnlyHint: true,
		});
		expect(individualTools.find((t) => t.name === 'panel-walk')?.annotations).toMatchObject({
			readOnlyHint: false,
		});
		expect(individualTools.find((t) => t.name === 'specimen-review')?.annotations).toMatchObject({
			readOnlyHint: true,
		});
		expect(individualTools.find((t) => t.name === 'decision-get')?.annotations).toMatchObject({
			readOnlyHint: true,
		});
		expect(individualTools.find((t) => t.name === 'decision-record')?.annotations).toMatchObject({
			readOnlyHint: false,
		});
		expect(individualTools.find((t) => t.name === 'design-card-list')?.annotations).toMatchObject({
			readOnlyHint: true,
		});
		expect(individualTools.find((t) => t.name === 'design-release')?.annotations).toMatchObject({
			readOnlyHint: false,
		});

		// Lazy strategy exposes only the 5 AFD meta-tools while keeping all 41 commands discoverable.
		const { url: lazyUrl } = await mountHandler({ toolStrategy: 'lazy' });
		const lazyNames = (await listTools(lazyUrl)).map((t) => t.name);
		expect(lazyNames).toEqual(['afd-discover', 'afd-detail', 'afd-call', 'afd-batch', 'afd-pipe']);
		const lazyDiscovered = mcpResult(await callTool(lazyUrl, 'afd-discover', { limit: 100 }));
		expect((lazyDiscovered.data as { total: number }).total).toBe(41);
	});

	it('preserves CLI envelopes, structured errors, and job-create + jobs@1 coverage over MCP', async () => {
		await writeFile(
			join(root, 'job-source.mjs'),
			`export default {
	id: 'json-source',
	async parseScenario(ctx) { return JSON.parse(await ctx.read(ctx.scenarioPath)); },
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
		await writeFile(join(root, 'dummy-plugin.mjs'), `export default { id: 'dummy-runner' };\n`);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				plugins: ['./dummy-plugin.mjs'],
				jobSources: ['./job-source.mjs'],
				specimens: [{ id: 'cheap', title: 'Test/Cheap', module: './case.ts', exportName: 'Cheap' }],
			})
		);

		const { url } = await mountHandler();

		let cliOutput = '';
		expect(
			await runCli(['--root', root, 'list'], {
				stdout: (text) => {
					cliOutput += text;
				},
			})
		).toBe(0);
		const listed = mcpResult(await callTool(url, 'specimen-list', {}));
		expect(listed.success).toBe(true);
		expect(listed.data).toEqual(JSON.parse(cliOutput).data);

		const invalid = mcpResult(await callTool(url, 'specimen-list', { unexpected: true }));
		expect(invalid).toMatchObject({
			success: false,
			error: { code: 'VALIDATION_ERROR' },
		});

		const created = mcpResult(
			await callViaAfd(url, 'specimen-job-create', {
				id: 'example-keep-a-draft',
				scenario: './keep-a-draft.scenario.json',
				module: './case.ts',
				exportName: 'Cheap',
				target: 'app',
				captures: [2],
			})
		);
		expect(created).toMatchObject({
			success: true,
			data: { written: 'specimen.config.json', entry: { id: 'example-keep-a-draft', kind: 'job' } },
		});

		const needsRun = mcpResult(
			await callViaAfd(url, 'specimen-render', { id: 'example-keep-a-draft' })
		);
		expect(needsRun).toMatchObject({
			success: false,
			error: { code: 'JOB_NEEDS_RUN' },
		});

		// jobs@1 coverage over MCP fails cleanly with CAPTURE_SET_NOT_FOUND for an unknown set, and evaluates set-backed jobs@1 coverage with waivers when configured.
		const missingSet = mcpResult(
			await callViaAfd(url, 'specimen-coverage', {
				obligations: 'jobs@1',
				captures: 'no-such-set',
			})
		);
		expect(missingSet).toMatchObject({
			success: false,
			error: {
				code: 'CAPTURE_SET_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-capture'),
			},
		});

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
										type: { text: "'info' | 'error'" },
									},
								],
							},
						],
					},
				],
			})
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				manifest: './custom-elements.json',
				coverage: {
					waivers: {
						version: '2026-11-23',
						entries: [
							{
								component: 'example-notice',
								obligation: 'unreached:variant=error',
								reason: 'Waived for MCP jobs@1 test.',
							},
						],
					},
				},
				specimens: [{ id: 'cheap', title: 'Test/Cheap', module: './case.ts', exportName: 'Cheap' }],
			})
		);
		const obs = makeCompareObservation('example-keep-a-draft/2');
		obs.manifest.job = {
			name: 'keep-a-draft',
			step: 2,
			description: 'conflict-notice',
		};
		obs.channels.elements = [
			{
				ref: 'root/example-notice:1',
				tag: 'example-notice',
				attributes: { variant: 'info' },
				box: { x: 0, y: 0, width: 100, height: 24 },
				scroll: { width: 100, height: 24, clientWidth: 100, clientHeight: 24 },
				styles: {},
				state: {},
			},
		];
		await writeCaptureSet(root, {
			kind: 'job',
			label: 'main',
			order: ['example-keep-a-draft/2'],
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
					key: 'example-keep-a-draft/2',
					id: 'example-keep-a-draft',
					job: 'keep-a-draft',
					status: 'captured',
					observation: obs,
				},
			],
		});
		const { url: covUrl } = await mountHandler();
		const jobsCoverage = mcpResult(
			await callViaAfd(covUrl, 'specimen-coverage', {
				component: 'example-notice',
				obligations: 'jobs@1',
				captures: 'main',
			})
		);
		expect(jobsCoverage).toMatchObject({
			success: true,
			data: {
				obligations: 'jobs@1',
				waived: 1,
				complete: true,
				components: [
					{
						tag: 'example-notice',
						jobs: {
							reachedBy: [{ key: 'example-keep-a-draft/2', name: 'mount', step: 2 }],
							unreached: [],
						},
					},
				],
			},
		});

		// Unknown or unexposed tool names are rejected cleanly.
		const unknown = await callTool(url, 'specimen-nonexistent', {});
		expect(unknown.error ?? mcpResult(unknown)).toBeTruthy();
		if (!unknown.error) {
			expect(mcpResult(unknown).success).toBe(false);
		}
	});

	it('enforces HumanRelay host-verified confirmation on decision-record (choice + card modes) and design-release, while rejecting confirmations: off', async () => {
		await expect(
			createSpecimenMcpServer({ root, confirmations: 'off' as 'require-human' })
		).rejects.toThrow(/require-human/);

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
					observation: makeCompareObservation('toolbar--dense'),
				},
				{
					key: 'toolbar--airy',
					id: 'toolbar--airy',
					status: 'captured',
					observation: makeCompareObservation('toolbar--airy'),
				},
			],
		});

		await writeCardRecord(root, {
			card: 'card-r31ay0000001',
			what: 'Clarify checkout error recovery',
			owner: 'product',
			scope: 'release',
			touches: ['src/checkout.ts'],
			severity: 'blocker',
			visual: { kind: 'transcript', summary: 'Walk stopped on missing recovery action.' },
			why: {
				findings: [{ summary: 'Missing retry guidance.', evidence: 'observed' }],
				reviewerCount: 5,
				split: '5-0',
				trigger: 'split-3-to-2',
			},
			effect: {
				gatesBefore: { passed: 10, failed: 1 },
				gatesAfter: { passed: 11, failed: 0 },
				regression: false,
			},
			risk: { affects: ['checkout'], undoable: true },
			status: 'open',
		});

		// 1. Without a configured HumanRelay, both decision-record and design-release fail closed with CONFIRMATION_REQUIRED.
		const { url: noRelayUrl } = await mountHandler();
		const noRelayDecision = mcpResult(
			await callTool(noRelayUrl, 'decision-record', {
				card: 'card-r31ay0000001',
				chosen: 'approve',
				reason: 'Should fail without HumanRelay.',
			})
		);
		expect(noRelayDecision).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED', retryable: false },
		});
		const noRelayRelease = mcpResult(
			await callTool(noRelayUrl, 'design-release', {
				release: '1.0.0',
				decisions: ['dec-000000000000'],
			})
		);
		expect(noRelayRelease).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED', retryable: false },
		});

		// Read-only commands (design-card-list, specimen-review) still work without HumanRelay.
		const cardsListed = mcpResult(await callTool(noRelayUrl, 'design-card-list', {}));
		expect(cardsListed).toMatchObject({
			success: true,
			data: { cards: [{ card: 'card-r31ay0000001' }] },
		});
		const reviewRes = mcpResult(
			await callTool(noRelayUrl, 'specimen-review', {
				before: written.run.set,
				after: written.run.set,
			})
		);
		expect(reviewRes).toMatchObject({ success: true, data: { open: [], blocking: [] } });

		// 2. With HumanRelay configured:
		const relay = new FakeHumanRelay();
		relay.confirmedBy = 'alice';
		const { url: relayUrl } = await mountHandler({ humanRelay: relay });

		// Form-only client (no URL-mode elicitation) is refused with CONFIRMATION_REQUIRED.
		const formOnly = mcpResult(
			await callTool(
				relayUrl,
				'decision-record',
				{ card: 'card-r31ay0000001', chosen: 'approve', reason: 'Needs URL elicitation.' },
				{ elicitation: { form: {} } }
			)
		);
		expect(formOnly).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED', retryable: false },
		});

		// Client with URL-mode elicitation receives inputRequired -> declining returns CONFIRMATION_DECLINED.
		const cardArgs = {
			card: 'card-r31ay0000001',
			chosen: 'approve',
			reason: 'Reviewed transcript and approved recovery copy.',
		};
		const promptResp = await callTool(relayUrl, 'decision-record', cardArgs, urlCaps());
		const promptState = (promptResp.result as { requestState?: string }).requestState;
		expect(promptState).toBeTruthy();

		const declined = mcpResult(
			await callTool(relayUrl, 'decision-record', cardArgs, urlCaps(), {
				inputResponses: { relay: { action: 'decline' } },
				requestState: promptState,
			})
		);
		expect(declined).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_DECLINED', retryable: false },
		});

		// Nothing was written to specimens/decisions/ by any refused/declined call.
		await expect(readdir(join(root, 'specimens', 'decisions'))).rejects.toMatchObject({
			code: 'ENOENT',
		});

		// Approving via HumanRelay succeeds and records decidedBy: { kind: 'person', channel: 'mcp-relay', id: 'alice' }.
		const prompt2 = await callTool(relayUrl, 'decision-record', cardArgs, urlCaps());
		const state2 = (prompt2.result as { requestState: string }).requestState;
		relay.answer({ kind: 'approved', decisionId: 'relay-dec-1' });
		const approved = mcpResult(
			await callTool(relayUrl, 'decision-record', cardArgs, urlCaps(), {
				inputResponses: { relay: { action: 'accept' } },
				requestState: state2,
			})
		);
		expect(approved).toMatchObject({
			success: true,
			data: { kind: 'card', card: 'card-r31ay0000001', chosen: 'approve' },
		});
		const cardDecisionId = (approved.data as { decision: string }).decision;

		const fetchedCardDec = mcpResult(
			await callViaAfd(relayUrl, 'decision-get', { decision: cardDecisionId })
		);
		expect(fetchedCardDec).toMatchObject({
			success: true,
			data: {
				decision: cardDecisionId,
				decidedBy: { kind: 'person', channel: 'mcp-relay', id: 'alice' },
			},
		});

		// Approving design-release via HumanRelay writes the release manifest with person provenance.
		const releaseArgs = { release: '1.0.0', decisions: [cardDecisionId] };
		const relPrompt = await callTool(relayUrl, 'design-release', releaseArgs, urlCaps());
		const relState = (relPrompt.result as { requestState: string }).requestState;
		relay.answer({ kind: 'approved', decisionId: 'relay-dec-2' });
		const released = mcpResult(
			await callTool(relayUrl, 'design-release', releaseArgs, urlCaps(), {
				inputResponses: { relay: { action: 'accept' } },
				requestState: relState,
			})
		);
		expect(released).toMatchObject({
			success: true,
			data: {
				release: '1.0.0',
				manifestPath: 'specimens/releases/1.0.0.json',
				decisions: [cardDecisionId],
			},
		});

		// decision-list reflects the released card decision.
		const listedReleased = mcpResult(
			await callTool(relayUrl, 'decision-list', { kind: 'card', released: true })
		);
		expect(listedReleased).toMatchObject({
			success: true,
			data: {
				decisions: [{ decision: cardDecisionId, released: true, release: '1.0.0' }],
			},
		});
	});

	it('exposes design-states over MCP for commands-only configs with structured errors', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'specimen-mcp-design-states-'));
		try {
			await writeFile(
				join(dir, 'commands.json'),
				JSON.stringify({
					app: 'bookshop',
					commands: [
						{ name: 'order-create', undoable: true, errors: ['OUT_OF_STOCK'] },
						{ name: 'catalog-import', batch: true },
					],
				})
			);
			await writeFile(
				join(dir, 'specimen.config.json'),
				JSON.stringify({
					defaults: 'afd-defaults@1.0.0',
					commandManifest: './commands.json',
				})
			);
			const { url } = await mountHandler({ dir });

			const ok = mcpResult(
				await callTool(url, 'design-states', { commands: ['order-create', 'catalog-import'] })
			);
			expect(ok.success).toBe(true);
			expect(ok.data).toMatchObject({
				defaultsVersion: 'afd-defaults@1.0.0',
				states: [
					expect.objectContaining({
						command: 'order-create',
						pattern: 'afd-defaults/error-recovery',
						approvalStatus: 'approved',
					}),
					expect.objectContaining({
						command: 'order-create',
						pattern: 'afd-defaults/undo-offer',
						approvalStatus: 'approved',
					}),
					expect.objectContaining({
						command: 'catalog-import',
						pattern: 'afd-defaults/batch-partial-failure',
						approvalStatus: 'approved',
					}),
				],
				unmeasured: expect.arrayContaining([expect.objectContaining({ area: 'screen-gates' })]),
			});

			const missing = mcpResult(
				await callTool(url, 'design-states', { commands: ['book-teleport'] })
			);
			expect(missing.success).toBe(false);
			expect(missing.error).toMatchObject({
				code: 'TARGET_COMMAND_NOT_FOUND',
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('exposes panel-walk over MCP with modality enforcement and outputBudget metadata', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'specimen-mcp-panel-walk-'));
		try {
			await writeFile(
				join(dir, 'walk-driver.mjs'),
				`export default async function driver() {
					return { transcript: 'Done.', actions: 1, journal: [], findings: [] };
				}\n`
			);
			await writeFile(
				join(dir, 'specimen.config.json'),
				JSON.stringify({
					panel: {
						jobs: ['checkout-out-of-stock'],
						personas: [{ id: 'p-sr', modality: 'screen-reader' }],
						driver: './walk-driver.mjs',
					},
				})
			);
			const { url } = await mountHandler({ dir });
			const listed = await listTools(url);
			const walkTool = listed.find((t) => t.name === 'panel-walk');
			expect(walkTool?._meta?.['dev.afd/outputBudget']).toEqual({
				defaultBytes: 24576,
				maxBytes: 65536,
			});

			const forbidden = mcpResult(
				await callTool(url, 'panel-walk', {
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173/checkout',
					requestedTools: ['click'],
				})
			);
			expect(forbidden.success).toBe(false);
			expect(forbidden.error).toMatchObject({
				code: 'MODALITY_FORBIDDEN',
			});

			const ok = mcpResult(
				await callTool(url, 'panel-walk', {
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173/checkout',
					appDate: '2030-05-12',
				})
			);
			expect(ok.success).toBe(true);
			expect(ok.data).toMatchObject({
				walk: expect.stringMatching(/^walk-[0-9a-hjkmnp-tv-z]{12}$/),
				modality: 'screen-reader',
				ending: 'done',
			});
			expect(
				(ok.metadata as Record<string, unknown> | undefined)?.['dev.afd/outputBudget']
			).toMatchObject({
				limitBytes: 24576,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('lists and calls over stdio with the real CLI result envelope and exits cleanly on stdin EOF', async () => {
		const client = new Client({ name: 'specimen-stdio-test', version: '1.0.0' });
		cleanups.push(() => client.close());
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [fileURLToPath(binary), '--root', root, '--config', 'specimen.config.json'],
			stderr: 'pipe',
		});
		await client.connect(transport);
		const listedNames = (await client.listTools()).tools.map((tool) => tool.name);
		expect(listedNames).toContain('specimen-list');
		expect(listedNames).toContain('design-card-list');
		expect(listedNames).toContain('design-release');
		expect(listedNames).toContain('afd-discover');

		const result = await client.callTool({ name: 'specimen-list', arguments: {} });
		const cliBin = new URL('../../specimen-cli/dist/bin.js', import.meta.url);
		const cli = await exec(process.execPath, [fileURLToPath(cliBin), '--root', root, 'list']);
		expect(result.isError).toBe(false);
		expect(envelope(result as CallToolResult).data).toEqual(JSON.parse(cli.stdout).data);

		// Clean EOF exit check.
		const child = spawn(process.execPath, [fileURLToPath(binary), '--root', root], {
			stdio: 'pipe',
			signal: AbortSignal.timeout(5000),
		});
		let stdout = '';
		const closed = new Promise<{ code: number | null; signal: string | null }>(
			(resolve, reject) => {
				child.once('error', reject);
				child.once('close', (code, signal) => resolve({ code, signal }));
			}
		);
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
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
	});

	it('exposes createSpecimenMcpServer lifecycle, rejects non-require-human confirmations, and cleans up on errors', async () => {
		await expect(
			createSpecimenMcpServer({
				root,
				confirmations: 'allow-agent' as unknown as 'require-human',
			})
		).rejects.toThrow("confirmations must be 'require-human'");

		// Invalid firstClassTools cleans up bench and rethrows from both factory functions.
		await expect(
			createSpecimenMcpServer({
				root,
				toolStrategy: 'hybrid',
				firstClassTools: ['nonexistent-tool'],
			})
		).rejects.toThrow();
		await expect(
			createSpecimenMcpHandler({
				root,
				toolStrategy: 'hybrid',
				firstClassTools: ['nonexistent-tool'],
			})
		).rejects.toThrow();

		// Full in-process server lifecycle on HTTP transport.
		const server = await createSpecimenMcpServer({
			root,
			transport: 'http',
			host: '127.0.0.1',
			port: 0,
			serverOptions: { instances: 'single' },
		});
		cleanups.push(() => server.close());
		await server.start();
		expect(server.getTransport()).toBe('http');
		expect(server.getUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(server.getCommands().map((c) => c.name)).toContain('design-card-list');

		const listResult = await server.execute('specimen-list', {});
		expect(listResult.success).toBe(true);
		const pipelineResult = await server.executePipeline({
			steps: [{ command: 'specimen-list', input: {} }],
		});
		expect(pipelineResult.steps[0]?.status).toBe('success');
		await server.stop();

		// Handler dispose() and confirmedBy fallback (without 'dev.afd.specimen/confirmedBy' key).
		const plainRelay: HumanRelay = {
			async begin(call) {
				return {
					ok: true,
					prompt: {
						url: `${PERSON_URL}-plain`,
						message: `Confirm ${call.command}`,
						state: 'plain-state',
					},
				};
			},
			async resume() {
				return { kind: 'approved', decisionId: 'dec-plain-1' };
			},
			async approvedContext() {
				return { confirmedBy: 'bob@example.com' };
			},
		};
		const { url: plainUrl, handler: plainHandler } = await mountHandler({
			humanRelay: plainRelay,
		});
		await writeCardRecord(root, {
			card: 'card-000000000009',
			scope: 'interface',
			what: 'Test fallback confirmedBy',
			owner: 'product',
			touches: ['case.ts'],
			severity: 'minor',
			visual: { kind: 'diff', summary: 'Small change' },
			why: {
				findings: [{ summary: 'Checked', evidence: 'observed' }],
				reviewerCount: 1,
				split: '1-0',
				trigger: 'split-3-to-2',
			},
			effect: {
				gatesBefore: { passed: 1, failed: 0 },
				gatesAfter: { passed: 1, failed: 0 },
				regression: false,
			},
			risk: { affects: ['case.ts'], undoable: true },
			status: 'open',
		});
		const plainArgs = {
			card: 'card-000000000009',
			chosen: 'approve',
			reason: 'Approved via plain relay',
		};
		const promptResp = await callTool(plainUrl, 'decision-record', plainArgs, urlCaps());
		const reqState = (promptResp.result as { requestState?: string }).requestState;
		expect(reqState).toBeTruthy();
		const resumed = mcpResult(
			await callTool(plainUrl, 'decision-record', plainArgs, urlCaps(), {
				inputResponses: { relay: { action: 'accept' } },
				requestState: reqState,
			})
		);
		expect(resumed).toMatchObject({
			success: true,
			data: { kind: 'card', card: 'card-000000000009', chosen: 'approve' },
		});
		const plainDecisionId = (resumed.data as { decision: string }).decision;
		const fetched = mcpResult(
			await callViaAfd(plainUrl, 'decision-get', { decision: plainDecisionId })
		);
		expect(fetched).toMatchObject({
			success: true,
			data: { decidedBy: { kind: 'person', id: 'bob@example.com', channel: 'mcp-relay' } },
		});
		plainHandler.dispose();
	});

	it('records, gets, checks, and lists choice decisions round-trip over MCP with HumanRelay', async () => {
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
					observation: makeCompareObservation('toolbar--dense'),
				},
				{
					key: 'toolbar--airy',
					id: 'toolbar--airy',
					status: 'captured',
					observation: makeCompareObservation('toolbar--airy'),
				},
			],
		});
		const relay = new FakeHumanRelay();
		relay.confirmedBy = 'alice';
		const { url } = await mountHandler({ humanRelay: relay });

		const choiceArgs = {
			set: written.run.set,
			slug: 'toolbar-density',
			question: 'Dense or airy toolbar?',
			chosen: 'toolbar--dense',
			reason: 'Dense toolbar preserves vertical reading room.',
			subjects: { specimens: ['toolbar--dense'], files: ['src/toolbar.css'] },
		};
		const prompt = await callTool(url, 'decision-record', choiceArgs, urlCaps());
		const reqState = (prompt.result as { requestState: string }).requestState;
		expect(reqState).toBeTruthy();
		relay.answer({ kind: 'approved', decisionId: 'choice-relay-1' });
		const recorded = mcpResult(
			await callTool(url, 'decision-record', choiceArgs, urlCaps(), {
				inputResponses: { relay: { action: 'accept' } },
				requestState: reqState,
			})
		);
		expect(recorded).toMatchObject({
			success: true,
			data: { kind: 'choice', chosen: 'toolbar--dense' },
		});
		const choiceId = (recorded.data as { decision: string }).decision;

		const fetched = mcpResult(await callViaAfd(url, 'decision-get', { decision: choiceId }));
		expect(fetched).toMatchObject({
			success: true,
			data: {
				decision: choiceId,
				kind: 'choice',
				chosen: 'toolbar--dense',
				decidedBy: { kind: 'person', id: 'alice', channel: 'mcp-relay' },
			},
		});

		const checked = mcpResult(
			await callViaAfd(url, 'decision-check', { files: ['src/toolbar.css'] })
		);
		expect(checked).toMatchObject({
			success: true,
			data: {
				decisions: [{ decision: choiceId, chosen: 'toolbar--dense' }],
			},
		});

		const listed = mcpResult(await callTool(url, 'decision-list', { kind: 'choice' }));
		expect(listed).toMatchObject({
			success: true,
			data: {
				decisions: [{ decision: choiceId, chosen: 'toolbar--dense' }],
			},
		});
	});

	it('rejects card mutation between HumanRelay begin and resume with STALE_CARD', async () => {
		const card = {
			card: 'card-5ta1e0000001',
			scope: 'release' as const,
			what: 'Original card proposal',
			owner: 'product' as const,
			touches: ['src/checkout.ts'],
			severity: 'major' as const,
			visual: { kind: 'diff' as const, summary: 'Original visual summary.' },
			why: {
				findings: [{ summary: 'Observed issue.', evidence: 'observed' as const }],
				reviewerCount: 5,
				split: '4-1',
				trigger: 'split-3-to-2' as const,
			},
			effect: {
				gatesBefore: { passed: 10, failed: 0 },
				gatesAfter: { passed: 10, failed: 0 },
				regression: false,
			},
			risk: { affects: ['checkout'], undoable: true },
			status: 'open' as const,
		};
		await writeCardRecord(root, card);
		const relay = new FakeHumanRelay();
		relay.confirmedBy = 'alice';
		const { url } = await mountHandler({ humanRelay: relay });

		const args = {
			card: card.card,
			chosen: 'approve',
			reason: 'Approving original proposal.',
		};
		const prompt = await callTool(url, 'decision-record', args, urlCaps());
		const reqState = (prompt.result as { requestState: string }).requestState;
		expect(reqState).toBeTruthy();

		// Tamper with the card on disk while HumanRelay confirmation is pending.
		await writeCardRecord(root, { ...card, what: 'Tampered proposal after begin()' });

		relay.answer({ kind: 'approved', decisionId: 'stale-relay-1' });
		const resumed = mcpResult(
			await callTool(url, 'decision-record', args, urlCaps(), {
				inputResponses: { relay: { action: 'accept' } },
				requestState: reqState,
			})
		);
		expect(resumed).toMatchObject({
			success: false,
			error: { code: 'STALE_CARD' },
		});
	});

	it('refuses host-verified commands inside afd-batch and afd-pipe, enforces HumanRelay via afd-call and grouped tools, and ignores spoofed _meta', async () => {
		await writeCardRecord(root, {
			card: 'card-5ec000000001',
			scope: 'release',
			what: 'Security boundary card',
			owner: 'product',
			touches: ['src/security.ts'],
			severity: 'blocker',
			visual: { kind: 'diff', summary: 'Security check.' },
			why: {
				findings: [{ summary: 'Checked.', evidence: 'observed' }],
				reviewerCount: 5,
				split: '5-0',
				trigger: 'irreversible-or-default',
			},
			effect: {
				gatesBefore: { passed: 5, failed: 0 },
				gatesAfter: { passed: 5, failed: 0 },
				regression: false,
			},
			risk: { affects: ['security'], undoable: false },
			status: 'open',
		});

		const relay = new FakeHumanRelay();
		relay.confirmedBy = 'alice';
		const { url: hybridUrl } = await mountHandler({ humanRelay: relay });

		// afd-batch and afd-pipe refuse host-verified commands cleanly.
		const batchRes = mcpResult(
			await callTool(hybridUrl, 'afd-batch', {
				commands: [
					{
						command: 'decision-record',
						input: { card: 'card-5ec000000001', chosen: 'approve', reason: 'Batch bypass.' },
					},
				],
			})
		);
		expect(JSON.stringify(batchRes)).toContain('CONFIRMATION_REQUIRED');

		const pipeRes = mcpResult(
			await callTool(hybridUrl, 'afd-pipe', {
				steps: [
					{
						command: 'decision-record',
						input: { card: 'card-5ec000000001', chosen: 'approve', reason: 'Pipe bypass.' },
					},
				],
			})
		);
		expect(JSON.stringify(pipeRes)).toContain('CONFIRMATION_REQUIRED');

		// Spoofed _meta relay token is ignored without HumanRelay.
		const { url: noRelayUrl } = await mountHandler();
		const spoofed = mcpResult(
			await callTool(
				noRelayUrl,
				'decision-record',
				{ card: 'card-5ec000000001', chosen: 'approve', reason: 'Spoof _meta.' },
				urlCaps(),
				{
					_meta: {
						'dev.afd.specimen/relayConfirmed': {
							decisionId: 'fake',
							confirmedBy: 'spoof',
							channel: 'mcp-relay',
						},
					},
				}
			)
		);
		expect(spoofed).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED' },
		});

		// afd-call and grouped strategy both require HumanRelay confirmation (inputRequired prompt).
		const viaCall = await callTool(
			hybridUrl,
			'afd-call',
			{
				command: 'decision-record',
				input: { card: 'card-5ec000000001', chosen: 'approve', reason: 'Via afd-call.' },
			},
			urlCaps()
		);
		expect((viaCall.result as { requestState?: string }).requestState).toBeTruthy();

		const { url: groupedUrl } = await mountHandler({ toolStrategy: 'grouped', humanRelay: relay });
		const viaGrouped = await callTool(
			groupedUrl,
			'decision',
			{
				action: 'record',
				params: {
					card: 'card-5ec000000001',
					chosen: 'approve',
					reason: 'Via grouped tool.',
				},
			},
			urlCaps()
		);
		expect((viaGrouped.result as { requestState?: string }).requestState).toBeTruthy();
	});

	it('refuses host-verified decision-record over legacy stdio without HumanRelay', async () => {
		const client = new Client({ name: 'specimen-stdio-refuse', version: '1.0.0' });
		cleanups.push(() => client.close());
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [fileURLToPath(binary), '--root', root, '--config', 'specimen.config.json'],
			stderr: 'pipe',
		});
		await client.connect(transport);
		const res = (await client.callTool({
			name: 'decision-record',
			arguments: {
				card: 'card-5ec000000001',
				chosen: 'approve',
				reason: 'Stdio without HumanRelay.',
			},
		})) as CallToolResult;
		const body = envelope(res);
		expect(body).toMatchObject({
			success: false,
			error: { code: 'CONFIRMATION_REQUIRED' },
		});
	});

	it('serves set-backed specimen-render and specimen-a11y over MCP without launching a browser', async () => {
		const written = await writeCaptureSet(root, {
			kind: 'capture',
			order: ['cheap'],
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
					key: 'cheap',
					id: 'cheap',
					status: 'captured',
					observation: makeCompareObservation('cheap'),
				},
			],
		});
		const { url } = await mountHandler();
		const rendered = mcpResult(
			await callViaAfd(url, 'specimen-render', { id: 'cheap', set: written.run.set })
		);
		expect(rendered).toMatchObject({
			success: true,
			data: { manifest: { specimenId: 'cheap' } },
		});
		const a11y = mcpResult(
			await callViaAfd(url, 'specimen-a11y', { id: 'cheap', set: written.run.set })
		);
		expect(a11y).toMatchObject({
			success: true,
			data: { counts: { passed: 1, failed: 0 } },
		});
		const detail = mcpResult(await callTool(url, 'afd-detail', { command: ['design-release'] }));
		expect(detail.success).toBe(true);
		expect(JSON.stringify(detail.data)).toContain('host-verified');
	});
});
