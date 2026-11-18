/**
 * @fileoverview A launcher that runs the runtime in this process, over real `MessagePort`s: for the kernel's tests and
 * scenarios, which have no frame. The browser's runtime is always the frame's worker (3.2).
 */

import { anthropicAdapter } from './adapter-anthropic.js';
import { openaiAdapter } from './adapter-openai.js';
import { serveRuntime } from './serve.js';
import { createTanStackRuntime } from './tanstack.js';
import type { CopilotProviderV1, RuntimePortsV1 } from './types.js';

export interface InProcessLauncher {
	launch(kind: CopilotProviderV1['kind'], ports: RuntimePortsV1): void;
	reset(): void;
	/** How many sessions' ports it was handed. */
	readonly launched: number;
}

export function createInProcessLauncher(): InProcessLauncher {
	const anthropic = createTanStackRuntime(anthropicAdapter);
	const openai = createTanStackRuntime(openaiAdapter);
	const stops: Array<() => void> = [];
	let launched = 0;
	return {
		launch(kind, ports) {
			launched += 1;
			stops.push(
				serveRuntime(ports, kind === 'openai' || kind === 'openai-compatible' ? openai : anthropic)
			);
		},
		reset() {
			for (const stop of stops.splice(0)) stop();
		},
		get launched() {
			return launched;
		},
	};
}
