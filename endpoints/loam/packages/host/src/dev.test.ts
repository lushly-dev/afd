import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runHostCli } from './cli.js';
import { type DevProfile, runDev } from './dev.js';
import { spkiOf } from './dev-files.js';
import type { HostError } from './errors.js';
import { deploymentFile, fixtureDist, raw, temporaryDirectory } from './test-support.js';
import { SERVE_STATIC_DEPLOYMENT } from './testing-only.js';

const HTML = 'text/html';
const running: DevProfile[] = [];
afterEach(async () => {
	await Promise.all(running.splice(0).map((profile) => profile.host.close()));
});

async function setup(body = '') {
	const root = await temporaryDirectory();
	return { root, deployment: await deploymentFile(root, body), dist: await fixtureDist(root) };
}

async function dev(options: Parameters<typeof runDev>[0]): Promise<DevProfile> {
	const profile = await runDev({ ...options, [SERVE_STATIC_DEPLOYMENT]: true });
	running.push(profile);
	return profile;
}

const portOf = (origin: string) => Number(new URL(origin).port);

/** A view app's package: enough for the deployment to need the sandbox. */
async function viewApp(root: string): Promise<string> {
	const directory = join(root, 'board');
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'app-manifest.json'), '{"plugin":{"kind":"view"}}');
	return `[apps.board]\napp = "board"\npackage = ${JSON.stringify(directory)}\n`;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (cause) {
		return (cause as HostError).code;
	}
	return 'none';
}

describe('the development profile, in 5.1 order', () => {
	it('makes .loam-dev beside the deployment, 0700 with files 0600, and a .gitignore of *', async () => {
		const { root, deployment, dist } = await setup();
		const profile = await dev({ deployment, dist });
		expect(profile.data).toBe(join(root, '.loam-dev'));
		expect(readFileSync(join(profile.data, '.gitignore'), 'utf8')).toBe('*\n');
		const walk = (directory: string): void => {
			expect(statSync(directory).mode & 0o777, directory).toBe(0o700);
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) walk(path);
				else expect(statSync(path).mode & 0o777, relative(root, path)).toBe(0o600);
			}
		};
		walk(profile.data);
		expect(readdirSync(profile.data).sort()).toEqual(
			expect.arrayContaining([
				'.gitignore',
				'.lock',
				'dev.json',
				'lock.sqlite',
				'mail.jsonl',
				'public',
				'secrets',
				'tls',
			])
		);
		expect(readFileSync(join(profile.data, 'secrets', 'auth'), 'utf8').trim()).toMatch(
			/^[A-Za-z0-9_-]{43}$/
		);
	});

	it('serves https://localhost:<port> with the certificate whose SPKI it reports, and no HSTS', async () => {
		const { deployment, dist } = await setup();
		const profile = await dev({ deployment, dist });
		expect(profile.origin).toMatch(/^https:\/\/localhost:\d+$/);
		expect(profile.sandboxOrigin).toBeNull();
		expect(profile.spki).toBe(spkiOf(readFileSync(profile.certificate)));
		const answer = await raw(portOf(profile.origin), '/', {
			host: new URL(profile.origin).host,
			accept: HTML,
			tls: true,
		});
		expect(answer.status).toBe(200);
		expect(answer.headers['strict-transport-security']).toBeUndefined();
		expect(profile.mail).toBe(join(profile.data, 'mail.jsonl'));
	});

	it('records its ports in dev.json and keeps the origin, the certificate and the secret across runs', async () => {
		const { deployment, dist } = await setup();
		const first = await dev({ deployment, dist });
		const secret = readFileSync(join(first.data, 'secrets', 'auth'), 'utf8');
		expect(JSON.parse(readFileSync(join(first.data, 'dev.json'), 'utf8'))).toEqual({
			port: portOf(first.origin),
		});
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		const second = await dev({ deployment, dist });
		expect(second.origin).toBe(first.origin);
		expect(second.spki).toBe(first.spki);
		expect(readFileSync(join(second.data, 'secrets', 'auth'), 'utf8')).toBe(secret);
	});

	it('refuses a --port other than dev.json records as HOST_DEV_PORT_CHANGED, and frees the lock', async () => {
		const { deployment, dist } = await setup();
		const first = await dev({ deployment, dist });
		const port = portOf(first.origin);
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		expect(await refusal(dev({ deployment, dist, port: port === 65_000 ? 65_001 : 65_000 }))).toBe(
			'HOST_DEV_PORT_CHANGED'
		);
		const again = await dev({ deployment, dist, port });
		expect(again.origin).toBe(first.origin);
	});

	it('refuses a recorded port that is taken as HOST_PORT_TAKEN, rather than a new origin', async () => {
		const { deployment, dist } = await setup();
		const first = await dev({ deployment, dist });
		const port = portOf(first.origin);
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		const blocker = createServer();
		await new Promise<void>((done) => blocker.listen(port, '127.0.0.1', done));
		try {
			expect(await refusal(dev({ deployment, dist }))).toBe('HOST_PORT_TAKEN');
		} finally {
			await new Promise<void>((done) => blocker.close(() => done()));
		}
		expect((await dev({ deployment, dist })).origin).toBe(first.origin);
	});

	it('names --port, not dev.json, when a port it names is taken, and the real dev.json when that is', async () => {
		const { deployment, dist } = await setup();
		const blocker = createServer();
		await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
		const taken = (blocker.address() as { port: number }).port;
		try {
			const refused = await dev({ deployment, dist, port: taken }).catch(
				(cause) => cause as HostError
			);
			expect((refused as HostError).code).toBe('HOST_PORT_TAKEN');
			expect((refused as HostError).refusals[0]?.key).toBe('--port');
			expect((refused as HostError).message).not.toContain('dev.json');
		} finally {
			await new Promise<void>((done) => blocker.close(() => done()));
		}
		const first = await dev({ deployment, dist });
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		const again = createServer();
		await new Promise<void>((done) => again.listen(portOf(first.origin), '127.0.0.1', done));
		try {
			const refused = (await dev({ deployment, dist }).catch((cause) => cause)) as HostError;
			expect(refused.refusals[0]?.key).toBe(join(first.data, 'dev.json'));
			expect(refused.message).toContain('`dev.json` records');
		} finally {
			await new Promise<void>((done) => again.close(() => done()));
		}
	});

	it("refuses a corrupt dev.json, and a --data that is not the profile's, before it takes the lock", async () => {
		const { root, deployment, dist } = await setup();
		const data = join(root, '.loam-dev');
		await mkdir(data, { mode: 0o700 });
		await writeFile(join(data, 'dev.json'), '{"port":"x"}');
		expect(await refusal(dev({ deployment, dist }))).toBe('HOST_CONFIG_INVALID');
		const theirs = join(root, 'theirs');
		await mkdir(theirs);
		await writeFile(join(theirs, 'notes.txt'), 'mine');
		expect(await refusal(dev({ deployment, dist, data: theirs }))).toBe('HOST_CONFIG_INVALID');
		expect(readdirSync(theirs)).toEqual(['notes.txt']);
	});

	it('binds the sandbox on https://127.0.0.1:<second port>, another site, and writes the site with it', async () => {
		const { root, dist } = await setup();
		const deployment = await deploymentFile(
			root,
			`[sandbox]\norigin = "https://sandbox.example.com"\n\n${await viewApp(root)}`
		);
		const profile = await dev({ deployment, dist });
		expect(profile.sandboxOrigin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
		const sandboxPort = portOf(profile.sandboxOrigin as string);
		expect(JSON.parse(readFileSync(join(profile.data, 'dev.json'), 'utf8'))).toEqual({
			port: portOf(profile.origin),
			sandboxPort,
		});
		const site = join(profile.data, 'public', 'site');
		expect(JSON.parse(readFileSync(join(site, 'deployment.json'), 'utf8')).sandbox_origin).toBe(
			profile.sandboxOrigin
		);
		expect(readFileSync(join(site, 'index.html'), 'utf8')).toContain(
			`frame-src ${profile.sandboxOrigin}`
		);
		const proxy = await raw(sandboxPort, '/sandbox/proxy.html', {
			host: `127.0.0.1:${sandboxPort}`,
			tls: true,
		});
		expect(proxy.status).toBe(200);
		expect(proxy.headers['content-security-policy']).toBe(`frame-ancestors ${profile.origin}`);
		expect(
			(await raw(sandboxPort, '/', { host: new URL(profile.origin).host, tls: true })).status
		).toBe(421);
	});

	it('adds a sandbox port to dev.json when a view app arrives later, and keeps the origin', async () => {
		const { root, deployment, dist } = await setup();
		const first = await dev({ deployment, dist });
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		await writeFile(deployment, `deployment_version = 2\n\n${await viewApp(root)}`);
		const second = await dev({ deployment, dist });
		expect(second.origin).toBe(first.origin);
		expect(second.sandboxOrigin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
		expect(JSON.parse(readFileSync(join(second.data, 'dev.json'), 'utf8')).sandboxPort).toBe(
			portOf(second.sandboxOrigin as string)
		);
	});

	it('keeps a recorded sandbox port while no view app needs it, so its origin comes back the same', async () => {
		const { root, dist } = await setup();
		const deployment = await deploymentFile(root, await viewApp(root));
		const first = await dev({ deployment, dist });
		const sandboxPort = portOf(first.sandboxOrigin as string);
		await first.host.close();
		running.splice(running.indexOf(first), 1);
		await writeFile(deployment, 'deployment_version = 2\n\n[apps]\n');
		const plain = await dev({ deployment, dist });
		expect(plain.sandboxOrigin).toBeNull();
		expect(JSON.parse(readFileSync(join(plain.data, 'dev.json'), 'utf8')).sandboxPort).toBe(
			sandboxPort
		);
		await plain.host.close();
		running.splice(running.indexOf(plain), 1);
		await writeFile(deployment, `deployment_version = 2\n\n${await viewApp(join(root, 'again'))}`);
		expect((await dev({ deployment, dist })).sandboxOrigin).toBe(first.sandboxOrigin);
	});

	it('refuses a data directory another profile holds as HOST_DATA_LOCKED', async () => {
		const { deployment, dist } = await setup();
		await dev({ deployment, dist });
		expect(await refusal(dev({ deployment, dist }))).toBe('HOST_DATA_LOCKED');
	});
});

describe('loam-host dev, the bin', () => {
	it('refuses a version 2 deployment as HOST_DEPLOYMENT_KIND until step 3, and leaves the lock free', async () => {
		const { root, deployment, dist } = await setup();
		let text = '';
		const code = await runHostCli(['dev', '--deployment', deployment, '--dist', dist], {
			stdout: (chunk) => (text += chunk),
			untilStopped: async () => {},
		});
		expect(code).toBe(1);
		expect(JSON.parse(text).error.code).toBe('HOST_DEPLOYMENT_KIND');
		expect((await dev({ deployment, dist, data: join(root, '.loam-dev') })).origin).toMatch(
			/^https:\/\/localhost:/
		);
	});

	it('refuses a port that is not one', async () => {
		let text = '';
		await runHostCli(['dev', '--deployment', 'x', '--port', '70000'], {
			stdout: (chunk) => (text += chunk),
		});
		expect(JSON.parse(text).error.code).toBe('CLI_USAGE');
	});

	it('never reaches @lushly-dev/loam-host/testing', () => {
		const source = dirname(fileURLToPath(import.meta.url));
		const seen = new Set<string>();
		const visit = (file: string): void => {
			if (seen.has(file)) return;
			seen.add(file);
			for (const [, path] of readFileSync(file, 'utf8').matchAll(
				/(?:^|\n)\s*(?:import|export)[^'"]*from\s+'(\.[^']+)'/g
			))
				visit(join(dirname(file), (path as string).replace(/\.js$/, '.ts')));
		};
		visit(join(source, 'cli.ts'));
		expect(
			[...seen].map((file) => relative(source, file)).filter((file) => file.startsWith('testing/'))
		).toEqual([]);
		expect(seen.has(join(source, 'dev.ts'))).toBe(true);
	});
});
