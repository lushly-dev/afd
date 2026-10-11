/** Real Better Auth server/client over loopback HTTP; no external account or mock provider. */
import { once } from 'node:events';
import { createServer } from 'node:http';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthClient } from 'better-auth/client';
import { toNodeHandler } from 'better-auth/node';
import { expect, it, onTestFinished } from 'vitest';
import { BetterAuthAdapter } from './better-auth.js';

it('maps a real provider cookie/session lifecycle and invalid credentials', async () => {
	const database = { user: [], session: [], account: [], verification: [] };
	const server = createServer();
	onTestFinished(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected loopback address');
	const baseURL = `http://127.0.0.1:${address.port}`;
	const auth = betterAuth({
		baseURL,
		secret: 'afd-local-integration-secret-at-least-32-characters',
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		advanced: { useSecureCookies: false },
		logger: { disabled: true },
	});
	server.on('request', toNodeHandler(auth));
	// Node fetch has no browser cookie jar. Forward only this test origin's cookies;
	// requests still cross the socket and all provider/session behavior is real.
	const cookies = new Map<string, string>();
	let cookieWrites = 0;
	const client = createAuthClient({
		baseURL,
		fetchOptions: {
			customFetchImpl: async (input, init) => {
				expect(new URL(input instanceof Request ? input.url : String(input)).origin).toBe(baseURL);
				const headers = new Headers(init?.headers);
				headers.set('origin', baseURL);
				headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
				const response = await fetch(input, { ...init, headers });
				for (const cookie of response.headers.getSetCookie()) {
					const pair = cookie.split(';')[0] ?? '';
					const index = pair.indexOf('=');
					const key = pair.slice(0, index);
					const value = pair.slice(index + 1);
					if (/max-age=0/i.test(cookie) || !value) cookies.delete(key);
					else cookies.set(key, value);
					cookieWrites++;
				}
				return response;
			},
		},
	});
	const adapter = new BetterAuthAdapter({ client });
	const states: string[] = [];
	const subscription = adapter.onAuthStateChange((state) => states.push(state.status));
	try {
		await client.useSession.get().refetch();
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('unauthenticated');
		const credentials = {
			email: 'afd-integration@example.test',
			password: 'local-test-password-123',
		};
		const signup = await client.signUp.email({ ...credentials, name: 'AFD integration' });
		expect(signup.error).toBeNull();
		expect(cookieWrites).toBeGreaterThan(0);
		expect(cookies.size).toBeGreaterThan(0);
		await client.useSession.get().refetch();
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('authenticated');
		const registered = adapter.getSession();
		expect(registered).toMatchObject({
			status: 'authenticated',
			user: { email: credentials.email },
		});
		await adapter.signOut();
		await client.useSession.get().refetch();
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('unauthenticated');
		await expect(
			adapter.signIn({ method: 'credentials', ...credentials, password: 'wrong' })
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('unauthenticated');
		await expect(adapter.signIn({ method: 'credentials', ...credentials })).resolves.toEqual({
			kind: 'signed-in',
		});
		await client.useSession.get().refetch();
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('authenticated');
		const signedIn = adapter.getSession();
		expect(signedIn.status).toBe('authenticated');
		if (signedIn.status !== 'authenticated') throw new Error('Expected authenticated state');
		expect(signedIn.session.expiresAt?.getTime()).toBeGreaterThan(Date.now());
		// Independent provider read proves the adapter snapshot corresponds to the cookie session.
		const readback = await fetch(`${baseURL}/api/auth/get-session`, {
			headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
		});
		expect(await readback.json()).toMatchObject({ session: { id: signedIn.session.id } });
		const oldCookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
		await adapter.signOut();
		await client.useSession.get().refetch();
		await expect
			.poll(async () => {
				await client.useSession.get().refetch();
				return adapter.getSession().status;
			})
			.toBe('unauthenticated');
		expect(
			await (
				await fetch(`${baseURL}/api/auth/get-session`, {
					headers: { cookie: oldCookie },
				})
			).json()
		).toBeNull();
		expect(database.session).toHaveLength(0);
		expect(states).toContain('authenticated');
		await expect.poll(() => adapter.getSession().status).toBe('unauthenticated');
		expect(states.at(-1)).toBe('unauthenticated');
	} finally {
		subscription.unsubscribe();
		adapter.dispose();
		cookies.clear();
	}
}, 15_000);
