/**
 * The server kernel's chain (phase 3 specification, 9.5; step 7), as units over a principal-gated kernel and a signed-in
 * Mock whose person is an owner and a member of the restricted project: every call, top-level or nested, runs under a
 * principal the kernel minted, the actor is always the principal's, and nothing falls back to the adapter. P3-E8's
 * MCP half is `identity/src/mcp-identity.test.ts`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type Actor, type CommandResult, MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { beforeAll, describe, expect, it } from 'vitest';
import { createKernelParts, KERNEL_OWN, type KernelParts } from '../kernel.js';
import { SCOPED_PROJECTS, scopedDeployment, scopedPorts, seedProjects } from '../scope/fixtures.js';
import type { AgentMemberV1 } from '../scope/records.js';
import { createFixedEnvironment, createSeededRandom, createSteppingClock } from '../session.js';
import { createPrincipalGate, createPrincipalRegistry } from './principal-gate.js';

const MOCK = 'mock-user-someone@example.com';
const BEA = 'usr_bea';
const AGENT = 'agt_aaaaaaaaaaaaaaaaaaaa';
const CITADEL = { workspace: 'personal', project: 'prj_citadel' };

const connected = (sponsor = BEA, extra: Partial<AgentMemberV1> = {}): AgentMemberV1 => ({
	id: AGENT,
	workspace: 'personal',
	kind: 'connected',
	name: 'Claude Code',
	sponsor,
	installedBy: sponsor,
	client: { id: 'client-1', host: '' },
	access: { workspace: true, projects: 'sponsor' },
	status: 'active',
	createdAt: 1,
	updatedAt: 1,
	updatedBy: sponsor,
	...extra,
});

let parts: KernelParts;
let journal: MemoryJournalSink;
let reads = 0;

beforeAll(async () => {
	const store = new MemoryAdapter();
	// Citadel restricted to the Mock's person and to Bea.
	await seedProjects(
		store,
		SCOPED_PROJECTS.map((project) =>
			project.slug === 'citadel'
				? { ...project, access: { mode: 'restricted' as const, members: [MOCK, BEA] } }
				: project
		)
	);
	const clock = createSteppingClock();
	const auth = new MockAuthAdapter({ clock: { now: clock } });
	await auth.signIn({ method: 'credentials', email: 'someone@example.com', password: 'x' });
	// Counted from before the kernel is built: neither its boot nor any call reads the adapter (9.5).
	const read = auth.getSession.bind(auth);
	auth.getSession = () => {
		reads += 1;
		return read();
	};
	journal = new MemoryJournalSink();
	parts = await createKernelParts({
		store,
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		clock,
		random: createSeededRandom('principal'),
		deployment: scopedDeployment(),
		ports: scopedPorts(),
		identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] },
		membership: { mode: 'provider', members: new Map([[MOCK, 'owner']]), digest: 'x' },
		gate: 'principal',
	});
});

const admit = (
	person = BEA,
	role: 'owner' | 'admin' | 'member' | null = 'member',
	agent = connected(person)
) =>
	(parts.admitPrincipal as NonNullable<KernelParts['admitPrincipal']>)({
		actor: { kind: 'agent', id: agent.id, label: agent.name, onBehalfOf: person },
		person,
		role,
		agent,
	});

/**
 * The kernel's chain over the agent registry, with the principal on its context. The real MCP handler calls with
 * `interface: 'mcp'`, which phase 5's enforcement does not gate (milestone C); this seam is the agent interface's.
 */
let traces = 0;
const call = (name: string, input: unknown, context: Record<string, unknown>) =>
	parts.registries.agent.execute(name, input, {
		traceId: `mcp-${++traces}`,
		...context,
	} as never) as Promise<CommandResult<Record<string, unknown>>>;

describe('principalGate (9.5)', () => {
	it("runs a call as the principal's actor, never the caller's", async () => {
		const principal = admit();
		const before = (await journal.read()).length;
		const answer = await call(
			'dual-where',
			{},
			{
				principal,
				actor: { kind: 'human', id: MOCK },
				scope: CITADEL,
			}
		);
		expect(answer.success).toBe(true);
		const entry = (await journal.read())
			.slice(before)
			.find((each) => each.command === 'dual-where');
		expect(entry?.actor).toEqual({
			kind: 'agent',
			id: AGENT,
			label: 'Claude Code',
			onBehalfOf: BEA,
		});
	});

	it('refuses a call with no principal, or one this kernel did not mint, whoever the adapter signed in', async () => {
		for (const context of [
			{},
			{ actor: { kind: 'human', id: MOCK } },
			{
				principal: {
					actor: { kind: 'human', id: MOCK },
					person: MOCK,
					membership: { mode: 'provider', members: new Map([[MOCK, 'owner']]), digest: '' },
				},
			},
			{
				principal: createPrincipalRegistry().admit({
					actor: { kind: 'human', id: MOCK },
					person: MOCK,
					role: 'owner',
				}),
			},
		]) {
			expect((await call('project-list', {}, context)).error?.code).toBe('UNAUTHORIZED');
		}
		// The browser's own path, the palette and the agent interface: refused, though the Mock is signed in.
		expect((await parts.kernel.call('project-list')).error?.code).toBe('UNAUTHORIZED');
		expect((await parts.kernel.agent.call('project-list')).error?.code).toBe('UNAUTHORIZED');
	});

	it("decides on the principal's membership alone: a person with no member row is `WORKSPACE_NOT_MEMBER`", async () => {
		const removed = admit('usr_cy', null);
		expect((await call('project-list', {}, { principal: removed })).error?.code).toBe(
			'WORKSPACE_NOT_MEMBER'
		);
	});

	it("line 4 on the principal's connected agent: suspended or for another sponsor, refused", async () => {
		const suspended = admit(
			BEA,
			'member',
			connected(BEA, { status: 'suspended', suspended: 'owner' })
		);
		expect((await call('dual-where', {}, { principal: suspended })).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		const narrowed = admit(
			BEA,
			'member',
			connected(BEA, { access: { workspace: true, projects: [] } })
		);
		expect(
			(await call('dual-where', {}, { principal: narrowed, scope: CITADEL })).error?.code
		).toBe('PROJECT_NOT_FOUND');
		expect((await call('dual-where', {}, { principal: narrowed })).success).toBe(true);
	});

	it("a person the restricted project does not list is refused it, though the Mock's person is listed", async () => {
		const cy = admit('usr_cy', 'member');
		expect((await call('dual-where', {}, { principal: cy, scope: CITADEL })).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
	});

	it("a nested call runs under its outer call's principal, from the actor it copied, journaled as the agent", async () => {
		const before = (await journal.read()).length;
		const answer = await call('dual-nested', {}, { principal: admit(), scope: CITADEL });
		expect(answer.success).toBe(true);
		expect(answer.data?.here).toEqual(CITADEL);
		const nested = (await journal.read())
			.slice(before)
			.filter((entry) => entry.command === 'dual-where');
		expect(nested.length).toBe(2);
		for (const entry of nested) expect(entry.actor).toMatchObject({ id: AGENT, onBehalfOf: BEA });
		// Refused for a person who may not enter: the outer call, so no nested read is made.
		expect(
			(await call('dual-nested', {}, { principal: admit('usr_cy'), scope: CITADEL })).error?.code
		).toBe('PROJECT_NOT_FOUND');
	});

	it("a retired principal admits nothing: a nested client kept past its request refuses (the reviews' blocker)", async () => {
		const principal = admit();
		expect((await call('project-list', {}, { principal })).success).toBe(true);
		(parts.retirePrincipal as NonNullable<KernelParts['retirePrincipal']>)(principal);
		expect((await call('project-list', {}, { principal })).error?.code).toBe('UNAUTHORIZED');
	});

	it("reads no account but by the call's person: with no `accountFor`, `account-get` and `member-list` refuse", async () => {
		for (const name of ['account-get', 'member-list']) {
			const answer = await call(name, {}, { principal: admit() });
			expect(answer.error?.code, name).toBe('IDENTITY_PROVIDER_UNAVAILABLE');
			expect(JSON.stringify(answer)).not.toContain(MOCK);
		}
	});

	it("`app-list` answers the call's apps, though the adapter holds no session the server reads", async () => {
		const listed = await call('app-list', {}, { principal: admit() });
		expect(listed.success).toBe(true);
		expect((listed.data?.apps as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
	});

	it('never journals the principal or reads the adapter', async () => {
		const text = JSON.stringify(await journal.read());
		expect(text).not.toContain('principal');
		expect(text).not.toContain('"membership"');
		expect(reads).toBe(0);
	});
});

describe("the kernel's own calls (9.5)", () => {
	it("boot's own work ran with no principal; nothing else passes without one", async () => {
		const apply = (await journal.read()).find(
			(entry) => entry.command === 'workspace-deployment-apply'
		);
		expect(apply?.result?.success).toBe(true);
		expect(apply?.actor).toBeUndefined();
		// A boot-only name is in no other registry.
		expect((await call('workspace-deployment-apply', {}, { principal: admit() })).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});

	it('the marks pass only the command each is for, and only under the symbol `execute` sets', async () => {
		const gate = createPrincipalGate({ principals: createPrincipalRegistry(), own: KERNEL_OWN });
		const ran: string[] = [];
		const next = async () => {
			ran.push('ran');
			return { success: true } as CommandResult;
		};
		const marked = (mark: string) => ({ [KERNEL_OWN]: mark }) as never;
		expect((await gate('app-instance-refresh', {}, marked('instance'), next)).success).toBe(true);
		expect((await gate('project-list', {}, marked('instance'), next)).error?.code).toBe(
			'UNAUTHORIZED'
		);
		expect((await gate('workspace-deployment-apply', {}, marked('boot'), next)).success).toBe(true);
		// A string key of the same name, as a caller's field would be, is not the mark.
		expect(
			(await gate('app-instance-refresh', {}, { instance: 'instance' } as never, next)).error?.code
		).toBe('UNAUTHORIZED');
		expect(ran).toEqual(['ran', 'ran']);
	});
});

describe('admitPrincipal (9.2, steps 4 and 5)', () => {
	const registry = createPrincipalRegistry();
	it('refuses an actor, person and agent that do not agree', () => {
		const agent = connected();
		const cases: Array<{ actor: Actor; person: string; agent?: AgentMemberV1 }> = [
			{ actor: { kind: 'agent', id: AGENT, onBehalfOf: 'usr_other' }, person: BEA, agent },
			{
				actor: { kind: 'agent', id: 'agt_bbbbbbbbbbbbbbbbbbbb', onBehalfOf: BEA },
				person: BEA,
				agent,
			},
			{
				actor: { kind: 'agent', id: AGENT, onBehalfOf: BEA },
				person: BEA,
				agent: connected('usr_other'),
			},
			{ actor: { kind: 'agent', id: AGENT, onBehalfOf: BEA }, person: BEA },
			{ actor: { kind: 'human', id: 'usr_other' }, person: BEA },
			{ actor: { kind: 'human', id: BEA }, person: BEA, agent },
			{ actor: { kind: 'human', id: AGENT }, person: AGENT },
			{ actor: { kind: 'service', id: BEA }, person: BEA },
		];
		for (const input of cases) expect(() => registry.admit({ ...input, role: 'member' })).toThrow();
	});

	it("is frozen, holds only its person's row, and is trusted by its own registry alone", () => {
		const principal = registry.admit({
			actor: { kind: 'agent', id: AGENT, onBehalfOf: BEA },
			person: BEA,
			role: 'member',
			agent: connected(),
		});
		expect(Object.isFrozen(principal)).toBe(true);
		expect(Object.isFrozen(principal.actor)).toBe(true);
		expect(Object.isFrozen(principal.agent)).toBe(true);
		expect([...principal.membership.members]).toEqual([[BEA, 'member']]);
		expect(() =>
			(principal.membership.members as Map<string, string>).set(MOCK, 'owner')
		).toThrow();
		expect(registry.has(principal)).toBe(true);
		expect(createPrincipalRegistry().has(principal)).toBe(false);
		expect(registry.has({ ...principal })).toBe(false);
		expect(registry.of(principal.actor)).toBe(principal);
		expect(registry.of({ ...principal.actor })).toBeUndefined();
	});
});

describe('a principal-gated kernel (9.5)', () => {
	it('refuses a `local` deployment', async () => {
		await expect(
			createKernelParts({
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				gate: 'principal',
			})
		).rejects.toMatchObject({ code: 'IDENTITY_MODE_INVALID' });
	});

	it('registers two of the three settles, and serves no page-event middleware over MCP', async () => {
		for (const name of ['session-settle', 'membership-settle']) {
			expect(parts.registries.boot.hasCommand(name)).toBe(false);
		}
		// `agent-member-settle` is the provider hook's alone (phase 3's A4): in the boot registry, never a caller's.
		expect(parts.registries.boot.hasCommand('agent-member-settle')).toBe(true);
		expect(parts.registries.palette.hasCommand('agent-member-settle')).toBe(false);
		// The kernel's own chain alone, so its first middleware is the principal gate: no page-event step ahead of it
		// reads a page's session.
		const first = parts.mcpOptions()?.middleware[0];
		const answer = await first?.(
			'project-list',
			{},
			{} as never,
			async () => ({ success: true }) as CommandResult
		);
		expect(answer?.error?.code).toBe('UNAUTHORIZED');
	});
});
