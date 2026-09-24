/**
 * @fileoverview Messages exchanged between tabs by SessionSync
 */

/**
 * A session change broadcast to other tabs. `visibility-refresh` is also
 * raised locally when a tab becomes visible after being hidden for
 * `visibilityRefreshMs`.
 */
export type SessionSyncMessage =
	| { type: 'signed-in'; userId?: string }
	| { type: 'signed-out' }
	| { type: 'session-refreshed' }
	| { type: 'profile-updated'; userId?: string }
	| { type: 'visibility-refresh' };

export type SessionSyncMessageType = SessionSyncMessage['type'];

/**
 * Validate a payload received from another tab (or passed by an untyped
 * caller). Returns a copy that holds only the known fields, or `null` when
 * the payload is not a valid message.
 */
export function parseSessionSyncMessage(value: unknown): SessionSyncMessage | null {
	if (typeof value !== 'object' || value === null || !('type' in value)) return null;

	const userId = 'userId' in value ? value.userId : undefined;
	if (userId !== undefined && typeof userId !== 'string') return null;

	switch (value.type) {
		case 'signed-in':
		case 'profile-updated':
			return userId === undefined ? { type: value.type } : { type: value.type, userId };
		case 'signed-out':
		case 'session-refreshed':
		case 'visibility-refresh':
			return { type: value.type };
		default:
			return null;
	}
}
