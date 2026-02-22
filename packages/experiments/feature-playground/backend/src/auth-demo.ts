/**
 * Auth Adapter Demo
 *
 * Exercises: MockAuthAdapter, createAuthMiddleware, createAuthCommands
 */

import { MockAuthAdapter, createAuthCommands, createAuthMiddleware } from '@lushly-dev/afd-auth';
import { success } from '@lushly-dev/afd-core';
import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

const log = (label: string, data: unknown) =>
	console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}\n`, JSON.stringify(data, null, 2));

async function run() {
	console.log('\n🔐  Auth Adapter Demo\n');

	// ── 1. Create adapter and auth commands ──────────────────────────────
	const auth = new MockAuthAdapter({ delay: 50 });
	const authCommands = createAuthCommands(auth);
	const authMiddleware = createAuthMiddleware(auth, {
		exclude: ['auth-sign-in', 'auth-session-get'],
	});

	// ── 2. Define a protected command ────────────────────────────────────
	const secretCommand = defineCommand({
		name: 'secret-data',
		description: 'Return sensitive data (auth required)',
		input: z.object({}),
		async handler(_input, context) {
			const authState = context.auth as { user: { email: string } };
			return success(
				{ message: `Hello ${authState.user.email}, here is secret data` },
				{ confidence: 1, reasoning: 'Authenticated user' },
			);
		},
	});

	// ── 3. Build server with auth middleware ─────────────────────────────
	const server = createMcpServer({
		name: 'auth-demo',
		version: '1.0.0',
		commands: [secretCommand, ...authCommands],
		middleware: [authMiddleware],
		transport: 'stdio',
	});

	// ── Test: Get session (should be unauthenticated) ────────────────────
	const session1 = await server.execute('auth-session-get', {});
	log('Session (before sign-in)', session1);

	// ── Test: Access protected command while unauthenticated ─────────────
	const denied = await server.execute('secret-data', {});
	log('Protected command (unauthenticated)', denied);
	console.assert(!denied.success, '  ✗ Should be denied');
	console.assert(denied.error?.code === 'UNAUTHORIZED', '  ✗ Should be UNAUTHORIZED');

	// ── Test: Sign in via credentials ────────────────────────────────────
	const signIn = await server.execute('auth-sign-in', {
		method: 'credentials',
		email: 'demo@example.com',
	});
	log('Sign-in result', signIn);
	console.assert(signIn.success, '  ✗ Sign-in should succeed');

	// ── Test: Access protected command while authenticated ────────────────
	const allowed = await server.execute('secret-data', {});
	log('Protected command (authenticated)', allowed);
	console.assert(allowed.success, '  ✗ Should be allowed');

	// ── Test: Sign out ───────────────────────────────────────────────────
	const signOut = await server.execute('auth-sign-out', {});
	log('Sign-out result', signOut);

	// ── Test: Verify session cleared ─────────────────────────────────────
	const session2 = await server.execute('auth-session-get', {});
	log('Session (after sign-out)', session2);

	// ── Test: Protected command rejected again ───────────────────────────
	const denied2 = await server.execute('secret-data', {});
	log('Protected command (after sign-out)', denied2);
	console.assert(!denied2.success, '  ✗ Should be denied after sign-out');

	await server.stop();
	console.log('\n✅  Auth demo complete\n');
}

run().catch(console.error);
