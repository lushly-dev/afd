/**
 * P5-A2's probe script in the copilot frame's worker (phase 5 specification, 3.2 and 18), served as `probe-worker.js`
 * on the copilot's path and loaded by `importScripts` from a `blob:` worker, as the bootstrap loads a runtime chunk. It
 * runs S2's probes, and whether a script on the sandbox origin outside the copilot's path loads, once, and answers
 * on the port the frame transfers.
 */
import { type ProbeTargets, runPathProbes, runProbes } from '../../../copilot/test/probes.ts';

self.addEventListener('message', async (event: MessageEvent) => {
	const [port] = event.ports;
	const targets = (event.data as { targets?: ProbeTargets } | null)?.targets;
	if (!port || !targets) return;
	port.postMessage({ ...(await runProbes('worker', targets)), ...(await runPathProbes(targets)) });
});
