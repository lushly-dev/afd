/**
 * @fileoverview A person's account and the workspace's members, read at the provider (phase 3 specification, 5.1, 5.7
 * and 7.2). Better Auth's own member reads, `/organization/list-members` and `/organization/get-full-organization`,
 * answer every member's email to any member, where 7.2 shows an email only to an owner; they are not served, and
 * `member-list` reads Loam's `/loam/members` instead (step 4's re-check of the organization routes).
 */

import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { type BindingAdapter, membershipDigest, readBinding } from './binding.js';
import { linkRefusal } from './enrolment.js';
import { isOwnerRole, loamRole } from './roles.js';

/** How a person could restore their own access (5.7, D97): single sign-on where they have it, else email if verified. */
export type RecoveryV1 = 'oidc' | 'email' | 'none';

interface MemberRow {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
	createdAt: Date;
}

interface UserRow {
	id: string;
	email: string;
	name: string;
	image?: string | null;
	emailVerified: boolean;
	recoveredAt?: Date | null;
}

export type Reads = BindingAdapter & {
	findMany<T>(query: {
		model: string;
		where?: { field: string; value: unknown; operator?: string }[];
		limit?: number;
		offset?: number;
		sortBy?: { field: string; direction: 'asc' | 'desc' };
	}): Promise<T[]>;
	count(query: { model: string; where?: { field: string; value: unknown }[] }): Promise<number>;
};

export interface MembersDeps {
	workspace: string;
	/** The deployer's single sign-on providers, by id. */
	oidc: readonly string[];
}

const notMember = () =>
	linkRefusal(
		'FORBIDDEN',
		'WORKSPACE_NOT_MEMBER',
		'You are not a member of this workspace. Ask an owner to invite you'
	);

/** A person's own account (5.1), read by their id: a session's, or a token's subject on the server (9.2). */
export async function readAccount(adapter: Reads, deps: MembersDeps, id: string) {
	const user = await adapter.findOne<UserRow>({
		model: 'user',
		where: [{ field: 'id', value: id }],
	});
	if (!user) throw notMember();
	const binding = await readBinding(adapter, deps.workspace);
	const members = await adapter.findMany<MemberRow>({
		model: 'member',
		where: [{ field: 'userId', value: id }],
	});
	const organizations = [];
	for (const member of members) {
		const organization = await adapter.findOne<{ id: string; slug: string; name: string }>({
			model: 'organization',
			where: [{ field: 'id', value: member.organizationId }],
		});
		if (!organization) continue;
		organizations.push({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			role: loamRole(member.role),
			bound: binding?.organizationId === organization.id,
		});
	}
	const bound = organizations.find((organization) => organization.bound);
	const accounts = await adapter.findMany<{ providerId: string }>({
		model: 'account',
		where: [{ field: 'userId', value: id }],
	});
	const passkey = await adapter.findOne<{ id: string }>({
		model: 'passkey',
		where: [{ field: 'userId', value: id }],
	});
	const oidc = accounts
		.map((account) => account.providerId)
		.filter((provider) => deps.oidc.includes(provider));
	const methods = [
		...(passkey ? ['passkey'] : []),
		...(accounts.some((account) => account.providerId === 'credential') ? ['password'] : []),
		...oidc.map((provider) => `oidc:${provider}`),
	];
	const recovery: RecoveryV1 =
		oidc.length > 0 ? 'oidc' : user.emailVerified === true ? 'email' : 'none';
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		image: user.image ?? null,
		organizations,
		workspace: {
			member: bound !== undefined,
			role: bound?.role ?? null,
			owner: bound !== undefined && isOwnerRole(bound.role),
		},
		methods,
		recovery,
		recoveredAt: user.recoveredAt ?? null,
	};
}

/** A person's own pending invitations, to their verified email (5.3). */
export async function readInvitations(
	adapter: Reads,
	user: { email: string; emailVerified?: boolean | null }
) {
	// Only to a verified address: an invitation is accepted only by one (5.3).
	if (user.emailVerified !== true) return [];
	const rows = await adapter.findMany<{
		id: string;
		organizationId: string;
		email: string;
		role: string;
		status: string;
		expiresAt: Date;
	}>({ model: 'invitation', where: [{ field: 'email', value: user.email.toLowerCase() }] });
	const now = Date.now();
	const invitations = [];
	for (const row of rows) {
		if (row.status !== 'pending' || new Date(row.expiresAt).getTime() <= now) continue;
		const organization = await adapter.findOne<{ slug: string; name: string }>({
			model: 'organization',
			where: [{ field: 'id', value: row.organizationId }],
		});
		if (!organization) continue;
		invitations.push({
			id: row.id,
			organization: { slug: organization.slug, name: organization.name },
			role: loamRole(row.role),
			expiresAt: new Date(row.expiresAt).toISOString(),
		});
	}
	return invitations;
}

/**
 * The bound organization's people (7.2), for the member `caller`: each one's email only when the caller is an owner.
 * `WORKSPACE_NOT_MEMBER` for a caller who holds no member row.
 */
export async function readMembers(
	adapter: Reads,
	deps: MembersDeps,
	caller: string,
	page: { limit?: unknown; offset?: unknown } = {}
) {
	const binding = await readBinding(adapter, deps.workspace);
	if (!binding) throw notMember();
	const inOrganization = [{ field: 'organizationId', value: binding.organizationId }];
	// The caller's own row by a direct read, never by searching one page of the members (a later member is one too).
	const held = await adapter.findOne<MemberRow>({
		model: 'member',
		where: [...inOrganization, { field: 'userId', value: caller }],
	});
	if (!held) throw notMember();
	const owner = isOwnerRole(held.role);
	const limit = Math.min(200, Math.max(1, Number(page.limit ?? 200) || 200));
	const offset = Math.max(0, Number(page.offset ?? 0) || 0);
	// The page from the database in a stable order, oldest first, and the total by count: Better Auth answers at most
	// 100 rows a read unless told otherwise.
	const rows = await adapter.findMany<MemberRow>({
		model: 'member',
		where: inOrganization,
		limit,
		offset,
		sortBy: { field: 'createdAt', direction: 'asc' },
	});
	const total = await adapter.count({ model: 'member', where: inOrganization });
	const people = [];
	for (const row of rows) {
		const user = await adapter.findOne<UserRow>({
			model: 'user',
			where: [{ field: 'id', value: row.userId }],
		});
		if (!user) continue;
		people.push({
			id: user.id,
			memberId: row.id,
			name: user.name,
			image: user.image ?? null,
			role: loamRole(row.role),
			// What `membership-settle` journals of a sponsor (4.4): a hash of what this answer already shows.
			digest: membershipDigest(binding.organizationId, row),
			...(owner ? { email: user.email } : {}),
		});
	}
	return { people, total };
}

/**
 * - `GET <path>/loam/account`: the person's own account (5.1): their organizations, read-only, the bound one marked;
 *   their membership of the workspace; how they sign in; how they could recover (5.7); when they last did.
 * - `GET <path>/loam/members?limit=&offset=`: the bound organization's people (7.2), to a member of it: name, image,
 *   role and their membership's digest (which `membership-settle` journals for a sponsor, 4.4), and each one's email
 *   only when the caller is an owner (D96).
 * - `GET <path>/loam/invitations`: the person's own pending invitations, to their verified email (5.3), with each
 *   organization's slug and name, which Better Auth's own list does not carry.
 *
 * Each reads by the session's person; the server reads the same functions by a token's person (9.2).
 */
export function memberEndpoints(deps: MembersDeps) {
	return {
		loamAccount: createAuthEndpoint(
			'/loam/account',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) =>
				ctx.json(
					await readAccount(
						ctx.context.adapter as unknown as Reads,
						deps,
						ctx.context.session.user.id
					)
				)
		),
		loamInvitations: createAuthEndpoint(
			'/loam/invitations',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) =>
				ctx.json({
					invitations: await readInvitations(
						ctx.context.adapter as unknown as Reads,
						ctx.context.session.user
					),
				})
		),
		loamMembers: createAuthEndpoint(
			'/loam/members',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) =>
				ctx.json(
					await readMembers(
						ctx.context.adapter as unknown as Reads,
						deps,
						ctx.context.session.user.id,
						(ctx.query ?? {}) as { limit?: unknown; offset?: unknown }
					)
				)
		),
	};
}
