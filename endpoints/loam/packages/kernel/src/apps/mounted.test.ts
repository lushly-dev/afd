import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ManifestV1, ProjectionV2 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { createKernelParts } from '../kernel.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	type KernelReplayReport,
	nestedReplay,
	replayKernel,
} from '../testing.js';
import type {
	AppInstanceV1,
	KernelPortsV1,
	LoamKernelV2,
	McpToolCallResult,
	MountTransportV2,
} from '../types.js';
import {
	AUTO_DISCOVERY_MS,
	boundRecorded,
	createMountedHost,
	DISCOVERY_LIMITS,
	discoverInstance,
	flagsOf,
	parseMountedResult,
	pinMountedInput,
	RECORDED_RESULT_MAX_BYTES,
	unlistedProject,
} from './mounted.js';
import type { AppRecord } from './operations.js';
import type { AppsHost } from './types.js';

const umbelManifest = (extra: Record<string, unknown> = {}): ManifestV1 =>
	({
		manifest_version: 1,
		protocol: 1,
		plugin: {
			id: 'umbel',
			title: 'Umbel',
			version: '0.1.0',
			description: 'An Umbel host, for these tests.',
			kind: 'mounted',
			domains: ['umbel'],
		},
		mount: { prefix: 'umbel', transport: 'http', ...extra },
	}) as ManifestV1;

interface FakeCommand {
	mutation?: boolean;
	destructive?: boolean;
	approval?: string;
	title?: unknown;
	description?: unknown;
	callable?: boolean;
	found?: boolean;
	inputSchema?: unknown;
}

/** A server as discovery and calls see it: `afd-help` and `afd-detail`, and an answer per tool. */
function fakeTransport(
	commands: Record<string, FakeCommand>,
	options: {
		firstClass?: string[];
		answer?: (tool: string, args: unknown) => McpToolCallResult | Promise<McpToolCallResult>;
		help?: () => McpToolCallResult | Promise<McpToolCallResult>;
	} = {}
) {
	const calls: Array<{ tool: string; args: unknown }> = [];
	/** Each request's `_meta`, by tool, kept apart so `calls` reads as phase 1's tests wrote it. */
	const metas: Array<{ tool: string; meta: Record<string, unknown> | undefined }> = [];
	let closed = 0;
	const asResult = (body: unknown): McpToolCallResult => ({ structuredContent: body });
	const transport: MountTransportV2 & {
		calls: typeof calls;
		metas: typeof metas;
		readonly closed: number;
	} = {
		calls,
		metas,
		get closed() {
			return closed;
		},
		connect: async () => ({ protocolVersion: '2025-11-25' }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args, _signal, meta) {
			calls.push({ tool, args });
			metas.push({ tool, meta });
			if (tool === 'afd-help') {
				if (options.help) return options.help();
				return asResult({
					success: true,
					data: {
						toolStrategy: 'hybrid',
						firstClassTools: options.firstClass ?? [],
						commands: Object.keys(commands).map((name) => ({ name })),
					},
				});
			}
			if (tool === 'afd-detail') {
				const asked = (args as { command: string[] }).command;
				return asResult({
					success: true,
					data: asked.map((name) => ({
						name,
						found: true,
						callable: true,
						description: `Runs ${name}`,
						inputSchema: { type: 'object', properties: { space: { type: 'string' } } },
						...commands[name],
					})),
				});
			}
			if (options.answer) return options.answer(tool, args);
			return asResult({ success: true, data: { tool, args } });
		},
		async close() {
			closed++;
		},
	};
	return transport;
}

const BASE = { instance: 'work', app: 'umbel', package: 'apps/work/' };
const work = (extra: Record<string, unknown> = {}) => ({
	...BASE,
	prefix: 'work',
	audience: 'person',
	transport: 'http',
	route: 'mounts/work/mcp',
	...extra,
});

async function boot(
	transports: Record<string, (url: string) => Promise<MountTransportV2> | MountTransportV2>,
	entries: Array<Record<string, unknown>> = [work()],
	options: { manifest?: ManifestV1; clock?: () => number; held?: Promise<void> } = {}
) {
	const packages = Object.fromEntries(
		entries.map(({ instance }) => [
			`apps/${String(instance)}/`,
			{ manifest: options.manifest ?? umbelManifest() },
		])
	);
	const asked: string[] = [];
	const ports: KernelPortsV1 = {
		...createFixturePorts(packages),
		async mountTransport(entry, url) {
			asked.push(url);
			const make = transports[entry.instance];
			if (!make) throw new Error('No transport');
			return make(url);
		},
	};
	const journal = new MemoryJournalSink();
	const deployment = {
		deployment_version: 2,
		generation: 'test',
		workspace: { id: 'personal', name: 'Personal' },
		sandbox_origin: null,
		apps: entries,
	} as ProjectionV2;
	const parts = await createKernelParts({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		// With `held`, a boot kernel whose stage B waits for it, so calls queue behind it (2.2).
		...(options.held
			? {
					boot: {
						generation: 'test',
						workspace: { id: 'personal', name: 'Personal' },
						apps: entries.map(({ instance }) => ({
							instance: String(instance),
							app: 'umbel',
							title: String(instance),
							kind: 'mounted' as const,
							icon: 'system/folder',
							order: 100,
							scopeLevels: ['workspace' as const],
							rail: true,
							parts: [],
							layout: {},
							refusal: null,
						})),
					},
					appsLoader: async () => {
						await options.held;
						return { deployment, ports };
					},
				}
			: { deployment, ports }),
		...(options.clock ? { clock: options.clock } : {}),
	});
	return { ...parts, journal, deployment, packages, asked };
}

async function instance(kernel: LoamKernelV2, name = 'work'): Promise<AppInstanceV1 | undefined> {
	const { data } = await kernel.call<{ instances: AppInstanceV1[] }>('app-instance-list');
	return data?.instances.find((row) => row.instance === name);
}

describe('discoverInstance (7.3)', () => {
	it('reads afd-help and afd-detail, drops afd-*, and renames by the rule', async () => {
		const transport = fakeTransport({
			'hello-greet': {},
			'umbel-status': {},
			'afd-help': {},
			'afd-detail': {},
		});
		const catalog = await discoverInstance(work(), umbelManifest(), transport);
		expect(catalog.commands.map(({ name }) => name)).toEqual(['work-hello-greet', 'work-status']);
		expect(catalog.toolStrategy).toBe('hybrid');
		expect(catalog.protocolVersion).toBe('2025-11-25');
		expect(transport.calls[0]).toEqual({ tool: 'afd-help', args: { format: 'full' } });
	});

	it('never lists tools: the SDK would run what a listed outputSchema says, in the page', async () => {
		const catalog = await discoverInstance(work(), umbelManifest(), fakeTransport({ 'a-b': {} }));
		expect(catalog.commands).toHaveLength(1);
	});

	it('asks afd-detail ten names at a time', async () => {
		const many = Object.fromEntries(
			Array.from({ length: 23 }, (_, index) => [`tool-n${index}`, {}])
		);
		const transport = fakeTransport(many);
		const catalog = await discoverInstance(work(), umbelManifest(), transport);
		expect(catalog.commands).toHaveLength(23);
		const details = transport.calls
			.filter(({ tool }) => tool === 'afd-detail')
			.map(({ args }) => (args as { command: string[] }).command.length);
		expect(details).toEqual([10, 10, 3]);
	});

	it('takes only `mount.only`, and replaces the manifest prefix with the instance prefix', async () => {
		const catalog = await discoverInstance(
			{ ...BASE, prefix: 'hello' },
			umbelManifest({ prefix: 'hello', only: ['hello-greet'] }),
			fakeTransport({ 'hello-greet': {}, 'workspace-show': {} })
		);
		expect(catalog.commands.map(({ name }) => name)).toEqual(['hello-greet']);
	});

	it('drops callable: false quietly, warns on found: false, and reports a tool with no name', async () => {
		const catalog = await discoverInstance(
			work(),
			umbelManifest(),
			fakeTransport({
				'closed-one': { callable: false },
				'gone-one': { found: false },
				'!!!': {},
			})
		);
		expect(catalog.commands).toEqual([]);
		expect(catalog.warnings.map(({ code }) => code)).toEqual([
			'MOUNT_TOOL_UNNAMEABLE',
			'MOUNT_TOOL_UNNAMEABLE',
		]);
	});

	it('warns on an override that names no command', async () => {
		const catalog = await discoverInstance(
			work({ commands: { 'work-nothing': { expose: { palette: true } } } }),
			umbelManifest(),
			fakeTransport({ 'a-b': {} })
		);
		expect(catalog.warnings.map(({ code }) => code)).toEqual(['INSTANCE_OVERRIDE_UNKNOWN']);
	});

	it('reads each field for what it is: a server may send anything', async () => {
		const catalog = await discoverInstance(
			work(),
			umbelManifest(),
			fakeTransport({
				'odd-one': {
					title: { create: 'not text' },
					description: 42,
					inputSchema: { type: 'string' },
					approval: 'maybe',
				},
				'no-type': { inputSchema: { anyOf: [{ type: 'object' }] } },
			})
		);
		const [odd, typeless] = catalog.commands;
		expect(odd?.title).toBeUndefined();
		expect(odd?.description).toBe('');
		expect(odd?.inputSchema).toEqual({ type: 'object' });
		expect(odd?.approval).toBeUndefined();
		expect(typeless?.inputSchema).toEqual({ type: 'object', anyOf: [{ type: 'object' }] });
	});
});

describe('7.4: exposure and trust', () => {
	const none = { expose: {} };
	const off = { palette: false, agent: false };
	const on = { palette: true, agent: true };

	it('exposes what reports no mutation, and takes defaults from the entry', () => {
		expect(flagsOf({ mutation: false }, undefined, none, undefined).expose).toEqual(on);
		expect(
			flagsOf({ mutation: false }, undefined, { expose: { agent: false } }, undefined).expose
		).toEqual({ palette: true, agent: false });
	});

	it('hides a mutation, an unreported command and a destructive one until named', () => {
		for (const reported of [{ mutation: true }, {}, { mutation: false, destructive: true }]) {
			expect(flagsOf(reported, undefined, none, undefined).expose).toEqual(off);
		}
		expect(
			flagsOf({ mutation: true }, undefined, none, { expose: { palette: true } }).expose
		).toEqual({ palette: true, agent: false });
		expect(flagsOf({ mutation: true }, undefined, none, { effects: ['external'] }).expose).toEqual(
			off
		);
	});

	it('keeps a named command hidden on every flag the entry left out, whatever the server says', () => {
		expect(flagsOf({ mutation: false }, undefined, none, {}).expose).toEqual(off);
	});

	it('takes the server first, then the manifest, then the entry', () => {
		expect(flagsOf({ mutation: true }, ['inspect'], none, undefined).mutation).toBe(true);
		expect(flagsOf({}, ['inspect'], none, undefined).mutation).toBe(false);
		expect(flagsOf({}, undefined, none, { effects: ['inspect'] }).mutation).toBe(false);
		expect(flagsOf({}, undefined, none, undefined).mutation).toBe(true);
	});

	it("never lets a server's claim of no mutation beat a deployer who says it is one", () => {
		const manifest = flagsOf({ mutation: false }, ['external'], none, undefined);
		expect(manifest.mutation).toBe(true);
		expect(manifest.expose).toEqual(off);
		expect(
			flagsOf({ mutation: false }, undefined, none, { effects: ['store-write'] }).mutation
		).toBe(true);
		expect(
			flagsOf({ destructive: false }, undefined, none, { destructive: true }).destructive
		).toBe(true);
	});

	it('gives a mounted command no surface beyond palette and agent', async () => {
		const parts = await boot({ work: () => fakeTransport({ 'a-read': { mutation: false } }) });
		await parts.kernel.startInstances();
		const { kernel } = parts;
		expect(kernel.listCommands().map(({ name }) => name)).toContain('work-a-read');
		expect(kernel.agent.listCommands().map(({ name }) => name)).toContain('work-a-read');
		// A server has no way to say otherwise: the definition's `expose` is the deployer's.
		const flags = await boot({
			work: () =>
				fakeTransport({
					'a-read': { mutation: false, expose: { mcp: true, cli: true } } as FakeCommand,
				}),
		});
		await flags.kernel.startInstances();
		expect((await flags.kernel.call('work-a-read', {})).metadata?.['dev.loam/trust']).toBe(
			'untrusted'
		);
	});

	it('holds a mutation away from a person and an agent until the entry names it', async () => {
		const hidden = await boot({ work: () => fakeTransport({ 'a-write': { mutation: true } }) });
		await hidden.kernel.startInstances();
		expect((await hidden.kernel.call('work-a-write')).error?.code).toBe('COMMAND_NOT_EXPOSED');
		expect((await hidden.kernel.agent.call('work-a-write')).error?.code).toBe(
			'COMMAND_NOT_EXPOSED'
		);
		expect((await instance(hidden.kernel))?.hidden).toBe(1);
		const { data } = await hidden.kernel.call<{ hidden: number; commands: unknown[] }>(
			'app-command-list',
			{ instance: 'work' }
		);
		expect(data?.hidden).toBe(1);
		expect(data?.commands).toEqual([]);

		const named = await boot({ work: () => fakeTransport({ 'a-write': { mutation: true } }) }, [
			work({ commands: { 'work-a-write': { expose: { palette: true } } } }),
		]);
		await named.kernel.startInstances();
		expect((await named.kernel.call('work-a-write')).success).toBe(true);
		expect((await named.kernel.agent.call('work-a-write')).error?.code).toBe('COMMAND_NOT_EXPOSED');
	});

	it('displays a reported approval on the row', async () => {
		const { kernel } = await boot({
			work: () => fakeTransport({ 'a-read': { mutation: false, approval: 'required' } }),
		});
		await kernel.startInstances();
		const { data } = await kernel.call<{ commands: Array<{ approval?: string; replay?: string }> }>(
			'app-command-list',
			{ instance: 'work' }
		);
		expect(data?.commands[0]).toMatchObject({ approval: 'required', replay: 'recorded' });
	});
});

describe('parseMountedResult (7.3)', () => {
	it('takes structuredContent, else the text, and labels the result', () => {
		const shaped = parseMountedResult({ structuredContent: { success: true, data: 1 } }, 'work');
		expect(shaped.data).toBe(1);
		expect(shaped.metadata).toMatchObject({
			'dev.loam/trust': 'untrusted',
			'dev.loam/instance': 'work',
			'dev.loam/replay': 'recorded',
		});
		const texted = parseMountedResult(
			{ content: [{ type: 'text', text: '{"success":true,"data":2}' }] },
			'work'
		);
		expect(texted.data).toBe(2);
	});

	it.each([
		[{ content: [{ type: 'text', text: 'not json' }] }],
		[{ structuredContent: 'text' }],
		[{ structuredContent: { success: 'yes' } }],
		[{ structuredContent: { success: false } }],
		[{ structuredContent: { success: false, error: { code: 1, message: 'no' } } }],
		[{}],
	])('fails what is not a CommandResult: %j', (given) => {
		expect(parseMountedResult(given as McpToolCallResult, 'work').error?.code).toBe(
			'MOUNT_RESULT_INVALID'
		);
	});

	it("keeps the server's own labels, and drops any mark only the kernel may set", () => {
		const { metadata, error } = parseMountedResult(
			{
				structuredContent: {
					success: false,
					error: {
						code: 'NOPE',
						message: 'No',
						details: { 'dev.loam/page-decided': true, kept: 1 },
					},
					metadata: {
						'dev.umbel/trust': 'external',
						'dev.umbel/replay': 'recorded',
						'dev.loam/trust': 'trusted',
						'dev.loam/instance': 'shell',
						'dev.loam/seq': 999,
					},
				},
			},
			'work'
		);
		expect(metadata).toEqual({
			'dev.umbel/trust': 'external',
			'dev.umbel/replay': 'recorded',
			'dev.loam/trust': 'untrusted',
			'dev.loam/instance': 'work',
			'dev.loam/replay': 'recorded',
		});
		expect(error?.details).toEqual({ kept: 1 });
	});
});

describe('pinMountedInput (7.5)', () => {
	const entry = { space: { atlas: 'atlas', borealis: 'default' } };
	const schema = { type: 'object', properties: { space: { type: 'string' } } };

	it('leaves the input alone with no project, or no mapping', () => {
		expect(pinMountedInput(entry, null, schema, { space: 'other' })).toEqual({
			ok: true,
			input: { space: 'other' },
		});
		expect(pinMountedInput(entry, { project: 'other' }, schema, { space: 'x' })).toEqual({
			ok: true,
			input: { space: 'x' },
		});
		expect(pinMountedInput({}, { project: 'atlas' }, schema, {})).toEqual({ ok: true, input: {} });
	});

	it('sets a mapped space on a schema that has one', () => {
		expect(pinMountedInput(entry, { project: 'atlas' }, schema, { name: 'Ada' })).toEqual({
			ok: true,
			input: { name: 'Ada', space: 'atlas' },
		});
		expect(pinMountedInput(entry, { project: 'atlas' }, schema, { space: 'atlas' })).toEqual({
			ok: true,
			input: { space: 'atlas' },
		});
	});

	it('leaves a schema with no `space` alone', () => {
		expect(pinMountedInput(entry, { project: 'atlas' }, { type: 'object' }, { a: 1 })).toEqual({
			ok: true,
			input: { a: 1 },
		});
	});

	it.each([[{ space: 'other' }], [{ spaces: ['atlas'] }]])('refuses %j', (input) => {
		const pinned = pinMountedInput(entry, { project: 'atlas' }, schema, input);
		expect(pinned.ok).toBe(false);
		if (pinned.ok) return;
		expect(pinned.result.error?.code).toBe('MOUNT_SPACE_PINNED');
		expect(pinned.result.error?.message).toContain('atlas');
	});

	it('takes a mapping by its own key alone', () => {
		expect(pinMountedInput(entry, { project: 'constructor' }, schema, {})).toEqual({
			ok: true,
			input: {},
		});
	});
});

describe('a mounted call', () => {
	it('sends a first-class tool by its name, and any other through afd-call, never setting confirm', async () => {
		const transport = fakeTransport(
			{ 'a-first': { mutation: false }, 'a-other': { mutation: false } },
			{ firstClass: ['a-first'] }
		);
		const { kernel } = await boot({ work: () => transport });
		await kernel.startInstances();
		await kernel.call('work-a-first', { x: 1 });
		await kernel.call('work-a-other', { x: 2 });
		const sent = transport.calls.filter(({ tool }) => !['afd-help', 'afd-detail'].includes(tool));
		expect(sent).toEqual([
			{ tool: 'a-first', args: { x: 1 } },
			{ tool: 'afd-call', args: { command: 'a-other', input: { x: 2 } } },
		]);
	});

	it('keeps an input the schema does not name: the server validates', async () => {
		const transport = fakeTransport({ 'a-read': { mutation: false } }, { firstClass: ['a-read'] });
		const { kernel } = await boot({ work: () => transport });
		await kernel.startInstances();
		const result = await kernel.call('work-a-read', { other: true });
		expect(result.success).toBe(true);
		expect(transport.calls.at(-1)?.args).toEqual({ other: true });
	});

	it('journals its fields and the result, with its seq on the answer', async () => {
		const { kernel, journal } = await boot({
			work: () => fakeTransport({ 'a-read': { mutation: false } }),
		});
		await kernel.startInstances();
		const result = await kernel.call('work-a-read', {});
		const entries = await journal.read();
		const entry = entries.find(({ command }) => command === 'work-a-read');
		expect(entry?.context).toEqual({
			app: 'umbel',
			instance: 'work',
			replay: 'recorded',
			scope: { workspace: 'personal' },
		});
		expect(result.metadata?.['dev.loam/seq']).toBe(entry?.seq);
		const refresh = entries.find(({ command }) => command === 'app-instance-refresh');
		expect(refresh?.context).toMatchObject({ instance: 'work', replay: 'recorded' });
		expect(
			(refresh?.result.data as { catalog: { commands: unknown[] } } | undefined)?.catalog.commands
		).toHaveLength(1);
	});

	it('answers a transport that fails with its code, and none of its text', async () => {
		const secret = 'the token is in /srv/keys/http.token';
		const transport = fakeTransport(
			{ 'a-read': { mutation: false } },
			{
				firstClass: ['a-read'],
				answer: () => Promise.reject(new Error(secret)),
			}
		);
		const { kernel, journal } = await boot({ work: () => transport });
		await kernel.startInstances();
		const result = await kernel.call('work-a-read', {});
		expect(result.error?.code).toBe('MOUNT_UNREACHABLE');
		expect(JSON.stringify(await journal.read())).not.toContain('http.token');
		expect(JSON.stringify(result)).not.toContain('http.token');
	});

	it('discovers again once on COMMAND_NOT_FOUND, at most once in 30 seconds, and returns the failure', async () => {
		let now = 1_000_000;
		const notFound: McpToolCallResult = {
			structuredContent: {
				success: false,
				error: { code: 'COMMAND_NOT_FOUND', message: 'Gone', suggestion: 'afd-discover' },
			},
		};
		const transport = fakeTransport({ 'a-read': { mutation: false } }, { answer: () => notFound });
		const { kernel, journal } = await boot({ work: () => transport }, [work()], {
			clock: () => now,
		});
		await kernel.startInstances();
		const refreshes = async () =>
			(await journal.read()).filter(({ command }) => command === 'app-instance-refresh').length;
		expect(await refreshes()).toBe(1);
		const first = await kernel.call('work-a-read', {});
		expect(first.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(await refreshes()).toBe(2);
		now += AUTO_DISCOVERY_MS - 1;
		await kernel.call('work-a-read', {});
		expect(await refreshes()).toBe(2);
		now += 1;
		await kernel.call('work-a-read', {});
		expect(await refreshes()).toBe(3);
	});

	it('takes its own refresh past the queue when the call it answers is queued behind stage B', async () => {
		const notFound: McpToolCallResult = {
			structuredContent: {
				success: false,
				error: { code: 'COMMAND_NOT_FOUND', message: 'Gone', suggestion: 'afd-discover' },
			},
		};
		const transport = fakeTransport({ 'a-read': { mutation: false } }, { answer: () => notFound });
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { kernel, journal } = await boot({ work: () => transport }, [work()], {
			clock: () => 1_000_000,
			held,
		});
		// Both queue behind stage B: discovery first, then the call, whose answer asks for a refresh.
		const discovered = kernel.call('app-instance-refresh', { instance: 'work' });
		const read = kernel.call('work-a-read', {});
		release();
		expect((await discovered).success).toBe(true);
		// The handler's own refresh is unqueued: queued, it would wait behind this call for ever.
		expect((await read).error?.code).toBe('COMMAND_NOT_FOUND');
		expect(
			(await journal.read()).filter(({ command }) => command === 'app-instance-refresh')
		).toHaveLength(2);
	}, 5_000);

	it('bounds a recorded result in the journal, and returns it whole', async () => {
		const big = 'x'.repeat(RECORDED_RESULT_MAX_BYTES + 10);
		const { kernel, journal } = await boot({
			work: () =>
				fakeTransport(
					{ 'a-read': { mutation: false } },
					{ answer: () => ({ structuredContent: { success: true, data: { big } } }) }
				),
		});
		await kernel.startInstances();
		const result = await kernel.call<{ big: string }>('work-a-read', {});
		expect(result.data?.big).toHaveLength(big.length);
		const entry = (await journal.read()).find(({ command }) => command === 'work-a-read');
		expect(entry?.result.data).toEqual({ truncated: true, bytes: expect.any(Number) });
		expect(entry?.result.success).toBe(true);
		expect(entry?.result.metadata?.['dev.loam/trust']).toBe('untrusted');
	});

	it('leaves a record under the bound, and any other entry, unchanged', () => {
		const record = {
			at: 0,
			command: 'work-a-read',
			input: {},
			result: { success: true, data: { a: 1 } },
			context: { replay: 'recorded' },
		} as unknown as Parameters<typeof boundRecorded>[0];
		expect(boundRecorded(record)).toBe(record);
	});
});

describe('app-instance-refresh (7.3)', () => {
	it('fails with MOUNT_NOT_AFD on a server with no afd-help', async () => {
		const { kernel } = await boot({
			work: () =>
				fakeTransport(
					{},
					{
						help: () => ({
							structuredContent: {
								success: false,
								error: { code: 'COMMAND_NOT_FOUND', message: 'no' },
							},
						}),
					}
				),
		});
		await kernel.startInstances();
		const row = await instance(kernel);
		expect(row?.state).toBe('failed');
		expect(row?.error?.code).toBe('MOUNT_NOT_AFD');
		expect(row?.error?.suggestion).toContain('phase 5');
	});

	it('names a transport that refuses as MOUNT_UNAUTHORIZED', async () => {
		const { kernel } = await boot({
			work: () => ({
				...fakeTransport({}),
				connect: () =>
					Promise.reject(Object.assign(new Error('secret'), { code: 'MOUNT_UNAUTHORIZED' })),
			}),
		});
		await kernel.startInstances();
		const row = await instance(kernel);
		expect(row?.error?.code).toBe('MOUNT_UNAUTHORIZED');
		expect(JSON.stringify(row)).not.toContain('secret');
	});

	it('keeps the last good commands on a failure, whose calls say why, and recovers', async () => {
		let up = true;
		const make = () => {
			const live = fakeTransport({ 'a-read': { mutation: false } });
			return {
				...live,
				connect: () => (up ? live.connect() : Promise.reject(new TypeError('fetch failed'))),
			};
		};
		const { kernel } = await boot({ work: make });
		await kernel.startInstances();
		expect((await instance(kernel))?.state).toBe('ready');
		up = false;
		const failed = await kernel.call('app-instance-refresh', { instance: 'work' });
		expect(failed.error?.code).toBe('MOUNT_UNREACHABLE');
		const row = await instance(kernel);
		expect(row?.state).toBe('failed');
		expect(row?.commands).toBe(1);
		expect(kernel.listCommands().map(({ name }) => name)).toContain('work-a-read');
		const during = await kernel.call('work-a-read', {});
		expect(during.error?.code).toBe('MOUNT_UNREACHABLE');
		up = true;
		expect((await kernel.call('app-instance-refresh', { instance: 'work' })).success).toBe(true);
		expect((await instance(kernel))?.state).toBe('ready');
		expect((await instance(kernel))?.error).toBeUndefined();
		expect((await kernel.call('work-a-read', {})).success).toBe(true);
	});

	it('unregisters a command that disappears, and closes the transport it replaces', async () => {
		const commands: Record<string, FakeCommand> = {
			'a-read': { mutation: false },
			'a-gone': { mutation: false },
		};
		const transports: Array<ReturnType<typeof fakeTransport>> = [];
		const { kernel } = await boot({
			work: () => {
				const next = fakeTransport({ ...commands });
				transports.push(next);
				return next;
			},
		});
		await kernel.startInstances();
		expect(kernel.listCommands().map(({ name }) => name)).toContain('work-a-gone');
		delete commands['a-gone'];
		await kernel.call('app-instance-refresh', { instance: 'work' });
		const names = kernel.listCommands().map(({ name }) => name);
		expect(names).toContain('work-a-read');
		expect(names).not.toContain('work-a-gone');
		expect((await instance(kernel))?.commands).toBe(1);
		expect(transports[0]?.closed).toBe(1);
		expect(transports[1]?.closed).toBe(0);
	});

	it('leaves a conflict unregistered, with a warning, and the rest of the instance working', async () => {
		const { kernel } = await boot(
			{
				work: () => fakeTransport({ 'list-one': { mutation: false }, 'a-b': { mutation: false } }),
			},
			[work({ prefix: 'app' })],
			{}
		);
		// `app` is a shell domain, so that prefix is refused before discovery can reach the shell's names.
		expect((await instance(kernel))?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
		const shared = await boot({
			work: () =>
				fakeTransport({
					'same-name': { mutation: false },
					Same_Name: { mutation: false },
					'other-name': { mutation: false },
				}),
		});
		await shared.kernel.startInstances();
		const row = await instance(shared.kernel);
		expect(row?.state).toBe('ready');
		// Neither: a server may not choose which of two the deployer's words apply to.
		expect(row?.commands).toBe(1);
		expect(row?.warnings.map(({ code }) => code)).toEqual([
			'APP_COMMAND_CONFLICT',
			'APP_COMMAND_CONFLICT',
		]);
		expect((await shared.kernel.call('work-same-name', {})).error?.code).toBe('COMMAND_NOT_FOUND');
		expect((await shared.kernel.call('work-other-name', {})).success).toBe(true);
	});

	it('shares one discovery between two asks, so two never race over the registries', async () => {
		let connects = 0;
		const { kernel } = await boot({
			work: () => {
				const live = fakeTransport({ 'a-read': { mutation: false } });
				return {
					...live,
					connect: () => {
						connects++;
						return live.connect();
					},
				};
			},
		});
		await Promise.all([kernel.startInstances(), kernel.startInstances()]);
		expect(connects).toBe(1);
	});

	it('uses the route under the base, so a transport has no other place to go', async () => {
		const { kernel, asked } = await boot({ work: () => fakeTransport({}) });
		await kernel.startInstances();
		expect(asked).toEqual(['https://shell.loam.test/mounts/work/mcp']);
	});

	it('lists an instance as loading before discovery, and fails stdio with no transport', async () => {
		const { kernel, asked } = await boot({ work: () => fakeTransport({}) }, [
			work(),
			{ ...BASE, instance: 'home', prefix: 'home', audience: 'person', transport: 'stdio' },
		]);
		expect((await instance(kernel))?.state).toBe('loading');
		expect((await instance(kernel, 'home'))?.error?.code).toBe('MOUNT_TRANSPORT_UNAVAILABLE');
		await kernel.startInstances();
		expect(asked).toHaveLength(1);
		expect((await instance(kernel, 'home'))?.state).toBe('failed');
	});

	it('reports nothing of a location or credential in what it lists', async () => {
		const { kernel, journal } = await boot({ work: () => fakeTransport({ 'a-b': {} }) });
		await kernel.startInstances();
		const row = (await instance(kernel)) as unknown as Record<string, unknown>;
		for (const key of ['url', 'route', 'bearer', 'bearer_file', 'command', 'cwd']) {
			expect(row).not.toHaveProperty(key);
		}
		expect(JSON.stringify(await journal.read())).not.toContain('bearer');
	});
});

describe('section 3.3: nothing writes an instance', () => {
	it('gives no shell command an input key for a location, a credential or a command line', async () => {
		const { registries } = await boot({ work: () => fakeTransport({}) });
		const offending = registries.palette
			.listCommands()
			.filter(({ name }) => !INTERNAL_COMMANDS.includes(name))
			.filter(({ inputSchema }) => {
				const properties = Object.keys(
					(inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
				);
				return properties.some((key) => /^(command|url|bearer.*|cwd)$/.test(key));
			})
			.map(({ name }) => name);
		expect(offending).toEqual([]);
	});
});

describe('7.6: replay with the server stopped', () => {
	it('answers each mounted entry from its record, and rebuilds the commands from the catalog', async () => {
		const { kernel, journal, deployment, packages } = await boot({
			work: () => fakeTransport({ 'a-read': { mutation: false } }),
		});
		await kernel.startInstances();
		await kernel.call('app-open', { instance: 'work' });
		await kernel.call('work-a-read', {});
		await kernel.agent.call('work-a-read', {});
		await kernel.call('app-command-list', { instance: 'work' });
		await kernel.call('layout-get');
		const entries: JournalEntry[] = await journal.read();
		const recordedSeqs = entries
			.filter(({ context }) => context?.replay === 'recorded')
			.map(({ seq }) => seq);
		const { report } = await replayKernel(entries, {
			deployment,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(recordedSeqs).toHaveLength(3);
		for (const seq of recordedSeqs) expect(report.recorded).toContain(seq);
	});

	it('replays a failed discovery and a call it refused, as they were', async () => {
		const { kernel, journal, deployment, packages } = await boot({
			work: () => Promise.reject(new TypeError('fetch failed')),
		});
		await kernel.startInstances();
		await kernel.call('app-instance-list');
		const entries = await journal.read();
		const { report } = await replayKernel(entries, {
			deployment,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.recorded.length).toBeGreaterThan(0);
	});
});

describe('what a hostile server cannot do with its size or its shape (9.9)', () => {
	const nested = (depth: number, wrap: (inner: unknown) => unknown, core: unknown = {}) => {
		let value = core;
		for (let level = 0; level < depth; level++) value = wrap(value);
		return value;
	};

	it('does not let a case variant dodge what a manifest says of a tool', async () => {
		const catalog = await discoverInstance(
			work(),
			umbelManifest({ tools: [{ tool: 'wipe', effects: ['external'] }] }),
			fakeTransport({ Wipe: { mutation: false } })
		);
		expect(catalog.commands[0]).toMatchObject({
			name: 'work-wipe',
			mutation: true,
			expose: { palette: false, agent: false },
		});
		const both = await discoverInstance(
			work(),
			umbelManifest({ tools: [{ tool: 'wipe', effects: ['external'] }] }),
			fakeTransport({ Wipe: { mutation: false }, wipe: { mutation: false } })
		);
		expect(both.commands).toEqual([]);
	});

	it.each([['AFD-call'], ['afd_call'], ['afd.detail'], [' afd-help'], ['Afd-Pipe']])(
		'treats %s as a meta-tool',
		async (name) => {
			const catalog = await discoverInstance(
				work(),
				umbelManifest(),
				fakeTransport({ [name]: { mutation: false }, 'afdish-ok': { mutation: false } })
			);
			expect(catalog.commands.map((command) => command.name)).toEqual(['work-afdish-ok']);
		}
	);

	it('does not register a schema too deep to read, and every list goes on working', async () => {
		const parts = await boot({
			work: () =>
				fakeTransport({
					'a-deep': {
						mutation: false,
						inputSchema: nested(10_000, (inner) => ({ anyOf: [inner] })),
					},
					'a-read': { mutation: false },
				}),
		});
		await parts.kernel.startInstances();
		const { kernel } = parts;
		const row = await instance(kernel);
		expect(row?.state).toBe('ready');
		expect(row?.commands).toBe(1);
		expect(row?.warnings.map(({ code }) => code)).toEqual(['MOUNT_SCHEMA_UNUSABLE']);
		expect(kernel.listCommands().map(({ name }) => name)).toContain('work-a-read');
		expect(kernel.agent.listCommands().map(({ name }) => name)).toContain('work-a-read');
		expect((await kernel.call('app-command-list', { instance: 'work' })).success).toBe(true);
	});

	it('does not register a schema too large, and cuts a title and a description', async () => {
		const catalog = await discoverInstance(
			work(),
			umbelManifest(),
			fakeTransport({
				'a-big': {
					mutation: false,
					inputSchema: {
						type: 'object',
						properties: { a: { description: 'x'.repeat(DISCOVERY_LIMITS.schemaBytes) } },
					},
				},
				'a-long': {
					mutation: false,
					title: 't'.repeat(1_000),
					description: 'd'.repeat(10_000),
				},
			})
		);
		expect(catalog.commands.map((command) => command.name)).toEqual(['work-a-long']);
		expect(catalog.commands[0]?.title).toHaveLength(DISCOVERY_LIMITS.titleChars);
		expect(catalog.commands[0]?.description).toHaveLength(DISCOVERY_LIMITS.descriptionChars);
	});

	it('keeps a catalog small enough to journal whole, so a replay always rebuilds it', async () => {
		const many = Object.fromEntries(
			Array.from({ length: 5_000 }, (_, index) => [
				`tool-n${index}`,
				{ mutation: false, description: 'd'.repeat(4_000) },
			])
		);
		const parts = await boot({ work: () => fakeTransport(many) });
		await parts.kernel.startInstances();
		const { data } = await parts.kernel.call<{ instances: AppInstanceV1[] }>('app-instance-list');
		const row = data?.instances[0];
		expect(row?.state).toBe('ready');
		expect(row?.commands).toBeGreaterThan(0);
		expect(row?.commands).toBeLessThanOrEqual(DISCOVERY_LIMITS.commands);
		expect(row?.warnings.map(({ code }) => code)).toContain('MOUNT_CATALOG_TOO_LARGE');
		expect(row?.warnings.length).toBeLessThanOrEqual(DISCOVERY_LIMITS.warnings);
		const entry = (await parts.journal.read()).find(
			({ command }) => command === 'app-instance-refresh'
		);
		expect((entry?.result.data as { catalog?: unknown } | undefined)?.catalog).toBeDefined();
		expect(JSON.stringify(entry?.result).length).toBeLessThan(RECORDED_RESULT_MAX_BYTES);
	});

	it('refuses a result too deep to journal, so no call runs with no entry', async () => {
		const deep = nested(20_000, (inner) => [inner]);
		const { kernel, journal } = await boot({
			work: () =>
				fakeTransport(
					{ 'a-read': { mutation: false } },
					{ answer: () => ({ structuredContent: { success: true, data: deep } }) }
				),
		});
		await kernel.startInstances();
		const result = await kernel.call('work-a-read', {});
		expect(result.error?.code).toBe('MOUNT_RESULT_INVALID');
		expect((await journal.read()).some(({ command }) => command === 'work-a-read')).toBe(true);
		expect(result.metadata?.['dev.loam/seq']).toEqual(expect.any(Number));
	});

	it('bounds a recorded entry in its error and metadata too', () => {
		const large = 'x'.repeat(RECORDED_RESULT_MAX_BYTES);
		const bounded = boundRecorded({
			command: 'work-a-read',
			input: {},
			context: { replay: 'recorded' },
			result: {
				success: false,
				error: { code: 'NOPE', message: large, suggestion: large, details: { large } },
				metadata: { 'dev.loam/trust': 'untrusted', 'dev.umbel/other': large },
			},
		} as never);
		expect(JSON.stringify(bounded).length).toBeLessThan(10_000);
		expect(bounded.result.error?.code).toBe('NOPE');
		expect(bounded.result.metadata).toEqual({ 'dev.loam/trust': 'untrusted' });
	});

	it('drops an error field no reader could print', () => {
		const { error } = parseMountedResult(
			{
				structuredContent: {
					success: false,
					error: { code: 'NOPE', message: 'No', suggestion: { toString: null }, retryable: 'yes' },
				},
			},
			'work'
		);
		expect(error).toEqual({ code: 'NOPE', message: 'No' });
	});
});

describe('P2-E3: (kernel unit) an instance that lists projects opens only in them (7.1, 9.1)', () => {
	it('is unavailable elsewhere, refuses app-open there, journaled, and leaves on a switch into one', async () => {
		const { kernel, journal } = await boot({ work: () => fakeTransport({}) }, [
			work({ projects: ['atlas'] }),
		]);
		const atlas = await kernel.call<{ id: string }>('project-create', { name: 'Atlas' });
		const beacon = await kernel.call<{ id: string }>('project-create', { name: 'Beacon' });
		const available = async () =>
			(await kernel.call<{ apps: Array<{ available: boolean }> }>('app-list')).data?.apps[0]
				?.available;
		expect(await available()).toBe(false);
		await kernel.call('scope-set', { project: beacon.data?.id });
		expect(await available()).toBe(false);
		const refused = await kernel.call('app-open', { instance: 'work' });
		expect(refused.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		expect((await journal.read()).at(-1)).toMatchObject({
			command: 'app-open',
			result: { success: false, error: { code: 'SCOPE_PROJECT_REQUIRED' } },
		});
		await kernel.call('scope-set', { project: atlas.data?.id });
		expect(await available()).toBe(true);
		expect((await kernel.call('app-open', { instance: 'work' })).success).toBe(true);
		const left = await kernel.call<{ app: string }>('scope-set', { project: beacon.data?.id });
		expect(left.data?.app).toBe('left');
		expect((await kernel.call<{ active: string | null }>('app-list')).data?.active).toBeNull();
		// scope-set { app } into a project it does not list is refused before any switch (N3).
		await kernel.call('scope-set', { project: atlas.data?.id });
		const into = await kernel.call('scope-set', { project: beacon.data?.id, app: 'work' });
		expect(into.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		expect(
			(await kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
		).toBe(atlas.data?.id);
		await kernel.dispose();
	});
});

/** The tool calls a command made, without discovery's meta-tools. */
const commandCalls = (transport: ReturnType<typeof fakeTransport>) =>
	transport.metas.filter(({ tool }) => !['afd-help', 'afd-detail'].includes(tool));

describe('P2-E6: (kernel unit) a mounted call carries its scope, and stays in its projects (9.2)', () => {
	async function scoped(entry: Record<string, unknown>) {
		const transport = fakeTransport(
			{ 'hello-greet': { mutation: false }, 'hello-whisper': { mutation: false } },
			{ firstClass: ['hello-greet'] }
		);
		const booted = await boot({ work: () => transport }, [work(entry)]);
		const atlas = await booted.kernel.call<{ id: string }>('project-create', { name: 'Atlas' });
		const beacon = await booted.kernel.call<{ id: string }>('project-create', { name: 'Beacon' });
		await booted.kernel.startInstances();
		return {
			...booted,
			transport,
			atlas: atlas.data?.id as string,
			beacon: beacon.data?.id as string,
		};
	}

	it('refuses a project its `projects` does not list, journaled, before any request', async () => {
		const { kernel, journal, transport, beacon } = await scoped({ projects: ['atlas'] });
		const before = transport.calls.length;
		const refused = await kernel.call(
			'work-hello-greet',
			{ name: 'Ada' },
			{
				scope: { workspace: 'personal', project: beacon },
			}
		);
		expect(refused.error).toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
			message: 'This instance does not serve the project `beacon`',
			suggestion: 'Switch to a project this instance serves: atlas',
		});
		expect(transport.calls.length).toBe(before);
		expect((await journal.read()).at(-1)).toMatchObject({
			command: 'work-hello-greet',
			context: { instance: 'work', replay: 'recorded', scope: { project: beacon } },
			result: { success: false, error: { code: 'MOUNT_PROJECT_NOT_LISTED' } },
		});
		// Through `afd-call` as well: the check is the instance's, before the tool is chosen.
		const lazy = await kernel.agent.call(
			'work-hello-whisper',
			{},
			{
				scope: { workspace: 'personal', project: beacon },
			}
		);
		expect(lazy.error?.code).toBe('MOUNT_PROJECT_NOT_LISTED');
		expect(transport.calls.length).toBe(before);
		await kernel.dispose();
	});

	it('refuses the workspace level by 3.4 line 3, which runs first, also before any request', async () => {
		const { kernel, transport } = await scoped({ projects: ['atlas'] });
		const before = transport.calls.length;
		const refused = await kernel.call('work-hello-greet', {}, { scope: 'workspace' });
		expect(refused.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		expect(transport.calls.length).toBe(before);
		await kernel.dispose();
	});

	it('answers no project, and an unlisted one, itself, naming only the slugs the caller may see', () => {
		const entry = { projects: ['atlas', 'borealis'] };
		const all = () => true;
		expect(unlistedProject(entry, undefined, all)?.error).toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
			message: 'This instance serves only its projects',
			suggestion: 'Switch to a project this instance serves: atlas, borealis',
		});
		expect(unlistedProject(entry, 'beacon', (slug) => slug === 'atlas')?.error).toMatchObject({
			message: 'This instance does not serve the project `beacon`',
			suggestion: 'Switch to a project this instance serves: atlas',
		});
		expect(unlistedProject(entry, 'beacon', () => false)?.error?.suggestion).toBe(
			'Switch to a project this instance serves'
		);
		expect(unlistedProject(entry, 'atlas', all)).toBeUndefined();
		expect(unlistedProject({}, undefined, all)).toBeUndefined();
		expect(unlistedProject({}, 'beacon', all)).toBeUndefined();
	});

	it("B2: names no restricted project to a non-member in the refusal's suggestion", async () => {
		const { kernel, transport, beacon } = await scoped({ projects: ['atlas', 'vault'] });
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const vault = await kernel.call('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		expect(vault.success).toBe(true);
		const inBeacon = { scope: { workspace: 'personal', project: beacon } };
		const before = transport.calls.length;
		const member = await kernel.call('work-hello-greet', {}, inBeacon);
		expect(member.error?.suggestion).toBe('Switch to a project this instance serves: atlas, vault');
		await kernel.call('auth-sign-out');
		const outsider = await kernel.call('work-hello-greet', {}, inBeacon);
		expect(outsider.error).toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
			suggestion: 'Switch to a project this instance serves: atlas',
		});
		expect(JSON.stringify(outsider)).not.toMatch(/vault/i);
		expect(transport.calls.length).toBe(before);
		await kernel.dispose();
	});

	it('B2: words the suggestion without slugs when the caller may enter none of them', async () => {
		const { kernel, beacon } = await scoped({ projects: ['vault', 'later'] });
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		await kernel.call('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		await kernel.call('auth-sign-out');
		// `vault` is restricted to someone else, and no project has the slug `later` yet.
		const refused = await kernel.call(
			'work-hello-greet',
			{},
			{
				scope: { workspace: 'personal', project: beacon },
			}
		);
		expect(refused.error?.suggestion).toBe('Switch to a project this instance serves');
		await kernel.dispose();
	});

	it("B4: refuses no project in the registered handler's own call, wired past the middleware", async () => {
		const transport = fakeTransport(
			{ 'hello-greet': { mutation: false } },
			{ firstClass: ['hello-greet'] }
		);
		const commands: ZodCommandDefinition[] = [];
		const record = { instance: 'work', app: 'umbel', state: 'loading', commands: [] };
		const host = {
			taken: new Set<string>(),
			setCommands() {},
			clock: () => 0,
			commandRows: () => [],
			runAs: async () => ({ success: true }),
			scope: {
				active: () => ({ workspace: 'personal' }),
				actorKey: () => 'local',
				allows: () => true,
				projects: { get: () => undefined, all: () => [] },
				workspaceApps: { get: () => undefined },
			},
		};
		const mounted = createMountedHost({
			record: record as unknown as AppRecord,
			entry: work({ projects: ['atlas'] }) as never,
			manifest: umbelManifest() as never,
			host: host as unknown as AppsHost,
			ports: { ...createFixturePorts({}), mountTransport: async () => transport },
			commands,
			owners: new Map(),
		});
		expect((await mounted.refresh()).success).toBe(true);
		const greet = commands.find((command) => command.name === 'work-hello-greet');
		expect(greet).toBeDefined();
		const before = transport.calls.length;
		// What 3.4's line 3 refuses first in a kernel: the handler's own check is there too.
		const refused = (await greet?.handler({}, {
			scope: { workspace: 'personal' },
		} as never)) as { error?: Record<string, unknown> };
		expect(refused.error).toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
			message: 'This instance serves only its projects',
			suggestion: 'Switch to a project this instance serves',
		});
		expect(transport.calls.length).toBe(before);
		await mounted.dispose();
	});

	it("pins a project's mapped space by its slug, and refuses another, before any request", async () => {
		const { kernel, transport, atlas } = await scoped({
			projects: ['atlas'],
			space: { atlas: 'main' },
		});
		const inAtlas = { scope: { workspace: 'personal', project: atlas } };
		const answered = await kernel.call('work-hello-greet', { name: 'Ada' }, inAtlas);
		expect(answered.success).toBe(true);
		expect(transport.calls.at(-1)).toEqual({
			tool: 'hello-greet',
			args: { name: 'Ada', space: 'main' },
		});
		const before = transport.calls.length;
		const other = await kernel.call('work-hello-greet', { space: 'other' }, inAtlas);
		expect(other.error).toMatchObject({
			code: 'MOUNT_SPACE_PINNED',
			details: { project: 'atlas', space: 'main' },
		});
		const spaces = await kernel.call('work-hello-whisper', { spaces: ['main'] }, inAtlas);
		expect(spaces.error?.code).toBe('MOUNT_SPACE_PINNED');
		expect(transport.calls.length).toBe(before);
		await kernel.dispose();
	});

	it("sends the effective scope's ids in `_meta` on every command, afd-call too, and none on discovery", async () => {
		const { kernel, transport, atlas } = await scoped({ projects: ['atlas'] });
		// Discovery: `afd-help` and `afd-detail` carry nothing.
		expect(transport.metas.filter(({ meta }) => meta !== undefined)).toEqual([]);
		const inAtlas = { scope: { workspace: 'personal', project: atlas } };
		await kernel.call('work-hello-greet', {}, inAtlas);
		await kernel.agent.call('work-hello-whisper', {}, inAtlas);
		const claim = { 'dev.loam/scope': { workspace: 'personal', project: atlas } };
		expect(commandCalls(transport)).toEqual([
			{ tool: 'hello-greet', meta: claim },
			{ tool: 'afd-call', meta: claim },
		]);
		// Ids alone: no project's name or slug reaches the server.
		expect(JSON.stringify(transport.metas)).not.toMatch(/Atlas|atlas/);
		await kernel.call('app-instance-refresh', { instance: 'work' });
		expect(transport.metas.at(-1)).toEqual({ tool: 'afd-detail', meta: undefined });
		await kernel.dispose();
	});

	it('sends a workspace-only instance its narrowed scope, the workspace alone', async () => {
		const { kernel, transport, atlas } = await scoped({});
		await kernel.call('work-hello-greet', {}, { scope: { workspace: 'personal', project: atlas } });
		expect(commandCalls(transport)).toEqual([
			{ tool: 'hello-greet', meta: { 'dev.loam/scope': { workspace: 'personal' } } },
		]);
		await kernel.dispose();
	});

	it('agrees with the kernel: a call succeeds exactly where the app is available (7.1, 9.1)', async () => {
		for (const entry of [{ projects: ['atlas'] }, {}]) {
			const { kernel, atlas, beacon } = await scoped(entry);
			for (const project of [undefined, atlas, beacon]) {
				await kernel.call('scope-set', { project: project ?? null });
				const available = (await kernel.call<{ apps: Array<{ available: boolean }> }>('app-list'))
					.data?.apps[0]?.available;
				const called = await kernel.call('work-hello-greet', {});
				const opened = await kernel.call('app-open', { instance: 'work' });
				expect([project, called.success, opened.success]).toEqual([project, available, available]);
				await kernel.call('app-close');
			}
			await kernel.dispose();
		}
	});

	it('journals the scope of a refused call and replays it with zero differences', async () => {
		const { kernel, journal, deployment, packages, atlas, beacon } = await scoped({
			projects: ['atlas'],
			space: { atlas: 'main' },
		});
		await kernel.call('scope-set', { project: atlas });
		await kernel.call('work-hello-greet', { name: 'Ada' });
		await kernel.call('work-hello-greet', { space: 'other' });
		await kernel.call('scope-set', { project: beacon });
		await kernel.call('work-hello-greet', {});
		const entries: JournalEntry[] = await journal.read();
		const { report } = await replayKernel(entries, {
			deployment,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		await kernel.dispose();
	});
});

describe('4.1: a disabled mounted instance is not discovered, and enabling one discovers it', () => {
	it('leaves it undiscovered, refuses its refresh, and discovers it once enabled', async () => {
		let made = 0;
		const transport = fakeTransport({ 'a-read': { mutation: false } });
		const { kernel, journal, deployment, packages } = await boot({
			work: () => {
				made++;
				return transport;
			},
		});
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		await kernel.startInstances();
		expect(made).toBe(0);
		expect((await journal.read()).map(({ command }) => command)).not.toContain(
			'app-instance-refresh'
		);
		expect((await instance(kernel))?.state).toBe('loading');
		const refused = await kernel.call('app-instance-refresh', { instance: 'work' });
		expect(refused.error).toMatchObject({
			code: 'APP_DISABLED',
			suggestion: 'Enable it with workspace-app-set { instance: "work", enabled: true }',
		});
		expect(made).toBe(0);

		const enabled = await kernel.call<{ overrides: Record<string, unknown> }>('workspace-app-set', {
			instance: 'work',
			enabled: true,
		});
		expect(enabled.success).toBe(true);
		expect(made).toBe(1);
		expect((await instance(kernel))?.state).toBe('ready');
		expect((await kernel.call('work-a-read', {})).success).toBe(true);
		const entries: JournalEntry[] = await journal.read();
		const set = entries.findLast(({ command }) => command === 'workspace-app-set');
		const nested = entries.find(
			({ command, context }) => command === 'app-instance-refresh' && context?.parent !== undefined
		);
		expect(nested?.context).toMatchObject({
			parent: set?.traceId,
			instance: 'work',
			replay: 'recorded',
		});
		// A second enable, of an instance already enabled, discovers nothing again.
		await kernel.call('workspace-app-set', { instance: 'work', enabled: true });
		expect(made).toBe(1);

		const { report } = await replayKernel(await journal.read(), {
			deployment,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		await kernel.dispose();
	});

	it('B1: a replay whose journal lacks the nested refresh makes no transport, and reports it', async () => {
		const { kernel, journal, deployment, packages } = await boot({
			work: () => fakeTransport({ 'a-read': { mutation: false } }),
		});
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		await kernel.startInstances();
		await kernel.call('workspace-app-set', { instance: 'work', enabled: true });
		const recorded: JournalEntry[] = await journal.read();
		const nested = recorded.find(
			({ command, context }) => command === 'app-instance-refresh' && context?.parent !== undefined
		);
		expect(nested).toBeDefined();
		const parent = recorded.find(({ traceId }) => traceId === nested?.context?.parent);
		// As a journal recorded before step 8 would hold it, or one with the entry lost.
		const entries = recorded.filter((entry) => entry !== nested);
		let made = 0;
		const refusal = await replayKernel(entries, {
			deployment,
			ports: {
				...createFixturePorts(packages),
				async mountTransport() {
					made++;
					return fakeTransport({ 'a-read': { mutation: false } });
				},
			},
		}).then(
			() => undefined,
			(error: { code?: string; details?: { report?: KernelReplayReport } }) => error
		);
		expect(made).toBe(0);
		expect(refusal?.code).toBe('REPLAY_DIVERGED');
		const differing = (refusal?.details?.report?.entries ?? []).filter(
			({ status }) => status !== 'same'
		);
		expect(differing.map(({ seq }) => seq)).toContain(parent?.seq);
		expect(JSON.stringify(differing)).toContain(
			"The handler called 'app-instance-refresh', which the journal does not record there"
		);
		await kernel.dispose();
	});

	it('S1: says on its row that it is disabled, with the command that enables it, while it waits', async () => {
		const { kernel } = await boot({ work: () => fakeTransport({ 'a-read': { mutation: false } }) });
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		await kernel.startInstances();
		const row = await instance(kernel);
		// Version 1's state: never discovered, it reads as discovery left it, and the notice says why.
		expect(row?.state).toBe('loading');
		expect(row?.notices).toContainEqual({
			code: 'APP_DISABLED',
			message:
				'The app \'work\' is disabled in this workspace. Enable it with workspace-app-set { instance: "work", enabled: true }.',
		});
		// `app-get` carries the same notice, beside `app-list`'s `disabled` (N-A).
		const detail = await kernel.call<{ notices: Array<{ code: string; message: string }> }>(
			'app-get',
			{ instance: 'work' }
		);
		expect(detail.data?.notices).toContainEqual(
			row?.notices.find(({ code }) => code === 'APP_DISABLED')
		);
		const listed = await kernel.call<{ apps: Array<{ instance: string; state: string }> }>(
			'app-list'
		);
		expect(listed.data?.apps.find(({ instance: name }) => name === 'work')?.state).toBe('disabled');
		// Its commands were never discovered, so none is registered: the registry's own answer.
		expect((await kernel.call('work-a-read', {})).error?.code).toBe('COMMAND_NOT_FOUND');
		await kernel.call('workspace-app-set', { instance: 'work', enabled: true });
		const enabled = await instance(kernel);
		expect(enabled?.state).toBe('ready');
		expect(enabled?.notices.map(({ code }) => code)).not.toContain('APP_DISABLED');
		const enabledDetail = await kernel.call<{ notices: Array<{ code: string }> }>('app-get', {
			instance: 'work',
		});
		expect(enabledDetail.data?.notices.map(({ code }) => code)).not.toContain('APP_DISABLED');
		// Discovered, then disabled: its commands are registered, and the gate answers them (4.1).
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		expect((await kernel.call('work-a-read', {})).error?.code).toBe('APP_DISABLED');
		await kernel.dispose();
	});

	it('N5: enables it whatever its discovery answers, and warns of a failed one', async () => {
		const { kernel, journal, deployment, packages } = await boot({
			work: () => Promise.reject(new TypeError('fetch failed')),
		});
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		const enabled = await kernel.call<{ overrides: Record<string, unknown> }>('workspace-app-set', {
			instance: 'work',
			enabled: true,
		});
		expect(enabled.success).toBe(true);
		expect(enabled.data?.overrides.enabled).toBe(true);
		expect(enabled.warnings).toEqual([
			{
				code: 'MOUNT_UNREACHABLE',
				message: 'Enabled, and its discovery failed: The instance cannot be reached',
			},
		]);
		expect((await instance(kernel))?.state).toBe('failed');
		const { report } = await replayKernel(await journal.read(), {
			deployment,
			ports: createFixturePorts(packages),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		await kernel.dispose();
	});

	it("discovers it when a disable's override is cleared with null, as its undo does", async () => {
		let made = 0;
		const { kernel } = await boot({
			work: () => {
				made++;
				return fakeTransport({});
			},
		});
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		await kernel.call('workspace-app-set', { instance: 'work', enabled: null });
		expect(made).toBe(1);
		await kernel.dispose();
	});
});

describe('9.1: INSTANCE_PROJECT_UNKNOWN', () => {
	it('warns of a listed slug no project has, until a project is created with it', async () => {
		const { kernel } = await boot({ work: () => fakeTransport({}) }, [
			work({ projects: ['atlas', 'borealis'] }),
		]);
		const codes = async () =>
			((await instance(kernel))?.warnings ?? []).map(({ code, message }) => [code, message]);
		expect(await codes()).toEqual([
			[
				'INSTANCE_PROJECT_UNKNOWN',
				'No project you can open has the slug `atlas`, so this instance serves you none there',
			],
			[
				'INSTANCE_PROJECT_UNKNOWN',
				'No project you can open has the slug `borealis`, so this instance serves you none there',
			],
		]);
		await kernel.call('project-create', { name: 'Atlas' });
		expect((await codes()).map(([, message]) => message)).toEqual([
			'No project you can open has the slug `borealis`, so this instance serves you none there',
		]);
		await kernel.dispose();
	});
});

describe('9.1: INSTANCE_PROJECT_UNKNOWN per caller (the boundary re-check, item 4)', () => {
	it('warns a non-member of a restricted listed project as of a missing one, and not a member', async () => {
		const { kernel } = await boot({ work: () => fakeTransport({}) }, [
			work({ projects: ['vault', 'later'] }),
		]);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		await kernel.call('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		const warned = async () =>
			((await instance(kernel))?.warnings ?? [])
				.filter(({ code }) => code === 'INSTANCE_PROJECT_UNKNOWN')
				.map(({ message }) => message);
		const missing = (slug: string) =>
			`No project you can open has the slug \`${slug}\`, so this instance serves you none there`;
		expect(await warned()).toEqual([missing('later')]);
		await kernel.call('auth-sign-out');
		// Vault exists and is restricted to someone else: it reads exactly as a slug no project has.
		expect(await warned()).toEqual([missing('vault'), missing('later')]);
		await kernel.dispose();
	});
});

describe('10: a replay and a nested call its journal does not hold (the boundary re-check, items 2 and 3)', () => {
	/** A nested entry: `seq` given when the call finished, `call` the trace ID's number when it started. */
	const recordedEntry = (seq: number, input: unknown, data: unknown, call = seq): JournalEntry =>
		({
			seq,
			traceId: `loam-mgw0-${call}`,
			command: 'work-a-read',
			input,
			context: { parent: 'outer-1', instance: 'work', replay: 'recorded' },
			result: { success: true, data },
		}) as unknown as JournalEntry;

	it('answers two nested calls a handler made together, recorded in the other order', () => {
		// The journal gives a call its seq when it finishes, so the second call made can finish first; its
		// trace ID's number says the order the calls were made in.
		const nested = nestedReplay([
			recordedEntry(1, { n: 2 }, 'second', 8),
			recordedEntry(2, { n: 1 }, 'first', 7),
		]);
		expect(nested.answer('outer-1', 'work-a-read', { n: 1 })?.data).toBe('first');
		expect(nested.answer('outer-1', 'work-a-read', { n: 2 })?.data).toBe('second');
		expect(nested.answer('outer-1', 'work-a-read', { n: 1 })).toBeUndefined();
		nested.finish('outer-1');
		expect([...nested.problems]).toEqual([]);
	});

	it('R2: never answers a call with an entry recorded for another input, so the replay diverges', () => {
		// Made in the other order from the one recorded: the head is the first call made, so the first
		// call here, for another input, takes no entry, where a search of the queue took the second's.
		const reordered = nestedReplay([
			recordedEntry(1, { n: 1 }, 'one', 3),
			recordedEntry(2, { n: 2 }, 'two', 4),
		]);
		expect(reordered.answer('outer-1', 'work-a-read', { n: 2 })).toBeUndefined();
		const other = nestedReplay([recordedEntry(1, { n: 1 }, 'one')]);
		expect(other.answer('outer-1', 'work-a-read', { n: 2 })).toBeUndefined();
		other.finish('outer-1');
		expect([...other.problems.values()]).toEqual([
			"The handler did not call 'work-a-read', which the journal records",
		]);
		// The reviewer's case: `{ n: 1 }` then `{}` recorded, and a handler that calls `{}` first. The head
		// takes it, as a schema's default may fill an input in, and the call that follows cannot match.
		const swapped = nestedReplay([
			recordedEntry(1, { n: 1 }, 'one', 3),
			recordedEntry(2, {}, 'empty', 4),
		]);
		swapped.answer('outer-1', 'work-a-read', {});
		expect(swapped.answer('outer-1', 'work-a-read', { n: 1 })).toBeUndefined();
		swapped.finish('outer-1');
		expect(swapped.problems.size).toBe(1);
	});

	it('refuses a recorded call past validation, and lets validation answer as it did live, with no transport', async () => {
		const live = await boot({ work: () => fakeTransport({ 'a-read': { mutation: false } }) });
		await live.kernel.startInstances();
		const refresh = (await live.journal.read()).find(
			({ command }) => command === 'app-instance-refresh'
		);
		expect(refresh).toBeDefined();
		const { catalog } = (refresh as JournalEntry).result.data as { catalog: unknown };
		await live.kernel.dispose();
		let made = 0;
		const parts = await createKernelParts(
			{
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				deployment: live.deployment,
				ports: {
					...createFixturePorts(live.packages),
					async mountTransport() {
						made++;
						return fakeTransport({ 'a-read': { mutation: false } });
					},
				},
			},
			{ replaying: true }
		);
		parts.applyCatalog('work', catalog);
		const nestedIn = (traceId: string) =>
			({
				traceId,
				parent: 'outer-1',
				app: 'umbel',
				instance: 'work',
				replay: 'recorded',
			}) as never;
		// What the registry refuses before the middleware answers the same as live: never journaled.
		const invalid = await parts.registries.palette.execute(
			'work-a-read',
			'not an object',
			nestedIn('t-1')
		);
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
		const call = await parts.registries.palette.execute('work-a-read', {}, nestedIn('t-2'));
		expect(call.error).toMatchObject({
			code: 'REPLAY_NOT_RECORDED',
			suggestion: 'Replay the whole journal the session recorded',
		});
		const discovery = await parts.registries.palette.execute(
			'app-instance-refresh',
			{ instance: 'work' },
			nestedIn('t-3')
		);
		expect(discovery.error?.code).toBe('REPLAY_NOT_RECORDED');
		// R1: the context's word does not decide. An entry that carries no mark, as a native command's
		// does when a redeploy has made its owner a mounted instance, stops all the same.
		const unmarked = await parts.registries.palette.execute('work-a-read', {}, {
			traceId: 't-4',
			app: 'umbel',
			instance: 'work',
		} as never);
		expect(unmarked.error?.code).toBe('REPLAY_NOT_RECORDED');
		const topLevelRefresh = await parts.registries.palette.execute(
			'app-instance-refresh',
			{ instance: 'work' },
			{ traceId: 't-5' } as never
		);
		expect(topLevelRefresh.error?.code).toBe('REPLAY_NOT_RECORDED');
		expect(made).toBe(0);
		await parts.kernel.dispose();
	});
});

describe('R1 and R3: a replay reaches no port, and a kept kernel is live again', () => {
	async function liveJournal() {
		const live = await boot({ work: () => fakeTransport({ 'a-read': { mutation: false } }) });
		await live.kernel.startInstances();
		expect((await live.kernel.call('work-a-read', {})).success).toBe(true);
		const entries: JournalEntry[] = await live.journal.read();
		await live.kernel.dispose();
		return { ...live, entries };
	}
	const counting = (packages: Parameters<typeof createFixturePorts>[0]) => {
		const ports = {
			made: 0,
			...createFixturePorts(packages),
			async mountTransport() {
				ports.made++;
				return fakeTransport({ 'a-read': { mutation: false } });
			},
		};
		return ports;
	};

	/** The journal with the `replay: 'recorded'` mark removed from the entries of `command`. */
	const unmark = (entries: JournalEntry[], command: string) =>
		entries.map((entry) => {
			if (entry.command !== command) return entry;
			const { replay: _replay, ...context } = entry.context as Record<string, unknown>;
			return { ...entry, context } as JournalEntry;
		});
	const replayed = async (entries: JournalEntry[], deployment: ProjectionV2, ports: object) =>
		replayKernel(entries, { deployment, ports: ports as KernelPortsV1 }).then(
			() => undefined,
			(error: { code?: string; details?: { report?: KernelReplayReport } }) => error
		);
	const differing = (refusal: { details?: { report?: KernelReplayReport } } | undefined) =>
		(refusal?.details?.report?.entries ?? []).filter(({ status }) => status !== 'same');

	it('R1: an unmarked top-level discovery makes no transport, and diverges', async () => {
		const { entries, deployment, packages } = await liveJournal();
		const ports = counting(packages);
		const refusal = await replayed(unmark(entries, 'app-instance-refresh'), deployment, ports);
		// The reviewer's probe: with the context's mark trusted, this discovery ran, and made one.
		expect(ports.made).toBe(0);
		expect(refusal?.code).toBe('REPLAY_DIVERGED');
		const refresh = entries.find(({ command }) => command === 'app-instance-refresh');
		expect(differing(refusal).map(({ seq }) => seq)).toContain(refresh?.seq);
		expect(JSON.stringify(differing(refusal))).toContain('REPLAY_NOT_RECORDED');
	});

	it('R1: an unmarked top-level mounted call stops before its handler, and diverges', async () => {
		const { entries, deployment, packages } = await liveJournal();
		const ports = counting(packages);
		const refusal = await replayed(unmark(entries, 'work-a-read'), deployment, ports);
		expect(ports.made).toBe(0);
		const call = entries.find(({ command }) => command === 'work-a-read');
		expect(differing(refusal).map(({ seq }) => seq)).toEqual([call?.seq]);
		// Not the handler's MOUNT_UNREACHABLE: the guard answered, so the handler never ran.
		expect(JSON.stringify(differing(refusal))).toContain('REPLAY_NOT_RECORDED');
	});

	it('R3: a kept kernel discovers and calls live once the replay has ended', async () => {
		const { entries, deployment, packages } = await liveJournal();
		const ports = counting(packages);
		const { kernel } = await replayKernel(entries, { deployment, ports, keep: true });
		expect(ports.made).toBe(0);
		if (!kernel) throw new Error('No kept kernel');
		await kernel.call('workspace-app-set', { instance: 'work', enabled: false });
		const enabled = await kernel.call('workspace-app-set', { instance: 'work', enabled: true });
		expect(enabled.warnings).toBeUndefined();
		expect(ports.made).toBe(1);
		expect((await kernel.call('app-instance-refresh', { instance: 'work' })).success).toBe(true);
		expect((await kernel.call('work-a-read', {})).success).toBe(true);
		await kernel.dispose();
	});
});
