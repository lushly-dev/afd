/**
 * Process-tree lifecycle and session-creation retry for Loam's desktop WebDriver harness (#1655).
 *
 * `tauri-driver` spawns the native WebDriver (`WebKitWebDriver` / `msedgedriver`), which in turn spawns
 * `loam-desktop`. Because `loam-desktop` uses `tauri-plugin-single-instance`, any leftover app instance from an
 * earlier test causes the next launch to focus the old instance and exit immediately, making `POST /session`
 * hang until `connectionRetryTimeout` expires. Isolating each driver in its own process group (POSIX) or killing
 * its process tree (Windows), verifying every process has exited before returning, bounding total startup under
 * Vitest's 120 s `testTimeout`, and retrying a stalled session creation once with a fresh driver and fresh data
 * directory keeps the Linux CI suite from cascading timeouts and leaking orphan `tauri-driver` processes.
 */
import { type ChildProcess, execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { remote } from 'webdriverio';

const execFileAsync = promisify(execFile);

export type DesktopBrowser = Awaited<ReturnType<typeof remote>>;

/**
 * Total budget for `startDesktopSession` across all attempts and failed-attempt teardowns, staying comfortably
 * under Vitest's 120 s `testTimeout` so `openDesktop` always cleans up rather than being aborted mid-request.
 */
export const STARTUP_BUDGET_MS = 100_000;

/** Per-attempt ceiling for `tauri-driver` to answer `GET /status`. */
export const DRIVER_READY_TIMEOUT_MS = 15_000;

/** Per-probe timeout for `GET /status` so a half-open socket cannot outlive `DRIVER_READY_TIMEOUT_MS`. */
export const STATUS_PROBE_TIMEOUT_MS = 2_000;

/**
 * Per-attempt timeout for `POST /session`. Two attempts plus teardown stay inside `STARTUP_BUDGET_MS` (100 s),
 * leaving headroom before Vitest's 120 s `testTimeout`.
 */
export const SESSION_CREATE_TIMEOUT_MS = 35_000;

/**
 * `connectionRetryTimeout` restored on `browser.options` once the session exists, matching the longest desktop
 * script timeout (`copilot.test.ts` sets `script: 180_000`).
 */
export const SESSION_COMMAND_TIMEOUT_MS = 180_000;

/** Total session-creation attempts (initial try plus one retry with a fresh `tauri-driver`). */
export const SESSION_CREATE_ATTEMPTS = 2;

/** Maximum wait for `browser.deleteSession()` before proceeding to signal the process tree. */
export const DELETE_SESSION_TIMEOUT_MS = 10_000;

/** Grace window after `SIGTERM` (POSIX) or `deleteSession()` (Windows) before force-killing. */
export const GRACEFUL_EXIT_TIMEOUT_MS = 5_000;

/** Maximum wait after `SIGKILL` / `taskkill /T /F` for every process in the tree to disappear. */
export const FORCE_EXIT_TIMEOUT_MS = 5_000;

/** Brief pause after verified process exit so the OS single-instance lock / D-Bus name clears. */
export const SINGLE_INSTANCE_SETTLE_MS = 200;

const POLL_INTERVAL_MS = 50;

export interface InboundSnapshot {
	pid: number;
	token: string;
}

export interface TrackedDriver {
	pid: number;
	detached: boolean;
	getAppPid?: () => number | undefined;
}

/**
 * Thrown when `stopDriverProcess` could not confirm that `tauri-driver` and its descendants exited within its
 * timeout. Non-retryable: starting another single-instance `loam-desktop` while a prior one is alive would fail.
 */
export class DriverTeardownError extends Error {
	readonly survivingPids: number[];

	constructor(message: string, survivingPids: number[]) {
		super(message);
		this.name = 'DriverTeardownError';
		this.survivingPids = survivingPids;
	}
}

const activeDrivers = new Set<TrackedDriver>();
let cleanupHooksRegistered = false;

function taskkillPath(): string {
	return process.env.SystemRoot
		? join(process.env.SystemRoot, 'System32', 'taskkill.exe')
		: 'taskkill';
}

/** Whether a single process id is currently alive. */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Whether any process in POSIX process group `pgid` is currently alive. Always false on Windows. */
export function isProcessGroupAlive(pgid: number): boolean {
	if (process.platform === 'win32' || !Number.isInteger(pgid) || pgid <= 0) return false;
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Best-effort read of `<data>/inbound.json`'s `{ pid, token }`. */
export function readInboundConnection(data: string): InboundSnapshot | undefined {
	const file = join(data, 'inbound.json');
	if (!existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown; token?: unknown };
		if (
			typeof parsed.pid === 'number' &&
			Number.isInteger(parsed.pid) &&
			parsed.pid > 0 &&
			typeof parsed.token === 'string'
		) {
			return { pid: parsed.pid, token: parsed.token };
		}
	} catch {
		// The app may be mid-write or removing the file.
	}
	return undefined;
}

/**
 * Reads `inbound.json`'s PID only if it belongs to a launch newer than `previous`, preventing a stale file
 * from pointing cleanup at a recycled PID.
 */
export function readNewInboundPid(data: string, previous?: InboundSnapshot): number | undefined {
	const current = readInboundConnection(data);
	if (!current) return undefined;
	if (previous && current.token === previous.token && current.pid === previous.pid) {
		return undefined;
	}
	return current.pid;
}

function killSync(entry: TrackedDriver): void {
	const appPid = entry.getAppPid?.();
	if (process.platform === 'win32') {
		if (isProcessAlive(entry.pid)) {
			spawnSync(taskkillPath(), ['/PID', String(entry.pid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true,
			});
		}
		if (appPid && isProcessAlive(appPid)) {
			spawnSync(taskkillPath(), ['/PID', String(appPid), '/T', '/F'], {
				stdio: 'ignore',
				windowsHide: true,
			});
		}
		return;
	}
	try {
		process.kill(entry.detached ? -entry.pid : entry.pid, 'SIGKILL');
	} catch {
		// Already gone.
	}
	if (appPid && appPid > 0) {
		try {
			process.kill(appPid, 'SIGKILL');
		} catch {
			// Already gone.
		}
	}
}

function cleanupAllDriversSync(): void {
	for (const tracked of activeDrivers) killSync(tracked);
	activeDrivers.clear();
}

function registerCleanupHooks(): void {
	if (cleanupHooksRegistered) return;
	cleanupHooksRegistered = true;
	process.once('exit', cleanupAllDriversSync);
	if (process.platform !== 'win32') {
		for (const signal of ['SIGTERM', 'SIGINT'] as const) {
			const onSignal = () => {
				cleanupAllDriversSync();
				// If no other handler (such as Vitest's worker shutdown) is installed, preserve default signal exit.
				if (process.listeners(signal).length === 1) {
					process.off(signal, onSignal);
					process.kill(process.pid, signal);
				}
			};
			process.on(signal, onSignal);
		}
	}
}

/**
 * Registers a spawned driver for synchronous cleanup on `exit`, `SIGTERM`, and `SIGINT`, ensuring a timed-out
 * or terminated Vitest worker leaves no orphan `tauri-driver` or `loam-desktop` behind. Returns an untrack
 * function to call once the tree is verified dead.
 */
export function trackDriverProcess(entry: TrackedDriver): () => void {
	activeDrivers.add(entry);
	registerCleanupHooks();
	return () => {
		activeDrivers.delete(entry);
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function waitUntilGone(isAlive: () => boolean, timeoutMs: number): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (isAlive()) {
		if (Date.now() >= until) return false;
		await sleep(POLL_INTERVAL_MS);
	}
	return true;
}

async function taskkillTree(pid: number): Promise<boolean> {
	try {
		await execFileAsync(taskkillPath(), ['/PID', String(pid), '/T', '/F'], {
			windowsHide: true,
		});
		return true;
	} catch {
		return false;
	}
}

function signalPosix(pid: number, detached: boolean, signal: NodeJS.Signals): void {
	try {
		process.kill(detached ? -pid : pid, signal);
	} catch {
		// Process or group already exited.
	}
}

export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

/** Waits for `tauri-driver` to answer `200` on `/status`, aborting each probe so it never outlives `deadlineMs`. */
export async function waitForDriverPort(
	port: number,
	child: ChildProcess,
	spawnError: () => Error | undefined,
	deadlineMs = DRIVER_READY_TIMEOUT_MS,
	probeTimeoutMs = STATUS_PROBE_TIMEOUT_MS
): Promise<void> {
	const until = Date.now() + deadlineMs;
	while (Date.now() < until) {
		const failed = spawnError();
		if (failed) throw failed;
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`tauri-driver exited with ${child.exitCode ?? child.signalCode}`);
		}
		const remaining = until - Date.now();
		if (remaining <= 0) break;
		try {
			const response = await fetch(`http://127.0.0.1:${port}/status`, {
				signal: AbortSignal.timeout(Math.max(1, Math.min(probeTimeoutMs, remaining))),
			});
			if (response.ok) return;
		} catch {
			// Not listening yet, or probe timed out.
		}
		const pause = Math.min(100, Math.max(0, until - Date.now()));
		if (pause > 0) await sleep(pause);
	}
	throw new Error(`tauri-driver did not start within ${deadlineMs}ms`);
}

export interface StopDriverOptions {
	driver: ChildProcess;
	detached: boolean;
	browser?: { deleteSession(): Promise<unknown> };
	data?: string;
	previousInbound?: InboundSnapshot;
	appPid?: number;
	untrack?: () => void;
	deleteSessionTimeoutMs?: number;
	gracefulTimeoutMs?: number;
	forceTimeoutMs?: number;
	settleMs?: number;
}

/**
 * Cleanly ends the WebDriver session (bounded in time), terminates `tauri-driver` and its entire descendant tree
 * (`WebKitWebDriver`/`msedgedriver` and `loam-desktop`), escalates to `SIGKILL` / `taskkill /T /F` if anything
 * lingers, and verifies every tracked process has exited before resolving. Throws `DriverTeardownError` if any
 * tracked process survives `forceTimeoutMs`.
 */
export async function stopDriverProcess(options: StopDriverOptions): Promise<void> {
	const {
		driver,
		detached,
		browser,
		data,
		previousInbound,
		untrack,
		deleteSessionTimeoutMs = DELETE_SESSION_TIMEOUT_MS,
		gracefulTimeoutMs = GRACEFUL_EXIT_TIMEOUT_MS,
		forceTimeoutMs = FORCE_EXIT_TIMEOUT_MS,
		settleMs = SINGLE_INSTANCE_SETTLE_MS,
	} = options;

	let knownAppPid = options.appPid ?? (data ? readNewInboundPid(data, previousInbound) : undefined);

	if (browser) {
		await withTimeout(
			browser.deleteSession().catch(() => {}),
			deleteSessionTimeoutMs
		);
	}

	knownAppPid ??= data ? readNewInboundPid(data, previousInbound) : undefined;

	const driverPid = driver.pid;
	const isDriverAlive = () => driver.exitCode === null && driver.signalCode === null;
	const surviving = (): number[] => {
		const pids: number[] = [];
		if (driverPid && (isDriverAlive() || (detached && isProcessGroupAlive(driverPid)))) {
			pids.push(driverPid);
		}
		if (knownAppPid && knownAppPid !== driverPid && isProcessAlive(knownAppPid)) {
			pids.push(knownAppPid);
		}
		return pids;
	};
	const isTreeAlive = () => surviving().length > 0;

	if (!driverPid) {
		if (knownAppPid && isProcessAlive(knownAppPid)) {
			if (process.platform === 'win32') await taskkillTree(knownAppPid);
			else signalPosix(knownAppPid, false, 'SIGKILL');
			await waitUntilGone(() => isProcessAlive(knownAppPid as number), forceTimeoutMs);
		}
		const left = surviving();
		if (left.length > 0) {
			throw new DriverTeardownError(
				`desktop process tree did not exit after teardown (surviving pids: ${left.join(', ')})`,
				left
			);
		}
		untrack?.();
		return;
	}

	if (process.platform === 'win32') {
		// When a session was closed via `deleteSession()`, give the app a grace window to exit cleanly
		// before force-killing the driver tree; on startup failure (`!browser`) terminate at once.
		if (browser && knownAppPid && isProcessAlive(knownAppPid)) {
			await waitUntilGone(() => isProcessAlive(knownAppPid as number), gracefulTimeoutMs);
		}
		if (isDriverAlive()) {
			const killed = await taskkillTree(driverPid);
			if (!killed) {
				try {
					driver.kill();
				} catch {
					// Already gone.
				}
			}
		}
		if (knownAppPid && isProcessAlive(knownAppPid)) {
			await taskkillTree(knownAppPid);
		}
		await waitUntilGone(isTreeAlive, forceTimeoutMs);
	} else {
		if (isTreeAlive()) {
			signalPosix(driverPid, detached, 'SIGTERM');
			if (knownAppPid && isProcessAlive(knownAppPid)) {
				signalPosix(knownAppPid, false, 'SIGTERM');
			}
			const exited = await waitUntilGone(isTreeAlive, gracefulTimeoutMs);
			if (!exited) {
				signalPosix(driverPid, detached, 'SIGKILL');
				if (knownAppPid && isProcessAlive(knownAppPid)) {
					signalPosix(knownAppPid, false, 'SIGKILL');
				}
				await waitUntilGone(isTreeAlive, forceTimeoutMs);
			}
		}
	}

	const left = surviving();
	if (left.length > 0) {
		throw new DriverTeardownError(
			`desktop process tree did not exit after teardown (surviving pids: ${left.join(', ')})`,
			left
		);
	}
	untrack?.();
	if (settleMs > 0) {
		await sleep(settleMs);
	}
}

/** Spawn errors like missing binaries and teardown failures must not be retried. */
export function isRetryableSessionError(error: unknown): boolean {
	if (error instanceof DriverTeardownError) return false;
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code !== 'ENOENT' && code !== 'EACCES';
}

export interface RetryAttemptOptions<T> {
	attempts?: number;
	shouldRetry?: (error: unknown) => boolean;
	onRetry?: (attempt: number, total: number, error: unknown) => void;
	run: (attempt: number) => Promise<T>;
}

/**
 * Runs an async startup attempt up to `attempts` times. Each `run` call tears down its own driver before
 * rejecting so the next attempt starts against a clean single-instance slot.
 */
export async function withSessionRetry<T>(options: RetryAttemptOptions<T>): Promise<T> {
	const attempts = Math.max(1, options.attempts ?? SESSION_CREATE_ATTEMPTS);
	const shouldRetry = options.shouldRetry ?? isRetryableSessionError;
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await options.run(attempt);
		} catch (error) {
			lastError = error;
			if (attempt >= attempts || !shouldRetry(error)) throw error;
			options.onRetry?.(attempt, attempts, error);
		}
	}
	throw lastError;
}

export interface StartDesktopSessionOptions {
	prepareData: () => Promise<{ data: string; owned: boolean }>;
	spawnDriver: (port: number, nativePort: number, data: string, detached: boolean) => ChildProcess;
	capabilities: Record<string, unknown>;
	onStderr?: (stream: Readable | null, stderr: { lines: string[]; keyRefusals: number }) => void;
	logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
	attempts?: number;
	startupBudgetMs?: number;
	driverReadyTimeoutMs?: number;
	statusProbeTimeoutMs?: number;
	sessionCreateTimeoutMs?: number;
	sessionCommandTimeoutMs?: number;
	deleteSessionTimeoutMs?: number;
	gracefulTimeoutMs?: number;
	forceTimeoutMs?: number;
	settleMs?: number;
	onRetry?: (attempt: number, total: number, error: unknown) => void;
}

export interface StartedDesktopSession {
	driver: ChildProcess;
	browser: DesktopBrowser;
	stderr: { lines: string[]; keyRefusals: number };
	data: string;
	began: number;
	getAppPid: () => number | undefined;
	close: () => Promise<void>;
}

/**
 * Starts a desktop WebDriver session with a shared startup budget across driver readiness, `POST /session`,
 * verified teardown, and one retry with a fresh driver (and fresh data directory when harness-owned).
 */
export async function startDesktopSession(
	options: StartDesktopSessionOptions
): Promise<StartedDesktopSession> {
	const detached = process.platform !== 'win32';
	const attempts = Math.max(1, options.attempts ?? SESSION_CREATE_ATTEMPTS);
	const startupBudgetMs = options.startupBudgetMs ?? STARTUP_BUDGET_MS;
	const driverReadyTimeoutMs = options.driverReadyTimeoutMs ?? DRIVER_READY_TIMEOUT_MS;
	const statusProbeTimeoutMs = options.statusProbeTimeoutMs ?? STATUS_PROBE_TIMEOUT_MS;
	const sessionCreateTimeoutMs = options.sessionCreateTimeoutMs ?? SESSION_CREATE_TIMEOUT_MS;
	const sessionCommandTimeoutMs = options.sessionCommandTimeoutMs ?? SESSION_COMMAND_TIMEOUT_MS;
	const deleteSessionTimeoutMs = options.deleteSessionTimeoutMs ?? DELETE_SESSION_TIMEOUT_MS;
	const gracefulTimeoutMs = options.gracefulTimeoutMs ?? GRACEFUL_EXIT_TIMEOUT_MS;
	const forceTimeoutMs = options.forceTimeoutMs ?? FORCE_EXIT_TIMEOUT_MS;
	const settleMs = options.settleMs ?? SINGLE_INSTANCE_SETTLE_MS;
	const teardownReserveMs = gracefulTimeoutMs + forceTimeoutMs;
	const startupDeadline = Date.now() + startupBudgetMs;

	return withSessionRetry({
		attempts,
		onRetry:
			options.onRetry ??
			((attempt, total, error) => {
				const reason = error instanceof Error ? error.message : String(error);
				process.stderr.write(
					`loam-desktop harness: session creation attempt ${attempt}/${total} failed (${reason}); retrying with a fresh tauri-driver\n`
				);
			}),
		async run() {
			const remainingBeforePrepare = startupDeadline - Date.now() - teardownReserveMs;
			if (remainingBeforePrepare <= 0) {
				throw new Error(`desktop session startup exceeded ${startupBudgetMs}ms budget`);
			}
			const { data, owned } = await options.prepareData();
			const previousInbound = readInboundConnection(data);
			const port = await freePort();
			const nativePort = await freePort();
			const driver = options.spawnDriver(port, nativePort, data, detached);
			let spawnFailed: Error | undefined;
			driver.once('error', (error) => {
				spawnFailed = error;
			});
			let appPid: number | undefined;
			const getAppPid = () => {
				appPid ??= readNewInboundPid(data, previousInbound);
				return appPid;
			};
			const untrack = driver.pid
				? trackDriverProcess({
						pid: driver.pid,
						detached,
						getAppPid,
					})
				: undefined;
			const stderr = { lines: [] as string[], keyRefusals: 0 };
			options.onStderr?.(driver.stderr, stderr);
			try {
				const readyBudget = Math.min(
					driverReadyTimeoutMs,
					startupDeadline - Date.now() - teardownReserveMs
				);
				if (readyBudget <= 0) {
					throw new Error(`desktop session startup exceeded ${startupBudgetMs}ms budget`);
				}
				await waitForDriverPort(port, driver, () => spawnFailed, readyBudget, statusProbeTimeoutMs);
				const sessionBudget = Math.min(
					sessionCreateTimeoutMs,
					startupDeadline - Date.now() - teardownReserveMs
				);
				if (sessionBudget <= 0) {
					throw new Error(`desktop session startup exceeded ${startupBudgetMs}ms budget`);
				}
				const began = performance.now();
				const browser = await remote(
					{
						hostname: '127.0.0.1',
						port,
						logLevel: options.logLevel ?? 'error',
						connectionRetryTimeout: sessionBudget,
						connectionRetryCount: 0,
						capabilities: options.capabilities as never,
					},
					(client, opts) => {
						opts.connectionRetryTimeout = sessionCommandTimeoutMs;
						return client;
					}
				);
				browser.options.connectionRetryTimeout = sessionCommandTimeoutMs;
				getAppPid();
				let closed = false;
				const close = async () => {
					if (closed) return;
					closed = true;
					await stopDriverProcess({
						driver,
						detached,
						browser,
						data,
						previousInbound,
						appPid: getAppPid(),
						untrack,
						deleteSessionTimeoutMs,
						gracefulTimeoutMs,
						forceTimeoutMs,
						settleMs,
					});
				};
				return { driver, browser, stderr, data, began, getAppPid, close };
			} catch (cause) {
				await stopDriverProcess({
					driver,
					detached,
					data,
					previousInbound,
					appPid: getAppPid(),
					untrack,
					deleteSessionTimeoutMs,
					gracefulTimeoutMs,
					forceTimeoutMs,
					settleMs,
				});
				if (owned) {
					await rm(data, { recursive: true, force: true }).catch(() => {});
				}
				throw cause;
			}
		},
	});
}
