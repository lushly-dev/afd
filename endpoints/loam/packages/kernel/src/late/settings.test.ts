/**
 * Phase 4's settings core (its section 3, step 1): the five `setting-*` commands, the `settings` grant, the hosted
 * refusal (P4-E17) and every error code step 1 adds, on a workspace whose apps declare sections. Appearance taken
 * over (P4-E3) is in `settings-appearance.test.ts`; that settings grant nothing (P4-E2) in `scope/persona-sweep.test.ts`.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { IdentityV1, ManifestV2, ProjectionV3, ProjectionV4 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, success } from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { MembershipV1 } from '../scope/access.js';
import { createScopedWorkspace, type ScopedWorkspace } from '../scope/fixtures.js';
import { createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernelV5, WorkspaceV1 } from '../types.js';
import { SETTING_TABLE } from './settings.js';

const kernels: LoamKernelV5[] = [];
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
): ManifestV2 {
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
	} as unknown as ManifestV2;
}

const keys = (properties: Record<string, unknown>) => ({
	type: 'object',
	properties,
	additionalProperties: false,
});

/** Over 16 KiB with its defaults alone, so any write of it is `SETTING_TOO_LARGE`. */
const BIG = Object.fromEntries(
	Array.from({ length: 18 }, (_, index) => [
		`k${index}`,
		{ type: 'string', title: `K${index}`, maxLength: 1000, default: 'x'.repeat(990) },
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

describe('setting-schema-get (3.9)', () => {
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

describe('setting-set, setting-get and setting-reset (3.2, 3.3, 3.9)', () => {
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
			retryable: false,
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
			value: 'short',
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
			['greet.general/workspace', 'local'],
		]);
		expect(rows[0]?.values.greeting).toMatchObject({ value: 'Team', updatedBy: 'local' });
		await kernel.call('workspace-app-set', { instance: 'greet', enabled: false });
		expect(
			(await kernel.call('setting-get', { section: 'greet.general', key: 'greeting' })).error?.code
		).toBe('SETTING_NOT_FOUND');
	});
});

describe('who writes (3.2): the agent interface, the hand-off and the owner', () => {
	it("an agent writes its person's own value, as agent:<id>, and hands off a shared one", async () => {
		const { kernel, scopes } = await workspace();
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
		const rows = async (call: LoamKernelV5['call']) =>
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

describe('the settings grant (3.8)', () => {
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
			new Set(['greet.general', 'greet.project', 'greet.big'])
		);
		const shell = await kernel
			.appPort('greet')
			.call('setting-get', { section: 'loam.appearance', key: 'theme' });
		expect(shell.error?.code).toBe('SETTING_NOT_OWNED');
		expect(shell.error?.suggestion).toBe("Read only this app's own sections");
	});
});

describe('P4-E17: a hosted provider deployment refuses shared writes (section 13)', () => {
	it('refuses workspace and project writes, journaled, changing no table; a person-level write succeeds', async () => {
		const identity: IdentityV1 = {
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['passkey', 'password'],
		};
		const membership: MembershipV1 = {
			mode: 'provider',
			members: new Map([['mock-user-olu@example.com', 'owner']]),
			digest: 'd1',
		};
		const hosted: ProjectionV4 = {
			...deployment(),
			deployment_version: 4,
			generation: 'hosted',
			host: { kind: 'hosted', kernel: 'api/kernel' },
		} as ProjectionV4;
		const { kernel, journal, store } = await workspace({
			identity,
			membership,
			deployment: hosted,
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
		for (const [command, level, options] of [
			['setting-set', 'workspace', {}],
			['setting-reset', 'workspace', {}],
			['setting-set', 'project', atlas],
			['setting-reset', 'project', atlas],
		] as const) {
			// `loam.documents` is workspace-only; the project's case uses an app's key.
			const asked = await kernel.call(
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
			expect(asked.error, `${command} at ${level}`).toMatchObject({
				code: 'SHARED_RECORD_UNAVAILABLE',
				suggestion: 'Set it in a local deployment, or wait for the release that serves it',
			});
		}
		expect(JSON.stringify((await store.list(SETTING_TABLE)).data)).toBe(before);
		expect(JSON.stringify((await kernel.call('workspace-get')).data)).toBe(workspaceRow);
		const journaled = (await journal.read()).filter(
			(entry) =>
				(entry.command === 'setting-set' || entry.command === 'setting-reset') &&
				(entry.result as { error?: { code?: string } }).error?.code === 'SHARED_RECORD_UNAVAILABLE'
		);
		expect(journaled.length).toBeGreaterThanOrEqual(4);
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
	});
});

describe('P4-E15, in part: the settings commands replay', () => {
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
