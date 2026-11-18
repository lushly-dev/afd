/**
 * @fileoverview The copilot a deployment names, given to the kernel and the shell at boot without loading it (phase 5
 * specification, 2: "the copilot is never in first paint"). The kernel gets the providers and a runner, the panel a
 * host, and the `copilot` chunk, with the frame's launcher, the model transport and the ports' trusted halves, loads
 * the first time a turn starts or the panel subscribes. The run id the panel's `ChatClient` chose is held here,
 * synchronously, so the kernel's `copilot-message-send` reads it whether or not the chunk has loaded.
 */

import type {
	CopilotHostV1,
	CopilotOptionsV1,
	CopilotProviderV1,
	CopilotRunnerV1,
	PanelEventV1,
} from '@lushly-dev/loam-kernel/copilot';
import type { CopilotProjectionV1 } from '@lushly-dev/loam-manifest';

/** The panel's side of the host: what the shell gives `loam-copilot-panel`. */
export interface CopilotPanelHost {
	subscribe(session: string, listener: (event: PanelEventV1) => void): () => void;
	expectRun(session: string, runId: string): void;
}

export interface LazyCopilot {
	/** The kernel's `copilot` option: the providers, never a key or an endpoint, and the runner. */
	options: CopilotOptionsV1;
	/** The panel's host. */
	panel: CopilotPanelHost;
}

/** `load` makes the real host, once, when it is first needed. */
export function lazyCopilot(
	projection: CopilotProjectionV1,
	load: () => Promise<CopilotHostV1>
): LazyCopilot {
	let loading: Promise<CopilotHostV1> | undefined;
	const host = () => {
		loading ??= load();
		return loading;
	};
	const expected = new Map<string, string>();
	const runner: CopilotRunnerV1 = {
		start(run) {
			void host().then(
				(loaded) => loaded.start(run),
				(error: unknown) => {
					reportError(error);
					run.settle({
						state: 'failed',
						reply: '',
						usage: { inputTokens: 0, outputTokens: 0 },
						failure: { code: 'RUN_ERROR' },
					});
				}
			);
		},
		reset() {
			expected.clear();
			// Nothing has run if nothing loaded: there is no frame to remove.
			void loading?.then((loaded) => loaded.reset());
		},
	};
	return {
		options: {
			providers: projection.providers as CopilotProviderV1[],
			default: projection.default,
			runner,
			takeRunId(session) {
				const runId = expected.get(session);
				expected.delete(session);
				return runId;
			},
		},
		panel: {
			subscribe(session, listener) {
				let off: (() => void) | undefined;
				let cancelled = false;
				void host().then((loaded) => {
					if (!cancelled) off = loaded.subscribe(session, listener);
				}, reportError);
				return () => {
					cancelled = true;
					off?.();
				};
			},
			expectRun(session, runId) {
				expected.set(session, runId);
			},
		},
	};
}
