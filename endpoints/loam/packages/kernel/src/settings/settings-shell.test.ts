/**
 * Phase 4's step 2 in the kernel: the shell's own sections of 3.7 (`loam.rail`, `loam.keybindings`,
 * `loam.notifications`) with their custom checks, the palette's setting rows (3.10) and
 * `section-open { section: 'settings', target }` (3.5), on a workspace whose app declares a workspace-and-project
 * section and a project-only one. The step 1 commands are in `settings.test.ts`.
 */

import type { ManifestV3, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, success } from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaletteItem } from '../palette-index.js';
import { createScopedWorkspace, type ScopedWorkspace } from '../scope/fixtures.js';
import { createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernel } from '../types.js';
import { isChord, SHELL_SECTIONS } from './setting-sections.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const keys = (properties: Record<string, unknown>) => ({
	type: 'object',
	properties,
	additionalProperties: false,
});

const GREET: ManifestV3 = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'greet',
		title: 'Greet',
		version: '1.0.0',
		description: 'A greet fixture for the settings tests.',
		kind: 'native',
		domains: ['greet'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [{ name: 'settings', reason: 'The settings tests.' }],
	commands: [
		{
			name: 'greet-search',
			title: 'Search from a port',
			description: "Search the palette's settings through the app's own port.",
			effects: ['inspect'],
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
		},
	],
	ui: {
		surfaces: { main: { element: 'greet-main' } },
		settings: [
			{
				id: 'general',
				title: 'General',
				levels: ['workspace', 'project'],
				schema: keys({
					greeting: {
						type: 'string',
						title: 'Greeting',
						description: 'The word the app greets with.',
						maxLength: 100,
						default: 'Hello',
					},
				}),
			},
			{
				id: 'project',
				title: 'Project',
				levels: ['project'],
				schema: keys({ board: { type: 'string', title: 'Board', maxLength: 60, default: 'Main' } }),
			},
		],
	},
} as unknown as ManifestV3;

const GREET_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'greet-search': (async (_input: unknown, context: AppCallContextV1) => {
			const found = await context.client.call<{ items: PaletteItem[] }>('palette-search', {
				query: 'a',
				kind: 'setting',
			});
			return success({ ok: found.success, code: found.error?.code ?? null });
		}) as never,
	},
});

async function workspace(): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace({
		deployment: {
			deployment_version: 2,
			generation: 'settings-shell',
			workspace: { id: 'personal', name: 'Personal' },
			sandbox_origin: null,
			apps: [{ instance: 'greet', app: 'greet', package: 'fixtures/greet/' }],
		} as ProjectionV3,
		ports: createFixturePorts({
			'fixtures/greet/': { manifest: GREET, definition: GREET_DEFINITION },
		}) as never,
	});
	kernels.push(made.kernel);
	return made;
}

const set = (kernel: LoamKernel, section: string, key: string, value: unknown) =>
	kernel.call('setting-set', { section, key, value, level: 'person' });

describe("the shell's own sections (3.7)", () => {
	it('lists them in the tree order, the shell first, then the app', async () => {
		const { kernel } = await workspace();
		const shell = [];
		for (const { fullId } of SHELL_SECTIONS) {
			const read = await kernel.call<{ sections: Array<{ section: string }> }>(
				'setting-schema-get',
				{ section: fullId }
			);
			shell.push(read.data?.sections[0]?.section);
		}
		expect(shell).toEqual([
			'loam.appearance',
			'loam.rail',
			'loam.keybindings',
			'loam.notifications',
			'loam.limits',
			'loam.documents',
		]);
		const listed = await kernel.call<{ values: Array<{ section: string; key: string }> }>(
			'setting-list',
			{}
		);
		expect([...new Set(listed.data?.values.map(({ section }) => section))]).toEqual([
			...shell,
			'greet.general',
			'greet.project',
		]);
	});

	it("P4-E9: loam.rail.order: a person's own list of instance ids, the rest of a list refused", async () => {
		const { kernel } = await workspace();
		expect((await set(kernel, 'loam.rail', 'order', ['greet', 'other'])).data).toMatchObject({
			value: ['greet', 'other'],
			from: 'person',
		});
		for (const value of [
			'greet',
			['greet', 'greet'],
			['Greet'],
			[1],
			Array.from({ length: 65 }, (_, i) => `a${i}`),
		]) {
			const refused = await set(kernel, 'loam.rail', 'order', value);
			expect(refused.error?.code, JSON.stringify(value)).toBe('VALIDATION_ERROR');
			expect(refused.error?.suggestion).toMatch(/setting-schema-get/);
		}
		// The rail honours it (R8): `app-list` gives each listed app its place, and the rest none.
		type Listed = { apps: Array<{ instance: string; railRank?: number }> };
		const listed = await kernel.call<Listed>('app-list');
		expect(listed.data?.apps.map(({ instance, railRank }) => ({ instance, railRank }))).toEqual([
			{ instance: 'greet', railRank: 0 },
		]);
		await kernel.call('setting-reset', { section: 'loam.rail', key: 'order', level: 'person' });
		expect((await kernel.call<Listed>('app-list')).data?.apps[0]).not.toHaveProperty('railRank');
		const workspaceLevel = await kernel.call('setting-set', {
			section: 'loam.rail',
			key: 'order',
			value: [],
			level: 'workspace',
		});
		expect(workspaceLevel.error?.code).toBe('SETTING_LEVEL_UNAVAILABLE');
	});

	it('P4-E1: loam.notifications: toastSticky is stored now, and muted never names the shell or an agent', async () => {
		const { kernel } = await workspace();
		expect((await set(kernel, 'loam.notifications', 'toastSticky', 'always')).success).toBe(true);
		expect((await set(kernel, 'loam.notifications', 'toastSticky', 'often')).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect((await set(kernel, 'loam.notifications', 'muted', ['greet'])).success).toBe(true);
		for (const value of [['shell'], ['greet', 'agent:shell-agent']]) {
			const refused = await set(kernel, 'loam.notifications', 'muted', value);
			expect(refused.error).toMatchObject({
				code: 'SETTING_MUTE_SHELL',
				suggestion: 'Mute an app instead',
			});
		}
		const read = await kernel.call('setting-get', {
			section: 'loam.notifications',
			key: 'muted',
		});
		expect(read.data).toMatchObject({ value: ['greet'], from: 'person' });
	});

	it('P4-E9: loam.keybindings.overrides: stored and checked; F6, Shift+F6 and Escape are KEYBINDING_RESERVED', async () => {
		const { kernel } = await workspace();
		const overrides = [
			{ command: 'palette-open', keys: 'Mod+Shift+K' },
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
			{ command: 'layout-set', keys: null },
		];
		expect((await set(kernel, 'loam.keybindings', 'overrides', overrides)).data).toMatchObject({
			value: overrides,
		});
		// 8.1: a sequence never begins on a reserved chord (P4-E9), Mod+Alt+P (8.4) among them.
		for (const keys of ['F6', 'Shift+F6', 'Mod+G Escape', 'Mod+K P', 'Mod+Alt+P G']) {
			const refused = await set(kernel, 'loam.keybindings', 'overrides', [
				{ command: 'palette-open', keys },
			]);
			expect(refused.error, keys).toMatchObject({
				code: 'KEYBINDING_RESERVED',
				suggestion: 'Bind another key',
			});
		}
		for (const value of [
			{},
			[{ command: 'palette-open' }],
			[{ command: 'Palette', keys: 'Mod+K' }],
			[{ command: 'palette-open', keys: 'Shift+Mod+K' }],
			[{ command: 'palette-open', keys: 'Mod+G P Q' }],
			// 8.1: a sequence's first chord has Mod.
			[{ command: 'palette-open', keys: 'Alt+G P' }],
			[{ command: 'palette-open', keys: 'Mod+K', when: 'editor' }],
			[{ command: 'palette-open', target: '', keys: 'Mod+K' }],
			[
				{ command: 'palette-open', keys: 'Mod+K' },
				{ command: 'palette-open', keys: 'Mod+L' },
			],
		]) {
			const refused = await set(kernel, 'loam.keybindings', 'overrides', value);
			expect(refused.error?.code, JSON.stringify(value)).toBe('VALIDATION_ERROR');
		}
		// Human (3.2): an agent may not write them, even for its person.
		const agent = await kernel.agent.call('setting-set', {
			section: 'loam.keybindings',
			key: 'overrides',
			value: [],
			level: 'person',
		});
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');
	});

	it('reads a chord as modifiers in order, each once, then one key', () => {
		for (const chord of ['Mod+K', 'Mod+Alt+P', 'Mod+Shift+H', 'F6', 'Shift+F12', 'Alt+ArrowUp']) {
			expect(isChord(chord), chord).toBe(true);
		}
		for (const chord of [
			'',
			'Mod+',
			'Mod+Mod+K',
			'Shift+Mod+K',
			'mod+k',
			'Mod+k',
			'F25',
			'Hyper+K',
		]) {
			expect(isChord(chord), chord).toBe(false);
		}
	});

	it('skips a stored value that no longer passes its check, reading the default', async () => {
		const { kernel, store } = await workspace();
		await set(kernel, 'loam.rail', 'order', ['greet']);
		const row = await store.get<{ value: Record<string, Record<string, { value: unknown }>> }>(
			'settings',
			'loam.settings'
		);
		const value = structuredClone(row?.value ?? {});
		(value['loam.rail'] as Record<string, { value: unknown }>).order = {
			...(value['loam.rail']?.order as object),
			value: ['shell!'],
		} as never;
		await store.update('settings', 'loam.settings', { value });
		const read = await kernel.call('setting-get', { section: 'loam.rail', key: 'order' });
		expect(read.data).toMatchObject({ value: [], from: 'default' });
	});
});

type Rows = { items: PaletteItem[] };

describe("P4-E1: the palette's setting rows (3.10)", () => {
	it('finds a key with its section, key, title, description and app, and filters by kind', async () => {
		const { kernel, scopes } = await workspace();
		const found = await kernel.call<Rows>(
			'palette-search',
			{ query: 'greeting', kind: 'setting' },
			{ scope: scopes.atlas }
		);
		expect(found.data?.items.map(({ score: _s, matches: _m, field: _f, ...row }) => row)).toEqual([
			{
				name: 'greet.general.greeting',
				title: 'Greeting',
				description: 'The word the app greets with.',
				kind: 'setting',
				section: 'greet.general',
				key: 'greeting',
				app: 'Greet',
			},
		]);
		// A shell key has no app; a key with no description is described by its section's title.
		const shell = await kernel.call<Rows>('palette-search', { query: 'trash', kind: 'setting' });
		expect(shell.data?.items[0]).toMatchObject({
			name: 'loam.documents.trashDays',
			description: 'From 1 to 365 days.',
		});
		expect(shell.data?.items[0]).not.toHaveProperty('app');
		const commands = await kernel.call<Rows>('palette-search', {
			query: 'greeting',
			kind: 'command',
		});
		expect(commands.data?.items.every((item) => item.kind === undefined)).toBe(true);
		const all = await kernel.call<Rows>('palette-search', { query: 'greeting' });
		expect(all.data?.items.some((item) => item.kind === 'setting')).toBe(true);
		const refused = await kernel.call('palette-search', { query: 'x', kind: 'app' });
		expect(refused.error?.code).toBe('VALIDATION_ERROR');
	});

	it('lists a project-only key only while a project is in the call', async () => {
		const { kernel, scopes } = await workspace();
		const search = (options = {}) =>
			kernel.call<Rows>('palette-search', { query: 'board', kind: 'setting' }, options);
		expect((await search()).data?.items).toEqual([]);
		expect((await search({ scope: scopes.atlas })).data?.items.map(({ name }) => name)).toEqual([
			'greet.project.board',
		]);
	});

	it('orders rows by score, then by name, so a result is the same every time', async () => {
		const { kernel } = await workspace();
		const found = await kernel.call<Rows>('palette-search', { query: 'e', kind: 'setting' });
		const items = found.data?.items ?? [];
		expect(items.length).toBeGreaterThan(2);
		for (let i = 1; i < items.length; i++) {
			const [a, b] = [items[i - 1] as PaletteItem, items[i] as PaletteItem];
			expect(
				a.score > b.score || (a.score === b.score && a.name < b.name),
				`${a.name}, ${b.name}`
			).toBe(true);
		}
		const again = await kernel.call<Rows>('palette-search', { query: 'e', kind: 'setting' });
		expect(again.data?.items).toEqual(items);
		// No row is shared with the kernel: changing one changes no later answer.
		(items[0] as PaletteItem).title = 'changed';
		const third = await kernel.call<Rows>('palette-search', { query: 'e', kind: 'setting' });
		expect(third.data?.items[0]?.title).not.toBe('changed');
	});

	it('lists nothing for an empty query, and a port is refused palette-search itself (CALL_NOT_GRANTED)', async () => {
		const { kernel } = await workspace();
		expect(
			(await kernel.call<Rows>('palette-search', { query: '', kind: 'setting' })).data?.items
		).toEqual([]);
		await kernel.call('app-open', { instance: 'greet' });
		// `palette-search` is not among the commands a port may call, so it is refused there outright.
		const ported = await kernel
			.appPort('greet')
			.call<{ ok: boolean; code: string | null }>('greet-search');
		expect(ported.data).toEqual({ ok: false, code: 'CALL_NOT_GRANTED' });
	});
});

describe("P4-E1: section-open { section: 'settings', target } (3.5, 3.10)", () => {
	it('opens the section at a key, at a section, or at its root', async () => {
		const { kernel, scopes } = await workspace();
		const main = async () =>
			(
				await kernel.call<{ state: { section: string | null; path: string } }>('view-state-get', {
					id: 'loam.apps',
				})
			).data?.state;
		const opened = await kernel.call(
			'section-open',
			{ section: 'settings', target: 'greet.general.greeting' },
			{ scope: scopes.atlas }
		);
		expect(opened.data).toMatchObject({ section: 'settings' });
		expect(await main()).toMatchObject({ section: 'settings', path: 'greet.general/greeting' });
		await kernel.call('section-open', { section: 'settings', target: 'loam.appearance' });
		expect(await main()).toMatchObject({ path: 'loam.appearance' });
		await kernel.call('section-open', { section: 'settings' });
		expect(await main()).toMatchObject({ section: 'settings', path: '' });
	});

	it('refuses a target that names nothing, a section only its command writes, and a target beside a path', async () => {
		const { kernel } = await workspace();
		for (const [target, code] of [
			['greet.general.colour', 'SETTING_NOT_FOUND'],
			['nowhere', 'SETTING_NOT_FOUND'],
			['loam.autonomy.mode', 'SETTING_NOT_FOUND'],
		] as const) {
			const refused = await kernel.call('section-open', { section: 'settings', target });
			expect(refused.error?.code, target).toBe(code);
			expect(refused.error?.suggestion).toBeTruthy();
		}
		for (const input of [
			{ section: 'documents', target: 'loam.appearance' },
			{ section: 'settings', target: 'loam.appearance', path: 'x' },
		]) {
			expect((await kernel.call('section-open', input)).error?.code).toBe('VALIDATION_ERROR');
		}
	});

	it("opens the autonomy section, and its cap's key, which only autonomy-set writes (step 8)", async () => {
		const { kernel } = await workspace();
		for (const [target, path] of [
			['loam.autonomy', 'loam.autonomy'],
			['loam.autonomy.cap', 'loam.autonomy/cap'],
			// Step 9: the experiments list, which only `experiment-*` writes, at the route its hand-off names.
			['loam.experiments', 'loam.experiments'],
		] as const) {
			const opened = await kernel.call('section-open', { section: 'settings', target });
			expect(opened.success, target).toBe(true);
			const shown = await kernel.call<{ section: string; path: string }>('section-get');
			expect(shown.data).toMatchObject({ section: 'settings', path });
		}
	});

	it('P4-E15: P4-E1: replays a session of the new writes and opens with no difference', async () => {
		const { kernel, journal, scopes } = await workspace();
		await set(kernel, 'loam.rail', 'order', ['greet']);
		await set(kernel, 'loam.notifications', 'muted', ['shell']);
		await kernel.call(
			'section-open',
			{ section: 'settings', target: 'greet.project.board' },
			{ scope: scopes.atlas }
		);
		await kernel.call('palette-search', { query: 'greet', kind: 'setting' });
		const { report } = await replayKernel(await journal.read(), {
			deployment: {
				deployment_version: 2,
				generation: 'settings-shell',
				workspace: { id: 'personal', name: 'Personal' },
				sandbox_origin: null,
				apps: [{ instance: 'greet', app: 'greet', package: 'fixtures/greet/' }],
			} as ProjectionV3,
			ports: createFixturePorts({
				'fixtures/greet/': { manifest: GREET, definition: GREET_DEFINITION },
			}) as never,
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe("the reviews' findings (step 2)", () => {
	it('1: lists no project-only key for a project the caller may not enter, as a person or an agent', async () => {
		const { kernel, scopes } = await workspace();
		const board = async (
			call: typeof kernel.call,
			scope: (typeof scopes)['atlas'],
			kind?: string
		) =>
			(
				await call<Rows>('palette-search', { query: 'board', ...(kind ? { kind } : {}) }, { scope })
			).data?.items.filter((item) => item.kind === 'setting') ?? [];
		const person = kernel.call.bind(kernel) as typeof kernel.call;
		const agent = kernel.agent.call.bind(kernel.agent) as typeof kernel.call;
		for (const call of [person, agent]) {
			expect((await board(call, scopes.atlas, 'setting')).map(({ name }) => name)).toEqual([
				'greet.project.board',
			]);
			// Citadel is restricted to someone else: as if no project were named, in filtered and mixed searches alike.
			expect(await board(call, scopes.citadel, 'setting')).toEqual([]);
			expect(await board(call, scopes.citadel)).toEqual([]);
		}
	});

	it('4: an outline lists every section and its keys by title within the budget, with no schema', async () => {
		const { kernel } = await workspace();
		const outline = await kernel.call<{
			sections: Array<{ section: string; schema?: unknown; keys: Array<{ key: string }> }>;
		}>('setting-schema-get', { outline: true });
		expect(outline.success, JSON.stringify(outline.error)).toBe(true);
		const general = outline.data?.sections.find(({ section }) => section === 'greet.general');
		expect(general).toMatchObject({
			app: 'Greet',
			instance: 'greet',
			keys: [{ key: 'greeting', title: 'Greeting', levels: ['workspace', 'project'] }],
		});
		expect(outline.data?.sections.every((section) => section.schema === undefined)).toBe(true);
		expect(
			(
				await kernel.call('setting-schema-get', {
					section: 'greet.general',
					key: 'greeting',
					outline: true,
				})
			).error?.code
		).toBe('VALIDATION_ERROR');
	});

	// An app opens in every project unless it is disabled, which takes its sections away with it: no row, and its key
	// not found (a native or view instance has no `projects` of its own, and a workspace-only app opens beside any).
	it('12: lists no project-only key of an app disabled here, and refuses its write', async () => {
		const { kernel, scopes } = await workspace();
		await kernel.call('workspace-app-set', { instance: 'greet', enabled: false });
		const listed = await kernel.call<Rows>(
			'palette-search',
			{ query: 'board', kind: 'setting' },
			{ scope: scopes.atlas }
		);
		expect(listed.data?.items).toEqual([]);
		const refused = await kernel.call(
			'setting-set',
			{ section: 'greet.project', key: 'board', value: 'Ours', level: 'project' },
			{ scope: scopes.atlas }
		);
		expect(refused.error?.code).toBe('SETTING_NOT_FOUND');
	});

	it('12: an agent may not write loam.notifications.muted, even for its person', async () => {
		const { kernel } = await workspace();
		const refused = await kernel.agent.call('setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['greet'],
			level: 'person',
		});
		expect(refused.error).toMatchObject({
			code: 'HUMAN_REQUIRED',
			details: { section: 'loam.notifications', key: 'muted', level: 'person' },
		});
		// `toastSticky` is not a human key: the agent writes it for its person, once the person lets agents act (phase 5's
		// 6.1; it asks by default).
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		const sticky = await kernel.agent.call('setting-set', {
			section: 'loam.notifications',
			key: 'toastSticky',
			value: 'always',
			level: 'person',
		});
		expect(sticky.success).toBe(true);
	});
});
