/** Tally's scenario through the test kit, imported first since it watches the global registry. */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('tally', () => {
	it('adds and reads, and replays', async () => {
		const { kernel, replay } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT),
			definition: () => import('../src/native.js'),
		});
		await kernel.call('tally-add');
		const after = await kernel.call<{ total: number; history: number[] }>('tally-add', { by: 4 });
		expect(after.data).toEqual({ total: 5, history: [1, 4] });
		const read = await kernel.agent.call<{ total: number }>('tally-get');
		expect(read.data?.total).toBe(5);
		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('passes app check', async () => {
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
	});
});
