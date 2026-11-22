/**
 * P5-A2's main-frame side on the desktop (phase 5 specification, 3.2 and 18): `web`'s own copilot, the production
 * frame launcher over the kernel's port halves with the page's test provider, given hand-made runs whose agent
 * capability records every call. Beside it, the shell state S2's probes look for, and a probe frame made as the
 * launcher makes its frame (`sandbox="allow-scripts"`, on the copilot's path under its header policy), which loads
 * the production bootstrap and the test's probe script. Every answer is plain JSON data.
 */
import type { CommandResult } from '@lushly-dev/afd-core';
import type {
	CopilotAgentCapabilityV1,
	CopilotTurnOutcomeV1,
	ModelTransportV1,
	PanelEventV1,
} from '@lushly-dev/loam-kernel/copilot';
import { type ProbeTargets, SHELL_NAMES } from '../../../copilot/test/probes.ts';
import { createPageTransport, createWebCopilot } from '../../../web/src/copilot.ts';

interface Turn {
	session: string;
	runId: string;
	text: string;
	controller: AbortController;
	/** Every `settle` the host made, in order. */
	outcomes: CopilotTurnOutcomeV1[];
	/** Every agent-capability call, as `method name`. */
	calls: string[];
	events: PanelEventV1[];
}

const turns = new Map<string, Turn>();
const transport = { sends: 0, bytes: 0, providers: [] as string[] };
const refusals: string[] = [];
let shellHeard: string[] = [];

const inner = createPageTransport({ hang: [{ hang: true }] });
/** The page's transport, counting what it hands the model port. */
const counting: ModelTransportV1 = {
	async send(provider, body, signal) {
		transport.sends++;
		transport.providers.push(provider.kind);
		const answer = await inner.send(provider, body, signal);
		return {
			status: answer.status,
			body: (async function* () {
				for await (const chunk of answer.body) {
					transport.bytes += chunk.byteLength;
					yield chunk;
				}
			})(),
		};
	},
};

const copilot = createWebCopilot({
	document,
	sandboxOrigin: (window as unknown as { loamSandboxOrigin: string }).loamSandboxOrigin,
	transport: counting,
	onRefused: (port, reason) => refusals.push(`${port}: ${reason}`),
});

const refused = (message: string) =>
	({
		success: false,
		error: { code: 'COMMAND_NOT_FOUND', message, suggestion: 'None: a test stub' },
	}) as CommandResult;

/** The agent port's kernel half, as a stub: it lists no command and records every call. */
function capability(turn: Turn): CopilotAgentCapabilityV1 {
	return {
		async call(name) {
			turn.calls.push(`call ${name}`);
			return refused('The stub runs nothing');
		},
		async listCommands() {
			turn.calls.push('listCommands');
			return [];
		},
		async confirmation(notification) {
			turn.calls.push(`confirmation ${notification}`);
			return refused('The stub has no confirmation');
		},
		async refuse(reason, keys) {
			turn.calls.push(`refuse ${reason} [${keys.join(',')}]`);
			return {
				success: false,
				error: { code: 'COPILOT_PORT_REFUSED', message: reason, suggestion: 'None' },
			} as CommandResult;
		},
		// The stub hands out no unit (7.3), so it composes none.
		async unit(unit) {
			turn.calls.push(`unit ${unit}`);
			return refused('The stub hands out no unit');
		},
		composing: () => undefined,
	};
}

let runs = 0;

/** Starts a turn of `session` (16 hex digits after `cps_`) with `text`; answers its handle. */
function turn(session: string, text: string): string {
	const runId = `run_p5a2_${++runs}`;
	const held: Turn = {
		session,
		runId,
		text,
		controller: new AbortController(),
		outcomes: [],
		calls: [],
		events: [],
	};
	turns.set(runId, held);
	copilot.host.subscribe(session, (event) => {
		if (event.runId === runId) held.events.push(event);
	});
	copilot.host.start({
		session: {
			id: session,
			scope: {},
			person: 'person_p5a2',
			provider: 'test',
			title: 'P5-A2',
			taint: [],
			createdAt: Date.now(),
		},
		turn: runs,
		runId,
		provider: { id: 'test', kind: 'test', model: 'scripted' },
		history: [],
		text,
		agent: capability(held),
		settle: (outcome) => held.outcomes.push(outcome),
		signal: held.controller.signal,
	});
	return runId;
}

const until = async (check: () => boolean, ms: number) => {
	const end = performance.now() + ms;
	while (!check()) {
		if (performance.now() > end) return false;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return true;
};

function view(runId: string) {
	const held = turns.get(runId);
	return {
		outcomes: held?.outcomes ?? [],
		calls: held?.calls ?? [],
		events: (held?.events ?? []).map((event) => event.event.type),
	};
}

/** The launcher's frame, as the page holds it. */
function frame() {
	const found = document.querySelectorAll('iframe[data-loam-copilot]');
	const made = copilot.launcher.frame;
	return {
		inDocument: found.length,
		held: made !== undefined,
		connected: made?.isConnected ?? false,
		sandbox: made?.getAttribute('sandbox') ?? null,
		src: made?.getAttribute('src') ?? null,
	};
}

/** What S2's probes look for: a record, a cache, a value, a held lock and a channel, all the shell's. */
async function setupShellState(): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	try {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(SHELL_NAMES.db, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(SHELL_NAMES.store);
			request.onsuccess = () => {
				const tx = request.result.transaction(SHELL_NAMES.store, 'readwrite');
				tx.objectStore(SHELL_NAMES.store).put({ secret: 'shell-record' }, 'r1');
				tx.oncomplete = () => {
					request.result.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			request.onerror = () => reject(request.error);
		});
		out.indexedDB = 'written';
	} catch (error) {
		out.indexedDB = `failed ${String(error)}`;
	}
	try {
		localStorage.setItem(SHELL_NAMES.local, 'shell-value');
		out.localStorage = 'written';
	} catch (error) {
		out.localStorage = `failed ${String(error)}`;
	}
	try {
		await caches.open(SHELL_NAMES.cache);
		out.caches = 'opened';
	} catch (error) {
		out.caches = `failed ${String(error)}`;
	}
	try {
		void navigator.locks.request(SHELL_NAMES.lock, () => new Promise(() => {}));
		out.locks = 'held';
	} catch (error) {
		out.locks = `failed ${String(error)}`;
	}
	try {
		const channel = new BroadcastChannel(SHELL_NAMES.channel);
		shellHeard = [];
		channel.onmessage = (event) => shellHeard.push(String(event.data));
		setInterval(() => channel.postMessage('from-shell'), 50);
		out.broadcastChannel = 'posting';
	} catch (error) {
		out.broadcastChannel = `failed ${String(error)}`;
	}
	return out;
}

/** The probe frame, made as `createFrameLauncher` makes the copilot's, and the port the test speaks to it on. */
let probe:
	| { frame: HTMLIFrameElement; port: MessagePort; ready: Record<string, unknown> }
	| undefined;

async function probeFrame(targets: ProbeTargets): Promise<NonNullable<typeof probe>> {
	if (probe) return probe;
	const made = document.createElement('iframe');
	made.setAttribute('sandbox', 'allow-scripts');
	made.setAttribute('aria-hidden', 'true');
	made.setAttribute('tabindex', '-1');
	made.dataset.loamProbe = 'p5-a2';
	made.style.display = 'none';
	made.src = new URL('/sandbox/copilot/index-probe.html', targets.sandbox).href;
	const loaded = new Promise<void>((resolve) =>
		made.addEventListener('load', () => resolve(), { once: true })
	);
	document.body.append(made);
	await loaded;
	const channel = new MessageChannel();
	const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('The probe frame did not answer')), 15_000);
		channel.port1.onmessage = ({ data }) => {
			clearTimeout(timer);
			resolve(data as Record<string, unknown>);
		};
	});
	made.contentWindow?.postMessage({ loamProbe: targets }, '*', [channel.port2]);
	probe = { frame: made, port: channel.port1, ready: await ready };
	return probe;
}

/** Asks the probe frame for `key`, and answers its reply. */
async function ask(
	targets: ProbeTargets,
	key: string,
	extra: Record<string, unknown> = {},
	ms = 90_000
): Promise<Record<string, unknown>> {
	const { port } = await probeFrame(targets);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ timeout: `no ${key} answer in ${ms} ms` }), ms);
		port.onmessage = ({ data }) => {
			clearTimeout(timer);
			resolve(data as Record<string, unknown>);
		};
		port.postMessage({ key, ...extra });
	});
}

(window as unknown as { loamCopilotTest: unknown }).loamCopilotTest = {
	setupShellState,
	shellHeard: () => [...new Set(shellHeard)],
	turn,
	/** Waits up to `ms` for the turn's first outcome. */
	settled: (runId: string, ms: number) =>
		until(() => (turns.get(runId)?.outcomes.length ?? 0) > 0, ms).then(() => view(runId)),
	/** Waits up to `ms` for the transport to have been sent `sends` bodies. */
	sent: (sends: number, ms: number) =>
		until(() => transport.sends >= sends, ms).then(() => transport),
	/**
	 * Waits up to `ms` for the turn to have drawn an event of `type`. The runtime's RUN_STARTED comes once the provider's
	 * first chunk reaches it, a round trip after the request, on the panel's port.
	 */
	drawn: (runId: string, type: string, ms: number) =>
		until(() => view(runId).events.includes(type), ms).then(() => view(runId)),
	view,
	transport: () => transport,
	refusals: () => refusals,
	frame,
	reset: () => copilot.host.reset(),
	probeReady: (targets: ProbeTargets) => probeFrame(targets).then(({ ready }) => ready),
	ask,
	probeWindow: () => (probe ? probe.frame.contentWindow : null),
};
