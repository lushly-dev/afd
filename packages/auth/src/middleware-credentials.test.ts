/**
 * The credentials backstop (Loam phase 3, 4.1): a call whose `credentials` afd-server set itself,
 * after verifying the call's token, keeps its actor and is not decided by the adapter's session;
 * `credentials` a caller supplies are not recognised, whatever their fields.
 */

import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock, success } from '@lushly-dev/afd-core';
import { createDirectRegistry, defineCommand } from '@lushly-dev/afd-server';
import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
// Test-only: no entry exports the brand, so reach afd-server's built module directly. It is the
// same module `@lushly-dev/afd-server/credentials` imports (pnpm links the workspace package),
// so what it brands is what `isVerifiedCredentials` recognises.
import {
	brandVerifiedCredentials,
	unbrandVerifiedCredentials,
} from '../node_modules/@lushly-dev/afd-server/dist/verified-credentials.js';
import { MockAuthAdapter } from './adapters/mock.js';
import { AUTH_COMMAND_NAMES } from './command-names.js';
import { createAuthMiddleware } from './middleware.js';
import type { AuthenticatedSessionState } from './types.js';

const tokenActor: Actor = { kind: 'agent', id: 'client-1', onBehalfOf: 'token-subject' };

function credentialsFields() {
	return {
		issuer: 'https://issuer.example',
		subject: 'token-subject',
		clientId: 'client-1',
		scopes: ['read'],
		resource: 'https://server.example/mcp',
		expiresAt: 2_000_000_000,
		issuedAt: 1_900_000_000,
	};
}

const forgedAuth: AuthenticatedSessionState = {
	status: 'authenticated',
	session: { id: 'forged' },
	user: { id: 'admin', email: 'admin@example.com' },
};

function run(adapter: MockAuthAdapter, context: CommandContext, withPredicate = true) {
	const middleware = createAuthMiddleware(adapter, withPredicate ? { isVerifiedCredentials } : {});
	let seen: CommandContext | undefined;
	const next = (): Promise<CommandResult> => {
		seen = { ...context };
		return Promise.resolve(success({ ok: true }));
	};
	return middleware('todo-list', {}, context, next).then((result) => ({ result, seen }));
}

describe('afd-server credentials brand', () => {
	it('recognises only the object afd-server branded', () => {
		const branded = brandVerifiedCredentials(credentialsFields());
		expect(isVerifiedCredentials(branded)).toBe(true);
		expect(isVerifiedCredentials(credentialsFields())).toBe(false);
		expect(isVerifiedCredentials({ ...branded })).toBe(false);
		expect(isVerifiedCredentials(structuredClone(branded))).toBe(false);
		expect(isVerifiedCredentials(Object.create(branded))).toBe(false);
		for (const value of [undefined, null, 'credentials', 1, true]) {
			expect(isVerifiedCredentials(value)).toBe(false);
		}
	});
});

describe('createAuthMiddleware with verified credentials', () => {
	it('runs a verified call with the adapter signed out, keeping its actor', async () => {
		const adapter = new MockAuthAdapter();
		const credentials = brandVerifiedCredentials(credentialsFields());
		const context: CommandContext = { actor: { ...tokenActor }, credentials };

		const { result, seen } = await run(adapter, context);

		expect(result.success).toBe(true);
		expect(seen?.actor).toEqual(tokenActor);
		expect(seen?.credentials).toBe(credentials);
		expect(seen && 'auth' in seen).toBe(false);
	});

	it('runs a verified call with the session loading or expired, never reading it', async () => {
		const loading = new MockAuthAdapter();
		loading._setLoading();
		const expired = new MockAuthAdapter();
		expired._setUser({ id: 'u1', email: 'a@example.com' }, { expiresAt: new Date(0) });
		for (const adapter of [loading, expired]) {
			const context: CommandContext = {
				actor: { ...tokenActor },
				credentials: brandVerifiedCredentials(credentialsFields()),
			};
			const { result, seen } = await run(adapter, context);
			expect(result.success).toBe(true);
			expect(seen?.actor).toEqual(tokenActor);
		}
	});

	it('keeps the actor when the adapter is signed in as someone else', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setUser({ id: 'session-user', email: 'session@example.com', name: 'Session' });
		const context: CommandContext = {
			actor: { ...tokenActor },
			credentials: brandVerifiedCredentials(credentialsFields()),
		};

		const { result, seen } = await run(adapter, context);

		expect(result.success).toBe(true);
		expect(seen?.actor).toEqual(tokenActor);
		expect(seen?.actor?.onBehalfOf).toBe('token-subject');
		expect(seen && 'auth' in seen).toBe(false);
	});

	it('keeps a human actor, and no actor, as they are', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setUser({ id: 'session-user', email: 'session@example.com' });
		const human: Actor = { kind: 'human', id: 'token-subject' };
		const withHuman = await run(adapter, {
			actor: { ...human },
			credentials: brandVerifiedCredentials(credentialsFields()),
		});
		expect(withHuman.seen?.actor).toEqual(human);

		const withNone = await run(adapter, {
			credentials: brandVerifiedCredentials(credentialsFields()),
		});
		expect(withNone.seen?.actor).toBeUndefined();
	});

	it('deletes a caller-supplied auth on a verified call', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setUser({ id: 'session-user', email: 'session@example.com' });
		const context: CommandContext = {
			actor: { ...tokenActor },
			credentials: brandVerifiedCredentials(credentialsFields()),
			auth: forgedAuth,
		};

		const { result, seen } = await run(adapter, context);

		expect(result.success).toBe(true);
		expect(seen && 'auth' in seen).toBe(false);
		expect(context.auth).toBeUndefined();
	});

	it('without the predicate, treats verified credentials like any others (fails closed)', async () => {
		const signedOut = new MockAuthAdapter();
		const credentials = brandVerifiedCredentials(credentialsFields());
		const refused = await run(signedOut, { actor: { ...tokenActor }, credentials }, false);
		expect(refused.result.error?.code).toBe('UNAUTHORIZED');

		const signedIn = new MockAuthAdapter();
		signedIn._setUser({ id: 'session-user', email: 'session@example.com' });
		const stamped = await run(signedIn, { actor: { ...tokenActor }, credentials }, false);
		expect(stamped.seen?.actor?.onBehalfOf).toBe('session-user');
	});

	it('only a predicate answering exactly true counts', async () => {
		const adapter = new MockAuthAdapter();
		const middleware = createAuthMiddleware(adapter, {
			isVerifiedCredentials: (() => 'yes') as unknown as (credentials: unknown) => boolean,
		});
		const result = await middleware('todo-list', {}, { credentials: credentialsFields() }, () =>
			Promise.resolve(success({ ok: true }))
		);
		expect(result.error?.code).toBe('UNAUTHORIZED');
	});
});

describe('createAuthMiddleware with forged credentials', () => {
	it('gives a caller’s own credentials no actor and no pass when signed out', async () => {
		const adapter = new MockAuthAdapter();
		const context: CommandContext = { actor: { ...tokenActor }, credentials: credentialsFields() };

		const { result, seen } = await run(adapter, context);

		expect(result.error?.code).toBe('UNAUTHORIZED');
		expect(seen).toBeUndefined();
	});

	it('stamps the session user over a forged call’s actor, as without credentials', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setUser({ id: 'session-user', email: 'session@example.com', name: 'Session' });
		const copied = { ...brandVerifiedCredentials(credentialsFields()) };

		const agent = await run(adapter, { actor: { ...tokenActor }, credentials: copied });
		expect(agent.seen?.actor).toEqual({ ...tokenActor, onBehalfOf: 'session-user' });
		expect(agent.seen?.auth).toEqual(adapter.getSession());

		const human = await run(adapter, {
			actor: { kind: 'human', id: 'token-subject' },
			credentials: credentialsFields(),
			auth: forgedAuth,
		});
		expect(human.seen?.actor).toEqual({ kind: 'human', id: 'session-user', label: 'Session' });
		expect(human.seen?.auth).toEqual(adapter.getSession());
	});

	it('through a direct registry, a caller’s credentials get no actor from them', async () => {
		const adapter = new MockAuthAdapter();
		const whoami = defineCommand({
			name: 'whoami',
			description: 'Return the actor',
			input: z.object({}),
			handler: async (_input, context) => success({ actor: context.actor ?? null }),
		});
		const registry = createDirectRegistry([whoami], {
			middleware: [createAuthMiddleware(adapter, { isVerifiedCredentials })],
		});
		const forged = { actor: { ...tokenActor }, credentials: credentialsFields() };

		const signedOut = await registry.execute('whoami', {}, { ...forged });
		expect(signedOut.success).toBe(false);
		expect(signedOut.error?.code).toBe('UNAUTHORIZED');

		adapter._setUser({ id: 'session-user', email: 'session@example.com' });
		const signedIn = await registry.execute('whoami', {}, { ...forged });
		expect(signedIn.data).toEqual({ actor: { ...tokenActor, onBehalfOf: 'session-user' } });

		// The same call with credentials afd-server branded keeps the token's actor.
		const verified = await registry.execute(
			'whoami',
			{},
			{ actor: { ...tokenActor }, credentials: brandVerifiedCredentials(credentialsFields()) }
		);
		expect(verified.data).toEqual({ actor: tokenActor });
	});
});

describe('createAuthMiddleware: a token has no session', () => {
	it.each([...AUTH_COMMAND_NAMES])(
		'refuses a verified %s without reading the adapter',
		async (name) => {
			const adapter = new MockAuthAdapter();
			adapter._setUser({ id: 'session-user', email: 'session@example.com' });
			let reads = 0;
			const getSession = adapter.getSession.bind(adapter);
			adapter.getSession = () => {
				reads += 1;
				return getSession();
			};
			const middleware = createAuthMiddleware(adapter, { isVerifiedCredentials });
			let ran = false;
			const context: CommandContext = {
				actor: { ...tokenActor },
				credentials: brandVerifiedCredentials(credentialsFields()),
				auth: forgedAuth,
			};

			const result = await middleware(name, {}, context, () => {
				ran = true;
				return Promise.resolve(success({ ok: true }));
			});

			expect(result.success).toBe(false);
			expect(result.error).toMatchObject({
				code: 'UNAUTHORIZED',
				retryable: false,
				suggestion: 'This call is authorized by a token; session commands need a signed-in session',
			});
			expect(ran).toBe(false);
			expect(reads).toBe(0);
			expect(context.auth).toBeUndefined();
			expect(context.actor).toEqual(tokenActor);
		}
	);

	it('still lets an unbranded caller run the auth commands, as before', async () => {
		const adapter = new MockAuthAdapter();
		const middleware = createAuthMiddleware(adapter, { isVerifiedCredentials });
		const result = await middleware(
			'auth-session-get',
			{},
			{ credentials: credentialsFields() },
			() => Promise.resolve(success({ ok: true }))
		);
		expect(result.success).toBe(true);
	});
});

describe('createAuthMiddleware clock', () => {
	// Far from wall time either way, so the system clock would answer differently.
	const PAST = Date.parse('2001-01-01T00:00:00Z');
	const FUTURE = Date.parse('2101-01-01T00:00:00Z');

	it('compares the Mock’s expiresAt with the clock it is given', async () => {
		const clock = fixedClock(PAST);
		const adapter = new MockAuthAdapter({ clock });
		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		const next = () => Promise.resolve(success({ ok: true }));

		// The Mock's session expires in 2001: on the system clock every gated call would fail.
		expect((await createAuthMiddleware(adapter)('todo-list', {}, {}, next)).error?.code).toBe(
			'TOKEN_EXPIRED'
		);
		const middleware = createAuthMiddleware(adapter, { clock });
		expect((await middleware('todo-list', {}, {}, next)).success).toBe(true);
		clock.advance(3600_000);
		expect((await middleware('todo-list', {}, {}, next)).error?.code).toBe('TOKEN_EXPIRED');
	});

	it('expires a session in the clock’s future that the system clock would keep', async () => {
		const clock = fixedClock(FUTURE);
		const adapter = new MockAuthAdapter({ clock });
		await adapter.signIn({ method: 'credentials', email: 'ada@example.test' });
		clock.advance(3600_000);
		const next = () => Promise.resolve(success({ ok: true }));
		expect((await createAuthMiddleware(adapter)('todo-list', {}, {}, next)).success).toBe(true);
		expect(
			(await createAuthMiddleware(adapter, { clock })('todo-list', {}, {}, next)).error?.code
		).toBe('TOKEN_EXPIRED');
	});

	it('gives isVerifiedCredentials its clock, so expired credentials get no pass', async () => {
		const credentials = brandVerifiedCredentials(credentialsFields());
		const expiry = credentialsFields().expiresAt * 1000;
		const adapter = new MockAuthAdapter();
		const next = () => Promise.resolve(success({ ok: true }));
		const before = createAuthMiddleware(adapter, {
			isVerifiedCredentials,
			clock: fixedClock(expiry - 1),
		});
		expect((await before('todo-list', {}, { credentials }, next)).success).toBe(true);
		const after = createAuthMiddleware(adapter, {
			isVerifiedCredentials,
			clock: fixedClock(expiry),
		});
		// Signed out and expired: the session treatment, so UNAUTHORIZED.
		expect((await after('todo-list', {}, { credentials }, next)).error?.code).toBe('UNAUTHORIZED');
	});

	it('gives no pass to credentials whose request has ended', async () => {
		const credentials = brandVerifiedCredentials(credentialsFields());
		const adapter = new MockAuthAdapter();
		const middleware = createAuthMiddleware(adapter, { isVerifiedCredentials });
		const next = () => Promise.resolve(success({ ok: true }));
		expect((await middleware('todo-list', {}, { credentials }, next)).success).toBe(true);
		unbrandVerifiedCredentials(credentials);
		expect((await middleware('todo-list', {}, { credentials }, next)).error?.code).toBe(
			'UNAUTHORIZED'
		);
	});
});
