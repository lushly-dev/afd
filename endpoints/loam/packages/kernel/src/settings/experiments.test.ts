/**
 * P4-E5's units (phase 4 specification, section 5 and 19; D119, D155): the experiment commands in the kernel, on the
 * scoped workspace's apps and a document app whose whole app, inspector and one settings section are gated. The jobs
 * `opt-into-experiment` and `workspace-experiment-opt-out` run in `scenarios.test.ts` on hello's `hello.inspector-v2`;
 * the pure rules are in `experiment-rules.test.ts`; P4-E2's sweep in `scope/settings-sweep.test.ts`.
 */

import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1, ManifestV3, ProjectionV3, ProjectionV4 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import type { MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPackages,
} from '../scope/fixtures.js';
import { createFixturePorts, replayKernel } from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import type { AppDetail, AppSummary, LoamKernel } from '../types.js';
import { EXPERIMENT_TABLE } from './experiments.js';
import { NOTIFICATION_TABLE } from './notifications.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const BETA = 'probe.beta';
const PANE = 'probe.pane';

type Experiment = { id: string; title: string; changes: string; ends: string; stage: string };
const experiment = (id: string, extra: Partial<Experiment> = {}): Experiment => ({
	id,
	title: id === 'beta' ? 'Probe beta' : 'Probe pane',
	changes: id === 'beta' ? 'Shows Probe and its notes.' : 'Adds a pane beside a probe note.',
	ends: '2027-03-01',
	stage: 'visible',
	...extra,
});

/** The probe document app, held out whole by `probe.beta`, its inspector and one section gated by `probe.pane`. */
const gatedProbe = (experiments: Experiment[] = [experiment('beta'), experiment('pane')]) =>
	({
		...PROBE_DOCUMENTS_MANIFEST,
		app: { ...PROBE_DOCUMENTS_MANIFEST.app, requires_experiment: BETA },
		commands: (PROBE_DOCUMENTS_MANIFEST.commands as Array<{ name: string }>).map((each) =>
			each.name === 'probe-content-set' ? { ...each, confirm_prompt: 'Replace the text?' } : each
		),
		ui: {
			...PROBE_DOCUMENTS_MANIFEST.ui,
			surfaces: {
				...PROBE_DOCUMENTS_MANIFEST.ui?.surfaces,
				inspector: { element: 'probe-pane', requires_experiment: PANE },
			},
			experiments,
			settings: [
				{
					id: 'pane',
					title: 'Pane',
					levels: ['person'],
					requires_experiment: PANE,
					schema: {
						type: 'object',
						properties: {
							wide: { type: 'boolean', title: 'Wide', default: false },
						},
						additionalProperties: false,
					},
				},
			],
		},
	}) as unknown as ManifestV3;

const deployment = (extra: Partial<ProjectionV4> = {}) =>
	({
		...scopedDeployment(),
		generation: 'experiments',
		apps: [
			...scopedDeployment().apps,
			{ instance: 'probe', app: 'probe', package: 'fixtures/probe/' },
		],
		...extra,
	}) as unknown as ProjectionV3;

const ports = (manifest: ManifestV3 = gatedProbe()) =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/probe/': { manifest, definition: PROBE_DOCUMENTS_DEFINITION },
	});

async function workspace(
	options: ScopedWorkspaceOptions & { manifest?: ManifestV3 } = {}
): Promise<ScopedWorkspace> {
	const { manifest, ...rest } = options;
	const made = await createScopedWorkspace({
		deployment: deployment(),
		ports: ports(manifest),
		...rest,
	});
	kernels.push(made.kernel);
	return made;
}

type Row = Record<string, unknown> & { fullId: string; on: boolean };
const list = async (kernel: LoamKernel, input: Record<string, unknown> = {}) =>
	((await kernel.call<{ experiments: Row[] }>('experiment-list', input)).data?.experiments ??
		[]) as Row[];
const detail = async (kernel: LoamKernel, instance = 'probe') =>
	(await kernel.call<AppDetail>('app-get', { instance })).data as AppDetail;
const stateOf = async (kernel: LoamKernel, instance = 'probe') =>
	(await kernel.call<{ apps: AppSummary[] }>('app-list')).data?.apps.find(
		(app) => app.instance === instance
	)?.state;
/** The table's enablements and removals, without each plugin's declared ids (5.1). */
const tableOf = async (store: DataAdapter) =>
	(await store.list<{ kind?: string }>(EXPERIMENT_TABLE)).data.filter(
		(row) => row.kind !== 'declared'
	);
const notices = async (store: DataAdapter) =>
	(await store.list<{ source: string; title: string; kind?: string }>(NOTIFICATION_TABLE)).data
		.filter((row) => row.source === 'shell' && row.kind !== 'confirmation')
		.map((row) => row.title);

const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const BEA = 'mock-user-bea@example.com';
const OLU = 'mock-user-olu@example.com';
const ACME = (): MembershipV1 => ({
	mode: 'provider',
	members: new Map([
		[BEA, 'member'],
		[OLU, 'owner'],
	]),
	digest: 'd1',
});
const signIn = (kernel: LoamKernel, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });

describe('P4-E5: a person turns an experiment on for themselves (5.2, 5.3)', () => {
	it('lists it with what may change and when it ends, off, and every gate closed', async () => {
		const { kernel } = await workspace();
		const [beta] = await list(kernel, { experiment: BETA });
		expect(beta).toEqual({
			fullId: BETA,
			owner: 'probe',
			title: 'Probe beta',
			changes: 'Shows Probe and its notes.',
			ends: '2027-03-01',
			stage: 'visible',
			on: false,
			by: null,
			workspace: false,
			changed: false,
			overdue: false,
		});
		// The app is listed `gated`, its commands are not registered, and app-get names each gate (A-P1-2).
		expect(await stateOf(kernel)).toBe('gated');
		const shown = await detail(kernel);
		expect(shown.gates).toEqual({
			app: { experiment: BETA, open: false },
			inspector: { experiment: PANE, open: false },
		});
		expect(shown.surfaces).not.toContain('inspector');
		expect((await kernel.call('probe-content-get', { document: 'doc_x' })).success).toBe(false);
		expect(
			(await kernel.listCommands()).some((command) => command.name === 'probe-content-get')
		).toBe(false);
		// A gated section is absent (3.5).
		const sections = await kernel.call<{ sections: Array<{ section: string }> }>(
			'setting-schema-get',
			{ outline: true }
		);
		expect(sections.data?.sections.map(({ section }) => section)).not.toContain('probe.pane');
	});

	it('opens each gate it decides, and nothing it does not', async () => {
		const { kernel } = await workspace();
		const events: Array<{ command: string; experiments?: true }> = [];
		kernel.subscribe((event) => {
			events.push(event as { command: string; experiments?: true });
		});
		const on = await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		expect(on.data).toEqual({ on: true, by: 'person' });
		// `experimentsChanged`: the chrome renders the gates again (5.3).
		expect(events.find(({ command }) => command === 'experiment-enable')?.experiments).toBe(true);
		expect(await stateOf(kernel)).toBe('ready');
		expect((await detail(kernel)).gates).toEqual({
			app: { experiment: BETA, open: true },
			inspector: { experiment: PANE, open: false },
		});
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		expect(made.success).toBe(true);
		await kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		const shown = await detail(kernel);
		expect(shown.gates.inspector).toEqual({ experiment: PANE, open: true });
		expect(shown.surfaces).toContain('inspector');
		const sections = await kernel.call<{ sections: Array<{ section: string }> }>(
			'setting-schema-get',
			{ outline: true }
		);
		expect(sections.data?.sections.map(({ section }) => section)).toContain('probe.pane');
		// Off again: the app is held out again, with nothing dirty to keep it.
		expect(
			(await kernel.call('experiment-disable', { experiment: BETA, audience: 'person' })).data
		).toEqual({ on: false, by: 'person' });
		expect(await stateOf(kernel)).toBe('gated');
	});

	it('P4-E15: P4-E5: keeps the gates over a reload of the same store, and replays a session with no difference', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const first = await workspace({ store, journal });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await first.kernel.call('experiment-disable', { experiment: PANE, audience: 'person' });
		await first.kernel.dispose();
		const second = await workspace({ store, empty: true });
		expect(await stateOf(second.kernel)).toBe('ready');
		expect((await detail(second.kernel)).gates.inspector?.open).toBe(false);
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment() as never,
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe('P4-E5: an owner turns one on for the workspace, and a person steps out (5.2, D155)', () => {
	it('is on for everyone until a person opts out, and tells them', async () => {
		const { kernel, store } = await workspace();
		expect(
			(await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' })).data
		).toEqual({ on: true, by: 'workspace' });
		expect(await tableOf(store)).toEqual([
			expect.objectContaining({ id: `personal/${PANE}`, experiment: PANE, updatedBy: 'local' }),
		]);
		expect(await notices(store)).toEqual(['Probe pane is on for the workspace']);
		expect(
			(await kernel.call('experiment-disable', { experiment: PANE, audience: 'person' })).data
		).toEqual({ on: false, by: 'person' });
		expect((await kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: false,
			by: 'person',
		});
		const [pane] = await list(kernel, { experiment: PANE });
		expect(pane).toMatchObject({ workspace: true, on: false, by: 'person' });
		// The opt-out holds when the owner turns it off and on again (D155).
		await kernel.call('experiment-disable', { experiment: PANE, audience: 'workspace' });
		await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		expect((await kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: false,
			by: 'person',
		});
		// Told once; a person who stepped out is told nothing more of it (5.2).
		expect(await notices(store)).toEqual(['Probe pane is on for the workspace']);
	});

	it("tells a person still on it that the owner turned it off for the workspace (5.2's notices)", async () => {
		const { kernel, store } = await workspace();
		await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		// Off for everyone, by no one's own choice: `by` names none.
		expect(
			(await kernel.call('experiment-disable', { experiment: PANE, audience: 'workspace' })).data
		).toEqual({ on: false, by: null });
		expect(await notices(store)).toEqual([
			'Probe pane is on for the workspace',
			'Probe pane is off for the workspace',
		]);
		expect((await kernel.call('experiment-check', { experiment: PANE })).data).toMatchObject({
			on: false,
		});
	});

	it('with two people, an owner and a member: OWNER_REQUIRED, the workspace for both, the opt-out for one', async () => {
		const { kernel } = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(kernel, 'bea@example.com');
		const refused = await kernel.call('experiment-enable', {
			experiment: PANE,
			audience: 'workspace',
		});
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
		expect(refused.error?.suggestion).toBeTruthy();
		expect(
			(await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' })).data
		).toEqual({ on: true, by: 'person' });
		expect(await stateOf(kernel)).toBe('ready');
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'olu@example.com');
		// Bea's own enablement is hers: Olu's shell holds the app out.
		expect(await stateOf(kernel)).toBe('gated');
		expect(
			(await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' })).data
		).toEqual({ on: true, by: 'workspace' });
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		expect((await kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: true,
			by: 'workspace',
		});
		await kernel.call('experiment-disable', { experiment: PANE, audience: 'person' });
		expect((await kernel.call('experiment-check', { experiment: PANE })).data?.valueOf()).toEqual({
			on: false,
			by: 'person',
		});
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'olu@example.com');
		expect((await kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: true,
			by: 'workspace',
		});
	});
});

describe('P4-E5: who may call, and the codes (5.4, 3.2, 16)', () => {
	it("P4-E5: P4-E1: hands an agent off to the person's place, with details (F2)", async () => {
		const { kernel } = await workspace();
		for (const audience of ['person', 'workspace'] as const) {
			for (const name of ['experiment-enable', 'experiment-disable']) {
				const refused = await kernel.agent.call(name, { experiment: BETA, audience });
				expect(refused.error?.code).toBe('HUMAN_REQUIRED');
				expect(refused.error?.details).toEqual({
					route: '~/settings/loam.experiments',
					section: 'loam.experiments',
					key: BETA,
					level: audience,
				});
				expect(refused.error?.suggestion).toContain('~/settings/loam.experiments');
			}
		}
		// An agent reads them, as a person does.
		expect((await kernel.agent.call('experiment-check', { experiment: BETA })).data).toEqual({
			on: false,
			by: null,
		});
		expect(await list(kernel)).toHaveLength(2);
	});

	it('lets an app check only its own experiments, and no app write one', async () => {
		const { kernel } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const port = kernel.appPort('probe');
		expect((await port.call('experiment-check', { experiment: BETA })).data).toEqual({
			on: true,
			by: 'person',
		});
		for (const experiment of ['dual.anything', 'tasks.beta']) {
			const refused = await port.call('experiment-check', { experiment });
			expect(refused.error?.code).toBe('EXPERIMENT_NOT_OWNED');
			expect(refused.error?.suggestion).toBeTruthy();
		}
		expect(
			(await port.call('experiment-enable', { experiment: BETA, audience: 'person' })).error?.code
		).toBe('CALL_NOT_GRANTED');
	});

	it('answers an unknown and a hidden id the same, and refuses to turn either on', async () => {
		const { kernel } = await workspace({
			manifest: gatedProbe([
				experiment('beta'),
				experiment('pane'),
				experiment('secret', { stage: 'hidden' }),
				experiment('gone', { stage: 'removed' }),
				experiment('done', { stage: 'graduated' }),
			]),
		});
		const unknown = await kernel.call('experiment-check', { experiment: 'probe.nothing' });
		for (const id of ['probe.secret', 'probe.gone'])
			expect(JSON.stringify((await kernel.call('experiment-check', { experiment: id })).data)).toBe(
				JSON.stringify(unknown.data)
			);
		expect((await kernel.call('experiment-check', { experiment: 'probe.done' })).data).toEqual({
			on: true,
			by: 'stage',
		});
		for (const id of ['probe.nothing', 'probe.secret', 'probe.gone']) {
			const refused = await kernel.call('experiment-enable', {
				experiment: id,
				audience: 'person',
			});
			expect(refused.error?.code, id).toBe('EXPERIMENT_NOT_FOUND');
			expect(refused.error?.suggestion).toContain('experiment-list');
		}
		expect((await list(kernel)).map(({ fullId }) => fullId)).toEqual([BETA, PANE, 'probe.done']);
		// An author in `local` lists the hidden one too.
		expect((await list(kernel, { hidden: true })).map(({ fullId }) => fullId)).toContain(
			'probe.secret'
		);
		const bad = await kernel.call('experiment-check', { experiment: 'probe/../x' });
		expect(bad.error?.code).toBe('VALIDATION_ERROR');
	});

	it('warns of an experiment past its end, and turns nothing off', async () => {
		const { kernel } = await workspace({
			manifest: gatedProbe([experiment('beta', { ends: '2025-12-31' }), experiment('pane')]),
		});
		const listed = await kernel.call<{ experiments: Row[] }>('experiment-list');
		expect(listed.data?.experiments[0]).toMatchObject({ fullId: BETA, overdue: true });
		expect(listed.warnings).toEqual([
			expect.objectContaining({
				code: 'EXPERIMENT_OVERDUE',
				message: expect.stringContaining(BETA),
			}),
		]);
		expect(
			(await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' })).data
		).toEqual({ on: true, by: 'person' });
	});

	it('P4-E5: P4-E17: refuses a workspace enablement on a hosted provider deployment, journaled, and keeps the person’s', async () => {
		const hosted = {
			...deployment(),
			deployment_version: 4,
			generation: 'hosted',
			host: { kind: 'hosted', kernel: 'api/kernel' },
		} as unknown as ProjectionV3;
		const { kernel, store, journal } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: hosted,
		});
		await signIn(kernel, 'olu@example.com');
		for (const name of ['experiment-enable', 'experiment-disable']) {
			const refused = await kernel.call(name, { experiment: PANE, audience: 'workspace' });
			expect(refused.error?.code, name).toBe('SHARED_RECORD_UNAVAILABLE');
		}
		expect(await tableOf(store)).toEqual([]);
		expect(
			(await journal.read())
				.filter(
					({ command }) => command.startsWith('experiment-') && command !== 'experiment-settle'
				)
				.map(({ result }) => result?.error?.code)
		).toEqual(['SHARED_RECORD_UNAVAILABLE', 'SHARED_RECORD_UNAVAILABLE']);
		expect(
			(await kernel.call('experiment-enable', { experiment: PANE, audience: 'person' })).data
		).toEqual({ on: true, by: 'person' });
		// The person's own disable succeeds too, hosted or not (P4-E17's "person `experiment-*`").
		const off = await kernel.call('experiment-disable', { experiment: PANE, audience: 'person' });
		expect(off.success, JSON.stringify(off.error)).toBe(true);
		expect(
			(await kernel.call<{ on: boolean }>('experiment-check', { experiment: PANE })).data?.on
		).toBe(false);
		// Hidden experiments are an author's, in a local deployment.
		expect((await kernel.call('experiment-list', { hidden: true })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});
});

describe('P4-E5: the changes digest and experiment-settle at the manifest’s apply (5.1, 5.2, I6)', () => {
	it('counts an enablement made for other changes as off, tells once, and turns on again', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'workspace' });
		await first.kernel.dispose();
		const changed = gatedProbe([
			experiment('beta', { changes: 'Shows Probe, its notes and its exports.' }),
			experiment('pane', { changes: 'Adds a wider pane beside a probe note.' }),
		]);
		const second = await workspace({ store, empty: true, manifest: changed });
		const rows = await list(second.kernel);
		expect(rows.map(({ fullId, on, changed: was }) => ({ fullId, on, was }))).toEqual([
			{ fullId: BETA, on: false, was: true },
			{ fullId: PANE, on: false, was: true },
		]);
		expect(await stateOf(second.kernel)).toBe('gated');
		// The person's own enablement, and the workspace's, each told once (5.2).
		const told = (await notices(store)).filter((title) => title.includes('changed'));
		expect(told.sort()).toEqual(['Probe beta has changed', 'Probe pane has changed']);
		await second.kernel.dispose();
		// Told once: the next boot under the same changes tells nothing more.
		const third = await workspace({ store, empty: true, manifest: changed });
		expect((await notices(store)).filter((title) => title.includes('changed'))).toHaveLength(2);
		expect(
			(await third.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' })).data
		).toEqual({ on: true, by: 'person' });
		expect((await list(third.kernel, { experiment: PANE }))[0]).toMatchObject({ changed: false });
	});

	it('P4-E15: P4-E5: deletes a removed experiment’s enablements before any enable, replays, and a re-shipped id revives nothing', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await first.kernel.dispose();
		const removed = gatedProbe([experiment('beta'), experiment('pane', { stage: 'removed' })]);
		const second = await workspace({ store, journal, empty: true, manifest: removed });
		// Its enablements are gone, and its removal is kept as the time it happened (5.1).
		expect(await tableOf(store)).toEqual([
			expect.objectContaining({
				id: `personal/~removed/${PANE}`,
				kind: 'removed',
				experiment: PANE,
			}),
		]);
		const commands = (await journal.read()).map(({ command }) => command);
		const settled = commands.indexOf('experiment-settle');
		expect(settled).toBeGreaterThanOrEqual(0);
		expect(commands.slice(0, settled)).not.toContain('experiment-enable');
		expect((await notices(store)).filter((title) => title.includes('ended'))).toEqual([
			'Probe pane has ended',
		]);
		expect((await second.kernel.call('experiment-list', { experiment: PANE })).data).toEqual({
			experiments: [],
		});
		// P4-E15: the boot that settled replays with no difference, over the manifest that removed it. A replay starts
		// from an empty store, so this shows the settle's entry is answered alike from its recorded input, not the
		// deletion, which the live reads above prove; a replay cannot change the manifest between two boots.
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment() as never,
			ports: ports(removed),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.entries.map(({ command }) => command)).toContain('experiment-settle');
		await second.kernel.dispose();
		const third = await workspace({ store, empty: true });
		expect((await third.kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: false,
			by: null,
		});
	});

	it('keeps the enablements of an app whose package could not be read', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await first.kernel.dispose();
		await workspace({
			store,
			empty: true,
			ports: createFixturePorts(scopedPackages()),
		});
		expect(await tableOf(store)).toHaveLength(1);
	});
});

describe("P4-E5: the reviews' cases (step 9)", () => {
	it('refuses to open an app its experiment holds out, from the palette and an agent (5.3)', async () => {
		const { kernel } = await workspace();
		for (const call of [kernel.call.bind(kernel), kernel.agent.call.bind(kernel.agent)]) {
			const refused = await call('app-open', { instance: 'probe' });
			expect(refused.error?.code).toBe('APP_NOT_READY');
			expect(refused.error?.suggestion).toContain('experiment');
		}
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		expect((await kernel.call('app-open', { instance: 'probe' })).success).toBe(true);
	});

	it("voids another person's enablement at a removal, so a re-shipped id revives it for no one (5.1)", async () => {
		const store = new MemoryAdapter();
		// One clock across the three shells, as a browser's is: each kernel's own would start again.
		let tick = Date.parse('2026-03-01T00:00:00Z');
		const options = {
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			clock: () => tick++,
		} as const;
		const first = await workspace(options);
		await signIn(first.kernel, 'bea@example.com');
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		await first.kernel.dispose();
		// Olu's shell applies the removal; Bea's own record is not this shell's to read.
		const second = await workspace({
			...options,
			manifest: gatedProbe([experiment('beta'), experiment('pane', { stage: 'removed' })]),
		});
		await signIn(second.kernel, 'olu@example.com');
		await second.kernel.dispose();
		// Re-shipped with the same id and changes: Bea's old choice counts for nothing.
		const third = await workspace(options);
		await signIn(third.kernel, 'bea@example.com');
		expect((await third.kernel.call('experiment-check', { experiment: PANE })).data).toEqual({
			on: false,
			by: null,
		});
		expect(
			(await third.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' })).data
		).toEqual({ on: true, by: 'person' });
	});

	it("voids another person's enablement of an id dropped with no removed stage, seen by any shell (5.1)", async () => {
		const store = new MemoryAdapter();
		let tick = Date.parse('2026-03-01T00:00:00Z');
		const options = {
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			clock: () => tick++,
		} as const;
		// A third experiment, which no gate names, so the version that drops it is still a valid manifest.
		const all = [experiment('beta'), experiment('pane'), experiment('extra')];
		const first = await workspace({ ...options, manifest: gatedProbe(all) });
		await signIn(first.kernel, 'bea@example.com');
		await first.kernel.call('experiment-enable', { experiment: 'probe.extra', audience: 'person' });
		await first.kernel.dispose();
		// The next version drops it from `ui.experiments` altogether; Olu's shell, which holds no enablement, boots.
		const second = await workspace({ ...options, manifest: gatedProbe() });
		await signIn(second.kernel, 'olu@example.com');
		await second.kernel.dispose();
		const third = await workspace({ ...options, manifest: gatedProbe(all) });
		await signIn(third.kernel, 'bea@example.com');
		expect(
			(await third.kernel.call('experiment-check', { experiment: 'probe.extra' })).data
		).toEqual({
			on: false,
			by: null,
		});
	});

	it('removes an id dropped a second time, after a re-ship Bea turned on, whoever boots (5.1)', async () => {
		const store = new MemoryAdapter();
		let tick = Date.parse('2026-04-01T00:00:00Z');
		const options = {
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			clock: () => tick++,
		} as const;
		const all = gatedProbe([experiment('beta'), experiment('pane'), experiment('extra')]);
		const boot = async (
			manifest: ManifestV3,
			email: string,
			work?: (kernel: LoamKernel) => Promise<unknown>
		) => {
			const made = await workspace({ ...options, manifest });
			await signIn(made.kernel, email);
			await work?.(made.kernel);
			await made.kernel.dispose();
		};
		await boot(all, 'olu@example.com');
		await boot(gatedProbe(), 'olu@example.com');
		await boot(all, 'bea@example.com', (kernel) =>
			kernel.call('experiment-enable', { experiment: 'probe.extra', audience: 'person' })
		);
		await boot(gatedProbe(), 'olu@example.com');
		const last = await workspace({ ...options, manifest: all });
		await signIn(last.kernel, 'bea@example.com');
		expect(
			(await last.kernel.call('experiment-check', { experiment: 'probe.extra' })).data
		).toEqual({ on: false, by: null });
	});

	it('does not let a stale older shell remove or void a newer version’s experiments (#2114)', async () => {
		const store = new MemoryAdapter();
		let tick = Date.parse('2026-05-01T00:00:00Z');
		const options = {
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			clock: () => tick++,
		} as const;
		const withVersion = (version: string, experiments: Experiment[]): ManifestV3 => {
			const base = gatedProbe(experiments);
			return { ...base, plugin: { ...base.plugin, version } };
		};
		const v1 = withVersion('1.0.0', [experiment('beta'), experiment('pane')]);
		const v2 = withVersion('2.0.0', [experiment('beta'), experiment('pane'), experiment('extra')]);
		const v3 = withVersion('3.0.0', [experiment('beta'), experiment('pane')]);

		// Newer 2.0.0 shell boots and Bea enables its new experiment `probe.extra`.
		const newer = await workspace({ ...options, manifest: v2 });
		await signIn(newer.kernel, 'bea@example.com');
		expect(
			(
				await newer.kernel.call('experiment-enable', {
					experiment: 'probe.extra',
					audience: 'person',
				})
			).data
		).toEqual({ on: true, by: 'person' });
		await newer.kernel.dispose();

		// Stale 1.0.0 shell boots against the same store: must NOT remove `probe.extra` or downgrade `~declared/probe`.
		const stale = await workspace({ ...options, manifest: v1 });
		await signIn(stale.kernel, 'olu@example.com');
		await stale.kernel.dispose();

		// Returning to 2.0.0: Bea's enablement of `probe.extra` is still intact!
		const back = await workspace({ ...options, manifest: v2 });
		await signIn(back.kernel, 'bea@example.com');
		expect(
			(await back.kernel.call('experiment-check', { experiment: 'probe.extra' })).data
		).toEqual({ on: true, by: 'person' });
		await back.kernel.dispose();

		// A real drop in 3.0.0 still removes `probe.extra` and voids Bea's enablement even if 4.0.0 re-ships it.
		const dropped = await workspace({ ...options, manifest: v3 });
		await signIn(dropped.kernel, 'olu@example.com');
		await dropped.kernel.dispose();

		// Another stale 2.0.0 boot after 3.0.0 dropped it must not revive or overwrite `~declared/probe`.
		const stale2 = await workspace({ ...options, manifest: v2 });
		await signIn(stale2.kernel, 'bea@example.com');
		expect(
			(await stale2.kernel.call('experiment-check', { experiment: 'probe.extra' })).data
		).toEqual({ on: false, by: null });
		await stale2.kernel.dispose();

		const v4 = withVersion('4.0.0', [experiment('beta'), experiment('pane'), experiment('extra')]);
		const reshipped = await workspace({ ...options, manifest: v4 });
		await signIn(reshipped.kernel, 'bea@example.com');
		expect(
			(await reshipped.kernel.call('experiment-check', { experiment: 'probe.extra' })).data
		).toEqual({ on: false, by: null });
	});

	it('re-checks recorded versions at commit time during concurrent boots and accepts long SemVer strings (#2114)', async () => {
		const store = new MemoryAdapter();
		const longV2 =
			'2.0.0-prerelease.with.a.very.long.identifier.segment.over.sixty.four.chars+build.20261122';
		const withVersion = (version: string, experiments: Experiment[]): ManifestV3 => {
			const base = gatedProbe(experiments);
			return { ...base, plugin: { ...base.plugin, version } };
		};
		const v1 = withVersion('1.0.0', [experiment('beta'), experiment('pane')]);
		const v2 = withVersion(longV2, [experiment('beta'), experiment('pane'), experiment('extra')]);

		// Seed a legacy store (declared without a version) so v1 plans to drop `probe.extra` and write `1.0.0`.
		await store.create(EXPERIMENT_TABLE, {
			id: 'personal/~declared/probe',
			workspace: 'personal',
			kind: 'declared',
			plugin: 'probe',
			ids: ['probe.beta', 'probe.pane', 'probe.extra'],
		});

		// Intercept v1's settle write: pause right before its `experiment-settle` handler reads the store while v2 boots.
		let pauseV1 = true;
		let v1Paused!: () => void;
		const v1AtSettle = new Promise<void>((resolve) => {
			v1Paused = resolve;
		});
		let resumeV1!: () => void;
		const v1CanCommit = new Promise<void>((resolve) => {
			resumeV1 = resolve;
		});
		let listCalls = 0;
		const origList = store.list.bind(store);
		store.list = (async <T>(table: string, filter?: Parameters<MemoryAdapter['list']>[1]) => {
			if (pauseV1 && table === EXPERIMENT_TABLE) {
				listCalls += 1;
				// Call 1 is settleChanges(); call 2 is inside experiment-settle handler's snapshot().
				if (listCalls === 2) {
					pauseV1 = false;
					v1Paused();
					await v1CanCommit;
				}
			}
			return origList<T>(table, filter);
		}) as typeof store.list;

		const v1Boot = workspace({ store, manifest: v1 });
		await v1AtSettle;

		// While v1's settle is paused after planning, v2 boots, commits longV2, and enables `probe.extra`.
		const v2Shell = await workspace({ store, manifest: v2 });
		expect(
			(
				await v2Shell.kernel.call('experiment-enable', {
					experiment: 'probe.extra',
					audience: 'workspace',
				})
			).data
		).toEqual({ on: true, by: 'workspace' });

		// Now let v1's planned experiment-settle run: commit-time re-check MUST skip removing `probe.extra` and downgrading version!
		resumeV1();
		await v1Boot;

		const check = await v2Shell.kernel.call('experiment-check', { experiment: 'probe.extra' });
		expect(check.data).toEqual({ on: true, by: 'workspace' });
		const declaredRow = await store.get<{ version?: string; ids?: string[] }>(
			EXPERIMENT_TABLE,
			'personal/~declared/probe'
		);
		expect(declaredRow?.version).toBe(longV2);
		expect(declaredRow?.ids).toContain('probe.extra');
	});

	it('does not let a concurrent unlisted legacy shell wipe a newer versioned declaration (#2114)', async () => {
		const store = new MemoryAdapter();
		const withVersion = (version: string, experiments: Experiment[]): ManifestV3 => {
			const base = gatedProbe(experiments);
			return { ...base, plugin: { ...base.plugin, version } };
		};
		const v2 = withVersion('2.0.0', [experiment('beta'), experiment('pane'), experiment('extra')]);
		await store.create(EXPERIMENT_TABLE, {
			id: 'personal/~declared/probe',
			workspace: 'personal',
			kind: 'declared',
			plugin: 'probe',
			ids: ['probe.beta'],
		});

		let pauseUnlisted = true;
		let unlistedPaused!: () => void;
		const atSettle = new Promise<void>((resolve) => {
			unlistedPaused = resolve;
		});
		let resumeUnlisted!: () => void;
		const canCommit = new Promise<void>((resolve) => {
			resumeUnlisted = resolve;
		});
		let listCalls = 0;
		const origList = store.list.bind(store);
		store.list = (async <T>(table: string, filter?: Parameters<MemoryAdapter['list']>[1]) => {
			if (pauseUnlisted && table === EXPERIMENT_TABLE) {
				listCalls += 1;
				if (listCalls === 2) {
					pauseUnlisted = false;
					unlistedPaused();
					await canCommit;
				}
			}
			return origList<T>(table, filter);
		}) as typeof store.list;

		// An older deployment that does not list `probe` plans to remove `probe.beta` with an unversioned `declared`.
		const unlistedBoot = workspace({ store, empty: true, deployment: scopedDeployment() });
		await atSettle;

		// Concurrently, a newer deployment listing `probe@2.0.0` boots and enables `probe.beta`.
		const v2Shell = await workspace({ store, manifest: v2 });
		expect(
			(
				await v2Shell.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).data
		).toEqual({ on: true, by: 'workspace' });

		resumeUnlisted();
		await unlistedBoot;

		expect(
			(await v2Shell.kernel.call('experiment-check', { experiment: 'probe.beta' })).data
		).toEqual({
			on: true,
			by: 'workspace',
		});
		const declaredRow = await store.get<{ version?: string; ids?: string[] }>(
			EXPERIMENT_TABLE,
			'personal/~declared/probe'
		);
		expect(declaredRow?.version).toBe('2.0.0');
		expect(declaredRow?.ids).toContain('probe.beta');
	});

	it('removes the experiments of an app the deployment no longer lists', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await first.kernel.dispose();
		await workspace({ store, empty: true, deployment: scopedDeployment() });
		expect((await tableOf(store)).map(({ kind }) => kind)).toEqual(['removed', 'removed']);
	});

	it('tells each affected person of a workspace change on their own next call (5.2)', async () => {
		const { kernel, store } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
		});
		await signIn(kernel, 'olu@example.com');
		await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		const toBea = (
			await store.list<{ person: string; title: string; source: string }>(NOTIFICATION_TABLE)
		).data.filter((row) => row.person === BEA && row.source === 'shell');
		expect(toBea.map(({ title }) => title)).toEqual(['Probe pane is on for the workspace']);
	});

	it("withdraws a held-out app's pending confirmation at boot (R14)", async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const created = await first.kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (created.data as { id: string }).id;
		const asked = await first.kernel.agent.call('probe-content-set', { document, text: 'agent' });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification;
		await first.kernel.dispose();
		// The experiment's changes changed before the reload, so the app is held out from the first read.
		const second = await workspace({
			store,
			empty: true,
			manifest: gatedProbe([
				experiment('beta', { changes: 'Shows Probe anew.' }),
				experiment('pane'),
			]),
		});
		expect(await stateOf(second.kernel)).toBe('gated');
		expect(
			(await second.kernel.agent.call<{ state: string }>('confirmation-get', { notification })).data
				?.state
		).toBe('withdrawn');
	});

	it('counts a dirty tab whose document cannot be read as the app’s, so no unload loses it (R14)', async () => {
		const { kernel, store } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const created = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (created.data as { id: string }).id;
		await kernel.call('document-open', { document });
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		const get = store.get.bind(store);
		store.get = (async (table: string, id: string) => {
			if (table === 'document') throw new Error('The store is away');
			return get(table, id);
		}) as typeof store.get;
		const refused = await kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'person',
		});
		expect(refused.error?.code).toBe('EDITOR_TAB_DIRTY');
		store.get = get;
	});
});

describe('P4-E5: R14: an unload never loses a dirty tab', () => {
	async function dirtyProbe(options: ScopedWorkspaceOptions = {}) {
		const made = await workspace(options);
		const { kernel } = made;
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'workspace' });
		const created = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (created.data as { id: string }).id;
		expect((await kernel.call('document-open', { document })).success).toBe(true);
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(true);
		return { ...made, document };
	}

	it("refuses the person's own turning off with EDITOR_TAB_DIRTY, naming the tab", async () => {
		const { kernel, document } = await dirtyProbe();
		const refused = await kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'person',
		});
		expect(refused.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect(refused.error?.details).toMatchObject({ tab: 't1', document, instance: 'probe' });
		expect(refused.error?.suggestion).toBeTruthy();
		expect(await stateOf(kernel)).toBe('ready');
		expect((await kernel.call('experiment-check', { experiment: BETA })).data).toEqual({
			on: true,
			by: 'workspace',
		});
	});

	it("defers an owner's turning off until the tab is saved, tells the person, and withdraws the app's pending confirmations", async () => {
		const { kernel, store, document } = await dirtyProbe();
		const asked = await kernel.agent.call('probe-content-set', { document, text: 'agent' });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const off = await kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'workspace',
		});
		expect(off.data).toEqual({ on: false, by: null });
		// Deferred: still loaded, its commands still there, and the person told.
		expect(await stateOf(kernel)).toBe('ready');
		expect((await kernel.call('probe-content-get', { document })).success).toBe(true);
		expect(await notices(store)).toContain('Probe stays open until your changes are saved');
		// Saved: the app unloads, its pending confirmation ends `withdrawn`, and the person is told.
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: false })).success).toBe(true);
		expect(await stateOf(kernel)).toBe('gated');
		expect((await kernel.call('probe-content-get', { document })).success).toBe(false);
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification;
		expect(
			(await kernel.agent.call<{ state: string }>('confirmation-get', { notification })).data?.state
		).toBe('withdrawn');
		expect(await notices(store)).toContain('Probe has closed');
	});

	it('notes that main moved when an unload closes the active app, as every call that moves main does (9.3)', async () => {
		const { kernel } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await kernel.call('app-open', { instance: 'probe' });
		const events: Array<{ command: string; mainChanged?: string }> = [];
		kernel.subscribe((event) => {
			events.push(event as { command: string; mainChanged?: string });
		});
		await kernel.call('experiment-disable', { experiment: BETA, audience: 'person' });
		expect(await stateOf(kernel)).toBe('gated');
		expect(events.find(({ command }) => command === 'experiment-disable')?.mainChanged).toBe(
			'replace'
		);
	});

	it("cancels the app's open dialogs when it unloads", async () => {
		const { kernel } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await kernel.call('app-open', { instance: 'probe' });
		const port = kernel.appPort('probe');
		const opened = await port.call<{ overlayId: string }>('dialog-open', {
			title: 'Pick',
			body: 'Which one?',
		});
		const id = opened.data?.overlayId;
		const listed = async () =>
			(
				(await kernel.call<{ overlays: Array<{ overlayId: string }> }>('overlay-list')).data
					?.overlays ?? []
			).map(({ overlayId }) => overlayId);
		expect(await listed()).toContain(id);
		await kernel.call('experiment-disable', { experiment: BETA, audience: 'person' });
		expect(await listed()).not.toContain(id);
		expect(await stateOf(kernel)).toBe('gated');
		expect(
			(await kernel.call<{ active: string | null }>('app-get', { instance: 'probe' })).success
		).toBe(true);
	});
});

describe('surface-gate layout declaration (#2112)', () => {
	it('undeclares a gated surface until opened, closes it when disabled, and preserves it on reload when enabled', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const first = await workspace({ store, journal });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await first.kernel.call('app-open', { instance: 'probe' });

		// With probe.pane off, opening the inspector or its compact drawer fails LAYOUT_PART_UNDECLARED.
		expect((await first.kernel.call('layout-set', { inspector: { open: true } })).error?.code).toBe(
			'LAYOUT_PART_UNDECLARED'
		);
		expect(
			(await first.kernel.call('layout-set', { compact: { drawer: 'inspector' } })).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
		expect(
			(
				await first.kernel.call('view-state-set', {
					id: 'loam.layout.probe',
					state: { inspector: { open: true } },
				})
			).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
		// Sizing an undeclared part still succeeds, matching normal undeclared parts.
		expect((await first.kernel.call('layout-set', { inspector: { width: 320 } })).success).toBe(
			true
		);

		// Opening the gate declares the part and allows opening the inspector and its drawer.
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		expect((await first.kernel.call('layout-set', { inspector: { open: true } })).success).toBe(
			true
		);
		expect(
			(
				await first.kernel.call<{
					inspector: { open: boolean };
					compact: { drawer: string | null };
				}>('layout-get')
			).data
		).toMatchObject({ inspector: { open: true } });

		// Reloading while the gate is still on keeps the persisted open inspector.
		await first.kernel.dispose();
		const kept = await workspace({ store, empty: true });
		expect(
			(await kept.kernel.call<{ inspector: { open: boolean } }>('layout-get')).data?.inspector.open
		).toBe(true);

		// Closing the gate closes the open inspector and drawer, and refuses reopening.
		await kept.kernel.call('layout-set', { compact: { drawer: 'inspector' } });
		await kept.kernel.call('experiment-disable', { experiment: PANE, audience: 'person' });
		expect(
			(
				await kept.kernel.call<{
					inspector: { open: boolean };
					compact: { drawer: string | null };
				}>('layout-get')
			).data
		).toMatchObject({ inspector: { open: false }, compact: { drawer: null } });
		expect((await kept.kernel.call('layout-set', { inspector: { open: true } })).error?.code).toBe(
			'LAYOUT_PART_UNDECLARED'
		);

		// Replay of the first session matches with zero differences.
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment() as never,
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('closes a persisted open gated part on reload when the gate is off at boot', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		await first.kernel.call('app-open', { instance: 'probe' });
		await first.kernel.call('layout-set', { inspector: { open: true } });
		await first.kernel.dispose();
		// Boot with changed pane experiment text so probe.pane is closed from stage B.
		const second = await workspace({
			store,
			empty: true,
			manifest: gatedProbe([
				experiment('beta'),
				experiment('pane', { changes: 'Adds a changed pane beside a probe note.' }),
			]),
		});
		expect(
			(await second.kernel.call<{ inspector: { open: boolean } }>('layout-get')).data?.inspector
				.open
		).toBe(false);
		expect(
			(await second.kernel.call('layout-set', { inspector: { open: true } })).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
	});

	it('reconciles a lazily hydrated project-scoped layout when the gate was closed before entering the project (#2112)', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'person' });
		const project = (
			(await first.kernel.call<{ id: string }>('project-create', { name: 'Zeta', slug: 'zeta' }))
				.data as { id: string }
		).id;
		await first.kernel.call('scope-set', { project });
		await first.kernel.call('app-open', { instance: 'probe' });
		await first.kernel.call('layout-set', {
			inspector: { open: true },
			compact: { drawer: 'inspector' },
		});
		// Leave Zeta before reloading so Zeta's project-scoped layout is not hydrated at boot.
		await first.kernel.call('scope-set', { project: null });
		await first.kernel.dispose();

		const second = await workspace({ store, empty: true });
		await second.kernel.call('experiment-disable', { experiment: PANE, audience: 'person' });
		await second.kernel.call('scope-set', { project });
		await second.kernel.call('app-open', { instance: 'probe' });
		expect((await detail(second.kernel)).gates.inspector?.open).toBe(false);
		expect(
			(
				await second.kernel.call<{
					inspector: { open: boolean };
					compact: { drawer: string | null };
				}>('layout-get')
			).data
		).toMatchObject({ inspector: { open: false }, compact: { drawer: null } });
		expect(
			(await second.kernel.call('layout-set', { inspector: { open: true } })).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
	});
});

describe('held-out app closes its documents tabs and unregisters its types (#2113)', () => {
	const tabsOf = async (kernel: LoamKernel) =>
		(
			(await kernel.call<{ groups: Array<{ tabs: Array<{ document: string }> }> }>('editor-get'))
				.data?.groups ?? []
		).flatMap((group) => group.tabs.map((tab) => tab.document));

	it('closes clean probe tabs across workspace and project scopes on disable while preserving documents', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const { kernel } = await workspace({ store, journal });
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const typesWhileOn = (
			await kernel.call<{ types: Array<{ id: string }> }>('document-type-list', { all: true })
		).data?.types.map((type) => type.id);
		expect(typesWhileOn).toContain('probe');

		// Open one probe tab in workspace scope and one in a project scope.
		const wsDoc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('document-open', { document: wsDoc });
		expect(await tabsOf(kernel)).toEqual([wsDoc]);

		const project = (
			(await kernel.call<{ id: string }>('project-create', { name: 'Gamma', slug: 'gamma' }))
				.data as { id: string }
		).id;
		await kernel.call('scope-set', { project });
		const projDoc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('document-open', { document: projDoc });
		expect(await tabsOf(kernel)).toEqual([projDoc]);

		// Turning probe.beta off closes clean probe tabs in both scopes and unregisters the type.
		await kernel.call('experiment-disable', { experiment: BETA, audience: 'person' });
		expect(await stateOf(kernel)).toBe('gated');
		expect(await tabsOf(kernel)).toEqual([]);
		await kernel.call('scope-set', { project: null });
		expect(await tabsOf(kernel)).toEqual([]);
		const typesWhileOff = (
			await kernel.call<{ types: Array<{ id: string }> }>('document-type-list', { all: true })
		).data?.types.map((type) => type.id);
		expect(typesWhileOff).not.toContain('probe');

		// Both documents remain intact in the store and can be reopened once the experiment is back on.
		expect(await store.get('document', wsDoc)).toBeTruthy();
		expect(await store.get('document', projDoc)).toBeTruthy();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		expect((await kernel.call('document-open', { document: wsDoc })).success).toBe(true);

		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment() as never,
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('closes a deferred dirty tab once it is saved and drops persisted tabs on boot when gated', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'workspace' });
		const wsDoc = (
			(await first.kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await first.kernel.call('document-open', { document: wsDoc });
		await first.kernel.call('editor-dirty-set', { tab: 't1', dirty: true });

		// Deferred disable keeps the dirty tab open until saved.
		await first.kernel.call('experiment-disable', { experiment: BETA, audience: 'workspace' });
		expect(await tabsOf(first.kernel)).toEqual([wsDoc]);
		await first.kernel.call('editor-dirty-set', { tab: 't1', dirty: false });
		expect(await stateOf(first.kernel)).toBe('gated');
		expect(await tabsOf(first.kernel)).toEqual([]);

		// Re-enable, open persisted tabs in workspace and project scopes, then reload with gate off.
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await first.kernel.call('document-open', { document: wsDoc });
		const project = (
			(await first.kernel.call<{ id: string }>('project-create', { name: 'Delta', slug: 'delta' }))
				.data as { id: string }
		).id;
		await first.kernel.call('scope-set', { project });
		const projDoc = (
			(await first.kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await first.kernel.call('document-open', { document: projDoc });
		await first.kernel.dispose();

		const second = await workspace({
			store,
			empty: true,
			manifest: gatedProbe([
				experiment('beta', { changes: 'Shows Probe with new notes.' }),
				experiment('pane'),
			]),
		});
		expect(await stateOf(second.kernel)).toBe('gated');
		expect(await tabsOf(second.kernel)).toEqual([]);
		await second.kernel.call('scope-set', { project: null });
		expect(await tabsOf(second.kernel)).toEqual([]);
		expect(await store.get('document', wsDoc)).toBeTruthy();
		expect(await store.get('document', projDoc)).toBeTruthy();
	});

	it('refuses document-open for a gated document type without moving scope, main, or allocating a tab (#2113)', async () => {
		const { kernel } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const project = (
			(await kernel.call<{ id: string }>('project-create', { name: 'Eta', slug: 'eta' })).data as {
				id: string;
			}
		).id;
		await kernel.call('scope-set', { project });
		const doc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('scope-set', { project: null });
		await kernel.call('experiment-disable', { experiment: BETA, audience: 'person' });

		const opened = await kernel.call('document-open', { document: doc });
		expect(opened.success).toBe(false);
		expect(opened.error?.code).toBe('APP_NOT_READY');
		expect(opened.error?.suggestion).toContain('experiment-enable');
		// Active scope stayed at workspace level and no tab was allocated in Eta.
		expect(
			(await kernel.call<{ scope: { project?: string } }>('scope-get')).data?.scope.project
		).toBeUndefined();
		await kernel.call('scope-set', { project });
		expect(await tabsOf(kernel)).toEqual([]);
	});

	it('closes persisted tabs in unvisited project scopes so disable then re-enable does not resurrect them (#2113)', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store });
		await first.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const project = (
			(await first.kernel.call<{ id: string }>('project-create', { name: 'Theta', slug: 'theta' }))
				.data as { id: string }
		).id;
		await first.kernel.call('scope-set', { project });
		const doc = (
			(await first.kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await first.kernel.call('document-open', { document: doc });
		await first.kernel.call('scope-set', { project: null });
		await first.kernel.dispose();

		const second = await workspace({ store, empty: true });
		await second.kernel.call('experiment-disable', { experiment: BETA, audience: 'person' });
		await second.kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await second.kernel.call('scope-set', { project });
		expect(await tabsOf(second.kernel)).toEqual([]);
	});

	it('defers unload when a tab becomes dirty mid-closeApp and retries cleanly after a failed document read (#2113, R14)', async () => {
		const { kernel, store } = await workspace();
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'workspace' });
		const doc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('document-open', { document: doc });

		// 1. Interleave editor-dirty-set { dirty: true } while closeApp awaits store.get('document', doc).
		const origGet = store.get.bind(store);
		let releaseRead!: () => void;
		let hitRead = false;
		let resolveHit!: () => void;
		const hit = new Promise<void>((resolve) => {
			resolveHit = resolve;
		});
		store.get = (async (table: string, id: string) => {
			if (table === 'document' && id === doc && !hitRead) {
				hitRead = true;
				resolveHit();
				await new Promise<void>((resolve) => {
					releaseRead = resolve;
				});
			}
			return origGet(table, id);
		}) as typeof store.get;

		const disabling = kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'workspace',
		});
		await hit;
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(true);
		releaseRead();
		await disabling;
		store.get = origGet;

		// Must have deferred unload (R14): app stays ready and dirty tab stays open until saved.
		expect(await stateOf(kernel)).toBe('ready');
		expect(await tabsOf(kernel)).toEqual([doc]);
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: false })).success).toBe(true);
		expect(await stateOf(kernel)).toBe('gated');
		expect(await tabsOf(kernel)).toEqual([]);

		// 2. Re-enable, open tab, fail one document read during disable, then retry disable cleanly.
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		await kernel.call('document-open', { document: doc });
		let failOnce = true;
		store.get = (async (table: string, id: string) => {
			if (table === 'document' && id === doc && failOnce) {
				failOnce = false;
				throw new Error('transient store read failure');
			}
			return origGet(table, id);
		}) as typeof store.get;
		const failed = await kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'person',
		});
		store.get = origGet;
		expect(failed.success).toBe(false);
		// Unrelated reads (app-list, editor-get) must stay healthy and not silently run the retry; probe stays ready
		// with its tab still open until experiment-disable is retried.
		expect(await stateOf(kernel)).toBe('ready');
		expect(await tabsOf(kernel)).toEqual([doc]);
		expect(await stateOf(kernel)).toBe('ready');

		const retried = await kernel.call('experiment-disable', {
			experiment: BETA,
			audience: 'person',
		});
		expect(retried.success).toBe(true);
		expect(await stateOf(kernel)).toBe('gated');
		expect(await tabsOf(kernel)).toEqual([]);
		expect(
			(await kernel.listCommands()).some((command) => command.name === 'probe-content-get')
		).toBe(false);
	});

	it('preserves an arriving person’s enabled gated tabs and closes disabled ones/layouts on person switch in provider mode (#2113, #2112)', async () => {
		const store = new MemoryAdapter();
		const SAM = 'mock-user-sam@example.com';
		const membership: MembershipV1 = {
			mode: 'provider',
			members: new Map([
				[BEA, 'member'],
				[OLU, 'owner'],
				[SAM, 'owner'],
			]),
			digest: 'd1',
		};
		const { kernel } = await workspace({
			store,
			identity: PROVIDER,
			membership,
			empty: true,
		});
		// Olu (owner) enables BETA and PANE for the workspace, opens a probe tab and probe's gated inspector.
		await signIn(kernel, 'olu@example.com');
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'workspace' });
		await kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		const oluDoc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('document-open', { document: oluDoc });
		await kernel.call('app-open', { instance: 'probe' });
		await kernel.call('layout-set', { inspector: { open: true } });
		expect(await tabsOf(kernel)).toEqual([oluDoc]);

		// Bea enables BETA for herself and opens her own probe tab.
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		const beaDoc = (
			(await kernel.call<{ id: string }>('document-create', { type: 'probe' })).data as {
				id: string;
			}
		).id;
		await kernel.call('document-open', { document: beaDoc });
		expect(await tabsOf(kernel)).toEqual([beaDoc]);

		// Sam (second owner) turns BETA and PANE off for the workspace so both leaving (Sam) and arriving (Olu) have
		// BETA and PANE off (`gatedApps` already holds `probe`).
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'sam@example.com');
		await kernel.call('experiment-disable', { experiment: PANE, audience: 'workspace' });
		await kernel.call('experiment-disable', { experiment: BETA, audience: 'workspace' });
		expect(await stateOf(kernel)).toBe('gated');

		// Olu signs back in while both gates are already off: Olu's persisted probe tab must close and Olu's
		// persisted inspector must reconcile closed.
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'olu@example.com');
		expect(await stateOf(kernel)).toBe('gated');
		expect(await tabsOf(kernel)).toEqual([]);
		// Verify inspector reconciled closed immediately on sign-in, before any experiment-enable runs.
		expect(
			(
				await kernel.call<{ state: { inspector: { open: boolean } } }>('view-state-get', {
					id: 'loam.layout.probe',
				})
			).data?.state.inspector.open
		).toBe(false);
		await kernel.call('experiment-enable', { experiment: BETA, audience: 'person' });
		expect(await tabsOf(kernel)).toEqual([]);
		await kernel.call('app-open', { instance: 'probe' });
		expect(
			(await kernel.call<{ inspector: { open: boolean } }>('layout-get')).data?.inspector.open
		).toBe(false);

		// Switch to Bea (who still has BETA enabled for herself): Bea's persisted probe tab is preserved!
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		expect(await stateOf(kernel)).toBe('ready');
		expect(await tabsOf(kernel)).toEqual([beaDoc]);
	});
});

describe('#2115: experiment-settle tolerates a racing tab creating removal or declared rows', () => {
	it('treats an existing removal or declared row created between snapshot and write as settled', async () => {
		const store = new MemoryAdapter();
		const realCreate = store.create.bind(store);
		const racedIds: string[] = [];
		// Simulate another tab settling and creating both the declared row (on first boot) and the removal row
		// (on removal boot) between this tab's snapshot read and its `store.create` call.
		const wrapRace = () => {
			store.create = (async <T>(table: string, data: Partial<T>): Promise<T> => {
				if (table === EXPERIMENT_TABLE) {
					const id = (data as { id?: string }).id;
					if (id && (id.includes('/~removed/') || id.includes('/~declared/'))) {
						racedIds.push(id);
						await realCreate(table, data);
						throw new Error(`ConstraintError: Key already exists (${id})`);
					}
				}
				return realCreate(table, data);
			}) as typeof store.create;
		};

		// First boot: `personal/~declared/probe` is absent at snapshot and created by another tab before `create`.
		wrapRace();
		const firstJournal = new MemoryJournalSink();
		const first = await workspace({ store, journal: firstJournal });
		store.create = realCreate;
		expect(racedIds).toContain('personal/~declared/probe');
		expect(
			(await firstJournal.read()).find((entry) => entry.command === 'experiment-settle')?.result
				.success
		).toBe(true);

		await first.kernel.call('experiment-enable', { experiment: PANE, audience: 'workspace' });
		await first.kernel.dispose();

		// Removal boot: `personal/~removed/probe.pane` is absent at snapshot and created by another tab before `create`.
		wrapRace();
		const journal = new MemoryJournalSink();
		const removed = gatedProbe([experiment('beta'), experiment('pane', { stage: 'removed' })]);
		const second = await workspace({ store, journal, empty: true, manifest: removed });
		store.create = realCreate;

		expect(racedIds).toContain(`personal/~removed/${PANE}`);
		const settleEntry = (await journal.read()).find(
			(entry) => entry.command === 'experiment-settle'
		);
		expect(settleEntry?.result.success).toBe(true);
		expect(await tableOf(store)).toEqual([
			expect.objectContaining({
				id: `personal/~removed/${PANE}`,
				kind: 'removed',
				experiment: PANE,
			}),
		]);
		await second.kernel.dispose();
	});

	it('still surfaces a store.create failure when the row does not exist in the store', async () => {
		const store = new MemoryAdapter();
		const realCreate = store.create.bind(store);
		store.create = (async <T>(table: string, data: Partial<T>): Promise<T> => {
			if (table === EXPERIMENT_TABLE && (data as { id?: string }).id?.includes('/~declared/')) {
				throw new Error('Disk full');
			}
			return realCreate(table, data);
		}) as typeof store.create;

		const journal = new MemoryJournalSink();
		const booted = await workspace({ store, journal, empty: true });
		store.create = realCreate;

		const settleEntry = (await journal.read()).find(
			(entry) => entry.command === 'experiment-settle'
		);
		expect(settleEntry?.result.success).toBe(false);
		await booted.kernel.dispose();
	});
});

describe('#2116: boot stops journaling experiment-settle once declared rows are current', () => {
	it('stops journaling experiment-settle on subsequent boots for an unlisted plugin', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store, empty: true });
		await first.kernel.dispose();

		const withoutProbe = deployment({ apps: scopedDeployment().apps });
		// Unlist the plugin: transition boot settles to clear its declared ids.
		const unlistedJournal = new MemoryJournalSink();
		const unlisted = await workspace({
			store,
			journal: unlistedJournal,
			empty: true,
			deployment: withoutProbe,
		});
		expect(
			(await unlistedJournal.read()).filter((entry) => entry.command === 'experiment-settle').length
		).toBeGreaterThanOrEqual(1);
		await unlisted.kernel.dispose();

		// Subsequent boot with the same unlisted deployment must not journal experiment-settle again.
		const steadyJournal = new MemoryJournalSink();
		const steady = await workspace({
			store,
			journal: steadyJournal,
			empty: true,
			deployment: withoutProbe,
		});
		expect(
			(await steadyJournal.read()).filter((entry) => entry.command === 'experiment-settle')
		).toEqual([]);
		await steady.kernel.dispose();
	});

	it('stops journaling experiment-settle on subsequent boots for a removed-stage experiment', async () => {
		const store = new MemoryAdapter();
		const removed = gatedProbe([experiment('beta'), experiment('pane', { stage: 'removed' })]);
		const firstJournal = new MemoryJournalSink();
		const first = await workspace({ store, journal: firstJournal, empty: true, manifest: removed });
		expect(
			(await firstJournal.read()).filter((entry) => entry.command === 'experiment-settle').length
		).toBeGreaterThanOrEqual(1);
		await first.kernel.dispose();

		// Subsequent boot with the same removed-stage manifest must not journal experiment-settle again.
		const steadyJournal = new MemoryJournalSink();
		const steady = await workspace({
			store,
			journal: steadyJournal,
			empty: true,
			manifest: removed,
		});
		expect(
			(await steadyJournal.read()).filter((entry) => entry.command === 'experiment-settle')
		).toEqual([]);
		await steady.kernel.dispose();
	});

	it('does not journal experiment-settle for a plugin with no experiments once current', async () => {
		const store = new MemoryAdapter();

		// A plugin that never declared experiments never triggers experiment-settle.
		const initialJournal = new MemoryJournalSink();
		const initial = await workspace({
			store,
			journal: initialJournal,
			empty: true,
			manifest: PROBE_DOCUMENTS_MANIFEST,
		});
		expect(
			(await initialJournal.read()).filter((entry) => entry.command === 'experiment-settle')
		).toEqual([]);
		await initial.kernel.dispose();

		// A plugin that previously declared experiments and then drops all of them settles once, then stops.
		const withExp = await workspace({ store, empty: true });
		await withExp.kernel.dispose();

		const droppedJournal = new MemoryJournalSink();
		const dropped = await workspace({
			store,
			journal: droppedJournal,
			empty: true,
			manifest: PROBE_DOCUMENTS_MANIFEST,
		});
		expect(
			(await droppedJournal.read()).filter((entry) => entry.command === 'experiment-settle').length
		).toBeGreaterThanOrEqual(1);
		await dropped.kernel.dispose();

		const steadyJournal = new MemoryJournalSink();
		const steady = await workspace({
			store,
			journal: steadyJournal,
			empty: true,
			manifest: PROBE_DOCUMENTS_MANIFEST,
		});
		expect(
			(await steadyJournal.read()).filter((entry) => entry.command === 'experiment-settle')
		).toEqual([]);
		await steady.kernel.dispose();
	});
});
