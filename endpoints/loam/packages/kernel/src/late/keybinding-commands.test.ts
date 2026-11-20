/**
 * Phase 4's step 7 in the kernel (its 8.1, 8.3, 8.5; D123; the coordinator's R1 to R5): `keybinding-list` with
 * `source`, `shadowed`, `active` and `all`; a person's overrides read into the bindings in force, kept per workspace
 * and person; an app's sequences and `when`; who may read the list; and the reserved chords' action names refused as
 * commands. The pure resolver is `keybindings.test.ts`; Chromium's half is `web/test/browser/keybindings.test.ts`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1, ManifestV2, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, success } from '@lushly-dev/loam-sdk';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel } from '../kernel.js';
import type { KeybindingEntryV1 } from '../keybindings.js';
import type { MembershipV1 } from '../scope/access.js';
import { createScopedWorkspace } from '../scope/fixtures.js';
import { personalRecordId } from '../scope/personal.js';
import { createFixedEnvironment, createSteppingClock } from '../session.js';
import { createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernelV5 } from '../types.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };

const KEYS: ManifestV2 = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'keys',
		title: 'Keys',
		version: '1.0.0',
		description: 'A keybindings fixture.',
		kind: 'native',
		domains: ['keys'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	commands: [
		{
			name: 'keys-hello',
			title: 'Say hello',
			description: 'Say hello.',
			effects: ['inspect'],
			input_schema: NO_INPUT,
		},
		{
			name: 'keys-board',
			title: 'Show the board',
			description: 'Show the board, in a project.',
			effects: ['inspect'],
			input_schema: NO_INPUT,
		},
		{
			name: 'keys-peek',
			title: 'Read the keybindings from a port',
			description: "Read keybinding-list through the app's own port.",
			effects: ['inspect'],
			input_schema: NO_INPUT,
		},
	],
	ui: {
		surfaces: {
			main: { element: 'keys-main' },
			keybindings: [
				{ chord: 'Mod+Shift+H', command: 'keys-hello' },
				{ chord: 'Mod+G P', command: 'keys-board', when: 'project' },
			],
		},
	},
} as unknown as ManifestV2;

const KEYS_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'keys-hello': (async () => success({ hello: true })) as never,
		'keys-board': (async () => success({ board: true })) as never,
		'keys-peek': (async (_input: unknown, context: AppCallContextV1) => {
			const read = await context.client.call('keybinding-list', {});
			return success({ ok: read.success, code: read.error?.code ?? null });
		}) as never,
	},
});

const deployment = (workspace = 'personal'): ProjectionV3 =>
	({
		deployment_version: 2,
		generation: `keys-${workspace}`,
		workspace: { id: workspace, name: workspace },
		sandbox_origin: null,
		apps: [{ instance: 'keys', app: 'keys', package: 'fixtures/keys/' }],
	}) as ProjectionV3;
const ports = () =>
	createFixturePorts({
		'fixtures/keys/': { manifest: KEYS, definition: KEYS_DEFINITION },
	}) as never;

async function workspace(store?: DataAdapter, id = 'personal') {
	const made = await createScopedWorkspace({
		deployment: deployment(id),
		ports: ports(),
		...(store ? { store } : {}),
	});
	kernels.push(made.kernel);
	return made;
}

type Listed = { bindings: KeybindingEntryV1[] };
const list = async (kernel: LoamKernelV5, input: object = {}) =>
	((await kernel.call<Listed>('keybinding-list', input)).data as Listed).bindings;
const override = (kernel: LoamKernelV5, value: unknown) =>
	kernel.call('setting-set', {
		section: 'loam.keybindings',
		key: 'overrides',
		value,
		level: 'person',
	});

describe('keybinding-list (8.5)', () => {
	it('lists the reserved chords ordered by keys, each with its source, and the active app’s once it is open', async () => {
		const { kernel } = await workspace();
		const shell = await list(kernel);
		expect(shell.map(({ keys }) => keys)).toEqual([
			'F6',
			'Mod+Alt+B',
			'Mod+Alt+P',
			'Mod+B',
			'Mod+J',
			'Mod+K',
			'Mod+S',
			'Shift+F6',
		]);
		expect(shell.every((entry) => entry.source === 'shell' && entry.active)).toBe(true);
		expect(await list(kernel, { command: 'layout-set', target: 'panel' })).toEqual([
			{ keys: 'Mod+J', command: 'layout-set', target: 'panel', source: 'shell', active: true },
		]);
		// Not open: the app's are in no band in force, listed only with `all`.
		expect((await list(kernel)).some((entry) => entry.source === 'app')).toBe(false);
		expect(await list(kernel, { command: 'keys-hello', all: true })).toEqual([
			{ keys: 'Mod+Shift+H', command: 'keys-hello', source: 'app', app: 'keys', active: false },
		]);
		await kernel.call('app-open', { instance: 'keys' });
		expect(await list(kernel, { command: 'keys-hello' })).toEqual([
			{ keys: 'Mod+Shift+H', command: 'keys-hello', source: 'app', app: 'keys', active: true },
		]);
		// `when: project`, with no project: in force, not active, and not among the chrome's.
		expect(await list(kernel, { command: 'keys-board' })).toEqual([
			{
				keys: 'Mod+G P',
				command: 'keys-board',
				when: 'project',
				source: 'app',
				app: 'keys',
				active: false,
			},
		]);
		expect(kernel.listKeybindings().map(({ chord }) => chord)).toEqual([
			'Mod+K',
			'Mod+B',
			'Mod+Alt+B',
			'Mod+J',
			'F6',
			'Shift+F6',
			'Mod+S',
			'Mod+Alt+P',
			'Mod+Shift+H',
		]);
	});

	it('runs the job rebind-a-chord: the switcher from the shell, then mine, the shell’s shadowed', async () => {
		const { kernel } = await workspace();
		expect(await list(kernel, { command: 'shell-project-switcher' })).toEqual([
			{ keys: 'Mod+Alt+P', command: 'shell-project-switcher', source: 'shell', active: true },
		]);
		expect(
			(await override(kernel, [{ command: 'shell-project-switcher', keys: 'Mod+Shift+O' }])).success
		).toBe(true);
		expect(await list(kernel, { command: 'shell-project-switcher' })).toEqual([
			{
				keys: 'Mod+Shift+O',
				command: 'shell-project-switcher',
				source: 'you',
				shadowed: [{ source: 'shell', command: 'shell-project-switcher' }],
				active: true,
			},
		]);
		expect(await list(kernel, { command: 'shell-project-switcher', all: true })).toEqual([
			{ keys: 'Mod+Alt+P', command: 'shell-project-switcher', source: 'shell', active: false },
			expect.objectContaining({ keys: 'Mod+Shift+O', source: 'you' }),
		]);
		// The chrome's list: mine first, the switcher's action kept.
		expect(kernel.listKeybindings()[0]).toEqual({
			chord: 'Mod+Shift+O',
			command: null,
			switcher: true,
		});
		expect(kernel.listKeybindings().some(({ chord }) => chord === 'Mod+Alt+P')).toBe(false);
	});

	it('shadows an app’s binding with a person’s on the same keys, and the palette shows each command’s own keys', async () => {
		const { kernel } = await workspace();
		await kernel.call('app-open', { instance: 'keys' });
		await override(kernel, [{ command: 'keys-board', keys: 'Mod+Shift+H' }]);
		expect(await list(kernel, { all: true, command: 'keys-board' })).toEqual([
			expect.objectContaining({ keys: 'Mod+G P', source: 'app', active: false }),
			expect.objectContaining({
				keys: 'Mod+Shift+H',
				source: 'you',
				app: 'keys',
				shadowed: [
					{ source: 'app', command: 'keys-board' },
					{ source: 'app', command: 'keys-hello' },
				],
				active: true,
			}),
		]);
		const commands = kernel.listCommands();
		expect(commands.find(({ name }) => name === 'keys-board')?.keybinding).toBe('Mod+Shift+H');
		expect(commands.find(({ name }) => name === 'keys-hello')?.keybinding).toBeUndefined();
	});

	it('is read by the person and the agent acting for them; an app gets CALL_NOT_GRANTED (R5)', async () => {
		const { kernel } = await workspace();
		expect((await kernel.agent.call('keybinding-list', {})).success).toBe(true);
		await kernel.call('app-open', { instance: 'keys' });
		const peek = await kernel.call<{ ok: boolean; code: string | null }>('keys-peek', {});
		expect(peek.data).toEqual({ ok: false, code: 'CALL_NOT_GRANTED' });
		// Overrides stay human (3.2): the agent's write is the hand-off.
		const agent = await kernel.agent.call('setting-set', {
			section: 'loam.keybindings',
			key: 'overrides',
			value: [],
			level: 'person',
		});
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');
		// 8.3: F6 and Shift+F6 themselves are neither rebound nor unbound.
		for (const value of [
			[{ command: 'shell-focus-next', keys: null }],
			[{ command: 'shell-focus-previous', keys: 'Mod+Shift+F' }],
		]) {
			expect((await override(kernel, value)).error).toMatchObject({
				code: 'KEYBINDING_RESERVED',
				suggestion: 'Bind another key',
			});
		}
		// Strict input.
		expect((await kernel.call('keybinding-list', { keys: 'Mod+K' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('refuses each reserved action’s name as a command, with the keys to press (R1)', async () => {
		const { kernel } = await workspace();
		for (const name of [
			'shell-save',
			'shell-focus-next',
			'shell-focus-previous',
			'shell-project-switcher',
		]) {
			const refused = await kernel.call(name, {});
			expect(refused.error, name).toMatchObject({
				code: 'KEYBINDING_ACTION_ONLY',
				suggestion: `Press its keys: keybinding-list { command: '${name}' } names them`,
			});
		}
		const names = kernel.listCommands().map(({ name }) => name);
		expect(names.filter((name) => /^shell-(focus|save|project)/.test(name))).toEqual([]);
	});
});

describe('P4-E15: keybinding-list replays', () => {
	it('replays a session of overrides and lists with no difference', async () => {
		const { kernel, journal } = await workspace();
		await kernel.call('keybinding-list', { all: true });
		await override(kernel, [
			{ command: 'shell-project-switcher', keys: 'Mod+Shift+O' },
			{ command: 'palette-open', keys: null },
		]);
		await kernel.call('app-open', { instance: 'keys' });
		await kernel.call('keybinding-list', {});
		await kernel.call('keybinding-list', { command: 'keys-hello', all: true });
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment(),
			ports: ports(),
		});
		const listed = report.entries.filter(({ command }) => command === 'keybinding-list');
		expect(listed.length).toBe(3);
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe("a person's overrides, kept per workspace and person (8.3, R5)", () => {
	it('stores them at <workspace>/loam.keybindings, never read by another workspace on the same store', async () => {
		const store = new MemoryAdapter();
		const first = await workspace(store, 'personal');
		await override(first.kernel, [{ command: 'palette-open', keys: 'Mod+Shift+K' }]);
		const row = await store.get<{ value: Record<string, unknown> }>('settings', 'loam.settings');
		expect(Object.keys(row?.value ?? {})).toEqual(['personal/loam.keybindings']);
		expect(first.kernel.listKeybindings()[0]).toMatchObject({ chord: 'Mod+Shift+K' });
		await first.kernel.dispose();
		const second = await workspace(store, 'acme');
		expect(
			(await second.kernel.call('setting-get', { section: 'loam.keybindings', key: 'overrides' }))
				.data
		).toMatchObject({ value: [], from: 'default' });
		expect(second.kernel.listKeybindings()[0]).toMatchObject({ chord: 'Mod+K' });
		// The first workspace's, read again by its own next page.
		const again = await workspace(store, 'personal');
		expect(again.kernel.listKeybindings()[0]).toMatchObject({ chord: 'Mod+Shift+K' });
	});

	it('never reads a value stored under the bare section id, as step 2 kept it', async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.settings',
			category: 'settings',
			value: {
				'loam.keybindings': {
					overrides: {
						value: [{ command: 'palette-open', keys: null }],
						updatedAt: 1,
						updatedBy: 'local',
					},
				},
			},
		});
		const { kernel } = await workspace(store);
		expect(kernel.listKeybindings()[0]).toMatchObject({ chord: 'Mod+K', command: 'palette-open' });
	});

	it('follows a change of person in provider mode: each keeps their own, and signed out none', async () => {
		const PROVIDER: IdentityV1 = {
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['passkey', 'password'],
		};
		const ADA = 'mock-user-ada@example.com';
		const OLU = 'mock-user-olu@example.com';
		const membership: MembershipV1 = {
			mode: 'provider',
			members: new Map([
				[ADA, 'member'],
				[OLU, 'owner'],
			]),
			digest: 'd1',
		};
		const store = new MemoryAdapter();
		const clock = createSteppingClock();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter({ clock: { now: clock } }),
			environment: createFixedEnvironment(),
			host: 'test',
			clock,
			identity: PROVIDER,
			membership,
		});
		kernels.push(kernel);
		const signIn = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		const first = () => kernel.listKeybindings()[0]?.chord;
		await signIn('ada@example.com');
		await override(kernel, [{ command: 'palette-open', keys: 'Mod+Shift+K' }]);
		expect(first()).toBe('Mod+Shift+K');
		await kernel.call('auth-sign-out');
		expect(first()).toBe('Mod+K');
		await signIn('olu@example.com');
		expect(first()).toBe('Mod+K');
		await kernel.call('auth-sign-out');
		await signIn('ada@example.com');
		expect(first()).toBe('Mod+Shift+K');
		const held = await store.get<{ value: Record<string, unknown> }>(
			'settings',
			personalRecordId('loam.settings', ADA)
		);
		expect(Object.keys(held?.value ?? {})).toContain('personal/loam.keybindings');
	});
});

describe("step 7's reviews", () => {
	const PROVIDER: IdentityV1 = {
		mode: 'provider',
		organization: 'acme',
		path: 'api/auth',
		methods: ['passkey', 'password'],
	};
	const ADA = 'mock-user-ada@example.com';
	const OLU = 'mock-user-olu@example.com';
	const membership: MembershipV1 = {
		mode: 'provider',
		members: new Map([
			[ADA, 'member'],
			[OLU, 'owner'],
		]),
		digest: 'd1',
	};

	/** A store whose reads of one record fail while `failing` holds it. */
	class FailingStore extends MemoryAdapter {
		failing: string | undefined;
		override async get<T>(table: string, id: string): Promise<T | null> {
			if (table === 'settings' && id === this.failing) throw new Error('the store failed');
			return super.get<T>(table, id);
		}
	}

	it('2: drops one person’s overrides on a direct change to another whose read fails (Astra 2, Opus 4)', async () => {
		const store = new FailingStore();
		const clock = createSteppingClock();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter({ clock: { now: clock } }),
			environment: createFixedEnvironment(),
			host: 'test',
			clock,
			identity: PROVIDER,
			membership,
		});
		kernels.push(kernel);
		const signIn = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		await signIn('ada@example.com');
		await override(kernel, [{ command: 'palette-open', keys: 'Mod+Shift+K' }]);
		expect(kernel.listKeybindings()[0]?.chord).toBe('Mod+Shift+K');
		store.failing = personalRecordId('loam.settings', OLU);
		// Straight from Ada to Olu, with no sign-out between, and Olu's record unreadable.
		await signIn('olu@example.com');
		const chords = kernel.listKeybindings().map(({ chord }) => chord);
		expect(chords).not.toContain('Mod+Shift+K');
		// Olu's own overrides are not known, so only F6 and Shift+F6, which no override touches, dispatch; Mod+S is held (R9).
		expect(chords).toEqual(['F6', 'Shift+F6', 'Mod+S']);
		const listed = await list(kernel, { all: true });
		expect(listed.some((entry) => entry.source === 'you')).toBe(false);
		// One readiness for dispatch, the list and the palette's hints (the re-check's 5): only the focus chords are
		// active, and no command shows keys it would not run by.
		const active = (await list(kernel)).filter((entry) => entry.active).map(({ keys }) => keys);
		expect(active).toEqual(['F6', 'Shift+F6']);
		expect(
			kernel.listCommands().find(({ name }) => name === 'palette-open')?.keybinding
		).toBeUndefined();
		// R9: Mod+S is held while the keys are not ready, so the browser's save dialog never opens.
		expect(kernel.listKeybindings().find(({ chord }) => chord === 'Mod+S')).toMatchObject({
			save: true,
			unready: true,
		});
		// R9: the read is tried again, and lands once the store answers.
		store.failing = undefined;
		await expect
			.poll(() => kernel.listKeybindings().map(({ chord }) => chord), { timeout: 5_000 })
			.toContain('Mod+K');
	});

	it("R9: reads a new person's overrides when the session changes with no call, as another tab's sign-in does", async () => {
		const store = new MemoryAdapter();
		const clock = createSteppingClock();
		const auth = new MockAuthAdapter({ clock: { now: clock } });
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock,
			identity: PROVIDER,
			membership,
		});
		kernels.push(kernel);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'x',
		});
		await override(kernel, [{ command: 'palette-open', keys: 'Mod+Shift+K' }]);
		expect(kernel.listKeybindings()[0]?.chord).toBe('Mod+Shift+K');
		// Another tab signs Olu in: the adapter tells the kernel, and no call is made here.
		auth._setUser({ id: OLU, email: 'olu@example.com', name: 'olu' });
		await expect
			.poll(() => kernel.listKeybindings().map(({ chord }) => chord), { timeout: 5_000 })
			.toContain('Mod+K');
		expect(kernel.listKeybindings().map(({ chord }) => chord)).not.toContain('Mod+Shift+K');
	});

	it("8: keeps a stored list's valid overrides when a newer rule refuses one, and says how many it dropped", async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.settings',
			category: 'settings',
			value: {
				'personal/loam.keybindings': {
					overrides: {
						value: [
							{ command: 'palette-open', keys: 'Mod+Shift+K' },
							// R7 refuses a bare key, which step 7's first check took.
							{ command: 'section-open', target: 'documents', keys: 'D' },
						],
						updatedAt: 1,
						updatedBy: 'local',
					},
				},
			},
		});
		const { kernel } = await workspace(store);
		expect(kernel.listKeybindings()[0]?.chord).toBe('Mod+Shift+K');
		const read = await kernel.call<{ bindings: KeybindingEntryV1[]; refused?: number }>(
			'keybinding-list',
			{}
		);
		expect(read.data?.refused).toBe(1);
	});

	it('6: dispatches no rebindable default until the person’s overrides are known (Astra 6)', async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.settings',
			category: 'settings',
			value: {
				'personal/loam.keybindings': {
					overrides: {
						value: [{ command: 'layout-set', target: 'sidebar', keys: null }],
						updatedAt: 1,
						updatedBy: 'local',
					},
				},
			},
		});
		const { kernel } = await workspace(store);
		expect(kernel.listKeybindings().map(({ chord }) => chord)).not.toContain('Mod+B');
	});

	it('7: names an app command’s instance from the registry, and section-open active only for a real section (Astra 7)', async () => {
		const { kernel } = await workspace();
		await override(kernel, [
			{ command: 'keys-peek', keys: 'Mod+Shift+Y' },
			{ command: 'section-open', target: 'nowhere', keys: 'Mod+G N' },
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
		]);
		expect(await list(kernel, { command: 'keys-peek' })).toEqual([
			{ keys: 'Mod+Shift+Y', command: 'keys-peek', source: 'you', app: 'keys', active: true },
		]);
		const sections = await list(kernel, { command: 'section-open', all: true });
		expect(sections.find((entry) => entry.target === 'nowhere')).toMatchObject({ active: false });
		expect(sections.find((entry) => entry.target === 'documents')).toMatchObject({ active: true });
		expect(kernel.listKeybindings().some(({ chord }) => chord === 'Mod+G N')).toBe(false);
	});

	it('R7: refuses a single chord with no modifier but a function key; R8: a target off section-open and layout-set', async () => {
		const { kernel } = await workspace();
		for (const keys of ['A', 'Enter', 'Shift+A', 'Alt+X', 'Space']) {
			const refused = await override(kernel, [{ command: 'palette-open', keys }]);
			expect(refused.error, keys).toMatchObject({
				code: 'VALIDATION_ERROR',
				suggestion: 'Bind a chord with Mod, such as Mod+Shift+K, or a function key, such as F7',
			});
		}
		for (const keys of ['F7', 'Shift+F7', 'Mod+A', 'Ctrl+A', 'Mod+G P'])
			expect((await override(kernel, [{ command: 'palette-open', keys }])).success, keys).toBe(
				true
			);
		for (const value of [
			[{ command: 'palette-open', target: 'documents', keys: 'Mod+Shift+K' }],
			[{ command: 'layout-set', target: 'footer', keys: 'Mod+Shift+K' }],
		]) {
			const refused = await override(kernel, value);
			expect(refused.error, JSON.stringify(value)).toMatchObject({
				code: 'VALIDATION_ERROR',
				suggestion:
					"Give a target only to section-open, a section, or layout-set, one of 'sidebar', 'inspector' or 'panel'",
			});
		}
	});

	it('11: is not served over MCP (Opus 1)', async () => {
		const made = await workspace();
		const served = (made.mcpOptions()?.commands ?? []).map((command) => command.name);
		expect(served.length).toBeGreaterThan(0);
		expect(served).not.toContain('keybinding-list');
	});
});
