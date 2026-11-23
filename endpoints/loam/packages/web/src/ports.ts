/**
 * @fileoverview `webPorts`: how the kernel reaches a package from a page (phase 1 specification, 9.4).
 * `importNative` takes an absolute URL, since a relative one would resolve against this chunk, and
 * stays under `script-src 'self'`. A handler frame is the chrome's, in the view chunk, which only a call
 * of a view app's command loads. A mounted transport is in the `mount` chunk, which loads only when a
 * deployment's mounted instance is discovered, after first paint (7.3).
 */

import type {
	FrameAdmitV1,
	HandlerFrameV1,
	KernelPortsV1,
	MountTransportV2,
} from '@lushly-dev/loam-kernel';

/** What the chrome's view chunk gives this port. */
export interface ViewChunk {
	openHandlerFrame(options: {
		document: Document;
		sandboxOrigin: string;
		title: string;
		html: string;
		admit?: FrameAdmitV1;
	}): HandlerFrameV1;
}

/** What the `mount` chunk gives this port. */
export interface MountChunk {
	createMountTransport(url: string): MountTransportV2;
	/** The desktop's, over the Rust host by instance (phase 6 specification, 10.4). */
	createDesktopMountTransport(instance: string, options?: { era?: 'modern' }): MountTransportV2;
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
	loadMount: () => Promise<MountChunk>,
	desktop = false
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
		async openHandlerFrame(instance, html, admit) {
			if (!sandboxOrigin) throw new Error('This deployment has no sandbox origin');
			const { openHandlerFrame } = await loadView();
			return openHandlerFrame({
				document,
				sandboxOrigin,
				title: `${instance} handlers`,
				html,
				...(admit ? { admit } : {}),
			});
		},
		async mountTransport(entry, url) {
			const chunk = await loadMount();
			return desktop
				? chunk.createDesktopMountTransport(
						entry.instance,
						// The era that carries a person's approval, for an instance that releases commands, over `stdio` or `http`: the
						// Rust host sends the era's headers on `http` (phase 5, 7.2; #2137).
						(entry as { approvals?: unknown }).approvals === 'shell' ? { era: 'modern' } : {}
					)
				: chunk.createMountTransport(url);
		},
	};
}
