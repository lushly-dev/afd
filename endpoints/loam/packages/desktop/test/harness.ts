/**
 * The desktop suite's harness (phase 6 specification, 10.7): a deployment written with `loam deployment write
 * --host desktop` into a data directory of its own, the debug app started on it by `tauri-driver`, and a
 * WebDriver session that drives the webview with the kernel calls `web`'s harness makes.
 *
 * - `LOAM_DESKTOP_BINARY`: the app; default `$CARGO_TARGET_DIR` or `src-tauri/target`, `debug/loam-desktop`.
 * - `LOAM_DESKTOP_TAURI_DRIVER`: `tauri-driver`; default on `PATH`.
 * - `LOAM_DESKTOP_NATIVE_DRIVER`: the platform's driver (`msedgedriver` on Windows; `WebKitWebDriver` on
 *   Linux, found on `PATH` when unset).
 *
 * The app's stderr reaches the suite's through `redactInvokeKey` (#1448): Tauri prints its expected invoke key when it
 * drops a message for its key, and on WebKitGTK that key is the copilot frame's barrier (phase 5 specification, D153),
 * so no CI log holds it. Each refusal is still counted, in `Desktop.stderr`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPack } from '@lushly-dev/loam-cli';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import { type DesktopBrowser, startDesktopSession } from './driver-lifecycle';
import { INVOKE_KEY_LINE, pipeRedactedStderr, redactInvokeKey } from './stderr-filter';

export { INVOKE_KEY_LINE, pipeRedactedStderr, redactInvokeKey };

type Browser = DesktopBrowser;

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
export const LOAM = fileURLToPath(new URL('../../..', import.meta.url));
const WEB_DIST = join(LOAM, 'packages/web/dist');
const windows = process.platform === 'win32';

/** The shell's and the sandbox's origins on this platform (10.2). */
export const ORIGINS = windows
	? { shell: 'http://loam.localhost', sandbox: 'http://loam-sandbox.localhost' }
	: { shell: 'loam://localhost', sandbox: 'loam-sandbox://localhost' };

/** The phase 0 policy `web`'s `index.html` carries, before `deployment write`. */
export const PHASE_0_POLICY =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'";

export function binary(): string {
	if (process.env.LOAM_DESKTOP_BINARY) return process.env.LOAM_DESKTOP_BINARY;
	const target = process.env.CARGO_TARGET_DIR || join(PACKAGE, 'src-tauri/target');
	return join(target, 'debug', windows ? 'loam-desktop.exe' : 'loam-desktop');
}

const packed = new Map<string, Promise<string>>();

/** `loam app pack` on an app, once a run. */
export function packApp(directory: string, manifest?: string): Promise<string> {
	const key = `${directory}:${manifest ?? ''}`;
	const held = packed.get(key);
	if (held) return held;
	const pack = (async () => {
		const out = join(await mkdtemp(join(tmpdir(), 'loam-desktop-pack-')), 'package');
		const result = await appPack({ dir: directory, ...(manifest ? { manifest } : {}), out });
		if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
		return out;
	})();
	packed.set(key, pack);
	return pack;
}

/** A version 4 desktop deployment with these `[apps.*]` tables. */
export function desktopDeployment(apps: string[] = []): string {
	return [
		'deployment_version = 4',
		'',
		'[host]',
		'kind = "desktop"',
		'',
		'[identity]',
		'mode = "local"',
		'',
		...(apps.length ? apps : ['[apps]']),
		'',
	].join('\n');
}

export interface CallOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface PageJobState {
	status: 'pending' | 'done' | 'failed' | 'missing';
	value?: string;
	/** Named `failureMessage`, never `error`: WebDriver treats any top-level `error` key as a protocol failure. */
	failureMessage?: string;
}

export interface Desktop {
	browser: Browser;
	/** The app's and the drivers' stderr, a line each, the invoke key redacted; and Tauri's key refusals, counted. */
	stderr: { lines: string[]; keyRefusals: number };
	/** The app's data directory: `site/`, `mounts.json` and the webview's profile. */
	data: string;
	/** Milliseconds from the session's request to stage A's paint (`data-loam-host` and `loam-stage-b`). */
	coldStartMs: number;
	call(name: string, input?: unknown, options?: CallOptions): Promise<CommandResultLike>;
	agentCall(name: string, input?: unknown, options?: CallOptions): Promise<CommandResultLike>;
	/** Waits for the shell after a reload. */
	ready(): Promise<void>;
	close(): Promise<void>;
}

export interface ScriptExecutor {
	execute(script: (jobId: number) => unknown, jobId: number): Promise<unknown>;
}

/**
 * Polls an in-page async job started by a synchronous `browser.execute(...)` call (`POST /execute/sync`).
 *
 * WebKitWebDriver on Linux intermittently hangs forever on `POST /execute/async` (the path WebdriverIO
 * selects whenever an `async` function is passed to `browser.execute`) and wedges every later command in
 * the session (#2656). Starting the work in one synchronous execute call and polling its slot on `window`
 * avoids `execute/async` altogether and tells a stalled kernel call apart from a hung WebDriver.
 */
export async function pollPageJob(
	browser: ScriptExecutor,
	start: () => Promise<number>,
	options: { label: string; timeoutMs?: number; pollMs?: number; signal?: AbortSignal }
): Promise<string> {
	if (options.signal?.aborted) {
		throw new Error(`${options.label} aborted before starting in the page`);
	}
	const timeoutMs = options.timeoutMs ?? 120_000;
	const basePollMs = options.pollMs ?? 25;
	const deadline = Date.now() + timeoutMs;
	const cleanup = (jobId: number) =>
		browser
			.execute((id: number) => {
				(window as unknown as { __loamJobs?: Map<number, PageJobState> }).__loamJobs?.delete(id);
			}, jobId)
			.catch(() => undefined);
	const raceBudget = <T>(
		promise: Promise<T>,
		stage: 'start' | 'poll',
		onCancel?: () => void
	): Promise<T> => {
		const remaining = deadline - Date.now();
		if (options.signal?.aborted) {
			onCancel?.();
			return Promise.reject(
				new Error(`${options.label} aborted while waiting on WebDriver ${stage}`)
			);
		}
		if (remaining <= 0) {
			onCancel?.();
			return Promise.reject(
				new Error(`${options.label} timed out waiting on WebDriver ${stage} after ${timeoutMs} ms`)
			);
		}
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				options.signal?.removeEventListener('abort', onAbort);
				fn();
			};
			const onAbort = () =>
				finish(() => {
					onCancel?.();
					reject(new Error(`${options.label} aborted while waiting on WebDriver ${stage}`));
				});
			const timer = setTimeout(
				() =>
					finish(() => {
						onCancel?.();
						reject(
							new Error(
								`${options.label} timed out waiting on WebDriver ${stage} after ${timeoutMs} ms`
							)
						);
					}),
				remaining
			);
			options.signal?.addEventListener('abort', onAbort, { once: true });
			promise.then(
				(value) => finish(() => resolve(value)),
				(cause) => finish(() => reject(cause))
			);
		});
	};
	const sleepBudget = (ms: number): Promise<void> => {
		const wait = Math.min(ms, Math.max(0, deadline - Date.now()));
		if (wait <= 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const onAbort = () => {
				clearTimeout(timer);
				resolve();
			};
			const timer = setTimeout(() => {
				options.signal?.removeEventListener('abort', onAbort);
				resolve();
			}, wait);
			options.signal?.addEventListener('abort', onAbort, { once: true });
		});
	};

	let startCancelled = false;
	const startPromise = start();
	// If `start()` finishes after timeout/abort, delete the late job id best-effort.
	void startPromise.then(
		(lateId) => {
			if (startCancelled) void cleanup(lateId);
		},
		() => undefined
	);
	const id = await raceBudget(startPromise, 'start', () => {
		startCancelled = true;
	});

	let attempts = 0;
	for (;;) {
		if (options.signal?.aborted) {
			void cleanup(id);
			throw new Error(`${options.label} aborted while pending in the page`);
		}
		if (attempts > 0 && Date.now() >= deadline) {
			await cleanup(id);
			throw new Error(`${options.label} did not settle in the page within ${timeoutMs} ms`);
		}
		const state = (await raceBudget(
			browser.execute((jobId: number): PageJobState => {
				const jobs = (window as unknown as { __loamJobs?: Map<number, PageJobState> }).__loamJobs;
				const entry = jobs?.get(jobId);
				if (!entry) return { status: 'missing' };
				if (entry.status !== 'pending') jobs?.delete(jobId);
				return entry;
			}, id),
			'poll',
			() => {
				void cleanup(id);
			}
		)) as PageJobState;
		if (state.status === 'done') return state.value ?? '';
		if (state.status === 'failed')
			throw new Error(state.failureMessage ?? `${options.label} failed`);
		if (state.status === 'missing') {
			throw new Error(
				`${options.label} lost its in-page job ${id} (the page reloaded or navigated while it was pending)`
			);
		}
		if (Date.now() >= deadline) {
			await cleanup(id);
			throw new Error(`${options.label} did not settle in the page within ${timeoutMs} ms`);
		}
		attempts += 1;
		await sleepBudget(attempts <= 5 ? 5 : basePollMs);
	}
}

export interface CommandResultLike {
	success: boolean;
	data?: Record<string, unknown> & unknown;
	error?: { code?: string; message?: string };
}

export interface OpenOptions {
	/** The deployment file's text. */
	deployment?: string;
	/** Before the app starts, with the data directory written. */
	prepare?(data: string): Promise<void>;
	/** Skip the shell's readiness wait. */
	raw?: boolean;
	/** An earlier run's data directory, used as it is: nothing is written, as when the person restarts the app. */
	data?: string;
}

/** A new data directory with `deployment` written into it by `loam deployment write --host desktop`. */
export async function writeData(deployment = desktopDeployment()): Promise<string> {
	const data = await mkdtemp(join(tmpdir(), 'loam-desktop-data-'));
	const config = join(data, 'loam.deployment.toml');
	await writeFile(config, deployment);
	const written = await writeDeployment({
		config,
		dist: WEB_DIST,
		out: join(data, 'site'),
		mountsOut: join(data, 'mounts.json'),
		modelsOut: join(data, 'models.json'),
		host: 'desktop',
	});
	if (!written.ok) throw new Error(JSON.stringify(written.refusals));
	await mkdir(join(data, 'webview'), { recursive: true });
	return data;
}

/** Writes the deployment, starts the app under `tauri-driver`, and waits for the shell. */
export async function openDesktop(options: OpenOptions = {}): Promise<Desktop> {
	const app = binary();
	if (!existsSync(app))
		throw new Error(`${app} is not built: run \`pnpm -F @lushly-dev/loam-desktop build:app\``);

	let callerDataPrepared = false;
	const native = process.env.LOAM_DESKTOP_NATIVE_DRIVER;
	const started = await startDesktopSession({
		async prepareData() {
			if (options.data) {
				if (!callerDataPrepared) {
					callerDataPrepared = true;
					await options.prepare?.(options.data);
				}
				return { data: options.data, owned: false };
			}
			// Each retry gets a freshly written data directory and empty webview profile so cold-start
			// measurements (`boot.test.ts`) never measure a warm profile left by an earlier failed attempt.
			const data = await writeData(options.deployment);
			await options.prepare?.(data);
			return { data, owned: true };
		},
		spawnDriver(port, nativePort, data, detached) {
			return spawn(
				process.env.LOAM_DESKTOP_TAURI_DRIVER ?? 'tauri-driver',
				[
					'--port',
					String(port),
					'--native-port',
					String(nativePort),
					...(native ? ['--native-driver', native] : []),
				],
				{
					env: { ...process.env, LOAM_DESKTOP_DATA_DIR: data },
					stdio: ['ignore', 'ignore', 'pipe'],
					detached,
				}
			);
		},
		capabilities: { 'tauri:options': { application: app } },
		onStderr: pipeRedactedStderr,
	});

	const { browser, stderr, data, began, getAppPid, close } = started;
	const ready = async () => {
		await browser.waitUntil(
			async () =>
				// WebDriver answers `undefined` as `null`.
				(await browser.execute(() => document.documentElement.dataset.loamHost ?? null)) !== null,
			{ timeout: 30_000, interval: 15 }
		);
		let readyFailure: string | undefined;
		await browser.waitUntil(
			async () => {
				const state = (await browser.execute(() => {
					const shell = document.querySelector('loam-shell') as
						| (Element & {
								ready?: Promise<void>;
								booted?: boolean;
								__loamReadyHooked?: boolean;
								__loamReadyDone?: boolean;
								__loamReadyFailure?: string;
						  })
						| null;
					if (!shell || !shell.ready) return { done: true };
					if (!shell.__loamReadyHooked) {
						shell.__loamReadyHooked = true;
						void shell.ready.then(
							() => {
								shell.__loamReadyDone = true;
							},
							(cause: unknown) => {
								shell.__loamReadyFailure = cause instanceof Error ? cause.message : String(cause);
							}
						);
					}
					// Use `failureMessage` (never `error`): WebDriver treats a top-level `error` key as a protocol failure.
					if (shell.__loamReadyFailure !== undefined)
						return { done: true, failureMessage: shell.__loamReadyFailure };
					if (!shell.__loamReadyDone) return { done: false };
					return {
						done: !shell.booted || performance.getEntriesByName('loam-stage-b').length > 0,
					};
				})) as { done?: boolean; failureMessage?: string };
				if (state.failureMessage !== undefined) {
					readyFailure = state.failureMessage;
					return true;
				}
				return state.done === true;
			},
			{ timeout: 30_000, interval: 15 }
		);
		if (readyFailure !== undefined) throw new Error(readyFailure);
	};
	if (!options.raw) {
		try {
			await ready();
			getAppPid();
		} catch (cause) {
			await close();
			throw cause;
		}
	}
	const coldStartMs = performance.now() - began;
	const run =
		(agent: boolean) =>
		async (
			name: string,
			input: unknown = {},
			callOptions: CallOptions = {}
		): Promise<CommandResultLike> => {
			// As JSON text: a value with a top-level `error` reads as WebDriver's own error to its client.
			const text = await pollPageJob(
				browser,
				() =>
					browser.execute(
						(name: string, input: unknown, agent: boolean): number => {
							const holder = window as unknown as {
								__loamJobs?: Map<number, PageJobState>;
								__loamJobSeq?: number;
							};
							holder.__loamJobs ??= new Map();
							const id = (holder.__loamJobSeq ?? 0) + 1;
							holder.__loamJobSeq = id;
							const entry: PageJobState = { status: 'pending' };
							holder.__loamJobs.set(id, entry);
							const shell = document.querySelector('loam-shell') as unknown as {
								kernel: {
									call(name: string, input: unknown): Promise<unknown>;
									agent: { call(name: string, input: unknown): Promise<unknown> };
								};
							};
							// Mutate `entry` in place so a completion after cleanup never re-inserts a deleted id.
							// A call that throws answers as a failure with its code, as the console shows it.
							void Promise.resolve()
								.then(() => (agent ? shell.kernel.agent : shell.kernel).call(name, input))
								.then(
									(result) => {
										entry.status = 'done';
										entry.value = JSON.stringify(result);
									},
									(cause: unknown) => {
										const details =
											cause !== null && typeof cause === 'object'
												? (cause as { code?: unknown; message?: unknown })
												: {};
										entry.status = 'done';
										entry.value = JSON.stringify({
											success: false,
											thrown: true,
											error: {
												code: String(details.code ?? ''),
												message: String(details.message ?? cause),
											},
										});
									}
								);
							return id;
						},
						name,
						input,
						agent
					),
				{
					label: `${agent ? 'agent ' : ''}${name}`,
					...(callOptions.timeoutMs !== undefined ? { timeoutMs: callOptions.timeoutMs } : {}),
					...(callOptions.signal !== undefined ? { signal: callOptions.signal } : {}),
				}
			);
			return JSON.parse(text) as CommandResultLike;
		};
	return {
		browser,
		stderr,
		data,
		coldStartMs,
		call: run(false),
		agentCall: run(true),
		ready,
		close,
	};
}

/** Every text the page holds: the document and each shadow root, with attributes. */
export function pageText(browser: Browser): Promise<string> {
	return browser.execute(() => {
		const parts: string[] = [];
		const walk = (root: Document | ShadowRoot) => {
			parts.push(root instanceof Document ? root.documentElement.outerHTML : root.innerHTML);
			for (const element of root.querySelectorAll('*'))
				if (element.shadowRoot) walk(element.shadowRoot);
		};
		walk(document);
		return parts.join('\n');
	});
}

/** Every record of every IndexedDB database, and `localStorage`, as JSON. */
export function storedText(browser: Browser, options: CallOptions = {}): Promise<string> {
	return pollPageJob(
		browser,
		() =>
			browser.execute((): number => {
				const holder = window as unknown as {
					__loamJobs?: Map<number, PageJobState>;
					__loamJobSeq?: number;
				};
				holder.__loamJobs ??= new Map();
				const id = (holder.__loamJobSeq ?? 0) + 1;
				holder.__loamJobSeq = id;
				const entry: PageJobState = { status: 'pending' };
				holder.__loamJobs.set(id, entry);
				void (async () => {
					const out: unknown[] = [];
					for (const { name } of await indexedDB.databases()) {
						if (!name) continue;
						const db = await new Promise<IDBDatabase>((resolve, reject) => {
							const request = indexedDB.open(name);
							request.onsuccess = () => resolve(request.result);
							request.onerror = () => reject(request.error);
						});
						for (const store of Array.from(db.objectStoreNames)) {
							const rows = await new Promise<unknown[]>((resolve, reject) => {
								const request = db.transaction(store).objectStore(store).getAll();
								request.onsuccess = () => resolve(request.result);
								request.onerror = () => reject(request.error);
							});
							out.push({ name, store, rows });
						}
						db.close();
					}
					out.push({ localStorage: { ...localStorage } });
					return JSON.stringify(out);
				})().then(
					(value) => {
						entry.status = 'done';
						entry.value = value;
					},
					(cause: unknown) => {
						entry.status = 'failed';
						entry.failureMessage = cause instanceof Error ? cause.message : String(cause);
					}
				);
				return id;
			}),
		{
			label: 'storedText',
			...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
			...(options.signal !== undefined ? { signal: options.signal } : {}),
		}
	);
}

/** Starts collecting CSP violations in the main frame; read them with `violations`. */
export async function watchViolations(browser: Browser): Promise<void> {
	await browser.execute(() => {
		const held = window as unknown as { loamViolations?: string[] };
		held.loamViolations = [];
		document.addEventListener('securitypolicyviolation', (event) =>
			held.loamViolations?.push(`${event.violatedDirective} ${event.blockedURI}`)
		);
	});
}

export function violations(browser: Browser): Promise<string[]> {
	return browser.execute(
		() => (window as unknown as { loamViolations?: string[] }).loamViolations ?? []
	);
}

/** `app-instance-list`'s row for `instance` once it reaches `state`. */
export async function untilInstance(
	desktop: Desktop,
	instance: string,
	state: string,
	timeoutMs = 30_000
): Promise<{ state: string; error?: { code?: string } }> {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const listed = await desktop.call('app-instance-list');
		const rows = (listed.data as { instances?: { instance: string; state: string }[] } | undefined)
			?.instances;
		const row = rows?.find((candidate) => candidate.instance === instance);
		if (row?.state === state) return row as { state: string; error?: { code?: string } };
		if (Date.now() > until) throw new Error(`${instance} is ${JSON.stringify(row)}, not ${state}`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}
