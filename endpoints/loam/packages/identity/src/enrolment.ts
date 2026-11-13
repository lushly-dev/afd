/**
 * @fileoverview Enrolment by invitation (phase 3 specification, 5.6 and 5.8): there is no open sign-up, so a person's
 * account is made only from an owner's invitation, through a single-use join link. Each invitation the provider sends
 * gets a join token, 32 random bytes stored as their SHA-256, expiring with the invitation, with the user id it
 * reserves for the new account. The join page shows the invitation to the link's holder; a passkey registered with
 * `context` `join:<invitation>.<token>`, or a password set through `join/password`, makes the account, verified, a
 * member, the invitation accepted and the token consumed, in one transaction.
 *
 * `bootstrapOrganization`'s first owner has no inviter, which Better Auth's invitation row requires, so that one join
 * row stands alone (`bootstrap`), with the organization, email and role it grants.
 */

import { randomBytes } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { newToken, timeOf, tokenHash, tokenMatches } from './tokens.js';

/** The plugin's join table, by its schema name. */
export const JOIN_MODEL = 'loamJoin';

/** An invitation, and so its join link, lasts 48 hours (5.6): the organization plugin's default, set explicitly. */
export const JOIN_INVITATION_MS = 48 * 3_600_000;

/** The join table's fields (5.6). */
export const JOIN_FIELDS = {
	/** Better Auth's invitation id, or a bootstrap grant's own id: what the link names as `invitation`. */
	invitation: { type: 'string', required: true, unique: true },
	organizationId: { type: 'string', required: true },
	email: { type: 'string', required: true },
	role: { type: 'string', required: true },
	tokenHash: { type: 'string', required: true },
	/** The id the new account takes (5.6). */
	pendingUserId: { type: 'string', required: true },
	expiresAt: { type: 'date', required: true },
	consumedAt: { type: 'date', required: false },
	/** `bootstrapOrganization`'s first owner: no Better Auth invitation stands behind it. */
	bootstrap: { type: 'boolean', required: false },
} as const;

export interface JoinRowV1 {
	id: string;
	invitation: string;
	organizationId: string;
	email: string;
	role: string;
	tokenHash: string;
	pendingUserId: string;
	expiresAt: Date;
	consumedAt?: Date | null;
	bootstrap?: boolean | null;
}

type Where = { field: string; value: unknown; operator?: string }[];

/** The slice of Better Auth's adapter enrolment and recovery write through. */
export interface LinkAdapter {
	findOne<T>(query: { model: string; where: Where }): Promise<T | null>;
	findMany<T>(query: { model: string; where?: Where }): Promise<T[]>;
	create<T>(query: {
		model: string;
		data: Record<string, unknown>;
		forceAllowId?: boolean;
	}): Promise<T>;
	update<T>(query: { model: string; where: Where; update: Record<string, unknown> }): Promise<T>;
	delete(query: { model: string; where: Where }): Promise<void>;
	deleteMany(query: { model: string; where: Where }): Promise<number>;
}

/** A refusal at the provider with Loam's code (section 15). */
export const linkRefusal = (
	status: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'FORBIDDEN',
	code: string,
	message: string
): APIError => APIError.from(status, { code, message });

export const signOutFirst = (): APIError =>
	linkRefusal(
		'BAD_REQUEST',
		'SIGN_OUT_FIRST',
		'Sign out first: a join or recovery link registers a passkey with no session present'
	);

export const invitationNotFound = (): APIError =>
	linkRefusal(
		'NOT_FOUND',
		'INVITATION_NOT_FOUND',
		'This invitation link has been used, has expired or was cancelled. Ask an owner to invite you again'
	);

export const accountExists = (): APIError =>
	linkRefusal(
		'CONFLICT',
		'ACCOUNT_EXISTS',
		'You already have an account. Sign in, then accept the invitation in your account'
	);

/** An id for a new account, as Better Auth makes them, never one an agent member's could be (3.2). */
export function newUserId(context: Pick<AuthContext, 'generateId'> | undefined): string {
	const made = context?.generateId?.({ model: 'user' });
	const id = typeof made === 'string' && made !== '' ? made : randomBytes(16).toString('hex');
	return id.startsWith('agt_') ? `u${id}` : id;
}

/** The join link (5.6): `<origin><base_path>~/join?invitation=<id>&token=<token>`. */
export const joinLink = (shell: string, invitation: string, token: string): string =>
	`${shell}~/join?invitation=${encodeURIComponent(invitation)}&token=${encodeURIComponent(token)}`;

/**
 * A join token for an invitation, replacing any earlier one for it, so only the link sent last works. Answers the
 * token, which only the link carries.
 */
export async function issueJoin(
	adapter: LinkAdapter,
	grant: Omit<JoinRowV1, 'id' | 'tokenHash' | 'consumedAt'>
): Promise<string> {
	await adapter.deleteMany({
		model: JOIN_MODEL,
		where: [{ field: 'invitation', value: grant.invitation }],
	});
	const token = newToken();
	await adapter.create({
		model: JOIN_MODEL,
		data: { ...grant, email: grant.email.toLowerCase(), tokenHash: tokenHash(token) },
	});
	return token;
}

interface InvitationRow {
	id: string;
	organizationId: string;
	email: string;
	role: string;
	status: string;
	expiresAt: Date;
}

/**
 * A join link's grant (5.8's `join:` row): the token matches its hash, unconsumed and unexpired, and the invitation
 * behind it still pending and unexpired. Anything else is `INVITATION_NOT_FOUND`, the same for every case.
 */
export async function readJoin(
	adapter: Pick<LinkAdapter, 'findOne'>,
	invitation: unknown,
	token: unknown,
	now: number = Date.now()
): Promise<JoinRowV1> {
	if (typeof invitation !== 'string' || invitation === '' || invitation.length > 256)
		throw invitationNotFound();
	const row = await adapter.findOne<JoinRowV1>({
		model: JOIN_MODEL,
		where: [{ field: 'invitation', value: invitation }],
	});
	if (!row || !tokenMatches(token, row.tokenHash) || row.consumedAt || timeOf(row.expiresAt) <= now)
		throw invitationNotFound();
	if (row.bootstrap) return row;
	const held = await adapter.findOne<InvitationRow>({
		model: 'invitation',
		where: [{ field: 'id', value: row.invitation }],
	});
	if (
		held?.status !== 'pending' ||
		timeOf(held.expiresAt) <= now ||
		held.organizationId !== row.organizationId
	)
		throw invitationNotFound();
	return row;
}

/** `join:<invitation>.<token>` or `recover:<token>`, as `generate-register-options` takes `context` (5.8). */
export type LinkContextV1 =
	| { kind: 'join'; invitation: string; token: string }
	| { kind: 'recover'; token: string };

/** The registration `context` read, or undefined for none; anything else under the two prefixes is malformed. */
export function parseLinkContext(context: unknown): LinkContextV1 | 'malformed' | undefined {
	if (context === null || context === undefined) return undefined;
	if (typeof context !== 'string') return 'malformed';
	if (context.startsWith('join:')) {
		const rest = context.slice(5);
		const dot = rest.lastIndexOf('.');
		if (dot <= 0) return 'malformed';
		return { kind: 'join', invitation: rest.slice(0, dot), token: rest.slice(dot + 1) };
	}
	if (context.startsWith('recover:')) return { kind: 'recover', token: context.slice(8) };
	return 'malformed';
}

/** No account may hold the invitation's email (5.8's `join:` row): such a person signs in and accepts instead. */
export async function requireNoAccount(
	adapter: Pick<LinkAdapter, 'findOne'>,
	email: string
): Promise<void> {
	const held = await adapter.findOne<{ id: string }>({
		model: 'user',
		where: [{ field: 'email', value: email.toLowerCase() }],
	});
	if (held) throw accountExists();
}

/**
 * The join's writes (5.8), through `adapter`, which is the transaction's: the user with the reserved id, the
 * invitation's email and `emailVerified`, since holding the emailed token proves the mailbox; the member row; the
 * invitation accepted; the token consumed. Its member row is written here, not through `/organization/add-member`,
 * whose `beforeAddMember` hook refuses every add but an accepted invitation's (7.5).
 */
export async function completeJoin(
	adapter: LinkAdapter,
	row: JoinRowV1,
	now: Date = new Date()
): Promise<string> {
	await requireNoAccount(adapter, row.email);
	await adapter.create({
		model: 'user',
		forceAllowId: true,
		data: {
			id: row.pendingUserId,
			email: row.email,
			name: row.email.split('@')[0] || row.email,
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now,
		},
	});
	await adapter.create({
		model: 'member',
		data: {
			organizationId: row.organizationId,
			userId: row.pendingUserId,
			role: row.role,
			createdAt: now,
		},
	});
	if (!row.bootstrap) {
		await adapter.update({
			model: 'invitation',
			where: [{ field: 'id', value: row.invitation }],
			update: { status: 'accepted' },
		});
	}
	// In the same transaction as the read that found it unconsumed; a second use finds the user it made, above.
	await adapter.update({
		model: JOIN_MODEL,
		where: [{ field: 'id', value: row.id }],
		update: { consumedAt: now },
	});
	return row.pendingUserId;
}

/** What `sendInvitationEmail` is given (Better Auth 1.7.18's organization plugin). */
export interface InvitationMailV1 {
	id: string;
	role: string;
	email: string;
	organization: { id: string; name: string };
	invitation: { id: string; organizationId: string; expiresAt: Date };
}

export interface InvitationMailDeps {
	shell: string;
	send(message: { to: string; subject: string; text: string }): Promise<void>;
	/** Better Auth's context, once the plugin's `init` has run. */
	context(): AuthContext | undefined;
}

/**
 * The organization plugin's `sendInvitationEmail` (5.6): a join token for the invitation, replacing any earlier one,
 * with the account id it reserves, and the link to the invitee's address, through the deployment's mail sender.
 */
export function invitationMailer(deps: InvitationMailDeps) {
	return async (data: InvitationMailV1): Promise<void> => {
		const context = deps.context();
		if (!context) throw new Error('loamServerPlugin has not been initialized');
		const token = await issueJoin(context.adapter as unknown as LinkAdapter, {
			invitation: data.invitation.id,
			organizationId: data.invitation.organizationId,
			email: data.email,
			role: data.role,
			pendingUserId: newUserId(context),
			expiresAt: new Date(data.invitation.expiresAt),
			bootstrap: false,
		});
		const expires = new Date(data.invitation.expiresAt).toISOString();
		await deps.send({
			to: data.email,
			subject: `You're invited to ${data.organization.name}`,
			text: `You have been invited to ${data.organization.name} as ${data.role}. Open this link to join: ${joinLink(deps.shell, data.invitation.id, token)}\nThis link expires at ${expires}. If you already have an account, sign in and accept the invitation in your account instead.`,
		});
	};
}

/** Better Auth's own bounds on a password (`emailAndPassword`'s defaults). */
const PASSWORD = { min: 8, max: 128 };

export interface EnrolmentDeps {
	/** Whether the deployment allows passwords (`methods` holds `password`, D99). */
	password: boolean;
}

/**
 * The join page's endpoints (5.6):
 *
 * - `GET <path>/loam/join/check?invitation=&token=`: the invitation the link names, to its holder: the
 *   organization's name, the role and when the link expires. `ACCOUNT_EXISTS` when the email has an account, then
 *   `SIGN_OUT_FIRST` with any session present, so the page says each before offering anything.
 * - `POST <path>/loam/join/password { invitation, token, password }`: with `password` allowed, the join made with a
 *   password instead of a passkey, by the same checks, then signed in.
 */
export function enrolmentEndpoints(deps: EnrolmentDeps) {
	return {
		loamJoinCheck: createAuthEndpoint('/loam/join/check', { method: 'GET' }, async (ctx) => {
			const query = (ctx.query ?? {}) as { invitation?: unknown; token?: unknown };
			const adapter = ctx.context.adapter as unknown as LinkAdapter;
			const row = await readJoin(adapter, query.invitation, query.token);
			await requireNoAccount(adapter, row.email);
			if (await getSessionFromCtx(ctx)) throw signOutFirst();
			const organization = await adapter.findOne<{ name: string; slug: string }>({
				model: 'organization',
				where: [{ field: 'id', value: row.organizationId }],
			});
			return ctx.json({
				organization: { name: organization?.name ?? '', slug: organization?.slug ?? '' },
				role: row.role,
				email: row.email,
				expiresAt: row.expiresAt,
				password: deps.password,
			});
		}),
		loamJoinPassword: createAuthEndpoint('/loam/join/password', { method: 'POST' }, async (ctx) => {
			if (!deps.password) {
				throw linkRefusal(
					'NOT_FOUND',
					'SIGN_IN_METHOD_UNAVAILABLE',
					'This deployment does not offer passwords. Create a passkey instead'
				);
			}
			const body = (ctx.body ?? {}) as {
				invitation?: unknown;
				token?: unknown;
				password?: unknown;
			};
			if (await getSessionFromCtx(ctx)) throw signOutFirst();
			const { password } = body;
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
			const adapter = ctx.context.adapter as unknown as LinkAdapter & {
				transaction<R>(run: (trx: LinkAdapter) => Promise<R>): Promise<R>;
			};
			const hash = await ctx.context.password.hash(password);
			const userId = await adapter.transaction(async (trx) => {
				const row = await readJoin(trx, body.invitation, body.token);
				const id = await completeJoin(trx, row);
				const now = new Date();
				await trx.create({
					model: 'account',
					data: {
						userId: id,
						accountId: id,
						providerId: 'credential',
						password: hash,
						createdAt: now,
						updatedAt: now,
					},
				});
				return id;
			});
			const user = await ctx.context.internalAdapter.findUserById(userId);
			const session = await ctx.context.internalAdapter.createSession(userId);
			if (!user || !session) {
				throw linkRefusal(
					'BAD_REQUEST',
					'IDENTITY_PROVIDER_UNAVAILABLE',
					'Your account was made; sign in with your password'
				);
			}
			await setSessionCookie(ctx, { session, user });
			return ctx.json({ userId });
		}),
	};
}
