import { resolve } from 'node:path';
import { createSpecimenBench, type SpecimenBench } from '@lushly-dev/specimen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The FAST-AF plugin through Specimen's bench, on a FAST element with an `@command`.
let bench: SpecimenBench;

beforeAll(async () => {
	bench = await createSpecimenBench({ root: resolve(import.meta.dirname, '../fixtures') });
});
afterAll(async () => {
	await bench?.close();
});

describe('the FAST-AF plugin', () => {
	it('describes a FAST element from its Definition Schema, @command commands included', async () => {
		const inspected = await bench.inspect({ id: 'press-default' });
		expect(inspected.plugins).toEqual([
			{ id: 'fast-af', runners: ['fast-af'], themes: ['light', 'dark'], tokens: 'fast-af@0.1.0' },
		]);
		expect(inspected.schema).toMatchObject({
			tag: 'fixture-press',
			sources: ['fast-af'],
			slots: [{ name: 'after' }],
			commands: [{ id: 'fixture.press', label: 'Press' }],
			unknown: [],
		});
		expect(inspected.schema?.properties).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'label', attribute: 'label' }),
				expect.objectContaining({ name: 'disabled', type: 'boolean', values: [true, false] }),
			])
		);
		expect(inspected.args).toEqual({ label: 'Water' });
	});

	it('runs a command step through the FAST-AF runner', async () => {
		const capture = await bench.render({ id: 'press-pressed', checkpoint: 'pressed' });
		const press = capture.channels.elements.find((item) => item.tag === 'fixture-press');
		expect(press?.attributes).toHaveProperty('data-presses', '1');
		await expect(
			bench.render({ id: 'press-unknown-command', checkpoint: 'after-run' })
		).rejects.toThrow(
			/fixture-press has no FAST-AF command 'fixture\.missing'; it has fixture\.press/
		);
	});

	it("applies a theme module's preset to a native specimen", async () => {
		const light = await bench.render({ id: 'press-default' });
		const dark = await bench.render({ id: 'press-default', context: { theme: 'dark' } });
		const ink = (capture: typeof light) =>
			capture.channels.elements.find((item) => item.tag === 'fixture-press')?.styles.color;
		expect(ink(light)).toBe('rgb(0, 0, 0)');
		expect(ink(dark)).toBe('rgb(255, 255, 255)');
	});
});
