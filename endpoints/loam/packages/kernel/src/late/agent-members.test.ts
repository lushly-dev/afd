/**
 * Phase 3's step 6 units (phase 3 specification, 3.3, 3.4, 4.4, 7.2 and 8; D90, D111): P3-E5's agent members. The
 * owner commands and the sponsor's confirmation, the sponsor rules on the journaled `membership-settle`, line 4 on every
 * command an agent member makes, decided on the actor afd-auth's middleware stamped (step 5's B1), the suspension
 * `agent-member-settle` persists, the rows filtered for the caller, and the replay. The provider is a capability stub
 * here; `identity/src/agent-members.test.ts` holds the provider's half at a real one.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandContext, JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemberRoleV1, MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	SCOPED_PROJECTS,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPorts,
} from '../scope/fixtures.js';
import type { AgentMemberV1, ProjectV1 } from '../scope/records.js';
import { replayKernel } from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import { type AgentMemberRowV1, widens } from './agent-members.js';
import type { LoamAccountAccessV1 } from './member-commands.js';
import { AGENT_MEMBER_TABLE } from './tables.js';

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const CY = 'mock-user-cy@example.com';
const DEE = 'mock-user-dee@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ACME = (): MembershipV1 => ({
	mode: 'provider',
	members: new Map<string, MemberRoleV1>([
		[OLU, 'owner'],
		[BEA, 'member'],
		[CY, 'member'],
	]),
	digest: 'd1',
});
const ATLAS = 'prj_atlas';
const CITADEL = 'prj_citadel';
/** Vault: restricted to Olu and Bea, so Cy may not enter it. */
const VAULT = 'prj_vault';
const VAULT_PROJECT: ProjectV1 = {
	...(SCOPED_PROJECTS[0] as ProjectV1),
	id: VAULT,
	slug: 'vault',
	name: 'Vault',
	createdAt: 4,
	access: { mode: 'restricted', members: [OLU, BEA] },
};
const AGENT = 'agt_aaaaaaaaaaaaaaaaaaaa';
const OTHER = 'agt_bbbbbbbbbbbbbbbbbbbb';

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
	vi.restoreAllMocks();
});

/** The provider's members, stubbed, with each one's digest; a test removes or adds people. */
function providerStub(auth: MockAuthAdapter) {
	const people = [
		{ id: OLU, memberId: 'm-olu', name: 'Olu', image: null, role: 'owner' as MemberRoleV1 },
		{ id: BEA, memberId: 'm-bea', name: 'Bea', image: null, role: 'member' as MemberRoleV1 },
		{ id: CY, memberId: 'm-cy', name: 'Cy', image: null, role: 'member' as MemberRoleV1 },
	].map((person) => ({ ...person, digest: `digest-${person.memberId}` }));
	const account: LoamAccountAccessV1 = {
		get: vi.fn(async () => {
			const state = auth.getSession();
			const id = state.status === 'authenticated' ? state.user.id : '';
			const row = people.find((held) => held.id === id);
			return {
				id,
				email: '',
				name: row?.name ?? '',
				image: null,
				organizations: [
					{ id: 'org-acme', slug: 'acme', name: 'Acme', role: 'member', bound: true },
				],
				workspace: {
					member: row !== undefined,
					role: row?.role ?? null,
					owner: row?.role === 'owner',
				},
				methods: ['password'],
				recovery: 'email' as const,
				recoveredAt: null,
			};
		}),
		update: vi.fn(async () => {}),
		members: vi.fn(async () => ({ people: [...people], total: people.length })),
		invitations: vi.fn(async () => []),
	};
	const organization = {
		removeMember: vi.fn(async (_organization: string, memberId: string) => {
			const at = people.findIndex((person) => person.memberId === memberId);
			if (at >= 0) people.splice(at, 1);
		}),
		setRole: vi.fn(async () => {}),
		invite: vi.fn(),
		listInvitations: vi.fn(async () => []),
		cancelInvitation: vi.fn(),
		leave: vi.fn(),
		membership: vi.fn(),
		listMembers: vi.fn(),
		listOwnInvitations: vi.fn(async () => []),
		acceptInvitation: vi.fn(),
		rejectInvitation: vi.fn(),
	};
	Object.assign(auth, { account, organization });
	return { account, organization, people };
}

function agentMember(extra: Partial<AgentMemberV1> = {}): AgentMemberV1 {
	return {
		id: AGENT,
		workspace: 'personal',
		kind: 'installed',
		name: 'Reviewer',
		sponsor: BEA,
		installedBy: OLU,
		access: { workspace: false, projects: [ATLAS] },
		status: 'active',
		createdAt: 1,
		updatedAt: 1,
		updatedBy: OLU,
		...extra,
	};
}

/** A provider workspace with Atlas, Beacon, Citadel and Vault, and any agent members given, in its store. */
async function provider(options: ScopedWorkspaceOptions & { agents?: AgentMemberV1[] } = {}) {
	const { agents = [], ...rest } = options;
	const auth = new MockAuthAdapter();
	const stub = providerStub(auth);
	const store = new MemoryAdapter();
	for (const project of [...SCOPED_PROJECTS, VAULT_PROJECT]) await store.create('project', project);
	for (const agent of agents) await store.create(AGENT_MEMBER_TABLE, agent);
	const made = await createScopedWorkspace({
		empty: true,
		auth,
		store,
		identity: PROVIDER,
		membership: ACME(),
		...rest,
	});
	kernels.push(made.kernel);
	return { ...made, ...stub };
}

const signIn = (kernel: LoamKernelV3, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
const switchTo = async (kernel: LoamKernelV3, email: string) => {
	await kernel.call('auth-sign-out');
	await signIn(kernel, email);
};
const journalOf = (made: { journal: MemoryJournalSink }) =>
	made.journal.read() as Promise<JournalEntry[]>;
const stored = (made: { store: MemoryAdapter | { get: MemoryAdapter['get'] } }, id = AGENT) =>
	made.store.get<AgentMemberV1>(AGENT_MEMBER_TABLE, id);
const add = (kernel: LoamKernelV3, input: Record<string, unknown>) =>
	kernel.call<AgentMemberRowV1>('agent-member-add', { name: 'Reviewer', ...input });
/** A call as an `agt_` actor with no `onBehalfOf`: afd-auth's middleware stamps the person signed in. */
const asAgentMember = (
	made: Awaited<ReturnType<typeof provider>>,
	name: string,
	input: unknown,
	scope?: { workspace: string; project?: string },
	id = AGENT
) =>
	made.registries.palette.execute(name, input, {
		traceId: `agt-${name}-${Math.random()}`,
		actor: { kind: 'agent', id },
		...(scope ? { scope } : {}),
	} as CommandContext);

describe('P3-E5: an owner adds an agent member, and its sponsor confirms (8.2, 8.3, D111)', () => {
	it('P3-E5: names another person as sponsor: pending, with the sponsor read journaled before it, and no seat', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const added = await add(made.kernel, {
			sponsor: BEA,
			access: { workspace: false, projects: ['atlas'] },
		});
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		expect(added.data).toMatchObject({
			kind: 'installed',
			name: 'Reviewer',
			sponsor: BEA,
			installedBy: OLU,
			status: 'pending',
			// A slug is kept as the project's id.
			access: { workspace: false, projects: [ATLAS] },
			hiddenProjects: 0,
		});
		expect(added.data?.id).toMatch(/^agt_[a-z0-9]{20}$/);
		// A write reads nothing of the provider for its answer: a replay re-runs it (3.4).
		expect(added.data).not.toHaveProperty('sponsorName');
		// The sponsor's membership, journaled top-level before the command, never as a change of person (4.4).
		const order = (await journalOf(made)).map((entry) => [entry.command, entry.input]);
		const at = order.findIndex(([command]) => command === 'agent-member-add');
		expect(order[at - 1]).toEqual([
			'membership-settle',
			{ person: BEA, role: 'member', digest: 'digest-m-bea' },
		]);
		expect((await made.kernel.call('auth-session-get')).data).toMatchObject({ user: { id: OLU } });
		// Listed apart from the people, never counted as a seat (7.2, D40).
		const members = await made.kernel.call<{
			total: number;
			people: unknown[];
			agents: AgentMemberRowV1[];
		}>('member-list');
		expect(members.data?.total).toBe(3);
		expect(members.data?.people).toHaveLength(3);
		expect(
			members.data?.agents.map((agent) => [agent.name, agent.sponsorName, agent.status])
		).toEqual([['Reviewer', 'Bea', 'pending']]);
		// Undo removes it.
		expect(added.undoCommand).toBe('agent-member-remove');
	});

	it('P3-E5: an owner who names themselves confirms by doing it (D111)', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const added = await add(made.kernel, { sponsor: OLU });
		expect(added.data?.status).toBe('active');
		expect(added.data?.access).toEqual({ workspace: false, projects: [] });
	});

	it('P3-E5: only the sponsor confirms or declines, and only a pending one', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const id = (await add(made.kernel, { sponsor: BEA })).data?.id as string;
		const other = (await add(made.kernel, { name: 'Writer', sponsor: BEA })).data?.id as string;
		// The owner who added it is not its sponsor.
		const byOwner = await made.kernel.call('agent-member-confirm', { agent: id });
		expect(byOwner.error).toMatchObject({ code: 'AGENT_MEMBER_SPONSOR_ONLY' });
		expect(byOwner.error?.suggestion).toBeTruthy();
		await switchTo(made.kernel, 'cy@example.com');
		expect((await made.kernel.call('agent-member-confirm', { agent: id })).error?.code).toBe(
			'AGENT_MEMBER_SPONSOR_ONLY'
		);
		await switchTo(made.kernel, 'bea@example.com');
		const confirmed = await made.kernel.call<AgentMemberRowV1>('agent-member-confirm', {
			agent: id,
		});
		expect(confirmed.data?.status).toBe('active');
		expect((await stored(made, id))?.status).toBe('active');
		const again = await made.kernel.call('agent-member-confirm', { agent: id });
		expect(again.error).toMatchObject({ code: 'AGENT_MEMBER_NOT_PENDING' });
		expect(again.error?.suggestion).toBeTruthy();
		const declined = await made.kernel.call<AgentMemberRowV1>('agent-member-decline', {
			agent: other,
		});
		expect(declined.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-declined' });
		expect((await made.kernel.call('agent-member-confirm', { agent: other })).error?.code).toBe(
			'AGENT_MEMBER_NOT_PENDING'
		);
		expect((await made.kernel.call('agent-member-confirm', { agent: OTHER })).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
	});

	it('P3-E5: a non-owner is OWNER_REQUIRED, with nothing read for them; an agent is HUMAN_REQUIRED', async () => {
		const made = await provider();
		await signIn(made.kernel, 'bea@example.com');
		const refused = await add(made.kernel, { sponsor: BEA });
		expect(refused.error).toMatchObject({ code: 'OWNER_REQUIRED' });
		expect(refused.error?.suggestion).toBeTruthy();
		expect((await journalOf(made)).some((entry) => entry.command === 'membership-settle')).toBe(
			false
		);
		for (const name of ['agent-member-update', 'agent-member-remove']) {
			expect((await made.kernel.call(name, { agent: AGENT })).error?.code, name).toBe(
				'OWNER_REQUIRED'
			);
		}
		// The owner's own agent, and the sponsor's, run no owner or human command (3.4).
		await switchTo(made.kernel, 'olu@example.com');
		for (const [name, input] of [
			['agent-member-add', { name: 'Reviewer', sponsor: OLU }],
			['agent-member-update', { agent: AGENT, name: 'x' }],
			['agent-member-remove', { agent: AGENT }],
			['agent-member-confirm', { agent: AGENT }],
			['agent-member-decline', { agent: AGENT }],
		] as const) {
			expect((await made.kernel.agent.call(name, input)).error?.code, name).toBe('HUMAN_REQUIRED');
		}
		// The reads are an agent's for its person.
		expect((await made.kernel.agent.call('agent-member-list', {})).success).toBe(true);
	});

	it('P3-E5: the owner and human commands are not served over MCP; the reads are (3.4)', async () => {
		const made = await provider();
		const served = (made.mcpOptions()?.commands ?? []).map((command) => command.name);
		expect(served).toEqual(expect.arrayContaining(['agent-member-list', 'agent-member-get']));
		for (const name of [
			'agent-member-add',
			'agent-member-update',
			'agent-member-remove',
			'agent-member-confirm',
			'agent-member-decline',
			'membership-settle',
			'agent-member-settle',
		]) {
			expect(served, name).not.toContain(name);
		}
	});
});

describe('P3-E5: the sponsor rules (8.3)', () => {
	it('P3-E5: the sponsor must be a person member, read from the provider and journaled', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const dee = await add(made.kernel, { sponsor: DEE });
		expect(dee.error).toMatchObject({ code: 'AGENT_SPONSOR_INVALID' });
		expect(dee.error?.suggestion).toBeTruthy();
		const settle = (await journalOf(made)).findLast(
			(entry) => entry.command === 'membership-settle'
		);
		expect(settle?.input).toEqual({ person: DEE, role: null, digest: null });
		// An agent member's id is no person's.
		expect((await add(made.kernel, { sponsor: OTHER })).error?.code).toBe('AGENT_SPONSOR_INVALID');
	});

	it('P3-E5: the sponsor may enter every project named, and a missing one answers as a restricted one', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		// Cy may not enter Vault; nobody has `prj_nowhere`; Citadel is someone else's.
		const vault = await add(made.kernel, {
			sponsor: CY,
			access: { workspace: false, projects: [ATLAS, VAULT] },
		});
		expect(vault.error).toMatchObject({
			code: 'AGENT_SPONSOR_INVALID',
			message: `The sponsor cannot enter '${VAULT}'`,
		});
		const nowhere = await add(made.kernel, {
			sponsor: CY,
			access: { workspace: false, projects: ['prj_nowhere'] },
		});
		const citadel = await add(made.kernel, {
			sponsor: CY,
			access: { workspace: false, projects: [CITADEL] },
		});
		expect([nowhere.error?.code, citadel.error?.code]).toEqual([
			'AGENT_SPONSOR_INVALID',
			'AGENT_SPONSOR_INVALID',
		]);
		expect(nowhere.error?.message.replace('prj_nowhere', '<p>')).toBe(
			citadel.error?.message.replace(CITADEL, '<p>')
		);
		// Bea may enter Vault.
		expect(
			(await add(made.kernel, { sponsor: BEA, access: { workspace: false, projects: [VAULT] } }))
				.success
		).toBe(true);
		// `sponsor` is whatever the sponsor may enter: nothing to check.
		expect(
			(await add(made.kernel, { sponsor: CY, access: { workspace: true, projects: 'sponsor' } }))
				.success
		).toBe(true);
	});

	it('P3-E5: a sponsor read that fails refuses the call MEMBERSHIP_UNAVAILABLE, writing nothing', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		vi.mocked(made.account.members).mockRejectedValueOnce(new Error('down'));
		const refused = await add(made.kernel, { sponsor: BEA });
		expect(refused.error).toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE', retryable: true });
		expect((await made.store.list(AGENT_MEMBER_TABLE)).data).toEqual([]);
	});

	it('P3-E5: widening its access, or a new sponsor, returns it to pending; narrowing does not', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'olu@example.com');
		const update = (input: Record<string, unknown>) =>
			made.kernel.call<AgentMemberRowV1>('agent-member-update', { agent: AGENT, ...input });
		// A rename asks nothing.
		expect((await update({ name: 'Critic' })).data?.status).toBe('active');
		// A project it did not have: pending until Bea confirms again.
		const wider = await update({ access: { workspace: false, projects: [ATLAS, 'prj_beacon'] } });
		expect(wider.data?.status).toBe('pending');
		expect(wider.undoArgs).toEqual({
			agent: AGENT,
			access: { workspace: false, projects: [ATLAS] },
		});
		await switchTo(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-confirm', { agent: AGENT });
		await switchTo(made.kernel, 'olu@example.com');
		expect((await update({ access: { workspace: false, projects: [ATLAS] } })).data?.status).toBe(
			'active'
		);
		expect((await update({ access: { workspace: true, projects: [ATLAS] } })).data?.status).toBe(
			'pending'
		);
		// A new sponsor: pending until they confirm; the owner naming themselves confirms by doing it.
		expect((await update({ sponsor: CY })).data?.status).toBe('pending');
		expect((await update({ sponsor: OLU })).data?.status).toBe('active');
		expect((await update({ access: { workspace: true, projects: 'sponsor' } })).data?.status).toBe(
			'active'
		);
	});

	it('widens() reads the workspace, `sponsor` and each new project as wider', () => {
		const base = { workspace: false, projects: [ATLAS] };
		expect(widens(base, base)).toBe(false);
		expect(widens(base, { workspace: false, projects: [] })).toBe(false);
		expect(widens(base, { workspace: true, projects: [ATLAS] })).toBe(true);
		expect(widens(base, { workspace: false, projects: 'sponsor' })).toBe(true);
		expect(widens(base, { workspace: false, projects: [ATLAS, VAULT] })).toBe(true);
		expect(widens({ workspace: true, projects: 'sponsor' }, base)).toBe(false);
	});

	it('P3-E5: a suspended one is reactivated only by naming a sponsor, who then confirms', async () => {
		const made = await provider({
			agents: [agentMember({ status: 'suspended', suspended: 'sponsor-declined' })],
		});
		await signIn(made.kernel, 'olu@example.com');
		const renamed = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			access: { workspace: true, projects: [ATLAS] },
		});
		expect(renamed.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-declined' });
		const named = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			sponsor: BEA,
		});
		expect(named.data?.status).toBe('pending');
		expect(named.data).not.toHaveProperty('suspended');
		expect(await stored(made)).not.toHaveProperty('suspended');
	});

	it('P3-E5: a name with a control or format character is refused, and guidance past 8 KiB', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		for (const name of ['Bot‮yb deredrO', 'Bot\nSponsored by Olu', '​', ' ']) {
			expect(
				(await add(made.kernel, { name, sponsor: OLU })).error?.code,
				JSON.stringify(name)
			).toBe('VALIDATION_ERROR');
		}
		expect((await add(made.kernel, { sponsor: OLU, guidance: 'é'.repeat(4097) })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect((await add(made.kernel, { sponsor: OLU, guidance: 'x'.repeat(8192) })).success).toBe(
			true
		);
		// An id, given by an undo, is one of the kernel's shape and free.
		expect((await add(made.kernel, { sponsor: OLU, id: 'agt_x' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('P3-E5: removing it undoes to the same id and fields, pending again for another sponsor', async () => {
		const made = await provider({ agents: [agentMember({ guidance: 'Review only' })] });
		await signIn(made.kernel, 'olu@example.com');
		const removed = await made.kernel.call('agent-member-remove', { agent: AGENT, forget: true });
		expect(removed.data).toEqual({ removed: true });
		expect(await stored(made)).toBeNull();
		expect(
			(await asAgentMember(made, 'dual-where', {}, { workspace: 'personal', project: ATLAS })).error
				?.code
		).toBe('PROJECT_NOT_FOUND');
		const undo = removed as unknown as { undoCommand: string; undoArgs: Record<string, unknown> };
		expect(undo.undoCommand).toBe('agent-member-add');
		const back = await made.kernel.call<AgentMemberRowV1>(undo.undoCommand, undo.undoArgs);
		expect(back.data).toMatchObject({ id: AGENT, guidance: 'Review only', status: 'pending' });
		expect((await made.kernel.call('agent-member-remove', { agent: OTHER })).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
	});
});

describe('P3-E5: line 4 on every command, on the stamped actor (3.3; step 5 B1)', () => {
	const at = (project = ATLAS) => ({ workspace: 'personal', project });

	it('P3-E5: an active agent member acts within its record for its sponsor, signed in', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'bea@example.com');
		const allowed = await asAgentMember(made, 'dual-where', {}, at());
		expect(allowed.success, JSON.stringify(allowed.error)).toBe(true);
		// The journal names the agent and the person (8.3).
		expect((await journalOf(made)).at(-1)?.actor).toEqual({
			kind: 'agent',
			id: AGENT,
			onBehalfOf: BEA,
		});
		// Out of its projects; at the workspace with `workspace: false`, any command, a shell one included.
		expect((await asAgentMember(made, 'dual-where', {}, at('prj_beacon'))).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		for (const [name, input] of [
			['project-create', { name: 'Delta' }],
			['project-list', {}],
			['member-list', {}],
		] as const) {
			expect((await asAgentMember(made, name, input)).error?.code, name).toBe('PROJECT_NOT_FOUND');
		}
		expect(
			(await made.store.list<ProjectV1>('project')).data.map((project) => project.slug)
		).not.toContain('delta');
	});

	it('P3-E5: acting for anyone but its sponsor is refused: the person stamped is the one signed in', async () => {
		const made = await provider({ agents: [agentMember()] });
		// Olu is a member and may enter Atlas, but is not its sponsor.
		await signIn(made.kernel, 'olu@example.com');
		const refused = await asAgentMember(made, 'dual-where', {}, at());
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		expect((await journalOf(made)).at(-1)?.actor).toEqual({
			kind: 'agent',
			id: AGENT,
			onBehalfOf: OLU,
		});
	});

	it('P3-E5: a pending or suspended one is allowed nothing, a workspace-level shell command included', async () => {
		for (const status of [
			{ status: 'pending' as const },
			{ status: 'suspended' as const, suspended: 'sponsor-left' as const },
		]) {
			const made = await provider({
				agents: [agentMember({ ...status, access: { workspace: true, projects: 'sponsor' } })],
			});
			await signIn(made.kernel, 'bea@example.com');
			for (const [name, input, scope] of [
				['project-create', { name: 'Delta' }, undefined],
				['agent-member-list', {}, undefined],
				['dual-where', {}, at()],
			] as const) {
				expect(
					(await asAgentMember(made, name, input, scope)).error?.code,
					`${status.status} ${name}`
				).toBe('PROJECT_NOT_FOUND');
			}
		}
		// The same record, active, runs them.
		const made = await provider({
			agents: [agentMember({ access: { workspace: true, projects: 'sponsor' } })],
		});
		await signIn(made.kernel, 'bea@example.com');
		const created = await asAgentMember(made, 'project-create', { name: 'Delta' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
	});

	it("P3-E5: the sponsor's restricted project bounds it, and losing it refuses at once with a warning to an owner", async () => {
		const made = await provider({
			agents: [agentMember({ access: { workspace: false, projects: [VAULT] } })],
		});
		await signIn(made.kernel, 'bea@example.com');
		expect((await asAgentMember(made, 'dual-where', {}, at(VAULT))).success).toBe(true);
		// Olu takes Bea out of Vault.
		await switchTo(made.kernel, 'olu@example.com');
		const changed = await made.kernel.call('project-update', {
			project: VAULT,
			access: { mode: 'restricted', members: [OLU] },
		});
		expect(changed.success, JSON.stringify(changed.error)).toBe(true);
		const listed = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list');
		expect(listed.data?.agents[0]?.warnings).toEqual(['SPONSOR_PROJECT_LOST']);
		await switchTo(made.kernel, 'bea@example.com');
		expect((await asAgentMember(made, 'dual-where', {}, at(VAULT))).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		// No warning for anyone but an owner.
		const own = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list');
		expect(own.data?.agents[0]?.warnings).toEqual([]);
	});

	it('P3-E5: an agent member acting for its sponsor never confirms another, on any interface', async () => {
		const made = await provider({
			agents: [
				agentMember({ access: { workspace: true, projects: 'sponsor' } }),
				agentMember({ id: OTHER, name: 'Writer', status: 'pending' }),
			],
		});
		await signIn(made.kernel, 'bea@example.com');
		const refused = await asAgentMember(made, 'agent-member-confirm', { agent: OTHER });
		expect(refused.error?.code).toBe('HUMAN_REQUIRED');
		expect((await stored(made, OTHER))?.status).toBe('pending');
	});
});

describe("P3-E5: a signed-in person's agent reads the rows filtered for that person (8.2; step 5 B1)", () => {
	it("P3-E5: Bea's agent sees what Bea may, guidance as sponsor; Cy's sees neither Vault nor the guidance", async () => {
		const made = await provider({
			agents: [
				agentMember({
					access: { workspace: false, projects: [ATLAS, VAULT] },
					guidance: 'Review drafts in Vault',
				}),
			],
		});
		await signIn(made.kernel, 'bea@example.com');
		const bea = await made.kernel.agent.call<AgentMemberRowV1>('agent-member-get', {
			agent: AGENT,
		});
		expect(bea.data).toMatchObject({
			access: { workspace: false, projects: [ATLAS, VAULT] },
			hiddenProjects: 0,
			guidance: 'Review drafts in Vault',
			sponsorName: 'Bea',
			warnings: [],
		});
		await switchTo(made.kernel, 'cy@example.com');
		const cy = await made.kernel.agent.call<{ agents: AgentMemberRowV1[] }>(
			'agent-member-list',
			{}
		);
		expect(cy.data?.agents[0]).toMatchObject({
			access: { workspace: false, projects: [ATLAS] },
			hiddenProjects: 1,
		});
		expect(cy.data?.agents[0]).not.toHaveProperty('guidance');
		expect(JSON.stringify(cy.data)).not.toContain(VAULT);
		// The owner sees the guidance; filtered by status.
		await switchTo(made.kernel, 'olu@example.com');
		const olu = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list', {
			status: 'pending',
		});
		expect(olu.data?.agents).toEqual([]);
		const all = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list', {
			status: 'active',
		});
		expect(all.data?.agents[0]?.guidance).toBe('Review drafts in Vault');
		expect((await made.kernel.call('agent-member-get', { agent: OTHER })).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
	});
});

describe('P3-E5: a sponsor who leaves suspends what they sponsor, persisted by agent-member-settle (8.3, 4.4)', () => {
	it('P3-E5: member-remove answers the suspended ones, then agent-member-settle journals them top-level', async () => {
		const made = await provider({
			agents: [agentMember(), agentMember({ id: OTHER, sponsor: CY, name: 'Writer' })],
		});
		await signIn(made.kernel, 'olu@example.com');
		const removed = await made.kernel.call('member-remove', { member: BEA });
		expect(removed.data).toEqual({ removed: true, suspended: [AGENT] });
		// The next call waits for the settle, after the member-remove entry.
		const listed = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list');
		expect(listed.data?.agents.map((agent) => [agent.id, agent.status, agent.suspended])).toEqual([
			[AGENT, 'suspended', 'sponsor-left'],
			[OTHER, 'active', undefined],
		]);
		const entries = await journalOf(made);
		const order = entries.map((entry) => entry.command);
		const remove = order.indexOf('member-remove');
		expect(order.slice(remove, remove + 2)).toEqual(['member-remove', 'agent-member-settle']);
		expect(entries[remove + 1]?.input).toEqual({
			agents: [{ agent: AGENT, suspended: 'sponsor-left' }],
		});
		expect(await stored(made)).toMatchObject({
			status: 'suspended',
			suspended: 'sponsor-left',
			updatedBy: OLU,
		});
		// The rows name no sponsor who left.
		expect(listed.data?.agents[0]?.sponsorName).toBeNull();
	});

	it('P3-E5: a members read that no longer holds a sponsor suspends their agent members too', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'olu@example.com');
		// Bea left by another way (another owner's browser): the provider no longer lists her.
		made.people.splice(
			made.people.findIndex((person) => person.id === BEA),
			1
		);
		await made.kernel.call('member-list');
		expect(
			(await made.kernel.call<AgentMemberRowV1>('agent-member-get', { agent: AGENT })).data
		).toMatchObject({ status: 'suspended', suspended: 'sponsor-left' });
		expect(
			(await journalOf(made)).filter((entry) => entry.command === 'agent-member-settle')
		).toHaveLength(1);
	});

	it('P3-E5: the journal replays to the same records, reaching no provider', async () => {
		const made = await provider({ store: new MemoryAdapter() } as never);
		await signIn(made.kernel, 'olu@example.com');
		const vault = await made.kernel.call<ProjectV1>('project-create', {
			name: 'Keep',
			access: { mode: 'restricted', members: [OLU, BEA] },
		});
		const keep = vault.data?.id as string;
		const id = (
			await add(made.kernel, { sponsor: BEA, access: { workspace: false, projects: [keep] } })
		).data?.id as string;
		const other = (await add(made.kernel, { name: 'Writer', sponsor: CY })).data?.id as string;
		await switchTo(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-confirm', { agent: id });
		await switchTo(made.kernel, 'olu@example.com');
		await made.kernel.call('agent-member-update', { agent: id, name: 'Critic' });
		await made.kernel.call('member-remove', { member: CY });
		await made.kernel.call('agent-member-list');
		const entries = await journalOf(made);
		expect(entries.map((entry) => entry.command)).toEqual(
			expect.arrayContaining(['membership-settle', 'agent-member-settle'])
		);
		const members = vi.mocked(made.account.members).mock.calls.length;
		const { report, kernel } = await replayKernel(entries, {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			identity: PROVIDER,
			membership: ACME(),
			keep: true,
		});
		if (kernel) kernels.push(kernel);
		expect(report.diverged, JSON.stringify(report)).toBe(false);
		// Nothing reached the provider's members in the replay.
		expect(vi.mocked(made.account.members).mock.calls.length).toBe(members);
		// The entries the replay re-ran wrote what the original did: the two settles and the agent members' writes.
		expect(report.recorded.length).toBeGreaterThan(0);
		expect(other).toMatch(/^agt_[a-z0-9]{20}$/);
	});

	it('P3-E5: a settle that finds the person signed in no member suspends what they sponsor', async () => {
		let role: MemberRoleV1 | null = 'member';
		const made = await provider({
			agents: [agentMember()],
			ports: {
				...scopedPorts(),
				readMembership: async () => (role ? { role, digest: `d-${role}` } : null),
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		role = null;
		// An owner command reads membership again: Bea is no member now, and line 0 refuses her.
		expect((await made.kernel.call('agent-member-remove', { agent: AGENT })).error?.code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
		// The next call waits for the settle that follows.
		await made.kernel.call('project-list');
		expect(await stored(made)).toMatchObject({ status: 'suspended', suspended: 'sponsor-left' });
		const order = (await journalOf(made)).map((entry) => entry.command);
		expect(order.indexOf('agent-member-settle')).toBeGreaterThan(
			order.lastIndexOf('session-settle')
		);
	});
});

describe('P3-E5: local mode (2.1)', () => {
	it('P3-E5: the one person sponsors; another person is no member to sponsor', async () => {
		const made = await createScopedWorkspace({ empty: true });
		kernels.push(made.kernel);
		await signIn(made.kernel, 'olu@example.com');
		const own = await add(made.kernel, { sponsor: OLU });
		expect(own.data?.status).toBe('active');
		expect((await add(made.kernel, { sponsor: BEA })).error?.code).toBe('AGENT_SPONSOR_INVALID');
		// No membership is read, and none is journaled.
		expect((await journalOf(made)).some((entry) => entry.command === 'membership-settle')).toBe(
			false
		);
	});
});
