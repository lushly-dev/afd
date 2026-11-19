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
import { createKernel } from '../kernel.js';
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
import type { LoamKernelV5 } from '../types.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { HUMAN_COMMANDS } from './identity-commands.js';
import {
	createNotifications,
	NOTIFICATION_LIST_BUDGET,
	NOTIFICATION_QUOTA,
	NOTIFICATION_TABLE,
} from './notifications.js';
import { createPushRate } from './push-rate.js';

const kernels: LoamKernelV5[] = [];
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
const listed = async (kernel: LoamKernelV5, input: Record<string, unknown> = {}) =>
	(await kernel.call<Listed>('notification-list', input)).data as Listed;
const overlays = async (kernel: LoamKernelV5) =>
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
			state: 'pending',
		},
	});

describe('source, derived from the path (10.1)', () => {
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

describe('actions (10.1)', () => {
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

	it('answers a confirmation as not served yet, running nothing (step 6)', async () => {
		const { kernel, store } = await boot();
		await store.create(NOTIFICATION_TABLE, pending(1) as never);
		const refused = await kernel.call('notification-act', {
			notification: pending(1).id,
			answer: 'confirm',
		});
		expect(refused.error?.code).toBe('NOTIFICATION_ACTION_UNAVAILABLE');
	});
});

describe('rates (10.2, 6.1)', () => {
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

describe('the quota (10.1)', () => {
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

	it('takes a push with 499 unread notices however many confirmations wait', async () => {
		const { probe, store } = await boot();
		for (let index = 1; index < NOTIFICATION_QUOTA; index++)
			await store.create(NOTIFICATION_TABLE, row(index) as never);
		for (let index = 0; index < 20; index++)
			await store.create(NOTIFICATION_TABLE, pending(10_000 + index) as never);
		expect((await probe.call('notification-push', { title: 'fits' })).success).toBe(true);
	});
});

describe('notification-list (10.2)', () => {
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

describe('read and archive, and R10', () => {
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

describe('toasts that land (6.1, 3.7)', () => {
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
		expect(danger.data?.notification).toMatch(/^ntf_/);
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
		await set('always');
		expect(
			(await kernel.call<OverlayRefV1>('toast-show', { message: 'mine' })).data?.notification
		).toMatch(/^ntf_/);
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
		const before = await overlays(kernel);
		const timed = await probe.call<OverlayRefV1>('toast-show', { message: 'Quiet' });
		expect(timed.success).toBe(true);
		const sticky = await probe.call<OverlayRefV1>('toast-show', { message: 'Kept', sticky: true });
		expect(sticky.data?.notification).toMatch(/^ntf_/);
		expect(await overlays(kernel)).toEqual(before);
		// The app is told it closed, as if the person dismissed it; the sticky one moved to the inbox.
		expect(await probe.waitOverlay((sticky.data as OverlayRefV1).overlayId)).toMatchObject({
			result: 'dismissed',
			reason: 'inbox',
		});
		expect(await probe.waitOverlay((timed.data as OverlayRefV1).overlayId)).toMatchObject({
			result: 'dismissed',
			reason: 'user',
		});
		await probe.call('notification-push', { title: 'Also kept' });
		const inbox = await listed(kernel, { source: 'probe' });
		// Both at one time, so ties by id: as a set.
		expect(inbox.notifications.map((each) => each.title).sort()).toEqual(['Also kept', 'Kept']);
		expect(inbox.unread).toBe(3);
	});

	it('never mutes the shell or an agent (SETTING_MUTE_SHELL)', async () => {
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

describe('scope (10.1)', () => {
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

describe('replay (P4-E15)', () => {
	it('replays pushes, a landed toast, read, archive and an action the same', async () => {
		const { kernel, journal, probe } = await boot();
		const pushed = await probe.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Note it',
			action: { command: 'probe-note', label: 'Note', input: { text: 'x' } },
		});
		await kernel.agent.call('notification-push', { title: 'From the agent' });
		await probe.call('toast-show', { message: 'Stays', sticky: true });
		await kernel.call('notification-act', { notification: pushed.data?.notification.id });
		await kernel.call('notification-read', { all: true });
		await kernel.call('notification-archive', { all: true, source: 'probe' });
		await kernel.call('notification-list', { body: true });
		const { report } = await replayKernel(await journal.read(), {
			deployment: probeDeployment([entry('probe'), entry('sums')]),
			ports: ports(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
	});
});

describe("the shell's own notices, the seam of steps 8 to 10 (10.2)", () => {
	it('writes a notice from the shell to any person, outside the rate, and nothing at the quota', async () => {
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
			overlays: { land: () => undefined, openClosed: () => ({}) as never },
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
		).toBeUndefined();
	});
});
