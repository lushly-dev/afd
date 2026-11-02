/**
 * @fileoverview A view app's handler frame in a page (phase 1 specification, 6.3; D61): a hidden proxy and
 * inner iframe, which the kernel reaches through `HandlerFrameV1`. The kernel decides everything: this
 * only carries messages.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { HandlerFrameV1 } from '@lushly-dev/loam-kernel';
import { ChannelError, ProxyChannel } from './channel.js';

export interface HandlerFrameOptions {
	document: Document;
	sandboxOrigin: string;
	title: string;
	html: string;
}

export function openHandlerFrame(options: HandlerFrameOptions): HandlerFrameV1 {
	const channel = new ProxyChannel(options);
	const { frame } = channel;
	frame.hidden = true;
	frame.setAttribute('aria-hidden', 'true');
	frame.setAttribute('tabindex', '-1');
	let announce!: (names: string[]) => void;
	let abandon!: (cause: Error) => void;
	const ready = new Promise<string[]>((resolve, reject) => {
		announce = resolve;
		abandon = reject;
	});
	// The kernel may close a frame it stopped waiting for.
	ready.catch(() => {});
	channel.onNotification = (method, params) => {
		if (method !== 'dev.loam/handlers-ready') return;
		const { sdk, commands } = (params ?? {}) as { sdk?: unknown; commands?: unknown };
		// Another version's frame serves nothing this kernel can call, which the kernel reports.
		announce(sdk === 1 && Array.isArray(commands) ? commands : []);
	};
	options.document.body.append(frame);
	return {
		ready,
		async call(request, signal) {
			try {
				return (await channel.request('dev.loam/handler-call', request, signal)) as CommandResult;
			} catch (cause) {
				// A frame's answer that is no result, whatever it says: the kernel reports it, without its text.
				if (cause instanceof ChannelError) return undefined as unknown as CommandResult;
				throw cause;
			}
		},
		onRequest(handler) {
			channel.onRequest = handler;
		},
		close() {
			abandon(new Error('The handler frame was closed'));
			channel.close();
		},
	};
}
