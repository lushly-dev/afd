/**
 * @fileoverview Bounded store of HTTP MCP sessions and their context state.
 *
 * `initialize` creates a session and returns its ID in the `Mcp-Session-Id` response header.
 * Later requests carrying that header share one context stack; requests without it are
 * stateless. Sessions expire after an idle timeout. Each session has an owner, who alone may
 * use it, and a quota key (with MCP authorization, the issuer and subject: one person or service
 * across all its clients). A quota key holds at most `maxSessionsPerOwner` sessions: at that
 * quota, or when the store is full, a new session displaces only the least recently used
 * session of the same quota key. One with none is refused while the store is full, so memory
 * stays bounded however many clients connect, no caller ends another's session, and no single
 * subject can fill the store. Up to `maxSessions / maxSessionsPerOwner` distinct subjects can
 * still fill it between them; a new subject is then refused until sessions expire.
 */

import { randomUUID } from 'node:crypto';
import { type ContextState, createContextState } from './bootstrap/afd-context.js';

/** Default maximum number of live HTTP sessions. */
export const DEFAULT_MAX_SESSIONS = 1000;

/** Default number of live sessions one owner may hold (never more than `maxSessions`). */
export const DEFAULT_MAX_SESSIONS_PER_OWNER = 100;

/** Default idle time after which an HTTP session expires (30 minutes). */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface SessionStoreOptions {
	/**
	 * Maximum live sessions. Beyond it, the creating owner's least recently used session is
	 * evicted, or the new session is refused when that owner has none.
	 */
	maxSessions?: number;
	/**
	 * Maximum live sessions of one quota key; at it, that key's least recently used session is
	 * evicted. Default: `DEFAULT_MAX_SESSIONS_PER_OWNER`, or `maxSessions` when smaller. Never
	 * more than `maxSessions`.
	 */
	maxSessionsPerOwner?: number;
	/** Idle time in milliseconds after which a session expires. */
	idleTimeoutMs?: number;
	/** Clock, for tests. */
	now?: () => number;
}

export interface SessionStore {
	/**
	 * Start a session and return its ID. `owner` binds it to a caller: on a server with MCP
	 * authorization, the verified credentials' issuer, subject and client
	 * (`credentialsBinding`). `quotaKey` (default: `owner`) groups the sessions that share one
	 * quota: with MCP authorization, the issuer and subject. At that key's quota, or at capacity,
	 * it evicts only that key's least recently used session, and returns `undefined` (nothing
	 * created) when the store is full and the key holds none to give up.
	 */
	create(owner?: string, quotaKey?: string): string | undefined;
	/**
	 * The context state of a live session, refreshing its idle timer; `undefined` if unknown,
	 * expired, or owned by another caller than `owner`. A caller that is not the owner neither
	 * sees nor touches the session, so it is answered as one that does not exist.
	 */
	get(id: string, owner?: string): ContextState | undefined;
	/** Number of live sessions (expired ones may still be counted until the next access). */
	readonly size: number;
	/** Drop every session. */
	clear(): void;
}

interface Session {
	state: ContextState;
	lastSeen: number;
	owner: string | undefined;
	quotaKey: string | undefined;
}

/**
 * `maxSessions` and the per-owner quota, defaulted and checked: the quota defaults to
 * `DEFAULT_MAX_SESSIONS_PER_OWNER`, or `maxSessions` when smaller, and is never above it.
 *
 * @throws Error when either is not a positive integer, or the quota exceeds `maxSessions`
 */
export function sessionLimits(
	maxSessions = DEFAULT_MAX_SESSIONS,
	maxSessionsPerOwner?: number
): { maxSessions: number; perOwner: number } {
	if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
		throw new Error('maxSessions must be a positive integer');
	}
	const perOwner = maxSessionsPerOwner ?? Math.min(DEFAULT_MAX_SESSIONS_PER_OWNER, maxSessions);
	if (!Number.isSafeInteger(perOwner) || perOwner <= 0 || perOwner > maxSessions) {
		throw new Error('maxSessionsPerOwner must be a positive integer no greater than maxSessions');
	}
	return { maxSessions, perOwner };
}

/**
 * A session store's limits, defaults applied, as {@link createSessionStore} reads them.
 *
 * @throws Error as {@link sessionLimits} does, or when the idle timeout is not positive
 */
export function sessionStoreLimits(options: SessionStoreOptions = {}) {
	const { idleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS } = options;
	const { maxSessions, perOwner } = sessionLimits(options.maxSessions, options.maxSessionsPerOwner);
	if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
		throw new Error('sessionIdleTimeoutMs must be a positive number');
	}
	return { maxSessions, perOwner, idleTimeoutMs };
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
	const { now = Date.now } = options;
	const { maxSessions, perOwner, idleTimeoutMs } = sessionStoreLimits(options);
	// Map order is least recently used first: `get` moves a session to the end.
	const sessions = new Map<string, Session>();

	function sweep(at: number): void {
		for (const [id, session] of sessions) {
			if (at - session.lastSeen < idleTimeoutMs) return;
			sessions.delete(id);
		}
	}

	return {
		create(owner, quotaKey = owner) {
			const at = now();
			sweep(at);
			// Room comes only from the caller's own sessions (its quota key's), least recently used
			// first: one caller's `initialize` never ends another caller's session.
			let oldestOwn: string | undefined;
			let own = 0;
			for (const [id, session] of sessions) {
				if (session.quotaKey !== quotaKey) continue;
				oldestOwn ??= id;
				own++;
			}
			if (own >= perOwner || sessions.size >= maxSessions) {
				if (oldestOwn === undefined) return undefined;
				sessions.delete(oldestOwn);
			}
			const id = randomUUID();
			sessions.set(id, { state: createContextState(), lastSeen: at, owner, quotaKey });
			return id;
		},
		get(id, owner) {
			const session = sessions.get(id);
			if (!session || session.owner !== owner) return undefined;
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
