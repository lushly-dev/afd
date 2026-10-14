/** Actual vanilla Better Auth store -> AFD adapter -> React hooks + explicit SessionSync. */
import { createAuthClient } from 'better-auth/client';
import { createElement, useEffect, useState } from 'react';
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
	const [providerReadback, setProviderReadback] = useState<{
		sessionId: string;
		userId: string;
		adapterExpiresAt: number | null;
		providerSessionMatches: boolean;
		providerUserMatches: boolean;
		providerExpiresAt: number | null;
		expectedIdentityMatch: boolean;
	} | null>(null);
	const sessionId = session.status === 'authenticated' ? session.session.id : undefined;
	const userId = session.status === 'authenticated' ? session.user.id : undefined;
	const expiresAt =
		session.status === 'authenticated' ? (session.session.expiresAt?.getTime() ?? null) : null;
	useEffect(() => {
		let active = true;
		if (sessionId && userId) {
			void fetch('/harness/session')
				.then((response) => {
					if (!response.ok) throw new Error('Provider readback failed');
					return response.json();
				})
				.then(
					(
						readback: {
							id?: string;
							userId?: string;
							expiresAt?: number;
							expectedIdentityMatch?: boolean;
						} | null
					) => {
						if (active)
							setProviderReadback({
								sessionId,
								userId,
								adapterExpiresAt: expiresAt,
								providerSessionMatches: readback?.id === sessionId,
								providerUserMatches: readback?.userId === userId,
								providerExpiresAt:
									typeof readback?.expiresAt === 'number' && Number.isFinite(readback.expiresAt)
										? readback.expiresAt
										: null,
								expectedIdentityMatch: readback?.expectedIdentityMatch === true,
							});
					}
				)
				.catch(() => {
					if (active) setProviderReadback(null);
				});
		} else setProviderReadback(null);
		return () => {
			active = false;
		};
	}, [sessionId, userId, expiresAt]);
	const currentReadback =
		providerReadback &&
		providerReadback.sessionId === sessionId &&
		providerReadback.userId === userId &&
		providerReadback.adapterExpiresAt === expiresAt
			? providerReadback
			: null;
	const evidence =
		session.status === 'authenticated'
			? {
					status: session.status,
					sessionId: session.session.id,
					userId: session.user.id,
					expiresAt,
					providerSessionMatches: currentReadback?.providerSessionMatches ?? null,
					providerUserMatches: currentReadback?.providerUserMatches ?? null,
					providerExpiresAt: currentReadback?.providerExpiresAt ?? null,
					expectedIdentityMatch: currentReadback?.expectedIdentityMatch ?? null,
				}
			: { status: session.status };
	return createElement(
		'div',
		null,
		createElement('output', { id: 'session', 'data-status': session.status }, user?.email ?? ''),
		createElement('pre', { id: 'evidence' }, JSON.stringify(evidence))
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
document.getElementById('refresh')?.addEventListener('click', () => {
	void window.afdHosted.refresh();
});
document.getElementById('sign-out')?.addEventListener('click', () => {
	void window.afdHosted.signOut();
});
let probeHandle: string | undefined;
const probeStatus = document.getElementById('probe-status');
function showProbe(message: string) {
	if (probeStatus) probeStatus.textContent = message;
}
document.getElementById('probe-capture')?.addEventListener('click', () => {
	if (probeHandle) return;
	void fetch('/harness/probe/capture', { method: 'POST' })
		.then(async (response) => {
			if (!response.ok) throw new Error('Capture unavailable');
			const result = (await response.json()) as { handle: string };
			probeHandle = result.handle;
			showProbe('Captured one session for one replay.');
		})
		.catch(() => showProbe('Capture unavailable.'));
});
document.getElementById('probe-verify')?.addEventListener('click', () => {
	const handle = probeHandle;
	if (!handle) {
		showProbe('Capture a session first.');
		return;
	}
	probeHandle = undefined;
	void fetch('/harness/probe/verify', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ handle }),
	})
		.then(async (response) => {
			if (!response.ok) throw new Error('Replay unavailable');
			const result = (await response.json()) as { rejected: boolean; sameSession: boolean };
			showProbe(
				`Replay rejected: ${result.rejected}; same session accepted: ${result.sameSession}.`
			);
		})
		.catch(() => showProbe('Replay unavailable or capture expired.'));
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
