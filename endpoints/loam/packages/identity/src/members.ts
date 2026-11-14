/**
 * @fileoverview A person's account and the workspace's members, read at the provider (phase 3 specification, 5.1, 5.7
 * and 7.2). Better Auth's own member reads, `/organization/list-members` and `/organization/get-full-organization`,
 * answer every member's email to any member, where 7.2 shows an email only to an owner; they are not served, and
 * `member-list` reads Loam's `/loam/members` instead (step 4's re-check of the organization routes).
 */

import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { type BindingAdapter, readBinding } from './binding.js';
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

type Reads = BindingAdapter & {
	findMany<T>(query: {
		model: string;
		where?: { field: string; value: unknown; operator?: string }[];
		limit?: number;
		offset?: number;
	}): Promise<T[]>;
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

/**
 * - `GET <path>/loam/account`: the person's own account (5.1): their organizations, read-only, the bound one marked;
 *   their membership of the workspace; how they sign in; how they could recover (5.7); when they last did.
 * - `GET <path>/loam/members?limit=&offset=`: the bound organization's people (7.2), to a member of it: name, image
 *   and role, and each one's email only when the caller is an owner (D96).
 * - `GET <path>/loam/invitations`: the person's own pending invitations, to their verified email (5.3), with each
 *   organization's slug and name, which Better Auth's own list does not carry.
 */
export function memberEndpoints(deps: MembersDeps) {
	return {
		loamAccount: createAuthEndpoint(
			'/loam/account',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as Reads;
				const id = ctx.context.session.user.id;
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
				return ctx.json({
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
				});
			}
		),
		loamInvitations: createAuthEndpoint(
			'/loam/invitations',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as Reads;
				const { user } = ctx.context.session;
				// Only to a verified address: an invitation is accepted only by one (5.3).
				if (user.emailVerified !== true) return ctx.json({ invitations: [] });
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
				return ctx.json({ invitations });
			}
		),
		loamMembers: createAuthEndpoint(
			'/loam/members',
			{ method: 'GET', use: [sessionMiddleware] },
			async (ctx) => {
				const adapter = ctx.context.adapter as unknown as Reads;
				const binding = await readBinding(adapter, deps.workspace);
				if (!binding) throw notMember();
				const rows = await adapter.findMany<MemberRow>({
					model: 'member',
					where: [{ field: 'organizationId', value: binding.organizationId }],
				});
				const caller = rows.find((row) => row.userId === ctx.context.session.user.id);
				if (!caller) throw notMember();
				const owner = isOwnerRole(caller.role);
				const query = (ctx.query ?? {}) as { limit?: unknown; offset?: unknown };
				const limit = Math.min(200, Math.max(1, Number(query.limit ?? 200) || 200));
				const offset = Math.max(0, Number(query.offset ?? 0) || 0);
				const ordered = [...rows].sort(
					(a, b) =>
						new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
						(a.id < b.id ? -1 : 1)
				);
				const people = [];
				for (const row of ordered.slice(offset, offset + limit)) {
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
						...(owner ? { email: user.email } : {}),
					});
				}
				return ctx.json({ people, total: rows.length });
			}
		),
	};
}
