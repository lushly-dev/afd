import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';

// The four plugin points on a plain custom element, through the native bench.
const root = resolve(import.meta.dirname, '../fixtures/plugins');
let bench: SpecimenBench;

beforeAll(async () => {
	bench = await createSpecimenBench({ root });
});
afterAll(async () => {
	await bench?.close();
});

describe('plugins', () => {
	it('run an explicit command step through a named runner', async () => {
		const capture = await bench.render({ id: 'switch-toggled', checkpoint: 'toggled' });
		const element = capture.channels.elements.find((item) => item.tag === 'plain-switch');
		expect(element?.attributes).toHaveProperty('checked', '');
		await expect(
			bench.render({ id: 'switch-missing-runner', checkpoint: 'after-run' })
		).rejects.toThrow(
			/names command runner 'absent', which no plugin registers; the plugins register fixture/
		);
	}, 60_000);

	it('apply a named theme a plugin provides to a native specimen', async () => {
		const capture = await bench.render({ id: 'switch-toggled', context: { theme: 'dark' } });
		expect(capture.manifest.context.theme).toBe('dark');
		expect(capture.channels.dom.raw).not.toContain('fixture-preset');
		const root = capture.channels.elements.find((item) => item.ref === 'root');
		expect(root?.attributes).toHaveProperty('data-fixture-preset', 'dark');
	}, 60_000);

	it('inspect a specimen: args, context and the schema the manifest and the plugin give', async () => {
		const inspected = await bench.inspect({ id: 'switch-toggled' });
		expect(inspected).toMatchObject({
			id: 'switch-toggled',
			component: 'plain-switch',
			args: { checked: false },
			context: { viewport: { width: 1280, height: 720 }, theme: 'light' },
			limitations: [],
			plugins: [{ id: 'fixture', runners: ['fixture'], themes: ['dark'], tokens: 'fixture@1.0.0' }],
		});
		expect(inspected.schema).toMatchObject({
			sources: ['manifest', 'fixture'],
			commands: [{ id: 'toggle' }],
			unknown: [],
			attributes: [{ name: 'size', values: ['small', 'large'] }],
		});
	}, 60_000);

	it('reject a runner id two plugins register', async () => {
		const duplicate = await createSpecimenBench({ root, configFile: 'specimen.duplicate.json' });
		try {
			await expect(duplicate.render({ id: 'switch-toggled' })).rejects.toThrow(
				/Command runner 'fixture' is registered by 'fixture' and 'duplicate'/
			);
			const inspected = duplicate.inspect({ id: 'switch-toggled' });
			await expect(inspected).rejects.toThrow(/registered by 'fixture' and 'duplicate'/);
		} finally {
			await duplicate.close();
		}
	}, 60_000);
});
