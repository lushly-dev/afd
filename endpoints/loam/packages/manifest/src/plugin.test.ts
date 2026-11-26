/**
 * P5-S9-2's manifest cases (phase 5's no-terminal amendment, 4.2 and 4.4; 13.1): `loam-plugin.v1.json` and
 * `readPluginManifest`. The bundle's own cases (links, collisions, sizes, hashes) are `@lushly-dev/loam-cli`'s.
 */

import { describe, expect, it } from 'vitest';
import { readSchema } from '../scripts/compile.mjs';
import {
	bundlePathProblem,
	PLUGIN_ADMITTED_KEYS_V1,
	type PluginManifestV1,
	readPluginManifest,
} from './plugin.js';

const SHA = 'a'.repeat(64);

const APP = { version: '0.1.0', description: 'An app bundled by a plugin, for the tests.' };

const mountedApp = (id: string, transport = 'http') => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...APP, id, title: 'Mail engine', kind: 'mounted', domains: [id] },
	mount: { prefix: id, transport },
});
const nativeApp = (id: string, extra: Record<string, unknown> = {}) => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...APP, id, title: 'Mail', kind: 'native', domains: [id] },
	native: { entry: 'dist/native.js' },
	...extra,
});
const viewApp = (id: string) => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...APP, id, title: 'Sketch', kind: 'view', domains: [id] },
	view: {},
});

/** The amendment's 4.2 example, as `plugin-manifest.json`. */
const mail = (): PluginManifestV1 & Record<string, unknown> => ({
	plugin_manifest_version: 1,
	plugin: {
		id: 'mail',
		title: 'Mail',
		version: '0.1.0',
		description: 'Local mail sync, search, drafts and reply sets.',
		license: 'MIT',
		homepage: 'https://afd.dev/loam/plugins/mail',
	},
	apps: [
		{ id: 'mail', path: 'apps/mail' },
		{ id: 'mailapp', path: 'apps/mailapp' },
	],
	engine: {
		id: 'loam-mail',
		kind: 'http-service',
		mount_app: 'mail',
		service_mode: 'login',
		artifacts: {
			'darwin-arm64': { path: 'engines/darwin-arm64/loam-mail', sha256: SHA },
			'windows-x64': { path: 'engines/windows-x64/loam-mail.exe', sha256: SHA },
			'linux-x64': { path: 'engines/linux-x64/loam-mail', sha256: SHA },
		},
		auth: { mode: 'approver' },
		mount: {
			audience: 'person',
			labels: 'per-part',
			approvals: 'shell',
			expose: { agent: true, palette: true },
			commands: {
				'mail-draft-send': {
					expose: { agent: true, apps: true },
					preview: { command: 'mail-draft-show', input: ['draft', 'revision'] },
				},
				'mail-replyset-submit': { expose: { agent: true } },
			},
		},
	},
});
const MAIL_APPS = { mail: mountedApp('mail'), mailapp: nativeApp('mailapp') };

/** A deep copy changed by `change`, which may reach anywhere in it. */
// biome-ignore lint/suspicious/noExplicitAny: a test reaches every key, valid or not
function edit(change: (manifest: any) => void, from: () => object = mail): unknown {
	const copy = structuredClone(from());
	change(copy);
	return copy;
}

const refusals = (json: unknown, apps: Record<string, unknown> | undefined = MAIL_APPS) => {
	const read = readPluginManifest(json, apps);
	return read.ok ? [] : read.refusals.map(({ code, key }) => `${code} ${key}`);
};

describe('P5-S9-2: a plugin manifest (4.2)', () => {
	it("reads the amendment's example with its apps, and a pure-app plugin", () => {
		const read = readPluginManifest(mail(), MAIL_APPS);
		expect(read.ok).toBe(true);
		if (read.ok) expect(Object.keys(read.apps)).toEqual(['mail', 'mailapp']);
		const sketch = {
			plugin_manifest_version: 1,
			plugin: { id: 'sketch', title: 'Sketch', version: '1.0.0', description: 'Draw.' },
			apps: [{ id: 'sketch', path: 'apps/sketch' }],
		};
		expect(refusals(sketch, { sketch: viewApp('sketch') })).toEqual([]);
		// Without its apps, only the manifest's own rules run.
		expect(readPluginManifest(mail())).toMatchObject({ ok: true, apps: {} });
	});

	it('refuses a version it does not read', () => {
		expect(refusals(edit((m) => (m.plugin_manifest_version = 2)))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin_manifest_version',
		]);
	});

	it.each([
		['', 'command'],
		['', 'args'],
		['/plugin', 'install_dir'],
		['/engine', 'command'],
		['/engine', 'args'],
		['/engine', 'env'],
		['/engine', 'cwd'],
		['/engine', 'port'],
		['/engine/mount', 'url'],
		['/engine/mount', 'endpoint'],
		['/engine/mount', 'bearer'],
		['/engine/mount', 'bearer_file'],
		['/engine/mount', 'bearer_env'],
		['/engine/auth', 'token'],
		['/engine/artifacts/linux-x64', 'args'],
	])('refuses a command line, location or credential at %s: %s', (at, key) => {
		const json = edit((m) => {
			const table = at
				.split('/')
				.slice(1)
				.reduce((node, part) => node[part], m);
			table[key] = key === 'args' ? ['--anything'] : 'x';
		});
		const read = readPluginManifest(json, MAIL_APPS);
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_MANIFEST_INVALID',
				message: expect.stringContaining('never holds'),
			}),
		]);
	});

	it('refuses an unknown key anywhere, and suggests the closest', () => {
		const read = readPluginManifest(
			edit((m) => (m.engine.mount.commands['mail-draft-send'].expose.pallete = true))
		);
		expect(read.ok ? [] : read.refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_MANIFEST_INVALID',
				key: 'engine.mount.commands["mail-draft-send"].expose.pallete',
				suggestion: expect.stringContaining('Did you mean `palette`?'),
			}),
		]);
		expect(
			refusals(edit((m) => (m.engine.artifacts['windows-x86'] = { path: 'x', sha256: SHA })))
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.artifacts["windows-x86"]']);
	});

	it.each(['mcp', 'cli', 'apps'])('refuses `engine.mount.expose.%s`', (key) => {
		expect(refusals(edit((m) => (m.engine.mount.expose[key] = false)))).toEqual([
			`PLUGIN_MANIFEST_INVALID engine.mount.expose.${key}`,
		]);
	});

	it.each([
		['a right-to-left override', 'Mail‮gnp.exe'],
		['a bidirectional isolate', 'Mail⁦x'],
		['a zero-width space', 'Ma​il'],
		['a line separator', 'Mail Inbox'],
		['a control character', 'Mail\u0007'],
		['a line feed', 'Mail\nInbox'],
	])('P5-S9-2 (T27): refuses %s in a title or description', (_name, text) => {
		expect(refusals(edit((m) => (m.plugin.title = text)))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin.title',
		]);
		expect(refusals(edit((m) => (m.plugin.description = text)))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin.description',
		]);
	});

	it.each(['Loam Mail', 'LOAM', 'Ｌｏａｍ mail', 'Mail for loam'])(
		'P5-S9-2 (T27): refuses the title %j, which says "Loam"',
		(title) => {
			expect(refusals(edit((m) => (m.plugin.title = title)))).toEqual([
				'PLUGIN_MANIFEST_INVALID plugin.title',
			]);
		}
	);

	it('reads a title that only contains the letters', () => {
		expect(refusals(edit((m) => (m.plugin.title = 'Loamy soil')))).toEqual([]);
	});

	it('refuses a bundled app whose title says "Loam", by its manifest\'s own rule', () => {
		const app = nativeApp('mailapp');
		app.plugin.title = 'Loam Mail';
		const read = readPluginManifest(mail(), { ...MAIL_APPS, mailapp: app });
		expect(read.ok ? [] : read.refusals).toEqual([
			expect.objectContaining({
				code: 'PLUGIN_MANIFEST_INVALID',
				key: 'apps[1].path',
				message: expect.stringContaining('MANIFEST_TITLE_RESERVED'),
			}),
		]);
	});

	it.each(['shell', 'loam', 'p', 'afd'])('P5-S9-2: refuses the reserved id %s', (id) => {
		expect(refusals(edit((m) => (m.plugin.id = id)))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin.id',
		]);
		expect(refusals(edit((m) => (m.apps[1].id = id)))).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[1].id',
		]);
	});

	it("refuses an app id that is one of the shell's domains, and an id given twice", () => {
		expect(
			refusals(
				edit((m) => (m.apps[1].id = 'copilot')),
				undefined
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID apps[1].id']);
		expect(
			refusals(
				edit((m) => m.apps.push({ id: 'mailapp', path: 'apps/other' })),
				undefined
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID apps[2].id']);
	});

	it('P5-S9-2: refuses a native or view app installed under an id not its own', () => {
		expect(refusals(mail(), { ...MAIL_APPS, mailapp: nativeApp('mailclient') })).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[1].id',
		]);
		const sketch = {
			plugin_manifest_version: 1,
			plugin: { id: 'sketch', title: 'Sketch', version: '1.0.0', description: 'Draw.' },
			apps: [{ id: 'sketch', path: 'apps/sketch' }],
		};
		expect(refusals(sketch, { sketch: viewApp('draw') })).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[0].id',
		]);
	});

	it('refuses a missing or unpacked app manifest', () => {
		expect(refusals(mail(), { mail: MAIL_APPS.mail })).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[1].path',
		]);
		const unpacked = nativeApp('mailapp', {
			commands: [
				{
					name: 'mailapp-open',
					description: 'Opens a message.',
					input_schema: 'schemas/open.json',
					effects: ['inspect'],
				},
			],
		});
		const read = readPluginManifest(mail(), { ...MAIL_APPS, mailapp: unpacked });
		expect(read.ok ? [] : read.refusals.map(({ message }) => message)).toEqual([
			expect.stringContaining('MANIFEST_NOT_PACKED'),
		]);
	});
});

describe('P5-S9-2: the engine and its mount (4.4, item 5)', () => {
	it('P5-S9-2 (T27): refuses `auth.mode = "approver"` with `approvals = "none"`, and the converse', () => {
		expect(
			refusals(
				edit((m) => {
					m.engine.mount.approvals = 'none';
					delete m.engine.mount.commands['mail-draft-send'].preview;
				})
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount.approvals']);
		expect(
			refusals(
				edit((m) => {
					delete m.engine.mount.approvals;
					delete m.engine.mount.commands['mail-draft-send'].preview;
				})
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount.approvals']);
		expect(refusals(edit((m) => (m.engine.auth.mode = 'agent')))).toEqual([
			'PLUGIN_MANIFEST_INVALID engine.auth.mode',
		]);
	});

	it('reads a Trillium-shaped engine: an agent token and no approvals', () => {
		const trillium = edit((m) => {
			m.engine.auth.mode = 'agent';
			m.engine.mount.approvals = 'none';
			delete m.engine.mount.commands['mail-draft-send'].preview;
		});
		expect(refusals(trillium)).toEqual([]);
	});

	it('P5-S9-2: refuses a self-preview, a shell approval with no preview and a preview with none', () => {
		expect(
			refusals(
				edit(
					(m) => (m.engine.mount.commands['mail-draft-send'].preview.command = 'mail-draft-send')
				)
			)
		).toEqual([
			'DEPLOYMENT_PREVIEW_INVALID engine.mount.commands["mail-draft-send"].preview.command',
		]);
		expect(
			refusals(edit((m) => delete m.engine.mount.commands['mail-draft-send'].preview))
		).toEqual(['DEPLOYMENT_PREVIEW_REQUIRED engine.mount.approvals']);
		expect(
			refusals(
				edit((m) => {
					m.engine.auth.mode = 'agent';
					m.engine.mount.approvals = 'none';
				})
			)
		).toEqual(['DEPLOYMENT_PREVIEW_INVALID engine.mount.commands["mail-draft-send"].preview']);
	});

	it("P5-S9-2: refuses a command or preview outside the mounted app's prefix", () => {
		expect(
			refusals(
				edit((m) => {
					m.engine.mount.commands['notes-draft-send'] = m.engine.mount.commands['mail-draft-send'];
					delete m.engine.mount.commands['mail-draft-send'];
				})
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount.commands["notes-draft-send"]']);
		expect(
			refusals(
				edit(
					(m) => (m.engine.mount.commands['mail-draft-send'].preview.command = 'notes-draft-show')
				)
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount.commands["mail-draft-send"].preview.command']);
	});

	it('refuses a mount_app that is not an app, not mounted, or not over http; and a mounted app with no engine', () => {
		expect(
			refusals(
				edit((m) => (m.engine.mount_app = 'other')),
				undefined
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount_app']);
		expect(
			refusals(
				edit((m) => (m.engine.mount_app = 'mailapp')),
				{
					mail: nativeApp('mail'),
					mailapp: nativeApp('mailapp'),
				}
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.mount_app']);
		expect(refusals(mail(), { ...MAIL_APPS, mail: mountedApp('mail', 'stdio') })).toEqual([
			'PLUGIN_MANIFEST_INVALID apps[0].path',
		]);
		const engineless = edit((m) => delete m.engine);
		expect(refusals(engineless)).toEqual(['PLUGIN_MANIFEST_INVALID apps[0].id']);
	});

	it('P5-S9-2 (T22): refuses a Windows script or a POSIX shell script as an engine, and an artifact under another target', () => {
		for (const name of [
			'loam-mail.bat',
			'loam-mail.cmd',
			'loam-mail.com',
			'loam-mail.ps1',
			'loam-mail.vbs',
			'Loam-Mail.exe',
		]) {
			expect(
				refusals(
					edit((m) => (m.engine.artifacts['windows-x64'].path = `engines/windows-x64/${name}`))
				),
				name
			).toEqual(['PLUGIN_MANIFEST_INVALID engine.artifacts["windows-x64"].path']);
		}
		for (const name of ['loam-mail.sh', 'loam-mail.bat', 'loam-mail.cmd', 'Loam-mail']) {
			expect(
				refusals(edit((m) => (m.engine.artifacts['linux-x64'].path = `engines/linux-x64/${name}`))),
				name
			).toEqual(['PLUGIN_MANIFEST_INVALID engine.artifacts["linux-x64"].path']);
		}
		expect(
			refusals(
				edit((m) => (m.engine.artifacts['windows-x64'].path = 'engines/linux-x64/loam-mail.exe'))
			)
		).toEqual(['PLUGIN_MANIFEST_INVALID engine.artifacts["windows-x64"].path']);
		expect(refusals(edit((m) => (m.engine.artifacts['linux-x64'].path = 'bin/loam-mail')))).toEqual(
			['PLUGIN_MANIFEST_INVALID engine.artifacts["linux-x64"].path']
		);
	});

	it.each(['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}g`])(
		'refuses the SHA-256 %s',
		(sha256) => {
			expect(refusals(edit((m) => (m.engine.artifacts['linux-x64'].sha256 = sha256)))).toEqual([
				'PLUGIN_MANIFEST_INVALID engine.artifacts["linux-x64"].sha256',
			]);
		}
	);

	it.each([
		'http://afd.dev/mail',
		'https://user:pw@afd.dev/',
		'https://afd.dev/a b',
		'javascript:alert(1)',
	])('refuses the homepage %j', (homepage) => {
		expect(refusals(edit((m) => (m.plugin.homepage = homepage)))).toEqual([
			'PLUGIN_MANIFEST_INVALID plugin.homepage',
		]);
	});
});

describe('P5-S9-2: paths (4.4, item 3)', () => {
	it.each([
		['..', 'apps/../mail'],
		['a leading /', '/apps/mail'],
		['a backslash', 'apps\\mail'],
		['a drive', 'C:apps'],
		['an empty segment', 'apps//mail'],
		['a . segment', './apps/mail'],
		['a trailing /', 'apps/mail/'],
		['a reserved device', 'apps/CON'],
		['a reserved device with an extension', 'apps/lpt1.txt'],
		['NUL', 'apps/m\0ail'],
	])('P5-S9-2 (T22): refuses an app path with %s', (_name, path) => {
		expect(
			refusals(
				edit((m) => (m.apps[1].path = path)),
				undefined
			)
		).toEqual(['PLUGIN_PATH_ESCAPE apps[1].path']);
	});

	it('refuses apps that overlap, compared without case, and an app inside engines/', () => {
		expect(
			refusals(
				edit((m) => (m.apps[1].path = 'APPS/Mail/x')),
				undefined
			)
		).toEqual(['PLUGIN_PATH_ESCAPE apps[1].path']);
		expect(
			refusals(
				edit((m) => (m.apps[1].path = 'engines/linux-x64')),
				undefined
			)
		).toEqual(['PLUGIN_PATH_ESCAPE apps[1].path']);
	});

	it('names what is wrong with a path', () => {
		expect(bundlePathProblem('apps/mail')).toBeUndefined();
		expect(bundlePathProblem('apps/.well-known')).toBeUndefined();
		expect(bundlePathProblem('apps/../x')).toMatch(/`\.\.`/);
		expect(bundlePathProblem('a/aux.json')).toMatch(/Windows reserves/);
	});
});

describe("the admitted keys' table", () => {
	it("is the schema's", () => {
		const schema = readSchema('loam-plugin') as unknown as {
			properties: Record<string, unknown>;
			$defs: Record<string, { properties?: Record<string, unknown> }>;
		};
		const defs = schema.$defs;
		const keys = (node: { properties?: Record<string, unknown> } | undefined) =>
			Object.keys(node?.properties ?? {}).sort();
		const mount = defs.mount as {
			properties: Record<string, { properties?: Record<string, unknown> }>;
		};
		const override = defs.commandOverride as {
			properties: Record<string, { properties?: Record<string, unknown> }>;
		};
		const engine = defs.engine as {
			properties: Record<string, { properties?: Record<string, unknown> }>;
		};
		expect(
			Object.fromEntries(
				Object.entries(PLUGIN_ADMITTED_KEYS_V1).map(([key, names]) => [key, [...names].sort()])
			)
		).toEqual({
			'': keys(schema),
			'/plugin': keys(defs.plugin),
			'/apps/*': keys(defs.app),
			'/engine': keys(engine),
			'/engine/artifacts': keys(engine.properties.artifacts),
			'/engine/artifacts/*': keys(defs.artifact),
			'/engine/auth': keys(engine.properties.auth),
			'/engine/mount': keys(mount),
			'/engine/mount/expose': keys(mount.properties.expose),
			'/engine/mount/commands/*': keys(override),
			'/engine/mount/commands/*/expose': keys(override.properties.expose),
			'/engine/mount/commands/*/preview': keys(override.properties.preview),
		});
	});
});
