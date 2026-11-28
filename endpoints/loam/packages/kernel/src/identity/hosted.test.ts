/**
 * P6-E4 and the browser's half of P6-E3 (phase 6 specification, 6.1, 6.3, 6.4, A5 and A6; step 5): the browser's
 * routing and copy, over a fake `serverCall` that holds the server's records. Each routed write reaches the server and
 * writes nothing in the browser; the copy changes only through `trust-record-settle`, journaled with its input, run
 * top-level at boot, after a call whose generation differs, on a refresh and after a change of person; it writes only
 * installed agent members; a copy too large is refused and left as it was; the agent interface's writes are
 * `HUMAN_REQUIRED`; and a replay of the journal has no difference, reads the host from its apply entry, and makes no call.
 * In every other deployment kind and mode, each command runs its phase 3 handler.
 */

import { readFileSync } from 'node:fs';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandResult, JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernelParts, type KernelParts } from '../kernel.js';
import { SCOPED_PROJECTS, scopedDeployment, scopedPorts } from '../scope/fixtures.js';
import type { ProjectV1, WorkspaceAppV1 } from '../scope/records.js';
import { PROJECT_TABLE, WORKSPACE_APP_TABLE } from '../scope/records.js';
import { AGENT_MEMBER_TABLE } from '../scope/tables.js';
import { createFixedEnvironment, createSeededRandom, createSteppingClock } from '../session.js';
import { replayKernel } from '../testing.js';
import {
	canonicalJson,
	ROUTED_WRITES,
	SERVER_COMMANDS,
	type ServerCallAnswerV1,
	type ServerCallRequestV1,
	TRUST_RECORDS_MAX_BYTES,
	type TrustRecordSnapshotV1,
} from '../trust-records.js';
import { COPY_TABLES } from './hosted.js';

const OLU = 'mock-user-olu@example.com';
const BEA = 'mock-user-bea@example.com';
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey'],
};
const HOSTED = () =>
	({ ...scopedDeployment(), deployment_version: 4, host: { kind: 'hosted' } }) as never;

const atlas = SCOPED_PROJECTS[0] as ProjectV1;
const restricted: ProjectV1 = {
	...atlas,
	id: 'prj_vault',
	slug: 'vault',
	name: 'Vault',
	access: { mode: 'restricted', members: [OLU] },
};

/** The server's records, and what `trust-record-snapshot` answers each person: the restricted project to Olu alone. */
function fakeServer() {
	const projects: ProjectV1[] = [atlas, restricted];
	const agents = [
		// An installed agent as the server's filter (phase 3's 8.2) answers it to Olu: the copy stores it whole.
		{
			id: 'agt_aaaaaaaaaaaaaaaaaaaa',
			kind: 'installed',
			name: 'A',
			sponsor: OLU,
			sponsorName: 'Olu',
			installedBy: OLU,
			access: { workspace: true, projects: ['prj_atlas'] },
			hiddenProjects: 1,
			guidance: 'Be brief',
			status: 'active',
			createdAt: 1,
			updatedAt: 2,
			updatedBy: OLU,
			warnings: [],
		},
		{
			id: 'agt_bbbbbbbbbbbbbbbbbbbb',
			kind: 'connected',
			sponsor: OLU,
			status: 'active',
			name: 'B',
		},
	];
	// The workspace's apps as the server holds them: a case changes them to see the copy's table replaced.
	const workspaceApps: WorkspaceAppV1[] = [];
	const calls: ServerCallRequestV1[] = [];
	let person = OLU;
	let answer: ((request: ServerCallRequestV1) => ServerCallAnswerV1 | undefined) | undefined;
	const snapshot = (): TrustRecordSnapshotV1 => {
		const seen = {
			projects: projects.filter(
				(project) => project.access.mode !== 'restricted' || project.access.members.includes(person)
			),
			workspaceApps: structuredClone(workspaceApps),
			// A copy, so a kernel that changed a stored row in place cannot still match the server's own object.
			agents: structuredClone(agents) as TrustRecordSnapshotV1['agents'],
		};
		return { generation: `g:${canonicalJson(seen).length}:${person}`, ...seen };
	};
	return {
		projects,
		agents,
		workspaceApps,
		calls,
		as(next: string) {
			person = next;
		},
		answerWith(fn: typeof answer) {
			answer = fn;
		},
		async serverCall(request: ServerCallRequestV1): Promise<ServerCallAnswerV1> {
			calls.push(request);
			const given = answer?.(request);
			if (given) return given;
			if (request.command === 'trust-record-snapshot')
				return { result: { success: true, data: snapshot() }, generation: snapshot().generation };
			if (request.command === 'project-create') {
				const name = (request.input as { name: string }).name;
				const made = { ...atlas, id: `prj_${name.toLowerCase()}`, slug: name.toLowerCase(), name };
				projects.push(made);
				return { result: { success: true, data: made }, generation: snapshot().generation };
			}
			return { result: { success: true, data: {} }, generation: snapshot().generation };
		},
	};
}

const made: KernelParts[] = [];
afterEach(async () => {
	await Promise.all(made.splice(0).map((parts) => parts.kernel.dispose()));
});

async function hostedKernel(
	options: {
		server?: ReturnType<typeof fakeServer>;
		identity?: IdentityV1;
		deployment?: unknown;
		port?: boolean;
		/** Bea a member too, for a case that reads as her. */
		withBea?: boolean;
		/** The provider's members as its account capability answers them (phase 3's 9.2), for the sponsor rules. */
		roster?: boolean;
	} = {}
) {
	const server = options.server ?? fakeServer();
	const clock = createSteppingClock();
	const auth = new MockAuthAdapter({ clock: { now: clock } });
	if (options.roster) {
		const people = [
			{ id: OLU, memberId: 'm-olu', name: 'Olu', image: null, role: 'owner', digest: 'd-olu' },
			{ id: BEA, memberId: 'm-bea', name: 'Bea', image: null, role: 'member', digest: 'd-bea' },
		];
		Object.assign(auth, {
			account: { members: async () => ({ people: [...people], total: people.length }) },
		});
	}
	await auth.signIn({ method: 'credentials', email: 'olu@example.com', password: 'x' });
	const store = new MemoryAdapter();
	// Every write the kernel makes to its store, by table: `create`, `update`, `remove`, and each of a batch's writes.
	const writes: string[] = [];
	const recorded = new Proxy(store, {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (typeof value !== 'function') return value;
			return (...args: unknown[]) => {
				if (key === 'create' || key === 'update' || key === 'remove') writes.push(String(args[0]));
				if (key === 'batch')
					for (const op of args[0] as Array<{ method: string; path: string }>)
						if (op.method !== 'GET') writes.push(op.path.replace(/^\//, '').split('/')[0] ?? '');
				return value.apply(target, args);
			};
		},
	});
	const journal = new MemoryJournalSink();
	const watchers = new Set<() => void>();
	const identity = options.identity ?? PROVIDER;
	const parts = await createKernelParts({
		store: recorded,
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		clock,
		random: createSeededRandom('hosted'),
		deployment: (options.deployment ?? HOSTED()) as never,
		ports: {
			...scopedPorts(),
			...(options.port === false
				? {}
				: { serverCall: (request: ServerCallRequestV1) => server.serverCall(request) }),
			watchMembership(listener: () => void) {
				watchers.add(listener);
				return () => watchers.delete(listener);
			},
		},
		identity,
		...(identity.mode === 'provider'
			? {
					membership: {
						mode: 'provider',
						members: new Map<string, 'owner' | 'member'>([
							[OLU, 'owner'],
							...(options.withBea ? [[BEA, 'member'] as [string, 'member']] : []),
						]),
						digest: 'd',
					},
				}
			: {}),
	});
	made.push(parts);
	// The follow chain settles before the next call: a cheap call waits for it.
	// Each wait's own trace, so a comparison can leave out exactly the test's waits and nothing the kernel journaled.
	const waits = new Set<string>();
	const settled = async () => {
		const answer = await parts.kernel.call('shell-info-get');
		const trace = answer.metadata?.traceId;
		if (typeof trace === 'string') waits.add(trace);
		return answer;
	};
	const refresh = async () => {
		for (const watcher of watchers) watcher();
		await settled();
	};
	return { parts, server, store, journal, auth, settled, refresh, waits, writes };
}

const entries = (journal: MemoryJournalSink) => journal.read() as Promise<JournalEntry[]>;
const tableIds = async (store: MemoryAdapter, table: string) =>
	(await store.list<{ id: string }>(table)).data.map((row) => row.id).sort();

describe('P6-E4: the browser routes the trust-record commands and keeps a copy (6.1, 6.3)', () => {
	it('settles the copy at boot, journaled with its input, after the first session-settle', async () => {
		const { journal, store, settled } = await hostedKernel();
		await settled();
		const all = await entries(journal);
		const settle = all.find((entry) => entry.command === 'trust-record-settle');
		expect(settle?.input).toMatchObject({
			reason: 'boot',
			snapshot: { generation: expect.any(String) },
		});
		const first = all.findIndex((entry) => entry.command === 'session-settle');
		expect(first).toBeGreaterThanOrEqual(0);
		expect(all.indexOf(settle as JournalEntry)).toBeGreaterThan(first);
		expect(await tableIds(store, 'project')).toEqual(['prj_atlas', 'prj_vault']);
		// Installed agents alone in the table; a connected one is the provider's (its 9.2).
		expect(await tableIds(store, AGENT_MEMBER_TABLE)).toEqual(['agt_aaaaaaaaaaaaaaaaaaaa']);
	});

	it('P6-E4: runs each settle top-level, for all four reasons, and stores the installed agent as the filtered row, whole', async () => {
		const { parts, server, store, journal, auth, settled, refresh } = await hostedKernel({
			withBea: true,
		});
		await settled();
		// What the server's filter answered for Olu, stored as it is: no field added, dropped or changed (6.3).
		const filtered = server.agents.find((agent) => agent.kind === 'installed');
		const rows = (await store.list<Record<string, unknown>>(AGENT_MEMBER_TABLE)).data;
		expect(rows).toStrictEqual([filtered]);
		// `call`: a routed write whose generation differs; `refresh`: the host's periodic read, the records changed.
		await parts.kernel.call('project-create', { name: 'Delta' });
		await settled();
		server.projects.push({ ...atlas, id: 'prj_gale', slug: 'gale', name: 'Gale' });
		await refresh();
		// `session`: a change of person, signing out and then in as Bea.
		await parts.kernel.call('auth-sign-out');
		await settled();
		server.as(BEA);
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		await settled();
		await settled();
		const all = await entries(journal);
		const settles = all.filter((entry) => entry.command === 'trust-record-settle');
		const reasons = settles.map((entry) => (entry.input as { reason: string }).reason);
		expect([...new Set(reasons)].sort()).toEqual(['boot', 'call', 'refresh', 'session']);
		for (const settle of settles) {
			// Top-level: no outer call's trace (the kernel's `dev.loam/parent`), and a trace of its own.
			expect(settle.context?.parent).toBeUndefined();
			expect(settle.traceId).toEqual(expect.any(String));
		}
		expect(new Set(settles.map((settle) => settle.traceId)).size).toBe(settles.length);
		// The call's settle follows the call's own entry, as its own run, not inside it.
		const call = all.find((entry) => entry.command === 'project-create') as JournalEntry;
		const afterCall = settles[reasons.indexOf('call')] as JournalEntry;
		expect(afterCall.seq).toBeGreaterThan(call.seq);
		expect(afterCall.traceId).not.toBe(call.traceId);
		// Each `session` settle follows the change of person journaled since the settle before it: the sign-out's own
		// entry, and for Bea's sign-in the `session-settle` that names her (6.3).
		const changes = settles.flatMap((settle, at) => {
			if (reasons[at] !== 'session') return [];
			const since = at === 0 ? 0 : (settles[at - 1] as JournalEntry).seq;
			return [
				all
					.filter((entry) => entry.seq > since && entry.seq < settle.seq)
					.filter((entry) => ['session-settle', 'auth-sign-out'].includes(entry.command))
					.map((entry) =>
						entry.command === 'session-settle'
							? `session-settle ${(entry.input as { person?: string }).person}`
							: entry.command
					),
			];
		});
		expect(changes).toEqual([['auth-sign-out'], [`session-settle ${BEA}`]]);
	});

	it('P6-E4: P6-E3: routes a write to the server, writes nothing itself, and settles once the generation differs', async () => {
		const { parts, server, store, journal, settled } = await hostedKernel();
		await settled();
		const before = await tableIds(store, 'project');
		// An answer with the copy's own generation: nothing follows it, so what the store holds is what the call wrote.
		const boot = (await entries(journal)).find((entry) => entry.command === 'trust-record-settle');
		const stale = (boot?.input as { snapshot: { generation: string } } | undefined)?.snapshot
			.generation;
		server.answerWith((request) =>
			request.command === 'project-update'
				? { result: { success: true, data: { ...atlas, name: 'Atlas 2' } }, generation: stale }
				: undefined
		);
		const updated = await parts.kernel.call('project-update', {
			project: 'atlas',
			name: 'Atlas 2',
		});
		expect(updated.success).toBe(true);
		await settled();
		expect((await store.get<ProjectV1>('project', 'prj_atlas'))?.name).toBe(atlas.name);
		server.answerWith(undefined);
		const created = await parts.kernel.call<ProjectV1>('project-create', { name: 'Delta' });
		expect(created.success).toBe(true);
		const sent = server.calls.find((call) => call.command === 'project-create');
		expect(sent).toEqual({
			command: 'project-create',
			input: { name: 'Delta' },
			scope: { workspace: 'personal' },
			person: OLU,
		});
		// The row arrives with the settle that follows the call's entry, which differs in its generation.
		await settled();
		expect(before).toEqual(['prj_atlas', 'prj_vault']);
		expect(await tableIds(store, 'project')).toEqual(['prj_atlas', 'prj_delta', 'prj_vault']);
		const reasons = (await entries(journal))
			.filter((entry) => entry.command === 'trust-record-settle')
			.map((entry) => (entry.input as { reason: string }).reason);
		expect(reasons).toEqual(['boot', 'call']);
	});

	it('writes nothing for any routed write whose answer is a refusal, or the server unavailable', async () => {
		const { parts, server, store, settled } = await hostedKernel();
		await settled();
		const before = await tableIds(store, 'project');
		server.answerWith(() => ({
			result: {
				success: false,
				error: {
					code: 'SERVER_UNAVAILABLE',
					message: 'x',
					suggestion: 'Try again',
					retryable: true,
				},
			},
		}));
		for (const [name, input] of [
			['project-create', { name: 'Echo' }],
			['project-update', { project: 'atlas', name: 'Atlas 2' }],
			['project-archive', { project: 'atlas' }],
			['workspace-app-set', { instance: 'tasks', enabled: false }],
			['agent-member-add', { name: 'X', sponsor: OLU }],
		] as const) {
			const result = (await parts.kernel.call(name, input)) as CommandResult;
			expect(result.error?.code, name).toBe('SERVER_UNAVAILABLE');
		}
		await settled();
		expect(await tableIds(store, 'project')).toEqual(before);
		expect(
			(await parts.kernel.call<ProjectV1>('project-get', { project: 'atlas' })).data?.name
		).toBe(atlas.name);
	});

	it("refuses the agent interface's routed writes HUMAN_REQUIRED before any request, and answers its reads (A6)", async () => {
		const { parts, server, settled } = await hostedKernel();
		await settled();
		const sent = server.calls.length;
		const write = await parts.kernel.agent.call('project-create', { name: 'Fox' });
		expect(write.error?.code).toBe('HUMAN_REQUIRED');
		expect(server.calls.length).toBe(sent);
		const read = await parts.kernel.agent.call<{ projects: ProjectV1[] }>('project-list', {});
		expect(read.success).toBe(true);
	});

	it('P6-E4: refuses every routed write of the agent interface HUMAN_REQUIRED, before any request (A6)', async () => {
		const { parts, server, settled, writes } = await hostedKernel();
		await settled();
		const sent = server.calls.length;
		const written = writes.length;
		// Each with an input that validates. Phase 3's own gate refuses the owner's and person's commands first
		// (`workspace-app-set`, `agent-member-*`); A6 is what refuses the four `project-*` writes, by its own message.
		const agent = 'agt_aaaaaaaaaaaaaaaaaaaa';
		const inputs: Record<string, unknown> = {
			'project-create': { name: 'Fox' },
			'project-update': { project: 'atlas', name: 'Atlas 2' },
			'project-archive': { project: 'atlas' },
			'project-restore': { project: 'atlas' },
			'workspace-app-set': { instance: 'tasks', enabled: false },
			'agent-member-add': { name: 'X', sponsor: OLU },
			'agent-member-update': { agent, name: 'Y' },
			'agent-member-confirm': { agent },
			'agent-member-decline': { agent },
			'agent-member-withdraw': { agent },
			'agent-member-remove': { agent },
		};
		expect(Object.keys(inputs).sort()).toEqual([...ROUTED_WRITES].sort());
		for (const command of ROUTED_WRITES) {
			const write = await parts.kernel.agent.call(command, inputs[command]);
			expect(write.error?.code, command).toBe('HUMAN_REQUIRED');
			if (command.startsWith('project-'))
				expect(write.error?.message, command).toBe(
					`In a hosted workspace '${command}' is a person's, made in the shell`
				);
		}
		expect(server.calls.length).toBe(sent);
		expect(writes.length).toBe(written);
	});

	it('P6-E4: a settle replaces the workspace-app table with the snapshot, as it does the other two', async () => {
		const { server, store, journal, refresh, settled } = await hostedKernel();
		await settled();
		const app = (id: string, title: string): WorkspaceAppV1 => ({
			id,
			workspace: 'personal',
			app: 'hello',
			package: '@lushly-dev/loam-hello',
			overrides: { title },
			listed: 'g1',
			updatedAt: 1,
			updatedBy: OLU,
		});
		server.workspaceApps.push(app('hello', 'One'), app('greeter', 'Two'));
		await refresh();
		expect(await tableIds(store, WORKSPACE_APP_TABLE)).toEqual(['greeter', 'hello']);
		// The server's records change: one row gone, one changed. The copy holds exactly the new snapshot's.
		server.workspaceApps.splice(0, 2, app('hello', 'Three'));
		await refresh();
		const rows = (await store.list<WorkspaceAppV1>(WORKSPACE_APP_TABLE)).data;
		expect(rows).toStrictEqual([app('hello', 'Three')]);
		const settles = (await entries(journal)).filter(
			(entry) => entry.command === 'trust-record-settle'
		);
		expect(
			((settles.at(-1) as JournalEntry).input as { snapshot: TrustRecordSnapshotV1 }).snapshot
				.workspaceApps
		).toStrictEqual([app('hello', 'Three')]);
	});

	it('settles again after a change of person, so one copy never serves another (6.3)', async () => {
		const { parts, server, store, journal, auth, settled } = await hostedKernel();
		await settled();
		expect(await tableIds(store, 'project')).toContain('prj_vault');
		await parts.kernel.call('auth-sign-out');
		await settled();
		// Signed out, the copy holds nobody's records.
		expect(await tableIds(store, 'project')).toEqual([]);
		server.as(BEA);
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		await settled();
		await settled();
		expect(await tableIds(store, 'project')).toEqual(['prj_atlas']);
		const reasons = (await entries(journal))
			.filter((entry) => entry.command === 'trust-record-settle')
			.map((entry) => (entry.input as { reason: string }).reason);
		expect(reasons.filter((reason) => reason === 'session').length).toBeGreaterThanOrEqual(2);
	});

	it('refreshes on the host’s periodic read, settling only when the generation differs', async () => {
		const { server, journal, settled, refresh } = await hostedKernel();
		await settled();
		const count = async () =>
			(await entries(journal)).filter((entry) => entry.command === 'trust-record-settle').length;
		const at = await count();
		await refresh();
		expect(await count()).toBe(at);
		server.projects.push({ ...atlas, id: 'prj_gale', slug: 'gale', name: 'Gale' });
		await refresh();
		expect(await count()).toBe(at + 1);
	});

	it('leaves the active project when a settle takes it out of the copy', async () => {
		const { parts, server, settled, refresh } = await hostedKernel();
		await settled();
		await parts.kernel.call('scope-set', { project: 'vault' });
		const active = async () =>
			(await parts.kernel.call<{ project?: { id: string } }>('scope-get')).data?.project?.id;
		expect(await active()).toBe('prj_vault');
		server.projects.splice(server.projects.indexOf(restricted), 1);
		await refresh();
		expect(await active()).toBeUndefined();
	});

	it('refuses a snapshot over 2 MiB TRUST_RECORDS_TOO_LARGE, journaled, and keeps the copy', async () => {
		const { server, store, journal, settled, refresh } = await hostedKernel();
		await settled();
		const before = await tableIds(store, 'project');
		const big = 'x'.repeat(TRUST_RECORDS_MAX_BYTES);
		server.answerWith((request) =>
			request.command === 'trust-record-snapshot'
				? {
						result: {
							success: true,
							data: {
								generation: 'big',
								projects: [{ ...atlas, id: 'prj_big', name: big }],
								workspaceApps: [],
								agents: [],
							},
						},
					}
				: undefined
		);
		await refresh();
		const last = (await entries(journal)).findLast(
			(entry) => entry.command === 'trust-record-settle'
		);
		expect(last?.result.error?.code).toBe('TRUST_RECORDS_TOO_LARGE');
		expect(await tableIds(store, 'project')).toEqual(before);
	});

	it('replays with no difference, reading the host from the apply entry, and makes no call (6.4, A5)', async () => {
		const { parts, server, journal, settled } = await hostedKernel();
		await settled();
		await parts.kernel.call('project-create', { name: 'Delta' });
		await settled();
		const recorded = await entries(journal);
		expect(recorded.find((entry) => entry.command === 'project-create')?.context?.replay).toBe(
			'recorded'
		);
		const sent = server.calls.length;
		// The replay is given a transport, so a call it made would be seen: it reads the recorded settles instead.
		const replayCalls: ServerCallRequestV1[] = [];
		const replay = await replayKernel(recorded, {
			identity: PROVIDER,
			deployment: scopedDeployment() as never,
			ports: {
				...scopedPorts(),
				serverCall: async (request: ServerCallRequestV1) => {
					replayCalls.push(request);
					return server.serverCall(request);
				},
			},
			membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd' },
		});
		expect(replay.report.diverged).toBe(false);
		expect(replayCalls).toEqual([]);
		expect(server.calls.length).toBe(sent);
	});
});

describe("step 5's trust review: the copy across a change of person, the journal's bound and the copy's reads", () => {
	it('settles the copy empty when the next person has no snapshot, so the last one never serves them', async () => {
		const { parts, server, store, auth, settled } = await hostedKernel();
		await settled();
		expect(await tableIds(store, 'project')).toContain('prj_vault');
		server.answerWith(() => ({
			result: {
				success: false,
				error: {
					code: 'SERVER_UNAVAILABLE',
					message: 'x',
					suggestion: 'Try again',
					retryable: true,
				},
			},
		}));
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		await settled();
		await settled();
		expect(await tableIds(store, 'project')).toEqual([]);
		expect(parts.kernel).toBeDefined();
	});

	it('settles the copy empty when the next person’s snapshot is too large to keep', async () => {
		const { server, store, auth, journal, settled } = await hostedKernel();
		await settled();
		server.answerWith((request) =>
			request.command === 'trust-record-snapshot'
				? {
						result: {
							success: true,
							data: {
								generation: 'big',
								projects: [{ ...atlas, id: 'prj_big', name: 'x'.repeat(1_200_000) }],
								workspaceApps: [],
								agents: [],
							},
						},
					}
				: undefined
		);
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		await settled();
		await settled();
		expect(await tableIds(store, 'project')).toEqual([]);
		// Over the journal's own bound (1 MiB by default), under 2 MiB: refused, so a replay never stops at it.
		const recorded = await entries(journal);
		const refused = recorded.filter(
			(entry) => entry.result.error?.code === 'TRUST_RECORDS_TOO_LARGE'
		);
		expect(refused.length).toBe(1);
		// Journaled by its size alone, whole, so the replay runs past it (step 5's re-check).
		expect(refused[0]?.input).toMatchObject({ oversized: expect.any(Number) });
		expect((refused[0] as { unreplayable?: unknown }).unreplayable).toBeUndefined();
		const replay = await replayKernel(recorded, {
			identity: PROVIDER,
			deployment: scopedDeployment() as never,
			ports: scopedPorts(),
			membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd' },
		});
		expect(replay.report.diverged).toBe(false);
	});

	it("answers no agent of the last person's copy before the next person's settle", async () => {
		const { parts, server, auth, settled } = await hostedKernel({ withBea: true });
		await settled();
		server.as(BEA);
		// Another tab's sign-in: the adapter hears it before any call does.
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
		const first = await parts.kernel.call<{ agents: Array<{ sponsor: string }> }>(
			'agent-member-list',
			{}
		);
		expect(first.success, JSON.stringify(first.error)).toBe(true);
		expect(first.data?.agents).toEqual([]);
	});

	it('journals a hosted deployment with no app, so its replay reads the host and does not diverge', async () => {
		const deployment = {
			...scopedDeployment(),
			apps: [],
			deployment_version: 4,
			host: { kind: 'hosted' },
		};
		const { journal, settled } = await hostedKernel({ deployment });
		await settled();
		const recorded = await entries(journal);
		const apply = recorded.find((entry) => entry.command === 'workspace-deployment-apply');
		expect(apply?.input).toMatchObject({ host: { kind: 'hosted' } });
		const replay = await replayKernel(recorded, {
			identity: PROVIDER,
			deployment: scopedDeployment() as never,
			ports: scopedPorts(),
			membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd' },
		});
		expect(replay.report.diverged).toBe(false);
	});

	it('names the person each call was made as, for the server to hold it to the session', async () => {
		const { parts, server, settled } = await hostedKernel();
		await settled();
		await parts.kernel.call('project-create', { name: 'Delta' });
		expect(server.calls.every((call) => call.person === OLU)).toBe(true);
	});

	it('answers agent-member-list and -get from the copy, connected agents included', async () => {
		const { parts, settled } = await hostedKernel();
		await settled();
		const listed = await parts.kernel.call<{ agents: Array<{ id: string; kind: string }> }>(
			'agent-member-list',
			{}
		);
		expect(listed.data?.agents.map((agent) => agent.kind).sort()).toEqual([
			'connected',
			'installed',
		]);
		const got = await parts.kernel.call<{ id: string }>('agent-member-get', {
			agent: 'agt_bbbbbbbbbbbbbbbbbbbb',
		});
		expect(got.data?.id).toBe('agt_bbbbbbbbbbbbbbbbbbbb');
	});

	it('routes nothing for a deployment that names another host, whatever port the host gives', async () => {
		const server = fakeServer();
		const { parts, store } = await hostedKernel({ deployment: scopedDeployment(), server });
		expect((await parts.kernel.call('project-create', { name: 'Delta' })).success).toBe(true);
		expect((await store.list<ProjectV1>('project')).data.some((row) => row.slug === 'delta')).toBe(
			true
		);
		expect(server.calls).toEqual([]);
	});
});

describe('the copy writes the tables the kernel reads', () => {
	it('names the project and workspace-app tables as the records module does', () => {
		expect(COPY_TABLES).toEqual({ project: PROJECT_TABLE, workspaceApp: WORKSPACE_APP_TABLE });
	});
});

describe('P6-E3: nothing is routed in any other deployment (6.1)', () => {
	it('runs the phase 3 handler in a provider deployment with no transport, and in local mode', async () => {
		for (const options of [
			{ port: false },
			{ identity: { mode: 'local' } as IdentityV1 },
			{ deployment: scopedDeployment(), port: false },
		]) {
			const server = fakeServer();
			const { parts, store } = await hostedKernel({ ...options, server });
			const created = await parts.kernel.call<ProjectV1>('project-create', { name: 'Delta' });
			expect(created.success, JSON.stringify(created.error)).toBe(true);
			const rows = (await store.list<ProjectV1>('project')).data;
			expect(rows.some((row) => row.slug === 'delta')).toBe(true);
			expect(server.calls).toEqual([]);
			expect(parts.registries.boot.hasCommand('trust-record-settle')).toBe(false);
		}
	});
});

/** One server command's run: its outcome, and its result and journal slice, serialized. */
interface CommandRun {
	name: string;
	outcome: string;
	result: string;
	journal: string;
}

/**
 * Every `SERVER_COMMANDS` name, in phase 3's order, with three agent members of their own: one updated and removed, and
 * two pending (in `provider` mode, sponsored by Bea), one confirmed and one declined as her. Each command's outcome is
 * held to `expected` before any comparison, so a run that refused everything cannot compare equal by accident.
 */
async function runServerCommands(
	kernel: Awaited<ReturnType<typeof hostedKernel>>,
	mode: 'provider' | 'local'
): Promise<CommandRun[]> {
	const { parts, journal, auth, settled } = kernel;
	const runs: CommandRun[] = [];
	const ids: Record<string, string> = {};
	const sponsor = mode === 'provider' ? BEA : OLU;
	const pendingOutcome = mode === 'provider' ? 'ok' : 'AGENT_MEMBER_NOT_PENDING';
	const steps: Array<[string, () => unknown, string, string?]> = [
		['project-create', () => ({ name: 'Delta' }), 'ok'],
		['project-update', () => ({ project: 'delta', name: 'Delta 2' }), 'ok'],
		['project-archive', () => ({ project: 'delta' }), 'ok'],
		['project-restore', () => ({ project: 'delta' }), 'ok'],
		['workspace-app-set', () => ({ instance: 'tasks', enabled: false }), 'ok'],
		['agent-member-add', () => ({ name: 'Keeper', sponsor: OLU }), 'ok', 'keeper'],
		['agent-member-update', () => ({ agent: ids.keeper, name: 'Keeper 2' }), 'ok'],
		['agent-member-remove', () => ({ agent: ids.keeper }), 'ok'],
		['agent-member-add', () => ({ name: 'Yes', sponsor }), 'ok', 'yes'],
		['agent-member-add', () => ({ name: 'No', sponsor }), 'ok', 'no'],
		['agent-member-confirm', () => ({ agent: ids.yes }), pendingOutcome],
		['agent-member-decline', () => ({ agent: ids.no }), pendingOutcome],
		['trust-record-snapshot', () => ({}), 'COMMAND_NOT_FOUND'],
		// #2781's, after the pinned runs, so theirs keep their bytes: the sponsor withdraws the one she confirmed.
		['agent-member-withdraw', () => ({ agent: ids.yes }), 'ok'],
	];
	expect([...new Set(steps.map(([name]) => name))].sort()).toEqual([...SERVER_COMMANDS].sort());
	for (const [name, input, expected, keep] of steps) {
		// The sponsor answers her own agents: Bea signs in before the first of them (phase 3's 8.3).
		if (name === 'agent-member-confirm' && mode === 'provider') {
			await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' });
			await settled();
		}
		const before = (await entries(journal)).length;
		const result = await parts.kernel.call(name, input());
		await settled();
		const slice = (await entries(journal)).slice(before);
		const outcome = result.success ? 'ok' : String(result.error?.code);
		expect(outcome, `${name}: ${JSON.stringify(result.error)}`).toBe(expected);
		if (keep && result.success) ids[keep] = (result.data as { id: string }).id;
		// Every write is journaled, refused or not; the snapshot is the server's, so the browser has none to journal.
		const own = slice.filter((entry) => entry.command === name);
		expect(own.length, name).toBe(name === 'trust-record-snapshot' ? 0 : 1);
		runs.push({
			name,
			outcome,
			result: JSON.stringify(result),
			// The test's own waits left out by their trace: every entry the kernel journaled stays.
			journal: JSON.stringify(
				slice.filter((entry) => entry.traceId === undefined || !kernel.waits.has(entry.traceId))
			),
		});
	}
	return runs;
}

/**
 * Each mode's runs as the kernel before step 5's routing answered them (`7aacc4987`, step 5's parent on `main`): written
 * there by this sequence, and byte-identical there in all eight deployments below, which share these two baselines.
 * Commands added since (`agent-member-withdraw`, #2781) run after them, so the pinned runs keep their bytes; theirs are
 * held equal across the eight deployments here, and to the kernel without the port by the test after this one.
 */
const SINCE_PINNED = ['agent-member-withdraw'];
const PINNED = JSON.parse(
	readFileSync(new URL('../../test/fixtures/hosted-phase3-pinned.json', import.meta.url), 'utf8')
) as { provenance: { commit: string }; local: CommandRun[]; provider: CommandRun[] };

const v4 = (kind: string) => ({ ...scopedDeployment(), deployment_version: 4, host: { kind } });
const LOCAL = { mode: 'local' } as IdentityV1;

describe('P6-E3: in every other deployment kind and mode, each server command runs its phase 3 handler (6.1)', () => {
	it('P6-E3: matches the pre-routing kernel’s pinned results and journal bytes, in all eight other deployments', async () => {
		expect(PINNED.provenance.commit).toBe('7aacc4987');
		const cases: Array<[string, IdentityV1, unknown, boolean]> = [
			['hosted provider, no transport', PROVIDER, HOSTED(), false],
			['static provider', PROVIDER, v4('static'), true],
			['version 3 provider', PROVIDER, { ...scopedDeployment(), deployment_version: 3 }, true],
			// Refused by the reader (DEPLOYMENT_DESKTOP_PROVIDER); the kernel given one still routes nothing.
			['desktop provider', PROVIDER, v4('desktop'), true],
			['hosted, local mode', LOCAL, HOSTED(), true],
			['static, local mode', LOCAL, v4('static'), true],
			['desktop, local mode', LOCAL, v4('desktop'), true],
			['desktop, local mode, no transport', LOCAL, v4('desktop'), false],
		];
		const firstSince: Partial<Record<'local' | 'provider', CommandRun[]>> = {};
		for (const [label, identity, deployment, port] of cases) {
			const mode = identity.mode === 'local' ? 'local' : 'provider';
			const server = fakeServer();
			const kernel = await hostedKernel({
				identity,
				deployment,
				port,
				server,
				roster: true,
				withBea: true,
			});
			await kernel.settled();
			const runs = await runServerCommands(kernel, mode);
			const pinned = PINNED[mode];
			expect(
				runs.map((run) => run.name),
				label
			).toEqual([...pinned.map((run) => run.name), ...SINCE_PINNED]);
			for (const [at, run] of runs.slice(0, pinned.length).entries()) {
				expect(run.result, `${label}: ${run.name}'s result`).toBe(pinned[at]?.result);
				expect(run.journal, `${label}: ${run.name}'s journal`).toBe(pinned[at]?.journal);
			}
			const since = runs.slice(pinned.length);
			firstSince[mode] ??= since;
			const first = firstSince[mode];
			for (const [at, run] of since.entries()) {
				expect(run.result, `${label}: ${run.name}'s result`).toBe(first[at]?.result);
				expect(run.journal, `${label}: ${run.name}'s journal`).toBe(first[at]?.journal);
			}
			expect(server.calls, label).toEqual([]);
		}
	});

	it('P6-E3: matches the kernel without the port, result and journal slice, in static, desktop, version 3 and local deployments', async () => {
		const cases: Array<[string, IdentityV1, unknown]> = [
			['hosted, local mode', LOCAL, HOSTED()],
			['static provider', PROVIDER, v4('static')],
			['version 3 provider', PROVIDER, { ...scopedDeployment(), deployment_version: 3 }],
			['static, local mode', LOCAL, v4('static')],
			['desktop, local mode', LOCAL, v4('desktop')],
			// Refused by the reader (DEPLOYMENT_DESKTOP_PROVIDER); the kernel given one still routes nothing.
			['desktop provider', PROVIDER, v4('desktop')],
		];
		for (const [label, identity, deployment] of cases) {
			const mode = identity.mode === 'local' ? 'local' : 'provider';
			const server = fakeServer();
			const subject = await hostedKernel({
				identity,
				deployment,
				server,
				roster: true,
				withBea: true,
			});
			const without = await hostedKernel({
				identity,
				deployment,
				port: false,
				roster: true,
				withBea: true,
			});
			await subject.settled();
			await without.settled();
			const got = await runServerCommands(subject, mode);
			const want = await runServerCommands(without, mode);
			for (const [at, each] of got.entries()) {
				expect(each.result, `${label}: ${each.name}'s result`).toBe(want[at]?.result);
				expect(each.journal, `${label}: ${each.name}'s journal`).toBe(want[at]?.journal);
			}
			expect(server.calls, label).toEqual([]);
			expect(subject.parts.registries.boot.hasCommand('trust-record-settle'), label).toBe(false);
		}
	});
});

describe('P6-E3: in a hosted provider deployment, every routed write is the server’s (6.1)', () => {
	it('P6-E3: P6-E4: sends each routed write with its input, writes nothing locally after any of them, and reads the snapshot only over the transport', async () => {
		const { parts, server, settled, writes: stored } = await hostedKernel();
		await settled();
		// Boot's own request is the transport's snapshot, with `{}`; the browser registers no such command.
		expect(server.calls[0]).toMatchObject({ command: 'trust-record-snapshot', input: {} });
		const COPY = [PROJECT_TABLE, WORKSPACE_APP_TABLE, AGENT_MEMBER_TABLE, 'settings'];
		// Boot's settle wrote the copy (and its holder record in `settings`); nothing after it may.
		expect(stored.filter((table) => COPY.includes(table)).length).toBeGreaterThan(0);
		const agent = 'agt_aaaaaaaaaaaaaaaaaaaa';
		const writes: Array<[string, unknown]> = [
			['project-create', { name: 'Delta' }],
			['project-update', { project: 'atlas', name: 'Atlas 2' }],
			['project-archive', { project: 'atlas' }],
			['project-restore', { project: 'atlas' }],
			['workspace-app-set', { instance: 'tasks', enabled: false }],
			['agent-member-add', { name: 'X', sponsor: OLU }],
			['agent-member-update', { agent, name: 'Y' }],
			['agent-member-confirm', { agent }],
			['agent-member-decline', { agent }],
			['agent-member-withdraw', { agent }],
			['agent-member-remove', { agent }],
		];
		expect(writes.map(([name]) => name).sort()).toEqual(
			SERVER_COMMANDS.filter((name) => name !== 'trust-record-snapshot').sort()
		);
		// Each answered with the copy's own generation, so no settle follows and the store shows what the calls wrote.
		const boot = server.calls.length;
		const generation = (
			(
				await server.serverCall({
					command: 'trust-record-snapshot',
					input: {},
					scope: { workspace: 'personal' },
				})
			).result.data as TrustRecordSnapshotV1
		).generation;
		server.calls.splice(boot);
		server.answerWith((request) =>
			request.command === 'trust-record-snapshot'
				? undefined
				: { result: { success: true, data: { id: agent } }, generation }
		);
		for (const [name, input] of writes) {
			const at = stored.length;
			const result = await parts.kernel.call(name, input);
			expect(result.success, `${name}: ${JSON.stringify(result.error)}`).toBe(true);
			await settled();
			// Nothing of this call, or of anything it started, was written locally, in any table (6.1, 6.3).
			expect(stored.slice(at), name).toEqual([]);
		}
		expect(server.calls.slice(boot)).toEqual(
			writes.map(([command, input]) => ({
				command,
				input,
				scope: { workspace: 'personal' },
				person: OLU,
			}))
		);
		const snapshot = await parts.kernel.call('trust-record-snapshot', {});
		expect(snapshot.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(server.calls.length).toBe(boot + writes.length);
	});
});
