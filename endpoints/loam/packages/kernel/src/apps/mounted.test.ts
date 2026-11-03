import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV1, ProjectionV2 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { createKernelParts } from '../kernel.js';
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import type {
	AppInstanceV1,
	KernelPortsV1,
	LoamKernelV2,
	McpToolCallResult,
	MountTransportV1,
} from '../types.js';
import {
	AUTO_DISCOVERY_MS,
	boundRecorded,
	DISCOVERY_LIMITS,
	discoverInstance,
	flagsOf,
	parseMountedResult,
	pinMountedInput,
	RECORDED_RESULT_MAX_BYTES,
} from './mounted.js';

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
	let closed = 0;
	const asResult = (body: unknown): McpToolCallResult => ({ structuredContent: body });
	const transport: MountTransportV1 & { calls: typeof calls; readonly closed: number } = {
		calls,
		get closed() {
			return closed;
		},
		connect: async () => ({ protocolVersion: '2025-11-25' }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args) {
			calls.push({ tool, args });
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
	transports: Record<string, (url: string) => Promise<MountTransportV1> | MountTransportV1>,
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

describe('P2-E3 (kernel unit): an instance that lists projects opens only in them (7.1, 9.1)', () => {
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
		await kernel.dispose();
	});
});
