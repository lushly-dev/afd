/** Browser-only application wiring real provider state into AFD's hooks and sync. */
import { createAuthClient } from 'better-auth/client';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BetterAuthAdapter } from '../src/adapters/better-auth.js';
import { createAuthHooks } from '../src/react.js';
import { SessionSync } from '../src/session-sync.js';
import type { SessionSyncMessage } from '../src/session-sync-message.js';

const client = createAuthClient({
	baseURL: location.origin,
	sessionOptions: { refetchOnWindowFocus: false, refetchInterval: 0 },
});
const adapter = new BetterAuthAdapter({ client });
const sync = new SessionSync({ debounceMs: 10, visibilityRefreshMs: 60_000 });
const { useSession, useUser } = createAuthHooks(adapter);
const received: SessionSyncMessage[] = [];
const subscription = sync.onSessionChanged((message) => {
	received.push(message);
	void client.useSession.get().refetch();
});
const credentials = { email: 'browser@example.test', password: 'afd-browser-password-123' };

function SessionView() {
	const state = useSession();
	const user = useUser();
	return createElement('output', { id: 'session', 'data-status': state.status }, user?.email ?? '');
}

const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
const root = createRoot(element);
root.render(createElement(SessionView));

export interface BrowserHarness {
	register(): Promise<void>;
	signIn(password?: string): Promise<string>;
	signOut(): Promise<void>;
	refresh(): Promise<void>;
	snapshot(): { status: string; id?: string; expiresAt?: number };
	messages(): SessionSyncMessage[];
	acquireLock(): Promise<boolean>;
	releaseLock(): void;
	dispose(): void;
}

declare global {
	interface Window {
		afdBrowser: BrowserHarness;
	}
}

window.afdBrowser = {
	async register() {
		const result = await client.signUp.email({ ...credentials, name: 'AFD Browser' });
		if (result.error) throw new Error(result.error.message);
		await client.useSession.get().refetch();
		sync.notifySessionChanged({ type: 'signed-in' });
	},
	async signIn(password = credentials.password) {
		try {
			const result = await adapter.signIn({ method: 'credentials', ...credentials, password });
			await client.useSession.get().refetch();
			sync.notifySessionChanged({ type: 'signed-in' });
			return result.kind;
		} catch (error) {
			if (error instanceof Error && 'code' in error) return String(error.code);
			throw error;
		}
	},
	async signOut() {
		await adapter.signOut();
		await client.useSession.get().refetch();
		sync.notifySessionChanged({ type: 'signed-out' });
	},
	async refresh() {
		await client.useSession.get().refetch();
		sync.notifySessionChanged({ type: 'session-refreshed' });
	},
	snapshot() {
		const state = adapter.getSession();
		return state.status === 'authenticated'
			? {
					status: state.status,
					id: state.session.id,
					expiresAt: state.session.expiresAt?.getTime(),
				}
			: { status: state.status };
	},
	messages: () => [...received],
	acquireLock: () => sync.acquireRefreshLockAsync(),
	releaseLock: () => sync.releaseRefreshLock(),
	dispose() {
		root.unmount();
		subscription.unsubscribe();
		sync.dispose();
		adapter.dispose();
	},
};
window.addEventListener('pagehide', () => window.afdBrowser.dispose(), { once: true });
