/**
 * @fileoverview The protocol a sandboxed view speaks (phase 1 specification, 6.2, pinned to MCP Apps
 * 2026-01-26): what it may ask, what it is told and when. The checks on what it asks are the kernel's, in
 * the port's `view` broker; everything from a view is untrusted (D54).
 */

import type { ViewBrokerV1 } from '@lushly-dev/loam-kernel';
import type { ProxyChannel } from './channel.js';

const PROTOCOL_VERSION = '2026-01-26';

export interface ViewHostContext {
	theme: 'light' | 'dark';
	platform: 'web';
	displayMode: 'inline';
	containerDimensions: { width: number; height: number };
	'dev.loam/tokens': Record<string, string>;
	'dev.loam/selection'?: string | null;
}

export interface ViewHostOptions {
	channel: ProxyChannel;
	broker: ViewBrokerV1;
	instance: string;
	/** The kernel's interface version, as `hostInfo.version`. */
	hostVersion: string;
	/** The resource now rendered. */
	resource: string;
	/** `ui.surfaces.main.command`, which runs when the view opens. */
	command?: string;
	context(): ViewHostContext;
	onInitialized(): void;
}

/** What phase 5 serves: the capabilities do not offer it, and a view that asks is told so. */
const PHASE_5_METHODS: ReadonlySet<string> = new Set([
	'ui/open-link',
	'ui/message',
	'ui/update-model-context',
]);

/** What would show over the next app, from a view already on its way out. */
const OVERLAY_COMMANDS: ReadonlySet<unknown> = new Set(['toast-show', 'modal-open']);

const refusal = (rpcCode: number, message: string, suggestion: string) => ({
	code: 'VIEW_CALL_REFUSED',
	message,
	suggestion,
	details: { rpcCode },
});

function logged(data: unknown): string {
	if (typeof data === 'string') return data.slice(0, 512);
	try {
		return String(JSON.stringify(data)).slice(0, 512);
	} catch {
		return 'A message that cannot be read';
	}
}

export class ViewHost {
	readonly #options: ViewHostOptions;
	readonly #pushes: Array<[string, unknown]> = [];
	#changed: Partial<ViewHostContext> = {};
	#bound: AbortController | undefined;
	#stopLinked: (() => void) | undefined;
	#initialized = false;
	#leaving = false;

	constructor(options: ViewHostOptions) {
		this.#options = options;
		const { channel, broker, resource, command } = options;
		channel.onRequest = (method, params) => this.#request(method, params);
		channel.onNotification = (method, params) => this.#notification(method, params);
		this.#stopLinked = broker.onLinkedCall(resource, ({ input, result, signal }) => {
			// The bound call answers below, and is one call whatever links it.
			if (signal !== undefined && signal === this.#bound?.signal) return;
			this.#push('ui/notifications/tool-input', { arguments: input });
			this.#push('ui/notifications/tool-result', result);
		});
		if (command !== undefined) this.#runBound(command);
	}

	get initialized(): boolean {
		return this.#initialized;
	}

	#runBound(command: string): void {
		const bound = new AbortController();
		this.#bound = bound;
		this.#push('ui/notifications/tool-input', { arguments: {} });
		this.#options.broker
			.runBound(command, bound.signal)
			.then((result) => {
				if (bound.signal.aborted) return;
				this.#bound = undefined;
				this.#push('ui/notifications/tool-result', result);
			})
			.catch(reportError);
	}

	/** The host sends nothing to a view before `initialized`: what comes earlier waits, in order. */
	#push(method: string, params: unknown): void {
		if (this.#initialized) this.#options.channel.notify(method, params);
		else this.#pushes.push([method, params]);
	}

	/** Tell the view what changed; before `initialized`, what changed since it asked. */
	changeContext(changed: Partial<ViewHostContext>): void {
		if (this.#initialized) {
			this.#options.channel.notify('ui/notifications/host-context-changed', changed);
		} else {
			this.#changed = { ...this.#changed, ...changed };
		}
	}

	async #request(method: string, params: unknown): Promise<unknown> {
		const { broker, hostVersion, context } = this.#options;
		switch (method) {
			case 'ui/initialize':
				this.#changed = {};
				return {
					protocolVersion: PROTOCOL_VERSION,
					hostInfo: { name: 'loam', version: hostVersion },
					hostCapabilities: { serverTools: {}, serverResources: {}, logging: {}, sandbox: {} },
					hostContext: context(),
				};
			case 'tools/call':
				// A view may save its state in teardown (MCP Apps), and it may not speak over the next app.
				if (this.#leaving && OVERLAY_COMMANDS.has((params as { name?: unknown } | null)?.name)) {
					throw refusal(-32600, 'This view is closing', 'Show this before the view is closed');
				}
				return broker.toolsCall(params);
			case 'resources/read':
				return broker.resourcesRead(params);
			case 'ping':
				return {};
			case 'ui/request-display-mode':
				return { mode: 'inline' };
			default:
				if (PHASE_5_METHODS.has(method)) {
					throw refusal(
						-32601,
						`The shell does not answer ${method} yet`,
						'Phase 5 serves it, and the capabilities do not offer it until then'
					);
				}
				throw refusal(-32601, 'Method not found', 'Use a method of the MCP Apps profile');
		}
	}

	#notification(method: string, params: unknown): void {
		const { channel, instance, onInitialized } = this.#options;
		if (method === 'notifications/message') {
			const { level, data } = (params ?? {}) as { level?: unknown; data?: unknown };
			if (level === 'error') reportError(new Error(`The view of ${instance}: ${logged(data)}`));
			return;
		}
		if (method !== 'ui/notifications/initialized' || this.#initialized) return;
		this.#initialized = true;
		onInitialized();
		if (Object.keys(this.#changed).length > 0) {
			channel.notify('ui/notifications/host-context-changed', this.#changed);
			this.#changed = {};
		}
		for (const [name, pushed] of this.#pushes.splice(0)) channel.notify(name, pushed);
	}

	/** On a switch away from a view that has sent `initialized`: at most `ms`, and the frame goes after. */
	async teardown(ms: number): Promise<void> {
		const { channel } = this.#options;
		this.#leaving = true;
		if (this.#bound) channel.notify('ui/notifications/tool-cancelled', { reason: 'app-switch' });
		this.#stopRunning();
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			channel.request('ui/resource-teardown', {}).catch(() => {}),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, ms);
			}),
		]);
		clearTimeout(timer);
	}

	#stopRunning(): void {
		this.#bound?.abort();
		this.#bound = undefined;
		this.#stopLinked?.();
		this.#stopLinked = undefined;
	}

	dispose(): void {
		this.#stopRunning();
	}
}
