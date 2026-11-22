/**
 * P6-E4 and the browser's half of P6-E3 (phase 6 specification, 6.1, 6.3, 6.4, A5 and A6; step 5): the browser's
 * routing and copy, over a fake `serverCall` that holds the server's records. Each routed write reaches the server and
 * writes nothing in the browser; the copy changes only through `trust-record-settle`, journaled with its input, run
 * top-level at boot, after a call whose generation differs, on a refresh and after a change of person; it writes only
 * installed agent members; a copy too large is refused and left as it was; the agent interface's writes are
 * `HUMAN_REQUIRED`; and a replay of the journal has no difference, reads the host from its apply entry, and makes no call.
 * In every other deployment kind and mode, each command runs its phase 3 handler.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandResult, JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernelParts, type KernelParts } from '../kernel.js';
import { SCOPED_PROJECTS, scopedDeployment, scopedPorts } from '../scope/fixtures.js';
import type { ProjectV1 } from '../scope/records.js';
import { PROJECT_TABLE, WORKSPACE_APP_TABLE } from '../scope/records.js';
import { createFixedEnvironment, createSeededRandom, createSteppingClock } from '../session.js';
import { replayKernel } from '../testing.js';
import {
	canonicalJson,
	type ServerCallAnswerV1,
	type ServerCallRequestV1,
	TRUST_RECORDS_MAX_BYTES,
	type TrustRecordSnapshotV1,
} from '../trust-records.js';
import { COPY_TABLES } from './hosted.js';
import { AGENT_MEMBER_TABLE } from './tables.js';

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
		{
			id: 'agt_aaaaaaaaaaaaaaaaaaaa',
			kind: 'installed',
			sponsor: OLU,
			status: 'active',
			name: 'A',
		},
		{
			id: 'agt_bbbbbbbbbbbbbbbbbbbb',
			kind: 'connected',
			sponsor: OLU,
			status: 'active',
			name: 'B',
		},
	];
	const calls: ServerCallRequestV1[] = [];
	let person = OLU;
	let answer: ((request: ServerCallRequestV1) => ServerCallAnswerV1 | undefined) | undefined;
	const snapshot = (): TrustRecordSnapshotV1 => {
		const seen = {
			projects: projects.filter(
				(project) => project.access.mode !== 'restricted' || project.access.members.includes(person)
			),
			workspaceApps: [],
			agents: agents as TrustRecordSnapshotV1['agents'],
		};
		return { generation: `g:${canonicalJson(seen).length}:${person}`, ...seen };
	};
	return {
		projects,
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
	} = {}
) {
	const server = options.server ?? fakeServer();
	const clock = createSteppingClock();
	const auth = new MockAuthAdapter({ clock: { now: clock } });
	await auth.signIn({ method: 'credentials', email: 'olu@example.com', password: 'x' });
	const store = new MemoryAdapter();
	const journal = new MemoryJournalSink();
	const watchers = new Set<() => void>();
	const identity = options.identity ?? PROVIDER;
	const parts = await createKernelParts({
		store,
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
	const settled = () => parts.kernel.call('shell-info-get');
	const refresh = async () => {
		for (const watcher of watchers) watcher();
		await settled();
	};
	return { parts, server, store, journal, auth, settled, refresh };
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

	it('routes a write to the server, writes nothing itself, and settles once the generation differs', async () => {
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
		const replay = await replayKernel(recorded, {
			identity: PROVIDER,
			deployment: scopedDeployment() as never,
			ports: scopedPorts(),
			membership: { mode: 'provider', members: new Map([[OLU, 'owner']]), digest: 'd' },
		});
		expect(replay.report.diverged).toBe(false);
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
