/**
 * @fileoverview `loamServerPlugin` (phase 3 specification, 1, 2.3, 4.2 and 7.5): Better Auth endpoints and
 * hooks of Loam's own. Step 1 builds `whoami`, the binding and the hooks that keep the provider's own
 * organization endpoints within Loam's rules; `revoke-person`, recovery and invitation tokens are later
 * steps' (3 and 4).
 */

import type { AuthContext, BetterAuthPlugin } from 'better-auth';
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	sessionMiddleware,
} from 'better-auth/api';
import {
	BINDING_MODEL,
	type BindingAdapter,
	membershipOf,
	readBinding,
	statusOf,
} from './binding.js';
import { isOwnerRole, rolesOf } from './roles.js';
import { freshSessionHook, SESSION_METHOD_FIELD, sessionEndpoints } from './sessions.js';

/** What the plugin and `createLoamAuthOptions`' organization hooks share. */
export interface LoamProviderState {
	/** The workspace's id, whose binding the plugin keeps. */
	workspace: string;
	/** `[identity] organization`: the bound organization's slug at first binding, then only checked. */
	organization: string;
	/** Better Auth's context, once the plugin's `init` has run. */
	context?: AuthContext;
}

/** No person's id may start with it (3.2): `whoami` answers such a session as none. */
const AGENT_PREFIX = 'agt_';

/** A refusal the provider answers, with Loam's code (section 15). */
export const refusal = (
	status: 'FORBIDDEN' | 'BAD_REQUEST',
	code: string,
	message: string
): APIError => APIError.from(status, { code, message });

export const ownerRequired = (): APIError =>
	refusal(
		'FORBIDDEN',
		'OWNER_REQUIRED',
		'Only an owner of the organization can grant, change or remove the owner role. Ask an owner'
	);

/** The adapter, once `init` has run: every hook runs after it. */
export function adapterOf(state: LoamProviderState): BindingAdapter {
	const adapter = state.context?.adapter;
	if (!adapter) throw new Error('loamServerPlugin has not been initialized');
	return adapter as unknown as BindingAdapter;
}

interface MemberRow {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
}

/** A member row by id, or by its person's email, as `/organization/remove-member` names it. */
async function memberNamed(
	adapter: BindingAdapter,
	organizationId: string,
	ref: string
): Promise<MemberRow | null> {
	if (!ref.includes('@')) {
		const row = await adapter.findOne<MemberRow>({
			model: 'member',
			where: [{ field: 'id', value: ref }],
		});
		return row?.organizationId === organizationId ? row : null;
	}
	const user = await adapter.findOne<{ id: string }>({
		model: 'user',
		where: [{ field: 'email', value: ref.toLowerCase() }],
	});
	return user ? memberOf(adapter, organizationId, user.id) : null;
}

export const memberOf = (adapter: BindingAdapter, organizationId: string, userId: string) =>
	adapter.findOne<MemberRow>({
		model: 'member',
		where: [
			{ field: 'organizationId', value: organizationId },
			{ field: 'userId', value: userId },
		],
	});

/**
 * What main shows of the binding (2.3, 15): to anyone signed in, no organization bound yet
 * (`IDENTITY_ORGANIZATION_UNKNOWN`); to an owner, a deployment slug that no longer names the bound organization
 * (`IDENTITY_BINDING_MISMATCH`). Nothing for anyone else, who learns nothing of the binding.
 */
async function bindingWarning(
	adapter: BindingAdapter,
	state: LoamProviderState,
	membership: Awaited<ReturnType<typeof membershipOf>>
): Promise<{ warning?: 'IDENTITY_BINDING_MISMATCH' | 'IDENTITY_ORGANIZATION_UNKNOWN' }> {
	const binding = await readBinding(adapter, state.workspace);
	if (!binding) return { warning: 'IDENTITY_ORGANIZATION_UNKNOWN' };
	if (!membership || !isOwnerRole(membership.role)) return {};
	const status = await statusOf(adapter, binding, state.organization);
	return status.warning ? { warning: status.warning } : {};
}

/**
 * A disabled path with a parameter, as `/reset-password/:token`, as a pattern over the path under the base path:
 * Better Auth matches `disabledPaths` as exact strings, so it blocks only the literal `:token` (the re-check of step
 * 3's NEW-4). Each segment that starts `:` matches any one segment.
 */
export function disabledPattern(path: string): RegExp | undefined {
	if (!path.includes('/:')) return undefined;
	const source = path
		.split('/')
		.map((segment) =>
			segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		)
		.join('/');
	return new RegExp(`^${source}/?$`, 'i');
}

/** `/get-session`'s answer without `session.token`: the cookie is HttpOnly, so no page script gets the token (4.1). */
async function withoutToken(returned: unknown): Promise<Record<string, unknown> | undefined> {
	const body =
		returned instanceof Response
			? returned.status === 200
				? ((await returned
						.clone()
						.json()
						.catch(() => undefined)) as unknown)
				: undefined
			: returned instanceof APIError
				? undefined
				: returned;
	const session = (body as { session?: Record<string, unknown> } | null | undefined)?.session;
	if (!session || !('token' in session)) return undefined;
	const { token: _token, ...kept } = session;
	return { ...(body as Record<string, unknown>), session: kept };
}

/** The paths whose caller Loam checks before the organization plugin runs (7.5). */
const ROLE_PATHS = new Set(['/organization/update-member-role', '/organization/remove-member']);

export function loamServerPlugin(state: LoamProviderState) {
	return {
		id: 'loam',
		schema: {
			[BINDING_MODEL]: {
				modelName: 'loam_binding',
				fields: {
					workspace: { type: 'string', required: true, unique: true },
					organizationId: { type: 'string', required: true },
					boundAt: { type: 'date', required: true },
				},
			},
			// How each session was made (2.6, D99), which the freshness rule of 5.2 and 5.8 reads.
			session: {
				fields: {
					[SESSION_METHOD_FIELD]: {
						type: 'string',
						required: false,
						input: false,
						returned: false,
					},
				},
			},
		},
		init(context: AuthContext) {
			state.context = context;
		},
		/** A disabled path's every value, not only its template (NEW-4): answered as Better Auth answers one, 404. */
		onRequest: (async (request: Request, context: AuthContext) => {
			const patterns = (context.options.disabledPaths ?? []).flatMap(
				(path) => disabledPattern(path) ?? []
			);
			if (patterns.length === 0) return;
			const base = new URL(context.baseURL).pathname.replace(/\/$/, '');
			const pathname = new URL(request.url).pathname;
			const under = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
			if (patterns.some((pattern) => pattern.test(under))) {
				return { response: new Response('Not Found', { status: 404 }) };
			}
		}) as BetterAuthPlugin['onRequest'],
		endpoints: {
			...sessionEndpoints(() => state.context),
			/**
			 * `GET <path>/loam/whoami` (4.2): the session, read from the database since there is no cookie cache,
			 * and the person's membership of the bound organization by its id, or `null` signed out. A session
			 * whose user id starts `agt_` is none (3.2).
			 */
			loamWhoami: createAuthEndpoint('/loam/whoami', { method: 'GET' }, async (ctx) => {
				const found = await getSessionFromCtx(ctx);
				if (!found || found.user.id.startsWith(AGENT_PREFIX)) return ctx.json(null);
				const { session, user } = found;
				const adapter = adapterOf(state);
				const membership = await membershipOf(adapter, state.workspace, user.id);
				return ctx.json({
					session: { id: session.id, expiresAt: session.expiresAt },
					user: { id: user.id, email: user.email, name: user.name, image: user.image ?? null },
					membership,
					...(await bindingWarning(adapter, state, membership)),
				});
			}),
			/**
			 * `GET <path>/loam/binding` (2.3): the binding as it stands, for an owner of the bound organization,
			 * with `IDENTITY_BINDING_MISMATCH` when the deployment's slug no longer names it.
			 */
			loamBinding: createAuthEndpoint(
				'/loam/binding',
				{ method: 'GET', use: [sessionMiddleware] },
				async (ctx) => {
					const adapter = adapterOf(state);
					const binding = await readBinding(adapter, state.workspace);
					const member =
						binding &&
						(await memberOf(adapter, binding.organizationId, ctx.context.session.user.id));
					if (!binding || !member || !isOwnerRole(member.role)) throw ownerRequired();
					return ctx.json(await statusOf(adapter, binding, state.organization));
				}
			),
		},
		hooks: {
			after: [
				{
					/**
					 * `/get-session` answers the session without its token (NEW-3): the session cookie is HttpOnly, and
					 * the page reads the person and the expiry, never the token, which is the credential itself.
					 */
					matcher: (ctx: { path?: string }) => ctx.path === '/get-session',
					handler: createAuthMiddleware(async (ctx) => {
						const answer = await withoutToken(ctx.context.returned);
						if (answer) return ctx.json(answer);
					}),
				},
			],
			before: [
				freshSessionHook(() => state.context),
				{
					/**
					 * The provider's own role endpoints, called directly around Loam's commands (7.1, 7.5): only an
					 * `owner` grants, changes or removes the `owner` role. Better Auth refuses it too; this answers
					 * with Loam's code, and holds whatever the plugin's own check becomes.
					 */
					matcher: (ctx: { path?: string }) => ROLE_PATHS.has(ctx.path ?? ''),
					handler: createAuthMiddleware(async (ctx) => {
						const body = (ctx.body ?? {}) as {
							organizationId?: string;
							memberId?: string;
							memberIdOrEmail?: string;
							role?: string | string[];
						};
						const session = await getSessionFromCtx(ctx);
						// No session: the plugin refuses it itself.
						if (!session) return;
						// The organization as Better Auth resolves it: the body's, else the session's active one,
						// which Better Auth sets on accepting an invitation. Loam never reads it but here, where the
						// caller is checked, and never sets it (2.3). A call naming neither is refused.
						const organizationId =
							body.organizationId ??
							(session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
						if (typeof organizationId !== 'string') {
							throw refusal(
								'BAD_REQUEST',
								'NO_ACTIVE_ORGANIZATION',
								'Name the organization with organizationId'
							);
						}
						const adapter = adapterOf(state);
						const caller = await memberOf(adapter, organizationId, session.user.id);
						if (!caller || rolesOf(caller.role).includes('owner')) return;
						const target = await memberNamed(
							adapter,
							organizationId,
							String(body.memberId ?? body.memberIdOrEmail ?? '')
						);
						const granting = [body.role ?? []]
							.flat()
							.some((role) => rolesOf(role).includes('owner'));
						if (granting || rolesOf(target?.role).includes('owner')) throw ownerRequired();
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
