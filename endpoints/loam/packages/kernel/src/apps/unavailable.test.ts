/**
 * D66 when the code that reads apps does not load (phase 1 specification, 9.5): the shell still runs, and
 * each deployed app is listed with the reason. The chunk's own failure is in `web`'s Chromium suite.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createTestKernel } from '../testing.js';
import type { AppDetailV1, AppSummaryV1, LoamKernelV1 } from '../types.js';

const kernels: LoamKernelV1[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

async function boot(apps: unknown) {
	const { kernel } = await createTestKernel({
		deployment: { deployment_version: 1, sandbox_origin: null, apps } as never,
		appsUnavailable: 'it did not load',
	});
	kernels.push(kernel);
	return kernel;
}

describe('apps the runtime could not load', () => {
	it('lists each with the reason, in the rail order, and opening one succeeds', async () => {
		const kernel = await boot([
			{ instance: 'hello', app: 'hello', package: 'apps/hello/', title: 'Hi', order: 2 },
			{ instance: 'second', app: 'second', package: 'apps/second/', order: 1 },
			{ package: 'no instance' },
			null,
		]);
		const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
		expect(data?.apps.map(({ instance, title, state }) => [instance, title, state])).toEqual([
			['second', 'second', 'failed'],
			['hello', 'Hi', 'failed'],
		]);
		expect(data?.apps[0]?.error).toMatchObject({
			code: 'APP_RUNTIME_UNAVAILABLE',
			message: expect.stringContaining('it did not load'),
			suggestion: expect.stringContaining('Reload'),
			retryable: true,
		});

		const opened = await kernel.call('app-open', { instance: 'hello' });
		expect(opened.data).toEqual({ active: 'hello', previous: null });
		const detail = await kernel.call<AppDetailV1>('app-get', { instance: 'hello' });
		expect(detail.data?.state).toBe('failed');
		// With no manifest there is no record of its own, so the parts stay available.
		expect(detail.data?.surfaces).toEqual(['sidebar', 'inspector', 'panel']);
		expect((await kernel.call('layout-set', { panel: { open: true } })).success).toBe(true);
		expect((await kernel.call('app-close')).data).toEqual({ active: null, previous: 'hello' });
		expect((await kernel.call('app-open', { instance: 'gone' })).error?.code).toBe('APP_NOT_FOUND');
		expect((await kernel.call('app-get', { instance: 'gone' })).error?.code).toBe('APP_NOT_FOUND');
	});

	it('survives a projection the readers never saw', async () => {
		const kernel = await boot('not a list');
		const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
		expect(data?.apps).toEqual([]);
		expect((await kernel.call('layout-get')).success).toBe(true);
	});
});
