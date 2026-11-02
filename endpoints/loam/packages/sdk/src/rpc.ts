/**
 * @fileoverview JSON-RPC over `window.parent.postMessage`, what MCP Apps' views speak. A view's
 * parent is the proxy on the sandbox origin, which forwards to the shell and is the only window this
 * code listens to. Its origin is unknown to an opaque-origin frame, so messages are checked by source.
 */

export interface RpcError {
	code: number;
	message: string;
	data?: unknown;
}

/** A request answered with a JSON-RPC error. */
export class RpcFailure extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(error: RpcError) {
		super(error.message);
		this.name = 'RpcFailure';
		this.code = error.code;
		this.data = error.data;
	}
}

/** A request the caller's signal aborted. */
export class RpcAborted extends Error {
	constructor() {
		super('The call was aborted.');
		this.name = 'RpcAborted';
	}
}

interface RpcMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: RpcError;
}

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void;

export interface RpcPeer {
	request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown>;
	notify(method: string, params?: unknown): void;
	/** Answers a request from the host. A method with no handler answers -32601. */
	handle(method: string, handler: RequestHandler): void;
	onNotification(method: string, handler: NotificationHandler): void;
}

function isRpcMessage(value: unknown): value is RpcMessage {
	return typeof value === 'object' && value !== null && (value as RpcMessage).jsonrpc === '2.0';
}

export function createPeer(): RpcPeer {
	const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	const requests = new Map<string, RequestHandler>();
	const notifications = new Map<string, NotificationHandler>();
	let nextId = 1;
	const post = (message: Omit<RpcMessage, 'jsonrpc'>): void => {
		window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
	};

	const answer = async (id: number | string, method: string, params: unknown): Promise<void> => {
		const handler = requests.get(method);
		if (!handler) {
			post({ id, error: { code: -32601, message: `Method not found: ${method}` } });
			return;
		}
		try {
			post({ id, result: await handler(params) });
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			post({ id, error: { code: -32603, message } });
		}
	};

	window.addEventListener('message', (event: MessageEvent) => {
		if (event.source !== window.parent || !isRpcMessage(event.data)) return;
		const message = event.data;
		if (message.method === undefined) {
			const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
			if (!waiting) return;
			pending.delete(message.id as number);
			if (message.error) waiting.reject(new RpcFailure(message.error));
			else waiting.resolve(message.result);
			return;
		}
		if (message.id !== undefined) void answer(message.id, message.method, message.params);
		else notifications.get(message.method)?.(message.params);
	});

	return {
		request(method, params, signal) {
			if (signal?.aborted) return Promise.reject(new RpcAborted());
			const id = nextId++;
			return new Promise((resolve, reject) => {
				const onAbort = (): void => {
					pending.delete(id);
					reject(new RpcAborted());
				};
				signal?.addEventListener('abort', onAbort, { once: true });
				pending.set(id, {
					resolve(value) {
						signal?.removeEventListener('abort', onAbort);
						resolve(value);
					},
					reject(error) {
						signal?.removeEventListener('abort', onAbort);
						reject(error);
					},
				});
				post({ id, method, params: params ?? {} });
			});
		},
		notify(method, params) {
			post({ method, params: params ?? {} });
		},
		handle(method, handler) {
			requests.set(method, handler);
		},
		onNotification(method, handler) {
			notifications.set(method, handler);
		},
	};
}
