/**
 * D153 and P6-D4 on macOS WKWebView (#1779): launches the unmodified `loam-desktop` binary against a
 * temporary data directory (`LOAM_DESKTOP_DATA_DIR`), without WebDriver (macOS has none for WKWebView).
 *
 * The probe shell runs on `loam://localhost/` under the exact desktop `<meta>` CSP, mounts the three
 * production frame shapes (`proxy`, nested opaque `view`, and `copilot` on `loam-sandbox://localhost`),
 * attempts `invoke` and raw IPC posts from each frame, verifies the handle counter did not advance, runs
 * the D153 main-frame control (forged `Origin` with key, bare without `Origin`, and wrong key), checks
 * main-frame capability refusals and `mounts.json` traversal/symlink 404s, and delivers its report back
 * through the real `mount_send` stdio transport (`barrier-reporter.ts`).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binary, LOAM, ORIGINS, pipeRedactedStderr } from '../harness';

const PACKAGE = fileURLToPath(new URL('../..', import.meta.url));
const RESULTS = join(PACKAGE, 'test-results');
const REPORTER = fileURLToPath(new URL('../fixtures/barrier-reporter.ts', import.meta.url));

/** The exact `<meta>` CSP `loam deployment write --host desktop` writes for a desktop shell with frames. */
const SHELL_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' data:",
	"connect-src 'self' ipc: http://ipc.localhost",
	`frame-src ${ORIGINS.sandbox}`,
	"object-src 'none'",
	"base-uri 'none'",
].join('; ');

/** Exact `<meta>` CSP of `web/public/sandbox/proxy.html`. */
const PROXY_META_CSP =
	"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; font-src data:; frame-src 'self'; base-uri 'none'";

/** Exact inner CSP prefix `web/public/sandbox/proxy.js` prepends to every view's `srcdoc`. */
const VIEW_INNER_CSP =
	"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'\">";

interface FrameProbeResult {
	origin: string;
	internals: string;
	invoke: { ok: boolean; value: string };
	forgedInvoke: string;
	fetch: Record<string, string>;
	posts: Record<string, string>;
	worker?: Record<string, string>;
}

interface BarrierReport {
	error?: string;
	environment: {
		userAgent: string;
		origin: string;
		internals: string;
		windowIpc: string;
		webkitIpc: string;
		shellViolations: string[];
	};
	capabilities: {
		unknownInstance: { ok: boolean; value: string };
		disallowed: Record<string, { ok: boolean; value: string }>;
		channelFetch: { ok: boolean; value: string };
	};
	traversal: Record<string, string>;
	frames: {
		beforeHandle: number;
		afterHandle: number;
		proxy: FrameProbeResult;
		view: FrameProbeResult;
		copilot: FrameProbeResult;
	};
	control: {
		beforeHandle: number;
		afterHandle: number;
		keyed: boolean;
		keySource: string;
		forged: string;
		bare: string;
		unkeyed: string;
	};
}

/** Shared frame-side IPC probe function body, serialized into each frame's script. */
const FRAME_PROBE_FN = `
async function probeFrameIpc(shellOrigin) {
	const page = window;
	const internals = page.__TAURI_INTERNALS__;
	const invokePlain = async () => {
		if (typeof internals?.invoke !== 'function') return { ok: false, value: 'no invoke' };
		try {
			const answer = await Promise.race([
				internals.invoke('mount_open', { instance: 'fixture' }),
				new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), 3000)),
			]);
			return { ok: true, value: JSON.stringify(answer ?? null) };
		} catch (error) {
			return { ok: false, value: String(error).slice(0, 160) };
		}
	};
	let forgedInvoke = 'no invoke';
	const headers = { Origin: shellOrigin };
	if (typeof internals?.invoke === 'function') {
		try {
			await Promise.race([
				internals.invoke('mount_open', { instance: 'fixture' }, { headers }),
				new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), 3000)),
			]);
			forgedInvoke = 'answered';
		} catch (error) {
			forgedInvoke = String(error).slice(0, 160);
		}
	}
	const fetched = {};
	for (const url of ['http://ipc.localhost/mount_open', 'ipc://localhost/mount_open']) {
		try {
			const response = await fetch(url, {
				method: 'POST',
				body: JSON.stringify({ instance: 'fixture' }),
			});
			fetched[url] = 'answered ' + response.status;
		} catch (error) {
			fetched[url] = 'refused: ' + (error?.name ?? String(error));
		}
	}
	const message = JSON.stringify({
		cmd: 'mount_open',
		callback: 1,
		error: 2,
		payload: { instance: 'fixture' },
		options: { headers },
		__TAURI_INVOKE_KEY__: 'forged',
	});
	const posts = {};
	const channels = [
		['window.ipc', page.ipc?.postMessage ? () => page.ipc.postMessage(message) : null],
		['chrome.webview', page.chrome?.webview?.postMessage ? () => page.chrome.webview.postMessage(message) : null],
		[
			'webkit.messageHandlers.ipc',
			page.webkit?.messageHandlers?.ipc?.postMessage
				? () => page.webkit.messageHandlers.ipc.postMessage(message)
				: null,
		],
	];
	for (const [name, send] of channels) {
		if (!send) {
			posts[name] = 'absent';
			continue;
		}
		try {
			send();
			posts[name] = 'posted';
		} catch (error) {
			posts[name] = 'threw ' + (error?.name ?? String(error));
		}
	}
	return {
		origin: self.origin,
		internals: typeof internals,
		invoke: await invokePlain(),
		forgedInvoke,
		fetch: fetched,
		posts,
	};
}
`;

function buildProxyScript(): string {
	return `(() => {
${FRAME_PROBE_FN}
const VIEW_INNER_CSP = ${JSON.stringify(VIEW_INNER_CSP)};
const shellOrigin = new URLSearchParams(location.search).get('host') || ${JSON.stringify(ORIGINS.shell)};

const viewHtml = '<script>(' + (() => {
${FRAME_PROBE_FN}
window.addEventListener('message', async (event) => {
	if (event.data?.kind !== 'run-view-probe') return;
	const result = await probeFrameIpc(event.data.shellOrigin);
	window.parent.postMessage({ kind: 'view-probe-result', result }, '*');
});
window.parent.postMessage({ kind: 'view-probe-ready' }, '*');
}).toString() + ')();<\\/script>';

async function run() {
	const proxy = await probeFrameIpc(shellOrigin);
	const view = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('opaque view frame timed out')), 15000);
		const inner = document.createElement('iframe');
		inner.setAttribute('sandbox', 'allow-scripts allow-forms');
		inner.title = 'Opaque view probe';
		const onMessage = (event) => {
			if (event.source !== inner.contentWindow) return;
			if (event.data?.kind === 'view-probe-ready') {
				inner.contentWindow.postMessage({ kind: 'run-view-probe', shellOrigin }, '*');
			} else if (event.data?.kind === 'view-probe-result') {
				clearTimeout(timer);
				window.removeEventListener('message', onMessage);
				resolve(event.data.result);
			}
		};
		window.addEventListener('message', onMessage);
		inner.srcdoc = VIEW_INNER_CSP + viewHtml;
		document.body.append(inner);
	});
	window.parent.postMessage({ kind: 'proxy-and-view-result', proxy, view }, shellOrigin);
}

window.addEventListener('DOMContentLoaded', () => {
	void run().catch((error) => {
		window.parent.postMessage({ kind: 'proxy-and-view-error', error: String(error) }, shellOrigin);
	});
});
})();
`;
}

function buildCopilotWorkerScript(): string {
	return `self.onmessage = async (event) => {
	const port = event.ports[0];
	const result = {
		started: 'yes',
		origin: self.origin,
		internals: typeof self.__TAURI_INTERNALS__,
		webkit: typeof self.webkit,
		ipc: typeof self.ipc,
	};
	for (const url of ['http://ipc.localhost/mount_open', 'ipc://localhost/mount_open']) {
		try {
			const response = await fetch(url, { method: 'POST', body: JSON.stringify({ instance: 'fixture' }) });
			result['fetch ' + url] = 'answered ' + response.status;
		} catch (error) {
			result['fetch ' + url] = 'refused: ' + (error?.name ?? String(error));
		}
	}
	port.postMessage(result);
};
`;
}

function buildCopilotFrameScript(): string {
	return `(() => {
${FRAME_PROBE_FN}
const base = new URL('.', document.currentScript?.src ?? location.href).href;

function runWorker() {
	return new Promise((resolve) => {
		let worker;
		try {
			const url = URL.createObjectURL(
				new Blob(['importScripts(' + JSON.stringify(new URL('probe-worker.js', base).href) + ');'], {
					type: 'text/javascript',
				})
			);
			worker = new Worker(url);
		} catch (error) {
			resolve({ started: 'threw ' + String(error) });
			return;
		}
		const channel = new MessageChannel();
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({ started: 'timed out' });
		}, 15000);
		worker.onerror = (event) => {
			clearTimeout(timer);
			resolve({ started: 'error ' + event.message });
		};
		channel.port1.onmessage = ({ data }) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(data);
		};
		worker.postMessage(null, [channel.port2]);
	});
}

window.addEventListener('message', (event) => {
	if (event.source !== window.parent || event.ports.length !== 1) return;
	const shellOrigin = event.data?.shellOrigin;
	const port = event.ports[0];
	if (!shellOrigin || !port) return;
	void (async () => {
		const result = await probeFrameIpc(shellOrigin);
		result.worker = await runWorker();
		port.postMessage({ kind: 'copilot-result', result });
	})().catch((error) => {
		port.postMessage({ kind: 'copilot-error', error: String(error) });
	});
});
})();
`;
}

function buildShellScript(): string {
	return `(() => {
const SHELL_ORIGIN = ${JSON.stringify(ORIGINS.shell)};
const SANDBOX_ORIGIN = ${JSON.stringify(ORIGINS.sandbox)};

async function invoke(command, args = {}, timeoutMs = 10000) {
	const internals = window.__TAURI_INTERNALS__;
	if (typeof internals?.invoke !== 'function') return { ok: false, value: 'no invoke' };
	try {
		const answer = await Promise.race([
			internals.invoke(command, args),
			new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), timeoutMs)),
		]);
		return { ok: true, value: JSON.stringify(answer ?? null) };
	} catch (error) {
		return { ok: false, value: String(error) };
	}
}

async function runProxyAndView() {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('proxy frame timed out')), 25000);
		const frame = document.createElement('iframe');
		frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
		frame.setAttribute('referrerpolicy', 'no-referrer');
		const url = new URL('/sandbox/proxy-probe.html', SANDBOX_ORIGIN);
		url.searchParams.set('host', SHELL_ORIGIN);
		const onMessage = (event) => {
			if (event.source !== frame.contentWindow || event.origin !== SANDBOX_ORIGIN) return;
			if (event.data?.kind === 'proxy-and-view-result') {
				clearTimeout(timer);
				window.removeEventListener('message', onMessage);
				resolve({ proxy: event.data.proxy, view: event.data.view });
			} else if (event.data?.kind === 'proxy-and-view-error') {
				clearTimeout(timer);
				window.removeEventListener('message', onMessage);
				reject(new Error(event.data.error));
			}
		};
		window.addEventListener('message', onMessage);
		frame.src = url.href;
		document.body.append(frame);
	});
}

async function runCopilot() {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('copilot frame timed out')), 25000);
		const frame = document.createElement('iframe');
		frame.setAttribute('sandbox', 'allow-scripts');
		frame.setAttribute('aria-hidden', 'true');
		frame.setAttribute('tabindex', '-1');
		frame.style.display = 'none';
		frame.addEventListener('load', () => {
			const channel = new MessageChannel();
			channel.port1.onmessage = ({ data }) => {
				clearTimeout(timer);
				if (data?.kind === 'copilot-result') resolve(data.result);
				else reject(new Error(data?.error ?? 'unknown copilot frame error'));
			};
			frame.contentWindow.postMessage({ shellOrigin: SHELL_ORIGIN }, '*', [channel.port2]);
		}, { once: true });
		frame.src = new URL('/sandbox/copilot/index-probe.html', SANDBOX_ORIGIN).href;
		document.body.append(frame);
	});
}

async function runControl() {
	const internals = window.__TAURI_INTERNALS__;
	const originalFetch = window.fetch;
	const originalIpcPost = window.ipc?.postMessage?.bind(window.ipc);
	let key = '';
	let keySource = 'none';
	window.fetch = (input, init) => {
		const found = new Headers(init?.headers).get('Tauri-Invoke-Key');
		if (found) {
			key = found;
			keySource = 'fetch';
		}
		return originalFetch.call(window, input, init);
	};
	if (window.ipc && originalIpcPost) {
		window.ipc.postMessage = (raw) => {
			try {
				const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (typeof parsed?.__TAURI_INVOKE_KEY__ === 'string' && parsed.__TAURI_INVOKE_KEY__) {
					key = parsed.__TAURI_INVOKE_KEY__;
					keySource = 'postMessage';
				}
			} catch {
				// Ignore unparseable message.
			}
			return originalIpcPost(raw);
		};
	}
	let beforeHandle;
	try {
		beforeHandle = Number(await internals.invoke('mount_open', { instance: 'fixture' }));
	} finally {
		window.fetch = originalFetch;
		if (window.ipc && originalIpcPost) window.ipc.postMessage = originalIpcPost;
	}
	await internals.invoke('mount_close', { handle: beforeHandle });

	const post = (headers, invokeKey) =>
		new Promise((resolve) => {
			const timer = setTimeout(() => resolve('unanswered'), 2000);
			const settle = (outcome) => async (value) => {
				clearTimeout(timer);
				const answer = outcome + ' ' + JSON.stringify(value);
				if (outcome === 'ok') {
					try {
						await internals.invoke('mount_close', { handle: value });
					} catch (cause) {
						resolve(answer + ', not closed: ' + String(cause));
						return;
					}
				}
				resolve(answer);
			};
			window.ipc.postMessage(
				JSON.stringify({
					cmd: 'mount_open',
					callback: internals.transformCallback(settle('ok'), true),
					error: internals.transformCallback(settle('error'), true),
					payload: { instance: 'fixture' },
					options: { headers },
					__TAURI_INVOKE_KEY__: invokeKey,
				})
			);
		});

	const forged = await post({ Origin: SHELL_ORIGIN }, key);
	const bare = await post({}, key);
	const unkeyed = await post({ Origin: SHELL_ORIGIN }, 'forged');
	const afterHandle = Number(await internals.invoke('mount_open', { instance: 'fixture' }));
	await internals.invoke('mount_close', { handle: afterHandle });

	return {
		beforeHandle,
		afterHandle,
		keyed: key !== '',
		keySource,
		forged,
		bare,
		unkeyed,
	};
}

async function deliver(report) {
	const handle = await window.__TAURI_INTERNALS__.invoke('mount_open', { instance: 'fixture' });
	try {
		await window.__TAURI_INTERNALS__.invoke('mount_send', {
			handle,
			message: { jsonrpc: '2.0', id: 1, method: 'report', params: report },
		});
	} finally {
		await window.__TAURI_INTERNALS__.invoke('mount_close', { handle });
	}
}

async function main() {
	const shellViolations = [];
	document.addEventListener('securitypolicyviolation', (event) => {
		shellViolations.push(event.violatedDirective + ' ' + event.blockedURI);
	});
	const environment = {
		userAgent: navigator.userAgent,
		origin: location.origin,
		internals: typeof window.__TAURI_INTERNALS__,
		windowIpc: typeof window.ipc?.postMessage,
		webkitIpc: typeof window.webkit?.messageHandlers?.ipc?.postMessage,
		shellViolations,
	};

	const unknownInstance = await invoke('mount_open', { instance: 'missing' });
	const disallowed = {};
	for (const command of [
		'plugin:event|listen',
		'plugin:event|emit',
		'plugin:app|version',
		'plugin:window|close',
		'plugin:webview|print',
		'plugin:menu|new',
		'plugin:path|resolve_directory',
		'plugin:single-instance|anything',
		'plugin:updater|check',
		'plugin:updater|download',
		'plugin:updater|install',
		'plugin:updater|download_and_install',
		'not_a_command',
	]) {
		disallowed[command] = await invoke(command, {});
	}
	const channelFetch = await invoke('plugin:__TAURI_CHANNEL__|fetch', {});

	const traversal = {};
	for (const path of [
		'/../mounts.json',
		'/%2e%2e/mounts.json',
		'/%2E%2E/mounts.json',
		'/..%2fmounts.json',
		'/%2e%2e%2fmounts.json',
		'/..%5cmounts.json',
		'/%2e%2e%5cmounts.json',
		'/assets/%2e%2e/%2e%2e/mounts.json',
		'/mounts.json',
		'/innocent.json',
	]) {
		const response = await fetch(path);
		const body = await response.text();
		traversal[path] = response.status + (body.includes('"mounts"') ? ' LEAKED' : '');
	}

	const first = await invoke('mount_open', { instance: 'fixture' });
	if (!first.ok) throw new Error('initial mount_open failed: ' + first.value);
	const beforeHandle = Number(first.value);
	await invoke('mount_close', { handle: beforeHandle });

	const [{ proxy, view }, copilot] = await Promise.all([runProxyAndView(), runCopilot()]);
	// Time for any delivered frame message to run before reading the counter.
	await new Promise((resolve) => setTimeout(resolve, 1000));

	const second = await invoke('mount_open', { instance: 'fixture' });
	if (!second.ok) throw new Error('post-frame mount_open failed: ' + second.value);
	const afterHandle = Number(second.value);
	await invoke('mount_close', { handle: afterHandle });

	const control = await runControl();

	await deliver({
		environment,
		capabilities: { unknownInstance, disallowed, channelFetch },
		traversal,
		frames: { beforeHandle, afterHandle, proxy, view, copilot },
		control,
	});
}

window.addEventListener('DOMContentLoaded', () => {
	void main().catch(async (error) => {
		try {
			await deliver({ error: String(error?.stack ?? error) });
		} catch {
			// Best effort.
		}
	});
});
})();
`;
}

async function waitForFile(path: string, child: ChildProcess, timeoutMs = 60_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(path)) return readFileSync(path, 'utf8');
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(
				`loam-desktop exited (code=${child.exitCode}, signal=${child.signalCode}) before writing report`
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`loam-desktop did not deliver the WKWebView barrier report within ${timeoutMs} ms`
	);
}

let dataDir = '';
let child: ChildProcess | undefined;
let report: BarrierReport;
const stderr = { lines: [] as string[], keyRefusals: 0 };

beforeAll(async () => {
	if (process.platform !== 'darwin') {
		throw new Error(`test:macos runs on macOS (darwin) only, not ${process.platform}`);
	}
	const app = binary();
	if (!existsSync(app)) {
		throw new Error(`${app} is not built: run \`pnpm -F @lushly-dev/loam-desktop build:app\``);
	}
	dataDir = await mkdtemp(join(tmpdir(), 'loam-desktop-macos-barrier-'));
	const site = join(dataDir, 'site');
	const reportPath = join(dataDir, 'barrier-report.json');
	await mkdir(join(site, 'sandbox/copilot'), { recursive: true });
	await mkdir(join(dataDir, 'webview'), { recursive: true });

	const mountsPath = join(dataDir, 'mounts.json');
	await writeFile(
		mountsPath,
		JSON.stringify({
			mounts: [
				{
					instance: 'fixture',
					transport: 'stdio',
					command: [process.execPath, REPORTER, reportPath],
					cwd: PACKAGE,
				},
			],
		})
	);
	await chmod(mountsPath, 0o600);
	symlinkSync(mountsPath, join(site, 'innocent.json'));

	await writeFile(
		join(site, 'index.html'),
		[
			'<!doctype html>',
			'<html lang="en">',
			'\t<head>',
			'\t\t<meta charset="utf-8" />',
			`\t\t<meta http-equiv="Content-Security-Policy" content="${SHELL_CSP}" />`,
			'\t\t<title>Loam WKWebView barrier probe</title>',
			'\t\t<script src="/probe-shell.js"></script>',
			'\t</head>',
			'\t<body></body>',
			'</html>',
			'',
		].join('\n')
	);
	await writeFile(join(site, 'probe-shell.js'), buildShellScript());

	await writeFile(
		join(site, 'sandbox/proxy-probe.html'),
		[
			'<!doctype html>',
			'<html lang="en">',
			'\t<head>',
			'\t\t<meta charset="utf-8" />',
			`\t\t<meta http-equiv="Content-Security-Policy" content="${PROXY_META_CSP}" />`,
			'\t\t<title>Loam proxy probe</title>',
			'\t\t<script src="proxy-probe.js"></script>',
			'\t</head>',
			'\t<body></body>',
			'</html>',
			'',
		].join('\n')
	);
	await writeFile(join(site, 'sandbox/proxy-probe.js'), buildProxyScript());

	await writeFile(
		join(site, 'sandbox/copilot/index-probe.html'),
		[
			'<!doctype html>',
			'<html lang="en">',
			'\t<head>',
			'\t\t<meta charset="utf-8" />',
			'\t\t<title>Loam copilot probe</title>',
			'\t\t<script src="probe-frame.js"></script>',
			'\t</head>',
			'\t<body></body>',
			'</html>',
			'',
		].join('\n')
	);
	await writeFile(join(site, 'sandbox/copilot/probe-frame.js'), buildCopilotFrameScript());
	await writeFile(join(site, 'sandbox/copilot/probe-worker.js'), buildCopilotWorkerScript());

	child = spawn(app, [], {
		env: { ...process.env, LOAM_DESKTOP_DATA_DIR: dataDir },
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	pipeRedactedStderr(child.stderr, stderr);

	const raw = await waitForFile(reportPath, child);
	report = JSON.parse(raw) as BarrierReport;
	if (report.error) {
		throw new Error(`WKWebView probe shell failed: ${report.error}`);
	}
	// Flush any trailing stderr line once the control's wrong-key refusal has landed.
	await new Promise((resolve) => setTimeout(resolve, 250));
	mkdirSync(RESULTS, { recursive: true });
	writeFileSync(
		join(RESULTS, 'wkwebview-barrier-darwin.json'),
		`${JSON.stringify({ platform: process.platform, stderrKeyRefusals: stderr.keyRefusals, report }, null, '\t')}\n`
	);
	process.stderr.write(
		`WKWebView barrier on ${process.platform}: ${JSON.stringify({
			stderrKeyRefusals: stderr.keyRefusals,
			environment: report.environment,
			frames: report.frames,
			control: report.control,
		})}\n`
	);
});

afterAll(async () => {
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill('SIGTERM');
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				child?.kill('SIGKILL');
				resolve();
			}, 5_000);
			child?.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
	if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('D153 & P6-D4 on macOS WKWebView', () => {
	it('runs the probe shell without error on loam://localhost under the production CSPs', () => {
		const webIndex = readFileSync(join(LOAM, 'packages/web/index.html'), 'utf8');
		const proxyHtml = readFileSync(join(LOAM, 'packages/web/public/sandbox/proxy.html'), 'utf8');
		const proxyJs = readFileSync(join(LOAM, 'packages/web/public/sandbox/proxy.js'), 'utf8');
		const baseShellCsp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
			webIndex
		)?.[1];
		const expectedShellCsp = baseShellCsp
			?.replace("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost")
			.replace("frame-src 'none'", `frame-src ${ORIGINS.sandbox}`);
		const expectedProxyCsp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
			proxyHtml
		)?.[1];
		const expectedViewInnerCsp = /const INNER_CSP =\s*"((?:[^"\\]|\\.)*)";/.exec(proxyJs)?.[1];
		expect(SHELL_CSP).toBe(expectedShellCsp);
		expect(PROXY_META_CSP).toBe(expectedProxyCsp);
		expect(VIEW_INNER_CSP).toBe(
			expectedViewInnerCsp ? JSON.parse(`"${expectedViewInnerCsp}"`) : ''
		);

		expect(report.error).toBeUndefined();
		expect(report.environment.origin).toBe(ORIGINS.shell);
		expect(report.environment.internals).toBe('object');
		expect(report.environment.shellViolations).toEqual([]);
	});

	it('P6-D4: refuses invoke of every disallowed command from the main webview and exposes no channel data', () => {
		expect(report.capabilities.unknownInstance).toEqual({
			ok: false,
			value: 'INSTANCE_UNKNOWN',
		});
		for (const [command, answer] of Object.entries(report.capabilities.disallowed)) {
			expect(answer.ok, command).toBe(false);
			expect(answer.value, command).toMatch(/not allowed|not found|denied/i);
		}
		expect(report.capabilities.channelFetch.ok).toBe(false);
		expect(report.capabilities.channelFetch.value).toMatch(
			/missing channel id header|data not found/
		);
	});

	it('P6-D4: loam://localhost answers 404 for mounts.json traversal paths and symlinks', () => {
		for (const [path, answer] of Object.entries(report.traversal)) {
			expect(answer, path).toBe('404');
		}
	});

	it('D153 & P6-D4: no message from the proxy, opaque view or copilot frame runs a Rust command', () => {
		const { beforeHandle, afterHandle, proxy, view, copilot } = report.frames;
		expect(proxy.origin).toBe(ORIGINS.sandbox);
		expect(view.origin).toBe('null');
		expect(copilot.origin).toBe('null');
		expect(copilot.worker?.started).toBe('yes');
		expect(copilot.worker?.origin).toBe('null');
		expect(copilot.worker?.internals).toBe('undefined');
		expect(copilot.worker?.webkit).toBe('undefined');
		expect(copilot.worker?.ipc).toBe('undefined');
		expect(copilot.worker?.['fetch http://ipc.localhost/mount_open']).toMatch(/^refused/);
		expect(copilot.worker?.['fetch ipc://localhost/mount_open']).toMatch(/^refused/);

		for (const [name, frame] of Object.entries({ proxy, view, copilot })) {
			// On WKWebView subframes can post to `webkit.messageHandlers.ipc`, so Tauri's main-frame-only script
			// injection (no `__TAURI_INTERNALS__` and no `window.ipc` in subframes) is what keeps the invoke key out.
			expect(frame.internals, name).toBe('undefined');
			expect(frame.posts['window.ipc'], name).toBe('absent');
			expect(frame.invoke.ok, name).toBe(false);
			expect(frame.forgedInvoke, name).not.toBe('answered');
			for (const answer of Object.values(frame.fetch)) {
				expect(answer, name).toMatch(/^refused/);
			}
		}
		// Handle counter oracle: none of the three frames ran `mount_open`.
		expect(afterHandle).toBe(beforeHandle + 1);
	});

	it('D153 & P6-D4: main-frame control proves a keyed postMessage with forged Origin runs, bare is refused and wrong key is dropped', () => {
		const { beforeHandle, afterHandle, keyed, forged, bare, unkeyed } = report.control;
		expect(keyed).toBe(true);
		expect(forged).toBe(`ok ${beforeHandle + 1}`);
		expect(bare).toBe('error "DESKTOP_ORIGIN_REFUSED"');
		expect(unkeyed).toBe('unanswered');
		expect(afterHandle).toBe(beforeHandle + 2);
		// At least the control's wrong-key post must have logged a redacted refusal on stderr, never the real key (#1448).
		expect(stderr.keyRefusals).toBeGreaterThanOrEqual(1);
		expect(stderr.lines.join('\n')).not.toMatch(/__TAURI_INVOKE_KEY__ expected (?!<key>)/);
	});
});
