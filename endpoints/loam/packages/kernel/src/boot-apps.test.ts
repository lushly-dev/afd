/**
 * Stage A's apps, from the boot records alone, and D66 when stage B cannot read them (phase 2
 * specification, 2.2): the shell still runs, and each deployed app is listed with the reason. The chunk's
 * own failure, and the first paint, are in `web`'s Chromium suite.
 */

import type { BootAppV2, BootProjectionV2 } from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoamKernelError } from './errors.js';
import { NEEDS_STAGE_B } from './kernel.js';
import { createTestKernel } from './testing.js';
import type { AppDetailV1, AppSummaryV2, AppsLoadV2, LoamKernelV2 } from './types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const record = (instance: string, extra: Partial<BootAppV2> = {}): BootAppV2 => ({
	instance,
	app: instance,
	title: instance,
	kind: 'native',
	icon: 'system/folder',
	order: 100,
	scopeLevels: ['workspace'],
	rail: true,
	parts: [],
	layout: {},
	refusal: null,
	...extra,
});

const bootOf = (apps: BootAppV2[]): BootProjectionV2 => ({
	generation: 'test',
	workspace: { id: 'personal', name: 'Personal' },
	apps,
});

async function boot(apps: BootAppV2[], appsLoader?: () => Promise<AppsLoadV2>) {
	vi.stubGlobal('reportError', vi.fn());
	const { kernel, journal } = await createTestKernel({
		boot: bootOf(apps),
		...(appsLoader ? { appsLoader } : {}),
	});
	kernels.push(kernel);
	return { kernel, journal };
}

const listOf = async (kernel: LoamKernelV2) =>
	(await kernel.call<{ active: string | null; apps: AppSummaryV2[] }>('app-list')).data;

describe('stage A: the apps from their boot records', () => {
	it('lists each in rail order, loading or refused, with its levels, and loads nothing', async () => {
		const loader = vi.fn<() => Promise<AppsLoadV2>>(() => new Promise(() => {}));
		const { kernel, journal } = await boot(
			[
				record('hello', { title: 'Hi', order: 2, scopeLevels: ['workspace', 'project'] }),
				record('second', { order: 1, kind: 'view' }),
				record('tasks', { order: 3, scopeLevels: ['project'] }),
				record('broken', {
					order: 4,
					refusal: { code: 'MANIFEST_INVALID', message: 'No.', suggestion: 'Fix it.' },
				}),
			],
			loader
		);
		const list = await listOf(kernel);
		expect(
			list?.apps.map(({ instance, title, state, available }) => [instance, title, state, available])
		).toEqual([
			['second', 'second', 'loading', true],
			['hello', 'Hi', 'loading', true],
			['tasks', 'tasks', 'loading', false],
			['broken', 'broken', 'refused', true],
		]);
		expect(list?.apps[1]).toMatchObject({
			kind: 'native',
			scopeLevels: ['workspace', 'project'],
			rail: true,
		});
		expect(list?.apps[3]?.error).toEqual({
			code: 'MANIFEST_INVALID',
			message: 'No.',
			suggestion: 'Fix it.',
			retryable: false,
		});
		// Stage B has not started: nothing was read, and nothing of an app is registered.
		expect(loader).not.toHaveBeenCalled();
		expect(kernel.listCommands().map((row) => row.name)).toEqual([
			'layout-get',
			'appearance-get',
			'auth-session-get',
			'app-list',
		]);
		expect(() => kernel.appPort('hello')).toThrow(
			expect.objectContaining({ code: 'APP_NOT_READY', retryable: true })
		);
		expect(() => kernel.appPort('gone')).toThrow(
			expect.objectContaining({ code: 'APP_NOT_FOUND' })
		);
		// An empty journal: boot's reads are not journaled until a person or agent asks.
		expect(await journal.read()).toHaveLength(1);
	});

	it('holds none of NEEDS_STAGE_B in stage A, so each waits for stage B', async () => {
		const { kernel } = await boot([record('hello')], () => new Promise(() => {}));
		const held = kernel.listCommands().map((row) => row.name);
		expect(NEEDS_STAGE_B.filter((name) => held.includes(name))).toEqual([]);
		let answered = false;
		void kernel.call('app-get', { instance: 'hello' }).then(() => {
			answered = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(answered).toBe(false);
	});

	it("gives a persisted active app its boot record's first layout before stage B", async () => {
		const { kernel } = await boot(
			[record('hello', { parts: ['sidebar'], layout: { sidebar: { open: true, width: 300 } } })],
			() => new Promise(() => {})
		);
		const layout = await kernel.call<{ sidebar: { open: boolean; width: number } }>('layout-get');
		// No app is active yet, so this is the no-app record.
		expect(layout.data?.sidebar.open).toBe(true);
		expect(kernel.listKeybindings().length).toBeGreaterThan(0);
	});
});

describe('stage B, when it cannot read the apps', () => {
	it('lists each with the reason, in rail order, and opening one succeeds', async () => {
		const { kernel } = await boot(
			[
				record('hello', { title: 'Hi', order: 2, parts: ['sidebar', 'panel'] }),
				record('second', { order: 1 }),
			],
			() => Promise.reject(new Error('it did not load'))
		);
		await kernel.startApps();
		const list = await listOf(kernel);
		expect(list?.apps.map(({ instance, title, state }) => [instance, title, state])).toEqual([
			['second', 'second', 'failed'],
			['hello', 'Hi', 'failed'],
		]);
		expect(list?.apps[0]?.error).toMatchObject({
			code: 'APP_RUNTIME_UNAVAILABLE',
			message: expect.stringContaining('it did not load'),
			suggestion: expect.stringContaining('Reload'),
			retryable: true,
		});

		const opened = await kernel.call('app-open', { instance: 'hello' });
		expect(opened.data).toEqual({ active: 'hello', previous: null });
		const detail = await kernel.call<AppDetailV1>('app-get', { instance: 'hello' });
		expect(detail.data?.state).toBe('failed');
		// Its record is the boot record's, so its parts are the ones it declared.
		expect(detail.data?.surfaces).toEqual(['sidebar', 'panel']);
		expect((await kernel.call('layout-set', { panel: { open: true } })).success).toBe(true);
		expect((await kernel.call('app-close')).data).toEqual({ active: null, previous: 'hello' });
		expect((await kernel.call('app-open', { instance: 'gone' })).error?.code).toBe('APP_NOT_FOUND');
		expect((await kernel.call('app-get', { instance: 'gone' })).error?.code).toBe('APP_NOT_FOUND');
		expect(() => kernel.appPort('hello')).toThrow(
			expect.objectContaining({ code: 'APP_NOT_READY', retryable: false })
		);
	});

	it("lists each failed with DEPLOYMENT_INVALID and the reader's message when it refuses", async () => {
		const { kernel } = await boot([record('hello')], () =>
			Promise.resolve({
				refused: 'Its deployment.json is refused: `apps[0].url` is not a key here.',
			})
		);
		await kernel.startApps();
		const list = await listOf(kernel);
		expect(list?.apps[0]).toMatchObject({
			state: 'failed',
			error: { code: 'DEPLOYMENT_INVALID', message: expect.stringContaining('apps[0].url') },
		});
	});

	it('refuses a project-only app with no project, and a switch under a shell modal (#709)', async () => {
		const { kernel } = await boot(
			[record('tasks', { scopeLevels: ['project'] }), record('hello')],
			() => Promise.reject(new Error('it did not load'))
		);
		await kernel.startApps();
		expect((await kernel.call('app-open', { instance: 'tasks' })).error).toMatchObject({
			code: 'SCOPE_PROJECT_REQUIRED',
			message: 'Open a project first',
			suggestion: expect.stringContaining('scope-set'),
		});
		expect((await kernel.call('modal-open', { title: 'Sure?', body: 'Sure?' })).success).toBe(true);
		expect((await kernel.call('app-open', { instance: 'hello' })).error).toMatchObject({
			code: 'OVERLAY_MODAL_BUSY',
			retryable: true,
		});
	});

	it('answers a port of a listed app as not ready, and never as a kernel error of its own', () => {
		const error = new LoamKernelError({
			code: 'APP_NOT_READY',
			message: 'x',
			suggestion: 'y',
			retryable: true,
		});
		expect(error.retryable).toBe(true);
		expect(
			new LoamKernelError({ code: 'APP_NOT_READY', message: 'x', suggestion: 'y' }).retryable
		).toBe(false);
	});
});
