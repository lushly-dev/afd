import { describe, expect, it } from 'vitest';
import { MockAuthAdapter } from './adapters/mock.js';
import { createAuthCommands } from './commands.js';

function findCommand(adapter: MockAuthAdapter, name: string) {
	const commands = createAuthCommands(adapter);
	const cmd = commands.find((c) => c.name === name);
	if (!cmd) throw new Error(`Command ${name} not found`);
	return cmd;
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

			const result = await signIn.handler({ method: 'credentials', email: 'test@example.com' });

			expect(result.success).toBe(true);
			expect(adapter.getSession().status).toBe('authenticated');
		});

		it('signs in with oauth', async () => {
			const adapter = new MockAuthAdapter();
			const signIn = findCommand(adapter, 'auth-sign-in');

			const result = await signIn.handler({ method: 'oauth', provider: 'github' });

			expect(result.success).toBe(true);
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
			const result = await signOut.handler({});

			expect(result.success).toBe(true);
			expect(adapter.getSession().status).toBe('unauthenticated');
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

			const result = await sessionGet.handler({});

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
