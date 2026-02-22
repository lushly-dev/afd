/**
 * @fileoverview React hooks for AFD auth
 *
 * Sub-path export: import from '@lushly-dev/afd-auth/react'
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { AuthAdapter, AuthSessionState, User } from './types.js';
import { LOADING } from './types.js';

export type { ConvexAuthAdapterOptions } from './adapters/convex.js';
export { useConvexAuthAdapter } from './adapters/convex.js';

export interface AuthHooks {
	useAuth: () => AuthAdapter;
	useSession: () => AuthSessionState;
	useUser: () => User | null;
}

/**
 * Create React hooks bound to an auth adapter instance.
 */
export function createAuthHooks(adapter: AuthAdapter): AuthHooks {
	function useAuth(): AuthAdapter {
		return adapter;
	}

	function useSession(): AuthSessionState {
		const snapshotRef = useRef<AuthSessionState>(adapter.getSession());

		const subscribe = useCallback((onStoreChange: () => void) => {
			const { unsubscribe } = adapter.onAuthStateChange((state) => {
				snapshotRef.current = state;
				onStoreChange();
			});
			return unsubscribe;
		}, []);

		const getSnapshot = useCallback(() => snapshotRef.current, []);
		const getServerSnapshot = useCallback(() => LOADING, []);

		return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	}

	function useUser(): User | null {
		const session = useSession();
		return session.status === 'authenticated' ? session.user : null;
	}

	return { useAuth, useSession, useUser };
}
