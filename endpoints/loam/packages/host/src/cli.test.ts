import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runHostCli } from './cli.js';
import { acquireDataLock, LOCK_FILE } from './lock.js';
import { deploymentFile, fixtureDist, temporaryDirectory } from './test-support.js';

async function run(args: string[]) {
	let text = '';
	const code = await runHostCli(args, { stdout: (out) => (text += out) });
	return { code, result: JSON.parse(text) };
}

async function files(options: { server?: string; body?: string } = {}) {
	const root = await temporaryDirectory();
	await mkdir(join(root, 'data'), { mode: 0o700 });
	const server = join(root, 'loam.server.toml');
	await writeFile(
		server,
		options.server ??
			'server_version = 1\norigin = "https://localhost:8443"\nlisten = "127.0.0.1:8443"\ndata = "data"\n'
	);
	return {
		root,
		server,
		deployment: await deploymentFile(root, options.body),
		dist: await fixtureDist(root),
	};
}

describe('loam-host check (3.8)', () => {
	it('P6-E1: reports every refusal of 3.2 and 3.3 without starting, and exits 1', async () => {
		const { root, server, deployment, dist } = await files();
		const { code, result } = await run([
			'check',
			'--server',
			server,
			'--deployment',
			deployment,
			'--dist',
			dist,
		]);
		expect(code).toBe(1);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('HOST_DEPLOYMENT_KIND');
		expect(result.error.details.refusals.map(({ code }: { code: string }) => code)).toEqual([
			'HOST_DEPLOYMENT_KIND',
			'HOST_IDENTITY_LOCAL',
		]);
		expect(readdirSync(join(root, 'data'))).toEqual([]);
	});

	it('P6-E1: reports a refusal of the file itself', async () => {
		const { server, deployment, dist } = await files({
			server:
				'server_version = 1\norigin = "http://localhost:8443"\nlisten = "127.0.0.1:8443"\ndata = "data"\n',
		});
		const { code, result } = await run([
			'check',
			'--server',
			server,
			'--deployment',
			deployment,
			'--dist',
			dist,
		]);
		expect(code).toBe(1);
		expect(result.error.code).toBe('HOST_ORIGIN_INSECURE');
	});

	it('refuses an unknown command, a missing option and an unknown one', async () => {
		expect((await run(['serve'])).result.error.code).toBe('CLI_USAGE');
		expect((await run([])).result.error.code).toBe('CLI_USAGE');
		expect((await run(['check', '--server', 'a'])).result.error.code).toBe('CLI_USAGE');
		expect(
			(await run(['doctor', '--server', 'a', '--deployment', 'b', '--port', '1'])).result.error.code
		).toBe('CLI_USAGE');
	});
});

describe('loam-host doctor, its read-only part (3.8)', () => {
	it('reports the check, the lock holder from .lock, the files and what to back up, and never takes the lock', async () => {
		const { root, server, deployment } = await files();
		const data = join(root, 'data');
		const lock = acquireDataLock(data);
		await writeFile(join(data, 'loam.sqlite'), 'rows', { mode: 0o600 });
		const { code, result } = await run(['doctor', '--server', server, '--deployment', deployment]);
		lock.release();
		expect(code).toBe(1);
		expect(result.error.code).toBe('HOST_DEPLOYMENT_KIND');
		const report = result.error.details;
		expect(report.lock).toEqual(lock.info);
		expect(report.files.filter(({ path }: { path: string }) => !path.endsWith('-journal'))).toEqual(
			[
				{ path: '.lock', bytes: expect.any(Number) },
				{ path: 'loam.sqlite', bytes: 4 },
				{ path: LOCK_FILE, bytes: expect.any(Number) },
			]
		);
		expect(report.backup).toEqual([
			{ path: 'loam.sqlite', exists: true },
			{ path: 'auth.sqlite', exists: false },
		]);
	});

	it('opens nothing in a data directory no host has used', async () => {
		const { root, server, deployment } = await files();
		const { result } = await run(['doctor', '--server', server, '--deployment', deployment]);
		expect(result.error.details.lock).toBeNull();
		expect(result.error.details.files).toEqual([]);
		expect(existsSync(join(root, 'data', LOCK_FILE))).toBe(false);
	});
});

describe('placement (section 2)', () => {
	const packages = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

	it('the host never reaches a browser: web, chrome and kernel never import it', () => {
		const found: string[] = [];
		const walk = (directory: string): void => {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) walk(path);
				else if (
					/\.(ts|js|mjs)$/.test(entry.name) &&
					readFileSync(path, 'utf8').includes('@lushly-dev/loam-host')
				)
					found.push(relative(packages, path));
			}
		};
		for (const unit of ['web', 'chrome', 'kernel']) walk(join(packages, unit, 'src'));
		expect(found).toEqual([]);
	});
});
