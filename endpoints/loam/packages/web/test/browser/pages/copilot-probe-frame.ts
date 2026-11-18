/**
 * P5-A2's probe script in the copilot's frame (phase 5 specification, 3.2 and 18), served as `probe-frame.js` on the
 * copilot's path under its header policy, beside the production `bootstrap.js` in the test's `index-probe.html`. Test
 * only: the production bootstrap and runtime carry no hook. It answers on the one port its parent transfers first:
 * S2's probes in the frame and in a `blob:` worker started as the bootstrap starts a runtime's, and a hostile
 * runtime's agent-port messages, sent from that worker on ports a real kernel half handed out.
 */
import { type ProbeTargets, runPathProbes, runProbes } from '../../../../copilot/test/probes.ts';

/** This script's directory, the copilot path, as the bootstrap finds it. */
const base = new URL(
	'.',
	(document.currentScript as HTMLScriptElement | null)?.src ?? location.href
).href;
const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (event) =>
	violations.push(`${event.violatedDirective} ${event.blockedURI}`)
);

/** A worker from a `blob:` URL whose only line is `importScripts` of the probe chunk on this path, as 3.2's runtime. */
function startWorker(): Worker {
	const url = URL.createObjectURL(
		new Blob([`importScripts(${JSON.stringify(new URL('probe-worker.js', base).href)});`], {
			type: 'text/javascript',
		})
	);
	return new Worker(url);
}

/** One question to a fresh worker, answered on a port of its own; the worker ends with the answer. */
function askWorker(
	message: Record<string, unknown>,
	transfer: Transferable[],
	ms: number
): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			worker = startWorker();
		} catch (error) {
			resolve({ started: `threw ${String(error)}` });
			return;
		}
		const channel = new MessageChannel();
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({ started: `no answer from the worker in ${ms} ms` });
		}, ms);
		worker.onerror = (event) => {
			clearTimeout(timer);
			worker.terminate();
			resolve({ started: `error ${event.message}` });
		};
		channel.port1.onmessage = ({ data }) => {
			clearTimeout(timer);
			worker.terminate();
			resolve({ started: 'yes', ...(data as Record<string, unknown>) });
		};
		worker.postMessage(message, [channel.port2, ...transfer]);
	});
}

let control: MessagePort | undefined;
window.addEventListener('message', (event) => {
	// Only the parent's first message, with one port: the bootstrap's launch messages carry three.
	if (event.source !== window.parent || control || event.ports.length !== 1) return;
	const targets = (event.data as { loamProbe?: ProbeTargets } | null)?.loamProbe;
	const port = event.ports[0];
	if (!targets || !port) return;
	control = port;
	port.onmessage = async ({ data, ports }) => {
		const { key } = data as { key: string };
		if (key === 'probes') {
			const frame = { ...(await runProbes('frame', targets)), ...(await runPathProbes(targets)) };
			const worker = await askWorker({ key, targets }, [], 60_000);
			port.postMessage({ key, frame, worker, violations: [...violations] });
		} else if (key === 'agent-port' && ports.length === 3) {
			port.postMessage({ key, worker: await askWorker({ key }, [...ports], 20_000) });
		}
	};
	port.postMessage({
		key: 'ready',
		origin: self.origin,
		// What the frame's document loaded: the production bootstrap and this script, and nothing else.
		scripts: Array.from(document.scripts).map((script) => script.src),
		violations: [...violations],
	});
});
