/**
 * @fileoverview Connected agents (phase 3 specification, 9.2 and 5.3; D98; step 7): a person's own external agent over
 * MCP, an agent member they sponsor, kept in `loamServerPlugin`'s own `loam_connected_agent` table in the provider's
 * database, authoritative in every phase. A row has `AgentMemberV1`'s shape with `kind: 'connected'`.
 *
 * - **Connecting** is the person's approval on the consent page: a `before` hook on `/oauth2/consent` runs
 *   {@link connectAgent} when it accepts, so no token is issued to a connection that was refused. It refuses a person
 *   who is no workspace member (`WORKSPACE_NOT_MEMBER`) and a client an owner removed for this person
 *   (`AGENT_DISCONNECTED_BY_OWNER`); the sponsor confirmation of D111 does not apply, since the sponsor connects it.
 * - **Disconnecting:** the person by `account-agent-disconnect`, which deletes the record, the client's consent and its
 *   refresh tokens, so they may reconnect; an owner by `agent-member-remove`, which keeps the record as
 *   `suspended: 'owner'` so the person cannot simply reconnect it, or with `forget` deletes it. Its last access token
 *   lives out its 10 minutes (S86).
 * - **Narrowing:** the person by `account-agent-update` (9.2, #2784), which writes the record's `access` and revokes
 *   nothing: the next request reads the new record (9.5), and line 4 intersects it with the person's own access.
 * - **Ending a person's connections** (`revoke-person`'s `all`, recovery): their consents deleted and refresh tokens
 *   revoked, and on recovery their connected agents suspended (`disconnected`).
 */

import { randomInt } from 'node:crypto';
import type { AuthContext } from 'better-auth';
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	sessionMiddleware,
} from 'better-auth/api';
import { type BindingAdapter, membershipOf } from './binding.js';
import { isOwnerRole } from './roles.js';

/** The plugin's table, by its schema name. */
export const CONNECTED_AGENT_MODEL = 'loamConnectedAgent';

export const CONNECTED_AGENT_FIELDS = {
	agentId: { type: 'string', required: true, unique: true, input: false },
	workspace: { type: 'string', required: true, input: false },
	name: { type: 'string', required: true, input: false },
	clientId: { type: 'string', required: true, input: false },
	/** The metadata document's host, or empty for a client the deployer registered. */
	clientHost: { type: 'string', required: true, input: false },
	sponsor: { type: 'string', required: true, input: false },
	installedBy: { type: 'string', required: true, input: false },
	/** `AgentMemberV1['access']`, as JSON. */
	access: { type: 'string', required: true, input: false },
	/** The scopes the person approved, space-separated. */
	scopes: { type: 'string', required: true, input: false },
	status: { type: 'string', required: true, input: false },
	suspended: { type: 'string', required: false, input: false },
	createdAt: { type: 'date', required: true, input: false },
	updatedAt: { type: 'date', required: true, input: false },
	updatedBy: { type: 'string', required: true, input: false },
} as const;

/** A row of `loam_connected_agent`. */
export interface ConnectedAgentRow {
	id: string;
	agentId: string;
	workspace: string;
	name: string;
	clientId: string;
	clientHost: string;
	sponsor: string;
	installedBy: string;
	access: string;
	scopes: string;
	status: 'active' | 'suspended';
	suspended?: 'disconnected' | 'owner' | null;
	createdAt: Date;
	updatedAt: Date;
	updatedBy: string;
}

/** A connected agent as the kernel reads it: `AgentMemberV1` with `kind: 'connected'`, and the scopes approved (5.3). */
export interface ConnectedAgentV1 {
	id: string;
	workspace: string;
	kind: 'connected';
	name: string;
	sponsor: string;
	installedBy: string;
	client: { id: string; host: string };
	access: { workspace: boolean; projects: string[] | 'sponsor' };
	status: 'active' | 'suspended';
	suspended?: 'disconnected' | 'owner';
	scopes: string[];
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
	/**
	 * How many projects `access` names that this answer leaves out: the list endpoint names another person's agent's
	 * projects to no one but its sponsor, since the provider cannot tell which projects a caller may see (#2784).
	 */
	withheldProjects?: number;
}

/** A connected agent's access unless its person narrowed it (9.2): whatever its person may enter. */
export const CONNECTED_ACCESS = Object.freeze({ workspace: true, projects: 'sponsor' as const });

/** Most projects a connected agent's `access` names, as the kernel's `AGENT_PROJECTS_MAX` (8.1). */
export const CONNECTED_PROJECTS_MAX = 200;

/** Two accesses alike: the same flag and the same projects, in any order. */
function sameAccess(a: ConnectedAgentV1['access'], b: ConnectedAgentV1['access']): boolean {
	if (a.workspace !== b.workspace) return false;
	if (a.projects === 'sponsor' || b.projects === 'sponsor') return a.projects === b.projects;
	const held = new Set(a.projects);
	return held.size === new Set(b.projects).size && b.projects.every((id) => held.has(id));
}

/**
 * `access` as a request gives it, or undefined when it is not `{ workspace: boolean; projects: string[] | 'sponsor' }`
 * with at most {@link CONNECTED_PROJECTS_MAX} distinct ids of 1 to 256 characters. The kernel has resolved each one
 * to a project its person may enter; one sent past it grants nothing, since line 4 intersects it with theirs.
 */
export function requestedAccess(value: unknown): ConnectedAgentV1['access'] | undefined {
	const asked = value as { workspace?: unknown; projects?: unknown } | null | undefined;
	if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) return undefined;
	if (Object.keys(asked).some((key) => key !== 'workspace' && key !== 'projects')) return undefined;
	const { workspace, projects } = asked;
	if (typeof workspace !== 'boolean') return undefined;
	if (projects === 'sponsor') return { workspace, projects };
	if (
		!Array.isArray(projects) ||
		projects.length > CONNECTED_PROJECTS_MAX ||
		!projects.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)
	)
		return undefined;
	return { workspace, projects: [...new Set(projects as string[])] };
}

type Where = { field: string; value: unknown; operator?: string }[];
/** The slice of Better Auth's adapter these writes use. */
export type ConnectionAdapter = BindingAdapter & {
	findMany<T>(query: {
		model: string;
		where?: Where;
		limit?: number;
		offset?: number;
		sortBy?: { field: string; direction: 'asc' | 'desc' };
	}): Promise<T[]>;
	update<T>(query: {
		model: string;
		where: Where;
		update: Record<string, unknown>;
	}): Promise<T | null>;
	updateMany(query: {
		model: string;
		where: Where;
		update: Record<string, unknown>;
	}): Promise<number>;
	delete(query: { model: string; where: Where }): Promise<void>;
	deleteMany(query: { model: string; where: Where }): Promise<number>;
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `agt_` and 20 of `[a-z0-9]` (3.2), from the provider's random source. */
const newAgentId = () =>
	`agt_${Array.from({ length: 20 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')}`;

const refusal = (
	status: 'FORBIDDEN' | 'BAD_REQUEST' | 'NOT_FOUND',
	code: string,
	message: string
) => APIError.from(status, { code, message });

const accessOf = (text: string): ConnectedAgentV1['access'] => {
	try {
		const parsed = JSON.parse(text) as ConnectedAgentV1['access'];
		if (
			typeof parsed?.workspace === 'boolean' &&
			(parsed.projects === 'sponsor' ||
				(Array.isArray(parsed.projects) && parsed.projects.every((id) => typeof id === 'string')))
		)
			return parsed;
	} catch {}
	// A row whose access does not parse grants nothing.
	return { workspace: false, projects: [] };
};

/** A row as the kernel reads it. */
export function connectedAgentOf(row: ConnectedAgentRow): ConnectedAgentV1 {
	return {
		id: row.agentId,
		workspace: row.workspace,
		kind: 'connected',
		name: row.name,
		sponsor: row.sponsor,
		installedBy: row.installedBy,
		client: { id: row.clientId, host: row.clientHost },
		access: accessOf(row.access),
		status: row.status === 'active' ? 'active' : 'suspended',
		...(row.status !== 'active'
			? { suspended: row.suspended === 'owner' ? ('owner' as const) : ('disconnected' as const) }
			: {}),
		scopes: row.scopes.split(' ').filter(Boolean),
		createdAt: new Date(row.createdAt).getTime(),
		updatedAt: new Date(row.updatedAt).getTime(),
		updatedBy: row.updatedBy,
	};
}

/** A page of the provider's adapter: Better Auth answers at most 100 rows a read unless told otherwise. */
const PAGE = 100;

/** Every row `where` names, page by page in a stable order, so none past the first hundred is left out. */
async function allRows<T>(adapter: ConnectionAdapter, model: string, where: Where): Promise<T[]> {
	const rows: T[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const page = await adapter.findMany<T>({
			model,
			where,
			limit: PAGE,
			offset,
			// The unique id: a stable order whatever rows share a timestamp, so no row repeats or goes missing across pages.
			sortBy: { field: 'id', direction: 'asc' },
		});
		rows.push(...page);
		if (page.length < PAGE) return rows;
	}
}

/** The workspace's connected agents, every person's, as rows, oldest first. */
export const connectedAgentRows = (adapter: ConnectionAdapter, workspace: string) =>
	allRows<ConnectedAgentRow>(adapter, CONNECTED_AGENT_MODEL, [
		{ field: 'workspace', value: workspace },
	]);

/** Every row of one person's connection of one client: one, or none; more is a race the readers refuse. */
const connectionsOf = (
	adapter: ConnectionAdapter,
	workspace: string,
	clientId: string,
	sponsor: string
) =>
	allRows<ConnectedAgentRow>(adapter, CONNECTED_AGENT_MODEL, [
		{ field: 'workspace', value: workspace },
		{ field: 'clientId', value: clientId },
		{ field: 'sponsor', value: sponsor },
	]);

/**
 * One person's connection of one client in the workspace (9.2's step 3), or null. Two rows, which only two approvals
 * racing could make, is null too: fail closed, so an owner's removal of one never leaves the other admitting.
 */
export async function connectionOf(
	adapter: ConnectionAdapter,
	workspace: string,
	clientId: string,
	sponsor: string
): Promise<ConnectedAgentRow | null> {
	const rows = await connectionsOf(adapter, workspace, clientId, sponsor);
	return rows.length === 1 ? (rows[0] as ConnectedAgentRow) : null;
}

/** A connected agent by its `agt_` id, in this workspace, or null. */
const rowById = (adapter: ConnectionAdapter, workspace: string, agent: string) =>
	adapter.findOne<ConnectedAgentRow>({
		model: CONNECTED_AGENT_MODEL,
		where: [
			{ field: 'agentId', value: agent },
			{ field: 'workspace', value: workspace },
		],
	});

/**
 * A person's OAuth connections ended (5.3, 4.6, 5.7): their consents deleted and their refresh tokens revoked, for one
 * client or for all. JWT access tokens cannot be revoked (S86), so the last one lives out its 10 minutes.
 */
export async function endConnections(
	adapter: ConnectionAdapter,
	userId: string,
	options: { clientId?: string; now?: Date } = {}
): Promise<void> {
	const now = options.now ?? new Date();
	const client =
		options.clientId === undefined ? [] : [{ field: 'clientId', value: options.clientId }];
	await adapter.deleteMany({
		model: 'oauthConsent',
		where: [{ field: 'userId', value: userId }, ...client],
	});
	await adapter.updateMany({
		model: 'oauthRefreshToken',
		where: [{ field: 'userId', value: userId }, ...client, { field: 'revoked', value: null }],
		update: { revoked: now },
	});
}

/**
 * Recovery's (5.7), `revoke-person`'s `others` and `all` (4.3) and a member's removal (7.5): every connected agent the
 * person sponsors suspended (`disconnected`, which their own approval lifts, never an owner's removal), and every
 * connection of theirs ended.
 */
export async function suspendConnections(
	adapter: ConnectionAdapter,
	userId: string,
	now = new Date()
): Promise<void> {
	await adapter.updateMany({
		model: CONNECTED_AGENT_MODEL,
		where: [
			{ field: 'sponsor', value: userId },
			{ field: 'status', value: 'active' },
		],
		update: { status: 'suspended', suspended: 'disconnected', updatedAt: now, updatedBy: userId },
	});
	await endConnections(adapter, userId, { now });
}

export interface ConnectAgentInput {
	workspace: string;
	/** The person approving: the sponsor and the one who connects it (D98). */
	person: string;
	client: { id: string; name: string; host: string };
	scopes: readonly string[];
	now?: Date;
}

/**
 * Connect a person's external agent (9.2): the record written, or made active again, with the person as sponsor and as
 * the one who installed it. Refuses a person who is no workspace member, so no token is ever issued to a non-member's
 * new connection, and a client an owner removed for this person while that removal stands.
 *
 * @throws APIError `WORKSPACE_NOT_MEMBER` (403) or `AGENT_DISCONNECTED_BY_OWNER` (403)
 */
export async function connectAgent(
	adapter: ConnectionAdapter,
	input: ConnectAgentInput
): Promise<ConnectedAgentV1> {
	const now = input.now ?? new Date();
	const rows = await mayConnect(adapter, input.workspace, input.person, input.client.id);
	const scopes = [...new Set(input.scopes)].join(' ');
	// The client's self-asserted name, kept to what the members tab shows (8.1: 1 to 80).
	const name = input.client.name.trim().slice(0, 80) || 'Connected app';
	const [held, ...extra] = rows;
	// Two approvals that raced made two rows: the oldest is kept, the rest go, so one record answers for the client.
	for (const row of extra)
		await adapter.delete({ model: CONNECTED_AGENT_MODEL, where: [{ field: 'id', value: row.id }] });
	if (held) {
		const update = {
			status: 'active' as const,
			suspended: null,
			name,
			scopes,
			updatedAt: now,
			updatedBy: input.person,
		};
		await adapter.update({
			model: CONNECTED_AGENT_MODEL,
			where: [{ field: 'id', value: held.id }],
			update,
		});
		return connectedAgentOf({ ...held, ...update });
	}
	const row = {
		agentId: newAgentId(),
		workspace: input.workspace,
		name,
		clientId: input.client.id,
		clientHost: input.client.host,
		sponsor: input.person,
		installedBy: input.person,
		access: JSON.stringify(CONNECTED_ACCESS),
		scopes,
		status: 'active' as const,
		suspended: null,
		createdAt: now,
		updatedAt: now,
		updatedBy: input.person,
	};
	await adapter.create({ model: CONNECTED_AGENT_MODEL, data: row });
	return connectedAgentOf({ ...row, id: '' });
}

/**
 * Whether `person` may connect `client` (9.2): a workspace member, and no owner's removal of it for them standing. The
 * rows held, for {@link connectAgent}.
 *
 * @throws APIError `WORKSPACE_NOT_MEMBER` (403) or `AGENT_DISCONNECTED_BY_OWNER` (403)
 */
export async function mayConnect(
	adapter: ConnectionAdapter,
	workspace: string,
	person: string,
	client: string
): Promise<ConnectedAgentRow[]> {
	if (!(await membershipOf(adapter, workspace, person))) {
		throw refusal(
			'FORBIDDEN',
			'WORKSPACE_NOT_MEMBER',
			'You are not a member of this workspace, so you cannot connect an agent to it. Ask an owner to invite you'
		);
	}
	const rows = await connectionsOf(adapter, workspace, client, person);
	if (rows.some((row) => row.status === 'suspended' && row.suspended === 'owner')) {
		throw disconnectedByOwner();
	}
	return rows;
}

const disconnectedByOwner = () =>
	refusal(
		'FORBIDDEN',
		'AGENT_DISCONNECTED_BY_OWNER',
		'An owner disconnected this app for you. Ask an owner of the workspace to allow it again'
	);

/** A client id that is a metadata document's URL names its host; one the deployer registered names none (9.4). */
export function clientHostOf(clientId: string): string {
	try {
		const url = new URL(clientId);
		return url.protocol === 'https:' ? url.host : '';
	} catch {
		return '';
	}
}

/** The consent request's client and the person, or undefined when the provider refuses it itself. */
async function consentOf(
	ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
	context: () => AuthContext | undefined
) {
	const body = (ctx.body ?? {}) as { accept?: unknown; oauth_query?: unknown };
	if (body.accept !== true) return undefined;
	const session = await getSessionFromCtx(ctx);
	if (!session) return undefined;
	const clientId = new URLSearchParams(
		typeof body.oauth_query === 'string' ? body.oauth_query : ''
	).get('client_id');
	if (!clientId) return undefined;
	const adapter = (context() ?? ctx.context).adapter as unknown as ConnectionAdapter;
	return { adapter, person: session.user.id, clientId };
}

/**
 * The consent page's approval (9.2, 9.4), in two halves. **Before** Better Auth stores the consent and issues a code:
 * the person must be a workspace member, and no owner's removal of this client for them may stand, or the approval is
 * refused and no code is issued. **After**, only when the provider answered a redirect carrying a code: the record is
 * written or made active, with the scopes the stored consent holds, so a consent the provider refused (a scope not
 * asked for, a login it sent back) connects nothing. A denial connects nothing.
 */
export function consentHooks(deps: { workspace: string; context(): AuthContext | undefined }) {
	const matcher = (ctx: { path?: string }) => ctx.path === '/oauth2/consent';
	return {
		before: {
			matcher,
			handler: createAuthMiddleware(async (ctx) => {
				const consent = await consentOf(ctx, deps.context);
				if (consent)
					await mayConnect(consent.adapter, deps.workspace, consent.person, consent.clientId);
			}),
		},
		after: {
			matcher,
			handler: createAuthMiddleware(async (ctx) => {
				const consent = await consentOf(ctx, deps.context);
				if (!consent) return;
				const returned = ctx.context.returned as unknown;
				const body =
					returned instanceof Response
						? await returned
								.clone()
								.json()
								.catch(() => undefined)
						: returned;
				const { adapter, person, clientId } = consent;
				const url = (body as { url?: unknown } | undefined)?.url;
				// A consent stored with no record to answer for it would be silent from then on: the provider issues codes
				// without asking, and `principalOf` refuses each token. So a consent that made no record is ended, and the
				// consent page shows again next time.
				const unrecorded = async () => {
					const held = await connectionOf(adapter, deps.workspace, clientId, person);
					if (held?.status !== 'active') await endConnections(adapter, person, { clientId });
				};
				if (typeof url !== 'string' || !new URL(url, 'https://x.invalid').searchParams.get('code'))
					return unrecorded();
				const [client, stored] = await Promise.all([
					adapter.findOne<{ name?: string | null }>({
						model: 'oauthClient',
						where: [{ field: 'clientId', value: clientId }],
					}),
					adapter.findOne<{ scopes?: string[] | string | null }>({
						model: 'oauthConsent',
						where: [
							{ field: 'clientId', value: clientId },
							{ field: 'userId', value: person },
						],
					}),
				]);
				const scopes = Array.isArray(stored?.scopes)
					? stored.scopes
					: String(stored?.scopes ?? '')
							.split(/[ ,]/)
							.filter(Boolean);
				try {
					await connectAgent(adapter, {
						workspace: deps.workspace,
						person,
						client: { id: clientId, name: client?.name ?? '', host: clientHostOf(clientId) },
						scopes,
					});
				} catch (cause) {
					await unrecorded().catch(() => undefined);
					throw cause;
				}
			}),
		},
	};
}

/** Whether `person` holds an owner role in the bound organization (D96: `owner` or `admin`). */
async function ownerOf(adapter: ConnectionAdapter, workspace: string, person: string) {
	const membership = await membershipOf(adapter, workspace, person);
	return membership !== null && isOwnerRole(membership.role);
}

/**
 * - `GET <path>/loam/connected-agents`: the workspace's connected agents, every person's, to a member of it (8.2: any
 *   member sees the agent members, filtered by the kernel); never a client secret or a token.
 * - `POST <path>/loam/connected-agents/disconnect { agent }`: the person's own, deleting the record, the client's
 *   consent and its refresh tokens (5.3). Another person's is `AGENT_MEMBER_SPONSOR_ONLY`, and one an owner removed
 *   `AGENT_DISCONNECTED_BY_OWNER`; nothing changes for either.
 * - `POST <path>/loam/connected-agents/update { agent, access, previous? }`: the person's own (9.2, #2784), to a member:
 *   its `access`, `updatedAt` and `updatedBy` written, no token revoked. The write is conditional on the record as read,
 *   so an owner's removal or another change between the read and the write refuses it; and with `previous`, the access
 *   the kernel read, a record that has changed since is `AGENT_ACCESS_CHANGED` (409). The kernel refuses an undo of a
 *   change already replaced itself, by the access the undo expects. A non-member is `WORKSPACE_NOT_MEMBER`, another person's agent
 *   `AGENT_MEMBER_SPONSOR_ONLY`, one an owner removed `AGENT_DISCONNECTED_BY_OWNER`, and a malformed `access` or
 *   `previous` `VALIDATION_ERROR`; nothing changes for any of them.
 * - `POST <path>/loam/connected-agents/remove { agent, forget? }`: an owner's (9.2): the record kept as
 *   `suspended: 'owner'`, or deleted with `forget`, and its person's consent and refresh tokens for the client ended.
 *   A non-owner's is `OWNER_REQUIRED`, and nothing changes.
 */
export function connectedAgentEndpoints(deps: { workspace: string }) {
	const notMember = () =>
		refusal('FORBIDDEN', 'WORKSPACE_NOT_MEMBER', 'You are not a member of this workspace');
	const named = (body: unknown): string => {
		const agent = (body as { agent?: unknown } | undefined)?.agent;
		if (typeof agent !== 'string' || !/^agt_[a-z0-9]{20}$/.test(agent)) {
			throw refusal('BAD_REQUEST', 'VALIDATION_ERROR', "Name a connected agent by its 'agt_' id");
		}
		return agent;
	};
	const notFound = () =>
		refusal(
			'NOT_FOUND',
			'AGENT_MEMBER_NOT_FOUND',
			'No connected agent with that id in this workspace'
		);
	const accessChanged = () =>
		APIError.from('CONFLICT', {
			code: 'AGENT_ACCESS_CHANGED',
			message: "This agent's access changed since it was read. Read it again, then choose again",
		});
	return {
		loamConnectedAgents: createAuthEndpoint(
			'/loam/connected-agents',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as ConnectionAdapter;
				const person = ctx.context.session.user.id;
				if (!(await membershipOf(adapter, deps.workspace, person))) throw notMember();
				const rows = await connectedAgentRows(adapter, deps.workspace);
				// The scopes a person approved, and the projects they named (#2784), are theirs alone to see: the provider
				// cannot tell which projects another member may see, so it names none and counts them (8.2).
				return ctx.json({
					agents: rows.map((row) => {
						const agent = connectedAgentOf(row);
						if (row.sponsor === person) return agent;
						const { projects } = agent.access;
						return {
							...agent,
							scopes: [],
							...(projects === 'sponsor'
								? {}
								: {
										access: { workspace: agent.access.workspace, projects: [] },
										withheldProjects: projects.length,
									}),
						};
					}),
				});
			}
		),
		loamConnectedAgentDisconnect: createAuthEndpoint(
			'/loam/connected-agents/disconnect',
			{ method: 'POST', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as ConnectionAdapter;
				const agent = named(ctx.body);
				const person = ctx.context.session.user.id;
				const row = await rowById(adapter, deps.workspace, agent);
				if (!row) throw notFound();
				if (row.sponsor !== person) {
					throw refusal(
						'FORBIDDEN',
						'AGENT_MEMBER_SPONSOR_ONLY',
						'Only the person who connected this agent can disconnect it; an owner removes it from the members tab'
					);
				}
				// An owner's removal stands until an owner lifts it (9.2): its sponsor cannot clear it by disconnecting.
				if (row.status === 'suspended' && row.suspended === 'owner') throw disconnectedByOwner();
				// The connections end first, so a failure leaves the record to try again, never a consent with no record.
				await endConnections(adapter, person, { clientId: row.clientId });
				await adapter.delete({
					model: CONNECTED_AGENT_MODEL,
					where: [{ field: 'id', value: row.id }],
				});
				return ctx.json({ disconnected: true });
			}
		),
		loamConnectedAgentUpdate: createAuthEndpoint(
			'/loam/connected-agents/update',
			{ method: 'POST', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as ConnectionAdapter;
				const person = ctx.context.session.user.id;
				// A member alone, as the list: no one else learns whether an id is someone's agent.
				if (!(await membershipOf(adapter, deps.workspace, person))) throw notMember();
				const agent = named(ctx.body);
				const body = (ctx.body ?? {}) as { access?: unknown; previous?: unknown };
				const access = requestedAccess(body.access);
				const previous = body.previous === undefined ? undefined : requestedAccess(body.previous);
				if (!access || (body.previous !== undefined && !previous)) {
					throw refusal(
						'BAD_REQUEST',
						'VALIDATION_ERROR',
						`access and previous are { workspace: boolean; projects: string[] | "sponsor" }, naming up to ${CONNECTED_PROJECTS_MAX} projects`
					);
				}
				const row = await rowById(adapter, deps.workspace, agent);
				if (!row) throw notFound();
				if (row.sponsor !== person) {
					throw refusal(
						'FORBIDDEN',
						'AGENT_MEMBER_SPONSOR_ONLY',
						'Only the person who connected this agent can change its access; an owner removes it from the members tab'
					);
				}
				// An owner's removal stands as the owner left it (9.2): its sponsor changes nothing of it.
				if (row.status === 'suspended' && row.suspended === 'owner') throw disconnectedByOwner();
				if (previous && !sameAccess(previous, connectedAgentOf(row).access)) throw accessChanged();
				const update = { access: JSON.stringify(access), updatedAt: new Date(), updatedBy: person };
				// Only the record as read: an owner's removal, a disconnect or another change in between matches nothing.
				const written = await adapter.update({
					model: CONNECTED_AGENT_MODEL,
					where: [
						{ field: 'id', value: row.id },
						{ field: 'access', value: row.access },
						{ field: 'status', value: row.status },
						...(row.status === 'suspended' ? [{ field: 'suspended', value: row.suspended }] : []),
					],
					update,
				});
				if (!written) {
					const now = await rowById(adapter, deps.workspace, agent);
					if (!now) throw notFound();
					if (now.status === 'suspended' && now.suspended === 'owner') throw disconnectedByOwner();
					throw accessChanged();
				}
				return ctx.json({ agent: connectedAgentOf({ ...row, ...update }) });
			}
		),
		loamConnectedAgentRemove: createAuthEndpoint(
			'/loam/connected-agents/remove',
			{ method: 'POST', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as ConnectionAdapter;
				const agent = named(ctx.body);
				const forget = (ctx.body as { forget?: unknown } | undefined)?.forget === true;
				const person = ctx.context.session.user.id;
				if (!(await ownerOf(adapter, deps.workspace, person))) {
					throw refusal(
						'FORBIDDEN',
						'OWNER_REQUIRED',
						'Only an owner of the workspace can remove a connected agent. Ask an owner'
					);
				}
				const row = await rowById(adapter, deps.workspace, agent);
				if (!row) throw notFound();
				const now = new Date();
				if (forget) {
					await adapter.delete({
						model: CONNECTED_AGENT_MODEL,
						where: [{ field: 'id', value: row.id }],
					});
				} else {
					await adapter.update({
						model: CONNECTED_AGENT_MODEL,
						where: [{ field: 'id', value: row.id }],
						update: { status: 'suspended', suspended: 'owner', updatedAt: now, updatedBy: person },
					});
				}
				await endConnections(adapter, row.sponsor, { clientId: row.clientId, now });
				return ctx.json({ removed: true });
			}
		),
	};
}
