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

	it("P4-E10: drops a message over messageBytes at its broker, journaled, so limit-usage-get replays (phase 4's section 11)", async () => {
		const { kernel, port, replay } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT, VIEW_MANIFEST),
			definition: () => import('../src/native.js'),
		});
		await expect(
			port.view?.toolsCall({ name: 'hello-list', arguments: { pad: 'x'.repeat(1_048_576) } })
		).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE', details: { limit: 1_048_576 } });
		// The refusal is journaled as it is answered; read once it has landed.
		await expect
			.poll(async () => {
				const read = await kernel.call<{
					instances: Array<{ refusals: { messageBytes: number } }>;
				}>('limit-usage-get', { instance: 'hello' });
				return read.data?.instances[0]?.refusals.messageBytes;
			})
			.toBe(1);
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

		// The guest book (phase 4 specification, section 1): every visitor greeted, by name.
		const guests = await kernel.call<{ guests: Array<{ name: string; greeted: boolean }> }>(
			'hello-guests'
		);
		expect(guests.data?.guests.map(({ name, greeted }) => ({ name, greeted }))).toEqual([
			{ name: 'Ada', greeted: true },
			{ name: 'friend', greeted: true },
		]);

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

	it("greets with the greeting that applies: the project's, else the workspace's, else Hello (phase 4's 3.8)", async () => {
		const { kernel, replay } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT, MANIFEST),
			definition: () => import('../src/native.js'),
			scope: { project: 'atlas' },
		});
		const greet = async () =>
			(await kernel.call<{ greeting: string }>('hello-greet', { name: 'Ada' })).data?.greeting;
		expect(await greet()).toBe('Hello, Ada!');
		const set = (value: string, level: 'workspace' | 'project') =>
			kernel.call('setting-set', { section: 'hello.general', key: 'greeting', value, level });
		expect((await set('Hi team', 'workspace')).success).toBe(true);
		expect(await greet()).toBe('Hi team, Ada!');
		expect((await set('Hi Atlas', 'project')).success).toBe(true);
		expect(await greet()).toBe('Hi Atlas, Ada!');
		// The board is a project's alone (`hello.project`), with its default.
		expect(
			(await kernel.call('setting-get', { section: 'hello.project', key: 'board' })).data
		).toMatchObject({ value: 'Guests', from: 'default' });
		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('greets with Hello without the settings grant', async () => {
		const { kernel } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT, MANIFEST),
			definition: () => import('../src/native.js'),
			grants: ['store', 'clock'],
		});
		await kernel.call('setting-set', {
			section: 'hello.general',
			key: 'greeting',
			value: 'Hi team',
			level: 'workspace',
		});
		const result = await kernel.call<{ greeting: string }>('hello-greet', { name: 'Ada' });
		expect(result.data?.greeting).toBe('Hello, Ada!');
	});

	it("answers its store's QUOTA_EXCEEDED as the refusal, with its details (phase 4's section 11)", async () => {
		const { kernel, port } = await boot();
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.limits',
					key: 'storeBytes',
					value: 1_048_576,
					level: 'workspace',
				})
			).success
		).toBe(true);
		// Filled to the limit through hello's own store, then hello's own handler writes one more record.
		await port.store?.put('fill', 'x'.repeat(1_048_541));
		const refused = await kernel.call('hello-greet', { name: 'Ada' });
		expect(refused.error).toMatchObject({
			code: 'QUOTA_EXCEEDED',
			details: { kind: 'store', limit: 1_048_576 },
		});
		expect(refused.error?.suggestion).toContain('loam.limits.storeBytes');
	});

	it('is trusted, not sandboxed, in app check', async () => {
		const report = await appCheck({ dir: ROOT, manifest: MANIFEST });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
		expect(report.trust?.line).toContain('Trusted, not sandboxed');
	});
});
