/**
 * P4-E3's units (phase 4 specification, 3.6; D117, R4, R12): appearance taken over by the person's `loam.appearance`
 * settings section. `local` mode: an old record moves on the first stage B, journaled as `setting-set` with
 * `migrated: true`, stage A paints from `loam.settings`, and `appearance-set` persists there. `provider` mode: the
 * move only signed in, `loam.appearance.last` paints the signed-out page and stage A, a signed-out `appearance-set`
 * writes `.last` only, and two people keep their own. `loam.settings` is no view-state id. Chromium's half is
 * `web/test/browser/appearance-settings.test.ts`.
 */

import { MockAuthAdapter, type User } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppearanceV0 } from '../appearance.js';
import { createKernel } from '../kernel.js';
import type { MembershipV1 } from '../scope/access.js';
import { createFixedEnvironment, createSteppingClock, SESSION_50 } from '../session.js';
import { replayKernel } from '../testing.js';
import type { KernelEventV4, LoamKernelV5 } from '../types.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ADA = 'mock-user-ada@example.com';
const OLU = 'mock-user-olu@example.com';
const ACME: MembershipV1 = {
	mode: 'provider',
	members: new Map([
		[ADA, 'member'],
		[OLU, 'owner'],
	]),
	digest: 'd1',
};
const user = (id: string): User => {
	const email = id.slice('mock-user-'.length);
	return { id, email, name: email.split('@')[0] as string };
};

/** The old record phase 0 to 3 kept: a view-state row of the profile. */
async function legacy(store: DataAdapter, value: object): Promise<void> {
	await store.create('settings', {
		id: 'loam.appearance',
		category: 'view-state',
		value,
		updatedAt: '2026-01-01T00:00:00.000Z',
	});
}

interface Made {
	kernel: LoamKernelV5;
	journal: MemoryJournalSink;
	auth: MockAuthAdapter;
}

/** A kernel over `store`; `boot` makes stage A paint before stage B runs, as the web host does. */
async function kernelOn(
	store: DataAdapter,
	options: { provider?: boolean; as?: string; boot?: boolean } = {}
): Promise<Made> {
	const journal = new MemoryJournalSink();
	const clock = createSteppingClock();
	const auth = new MockAuthAdapter({ clock: { now: clock } });
	if (options.as) auth._setUser(user(options.as));
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		clock,
		...(options.boot
			? { boot: { generation: 'g', workspace: { id: 'personal', name: 'Personal' }, apps: [] } }
			: {}),
		...(options.provider ? { identity: PROVIDER, membership: ACME } : {}),
	});
	kernels.push(kernel);
	return { kernel, journal, auth };
}

const appearance = async (kernel: LoamKernelV5) =>
	(await kernel.call<AppearanceV0>('appearance-get')).data as AppearanceV0;
const migrations = (entries: JournalEntry[]) =>
	entries
		.filter((entry) => entry.command === 'setting-set')
		.map((entry) => entry.input as { key: string; value: string; migrated?: boolean });
const row = (store: DataAdapter, id: string) =>
	store.get<{ value?: Record<string, unknown> }>('settings', id);

describe('P4-E3: local mode (R12)', () => {
	it('moves an old record on the first stage B, journaled as setting-set with migrated, and paints it throughout', async () => {
		const store = new MemoryAdapter();
		await legacy(store, { theme: 'dark', density: 'compact' });
		const { kernel, journal } = await kernelOn(store, { boot: true });
		// Stage A, before stage B: the old record paints, so nothing flashes.
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark', density: 'compact' });
		await kernel.startApps();
		expect(migrations(await journal.read())).toEqual([
			{ section: 'loam.appearance', key: 'theme', value: 'dark', level: 'person', migrated: true },
			{
				section: 'loam.appearance',
				key: 'density',
				value: 'compact',
				level: 'person',
				migrated: true,
			},
		]);
		expect(await row(store, 'loam.appearance')).toBeFalsy();
		expect((await row(store, 'loam.settings'))?.value?.['loam.appearance']).toMatchObject({
			theme: { value: 'dark', updatedBy: 'local' },
			density: { value: 'compact', updatedBy: 'local' },
		});
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark', density: 'compact' });
		expect(
			(await kernel.call('setting-get', { section: 'loam.appearance', key: 'theme' })).data
		).toMatchObject({ value: 'dark', from: 'person' });
		// A second page moves nothing again, and stage A paints from `loam.settings`.
		const again = await kernelOn(store, { boot: true });
		expect(await appearance(again.kernel)).toMatchObject({ theme: 'dark', density: 'compact' });
		await again.kernel.startApps();
		expect(migrations(await again.journal.read())).toEqual([]);
	});

	it('moves it in a kernel with no boot too, after the persisted state is read', async () => {
		const store = new MemoryAdapter();
		await legacy(store, { theme: 'high-contrast', density: 'comfortable' });
		const { kernel, journal } = await kernelOn(store);
		expect(migrations(await journal.read()).map((input) => input.key)).toEqual([
			'theme',
			'density',
		]);
		expect(await appearance(kernel)).toMatchObject({ theme: 'high-contrast' });
	});

	it('persists appearance-set in loam.settings, signed out, unsuffixed, and the next page paints it', async () => {
		const store = new MemoryAdapter();
		const { kernel } = await kernelOn(store);
		const events: KernelEventV4[] = [];
		kernel.subscribe((event) => events.push(event));
		expect((await kernel.call('appearance-set', { density: 'compact' })).success).toBe(true);
		expect(events.at(-1)?.settings).toEqual(['loam.appearance']);
		const held = (await row(store, 'loam.settings'))?.value?.['loam.appearance'] as Record<
			string,
			unknown
		>;
		expect(Object.keys(held)).toEqual(['density']);
		const next = await kernelOn(store, { boot: true });
		expect(await appearance(next.kernel)).toMatchObject({ theme: 'system', density: 'compact' });
	});

	it('keeps loam.appearance as an alias of its two keys, and loam.settings out of view-state-*', async () => {
		const { kernel } = await kernelOn(new MemoryAdapter());
		const set = await kernel.agent.call('view-state-set', {
			id: 'loam.appearance',
			state: { theme: 'light' },
		});
		expect(set.data).toEqual({
			id: 'loam.appearance',
			state: { theme: 'light', density: 'comfortable' },
			previous: { theme: 'system', density: 'comfortable' },
		});
		expect(set).toMatchObject({
			undoCommand: 'view-state-set',
			undoArgs: {
				id: 'loam.appearance',
				state: { theme: 'system', density: 'comfortable' },
				replace: true,
			},
		});
		expect(
			(await kernel.call('setting-get', { section: 'loam.appearance', key: 'theme' })).data
		).toMatchObject({ value: 'light', from: 'person', updatedBy: 'agent:shell-agent' });
		// Only the key it named is the person's own.
		expect(
			(await kernel.call('setting-get', { section: 'loam.appearance', key: 'density' })).data
		).toMatchObject({ from: 'default' });
		for (const id of ['loam.settings', 'loam.appearance.last']) {
			expect((await kernel.call('view-state-get', { id })).error?.code).toBe(
				'VIEW_STATE_NOT_FOUND'
			);
			expect((await kernel.call('view-state-set', { id, state: { x: 1 } })).error?.code).toBe(
				'VIEW_STATE_NOT_FOUND'
			);
		}
		const listed = await kernel.call<{ states: Array<{ id: string }> }>('view-state-list');
		const ids = listed.data?.states.map((state) => state.id) ?? [];
		expect(ids).toContain('loam.appearance');
		expect(ids).not.toContain('loam.settings');
		expect(ids).not.toContain('loam.appearance.last');
	});

	it("refuses `migrated` from anyone but the shell's own move", async () => {
		const { kernel } = await kernelOn(new MemoryAdapter());
		const agent = await kernel.agent.call('setting-set', {
			section: 'loam.appearance',
			key: 'theme',
			value: 'dark',
			level: 'person',
			migrated: true,
		});
		expect(agent.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			suggestion: 'Leave `migrated` out',
		});
		const other = await kernel.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 3,
			level: 'workspace',
			migrated: true,
		});
		expect(other.error?.code).toBe('VALIDATION_ERROR');
		const off = await kernel.call('setting-set', {
			section: 'loam.appearance',
			key: 'theme',
			value: 'dark',
			level: 'person',
			migrated: false,
		});
		expect(off.error?.code).toBe('VALIDATION_ERROR');
	});

	it('SESSION_50 still replays with no difference', async () => {
		const { kernel, journal } = await kernelOn(new MemoryAdapter());
		for (const call of SESSION_50) {
			if (call.interface === 'agent') await kernel.agent.call(call.name, call.input);
			else await kernel.call(call.name, call.input);
		}
		const { report } = await replayKernel(await journal.read());
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe('P4-E3: provider mode (R4, A-P3-2)', () => {
	it('moves nothing while signed out; the signed-out page paints the old record, then `.last`', async () => {
		const store = new MemoryAdapter();
		await legacy(store, { theme: 'dark', density: 'compact' });
		const { kernel, journal } = await kernelOn(store, { provider: true });
		expect(migrations(await journal.read())).toEqual([]);
		expect(await row(store, 'loam.appearance')).toBeTruthy();
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark' });
		// Signed out, appearance-set writes `.last` alone, never a `~signed-out` record.
		expect((await kernel.call('appearance-set', { theme: 'light' })).success).toBe(true);
		expect((await row(store, 'loam.appearance.last'))?.value).toEqual({
			theme: 'light',
			density: 'compact',
		});
		expect(await row(store, 'loam.settings~signed-out')).toBeFalsy();
		expect(await appearance(kernel)).toMatchObject({ theme: 'light', density: 'compact' });
		// The next page, signed out, paints `.last` in stage A.
		const next = await kernelOn(store, { provider: true, boot: true });
		expect(await appearance(next.kernel)).toMatchObject({ theme: 'light' });
	});

	it("moves the old record into the first signed-in person's, and keeps `.last` as theirs", async () => {
		const store = new MemoryAdapter();
		await legacy(store, { theme: 'dark', density: 'compact' });
		const { kernel, journal } = await kernelOn(store, { provider: true, as: ADA, boot: true });
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark' });
		await kernel.startApps();
		expect(migrations(await journal.read()).map((input) => input.migrated)).toEqual([true, true]);
		expect(await row(store, 'loam.appearance')).toBeFalsy();
		expect((await row(store, `loam.settings~${ADA}`))?.value?.['loam.appearance']).toMatchObject({
			theme: { value: 'dark', updatedBy: ADA },
		});
		expect((await row(store, 'loam.appearance.last'))?.value).toEqual({
			theme: 'dark',
			density: 'compact',
		});
	});

	it('keeps two people their own, and the signed-out page the last one applied', async () => {
		const store = new MemoryAdapter();
		const { kernel } = await kernelOn(store, { provider: true });
		const signIn = (email: string) =>
			kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
		const events: KernelEventV4[] = [];
		kernel.subscribe((event) => events.push(event));
		await signIn('ada@example.com');
		await kernel.call('appearance-set', { theme: 'dark' });
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark' });
		await kernel.call('auth-sign-out');
		// Signed out: Ada's, as `.last`.
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark' });
		await signIn('olu@example.com');
		expect(events.some((event) => event.actorChanged)).toBe(true);
		// Olu's own: none, so the default, which replaces `.last` on sign-in.
		expect(await appearance(kernel)).toMatchObject({ theme: 'system', density: 'comfortable' });
		await kernel.call('setting-set', {
			section: 'loam.appearance',
			key: 'density',
			value: 'compact',
			level: 'person',
		});
		expect(await appearance(kernel)).toMatchObject({ theme: 'system', density: 'compact' });
		expect((await row(store, 'loam.appearance.last'))?.value).toEqual({
			theme: 'system',
			density: 'compact',
		});
		await kernel.call('auth-sign-out');
		await signIn('ada@example.com');
		expect(await appearance(kernel)).toMatchObject({ theme: 'dark', density: 'comfortable' });
		expect((await row(store, `loam.settings~${OLU}`))?.value?.['loam.appearance']).toMatchObject({
			density: { value: 'compact' },
		});
		// A page that starts with Ada signed in paints hers in stage A.
		const next = await kernelOn(store, { provider: true, as: ADA, boot: true });
		expect(await appearance(next.kernel)).toMatchObject({ theme: 'dark' });
	});
});
