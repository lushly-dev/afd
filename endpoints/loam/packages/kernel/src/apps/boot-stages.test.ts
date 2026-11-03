/**
 * The boot in two stages with a deployment that loads (phase 2 specification, 2.2): stage A paints from
 * the boot records, and stage B's manifests win where a record says otherwise, keeping what `hydrate`
 * loaded. E1's Chromium half is in `web/test/browser/scope/first-paint.test.ts`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { BootAppV2, BootProjectionV2 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '../kernel.js';
import type { LayoutStateV0 } from '../layout.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
} from '../testing.js';
import type { AppSummaryV2, LoamKernelV2 } from '../types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** A record that lies about everything but its ids: stage B must correct each field. */
const LIAR: BootAppV2 = {
	instance: 'probe',
	app: 'probe',
	title: 'Liar',
	kind: 'mounted',
	icon: 'system/warning',
	order: 1,
	scopeLevels: ['project'],
	rail: true,
	parts: ['inspector'],
	layout: { inspector: { open: true } },
	refusal: null,
};

const bootOf = (apps: BootAppV2[]): BootProjectionV2 => ({
	generation: 'test',
	workspace: { id: 'personal', name: 'Personal' },
	apps,
});

async function boot(
	apps: BootAppV2[],
	store = new MemoryAdapter(),
	deployment = probeDeployment()
) {
	const ports = createFixturePorts({
		'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
	});
	const journal = new MemoryJournalSink();
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		boot: bootOf(apps),
		appsLoader: async () => ({ deployment, ports }),
	});
	kernels.push(kernel);
	return { kernel, journal };
}

const listOf = async (kernel: LoamKernelV2) =>
	(await kernel.call<{ active: string | null; apps: AppSummaryV2[] }>('app-list')).data;
const layoutOf = async (kernel: LoamKernelV2) =>
	(await kernel.call<LayoutStateV0>('layout-get')).data as LayoutStateV0;

describe('stage B corrects a boot record', () => {
	it('lists what the manifest says once stage B ends, whatever the record said', async () => {
		const { kernel } = await boot([LIAR]);
		expect((await listOf(kernel))?.apps).toMatchObject([
			{ instance: 'probe', title: 'Liar', kind: 'mounted', state: 'loading', available: false },
		]);
		await kernel.startApps();
		expect((await listOf(kernel))?.apps).toMatchObject([
			{
				instance: 'probe',
				title: 'Probe',
				kind: 'native',
				icon: 'system/document',
				order: 10,
				state: 'ready',
				scopeLevels: ['workspace'],
				rail: true,
				available: true,
			},
		]);
		await kernel.call('app-open', { instance: 'probe' });
		const layout = await layoutOf(kernel);
		// The manifest declares the sidebar and the panel, not the inspector the record opened.
		expect(layout.inspector.open).toBe(false);
		expect(layout.sidebar).toEqual({ open: true, width: 300 });
		expect((await kernel.call('layout-set', { inspector: { open: true } })).error?.code).toBe(
			'LAYOUT_PART_UNDECLARED'
		);
		expect(kernel.appPort('probe').instance).toBe('probe');
	});

	it("paints a persisted active app's layout in stage A, and keeps it through stage B", async () => {
		const store = new MemoryAdapter();
		const first = await boot([{ ...LIAR, scopeLevels: ['workspace'], parts: ['sidebar'] }], store);
		await first.kernel.startApps();
		await first.kernel.call('app-open', { instance: 'probe' });
		await first.kernel.call('layout-set', { sidebar: { width: 222 } });
		await first.kernel.flush();

		const { kernel, journal } = await boot(
			[{ ...LIAR, scopeLevels: ['workspace'], parts: ['sidebar'] }],
			store
		);
		expect((await listOf(kernel))?.active).toBe('probe');
		expect((await layoutOf(kernel)).sidebar).toEqual({ open: true, width: 222 });
		await kernel.startApps();
		expect((await listOf(kernel))?.active).toBe('probe');
		expect((await layoutOf(kernel)).sidebar).toEqual({ open: true, width: 222 });
		// Stage B journals nothing of its own.
		expect((await journal.read()).map((entry) => entry.command)).toEqual([
			'app-list',
			'layout-get',
			'app-list',
			'layout-get',
		]);
	});

	it('reads the record of an instance only stage B lists, and forgets an active app it drops', async () => {
		const store = new MemoryAdapter();
		await store.update('settings', 'loam.layout.probe', {
			id: 'loam.layout.probe',
			category: 'view-state',
			value: { sidebar: { width: 333 } },
		});
		const { kernel } = await boot([{ ...LIAR, instance: 'ghost', app: 'ghost' }], store);
		await kernel.startApps();
		expect((await listOf(kernel))?.apps.map((app) => app.instance)).toEqual(['probe']);
		await kernel.call('app-open', { instance: 'probe' });
		expect((await layoutOf(kernel)).sidebar.width).toBe(333);

		const second = await boot([LIAR], store, probeDeployment([]));
		await second.kernel.call('app-open', { instance: 'probe' }).catch(() => undefined);
		await second.kernel.startApps();
		expect(await listOf(second.kernel)).toEqual({ active: null, apps: [] });
	});

	it('journals calls queued behind stage B in the order they were made, however hashing finishes', async () => {
		// The journal appends after hashing the context with WebCrypto, which finishes in any order, so two
		// queued calls run together could be journaled reversed. Here the first call's hash is the slow one.
		const subtle = globalThis.crypto.subtle;
		const digest = subtle.digest.bind(subtle);
		let hashes = 0;
		const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
			const first = ++hashes === 1;
			const result = await digest(algorithm, data);
			if (first) await new Promise((resolve) => setTimeout(resolve, 30));
			return result;
		});
		try {
			const { kernel, journal } = await boot([LIAR]);
			const calls = [
				kernel.call('app-get', { instance: 'probe' }),
				kernel.call('app-list'),
				kernel.agent.call('layout-get'),
			];
			await Promise.all(calls);
			expect((await journal.read()).map((entry) => entry.command)).toEqual([
				'app-get',
				'app-list',
				'layout-get',
			]);
		} finally {
			spy.mockRestore();
		}
	});

	it("queues an app port's call behind stage B's queue, so it cannot overtake it in the journal", async () => {
		const subtle = globalThis.crypto.subtle;
		const digest = subtle.digest.bind(subtle);
		let hashes = 0;
		const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
			const first = ++hashes === 1;
			const result = await digest(algorithm, data);
			if (first) await new Promise((resolve) => setTimeout(resolve, 30));
			return result;
		});
		try {
			const { kernel, journal } = await boot([LIAR]);
			const first = kernel.call('app-get', { instance: 'probe' });
			await kernel.appsReady;
			// Stage B has ended, and the first call is still on its way: the port's call joins the queue.
			const fromPort = kernel.appPort('probe').call('app-selection-get', { instance: 'probe' });
			await Promise.all([first, fromPort]);
			expect((await journal.read()).map((entry) => entry.command)).toEqual([
				'app-get',
				'app-selection-get',
			]);
		} finally {
			spy.mockRestore();
		}
	});

	it("runs a queued call's nested call past the queue, which would otherwise never drain", async () => {
		// Made before stage B ends, so it queues; its handler's nested call names it as its parent.
		const { kernel } = await boot([LIAR]);
		const counted = await kernel.call<{ count: number }>('probe-count', {});
		expect(counted).toMatchObject({ success: true, data: { count: 0 } });
	}, 5_000);

	it('runs a call that needs stage B after it, in the order calls were made', async () => {
		const { kernel, journal } = await boot([LIAR]);
		const detail = kernel.call<{ title: string }>('app-get', { instance: 'probe' });
		const list = kernel.call('app-list');
		expect((await detail).data?.title).toBe('Probe');
		expect((await list).success).toBe(true);
		expect((await journal.read()).map((entry) => entry.command)).toEqual(['app-get', 'app-list']);
	});
});
