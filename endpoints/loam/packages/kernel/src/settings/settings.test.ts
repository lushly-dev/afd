/**
 * Phase 4's settings core (its section 3, step 1): the five `setting-*` commands, the `settings` grant, the hosted
 * refusal (P4-E17) and every error code step 1 adds, on a workspace whose apps declare sections. Appearance taken
 * over (P4-E3) is in `settings-appearance.test.ts`; that settings grant nothing (P4-E2) in `scope/persona-sweep.test.ts`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type CommandResult, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1, ManifestV3, ProjectionV3, ProjectionV4 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '../kernel.js';
import type { MembershipV1 } from '../scope/access.js';
import { createScopedWorkspace, type ScopedWorkspace } from '../scope/fixtures.js';
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernel, WorkspaceV1 } from '../types.js';
import { SETTING_TABLE } from './settings.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };

/** A native app with the given grants, sections and commands. */
function manifestOf(
	id: string,
	grants: string[],
	settings: unknown[],
	commands: string[]
): ManifestV3 {
	return {
		manifest_version: 2,
		protocol: 1,
		plugin: {
			id,
			title: id[0]?.toUpperCase() + id.slice(1),
			version: '1.0.0',
			description: `A ${id} fixture for the settings tests.`,
			kind: 'native',
			domains: [id],
		},
		native: { entry: 'dist/native.js' },
		app: { scope_levels: ['workspace', 'project'] },
		grants: grants.map((name) => ({ name, reason: 'The settings tests.' })),
		commands: commands.map((name) => ({
			name,
			title: name,
			description: `The fixture's ${name}.`,
			effects: ['inspect'],
			input_schema: EMPTY,
		})),
		ui: { surfaces: { main: { element: `${id}-main` } }, settings },
	} as unknown as ManifestV3;
}

const keys = (properties: Record<string, unknown>) => ({
	type: 'object',
	properties,
	additionalProperties: false,
});

/**
 * Just under 16 KiB with its defaults (the manifest refuses a section whose defaults alone are over), so a long
 * value of one key is `SETTING_TOO_LARGE`.
 */
const BIG = Object.fromEntries(
	Array.from({ length: 19 }, (_, index) => [
		`k${index}`,
		{ type: 'string', title: `K${index}`, maxLength: 1000, default: 'x'.repeat(850) },
	])
);

const GREET = manifestOf(
	'greet',
	['settings'],
	[
		{
			id: 'general',
			title: 'General',
			levels: ['workspace', 'project'],
			schema: keys({
				greeting: { type: 'string', title: 'Greeting', maxLength: 100, default: 'Hello' },
			}),
		},
		{
			id: 'project',
			title: 'Project',
			levels: ['project'],
			schema: keys({ board: { type: 'boolean', title: 'Board', default: false } }),
		},
		{ id: 'big', title: 'Big', levels: ['workspace'], schema: keys(BIG) },
		{
			id: 'lists',
			title: 'Lists',
			levels: ['workspace'],
			schema: keys({
				tags: {
					type: 'array',
					title: 'Tags',
					items: { type: 'string', enum: ['a', 'b', 'c'] },
					maxItems: 3,
					uniqueItems: true,
					default: ['a'],
				},
			}),
		},
	],
	['greet-read', 'greet-section', 'greet-peek', 'greet-write']
);
const OTHER = manifestOf(
	'other',
	[],
	[
		{
			id: 'prefs',
			title: 'Prefs',
			levels: ['person'],
			schema: keys({ x: { type: 'boolean', title: 'X', default: true } }),
		},
	],
	['other-read']
);

const asResult = (result: CommandResult<unknown>) =>
	success({ ok: result.success, code: result.error?.code ?? null, data: result.data ?? null });

const GREET_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		// The `settings` grant's API: this app's own section, resolved for the call's person and scope.
		'greet-read': (async (_input: unknown, context: AppCallContextV1) =>
			success({
				greeting: await context.settings?.get('greet.general', 'greeting'),
			})) as never,
		'greet-section': (async (_input: unknown, context: AppCallContextV1) =>
			success(await context.settings?.section('greet.general'))) as never,
		'greet-peek': (async (_input: unknown, context: AppCallContextV1) =>
			asResult(
				await context.client.call('setting-get', { section: 'other.prefs', key: 'x' })
			)) as never,
		'greet-write': (async (_input: unknown, context: AppCallContextV1) =>
			asResult(
				await context.client.call('setting-set', {
					section: 'greet.general',
					key: 'greeting',
					value: 'Hi',
					level: 'workspace',
				})
			)) as never,
	},
});
const OTHER_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'other-read': (async (_input: unknown, context: AppCallContextV1) =>
			asResult(
				await context.client.call('setting-get', { section: 'other.prefs', key: 'x' })
			)) as never,
	},
});

const deployment = (): ProjectionV3 => ({
	deployment_version: 2,
	generation: 'settings',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: ['greet', 'other'].map((id) => ({ instance: id, app: id, package: `fixtures/${id}/` })),
});
const packages = () => ({
	'fixtures/greet/': { manifest: GREET, definition: GREET_DEFINITION },
	'fixtures/other/': { manifest: OTHER, definition: OTHER_DEFINITION },
});

async function workspace(
	options: { identity?: IdentityV1; membership?: MembershipV1; deployment?: ProjectionV4 } = {}
): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace({
		deployment: (options.deployment ?? deployment()) as ProjectionV3,
		ports: createFixturePorts(packages()) as never,
		...(options.identity ? { identity: options.identity, empty: true } : {}),
		...(options.membership ? { membership: options.membership } : {}),
	});
	kernels.push(made.kernel);
	return made;
}

type Data = Record<string, unknown>;

describe('P4-E1: setting-schema-get (3.9)', () => {
	it("lists the shell's sections, then each app's, and one key alone", async () => {
		const { kernel } = await workspace();
		const all = await kernel.call<{ sections: Array<{ section: string; app?: string }> }>(
			'setting-schema-get',
			{ section: 'greet.general' }
		);
		expect(all.data?.sections).toEqual([
			{
				section: 'greet.general',
				title: 'General',
				levels: ['workspace', 'project'],
				app: 'Greet',
				instance: 'greet',
				schema: keys({
					greeting: { type: 'string', title: 'Greeting', maxLength: 100, default: 'Hello' },
				}),
			},
		]);
		const one = await kernel.call<{ sections: Array<{ schema: { properties: Data } }> }>(
			'setting-schema-get',
			{ section: 'loam.appearance', key: 'theme' }
		);
		expect(Object.keys(one.data?.sections[0]?.schema.properties ?? {})).toEqual(['theme']);
	});

	it('tells a caller past its 16 KiB budget to name a section', async () => {
		const { kernel } = await workspace();
		const all = await kernel.call('setting-schema-get', {});
		expect(all.error).toMatchObject({
			code: 'OUTPUT_BUDGET_EXCEEDED',
			suggestion: 'Name a section: setting-schema-get { section }',
		});
	});

	it("step 2's reviews, 4: past the budget, an outline still lists every section, and a large one reads key by key", async () => {
		const { kernel } = await workspace();
		expect((await kernel.call('setting-schema-get', {})).error?.code).toBe(
			'OUTPUT_BUDGET_EXCEEDED'
		);
		const outline = await kernel.call<{
			sections: Array<{ section: string; keys: Array<{ key: string }> }>;
		}>('setting-schema-get', { outline: true });
		expect(outline.success, JSON.stringify(outline.error)).toBe(true);
		const big = outline.data?.sections.find(({ section }) => section === 'greet.big');
		expect(big?.keys).toHaveLength(19);
		// The settings section reads the shown one whole, or past the budget each key alone, as the fallback does.
		const whole = await kernel.call('setting-schema-get', { section: 'greet.big' });
		if (!whole.success) expect(whole.error?.code).toBe('OUTPUT_BUDGET_EXCEEDED');
		for (const { key } of big?.keys ?? []) {
			const one = await kernel.call('setting-schema-get', { section: 'greet.big', key });
			expect(one.success, key).toBe(true);
		}
	});

	it('refuses a key with no section, an unknown section or key, and the sections only their commands write', async () => {
		const { kernel } = await workspace();
		expect((await kernel.call('setting-schema-get', { key: 'theme' })).error).toMatchObject({
			code: 'VALIDATION_ERROR',
			suggestion: 'Name the section too',
		});
		for (const input of [
			{ section: 'hello.nowhere' },
			{ section: 'loam.appearance', key: 'colour' },
			{ section: 'loam.appearance', key: 'constructor' },
		]) {
			const refused = await kernel.call('setting-schema-get', input);
			expect(refused.error?.code, JSON.stringify(input)).toBe('SETTING_NOT_FOUND');
			expect(refused.error?.suggestion).toBe(
				'List the sections and their keys with setting-schema-get'
			);
		}
		for (const section of ['loam.autonomy', 'loam.experiments']) {
			const read = await kernel.call('setting-get', { section, key: 'mode' });
			expect(read.error?.code).toBe('SETTING_USE_AUTONOMY');
			expect(read.error?.suggestion).toMatch(/autonomy-set|experiment-enable/);
		}
	});
});

describe('P4-E1: setting-set, setting-get and setting-reset (3.2, 3.3, 3.9)', () => {
	it('scopes a value per project: the workspace value every project inherits, and one project its own', async () => {
		const { kernel, scopes } = await workspace();
		const at = (where: 'atlas' | 'beacon') => ({ scope: scopes[where] });
		const set = (value: string, level: string, options = {}) =>
			kernel.call(
				'setting-set',
				{ section: 'greet.general', key: 'greeting', value, level },
				options
			);
		const get = (where: 'atlas' | 'beacon') =>
			kernel.call<Data>('setting-get', { section: 'greet.general', key: 'greeting' }, at(where));
		expect((await set('Hello team', 'workspace')).data).toMatchObject({
			value: 'Hello team',
			from: 'workspace',
			previous: null,
		});
		expect((await set('Hi Atlas', 'project', at('atlas'))).data).toMatchObject({
			value: 'Hi Atlas',
			from: 'project',
		});
		expect((await get('beacon')).data).toMatchObject({ value: 'Hello team', from: 'workspace' });
		expect((await get('atlas')).data).toMatchObject({
			value: 'Hi Atlas',
			from: 'project',
			updatedBy: 'local',
		});
		const reset = await kernel.call(
			'setting-reset',
			{ section: 'greet.general', key: 'greeting', level: 'project' },
			at('atlas')
		);
		expect(reset.data).toEqual({ value: 'Hello team', from: 'workspace' });
		expect(reset).toMatchObject({
			undoCommand: 'setting-set',
			undoArgs: { section: 'greet.general', key: 'greeting', level: 'project', value: 'Hi Atlas' },
		});
		expect((await get('atlas')).data).toMatchObject({ value: 'Hello team', from: 'workspace' });
	});

	it('requires a level, and refuses an unknown property or a value outside its key', async () => {
		const { kernel } = await workspace();
		const none = await kernel.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'Hey',
		});
		expect(none.error?.code).toBe('VALIDATION_ERROR');
		expect(none.error?.suggestion).toContain('level');
		const extra = await kernel.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'Hey',
			level: 'workspace',
			project: 'prj_atlas',
		});
		expect(extra.error?.code).toBe('VALIDATION_ERROR');
		const wrong = await kernel.call('setting-set', {
			section: 'loam.appearance',
			key: 'theme',
			value: 'sepia',
			level: 'person',
		});
		expect(wrong.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			message:
				"The value of 'loam.appearance.theme' must be one of system, light, dark, high-contrast",
		});
		const missing = await kernel.call('setting-set', {
			section: 'loam.appearance',
			key: 'theme',
			level: 'person',
		});
		expect(missing.error?.code).toBe('VALIDATION_ERROR');
	});

	it('SETTING_LEVEL_UNAVAILABLE names the levels; SETTING_PROJECT_REQUIRED wants a project in scope', async () => {
		const { kernel } = await workspace();
		const level = await kernel.call('setting-set', {
			section: 'greet.project',
			key: 'board',
			value: true,
			level: 'workspace',
		});
		expect(level.error).toMatchObject({
			code: 'SETTING_LEVEL_UNAVAILABLE',
			suggestion: 'Set it at project level',
			details: { levels: ['project'] },
		});
		const project = await kernel.call('setting-set', {
			section: 'greet.project',
			key: 'board',
			value: true,
			level: 'project',
		});
		expect(project.error?.code).toBe('SETTING_PROJECT_REQUIRED');
		expect(project.error?.suggestion).toContain('scope');
		const listed = await kernel.call('setting-list', { level: 'project' });
		expect(listed.error?.code).toBe('SETTING_PROJECT_REQUIRED');
	});

	it('SETTING_CONFLICT when expected differs, writing nothing; the undo carries expected', async () => {
		const { kernel } = await workspace();
		const write = (value: string, expected?: string) =>
			kernel.call('setting-set', {
				section: 'greet.general',
				key: 'greeting',
				value,
				level: 'workspace',
				...(expected !== undefined ? { expected } : {}),
			});
		const first = await write('One', 'Hello');
		expect(first.success).toBe(true);
		expect(first).toMatchObject({
			undoCommand: 'setting-reset',
			undoArgs: { section: 'greet.general', key: 'greeting', level: 'workspace', expected: 'One' },
		});
		const second = await write('Two', 'One');
		expect(second).toMatchObject({
			undoCommand: 'setting-set',
			undoArgs: { value: 'One', expected: 'Two' },
		});
		const stale = await write('Three', 'One');
		expect(stale.error).toMatchObject({
			code: 'SETTING_CONFLICT',
			retryable: true,
			details: { current: 'Two', expected: 'One' },
		});
		expect(stale.error?.suggestion).toBe('Read the value again with setting-get, then decide');
		expect(
			(await kernel.call<Data>('setting-get', { section: 'greet.general', key: 'greeting' })).data
		).toMatchObject({ value: 'Two' });
		// The undo of the second write applies, since the value is still the one it wrote.
		const undo = await kernel.call('setting-set', second.undoArgs as Data);
		expect(undo.data).toMatchObject({ value: 'One' });
		const conflictReset = await kernel.call('setting-reset', {
			section: 'greet.general',
			key: 'greeting',
			level: 'workspace',
			expected: 'Two',
		});
		expect(conflictReset.error?.code).toBe('SETTING_CONFLICT');
	});

	it('SETTING_TOO_LARGE for a section whose resolved object is over 16 KiB', async () => {
		const { kernel } = await workspace();
		const result = await kernel.call('setting-set', {
			section: 'greet.big',
			key: 'k0',
			value: 'y'.repeat(1000),
			level: 'workspace',
		});
		expect(result.error).toMatchObject({
			code: 'SETTING_TOO_LARGE',
			suggestion: 'Shorten the longest values',
		});
		expect(
			(await kernel.call<Data>('setting-get', { section: 'greet.big', key: 'k0' })).data
		).toMatchObject({ from: 'default' });
	});

	it('writes loam.documents.trashDays through to the workspace row (A-P2-2)', async () => {
		const { kernel } = await workspace();
		const set = await kernel.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 7,
			level: 'workspace',
		});
		expect(set.data).toMatchObject({ value: 7, from: 'workspace' });
		const read = async () => (await kernel.call<WorkspaceV1>('workspace-get')).data?.trashDays;
		expect(await read()).toBe(7);
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.documents',
					key: 'trashDays',
					value: 0,
					level: 'workspace',
				})
			).error?.code
		).toBe('VALIDATION_ERROR');
		await kernel.call('setting-reset', {
			section: 'loam.documents',
			key: 'trashDays',
			level: 'workspace',
		});
		expect(await read()).toBe(30);
	});

	it('refuses a project the caller may not enter, and an archived one', async () => {
		const { kernel, scopes } = await workspace();
		const write = (where: 'citadel' | 'atlas') =>
			kernel.call(
				'setting-set',
				{ section: 'greet.general', key: 'greeting', value: 'Hi', level: 'project' },
				{ scope: scopes[where] }
			);
		expect((await write('citadel')).error?.code).toBe('PROJECT_NOT_FOUND');
		expect(
			(
				await kernel.call(
					'setting-get',
					{ section: 'greet.general', key: 'greeting' },
					{ scope: scopes.citadel }
				)
			).error?.code
		).toBe('PROJECT_NOT_FOUND');
		await kernel.call('project-archive', { project: 'atlas' });
		expect((await write('atlas')).error?.code).toBe('PROJECT_ARCHIVED');
	});

	it("leaves a disabled app's sections out, and stores shared rows in the setting table", async () => {
		const made = await workspace();
		const { kernel, store } = made;
		await kernel.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'Team',
			level: 'workspace',
		});
		const rows = (await store.list<{ id: string; values: Data; updatedBy: string }>(SETTING_TABLE))
			.data;
		expect(rows.map((row) => [row.id, row.updatedBy])).toEqual([
			['personal/greet.general/workspace', 'local'],
		]);
		expect(rows[0]?.values.greeting).toMatchObject({ value: 'Team', updatedBy: 'local' });
		await kernel.call('workspace-app-set', { instance: 'greet', enabled: false });
		expect(
			(await kernel.call('setting-get', { section: 'greet.general', key: 'greeting' })).error?.code
		).toBe('SETTING_NOT_FOUND');
	});
});

describe('P4-E1: who writes (3.2): the agent interface, the hand-off and the owner', () => {
	it("an agent writes its person's own value, as agent:<id>, and hands off a shared one", async () => {
		const { kernel, scopes } = await workspace();
		const input = { section: 'loam.appearance', key: 'theme', value: 'dark', level: 'person' };
		// From phase 5's step 3 autonomy is enforced (its 6.1): a change asks by default, until the person lets agents act.
		expect((await kernel.agent.call('setting-set', input)).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		const own = await kernel.agent.call('setting-set', {
			section: 'loam.appearance',
			key: 'theme',
			value: 'dark',
			level: 'person',
		});
		expect(own.data).toMatchObject({ value: 'dark', from: 'person' });
		expect(
			(await kernel.agent.call<Data>('setting-get', { section: 'loam.appearance', key: 'theme' }))
				.data
		).toMatchObject({ value: 'dark', updatedBy: 'agent:shell-agent' });
		for (const [level, scope] of [
			['project', scopes.atlas],
			['workspace', undefined],
		] as const) {
			for (const command of ['setting-set', 'setting-reset']) {
				const refused = await kernel.agent.call(
					command,
					{
						section: 'greet.general',
						key: 'greeting',
						...(command === 'setting-set' ? { value: 'Hi' } : {}),
						level,
					},
					scope ? { scope } : {}
				);
				expect(refused.error, `${command} at ${level}`).toMatchObject({
					code: 'HUMAN_REQUIRED',
					details: {
						route: '~/settings/greet.general#greeting',
						section: 'greet.general',
						key: 'greeting',
						level,
					},
				});
				expect(refused.error?.suggestion).toContain('~/settings/greet.general#greeting');
			}
		}
	});

	it('computes writable for the caller: an agent sees HUMAN_REQUIRED on a project-level key', async () => {
		const { kernel, scopes } = await workspace();
		const rows = async (call: LoamKernel['call']) =>
			(
				await call<{
					values: Array<{ section: string; key: string; writable: boolean; reason?: string }>;
				}>('setting-list', {}, { scope: scopes.atlas })
			).data?.values ?? [];
		const pick = (list: Awaited<ReturnType<typeof rows>>, section: string, key: string) =>
			list.find((row) => row.section === section && row.key === key);
		const agent = await rows(kernel.agent.call);
		expect(pick(agent, 'greet.general', 'greeting')).toMatchObject({
			writable: false,
			reason: 'HUMAN_REQUIRED',
		});
		expect(pick(agent, 'loam.appearance', 'theme')).toMatchObject({ writable: true });
		const person = await rows(kernel.call);
		expect(pick(person, 'greet.general', 'greeting')).toMatchObject({ writable: true });
		expect(pick(person, 'greet.general', 'greeting')?.reason).toBeUndefined();
		// Only those that allow the level asked for.
		const atWorkspace = await kernel.call<{ values: Array<{ section: string }> }>('setting-list', {
			level: 'workspace',
			section: 'greet.general',
		});
		expect(atWorkspace.data?.values).toHaveLength(1);
	});

	it('OWNER_REQUIRED for a workspace value from a member who is no owner, in provider mode', async () => {
		const identity: IdentityV1 = {
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['passkey', 'password'],
		};
		const membership: MembershipV1 = {
			mode: 'provider',
			members: new Map([
				['mock-user-ada@example.com', 'member'],
				['mock-user-olu@example.com', 'owner'],
			]),
			digest: 'd1',
		};
		const { kernel } = await workspace({ identity, membership });
		const as = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		const write = () =>
			kernel.call('setting-set', {
				section: 'loam.documents',
				key: 'trashDays',
				value: 9,
				level: 'workspace',
			});
		await as('ada@example.com');
		expect((await write()).error).toMatchObject({
			code: 'OWNER_REQUIRED',
			suggestion: 'Ask an owner of the workspace to do this',
		});
		// Her own value she sets; the owner sets the workspace's.
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.appearance',
					key: 'density',
					value: 'compact',
					level: 'person',
				})
			).success
		).toBe(true);
		await kernel.call('auth-sign-out');
		await as('olu@example.com');
		expect((await write()).data).toMatchObject({ value: 9, from: 'workspace' });
		// Signed out, nothing is read or written: line 0.
		await kernel.call('auth-sign-out');
		expect(
			(await kernel.call('setting-get', { section: 'loam.documents', key: 'trashDays' })).error
				?.code
		).toBe('UNAUTHORIZED');
	});
});

describe('P4-E1: the settings grant (3.8)', () => {
	it("reads the app's own sections through SettingsV1, and nothing else", async () => {
		const { kernel, scopes } = await workspace();
		await kernel.call(
			'setting-set',
			{ section: 'greet.general', key: 'greeting', value: 'Hi Atlas', level: 'project' },
			{ scope: scopes.atlas }
		);
		await kernel.call('scope-set', { project: 'atlas' });
		expect((await kernel.call<Data>('greet-read')).data).toEqual({ greeting: 'Hi Atlas' });
		expect((await kernel.call<Data>('greet-section')).data).toEqual({ greeting: 'Hi Atlas' });
		// Another app's section, a write, and an app with no grant.
		expect((await kernel.call<Data>('greet-peek')).data).toMatchObject({
			ok: false,
			code: 'SETTING_NOT_OWNED',
		});
		expect((await kernel.call<Data>('greet-write')).data).toMatchObject({
			ok: false,
			code: 'CALL_NOT_GRANTED',
		});
		expect((await kernel.call<Data>('other-read')).data).toMatchObject({
			ok: false,
			code: 'CALL_NOT_GRANTED',
		});
		// Through the port itself, a listing names the app's own sections alone.
		await kernel.call('app-open', { instance: 'greet' });
		const listed = await kernel
			.appPort('greet')
			.call<{ values: Array<{ section: string }> }>('setting-list', {});
		expect(new Set(listed.data?.values.map((row) => row.section))).toEqual(
			new Set(['greet.general', 'greet.project', 'greet.big', 'greet.lists'])
		);
		const shell = await kernel
			.appPort('greet')
			.call('setting-get', { section: 'loam.appearance', key: 'theme' });
		expect(shell.error?.code).toBe('SETTING_NOT_OWNED');
		expect(shell.error?.suggestion).toBe("Read only this app's own sections");
	});
});

const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const OLU_OWNER: MembershipV1 = {
	mode: 'provider',
	members: new Map([['mock-user-olu@example.com', 'owner']]),
	digest: 'd1',
};
const hostedOf = (apps: boolean): ProjectionV4 =>
	({
		...deployment(),
		...(apps ? {} : { apps: [] }),
		deployment_version: 4,
		generation: 'hosted',
		host: { kind: 'hosted', kernel: 'api/kernel' },
	}) as ProjectionV4;

/** A workspace write and its reset, refused as section 13 has it, with nothing written. */
async function expectSharedRefused(kernel: LoamKernel): Promise<void> {
	for (const command of ['setting-set', 'setting-reset']) {
		const refused = await kernel.call(command, {
			section: 'loam.documents',
			key: 'trashDays',
			...(command === 'setting-set' ? { value: 3 } : {}),
			level: 'workspace',
		});
		expect(refused.error?.code, command).toBe('SHARED_RECORD_UNAVAILABLE');
	}
}

describe('P4-E17: a hosted provider deployment refuses shared writes (section 13)', () => {
	it('refuses workspace and project writes, journaled, changing no table; a person-level write succeeds', async () => {
		const { kernel, journal, store } = await workspace({
			identity: PROVIDER,
			membership: OLU_OWNER,
			deployment: hostedOf(true),
		});
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
		const made = await kernel.call<{ id: string }>('project-create', { name: 'Atlas' });
		const atlas = { scope: { workspace: 'personal', project: made.data?.id as string } };
		const before = JSON.stringify((await store.list(SETTING_TABLE)).data);
		const workspaceRow = JSON.stringify((await kernel.call('workspace-get')).data);
		const asked = [
			['setting-set', 'workspace', {}],
			['setting-reset', 'workspace', {}],
			['setting-set', 'project', atlas],
			['setting-reset', 'project', atlas],
		] as const;
		const start = (await journal.read()).length;
		for (const [command, level, options] of asked) {
			// `loam.documents` is workspace-only; the project's case uses an app's key.
			const refused = await kernel.call(
				command,
				{
					...(level === 'project'
						? { section: 'greet.general', key: 'greeting' }
						: { section: 'loam.documents', key: 'trashDays' }),
					...(command === 'setting-set' ? { value: level === 'project' ? 'Hi' : 3 } : {}),
					level,
				},
				options
			);
			expect(refused.error, `${command} at ${level}`).toMatchObject({
				code: 'SHARED_RECORD_UNAVAILABLE',
				suggestion: 'Set it in a local deployment, or wait for the release that serves it',
			});
		}
		expect(JSON.stringify((await store.list(SETTING_TABLE)).data)).toBe(before);
		expect(JSON.stringify((await kernel.call('workspace-get')).data)).toBe(workspaceRow);
		// Each refusal journaled, exactly: by command and level, in order, and nothing else of `setting-*`.
		const journaled = (await journal.read())
			.slice(start)
			.filter((entry) => entry.command.startsWith('setting-'))
			.map((entry) => ({
				command: entry.command,
				level: (entry.input as { level: string }).level,
				code: (entry.result as { error?: { code?: string } }).error?.code,
			}));
		expect(journaled).toEqual(
			asked.map(([command, level]) => ({ command, level, code: 'SHARED_RECORD_UNAVAILABLE' }))
		);
		// A person's own value is theirs, hosted or not.
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.appearance',
					key: 'theme',
					value: 'dark',
					level: 'person',
				})
			).data
		).toMatchObject({ value: 'dark', from: 'person' });
		// The agent interface gets its hand-off first, as section 13's third obligation has it.
		const agent = await kernel.agent.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 3,
			level: 'workspace',
		});
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');
	});

	it('refuses them on a hosted projection that lists no app', async () => {
		const { kernel } = await workspace({
			identity: PROVIDER,
			membership: OLU_OWNER,
			deployment: hostedOf(false),
		});
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
		await expectSharedRefused(kernel);
	});

	it('refuses them, failing closed, when no projection names the host: a failed app load', async () => {
		const auth = new MockAuthAdapter();
		auth._setUser({ id: 'mock-user-olu@example.com', email: 'olu@example.com', name: 'olu' });
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			identity: PROVIDER,
			membership: OLU_OWNER,
			boot: {
				generation: 'g',
				workspace: { id: 'personal', name: 'Personal' },
				apps: [
					{
						instance: 'greet',
						app: 'greet',
						title: 'Greet',
						kind: 'native',
						icon: 'system/folder',
						order: 100,
						scopeLevels: ['workspace'],
						rail: true,
						parts: [],
						layout: {},
						refusal: null,
					},
				],
				identity: PROVIDER,
			} as never,
			appsLoader: () => Promise.reject(new Error('The projection could not be read')),
		});
		kernels.push(kernel);
		vi.stubGlobal('reportError', vi.fn());
		await kernel.startApps();
		vi.unstubAllGlobals();
		await expectSharedRefused(kernel);
	});

	it('lets a static provider deployment write them, as phase 3 runs locally', async () => {
		const { kernel } = await workspace({ identity: PROVIDER, membership: OLU_OWNER });
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
		const set = await kernel.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 3,
			level: 'workspace',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
	});
});

describe('P4-E15: the settings commands replay', () => {
	it('replays a session of writes, resets and refusals with no difference', async () => {
		const { kernel, journal, scopes } = await workspace();
		await kernel.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'Team',
			level: 'workspace',
		});
		await kernel.call(
			'setting-set',
			{ section: 'greet.general', key: 'greeting', value: 'Atlas', level: 'project' },
			{ scope: scopes.atlas }
		);
		await kernel.agent.call('setting-set', {
			section: 'loam.appearance',
			key: 'density',
			value: 'compact',
			level: 'person',
		});
		await kernel.agent.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'No',
			level: 'workspace',
		});
		await kernel.call('setting-reset', {
			section: 'greet.general',
			key: 'greeting',
			level: 'workspace',
		});
		await kernel.call('setting-list', { section: 'greet.general' }, { scope: scopes.atlas });
		await kernel.call('appearance-get');
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment() as ProjectionV4,
			ports: createFixturePorts(packages()) as never,
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe("the review's findings", () => {
	it('B1: an app named `loam` is refused at load, so no app reads the shell sections', async () => {
		const LOAM = manifestOf('loam', ['settings'], [], ['loam-read']);
		const { kernel } = await createScopedWorkspace({
			deployment: {
				...deployment(),
				apps: [{ instance: 'loam', app: 'loam', package: 'fixtures/loam/' }],
			} as ProjectionV3,
			ports: createFixturePorts({
				'fixtures/loam/': {
					manifest: LOAM,
					definition: defineApp({
						sdk: 1,
						handlers: {
							'loam-read': (async (_input: unknown, context: AppCallContextV1) =>
								asResult(
									await context.client.call('setting-get', {
										section: 'loam.appearance',
										key: 'theme',
									})
								)) as never,
						},
					}),
				},
			}) as never,
		});
		kernels.push(kernel);
		const app = await kernel.call<{ state: string; error?: { code: string } }>('app-get', {
			instance: 'loam',
		});
		expect(app.data?.state).toBe('refused');
		expect(app.data?.error?.code).toBe('MANIFEST_ID_RESERVED');
		expect((await kernel.call('loam-read')).success).toBe(false);
	});

	it('B1: ownership is the declaring app, never a prefix of the id', async () => {
		const { kernel } = await workspace();
		await kernel.call('app-open', { instance: 'greet' });
		const port = kernel.appPort('greet');
		for (const section of ['loam.appearance', 'loam.documents', 'other.prefs']) {
			const read = await port.call('setting-list', { section });
			expect(read.error?.code, section).toBe('SETTING_NOT_OWNED');
		}
		const own = await port.call<{ values: Array<{ section: string }> }>('setting-list', {
			section: 'greet.general',
		});
		expect(own.data?.values.map((row) => row.section)).toEqual(['greet.general']);
	});

	it("I1: writable reads the project's refusal: archived, or an app the project does not open", async () => {
		const { kernel, scopes } = await workspace();
		await kernel.call('project-archive', { project: 'atlas' });
		const listed = await kernel.call<{
			values: Array<{ key: string; writable: boolean; reason?: string }>;
		}>('setting-list', { section: 'greet.general', level: 'project' }, { scope: scopes.atlas });
		expect(listed.data?.values[0]).toMatchObject({ writable: false, reason: 'PROJECT_ARCHIVED' });
	});

	it('I3: a named section over the budget is told to name a key', async () => {
		const { kernel } = await workspace();
		const over = await kernel.call('setting-schema-get', { section: 'greet.big' });
		expect(over.error).toMatchObject({
			code: 'OUTPUT_BUDGET_EXCEEDED',
			suggestion: 'Name a key: setting-schema-get { section, key }',
		});
		expect(
			(await kernel.call('setting-schema-get', { section: 'greet.big', key: 'k0' })).success
		).toBe(true);
	});

	it("I7: setting-reset's undo carries expected, the value the level shows after the reset", async () => {
		const { kernel } = await workspace();
		await kernel.call('setting-set', {
			section: 'greet.general',
			key: 'greeting',
			value: 'Team',
			level: 'workspace',
		});
		const reset = await kernel.call('setting-reset', {
			section: 'greet.general',
			key: 'greeting',
			level: 'workspace',
		});
		expect(reset).toMatchObject({
			undoCommand: 'setting-set',
			undoArgs: { value: 'Team', expected: 'Hello', level: 'workspace' },
		});
		expect((await kernel.call('setting-set', reset.undoArgs as Data)).data).toMatchObject({
			value: 'Team',
		});
	});
});

describe("the second review's findings", () => {
	it('A: a read returns a detached copy: changing it changes no later read', async () => {
		const { kernel } = await workspace();
		const first = await kernel.call<{ value: string[] }>('setting-get', {
			section: 'greet.lists',
			key: 'tags',
		});
		first.data?.value.push('b');
		const schema = await kernel.call<{
			sections: Array<{ schema: { properties: Record<string, { default: unknown }> } }>;
		}>('setting-schema-get', { section: 'greet.lists' });
		const shown = schema.data?.sections[0]?.schema.properties.tags?.default as string[];
		shown.push('c');
		const listed = await kernel.call<{ values: Array<{ value: string[] }> }>('setting-list', {
			section: 'greet.lists',
		});
		listed.data?.values[0]?.value.push('c');
		expect(
			(
				await kernel.call<{ value: string[] }>('setting-get', {
					section: 'greet.lists',
					key: 'tags',
				})
			).data?.value
		).toEqual(['a']);
		const again = await kernel.call<{
			sections: Array<{ schema: { properties: Record<string, { default: unknown }> } }>;
		}>('setting-schema-get', { section: 'greet.lists' });
		expect(again.data?.sections[0]?.schema.properties.tags?.default).toEqual(['a']);
		await kernel.call('setting-set', {
			section: 'greet.lists',
			key: 'tags',
			value: ['b'],
			level: 'workspace',
		});
		const stored = await kernel.call<{ value: string[] }>('setting-get', {
			section: 'greet.lists',
			key: 'tags',
		});
		stored.data?.value.push('a');
		expect(
			(
				await kernel.call<{ value: string[] }>('setting-get', {
					section: 'greet.lists',
					key: 'tags',
				})
			).data?.value
		).toEqual(['b']);
	});

	it('B: overlapping writes with the same expected: one writes, the other is SETTING_CONFLICT, retryable', async () => {
		const { kernel } = await workspace();
		const write = (value: string) =>
			kernel.call('setting-set', {
				section: 'greet.general',
				key: 'greeting',
				value,
				level: 'workspace',
				expected: 'Hello',
			});
		const answers = await Promise.all([write('One'), write('Two')]);
		expect(answers.map((answer) => answer.success)).toEqual([true, false]);
		expect(answers[1]?.error).toMatchObject({
			code: 'SETTING_CONFLICT',
			retryable: true,
			details: { current: 'One', expected: 'Hello' },
		});
		expect(
			(await kernel.call<Data>('setting-get', { section: 'greet.general', key: 'greeting' })).data
		).toMatchObject({ value: 'One' });
	});

	it('C: trashDays and the workspace row are written in one store batch', async () => {
		const { kernel, store } = await workspace();
		const batch = vi.spyOn(store, 'batch');
		await kernel.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 9,
			level: 'workspace',
		});
		const paths = batch.mock.calls.map((call) =>
			(call[0] as Array<{ path: string }>).map((operation) => operation.path)
		);
		expect(paths).toContainEqual([
			`/setting/${encodeURIComponent('personal/loam.documents/workspace')}`,
			'/workspace/personal',
		]);
		await kernel.call('setting-reset', {
			section: 'loam.documents',
			key: 'trashDays',
			level: 'workspace',
		});
		// The setting's own batch; the bus's projection writes its own after it (phase 5's 9.2).
		const last = batch.mock.calls
			.map((call) => call[0] as Array<{ method: string; path: string }>)
			.filter((operations) =>
				operations.some((operation) => operation.path.startsWith('/setting/'))
			)
			.at(-1) as Array<{ method: string; path: string }>;
		expect(last.map((operation) => [operation.method, operation.path])).toEqual([
			['DELETE', `/setting/${encodeURIComponent('personal/loam.documents/workspace')}`],
			['PUT', '/workspace/personal'],
		]);
		expect((await kernel.call<WorkspaceV1>('workspace-get')).data?.trashDays).toBe(30);
	});
});
