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
import { AGENT_MEMBER_TABLE, AGENT_MEMBER_UNDO_TABLE } from '../scope/tables.js';
import { replayKernel } from '../testing.js';
import { documentsDeployment, documentsPorts } from '../testing-documents.js';
import type { LoamKernel } from '../types.js';
import { type AgentMemberRowV1, widens } from './agent-members.js';
import type { LoamAccountAccessV1 } from './member-commands.js';

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
/** Den: restricted to Bea alone, so the owner Olu cannot see it. */
const DEN = 'prj_den';
const DEN_PROJECT: ProjectV1 = {
	...VAULT_PROJECT,
	id: DEN,
	slug: 'den',
	name: 'Den',
	createdAt: 5,
	access: { mode: 'restricted', members: [BEA] },
};
const AGENT = 'agt_aaaaaaaaaaaaaaaaaaaa';
const OTHER = 'agt_bbbbbbbbbbbbbbbbbbbb';

const kernels: LoamKernel[] = [];
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
	for (const project of [...SCOPED_PROJECTS, VAULT_PROJECT, DEN_PROJECT])
		await store.create('project', project);
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

const signIn = (kernel: LoamKernel, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
const switchTo = async (kernel: LoamKernel, email: string) => {
	await kernel.call('auth-sign-out');
	await signIn(kernel, email);
};
const journalOf = (made: { journal: MemoryJournalSink }) =>
	made.journal.read() as Promise<JournalEntry[]>;
const stored = (made: { store: MemoryAdapter | { get: MemoryAdapter['get'] } }, id = AGENT) =>
	made.store.get<AgentMemberV1>(AGENT_MEMBER_TABLE, id);
const add = (kernel: LoamKernel, input: Record<string, unknown>) =>
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
		// A member row is `MemberV1`: the provider's member id and digest stay out (the review's I5).
		for (const person of members.data?.people ?? []) {
			expect(person).not.toHaveProperty('digest');
			expect(person).not.toHaveProperty('memberId');
		}
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
			['agent-member-withdraw', { agent: AGENT }],
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
			'agent-member-withdraw',
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
			undo: expect.stringMatching(/^agu_[a-z0-9]{20}$/),
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
		// No caller names an agent member's id; an undo names only what it kept.
		expect((await add(made.kernel, { sponsor: OLU, id: 'agt_x' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect((await made.kernel.call('agent-member-add', { undo: 'agu_none' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('P3-E5: a refusal quotes each project as the caller named it: a restricted slug and a missing one alike (I2)', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		const refusal = async (ref: string) =>
			(await add(made.kernel, { sponsor: CY, access: { workspace: false, projects: [ref] } })).error
				?.message;
		// Den is restricted to Bea; Olu, the owner calling, cannot see it, and nothing has `nowhere`.
		expect(await refusal('den')).toBe("The sponsor cannot enter 'den'");
		expect(await refusal('nowhere')).toBe("The sponsor cannot enter 'nowhere'");
		expect(await refusal('citadel')).toBe("The sponsor cannot enter 'citadel'");
		expect(JSON.stringify(await journalOf(made))).not.toContain(DEN);
	});

	it("P3-E5: an undo's arguments name no project hidden from the caller, and restore it from the kept record (I3)", async () => {
		const made = await provider({
			agents: [agentMember({ access: { workspace: false, projects: [ATLAS, DEN] } })],
		});
		await signIn(made.kernel, 'olu@example.com');
		const seen = await made.kernel.call<AgentMemberRowV1>('agent-member-get', { agent: AGENT });
		expect(seen.data).toMatchObject({ access: { projects: [ATLAS] }, hiddenProjects: 1 });
		const renamed = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			name: 'Critic',
		});
		expect(JSON.stringify(renamed)).not.toContain(DEN);
		const back = await made.kernel.call<AgentMemberRowV1>(
			renamed.undoCommand as string,
			renamed.undoArgs
		);
		expect(back.success, JSON.stringify(back.error)).toBe(true);
		expect(await stored(made)).toMatchObject({
			name: 'Reviewer',
			access: { workspace: false, projects: [ATLAS, DEN] },
			status: 'active',
		});
		// Used once.
		expect(
			(await made.kernel.call(renamed.undoCommand as string, renamed.undoArgs)).error?.code
		).toBe('VALIDATION_ERROR');
		const removed = await made.kernel.call('agent-member-remove', { agent: AGENT });
		expect(JSON.stringify(removed)).not.toContain(DEN);
		expect(removed.undoArgs).toEqual({ undo: expect.stringMatching(/^agu_/) });
		const again = await made.kernel.call<AgentMemberRowV1>(
			removed.undoCommand as string,
			removed.undoArgs
		);
		expect(again.success, JSON.stringify(again.error)).toBe(true);
		// Added again by an owner who is not its sponsor: pending, Den kept.
		expect(await stored(made)).toMatchObject({
			id: AGENT,
			status: 'pending',
			access: { projects: [ATLAS, DEN] },
		});
		expect(JSON.stringify(await journalOf(made))).not.toMatch(/"undoArgs":\{[^}]*prj_den/);
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
		// Nor by naming a project it may enter: a shell command that does not act at the call's scope is decided at the
		// workspace's (the review's B1).
		for (const [name, input] of [
			['project-create', { name: 'Delta' }],
			['project-list', {}],
			['member-list', {}],
			['agent-member-list', {}],
		] as const) {
			expect((await asAgentMember(made, name, input, at())).error?.code, `${name} at Atlas`).toBe(
				'PROJECT_NOT_FOUND'
			);
		}
		expect(
			(await made.store.list<ProjectV1>('project')).data.map((project) => project.slug)
		).not.toContain('delta');
	});

	it('P3-E5: a pending one is refused before the membership read, so it never reaches the provider (N8)', async () => {
		let reads = 0;
		const made = await provider({
			agents: [
				agentMember({ status: 'pending', access: { workspace: true, projects: 'sponsor' } }),
			],
			ports: {
				...scopedPorts(),
				readMembership: async () => {
					reads++;
					return { role: 'member', digest: 'd-member' };
				},
			},
		});
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('project-list');
		const before = reads;
		expect((await asAgentMember(made, 'project-create', { name: 'Delta' })).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		expect(reads).toBe(before);
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

describe("P3-E5: the members read pages to the provider's total (I6)", () => {
	it('P3-E5: a dangling member row on the first page does not make a sponsor on the next read as gone', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'olu@example.com');
		// 250 member rows; the provider skips one with no user, so the first page holds 199; Bea is on the second.
		const rows: (null | { id: string; name: string; role: MemberRoleV1 })[] = [
			{ id: OLU, name: 'Olu', role: 'owner' },
			null,
			...Array.from({ length: 220 }, (_, at) => ({
				id: `mock-user-p${at}@example.com`,
				name: `P${at}`,
				role: 'member' as const,
			})),
			{ id: BEA, name: 'Bea', role: 'member' },
			...Array.from({ length: 27 }, (_, at) => ({
				id: `mock-user-q${at}@example.com`,
				name: `Q${at}`,
				role: 'member' as const,
			})),
		];
		vi.mocked(made.account.members).mockImplementation(async ({ limit = 200, offset = 0 }) => ({
			people: rows
				.slice(offset, offset + limit)
				.flatMap((row) => (row ? [{ ...row, memberId: `m-${row.id}`, image: null }] : [])),
			total: rows.length,
		}));
		const got = await made.kernel.call<AgentMemberRowV1>('agent-member-get', { agent: AGENT });
		expect(got.data).toMatchObject({ sponsorName: 'Bea', status: 'active' });
		await made.kernel.call('project-list');
		expect((await stored(made))?.status).toBe('active');
		expect((await journalOf(made)).some((entry) => entry.command === 'agent-member-settle')).toBe(
			false
		);
		// `member-remove` finds a member on the second page too, and suspends what they sponsor.
		const removed = await made.kernel.call('member-remove', { member: BEA });
		expect(removed.data).toEqual({ removed: true, suspended: [AGENT] });
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

describe("P3-E5: step 6's final check", () => {
	const at = (project = ATLAS) => ({ workspace: 'personal', project });

	it('P3-E5: a `workspace: false` agent member at Atlas reaches no workspace-level document by naming `project: null` (B1)', async () => {
		const made = await provider({
			agents: [agentMember()],
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		await signIn(made.kernel, 'bea@example.com');
		const mine = await made.kernel.call<{ id: string }>('document-create', {
			type: 'probe',
			project: 'atlas',
			title: 'In Atlas',
		});
		expect(mine.success, JSON.stringify(mine.error)).toBe(true);
		const document = mine.data?.id as string;
		for (const [name, input] of [
			['document-create', { type: 'probe', title: 'Out', project: null }],
			['document-move', { document, project: null }],
			['document-list', { project: null }],
			[
				'document-import',
				{
					type: 'probe',
					project: null,
					envelope: { loam_document: 1, type: 'probe', content_version: 1, content: { text: 'x' } },
				},
			],
		] as const) {
			expect((await asAgentMember(made, name, input, at())).error?.code, name).toBe(
				'PROJECT_NOT_FOUND'
			);
		}
		// Its own project's documents it still reaches; Bea's stays in Atlas.
		expect((await asAgentMember(made, 'document-list', {}, at())).success).toBe(true);
		const record = await made.store.get<{ scope: { project?: string }; title: string }>(
			'document',
			document
		);
		expect(record?.scope.project).toBe(ATLAS);
		const titles = (await made.store.list<{ title: string }>('document')).data.map(
			(row) => row.title
		);
		expect(titles).not.toContain('Out');
	});

	it('P3-E5: an agent member acting for no member gets nothing: signed-out and member-exempt commands included', async () => {
		const made = await provider({ agents: [agentMember({ sponsor: DEE })] });
		// Dee is signed in and is no member of the workspace.
		await signIn(made.kernel, 'dee@example.com');
		for (const name of [
			'scope-get',
			'palette-search',
			'shell-info-get',
			'account-get',
			'auth-session-get',
		]) {
			const input = name === 'palette-search' ? { query: '' } : {};
			expect((await asAgentMember(made, name, input)).error?.code, name).toBe('PROJECT_NOT_FOUND');
		}
		// A gated command is line 0's, in its own words.
		expect((await asAgentMember(made, 'project-list', {})).error?.code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
		// So is an unknown one's.
		expect((await asAgentMember(made, 'scope-get', {}, undefined, OTHER)).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
	});

	it("P3-E5: undoing a suspended agent member's rename leaves it suspended", async () => {
		const made = await provider({
			agents: [agentMember({ status: 'suspended', suspended: 'sponsor-declined' })],
		});
		await signIn(made.kernel, 'olu@example.com');
		const renamed = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			name: 'Critic',
		});
		expect(renamed.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-declined' });
		const undone = await made.kernel.call<AgentMemberRowV1>(
			renamed.undoCommand as string,
			renamed.undoArgs
		);
		expect(undone.success, JSON.stringify(undone.error)).toBe(true);
		expect(await stored(made)).toMatchObject({
			name: 'Reviewer',
			status: 'suspended',
			suspended: 'sponsor-declined',
		});
	});

	it('P3-E5: an undo id restores only the agent member it was kept for', async () => {
		const made = await provider({
			agents: [agentMember(), agentMember({ id: OTHER, name: 'Writer' })],
		});
		await signIn(made.kernel, 'olu@example.com');
		const renamed = await made.kernel.call('agent-member-update', { agent: AGENT, name: 'Critic' });
		const undo = (renamed.undoArgs as { undo: string }).undo;
		const crossed = await made.kernel.call('agent-member-update', { agent: OTHER, undo });
		expect(crossed.error?.code).toBe('VALIDATION_ERROR');
		expect((await stored(made, OTHER))?.name).toBe('Writer');
		// The right one still works.
		expect((await made.kernel.call('agent-member-update', { agent: AGENT, undo })).success).toBe(
			true
		);
	});

	it('P3-E5: kept records expire with the undo window, and only the newest 20 per agent member stay', async () => {
		let now = Date.parse('2026-01-01T00:00:00Z');
		const made = await provider({ agents: [agentMember()], clock: () => (now += 1) });
		await signIn(made.kernel, 'olu@example.com');
		const rename = async (name: string) =>
			(
				(await made.kernel.call('agent-member-update', { agent: AGENT, name })).undoArgs as {
					undo: string;
				}
			).undo;
		const first = await rename('A0');
		for (let i = 1; i <= 20; i++) await rename(`A${i}`);
		const kept = (await made.store.list<{ agent: string }>('agent-member-undo')).data;
		expect(kept).toHaveLength(20);
		// The oldest is gone.
		expect(
			(await made.kernel.call('agent-member-update', { agent: AGENT, undo: first })).error?.code
		).toBe('VALIDATION_ERROR');
		// Past the workspace's 30 days, the rest go too.
		const late = await rename('Late');
		now += 31 * 24 * 60 * 60 * 1000;
		expect(
			(await made.kernel.call('agent-member-update', { agent: AGENT, undo: late })).error?.code
		).toBe('VALIDATION_ERROR');
		expect((await made.store.list('agent-member-undo')).data).toHaveLength(0);
	});

	it('P3-E5: a reference resolves only to a project the caller may enter: Den, by slug or id, answers as `nowhere` (decided 2026-11-15)', async () => {
		const made = await provider();
		await signIn(made.kernel, 'olu@example.com');
		// Bea may enter Den, but Olu, the owner calling, cannot see it.
		const refusal = async (ref: string) =>
			(await add(made.kernel, { sponsor: BEA, access: { workspace: false, projects: [ref] } }))
				.error?.message;
		const nowhere = await refusal('nowhere');
		expect(nowhere).toBe("The sponsor cannot enter 'nowhere'");
		expect((await refusal('den'))?.replace("'den'", "'nowhere'")).toBe(nowhere);
		expect((await refusal(DEN))?.replace(`'${DEN}'`, "'nowhere'")).toBe(nowhere);
		expect((await made.store.list(AGENT_MEMBER_TABLE)).data).toEqual([]);
	});
});

describe("P3-E8's kernel half: connected agents, from the provider's table (9.2, 5.3; step 7)", () => {
	const CONNECTED = 'agt_cccccccccccccccccccc';
	/** Bea's connected agent, as `loamServerPlugin`'s endpoint answers it. */
	const beaConnected = (extra: Partial<AgentMemberV1> = {}) => ({
		id: CONNECTED,
		workspace: 'personal',
		kind: 'connected' as const,
		name: 'Claude Code',
		sponsor: BEA,
		installedBy: BEA,
		client: { id: 'https://claude.example/client.json', host: 'claude.example' },
		access: { workspace: true, projects: 'sponsor' as const },
		status: 'active' as const,
		scopes: ['loam:read', 'loam:write'],
		createdAt: 10,
		updatedAt: 10,
		updatedBy: BEA,
		...extra,
	});
	async function withConnected(extra: Partial<AgentMemberV1> = {}) {
		const made = await provider();
		const removeAgent = vi.fn(async () => {});
		const disconnectAgent = vi.fn(async () => {});
		const updateAgent = vi.fn(async (_agent: string, _access: AgentMemberV1['access']) => {});
		Object.assign(made.account, {
			agents: vi.fn(async () => [beaConnected(extra)]),
			removeAgent,
			disconnectAgent,
			updateAgent,
		});
		return { ...made, removeAgent, disconnectAgent, updateAgent };
	}

	it("#2784: `account-agent-update` narrows the person's own to projects they may enter, by id or slug, and widens it", async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'bea@example.com');
		const listed = await made.kernel.call<{ agents: { access: unknown }[] }>('account-agent-list');
		expect(listed.data?.agents[0]?.access).toEqual({ workspace: true, projects: 'sponsor' });
		const narrowed = await made.kernel.call('account-agent-update', {
			agent: CONNECTED,
			access: { workspace: false, projects: ['atlas', 'prj_atlas', DEN] },
		});
		expect(narrowed.success).toBe(true);
		expect(narrowed.data).toEqual({
			agent: CONNECTED,
			access: { workspace: false, projects: [ATLAS, DEN] },
			previous: { workspace: true, projects: 'sponsor' },
		});
		// Undoable through the access it had.
		expect(narrowed).toMatchObject({
			undoCommand: 'account-agent-update',
			undoArgs: { agent: CONNECTED, access: { workspace: true, projects: 'sponsor' } },
		});
		// Written only while it is still the access read (#2784's review): `previous` travels with it.
		expect(made.updateAgent).toHaveBeenLastCalledWith(
			CONNECTED,
			{ workspace: false, projects: [ATLAS, DEN] },
			{ workspace: true, projects: 'sponsor' }
		);
		const widened = await made.kernel.call('account-agent-update', {
			agent: CONNECTED,
			access: { workspace: true, projects: 'sponsor' },
		});
		expect(widened.success).toBe(true);
		expect(made.updateAgent).toHaveBeenLastCalledWith(
			CONNECTED,
			{ workspace: true, projects: 'sponsor' },
			{ workspace: true, projects: 'sponsor' }
		);
		// Recorded (3.4): its whole effect is at the provider, so a replay answers it from its entry.
		const entries = (await journalOf(made)).filter(
			(entry) => entry.command === 'account-agent-update'
		);
		expect(entries.length).toBe(2);
		for (const entry of entries) expect(entry.context?.replay).toBe('recorded');
	});

	it('#2784: a project the person may not enter answers the same `PROJECT_NOT_FOUND` as a missing one, and nothing is written', async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'bea@example.com');
		const update = async (projects: string[]) => {
			const { success, error } = await made.kernel.call('account-agent-update', {
				agent: CONNECTED,
				access: { workspace: true, projects },
			});
			return { success, error };
		};
		const missing = await update(['nowhere']);
		expect(missing.success).toBe(false);
		expect(missing.error).toMatchObject({
			code: 'PROJECT_NOT_FOUND',
			suggestion: expect.stringContaining('project-list'),
		});
		// Citadel is restricted to someone else: refused byte for byte as a project that does not exist.
		expect(await update(['citadel'])).toEqual(missing);
		expect(await update([ATLAS, CITADEL])).toEqual(missing);
		expect(made.updateAgent).not.toHaveBeenCalled();
		// Cy may not enter Bea's Den either; but Cy has no agent of Bea's to name at all.
		await switchTo(made.kernel, 'cy@example.com');
		expect((await update([ATLAS])).error).toEqual(
			(await made.kernel.call('account-agent-disconnect', { agent: CONNECTED })).error
		);
		expect(made.updateAgent).not.toHaveBeenCalled();
	});

	it("#2784: another person's narrowed agent, whose projects the provider withholds, counts them as hidden and warns of nothing", async () => {
		const made = await withConnected({
			access: { workspace: true, projects: [] },
			withheldProjects: 2,
		} as Partial<AgentMemberV1>);
		await signIn(made.kernel, 'olu@example.com');
		const listed = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list');
		expect(listed.data?.agents.find((agent) => agent.id === CONNECTED)).toMatchObject({
			access: { workspace: true, projects: [] },
			hiddenProjects: 2,
			warnings: [],
		});
	});

	it("#2784: another person's agent is not found, an owner's removal stands, and no agent changes any access", async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'cy@example.com');
		const input = { agent: CONNECTED, access: { workspace: true, projects: [ATLAS] } };
		expect((await made.kernel.call('account-agent-update', input)).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
		await switchTo(made.kernel, 'bea@example.com');
		// A human command: an agent on the person's behalf is refused it, before the provider.
		expect((await made.kernel.agent.call('account-agent-update', input)).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		expect(made.updateAgent).not.toHaveBeenCalled();
		// The provider's refusal of a record that changed since the list answers as the kernel's own.
		made.updateAgent.mockRejectedValueOnce(
			Object.assign(new Error('Only the person who connected it'), {
				code: 'AGENT_MEMBER_SPONSOR_ONLY',
			})
		);
		expect((await made.kernel.call('account-agent-update', input)).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
		// Changed since the list (another tab, or an undo of a change already replaced): refused, with the way back.
		made.updateAgent.mockRejectedValueOnce(
			Object.assign(new Error('changed'), { code: 'AGENT_ACCESS_CHANGED', status: 409 })
		);
		expect((await made.kernel.call('account-agent-update', input)).error).toMatchObject({
			code: 'AGENT_ACCESS_CHANGED',
			suggestion: expect.stringContaining('account-agent-list'),
		});
		// The access the caller last saw, given as `expected` (the tab, an undo), no longer the record's: refused here.
		const calls = made.updateAgent.mock.calls.length;
		expect(
			(
				await made.kernel.call('account-agent-update', {
					...input,
					expected: { workspace: false, projects: [ATLAS] },
				})
			).error?.code
		).toBe('AGENT_ACCESS_CHANGED');
		expect(made.updateAgent.mock.calls.length).toBe(calls);
		const removed = await withConnected({ status: 'suspended', suspended: 'owner' });
		await signIn(removed.kernel, 'bea@example.com');
		const refused = await removed.kernel.call('account-agent-update', input);
		expect(refused.error).toMatchObject({
			code: 'AGENT_DISCONNECTED_BY_OWNER',
			suggestion: expect.stringContaining('owner'),
		});
		expect(removed.updateAgent).not.toHaveBeenCalled();
	});

	it('P3-E8: `agent-member-list` and `-get` show a connected agent beside the installed ones, filtered for the caller', async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'cy@example.com');
		const listed = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list');
		expect(listed.success).toBe(true);
		const row = listed.data?.agents.find((agent) => agent.id === CONNECTED);
		expect(row).toMatchObject({
			kind: 'connected',
			sponsor: BEA,
			sponsorName: 'Bea',
			status: 'active',
		});
		expect(row).not.toHaveProperty('scopes');
		const got = await made.kernel.call<AgentMemberRowV1>('agent-member-get', { agent: CONNECTED });
		expect(got.data).toMatchObject({ id: CONNECTED, kind: 'connected' });
		const members = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('member-list');
		expect(members.data?.agents.map((agent) => agent.id)).toContain(CONNECTED);
	});

	it("P3-E8: `account-agent-list` holds the person's own alone, and `-disconnect` names only one of them", async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'bea@example.com');
		const own = await made.kernel.call<{ agents: { agent: string; clientHost: string }[] }>(
			'account-agent-list'
		);
		expect(own.data?.agents).toEqual([
			expect.objectContaining({ agent: CONNECTED, clientHost: 'claude.example', status: 'active' }),
		]);
		expect((await made.kernel.call('account-agent-disconnect', { agent: CONNECTED })).success).toBe(
			true
		);
		expect(made.disconnectAgent).toHaveBeenCalledWith(CONNECTED);
		await switchTo(made.kernel, 'cy@example.com');
		expect(
			(await made.kernel.call<{ agents: unknown[] }>('account-agent-list')).data?.agents
		).toEqual([]);
		expect(
			(await made.kernel.call('account-agent-disconnect', { agent: CONNECTED })).error?.code
		).toBe('AGENT_MEMBER_NOT_FOUND');
		expect(made.disconnectAgent).toHaveBeenCalledTimes(1);
		// A human command: an agent on the person's behalf is refused it.
		expect(
			(await made.kernel.agent.call('account-agent-disconnect', { agent: CONNECTED })).error?.code
		).toBe('HUMAN_REQUIRED');
	});

	it("P3-E8: an owner's `agent-member-remove` of a connected agent goes to the provider, `forget` with it, recorded", async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'olu@example.com');
		expect((await made.kernel.call('agent-member-remove', { agent: CONNECTED })).success).toBe(
			true
		);
		expect(
			(await made.kernel.call('agent-member-remove', { agent: CONNECTED, forget: true })).success
		).toBe(true);
		expect(made.removeAgent.mock.calls).toEqual([
			[CONNECTED, false],
			[CONNECTED, true],
		]);
		const entries = (await journalOf(made)).filter(
			(entry) => entry.command === 'agent-member-remove'
		);
		for (const entry of entries) expect(entry.context?.replay).toBe('recorded');
		// An id neither table holds is no agent member, and the provider is not asked.
		expect((await made.kernel.call('agent-member-remove', { agent: OTHER })).error?.code).toBe(
			'AGENT_MEMBER_NOT_FOUND'
		);
		expect(made.removeAgent).toHaveBeenCalledTimes(2);
		// A non-owner: refused before the provider.
		await switchTo(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('agent-member-remove', { agent: CONNECTED })).error?.code).toBe(
			'OWNER_REQUIRED'
		);
		expect(made.removeAgent).toHaveBeenCalledTimes(2);
	});

	it('P3-E8: a connected agent is not withdrawn: its sponsor is told to disconnect it, and the provider is not written (#2781)', async () => {
		const made = await withConnected();
		await signIn(made.kernel, 'bea@example.com');
		const refused = await made.kernel.call('agent-member-withdraw', { agent: CONNECTED });
		expect(refused.error).toMatchObject({ code: 'AGENT_MEMBER_NOT_FOUND' });
		expect(refused.error?.suggestion).toContain('account-agent-disconnect');
		expect(made.disconnectAgent).not.toHaveBeenCalled();
		expect(made.removeAgent).not.toHaveBeenCalled();
	});
});

describe('#2781: a sponsor withdraws an active agent member (8.2, 8.3)', () => {
	const at = (project = ATLAS) => ({ workspace: 'personal', project });

	it('#2781: the sponsor withdraws it: suspended, saying why, its access kept, with no undo, and line 4 refuses it at once', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'bea@example.com');
		expect((await asAgentMember(made, 'dual-where', {}, at())).success).toBe(true);
		const withdrawn = await made.kernel.call<AgentMemberRowV1>('agent-member-withdraw', {
			agent: AGENT,
		});
		expect(withdrawn.success, JSON.stringify(withdrawn.error)).toBe(true);
		expect(withdrawn.data).toMatchObject({
			status: 'suspended',
			suspended: 'sponsor-withdrew',
			access: { workspace: false, projects: [ATLAS] },
			updatedBy: BEA,
		});
		// No undo: undoing would give access back without the sponsor confirming again.
		expect(withdrawn.undoCommand).toBeUndefined();
		expect(await stored(made)).toMatchObject({
			status: 'suspended',
			suspended: 'sponsor-withdrew',
			installedBy: OLU,
		});
		expect((await asAgentMember(made, 'dual-where', {}, at())).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		const listed = await made.kernel.call<{ agents: AgentMemberRowV1[] }>('agent-member-list', {
			status: 'suspended',
		});
		expect(listed.data?.agents.map((agent) => [agent.id, agent.suspended])).toEqual([
			[AGENT, 'sponsor-withdrew'],
		]);
	});

	it('#2781: only the sponsor withdraws it: an owner who is not its sponsor, and another member, are refused', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'olu@example.com');
		for (const email of ['olu@example.com', 'cy@example.com']) {
			await switchTo(made.kernel, email);
			const refused = await made.kernel.call('agent-member-withdraw', { agent: AGENT });
			expect(refused.error, email).toMatchObject({ code: 'AGENT_MEMBER_SPONSOR_ONLY' });
			expect(refused.error?.suggestion).toContain('withdraws');
		}
		expect((await stored(made))?.status).toBe('active');
	});

	it('#2781: only an active one is withdrawn; a pending or suspended one is AGENT_MEMBER_NOT_ACTIVE, unchanged', async () => {
		const made = await provider({
			agents: [
				agentMember({ status: 'pending' }),
				agentMember({ id: OTHER, status: 'suspended', suspended: 'sponsor-left' }),
			],
		});
		await signIn(made.kernel, 'bea@example.com');
		for (const [agent, status] of [
			[AGENT, 'pending'],
			[OTHER, 'suspended'],
		] as const) {
			const refused = await made.kernel.call('agent-member-withdraw', { agent });
			expect(refused.error, agent).toMatchObject({ code: 'AGENT_MEMBER_NOT_ACTIVE' });
			expect(refused.error?.suggestion).toContain('agent-member-update');
			expect((await stored(made, agent))?.status).toBe(status);
		}
		expect((await stored(made, OTHER))?.suspended).toBe('sponsor-left');
		const missing = await made.kernel.call('agent-member-withdraw', {
			agent: 'agt_dddddddddddddddddddd',
		});
		expect(missing.error?.code).toBe('AGENT_MEMBER_NOT_FOUND');
	});

	it('#2781: an agent member acting for its sponsor cannot withdraw itself or another, on any interface', async () => {
		const made = await provider({
			agents: [
				agentMember({ access: { workspace: true, projects: 'sponsor' } }),
				agentMember({ id: OTHER, name: 'Writer' }),
			],
		});
		await signIn(made.kernel, 'bea@example.com');
		for (const agent of [AGENT, OTHER]) {
			expect((await asAgentMember(made, 'agent-member-withdraw', { agent })).error?.code).toBe(
				'HUMAN_REQUIRED'
			);
			expect((await stored(made, agent))?.status).toBe('active');
		}
	});

	it('#2781: a withdrawn one comes back only when an owner names a sponsor, who confirms again', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-withdraw', { agent: AGENT });
		await switchTo(made.kernel, 'olu@example.com');
		// An owner's change that names no sponsor leaves it withdrawn, wider access included.
		const widened = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			name: 'Critic',
			access: { workspace: true, projects: [ATLAS] },
		});
		expect(widened.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-withdrew' });
		// Undoing that change restores the withdrawn record, never an active one.
		const undone = await made.kernel.call<AgentMemberRowV1>(
			widened.undoCommand as string,
			widened.undoArgs
		);
		expect(undone.data).toMatchObject({ status: 'suspended', suspended: 'sponsor-withdrew' });
		// Naming Bea again asks her: pending until she confirms.
		const named = await made.kernel.call<AgentMemberRowV1>('agent-member-update', {
			agent: AGENT,
			sponsor: BEA,
		});
		expect(named.data?.status).toBe('pending');
		await switchTo(made.kernel, 'bea@example.com');
		expect((await asAgentMember(made, 'dual-where', {}, at())).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		const confirmed = await made.kernel.call<AgentMemberRowV1>('agent-member-confirm', {
			agent: AGENT,
		});
		expect(confirmed.data?.status).toBe('active');
	});

	it('#2781: a withdrawal is never lost to an owner change that read the record before it (the review)', async () => {
		// Olu, an owner, sponsors it. His undo of a rename reads the active record, then its kept record; at that read
		// his withdrawal starts, as another person's call does on the server's kernel. Each write reads, decides and
		// writes before the next starts, so the undo cannot write the record back active after the withdrawal.
		const made = await provider({ agents: [agentMember({ sponsor: OLU })] });
		await signIn(made.kernel, 'olu@example.com');
		const renamed = await made.kernel.call('agent-member-update', { agent: AGENT, name: 'Critic' });
		expect(renamed.success, JSON.stringify(renamed.error)).toBe(true);
		const get = made.store.get.bind(made.store);
		let reads = 0;
		let withdrawing: Promise<unknown> | undefined;
		vi.spyOn(made.store, 'get').mockImplementation((async (table: string, id: string) => {
			// The first read of the kept record is the sponsor read before the call; the second is the handler's own.
			if (table === AGENT_MEMBER_UNDO_TABLE && ++reads === 2) {
				withdrawing = made.kernel.call('agent-member-withdraw', { agent: AGENT });
				await Promise.race([withdrawing, new Promise((resolve) => setTimeout(resolve, 100))]);
			}
			return get(table, id);
		}) as typeof made.store.get);
		const undone = await made.kernel.call(renamed.undoCommand as string, renamed.undoArgs);
		expect(undone.success, JSON.stringify(undone.error)).toBe(true);
		expect(withdrawing).toBeDefined();
		const withdrawn = (await withdrawing) as { success: boolean; error?: unknown };
		expect(withdrawn.success, JSON.stringify(withdrawn.error)).toBe(true);
		expect(await stored(made)).toMatchObject({
			name: 'Reviewer',
			status: 'suspended',
			suspended: 'sponsor-withdrew',
		});
	});

	it("#2781: undoing an owner's earlier change of sponsor never reactivates it in the withdrawing sponsor's name", async () => {
		// Olu hands his agent member to Bea; she confirms, then withdraws. Undoing the hand-over names Olu again, the
		// owner calling, who confirms by doing it (D111): active, in Olu's name, never Bea's.
		const made = await provider({ agents: [agentMember({ sponsor: OLU })] });
		await signIn(made.kernel, 'olu@example.com');
		const handed = await made.kernel.call('agent-member-update', { agent: AGENT, sponsor: BEA });
		expect((handed.data as AgentMemberRowV1 | undefined)?.status).toBe('pending');
		await switchTo(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-confirm', { agent: AGENT });
		await made.kernel.call('agent-member-withdraw', { agent: AGENT });
		await switchTo(made.kernel, 'olu@example.com');
		const undone = await made.kernel.call<AgentMemberRowV1>(
			handed.undoCommand as string,
			handed.undoArgs
		);
		expect(undone.data).toMatchObject({ sponsor: OLU, status: 'active', updatedBy: OLU });
		expect(undone.data).not.toHaveProperty('suspended');
	});

	it('#2781: undoing a change of sponsor that restores another person asks them again', async () => {
		// Olu hands Bea's agent member to Cy; Cy confirms, then withdraws. Undoing the hand-over names Bea, not the
		// owner calling: pending until she confirms.
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'olu@example.com');
		const handed = await made.kernel.call('agent-member-update', { agent: AGENT, sponsor: CY });
		expect(handed.success, JSON.stringify(handed.error)).toBe(true);
		await switchTo(made.kernel, 'cy@example.com');
		await made.kernel.call('agent-member-confirm', { agent: AGENT });
		await made.kernel.call('agent-member-withdraw', { agent: AGENT });
		await switchTo(made.kernel, 'olu@example.com');
		const undone = await made.kernel.call<AgentMemberRowV1>(
			handed.undoCommand as string,
			handed.undoArgs
		);
		expect(undone.data).toMatchObject({ sponsor: BEA, status: 'pending' });
	});

	it("#2781: an owner's removal of a connected agent waits on the provider outside the write turn", async () => {
		// The provider never answers Olu's removal of a connected agent; his withdrawal of his own installed one still runs.
		const made = await provider({ agents: [agentMember({ sponsor: OLU })] });
		const CONNECTED = 'agt_cccccccccccccccccccc';
		let answer = () => {};
		Object.assign(made.account, {
			agents: vi.fn(async () => [
				{
					...agentMember({ id: CONNECTED, kind: 'connected', name: 'Claude Code' }),
					scopes: [],
				},
			]),
			removeAgent: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						answer = resolve;
					})
			),
		});
		await signIn(made.kernel, 'olu@example.com');
		const removing = made.kernel.call('agent-member-remove', { agent: CONNECTED });
		await vi.waitFor(() => expect(made.account.removeAgent).toHaveBeenCalled());
		const withdrawn = await Promise.race([
			made.kernel.call('agent-member-withdraw', { agent: AGENT }),
			new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), 1000)),
		]);
		expect(withdrawn).toMatchObject({ success: true });
		answer();
		expect((await removing).success).toBe(true);
	});

	it('#2781: removing a withdrawn one, then undoing it, asks its sponsor again', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-withdraw', { agent: AGENT });
		await switchTo(made.kernel, 'olu@example.com');
		const removed = await made.kernel.call('agent-member-remove', { agent: AGENT });
		expect(removed.success, JSON.stringify(removed.error)).toBe(true);
		const restored = await made.kernel.call<AgentMemberRowV1>(
			removed.undoCommand as string,
			removed.undoArgs
		);
		expect(restored.data?.status).toBe('pending');
	});

	it('#2781: the journal replays the withdrawal to the same record, reaching no provider', async () => {
		const made = await provider({ agents: [agentMember()] });
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.call('agent-member-withdraw', { agent: AGENT });
		const entries = await journalOf(made);
		const entry = entries.find((each) => each.command === 'agent-member-withdraw');
		expect(entry?.result?.success).toBe(true);
		// A write of Loam's store: re-run in a replay, never answered from its entry (3.4).
		expect(entry?.context?.replay).not.toBe('recorded');
		const members = vi.mocked(made.account.members).mock.calls.length;
		// The replay's store holds what the original's did before the journal began.
		const store = new MemoryAdapter();
		for (const project of [...SCOPED_PROJECTS, VAULT_PROJECT, DEN_PROJECT])
			await store.create('project', project);
		await store.create(AGENT_MEMBER_TABLE, agentMember());
		const { report, kernel } = await replayKernel(entries, {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			identity: PROVIDER,
			membership: ACME(),
			store,
			keep: true,
		});
		if (kernel) kernels.push(kernel);
		expect(report.diverged, JSON.stringify(report)).toBe(false);
		expect(vi.mocked(made.account.members).mock.calls.length).toBe(members);
		expect(await store.get<AgentMemberV1>(AGENT_MEMBER_TABLE, AGENT)).toMatchObject({
			status: 'suspended',
			suspended: 'sponsor-withdrew',
		});
	});
});
