/**
 * @fileoverview `webPorts`: how the kernel reaches a package from a page (phase 1 specification, 9.4).
 * `importNative` takes an absolute URL, since a relative one would resolve against this chunk, and
 * stays under `script-src 'self'`. A handler frame is the chrome's, in the view chunk, which only a call
 * of a view app's command loads. A mounted transport is in the `mount` chunk, which loads only when a
 * deployment's mounted instance is discovered, after first paint (7.3).
 */

import type { HandlerFrameV1, KernelPortsV1, MountTransportV2 } from '@lushly-dev/loam-kernel';

/** What the chrome's view chunk gives this port. */
export interface ViewChunk {
	openHandlerFrame(options: {
		document: Document;
		sandboxOrigin: string;
		title: string;
		html: string;
	}): HandlerFrameV1;
}

/** What the `mount` chunk gives this port. */
export interface MountChunk {
	createMountTransport(url: string): MountTransportV2;
}

async function ok(url: string): Promise<Response> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response;
}

/** `base` is the deployment's root, absolute, which every relative URL a port receives resolves against. */
export function webPorts(
	document: Document,
	base: string,
	sandboxOrigin: string | null,
	loadView: () => Promise<ViewChunk>,
	loadMount: () => Promise<MountChunk>
): KernelPortsV1 {
	return {
		baseUrl: base,
		fetchJson: async (url) => (await ok(url)).json(),
		fetchText: async (url) => (await ok(url)).text(),
		async importNative(url) {
			const module = (await import(/* @vite-ignore */ url)) as {
				default: Awaited<ReturnType<KernelPortsV1['importNative']>>;
			};
			return module.default;
		},
		async openHandlerFrame(instance, html) {
			if (!sandboxOrigin) throw new Error('This deployment has no sandbox origin');
			const { openHandlerFrame } = await loadView();
			return openHandlerFrame({ document, sandboxOrigin, title: `${instance} handlers`, html });
		},
		async mountTransport(_entry, url) {
			return (await loadMount()).createMountTransport(url);
		},
	};
}
