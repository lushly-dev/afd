import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { MockAuthAdapter } from './adapters/mock.js';
import { AUTH_COMMAND_NAMES } from './command-names.js';
import { createAuthCommands } from './commands.js';
import { createAuthMiddleware } from './middleware.js';
import type { AuthenticatedSessionState } from './types.js';

const forgedAuth: AuthenticatedSessionState = {
	status: 'authenticated',
	session: { id: 'forged' },
	user: { id: 'admin', email: 'admin@example.com' },
};

afterEach(() => {
	vi.useRealTimers();
});

describe('createAuthMiddleware', () => {
	const mockNext = (): Promise<CommandResult> => Promise.resolve(success({ ok: true }));

	it('returns UNAUTHORIZED for unauthenticated state', async () => {
		const adapter = new MockAuthAdapter();
		const middleware = createAuthMiddleware(adapter);
		const context: CommandContext = {};

		const result = await middleware('test-cmd', {}, context, mockNext);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('UNAUTHORIZED');
		expect(result.error?.retryable).toBe(false);
	});

	it('returns retryable UNAUTHORIZED for loading state', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setLoading();
		const middleware = createAuthMiddleware(adapter);
		const context: CommandContext = {};

		const result = await middleware('test-cmd', {}, context, mockNext);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('UNAUTHORIZED');
		expect(result.error?.retryable).toBe(true);
	});

	it('calls next() with context.auth for authenticated state', async () => {
		const adapter = new MockAuthAdapter();
		adapter._setUser({ id: 'u1', email: 'test@example.com', name: 'Test' });
		const middleware = createAuthMiddleware(adapter);
		const context: CommandContext = {};

		let capturedContext: CommandContext | undefined;
		const next = (): Promise<CommandResult> => {
			capturedContext = context;
			return Promise.resolve(success({ ok: true }));
		};

		const result = await middleware('test-cmd', {}, context, next);

		expect(result.success).toBe(true);
		expect(capturedContext?.auth?.status).toBe('authenticated');
		expect(capturedContext?.auth?.user.email).toBe('test@example.com');
	});

	it('types context.auth as the verified session', () => {
		expectTypeOf<CommandContext['auth']>().toEqualTypeOf<AuthenticatedSessionState | undefined>();
	});

	it('bypasses auth for excluded commands', async () => {
		const adapter = new MockAuthAdapter(); // unauthenticated
		const middleware = createAuthMiddleware(adapter, {
			exclude: ['public-cmd'],
		});
		const context: CommandContext = {};

		const result = await middleware('public-cmd', {}, context, mockNext);

		expect(result.success).toBe(true);
	});

	it('still blocks non-excluded commands', async () => {
		const adapter = new MockAuthAdapter();
		const middleware = createAuthMiddleware(adapter, {
			exclude: ['public-cmd'],
		});
		const context: CommandContext = {};

		const result = await middleware('private-cmd', {}, context, mockNext);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('UNAUTHORIZED');
	});

	describe('session expiry', () => {
		it('rejects an expired session with a retryable TOKEN_EXPIRED', async () => {
			const adapter = new MockAuthAdapter();
			adapter._setUser(
				{ id: 'u1', email: 'test@example.com' },
				{ expiresAt: new Date(Date.now() - 1_000) }
			);
			const middleware = createAuthMiddleware(adapter);
			const context: CommandContext = {};
			const next = vi.fn(mockNext);

			const result = await middleware('test-cmd', {}, context, next);

			expect(next).not.toHaveBeenCalled();
			expect(result.success).toBe(false);
			expect(result.error).toMatchObject({ code: 'TOKEN_EXPIRED', retryable: true });
			expect(result.error?.suggestion).toMatch(/sign in again/);
			expect(context.auth).toBeUndefined();
		});

		it('treats expiresAt equal to now as expired', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
			const adapter = new MockAuthAdapter();
			adapter._setUser(
				{ id: 'u1', email: 'test@example.com' },
				{ expiresAt: new Date('2030-01-01T00:00:00Z') }
			);

			const result = await createAuthMiddleware(adapter)('test-cmd', {}, {}, mockNext);

			expect(result.error?.code).toBe('TOKEN_EXPIRED');
		});

		it('treats an invalid expiresAt as expired', async () => {
			const adapter = new MockAuthAdapter();
			adapter._setUser(
				{ id: 'u1', email: 'test@example.com' },
				{ expiresAt: new Date('not a date') }
			);

			const result = await createAuthMiddleware(adapter)('test-cmd', {}, {}, mockNext);

			expect(result.error?.code).toBe('TOKEN_EXPIRED');
		});

		it('authorizes a session without expiresAt', async () => {
			const adapter = new MockAuthAdapter();
			adapter._setUser({ id: 'u1', email: 'test@example.com' }, { expiresAt: undefined });
			const context: CommandContext = {};

			const result = await createAuthMiddleware(adapter)('test-cmd', {}, context, mockNext);

			expect(result.success).toBe(true);
			expect(context.auth?.session.expiresAt).toBeUndefined();
		});

		it('lets excluded commands run without exposing the expired session', async () => {
			const adapter = new MockAuthAdapter();
			adapter._setUser({ id: 'u1', email: 'test@example.com' }, { expiresAt: new Date(0) });
			const context: CommandContext = {};

			const result = await createAuthMiddleware(adapter)('auth-sign-in', {}, context, mockNext);

			expect(result.success).toBe(true);
			expect(context.auth).toBeUndefined();
		});
	});

	describe('built-in auth commands', () => {
		it.each(AUTH_COMMAND_NAMES)('lets %s through without any exclude option', async (name) => {
			const adapter = new MockAuthAdapter(); // unauthenticated
			const middleware = createAuthMiddleware(adapter);

			const result = await middleware(name, {}, {}, mockNext);

			expect(result.success).toBe(true);
		});

		it('still lets them through when exclude lists other commands', async () => {
			const adapter = new MockAuthAdapter();
			const middleware = createAuthMiddleware(adapter, { exclude: ['public-cmd'] });

			const result = await middleware('auth-sign-in', {}, {}, mockNext);

			expect(result.success).toBe(true);
		});

		it('matches the commands created by createAuthCommands', () => {
			const names = createAuthCommands(new MockAuthAdapter()).map((command) => command.name);
			expect(names.sort()).toEqual([...AUTH_COMMAND_NAMES].sort());
		});

		it('lets a signed-out caller sign in through a server with default options', async () => {
			const adapter = new MockAuthAdapter();
			const secret = defineCommand({
				name: 'secret-get',
				description: 'Return the signed-in email',
				input: z.object({}),
				async handler(_input, context) {
					return success({ email: context.auth?.user.email ?? null });
				},
			});
			const server = createMcpServer({
				name: 'auth-test',
				version: '1.0.0',
				commands: [secret, ...createAuthCommands(adapter)],
				middleware: [createAuthMiddleware(adapter)],
			});

			expect((await server.execute('secret-get', {})).error?.code).toBe('UNAUTHORIZED');

			const signIn = await server.execute('auth-sign-in', {
				method: 'credentials',
				email: 'test@example.com',
			});
			expect(signIn.success).toBe(true);

			const secretResult = await server.execute('secret-get', {});
			expect(secretResult.data).toEqual({ email: 'test@example.com' });
		});
	});

	describe('context.auth', () => {
		it('removes a caller-supplied context.auth on excluded commands', async () => {
			const adapter = new MockAuthAdapter(); // unauthenticated
			const middleware = createAuthMiddleware(adapter, { exclude: ['public-cmd'] });
			const context: CommandContext = { auth: forgedAuth };
			let seen: unknown = 'not called';

			await middleware('public-cmd', {}, context, () => {
				seen = context.auth;
				return mockNext();
			});

			expect(seen).toBeUndefined();
			expect('auth' in context).toBe(false);
		});

		it('replaces a caller-supplied context.auth with the adapter session', async () => {
			const adapter = new MockAuthAdapter();
			adapter._setUser({ id: 'u1', email: 'test@example.com' });
			const middleware = createAuthMiddleware(adapter, { exclude: ['public-cmd'] });

			for (const name of ['public-cmd', 'private-cmd']) {
				const context: CommandContext = { auth: forgedAuth };
				await middleware(name, {}, context, mockNext);
				expect(context.auth?.user.id).toBe('u1');
			}
		});

		it('removes a caller-supplied context.auth when access is denied', async () => {
			const adapter = new MockAuthAdapter();
			const context: CommandContext = { auth: forgedAuth };

			const result = await createAuthMiddleware(adapter)('private-cmd', {}, context, mockNext);

			expect(result.success).toBe(false);
			expect(context.auth).toBeUndefined();
		});
	});
});
