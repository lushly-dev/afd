/** Actual vanilla Better Auth store -> AFD adapter -> React hooks + explicit SessionSync. */
import { createAuthClient } from 'better-auth/client';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BetterAuthAdapter } from '../../src/adapters/better-auth.js';
import { createAuthHooks } from '../../src/react.js';
import { SessionSync } from '../../src/session-sync.js';

const client = createAuthClient({
	baseURL: location.origin,
	// Navigation belongs to this application's button so redirect is observable first.
	disableDefaultFetchPlugins: true,
	sessionOptions: { refetchOnWindowFocus: false, refetchInterval: 0 },
});
const adapter = new BetterAuthAdapter({ client });
const sync = new SessionSync({ debounceMs: 10 });
const { useSession, useUser } = createAuthHooks(adapter);
const subscription = sync.onSessionChanged(() => {
	void client.useSession.get().refetch();
});
const info = (await (await fetch('/harness/info')).json()) as { providerId: string };
function View() {
	const session = useSession();
	const user = useUser();
	return createElement(
		'output',
		{ id: 'session', 'data-status': session.status },
		user?.email ?? ''
	);
}
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
const root = createRoot(element);
root.render(createElement(View));
export interface Harness {
	oauth(): Promise<{ kind: string; url?: string; before: string }>;
	refresh(): Promise<void>;
	signOut(): Promise<void>;
	snapshot(): { status: string; id?: string; userId?: string; email?: string; expiresAt?: number };
}
declare global {
	interface Window {
		afdHosted: Harness;
	}
}
window.afdHosted = {
	async oauth() {
		const result = await adapter.signIn({
			method: 'oauth',
			provider: info.providerId,
			redirectTo: `${location.origin}/`,
		});
		return { ...result, before: adapter.getSession().status };
	},
	async refresh() {
		await client.useSession.get().refetch();
		sync.notifySessionChanged({ type: 'session-refreshed' });
	},
	async signOut() {
		await adapter.signOut();
		await client.useSession.get().refetch();
		sync.notifySessionChanged({ type: 'signed-out' });
	},
	snapshot() {
		const state = adapter.getSession();
		return state.status === 'authenticated'
			? {
					status: state.status,
					id: state.session.id,
					userId: state.user.id,
					email: state.user.email,
					expiresAt: state.session.expiresAt?.getTime(),
				}
			: { status: state.status };
	},
};
document.getElementById('oauth')?.addEventListener('click', () => {
	void window.afdHosted.oauth().then((result) => {
		if (result.url) location.assign(result.url);
	});
});
window.addEventListener(
	'pagehide',
	() => {
		subscription.unsubscribe();
		sync.dispose();
		adapter.dispose();
		root.unmount();
	},
	{ once: true }
);
