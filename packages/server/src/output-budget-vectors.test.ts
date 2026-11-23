/**
 * Output budgets (`spec/output-budgets.md`, B1 to B8): every case of the shared
 * `spec/vectors/output-budgets.json` in process (`createDirectRegistry`, `DirectClient`, batches,
 * pipelines, the journal and replay), over Streamable HTTP (`/mcp`) and stdio in both MCP eras,
 * and on AFD's HTTP lanes (`/message`, `/rpc`, `/batch`, `/stream`).
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDirectClient } from '@lushly-dev/afd-client/direct';
import type { CommandResult, OutputBudget } from '@lushly-dev/afd-core';
import {
	AFD_OUTPUT_BUDGET_META_KEY,
	createContextDigest,
	MemoryJournalSink,
	parseJournal,
	serializeJournal,
	success,
} from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { createExecutionEngine } from './execution.js';
import { createJournalMiddleware } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { defaultInstructions, serveModernStdio } from './mcp-modern.js';
import { measureOutputBudgetBytes } from './output-budget.js';
import { defineCommand, defineCommandWithSchema, type ZodCommandDefinition } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions, ToolStrategy } from './server-types.js';
import { TASKS_EXTENSION_ID } from './tasks.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

interface DeclarationCase {
	description: string;
	value: unknown;
	valid: boolean;
}

interface AskCase {
	description: string;
	declaration: OutputBudget | null;
	ask?: unknown;
	effective: number | null | 'VALIDATION_ERROR';
}

interface MeasureCase {
	description: string;
	json: string;
	bytes: number;
}

interface CheckCase {
	description: string;
	declaration: OutputBudget | null;
	mutation: boolean;
	result: CommandResult;
	ask?: unknown;
	measuredBytes: number | null;
	expected: CommandResult;
}

interface BatchCase {
	description: string;
	commands: Record<string, { declaration: OutputBudget | null; mutation: boolean }>;
	ask: { maxBytes: number };
	items: Array<{
		id: string;
		command: string;
		result: CommandResult;
		expected: CommandResult;
	}>;
}

interface JournalCase {
	description: string;
	declaration: OutputBudget | null;
	ask?: unknown;
	expected: number | null;
}

const spec = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/output-budgets.json', import.meta.url), 'utf8')
) as {
	declarations: DeclarationCase[];
	asks: AskCase[];
	measure: MeasureCase[];
	checks: CheckCase[];
	batch: BatchCase;
	journal: JournalCase[];
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Spec `checks` comparison: equal JSON, comparing `metadata` only on `dev.afd/outputBudget`. */
function assertSameResult(actual: unknown, expected: unknown, label: string): void {
	const left = structuredClone(actual) as Record<string, unknown>;
	const right = structuredClone(expected) as Record<string, unknown>;
	const leftMeta = left.metadata as Record<string, unknown> | undefined;
	const rightMeta = right.metadata as Record<string, unknown> | undefined;
	const leftReport = leftMeta?.[AFD_OUTPUT_BUDGET_META_KEY];
	const rightReport = rightMeta?.[AFD_OUTPUT_BUDGET_META_KEY];
	delete left.metadata;
	delete right.metadata;
	expect(left, label).toEqual(right);
	expect(leftReport, `${label} (report)`).toEqual(rightReport);
}

function makeFixedCommand(
	name: string,
	declaration: OutputBudget | null,
	mutation: boolean,
	fixedResult: CommandResult,
	onSeen?: (budget: number | undefined) => void
) {
	return defineCommand({
		name,
		description: `Test command ${name}`,
		input: z.object({}),
		expose: { mcp: true, agent: true },
		...(mutation ? { mutation: true } : {}),
		...(declaration ? { outputBudget: declaration } : {}),
		handler: async (_input, context) => {
			onSeen?.(context.outputBudget);
			return structuredClone(fixedResult);
		},
	});
}

function makeBatchCommands(batchCase: BatchCase): ZodCommandDefinition[] {
	const byId = new Map(batchCase.items.map((item) => [item.id, item.result]));
	return Object.entries(batchCase.commands).map(([name, cfg]) =>
		defineCommand({
			name,
			description: `Batch command ${name}`,
			input: z.object({ id: z.string() }),
			expose: { mcp: true, agent: true },
			...(cfg.mutation ? { mutation: true } : {}),
			...(cfg.declaration ? { outputBudget: cfg.declaration } : {}),
			handler: async (input) => structuredClone(byId.get(input.id) as CommandResult),
		})
	);
}

type McpLane = 'http-modern' | 'http-legacy' | 'stdio-modern' | 'stdio-legacy';
const MCP_LANES: readonly McpLane[] = [
	'http-modern',
	'http-legacy',
	'stdio-modern',
	'stdio-legacy',
];

async function connectLane(
	lane: McpLane,
	commands: ZodCommandDefinition[],
	options: Partial<McpHandlerOptions> = {}
): Promise<Client> {
	const mode = lane.endsWith('modern') ? 'auto' : 'legacy';
	const toolStrategy: ToolStrategy = options.toolStrategy ?? 'individual';
	if (lane.startsWith('http')) {
		const handler = createMcpHandler({
			name: 'budget-http',
			version: '1.0.0',
			commands,
			host: '127.0.0.1',
			toolStrategy,
			...options,
		});
		const server = createServer(handler);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
		const client = new Client(
			{ name: 'budget-client', version: '0' },
			mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
		);
		await client.connect(new StreamableHTTPClientTransport(new URL(url)));
		cleanups.push(async () => {
			await client.close();
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});
		expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
		return client;
	}

	// Wire an in-memory stdio transport with the server's exact engine and router.
	const all = [...commands];
	const engine = createExecutionEngine({
		commandMap: new Map(all.map((command) => [command.name, command])),
		middleware: options.middleware ?? [],
		devMode: false,
		contextFields: options.contextFields,
		contextDefaults: { actor: options.actor ?? { kind: 'agent' } },
	});
	const routeToolCall = createToolRouter({
		executeCommand: engine.executeCommand,
		executeBatch: engine.executeBatch,
		executePipeline: engine.executePipeline,
		commands: all,
		toolStrategy,
		devMode: false,
		allCommands: all,
		exposedCommandNames: new Set(all.map((command) => command.name)),
	});
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const handle = serveModernStdio(
		{
			name: 'budget-stdio',
			version: '1.0.0',
			instructions: defaultInstructions({ name: 'budget-stdio', toolStrategy }),
			getToolsList: () =>
				getToolsList(all, toolStrategy, undefined, undefined, {
					firstClassTools: options.firstClassTools,
				}),
			routeToolCall,
			contextFields: options.contextFields,
			devMode: false,
		},
		undefined,
		serverSide
	);
	const client = new Client(
		{ name: 'budget-stdio-client', version: '0' },
		mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
	);
	await client.connect(clientSide);
	cleanups.push(async () => {
		await client.close();
		await handle.close();
	});
	expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
	return client;
}

function parseToolText(result: unknown): Record<string, unknown> {
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}');
}

async function serveHttp(
	commands: ZodCommandDefinition[],
	options: Partial<McpHandlerOptions> = {}
): Promise<string> {
	const handler = createMcpHandler({
		name: 'budget-http-lanes',
		version: '1.0.0',
		commands,
		host: '127.0.0.1',
		toolStrategy: 'individual',
		...options,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	});
	const raw = await response.text();
	try {
		return JSON.parse(raw);
	} catch {
		const data = /^data: (.*)$/m.exec(raw)?.[1];
		return data ? JSON.parse(data) : undefined;
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1: DECLARATIONS AND SURFACES
// ═══════════════════════════════════════════════════════════════════════════════

describe('B1: declarations', () => {
	it('checks every declaration case from spec/vectors/output-budgets.json in defineCommand and defineCommandWithSchema', () => {
		for (const testCase of spec.declarations) {
			const defineViaZod = () =>
				defineCommand({
					name: 'doc-search',
					description: 'Search',
					input: z.object({}),
					outputBudget: testCase.value as OutputBudget,
					handler: async () => success({}),
				});
			const defineLean = () =>
				defineCommandWithSchema({
					name: 'doc-search',
					description: 'Search',
					input: z.object({}),
					jsonSchema: { type: 'object', properties: {} },
					outputBudget: testCase.value as OutputBudget,
					handler: async () => success({}),
				});

			if (testCase.valid) {
				expect(defineViaZod().outputBudget, testCase.description).toEqual(testCase.value);
				expect(defineLean().outputBudget, testCase.description).toEqual(testCase.value);
				expect(defineViaZod().toCommandDefinition().outputBudget, testCase.description).toEqual(
					testCase.value
				);
			} else {
				expect(defineViaZod, testCase.description).toThrow(/doc-search.*outputBudget/);
				expect(defineLean, testCase.description).toThrow(/doc-search.*outputBudget/);
			}
		}
	});

	it('rejects hand-built commands with invalid outputBudget at createMcpServer and createDirectRegistry registration', () => {
		const handBuilt = {
			...defineCommand({
				name: 'doc-hand',
				description: 'Hand built',
				input: z.object({}),
				expose: { mcp: true },
				handler: async () => success({}),
			}),
			outputBudget: { defaultBytes: 100, maxBytes: 50 },
		} as ZodCommandDefinition;
		expect(() => createMcpServer({ name: 's', version: '1', commands: [handBuilt] })).toThrow(
			/doc-hand.*outputBudget\.defaultBytes/
		);
		expect(() => createDirectRegistry([handBuilt])).toThrow(/doc-hand.*outputBudget\.defaultBytes/);
	});

	it('refuses dev.afd/outputBudget in toolMeta at server and direct tool surface registration', () => {
		const forged = defineCommand({
			name: 'doc-forged',
			description: 'Forged meta',
			input: z.object({}),
			expose: { mcp: true },
			toolMeta: { [AFD_OUTPUT_BUDGET_META_KEY]: { defaultBytes: 1, maxBytes: 1 } },
			handler: async () => success({}),
		});
		expect(() => createMcpServer({ name: 's', version: '1', commands: [forged] })).toThrow(
			/doc-forged.*dev\.afd\/outputBudget/
		);
		expect(() => createDirectRegistry([forged], { tools: createDirectToolSurface() })).toThrow(
			/doc-forged.*dev\.afd\/outputBudget/
		);
	});

	it('snapshots validated outputBudget at registration so later object mutation cannot alter it', async () => {
		const mutableBudget = { defaultBytes: 16, maxBytes: 32 };
		const handBuilt = {
			...defineCommand({
				name: 'doc-snap',
				description: 'Snapshot check',
				input: z.object({}),
				expose: { mcp: true, agent: true },
				handler: async () => success({ text: 'hello world!' }),
			}),
			outputBudget: mutableBudget,
		} as ZodCommandDefinition;

		const directReg = createDirectRegistry([handBuilt], {
			tools: createDirectToolSurface({ strategy: 'individual' }),
		});
		const httpClient = await connectLane('http-modern', [handBuilt], {
			toolStrategy: 'individual',
		});

		// Mutate caller's object after registration.
		mutableBudget.defaultBytes = 64;
		mutableBudget.maxBytes = 128;

		const directRes = await directReg.execute('doc-snap', {});
		expect(directRes.success).toBe(false);
		expect(directRes.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(directRes.error?.details?.limitBytes).toBe(16);
		expect(directRes.error?.details?.maxBytes).toBe(32);

		const directTool = directReg.listTools().find((t) => t.name === 'doc-snap');
		expect(directTool?._meta?.[AFD_OUTPUT_BUDGET_META_KEY]).toEqual({
			defaultBytes: 16,
			maxBytes: 32,
		});

		const mcpRes = parseToolText(await httpClient.callTool({ name: 'doc-snap', arguments: {} }));
		expect(mcpRes.success).toBe(false);
		expect((mcpRes.error as Record<string, unknown>).details).toMatchObject({
			limitBytes: 16,
			maxBytes: 32,
		});
	});

	it('emits _meta["dev.afd/outputBudget"] on individual, hybrid first-class and grouped actions; never on meta-tools, context tools, grouped tool itself or afd-discover', async () => {
		const search = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 64, maxBytes: 128 },
			false,
			success({ ok: true })
		);
		const open = makeFixedCommand('doc-open', null, false, success({ ok: true }));
		const commands = [search, open];

		// Individual across all 4 MCP lanes + unchanged by ask
		for (const lane of MCP_LANES) {
			const client = await connectLane(lane, commands, { toolStrategy: 'individual' });
			const plain = await client.listTools();
			const searchTool = plain.tools.find((t) => t.name === 'doc-search');
			const openTool = plain.tools.find((t) => t.name === 'doc-open');
			expect(searchTool?._meta?.[AFD_OUTPUT_BUDGET_META_KEY], lane).toEqual({
				defaultBytes: 64,
				maxBytes: 128,
			});
			expect(openTool?._meta?.[AFD_OUTPUT_BUDGET_META_KEY], lane).toBeUndefined();
			for (const metaName of ['afd-call', 'afd-batch', 'afd-pipe', 'afd-discover', 'afd-detail']) {
				const metaTool = plain.tools.find((t) => t.name === metaName);
				expect(
					metaTool?._meta?.[AFD_OUTPUT_BUDGET_META_KEY],
					`${lane}:${metaName}`
				).toBeUndefined();
			}
			const asked = await client.listTools({
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 10 } },
			});
			expect(asked.tools, `${lane} tools/list must not vary`).toEqual(plain.tools);
		}

		// Grouped: actions carry it, grouped tool itself does not
		const groupedClient = await connectLane('http-modern', commands, {
			toolStrategy: 'grouped',
			contexts: [{ name: 'docs', description: 'Docs' }],
		});
		const groupedTools = (await groupedClient.listTools()).tools;
		const docGroup = groupedTools.find((t) => t.name === 'doc');
		expect(docGroup?._meta?.[AFD_OUTPUT_BUDGET_META_KEY]).toBeUndefined();
		const actions = docGroup?._meta?.actions as Array<Record<string, unknown>>;
		expect(actions.find((a) => a.command === 'doc-search')?.[AFD_OUTPUT_BUDGET_META_KEY]).toEqual({
			defaultBytes: 64,
			maxBytes: 128,
		});
		expect(
			actions.find((a) => a.command === 'doc-open')?.[AFD_OUTPUT_BUDGET_META_KEY]
		).toBeUndefined();
		for (const ctxName of ['afd-context-list', 'afd-context-enter', 'afd-context-exit']) {
			expect(
				groupedTools.find((t) => t.name === ctxName)?._meta?.[AFD_OUTPUT_BUDGET_META_KEY]
			).toBeUndefined();
		}

		// Hybrid: first-class tool equals individual tool (H3)
		const hybridClient = await connectLane('http-modern', commands, {
			toolStrategy: 'hybrid',
			firstClassTools: ['doc-search'],
		});
		const individualClient = await connectLane('http-modern', commands, {
			toolStrategy: 'individual',
		});
		const hybridSearch = (await hybridClient.listTools()).tools.find(
			(t) => t.name === 'doc-search'
		);
		const individualSearch = (await individualClient.listTools()).tools.find(
			(t) => t.name === 'doc-search'
		);
		expect(hybridSearch).toEqual(individualSearch);

		// afd-discover never emits outputBudget; afd-detail, afd-help (full) and afd-docs emit it
		const bootClient = await connectLane('http-modern', commands, {
			toolStrategy: 'lazy',
			bootstrap: true,
		});
		const discover = parseToolText(
			await bootClient.callTool({ name: 'afd-discover', arguments: {} })
		);
		const discoverCmds = (discover.data as { commands: Array<Record<string, unknown>> }).commands;
		expect(discoverCmds.find((c) => c.name === 'doc-search')?.outputBudget).toBeUndefined();

		const detail = parseToolText(
			await bootClient.callTool({
				name: 'afd-detail',
				arguments: { command: ['doc-search', 'doc-open'] },
			})
		);
		const entries = detail.data as Array<Record<string, unknown>>;
		expect(entries[0]?.outputBudget).toEqual({ defaultBytes: 64, maxBytes: 128 });
		expect(entries[1]?.outputBudget).toBeUndefined();

		const helpBrief = parseToolText(
			await bootClient.callTool({ name: 'afd-help', arguments: { format: 'brief' } })
		);
		const briefCmds = (helpBrief.data as { commands: Array<Record<string, unknown>> }).commands;
		expect(briefCmds.find((c) => c.name === 'doc-search')?.outputBudget).toBeUndefined();

		const helpFull = parseToolText(
			await bootClient.callTool({ name: 'afd-help', arguments: { format: 'full' } })
		);
		const fullCmds = (helpFull.data as { commands: Array<Record<string, unknown>> }).commands;
		expect(fullCmds.find((c) => c.name === 'doc-search')?.outputBudget).toEqual({
			defaultBytes: 64,
			maxBytes: 128,
		});
		expect(fullCmds.find((c) => c.name === 'doc-open')?.outputBudget).toBeUndefined();

		const docs = parseToolText(
			await bootClient.callTool({ name: 'afd-docs', arguments: { command: 'doc-search' } })
		);
		expect((docs.data as { markdown: string }).markdown).toContain(
			'**Output budget:** default 64 bytes, max 128 bytes'
		);
	});

	it('reserves outputBudget in declared context fields', () => {
		const cmd = makeFixedCommand('doc-open', null, false, success({}));
		const field = { name: 'outputBudget', meta: 'dev.example/budget', schema: z.number() };
		expect(() => createDirectRegistry([cmd], { contextFields: [field] })).toThrow(/outputBudget/);
		expect(() =>
			createMcpServer({ name: 's', version: '1', commands: [cmd], contextFields: [field] })
		).toThrow(/outputBudget/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2–B4: ASKS, VALIDATION, PRECEDENCE AND EFFECTIVE BUDGET
// ═══════════════════════════════════════════════════════════════════════════════

describe('B2–B4: asks and effective budget', () => {
	it('passes all 19 ask cases from spec/vectors/output-budgets.json in process via createDirectRegistry', async () => {
		for (const testCase of spec.asks) {
			let seen: number | undefined;
			let ran = false;
			let mwRan = false;
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true }),
				(budget) => {
					ran = true;
					seen = budget;
				}
			);
			const registry = createDirectRegistry([cmd], {
				middleware: [
					async (_name, _input, _ctx, next) => {
						mwRan = true;
						return next();
					},
				],
			});
			const options =
				'ask' in testCase ? { outputBudget: testCase.ask as { maxBytes: number } } : {};
			const result = await registry.execute('doc-search', {}, {}, options);

			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(result.success, testCase.description).toBe(false);
				expect(result.error?.code, testCase.description).toBe('VALIDATION_ERROR');
				expect(result.error?.details, testCase.description).toEqual({
					field: 'outputBudget',
					meta: AFD_OUTPUT_BUDGET_META_KEY,
				});
				expect(result.error?.suggestion, testCase.description).toContain(
					'{ "maxBytes": <positive integer> }'
				);
				expect(mwRan, `${testCase.description}: middleware must not run`).toBe(false);
				expect(ran, `${testCase.description}: handler must not run`).toBe(false);
			} else {
				expect(ran, testCase.description).toBe(true);
				expect(seen, testCase.description).toBe(testCase.effective ?? undefined);
			}
		}
	});

	it('passes valid and invalid asks via DirectClient call option', async () => {
		let seen: number | undefined;
		const cmd = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 64, maxBytes: 128 },
			false,
			success({ ok: true }),
			(budget) => {
				seen = budget;
			}
		);
		const client = createDirectClient(createDirectRegistry([cmd]));
		const res1 = await client.call('doc-search', {}, { outputBudget: { maxBytes: 100 } });
		expect(res1.success).toBe(true);
		expect(seen).toBe(100);

		const res2 = await client.call('doc-search', {});
		expect(res2.success).toBe(true);
		expect(seen).toBe(64);

		const res3 = await client.call('doc-search', {}, { outputBudget: { maxBytes: 0 } });
		expect(res3.success).toBe(false);
		expect(res3.error?.code).toBe('VALIDATION_ERROR');
		expect(res3.error?.details).toEqual({
			field: 'outputBudget',
			meta: AFD_OUTPUT_BUDGET_META_KEY,
		});
	});

	it.each(MCP_LANES)('passes all 19 ask cases over MCP (%s)', async (lane) => {
		for (const testCase of spec.asks) {
			let seen: number | undefined;
			let ran = false;
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true }),
				(budget) => {
					ran = true;
					seen = budget;
				}
			);
			const client = await connectLane(lane, [cmd]);
			const meta = 'ask' in testCase ? { [AFD_OUTPUT_BUDGET_META_KEY]: testCase.ask } : undefined;
			const raw = await client.callTool({
				name: 'doc-search',
				arguments: {},
				...(meta ? { _meta: meta } : {}),
			});
			const result = parseToolText(raw);
			const label = `${lane}: ${testCase.description}`;
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(raw.isError, label).toBe(true);
				expect(result.success, label).toBe(false);
				expect((result.error as Record<string, unknown>).code, label).toBe('VALIDATION_ERROR');
				expect((result.error as Record<string, unknown>).details, label).toEqual({
					field: 'outputBudget',
					meta: AFD_OUTPUT_BUDGET_META_KEY,
				});
				expect(String((result.error as Record<string, unknown>).suggestion), label).toContain(
					'{ "maxBytes": <positive integer> }'
				);
				expect(ran, `${label}: handler must not run`).toBe(false);
			} else {
				expect(ran, label).toBe(true);
				expect(seen, label).toBe(testCase.effective ?? undefined);
			}
		}
	});

	it('lets trusted createContext win over _meta and ignores HTTP headers', async () => {
		let seen: number | undefined;
		const cmd = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 64, maxBytes: 128 },
			false,
			success({ ok: true }),
			(budget) => {
				seen = budget;
			}
		);

		for (const lane of ['http-modern', 'http-legacy'] as const) {
			const client = await connectLane(lane, [cmd], {
				createContext: () => ({ outputBudget: 40 }),
			});
			await client.callTool({
				name: 'doc-search',
				arguments: {},
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 128 } },
			});
			expect(seen, `${lane}: createContext number wins`).toBe(40);
		}

		// createContext can also return { maxBytes } or null (clearing _meta)
		const baseNull = await serveHttp([cmd], { createContext: () => ({ outputBudget: null }) });
		await postJson(`${baseNull}/rpc`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'doc-search',
			params: { _meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 128 } } },
		});
		expect(seen).toBe(64);

		// HTTP header is never read as an ask
		const basePlain = await serveHttp([cmd]);
		await postJson(
			`${basePlain}/rpc`,
			{ jsonrpc: '2.0', id: 1, method: 'doc-search', params: {} },
			{ 'Afd-Output-Budget': '{"maxBytes":100}', 'X-Output-Budget': '100' }
		);
		expect(seen).toBe(64);
	});

	it('passes all 19 ask cases through DirectClient.call and rejects invalid asks before client middleware', async () => {
		for (const testCase of spec.asks) {
			let seen: number | undefined;
			let ran = false;
			let clientMiddlewareRan = false;
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true }),
				(budget) => {
					ran = true;
					seen = budget;
				}
			);
			const registry = createDirectRegistry([cmd]);
			const client = createDirectClient(registry, {
				middleware: [
					async (_name, _input, _ctx, next) => {
						clientMiddlewareRan = true;
						return next();
					},
				],
			});
			const callCtx = 'ask' in testCase ? { outputBudget: testCase.ask as never } : undefined;
			const result = await client.call('doc-search', {}, callCtx);
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(result.success, testCase.description).toBe(false);
				expect(result.error?.code, testCase.description).toBe('VALIDATION_ERROR');
				expect(result.error?.details, testCase.description).toEqual({
					field: 'outputBudget',
					meta: AFD_OUTPUT_BUDGET_META_KEY,
				});
				expect(clientMiddlewareRan, `${testCase.description}: client middleware must not run`).toBe(
					false
				);
				expect(ran, `${testCase.description}: handler must not run`).toBe(false);
			} else {
				expect(ran, testCase.description).toBe(true);
				expect(seen, testCase.description).toBe(testCase.effective ?? undefined);
			}
		}
	});

	it('preserves valid and invalid _meta["dev.afd/outputBudget"] asks across MCP Tasks dispatch', async () => {
		const seen: Array<number | undefined> = [];
		const taskCmd = defineCommand({
			name: 'doc-task',
			description: 'Task-backed command with output budget',
			input: z.object({}),
			expose: { mcp: true },
			task: 'required',
			outputBudget: { defaultBytes: 128, maxBytes: 256 },
			handler: async (_input, context) => {
				seen.push(context.outputBudget);
				return success({ text: 'hello world!' }); // 47 bytes canonical JSON
			},
		});
		const base = await serveHttp([taskCmd], {
			createContext: () => ({ actor: { kind: 'human', id: 'alice' } }),
			taskOptions: { callersIdentifiedByHook: true },
		});
		const mcpUrl = `${base}/mcp`;

		const callModernTask = async (
			method: string,
			params: Record<string, unknown>,
			extraMeta: Record<string, unknown> = {}
		) => {
			const res = await fetch(mcpUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'MCP-Protocol-Version': '2026-07-28',
					'Mcp-Method': method,
					'Mcp-Name':
						method === 'tools/call' ? String(params.name ?? '') : String(params.taskId ?? ''),
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method,
					params: {
						...params,
						_meta: {
							'io.modelcontextprotocol/protocolVersion': '2026-07-28',
							'io.modelcontextprotocol/clientCapabilities': {
								extensions: { [TASKS_EXTENSION_ID]: {} },
							},
							'io.modelcontextprotocol/clientInfo': { name: 'budget-task-client', version: '1.0' },
							...extraMeta,
						},
					},
				}),
			});
			return (await res.json()) as Record<string, unknown>;
		};

		const waitTask = async (taskId: string) => {
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const poll = await callModernTask('tasks/get', { taskId });
				const taskResult = poll.result as Record<string, unknown>;
				if (taskResult.status !== 'working') return taskResult;
				await new Promise((r) => setTimeout(r, 10));
			}
			throw new Error('task timed out');
		};

		// Valid tighter ask (24 bytes): handler sees 24 and 35-byte result fails OUTPUT_BUDGET_EXCEEDED
		const createdValid = await callModernTask(
			'tools/call',
			{ name: 'doc-task', arguments: {} },
			{ [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 24 } }
		);
		const validTaskId = String((createdValid.result as { taskId: string }).taskId);
		const validSettled = await waitTask(validTaskId);
		const validToolResult = parseToolText(validSettled.result);
		expect(seen).toEqual([24]);
		expect(validToolResult.success).toBe(false);
		expect((validToolResult.error as Record<string, unknown>).code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect((validToolResult.error as Record<string, unknown>).details).toEqual({
			limitBytes: 24,
			actualBytes: 47,
			maxBytes: 256,
		});

		// Invalid ask ({ maxBytes: 0 }): fails VALIDATION_ERROR without invoking the handler
		const createdInvalid = await callModernTask(
			'tools/call',
			{ name: 'doc-task', arguments: {} },
			{ [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 0 } }
		);
		const invalidTaskId = String((createdInvalid.result as { taskId: string }).taskId);
		const invalidSettled = await waitTask(invalidTaskId);
		const invalidToolResult = parseToolText(invalidSettled.result);
		expect(seen).toEqual([24]);
		expect(invalidToolResult.success).toBe(false);
		expect((invalidToolResult.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
		expect((invalidToolResult.error as Record<string, unknown>).details).toEqual({
			field: 'outputBudget',
			meta: AFD_OUTPUT_BUDGET_META_KEY,
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// B5 & B6: MEASURE, CHECK, REPLACEMENT, WARNING AND REPORT
// ═══════════════════════════════════════════════════════════════════════════════

describe('B5 & B6: measure and post-handler check', () => {
	it('counts an own top-level __proto__ property accurately without dropping bytes', () => {
		const raw = '{"success":true,"data":"ok","__proto__":{"a":1}}';
		const parsed = JSON.parse(raw) as CommandResult;
		expect(measureOutputBudgetBytes(parsed)).toBe(Buffer.byteLength(raw, 'utf8'));
	});

	it('matches all 10 measure cases in spec/vectors/output-budgets.json (including lone surrogate)', async () => {
		expect(spec.measure.length).toBe(10);
		for (const testCase of spec.measure) {
			const parsed = JSON.parse(testCase.json) as CommandResult;
			expect(measureOutputBudgetBytes(parsed), testCase.description).toBe(testCase.bytes);

			// Exact budget passes with usedBytes === bytes
			const fitCmd = makeFixedCommand(
				'doc-search',
				{ defaultBytes: testCase.bytes, maxBytes: testCase.bytes },
				false,
				parsed
			);
			const fitRes = await createDirectRegistry([fitCmd]).execute('doc-search', {});
			expect(fitRes.success, testCase.description).toBe(true);
			expect(fitRes.metadata?.[AFD_OUTPUT_BUDGET_META_KEY], testCase.description).toEqual({
				limitBytes: testCase.bytes,
				usedBytes: testCase.bytes,
			});

			// One byte under budget fails with actualBytes === bytes
			if (testCase.bytes > 1) {
				const tightCmd = makeFixedCommand(
					'doc-search',
					{ defaultBytes: testCase.bytes - 1, maxBytes: testCase.bytes - 1 },
					false,
					parsed
				);
				const overRes = await createDirectRegistry([tightCmd]).execute('doc-search', {});
				expect(overRes.success, testCase.description).toBe(false);
				expect(overRes.error?.code, testCase.description).toBe('OUTPUT_BUDGET_EXCEEDED');
				expect(overRes.error?.details?.actualBytes, testCase.description).toBe(testCase.bytes);
			}
		}
	});

	it('passes all 11 check cases from spec/vectors/output-budgets.json in process', async () => {
		for (const testCase of spec.checks) {
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				testCase.mutation,
				testCase.result
			);
			const registry = createDirectRegistry([cmd]);
			const options =
				'ask' in testCase ? { outputBudget: testCase.ask as { maxBytes: number } } : {};
			const result = await registry.execute('doc-search', {}, {}, options);
			assertSameResult(result, testCase.expected, testCase.description);
		}
	});

	it.each(MCP_LANES)('passes all 11 check cases over MCP (%s)', async (lane) => {
		for (const testCase of spec.checks) {
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				testCase.mutation,
				testCase.result
			);
			const client = await connectLane(lane, [cmd]);
			const meta = 'ask' in testCase ? { [AFD_OUTPUT_BUDGET_META_KEY]: testCase.ask } : undefined;
			const raw = await client.callTool({
				name: 'doc-search',
				arguments: {},
				...(meta ? { _meta: meta } : {}),
			});
			const parsed = parseToolText(raw);
			const label = `${lane}: ${testCase.description}`;
			expect(raw.isError, label).toBe(parsed.success === false);
			expect(raw.structuredContent, label).toEqual(parsed);
			assertSameResult(parsed, testCase.expected, label);
		}
	});

	it('lets middleware, onCommand and journal observe the B5 result, stamps metadata on replaced failure, and resists handler mutation of context.outputBudget', async () => {
		const observedMiddleware: CommandResult[] = [];
		const observedHook: CommandResult[] = [];
		const sink = new MemoryJournalSink();
		const cmd = defineCommand({
			name: 'doc-search',
			description: 'Big search',
			input: z.object({}),
			outputBudget: { defaultBytes: 64, maxBytes: 128 },
			handler: async (_input, context) => {
				// Even if a handler mutates context.outputBudget, B5 and journal use the engine's limit.
				context.outputBudget = 999_999;
				return success({ text: 'x'.repeat(200) });
			},
		});
		const registry = createDirectRegistry([cmd], {
			actor: { kind: 'agent' },
			middleware: [
				async (_name, _input, _ctx, next) => {
					const res = await next();
					observedMiddleware.push(res);
					return res;
				},
				createJournalMiddleware(sink, { recordFailures: true }),
			],
			onCommand: (_name, _input, res) => observedHook.push(res),
		});

		const result = await registry.execute('doc-search', {}, { traceId: 'tr-1' });
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(result.metadata?.actorKind).toBe('agent');
		expect(result.metadata?.traceId).toBe('tr-1');
		expect(result.metadata?.[AFD_OUTPUT_BUDGET_META_KEY]).toBeUndefined();
		expect(observedMiddleware[0]?.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(observedHook[0]?.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');

		const entries = await sink.read();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.outputBudget).toBe(64);
		expect(entries[0]?.result.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// B7: BATCHES, PIPELINES, GROUPED TOOLS, META ARGUMENT & HTTP LANES / STREAMS
// ═══════════════════════════════════════════════════════════════════════════════

describe('B7: batches, pipelines, grouped tools, meta argument and HTTP lanes', () => {
	it('runs spec/vectors/output-budgets.json batch case via MCP _meta and meta argument, plus in-process tool surface', async () => {
		const commands = makeBatchCommands(spec.batch);
		const batchCommands = spec.batch.items.map((item) => ({
			id: item.id,
			command: item.command,
			input: { id: item.id },
		}));

		for (const lane of ['http-modern', 'stdio-legacy'] as const) {
			const client = await connectLane(lane, commands);
			for (const byArg of [false, true]) {
				const raw = await client.callTool({
					name: 'afd-batch',
					arguments: byArg
						? { commands: batchCommands, meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask } }
						: { commands: batchCommands },
					...(!byArg ? { _meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask } } : {}),
				});
				const batchResult = parseToolText(raw);
				const results = batchResult.results as Array<{ result: unknown }>;
				expect(results).toHaveLength(spec.batch.items.length);
				for (const [i, item] of spec.batch.items.entries()) {
					assertSameResult(results[i]?.result, item.expected, `${lane}:${byArg}:${item.id}`);
				}
			}
		}

		// In-process via createDirectRegistry + createDirectToolSurface
		const registry = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ strategy: 'individual' }),
		});
		const directBatch = (await registry.execute(
			'afd-batch',
			{ commands: batchCommands },
			{},
			{ outputBudget: spec.batch.ask }
		)) as unknown as { results: Array<{ result: unknown }>; summary: { failureCount: number } };
		expect(directBatch.summary.failureCount).toBe(1);
		for (const [i, item] of spec.batch.items.entries()) {
			assertSameResult(directBatch.results[i]?.result, item.expected, `direct:${item.id}`);
		}

		// stopOnError stops after replaced item
		const stoppedBatch = (await registry.execute(
			'afd-batch',
			{
				commands: [
					{ id: 'd', command: 'doc-open', input: { id: 'd' } },
					{ id: 'b', command: 'doc-open', input: { id: 'b' } },
				],
				options: { stopOnError: true },
			},
			{},
			{ outputBudget: spec.batch.ask }
		)) as unknown as { results: Array<{ result: CommandResult }> };
		expect(stoppedBatch.results[0]?.result.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(stoppedBatch.results[1]?.result.error?.code).toBe('COMMAND_SKIPPED');
	});

	it('applies ask per step in afd-pipe and DirectClient.pipe and stops at a replaced step', async () => {
		const commands = makeBatchCommands(spec.batch);
		const client = await connectLane('http-modern', commands);
		const pipeRes = parseToolText(
			await client.callTool({
				name: 'afd-pipe',
				arguments: {
					steps: [
						{ command: 'doc-search', input: { id: 'a' } },
						{ command: 'doc-open', input: { id: 'd' } },
						{ command: 'doc-open', input: { id: 'b' } },
					],
				},
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask },
			})
		);
		const steps = pipeRes.steps as Array<{ status: string; error?: { code: string } }>;
		expect(steps[0]?.status).toBe('success');
		expect(steps[1]?.status).toBe('failure');
		expect(steps[1]?.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(steps[2]?.status).not.toBe('success');

		// DirectClient.pipe forwards outputBudget per step
		const directClient = createDirectClient(createDirectRegistry(commands));
		const directPipe = await directClient.pipe(
			[
				{ command: 'doc-search', input: { id: 'a' } },
				{ command: 'doc-open', input: { id: 'd' } },
				{ command: 'doc-open', input: { id: 'b' } },
			],
			{ outputBudget: spec.batch.ask }
		);
		expect(directPipe.steps[0]?.status).toBe('success');
		expect(directPipe.steps[1]?.status).toBe('failure');
		expect(directPipe.steps[1]?.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(directPipe.steps[2]?.status).not.toBe('success');
	});

	it('routes afd-call and grouped tools under the routed command budget and rejects disagreeing meta arguments', async () => {
		const commands = makeBatchCommands(spec.batch);
		const groupedClient = await connectLane('http-modern', commands, { toolStrategy: 'grouped' });

		const callRes = parseToolText(
			await groupedClient.callTool({
				name: 'afd-call',
				arguments: { command: 'doc-open', input: { id: 'd' } },
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask },
			})
		);
		expect((callRes.error as Record<string, unknown>).code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect((callRes.error as Record<string, unknown>).details).toEqual({
			limitBytes: 96,
			actualBytes: 150,
			maxBytes: 200,
		});

		const groupRes = parseToolText(
			await groupedClient.callTool({
				name: 'doc',
				arguments: { action: 'open', params: { id: 'd' } },
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask },
			})
		);
		expect((groupRes.error as Record<string, unknown>).code).toBe('OUTPUT_BUDGET_EXCEEDED');

		// Disagreeing _meta and meta argument -> VALIDATION_ERROR naming dev.afd/outputBudget
		const disagree = parseToolText(
			await groupedClient.callTool({
				name: 'afd-call',
				arguments: {
					command: 'doc-open',
					input: { id: 'b' },
					meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 100 } },
				},
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 90 } },
			})
		);
		expect(disagree.success).toBe(false);
		expect((disagree.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
		expect((disagree.error as Record<string, unknown>).details).toEqual({
			meta: AFD_OUTPUT_BUDGET_META_KEY,
		});

		// Same value in both places is accepted
		const agree = parseToolText(
			await groupedClient.callTool({
				name: 'afd-call',
				arguments: {
					command: 'doc-open',
					input: { id: 'b' },
					meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 100 } },
				},
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 100 } },
			})
		);
		expect(agree.success).toBe(true);

		// Same disagreement check in-process via createDirectRegistry + createDirectToolSurface
		const directReg = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ strategy: 'individual' }),
		});
		const directDisagree = await directReg.execute(
			'afd-call',
			{
				command: 'doc-open',
				input: { id: 'b' },
				meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 100 } },
			},
			{},
			{ outputBudget: { maxBytes: 90 } }
		);
		expect(directDisagree.success).toBe(false);
		expect(directDisagree.error?.code).toBe('VALIDATION_ERROR');
		expect(directDisagree.error?.details).toEqual({ meta: AFD_OUTPUT_BUDGET_META_KEY });
	});

	it('passes all 19 ask cases across /message, /rpc, /batch and /stream and all 11 check cases across non-streaming HTTP lanes', async () => {
		// All 19 ask cases on /message, /rpc, /batch and /stream
		for (const testCase of spec.asks) {
			let seen: number | undefined;
			let ran = false;
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true }),
				(budget) => {
					ran = true;
					seen = budget;
				}
			);
			const base = await serveHttp([cmd]);
			const meta = 'ask' in testCase ? { [AFD_OUTPUT_BUDGET_META_KEY]: testCase.ask } : undefined;

			// /message
			ran = false;
			seen = undefined;
			const msg = await postJson(`${base}/message`, {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'doc-search', arguments: {}, ...(meta ? { _meta: meta } : {}) },
			});
			const msgResult = parseToolText(msg.result);
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(msgResult.success, `/message:${testCase.description}`).toBe(false);
				expect((msgResult.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
				expect(ran, `/message:${testCase.description}`).toBe(false);
			} else {
				expect(ran, `/message:${testCase.description}`).toBe(true);
				expect(seen, `/message:${testCase.description}`).toBe(testCase.effective ?? undefined);
			}

			// /rpc
			ran = false;
			seen = undefined;
			const rpc = await postJson(`${base}/rpc`, {
				jsonrpc: '2.0',
				id: 1,
				method: 'doc-search',
				params: meta ? { _meta: meta } : {},
			});
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(rpc.result.success, `/rpc:${testCase.description}`).toBe(false);
				expect(rpc.result.error.code).toBe('VALIDATION_ERROR');
				expect(ran, `/rpc:${testCase.description}`).toBe(false);
			} else {
				expect(ran, `/rpc:${testCase.description}`).toBe(true);
				expect(seen, `/rpc:${testCase.description}`).toBe(testCase.effective ?? undefined);
			}

			// /batch
			ran = false;
			seen = undefined;
			const batch = await postJson(`${base}/batch`, {
				commands: [{ id: '1', command: 'doc-search', input: {} }],
				...(meta ? { _meta: meta } : {}),
			});
			const itemResult = batch.results[0]?.result;
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(itemResult.success, `/batch:${testCase.description}`).toBe(false);
				expect(itemResult.error.code).toBe('VALIDATION_ERROR');
				expect(ran, `/batch:${testCase.description}`).toBe(false);
			} else {
				expect(ran, `/batch:${testCase.description}`).toBe(true);
				expect(seen, `/batch:${testCase.description}`).toBe(testCase.effective ?? undefined);
			}

			// /stream
			ran = false;
			seen = undefined;
			const streamRes = await fetch(`${base}/stream/doc-search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(meta ? { _meta: meta } : {}),
			});
			const streamText = await streamRes.text();
			if (testCase.effective === 'VALIDATION_ERROR') {
				expect(streamText, `/stream:${testCase.description}`).toContain(
					'"code":"VALIDATION_ERROR"'
				);
				expect(ran, `/stream:${testCase.description}`).toBe(false);
			} else {
				expect(ran, `/stream:${testCase.description}`).toBe(true);
				expect(seen, `/stream:${testCase.description}`).toBe(testCase.effective ?? undefined);
			}
		}

		// All 11 B5 check cases on /message, /rpc, and /batch
		for (const testCase of spec.checks) {
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				testCase.mutation,
				testCase.result
			);
			const base = await serveHttp([cmd]);
			const meta = 'ask' in testCase ? { [AFD_OUTPUT_BUDGET_META_KEY]: testCase.ask } : undefined;

			const msg = await postJson(`${base}/message`, {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'doc-search', arguments: {}, ...(meta ? { _meta: meta } : {}) },
			});
			assertSameResult(
				parseToolText(msg.result),
				testCase.expected,
				`/message:${testCase.description}`
			);

			const rpc = await postJson(`${base}/rpc`, {
				jsonrpc: '2.0',
				id: 1,
				method: 'doc-search',
				params: meta ? { _meta: meta } : {},
			});
			assertSameResult(rpc.result, testCase.expected, `/rpc:${testCase.description}`);

			const batch = await postJson(`${base}/batch`, {
				commands: [{ id: '1', command: 'doc-search', input: {} }],
				...(meta ? { _meta: meta } : {}),
			});
			assertSameResult(
				batch.results[0]?.result,
				testCase.expected,
				`/batch:${testCase.description}`
			);
		}
	});

	it('handles /message, /rpc, /batch and skips B5 on buffered /stream (Owner Decision 1)', async () => {
		let streamSeen: number | undefined;
		const bigSearch = defineCommand({
			name: 'doc-big',
			description: 'Returns a result larger than its budget',
			input: z.object({}),
			expose: { mcp: true },
			outputBudget: { defaultBytes: 64, maxBytes: 128 },
			handler: async (_input, context) => {
				streamSeen = context.outputBudget;
				return success({ text: 'x'.repeat(200) });
			},
		});
		const base = await serveHttp([bigSearch, ...makeBatchCommands(spec.batch)]);

		// /message
		const msg = await postJson(`${base}/message`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: {
				name: 'doc-open',
				arguments: { id: 'd' },
				_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask },
			},
		});
		expect(parseToolText(msg.result).error).toMatchObject({ code: 'OUTPUT_BUDGET_EXCEEDED' });

		// /rpc
		const rpc = await postJson(`${base}/rpc`, {
			jsonrpc: '2.0',
			id: 1,
			method: 'doc-open',
			params: { id: 'd', _meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask } },
		});
		expect(rpc.result.error).toMatchObject({
			code: 'OUTPUT_BUDGET_EXCEEDED',
			details: { limitBytes: 96, actualBytes: 150, maxBytes: 200 },
		});

		// /batch
		const batch = await postJson(`${base}/batch`, {
			commands: spec.batch.items.map((item) => ({
				id: item.id,
				command: item.command,
				input: { id: item.id },
			})),
			_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: spec.batch.ask },
		});
		for (const [i, item] of spec.batch.items.entries()) {
			assertSameResult(batch.results[i]?.result, item.expected, `/batch:${item.id}`);
		}

		// /stream: B2 validates ask and sets context.outputBudget, but B5 check is skipped (B7)
		const streamOk = await fetch(`${base}/stream/doc-big`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ _meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 100 } } }),
		});
		const streamText = await streamOk.text();
		expect(streamSeen).toBe(100);
		expect(streamText).toContain('"type":"data"');
		expect(streamText).toContain('"type":"complete"');
		expect(streamText).not.toContain('OUTPUT_BUDGET_EXCEEDED');
		expect(streamText).not.toContain(AFD_OUTPUT_BUDGET_META_KEY);

		// /stream: invalid ask still fails B2 validation before handler runs
		const streamBad = await fetch(`${base}/stream/doc-big`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ _meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 0 } } }),
		});
		const streamBadText = await streamBad.text();
		expect(streamBadText).toContain('"type":"error"');
		expect(streamBadText).toContain('"code":"VALIDATION_ERROR"');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// B8: JOURNAL AND REPLAY
// ═══════════════════════════════════════════════════════════════════════════════

describe('B8: journal and replay', () => {
	it('passes all 3 journal cases from spec/vectors/output-budgets.json, preserves key order and replays as same', async () => {
		for (const testCase of spec.journal) {
			const cmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true })
			);
			const sink = new MemoryJournalSink();
			const registry = createDirectRegistry([cmd], {
				middleware: [createJournalMiddleware(sink)],
			});
			const options =
				'ask' in testCase ? { outputBudget: testCase.ask as { maxBytes: number } } : {};
			const result = await registry.execute('doc-search', {}, {}, options);
			expect(result.success, testCase.description).toBe(true);

			const entries = await sink.read();
			expect(entries).toHaveLength(1);
			expect(entries[0]?.outputBudget, testCase.description).toBe(testCase.expected ?? undefined);

			const line = serializeJournal(entries);
			const raw = JSON.parse(line.trim()) as Record<string, unknown>;
			expect(raw.outputBudget ?? null, testCase.description).toBe(testCase.expected);
			if (testCase.expected !== null) {
				const keys = Object.keys(raw);
				expect(keys.indexOf('outputBudget')).toBeLessThan(keys.indexOf('result'));
			} else {
				expect('outputBudget' in raw).toBe(false);
			}
			expect(parseJournal(line), testCase.description).toEqual(entries);

			// Replay restores recorded outputBudget as the ask
			let replaySeen: number | undefined;
			const replayCmd = makeFixedCommand(
				'doc-search',
				testCase.declaration,
				false,
				success({ ok: true }),
				(budget) => {
					replaySeen = budget;
				}
			);
			const fresh = createDirectRegistry([replayCmd]);
			const report = await replayJournal(fresh, entries);
			expect(report.entries[0]?.status, testCase.description).toBe('same');
			expect(replaySeen, testCase.description).toBe(testCase.expected ?? undefined);
		}
	});

	it('places outputBudget after contextOmitted and before result in serialized journal entries', async () => {
		const cmd = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 64, maxBytes: 128 },
			false,
			success({ ok: true })
		);
		const sink = new MemoryJournalSink();
		const registry = createDirectRegistry([cmd], {
			contextFields: [{ name: 'big', meta: 'dev.example/big', schema: z.string(), journal: true }],
			middleware: [createJournalMiddleware(sink)],
		});
		await registry.execute('doc-search', {}, { big: 'a'.repeat(5000) });
		const line = serializeJournal(await sink.read());
		const keys = Object.keys(JSON.parse(line.trim()));
		expect(keys.indexOf('contextOmitted')).toBeGreaterThan(-1);
		expect(keys.indexOf('outputBudget')).toBe(keys.indexOf('contextOmitted') + 1);
		expect(keys.indexOf('result')).toBe(keys.indexOf('outputBudget') + 1);
	});

	it('reports different when a command lowers maxBytes before replay', async () => {
		const body = success({ text: 'x'.repeat(40) });
		const makeRegistry = (maxBytes: number, sink?: MemoryJournalSink) =>
			createDirectRegistry(
				[makeFixedCommand('doc-search', { defaultBytes: 32, maxBytes }, false, body)],
				sink ? { middleware: [createJournalMiddleware(sink, { recordFailures: true })] } : {}
			);

		const sink = new MemoryJournalSink();
		const recorded = makeRegistry(128, sink);
		const res = await recorded.execute('doc-search', {}, {}, { outputBudget: { maxBytes: 128 } });
		expect(res.success).toBe(true);
		const entries = await sink.read();
		expect(entries[0]?.outputBudget).toBe(128);

		// Lower maxBytes to 48 (result is 71 bytes) -> replay fails with limitBytes: 48
		const report = await replayJournal(makeRegistry(48), entries);
		expect(report.entries[0]?.status).toBe('different');
		expect(report.entries[0]?.replayed?.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(report.entries[0]?.replayed?.error?.details?.limitBytes).toBe(48);
	});

	it('journals outputBudget over MCP and updates contextDigest only when present', async () => {
		const budgeted = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 64, maxBytes: 128 },
			false,
			success({ ok: true })
		);
		const plain = makeFixedCommand('doc-open', null, false, success({ ok: true }));
		const sink = new MemoryJournalSink();
		const client = await connectLane('stdio-modern', [budgeted, plain], {
			middleware: [createJournalMiddleware(sink)],
		});

		await client.callTool({
			name: 'doc-search',
			arguments: {},
			_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 1000 } },
		});
		await client.callTool({
			name: 'doc-open',
			arguments: {},
			_meta: { [AFD_OUTPUT_BUDGET_META_KEY]: { maxBytes: 1000 } },
		});
		const entries = await sink.read();
		expect(entries[0]?.outputBudget).toBe(128);
		expect(entries[1]?.outputBudget).toBeUndefined();

		const digestWithout = await createContextDigest({ traceId: 't-1' });
		const digestWith = await createContextDigest({ traceId: 't-1', outputBudget: 128 });
		expect(digestWith.hash).not.toBe(digestWithout.hash);
	});

	it('journals the engine-enforced effective budget even when earlier middleware mutates context.outputBudget', async () => {
		const cmd = makeFixedCommand(
			'doc-search',
			{ defaultBytes: 16, maxBytes: 32 },
			false,
			success({ ok: true })
		);
		const sink = new MemoryJournalSink();
		const cleanSink = new MemoryJournalSink();
		const registry = createDirectRegistry([cmd], {
			middleware: [
				async (_name, _input, context, next) => {
					context.outputBudget = 31;
					return next();
				},
				createJournalMiddleware(sink, { recordFailures: true }),
			],
		});
		const cleanRegistry = createDirectRegistry([cmd], {
			middleware: [createJournalMiddleware(cleanSink, { recordFailures: true })],
		});

		const res = await registry.execute('doc-search', {}, { traceId: 'mw-mutate' });
		await cleanRegistry.execute('doc-search', {}, { traceId: 'mw-mutate' });
		expect(res.success).toBe(false);
		expect(res.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		expect(res.error?.details?.limitBytes).toBe(16);

		const entries = await sink.read();
		const cleanEntries = await cleanSink.read();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.outputBudget).toBe(16);
		expect(entries[0]?.contextDigest.hash).toBe(cleanEntries[0]?.contextDigest.hash);
	});

	it('replays a journaled over-budget buffered stream as same without applying B5 (B7 + B8)', async () => {
		const bigStreamCmd = defineCommand({
			name: 'doc-stream',
			description: 'Over-budget command run via buffered executeStream',
			input: z.object({}),
			expose: { mcp: true, agent: true },
			outputBudget: { defaultBytes: 16, maxBytes: 32 },
			handler: async (_input, context) =>
				success({ budget: context.outputBudget, text: 'exceeds-sixteen-bytes' }),
		});
		const sink = new MemoryJournalSink();
		const engine = createExecutionEngine({
			commandMap: new Map([[bigStreamCmd.name, bigStreamCmd]]),
			middleware: [createJournalMiddleware(sink)],
			devMode: false,
		});

		const chunks = [];
		for await (const chunk of engine.executeStream('doc-stream', {}, { traceId: 'stream-1' })) {
			chunks.push(chunk);
		}
		expect(chunks.some((c) => c.type === 'complete')).toBe(true);

		const entries = await sink.read();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.outputBudget).toBe(16);
		expect(entries[0]?.result.success).toBe(true);
		expect(entries[0]?.result.metadata?.[AFD_OUTPUT_BUDGET_META_KEY]).toBeUndefined();

		const replayTarget = createDirectRegistry([bigStreamCmd]);
		const report = await replayJournal(replayTarget, entries);
		expect(report.entries[0]?.status).toBe('same');
		expect(report.entries[0]?.replayed?.success).toBe(true);
		expect(report.entries[0]?.replayed?.data).toEqual({
			budget: 16,
			text: 'exceeds-sixteen-bytes',
		});
	});
});
