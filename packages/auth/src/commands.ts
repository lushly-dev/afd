/**
 * @fileoverview AFD command wrappers for auth operations
 *
 * Requires optional peer dependencies: @lushly-dev/afd-server, zod
 */

// The transport-free entry keeps this module free of the MCP SDK and Node builtins.
import {
	defineCommand,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import { AuthAdapterError } from './errors.js';
import { areSessionStatesEqual } from './session-state.js';
import type { AuthAdapter, AuthSessionState, SignInOptions, SignInOutcome } from './types.js';

export interface AuthCommandsOptions {
	/**
	 * How long `auth-sign-in` waits, after the adapter's `signIn()` resolves,
	 * for the adapter to report the new session through `onAuthStateChange`,
	 * in milliseconds (default: 10_000). When the wait runs out, the command
	 * returns the current state with a `SIGN_IN_PENDING` warning.
	 */
	signInTimeoutMs?: number;
}

const DEFAULT_SIGN_IN_TIMEOUT_MS = 10_000;
const SESSION_GET_SUGGESTION = 'Call auth-session-get to check whether the session is active';

/**
 * Create AFD command definitions for auth operations.
 *
 * Returns ZodCommandDefinition[] that can be passed directly to `createMcpServer`.
 * Requires `@lushly-dev/afd-server` and `zod` as peer dependencies.
 */
export function createAuthCommands(
	adapter: AuthAdapter,
	options: AuthCommandsOptions = {}
): ZodCommandDefinition[] {
	const signInTimeoutMs = options.signInTimeoutMs ?? DEFAULT_SIGN_IN_TIMEOUT_MS;

	const signIn = defineCommand({
		name: 'auth-sign-in',
		description:
			'Sign in with credentials or OAuth provider. Returns the new session, or the current state with a warning when sign-in continues at the provider (redirect) or has not completed yet.',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: true,
		expose: { palette: true, agent: true, cli: true, mcp: false },
		input: z.discriminatedUnion('method', [
			z.object({
				method: z.literal('credentials'),
				email: z.string().email(),
				password: z.string().optional(),
			}),
			z.object({
				method: z.literal('oauth'),
				provider: z.string(),
				scopes: z.array(z.string()).optional(),
				redirectTo: z.string().optional(),
			}),
		]),
		async handler(input) {
			const before = adapter.getSession();
			// Subscribe before signIn() so a state change it triggers is not missed.
			const watcher = watchAuthState(adapter);
			try {
				const outcome = toOutcome(await adapter.signIn(input));
				if (outcome?.kind === 'redirect' || outcome?.kind === 'pending') {
					return incompleteSignIn(adapter.getSession(), input, outcome);
				}
				const settled = await watcher.settle(before, signInTimeoutMs);
				return settledSignIn(adapter.getSession(), settled, input, signInTimeoutMs);
			} catch (error) {
				if (error instanceof AuthAdapterError) {
					return failure({
						code: error.code,
						message: error.message,
						suggestion: error.suggestion,
						retryable: error.retryable,
					});
				}
				throw error;
			} finally {
				watcher.stop();
			}
		},
	});

	const signOut = defineCommand({
		name: 'auth-sign-out',
		description: 'Sign out of the current session',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: true,
		destructive: true,
		confirmPrompt: 'Sign out of your account?',
		expose: { palette: true, agent: true, cli: true, mcp: false },
		input: z.object({}),
		async handler() {
			try {
				await adapter.signOut();
				return success(null, {
					reasoning: 'Successfully signed out',
				});
			} catch (error) {
				if (error instanceof AuthAdapterError) {
					return failure({
						code: error.code,
						message: error.message,
						suggestion: error.suggestion,
						retryable: error.retryable,
					});
				}
				throw error;
			}
		},
	});

	const sessionGet = defineCommand({
		name: 'auth-session-get',
		description: 'Get the current authentication session state',
		category: 'auth',
		tags: ['auth', 'session'],
		mutation: false,
		expose: { palette: true, agent: true, cli: true, mcp: true },
		input: z.object({}),
		async handler() {
			const session = adapter.getSession();
			return success(session, {
				reasoning: `Current auth status: ${session.status}`,
			});
		},
	});

	// Cast needed for heterogeneous generic command arrays (same pattern as todo example)
	return [signIn, signOut, sessionGet] as unknown as ZodCommandDefinition[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGN-IN RESULT
// ═══════════════════════════════════════════════════════════════════════════════

function describeMethod(input: SignInOptions): string {
	return input.method === 'oauth' ? input.provider : 'credentials';
}

/**
 * Read the adapter's sign-in outcome. Adapters written before SignInOutcome
 * resolve with nothing, and untyped ones may resolve with a provider
 * response; neither counts as an outcome.
 */
function toOutcome(value: unknown): SignInOutcome | undefined {
	if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
	switch (value.kind) {
		case 'signed-in':
			return { kind: 'signed-in' };
		case 'pending':
			return { kind: 'pending' };
		case 'redirect':
			return 'url' in value && typeof value.url === 'string'
				? { kind: 'redirect', url: value.url }
				: { kind: 'redirect' };
		default:
			return undefined;
	}
}

function incompleteSignIn(
	state: AuthSessionState,
	input: SignInOptions,
	outcome: Extract<SignInOutcome, { kind: 'redirect' | 'pending' }>
) {
	const via = describeMethod(input);
	if (outcome.kind === 'redirect') {
		return success(state, {
			reasoning: `Not signed in yet: sign-in via ${via} continues at the provider, and the session starts after the provider redirects back`,
			warnings: [
				{
					code: 'SIGN_IN_REDIRECT',
					message: `Sign-in via ${via} continues at the provider`,
					severity: 'info',
					...(outcome.url === undefined ? {} : { details: { url: outcome.url } }),
				},
			],
			suggestions: [
				'Complete sign-in at the provider',
				'After the provider redirects back, call auth-session-get to confirm the session',
			],
		});
	}
	return success(state, {
		reasoning: `Not signed in yet: sign-in via ${via} needs another step, such as email verification, before a session exists`,
		warnings: [
			{
				code: 'SIGN_IN_PENDING',
				message: `Sign-in via ${via} needs another step before a session exists`,
				severity: 'warning',
			},
		],
		suggestions: ["Complete the provider's verification step", SESSION_GET_SUGGESTION],
	});
}

function settledSignIn(
	current: AuthSessionState,
	settled: AuthSessionState | null,
	input: SignInOptions,
	timeoutMs: number
) {
	const via = describeMethod(input);
	const state = settled ?? current;

	if (state.status === 'authenticated') {
		return success(state, {
			reasoning: `Signed in via ${via} as ${state.user.email}`,
		});
	}

	if (settled?.status === 'unauthenticated') {
		return failure({
			code: 'PROVIDER_ERROR',
			message: `Sign-in via ${via} completed, but the provider reports no active session`,
			suggestion:
				'Check that the provider can store its session (cookies or tokens) in this environment, then sign in again',
			retryable: false,
		});
	}

	return success(current, {
		reasoning: `Not signed in yet: the sign-in via ${via} was accepted, but no session was confirmed within ${timeoutMs} ms (status: ${current.status})`,
		warnings: [
			{
				code: 'SIGN_IN_PENDING',
				message: `No session confirmed within ${timeoutMs} ms of sign-in`,
				severity: 'warning',
			},
		],
		suggestions: [SESSION_GET_SUGGESTION],
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE WATCHER
// ═══════════════════════════════════════════════════════════════════════════════

interface AuthStateWatcher {
	/**
	 * Resolve with the session once sign-in has produced one: immediately when
	 * the adapter already reports a new authenticated session, otherwise with
	 * the next non-loading state it reports, or `null` after `timeoutMs`.
	 */
	settle(before: AuthSessionState, timeoutMs: number): Promise<AuthSessionState | null>;
	stop(): void;
}

function watchAuthState(adapter: AuthAdapter): AuthStateWatcher {
	let changed = false;
	let onSettled: ((state: AuthSessionState) => void) | null = null;
	const subscription = adapter.onAuthStateChange((state) => {
		changed = true;
		if (state.status !== 'loading' && onSettled) {
			const resolve = onSettled;
			onSettled = null;
			resolve(state);
		}
	});

	return {
		settle(before, timeoutMs) {
			const current = adapter.getSession();
			if (
				current.status === 'authenticated' &&
				(changed || !areSessionStatesEqual(before, current))
			) {
				return Promise.resolve(current);
			}
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					onSettled = null;
					resolve(null);
				}, timeoutMs);
				onSettled = (state) => {
					clearTimeout(timer);
					resolve(state);
				};
			});
		},
		stop() {
			onSettled = null;
			subscription.unsubscribe();
		},
	};
}
