/**
 * @fileoverview `webPorts`: how the kernel reaches a package from a page (phase 1 specification, 9.4).
 * `importNative` takes an absolute URL, since a relative one would resolve against this chunk, and
 * stays under `script-src 'self'`. A handler frame arrives in step 5 and a mounted transport in step 7,
 * and until then each port rejects, which the kernel reports on that app.
 */

import type { KernelPortsV1 } from '@lushly-dev/loam-kernel';

async function ok(url: string): Promise<Response> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response;
}

export function webPorts(document: Document): KernelPortsV1 {
	return {
		baseUrl: document.baseURI,
		fetchJson: async (url) => (await ok(url)).json(),
		fetchText: async (url) => (await ok(url)).text(),
		async importNative(url) {
			const module = (await import(/* @vite-ignore */ url)) as {
				default: Awaited<ReturnType<KernelPortsV1['importNative']>>;
			};
			return module.default;
		},
		openHandlerFrame: () => Promise.reject(new Error('Handler frames arrive in phase 1 step 5')),
		mountTransport: () => Promise.reject(new Error('Mounted transports arrive in phase 1 step 7')),
	};
}
