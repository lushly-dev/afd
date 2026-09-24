/**
 * @fileoverview Typed event subscription for `McpClient`.
 */

import type { McpClientEvents } from './types.js';

type EventMap = { [K in keyof McpClientEvents]: McpClientEvents[K][] };

/**
 * Event emitter base of `McpClient`. Handlers run in subscription order; one that throws is
 * logged and does not stop the others.
 */
export class McpClientEventEmitter {
	private readonly eventHandlers: EventMap = {
		stateChange: [],
		connected: [],
		disconnected: [],
		reconnecting: [],
		error: [],
		message: [],
		toolsChanged: [],
	};

	/**
	 * Subscribe to an event.
	 *
	 * @returns A function that unsubscribes the handler
	 */
	on<K extends keyof McpClientEvents>(event: K, handler: McpClientEvents[K]): () => void {
		this.eventHandlers[event].push(handler);

		return () => {
			const index = this.eventHandlers[event].indexOf(handler);
			if (index > -1) {
				this.eventHandlers[event].splice(index, 1);
			}
		};
	}

	/**
	 * Emit an event to a snapshot of the handlers, so a handler that subscribes or unsubscribes
	 * while the event is delivered does not make others run twice or be skipped.
	 */
	protected emit<K extends keyof McpClientEvents>(
		event: K,
		...args: Parameters<McpClientEvents[K]>
	): void {
		for (const handler of [...this.eventHandlers[event]]) {
			try {
				(handler as (...args: Parameters<McpClientEvents[K]>) => void)(...args);
			} catch (error) {
				console.error(`Error in event handler for '${event}':`, error);
			}
		}
	}
}
