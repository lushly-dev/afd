/**
 * The hybrid tool strategy (`spec/tool-strategies.md`, H1 to H8): every case of the shared
 * `spec/tool-strategies.json`, over both MCP eras and through `createMcpHandler`, plus the checks
 * the spec asks of each implementation (a first-class tool equals the individual strategy's tool,
 * a 101st command leaves `tools/list` untouched, `afd-help` reports the strategy).
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

interface CommandSpec {
	name: string;
	description: string;
	mutation?: boolean;
	destructive?: boolean;
	confirmPrompt?: string;
	contexts?: string[];
	expose: { mcp: boolean };
}

interface ServerConfig {
	toolStrategy: McpHandlerOptions['toolStrategy'];
	firstClassTools?: string[];
	contexts?: boolean;
	bootstrap?: boolean;
	confirmations?: McpHandlerOptions['confirmations'];
	toolsListTtlMs?: number;
}

interface CallCase {
	tool: string;
	arguments?: Record<string, unknown>;
	context: string | null;
	expected: { success: boolean; code?: string };
}

interface ServerCase {
	id: string;
	description: string;
	config: ServerConfig;
	lists: Array<{ context: string | null; tools: string[] }>;
	ttlMs: number;
	calls: CallCase[];
}

interface StrategyFile {
	cap: number;
	metaTools: string[];
	contextTools: string[];
	contexts: Array<{ name: string; description: string }>;
	commands: CommandSpec[];
	servers: ServerCase[];
	constructionFailures: Array<{ id: string; config: ServerConfig; entry: string | null }>;
}

const spec: StrategyFile = JSON.parse(
	readFileSync(new URL('../../../spec/tool-strategies.json', import.meta.url), 'utf8')
);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Every command takes an object input with no required properties and returns its input. */
function toCommand(entry: CommandSpec): ZodCommandDefinition {
	return defineCommand({
		name: entry.name,
		description: entry.description,
		mutation: entry.mutation,
		destructive: entry.destructive,
		confirmPrompt: entry.confirmPrompt,
		contexts: entry.contexts,
		expose: entry.expose,
		input: z.object({ confirm: z.boolean().optional() }).passthrough(),
		handler: async (input) => success(input),
	});
}

function optionsFor(
	config: ServerConfig,
	commands: ZodCommandDefinition[] = spec.commands.map(toCommand)
): McpHandlerOptions {
	return {
		name: 'hybrid-test',
		version: '1.0.0',
		host: '127.0.0.1',
		commands,
		toolStrategy: config.toolStrategy,
		...(config.firstClassTools && { firstClassTools: config.firstClassTools }),
		...(config.contexts && { contexts: spec.contexts }),
		...(config.bootstrap && { bootstrap: true }),
		...(config.confirmations && { confirmations: config.confirmations }),
		...(config.toolsListTtlMs !== undefined && { toolsListTtlMs: config.toolsListTtlMs }),
	};
}

async function serve(options: McpHandlerOptions) {
	const handler = createMcpHandler(options);
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

// ── MCP 2026-07-28: stateless /mcp, context as request input ─────────────────────────────

const MODERN = '2026-07-28';
const META = {
	'io.modelcontextprotocol/protocolVersion': MODERN,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'hybrid-test', version: '0' },
};

interface Tool {
	name: string;
	description?: string;
	inputSchema?: unknown;
	annotations?: unknown;
	outputSchema?: unknown;
	_meta?: unknown;
}

async function modern(base: string, method: string, params: Record<string, unknown>) {
	const name = typeof params.name === 'string' ? params.name : undefined;
	const response = await fetch(`${base}/mcp`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': MODERN,
			'Mcp-Method': method,
			...(name ? { 'Mcp-Name': name } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1];
	return JSON.parse(data ?? text) as { result?: Record<string, unknown>; error?: unknown };
}

const withContext = (context: string | null | undefined) => ({
	_meta: { ...META, ...(context ? { 'dev.afd/context': context } : {}) },
});

async function modernList(base: string, context: string | null = null) {
	const { result } = await modern(base, 'tools/list', withContext(context));
	return result as { tools: Tool[]; ttlMs: number; cacheScope: string };
}

async function modernCall(
	base: string,
	tool: string,
	args: Record<string, unknown> = {},
	context: string | null = null
) {
	const { result } = await modern(base, 'tools/call', {
		name: tool,
		arguments: args,
		...withContext(context),
	});
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? '{}') as {
		success: boolean;
		data?: Record<string, unknown>;
		error?: { code: string; message: string; suggestion?: string };
	};
}

// ── MCP 2025: /message with an initialize session ────────────────────────────────────────

async function legacySession(base: string) {
	const post = (body: unknown, headers: Record<string, string> = {}) =>
		fetch(`${base}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
		});
	const init = await post({ jsonrpc: '2.0', id: 0, method: 'initialize' });
	const id = init.headers.get('mcp-session-id');
	const headers: Record<string, string> = id ? { 'Mcp-Session-Id': id } : {};
	return {
		async tools(): Promise<Tool[]> {
			const response = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers);
			return ((await response.json()) as { result: { tools: Tool[] } }).result.tools;
		},
		async call(name: string, args: Record<string, unknown> = {}) {
			const response = await post(
				{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
				headers
			);
			const body = (await response.json()) as { result: { content: Array<{ text: string }> } };
			return JSON.parse(body.result.content[0]?.text ?? '{}') as {
				success: boolean;
				data?: Record<string, unknown>;
				error?: { code: string; suggestion?: string };
			};
		},
	};
}

const names = (tools: Tool[]) => tools.map((tool) => tool.name);

// ═════════════════════════════════════════════════════════════════════════════════════════
// spec/tool-strategies.json
// ═════════════════════════════════════════════════════════════════════════════════════════

describe('spec/tool-strategies.json: servers', () => {
	it('is the file this implementation understands', () => {
		expect(spec.cap).toBe(8);
		expect(spec.metaTools).toHaveLength(5);
		expect(spec.servers.length).toBeGreaterThan(0);
	});

	describe.each(spec.servers)('$id', (server) => {
		it('lists the expected tools in order for every context, with the expected ttlMs', async () => {
			const base = await serve(optionsFor(server.config));
			for (const { context, tools } of server.lists) {
				const listed = await modernList(base, context);
				expect(names(listed.tools), `context ${context}`).toEqual(tools);
				expect(listed.ttlMs).toBe(server.ttlMs);
				expect(listed.cacheScope).toBe('public');
			}
		});

		it('answers server/discover with the same cache hints and listChanged false', async () => {
			const base = await serve(optionsFor(server.config));
			const { result } = await modern(base, 'server/discover', { _meta: META });
			expect(result?.ttlMs).toBe(server.ttlMs);
			expect(result?.cacheScope).toBe('public');
			expect(result?.capabilities).toMatchObject({ tools: { listChanged: false } });
		});

		it('lists the same tools to a 2025-era client, whatever context its session enters', async () => {
			const base = await serve(optionsFor(server.config));
			const expected = server.lists[0]?.tools;
			const session = await legacySession(base);
			expect(names(await session.tools())).toEqual(expected);
			if (server.config.contexts) {
				const entered = await session.call('afd-context-enter', { context: 'review' });
				expect(entered.success).toBe(true);
				expect(names(await session.tools())).toEqual(expected);
			}
		});

		it.each(server.calls.map((call) => [`${call.tool} in ${call.context}`, call] as const))(
			'call %s',
			async (_label, call) => {
				const base = await serve(optionsFor(server.config));
				const result = await modernCall(base, call.tool, call.arguments, call.context);
				expect(result.success).toBe(call.expected.success);
				if (call.expected.code) expect(result.error?.code).toBe(call.expected.code);
			}
		);
	});
});

describe('spec/tool-strategies.json: construction failures', () => {
	describe.each(spec.constructionFailures)('$id', (failureCase) => {
		const build = (create: (options: McpHandlerOptions) => unknown) => () =>
			create(optionsFor(failureCase.config));

		it.each([
			['createMcpServer', createMcpServer],
			['createMcpHandler', createMcpHandler],
		] as const)('%s throws', (_name, create) => {
			const thrown = (() => {
				try {
					build(create as (options: McpHandlerOptions) => unknown)();
				} catch (error) {
					return error as Error;
				}
				return undefined;
			})();
			expect(thrown, 'expected construction to fail').toBeInstanceOf(Error);
			if (failureCase.entry !== null) expect(thrown?.message).toContain(failureCase.entry);
		});
	});

	it('names the first entry beyond the cap, not a later one', () => {
		const failureCase = spec.constructionFailures.find((entry) => entry.id === 'over-cap');
		const extra: ServerConfig = {
			toolStrategy: 'hybrid',
			...failureCase?.config,
			firstClassTools: [...(failureCase?.config.firstClassTools ?? []), 'tag-add'],
		};
		expect(() => createMcpHandler(optionsFor(extra))).toThrow(/'plan-draft'.*cap of 8/);
	});
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// H1 to H8, beyond the shared cases
// ═════════════════════════════════════════════════════════════════════════════════════════

describe('hybrid construction (H1, H2)', () => {
	const base = { ...optionsFor({ toolStrategy: 'hybrid', bootstrap: true }) };

	it('refuses firstClassTools under the default (grouped) strategy', () => {
		const { toolStrategy: _omit, ...withoutStrategy } = base;
		expect(() => createMcpHandler({ ...withoutStrategy, firstClassTools: ['note-list'] })).toThrow(
			/only valid with toolStrategy: 'hybrid'/
		);
	});

	it('explains that an empty set is the lazy strategy', () => {
		expect(() => createMcpHandler({ ...base, firstClassTools: [] })).toThrow(/lazy/);
	});

	it('says which option is missing', () => {
		expect(() => createMcpHandler(base)).toThrow(/needs firstClassTools/);
	});

	it('refuses a bootstrap tool when the server does not register it, and says how', () => {
		const { bootstrap: _omit, ...withoutBootstrap } = base;
		expect(() => createMcpHandler({ ...withoutBootstrap, firstClassTools: ['afd-help'] })).toThrow(
			/'afd-help'.*bootstrap: true/
		);
	});

	it('refuses a context tool even when contexts are not configured', () => {
		expect(() => createMcpHandler({ ...base, firstClassTools: ['afd-context-list'] })).toThrow(
			/'afd-context-list'/
		);
	});

	it('refuses a value that is not a name', () => {
		expect(() =>
			createMcpHandler({ ...base, firstClassTools: ['note-list', 7 as unknown as string] })
		).toThrow(/not a command name/);
	});

	it('does not see later changes to the array it was given', async () => {
		const set = ['note-list'];
		const url = await serve({ ...base, firstClassTools: set });
		set.push('note-add');
		expect(names((await modernList(url)).tools).slice(5)).toEqual(['note-list']);
	});
});

describe('the hybrid list (H3, H4, H6)', () => {
	const config: ServerConfig = {
		toolStrategy: 'hybrid',
		firstClassTools: ['note-list', 'note-delete', 'plan-draft', 'afd-help'],
		contexts: true,
		bootstrap: true,
		confirmations: 'enforce',
	};

	it('equals the individual strategy for first-class and context tools, and lazy for meta-tools', async () => {
		const hybrid = await modernList(await serve(optionsFor(config)));
		const individual = await modernList(
			await serve(optionsFor({ ...config, toolStrategy: 'individual', firstClassTools: undefined }))
		);
		const lazy = await modernList(
			await serve(optionsFor({ ...config, toolStrategy: 'lazy', firstClassTools: undefined }))
		);
		const pick = (tools: Tool[], wanted: string[]) =>
			wanted.map((name) => tools.find((tool) => tool.name === name));
		const fixed = hybrid.tools.slice(0, 8);
		expect(fixed.slice(0, 5)).toEqual(pick(lazy.tools, names(fixed.slice(0, 5))));
		expect(fixed.slice(5)).toEqual(pick(individual.tools, names(fixed.slice(5))));
		const firstClass = hybrid.tools.slice(8);
		expect(names(firstClass)).toEqual(config.firstClassTools);
		expect(firstClass).toEqual(pick(individual.tools, config.firstClassTools ?? []));
		// The individual tool for a confirm-gated command advertises `confirm`, and so does this one.
		expect(JSON.stringify(firstClass[1]?.inputSchema)).toContain('"confirm"');
		expect(firstClass[1]?.annotations).toMatchObject({ destructiveHint: true });
	});

	it('keeps a first-class command listed outside its context and refuses its call there', async () => {
		const base = await serve(optionsFor(config));
		const inReview = await modernList(base, 'review');
		expect(names(inReview.tools)).toContain('plan-draft');
		const denied = await modernCall(base, 'plan-draft', {}, 'review');
		expect(denied.error).toMatchObject({
			code: 'COMMAND_NOT_IN_CONTEXT',
			suggestion: 'Use afd-context-list to see available contexts, or afd-context-enter to switch.',
		});
		// afd-discover and afd-detail keep filtering by the active context.
		const found = await modernCall(base, 'afd-discover', { limit: 200 }, 'review');
		const discovered = ((found.data?.commands ?? []) as Array<{ name: string }>).map((c) => c.name);
		expect(discovered).not.toContain('plan-draft');
		expect(discovered).toContain('review-approve');
	});

	it('keeps the default ttlMs under contexts, and honours toolsListTtlMs', async () => {
		const defaulted = await modernList(await serve(optionsFor(config)));
		expect(defaulted.ttlMs).toBe(300_000);
		const set = await modernList(await serve(optionsFor({ ...config, toolsListTtlMs: 0 })));
		expect(set.ttlMs).toBe(0);
		// Contexts still make the other strategies' lists stale by default.
		const lazy = await modernList(
			await serve(optionsFor({ ...config, toolStrategy: 'lazy', firstClassTools: undefined }))
		);
		expect(lazy.ttlMs).toBe(0);
	});

	it('advertises the hybrid instructions on server/discover', async () => {
		const base = await serve(optionsFor(config));
		const { result } = await modern(base, 'server/discover', { _meta: META });
		expect(result?.instructions).toContain(
			'The command tools listed are the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to run one.'
		);
		expect(result?.instructions).toContain(
			'afd-help, afd-docs and afd-schema describe this server.'
		);
		expect(result?.instructions).toContain('afd-context-list');
	});
});

describe('calls (H7)', () => {
	const config: ServerConfig = {
		toolStrategy: 'hybrid',
		firstClassTools: ['note-delete', 'note-list'],
		contexts: true,
		bootstrap: true,
		confirmations: 'enforce',
	};

	it('asks for the confirm acknowledgement on a first-class tool, like the individual strategy', async () => {
		const base = await serve(optionsFor(config));
		const refused = await modernCall(base, 'note-delete');
		expect(refused.error?.code).toBe('CONFIRMATION_REQUIRED');
		expect(refused.error?.suggestion).toContain('confirm: true');
		const confirmed = await modernCall(base, 'note-delete', { confirm: true });
		expect(confirmed.success).toBe(true);
	});

	it('runs an unlisted exposed command by name and through afd-call, afd-batch and afd-pipe', async () => {
		const base = await serve(optionsFor(config));
		expect((await modernCall(base, 'tag-add', { n: 1 })).data).toEqual({ n: 1 });
		const viaCall = await modernCall(base, 'afd-call', { command: 'tag-add', input: { n: 2 } });
		expect(viaCall.data).toEqual({ n: 2 });
		const batch = await modernCall(base, 'afd-batch', {
			commands: [{ command: 'tag-add', input: { n: 3 } }, { command: 'note-list' }],
		});
		expect(batch.success).toBe(true);
		const pipe = await modernCall(base, 'afd-pipe', {
			steps: [{ command: 'tag-add', input: { n: 4 } }, { command: 'note-list' }],
		});
		expect((pipe as unknown as { steps: unknown[] }).steps).toHaveLength(2);
	});

	it('answers an unknown and a private name the same way, ending with afd-discover', async () => {
		const base = await serve(optionsFor(config));
		const unknown = await modernCall(base, 'note-archive');
		const priv = await modernCall(base, 'admin-reset');
		expect(unknown.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(priv.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(unknown.error?.suggestion).toMatch(/Use afd-discover to list all commands\.$/);
		expect(priv.error?.suggestion).toMatch(/Use afd-discover to list all commands\.$/);
	});

	it('serves a 2025-era session the same calls', async () => {
		const base = await serve(optionsFor(config));
		const session = await legacySession(base);
		expect((await session.call('note-list')).success).toBe(true);
		expect((await session.call('note-delete')).error?.code).toBe('CONFIRMATION_REQUIRED');
		expect((await session.call('tag-add')).success).toBe(true);
		await session.call('afd-context-enter', { context: 'review' });
		const inReview = await session.call('afd-call', { command: 'plan-draft' });
		expect(inReview.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
	});
});

describe('a growing command set (acceptance)', () => {
	const bulk = (count: number) =>
		Array.from({ length: count }, (_, i) =>
			toCommand({
				name: `bulk-${String(i).padStart(3, '0')}`,
				description: `Bulk command ${i}`,
				expose: { mcp: true },
			})
		);

	it('leaves tools/list byte-identical when a 101st command is registered, and reaches it', async () => {
		const config: ServerConfig = {
			toolStrategy: 'hybrid',
			firstClassTools: ['bulk-000', 'bulk-001', 'bulk-002'],
			contexts: true,
		};
		const small = await serve(optionsFor(config, bulk(100)));
		const large = await serve(optionsFor(config, bulk(101)));

		const before = await modernList(small);
		expect(before.tools).toHaveLength(11);
		expect(before.ttlMs).toBe(300_000);
		const after = await modernList(large);
		expect(JSON.stringify(after.tools)).toBe(JSON.stringify(before.tools));
		expect(JSON.stringify((await modernList(large, 'review')).tools)).toBe(
			JSON.stringify(before.tools)
		);

		const discovered = await modernCall(large, 'afd-discover', { search: 'bulk-100' });
		expect(
			((discovered.data?.commands ?? []) as Array<{ name: string }>).map((c) => c.name)
		).toEqual(['bulk-100']);
		expect((await modernCall(large, 'afd-call', { command: 'bulk-100' })).success).toBe(true);
		expect((await modernCall(large, 'bulk-100')).success).toBe(true);
	});
});

describe('afd-help (H8)', () => {
	const help = async (config: ServerConfig, args: Record<string, unknown> = {}) => {
		const base = await serve(optionsFor({ ...config, bootstrap: true }));
		return (await modernCall(base, 'afd-call', { command: 'afd-help', input: args })).data as {
			toolStrategy?: string;
			firstClassTools?: string[];
			commands: Array<{ name: string; firstClass?: boolean }>;
		};
	};

	it.each(['individual', 'grouped', 'lazy'] as const)(
		'reports toolStrategy %s and nothing hybrid-only',
		async (toolStrategy) => {
			const data = await help({ toolStrategy });
			expect(data.toolStrategy).toBe(toolStrategy);
			expect('firstClassTools' in data).toBe(false);
			expect(data.commands.some((command) => 'firstClass' in command)).toBe(false);
		}
	);

	it.each(['brief', 'full'] as const)(
		'reports the first-class set in list order and marks its commands (%s)',
		async (format) => {
			const data = await help(
				{ toolStrategy: 'hybrid', firstClassTools: ['tag-list', 'note-list'] },
				{ format }
			);
			expect(data.toolStrategy).toBe('hybrid');
			expect(data.firstClassTools).toEqual(['tag-list', 'note-list']);
			const marked = data.commands.filter((command) => command.firstClass).map((c) => c.name);
			expect(marked.sort()).toEqual(['note-list', 'tag-list']);
			expect(data.commands.find((c) => c.name === 'note-add')).not.toHaveProperty('firstClass');
		}
	);

	it('is itself callable as a first-class tool', async () => {
		const base = await serve(
			optionsFor({ toolStrategy: 'hybrid', firstClassTools: ['afd-help'], bootstrap: true })
		);
		const data = (await modernCall(base, 'afd-help')).data as { firstClassTools: string[] };
		expect(data.firstClassTools).toEqual(['afd-help']);
	});
});
