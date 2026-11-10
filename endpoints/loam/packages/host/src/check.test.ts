import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHost, hostKindOf } from './check.js';
import { loadServerConfig } from './config.js';
import { resolveSecrets } from './secrets.js';
import { deploymentFile, fixtureDist, serverConfig, temporaryDirectory } from './test-support.js';

const SECRET = 'a'.repeat(32);

async function setup(body = '') {
	const root = await temporaryDirectory();
	const data = join(root, 'data');
	await mkdir(data, { mode: 0o700 });
	return {
		root,
		data,
		dist: await fixtureDist(root),
		deployment: await deploymentFile(root, body),
	};
}

async function secretFile(
	root: string,
	name: string,
	value: string,
	mode = 0o600
): Promise<string> {
	const path = join(root, name);
	await writeFile(path, value, { mode });
	await chmod(path, mode);
	return path;
}

const codes = (findings: Array<{ code: string; key: string }>) =>
	findings.map(({ code, key }) => `${code} ${key}`);

describe('P6-E1: the server configuration against the machine and the deployment (3.2, 3.3)', () => {
	it('P6-E1: a version 1 or 2 deployment reads as static, and the hosted server refuses it as HOST_DEPLOYMENT_KIND', async () => {
		for (const version of [1, 2]) {
			const { root, data, dist } = await setup();
			const deployment = join(root, `v${version}.toml`);
			await writeFile(deployment, `deployment_version = ${version}\n\n[apps]\n`);
			const checked = await checkHost({
				server: serverConfig(data),
				deployment,
				dist,
				purpose: 'serve',
			});
			expect(checked.analysis?.deployment?.deployment_version).toBe(version);
			expect(hostKindOf(checked.analysis?.deployment as never), `version ${version}`).toBe(
				'static'
			);
			expect(codes(checked.refusals)).toEqual([`HOST_DEPLOYMENT_KIND ${deployment}`]);
		}
	});

	it('P6-E1: the test-only option serves a local static deployment until step 3, and `start` still refuses it as HOST_IDENTITY_LOCAL', async () => {
		const { data, dist, deployment } = await setup();
		const served = await checkHost({
			server: serverConfig(data),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(served.refusals).toEqual([]);
		const started = await checkHost({
			server: serverConfig(data),
			deployment,
			dist,
			purpose: 'start',
			serveStatic: true,
		});
		expect(codes(started.refusals)).toEqual([`HOST_IDENTITY_LOCAL ${deployment}`]);
	});

	it("P6-E1: refuses a sandbox origin that is not the deployment's as HOST_SANDBOX_INVALID", async () => {
		const declared = '[sandbox]\norigin = "https://127.0.0.1:8444"\n\n';
		const cases: Array<[string, string | undefined, string]> = [
			[declared, 'https://127.0.0.1:9444', 'HOST_SANDBOX_INVALID sandbox.origin'],
			['', 'https://127.0.0.1:8444', 'HOST_SANDBOX_INVALID sandbox.origin'],
			[declared, undefined, 'HOST_SANDBOX_INVALID sandbox'],
		];
		for (const [body, origin, expected] of cases) {
			const { data, dist, deployment } = await setup(body);
			const checked = await checkHost({
				server: serverConfig(data, origin ? { sandbox: { origin } } : {}),
				deployment,
				dist,
				purpose: 'serve',
				serveStatic: true,
			});
			expect(codes(checked.refusals), `${body} ${origin}`).toEqual([expected]);
		}
		const { data, dist, deployment } = await setup(declared);
		const same = await checkHost({
			server: serverConfig(data, { sandbox: { origin: 'https://127.0.0.1:8444' } }),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(same.refusals).toEqual([]);
	});

	it('P6-E1: refuses a view app with no sandbox served as HOST_SANDBOX_INVALID (D62)', async () => {
		const root = await temporaryDirectory();
		await mkdir(join(root, 'board'));
		await writeFile(join(root, 'board', 'app-manifest.json'), '{"plugin":{"kind":"view"}}');
		const { data, dist, deployment } = await setup(
			`[apps.board]\napp = "board"\npackage = ${JSON.stringify(join(root, 'board'))}\n`
		);
		const checked = await checkHost({
			server: serverConfig(data),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(codes(checked.refusals)).toEqual(['HOST_SANDBOX_INVALID sandbox']);
	});

	it('P6-E1: refuses an [oidc] table no sign-in method names as HOST_OIDC_INVALID', async () => {
		const { root, data, dist, deployment } = await setup();
		const secret = await secretFile(root, 'oidc-corp', 'client-secret');
		const checked = await checkHost({
			server: serverConfig(data, {
				oidc: {
					corp: {
						issuer: 'https://login.example.com',
						client_id: 'loam',
						client_secret_file: secret,
					},
				},
			}),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(codes(checked.refusals)).toEqual(['HOST_OIDC_INVALID oidc.corp']);
	});

	it.each(['api', 'mcp'])(
		'P6-E1: refuses a workspace id the hosted server answers under <base>, %s, until step 3 reserves it',
		async (id) => {
			const { data, dist, deployment } = await setup(`[workspace]\nid = "${id}"\n\n`);
			const checked = await checkHost({
				server: serverConfig(data),
				deployment,
				dist,
				purpose: 'serve',
				serveStatic: true,
			});
			expect(codes(checked.refusals)).toEqual(['DEPLOYMENT_WORKSPACE_INVALID workspace.id']);
		}
	);

	it.each([['mounts'], ['.well-known']])(
		'P6-E1: the deployment file already refuses %s as a workspace id',
		async (id) => {
			const { data, dist, deployment } = await setup(`[workspace]\nid = "${id}"\n\n`);
			const checked = await checkHost({
				server: serverConfig(data),
				deployment,
				dist,
				purpose: 'serve',
				serveStatic: true,
			});
			expect(codes(checked.refusals)).toEqual(['DEPLOYMENT_WORKSPACE_INVALID workspace.id']);
		}
	);

	it('P6-E1: takes a workspace id the hosted server does not answer', async () => {
		const { data, dist, deployment } = await setup('[workspace]\nid = "acme"\n\n');
		const checked = await checkHost({
			server: serverConfig(data),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(checked.refusals).toEqual([]);
	});

	it('P6-E1: warns HOST_ORIGIN_SHARED when base_path is not /', async () => {
		const { data, dist, deployment } = await setup('[site]\nbase_path = "/loam/"\n\n');
		const checked = await checkHost({
			server: serverConfig(data),
			deployment,
			dist,
			purpose: 'serve',
			serveStatic: true,
		});
		expect(checked.refusals).toEqual([]);
		expect(codes(checked.warnings)).toEqual(['HOST_ORIGIN_SHARED site.base_path']);
		expect(checked.warnings[0]?.message).toContain('One deployment per origin');
	});

	it("P6-E1: carries the deployment's own refusals, and a --dist with no page", async () => {
		const { root, data } = await setup();
		const broken = join(root, 'broken.toml');
		await writeFile(broken, 'deployment_version = 9\n');
		const checked = await checkHost({
			server: serverConfig(data),
			deployment: broken,
			dist: join(root, 'nothing'),
			purpose: 'serve',
		});
		expect(codes(checked.refusals)).toEqual(
			expect.arrayContaining([
				'DEPLOYMENT_VERSION_UNSUPPORTED deployment_version',
				'DEPLOYMENT_PATH_INVALID --dist',
			])
		);
	});

	it('P6-E1: refuses a file readServerConfig refuses, before anything else', async () => {
		const { data, dist, deployment } = await setup();
		const checked = await checkHost({
			server: serverConfig(data, { origin: 'http://localhost:8443' }),
			deployment,
			dist,
			purpose: 'serve',
		});
		expect(codes(checked.refusals)).toEqual(['HOST_ORIGIN_INSECURE origin']);
	});
});

describe('P6-E1: secrets and modes (3.2, section 13)', () => {
	it('P6-E1: resolves the auth secret from a 0600 file or a variable, in memory', async () => {
		const { root, data } = await setup();
		const file = await secretFile(root, 'auth', `${SECRET}\n`);
		expect(resolveSecrets(serverConfig(data, { auth: { secret_file: file } })).secrets?.auth).toBe(
			SECRET
		);
		expect(
			resolveSecrets(serverConfig(data, { auth: { secret_env: 'LOAM_TEST_AUTH' } }), {
				LOAM_TEST_AUTH: SECRET,
			}).secrets?.auth
		).toBe(SECRET);
	});

	it.each([
		['an unreadable file', async (root: string) => ({ secret_file: join(root, 'missing') })],
		[
			'an empty file',
			async (root: string) => ({ secret_file: await secretFile(root, 'empty', '') }),
		],
		['an empty variable', async () => ({ secret_env: 'LOAM_TEST_EMPTY' })],
		['an unset variable', async () => ({ secret_env: 'LOAM_TEST_UNSET' })],
		[
			'a secret under 32 bytes',
			async (root: string) => ({ secret_file: await secretFile(root, 'short', 'a'.repeat(31)) }),
		],
	])('P6-E1: refuses %s as HOST_SECRET_UNAVAILABLE', async (_name, make) => {
		const { root, data } = await setup();
		const { refusals, secrets } = resolveSecrets(serverConfig(data, { auth: await make(root) }), {
			LOAM_TEST_EMPTY: '',
		});
		expect(secrets).toBeUndefined();
		expect(codes(refusals)).toEqual(['HOST_SECRET_UNAVAILABLE auth']);
	});

	it.each([
		['a secret file of mode 0644', 'auth'],
		['a secret file of mode 0640', 'auth'],
		["an OIDC client's secret file of mode 0644", 'oidc.corp'],
		["the SMTP URL's file of mode 0604", 'mail'],
		['the TLS key of mode 0644', 'tls.key_file'],
	])('P6-E1: refuses %s as HOST_SECRET_PERMISSIONS, naming chmod 600', async (name, key) => {
		const { root, data } = await setup();
		const mode = name.includes('0640') ? 0o640 : name.includes('0604') ? 0o604 : 0o644;
		const loose = await secretFile(root, 'loose', SECRET, mode);
		const kept = await secretFile(root, 'kept', SECRET);
		const server = serverConfig(data, {
			...(key === 'auth' ? { auth: { secret_file: loose } } : {}),
			...(key === 'oidc.corp'
				? {
						oidc: {
							corp: {
								issuer: 'https://login.example.com',
								client_id: 'loam',
								client_secret_file: loose,
							},
						},
					}
				: {}),
			...(key === 'mail'
				? { mail: { transport: 'smtp', from: 'a@example.com', smtp_url_file: loose } }
				: {}),
			...(key === 'tls.key_file' ? { tls: { cert_file: kept, key_file: loose } } : {}),
		});
		const { refusals } = resolveSecrets(server);
		expect(codes(refusals)).toEqual([`HOST_SECRET_PERMISSIONS ${key}`]);
		expect(refusals[0]?.suggestion).toBe(`Run \`chmod 600 ${loose}\`.`);
	});

	it('P6-E1: refuses a data directory readable by its group or others, naming chmod 700', async () => {
		const { data } = await setup();
		await chmod(data, 0o750);
		const { refusals } = resolveSecrets(serverConfig(data));
		expect(codes(refusals)).toEqual(['HOST_SECRET_PERMISSIONS data']);
		expect(refusals[0]?.suggestion).toBe(`Run \`chmod 700 ${data}\`.`);
	});

	it('P6-E1: refuses an unreadable TLS certificate', async () => {
		const { root, data } = await setup();
		const key = await secretFile(root, 'key.pem', 'key');
		const { refusals } = resolveSecrets(
			serverConfig(data, { tls: { cert_file: join(root, 'missing.pem'), key_file: key } })
		);
		expect(codes(refusals)).toEqual(['HOST_CONFIG_INVALID tls.cert_file']);
	});

	it('never names a secret value in a finding', async () => {
		const { root, data } = await setup();
		const file = await secretFile(root, 'short', 'hunter2');
		const { refusals } = resolveSecrets(serverConfig(data, { auth: { secret_file: file } }));
		expect(JSON.stringify(refusals)).not.toContain('hunter2');
	});
});

describe('loam.server.toml on disk', () => {
	it("reads paths against the file's own directory", async () => {
		const root = await temporaryDirectory();
		const file = join(root, 'loam.server.toml');
		await writeFile(
			file,
			'server_version = 1\norigin = "https://localhost:8443"\nlisten = "127.0.0.1:8443"\ndata = "data"\n\n[auth]\nsecret_file = "secrets/auth"\n'
		);
		const loaded = await loadServerConfig(file);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.server.data).toBe(join(root, 'data'));
		expect(loaded.server.auth?.secret_file).toBe(join(root, 'secrets', 'auth'));
	});

	it('refuses an unreadable file and bad TOML without quoting it', async () => {
		const root = await temporaryDirectory();
		const missing = await loadServerConfig(join(root, 'nothing.toml'));
		expect(missing.ok ? [] : codes(missing.refusals)).toEqual([
			`HOST_CONFIG_INVALID ${join(root, 'nothing.toml')}`,
		]);
		const file = join(root, 'bad.toml');
		await writeFile(file, 'origin = "https://localhost\nsecret = "hunter2"\n');
		const bad = await loadServerConfig(file);
		expect(bad.ok).toBe(false);
		expect(JSON.stringify(bad)).not.toContain('hunter2');
	});
});
