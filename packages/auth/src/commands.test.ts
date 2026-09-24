import { describe, expect, it, vi } from 'vitest';
import { BetterAuthAdapter } from './adapters/better-auth.js';
import { MockAuthAdapter } from './adapters/mock.js';
import { type AuthCommandsOptions, createAuthCommands } from './commands.js';
import { AuthAdapterError } from './errors.js';
import type { AuthAdapter, AuthSessionState, SignInOutcome } from './types.js';
import { LOADING, UNAUTHENTICATED } from './types.js';

function findCommand(adapter: AuthAdapter, name: string, options?: AuthCommandsOptions) {
	const commands = createAuthCommands(adapter, options);
	const cmd = commands.find((c) => c.name === name);
	if (!cmd) throw new Error(`Command ${name} not found`);
	return cmd;
}

const signedIn: AuthSessionState = {
	status: 'authenticated',
	session: { id: 's1', expiresAt: new Date('2030-01-01T00:00:00Z') },
	user: { id: 'u1', email: 'test@example.com' },
};

/**
 * A hand-driven adapter: `signIn` resolves with `outcome` and the test decides
 * when (and whether) the state changes and listeners hear about it.
 */
function createScriptedAdapter(outcome?: unknown) {
	let state: AuthSessionState = UNAUTHENTICATED;
	const listeners = new Set<(state: AuthSessionState) => void>();
	const adapter: AuthAdapter & {
		emit: (next: AuthSessionState) => void;
		set: (next: AuthSessionState) => void;
		listenerCount: () => number;
	} = {
		signIn: vi.fn(async () => outcome as SignInOutcome | undefined),
		signOut: vi.fn(async () => {}),
		getSession: () => state,
		onAuthStateChange: (callback) => {
			listeners.add(callback);
			return { unsubscribe: () => listeners.delete(callback) };
		},
		emit: (next) => {
			state = next;
			for (const listener of listeners) listener(next);
		},
		set: (next) => {
			state = next;
		},
		listenerCount: () => listeners.size,
	};
	return adapter;
}

/** A Better Auth client whose session store updates after sign-in, like the real one. */
function createAsyncBetterAuthClient() {
	type StoreValue = {
		data: {
			session: { id: string; expiresAt: string };
			user: { id: string; email: string };
		} | null;
		isPending: boolean;
	};
	let value: StoreValue = { data: null, isPending: false };
	let subscriber: ((value: StoreValue) => void) | null = null;
	const emit = (next: StoreValue) => {
		value = next;
		subscriber?.(next);
	};
	const client = {
		signIn: {
			email: vi.fn(async () => {
				// The session signal refetches after the response has resolved.
				setTimeout(() => emit({ data: null, isPending: true }), 5);
				setTimeout(
					() =>
						emit({
							data: {
								session: { id: 's1', expiresAt: '2030-01-01T00:00:00Z' },
								user: { id: 'u1', email: 'test@example.com' },
							},
							isPending: false,
						}),
					15
				);
				return { data: { redirect: false, token: 't' }, error: null };
			}),
			social: vi.fn(async () => ({
				data: { url: 'https://auth.example.com/authorize', redirect: true },
				error: null,
			})),
		},
		signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
		useSession: () => ({
			subscribe: (callback: (value: StoreValue) => void) => {
				subscriber = callback;
				return () => {
					subscriber = null;
				};
			},
			get: () => value,
		}),
	};
	return client;
}

describe('createAuthCommands', () => {
	it('returns three command definitions', () => {
		const adapter = new MockAuthAdapter();
		const commands = createAuthCommands(adapter);
		expect(commands).toHaveLength(3);

		const names = commands.map((c) => c.name);
		expect(names).toContain('auth-sign-in');
		expect(names).toContain('auth-sign-out');
		expect(names).toContain('auth-session-get');
	});

	describe('auth-sign-in', () => {
		it('signs in with credentials', async () => {
			const adapter = new MockAuthAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'credentials', email: 'test@example.com' }, {});

			expect(result.success).toBe(true);
			expect(adapter.getSession().status).toBe('authenticated');
			expect(result.data).toBe(adapter.getSession());
			expect(adapter._getListenerCount()).toBe(0);
		});

		it('signs in with oauth', async () => {
			const adapter = new MockAuthAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'oauth', provider: 'github' }, {});

			expect(result.success).toBe(true);
		});

		it('returns the new session reported asynchronously by the adapter', async () => {
			const adapter = new BetterAuthAdapter({ client: createAsyncBetterAuthClient() });
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler(
				{ method: 'credentials', email: 'test@example.com', password: 'pass' },
				{}
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(
				expect.objectContaining({
					status: 'authenticated',
					user: expect.objectContaining({ email: 'test@example.com' }),
				})
			);
			expect(result.reasoning).toBe('Signed in via credentials as test@example.com');
			expect(result.warnings).toBeUndefined();
			adapter.dispose();
		});

		it('reports an OAuth redirect honestly instead of claiming a sign-in', async () => {
			const adapter = new BetterAuthAdapter({ client: createAsyncBetterAuthClient() });
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'oauth', provider: 'github' }, {});

			expect(result.success).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({ status: 'unauthenticated' }));
			expect(result.reasoning).toMatch(/^Not signed in yet: sign-in via github continues/);
			expect(result.warnings).toEqual([
				expect.objectContaining({
					code: 'SIGN_IN_REDIRECT',
					details: { url: 'https://auth.example.com/authorize' },
				}),
			]);
			adapter.dispose();
		});

		it('reports a redirect without a url', async () => {
			const adapter = createScriptedAdapter({ kind: 'redirect' });
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'oauth', provider: 'google' }, {});

			expect(result.warnings).toEqual([
				{
					code: 'SIGN_IN_REDIRECT',
					message: 'Sign-in via google continues at the provider',
					severity: 'info',
				},
			]);
		});

		it('reports a sign-in that needs another step as pending', async () => {
			const adapter = createScriptedAdapter({ kind: 'pending' });
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});

			expect(result.success).toBe(true);
			expect(result.data).toEqual(UNAUTHENTICATED);
			expect(result.reasoning).toMatch(/needs another step/);
			expect(result.warnings?.[0]?.code).toBe('SIGN_IN_PENDING');
		});

		it('returns an honest pending result when no session arrives in time', async () => {
			const adapter = createScriptedAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in', { signInTimeoutMs: 20 });

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});

			expect(result.success).toBe(true);
			expect(result.data).toEqual(UNAUTHENTICATED);
			expect(result.reasoning).toBe(
				'Not signed in yet: the sign-in via credentials was accepted, but no session was confirmed within 20 ms (status: unauthenticated)'
			);
			expect(result.warnings?.[0]?.code).toBe('SIGN_IN_PENDING');
			expect(result.suggestions).toContain(
				'Call auth-session-get to check whether the session is active'
			);
			expect(adapter.listenerCount()).toBe(0);
		});

		it('waits past loading states for the settled session', async () => {
			const adapter = createScriptedAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');
			vi.mocked(adapter.signIn).mockImplementation(async () => {
				adapter.emit(LOADING);
				setTimeout(() => adapter.emit(signedIn), 5);
				return undefined;
			});

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});

			expect(result.data).toBe(signedIn);
			expect(adapter.listenerCount()).toBe(0);
		});

		it('fails when the provider settles on no session after sign-in', async () => {
			const adapter = createScriptedAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');
			vi.mocked(adapter.signIn).mockImplementation(async () => {
				setTimeout(() => adapter.emit(LOADING), 1);
				setTimeout(() => adapter.emit(UNAUTHENTICATED), 5);
				return { kind: 'signed-in' };
			});

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});

			expect(result.success).toBe(false);
			expect(result.error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
			expect(result.error?.suggestion).toBeTruthy();
		});

		it('returns immediately when the adapter updated its state without emitting', async () => {
			const adapter = createScriptedAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in', { signInTimeoutMs: 60_000 });
			vi.mocked(adapter.signIn).mockImplementation(async () => {
				adapter.set(signedIn);
				return undefined;
			});

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});

			expect(result.data).toBe(signedIn);
		});

		it('reports an unchanged existing session as signed in after the wait', async () => {
			const adapter = createScriptedAdapter({ kind: 'signed-in' });
			adapter.set(signedIn);
			const signIn = findCommand(adapter, 'auth-sign-in', { signInTimeoutMs: 10 });

			const result = await signIn.handler({ method: 'oauth', provider: 'github' }, {});

			expect(result.success).toBe(true);
			expect(result.data).toBe(signedIn);
			expect(result.reasoning).toBe('Signed in via github as test@example.com');
		});

		it('ignores a resolved value that is not a sign-in outcome', async () => {
			const adapter = createScriptedAdapter({ data: { url: 'https://x.example' }, kind: 'other' });
			const signIn = findCommand(adapter, 'auth-sign-in', { signInTimeoutMs: 10 });

			const result = await signIn.handler({ method: 'oauth', provider: 'github' }, {});

			expect(result.warnings?.[0]?.code).toBe('SIGN_IN_PENDING');
		});

		it('maps adapter errors to failures and rethrows other errors', async () => {
			const adapter = createScriptedAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');
			vi.mocked(adapter.signIn).mockRejectedValueOnce(AuthAdapterError.invalidCredentials());

			const result = await signIn.handler({ method: 'credentials', email: 'a@example.com' }, {});
			expect(result.success).toBe(false);
			expect(result.error).toMatchObject({
				code: 'INVALID_CREDENTIALS',
				suggestion: 'Check your credentials and try again',
				retryable: false,
			});

			vi.mocked(adapter.signIn).mockRejectedValueOnce(new Error('unexpected'));
			await expect(
				signIn.handler({ method: 'credentials', email: 'a@example.com' }, {})
			).rejects.toThrow('unexpected');
			expect(adapter.listenerCount()).toBe(0);
		});

		it('has correct expose settings (no mcp)', () => {
			const adapter = new MockAuthAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');

			expect(signIn.expose).toEqual({
				palette: true,
				agent: true,
				cli: true,
				mcp: false,
			});
		});
	});

	describe('auth-sign-out', () => {
		it('signs out', async () => {
			const adapter = new MockAuthAdapter();
			await adapter.signIn({ method: 'credentials', email: 'test@example.com' });

			const signOut = findCommand(adapter, 'auth-sign-out');
			const result = await signOut.handler({}, {});

			expect(result.success).toBe(true);
			expect(adapter.getSession().status).toBe('unauthenticated');
		});

		it('maps adapter errors to failures and rethrows other errors', async () => {
			const adapter = createScriptedAdapter();
			const signOut = findCommand(adapter, 'auth-sign-out');
			vi.mocked(adapter.signOut).mockRejectedValueOnce(AuthAdapterError.networkError());

			const result = await signOut.handler({}, {});
			expect(result.error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

			vi.mocked(adapter.signOut).mockRejectedValueOnce(new Error('unexpected'));
			await expect(signOut.handler({}, {})).rejects.toThrow('unexpected');
		});

		it('has correct expose settings (no mcp)', () => {
			const adapter = new MockAuthAdapter();
			const signOut = findCommand(adapter, 'auth-sign-out');

			expect(signOut.expose).toEqual({
				palette: true,
				agent: true,
				cli: true,
				mcp: false,
			});
		});
	});

	describe('auth-session-get', () => {
		it('returns current session state', async () => {
			const adapter = new MockAuthAdapter();
			const sessionGet = findCommand(adapter, 'auth-session-get');

			const result = await sessionGet.handler({}, {});

			expect(result.success).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({ status: 'unauthenticated' }));
		});

		it('has mcp exposed', () => {
			const adapter = new MockAuthAdapter();
			const sessionGet = findCommand(adapter, 'auth-session-get');

			expect(sessionGet.expose?.mcp).toBe(true);
		});
	});

	it('all commands have auth category and tags', () => {
		const adapter = new MockAuthAdapter();
		const commands = createAuthCommands(adapter);

		for (const cmd of commands) {
			expect(cmd.category).toBe('auth');
			expect(cmd.tags).toContain('auth');
			expect(cmd.tags).toContain('session');
		}
	});
});
