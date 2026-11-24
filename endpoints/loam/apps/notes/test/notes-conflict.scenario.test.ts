/**
 * Screens from Jobs Phase 5 (#2039, Slice 1 exit criteria 1 & 3):
 * Runs `specimens/scenarios/notes-conflict.scenario.yaml` headless against Loam's real `createTestKernel`
 * (via `createAppTestKernel`) with no browser, and verifies that the browser-safe `NOTES_MANIFEST` used
 * by the job specimens stays identical to `loam-app.toml`.
 */

import { fileURLToPath } from 'node:url';
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import { readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';
import { NOTES_MANIFEST } from '../specimens/notes-manifest.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIO_PATH = fileURLToPath(
	new URL('../specimens/scenarios/notes-conflict.scenario.yaml', import.meta.url)
);

describe('notes-conflict scenario (headless)', () => {
	it('keeps the specimen browser manifest identical to loam-app.toml', async () => {
		const manifest = await readAppManifest(ROOT);
		expect(NOTES_MANIFEST).toEqual(manifest);
	});

	it('passes headless against the real Loam test kernel and replays without divergence', async () => {
		const parsed = await parseScenarioFile(SCENARIO_PATH);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const { kernel, replay } = await createAppTestKernel({
			manifest: await readAppManifest(ROOT),
			definition: () => import('../src/native.js'),
		});

		try {
			const executor = new InProcessExecutor({
				handler: (command, input) => kernel.call(command, input ?? {}),
			});
			const result = await executor.execute(parsed.scenario);
			expect(result.outcome).toBe('pass');
			expect(result.stepResults).toHaveLength(4);
			expect(result.stepResults.map((step) => step.outcome)).toEqual([
				'pass',
				'pass',
				'pass',
				'pass',
			]);

			const documentId = (result.stepResults[0]?.commandResult?.data as { id?: string } | undefined)
				?.id;
			expect(documentId).toBeTruthy();

			const editor = await kernel.call<{
				groups: Array<{ id: string; tabs: Array<{ id: string; document: string }> }>;
			}>('editor-get');
			expect(editor.data?.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
				['t1'],
				['t2'],
			]);

			const content = await kernel.call<{ text: string }>('notes-content-get', {
				document: documentId,
			});
			expect(content.data?.text).toBe('Ship the editor area next week.');

			const { report } = await replay();
			expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		} finally {
			await kernel.dispose();
		}
	});
});
