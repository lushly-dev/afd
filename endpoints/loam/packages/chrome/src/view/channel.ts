/**
 * @fileoverview The shell's end of a sandbox proxy (phase 1 specification, 6.1 and 6.3): the outer iframe,
 * the check on every message, and JSON-RPC over it. A view and a handler frame each speak through one.
 * Whatever arrives is untrusted, so only a message from this frame's window, from the sandbox's origin,
 * of the shape JSON-RPC says, is read at all.
 */

/** What the outer iframe may do: a child frame takes only flags its parent has. */
export const PROXY_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';

export interface ChannelOptions {
	document: Document;
	sandboxOrigin: string;
	/** The app's title: the iframe's name, and the proxy's document title. */
	title: string;
	/** The HTML the proxy renders once it is ready. */
	html: string;
}

export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => void;

interface RpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface RpcMessage {
	jsonrpc: '2.0';
	id?: unknown;
	method?: unknown;
	params?: unknown;
	result?: unknown;
	error?: RpcError;
}

/** A JSON-RPC error answered to the shell's own request. */
export class ChannelError extends Error {
	readonly code: number;

	constructor(error: RpcError) {
		super(typeof error?.message === 'string' ? error.message : 'The frame refused the request');
		this.name = 'ChannelError';
		this.code = error?.code;
	}
}

/** The channel closed, or the caller's signal aborted, before an answer came. */
export class ChannelClosed extends Error {
	constructor(message = 'The frame is gone') {
		super(message);
		this.name = 'ChannelClosed';
	}
}

const isId = (id: unknown): id is number | string =>
	typeof id === 'number' || typeof id === 'string';

/**
 * A refusal the kernel coded goes back with its JSON-RPC code, and `data: { code, suggestion }`, which is
 * what the SDK reads (9.5, 11.2). Anything else is the shell's own failure, whose text a view has no
 * need of: it goes to the page's console.
 */
export function rpcErrorOf(cause: unknown): RpcError {
	const { code, message, suggestion, details } = (cause ?? {}) as {
		code?: unknown;
		message?: unknown;
		suggestion?: unknown;
		details?: { rpcCode?: unknown };
	};
	if (typeof code !== 'string' || typeof message !== 'string') {
		reportError(cause);
		return { code: -32603, message: 'The shell could not answer this request' };
	}
	const rpcCode = details?.rpcCode;
	return {
		code: typeof rpcCode === 'number' ? rpcCode : -32603,
		message,
		data: { code, ...(typeof suggestion === 'string' ? { suggestion } : {}) },
	};
}

export class ProxyChannel {
	readonly frame: HTMLIFrameElement;
	readonly #view: Window;
	readonly #sandboxOrigin: string;
	readonly #html: string;
	readonly #pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>();
	#nextId = 1;
	#sentHtml = false;
	#closed = false;
	onRequest: RequestHandler = (method) =>
		Promise.reject({ code: 'VIEW_CALL_REFUSED', message: `No method ${method}` });
	onNotification: NotificationHandler = () => {};

	constructor({ document, sandboxOrigin, title, html }: ChannelOptions) {
		this.#view = document.defaultView ?? window;
		this.#sandboxOrigin = sandboxOrigin;
		this.#html = html;
		const frame = document.createElement('iframe');
		// Before `src`, so the document it loads has these flags from its first byte.
		frame.setAttribute('sandbox', PROXY_SANDBOX);
		frame.setAttribute('referrerpolicy', 'no-referrer');
		frame.title = title;
		const url = new URL('/sandbox/proxy.html', sandboxOrigin);
		url.searchParams.set('host', this.#view.location.origin);
		url.searchParams.set('title', title);
		frame.src = url.href;
		this.frame = frame;
		this.#view.addEventListener('message', this.#onMessage);
	}

	#onMessage = (event: MessageEvent): void => {
		if (event.source !== this.frame.contentWindow || event.origin !== this.#sandboxOrigin) return;
		const message = event.data as RpcMessage | null | undefined;
		if (typeof message !== 'object' || message === null || message.jsonrpc !== '2.0') return;
		if (typeof message.method === 'string') {
			if (message.method === PROXY_READY) this.#sendHtml();
			else if (isId(message.id)) void this.#answer(message.id, message.method, message.params);
			else this.onNotification(message.method, message.params);
			return;
		}
		const waiting = typeof message.id === 'number' ? this.#pending.get(message.id) : undefined;
		if (!waiting) return;
		this.#pending.delete(message.id as number);
		if (message.error) waiting.reject(new ChannelError(message.error));
		else waiting.resolve(message.result);
	};

	#sendHtml(): void {
		if (this.#sentHtml) return;
		this.#sentHtml = true;
		this.#post({ method: RESOURCE_READY, params: { html: this.#html } });
	}

	async #answer(id: number | string, method: string, params: unknown): Promise<void> {
		try {
			this.#post({ id, result: await this.onRequest(method, params) });
		} catch (cause) {
			this.#post({ id, error: rpcErrorOf(cause) });
		}
	}

	#post(message: Omit<RpcMessage, 'jsonrpc'>): void {
		if (this.#closed) return;
		this.frame.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, this.#sandboxOrigin);
	}

	request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (this.#closed) return Promise.reject(new ChannelClosed());
		if (signal?.aborted) return Promise.reject(new ChannelClosed('The call was aborted'));
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			const onAbort = (): void => {
				this.#pending.delete(id);
				reject(new ChannelClosed('The call was aborted'));
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			this.#pending.set(id, {
				resolve(value) {
					signal?.removeEventListener('abort', onAbort);
					resolve(value);
				},
				reject(error) {
					signal?.removeEventListener('abort', onAbort);
					reject(error);
				},
			});
			this.#post({ id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		this.#post({ method, params });
	}

	/** Stop listening, remove the frame, and fail whatever was waiting. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#view.removeEventListener('message', this.#onMessage);
		this.frame.remove();
		for (const waiting of this.#pending.values()) waiting.reject(new ChannelClosed());
		this.#pending.clear();
	}
}
