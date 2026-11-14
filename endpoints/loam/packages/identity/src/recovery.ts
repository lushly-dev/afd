/**
 * @fileoverview Recovery (phase 3 specification, 5.7; D97, the owner's decision of 2026-11-09): a person restores
 * their own access, by a one-time link emailed to their verified address or through the deployer's single sign-on.
 * No owner restores another person's account: nothing here takes a person but the one the link or the session names,
 * and no link goes to any address but the account's own verified one.
 *
 * Whichever path, one **recovery transaction**: every other session of the person goes, with (from step 7) their OAuth
 * consents and refresh tokens and their connected agents; `recoveredAt` is set on the provider's user; and after it
 * commits an email tells the account's verified address. A token or nonce is consumed in the same transaction.
 */

import { createHash } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import { createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie, setSessionCookie } from 'better-auth/cookies';
import { consumeOnce, type LinkAdapter, linkRefusal, signOutFirst } from './enrolment.js';
import { newToken, timeOf, tokenHash } from './tokens.js';

/** The plugin's recovery tables, by their schema names. */
export const RECOVERY_MODEL = 'loamRecovery';
export const NONCE_MODEL = 'loamRecoveryNonce';
export const MARK_MODEL = 'loamRecoveryMark';

export const RECOVERY_FIELDS = {
	userId: { type: 'string', required: true },
	tokenHash: { type: 'string', required: true, unique: true },
	createdAt: { type: 'date', required: true },
	expiresAt: { type: 'date', required: true },
	consumedAt: { type: 'date', required: false },
	cancelledAt: { type: 'date', required: false },
} as const;

export const NONCE_FIELDS = {
	nonceHash: { type: 'string', required: true, unique: true },
	provider: { type: 'string', required: true },
	createdAt: { type: 'date', required: true },
	consumedAt: { type: 'date', required: false },
} as const;

export const MARK_FIELDS = {
	/** The SHA-256 of the session's token, never the token. */
	sessionHash: { type: 'string', required: true, unique: true },
	userId: { type: 'string', required: true },
	until: { type: 'date', required: true },
} as const;

/** A recovery link is valid this long (5.7). */
export const RECOVERY_LINK_MS = 15 * 60_000;
/** At most this many recovery emails per account per hour; past it a request is dropped silently. */
export const RECOVERY_PER_HOUR = 3;
/** Every recovery request is answered this long after it arrived, whatever it found (5.7). */
export const RECOVERY_ANSWER_MS = 1_000;
/** The single sign-on ceremony's nonce, its session's age and the `recovery` mark: 300 s each. */
export const RECOVERY_CEREMONY_MS = 300_000;
/** The nonce's cookie, under Better Auth's prefix. */
export const NONCE_COOKIE = 'loam_recover';

interface RecoveryRow {
	id: string;
	userId: string;
	tokenHash: string;
	createdAt: Date;
	expiresAt: Date;
	consumedAt?: Date | null;
	cancelledAt?: Date | null;
}

interface UserRow {
	id: string;
	email: string;
	emailVerified: boolean;
	name: string;
}

export const recoveryInvalid = () =>
	linkRefusal(
		'NOT_FOUND',
		'RECOVERY_LINK_INVALID',
		'This recovery link has been used, has expired or was replaced by a newer one. Ask for another on the sign-in dialog'
	);

/** The recovery link (5.7): `<origin><base_path>~/recover?token=<token>`. */
export const recoveryLink = (shell: string, token: string): string =>
	`${shell}~/recover?token=${encodeURIComponent(token)}`;

/** The SHA-256 of a session's token, as the `recovery` mark keys it. */
export const sessionHash = (token: string): string =>
	createHash('sha256').update(token).digest('hex');

/** A recovery link's row: the token matches, unconsumed, uncancelled, unexpired; else `RECOVERY_LINK_INVALID`. */
export async function readRecovery(
	adapter: Pick<LinkAdapter, 'findOne'>,
	token: unknown,
	now: number = Date.now()
): Promise<RecoveryRow> {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw recoveryInvalid();
	const row = await adapter.findOne<RecoveryRow>({
		model: RECOVERY_MODEL,
		where: [{ field: 'tokenHash', value: tokenHash(token) }],
	});
	if (!row || row.consumedAt || row.cancelledAt || timeOf(row.expiresAt) <= now)
		throw recoveryInvalid();
	return row;
}

/**
 * The recovery transaction's writes (5.7), through `adapter`, the transaction's: every session of the person but
 * `keep` deleted, `recoveredAt` set. The person's OAuth consents and refresh tokens, and their connected agents' suspension, join
 * it with step 7, which makes them; none exists before (`REVOKES_CONSENTS`).
 */
export async function recoverPerson(
	adapter: LinkAdapter,
	userId: string,
	options: { keep?: string; now?: Date } = {}
): Promise<void> {
	const now = options.now ?? new Date();
	const sessions = await adapter.findMany<{ id: string; token: string }>({
		model: 'session',
		where: [{ field: 'userId', value: userId }],
	});
	for (const session of sessions) {
		if (session.token !== options.keep)
			await adapter.delete({ model: 'session', where: [{ field: 'id', value: session.id }] });
	}
	await adapter.update({
		model: 'user',
		where: [{ field: 'id', value: userId }],
		update: { recoveredAt: now, updatedAt: now },
	});
}

export interface RecoveryDeps {
	/** The shell's address, `<origin><base_path>`, the links' root. */
	shell: string;
	/** Whether the deployment allows passwords (D99): the recovery page may set a new one. */
	password: boolean;
	/** The deployer's single sign-on providers, by id. */
	oidc: readonly string[];
	send(message: { to: string; subject: string; text: string }): Promise<void>;
	/** The bound organization's name, for the announcement. */
	organizationName(): Promise<string>;
	/** Better Auth's context, once the plugin's `init` has run. */
	context(): AuthContext | undefined;
}

/** Announce a recovery to the account's verified address (5.7), after the transaction has committed. */
export async function announceRecovery(deps: RecoveryDeps, user: UserRow, at: Date) {
	const organization = await deps.organizationName().catch(() => 'the workspace');
	await deps.send({
		to: user.email,
		subject: `Your access to ${organization} was restored`,
		text: `Your access to ${organization} was restored on ${at.toISOString().slice(0, 10)}. If this wasn't you, contact an owner.`,
	});
}

/** Better Auth's own bounds on a password (`emailAndPassword`'s defaults). */
const PASSWORD = { min: 8, max: 128 };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

type Transacting = LinkAdapter & {
	transaction<R>(run: (trx: LinkAdapter) => Promise<R>): Promise<R>;
};

/**
 * The person a passkey registration's recovery is for, held from `afterVerification`, inside the plugin's
 * transaction, until the route has answered: then the transaction has committed, and the announcement goes.
 */
export function createRecoveryAnnouncer(deps: RecoveryDeps) {
	// By the request, which the route and its after-hook share: a registration that failed leaves nothing behind.
	const pending = new WeakMap<object, { userId: string; at: Date }>();
	return {
		hold(request: object | undefined, userId: string, at: Date) {
			if (request) pending.set(request, { userId, at });
		},
		/** After `/passkey/verify-registration` answers: a committed recovery's announcement, else nothing. */
		hook: {
			matcher: (ctx: { path?: string }) => ctx.path === '/passkey/verify-registration',
			handler: createAuthMiddleware(async (ctx) => {
				const request = ctx.request as object | undefined;
				const held = request && pending.get(request);
				if (!held || !request) return;
				pending.delete(request);
				const returned = ctx.context.returned as unknown;
				const body =
					returned instanceof Response
						? returned.status === 200
							? ((await returned
									.clone()
									.json()
									.catch(() => undefined)) as { user?: { id?: string } } | undefined)
							: undefined
						: returned instanceof Error
							? undefined
							: (returned as { user?: { id?: string } } | undefined);
				// Committed: the route answered with the person's new session.
				if (body?.user?.id !== held.userId) return;
				const user = await ctx.context.internalAdapter.findUserById(held.userId);
				if (user) await announceRecovery(deps, user as UserRow, held.at).catch(() => undefined);
			}),
		},
	};
}

/**
 * Recovery's endpoints (5.7):
 *
 * - `POST <path>/loam/recover/request { email }`: a recovery link to that account's verified email. The answer is the
 *   same, 1,000 ms after the request, whether the email has an account, has none, is unverified or is past its limit.
 * - `GET <path>/loam/recover/check?token=`: whether the link is good, to its holder; `SIGN_OUT_FIRST` with a session.
 * - `POST <path>/loam/recover/password { token, password }`: with passwords allowed, a new password instead of a
 *   passkey, through the same transaction, then signed in.
 * - `POST <path>/loam/recover/oidc/start { provider }` and `POST <path>/loam/recover/oidc/complete`: the single
 *   sign-on ceremony.
 */
export function recoveryEndpoints(deps: RecoveryDeps) {
	const adapterOf = (ctx: { context: AuthContext }) =>
		ctx.context.adapter as unknown as Transacting;
	return {
		loamRecoverRequest: createAuthEndpoint(
			'/loam/recover/request',
			{ method: 'POST' },
			async (ctx) => {
				const started = Date.now();
				const email = (ctx.body as { email?: unknown } | undefined)?.email;
				if (typeof email !== 'string' || email.length > 320) {
					throw linkRefusal('BAD_REQUEST', 'VALIDATION_ERROR', 'Give the email of your account');
				}
				try {
					const adapter = adapterOf(ctx);
					const user = await adapter.findOne<UserRow>({
						model: 'user',
						where: [{ field: 'email', value: email.trim().toLowerCase() }],
					});
					// Only to a verified address (5.7): an unverified one could be anyone's.
					if (user?.emailVerified === true) {
						const now = Date.now();
						const rows = await adapter.findMany<RecoveryRow>({
							model: RECOVERY_MODEL,
							where: [{ field: 'userId', value: user.id }],
						});
						const recent = rows.filter((row) => timeOf(row.createdAt) > now - 3_600_000);
						if (recent.length < RECOVERY_PER_HOUR) {
							const token = newToken();
							await adapter.transaction(async (trx) => {
								// The new link first, then every other outstanding one cancelled by a conditional update: two requests racing
								// leave at most one link outstanding, never two (5.7; the review of step 4's I4).
								const made = await trx.create<{ id: string }>({
									model: RECOVERY_MODEL,
									data: {
										userId: user.id,
										tokenHash: tokenHash(token),
										createdAt: new Date(now),
										expiresAt: new Date(now + RECOVERY_LINK_MS),
									},
								});
								await trx.updateMany({
									model: RECOVERY_MODEL,
									where: [
										{ field: 'userId', value: user.id },
										{ field: 'id', value: made.id, operator: 'ne' },
										{ field: 'consumedAt', value: null },
										{ field: 'cancelledAt', value: null },
									],
									update: { cancelledAt: new Date(now) },
								});
							});
							// Sent in the background: its time is not the answer's.
							const organization = await deps.organizationName().catch(() => 'the workspace');
							void deps
								.send({
									to: user.email,
									subject: `Restore your access to ${organization}`,
									text: `Open this link within 15 minutes to restore your access to ${organization}: ${recoveryLink(deps.shell, token)}\nIf you did not ask, ignore this email.`,
								})
								.catch(() => undefined);
						}
					}
				} catch {
					// The same answer whatever went wrong: the request learns nothing.
				}
				await wait(RECOVERY_ANSWER_MS - (Date.now() - started));
				return ctx.json({ sent: true });
			}
		),
		loamRecoverCheck: createAuthEndpoint('/loam/recover/check', { method: 'GET' }, async (ctx) => {
			if (await getSessionFromCtx(ctx)) throw signOutFirst();
			const token = (ctx.query as { token?: unknown } | undefined)?.token;
			const row = await readRecovery(adapterOf(ctx), token);
			return ctx.json({ expiresAt: row.expiresAt, password: deps.password });
		}),
		loamRecoverPassword: createAuthEndpoint(
			'/loam/recover/password',
			{ method: 'POST' },
			async (ctx) => {
				if (!deps.password) {
					throw linkRefusal(
						'NOT_FOUND',
						'SIGN_IN_METHOD_UNAVAILABLE',
						'This deployment does not offer passwords. Create a passkey instead'
					);
				}
				if (await getSessionFromCtx(ctx)) throw signOutFirst();
				const { token, password } = (ctx.body ?? {}) as { token?: unknown; password?: unknown };
				if (
					typeof password !== 'string' ||
					password.length < PASSWORD.min ||
					password.length > PASSWORD.max
				) {
					throw linkRefusal(
						'BAD_REQUEST',
						'VALIDATION_ERROR',
						`A password is ${PASSWORD.min} to ${PASSWORD.max} characters`
					);
				}
				const hash = await ctx.context.password.hash(password);
				const at = new Date();
				const adapter = adapterOf(ctx);
				const userId = await adapter.transaction(async (trx) => {
					const row = await readRecovery(trx, token);
					const credential = await trx.findOne<{ id: string }>({
						model: 'account',
						where: [
							{ field: 'userId', value: row.userId },
							{ field: 'providerId', value: 'credential' },
						],
					});
					if (credential) {
						await trx.update({
							model: 'account',
							where: [{ field: 'id', value: credential.id }],
							update: { password: hash, updatedAt: at },
						});
					} else {
						await trx.create({
							model: 'account',
							data: {
								userId: row.userId,
								accountId: row.userId,
								providerId: 'credential',
								password: hash,
								createdAt: at,
								updatedAt: at,
							},
						});
					}
					// Consumed by a conditional update that must change one row (I4); the transaction undoes the rest if not.
					await consumeOnce(trx, RECOVERY_MODEL, row.id, recoveryInvalid, at);
					await recoverPerson(trx, row.userId, { now: at });
					return row.userId;
				});
				const user = await ctx.context.internalAdapter.findUserById(userId);
				const session = await ctx.context.internalAdapter.createSession(userId);
				if (user) await announceRecovery(deps, user as UserRow, at).catch(() => undefined);
				if (!user || !session) {
					throw linkRefusal(
						'BAD_REQUEST',
						'IDENTITY_PROVIDER_UNAVAILABLE',
						'Your password was set; sign in with it'
					);
				}
				await setSessionCookie(ctx, { session, user });
				return ctx.json({ recovered: true });
			}
		),
		loamRecoverOidcStart: createAuthEndpoint(
			'/loam/recover/oidc/start',
			{ method: 'POST' },
			async (ctx) => {
				const provider = (ctx.body as { provider?: unknown } | undefined)?.provider;
				if (typeof provider !== 'string' || !deps.oidc.includes(provider)) {
					throw linkRefusal(
						'NOT_FOUND',
						'SIGN_IN_METHOD_UNAVAILABLE',
						'This deployment has no such single sign-on'
					);
				}
				// Any session in this browser is signed out first (5.7): the ceremony's session is the next one made.
				const found = await getSessionFromCtx(ctx);
				if (found) {
					await ctx.context.internalAdapter.deleteSession(found.session.token);
					deleteSessionCookie(ctx);
				}
				const nonce = newToken();
				await adapterOf(ctx).create({
					model: NONCE_MODEL,
					data: { nonceHash: tokenHash(nonce), provider, createdAt: new Date() },
				});
				const cookie = ctx.context.createAuthCookie(NONCE_COOKIE, {
					maxAge: RECOVERY_CEREMONY_MS / 1_000,
					httpOnly: true,
					sameSite: 'lax',
					secure: true,
				});
				ctx.setCookie(cookie.name, nonce, { ...cookie.attributes, httpOnly: true, secure: true });
				return ctx.json({ provider, callbackURL: `${deps.shell}~/recover?via=oidc` });
			}
		),
		loamRecoverOidcComplete: createAuthEndpoint(
			'/loam/recover/oidc/complete',
			{ method: 'POST' },
			async (ctx) => {
				const refused = () =>
					linkRefusal(
						'UNAUTHORIZED',
						'REAUTH_REQUIRED',
						'Start again: single sign-on recovery needs the sign-in it began, within five minutes'
					);
				const cookie = ctx.context.createAuthCookie(NONCE_COOKIE);
				const nonce = ctx.getCookie(cookie.name);
				const found = await getSessionFromCtx(ctx);
				if (!nonce || !found) throw refused();
				const now = Date.now();
				const adapter = adapterOf(ctx);
				const held = await adapter.findOne<{
					id: string;
					provider: string;
					createdAt: Date;
					consumedAt?: Date | null;
				}>({ model: NONCE_MODEL, where: [{ field: 'nonceHash', value: tokenHash(nonce) }] });
				if (!held || held.consumedAt || now - timeOf(held.createdAt) > RECOVERY_CEREMONY_MS)
					throw refused();
				// The session's own row: how and when it was made, which the parsed session does not carry.
				const row = await adapter.findOne<{
					token: string;
					userId: string;
					createdAt: Date;
					loamMethod?: string | null;
					loamProvider?: string | null;
				}>({ model: 'session', where: [{ field: 'token', value: found.session.token }] });
				const made = row ? timeOf(row.createdAt) : Number.NaN;
				if (
					!row ||
					row.userId !== found.user.id ||
					!(made >= timeOf(held.createdAt)) ||
					now - made > RECOVERY_CEREMONY_MS ||
					row.loamMethod !== 'oidc' ||
					row.loamProvider !== held.provider ||
					found.user.emailVerified !== true
				)
					throw refused();
				// What the provider reported in this sign-in: Better Auth keeps the verified ID token on the person's
				// account for that provider. Its email must be verified and the account's own (5.7).
				const linked = await adapter.findOne<{ idToken?: string | null }>({
					model: 'account',
					where: [
						{ field: 'userId', value: found.user.id },
						{ field: 'providerId', value: held.provider },
					],
				});
				const claims = claimsOf(linked?.idToken);
				if (
					claims?.email_verified !== true ||
					typeof claims.email !== 'string' ||
					claims.email.toLowerCase() !== found.user.email.toLowerCase()
				)
					throw refused();
				const at = new Date(now);
				await adapter.transaction(async (trx) => {
					// The nonce is marked consumed, by a conditional update that must change one row (5.7; I4, N4).
					await consumeOnce(trx, NONCE_MODEL, held.id, refused, at);
					await recoverPerson(trx, found.user.id, { keep: found.session.token, now: at });
					await trx.create({
						model: MARK_MODEL,
						data: {
							sessionHash: sessionHash(found.session.token),
							userId: found.user.id,
							until: new Date(now + RECOVERY_CEREMONY_MS),
						},
					});
				});
				ctx.setCookie(cookie.name, '', { ...cookie.attributes, maxAge: 0 });
				await announceRecovery(deps, found.user as UserRow, at).catch(() => undefined);
				return ctx.json({ recovered: true });
			}
		),
	};
}

/** An ID token's claims, read without verifying: Better Auth verified it against the provider's keys at sign-in. */
function claimsOf(idToken: string | null | undefined): Record<string, unknown> | undefined {
	const payload = idToken?.split('.')[1];
	if (!payload) return undefined;
	try {
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
			string,
			unknown
		>;
	} catch {
		return undefined;
	}
}

/** Whether a session is marked `recovery` (5.7, 5.8): the single sign-on ceremony's, for 300 s. */
export async function markedRecovery(
	adapter: Pick<LinkAdapter, 'findOne'>,
	token: string,
	userId: string,
	now: number = Date.now()
): Promise<boolean> {
	const mark = await adapter.findOne<{ userId: string; until: Date }>({
		model: MARK_MODEL,
		where: [{ field: 'sessionHash', value: sessionHash(token) }],
	});
	return mark !== null && mark.userId === userId && timeOf(mark.until) > now;
}
