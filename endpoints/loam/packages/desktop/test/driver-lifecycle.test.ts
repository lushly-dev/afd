/**
 * Regression tests for #1655: `tauri-driver` process-tree teardown, worker-signal cleanup,
 * shared startup budgets, and production `startDesktopSession` retry behavior.
 *
 * Uses real Node subprocesses and local HTTP WebDriver fakes (no Tauri binary required) so the
 * lifecycle logic runs identically in unit checks and inside `test:desktop` on Linux CI.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	DRIVER_READY_TIMEOUT_MS,
	DriverTeardownError,
	FORCE_EXIT_TIMEOUT_MS,
	GRACEFUL_EXIT_TIMEOUT_MS,
	isProcessAlive,
	isRetryableSessionError,
	readInboundConnection,
	readNewInboundPid,
	SESSION_COMMAND_TIMEOUT_MS,
	SESSION_CREATE_ATTEMPTS,
	SESSION_CREATE_TIMEOUT_MS,
	STARTUP_BUDGET_MS,
	startDesktopSession,
	stopDriverProcess,
	trackDriverProcess,
	withSessionRetry,
} from './driver-lifecycle';

const DRIVER_LIFECYCLE_MODULE_URL = new URL('./driver-lifecycle.ts', import.meta.url).href;
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'loam-driver-lifecycle-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

/**
 * Spawns a parent process and a grandchild process that BOTH install their `SIGTERM` handlers BEFORE
 * acknowledging readiness, eliminating POSIX signal-installation races.
 */
async function spawnDriverWithGrandchild(
	options: { ignoreTerm?: boolean; exitDelayMs?: number } = {}
): Promise<{ driver: ChildProcess; grandchildPid: number; detached: boolean }> {
	const detached = process.platform !== 'win32';
	const childScript = options.ignoreTerm
		? `process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 10_000);`
		: options.exitDelayMs
			? `process.on('SIGTERM', () => setTimeout(() => process.exit(0), ${options.exitDelayMs})); process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 10_000);`
			: `process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 10_000);`;
	const parentScript = `
		const { spawn } = require('node:child_process');
		${options.ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
		const grand = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });
		let buf = '';
		grand.stdout.setEncoding('utf8').on('data', (chunk) => {
			buf += chunk;
			const line = buf.split(/\\r?\\n/)[0]?.trim();
			if (line && /^\\d+$/.test(line)) {
				process.stdout.write(line + '\\n');
			}
		});
		setInterval(() => {}, 10_000);
	`;
	const driver = spawn(process.execPath, ['-e', parentScript], {
		stdio: ['ignore', 'pipe', 'ignore'],
		detached,
	});
	const grandchildPid = await new Promise<number>((resolve, reject) => {
		let out = '';
		const timer = setTimeout(
			() => reject(new Error('grandchild did not report readiness')),
			10_000
		);
		driver.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			out += chunk;
			const line = out.split(/\r?\n/)[0]?.trim();
			if (line && /^\d+$/.test(line)) {
				clearTimeout(timer);
				resolve(Number(line));
			}
		});
		driver.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		driver.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`parent exited early with ${code}`));
		});
	});
	return { driver, grandchildPid, detached };
}

/**
 * Spawns a fake `tauri-driver` subprocess listening on `port` that spawns a stubborn grandchild (writing
 * `inbound.json` in `data` once its signal handler is installed) and either hangs on `POST /session` or answers
 * a W3C WebDriver session with a configurable delay on `GET /title`.
 */
function spawnFakeTauriDriver(options: {
	port: number;
	data: string;
	mode: 'hang-session' | 'ok' | 'hang-status';
	titleDelayMs?: number;
	detached: boolean;
	token: string;
	onGrandchildPid?: (pid: number) => void;
}): ChildProcess {
	const script = `
		const http = require('node:http');
		const fs = require('node:fs');
		const path = require('node:path');
		const { spawn } = require('node:child_process');
		const mode = ${JSON.stringify(options.mode)};
		const port = ${options.port};
		const data = ${JSON.stringify(options.data)};
		const token = ${JSON.stringify(options.token)};
		const titleDelayMs = ${options.titleDelayMs ?? 0};
		const sessionId = 'fake-session-' + port + '-' + process.pid;

		process.on('SIGTERM', () => {});
		const grand = spawn(
			process.execPath,
			['-e', "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid) + '\\\\n'); setInterval(() => {}, 10_000);"],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let buf = '';
		grand.stdout.setEncoding('utf8').on('data', (chunk) => {
			buf += chunk;
			const line = buf.split(/\\r?\\n/)[0]?.trim();
			if (!line || !/^\\d+$/.test(line)) return;
			const pid = Number(line);
			fs.writeFileSync(
				path.join(data, 'inbound.json'),
				JSON.stringify({ url: 'http://127.0.0.1:1/mcp', port: 1, token, pid })
			);
			process.stderr.write('GRANDCHILD_PID=' + pid + '\\n');
			server.listen(port, '127.0.0.1');
		});

		const server = http.createServer((req, res) => {
			if (req.method === 'GET' && req.url === '/status') {
				if (mode === 'hang-status') return;
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ value: { ready: true } }));
				return;
			}
			if (req.method === 'POST' && req.url === '/session') {
				if (mode === 'hang-session') return;
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ value: { sessionId, capabilities: {} } }));
				return;
			}
			if (req.method === 'GET' && req.url === '/session/' + sessionId + '/window') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ value: 'window-1' }));
				return;
			}
			if (req.method === 'GET' && req.url === '/session/' + sessionId + '/title') {
				setTimeout(() => {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ value: 'Loam' }));
				}, titleDelayMs);
				return;
			}
			if (req.method === 'DELETE' && req.url === '/session/' + sessionId) {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ value: null }));
				return;
			}
			res.writeHead(404);
			res.end();
		});
	`;
	const child = spawn(process.execPath, ['-e', script], {
		stdio: ['ignore', 'ignore', 'pipe'],
		detached: options.detached,
	});
	if (options.onGrandchildPid) {
		let errBuf = '';
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			errBuf += chunk;
			const match = /GRANDCHILD_PID=(\d+)/.exec(errBuf);
			if (match) options.onGrandchildPid?.(Number(match[1]));
		});
	}
	return child;
}

describe('#1655: desktop driver lifecycle and session retry', () => {
	it('keeps the shared startup budget and teardown reserve under Vitest 120s testTimeout while preserving 180s commands', () => {
		expect(SESSION_CREATE_ATTEMPTS).toBe(2);
		expect(STARTUP_BUDGET_MS).toBeLessThan(120_000);
		expect(DRIVER_READY_TIMEOUT_MS + SESSION_CREATE_TIMEOUT_MS).toBeLessThan(STARTUP_BUDGET_MS);
		expect(
			SESSION_CREATE_TIMEOUT_MS * SESSION_CREATE_ATTEMPTS +
				GRACEFUL_EXIT_TIMEOUT_MS +
				FORCE_EXIT_TIMEOUT_MS
		).toBeLessThanOrEqual(STARTUP_BUDGET_MS);
		expect(SESSION_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
	});

	it('terminates both the driver and a stubborn grandchild process tree before resolving', async () => {
		const { driver, grandchildPid, detached } = await spawnDriverWithGrandchild({
			ignoreTerm: true,
		});
		const data = makeTempDir();
		writeFileSync(
			join(data, 'inbound.json'),
			JSON.stringify({
				url: 'http://127.0.0.1:1/mcp',
				port: 1,
				token: 'tok-new',
				pid: grandchildPid,
			})
		);
		const untrack = trackDriverProcess({
			pid: driver.pid as number,
			detached,
			getAppPid: () => grandchildPid,
		});

		expect(isProcessAlive(driver.pid as number)).toBe(true);
		expect(isProcessAlive(grandchildPid)).toBe(true);

		await stopDriverProcess({
			driver,
			detached,
			data,
			untrack,
			gracefulTimeoutMs: 250,
			forceTimeoutMs: 5_000,
			settleMs: 0,
		});

		expect(driver.exitCode !== null || driver.signalCode !== null).toBe(true);
		expect(isProcessAlive(driver.pid as number)).toBe(false);
		expect(isProcessAlive(grandchildPid)).toBe(false);

		// Idempotent: a second call returns cleanly.
		await stopDriverProcess({
			driver,
			detached,
			data,
			untrack,
			gracefulTimeoutMs: 100,
			forceTimeoutMs: 100,
			settleMs: 0,
		});
	});

	it('waits for a slow-exiting grandchild instead of returning while it still runs', async () => {
		const { driver, grandchildPid, detached } = await spawnDriverWithGrandchild({
			exitDelayMs: 350,
		});
		const started = performance.now();

		await stopDriverProcess({
			driver,
			detached,
			appPid: grandchildPid,
			gracefulTimeoutMs: 2_000,
			forceTimeoutMs: 2_000,
			settleMs: 0,
		});

		expect(isProcessAlive(driver.pid as number)).toBe(false);
		expect(isProcessAlive(grandchildPid)).toBe(false);
		if (process.platform !== 'win32') {
			expect(performance.now() - started).toBeGreaterThanOrEqual(300);
		}
	});

	it('bounds a hanging deleteSession() so teardown never stalls', async () => {
		const { driver, grandchildPid, detached } = await spawnDriverWithGrandchild();
		const hangingBrowser = {
			deleteSession: () => new Promise<never>(() => {}),
		};

		const started = performance.now();
		await stopDriverProcess({
			driver,
			detached,
			browser: hangingBrowser,
			appPid: grandchildPid,
			deleteSessionTimeoutMs: 150,
			gracefulTimeoutMs: 500,
			forceTimeoutMs: 5_000,
			settleMs: 0,
		});

		expect(performance.now() - started).toBeLessThan(8_000);
		expect(isProcessAlive(driver.pid as number)).toBe(false);
		expect(isProcessAlive(grandchildPid)).toBe(false);
	});

	it('throws non-retryable DriverTeardownError and keeps tracking if a process survives teardown deadline', async () => {
		let untracked = false;
		// Synthetic un-exiting ChildProcess handle with an unused high PID so no OS process is signaled
		// while deterministically exercising the surviving-process branch on every OS.
		const stuckDriver = {
			pid: 999_999_999,
			exitCode: null,
			signalCode: null,
			kill: () => false,
		} as unknown as ChildProcess;

		let attempts = 0;
		await expect(
			withSessionRetry({
				attempts: 2,
				async run() {
					attempts += 1;
					await stopDriverProcess({
						driver: stuckDriver,
						detached: false,
						untrack: () => {
							untracked = true;
						},
						gracefulTimeoutMs: 0,
						forceTimeoutMs: 0,
						settleMs: 0,
					});
				},
			})
		).rejects.toThrow(DriverTeardownError);

		expect(attempts).toBe(1);
		expect(untracked).toBe(false);
		expect(isRetryableSessionError(new DriverTeardownError('still alive', [123]))).toBe(false);
	});

	it('ignores a stale inbound.json snapshot from an earlier run', () => {
		const data = makeTempDir();
		writeFileSync(
			join(data, 'inbound.json'),
			JSON.stringify({ url: 'http://127.0.0.1:1/mcp', port: 1, token: 'old-token', pid: 424242 })
		);
		const previous = readInboundConnection(data);
		expect(previous).toEqual({ pid: 424242, token: 'old-token' });
		expect(readNewInboundPid(data, previous)).toBeUndefined();

		writeFileSync(
			join(data, 'inbound.json'),
			JSON.stringify({ url: 'http://127.0.0.1:2/mcp', port: 2, token: 'new-token', pid: 424243 })
		);
		expect(readNewInboundPid(data, previous)).toBe(424243);
	});

	it('startDesktopSession retries once on POST /session timeout with a fresh driver and fresh data dir, tears down attempt 1 first, and restores command timeout', async () => {
		const dataDirs: string[] = [];
		const retried: number[] = [];
		let attempt = 0;
		let firstDriverPid = 0;
		let firstGrandchildPid = 0;
		let secondGrandchildPid = 0;
		const overallStarted = performance.now();

		const session = await startDesktopSession({
			logLevel: 'silent',
			attempts: 2,
			startupBudgetMs: 25_000,
			driverReadyTimeoutMs: 8_000,
			sessionCreateTimeoutMs: 450,
			sessionCommandTimeoutMs: SESSION_COMMAND_TIMEOUT_MS,
			gracefulTimeoutMs: 200,
			forceTimeoutMs: 5_000,
			settleMs: 0,
			capabilities: {},
			onRetry(failedAttempt) {
				retried.push(failedAttempt);
			},
			async prepareData() {
				const dir = makeTempDir();
				dataDirs.push(dir);
				return { data: dir, owned: true };
			},
			spawnDriver(port, _nativePort, data, detached) {
				attempt += 1;
				if (attempt === 2) {
					// Attempt 1's entire process tree and abandoned temp data directory must already be gone.
					expect(isProcessAlive(firstDriverPid)).toBe(false);
					expect(isProcessAlive(firstGrandchildPid)).toBe(false);
					expect(existsSync(dataDirs[0] as string)).toBe(false);
				}
				const child = spawnFakeTauriDriver({
					port,
					data,
					mode: attempt === 1 ? 'hang-session' : 'ok',
					// Delay `getTitle` past the 450 ms session-creation timeout to prove `remoteModifier`
					// applied `SESSION_COMMAND_TIMEOUT_MS` to WebDriverIO's cached session dispatcher.
					titleDelayMs: 650,
					detached,
					token: `tok-attempt-${attempt}`,
					onGrandchildPid(pid) {
						if (attempt === 1) firstGrandchildPid = pid;
						else secondGrandchildPid = pid;
					},
				});
				if (attempt === 1) firstDriverPid = child.pid as number;
				return child;
			},
		});

		try {
			const coldStartMs = performance.now() - session.began;
			const overallElapsed = performance.now() - overallStarted;
			expect(retried).toEqual([1]);
			expect(dataDirs).toHaveLength(2);
			expect(session.data).toBe(dataDirs[1]);
			expect(session.browser.options.connectionRetryTimeout).toBe(SESSION_COMMAND_TIMEOUT_MS);
			// Attempt 1's timeout + teardown must be excluded from attempt 2's cold-start measurement.
			expect(overallElapsed - coldStartMs).toBeGreaterThanOrEqual(400);
			expect(await session.browser.getTitle()).toBe('Loam');
		} finally {
			await session.close();
		}

		expect(isProcessAlive(session.driver.pid as number)).toBe(false);
		expect(isProcessAlive(secondGrandchildPid)).toBe(false);
	});

	it('startDesktopSession bounds a stalled /status probe and leaves no orphan processes when all attempts fail', async () => {
		const spawnedPids: number[] = [];
		const started = performance.now();

		await expect(
			startDesktopSession({
				logLevel: 'silent',
				attempts: 2,
				startupBudgetMs: 12_000,
				driverReadyTimeoutMs: 500,
				statusProbeTimeoutMs: 150,
				sessionCreateTimeoutMs: 400,
				gracefulTimeoutMs: 150,
				forceTimeoutMs: 5_000,
				settleMs: 0,
				capabilities: {},
				onRetry() {},
				async prepareData() {
					return { data: makeTempDir(), owned: true };
				},
				spawnDriver(port, _nativePort, data, detached) {
					const child = spawnFakeTauriDriver({
						port,
						data,
						mode: 'hang-status',
						detached,
						token: `tok-${spawnedPids.length}`,
						onGrandchildPid(pid) {
							spawnedPids.push(pid);
						},
					});
					spawnedPids.push(child.pid as number);
					return child;
				},
			})
		).rejects.toThrow(/did not start/i);

		expect(performance.now() - started).toBeLessThan(12_000);
		expect(spawnedPids.length).toBeGreaterThanOrEqual(2);
		for (const pid of spawnedPids) {
			expect(isProcessAlive(pid), `pid ${pid} should have exited`).toBe(false);
		}
	});

	it('startDesktopSession preserves caller-owned data across retries', async () => {
		const callerDir = makeTempDir();
		writeFileSync(join(callerDir, 'marker.txt'), 'keep');
		let attempt = 0;

		const session = await startDesktopSession({
			logLevel: 'silent',
			attempts: 2,
			startupBudgetMs: 25_000,
			driverReadyTimeoutMs: 8_000,
			sessionCreateTimeoutMs: 350,
			gracefulTimeoutMs: 150,
			forceTimeoutMs: 5_000,
			settleMs: 0,
			capabilities: {},
			onRetry() {},
			async prepareData() {
				return { data: callerDir, owned: false };
			},
			spawnDriver(port, _nativePort, data, detached) {
				attempt += 1;
				return spawnFakeTauriDriver({
					port,
					data,
					mode: attempt === 1 ? 'hang-session' : 'ok',
					detached,
					token: `tok-caller-${attempt}`,
				});
			},
		});

		try {
			expect(session.data).toBe(callerDir);
			expect(existsSync(join(callerDir, 'marker.txt'))).toBe(true);
		} finally {
			await session.close();
		}
	});

	it('reaps tracked detached drivers when a worker exits or receives SIGTERM', async () => {
		// Runs a real worker subprocess that registers a detached driver+grandchild via `trackDriverProcess`
		// and terminates without calling `stopDriverProcess` (`SIGTERM` on POSIX, `process.exit(0)` on Windows).
		const workerScript = `
			import { spawn } from 'node:child_process';
			import { trackDriverProcess } from ${JSON.stringify(DRIVER_LIFECYCLE_MODULE_URL)};

			const detached = process.platform !== 'win32';
			const grandScript = "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid) + '\\\\n'); setInterval(() => {}, 10_000);";
			const parentScript = \`
				const { spawn } = require('node:child_process');
				process.on('SIGTERM', () => {});
				const grand = spawn(process.execPath, ['-e', \${JSON.stringify(grandScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });
				let buf = '';
				grand.stdout.setEncoding('utf8').on('data', (chunk) => {
					buf += chunk;
					const line = buf.split(/\\\\r?\\\\n/)[0]?.trim();
					if (line && /^\\\\d+$/.test(line)) process.stdout.write(line + '\\\\n');
				});
				setInterval(() => {}, 10_000);
			\`;
			const driver = spawn(process.execPath, ['-e', parentScript], {
				stdio: ['ignore', 'pipe', 'ignore'],
				detached,
			});
			let grandPid;
			trackDriverProcess({ pid: driver.pid, detached, getAppPid: () => grandPid });
			let buf = '';
			driver.stdout.setEncoding('utf8').on('data', (chunk) => {
				buf += chunk;
				const line = buf.split(/\\r?\\n/)[0]?.trim();
				if (!line || !/^\\d+$/.test(line)) return;
				grandPid = Number(line);
				process.stdout.write(JSON.stringify({ driverPid: driver.pid, grandPid }) + '\\n');
				if (process.platform === 'win32') {
					process.exit(0);
				}
			});
			setInterval(() => {}, 10_000);
		`;
		const worker = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const { driverPid, grandPid } = await new Promise<{ driverPid: number; grandPid: number }>(
			(resolve, reject) => {
				let out = '';
				let err = '';
				const timer = setTimeout(() => reject(new Error(`worker timed out: ${err}`)), 10_000);
				worker.stderr.setEncoding('utf8').on('data', (chunk: string) => {
					err += chunk;
				});
				worker.stdout.setEncoding('utf8').on('data', (chunk: string) => {
					out += chunk;
					const line = out.split(/\r?\n/)[0]?.trim();
					if (line?.startsWith('{')) {
						clearTimeout(timer);
						resolve(JSON.parse(line) as { driverPid: number; grandPid: number });
					}
				});
				worker.once('exit', (code) => {
					clearTimeout(timer);
					if (!out.includes('{')) reject(new Error(`worker exited ${code}: ${err}`));
				});
			}
		);

		if (process.platform !== 'win32') {
			worker.kill('SIGTERM');
		}
		await new Promise<void>((resolve) => {
			if (worker.exitCode !== null || worker.signalCode !== null) resolve();
			else worker.once('exit', () => resolve());
		});

		// Give the OS a brief moment to reap the SIGKILLed descendants.
		const until = Date.now() + 5_000;
		while ((isProcessAlive(driverPid) || isProcessAlive(grandPid)) && Date.now() < until) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(isProcessAlive(driverPid)).toBe(false);
		expect(isProcessAlive(grandPid)).toBe(false);
	});

	it('does not retry ENOENT or EACCES spawn errors', async () => {
		expect(isRetryableSessionError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(
			false
		);
		expect(isRetryableSessionError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(
			false
		);
		expect(isRetryableSessionError(new Error('Request timed out!'))).toBe(true);

		let calls = 0;
		await expect(
			withSessionRetry({
				attempts: 2,
				async run() {
					calls += 1;
					throw Object.assign(new Error('spawn tauri-driver ENOENT'), { code: 'ENOENT' });
				},
			})
		).rejects.toThrow('ENOENT');
		expect(calls).toBe(1);
	});
});
