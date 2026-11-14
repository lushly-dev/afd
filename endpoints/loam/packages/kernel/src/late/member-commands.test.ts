/**
 * Phase 3's step 4 units (phase 3 specification, 3.4, 5.1, 5.3, 7.1 to 7.4 and 7.6): the account and member commands,
 * the owner commands' `OWNER_REQUIRED` on the membership read again before them, `HUMAN_REQUIRED` on the agent
 * interface, the provider's codes kept, and #852's rules in the kernel. P3-E6's and P3-E7's rows carry their ids. The
 * provider is a capability stub here; `identity/src/organization-routes.test.ts` holds the same rules at a real one.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemberRoleV1, MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPorts,
} from '../scope/fixtures.js';
import { replayKernel } from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import {
	type AccountV1,
	type LoamAccountAccessV1,
	MEMBER_PROVIDER_COMMANDS,
	OWNER_COMMANDS,
} from './member-commands.js';

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const ADA = 'mock-user-ada@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const roles = (): Map<string, MemberRoleV1> =>
	new Map([
		[BEA, 'member'],
		[OLU, 'owner'],
		[ADA, 'admin'],
	]);
const ACME = (): MembershipV1 => ({ mode: 'provider', members: roles(), digest: 'd1' });

/** The deployment, with `tasks` a team instance serving the `vault` project (7.3's listed slug). */
const LISTED = () => {
	const deployment = scopedDeployment();
	return {
		...deployment,
		apps: deployment.apps.map((app) =>
			app.instance === 'tasks' ? { ...app, audience: 'team' as const, projects: ['vault'] } : app
		),
	};
};

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
	vi.restoreAllMocks();
});

/** The provider's capabilities, stubbed: Loam's account reads and afd-auth's organization. */
function providerStub(auth: MockAuthAdapter) {
	const person = () => {
		const state = auth.getSession();
		return state.status === 'authenticated' ? state.user : undefined;
	};
	const people = [
		{
			id: OLU,
			memberId: 'm-olu',
			name: 'Olu',
			image: null,
			role: 'owner' as const,
			email: 'olu@example.com',
		},
		{
			id: ADA,
			memberId: 'm-ada',
			name: 'Ada',
			image: null,
			role: 'admin' as const,
			email: 'ada@example.com',
		},
		{
			id: BEA,
			memberId: 'm-bea',
			name: 'Bea',
			image: null,
			role: 'member' as const,
			email: 'bea@example.com',
		},
	];
	const account: LoamAccountAccessV1 = {
		get: vi.fn(async () => {
			const user = person();
			const row = people.find((held) => held.id === user?.id);
			return {
				id: user?.id ?? '',
				email: user?.email ?? '',
				name: user?.name ?? '',
				image: null,
				organizations: row
					? [{ id: 'org-acme', slug: 'acme', name: 'Acme', role: row.role, bound: true }]
					: [],
				workspace: {
					member: row !== undefined,
					role: row?.role ?? null,
					owner: row?.role === 'owner' || row?.role === 'admin',
				},
				methods: ['password'],
				recovery: 'email' as const,
				recoveredAt: null,
			};
		}),
		update: vi.fn(async () => {}),
		members: vi.fn(async () => ({ people, total: people.length })),
		invitations: vi.fn(async () => [
			{
				id: 'inv-1',
				organization: { slug: 'acme', name: 'Acme' },
				role: 'member',
				expiresAt: '2026-11-20T00:00:00.000Z',
			},
		]),
	};
	const organization = {
		membership: vi.fn(),
		listMembers: vi.fn(),
		invite: vi.fn(async (_organization: string, invitation: { email: string; role: string }) => ({
			id: 'inv-new',
			organizationId: 'org-acme',
			email: invitation.email,
			role: invitation.role,
			status: 'pending' as const,
			expiresAt: new Date('2026-11-15T00:00:00.000Z'),
		})),
		listInvitations: vi.fn(async () => [
			{
				id: 'inv-2',
				organizationId: 'org-acme',
				email: 'cy@example.com',
				role: 'member',
				status: 'pending' as const,
				expiresAt: new Date('2026-11-15T00:00:00.000Z'),
			},
		]),
		cancelInvitation: vi.fn(async () => {}),
		removeMember: vi.fn(async () => {}),
		setRole: vi.fn(async () => {}),
		leave: vi.fn(async () => {}),
		listOwnInvitations: vi.fn(async () => []),
		acceptInvitation: vi.fn(async () => {}),
		rejectInvitation: vi.fn(async () => {}),
	};
	Object.assign(auth, { account, organization });
	return { account, organization };
}

async function provider(options: ScopedWorkspaceOptions = {}) {
	const auth = new MockAuthAdapter();
	const stub = providerStub(auth);
	const made = await createScopedWorkspace({
		empty: true,
		auth,
		identity: PROVIDER,
		membership: ACME(),
		deployment: LISTED(),
		...options,
	});
	kernels.push(made.kernel);
	return { ...made, ...stub };
}
async function local(): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace({ empty: true });
	kernels.push(made.kernel);
	return made;
}

const signIn = (kernel: LoamKernelV3, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
const journalOf = (made: { journal: MemoryJournalSink }) =>
	made.journal.read() as Promise<JournalEntry[]>;
const last = async (made: { journal: MemoryJournalSink }, command: string) =>
	(await journalOf(made)).filter((entry) => entry.command === command).at(-1);

describe('P3-E7: the account (5.1, 5.3, 5.4)', () => {
	it("P3-E7: answers the person's account in `provider` mode, with the default persona and its recovery", async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const got = await made.kernel.call<AccountV1>('account-get');
		expect(got.success, JSON.stringify(got.error)).toBe(true);
		expect(got.data).toMatchObject({
			id: BEA,
			workspace: { member: true, role: 'member', owner: false },
			persona: 'default',
			recovery: 'email',
			recoveredAt: null,
		});
		// The agent interface reads its person's account (3.4's first row).
		expect((await made.kernel.agent.call('account-get')).success).toBe(true);
	});

	it('P3-E7: answers a local workspace with its one person, an owner, and no provider for invitations or members', async () => {
		const made = await local();
		await signIn(made.kernel, 'bea@example.com');
		const got = await made.kernel.call<AccountV1>('account-get');
		expect(got.data).toMatchObject({
			id: BEA,
			workspace: { member: true, owner: true },
			recovery: 'none',
		});
		expect((await made.kernel.call('account-invitation-list')).data).toEqual({ invitations: [] });
		const listed = await made.kernel.call<{ people: unknown[]; total: number }>('member-list');
		expect(listed.data?.total).toBe(1);
		for (const name of ['member-invite', 'member-remove', 'account-update']) {
			const input =
				name === 'member-invite'
					? { email: 'x@example.com', role: 'member' }
					: name === 'member-remove'
						? { member: 'x' }
						: { name: 'B' };
			expect((await made.kernel.call(name, input)).error?.code, name).toBe(
				'IDENTITY_PROVIDER_UNAVAILABLE'
			);
		}
	});

	it('P3-E7: accepting an invitation settles the membership it brings before the next call', async () => {
		let role: MemberRoleV1 | null = null;
		const made = await provider({
			membership: { mode: 'provider', members: new Map(), digest: '' },
			ports: {
				...scopedPorts(),
				readMembership: async () => (role ? { role, digest: `d-${role}` } : null),
			},
		});
		await signIn(made.kernel, 'cy@example.com');
		// Cy is no member: line 0 refuses a gated command; her own invitations she may list.
		expect((await made.kernel.call('project-list')).error?.code).toBe('WORKSPACE_NOT_MEMBER');
		expect((await made.kernel.call('account-invitation-list')).success).toBe(true);
		made.organization.acceptInvitation.mockImplementation(async () => {
			role = 'member';
		});
		const accepted = await made.kernel.call('account-invitation-accept', { invitation: 'inv-1' });
		expect(accepted.data).toEqual({ organization: { slug: 'acme', name: 'Acme' }, role: 'member' });
		const listed = await made.kernel.call('project-list');
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		const order = (await journalOf(made)).map((entry) => entry.command);
		const settle = order.lastIndexOf('session-settle');
		expect(order.lastIndexOf('account-invitation-accept')).toBeLessThan(settle);
		expect(settle).toBeLessThan(order.lastIndexOf('project-list'));
		// Another person's invitation, or none, answers the same.
		const other = await made.kernel.call('account-invitation-accept', { invitation: 'inv-other' });
		expect(other.error?.code).toBe('INVITATION_NOT_FOUND');
	});
});

describe('P3-E6: owners (7.1, 7.2)', () => {
	it('P3-E6: an owner command is OWNER_REQUIRED for a member, journaled, and runs for an owner, naming the bound organization', async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('member-invite', {
			email: 'cy@example.com',
			role: 'member',
		});
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		expect((await last(made, 'member-invite'))?.result.success).toBe(false);
		expect(made.organization.invite).not.toHaveBeenCalled();
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'olu@example.com');
		const invited = await made.kernel.call('member-invite', {
			email: 'Cy@Example.com',
			role: 'member',
		});
		expect(invited.success, JSON.stringify(invited.error)).toBe(true);
		expect(invited.undoCommand).toBe('member-invitation-cancel');
		expect(made.organization.invite).toHaveBeenCalledWith('org-acme', {
			email: 'cy@example.com',
			role: 'member',
		});
	});

	it('P3-E6: an admin is an owner, but only the owner role grants, removes or invites the owner role', async () => {
		const made = await provider();
		await signIn(made.kernel, 'ada@example.com');
		expect(
			(await made.kernel.call('member-invite', { email: 'x@example.com', role: 'admin' })).success
		).toBe(true);
		expect(
			(await made.kernel.call('member-invite', { email: 'y@example.com', role: 'owner' })).error
				?.code
		).toBe('OWNER_REQUIRED');
		expect(
			(await made.kernel.call('member-role-set', { member: BEA, role: 'owner' })).error?.code
		).toBe('OWNER_REQUIRED');
		expect((await made.kernel.call('member-remove', { member: OLU })).error?.code).toBe(
			'OWNER_REQUIRED'
		);
		expect(made.organization.setRole).not.toHaveBeenCalled();
		expect(made.organization.removeMember).not.toHaveBeenCalled();
		const set = await made.kernel.call('member-role-set', { member: BEA, role: 'admin' });
		expect(set.data).toEqual({ role: 'admin', previous: 'member' });
		expect(set.undoArgs).toEqual({ member: BEA, role: 'member' });
		expect(made.organization.setRole).toHaveBeenCalledWith('org-acme', 'm-bea', 'admin');
	});

	it("P3-E6: MEMBER_LAST_OWNER from Loam's hook and from Better Auth's own error, each mapped", async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		made.organization.setRole.mockRejectedValueOnce(
			Object.assign(new Error('The organization keeps at least one owner'), {
				code: 'MEMBER_LAST_OWNER',
			})
		);
		expect(
			(await made.kernel.call('member-role-set', { member: OLU, role: 'member' })).error?.code
		).toBe('MEMBER_LAST_OWNER');
		made.organization.removeMember.mockRejectedValueOnce(
			Object.assign(new Error('only owner'), {
				code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
			})
		);
		expect((await made.kernel.call('member-remove', { member: OLU })).error?.code).toBe(
			'MEMBER_LAST_OWNER'
		);
		made.organization.removeMember.mockRejectedValueOnce(
			Object.assign(new Error('no owner left'), {
				code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
			})
		);
		expect((await made.kernel.call('member-remove', { member: OLU })).error?.code).toBe(
			'MEMBER_LAST_OWNER'
		);
		// Anything else the provider answers is retryable, never a decision the kernel invents.
		made.organization.removeMember.mockRejectedValueOnce(new Error('down'));
		const down = await made.kernel.call('member-remove', { member: BEA });
		expect([down.error?.code, down.error?.retryable]).toEqual([
			'IDENTITY_PROVIDER_UNAVAILABLE',
			true,
		]);
		expect((await made.kernel.call('member-remove', { member: 'nobody' })).error?.code).toBe(
			'MEMBER_NOT_FOUND'
		);
		const removed = await made.kernel.call('member-remove', { member: BEA });
		expect(removed.data).toEqual({ removed: true, suspended: [] });
	});

	it('P3-E6: the owner role is read again before an owner command, so a demoted owner is refused at once', async () => {
		let role: MemberRoleV1 = 'owner';
		const made = await provider({
			ports: { ...scopedPorts(), readMembership: async () => ({ role, digest: `d-${role}` }) },
		});
		await signIn(made.kernel, 'olu@example.com');
		expect((await made.kernel.call('member-invitation-list')).success).toBe(true);
		role = 'member';
		const refused = await made.kernel.call('member-invitation-list');
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		const entries = await journalOf(made);
		const settle = entries.findLast((entry) => entry.command === 'session-settle');
		expect(settle?.input).toMatchObject({ person: OLU, role: 'member', reason: 'membership' });
		// A replay decides from the journal, reaching no provider.
		const { report } = await replayKernel(entries, { deployment: LISTED(), ports: scopedPorts() });
		expect(report.diverged).toBe(false);
	});

	it('P3-E6: member-list shows emails to an owner only, and lists agent members apart, never as seats', async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const bea = await made.kernel.call<{
			people: Record<string, unknown>[];
			agents: unknown[];
			total: number;
		}>('member-list');
		expect(bea.data?.total).toBe(3);
		expect(bea.data?.agents).toEqual([]);
		for (const person of bea.data?.people ?? []) {
			expect(person).not.toHaveProperty('email');
			expect(person).not.toHaveProperty('memberId');
		}
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'olu@example.com');
		const olu = await made.kernel.call<{ people: Record<string, unknown>[] }>('member-list');
		expect(olu.data?.people.map((person) => person.email)).toEqual([
			'olu@example.com',
			'ada@example.com',
			'bea@example.com',
		]);
	});

	it('P3-E6: every step 4 owner and human command is HUMAN_REQUIRED through the agent interface, journaled; account-get and member-list are not', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const inputs: Record<string, unknown> = {
			'account-update': { name: 'O' },
			'account-invitation-accept': { invitation: 'inv-1' },
			'account-invitation-reject': { invitation: 'inv-1' },
			'member-invite': { email: 'x@example.com', role: 'member' },
			'member-invitation-cancel': { invitation: 'inv-2' },
			'member-remove': { member: BEA },
			'member-role-set': { member: BEA, role: 'admin' },
			'workspace-app-set': { instance: 'tasks', enabled: false },
		};
		const human = [
			...MEMBER_PROVIDER_COMMANDS.filter(
				(name) => name !== 'account-get' && name !== 'member-list'
			),
			'workspace-app-set',
		];
		for (const name of human) {
			const refused = await made.kernel.agent.call(name, inputs[name] ?? {});
			expect(refused.error?.code, name).toBe('HUMAN_REQUIRED');
			expect((await last(made, name))?.actor?.kind, name).toBe('agent');
		}
		for (const name of ['account-get', 'member-list']) {
			expect((await made.kernel.agent.call(name, {})).success, name).toBe(true);
		}
		expect(made.organization.invite).not.toHaveBeenCalled();
		expect(OWNER_COMMANDS).toContain('workspace-app-set');
	});

	it('P3-E6: no owner command is served over MCP, and account-get and member-list are (3.4)', async () => {
		const made = await provider();
		const served = made.mcpOptions()?.commands.map((command) => command.name) ?? [];
		expect(served.length).toBeGreaterThan(0);
		for (const name of OWNER_COMMANDS) expect(served, name).not.toContain(name);
		for (const name of ['account-update', 'account-invitation-accept', 'account-invitation-list'])
			expect(served, name).not.toContain(name);
		for (const name of ['account-get', 'member-list']) expect(served, name).toContain(name);
	});

	it('P3-E6: the owner and human commands are recorded: a replay answers each from its entry', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		await made.kernel.call('member-invite', { email: 'cy@example.com', role: 'member' });
		await made.kernel.call('member-list');
		const entries = await journalOf(made);
		const invite = entries.findLast((entry) => entry.command === 'member-invite');
		expect(invite?.context?.replay).toBe('recorded');
		const calls = made.organization.invite.mock.calls.length;
		const { report } = await replayKernel(entries, { deployment: LISTED(), ports: scopedPorts() });
		expect(report.diverged).toBe(false);
		expect(report.recorded).toContain(invite?.seq);
		expect(made.organization.invite.mock.calls.length).toBe(calls);
	});
});

describe("P3-E6: #852's rules in the kernel (7.3, 7.4; D110)", () => {
	const restricted = (members: string[]) => ({ mode: 'restricted', members });

	it("P3-E6: a listed slug is an owner's to create: OWNER_REQUIRED for a member, HUMAN_REQUIRED for an agent", async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('project-create', { name: 'Vault', slug: 'vault' });
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		expect(refused.error?.message).toBe(
			'Only an owner can create or change the members of a project a team instance serves'
		);
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'olu@example.com');
		expect(
			(await made.kernel.agent.call('project-create', { name: 'Vault', slug: 'vault' })).error?.code
		).toBe('HUMAN_REQUIRED');
		expect(
			(await made.kernel.agent.call('project-create', { name: 'Mine', access: restricted([OLU]) }))
				.error?.code
		).toBe('HUMAN_REQUIRED');
		const created = await made.kernel.call('project-create', { name: 'Vault', slug: 'vault' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		// A member may not change a listed project's members; an owner may.
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'bea@example.com');
		const update = await made.kernel.call('project-update', {
			project: 'vault',
			access: restricted([BEA]),
		});
		expect(update.error?.code).toBe('OWNER_REQUIRED');
	});

	it('P3-E6: workspace-app-set is an owner command', async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		expect(
			(await made.kernel.call('workspace-app-set', { instance: 'tasks', title: 'Mine' })).error
				?.code
		).toBe('OWNER_REQUIRED');
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'ada@example.com');
		const set = await made.kernel.call('workspace-app-set', { instance: 'tasks', title: 'Ours' });
		expect(set.success, JSON.stringify(set.error)).toBe(true);
	});

	it("P3-E6: PROJECT_SLUG_UNAVAILABLE is byte-identical for a restricted project's slug, a visible one's and a reserved one", async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		expect((await made.kernel.call('project-create', { name: 'Open', slug: 'open' })).success).toBe(
			true
		);
		expect(
			(
				await made.kernel.call('project-create', {
					name: 'Hidden',
					slug: 'hidden',
					access: restricted([OLU]),
				})
			).success
		).toBe(true);
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'bea@example.com');
		const answers = [];
		for (const slug of ['hidden', 'open', 'all']) {
			const { error } = await made.kernel.call('project-create', { name: 'Again', slug });
			answers.push(JSON.stringify(error));
		}
		expect(new Set(answers).size).toBe(1);
		expect(JSON.parse(answers[0] as string)).toMatchObject({
			code: 'PROJECT_SLUG_UNAVAILABLE',
			message: "That slug can't be used. Choose another",
		});
	});

	it('P3-E6: Q2 as answered (D110): the creator or an owner changes the members; another member may only remove themselves', async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const created = await made.kernel.call<{ id: string }>('project-create', {
			name: 'Plans',
			access: restricted([BEA, ADA]),
		});
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		const project = created.data?.id as string;
		// The creator changes it.
		expect(
			(
				await made.kernel.call('project-update', {
					project,
					access: restricted([BEA, ADA, 'mock-user-cy@example.com']),
				})
			).success
		).toBe(true);
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'ada@example.com');
		// Ada is an admin, so an owner: she changes it, and may leave herself out (D96).
		expect(
			(await made.kernel.call('project-update', { project, access: restricted([BEA]) })).success
		).toBe(true);
		// An owner adds herself to a restricted project she cannot see.
		expect((await made.kernel.call('project-get', { project })).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		expect(
			(await made.kernel.call('project-update', { project, access: restricted([BEA, ADA]) }))
				.success
		).toBe(true);
		expect((await made.kernel.call('project-get', { project })).success).toBe(true);
	});

	it('P3-E6: a member who is not the creator may remove only themselves, and changes nothing else', async () => {
		const members = roles();
		members.set('mock-user-cy@example.com', 'member');
		const made = await provider({ membership: { mode: 'provider', members, digest: 'd1' } });
		await signIn(made.kernel, 'bea@example.com');
		const created = await made.kernel.call<{ id: string }>('project-create', {
			name: 'Plans',
			access: restricted([BEA, 'mock-user-cy@example.com']),
		});
		const project = created.data?.id as string;
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'cy@example.com');
		const widen = await made.kernel.call('project-update', {
			project,
			access: { mode: 'workspace' },
		});
		expect(widen.error?.code).toBe('OWNER_REQUIRED');
		const swap = await made.kernel.call('project-update', {
			project,
			access: restricted(['mock-user-cy@example.com']),
		});
		expect(swap.error?.code).toBe('OWNER_REQUIRED');
		const leave = await made.kernel.call('project-update', { project, access: restricted([BEA]) });
		expect(leave.success, JSON.stringify(leave.error)).toBe(true);
	});

	it("P3-E6: PROJECT_MEMBER_NOT_PERSON: a project's members are person ids only", async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		for (const agent of ['agt_abcdefghij0123456789', 'shell-agent']) {
			const refused = await made.kernel.call('project-create', {
				name: 'Agents',
				access: restricted([OLU, agent]),
			});
			expect(refused.error?.code, agent).toBe('PROJECT_MEMBER_NOT_PERSON');
		}
		// A non-owner must still list themselves (PROJECT_MEMBER_SELF_REQUIRED applies to a non-owner only).
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'bea@example.com');
		expect(
			(await made.kernel.call('project-create', { name: 'Theirs', access: restricted([OLU]) }))
				.error?.code
		).toBe('PROJECT_MEMBER_SELF_REQUIRED');
	});
});
