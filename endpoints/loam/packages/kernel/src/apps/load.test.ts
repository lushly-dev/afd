import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import {
	LAYOUT_DEFAULTS_V0 as MANIFEST_DEFAULTS,
	SHELL_RESERVED_CHORDS_V1,
} from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS_V0, SHELL_KEYBINDINGS_V0 } from '../index.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createTestKernel,
	type FixturePackage,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
} from '../testing.js';
import type { AppDetailV1, AppInstanceV1, AppSummaryV1, LoamKernelV2 } from '../types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

type Apps = Parameters<typeof probeDeployment>[0];

async function boot(
	apps: Apps,
	packages: Record<string, FixturePackage>,
	sandboxOrigin: string | null = null
) {
	const ports = createFixturePorts(packages);
	const { kernel, journal } = await createTestKernel({
		deployment: probeDeployment(apps, sandboxOrigin),
		ports,
		environment: createFixedEnvironment(),
	});
	kernels.push(kernel);
	return { kernel, journal, ports };
}

const entry = (instance: string, app = instance, extra: Record<string, unknown> = {}) => ({
	instance,
	app,
	package: `apps/${instance}/`,
	...extra,
});

/** A small native manifest, varied per test. */
function manifest(id: string, extra: Partial<ManifestV1> = {}): ManifestV1 {
	return {
		manifest_version: 1,
		protocol: 1,
		plugin: {
			id,
			title: id,
			version: '0.1.0',
			description: `The ${id} fixture.`,
			kind: 'native',
			domains: [id],
		},
		native: { entry: 'dist/native.js' },
		...extra,
	} as ManifestV1;
}

const mountedManifest = (id = 'umbel', transport: 'http' | 'stdio' = 'http') =>
	manifest(id, {
		plugin: {
			id,
			title: id,
			version: '0.1.0',
			description: `The ${id} fixture.`,
			kind: 'mounted',
			domains: [id],
		},
		native: undefined,
		mount: { prefix: id, transport },
	});

async function statusOf(kernel: LoamKernelV2, instance: string): Promise<AppSummaryV1 | undefined> {
	const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
	return data?.apps.find((app) => app.instance === instance);
}

describe('constants shared with the manifest', () => {
	it('holds the reserved chords equal to the kernel bindings', () => {
		expect(SHELL_RESERVED_CHORDS_V1).toEqual(SHELL_KEYBINDINGS_V0.map((binding) => binding.chord));
	});

	it('re-exports the layout defaults from the manifest package', () => {
		expect(LAYOUT_DEFAULTS_V0).toBe(MANIFEST_DEFAULTS);
	});
});

describe('E8: grants', () => {
	it('refuses a grant outside the catalog, and the rest of the shell works', async () => {
		const { kernel } = await boot([entry('bad'), entry('probe')], {
			'apps/bad/': { manifest: manifest('bad', { grants: [{ name: 'teleport', reason: 'r' }] }) },
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const bad = await statusOf(kernel, 'bad');
		expect(bad?.state).toBe('refused');
		expect(bad?.error?.code).toBe('GRANT_UNKNOWN');
		expect(bad?.error?.suggestion).toBeTruthy();
		expect((await statusOf(kernel, 'probe'))?.state).toBe('ready');
		expect((await kernel.call('probe-list')).success).toBe(true);
	});

	it('refuses a required grant phase 1 does not serve, naming its phase', async () => {
		const { kernel } = await boot([entry('bad')], {
			'apps/bad/': { manifest: manifest('bad', { grants: [{ name: 'settings', reason: 'r' }] }) },
		});
		const bad = await statusOf(kernel, 'bad');
		expect(bad?.error?.code).toBe('GRANT_UNAVAILABLE');
		expect(`${bad?.error?.message} ${bad?.error?.suggestion}`).toMatch(/phase 4/i);
	});

	it('loads an optional unserved grant without its API, and app-get says so', async () => {
		const seen: Record<string, unknown> = {};
		const app = manifest('opt', {
			// `settings` is served from phase 4; `documents`, which this used, from step 9.
			grants: [{ name: 'settings', required: false, reason: 'Later.' }],
			commands: [
				{
					name: 'opt-read',
					description: 'Reads what the context holds.',
					effects: ['inspect'],
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
				},
			],
		});
		const { kernel } = await boot([entry('opt')], {
			'apps/opt/': {
				manifest: app,
				definition: {
					sdk: 1,
					handlers: {
						'opt-read': (async (_input: never, context: Record<string, unknown>) => {
							Object.assign(seen, { keys: Object.keys(context) });
							return { success: true, data: {} };
						}) as never,
					},
				},
			},
		});
		const detail = (await kernel.call<AppDetailV1>('app-get', { instance: 'opt' })).data;
		expect(detail?.state).toBe('ready');
		expect(detail?.grants).toEqual([
			{ name: 'settings', required: false, served: false, reason: 'Later.' },
		]);
		expect((await kernel.call('opt-read')).success).toBe(true);
		// No grant: no store, no clock and no random reach the handler.
		expect(seen.keys).toEqual(expect.arrayContaining(['traceId', 'config', 'client']));
		for (const absent of ['store', 'now', 'random', 'projects']) {
			expect(seen.keys).not.toContain(absent);
		}
	});

	it('gives each API only with its grant', async () => {
		const seen: { keys?: string[] } = {};
		const definition = probeDefinition();
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': {
				manifest: PROBE_MANIFEST,
				definition: {
					...definition,
					handlers: {
						...definition.handlers,
						'probe-hidden': (async (_input: never, context: Record<string, unknown>) => {
							seen.keys = Object.keys(context);
							return { success: true, data: {} };
						}) as never,
					},
				},
			},
		});
		await kernel.agent.call('probe-hidden');
		expect(seen.keys).toEqual(expect.arrayContaining(['store', 'now', 'random']));
	});

	it('refuses an id that is a shell domain', async () => {
		const { kernel } = await boot([entry('layout')], {
			'apps/layout/': { manifest: manifest('layout') },
		});
		expect((await statusOf(kernel, 'layout'))?.error?.code).toBe('MANIFEST_ID_RESERVED');
	});

	it('refuses a command the shell holds, with nothing of that app registered', async () => {
		const app = manifest('view', {
			commands: [
				{
					name: 'view-other',
					description: 'A command that would register.',
					effects: ['inspect'],
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
				},
				{
					name: 'view-state-get',
					description: 'A command the shell already holds.',
					effects: ['inspect'],
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
				},
			],
		});
		const { kernel } = await boot([entry('view')], { 'apps/view/': { manifest: app } });
		const status = await statusOf(kernel, 'view');
		expect(status?.state).toBe('refused');
		expect(status?.error?.code).toBe('APP_COMMAND_CONFLICT');
		const names = kernel.listCommands().map((command) => command.name);
		expect(names).not.toContain('view-other');
		expect(
			kernel.listCommands().find((c) => c.name === 'view-state-get')?.instance
		).toBeUndefined();
		expect((await kernel.call('view-other')).error?.code).toBe('COMMAND_NOT_FOUND');
	});

	it('refuses the later of two apps with one id', async () => {
		const { kernel } = await boot([entry('probe'), entry('again', 'probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
			'apps/again/': { manifest: PROBE_MANIFEST },
		});
		expect((await statusOf(kernel, 'probe'))?.state).toBe('ready');
		const again = await statusOf(kernel, 'again');
		expect(again?.state).toBe('refused');
		expect(again?.error?.code).toBe('APP_DOMAIN_CONFLICT');
	});
});

describe('section 10: a bad app is reported and never stops the kernel', () => {
	it('refuses an unknown surface with the list of surfaces, and opening it explains why', async () => {
		const raw = { ...PROBE_MANIFEST, ui: { surfaces: { tray: {} } } };
		const { kernel } = await boot([entry('probe')], { 'apps/probe/': { manifest: raw } });
		const status = await statusOf(kernel, 'probe');
		expect(status?.state).toBe('refused');
		expect(status?.error?.code).toBe('MANIFEST_UNKNOWN_SURFACE');
		expect(status?.error?.suggestion).toContain('sidebar');
		const opened = await kernel.call('app-open', { instance: 'probe' });
		expect(opened.success).toBe(true);
		expect(
			(await kernel.call<AppDetailV1>('app-get', { instance: 'probe' })).data?.error?.code
		).toBe('MANIFEST_UNKNOWN_SURFACE');
		expect(() => kernel.appPort('probe')).toThrow(/no port/);
	});

	it('refuses a package it cannot fetch', async () => {
		const { kernel } = await boot([entry('gone')], {});
		const gone = await statusOf(kernel, 'gone');
		expect(gone?.state).toBe('refused');
		expect(gone?.error?.code).toBe('APP_PACKAGE_UNAVAILABLE');
		expect(gone?.title).toBe('gone');
	});

	it('refuses every app when the host gives no ports, and does not reject', async () => {
		const { kernel } = await createTestKernel({ deployment: probeDeployment([entry('probe')]) });
		kernels.push(kernel);
		expect((await statusOf(kernel, 'probe'))?.error?.code).toBe('APP_PACKAGE_UNAVAILABLE');
	});

	it('refuses an entry whose app is not the package', async () => {
		const { kernel } = await boot([entry('other')], {
			'apps/other/': { manifest: PROBE_MANIFEST },
		});
		expect((await statusOf(kernel, 'other'))?.error?.code).toBe('DEPLOYMENT_APP_MISMATCH');
	});

	it('refuses a mounted key on a native entry and an instance named otherwise', async () => {
		const { kernel } = await boot(
			[entry('probe', 'probe', { prefix: 'x' }), entry('alias', 'sums')],
			{
				'apps/probe/': { manifest: PROBE_MANIFEST },
				'apps/alias/': { manifest: manifest('sums') },
			}
		);
		expect((await statusOf(kernel, 'probe'))?.error?.code).toBe('DEPLOYMENT_INSTANCE_MISMATCH');
		expect((await statusOf(kernel, 'alias'))?.error?.code).toBe('DEPLOYMENT_INSTANCE_MISMATCH');
	});

	it('answers a config that fails its schema with paths and rules, never values', async () => {
		const { kernel } = await boot(
			[
				entry('probe', 'probe', { config: { greeting: { secret: 'hunter2' } } }),
				entry('sums', 'sums', { config: { a: 1 } }),
			],
			{
				'apps/probe/': { manifest: PROBE_MANIFEST },
				'apps/sums/': { manifest: manifest('sums') },
			}
		);
		const probe = await statusOf(kernel, 'probe');
		expect(probe?.error?.code).toBe('APP_CONFIG_INVALID');
		expect(JSON.stringify(probe?.error)).not.toContain('hunter2');
		const sums = await statusOf(kernel, 'sums');
		expect(sums?.error?.message).toContain('no `config.schema`');
	});

	it('fails a view with no sandbox, or one on the shell origin', async () => {
		const packages = {
			'apps/probev/': { manifest: probeViewManifest() },
		};
		const none = await boot([entry('probev')], packages);
		const first = await statusOf(none.kernel, 'probev');
		expect(first?.state).toBe('failed');
		expect(first?.error?.code).toBe('VIEW_SANDBOX_ORIGIN_INVALID');
		const same = await boot([entry('probev')], packages, none.ports.baseUrl.slice(0, -1));
		expect((await statusOf(same.kernel, 'probev'))?.error?.code).toBe(
			'VIEW_SANDBOX_ORIGIN_INVALID'
		);
		const called = await none.kernel.call('probev-list');
		expect(called.error?.code).toBe('APP_NOT_READY');
		expect(called.error?.details?.cause).toBe('VIEW_SANDBOX_ORIGIN_INVALID');
	});

	it('refuses a sandbox origin it cannot parse', async () => {
		const { kernel } = await boot(
			[entry('probev')],
			{ 'apps/probev/': { manifest: probeViewManifest() } },
			'not a url'
		);
		expect((await statusOf(kernel, 'probev'))?.error?.code).toBe('VIEW_SANDBOX_ORIGIN_INVALID');
	});

	it('names a schema it cannot express at load', async () => {
		const app = manifest('odd', {
			commands: [
				{
					name: 'odd-run',
					description: 'A command whose schema the reader refuses.',
					effects: ['inspect'],
					input_schema: { not: { type: 'string' } },
				},
			],
		});
		const { kernel } = await boot([entry('odd')], { 'apps/odd/': { manifest: app } });
		expect((await statusOf(kernel, 'odd'))?.error?.code).toBe('MANIFEST_INPUT_SCHEMA_INVALID');
	});
});

describe('mounted instances before discovery', () => {
	const mounted = (instance: string, extra: Record<string, unknown> = {}) =>
		entry(instance, 'umbel', {
			audience: 'person',
			transport: 'http',
			route: `mounts/${instance}/mcp`,
			...extra,
		});

	it('lists an instance as loading until it is discovered, with no location or credential', async () => {
		const { kernel, journal } = await boot(
			[mounted('work', { prefix: 'work', audience: 'team' })],
			{ 'apps/work/': { manifest: mountedManifest() } }
		);
		const { data } = await kernel.call<{ instances: AppInstanceV1[] }>('app-instance-list');
		expect(data?.instances).toEqual([
			expect.objectContaining({
				instance: 'work',
				app: 'umbel',
				prefix: 'work',
				audience: 'team',
				transport: 'http',
				state: 'loading',
				commands: 0,
			}),
		]);
		expect(data?.instances[0]?.notices.map((notice) => notice.code)).toEqual([
			'MOUNT_ANNOTATIONS_UNTRUSTED',
			'TEAM_INSTANCE_SINGLE_PRINCIPAL',
		]);
		const refresh = await kernel.call('app-instance-refresh', { instance: 'work' });
		expect(refresh.error?.code).toBe('MOUNT_UNREACHABLE');
		await kernel.startInstances();
		const refreshes = (await journal.read()).filter(
			(journalEntry) => journalEntry.command === 'app-instance-refresh'
		);
		expect(refreshes).toHaveLength(2);
	});

	it('refuses a refresh of what is not a mounted instance', async () => {
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST },
		});
		expect((await kernel.call('app-instance-refresh', { instance: 'probe' })).error?.code).toBe(
			'APP_NOT_FOUND'
		);
	});

	it('fails a stdio instance, and refuses a team one over stdio', async () => {
		const { kernel } = await boot(
			[
				entry('home', 'umbel', { audience: 'person', transport: 'stdio' }),
				entry('team', 'umbelt', { prefix: 'team', audience: 'team', transport: 'stdio' }),
				entry('none', 'umbeln', { prefix: 'none' }),
			],
			{
				'apps/home/': { manifest: mountedManifest() },
				'apps/team/': { manifest: mountedManifest('umbelt') },
				'apps/none/': { manifest: mountedManifest('umbeln') },
			}
		);
		const home = await statusOf(kernel, 'home');
		expect(home?.state).toBe('failed');
		expect(home?.error?.code).toBe('MOUNT_TRANSPORT_UNAVAILABLE');
		expect((await statusOf(kernel, 'team'))?.error?.code).toBe('DEPLOYMENT_TEAM_NEEDS_HTTP');
		expect((await statusOf(kernel, 'none'))?.error?.code).toBe('DEPLOYMENT_AUDIENCE_REQUIRED');
	});

	it('lets a refused entry hold its domain, as deployment check does', async () => {
		const { kernel } = await boot(
			[entry('reports'), mounted('work', { prefix: 'reports' }), mounted('other')],
			{
				'apps/reports/': { manifest: { bad: true } },
				'apps/work/': { manifest: mountedManifest() },
				'apps/other/': { manifest: mountedManifest() },
			}
		);
		expect((await statusOf(kernel, 'work'))?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
		expect((await statusOf(kernel, 'other'))?.error?.code).toBe('INSTANCE_PREFIX_REQUIRED');
		const refreshed = await kernel.call('app-instance-refresh', { instance: 'work' });
		expect(refreshed.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
	});

	it('refuses a repeated prefix with the exact message, a shell domain, and a missing prefix', async () => {
		const { kernel } = await boot(
			[
				mounted('work', { prefix: 'umbel' }),
				mounted('home', { prefix: 'umbel' }),
				mounted('over', { prefix: 'layout' }),
				mounted('bare'),
			],
			{
				'apps/work/': { manifest: mountedManifest() },
				'apps/home/': { manifest: mountedManifest() },
				'apps/over/': { manifest: mountedManifest() },
				'apps/bare/': { manifest: mountedManifest() },
			}
		);
		const home = await statusOf(kernel, 'home');
		expect(home?.state).toBe('refused');
		expect(home?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
		expect(home?.error?.message).toBe(
			'Command prefix `umbel` is already used by instance `work`; choose another prefix for `home`.'
		);
		expect((await statusOf(kernel, 'over'))?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
		expect((await statusOf(kernel, 'bare'))?.error?.code).toBe('INSTANCE_PREFIX_REQUIRED');
	});
});

describe('app-list and app-get', () => {
	it('sorts by order then instance, with the entry over the manifest', async () => {
		const { kernel } = await boot(
			[
				entry('zeta', 'zeta', { order: 5, title: 'Last name' }),
				entry('probe'),
				entry('alpha'),
				entry('beta'),
			],
			{
				'apps/zeta/': { manifest: manifest('zeta') },
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				'apps/alpha/': { manifest: manifest('alpha') },
				'apps/beta/': { manifest: manifest('beta') },
			}
		);
		const { data } = await kernel.call<{ active: null; apps: AppSummaryV1[] }>('app-list');
		expect(data?.active).toBeNull();
		expect(data?.apps.map((app) => [app.instance, app.order, app.title, app.icon])).toEqual([
			['zeta', 5, 'Last name', 'system/folder'],
			['probe', 10, 'Probe', 'system/document'],
			['alpha', 100, 'alpha', 'system/folder'],
			['beta', 100, 'beta', 'system/folder'],
		]);
	});

	it('reports a native app as trusted, not sandboxed, with what its manifest says', async () => {
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const detail = (await kernel.call<AppDetailV1>('app-get', { instance: 'probe' })).data;
		expect(detail?.version).toBe('1.2.3');
		expect(detail?.trust).toBe('trusted');
		expect(detail?.trustLine).toContain('Trusted, not sandboxed');
		expect(detail?.surfaces).toContain('sidebar');
		// `projects` is served from phase 2's step 4.
		expect(detail?.grants.map((grant) => grant.served)).toEqual([true, true, true, true]);
		expect((await kernel.call('app-get', { instance: 'nope' })).error?.code).toBe('APP_NOT_FOUND');
	});

	it('lists one app with its schemas and how many are hidden', async () => {
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const { data } = await kernel.call<{
			commands: Array<{
				name: string;
				inputSchema: { required?: string[] };
				needsInput: boolean;
				instance: string;
			}>;
			hidden: number;
		}>('app-command-list', { instance: 'probe' });
		expect(data?.hidden).toBe(1);
		expect(data?.commands.map((command) => command.name)).not.toContain('probe-hidden');
		const note = data?.commands.find((command) => command.name === 'probe-note');
		expect(note?.inputSchema.required).toEqual(['text']);
		expect(note?.needsInput).toBe(true);
		expect(note?.instance).toBe('probe');
		expect((await kernel.call('app-command-list', { instance: 'x' })).error?.code).toBe(
			'APP_NOT_FOUND'
		);
	});

	it('answers an empty list with no deployment', async () => {
		const { kernel } = await createTestKernel();
		kernels.push(kernel);
		expect((await kernel.call('app-list')).data).toEqual({ active: null, apps: [] });
		expect((await kernel.call('app-instance-list')).data).toEqual({ instances: [] });
		expect((await kernel.call('app-open', { instance: 'x' })).error?.code).toBe('APP_NOT_FOUND');
		expect(() => kernel.appPort('x')).toThrow(/No app instance/);
	});
});

describe('the keybindings registry', () => {
	it('adds the active app chords after the reserved ones, and lists them with commands', async () => {
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const reserved = SHELL_KEYBINDINGS_V0.map((binding) => binding.chord);
		expect(kernel.listKeybindings().map((binding) => binding.chord)).toEqual(reserved);
		expect(kernel.listCommands().find((c) => c.name === 'probe-list')?.keybinding).toBe(
			'Mod+Shift+L'
		);
		await kernel.call('app-open', { instance: 'probe' });
		expect(kernel.listKeybindings().at(-1)).toEqual({
			chord: 'Mod+Shift+L',
			command: 'probe-list',
		});
		await kernel.call('app-close');
		expect(kernel.listKeybindings().map((binding) => binding.chord)).toEqual(reserved);
	});

	it('refuses the later app chord, reports it and leaves the app loaded', async () => {
		const chord = (id: string): Partial<ManifestV1> => ({
			commands: [
				{
					name: `${id}-run`,
					description: 'Runs with no input.',
					effects: ['inspect'],
					input_schema: { type: 'object', properties: {}, additionalProperties: false },
				},
			],
			ui: { surfaces: { keybindings: [{ chord: 'Mod+Shift+R', command: `${id}-run` }] } },
		});
		const { kernel } = await boot([entry('one'), entry('two')], {
			'apps/one/': { manifest: manifest('one', chord('one')) },
			'apps/two/': { manifest: manifest('two', chord('two')) },
		});
		const two = (await kernel.call<AppDetailV1>('app-get', { instance: 'two' })).data;
		expect(two?.state).toBe('ready');
		expect(two?.notices).toEqual([expect.objectContaining({ code: 'KEYBINDING_CONFLICT' })]);
		await kernel.call('app-open', { instance: 'two' });
		expect(kernel.listKeybindings().map((binding) => binding.chord)).not.toContain('Mod+Shift+R');
	});

	it('binds no chord to a command that needs input', async () => {
		const app = manifest('needy', {
			commands: [
				{
					name: 'needy-run',
					description: 'Needs a name.',
					effects: ['inspect'],
					input_schema: {
						type: 'object',
						properties: { name: { type: 'string' } },
						required: ['name'],
						additionalProperties: false,
					},
				},
			],
			ui: { surfaces: { keybindings: [{ chord: 'Mod+Shift+N', command: 'needy-run' }] } },
		});
		const { kernel } = await boot([entry('needy')], { 'apps/needy/': { manifest: app } });
		const detail = (await kernel.call<AppDetailV1>('app-get', { instance: 'needy' })).data;
		expect(detail?.notices).toEqual([expect.objectContaining({ code: 'KEYBINDING_NEEDS_INPUT' })]);
		await kernel.call('app-open', { instance: 'needy' });
		expect(kernel.listKeybindings().map((binding) => binding.chord)).not.toContain('Mod+Shift+N');
	});
});

describe('listCommands and the palette', () => {
	it('names each command instance, hides internal commands, and filters search by active app', async () => {
		const { kernel } = await boot([entry('probe')], {
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const listed = kernel.listCommands();
		expect(listed.find((command) => command.name === 'probe-list')?.instance).toBe('probe');
		expect(listed.find((command) => command.name === 'layout-get')?.instance).toBeUndefined();
		for (const internal of ['app-call-refuse', 'app-nested-refuse']) {
			expect(listed.map((command) => command.name)).not.toContain(internal);
			expect(kernel.agent.listCommands().map((command) => command.name)).not.toContain(internal);
		}
		expect(kernel.agent.listCommands().map((command) => command.name)).toContain('probe-hidden');
		expect(listed.map((command) => command.name)).not.toContain('probe-hidden');

		const search = async () =>
			(
				await kernel.call<{ items: Array<{ name: string }> }>('palette-search', {
					query: 'probe',
					limit: 50,
				})
			).data?.items
				.map((item) => item.name)
				// The shell's `project-*` match the query too.
				.filter((name) => name.startsWith('probe-'));
		expect(await search()).toEqual([]);
		await kernel.call('app-open', { instance: 'probe' });
		expect(await search()).toContain('probe-list');
		await kernel.call('app-close');
		expect(await search()).toEqual([]);
		expect((await kernel.call('probe-list')).success).toBe(true);
	});
});
