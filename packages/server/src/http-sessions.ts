/**
 * @fileoverview Bounded store of HTTP MCP sessions and their context state.
 *
 * `initialize` creates a session and returns its ID in the `Mcp-Session-Id` response header.
 * Later requests carrying that header share one context stack; requests without it are
 * stateless. Sessions expire after an idle timeout, and the least recently used session is
 * evicted when the store is full, so memory stays bounded however many clients connect.
 */

import { randomUUID } from 'node:crypto';
import { type ContextState, createContextState } from './bootstrap/afd-context.js';

/** Default maximum number of live HTTP sessions. */
export const DEFAULT_MAX_SESSIONS = 1000;

/** Default idle time after which an HTTP session expires (30 minutes). */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface SessionStoreOptions {
	/** Maximum live sessions; the least recently used one is evicted beyond it. */
	maxSessions?: number;
	/** Idle time in milliseconds after which a session expires. */
	idleTimeoutMs?: number;
	/** Clock, for tests. */
	now?: () => number;
}

export interface SessionStore {
	/** Start a session and return its ID. */
	create(): string;
	/** The context state of a live session, refreshing its idle timer; `undefined` if unknown or expired. */
	get(id: string): ContextState | undefined;
	/** Number of live sessions (expired ones may still be counted until the next access). */
	readonly size: number;
	/** Drop every session. */
	clear(): void;
}

interface Session {
	state: ContextState;
	lastSeen: number;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
	const {
		maxSessions = DEFAULT_MAX_SESSIONS,
		idleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
		now = Date.now,
	} = options;
	if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
		throw new Error('maxSessions must be a positive integer');
	}
	if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
		throw new Error('sessionIdleTimeoutMs must be a positive number');
	}
	// Map order is least recently used first: `get` moves a session to the end.
	const sessions = new Map<string, Session>();

	function sweep(at: number): void {
		for (const [id, session] of sessions) {
			if (at - session.lastSeen < idleTimeoutMs) return;
			sessions.delete(id);
		}
	}

	return {
		create() {
			const at = now();
			sweep(at);
			for (const oldest of sessions.keys()) {
				if (sessions.size < maxSessions) break;
				sessions.delete(oldest);
			}
			const id = randomUUID();
			sessions.set(id, { state: createContextState(), lastSeen: at });
			return id;
		},
		get(id) {
			const session = sessions.get(id);
			if (!session) return undefined;
			sessions.delete(id);
			const at = now();
			if (at - session.lastSeen >= idleTimeoutMs) return undefined;
			session.lastSeen = at;
			sessions.set(id, session);
			return session.state;
		},
		get size() {
			return sessions.size;
		},
		clear() {
			sessions.clear();
		},
	};
}
