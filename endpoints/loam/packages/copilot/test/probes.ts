/**
 * P5-A2's probes (phase 5 specification, 0.3's S2 as a test). They run in the copilot frame and in its worker: what of the
 * shell's storage they reach, and whether they can open a connection of their own. Each answer is text.
 */
export interface ProbeTargets {
	/** The shell's origin, e.g. `http://loam.localhost`. */
	shell: string;
	/** The sandbox's origin. */
	sandbox: string;
	/** An HTTP listener the test watches for any request that arrives. */
	listener: string;
	/** The same listener as a WebSocket URL. */
	listenerWs: string;
	/** Extra URLs to fetch (the desktop's IPC endpoints). */
	extra?: string[];
}

export const SHELL_NAMES = {
	db: 'loam-test-shell',
	store: 'shell-records',
	lock: 'loam-test-shell-lock',
	channel: 'loam-test-shell',
	cache: 'loam-test-shell',
	local: 'loam-test-shell',
} as const;

const name = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 160) : String(error);

function timeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T | string> {
	return Promise.race([
		promise,
		new Promise<string>((resolve) => setTimeout(() => resolve(label), ms)),
	]);
}

async function idb(): Promise<string> {
	if (typeof indexedDB === 'undefined') return 'absent';
	const out: string[] = [];
	try {
		const listed = await timeout(
			indexedDB.databases().then((dbs) => dbs.map((db) => db.name).join(',') || '(none)'),
			2_000
		);
		out.push(`databases=[${listed}]`);
	} catch (error) {
		out.push(`databases threw ${name(error)}`);
	}
	try {
		const opened = await timeout(
			new Promise<string>((resolve) => {
				const request = indexedDB.open(SHELL_NAMES.db);
				request.onsuccess = () => {
					const stores = Array.from(request.result.objectStoreNames);
					request.result.close();
					resolve(`opened stores=[${stores.join(',')}]`);
				};
				request.onerror = () => resolve(`open error ${name(request.error)}`);
				request.onblocked = () => resolve('open blocked');
			}),
			3_000
		);
		out.push(opened);
	} catch (error) {
		out.push(`open threw ${name(error)}`);
	}
	return out.join('; ');
}

async function cacheStorage(): Promise<string> {
	if (typeof caches === 'undefined') return 'absent';
	try {
		const keys = await timeout(caches.keys(), 2_000);
		return `keys=[${Array.isArray(keys) ? keys.join(',') : keys}]`;
	} catch (error) {
		return `threw ${name(error)}`;
	}
}

function local(): string {
	if (typeof localStorage === 'undefined' && typeof document === 'undefined')
		return 'absent (worker)';
	try {
		return `read ${JSON.stringify(localStorage.getItem(SHELL_NAMES.local))}`;
	} catch (error) {
		return `threw ${name(error)}`;
	}
}

function cookie(): string {
	if (typeof document === 'undefined') return 'absent (worker)';
	try {
		return `read ${JSON.stringify(document.cookie)}`;
	} catch (error) {
		return `threw ${name(error)}`;
	}
}

async function locks(): Promise<string> {
	const manager = (navigator as Navigator & { locks?: LockManager }).locks;
	if (!manager) return 'absent';
	const out: string[] = [];
	try {
		const state = await timeout(manager.query(), 2_000);
		out.push(
			typeof state === 'string'
				? `query ${state}`
				: `held=[${(state.held ?? []).map((lock) => lock.name).join(',')}]`
		);
	} catch (error) {
		out.push(`query threw ${name(error)}`);
	}
	try {
		const granted = await timeout(
			manager.request(SHELL_NAMES.lock, { ifAvailable: true }, async (lock) =>
				lock ? 'granted (not the shell lock)' : 'unavailable (SHELL LOCK SEEN)'
			),
			2_000
		);
		out.push(String(granted));
	} catch (error) {
		out.push(`request threw ${name(error)}`);
	}
	return out.join('; ');
}

async function broadcast(where: string): Promise<string> {
	if (typeof BroadcastChannel === 'undefined') return 'absent';
	try {
		const channel = new BroadcastChannel(SHELL_NAMES.channel);
		const heard: string[] = [];
		channel.onmessage = (event) => heard.push(String(event.data));
		for (let i = 0; i < 5; i++) {
			channel.postMessage(`from-${where}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		channel.close();
		return heard.length ? `HEARD ${[...new Set(heard)].join(',')}` : 'heard nothing';
	} catch (error) {
		return `threw ${name(error)}`;
	}
}

async function fetchOne(url: string): Promise<string> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3_000);
		const response = await fetch(url, { signal: controller.signal, mode: 'no-cors' });
		clearTimeout(timer);
		return `ANSWERED ${response.status} ${response.type}`;
	} catch (error) {
		return `refused ${name(error)}`;
	}
}

function xhr(url: string): Promise<string> {
	return new Promise((resolve) => {
		try {
			const request = new XMLHttpRequest();
			request.open('GET', url);
			request.onload = () => resolve(`ANSWERED ${request.status}`);
			request.onerror = () => resolve('refused (error event)');
			request.send();
			setTimeout(() => resolve('timeout'), 3_000);
		} catch (error) {
			resolve(`refused ${name(error)}`);
		}
	});
}

function socket(url: string): Promise<string> {
	return new Promise((resolve) => {
		try {
			const ws = new WebSocket(url);
			ws.onopen = () => {
				ws.close();
				resolve('OPENED');
			};
			ws.onerror = () => resolve('refused (error event)');
			setTimeout(() => resolve('timeout'), 3_000);
		} catch (error) {
			resolve(`refused ${name(error)}`);
		}
	});
}

async function tauri(): Promise<string> {
	const internals = (
		globalThis as {
			__TAURI_INTERNALS__?: { invoke?(command: string, args: unknown): Promise<unknown> };
		}
	).__TAURI_INTERNALS__;
	if (typeof internals?.invoke !== 'function') return `no invoke (internals ${typeof internals})`;
	try {
		const answer = await timeout(
			internals.invoke('mount_open', { instance: 'missing' }),
			4_000,
			'unanswered'
		);
		return answer === 'unanswered'
			? 'invoke unanswered'
			: `INVOKE ANSWERED ${JSON.stringify(answer)}`;
	} catch (error) {
		return `invoke rejected: ${String(error).slice(0, 160)}${String(error).includes('INSTANCE_UNKNOWN') ? ' (COMMAND RAN)' : ''}`;
	}
}

function importOther(targets: ProbeTargets): Record<string, string> {
	const out: Record<string, string> = {};
	const scope = globalThis as unknown as {
		importScripts?: (...urls: string[]) => void;
		loamTestImported?: string;
	};
	if (typeof scope.importScripts !== 'function') return { importScripts: 'absent (frame)' };
	for (const [label, url] of [
		['importScripts shell origin', `${targets.shell}/assets/test-import.js`],
		['importScripts listener', `${targets.listener}/import.js`],
		['importScripts own sandbox origin', `${targets.sandbox}/sandbox/copilot/probe-import.js`],
	] as const) {
		scope.loamTestImported = undefined;
		try {
			scope.importScripts(url);
			out[label] = `LOADED ${scope.loamTestImported ?? '(ran, no marker)'}`;
		} catch (error) {
			out[label] = `refused ${name(error)}`;
		}
	}
	return out;
}

/** Every probe, in this global (the frame or the worker). */
export async function runProbes(
	where: string,
	targets: ProbeTargets
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const safe = async (label: string, probe: () => unknown) => {
		try {
			out[label] = String(await probe());
		} catch (error) {
			out[label] = `threw ${name(error)}`;
		}
	};
	await safe('origin', () => (globalThis as { origin?: string }).origin);
	await safe('indexedDB', idb);
	await safe('caches', cacheStorage);
	await safe('localStorage', local);
	await safe('cookie', cookie);
	await safe('locks', locks);
	await safe('broadcastChannel', () => broadcast(where));
	await safe(
		'RTCPeerConnection',
		() => typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
	);
	for (const url of [
		`${targets.listener}/fetch-${where}`,
		`${targets.shell}/`,
		`${targets.sandbox}/sandbox/copilot/probe-import.js`,
		'https://example.com/',
		...(targets.extra ?? []),
	])
		await safe(`fetch ${url}`, () => fetchOne(url));
	await safe(`xhr ${targets.listener}`, () => xhr(`${targets.listener}/xhr-${where}`));
	await safe(`websocket ${targets.listenerWs}`, () => socket(`${targets.listenerWs}/ws-${where}`));
	try {
		Object.assign(out, importOther(targets));
	} catch (error) {
		out.importScripts = `threw ${name(error)}`;
	}
	await safe('tauri', tauri);
	return out;
}

/** A script outside the copilot's path on the sandbox origin, which a test serves to show the policy holds the path. */
export const OUTSIDE_SCRIPT = '/sandbox/probe-outside.js';

/**
 * Whether the policy holds the copilot's path and not the whole sandbox origin (phase 5 specification, 3.2): a script
 * the test serves at {@link OUTSIDE_SCRIPT}, which sets `loamTestImported` to `outside`, loaded by `importScripts` in a
 * worker or by a `<script>` element in the frame. `LOADED` means the origin form is in force.
 */
export async function runPathProbes(targets: ProbeTargets): Promise<Record<string, string>> {
	const url = `${targets.sandbox}${OUTSIDE_SCRIPT}`;
	const scope = globalThis as unknown as {
		importScripts?: (...urls: string[]) => void;
		loamTestImported?: string;
	};
	scope.loamTestImported = undefined;
	if (typeof scope.importScripts === 'function') {
		try {
			scope.importScripts(url);
			return { 'importScripts outside the copilot path': `LOADED ${scope.loamTestImported}` };
		} catch (error) {
			return { 'importScripts outside the copilot path': `refused ${name(error)}` };
		}
	}
	const loaded = await timeout(
		new Promise<string>((resolve) => {
			const script = document.createElement('script');
			script.src = url;
			script.onload = () => resolve(`LOADED ${scope.loamTestImported ?? '(ran, no marker)'}`);
			script.onerror = () => resolve('refused (error event)');
			document.head.append(script);
		}),
		3_000
	);
	return { 'script outside the copilot path': String(loaded) };
}
