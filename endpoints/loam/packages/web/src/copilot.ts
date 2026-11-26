/**
 * @fileoverview The web host's copilot (phase 5 specification, 3.1 and 3.2), in a chunk of its own that loads when
 * the first turn starts: the runtime's opaque-origin frame on the sandbox origin, the model transport, and the
 * kernel's port halves over them. The main frame never acts on a `window` message from the frame: it adds no
 * listener for one, and reaches the frame only through the three ports it transfers per session.
 */

import { createTestProvider, type ModelScriptV1 } from '@lushly-dev/loam-copilot/test-provider';
import {
	type CopilotHostV1,
	type CopilotProviderV1,
	createCopilotHost,
	type ModelTransportV1,
	type RuntimeLauncherV1,
} from '@lushly-dev/loam-kernel/copilot';
import { captureDesktopInvoke, type DesktopInvoke } from './desktop-ipc.js';

/** The frame's document on the sandbox origin (3.2): its `copilot/` path, which its own policy names. */
export const COPILOT_FRAME_PATH = '/sandbox/copilot/index.html';

export interface FrameLauncher extends RuntimeLauncherV1 {
	/** The frame, while it exists. */
	readonly frame: HTMLIFrameElement | undefined;
}

/**
 * One hidden frame per shell window (3.2), `sandbox="allow-scripts"` with no `allow-same-origin`, so it and its
 * workers have an opaque origin and share no storage with the shell. Each session's ports are transferred to it
 * once it has loaded; `reset` removes it, ending every runtime in it.
 */
export function createFrameLauncher(document: Document, sandboxOrigin: string): FrameLauncher {
	let frame: HTMLIFrameElement | undefined;
	let loaded: Promise<HTMLIFrameElement> | undefined;
	function open(): Promise<HTMLIFrameElement> {
		if (loaded && frame) return loaded;
		const made = document.createElement('iframe');
		made.setAttribute('sandbox', 'allow-scripts');
		made.setAttribute('aria-hidden', 'true');
		made.setAttribute('tabindex', '-1');
		made.title = 'Copilot runtime';
		made.dataset.loamCopilot = 'runtime';
		made.style.display = 'none';
		made.src = new URL(COPILOT_FRAME_PATH, sandboxOrigin).href;
		frame = made;
		loaded = new Promise((resolve) => {
			made.addEventListener('load', () => resolve(made), { once: true });
		});
		document.body.append(made);
		return loaded;
	}
	return {
		get frame() {
			return frame;
		},
		launch(kind, ports) {
			void open().then((opened) => {
				// The frame may have been removed while it loaded: its ports then go nowhere.
				if (opened !== frame) return;
				// An opaque origin matches no target origin but `*`; the window is the one this page created.
				opened.contentWindow?.postMessage({ kind }, '*', [
					ports.agent as unknown as MessagePort,
					ports.model as unknown as MessagePort,
					ports.panel as unknown as MessagePort,
				]);
			});
		},
		reset() {
			frame?.remove();
			frame = undefined;
			loaded = undefined;
		},
	};
}

/**
 * The model transport of a page (4.2): the test provider for `kind = "test"`, the only kind a static deployment may
 * name. A real provider is the trusted host's: the desktop's `model_send` (step 2) or the hosted server's route
 * (milestone C), so any other kind is refused here.
 */
export function createPageTransport(
	scripts: Readonly<Record<string, ModelScriptV1>> = {}
): ModelTransportV1 {
	const test = createTestProvider({ scripts });
	return {
		async send(provider, body, signal) {
			if (provider.kind !== 'test') {
				throw Object.assign(new Error(`No model transport for '${provider.kind}' in this host`), {
					code: 'COPILOT_PROVIDER_UNKNOWN',
				});
			}
			return test.send(body, signal);
		},
	};
}

/** A refusal with a code and Loam's words alone: never a provider's, the body's or the host's. */
function modelFailure(code: string): Error & { code: string } {
	return Object.assign(new Error(code), { code });
}

/** One `loam:model` event's detail, as the Rust host sends it (4.2). */
type ModelEvent =
	| { stream: number; status: number }
	| { stream: number; chunk: string }
	| { stream: number; done: true; status: number; code?: string };

/** The detail when it has exactly one of the three shapes, else undefined: anything else is dropped. */
export function modelEventOf(detail: unknown): ModelEvent | undefined {
	if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
	const { stream, status, chunk, done, code, ...rest } = detail as Record<string, unknown>;
	if (Object.keys(rest).length > 0 || !Number.isSafeInteger(stream)) return undefined;
	const id = stream as number;
	const statusOk =
		Number.isSafeInteger(status) && (status as number) >= 0 && (status as number) < 1000;
	if (done === true && statusOk && chunk === undefined) {
		if (code !== undefined && (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)))
			return undefined;
		return { stream: id, done: true, status: status as number, ...(code ? { code } : {}) };
	}
	if (done !== undefined || code !== undefined) return undefined;
	if (typeof chunk === 'string' && status === undefined) return { stream: id, chunk };
	if (statusOk && chunk === undefined) return { stream: id, status: status as number };
	return undefined;
}

/** A stream id the page names: a random safe integer, so no two of a run, or of two page loads, meet. */
function streamId(): number {
	const [high, low] = crypto.getRandomValues(new Uint32Array(2)) as unknown as [number, number];
	const id = (high & 0x1f_ffff) * 2 ** 32 + low;
	// At most 2 ** 53 - 1, the largest safe integer and the host's bound; never 0, which the host refuses.
	return id === 0 ? 1 : id;
}

/**
 * The desktop's model transport (4.2): the Rust host's `model_send` and `model_cancel`. The page names a provider id,
 * the body and the stream id it listens on; the Rust host holds the key and the endpoint, builds the request, and
 * sends the answer back as `loam:model` events on `window`: `{ stream, status }` when its headers arrive,
 * `{ stream, chunk }` for its text, and `{ stream, done, status, code? }` at its end. The page listens before it
 * asks, so it hears every event of its stream, and drops every other. A stream past its bounds, or one the network
 * ended, throws with its code; a provider's refusal (`4xx`) is its status alone, which the runtime reads. A stream
 * the page stops reading before its end, whatever stopped it, is cancelled at the host, so it spends nothing more.
 */
export function createDesktopModelTransport(
	target: Window = window,
	invoke: DesktopInvoke | null = captureDesktopInvoke(target)
): ModelTransportV1 {
	const queues = new Map<number, (event: ModelEvent) => void>();
	target.addEventListener('loam:model', (event) => {
		const detail = modelEventOf((event as CustomEvent).detail);
		if (detail) queues.get(detail.stream)?.(detail);
	});
	const requireInvoke = (): DesktopInvoke => {
		if (!invoke) throw modelFailure('MODEL_UNREACHABLE');
		return invoke;
	};
	return {
		async send(provider, body, signal) {
			if (signal.aborted) throw modelFailure('MODEL_UNREACHABLE');
			const stream = streamId();
			const waiting: ModelEvent[] = [];
			let wake: (() => void) | undefined;
			let stopped = false;
			/** Whether the host said the stream ended: until then, stopping cancels it there. */
			let finished = false;
			const stop = () => {
				if (stopped) return;
				stopped = true;
				queues.delete(stream);
				signal.removeEventListener('abort', stop);
				if (!finished)
					void Promise.resolve()
						.then(() => requireInvoke()('model_cancel', { stream }))
						.catch(() => undefined);
				wake?.();
			};
			queues.set(stream, (event) => {
				if ('done' in event) finished = true;
				waiting.push(event);
				wake?.();
			});
			// Heard from now: a stop while `model_send` answers cancels the slot the host holds for it.
			signal.addEventListener('abort', stop, { once: true });
			try {
				const answer = await requireInvoke()('model_send', {
					provider: provider.id,
					body,
					stream,
				});
				if (answer !== stream) throw modelFailure('MODEL_UNREACHABLE');
			} catch (cause) {
				// Refused before anything was sent: there is nothing at the host to cancel.
				finished = true;
				stop();
				const code =
					typeof cause === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(cause)
						? cause
						: ((cause as { code?: string })?.code ?? 'MODEL_UNREACHABLE');
				throw modelFailure(code);
			}
			if (stopped) {
				// Stopped while `model_send` answered: its first cancel may have reached the host before the stream's slot
				// did, so it is sent again now the stream is known to be there. A second cancel is harmless.
				void Promise.resolve()
					.then(() => requireInvoke()('model_cancel', { stream }))
					.catch(() => undefined);
				throw modelFailure('MODEL_UNREACHABLE');
			}
			const next = async (): Promise<ModelEvent | undefined> => {
				while (waiting.length === 0 && !stopped)
					await new Promise<void>((resolve) => (wake = resolve));
				return waiting.shift();
			};
			// The status comes first, or the end with a code when the request never reached the provider.
			const head = await next();
			if (!head || 'chunk' in head) {
				stop();
				throw modelFailure('MODEL_UNREACHABLE');
			}
			if ('done' in head) {
				stop();
				throw modelFailure(head.code ?? 'MODEL_UNREACHABLE');
			}
			const encoder = new TextEncoder();
			return {
				status: head.status,
				body: (async function* () {
					try {
						for (;;) {
							const event = await next();
							if (!event) return;
							if ('chunk' in event) yield encoder.encode(event.chunk);
							else if ('done' in event) {
								// A provider's refusal is its status; any other code ends the stream with it.
								if (event.code && event.code !== 'MODEL_REFUSED') throw modelFailure(event.code);
								return;
							}
						}
					} finally {
						// Read to its end, or left early (a stop, the kernel's 16 MiB bound): either way, no more.
						stop();
					}
				})(),
			};
		},
	};
}

/**
 * The transport of a host (4.2): the test provider for `kind = "test"`, in the page, and every other kind through the
 * desktop's Rust host when the page is the desktop's, else refused, as a static page can name only `test`.
 */
export function createHostTransport(
	target: Window = window,
	scripts: Readonly<Record<string, ModelScriptV1>> = {},
	invoke: DesktopInvoke | null = captureDesktopInvoke(target)
): ModelTransportV1 {
	const page = createPageTransport(scripts);
	const desktop = invoke ? createDesktopModelTransport(target, invoke) : undefined;
	return {
		send(provider, body, signal) {
			if (provider.kind === 'test' || !desktop) return page.send(provider, body, signal);
			return desktop.send(provider, body, signal);
		},
	};
}

export interface WebCopilot {
	host: CopilotHostV1;
	launcher: FrameLauncher;
}

/** The copilot of a page: the frame on `sandboxOrigin`, the page's transport, and the kernel's halves over them. */
export function createWebCopilot(options: {
	document: Document;
	sandboxOrigin: string;
	transport?: ModelTransportV1;
	onRefused?: (port: 'model' | 'panel', reason: string) => void;
}): WebCopilot {
	const launcher = createFrameLauncher(options.document, options.sandboxOrigin);
	const host = createCopilotHost({
		launcher,
		transport: options.transport ?? createPageTransport(),
		...(options.onRefused ? { onRefused: options.onRefused } : {}),
	});
	return { host, launcher };
}

export type { CopilotProviderV1 };
