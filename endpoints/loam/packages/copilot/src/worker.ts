/**
 * @fileoverview The runtime's worker (phase 5 specification, 3.2): started by the frame's bootstrap from a `blob:`
 * URL whose only line is `importScripts` of a runtime chunk. Each message from the bootstrap brings one session's
 * three ports. TanStack AI and every other third-party module load only here, never in the frame.
 */

import { serveRuntime } from './serve.js';
import { type AdapterFactory, createTanStackRuntime } from './tanstack.js';
import type { RuntimePortsV1 } from './types.js';

export function serveWorker(adapterFor: AdapterFactory): void {
	const runtime = createTanStackRuntime(adapterFor);
	self.addEventListener('message', (event: MessageEvent) => {
		const [agent, model, panel] = event.ports;
		if (event.ports.length !== 3 || !agent || !model || !panel) return;
		serveRuntime({ agent, model, panel } as unknown as RuntimePortsV1, runtime);
	});
}
