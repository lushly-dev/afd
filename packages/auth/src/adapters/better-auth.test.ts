import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionState } from '../types.js';
import { BetterAuthAdapter } from './better-auth.js';

function createMockClient() {
	type SubscribeCallback = (value: {
		data: {
			session: { id: string; expiresAt: string };
			user: { id: string; email: string; name?: string; image?: string };
		} | null;
		isPending: boolean;
	}) => void;

	let subscriber: SubscribeCallback | null = null;
	let currentValue: Parameters<SubscribeCallback>[0] = {
		data: null,
		isPending: true,
	};

	return {
		client: {
			signIn: {
				social: vi.fn(),
				email: vi.fn(),
			},
			signOut: vi.fn(),
			useSession: () => ({
				subscribe: (cb: SubscribeCallback) => {
					subscriber = cb;
					return () => {
						subscriber = null;
					};
				},
				get: () => currentValue,
			}),
		},
		_emit: (value: Parameters<SubscribeCallback>[0]) => {
			currentValue = value;
			subscriber?.(value);
		},
	};
}

describe('BetterAuthAdapter', () => {
	it('starts in loading state', () => {
		const { client } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });
		expect(adapter.getSession().status).toBe('loading');
		adapter.dispose();
	});

	it('transitions to authenticated when session data arrives', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });

		_emit({
			data: {
				session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
				user: { id: 'u1', email: 'test@example.com', name: 'Test' },
			},
			isPending: false,
		});

		const state = adapter.getSession();
		expect(state.status).toBe('authenticated');
		if (state.status === 'authenticated') {
			expect(state.user.email).toBe('test@example.com');
			expect(state.session.id).toBe('s1');
		}

		adapter.dispose();
	});

	it('transitions to unauthenticated when data is null', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });

		_emit({ data: null, isPending: false });

		expect(adapter.getSession().status).toBe('unauthenticated');
		adapter.dispose();
	});

	it('notifies listeners on state change', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });
		const states: AuthSessionState[] = [];

		adapter.onAuthStateChange((state) => {
			states.push(state);
		});

		_emit({ data: null, isPending: false });
		_emit({
			data: {
				session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
				user: { id: 'u1', email: 'test@example.com' },
			},
			isPending: false,
		});

		expect(states).toHaveLength(2);
		expect(states[0]?.status).toBe('unauthenticated');
		expect(states[1]?.status).toBe('authenticated');

		adapter.dispose();
	});

	it('updates the snapshot when an authenticated user changes', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });
		const states: AuthSessionState[] = [];
		adapter.onAuthStateChange((state) => states.push(state));

		_emit({
			data: {
				session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
				user: { id: 'u1', email: 'one@example.com' },
			},
			isPending: false,
		});
		_emit({
			data: {
				session: { id: 's2', expiresAt: '2026-12-31T00:00:00Z' },
				user: { id: 'u2', email: 'two@example.com' },
			},
			isPending: false,
		});

		expect(states).toHaveLength(2);
		const session = adapter.getSession();
		expect(session.status).toBe('authenticated');
		if (session.status === 'authenticated') {
			expect(session.user.id).toBe('u2');
			expect(session.user.email).toBe('two@example.com');
		}

		adapter.dispose();
	});

	it('updates refreshed session and profile fields without a status transition', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });
		const states: AuthSessionState[] = [];
		adapter.onAuthStateChange((state) => states.push(state));

		const data = {
			session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
			user: { id: 'u1', email: 'one@example.com', name: 'One' },
		};
		_emit({ data, isPending: false });
		_emit({
			data: {
				session: { ...data.session, expiresAt: '2027-01-01T00:00:00Z' },
				user: { ...data.user, name: 'Updated' },
			},
			isPending: false,
		});
		_emit({
			data: {
				session: { id: 's1', expiresAt: '2027-01-01T00:00:00Z' },
				user: { id: 'u1', email: 'one@example.com', name: 'Updated' },
			},
			isPending: false,
		});

		expect(states).toHaveLength(2);
		const session = adapter.getSession();
		expect(session.status).toBe('authenticated');
		if (session.status === 'authenticated') {
			expect(session.session.expiresAt).toEqual(new Date('2027-01-01T00:00:00Z'));
			expect(session.user.name).toBe('Updated');
		}

		adapter.dispose();
	});

	it('delegates signIn email to client', async () => {
		const { client } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });

		await adapter.signIn({ method: 'credentials', email: 'test@example.com', password: 'pass' });

		expect(client.signIn.email).toHaveBeenCalledWith({
			email: 'test@example.com',
			password: 'pass',
		});

		adapter.dispose();
	});

	it('delegates signIn social to client', async () => {
		const { client } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });

		await adapter.signIn({ method: 'oauth', provider: 'github', redirectTo: '/callback' });

		expect(client.signIn.social).toHaveBeenCalledWith({
			provider: 'github',
			callbackURL: '/callback',
		});

		adapter.dispose();
	});

	it('delegates signOut to client', async () => {
		const { client } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });

		await adapter.signOut();

		expect(client.signOut).toHaveBeenCalled();

		adapter.dispose();
	});

	it('maps a resolved credentials 401 to invalid credentials', async () => {
		const { client } = createMockClient();
		client.signIn.email.mockResolvedValue({
			data: null,
			error: { status: 401, message: 'Invalid credentials' },
		});
		const adapter = new BetterAuthAdapter({ client });

		await expect(
			adapter.signIn({ method: 'credentials', email: 'test@example.com', password: 'wrong' })
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', retryable: false });

		adapter.dispose();
	});

	it('maps resolved social and sign-out errors to provider errors', async () => {
		const { client } = createMockClient();
		client.signIn.social.mockResolvedValue({
			data: null,
			error: { status: 502, message: 'GitHub unavailable' },
		});
		client.signOut.mockResolvedValue({
			data: null,
			error: { status: 500, message: 'Sign-out unavailable' },
		});
		const adapter = new BetterAuthAdapter({ client });

		await expect(adapter.signIn({ method: 'oauth', provider: 'github' })).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
			retryable: false,
		});
		await expect(adapter.signOut()).rejects.toMatchObject({
			code: 'PROVIDER_ERROR',
			retryable: false,
		});

		adapter.dispose();
	});

	it('maps a thrown network failure to a retryable network error', async () => {
		const { client } = createMockClient();
		client.signIn.email.mockRejectedValue(new Error('Failed to fetch'));
		const adapter = new BetterAuthAdapter({ client });

		await expect(
			adapter.signIn({ method: 'credentials', email: 'test@example.com', password: 'pass' })
		).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

		adapter.dispose();
	});

	it('keeps notifying later listeners when one throws', () => {
		const { client, _emit } = createMockClient();
		const errors: unknown[] = [];
		const adapter = new BetterAuthAdapter({
			client,
			onListenerError: (error) => errors.push(error),
		});
		const failure = new Error('listener failed');
		const seen: string[] = [];
		adapter.onAuthStateChange(() => {
			throw failure;
		});
		adapter.onAuthStateChange((state) => seen.push(state.status));

		expect(() => _emit({ data: null, isPending: false })).not.toThrow();

		expect(seen).toEqual(['unauthenticated']);
		expect(errors).toEqual([failure]);
		adapter.dispose();
	});

	it('supports unsubscribe', () => {
		const { client, _emit } = createMockClient();
		const adapter = new BetterAuthAdapter({ client });
		const states: AuthSessionState[] = [];

		const { unsubscribe } = adapter.onAuthStateChange((state) => {
			states.push(state);
		});

		_emit({ data: null, isPending: false });
		unsubscribe();
		_emit({
			data: {
				session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
				user: { id: 'u1', email: 'test@example.com' },
			},
			isPending: false,
		});

		expect(states).toHaveLength(1);

		adapter.dispose();
	});
});
