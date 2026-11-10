import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { HostError } from './errors.js';
import { createLoamHost, type LoamHost, type LoamHostConfig } from './host.js';
import { bindServer, createHostServer, HOST_INTERNALS } from './internal.js';
import { acquireDataLock } from './lock.js';
import {
	deploymentFile,
	fixtureDist,
	raw,
	rawRequest,
	SHELL_POLICY,
	serverConfig,
	temporaryDirectory,
} from './test-support.js';
import { boundAddresses, SERVE_STATIC_DEPLOYMENT } from './testing-only.js';

const HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
const SHELL_HOST = 'localhost:8443';
const SANDBOX_ORIGIN = 'https://127.0.0.1:8444';
const SANDBOX_HOST = '127.0.0.1:8444';

const hosts: LoamHost[] = [];
afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.close()));
});

async function start(
	options: {
		body?: string;
		server?: Partial<LoamHostConfig['server']>;
		staticOption?: boolean;
	} = {}
) {
	const root = await temporaryDirectory();
	const data = join(root, 'data');
	const config = {
		server: serverConfig(data, options.server),
		deployment: await deploymentFile(root, options.body),
		dist: await fixtureDist(root),
		...(options.staticOption === false ? {} : { [SERVE_STATIC_DEPLOYMENT]: true as const }),
	};
	const host = await createLoamHost(config);
	hosts.push(host);
	await host.listen();
	const { shell, sandbox } = boundAddresses(host);
	return { root, data, config, host, port: shell.port, sandboxPort: sandbox?.port };
}

const common = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
	'cross-origin-opener-policy': 'same-origin',
};

describe('P6-E2: the hosted shell, served (3.4, 3.5)', () => {
	it("P6-E2: serves a shell page with the <meta> policy plus frame-ancestors 'none' as its header", async () => {
		const { port } = await start();
		for (const path of ['/', '/index.html', '/acme/p/atlas/hello', '/v1.2.3']) {
			const answer = await raw(port, path, { host: SHELL_HOST, accept: HTML });
			expect(answer.status, path).toBe(200);
			expect(answer.headers['content-type']).toBe('text/html; charset=utf-8');
			expect(answer.headers['content-security-policy']).toBe(
				`${SHELL_POLICY}; frame-ancestors 'none'`
			);
			expect(answer.headers['permissions-policy']).toBe(
				'camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=()'
			);
			expect(answer.headers['cache-control']).toBe('no-cache');
			expect(answer.headers).toMatchObject(common);
			expect(answer.headers['strict-transport-security']).toBeUndefined();
			expect(answer.body).toContain('<!doctype html>');
		}
	});

	it("P6-E2: adds form-action 'self' on the four account pages", async () => {
		const { port } = await start();
		for (const path of [
			'/~/oauth/login',
			'/~/oauth/consent',
			'/~/join?invitation=a&token=b',
			'/%7E/recover',
		]) {
			const answer = await raw(port, path, { host: SHELL_HOST, accept: HTML });
			expect(answer.status, path).toBe(200);
			expect(answer.headers['content-security-policy'], path).toBe(
				`${SHELL_POLICY}; frame-ancestors 'none'; form-action 'self'`
			);
		}
	});

	it('P6-E2: caches hashed assets as immutable, the projection as no-cache, and HEAD answers no body', async () => {
		const { port } = await start();
		const asset = await raw(port, '/assets/index-a1b2c3.js', { host: SHELL_HOST });
		expect(asset.status).toBe(200);
		expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
		expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
		expect(asset.headers['content-security-policy']).toBeUndefined();
		const projection = await raw(port, '/deployment.json', { host: SHELL_HOST });
		expect(projection.headers['cache-control']).toBe('no-cache');
		expect(JSON.parse(projection.body)).toHaveProperty('apps');
		const head = await raw(port, '/assets/index-a1b2c3.js', { host: SHELL_HOST, method: 'HEAD' });
		expect(head.status).toBe(200);
		expect(head.body).toBe('');
		expect(head.headers['content-length']).toBe(String('export {};\n'.length));
	});

	it('P6-E2: answers 404 in plain text for a path with no file to a request not naming text/html', async () => {
		const { port } = await start();
		const answer = await raw(port, '/acme/p/atlas', {
			host: SHELL_HOST,
			accept: 'application/json',
		});
		expect(answer.status).toBe(404);
		expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
		expect(answer.headers).toMatchObject(common);
		expect(await raw(port, '/index.html', { host: SHELL_HOST, method: 'POST' })).toMatchObject({
			status: 404,
		});
	});

	it('P6-E2: refuses every traversal of the data directory with a 404', async () => {
		const { port, data } = await start();
		await writeFile(join(data, 'secret.txt'), 'never served');
		await symlink(join(data, 'secret.txt'), join(data, 'public', 'site', 'leak.txt'));
		await symlink(data, join(data, 'public', 'site', 'up'));
		for (const path of [
			'/../secret.txt',
			'/../../data/secret.txt',
			'/assets/../../secret.txt',
			'/%2e%2e/secret.txt',
			'/%2E%2E/lock.sqlite',
			'/.%2e/.lock',
			'/%252e%252e/secret.txt',
			'/..%2fsecret.txt',
			'/assets%2f..%2f..%2fsecret.txt',
			'/..%5csecret.txt',
			'/index.html%00',
			'/leak.txt',
			'/up/secret.txt',
			'/up/lock.sqlite',
		]) {
			for (const accept of [undefined, HTML]) {
				const answer = await raw(port, path, { host: SHELL_HOST, ...(accept ? { accept } : {}) });
				expect(answer.status, `${path} ${accept}`).toBe(404);
				expect(answer.body).not.toContain('never served');
			}
		}
		// A raw backslash never reaches the host: Node's parser refuses the request line itself.
		expect(await rawRequest(port, `GET /..\\secret.txt HTTP/1.1\r\nHost: ${SHELL_HOST}`)).toBe(400);
	});

	it("P6-E2: serves every non-shell response on the shell's origin inert but scripts and styles: sandbox/proxy.html, an app package's page and SVG, the projection", async () => {
		const packages = await temporaryDirectory();
		await mkdir(join(packages, 'notes'));
		await writeFile(join(packages, 'notes', 'app-manifest.json'), '{"plugin":{"kind":"native"}}');
		await writeFile(
			join(packages, 'notes', 'page.html'),
			'<!doctype html><script>alert(1)</script>'
		);
		await writeFile(
			join(packages, 'notes', 'icon.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
		);
		await writeFile(join(packages, 'notes', 'style.css'), 'body {}');
		const { port } = await start({
			body: `[apps.notes]\napp = "notes"\npackage = ${JSON.stringify(join(packages, 'notes'))}\n`,
		});
		for (const path of ['/apps/notes/style.css', '/assets/index-a1b2c3.js'])
			expect(
				(await raw(port, path, { host: SHELL_HOST })).headers['content-security-policy'],
				path
			).toBeUndefined();
		for (const path of [
			'/sandbox/proxy.html',
			'/apps/notes/page.html',
			'/apps/notes/icon.svg',
			'/deployment.json',
		]) {
			const answer = await raw(port, path, { host: SHELL_HOST, accept: HTML });
			expect(answer.status, path).toBe(200);
			expect(answer.headers['content-security-policy'], path).toBe(
				"sandbox; default-src 'none'; frame-ancestors 'none'"
			);
			expect(answer.headers['permissions-policy'], path).toBeUndefined();
		}
	});

	it('answers its health, and 404 with no-store on the routes later steps build', async () => {
		const { port } = await start();
		const health = await raw(port, '/api/health', { host: SHELL_HOST });
		expect(health.status).toBe(200);
		expect(JSON.parse(health.body)).toEqual({ ok: true });
		expect(health.headers['cache-control']).toBe('no-store');
		expect(health.headers).toMatchObject(common);
		for (const [path, method] of [
			['/mcp', 'POST'],
			['/mcp', 'GET'],
			['/api/kernel/call', 'POST'],
			['/mounts/hello/mcp', 'POST'],
			['/api/health', 'POST'],
		] as const) {
			const answer = await raw(port, path, { host: SHELL_HOST, method, accept: HTML });
			expect(answer.status, `${method} ${path}`).toBe(404);
			expect(answer.headers['cache-control'], path).toBe('no-store');
		}
		for (const path of [
			'/sse',
			'/message',
			'/rpc',
			'/batch',
			'/stream/x',
			'/health',
			'/.well-known/oauth-protected-resource',
		])
			expect((await raw(port, path, { host: SHELL_HOST })).status, path).toBe(404);
	});

	it('serves under base_path only', async () => {
		const { port } = await start({ body: '[site]\nbase_path = "/loam/"\n\n' });
		expect((await raw(port, '/', { host: SHELL_HOST, accept: HTML })).status).toBe(404);
		expect((await raw(port, '/index.html', { host: SHELL_HOST, accept: HTML })).status).toBe(404);
		const page = await raw(port, '/loam/acme/p/atlas', { host: SHELL_HOST, accept: HTML });
		expect(page.status).toBe(200);
		expect(page.body).toContain('src="/loam/assets/index-a1b2c3.js"');
		expect((await raw(port, '/loam/assets/index-a1b2c3.js', { host: SHELL_HOST })).status).toBe(
			200
		);
		expect((await raw(port, '/loam/api/health', { host: SHELL_HOST })).status).toBe(200);
		expect((await raw(port, '/loam/../loam/index.html', { host: SHELL_HOST })).status).toBe(404);
		expect((await raw(port, '/loam/mcp', { host: SHELL_HOST, method: 'POST' })).status).toBe(404);
	});
});

describe('the Host check (3.2)', () => {
	it('answers 421 in plain text, with the common headers, for any other Host', async () => {
		const { port } = await start();
		for (const host of [
			'evil.example',
			'localhost',
			'localhost:8444',
			'127.0.0.1:8443',
			`127.0.0.1:${port}`,
			'localhost:8443.evil.example',
		]) {
			const answer = await raw(port, '/', { host, accept: HTML });
			expect(answer.status, host).toBe(421);
			expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
			expect(answer.headers).toMatchObject(common);
			expect(answer.headers['content-security-policy']).toBeUndefined();
		}
	});

	it('answers 421 for no Host, two Hosts, and an absolute target naming another host', async () => {
		const { port } = await start();
		expect(await rawRequest(port, 'GET / HTTP/1.1')).toBe(421);
		expect(
			await rawRequest(port, `GET / HTTP/1.1\r\nHost: ${SHELL_HOST}\r\nHost: ${SHELL_HOST}`)
		).toBe(421);
		expect(await rawRequest(port, `GET /index.html HTTP/1.1\r\nHost: ${SHELL_HOST}`)).toBe(200);
		expect(
			(await raw(port, 'http://evil.example/', { host: SHELL_HOST, accept: HTML })).status
		).toBe(421);
		const same = await raw(port, `https://${SHELL_HOST}/acme`, { host: SHELL_HOST, accept: HTML });
		expect(same.status).toBe(200);
		expect(
			(await raw(port, `https://${SHELL_HOST}/../secret`, { host: SHELL_HOST, accept: HTML }))
				.status
		).toBe(404);
	});

	it('compares the Host without regard to case', async () => {
		const { port } = await start();
		expect((await raw(port, '/', { host: 'LocalHost:8443', accept: HTML })).status).toBe(200);
	});

	it('reads no X-Forwarded-* header', async () => {
		const { port } = await start();
		const answer = await new Promise<number>((done, fail) => {
			import('node:http').then(({ request }) => {
				const outgoing = request(
					{
						host: '127.0.0.1',
						port,
						path: '/',
						headers: { host: 'evil.example', 'x-forwarded-host': SHELL_HOST, accept: HTML },
					},
					(incoming) => {
						incoming.resume();
						done(incoming.statusCode ?? 0);
					}
				);
				outgoing.on('error', fail);
				outgoing.end();
			}, fail);
		});
		expect(answer).toBe(421);
	});
});

describe('the sandbox on another site (3.2, 3.4, D62)', () => {
	const body = `[sandbox]\norigin = "${SANDBOX_ORIGIN}"\n\n`;

	it("serves sandbox/ by Host on the shell's listener, framed only by the shell's origin", async () => {
		const { port, host } = await start({ body, server: { sandbox: { origin: SANDBOX_ORIGIN } } });
		expect(host.sandboxOrigin).toBe(SANDBOX_ORIGIN);
		const proxy = await raw(port, '/sandbox/proxy.html', { host: SANDBOX_HOST, accept: HTML });
		expect(proxy.status).toBe(200);
		expect(proxy.headers['content-security-policy']).toBe('frame-ancestors https://localhost:8443');
		expect(proxy.headers).toMatchObject(common);
		const script = await raw(port, '/sandbox/proxy.js', { host: SANDBOX_HOST });
		expect(script.status).toBe(200);
		expect(script.headers['content-security-policy']).toBeUndefined();
		for (const path of [
			'/',
			'/index.html',
			'/deployment.json',
			'/sandbox/',
			'/sandbox/../index.html',
			'/api/health',
		])
			expect((await raw(port, path, { host: SANDBOX_HOST, accept: HTML })).status, path).toBe(404);
	});

	it('serves sandbox/ on its own listener, and nothing of the shell there', async () => {
		const { port, sandboxPort } = await start({
			body,
			server: { sandbox: { origin: SANDBOX_ORIGIN, listen: '127.0.0.1:0' } },
		});
		expect(sandboxPort).toBeDefined();
		expect(sandboxPort).not.toBe(port);
		const proxy = await raw(sandboxPort as number, '/sandbox/proxy.html', { host: SANDBOX_HOST });
		expect(proxy.status).toBe(200);
		expect((await raw(sandboxPort as number, '/', { host: SHELL_HOST, accept: HTML })).status).toBe(
			421
		);
		expect((await raw(port, '/sandbox/proxy.html', { host: SANDBOX_HOST })).status).toBe(421);
	});
});

describe('P6-E1: construction (3.1, section 4)', () => {
	it('P6-E1: refuses a static deployment without the test-only option, and leaves the directory unlocked', async () => {
		const root = await temporaryDirectory();
		const data = join(root, 'data');
		const config = {
			server: serverConfig(data),
			deployment: await deploymentFile(root),
			dist: await fixtureDist(root),
		};
		await expect(createLoamHost(config)).rejects.toMatchObject({ code: 'HOST_DEPLOYMENT_KIND' });
		const host = await createLoamHost({ ...config, [SERVE_STATIC_DEPLOYMENT]: true });
		await host.close();
	});

	it('refuses a data directory another host holds as HOST_DATA_LOCKED, and frees it on close', async () => {
		const { config, host } = await start();
		let refused: unknown;
		try {
			await createLoamHost(config);
		} catch (cause) {
			refused = cause;
		}
		expect(refused).toBeInstanceOf(HostError);
		expect((refused as HostError).code).toBe('HOST_DATA_LOCKED');
		await host.close();
		const again = await createLoamHost(config);
		hosts.push(again);
	});

	it('P6-E1: creates the data directory 0700, writes the site 0600 and 0700, and never a mounts file', async () => {
		const { data } = await start();
		expect(statSync(data).mode & 0o777).toBe(0o700);
		expect(readdirSync(join(data, 'public'))).toEqual(['site']);
		const walk = (directory: string): void => {
			expect(statSync(directory).mode & 0o777, directory).toBe(0o700);
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) walk(path);
				else expect(statSync(path).mode & 0o777, path).toBe(0o600);
			}
		};
		walk(join(data, 'public'));
		// The lock's rollback journal stays, zeroed, while the lock is held in exclusive mode.
		expect(
			readdirSync(data)
				.filter((name) => !name.endsWith('-journal'))
				.sort()
		).toEqual(['.lock', 'lock.sqlite', 'public']);
	});

	it('P6-E1: replaces whatever public/ held with the written site', async () => {
		const root = await temporaryDirectory();
		const data = join(root, 'data');
		await mkdir(join(data, 'public', 'stray'), { recursive: true, mode: 0o700 });
		await chmod(data, 0o700);
		await writeFile(join(data, 'public', 'stray', 'file'), 'x');
		const host = await createLoamHost({
			server: serverConfig(data),
			deployment: await deploymentFile(root),
			dist: await fixtureDist(root),
			[SERVE_STATIC_DEPLOYMENT]: true,
		});
		hosts.push(host);
		expect(readdirSync(join(data, 'public'))).toEqual(['site']);
		expect(existsSync(join(data, 'public', 'site', 'index.html'))).toBe(true);
	});

	it('P6-E1: refuses a data directory its group can read, before it locks or writes', async () => {
		const root = await temporaryDirectory();
		const data = join(root, 'data');
		await mkdir(data, { mode: 0o750 });
		await chmod(data, 0o750);
		await expect(
			createLoamHost({
				server: serverConfig(data),
				deployment: await deploymentFile(root),
				dist: await fixtureDist(root),
				[SERVE_STATIC_DEPLOYMENT]: true,
			})
		).rejects.toMatchObject({ code: 'HOST_SECRET_PERMISSIONS' });
		expect(readdirSync(data)).toEqual([]);
	});

	it('P6-E1: refuses a configuration readServerConfig refuses, though it was built in memory', async () => {
		const root = await temporaryDirectory();
		await expect(
			createLoamHost({
				server: serverConfig(join(root, 'data'), { origin: 'http://localhost:8443' }),
				deployment: await deploymentFile(root),
				dist: await fixtureDist(root),
				[SERVE_STATIC_DEPLOYMENT]: true,
			})
		).rejects.toMatchObject({ code: 'HOST_ORIGIN_INSECURE' });
	});
});

describe('a failed start leaves nothing half-built', () => {
	it('releases the lock when a step after it fails', async () => {
		const root = await temporaryDirectory();
		const data = join(root, 'data');
		const dist = await fixtureDist(root);
		// The check passes, and `writeDeployment` then refuses a `--dist` that holds the deployment file.
		const deployment = await deploymentFile(dist);
		await expect(
			createLoamHost({
				server: serverConfig(data),
				deployment,
				dist,
				[SERVE_STATIC_DEPLOYMENT]: true,
			})
		).rejects.toMatchObject({ code: 'DEPLOYMENT_PATH_INVALID' });
		acquireDataLock(data).release();
	});

	it('closes what started when a listener fails, and listens again once it can', async () => {
		const blocker = createServer();
		await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
		const taken = (blocker.address() as AddressInfo).port;
		const root = await temporaryDirectory();
		const host = await createLoamHost({
			server: serverConfig(join(root, 'data'), {
				sandbox: { origin: SANDBOX_ORIGIN, listen: `127.0.0.1:${taken}` },
			}),
			deployment: await deploymentFile(root, `[sandbox]\norigin = "${SANDBOX_ORIGIN}"\n\n`),
			dist: await fixtureDist(root),
			[SERVE_STATIC_DEPLOYMENT]: true,
		});
		hosts.push(host);
		await expect(host.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
		expect(() => boundAddresses(host)).toThrow('not listening');
		await new Promise<void>((done) => blocker.close(() => done()));
		await host.listen();
		const { shell, sandbox } = boundAddresses(host);
		expect(sandbox?.port).toBe(taken);
		expect((await raw(shell.port, '/index.html', { host: SHELL_HOST })).status).toBe(200);
	});
});

describe('sockets handed over by the development profile (5.1)', () => {
	it('serves on them with one request handler each, however often listen() runs', async () => {
		const root = await temporaryDirectory();
		const data = join(root, 'data');
		await mkdir(data, { mode: 0o700 });
		const shell = createHostServer();
		await bindServer(shell, '127.0.0.1', 0);
		const port = (shell.address() as AddressInfo).port;
		const host = await createLoamHost({
			server: serverConfig(data, { listen: `127.0.0.1:${port}` }),
			deployment: await deploymentFile(root),
			dist: await fixtureDist(root),
			[SERVE_STATIC_DEPLOYMENT]: true,
			[HOST_INTERNALS]: { lock: acquireDataLock(data), servers: { shell } },
		});
		hosts.push(host);
		await host.listen();
		await host.listen();
		expect(shell.listenerCount('request')).toBe(1);
		expect((await raw(port, '/index.html', { host: SHELL_HOST })).status).toBe(200);
		await host.close();
		expect(shell.listening).toBe(false);
	});
});

describe('TLS and HSTS (3.1, 3.5)', () => {
	async function certificate(root: string): Promise<{ cert: string; key: string }> {
		const cert = join(root, 'cert.pem');
		const key = join(root, 'key.pem');
		await promisify(execFile)(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-keyout',
				key,
				'-out',
				cert,
				'-days',
				'1',
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost,DNS:loam.example.test,IP:127.0.0.1',
			],
			{ timeout: 30_000 }
		);
		await chmod(key, 0o600);
		return { cert, key };
	}

	it('terminates TLS from [tls], and sends HSTS only on a non-loopback origin', async () => {
		const root = await temporaryDirectory();
		const { cert, key } = await certificate(root);
		const local = await start({ server: { tls: { cert_file: cert, key_file: key } } });
		const answer = await raw(local.port, '/', { host: SHELL_HOST, accept: HTML, tls: true });
		expect(answer.status).toBe(200);
		expect(answer.headers['strict-transport-security']).toBeUndefined();
		// The check read the files once: deleting them once the host holds its lock changes nothing.
		const copy = await temporaryDirectory();
		const copied = { cert: join(copy, 'cert.pem'), key: join(copy, 'key.pem') };
		await writeFile(copied.cert, await readFile(cert));
		await writeFile(copied.key, await readFile(key), { mode: 0o600 });
		const root2 = await temporaryDirectory();
		const unread = await createLoamHost({
			server: serverConfig(join(root2, 'data'), {
				tls: { cert_file: copied.cert, key_file: copied.key },
			}),
			deployment: await deploymentFile(root2),
			dist: await fixtureDist(root2),
			[SERVE_STATIC_DEPLOYMENT]: true,
		});
		hosts.push(unread);
		await rm(copy, { recursive: true, force: true });
		await unread.listen();
		const served = await raw(boundAddresses(unread).shell.port, '/index.html', {
			host: SHELL_HOST,
			tls: true,
		});
		expect(served.status).toBe(200);
		const remote = await start({
			server: { origin: 'https://loam.example.test', tls: { cert_file: cert, key_file: key } },
		});
		const named = await raw(remote.port, '/', {
			host: 'loam.example.test',
			accept: HTML,
			tls: true,
		});
		expect(named.status).toBe(200);
		expect(named.headers['strict-transport-security']).toBe('max-age=31536000');
		const port443 = await raw(remote.port, '/', {
			host: 'loam.example.test:443',
			accept: HTML,
			tls: true,
		});
		expect(port443.status).toBe(200);
		const misdirected = await raw(remote.port, '/', { host: SHELL_HOST, tls: true });
		expect(misdirected.status).toBe(421);
		expect(misdirected.headers['strict-transport-security']).toBe('max-age=31536000');
		expect(await readFile(key, 'utf8')).toContain('PRIVATE KEY');
	});
});
