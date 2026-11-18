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
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPack } from '@lushly-dev/loam-cli';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import { remote } from 'webdriverio';

type Browser = Awaited<ReturnType<typeof remote>>;

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

/** Tauri 2.12's line when it drops a message for its invoke key (`Webview::on_message`). */
const INVOKE_KEY_LINE = /__TAURI_INVOKE_KEY__ expected (\S+) but received (\S*)/;

/** A line of the app's stderr with Tauri's expected invoke key replaced, and what was received kept. */
export function redactInvokeKey(line: string): string {
	return line.replace(
		INVOKE_KEY_LINE,
		(_all, _expected: string, received: string) =>
			`__TAURI_INVOKE_KEY__ expected <key> but received ${received === '' ? '<empty>' : '<other>'}`
	);
}
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

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

async function waitForPort(port: number, child: ChildProcess, deadline = 30_000): Promise<void> {
	const until = Date.now() + deadline;
	while (Date.now() < until) {
		if (child.exitCode !== null) throw new Error(`tauri-driver exited with ${child.exitCode}`);
		try {
			const response = await fetch(`http://127.0.0.1:${port}/status`);
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('tauri-driver did not start');
}

export interface Desktop {
	browser: Browser;
	/** The app's and the drivers' stderr, a line each, the invoke key redacted; and Tauri's key refusals, counted. */
	stderr: { lines: string[]; keyRefusals: number };
	/** The app's data directory: `site/`, `mounts.json` and the webview's profile. */
	data: string;
	/** Milliseconds from the session's request to the shell's `data-loam-host`. */
	coldStartMs: number;
	call(name: string, input?: unknown): Promise<CommandResultLike>;
	agentCall(name: string, input?: unknown): Promise<CommandResultLike>;
	/** Waits for the shell after a reload. */
	ready(): Promise<void>;
	close(): Promise<void>;
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
}

/** Writes the deployment, starts the app under `tauri-driver`, and waits for the shell. */
export async function openDesktop(options: OpenOptions = {}): Promise<Desktop> {
	const app = binary();
	if (!existsSync(app))
		throw new Error(`${app} is not built: run \`pnpm -F @lushly-dev/loam-desktop build:app\``);
	const data = await mkdtemp(join(tmpdir(), 'loam-desktop-data-'));
	const config = join(data, 'loam.deployment.toml');
	await writeFile(config, options.deployment ?? desktopDeployment());
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
	await options.prepare?.(data);

	const port = await freePort();
	const nativePort = await freePort();
	const native = process.env.LOAM_DESKTOP_NATIVE_DRIVER;
	const driver = spawn(
		process.env.LOAM_DESKTOP_TAURI_DRIVER ?? 'tauri-driver',
		[
			'--port',
			String(port),
			'--native-port',
			String(nativePort),
			...(native ? ['--native-driver', native] : []),
		],
		{ env: { ...process.env, LOAM_DESKTOP_DATA_DIR: data }, stdio: ['ignore', 'ignore', 'pipe'] }
	);
	const stderr = { lines: [] as string[], keyRefusals: 0 };
	let partial = '';
	driver.stderr?.setEncoding('utf8');
	driver.stderr?.on('data', (chunk: string) => {
		const lines = (partial + chunk).split(/\r?\n/);
		partial = lines.pop() ?? '';
		for (const line of lines) {
			if (INVOKE_KEY_LINE.test(line)) stderr.keyRefusals += 1;
			const shown = redactInvokeKey(line);
			stderr.lines.push(shown);
			process.stderr.write(`${shown}\n`);
		}
	});
	await waitForPort(port, driver);
	const began = performance.now();
	let browser: Browser;
	try {
		browser = await remote({
			hostname: '127.0.0.1',
			port,
			logLevel: 'error',
			connectionRetryCount: 0,
			capabilities: { 'tauri:options': { application: app } } as never,
		});
	} catch (cause) {
		driver.kill();
		throw cause;
	}
	const ready = async () => {
		await browser.waitUntil(
			async () =>
				// WebDriver answers `undefined` as `null`.
				(await browser.execute(() => document.documentElement.dataset.loamHost ?? null)) !== null,
			{ timeout: 30_000, interval: 50 }
		);
		await browser.execute(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				ready?: Promise<void>;
				booted?: boolean;
			} | null;
			await shell?.ready;
			if (shell?.booted) {
				await new Promise<void>((resolve) => {
					const check = () =>
						performance.getEntriesByName('loam-stage-b').length > 0
							? resolve()
							: setTimeout(check, 5);
					check();
				});
			}
		});
	};
	if (!options.raw) await ready();
	const coldStartMs = performance.now() - began;
	const run =
		(agent: boolean) =>
		async (name: string, input: unknown = {}): Promise<CommandResultLike> => {
			// As JSON text: a value with a top-level `error` reads as WebDriver's own error to its client.
			const text = await browser.execute(
				async (name, input, agent) => {
					const shell = document.querySelector('loam-shell') as unknown as {
						kernel: {
							call(name: string, input: unknown): Promise<unknown>;
							agent: { call(name: string, input: unknown): Promise<unknown> };
						};
					};
					// A call that throws answers as a failure with its code, as the console shows it.
					try {
						return JSON.stringify(
							await (agent ? shell.kernel.agent : shell.kernel).call(name, input)
						);
					} catch (error) {
						const { code, message } = error as { code?: unknown; message?: unknown };
						return JSON.stringify({
							success: false,
							thrown: true,
							error: { code: String(code ?? ''), message: String(message ?? error) },
						});
					}
				},
				name,
				input,
				agent
			);
			return JSON.parse(text as string) as CommandResultLike;
		};
	return {
		browser,
		stderr,
		data,
		coldStartMs,
		call: run(false),
		agentCall: run(true),
		ready,
		async close() {
			await browser.deleteSession().catch(() => {});
			driver.kill();
			// The app is single-instance: the next one started before this one has gone would exit at once.
			await new Promise((resolve) => setTimeout(resolve, 3_000));
		},
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
export function storedText(browser: Browser): Promise<string> {
	return browser.execute(async () => {
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
	});
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
