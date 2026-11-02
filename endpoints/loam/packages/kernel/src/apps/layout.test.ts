import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel } from '../kernel.js';
import type { LayoutStateV0 } from '../layout.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createTestKernel,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
} from '../testing.js';
import type { LoamKernelV1 } from '../types.js';

const kernels: LoamKernelV1[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const packages = () =>
	createFixturePorts({
		'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
	});

async function boot() {
	const { kernel, journal } = await createTestKernel({
		deployment: probeDeployment(),
		ports: packages(),
	});
	kernels.push(kernel);
	return { kernel, journal };
}

const layoutOf = async (kernel: LoamKernelV1) =>
	(await kernel.call<LayoutStateV0>('layout-get')).data as LayoutStateV0;

describe('per-app layout (4.5)', () => {
	it('seeds the first open from the preset, with undeclared parts closed', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const layout = await layoutOf(kernel);
		expect(layout.sidebar).toEqual({ open: true, width: 300 });
		expect(layout.inspector.open).toBe(false);
		expect(layout.panel.open).toBe(false);
	});

	it('keeps each owner apart across a switch', async () => {
		const { kernel } = await boot();
		await kernel.call('layout-set', { sidebar: { width: 400 } });
		await kernel.call('app-open', { instance: 'probe' });
		await kernel.call('layout-set', { sidebar: { width: 220 } });
		expect((await layoutOf(kernel)).sidebar.width).toBe(220);
		await kernel.call('app-close');
		expect((await layoutOf(kernel)).sidebar.width).toBe(400);
		await kernel.call('app-open', { instance: 'probe' });
		expect((await layoutOf(kernel)).sidebar.width).toBe(220);
	});

	it('refuses opening an undeclared part, journaled, and still takes its size', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const refused = await kernel.call('layout-set', { inspector: { open: true } });
		expect(refused.error?.code).toBe('LAYOUT_PART_UNDECLARED');
		expect(refused.error?.message).toContain('inspector');
		expect(refused.error?.suggestion).toContain('ui.surfaces.inspector');
		expect((await journal.read()).at(-1)?.result.error?.code).toBe('LAYOUT_PART_UNDECLARED');
		expect((await layoutOf(kernel)).inspector.open).toBe(false);
		expect((await kernel.call('layout-set', { inspector: { width: 300 } })).success).toBe(true);
		expect((await layoutOf(kernel)).inspector.width).toBe(300);
		// A declared part opens, and the compact drawer and sheet count as opening.
		expect((await kernel.call('layout-set', { panel: { open: true } })).success).toBe(true);
		expect(
			(await kernel.call('layout-set', { compact: { drawer: 'inspector' } })).error?.code
		).toBe('LAYOUT_PART_UNDECLARED');
		expect((await kernel.call('layout-set', { compact: { drawer: 'sidebar' } })).success).toBe(
			true
		);
	});

	it('leaves every part available with no app active', async () => {
		const { kernel } = await boot();
		expect((await kernel.call('layout-set', { inspector: { open: true } })).success).toBe(true);
	});

	it('closes every part of a refused app', async () => {
		const ports = createFixturePorts({ 'apps/probe/': { manifest: { bad: true } } });
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		await kernel.call('app-open', { instance: 'probe' });
		const layout = await layoutOf(kernel);
		expect([layout.sidebar.open, layout.inspector.open, layout.panel.open]).toEqual([
			false,
			false,
			false,
		]);
	});

	it('resets to the app first layout', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		await kernel.call('layout-set', { sidebar: { width: 450 } });
		const reset = await kernel.call<LayoutStateV0>('layout-reset');
		expect(reset.data?.sidebar.width).toBe(300);
		await kernel.call('app-close');
		expect((await layoutOf(kernel)).sidebar.width).toBe(260);
	});
});

describe('view-state on the layout (4.5)', () => {
	it('reads `loam.layout` from the active owner, and equals layout-get', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const read = await kernel.call<{ id: string; state: LayoutStateV0 }>('view-state-get', {
			id: 'loam.layout',
		});
		expect(read.data?.id).toBe('loam.layout');
		expect(read.data?.state).toEqual(await layoutOf(kernel));
	});

	it('writes `loam.layout` to the active owner, and the guard covers it', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const set = await kernel.call<{ id: string }>('view-state-set', {
			id: 'loam.layout',
			state: { sidebar: { width: 222 } },
		});
		expect(set.data?.id).toBe('loam.layout');
		expect(set.undoArgs?.id).toBe('loam.layout.probe');
		expect((await layoutOf(kernel)).sidebar.width).toBe(222);
		const direct = await kernel.call<{ state: LayoutStateV0 }>('view-state-get', {
			id: 'loam.layout.probe',
		});
		expect(direct.data?.state.sidebar.width).toBe(222);
		await kernel.call('app-close');
		expect((await layoutOf(kernel)).sidebar.width).toBe(260);

		for (const id of ['loam.layout.probe']) {
			expect(
				(await kernel.call('view-state-set', { id, state: { sidebar: { width: 9999 } } })).error
					?.code
			).toBe('VALIDATION_ERROR');
			expect(
				(await kernel.call('view-state-set', { id, state: { inspector: { open: true } } })).error
					?.code
			).toBe('LAYOUT_PART_UNDECLARED');
		}
		expect(
			(await kernel.call('view-state-set', { id: 'loam.layout.nope', state: {} })).error?.code
		).toBe('VIEW_STATE_NOT_FOUND');
	});

	it('refuses a write to `loam.apps`, naming app-open', async () => {
		const { kernel, journal } = await boot();
		const refused = await kernel.call('view-state-set', {
			id: 'loam.apps',
			state: { active: 'probe' },
		});
		expect(refused.error?.code).toBe('VIEW_STATE_READ_ONLY');
		expect(refused.error?.suggestion).toContain('app-open');
		expect((await journal.read()).at(-1)?.result.error?.code).toBe('VIEW_STATE_READ_ONLY');
		const read = await kernel.call('view-state-get', { id: 'loam.apps' });
		expect(read.data).toEqual({ id: 'loam.apps', state: { active: null } });
		await kernel.call('app-open', { instance: 'probe' });
		expect((await kernel.call('view-state-get', { id: 'loam.apps' })).data).toEqual({
			id: 'loam.apps',
			state: { active: 'probe' },
		});
	});
});

describe('persistence', () => {
	async function persisted(store: MemoryAdapter, apps = probeDeployment()) {
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: apps,
			ports: packages(),
		});
		kernels.push(kernel);
		return kernel;
	}

	it('reopens the active app and each record under its own id, with the preset only first', async () => {
		const store = new MemoryAdapter();
		const first = await persisted(store);
		await first.call('layout-set', { sidebar: { width: 410 } });
		await first.call('app-open', { instance: 'probe' });
		await first.call('layout-set', { sidebar: { width: 222 } });
		await first.flush();

		const journal = new MemoryJournalSink();
		const second = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: probeDeployment(),
			ports: packages(),
		});
		kernels.push(second);
		const list = await second.call<{ active: string }>('app-list');
		expect(list.data?.active).toBe('probe');
		expect((await second.call<LayoutStateV0>('layout-get')).data?.sidebar.width).toBe(222);
		expect((await journal.read()).map((entry) => entry.command)).toEqual([
			'app-list',
			'layout-get',
		]);
		await second.call('app-close');
		expect((await second.call<LayoutStateV0>('layout-get')).data?.sidebar.width).toBe(410);
	});

	it('closes a part a persisted record holds open, once the manifest no longer declares it', async () => {
		const store = new MemoryAdapter();
		await store.update('settings', 'loam.layout.probe', {
			id: 'loam.layout.probe',
			category: 'view-state',
			value: { inspector: { open: true }, compact: { drawer: 'inspector', sheet: false } },
		});
		const kernel = await persisted(store);
		await kernel.call('app-open', { instance: 'probe' });
		const layout = await layoutOf(kernel);
		expect(layout.inspector.open).toBe(false);
		expect(layout.compact.drawer).toBeNull();
		// A declared part in the same record is left as it was.
		expect((await kernel.call('layout-set', { panel: { open: true } })).success).toBe(true);
	});

	it('forgets an active app the deployment no longer lists', async () => {
		const store = new MemoryAdapter();
		const first = await persisted(store);
		await first.call('app-open', { instance: 'probe' });
		await first.flush();
		const second = await persisted(store, probeDeployment([]));
		expect((await second.call('app-list')).data).toEqual({ active: null, apps: [] });
		expect((await second.call<LayoutStateV0>('layout-get')).data?.sidebar.width).toBe(260);
	});
});
