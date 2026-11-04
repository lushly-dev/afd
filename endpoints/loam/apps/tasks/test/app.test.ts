/** Tasks' scenario through the test kit: project-only, a store per project, and its resource keys. */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const kernelIn = async (project?: string) =>
	createAppTestKernel({
		manifest: await readAppManifest(ROOT),
		definition: () => import('../src/native.js'),
		...(project !== undefined ? { scope: { project } } : {}),
	});

describe('tasks', () => {
	it('adds, renames with an undo, completes and summarizes in a project, and replays', async () => {
		const { kernel, replay } = await kernelIn('atlas');
		const added = await kernel.call<{ task: { id: string } }>('tasks-add', { title: 'Plan' });
		expect(added.data?.task).toEqual({ id: 't-1', title: 'Plan', done: false, seq: 1 });
		await kernel.call('tasks-add-blank');
		const renamed = await kernel.call('tasks-rename', { task: 't-2', title: 'Review' });
		expect(renamed.undoArgs).toEqual({ task: 't-2', title: 'Untitled' });
		await kernel.call('tasks-complete', { task: 't-1' });
		expect((await kernel.agent.call('tasks-list')).data).toEqual({
			items: [
				{ id: 't-1', title: 'Plan', description: 'Done' },
				{ id: 't-2', title: 'Review' },
			],
		});
		expect((await kernel.call('tasks-summary')).data).toEqual({
			counts: [
				{ label: 'Open', value: 1 },
				{ label: 'Done', value: 1 },
			],
			recent: [{ title: 'Review' }, { title: 'Plan' }],
		});
		expect((await kernel.call('tasks-complete', { task: 't-9' })).error?.code).toBe(
			'TASK_NOT_FOUND'
		);
		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('keeps each project apart, refuses another project’s task with its name, and needs a project', async () => {
		const { kernel } = await kernelIn('atlas');
		await kernel.call('tasks-add', { title: 'In Atlas' });
		const beacon = await kernel.call<{ id: string }>('project-create', { name: 'Beacon' });
		await kernel.call('scope-set', { project: beacon.data?.id });
		expect((await kernel.call('tasks-list')).data).toEqual({ items: [] });
		const crossed = await kernel.call('tasks-complete', { task: 't-1' });
		expect(crossed.error?.code).toBe('SCOPE_MISMATCH');
		expect(crossed.error?.message).toContain('the project atlas');
		await kernel.call('scope-set', { project: null });
		expect((await kernel.call('tasks-list')).error?.code).toBe('SCOPE_PROJECT_REQUIRED');
	});

	it('passes app check as a version 2 manifest', async () => {
		const manifest = await readAppManifest(ROOT);
		expect(manifest.manifest_version).toBe(2);
		expect(manifest.app?.scope_levels).toEqual(['project']);
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
	});
});
