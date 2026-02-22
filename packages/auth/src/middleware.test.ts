import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { MockAuthAdapter } from './adapters/mock.js';
import { createAuthMiddleware } from './middleware.js';

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
		expect(capturedContext?.auth).toBeDefined();
		const auth = capturedContext?.auth as { status: string; user: { email: string } };
		expect(auth.status).toBe('authenticated');
		expect(auth.user.email).toBe('test@example.com');
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
});
