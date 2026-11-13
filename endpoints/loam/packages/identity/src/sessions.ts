/**
 * @fileoverview Sessions at the provider (phase 3 specification, 4.3, 4.6, 5.2 and 5.8): how each session was
 * made, Loam's own `sessions` and `revoke-person` endpoints, and the checks that restore at the provider what the
 * passkey plugin's registration and Better Auth's session routes do not hold themselves: a fresh session, and for a
 * person who holds a passkey, one made by a passkey (D99).
 */

import { createHash } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	sessionMiddleware,
} from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';

/** `session.freshAge`: a session made within it may add or remove a passkey or revoke others (5.2). */
export const FRESH_AGE_SECONDS = 300;

/** How a session was made, kept on the provider's session row (2.6, D99). */
export type SessionMethodV1 = 'passkey' | 'password' | 'oidc';

/** The session row's field Loam adds, by its schema name. */
export const SESSION_METHOD_FIELD = 'loamMethod';

/** The routes that make a session, and how (2.6): a passkey, a password, or the deployer's single sign-on. */
export function methodOfPath(path: string | undefined): SessionMethodV1 | undefined {
	if (path === '/passkey/verify-authentication') return 'passkey';
	if (path === '/sign-in/email') return 'password';
	if (path?.startsWith('/oauth2/callback/')) return 'oidc';
	return undefined;
}

/** A session's handle (4.1): the first 16 hex characters of SHA-256 over its token, never the token. */
export const sessionHandle = (token: string): string =>
	createHash('sha256').update(token).digest('hex').slice(0, 16);

/** A label for a device from its user agent (4.1): a browser and a platform, never an address. */
export function deviceLabel(agent: string | null | undefined): string | null {
	if (!agent) return null;
	const browser = /Edg\//.test(agent)
		? 'Edge'
		: /Firefox\//.test(agent)
			? 'Firefox'
			: /Chrome\//.test(agent)
				? 'Chrome'
				: /Safari\//.test(agent)
					? 'Safari'
					: undefined;
	const platform = /iPhone|iPad/.test(agent)
		? 'iOS'
		: /Android/.test(agent)
			? 'Android'
			: /Mac OS X|Macintosh/.test(agent)
				? 'macOS'
				: /Windows/.test(agent)
					? 'Windows'
					: /Linux/.test(agent)
						? 'Linux'
						: undefined;
	return [browser, platform].filter(Boolean).join(' on ') || 'Another device';
}

interface SessionRow {
	id: string;
	token: string;
	userId: string;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
	userAgent?: string | null;
	[SESSION_METHOD_FIELD]?: string | null;
}

/** A refusal the provider answers with Loam's code (section 15). */
const refuse = (
	status: 'UNAUTHORIZED' | 'BAD_REQUEST' | 'NOT_FOUND',
	code: string,
	message: string
): APIError => APIError.from(status, { code, message });

export const reauthRequired = (): APIError =>
	refuse(
		'UNAUTHORIZED',
		'REAUTH_REQUIRED',
		'This needs a session made within five minutes, by a passkey if you hold one. Sign in with a passkey again'
	);

type Found = NonNullable<Awaited<ReturnType<typeof getSessionFromCtx>>>;

/**
 * 5.8's first row, with D99 (5.2): a session made within `freshAge`, and for a person who holds a passkey, one made
 * by a passkey. Step 4 adds the `recovery` mark single sign-on recovery sets. Throws `REAUTH_REQUIRED`.
 */
export async function requireFreshPasskeySession(
	context: Pick<AuthContext, 'adapter'>,
	found: Found,
	now: number = Date.now()
): Promise<void> {
	const session = found.session as unknown as SessionRow;
	const made = new Date(session.createdAt).getTime();
	if (!(now - made <= FRESH_AGE_SECONDS * 1_000)) throw reauthRequired();
	const held = await context.adapter.findOne<{ id: string }>({
		model: 'passkey',
		where: [{ field: 'userId', value: found.user.id }],
	});
	if (held && session[SESSION_METHOD_FIELD] !== 'passkey') throw reauthRequired();
}

/** The paths whose session 5.8's first row and D99 decide, before Better Auth runs them. */
const FRESH_PATHS = new Set([
	'/passkey/generate-register-options',
	'/passkey/verify-registration',
	'/passkey/delete-passkey',
	'/revoke-other-sessions',
	'/revoke-sessions',
]);

/**
 * Before the passkey plugin's registration and delete routes, and Better Auth's session revocations (5.8): no
 * session is the route's own 401; a registration naming a join or recovery `context` with a session present is
 * `SIGN_OUT_FIRST`, since the provider would attribute it to that session's person; any other needs a fresh
 * session made by a passkey for a person who holds one.
 */
export function freshSessionHook(context: () => AuthContext | undefined) {
	return {
		matcher: (ctx: { path?: string }) => FRESH_PATHS.has(ctx.path ?? ''),
		handler: createAuthMiddleware(async (ctx) => {
			const found = await getSessionFromCtx(ctx);
			// No session: the route refuses it itself, as the plugin's own session check does.
			if (!found) return;
			if (
				ctx.path === '/passkey/generate-register-options' &&
				typeof (ctx.query as { context?: unknown } | undefined)?.context === 'string'
			) {
				throw refuse(
					'BAD_REQUEST',
					'SIGN_OUT_FIRST',
					'Sign out first: a join or recovery link registers a passkey with no session present'
				);
			}
			await requireFreshPasskeySession(context() ?? ctx.context, found);
		}),
	};
}

/**
 * Loam's own session endpoints (4.3, 4.6), each needing a session but not a fresh one, so a person can list theirs
 * past `freshAge`; Better Auth's `/list-sessions` needs a fresh one.
 *
 * - `GET <path>/loam/sessions`: the person's live sessions by handle, never by token, with this one marked.
 * - `POST <path>/loam/revoke-person { target }`: a handle, `others` or `all`. `others` and `all` need a fresh session
 *   made by a passkey for a person who holds one. Step 7 adds the person's OAuth consents and refresh tokens, which
 *   do not exist until it configures the OAuth provider (9.4).
 */
export function sessionEndpoints(context: () => AuthContext | undefined) {
	const sessionsOf = async (ctx: { context: AuthContext }, userId: string) => {
		const rows = (await ctx.context.internalAdapter.listSessions(userId)) as SessionRow[];
		const now = Date.now();
		return rows.filter((row) => new Date(row.expiresAt).getTime() > now);
	};
	return {
		loamSessions: createAuthEndpoint(
			'/loam/sessions',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) => {
				const { session, user } = ctx.context.session;
				const rows = await sessionsOf(ctx, user.id);
				return ctx.json({
					sessions: rows.map((row) => ({
						handle: sessionHandle(row.token),
						current: row.token === session.token,
						device: deviceLabel(row.userAgent),
						createdAt: row.createdAt,
						updatedAt: row.updatedAt,
						expiresAt: row.expiresAt,
					})),
				});
			}
		),
		loamRevokePerson: createAuthEndpoint(
			'/loam/revoke-person',
			{ method: 'POST', use: [sessionMiddleware] },
			async (ctx) => {
				const found = ctx.context.session;
				const target = (ctx.body as { target?: unknown } | undefined)?.target;
				if (typeof target !== 'string' || target.length === 0 || target.length > 256) {
					throw refuse(
						'BAD_REQUEST',
						'VALIDATION_ERROR',
						"Name a session's handle, 'others' or 'all'"
					);
				}
				const own = found.session.token;
				const rows = await sessionsOf(ctx, found.user.id);
				let revoked: SessionRow[];
				if (target === 'others' || target === 'all') {
					await requireFreshPasskeySession(context() ?? ctx.context, found);
					revoked = target === 'all' ? rows : rows.filter((row) => row.token !== own);
				} else {
					const named = rows.find((row) => sessionHandle(row.token) === target);
					if (!named) {
						throw refuse('NOT_FOUND', 'SESSION_NOT_FOUND', 'You have no session with this handle');
					}
					revoked = [named];
				}
				for (const row of revoked) await ctx.context.internalAdapter.deleteSession(row.token);
				const signedOut = revoked.some((row) => row.token === own);
				if (signedOut) deleteSessionCookie(ctx);
				return ctx.json({ revoked: revoked.length, signedOut });
			}
		),
	};
}
