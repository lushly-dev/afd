import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { CoverageRun } from './types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/partitions');

describe('specimen-coverage', () => {
	let bench: SpecimenBench;
	let run: CoverageRun;
	const levels = (tag: string) =>
		Object.fromEntries(
			(run.components.find((component) => component.tag === tag)?.obligations ?? []).map(
				(obligation) => [obligation.id, obligation.level]
			)
		);
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: fixtures });
		run = await bench.coverage();
	}, 60_000);
	afterAll(async () => {
		await bench.close();
	});

	it('takes each required partition from the schema, at the level the run earned', () => {
		expect(levels('fixture-panel')).toEqual({
			default: 'represented',
			'property:disabled=true': 'represented',
			'property:disabled=false': 'represented',
			'property:size=small': 'represented',
			'property:size=large': 'represented',
			// No attribute reflects it: read live on the element, and `b` was never shown.
			'property:mode=a': 'represented',
			'property:mode=b': 'missing',
			// A property whose getter throws cannot be read, and saying missing would be a guess.
			'property:broken=true': 'unknown',
			'property:broken=false': 'unknown',
			'slot:default=filled': 'represented',
			'slot:default=empty': 'represented',
			'slot:after=filled': 'represented',
			'slot:after=empty': 'represented',
			'event:changed': 'represented',
			// Seen to be form-associated, with no evidence of what it does in a form.
			'form:participation': 'unknown',
			'form:validity': 'unknown',
		});
	});

	it('names what shows each obligation, and only from cases that passed', () => {
		const panel = run.components.find((component) => component.tag === 'fixture-panel');
		const disabled = panel?.obligations.find((item) => item.id === 'property:disabled=true');
		expect(disabled?.evidence).toEqual([
			{ specimen: 'panel-disabled', checkpoint: 'after-run', target: 'root/fixture-panel:1' },
		]);
		expect(disabled?.evidenceCount).toBe(1);
		expect(run.cases).toMatchObject({ total: 5, passed: 4 });
		expect(run.cases.failed.map((item) => item.id)).toEqual(['panel-broken']);
		expect(run.cases.failed[0]?.message).toContain('missing');
		expect(panel?.cases).toBe(4);
		expect(JSON.stringify(run.components)).not.toContain('panel-broken');
	});

	it('inspects slots at their target, so text in the default slot counts as filled', () => {
		const panel = run.components.find((component) => component.tag === 'fixture-panel');
		const filled = panel?.obligations.find((item) => item.id === 'slot:default=filled');
		expect(filled?.evidence.map((item) => item.specimen).sort()).toEqual([
			'panel-disabled',
			'panel-filled',
		]);
	});

	it('reports a component no case renders as missing, not unknown', () => {
		expect(levels('fixture-unused')).toEqual({
			default: 'missing',
			'property:open=true': 'missing',
			'property:open=false': 'missing',
		});
		const unused = run.components.find((component) => component.tag === 'fixture-unused');
		expect(unused?.obligations[0]?.reason).toBe('No case renders <fixture-unused>.');
		expect(unused?.cases).toBe(0);
	});

	it('lists open-ended members rather than promising every value', () => {
		const panel = run.components.find((component) => component.tag === 'fixture-panel');
		expect(panel?.openEnded).toEqual(['note']);
		expect(panel?.obligations.some((item) => item.id.includes('note'))).toBe(false);
	});

	it('is never complete on what is only represented', () => {
		expect(run.obligations).toBe('schema-partitions@1');
		expect(run.complete).toBe(false);
		expect(run.counts.verified).toBe(0);
		expect(run.counts.represented).toBeGreaterThan(0);
	});

	it('narrows to one component, and refuses one no schema describes', async () => {
		const one = await bench.coverage({
			component: 'fixture-unused',
			filter: { ids: ['panel-default'] },
		});
		expect(one.components.map((component) => component.tag)).toEqual(['fixture-unused']);
		expect(one.cases.total).toBe(1);
		await expect(bench.coverage({ component: 'fixture-none' })).rejects.toThrow(
			'No schema describes fixture-none'
		);
	});
});
