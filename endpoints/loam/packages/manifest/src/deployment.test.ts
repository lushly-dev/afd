import { describe, expect, it } from 'vitest';
import { readDeployment } from './read-deployment.js';
import { readProjection } from './read-projection.js';

// The specification's example (3.1), read as JSON, with a server path for the home directory.
const FILE = {
	deployment_version: 1,
	sandbox: { origin: 'https://sandbox.example.com' },
	apps: {
		hello: {
			app: 'hello',
			package: '../apps/hello/dist/package',
			order: 10,
			config: { default_name: 'friend' },
		},
		work: {
			app: 'umbel',
			package: './apps/umbel',
			title: 'Work knowledge',
			prefix: 'work',
			audience: 'team',
			transport: 'http',
			url: 'http://127.0.0.1:7410/mcp',
			bearer_file: '/srv/work-umbel/state/keys/http.token',
			projects: ['atlas', 'borealis'],
			space: { atlas: 'atlas', borealis: 'default' },
			expose: { agent: true, palette: true },
			commands: {
				'work-event-ack': { expose: { palette: true }, effects: ['plugin-state'] },
			},
		},
		home: {
			app: 'umbel',
			package: './apps/umbel',
			prefix: 'home',
			audience: 'person',
			transport: 'stdio',
			command: ['umbel', '--workspace', '/srv/notes-umbel', 'serve', '--stdio'],
		},
	},
};

// The phase 1 specification's example (3.2), as version 2 writes it (phase 2 specification, 2.2).
const PROJECTION = {
	deployment_version: 2,
	generation: `sha256-${'3b7e9f'.padEnd(64, '0')}`,
	workspace: { id: 'acme', name: 'Acme' },
	sandbox_origin: 'https://sandbox.example.com',
	apps: [
		{
			instance: 'hello',
			app: 'hello',
			package: 'apps/hello/',
			order: 10,
			config: { default_name: 'friend' },
			boot: {
				title: 'Hello',
				kind: 'native',
				icon: 'system/document',
				order: 10,
				scope_levels: ['workspace', 'project'],
				rail: true,
				parts: ['sidebar', 'inspector'],
				layout: { sidebar: { open: true, width: 260 }, inspector: { open: false } },
				refusal: null,
			},
		},
		{
			instance: 'work',
			app: 'umbel',
			package: 'apps/work/',
			title: 'Work knowledge',
			prefix: 'work',
			audience: 'team',
			transport: 'http',
			route: 'mounts/work/mcp',
			projects: ['atlas', 'borealis'],
			space: { atlas: 'atlas', borealis: 'default' },
			expose: { agent: true, palette: true },
			commands: { 'work-event-ack': { expose: { palette: true }, effects: ['plugin-state'] } },
		},
		{
			instance: 'home',
			app: 'umbel',
			package: 'apps/home/',
			prefix: 'home',
			audience: 'person',
			transport: 'stdio',
		},
	],
};

// What `vite build` serves (phase 2 specification, 2.2).
const EMPTY = {
	deployment_version: 2,
	generation: 'empty',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: [],
};

const withEntry = (id: string, entry: Record<string, unknown>) => ({
	deployment_version: 1,
	apps: { [id]: entry },
});
const mounted = { app: 'umbel', package: './apps/umbel', audience: 'person' };

function refusalsOf(json: unknown): { code: string; key: string; suggestion: string }[] {
	const read = readDeployment(json);
	return read.ok ? [] : read.refusals;
}

describe('readDeployment', () => {
	it("accepts the specification's example", () => {
		expect(refusalsOf(FILE)).toEqual([]);
		expect(readDeployment(FILE).ok).toBe(true);
	});

	it.each([
		['an unknown root key', { ...FILE, bogus: 1 }, 'DEPLOYMENT_INVALID', 'bogus'],
		[
			'an unknown key in sandbox',
			{ ...FILE, sandbox: { origin: 'https://a.example', bogus: 1 } },
			'DEPLOYMENT_INVALID',
			'sandbox.bogus',
		],
		[
			'an unknown key in an instance',
			withEntry('hello', { app: 'hello', package: 'p', bogus: 1 }),
			'DEPLOYMENT_INVALID',
			'apps.hello.bogus',
		],
		[
			'an unknown key in an override',
			withEntry('work', { ...mounted, commands: { 'work-a': { bogus: 1 } } }),
			'DEPLOYMENT_INVALID',
			'apps.work.commands["work-a"].bogus',
		],
		[
			'a version it does not read',
			{ ...FILE, deployment_version: 3 },
			'DEPLOYMENT_VERSION_UNSUPPORTED',
			'deployment_version',
		],
		[
			'an instance id outside the pattern',
			withEntry('Hello', { app: 'hello', package: 'p' }),
			'DEPLOYMENT_INVALID',
			'apps.Hello',
		],
		[
			'an override name outside the pattern',
			withEntry('work', { ...mounted, commands: { Bad: {} } }),
			'DEPLOYMENT_INVALID',
			'apps.work.commands.Bad',
		],
		[
			'an instance called expose holding a stray key',
			withEntry('expose', { app: 'expose', package: 'p', cli: true }),
			'DEPLOYMENT_INVALID',
			'apps.expose.cli',
		],
		[
			'a native or view instance not named for its app',
			withEntry('other', { app: 'hello', package: 'p' }),
			'DEPLOYMENT_INSTANCE_MISMATCH',
			'apps.other',
		],
		[
			'a mounted key without an audience',
			withEntry('work', { app: 'umbel', package: 'p', prefix: 'work' }),
			'DEPLOYMENT_AUDIENCE_REQUIRED',
			'apps.work.audience',
		],
		[
			'a team instance over stdio',
			withEntry('work', {
				...mounted,
				audience: 'team',
				transport: 'stdio',
				command: ['umbel'],
			}),
			'DEPLOYMENT_TEAM_NEEDS_HTTP',
			'apps.work.transport',
		],
		[
			'two credential keys',
			withEntry('work', {
				...mounted,
				transport: 'http',
				url: 'https://a.example/mcp',
				bearer_file: '/a',
				bearer_env: 'A',
			}),
			'DEPLOYMENT_CREDENTIAL_CONFLICT',
			'apps.work.bearer_env',
		],
		[
			'plain http off loopback',
			withEntry('work', { ...mounted, transport: 'http', url: 'http://a.example/mcp' }),
			'DEPLOYMENT_URL_INVALID',
			'apps.work.url',
		],
		[
			'a url that does not parse',
			withEntry('work', { ...mounted, transport: 'http', url: 'nonsense' }),
			'DEPLOYMENT_URL_INVALID',
			'apps.work.url',
		],
		[
			'a url of another scheme',
			withEntry('work', { ...mounted, transport: 'http', url: 'ftp://a.example/mcp' }),
			'DEPLOYMENT_URL_INVALID',
			'apps.work.url',
		],
		[
			'http without a url',
			withEntry('work', { ...mounted, transport: 'http' }),
			'DEPLOYMENT_TRANSPORT_KEYS',
			'apps.work.url',
		],
		[
			'stdio without a command',
			withEntry('work', { ...mounted, transport: 'stdio' }),
			'DEPLOYMENT_TRANSPORT_KEYS',
			'apps.work.command',
		],
		[
			'a url under stdio',
			withEntry('work', {
				...mounted,
				transport: 'stdio',
				command: ['umbel'],
				url: 'https://a.example/mcp',
			}),
			'DEPLOYMENT_TRANSPORT_KEYS',
			'apps.work.url',
		],
		[
			'a command under http',
			withEntry('work', {
				...mounted,
				transport: 'http',
				url: 'https://a.example/mcp',
				command: ['umbel'],
			}),
			'DEPLOYMENT_TRANSPORT_KEYS',
			'apps.work.command',
		],
		[
			'expose.mcp true',
			withEntry('work', { ...mounted, expose: { mcp: true } }),
			'DEPLOYMENT_EXPOSE_UNAVAILABLE',
			'apps.work.expose.mcp',
		],
		[
			'expose.cli true in an override',
			withEntry('work', { ...mounted, commands: { 'work-a': { expose: { cli: true } } } }),
			'DEPLOYMENT_EXPOSE_UNAVAILABLE',
			'apps.work.commands["work-a"].expose.cli',
		],
		[
			'expose.apps',
			withEntry('work', { ...mounted, expose: { apps: true } }),
			'DEPLOYMENT_EXPOSE_UNAVAILABLE',
			'apps.work.expose.apps',
		],
	])('refuses %s', (_name, json, code, key) => {
		const refusal = refusalsOf(json).find((candidate) => candidate.key === key);
		expect(refusal?.code).toBe(code);
		expect(refusal?.suggestion).not.toBe('');
	});

	it.each(['https://sandbox.example.com;script-src', 'https://Sandbox.example.com', 'https://a"b'])(
		'refuses the sandbox origin %s, which would reach the CSP',
		(origin) => {
			const read = readDeployment({ deployment_version: 1, sandbox: { origin }, apps: {} });
			expect(read.ok).toBe(false);
			if (!read.ok)
				expect(read.refusals[0]).toMatchObject({
					code: 'DEPLOYMENT_INVALID',
					key: 'sandbox.origin',
				});
		}
	);

	it('accepts mcp and cli set false, and a loopback name', () => {
		expect(
			refusalsOf(
				withEntry('work', {
					...mounted,
					transport: 'http',
					url: 'http://localhost:7410/mcp',
					expose: { mcp: false, cli: false },
				})
			)
		).toEqual([]);
	});

	it('says what it means by a close key', () => {
		const [refusal] = refusalsOf(withEntry('work', { ...mounted, prefixx: 'work' }));
		expect(refusal?.suggestion).toContain('Did you mean `prefix`?');
	});
});

describe('readProjection', () => {
	it("accepts the specification's example and the empty shell's", () => {
		expect(readProjection(PROJECTION).ok).toBe(true);
		expect(readProjection(EMPTY).ok).toBe(true);
	});

	it('reads no version 1 projection: dist and its projection are written together', () => {
		const read = readProjection({ deployment_version: 1, sandbox_origin: null, apps: [] });
		expect(read.ok).toBe(false);
	});

	it.each([
		['a boot record with a key it does not hold', { bogus: 1 }, 'apps[0].boot.bogus'],
		['a boot record missing a field', { refusal: undefined }, 'apps[0].boot.refusal'],
		['an unknown kind', { kind: 'plugin' }, 'apps[0].boot.kind'],
		['an unknown part', { parts: ['tray'] }, 'apps[0].boot.parts[0]'],
		['an unknown level', { scope_levels: ['team'] }, 'apps[0].boot.scope_levels[0]'],
		[
			'a layout with a key it does not hold',
			{ layout: { tray: { open: true } } },
			'apps[0].boot.layout.tray',
		],
		[
			'a layout value out of shape',
			{ layout: { sidebar: { width: 'wide' } } },
			'apps[0].boot.layout.sidebar.width',
		],
		[
			'a refusal with a key it does not hold',
			{ refusal: { code: 'A', message: '', suggestion: '', url: 'x' } },
			'apps[0].boot.refusal.url',
		],
	])('refuses %s', (_name, change, key) => {
		const [hello, ...rest] = PROJECTION.apps;
		const boot = { ...(hello?.boot as Record<string, unknown>), ...change };
		const read = readProjection({ ...PROJECTION, apps: [{ ...hello, boot }, ...rest] });
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.refusals.map((refusal) => refusal.key)).toContain(key);
	});

	it.each([
		['no generation', { generation: undefined }, 'generation'],
		['a generation that is not a digest', { generation: 'sha1-abc' }, 'generation'],
		['no workspace', { workspace: undefined }, 'workspace'],
		['a reserved workspace', { workspace: { id: 'assets', name: 'Assets' } }, 'workspace.id'],
		['a workspace off its pattern', { workspace: { id: 'Acme', name: 'Acme' } }, 'workspace.id'],
	])('refuses %s', (_name, change, key) => {
		const read = readProjection({ ...EMPTY, ...change });
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.refusals.map((refusal) => refusal.key)).toContain(key);
	});

	it.each(['url', 'bearer_file', 'bearer_env', 'command', 'cwd'])(
		'refuses %s, which never reaches a page',
		(key) => {
			const [hello, ...rest] = PROJECTION.apps;
			const read = readProjection({
				...PROJECTION,
				apps: [{ ...hello, [key]: 'x' }, ...rest],
			});
			expect(read.ok).toBe(false);
			if (read.ok) return;
			expect(read.refusals).toHaveLength(1);
			expect(read.refusals[0]?.code).toBe('DEPLOYMENT_INVALID');
			expect(read.refusals[0]?.key).toBe(`apps[0].${key}`);
		}
	);

	it('refuses the rest as the same code, naming the key', () => {
		const { sandbox_origin: _origin, ...noOrigin } = EMPTY;
		for (const [json, key] of [
			[{ ...EMPTY, deployment_version: 3 }, 'deployment_version'],
			[noOrigin, 'sandbox_origin'],
			[{ ...EMPTY, sandbox_origin: 'nope' }, 'sandbox_origin'],
			[{ ...EMPTY, apps: [{ instance: 'a', app: 'a', package: '/etc/' }] }, 'apps[0].package'],
			[
				{
					...EMPTY,
					apps: [{ instance: 'a', app: 'a', package: 'apps/a/', expose: { mcp: true } }],
				},
				'apps[0].expose.mcp',
			],
		] as const) {
			const read = readProjection(json);
			expect(read.ok, key).toBe(false);
			if (read.ok) continue;
			expect(read.refusals.map((refusal) => [refusal.code, refusal.key])).toEqual([
				['DEPLOYMENT_INVALID', key],
			]);
		}
	});

	it('refuses a repeated instance', () => {
		const app = { instance: 'a', app: 'a', package: 'apps/a/' };
		const read = readProjection({ ...EMPTY, apps: [app, app] });
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.refusals[0]?.key).toBe('apps[1].instance');
	});
});

describe('readDeployment, version 2 (phase 2 specification, 4.2)', () => {
	const v2 = (extra: Record<string, unknown>) => ({ ...FILE, deployment_version: 2, ...extra });
	const codesOf = (json: unknown) => refusalsOf(json).map((refusal) => [refusal.code, refusal.key]);

	it('reads the workspace and the base path, with their defaults', () => {
		const read = readDeployment(
			v2({ workspace: { id: 'acme', name: 'Acme Inc' }, site: { base_path: '/loam/' } })
		);
		expect(read.ok && [read.workspace, read.basePath]).toEqual([
			{ id: 'acme', name: 'Acme Inc' },
			'/loam/',
		]);
		const named = readDeployment(v2({ workspace: { id: 'acme' } }));
		expect(named.ok && named.workspace).toEqual({ id: 'acme', name: 'Acme' });
		const bare = readDeployment(v2({}));
		expect(bare.ok && [bare.workspace, bare.basePath]).toEqual([
			{ id: 'personal', name: 'Personal' },
			'/',
		]);
	});

	it('reads a version 1 file as the personal workspace at /', () => {
		const read = readDeployment(FILE);
		expect(read.ok && [read.workspace, read.basePath]).toEqual([
			{ id: 'personal', name: 'Personal' },
			'/',
		]);
	});

	it.each([
		'apps',
		'assets',
		'mounts',
		'sandbox',
		'p',
		'~',
		'deployment.json',
		'index.html',
		'404.html',
		'Acme',
		'-acme',
		'a'.repeat(64),
	])('refuses the workspace id %s', (id) => {
		expect(codesOf(v2({ workspace: { id } }))).toEqual([
			['DEPLOYMENT_WORKSPACE_INVALID', 'workspace.id'],
		]);
	});

	it.each(['loam/', '/loam', '//evil.example/', '/a/../', '/./', '/a b/', '/a?b/'])(
		'refuses the base path %s',
		(base_path) => {
			expect(codesOf(v2({ site: { base_path } }))).toEqual([
				['DEPLOYMENT_BASE_PATH_INVALID', 'site.base_path'],
			]);
		}
	);

	it.each(['/', '/loam/', '/a.b/c~d/'])('accepts the base path %s', (base_path) => {
		expect(codesOf(v2({ site: { base_path } }))).toEqual([]);
	});

	it('refuses an instance named p, which would read as a project segment', () => {
		expect(codesOf(v2({ apps: { p: { app: 'p', package: './p' } } }))).toEqual([
			['DEPLOYMENT_INSTANCE_RESERVED', 'apps.p'],
		]);
	});

	it('refuses a projects slug off the project pattern', () => {
		const work = { ...FILE.apps.work, projects: ['atlas', 'Bad_Slug'] };
		expect(codesOf(v2({ apps: { work } }))).toEqual([
			['DEPLOYMENT_PROJECT_INVALID', 'apps.work.projects[1]'],
		]);
	});

	it('refuses an unknown key under workspace and site', () => {
		expect(codesOf(v2({ workspace: { id: 'acme', owner: 'x' } }))).toEqual([
			['DEPLOYMENT_INVALID', 'workspace.owner'],
		]);
		expect(codesOf(v2({ site: { base: '/' } }))).toEqual([['DEPLOYMENT_INVALID', 'site.base']]);
	});

	it('refuses workspace and site in a version 1 file', () => {
		expect(codesOf({ ...FILE, workspace: { id: 'acme' } })).toEqual([
			['DEPLOYMENT_INVALID', 'workspace'],
		]);
	});
});
