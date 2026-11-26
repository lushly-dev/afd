/**
 * @fileoverview A session's runtime over its three ports (phase 5 specification, 3.2): a run arrives on the panel
 * port with the kernel's history, its events go back out on it, and it ends with one `end` message. The runtime
 * learns nothing else: a stopped run is aborted, and its later events are dropped by the kernel's half.
 */

import { AgentPort, ModelPort } from './ports.js';
import type {
	AgUiEventV1,
	AttachedContentV1,
	ContextMessageV1,
	CopilotProviderV1,
	CopilotRuntimeV1,
	RuntimePortsV1,
} from './types.js';

interface RunMessage {
	key: 'run';
	runId: string;
	threadId: string;
	text: string;
	history: ContextMessageV1[];
	attachments?: AttachedContentV1[];
	provider: CopilotProviderV1;
}

/** Serve one session's ports with `runtime`. Returns a stop, which aborts every run. */
export function serveRuntime(ports: RuntimePortsV1, runtime: CopilotRuntimeV1): () => void {
	const agent = new AgentPort(ports.agent);
	const model = new ModelPort(ports.model);
	const runs = new Map<string, AbortController>();
	const post = (message: Record<string, unknown>) => {
		try {
			ports.panel.postMessage(message);
		} catch {
			// An event that does not clone is sent as JSON.
			ports.panel.postMessage(JSON.parse(JSON.stringify(message)));
		}
	};

	async function run(message: RunMessage): Promise<void> {
		const controller = new AbortController();
		runs.set(message.runId, controller);
		let state: 'done' | 'failed' | 'limit' = 'done';
		let code: string | undefined;
		try {
			const tools = await agent.listCommands();
			const events = runtime.turn(
				{
					session: { id: message.threadId },
					runId: message.runId,
					provider: message.provider,
					history: message.history,
					text: message.text,
					...(message.attachments && message.attachments.length > 0
						? { attachments: message.attachments }
						: {}),
					tools,
				},
				{ agent, model, signal: controller.signal }
			);
			for await (const event of events) {
				if (controller.signal.aborted) break;
				post({ key: 'event', runId: message.runId, event });
				if (event.type === 'RUN_ERROR') {
					state = 'failed';
					code = typeof event.code === 'string' ? event.code : undefined;
				}
				if (event.type === 'RUN_FINISHED' && loopStopped(event)) state = 'limit';
			}
		} catch (error) {
			state = 'failed';
			code = (error as { code?: string })?.code;
		} finally {
			runs.delete(message.runId);
		}
		if (!controller.signal.aborted)
			post({ key: 'end', runId: message.runId, state, code: code ?? 'RUN_ERROR' });
	}

	ports.panel.onmessage = ({ data }) => {
		const message = (data ?? {}) as Omit<Partial<RunMessage>, 'key'> & {
			key?: string;
			runId?: string;
		};
		if (message.key === 'abort' && typeof message.runId === 'string') {
			runs.get(message.runId)?.abort();
			return;
		}
		if (message.key === 'run' && typeof message.runId === 'string') void run(message as RunMessage);
	};

	return () => {
		for (const controller of runs.values()) controller.abort();
	};
}

/** TanStack marks the last `RUN_FINISHED` of a run its loop strategy stopped (S103). */
function loopStopped(event: AgUiEventV1): boolean {
	const tanstack = (event.metadata as { tanstack?: { loopStopped?: boolean } } | undefined)
		?.tanstack;
	return event.loopStopped === true || tanstack?.loopStopped === true;
}
