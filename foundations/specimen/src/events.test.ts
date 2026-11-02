import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/events');
const compat = resolve(import.meta.dirname, '../compat');

describe('declared events and the context matrix', () => {
	let bench: SpecimenBench;
	const capture = (id: string, checkpoint = 'after-run') => bench.render({ id, checkpoint });

	beforeAll(async () => {
		bench = await createSpecimenBench({ root: fixtures });
	});
	afterAll(async () => {
		await bench.close();
	});

	it('records a declared event on its target, in its interval', async () => {
		const observation = await capture('clicked', 'after-click');
		expect(observation.channels.events.declared).toEqual([{ type: 'click', target: 'control' }]);
		expect(observation.channels.events.history).toEqual([
			{
				type: 'click',
				target: 'control',
				step: 'activate',
				composed: true,
				bubbles: true,
				trusted: true,
				detail: null,
			},
		]);
		expect(observation.completeness.events.status).toBe('complete');
	});

	it('sees a non-composed event inside a target, and describes what it carries', async () => {
		const observation = await capture('non-composed');
		const toggled = observation.channels.events.history.find((event) => event.type === 'toggled');
		expect(toggled).toMatchObject({
			target: 'host',
			step: 'toggle',
			composed: false,
			detail: { on: true, node: '[node button]' },
		});
	});

	it('does not let an earlier event satisfy a later step', async () => {
		await expect(capture('earlier')).rejects.toThrow(
			"Expected event 'announce' since step 'activate'; saw no declared event."
		);
		// The event itself was seen, while mounting: it belongs to no step.
		const mounted = await capture('earlier', 'mount');
		expect(mounted.channels.events.history).toMatchObject([{ type: 'announce', step: null }]);
	});

	it('does not let an event on another target satisfy an expectation', async () => {
		await expect(capture('other-target')).rejects.toThrow(
			"Expected event 'click' on 'control' since step 'dismiss'; saw click on cancel."
		);
	});

	it('fails an expectation nothing satisfies, within its bound', async () => {
		await expect(capture('never')).rejects.toThrow("Expected event 'submit-ish'");
	});

	it('refuses, before running, an expectation it could not credit', async () => {
		await expect(capture('undeclared')).rejects.toThrow('specimen.events does not declare');
		await expect(capture('no-interval')).rejects.toThrow('must name the step');
		await expect(capture('unknown-step')).rejects.toThrow('no earlier step');
	});

	it('binds a target that appears after the first step', async () => {
		const observation = await capture('later-target');
		// Before the target is known, a click cannot be ruled out, so it is kept without a target.
		expect(observation.channels.events.history).toMatchObject([
			{ type: 'click', target: null, step: 'open' },
			{ type: 'click', target: 'control', step: 'activate' },
		]);
		expect(observation.completeness.events.status).toBe('complete');
	});

	it('says so when a declared target never existed', async () => {
		const observation = await capture('missing-target');
		expect(observation.completeness.events.status).toBe('partial');
		expect(observation.completeness.events.reasons).toEqual([
			"Declared event target 'gone' did not resolve.",
		]);
	});

	it('reports events as not requested when none are declared', async () => {
		const observation = await capture('plain');
		expect(observation.channels.events).toEqual({ declared: [], history: [] });
		expect(observation.completeness.events).toMatchObject({
			status: 'not-requested',
			reasons: ['NO_EVENTS_DECLARED'],
		});
	});

	it('captures each cell in isolation and compares it with the first', async () => {
		const run = await bench.matrix({
			id: 'responsive',
			axes: {
				viewport: [
					{ width: 1280, height: 720 },
					{ width: 375, height: 812 },
				],
				theme: ['light', 'dark'],
			},
		});
		expect(run.axes).toEqual(['viewport', 'theme']);
		expect(run.cells).toHaveLength(4);
		expect(run.cells[0]?.diff).toBeNull();
		expect(run.cells[0]?.context).toEqual({
			viewport: { width: 1280, height: 720 },
			theme: 'light',
		});
		expect(run.cells[0]?.observation).toBeUndefined();
		// Light at the same size differs only in what the theme changes.
		const dark = run.cells[1];
		expect(dark?.context.theme).toBe('dark');
		expect(dark?.diff?.status).toBe('changed');
		expect(dark?.diff?.channels).toContain('styles');
		expect(dark?.diff?.channels).not.toContain('dom');
		// A narrow viewport changes the text the component renders.
		expect(run.cells[2]?.diff?.channels).toContain('dom');
		expect(run.counts).toMatchObject({ total: 4, captured: 4, unavailable: 0, changed: 3 });
	});

	it('keeps a cell with no capture visible, with its reason', async () => {
		const run = await bench.matrix({
			id: 'locale-limited',
			axes: { locale: ['en-US', 'de', 'fr'] },
			observations: true,
		});
		expect(run.counts).toMatchObject({ total: 3, captured: 2, unavailable: 1 });
		const german = run.cells[1];
		expect(german?.status).toBe('unavailable');
		expect(german?.reason).toContain('No German strings yet.');
		expect(german?.observation).toBeUndefined();
		expect(run.cells[0]?.observation?.manifest.context.locale).toBe('en-US');
	});

	it('compares with the first cell that has a capture', async () => {
		const run = await bench.matrix({
			id: 'locale-limited',
			axes: { locale: ['de', 'en-US', 'fr'] },
		});
		expect(run.cells[0]?.status).toBe('unavailable');
		expect(run.cells[1]?.diff).toBeNull();
		expect(run.cells[2]?.diff).not.toBeNull();
	});

	it('explains a request it will not run', async () => {
		await expect(bench.matrix({ id: 'missing', axes: { theme: ['light'] } })).rejects.toThrow(
			'Specimen not found'
		);
		await expect(bench.matrix({ id: 'responsive', axes: {} })).rejects.toThrow('at least one axis');
		await expect(bench.matrix({ id: 'responsive', axes: { theme: [] } })).rejects.toThrow(
			'at least one value'
		);
		await expect(
			bench.matrix({ id: 'responsive', axes: { theme: ['chartreuse' as string] } })
		).rejects.toThrow('expected light or dark');
		// Two-letter regions, all different, so that only their number is wrong.
		const locales = Array.from(
			{ length: 33 },
			(_, index) => `en-${String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26))}`
		);
		await expect(
			bench.matrix({ id: 'responsive', axes: { locale: locales, theme: ['light', 'dark'] } })
		).rejects.toThrow('66 cells');
	});
});

describe('a matrix of a retained story', () => {
	it('captures the story in each requested context', async () => {
		const bench = await createSpecimenBench({ root: compat });
		try {
			const id = bench.list().find((entry) => entry.story?.name === 'Smoke Only')?.id as string;
			const run = await bench.matrix({
				id,
				axes: {
					viewport: [
						{ width: 1200, height: 900 },
						{ width: 400, height: 700 },
					],
				},
			});
			expect(run.checkpoint).toBe('mount');
			expect(run.counts.captured).toBe(2);
			expect(run.cells[1]?.diff).not.toBeNull();
		} finally {
			await bench.close();
		}
	}, 120_000);
});
