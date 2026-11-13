/**
 * `createLoamAuthOptions`, the binding and the organization hooks as units (phase 3 specification, 2.3,
 * 2.6, 7.1 and 7.5), over a database adapter held in memory: the cases Better Auth's own checks answer
 * before a hook can, so only a unit reaches them.
 */

import { describe, expect, it } from 'vitest';
import { type BindingAdapter, bindOrganization, membershipOf } from './binding.js';
import { createOrganizationHooks } from './hooks.js';
import { createLoamAuthOptions, FRESH_AGE_SECONDS, LOAM_DISABLED_PATHS } from './options.js';
import type { LoamProviderState } from './plugin.js';
import { isOwnerRole, loamRole, loamRoles } from './roles.js';
import { REVOKES_CONSENTS } from './sessions.js';

const BASE = {
	baseURL: 'https://acme.example/loam/api/auth',
	secret: 'x'.repeat(32),
	database: undefined,
	workspace: 'acme',
	organization: 'acme',
	methods: ['passkey'] as const,
	mail: { send: async () => {} },
};

type Row = Record<string, unknown> & { id: string };

/** The options a deployment gets, with the fields these tests read held present. */
interface Built {
	baseURL: string;
	basePath: string;
	trustedOrigins: string[];
	session: unknown;
	advanced: { useSecureCookies: boolean };
	disabledPaths: string[];
	user: { changeEmail: { enabled: boolean } };
	emailAndPassword: unknown;
	account: { accountLinking: { enabled: boolean } };
	databaseHooks: {
		user: { create: { before(user: unknown, context: unknown): Promise<unknown> } };
	};
	plugins: { id: string; options?: Record<string, unknown> }[];
}
const built = (extra: Record<string, unknown> = {}): Built =>
	createLoamAuthOptions({ ...BASE, ...extra } as typeof BASE) as unknown as Built;

/** Better Auth's adapter, as far as the binding and the hooks use it, over tables in memory. */
function memoryAdapter(
	tables: Record<string, Row[]> = {}
): BindingAdapter & { tables: typeof tables } {
	const matches = (row: Row, where: { field: string; value: string }[] = []) =>
		where.every(({ field, value }) => row[field] === value);
	return {
		tables,
		async findOne<T>({
			model,
			where,
		}: {
			model: string;
			where: { field: string; value: string }[];
		}) {
			return ((tables[model] ?? []).find((row) => matches(row, where)) ?? null) as T | null;
		},
		async findMany<T>({
			model,
			where,
		}: {
			model: string;
			where?: { field: string; value: string }[];
		}) {
			return (tables[model] ?? []).filter((row) => matches(row, where)) as T[];
		},
		async create({ model, data }: { model: string; data: Record<string, unknown> }) {
			const row = { id: `${model}-${(tables[model]?.length ?? 0) + 1}`, ...data } as Row;
			tables[model] = [...(tables[model] ?? []), row];
			return row;
		},
	};
}

describe('createLoamAuthOptions (2.6)', () => {
	it('pins the origin, turns the cookie cache off and sets freshAge, with no bearer plugin', () => {
		const options = built();
		expect([options.baseURL, options.basePath, options.trustedOrigins]).toEqual([
			'https://acme.example',
			'/loam/api/auth',
			['https://acme.example'],
		]);
		expect(options.session).toEqual({
			cookieCache: { enabled: false },
			freshAge: FRESH_AGE_SECONDS,
		});
		expect(FRESH_AGE_SECONDS).toBe(300);
		expect(options.advanced.useSecureCookies).toBe(true);
		expect(options.plugins.map((plugin) => plugin.id).sort()).toEqual([
			'loam',
			'organization',
			'passkey',
		]);
	});

	it('disables the reset, email change, JWT token and active-organization routes', () => {
		const options = built();
		expect(options.disabledPaths).toEqual([...LOAM_DISABLED_PATHS]);
		for (const path of [
			'/token',
			'/request-password-reset',
			'/reset-password',
			'/reset-password/:token',
			'/forget-password/email-otp',
			'/change-email',
			'/organization/set-active',
		])
			expect(options.disabledPaths).toContain(path);
		expect(options.user.changeEmail.enabled).toBe(false);
	});

	it('serves passwords only when `methods` holds them, with no sign-up and verified email', () => {
		expect(built().emailAndPassword).toEqual({ enabled: false });
		expect(built({ methods: ['passkey', 'password'] }).emailAndPassword).toEqual({
			enabled: true,
			disableSignUp: true,
			requireEmailVerification: true,
		});
	});

	it('gives the passkey the exact host and origin, with resident keys and user verification required', () => {
		const passkey = built().plugins.find((plugin) => plugin.id === 'passkey') as unknown as {
			options?: Record<string, unknown>;
		};
		expect(passkey.options).toMatchObject({
			rpID: 'acme.example',
			origin: 'https://acme.example',
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		});
	});

	it('creates a user only from a configured OIDC sign-in with a verified email', async () => {
		const oidc = {
			id: 'okta',
			clientId: 'c',
			clientSecret: 's',
			discoveryUrl: 'https://idp.example/.well-known',
		};
		const options = built({ methods: ['passkey', 'oidc:okta'], oidc: [oidc] });
		const creating = options.databaseHooks.user.create.before;
		const user = (emailVerified: boolean) => ({
			id: 'u',
			email: 'a@example.com',
			name: 'A',
			emailVerified,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const at = (path: string, params?: Record<string, string>) => ({ path, params }) as never;
		// genericOAuth's providers sign in on the core callback, `/callback/:id`, which names the provider in `id`
		// and, as the router resolves it, last in the path (NEW-2).
		expect(await creating(user(true), at('/callback/okta', { id: 'okta' }))).toBe(true);
		expect(await creating(user(true), at('/callback/:id', { id: 'okta' }))).toBe(true);
		expect(await creating(user(true), at('/callback/okta'))).toBe(true);
		expect(await creating(user(false), at('/callback/okta', { id: 'okta' }))).toBe(false);
		expect(await creating(user(true), at('/callback/other', { id: 'other' }))).toBe(false);
		// A path no route serves names no provider.
		expect(await creating(user(true), at('/oauth2/callback/okta'))).toBe(false);
		expect(await creating(user(true), at('/sign-up/email'))).toBe(false);
		expect(await creating(user(true), null)).toBe(false);
		// Linking only on a verified email, never to another email.
		expect(options.account.accountLinking).toEqual({
			enabled: true,
			trustedProviders: [],
			allowDifferentEmails: false,
		});
		expect(built().account.accountLinking.enabled).toBe(false);
	});

	it.each([
		['a short secret', { secret: 'short' }],
		['a URL with a query', { baseURL: 'https://acme.example/api/auth?x=1' }],
		['an `oidc:` method with no provider', { methods: ['passkey', 'oidc:okta'] }],
	])('refuses %s', (_name, extra) => {
		expect(() => createLoamAuthOptions({ ...BASE, ...extra } as never)).toThrow();
	});
});

describe("step 3's deviation 2: no OAuth consents before revocation revokes them (4.6)", () => {
	it('registers no OAuth, OIDC-provider or consent plugin while `revoke-person` leaves consents alone', () => {
		const ids = [
			...built().plugins,
			...built({
				methods: ['passkey', 'oidc:corp'],
				oidc: [
					{
						id: 'corp',
						clientId: 'c',
						clientSecret: 's',
						discoveryUrl: 'https://corp.example/.well-known/openid-configuration',
					},
				],
			}).plugins,
		].map((plugin) => plugin.id);
		// Signing in through a deployer's OIDC provider (`generic-oauth`) grants no consent; serving OAuth does.
		const serving = ids.filter((id) => /oauth-provider|oidc-provider|consent|mcp|jwt/i.test(id));
		if (!REVOKES_CONSENTS)
			expect(serving, 'step 7 makes revoke-person revoke consents first').toEqual([]);
		expect(new Set(ids)).toEqual(new Set(['organization', 'passkey', 'generic-oauth', 'loam']));
	});
});

describe('the binding (2.3)', () => {
	it('pins the id once, by slug, and later only checks the slug', async () => {
		const adapter = memoryAdapter({ organization: [{ id: 'org_1', slug: 'acme', name: 'Acme' }] });
		const config = { workspace: 'acme', organization: 'acme' };
		const first = await bindOrganization(adapter, config, () => new Date(1));
		expect(first).toEqual({
			binding: { workspace: 'acme', organizationId: 'org_1', boundAt: new Date(1) },
			organization: { id: 'org_1', slug: 'acme', name: 'Acme' },
		});
		// The slug moves to another organization: the binding keeps the id and warns.
		(adapter.tables.organization as Row[])[0] = { id: 'org_1', slug: 'acme-old', name: 'Acme' };
		adapter.tables.organization?.push({ id: 'org_2', slug: 'acme', name: 'Impostor' });
		const later = await bindOrganization(adapter, config);
		expect(later).toMatchObject({
			binding: { organizationId: 'org_1' },
			organization: { slug: 'acme-old' },
			warning: 'IDENTITY_BINDING_MISMATCH',
		});
		expect(adapter.tables.loamBinding).toHaveLength(1);
	});

	it('pins nothing before the organization exists: IDENTITY_ORGANIZATION_UNKNOWN', async () => {
		const adapter = memoryAdapter();
		expect(await bindOrganization(adapter, { workspace: 'acme', organization: 'acme' })).toEqual({
			binding: null,
			organization: null,
			warning: 'IDENTITY_ORGANIZATION_UNKNOWN',
		});
		expect(adapter.tables.loamBinding).toBeUndefined();
		expect(await membershipOf(adapter, 'acme', 'usr_1')).toBeNull();
	});

	it('reads membership by the bound id alone', async () => {
		const adapter = memoryAdapter({
			organization: [
				{ id: 'org_1', slug: 'acme-old', name: 'Acme' },
				{ id: 'org_2', slug: 'acme', name: 'Impostor' },
			],
			member: [
				{ id: 'm1', organizationId: 'org_1', userId: 'bea', role: 'member' },
				{ id: 'm2', organizationId: 'org_2', userId: 'zed', role: 'owner' },
			],
			loamBinding: [{ id: 'b', workspace: 'acme', organizationId: 'org_1', boundAt: new Date(1) }],
		});
		expect(await membershipOf(adapter, 'acme', 'zed')).toBeNull();
		expect(await membershipOf(adapter, 'acme', 'bea')).toMatchObject({
			organization: { id: 'org_1' },
			role: 'member',
		});
	});
});

describe('P3-E6: the organization hooks (7.1, 7.5), as units', () => {
	const owners = (roles: string[]) =>
		memoryAdapter({
			organization: [{ id: 'org_1', slug: 'acme', name: 'Acme' }],
			member: roles.map((role, index) => ({
				id: `m${index}`,
				organizationId: 'org_1',
				userId: `u${index}`,
				role,
			})),
			loamBinding: [{ id: 'b', workspace: 'acme', organizationId: 'org_1', boundAt: new Date(1) }],
		});
	const hooksOver = (adapter: BindingAdapter, deleted: string[] = []) => {
		const state: LoamProviderState = {
			workspace: 'acme',
			organization: 'acme',
			context: {
				adapter,
				internalAdapter: { deleteUserSessions: async (id: string) => void deleted.push(id) },
			} as never,
		};
		return createOrganizationHooks(state);
	};
	const codeOf = async (run: Promise<unknown>) =>
		run.then(
			() => undefined,
			(error: { body?: { code?: string } }) => error.body?.code
		);

	it('refuses removing or demoting the last owner: MEMBER_LAST_OWNER, whoever asks', async () => {
		const hooks = hooksOver(owners(['owner', 'admin']));
		const member = { organizationId: 'org_1', role: 'owner' };
		expect(await codeOf(hooks.beforeRemoveMember({ member }))).toBe('MEMBER_LAST_OWNER');
		expect(await codeOf(hooks.beforeUpdateMemberRole({ member, newRole: 'admin' }))).toBe(
			'MEMBER_LAST_OWNER'
		);
		expect(
			await codeOf(hooks.beforeUpdateMemberRole({ member, newRole: 'owner,admin' }))
		).toBeUndefined();
		const two = hooksOver(owners(['owner', 'owner']));
		expect(await codeOf(two.beforeRemoveMember({ member }))).toBeUndefined();
		expect(
			await codeOf(hooks.beforeRemoveMember({ member: { organizationId: 'org_1', role: 'admin' } }))
		).toBeUndefined();
	});

	it('lets only an owner invite an owner, and adds no member but by invitation', async () => {
		const hooks = hooksOver(owners(['owner', 'admin']));
		const invitation = { organizationId: 'org_1', role: 'owner' };
		expect(await codeOf(hooks.beforeCreateInvitation({ invitation, inviter: { id: 'u1' } }))).toBe(
			'OWNER_REQUIRED'
		);
		expect(
			await codeOf(hooks.beforeCreateInvitation({ invitation, inviter: { id: 'u0' } }))
		).toBeUndefined();
		expect(
			await codeOf(
				hooks.beforeCreateInvitation({
					invitation: { organizationId: 'org_1', role: 'member' },
					inviter: { id: 'u1' },
				})
			)
		).toBeUndefined();
		expect(await codeOf(hooks.beforeAddMember())).toBe('MEMBER_INVITATION_REQUIRED');
	});

	it('fixes the bound organization, by id, and its slug before a binding exists', async () => {
		const hooks = hooksOver(owners(['owner']));
		const fixed = 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION';
		expect(
			await codeOf(
				hooks.beforeUpdateOrganization({ member: { organizationId: 'org_1', role: 'owner' } })
			)
		).toBe(fixed);
		expect(
			await codeOf(
				hooks.beforeDeleteOrganization({ organization: { id: 'org_1', slug: 'acme-old' } })
			)
		).toBe(fixed);
		expect(
			await codeOf(
				hooks.beforeUpdateOrganization({ member: { organizationId: 'org_2', role: 'owner' } })
			)
		).toBeUndefined();
		// Before a binding, the organization the deployment's slug names is the fixed one.
		const before = hooksOver(
			memoryAdapter({ organization: [{ id: 'org_9', slug: 'acme', name: 'Acme' }] })
		);
		expect(
			await codeOf(
				before.beforeUpdateOrganization({ member: { organizationId: 'org_9', role: 'owner' } })
			)
		).toBe(fixed);
		const unbound = hooksOver(memoryAdapter());
		expect(
			await codeOf(
				unbound.beforeDeleteOrganization({ organization: { id: 'org_9', slug: 'acme' } })
			)
		).toBe(fixed);
	});

	it('revokes the sessions of a person removed from the bound organization only', async () => {
		const deleted: string[] = [];
		const hooks = hooksOver(owners(['owner']), deleted);
		await hooks.afterRemoveMember({
			user: { id: 'u5' },
			organization: { id: 'org_1', slug: 'acme' },
		});
		await hooks.afterRemoveMember({
			user: { id: 'u6' },
			organization: { id: 'org_2', slug: 'other' },
		});
		expect(deleted).toEqual(['u5']);
	});
});

describe('the roles (7.1; D96)', () => {
	it('reads owner and admin as Loam owners, with the same member and invitation powers', () => {
		expect([
			isOwnerRole('owner'),
			isOwnerRole('admin'),
			isOwnerRole('member'),
			isOwnerRole(null),
		]).toEqual([true, true, false, false]);
		expect([loamRole('admin,member'), loamRole('member, owner'), loamRole('')]).toEqual([
			'admin',
			'owner',
			'member',
		]);
		expect(loamRoles.admin.statements).toEqual(loamRoles.owner.statements);
		expect(loamRoles.owner.statements).not.toHaveProperty('organization');
		expect(loamRoles.member.statements).toEqual({});
	});
});
