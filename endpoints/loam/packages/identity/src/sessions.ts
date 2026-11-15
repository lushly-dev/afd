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
import { markedRecovery } from './recovery.js';

/** `session.freshAge`: a session made within it may add or remove a passkey or revoke others (5.2). */
export const FRESH_AGE_SECONDS = 300;

/** How a session was made, kept on the provider's session row (2.6, D99). */
export type SessionMethodV1 = 'passkey' | 'password' | 'oidc';

/** The session row's field Loam adds, by its schema name. */
export const SESSION_METHOD_FIELD = 'loamMethod';

/** The core OAuth callback, `/callback/:id`, on which genericOAuth's providers sign in (Better Auth 1.7.18). */
export const OIDC_CALLBACK = '/callback/';

/** The session row's field naming the single sign-on provider an `oidc` session came from (5.7's ceremony). */
export const SESSION_PROVIDER_FIELD = 'loamProvider';

/**
 * The routes that make a session, and how (2.6): a passkey, a password, or the deployer's single sign-on. A join or a
 * recovery that registers a passkey signs in from `/passkey/verify-registration`, by the user-verified ceremony that
 * made it (5.8); one that sets a password signs in as a password does.
 */
export function methodOfPath(path: string | undefined): SessionMethodV1 | undefined {
	if (path === '/passkey/verify-authentication' || path === '/passkey/verify-registration')
		return 'passkey';
	if (
		path === '/sign-in/email' ||
		path === '/loam/join/password' ||
		path === '/loam/recover/password'
	)
		return 'password';
	// A deployer's OIDC provider is a social provider of genericOAuth's, called back on the core `/callback/:id`; no
	// social provider is configured otherwise (5.8), so that route is single sign-on's alone (NEW-2).
	if (path?.startsWith(OIDC_CALLBACK)) return 'oidc';
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

/** What `requireFreshPasskeySession` may also accept. */
export interface FreshOptions {
	/**
	 * A session the single sign-on recovery ceremony marked `recovery` may register a passkey though a passkey did not
	 * make it (5.7, 5.8: D97 wins over D99 where they meet). Registration's alone: deleting a passkey or revoking a
	 * session is never a recovery's.
	 */
	allowRecovery?: boolean;
	now?: number;
}

/**
 * Whether `revoke-person` also revokes the person's OAuth consents and refresh tokens (4.6). Not until step 7, which
 * configures the OAuth provider (step 3's deviation 2): until then there are none, and a guard test refuses an OAuth
 * or consent plugin while this is `false`.
 */
export const REVOKES_CONSENTS = false;

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
 * by a passkey, unless, for a registration, single sign-on recovery marked it `recovery` (5.7). Throws
 * `REAUTH_REQUIRED`.
 *
 * Both are read from the session's own row in the store, found by its token: the session Better Auth hands a route has
 * been through `parseSessionOutput`, which drops `loamMethod` (`returned: false`), so it never says `passkey` (the
 * re-check of step 3's NEW-1). `internalAdapter.findSession` parses it the same way; `adapter.findOne` does not.
 */
export async function requireFreshPasskeySession(
	context: Pick<AuthContext, 'adapter'>,
	found: Found,
	options: FreshOptions = {}
): Promise<void> {
	const now = options.now ?? Date.now();
	const token = (found.session as { token?: unknown }).token;
	const row =
		typeof token === 'string' && token !== ''
			? await context.adapter.findOne<SessionRow>({
					model: 'session',
					where: [{ field: 'token', value: token }],
				})
			: null;
	// No row for the token, or one of another person: nothing here is fresh.
	if (!row || row.userId !== found.user.id) throw reauthRequired();
	const made = new Date(row.createdAt).getTime();
	if (!(now - made <= FRESH_AGE_SECONDS * 1_000)) throw reauthRequired();
	const held = await context.adapter.findOne<{ id: string }>({
		model: 'passkey',
		where: [{ field: 'userId', value: found.user.id }],
	});
	if (!held || row[SESSION_METHOD_FIELD] === 'passkey') return;
	if (
		options.allowRecovery &&
		(await markedRecovery(context.adapter as never, row.token, row.userId, now))
	)
		return;
	throw reauthRequired();
}

/**
 * The paths whose session 5.8's first row and D99 decide, before Better Auth runs them. Better Auth's own session
 * revocations are not served at all (`LOAM_DISABLED_PATHS`); Loam's `revoke-person` decides its own.
 */
const FRESH_PATHS = new Set([
	'/passkey/generate-register-options',
	'/passkey/verify-registration',
	'/passkey/delete-passkey',
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
			await requireFreshPasskeySession(context() ?? ctx.context, found, {
				allowRecovery: ctx.path !== '/passkey/delete-passkey',
			});
		}),
	};
}

/**
 * Loam's own session endpoints (4.3, 4.6), each needing a session but not a fresh one, so a person can list theirs
 * past `freshAge`; Better Auth's `/list-sessions` needs a fresh one.
 *
 * - `GET <path>/loam/sessions`: the person's live sessions by handle, never by token, with this one marked.
 * - `POST <path>/loam/revoke-person { target }`: a handle, `others` or `all`. Revoking any session but the caller's
 *   own, by handle, `others` or `all`, needs a fresh session made by a passkey for a person who holds one (4.6, as
 *   amended by the review of step 3's B1); revoking the caller's own is a sign-out and needs nothing. Step 7 adds the person's OAuth consents and refresh tokens, which
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
					revoked = target === 'all' ? rows : rows.filter((row) => row.token !== own);
				} else {
					const named = rows.find((row) => sessionHandle(row.token) === target);
					if (!named) {
						throw refuse('NOT_FOUND', 'SESSION_NOT_FOUND', 'You have no session with this handle');
					}
					revoked = [named];
				}
				// `others` and `all` always need it, and one handle at a time must not do what `others` may not (B1): only
				// the caller's own session, by its handle, needs nothing.
				if (target === 'others' || target === 'all' || revoked.some((row) => row.token !== own)) {
					await requireFreshPasskeySession(context() ?? ctx.context, found);
				}
				for (const row of revoked) await ctx.context.internalAdapter.deleteSession(row.token);
				const signedOut = revoked.some((row) => row.token === own);
				if (signedOut) deleteSessionCookie(ctx);
				return ctx.json({ revoked: revoked.length, signedOut });
			}
		),
	};
}
