import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSpecimenBench, type SpecimenBench } from '@lushly-dev/specimen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The FAST-AF plugin through Specimen's bench, on a FAST element.
let bench: SpecimenBench;

beforeAll(async () => {
	bench = await createSpecimenBench({ root: resolve(import.meta.dirname, '../fixtures') });
});
afterAll(async () => {
	await bench?.close();
});

describe('the FAST-AF plugin', () => {
	it('describes a FAST element from its Definition Schema', async () => {
		const inspected = await bench.inspect({ id: 'press-default' });
		expect(inspected.plugins).toEqual([
			{ id: 'fast-af', runners: [], themes: ['light', 'dark'], tokens: 'fast-af@0.1.0' },
		]);
		expect(inspected.schema).toMatchObject({
			tag: 'fixture-press',
			sources: ['fast-af'],
			slots: [{ name: 'after' }],
			commands: [],
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

	it("records its version in each capture's manifest", async () => {
		const capture = await bench.render({ id: 'press-default' });
		const own = JSON.parse(
			await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')
		) as { version: string };
		expect(capture.manifest.bench.plugins).toEqual([{ id: 'fast-af', version: own.version }]);
	});

	it('supplies coverage with what only its Definition Schema knows', async () => {
		const run = await bench.coverage({
			component: 'fixture-press',
			filter: { ids: ['press-default'] },
		});
		const press = run.components[0];
		expect(press?.sources).toEqual(['fast-af']);
		const levels = Object.fromEntries(
			(press?.obligations ?? []).map((item) => [item.id, item.level])
		);
		expect(Object.keys(levels).filter((id) => id.startsWith('command:'))).toEqual([]);
		expect(levels['property:disabled=true']).toBe('missing');
		expect(levels['property:disabled=false']).toBe('represented');
		expect(run.invalidClaims).toEqual([]);
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
