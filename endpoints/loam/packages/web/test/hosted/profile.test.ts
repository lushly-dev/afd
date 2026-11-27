/**
 * P6-H1 (phase 6 specification, section 19): one command, one process. `loam-host dev` from an empty
 * directory, under `base_path = "/loam/"`, on a version 4 deployment with `[host] kind = "hosted"`: the bin
 * itself, and `startDevHost`'s child, which runs the bin's own `runDev`. Since step 3 no test-only option serves
 * an earlier version. Step 1's cases for the `Host` check, the sandbox, the lock, TLS, health and `base_path`
 * are here, on the real profile.
 */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { type DevHost, exposedTo, readAcls, startDevHost } from '@lushly-dev/loam-host/testing';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	deploymentEntry,
	hostedDeploymentFile,
	kernelCall,
	launchForDevHost,
	openShell,
	packApp,
} from '../browser/harness';
import {
	assertsSection14Ceilings,
	COLD_START_LOCAL_NOTE,
	COLD_STARTS,
	LOCAL_BOUNDS,
	SECTION_14_CEILINGS,
} from './budget';
import { BIN, hosted, loamHost, writtenPolicy } from './support';

const HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';

let host: DevHost;
let browser: Browser;
let coldStartMs = 0;
const coldStarts: number[] = [];
/** The start in flight, which `afterAll` closes if the loop throws or the hook times out. */
let starting: DevHost | undefined;

beforeAll(async () => {
	const config = hostedDeploymentFile(
		[],
		deploymentEntry('hello', await packApp('hello')),
		deploymentEntry('tally', await packApp('tally'))
	);
	// Section 14's cold-start row: from an empty directory to the first `200` on `<base>`, the median of
	// several starts, so one slow start on a busy runner does not decide it. Each has its own directory,
	// certificate and child; the OS and module caches are warm after the first. The last one is kept.
	for (let run = 1; run <= COLD_STARTS; run++) {
		const started = performance.now();
		starting = await startDevHost({ config, basePath: '/loam/' });
		const status = (await hosted(starting, '/loam/', { accept: HTML })).status;
		coldStarts.push(performance.now() - started);
		expect(status).toBe(200);
		if (run < COLD_STARTS) await starting.close();
		else host = starting;
		starting = undefined;
	}
	coldStartMs = [...coldStarts].sort((a, b) => a - b)[Math.floor(COLD_STARTS / 2)] as number;
	browser = await launchForDevHost(host);
}, 360_000);
afterAll(async () => {
	if (starting !== host) await starting?.close();
	await browser?.close();
	await host?.close();
});

/** A process's resident memory: `ps`'s RSS (KiB), or on Windows its working set. */
const residentBytes = (pid: number): number =>
	process.platform === 'win32'
		? Number(
				execFileSync(
					'powershell.exe',
					['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
					{ encoding: 'utf8' }
				).trim()
			)
		: Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) *
			1024;

const pidOf = (host: DevHost): number =>
	(JSON.parse(readFileSync(join(host.data, '.lock'), 'utf8')) as { pid: number }).pid;

describe('P6-H1: one command, one process', () => {
	it('P6-H1: from an empty directory it reports https://localhost and its SPKI, in .loam-dev with a .gitignore of *, files 0600 and directories 0700', () => {
		expect(host.origin).toMatch(/^https:\/\/localhost:\d+$/);
		expect(host.root).toBe(`${host.origin}/loam/`);
		expect(host.spki).toMatch(/^[A-Za-z0-9+/]{43}=$/);
		expect(relative(dirname(host.data), host.data)).toBe('.loam-dev');
		expect(readFileSync(join(host.data, '.gitignore'), 'utf8')).toBe('*\n');
		// Windows enforces no mode bits: there each path's ACL grants no one but its owner, SYSTEM and
		// Administrators, the host's own check (HOST_SECRET_PERMISSIONS).
		const windows = process.platform === 'win32';
		const paths: string[] = [];
		const walk = (directory: string): void => {
			if (windows) paths.push(directory);
			else expect(statSync(directory).mode & 0o777, directory).toBe(0o700);
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) walk(path);
				else if (!entry.isFile()) continue;
				else if (windows) paths.push(path);
				else expect(statSync(path).mode & 0o777, path).toBe(0o600);
			}
		};
		walk(host.data);
		if (windows)
			readAcls(paths).reads.forEach((read, index) => {
				expect(read.state, paths[index]).toBe('read');
				expect(read.state === 'read' && exposedTo(read), paths[index]).toEqual([]);
			});
		expect(host.logs().some((line) => line.startsWith('LOAM_DEV_READY'))).toBe(true);
	});

	it('P6-H1: the shell boots over HTTPS under /loam/, a deep link is index.html with 200, and hashed assets are immutable', async () => {
		const opened = await openShell(browser, host.root);
		const { page } = opened;
		expect(new URL(page.url()).protocol).toBe('https:');
		expect(await page.evaluate(() => document.documentElement.dataset.loamHost)).toBe('web');
		expect(opened.responsePolicy).toBe(`${writtenPolicy(host)}; frame-ancestors 'none'`);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		const deep = await hosted(host, '/loam/personal/p/atlas/hello/items', { accept: HTML });
		expect(deep.status).toBe(200);
		expect(deep.body).toBe(readFileSync(join(host.data, 'public', 'site', 'index.html'), 'utf8'));
		const asset = /src="\/loam\/(assets\/[^"]+\.js)"/.exec(deep.body)?.[1] as string;
		const served = await hosted(host, `/loam/${asset}`);
		expect(served.status).toBe(200);
		expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
	});

	it('P6-H1: answers 404 to every way out of the site: .., %2e%2e, %2f, %5c, and a symbolic link out of it', async () => {
		await writeFile(join(host.data, 'auth.sqlite'), 'never served', { mode: 0o600 });
		const site = join(host.data, 'public', 'site');
		await symlink(join(host.data, 'auth.sqlite'), join(site, 'leak.sqlite'));
		for (const path of [
			'/loam/../auth.sqlite',
			'/loam/%2e%2e/auth.sqlite',
			'/loam/%2E%2E/auth.sqlite',
			'/loam/..%2fauth.sqlite',
			'/loam/assets%2f..%2f..%2fauth.sqlite',
			'/loam/..%5cauth.sqlite',
			'/loam/leak.sqlite',
		]) {
			for (const accept of [undefined, HTML]) {
				const answer = await hosted(host, path, accept ? { accept } : {});
				expect(answer.status, `${path} ${accept}`).toBe(404);
				expect(answer.body).not.toContain('never served');
			}
		}
	});

	it('P6-H1: a request with another Host is 421, with the common headers and no HSTS on localhost', async () => {
		const port = new URL(host.origin).port;
		for (const other of [
			'evil.example',
			`127.0.0.1:${port}`,
			'localhost',
			`localhost:${Number(port) + 1}`,
		]) {
			const answer = await hosted(host, '/loam/', { host: other, accept: HTML });
			expect(answer.status, other).toBe(421);
			expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
			expect(answer.headers['x-content-type-options']).toBe('nosniff');
			expect(answer.headers['strict-transport-security']).toBeUndefined();
		}
	});

	it('P6-H1: answers its health, and 404 with no-store on the routes later steps build', async () => {
		const health = await hosted(host, '/loam/api/health');
		expect(health.status).toBe(200);
		expect(JSON.parse(health.body)).toEqual({ ok: true });
		expect(health.headers['cache-control']).toBe('no-store');
		for (const [path, method] of [
			['/loam/mcp', 'POST'],
			['/loam/api/kernel/call', 'POST'],
			['/loam/mounts/hello/mcp', 'POST'],
		] as const) {
			const answer = await hosted(host, path, { method });
			expect(answer.status, path).toBe(404);
			expect(answer.headers['cache-control'], path).toBe('no-store');
		}
		// Only under `base_path`.
		expect((await hosted(host, '/', { accept: HTML })).status).toBe(404);
	});

	it('P6-H1: the bin, `loam-host dev --deployment <file>`, from an empty directory prints its origin and serves the shell', async () => {
		const root = await mkdtemp(join(tmpdir(), 'loam-p6-h1-'));
		try {
			const deployment = join(root, 'loam.deployment.toml');
			await writeFile(
				deployment,
				hostedDeploymentFile([], deploymentEntry('hello', await packApp('hello')))
			);
			const child = spawn(process.execPath, [BIN, 'dev', '--deployment', deployment], {
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			try {
				let text = '';
				child.stdout.on('data', (chunk: Buffer) => {
					text += chunk.toString('utf8');
				});
				const printed = await new Promise<{ data: { origin: string; spki: string } }>(
					(done, fail) => {
						const timer = setTimeout(() => fail(new Error(`no result: ${text}`)), 60_000);
						child.stdout.on('data', () => {
							try {
								const result = JSON.parse(text);
								clearTimeout(timer);
								done(result);
							} catch {}
						});
						child.once('exit', (code) => fail(new Error(`exited ${code}: ${text}`)));
					}
				);
				expect(printed.data.origin).toMatch(/^https:\/\/localhost:\d+$/);
				expect(readFileSync(join(root, '.loam-dev', '.gitignore'), 'utf8')).toBe('*\n');
				const port = Number(new URL(printed.data.origin).port);
				const answer = await hosted(
					{
						origin: printed.data.origin,
						certificate: join(root, '.loam-dev', 'tls', 'cert.pem'),
					} as DevHost,
					'/',
					{ accept: HTML }
				);
				expect(answer.status, String(port)).toBe(200);
			} finally {
				const exited = once(child, 'exit');
				child.kill('SIGTERM');
				await exited;
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('P6-H1: a second dev on the same directory, a second process, is HOST_DATA_LOCKED', async () => {
		const deployment = join(dirname(host.data), 'loam.deployment.toml');
		const { code, output } = await loamHost(['dev', '--deployment', deployment]);
		expect(code).toBe(1);
		expect((output.error as { code: string }).code).toBe('HOST_DATA_LOCKED');
	});

	it("P6-H1: after a restart the origin is the same, so the browser's data is there, and the certificate and the secret are kept", async () => {
		// The context stays open across the restart: its storage is the origin's, which a new port would lose.
		const opened = await openShell(browser, host.root);
		expect(await kernelCall(opened.page, 'project-create', { name: 'Atlas' })).toMatchObject({
			success: true,
		});
		await opened.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { flush(): Promise<void> };
			};
			await shell.kernel.flush();
		});
		await opened.page.close();
		const before = {
			origin: host.origin,
			spki: host.spki,
			secret: readFileSync(join(host.data, 'secrets', 'auth'), 'utf8'),
			ports: readFileSync(join(host.data, 'dev.json'), 'utf8'),
			pid: pidOf(host),
		};
		await host.restart();
		expect(host.origin).toBe(before.origin);
		expect(host.spki).toBe(before.spki);
		expect(pidOf(host)).not.toBe(before.pid);
		expect(readFileSync(join(host.data, 'secrets', 'auth'), 'utf8')).toBe(before.secret);
		expect(readFileSync(join(host.data, 'dev.json'), 'utf8')).toBe(before.ports);
		const reopened = await openShell(browser, host.root, {}, opened.context);
		const listed = (await kernelCall(reopened.page, 'project-list', { status: 'all' })) as {
			data: { projects: Array<{ name: string }> };
		};
		expect(listed.data.projects.map(({ name }) => name)).toContain('Atlas');
		expect(reopened.violations).toEqual([]);
		await opened.context.close();
	});

	it("P6-H1: section 14's rows: cold start to the first 200 on <base>, and resident memory after boot and E1's scenario", async () => {
		const opened = await openShell(browser, host.root);
		await opened.context.close();
		const residentMb = residentBytes(pidOf(host)) / 1024 / 1024;
		// The line `loam.yml`'s `Hosted development profile` job's samples are read from (section 14).
		console.log(
			`P6-H1 measurement: cold start ${Math.round(coldStartMs)} ms (median of ${coldStarts.map(Math.round).join(', ')}), resident ${Math.round(residentMb)} MB`
		);
		const strict = assertsSection14Ceilings();
		const bounds = strict ? SECTION_14_CEILINGS : LOCAL_BOUNDS;
		expect(coldStartMs).toBeGreaterThan(0);
		if (strict) {
			expect(coldStartMs).toBeLessThanOrEqual(bounds.coldStartMs);
		} else if (coldStartMs > bounds.coldStartMs) {
			console.warn(
				`P6-H1 local cold start ${Math.round(coldStartMs)} ms exceeded LOCAL_BOUNDS ${bounds.coldStartMs} ms (${COLD_START_LOCAL_NOTE})`
			);
		}
		expect(residentMb).toBeLessThanOrEqual(bounds.residentMb);
	});
});
