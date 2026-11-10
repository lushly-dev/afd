/**
 * Phase 3's step 1 units (phase 3 specification, 3, 4.5 and 12): `decideAccess` version 2 and line 0, the
 * auth gate's lists, the actor on the agent interface and on every port and nested path, `isOwner`,
 * `personalRecordId` and the tables. Each exit row's title names it; each holds what step 1 builds, and
 * the steps after it add the rest of their rows.
 */

import { type AuthAdapter, type AuthSessionState, MockAuthAdapter } from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandResult,
	type JournalEntry,
	MemoryJournalSink,
	success,
} from '@lushly-dev/afd-core';
import { defineCommandWithSchema, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { INTERNAL_COMMANDS } from '../commands.js';
import { createKernel } from '../kernel.js';
import {
	gatedByLineZero,
	KERNEL_SETTLE_COMMANDS,
	lineZero,
	MEMBER_EXEMPT_COMMANDS,
	SIGNED_OUT_COMMANDS,
} from '../late/auth-gate.js';
import { isOwner } from '../late/owners.js';
import { personalWrites } from '../late/personal-writes.js';
import { AGENT_MEMBER_TABLE, PERSONA_TABLE } from '../late/tables.js';
import { createFixedEnvironment } from '../session.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import { replayKernel } from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import {
	type AccessActorV1,
	decideAccess,
	LOCAL_ACTOR,
	LOCAL_MEMBERSHIP,
	type MembershipV1,
	personKey,
	personOf,
} from './access.js';
import {
	createScopedWorkspace,
	SCOPED_PROJECTS,
	type ScopedWorkspace,
	scopedDeployment,
	scopedPorts,
	seedProjects,
} from './fixtures.js';
import { createScopeMiddleware, type LateScope } from './middleware.js';
import { personalRecordId, personalStore } from './personal.js';
import type { AgentMemberV1, PersonaV1, ProjectV1, ScopeV1 } from './records.js';
import { createScopeRuntime } from './runtime.js';

const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const CARO = 'mock-user-caro@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey'],
};
const members = (entries: Record<string, 'owner' | 'admin' | 'member'>): MembershipV1 => ({
	mode: 'provider',
	members: new Map(Object.entries(entries)),
	digest: 'd1',
});
const ACME = members({ [BEA]: 'member', [OLU]: 'owner' });

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

async function workspace(
	options: Parameters<typeof createScopedWorkspace>[0] = {}
): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace(options);
	kernels.push(made.kernel);
	return made;
}

/** A provider workspace with Atlas, Beacon and Citadel already in its store. */
async function providerWorkspace(
	extra: Parameters<typeof createScopedWorkspace>[0] = {}
): Promise<ScopedWorkspace> {
	const store = extra.store ?? new MemoryAdapter();
	await seedProjects(store);
	return workspace({ identity: PROVIDER, membership: ACME, store, empty: true, ...extra });
}

const signIn = (kernel: LoamKernelV3, who: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email: who, password: 'x' });

const journalOf = (made: ScopedWorkspace) => made.journal.read();
const ATLAS: ScopeV1 = { workspace: 'personal', project: 'prj_atlas' };

function agentMember(extra: Partial<AgentMemberV1> = {}): AgentMemberV1 {
	return {
		id: 'agt_aaaaaaaaaaaaaaaaaaaa',
		workspace: 'personal',
		kind: 'installed',
		name: 'Reviewer',
		sponsor: BEA,
		installedBy: OLU,
		access: { workspace: false, projects: ['prj_atlas'] },
		status: 'active',
		createdAt: 1,
		updatedAt: 1,
		updatedBy: OLU,
		...extra,
	};
}

describe('P3-E5: an agent member acts within its record and its sponsor, and cannot sign in (step 1)', () => {
	const atlas = SCOPED_PROJECTS[0] as ProjectV1;
	const restricted = { ...atlas, access: { mode: 'restricted', members: [OLU] } } as ProjectV1;
	const agent = (onBehalfOf = BEA): AccessActorV1 => ({
		kind: 'agent',
		id: 'agt_aaaaaaaaaaaaaaaaaaaa',
		onBehalfOf,
	});
	const decide = (
		record: AgentMemberV1 | undefined,
		scope: ScopeV1,
		project: ProjectV1 | undefined = scope.project ? atlas : undefined,
		actor = agent()
	) => decideAccess({ actor, scope, project, membership: ACME, agent: record });

	it('decides line 4 in every case: the record, its status, its sponsor and its access', () => {
		expect(decide(agentMember(), ATLAS)).toEqual({ allowed: true });
		// No record, or another's.
		expect(decide(undefined, ATLAS)).toEqual({ allowed: false, reason: 'project' });
		expect(decide(agentMember({ id: 'agt_bbbbbbbbbbbbbbbbbbbb' }), ATLAS).allowed).toBe(false);
		// Pending or suspended: allowed nothing.
		expect(decide(agentMember({ status: 'pending' }), ATLAS).allowed).toBe(false);
		expect(
			decide(agentMember({ status: 'suspended', suspended: 'sponsor-left' }), ATLAS).allowed
		).toBe(false);
		// `onBehalfOf` must be its sponsor, whoever else is a member.
		expect(decide(agentMember(), ATLAS, atlas, agent(OLU))).toEqual({
			allowed: false,
			reason: 'project',
		});
		// Workspace level needs `workspace: true`; a project, its id or `sponsor`.
		expect(decide(agentMember(), { workspace: 'personal' }).allowed).toBe(false);
		expect(
			decide(agentMember({ access: { workspace: true, projects: [] } }), { workspace: 'personal' })
				.allowed
		).toBe(true);
		expect(
			decide(
				agentMember(),
				{ workspace: 'personal', project: 'prj_beacon' },
				{
					...atlas,
					id: 'prj_beacon',
				}
			).allowed
		).toBe(false);
		expect(
			decide(agentMember({ access: { workspace: false, projects: 'sponsor' } }), ATLAS).allowed
		).toBe(true);
	});

	it('intersects with the sponsor: never more than the person it acts for', () => {
		// Its record lists Atlas, but Atlas is restricted to Olu: Bea, its sponsor, may not enter it.
		expect(decide(agentMember(), ATLAS, restricted)).toEqual({ allowed: false, reason: 'project' });
		expect(
			decide(agentMember({ access: { workspace: true, projects: 'sponsor' } }), ATLAS, restricted)
				.allowed
		).toBe(false);
		// A sponsor who is no longer a member: refused for the workspace.
		expect(
			decideAccess({
				actor: agent(),
				scope: ATLAS,
				project: atlas,
				membership: members({ [OLU]: 'owner' }),
				agent: agentMember(),
			})
		).toEqual({ allowed: false, reason: 'workspace' });
		// A human whose id were `agt_…` has no `onBehalfOf`, so line 4 refuses it too.
		expect(
			decideAccess({
				actor: { kind: 'human', id: 'agt_aaaaaaaaaaaaaaaaaaaa' },
				scope: ATLAS,
				project: atlas,
				membership: LOCAL_MEMBERSHIP,
				agent: agentMember(),
			}).allowed
		).toBe(false);
	});

	it('signs out an adapter whose user id starts `agt_`: AGENT_CANNOT_SIGN_IN', async () => {
		const mock = new MockAuthAdapter();
		let forged = false;
		const auth: AuthAdapter = {
			getSession: (): AuthSessionState =>
				forged
					? {
							status: 'authenticated',
							user: { id: 'agt_aaaaaaaaaaaaaaaaaaaa', email: 'agent@example.com' },
							session: { id: 's', expiresAt: new Date(Date.now() + 60_000) },
						}
					: mock.getSession(),
			signIn: (options) => mock.signIn(options),
			async signOut() {
				forged = false;
				await mock.signOut();
			},
			onAuthStateChange: (listener) => mock.onAuthStateChange(listener),
		};
		const made = await workspace({ auth: auth as MockAuthAdapter, empty: true });
		forged = true;
		const refused = await made.kernel.call('project-list', {});
		expect(refused.error?.code).toBe('AGENT_CANNOT_SIGN_IN');
		expect(refused.error?.suggestion).toBeTruthy();
		expect(forged).toBe(false);
		// Signed out, the next call runs as `local`.
		expect((await made.kernel.call('project-list', {})).success).toBe(true);
	});

	it("takes the agent interface's name, refusing a reserved one or one off the pattern: AGENT_NAME_RESERVED", async () => {
		const made = await workspace();
		for (const agent of [
			'local',
			'signed-out',
			'shell-agent',
			'agt_aaaaaaaaaaaaaaaaaaaa',
			'Bad',
			'-x',
			'a'.repeat(65),
			'',
		]) {
			const result = await made.kernel.agent.call('scope-get', {}, { agent });
			expect(result.error?.code, agent).toBe('AGENT_NAME_RESERVED');
			expect(result.error?.suggestion).toBeTruthy();
		}
		// Not a string, though its text would fit the pattern (review N1).
		const numeric = await made.kernel.agent.call(
			'scope-get',
			{},
			{ agent: 123 as unknown as string }
		);
		expect(numeric.error?.code).toBe('AGENT_NAME_RESERVED');
		const named = await made.kernel.agent.call('project-list', {}, { agent: 'helper-2' });
		expect(named.success).toBe(true);
		expect((await journalOf(made)).at(-1)?.actor).toEqual({ kind: 'agent', id: 'helper-2' });
	});
});

describe('P3-E6: owners and members (step 1)', () => {
	it('reads an owner from the role alone: `owner` and `admin` (D96), and every actor in `local`', () => {
		expect(isOwner(ACME, OLU)).toBe(true);
		expect(isOwner(members({ [BEA]: 'admin' }), BEA)).toBe(true);
		expect(isOwner(ACME, BEA)).toBe(false);
		expect(isOwner(ACME, CARO)).toBe(false);
		expect(isOwner(ACME, undefined)).toBe(false);
		expect(isOwner(LOCAL_MEMBERSHIP, undefined)).toBe(true);
		expect(isOwner(LOCAL_MEMBERSHIP, 'anyone')).toBe(true);
	});

	it("decides for the person a call is for: a human, or an agent's `onBehalfOf` (3.1)", () => {
		expect(personKey({ kind: 'human', id: BEA })).toBe(BEA);
		expect(personKey({ kind: 'agent', id: 'shell-agent', onBehalfOf: BEA })).toBe(BEA);
		expect(personKey({ kind: 'agent', id: 'shell-agent' })).toBeUndefined();
		expect(personKey({ kind: 'service', id: 'x', onBehalfOf: BEA })).toBeUndefined();
		expect(personKey(undefined)).toBeUndefined();
		expect(personOf({ actor: undefined })).toBe(LOCAL_ACTOR);
		expect(personOf({ actor: { kind: 'agent', id: 'shell-agent', onBehalfOf: BEA } })).toBe(BEA);
	});
});

describe("P3-E7: line 0, the gate's lists and the actor on every path (step 1)", () => {
	it('holds the lists: each signed-out command registered; the internal and settle commands exempt', async () => {
		for (const name of SIGNED_OUT_COMMANDS) expect(SHELL_COMMAND_NAMES).toContain(name);
		for (const name of [
			...SIGNED_OUT_COMMANDS,
			...MEMBER_EXEMPT_COMMANDS,
			...INTERNAL_COMMANDS,
			...KERNEL_SETTLE_COMMANDS,
		]) {
			expect(gatedByLineZero(name), name).toBe(false);
		}
		// Every other registered command is gated: the shell's and an app's.
		const made = await workspace();
		const gated = made.kernel.listCommands().filter((command) => gatedByLineZero(command.name));
		expect(gated.map((command) => command.name)).toEqual(
			expect.arrayContaining(['project-list', 'scope-set', 'document-list', 'dual-where'])
		);
		for (const command of gated) {
			expect(SIGNED_OUT_COMMANDS as readonly string[]).not.toContain(command.name);
		}
	});

	it('refuses every gated command for a non-member before anything else, with each refusal its own', async () => {
		const made = await workspace();
		const names = [
			...made.registries.palette.listCommands().map(({ name }) => name),
			...INTERNAL_COMMANDS,
		];
		const runtime = createScopeRuntime({ id: 'personal', name: 'Personal' }, ACME);
		const ran: string[] = [];
		const late = {
			before: (call: CommandContext, name: string) => lineZero(runtime, call, name),
			run: (_name: string, _input: unknown, _call: unknown, next: () => Promise<CommandResult>) =>
				next(),
		} as unknown as LateScope;
		const middleware = createScopeMiddleware({ scope: runtime, late: () => late });
		const call = async (name: string, actor: AccessActorV1) => {
			const context = { traceId: name, ...(actor ? { actor } : {}) } as CommandContext;
			return middleware(name, {}, context, async () => {
				ran.push(name);
				return { success: true };
			});
		};
		for (const name of names) {
			ran.length = 0;
			const caro = await call(name, { kind: 'human', id: CARO });
			const agentless = await call(name, { kind: 'agent', id: 'shell-agent' });
			const signedOut = await call(name, undefined);
			const bea = await call(name, { kind: 'agent', id: 'shell-agent', onBehalfOf: BEA });
			expect(bea.success, name).toBe(true);
			if (!gatedByLineZero(name)) {
				expect(
					[caro, agentless, signedOut].every((result) => result.success),
					name
				).toBe(true);
				continue;
			}
			expect(caro.error?.code, name).toBe('WORKSPACE_NOT_MEMBER');
			expect(caro.error?.message).toBe('You are not a member of this workspace');
			expect(agentless.error?.code).toBe('WORKSPACE_NOT_MEMBER');
			expect(agentless.error?.message).toBe('This agent acts for no member of the workspace');
			expect(signedOut.error?.code).toBe('UNAUTHORIZED');
			expect(ran).toEqual([name]);
		}
	});

	it("journals line 0's refusal in a provider workspace; a member passes; `local` gates nobody", async () => {
		const made = await providerWorkspace();
		const { kernel } = made;
		// Signed out, the gate refuses before the journal, as afd-auth always has.
		expect((await kernel.call('project-list', {})).error?.code).toBe('UNAUTHORIZED');
		// The signed-out commands run with no session.
		expect((await kernel.call('scope-get', {})).success).toBe(true);
		expect((await kernel.call('shell-info-get', {})).data).toMatchObject({
			kernelInterface: 3,
			identity: { mode: 'provider', organization: 'acme' },
		});
		// Signed out, `workspace-get` names the workspace and no person: its `updatedBy` would (review I7).
		expect((await kernel.call('workspace-get', {})).data).toEqual({
			id: 'personal',
			name: 'Personal',
		});
		await signIn(kernel, 'caro@example.com');
		const refused = await kernel.call('project-list', {});
		expect(refused.error?.code).toBe('WORKSPACE_NOT_MEMBER');
		const entry = (await journalOf(made)).at(-1) as JournalEntry;
		expect([entry.command, entry.actor?.id, entry.context?.scope]).toEqual([
			'project-list',
			CARO,
			{ workspace: 'personal' },
		]);
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		expect((await kernel.call<ProjectV1[]>('project-list', {})).success).toBe(true);
		expect((await kernel.call('workspace-get', {})).data).toMatchObject({
			id: 'personal',
			generation: expect.any(String),
		});
		// Its agent too, for Bea.
		expect((await kernel.agent.call('project-list', {})).success).toBe(true);
		expect((await journalOf(made)).at(-1)?.actor).toEqual({
			kind: 'agent',
			id: 'shell-agent',
			onBehalfOf: BEA,
		});
		// A `local` kernel given a provider membership ignores it: every actor is a member there.
		const local = await workspace({ membership: ACME });
		await signIn(local.kernel, 'caro@example.com');
		expect((await local.kernel.call('project-list', {})).success).toBe(true);
	});

	it("registers a host's own commands only with `late/` in `provider` mode, where the gate decides them (review I8)", async () => {
		const ping = defineCommandWithSchema({
			name: 'host-ping',
			description: 'A host command',
			mutation: false,
			input: z.strictObject({}),
			jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
			handler: async () => success({ pong: true }),
		}) as unknown as ZodCommandDefinition;
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			identity: PROVIDER,
			membership: ACME,
			commands: [ping],
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		kernels.push(kernel);
		// Stage A does not hold it, so no call of it runs past a gate that lets through what it holds.
		expect(kernel.listCommands().map(({ name }) => name)).not.toContain('host-ping');
		// Signed out it waits for stage B, then the gate refuses it; a member passes line 0.
		expect((await kernel.call('host-ping', {})).error?.code).toBe('UNAUTHORIZED');
		await signIn(kernel, 'caro@example.com');
		expect((await kernel.call('host-ping', {})).error?.code).toBe('WORKSPACE_NOT_MEMBER');
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		expect(await kernel.call('host-ping', {})).toMatchObject({
			success: true,
			data: { pong: true },
		});
	});

	it('makes an agent call wait for stage B, whose `late/` names its agent (3.1, 13)', async () => {
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		kernels.push(kernel);
		// Stage A holds `layout-get`: the person's call runs now, before any late command exists.
		expect((await kernel.call('layout-get')).success).toBe(true);
		expect(kernel.listCommands().map(({ name }) => name)).not.toContain('scope-set');
		// The agent's call of the same name starts stage B and runs once `late/` has loaded.
		expect((await kernel.agent.call('layout-get', {}, { agent: 'helper' })).success).toBe(true);
		expect(kernel.listCommands().map(({ name }) => name)).toContain('scope-set');
		expect((await journal.read()).at(-1)?.actor).toEqual({ kind: 'agent', id: 'helper' });
	});

	it("replays a `provider` journal, line 0 deciding on the journal's actor (review I9)", async () => {
		// Everything the replay needs is in the journal: the store starts empty.
		const made = await workspace({ identity: PROVIDER, membership: ACME, empty: true });
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('project-create', { name: 'Atlas' })).success).toBe(true);
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'caro@example.com');
		expect((await made.kernel.call('project-list', {})).error?.code).toBe('WORKSPACE_NOT_MEMBER');
		await made.kernel.call('auth-sign-out');
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('project-list', {})).success).toBe(true);
		const { report } = await replayKernel(await journalOf(made), {
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			identity: PROVIDER,
			membership: ACME,
		});
		expect(report.diverged).toBe(false);
		// The journal's actor is restored before line 0: the replay's Mock is Caro, the entry Bea's.
		const parts = await createScopedWorkspace({
			identity: PROVIDER,
			membership: ACME,
			store: await (async () => {
				const store = new MemoryAdapter();
				await seedProjects(store);
				return store;
			})(),
			empty: true,
			internals: { actorOf: () => ({ actor: { kind: 'human', id: BEA } }) },
		});
		kernels.push(parts.kernel);
		await signIn(parts.kernel, 'caro@example.com');
		expect((await parts.kernel.call('project-list', {})).success).toBe(true);
	});

	it("runs the agent interface as an agent, the session's person in its onBehalfOf (3.1)", async () => {
		const made = await workspace();
		await made.kernel.agent.call('scope-get', {});
		expect((await made.kernel.agent.call('project-list', {})).success).toBe(true);
		expect((await journalOf(made)).at(-1)?.actor).toEqual({ kind: 'agent', id: 'shell-agent' });
		await signIn(made.kernel, 'bea@example.com');
		await made.kernel.agent.call('project-list', {});
		expect((await journalOf(made)).at(-1)?.actor).toEqual({
			kind: 'agent',
			id: 'shell-agent',
			onBehalfOf: BEA,
		});
	});

	it("copies the outer actor onto a nested call and a port's refusal, and a surface port is the person's", async () => {
		const made = await workspace();
		await signIn(made.kernel, 'bea@example.com');
		const agent = { kind: 'agent', id: 'shell-agent', onBehalfOf: BEA };
		expect((await made.kernel.agent.call('dual-nested', {})).success).toBe(true);
		const nested = (await journalOf(made)).filter((entry) => entry.context?.parent !== undefined);
		expect(nested.map((entry) => [entry.command, entry.actor])).toEqual([
			['dual-where', agent],
			['dual-where', agent],
		]);
		// A nested call naming a scope is refused by the port, journaled as the same agent.
		await made.kernel.agent.call('dual-reach', {});
		expect(
			(await journalOf(made)).find((entry) => entry.command === 'app-scope-refuse')?.actor
		).toEqual(agent);
		// The person's own call nests as the person.
		await made.kernel.call('dual-nested', {});
		expect((await journalOf(made)).at(-2)?.actor).toMatchObject({ kind: 'human', id: BEA });
		// A surface's port has no outer call: the session's person.
		const surface = made.kernel.appPort('dual').surface({ scope: { workspace: 'personal' } });
		await surface.call('dual-where');
		expect((await journalOf(made)).at(-1)?.actor).toMatchObject({ kind: 'human', id: BEA });
	});

	it("refuses an `agt_` actor's nested workspace read through a port, journaled as the agent", async () => {
		const store = new MemoryAdapter();
		await seedProjects(store);
		await store.create(AGENT_MEMBER_TABLE, agentMember());
		const made = await workspace({ store });
		await signIn(made.kernel, 'bea@example.com');
		const actor = { kind: 'agent' as const, id: 'agt_aaaaaaaaaaaaaaaaaaaa' };
		// Its own call, in Atlas, which its record allows; its nested read widens to the workspace.
		const outer = await made.registries.palette.execute<{ here: ScopeV1; wide?: ScopeV1 }>(
			'dual-nested',
			{},
			{ traceId: 'agt-outer', actor, scope: made.scopes.atlas } as CommandContext
		);
		expect(outer.success, JSON.stringify(outer)).toBe(true);
		expect(outer.data?.here).toEqual(made.scopes.atlas);
		expect(outer.data?.wide).toBeUndefined();
		const nested = (await journalOf(made)).filter((entry) => entry.context?.parent === 'agt-outer');
		const named = { ...actor, onBehalfOf: BEA };
		expect(
			nested.map((entry) => [entry.actor, entry.context?.scope, entry.result.error?.code ?? null])
		).toEqual([
			[named, made.scopes.atlas, null],
			[named, { workspace: 'personal' }, 'PROJECT_NOT_FOUND'],
		]);
		// Out of its record's projects, or once the record is no longer active, the outer call is refused.
		const beacon = await made.registries.palette.execute('dual-where', {}, {
			traceId: 'agt-beacon',
			actor,
			scope: made.scopes.beacon,
		} as CommandContext);
		expect(beacon.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it("keeps a person's view-state records per person in `provider` mode, and `local` keeps phase 2's ids", async () => {
		const store = new MemoryAdapter();
		const made = await providerWorkspace({ store });
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('scope-set', { project: 'atlas' })).success).toBe(true);
		await made.kernel.flush();
		const ids = (await store.list<{ id: string }>('settings')).data.map((row) => row.id);
		expect(ids).toContain(personalRecordId('loam.scope', BEA));
		expect(ids).not.toContain('loam.scope');
		const local = await workspace();
		await local.kernel.call('scope-set', { project: 'atlas' });
		await local.kernel.flush();
		expect(
			(await local.store.list<{ id: string }>('settings')).data.map((row) => row.id)
		).toContain('loam.scope');
	});
});

describe('personalRecordId and the personal store (phase 3 specification, 4.5)', () => {
	it('suffixes a person, or `signed-out`', () => {
		expect(personalRecordId('loam.persona', BEA)).toBe(`loam.persona~${BEA}`);
		expect(personalRecordId('loam.layout.~projects@prj_a', undefined)).toBe(
			'loam.layout.~projects@prj_a~signed-out'
		);
	});

	it("reads and lists only the person's own rows, under their own ids", async () => {
		const store = new MemoryAdapter();
		let person: string | undefined = BEA;
		const mine = personalStore(store, () => person);
		// First paint's store reads only: stage B attaches the writes (13).
		expect(mine.create).toBeUndefined();
		personalWrites(mine, store, new ViewStateRegistry());
		await mine.create('settings', { id: 'loam.scope', value: 'bea' });
		await mine.create('settings', { id: 'loam.layout.~projects', value: 'bea' });
		await mine.create('settings', { id: 'loam.appearance', value: 'profile' });
		person = OLU;
		await mine.create('settings', { id: 'loam.scope', value: 'olu' });
		// A `local` deployment's row, unsuffixed, is nobody's here.
		await store.create('settings', { id: 'loam.apps', value: 'local' });
		const listed = (await mine.list<{ id: string; value: string }>('settings')).data;
		expect(listed.map((row) => [row.id, row.value]).sort()).toEqual([
			['loam.appearance', 'profile'],
			['loam.scope', 'olu'],
		]);
		person = BEA;
		expect(await mine.get<{ value: string }>('settings', 'loam.scope')).toMatchObject({
			id: 'loam.scope',
			value: 'bea',
		});
		await mine.update('settings', 'loam.scope', { value: 'bea 2' });
		expect(await store.get('settings', `loam.scope~${BEA}`)).toMatchObject({ value: 'bea 2' });
		await mine.remove('settings', 'loam.layout.~projects');
		expect(await store.get('settings', `loam.layout.~projects~${BEA}`)).toBeNull();
	});
});

describe("a person's pending write (the step 1 review's I1)", () => {
	it('is stored under the person who made it, though the person changes before the flush', async () => {
		const store = new MemoryAdapter();
		let person = BEA;
		const personal = personalStore(store, () => person);
		const registry = new ViewStateRegistry({ adapter: personal });
		personalWrites(personal, store, registry);
		let state: Record<string, unknown> = { project: null };
		registry.register('loam.scope', {
			get: () => state,
			set: (partial) => {
				state = { ...state, ...partial };
			},
		});
		// Bea's change, debounced 300 ms; the person changes within it, then the write is flushed.
		registry.set('loam.scope', { project: 'prj_bea' });
		person = OLU;
		await registry.flush();
		const rows = (await store.list<{ id: string; value: { project: string } }>('settings')).data;
		expect(rows.map((row) => [row.id, row.value.project])).toEqual([
			[personalRecordId('loam.scope', BEA), 'prj_bea'],
		]);
		// Olu's own change goes under Olu.
		registry.set('loam.scope', { project: 'prj_olu' });
		await registry.flush();
		expect(await store.get('settings', personalRecordId('loam.scope', OLU))).toMatchObject({
			value: { project: 'prj_olu' },
		});
	});

	it('is written before a sign-in or sign-out changes the person', async () => {
		const made = await providerWorkspace();
		await signIn(made.kernel, 'bea@example.com');
		expect((await made.kernel.call('scope-set', { project: 'atlas' })).success).toBe(true);
		// No flush: the sign-out's own flush writes Bea's pending change as Bea's.
		await made.kernel.call('auth-sign-out');
		const ids = (await made.store.list<{ id: string }>('settings')).data.map((row) => row.id);
		expect(ids).toContain(personalRecordId('loam.scope', BEA));
	});
});

describe('the persona and agent-member tables (phase 3 specification, 12)', () => {
	let databases = 0;
	const adapters: Array<[string, () => DataAdapter]> = [
		['MemoryAdapter', () => new MemoryAdapter()],
		[
			'IndexedDbAdapter',
			() =>
				new IndexedDbAdapter({ name: `loam-identity-${++databases}`, indexedDB: new IDBFactory() }),
		],
	];
	const persona = (id: string, person: string): PersonaV1 => ({
		id,
		workspace: 'personal',
		person,
		title: 'Reviewer',
		presentation: {},
		defaults: {},
		emphasis: {},
		createdAt: 1,
		updatedAt: 1,
		updatedBy: person,
	});

	it.each(adapters)('keeps and lists rows by person and by sponsor on %s', async (_name, make) => {
		const store = make();
		await store.create(PERSONA_TABLE, persona('per_aaaaaaaaaaaaaaaa', BEA));
		await store.create(PERSONA_TABLE, persona('per_bbbbbbbbbbbbbbbb', OLU));
		await store.create(AGENT_MEMBER_TABLE, agentMember());
		await store.create(
			AGENT_MEMBER_TABLE,
			agentMember({ id: 'agt_bbbbbbbbbbbbbbbbbbbb', sponsor: OLU })
		);
		const bea = await store.list<PersonaV1>(PERSONA_TABLE, { person: BEA } as never);
		expect(bea.data.map((row) => row.id)).toEqual(['per_aaaaaaaaaaaaaaaa']);
		const sponsored = await store.list<AgentMemberV1>(AGENT_MEMBER_TABLE, {
			sponsor: OLU,
		} as never);
		expect(sponsored.data.map((row) => row.id)).toEqual(['agt_bbbbbbbbbbbbbbbbbbbb']);
		expect(
			await store.get<AgentMemberV1>(AGENT_MEMBER_TABLE, 'agt_aaaaaaaaaaaaaaaaaaaa')
		).toMatchObject({
			sponsor: BEA,
			status: 'active',
		});
	});
});
