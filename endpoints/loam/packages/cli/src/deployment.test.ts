import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readDeployment, readProjection } from '@lushly-dev/loam-manifest/validate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli.js';
import {
	analyzeDeployment,
	checkedProjection,
	withBasePath,
	withFrameSrc,
	writeDeployment,
} from './deployment.js';
import { temporaryDirectory } from './test-support.js';

const TOKEN = 'token-that-must-stay-out-of-every-served-file';
const URL_SECRET = 'http://127.0.0.1:7410/mcp';
const COMMAND_SECRET = '/srv/notes-umbel';
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

const PLUGIN = {
	title: 'An app',
	version: '0.1.0',
	description: 'An app, for the tests of the deployment.',
};

const nativePackage = (id: string, extra: object = {}) => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...PLUGIN, id, kind: 'native', domains: [id] },
	native: { entry: 'dist/native.js' },
	...extra,
});
const viewPackage = (id: string) => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...PLUGIN, id, kind: 'view', domains: [id] },
	view: {},
});
const mountedPackage = (id: string, transport = 'http') => ({
	manifest_version: 1,
	protocol: 1,
	plugin: { ...PLUGIN, id, kind: 'mounted', domains: [id] },
	mount: { prefix: id, transport },
});

async function write(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

interface Layout {
	root: string;
	config: string;
	dist: string;
	out: string;
}

async function layout(toml: string, packages: Record<string, unknown> = {}): Promise<Layout> {
	const root = await temporaryDirectory();
	await write(root, 'deploy/loam.deployment.toml', toml);
	for (const [name, manifest] of Object.entries(packages)) {
		await write(root, `deploy/${name}/app-manifest.json`, JSON.stringify(manifest));
		await write(root, `deploy/${name}/dist/native.js`, 'export default {};\n');
	}
	await write(
		root,
		'dist/index.html',
		`<!doctype html>\n<html><head>\n<meta\n\thttp-equiv="Content-Security-Policy"\n\tcontent="${CSP}"\n/>\n</head></html>`
	);
	await write(
		root,
		'dist/deployment.json',
		'{"deployment_version":2,"generation":"empty","workspace":{"id":"personal","name":"Personal"},"sandbox_origin":null,"apps":[]}'
	);
	await write(root, 'dist/assets/app.js', '1;');
	return {
		root,
		config: join(root, 'deploy/loam.deployment.toml'),
		dist: join(root, 'dist'),
		out: join(root, 'out'),
	};
}

const write_ = ({ config, dist, out }: Layout, mountsOut?: string) =>
	writeDeployment({ config, dist, out, ...(mountsOut ? { mountsOut } : {}) });

const SPEC_FILE = `deployment_version = 1

[sandbox]
origin = "https://sandbox.example.com"

[apps.hello]
app = "hello"
package = "hello"
order = 10

[apps.board]
app = "board"
package = "board"

[apps.work]
app = "umbel"
package = "umbel"
title = "Work knowledge"
prefix = "work"
audience = "team"
transport = "http"
url = "${URL_SECRET}"
bearer_env = "LOAM_TEST_TOKEN"
projects = ["atlas", "borealis"]
space = { atlas = "atlas", borealis = "default" }
expose = { agent = true, palette = true }

[apps.work.commands."work-event-ack"]
expose = { palette = true }
effects = ["plugin-state"]

[apps.home]
app = "umbel"
package = "umbel"
prefix = "home"
audience = "person"
transport = "stdio"
command = ["umbel", "--workspace", "${COMMAND_SECRET}", "serve", "--stdio"]
`;

const SPEC_PACKAGES = {
	hello: nativePackage('hello'),
	board: viewPackage('board'),
	umbel: mountedPackage('umbel'),
};

beforeEach(() => {
	process.env.LOAM_TEST_TOKEN = TOKEN;
});

afterEach(() => {
	delete process.env.LOAM_TEST_TOKEN;
});

/** Every file below `dir`, as text, so a scan misses nothing. */
function servedText(dir: string): string {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
		.join('\n');
}

describe('deployment write', () => {
	it('writes the projection of the specification', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		const written = await write_(paths);
		expect(written).toMatchObject({ ok: true });
		if (!written.ok) return;
		const projection = JSON.parse(readFileSync(join(paths.out, 'deployment.json'), 'utf8'));
		expect(readProjection(projection).ok).toBe(true);
		const boot = (extra: object) => ({
			title: 'An app',
			kind: 'native',
			icon: 'system/folder',
			order: 100,
			scope_levels: ['workspace'],
			rail: true,
			parts: [],
			layout: {},
			refusal: null,
			...extra,
		});
		expect(projection).toEqual({
			deployment_version: 2,
			generation: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
			workspace: { id: 'personal', name: 'Personal' },
			sandbox_origin: 'https://sandbox.example.com',
			apps: [
				{
					instance: 'hello',
					app: 'hello',
					package: 'apps/hello/',
					order: 10,
					boot: boot({ order: 10 }),
				},
				{ instance: 'board', app: 'board', package: 'apps/board/', boot: boot({ kind: 'view' }) },
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
					commands: {
						'work-event-ack': { expose: { palette: true }, effects: ['plugin-state'] },
					},
					// An instance with `projects` serves only those projects (9.1).
					boot: boot({ kind: 'mounted', title: 'Work knowledge', scope_levels: ['project'] }),
				},
				{
					instance: 'home',
					app: 'umbel',
					package: 'apps/home/',
					prefix: 'home',
					audience: 'person',
					transport: 'stdio',
					boot: boot({ kind: 'mounted' }),
				},
			],
		});
		expect(written.mounts).toEqual([{ instance: 'work', url: URL_SECRET, bearer: TOKEN }]);
		// The umbel package names no levels, so the workspace's alone, and `projects` overrides them (9.1).
		expect(written.warnings.map(({ code, key }) => [code, key])).toEqual([
			['INSTANCE_LEVELS_OVERRIDDEN', 'apps.work.projects'],
		]);
		expect(existsSync(join(paths.out, 'assets/app.js'))).toBe(true);
		expect(existsSync(join(paths.out, 'apps/hello/dist/native.js'))).toBe(true);
		expect(existsSync(join(paths.out, 'apps/home/app-manifest.json'))).toBe(true);
	});

	it('serves no location, credential or command line', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		await write_(paths);
		const served = servedText(paths.out);
		expect(served).not.toContain(TOKEN);
		expect(served).not.toContain(URL_SECRET);
		expect(served).not.toContain(COMMAND_SECRET);
		expect(served).not.toContain('LOAM_TEST_TOKEN');
	});

	it('keeps them out of what the bin prints too', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		let text = '';
		const code = await runCli(
			['deployment', 'write', '--config', paths.config, '--dist', paths.dist, '--out', paths.out],
			{ stdout: (chunk) => (text += chunk) }
		);
		expect(code).toBe(0);
		expect(text).not.toContain(TOKEN);
		expect(text).not.toContain(URL_SECRET);
		expect(text).not.toContain(COMMAND_SECRET);
		expect(JSON.parse(text).data.instances).toEqual(['hello', 'board', 'work', 'home']);
	});

	it('sets frame-src to the sandbox origin only when a view is listed', async () => {
		const withView = await layout(SPEC_FILE, SPEC_PACKAGES);
		await write_(withView);
		const page = readFileSync(join(withView.out, 'index.html'), 'utf8');
		expect(page).toContain(
			"connect-src 'self'; frame-src https://sandbox.example.com; object-src 'none'"
		);

		const noView = await layout(
			`deployment_version = 1

[sandbox]
origin = "https://sandbox.example.com"

[apps.hello]
app = "hello"
package = "hello"
`,
			{ hello: nativePackage('hello') }
		);
		await write_(noView);
		expect(readFileSync(join(noView.out, 'index.html'), 'utf8')).toContain("frame-src 'none'");
	});

	it('carries a refused or missing package, warning of each, so the rail can show it', async () => {
		const paths = await layout(
			`deployment_version = 1

[apps.bad]
app = "bad"
package = "bad"

[apps.gone]
app = "gone"
package = "gone"

[apps.broken]
app = "broken"
package = "broken"
`,
			{ bad: { ...nativePackage('bad'), ui: { surfaces: { tray: {} } } } }
		);
		await write(paths.root, 'deploy/broken/app-manifest.json', 'not json');
		const written = await write_(paths);
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		const codes = written.warnings.map(({ code }) => code);
		expect(codes).toContain('MANIFEST_UNKNOWN_SURFACE');
		expect(codes.filter((code) => code === 'APP_PACKAGE_UNAVAILABLE')).toHaveLength(2);
		expect(written.projection.apps.map(({ instance }) => instance)).toEqual([
			'bad',
			'gone',
			'broken',
		]);
		// The raw manifest travels, which is how E7 reaches a browser.
		expect(existsSync(join(paths.out, 'apps/bad/app-manifest.json'))).toBe(true);
		expect(readProjection(written.projection).ok).toBe(true);
	});

	it('stops on what makes the file unreadable, leaving the output alone', async () => {
		const paths = await layout('deployment_version = 3\napps = {}\n');
		const written = await write_(paths);
		expect(written).toMatchObject({ ok: false });
		expect(written.ok === false && written.refusals[0]?.code).toBe(
			'DEPLOYMENT_VERSION_UNSUPPORTED'
		);
		expect(existsSync(paths.out)).toBe(false);
	});

	it.each([
		['an unset variable', 'bearer_env = "LOAM_TEST_UNSET"'],
		['a missing file', 'bearer_file = "gone.token"'],
		['an empty file', 'bearer_file = "empty.token"'],
	])('stops on a credential that cannot be read: %s', async (_name, line) => {
		const paths = await layout(
			`deployment_version = 1

[apps.work]
app = "umbel"
package = "umbel"
audience = "person"
url = "${URL_SECRET}"
${line}
`,
			{ umbel: mountedPackage('umbel') }
		);
		await write(paths.root, 'deploy/empty.token', '\n');
		const written = await write_(paths);
		expect(written.ok === false && written.refusals[0]?.code).toBe(
			'DEPLOYMENT_CREDENTIAL_UNREADABLE'
		);
		expect(existsSync(paths.out)).toBe(false);
	});

	it('reads a token from a file relative to the deployment file, trimmed', async () => {
		const paths = await layout(
			`deployment_version = 1

[apps.work]
app = "umbel"
package = "umbel"
audience = "person"
url = "${URL_SECRET}"
bearer_file = "keys/http.token"
`,
			{ umbel: mountedPackage('umbel') }
		);
		await write(paths.root, 'deploy/keys/http.token', `${TOKEN}\n`);
		const written = await write_(paths);
		expect(written.ok && written.mounts).toEqual([
			{ instance: 'work', url: URL_SECRET, bearer: TOKEN },
		]);
		expect(servedText(paths.out)).not.toContain(TOKEN);
	});

	it('writes `mounts` only where asked, mode 0600, replacing a looser file', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		const mountsOut = join(paths.root, 'private/mounts.json');
		await write(paths.root, 'private/mounts.json', 'old');
		await write_(paths, mountsOut);
		expect(JSON.parse(readFileSync(mountsOut, 'utf8')).mounts[0].bearer).toBe(TOKEN);
		expect(statSync(mountsOut).mode & 0o777).toBe(0o600);
	});

	it('refuses `--mounts-out` inside anything served', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		for (const mountsOut of [
			join(paths.out, 'mounts.json'),
			join(paths.dist, 'mounts.json'),
			join(paths.root, 'deploy/umbel/mounts.json'),
		]) {
			const written = await write_(paths, mountsOut);
			expect(written.ok === false && written.refusals[0]?.key).toBe('--mounts-out');
		}
		expect(existsSync(paths.out)).toBe(false);
	});

	it('refuses an `--out` that overlaps what it reads, or holds other files', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		for (const out of [
			paths.dist,
			join(paths.dist, 'out'),
			paths.root,
			join(paths.root, 'deploy'),
			join(paths.root, 'deploy/umbel/out'),
		]) {
			const written = await writeDeployment({ config: paths.config, dist: paths.dist, out });
			expect(written.ok === false && written.refusals[0]?.key, out).toBe('--out');
		}
		const other = join(paths.root, 'other');
		await write(paths.root, 'other/keep.txt', 'mine');
		const held = await writeDeployment({ config: paths.config, dist: paths.dist, out: other });
		expect(held.ok).toBe(false);
		expect(existsSync(join(other, 'keep.txt'))).toBe(true);
	});

	it('replaces an earlier deployment', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		await write_(paths);
		await write(paths.out, 'stale.js', 'old');
		expect((await write_(paths)).ok).toBe(true);
		expect(existsSync(join(paths.out, 'stale.js'))).toBe(false);
	});

	it('refuses a dist that is not a built host', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		const empty = await temporaryDirectory();
		const none = await writeDeployment({ config: paths.config, dist: empty, out: paths.out });
		expect(none.ok === false && none.refusals[0]?.key).toBe('--dist');
		await write(empty, 'index.html', '<html></html>');
		const bare = await writeDeployment({ config: paths.config, dist: empty, out: paths.out });
		expect(bare.ok === false && bare.refusals[0]?.message).toMatch(/Content-Security-Policy/);
	});

	it('does not copy a link leaving a package', async () => {
		const paths = await layout(
			'deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "hello"\n',
			{ hello: nativePackage('hello') }
		);
		await write(paths.root, 'secret.txt', 'hunter2');
		await symlink(join(paths.root, 'secret.txt'), join(paths.root, 'deploy/hello/secret.txt'));
		const written = await write_(paths);
		expect(written.ok && written.warnings.map(({ code }) => code)).toEqual([
			'APP_PACKAGE_LINK_SKIPPED',
		]);
		expect(existsSync(join(paths.out, 'apps/hello/secret.txt'))).toBe(false);
		expect(servedText(paths.out)).not.toContain('hunter2');
	});
});

describe('what must not be served or destroyed', () => {
	const MOUNTED = `deployment_version = 1

[apps.work]
app = "umbel"
package = "umbel"
audience = "person"
url = "${URL_SECRET}"
bearer_file = "keys/http.token"
`;

	const mounted = async (): Promise<Layout> => {
		const paths = await layout(MOUNTED, { umbel: mountedPackage('umbel') });
		await write(paths.root, 'deploy/keys/http.token', `${TOKEN}\n`);
		return paths;
	};

	it('refuses a package holding the deployment file or a credential, in a check and a write', async () => {
		const paths = await layout(
			`deployment_version = 1

[apps.work]
app = "umbel"
package = "."
audience = "person"
url = "${URL_SECRET}"
bearer_file = "http.token"
`
		);
		await write(paths.root, 'deploy/app-manifest.json', JSON.stringify(mountedPackage('umbel')));
		await write(paths.root, 'deploy/http.token', TOKEN);
		const { refusals } = await analyzeDeployment(paths.config);
		expect(refusals.map(({ code, key }) => [code, key])).toEqual([
			['DEPLOYMENT_PATH_INVALID', 'apps.work.package'],
		]);
		const written = await write_(paths);
		expect(written.ok).toBe(false);
		expect(existsSync(paths.out)).toBe(false);
	});

	it('refuses a dist holding a credential', async () => {
		const paths = await layout(MOUNTED.replace('keys/http.token', '../dist/http.token'), {
			umbel: mountedPackage('umbel'),
		});
		await write(paths.root, 'dist/http.token', TOKEN);
		const written = await write_(paths);
		expect(written.ok === false && written.refusals[0]?.key).toBe('--dist');
		expect(existsSync(paths.out)).toBe(false);
	});

	it('refuses an --out holding a credential, and keeps the credential', async () => {
		const paths = await mounted();
		const out = join(paths.root, 'deploy/keys');
		await write(paths.root, 'deploy/keys/.loam-output', 'marked');
		const written = await writeDeployment({ config: paths.config, dist: paths.dist, out });
		expect(written.ok === false && written.refusals[0]?.key).toBe('--out');
		expect(existsSync(join(out, 'http.token'))).toBe(true);
	});

	it('will not let --mounts-out replace the deployment file or a credential', async () => {
		const paths = await mounted();
		for (const mountsOut of [paths.config, join(paths.root, 'deploy/keys/http.token')]) {
			const written = await write_(paths, mountsOut);
			expect(written.ok === false && written.refusals[0]?.key).toBe('--mounts-out');
		}
		expect(readFileSync(join(paths.root, 'deploy/keys/http.token'), 'utf8')).toContain(TOKEN);
	});

	it('refuses --mounts-out through a link in dist, which it would replace in place', async () => {
		const paths = await mounted();
		await mkdir(join(paths.root, 'elsewhere'));
		await symlink(join(paths.root, 'elsewhere/m.json'), join(paths.dist, 'm.json'));
		const written = await write_(paths, join(paths.dist, 'm.json'));
		expect(written.ok === false && written.refusals[0]?.key).toBe('--mounts-out');
	});

	it('does not take a file with a common name as leave to delete a directory', async () => {
		const paths = await mounted();
		const project = join(paths.root, 'project');
		await write(paths.root, 'project/deployment.json', '{}');
		await write(paths.root, 'project/src/important.ts', 'mine');
		const written = await writeDeployment({ config: paths.config, dist: paths.dist, out: project });
		expect(written.ok === false && written.refusals[0]?.key).toBe('--out');
		expect(existsSync(join(project, 'src/important.ts'))).toBe(true);
	});

	it('survives a link loop in a package, skipping it, and only then replaces the output', async () => {
		const paths = await layout(
			'deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "hello"\n',
			{ hello: nativePackage('hello') }
		);
		await symlink('.', join(paths.root, 'deploy/hello/loop'));
		const written = await write_(paths);
		expect(written.ok && written.warnings.map(({ code }) => code)).toEqual([
			'APP_PACKAGE_LINK_SKIPPED',
		]);
		expect(existsSync(join(paths.out, 'apps/hello/app-manifest.json'))).toBe(true);
		expect(existsSync(join(paths.out, 'apps/hello/loop'))).toBe(false);
	});

	it('does not copy what is not a package', async () => {
		const paths = await layout(
			'deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "other"\n'
		);
		await write(paths.root, 'deploy/other/private.txt', 'mine');
		const written = await write_(paths);
		expect(written.ok && written.warnings.map(({ code }) => code)).toEqual([
			'APP_PACKAGE_UNAVAILABLE',
		]);
		expect(existsSync(join(paths.out, 'apps/hello'))).toBe(false);
	});

	it('does not copy a link leaving the host', async () => {
		const paths = await mounted();
		await write(paths.root, 'secret.txt', 'hunter2');
		await symlink(join(paths.root, 'secret.txt'), join(paths.dist, 'leak.txt'));
		const written = await write_(paths);
		expect(written.ok && written.warnings.map(({ key }) => key)).toEqual(['--dist']);
		expect(existsSync(join(paths.out, 'leak.txt'))).toBe(false);
	});

	it('names the line of a TOML error, and quotes none of it', async () => {
		const paths = await layout(
			`deployment_version = 1\n\n[apps.home]\ncommand = ["umbel", "--workspace", "${COMMAND_SECRET}"\nurl = "${URL_SECRET}"\n`
		);
		let text = '';
		const code = await runCli(['deployment', 'check', paths.config], {
			stdout: (chunk) => {
				text += chunk;
			},
		});
		expect(code).toBe(1);
		expect(JSON.parse(text).error.message).toMatch(/line \d+, column \d+/);
		expect(text).not.toContain(COMMAND_SECRET);
		expect(text).not.toContain(URL_SECRET);
	});
});

describe('the projection refuses what must never reach it (a schema test)', () => {
	const app = { instance: 'home', app: 'umbel', package: 'apps/home/' };
	const base = {
		deployment_version: 2,
		generation: 'test',
		workspace: { id: 'personal', name: 'Personal' },
		sandbox_origin: null,
	};

	it.each(['command', 'cwd', 'url', 'bearer_file', 'bearer_env'])('refuses `%s`', (key) => {
		const checked = checkedProjection({ ...base, apps: [{ ...app, [key]: 'x' }] });
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.refusals[0]?.code).toBe('DEPLOYMENT_INVALID');
	});

	it('passes a clean one', () => {
		expect(checkedProjection({ ...base, apps: [app] }).ok).toBe(true);
	});
});

describe('deployment write, version 2 (phase 2 specification, 2.2 and 4.2)', () => {
	const HELLO = 'deployment_version = 2\n\n[apps.hello]\napp = "hello"\npackage = "hello"\n';
	const helloWith = (extra: object) => ({
		hello: nativePackage('hello', {
			ui: {
				surfaces: {
					rail: { label: 'Hello there', icon: 'system/document', order: 5 },
					main: { element: 'hello-main' },
					inspector: { element: 'hello-inspector' },
				},
				layout: { inspector: { open: true } },
			},
			app: { scope_levels: ['workspace', 'project'] },
			...extra,
		}),
	});

	it("writes the workspace, and each entry's boot record from its manifest", async () => {
		const paths = await layout(
			`deployment_version = 2\n\n[workspace]\nid = "acme"\n\n[site]\nbase_path = "/loam/"\n\n[apps.hello]\napp = "hello"\npackage = "hello"\n`,
			helloWith({})
		);
		const written = await write_(paths);
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		expect(written.projection.workspace).toEqual({ id: 'acme', name: 'Acme' });
		expect(written.projection.apps[0]?.boot).toEqual({
			title: 'Hello there',
			kind: 'native',
			icon: 'system/document',
			order: 5,
			scope_levels: ['workspace', 'project'],
			rail: true,
			parts: ['inspector'],
			layout: { inspector: { open: true } },
			refusal: null,
		});
	});

	it("P2-E8: writes index.html's asset URLs under base_path, and 404.html as its copy", async () => {
		const page = (assets: string) =>
			`<!doctype html>\n<html><head>\n<meta\n\thttp-equiv="Content-Security-Policy"\n\tcontent="${CSP}"\n/>\n<script type="module" crossorigin src="${assets}index-a1.js"></script>\n<link rel="stylesheet" crossorigin href="${assets}index-b2.css">\n</head><body><a href="./elsewhere">x</a></body></html>`;
		for (const [site, assets] of [
			['', '/assets/'],
			['\n[site]\nbase_path = "/"\n', '/assets/'],
			['\n[site]\nbase_path = "/loam/team-a/"\n', '/loam/team-a/assets/'],
		] as const) {
			const paths = await layout(`${HELLO}${site}`, helloWith({}));
			await write(paths.root, 'dist/index.html', page('./assets/'));
			const written = await write_(paths);
			expect(written.ok).toBe(true);
			const served = readFileSync(join(paths.out, 'index.html'), 'utf8');
			expect(served).toBe(withFrameSrc(page(assets), "'none'"));
			// Only the page's own assets move; every other relative URL stays as it was.
			expect(served).toContain('href="./elsewhere"');
			expect(readFileSync(join(paths.out, '404.html'), 'utf8')).toBe(served);
		}
		// `vite build`'s own `dist` keeps `./`, servable from any directory at its root.
		const paths = await layout(HELLO.replace('= 2', '= 1'), helloWith({}));
		await write(paths.root, 'dist/index.html', page('./assets/'));
		expect((await write_(paths)).ok).toBe(true);
		expect(readFileSync(join(paths.dist, 'index.html'), 'utf8')).toBe(page('./assets/'));
		expect(readFileSync(join(paths.out, 'index.html'), 'utf8')).toBe(
			withFrameSrc(page('/assets/'), "'none'")
		);
	});

	it('P2-E8: refuses a base_path that could leave the origin or climb, before writing', async () => {
		for (const base of [
			'//evil.example/',
			'/loam',
			'loam/',
			'/a/../',
			'/./',
			'/a b/',
			'/%2e%2e/',
			'/a"/',
			'/a\\b/',
			'\\\\evil.example\\',
			'javascript:alert(1)//',
			'/a//b/',
			'/loam//',
		]) {
			const paths = await layout(
				`${HELLO}\n[site]\nbase_path = ${JSON.stringify(base)}\n`,
				helloWith({})
			);
			const written = await write_(paths);
			expect(written.ok, base).toBe(false);
			if (written.ok) continue;
			expect(written.refusals.map((refusal) => refusal.code)).toEqual([
				'DEPLOYMENT_BASE_PATH_INVALID',
			]);
			expect(existsSync(paths.out)).toBe(false);
		}
		expect(withBasePath('<script src="./assets/x.js"></script>', '/loam/')).toBe(
			'<script src="/loam/assets/x.js"></script>'
		);
	});

	it("carries a refused package's reason in its boot record, and keeps it listed", async () => {
		const paths = await layout(HELLO, { hello: { manifest_version: 1 } });
		const written = await write_(paths);
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		const boot = written.projection.apps[0]?.boot;
		expect(boot).toMatchObject({ title: 'hello', kind: 'native', rail: true });
		expect(boot?.refusal?.code).toMatch(/^MANIFEST_/);
		expect(Object.keys(boot?.refusal ?? {})).toEqual(['code', 'message', 'suggestion']);
	});

	it("changes the generation with a deployer's entry, and not with a package's display", async () => {
		const generation = async (toml: string, packages: Record<string, object>) => {
			const paths = await layout(toml, packages);
			const written = await write_(paths);
			return written.ok ? written.projection.generation : undefined;
		};
		const first = await generation(HELLO, helloWith({}));
		expect(first).toMatch(/^sha256-[0-9a-f]{64}$/);
		expect(await generation(HELLO, helloWith({}))).toBe(first);
		const relabelled = helloWith({});
		(relabelled.hello as { plugin: { title: string } }).plugin.title = 'Another title';
		expect(await generation(HELLO, relabelled)).toBe(first);
		expect(await generation(`${HELLO}order = 3\n`, helloWith({}))).not.toBe(first);
		expect(
			await generation(HELLO.replace('\n\n', '\n\n[workspace]\nid = "acme"\n\n'), helloWith({}))
		).not.toBe(first);
	});

	it('warns when --out last held another workspace, and writes', async () => {
		const paths = await layout(HELLO, helloWith({}));
		expect((await write_(paths)).warnings).toEqual([]);
		await writeFile(paths.config, HELLO.replace('\n\n', '\n\n[workspace]\nid = "acme"\n\n'));
		const again = await write_(paths);
		expect(again.ok).toBe(true);
		expect(again.warnings.map(({ code, key }) => [code, key])).toEqual([
			['DEPLOYMENT_WORKSPACE_CHANGED', 'workspace.id'],
		]);
		const third = await write_(paths);
		expect(third.warnings).toEqual([]);
	});

	it('refuses a reserved instance and a bad base path, writing nothing', async () => {
		for (const [toml, code] of [
			[HELLO.replaceAll('hello', 'p'), 'DEPLOYMENT_INSTANCE_RESERVED'],
			[`${HELLO}\n[site]\nbase_path = "//evil.example/"\n`, 'DEPLOYMENT_BASE_PATH_INVALID'],
			[HELLO.replace('\n\n', '\n\n[workspace]\nid = "assets"\n\n'), 'DEPLOYMENT_WORKSPACE_INVALID'],
		] as const) {
			const paths = await layout(toml, helloWith({}));
			const written = await write_(paths);
			expect(written.ok === false && written.refusals.map((refusal) => refusal.code)).toEqual([
				code,
			]);
			expect(existsSync(paths.out)).toBe(false);
		}
	});
});

describe('withFrameSrc', () => {
	const page = (policy: string) =>
		`<meta http-equiv="Content-Security-Policy" content="${policy}">`;

	it('replaces an existing directive and changes nothing else', () => {
		expect(
			withFrameSrc(page("default-src 'self'; frame-src 'none'; base-uri 'none'"), 'https://a.b')
		).toBe(page("default-src 'self'; frame-src https://a.b; base-uri 'none'"));
	});

	it('adds the directive where the specification has it, or at the end', () => {
		expect(withFrameSrc(page("connect-src 'self'; object-src 'none'"), "'none'")).toBe(
			page("connect-src 'self'; frame-src 'none'; object-src 'none'")
		);
		expect(withFrameSrc(page("default-src 'self'"), "'none'")).toBe(
			page("default-src 'self'; frame-src 'none'")
		);
	});

	it('finds nothing to change in a page with no policy', () => {
		expect(withFrameSrc('<html></html>', "'none'")).toBeUndefined();
	});
});

describe('deployment check', () => {
	const check = async (paths: Layout) => {
		let text = '';
		const code = await runCli(['deployment', 'check', paths.config], {
			stdout: (chunk) => (text += chunk),
		});
		return { code, result: JSON.parse(text) };
	};

	it('passes the example, writing nothing, with its notices', async () => {
		const paths = await layout(SPEC_FILE, SPEC_PACKAGES);
		const { code, result } = await check(paths);
		expect(result.error).toBeUndefined();
		expect(code).toBe(0);
		expect(existsSync(paths.out)).toBe(false);
		const notices = result.data.notices.map((notice: { code: string; instance: string }) => [
			notice.instance,
			notice.code,
		]);
		expect(notices).toEqual([
			['work', 'MOUNT_ANNOTATIONS_UNTRUSTED'],
			['work', 'TEAM_INSTANCE_SINGLE_PRINCIPAL'],
			['home', 'MOUNT_ANNOTATIONS_UNTRUSTED'],
			['home', 'STDIO_TRUSTED_CODE'],
		]);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
		expect(JSON.stringify(result)).not.toContain(COMMAND_SECRET);
	});

	describe('P2-E6 (CLI unit): a mounted instance and its projects (9.1, 4.2)', () => {
		const mounted = (extra: string, levels?: string[]) =>
			layout(
				`deployment_version = 2\n\n[apps.work]\napp = "umbel"\npackage = "umbel"\nprefix = "work"\ntransport = "http"\nurl = "http://127.0.0.1:1/mcp"\n${extra}`,
				{
					umbel: {
						...mountedPackage('umbel'),
						...(levels ? { app: { scope_levels: levels } } : {}),
					},
				}
			);
		const warned = async (extra: string, levels?: string[]) => {
			const { code, result } = await check(await mounted(extra, levels));
			expect(code).toBe(0);
			return result.data.warnings.map(({ code: found, key }: { code: string; key: string }) => [
				found,
				key,
			]);
		};

		it('warns INSTANCE_LEVELS_OVERRIDDEN where `projects` overrides a workspace-only manifest', async () => {
			const listed = 'audience = "person"\nprojects = ["atlas"]\n';
			expect(await warned(listed, ['workspace'])).toEqual([
				['INSTANCE_LEVELS_OVERRIDDEN', 'apps.work.projects'],
			]);
			expect(await warned(listed)).toEqual([['INSTANCE_LEVELS_OVERRIDDEN', 'apps.work.projects']]);
			expect(await warned(listed, ['workspace', 'project'])).toEqual([]);
			expect(await warned(listed, ['project'])).toEqual([]);
			expect(await warned('audience = "person"\n', ['workspace'])).toEqual([]);
		});

		it('warns TEAM_INSTANCE_WHOLE_WORKSPACE for a team instance with no `projects`, and keeps its notice', async () => {
			const paths = await mounted('audience = "team"\n', ['workspace', 'project']);
			const { code, result } = await check(paths);
			expect(code).toBe(0);
			expect(result.data.warnings).toEqual([
				{
					code: 'TEAM_INSTANCE_WHOLE_WORKSPACE',
					key: 'apps.work',
					message: 'This team instance serves every member of the workspace.',
					suggestion:
						'List the projects it serves under `projects`, if every member should not reach it.',
				},
			]);
			expect(result.data.notices.map(({ code: found }: { code: string }) => found)).toContain(
				'TEAM_INSTANCE_SINGLE_PRINCIPAL'
			);
			expect(
				await warned('audience = "team"\nprojects = ["atlas"]\n', ['workspace', 'project'])
			).toEqual([]);
		});
	});

	const refusalCodes = async (toml: string, packages: Record<string, unknown>) => {
		const { instanceRefusals, refusals } = await analyzeDeployment(
			(await layout(toml, packages)).config
		);
		return [...refusals, ...instanceRefusals].map(({ code }) => code);
	};

	it('fails where a write only warns', async () => {
		const paths = await layout(
			'deployment_version = 1\n\n[apps.gone]\napp = "gone"\npackage = "gone"\n'
		);
		const { code, result } = await check(paths);
		expect(code).toBe(1);
		expect(result.error.code).toBe('APP_PACKAGE_UNAVAILABLE');
		expect((await write_(paths)).ok).toBe(true);
	});

	it('refuses a package holding another app', async () => {
		expect(
			await refusalCodes('deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "p"\n', {
				p: nativePackage('other'),
			})
		).toEqual(['DEPLOYMENT_APP_MISMATCH']);
	});

	it('wants a sandbox for a view, and only for a view', async () => {
		const file = 'deployment_version = 1\n\n[apps.board]\napp = "board"\npackage = "p"\n';
		expect(await refusalCodes(file, { p: viewPackage('board') })).toEqual([
			'VIEW_SANDBOX_ORIGIN_INVALID',
		]);
		expect(
			await refusalCodes(file.replaceAll('board', 'hello'), { p: nativePackage('hello') })
		).toEqual([]);
	});

	it('wants an audience of a mounted package, and refuses mounted keys on another', async () => {
		expect(
			await refusalCodes(
				`deployment_version = 1\n\n[apps.umbel]\napp = "umbel"\npackage = "p"\nurl = "${URL_SECRET}"\n`,
				{ p: mountedPackage('umbel') }
			)
		).toContain('DEPLOYMENT_AUDIENCE_REQUIRED');
		expect(
			await refusalCodes(
				'deployment_version = 1\n\n[apps.work]\napp = "hello"\npackage = "p"\nprefix = "work"\naudience = "person"\n',
				{ p: nativePackage('hello') }
			)
		).toContain('DEPLOYMENT_INSTANCE_MISMATCH');
	});

	it('checks the keys of the transport the manifest defaults', async () => {
		const mounted = (extra: string, transport: string) =>
			refusalCodes(
				`deployment_version = 1\n\n[apps.work]\napp = "umbel"\npackage = "p"\naudience = "person"\n${extra}`,
				{ p: mountedPackage('umbel', transport) }
			);
		expect(await mounted('', 'http')).toEqual(['DEPLOYMENT_TRANSPORT_KEYS']);
		expect(await mounted(`url = "${URL_SECRET}"\n`, 'http')).toEqual([]);
		expect(await mounted('', 'stdio')).toEqual(['DEPLOYMENT_TRANSPORT_KEYS']);
		expect(await mounted('command = ["umbel"]\n', 'stdio')).toEqual([]);
		expect(await mounted(`command = ["umbel"]\nurl = "${URL_SECRET}"\n`, 'stdio')).toContain(
			'DEPLOYMENT_TRANSPORT_KEYS'
		);
		expect(await mounted('command = ["umbel"]\n', 'http')).toContain('DEPLOYMENT_TRANSPORT_KEYS');
		const team = await refusalCodes(
			'deployment_version = 1\n\n[apps.work]\napp = "umbel"\npackage = "p"\naudience = "team"\ncommand = ["umbel"]\n',
			{ p: mountedPackage('umbel', 'stdio') }
		);
		// The file alone can say this one, whichever transport the manifest defaults.
		expect(team).toEqual(['DEPLOYMENT_TEAM_NEEDS_HTTP']);
	});

	it('checks config against the schema, naming no value', async () => {
		const withSchema = nativePackage('hello', {
			config: {
				schema: {
					type: 'object',
					properties: { default_name: { type: 'string' } },
					required: ['default_name'],
					additionalProperties: false,
				},
			},
		});
		const file = (config: string) =>
			`deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "p"\n${config}`;
		expect(
			await refusalCodes(file('config = { default_name = "friend" }\n'), { p: withSchema })
		).toEqual([]);
		expect(await refusalCodes(file(''), { p: withSchema })).toEqual(['APP_CONFIG_INVALID']);
		expect(await refusalCodes(file('config = { a = 1 }\n'), { p: nativePackage('hello') })).toEqual(
			['APP_CONFIG_INVALID']
		);
		const { instanceRefusals } = await analyzeDeployment(
			(await layout(file('config = { default_name = 12345 }\n'), { p: withSchema })).config
		);
		expect(instanceRefusals[0]?.message).not.toContain('12345');
	});

	describe('prefixes (D66)', () => {
		const two = (first: string, second: string) => `deployment_version = 1

[apps.work]
app = "umbel"
package = "p"
audience = "person"
url = "${URL_SECRET}"
${first}

[apps.home]
app = "umbel"
package = "p"
audience = "person"
url = "${URL_SECRET}"
${second}
`;
		const packages = { p: mountedPackage('umbel') };

		it('defaults the first instance to the manifest and wants a name of the next', async () => {
			const { instanceRefusals, instances } = await analyzeDeployment(
				(await layout(two('', ''), packages)).config
			);
			expect(instances[0]?.prefix).toBe('umbel');
			expect(instanceRefusals.map(({ code, key }) => [code, key])).toEqual([
				['INSTANCE_PREFIX_REQUIRED', 'apps.home.prefix'],
			]);
			// With none to give, the kernel refuses it at load.
			const paths = await layout(two('', ''), packages);
			const written = await write_(paths);
			expect(written.ok && written.projection.apps[1]?.prefix).toBeUndefined();
		});

		it('refuses the same prefix twice, with the exact message', async () => {
			const { instanceRefusals } = await analyzeDeployment(
				(await layout(two('prefix = "umbel"', 'prefix = "umbel"'), packages)).config
			);
			expect(instanceRefusals[0]).toMatchObject({
				code: 'INSTANCE_PREFIX_CONFLICT',
				message:
					'Command prefix `umbel` is already used by instance `work`; choose another prefix for `home`.',
			});
		});

		it('refuses a shell domain, and an app id already held', async () => {
			const shell = await refusalCodes(two('prefix = "layout"', 'prefix = "home"'), packages);
			expect(shell).toEqual(['INSTANCE_PREFIX_CONFLICT']);
			const held = await refusalCodes(
				`deployment_version = 1

[apps.hello]
app = "hello"
package = "native"

[apps.work]
app = "umbel"
package = "p"
prefix = "hello"
audience = "person"
url = "${URL_SECRET}"
`,
				{ ...packages, native: nativePackage('hello') }
			);
			expect(held).toEqual(['INSTANCE_PREFIX_CONFLICT']);
		});

		it('refuses the later of an app and a prefix that share a domain', async () => {
			expect(
				await refusalCodes(
					`deployment_version = 1

[apps.work]
app = "umbel"
package = "p"
prefix = "hello"
audience = "person"
url = "${URL_SECRET}"

[apps.hello]
app = "hello"
package = "native"
`,
					{ ...packages, native: nativePackage('hello') }
				)
			).toEqual(['APP_DOMAIN_CONFLICT']);
		});
	});

	it('takes a mounted app with its own id as its prefix', async () => {
		expect(
			await refusalCodes(
				`deployment_version = 1\n\n[apps.umbel]\napp = "umbel"\npackage = "p"\naudience = "person"\nurl = "${URL_SECRET}"\n`,
				{ p: mountedPackage('umbel') }
			)
		).toEqual([]);
	});

	it('carries a package warning without failing', async () => {
		const paths = await layout(
			'deployment_version = 1\n\n[apps.hello]\napp = "hello"\npackage = "p"\n',
			{
				p: nativePackage('hello', {
					commands: [
						{
							name: 'hello-list',
							description: 'List the names greeted, as a sidebar list.',
							effects: ['inspect'],
							input_schema: { type: 'object' },
							requires: ['hello-nothing'],
						},
					],
				}),
			}
		);
		const { code, result } = await check(paths);
		expect(code).toBe(0);
		expect(result.data.warnings[0].code).toBe('MANIFEST_REQUIRES_UNKNOWN');
	});
});

describe('readDeployment, the sandbox origin', () => {
	it.each([
		['https://sandbox.example.com', true],
		['http://127.0.0.1:8123', true],
		['https://sandbox.example.com;script-src', false],
		['https://Sandbox.example.com', false],
		['https://a"b', false],
	])('%s: %s', (origin, ok) => {
		expect(readDeployment({ deployment_version: 1, sandbox: { origin }, apps: {} }).ok).toBe(ok);
	});
});
