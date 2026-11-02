/**
 * Hello's own scenario through the test kit, and `app check` on it: E8 and E13 (phase 1 specification,
 * section 14). The kit is imported first, since it watches the global registry from its own import.
 */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = 'manifests/native.toml';

const boot = async (config?: Record<string, unknown>) =>
	createAppTestKernel({
		manifest: await readAppManifest(ROOT, MANIFEST),
		definition: () => import('../src/native.js'),
		...(config !== undefined ? { config } : {}),
	});

const VIEW_MANIFEST = 'manifests/view.toml';

describe('hello as a view', () => {
	it('runs the same handlers, and a journal with them replays with no iframe', async () => {
		const { kernel, replay } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT, VIEW_MANIFEST),
			definition: () => import('../src/native.js'),
			config: { default_name: 'friend' },
		});
		const named = await kernel.call<{ greeting: string }>('hello-greet', { name: 'Ada' });
		expect(named.data?.greeting).toBe('Hello, Ada!');
		const unnamed = await kernel.agent.call<{ greeting: string }>('hello-greet');
		expect(unnamed.data?.greeting).toBe('Hello, friend!');
		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('is sandboxed in app check, with its pages one file each', async () => {
		const report = await appCheck({ dir: ROOT, manifest: VIEW_MANIFEST });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('SANDBOXED');
	});
});

describe('hello', () => {
	it('greets, lists and forgets, from a person and an agent, and replays', async () => {
		const { kernel, replay } = await boot({ default_name: 'friend' });
		const named = await kernel.call<{ greeting: string; at: number }>('hello-greet', {
			name: 'Ada',
		});
		expect(named.data?.greeting).toBe('Hello, Ada!');
		expect(named.data?.at).toEqual(expect.any(Number));
		expect(named.undoCommand).toBe('hello-forget');
		const unnamed = await kernel.agent.call<{ greeting: string }>('hello-greet');
		expect(unnamed.data?.greeting).toBe('Hello, friend!');

		const listed = await kernel.call<{ items: Array<{ id: string }> }>('hello-list');
		expect(listed.data?.items.map(({ id }) => id)).toEqual(['Ada', 'friend']);

		await kernel.call('hello-forget', { name: 'Ada' });
		const after = await kernel.call<{ items: Array<{ id: string }> }>('hello-list');
		expect(after.data?.items.map(({ id }) => id)).toEqual(['friend']);

		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('drives the layout through the view-state commands', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'hello' });
		const first = await kernel.call<{ sidebar: { open: boolean; width: number } }>('layout-get');
		expect(first.data?.sidebar).toEqual({ open: true, width: 260 });
		const refused = await kernel.call('layout-set', { panel: { open: true } });
		expect(refused.error?.code).toBe('LAYOUT_PART_UNDECLARED');
	});

	it('stamps nothing without the clock grant', async () => {
		const { kernel } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT, MANIFEST),
			definition: () => import('../src/native.js'),
			grants: ['store'],
		});
		const result = await kernel.call<{ at: number | null }>('hello-greet', { name: 'Ada' });
		expect(result.data?.at).toBeNull();
	});

	it('is trusted, not sandboxed, in app check', async () => {
		const report = await appCheck({ dir: ROOT, manifest: MANIFEST });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
		expect(report.trust?.line).toContain('Trusted, not sandboxed');
	});
});
