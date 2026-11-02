import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RANDOM_SEED } from './baseline.js';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { diffObservations } from './diff.js';
import { observationSchema } from './schema.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/baseline');
const compat = resolve(import.meta.dirname, '../compat');

describe('the declared baseline and the capture manifest', () => {
	let bench: SpecimenBench;
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: fixtures });
	});
	afterAll(async () => {
		await bench.close();
	});

	it('gives each page the same randomness, so an unchanged specimen compares as unchanged', async () => {
		const left = await bench.render({ id: 'random-marker' });
		const right = await bench.render({ id: 'random-marker' });
		expect(left.channels.dom.raw).toBe(right.channels.dom.raw);
		expect(diffObservations(left, right).status).toBe('no-change-observed');
		// Two draws in one page differ: it is seeded, not constant.
		const [marker, value] = left.channels.dom.raw.replace(/<[^>]+>/g, '').split(' ');
		expect(marker).not.toBe(Number(value).toString(36).slice(2, 8));
	});

	it('records what produced the capture, and passes its own schema', async () => {
		const observation = await bench.render({ id: 'random-marker' });
		const { manifest } = observation;
		expect(observationSchema.parse(observation)).toBeTruthy();
		const own = JSON.parse(
			await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')
		) as { name: string; version: string };
		expect(manifest.bench).toEqual({ name: own.name, version: own.version, plugins: [] });
		expect(new Date(manifest.capturedUtc).toISOString()).toBe(manifest.capturedUtc);
		expect(manifest.driver.name).toBe('host');
		expect(manifest.driver.emulates).toContain('color-scheme');
		expect(manifest.browser.platform).toBe(`${process.platform}-${process.arch}`);
		expect(manifest.browser.build).toBeNull();
		expect(manifest.checkpoint).toEqual({
			name: 'mount',
			actionMode: 'none',
			ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
			baseline: {
				clock: 'real',
				random: { source: 'seeded', seed: RANDOM_SEED },
				storage: 'empty',
			},
		});
		expect(manifest.context.pixelRatio).toBe(1);
		expect(manifest.context.observed.width).toBe(manifest.context.viewport.width);
		expect(manifest.context.observed.devicePixelRatio).toBe(1);
	});

	it('records the fonts and remote requests a page made, and a declared ready hook', async () => {
		const { manifest } = await bench.render({ id: 'with-resources', timeoutMs: 8000 });
		expect(manifest.checkpoint.ready.steps).toEqual(['upgrade', 'ready-hook', 'fonts', 'frame']);
		expect(manifest.checkpoint.ready.deadlineMs).toBe(8000);
		expect(manifest.context.resources.fonts.map((font) => font.family)).toContain('"Fixture Face"');
		expect(manifest.context.resources.remote).toEqual([
			{ url: 'http://127.0.0.1:9/unreachable.json', status: 0 },
		]);
	});

	it('says how a retained story reached its checkpoint', async () => {
		const retained = await createSpecimenBench({ root: compat });
		try {
			const mounted = await retained.render({ id: 'fixtures-cases--precedence' });
			expect(mounted.manifest.checkpoint.actionMode).toBe('none');
			const run = await retained.run({ id: 'fixtures-cases--precedence' });
			expect(run.observation?.manifest.checkpoint).toMatchObject({
				name: 'after-run',
				actionMode: 'play',
			});
		} finally {
			await retained.close();
		}
	});
});
