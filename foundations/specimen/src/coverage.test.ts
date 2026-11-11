import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import * as scenarioSupport from './browser/expectations.js';
import { validateSpecimen } from './browser/validate.js';
import { coverageRunSchema } from './schema.js';
import type { CoverageRun } from './types.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/partitions');

describe('a specimen\u2019s claims and expectations', () => {
	const target = { selector: 'x-a' };
	const check = { id: 'a', expect: { target: 'one', state: { attribute: 'b', equals: '' } } };
	const specimen = (fields: Record<string, unknown>) =>
		validateSpecimen({ Case: { targets: { one: target }, ...fields } }, 'Case', scenarioSupport);
	const claim = {
		target: 'one',
		obligation: 'default',
		checkpoint: 'after-run',
		expectations: ['a'],
	};

	it('accepts a claim on what the specimen declares', () => {
		const { specimen: read } = specimen({ scenario: [check], coverage: [claim] });
		expect(read.coverage).toEqual([claim]);
	});

	it.each([
		[{ ...claim, target: 'two' }, "refers to undeclared target 'two'"],
		[{ ...claim, obligation: 'whatever' }, "'whatever' is not an obligation"],
		[{ ...claim, checkpoint: 'later' }, "'later' is not a checkpoint"],
		[{ ...claim, expectations: [] }, 'at least one expect step'],
		[{ ...claim, expectations: ['b'] }, "refers to 'b'"],
		[{ ...claim, other: 1 }, 'other'],
	])('refuses %j', (bad, message) => {
		expect(() => specimen({ scenario: [check], coverage: [bad] })).toThrow(message);
	});

	it('accepts a guide statement as an obligation, named by its id', () => {
		const guided = { ...claim, obligation: 'guide:button.icon-name' };
		expect(specimen({ scenario: [check], coverage: [guided] }).specimen.coverage).toEqual([guided]);
		expect(() =>
			specimen({ scenario: [check], coverage: [{ ...claim, obligation: 'guide:Button' }] })
		).toThrow("'guide:Button' is not an obligation");
	});

	it('refuses an expectation that comes after the checkpoint it would prove', () => {
		expect(() =>
			specimen({
				scenario: [{ capture: 'early' }, check],
				coverage: [{ ...claim, checkpoint: 'early' }],
			})
		).toThrow("no expect step before 'early'");
	});

	it.each([
		[{ target: 'two', state: { attribute: 'a', equals: '' } }, "undeclared target 'two'"],
		[{ target: 'one', state: { equals: '' } }, 'a property or an attribute'],
		[{ target: 'one', state: { property: 'a', attribute: 'b', equals: '' } }, 'not both'],
		[{ target: 'one', state: { property: 'a' } }, 'needs equals'],
		[{ target: 'one' }, 'one of event, state, form or validity'],
		[{ target: 'one', form: { name: 'a', value: 1 } }, 'a string, or null'],
		[{ target: 'one', validity: { valid: 'yes' } }, 'must be a boolean'],
	])('refuses the expectation %j', (bad, message) => {
		expect(() => specimen({ scenario: [{ expect: bad }] })).toThrow(message);
	});
});

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
			// The disabled panel shows this. A claim whose target is not disabled must not raise it.
			'property:disabled=true': 'represented',
			'property:disabled=false': 'represented',
			'property:size=small': 'represented',
			// A claim whose expectation was about another element.
			'property:size=large': 'asserted',
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
		expect(run.cases).toMatchObject({ total: 11, passed: 10 });
		expect(run.cases.failed.map((item) => item.id)).toEqual(['panel-broken']);
		expect(run.cases.failed[0]?.message).toContain('missing');
		expect(panel?.cases).toBe(6);
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

	it('verifies a state only when its expectation is about that target, in that state', () => {
		expect(levels('fixture-simple')).toMatchObject({
			'property:open=true': 'verified',
			'property:open=false': 'verified',
		});
		const simple = run.components.find((component) => component.tag === 'fixture-simple');
		expect(simple?.obligations.find((item) => item.id === 'property:open=true')?.evidence).toEqual([
			{
				specimen: 'claimed-open',
				checkpoint: 'open',
				target: 'root/fixture-simple:1',
				expectations: ['is-open'],
			},
		]);
		const panel = run.components.find((component) => component.tag === 'fixture-panel');
		expect(panel?.obligations.find((item) => item.id === 'property:size=large')?.reason).toBe(
			"No expectation it names is about 'panel'."
		);
	});

	it('takes form obligations only from real FormData and validity', () => {
		expect(levels('fixture-claimed-field')).toMatchObject({
			'form:participation': 'verified',
			'form:validity': 'verified',
		});
		// Seen to be form-associated, with no claim: never credited from the state alone.
		expect(levels('fixture-panel')).toMatchObject({
			'form:participation': 'unknown',
			'form:validity': 'unknown',
		});
	});

	it('reports a claim it cannot honor, which keeps the run from being complete', () => {
		expect(run.invalidClaims).toEqual(
			expect.arrayContaining([
				{
					specimen: 'bad-claim',
					target: 'simple',
					obligation: 'property:nope=1',
					reason: "<fixture-simple> has no obligation 'property:nope=1'.",
				},
				// A false claim: the expectation held, but the target is not disabled.
				{
					specimen: 'claimed-wrong-state',
					target: 'panel',
					obligation: 'property:disabled=true',
					reason: "'panel' was not observed in this state at after-run.",
				},
			])
		);
		expect(run.invalidClaims).toHaveLength(2);
	});

	it('applies versioned waivers, and reports those matching nothing', async () => {
		expect(run.waivers).toEqual({
			version: '2026-11-01',
			unused: [
				{
					component: 'fixture-simple',
					obligation: 'property:gone=true',
					reason: 'The member was removed.',
				},
			],
		});
		const simple = run.components.find((component) => component.tag === 'fixture-simple');
		const waived = simple?.obligations.find((item) => item.id === 'default');
		expect(waived?.waiver).toBe('Identical to the closed state.');
		// A waiver excuses an obligation, and does not raise its level.
		expect(waived?.level).toBe('represented');
		expect(run.waived).toBe(1);
		// Everything required of it is verified or waived, so only the bad claim stops it.
		const narrowed = await bench.coverage({
			component: 'fixture-simple',
			filter: { ids: ['claimed-open', 'claimed-closed'] },
		});
		expect(narrowed.complete).toBe(true);
		expect(narrowed.counts.verified).toBe(2);
	});

	it('returns exactly what its output schema says, as the AFD command checks it', () => {
		expect(coverageRunSchema.parse(run)).toBeTruthy();
	});

	it('is never complete on what is only represented', () => {
		expect(run.obligations).toBe('schema-partitions@1');
		expect(run.complete).toBe(false);
		expect(run.counts.represented).toBeGreaterThan(0);
	});

	let played: CoverageRun | undefined;
	it('takes a play\u2019s claims, with the same checks and no more trust', async () => {
		const retained = await createSpecimenBench({
			root: resolve(import.meta.dirname, '../compat'),
			configFile: resolve(import.meta.dirname, '../compat/claims.config.json'),
		});
		try {
			const run = await retained.coverage();
			played = run;
			const of = (tag: string, id: string) =>
				run.components
					.find((component) => component.tag === tag)
					?.obligations.find((item) => item.id === id);
			const disabled = of('plain-button', 'property:disabled=true');
			expect(disabled?.level).toBe('verified');
			expect(disabled?.evidence[0]?.expectations).toEqual(['has-disabled']);
			expect(of('plain-button', 'property:disabled=false')?.level).toBe('verified');
			// Its target is not disabled, so this is false, and reported.
			expect(run.invalidClaims).toEqual([
				{
					specimen: 'fixtures-claims--false-in-play',
					target: 'plain-button',
					obligation: 'property:disabled=true',
					reason: "'plain-button' was not observed in this state at after-run.",
				},
			]);
			// One story only says so, and another really read the form: the run decides.
			const form = of('fixture-field', 'form:participation');
			expect(form?.level).toBe('verified');
			expect(form?.evidence.map((item) => item.specimen)).toEqual([
				'fixtures-claims--form-read-in-play',
			]);
		} finally {
			await retained.close();
		}
	}, 60_000);

	it('verifies a guide statement only by the check its claim ran, in guides@1 alone', async () => {
		const open = (file: string) =>
			createSpecimenBench({
				root: resolve(import.meta.dirname, '../compat'),
				configFile: resolve(import.meta.dirname, `../compat/${file}`),
			});
		const [guided, bare] = await Promise.all([
			open('guide-claims.config.json'),
			open('guide-claims-bare.config.json'),
		]);
		try {
			const [withGuides, without] = await Promise.all([
				guided.coverage({ workers: 1 }),
				bare.coverage({ workers: 1 }),
			]);
			const guides = withGuides.guides;
			expect(guides?.obligations).toBe('guides@1');
			expect(guides?.statements.map(({ id, level }) => [id, level])).toEqual([
				['guide:plain-button.label', 'verified'],
				// Its check threw: the story failed, so nothing it claimed counts.
				['guide:plain-button.focus', 'authored'],
				['guide:plain-button.disabled-attribute', 'verified'],
				['guide:fields.in-a-form', 'authored'],
			]);
			expect(guides?.statements[0]?.evidence).toEqual([
				{
					specimen: 'fixtures-guide-claims--labelled',
					checkpoint: 'after-run',
					target: expect.any(String),
					expectations: ['says-save'],
				},
			]);
			expect(guides?.counts).toEqual({ verified: 2, authored: 2 });
			expect(guides?.invalidClaims).toEqual([
				{
					specimen: 'fixtures-guide-claims--unchecked',
					target: 'plain-button',
					obligation: 'guide:plain-button.focus',
					reason: 'A story\u2019s guide claim needs its check: pass it to claim(), which runs it.',
				},
				{
					specimen: 'fixtures-guide-claims--unchecked',
					target: 'plain-button',
					obligation: 'guide:plain-button.nope',
					reason: "No guide states 'plain-button.nope'.",
				},
			]);
			expect(guides?.complete).toBe(false);
			expect(withGuides.cases.failed.map((item) => item.id)).toEqual([
				'fixtures-guide-claims--focus-fails',
			]);
			expect(coverageRunSchema.parse(withGuides)).toBeTruthy();
			// Adding guides changes nothing schema-partitions@1 reports, its `complete` included.
			const partitions = ({ guides: _, elapsedMs: __, ...rest }: CoverageRun) => rest;
			expect(partitions(withGuides)).toEqual(partitions(without));
			expect(withGuides.invalidClaims).toEqual(played?.invalidClaims);
			// With no guide files, every guide claim names an unknown statement.
			expect(without.guides?.statements).toEqual([]);
			expect(without.guides?.invalidClaims.map((item) => item.reason)).toEqual([
				"No guide states 'plain-button.label'.",
				"No guide states 'plain-button.disabled-attribute'.",
				"No guide states 'plain-button.focus'.",
				"No guide states 'plain-button.nope'.",
			]);
		} finally {
			await Promise.all([guided.close(), bare.close()]);
		}
	}, 60_000);

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
