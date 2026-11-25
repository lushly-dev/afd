/**
 * Phase 4's inbox (its section 10, P4-E6's units): `source` on each path, actions and their refusals, the rates (10 a
 * minute for an app, 5 for an agent's toasts and notices together), the quota of 500 and what it never drops, the
 * list's page, cursor, `body` and budget, read and archive with R10's protection of a pending confirmation,
 * `notification-act`, a sticky toast landing and counting, `toastSticky` and `muted`, the scope filter, and replay.
 */
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { NotificationV1, OverlayRefV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { HUMAN_COMMANDS } from '../identity/identity-commands.js';
import { createKernel, createKernelParts } from '../kernel.js';
import { DOCUMENT_KIT } from '../late/command-kit.js';
import { createPushRate } from '../overlays/push-rate.js';
import { personKey } from '../scope/access.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createScopedWorkspace,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	replayKernel,
} from '../testing.js';
import type { LoamKernel } from '../types.js';
import {
	createNotifications,
	NOTIFICATION_LIST_BUDGET,
	NOTIFICATION_QUOTA,
	NOTIFICATION_TABLE,
	orphanNotice,
	orphanRecipients,
} from './notifications.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const sumsManifest = {
	...PROBE_MANIFEST,
	plugin: { ...PROBE_MANIFEST.plugin, id: 'sums', title: 'Sums', domains: ['sums'] },
	commands: [],
	grants: [],
	config: undefined,
	ui: { surfaces: { main: { element: 'sums-main' } } },
} as unknown as typeof PROBE_MANIFEST;

const entry = (instance: string) => ({ instance, app: instance, package: `apps/${instance}/` });
const ports = () =>
	createFixturePorts({
		'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
	});

/** A `local` kernel with probe and sums, on a clock the test moves, and its store and journal. */
async function boot() {
	let now = 1_800_000_000_000;
	const journal = new MemoryJournalSink();
	const store = new MemoryAdapter();
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter({ clock: { now: () => now } }),
		environment: createFixedEnvironment(),
		host: 'test',
		clock: () => now,
		deployment: probeDeployment([entry('probe'), entry('sums')]),
		ports: ports(),
		overlayAnchors: { resolve: () => true },
	});
	kernels.push(kernel);
	await kernel.appsReady;
	return {
		kernel,
		journal,
		store,
		probe: kernel.appPort('probe'),
		sums: kernel.appPort('sums'),
		advance: (ms: number) => {
			now += ms;
		},
	};
}

type Listed = { notifications: NotificationV1[]; cursor: string | null; unread: number };
const listed = async (kernel: LoamKernel, input: Record<string, unknown> = {}) =>
	(await kernel.call<Listed>('notification-list', input)).data as Listed;
const overlays = async (kernel: LoamKernel) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];

/** A row written straight to the store, as a later step's confirmation or an old notice would be. */
const row = (id: number, fields: Partial<NotificationV1> = {}): NotificationV1 => ({
	id: `ntf_${String(id).padStart(16, '0')}`,
	workspace: 'personal',
	person: 'local',
	source: 'probe',
	kind: 'notice',
	title: `Notice ${id}`,
	tone: 'info',
	scope: { workspace: 'personal' },
	createdAt: 1_700_000_000_000 + id,
	...fields,
});
const pending = (id: number) =>
	row(id, {
		kind: 'confirmation',
		source: 'agent:shell-agent',
		confirmation: {
			command: 'probe-note',
			caller: 'agent:shell-agent',
			input: {},
			header: 'Requested by shell-agent for you',
			prompt: 'Note it?',
			title: 'Note',
			expiresAt: 1_900_000_000_000,
			state: 'pending',
		},
	});

describe('P4-E6: source, derived from the path (10.1)', () => {
	it("is the port's instance, the agent interface's agent:<id>, and the person's own shell", async () => {
		const { kernel, probe } = await boot();
		const fromApp = await probe.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Counted',
		});
		const fromAgent = await kernel.agent.call<{ notification: NotificationV1 }>(
			'notification-push',
			{ title: 'Filed' }
		);
		const fromPerson = await kernel.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Remember the milk',
		});
		expect(fromApp.data?.notification).toMatchObject({
			source: 'probe',
			kind: 'notice',
			tone: 'info',
			person: 'local',
			workspace: 'personal',
			scope: { workspace: 'personal' },
		});
		expect(fromApp.data?.notification.id).toMatch(/^ntf_[a-z0-9]{16}$/);
		expect(fromAgent.data?.notification.source).toBe('agent:shell-agent');
		expect(fromPerson.data?.notification.source).toBe('shell');
	});

	it('takes no source, nor any field outside 10.2, from the input', async () => {
		const { kernel, probe } = await boot();
		for (const extra of [{ source: 'shell' }, { kind: 'confirmation' }, { person: 'someone' }]) {
			const refused = await probe.call('notification-push', { title: 'x', ...extra });
			expect(refused.error?.code, JSON.stringify(extra)).toBe('VALIDATION_ERROR');
		}
		expect((await listed(kernel)).notifications).toEqual([]);
	});
});

describe('P4-E6: actions (10.1)', () => {
	it("takes the app's own palette command, and refuses a person's, another app's or an unlisted one", async () => {
		const { kernel, probe, sums } = await boot();
		const own = await probe.call('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'from the inbox' } },
		});
		expect(own.success).toBe(true);
		expect(HUMAN_COMMANDS).toContain('persona-set');
		const reserved = await probe.call('notification-push', {
			title: 'Switch',
			action: { command: 'persona-set', label: 'Switch', input: { persona: 'default' } },
		});
		expect(reserved.error).toMatchObject({
			code: 'OVERLAY_ITEM_RESERVED',
			suggestion: expect.stringContaining('palette'),
			details: { command: 'persona-set' },
		});
		const foreign = await sums.call('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'x' } },
		});
		expect(foreign.error).toMatchObject({
			code: 'NOTIFICATION_ACTION_FOREIGN',
			suggestion: expect.stringContaining('own'),
		});
		const unlisted = await probe.call('notification-push', {
			title: 'Hidden',
			action: { command: 'probe-hidden', label: 'Run' },
		});
		expect(unlisted.error?.code).toBe('NOTIFICATION_ACTION_FOREIGN');
		const invalid = await probe.call('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 5 } },
		});
		expect(invalid.error?.code).toBe('VALIDATION_ERROR');
		const notObject = await probe.call('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: ['x'] },
		});
		expect(notObject.error?.code).toBe('VALIDATION_ERROR');
		const large = await probe.call('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'x'.repeat(4096) } },
		});
		expect(large.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { limit: 2048 } });
		expect((await listed(kernel)).unread).toBe(1);
	});

	it("refuses an agent's action, but keeps its link", async () => {
		const { kernel } = await boot();
		const refused = await kernel.agent.call('notification-push', {
			title: 'Reset?',
			action: { command: 'probe-note', label: 'Note', input: { text: 'x' } },
		});
		expect(refused.error).toMatchObject({
			code: 'NOTIFICATION_ACTION_UNAVAILABLE',
			suggestion: expect.stringContaining('link'),
		});
		const link = { kind: 'app', instance: 'probe', scope: { workspace: 'personal' } };
		const kept = await kernel.agent.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Look at the probe',
			link,
		});
		expect(kept.data?.notification).toMatchObject({ source: 'agent:shell-agent', link });
		expect(kept.data?.notification).not.toHaveProperty('action');
	});

	it('runs the action as the person, marks the notice done and read, and runs it once', async () => {
		const { kernel, probe } = await boot();
		const pushed = await probe.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'from the inbox' } },
		});
		const id = pushed.data?.notification.id as string;
		const acted = await kernel.call<{ state: string }>('notification-act', { notification: id });
		expect(acted.data).toMatchObject({ state: 'done' });
		const notes = await kernel.call<{ items: Array<{ text?: string; title?: string }> }>(
			'probe-list'
		);
		expect(JSON.stringify(notes.data)).toContain('from the inbox');
		const after = await listed(kernel);
		expect(after.unread).toBe(0);
		expect(after.notifications[0]).toMatchObject({ id, state: 'done', readAt: expect.any(Number) });
		// Again: done, and nothing runs twice.
		const again = await kernel.call<{ state: string; result?: unknown }>('notification-act', {
			notification: id,
		});
		expect(again.data).toEqual({ state: 'done' });
		const twice = await kernel.call('probe-list');
		expect(JSON.stringify(twice.data).split('from the inbox').length).toBe(2);
	});

	it("refuses an agent's act, an answer on a notice, a notice with no action and another's", async () => {
		const { kernel, probe } = await boot();
		const plain = await probe.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Just so you know',
		});
		const id = plain.data?.notification.id as string;
		expect((await kernel.agent.call('notification-act', { notification: id })).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		expect(
			(await kernel.call('notification-act', { notification: id, answer: 'confirm' })).error?.code
		).toBe('VALIDATION_ERROR');
		expect((await kernel.call('notification-act', { notification: id })).error).toMatchObject({
			code: 'NOTIFICATION_ACTION_UNAVAILABLE',
			suggestion: expect.any(String),
		});
		expect(
			(await kernel.call('notification-act', { notification: 'ntf_zzzzzzzzzzzzzzzz' })).error?.code
		).toBe('NOTIFICATION_NOT_FOUND');
		// An app pushes and never reads or acts: `notification-act` and the reads are not app-callable.
		for (const name of ['notification-act', 'notification-list', 'notification-read']) {
			expect((await probe.call(name, { notification: id })).error?.code, name).toBe(
				'CALL_NOT_GRANTED'
			);
		}
	});

	it('answers no confirmation the kernel did not raise, running nothing (step 6)', async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, pending(1) as never);
		const refused = await kernel.call('notification-act', {
			notification: pending(1).id,
			answer: 'confirm',
		});
		// A row with no key of the kernel's is no confirmation it raised (7.2): nothing runs.
		expect(refused.error?.code).toBe('NOTIFICATION_NOT_FOUND');
	});
});

describe('P4-E6: rates (10.2, 6.1)', () => {
	it('gives an app 10 a minute, RATE_LIMITED with details after, and says the rate is fixed', async () => {
		const { probe, sums, advance } = await boot();
		for (let index = 0; index < 10; index++) {
			expect((await probe.call('notification-push', { title: `n${index}` })).success).toBe(true);
			advance(1_000);
		}
		const refused = await probe.call('notification-push', { title: 'one more' });
		expect(refused.error).toMatchObject({
			code: 'RATE_LIMITED',
			retryable: true,
			suggestion: expect.stringContaining('fixed'),
			details: { limit: 10, retryAfterMs: 50_000 },
		});
		// Per source: another app is not held.
		expect((await sums.call('notification-push', { title: 'mine' })).success).toBe(true);
		advance(50_000);
		expect((await probe.call('notification-push', { title: 'later' })).success).toBe(true);
	});

	it('counts a push the moment it is admitted: 11 concurrent pushes give one RATE_LIMITED', async () => {
		const { probe } = await boot();
		const answers = await Promise.all(
			Array.from({ length: 11 }, (_, index) =>
				probe.call('notification-push', { title: `n${index}` })
			)
		);
		expect(answers.filter((answer) => answer.error?.code === 'RATE_LIMITED')).toHaveLength(1);
		expect(answers.filter((answer) => answer.success)).toHaveLength(10);
	});

	it('gives the agent interface 5 a minute, its toasts and notices together, whatever agent it names', async () => {
		const { kernel } = await boot();
		for (let index = 0; index < 3; index++)
			expect((await kernel.agent.call('toast-show', { message: `t${index}` })).success).toBe(true);
		expect((await kernel.agent.call('notification-push', { title: 'n1' })).success).toBe(true);
		expect(
			(await kernel.agent.call('notification-push', { title: 'n2' }, { agent: 'other' })).success
		).toBe(true);
		const refused = await kernel.agent.call('notification-push', { title: 'n3' });
		expect(refused.error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 5 } });
		expect((await kernel.agent.call('toast-show', { message: 't4' })).error?.code).toBe(
			'RATE_LIMITED'
		);
	});
});

describe('P4-E6: the quota (10.1)', () => {
	it('refuses a push past 500 unread notices, which are never dropped; confirmations count for nothing', async () => {
		const { kernel, probe, store } = await boot();
		for (let index = 1; index <= NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		await store.create(NOTIFICATION_TABLE, pending(9_999) as never);
		const refused = await probe.call('notification-push', { title: 'one more' });
		expect(refused.error).toMatchObject({
			code: 'QUOTA_EXCEEDED',
			suggestion: expect.stringContaining('archive'),
			details: { kind: 'notifications', limit: NOTIFICATION_QUOTA },
		});
		// One read: the oldest read notice goes, every unread one stays, and the confirmation too.
		await kernel.call('notification-read', { notification: row(250).id });
		expect((await probe.call('notification-push', { title: 'room now' })).success).toBe(true);
		const rows = (await store.list<NotificationV1>(NOTIFICATION_TABLE)).data;
		expect(rows.some((each) => each.id === row(250).id)).toBe(false);
		expect(rows.some((each) => each.id === pending(9_999).id)).toBe(true);
		expect(rows.filter((each) => each.kind === 'notice')).toHaveLength(NOTIFICATION_QUOTA);
	});

	it("never refuses the shell's own notices, nor counts them (R1)", async () => {
		const { kernel, probe, store } = await boot();
		for (let index = 1; index <= NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		expect((await probe.call('notification-push', { title: 'no room' })).error?.code).toBe(
			'QUOTA_EXCEEDED'
		);
		expect((await kernel.call('notification-push', { title: 'A reminder' })).success).toBe(true);
		for (let index = 0; index < 3; index++)
			await store.create(
				NOTIFICATION_TABLE,
				row(2_000 + index, { source: 'shell', createdAt: 1_800_000_000_000 + index }) as never
			);
		await kernel.call('notification-read', { notification: row(1).id });
		// One read app notice makes room for one app notice: the shell's unread ones count for nothing.
		expect((await probe.call('notification-push', { title: 'room now' })).success).toBe(true);
	});

	it('admits concurrent pushes one at a time: 499 unread and two pushes leave 500', async () => {
		const { kernel, probe, sums, store } = await boot();
		for (let index = 1; index < NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		const answers = await Promise.all([
			probe.call('notification-push', { title: 'first' }),
			sums.call('notification-push', { title: 'second' }),
		]);
		expect(answers.map((answer) => answer.success).sort()).toEqual([false, true]);
		expect(answers.find((answer) => !answer.success)?.error?.code).toBe('QUOTA_EXCEEDED');
		expect((await listed(kernel)).unread).toBe(NOTIFICATION_QUOTA);
	});

	it('takes a push with 499 unread notices however many confirmations wait', async () => {
		const { probe, store } = await boot();
		for (let index = 1; index < NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		for (let index = 0; index < 20; index++)
			await store.create(NOTIFICATION_TABLE, pending(10_000 + index) as never);
		expect((await probe.call('notification-push', { title: 'fits' })).success).toBe(true);
	});
});

describe('P4-E6: notification-list (10.2)', () => {
	it('gives 20 by default, newest first, ties by id, with a cursor to the rest, and bodies only when asked', async () => {
		const { kernel, store } = await boot();
		for (let index = 1; index <= 25; index++)
			await store.create(NOTIFICATION_TABLE, row(index, { body: `Body ${index}` }) as never);
		// A tie: the same time as notice 25, a lower id first.
		await store.create(
			NOTIFICATION_TABLE,
			row(0, { createdAt: row(25).createdAt, title: 'Tied' }) as never
		);
		const first = await listed(kernel);
		expect(first.notifications).toHaveLength(20);
		expect(first.notifications.map((each) => each.title).slice(0, 3)).toEqual([
			'Tied',
			'Notice 25',
			'Notice 24',
		]);
		expect(first.notifications.every((each) => each.body === undefined)).toBe(true);
		expect(first.unread).toBe(26);
		const rest = await listed(kernel, { cursor: first.cursor });
		expect(rest.notifications.map((each) => each.title)).toEqual([
			'Notice 6',
			'Notice 5',
			'Notice 4',
			'Notice 3',
			'Notice 2',
			'Notice 1',
		]);
		expect(rest.cursor).toBeNull();
		const bodies = await listed(kernel, { limit: 2, body: true });
		expect(bodies.notifications.map((each) => each.body)).toEqual([undefined, 'Body 25']);
		expect((await kernel.call('notification-list', { cursor: 'not-a-cursor' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		for (const limit of [0, 101, 1.5]) {
			expect((await kernel.call('notification-list', { limit })).error?.code, String(limit)).toBe(
				'VALIDATION_ERROR'
			);
		}
	});

	it("filters by unread, source and kind, and leaves a confirmation's input out without body", async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, row(1, { source: 'sums' }) as never);
		await store.create(NOTIFICATION_TABLE, row(2, { readAt: 5 }) as never);
		await store.create(NOTIFICATION_TABLE, pending(3) as never);
		expect((await listed(kernel, { source: 'sums' })).notifications.map((each) => each.id)).toEqual(
			[row(1).id]
		);
		expect((await listed(kernel, { unread: false })).notifications.map((each) => each.id)).toEqual([
			row(2).id,
		]);
		const confirmations = await listed(kernel, { kind: 'confirmation' });
		expect(confirmations.notifications[0]?.confirmation).not.toHaveProperty('input');
		expect(
			(await listed(kernel, { kind: 'confirmation', body: true })).notifications[0]?.confirmation
		).toHaveProperty('input');
		// #1868: confirmation.input is visible to the person and the owning raiser bucket, never to
		// another caller (non-owner agent or copilot) in either list or single-id reads.
		const appOwned = {
			...pending(4),
			source: 'probe',
			cbucket: 'app:probe',
			confirmation: {
				...(pending(4).confirmation as NonNullable<NotificationV1['confirmation']>),
				caller: 'probe',
				input: { secret: 'app-only' },
			},
		};
		const agentOwned = {
			...pending(5),
			source: 'agent:shell-agent',
			cbucket: 'agents:local',
			confirmation: {
				...(pending(5).confirmation as NonNullable<NotificationV1['confirmation']>),
				input: { secret: 'agent-own' },
			},
		};
		await store.create(NOTIFICATION_TABLE, appOwned as never);
		await store.create(NOTIFICATION_TABLE, agentOwned as never);

		// Person/shell sees both inputs.
		expect(
			(await listed(kernel, { notification: appOwned.id, body: true })).notifications[0]
				?.confirmation?.input
		).toEqual({ secret: 'app-only' });
		expect(
			(await listed(kernel, { notification: agentOwned.id, body: true })).notifications[0]
				?.confirmation?.input
		).toEqual({ secret: 'agent-own' });

		// Owning agent sees its own input, never the app's input (neither paginated nor by id).
		const agentList = (
			await kernel.agent.call<Listed>('notification-list', { kind: 'confirmation', body: true })
		).data;
		expect(
			agentList?.notifications.find((each) => each.id === agentOwned.id)?.confirmation?.input
		).toEqual({ secret: 'agent-own' });
		expect(
			agentList?.notifications.find((each) => each.id === appOwned.id)?.confirmation
		).not.toHaveProperty('input');
		expect(
			(
				await kernel.agent.call<Listed>('notification-list', {
					notification: agentOwned.id,
					body: true,
				})
			).data?.notifications[0]?.confirmation?.input
		).toEqual({ secret: 'agent-own' });
		expect(
			(
				await kernel.agent.call<Listed>('notification-list', {
					notification: appOwned.id,
					body: true,
				})
			).data?.notifications[0]?.confirmation
		).not.toHaveProperty('input');
	});

	it('ends a page early rather than pass its budget', async () => {
		const { kernel, store } = await boot();
		for (let index = 1; index <= 60; index++)
			await store.create(NOTIFICATION_TABLE, row(index, { body: 'x'.repeat(1000) }) as never);
		const page = await kernel.call<Listed>('notification-list', { limit: 100, body: true });
		const bytes = new TextEncoder().encode(JSON.stringify(page.data)).length;
		expect(bytes).toBeLessThanOrEqual(NOTIFICATION_LIST_BUDGET);
		expect(page.data?.notifications.length).toBeLessThan(60);
		expect(page.data?.cursor).not.toBeNull();
	});

	it("never lists another person's notices", async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, row(1, { person: 'someone-else' }) as never);
		await store.create(NOTIFICATION_TABLE, row(2, { workspace: 'elsewhere' }) as never);
		expect((await listed(kernel)).notifications).toEqual([]);
		expect((await kernel.call('notification-read', { notification: row(1).id })).error?.code).toBe(
			'NOTIFICATION_NOT_FOUND'
		);
	});
});

describe('P4-E6: read and archive, and R10', () => {
	it('mark one, all, or all from a source, and count what they changed', async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, row(1) as never);
		await store.create(NOTIFICATION_TABLE, row(2, { source: 'sums' }) as never);
		await store.create(NOTIFICATION_TABLE, row(3, { source: 'sums' }) as never);
		expect((await kernel.call('notification-read', { notification: row(1).id })).data).toEqual({
			read: 1,
		});
		expect((await kernel.call('notification-read', { notification: row(1).id })).data).toEqual({
			read: 0,
		});
		expect((await kernel.call('notification-archive', { all: true, source: 'sums' })).data).toEqual(
			{ archived: 2 }
		);
		const left = await listed(kernel);
		expect(left.notifications.map((each) => each.id)).toEqual([row(1).id]);
		expect(left.unread).toBe(0);
		expect((await kernel.call('notification-read', { all: false })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it("skips and refuses a pending confirmation for an agent, single and all; the person's own does not", async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, row(1) as never);
		await store.create(NOTIFICATION_TABLE, pending(2) as never);
		// Marking read and archiving change the person's inbox, so they ask an agent by default (phase 5's 6.1): the
		// person lets agents act, and the handler's own refusals are what this shows.
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		for (const name of ['notification-read', 'notification-archive']) {
			const single = await kernel.agent.call(name, { notification: pending(2).id });
			expect(single.error, name).toMatchObject({
				code: 'HUMAN_REQUIRED',
				suggestion: expect.stringContaining('inbox'),
			});
		}
		expect((await kernel.agent.call('notification-read', { all: true })).data).toEqual({ read: 1 });
		expect((await kernel.agent.call('notification-archive', { all: true })).data).toEqual({
			archived: 1,
		});
		const kept = await listed(kernel);
		expect(kept.notifications.map((each) => each.id)).toEqual([pending(2).id]);
		expect(kept.unread).toBe(1);
		expect((await kernel.call('notification-read', { all: true })).data).toEqual({ read: 1 });
		expect(
			(await kernel.call('notification-archive', { notification: pending(2).id })).data
		).toEqual({ archived: 1 });
	});
});

describe('P4-E6: toasts that land (6.1, 3.7)', () => {
	it('lands a sticky toast as a notice, its id on the toast, counted unread', async () => {
		const { kernel, probe } = await boot();
		const shown = await probe.call<OverlayRefV1>('toast-show', { message: 'Stays', sticky: true });
		expect(shown.data?.notification).toMatch(/^ntf_/);
		const [toast] = await overlays(kernel);
		expect(toast?.notification).toBe(shown.data?.notification);
		const inbox = await listed(kernel);
		expect(inbox.unread).toBe(1);
		expect(inbox.notifications[0]).toMatchObject({
			id: shown.data?.notification,
			source: 'probe',
			title: 'Stays',
			tone: 'info',
		});
		// A timed info toast lands under the default `toastSticky`, `danger`, only when it is an error.
		expect(
			(await probe.call<OverlayRefV1>('toast-show', { message: 'Gone' })).data
		).not.toHaveProperty('notification');
		const danger = await probe.call<OverlayRefV1>('toast-show', {
			message: 'Failed',
			tone: 'danger',
		});
		// Landed, but the result never says so for a toast the app did not make sticky (R2); the shell's record does.
		expect(danger.data).not.toHaveProperty('notification');
		const record = (await overlays(kernel)).find(
			(each) => each.overlayId === danger.data?.overlayId
		);
		expect(record?.notification).toMatch(/^ntf_/);
		const own = (await probe.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
		expect(own.find((each) => each.overlayId === danger.data?.overlayId)).not.toHaveProperty(
			'notification'
		);
		expect((await listed(kernel)).unread).toBe(2);
	});

	it('counts sticky toasts against the app rate, and refuses the eleventh', async () => {
		const { probe } = await boot();
		for (let index = 0; index < 10; index++)
			expect((await probe.call('toast-show', { message: `s${index}`, sticky: true })).success).toBe(
				true
			);
		const refused = await probe.call('toast-show', { message: 'one more', sticky: true });
		expect(refused.error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 10 } });
		// A toast `toastSticky` selects is still shown past the rate; it does not land.
		const danger = await probe.call<OverlayRefV1>('toast-show', { message: 'x', tone: 'danger' });
		expect(danger.success).toBe(true);
		expect(danger.data).not.toHaveProperty('notification');
	});

	it("follows the person's toastSticky: never, and always", async () => {
		const { kernel, probe } = await boot();
		const set = (value: string) =>
			kernel.call('setting-set', {
				section: 'loam.notifications',
				key: 'toastSticky',
				value,
				level: 'person',
			});
		expect((await set('never')).success).toBe(true);
		expect(
			(await probe.call<OverlayRefV1>('toast-show', { message: 'x', tone: 'danger' })).data
		).not.toHaveProperty('notification');
		expect(
			(await probe.call<OverlayRefV1>('toast-show', { message: 'kept', sticky: true })).data
				?.notification
		).toMatch(/^ntf_/);
		expect((await listed(kernel)).unread).toBe(1);
		await set('always');
		const mine = await kernel.call<OverlayRefV1>('toast-show', { message: 'mine' });
		expect(mine.data).not.toHaveProperty('notification');
		expect((await listed(kernel, { source: 'shell' })).notifications[0]?.title).toBe('mine');
	});

	it("keeps an agent's sticky toast in its rate once, as agent:<id>", async () => {
		const { kernel } = await boot();
		const shown = await kernel.agent.call<OverlayRefV1>('toast-show', {
			message: 'Look',
			sticky: true,
		});
		expect(shown.data?.notification).toMatch(/^ntf_/);
		expect((await listed(kernel)).notifications[0]?.source).toBe('agent:shell-agent');
		for (let index = 0; index < 4; index++)
			expect((await kernel.agent.call('notification-push', { title: `n${index}` })).success).toBe(
				true
			);
		expect((await kernel.agent.call('notification-push', { title: 'six' })).error?.code).toBe(
			'RATE_LIMITED'
		);
	});

	it("gives a long message as the notice's body, its title cut to 120", async () => {
		const { kernel, probe } = await boot();
		const message = 'm'.repeat(200);
		await probe.call('toast-show', { message, sticky: true });
		const [notice] = (await listed(kernel, { body: true })).notifications;
		expect(notice?.title).toHaveLength(120);
		expect(notice?.body).toBe(message);
	});
});

describe('muted (3.7)', () => {
	it("keeps a muted app's notices and counts them, and never shows its toasts", async () => {
		const { kernel, probe, sums } = await boot();
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.notifications',
					key: 'muted',
					value: ['probe'],
					level: 'person',
				})
			).success
		).toBe(true);
		await sums.call('toast-show', { message: 'Visible', tone: 'danger' });
		const timed = await probe.call<OverlayRefV1>('toast-show', { message: 'Quiet' });
		const sticky = await probe.call<OverlayRefV1>('toast-show', { message: 'Kept', sticky: true });
		expect(sticky.data?.notification).toMatch(/^ntf_/);
		// The shell holds both, marked hidden, so the chrome runs them unseen; the other app's shows.
		const shell = await overlays(kernel);
		expect(shell.filter((each) => each.hidden).map((each) => each.overlayId)).toEqual([
			timed.data?.overlayId,
			sticky.data?.overlayId,
		]);
		expect(shell.find((each) => each.owner === 'sums')).not.toHaveProperty('hidden');
		await probe.call('notification-push', { title: 'Also kept' });
		const inbox = await listed(kernel, { source: 'probe' });
		// Both at one time, so ties by id: as a set.
		expect(inbox.notifications.map((each) => each.title).sort()).toEqual(['Also kept', 'Kept']);
		expect(inbox.unread).toBe(3);
	});

	it('lets a muted app read nothing different of its toasts (R2)', async () => {
		const runOnce = async (mute: boolean) => {
			const { kernel, probe } = await boot();
			if (mute)
				await kernel.call('setting-set', {
					section: 'loam.notifications',
					key: 'muted',
					value: ['probe'],
					level: 'person',
				});
			const timed = await probe.call<OverlayRefV1>('toast-show', {
				message: 'Quiet',
				tone: 'danger',
			});
			const sticky = await probe.call<OverlayRefV1>('toast-show', {
				message: 'Kept',
				sticky: true,
			});
			const settled: string[] = [];
			for (const ref of [timed.data, sticky.data] as OverlayRefV1[])
				void probe.waitOverlay(ref.overlayId).then((result) => {
					settled.push(`${ref.overlayId}:${result.result}:${result.reason}`);
				});
			// Its own sticky toast's notice id is random, as any notice's: compared as present or not.
			const listedBefore = (
				(await probe.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? []
			).map(({ notification, ...rest }) => ({ ...rest, landed: notification !== undefined }));
			await new Promise((resolve) => setTimeout(resolve, 10));
			const waitedBefore = [...settled];
			// The chrome's timer for the timed one, as it runs it for a shown toast or a hidden one alike.
			await kernel.call('overlay-dismiss', {
				overlayId: (timed.data as OverlayRefV1).overlayId,
				reason: 'timeout',
			});
			await new Promise((resolve) => setTimeout(resolve, 10));
			const strip = (ref?: OverlayRefV1) => {
				if (!ref) return ref;
				const { notification: _notification, ...rest } = ref;
				return { ...rest, landed: _notification !== undefined };
			};
			return {
				results: [strip(timed.data), strip(sticky.data)],
				listedBefore,
				waitedBefore,
				settled: [...settled],
			};
		};
		const shown = await runOnce(false);
		const muted = await runOnce(true);
		expect(muted).toEqual(shown);
		// A timed toast settles `timeout`, a sticky one stays open; nothing settles before.
		expect(muted.waitedBefore).toEqual([]);
		expect(muted.settled).toEqual([expect.stringMatching(/:dismissed:timeout$/)]);
		expect(muted.results[0]).toMatchObject({ landed: false });
		expect(muted.results[1]).toMatchObject({ landed: true });
	});

	it('P4-E6: P4-E1: never mutes the shell or an agent (SETTING_MUTE_SHELL)', async () => {
		const { kernel } = await boot();
		for (const value of [['shell'], ['agent:shell-agent']]) {
			const refused = await kernel.call('setting-set', {
				section: 'loam.notifications',
				key: 'muted',
				value,
				level: 'person',
			});
			expect(refused.error?.code).toBe('SETTING_MUTE_SHELL');
		}
	});
});

describe('P4-E6: scope (10.1)', () => {
	it('lists only notices in a scope the caller may enter, and refuses a push in one it may not', async () => {
		const workspace = await createScopedWorkspace();
		kernels.push(workspace.kernel);
		const { kernel, projects } = workspace;
		const atlas = { workspace: 'personal', project: projects.atlas.id };
		const citadel = { workspace: 'personal', project: projects.citadel.id };
		const pushed = await kernel.call<{ notification: NotificationV1 }>(
			'notification-push',
			{ title: 'In Atlas' },
			{ scope: atlas }
		);
		expect(pushed.data?.notification.scope).toEqual(atlas);
		const refused = await kernel.call('notification-push', { title: 'x' }, { scope: citadel });
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		await workspace.store.create(
			NOTIFICATION_TABLE,
			row(1, { person: pushed.data?.notification.person as string, scope: citadel }) as never
		);
		const seen = await listed(kernel);
		expect(seen.notifications.map((each) => each.title)).toEqual(['In Atlas']);
		expect(seen.unread).toBe(1);
		expect(
			(await kernel.call('notification-archive', { notification: row(1).id })).error?.code
		).toBe('NOTIFICATION_NOT_FOUND');
	});
});

describe('P4-E15: replay', () => {
	it('replays pushes, a landed toast, read, archive and an action the same', async () => {
		const { kernel, journal, probe } = await boot();
		const pushed = await probe.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'x' } },
		});
		await kernel.agent.call('notification-push', { title: 'From the agent' });
		await probe.call('toast-show', { message: 'Stays', sticky: true });
		await kernel.call('notification-act', { notification: pushed.data?.notification.id });
		// `notification-list` is not journaled (as `persona-list`): read and archive answer counts, which the replay must
		// reproduce, so they hold only if every notice was written again.
		expect((await kernel.call('notification-read', { all: true })).data).toEqual({ read: 2 });
		expect(
			(await kernel.call('notification-archive', { all: true, source: 'probe' })).data
		).toEqual({ archived: 2 });
		const live = (await kernel.call('notification-list', { body: true })).data;
		// Not an empty inbox, so the comparison below says something.
		expect((live as { notifications: unknown[] }).notifications.length).toBeGreaterThan(0);
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			keep: true,
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
		const commands = report.entries.map(({ command }) => command);
		expect(commands).toContain('notification-read');
		expect(commands).toContain('notification-archive');
		expect(commands).not.toContain('notification-list');
		// The notices themselves, not only their counts: the replayed kernel's inbox equals the live one's, body and all.
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect((await replayed.call('notification-list', { body: true })).data).toEqual(live);
		} finally {
			await replayed.dispose();
		}
	});

	it('journals an agent notification-list (with wrapped secrets redacted) while leaving out the shell read, and replays the same (#2105)', async () => {
		const { kernel, journal, probe } = await boot();
		await kernel.call('notification-push', {
			title: 'Sign in again',
			body: 'Private notice body',
			action: {
				command: 'auth-sign-in',
				label: 'Sign in',
				input: { method: 'credentials', email: 'ada@example.com', password: 'secret-password' },
			},
		});
		// Shell read: not journaled.
		expect((await kernel.call('notification-list', { body: true })).success).toBe(true);
		const afterShell = await journal.read();
		expect(afterShell.filter((entry) => entry.command === 'notification-list')).toEqual([]);

		// Agent read: journaled, with wrapped action secrets redacted.
		const agentRead = await kernel.agent.call<Listed>('notification-list', { body: true });
		expect(agentRead.success).toBe(true);
		expect(agentRead.data?.notifications).toHaveLength(1);

		// App call: refused at port boundary via app-call-refuse, journaled with app caller and command name.
		expect((await probe.call('notification-list', { body: true })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);

		const entries = await journal.read();
		const listedEntries = entries.filter((entry) => entry.command === 'notification-list');
		expect(listedEntries).toHaveLength(1);
		expect(listedEntries[0]?.actor).toMatchObject({ kind: 'agent' });
		expect(listedEntries[0]?.contextDigest.interface).toBe('agent');
		expect(JSON.stringify(listedEntries[0])).not.toContain('secret-password');
		expect(JSON.stringify(listedEntries[0])).toContain('Private notice body');
		expect(JSON.stringify(listedEntries[0])).toContain('ada@example.com');

		const refused = entries.filter((entry) => entry.command === 'app-call-refuse');
		expect(refused).toHaveLength(1);
		expect(refused[0]?.context?.caller).toBe('probe');
		expect(refused[0]?.input).toMatchObject({ command: 'notification-list' });

		// Replays both the journaled agent notification-list and the app-call-refuse cleanly with zero divergence.
		const { report } = await replayKernel(entries, {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
		expect(report.entries.some((entry) => entry.command === 'notification-list')).toBe(true);
		expect(report.entries.some((entry) => entry.command === 'app-call-refuse')).toBe(true);
	});

	it('replays a shell notification-act whose action is notification-list without recording an extra nested entry (#2105)', async () => {
		const { kernel, journal } = await boot();
		const pushed = await kernel.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Refresh inbox',
			action: { command: 'notification-list', label: 'List', input: {} },
		});
		expect(pushed.success).toBe(true);
		const acted = await kernel.call('notification-act', {
			notification: pushed.data?.notification.id,
		});
		expect(acted.success).toBe(true);
		const entries = await journal.read();
		expect(entries.filter((entry) => entry.command === 'notification-list')).toEqual([]);
		const { report } = await replayKernel(entries, {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
	});

	it('orders a concurrent notification-push after an agent notification-list that already read the empty inbox (#2105)', async () => {
		const now = 1_800_000_000_000;
		const journal = new MemoryJournalSink();
		const baseStore = new MemoryAdapter();
		let releaseList!: () => void;
		let listHeld!: () => void;
		const waitingForList = new Promise<void>((resolve) => {
			listHeld = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			releaseList = resolve;
		});
		let holdNextList = false;
		const store = Object.assign(Object.create(Object.getPrototypeOf(baseStore)), baseStore, {
			async list<T>(table: string, query?: unknown) {
				const result = await baseStore.list<T>(table, query as never);
				if (table === NOTIFICATION_TABLE && holdNextList) {
					holdNextList = false;
					listHeld();
					await gate;
				}
				return result;
			},
		}) as MemoryAdapter;
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter({ clock: { now: () => now } }),
			environment: createFixedEnvironment(),
			host: 'test',
			clock: () => now,
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
			overlayAnchors: { resolve: () => true },
		});
		kernels.push(kernel);
		await kernel.appsReady;

		holdNextList = true;
		const listPromise = kernel.agent.call<Listed>('notification-list', {});
		await waitingForList;
		const pushPromise = kernel.call('notification-push', { title: 'Arrived during read' });
		await Promise.resolve();
		releaseList();
		const [listRes, pushRes] = await Promise.all([listPromise, pushPromise]);
		expect(listRes.success).toBe(true);
		expect(listRes.data?.notifications).toEqual([]);
		expect(pushRes.success).toBe(true);

		const entries = await journal.read();
		const listSeq = entries.find((entry) => entry.command === 'notification-list')?.seq ?? -1;
		const pushSeq = entries.find((entry) => entry.command === 'notification-push')?.seq ?? -1;
		expect(listSeq).toBeGreaterThan(0);
		expect(pushSeq).toBeGreaterThan(listSeq);

		const { report } = await replayKernel(entries, {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
	});

	it('replays a budget-truncated agent notification-list over redacted wrapped notices without cursor divergence (#2105)', async () => {
		const { kernel, journal, advance } = await boot();
		const longSecret = 'p'.repeat(1_800);
		for (let index = 0; index < 24; index++) {
			if (index > 0 && index % 10 === 0) advance(61_000);
			const pushed = await kernel.call('notification-push', {
				title: `Sign in ${index}`,
				body: 'Notice body',
				action: {
					command: 'auth-sign-in',
					label: 'Sign in',
					input: { method: 'credentials', email: `u${index}@example.com`, password: longSecret },
				},
			});
			expect(pushed.success).toBe(true);
		}
		const page = await kernel.agent.call<Listed>('notification-list', { body: true, limit: 100 });
		expect(page.success).toBe(true);
		expect(page.data?.cursor).not.toBeNull();
		expect(page.data?.notifications.length).toBeLessThan(24);

		const entries = await journal.read();
		const listEntry = entries.find((entry) => entry.command === 'notification-list');
		expect(listEntry?.context?.replay).toBe('recorded');
		expect(JSON.stringify(listEntry)).not.toContain(longSecret);

		const { report } = await replayKernel(entries, {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
		expect(report.recorded).toContain(listEntry?.seq);
	});

	it('redacts a listed confirmation input in a journaled agent notification-list (#2105)', async () => {
		const { kernel, journal, store } = await boot();
		// A pending confirmation raised by this agent whose input carries a secret (`auth-sign-in` password).
		await store.create(NOTIFICATION_TABLE, {
			id: 'ntf_0000000000000099',
			workspace: 'personal',
			person: 'local',
			source: 'agent:shell-agent',
			kind: 'confirmation',
			title: 'Sign in',
			tone: 'warning',
			scope: { workspace: 'personal' },
			createdAt: 1_800_000_000_000,
			cbucket: 'agents:local',
			ckey: 'confirm-key-99',
			confirmation: {
				command: 'auth-sign-in',
				caller: 'agent:shell-agent',
				header: 'Requested by shell-agent for you',
				prompt: 'Confirm sign in',
				title: 'Sign in',
				expiresAt: 1_800_000_600_000,
				state: 'pending',
				input: {
					method: 'credentials',
					email: 'ada@example.com',
					password: 'confirm-secret-password',
				},
			},
		});
		const listedRes = await kernel.agent.call<Listed>('notification-list', { body: true });
		expect(listedRes.success).toBe(true);
		expect(listedRes.data?.notifications[0]?.confirmation?.input).toMatchObject({
			email: 'ada@example.com',
			password: 'confirm-secret-password',
		});
		const entries = await journal.read();
		const listEntry = entries.find((entry) => entry.command === 'notification-list');
		expect(listEntry).toBeDefined();
		expect(JSON.stringify(listEntry)).not.toContain('confirm-secret-password');
		expect(JSON.stringify(listEntry)).toContain('ada@example.com');
	});
});

describe("the shell's own notices, the seam of steps 8 to 10 (10.2)", () => {
	it('writes a notice from the shell to any person, outside the rate and the quota (R1)', async () => {
		const store = new MemoryAdapter();
		const notifications = createNotifications({
			store,
			workspace: () => 'personal',
			provider: false,
			allows: () => true,
			sourceOf: () => ({ kind: 'none' }),
			humanGesture: () => false,
			actionCheck: () => ({ kind: 'own' }),
			pushRate: createPushRate(),
			limits: { agent: 5, app: 10 },
			prefs: async () => ({ toastSticky: 'danger', muted: [] }),
			landsInInbox: () => false,
			overlays: { land: () => undefined, hideNext: () => undefined },
			fromOf: () => undefined,
			run: async () => ({ success: true }),
			kit: { ...DOCUMENT_KIT, archivedRefusal: () => undefined, personKey } as never,
		});
		const context = { traceId: 't', clock: { now: () => 5 } } as never;
		for (let index = 0; index < 12; index++) {
			const notice = await notifications.shellNotice(context, 'owner-1', {
				title: `Orphan row ${index}`,
				tone: 'warning',
			});
			expect(notice).toMatchObject({ source: 'shell', person: 'owner-1', kind: 'notice' });
		}
		for (let index = 0; index < NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index + 100, { person: 'owner-2' }) as never);
		expect(
			await notifications.shellNotice(context, 'owner-2', { title: 'Full', tone: 'info' })
		).toMatchObject({ source: 'shell', person: 'owner-2' });
	});
});

describe('acting (the reviews: act-time checks, and acting twice)', () => {
	const notes = async (kernel: LoamKernel) =>
		JSON.stringify((await kernel.call('probe-list')).data ?? {});

	it('checks a stored action again when the person acts, and runs nothing it refuses', async () => {
		const { kernel, store } = await boot();
		const before = await notes(kernel);
		const cases: Array<[Partial<NotificationV1>, string]> = [
			[
				{ action: { command: 'persona-set', label: 'x', input: { persona: 'default' } } },
				'OVERLAY_ITEM_RESERVED',
			],
			[
				{ source: 'gone', action: { command: 'probe-note', label: 'x', input: { text: 'a' } } },
				'NOTIFICATION_ACTION_FOREIGN',
			],
			[{ action: { command: 'probe-removed', label: 'x' } }, 'NOTIFICATION_ACTION_FOREIGN'],
			[{ action: { command: 'probe-hidden', label: 'x' } }, 'NOTIFICATION_ACTION_FOREIGN'],
			[{ action: { command: 'probe-note', label: 'x', input: { text: 5 } } }, 'VALIDATION_ERROR'],
		];
		for (const [index, [fields, code]] of cases.entries()) {
			await store.create(NOTIFICATION_TABLE, row(index + 1, fields) as never);
			const refused = await kernel.call('notification-act', { notification: row(index + 1).id });
			expect(refused.error?.code, code).toBe(code);
			const [kept] = (await listed(kernel, { notification: row(index + 1).id })).notifications;
			expect(kept).not.toHaveProperty('state');
		}
		// An action naming another app's command than its source's is foreign, whatever the source.
		await store.create(
			NOTIFICATION_TABLE,
			row(9, {
				source: 'sums',
				action: { command: 'probe-note', label: 'x', input: { text: 'a' } },
			}) as never
		);
		expect((await kernel.call('notification-act', { notification: row(9).id })).error?.code).toBe(
			'NOTIFICATION_ACTION_FOREIGN'
		);
		expect(await notes(kernel)).toBe(before);
	});

	it('runs the command once for two concurrent acts, and never again once claimed', async () => {
		const { kernel, store } = await boot();
		await store.create(
			NOTIFICATION_TABLE,
			row(1, {
				action: { command: 'probe-note', label: 'Note', input: { text: 'once only' } },
			}) as never
		);
		const answers = await Promise.all([
			kernel.call('notification-act', { notification: row(1).id }),
			kernel.call('notification-act', { notification: row(1).id }),
		]);
		expect(answers.filter((answer) => answer.success)).toHaveLength(1);
		expect(answers.find((answer) => !answer.success)?.error?.code).toBe(
			'NOTIFICATION_ACTION_UNAVAILABLE'
		);
		expect((await notes(kernel)).split('once only').length).toBe(2);
		// A claim another tab left, its outcome never written: it never runs again.
		await store.create(
			NOTIFICATION_TABLE,
			row(2, {
				state: 'acting',
				action: { command: 'probe-note', label: 'Note', input: { text: 'twice' } },
			}) as never
		);
		expect((await kernel.call('notification-act', { notification: row(2).id })).error?.code).toBe(
			'NOTIFICATION_ACTION_UNAVAILABLE'
		);
		expect(await notes(kernel)).not.toContain('twice');
		const [shown] = (await listed(kernel, { notification: row(1).id })).notifications;
		expect(shown).toMatchObject({ state: 'done' });
		expect(shown).not.toHaveProperty('claim');
	});

	it('releases the claim when the action fails, so the person may act again', async () => {
		const { kernel, store } = await boot();
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: false });
		await store.create(
			NOTIFICATION_TABLE,
			row(1, {
				action: { command: 'probe-note', label: 'Note', input: { text: 'later' } },
			}) as never
		);
		const first = await kernel.call('notification-act', { notification: row(1).id });
		// The source app disabled: the nested call is refused as any call of the person's would be, and nothing runs.
		expect(first.error?.code).toBe('APP_DISABLED');
		const [kept] = (await listed(kernel, { notification: row(1).id })).notifications;
		expect(kept).not.toHaveProperty('state');
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: true });
		expect(JSON.stringify((await kernel.call('probe-list')).data ?? {})).not.toContain('later');
		// Enabled again, the person acts again, once.
		expect((await kernel.call('notification-act', { notification: row(1).id })).success).toBe(true);
		expect(JSON.stringify((await kernel.call('probe-list')).data ?? {}).split('later').length).toBe(
			2
		);
	});
});

describe('links (10.1)', () => {
	it('takes a resource link with an app route or a document anchor, in this workspace only', async () => {
		const { kernel, probe } = await boot();
		const route = {
			kind: 'app',
			instance: 'probe',
			route: 'notes/1',
			scope: { workspace: 'personal' },
		};
		const anchored = {
			kind: 'document',
			document: 'doc_1',
			anchor: { block: 'b1' },
			scope: { workspace: 'personal' },
		};
		for (const link of [route, anchored]) {
			const pushed = await probe.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Look',
				link,
			});
			expect(pushed.data?.notification.link).toEqual(link);
		}
		expect((await listed(kernel)).notifications.map((each) => each.link)).toEqual(
			expect.arrayContaining([route, anchored])
		);
		for (const link of [
			{ ...route, scope: { workspace: 'elsewhere' } },
			{ ...route, route: 'notes/../x' },
			{ ...route, route: '/notes' },
			{ ...anchored, anchor: { big: 'x'.repeat(2_000) } },
		]) {
			const refused = await probe.call('notification-push', { title: 'x', link });
			expect(refused.error?.code, JSON.stringify(link).slice(0, 60)).toBe('VALIDATION_ERROR');
		}
	});
});

describe('who left it, and one notice by id (6.6, 10.2)', () => {
	it("lists each notice with step 3's owner line, and finds one by id past the first page", async () => {
		const { kernel, probe, store } = await boot();
		await probe.call('notification-push', { title: 'From the app' });
		await kernel.agent.call('notification-push', { title: 'From the agent' });
		await kernel.call('notification-push', { title: 'From me' });
		const rows = (await listed(kernel)).notifications;
		expect(rows.find((each) => each.title === 'From the app')?.from).toEqual({
			kind: 'app',
			title: expect.any(String),
		});
		expect(rows.find((each) => each.title === 'From the agent')?.from).toEqual({
			kind: 'agent',
			agent: 'shell-agent',
			person: null,
		});
		expect(rows.find((each) => each.title === 'From me')).not.toHaveProperty('from');
		for (let index = 1; index <= 30; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		const page = await listed(kernel);
		expect(page.notifications.some((each) => each.id === row(1).id)).toBe(false);
		const found = await listed(kernel, { notification: row(1).id });
		expect(found.notifications.map((each) => each.id)).toEqual([row(1).id]);
	});
});

describe('a sticky toast is admitted as a push is (the reviews)', () => {
	it("refuses an agent's sticky toast at the quota, and any sticky toast in a scope the caller may not enter", async () => {
		const { kernel, store } = await boot();
		for (let index = 1; index <= NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		const refused = await kernel.agent.call('toast-show', { message: 'Look', sticky: true });
		expect(refused.error?.code).toBe('QUOTA_EXCEEDED');
		expect((await overlays(kernel)).filter((each) => each.kind === 'toast')).toEqual([]);
		// A timed one is shown, and lands nowhere.
		expect((await kernel.agent.call('toast-show', { message: 'Timed' })).success).toBe(true);

		const workspace = await createScopedWorkspace();
		kernels.push(workspace.kernel);
		const citadel = { workspace: 'personal', project: workspace.projects.citadel.id };
		const outside = await workspace.kernel.agent.call(
			'toast-show',
			{ message: 'x', sticky: true },
			{ scope: citadel }
		);
		expect(outside.error?.code).toBe('PROJECT_NOT_FOUND');
	});
});

describe('MCP (section 13; the reviews: item 9)', () => {
	it("serves none of the shell's inbox commands, by name, and still an app's of the notification category", async () => {
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: probeDeployment([entry('probe')]),
			ports: createFixturePorts({
				'apps/probe/': {
					manifest: {
						...PROBE_MANIFEST,
						commands: (PROBE_MANIFEST.commands ?? []).map((command) =>
							command.name === 'probe-list' ? { ...command, category: 'notification' } : command
						),
					} as typeof PROBE_MANIFEST,
					definition: probeDefinition(),
				},
			}),
		});
		kernels.push(parts.kernel);
		await parts.kernel.appsReady;
		const served = parts.mcpOptions()?.commands ?? [];
		expect(served.filter((command) => command.name.startsWith('notification-'))).toEqual([]);
		expect(served.find((command) => command.name === 'probe-list')?.category).toBe('notification');
	});
});

describe("a muted app's toasts and the cap (the re-check's improvement 1)", () => {
	it('never pushes a shown toast off for a hidden one', async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('setting-set', {
			section: 'loam.notifications',
			key: 'muted',
			value: ['probe'],
			level: 'person',
		});
		for (let index = 0; index < 5; index++)
			await sums.call('toast-show', { message: `shown ${index}`, durationMs: 30_000 });
		for (let index = 0; index < 7; index++)
			await probe.call('toast-show', { message: `hidden ${index}`, durationMs: 30_000 });
		const all = await overlays(kernel);
		expect(
			all.filter((each) => !each.hidden).map((each) => (each.input as { message: string }).message)
		).toEqual(['shown 0', 'shown 1', 'shown 2', 'shown 3', 'shown 4']);
		// The hidden ones keep their own cap of five, as the app would see its own toasts kept.
		expect(all.filter((each) => each.hidden)).toHaveLength(5);
	});
});

describe('the act while it runs (the verification of ab2c36a8)', () => {
	/** The inbox alone over a store, with an action `run` the test drives. */
	function inboxOver(store: MemoryAdapter, run: () => Promise<{ success: boolean }>) {
		const notifications = createNotifications({
			store,
			workspace: () => 'personal',
			provider: false,
			allows: () => true,
			sourceOf: () => ({ kind: 'shell', bucket: 'shell:local' }),
			humanGesture: () => true,
			actionCheck: () => ({ kind: 'own' }),
			pushRate: createPushRate(),
			limits: { agent: 5, app: 10 },
			prefs: async () => ({ toastSticky: 'danger', muted: [] }),
			landsInInbox: () => false,
			overlays: { land: () => undefined, hideNext: () => undefined },
			fromOf: () => undefined,
			run,
			kit: { ...DOCUMENT_KIT, archivedRefusal: () => undefined, personKey } as never,
		});
		const act = notifications.commands.find((command) => command.name === 'notification-act');
		if (!act) throw new Error('No notification-act');
		const context = { traceId: 't', clock: { now: () => 9 } } as never;
		return (id: string) =>
			(act.handler as (input: unknown, context: unknown) => Promise<{ success: boolean }>)(
				{ notification: id },
				context
			);
	}
	const action = { action: { command: 'probe-note', label: 'Note', input: { text: 'x' } } };

	it('keeps a read or an archive made while the action ran', async () => {
		const store = new MemoryAdapter();
		await store.create(NOTIFICATION_TABLE, row(1, action) as never);
		const act = inboxOver(store, async () => {
			await store.update(NOTIFICATION_TABLE, row(1).id, { readAt: 3, archivedAt: 4 } as never);
			return { success: true };
		});
		expect((await act(row(1).id)).success).toBe(true);
		expect(await store.get(NOTIFICATION_TABLE, row(1).id)).toMatchObject({
			readAt: 3,
			archivedAt: 4,
			state: 'done',
		});
		expect(await store.get(NOTIFICATION_TABLE, row(1).id)).not.toHaveProperty('claim');
	});

	it('never writes back a row evicted or deleted while the action ran, whether it ran or failed', async () => {
		for (const ran of [true, false]) {
			const store = new MemoryAdapter();
			await store.create(NOTIFICATION_TABLE, row(1, action) as never);
			const act = inboxOver(store, async () => {
				await store.remove(NOTIFICATION_TABLE, row(1).id);
				return { success: ran };
			});
			expect((await act(row(1).id)).success, String(ran)).toBe(ran);
			expect(await store.get(NOTIFICATION_TABLE, row(1).id), String(ran)).toBeNull();
		}
	});
});

describe("the act's read-back failing (the verification of 2995bb7e)", () => {
	it('falls back to the claimed row when the read after the run fails: released when it failed, done when it ran', async () => {
		for (const ran of [false, true]) {
			const store = new MemoryAdapter();
			await store.create(
				NOTIFICATION_TABLE,
				row(1, { action: { command: 'probe-note', label: 'Note', input: { text: 'x' } } }) as never
			);
			let broken = false;
			// The same store, whose reads fail once the action has run.
			const failing = Object.assign(Object.create(store) as MemoryAdapter, {
				get: (...args: Parameters<MemoryAdapter['get']>) =>
					broken ? Promise.reject(new Error('The store is unavailable')) : store.get(...args),
			});
			const notifications = createNotifications({
				store: failing,
				workspace: () => 'personal',
				provider: false,
				allows: () => true,
				sourceOf: () => ({ kind: 'shell', bucket: 'shell:local' }),
				humanGesture: () => true,
				actionCheck: () => ({ kind: 'own' }),
				pushRate: createPushRate(),
				limits: { agent: 5, app: 10 },
				prefs: async () => ({ toastSticky: 'danger', muted: [] }),
				landsInInbox: () => false,
				overlays: { land: () => undefined, hideNext: () => undefined },
				fromOf: () => undefined,
				run: async () => {
					broken = true;
					return { success: ran };
				},
				kit: { ...DOCUMENT_KIT, archivedRefusal: () => undefined, personKey } as never,
			});
			const act = notifications.commands.find((command) => command.name === 'notification-act');
			if (!act) throw new Error('No notification-act');
			const answer = (await (
				act.handler as (input: unknown, context: unknown) => Promise<{ success: boolean }>
			)({ notification: row(1).id }, { traceId: 't', clock: { now: () => 9 } })) as {
				success: boolean;
			};
			expect(answer.success, String(ran)).toBe(ran);
			const stored = await store.get<NotificationV1 & { claim?: string }>(
				NOTIFICATION_TABLE,
				row(1).id
			);
			expect(stored, String(ran)).not.toHaveProperty('claim');
			if (ran) expect(stored).toMatchObject({ state: 'done', readAt: 9 });
			else expect(stored).not.toHaveProperty('state');
		}
	});
});

describe("the orphan notice's recipients (4.2, 10.2; step 8's seam)", () => {
	it('tells each owner of the rows they may see: a project row only if they may enter its project', () => {
		const rows = [
			{ id: 'workspace/-/dual/*', level: 'workspace' as const },
			{ id: 'project/prj_a/dual/*', level: 'project' as const, project: 'prj_a' },
			{ id: 'project/prj_b/dual/*', level: 'project' as const, project: 'prj_b' },
		];
		const heard = orphanRecipients(rows, ['ada', 'bea', 'cy'], (person, project) =>
			person === 'ada' ? true : person === 'bea' ? project === 'prj_a' : false
		);
		expect([...heard].map(([owner, theirs]) => [owner, theirs.map((row) => row.id)])).toEqual([
			['ada', ['workspace/-/dual/*', 'project/prj_a/dual/*', 'project/prj_b/dual/*']],
			['bea', ['workspace/-/dual/*', 'project/prj_a/dual/*']],
			['cy', ['workspace/-/dual/*']],
		]);
		expect(orphanRecipients(rows.slice(2), ['cy'], () => false).size).toBe(0);
		// A project row that names no project goes to no one: fail closed.
		expect(
			orphanRecipients([{ id: 'project/?/dual/*', level: 'project' as const }], ['ada'], () => true)
				.size
		).toBe(0);
	});

	it('names at most ten rows and counts the rest', () => {
		const many = Array.from({ length: 12 }, (_, index) => ({
			id: `workspace/-/app${index}/*`,
			level: 'workspace' as const,
		}));
		const notice = orphanNotice(many);
		expect(notice.title).toBe('12 autonomy rules no longer match an app or command');
		expect(notice.body).toContain('app9/*, and 2 more.');
		expect(orphanNotice(many.slice(0, 1)).title).toBe(
			'An autonomy rule no longer matches an app or command'
		);
	});
});
