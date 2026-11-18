/**
 * P5-A2's probe script in the copilot's frame (phase 5 specification, 3.2 and 18), served as `probe-frame.js` on the
 * copilot's path under its header policy, beside the production `bootstrap.js` in `index-probe.html`. Test only: the
 * production bootstrap and runtime carry no hook. It answers on a port its parent transfers: S2's probes in the frame
 * and in a `blob:` worker started as the bootstrap starts the runtime's, the IPC posts of D153, and a `window` message
 * to its parent.
 */
import { type ProbeTargets, runPathProbes, runProbes } from '../../../copilot/test/probes.ts';

/** This script's directory, the copilot path, as the bootstrap finds it. */
const base = new URL(
	'.',
	(document.currentScript as HTMLScriptElement | null)?.src ?? location.href
).href;
const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (event) =>
	violations.push(`${event.violatedDirective} ${event.blockedURI}`)
);

/** S2's probes in a worker started from a `blob:` URL whose only line is `importScripts` of a chunk on this path. */
function workerProbes(targets: ProbeTargets): Promise<Record<string, string>> {
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			const url = URL.createObjectURL(
				new Blob([`importScripts(${JSON.stringify(new URL('probe-worker.js', base).href)});`], {
					type: 'text/javascript',
				})
			);
			worker = new Worker(url);
		} catch (error) {
			resolve({ started: `threw ${String(error)}` });
			return;
		}
		const channel = new MessageChannel();
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({ started: 'no answer from the worker in 60 s' });
		}, 60_000);
		worker.onerror = (event) => {
			clearTimeout(timer);
			resolve({ started: `error ${event.message}` });
		};
		channel.port1.onmessage = ({ data }) => {
			clearTimeout(timer);
			worker.terminate();
			resolve({ started: 'yes', ...(data as Record<string, string>) });
		};
		worker.postMessage({ targets }, [channel.port2]);
	});
}

/**
 * D153's posts: `mount_open` through Tauri's `invoke` with the shell's `Origin` forged, and raw IPC messages with a
 * forged key through `window.ipc`, `chrome.webview` and `webkit.messageHandlers.ipc`. Their answers prove nothing (the
 * fallback answers by `eval` in the top-level document); the main frame's handle counter is the oracle.
 */
async function ipc(shell: string): Promise<Record<string, string>> {
	const page = window as unknown as {
		__TAURI_INTERNALS__?: {
			invoke?(command: string, args: unknown, options: unknown): Promise<unknown>;
		};
		ipc?: { postMessage?(message: string): void };
		chrome?: { webview?: { postMessage?(message: string): void } };
		webkit?: { messageHandlers?: { ipc?: { postMessage?(message: string): void } } };
	};
	const found: Record<string, string> = {};
	const headers = { Origin: shell };
	const internals = page.__TAURI_INTERNALS__;
	found.internals = typeof internals;
	if (typeof internals?.invoke === 'function') {
		try {
			await Promise.race([
				internals.invoke('mount_open', { instance: 'fixture' }, { headers }),
				new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), 4_000)),
			]);
			found.invoke = 'answered';
		} catch (error) {
			found.invoke = String(error).slice(0, 160);
		}
	} else found.invoke = 'no invoke';
	const message = JSON.stringify({
		cmd: 'mount_open',
		callback: 1,
		error: 2,
		payload: { instance: 'fixture' },
		options: { headers },
		__TAURI_INVOKE_KEY__: 'forged',
	});
	const posts: Array<[string, ((message: string) => void) | undefined]> = [
		['window.ipc', page.ipc?.postMessage?.bind(page.ipc)],
		['chrome.webview', page.chrome?.webview?.postMessage?.bind(page.chrome.webview)],
		[
			'webkit.messageHandlers.ipc',
			page.webkit?.messageHandlers?.ipc?.postMessage?.bind(page.webkit.messageHandlers.ipc),
		],
	];
	for (const [name, post] of posts) {
		if (!post) {
			found[name] = 'absent';
			continue;
		}
		try {
			post(message);
			found[name] = 'posted';
		} catch (error) {
			found[name] = `threw ${(error as Error).name}`;
		}
	}
	// Time for a delivered message to run before the main frame counts.
	await new Promise((resolve) => setTimeout(resolve, 1_000));
	return found;
}

/** What a hostile runtime could post to its parent's `window`: a port's call, a run's end, and three ports. */
function postParent(runId: string): string[] {
	const sent: string[] = [];
	const post = (label: string, data: unknown, transfer: Transferable[] = []) => {
		try {
			window.parent.postMessage(data, '*', transfer);
			sent.push(label);
		} catch (error) {
			sent.push(`${label} threw ${String(error)}`);
		}
	};
	post('call', { id: 1, key: 'call', name: 'mount_open', input: { instance: 'fixture' } });
	post('end', { key: 'end', runId, state: 'done', code: 'RUN_ERROR' });
	post('event', {
		key: 'event',
		runId,
		event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'from the window' },
	});
	const channels = [new MessageChannel(), new MessageChannel(), new MessageChannel()];
	post(
		'ports',
		{ kind: 'test' },
		channels.map((channel) => channel.port2)
	);
	return sent;
}

let control: MessagePort | undefined;
window.addEventListener('message', (event) => {
	// Only the parent's first message, with one port: the bootstrap's launch messages carry three.
	if (event.source !== window.parent || control || event.ports.length !== 1) return;
	const targets = (event.data as { loamProbe?: ProbeTargets } | null)?.loamProbe;
	const port = event.ports[0];
	if (!targets || !port) return;
	control = port;
	port.onmessage = async ({ data }) => {
		const { key, runId } = data as { key: string; runId?: string };
		if (key === 'probes') {
			const frame = { ...(await runProbes('frame', targets)), ...(await runPathProbes(targets)) };
			const worker = await workerProbes(targets);
			port.postMessage({ key, frame, worker, violations: [...violations] });
		} else if (key === 'ipc') {
			port.postMessage({ key, found: await ipc(targets.shell) });
		} else if (key === 'post-parent') {
			port.postMessage({ key, sent: postParent(runId ?? '') });
		}
	};
	port.postMessage({
		key: 'ready',
		origin: self.origin,
		// What the frame's document loaded: the production bootstrap and this script, and nothing else.
		resources: performance.getEntriesByType('resource').map((entry) => entry.name),
		scripts: Array.from(document.scripts).map((script) => script.src),
		violations: [...violations],
	});
});
