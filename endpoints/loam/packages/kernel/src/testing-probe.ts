/**
 * @fileoverview `probe`, the fixture app the kernel's tests use, so the kernel names no real app (phase
 * 1 specification, 9.1), and ports that serve a package in process, so a journal with view commands
 * replays with no iframe (6.3).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import type { ManifestV1, ProjectionV2 } from '@lushly-dev/loam-manifest';
import {
	type AppCallContextV1,
	type AppDefinitionV1,
	type AppStoreV1,
	defineApp,
	type ScopeV1,
} from '@lushly-dev/loam-sdk';
import { mulberry32 } from '@lushly-dev/loam-sdk/view';
import type { LoamKernelError } from './errors.js';
import type { SessionCall } from './session.js';
import type { HandlerFrameV1, KernelPortsV1 } from './types.js';

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false };

function probeManifestOf(id: string, kind: 'native' | 'view'): ManifestV1 {
	const name = (action: string): string => `${id}-${action}`;
	const native = kind === 'native';
	return {
		manifest_version: 1,
		protocol: 1,
		plugin: {
			id,
			title: 'Probe',
			version: '1.2.3',
			description: 'A fixture app for the kernel tests.',
			kind,
			domains: [id],
		},
		...(native ? { native: { entry: 'dist/native.js' } } : { view: { handlers: 'handlers.html' } }),
		grants: [
			{ name: 'store', reason: 'Keeps the notes.' },
			{ name: 'clock', reason: 'Stamps each note.' },
			{ name: 'random', reason: 'Gives each note a nonce.' },
			{ name: 'projects', required: false, reason: 'Would group notes; phase 2 serves it.' },
		],
		config: {
			schema: {
				type: 'object',
				properties: { greeting: { type: 'string' } },
				additionalProperties: false,
			},
		},
		commands: [
			{
				name: name('note'),
				title: 'Add a note',
				description: 'Add a note to the store, stamped by the clock and a random nonce.',
				effects: ['store-write'],
				input_schema: {
					type: 'object',
					properties: { text: { type: 'string', minLength: 1 } },
					required: ['text'],
					additionalProperties: false,
				},
			},
			{
				name: name('list'),
				title: 'List notes',
				description: 'List the notes in the store, as a sidebar list.',
				effects: ['inspect'],
				input_schema: EMPTY_INPUT,
			},
			{
				name: name('count'),
				title: 'Count notes',
				description: 'Count the notes through a nested query.',
				effects: ['inspect'],
				input_schema: EMPTY_INPUT,
			},
			{
				name: name('sneak'),
				title: 'Try a nested write',
				description: 'Try a mutation from inside a handler, which is refused.',
				effects: ['plugin-state'],
				input_schema: EMPTY_INPUT,
			},
			{
				name: name('peek'),
				title: 'Try a foreign call',
				description: 'Try a command outside the app, which is refused.',
				effects: ['inspect'],
				input_schema: EMPTY_INPUT,
			},
			{
				name: name('hidden'),
				title: 'A hidden command',
				description: 'Hidden from the palette, for the hidden count.',
				effects: ['inspect'],
				input_schema: EMPTY_INPUT,
				expose: { palette: false },
			},
		],
		ui: {
			layout: { sidebar: { width: 300 } },
			surfaces: {
				rail: { label: 'Probe', icon: 'system/document', order: 10 },
				sidebar: { shape: 'list', command: name('list') },
				...(native
					? {
							main: { element: `${id}-main` },
							panel: { views: [{ id: 'log', title: 'Log', element: `${id}-log` }] },
						}
					: { main: { resource: `ui://${id}/main` } }),
				status: { items: [{ id: 'count', label: 'Notes' }] },
				keybindings: [{ chord: 'Mod+Shift+L', command: name('list') }],
			},
			...(native
				? {}
				: { resources: [{ uri: `ui://${id}/main`, path: 'main.html', title: 'Probe' }] }),
		},
	} as ManifestV1;
}

/** The native fixture app. */
export const PROBE_MANIFEST: ManifestV1 = probeManifestOf('probe', 'native');

/** The same commands as a view, whose handlers run in a frame. */
export const probeViewManifest = (id = 'probev'): ManifestV1 => probeManifestOf(id, 'view');

async function countNotes(store: AppStoreV1 | undefined): Promise<number> {
	return ((await store?.list('note-')) ?? []).length;
}

/** The fixture's definition. The same value runs native and in a frame. */
export function probeDefinition(id = 'probe'): AppDefinitionV1 {
	const name = (action: string): string => `${id}-${action}`;
	return defineApp({
		sdk: 1,
		handlers: {
			[name('note')]: async (input: { text: string }, context: AppCallContextV1) => {
				const key = `note-${context.now?.()}`;
				const nonce = context.random?.();
				await context.store?.put(key, { text: input.text, nonce });
				return success({ key, nonce, greeting: context.config.greeting ?? null });
			},
			[name('list')]: async (_input: unknown, context: AppCallContextV1) => {
				const notes = (await context.store?.list('note-')) ?? [];
				return success({
					items: notes.map(({ key, value }) => ({
						id: key,
						title: (value as { text: string }).text,
					})),
					actor: context.actor?.kind ?? null,
				});
			},
			[name('count')]: async (_input: unknown, context: AppCallContextV1) => {
				const list = await context.client.call<{ items: unknown[] }>(name('list'));
				return list.success
					? success({
							count: list.data?.items.length ?? 0,
							direct: await countNotes(context.store),
						})
					: failure(list.error as NonNullable<typeof list.error>);
			},
			[name('sneak')]: async (_input: unknown, context: AppCallContextV1) => {
				const nested = await context.client.call(name('note'), { text: 'sneaked' });
				return success({ refused: nested.error?.code ?? null });
			},
			[name('peek')]: async (_input: unknown, context: AppCallContextV1) => {
				const nested = await context.client.call('layout-get');
				return success({ refused: nested.error?.code ?? null });
			},
			[name('hidden')]: async () => success({ hidden: true }),
		},
	});
}

/** A scripted session over `probe`, with a switch, overlays and each kind of nested call. */
export const PROBE_SESSION: readonly SessionCall[] = Object.freeze([
	{ interface: 'palette', name: 'app-list' },
	{ interface: 'palette', name: 'app-open', input: { instance: 'probe' } },
	{ interface: 'palette', name: 'probe-note', input: { text: 'first' } },
	{ interface: 'agent', name: 'probe-note', input: { text: 'second' } },
	{ interface: 'palette', name: 'probe-list' },
	{ interface: 'palette', name: 'probe-count' },
	{ interface: 'palette', name: 'probe-sneak' },
	{ interface: 'palette', name: 'probe-peek' },
	{ interface: 'palette', name: 'layout-set', input: { sidebar: { width: 320 } } },
	{ interface: 'palette', name: 'layout-set', input: { inspector: { open: true } } },
	{ interface: 'palette', name: 'toast-show', input: { message: 'Hello' } },
	{ interface: 'palette', name: 'modal-open', input: { title: 'Sure?', body: 'Say so.' } },
	{
		interface: 'palette',
		name: 'overlay-dismiss',
		input: { overlayId: 'ovl-2', result: 'confirm' },
	},
	{ interface: 'palette', name: 'app-get', input: { instance: 'probe' } },
	{ interface: 'palette', name: 'overlay-list' },
	{ interface: 'palette', name: 'app-close' },
	{ interface: 'palette', name: 'layout-get' },
	{ interface: 'palette', name: 'app-open', input: { instance: 'probe' } },
	{ interface: 'palette', name: 'layout-get' },
] satisfies SessionCall[]);

export function probeDeployment(
	apps: ProjectionV2['apps'] = [
		{ instance: 'probe', app: 'probe', package: 'apps/probe/', config: { greeting: 'hi' } },
	],
	sandboxOrigin: string | null = null
): ProjectionV2 {
	return {
		deployment_version: 2,
		generation: 'test',
		workspace: { id: 'personal', name: 'Personal' },
		sandbox_origin: sandboxOrigin,
		apps,
	};
}

/** One package a fixture serves. */
export interface FixturePackage {
	/** Read as the raw `app-manifest.json`, so a refusal can be tested. */
	manifest: unknown;
	definition?: AppDefinitionV1;
	/** Called for the import, in place of the definition. */
	importError?: Error;
	/** Files by their path in the package. */
	files?: Record<string, string>;
}

export interface FixturePorts extends KernelPortsV1 {
	/** The URLs imported, in order: a test's check that a module loads lazily. */
	readonly imports: string[];
	/** The handler frames opened, by instance. */
	readonly framesOpened: string[];
}

const BASE_URL = 'https://shell.loam.test/';

/**
 * Ports over a map of package directories, each key as a deployment's `package` names it. A handler
 * frame runs the package's definition in process with what `serveHandlers` would give it.
 */
export function createFixturePorts(packages: Record<string, FixturePackage>): FixturePorts {
	const imports: string[] = [];
	const framesOpened: string[] = [];
	const find = (url: string): { pkg: FixturePackage; path: string } | undefined => {
		const path = url.slice(BASE_URL.length);
		for (const [directory, pkg] of Object.entries(packages)) {
			if (path.startsWith(directory)) return { pkg, path: path.slice(directory.length) };
		}
		return undefined;
	};
	return {
		baseUrl: BASE_URL,
		imports,
		framesOpened,
		async fetchJson(url) {
			const found = find(url);
			if (found?.path === 'app-manifest.json' && found.pkg.manifest !== undefined) {
				return found.pkg.manifest;
			}
			throw new Error(`Not found: ${url}`);
		},
		async fetchText(url) {
			const found = find(url);
			const text = found?.pkg.files?.[found.path];
			if (text === undefined) throw new Error(`Not found: ${url}`);
			return text;
		},
		async importNative(url) {
			imports.push(url);
			const found = find(url);
			if (found?.pkg.importError) throw found.pkg.importError;
			if (!found?.pkg.definition) throw new Error(`Not found: ${url}`);
			return found.pkg.definition;
		},
		async openHandlerFrame(instance) {
			framesOpened.push(instance);
			const entry = Object.entries(packages).find(([directory]) =>
				directory.includes(`/${instance}/`)
			);
			const definition = entry?.[1].definition;
			if (!definition) throw new Error(`No definition for ${instance}`);
			return inProcessFrame(definition);
		},
		mountTransport() {
			return Promise.reject(new Error('The fixture has no mounted transport'));
		},
	};
}

interface FrameCallContext {
	traceId: string;
	now?: number;
	randomSeed?: number;
	config: Readonly<Record<string, unknown>>;
	grants: string[];
	scope?: ScopeV1;
}

/** What `serveHandlers` does over `postMessage`, in process. */
export function inProcessFrame(definition: AppDefinitionV1): HandlerFrameV1 {
	let answer: (method: string, params: unknown) => Promise<unknown> = () =>
		Promise.reject(new Error('No request handler'));
	return {
		ready: Promise.resolve(Object.keys(definition.handlers)),
		onRequest(handler) {
			answer = handler;
		},
		close() {},
		async call({ callId, command, input, context }) {
			const { traceId, now, randomSeed, config, grants, scope } = context as FrameCallContext;
			const request = (op: string, rest: Record<string, unknown>) =>
				answer('dev.loam/store', { callId, op, ...rest });
			const store: AppStoreV1 = {
				get: async <T>(key: string) => (await request('get', { key })) as T | undefined,
				put: async (key, value) => {
					await request('put', { key, value });
				},
				delete: async (key) => {
					await request('delete', { key });
				},
				list: async (prefix) =>
					(await request('list', prefix === undefined ? {} : { prefix })) as Array<{
						key: string;
						value: unknown;
					}>,
			};
			const handler = definition.handlers[command] as unknown as
				| ((input: unknown, context: AppCallContextV1) => Promise<CommandResult>)
				| undefined;
			if (!handler) {
				return failure({
					code: 'APP_HANDLER_MISSING',
					message: `The module has no handler for \`${command}\`.`,
					suggestion: 'Add the handler, or remove the command from the manifest.',
				});
			}
			try {
				return await handler(input, {
					traceId,
					config,
					scope: scope ?? { workspace: '' },
					client: {
						async call<T>(name: string, args?: unknown, options?: { level?: 'workspace' }) {
							try {
								const reply = (await answer('tools/call', {
									name,
									arguments: args ?? {},
									_meta: {
										'dev.loam/call': callId,
										...(options?.level ? { 'dev.loam/level': options.level } : {}),
									},
								})) as { structuredContent: CommandResult<T> };
								return reply.structuredContent;
							} catch (cause) {
								// As the SDK's client does with a JSON-RPC error.
								const { code, message, suggestion } = cause as LoamKernelError;
								return failure({ code, message, suggestion });
							}
						},
					},
					...(grants.includes('clock') && now !== undefined ? { now: () => now } : {}),
					...(grants.includes('random') && randomSeed !== undefined
						? { random: mulberry32(randomSeed) }
						: {}),
					...(grants.includes('store') ? { store } : {}),
				});
			} catch (cause) {
				// As `serveHandlers` answers: what it threw stays in the frame's console (9.6).
				(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
				return failure({
					code: 'HANDLER_THREW',
					message: `The handler of \`${command}\` threw.`,
					suggestion:
						"A handler returns `failure(...)`; read the handler frame's console, and fix the code that threw.",
				});
			}
		},
	};
}
