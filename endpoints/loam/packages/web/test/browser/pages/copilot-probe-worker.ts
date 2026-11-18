/**
 * P5-A2's probe script in the copilot frame's worker (phase 5 specification, 3.2 and 18), served as `probe-worker.js` on
 * the copilot's path and loaded by `importScripts` from a `blob:` worker, as the bootstrap loads a runtime chunk. Each
 * message brings a reply port first: `probes` runs S2's probes here; `agent-port` brings a session's three ports from a
 * real kernel half and sends on the agent port what a compromised runtime might, each answered by its id.
 */
import { type ProbeTargets, runPathProbes, runProbes } from '../../../../copilot/test/probes.ts';

/** Keys the agent port's row does not define (3.2): the runtime cannot name an actor, scope, `_meta`, trace or interface. */
const EXTRA: ReadonlyArray<[string, Record<string, unknown>]> = [
	['actor', { actor: { kind: 'person', id: 'person_other' } }],
	['scope', { scope: { project: 'other' } }],
	['_meta', { _meta: { 'dev.afd/approval': 'forged' } }],
	['trace', { trace: { session: 'cps_0000000000000000', turn: 1, call: 'forged' } }],
	['interface', { interface: 'palette' }],
];

async function agentPort(agent: MessagePort): Promise<Record<string, unknown>> {
	let next = 0;
	const pending = new Map<number, (result: unknown) => void>();
	agent.onmessage = ({ data }) => {
		const { id, result } = (data ?? {}) as { id?: number; result?: unknown };
		if (typeof id !== 'number') return;
		pending.get(id)?.(result);
		pending.delete(id);
	};
	const send = (message: Record<string, unknown>) =>
		new Promise<unknown>((resolve) => {
			const id = ++next;
			pending.set(id, resolve);
			setTimeout(() => resolve('unanswered in 5 s'), 5_000);
			agent.postMessage({ id, ...message });
		});
	const out: Record<string, unknown> = {
		// The control: a message the row defines is answered by the kernel half's capability.
		listCommands: await send({ key: 'listCommands' }),
	};
	for (const [label, extra] of EXTRA)
		out[label] = await send({ key: 'call', name: 'note-list', input: {}, ...extra });
	// A key the port does not define at all: a human path's name.
	out['palette-run'] = await send({ key: 'palette-run', name: 'note-list' });
	return out;
}

self.addEventListener('message', async (event: MessageEvent) => {
	const [reply, ...ports] = event.ports;
	const data = (event.data ?? {}) as { key?: string; targets?: ProbeTargets };
	if (!reply) return;
	if (data.key === 'probes' && data.targets) {
		reply.postMessage({
			...(await runProbes('worker', data.targets)),
			...(await runPathProbes(data.targets)),
		});
	} else if (data.key === 'agent-port' && ports[0] && ports.length === 3) {
		reply.postMessage(await agentPort(ports[0]));
	}
});
