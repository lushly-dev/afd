/**
 * The server kernel's half of phase 6's trust records (its 6.1 and 6.2, A4, A6 and A8; step 5), as units over a
 * principal-gated kernel: `callAs` runs a command as a person's principal, `trust-record-snapshot` answers what that
 * person sees with a digest of it, `persona-list` answers `default` alone, an owner's `agent-member-add` decides its
 * sponsor on the roster read for the call, and the provider's removal hook runs `agent-member-settle` alone, journaled as
 * the removing person or the hook itself.
 */

import { createHash } from 'node:crypto';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { beforeAll, describe, expect, it } from 'vitest';
import { createKernelParts, type KernelParts } from '../kernel.js';
import { DOCUMENT_KIT } from '../late/command-kit.js';
import { SCOPED_PROJECTS, scopedDeployment, scopedPorts, seedProjects } from '../scope/fixtures.js';
import { createFixedEnvironment, createSeededRandom, createSteppingClock } from '../session.js';
import { sha256 } from '../settings/experiment-host.js';
import { canonicalJson, SERVER_COMMANDS, type TrustRecordSnapshotV1 } from '../trust-records.js';
import { createTrustSnapshot } from './trust-records.js';

const OWNER = 'usr_owner';
const MEMBER = 'usr_member';

let parts: KernelParts;
let journal: MemoryJournalSink;
const read = () => journal.read() as Promise<JournalEntry[]>;

const people = [
	{ id: OWNER, name: 'Olu', role: 'owner' as const, digest: 'd1' },
	{ id: MEMBER, name: 'Mae', role: 'member' as const, digest: 'd2' },
];

beforeAll(async () => {
	const store = new MemoryAdapter();
	await seedProjects(
		store,
		SCOPED_PROJECTS.map((project) =>
			project.slug === 'citadel'
				? { ...project, access: { mode: 'restricted' as const, members: [OWNER] } }
				: project
		)
	);
	const clock = createSteppingClock();
	const auth = Object.assign(new MockAuthAdapter({ clock: { now: clock } }), {
		// The account capability by person, as the server's is: the roster the sponsor rule reads (9.2).
		accountFor: () => ({
			members: async () => ({ people, total: people.length }),
			agents: async () => [],
		}),
	});
	journal = new MemoryJournalSink();
	parts = await createKernelParts({
		store,
		storeKind: 'memory',
		journal,
		auth: auth as never,
		environment: createFixedEnvironment(),
		host: 'test',
		clock,
		random: createSeededRandom('trust'),
		deployment: scopedDeployment(),
		ports: scopedPorts(),
		identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] },
		gate: 'principal',
	});
});

const principal = (person: string, role: 'owner' | 'member' | null) =>
	(parts.admitPrincipal as NonNullable<KernelParts['admitPrincipal']>)({
		actor: { kind: 'human', id: person },
		person,
		role,
		digest: 'x',
	});
const call = (person: string, role: 'owner' | 'member' | null, name: string, input: unknown) =>
	(parts.callAs as NonNullable<KernelParts['callAs']>)(principal(person, role), name, input, {
		workspace: 'personal',
	});

describe('the server kernel serves the trust records (phase 6, 6.1)', () => {
	it('P6-E3: registers every SERVER_COMMANDS name on the server', () => {
		for (const name of SERVER_COMMANDS)
			expect(parts.registries.palette.hasCommand(name)).toBe(true);
	});

	it('runs a call as the principal, journaled with its human actor', async () => {
		const created = await call(OWNER, 'owner', 'project-create', { name: 'Delta' });
		expect(created.success).toBe(true);
		const entry = (await read()).find((each) => each.command === 'project-create');
		expect(entry?.actor).toMatchObject({ kind: 'human', id: OWNER });
		// A person with no membership is refused by line 0, as any principal's call is.
		const refused = await call('usr_nobody', null, 'project-create', { name: 'Echo' });
		expect(refused.error?.code).toBe('WORKSPACE_NOT_MEMBER');
	});

	it('P6-E4: answers the snapshot a person sees, its generation the digest of it alone', async () => {
		const owner = await call(OWNER, 'owner', 'trust-record-snapshot', {});
		const again = await call(OWNER, 'owner', 'trust-record-snapshot', {});
		const member = await call(MEMBER, 'member', 'trust-record-snapshot', {});
		const of = (result: typeof owner) => result.data as TrustRecordSnapshotV1;
		expect(owner.success && member.success).toBe(true);
		// The restricted project is the owner's alone: what `project-list { status: 'all' }` shows each.
		expect(of(owner).projects.map((project) => project.slug)).toContain('citadel');
		expect(of(member).projects.map((project) => project.slug)).not.toContain('citadel');
		expect(of(owner).generation).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(of(owner).generation).toBe(of(again).generation);
		expect(of(owner).generation).not.toBe(of(member).generation);
		// The digest of that person's snapshot itself: SHA-256 of its canonical JSON, without the field (6.1).
		for (const each of [of(owner), of(member)]) {
			const { generation, ...seen } = each;
			const hex = createHash('sha256').update(canonicalJson(seen)).digest('hex');
			expect(generation).toBe(`sha256:${hex}`);
		}
		expect(Object.keys(of(owner)).sort()).toEqual([
			'agents',
			'generation',
			'projects',
			'workspaceApps',
		]);
	});

	it('P6-E4: digests a snapshot with out-of-order nested keys to an independently computed SHA-256', async () => {
		// The three reads answer their keys out of order, nested too; the digest must be of the sorted canonical bytes.
		const answers: Record<string, unknown> = {
			'project-list': {
				projects: [
					{ slug: 'zed', id: 'prj_z', access: { mode: 'restricted', members: ['usr_a'] } },
				],
			},
			'workspace-app-list': { apps: [{ instance: 'tasks', enabled: true }] },
			'agent-member-list': {
				agents: [{ status: 'active', sponsor: 'usr_a', kind: 'installed', id: 'agt_1' }],
			},
		};
		const snapshot = createTrustSnapshot({
			definitionOf: (name) =>
				({ handler: async () => ({ success: true, data: answers[name] }) }) as never,
			workspace: 'personal',
			digest: sha256,
			kit: DOCUMENT_KIT,
		});
		const result = (await snapshot.handler({} as never, {} as never)) as {
			data: TrustRecordSnapshotV1;
		};
		// Written by hand, and its SHA-256 computed apart from the kernel (node:crypto, once, on this exact string):
		// {"agents":[{"id":"agt_1","kind":"installed","sponsor":"usr_a","status":"active"}],"projects":[{"access":
		// {"members":["usr_a"],"mode":"restricted"},"id":"prj_z","slug":"zed"}],"workspaceApps":[{"enabled":true,
		// "instance":"tasks"}]}
		expect(result.data.generation).toBe(
			'sha256:5de873ca699374ea93be6f67e28a26a5a15a43bad20bdcfc2095c6141b957304'
		);
	});

	it('leaves the snapshot and its reads out of the journal', async () => {
		const before = (await read()).length;
		await call(OWNER, 'owner', 'trust-record-snapshot', {});
		expect((await read()).length).toBe(before);
	});

	it('answers persona-list with default alone (A6)', async () => {
		const listed = await call(OWNER, 'owner', 'persona-list', {});
		expect(listed.data).toMatchObject({ active: 'default' });
		expect((listed.data as { personas: Array<{ id: string }> }).personas.map((p) => p.id)).toEqual([
			'default',
		]);
	});

	it("decides an owner's agent-member-add on the roster read for the call", async () => {
		const added = await call(OWNER, 'owner', 'agent-member-add', {
			name: 'Helper',
			sponsor: MEMBER,
			access: { workspace: true, projects: [] },
		});
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		const refused = await call(OWNER, 'owner', 'agent-member-add', {
			name: 'Stray',
			sponsor: 'usr_gone',
			access: { workspace: true, projects: [] },
		});
		expect(refused.error?.code).toBe('AGENT_SPONSOR_INVALID');
		expect(
			(await call(MEMBER, 'member', 'agent-member-add', { name: 'X', sponsor: MEMBER })).error?.code
		).toBe('OWNER_REQUIRED');
	});
});

describe("the provider's removal hook (A4, A8)", () => {
	it('runs agent-member-settle alone, journaled as the removing person or the hook', async () => {
		const agents = (
			(await call(OWNER, 'owner', 'agent-member-list', {})).data as {
				agents: Array<{ id: string; sponsor: string; status: string }>;
			}
		).agents.filter((agent) => agent.sponsor === MEMBER);
		expect(agents.length).toBe(1);
		const run = parts.runProviderHook as NonNullable<KernelParts['runProviderHook']>;
		const settled = await run(
			{ agents: [{ agent: agents[0]?.id, suspended: 'sponsor-left' }] },
			{ kind: 'human', id: OWNER }
		);
		expect(settled.success, JSON.stringify(settled.error)).toBe(true);
		const entry = (await read()).findLast((each) => each.command === 'agent-member-settle');
		expect(entry?.actor).toMatchObject({ kind: 'human', id: OWNER });
		// With no session on the hook's request, the hook itself.
		await run({ agents: [{ agent: agents[0]?.id, suspended: 'sponsor-left' }] });
		expect(
			(await read()).findLast((each) => each.command === 'agent-member-settle')?.actor
		).toEqual({
			kind: 'service',
			id: 'provider-hook',
		});
		// Boot's own mark never carries it on the server: the hook's alone (A4).
		expect(
			(
				await parts.runBoot('agent-member-settle', {
					agents: [{ agent: agents[0]?.id, suspended: 'sponsor-left' }],
				})
			).error?.code
		).toBe('UNAUTHORIZED');
		// Nothing else reaches the settle: a person's call names no boot-only command.
		expect((await call(OWNER, 'owner', 'agent-member-settle', { agents: [] })).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});
});

describe("the owner checks read the call's principal (phase 3, 9.5; #2785)", () => {
	it("decides limit-usage-get's owner check on the principal's role, never the kernel-wide empty membership", async () => {
		// A principal-gated kernel holds no members kernel-wide, so a check that read it refused every owner.
		const owner = await call(OWNER, 'owner', 'limit-usage-get', {});
		expect(owner.success).toBe(true);
		expect((await call(MEMBER, 'member', 'limit-usage-get', {})).error?.code).toBe(
			'OWNER_REQUIRED'
		);
		// The settings', experiments' and autonomy's workspace writes refuse first on a hosted deployment
		// (`SHARED_RECORD_UNAVAILABLE`), so this read is the owner check a server call reaches today; whichever of them
		// a server list serves first brings its own server test.
	});
});
