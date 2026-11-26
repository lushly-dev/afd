/**
 * @fileoverview The desktop's inbound endpoint in the page (phase 6 specification, 10.8), in a chunk of its own that
 * only the desktop loads, once stage B has: never in first paint, and never in a browser.
 *
 * The Rust host passes each message its loopback endpoint accepted as a `loam:inbound` DOM event, `{ id, message }` for
 * a request and `{ message }` for a notification. The kernel's inbound dispatcher answers it, and the answer goes back
 * through the fourth IPC command, `inbound_reply { id, message }`. Once the dispatcher is ready, `inbound_reply
 * { ready: true }` tells the host to stop answering `503`. The message is untrusted data: it reaches the kernel only as
 * a JSON-RPC message the dispatcher parses, and its calls run on the agent interface as `loam-inbound`.
 */

import type { KernelParts } from '@lushly-dev/loam-kernel';
import { createInboundDispatcher, type InboundResponseV1 } from '@lushly-dev/loam-kernel/inbound';
import { captureDesktopInvoke, type DesktopInvoke } from './desktop-ipc.js';

/** The event's name on `window`, as the Rust host dispatches it. */
export const INBOUND_EVENT = 'loam:inbound';

/**
 * How often the page asks again while the host refuses its `ready` (a page load under way): quickly at first, then, past
 * `READY_TRIES`, once every `READY_SLOW_MS` with the delay reported once, since on WKWebView a load that fails after its
 * commit never sends the `Finished` that ends the refusal.
 */
export const READY_RETRY_MS = 100;
export const READY_TRIES = 300;
export const READY_SLOW_MS = 2_000;

/**
 * Answers the Rust host's inbound events from `parts`' kernel, and says it is ready, asking again while the host refuses
 * (a page load is under way, and the `ready` might be the outgoing page's). A kernel whose stage B failed says nothing,
 * so the endpoint keeps answering `503`. Resolves to the listener's removal. Does nothing where no Tauri IPC is in the
 * page.
 */
export async function startInbound(
	target: Window,
	parts: Pick<KernelParts, 'kernel' | 'inboundCommands'>,
	report: (error: unknown) => void = reportError,
	wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	invoke: DesktopInvoke | null = captureDesktopInvoke(target)
): Promise<() => void> {
	if (!invoke || parts.kernel.lateFailure) return () => {};
	const dispatcher = createInboundDispatcher({
		agent: parts.kernel.agent,
		commands: () => parts.inboundCommands(),
	});
	const reply = (id: number, message: InboundResponseV1) =>
		invoke('inbound_reply', { id, message });
	const listener = (event: Event) => {
		const detail = (event as CustomEvent<unknown>).detail as { id?: unknown; message?: unknown };
		if (typeof detail !== 'object' || detail === null) return;
		const { id, message } = detail;
		// The host's own id, never the client's: an integer it issued, which it checks again.
		const issued = Number.isSafeInteger(id) && (id as number) > 0 ? (id as number) : undefined;
		const requestId = (message as { id?: unknown } | null)?.id;
		const failed = (code: number, words: string): InboundResponseV1 => ({
			jsonrpc: '2.0',
			id: typeof requestId === 'string' || typeof requestId === 'number' ? requestId : null,
			error: { code, message: words },
		});
		void dispatcher
			.handle(message)
			.catch((error: unknown) => {
				report(error);
				// A request is always answered, never left to the host's 60 s.
				return failed(-32603, 'Loam could not answer');
			})
			.then((answer) => {
				if (issued === undefined) return;
				return reply(issued, answer ?? failed(-32600, 'Send one JSON-RPC request'));
			})
			.catch(report);
	};
	target.addEventListener(INBOUND_EVENT, listener);
	void (async () => {
		for (let tries = 0; ; tries++) {
			if ((await invoke('inbound_reply', { ready: true })) !== false) return;
			if (tries === READY_TRIES)
				report(
					new Error(
						"The desktop host refused the inbound endpoint's ready for 30 s; still asking every 2 s"
					)
				);
			await wait(tries < READY_TRIES ? READY_RETRY_MS : READY_SLOW_MS);
		}
	})().catch(report);
	return () => target.removeEventListener(INBOUND_EVENT, listener);
}
